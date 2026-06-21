import type { FastifyInstance } from 'fastify';
import { OperationalJobStatus, OperationalJobType, type OperationalJob, type Prisma } from '@prisma/client';
import type { AppEnv } from '../../config/env.js';
import { prisma } from '../../db/prisma.js';
import {
  createOperationalJob,
  markOperationalJobCompleted,
  markOperationalJobFailed,
  markOperationalJobProcessing,
  serializeOperationalJob,
  type OperationalJobDto,
} from '../operational-jobs/operational-jobs.service.js';
import { createReconciliationService } from './reconciliation.service.js';
import type { OrderReconciliationResult } from './reconciliation.types.js';
import { isLedgerVoided } from '../finance/active-ledger-policy.service.js';
import { resolveActiveEconomicOwnerForRepair } from './reconciliation-transfer-policy.service.js';

export type ScheduledReconciliationCandidateType =
  | 'stale_allocation'
  | 'missing_refund_ledger'
  | 'tracking_mismatch'
  | 'cancelled_fulfillment_marked_fulfilled'
  | 'stale_shipment_timestamp'
  | 'retry_dead_letter'
  | 'reconciliation_overdue';

export type ScheduledReconciliationCandidate = {
  key: string;
  type: ScheduledReconciliationCandidateType;
  reason: string;
  source: 'scheduled_reconciliation';
  sourceShopifyOrderId: string | null;
  vendorAllocationId: string | null;
  refundRecordId?: string | null;
  returnRecordId?: string | null;
  priority: number;
  detectedAt: Date;
};

export type ScheduledReconciliationJobResult = {
  candidates: ScheduledReconciliationCandidate[];
  createdJobs: OperationalJobDto[];
  skippedCandidates: Array<{
    candidate: ScheduledReconciliationCandidate;
    reason: 'active_job' | 'cooldown';
    latestJobId: string;
  }>;
};

export type ScheduledReconciliationExecutionResult = {
  operationalJobId: string;
  status: 'completed' | 'failed' | 'skipped';
  result: OrderReconciliationResult | null;
  skippedReason?: string;
};

const ACTIVE_RECONCILIATION_JOB_STATUSES = new Set<OperationalJobStatus>([
  OperationalJobStatus.PENDING,
  OperationalJobStatus.PROCESSING,
  OperationalJobStatus.RETRY_SCHEDULED,
  OperationalJobStatus.RETRYING,
]);

const TERMINAL_RECONCILIATION_JOB_STATUSES = new Set<OperationalJobStatus>([
  OperationalJobStatus.COMPLETED,
  OperationalJobStatus.FAILED,
  OperationalJobStatus.DEAD_LETTER_READY,
  OperationalJobStatus.PERMANENTLY_FAILED,
]);

function toLower(value: string | null | undefined) {
  return (value ?? '').trim().toLowerCase();
}

function isFulfilledLike(value: string | null | undefined) {
  return toLower(value).includes('fulfilled');
}

function toCandidateKey(input: {
  type: ScheduledReconciliationCandidateType;
  sourceShopifyOrderId: string | null;
  vendorAllocationId: string | null;
  refundRecordId?: string | null;
}) {
  return [
    input.type,
    input.vendorAllocationId ? `allocation:${input.vendorAllocationId}` : null,
    input.refundRecordId ? `refund:${input.refundRecordId}` : null,
    input.sourceShopifyOrderId ? `order:${input.sourceShopifyOrderId}` : null,
  ].filter(Boolean).join(':');
}

export function buildScheduledReconciliationCandidate(input: Omit<ScheduledReconciliationCandidate, 'key' | 'source' | 'detectedAt'> & {
  detectedAt?: Date;
}): ScheduledReconciliationCandidate {
  return {
    ...input,
    key: toCandidateKey(input),
    source: 'scheduled_reconciliation',
    detectedAt: input.detectedAt ?? new Date(),
  };
}

export function isReconciliationJobActive(status: OperationalJobStatus | string) {
  return ACTIVE_RECONCILIATION_JOB_STATUSES.has(status as OperationalJobStatus);
}

export function isWithinReconciliationCooldown(input: {
  latestJobAt: Date | null;
  now: Date;
  cooldownMs: number;
}) {
  return Boolean(input.latestJobAt && input.now.getTime() - input.latestJobAt.getTime() < input.cooldownMs);
}

export function buildScheduledReconciliationPayload(candidate: ScheduledReconciliationCandidate): Prisma.InputJsonObject {
  return {
    source: candidate.source,
    candidateKey: candidate.key,
    candidateType: candidate.type,
    reason: candidate.reason,
    detectedAt: candidate.detectedAt.toISOString(),
  };
}

