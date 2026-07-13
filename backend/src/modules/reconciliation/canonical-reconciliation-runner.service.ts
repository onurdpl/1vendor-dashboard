import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import type { AppEnv } from '../../config/env.js';
import { prisma } from '../../db/prisma.js';
import { createShopifyAdminService } from '../shopify/shopify-admin.service.js';
import type { CanonicalShopifyOrderSnapshot } from '../shopify/shopify-admin.types.js';
import {
  classifyCanonicalRefundMonetaryEvidence,
  findCanonicalRefundItemEvidence,
  isRefundEvidenceBlocked,
  REFUND_MONETARY_CLASSIFICATIONS,
  requiresRefundMonetaryEvidenceClassification,
} from '../shopify/shopify-refund-monetary-evidence.js';
import { createReconciliationService } from './reconciliation.service.js';
import { createCanonicalRefundReconciliationService } from './canonical-refund-reconciliation.service.js';
import { createCanonicalReturnReconciliationService } from './canonical-return-reconciliation.service.js';
import { createCanonicalCancellationReconciliationService } from './canonical-cancellation-reconciliation.service.js';

export type CanonicalReconciliationRunMode = 'dry-run' | 'repair';

export type CanonicalReconciliationRunOptions = {
  lookbackDays?: number;
  limit?: number;
  mode?: CanonicalReconciliationRunMode;
};

export type CanonicalReconciliationOrderDetail = {
  shopifyOrderId: string;
  status: 'scanned' | 'failed';
  wouldRepair: {
    order: number;
    fulfillment: number;
    refunds: number;
    returns: number;
    cancellations: number;
    signals: number;
    ledgers: number;
    financeEvents: number;
  };
  actions: string[];
  errors: string[];
};

export type CanonicalReconciliationRunReport = {
  id: string;
  mode: CanonicalReconciliationRunMode;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED' | 'BLOCKED';
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  lookbackDays: number;
  orderLimit: number;
  ordersScanned: number;
  repairOpportunities: number;
  wouldRepairOrders: number;
  wouldRepairFulfillment: number;
  wouldRepairRefunds: number;
  wouldRepairReturns: number;
  wouldRepairCancellations: number;
  wouldCreateSignals: number;
  wouldRepairLedgers: number;
  wouldRepairFinanceEvents: number;
  errors: Array<{ shopifyOrderId?: string; message: string }>;
  perOrderDetails: CanonicalReconciliationOrderDetail[];
};

let inMemoryCanonicalRunActive = false;
let registeredCanonicalTimer: ReturnType<typeof globalThis.setTimeout> | null = null;

function toJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function toJsonObject(value: Record<string, unknown>): Prisma.InputJsonObject {
  return value as Prisma.InputJsonObject;
}

function toPositiveInteger(value: number | undefined, fallback: number) {
  return Number.isFinite(value) && value && value > 0 ? Math.floor(value) : fallback;
}

function readJsonArray(value: Prisma.JsonValue | null | undefined) {
  return Array.isArray(value) ? value : [];
}

function serializeRun(row: {
  id: string;
  mode: string;
  status: string;
  startedAt: Date;
  finishedAt: Date | null;
  durationMs: number | null;
  lookbackDays: number;
  orderLimit: number;
  ordersScanned: number;
  repairOpportunities: number;
  wouldRepairOrders: number;
  wouldRepairFulfillment: number;
  wouldRepairRefunds: number;
  wouldRepairReturns: number;
  wouldRepairCancellations: number;
  wouldCreateSignals: number;
  wouldRepairLedgers: number;
  wouldRepairFinanceEvents: number;
  errorsJson: Prisma.JsonValue | null;
  perOrderDetailsJson: Prisma.JsonValue | null;
}): CanonicalReconciliationRunReport {
  return {
    id: row.id,
    mode: row.mode === 'repair' ? 'repair' : 'dry-run',
    status: ['RUNNING', 'COMPLETED', 'FAILED', 'BLOCKED'].includes(row.status)
      ? row.status as CanonicalReconciliationRunReport['status']
      : 'FAILED',
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
    durationMs: row.durationMs,
    lookbackDays: row.lookbackDays,
    orderLimit: row.orderLimit,
    ordersScanned: row.ordersScanned,
    repairOpportunities: row.repairOpportunities,
    wouldRepairOrders: row.wouldRepairOrders,
    wouldRepairFulfillment: row.wouldRepairFulfillment,
    wouldRepairRefunds: row.wouldRepairRefunds,
    wouldRepairReturns: row.wouldRepairReturns,
    wouldRepairCancellations: row.wouldRepairCancellations,
    wouldCreateSignals: row.wouldCreateSignals,
    wouldRepairLedgers: row.wouldRepairLedgers,
    wouldRepairFinanceEvents: row.wouldRepairFinanceEvents,
    errors: readJsonArray(row.errorsJson) as CanonicalReconciliationRunReport['errors'],
    perOrderDetails: readJsonArray(row.perOrderDetailsJson) as CanonicalReconciliationOrderDetail[],
  };
}

