import {
  OperationalJobStatus,
  OperationalSignalSeverity,
  OperationalSignalSourceArea,
  OperationalSignalStatus,
  PayoutBatchStatus,
  SettlementStatus,
  ShippingDeductionMode,
  type OperationalSignal,
  Prisma,
} from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { getVendorFinanceDashboard } from '../finance/finance.service.js';
import type {
  OperationalSignalDto,
  OperationalSignalLifecycleAction,
  OperationalSignalsResponseDto,
  OperationalSignalSummaryDto,
} from './rules.types.js';
import { logDashboardTiming, startDashboardTimer, withDashboardTiming } from '../../lib/dashboard-timing.js';

type SignalDefinition = {
  id: string;
  type: string;
  severity: OperationalSignalSeverity;
  sourceArea: OperationalSignalSourceArea;
  vendorId?: string | null;
  allocationId?: string | null;
  financeLedgerEntryId?: string | null;
  payoutBatchId?: string | null;
  operationalJobId?: string | null;
  title: string;
  description: string;
  suggestedAction?: string | null;
  ruleKey: string;
  metadata?: Prisma.InputJsonValue;
};

export const SLA_THRESHOLDS = {
  returnRequestAgingHours: {
    warning: 24,
    high: 48,
    critical: 72,
  },
  fulfillmentStuckHours: {
    warning: 24,
    high: 48,
    critical: 72,
  },
  payoutReviewStaleHours: {
    warning: 24,
    high: 48,
    critical: 96,
  },
  refundHeavyVendorRatio: {
    warning: 0.08,
    high: 0.15,
    critical: 0.25,
    minimumOrders: 20,
    windowDays: 30,
  },
} as const;

const ACTIVE_PAYOUT_BATCH_STATUSES = [
  PayoutBatchStatus.DRAFT,
  PayoutBatchStatus.REVIEW,
  PayoutBatchStatus.APPROVED,
  PayoutBatchStatus.EXECUTION_PENDING,
  PayoutBatchStatus.PAID_PLACEHOLDER,
];
const PAYOUT_REVIEW_STATUSES = [PayoutBatchStatus.DRAFT, PayoutBatchStatus.REVIEW];
const UNRESOLVED_RETURN_STATUSES = new Set(['pending', 'open', 'needs_review', 'requested', 'in review', 'in_review']);

function sanitizeSignalPart(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unknown';
}

function buildSignalId(ruleKey: string, subjectId: string) {
  return `signal-${sanitizeSignalPart(ruleKey)}-${sanitizeSignalPart(subjectId)}`;
}

