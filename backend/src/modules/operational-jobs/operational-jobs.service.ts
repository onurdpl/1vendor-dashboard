import {
  OperationalJobStatus,
  OperationalJobType,
  type OperationalJob,
  type Prisma,
} from '@prisma/client';
import { prisma } from '../../db/prisma.js';

export type OperationalJobStatusLabel =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'retry_scheduled'
  | 'dead_letter_ready';

export type OperationalJobTypeLabel =
  | 'webhook_processing'
  | 'reconciliation'
  | 'replay'
  | 'recovery'
  | 'fulfillment_sync'
  | 'refund_sync'
  | 'return_sync';

export type OperationalJobDto = {
  id: string;
  jobType: OperationalJobTypeLabel;
  status: OperationalJobStatusLabel;
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
  startedAt: string | null;
  completedAt: string | null;
  failedAt: string | null;
  errorSummary: string | null;
  createdAt: string;
  updatedAt: string;
};

type CreateOperationalJobInput = {
  jobType: OperationalJobTypeLabel;
  payload?: Prisma.InputJsonValue;
  payloadRef?: string | null;
  webhookEventId?: string | null;
  sourceShopifyOrderId?: string | null;
  vendorAllocationId?: string | null;
  refundRecordId?: string | null;
  returnRecordId?: string | null;
  priority?: number;
  scheduledAt?: Date;
  maxRetries?: number;
};

const statusToPrisma = {
  pending: OperationalJobStatus.PENDING,
  processing: OperationalJobStatus.PROCESSING,
  completed: OperationalJobStatus.COMPLETED,
  failed: OperationalJobStatus.FAILED,
  retry_scheduled: OperationalJobStatus.RETRY_SCHEDULED,
  dead_letter_ready: OperationalJobStatus.DEAD_LETTER_READY,
} satisfies Record<OperationalJobStatusLabel, OperationalJobStatus>;

const statusFromPrisma = {
  [OperationalJobStatus.PENDING]: 'pending',
  [OperationalJobStatus.PROCESSING]: 'processing',
  [OperationalJobStatus.COMPLETED]: 'completed',
  [OperationalJobStatus.FAILED]: 'failed',
  [OperationalJobStatus.RETRY_SCHEDULED]: 'retry_scheduled',
  [OperationalJobStatus.DEAD_LETTER_READY]: 'dead_letter_ready',
} satisfies Record<OperationalJobStatus, OperationalJobStatusLabel>;

const typeToPrisma = {
  webhook_processing: OperationalJobType.WEBHOOK_PROCESSING,
  reconciliation: OperationalJobType.RECONCILIATION,
  replay: OperationalJobType.REPLAY,
  recovery: OperationalJobType.RECOVERY,
  fulfillment_sync: OperationalJobType.FULFILLMENT_SYNC,
  refund_sync: OperationalJobType.REFUND_SYNC,
  return_sync: OperationalJobType.RETURN_SYNC,
} satisfies Record<OperationalJobTypeLabel, OperationalJobType>;

const typeFromPrisma = {
  [OperationalJobType.WEBHOOK_PROCESSING]: 'webhook_processing',
  [OperationalJobType.RECONCILIATION]: 'reconciliation',
  [OperationalJobType.REPLAY]: 'replay',
  [OperationalJobType.RECOVERY]: 'recovery',
  [OperationalJobType.FULFILLMENT_SYNC]: 'fulfillment_sync',
  [OperationalJobType.REFUND_SYNC]: 'refund_sync',
  [OperationalJobType.RETURN_SYNC]: 'return_sync',
} satisfies Record<OperationalJobType, OperationalJobTypeLabel>;

function toIsoString(value: Date | null) {
  return value ? value.toISOString() : null;
}

function summarizeOperationalError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || 'Operational job failed.');
  return message.length > 500 ? `${message.slice(0, 497)}...` : message;
}

export async function runBestEffortOperationalJobMutation<T>(
  operation: () => Promise<T>,
  onError?: (error: unknown) => void,
) {
  try {
    return await operation();
  } catch (error) {
    onError?.(error);
    return null;
  }
}

