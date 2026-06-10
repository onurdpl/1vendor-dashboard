import {
  Prisma,
  SettlementApprovalLineType,
  SettlementApprovalStatus,
  SettlementCommissionInvoiceStatus,
  type SettlementApproval,
  type SettlementApprovalLine,
} from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import {
  calculateVendorPayout,
  DEFAULT_VENDOR_FINANCIAL_PROFILE,
  type ShippingMode,
  type VendorFinanceProfileConfig,
} from './payout-calculator.js';

type SettlementApprovalTransaction = Prisma.TransactionClient;

type SettlementApprovalInput = {
  vendorId: string;
  periodStart?: Date | null;
  periodEnd?: Date | null;
  notes?: string | null;
};

type SettlementApprovalLedgerRow = {
  id: string;
  vendorId: string;
  entryType: string;
  amount: unknown;
  payoutStatus: string | null;
  description: string | null;
  commissionPercentSnapshot: unknown;
  commissionVatPercentSnapshot: unknown;
  deductShippingEnabledSnapshot: boolean | null;
  shippingModeSnapshot: string | null;
  fixedShippingFeeSnapshot: unknown;
  shippingCostSnapshot: unknown;
  shippingVatAmountSnapshot: unknown;
  shippingCostSourceSnapshot: string | null;
  shippingCostProviderSnapshot: string | null;
  financialProfileIdSnapshot: string | null;
  settlementStatus: string | null;
  settlementEligibleAt: Date | null;
  accruedAt: Date | null;
  payableAt: Date | null;
  settledAt: Date | null;
  settlementHoldReason: string | null;
  createdAt: Date;
  vendorAllocation: {
    id: string;
    allocationStatus: string;
    fulfillmentStatus: string | null;
    shippingStatus: string | null;
    sourceShopifyOrderId: string;
    sourceShopifyOrderNumber: string;
    fulfillment: {
      fulfilledAt: Date | null;
    } | null;
    refundRecords: Array<{
      id: string;
      sourceShopifyRefundId: string;
      amount: unknown;
    }>;
  } | null;
  settlementApprovalLines: Array<{
    id: string;
    settlementApproval: {
      id: string;
      status: SettlementApprovalStatus;
    };
  }>;
};

type SettlementApprovalLineDraft = {
  financeLedgerEntryId: string;
  lineType: SettlementApprovalLineType;
  amountMinor: number;
  commissionMinor: number;
  commissionVatMinor: number;
  payableImpactMinor: number;
  sourceSnapshotJson: Prisma.InputJsonValue;
  storedSettlementStatus: string | null;
  derivedSettlementStatus: string;
  payoutStatus: string | null;
  eligibilityDecision: 'included' | 'excluded';
  eligibilityReason: string;
  refundDetected: boolean;
  refundCount: number;
  fulfillmentEvidencePresent: boolean;
  shippingEvidencePresent: boolean;
};

export type SettlementApprovalLineDto = SettlementApprovalLineDraft & {
  id?: string;
};

export type SettlementApprovalTotalsDto = {
  grossSalesMinor: number;
  refundTotalMinor: number;
  commissionMinor: number;
  commissionVatMinor: number;
  netPayableMinor: number;
  currency: 'TRY';
};

export type SettlementApprovalPreviewDto = {
  ok: true;
  writesPerformed: false;
  vendorId: string;
  periodStart: string | null;
  periodEnd: string | null;
  summary: SettlementApprovalTotalsDto & {
    eligibleRowCount: number;
    excludedActiveApprovalRowCount: number;
    detectedCommissionRates: number[];
    detectedCommissionVatRates: number[];
    detectedShippingModes: string[];
    detectedFinancialProfileSnapshotIds: string[];
    mixedCommissionRate: boolean;
    mixedCommissionVatRate: boolean;
    mixedShippingMode: boolean;
    candidateQualityWarnings: string[];
  };
  lines: SettlementApprovalLineDto[];
};

