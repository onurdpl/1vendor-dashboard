import type { WebhookEvent } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import type { AppEnv } from '../../config/env.js';
import { createShopifyAdminService } from '../shopify/shopify-admin.service.js';
import { fetchSellerInfoWithRetry } from '../shopify/seller-info-retry.service.js';
import { ingestShopifyOrderWebhook } from '../shopify/order-ingestion.service.js';
import { ingestShopifyRefundWebhook } from '../shopify/refund-ingestion.service.js';
import {
  applyReturnLifecycleStatusWebhook,
  ingestReturnRequestWebhook,
} from '../shopify/return-lifecycle-ingestion.service.js';
import { ingestFulfillmentWebhook } from '../shopify/fulfillment-ingestion.service.js';
import type { ShopifyOrdersCreateWebhookPayload } from '../shopify/order-ingestion.types.js';
import type { ShopifyRefundsCreateWebhookPayload } from '../shopify/refund-ingestion.types.js';
import type { ReturnLifecycleWebhookPayload } from '../shopify/return-lifecycle-ingestion.types.js';
import type { FulfillmentWebhookPayload, FulfillmentWebhookTopic } from '../shopify/fulfillment-ingestion.types.js';
import type {
  AdminWebhookDiagnosticDetail,
  AdminWebhookDiagnosticsEvent,
  AdminWebhookDiagnosticsResponse,
  ReconciliationItem,
  ReconciliationResponse,
  SyncDiagnosticItem,
  SyncDiagnosticsResponse,
  SyncDiagnosticSeverity,
  WebhookRecoverResponse,
  WebhookReplayResponse,
} from './diagnostics.types.js';

const SUPPORTED_REPLAY_TOPICS = new Set([
  'orders/create',
  'refunds/create',
  'fulfillments/create',
  'fulfillments/update',
  'fulfillment_events/create',
  'fulfillment_orders/cancelled',
]);

const SUPPORTED_RECOVER_TOPICS = new Set([
  'orders/create',
  'refunds/create',
  'returns/request',
  'returns/approve',
  'returns/decline',
  'returns/close',
  'returns/cancel',
  'fulfillments/create',
  'fulfillments/update',
  'fulfillment_events/create',
  'fulfillment_orders/cancelled',
]);

const PAYLOAD_PREVIEW_LIMIT = 1200;