export function getNextCanonicalReconciliationRunAt(input: {
  now?: Date;
  scheduleHour: number;
}) {
  const now = input.now ?? new Date();
  const next = new Date(now);
  next.setHours(input.scheduleHour, 0, 0, 0);
  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }
  return next;
}

function emptyOrderDetail(shopifyOrderId: string): CanonicalReconciliationOrderDetail {
  return {
    shopifyOrderId,
    status: 'scanned',
    wouldRepair: {
      order: 0,
      fulfillment: 0,
      refunds: 0,
      returns: 0,
      cancellations: 0,
      signals: 0,
      ledgers: 0,
      financeEvents: 0,
    },
    actions: [],
    errors: [],
  };
}

function amountString(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue.toFixed(2) : String(value);
}

function countOrderSnapshotDrift(input: {
  localOrder: {
    sourceShopifyOrderNumber: string;
    financialStatus: string | null;
    customerName: string | null;
    customerEmail: string | null;
    customerPhone: string | null;
    orderTaxAmount: unknown;
    shippingAmount: unknown;
    discountAmount: unknown;
    totalPrice: unknown;
    lineItems: Array<{
      sourceLineItemId: string;
      sku: string | null;
      title: string | null;
      quantity: number;
      imageUrl: string | null;
    }>;
  } | null;
  canonical: CanonicalShopifyOrderSnapshot | null;
}) {
  const { localOrder, canonical } = input;
  if (!canonical) {
    return 0;
  }
  if (!localOrder) {
    return 1;
  }

  let count = 0;
  const compare = (localValue: unknown, canonicalValue: unknown) => {
    if ((localValue ?? null) !== (canonicalValue ?? null)) {
      count += 1;
    }
  };
  compare(localOrder.sourceShopifyOrderNumber, canonical.sourceShopifyOrderNumber);
  compare(localOrder.financialStatus, canonical.financialStatus);
  compare(localOrder.customerName, canonical.customerName);
  compare(localOrder.customerEmail, canonical.customerEmail);
  compare(localOrder.customerPhone, canonical.customerPhone);
  compare(amountString(localOrder.orderTaxAmount), canonical.orderTaxAmount);
  compare(amountString(localOrder.shippingAmount), canonical.shippingAmount);
  compare(amountString(localOrder.discountAmount), canonical.discountAmount);
  compare(amountString(localOrder.totalPrice), canonical.totalPrice);

  const localLineItems = new Map(localOrder.lineItems.map((lineItem) => [lineItem.sourceLineItemId, lineItem]));
  for (const canonicalLineItem of canonical.lineItems) {
    const localLineItem = localLineItems.get(canonicalLineItem.sourceLineItemId);
    if (!localLineItem) {
      count += 1;
      continue;
    }
    if (
      localLineItem.sku !== canonicalLineItem.sku ||
      localLineItem.title !== canonicalLineItem.title ||
      localLineItem.quantity !== canonicalLineItem.quantity ||
      localLineItem.imageUrl !== canonicalLineItem.imageUrl
    ) {
      count += 1;
    }
  }

  return count;
}

