import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrdersPage } from './OrdersPage';
import type { OrderDetail, OrderSummary } from '../features/orders/api';
import { setCurrentUser, setToken } from '../lib/auth';

const listOrdersMock = vi.fn<() => Promise<OrderSummary[]>>();
const getOrderMock = vi.fn<(orderId: string) => Promise<OrderDetail>>();

vi.mock('../features/orders/api', async () => {
  const actual = await vi.importActual<typeof import('../features/orders/api')>('../features/orders/api');
  return {
    ...actual,
    listOrders: () => listOrdersMock(),
    getOrder: (orderId: string) => getOrderMock(orderId),
  };
});

const orderDetail: OrderDetail = {
  originalVendorId: 'demo-vendor-a',
  assignedVendorId: 'demo-vendor-a',
  vendorId: 'demo-vendor-a',
  id: 'ORD-A-1002',
  sourceShopifyOrderId: 'gid://shopify/Order/1002',
  sourceShopifyOrderNumber: 1002,
  status: 'Delivered',
  allocationStatus: 'fulfilled',
  reassignmentRequired: false,
  assignmentHistory: [],
  fulfillmentActionState: 'delivered',
  fulfillmentActionAvailable: true,
  fulfilledAt: '2026-05-08T16:10:00Z',
  fulfilledByVendorId: 'demo-vendor-a',
  shipmentCreatedAt: '2026-05-08T15:55:00Z',
  shipmentUpdatedAt: '2026-05-09T12:25:00Z',
  fulfillmentStatus: 'Fulfilled',
  shippingStatus: 'Delivered',
  trackingNumber: 'TRK-A-1002',
  carrier: 'DHL',
  trackingUrl: 'https://tracking.example/TRK-A-1002',
  estimatedDelivery: '2026-05-09T12:00:00Z',
  date: '2026-05-08T09:20:00Z',
  customer: 'Acme Supply Co.',
  amount: '$1,950.00',
  channel: 'Shopify',
  shippingAddress: '22 Harbor Ave, Dublin',
  notes: 'Delivered without exceptions.',
  lineItems: [
    {
      originalVendorId: 'demo-vendor-a',
      assignedVendorId: 'demo-vendor-a',
      vendorId: 'demo-vendor-a',
      id: 'line-1002-a1',
      sku: 'SKU456',
      variantTitle: 'Standard',
      name: 'Barcode gateway license',
      quantity: 3,
      price: '$650.00',
      fulfillmentStatus: 'Fulfilled',
      allocationStatus: 'fulfilled',
      reassignmentRequired: false,
      fulfillmentActionState: 'delivered',
      fulfillmentActionAvailable: true,
      shippingStatus: 'Delivered',
      trackingNumber: 'TRK-A-1002',
      carrier: 'DHL',
      trackingUrl: 'https://tracking.example/TRK-A-1002',
    },
  ],
  items: [],
  timeline: [{ label: 'Order received', at: '2026-05-08T09:20:00Z' }],
};

function toSummary(detail: OrderDetail): OrderSummary {
  const { shippingAddress: _shippingAddress, notes: _notes, lineItems: _lineItems, items: _items, timeline: _timeline, ...summary } = detail;
  return summary;
}

function renderOrdersPage() {
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
        <OrdersPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('OrdersPage control center', () => {
  beforeEach(() => {
    window.localStorage.clear();
    setToken('test-token');
    setCurrentUser({
      email: 'admin@demo.com',
      name: 'Demo Admin',
      role: 'admin',
      vendorAccess: ['demo-vendor-a'],
      vendorDetails: [{ vendorId: 'demo-vendor-a', vendorName: 'Demo Vendor A' }],
      canSwitchVendors: false,
      defaultVendorId: 'demo-vendor-a',
    });
    listOrdersMock.mockReset();
    getOrderMock.mockReset();
  });

  it('renders a dense operational orders table in mock-compatible mode', async () => {
    listOrdersMock.mockResolvedValue([toSummary(orderDetail)]);
    getOrderMock.mockResolvedValue(orderDetail);

    renderOrdersPage();

    expect(await screen.findByRole('heading', { name: /orders control center/i })).toBeInTheDocument();
    expect(screen.getByText('Tracking / carrier')).toBeInTheDocument();
    expect(screen.getAllByText('DHL / TRK-A-1002').length).toBeGreaterThan(0);
  });

  it('opens order detail with line item and fulfillment tracking fields', async () => {
    listOrdersMock.mockResolvedValue([toSummary(orderDetail)]);
    getOrderMock.mockResolvedValue(orderDetail);

    renderOrdersPage();

    const customerLabels = await screen.findAllByText('Acme Supply Co.');
    await userEvent.click(customerLabels[0]);

    expect((await screen.findAllByText('Barcode gateway license')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('TRK-A-1002').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Fulfilled').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Delivered').length).toBeGreaterThan(0);
  });
});