function toIsoString(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

function inferNeedsAttention(status: string, errorMessage: string | null) {
  return status === 'FAILED' || Boolean(errorMessage);
}

function buildWebhookEventSummary(events: AdminWebhookDiagnosticsEvent[]): AdminWebhookDiagnosticsResponse['summary'] {
  return events.reduce(
    (summary, event) => {
      summary.total += 1;

      if (event.status === 'RECEIVED') {
        summary.received += 1;
      }

      if (event.status === 'PROCESSED') {
        summary.processed += 1;
      }

      if (event.status === 'FAILED') {
        summary.failed += 1;
      }

      if (event.duplicate) {
        summary.duplicates += 1;
      }

      if (inferNeedsAttention(event.status, event.errorMessage)) {
        summary.needsAttention += 1;
      }

      return summary;
    },
    {
      total: 0,
      received: 0,
      processed: 0,
      failed: 0,
      duplicates: 0,
      needsAttention: 0,
    },
  );
}

function detectWebhookFailureSeverity(errorMessage: string | null): SyncDiagnosticSeverity {
  const message = (errorMessage ?? '').toLowerCase();

  if (
    message.includes('seller_info') ||
    message.includes('unresolved') ||
    message.includes('missing') ||
    message.includes('vendor')
  ) {
    return 'critical';
  }

  return 'warning';
}

function summarizeError(message: string | null | undefined) {
  if (!message) {
    return null;
  }

  return message.length > 220 ? `${message.slice(0, 217)}...` : message;
}

function stringifyEntityId(value: unknown) {
  if (typeof value === 'string' && value.trim()) {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'bigint') {
    return String(value);
  }

  return null;
}

function getStringField(payload: Record<string, unknown> | null, key: string) {
  if (!payload) {
    return null;
  }

  return stringifyEntityId(payload[key]);
}

function parsePayloadForHints(rawPayload: string | null) {
  if (!rawPayload) {
    return null;
  }

  try {
    return JSON.parse(rawPayload) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function inferAffectedEntities(event: {
  topic: string;
  rawPayload: string | null;
  shopifyOrder?: { sourceShopifyOrderId: string; sourceShopifyOrderNumber?: string | number | null } | null;
}) {
  const payload = parsePayloadForHints(event.rawPayload);
  const adminGraphqlId = getStringField(payload, 'admin_graphql_api_id');
  const payloadId = getStringField(payload, 'id');
  const fulfillmentId = getStringField(payload, 'fulfillment_id');
  const orderId = getStringField(payload, 'order_id');
  const orderNumber = getStringField(payload, 'order_number') ?? getStringField(payload, 'name');

  return {
    shopifyOrderId:
      event.shopifyOrder?.sourceShopifyOrderId ??
      orderId ??
      (event.topic === 'orders/create' ? payloadId : null),
    shopifyOrderNumber: event.shopifyOrder?.sourceShopifyOrderNumber
      ? String(event.shopifyOrder.sourceShopifyOrderNumber)
      : orderNumber,
    shopifyReturnId: event.topic.startsWith('returns/')
      ? adminGraphqlId ?? payloadId
      : null,
    shopifyRefundId: event.topic === 'refunds/create' ? payloadId : null,
    shopifyFulfillmentId:
      event.topic.startsWith('fulfillments/') || event.topic.startsWith('fulfillment_events/')
        ? adminGraphqlId ?? fulfillmentId ?? payloadId
        : null,
    vendorId: null,
  };
}

function buildPayloadPreview(rawPayload: string | null) {
  if (!rawPayload) {
    return {
      payloadPreview: null,
      payloadPreviewTruncated: false,
    };
  }

  const preview = rawPayload.slice(0, PAYLOAD_PREVIEW_LIMIT);
  return {
    payloadPreview: preview,
    payloadPreviewTruncated: rawPayload.length > PAYLOAD_PREVIEW_LIMIT,
  };
}

function getReplayBlockedReason(event: {
  topic: string;
  status: string;
  rawPayload: string | null;
  payloadHash: string | null;
}) {
  if (!SUPPORTED_REPLAY_TOPICS.has(event.topic)) {
    return `Replay is not supported for topic ${event.topic}.`;
  }

  if (!event.rawPayload) {
    return 'Webhook payload is not available for replay.';
  }

  if (!event.payloadHash) {
    return 'Webhook payload hash is not available for replay.';
  }

  if (event.status === 'PROCESSING') {
    return 'Webhook is currently processing.';
  }

  return null;
}

function getRecoverBlockedReason(event: {
  topic: string;
  status: string;
  rawPayload: string | null;
  payloadHash: string | null;
}) {
  if (!SUPPORTED_RECOVER_TOPICS.has(event.topic)) {
    return `Recover is not supported for topic ${event.topic}.`;
  }

  if (!event.rawPayload) {
    return 'Webhook payload is not available for replay.';
  }

  if (!event.payloadHash) {
    return 'Webhook payload hash is not available for recovery.';
  }

  if (event.status === 'PROCESSED') {
    return 'Processed webhook events are not recoverable.';
  }

  if (event.status !== 'RECEIVED' && event.status !== 'FAILED') {
    return `Webhook event in status ${event.status} is not recoverable.`;
  }

  return null;
}

function getRecommendedAction(event: {
  topic: string;
  status: string;
  rawPayload: string | null;
  payloadHash: string | null;
  errorMessage: string | null;
}) {
  const recoverBlockedReason = getRecoverBlockedReason(event);
  const replayBlockedReason = getReplayBlockedReason(event);

  if (event.status === 'PROCESSED') {
    return 'No action needed. Event processed successfully.';
  }

  if (event.status === 'RECEIVED' && !recoverBlockedReason) {
    return 'Recover recommended: payload is stored and event is stuck in RECEIVED.';
  }

  if (event.status === 'FAILED' && !recoverBlockedReason) {
    return 'Recover recommended after confirming the root cause is resolved.';
  }

  if (event.status === 'FAILED' && !replayBlockedReason) {
    return 'Replay is available if idempotent reprocessing is intentional.';
  }

  if (!event.rawPayload) {
    return 'Manual investigation required because payload is unavailable.';
  }

  if (event.status === 'PROCESSING') {
    return 'Monitor processing before taking action.';
  }

  return event.errorMessage ? 'Review error summary before choosing recovery.' : 'Review event metadata.';
}

function buildWebhookDiagnosticsEvent(event: {
  id: string;
  topic: string;
  sourceShopDomain: string;
  webhookId: string | null;
  idempotencyKey: string | null;
  payloadHash: string | null;
  rawPayload: string | null;
  status: string;
  receivedAt: Date;
  processedAt: Date | null;
  errorMessage: string | null;
  shopifyOrder?: { sourceShopifyOrderId: string; sourceShopifyOrderNumber?: string | number | null } | null;
}): AdminWebhookDiagnosticsEvent {
  const replayBlockedReason = getReplayBlockedReason(event);
  const recoverBlockedReason = getRecoverBlockedReason(event);

  return {
    id: event.id,
    topic: event.topic,
    shopDomain: event.sourceShopDomain,
    shopifyWebhookId: event.webhookId,
    eventId: event.webhookId,
    idempotencyKey: event.idempotencyKey,
    payloadHash: event.payloadHash,
    status: event.status,
    processingStatus: event.status,
    receivedAt: event.receivedAt.toISOString(),
    processedAt: toIsoString(event.processedAt),
    errorMessage: event.errorMessage,
    lastErrorSummary: summarizeError(event.errorMessage),
    duplicate: false,
    payloadAvailable: Boolean(event.rawPayload),
    replayEligible: !replayBlockedReason,
    replayBlockedReason,
    recoverEligible: !recoverBlockedReason,
    recoverBlockedReason,
    recommendedAction: getRecommendedAction(event),
    affectedEntities: inferAffectedEntities(event),
    createdAt: toIsoString(event.receivedAt),
    updatedAt: toIsoString(event.processedAt ?? event.receivedAt),
  };
}

export async function listWebhookDiagnostics(): Promise<AdminWebhookDiagnosticsResponse> {
  const webhookEvents = await prisma.webhookEvent.findMany({
    include: {
      shopifyOrder: {
        select: {
          sourceShopifyOrderId: true,
          sourceShopifyOrderNumber: true,
        },
      },
    },
    orderBy: {
      receivedAt: 'desc',
    },
  });

  const events = webhookEvents.map(buildWebhookDiagnosticsEvent);

  return {
    summary: buildWebhookEventSummary(events),
    events,
  };
}

export async function getWebhookDiagnosticById(webhookEventId: string): Promise<AdminWebhookDiagnosticDetail | null> {
  const event = await prisma.webhookEvent.findUnique({
    where: {
      id: webhookEventId,
    },
    include: {
      shopifyOrder: {
        select: {
          sourceShopifyOrderId: true,
          sourceShopifyOrderNumber: true,
        },
      },
    },
  });

  if (!event) {
    return null;
  }

  const replayBlockedReason = getReplayBlockedReason(event);
  const recoverBlockedReason = getRecoverBlockedReason(event);
  const payloadPreview = buildPayloadPreview(event.rawPayload);

  return {
    id: event.id,
    topic: event.topic,
    shopDomain: event.sourceShopDomain,
    shopifyWebhookId: event.webhookId,
    eventId: event.webhookId,
    idempotencyKey: event.idempotencyKey,
    payloadHash: event.payloadHash,
    ...payloadPreview,
    payloadAvailable: Boolean(event.rawPayload),
    status: event.status,
    processingStatus: event.status,
    errorMessage: event.errorMessage,
    lastErrorSummary: summarizeError(event.errorMessage),
    replayEligible: !replayBlockedReason,
    replayBlockedReason,
    recoverEligible: !recoverBlockedReason,
    recoverBlockedReason,
    recommendedAction: getRecommendedAction(event),
    affectedEntities: inferAffectedEntities(event),
    receivedAt: event.receivedAt.toISOString(),
    processedAt: toIsoString(event.processedAt),
    createdAt: toIsoString(event.receivedAt),
    updatedAt: toIsoString(event.processedAt ?? event.receivedAt),
    relatedShopifyOrderId: event.shopifyOrder?.sourceShopifyOrderId ?? null,
  };
}

export async function listSyncDiagnostics(): Promise<SyncDiagnosticsResponse> {
  const [failedWebhookEvents, fulfillmentFailures] = await Promise.all([
    prisma.webhookEvent.findMany({
      where: {
        status: 'FAILED',
      },
      include: {
        shopifyOrder: {
          select: {
            sourceShopifyOrderId: true,
          },
        },
      },
      orderBy: {
        receivedAt: 'desc',
      },
    }),
    prisma.fulfillment.findMany({
      where: {
        syncStatus: 'fulfillment_sync_failed',
      },
      include: {
        vendorAllocation: {
          include: {
            order: {
              select: {
                sourceShopifyOrderId: true,
              },
            },
          },
        },
      },
      orderBy: {
        updatedAt: 'desc',
      },
    }),
  ]);

  const webhookItems: SyncDiagnosticItem[] = failedWebhookEvents.map((event) => ({
    id: `webhook-${event.id}`,
    type: 'webhook_ingestion_failure',
    severity: detectWebhookFailureSeverity(event.errorMessage),
    title: 'Webhook ingestion needs attention',
    description: event.errorMessage ?? 'Webhook event failed during verification or ingestion.',
    relatedWebhookEventId: event.id,
    relatedShopifyOrderId: event.shopifyOrder?.sourceShopifyOrderId ?? null,
    relatedAllocationId: null,
    status: event.status,
    createdAt: event.receivedAt.toISOString(),
  }));

  const fulfillmentItems: SyncDiagnosticItem[] = fulfillmentFailures.map((fulfillment) => ({
    id: `fulfillment-${fulfillment.id}`,
    type: 'fulfillment_sync_failed',
    severity: 'warning',
    title: 'Fulfillment sync failed',
    description: fulfillment.errorMessage ?? 'Shopify fulfillment tracking sync failed.',
    relatedWebhookEventId: null,
    relatedShopifyOrderId: fulfillment.vendorAllocation.order.sourceShopifyOrderId,
    relatedAllocationId: fulfillment.vendorAllocationId,
    status: fulfillment.syncStatus ?? 'fulfillment_sync_failed',
    createdAt: fulfillment.updatedAt.toISOString(),
  }));

  const items = [...webhookItems, ...fulfillmentItems].sort((a, b) => {
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  return {
    items,
  };
}

type ReplayPayloadResult =
  | {
      ok: true;
      payload: Record<string, unknown>;
    }
  | {
      ok: false;
      message: string;
    };

function parseStoredPayload(rawPayload: string | null): ReplayPayloadResult {
  if (!rawPayload) {
    return {
      ok: false,
      message: 'Webhook payload is not available for replay',
    };
  }

  try {
    return {
      ok: true,
      payload: JSON.parse(rawPayload) as Record<string, unknown>,
    };
  } catch {
    return {
      ok: false,
      message: 'Stored webhook payload is not valid JSON and cannot be replayed.',
    };
  }
}

async function markWebhookProcessing(eventId: string) {
  await prisma.webhookEvent.update({
    where: { id: eventId },
    data: {
      status: 'PROCESSING',
      errorMessage: null,
    },
  });
}

async function markWebhookFailed(eventId: string, message: string) {
  await prisma.webhookEvent.update({
    where: { id: eventId },
    data: {
      status: 'FAILED',
      errorMessage: message,
    },
  });
}

async function processWebhookEvent(
  env: AppEnv,
  event: WebhookEvent,
  payload: Record<string, unknown>,
): Promise<WebhookReplayResponse> {
  if (event.topic === 'orders/create') {
    const typedPayload = payload as ShopifyOrdersCreateWebhookPayload;
    const sourceShopifyOrderId =
      typedPayload.id !== undefined && typedPayload.id !== null ? String(typedPayload.id) : null;

    if (!sourceShopifyOrderId) {
      await markWebhookFailed(event.id, 'Shopify orders/create payload did not include an order id.');
      return {
        ok: true,
        topic: event.topic,
        action: 'received_needs_attention',
        processingStatus: 'needs_attention',
        message: 'Shopify orders/create payload did not include an order id.',
      };
    }

    const shopifyAdminService = createShopifyAdminService(env);
    const sellerInfoResult = await fetchSellerInfoWithRetry({
      orderId: sourceShopifyOrderId,
      fetchSellerInfo: shopifyAdminService.fetchOrderSellerInfo,
      delayMs: env.SHOPIFY_SELLER_INFO_RETRY_DELAY_MS,
    });

    if (!sellerInfoResult.ok) {
      await markWebhookFailed(event.id, sellerInfoResult.error);
      return {
        ok: true,
        topic: event.topic,
        action: 'received_needs_attention',
        processingStatus: 'needs_attention',
        message: sellerInfoResult.error,
      };
    }

    const ingestionResult = await ingestShopifyOrderWebhook({
      event,
      payload: typedPayload,
      sellerInfo: sellerInfoResult.sellerInfo,
    });

    return ingestionResult.ok
      ? {
          ok: true,
          topic: event.topic,
          action: ingestionResult.action,
          processingStatus: ingestionResult.processingStatus,
          shopifyOrderId: ingestionResult.shopifyOrderId,
          allocationCount: ingestionResult.allocationCount,
        }
      : {
          ok: true,
          topic: event.topic,
          action: ingestionResult.action,
          processingStatus: ingestionResult.processingStatus,
          message: ingestionResult.error,
        };
  }

  if (event.topic === 'refunds/create') {
    const ingestionResult = await ingestShopifyRefundWebhook({
      event,
      payload: payload as ShopifyRefundsCreateWebhookPayload,
    });

    return ingestionResult.ok
      ? {
          ok: true,
          topic: event.topic,
          action: ingestionResult.action,
          processingStatus: ingestionResult.processingStatus,
          shopifyOrderId: ingestionResult.shopifyOrderId,
          refundAllocationCount: ingestionResult.refundAllocationCount,
        }
      : {
          ok: true,
          topic: event.topic,
          action: ingestionResult.action,
          processingStatus: ingestionResult.processingStatus,
          message: ingestionResult.error,
        };
  }

  if (event.topic === 'returns/request') {
    const ingestionResult = await ingestReturnRequestWebhook(env, {
      event,
      payload: payload as ReturnLifecycleWebhookPayload,
    });

    return ingestionResult.ok
      ? {
          ok: true,
          topic: event.topic,
          action: ingestionResult.action,
          processingStatus: ingestionResult.processingStatus,
          affectedRecordCount: ingestionResult.affectedRecordCount,
        }
      : {
          ok: true,
          topic: event.topic,
          action: ingestionResult.action,
          processingStatus: ingestionResult.processingStatus,
          message: ingestionResult.error,
        };
  }

  if (
    event.topic === 'returns/approve' ||
    event.topic === 'returns/decline' ||
    event.topic === 'returns/close' ||
    event.topic === 'returns/cancel'
  ) {
    const ingestionResult = await applyReturnLifecycleStatusWebhook(event.topic, {
      event,
      payload: payload as ReturnLifecycleWebhookPayload,
    });

    return ingestionResult.ok
      ? {
          ok: true,
          topic: event.topic,
          action: ingestionResult.action,
          processingStatus: ingestionResult.processingStatus,
          affectedRecordCount: ingestionResult.affectedRecordCount,
        }
      : {
          ok: true,
          topic: event.topic,
          action: ingestionResult.action,
          processingStatus: ingestionResult.processingStatus,
          message: ingestionResult.error,
        };
  }

  if (
    event.topic === 'fulfillments/create' ||
    event.topic === 'fulfillments/update' ||
    event.topic === 'fulfillment_events/create' ||
    event.topic === 'fulfillment_orders/cancelled'
  ) {
    const ingestionResult = await ingestFulfillmentWebhook(env, {
      event,
      payload: payload as FulfillmentWebhookPayload,
      topic: event.topic as FulfillmentWebhookTopic,
    });

    return ingestionResult.ok
      ? {
          ok: true,
          topic: event.topic,
          action: ingestionResult.action,
          processingStatus: ingestionResult.processingStatus,
          shopifyOrderId: ingestionResult.shopifyOrderId,
          affectedAllocationCount: ingestionResult.affectedAllocationCount,
        }
      : {
          ok: true,
          topic: event.topic,
          action: ingestionResult.action,
          processingStatus: ingestionResult.processingStatus,
          message: ingestionResult.error,
        };
  }

  return {
    ok: true,
    topic: event.topic,
    action: 'not_recoverable',
    processingStatus: 'needs_attention',
    message: `Replay/recover is not supported for topic ${event.topic}.`,
  };
}

async function getWebhookStatus(webhookEventId: string) {
  const event = await prisma.webhookEvent.findUnique({
    where: {
      id: webhookEventId,
    },
    select: {
      status: true,
      errorMessage: true,
    },
  });

  return {
    afterStatus: event?.status ?? null,
    errorSummary: summarizeError(event?.errorMessage),
  };
}

function buildBlockedReplayResponse(input: {
  event: Pick<WebhookEvent, 'id' | 'topic' | 'status'> | null;
  action: 'replay' | 'recover';
  reason: string;
}) {
  return {
    ok: false,
    topic: input.event?.topic ?? 'unknown',
    webhookEventId: input.event?.id,
    action: input.action,
    beforeStatus: input.event?.status ?? null,
    afterStatus: input.event?.status ?? null,
    replayStatus: input.action === 'replay' ? 'not_replayable' : undefined,
    recoveryStatus: input.action === 'recover' ? 'not_recoverable' : undefined,
    processingStatus: 'not_recoverable',
    skippedReason: input.reason,
    message: input.reason,
  } satisfies WebhookReplayResponse;
}

export async function replayWebhookEvent(
  env: AppEnv,
  webhookEventId: string,
): Promise<
  | { ok: false; statusCode: 404 | 409; response: WebhookReplayResponse }
  | { ok: true; response: WebhookReplayResponse }
> {
  const event = await prisma.webhookEvent.findUnique({
    where: {
      id: webhookEventId,
    },
  });

  if (!event) {
    return {
      ok: false,
      statusCode: 404,
      response: buildBlockedReplayResponse({
        event: null,
        action: 'replay',
        reason: 'Webhook event not found.',
      }),
    };
  }

  const replayBlockedReason = getReplayBlockedReason(event);
  if (replayBlockedReason) {
    return {
      ok: false,
      statusCode: 409,
      response: buildBlockedReplayResponse({
        event,
        action: 'replay',
        reason: replayBlockedReason,
      }),
    };
  }

  const parsedPayload = parseStoredPayload(event.rawPayload);
  if (!parsedPayload.ok) {
    return {
      ok: false,
      statusCode: 409,
      response: buildBlockedReplayResponse({
        event,
        action: 'replay',
        reason: parsedPayload.message,
      }),
    };
  }

  const beforeStatus = event.status;
  const response = await processWebhookEvent(env, event, parsedPayload.payload);
  const { afterStatus, errorSummary } = await getWebhookStatus(event.id);
  const replayStatus: WebhookReplayResponse['replayStatus'] =
    response.processingStatus === 'processed' ? 'replayed' : 'failed';

  return {
    ok: true,
    response: {
      ...response,
      webhookEventId: event.id,
      beforeStatus,
      afterStatus,
      replayStatus,
      errorSummary,
    },
  };
}

export async function getReconciliationDiagnostics(): Promise<ReconciliationResponse> {
  const olderThan = new Date(Date.now() - 5 * 60 * 1000);
  const [stuckReceived, failedWebhookEvents, fulfillmentFailures, payloadUnknownEvents, staleAllocations] = await Promise.all([
    prisma.webhookEvent.findMany({
      where: {
        status: 'RECEIVED',
        receivedAt: {
          lt: olderThan,
        },
      },
      include: {
        shopifyOrder: {
          select: {
            sourceShopifyOrderId: true,
          },
        },
      },
      orderBy: {
        receivedAt: 'desc',
      },
    }),
    prisma.webhookEvent.findMany({
      where: {
        status: 'FAILED',
      },
      include: {
        shopifyOrder: {
          select: {
            sourceShopifyOrderId: true,
          },
        },
      },
      orderBy: {
        receivedAt: 'desc',
      },
    }),
    prisma.fulfillment.findMany({
      where: {
        syncStatus: 'fulfillment_sync_failed',
      },
      include: {
        vendorAllocation: {
          include: {
            order: {
              select: {
                sourceShopifyOrderId: true,
              },
            },
          },
        },
      },
      orderBy: {
        updatedAt: 'desc',
      },
    }),
    prisma.webhookEvent.findMany({
      where: {
        rawPayload: null,
      },
      include: {
        shopifyOrder: {
          select: {
            sourceShopifyOrderId: true,
          },
        },
      },
      orderBy: {
        receivedAt: 'desc',
      },
    }),
    prisma.vendorAllocation.findMany({
      where: {
        OR: [
          {
            fulfillmentStatus: {
              in: ['fulfilled', 'partially_fulfilled', 'fulfillment_submitted'],
            },
            fulfillment: null,
          },
          {
            trackingNumber: {
              not: null,
            },
            fulfillment: {
              syncStatus: {
                in: ['shopify_inbound_cancelled', 'shopify_reconciled_cancelled'],
              },
            },
          },
        ],
      },
      include: {
        order: {
          select: {
            sourceShopifyOrderId: true,
          },
        },
      },
      orderBy: {
        updatedAt: 'desc',
      },
    }),
  ]);

  const stuckItems: ReconciliationItem[] = stuckReceived.map((event) => ({
    id: `reconciliation-stuck-${event.id}`,
    type: 'stuck_webhook',
    severity: 'attention',
    title: 'Webhook event is stuck in received state',
    description: `Webhook ${event.topic} has remained in RECEIVED for more than 5 minutes.`,
    relatedWebhookEventId: event.id,
    relatedShopifyOrderId: event.shopifyOrder?.sourceShopifyOrderId ?? null,
    relatedAllocationId: null,
    status: event.status,
    createdAt: event.receivedAt.toISOString(),
    suggestedAction: event.rawPayload
      ? 'Use diagnostics recover endpoint to resume stuck processing.'
      : 'Payload missing. Manual recovery from Shopify source data is required.',
    payloadAvailable: Boolean(event.rawPayload),
  }));

  const failedItems: ReconciliationItem[] = failedWebhookEvents.map((event) => ({
    id: `reconciliation-failed-${event.id}`,
    type: 'failed_webhook',
    severity: detectWebhookFailureSeverity(event.errorMessage),
    title: 'Webhook processing failed',
    description: event.errorMessage ?? `Webhook ${event.topic} failed without a recorded error message.`,
    relatedWebhookEventId: event.id,
    relatedShopifyOrderId: event.shopifyOrder?.sourceShopifyOrderId ?? null,
    relatedAllocationId: null,
    status: event.status,
    createdAt: event.receivedAt.toISOString(),
    suggestedAction: event.rawPayload
      ? 'Use diagnostics recover/replay after confirming the mapping issue is resolved.'
      : 'Payload missing. Manual recovery from Shopify source data is required.',
    payloadAvailable: Boolean(event.rawPayload),
  }));

  const fulfillmentItems: ReconciliationItem[] = fulfillmentFailures.map((fulfillment) => ({
    id: `reconciliation-fulfillment-${fulfillment.id}`,
    type: 'fulfillment_sync_failed',
    severity: 'warning',
    title: 'Fulfillment sync failed',
    description: fulfillment.errorMessage ?? 'Fulfillment sync failed and needs manual review.',
    relatedWebhookEventId: null,
    relatedShopifyOrderId: fulfillment.vendorAllocation.order.sourceShopifyOrderId,
    relatedAllocationId: fulfillment.vendorAllocationId,
    status: fulfillment.syncStatus ?? 'fulfillment_sync_failed',
    createdAt: fulfillment.updatedAt.toISOString(),
    suggestedAction: 'Review fulfillment-order mapping and retry the tracking mutation manually.',
    payloadAvailable: null,
  }));

  const missingPayloadItems: ReconciliationItem[] = payloadUnknownEvents.map((event) => ({
    id: `reconciliation-payload-${event.id}`,
    type: 'missing_payload',
    severity: 'attention',
    title: 'Webhook payload is unavailable for replay',
    description: `Webhook ${event.topic} was persisted before raw payload retention was enabled or payload storage is missing.`,
    relatedWebhookEventId: event.id,
    relatedShopifyOrderId: event.shopifyOrder?.sourceShopifyOrderId ?? null,
    relatedAllocationId: null,
    status: event.status,
    createdAt: event.receivedAt.toISOString(),
    suggestedAction: 'Manual recovery required: payload unavailable for recover/replay.',
    payloadAvailable: false,
  }));

  const staleAllocationItems: ReconciliationItem[] = staleAllocations.map((allocation) => ({
    id: `reconciliation-stale-allocation-${allocation.id}`,
    type: 'stale_allocation',
    severity: 'attention',
    title: 'Allocation may be stale against Shopify',
    description: `Allocation ${allocation.id} has local fulfillment/tracking state that should be checked against canonical Shopify state.`,
    relatedWebhookEventId: null,
    relatedShopifyOrderId: allocation.order.sourceShopifyOrderId,
    relatedAllocationId: allocation.id,
    status: allocation.fulfillmentStatus,
    createdAt: allocation.updatedAt.toISOString(),
    suggestedAction: 'Run admin reconciliation to re-fetch canonical Shopify fulfillment state and repair safe local fields.',
    payloadAvailable: null,
  }));

  const items = [...stuckItems, ...failedItems, ...fulfillmentItems, ...missingPayloadItems, ...staleAllocationItems].sort((a, b) => {
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  return {
    summary: {
      stuckReceived: stuckItems.length,
      failedWebhooks: failedItems.length,
      fulfillmentSyncFailures: fulfillmentItems.length,
      missingPayload: missingPayloadItems.length,
      staleAllocations: staleAllocationItems.length,
      total: items.length,
    },
    items,
  };
}

export async function recoverWebhookEvent(
  env: AppEnv,
  webhookEventId: string,
): Promise<
  | { ok: false; statusCode: 404 | 409; response: WebhookRecoverResponse }
  | { ok: true; response: WebhookRecoverResponse }
> {
  const event = await prisma.webhookEvent.findUnique({
    where: { id: webhookEventId },
  });

  if (!event) {
    return {
      ok: false,
      statusCode: 404,
      response: {
        ...buildBlockedReplayResponse({
          event: null,
          action: 'recover',
          reason: 'Webhook event not found.',
        }),
        recoveryStatus: 'not_recoverable',
      },
    };
  }

  const recoverBlockedReason = getRecoverBlockedReason(event);
  if (recoverBlockedReason) {
    return {
      ok: false,
      statusCode: 409,
      response: {
        ...buildBlockedReplayResponse({
          event,
          action: 'recover',
          reason: recoverBlockedReason,
        }),
        recoveryStatus: 'not_recoverable',
      },
    };
  }

  const parsedPayload = parseStoredPayload(event.rawPayload);
  if (!parsedPayload.ok) {
    return {
      ok: false,
      statusCode: 409,
      response: {
        ...buildBlockedReplayResponse({
          event,
          action: 'recover',
          reason: parsedPayload.message,
        }),
        recoveryStatus: 'not_recoverable',
      },
    };
  }

  const beforeStatus = event.status;
  await markWebhookProcessing(event.id);

  const response = await processWebhookEvent(env, event, parsedPayload.payload);
  const { afterStatus, errorSummary } = await getWebhookStatus(event.id);
  const recoveryStatus: WebhookRecoverResponse['recoveryStatus'] =
    response.processingStatus === 'processed' ? 'recovered' : 'failed';

  return {
    ok: true,
    response: {
      ...response,
      webhookEventId: event.id,
      beforeStatus,
      afterStatus,
      recoveryStatus,
      errorSummary,
    },
  };
}