function countFulfillmentDrift(input: {
  localOrder: {
    allocations: Array<{
      fulfillmentStatus: string;
      shippingStatus: string;
      trackingNumber: string | null;
      fulfillment: {
        trackingNumber: string | null;
        fulfillmentStatus: string | null;
        shopifyFulfillmentId: string | null;
      } | null;
    }>;
  } | null;
  fulfillmentState: {
    fulfillments: Array<{
      id: string;
      trackingInfo: Array<{ number: string | null }>;
    }>;
  } | null;
}) {
  if (!input.localOrder || !input.fulfillmentState) {
    return 0;
  }
  if (input.fulfillmentState.fulfillments.length === 0) {
    return 0;
  }
  const canonicalTrackingNumbers = new Set(
    input.fulfillmentState.fulfillments.flatMap((fulfillment) =>
      fulfillment.trackingInfo.map((tracking) => tracking.number).filter((value): value is string => Boolean(value))
    ),
  );
  return input.localOrder.allocations.filter((allocation) => {
    const localText = `${allocation.fulfillmentStatus} ${allocation.shippingStatus}`.toLowerCase();
    const localTracking = allocation.trackingNumber ?? allocation.fulfillment?.trackingNumber ?? null;
    return (
      !localText.includes('fulfilled') ||
      (canonicalTrackingNumbers.size > 0 && (!localTracking || !canonicalTrackingNumbers.has(localTracking)))
    );
  }).length;
}

function classifyCancellationDryRun(snapshot: CanonicalShopifyOrderSnapshot | null) {
  if (!snapshot) {
    return { count: 0, signals: 0, ledgers: 0, action: null as string | null };
  }
  if (snapshot.cancelledAt) {
    return {
      count: 1,
      signals: 1,
      ledgers: 1,
      action: 'Would hold/void unpaid sale ledgers for full Shopify order cancellation.',
    };
  }
  const reducedLines = snapshot.lineItems.filter((lineItem) =>
    typeof lineItem.currentQuantity === 'number' && lineItem.currentQuantity < lineItem.quantity
  );
  if (reducedLines.length > 0) {
    return {
      count: reducedLines.length,
      signals: 1,
      ledgers: 0,
      action: 'Would create manual-review signal for ambiguous partial line cancellation.',
    };
  }
  return { count: 0, signals: 0, ledgers: 0, action: null };
}

export function summarizeRepairOpportunities(details: CanonicalReconciliationOrderDetail[]) {
  return details.reduce((summary, detail) => {
    summary.ordersScanned += detail.status === 'scanned' ? 1 : 0;
    summary.wouldRepairOrders += detail.wouldRepair.order;
    summary.wouldRepairFulfillment += detail.wouldRepair.fulfillment;
    summary.wouldRepairRefunds += detail.wouldRepair.refunds;
    summary.wouldRepairReturns += detail.wouldRepair.returns;
    summary.wouldRepairCancellations += detail.wouldRepair.cancellations;
    summary.wouldCreateSignals += detail.wouldRepair.signals;
    summary.wouldRepairLedgers += detail.wouldRepair.ledgers;
    summary.wouldRepairFinanceEvents += detail.wouldRepair.financeEvents;
    return summary;
  }, {
    ordersScanned: 0,
    wouldRepairOrders: 0,
    wouldRepairFulfillment: 0,
    wouldRepairRefunds: 0,
    wouldRepairReturns: 0,
    wouldRepairCancellations: 0,
    wouldCreateSignals: 0,
    wouldRepairLedgers: 0,
    wouldRepairFinanceEvents: 0,
  });
}

export function countRepairOpportunities(summary: ReturnType<typeof summarizeRepairOpportunities>) {
  return (
    summary.wouldRepairOrders +
    summary.wouldRepairFulfillment +
    summary.wouldRepairRefunds +
    summary.wouldRepairReturns +
    summary.wouldRepairCancellations
  );
}

export async function findCanonicalReconciliationOrderCandidates(options: {
  lookbackDays: number;
  limit: number;
  now?: Date;
}) {
  const now = options.now ?? new Date();
  const since = new Date(now.getTime() - options.lookbackDays * 24 * 60 * 60 * 1000);
  return prisma.shopifyOrder.findMany({
    where: {
      OR: [
        { createdAt: { gte: since } },
        { updatedAt: { gte: since } },
      ],
    },
    select: {
      id: true,
      sourceShopifyOrderId: true,
    },
    orderBy: {
      updatedAt: 'desc',
    },
    take: options.limit,
  });
}

