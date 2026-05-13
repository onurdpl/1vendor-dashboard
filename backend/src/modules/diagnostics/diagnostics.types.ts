export type AdminWebhookDiagnosticsSummary = {
  total: number;
  received: number;
  processed: number;
  failed: number;
  duplicates: number;
  needsAttention: number;
};

export type OperationalJobDiagnostic = {
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

export type AdminWebhookDiagnosticsEvent = {
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
  affectedEntities: WebhookAffectedEntities;
  relatedJobs: OperationalJobDiagnostic[];
  createdAt: string | null;
  updatedAt: string | null;
};

export type AdminWebhookDiagnosticsResponse = {
  summary: AdminWebhookDiagnosticsSummary;
  events: AdminWebhookDiagnosticsEvent[];
};

export type AdminWebhookDiagnosticDetail = {
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
  affectedEntities: WebhookAffectedEntities;
  relatedJobs: OperationalJobDiagnostic[];
  receivedAt: string;
  processedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  relatedShopifyOrderId: string | null;
};

export type WebhookAffectedEntities = {
  shopifyOrderId: string | null;
  shopifyOrderNumber: string | null;
  shopifyReturnId: string | null;
  shopifyRefundId: string | null;
  shopifyFulfillmentId: string | null;
  vendorId: string | null;
};

export type SyncDiagnosticSeverity = 'critical' | 'warning' | 'attention' | 'normal';

export type SyncDiagnosticItem = {
  id: string;
  type: string;
  severity: SyncDiagnosticSeverity;
  title: string;
  description: string;
  relatedWebhookEventId: string | null;
  relatedShopifyOrderId: string | null;
  relatedAllocationId: string | null;
  status: string;
  createdAt: string;
};

export type SyncDiagnosticsResponse = {
  items: SyncDiagnosticItem[];
};

export type WebhookReplayResponse = {
  ok: boolean;
  topic: string;
  webhookEventId?: string;
  action: string;
  beforeStatus?: string | null;
  afterStatus?: string | null;
  replayStatus?: 'replayed' | 'failed' | 'not_replayable';
  recoveryStatus?: 'recovered' | 'failed' | 'not_recoverable';
  processingStatus: string;
  affectedRecordCount?: number;
  shopifyOrderId?: string;
  allocationCount?: number;
  refundAllocationCount?: number;
  affectedAllocationCount?: number;
  skippedReason?: string;
  errorSummary?: string | null;
  message?: string;
};

export type WebhookRecoverResponse = WebhookReplayResponse & {
  recoveryStatus: 'recovered' | 'failed' | 'not_recoverable';
};

export type OperationalJobRetryResponse = {
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

export type ReconciliationSummary = {
  stuckReceived: number;
  failedWebhooks: number;
  fulfillmentSyncFailures: number;
  missingPayload: number;
  staleAllocations: number;
  scheduledReconciliationJobs: number;
  total: number;
};

export type ReconciliationItem = {
  id: string;
  type:
    | 'stuck_webhook'
    | 'failed_webhook'
    | 'fulfillment_sync_failed'
    | 'missing_payload'
    | 'stale_allocation'
    | 'scheduled_reconciliation';
  severity: SyncDiagnosticSeverity;
  title: string;
  description: string;
  relatedWebhookEventId: string | null;
  relatedShopifyOrderId: string | null;
  relatedAllocationId: string | null;
  status: string;
  createdAt: string;
  suggestedAction: string;
  payloadAvailable: boolean | null;
  operationalJobId?: string | null;
  nextAttemptAt?: string | null;
  lastAttemptAt?: string | null;
  reconciliationReason?: string | null;
};

export type ReconciliationResponse = {
  summary: ReconciliationSummary;
  items: ReconciliationItem[];
};
