import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrdersPage } from './OrdersPage';
import type { OrderDetail, OrderSummary } from '../features/orders/api';
import { setCurrentUser, setToken } from '../lib/auth';

const listOrdersMock = vi.fn<(options?: { vendorId?: string | null }) => Promise<OrderSummary[]>>();
const getOrderMock = vi.fn<(orderId: string, options?: { vendorId?: string | null }) => Promise<OrderDetail>>();

vi.mock('../features/orders/api', async () => {
  const actual = await vi.importActual<typeof import('../features/orders/api')>('../features/orders/api');
  return {
    ...actual,
    listOrders: (options?: { vendorId?: string | null }) => listOrdersMock(options),
    getOrder: (orderId: string, options?: { vendorId?: string | null }) => getOrderMock(orderId, options),
  };
});

const orderDetail: OrderDetail = {
  originalVendorId: 'demo-vendor-a',
  assignedVendorId: 'demo-vendor-a',
  vendorId: 'demo-vendor-a',
  id: 'ORD-A-1002',
  sourceShopifyOrderId: 'gid://shopify/Order/1002',
  sourceShopifyOrderNumber: '#1002',
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
  lineItemCount: 1,
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

function buildSummary(overrides: Partial<OrderSummary> = {}): OrderSummary {
  return {
    ...toSummary(orderDetail),
    ...overrides,
  };
}

function renderOrdersPage(initialEntries = ['/orders']) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={initialEntries}>
        <OrdersPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });

  return { promise, resolve };
}

