import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReturnDetailPage } from './ReturnDetailPage';
import type { ReturnDetail } from '../features/returns/api';
import { setCurrentUser, setToken } from '../lib/auth';

const getReturnMock = vi.fn<(returnId: string) => Promise<ReturnDetail>>();

vi.mock('../features/returns/api', async () => {
  const actual = await vi.importActual<typeof import('../features/returns/api')>('../features/returns/api');
  return {
    ...actual,
    getReturn: (returnId: string) => getReturnMock(returnId),
  };
});

const returnDetail: ReturnDetail = {
  id: 'RET-REQUEST-1023-LONG-SLUG',
  originalVendorId: 'demo-vendor-a',
  assignedVendorId: 'demo-vendor-a',
  vendorId: 'demo-vendor-a',
  sourceShopifyOrderId: 'gid://shopify/Order/1023',
  sourceShopifyOrderNumber: 1023,
  sourceShopifyRefundId: '',
  sourceShopifyReturnId: 'gid://shopify/Return/9001',
  sourceType: 'shopify_return_request',
  status: 'Requested',
  relatedOrderId: 'ORD-1023',
  date: '2026-05-13T04:44:00Z',
  updatedAt: '2026-05-13T05:00:00Z',
  customer: 'Customer unavailable',
  reason: 'Shopify return request lifecycle - Return 23165600081',
  amount: '$0.00',
  refundedSkus: ['DJ1196-002-40,5'],
  resolution: 'Pending return request synced from Shopify return lifecycle.',
  refundMethod: 'Pending return request',
  processedBy: 'Shopify return lifecycle webhook ingestion via backend',
  refundedItems: [
    {
      id: 'line-1',
      originalVendorId: 'demo-vendor-a',
      assignedVendorId: 'demo-vendor-a',
      vendorId: 'demo-vendor-a',
      sku: 'DJ1196-002-40,5',
      variantTitle: 'White / 42',
      name: 'Nike Air Force 1 07',
      quantity: 1,
      condition: 'Opened',
      refundAmount: '$0.00',
    },
  ],
  items: [],
  timeline: [
    { label: 'Return requested', at: '2026-05-13T04:44:00Z' },
    { label: 'Latest backend update', at: '2026-05-13T05:00:00Z' },
  ],
};

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
      <MemoryRouter initialEntries={['/returns/RET-REQUEST-1023-LONG-SLUG']}>
        <Routes>
          <Route path="/returns/:returnId" element={<ReturnDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ReturnDetailPage vendor review screen', () => {
  beforeEach(() => {
    window.localStorage.clear();
    setToken('test-token');
    setCurrentUser({
      email: 'vendor@example.com',
      name: 'Vendor User',
      role: 'vendor',
      vendorAccess: ['demo-vendor-a'],
      vendorDetails: [{ vendorId: 'demo-vendor-a', vendorName: 'Demo Vendor A' }],
      canSwitchVendors: false,
      defaultVendorId: 'demo-vendor-a',
    });
    getReturnMock.mockReset();
  });

  it('renders a vendor-facing return review without internal lifecycle wording', async () => {
    getReturnMock.mockResolvedValue(returnDetail);

    renderPage();

    expect(await screen.findByRole('heading', { name: 'Return request' })).toBeInTheDocument();
    expect(screen.getByText('Order #1023')).toBeInTheDocument();
    expect(screen.getByText('Nike Air Force 1 07')).toBeInTheDocument();
    expect(screen.getByText('DJ1196-002-40,5')).toBeInTheDocument();
    expect(screen.getByText('White / 42')).toBeInTheDocument();
    expect(screen.getByText('Review return')).toBeInTheDocument();
    expect(screen.getByText('Contact support')).toBeInTheDocument();
    expect(screen.getAllByText('Return requested').length).toBeGreaterThan(0);

    expect(screen.queryByText('RET-REQUEST-1023-LONG-SLUG')).not.toBeInTheDocument();
    expect(screen.queryByText(/backend/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/webhook/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/ingestion/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/lifecycle/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/sync source/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/workflow summary/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/finance context/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Shopify order ID/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Shopify return ID/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Latest backend update/i)).not.toBeInTheDocument();
  });

  it('renders actual Shopify return reason and customer note when available', async () => {
    getReturnMock.mockResolvedValue({
      ...returnDetail,
      reason: 'Size Too Large',
      returnReasonNote: 'Beden büyük geldi.',
      resolution: 'Beden büyük geldi.',
    });

    renderPage();

    expect(await screen.findByText('Size Too Large')).toBeInTheDocument();
    expect(screen.getByText('Beden büyük geldi.')).toBeInTheDocument();
    expect(screen.queryByText(/Shopify return request lifecycle/i)).not.toBeInTheDocument();
  });
});
