import { describe, expect, it } from 'vitest';
import {
  buildVendorCommunicationFeed,
  filterCommunicationEvents,
  getCommunicationSummary,
  type CommunicationFeedInput,
} from './communicationCenter';
import type { OrderSummary } from './api/contracts';

function makeOrder(overrides: Partial<OrderSummary> = {}): OrderSummary {
  return {
    originalVendorId: 'demo-vendor-a',
    assignedVendorId: 'demo-vendor-a',
    id: 'ORD-A-1001',
    vendorId: 'demo-vendor-a',
    sourceShopifyOrderId: 'gid://shopify/Order/1001',
    sourceShopifyOrderNumber: 1001,
    status: 'Processing',
    allocationStatus: 'active',
    operationalActionability: { actionable: true, reason: null },
    reassignmentRequired: false,
    assignmentHistory: [],
    fulfillmentActionState: 'awaiting_shipment',
    fulfillmentActionAvailable: true,
    fulfillmentStatus: 'Processing',
    shippingStatus: 'Awaiting Shipment',
    lineItemCount: 1,
    date: '2026-05-17T09:00:00Z',
    customer: 'Customer',
    amount: '$100.00',
    channel: 'Web',
    ...overrides,
  };
}

const baseInput: CommunicationFeedInput = {
  supportTickets: [
    {
      id: 'ticket-1',
      createdAt: '2026-05-17T10:00:00Z',
      updatedAt: '2026-05-17T11:00:00Z',
      createdByUserId: 'vendor-a',
      createdByRole: 'vendor',
      vendorId: 'demo-vendor-a',
      vendorName: 'Demo Vendor A',
      subject: 'Tracking help',
      message: 'Need shipment help.',
      priority: 'normal',
      status: 'WAITING_FOR_VENDOR',
      category: 'SHIPMENT',
      assigneeUserId: null,
      assigneeName: null,
      vendorUnreadCount: 1,
      adminUnreadCount: 0,
      lastReplyAt: '2026-05-17T11:00:00Z',
      lastReplyByRole: 'ADMIN',
      firstResponseDueAt: null,
      nextResponseDueAt: null,
      escalatedAt: null,
      escalationReason: null,
      sla: null,
      contextType: 'order',
      contextId: 'ORD-A-1001',
      contextSummary: { orderNumber: '1001', status: 'Awaiting shipment' },
      resolvedAt: null,
      closedAt: null,
      replies: [],
    },
  ],
  orders: [makeOrder()],
  returns: [
    {
      originalVendorId: 'demo-vendor-a',
      assignedVendorId: 'demo-vendor-a',
      id: 'RET-A-1001',
      vendorId: 'demo-vendor-a',
      sourceShopifyOrderId: 'gid://shopify/Order/1001',
      sourceShopifyOrderNumber: 1001,
      sourceShopifyRefundId: '',
      sourceType: 'shopify_return_request',
      status: 'Requested',
      relatedOrderId: 'ORD-A-1001',
      date: '2026-05-17T08:00:00Z',
      customer: 'Customer',
      reason: 'Return requested',
      amount: '$20.00',
    },
  ],
  finance: {
    summary: {
      grossSales: '$100.00',
      refunds: '$20.00',
      netRevenue: '$80.00',
      platformFee: '$8.00',
      payoutEstimate: '$72.00',
      totalRevenue: '$100.00',
      availableBalance: '$72.00',
      pendingPayouts: '$72.00',
      refundsThisMonth: '$20.00',
      payableBalance: '$72.00',
      accruedBalance: '$72.00',
    },
    transactions: [
      {
        id: 'FIN-REFUND-1',
        date: '2026-05-17T07:00:00Z',
        description: 'Refund activity',
        counterparty: 'Customer',
        category: 'Refund',
        amount: '$20.00',
        status: 'Pending',
        shopifyOrderNumber: '1001',
        shopifyRefundId: 'gid://shopify/Refund/5001',
      },
    ],
  },
};

