import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReturnsPage } from './ReturnsPage';
import type { ReturnDetail, ReturnSummary } from '../features/returns/api';
import { setCurrentUser, setToken } from '../lib/auth';

const listReturnsMock = vi.fn<() => Promise<ReturnSummary[]>>();
const getReturnMock = vi.fn<(returnId: string) => Promise<ReturnDetail>>();

vi.mock('../features/returns/api', async () => {
  const actual = await vi.importActual<typeof import('../features/returns/api')>('../features/returns/api');
  return {
    ...actual,
    listReturns: () => listReturnsMock(),
    getReturn: (returnId: string) => getReturnMock(returnId),
  };
});

const pendingReturn: ReturnDetail = {
  id: 'RET-A-REQUEST-1001',
  originalVendorId: 'demo-vendor-a',
  assignedVendorId: 'demo-vendor-a',
  vendorId: 'demo-vendor-a',
  sourceShopifyOrderId: 'gid://shopify/Order/1001',
  sourceShopifyOrderNumber: 1001,
  sourceShopifyRefundId: '',
  sourceShopifyReturnId: 'gid://shopify/Return/9001',
  sourceType: 'shopify_return_request',
  status: 'Requested',
  relatedOrderId: 'ORD-A-1001',
  date: '2026-05-10T08:20:00Z',
  updatedAt: '2026-05-10T08:32:00Z',
  customer: 'Acme Supply Co.',
  reason: 'Customer requested a return.',
  amount: '$0.00',
  refundedSkus: ['SKU-A-1'],
  resolution: 'Pending merchant review.',
  refundMethod: 'Pending return request',
  processedBy: 'Shopify return lifecycle webhook ingestion via backend',
  refundedItems: [
    {
      id: 'line-a-1',
      originalVendorId: 'demo-vendor-a',
      assignedVendorId: 'demo-vendor-a',
      vendorId: 'demo-vendor-a',
      sku: 'SKU-A-1',
      variantTitle: 'Medium',
      name: 'Wireless label printer',
      quantity: 1,
      condition: 'Opened',
      refundAmount: '$0.00',
    },
  ],
  items: [],
  timeline: [
    { label: 'Return requested', at: '2026-05-10T08:20:00Z' },
    { label: 'Awaiting review', at: '2026-05-10T08:32:00Z' },
  ],
};

const processedRefund: ReturnDetail = {
  id: 'RET-A-REFUND-1002',
  originalVendorId: 'demo-vendor-a',
  assignedVendorId: 'demo-vendor-a',
  vendorId: 'demo-vendor-a',
  sourceShopifyOrderId: 'gid://shopify/Order/1002',
  sourceShopifyOrderNumber: 1002,
  sourceShopifyRefundId: 'gid://shopify/Refund/5002',
  sourceShopifyReturnId: null,
  sourceType: 'shopify_refund',
  status: 'Processed',
  relatedOrderId: 'ORD-A-1002',
  date: '2026-05-09T15:10:00Z',
  updatedAt: '2026-05-09T16:18:00Z',
  customer: 'Northwind Retail',
  reason: 'Refund processed from Shopify.',
  amount: '$650.00',
  refundedSkus: ['SKU-A-2', 'SKU-A-3'],
  resolution: 'Refund processed.',
  refundMethod: 'Original payment method',
  processedBy: 'Shopify webhook ingestion via backend',
  refundedItems: [
    {
      id: 'line-a-2',
      originalVendorId: 'demo-vendor-a',
      assignedVendorId: 'demo-vendor-a',
      vendorId: 'demo-vendor-a',
      sku: 'SKU-A-2',
      variantTitle: 'Standard',
      name: 'Barcode gateway license',
      quantity: 1,
      condition: 'Damaged',
      refundAmount: '$650.00',
    },
  ],
  items: [],
  timeline: [
    { label: 'Refund received', at: '2026-05-09T15:10:00Z' },
    { label: 'Refund completed', at: '2026-05-09T16:18:00Z' },
  ],
};

const otherVendorReturn: ReturnDetail = {
  ...processedRefund,
  id: 'RET-B-REFUND-1002',
  assignedVendorId: 'demo-vendor-b',
  vendorId: 'demo-vendor-b',
  customer: 'Cobalt Logistics',
  refundedSkus: ['SKU-B-1'],
};

function toSummary(detail: ReturnDetail): ReturnSummary {
  const { resolution: _resolution, refundMethod: _refundMethod, processedBy: _processedBy, refundedItems: _refundedItems, items: _items, timeline: _timeline, ...summary } = detail;
  return summary;
}

function renderReturnsPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ReturnsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ReturnsPage control center', () => {
  beforeEach(() => {
    window.localStorage.clear();
    setToken('test-token');
    setCurrentUser({
      email: 'admin@demo.com',
      name: 'Demo Admin',
      role: 'admin',
      vendorAccess: ['demo-vendor-a', 'demo-vendor-b'],
      vendorDetails: [
        { vendorId: 'demo-vendor-a', vendorName: 'Demo Vendor A' },
        { vendorId: 'demo-vendor-b', vendorName: 'Demo Vendor B' },
      ],
      canSwitchVendors: true,
      defaultVendorId: 'demo-vendor-a',
    });
    listReturnsMock.mockReset();
    getReturnMock.mockReset();
  });

  it('renders pending return requests separately from processed refunds', async () => {
    listReturnsMock.mockResolvedValue([toSummary(pendingReturn), toSummary(processedRefund)]);
    getReturnMock.mockImplementation(async (returnId) => (returnId === processedRefund.id ? processedRefund : pendingReturn));

    renderReturnsPage();

    expect(await screen.findByRole('heading', { name: /returns control center/i })).toBeInTheDocument();
    expect(screen.getAllByText('Pending return request').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Processed refund').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Not a refund yet').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Finance-visible refund').length).toBeGreaterThan(0);
  });

  it('renders selected drawer item details from the scoped return detail endpoint', async () => {
    listReturnsMock.mockResolvedValue([toSummary(pendingReturn), toSummary(processedRefund)]);
    getReturnMock.mockImplementation(async (returnId) => (returnId === processedRefund.id ? processedRefund : pendingReturn));

    renderReturnsPage();

    await screen.findByText('Wireless label printer');
    await userEvent.click(screen.getAllByText('Northwind Retail')[0]);

    expect(await screen.findByText('Barcode gateway license')).toBeInTheDocument();
    expect(screen.getAllByText(/SKU-A-2/).length).toBeGreaterThan(0);
    expect(screen.getByText(/This refund is allocated to Demo Vendor A/i)).toBeInTheDocument();
  });

  it('preserves vendor-scoped visibility in mock mode data', async () => {
    listReturnsMock.mockResolvedValue([toSummary(pendingReturn)]);
    getReturnMock.mockResolvedValue(pendingReturn);

    renderReturnsPage();

    expect((await screen.findAllByText('Acme Supply Co.')).length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.queryByText(otherVendorReturn.customer)).not.toBeInTheDocument());
  });

  it('surfaces reconciliation and review context for attention states', async () => {
    listReturnsMock.mockResolvedValue([toSummary(pendingReturn)]);
    getReturnMock.mockResolvedValue(pendingReturn);

    renderReturnsPage();

    expect((await screen.findAllByText('Operator review recommended')).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Diagnostics, replay\/recover, and reconciliation remain admin-only/i).length).toBeGreaterThan(0);
  });
});
