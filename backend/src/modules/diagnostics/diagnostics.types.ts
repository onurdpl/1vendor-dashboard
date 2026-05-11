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
  rawPayload: null;
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
