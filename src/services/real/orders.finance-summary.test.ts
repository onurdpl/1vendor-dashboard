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
});
