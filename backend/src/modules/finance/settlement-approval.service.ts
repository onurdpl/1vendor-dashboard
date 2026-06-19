import {
  Prisma,
  SettlementApprovalLineType,
  SettlementApprovalStatus,
  SettlementCommissionInvoiceStatus,
  SettlementRefundAdjustmentApplicationStatus,
  SettlementRefundAdjustmentStatus,
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
import { buildSettlementBillingSnapshot } from './settlement-billing-snapshot.service.js';
import { APPROVED_OPEN_RETURN_HOLD_REASON, hasApprovedOpenReturnHold } from './settlement-return-hold.service.js';
import {
  evaluateSaleSettlementDelay,
  MISSING_DELIVERY_DATE_REASON,
  SETTLEMENT_DELAY_PENDING_REASON,
} from './settlement-delay-eligibility.service.js';
import {
  calculateRefundOffsetAmounts,
  getUnsettledRefundOffsetEligibility,
  type RefundOffsetSaleLedgerSnapshot,
} from './refund-offset.service.js';
import { calculateVendorDebtOffset, getVendorBalanceSummary } from './vendor-balance.service.js';
import {
  previewPendingRefundAdjustmentApplication,
  type PendingRefundAdjustmentApplicationPreview,
} from './settlement-refund-adjustment-eligibility-diagnostics.service.js';

type SettlementApprovalTransaction = Prisma.TransactionClient;

const ACTIVE_PAYOUT_BATCH_STATUSES = ['DRAFT', 'REVIEW', 'APPROVED', 'EXECUTION_PENDING', 'PAID_PLACEHOLDER'] as const;

type SettlementApprovalInput = {
  vendorId: string;
  periodStart?: Date | null;
  periodEnd?: Date | null;
  notes?: string | null;
  candidateScope?: CandidateScope | null;
  selectedOrderIds?: string[];
  selectedShopifyOrderIds?: string[];
  selectedAllocationIds?: string[];
};

type CandidateScope = 'vendor_wide' | 'date_range' | 'selected_orders' | 'selected_allocations';

type CandidateSelectionSummaryDto = {
  requestedOrders: string[];
  matchedOrders: string[];
  unmatchedOrders: string[];
  requestedAllocations: string[];
  matchedAllocations: string[];
  unmatchedAllocations: string[];
  candidateRowCount: number;
};

type SelectedOrderDiagnosticDto = {
  requestedIdentifier: string;
  matched: boolean;
  matchedOrderNumber: string | null;
  matchedShopifyOrderId: string | null;
  financeLedgerEntryId: string | null;
  candidateIncluded: boolean;
  excludedReason: string | null;
  lockedApprovalId: string | null;
  lockedApprovalStatus: string | null;
  currentSettlementStatus: string | null;
  derivedSettlementStatus: string | null;
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
  settlementDelayDaysSnapshot: number | null;
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
      shipmentUpdatedAt: Date | null;
    } | null;
    refundRecords: Array<{
      id: string;
      sourceShopifyRefundId: string;
      amount: unknown;
    }>;
    returnRecords: Array<{
      id: string;
      status: string;
      returnLifecycleStatus: string | null;
      sourceShopifyRefundId: string | null;
    }>;
    financeEntries?: RefundOffsetSaleLedgerSnapshot[];
  } | null;
  settlementApprovalLines: Array<{
    id: string;
    settlementApproval: {
      id: string;
      status: SettlementApprovalStatus;
    };
  }>;
};

type SettlementApprovalRevalidationLedgerRow = SettlementApprovalLedgerRow & {
  payoutBatchLines: Array<{
    id: string;
    payoutBatch: {
      id: string;
      status: string;
    };
  }>;
};

type SettlementApprovalLineDraft = {
  financeLedgerEntryId: string;
  settlementRefundAdjustmentId?: string | null;
  settlementRefundAdjustmentApplicationId?: string | null;
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

export type SettlementApprovalRevalidationReason = {
  settlementApprovalLineId: string;
  financeLedgerEntryId: string;
  code: string;
  reason: string;
  details?: Record<string, unknown>;
};

export class SettlementApprovalRevalidationError extends Error {
  reasons: SettlementApprovalRevalidationReason[];

  constructor(reasons: SettlementApprovalRevalidationReason[]) {
    super('Settlement approval cannot be approved because one or more lines are no longer valid.');
    this.name = 'SettlementApprovalRevalidationError';
    this.reasons = reasons;
    Object.setPrototypeOf(this, SettlementApprovalRevalidationError.prototype);
  }
}

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
  candidateScope: CandidateScope;
  candidateSelectionSummary: CandidateSelectionSummaryDto;
  selectedOrderDiagnostics: SelectedOrderDiagnosticDto[];
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
    outstandingVendorDebtMinor: number;
    debtOffsetPreviewMinor: number;
    netPayableAfterDebtOffsetMinor: number;
    remainingVendorDebtMinor: number;
    pendingRefundAdjustmentCount: number;
    pendingRefundAdjustmentTotalMinor: number;
    netAfterPendingRefundAdjustmentsMinor: number;
  };
  pendingRefundAdjustments: PendingRefundAdjustmentApplicationPreview;
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

function getValidRefundRecord(row: SettlementApprovalLedgerRow) {
  return row.vendorAllocation?.refundRecords.find((refund) => refund.sourceShopifyRefundId || refund.id) ?? null;
}

function getRelatedSaleLedgerEntry(row: SettlementApprovalLedgerRow) {
  return row.vendorAllocation?.financeEntries?.find((entry) =>
    normalizeType(entry.entryType ?? '') === 'sale' && entry.id !== row.id
  ) ?? null;
}

function getRefundOffsetEligibility(
  row: SettlementApprovalLedgerRow,
  currentSettlementApprovalId?: string | null,
) {
  return getUnsettledRefundOffsetEligibility({
    refundRecord: getValidRefundRecord(row),
    relatedSaleLedgerEntry: getRelatedSaleLedgerEntry(row),
    currentSettlementApprovalId,
  });
}

function resolveRefundCommissionSnapshot(row: SettlementApprovalLedgerRow) {
  const relatedSale = getRelatedSaleLedgerEntry(row);
  return {
    commissionPercentSnapshot: row.commissionPercentSnapshot ?? relatedSale?.commissionPercentSnapshot ?? null,
    commissionVatPercentSnapshot: row.commissionVatPercentSnapshot ?? relatedSale?.commissionVatPercentSnapshot ?? null,
  };
}