export function inferOperationalJobTypeForWebhookTopic(topic: string): OperationalJobTypeLabel {
  if (topic === 'refunds/create') {
    return 'refund_sync';
  }

  if (topic.startsWith('returns/')) {
    return 'return_sync';
  }

  if (
    topic.startsWith('fulfillments/') ||
    topic.startsWith('fulfillment_events/') ||
    topic.startsWith('fulfillment_orders/')
  ) {
    return 'fulfillment_sync';
  }

  return 'webhook_processing';
}

export function serializeOperationalJob(job: OperationalJob): OperationalJobDto {
  return {
    id: job.id,
    jobType: typeFromPrisma[job.jobType],
    status: statusFromPrisma[job.status],
    payloadRef: job.payloadRef,
    webhookEventId: job.webhookEventId,
    sourceShopifyOrderId: job.sourceShopifyOrderId,
    vendorAllocationId: job.vendorAllocationId,
    refundRecordId: job.refundRecordId,
    returnRecordId: job.returnRecordId,
    priority: job.priority,
    retryCount: job.retryCount,
    maxRetries: job.maxRetries,
    scheduledAt: job.scheduledAt.toISOString(),
    startedAt: toIsoString(job.startedAt),
    completedAt: toIsoString(job.completedAt),
    failedAt: toIsoString(job.failedAt),
    errorSummary: job.errorSummary,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
  };
}

export async function createOperationalJob(input: CreateOperationalJobInput) {
  return prisma.operationalJob.create({
    data: {
      jobType: typeToPrisma[input.jobType],
      status: statusToPrisma.pending,
      payload: input.payload,
      payloadRef: input.payloadRef ?? null,
      webhookEventId: input.webhookEventId ?? null,
      sourceShopifyOrderId: input.sourceShopifyOrderId ?? null,
      vendorAllocationId: input.vendorAllocationId ?? null,
      refundRecordId: input.refundRecordId ?? null,
      returnRecordId: input.returnRecordId ?? null,
      priority: input.priority ?? 0,
      scheduledAt: input.scheduledAt ?? new Date(),
      maxRetries: input.maxRetries ?? 3,
    },
  });
}

export async function createWebhookOperationalJob(input: {
  topic: string;
  webhookEventId: string;
  payloadRef?: string | null;
  sourceShopifyOrderId?: string | null;
}) {
  return createOperationalJob({
    jobType: inferOperationalJobTypeForWebhookTopic(input.topic),
    webhookEventId: input.webhookEventId,
    payloadRef: input.payloadRef ?? null,
    sourceShopifyOrderId: input.sourceShopifyOrderId ?? null,
  });
}

export async function markOperationalJobProcessing(jobId: string | null | undefined) {
  if (!jobId) {
    return null;
  }

  return prisma.operationalJob.update({
    where: { id: jobId },
    data: {
      status: statusToPrisma.processing,
      startedAt: new Date(),
      errorSummary: null,
    },
  });
}

export async function markOperationalJobCompleted(jobId: string | null | undefined) {
  if (!jobId) {
    return null;
  }

  return prisma.operationalJob.update({
    where: { id: jobId },
    data: {
      status: statusToPrisma.completed,
      completedAt: new Date(),
      failedAt: null,
      errorSummary: null,
    },
  });
}

export async function markOperationalJobFailed(jobId: string | null | undefined, error: unknown) {
  if (!jobId) {
    return null;
  }

  return prisma.operationalJob.update({
    where: { id: jobId },
    data: {
      status: statusToPrisma.failed,
      retryCount: {
        increment: 1,
      },
      failedAt: new Date(),
      errorSummary: summarizeOperationalError(error),
    },
  });
}

export async function markOperationalJobRetryScheduled(
  jobId: string,
  input: {
    scheduledAt: Date;
    error?: unknown;
  },
) {
  return prisma.operationalJob.update({
    where: { id: jobId },
    data: {
      status: statusToPrisma.retry_scheduled,
      scheduledAt: input.scheduledAt,
      retryCount: {
        increment: 1,
      },
      failedAt: new Date(),
      errorSummary: input.error ? summarizeOperationalError(input.error) : undefined,
    },
  });
}

export async function markOperationalJobDeadLetterReady(jobId: string, error: unknown) {
  return prisma.operationalJob.update({
    where: { id: jobId },
    data: {
      status: statusToPrisma.dead_letter_ready,
      retryCount: {
        increment: 1,
      },
      failedAt: new Date(),
      errorSummary: summarizeOperationalError(error),
    },
  });
}
