import type { FinanceDashboard, FinanceTransaction } from './api/contracts';

export const VENDOR_BLOCKED_FINANCE_HOLD_REASON = 'Vendor allocation is blocked and awaiting admin resolution.';

export type FinanceAudience = 'admin' | 'vendor';

export type FinanceOperationalProjection = {
  legacyStatusLabel: string;
  tone: 'neutral' | 'info' | 'success' | 'warning' | 'attention' | 'danger';
  settlementState: string;
  payoutState: string;
  blockerState: string;
  blockerDetail: string;
  payoutReadiness: string;
  payoutReadinessDetail: string;
  shippingImpact: {
    state: 'required' | 'completed' | 'not_applicable' | 'unknown';
    label: string;
    detail: string;
  };
};

export type FinanceNeedsReviewBreakdown = {
  needsReviewTotal: number;
  settlementReview: number;
  refundReview: number;
  blockedRows: number;
  shippingReconciliation: number;
  debtReview: number;
  unknownCategoriesLabel: string;
};

export function normalizeFinanceStatus(status: string | null | undefined) {
  const value = status?.trim();
  if (!value) {
    return 'Unknown';
  }

  const normalized = value.toLowerCase();
  if (normalized === 'hold' || normalized === 'recorded' || normalized === 'synced' || normalized === 'posted') {
    return 'Recorded';
  }
  if (normalized === 'failed' || normalized === 'error') {
    return 'Failed';
  }
  if (normalized === 'reconciled') {
    return 'Reconciled';
  }
  if (normalized === 'completed' || normalized === 'processed') {
    return 'Completed';
  }
  if (normalized === 'pending') {
    return 'Pending';
  }
  return value;
}

function isRefundRecord(record: FinanceTransaction) {
  return record.category === 'Refund';
}

function isVendorBlockedFinanceHold(record: FinanceTransaction) {
  return record.settlement?.holdReason === VENDOR_BLOCKED_FINANCE_HOLD_REASON;
}

function isRefundedSplitChildSaleBasis(record: FinanceTransaction) {
  return (
    record.category === 'Invoice' &&
    record.splitFinanceSummary?.lineageRole === 'child' &&
    record.splitFinanceSummary.refundedChildSaleBasis === true
  );
}

function isSettlementReviewPendingRecord(record: FinanceTransaction) {
  return Boolean(record.settlement?.payoutReady || record.settlement?.status === 'partially_refunded');
}

function isRefundDeductionSettlementReviewPending(record: FinanceTransaction) {
  return isRefundRecord(record) && isSettlementReviewPendingRecord(record);
}

export function getPayoutBatchStatusLabel(status?: string, audience: FinanceAudience = 'admin') {
  if (!status) {
    return 'Not batched';
  }

  if (status === 'draft') {
    return 'Estimated';
  }
  if (status === 'review') {
    return 'Pending review';
  }
  if (status === 'approved') {
    return 'Approved';
  }
  if (status === 'execution_pending') {
    return 'Scheduled';
  }
  if (status === 'paid_placeholder') {
    return audience === 'vendor' ? 'Pending review' : 'Payment evidence pending';
  }
  if (status === 'cancelled') {
    return 'Blocked';
  }
  return 'Unknown';
}

function getSettlementReviewLabel(record: FinanceTransaction) {
  const review = record.settlement?.review;
  if (!review) {
    return null;
  }
  if (review.commissionInvoiceStatus === 'created') {
    return 'Commission invoiced';
  }
  if (review.approvalStatus === 'approved') {
    return 'Settlement approved';
  }
  return 'Settlement draft locked';
}

function getLegacyStatusLabel(record: FinanceTransaction, audience: FinanceAudience) {
  const status = normalizeFinanceStatus(record.status);
  if (isRefundedSplitChildSaleBasis(record) && record.splitFinanceSummary?.refundOffsetStatus === 'settlement_review_pending') {
    return 'Settlement review pending';
  }
  if (isRefundDeductionSettlementReviewPending(record)) {
    return 'Settlement review pending';
  }
  if (isVendorBlockedFinanceHold(record)) {
    return 'On hold';
  }
  if (status === 'Failed' || record.settlement?.status === 'held' || record.settlement?.status === 'disputed') {
    return 'Blocked';
  }
  if (isRefundRecord(record) && ['Recorded', 'Completed', 'Reconciled'].includes(status)) {
    return 'Refund impact';
  }
  if (record.payoutBatch) {
    return getPayoutBatchStatusLabel(record.payoutBatch.status, audience);
  }
  const reviewLabel = getSettlementReviewLabel(record);
  if (reviewLabel) {
    return reviewLabel;
  }
  if (record.settlement?.payoutReady || record.settlement?.status === 'payable' || record.settlement?.status === 'partially_refunded') {
    return 'Pending review';
  }
  if (status === 'Pending' || status === 'Recorded' || status === 'Completed' || status === 'Reconciled') {
    return 'Estimated';
  }
  return status;
}

