import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setCurrentUser, setCurrentVendorId, setToken } from '../lib/auth';
import type { ShopifyOrderBreakdown } from '../features/orders/api';
import { AdminShopifyOrderPage } from './AdminShopifyOrderPage';

const getAdminShopifyOrderBreakdownMock = vi.fn<() => Promise<ShopifyOrderBreakdown>>();

vi.mock('../features/orders/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../features/orders/api')>();
  return {
    ...actual,
    getAdminShopifyOrderBreakdown: () => getAdminShopifyOrderBreakdownMock(),
  };
});

vi.mock('../features/finance/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../features/finance/api')>();
  return {
    ...actual,
    acknowledgeFinanceIntegrityAlert: vi.fn(),
    getTransferRecoveryDiagnostics: vi.fn(),
    rescanFinanceIntegrityAlert: vi.fn(),
    retryEconomicTransfer: vi.fn(),
    resolveFinanceIntegrityAlert: vi.fn(),
  };
});

function buildLineItem(overrides: Partial<ShopifyOrderBreakdown['allocations'][number]['lineItems'][number]> = {}) {
  return {
    originalVendorId: 'yalispor',
    assignedVendorId: 'yalispor',
    id: 'allocation-line-1',
    sku: 'SKU-1088',
    variantTitle: 'Default',
    name: 'Split item',
    imageUrl: null,
    quantity: 1,
    price: '250.00',
    shopifyProductId: null,
    unitPriceVatIncluded: null,
    lineTotalVatIncluded: null,
    lineTaxAmount: null,
    vatRate: null,
    vendorId: 'yalispor',
    fulfillmentStatus: 'Pending',
    allocationStatus: 'vendor_blocked',
    reassignmentRequired: true,
    fulfillmentActionState: 'blocked',
    fulfillmentActionAvailable: false,
    shippingStatus: 'Awaiting Shipment',
    ...overrides,
  };
}

