import { describe, expect, it } from 'vitest';
import { getOperationalStory, getVendorBlockedOperationalStory } from './orderOperationalStory';

describe('orderOperationalStory', () => {
  it('returns vendor blocked awaiting admin resolution story', () => {
    const story = getOperationalStory({
      allocationStatus: 'VENDOR_BLOCKED',
      cancellationReason: 'OUT_OF_STOCK',
      reassignmentRequired: true,
      fulfillmentStatus: 'Pending',
      shippingStatus: 'Awaiting Shipment',
    });

    expect(story.state).toBe('vendor_blocked_awaiting_admin_resolution');
    expect(story.primaryLabel).toBe('Vendor Blocked');
    expect(story.secondaryLabel).toBe('Awaiting admin resolution');
    expect(story.fulfillmentLabel).toBe('Blocked');
    expect(story.shippingLabel).toBe('Unavailable');
    expect(story.financeLabel).toBe('Held');
    expect(story.nextActionLabel).toBe('Review allocation');
    expect(story.queueVisible).toBe(true);
    expect(story.actionVisibility).toEqual({
      canCreateShipment: false,
      canReject: false,
      canTransfer: true,
      canPreviewRefund: true,
    });
    expect(story.timelineEvents.map((event) => event.label)).toEqual([
      'Vendor rejected allocation',
      'Vendor blocked',
      'Finance hold activated',
      'Awaiting admin resolution',
    ]);
  });

  it('returns vendor blocked resolved by refund story', () => {
    const story = getOperationalStory({
      allocationStatus: 'vendor_blocked',
      cancelRefundReviewStatus: 'RESOLVED',
      refundRecordCount: 1,
      latestOutboundRefundAttemptStatus: 'RESOLVED',
      cancellationReason: 'OUT_OF_STOCK',
    });

    expect(story.state).toBe('vendor_blocked_resolved_by_refund');
    expect(story.primaryLabel).toBe('Refunded');
    expect(story.secondaryLabel).toBe('Fulfillment not required');
    expect(story.fulfillmentLabel).toBe('Fulfillment not required');
    expect(story.financeLabel).toBe('Refund completed');
    expect(story.nextActionLabel).toBe('No action required');
    expect(story.queueVisible).toBe(false);
    expect(story.actionVisibility).toEqual({
      canCreateShipment: false,
      canReject: false,
      canTransfer: false,
      canPreviewRefund: false,
    });
  });

  it('returns refunded completed story for explicit refund evidence', () => {
    const story = getOperationalStory({
      allocationStatus: 'ACTIVE',
      fulfillmentStatus: 'Pending',
      shippingStatus: 'Awaiting Shipment',
      hasResolvedRefundEvidence: true,
    });

    expect(story.state).toBe('refunded_completed');
    expect(story.primaryLabel).toBe('Refunded');
    expect(story.secondaryLabel).toBe('Fulfillment not required');
    expect(story.queueVisible).toBe(false);
    expect(story.actionVisibility.canCreateShipment).toBe(false);
    expect(story.actionVisibility.canReject).toBe(false);
    expect(story.timelineEvents.map((event) => event.label)).toEqual([
      'Refund completed',
      'Fulfillment not required',
    ]);
  });

  it.each([
    { name: 'simple', conflict: false, refundRecordCount: 0 },
    { name: 'conflict', conflict: true, refundRecordCount: 1 },
  ])('uses canonical cancelledAt for $name cancellation activity', ({ conflict, refundRecordCount }) => {
    const cancelledAt = '2026-07-11T21:23:00.000Z';
    const story = getOperationalStory({
      allocationStatus: 'ACTIVE',
      isCancelled: true,
      isCancellationConflict: conflict,
      cancelledAt,
      refundRecordCount,
      fulfillmentStatus: 'Pending',
      shippingStatus: 'Awaiting Shipment',
    });

    expect(story.timelineEvents.find((event) => event.label === 'Shopify order cancelled')?.at).toBe(cancelledAt);
  });

  it('leaves legacy cancellation activity undated for the existing page fallback', () => {
    const story = getOperationalStory({
      allocationStatus: 'ACTIVE',
      isCancelled: true,
      cancelledAt: null,
      fulfillmentStatus: 'Pending',
      shippingStatus: 'Awaiting Shipment',
    });

    expect(story.timelineEvents.find((event) => event.label === 'Shopify order cancelled')?.at).toBeUndefined();
  });

  it('preserves cancellation conflict evidence and finance review copy', () => {
    const story = getOperationalStory({
      allocationStatus: 'ACTIVE',
      isCancelled: true,
      cancelledAt: '2026-07-11T21:23:00.000Z',
      refundRecordCount: 1,
      fulfillmentStatus: 'Pending',
      shippingStatus: 'Awaiting Shipment',
    });

    expect(story.state).toBe('shopify_order_cancelled_conflict');
    expect(story.financeLabel).toBe('Review required');
    expect(story.timelineEvents.map((event) => event.label)).toContain('Existing operational evidence');
  });

  it('keeps active orders in fallback story', () => {
    const story = getOperationalStory({
      allocationStatus: 'ACTIVE',
      fulfillmentStatus: 'Pending',
      shippingStatus: 'Awaiting Shipment',
    });

    expect(story.state).toBe('active_or_unknown');
    expect(story.primaryLabel).toBe('ACTIVE');
    expect(story.actionVisibility.canCreateShipment).toBe(true);
    expect(story.actionVisibility.canReject).toBe(true);
  });

  it('preserves legacy vendor blocked wrapper from canonical story', () => {
    const story = getVendorBlockedOperationalStory({
      allocationStatus: 'vendor_blocked',
      cancellationReason: 'OUT_OF_STOCK',
    });

    expect(story?.state).toBe('vendor_blocked_awaiting_admin_resolution');
    expect(story?.trackingLabel).toBe('Awaiting admin resolution');
    expect(story?.hideShipmentActions).toBe(true);
    expect(story?.rejectUnavailableCopy).toContain('awaiting Sporgym admin review');
  });
});