describe('communicationCenter', () => {
  it('aggregates vendor-safe support, return, shipment, and finance events', () => {
    const feed = buildVendorCommunicationFeed(baseInput);

    expect(feed.map((event) => event.type)).toEqual([
      'support_reply',
      'tracking_required',
      'return_update',
      'refund_processed',
    ]);
    expect(feed[0]).toMatchObject({
      unread: true,
      requiresAction: true,
      href: '/support/ticket-1',
    });
    expect(feed.find((event) => event.type === 'tracking_required')?.href).toBe('/orders/ORD-A-1001');
  });

  it('keeps active tracking guidance content and context unchanged', () => {
    const event = buildVendorCommunicationFeed({
      supportTickets: [],
      orders: [makeOrder({ shipmentUpdatedAt: '2026-05-17T09:30:00Z' })],
      returns: [],
      finance: null,
    }).find((candidate) => candidate.type === 'tracking_required');

    expect(event).toEqual({
      id: 'tracking-ORD-A-1001',
      type: 'tracking_required',
      title: 'Tracking information required',
      summary: '#1001 is awaiting shipment progress.',
      timestamp: '2026-05-17T09:30:00Z',
      severity: 'warning',
      priority: 'requires_action',
      relatedObjectType: 'order',
      relatedObjectId: 'ORD-A-1001',
      relatedLabel: 'Order #1001',
      href: '/orders/ORD-A-1001',
      unread: false,
      requiresAction: true,
      resolved: false,
      context: [
        { label: 'Shipping', value: 'Awaiting Shipment' },
        { label: 'Fulfillment', value: 'Processing' },
      ],
    });
  });

  it('keeps tracking guidance for active drift without canonical terminal or cancellation authority', () => {
    const feed = buildVendorCommunicationFeed({
      supportTickets: [],
      orders: [makeOrder({ refundRecordCount: 1 })],
      returns: [],
      finance: null,
    });

    expect(feed.map((event) => event.type)).toEqual(['tracking_required']);
  });

  it.each([
    {
      state: 'terminal refund',
      order: makeOrder({
        operationalActionability: { actionable: false, reason: 'ALLOCATION_REFUND_TERMINAL' },
      }),
    },
    {
      state: 'clean cancellation',
      order: makeOrder({
        isCancelled: true,
        cancelledAt: '2026-05-17T08:30:00Z',
      }),
    },
    {
      state: 'cancellation conflict',
      order: makeOrder({
        isCancelled: true,
        isCancellationConflict: true,
        cancelledAt: '2026-05-17T08:30:00Z',
      }),
    },
    {
      state: 'vendor blocked',
      order: makeOrder({
        allocationStatus: 'vendor_blocked',
        operationalActionability: { actionable: false, reason: 'VENDOR_REJECTED' },
      }),
    },
    {
      state: 'pending reassignment',
      order: makeOrder({
        allocationStatus: 'pending_reassignment',
        operationalActionability: { actionable: false, reason: 'PENDING_REASSIGNMENT' },
        reassignmentRequired: true,
        fulfillmentActionAvailable: false,
      }),
    },
    {
      state: 'fulfilled and non-actionable',
      order: makeOrder({
        status: 'Delivered',
        allocationStatus: 'fulfilled',
        operationalActionability: { actionable: false, reason: 'ALLOCATION_FULFILLED' },
        fulfillmentActionState: 'delivered',
        fulfillmentActionAvailable: false,
        fulfillmentStatus: 'Fulfilled',
      }),
    },
  ])('suppresses false tracking guidance for $state', ({ order }) => {
    const feed = buildVendorCommunicationFeed({
      supportTickets: [],
      orders: [order],
      returns: [],
      finance: null,
    });

    expect(feed.some((event) => event.type === 'tracking_required')).toBe(false);
  });

  it('preserves refund information and sibling events when terminal tracking guidance is suppressed', () => {
    const terminalOrder = makeOrder({
      operationalActionability: { actionable: false, reason: 'ALLOCATION_REFUND_TERMINAL' },
      fulfillmentActionAvailable: false,
    });
    const feed = buildVendorCommunicationFeed({ ...baseInput, orders: [terminalOrder] });

    expect(feed.map((event) => event.type)).toEqual([
      'support_reply',
      'return_update',
      'refund_processed',
    ]);
    expect(feed.some((event) => event.type === 'tracking_required')).toBe(false);
    expect(feed.find((event) => event.relatedObjectType === 'finance')).toMatchObject({
      type: 'refund_processed',
      title: 'Refund update',
    });
    expect(getCommunicationSummary(feed)).toEqual({
      total: 3,
      unread: 1,
      requiresAction: 3,
      support: 1,
    });
    expect(filterCommunicationEvents(feed, 'shipments')).toHaveLength(0);
  });

  it('filters unread and action-needed communications without exposing admin-only data', () => {
    const feed = buildVendorCommunicationFeed(baseInput);

    expect(filterCommunicationEvents(feed, 'unread')).toHaveLength(1);
    expect(filterCommunicationEvents(feed, 'action')).toHaveLength(4);
    expect(getCommunicationSummary(feed)).toEqual({
      total: 4,
      unread: 1,
      requiresAction: 4,
      support: 1,
    });
    expect(JSON.stringify(feed)).not.toContain('contextSnapshot');
    expect(JSON.stringify(feed)).not.toContain('notes');
  });
});
