import { describe, expect, it } from 'vitest';
import { getOperationalStory, getVendorBlockedOperationalStory } from './orderOperationalStory';
import { canRejectOrder, canShowAllocationSplitRejectAction } from './rejectEligibility';

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

  it('keeps vendor-blocked refund evidence operationally non-terminal without authoritative terminality', () => {
    const story = getOperationalStory({
      allocationStatus: 'vendor_blocked',
      cancelRefundReviewStatus: 'RESOLVED',
      refundRecordCount: 1,
      latestOutboundRefundAttemptStatus: 'RESOLVED',
      cancellationReason: 'OUT_OF_STOCK',
    });

    expect(story.state).toBe('vendor_blocked_awaiting_admin_resolution');
    expect(story.primaryLabel).toBe('Vendor Blocked');
    expect(story.secondaryLabel).toBe('Awaiting admin resolution');
    expect(story.fulfillmentLabel).toBe('Blocked');
    expect(story.financeLabel).toBe('Held');
    expect(story.nextActionLabel).toBe('Review allocation');
    expect(story.queueVisible).toBe(true);
    expect(story.actionVisibility).toEqual({
      canCreateShipment: false,
      canReject: false,
      canTransfer: true,
      canPreviewRefund: true,
    });
  });

  it('does not infer terminality from explicit legacy refund evidence', () => {
    const story = getOperationalStory({
      allocationStatus: 'ACTIVE',
      fulfillmentStatus: 'Pending',
      shippingStatus: 'Awaiting Shipment',
      refundRecordCount: 1,
    });

    expect(story.state).toBe('active_or_unknown');
    expect(story.primaryLabel).toBe('ACTIVE');
    expect(story.secondaryLabel).toBe('Awaiting Shipment');
    expect(story.queueVisible).toBe(false);
    expect(story.actionVisibility.canCreateShipment).toBe(true);
    expect(story.actionVisibility.canReject).toBe(true);
    expect(story.timelineEvents).toEqual([]);
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

  it('gives authoritative allocation refund terminality precedence over raw active workflow state', () => {
    const terminalInput = {
      operationalActionability: {
        actionable: false as const,
        reason: 'ALLOCATION_REFUND_TERMINAL',
      },
      allocationStatus: 'ACTIVE',
      fulfillmentStatus: 'Pending',
      shippingStatus: 'Awaiting Shipment',
      refundRecordCount: 0,
    };

    const story = getOperationalStory(terminalInput);

    expect(story.state).toBe('refunded_completed');
    expect(story.primaryLabel).toBe('Refunded');
    expect(story.secondaryLabel).toBe('Fulfillment not required');
    expect(story.actionVisibility).toEqual({
      canCreateShipment: false,
      canReject: false,
      canTransfer: false,
      canPreviewRefund: false,
    });
    expect(canRejectOrder({
      ...terminalInput,
      id: 'allocation-a',
      originalVendorId: 'vendor-a',
      assignedVendorId: 'vendor-a',
      vendorId: 'vendor-a',
      sourceShopifyOrderId: 'gid://shopify/Order/1',
      sourceShopifyOrderNumber: '#1',
      status: 'Processing',
      reassignmentRequired: false,
      assignmentHistory: [],
      fulfillmentActionState: 'awaiting_shipment',
      fulfillmentActionAvailable: true,
      lineItemCount: 2,
      date: '2026-09-06T10:00:00.000Z',
      customer: 'Customer unavailable',
      amount: 'TRY 100.00',
      channel: 'Shopify',
    })).toBe(false);
    expect(canShowAllocationSplitRejectAction({
      ...terminalInput,
      id: 'allocation-a',
      originalVendorId: 'vendor-a',
      assignedVendorId: 'vendor-a',
      vendorId: 'vendor-a',
      sourceShopifyOrderId: 'gid://shopify/Order/1',
      sourceShopifyOrderNumber: '#1',
      status: 'Processing',
      reassignmentRequired: false,
      assignmentHistory: [],
      fulfillmentActionState: 'awaiting_shipment',
      fulfillmentActionAvailable: true,
      lineItemCount: 2,
      date: '2026-09-06T10:00:00.000Z',
      customer: 'Customer unavailable',
      amount: 'TRY 100.00',
      channel: 'Shopify',
    })).toBe(false);
  });

  it('keeps a partial-refund allocation actionable when authoritative actionability is true', () => {
    const story = getOperationalStory({
      operationalActionability: { actionable: true, reason: null },
      allocationStatus: 'ACTIVE',
      fulfillmentStatus: 'Pending',
      shippingStatus: 'Awaiting Shipment',
      refundRecordCount: 1,
    });

    expect(story.state).toBe('active_or_unknown');
    expect(story.actionVisibility.canCreateShipment).toBe(true);
    expect(story.actionVisibility.canReject).toBe(true);
  });

  it('keeps terminality allocation-scoped for two allocations on the same Shopify order', () => {
    const sharedRawState = {
      allocationStatus: 'ACTIVE',
      fulfillmentStatus: 'Pending',
      shippingStatus: 'Awaiting Shipment',
    };

    expect(getOperationalStory({
      ...sharedRawState,
      operationalActionability: { actionable: false, reason: 'ALLOCATION_REFUND_TERMINAL' },
    }).actionVisibility.canCreateShipment).toBe(false);
    expect(getOperationalStory({
      ...sharedRawState,
      operationalActionability: { actionable: true, reason: null },
    }).actionVisibility.canCreateShipment).toBe(true);
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