export type SettlementApprovalDto = {
  ok: true;
  writesPerformed: boolean;
  id: string;
  createdAt: string;
  vendorId: string;
  status: 'draft' | 'approved' | 'cancelled';
  periodStart: string | null;
  periodEnd: string | null;
  currency: string;
  grossSalesMinor: number;
  refundTotalMinor: number;
  commissionMinor: number;
  commissionVatMinor: number;
  netPayableMinor: number;
  approvedBy: string | null;
  approvedAt: string | null;
  cancelledBy: string | null;
  cancelledAt: string | null;
  notes: string | null;
  sourceSnapshotJson: unknown;
  lines: SettlementApprovalLineDto[];
};

export type SettlementApprovalSummaryDto = {
  id: string;
  createdAt: string;
  vendorId: string;
  status: SettlementApprovalDto['status'];
  currency: string;
  grossSalesMinor: number;
  netPayableMinor: number;
  approvedAt: string | null;
  lineCount: number;
};

export type SettlementApprovalListDto = {
  ok: true;
  writesPerformed: false;
  vendorId: string;
  approvals: SettlementApprovalSummaryDto[];
};

export type SettlementApprovalAuditDto = {
  approvalId: string;
  status: SettlementApprovalDto['status'];
  totals: SettlementApprovalTotalsDto;
  lines: Array<{
    financeLedgerEntryId: string;
    storedSettlementStatus: string | null;
    derivedSettlementStatus: string;
    payoutStatus: string | null;
    eligibilityDecision: 'included' | 'excluded';
    eligibilityReason: string;
  }>;
};

function toNumber(value: unknown) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function toMinorUnits(value: number) {
  return Math.round(value * 100);
}

function normalizeType(value: string) {
  return value.trim().toLowerCase();
}

function normalizeStatus(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? '';
}