function toNumber(value: string | number | null | undefined) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }

  const numeric = Number(String(value ?? '0').replace(/[^0-9.-]/g, '') || 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function getElapsedHours(startedAt: Date, now = new Date()) {
  return Math.max(0, Math.floor((now.getTime() - startedAt.getTime()) / (60 * 60 * 1000)));
}

function getSeverityForHours(
  elapsedHours: number,
  thresholds: { warning: number; high: number; critical: number },
): OperationalSignalSeverity | null {
  if (elapsedHours >= thresholds.critical) {
    return OperationalSignalSeverity.CRITICAL;
  }
  if (elapsedHours >= thresholds.high) {
    return OperationalSignalSeverity.HIGH;
  }
  if (elapsedHours >= thresholds.warning) {
    return OperationalSignalSeverity.WARNING;
  }
  return null;
}

function getSeverityForRatio(
  ratio: number,
  thresholds: { warning: number; high: number; critical: number },
): OperationalSignalSeverity | null {
  if (ratio > thresholds.critical) {
    return OperationalSignalSeverity.CRITICAL;
  }
  if (ratio > thresholds.high) {
    return OperationalSignalSeverity.HIGH;
  }
  if (ratio > thresholds.warning) {
    return OperationalSignalSeverity.WARNING;
  }
  return null;
}

function formatPercent(value: number) {
  return `${Math.round(value * 1000) / 10}%`;
}

function mapSignal(signal: OperationalSignal): OperationalSignalDto {
  return {
    id: signal.id,
    type: signal.type,
    severity: signal.severity.trim().toLowerCase() as OperationalSignalDto['severity'],
    sourceArea: signal.sourceArea.trim().toLowerCase() as OperationalSignalDto['sourceArea'],
    vendorId: signal.vendorId,
    allocationId: signal.allocationId,
    financeLedgerEntryId: signal.financeLedgerEntryId,
    payoutBatchId: signal.payoutBatchId,
    operationalJobId: signal.operationalJobId,
    title: signal.title,
    description: signal.description,
    suggestedAction: signal.suggestedAction,
    status: signal.status.trim().toLowerCase() as OperationalSignalDto['status'],
    ruleKey: signal.ruleKey,
    triggeredAt: signal.triggeredAt.toISOString(),
    resolvedAt: signal.resolvedAt?.toISOString() ?? null,
    metadata: signal.metadata,
    createdAt: signal.createdAt.toISOString(),
    updatedAt: signal.updatedAt.toISOString(),
  };
}

function buildSummary(signals: OperationalSignalDto[]): OperationalSignalSummaryDto {
  return {
    total: signals.length,
    critical: signals.filter((signal) => signal.severity === 'critical').length,
    high: signals.filter((signal) => signal.severity === 'high').length,
    warning: signals.filter((signal) => signal.severity === 'warning').length,
    info: signals.filter((signal) => signal.severity === 'info').length,
  };
}

function isAwaitingShipment(input: { fulfillmentStatus: string | null; shippingStatus: string | null }) {
  const lifecycle = `${input.fulfillmentStatus ?? ''} ${input.shippingStatus ?? ''}`.toLowerCase();
  return (
    lifecycle.includes('awaiting shipment') ||
    lifecycle.includes('awaiting_shipment') ||
    lifecycle.includes('pending') ||
    lifecycle.includes('processing')
  );
}

function isFulfilled(input: {
  allocationStatus?: string | null;
  fulfillmentStatus?: string | null;
  shippingStatus?: string | null;
  fulfillment?: { fulfilledAt: Date | null } | null;
} | null) {
  if (!input) {
    return false;
  }

  const lifecycle = `${input.allocationStatus ?? ''} ${input.fulfillmentStatus ?? ''} ${input.shippingStatus ?? ''}`.toLowerCase();
  return Boolean(
    input.fulfillment?.fulfilledAt ||
      lifecycle.includes('fulfilled') ||
      lifecycle.includes('shipped') ||
      lifecycle.includes('in transit') ||
      lifecycle.includes('delivered'),
  );
}

async function upsertSignals(definitions: SignalDefinition[]) {
  if (definitions.length === 0) {
    return [];
  }

  const signals = await Promise.all(
    definitions.map((definition) =>
      prisma.operationalSignal.upsert({
        where: {
          id: definition.id,
        },
        update: {
          type: definition.type,
          severity: definition.severity,
          sourceArea: definition.sourceArea,
          vendorId: definition.vendorId ?? null,
          allocationId: definition.allocationId ?? null,
          financeLedgerEntryId: definition.financeLedgerEntryId ?? null,
          payoutBatchId: definition.payoutBatchId ?? null,
          operationalJobId: definition.operationalJobId ?? null,
          title: definition.title,
          description: definition.description,
          suggestedAction: definition.suggestedAction ?? null,
          status: OperationalSignalStatus.ACTIVE,
          resolvedAt: null,
          ruleKey: definition.ruleKey,
          metadata: definition.metadata ?? Prisma.JsonNull,
        },
        create: {
          id: definition.id,
          type: definition.type,
          severity: definition.severity,
          sourceArea: definition.sourceArea,
          vendorId: definition.vendorId ?? null,
          allocationId: definition.allocationId ?? null,
          financeLedgerEntryId: definition.financeLedgerEntryId ?? null,
          payoutBatchId: definition.payoutBatchId ?? null,
          operationalJobId: definition.operationalJobId ?? null,
          title: definition.title,
          description: definition.description,
          suggestedAction: definition.suggestedAction ?? null,
          ruleKey: definition.ruleKey,
          metadata: definition.metadata ?? Prisma.JsonNull,
        },
      }),
    ),
  );

  return signals.map(mapSignal);
}

export async function evaluateOperationalSignals(options: { vendorId?: string | null } = {}): Promise<OperationalSignalDto[]> {
  const definitions: SignalDefinition[] = [];
  const evaluatedAt = new Date();
  const vendorWhere = options.vendorId ? { id: options.vendorId } : undefined;
  const vendors = await prisma.vendor.findMany({
    where: vendorWhere,
    orderBy: {
      id: 'asc',
    },
  });

  for (const vendor of vendors) {
    const dashboard = await getVendorFinanceDashboard(vendor.id);
    const payableBalance = toNumber(dashboard.summary.payableBalance);
    if (payableBalance < 0) {
      const ruleKey = 'finance.negative_payable_balance';
      definitions.push({
        id: buildSignalId(ruleKey, vendor.id),
        type: 'negative_vendor_payable_balance',
        severity: OperationalSignalSeverity.HIGH,
        sourceArea: OperationalSignalSourceArea.PAYOUT,
        vendorId: vendor.id,
        title: 'Negative vendor payable balance',
        description: `${vendor.name} has a negative payable balance of ${dashboard.summary.payableBalance}.`,
        suggestedAction: 'Review refund-heavy rows and hold payout preparation until the balance is reconciled.',
        ruleKey,
        metadata: {
          payableBalance: dashboard.summary.payableBalance,
        },
      });
    }
  }

  const now = Date.now();
  const staleFulfillmentCutoff = new Date(now - SLA_THRESHOLDS.fulfillmentStuckHours.warning * 60 * 60 * 1000);
  const stalePayableCutoff = new Date(now - 7 * 24 * 60 * 60 * 1000);
  const returnAgingCutoff = new Date(now - SLA_THRESHOLDS.returnRequestAgingHours.warning * 60 * 60 * 1000);
  const payoutReviewCutoff = new Date(now - SLA_THRESHOLDS.payoutReviewStaleHours.warning * 60 * 60 * 1000);
  const refundRatioWindowStart = new Date(now - SLA_THRESHOLDS.refundHeavyVendorRatio.windowDays * 24 * 60 * 60 * 1000);

  const agingReturns = await prisma.returnRecord.findMany({
    where: {
      vendorAllocation: {
        assignedVendorId: options.vendorId ?? undefined,
      },
      OR: [
        {
          requestCreatedAt: {
            lt: returnAgingCutoff,
          },
        },
        {
          requestCreatedAt: null,
          createdAt: {
            lt: returnAgingCutoff,
          },
        },
      ],
    },
    include: {
      vendorAllocation: {
        include: {
          assignedVendor: true,
          order: true,
        },
      },
    },
    take: 100,
  });

  for (const returnRecord of agingReturns.filter((record) => UNRESOLVED_RETURN_STATUSES.has(record.status.trim().toLowerCase()))) {
    const startedAt = returnRecord.requestCreatedAt ?? returnRecord.createdAt;
    const elapsedHours = getElapsedHours(startedAt, evaluatedAt);
    const severity = getSeverityForHours(elapsedHours, SLA_THRESHOLDS.returnRequestAgingHours);
    if (!severity) {
      continue;
    }

    const ruleKey = 'return.request_sla_aging';
    definitions.push({
      id: buildSignalId(ruleKey, returnRecord.id),
      type: 'return_request_sla_aging',
      severity,
      sourceArea: OperationalSignalSourceArea.REFUND,
      vendorId: returnRecord.vendorAllocation.assignedVendorId,
      allocationId: returnRecord.vendorAllocationId,
      title: 'Return request is aging',
      description: `Return request ${returnRecord.id} has been pending for ${elapsedHours} hours.`,
      suggestedAction: 'Review the return request and approve, decline, or reconcile it before it breaches the next SLA tier.',
      ruleKey,
      metadata: {
        elapsedHours,
        thresholdCrossed: severity.toLowerCase(),
        sourceShopifyOrderId: returnRecord.sourceShopifyOrderId,
        sourceShopifyReturnId: returnRecord.sourceShopifyReturnId,
        status: returnRecord.status,
        evaluatedAt: evaluatedAt.toISOString(),
      },
    });
  }

  const staleAllocations = await prisma.vendorAllocation.findMany({
    where: {
      assignedVendorId: options.vendorId ?? undefined,
      updatedAt: {
        lt: staleFulfillmentCutoff,
      },
    },
    include: {
      assignedVendor: true,
      order: true,
    },
    take: 100,
  });

  for (const allocation of staleAllocations.filter(isAwaitingShipment)) {
    const elapsedHours = getElapsedHours(allocation.updatedAt, evaluatedAt);
    const severity = getSeverityForHours(elapsedHours, SLA_THRESHOLDS.fulfillmentStuckHours);
    if (!severity) {
      continue;
    }

    const ruleKey = 'fulfillment.stale_awaiting_shipment';
    definitions.push({
      id: buildSignalId(ruleKey, allocation.id),
      type: 'stale_fulfillment',
      severity,
      sourceArea: OperationalSignalSourceArea.FULFILLMENT,
      vendorId: allocation.assignedVendorId,
      allocationId: allocation.id,
      title: 'Fulfillment is stale',
      description: `Allocation ${allocation.id} has not moved past ${allocation.shippingStatus} for ${elapsedHours} hours.`,
      suggestedAction: 'Check vendor shipment progress or run reconciliation before contacting the vendor.',
      ruleKey,
      metadata: {
        elapsedHours,
        thresholdCrossed: severity.toLowerCase(),
        sourceShopifyOrderId: allocation.order.sourceShopifyOrderId,
        shippingStatus: allocation.shippingStatus,
        fulfillmentStatus: allocation.fulfillmentStatus,
        evaluatedAt: evaluatedAt.toISOString(),
      },
    });
  }

  const missingShippingCostRows = await prisma.financeLedgerEntry.findMany({
    where: {
      vendorId: options.vendorId ?? undefined,
      entryType: 'sale',
      deductShippingEnabledSnapshot: true,
      shippingModeSnapshot: ShippingDeductionMode.EXTERNAL_PROVIDER,
      shippingCostSnapshot: null,
    },
    include: {
      vendor: true,
      vendorAllocation: {
        include: {
          fulfillment: true,
          order: true,
        },
      },
    },
    take: 100,
  });

  for (const entry of missingShippingCostRows.filter((entry) => isFulfilled(entry.vendorAllocation))) {
    const ruleKey = 'shipping_cost.missing_after_fulfillment';
    definitions.push({
      id: buildSignalId(ruleKey, entry.id),
      type: 'missing_shipping_cost',
      severity: OperationalSignalSeverity.WARNING,
      sourceArea: OperationalSignalSourceArea.SHIPPING_COST,
      vendorId: entry.vendorId,
      allocationId: entry.vendorAllocationId,
      financeLedgerEntryId: entry.id,
      title: 'Shipping cost is pending',
      description: `Sale ledger row ${entry.id} is fulfilled with external-provider shipping enabled but no shipping cost snapshot.`,
      suggestedAction: 'Attach or import the confirmed provider cost before relying on final payout deductions.',
      ruleKey,
      metadata: {
        sourceShopifyOrderId: entry.vendorAllocation?.sourceShopifyOrderId ?? null,
        amount: String(entry.amount),
      },
    });
  }

  const negativeBatches = await prisma.payoutBatch.findMany({
    where: {
      vendorId: options.vendorId ?? undefined,
      status: {
        in: ACTIVE_PAYOUT_BATCH_STATUSES,
      },
      netAmount: {
        lt: 0,
      },
    },
    include: {
      vendor: true,
    },
    take: 100,
  });

  const stalePayoutBatches = await prisma.payoutBatch.findMany({
    where: {
      vendorId: options.vendorId ?? undefined,
      status: {
        in: PAYOUT_REVIEW_STATUSES,
      },
      updatedAt: {
        lt: payoutReviewCutoff,
      },
    },
    include: {
      vendor: true,
    },
    take: 100,
  });

  for (const batch of stalePayoutBatches) {
    const elapsedHours = getElapsedHours(batch.updatedAt, evaluatedAt);
    const severity = getSeverityForHours(elapsedHours, SLA_THRESHOLDS.payoutReviewStaleHours);
    if (!severity) {
      continue;
    }

    const ruleKey = 'payout.review_sla_aging';
    definitions.push({
      id: buildSignalId(ruleKey, batch.id),
      type: 'payout_review_sla_aging',
      severity,
      sourceArea: OperationalSignalSourceArea.PAYOUT,
      vendorId: batch.vendorId,
      payoutBatchId: batch.id,
      title: 'Payout batch review is stale',
      description: `Payout batch ${batch.id} has been waiting review for ${elapsedHours} hours.`,
      suggestedAction: 'Review, cancel, or move the payout batch forward before it breaches the next SLA tier.',
      ruleKey,
      metadata: {
        elapsedHours,
        thresholdCrossed: severity.toLowerCase(),
        status: batch.status,
        netAmount: String(batch.netAmount),
        evaluatedAt: evaluatedAt.toISOString(),
      },
    });
  }

  for (const batch of negativeBatches) {
    const ruleKey = 'payout.negative_batch_net';
    definitions.push({
      id: buildSignalId(ruleKey, batch.id),
      type: 'negative_payout_batch',
      severity: OperationalSignalSeverity.HIGH,
      sourceArea: OperationalSignalSourceArea.PAYOUT,
      vendorId: batch.vendorId,
      payoutBatchId: batch.id,
      title: 'Payout batch has negative net',
      description: `Payout batch ${batch.id} for ${batch.vendor.name} has a negative net amount of ${batch.netAmount}.`,
      suggestedAction: 'Review refund-heavy rows before moving this batch forward.',
      ruleKey,
      metadata: {
        netAmount: String(batch.netAmount),
        status: batch.status,
      },
    });
  }

  for (const vendor of vendors) {
    const [allocationsInWindow, refundsInWindow] = await Promise.all([
      prisma.vendorAllocation.findMany({
        where: {
          assignedVendorId: vendor.id,
          createdAt: {
            gte: refundRatioWindowStart,
          },
        },
        select: {
          sourceShopifyOrderId: true,
        },
        take: 1000,
      }),
      prisma.refundRecord.findMany({
        where: {
          createdAt: {
            gte: refundRatioWindowStart,
          },
          vendorAllocation: {
            assignedVendorId: vendor.id,
          },
        },
        select: {
          sourceShopifyOrderId: true,
        },
        take: 1000,
      }),
    ]);
    const orderCount = new Set(allocationsInWindow.map((allocation) => allocation.sourceShopifyOrderId)).size;
    if (orderCount < SLA_THRESHOLDS.refundHeavyVendorRatio.minimumOrders) {
      continue;
    }

    const refundCount = new Set(refundsInWindow.map((refund) => refund.sourceShopifyOrderId)).size;
    const refundRatio = orderCount > 0 ? refundCount / orderCount : 0;
    const severity = getSeverityForRatio(refundRatio, SLA_THRESHOLDS.refundHeavyVendorRatio);
    if (!severity) {
      continue;
    }

    const ruleKey = 'refund.vendor_ratio_sla';
    definitions.push({
      id: buildSignalId(ruleKey, vendor.id),
      type: 'refund_heavy_vendor',
      severity,
      sourceArea: OperationalSignalSourceArea.REFUND,
      vendorId: vendor.id,
      title: 'Refund-heavy vendor risk',
      description: `${vendor.name} has a ${formatPercent(refundRatio)} refund ratio across ${orderCount} orders in the last ${SLA_THRESHOLDS.refundHeavyVendorRatio.windowDays} days.`,
      suggestedAction: 'Review recent return/refund reasons and fulfillment quality before preparing payout or vendor follow-up.',
      ruleKey,
      metadata: {
        refundRatio,
        refundCount,
        orderCount,
        minimumOrders: SLA_THRESHOLDS.refundHeavyVendorRatio.minimumOrders,
        windowDays: SLA_THRESHOLDS.refundHeavyVendorRatio.windowDays,
        thresholdCrossed: severity.toLowerCase(),
        evaluatedAt: evaluatedAt.toISOString(),
      },
    });
  }

  const oldPayableRows = await prisma.financeLedgerEntry.findMany({
    where: {
      vendorId: options.vendorId ?? undefined,
      settlementStatus: {
        in: [SettlementStatus.PAYABLE, SettlementStatus.PARTIALLY_REFUNDED],
      },
      payableAt: {
        lt: stalePayableCutoff,
      },
      payoutBatchLines: {
        none: {
          payoutBatch: {
            status: {
              in: ACTIVE_PAYOUT_BATCH_STATUSES,
            },
          },
        },
      },
    },
    take: 100,
  });

  for (const entry of oldPayableRows) {
    const ruleKey = 'settlement.payable_row_overdue';
    definitions.push({
      id: buildSignalId(ruleKey, entry.id),
      type: 'payable_row_overdue',
      severity: OperationalSignalSeverity.INFO,
      sourceArea: OperationalSignalSourceArea.SETTLEMENT,
      vendorId: entry.vendorId,
      allocationId: entry.vendorAllocationId,
      financeLedgerEntryId: entry.id,
      title: 'Payable row is not batched',
      description: `Finance row ${entry.id} has been payout-ready since ${entry.payableAt?.toISOString() ?? 'an earlier period'}.`,
      suggestedAction: 'Review payout batch preparation for this vendor.',
      ruleKey,
      metadata: {
        settlementStatus: entry.settlementStatus,
        payableAt: entry.payableAt?.toISOString() ?? null,
      },
    });
  }

  const escalatedJobs = await prisma.operationalJob.findMany({
    where: {
      status: {
        in: [OperationalJobStatus.DEAD_LETTER_READY, OperationalJobStatus.PERMANENTLY_FAILED],
      },
      vendorAllocation: options.vendorId
        ? {
            assignedVendorId: options.vendorId,
          }
        : undefined,
    },
    include: {
      vendorAllocation: true,
    },
    take: 100,
  });

  for (const job of escalatedJobs) {
    const ruleKey = 'diagnostics.operational_job_escalated';
    definitions.push({
      id: buildSignalId(ruleKey, job.id),
      type: 'operational_job_escalated',
      severity: job.status === OperationalJobStatus.PERMANENTLY_FAILED
        ? OperationalSignalSeverity.CRITICAL
        : OperationalSignalSeverity.HIGH,
      sourceArea: OperationalSignalSourceArea.DIAGNOSTICS,
      vendorId: job.vendorAllocation?.assignedVendorId ?? null,
      allocationId: job.vendorAllocationId,
      operationalJobId: job.id,
      title: 'Operational job needs intervention',
      description: `Operational job ${job.id} is ${job.status.toLowerCase()} after retry processing.`,
      suggestedAction: 'Review diagnostics and use replay/recover only when the underlying state is safe.',
      ruleKey,
      metadata: {
        jobType: job.jobType,
        status: job.status,
        retryCount: job.retryCount,
        failureCategory: job.failureCategory,
      },
    });
  }

  return upsertSignals(definitions);
}

export async function listOperationalSignals(options: {
  vendorId?: string | null;
  includeInternal?: boolean;
  status?: OperationalSignalStatus;
  limit?: number;
} = {}): Promise<OperationalSignalsResponseDto> {
  const signals = await withDashboardTiming('signals.operational_signal_fetch', () => prisma.operationalSignal.findMany({
    where: {
      vendorId: options.vendorId ?? undefined,
      status: options.status ?? OperationalSignalStatus.ACTIVE,
      sourceArea: options.includeInternal
        ? undefined
        : {
            notIn: [OperationalSignalSourceArea.DIAGNOSTICS, OperationalSignalSourceArea.RECONCILIATION],
          },
    },
    orderBy: [
      {
        severity: 'desc',
      },
      {
        triggeredAt: 'desc',
      },
    ],
    take: options.limit ?? 50,
  }));
  const aggregationStartedAt = startDashboardTimer();
  const mapped = signals.map(mapSignal);

  const response = {
    summary: buildSummary(mapped),
    signals: mapped,
  };
  logDashboardTiming('signals.metrics_aggregation', aggregationStartedAt);
  return response;
}

export async function evaluateOperationalSignalsForUser(options: {
  vendorId?: string | null;
  includeInternal?: boolean;
  status?: OperationalSignalStatus;
  limit?: number;
} = {}): Promise<OperationalSignalsResponseDto> {
  await withDashboardTiming('signals.evaluate_operational_signals_service', () =>
    evaluateOperationalSignals({ vendorId: options.vendorId }),
  );

  return listOperationalSignals(options);
}

export async function updateOperationalSignalStatus(
  signalId: string,
  action: OperationalSignalLifecycleAction,
): Promise<OperationalSignalDto | null> {
  const status =
    action === 'acknowledge'
      ? OperationalSignalStatus.ACKNOWLEDGED
      : action === 'ignore'
        ? OperationalSignalStatus.IGNORED
        : OperationalSignalStatus.RESOLVED;

  try {
    const signal = await prisma.operationalSignal.update({
      where: {
        id: signalId,
      },
      data: {
        status,
        resolvedAt: status === OperationalSignalStatus.RESOLVED ? new Date() : null,
      },
    });

    return mapSignal(signal);
  } catch {
    return null;
  }
}
