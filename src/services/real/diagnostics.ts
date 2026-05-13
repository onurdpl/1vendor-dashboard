import { apiClient } from '../../lib/api-client';

export type DiagnosticsWebhookSummary = {
  total: number;
  received: number;
  processed: number;
  failed: number;
  duplicates: number;
  needsAttention: number;
};

export type DiagnosticsOperationalJob = {
  id: string;
  jobType: string;
  status: string;
  payloadRef: string | null;
  webhookEventId: string | null;
  sourceShopifyOrderId: string | null;
  vendorAllocationId: string | null;
  refundRecordId: string | null;
  returnRecordId: string | null;
  priority: number;
  retryCount: number;
  maxRetries: number;
  scheduledAt: string;
  nextRetryAt: string | null;
  lastAttemptAt: string | null;
  retryBackoffMs: number | null;
  startedAt: string | null;
  completedAt: string | null;
  failedAt: string | null;
  errorSummary: string | null;
  failureCategory: string | null;
  escalationReason: string | null;
  createdAt: string;
  updatedAt: string;
};

export type DiagnosticsWebhookEvent = {
  id: string;
  topic: string;
  shopDomain: string;
  shopifyWebhookId: string | null;
  eventId: string | null;
  idempotencyKey: string | null;
  payloadHash: string | null;
  status: string;
  processingStatus: string;
  receivedAt: string;
  processedAt: string | null;
  errorMessage: string | null;
  lastErrorSummary: string | null;
  duplicate: boolean;
  payloadAvailable: boolean;
  replayEligible: boolean;
  replayBlockedReason: string | null;
  recoverEligible: boolean;
  recoverBlockedReason: string | null;
  recommendedAction: string;
  affectedEntities: DiagnosticsAffectedEntities;
  relatedJobs: DiagnosticsOperationalJob[];
  createdAt: string | null;
  updatedAt: string | null;
};

export type DiagnosticsWebhookDetail = {
  id: string;
  topic: string;
  shopDomain: string;
  shopifyWebhookId: string | null;
  eventId: string | null;
  idempotencyKey: string | null;
  payloadHash: string | null;
  payloadPreview: string | null;
  payloadPreviewTruncated: boolean;
  payloadAvailable: boolean;
  status: string;
  processingStatus: string;
  errorMessage: string | null;
  lastErrorSummary: string | null;
  replayEligible: boolean;
  replayBlockedReason: string | null;
  recoverEligible: boolean;
  recoverBlockedReason: string | null;
  recommendedAction: string;
  affectedEntities: DiagnosticsAffectedEntities;
  relatedJobs: DiagnosticsOperationalJob[];
  receivedAt: string;
  processedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  relatedShopifyOrderId: string | null;
};

export type DiagnosticsAffectedEntities = {
  shopifyOrderId: string | null;
  shopifyOrderNumber: string | null;
  shopifyReturnId: string | null;
  shopifyRefundId: string | null;
  shopifyFulfillmentId: string | null;
  vendorId: string | null;
};

export type DiagnosticsSyncEvent = {
  id: string;
  type: string;
  severity: 'critical' | 'warning' | 'attention' | 'normal';
  title: string;
  description: string;
  relatedWebhookEventId: string | null;
  relatedShopifyOrderId: string | null;
  relatedAllocationId: string | null;
  status: string;
  createdAt: string;
};

export type DiagnosticsReconciliationSummary = {
  stuckReceived: number;
  failedWebhooks: number;
  fulfillmentSyncFailures: number;
  missingPayload: number;
  staleAllocations: number;
  total: number;
};

export type DiagnosticsReconciliationItem = {
  id: string;
  type: 'stuck_webhook' | 'failed_webhook' | 'fulfillment_sync_failed' | 'missing_payload' | 'stale_allocation';
  severity: 'critical' | 'warning' | 'attention' | 'normal';
  title: string;
  description: string;
  relatedWebhookEventId: string | null;
  relatedShopifyOrderId: string | null;
  relatedAllocationId: string | null;
  status: string;
  createdAt: string;
  suggestedAction: string;
  payloadAvailable: boolean | null;
};

type WebhooksResponseDto = {
  summary: DiagnosticsWebhookSummary;
  events: DiagnosticsWebhookEvent[];
};

type SyncEventsResponseDto = {
  items: DiagnosticsSyncEvent[];
};

