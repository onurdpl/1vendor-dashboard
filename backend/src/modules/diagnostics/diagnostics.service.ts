import { OperationalJobStatus, OperationalJobType, type OperationalJob, type WebhookEvent } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import type { AppEnv } from '../../config/env.js';
import { buildFinanceAuditRuntimeMetadata } from '../../config/database-source-diagnostics.js';
import { logDashboardTiming, startDashboardTimer, withDashboardTiming } from '../../lib/dashboard-timing.js';
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
import {
  createOperationalJob,
  markOperationalJobCompleted,
  markOperationalJobFailed,
  markOperationalJobProcessing,
  markOperationalJobRetrying,
  serializeOperationalJob,
} from '../operational-jobs/operational-jobs.service.js';
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
  OperationalJobRetryResponse,
  WebhookReplayResponse,
  ReturnVisibilityDiagnostic,
} from './diagnostics.types.js';

const SHOPIFY_ORDER_WEBHOOK_ROUTES: Record<string, string> = {
  ORDERS_CREATE: '/webhooks/shopify/orders-create',
  ORDERS_PAID: '/webhooks/shopify/orders-paid',
  ORDERS_UPDATED: '/webhooks/shopify/orders-updated',
};

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

export type InvoiceExecutionCleanupReadinessClassification =
  | 'READY_TO_REMOVE'
  | 'ARCHIVE_REQUIRED'
  | 'REMOVED'
  | 'UNKNOWN';

const INVOICE_EXECUTION_REMOVED_MESSAGE =
  'Legacy InvoiceExecution schema was removed in C4 after production archive export.';