function getLatestOperationalJobTimestamp(job: Pick<OperationalJob, 'lastAttemptAt' | 'completedAt' | 'failedAt' | 'createdAt'>) {
  return job.lastAttemptAt ?? job.completedAt ?? job.failedAt ?? job.createdAt;
}

async function findLatestRelatedReconciliationJob(candidate: ScheduledReconciliationCandidate) {
  if (!candidate.vendorAllocationId && !candidate.sourceShopifyOrderId) {
    return null;
  }

  const linkageWhere = candidate.vendorAllocationId
    ? { vendorAllocationId: candidate.vendorAllocationId }
    : { sourceShopifyOrderId: candidate.sourceShopifyOrderId };

  return prisma.operationalJob.findFirst({
    where: {
      jobType: OperationalJobType.RECONCILIATION,
      ...linkageWhere,
    },
    orderBy: {
      createdAt: 'desc',
    },
  });
}

function dedupeCandidates(candidates: ScheduledReconciliationCandidate[]) {
  const byKey = new Map<string, ScheduledReconciliationCandidate>();

  for (const candidate of candidates) {
    const existing = byKey.get(candidate.key);
    if (!existing || candidate.priority > existing.priority) {
      byKey.set(candidate.key, candidate);
    }
  }

  return Array.from(byKey.values()).sort((left, right) => right.priority - left.priority);
}

