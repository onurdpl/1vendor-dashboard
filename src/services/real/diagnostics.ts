import { apiClient } from '../../lib/api-client';

export type DiagnosticsWebhookSummary = {
  total: number;
  received: number;
  processed: number;
  failed: number;
  duplicates: number;
  needsAttention: number;
};

export type DiagnosticsWebhookEvent = {
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

export type DiagnosticsWebhookDetail = {
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
  total: number;
};

export type DiagnosticsReconciliationItem = {
  id: string;
  type: 'stuck_webhook' | 'failed_webhook' | 'fulfillment_sync_failed' | 'missing_payload';
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

export type ReplayWebhookResponse = {
  ok: true;
  topic: string;
  action: string;
  processingStatus: string;
  shopifyOrderId?: string;
  allocationCount?: number;
  refundAllocationCount?: number;
  message?: string;
};

export type RecoverWebhookResponse = ReplayWebhookResponse & {
  recoveryStatus: 'recovered' | 'failed' | 'not_recoverable';
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
