import { SopyoOrderPushStatus } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import type { AppEnv } from '../../config/env.js';
import { prisma } from '../../db/prisma.js';
import { dispatchSopyoOrderPush } from './sopyo-order-push-dispatch.service.js';

type WorkerDependencies = {
  db: Pick<typeof prisma, 'sopyoOrderPush'>;
  dispatch: typeof dispatchSopyoOrderPush;
};

type WorkerLogger = Pick<FastifyInstance['log'], 'info' | 'error'>;

/** Scan durable intent IDs only; Phase B retains the sole claim and send authority. */
export function createSopyoOrderPushWorker(input: {
  intervalMs: number;
  batchSize: number;
  logger: WorkerLogger;
  dependencies?: WorkerDependencies;
}) {
  if (!Number.isSafeInteger(input.intervalMs) || input.intervalMs < 1 || input.intervalMs > 2_147_483_647 ||
      !Number.isSafeInteger(input.batchSize) || input.batchSize < 1) {
    throw new Error('Invalid Sopyo order-push worker configuration.');
  }
  const db = input.dependencies?.db ?? prisma;
  const dispatch = input.dependencies?.dispatch ?? dispatchSopyoOrderPush;
  let timer: ReturnType<typeof globalThis.setInterval> | null = null;
  let activeCycle: Promise<void> | null = null;
  let stopping = false;

  function runCycle(): Promise<void> {
    if (stopping || activeCycle) return activeCycle ?? Promise.resolve();
    const cycle = (async () => {
      try {
        const pending = await db.sopyoOrderPush.findMany({
          where: { status: SopyoOrderPushStatus.PENDING },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          take: input.batchSize,
          select: { id: true },
        });
        for (const push of pending) {
          if (stopping) break;
          try {
            const result = await dispatch({ pushId: push.id });
            input.logger.info({ event: 'SOPYO_ORDER_PUSH_WORKER_RESULT', pushId: push.id,
              status: result.status, reasonCode: result.reasonCode, sopyoOrderId: result.sopyoOrderId },
            'Sopyo order-push worker dispatch completed.');
          } catch {
            // Provider exceptions and payloads must never reach worker logs.
            input.logger.error({ event: 'SOPYO_ORDER_PUSH_WORKER_DISPATCH_FAILED', pushId: push.id },
              'Sopyo order-push worker dispatch failed.');
          }
        }
      } catch {
        input.logger.error({ event: 'SOPYO_ORDER_PUSH_WORKER_SCAN_FAILED' },
          'Sopyo order-push worker scan failed.');
      }
    })();
    activeCycle = cycle;
    void cycle.finally(() => { activeCycle = null; });
    return cycle;
  }

  function start() {
    if (timer || stopping) return;
    timer = globalThis.setInterval(() => { void runCycle(); }, input.intervalMs);
    timer.unref?.();
    void runCycle();
  }

  async function close() {
    stopping = true;
    if (timer) {
      globalThis.clearInterval(timer);
      timer = null;
    }
    await activeCycle;
  }

  return { runCycle, start, close };
}

export function registerSopyoOrderPushWorker(app: FastifyInstance, env: AppEnv) {
  if (!env.SOPYO_ORDER_PUSH_WORKER_ENABLED) return null;
  if (!env.DATABASE_URL || !env.SOPYO_ORDER_PUSH_WORKER_INTERVAL_MS ||
      !env.SOPYO_ORDER_PUSH_WORKER_BATCH_SIZE) {
    throw new Error('Sopyo order-push worker requires DATABASE_URL, interval, and batch size.');
  }
  const worker = createSopyoOrderPushWorker({
    intervalMs: env.SOPYO_ORDER_PUSH_WORKER_INTERVAL_MS,
    batchSize: env.SOPYO_ORDER_PUSH_WORKER_BATCH_SIZE,
    logger: app.log,
  });
  app.addHook('onReady', async () => { worker.start(); });
  app.addHook('onClose', async () => { await worker.close(); });
  return worker;
}