function toIso(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

function mapShippingMode(mode: string | null | undefined): ShippingMode {
  const normalized = mode?.trim().toLowerCase();
  if (normalized === 'fixed') {
    return 'fixed';
  }
  if (normalized === 'external_provider') {
    return 'external_provider';
  }
  return 'disabled';
}

function isFulfilledForSettlement(allocation: SettlementApprovalLedgerRow['vendorAllocation']) {
  const lifecycle = [
    allocation?.allocationStatus,
    allocation?.fulfillmentStatus,
    allocation?.shippingStatus,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return Boolean(
    allocation?.fulfillment?.fulfilledAt ||
      lifecycle.includes('fulfilled') ||
      lifecycle.includes('shipped') ||
      lifecycle.includes('in transit') ||
      lifecycle.includes('delivered'),
  );
}

function hasFulfillmentEvidence(allocation: SettlementApprovalLedgerRow['vendorAllocation']) {
  const lifecycle = [
    allocation?.allocationStatus,
    allocation?.fulfillmentStatus,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return Boolean(
    allocation?.fulfillment?.fulfilledAt || lifecycle.includes('fulfilled')
  );
}

function hasShippingEvidence(allocation: SettlementApprovalLedgerRow['vendorAllocation']) {
  const shippingStatus = allocation?.shippingStatus?.trim().toLowerCase() ?? '';
  return (
    shippingStatus.includes('shipped') ||
    shippingStatus.includes('in transit') ||
    shippingStatus.includes('delivered')
  );
}

function sumRefundImpact(refundRecords: Array<{ amount: unknown }> | undefined) {
  return (refundRecords ?? []).reduce((sum, refundRecord) => sum + toNumber(refundRecord.amount), 0);
}

function resolveSettlementStatus(row: SettlementApprovalLedgerRow) {
  const payoutStatus = normalizeStatus(row.payoutStatus);
  if (payoutStatus === 'hold') {
    return 'held';
  }
  if (payoutStatus === 'paid') {
    return 'settled';
  }

  const storedStatus = normalizeStatus(row.settlementStatus);
  if (storedStatus === 'held' || storedStatus === 'settled' || storedStatus === 'disputed') {
    return storedStatus;
  }

  const type = normalizeType(row.entryType);
  if (type === 'refund' || sumRefundImpact(row.vendorAllocation?.refundRecords) > 0) {
    return 'partially_refunded';
  }
  if (type === 'sale') {
    return isFulfilledForSettlement(row.vendorAllocation) ? 'payable' : 'accruing';
  }
  return storedStatus || 'pending';
}

function rowIsEligible(row: SettlementApprovalLedgerRow) {
  const type = normalizeType(row.entryType);
  if (type !== 'sale' && type !== 'refund') {
    return false;
  }
  const settlementStatus = resolveSettlementStatus(row);
  return settlementStatus === 'payable' || settlementStatus === 'partially_refunded';
}

function rowHasActiveApproval(row: SettlementApprovalLedgerRow) {
  return row.settlementApprovalLines.some(
    (line) => line.settlementApproval.status !== SettlementApprovalStatus.CANCELLED,
  );
}

export function buildSettlementEligibilityExplanation(row: SettlementApprovalLedgerRow): {
  storedSettlementStatus: string | null;
  derivedSettlementStatus: string;
  eligibilityDecision: 'included' | 'excluded';
  eligibilityReason: string;
  refundDetected: boolean;
  refundCount: number;
  fulfillmentEvidencePresent: boolean;
  shippingEvidencePresent: boolean;
  payoutStatus: string | null;
} {
  const type = normalizeType(row.entryType);
  const payoutStatus = normalizeStatus(row.payoutStatus);
  const refundCount = row.vendorAllocation?.refundRecords.length ?? 0;
  const refundDetected = type === 'refund' || refundCount > 0;
  const fulfillmentEvidencePresent = hasFulfillmentEvidence(row.vendorAllocation);
  const shippingEvidencePresent = hasShippingEvidence(row.vendorAllocation);
  const derivedSettlementStatus = resolveSettlementStatus(row);
  let eligibilityDecision: 'included' | 'excluded' = rowIsEligible(row) ? 'included' : 'excluded';
  let eligibilityReason = 'Excluded because row is not payable or partially refunded.';

  if (type !== 'sale' && type !== 'refund') {
    eligibilityReason = 'Excluded because row type is not sale or refund.';
  } else if (payoutStatus === 'hold') {
    eligibilityReason = 'Excluded because payout status is HOLD.';
  } else if (rowHasActiveApproval(row)) {
    eligibilityDecision = 'excluded';
    eligibilityReason = 'Excluded because row already belongs to active settlement approval.';
  } else if (derivedSettlementStatus === 'partially_refunded') {
    eligibilityReason = 'Derived partially refunded because refund records exist.';
  } else if (derivedSettlementStatus === 'payable' && fulfillmentEvidencePresent) {
    eligibilityReason = 'Derived payable because fulfillment evidence exists.';
  } else if (derivedSettlementStatus === 'payable' && shippingEvidencePresent) {
    eligibilityReason = 'Derived payable because shipping evidence exists.';
  }

  return {
    storedSettlementStatus: row.settlementStatus,
    derivedSettlementStatus,
    eligibilityDecision,
    eligibilityReason,
    refundDetected,
    refundCount,
    fulfillmentEvidencePresent,
    shippingEvidencePresent,
    payoutStatus: row.payoutStatus,
  };
}

function resolveCalculationProfile(row: SettlementApprovalLedgerRow): VendorFinanceProfileConfig {
  if (row.commissionPercentSnapshot !== null && row.commissionPercentSnapshot !== undefined) {
    return {
      commissionPercent: toNumber(row.commissionPercentSnapshot),
      commissionVatPercent: toNumber(row.commissionVatPercentSnapshot),
      deductShippingEnabled: row.deductShippingEnabledSnapshot ?? false,
      shippingMode: mapShippingMode(row.shippingModeSnapshot),
      fixedShippingFee:
        row.fixedShippingFeeSnapshot === null || row.fixedShippingFeeSnapshot === undefined
          ? null
          : toNumber(row.fixedShippingFeeSnapshot),
      externalProviderShippingCost:
        row.shippingCostSnapshot === null || row.shippingCostSnapshot === undefined
          ? null
          : toNumber(row.shippingCostSnapshot),
      externalProviderShippingVatAmount:
        row.shippingVatAmountSnapshot === null || row.shippingVatAmountSnapshot === undefined
          ? null
          : toNumber(row.shippingVatAmountSnapshot),
      shippingCostSource: row.shippingCostSourceSnapshot,
      shippingCostProvider: row.shippingCostProviderSnapshot,
    };
  }

  return DEFAULT_VENDOR_FINANCIAL_PROFILE;
}

function buildLine(row: SettlementApprovalLedgerRow): SettlementApprovalLineDraft {
  const type = normalizeType(row.entryType);
  const eligibilityExplanation = buildSettlementEligibilityExplanation(row);
  if (type === 'refund') {
    const refundMinor = toMinorUnits(toNumber(row.amount));
    return {
      financeLedgerEntryId: row.id,
      lineType: SettlementApprovalLineType.REFUND,
      amountMinor: refundMinor,
      commissionMinor: 0,
      commissionVatMinor: 0,
      payableImpactMinor: -refundMinor,
      ...eligibilityExplanation,
      sourceSnapshotJson: {
        financeLedgerEntryId: row.id,
        entryType: row.entryType,
        amount: String(row.amount),
        settlementStatus: row.settlementStatus,
        resolvedSettlementStatus: resolveSettlementStatus(row),
        ...eligibilityExplanation,
        vendorAllocationId: row.vendorAllocation?.id ?? null,
        sourceShopifyOrderId: row.vendorAllocation?.sourceShopifyOrderId ?? null,
        sourceShopifyOrderNumber: row.vendorAllocation?.sourceShopifyOrderNumber ?? null,
      },
    };
  }

  const grossAmount = toNumber(row.amount);
  const calculation = calculateVendorPayout({
    grossAmount,
    refundAmount: 0,
    fulfilled: isFulfilledForSettlement(row.vendorAllocation),
    profile: resolveCalculationProfile(row),
  });

  return {
    financeLedgerEntryId: row.id,
    lineType: SettlementApprovalLineType.SALE,
    amountMinor: toMinorUnits(grossAmount),
    commissionMinor: toMinorUnits(calculation.commission),
    commissionVatMinor: toMinorUnits(calculation.commissionVat),
    payableImpactMinor: toMinorUnits(calculation.estimatedPayout),
    ...eligibilityExplanation,
    sourceSnapshotJson: {
      financeLedgerEntryId: row.id,
      entryType: row.entryType,
      amount: String(row.amount),
      settlementStatus: row.settlementStatus,
      resolvedSettlementStatus: resolveSettlementStatus(row),
      ...eligibilityExplanation,
      vendorAllocationId: row.vendorAllocation?.id ?? null,
      sourceShopifyOrderId: row.vendorAllocation?.sourceShopifyOrderId ?? null,
      sourceShopifyOrderNumber: row.vendorAllocation?.sourceShopifyOrderNumber ?? null,
      commissionPercentSnapshot: row.commissionPercentSnapshot === null ? null : String(row.commissionPercentSnapshot),
      commissionVatPercentSnapshot:
        row.commissionVatPercentSnapshot === null ? null : String(row.commissionVatPercentSnapshot),
      deductShippingEnabledSnapshot: row.deductShippingEnabledSnapshot,
      shippingModeSnapshot: row.shippingModeSnapshot,
      fixedShippingFeeSnapshot: row.fixedShippingFeeSnapshot === null ? null : String(row.fixedShippingFeeSnapshot),
      shippingCostSnapshot: row.shippingCostSnapshot === null ? null : String(row.shippingCostSnapshot),
      shippingVatAmountSnapshot: row.shippingVatAmountSnapshot === null ? null : String(row.shippingVatAmountSnapshot),
      shippingCostSourceSnapshot: row.shippingCostSourceSnapshot,
      shippingCostProviderSnapshot: row.shippingCostProviderSnapshot,
    },
  };
}

function summarizeLines(lines: SettlementApprovalLineDraft[]): SettlementApprovalTotalsDto {
  return lines.reduce(
    (summary, line) => ({
      ...summary,
      grossSalesMinor:
        line.lineType === SettlementApprovalLineType.SALE
          ? summary.grossSalesMinor + line.amountMinor
          : summary.grossSalesMinor,
      refundTotalMinor:
        line.lineType === SettlementApprovalLineType.REFUND
          ? summary.refundTotalMinor + line.amountMinor
          : summary.refundTotalMinor,
      commissionMinor: summary.commissionMinor + line.commissionMinor,
      commissionVatMinor: summary.commissionVatMinor + line.commissionVatMinor,
      netPayableMinor: summary.netPayableMinor + line.payableImpactMinor,
    }),
    {
      grossSalesMinor: 0,
      refundTotalMinor: 0,
      commissionMinor: 0,
      commissionVatMinor: 0,
      netPayableMinor: 0,
      currency: 'TRY' as const,
    },
  );
}

function sortedNumbers(values: Set<number>) {
  return Array.from(values).sort((a, b) => a - b);
}

function sortedStrings(values: Set<string>) {
  return Array.from(values).sort((a, b) => a.localeCompare(b));
}

function normalizeQualityNumber(value: unknown) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const numeric = toNumber(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function buildCandidateQualitySummary(
  rows: SettlementApprovalLedgerRow[],
  input: SettlementApprovalInput,
) {
  const commissionRates = new Set<number>();
  const commissionVatRates = new Set<number>();
  const shippingModes = new Set<string>();
  const financialProfileIds = new Set<string>();

  for (const row of rows) {
    if (normalizeType(row.entryType) !== 'sale') {
      continue;
    }

    const commissionRate = normalizeQualityNumber(row.commissionPercentSnapshot);
    if (commissionRate !== null) {
      commissionRates.add(commissionRate);
    }

    const commissionVatRate = normalizeQualityNumber(row.commissionVatPercentSnapshot);
    if (commissionVatRate !== null) {
      commissionVatRates.add(commissionVatRate);
    }

    const shippingMode = row.shippingModeSnapshot?.trim();
    if (shippingMode) {
      shippingModes.add(shippingMode);
    }

    const financialProfileId = row.financialProfileIdSnapshot?.trim();
    if (financialProfileId) {
      financialProfileIds.add(financialProfileId);
    }
  }

  const detectedCommissionRates = sortedNumbers(commissionRates);
  const detectedCommissionVatRates = sortedNumbers(commissionVatRates);
  const detectedShippingModes = sortedStrings(shippingModes);
  const detectedFinancialProfileSnapshotIds = sortedStrings(financialProfileIds);
  const mixedCommissionRate = detectedCommissionRates.length > 1;
  const mixedCommissionVatRate = detectedCommissionVatRates.length > 1;
  const mixedShippingMode = detectedShippingModes.length > 1;
  const candidateQualityWarnings: string[] = [];

  if (!input.periodStart && !input.periodEnd) {
    candidateQualityWarnings.push('Vendor-wide preview can include historical or test rows.');
  }
  if (mixedCommissionRate) {
    candidateQualityWarnings.push('Candidate rows include mixed commission rates.');
  }
  if (mixedCommissionVatRate) {
    candidateQualityWarnings.push('Candidate rows include mixed commission VAT rates. Logo readiness will block mixed VAT settlements.');
  }
  if (mixedShippingMode) {
    candidateQualityWarnings.push('Candidate rows include mixed shipping modes.');
  }

  return {
    detectedCommissionRates,
    detectedCommissionVatRates,
    detectedShippingModes,
    detectedFinancialProfileSnapshotIds,
    mixedCommissionRate,
    mixedCommissionVatRate,
    mixedShippingMode,
    candidateQualityWarnings,
  };
}

function buildPeriodWhere(input: SettlementApprovalInput) {
  const createdAt: { gte?: Date; lte?: Date } = {};
  if (input.periodStart) {
    createdAt.gte = input.periodStart;
  }
  if (input.periodEnd) {
    createdAt.lte = input.periodEnd;
  }

  return Object.keys(createdAt).length ? { createdAt } : {};
}

async function buildApprovalPreview(
  input: SettlementApprovalInput,
  tx: SettlementApprovalTransaction = prisma,
): Promise<SettlementApprovalPreviewDto> {
  if (!input.vendorId) {
    throw new Error('vendorId is required.');
  }

  const rows = await tx.financeLedgerEntry.findMany({
    where: {
      vendorId: input.vendorId,
      entryType: {
        in: ['sale', 'refund'],
      },
      ...buildPeriodWhere(input),
    },
    select: {
      id: true,
      vendorId: true,
      entryType: true,
      amount: true,
      payoutStatus: true,
      description: true,
      commissionPercentSnapshot: true,
      commissionVatPercentSnapshot: true,
      deductShippingEnabledSnapshot: true,
      shippingModeSnapshot: true,
      fixedShippingFeeSnapshot: true,
      shippingCostSnapshot: true,
      shippingVatAmountSnapshot: true,
      shippingCostSourceSnapshot: true,
      shippingCostProviderSnapshot: true,
      financialProfileIdSnapshot: true,
      settlementStatus: true,
      settlementEligibleAt: true,
      accruedAt: true,
      payableAt: true,
      settledAt: true,
      settlementHoldReason: true,
      createdAt: true,
      vendorAllocation: {
        select: {
          id: true,
          allocationStatus: true,
          fulfillmentStatus: true,
          shippingStatus: true,
          sourceShopifyOrderId: true,
          sourceShopifyOrderNumber: true,
          fulfillment: {
            select: {
              fulfilledAt: true,
            },
          },
          refundRecords: {
            select: {
              id: true,
              sourceShopifyRefundId: true,
              amount: true,
            },
          },
        },
      },
      settlementApprovalLines: {
        where: {
          settlementApproval: {
            status: {
              in: [SettlementApprovalStatus.DRAFT, SettlementApprovalStatus.APPROVED],
            },
          },
        },
        select: {
          id: true,
          settlementApproval: {
            select: {
              id: true,
              status: true,
            },
          },
        },
      },
    },
    orderBy: {
      createdAt: 'asc',
    },
  });

  const eligibleRows = (rows as SettlementApprovalLedgerRow[]).filter(rowIsEligible);
  const unapprovedRows = eligibleRows.filter((row) => !rowHasActiveApproval(row));
  const lines = unapprovedRows.map(buildLine);
  const totals = summarizeLines(lines);
  const candidateQualitySummary = buildCandidateQualitySummary(unapprovedRows, input);

  return {
    ok: true,
    writesPerformed: false,
    vendorId: input.vendorId,
    periodStart: toIso(input.periodStart),
    periodEnd: toIso(input.periodEnd),
    summary: {
      ...totals,
      eligibleRowCount: lines.length,
      excludedActiveApprovalRowCount: eligibleRows.length - unapprovedRows.length,
      ...candidateQualitySummary,
    },
    lines,
  };
}

function mapApproval(
  approval: SettlementApproval & { lines: SettlementApprovalLine[] },
  writesPerformed: boolean,
): SettlementApprovalDto {
  return {
    ok: true,
    writesPerformed,
    id: approval.id,
    createdAt: approval.createdAt.toISOString(),
    vendorId: approval.vendorId,
    status: approval.status.toLowerCase() as SettlementApprovalDto['status'],
    periodStart: toIso(approval.periodStart),
    periodEnd: toIso(approval.periodEnd),
    currency: approval.currency,
    grossSalesMinor: approval.grossSalesMinor,
    refundTotalMinor: approval.refundTotalMinor,
    commissionMinor: approval.commissionMinor,
    commissionVatMinor: approval.commissionVatMinor,
    netPayableMinor: approval.netPayableMinor,
    approvedBy: approval.approvedBy,
    approvedAt: toIso(approval.approvedAt),
    cancelledBy: approval.cancelledBy,
    cancelledAt: toIso(approval.cancelledAt),
    notes: approval.notes,
    sourceSnapshotJson: approval.sourceSnapshotJson,
    lines: approval.lines.map((line) => ({
      id: line.id,
      financeLedgerEntryId: line.financeLedgerEntryId,
      lineType: line.lineType,
      amountMinor: line.amountMinor,
      commissionMinor: line.commissionMinor,
      commissionVatMinor: line.commissionVatMinor,
      payableImpactMinor: line.payableImpactMinor,
      sourceSnapshotJson: line.sourceSnapshotJson as Prisma.InputJsonValue,
      ...readLineExplanation(line.sourceSnapshotJson),
    })),
  };
}

function mapApprovalSummary(approval: SettlementApproval & { _count: { lines: number } }): SettlementApprovalSummaryDto {
  return {
    id: approval.id,
    createdAt: approval.createdAt.toISOString(),
    vendorId: approval.vendorId,
    status: approval.status.toLowerCase() as SettlementApprovalDto['status'],
    currency: approval.currency,
    grossSalesMinor: approval.grossSalesMinor,
    netPayableMinor: approval.netPayableMinor,
    approvedAt: toIso(approval.approvedAt),
    lineCount: approval._count.lines,
  };
}

function readSnapshotRecord(value: unknown): Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readSnapshotString(value: unknown) {
  return typeof value === 'string' ? value : null;
}

function readSnapshotBoolean(value: unknown) {
  return typeof value === 'boolean' ? value : false;
}

function readSnapshotNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function readLineExplanation(sourceSnapshotJson: unknown) {
  const snapshot = readSnapshotRecord(sourceSnapshotJson);
  return {
    storedSettlementStatus:
      readSnapshotString(snapshot.storedSettlementStatus) ?? readSnapshotString(snapshot.settlementStatus),
    derivedSettlementStatus:
      readSnapshotString(snapshot.derivedSettlementStatus) ??
      readSnapshotString(snapshot.resolvedSettlementStatus) ??
      'unknown',
    payoutStatus: readSnapshotString(snapshot.payoutStatus),
    eligibilityDecision:
      snapshot.eligibilityDecision === 'excluded' ? ('excluded' as const) : ('included' as const),
    eligibilityReason: readSnapshotString(snapshot.eligibilityReason) ?? 'Eligibility explanation unavailable.',
    refundDetected: readSnapshotBoolean(snapshot.refundDetected),
    refundCount: readSnapshotNumber(snapshot.refundCount),
    fulfillmentEvidencePresent: readSnapshotBoolean(snapshot.fulfillmentEvidencePresent),
    shippingEvidencePresent: readSnapshotBoolean(snapshot.shippingEvidencePresent),
  };
}

export async function previewApproval(
  vendorId: string,
  periodStart?: Date | null,
  periodEnd?: Date | null,
): Promise<SettlementApprovalPreviewDto> {
  return buildApprovalPreview({ vendorId, periodStart, periodEnd });
}

export async function createDraftApproval(
  input: SettlementApprovalInput,
): Promise<SettlementApprovalDto> {
  return prisma.$transaction(
    async (tx) => {
      const preview = await buildApprovalPreview(input, tx);
      if (preview.lines.length === 0) {
        throw new Error('No eligible settlement rows are available for approval.');
      }

      const activeLineCount = await tx.settlementApprovalLine.count({
        where: {
          financeLedgerEntryId: {
            in: preview.lines.map((line) => line.financeLedgerEntryId),
          },
          settlementApproval: {
            status: {
              in: [SettlementApprovalStatus.DRAFT, SettlementApprovalStatus.APPROVED],
            },
          },
        },
      });
      if (activeLineCount > 0) {
        throw new Error('One or more settlement rows are already linked to an active approval.');
      }

      const approval = await tx.settlementApproval.create({
        data: {
          vendorId: input.vendorId,
          periodStart: input.periodStart ?? null,
          periodEnd: input.periodEnd ?? null,
          status: SettlementApprovalStatus.DRAFT,
          currency: 'TRY',
          grossSalesMinor: preview.summary.grossSalesMinor,
          refundTotalMinor: preview.summary.refundTotalMinor,
          commissionMinor: preview.summary.commissionMinor,
          commissionVatMinor: preview.summary.commissionVatMinor,
          netPayableMinor: preview.summary.netPayableMinor,
          notes: input.notes ?? null,
          sourceSnapshotJson: {
            vendorId: input.vendorId,
            periodStart: toIso(input.periodStart),
            periodEnd: toIso(input.periodEnd),
            generatedAt: new Date().toISOString(),
            eligibleRowCount: preview.summary.eligibleRowCount,
            excludedActiveApprovalRowCount: preview.summary.excludedActiveApprovalRowCount,
            writesPerformed: false,
          },
          lines: {
            create: preview.lines.map((line) => ({
              financeLedgerEntryId: line.financeLedgerEntryId,
              lineType: line.lineType,
              amountMinor: line.amountMinor,
              commissionMinor: line.commissionMinor,
              commissionVatMinor: line.commissionVatMinor,
              payableImpactMinor: line.payableImpactMinor,
              sourceSnapshotJson: line.sourceSnapshotJson,
            })),
          },
        },
        include: {
          lines: true,
        },
      });

      return mapApproval(approval, true);
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    },
  );
}

export async function approveSettlementApproval(
  id: string,
  approvedBy: string | null,
): Promise<SettlementApprovalDto> {
  const existing = await prisma.settlementApproval.findUnique({
    where: {
      id,
    },
    include: {
      lines: true,
    },
  });
  if (!existing) {
    throw new Error('Settlement approval could not be found.');
  }
  if (existing.status !== SettlementApprovalStatus.DRAFT) {
    throw new Error('Only draft settlement approvals can be approved.');
  }

  const approved = await prisma.settlementApproval.update({
    where: {
      id,
    },
    data: {
      status: SettlementApprovalStatus.APPROVED,
      approvedBy,
      approvedAt: new Date(),
    },
    include: {
      lines: true,
    },
  });

  return mapApproval(approved, true);
}

export async function cancelSettlementApproval(
  id: string,
  cancelledBy: string | null,
): Promise<SettlementApprovalDto> {
  const existing = await prisma.settlementApproval.findUnique({
    where: {
      id,
    },
    include: {
      commissionInvoices: {
        where: {
          status: {
            not: SettlementCommissionInvoiceStatus.CANCELLED,
          },
        },
        select: {
          id: true,
        },
      },
      lines: true,
    },
  });
  if (!existing) {
    throw new Error('Settlement approval could not be found.');
  }
  if (existing.status === SettlementApprovalStatus.CANCELLED) {
    throw new Error('Settlement approval is already cancelled.');
  }
  const activeCommissionInvoices = (existing as typeof existing & { commissionInvoices: Array<{ id: string }> })
    .commissionInvoices;
  if (activeCommissionInvoices.length > 0) {
    throw new Error('Settlement approval cannot be cancelled because an active commission invoice record exists.');
  }

  const cancelled = await prisma.settlementApproval.update({
    where: {
      id,
    },
    data: {
      status: SettlementApprovalStatus.CANCELLED,
      cancelledBy,
      cancelledAt: new Date(),
    },
    include: {
      lines: true,
    },
  });

  return mapApproval(cancelled, true);
}

export async function getSettlementApproval(id: string): Promise<SettlementApprovalDto | null> {
  const approval = await prisma.settlementApproval.findUnique({
    where: {
      id,
    },
    include: {
      lines: true,
    },
  });

  return approval ? mapApproval(approval, false) : null;
}

export async function listSettlementApprovalsForVendor(vendorId: string): Promise<SettlementApprovalListDto> {
  if (!vendorId) {
    throw new Error('vendorId is required.');
  }

  const approvals = await prisma.settlementApproval.findMany({
    where: {
      vendorId,
    },
    orderBy: {
      createdAt: 'desc',
    },
    take: 20,
    include: {
      _count: {
        select: {
          lines: true,
        },
      },
    },
  });

  return {
    ok: true,
    writesPerformed: false,
    vendorId,
    approvals: approvals.map(mapApprovalSummary),
  };
}

export async function getSettlementApprovalAudit(id: string): Promise<SettlementApprovalAuditDto | null> {
  const approval = await getSettlementApproval(id);
  if (!approval) {
    return null;
  }

  return {
    approvalId: approval.id,
    status: approval.status,
    totals: {
      grossSalesMinor: approval.grossSalesMinor,
      refundTotalMinor: approval.refundTotalMinor,
      commissionMinor: approval.commissionMinor,
      commissionVatMinor: approval.commissionVatMinor,
      netPayableMinor: approval.netPayableMinor,
      currency: 'TRY',
    },
    lines: approval.lines.map((line) => ({
      financeLedgerEntryId: line.financeLedgerEntryId,
      storedSettlementStatus: line.storedSettlementStatus,
      derivedSettlementStatus: line.derivedSettlementStatus,
      payoutStatus: line.payoutStatus,
      eligibilityDecision: line.eligibilityDecision,
      eligibilityReason: line.eligibilityReason,
    })),
  };
}

export const __settlementApprovalTesting = {
  buildApprovalPreview,
  buildLine,
  buildSettlementEligibilityExplanation,
  resolveSettlementStatus,
};