async function inspectOrderDryRun(env: AppEnv, shopifyOrderId: string): Promise<CanonicalReconciliationOrderDetail> {
  const shopifyAdmin = createShopifyAdminService(env);
  const detail = emptyOrderDetail(shopifyOrderId);
  const localOrder = await prisma.shopifyOrder.findUnique({
    where: { sourceShopifyOrderId: shopifyOrderId },
    include: {
      lineItems: true,
      allocations: {
        include: {
          fulfillment: true,
          refundRecords: true,
          returnRecords: true,
          financeEntries: {
            where: {
              entryType: 'sale',
            },
          },
        },
      },
    },
  });

  const canonicalOrder = await shopifyAdmin.fetchCanonicalOrderSnapshot(shopifyOrderId);
  const orderDrift = countOrderSnapshotDrift({ localOrder, canonical: canonicalOrder });
  if (orderDrift > 0) {
    detail.wouldRepair.order = orderDrift;
    detail.actions.push(`Would repair ${orderDrift} order snapshot or line-item field(s).`);
  }

  const fulfillmentState = await shopifyAdmin.fetchOrderFulfillmentState(shopifyOrderId).catch(() => null);
  const fulfillmentDrift = countFulfillmentDrift({ localOrder, fulfillmentState });
  if (fulfillmentDrift > 0) {
    detail.wouldRepair.fulfillment = fulfillmentDrift;
    detail.actions.push(`Would reconcile fulfillment state for ${fulfillmentDrift} allocation(s).`);
  }

  const canonicalRefunds = await shopifyAdmin.fetchCanonicalRefundsForOrder(shopifyOrderId);
  const refundEvidence = canonicalRefunds && requiresRefundMonetaryEvidenceClassification(canonicalRefunds)
    ? classifyCanonicalRefundMonetaryEvidence(canonicalRefunds)
    : null;
  if (refundEvidence && isRefundEvidenceBlocked(refundEvidence)) {
    detail.wouldRepair.signals += 1;
    detail.actions.push(`Canonical refund finance is blocked: ${refundEvidence.reasonCode}.`);
  }
  for (const refund of canonicalRefunds?.refunds ?? []) {
    const itemEvidence = refundEvidence
      ? findCanonicalRefundItemEvidence(refundEvidence, refund.sourceShopifyRefundId)
      : null;
    if (itemEvidence?.classification === REFUND_MONETARY_CLASSIFICATIONS.zeroValueVoid) {
      detail.actions.push(`Refund object ${refund.sourceShopifyRefundId} is a zero-value void; no refund finance repair is required.`);
      continue;
    }
    if (
      !itemEvidence ||
      itemEvidence.classification !== REFUND_MONETARY_CLASSIFICATIONS.monetaryRefund ||
      (refundEvidence && isRefundEvidenceBlocked(refundEvidence))
    ) {
      continue;
    }
    const localRefundCount = await prisma.refundRecord.count({
      where: {
        sourceShopifyOrderId: shopifyOrderId,
        sourceShopifyRefundId: refund.sourceShopifyRefundId,
      },
    });
    if (localRefundCount === 0) {
      detail.wouldRepair.refunds += 1;
      detail.wouldRepair.ledgers += 1;
      detail.wouldRepair.financeEvents += 1;
      detail.actions.push(`Would create missing refund records and finance artifacts for refund ${refund.sourceShopifyRefundId}.`);
    }
  }

  const canonicalReturns = await shopifyAdmin.fetchCanonicalReturnsForOrder(shopifyOrderId);
  for (const returnRecord of canonicalReturns?.returns ?? []) {
    const localReturnCount = await prisma.returnRecord.count({
      where: {
        sourceShopifyOrderId: shopifyOrderId,
        sourceShopifyReturnId: returnRecord.sourceShopifyReturnId,
        returnRequestSource: 'shopify_return_request',
      },
    });
    if (localReturnCount === 0) {
      detail.wouldRepair.returns += 1;
      detail.actions.push(`Would create missing return records for return ${returnRecord.sourceShopifyReturnId}.`);
    }
  }

  const cancellation = classifyCancellationDryRun(canonicalOrder);
  if (cancellation.count > 0) {
    detail.wouldRepair.cancellations = cancellation.count;
    detail.wouldRepair.signals += cancellation.signals;
    detail.wouldRepair.ledgers += cancellation.ledgers;
    if (cancellation.action) {
      detail.actions.push(cancellation.action);
    }
  }

  return detail;
}

