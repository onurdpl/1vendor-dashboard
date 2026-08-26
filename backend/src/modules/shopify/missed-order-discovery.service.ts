import {
  OperationalJobStatus,
  OperationalSignalSeverity,
  OperationalSignalSourceArea,
  OperationalSignalStatus,
  Prisma,
} from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import type { AppEnv } from '../../config/env.js';
import { prisma } from '../../db/prisma.js';
import { createShopifyAdminService } from './shopify-admin.service.js';
import type { RecentShopifyOrderIdentity } from './shopify-admin.types.js';

export const MISSED_ORDER_DISCOVERY_PAGE_SIZE = 100;
export const MISSED_ORDER_DISCOVERY_INTERVAL_MS = 15 * 60 * 1000;
export const MISSED_ORDER_DISCOVERY_LOOKBACK_DAYS = 7;
export const MISSED_ORDER_DISCOVERY_GRACE_PERIOD_MS = 15 * 60 * 1000;
export const MISSED_ORDER_DISCOVERY_MAX_ORDERS = 1000;
export const MISSED_ORDER_SIGNAL_TYPE = 'shopify_order_missing_local';
export const MISSED_ORDER_SIGNAL_RULE_KEY = 'diagnostics.shopify_order_missing_local';
const DISCOVERY_FAILURE_SIGNAL_ID = 'signal-diagnostics-shopify-order-discovery-run-failed';
const DISCOVERY_TRUNCATION_SIGNAL_ID = 'signal-diagnostics-shopify-order-discovery-truncated';
const ACTIVE_JOB_STATUSES = [
  OperationalJobStatus.PENDING,
  OperationalJobStatus.PROCESSING,
  OperationalJobStatus.RETRY_SCHEDULED,
  OperationalJobStatus.RETRYING,
];

function sanitizeSignalPart(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unknown';
}

export function buildMissedOrderSignalId(sourceShopifyOrderId: string) {
  return `signal-diagnostics-shopify-order-missing-local-${sanitizeSignalPart(sourceShopifyOrderId)}`;
}

type DiscoveryOptions = {
  now?: Date;
  lookbackDays?: number;
  gracePeriodMs?: number;
  maxOrders?: number;
  beforeSignalWrite?: (order: RecentShopifyOrderIdentity) => void | Promise<void>;
};

export type MissedOrderDiscoveryReport = {
  complete: boolean;
  truncated: boolean;
  ordersScanned: number;
  missingOrders: number;
  deferredOrders: number;
  errors: string[];
};

async function upsertRunSignal(input: {
  id: string;
  type: string;
  severity: OperationalSignalSeverity;
  title: string;
  description: string;
  suggestedAction: string;
  metadata: Prisma.InputJsonObject;
}) {
  const observedAt = new Date();
  await prisma.operationalSignal.upsert({
    where: { id: input.id },
    update: {
      type: input.type,
      severity: input.severity,
      sourceArea: OperationalSignalSourceArea.DIAGNOSTICS,
      title: input.title,
      description: input.description,
      suggestedAction: input.suggestedAction,
      status: OperationalSignalStatus.ACTIVE,
      ruleKey: input.type,
      resolvedAt: null,
      metadata: input.metadata,
    },
    create: {
      id: input.id,
      type: input.type,
      severity: input.severity,
      sourceArea: OperationalSignalSourceArea.DIAGNOSTICS,
      title: input.title,
      description: input.description,
      suggestedAction: input.suggestedAction,
      status: OperationalSignalStatus.ACTIVE,
      ruleKey: input.type,
      triggeredAt: observedAt,
      metadata: input.metadata,
    },
  });
}

async function resolveSignal(id: string) {
  await prisma.operationalSignal.updateMany({
    where: {
      id,
      status: { in: [OperationalSignalStatus.ACTIVE, OperationalSignalStatus.ACKNOWLEDGED] },
    },
    data: { status: OperationalSignalStatus.RESOLVED, resolvedAt: new Date() },
  });
}

