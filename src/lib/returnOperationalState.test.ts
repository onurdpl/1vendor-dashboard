import { describe, expect, it } from 'vitest';
import { isActiveReturnReviewStatus, isTerminalRefundedReturn } from './returnOperationalState';

describe('return operational state', () => {
  it('treats closed Shopify return requests with refund evidence and vendor review as terminal', () => {
    expect(
      isTerminalRefundedReturn({
        status: 'Closed',
        sourceType: 'shopify_return_request',
        refundStatus: 'Refunded',
        sourceShopifyRefundId: 'gid://shopify/Refund/1',
        vendorReceivedAt: '2026-06-20T10:00:00.000Z',
        vendorReviewedAt: '2026-06-20T10:05:00.000Z',
        vendorDecision: 'approved',
      }),
    ).toBe(true);
  });

  it('does not treat active or unreviewed return requests as terminal', () => {
    expect(
      isTerminalRefundedReturn({
        status: 'Approved',
        sourceType: 'shopify_return_request',
        refundStatus: 'Refunded',
        sourceShopifyRefundId: 'gid://shopify/Refund/1',
        vendorReviewedAt: '2026-06-20T10:05:00.000Z',
        vendorDecision: 'approved',
      }),
    ).toBe(false);

    expect(
      isTerminalRefundedReturn({
        status: 'Closed',
        sourceType: 'shopify_return_request',
        refundStatus: 'Refunded',
        sourceShopifyRefundId: 'gid://shopify/Refund/1',
      }),
    ).toBe(false);
  });

  it('detects active return review statuses for pending filters', () => {
    expect(isActiveReturnReviewStatus({ status: 'Requested' })).toBe(true);
    expect(isActiveReturnReviewStatus({ status: 'Awaiting Review' })).toBe(true);
    expect(isActiveReturnReviewStatus({ status: 'Closed' })).toBe(false);
  });
});
