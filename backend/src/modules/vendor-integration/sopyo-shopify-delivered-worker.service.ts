import { SopyoDeliveredSyncStatus, SopyoShipmentIntentStatus } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import type { AppEnv } from '../../config/env.js';
import { prisma } from '../../db/prisma.js';
import { SOPYO_CARGO_SHOPIFY_SYNC_INTERVAL_MS } from './sopyo-delivery-poll.service.js';
import { processSopyoShopifyDeliveredSync } from './sopyo-shopify-delivered-sync.service.js';

export async function processSopyoShopifyDeliveredCandidates(input: {
  env: AppEnv; db?: Pick<typeof prisma, 'sopyoShipmentIntent'>;
  process?: typeof processSopyoShopifyDeliveredSync;
  logger?: Pick<FastifyInstance['log'], 'error'>;
}) {
  const report = { candidates: 0, confirmed: 0, rejected: 0, unknown: 0, skipped: 0, failed: 0 };
  if (input.env.SHOPIFY_API_VERSION !== '2026-01' || !input.env.SHOPIFY_SHOP_DOMAIN ||
      !input.env.SHOPIFY_ADMIN_ACCESS_TOKEN) return report;
  const db = input.db ?? prisma;
  const run = input.process ?? processSopyoShopifyDeliveredSync;
  const candidates = await db.sopyoShipmentIntent.findMany({
    where: { status: SopyoShipmentIntentStatus.CONFIRMED,
      shopifyFulfillmentId: { not: null },
      deliveredSyncStatus: { in: [SopyoDeliveredSyncStatus.SUBMISSION_PENDING,
        SopyoDeliveredSyncStatus.OUTCOME_UNKNOWN] },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 100,
    select: { id: true },
  });
  const unattempted = await db.sopyoShipmentIntent.findMany({
    where: { status: SopyoShipmentIntentStatus.CONFIRMED,
      shopifyFulfillmentId: { not: null }, deliveredSyncStatus: null,
      vendorAllocation: { deliveredObservation: { isNot: null } },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 100,
    select: { id: true },
  });
  for (const row of [...unattempted, ...candidates]) {
    report.candidates += 1;
    try {
      const result = await run({ intentId: row.id, env: input.env });
      if (result === 'confirmed') report.confirmed += 1;
      else if (result === 'rejected') report.rejected += 1;
      else if (result === 'outcome_unknown') report.unknown += 1;
      else report.skipped += 1;
    } catch {
      report.failed += 1;
      input.logger?.error({ event: 'SOPYO_SHOPIFY_DELIVERED_CANDIDATE_FAILED', intentId: row.id },
        'Sopyo Shopify Delivered sync candidate failed.');
    }
  }
  return report;
}

export function createSopyoShopifyDeliveredWorker(input: {
  env: AppEnv; logger: Pick<FastifyInstance['log'], 'info' | 'error'>;
  process?: typeof processSopyoShopifyDeliveredCandidates;
}) {
  const process = input.process ?? processSopyoShopifyDeliveredCandidates;
  let timer: ReturnType<typeof globalThis.setInterval> | null = null;
  let activeCycle: Promise<void> | null = null;
  let stopping = false;
  function runCycle(): Promise<void> {
    if (stopping || activeCycle) return activeCycle ?? Promise.resolve();
    const cycle = process({ env: input.env, logger: input.logger })
      .then((report) => input.logger.info(report, 'Sopyo Shopify Delivered sync completed.'))
      .catch(() => input.logger.error({ event: 'SOPYO_SHOPIFY_DELIVERED_SCAN_FAILED' },
        'Sopyo Shopify Delivered scan failed.'));
    activeCycle = cycle;
    void cycle.finally(() => { activeCycle = null; });
    return cycle;
  }
  function start() {
    if (timer || stopping) return;
    timer = globalThis.setInterval(() => { void runCycle(); }, SOPYO_CARGO_SHOPIFY_SYNC_INTERVAL_MS);
    timer.unref?.();
  }
  async function close() {
    stopping = true;
    if (timer) globalThis.clearInterval(timer);
    timer = null;
    await activeCycle;
  }
  return { runCycle, start, close };
}

export function registerSopyoShopifyDeliveredScheduler(app: FastifyInstance, env: AppEnv) {
  if (!env.SOPYO_DELIVERY_POLLING_ENABLED) return null;
  const worker = createSopyoShopifyDeliveredWorker({ env, logger: app.log });
  app.addHook('onReady', async () => { worker.start(); });
  app.addHook('onClose', async () => { await worker.close(); });
  return worker;
}
