import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

describe('AdminShopifyOrderPage split visibility', () => {
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

  it('renders child split summary card, moved items, and split timeline events', async () => {
    getAdminShopifyOrderBreakdownMock.mockResolvedValueOnce({
      sourceShopifyOrderId: '7817723773265',
      sourceShopifyOrderNumber: '#1091',
      customer: 'Customer',
      createdAt: '2026-06-21T08:00:00.000Z',
      allocations: [buildAllocation()],
    });

    renderPage();

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
});
