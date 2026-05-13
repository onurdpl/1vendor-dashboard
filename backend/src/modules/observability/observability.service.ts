import { OperationalJobStatus, OperationalJobType, WebhookStatus } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import type {
  ObservabilityMetricsResponse,
  ObservabilitySummary,
  ObservabilityWindowKey,
  ObservabilityWindowMetrics,
  OperationalHealthState,
} from './observability.types.js';
import { getReconciliationDiagnostics } from '../diagnostics/diagnostics.service.js';

type HealthInput = {
  failureRate24h: number;
  retryPressure: number;
  deadLetterReady: number;
  permanentlyFailed: number;
  staleStateCount: number;
};

const windowDefinitions: Array<{ key: ObservabilityWindowKey; durationMs: number }> = [
  { key: 'lastHour', durationMs: 60 * 60 * 1000 },
  { key: 'last24h', durationMs: 24 * 60 * 60 * 1000 },
  { key: 'last7d', durationMs: 7 * 24 * 60 * 60 * 1000 },
];

function roundRate(value: number) {
  return Math.round(value * 1000) / 1000;
}

function rate(part: number, total: number) {
  return total > 0 ? roundRate(part / total) : 1;
}

export function determineOperationalHealth(input: HealthInput): OperationalHealthState {
  if (input.permanentlyFailed > 0 || input.deadLetterReady >= 3 || input.failureRate24h >= 0.5) {
    return 'critical';
  }

  if (input.deadLetterReady > 0 || input.retryPressure >= 10 || input.failureRate24h >= 0.25 || input.staleStateCount >= 10) {
    return 'degraded';
  }

  if (input.retryPressure > 0 || input.failureRate24h > 0 || input.staleStateCount > 0) {
    return 'warning';
  }

  return 'healthy';
}

function buildHealthNotes(input: {
  health: OperationalHealthState;
  retryScheduled: number;
  deadLetterReady: number;
  permanentlyFailed: number;
  failedWebhooks24h: number;
  staleStateCount: number;
}) {
  const notes: string[] = [];

  if (input.deadLetterReady > 0) {
    notes.push(`${input.deadLetterReady} operational job(s) are dead-letter ready.`);
  }
  if (input.permanentlyFailed > 0) {
    notes.push(`${input.permanentlyFailed} operational job(s) are permanently failed.`);
  }
  if (input.retryScheduled > 0) {
    notes.push(`${input.retryScheduled} operational job(s) are retry scheduled.`);
  }
  if (input.failedWebhooks24h > 0) {
    notes.push(`${input.failedWebhooks24h} webhook event(s) failed in the last 24h.`);
  }
  if (input.staleStateCount > 0) {
    notes.push(`${input.staleStateCount} stale-state reconciliation signal(s) are visible.`);
  }
  if (notes.length === 0 && input.health === 'healthy') {
    notes.push('No active retry, dead-letter, or stale-state pressure detected.');
  }

  return notes;
}

async function getWindowMetrics(key: ObservabilityWindowKey, since: Date): Promise<ObservabilityWindowMetrics> {
  const [
    webhookThroughput,
    processedWebhooks,
    failedWebhooks,
    retryCount,
    deadLetterReady,
    permanentlyFailed,
    reconciliationJobs,
    replayJobs,
    recoveryJobs,
    staleReconciliationJobs,
  ] = await Promise.all([
    prisma.webhookEvent.count({
      where: {
        receivedAt: {
          gte: since,
        },
      },
    }),
    prisma.webhookEvent.count({
      where: {
        status: WebhookStatus.PROCESSED,
        processedAt: {
          gte: since,
        },
      },
    }),
    prisma.webhookEvent.count({
      where: {
        status: WebhookStatus.FAILED,
        receivedAt: {
          gte: since,
        },
      },
    }),
    prisma.operationalJob.count({
      where: {
        retryCount: {
          gt: 0,
        },
        updatedAt: {
          gte: since,
        },
      },
    }),
    prisma.operationalJob.count({
      where: {
        status: OperationalJobStatus.DEAD_LETTER_READY,
        updatedAt: {
          gte: since,
        },
      },
    }),
    prisma.operationalJob.count({
      where: {
        status: OperationalJobStatus.PERMANENTLY_FAILED,
        updatedAt: {
          gte: since,
        },
      },
    }),
    prisma.operationalJob.count({
      where: {
        jobType: OperationalJobType.RECONCILIATION,
        createdAt: {
          gte: since,
        },
      },
    }),
    prisma.operationalJob.count({
      where: {
        jobType: OperationalJobType.REPLAY,
        createdAt: {
          gte: since,
        },
      },
    }),
    prisma.operationalJob.count({
      where: {
        jobType: OperationalJobType.RECOVERY,
        createdAt: {
          gte: since,
        },
      },
    }),
    prisma.operationalJob.count({
      where: {
        jobType: OperationalJobType.RECONCILIATION,
        payload: {
          path: ['source'],
          equals: 'scheduled_reconciliation',
        },
        createdAt: {
          gte: since,
        },
      },
    }),
  ]);

  const completedWebhooks = processedWebhooks + failedWebhooks;

  return {
    window: key,
    since: since.toISOString(),
    webhookThroughput,
    processedWebhooks,
    failedWebhooks,
    successRate: rate(processedWebhooks, completedWebhooks),
    failureRate: completedWebhooks > 0 ? roundRate(failedWebhooks / completedWebhooks) : 0,
    retryCount,
    deadLetterReady,
    permanentlyFailed,
    reconciliationJobs,
    replayJobs,
    recoveryJobs,
    staleStateCount: staleReconciliationJobs,
  };
}

