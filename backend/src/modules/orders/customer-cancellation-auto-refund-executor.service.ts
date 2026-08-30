import type { FastifyInstance } from 'fastify';
import { OperationalJobStatus, OperationalJobType } from '@prisma/client';
import type { AppEnv } from '../../config/env.js';
import { prisma } from '../../db/prisma.js';
import {
  createCustomerCancellationAutoRefundService,
  type CustomerCancellationAutoRefundProcessResult,
} from './customer-cancellation-auto-refund.service.js';

type Logger = Pick<FastifyInstance['log'], 'info' | 'warn' | 'error'>;

function safeError(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).replace(/[\r\n]+/g, ' ').slice(0, 500);
}

export function createCustomerCancellationAutoRefundExecutor(input: {
  env: AppEnv;
  logger: Logger;
  processItem?: (itemId: string) => Promise<CustomerCancellationAutoRefundProcessResult>;
}) {
  const intervalMs = input.env.CUSTOMER_CANCELLATION_AUTO_REFUND_INTERVAL_MS ?? 5_000;
  const batchSize = input.env.CUSTOMER_CANCELLATION_AUTO_REFUND_BATCH_SIZE ?? 5;
  const leaseMs = input.env.CUSTOMER_CANCELLATION_AUTO_REFUND_LEASE_MS ?? 60_000;
  const processItem = input.processItem ?? createCustomerCancellationAutoRefundService(input.env).processItem;
  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;
  let closing = false;

  async function discover() {
    const now = new Date();
    return prisma.operationalJob.findMany({
      where: {
        jobType: OperationalJobType.REFUND_SYNC,
        customerCancellationRequestItemId: { not: null },
        OR: [
          { status: OperationalJobStatus.PENDING, scheduledAt: { lte: now } },
          { status: OperationalJobStatus.RETRY_SCHEDULED, nextRetryAt: { lte: now } },
          { status: OperationalJobStatus.PROCESSING, processingLeaseExpiresAt: { lt: now } },
        ],
      },
      orderBy: [{ priority: 'desc' }, { scheduledAt: 'asc' }],
      take: batchSize,
    });
  }

  async function claim(job: Awaited<ReturnType<typeof discover>>[number]) {
    const now = new Date();
    const generation = job.processingGeneration + 1;
    const result = await prisma.operationalJob.updateMany({
      where: { id: job.id, status: job.status, processingGeneration: job.processingGeneration },
      data: {
        status: OperationalJobStatus.PROCESSING,
        processingGeneration: generation,
        processingLeaseExpiresAt: new Date(now.getTime() + leaseMs),
        startedAt: now,
        lastAttemptAt: now,
        retryCount: { increment: 1 },
        errorSummary: null,
      },
    });
    return result.count === 1 ? { jobId: job.id, generation, attempt: job.retryCount + 1, maxRetries: job.maxRetries } : null;
  }

  async function finish(ownership: NonNullable<Awaited<ReturnType<typeof claim>>>, outcome: CustomerCancellationAutoRefundProcessResult, error?: string) {
    const now = new Date();
    const terminal = outcome === 'TERMINAL_EXCEPTION' || ownership.attempt >= ownership.maxRetries;
    const completed = outcome === 'COMPLETED' || outcome === 'SKIPPED';
    const backoff = Math.min(15 * 60_000, 5_000 * 2 ** Math.max(0, ownership.attempt - 1));
    await prisma.operationalJob.updateMany({
      where: { id: ownership.jobId, status: OperationalJobStatus.PROCESSING, processingGeneration: ownership.generation },
      data: completed ? {
        status: OperationalJobStatus.COMPLETED,
        completedAt: now,
        processingLeaseExpiresAt: null,
      } : terminal ? {
        status: OperationalJobStatus.FAILED,
        failedAt: now,
        processingLeaseExpiresAt: null,
        failureCategory: outcome === 'TERMINAL_EXCEPTION' ? 'CUSTOMER_CANCELLATION_EXCEPTION' : 'RETRIES_EXHAUSTED',
        errorSummary: error ?? outcome,
        escalationReason: 'Customer cancellation remains held for Admin Review.',
      } : {
        status: OperationalJobStatus.RETRY_SCHEDULED,
        nextRetryAt: new Date(now.getTime() + backoff),
        retryBackoffMs: backoff,
        processingLeaseExpiresAt: null,
        errorSummary: error ?? outcome,
      },
    });
  }

  async function runCycle() {
    if (running || closing) return { candidates: 0, claimed: 0 };
    running = true;
    let claimed = 0;
    try {
      const candidates = await discover();
      for (const job of candidates) {
        if (closing || !job.customerCancellationRequestItemId) break;
        const ownership = await claim(job);
        if (!ownership) continue;
        claimed += 1;
        const heartbeat = setInterval(() => {
          void prisma.operationalJob.updateMany({
            where: { id: ownership.jobId, status: OperationalJobStatus.PROCESSING, processingGeneration: ownership.generation },
            data: { processingLeaseExpiresAt: new Date(Date.now() + leaseMs) },
          });
        }, Math.max(1_000, Math.floor(leaseMs / 3)));
        heartbeat.unref?.();
        try {
          const outcome = await processItem(job.customerCancellationRequestItemId);
          await finish(ownership, outcome);
        } catch (error) {
          input.logger.error({ event: 'CUSTOMER_CANCELLATION_AUTO_REFUND_ATTEMPT_FAILED', jobId: job.id, errorMessage: safeError(error) }, 'Customer cancellation auto-refund attempt failed.');
          await finish(ownership, 'RETRYABLE', safeError(error));
        } finally {
          clearInterval(heartbeat);
        }
      }
      return { candidates: candidates.length, claimed };
    } finally {
      running = false;
    }
  }

  function start() {
    if (timer || closing) return;
    timer = setInterval(() => void runCycle(), intervalMs);
    timer.unref?.();
    void runCycle();
    input.logger.info({ event: 'CUSTOMER_CANCELLATION_AUTO_REFUND_EXECUTOR_STARTED' }, 'Customer cancellation auto-refund executor started.');
  }

  async function close() {
    closing = true;
    if (timer) clearInterval(timer);
    timer = null;
    while (running) await new Promise((resolve) => setTimeout(resolve, 25));
  }

  return { start, close, runCycle, isRunning: () => running };
}

export function registerCustomerCancellationAutoRefundExecutor(app: FastifyInstance, env: AppEnv) {
  if (!env.CUSTOMER_CANCELLATION_AUTO_REFUND_ENABLED || !env.DATABASE_URL) return null;
  const executor = createCustomerCancellationAutoRefundExecutor({ env, logger: app.log });
  app.addHook('onReady', async () => executor.start());
  app.addHook('onClose', async () => executor.close());
  return executor;
}
