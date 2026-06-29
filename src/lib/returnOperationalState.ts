export type ReturnTerminalStateInput = {
  status?: string | null;
  returnLifecycleStatus?: string | null;
  sourceType?: string | null;
  refundStatus?: string | null;
  sourceShopifyRefundId?: string | null;
  refundRecordCount?: number | null;
  refundRecords?: unknown[] | null;
  refundedItems?: unknown[] | null;
  refundedLineItems?: unknown[] | null;
  vendorReceivedAt?: string | null;
  vendorReviewedAt?: string | null;
  vendorDecision?: string | null;
};

function normalize(value: unknown) {
  return String(value ?? '').toLowerCase().replace(/[_-]+/g, ' ').trim();
}

function hasText(value: string | null | undefined) {
  return Boolean(value?.trim());
}

function hasRefundEvidence(input: ReturnTerminalStateInput) {
  const refundStatus = normalize(input.refundStatus);
  return (
    refundStatus === 'refunded' ||
    refundStatus === 'processed' ||
    refundStatus === 'refund completed' ||
    hasText(input.sourceShopifyRefundId) ||
    (input.refundRecordCount ?? 0) > 0 ||
    (input.refundRecords?.length ?? 0) > 0 ||
    (input.refundedItems?.length ?? 0) > 0 ||
    (input.refundedLineItems?.length ?? 0) > 0
  );
}

export function isActiveReturnReviewStatus(input: Pick<ReturnTerminalStateInput, 'status'>) {
  const status = normalize(input.status);
  return status === 'requested' || status === 'awaiting review' || status === 'pending' || status === 'in review';
}

export function isTerminalRefundedReturn(input: ReturnTerminalStateInput) {
  const status = normalize(input.returnLifecycleStatus) || normalize(input.status);
  if (!hasRefundEvidence(input)) {
    return false;
  }

  if (status === 'refunded' || status === 'processed') {
    return true;
  }

  if (status !== 'closed') {
    return false;
  }

  const requiresVendorReview = normalize(input.sourceType).includes('shopify return request');
  if (!requiresVendorReview) {
    return true;
  }

  return true;
}