describe('OrdersPage control center', () => {
  beforeEach(() => {
    cleanup();
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

    expect(await screen.findByRole('heading', { name: /^orders$/i })).toBeInTheDocument();
    expect(listOrdersMock).toHaveBeenCalledWith(expect.objectContaining({ vendorId: 'demo-vendor-a' }));
    expect((await screen.findAllByText('#1002')).length).toBeGreaterThan(0);
    expect(screen.queryByText('##1002')).not.toBeInTheDocument();
    expect(screen.getAllByText('Shipping').length).toBeGreaterThan(0);
    expect(screen.getAllByText('DHL / TRK-A-1002').length).toBeGreaterThan(0);
    expect(screen.getAllByText('1 line items').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'Open detail' })).toHaveAttribute('href', '/orders/ORD-A-1002');
    expect(screen.queryByRole('link', { name: 'View' })).not.toBeInTheDocument();
  });

  it('renders list summary line item counts for Shopify orders without waiting for detail data', async () => {
    const summary = buildSummary({
      id: 'ORD-A-1038',
      sourceShopifyOrderId: 'gid://shopify/Order/1038',
      sourceShopifyOrderNumber: '#1038',
      customer: 'Customer unavailable',
      allocationStatus: 'active',
      fulfillmentStatus: 'Processing',
      shippingStatus: 'Label Created',
      carrier: 'try_oto',
      trackingNumber: 'OTO-TRACK-1038',
      lineItemCount: 2,
    });
    listOrdersMock.mockResolvedValue([summary]);
    getOrderMock.mockResolvedValue({
      ...orderDetail,
      ...summary,
      lineItems: orderDetail.lineItems,
      items: orderDetail.items,
      timeline: orderDetail.timeline,
      shippingAddress: orderDetail.shippingAddress,
      notes: orderDetail.notes,
    });

    renderOrdersPage();

    expect((await screen.findAllByText('#1038')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Customer hidden for vendor scope').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Tracking synced').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Try OTO / OTO-TRACK-1038').length).toBeGreaterThan(0);
    expect(screen.queryByText('try_oto / OTO-TRACK-1038')).not.toBeInTheDocument();
    expect(screen.getByText('2 line items')).toBeInTheDocument();
    expect(screen.queryByText('0 line items')).not.toBeInTheDocument();
  });

  it('hides internal order metadata from the vendor operational rail', async () => {
    setCurrentUser({
      email: 'vendor@demo.com',
      name: 'Demo Vendor',
      role: 'vendor',
      vendorAccess: ['demo-vendor-a'],
      vendorDetails: [{ vendorId: 'demo-vendor-a', vendorName: 'Demo Vendor A' }],
      canSwitchVendors: false,
      defaultVendorId: 'demo-vendor-a',
    });
    listOrdersMock.mockResolvedValue([toSummary(orderDetail)]);
    getOrderMock.mockResolvedValue(orderDetail);

    renderOrdersPage();

    expect(await screen.findByText('Fulfillment and shipping')).toBeInTheDocument();
    expect(screen.queryByText('Internal metadata')).not.toBeInTheDocument();
    expect(screen.queryByText(orderDetail.sourceShopifyOrderId)).not.toBeInTheDocument();
    expect(screen.queryByText(orderDetail.id)).not.toBeInTheDocument();
  });

  it('waits for auth and vendor readiness before calling the orders API', () => {
    window.localStorage.clear();
    listOrdersMock.mockResolvedValue([toSummary(orderDetail)]);
    getOrderMock.mockResolvedValue(orderDetail);

    renderOrdersPage();

    expect(screen.getByText('Loading orders')).toBeInTheDocument();
    expect(screen.queryByText(/Unauthorized/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Orders unavailable')).not.toBeInTheDocument();
    expect(listOrdersMock).not.toHaveBeenCalled();
    expect(getOrderMock).not.toHaveBeenCalled();
  });

  it('opens order detail with line item and fulfillment tracking fields', async () => {
    listOrdersMock.mockResolvedValue([toSummary(orderDetail)]);
    getOrderMock.mockResolvedValue(orderDetail);

    renderOrdersPage();

    const customerLabels = await screen.findAllByText('Acme Supply Co.');
    await userEvent.click(customerLabels[0]);

    expect((await screen.findAllByText('Barcode gateway license')).length).toBeGreaterThan(0);
    expect(getOrderMock).toHaveBeenCalledWith('ORD-A-1002', expect.objectContaining({ vendorId: 'demo-vendor-a' }));
    expect(screen.getAllByText(/TRK-A-1002/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Fulfilled').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Delivered').length).toBeGreaterThan(0);
  });

  it('selects the order requested by query parameter instead of the first row', async () => {
    const firstOrder = {
      ...orderDetail,
      id: 'ORD-A-1001',
      sourceShopifyOrderId: 'gid://shopify/Order/1001',
      sourceShopifyOrderNumber: '#1001',
      customer: 'First Customer',
      date: '2026-05-09T09:20:00Z',
    };
    const targetOrder = {
      ...orderDetail,
      id: 'ORD-A-1030',
      sourceShopifyOrderId: 'gid://shopify/Order/1030',
      sourceShopifyOrderNumber: '#1030',
      customer: 'Target Customer',
      date: '2026-05-08T09:20:00Z',
    };
    listOrdersMock.mockResolvedValue([toSummary(firstOrder), toSummary(targetOrder)]);
    getOrderMock.mockImplementation(async (orderId) => {
      if (orderId === 'ORD-A-1030') {
        return targetOrder;
      }
      return firstOrder;
    });

    renderOrdersPage(['/orders?order=1030']);

    expect((await screen.findAllByText('Target Customer')).length).toBeGreaterThan(0);
    await waitFor(() =>
      expect(getOrderMock).toHaveBeenCalledWith('ORD-A-1030', expect.objectContaining({ vendorId: 'demo-vendor-a' })),
    );
    expect(getOrderMock).not.toHaveBeenCalledWith('ORD-A-1001', expect.objectContaining({ vendorId: 'demo-vendor-a' }));
  });

  it('selects the order requested by Shopify order id segment', async () => {
    const firstOrder = {
      ...orderDetail,
      id: 'ORD-A-1001',
      sourceShopifyOrderId: 'gid://shopify/Order/7616544244001',
      sourceShopifyOrderNumber: '#1001',
      customer: 'First Customer',
      date: '2026-05-09T09:20:00Z',
    };
    const targetOrder = {
      ...orderDetail,
      id: 'ORD-A-1030',
      sourceShopifyOrderId: 'gid://shopify/Order/7616544244030',
      sourceShopifyOrderNumber: '#1030',
      customer: 'Target Customer',
      date: '2026-05-08T09:20:00Z',
    };
    listOrdersMock.mockResolvedValue([toSummary(firstOrder), toSummary(targetOrder)]);
    getOrderMock.mockImplementation(async (orderId) => {
      if (orderId === 'ORD-A-1030') {
        return targetOrder;
      }
      return firstOrder;
    });

    renderOrdersPage(['/orders?shopifyOrderId=7616544244030']);

    expect((await screen.findAllByText('Target Customer')).length).toBeGreaterThan(0);
    await waitFor(() =>
      expect(getOrderMock).toHaveBeenCalledWith('ORD-A-1030', expect.objectContaining({ vendorId: 'demo-vendor-a' })),
    );
    expect(getOrderMock).not.toHaveBeenCalledWith('ORD-A-1001', expect.objectContaining({ vendorId: 'demo-vendor-a' }));
  });

  it('falls back to the order number when a linked Shopify id target does not match the visible row id', async () => {
    const firstOrder = {
      ...orderDetail,
      id: 'ORD-A-1001',
      sourceShopifyOrderId: 'gid://shopify/Order/7616544244001',
      sourceShopifyOrderNumber: '#1001',
      customer: 'First Customer',
      date: '2026-05-09T09:20:00Z',
    };
    const targetOrder = {
      ...orderDetail,
      id: 'ORD-A-1030',
      sourceShopifyOrderId: 'gid://shopify/Order/7616544244030',
      sourceShopifyOrderNumber: '#1030',
      customer: 'Target Customer',
      date: '2026-05-08T09:20:00Z',
    };
    listOrdersMock.mockResolvedValue([toSummary(firstOrder), toSummary(targetOrder)]);
    getOrderMock.mockImplementation(async (orderId) => {
      if (orderId === 'ORD-A-1030') {
        return targetOrder;
      }
      return firstOrder;
    });

    renderOrdersPage(['/orders?order=1030&shopifyOrderId=gid%3A%2F%2Fshopify%2FOrder%2F999999999']);

    expect((await screen.findAllByText('Target Customer')).length).toBeGreaterThan(0);
    await waitFor(() =>
      expect(getOrderMock).toHaveBeenCalledWith('ORD-A-1030', expect.objectContaining({ vendorId: 'demo-vendor-a' })),
    );
    expect(screen.queryByText('Linked order unavailable')).not.toBeInTheDocument();
    expect(getOrderMock).not.toHaveBeenCalledWith('ORD-A-1001', expect.objectContaining({ vendorId: 'demo-vendor-a' }));
  });

  it('defers linked unavailable state until async order data finishes loading', async () => {
    const ordersResult = deferred<OrderSummary[]>();
    const targetOrder = {
      ...orderDetail,
      id: 'ORD-A-1030',
      sourceShopifyOrderId: 'gid://shopify/Order/1030',
      sourceShopifyOrderNumber: '#1030',
      customer: 'Target Customer',
    };
    listOrdersMock.mockReturnValue(ordersResult.promise);
    getOrderMock.mockResolvedValue(targetOrder);

    renderOrdersPage(['/orders?order=1030']);

    expect(screen.getAllByText('Loading orders').length).toBeGreaterThan(0);
    expect(screen.queryByText('Linked order unavailable')).not.toBeInTheDocument();

    ordersResult.resolve([toSummary(targetOrder)]);

    expect((await screen.findAllByText('Target Customer')).length).toBeGreaterThan(0);
    await waitFor(() =>
      expect(getOrderMock).toHaveBeenCalledWith('ORD-A-1030', expect.objectContaining({ vendorId: 'demo-vendor-a' })),
    );
  });

  it('does not select the first order when a linked query target is unavailable', async () => {
    listOrdersMock.mockResolvedValue([toSummary(orderDetail)]);
    getOrderMock.mockResolvedValue(orderDetail);

    renderOrdersPage(['/orders?order=9999']);

    expect(await screen.findByText('Linked order unavailable')).toBeInTheDocument();
    expect(getOrderMock).not.toHaveBeenCalled();
  });
});