function getTone(label: string): FinanceOperationalProjection['tone'] {
  if (label === 'On hold') {
    return 'warning';
  }
  if (label === 'Blocked') {
    return 'danger';
  }
  if (label === 'Approved' || label === 'Scheduled' || label === 'Paid' || label === 'Settlement approved' || label === 'Commission invoiced') {
    return 'success';
  }
  if (label === 'Estimated') {
    return 'info';
  }
  return 'attention';
}

function resolveSettlementState(record: FinanceTransaction) {
  if (isRefundedSplitChildSaleBasis(record) && record.splitFinanceSummary?.refundOffsetStatus === 'settlement_review_pending') {
    return 'Offset review pending';
  }
  if (isRefundDeductionSettlementReviewPending(record)) {
    return 'Offset review pending';
  }
  const reviewLabel = getSettlementReviewLabel(record);
  if (reviewLabel) {
    return reviewLabel;
  }
  if (record.settlement?.status === 'held') {
    return 'Held';
  }
  if (record.settlement?.status === 'disputed') {
    return 'Disputed';
  }
  if (record.settlement?.payoutReady || record.settlement?.status === 'payable' || record.settlement?.status === 'partially_refunded') {
    return 'Review pending';
  }
  if (record.settlement?.status === 'settled') {
    return 'Settled';
  }
  return 'Estimated';
}

function resolvePayoutState(record: FinanceTransaction, audience: FinanceAudience) {
  if (record.payoutBatch) {
    return getPayoutBatchStatusLabel(record.payoutBatch.status, audience);
  }
  if (isVendorBlockedFinanceHold(record) || record.settlement?.status === 'held' || record.settlement?.status === 'disputed') {
    return 'Not eligible';
  }
  if (record.settlement?.review) {
    return 'Locked in review';
  }
  if (record.settlement?.payoutReady || record.settlement?.status === 'payable' || record.settlement?.status === 'partially_refunded') {
    return 'Ready for review';
  }
  return 'Not ready';
}

function resolveBlocker(record: FinanceTransaction): Pick<FinanceOperationalProjection, 'blockerState' | 'blockerDetail'> {
  const status = normalizeFinanceStatus(record.status);
  if (status === 'Failed') {
    return {
      blockerState: 'Finance issue',
      blockerDetail: 'Ledger row failed and needs operator review.',
    };
  }
  if (isVendorBlockedFinanceHold(record)) {
    return {
      blockerState: 'Vendor blocked',
      blockerDetail: VENDOR_BLOCKED_FINANCE_HOLD_REASON,
    };
  }
  if (isRefundedSplitChildSaleBasis(record) || isRefundDeductionSettlementReviewPending(record)) {
    return {
      blockerState: 'Refund offset review',
      blockerDetail: 'Refund is recorded; settlement offset review remains.',
    };
  }
  if (record.settlement?.status === 'held') {
    return {
      blockerState: record.settlement.holdReason ? 'Hold active' : 'Held',
      blockerDetail: record.settlement.holdReason ?? 'Settlement is held.',
    };
  }
  if (record.settlement?.status === 'disputed') {
    return {
      blockerState: 'Disputed',
      blockerDetail: 'Settlement is disputed.',
    };
  }
  return {
    blockerState: 'None',
    blockerDetail: 'No blocker detected in the current finance projection.',
  };
}