export async function getObservabilityMetrics(): Promise<ObservabilityMetricsResponse> {
  const now = new Date();
  const windows = await Promise.all(
    windowDefinitions.map((definition) =>
      getWindowMetrics(definition.key, new Date(now.getTime() - definition.durationMs)),
    ),
  );

  return {
    generatedAt: now.toISOString(),
    windows,
  };
}

export async function getObservabilitySummary(): Promise<ObservabilitySummary> {
  const [metrics, reconciliationDiagnostics, retryScheduled, retrying, deadLetterReady, permanentlyFailed, reconciliationPending, reconciliationProcessing, reconciliationCompleted24h, reconciliationFailed24h, receivedWebhooks, processingWebhooks] = await Promise.all([
    getObservabilityMetrics(),
    getReconciliationDiagnostics(),
    prisma.operationalJob.count({ where: { status: OperationalJobStatus.RETRY_SCHEDULED } }),
    prisma.operationalJob.count({ where: { status: OperationalJobStatus.RETRYING } }),
    prisma.operationalJob.count({ where: { status: OperationalJobStatus.DEAD_LETTER_READY } }),
    prisma.operationalJob.count({ where: { status: OperationalJobStatus.PERMANENTLY_FAILED } }),
    prisma.operationalJob.count({
      where: {
        jobType: OperationalJobType.RECONCILIATION,
        status: OperationalJobStatus.PENDING,
      },
    }),
    prisma.operationalJob.count({
      where: {
        jobType: OperationalJobType.RECONCILIATION,
        status: OperationalJobStatus.PROCESSING,
      },
    }),
    prisma.operationalJob.count({
      where: {
        jobType: OperationalJobType.RECONCILIATION,
        status: OperationalJobStatus.COMPLETED,
        completedAt: {
          gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
        },
      },
    }),
    prisma.operationalJob.count({
      where: {
        jobType: OperationalJobType.RECONCILIATION,
        status: {
          in: [
            OperationalJobStatus.FAILED,
            OperationalJobStatus.DEAD_LETTER_READY,
            OperationalJobStatus.PERMANENTLY_FAILED,
          ],
        },
        updatedAt: {
          gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
        },
      },
    }),
    prisma.webhookEvent.count({ where: { status: WebhookStatus.RECEIVED } }),
    prisma.webhookEvent.count({ where: { status: WebhookStatus.PROCESSING } }),
  ]);
  const last24h = metrics.windows.find((window) => window.window === 'last24h') ?? metrics.windows[0];
  const retryPressureScore = retryScheduled + retrying * 2 + deadLetterReady * 3 + permanentlyFailed * 4;
  const staleStateCount = reconciliationDiagnostics.summary.total;
  const health = determineOperationalHealth({
    failureRate24h: last24h.failureRate,
    retryPressure: retryPressureScore,
    deadLetterReady,
    permanentlyFailed,
    staleStateCount,
  });

  return {
    health,
    generatedAt: metrics.generatedAt,
    windows: metrics.windows,
    retryPressure: {
      retryScheduled,
      retrying,
      deadLetterReady,
      permanentlyFailed,
      pressureScore: retryPressureScore,
    },
    reconciliation: {
      pending: reconciliationPending,
      processing: reconciliationProcessing,
      completed24h: reconciliationCompleted24h,
      failed24h: reconciliationFailed24h,
      scheduled: reconciliationDiagnostics.summary.scheduledReconciliationJobs,
      staleStateCount,
    },
    webhookHealth: {
      received: receivedWebhooks,
      processing: processingWebhooks,
      processed24h: last24h.processedWebhooks,
      failed24h: last24h.failedWebhooks,
      successRate24h: last24h.successRate,
    },
    staleStates: {
      stuckReceived: reconciliationDiagnostics.summary.stuckReceived,
      fulfillmentSyncFailures: reconciliationDiagnostics.summary.fulfillmentSyncFailures,
      missingPayload: reconciliationDiagnostics.summary.missingPayload,
      staleAllocations: reconciliationDiagnostics.summary.staleAllocations,
      scheduledReconciliationJobs: reconciliationDiagnostics.summary.scheduledReconciliationJobs,
      total: reconciliationDiagnostics.summary.total,
    },
    notes: buildHealthNotes({
      health,
      retryScheduled,
      deadLetterReady,
      permanentlyFailed,
      failedWebhooks24h: last24h.failedWebhooks,
      staleStateCount,
    }),
  };
}