function buildAllocation(
  overrides: Partial<ShopifyOrderBreakdown['allocations'][number]> = {},
): ShopifyOrderBreakdown['allocations'][number] {
  return {
    originalVendorId: 'yalispor',
    assignedVendorId: 'yalispor',
    vendorId: 'yalispor',
    vendorName: 'Yalı Spor',
    allocationOrderId: 'alloc-child',
    status: 'blocked',
    allocationStatus: 'vendor_blocked',
    cancellationReason: 'OUT_OF_STOCK',
    reassignmentRequired: true,
    assignmentHistory: [],
    reassignmentCandidateVendorIds: [],
    fulfillmentActionState: 'blocked',
    fulfillmentActionAvailable: false,
    fulfillmentStatus: 'Pending',
    shippingStatus: 'Awaiting Shipment',
    allocationTotal: '250.00',
    lineItems: [buildLineItem()],
    refundedItems: [],
    refundTotal: '0.00',
    financeIntegrityAlerts: [],
    transferSummary: null,
    cancelRefundReview: null,
    outboundRefundAttemptSummary: null,
    splitSummary: {
      splitEventId: 'split-event-1',
      sourceAllocationId: 'alloc-source',
      childAllocationId: 'alloc-child',
      reason: 'OUT_OF_STOCK',
      note: 'Selected size is unavailable.',
      createdAt: '2026-06-21T12:45:00.000Z',
      actorUserId: 'vendor-user-1',
      actorName: 'Vendor User',
      lineageRole: 'child',
      movedItems: [
        {
          vendorAllocationLineItemId: 'allocation-line-1',
          shopifyLineItemId: 'gid://shopify/LineItem/1',
          sku: 'SKU-1088',
          title: 'Split item',
          quantity: 1,
          lineAmount: 250,
        },
      ],
    },
    ...overrides,
  };
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/admin/orders/7817723773265']}>
        <Routes>
          <Route path="/admin/orders/:shopifyOrderId" element={<AdminShopifyOrderPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function findLatestStatusAxes() {
  const statusAxes = await screen.findAllByLabelText('Admin allocation status axes');
  return statusAxes[statusAxes.length - 1];
}

describe('AdminShopifyOrderPage split visibility', () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    window.localStorage.clear();
    setToken('test-token');
    setCurrentVendorId('demo-vendor-a');
    setCurrentUser({
      email: 'admin@demo.com',
      name: 'Demo Admin',
      role: 'admin',
      vendorAccess: ['demo-vendor-a'],
      vendorDetails: [
        { vendorId: 'demo-vendor-a', vendorName: 'Demo Vendor A' },
        { vendorId: 'replacement-vendor', vendorName: 'Replacement Vendor' },
      ],
      canSwitchVendors: true,
      defaultVendorId: 'demo-vendor-a',
    });
    getAdminShopifyOrderBreakdownMock.mockReset();
  });

  it('loads admin order detail for an authenticated admin even when vendor context is missing', async () => {
    setCurrentVendorId(null);
    setCurrentUser({
      email: 'admin@demo.com',
      name: 'Demo Admin',
      role: 'admin',
      vendorAccess: [],
      vendorDetails: [],
      canSwitchVendors: false,
      defaultVendorId: '',
    });
    getAdminShopifyOrderBreakdownMock.mockResolvedValueOnce({
      sourceShopifyOrderId: '7817723773265',
      sourceShopifyOrderNumber: '#1091',
      customer: 'Customer',
      financialStatus: 'pending',
      createdAt: '2026-06-21T08:00:00.000Z',
      allocations: [buildAllocation()],
    });

    renderPage();

    expect(await screen.findByRole('heading', { name: 'Line-item split allocation' })).toBeInTheDocument();
    expect(getAdminShopifyOrderBreakdownMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Loading Shopify breakdown')).not.toBeInTheDocument();
  });

    it('renders child split summary card, moved items, and split timeline events', async () => {
    getAdminShopifyOrderBreakdownMock.mockResolvedValueOnce({
      sourceShopifyOrderId: '7817723773265',
      sourceShopifyOrderNumber: '#1091',
      customer: 'Customer',
      financialStatus: 'pending',
      createdAt: '2026-06-21T08:00:00.000Z',
      allocations: [
        buildAllocation({
          fulfillmentActionState: 'awaiting_shipment',
        }),
      ],
    });

    renderPage();

    const statusAxes = await findLatestStatusAxes();
    expect(within(statusAxes).getByText('Operational Status')).toBeInTheDocument();
    expect(within(statusAxes).getByText('Vendor Blocked')).toBeInTheDocument();
    expect(within(statusAxes).getByText('Fulfillment Status')).toBeInTheDocument();
    expect(within(statusAxes).getByText('Awaiting Shipment')).toBeInTheDocument();
    expect(within(statusAxes).getByText('Payment Status')).toBeInTheDocument();
    expect(within(statusAxes).getByText('Pending')).toBeInTheDocument();
    expect(screen.queryByText('vendor_blocked')).not.toBeInTheDocument();
    expect(screen.queryByText('awaiting_shipment')).not.toBeInTheDocument();

    expect(await screen.findByRole('heading', { name: 'Line-item split allocation' })).toBeInTheDocument();
    expect(screen.getByText('This allocation was created when the vendor rejected selected line items.')).toBeInTheDocument();
    expect(screen.getByText('alloc-source')).toBeInTheDocument();
    expect(screen.getAllByText('alloc-child').length).toBeGreaterThan(0);
    expect(screen.getByText(/Selected size is unavailable/)).toBeInTheDocument();

    const splitCard = screen.getByLabelText('Allocation split summary');
    expect(within(splitCard).getByText('SKU-1088')).toBeInTheDocument();
    expect(within(splitCard).getByText('Split item')).toBeInTheDocument();
    expect(within(splitCard).getByText('250.00')).toBeInTheDocument();

    expect(screen.getByText('Allocation split created')).toBeInTheDocument();
    expect(screen.getByText('Selected items moved to blocked allocation')).toBeInTheDocument();
      expect(screen.getByText('Child allocation awaiting admin resolution')).toBeInTheDocument();
    });

    it('renders return ownership context for allocations with return records', async () => {
      getAdminShopifyOrderBreakdownMock.mockResolvedValueOnce({
        sourceShopifyOrderId: '7817723773265',
        sourceShopifyOrderNumber: '#1098',
        customer: 'Customer',
        financialStatus: 'paid',
        createdAt: '2026-06-21T08:00:00.000Z',
        allocations: [
          buildAllocation({
            originalVendorId: 'yalispor',
            assignedVendorId: 'sporjinal',
            vendorId: 'sporjinal',
            vendorName: 'Sporjinal',
            returnRecordCount: 1,
            returnRecords: [
              {
                id: 'return-1098',
                status: 'closed',
                reason: 'Customer return closed after refund.',
                createdAt: '2026-06-20T10:00:00.000Z',
                updatedAt: '2026-06-20T10:15:00.000Z',
                returnOwnershipSummary: {
                  originalVendorId: 'yalispor',
                  originalVendorName: 'Yalı Spor',
                  assignedVendorId: 'sporjinal',
                  assignedVendorName: 'Sporjinal',
                  returnOwnerVendorId: 'sporjinal',
                  returnOwnerVendorName: 'Sporjinal',
                  refundFinanceOwnerVendorId: 'sporjinal',
                  refundFinanceOwnerVendorName: 'Sporjinal',
                  economicOwnerVendorId: 'sporjinal',
                  economicOwnerVendorName: 'Sporjinal',
                  ownershipSource: 'return_owner_snapshot',
                  transferSummary: {
                    fromVendorId: 'yalispor',
                    fromVendorName: 'Yalı Spor',
                    toVendorId: 'sporjinal',
                    toVendorName: 'Sporjinal',
                    transferCompletedAt: '2026-06-18T09:30:00.000Z',
                  },
                },
              },
            ],
          }),
        ],
      });

      renderPage();

      const ownershipContext = await screen.findByLabelText('Return ownership context');
      expect(within(ownershipContext).getByText('Return owner')).toBeInTheDocument();
      expect(within(ownershipContext).getByText('Current assigned vendor')).toBeInTheDocument();
      expect(within(ownershipContext).getByText('Original vendor')).toBeInTheDocument();
      expect(within(ownershipContext).getByText('Yalı Spor (yalispor)')).toBeInTheDocument();
      expect(within(ownershipContext).getAllByText('Sporjinal (sporjinal)').length).toBeGreaterThanOrEqual(2);
      expect(within(ownershipContext).getByText(/Transfer:/)).toHaveTextContent('Yalı Spor (yalispor) to Sporjinal (sporjinal)');
    });

    it('renders refunded allocations with separated operational, fulfillment, and payment axes', async () => {
      getAdminShopifyOrderBreakdownMock.mockResolvedValueOnce({
        sourceShopifyOrderId: '7817723773265',
        sourceShopifyOrderNumber: '#1099',
        customer: 'Customer',
        financialStatus: 'refunded',
        createdAt: '2026-06-21T08:00:00.000Z',
        allocations: [
          buildAllocation({
            refundTotal: '250.00',
            refundedItems: [
              {
                id: 'refund-line-1',
                originalVendorId: 'yalispor',
                assignedVendorId: 'yalispor',
                vendorId: 'yalispor',
                sku: 'SKU-1088',
                variantTitle: 'Refund gid://shopify/Refund/1',
                name: 'Split item',
                quantity: 1,
                condition: 'New',
                refundAmount: '250.00',
              },
            ],
            outboundRefundAttemptSummary: {
              id: 'attempt-1',
              status: 'RESOLVED',
              restockType: 'CANCEL',
              refundShipping: false,
              notifyCustomer: false,
              shopifyRefundId: 'gid://shopify/Refund/1',
              previewedAt: '2026-06-21T12:00:00.000Z',
              requestedAt: '2026-06-21T12:05:00.000Z',
              submittedAt: '2026-06-21T12:06:00.000Z',
              resolvedAt: '2026-06-21T12:07:00.000Z',
              failedAt: null,
              failureReason: null,
              postRefundFulfillmentCheckStatus: 'passed',
              postRefundFulfillmentCheckMessage: 'Selected lines no longer fulfillable.',
            },
          }),
        ],
      });

      renderPage();

      const statusAxes = await findLatestStatusAxes();
      expect(within(statusAxes).getByText('Operational Status')).toBeInTheDocument();
      expect(within(statusAxes).getByText('Refunded')).toBeInTheDocument();
      expect(within(statusAxes).getByText('Fulfillment Status')).toBeInTheDocument();
      expect(within(statusAxes).getByText('Fulfillment not required')).toBeInTheDocument();
      expect(within(statusAxes).getByText('Payment Status')).toBeInTheDocument();
      expect(within(statusAxes).getByText('Refund completed')).toBeInTheDocument();
      expect(within(statusAxes).getByText('Historical Context')).toBeInTheDocument();
      expect(within(statusAxes).getByText('Vendor blocked')).toBeInTheDocument();
      expect(screen.queryByText('vendor_blocked')).not.toBeInTheDocument();
    });
  });
