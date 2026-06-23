export const CANCEL_REFUND_REVIEW_BLOCKING_STATUSES = [
  'PENDING_REVIEW',
  'CUSTOMER_CONTACTED',
  'SHOPIFY_ACTION_PENDING',
] as const;

export const CANCEL_REFUND_REVIEW_HOLD_REASON =
  'Allocation is under cancel/refund review and cannot move through settlement or payout.';

export const VENDOR_BLOCKED_FINANCE_HOLD_REASON =
  'Vendor allocation is blocked and awaiting admin resolution.';

export type CancelRefundReviewBlockingStatus = typeof CANCEL_REFUND_REVIEW_BLOCKING_STATUSES[number];

const CANCEL_REFUND_REVIEW_BLOCKING_STATUS_SET = new Set<string>(CANCEL_REFUND_REVIEW_BLOCKING_STATUSES);

export function normalizeCancelRefundReviewStatus(status: string | null | undefined) {
  return status?.trim().toUpperCase() ?? '';
}

export function hasBlockingCancelRefundReviewStatus(allocation: {
  cancelRefundReviewStatus?: string | null;
} | null | undefined) {
  return CANCEL_REFUND_REVIEW_BLOCKING_STATUS_SET.has(
    normalizeCancelRefundReviewStatus(allocation?.cancelRefundReviewStatus),
  );
}

export function hasVendorBlockedAllocationStatus(allocation: {
  allocationStatus?: string | null;
} | null | undefined) {
  return allocation?.allocationStatus?.trim().toUpperCase() === 'VENDOR_BLOCKED';
}

function hasResolvedCancelRefundReviewStatus(status: string | null | undefined) {
  return normalizeCancelRefundReviewStatus(status) === 'RESOLVED';
}

function hasPositiveAmount(value: unknown) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) && numeric > 0;
}

export function isVendorBlockedResolvedByRefund(allocation: {
  allocationStatus?: string | null;
  cancelRefundReviewStatus?: string | null;
  refundRecords?: Array<{ amount?: unknown } | unknown>;
  outboundShopifyRefundAttempts?: Array<{ status?: string | null }>;
  financeEntries?: Array<{ entryType?: string | null }>;
} | null | undefined) {
  if (!hasVendorBlockedAllocationStatus(allocation) || !hasResolvedCancelRefundReviewStatus(allocation?.cancelRefundReviewStatus)) {
    return false;
  }

  return Boolean(
    (allocation?.refundRecords?.length ?? 0) > 0 ||
      allocation?.outboundShopifyRefundAttempts?.some((attempt) => attempt.status?.trim().toUpperCase() === 'RESOLVED') ||
      allocation?.financeEntries?.some((entry) => entry.entryType?.trim().toLowerCase() === 'refund') ||
      allocation?.refundRecords?.some((refundRecord) =>
        typeof refundRecord === 'object' && refundRecord !== null && hasPositiveAmount((refundRecord as { amount?: unknown }).amount),
      ),
  );
}

export function hasActiveVendorBlockedFinanceHold(allocation: Parameters<typeof isVendorBlockedResolvedByRefund>[0]) {
  return hasVendorBlockedAllocationStatus(allocation) && !isVendorBlockedResolvedByRefund(allocation);
}
