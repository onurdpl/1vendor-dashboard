import { SopyoOrderPushStatus, SopyoShipmentIntentStatus,
  VendorIntegrationProviderCode, VendorOutboundMethod } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import type { AppEnv } from '../../config/env.js';
import { prisma } from '../../db/prisma.js';
import { canonicalSopyoOrderId } from '../shipping/allocation-delivered-observation.service.js';
import { SOPYO_DELIVERY_POLL_INTERVAL_MS } from './sopyo-delivery-poll.service.js';
import { executeSopyoShopifyFulfillment } from './sopyo-shopify-fulfillment-execution.service.js';
import { planSopyoShopifyFulfillment } from './sopyo-shopify-fulfillment-plan.service.js';

const planningStatuses: SopyoShipmentIntentStatus[] = [SopyoShipmentIntentStatus.CARGO_VERIFIED,
  SopyoShipmentIntentStatus.SELECTION_PENDING];
const executionStatuses: SopyoShipmentIntentStatus[] = [SopyoShipmentIntentStatus.PLAN_READY,
  SopyoShipmentIntentStatus.SUBMISSION_PENDING, SopyoShipmentIntentStatus.OUTCOME_UNKNOWN,
  SopyoShipmentIntentStatus.RECONCILIATION_PENDING];
const candidateStatuses = [...planningStatuses, ...executionStatuses];
const projectedStatuses = new Set(['in transit', 'in_transit', 'shipped', 'partially_shipped',
  'out_for_delivery', 'delivered']);

type Dependencies = {
  db: Pick<typeof prisma, 'sopyoShipmentIntent'>;
  plan: typeof planSopyoShopifyFulfillment;
  execute: typeof executeSopyoShopifyFulfillment;
};

export type SopyoShopifySyncReport = {
  candidateCount: number;
  planned: number;
  executed: number;
  reconciled: number;
  confirmed: number;
  skipped: number;
  failed: number;
};