async function upsertMissingOrderSignal(order: RecentShopifyOrderIdentity, observedAt: Date) {
  const id = buildMissedOrderSignalId(order.sourceShopifyOrderId);
  const existing = await prisma.operationalSignal.findUnique({ where: { id }, select: { triggeredAt: true } });
  const firstDetectedAt = existing?.triggeredAt ?? observedAt;
  const metadata: Prisma.InputJsonObject = {
    sourceShopifyOrderId: order.sourceShopifyOrderId,
    shopifyOrderGid: order.orderGid,
    sourceShopifyOrderNumber: order.sourceShopifyOrderNumber,
    shopifyCreatedAt: order.shopifyCreatedAt,
    firstDetectedAt: firstDetectedAt.toISOString(),
    lastObservedAt: observedAt.toISOString(),
    discoveryRuleVersion: 1,
  };

  await prisma.operationalSignal.upsert({
    where: { id },
    update: {
      type: MISSED_ORDER_SIGNAL_TYPE,
      severity: OperationalSignalSeverity.CRITICAL,
      sourceArea: OperationalSignalSourceArea.DIAGNOSTICS,
      title: `Shopify order ${order.sourceShopifyOrderNumber} is missing locally`,
      description: 'Shopify contains this order, but no local ShopifyOrder exists after the discovery grace period.',
      suggestedAction: 'Inspect this order in Recovery Center, run Current-State Repair dry-run, review, then explicitly confirm repair if safe.',
      status: OperationalSignalStatus.ACTIVE,
      ruleKey: MISSED_ORDER_SIGNAL_RULE_KEY,
      resolvedAt: null,
      metadata,
    },
    create: {
      id,
      type: MISSED_ORDER_SIGNAL_TYPE,
      severity: OperationalSignalSeverity.CRITICAL,
      sourceArea: OperationalSignalSourceArea.DIAGNOSTICS,
      title: `Shopify order ${order.sourceShopifyOrderNumber} is missing locally`,
      description: 'Shopify contains this order, but no local ShopifyOrder exists after the discovery grace period.',
      suggestedAction: 'Inspect this order in Recovery Center, run Current-State Repair dry-run, review, then explicitly confirm repair if safe.',
      ruleKey: MISSED_ORDER_SIGNAL_RULE_KEY,
      triggeredAt: observedAt,
      metadata,
    },
  });
}

async function resolveExistingMissingOrderSignals() {
  const signals = await prisma.operationalSignal.findMany({
    where: {
      type: MISSED_ORDER_SIGNAL_TYPE,
      status: { in: [OperationalSignalStatus.ACTIVE, OperationalSignalStatus.ACKNOWLEDGED] },
    },
    select: { id: true, metadata: true },
  });
  const bySourceId = new Map<string, string>();
  for (const signal of signals) {
    const metadata = signal.metadata && typeof signal.metadata === 'object' && !Array.isArray(signal.metadata)
      ? signal.metadata as Record<string, unknown>
      : null;
    const sourceId = metadata && typeof metadata.sourceShopifyOrderId === 'string'
      ? metadata.sourceShopifyOrderId
      : null;
    if (sourceId) bySourceId.set(sourceId, signal.id);
  }
  if (!bySourceId.size) return;
  const localOrders = await prisma.shopifyOrder.findMany({
    where: { sourceShopifyOrderId: { in: [...bySourceId.keys()] } },
    select: { sourceShopifyOrderId: true },
  });
  await Promise.all(localOrders.map((order) => resolveSignal(bySourceId.get(order.sourceShopifyOrderId) as string)));
}