type ReconciliationResponseDto = {
  summary: DiagnosticsReconciliationSummary;
  items: DiagnosticsReconciliationItem[];
};

export type OrderReconciliationResult = {
  reconciliationStatus: 'in_sync' | 'repaired' | 'needs_attention';
  staleFields: Array<{ scope: string; field: string; localValue: string | null; canonicalValue: string | null }>;
  repairedFields: Array<{ scope: string; field: string; localValue: string | null; canonicalValue: string | null }>;
  skippedFields: Array<{ scope: string; field: string; localValue: string | null; canonicalValue: string | null }>;
  canonicalShopifySummary: {
    source: 'mock' | 'shopify_admin';
    shopifyOrderId: string;
    orderName: string | null;
    displayFulfillmentStatus: string | null;
    fulfillmentCount: number;
    fulfillmentOrderCount: number;
    fulfilledLineItemIds: string[];
    cancelledLineItemIds: string[];
  };
  localStateSummary: {
    shopifyOrderId: string;
    shopifyOrderNumber: string;
    allocationCount: number;
    refundRecordCount: number;
    returnRecordCount: number;
  };
  affectedAllocations: Array<{
    allocationId: string;
    vendorId: string;
    staleFields: Array<{ scope: string; field: string; localValue: string | null; canonicalValue: string | null }>;
    repairedFields: Array<{ scope: string; field: string; localValue: string | null; canonicalValue: string | null }>;
    skippedFields: Array<{ scope: string; field: string; localValue: string | null; canonicalValue: string | null }>;
    warnings: string[];
  }>;
  affectedVendorIds: string[];
  warnings: string[];
  requiresManualReview: boolean;
};

export type ReplayWebhookResponse = {
  ok: boolean;
  topic: string;
  webhookEventId?: string;
  action: string;
  beforeStatus?: string | null;
  afterStatus?: string | null;
  replayStatus?: 'replayed' | 'failed' | 'not_replayable';
  recoveryStatus?: 'recovered' | 'failed' | 'not_recoverable';
  processingStatus: string;
  shopifyOrderId?: string;
  allocationCount?: number;
  refundAllocationCount?: number;
  affectedRecordCount?: number;
  affectedAllocationCount?: number;
  skippedReason?: string;
  errorSummary?: string | null;
  message?: string;
};

export type RecoverWebhookResponse = ReplayWebhookResponse & {
  recoveryStatus: 'recovered' | 'failed' | 'not_recoverable';
};

export type RetryOperationalJobResponse = {
  ok: boolean;
  operationalJobId?: string;
  webhookEventId?: string | null;
  jobStatus?: string | null;
  retryStatus: 'retried' | 'failed' | 'not_retryable';
  processingStatus: string;
  skippedReason?: string;
  errorSummary?: string | null;
  message?: string;
};

export async function listWebhookDiagnostics() {
  return apiClient.get<WebhooksResponseDto>('/admin/diagnostics/webhooks');
}

export async function getWebhookDiagnostic(webhookEventId: string) {
  return apiClient.get<DiagnosticsWebhookDetail>(`/admin/diagnostics/webhooks/${webhookEventId}`);
}

export async function listSyncEvents() {
  return apiClient.get<SyncEventsResponseDto>('/admin/diagnostics/sync-events');
}

export async function getReconciliationDiagnostics() {
  return apiClient.get<ReconciliationResponseDto>('/admin/diagnostics/reconciliation');
}

export async function replayWebhook(webhookEventId: string) {
  return apiClient.post<ReplayWebhookResponse>(`/admin/diagnostics/webhooks/${webhookEventId}/replay`);
}

export async function recoverWebhook(webhookEventId: string) {
  return apiClient.post<RecoverWebhookResponse>(`/admin/diagnostics/webhooks/${webhookEventId}/recover`);
}

export async function retryOperationalJob(operationalJobId: string) {
  return apiClient.post<RetryOperationalJobResponse>(`/admin/diagnostics/jobs/${operationalJobId}/retry`);
}

export async function reconcileAllocation(allocationId: string) {
  return apiClient.post<OrderReconciliationResult>(`/admin/reconciliation/orders/${allocationId}`);
}

export async function reconcileShopifyOrder(shopifyOrderId: string) {
  return apiClient.post<OrderReconciliationResult>(`/admin/reconciliation/shopify-order/${shopifyOrderId}`);
}