function resolveSettlementStatus(row: SettlementApprovalLedgerRow, currentSettlementApprovalId?: string | null) {
  const type = normalizeType(row.entryType);
  const payoutStatus = normalizeStatus(row.payoutStatus);
  if (payoutStatus === 'paid') {
    return 'settled';
  }
  if (type === 'refund' && getRefundOffsetEligibility(row, currentSettlementApprovalId).eligible) {
    return 'partially_refunded';
  }
  if (payoutStatus === 'hold') {
    return 'held';
  }

  const storedStatus = normalizeStatus(row.settlementStatus);
  if (storedStatus === 'held' || storedStatus === 'settled' || storedStatus === 'disputed') {
    return storedStatus;
  }

  if (type === 'refund' || sumRefundImpact(row.vendorAllocation?.refundRecords) > 0) {
    return 'partially_refunded';
  }
  if (hasApprovedOpenReturnHold(row)) {
    return 'held';
  }
  if (type === 'sale') {
    return evaluateSaleSettlementDelay(row).eligible ? 'payable' : 'accruing';
  }
  return storedStatus || 'pending';
}

function rowIsEligible(row: SettlementApprovalLedgerRow, currentSettlementApprovalId?: string | null) {
  const type = normalizeType(row.entryType);
  if (type !== 'sale' && type !== 'refund') {
    return false;
  }
  if (normalizeStatus(row.payoutStatus) === 'paid') {
    return false;
  }
  if (type === 'refund' && !getRefundOffsetEligibility(row, currentSettlementApprovalId).eligible) {
    return false;
  }
  const settlementStatus = resolveSettlementStatus(row, currentSettlementApprovalId);
  return (settlementStatus === 'payable' || settlementStatus === 'partially_refunded') && !hasApprovedOpenReturnHold(row);
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
  const settlementDelay = evaluateSaleSettlementDelay(row);
  const refundOffsetEligibility = type === 'refund' ? getRefundOffsetEligibility(row) : null;
  const derivedSettlementStatus = resolveSettlementStatus(row);
  let eligibilityDecision: 'included' | 'excluded' = rowIsEligible(row) ? 'included' : 'excluded';
  let eligibilityReason = 'Excluded because row is not payable or partially refunded.';

  if (type !== 'sale' && type !== 'refund') {
    eligibilityReason = 'Excluded because row type is not sale or refund.';
  } else if (rowHasActiveApproval(row)) {
    eligibilityDecision = 'excluded';
    eligibilityReason = 'Excluded because row already belongs to active settlement approval.';
  } else if (type === 'refund' && refundOffsetEligibility?.eligible) {
    eligibilityReason = refundOffsetEligibility.reason;
  } else if (type === 'refund' && refundOffsetEligibility && !refundOffsetEligibility.eligible) {
    eligibilityReason = refundOffsetEligibility.reason;
  } else if (payoutStatus === 'hold') {
    eligibilityReason = 'Excluded because payout status is HOLD.';
  } else if (hasApprovedOpenReturnHold(row)) {
    eligibilityReason = APPROVED_OPEN_RETURN_HOLD_REASON;
  } else if (derivedSettlementStatus === 'partially_refunded') {
    eligibilityReason = 'Derived partially refunded because refund records exist.';
  } else if (settlementDelay.applies && settlementDelay.blockerReason === MISSING_DELIVERY_DATE_REASON) {
    eligibilityReason = MISSING_DELIVERY_DATE_REASON;
  } else if (settlementDelay.applies && settlementDelay.blockerReason === SETTLEMENT_DELAY_PENDING_REASON) {
    eligibilityReason = SETTLEMENT_DELAY_PENDING_REASON;
  } else if (derivedSettlementStatus === 'payable' && fulfillmentEvidencePresent) {
    eligibilityReason = 'Derived payable because delivery evidence satisfies settlement delay.';
  } else if (derivedSettlementStatus === 'payable' && shippingEvidencePresent) {
    eligibilityReason = 'Derived payable because delivery evidence satisfies settlement delay.';
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
      settlementDelayDays: row.settlementDelayDaysSnapshot ?? DEFAULT_VENDOR_FINANCIAL_PROFILE.settlementDelayDays,
    };
  }

  return DEFAULT_VENDOR_FINANCIAL_PROFILE;
}

