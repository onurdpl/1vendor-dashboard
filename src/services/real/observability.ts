import { apiClient } from '../../lib/api-client';

export type OperationalHealthState = 'healthy' | 'warning' | 'degraded' | 'critical';
export type ObservabilityWindowKey = 'lastHour' | 'last24h' | 'last7d';

export type ObservabilityWindowMetrics = {
  window: ObservabilityWindowKey;
  since: string;
  webhookThroughput: number;
  processedWebhooks: number;
  failedWebhooks: number;
  successRate: number;
  failureRate: number;
  retryCount: number;
  deadLetterReady: number;
  permanentlyFailed: number;
  reconciliationJobs: number;
  replayJobs: number;
  recoveryJobs: number;
  staleStateCount: number;
};

export type ObservabilitySummary = {
  health: OperationalHealthState;
  generatedAt: string;
  windows: ObservabilityWindowMetrics[];
  retryPressure: {
    retryScheduled: number;
    retrying: number;
    deadLetterReady: number;
    permanentlyFailed: number;
    pressureScore: number;
  };
  reconciliation: {
    pending: number;
    processing: number;
    completed24h: number;
    failed24h: number;
    scheduled: number;
    staleStateCount: number;
  };
  webhookHealth: {
    received: number;
    processing: number;
    processed24h: number;
    failed24h: number;
    successRate24h: number;
  };
  staleStates: {
    stuckReceived: number;
    fulfillmentSyncFailures: number;
    missingPayload: number;
    staleAllocations: number;
    scheduledReconciliationJobs: number;
    total: number;
  };
  notes: string[];
};

export type ObservabilityMetricsResponse = {
  generatedAt: string;
  windows: ObservabilityWindowMetrics[];
};

export async function getObservabilitySummary() {
  return apiClient.get<ObservabilitySummary>('/admin/observability/summary');
}

export async function getObservabilityMetrics() {
  return apiClient.get<ObservabilityMetricsResponse>('/admin/observability/metrics');
}
