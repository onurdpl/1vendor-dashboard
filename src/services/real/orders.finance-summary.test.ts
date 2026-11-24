import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setCurrentUser, setToken } from '../../lib/auth';
import { getOrder } from './orders';

function orderDetailResponse(allocationFinanceSummary?: Record<string, unknown>) {
  return {
    id: 'allocation-1',
    sourceShopifyOrderId: 'gid://shopify/Order/1',
    sourceShopifyOrderNumber: '#1',
    vendorId: 'vendor-1',
    assignedVendorId: 'vendor-1',
    originalVendorId: 'vendor-1',
    allocationStatus: 'ACTIVE',
    operationalActionability: { actionable: true, reason: null },
    isCancelled: false,
    isCancellationConflict: false,
    cancelledAt: null,
    cancelReason: null,
    cancelRefundReviewStatus: null,
    refundRecordCount: 0,
    latestOutboundRefundAttemptStatus: null,
    fulfillmentStatus: 'Pending',
    shippingStatus: 'Awaiting Shipment',
    carrier: null,
    trackingNumber: null,
    trackingUrl: null,
    fulfilledAt: null,
    shipmentCreatedAt: null,
    shipmentUpdatedAt: null,
    totalAmount: '2000.00',
    lineItemCount: 0,
    createdAt: '2026-05-01T09:00:00.000Z',
    updatedAt: '2026-05-01T09:00:00.000Z',
    customerName: 'Customer',
    reassignmentRequired: false,
    cancellationReason: null,
    orderSnapshot: null,
    shopifyFulfillmentSync: {
      status: 'not_available',
      fulfillmentOrderIdPresent: false,
      fulfillmentIdPresent: false,
      syncStatus: null,
      skippedReason: null,
      errorMessage: null,
      lastAttemptedAt: null,
    },
    shopifyReturnSignal: null,
    lineItems: [],
    assignmentHistory: [],
    shipmentExecution: null,
    ...(allocationFinanceSummary ? { allocationFinanceSummary } : {}),
  };
}

describe('real orders allocation finance summary mapping', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    window.localStorage.clear();
    fetchMock.mockReset();
    setToken('orders-token');
    setCurrentUser({
      email: 'admin@demo.com',
      name: 'Demo Admin',
      role: 'admin',
      vendorAccess: ['vendor-1'],
      vendorDetails: [{ vendorId: 'vendor-1', vendorName: 'Vendor 1' }],
      canSwitchVendors: false,
      defaultVendorId: 'vendor-1',
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('preserves the optional backend projection without frontend financial arithmetic', async () => {
    const allocationFinanceSummary = {
      available: true,
      resolutionStatus: 'resolved',
      productValue: '2000.00',
      commission: '300.00',
      commissionVat: '60.00',
      shippingDeduction: '100.00',
      shippingDeductionStatus: 'available',
      primaryPayable: { type: 'approved', amount: '1540.00' },
      settlementStatus: 'payable',
      payoutStatus: 'pending',
      paidAt: null,
    };
    fetchMock.mockResolvedValue(new Response(JSON.stringify(orderDetailResponse(allocationFinanceSummary)), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));

    const order = await getOrder('allocation-1', { vendorId: 'vendor-1' });

    expect(order.allocationFinanceSummary).toEqual(allocationFinanceSummary);
  });

  it('handles the property being omitted for a non-admin response', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(orderDetailResponse()), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));

    const order = await getOrder('allocation-1', { vendorId: 'vendor-1' });

    expect(order).not.toHaveProperty('allocationFinanceSummary');
  });
  describe('P04-U4-C1 persisted assignment identity mapping', () => {
    it.each(['history-original-A', '  history-exact-B  '])('preserves the exact source ID %s through history and timeline', async (id) => {
      const entry = { id, action: 'tracking_added', fromVendorId: 'vendor-1', toVendorId: 'vendor-1',
        reason: null, actorUserId: null, createdAt: '2026-06-02T09:00:00.000Z' };
      fetchMock.mockResolvedValue(new Response(JSON.stringify({ ...orderDetailResponse(), assignmentHistory: [entry] }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      }));
      const order = await getOrder('allocation-1', { vendorId: 'vendor-1' });
      expect(order.assignmentHistory[0]).toMatchObject({ id, action: 'tracking_added', createdAt: entry.createdAt });
      expect(order.timeline[0]).toEqual({ assignmentHistoryId: id, label: 'tracking added', at: entry.createdAt });
      expect((fetchMock.mock.calls.at(-1)?.[1] as RequestInit).method ?? 'GET').toBe('GET');
    });
    it.each([undefined, null, '', '   ', 42])('does not manufacture a source identity for invalid input %s', async (id) => {
      fetchMock.mockResolvedValue(new Response(JSON.stringify({ ...orderDetailResponse(), assignmentHistory: [
        { id, action: 'shipment_created', fromVendorId: 'vendor-1', toVendorId: 'vendor-1', reason: null,
          actorUserId: null, createdAt: '2026-06-02T09:00:00.000Z' },
      ] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      const order = await getOrder('allocation-1', { vendorId: 'vendor-1' });
      expect(order.assignmentHistory[0]).not.toHaveProperty('id', expect.anything());
      expect(order.timeline[0]).not.toHaveProperty('assignmentHistoryId', expect.anything());
      expect(order.timeline[0]).toMatchObject({ label: 'shipment created', at: '2026-06-02T09:00:00.000Z' });
    });
  });

});
