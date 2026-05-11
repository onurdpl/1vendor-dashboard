import { prisma } from '../../db/prisma.js';
import type { AppEnv } from '../../config/env.js';
import { createShopifyAdminService } from '../shopify/shopify-admin.service.js';
import { fetchSellerInfoWithRetry } from '../shopify/seller-info-retry.service.js';
import { ingestShopifyOrderWebhook } from '../shopify/order-ingestion.service.js';
import { ingestShopifyRefundWebhook } from '../shopify/refund-ingestion.service.js';
import type { ShopifyOrdersCreateWebhookPayload } from '../shopify/order-ingestion.types.js';
import type { ShopifyRefundsCreateWebhookPayload } from '../shopify/refund-ingestion.types.js';
import type {
  AdminWebhookDiagnosticDetail,
  AdminWebhookDiagnosticsEvent,
  AdminWebhookDiagnosticsResponse,
  ReconciliationItem,
  ReconciliationResponse,
  SyncDiagnosticItem,
  SyncDiagnosticsResponse,
  SyncDiagnosticSeverity,
  WebhookReplayResponse,
} from './diagnostics.types.js';

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

function buildWebhookDiagnosticsEvent(event: {
  id: string;
  topic: string;
  sourceShopDomain: string;
  webhookId: string | null;
  idempotencyKey: string | null;
  rawPayload: string | null;
  status: string;
  receivedAt: Date;
  processedAt: Date | null;
  errorMessage: string | null;
}): AdminWebhookDiagnosticsEvent {
  return {
    id: event.id,
    topic: event.topic,
    shopDomain: event.sourceShopDomain,
    shopifyWebhookId: event.webhookId,
    idempotencyKey: event.idempotencyKey,
    status: event.status,
    receivedAt: event.receivedAt.toISOString(),
    processedAt: toIsoString(event.processedAt),
    errorMessage: event.errorMessage,
    duplicate: false,
    payloadAvailable: Boolean(event.rawPayload),
    createdAt: toIsoString(event.receivedAt),
    updatedAt: toIsoString(event.processedAt ?? event.receivedAt),
  };
}

export async function listWebhookDiagnostics(): Promise<AdminWebhookDiagnosticsResponse> {
  const webhookEvents = await prisma.webhookEvent.findMany({
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
        },
      },
    },
  });

  if (!event) {
    return null;
  }

  return {
    id: event.id,
    topic: event.topic,
    shopDomain: event.sourceShopDomain,
    shopifyWebhookId: event.webhookId,
    idempotencyKey: event.idempotencyKey,
    payloadHash: event.payloadHash,
    rawPayload: event.rawPayload,
    payloadAvailable: Boolean(event.rawPayload),
    status: event.status,
    errorMessage: event.errorMessage,
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
      payload: ShopifyOrdersCreateWebhookPayload | ShopifyRefundsCreateWebhookPayload;
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
      payload: JSON.parse(rawPayload) as ShopifyOrdersCreateWebhookPayload | ShopifyRefundsCreateWebhookPayload,
    };
  } catch {
    return {
      ok: false,
      message: 'Stored webhook payload is not valid JSON and cannot be replayed.',
    };
  }
}

export async function replayWebhookEvent(
  env: AppEnv,
  webhookEventId: string,
): Promise<
  | { ok: false; statusCode: 404 | 409; message: string }
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
      message: 'Webhook event not found.',
    };
  }

  if (event.topic !== 'orders/create' && event.topic !== 'refunds/create') {
    return {
      ok: false,
      statusCode: 409,
      message: `Replay is not supported for topic ${event.topic}.`,
    };
  }

  const parsedPayload = parseStoredPayload(event.rawPayload);
  if (!parsedPayload.ok) {
    return {
      ok: false,
      statusCode: 409,
      message: parsedPayload.message,
    };
  }

  if (event.topic === 'orders/create') {
    const payload = parsedPayload.payload as ShopifyOrdersCreateWebhookPayload;
    const sourceShopifyOrderId =
      payload.id !== undefined && payload.id !== null ? String(payload.id) : null;

    if (!sourceShopifyOrderId) {
      await prisma.webhookEvent.update({
        where: { id: event.id },
        data: {
          status: 'FAILED',
          errorMessage: 'Shopify orders/create payload did not include an order id.',
        },
      });

      return {
        ok: true,
        response: {
          ok: true,
          topic: event.topic,
          action: 'received_needs_attention',
          processingStatus: 'needs_attention',
          message: 'Shopify orders/create payload did not include an order id.',
        },
      };
    }

    const shopifyAdminService = createShopifyAdminService(env);
    const sellerInfoResult = await fetchSellerInfoWithRetry({
      orderId: sourceShopifyOrderId,
      fetchSellerInfo: shopifyAdminService.fetchOrderSellerInfo,
      delayMs: env.SHOPIFY_SELLER_INFO_RETRY_DELAY_MS,
    });

    if (!sellerInfoResult.ok) {
      await prisma.webhookEvent.update({
        where: { id: event.id },
        data: {
          status: 'FAILED',
          errorMessage: sellerInfoResult.error,
        },
      });

      return {
        ok: true,
        response: {
          ok: true,
          topic: event.topic,
          action: 'received_needs_attention',
          processingStatus: 'needs_attention',
          message: sellerInfoResult.error,
        },
      };
    }

    const ingestionResult = await ingestShopifyOrderWebhook({
      event,
      payload,
      sellerInfo: sellerInfoResult.sellerInfo,
    });

    return {
      ok: true,
      response: ingestionResult.ok
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
          },
    };
  }

  const ingestionResult = await ingestShopifyRefundWebhook({
    event,
    payload: parsedPayload.payload as ShopifyRefundsCreateWebhookPayload,
  });

  return {
    ok: true,
    response: ingestionResult.ok
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
        },
  };
}

export async function getReconciliationDiagnostics(): Promise<ReconciliationResponse> {
  const olderThan = new Date(Date.now() - 5 * 60 * 1000);
  const [stuckReceived, failedWebhookEvents, fulfillmentFailures, payloadUnknownEvents] = await Promise.all([
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
    suggestedAction: event.rawPayload ? 'Replay webhook event from diagnostics.' : 'Investigate source delivery and payload retention.',
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
    suggestedAction: event.rawPayload ? 'Replay after confirming the underlying mapping issue is resolved.' : 'Payload unavailable; inspect Shopify source event and diagnostics.',
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
    suggestedAction: 'Use Shopify source data and diagnostics to recover manually; replay is not available.',
    payloadAvailable: false,
  }));

  const items = [...stuckItems, ...failedItems, ...fulfillmentItems, ...missingPayloadItems].sort((a, b) => {
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  return {
    summary: {
      stuckReceived: stuckItems.length,
      failedWebhooks: failedItems.length,
      fulfillmentSyncFailures: fulfillmentItems.length,
      missingPayload: missingPayloadItems.length,
      total: items.length,
    },
    items,
  };
}
