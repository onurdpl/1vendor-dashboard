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
  | 'retrying'
  | 'dead_letter_ready'
  | 'permanently_failed';

export type OperationalJobFailureCategory =
  | 'transient'
  | 'validation'
  | 'reconciliation_required'
  | 'permanent'
  | 'duplicate_noop';

export type OperationalJobTypeLabel =
  | 'webhook_processing'
  | 'reconciliation'
  | 'replay'
  | 'recovery'
  | 'fulfillment_sync'
  | 'refund_sync'
  | 'return_sync';

export type OrdersCreateExecutorJobState =
  | 'processing'
  | 'retrying'
  | 'retry_scheduled'
  | 'completed'
  | 'failed'
  | 'permanently_failed'
  | 'dead_letter_ready';

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
  nextRetryAt: string | null;
  lastAttemptAt: string | null;
  retryBackoffMs: number | null;
  startedAt: string | null;
  completedAt: string | null;
  failedAt: string | null;
  errorSummary: string | null;
  failureCategory: OperationalJobFailureCategory | null;
  escalationReason: string | null;
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
  retrying: OperationalJobStatus.RETRYING,
  dead_letter_ready: OperationalJobStatus.DEAD_LETTER_READY,
  permanently_failed: OperationalJobStatus.PERMANENTLY_FAILED,
} satisfies Record<OperationalJobStatusLabel, OperationalJobStatus>;

const statusFromPrisma = {
  [OperationalJobStatus.PENDING]: 'pending',
  [OperationalJobStatus.PROCESSING]: 'processing',
  [OperationalJobStatus.COMPLETED]: 'completed',
  [OperationalJobStatus.FAILED]: 'failed',
  [OperationalJobStatus.RETRY_SCHEDULED]: 'retry_scheduled',
  [OperationalJobStatus.RETRYING]: 'retrying',
  [OperationalJobStatus.DEAD_LETTER_READY]: 'dead_letter_ready',
  [OperationalJobStatus.PERMANENTLY_FAILED]: 'permanently_failed',
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

export function buildOrdersCreateExecutorJobId(webhookEventId: string) {
  return `shopify-orders-create-executor-${webhookEventId}`;
}

export async function mirrorOrdersCreateExecutorJob(input: {
  webhookEventId: string;
  sourceShopifyOrderId: string;
  state: OrdersCreateExecutorJobState;
  attemptCount: number;
  maxAttempts: number;
  nextRetryAt?: Date | null;
  error?: unknown;
}) {
  const now = new Date();
  const status = statusToPrisma[input.state];
  const active = input.state === 'processing' || input.state === 'retrying';
  const completed = input.state === 'completed';
  const failed = !active && !completed;
  const failureCategory = input.state === 'retry_scheduled'
    ? 'transient'
    : input.state === 'permanently_failed'
      ? 'permanent'
      : failed
        ? 'reconciliation_required'
        : null;
  const errorSummary = input.error ? summarizeOperationalError(input.error) : null;
  const escalationReason = input.state === 'dead_letter_ready'
    ? `Execution attempts exhausted after ${input.attemptCount}/${input.maxAttempts}. Manual intervention required.`
    : input.state === 'retry_scheduled' && input.nextRetryAt
      ? `Retry scheduled for ${input.nextRetryAt.toISOString()}.`
      : input.state === 'permanently_failed'
        ? 'Permanent orders/create failure requires manual intervention.'
        : null;
  const data = {
    jobType: OperationalJobType.WEBHOOK_PROCESSING,
    status,
    payloadRef: `webhook-event:${input.webhookEventId}`,
    webhookEventId: input.webhookEventId,
    sourceShopifyOrderId: input.sourceShopifyOrderId,
    retryCount: input.attemptCount,
    maxRetries: input.maxAttempts,
    scheduledAt: input.nextRetryAt ?? now,
    nextRetryAt: input.state === 'retry_scheduled' ? input.nextRetryAt ?? null : null,
    lastAttemptAt: active || failed || completed ? now : null,
    startedAt: active ? now : undefined,
    completedAt: completed ? now : null,
    failedAt: failed ? now : null,
    errorSummary,
    failureCategory,
    escalationReason,
  };

  return prisma.operationalJob.upsert({
    where: { id: buildOrdersCreateExecutorJobId(input.webhookEventId) },
    update: data,
    create: {
      id: buildOrdersCreateExecutorJobId(input.webhookEventId),
      priority: 0,
      retryBackoffMs: 60_000,
      ...data,
    },
  });
}

function isFailureCategory(value: string | null): value is OperationalJobFailureCategory {
  return (
    value === 'transient' ||
    value === 'validation' ||
    value === 'reconciliation_required' ||
    value === 'permanent' ||
    value === 'duplicate_noop'
  );
}

export function classifyOperationalFailure(error: unknown): OperationalJobFailureCategory {
  const message = summarizeOperationalError(error).toLowerCase();

  if (message.includes('duplicate') || message.includes('already processed') || message.includes('no-op')) {
    return 'duplicate_noop';
  }

  if (
    message.includes('timeout') ||
    message.includes('timed out') ||
    message.includes('rate limit') ||
    message.includes('429') ||
    message.includes('503') ||
    message.includes('502') ||
    message.includes('network') ||
    message.includes('econn') ||
    message.includes('temporar')
  ) {
    return 'transient';
  }

  if (
    message.includes('seller_info') ||
    message.includes('canonical') ||
    message.includes('mapping') ||
    message.includes('reconciliation')
  ) {
    return 'reconciliation_required';
  }

  if (
    message.includes('missing') ||
    message.includes('invalid') ||
    message.includes('unknown vendor') ||
    message.includes('unresolved') ||
    message.includes('did not include') ||
    message.includes('not found')
  ) {
    return 'validation';
  }

  if (message.includes('permanent') || message.includes('not recoverable')) {
    return 'permanent';
  }

  return 'transient';
}

export function getRetryDelayMs(input: { retryCount: number; retryBackoffMs?: number | null }) {
  const baseDelayMs = input.retryBackoffMs ?? 60_000;
  const exponent = Math.max(0, input.retryCount);
  return Math.min(baseDelayMs * 2 ** exponent, 30 * 60_000);
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
    nextRetryAt: toIsoString(job.nextRetryAt),
    lastAttemptAt: toIsoString(job.lastAttemptAt),
    retryBackoffMs: job.retryBackoffMs,
    startedAt: toIsoString(job.startedAt),
    completedAt: toIsoString(job.completedAt),
    failedAt: toIsoString(job.failedAt),
    errorSummary: job.errorSummary,
    failureCategory: isFailureCategory(job.failureCategory) ? job.failureCategory : null,
    escalationReason: job.escalationReason,
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
      retryBackoffMs: 60_000,
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
      lastAttemptAt: new Date(),
      errorSummary: null,
      escalationReason: null,
    },
  });
}