function resolvePayoutReadiness(record: FinanceTransaction, audience: FinanceAudience) {
  if (isVendorBlockedFinanceHold(record)) {
    return {
      payoutReadiness: 'Blocked by vendor allocation',
      payoutReadinessDetail: VENDOR_BLOCKED_FINANCE_HOLD_REASON,
    };
  }
  if (isRefundedSplitChildSaleBasis(record) || isRefundDeductionSettlementReviewPending(record)) {
    return {
      payoutReadiness: 'Blocked by refund offset',
      payoutReadinessDetail: 'Operational refund is complete; settlement accounting review is still pending.',
    };
  }
  if (record.settlement?.status === 'held' || record.settlement?.status === 'disputed') {
    return {
      payoutReadiness: 'Blocked by settlement status',
      payoutReadinessDetail: record.settlement.holdReason ?? 'Settlement is not payout eligible.',
    };
  }
  if (record.payoutBatch) {
    return {
      payoutReadiness: 'Waiting settlement approval',
      payoutReadinessDetail: `Included in payout review: ${getPayoutBatchStatusLabel(record.payoutBatch.status, audience)}.`,
    };
  }
  if (record.settlement?.review) {
    return {
      payoutReadiness: 'Waiting settlement approval',
      payoutReadinessDetail: 'This row is already locked in settlement review.',
    };
  }
  if (record.settlement?.payoutReady || record.settlement?.status === 'payable' || record.settlement?.status === 'partially_refunded') {
    return {
      payoutReadiness: 'Ready for settlement review',
      payoutReadinessDetail: 'Eligible for review before payout preparation.',
    };
  }
  return {
    payoutReadiness: 'Not ready for payout',
    payoutReadinessDetail: 'This row is still informational until settlement eligibility is reached.',
  };
}

function resolveShippingImpact(record: FinanceTransaction): FinanceOperationalProjection['shippingImpact'] {
  const calculation = record.payoutCalculation;
  if (record.category !== 'Invoice' || !calculation) {
    return {
      state: 'not_applicable',
      label: 'Not applicable',
      detail: 'Shipping reconciliation does not apply to this finance row.',
    };
  }
  if (calculation.shippingMode === 'disabled' || calculation.shippingDeductionSource === 'none') {
    return {
      state: 'not_applicable',
      label: 'Not applicable',
      detail: 'Shipping deduction is disabled or not applied for this row.',
    };
  }
  if (calculation.shippingCostStatus === 'pending_provider_cost') {
    return {
      state: 'required',
      label: 'Shipping reconciliation required',
      detail: 'Provider shipping cost is missing and may change settlement estimates.',
    };
  }
  if (calculation.shippingApplied || calculation.shippingCostSnapshot) {
    return {
      state: 'completed',
      label: 'Shipping reconciled',
      detail: calculation.shippingCostProvider
        ? `Shipping cost captured from ${calculation.shippingCostProvider}.`
        : 'Shipping cost is captured in the payout calculation.',
    };
  }
  return {
    state: 'unknown',
    label: 'Shipping state unknown',
    detail: 'Shipping reconciliation state is not available in this finance projection.',
  };
}

// Finance operational projection should be centralized here before adding page-specific state copy.
export function getFinanceOperationalProjection(
  record: FinanceTransaction,
  options: { audience?: FinanceAudience } = {},
): FinanceOperationalProjection {
  const audience = options.audience ?? 'admin';
  const legacyStatusLabel = getLegacyStatusLabel(record, audience);
  const blocker = resolveBlocker(record);
  const payoutReadiness = resolvePayoutReadiness(record, audience);

  return {
    legacyStatusLabel,
    tone: getTone(legacyStatusLabel),
    settlementState: resolveSettlementState(record),
    payoutState: resolvePayoutState(record, audience),
    ...blocker,
    ...payoutReadiness,
    shippingImpact: resolveShippingImpact(record),
  };
}

function hasOutstandingDebt(value: string | null | undefined) {
  return /[1-9]/.test((value ?? '').replace(/[^\d]/g, ''));
}

export function getFinanceNeedsReviewBreakdown(
  transactions: FinanceTransaction[],
  payoutBatchSummary: FinanceDashboard['payoutBatchSummary'] | undefined,
  summary: FinanceDashboard['summary'] | undefined,
  audience: FinanceAudience = 'admin',
): FinanceNeedsReviewBreakdown {
  const failedRows = transactions.filter((record) => normalizeFinanceStatus(record.status) === 'Failed').length;
  const blockedRows = payoutBatchSummary?.blockedRowCount ?? 0;
  const settlementReview = payoutBatchSummary?.eligibleRowCount ?? 0;
  const refundReview = transactions.filter((record) => {
    const projection = getFinanceOperationalProjection(record, { audience });
    return record.category === 'Refund' && projection.settlementState.includes('Offset review');
  }).length;
  const shippingReconciliation = transactions.filter((record) =>
    getFinanceOperationalProjection(record, { audience }).shippingImpact.state === 'required',
  ).length;
  const debtReview = hasOutstandingDebt(payoutBatchSummary?.outstandingDebtAmount ?? summary?.outstandingVendorDebt) ? 1 : 0;

  return {
    needsReviewTotal: failedRows + blockedRows,
    settlementReview,
    refundReview,
    blockedRows,
    shippingReconciliation,
    debtReview,
    unknownCategoriesLabel: 'Unknown categories: exact issue taxonomy unavailable',
  };
}