export async function findScheduledReconciliationCandidates(options: {
  now?: Date;
  staleAfterMs?: number;
  limit?: number;
} = {}): Promise<ScheduledReconciliationCandidate[]> {
  const now = options.now ?? new Date();
  const staleAfterMs = options.staleAfterMs ?? 15 * 60 * 1000;
  const staleBefore = new Date(now.getTime() - staleAfterMs);
  const limit = options.limit ?? 25;

  const [staleAllocations, refundRecords, deadLetterJobs] = await Promise.all([
    prisma.vendorAllocation.findMany({
      where: {
        updatedAt: {
          lt: staleBefore,
        },
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
          {
            fulfillmentStatus: {
              in: ['fulfilled', 'partially_fulfilled'],
            },
            fulfillment: {
              syncStatus: {
                in: ['shopify_inbound_cancelled', 'shopify_reconciled_cancelled'],
              },
            },
          },
          {
            fulfillment: {
              syncStatus: 'fulfillment_sync_failed',
            },
          },
          {
            fulfillment: {
              trackingNumber: {
                not: null,
              },
              shipmentUpdatedAt: null,
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
        fulfillment: true,
      },
      orderBy: {
        updatedAt: 'asc',
      },
      take: limit,
    }),
    prisma.refundRecord.findMany({
      where: {
        updatedAt: {
          lt: staleBefore,
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
            financeEntries: {
              where: {
                entryType: 'refund',
              },
              select: {
                id: true,
                voidedAt: true,
              },
            },
          },
        },
      },
      orderBy: {
        updatedAt: 'asc',
      },
      take: limit,
    }),
    prisma.operationalJob.findMany({
      where: {
        jobType: {
          not: OperationalJobType.RECONCILIATION,
        },
        status: {
          in: [OperationalJobStatus.DEAD_LETTER_READY, OperationalJobStatus.PERMANENTLY_FAILED],
        },
        OR: [
          {
            vendorAllocationId: {
              not: null,
            },
          },
          {
            sourceShopifyOrderId: {
              not: null,
            },
          },
        ],
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
        updatedAt: 'asc',
      },
      take: limit,
    }),
  ]);

  const candidates: ScheduledReconciliationCandidate[] = [];

  for (const allocation of staleAllocations) {
    const fulfillmentSyncStatus = toLower(allocation.fulfillment?.syncStatus);
    const hasCancelledSync = fulfillmentSyncStatus === 'shopify_inbound_cancelled' ||
      fulfillmentSyncStatus === 'shopify_reconciled_cancelled';
    const hasTrackingMismatch = Boolean(
      allocation.trackingNumber &&
        allocation.fulfillment?.trackingNumber &&
        allocation.trackingNumber !== allocation.fulfillment.trackingNumber,
    );
    const hasStaleShipmentTimestamp = Boolean(allocation.fulfillment?.trackingNumber && !allocation.fulfillment.shipmentUpdatedAt);
    const candidateType: ScheduledReconciliationCandidateType = hasCancelledSync && isFulfilledLike(allocation.fulfillmentStatus)
      ? 'cancelled_fulfillment_marked_fulfilled'
      : hasTrackingMismatch
        ? 'tracking_mismatch'
        : hasStaleShipmentTimestamp
          ? 'stale_shipment_timestamp'
          : 'stale_allocation';

    candidates.push(buildScheduledReconciliationCandidate({
      type: candidateType,
      reason: candidateType === 'cancelled_fulfillment_marked_fulfilled'
        ? 'Local fulfillment state is still fulfilled while Shopify cancellation sync status is present.'
        : candidateType === 'tracking_mismatch'
          ? 'Allocation tracking metadata differs from persisted fulfillment tracking metadata.'
          : candidateType === 'stale_shipment_timestamp'
            ? 'Fulfillment tracking exists without a shipment update timestamp.'
            : 'Allocation has local fulfillment/tracking state that should be refreshed from canonical Shopify state.',
      sourceShopifyOrderId: allocation.order.sourceShopifyOrderId,
      vendorAllocationId: allocation.id,
      priority: candidateType === 'cancelled_fulfillment_marked_fulfilled' ? 9 : 7,
      detectedAt: now,
    }));
  }

  for (const refundRecord of refundRecords) {
    let expectedLedgerId: string | null = null;
    let ownerResolutionReason: string | null = null;
    try {
      const economicOwner = await resolveActiveEconomicOwnerForRepair({
        vendorAllocationId: refundRecord.vendorAllocationId,
      });
      expectedLedgerId = `fin-${economicOwner.economicOwnerVendorId}-refund-${refundRecord.sourceShopifyRefundId}`;
    } catch (error) {
      ownerResolutionReason = error instanceof Error ? error.message : 'Refund ledger owner resolution failed.';
    }

    const hasExpectedLedger = expectedLedgerId
      ? refundRecord.vendorAllocation.financeEntries.some((entry) => entry.id === expectedLedgerId && !isLedgerVoided(entry))
      : false;
    if (hasExpectedLedger) {
      continue;
    }

    candidates.push(buildScheduledReconciliationCandidate({
      type: 'missing_refund_ledger',
      reason: ownerResolutionReason
        ? `Refund ${refundRecord.sourceShopifyRefundId} cannot be repaired automatically: ${ownerResolutionReason}`
        : `Refund ${refundRecord.sourceShopifyRefundId} has no matching active operational finance ledger entry.`,
      sourceShopifyOrderId: refundRecord.vendorAllocation.order.sourceShopifyOrderId,
      vendorAllocationId: refundRecord.vendorAllocationId,
      refundRecordId: refundRecord.id,
      priority: 8,
      detectedAt: now,
    }));
  }

  for (const job of deadLetterJobs) {
    candidates.push(buildScheduledReconciliationCandidate({
      type: 'retry_dead_letter',
      reason: `Operational job ${job.id} reached ${job.status}; canonical reconciliation should confirm local state before more recovery.`,
      sourceShopifyOrderId: job.sourceShopifyOrderId ?? job.vendorAllocation?.order.sourceShopifyOrderId ?? null,
      vendorAllocationId: job.vendorAllocationId,
      refundRecordId: job.refundRecordId,
      returnRecordId: job.returnRecordId,
      priority: 6,
      detectedAt: now,
    }));
  }

  return dedupeCandidates(candidates).slice(0, limit);
}

export async function createScheduledReconciliationJobs(options: {
  now?: Date;
  cooldownMs?: number;
  limit?: number;
} = {}): Promise<ScheduledReconciliationJobResult> {
  const now = options.now ?? new Date();
  const cooldownMs = options.cooldownMs ?? 30 * 60 * 1000;
  const candidates = await findScheduledReconciliationCandidates({
    now,
    limit: options.limit,
  });
  const createdJobs: OperationalJobDto[] = [];
  const skippedCandidates: ScheduledReconciliationJobResult['skippedCandidates'] = [];

  for (const candidate of candidates) {
    const latestJob = await findLatestRelatedReconciliationJob(candidate);
    if (latestJob && isReconciliationJobActive(latestJob.status)) {
      skippedCandidates.push({
        candidate,
        reason: 'active_job',
        latestJobId: latestJob.id,
      });
      continue;
    }

    if (
      latestJob &&
      TERMINAL_RECONCILIATION_JOB_STATUSES.has(latestJob.status) &&
      isWithinReconciliationCooldown({
        latestJobAt: getLatestOperationalJobTimestamp(latestJob),
        now,
        cooldownMs,
      })
    ) {
      skippedCandidates.push({
        candidate,
        reason: 'cooldown',
        latestJobId: latestJob.id,
      });
      continue;
    }

    const job = await createOperationalJob({
      jobType: 'reconciliation',
      payload: buildScheduledReconciliationPayload(candidate),
      sourceShopifyOrderId: candidate.sourceShopifyOrderId,
      vendorAllocationId: candidate.vendorAllocationId,
      refundRecordId: candidate.refundRecordId ?? null,
      returnRecordId: candidate.returnRecordId ?? null,
      priority: candidate.priority,
      scheduledAt: now,
      maxRetries: 1,
    });
    createdJobs.push(serializeOperationalJob(job));
  }

  return {
    candidates,
    createdJobs,
    skippedCandidates,
  };
}

export async function executeScheduledReconciliationJob(
  env: AppEnv,
  operationalJobId: string,
): Promise<ScheduledReconciliationExecutionResult> {
  const job = await prisma.operationalJob.findUnique({
    where: {
      id: operationalJobId,
    },
  });

  if (!job || job.jobType !== OperationalJobType.RECONCILIATION) {
    return {
      operationalJobId,
      status: 'skipped',
      result: null,
      skippedReason: 'Reconciliation job not found.',
    };
  }

  if (!job.vendorAllocationId && !job.sourceShopifyOrderId) {
    await markOperationalJobFailed(job.id, 'Scheduled reconciliation job is missing allocation/order linkage.', {
      category: 'validation',
      retryable: false,
    });
    return {
      operationalJobId: job.id,
      status: 'failed',
      result: null,
      skippedReason: 'Missing allocation/order linkage.',
    };
  }

  await markOperationalJobProcessing(job.id);
  const reconciliationService = createReconciliationService(env);

  try {
    const result = job.vendorAllocationId
      ? await reconciliationService.reconcileAllocation(job.vendorAllocationId)
      : await reconciliationService.reconcileShopifyOrder(job.sourceShopifyOrderId as string);

    if (!result) {
      await markOperationalJobFailed(job.id, 'Scheduled reconciliation target was not found.', {
        category: 'validation',
        retryable: false,
      });
      return {
        operationalJobId: job.id,
        status: 'failed',
        result: null,
        skippedReason: 'Target not found.',
      };
    }

    await markOperationalJobCompleted(job.id);
    return {
      operationalJobId: job.id,
      status: 'completed',
      result,
    };
  } catch (error) {
    await markOperationalJobFailed(job.id, error);
    return {
      operationalJobId: job.id,
      status: 'failed',
      result: null,
      skippedReason: error instanceof Error ? error.message : 'Scheduled reconciliation failed.',
    };
  }
}

export async function executeDueScheduledReconciliationJobs(env: AppEnv, options: {
  now?: Date;
  limit?: number;
} = {}) {
  const now = options.now ?? new Date();
  const jobs = await prisma.operationalJob.findMany({
    where: {
      jobType: OperationalJobType.RECONCILIATION,
      status: OperationalJobStatus.PENDING,
      scheduledAt: {
        lte: now,
      },
    },
    orderBy: [
      {
        priority: 'desc',
      },
      {
        scheduledAt: 'asc',
      },
    ],
    take: options.limit ?? 5,
  });

  const results: ScheduledReconciliationExecutionResult[] = [];
  for (const job of jobs) {
    results.push(await executeScheduledReconciliationJob(env, job.id));
  }

  return results;
}

export async function runScheduledReconciliationCycle(env: AppEnv, options: {
  now?: Date;
  executeDueJobs?: boolean;
} = {}) {
  const scheduled = await createScheduledReconciliationJobs({
    now: options.now,
    cooldownMs: env.SCHEDULED_RECONCILIATION_COOLDOWN_MS,
    limit: env.SCHEDULED_RECONCILIATION_CANDIDATE_LIMIT,
  });
  const executed = options.executeDueJobs
    ? await executeDueScheduledReconciliationJobs(env, {
        now: options.now,
        limit: Math.min(5, env.SCHEDULED_RECONCILIATION_CANDIDATE_LIMIT),
      })
    : [];

  return {
    scheduled,
    executed,
  };
}

export function registerScheduledReconciliationScheduler(app: FastifyInstance, env: AppEnv) {
  if (!env.SCHEDULED_RECONCILIATION_ENABLED) {
    return;
  }

  let running = false;
  const interval = globalThis.setInterval(() => {
    if (running) {
      return;
    }

    running = true;
    void runScheduledReconciliationCycle(env, {
      executeDueJobs: env.SCHEDULED_RECONCILIATION_EXECUTE_DUE,
    })
      .then((result) => {
        app.log.info(
          {
            candidates: result.scheduled.candidates.length,
            createdJobs: result.scheduled.createdJobs.length,
            skippedCandidates: result.scheduled.skippedCandidates.length,
            executedJobs: result.executed.length,
          },
          'Scheduled reconciliation cycle completed.',
        );
      })
      .catch((error) => {
        app.log.error({ error }, 'Scheduled reconciliation cycle failed.');
      })
      .finally(() => {
        running = false;
      });
  }, env.SCHEDULED_RECONCILIATION_INTERVAL_MS);

  interval.unref?.();

  app.addHook('onClose', (_instance, done) => {
    globalThis.clearInterval(interval);
    done();
  });
}
