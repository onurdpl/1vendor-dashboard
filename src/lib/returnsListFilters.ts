import type { ReturnSummary } from './api/contracts';
import { isActiveReturnReviewStatus, isTerminalRefundedReturn } from './returnOperationalState';
import type { ReturnsListFilters } from './api/returns';

export function getRefundStatusLabel(item: ReturnSummary) {
  return item.sourceType === 'shopify_return_request' && !item.sourceShopifyRefundId ? 'Refund pending' : 'Refunded';
}

export function isPendingReturn(item: ReturnSummary) {
  return item.sourceType === 'shopify_return_request' && isActiveReturnReviewStatus(item);
}

export function isRefundedReturn(item: ReturnSummary) {
  return item.sourceType !== 'shopify_return_request' || isTerminalRefundedReturn({
    status: item.status,
    returnLifecycleStatus: item.returnLifecycleStatus,
    sourceType: item.sourceType,
    refundStatus: getRefundStatusLabel(item),
    sourceShopifyRefundId: item.sourceShopifyRefundId,
    vendorReceivedAt: item.vendorReceivedAt,
    vendorReviewedAt: item.vendorReviewedAt,
    vendorDecision: item.vendorDecision,
    refundedItems: item.refundedItems,
  });
}

function normalizeReturnStatus(value: string | null | undefined) {
  return String(value ?? '').toLowerCase().replace(/[_-]+/g, ' ').trim();
}

function getNormalizedReturnStates(item: ReturnSummary) {
  return [item.status, item.returnLifecycleStatus].map(normalizeReturnStatus).filter(Boolean);
}

function hasVendorReceivedReturn(item: ReturnSummary) {
  return Boolean(item.vendorReceivedAt?.trim());
}

function hasVendorDecision(item: ReturnSummary) {
  return Boolean(item.vendorDecision?.trim());
}

function isRequestedLikeReturn(item: ReturnSummary) {
  return getNormalizedReturnStates(item).some((state) => ['requested', 'awaiting review', 'pending', 'in review'].includes(state));
}

export function needsAttention(item: ReturnSummary) {
  return isRequestedLikeReturn(item) && hasVendorReceivedReturn(item) && !hasVendorDecision(item);
}

export function isRequestedReturn(item: ReturnSummary) {
  return isRequestedLikeReturn(item) && !hasVendorReceivedReturn(item);
}

function isClosedStatusReturn(item: ReturnSummary) {
  return getNormalizedReturnStates(item).some((state) => ['closed', 'cancelled', 'declined', 'rejected'].includes(state));
}

export function isApprovedReturn(item: ReturnSummary) {
  const approved = getNormalizedReturnStates(item).includes('approved') || normalizeReturnStatus(item.vendorDecision) === 'approved';
  return approved && !isRefundedReturn(item) && !isClosedStatusReturn(item);
}

export function isClosedReturn(item: ReturnSummary) {
  return isClosedStatusReturn(item) && !isRefundedReturn(item);
}

export function matchesReturnListFilters(item: ReturnSummary, filters: ReturnsListFilters) {
  if (filters.status && item.status !== filters.status) return false;
  if (filters.source === 'pending' && !isPendingReturn(item)) return false;
  if (filters.source === 'refunded' && !isRefundedReturn(item)) return false;
  switch (filters.workflow) {
    case 'requested': return isRequestedReturn(item);
    case 'needs-action': return needsAttention(item);
    case 'approved': return isApprovedReturn(item);
    case 'refunded': return isRefundedReturn(item);
    case 'closed': return isClosedReturn(item);
    default: return true;
  }
}
