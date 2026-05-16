import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReturnsPage } from './ReturnsPage';
import type { ReturnDetail, ReturnSummary } from '../features/returns/api';
import { setCurrentUser, setToken } from '../lib/auth';

const listReturnsMock = vi.fn<(options?: { vendorId?: string | null }) => Promise<ReturnSummary[]>>();
const getReturnMock = vi.fn<(returnId: string, options?: { vendorId?: string | null }) => Promise<ReturnDetail>>();

vi.mock('../features/returns/api', async () => {
  const actual = await vi.importActual<typeof import('../features/returns/api')>('../features/returns/api');
  return {
    ...actual,
    listReturns: (options?: { vendorId?: string | null }) => listReturnsMock(options),
    getReturn: (returnId: string, options?: { vendorId?: string | null }) => getReturnMock(returnId, options),
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
  returnCarrierName: null,
  returnTrackingNumber: null,
  returnTrackingUrl: null,
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
  returnCarrierName: null,
  returnTrackingNumber: null,
  returnTrackingUrl: null,
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

const nestedProductReturn = {
  ...pendingReturn,
  id: 'RET-A-REQUEST-1018',
  sourceShopifyOrderNumber: 1018,
  refundedItems: [
    {
      id: 'line-a-nested',
      originalVendorId: 'demo-vendor-a',
      assignedVendorId: 'demo-vendor-a',
      vendorId: 'demo-vendor-a',
      sku: 'SKU-NESTED',
      variantTitle: 'Return item',
      name: 'Return item',
      quantity: 1,
      condition: 'Opened',
      refundAmount: '$0.00',
      merchandise: {
        product: {
          title: 'Nested product trainer',
        },
        title: 'Nested variant name',
      },
    },
  ],
} as ReturnDetail;

function toSummary(detail: ReturnDetail): ReturnSummary {
  const { resolution: _resolution, refundMethod: _refundMethod, processedBy: _processedBy, items: _items, timeline: _timeline, ...summary } = detail;
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
    cleanup();
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

    expect(await screen.findByRole('heading', { name: /return requests/i })).toBeInTheDocument();
    expect(listReturnsMock).toHaveBeenCalledWith({ vendorId: 'demo-vendor-a' });
    expect(screen.getAllByText('Return requested').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Wireless label printer').length).toBeGreaterThan(0);
    expect(screen.getAllByText('SKU-A-1').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Refunded').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Refund pending').length).toBeGreaterThan(0);
    expect(screen.queryByText('Included in payout calculations')).not.toBeInTheDocument();
    expect(screen.queryByText('Refund amount')).not.toBeInTheDocument();
    expect(screen.queryByText(/Return item1 item/)).not.toBeInTheDocument();
    expect(screen.queryByText('1 item')).not.toBeInTheDocument();
  });

  it('renders selected drawer item details from the scoped return detail endpoint', async () => {
    listReturnsMock.mockResolvedValue([toSummary(pendingReturn), toSummary(processedRefund)]);
    getReturnMock.mockImplementation(async (returnId) => (returnId === processedRefund.id ? processedRefund : pendingReturn));

    renderReturnsPage();

    expect((await screen.findAllByText('Wireless label printer')).length).toBeGreaterThan(0);
    await userEvent.click(screen.getAllByText('#1002')[0]);

    expect((await screen.findAllByText('Barcode gateway license')).length).toBeGreaterThan(0);
    expect(getReturnMock).toHaveBeenCalledWith(processedRefund.id, { vendorId: 'demo-vendor-a' });
    expect(screen.getAllByText('Standard').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Refunded').length).toBeGreaterThan(0);
    expect(screen.queryByText('Included in payout calculations')).not.toBeInTheDocument();
    expect(screen.queryByText(/webhook/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/backend/i)).not.toBeInTheDocument();
  });

  it('preserves vendor-scoped visibility in mock mode data', async () => {
    listReturnsMock.mockResolvedValue([toSummary(pendingReturn)]);
    getReturnMock.mockResolvedValue(pendingReturn);

    renderReturnsPage();

    expect((await screen.findAllByText('#1001')).length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.queryByText(otherVendorReturn.customer)).not.toBeInTheDocument());
  });

  it('surfaces vendor-friendly review context for attention states', async () => {
    listReturnsMock.mockResolvedValue([toSummary(pendingReturn)]);
    getReturnMock.mockResolvedValue(pendingReturn);

    renderReturnsPage();

    expect((await screen.findAllByText('Awaiting review')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Review return').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Contact support').length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText('İncele return for order #1001').length).toBeGreaterThan(0);
  });

  it('resolves table item names from nested row product data without selecting the row', async () => {
    listReturnsMock.mockResolvedValue([toSummary(nestedProductReturn)]);
    getReturnMock.mockResolvedValue(pendingReturn);

    renderReturnsPage();

    expect(await screen.findByText('Nested product trainer')).toBeInTheDocument();
    expect(screen.getByText('SKU-NESTED')).toBeInTheDocument();
    expect(screen.queryByText('Return item')).not.toBeInTheDocument();
  });

  it('uses variant title before SKU when the item name is only the SKU', async () => {
    listReturnsMock.mockResolvedValue([
      {
        ...toSummary(pendingReturn),
        refundedSkus: ['DJ1196-002-40,5'],
        refundedItems: [
          {
            ...pendingReturn.refundedItems[0],
            sku: 'DJ1196-002-40,5',
            name: 'DJ1196-002-40,5',
            variantTitle: 'Nike Defy All Day Erkek Siyah Antrenman Ayakkabısı / Siyah / 40,5',
          },
        ],
      },
    ]);
    getReturnMock.mockResolvedValue(pendingReturn);

    renderReturnsPage();

    expect(await screen.findByText('Nike Defy All Day Erkek Siyah Antrenman Ayakkabısı / Siyah / 40,5')).toBeInTheDocument();
    expect(screen.getByText('DJ1196-002-40,5')).toBeInTheDocument();
    expect(screen.queryByText('Return item')).not.toBeInTheDocument();
  });

  it('uses list row order line title for unselected rows instead of selected detail', async () => {
    const summaryOnlyReturn: ReturnSummary = {
      ...toSummary(pendingReturn),
      refundedSkus: ['DJ1196-002-40,5'],
      refundedItems: [
        {
          ...pendingReturn.refundedItems[0],
          sku: 'DJ1196-002-40,5',
          name: 'DJ1196-002-40,5',
          variantTitle: 'Return item',
          orderLineItemTitle: 'Nike Defy All Day Erkek Siyah Antrenman Ayakkabısı / Siyah / 40,5',
        },
      ],
    } as ReturnSummary;
    const detailedReturn: ReturnDetail = {
      ...pendingReturn,
      refundedSkus: ['DJ1196-002-40,5'],
      refundedItems: [
        {
          ...pendingReturn.refundedItems[0],
          sku: 'DJ1196-002-40,5',
          name: 'Nike Defy All Day Erkek Siyah Antrenman Ayakkabısı / Siyah / 40,5',
          variantTitle: 'Siyah / 40,5',
        },
      ],
      items: [
        {
          ...pendingReturn.refundedItems[0],
          sku: 'DJ1196-002-40,5',
          name: 'Nike Defy All Day Erkek Siyah Antrenman Ayakkabısı / Siyah / 40,5',
          variantTitle: 'Siyah / 40,5',
        },
      ],
    };
    listReturnsMock.mockResolvedValue([summaryOnlyReturn]);
    getReturnMock.mockResolvedValue({
      ...detailedReturn,
      refundedItems: [
        {
          ...detailedReturn.refundedItems[0],
          name: 'Detail title should not be required',
        },
      ],
    });

    renderReturnsPage();

    expect(await screen.findByText('Nike Defy All Day Erkek Siyah Antrenman Ayakkabısı / Siyah / 40,5')).toBeInTheDocument();
    expect(screen.getByText('DJ1196-002-40,5')).toBeInTheDocument();
    expect(screen.queryByText('Return item')).not.toBeInTheDocument();
  });

  it('renders summary item title without depending on selected detail data', async () => {
    listReturnsMock.mockResolvedValue([
      {
        ...toSummary(pendingReturn),
        itemTitle: 'Nike Court Vision Kadın Krem Günlük Ayakkabı',
        displayTitle: 'Nike Court Vision Kadın Krem Günlük Ayakkabı',
        variantTitle: 'Krem / 36.5',
        refundedSkus: ['DJ1196-002-40,5'],
        refundedItems: undefined,
      },
    ]);
    getReturnMock.mockResolvedValue({
      ...pendingReturn,
      refundedItems: [
        {
          ...pendingReturn.refundedItems[0],
          sku: 'DJ1196-002-40,5',
          name: 'Detail title should not be required',
          variantTitle: 'Krem / 36.5',
        },
      ],
    });

    renderReturnsPage();

    expect(await screen.findByText('Nike Court Vision Kadın Krem Günlük Ayakkabı')).toBeInTheDocument();
    expect(screen.getAllByText('DJ1196-002-40,5').length).toBeGreaterThan(0);
    expect(screen.queryByText('Return item')).not.toBeInTheDocument();
  });

  it('renders the same list item title as the returned item detail source for order 1026', async () => {
    listReturnsMock.mockResolvedValue([
      {
        ...toSummary(pendingReturn),
        sourceShopifyOrderNumber: '#1026',
        itemTitle: 'Nike Swoosh Medium Support Kadın Beyaz Sütyen / Beyaz / S',
        displayTitle: 'Nike Swoosh Medium Support Kadın Beyaz Sütyen / Beyaz / S',
        variantTitle: null,
        refundedSkus: ['SWOOSH-WHITE-S'],
        refundedItems: [
          {
            ...pendingReturn.refundedItems[0],
            sku: 'SWOOSH-WHITE-S',
            name: 'Nike Swoosh Medium Support Kadın Beyaz Sütyen / Beyaz / S',
            variantTitle: 'Details pending',
          },
        ],
      },
    ]);
    getReturnMock.mockResolvedValue({
      ...pendingReturn,
      sourceShopifyOrderNumber: '#1026',
      refundedItems: [
        {
          ...pendingReturn.refundedItems[0],
          sku: 'SWOOSH-WHITE-S',
          name: 'Nike Swoosh Medium Support Kadın Beyaz Sütyen / Beyaz / S',
          variantTitle: 'Details pending',
        },
      ],
    });

    renderReturnsPage();

    expect((await screen.findAllByText('Nike Swoosh Medium Support Kadın Beyaz Sütyen / Beyaz / S')).length).toBeGreaterThan(0);
    expect(screen.queryByText('Details pending')).not.toBeInTheDocument();
    expect(screen.queryByText('Default')).not.toBeInTheDocument();
  });

  it('does not render Shopify Default placeholders as the item title', async () => {
    listReturnsMock.mockResolvedValue([
      {
        ...toSummary(pendingReturn),
        displayTitle: 'Default',
        itemTitle: 'Default Title',
        variantTitle: 'Default',
        refundedSkus: ['DJ1196-002-40,5'],
        refundedItems: [
          {
            ...pendingReturn.refundedItems[0],
            sku: 'DJ1196-002-40,5',
            name: 'Default',
            variantTitle: 'Default Title',
          },
        ],
      },
    ]);
    getReturnMock.mockResolvedValue(pendingReturn);

    renderReturnsPage();

    expect((await screen.findAllByText('DJ1196-002-40,5')).length).toBeGreaterThan(0);
    expect(screen.queryByText('Default')).not.toBeInTheDocument();
    expect(screen.queryByText('Default Title')).not.toBeInTheDocument();
  });

  it('does not concatenate numeric product ids under the item title', async () => {
    listReturnsMock.mockResolvedValue([
      {
        ...toSummary(pendingReturn),
        refundedItems: [
          {
            ...pendingReturn.refundedItems[0],
            sku: 'DJ1196-002-40,5',
            name: 'Nike Defy All Day Erkek Siyah Antrenman Ayakkabısı',
            variantTitle: '1234567890123',
          },
        ],
      },
    ]);
    getReturnMock.mockResolvedValue(pendingReturn);

    renderReturnsPage();

    expect(await screen.findByText('Nike Defy All Day Erkek Siyah Antrenman Ayakkabısı')).toBeInTheDocument();
    expect(screen.queryByText('1234567890123')).not.toBeInTheDocument();
  });

  it('falls back to SKU in the table only when a returned item title is missing', async () => {
    listReturnsMock.mockResolvedValue([
      {
        ...toSummary(pendingReturn),
        refundedSkus: ['SKU-ONLY'],
        refundedItems: [
          {
            ...pendingReturn.refundedItems[0],
            sku: 'SKU-ONLY',
            name: 'Return item',
            variantTitle: 'Return item',
          },
        ],
      },
    ]);
    getReturnMock.mockResolvedValue(pendingReturn);

    renderReturnsPage();

    expect((await screen.findAllByText('SKU-ONLY')).length).toBeGreaterThan(0);
    expect(screen.queryByText('Return item')).not.toBeInTheDocument();
  });

  it('uses Unknown item only when no title or SKU exists', async () => {
    const unknownReturn: ReturnDetail = {
      ...pendingReturn,
      refundedSkus: [],
      refundedItems: [
        {
          ...pendingReturn.refundedItems[0],
          sku: 'UNKNOWN-SKU',
          name: 'Return item',
          variantTitle: 'Return item',
        },
      ],
      items: [],
    };
    listReturnsMock.mockResolvedValue([
      {
        ...toSummary(unknownReturn),
      },
    ]);
    getReturnMock.mockResolvedValue(unknownReturn);

    renderReturnsPage();

    expect((await screen.findAllByText('Unknown item')).length).toBeGreaterThan(0);
    expect(screen.queryByText('Return item')).not.toBeInTheDocument();
  });

  it('renders customer return shipment tracking when Shopify provides it', async () => {
    const returnWithTracking: ReturnDetail = {
      ...pendingReturn,
      returnCarrierName: 'Yurtiçi Kargo',
      returnTrackingNumber: 'returnkargo-123',
      returnTrackingUrl: 'https://tracking.example/returnkargo-123',
    };
    listReturnsMock.mockResolvedValue([toSummary(returnWithTracking)]);
    getReturnMock.mockResolvedValue(returnWithTracking);

    renderReturnsPage();

    expect(await screen.findByText('Return shipment')).toBeInTheDocument();
    expect(screen.getByText('Yurtiçi Kargo')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'returnkargo-123' })).toHaveAttribute(
      'href',
      'https://tracking.example/returnkargo-123',
    );
  });

  it('hides the return shipment card when tracking is unavailable', async () => {
    listReturnsMock.mockResolvedValue([toSummary(pendingReturn)]);
    getReturnMock.mockResolvedValue(pendingReturn);

    renderReturnsPage();

    await screen.findAllByRole('heading', { name: /return requests/i });
    expect(screen.queryByText('Return shipment')).not.toBeInTheDocument();
  });
});