function toIsoString(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

function buildInvoiceExecutionRemovedDiagnosticBase(env: AppEnv) {
  const financeAuditMetadata = buildFinanceAuditRuntimeMetadata({
    environment: env.NODE_ENV,
    databaseUrl: env.DATABASE_URL,
    schemaReady: true,
  });
  const databaseIdentity = {
    databaseHost: financeAuditMetadata.databaseHost,
    databaseName: financeAuditMetadata.databaseName,
    databaseSourceLabel: financeAuditMetadata.databaseSourceLabel,
    schemaReady: financeAuditMetadata.schemaReady,
  };

  return {
    ok: true,
    writesPerformed: false,
    databaseIdentity,
    warnings: financeAuditMetadata.warnings,
  };
}

export async function getInvoiceExecutionCleanupReadiness(env: AppEnv) {
  const base = buildInvoiceExecutionRemovedDiagnosticBase(env);
  return {
    ...base,
    schemaRemoved: true,
    totalInvoiceExecutionRows: null,
    countsByProviderStatus: [],
    oldestCreatedAt: null,
    newestCreatedAt: null,
    rowsExist: false,
    cleanupReadiness: 'REMOVED' as const,
    archiveRequired: false,
    message: INVOICE_EXECUTION_REMOVED_MESSAGE,
    error: null,
  };
}

export async function getInvoiceExecutionArchiveDiagnostic(env: AppEnv) {
  const generatedAt = new Date().toISOString();
  const base = buildInvoiceExecutionRemovedDiagnosticBase(env);
  return {
    ...base,
    schemaRemoved: true,
    archiveMetadata: {
      generatedAt,
      totalRows: 0,
      writesPerformed: false,
    },
    archiveStatus: 'NOT_APPLICABLE' as const,
    rows: [],
    message: INVOICE_EXECUTION_REMOVED_MESSAGE,
    error: null,
  };
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

function normalizeEntryType(value: string) {
  return value.trim().toLowerCase();
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
  rawPayload?: string | null;
  shopifyOrder?: { sourceShopifyOrderId: string; sourceShopifyOrderNumber?: string | number | null } | null;
}) {
  const payload = parsePayloadForHints(event.rawPayload ?? null);
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
  rawPayload?: string | null;
  payloadAvailable?: boolean;
  payloadHash: string | null;
}) {
  if (!SUPPORTED_REPLAY_TOPICS.has(event.topic)) {
    return `Replay is not supported for topic ${event.topic}.`;
  }

  if (!(event.payloadAvailable ?? Boolean(event.rawPayload))) {
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
  rawPayload?: string | null;
  payloadAvailable?: boolean;
  payloadHash: string | null;
}) {
  if (!SUPPORTED_RECOVER_TOPICS.has(event.topic)) {
    return `Recover is not supported for topic ${event.topic}.`;
  }

  if (!(event.payloadAvailable ?? Boolean(event.rawPayload))) {
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
  rawPayload?: string | null;
  payloadAvailable?: boolean;
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

  if (!(event.payloadAvailable ?? Boolean(event.rawPayload))) {
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
  rawPayload?: string | null;
  payloadAvailable?: boolean;
  status: string;
  receivedAt: Date;
  processedAt: Date | null;
  errorMessage: string | null;
  shopifyOrder?: { sourceShopifyOrderId: string; sourceShopifyOrderNumber?: string | number | null } | null;
  operationalJobs?: OperationalJob[];
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
    payloadAvailable: event.payloadAvailable ?? Boolean(event.rawPayload),
    replayEligible: !replayBlockedReason,
    replayBlockedReason,
    recoverEligible: !recoverBlockedReason,
    recoverBlockedReason,
    recommendedAction: getRecommendedAction(event),
    affectedEntities: inferAffectedEntities(event),
    relatedJobs: (event.operationalJobs ?? []).map(serializeOperationalJob),
    createdAt: toIsoString(event.receivedAt),
    updatedAt: toIsoString(event.processedAt ?? event.receivedAt),
  };
}

export async function listWebhookDiagnostics(options: { limit?: number; offset?: number } = {}): Promise<AdminWebhookDiagnosticsResponse> {
  const webhookEvents = await prisma.webhookEvent.findMany({
    select: {
      id: true,
      topic: true,
      sourceShopDomain: true,
      webhookId: true,
      idempotencyKey: true,
      payloadHash: true,
      status: true,
      receivedAt: true,
      processedAt: true,
      errorMessage: true,
      shopifyOrder: {
        select: {
          sourceShopifyOrderId: true,
          sourceShopifyOrderNumber: true,
        },
      },
      operationalJobs: {
        orderBy: {
          createdAt: 'desc',
        },
        take: 5,
      },
    },
    orderBy: {
      receivedAt: 'desc',
    },
    take: options.limit ?? 100,
    skip: options.offset ?? 0,
  });

  const events = webhookEvents.map((event) =>
    buildWebhookDiagnosticsEvent({
      ...event,
      payloadAvailable: Boolean(event.payloadHash),
    }),
  );

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
      operationalJobs: {
        orderBy: {
          createdAt: 'desc',
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
    relatedJobs: event.operationalJobs.map(serializeOperationalJob),
    receivedAt: event.receivedAt.toISOString(),
    processedAt: toIsoString(event.processedAt),
    createdAt: toIsoString(event.receivedAt),
    updatedAt: toIsoString(event.processedAt ?? event.receivedAt),
    relatedShopifyOrderId: event.shopifyOrder?.sourceShopifyOrderId ?? null,
  };
}

function normalizeDiagnosticOrderNumber(value: string) {
  const trimmed = value.trim();
  return {
    plain: trimmed.replace(/^#/, ''),
    hash: trimmed.startsWith('#') ? trimmed : `#${trimmed}`,
  };
}

function parseDiagnosticPayload(rawPayload: string | null | undefined) {
  if (!rawPayload?.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawPayload) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function readDiagnosticRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function readDiagnosticString(value: Record<string, unknown> | null | undefined, keys: string[]) {
  if (!value) {
    return null;
  }

  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      return String(candidate);
    }
  }

  return null;
}

function readRuntimeEnvString(key: string) {
  const value = process.env[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function resolveExpectedOrderWebhookBaseUrl() {
  return readRuntimeEnvString('SHOPIFY_ORDER_WEBHOOK_BASE_URL')?.replace(/\/+$/, '') ?? null;
}

function normalizeWebhookTopic(value: string | null | undefined) {
  return value?.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_') ?? '';
}

function routeForShopifyTopic(topic: string) {
  return SHOPIFY_ORDER_WEBHOOK_ROUTES[normalizeWebhookTopic(topic)] ?? null;
}

function callbackMatchesExpectedRoute(input: { topic: string; callbackUrl: string; expectedBaseUrl: string | null }) {
  const routePath = routeForShopifyTopic(input.topic);
  if (!routePath) {
    return false;
  }

  if (input.expectedBaseUrl) {
    return input.callbackUrl === `${input.expectedBaseUrl}${routePath}`;
  }

  try {
    return new URL(input.callbackUrl).pathname === routePath;
  } catch {
    return false;
  }
}

function readGraphqlErrorMessage(value: unknown) {
  if (!Array.isArray(value)) {
    return null;
  }

  const messages = value
    .map((entry) => readDiagnosticRecord(entry))
    .map((entry) => readDiagnosticString(entry, ['message']))
    .filter((message): message is string => Boolean(message));
  return messages.join('; ') || null;
}

const DISTRICT_CANDIDATE_KEYS = [
  'district',
  'district_name',
  'districtName',
  'city_area',
  'cityArea',
  'county',
  'county_name',
  'countyName',
  'address2',
  'province',
  'province_name',
  'provinceName',
] as const;

function isDiagnosticTurkeyAddress(address: Record<string, unknown> | null) {
  const countryCode = readDiagnosticString(address, ['country_code'])?.toUpperCase();
  if (countryCode === 'TR') {
    return true;
  }

  const country = readDiagnosticString(address, ['country'])?.toLocaleLowerCase('tr-TR');
  return country === 'turkey' || country === 'türkiye' || country === 'turkiye';
}

function readRawDistrictCandidate(address: Record<string, unknown> | null, prefix: 'shipping_address' | 'billing_address') {
  if (!address) {
    return null;
  }

  for (const key of DISTRICT_CANDIDATE_KEYS) {
    if (key === 'address2' && !isDiagnosticTurkeyAddress(address)) {
      continue;
    }
    const value = readDiagnosticString(address, [key]);
    if (value) {
      return {
        field: `${prefix}.${key}`,
        value,
      };
    }
  }

  return null;
}

function buildRawDistrictCandidateKeyPresence(address: Record<string, unknown> | null) {
  return Object.fromEntries(
    DISTRICT_CANDIDATE_KEYS.map((key) => [
      key,
      key === 'address2' ? isDiagnosticTurkeyAddress(address) && Boolean(readDiagnosticString(address, [key])) : Boolean(readDiagnosticString(address, [key])),
    ]),
  );
}

function findPersistedDistrictSource(input: {
  persistedValue: string | null;
  address: Record<string, unknown> | null;
  prefix: 'shipping_address' | 'billing_address';
}) {
  const persistedValue = input.persistedValue?.trim();
  if (!persistedValue) {
    return null;
  }

  const rawSource = readRawDistrictCandidate(input.address, input.prefix);
  if (rawSource?.value === persistedValue) {
    return rawSource;
  }

  return {
    field: input.prefix === 'shipping_address' ? 'ShopifyOrder.shippingDistrict' : 'ShopifyOrder.billingDistrict',
    value: persistedValue,
  };
}

function readKargonomiDiagnosticId(value: unknown, keys: string[]) {
  const text = readDiagnosticString(readDiagnosticRecord(value), keys);
  if (!text) {
    return null;
  }

  const numeric = Number(text);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function buildReturnSenderPreviewDiagnostic(input: {
  shippingDistrict: string | null;
  billingDistrict: string | null;
  rawDistrict: string | null;
  configMetadata: unknown;
}) {
  const senderDistrict = input.shippingDistrict?.trim() || input.billingDistrict?.trim() || input.rawDistrict?.trim() || null;
  const senderStateId = readKargonomiDiagnosticId(input.configMetadata, [
    'kargonomiReturnSenderStateId',
    'returnSenderStateId',
    'fallbackBuyerStateId',
    'buyerStateId',
    'buyer_state_id',
  ]);
  const senderCityId = readKargonomiDiagnosticId(input.configMetadata, [
    'kargonomiReturnSenderCityId',
    'returnSenderCityId',
    'fallbackBuyerCityId',
    'buyerCityId',
    'buyer_city_id',
  ]);

  return {
    senderCityIdPresent: Boolean(senderCityId),
    senderStateIdPresent: Boolean(senderStateId),
    senderDistrictPresent: Boolean(senderDistrict),
    senderDestinationResolution: {
      source: senderCityId || senderStateId ? 'metadata_ids_no_lookup' : 'stored_order_fields_no_lookup',
      senderCityIdPresent: Boolean(senderCityId),
      senderStateIdPresent: Boolean(senderStateId),
      senderDistrictPresent: Boolean(senderDistrict),
      lookupAttempted: false,
      reason: senderDistrict ? null : 'missing_district_text',
    },
  };
}

export async function getOrderDistrictReadinessDiagnostic(orderNumber: string) {
  const normalized = normalizeDiagnosticOrderNumber(orderNumber);
  const order = await prisma.shopifyOrder.findFirst({
    where: {
      sourceShopifyOrderNumber: {
        in: [normalized.plain, normalized.hash],
      },
    },
    include: {
      webhookEvents: {
        where: {
          topic: 'orders/create',
          rawPayload: {
            not: null,
          },
        },
        orderBy: [
          {
            processedAt: 'desc',
          },
          {
            receivedAt: 'desc',
          },
        ],
        take: 1,
        select: {
          rawPayload: true,
        },
      },
      allocations: {
        select: {
          id: true,
          assignedVendorId: true,
          returnRecords: {
            select: {
              id: true,
            },
          },
        },
      },
    },
  });

  if (!order) {
    return null;
  }

  const payload = parseDiagnosticPayload(order.webhookEvents[0]?.rawPayload);
  const shippingAddress = readDiagnosticRecord(payload?.shipping_address);
  const billingAddress = readDiagnosticRecord(payload?.billing_address);
  const rawShippingDistrict = readRawDistrictCandidate(shippingAddress, 'shipping_address');
  const rawBillingDistrict = readRawDistrictCandidate(billingAddress, 'billing_address');
  const rawDistrict = rawShippingDistrict ?? rawBillingDistrict;
  const districtSource =
    findPersistedDistrictSource({
      persistedValue: order.shippingDistrict,
      address: shippingAddress,
      prefix: 'shipping_address',
    }) ??
    findPersistedDistrictSource({
      persistedValue: order.billingDistrict,
      address: billingAddress,
      prefix: 'billing_address',
    }) ??
    rawDistrict;
  const returnIds = order.allocations.flatMap((allocation) => allocation.returnRecords.map((record) => record.id));
  const firstReturnAllocation = order.allocations.find((allocation) => allocation.returnRecords.length > 0) ?? null;
  const config = firstReturnAllocation
    ? await prisma.vendorShippingConfig.findUnique({
        where: {
          vendorId: firstReturnAllocation.assignedVendorId,
        },
        select: {
          providerMetadata: true,
        },
      })
    : null;

  return {
    ok: true,
    orderNumber: order.sourceShopifyOrderNumber,
    orderId: order.id,
    allocationIds: order.allocations.map((allocation) => allocation.id),
    returnIds,
    shippingDistrict: order.shippingDistrict,
    billingDistrict: order.billingDistrict,
    shippingCity: order.shippingCity,
    billingCity: order.billingCity,
    shippingProvince: readDiagnosticString(shippingAddress, ['province', 'province_name', 'provinceName']),
    billingProvince: readDiagnosticString(billingAddress, ['province', 'province_name', 'provinceName']),
    districtPresent: Boolean(order.shippingDistrict?.trim() || order.billingDistrict?.trim() || rawDistrict?.value),
    districtSourceField: districtSource?.field ?? null,
    districtSourceValue: districtSource?.value ?? null,
    rawDistrictCandidateKeysPresent: {
      shipping_address: buildRawDistrictCandidateKeyPresence(shippingAddress),
      billing_address: buildRawDistrictCandidateKeyPresence(billingAddress),
    },
    kargonomiReturnSenderPreview: returnIds.length
      ? buildReturnSenderPreviewDiagnostic({
          shippingDistrict: order.shippingDistrict,
          billingDistrict: order.billingDistrict,
          rawDistrict: rawDistrict?.value ?? null,
          configMetadata: config?.providerMetadata ?? null,
        })
      : undefined,
  };
}

type AddressPersistenceComparison = 'yes' | 'no' | 'unknown';

const SAFE_ADDRESS_VALUE_KEYS = [
  'district',
  'district_name',
  'districtName',
  'city_area',
  'cityArea',
  'county',
  'county_name',
  'countyName',
  'province',
  'province_name',
  'provinceName',
  'province_code',
  'provinceCode',
  'address',
  'address1',
  'address2',
  'company',
  'city',
  'zip',
  'postcode',
  'country',
  'country_code',
  'countryCode',
] as const;

const SAFE_ADDRESS_PRESENCE_KEYS = [
  'latitude',
  'longitude',
  'lat',
  'lng',
] as const;

function readAddressObjectKeys(address: Record<string, unknown> | null) {
  return address ? Object.keys(address).sort() : [];
}

function readSafeAddressValueMap(address: Record<string, unknown> | null) {
  return Object.fromEntries(
    SAFE_ADDRESS_VALUE_KEYS.map((key) => [key, readDiagnosticString(address, [key])]),
  );
}

function readSafeAddressPresenceMap(address: Record<string, unknown> | null) {
  return Object.fromEntries(
    SAFE_ADDRESS_PRESENCE_KEYS.map((key) => [key, address ? address[key] !== undefined && address[key] !== null : false]),
  );
}

function readSafeLocalizedOrCustomAddressFields(address: Record<string, unknown> | null) {
  if (!address) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(address)
      .filter(([key]) => /locali[sz]ed|custom/i.test(key))
      .map(([key, value]) => {
        if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
          return [key, value];
        }

        if (Array.isArray(value)) {
          return [key, { present: true, type: 'array', length: value.length }];
        }

        if (typeof value === 'object') {
          return [key, { present: true, type: 'object', keys: Object.keys(value as Record<string, unknown>).sort() }];
        }

        return [key, { present: true, type: typeof value }];
      }),
  );
}

function readSafeAddressFields(address: Record<string, unknown> | null) {
  return {
    keys: readAddressObjectKeys(address),
    ...readSafeAddressValueMap(address),
    address1: readDiagnosticString(address, ['address1']),
    address2: readDiagnosticString(address, ['address2']),
    city: readDiagnosticString(address, ['city']),
    province: readDiagnosticString(address, ['province', 'province_name', 'provinceName']),
    province_code: readDiagnosticString(address, ['province_code', 'provinceCode']),
    zip: readDiagnosticString(address, ['zip', 'postcode']),
    country: readDiagnosticString(address, ['country']),
    country_code: readDiagnosticString(address, ['country_code', 'countryCode']),
    company: readDiagnosticString(address, ['company']),
    coordinatePresence: readSafeAddressPresenceMap(address),
    localizedOrCustomFields: readSafeLocalizedOrCustomAddressFields(address),
    phonePresent: Boolean(readDiagnosticString(address, ['phone'])),
  };
}

function addressValuePresent(value: string | null | undefined) {
  return Boolean(value?.trim());
}

function composeRawAddress(address: Record<string, unknown> | null) {
  const direct = readDiagnosticString(address, ['address']);
  if (direct) {
    return direct;
  }

  const parts = [
    readDiagnosticString(address, ['address1']),
    readDiagnosticString(address, ['address2']),
  ].filter((part): part is string => Boolean(part));
  return parts.join(', ') || null;
}

function comparePersistedValue(persisted: string | null, raw: string | null): AddressPersistenceComparison {
  if (!raw) {
    return 'unknown';
  }

  return persisted?.trim() === raw.trim() ? 'yes' : 'no';
}

function compareBillingAddressPersistence(input: {
  persistedAddress1: string | null;
  persistedAddress2: string | null;
  rawAddress: Record<string, unknown> | null;
}): AddressPersistenceComparison {
  const rawAddress1 = readDiagnosticString(input.rawAddress, ['address1']);
  const rawAddress2 = readDiagnosticString(input.rawAddress, ['address2']);
  if (!rawAddress1 && !rawAddress2) {
    return 'unknown';
  }

  return input.persistedAddress1?.trim() === (rawAddress1 ?? '') &&
    (input.persistedAddress2?.trim() || null) === (rawAddress2 ?? null)
    ? 'yes'
    : 'no';
}

function getShippingDistrictSource(address: Record<string, unknown> | null): 'address2' | 'district' | 'province' | 'missing' | 'unknown' {
  if (!address) {
    return 'unknown';
  }

  if (
    readDiagnosticString(address, ['district']) ||
    readDiagnosticString(address, ['district_name', 'districtName']) ||
    readDiagnosticString(address, ['city_area', 'cityArea'])
  ) {
    return 'district';
  }

  if (isDiagnosticTurkeyAddress(address) && readDiagnosticString(address, ['address2'])) {
    return 'address2';
  }

  if (readDiagnosticString(address, ['province', 'province_name', 'provinceName'])) {
    return 'province';
  }

  return 'missing';
}

function hasRawAddressData(address: Record<string, unknown> | null) {
  return Boolean(
    readDiagnosticString(address, ['address', 'address1', 'address2', 'city', 'province', 'zip', 'postcode', 'country', 'country_code', 'company']),
  );
}

function isPlaceholderAddressValue(value: string | null | undefined) {
  const normalized = value?.replace(/\s+/g, ' ').trim().toLowerCase();
  return (
    !normalized ||
    normalized === 'null' ||
    normalized === '-' ||
    /^(?:na|n\/a)(?: (?:na|n\/a))*$/.test(normalized)
  );
}

function hasUsableAddressHistoryData(address: SafeAddressHistoryFields | null) {
  if (!address) {
    return false;
  }

  return [address.address1, address.address2, address.city, address.province, address.zip, address.country].some(
    (value) => !isPlaceholderAddressValue(value),
  );
}

function deriveAddressPersistenceRootCause(input: {
  rawShippingAddress: Record<string, unknown> | null;
  rawBillingAddress: Record<string, unknown> | null;
  persistedShippingAny: boolean;
  persistedBillingAny: boolean;
  shippingAddressPersistedFromRaw: AddressPersistenceComparison;
  shippingCityPersistedFromRaw: AddressPersistenceComparison;
  billingAddressPersistedFromRaw: AddressPersistenceComparison;
}) {
  const rawPresent = hasRawAddressData(input.rawShippingAddress) || hasRawAddressData(input.rawBillingAddress);
  if (!rawPresent) {
    return 'raw_missing' as const;
  }

  if (!input.persistedShippingAny && !input.persistedBillingAny) {
    return 'persistence_missing' as const;
  }

  if (
    input.shippingAddressPersistedFromRaw === 'no' ||
    input.shippingCityPersistedFromRaw === 'no' ||
    input.billingAddressPersistedFromRaw === 'no'
  ) {
    return 'ingestion_missing' as const;
  }

  if (input.persistedShippingAny || input.persistedBillingAny) {
    return 'rendering_issue' as const;
  }

  return 'unknown' as const;
}

function readSafeAddressHistoryFields(address: Record<string, unknown> | null) {
  return {
    keys: readAddressObjectKeys(address),
    ...readSafeAddressValueMap(address),
    address1: readDiagnosticString(address, ['address1']),
    address2: readDiagnosticString(address, ['address2']),
    city: readDiagnosticString(address, ['city']),
    province: readDiagnosticString(address, ['province', 'province_name', 'provinceName']),
    province_code: readDiagnosticString(address, ['province_code', 'provinceCode']),
    zip: readDiagnosticString(address, ['zip', 'postcode']),
    country: readDiagnosticString(address, ['country']),
    country_code: readDiagnosticString(address, ['country_code', 'countryCode']),
    coordinatePresence: readSafeAddressPresenceMap(address),
    localizedOrCustomFields: readSafeLocalizedOrCustomAddressFields(address),
  };
}

type SafeAddressHistoryFields = ReturnType<typeof readSafeAddressHistoryFields>;

function addressHistoryFieldsEqual(left: SafeAddressHistoryFields | null, right: SafeAddressHistoryFields | null) {
  if (!left || !right) {
    return false;
  }

  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  return SAFE_ADDRESS_VALUE_KEYS.every((key) => {
    const leftRaw = leftRecord[key];
    const rightRaw = rightRecord[key];
    const leftValue = typeof leftRaw === 'string' ? leftRaw.trim() || null : leftRaw ?? null;
    const rightValue = typeof rightRaw === 'string' ? rightRaw.trim() || null : rightRaw ?? null;
    return leftValue === rightValue;
  });
}

function currentPersistedShippingFieldsMatchWebhook(
  persisted: {
    shippingAddress: string | null;
    shippingCity: string | null;
    shippingPostcode: string | null;
    shippingCountry: string | null;
  },
  webhookShipping: SafeAddressHistoryFields | null,
) {
  if (!webhookShipping) {
    return false;
  }

  return (
    comparePersistedValue(persisted.shippingAddress, [webhookShipping.address1, webhookShipping.address2].filter(Boolean).join(', ') || null) === 'yes' &&
    comparePersistedValue(persisted.shippingCity, webhookShipping.city) === 'yes' &&
    comparePersistedValue(persisted.shippingPostcode, webhookShipping.zip) === 'yes'
  );
}

function payloadMatchesOrder(payload: Record<string, unknown> | null, order: {
  sourceShopifyOrderId: string;
  sourceShopifyOrderNumber: string;
}) {
  const affected = inferAffectedEntities({ topic: 'orders/create', rawPayload: payload ? JSON.stringify(payload) : null });
  const hint = getPayloadOrderHint(payload);
  return [hint, affected.shopifyOrderId, affected.shopifyOrderNumber]
    .filter((value): value is string => Boolean(value))
    .some((value) => {
      const normalized = value.replace(/^#/, '');
      return (
        value === order.sourceShopifyOrderId ||
        value === order.sourceShopifyOrderNumber ||
        normalized === order.sourceShopifyOrderNumber.replace(/^#/, '') ||
        normalized === order.sourceShopifyOrderId
      );
    });
}

function isOrderAddressHistoryTopic(topic: string) {
  const normalized = topic.toLowerCase();
  return normalized.startsWith('orders/') || normalized.includes('order/edit') || normalized.includes('order_update');
}

function deriveAddressHistoryRootCause(input: {
  firstCreateShipping: SafeAddressHistoryFields | null;
  latestUpdateShipping: SafeAddressHistoryFields | null;
  ordersUpdatedExists: boolean;
  addressChangedAfterCreate: boolean;
  persistedMatchesLatestWebhook: boolean;
  persistedMatchesFirstCreate: boolean;
}) {
  if (input.ordersUpdatedExists && input.addressChangedAfterCreate && !input.persistedMatchesLatestWebhook) {
    return 'update_ignored' as const;
  }

  if (input.ordersUpdatedExists && input.persistedMatchesLatestWebhook) {
    return 'update_processed' as const;
  }

  if (!input.ordersUpdatedExists && !hasUsableAddressHistoryData(input.firstCreateShipping)) {
    return 'create_payload_missing' as const;
  }

  if (input.latestUpdateShipping && !input.persistedMatchesLatestWebhook) {
    return 'persistence_issue' as const;
  }

  if (input.persistedMatchesLatestWebhook || (!input.latestUpdateShipping && input.persistedMatchesFirstCreate)) {
    return 'rendering_issue' as const;
  }

  return 'unknown' as const;
}

export async function getOrderAddressPersistenceDiagnostic(orderNumber: string) {
  const normalized = normalizeDiagnosticOrderNumber(orderNumber);
  const order = await prisma.shopifyOrder.findFirst({
    where: {
      OR: [
        {
          sourceShopifyOrderNumber: {
            in: [normalized.plain, normalized.hash],
          },
        },
        {
          sourceShopifyOrderId: normalized.plain,
        },
      ],
    },
    select: {
      id: true,
      sourceShopifyOrderId: true,
      sourceShopifyOrderNumber: true,
      customerPhone: true,
      billingFullName: true,
      billingCompany: true,
      billingPhone: true,
      billingCity: true,
      billingDistrict: true,
      billingAddress1: true,
      billingAddress2: true,
      billingPostcode: true,
      shippingCountry: true,
      shippingPostcode: true,
      shippingCity: true,
      shippingDistrict: true,
      shippingAddress: true,
      webhookEvents: {
        where: {
          topic: 'orders/create',
          rawPayload: {
            not: null,
          },
        },
        orderBy: [
          {
            processedAt: 'desc',
          },
          {
            receivedAt: 'desc',
          },
        ],
        take: 1,
        select: {
          rawPayload: true,
        },
      },
    },
  });

  if (!order) {
    return null;
  }

  const payload = parseDiagnosticPayload(order.webhookEvents[0]?.rawPayload);
  const shippingAddress = readDiagnosticRecord(payload?.shipping_address);
  const billingAddress = readDiagnosticRecord(payload?.billing_address);
  const rawShippingAddress = readSafeAddressFields(shippingAddress);
  const rawBillingAddress = readSafeAddressFields(billingAddress);
  const shippingAddressPersistedFromRaw = comparePersistedValue(order.shippingAddress, composeRawAddress(shippingAddress));
  const shippingCityPersistedFromRaw = comparePersistedValue(
    order.shippingCity,
    readDiagnosticString(shippingAddress, ['city']),
  );
  const billingAddressPersistedFromRaw = compareBillingAddressPersistence({
    persistedAddress1: order.billingAddress1,
    persistedAddress2: order.billingAddress2,
    rawAddress: billingAddress,
  });
  const persistedShippingFields = {
    shippingAddress: order.shippingAddress,
    shippingCity: order.shippingCity,
    shippingDistrict: order.shippingDistrict,
    shippingPostcode: order.shippingPostcode,
    shippingCountry: order.shippingCountry,
    customerPhonePresent: Boolean(order.customerPhone?.trim()),
  };
  const persistedBillingFields = {
    billingFullName: order.billingFullName,
    billingCompany: order.billingCompany,
    billingPhonePresent: Boolean(order.billingPhone?.trim()),
    billingCity: order.billingCity,
    billingDistrict: order.billingDistrict,
    billingAddress1: order.billingAddress1,
    billingAddress2: order.billingAddress2,
    billingPostcode: order.billingPostcode,
  };

  const persistedShippingAny = Object.values(persistedShippingFields).some((value) =>
    typeof value === 'boolean' ? value : addressValuePresent(value),
  );
  const persistedBillingAny = Object.values(persistedBillingFields).some((value) =>
    typeof value === 'boolean' ? value : addressValuePresent(value),
  );

  return {
    ok: true,
    orderNumber: order.sourceShopifyOrderNumber,
    orderId: order.id,
    shopifyOrderId: order.sourceShopifyOrderId,
    persistedShippingFields,
    persistedBillingFields,
    rawOrdersCreateWebhook: {
      shipping_address: rawShippingAddress,
      billing_address: rawBillingAddress,
    },
    derived: {
      shippingAddressPersistedFromRaw,
      shippingCityPersistedFromRaw,
      shippingDistrictSource: getShippingDistrictSource(shippingAddress),
      billingAddressPersistedFromRaw,
      likelyRootCause: deriveAddressPersistenceRootCause({
        rawShippingAddress: shippingAddress,
        rawBillingAddress: billingAddress,
        persistedShippingAny,
        persistedBillingAny,
        shippingAddressPersistedFromRaw,
        shippingCityPersistedFromRaw,
        billingAddressPersistedFromRaw,
      }),
    },
  };
}

export async function listShopifyWebhookSubscriptionDiagnostics(env: AppEnv) {
  const expectedOrderWebhookBaseUrl = resolveExpectedOrderWebhookBaseUrl();
  const config = {
    shopDomainConfigured: Boolean(env.SHOPIFY_SHOP_DOMAIN),
    adminAccessTokenConfigured: Boolean(env.SHOPIFY_ADMIN_ACCESS_TOKEN),
    apiVersion: env.SHOPIFY_API_VERSION,
    expectedOrderWebhookBaseUrl,
  };

  if (!env.SHOPIFY_SHOP_DOMAIN || !env.SHOPIFY_ADMIN_ACCESS_TOKEN) {
    return {
      ok: false,
      config,
      subscriptions: [],
      derived: {
        ordersCreateSubscribed: false,
        ordersUpdatedSubscribed: false,
        ordersUpdatedCallbackMatchesExpected: false,
        likelyRootCause: 'unknown' as const,
      },
      error: 'Shopify Admin API configuration is missing.',
    };
  }

  const edges: unknown[] = [];
  let hasNextPage = true;
  let cursor: string | null = null;

  while (hasNextPage) {
    const response = await fetch(
      `https://${env.SHOPIFY_SHOP_DOMAIN}/admin/api/${env.SHOPIFY_API_VERSION}/graphql.json`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-shopify-access-token': env.SHOPIFY_ADMIN_ACCESS_TOKEN,
        },
        body: JSON.stringify({
          query: `
            query WebhookSubscriptions($after: String) {
              webhookSubscriptions(first: 100, after: $after) {
                edges {
                  cursor
                  node {
                    id
                    topic
                    endpoint {
                      __typename
                      ... on WebhookHttpEndpoint {
                        callbackUrl
                      }
                    }
                  }
                }
                pageInfo {
                  hasNextPage
                }
              }
            }
          `,
          variables: {
            after: cursor,
          },
        }),
      },
    );

    if (!response.ok) {
      return {
        ok: false,
        config,
        subscriptions: [],
        derived: {
          ordersCreateSubscribed: false,
          ordersUpdatedSubscribed: false,
          ordersUpdatedCallbackMatchesExpected: false,
          likelyRootCause: 'unknown' as const,
        },
        error: `Shopify Admin API webhook subscription query failed with status ${response.status}.`,
      };
    }

    const payload = await response.json() as Record<string, unknown>;
    const graphqlError = readGraphqlErrorMessage(payload.errors);
    if (graphqlError) {
      return {
        ok: false,
        config,
        subscriptions: [],
        derived: {
          ordersCreateSubscribed: false,
          ordersUpdatedSubscribed: false,
          ordersUpdatedCallbackMatchesExpected: false,
          likelyRootCause: 'unknown' as const,
        },
        error: `Shopify Admin API webhook subscription query returned GraphQL errors: ${graphqlError}`,
      };
    }

    const data = readDiagnosticRecord(payload.data);
    const connection = readDiagnosticRecord(data?.webhookSubscriptions);
    const pageEdges = Array.isArray(connection?.edges) ? connection.edges : [];
    edges.push(...pageEdges);
    const pageInfo = readDiagnosticRecord(connection?.pageInfo);
    hasNextPage = Boolean(pageInfo?.hasNextPage);
    cursor = hasNextPage
      ? readDiagnosticString(readDiagnosticRecord(pageEdges.at(-1)), ['cursor'])
      : null;
    if (hasNextPage && !cursor) {
      hasNextPage = false;
    }
  }

  const subscriptions = edges
    .map((edge) => readDiagnosticRecord(edge))
    .map((edge) => readDiagnosticRecord(edge?.node))
    .filter((node): node is Record<string, unknown> => Boolean(node))
    .map((node) => {
      const endpoint = readDiagnosticRecord(node.endpoint);
      const topic = readDiagnosticString(node, ['topic']) ?? 'UNKNOWN';
      const callbackUrl = endpoint?.__typename === 'WebhookHttpEndpoint'
        ? readDiagnosticString(endpoint, ['callbackUrl'])
        : null;
      return {
        id: readDiagnosticString(node, ['id']),
        topic,
        endpointType: readDiagnosticString(endpoint, ['__typename']),
        callbackUrl,
        expectedRoutePath: routeForShopifyTopic(topic),
        callbackMatchesExpectedRoute: callbackUrl
          ? callbackMatchesExpectedRoute({ topic, callbackUrl, expectedBaseUrl: expectedOrderWebhookBaseUrl })
          : false,
      };
    });

  const ordersCreateSubscriptions = subscriptions.filter((subscription) => subscription.topic === 'ORDERS_CREATE');
  const ordersUpdatedSubscriptions = subscriptions.filter((subscription) => subscription.topic === 'ORDERS_UPDATED');
  const ordersUpdatedCallbackMatchesExpected = ordersUpdatedSubscriptions.some(
    (subscription) => subscription.callbackMatchesExpectedRoute,
  );
  const ordersUpdatedSubscribed = ordersUpdatedSubscriptions.length > 0;

  return {
    ok: true,
    config,
    subscriptions,
    derived: {
      ordersCreateSubscribed: ordersCreateSubscriptions.length > 0,
      ordersUpdatedSubscribed,
      ordersUpdatedCallbackMatchesExpected,
      likelyRootCause: !ordersUpdatedSubscribed
        ? 'orders_updated_not_subscribed'
        : 'unknown',
    },
  };
}

export async function getOrderWebhookEventsDiagnostic(orderNumber: string) {
  const normalized = normalizeDiagnosticOrderNumber(orderNumber);
  const order = await prisma.shopifyOrder.findFirst({
    where: {
      OR: [
        {
          sourceShopifyOrderNumber: {
            in: [normalized.plain, normalized.hash],
          },
        },
        {
          sourceShopifyOrderId: normalized.plain,
        },
      ],
    },
    select: {
      id: true,
      sourceShopifyOrderId: true,
      sourceShopifyOrderNumber: true,
    },
  });

  if (!order) {
    return null;
  }

  const events = await prisma.webhookEvent.findMany({
    where: {
      OR: [
        { shopifyOrderId: order.id },
        { rawPayload: { contains: order.sourceShopifyOrderId } },
        { rawPayload: { contains: order.sourceShopifyOrderNumber } },
        { rawPayload: { contains: order.sourceShopifyOrderNumber.replace(/^#/, '') } },
      ],
    },
    orderBy: [
      {
        receivedAt: 'asc',
      },
    ],
    select: {
      id: true,
      topic: true,
      receivedAt: true,
      processedAt: true,
      status: true,
      errorMessage: true,
      shopifyOrderId: true,
      rawPayload: true,
    },
  });

  const webhookEvents = events
    .map((event) => {
      const payload = parseDiagnosticPayload(event.rawPayload);
      const affected = inferAffectedEntities({ topic: event.topic, rawPayload: event.rawPayload });
      const payloadOrderHint = getPayloadOrderHint(payload);
      const payloadMatches = payloadMatchesOrder(payload, order);
      return {
        webhookEventId: event.id,
        topic: event.topic,
        receivedAt: event.receivedAt.toISOString(),
        processedAt: toIsoString(event.processedAt),
        status: event.status,
        errorMessage: event.errorMessage,
        hasRawPayload: Boolean(event.rawPayload),
        linkedToOrder: event.shopifyOrderId === order.id,
        payloadMatchesOrder: payloadMatches,
        safeOrder: {
          shopifyOrderId: affected.shopifyOrderId ?? payloadOrderHint,
          shopifyOrderNumber: affected.shopifyOrderNumber,
        },
        shipping_address: readSafeAddressHistoryFields(readDiagnosticRecord(payload?.shipping_address)),
        billing_address: readSafeAddressHistoryFields(readDiagnosticRecord(payload?.billing_address)),
      };
    })
    .filter((event) => event.linkedToOrder || event.payloadMatchesOrder);

  const ordersUpdatedEvents = webhookEvents.filter((event) => event.topic === 'orders/updated');

  return {
    ok: true,
    orderNumber: order.sourceShopifyOrderNumber,
    orderId: order.id,
    shopifyOrderId: order.sourceShopifyOrderId,
    webhookEvents: webhookEvents.map(({ linkedToOrder, payloadMatchesOrder: _payloadMatchesOrder, ...event }) => event),
    derived: {
      ordersUpdatedStored: ordersUpdatedEvents.length > 0,
      ordersUpdatedProcessed: ordersUpdatedEvents.some((event) => event.processedAt && event.status === 'PROCESSED'),
      likelyRootCause: ordersUpdatedEvents.length === 0
        ? 'unknown'
        : ordersUpdatedEvents.some((event) => event.processedAt && event.status === 'PROCESSED')
          ? 'unknown'
          : 'orders_updated_stored_but_not_processed',
    },
  };
}

export async function getOrderAddressHistoryDiagnostic(orderNumber: string) {
  const normalized = normalizeDiagnosticOrderNumber(orderNumber);
  const order = await prisma.shopifyOrder.findFirst({
    where: {
      OR: [
        {
          sourceShopifyOrderNumber: {
            in: [normalized.plain, normalized.hash],
          },
        },
        {
          sourceShopifyOrderId: normalized.plain,
        },
      ],
    },
    select: {
      id: true,
      sourceShopifyOrderId: true,
      sourceShopifyOrderNumber: true,
      shippingAddress: true,
      shippingCity: true,
      shippingDistrict: true,
      shippingPostcode: true,
      shippingCountry: true,
    },
  });

  if (!order) {
    return null;
  }

  const webhookEvents = await prisma.webhookEvent.findMany({
    where: {
      AND: [
        {
          topic: {
            startsWith: 'orders/',
          },
        },
        {
          OR: [
            { shopifyOrderId: order.id },
            { rawPayload: { contains: order.sourceShopifyOrderId } },
            { rawPayload: { contains: order.sourceShopifyOrderNumber } },
            { rawPayload: { contains: order.sourceShopifyOrderNumber.replace(/^#/, '') } },
          ],
        },
      ],
    },
    orderBy: [
      {
        receivedAt: 'asc',
      },
    ],
    select: {
      id: true,
      topic: true,
      receivedAt: true,
      processedAt: true,
      shopifyOrderId: true,
      rawPayload: true,
    },
  });

  const timeline = webhookEvents
    .filter((event) => isOrderAddressHistoryTopic(event.topic))
    .map((event) => {
      const payload = parseDiagnosticPayload(event.rawPayload);
      const shippingAddress = readDiagnosticRecord(payload?.shipping_address);
      const billingAddress = readDiagnosticRecord(payload?.billing_address);
      return {
        webhookEventId: event.id,
        topic: event.topic,
        receivedAt: event.receivedAt.toISOString(),
        processedAt: toIsoString(event.processedAt),
        linkedToOrder: event.shopifyOrderId === order.id,
        payloadMatchesOrder: payloadMatchesOrder(payload, order),
        shipping_address: readSafeAddressHistoryFields(shippingAddress),
        billing_address: readSafeAddressHistoryFields(billingAddress),
      };
    })
    .filter((event) => event.linkedToOrder || event.payloadMatchesOrder);

  const firstCreate = timeline.find((event) => event.topic === 'orders/create') ?? null;
  const latestUpdate = [...timeline].reverse().find((event) => event.topic !== 'orders/create') ?? null;
  const currentPersistedOrder = {
    shippingAddress: order.shippingAddress,
    shippingCity: order.shippingCity,
    shippingDistrict: order.shippingDistrict,
    shippingPostcode: order.shippingPostcode,
    shippingCountry: order.shippingCountry,
  };
  const addressChangedAfterCreate = Boolean(
    firstCreate &&
      latestUpdate &&
      !addressHistoryFieldsEqual(firstCreate.shipping_address, latestUpdate.shipping_address),
  );
  const persistedMatchesLatestWebhook = latestUpdate
    ? currentPersistedShippingFieldsMatchWebhook(currentPersistedOrder, latestUpdate.shipping_address)
    : false;
  const persistedMatchesFirstCreate = firstCreate
    ? currentPersistedShippingFieldsMatchWebhook(currentPersistedOrder, firstCreate.shipping_address)
    : false;
  const ordersUpdatedExists = timeline.some((event) => event.topic === 'orders/updated');

  return {
    ok: true,
    orderNumber: order.sourceShopifyOrderNumber,
    orderId: order.id,
    shopifyOrderId: order.sourceShopifyOrderId,
    timeline: timeline.map(({ linkedToOrder, payloadMatchesOrder: _payloadMatchesOrder, ...event }) => event),
    comparison: {
      firstCreate: {
        shipping_address: firstCreate?.shipping_address ?? null,
      },
      latestUpdate: {
        shipping_address: latestUpdate?.shipping_address ?? null,
      },
      currentPersistedOrder,
    },
    derived: {
      addressChangedAfterCreate,
      ordersUpdatedExists,
      persistedMatchesLatestWebhook,
      likelyRootCause: deriveAddressHistoryRootCause({
        firstCreateShipping: firstCreate?.shipping_address ?? null,
        latestUpdateShipping: latestUpdate?.shipping_address ?? null,
        ordersUpdatedExists,
        addressChangedAfterCreate,
        persistedMatchesLatestWebhook,
        persistedMatchesFirstCreate,
      }),
    },
  };
}

function normalizeOrderLookup(value: string) {
  const trimmed = value.trim();
  return {
    raw: trimmed,
    number: trimmed.startsWith('#') ? trimmed : `#${trimmed}`,
  };
}

function getPayloadOrderHint(payload: Record<string, unknown> | null) {
  const orderId = getStringField(payload, 'order_id');
  const orderNumber = getStringField(payload, 'order_number');
  const name = getStringField(payload, 'name');
  const orderObject = payload?.order && typeof payload.order === 'object' && !Array.isArray(payload.order)
    ? (payload.order as Record<string, unknown>)
    : null;
  const nestedOrderId = getStringField(orderObject, 'id');
  const nestedOrderGid = getStringField(orderObject, 'admin_graphql_api_id');

  return orderId ?? nestedOrderId ?? nestedOrderGid ?? orderNumber ?? name;
}

export async function getReturnVisibilityDiagnostic(query: string): Promise<ReturnVisibilityDiagnostic> {
  const lookup = normalizeOrderLookup(query);
  const localOrder = await prisma.shopifyOrder.findFirst({
    where: {
      OR: [
        { sourceShopifyOrderId: lookup.raw },
        { sourceShopifyOrderNumber: lookup.raw },
        { sourceShopifyOrderNumber: lookup.number },
      ],
    },
    include: {
      allocations: {
        include: {
          lineItems: {
            include: {
              shopifyOrderLineItem: true,
            },
          },
          returnRecords: true,
          refundRecords: true,
          financeEntries: true,
        },
        orderBy: {
          createdAt: 'asc',
        },
      },
    },
  });

  const webhookCandidates = await prisma.webhookEvent.findMany({
    where: {
      topic: {
        startsWith: 'returns/',
      },
    },
    orderBy: {
      receivedAt: 'desc',
    },
    take: 250,
  });

  const matchingWebhookEvents = webhookCandidates
    .map((event) => {
      const payload = parsePayloadForHints(event.rawPayload);
      const payloadOrderHint = getPayloadOrderHint(payload);
      const affected = inferAffectedEntities({ topic: event.topic, rawPayload: event.rawPayload });
      const matchesOrder =
        localOrder?.id && event.shopifyOrderId === localOrder.id
          ? true
          : [payloadOrderHint, affected.shopifyOrderId, affected.shopifyOrderNumber]
              .filter((value): value is string => Boolean(value))
              .some((value) => value === lookup.raw || value === lookup.number || value.endsWith(`/${lookup.raw}`));

      return {
        event,
        payload,
        payloadOrderHint,
        affected,
        matchesOrder,
      };
    })
    .filter((entry) => entry.matchesOrder);

  const allocations = localOrder?.allocations ?? [];
  const returnRecords = allocations.flatMap((allocation) =>
    allocation.returnRecords.map((record) => ({
      id: record.id,
      vendorAllocationId: allocation.id,
      vendorId: allocation.assignedVendorId,
      sourceShopifyReturnId: record.sourceShopifyReturnId,
      sourceShopifyReturnGid: record.sourceShopifyReturnGid,
      sourceShopifyLineItemId: record.sourceShopifyLineItemId,
      status: record.status,
      returnRequestSource: record.returnRequestSource,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    })),
  );
  const financeLedger = allocations.flatMap((allocation) =>
    allocation.financeEntries.map((entry) => ({
      id: entry.id,
      vendorId: entry.vendorId,
      vendorAllocationId: entry.vendorAllocationId,
      entryType: entry.entryType,
      amount: String(entry.amount),
      payoutStatus: entry.payoutStatus,
    })),
  );
  const returnsRequestWebhookFound = matchingWebhookEvents.some((entry) => entry.event.topic === 'returns/request');
  const failedReturnsRequestWebhookFound = matchingWebhookEvents.some(
    (entry) => entry.event.topic === 'returns/request' && entry.event.status === 'FAILED',
  );
  const mappingIssueLikely = matchingWebhookEvents.some((entry) =>
    (entry.event.errorMessage ?? '').toLowerCase().includes('mapping') ||
    (entry.event.errorMessage ?? '').toLowerCase().includes('allocation') ||
    (entry.event.errorMessage ?? '').toLowerCase().includes('seller_info'),
  );

  return {
    query: lookup.raw,
    localOrder: {
      found: Boolean(localOrder),
      id: localOrder?.id ?? null,
      sourceShopifyOrderId: localOrder?.sourceShopifyOrderId ?? null,
      sourceShopifyOrderNumber: localOrder?.sourceShopifyOrderNumber ?? null,
      allocationCount: allocations.length,
    },
    allocations: allocations.map((allocation) => ({
      id: allocation.id,
      vendorId: allocation.assignedVendorId,
      originalVendorId: allocation.originalVendorId,
      assignedVendorId: allocation.assignedVendorId,
      lineItems: allocation.lineItems.map((lineItem) => ({
        sourceLineItemId: lineItem.shopifyOrderLineItem.sourceLineItemId,
        sku: lineItem.shopifyOrderLineItem.sku,
        title: lineItem.shopifyOrderLineItem.title,
        quantity: lineItem.quantity,
      })),
    })),
    returnRecords,
    webhookEvents: matchingWebhookEvents.map((entry) => ({
      id: entry.event.id,
      topic: entry.event.topic,
      status: entry.event.status,
      receivedAt: entry.event.receivedAt.toISOString(),
      processedAt: toIsoString(entry.event.processedAt),
      errorSummary: summarizeError(entry.event.errorMessage),
      shopifyReturnId: entry.affected.shopifyReturnId,
      payloadOrderHint: entry.payloadOrderHint,
      payloadAvailable: Boolean(entry.event.rawPayload),
    })),
    financeLedger,
    findings: {
      localAllocationFound: allocations.length > 0,
      returnsRequestWebhookFound,
      failedReturnsRequestWebhookFound,
      returnRecordFound: returnRecords.length > 0,
      refundLedgerFound: financeLedger.some((entry) => normalizeEntryType(entry.entryType) === 'refund'),
      mappingIssueLikely,
      productionRepairNeeded: returnsRequestWebhookFound && returnRecords.length === 0,
    },
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

    const lineItemImages = await shopifyAdminService.fetchOrderLineItemImages(sourceShopifyOrderId).then(
      (result) => result.lineItems,
      (error) => {
        console.warn('[diagnostics] Shopify line item image enrichment failed; continuing replay.', {
          sourceShopifyOrderId,
          errorMessage: error instanceof Error ? error.message : 'Unknown Shopify line item image enrichment error.',
        });
        return [];
      },
    );

    const taxSnapshot = await shopifyAdminService.fetchOrderTaxSnapshot(sourceShopifyOrderId).then(
      (result) => result,
      (error) => {
        console.warn('[diagnostics] Shopify tax snapshot enrichment failed; continuing replay with VAT fallback.', {
          sourceShopifyOrderId,
          errorMessage: error instanceof Error ? error.message : 'Unknown Shopify tax snapshot enrichment error.',
        });
        return null;
      },
    );

    const ingestionResult = await ingestShopifyOrderWebhook({
      event,
      payload: typedPayload,
      sellerInfo: sellerInfoResult.sellerInfo,
      lineItemImages,
      taxSnapshot,
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
    const ingestionResult = await applyReturnLifecycleStatusWebhook(env, event.topic, {
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

async function createDiagnosticsOperationalJob(input: {
  jobType: 'replay' | 'recovery';
  webhookEventId: string;
  payloadRef: string | null;
  sourceShopifyOrderId?: string | null;
}) {
  try {
    return await createOperationalJob({
      jobType: input.jobType,
      webhookEventId: input.webhookEventId,
      payloadRef: input.payloadRef,
      sourceShopifyOrderId: input.sourceShopifyOrderId ?? null,
      priority: 10,
    });
  } catch {
    return null;
  }
}

async function markDiagnosticsJobCompleted(jobId: string | null | undefined) {
  try {
    await markOperationalJobCompleted(jobId);
  } catch {
    // Diagnostics action execution remains canonical; job persistence is retry metadata only.
  }
}

async function markDiagnosticsJobFailed(jobId: string | null | undefined, error: unknown) {
  try {
    await markOperationalJobFailed(jobId, error);
  } catch {
    // Diagnostics action execution remains canonical; job persistence is retry metadata only.
  }
}

async function markDiagnosticsJobProcessing(jobId: string | null | undefined) {
  try {
    await markOperationalJobProcessing(jobId);
  } catch {
    // Diagnostics action execution remains canonical; job persistence is retry metadata only.
  }
}

function buildBlockedOperationalJobRetry(input: {
  jobId?: string;
  webhookEventId?: string | null;
  jobStatus?: string | null;
  reason: string;
}): OperationalJobRetryResponse {
  return {
    ok: false,
    operationalJobId: input.jobId,
    webhookEventId: input.webhookEventId ?? null,
    jobStatus: input.jobStatus ?? null,
    retryStatus: 'not_retryable',
    processingStatus: 'not_retryable',
    skippedReason: input.reason,
    message: input.reason,
  };
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
  const operationalJob = await createDiagnosticsOperationalJob({
    jobType: 'replay',
    webhookEventId: event.id,
    payloadRef: event.payloadHash,
  });
  await markDiagnosticsJobProcessing(operationalJob?.id);
  let response: WebhookReplayResponse;
  try {
    response = await processWebhookEvent(env, event, parsedPayload.payload);
  } catch (error) {
    await markDiagnosticsJobFailed(operationalJob?.id, error);
    throw error;
  }
  const { afterStatus, errorSummary } = await getWebhookStatus(event.id);
  const replayStatus: WebhookReplayResponse['replayStatus'] =
    response.processingStatus === 'processed' ? 'replayed' : 'failed';
  if (replayStatus === 'replayed') {
    await markDiagnosticsJobCompleted(operationalJob?.id);
  } else {
    await markDiagnosticsJobFailed(operationalJob?.id, response.message ?? errorSummary ?? 'Replay did not complete.');
  }

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

export async function retryOperationalJob(
  env: AppEnv,
  operationalJobId: string,
): Promise<
  | { ok: false; statusCode: 404 | 409; response: OperationalJobRetryResponse }
  | { ok: true; response: OperationalJobRetryResponse }
> {
  const job = await prisma.operationalJob.findUnique({
    where: { id: operationalJobId },
    include: {
      webhookEvent: true,
    },
  });

  if (!job) {
    return {
      ok: false,
      statusCode: 404,
      response: buildBlockedOperationalJobRetry({
        jobId: operationalJobId,
        reason: 'Operational job not found.',
      }),
    };
  }

  if (job.status === 'COMPLETED') {
    return {
      ok: false,
      statusCode: 409,
      response: buildBlockedOperationalJobRetry({
        jobId: job.id,
        webhookEventId: job.webhookEventId,
        jobStatus: job.status,
        reason: 'Completed operational jobs are not retryable.',
      }),
    };
  }

  if (job.status === 'PROCESSING' || job.status === 'RETRYING') {
    return {
      ok: false,
      statusCode: 409,
      response: buildBlockedOperationalJobRetry({
        jobId: job.id,
        webhookEventId: job.webhookEventId,
        jobStatus: job.status,
        reason: 'Operational job is already processing.',
      }),
    };
  }

  if (!job.webhookEvent) {
    return {
      ok: false,
      statusCode: 409,
      response: buildBlockedOperationalJobRetry({
        jobId: job.id,
        webhookEventId: job.webhookEventId,
        jobStatus: job.status,
        reason: 'Only webhook-linked operational jobs can be retried by this endpoint.',
      }),
    };
  }

  const replayBlockedReason = getReplayBlockedReason(job.webhookEvent);
  const recoverBlockedReason = getRecoverBlockedReason(job.webhookEvent);
  if (replayBlockedReason && recoverBlockedReason) {
    return {
      ok: false,
      statusCode: 409,
      response: buildBlockedOperationalJobRetry({
        jobId: job.id,
        webhookEventId: job.webhookEventId,
        jobStatus: job.status,
        reason: recoverBlockedReason,
      }),
    };
  }

  const parsedPayload = parseStoredPayload(job.webhookEvent.rawPayload);
  if (!parsedPayload.ok) {
    return {
      ok: false,
      statusCode: 409,
      response: buildBlockedOperationalJobRetry({
        jobId: job.id,
        webhookEventId: job.webhookEventId,
        jobStatus: job.status,
        reason: parsedPayload.message,
      }),
    };
  }

  await markOperationalJobRetrying(job.id);
  await markWebhookProcessing(job.webhookEvent.id);

  let response: WebhookReplayResponse;
  try {
    response = await processWebhookEvent(env, job.webhookEvent, parsedPayload.payload);
  } catch (error) {
    const failedJob = await markOperationalJobFailed(job.id, error);
    return {
      ok: true,
      response: {
        ok: true,
        operationalJobId: job.id,
        webhookEventId: job.webhookEventId,
        jobStatus: failedJob?.status ?? null,
        retryStatus: 'failed',
        processingStatus: 'failed',
        errorSummary: error instanceof Error ? error.message : 'Operational job retry failed.',
        message: error instanceof Error ? error.message : 'Operational job retry failed.',
      },
    };
  }

  const failedReason = response.message ?? 'Retry did not complete.';
  const finalJob =
    response.processingStatus === 'processed'
      ? await markOperationalJobCompleted(job.id)
      : await markOperationalJobFailed(job.id, failedReason);
  const { afterStatus, errorSummary } = await getWebhookStatus(job.webhookEvent.id);
  const retryStatus: OperationalJobRetryResponse['retryStatus'] =
    response.processingStatus === 'processed' ? 'retried' : 'failed';

  return {
    ok: true,
    response: {
      ok: true,
      operationalJobId: job.id,
      webhookEventId: job.webhookEventId,
      jobStatus: finalJob?.status ?? null,
      retryStatus,
      processingStatus: response.processingStatus,
      errorSummary,
      message:
        retryStatus === 'retried'
          ? `Operational job retry completed. Webhook status is ${afterStatus ?? 'unknown'}.`
          : failedReason,
    },
  };
}

export async function getReconciliationDiagnostics(): Promise<ReconciliationResponse> {
  const olderThan = new Date(Date.now() - 5 * 60 * 1000);
  const [
    stuckReceived,
    failedWebhookEvents,
    fulfillmentFailures,
    payloadUnknownEvents,
    staleAllocations,
    scheduledReconciliationJobs,
  ] = await Promise.all([
    withDashboardTiming('diagnostics.stuck_received_webhooks_fetch', () => prisma.webhookEvent.findMany({
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
    })),
    withDashboardTiming('diagnostics.failed_webhooks_fetch', () => prisma.webhookEvent.findMany({
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
    })),
    withDashboardTiming('diagnostics.fulfillment_failures_fetch', () => prisma.fulfillment.findMany({
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
    })),
    withDashboardTiming('diagnostics.missing_payload_webhooks_fetch', () => prisma.webhookEvent.findMany({
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
    })),
    withDashboardTiming('diagnostics.stale_allocations_fetch', () => prisma.vendorAllocation.findMany({
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
    })),
    withDashboardTiming('diagnostics.scheduled_reconciliation_jobs_fetch', () => prisma.operationalJob.findMany({
      where: {
        jobType: OperationalJobType.RECONCILIATION,
        status: {
          in: [
            OperationalJobStatus.PENDING,
            OperationalJobStatus.PROCESSING,
            OperationalJobStatus.RETRY_SCHEDULED,
            OperationalJobStatus.RETRYING,
            OperationalJobStatus.FAILED,
            OperationalJobStatus.DEAD_LETTER_READY,
          ],
        },
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
      take: 25,
    })),
  ]);
  const aggregationStartedAt = startDashboardTimer();

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

  const scheduledReconciliationItems: ReconciliationItem[] = scheduledReconciliationJobs.map((job) => {
    const payload = typeof job.payload === 'object' && job.payload !== null && !Array.isArray(job.payload)
      ? job.payload as Record<string, unknown>
      : {};
    const reason = typeof payload.reason === 'string' ? payload.reason : job.escalationReason;
    const candidateType = typeof payload.candidateType === 'string' ? payload.candidateType : 'scheduled_reconciliation';

    return {
      id: `reconciliation-job-${job.id}`,
      type: 'scheduled_reconciliation',
      severity: job.status === OperationalJobStatus.DEAD_LETTER_READY || job.status === OperationalJobStatus.FAILED
        ? 'warning'
        : 'attention',
      title: 'Scheduled reconciliation job pending',
      description: reason ?? 'A scheduled reconciliation job is waiting for operator review or execution.',
      relatedWebhookEventId: job.webhookEventId,
      relatedShopifyOrderId: job.sourceShopifyOrderId ?? job.vendorAllocation?.order.sourceShopifyOrderId ?? null,
      relatedAllocationId: job.vendorAllocationId,
      status: job.status,
      createdAt: job.updatedAt.toISOString(),
      suggestedAction: job.vendorAllocationId || job.sourceShopifyOrderId
        ? 'Run admin reconciliation to refresh canonical Shopify state.'
        : 'Inspect job metadata before reconciliation can run.',
      payloadAvailable: null,
      operationalJobId: job.id,
      nextAttemptAt: toIsoString(job.nextRetryAt ?? job.scheduledAt),
      lastAttemptAt: toIsoString(job.lastAttemptAt),
      reconciliationReason: candidateType,
    };
  });

  const items = [
    ...stuckItems,
    ...failedItems,
    ...fulfillmentItems,
    ...missingPayloadItems,
    ...staleAllocationItems,
    ...scheduledReconciliationItems,
  ].sort((a, b) => {
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  const response = {
    summary: {
      stuckReceived: stuckItems.length,
      failedWebhooks: failedItems.length,
      fulfillmentSyncFailures: fulfillmentItems.length,
      missingPayload: missingPayloadItems.length,
      staleAllocations: staleAllocationItems.length,
      scheduledReconciliationJobs: scheduledReconciliationItems.length,
      total: items.length,
    },
    items,
  };
  logDashboardTiming('diagnostics.reconciliation_aggregation', aggregationStartedAt);
  return response;
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
  const operationalJob = await createDiagnosticsOperationalJob({
    jobType: 'recovery',
    webhookEventId: event.id,
    payloadRef: event.payloadHash,
  });
  await markDiagnosticsJobProcessing(operationalJob?.id);
  await markWebhookProcessing(event.id);

  let response: WebhookReplayResponse;
  try {
    response = await processWebhookEvent(env, event, parsedPayload.payload);
  } catch (error) {
    await markDiagnosticsJobFailed(operationalJob?.id, error);
    throw error;
  }
  const { afterStatus, errorSummary } = await getWebhookStatus(event.id);
  const recoveryStatus: WebhookRecoverResponse['recoveryStatus'] =
    response.processingStatus === 'processed' ? 'recovered' : 'failed';
  if (recoveryStatus === 'recovered') {
    await markDiagnosticsJobCompleted(operationalJob?.id);
  } else {
    await markDiagnosticsJobFailed(operationalJob?.id, response.message ?? errorSummary ?? 'Recovery did not complete.');
  }

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
