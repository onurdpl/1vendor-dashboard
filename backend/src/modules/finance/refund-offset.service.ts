const ACTIVE_PAYOUT_BATCH_STATUSES = new Set(['DRAFT', 'REVIEW', 'APPROVED', 'EXECUTION_PENDING', 'PAID_PLACEHOLDER']);
const ACTIVE_SETTLEMENT_APPROVAL_STATUSES = new Set(['DRAFT', 'APPROVED']);

export const POST_APPROVAL_REFUND_ADJUSTMENT_REQUIRED_REASON =
  'Refund after settlement approval requires adjustment before payout';

function normalize(value: unknown) {
  return String(value ?? '').trim().toUpperCase();
}

function toNumber(value: unknown) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function toMinorUnits(value: unknown) {
  return Math.round(toNumber(value) * 100);
}

type ActivePayoutBatchLine = {
  payoutBatch?: {
    status?: string | null;
  } | null;
};

type ActiveSettlementApprovalLine = {
  settlementApproval?: {
    id?: string | null;
    status?: string | null;
    approvedAt?: Date | string | null;
  } | null;
};

export type RefundOffsetSaleLedgerSnapshot = {
  id?: string | null;
  entryType?: string | null;
  payoutStatus?: string | null;
  settlementStatus?: string | null;
  commissionPercentSnapshot?: unknown;
  commissionVatPercentSnapshot?: unknown;
  payoutBatchLines?: ActivePayoutBatchLine[];
  settlementApprovalLines?: ActiveSettlementApprovalLine[];
};

export type RefundOffsetEligibilityInput = {
  refundRecord?: {
    id?: string | null;
    sourceShopifyRefundId?: string | null;
  } | null;
  relatedSaleLedgerEntry?: RefundOffsetSaleLedgerSnapshot | null;
  currentSettlementApprovalId?: string | null;
};

export type RefundOffsetEligibility = {
  eligible: boolean;
  reason: string;
  code:
    | 'refund_offset_applied_before_settlement'
    | 'refund_missing_valid_refund_record'
    | 'refund_missing_sale_ledger'
    | 'refund_after_settlement_requires_vendor_debt'
    | 'refund_sale_locked_by_active_settlement'
    | 'refund_sale_locked_by_active_payout_batch';
};

export type PostApprovalRefundRiskState =
  | 'none'
  | 'approved_settlement_adjustment_required'
  | 'already_paid_requires_vendor_debt'
  | 'unsettled_offset_eligible';

export type PostApprovalRefundRisk = {
  state: PostApprovalRefundRiskState;
  reason: string | null;
};

function hasActivePayoutBatch(lines: ActivePayoutBatchLine[] | undefined) {
  return (lines ?? []).some((line) => ACTIVE_PAYOUT_BATCH_STATUSES.has(normalize(line.payoutBatch?.status)));
}

function hasActiveSettlementApproval(
  lines: ActiveSettlementApprovalLine[] | undefined,
  currentSettlementApprovalId?: string | null,
) {
  return (lines ?? []).some((line) => {
    const approval = line.settlementApproval;
    if (!approval || approval.id === currentSettlementApprovalId) {
      return false;
    }
    return ACTIVE_SETTLEMENT_APPROVAL_STATUSES.has(normalize(approval.status));
  });
}

function hasApprovedSettlementApproval(lines: ActiveSettlementApprovalLine[] | undefined) {
  return (lines ?? []).some((line) => normalize(line.settlementApproval?.status) === 'APPROVED');
}

function refundAlreadyRepresentedByApprovedSettlement(input: {
  refundLedgerEntry?: RefundOffsetSaleLedgerSnapshot | null;
  siblingLedgerEntries?: RefundOffsetSaleLedgerSnapshot[];
}) {
  if (hasApprovedSettlementApproval(input.refundLedgerEntry?.settlementApprovalLines)) {
    return true;
  }

  return (input.siblingLedgerEntries ?? []).some((entry) =>
    normalize(entry.entryType) === 'REFUND' && hasApprovedSettlementApproval(entry.settlementApprovalLines)
  );
}

