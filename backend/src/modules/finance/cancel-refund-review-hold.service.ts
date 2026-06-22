export const CANCEL_REFUND_REVIEW_BLOCKING_STATUSES = [
  'PENDING_REVIEW',
  'CUSTOMER_CONTACTED',
  'SHOPIFY_ACTION_PENDING',
] as const;

export const CANCEL_REFUND_REVIEW_HOLD_REASON =
  'Allocation is under cancel/refund review and cannot move through settlement or payout.';

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