export async function runMissedOrderDiscovery(env: AppEnv, options: DiscoveryOptions = {}): Promise<MissedOrderDiscoveryReport> {
  const now = options.now ?? new Date();
  const lookbackDays = options.lookbackDays ?? env.SHOPIFY_MISSED_ORDER_DISCOVERY_LOOKBACK_DAYS ?? MISSED_ORDER_DISCOVERY_LOOKBACK_DAYS;
  const gracePeriodMs = options.gracePeriodMs ?? env.SHOPIFY_MISSED_ORDER_DISCOVERY_GRACE_PERIOD_MS ?? MISSED_ORDER_DISCOVERY_GRACE_PERIOD_MS;
  const maxOrders = options.maxOrders ?? env.SHOPIFY_MISSED_ORDER_DISCOVERY_MAX_ORDERS ?? MISSED_ORDER_DISCOVERY_MAX_ORDERS;
  const createdAtFrom = new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000);
  const createdAtTo = new Date(now.getTime() - gracePeriodMs);
  const shopifyAdmin = createShopifyAdminService(env);
  const report: MissedOrderDiscoveryReport = { complete: true, truncated: false, ordersScanned: 0, missingOrders: 0, deferredOrders: 0, errors: [] };
  let after: string | null = null;

  try {
    while (report.ordersScanned < maxOrders) {
      const first = Math.min(MISSED_ORDER_DISCOVERY_PAGE_SIZE, maxOrders - report.ordersScanned);
      const page = await shopifyAdmin.fetchRecentOrdersPage({ createdAtFrom, createdAtTo, first, after });
      report.ordersScanned += page.nodesCount;
      if (page.malformedNodes > 0) {
        report.complete = false;
        report.errors.push(`${page.malformedNodes} Shopify order identity record(s) were malformed and skipped.`);
      }
      const eligibleOrders = page.orders.filter((order) => {
        const createdAt = new Date(order.shopifyCreatedAt).getTime();
        if (!Number.isFinite(createdAt)) {
          report.complete = false;
          report.errors.push(`Shopify order ${order.sourceShopifyOrderId} had an invalid createdAt value.`);
          return false;
        }
        return createdAt >= createdAtFrom.getTime() && createdAt <= createdAtTo.getTime();
      });
      const sourceIds = eligibleOrders.map((order) => order.sourceShopifyOrderId);
      const [localOrders, activeJobs] = await Promise.all([
        prisma.shopifyOrder.findMany({
          where: { sourceShopifyOrderId: { in: sourceIds } },
          select: { sourceShopifyOrderId: true },
        }),
        prisma.operationalJob.findMany({
          where: { sourceShopifyOrderId: { in: sourceIds }, status: { in: ACTIVE_JOB_STATUSES } },
          select: { sourceShopifyOrderId: true },
        }),
      ]);
      const localIds = new Set(localOrders.map((order) => order.sourceShopifyOrderId));
      const activeJobIds = new Set(activeJobs.flatMap((job) => job.sourceShopifyOrderId ? [job.sourceShopifyOrderId] : []));

      for (const order of eligibleOrders) {
        if (localIds.has(order.sourceShopifyOrderId)) continue;
        if (activeJobIds.has(order.sourceShopifyOrderId)) {
          report.deferredOrders += 1;
          continue;
        }
        try {
          await options.beforeSignalWrite?.(order);
          const beforeWrite = await prisma.shopifyOrder.findUnique({
            where: { sourceShopifyOrderId: order.sourceShopifyOrderId },
            select: { id: true },
          });
          if (beforeWrite) continue;
          await upsertMissingOrderSignal(order, now);
          report.missingOrders += 1;
          const afterWrite = await prisma.shopifyOrder.findUnique({
            where: { sourceShopifyOrderId: order.sourceShopifyOrderId },
            select: { id: true },
          });
          if (afterWrite) await resolveSignal(buildMissedOrderSignalId(order.sourceShopifyOrderId));
        } catch (error) {
          report.complete = false;
          report.errors.push(error instanceof Error ? error.message : 'Missing-order signal persistence failed.');
        }
      }

      if (!page.hasNextPage) break;
      if (!page.endCursor) throw new Error('Shopify discovery page indicated more results without an end cursor.');
      if (report.ordersScanned >= maxOrders) {
        report.complete = false;
        report.truncated = true;
        break;
      }
      after = page.endCursor;
    }

    if (report.truncated) {
      await upsertRunSignal({
        id: DISCOVERY_TRUNCATION_SIGNAL_ID,
        type: 'shopify_order_discovery_truncated',
        severity: OperationalSignalSeverity.WARNING,
        title: 'Shopify missed-order discovery reached its run cap',
        description: `The scan stopped after ${report.ordersScanned} orders before Shopify pagination completed.`,
        suggestedAction: 'Review order volume and increase the discovery maximum only after an operational capacity review.',
        metadata: { ordersScanned: report.ordersScanned, maxOrders, observedAt: now.toISOString() },
      });
    } else if (report.complete) {
      await resolveSignal(DISCOVERY_TRUNCATION_SIGNAL_ID);
      await resolveExistingMissingOrderSignals();
      await resolveSignal(DISCOVERY_FAILURE_SIGNAL_ID);
    }
  } catch (error) {
    report.complete = false;
    report.errors.push(error instanceof Error ? error.message : 'Shopify missed-order discovery failed.');
  }

  if (!report.complete && !report.truncated) {
    await upsertRunSignal({
      id: DISCOVERY_FAILURE_SIGNAL_ID,
      type: 'shopify_order_discovery_run_failed',
      severity: OperationalSignalSeverity.HIGH,
      title: 'Shopify missed-order discovery did not complete',
      description: 'The latest discovery run was incomplete. Existing missing-order signals were preserved.',
      suggestedAction: 'Review backend diagnostics. The next overlapping scheduled run will retry automatically.',
      metadata: { ordersScanned: report.ordersScanned, errorCount: report.errors.length, observedAt: now.toISOString() },
    });
  }
  return report;
}

export function registerMissedOrderDiscoveryScheduler(app: FastifyInstance, env: AppEnv) {
  if (!env.SHOPIFY_MISSED_ORDER_DISCOVERY_ENABLED) return;
  let running = false;
  const interval = globalThis.setInterval(() => {
    if (running) return;
    running = true;
    void runMissedOrderDiscovery(env)
      .then((report) => app.log.info(report, 'Shopify missed-order discovery completed.'))
      .catch((error) => app.log.error({ error }, 'Shopify missed-order discovery failed.'))
      .finally(() => { running = false; });
  }, env.SHOPIFY_MISSED_ORDER_DISCOVERY_INTERVAL_MS ?? MISSED_ORDER_DISCOVERY_INTERVAL_MS);
  interval.unref?.();
  app.addHook('onClose', (_instance, done) => {
    globalThis.clearInterval(interval);
    done();
  });
}