export function classifyPostApprovalRefundRisk(input: RefundOffsetEligibilityInput & {
  refundLedgerEntry?: RefundOffsetSaleLedgerSnapshot | null;
  siblingLedgerEntries?: RefundOffsetSaleLedgerSnapshot[];
}): PostApprovalRefundRisk {
  const refundRecordId = input.refundRecord?.sourceShopifyRefundId ?? input.refundRecord?.id ?? null;
  const sale = input.relatedSaleLedgerEntry;
  if (!refundRecordId || !sale || normalize(sale.entryType || 'sale') !== 'SALE') {
    return {
      state: 'none',
      reason: null,
    };
  }

  if (normalize(sale.payoutStatus) === 'PAID' || normalize(sale.settlementStatus) === 'SETTLED') {
    return {
      state: 'already_paid_requires_vendor_debt',
      reason: 'Refund after settlement requires vendor debt handling.',
    };
  }

  if (refundAlreadyRepresentedByApprovedSettlement(input)) {
    return {
      state: 'none',
      reason: null,
    };
  }

  if (hasApprovedSettlementApproval(sale.settlementApprovalLines)) {
    return {
      state: 'approved_settlement_adjustment_required',
      reason: POST_APPROVAL_REFUND_ADJUSTMENT_REQUIRED_REASON,
    };
  }

  if (getUnsettledRefundOffsetEligibility(input).eligible) {
    return {
      state: 'unsettled_offset_eligible',
      reason: 'Refund offset applied before settlement.',
    };
  }

  return {
    state: 'none',
    reason: null,
  };
}

export function getUnsettledRefundOffsetEligibility(
  input: RefundOffsetEligibilityInput,
): RefundOffsetEligibility {
  const refundRecordId = input.refundRecord?.sourceShopifyRefundId ?? input.refundRecord?.id ?? null;
  if (!refundRecordId) {
    return {
      eligible: false,
      code: 'refund_missing_valid_refund_record',
      reason: 'Refund row is not linked to a valid Shopify refund.',
    };
  }

  const sale = input.relatedSaleLedgerEntry;
  if (!sale || normalize(sale.entryType || 'sale') !== 'SALE') {
    return {
      eligible: false,
      code: 'refund_missing_sale_ledger',
      reason: 'Refund after settlement requires vendor debt handling.',
    };
  }

  if (normalize(sale.payoutStatus) === 'PAID' || normalize(sale.settlementStatus) === 'SETTLED') {
    return {
      eligible: false,
      code: 'refund_after_settlement_requires_vendor_debt',
      reason: 'Refund after settlement requires vendor debt handling.',
    };
  }

  if (hasActivePayoutBatch(sale.payoutBatchLines)) {
    return {
      eligible: false,
      code: 'refund_sale_locked_by_active_payout_batch',
      reason: 'Refund offset required before payout.',
    };
  }

  if (hasActiveSettlementApproval(sale.settlementApprovalLines, input.currentSettlementApprovalId)) {
    if (hasApprovedSettlementApproval(sale.settlementApprovalLines)) {
      return {
        eligible: false,
        code: 'refund_sale_locked_by_active_settlement',
        reason: POST_APPROVAL_REFUND_ADJUSTMENT_REQUIRED_REASON,
      };
    }

    return {
      eligible: false,
      code: 'refund_sale_locked_by_active_settlement',
      reason: 'Refund after settlement requires vendor debt handling.',
    };
  }

  return {
    eligible: true,
    code: 'refund_offset_applied_before_settlement',
    reason: 'Refund offset applied before settlement.',
  };
}

export function isUnsettledRefundOffsetEligible(input: RefundOffsetEligibilityInput) {
  return getUnsettledRefundOffsetEligibility(input).eligible;
}

export function calculateRefundOffsetAmounts(input: {
  refundAmount: unknown;
  commissionPercentSnapshot?: unknown;
  commissionVatPercentSnapshot?: unknown;
}) {
  const refundMinor = Math.max(toMinorUnits(input.refundAmount), 0);
  const commissionPercent = Math.max(toNumber(input.commissionPercentSnapshot), 0);
  const commissionVatPercent = Math.max(toNumber(input.commissionVatPercentSnapshot), 0);
  const commissionReversalMinor = Math.round(refundMinor * (commissionPercent / 100));
  const commissionVatReversalMinor = Math.round(commissionReversalMinor * (commissionVatPercent / 100));
  const vendorPayableReversalMinor = Math.max(
    refundMinor - commissionReversalMinor - commissionVatReversalMinor,
    0,
  );

  return {
    refundMinor,
    commissionReversalMinor,
    commissionVatReversalMinor,
    vendorPayableReversalMinor,
    commissionPercent,
    commissionVatPercent,
  };
}
