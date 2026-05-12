export type AdminWebhookDiagnosticsSummary = {
  total: number;
  received: number;
  processed: number;
  failed: number;
  duplicates: number;
  needsAttention: number;
};

export type AdminWebhookDiagnosticsEvent = {
  id: string;
  topic: string;
  shopDomain: string;
  shopifyWebhookId: string | null;
  idempotencyKey: string | null;
  status: string;
  receivedAt: string;
  processedAt: string | null;
  errorMessage: string | null;
  duplicate: boolean;
  payloadAvailable: boolean;
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
  idempotencyKey: string | null;
  payloadHash: string | null;
  rawPayload: string | null;
  payloadAvailable: boolean;
  status: string;
  errorMessage: string | null;
  receivedAt: string;
  processedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  relatedShopifyOrderId: string | null;
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
  ok: true;
  topic: string;
  action: string;
  processingStatus: string;
  shopifyOrderId?: string;
  allocationCount?: number;
  refundAllocationCount?: number;
  affectedRecordCount?: number;
  message?: string;
};

export type WebhookRecoverResponse = WebhookReplayResponse & {
  recoveryStatus: 'recovered' | 'failed' | 'not_recoverable';
};

export type ReconciliationSummary = {
  stuckReceived: number;
  failedWebhooks: number;
  fulfillmentSyncFailures: number;
  missingPayload: number;
  total: number;
};

export type ReconciliationItem = {
  id: string;
  type: 'stuck_webhook' | 'failed_webhook' | 'fulfillment_sync_failed' | 'missing_payload';
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
};

export type ReconciliationResponse = {
  summary: ReconciliationSummary;
  items: ReconciliationItem[];
};