/** Routes durable intent states only. Planner and executor retain all Shopify authority and fences. */
export async function processSopyoShopifySync(input: {
  env: AppEnv;
  dependencies?: Dependencies;
  logger?: Pick<FastifyInstance['log'], 'error'>;
}): Promise<SopyoShopifySyncReport> {
  const report: SopyoShopifySyncReport = {
    candidateCount: 0, planned: 0, executed: 0, reconciled: 0,
    confirmed: 0, skipped: 0, failed: 0,
  };
  // The planner is read-only externally but uses the configured Shopify client.
  // Fail before either service can read/mutate Shopify with an unsupported API version.
  if (input.env.SHOPIFY_API_VERSION !== '2026-01' || !input.env.SHOPIFY_SHOP_DOMAIN ||
      !input.env.SHOPIFY_ADMIN_ACCESS_TOKEN) {
    input.logger?.error({ event: 'SOPYO_SHOPIFY_SYNC_CONFIG_UNAVAILABLE' },
      'Sopyo Shopify sync requires Shopify Admin API 2026-01.');
    return report;
  }
  const db = input.dependencies?.db ?? prisma;
  const plan = input.dependencies?.plan ?? planSopyoShopifyFulfillment;
  const execute = input.dependencies?.execute ?? executeSopyoShopifyFulfillment;
  const candidates = await db.sopyoShipmentIntent.findMany({
    where: { status: { in: candidateStatuses } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true, status: true, vendorAllocationId: true, assignedVendorId: true,
      sopyoOrderPushId: true, sopyoOrderId: true, orderCode: true,
      carrier: true, trackingNumber: true, shopifyLocationGid: true,
      shopifyFulfillmentId: true, executionPlan: { select: { id: true } },
      sopyoOrderPush: { select: { id: true, vendorAllocationId: true, assignedVendorId: true,
        orderCode: true, status: true, sopyoOrderId: true } },
      vendorAllocation: { select: {
        id: true, assignedVendorId: true, allocationStatus: true, cancellationReason: true,
        reassignmentRequired: true, outboundMethodSnapshot: true,
        outboundIntegrationProviderSnapshot: true, shopifyLocationGidSnapshot: true,
        carrier: true, trackingNumber: true, shippingStatus: true,
      } },
    },
  });
  report.candidateCount = candidates.length;
  for (const intent of candidates) {
    const allocation = intent.vendorAllocation;
    const push = intent.sopyoOrderPush;
    const localProjectionValid = allocation.carrier === intent.carrier &&
      allocation.trackingNumber === intent.trackingNumber &&
      projectedStatuses.has(allocation.shippingStatus.trim().toLowerCase());
    if (intent.shopifyFulfillmentId || !intent.carrier.trim() || !intent.trackingNumber.trim() ||
        !localProjectionValid || !intent.shopifyLocationGid?.trim() ||
        allocation.id !== intent.vendorAllocationId || allocation.assignedVendorId !== intent.assignedVendorId ||
        allocation.allocationStatus !== 'ACTIVE' || allocation.cancellationReason ||
        allocation.reassignmentRequired ||
        allocation.outboundMethodSnapshot !== VendorOutboundMethod.VENDOR_INTEGRATION ||
        allocation.outboundIntegrationProviderSnapshot !== VendorIntegrationProviderCode.SOPYO ||
        allocation.shopifyLocationGidSnapshot !== intent.shopifyLocationGid ||
        push.id !== intent.sopyoOrderPushId || push.status !== SopyoOrderPushStatus.SUCCEEDED ||
        push.vendorAllocationId !== allocation.id || push.assignedVendorId !== allocation.assignedVendorId ||
        push.orderCode !== allocation.id || intent.orderCode !== allocation.id ||
        !canonicalSopyoOrderId(push.sopyoOrderId) || push.sopyoOrderId !== intent.sopyoOrderId) {
      report.skipped += 1;
      input.logger?.error({ event: 'SOPYO_SHOPIFY_SYNC_AUTHORITY_UNAVAILABLE', intentId: intent.id },
        'Sopyo Shopify sync candidate failed local authority checks.');
      continue;
    }
    try {
      if (planningStatuses.includes(intent.status) && !intent.executionPlan) {
        await plan({ intentId: intent.id, env: input.env });
        report.planned += 1;
        // The planner commits PLAN_READY atomically with its plan. The executor
        // re-reads both and revalidates canonical Shopify state before submission.
        const result = await execute({ intentId: intent.id, env: input.env });
        report.executed += 1;
        if (result.status === SopyoShipmentIntentStatus.CONFIRMED) report.confirmed += 1;
      } else if (executionStatuses.includes(intent.status) && intent.executionPlan) {
        const result = await execute({ intentId: intent.id, env: input.env });
        if (intent.status === SopyoShipmentIntentStatus.PLAN_READY) report.executed += 1;
        else report.reconciled += 1;
        if (result.status === SopyoShipmentIntentStatus.CONFIRMED) report.confirmed += 1;
      } else {
        // A plan/status disagreement is not permission to rebuild or submit.
        report.skipped += 1;
      }
    } catch {
      // Never log Shopify response bodies, tracking, credentials, or exception text.
      report.failed += 1;
      input.logger?.error({ event: 'SOPYO_SHOPIFY_SYNC_CANDIDATE_FAILED', intentId: intent.id },
        'Sopyo Shopify sync candidate failed.');
    }
  }
  return report;
}

export function createSopyoShopifySyncWorker(input: {
  env: AppEnv;
  logger: Pick<FastifyInstance['log'], 'info' | 'error'>;
  process?: typeof processSopyoShopifySync;
}) {
  const process = input.process ?? processSopyoShopifySync;
  let timer: ReturnType<typeof globalThis.setInterval> | null = null;
  let activeCycle: Promise<void> | null = null;
  let stopping = false;

  function runCycle(): Promise<void> {
    if (stopping || activeCycle) return activeCycle ?? Promise.resolve();
    const cycle = process({ env: input.env, logger: input.logger })
      .then((report) => input.logger.info(report, 'Sopyo Shopify sync polling completed.'))
      .catch(() => input.logger.error({ event: 'SOPYO_SHOPIFY_SYNC_SCAN_FAILED' },
        'Sopyo Shopify sync polling failed.'));
    activeCycle = cycle;
    void cycle.finally(() => { activeCycle = null; });
    return cycle;
  }

  function start() {
    if (timer || stopping) return;
    timer = globalThis.setInterval(() => { void runCycle(); }, SOPYO_DELIVERY_POLL_INTERVAL_MS);
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

export function registerSopyoShopifySyncScheduler(app: FastifyInstance, env: AppEnv) {
  if (!env.SOPYO_DELIVERY_POLLING_ENABLED) return null;
  const worker = createSopyoShopifySyncWorker({ env, logger: app.log });
  app.addHook('onReady', async () => { worker.start(); });
  app.addHook('onClose', async () => { await worker.close(); });
  return worker;
}