async function repairOrder(env: AppEnv, shopifyOrderId: string): Promise<CanonicalReconciliationOrderDetail> {
  const detail = emptyOrderDetail(shopifyOrderId);
  const orderReconciliation = createReconciliationService(env);
  const refundReconciliation = createCanonicalRefundReconciliationService(env);
  const returnReconciliation = createCanonicalReturnReconciliationService(env);
  const cancellationReconciliation = createCanonicalCancellationReconciliationService(env);

  const orderResult = await orderReconciliation.reconcileShopifyOrder(shopifyOrderId);
  if (orderResult?.reconciliationStatus === 'repaired') {
    detail.wouldRepair.order = orderResult.repairedFields.length;
    detail.actions.push('Repaired canonical order and fulfillment state.');
  }

  const refundResult = await refundReconciliation.reconcileShopifyOrderRefunds(shopifyOrderId);
  if (refundResult) {
    detail.wouldRepair.refunds = refundResult.refundsCreated + refundResult.ledgersRepaired + refundResult.eventsRepaired;
    detail.wouldRepair.ledgers = refundResult.ledgersRepaired;
    detail.wouldRepair.financeEvents = refundResult.eventsRepaired;
  }

  const returnResult = await returnReconciliation.reconcileShopifyOrderReturns(shopifyOrderId);
  if (returnResult) {
    detail.wouldRepair.returns = returnResult.returnsCreated + returnResult.returnRecordsRepaired;
  }

  const cancellationResult = await cancellationReconciliation.reconcileShopifyOrderCancellation(shopifyOrderId);
  if (cancellationResult) {
    detail.wouldRepair.cancellations = cancellationResult.ledgersHeldOrVoided.length;
    detail.wouldRepair.ledgers += cancellationResult.ledgersHeldOrVoided.length;
  }

  return detail;
}

export async function getLatestCanonicalReconciliationRun() {
  const latest = await prisma.canonicalReconciliationRun.findFirst({
    orderBy: {
      startedAt: 'desc',
    },
  });
  return latest ? serializeRun(latest) : null;
}