export async function markOperationalJobRetrying(jobId: string | null | undefined) {
  if (!jobId) {
    return null;
  }

  return prisma.operationalJob.update({
    where: { id: jobId },
    data: {
      status: statusToPrisma.retrying,
      startedAt: new Date(),
      lastAttemptAt: new Date(),
      nextRetryAt: null,
      escalationReason: null,
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
      failureCategory: null,
      escalationReason: null,
      nextRetryAt: null,
    },
  });
}

export async function markOperationalJobFailed(
  jobId: string | null | undefined,
  error: unknown,
  options: {
    category?: OperationalJobFailureCategory;
    retryable?: boolean;
  } = {},
) {
  if (!jobId) {
    return null;
  }

  const job = await prisma.operationalJob.findUnique({
    where: { id: jobId },
    select: {
      retryCount: true,
      maxRetries: true,
      retryBackoffMs: true,
    },
  });

  if (!job) {
    return null;
  }

  const category = options.category ?? classifyOperationalFailure(error);
  const nextRetryCount = job.retryCount + 1;
  const canRetry =
    options.retryable !== false &&
    category === 'transient' &&
    nextRetryCount < job.maxRetries;
  const exhaustedRetries =
    options.retryable !== false &&
    category === 'transient' &&
    nextRetryCount >= job.maxRetries;
  const failedAt = new Date();
  const retryDelayMs = getRetryDelayMs({
    retryCount: job.retryCount,
    retryBackoffMs: job.retryBackoffMs,
  });
  const nextRetryAt = new Date(failedAt.getTime() + retryDelayMs);
  const status = exhaustedRetries
    ? statusToPrisma.dead_letter_ready
    : category === 'permanent'
      ? statusToPrisma.permanently_failed
      : canRetry
        ? statusToPrisma.retry_scheduled
        : statusToPrisma.failed;

  return prisma.operationalJob.update({
    where: { id: jobId },
    data: {
      status,
      retryCount: {
        increment: 1,
      },
      failedAt,
      lastAttemptAt: failedAt,
      nextRetryAt: canRetry ? nextRetryAt : null,
      retryBackoffMs: retryDelayMs,
      errorSummary: summarizeOperationalError(error),
      failureCategory: category,
      escalationReason: exhaustedRetries
        ? `Retry attempts exhausted after ${nextRetryCount}/${job.maxRetries}. Manual intervention required.`
        : canRetry
          ? `Transient failure scheduled for retry at ${nextRetryAt.toISOString()}.`
          : category === 'reconciliation_required'
            ? 'Canonical Shopify reconciliation or mapping review is required before retry.'
            : category === 'validation'
              ? 'Validation failure is not automatically retryable.'
              : category === 'duplicate_noop'
                ? 'Duplicate/no-op outcome is not automatically retryable.'
                : null,
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
      nextRetryAt: input.scheduledAt,
      lastAttemptAt: new Date(),
      retryCount: {
        increment: 1,
      },
      failedAt: new Date(),
      failureCategory: 'transient',
      escalationReason: `Retry scheduled for ${input.scheduledAt.toISOString()}.`,
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
      failureCategory: classifyOperationalFailure(error),
      escalationReason: 'Manual intervention required before another retry.',
      nextRetryAt: null,
    },
  });
}
