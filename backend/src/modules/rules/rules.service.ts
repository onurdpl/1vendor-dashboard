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

const ACTIVE_PAYOUT_BATCH_STATUSES = [
  PayoutBatchStatus.DRAFT,
  PayoutBatchStatus.REVIEW,
  PayoutBatchStatus.APPROVED,
  PayoutBatchStatus.EXECUTION_PENDING,
  PayoutBatchStatus.PAID_PLACEHOLDER,
];

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
  const staleFulfillmentCutoff = new Date(now - 48 * 60 * 60 * 1000);
  const stalePayableCutoff = new Date(now - 7 * 24 * 60 * 60 * 1000);

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
    const ruleKey = 'fulfillment.stale_awaiting_shipment';
    definitions.push({
      id: buildSignalId(ruleKey, allocation.id),
      type: 'stale_fulfillment',
      severity: OperationalSignalSeverity.WARNING,
      sourceArea: OperationalSignalSourceArea.FULFILLMENT,
      vendorId: allocation.assignedVendorId,
      allocationId: allocation.id,
      title: 'Fulfillment is stale',
      description: `Allocation ${allocation.id} has not moved past ${allocation.shippingStatus} since ${allocation.updatedAt.toISOString()}.`,
      suggestedAction: 'Check vendor shipment progress or run reconciliation before contacting the vendor.',
      ruleKey,
      metadata: {
        sourceShopifyOrderId: allocation.order.sourceShopifyOrderId,
        shippingStatus: allocation.shippingStatus,
        fulfillmentStatus: allocation.fulfillmentStatus,
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
  await evaluateOperationalSignals({ vendorId: options.vendorId });
  const signals = await prisma.operationalSignal.findMany({
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
  });
  const mapped = signals.map(mapSignal);

  return {
    summary: buildSummary(mapped),
    signals: mapped,
  };
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