export async function runCanonicalReconciliation(env: AppEnv, options: CanonicalReconciliationRunOptions = {}) {
  const mode = options.mode ?? env.CANONICAL_RECONCILIATION_MODE;
  const lookbackDays = toPositiveInteger(options.lookbackDays, env.CANONICAL_RECONCILIATION_LOOKBACK_DAYS);
  const limit = toPositiveInteger(options.limit, env.CANONICAL_RECONCILIATION_ORDER_LIMIT);
  const startedAt = new Date();

  if (inMemoryCanonicalRunActive) {
    const blocked = await prisma.canonicalReconciliationRun.create({
      data: {
        mode,
        status: 'BLOCKED',
        startedAt,
        finishedAt: startedAt,
        durationMs: 0,
        lookbackDays,
        orderLimit: limit,
        errorsJson: toJson([{ message: 'Canonical reconciliation run already in progress.' }]),
        perOrderDetailsJson: toJson([]),
      },
    });
    return serializeRun(blocked);
  }

  const activeRun = await prisma.canonicalReconciliationRun.findFirst({
    where: {
      status: 'RUNNING',
    },
    orderBy: {
      startedAt: 'desc',
    },
  });
  if (activeRun) {
    const blocked = await prisma.canonicalReconciliationRun.create({
      data: {
        mode,
        status: 'BLOCKED',
        startedAt,
        finishedAt: startedAt,
        durationMs: 0,
        lookbackDays,
        orderLimit: limit,
        errorsJson: toJson([{ message: `Canonical reconciliation run ${activeRun.id} already in progress.` }]),
        perOrderDetailsJson: toJson([]),
      },
    });
    return serializeRun(blocked);
  }

  inMemoryCanonicalRunActive = true;
  const run = await prisma.canonicalReconciliationRun.create({
    data: {
      mode,
      status: 'RUNNING',
      startedAt,
      lookbackDays,
      orderLimit: limit,
      errorsJson: toJson([]),
      perOrderDetailsJson: toJson([]),
    },
  });

  const details: CanonicalReconciliationOrderDetail[] = [];
  const errors: CanonicalReconciliationRunReport['errors'] = [];

  try {
    const orders = await findCanonicalReconciliationOrderCandidates({
      lookbackDays,
      limit,
      now: startedAt,
    });

    for (const order of orders) {
      try {
        details.push(mode === 'repair'
          ? await repairOrder(env, order.sourceShopifyOrderId)
          : await inspectOrderDryRun(env, order.sourceShopifyOrderId));
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Canonical reconciliation order scan failed.';
        errors.push({
          shopifyOrderId: order.sourceShopifyOrderId,
          message,
        });
        details.push({
          ...emptyOrderDetail(order.sourceShopifyOrderId),
          status: 'failed',
          errors: [message],
        });
      }
    }

    const summary = summarizeRepairOpportunities(details);
    const finishedAt = new Date();
    const updated = await prisma.canonicalReconciliationRun.update({
      where: {
        id: run.id,
      },
      data: {
        status: errors.length > 0 ? 'FAILED' : 'COMPLETED',
        finishedAt,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        ordersScanned: summary.ordersScanned,
        repairOpportunities: countRepairOpportunities(summary),
        wouldRepairOrders: summary.wouldRepairOrders,
        wouldRepairFulfillment: summary.wouldRepairFulfillment,
        wouldRepairRefunds: summary.wouldRepairRefunds,
        wouldRepairReturns: summary.wouldRepairReturns,
        wouldRepairCancellations: summary.wouldRepairCancellations,
        wouldCreateSignals: summary.wouldCreateSignals,
        wouldRepairLedgers: summary.wouldRepairLedgers,
        wouldRepairFinanceEvents: summary.wouldRepairFinanceEvents,
        errorsJson: toJson(errors),
        perOrderDetailsJson: toJson(details),
      },
    });
    return serializeRun(updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Canonical reconciliation run failed.';
    const finishedAt = new Date();
    const updated = await prisma.canonicalReconciliationRun.update({
      where: {
        id: run.id,
      },
      data: {
        status: 'FAILED',
        finishedAt,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        errorsJson: toJson([...errors, { message }]),
        perOrderDetailsJson: toJson(details),
      },
    });
    return serializeRun(updated);
  } finally {
    inMemoryCanonicalRunActive = false;
  }
}

function scheduleNextCanonicalRun(app: FastifyInstance, env: AppEnv) {
  const nextRunAt = getNextCanonicalReconciliationRunAt({
    scheduleHour: env.CANONICAL_RECONCILIATION_SCHEDULE_HOUR,
  });
  const delayMs = Math.max(1000, nextRunAt.getTime() - Date.now());
  registeredCanonicalTimer = globalThis.setTimeout(() => {
    void runCanonicalReconciliation(env, {
      lookbackDays: env.CANONICAL_RECONCILIATION_LOOKBACK_DAYS,
      limit: env.CANONICAL_RECONCILIATION_ORDER_LIMIT,
      mode: env.CANONICAL_RECONCILIATION_MODE,
    }).then((report) => {
      app.log.info({
        runId: report.id,
        mode: report.mode,
        status: report.status,
        ordersScanned: report.ordersScanned,
        repairOpportunities: report.repairOpportunities,
        errors: report.errors.length,
      }, 'Nightly canonical reconciliation completed.');
    }).catch((error) => {
      app.log.error({ error }, 'Nightly canonical reconciliation failed.');
    }).finally(() => {
      scheduleNextCanonicalRun(app, env);
    });
  }, delayMs);
  registeredCanonicalTimer.unref?.();
}

export function registerCanonicalReconciliationScheduler(app: FastifyInstance, env: AppEnv) {
  if (!env.CANONICAL_RECONCILIATION_ENABLED) {
    return;
  }

  scheduleNextCanonicalRun(app, env);
  app.addHook('onClose', (_instance, done) => {
    if (registeredCanonicalTimer) {
      globalThis.clearTimeout(registeredCanonicalTimer);
      registeredCanonicalTimer = null;
    }
    done();
  });
}

export const __canonicalReconciliationRunnerTesting = {
  emptyOrderDetail,
  countOrderSnapshotDrift,
  countFulfillmentDrift,
  classifyCancellationDryRun,
  serializeRun,
  scheduleNextCanonicalRun,
};