function buildLine(row: SettlementApprovalLedgerRow): SettlementApprovalLineDraft {
  const type = normalizeType(row.entryType);
  const eligibilityExplanation = buildSettlementEligibilityExplanation(row);
  if (type === 'refund') {
    const snapshots = resolveRefundCommissionSnapshot(row);
    const refundOffset = calculateRefundOffsetAmounts({
      refundAmount: row.amount,
      ...snapshots,
    });
    return {
      financeLedgerEntryId: row.id,
      lineType: SettlementApprovalLineType.REFUND,
      amountMinor: refundOffset.refundMinor,
      commissionMinor: -refundOffset.commissionReversalMinor,
      commissionVatMinor: -refundOffset.commissionVatReversalMinor,
      payableImpactMinor: -refundOffset.vendorPayableReversalMinor,
      ...eligibilityExplanation,
      sourceSnapshotJson: {
        financeLedgerEntryId: row.id,
        entryType: row.entryType,
        amount: String(row.amount),
        settlementStatus: row.settlementStatus,
        resolvedSettlementStatus: resolveSettlementStatus(row),
        ...eligibilityExplanation,
        refundOffsetReason: getRefundOffsetEligibility(row).reason,
        refundOffsetAppliedBeforeSettlement: true,
        vendorAllocationId: row.vendorAllocation?.id ?? null,
        sourceShopifyOrderId: row.vendorAllocation?.sourceShopifyOrderId ?? null,
        sourceShopifyOrderNumber: row.vendorAllocation?.sourceShopifyOrderNumber ?? null,
        commissionPercentSnapshot:
          snapshots.commissionPercentSnapshot === null ? null : String(snapshots.commissionPercentSnapshot),
        commissionVatPercentSnapshot:
          snapshots.commissionVatPercentSnapshot === null ? null : String(snapshots.commissionVatPercentSnapshot),
        commissionReversalMinor: refundOffset.commissionReversalMinor,
        commissionVatReversalMinor: refundOffset.commissionVatReversalMinor,
        vendorPayableReversalMinor: refundOffset.vendorPayableReversalMinor,
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
      settlementDelayDaysSnapshot: row.settlementDelayDaysSnapshot,
    },
  };
}

function buildRefundAdjustmentLine(
  record: PendingRefundAdjustmentApplicationPreview['records'][number],
  applyAmountMinor: number,
): SettlementApprovalLineDraft {
  const remainingAfterApply = Math.max(record.remainingAmountMinor - applyAmountMinor, 0);
  return {
    financeLedgerEntryId: record.refundFinanceLedgerEntryId,
    lineType: SettlementApprovalLineType.REFUND_ADJUSTMENT,
    amountMinor: applyAmountMinor,
    commissionMinor: 0,
    commissionVatMinor: 0,
    payableImpactMinor: -applyAmountMinor,
    storedSettlementStatus: 'pending_adjustment',
    derivedSettlementStatus: 'refund_adjustment_applied',
    payoutStatus: null,
    eligibilityDecision: 'included',
    eligibilityReason: 'Pending refund adjustment applied to settlement draft.',
    refundDetected: true,
    refundCount: 1,
    fulfillmentEvidencePresent: false,
    shippingEvidencePresent: false,
    sourceSnapshotJson: {
      settlementRefundAdjustmentId: record.adjustmentId,
      financeLedgerEntryId: record.refundFinanceLedgerEntryId,
      refundRecordId: record.refundRecordId,
      originalOrderId: record.originalOrderId,
      originalSettlementApprovalId: record.originalSettlementApprovalId,
      originalSettlementCommissionInvoiceId: record.originalSettlementCommissionInvoiceId,
      entryType: 'refund_adjustment',
      amountMinor: record.amountMinor,
      originalAmountMinor: record.originalAmountMinor,
      appliedAmountMinorBefore: record.appliedAmountMinor,
      remainingAmountMinorBefore: record.remainingAmountMinor,
      appliedAmountMinor: applyAmountMinor,
      remainingAmountMinorAfter: remainingAfterApply,
      commissionMinor: 0,
      commissionVatMinor: 0,
      payableImpactMinor: -applyAmountMinor,
      adjustmentStatus: remainingAfterApply === 0 ? 'APPLIED' : 'PARTIALLY_APPLIED',
      settlementStatus: 'pending_adjustment',
      resolvedSettlementStatus: 'refund_adjustment_applied',
      eligibilityDecision: 'included',
      eligibilityReason: 'Pending refund adjustment applied to settlement draft.',
      reason: record.reason,
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

function buildRevalidationReason(
  line: SettlementApprovalLine,
  code: string,
  reason: string,
  details?: Record<string, unknown>,
): SettlementApprovalRevalidationReason {
  return {
    settlementApprovalLineId: line.id,
    financeLedgerEntryId: line.financeLedgerEntryId,
    code,
    reason,
    ...(details ? { details } : {}),
  };
}

function getConflictingSettlementApprovalLine(
  row: SettlementApprovalRevalidationLedgerRow,
  settlementApprovalId: string,
) {
  return row.settlementApprovalLines.find((line) => line.settlementApproval.id !== settlementApprovalId) ?? null;
}

function getSnapshotRefundCount(line: SettlementApprovalLine) {
  return readLineExplanation(line.sourceSnapshotJson).refundCount;
}

function lineAmountsChanged(line: SettlementApprovalLine, currentLine: SettlementApprovalLineDraft) {
  return (
    line.lineType !== currentLine.lineType ||
    line.amountMinor !== currentLine.amountMinor ||
    line.commissionMinor !== currentLine.commissionMinor ||
    line.commissionVatMinor !== currentLine.commissionVatMinor ||
    line.payableImpactMinor !== currentLine.payableImpactMinor
  );
}

async function validateRefundAdjustmentApprovalLine(
  tx: SettlementApprovalTransaction,
  approval: Pick<SettlementApproval, 'id' | 'vendorId'>,
  line: SettlementApprovalLine,
  row: SettlementApprovalRevalidationLedgerRow | null,
) {
  const reasons: SettlementApprovalRevalidationReason[] = [];
  if (!row) {
    return [
      buildRevalidationReason(line, 'ledger_missing', 'Ledger row no longer exists'),
    ];
  }

  if (row.vendorId !== approval.vendorId) {
    reasons.push(buildRevalidationReason(line, 'vendor_mismatch', 'Ledger row vendor changed since draft creation'));
  }

  if (normalizeType(row.entryType) !== 'refund') {
    reasons.push(buildRevalidationReason(line, 'entry_type_changed', 'Refund adjustment line is no longer linked to a refund ledger row'));
  }

  if (normalizeStatus(row.payoutStatus) === 'paid') {
    reasons.push(buildRevalidationReason(line, 'ledger_paid', 'Ledger row already paid'));
  }

  const applicationId = (line as SettlementApprovalLine & { settlementRefundAdjustmentApplicationId?: string | null })
    .settlementRefundAdjustmentApplicationId
    ?? readSnapshotString(readSnapshotRecord(line.sourceSnapshotJson).settlementRefundAdjustmentApplicationId);
  if (applicationId) {
    const application = await tx.settlementRefundAdjustmentApplication.findUnique({
      where: { id: applicationId },
      include: {
        settlementRefundAdjustment: true,
      },
    });
    if (!application || application.status !== SettlementRefundAdjustmentApplicationStatus.ACTIVE) {
      reasons.push(buildRevalidationReason(line, 'refund_adjustment_application_missing', 'Settlement refund adjustment application is not active'));
      return reasons;
    }
    if (application.settlementApprovalId !== approval.id || application.settlementApprovalLineId !== line.id) {
      reasons.push(buildRevalidationReason(line, 'refund_adjustment_application_mismatch', 'Settlement refund adjustment application is linked to a different approval line'));
    }
    if (application.settlementRefundAdjustment.vendorId !== approval.vendorId) {
      reasons.push(buildRevalidationReason(line, 'vendor_mismatch', 'Settlement refund adjustment vendor changed since draft creation'));
    }
    if (application.settlementRefundAdjustment.refundFinanceLedgerEntryId !== line.financeLedgerEntryId) {
      reasons.push(buildRevalidationReason(line, 'refund_adjustment_ledger_mismatch', 'Settlement refund adjustment is linked to a different refund ledger row'));
    }
    if (
      application.settlementRefundAdjustment.status !== SettlementRefundAdjustmentStatus.APPLIED &&
      application.settlementRefundAdjustment.status !== SettlementRefundAdjustmentStatus.PARTIALLY_APPLIED
    ) {
      reasons.push(buildRevalidationReason(line, 'refund_adjustment_not_applied', 'Settlement refund adjustment is not applied'));
    }
    if (
      line.lineType !== SettlementApprovalLineType.REFUND_ADJUSTMENT ||
      line.amountMinor !== application.amountMinor ||
      line.commissionMinor !== 0 ||
      line.commissionVatMinor !== 0 ||
      line.payableImpactMinor !== -application.amountMinor
    ) {
      reasons.push(buildRevalidationReason(line, 'settlement_amount_changed', 'Settlement refund adjustment amount changed since draft creation'));
    }

    return reasons;
  }

  const adjustmentId = line.settlementRefundAdjustmentId
    ?? readSnapshotString(readSnapshotRecord(line.sourceSnapshotJson).settlementRefundAdjustmentId);
  if (!adjustmentId) {
    reasons.push(buildRevalidationReason(line, 'refund_adjustment_missing', 'Settlement refund adjustment link is missing'));
    return reasons;
  }

  const adjustment = await tx.settlementRefundAdjustment.findUnique({
    where: {
      id: adjustmentId,
    },
    select: {
      id: true,
      vendorId: true,
      status: true,
      amountMinor: true,
      refundFinanceLedgerEntryId: true,
      appliedSettlementApprovalId: true,
      appliedSettlementApprovalLineId: true,
    },
  });
  if (!adjustment) {
    reasons.push(buildRevalidationReason(line, 'refund_adjustment_missing', 'Settlement refund adjustment no longer exists'));
    return reasons;
  }

  if (adjustment.vendorId !== approval.vendorId) {
    reasons.push(buildRevalidationReason(line, 'vendor_mismatch', 'Settlement refund adjustment vendor changed since draft creation'));
  }
  if (adjustment.status !== 'APPLIED') {
    reasons.push(buildRevalidationReason(line, 'refund_adjustment_not_applied', 'Settlement refund adjustment is not marked APPLIED'));
  }
  if (adjustment.refundFinanceLedgerEntryId !== line.financeLedgerEntryId) {
    reasons.push(buildRevalidationReason(line, 'refund_adjustment_ledger_mismatch', 'Settlement refund adjustment is linked to a different refund ledger row'));
  }
  if (
    adjustment.appliedSettlementApprovalId !== approval.id ||
    adjustment.appliedSettlementApprovalLineId !== line.id
  ) {
    reasons.push(buildRevalidationReason(line, 'refund_adjustment_application_mismatch', 'Settlement refund adjustment is applied to a different settlement approval line'));
  }
  if (
    line.lineType !== SettlementApprovalLineType.REFUND_ADJUSTMENT ||
    line.amountMinor !== adjustment.amountMinor ||
    line.commissionMinor !== 0 ||
    line.commissionVatMinor !== 0 ||
    line.payableImpactMinor !== -adjustment.amountMinor
  ) {
    reasons.push(buildRevalidationReason(line, 'settlement_amount_changed', 'Settlement refund adjustment amount changed since draft creation'));
  }

  return reasons;
}

function validateApprovalLineAgainstCurrentLedger(
  approval: Pick<SettlementApproval, 'id' | 'vendorId'>,
  line: SettlementApprovalLine,
  row: SettlementApprovalRevalidationLedgerRow | null,
) {
  const reasons: SettlementApprovalRevalidationReason[] = [];
  if (!row) {
    return [
      buildRevalidationReason(line, 'ledger_missing', 'Ledger row no longer exists'),
    ];
  }

  if (line.lineType === SettlementApprovalLineType.REFUND_ADJUSTMENT) {
    return reasons;
  }

  if (row.vendorId !== approval.vendorId) {
    reasons.push(buildRevalidationReason(line, 'vendor_mismatch', 'Ledger row vendor changed since draft creation'));
  }

  const currentType = normalizeType(row.entryType);
  const expectedType = line.lineType === SettlementApprovalLineType.REFUND ? 'refund' : 'sale';
  if (currentType !== expectedType) {
    reasons.push(buildRevalidationReason(line, 'entry_type_changed', 'Ledger row type changed since draft creation'));
  }

  const payoutStatus = normalizeStatus(row.payoutStatus);
  if (payoutStatus === 'paid') {
    reasons.push(buildRevalidationReason(line, 'ledger_paid', 'Ledger row already paid'));
  }

  if (row.payoutBatchLines.length > 0) {
    reasons.push(buildRevalidationReason(
      line,
      'active_payout_batch',
      'Ledger row is already included in an active payout batch',
      {
        payoutBatchIds: row.payoutBatchLines.map((batchLine) => batchLine.payoutBatch.id),
      },
    ));
  }

  const conflictingApprovalLine = getConflictingSettlementApprovalLine(row, approval.id);
  if (conflictingApprovalLine) {
    reasons.push(buildRevalidationReason(
      line,
      'active_settlement_approval_conflict',
      'Ledger row is locked by another active settlement approval',
      {
        settlementApprovalId: conflictingApprovalLine.settlementApproval.id,
        settlementApprovalStatus: conflictingApprovalLine.settlementApproval.status,
      },
    ));
  }

  if (expectedType === 'sale') {
    const currentRefundCount = row.vendorAllocation?.refundRecords.length ?? 0;
    const snapshotRefundCount = getSnapshotRefundCount(line);
    if (currentRefundCount > snapshotRefundCount) {
      reasons.push(buildRevalidationReason(
        line,
        'refund_arrived_after_draft',
        'Refund arrived after draft creation',
        {
          snapshotRefundCount,
          currentRefundCount,
        },
      ));
    }

    if (hasApprovedOpenReturnHold(row)) {
      reasons.push(buildRevalidationReason(line, 'approved_return_hold_active', 'Approved return hold is now active'));
    }
  }

  const settlementDelay = evaluateSaleSettlementDelay(row);
  if (settlementDelay.applies && !settlementDelay.eligible) {
    reasons.push(buildRevalidationReason(
      line,
      'settlement_delay_not_satisfied',
      'Settlement delay is no longer satisfied',
      {
        blockerReason: settlementDelay.blockerReason,
        eligibleAt: toIso(settlementDelay.eligibleAt),
      },
    ));
  }

  if (!rowIsEligible(row, approval.id)) {
    const explanation = buildSettlementEligibilityExplanation(row);
    const alreadyExplained = reasons.some((reason) =>
      [
        'ledger_paid',
        'approved_return_hold_active',
        'settlement_delay_not_satisfied',
      ].includes(reason.code),
    );
    if (!alreadyExplained) {
      reasons.push(buildRevalidationReason(
        line,
        'settlement_row_not_eligible',
        explanation.eligibilityReason,
        {
          derivedSettlementStatus: explanation.derivedSettlementStatus,
          payoutStatus: explanation.payoutStatus,
        },
      ));
    }
  }

  if (reasons.length === 0) {
    const currentLine = buildLine(row);
    if (lineAmountsChanged(line, currentLine)) {
      reasons.push(buildRevalidationReason(
        line,
        'settlement_amount_changed',
        'Settlement amount changed since draft creation',
        {
          frozen: {
            lineType: line.lineType,
            amountMinor: line.amountMinor,
            commissionMinor: line.commissionMinor,
            commissionVatMinor: line.commissionVatMinor,
            payableImpactMinor: line.payableImpactMinor,
          },
          current: {
            lineType: currentLine.lineType,
            amountMinor: currentLine.amountMinor,
            commissionMinor: currentLine.commissionMinor,
            commissionVatMinor: currentLine.commissionVatMinor,
            payableImpactMinor: currentLine.payableImpactMinor,
          },
        },
      ));
    }
  }

  return reasons;
}

async function loadCurrentLedgerRowForApprovalLine(
  tx: SettlementApprovalTransaction,
  line: SettlementApprovalLine,
): Promise<SettlementApprovalRevalidationLedgerRow | null> {
  const row = await tx.financeLedgerEntry.findUnique({
    where: {
      id: line.financeLedgerEntryId,
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
      settlementDelayDaysSnapshot: true,
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
              shipmentUpdatedAt: true,
            },
          },
          refundRecords: {
            select: {
              id: true,
              sourceShopifyRefundId: true,
              amount: true,
            },
          },
          returnRecords: {
            select: {
              id: true,
              status: true,
              returnLifecycleStatus: true,
              sourceShopifyRefundId: true,
            },
          },
          financeEntries: {
            where: {
              entryType: 'sale',
            },
            select: {
              id: true,
              entryType: true,
              payoutStatus: true,
              settlementStatus: true,
              commissionPercentSnapshot: true,
              commissionVatPercentSnapshot: true,
              payoutBatchLines: {
                where: {
                  payoutBatch: {
                    status: {
                      in: [...ACTIVE_PAYOUT_BATCH_STATUSES],
                    },
                  },
                },
                select: {
                  payoutBatch: {
                    select: {
                      status: true,
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
                  settlementApproval: {
                    select: {
                      id: true,
                      status: true,
                    },
                  },
                },
              },
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
      payoutBatchLines: {
        where: {
          payoutBatch: {
            status: {
              in: [...ACTIVE_PAYOUT_BATCH_STATUSES],
            },
          },
        },
        select: {
          id: true,
          payoutBatch: {
            select: {
              id: true,
              status: true,
            },
          },
        },
      },
    },
  });

  return row as SettlementApprovalRevalidationLedgerRow | null;
}

export async function validateSettlementApprovalBeforeApprove(
  tx: SettlementApprovalTransaction,
  approval: SettlementApproval & { lines: SettlementApprovalLine[] },
) {
  const reasons: SettlementApprovalRevalidationReason[] = [];
  for (const line of approval.lines) {
    const row = await loadCurrentLedgerRowForApprovalLine(tx, line);
    if (line.lineType === SettlementApprovalLineType.REFUND_ADJUSTMENT) {
      reasons.push(...await validateRefundAdjustmentApprovalLine(tx, approval, line, row));
    } else {
      reasons.push(...validateApprovalLineAgainstCurrentLedger(approval, line, row));
    }
  }

  return {
    ok: reasons.length === 0,
    reasons,
  };
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

  if (determineCandidateScope(input) === 'vendor_wide') {
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

function normalizeSelectionValues(values: string[] | null | undefined) {
  return Array.from(new Set((values ?? []).map((value) => value.trim()).filter(Boolean)));
}

function normalizeOrderNumber(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return trimmed;
  }
  return trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
}

function normalizeOrderNumberLoose(value: string | null | undefined) {
  return value?.trim().replace(/^#/, '') ?? '';
}

function orderMatchesIdentifier(row: SettlementApprovalLedgerRow, identifier: string) {
  const orderId = row.vendorAllocation?.sourceShopifyOrderId ?? '';
  const orderNumber = row.vendorAllocation?.sourceShopifyOrderNumber ?? '';
  return orderId === identifier || orderNumber === identifier || orderNumber === normalizeOrderNumber(identifier);
}

function orderNumberFormatMismatchesIdentifier(row: SettlementApprovalLedgerRow, identifier: string) {
  const orderNumber = row.vendorAllocation?.sourceShopifyOrderNumber ?? '';
  const normalizedStoredNumber = normalizeOrderNumberLoose(orderNumber);
  const normalizedIdentifier = normalizeOrderNumberLoose(identifier);
  return Boolean(
    normalizedStoredNumber &&
      normalizedIdentifier &&
      normalizedStoredNumber === normalizedIdentifier &&
      !orderMatchesIdentifier(row, identifier),
  );
}

function getActiveApprovalLine(row: SettlementApprovalLedgerRow) {
  return row.settlementApprovalLines.find(
    (line) => line.settlementApproval.status !== SettlementApprovalStatus.CANCELLED,
  ) ?? null;
}

function buildMatchedOrderDiagnostic(
  requestedIdentifier: string,
  row: SettlementApprovalLedgerRow,
): SelectedOrderDiagnosticDto {
  const explanation = buildSettlementEligibilityExplanation(row);
  const activeApprovalLine = getActiveApprovalLine(row);
  const candidateIncluded = rowIsEligible(row) && !activeApprovalLine;

  return {
    requestedIdentifier,
    matched: true,
    matchedOrderNumber: row.vendorAllocation?.sourceShopifyOrderNumber ?? null,
    matchedShopifyOrderId: row.vendorAllocation?.sourceShopifyOrderId ?? null,
    financeLedgerEntryId: row.id,
    candidateIncluded,
    excludedReason: candidateIncluded ? null : explanation.eligibilityReason,
    lockedApprovalId: activeApprovalLine?.settlementApproval.id ?? null,
    lockedApprovalStatus: activeApprovalLine?.settlementApproval.status ?? null,
    currentSettlementStatus: row.settlementStatus,
    derivedSettlementStatus: explanation.derivedSettlementStatus,
  };
}

function buildUnmatchedOrderDiagnostic(
  requestedIdentifier: string,
  rows: SettlementApprovalLedgerRow[],
  crossVendorRows: SettlementApprovalLedgerRow[],
): SelectedOrderDiagnosticDto {
  const formatMismatchRow = rows.find((row) => orderNumberFormatMismatchesIdentifier(row, requestedIdentifier));
  if (formatMismatchRow) {
    const explanation = buildSettlementEligibilityExplanation(formatMismatchRow);
    return {
      requestedIdentifier,
      matched: false,
      matchedOrderNumber: formatMismatchRow.vendorAllocation?.sourceShopifyOrderNumber ?? null,
      matchedShopifyOrderId: formatMismatchRow.vendorAllocation?.sourceShopifyOrderId ?? null,
      financeLedgerEntryId: null,
      candidateIncluded: false,
      excludedReason:
        'A finance ledger row matched this order after order-number normalization, but the stored order number format did not match the selected identifier.',
      lockedApprovalId: null,
      lockedApprovalStatus: null,
      currentSettlementStatus: formatMismatchRow.settlementStatus,
      derivedSettlementStatus: explanation.derivedSettlementStatus,
    };
  }

  const crossVendorRow = crossVendorRows.find((row) => orderMatchesIdentifier(row, requestedIdentifier));
  if (crossVendorRow) {
    const explanation = buildSettlementEligibilityExplanation(crossVendorRow);
    return {
      requestedIdentifier,
      matched: false,
      matchedOrderNumber: crossVendorRow.vendorAllocation?.sourceShopifyOrderNumber ?? null,
      matchedShopifyOrderId: crossVendorRow.vendorAllocation?.sourceShopifyOrderId ?? null,
      financeLedgerEntryId: null,
      candidateIncluded: false,
      excludedReason: 'A finance ledger row matched this selected order, but not for the selected vendor.',
      lockedApprovalId: null,
      lockedApprovalStatus: null,
      currentSettlementStatus: crossVendorRow.settlementStatus,
      derivedSettlementStatus: explanation.derivedSettlementStatus,
    };
  }

  return {
    requestedIdentifier,
    matched: false,
    matchedOrderNumber: null,
    matchedShopifyOrderId: null,
    financeLedgerEntryId: null,
    candidateIncluded: false,
    excludedReason: 'No finance ledger row matched this selected order.',
    lockedApprovalId: null,
    lockedApprovalStatus: null,
    currentSettlementStatus: null,
    derivedSettlementStatus: null,
  };
}

function buildSelectedOrderDiagnostics(
  rows: SettlementApprovalLedgerRow[],
  input: SettlementApprovalInput,
  crossVendorRows: SettlementApprovalLedgerRow[] = [],
): SelectedOrderDiagnosticDto[] {
  const requestedOrders = normalizeSelectionValues([
    ...(input.selectedOrderIds ?? []),
    ...(input.selectedShopifyOrderIds ?? []),
  ]);
  if (determineCandidateScope(input) !== 'selected_orders' || requestedOrders.length === 0) {
    return [];
  }

  return requestedOrders.map((requestedIdentifier) => {
    const matchedRows = rows.filter((row) => orderMatchesIdentifier(row, requestedIdentifier));
    const includedRow = matchedRows.find((row) => rowIsEligible(row) && !rowHasActiveApproval(row));
    const eligibleLockedRow = matchedRows.find((row) => rowIsEligible(row) && rowHasActiveApproval(row));
    const firstMatchedRow = includedRow ?? eligibleLockedRow ?? matchedRows[0];

    if (firstMatchedRow) {
      return buildMatchedOrderDiagnostic(requestedIdentifier, firstMatchedRow);
    }

    return buildUnmatchedOrderDiagnostic(requestedIdentifier, rows, crossVendorRows);
  });
}

function determineCandidateScope(input: SettlementApprovalInput): CandidateScope {
  const selectedOrders = normalizeSelectionValues([
    ...(input.selectedOrderIds ?? []),
    ...(input.selectedShopifyOrderIds ?? []),
  ]);
  const selectedAllocations = normalizeSelectionValues(input.selectedAllocationIds);
  const requestedScope = input.candidateScope ?? null;

  if (selectedOrders.length && selectedAllocations.length) {
    throw new Error('Use selected orders or selected allocations, not both.');
  }
  if (requestedScope === 'selected_orders') {
    return 'selected_orders';
  }
  if (requestedScope === 'selected_allocations') {
    return 'selected_allocations';
  }
  if (requestedScope === 'date_range') {
    if (!input.periodStart && !input.periodEnd) {
      throw new Error('At least one period date is required for date range settlement candidate mode.');
    }
    return 'date_range';
  }
  if (selectedOrders.length) {
    return 'selected_orders';
  }
  if (selectedAllocations.length) {
    return 'selected_allocations';
  }
  if (input.periodStart || input.periodEnd) {
    return 'date_range';
  }
  return 'vendor_wide';
}

function filterRowsByCandidateSelection(rows: SettlementApprovalLedgerRow[], input: SettlementApprovalInput) {
  const requestedOrderIds = normalizeSelectionValues(input.selectedOrderIds);
  const requestedShopifyOrderIds = normalizeSelectionValues(input.selectedShopifyOrderIds);
  const requestedOrders = normalizeSelectionValues([...requestedOrderIds, ...requestedShopifyOrderIds]);
  const requestedAllocations = normalizeSelectionValues(input.selectedAllocationIds);
  const candidateScope = determineCandidateScope(input);

  let selectedRows = rows;
  if (candidateScope === 'selected_orders') {
    selectedRows = rows.filter((row) => requestedOrders.some((identifier) => orderMatchesIdentifier(row, identifier)));
  }
  if (candidateScope === 'selected_allocations') {
    selectedRows = rows.filter((row) => requestedAllocations.includes(row.vendorAllocation?.id ?? ''));
  }

  const matchedOrders = requestedOrders.filter((identifier) =>
    selectedRows.some((row) => orderMatchesIdentifier(row, identifier)),
  );
  const matchedAllocations = requestedAllocations.filter((identifier) =>
    selectedRows.some((row) => row.vendorAllocation?.id === identifier),
  );

  return {
    rows: selectedRows,
    candidateScope,
    candidateSelectionSummary: {
      requestedOrders,
      matchedOrders,
      unmatchedOrders: requestedOrders.filter((identifier) => !matchedOrders.includes(identifier)),
      requestedAllocations,
      matchedAllocations,
      unmatchedAllocations: requestedAllocations.filter((identifier) => !matchedAllocations.includes(identifier)),
      candidateRowCount: selectedRows.length,
    },
  };
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
      settlementDelayDaysSnapshot: true,
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
              shipmentUpdatedAt: true,
            },
          },
          refundRecords: {
            select: {
              id: true,
              sourceShopifyRefundId: true,
              amount: true,
            },
          },
          returnRecords: {
            select: {
              id: true,
              status: true,
              returnLifecycleStatus: true,
              sourceShopifyRefundId: true,
            },
          },
          financeEntries: {
            where: {
              entryType: 'sale',
            },
            select: {
              id: true,
              entryType: true,
              payoutStatus: true,
              settlementStatus: true,
              commissionPercentSnapshot: true,
              commissionVatPercentSnapshot: true,
              payoutBatchLines: {
                where: {
                  payoutBatch: {
                    status: {
                      in: [...ACTIVE_PAYOUT_BATCH_STATUSES],
                    },
                  },
                },
                select: {
                  payoutBatch: {
                    select: {
                      status: true,
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
                  settlementApproval: {
                    select: {
                      id: true,
                      status: true,
                    },
                  },
                },
              },
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
  const requestedOrders = normalizeSelectionValues([
    ...(input.selectedOrderIds ?? []),
    ...(input.selectedShopifyOrderIds ?? []),
  ]);
  const selectedOrderNumbers = Array.from(new Set([
    ...requestedOrders,
    ...requestedOrders.map(normalizeOrderNumber),
  ]));
  const crossVendorRows = determineCandidateScope(input) === 'selected_orders' && requestedOrders.length
    ? await tx.financeLedgerEntry.findMany({
      where: {
        vendorId: {
          not: input.vendorId,
        },
        entryType: {
          in: ['sale', 'refund'],
        },
        vendorAllocation: {
          OR: [
            {
              sourceShopifyOrderId: {
                in: requestedOrders,
              },
            },
            {
              sourceShopifyOrderNumber: {
                in: selectedOrderNumbers,
              },
            },
          ],
        },
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
        settlementDelayDaysSnapshot: true,
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
                shipmentUpdatedAt: true,
              },
            },
            refundRecords: {
              select: {
                id: true,
                sourceShopifyRefundId: true,
                amount: true,
              },
            },
            returnRecords: {
              select: {
                id: true,
                status: true,
                returnLifecycleStatus: true,
                sourceShopifyRefundId: true,
              },
            },
            financeEntries: {
              where: {
                entryType: 'sale',
              },
              select: {
                id: true,
                entryType: true,
                payoutStatus: true,
                settlementStatus: true,
                commissionPercentSnapshot: true,
                commissionVatPercentSnapshot: true,
                payoutBatchLines: {
                  where: {
                    payoutBatch: {
                      status: {
                        in: [...ACTIVE_PAYOUT_BATCH_STATUSES],
                      },
                    },
                  },
                  select: {
                    payoutBatch: {
                      select: {
                        status: true,
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
                    settlementApproval: {
                      select: {
                        id: true,
                        status: true,
                      },
                    },
                  },
                },
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
    })
    : [];

  const candidateSelection = filterRowsByCandidateSelection(rows as SettlementApprovalLedgerRow[], input);
  const eligibleRows = candidateSelection.rows.filter((row) => rowIsEligible(row));
  const unapprovedRows = eligibleRows.filter((row) => !rowHasActiveApproval(row));
  const lines = unapprovedRows.map(buildLine);
  const totals = summarizeLines(lines);
  const candidateQualitySummary = buildCandidateQualitySummary(unapprovedRows, input);
  const vendorBalance = await getVendorBalanceSummary(tx, input.vendorId, totals.currency);
  const debtPreview = calculateVendorDebtOffset({
    grossPayableMinor: Math.max(totals.netPayableMinor, 0),
    outstandingDebtMinor: vendorBalance.outstandingDebtMinor,
  });
  const pendingRefundAdjustments = await previewPendingRefundAdjustmentApplication({
    vendorId: input.vendorId,
    currencyCode: totals.currency,
    currentCandidateNetPayableMinor: totals.netPayableMinor,
    db: tx,
  });

  return {
    ok: true,
    writesPerformed: false,
    vendorId: input.vendorId,
    periodStart: toIso(input.periodStart),
    periodEnd: toIso(input.periodEnd),
    candidateScope: candidateSelection.candidateScope,
    candidateSelectionSummary: candidateSelection.candidateSelectionSummary,
    selectedOrderDiagnostics: buildSelectedOrderDiagnostics(
      rows as SettlementApprovalLedgerRow[],
      input,
      crossVendorRows as SettlementApprovalLedgerRow[],
    ),
    summary: {
      ...totals,
      eligibleRowCount: lines.length,
      excludedActiveApprovalRowCount: eligibleRows.length - unapprovedRows.length,
      ...candidateQualitySummary,
      outstandingVendorDebtMinor: vendorBalance.outstandingDebtMinor,
      debtOffsetPreviewMinor: debtPreview.debtOffsetMinor,
      netPayableAfterDebtOffsetMinor:
        totals.netPayableMinor > 0 ? debtPreview.netPayableMinor : totals.netPayableMinor,
      remainingVendorDebtMinor: debtPreview.remainingDebtMinor,
      pendingRefundAdjustmentCount: pendingRefundAdjustments.pendingAdjustmentCount,
      pendingRefundAdjustmentTotalMinor: pendingRefundAdjustments.pendingAdjustmentTotalMinor,
      netAfterPendingRefundAdjustmentsMinor:
        pendingRefundAdjustments.netAfterPendingRefundAdjustmentsMinor ?? totals.netPayableMinor,
    },
    pendingRefundAdjustments,
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
      settlementRefundAdjustmentId: line.settlementRefundAdjustmentId,
      settlementRefundAdjustmentApplicationId:
        (line as SettlementApprovalLine & { settlementRefundAdjustmentApplicationId?: string | null })
          .settlementRefundAdjustmentApplicationId ?? null,
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
  selection?: Pick<SettlementApprovalInput, 'candidateScope' | 'selectedOrderIds' | 'selectedShopifyOrderIds' | 'selectedAllocationIds'>,
): Promise<SettlementApprovalPreviewDto> {
  return buildApprovalPreview({ vendorId, periodStart, periodEnd, ...selection });
}

export async function createDraftApproval(
  input: SettlementApprovalInput,
): Promise<SettlementApprovalDto> {
  return prisma.$transaction(
    async (tx) => {
      const preview = await buildApprovalPreview(input, tx);
      if (preview.lines.length === 0) {
        if (preview.pendingRefundAdjustments.pendingAdjustmentCount > 0) {
          throw new Error('Adjustment-only settlement drafts are not supported yet.');
        }
        throw new Error('No eligible settlement rows are available for approval.');
      }
      let availablePayableMinor = Math.max(preview.summary.netPayableMinor, 0);
      const appliedAdjustmentPlans: Array<{
        record: PendingRefundAdjustmentApplicationPreview['records'][number];
        applyAmountMinor: number;
      }> = [];
      for (const record of preview.pendingRefundAdjustments.records) {
        if (availablePayableMinor <= 0) {
          break;
        }
        const applyAmountMinor = Math.min(record.remainingAmountMinor, availablePayableMinor);
        if (applyAmountMinor <= 0) {
          continue;
        }
        appliedAdjustmentPlans.push({ record, applyAmountMinor });
        availablePayableMinor -= applyAmountMinor;
      }
      const adjustmentLines = appliedAdjustmentPlans.map((plan) =>
        buildRefundAdjustmentLine(plan.record, plan.applyAmountMinor),
      );
      const settlementLines = [...preview.lines, ...adjustmentLines];
      const settlementTotals = summarizeLines(settlementLines);

      const activeLineCount = await tx.settlementApprovalLine.count({
        where: {
          OR: [
            {
              financeLedgerEntryId: {
                in: preview.lines.map((line) => line.financeLedgerEntryId),
              },
            },
          ],
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

      const billingProfile = await tx.vendorBillingProfile.findUnique({
        where: {
          vendorId: input.vendorId,
        },
      });
      const generatedAt = new Date();
      const settlementBillingSnapshot = buildSettlementBillingSnapshot(billingProfile, generatedAt);

      const approval = await tx.settlementApproval.create({
        data: {
          vendorId: input.vendorId,
          periodStart: input.periodStart ?? null,
          periodEnd: input.periodEnd ?? null,
          status: SettlementApprovalStatus.DRAFT,
          currency: 'TRY',
          grossSalesMinor: settlementTotals.grossSalesMinor,
          refundTotalMinor: settlementTotals.refundTotalMinor,
          commissionMinor: settlementTotals.commissionMinor,
          commissionVatMinor: settlementTotals.commissionVatMinor,
          netPayableMinor: settlementTotals.netPayableMinor,
          notes: input.notes ?? null,
          sourceSnapshotJson: {
            vendorId: input.vendorId,
            periodStart: toIso(input.periodStart),
            periodEnd: toIso(input.periodEnd),
            candidateScope: preview.candidateScope,
            candidateSelectionSummary: preview.candidateSelectionSummary,
            generatedAt: generatedAt.toISOString(),
            settlementBillingSnapshot,
            eligibleRowCount: preview.summary.eligibleRowCount,
            excludedActiveApprovalRowCount: preview.summary.excludedActiveApprovalRowCount,
            outstandingVendorDebtMinor: preview.summary.outstandingVendorDebtMinor,
            debtOffsetPreviewMinor: preview.summary.debtOffsetPreviewMinor,
            netPayableAfterDebtOffsetMinor: preview.summary.netPayableAfterDebtOffsetMinor,
            remainingVendorDebtMinor: preview.summary.remainingVendorDebtMinor,
            pendingRefundAdjustmentCount: preview.summary.pendingRefundAdjustmentCount,
            pendingRefundAdjustmentTotalMinor: preview.summary.pendingRefundAdjustmentTotalMinor,
            netAfterPendingRefundAdjustmentsMinor: preview.summary.netAfterPendingRefundAdjustmentsMinor,
            appliedRefundAdjustments: appliedAdjustmentPlans.map((plan) => ({
              ...plan.record,
              appliedAmountMinor: plan.applyAmountMinor,
              remainingAmountMinorAfter: plan.record.remainingAmountMinor - plan.applyAmountMinor,
            })),
            writesPerformed: false,
          },
          lines: {
            create: settlementLines.map((line) => ({
              financeLedgerEntryId: line.financeLedgerEntryId,
              settlementRefundAdjustmentId: line.settlementRefundAdjustmentId ?? null,
              settlementRefundAdjustmentApplicationId: line.settlementRefundAdjustmentApplicationId ?? null,
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

      for (const plan of appliedAdjustmentPlans) {
        const line = approval.lines.find((candidate) => {
          if (candidate.lineType !== SettlementApprovalLineType.REFUND_ADJUSTMENT) {
            return false;
          }
          const snapshot = readSnapshotRecord(candidate.sourceSnapshotJson);
          return readSnapshotString(snapshot.settlementRefundAdjustmentId) === plan.record.adjustmentId;
        });
        if (!line) {
          throw new Error('Pending refund adjustment line could not be linked safely.');
        }
        const application = await tx.settlementRefundAdjustmentApplication.create({
          data: {
            settlementRefundAdjustmentId: plan.record.adjustmentId,
            settlementApprovalId: approval.id,
            settlementApprovalLineId: line.id,
            amountMinor: plan.applyAmountMinor,
            currencyCode: plan.record.currencyCode,
            status: SettlementRefundAdjustmentApplicationStatus.ACTIVE,
          },
        });
        await tx.settlementApprovalLine.update({
          where: { id: line.id },
          data: {
            settlementRefundAdjustmentApplicationId: application.id,
          },
        });
        const remainingAfterApply = plan.record.remainingAmountMinor - plan.applyAmountMinor;
        const result = await tx.settlementRefundAdjustment.updateMany({
          where: {
            id: plan.record.adjustmentId,
            vendorId: input.vendorId,
            status: {
              in: [
                SettlementRefundAdjustmentStatus.PENDING,
                SettlementRefundAdjustmentStatus.PARTIALLY_APPLIED,
              ],
            },
            remainingAmountMinor: {
              gte: plan.applyAmountMinor,
            },
          },
          data: {
            status: remainingAfterApply === 0
              ? SettlementRefundAdjustmentStatus.APPLIED
              : SettlementRefundAdjustmentStatus.PARTIALLY_APPLIED,
            appliedAmountMinor: {
              increment: plan.applyAmountMinor,
            },
            remainingAmountMinor: {
              decrement: plan.applyAmountMinor,
            },
            appliedSettlementApprovalId: remainingAfterApply === 0 ? approval.id : null,
            appliedSettlementApprovalLineId: remainingAfterApply === 0 ? line.id : null,
          },
        });
        if (result.count !== 1) {
          throw new Error('Pending refund adjustment could not be applied safely.');
        }
      }

      const refreshedApproval = await tx.settlementApproval.findUnique({
        where: { id: approval.id },
        include: { lines: true },
      });

      return mapApproval(refreshedApproval ?? approval, true);
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
  return prisma.$transaction(
    async (tx) => {
      const existing = await tx.settlementApproval.findUnique({
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

      const revalidation = await validateSettlementApprovalBeforeApprove(tx, existing);
      if (!revalidation.ok) {
        throw new SettlementApprovalRevalidationError(revalidation.reasons);
      }

      const approved = await tx.settlementApproval.update({
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
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    },
  );
}

export async function cancelSettlementApproval(
  id: string,
  cancelledBy: string | null,
): Promise<SettlementApprovalDto> {
  return prisma.$transaction(
    async (tx) => {
      const existing = await tx.settlementApproval.findUnique({
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

      const cancelled = await tx.settlementApproval.update({
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

      const activeApplications = await tx.settlementRefundAdjustmentApplication.findMany({
        where: {
          settlementApprovalId: id,
          status: SettlementRefundAdjustmentApplicationStatus.ACTIVE,
        },
        include: {
          settlementRefundAdjustment: true,
        },
      });

      for (const application of activeApplications) {
        await tx.settlementRefundAdjustmentApplication.update({
          where: { id: application.id },
          data: {
            status: SettlementRefundAdjustmentApplicationStatus.CANCELLED,
          },
        });
        const appliedAfterCancel = Math.max(
          application.settlementRefundAdjustment.appliedAmountMinor - application.amountMinor,
          0,
        );
        const remainingAfterCancel = application.settlementRefundAdjustment.remainingAmountMinor + application.amountMinor;
        await tx.settlementRefundAdjustment.update({
          where: { id: application.settlementRefundAdjustmentId },
          data: {
            appliedAmountMinor: {
              decrement: application.amountMinor,
            },
            remainingAmountMinor: {
              increment: application.amountMinor,
            },
            status: appliedAfterCancel === 0
              ? SettlementRefundAdjustmentStatus.PENDING
              : (remainingAfterCancel > 0
                  ? SettlementRefundAdjustmentStatus.PARTIALLY_APPLIED
                  : SettlementRefundAdjustmentStatus.APPLIED),
            appliedSettlementApprovalId:
              application.settlementRefundAdjustment.appliedSettlementApprovalId === id ? null : undefined,
            appliedSettlementApprovalLineId:
              application.settlementRefundAdjustment.appliedSettlementApprovalId === id ? null : undefined,
          },
        });
      }

      const legacyAppliedAdjustments = await tx.settlementRefundAdjustment.findMany({
        where: {
          appliedSettlementApprovalId: id,
          status: SettlementRefundAdjustmentStatus.APPLIED,
        },
        select: {
          id: true,
          originalAmountMinor: true,
          amountMinor: true,
        },
      });
      for (const adjustment of legacyAppliedAdjustments) {
        const originalAmountMinor = adjustment.originalAmountMinor || adjustment.amountMinor;
        await tx.settlementRefundAdjustment.update({
          where: { id: adjustment.id },
          data: {
            status: SettlementRefundAdjustmentStatus.PENDING,
            appliedAmountMinor: 0,
            remainingAmountMinor: originalAmountMinor,
            appliedSettlementApprovalId: null,
            appliedSettlementApprovalLineId: null,
          },
        });
      }

      return mapApproval(cancelled, true);
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    },
  );
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
