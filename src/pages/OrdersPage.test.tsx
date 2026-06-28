import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrdersPage } from './OrdersPage';
import type {
  AllocationSplitExecutionResponse,
  AllocationSplitPlannerResponse,
  OrderDetail,
  OrderSummary,
  ShipmentExecution,
} from '../features/orders/api';
import { setCurrentUser, setCurrentVendorId, setSession, setToken } from '../lib/auth';

const listOrdersMock = vi.fn<(options?: { vendorId?: string | null }) => Promise<OrderSummary[]>>();
const getOrderMock = vi.fn<(orderId: string, options?: { vendorId?: string | null }) => Promise<OrderDetail>>();
const rejectOrderMock = vi.fn<(orderId: string, payload: { reason: string; note: string }, options?: { vendorId?: string | null }) => Promise<OrderDetail>>();
const planAllocationSplitMock = vi.fn<(
  allocationId: string,
  payload: { selectedVendorAllocationLineItemIds: string[]; reason: string; note?: string },
  options?: { vendorId?: string | null },
) => Promise<AllocationSplitPlannerResponse>>();
const splitAllocationMock = vi.fn<(
  allocationId: string,
  payload: { selectedVendorAllocationLineItemIds: string[]; reason: string; note?: string; confirmSplit: true },
  options?: { vendorId?: string | null },
) => Promise<AllocationSplitExecutionResponse>>();
const createShipmentExecutionMock = vi.fn<(allocationId: string, options?: { vendorId?: string | null }) => Promise<ShipmentExecution>>();
const retryFailedShipmentExecutionMock = vi.fn<(shipmentExecutionId: string, options?: { vendorId?: string | null }) => Promise<ShipmentExecution>>();

vi.mock('../features/orders/api', async () => {
  const actual = await vi.importActual<typeof import('../features/orders/api')>('../features/orders/api');
  return {
    ...actual,
    listOrders: (options?: { vendorId?: string | null }) => listOrdersMock(options),
    getOrder: (orderId: string, options?: { vendorId?: string | null }) => getOrderMock(orderId, options),
    rejectOrder: (orderId: string, payload: { reason: string; note: string }, options?: { vendorId?: string | null }) =>
      rejectOrderMock(orderId, payload, options),
    planAllocationSplit: (
      allocationId: string,
      payload: { selectedVendorAllocationLineItemIds: string[]; reason: string; note?: string },
      options?: { vendorId?: string | null },
    ) => planAllocationSplitMock(allocationId, payload, options),
    splitAllocation: (
      allocationId: string,
      payload: { selectedVendorAllocationLineItemIds: string[]; reason: string; note?: string; confirmSplit: true },
      options?: { vendorId?: string | null },
    ) => splitAllocationMock(allocationId, payload, options),
    createShipmentExecution: (allocationId: string, options?: { vendorId?: string | null }) =>
      createShipmentExecutionMock(allocationId, options),
    retryFailedShipmentExecution: (shipmentExecutionId: string, options?: { vendorId?: string | null }) =>
      retryFailedShipmentExecutionMock(shipmentExecutionId, options),
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
  orderSnapshot: {
    shopifyCreatedAt: '2026-05-08T09:15:00Z',
    currency: 'TRY',
    financialStatus: 'paid',
    paymentGatewayName: 'PayTR Marketplace',
    taxesIncluded: true,
    orderTaxAmount: '177.27',
    shippingAmount: '39.90',
    discountAmount: '25.00',
    orderNote: 'Rail integration note',
    orderTags: ['entegrasyon'],
    vendorIntegrationStatus: 'processing',
    vendorIntegrationStatusMessage: 'Provider processing',
    vendorIntegrationStatusUpdatedAt: '2026-05-08T09:25:00Z',
    vendorIntegrationProvider: 'Provider A',
    vendorIntegrationTrackingUrl: 'https://tracking.example/provider/TRK-A-1002',
    vendorIntegrationShippedAt: '2026-05-08T15:55:00Z',
    vendorInvoiceNumber: 'ABC202600001',
    vendorInvoiceDate: '2026-06-02',
    vendorInvoiceUrl: 'https://example.com/invoices/ABC202600001.pdf',
    vendorInvoiceAmount: '1950.00',
    vendorInvoiceReceivedAt: '2026-06-02T12:30:00Z',
    shippingAddress: {
      address: '22 Harbor Ave',
      city: 'Dublin',
      district: null,
      postcode: null,
      country: 'IE',
      customerPhonePresent: true,
    },
    billingAddress: {
      fullName: 'Acme Billing',
      company: 'Acme Supply Co.',
      phone: '+900000000002',
      city: 'Istanbul',
      district: 'Kadikoy',
      address1: 'Rail billing street',
      address2: 'Suite 4',
      postcode: '34000',
    },
  },
  lineItems: [
    {
      originalVendorId: 'demo-vendor-a',
      assignedVendorId: 'demo-vendor-a',
      vendorId: 'demo-vendor-a',
      id: 'line-1002-a1',
      sku: 'SKU456',
      variantTitle: 'Standard',
      name: 'Barcode gateway license',
      imageUrl: 'https://cdn.example.com/barcode-license.png',
      quantity: 3,
      price: '$650.00',
      shopifyProductId: 'gid://shopify/Product/1002',
      unitPriceVatIncluded: '650.00',
      lineTotalVatIncluded: '1950.00',
      lineTaxAmount: '177.27',
      vatRate: '10.00',
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

const shipmentExecution: ShipmentExecution = {
  id: 'shipment-1002',
  allocationId: 'ORD-A-1002',
  vendorId: 'demo-vendor-a',
  sourceShopifyOrderId: 'gid://shopify/Order/1002',
  sourceShopifyOrderNumber: '#1002',
  sourceShopifyFulfillmentId: null,
  provider: 'navlungo',
  providerShipmentId: 'NVL-1002',
  providerCarrierName: 'Sürat Kargo',
  trackingNumber: 'TRK-A-1002',
  trackingUrl: 'https://tracking.example/TRK-A-1002',
  labelUrl: 'https://labels.example/TRK-A-1002.pdf',
  shipmentStatus: 'created',
  desi: '3.00',
  cargoIntegrationId: null,
  warehouseId: '55574',
  shippingCost: null,
  shippingVat: null,
  currency: 'TRY',
  shippingCostLinked: false,
  providerStatus: 'To Be Picked Up',
  barcode: null,
  lastProviderResponseAt: '2026-05-09T12:25:00Z',
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

function setVendorUser() {
  setCurrentUser({
    email: 'vendor@demo.com',
    name: 'Demo Vendor',
    role: 'vendor',
    vendorAccess: ['demo-vendor-a'],
    vendorDetails: [{ vendorId: 'demo-vendor-a', vendorName: 'Demo Vendor A' }],
    canSwitchVendors: false,
    defaultVendorId: 'demo-vendor-a',
  });
}

function buildAwaitingRejectableOrder(overrides: Partial<OrderDetail> = {}): OrderDetail {
  return {
    ...orderDetail,
    status: 'Pending',
    allocationStatus: 'active',
    reassignmentRequired: false,
    fulfillmentStatus: 'Pending',
    shippingStatus: 'Awaiting Shipment',
    fulfillmentActionState: 'awaiting_shipment',
    fulfillmentActionAvailable: true,
    fulfilledAt: undefined,
    shipmentCreatedAt: undefined,
    shipmentUpdatedAt: undefined,
    trackingNumber: undefined,
    trackingUrl: undefined,
    carrier: undefined,
    shipmentExecution: undefined,
    lineItems: orderDetail.lineItems.map((item) => ({
      ...item,
      allocationStatus: 'active',
      reassignmentRequired: false,
      fulfillmentStatus: 'Pending',
      shippingStatus: 'Awaiting Shipment',
      trackingNumber: undefined,
      trackingUrl: undefined,
      carrier: undefined,
    })),
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

function buildPdfBase64(content = '%PDF-1.4 shipment label') {
  return globalThis.btoa(content);
}

function stubObjectUrl(blobUrl = 'blob:shipment-label') {
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  const createObjectURL = vi.fn(() => blobUrl);
  const revokeObjectURL = vi.fn();

  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: createObjectURL,
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: revokeObjectURL,
  });

  return {
    createObjectURL,
    revokeObjectURL,
    restore() {
      if (originalCreateObjectURL) {
        Object.defineProperty(URL, 'createObjectURL', {
          configurable: true,
          value: originalCreateObjectURL,
        });
      } else {
        Reflect.deleteProperty(URL, 'createObjectURL');
      }
      if (originalRevokeObjectURL) {
        Object.defineProperty(URL, 'revokeObjectURL', {
          configurable: true,
          value: originalRevokeObjectURL,
        });
      } else {
        Reflect.deleteProperty(URL, 'revokeObjectURL');
      }
    },
  };
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
    rejectOrderMock.mockReset();
    planAllocationSplitMock.mockReset();
    splitAllocationMock.mockReset();
    createShipmentExecutionMock.mockReset();
    retryFailedShipmentExecutionMock.mockReset();
  });

  it('renders a dense operational orders table in mock-compatible mode', async () => {
    listOrdersMock.mockResolvedValue([toSummary(orderDetail)]);
    getOrderMock.mockResolvedValue(orderDetail);

    renderOrdersPage();

    expect(await screen.findByRole('heading', { name: /^orders$/i })).toBeInTheDocument();
    expect(listOrdersMock).toHaveBeenCalledWith(expect.objectContaining({ vendorId: 'demo-vendor-a' }));
    expect((await screen.findAllByText('#1002')).length).toBeGreaterThan(0);
    expect(screen.queryByText('##1002')).not.toBeInTheDocument();
    expect(screen.getAllByRole('searchbox')).toHaveLength(1);
    const workflowTabs = screen.getByLabelText('Orders workflow tabs');
    expect(workflowTabs).toBeInTheDocument();
    expect(within(workflowTabs).getByRole('button', { name: /All orders/i })).toHaveClass('is-active');
    expect(screen.queryByLabelText('Orders operational metrics')).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search order, customer, tracking, carrier...')).toBeInTheDocument();
    expect(screen.getAllByRole('combobox')).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Filters' })).toBeVisible();
    expect(screen.getAllByText('Tracking').length).toBeGreaterThan(0);
    expect(screen.getAllByText('DHL / TRK-A-1002').length).toBeGreaterThan(0);
    expect(screen.getAllByText('1 line items').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'İNCELE' })).toHaveAttribute('href', '/orders/ORD-A-1002');
    expect(await screen.findByText('Barcode gateway license')).toBeInTheDocument();
    expect(screen.getByLabelText('Workflow action guidance')).toHaveTextContent('Monitor delivery evidence');
    expect(screen.getByRole('img', { name: 'Barcode gateway license product image' })).toHaveAttribute(
      'src',
      'https://cdn.example.com/barcode-license.png',
    );
    expect(screen.queryByText('0 attention')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'View' })).not.toBeInTheDocument();
  });

  it('separates active operational and paid payment status in the right rail', async () => {
    const activePaidOrder = buildAwaitingRejectableOrder({
      orderSnapshot: {
        ...orderDetail.orderSnapshot!,
        financialStatus: 'paid',
      },
    });
    listOrdersMock.mockResolvedValue([toSummary(activePaidOrder)]);
    getOrderMock.mockResolvedValue(activePaidOrder);

    renderOrdersPage();

    const axes = await screen.findByLabelText('Order status axes');
    expect(within(axes).getByText('Operational Status')).toBeInTheDocument();
    expect(within(axes).getByText('Payment Status')).toBeInTheDocument();
    expect(within(axes).getByText('Active')).toBeInTheDocument();
    expect(within(axes).getByText('paid')).toBeInTheDocument();
  });

  it('separates active operational and pending payment status in the right rail', async () => {
    const activePendingOrder = buildAwaitingRejectableOrder({
      orderSnapshot: {
        ...orderDetail.orderSnapshot!,
        financialStatus: 'pending',
      },
    });
    listOrdersMock.mockResolvedValue([toSummary(activePendingOrder)]);
    getOrderMock.mockResolvedValue(activePendingOrder);

    renderOrdersPage();

    const axes = await screen.findByLabelText('Order status axes');
    expect(within(axes).getByText('Operational Status')).toBeInTheDocument();
    expect(within(axes).getByText('Payment Status')).toBeInTheDocument();
    expect(within(axes).getByText('Active')).toBeInTheDocument();
    expect(within(axes).getByText('pending')).toBeInTheDocument();
  });

  it('renders the inspector line item initials fallback when imageUrl is missing', async () => {
    listOrdersMock.mockResolvedValue([toSummary(orderDetail)]);
    getOrderMock.mockResolvedValue({
      ...orderDetail,
      lineItems: orderDetail.lineItems.map((item) => ({ ...item, imageUrl: null })),
    });

    renderOrdersPage();

    expect(await screen.findByText('BG')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'Barcode gateway license product image' })).not.toBeInTheDocument();
  });

  it('uses workflow query params to open the matching orders queue and allows reset', async () => {
    const awaitingShipmentOrder: OrderDetail = {
      ...orderDetail,
      id: 'ORD-A-1001',
      sourceShopifyOrderNumber: '#1001',
      customer: 'Awaiting Customer',
      status: 'Pending',
      allocationStatus: 'active',
      fulfillmentStatus: 'Pending',
      shippingStatus: 'Awaiting Shipment',
      trackingNumber: null,
      trackingUrl: null,
      carrier: null,
      date: '2026-05-10T09:20:00Z',
    };
    const deliveredOrder: OrderDetail = {
      ...orderDetail,
      id: 'ORD-A-1002',
      sourceShopifyOrderNumber: '#1002',
      customer: 'Delivered Customer',
      date: '2026-05-08T09:20:00Z',
    };
    listOrdersMock.mockResolvedValue([toSummary(awaitingShipmentOrder), toSummary(deliveredOrder)]);
    getOrderMock.mockImplementation(async (orderId) => (orderId === awaitingShipmentOrder.id ? awaitingShipmentOrder : deliveredOrder));

    renderOrdersPage(['/orders?workflow=awaiting-shipment']);

    const workflowTabs = await screen.findByLabelText('Orders workflow tabs');
    expect(workflowTabs).toHaveTextContent('Ready to ship');
    expect(within(workflowTabs).getByRole('button', { name: /Ready to ship/i })).toHaveClass('is-active');
    expect((await screen.findAllByText('#1001')).length).toBeGreaterThan(0);
    expect(screen.queryByText('#1002')).not.toBeInTheDocument();

    await userEvent.click(within(workflowTabs).getByRole('button', { name: /All orders/i }));

    expect((await screen.findAllByText('#1002')).length).toBeGreaterThan(0);
  });

  it('uses workflow query params to open blocked allocation queues', async () => {
    const blockedOrder: OrderDetail = {
      ...orderDetail,
      id: 'ORD-A-BLOCKED',
      sourceShopifyOrderNumber: '#1005',
      customer: 'Blocked Customer',
      allocationStatus: 'vendor_blocked',
      status: 'Pending',
      fulfillmentStatus: 'Pending',
      shippingStatus: 'Awaiting Shipment',
      trackingNumber: null,
      trackingUrl: null,
      carrier: null,
      date: '2026-05-10T09:20:00Z',
    };
    const deliveredOrder: OrderDetail = {
      ...orderDetail,
      id: 'ORD-A-1002',
      sourceShopifyOrderNumber: '#1002',
      customer: 'Delivered Customer',
      date: '2026-05-08T09:20:00Z',
    };
    listOrdersMock.mockResolvedValue([toSummary(blockedOrder), toSummary(deliveredOrder)]);
    getOrderMock.mockImplementation(async (orderId) => (orderId === blockedOrder.id ? blockedOrder : deliveredOrder));

    renderOrdersPage(['/orders?workflow=blocked-allocation']);

    const workflowTabs = await screen.findByLabelText('Orders workflow tabs');
    expect(workflowTabs).toHaveTextContent('Blocked');
    expect(within(workflowTabs).getByRole('button', { name: /Blocked/i })).toHaveClass('is-active');
    expect((await screen.findAllByText('#1005')).length).toBeGreaterThan(0);
    expect(screen.queryByText('#1002')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Workflow action guidance')).toHaveTextContent('Review allocation');
    expect(screen.getAllByText('Vendor Blocked').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Awaiting admin resolution').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Vendor rejected allocation.').length).toBeGreaterThan(0);
    expect(screen.queryByText('No tracking yet')).not.toBeInTheDocument();

    await userEvent.click(within(workflowTabs).getByRole('button', { name: /All orders/i }));

    expect((await screen.findAllByText('#1002')).length).toBeGreaterThan(0);
  });

  it('renders an honest empty state for empty workflow order queues', async () => {
    listOrdersMock.mockResolvedValue([toSummary(orderDetail)]);
    getOrderMock.mockResolvedValue(orderDetail);

    renderOrdersPage(['/orders?workflow=awaiting-shipment']);

    expect(await screen.findByText('No shipments currently awaiting action')).toBeInTheDocument();
    expect(screen.getByText('This workflow queue is clear for the current vendor scope. Switch to All orders to review the full list.')).toBeInTheDocument();
    expect(screen.getByLabelText('Orders workflow tabs')).toHaveTextContent('Ready to ship');
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

  it('renders an explicit waiting state while auth and vendor readiness are unavailable', () => {
    window.localStorage.clear();
    listOrdersMock.mockResolvedValue([toSummary(orderDetail)]);
    getOrderMock.mockResolvedValue(orderDetail);

    const { container } = renderOrdersPage();

    expect(screen.getByRole('heading', { name: 'Orders' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search order, customer, tracking, carrier...')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Order' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Status' })).toBeInTheDocument();
    expect(screen.getAllByRole('row').length).toBeGreaterThan(1);
    expect(screen.getAllByRole('heading', { name: 'Waiting for vendor context' }).length).toBeGreaterThan(0);
    expect(screen.queryByText('Order detail will hydrate after the list finishes loading.')).not.toBeInTheDocument();
    expect(container.querySelector('.op-skeleton-row')).toBeNull();
    expect(screen.queryByText(/Unauthorized/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Orders unavailable')).not.toBeInTheDocument();
    expect(listOrdersMock).not.toHaveBeenCalled();
    expect(getOrderMock).not.toHaveBeenCalled();
  });

  it('enables the orders query once session and vendor context hydrate after mount', async () => {
    window.localStorage.clear();
    listOrdersMock.mockResolvedValue([toSummary(orderDetail)]);
    getOrderMock.mockResolvedValue(orderDetail);

    renderOrdersPage();

    expect(screen.getAllByRole('heading', { name: 'Waiting for vendor context' }).length).toBeGreaterThan(0);
    expect(listOrdersMock).not.toHaveBeenCalled();

    await act(async () => {
      setSession('fresh-token', {
        email: 'admin@demo.com',
        name: 'Demo Admin',
        role: 'admin',
        vendorAccess: ['demo-vendor-a'],
        vendorDetails: [{ vendorId: 'demo-vendor-a', vendorName: 'Demo Vendor A' }],
        canSwitchVendors: false,
        defaultVendorId: 'demo-vendor-a',
      });
      setCurrentVendorId('demo-vendor-a');
    });

    await waitFor(() => {
      expect(listOrdersMock).toHaveBeenCalledWith(expect.objectContaining({ vendorId: 'demo-vendor-a' }));
    });
    expect(await screen.findByText('Barcode gateway license')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Waiting for vendor context' })).not.toBeInTheDocument();
  });

  it('asks for vendor selection when the authenticated user has no vendor context', () => {
    window.localStorage.clear();
    setToken('test-token');
    setCurrentUser({
      email: 'admin@demo.com',
      name: 'Demo Admin',
      role: 'admin',
      vendorAccess: [],
      vendorDetails: [],
      canSwitchVendors: false,
      defaultVendorId: '',
    });
    listOrdersMock.mockResolvedValue([toSummary(orderDetail)]);
    getOrderMock.mockResolvedValue(orderDetail);

    const { container } = renderOrdersPage();

    expect(screen.getByRole('heading', { name: 'Orders' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { name: 'Select vendor' }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('heading', { name: 'Waiting for vendor context' })).not.toBeInTheDocument();
    expect(container.querySelector('.op-skeleton-row')).toBeNull();
    expect(listOrdersMock).not.toHaveBeenCalled();
    expect(getOrderMock).not.toHaveBeenCalled();
  });

  it('renders table skeletons only while an enabled orders query is fetching', () => {
    const ordersResult = deferred<OrderSummary[]>();
    listOrdersMock.mockReturnValue(ordersResult.promise);
    getOrderMock.mockResolvedValue(orderDetail);

    const { container } = renderOrdersPage();

    expect(screen.getByRole('heading', { name: 'Orders' })).toBeInTheDocument();
    expect(container.querySelector('.op-skeleton-row')).not.toBeNull();
    expect(screen.getByText('Loading order detail')).toBeInTheDocument();
    expect(screen.getByText('Order detail will hydrate after the orders list loads.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Waiting for vendor context' })).not.toBeInTheDocument();
    expect(listOrdersMock).toHaveBeenCalledWith(expect.objectContaining({ vendorId: 'demo-vendor-a' }));
  });

  it('renders empty list and inspector states after an orders query resolves empty', async () => {
    listOrdersMock.mockResolvedValue([]);
    getOrderMock.mockResolvedValue(orderDetail);

    renderOrdersPage();

    expect(await screen.findByText('No orders in this view')).toBeInTheDocument();
    expect(screen.getByText('No order selected')).toBeInTheDocument();
    expect(screen.getByText('Select an order')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Waiting for vendor context' })).not.toBeInTheDocument();
    expect(getOrderMock).not.toHaveBeenCalled();
  });

  it('renders the orders retry state when the enabled orders query fails', async () => {
    listOrdersMock.mockRejectedValue(new Error('Orders request timed out.'));
    getOrderMock.mockResolvedValue(orderDetail);

    renderOrdersPage();

    expect(await screen.findByText('Orders unavailable')).toBeInTheDocument();
    expect(screen.getByText('Orders request timed out.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Waiting for vendor context' })).not.toBeInTheDocument();
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
    expect(screen.getByRole('heading', { name: 'Shopify order snapshot' })).toBeInTheDocument();
    expect(screen.getByText('Full-order Shopify values. Tax, shipping, and discount are not allocation-projected.')).toBeInTheDocument();
    expect(screen.queryByText('This order was split. Tax, shipping, and discount below are full-order Shopify snapshot values.')).not.toBeInTheDocument();
    expect(screen.getByText('PayTR Marketplace')).toBeInTheDocument();
    expect(screen.getByText('processing')).toBeInTheDocument();
    expect(screen.getByText('External shipment')).toBeInTheDocument();
    expect(screen.getByText('External shipped at')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Vendor Invoice' })).toBeInTheDocument();
    expect(screen.getByText('ABC202600001')).toBeInTheDocument();
    expect(screen.getByText('2026-06-02')).toBeInTheDocument();
    expect(screen.getAllByText(/TRY\s*1,950\.00/).length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'Open invoice' })).toHaveAttribute('href', 'https://example.com/invoices/ABC202600001.pdf');
    expect(screen.getByText(/Rail billing street/)).toBeInTheDocument();
    expect(screen.getByText(/VAT 10%/)).toBeInTheDocument();
    expect(screen.getByText(/VAT amount TRY\s*177\.27/)).toBeInTheDocument();
    expect(screen.getByText(/Unit price incl\. VAT TRY\s*650\.00/)).toBeInTheDocument();
    expect(screen.getByText(/Line total incl\. VAT TRY\s*1,950\.00/)).toBeInTheDocument();
    expect(screen.getByText(/Shopify product gid:\/\/shopify\/Product\/1002/)).toBeInTheDocument();
  });

  it('shows split-specific Shopify snapshot scope copy on split orders', async () => {
    const splitOrder = {
      ...orderDetail,
      splitSummary: {
        sourceAllocationId: orderDetail.id,
        childAllocationId: 'alloc-child-1002',
        reason: 'OUT_OF_STOCK',
        note: null,
        actorName: null,
        lineageRole: 'source' as const,
        movedItems: [],
      },
    };
    listOrdersMock.mockResolvedValue([toSummary(splitOrder)]);
    getOrderMock.mockResolvedValue(splitOrder);

    renderOrdersPage();

    const customerLabels = await screen.findAllByText('Acme Supply Co.');
    await userEvent.click(customerLabels[0]);

    const snapshot = screen.getByLabelText('Shopify order snapshot');
    expect(within(snapshot).getByText('Full-order Shopify values. Tax, shipping, and discount are not allocation-projected.')).toBeInTheDocument();
    expect(within(snapshot).getByText('This order was split. Tax, shipping, and discount below are full-order Shopify snapshot values.')).toBeInTheDocument();
    expect(within(snapshot).getByText('Vendor integration')).toBeInTheDocument();
    expect(within(snapshot).getByText('Tax total')).toBeInTheDocument();
    expect(within(snapshot).getByText('Shipping')).toBeInTheDocument();
    expect(within(snapshot).getByText('Discount')).toBeInTheDocument();
  });

  it('opens an existing shipment label without creating a duplicate shipment', async () => {
    const openMock = vi.spyOn(globalThis, 'open').mockImplementation(() => null);
    const detailWithLabel = {
      ...orderDetail,
      shipmentExecution,
    };
    listOrdersMock.mockResolvedValue([toSummary(detailWithLabel)]);
    getOrderMock.mockResolvedValue(detailWithLabel);

    renderOrdersPage();

    const labelButton = await screen.findByRole('button', { name: /Etiketi yazdır/i });
    await userEvent.click(labelButton);

    expect(openMock).toHaveBeenCalledWith('https://labels.example/TRK-A-1002.pdf', '_blank', 'noopener,noreferrer');
    expect(createShipmentExecutionMock).not.toHaveBeenCalled();

    openMock.mockRestore();
  });

  it('opens shipment label PDF data URLs through object URLs instead of direct data URLs', async () => {
    const pdfBase64 = buildPdfBase64();
    const dataUrl = `data:application/pdf;base64,${pdfBase64}`;
    const detailWithDataLabel = {
      ...orderDetail,
      shipmentExecution: {
        ...shipmentExecution,
        labelUrl: dataUrl,
      },
    };
    const openMock = vi.spyOn(globalThis, 'open').mockImplementation(() => null);
    const objectUrl = stubObjectUrl('blob:shipment-label-data-url');
    listOrdersMock.mockResolvedValue([toSummary(detailWithDataLabel)]);
    getOrderMock.mockResolvedValue(detailWithDataLabel);

    try {
      renderOrdersPage();

      const labelButton = await screen.findByRole('button', { name: /Etiketi yazdır/i });
      await userEvent.click(labelButton);

      expect(objectUrl.createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
      expect(openMock).toHaveBeenCalledWith('blob:shipment-label-data-url', '_blank', 'noopener,noreferrer');
      expect(openMock).not.toHaveBeenCalledWith(dataUrl, '_blank', 'noopener,noreferrer');
      expect(await screen.findByText('Existing label opened. No duplicate shipment was created.')).toBeInTheDocument();
      expect(document.body.innerHTML).not.toContain(pdfBase64);
      expect(document.body.innerHTML).not.toContain('data:application/pdf');
    } finally {
      openMock.mockRestore();
      objectUrl.restore();
    }
  });

  it('opens raw base64 shipment label PDFs through object URLs', async () => {
    const pdfBase64 = buildPdfBase64('%PDF-1.4 raw shipment label');
    const detailWithRawBase64Label = {
      ...orderDetail,
      shipmentExecution: {
        ...shipmentExecution,
        labelUrl: pdfBase64,
      },
    };
    const openMock = vi.spyOn(globalThis, 'open').mockImplementation(() => null);
    const objectUrl = stubObjectUrl('blob:shipment-label-raw-base64');
    listOrdersMock.mockResolvedValue([toSummary(detailWithRawBase64Label)]);
    getOrderMock.mockResolvedValue(detailWithRawBase64Label);

    try {
      renderOrdersPage();

      const labelButton = await screen.findByRole('button', { name: /Etiketi yazdır/i });
      await userEvent.click(labelButton);

      expect(objectUrl.createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
      expect(openMock).toHaveBeenCalledWith('blob:shipment-label-raw-base64', '_blank', 'noopener,noreferrer');
      expect(openMock).not.toHaveBeenCalledWith(pdfBase64, '_blank', 'noopener,noreferrer');
      expect(document.body.innerHTML).not.toContain(pdfBase64);
    } finally {
      openMock.mockRestore();
      objectUrl.restore();
    }
  });

  it('shows a readable error for unsupported shipment label data without rendering the payload', async () => {
    const invalidLabel = 'not-a-pdf-label-payload';
    const detailWithInvalidLabel = {
      ...orderDetail,
      shipmentExecution: {
        ...shipmentExecution,
        labelUrl: invalidLabel,
      },
    };
    const openMock = vi.spyOn(globalThis, 'open').mockImplementation(() => null);
    const objectUrl = stubObjectUrl();
    listOrdersMock.mockResolvedValue([toSummary(detailWithInvalidLabel)]);
    getOrderMock.mockResolvedValue(detailWithInvalidLabel);

    try {
      renderOrdersPage();

      const labelButton = await screen.findByRole('button', { name: /Etiketi yazdır/i });
      await userEvent.click(labelButton);

      expect(openMock).not.toHaveBeenCalled();
      expect(objectUrl.createObjectURL).not.toHaveBeenCalled();
      expect(await screen.findByText('Shipment label data is not a supported PDF link.')).toBeInTheDocument();
      expect(document.body.innerHTML).not.toContain(invalidLabel);
    } finally {
      openMock.mockRestore();
      objectUrl.restore();
    }
  });

  it('uses the existing shipment create flow for the smart label action when no shipment exists', async () => {
    const awaitingShipmentOrder = {
      ...orderDetail,
      status: 'Pending',
      fulfillmentStatus: 'Pending',
      shippingStatus: 'Awaiting Shipment',
      fulfillmentActionState: 'awaiting_shipment',
      fulfilledAt: undefined,
      shipmentCreatedAt: undefined,
      shipmentUpdatedAt: undefined,
      trackingNumber: undefined,
      trackingUrl: undefined,
      carrier: undefined,
    };
    const createdShipment = {
      ...shipmentExecution,
      id: 'shipment-created',
      labelUrl: 'https://labels.example/new-label.pdf',
    };
    const openMock = vi.spyOn(globalThis, 'open').mockImplementation(() => null);
    listOrdersMock.mockResolvedValue([toSummary(awaitingShipmentOrder)]);
    getOrderMock.mockResolvedValue(awaitingShipmentOrder);
    createShipmentExecutionMock.mockResolvedValue(createdShipment);

    renderOrdersPage();

    const labelButton = await screen.findByRole('button', { name: /Kargo etiketi yazdır/i });
    expect(screen.getByLabelText('Workflow action guidance')).toHaveTextContent('Create shipment');
    await userEvent.click(labelButton);

    await waitFor(() =>
      expect(createShipmentExecutionMock).toHaveBeenCalledWith('ORD-A-1002', expect.objectContaining({ vendorId: 'demo-vendor-a' })),
    );
    expect(openMock).toHaveBeenCalledWith('https://labels.example/new-label.pdf', '_blank', 'noopener,noreferrer');
    expect(await screen.findByText('Shipment label created and opened.')).toBeInTheDocument();

    openMock.mockRestore();
  });

  it('lets a vendor reject an eligible active order from the detail rail', async () => {
    setVendorUser();
    const awaitingShipmentOrder = buildAwaitingRejectableOrder();
    const blockedOrder: OrderDetail = {
      ...awaitingShipmentOrder,
      status: 'On Hold',
      allocationStatus: 'vendor_blocked',
      reassignmentRequired: true,
      cancellationReason: 'damaged_inventory',
      fulfillmentActionAvailable: false,
    };
    listOrdersMock.mockResolvedValue([toSummary(awaitingShipmentOrder)]);
    getOrderMock.mockResolvedValueOnce(awaitingShipmentOrder).mockResolvedValue(blockedOrder);
    rejectOrderMock.mockResolvedValue(blockedOrder);

    renderOrdersPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Reject order' }));
    const dialog = screen.getByRole('dialog', { name: 'Reject order' });
    await userEvent.selectOptions(within(dialog).getByLabelText('Reason'), 'DAMAGED_INVENTORY');
    await userEvent.type(within(dialog).getByLabelText('Note'), 'Damaged box on shelf');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reject order' }));

    await waitFor(() =>
      expect(rejectOrderMock).toHaveBeenCalledWith(
        'ORD-A-1002',
        {
          reason: 'DAMAGED_INVENTORY',
          note: 'Damaged box on shelf',
        },
        expect.objectContaining({ vendorId: 'demo-vendor-a' }),
      ),
    );
    expect(await screen.findByText('Order rejected and sent to admin review.')).toBeInTheDocument();
  });

  it('lets a vendor preview and confirm selected line item rejection from the detail rail', async () => {
    setVendorUser();
    const firstLine = orderDetail.lineItems[0];
    const secondLine = {
      ...firstLine,
      id: 'line-1002-a2',
      sku: 'SKU789',
      name: 'Replacement insole',
      price: '$120.00',
      quantity: 1,
      lineTotalVatIncluded: '120.00',
    };
    const multiLineOrder = buildAwaitingRejectableOrder({
      lineItemCount: 2,
      amount: '$770.00',
      lineItems: [
        {
          ...firstLine,
          allocationStatus: 'active',
          reassignmentRequired: false,
          fulfillmentStatus: 'Pending',
          shippingStatus: 'Awaiting Shipment',
          trackingNumber: undefined,
          trackingUrl: undefined,
          carrier: undefined,
        },
        secondLine,
      ],
      items: [],
    });
    const plannerResult: AllocationSplitPlannerResponse = {
      ok: true,
      writesPerformed: false,
      canSplit: true,
      decision: 'can_split',
      blockers: [],
      warnings: [],
      sourceAllocation: {
        id: multiLineOrder.id,
        allocationStatus: 'active',
        originalVendorId: 'demo-vendor-a',
        assignedVendorId: 'demo-vendor-a',
        sourceShopifyOrderId: multiLineOrder.sourceShopifyOrderId,
        sourceShopifyOrderNumber: multiLineOrder.sourceShopifyOrderNumber,
      },
      selectedLines: [
        {
          id: secondLine.id,
          shopifyLineItemId: secondLine.id,
          quantity: secondLine.quantity,
          lineAmount: 120,
          title: secondLine.name,
          sku: secondLine.sku,
        },
      ],
      remainingLines: [
        {
          id: firstLine.id,
          shopifyLineItemId: firstLine.id,
          quantity: firstLine.quantity,
          lineAmount: 650,
          title: firstLine.name,
          sku: firstLine.sku,
        },
      ],
      amountPlan: {
        originalAmount: 770,
        selectedAmount: 120,
        remainingAmount: 650,
      },
      proposedChildAllocation: {
        id: 'alloc-child-replacement-insole',
        deterministic: true,
      },
    };
    const splitResult: AllocationSplitExecutionResponse = {
      ok: true,
      splitSummary: {
        sourceAllocationId: multiLineOrder.id,
        childAllocationId: 'alloc-child-replacement-insole',
        reason: 'OUT_OF_STOCK',
        note: 'Insole is unavailable',
        actorName: null,
        lineageRole: 'unknown',
        movedItems: [],
      },
      sourceAllocationId: multiLineOrder.id,
      childAllocationId: 'alloc-child-replacement-insole',
      sourceSaleLedgerId: 'fin-source',
      remainingSaleLedgerId: 'fin-remaining',
      childSaleLedgerId: 'fin-child',
      idempotent: false,
    };
    listOrdersMock.mockResolvedValue([toSummary(multiLineOrder)]);
    getOrderMock.mockResolvedValue(multiLineOrder);
    planAllocationSplitMock.mockResolvedValue(plannerResult);
    splitAllocationMock.mockResolvedValue(splitResult);

    renderOrdersPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Reject selected items' }));
    const dialog = screen.getByRole('dialog', { name: 'Reject selected items' });
    await userEvent.click(within(dialog).getByRole('checkbox', { name: /Replacement insole/i }));
    await userEvent.type(within(dialog).getByLabelText('Note'), 'Insole is unavailable');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Continue' }));

    await waitFor(() =>
      expect(planAllocationSplitMock).toHaveBeenCalledWith(
        multiLineOrder.id,
        {
          selectedVendorAllocationLineItemIds: ['line-1002-a2'],
          reason: 'OUT_OF_STOCK',
          note: 'Insole is unavailable',
        },
        expect.objectContaining({ vendorId: 'demo-vendor-a' }),
      ),
    );
    expect(within(dialog).getByText('Selected items')).toBeInTheDocument();
    expect(within(dialog).getByText('Remaining items')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Confirm split' })).toBeDisabled();

    await userEvent.click(within(dialog).getByLabelText(/I understand selected items will move/i));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm split' }));

    await waitFor(() =>
      expect(splitAllocationMock).toHaveBeenCalledWith(
        multiLineOrder.id,
        {
          selectedVendorAllocationLineItemIds: ['line-1002-a2'],
          reason: 'OUT_OF_STOCK',
          note: 'Insole is unavailable',
          confirmSplit: true,
        },
        expect.objectContaining({ vendorId: 'demo-vendor-a' }),
      ),
    );
    expect(await within(dialog).findByText('Split completed.')).toBeInTheDocument();
  });

  it('shows why reject is unavailable when shipment processing exists', async () => {
    setVendorUser();
    const awaitingShipmentOrder = buildAwaitingRejectableOrder({
      shipmentExecution: {
        ...shipmentExecution,
        providerShipmentId: null,
        trackingNumber: null,
        trackingUrl: null,
        labelUrl: null,
        shipmentStatus: 'pending',
      },
    });
    listOrdersMock.mockResolvedValue([toSummary(awaitingShipmentOrder)]);
    getOrderMock.mockResolvedValue(awaitingShipmentOrder);

    renderOrdersPage();

    expect(await screen.findByLabelText('Reject unavailable')).toHaveTextContent(
      'This order cannot be rejected because a shipment is already being processed.',
    );
    expect(screen.getByText('Shipment status: Pending')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reject order' })).not.toBeInTheDocument();
  });

  it('shows why reject is unavailable after fulfillment', async () => {
    setVendorUser();
    const fulfilledOrder = buildAwaitingRejectableOrder({
      fulfillmentStatus: 'Fulfilled',
    });
    listOrdersMock.mockResolvedValue([toSummary(fulfilledOrder)]);
    getOrderMock.mockResolvedValue(fulfilledOrder);

    renderOrdersPage();

    expect(await screen.findByLabelText('Reject unavailable')).toHaveTextContent(
      'This order cannot be rejected after fulfillment.',
    );
    expect(screen.queryByRole('button', { name: 'Reject order' })).not.toBeInTheDocument();
  });

  it('shows why reject is unavailable after tracking or carrier evidence exists', async () => {
    setVendorUser();
    const trackedOrder = buildAwaitingRejectableOrder({
      trackingNumber: 'TRK-1092',
    });
    listOrdersMock.mockResolvedValue([toSummary(trackedOrder)]);
    getOrderMock.mockResolvedValue(trackedOrder);

    renderOrdersPage();

    expect(await screen.findByLabelText('Reject unavailable')).toHaveTextContent(
      'This order cannot be rejected after tracking has been added.',
    );
    expect(screen.queryByRole('button', { name: 'Reject order' })).not.toBeInTheDocument();

    cleanup();
    listOrdersMock.mockReset();
    getOrderMock.mockReset();

    const carrierOrder = buildAwaitingRejectableOrder({
      carrier: 'Yurtiçi Kargo',
    });
    listOrdersMock.mockResolvedValue([toSummary(carrierOrder)]);
    getOrderMock.mockResolvedValue(carrierOrder);

    renderOrdersPage();

    expect(await screen.findByLabelText('Reject unavailable')).toHaveTextContent(
      'This order cannot be rejected after a carrier has been assigned.',
    );
    expect(screen.queryByRole('button', { name: 'Reject order' })).not.toBeInTheDocument();
  });

  it('shows why reject is unavailable for already blocked orders', async () => {
    setVendorUser();
    const blockedOrder = buildAwaitingRejectableOrder({
      status: 'On Hold',
      allocationStatus: 'vendor_blocked',
      reassignmentRequired: true,
      cancellationReason: 'OUT_OF_STOCK',
      fulfillmentActionAvailable: false,
      assignmentHistory: [
        {
          action: 'vendor_blocked',
          fromVendorId: 'demo-vendor-a',
          toVendorId: 'demo-vendor-a',
          reason: 'OUT_OF_STOCK',
          actorName: 'Vendor User',
          actorRole: 'vendor',
          createdAt: '2026-05-08T09:30:00Z',
        },
      ],
    });
    listOrdersMock.mockResolvedValue([toSummary(blockedOrder)]);
    getOrderMock.mockResolvedValue(blockedOrder);

    renderOrdersPage();

    expect(await screen.findByLabelText('Reject unavailable')).toHaveTextContent(
      'Vendor rejection already submitted. This allocation is awaiting Sporgym admin review.',
    );
    expect(screen.queryByRole('button', { name: 'Reject order' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Kargo etiketi yazdır/i })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Workflow action guidance')).toHaveTextContent('Review allocation');
    expect(screen.getByLabelText('Workflow action guidance')).toHaveTextContent(
      'Open the order detail to inspect the blocked assignment and resolve vendor scope before shipment work.',
    );
    expect(screen.getByText('Admin action required')).toBeInTheDocument();
    expect(screen.getByText('Awaiting admin resolution. Shopify not fulfilled.')).toBeInTheDocument();
    const fulfillmentCard = screen.getByRole('heading', { name: 'Fulfillment and shipping' }).closest('section');
    expect(fulfillmentCard).not.toBeNull();
    expect(within(fulfillmentCard as HTMLElement).getByText('Blocked')).toBeInTheDocument();
    expect(within(fulfillmentCard as HTMLElement).getByText('Not fulfilled')).toBeInTheDocument();
    expect(within(fulfillmentCard as HTMLElement).getByText('Unavailable')).toBeInTheDocument();
    const integrationSnapshot = screen.getByLabelText('Shopify order snapshot');
    expect(within(integrationSnapshot).getByText('Held')).toBeInTheDocument();
    expect(within(integrationSnapshot).getByText('Vendor integration')).toBeInTheDocument();
    expect(screen.getAllByText('Vendor rejected allocation').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Awaiting admin resolution').length).toBeGreaterThan(0);
  });

  it('shows refunded completion story for vendor-blocked orders resolved by refund', async () => {
    setVendorUser();
    const refundedBlockedOrder = buildAwaitingRejectableOrder({
      status: 'On Hold',
      allocationStatus: 'vendor_blocked',
      reassignmentRequired: true,
      cancellationReason: 'OUT_OF_STOCK',
      fulfillmentActionAvailable: false,
      cancelRefundReviewStatus: 'RESOLVED',
      refundRecordCount: 1,
      latestOutboundRefundAttemptStatus: 'RESOLVED',
      assignmentHistory: [
        {
          action: 'vendor_blocked',
          fromVendorId: 'demo-vendor-a',
          toVendorId: 'demo-vendor-a',
          reason: 'OUT_OF_STOCK',
          actorName: 'Vendor User',
          actorRole: 'vendor',
          createdAt: '2026-05-08T09:30:00Z',
        },
      ],
    });
    listOrdersMock.mockResolvedValue([toSummary(refundedBlockedOrder)]);
    getOrderMock.mockResolvedValue(refundedBlockedOrder);

    renderOrdersPage();

    expect((await screen.findAllByText('Refunded')).length).toBeGreaterThan(0);
    const axes = screen.getByLabelText('Order status axes');
    expect(within(axes).getByText('Operational Status')).toBeInTheDocument();
    expect(within(axes).getByText('Payment Status')).toBeInTheDocument();
    expect(within(axes).getByText('Refunded')).toBeInTheDocument();
    expect(within(axes).getByText('Refund completed')).toBeInTheDocument();
    expect(screen.getAllByText('Fulfillment not required').length).toBeGreaterThan(0);
    expect(screen.getByLabelText('Reject unavailable')).toHaveTextContent(
      'Vendor rejection was resolved by Shopify refund. No further rejection action is required.',
    );
    expect(screen.getByLabelText('Workflow action guidance')).toHaveTextContent('No action required');
    expect(screen.getByLabelText('Workflow action guidance')).toHaveTextContent(
      'Shopify refund is complete and fulfillment is no longer required for this allocation.',
    );
    expect(screen.queryByRole('button', { name: /Kargo etiketi yazdır/i })).not.toBeInTheDocument();

    const integrationSnapshot = screen.getByLabelText('Shopify order snapshot');
    expect(within(integrationSnapshot).getByText('Refund completed')).toBeInTheDocument();
    expect(screen.queryByText('Awaiting admin resolution. Shopify not fulfilled.')).not.toBeInTheDocument();
  });

  it('clears shipment label success feedback when selecting another order', async () => {
    const awaitingShipmentOrder = {
      ...orderDetail,
      id: 'ORD-A-1002',
      status: 'Pending',
      fulfillmentStatus: 'Pending',
      shippingStatus: 'Awaiting Shipment',
      fulfillmentActionState: 'awaiting_shipment',
      fulfilledAt: undefined,
      shipmentCreatedAt: undefined,
      shipmentUpdatedAt: undefined,
      trackingNumber: undefined,
      trackingUrl: undefined,
      carrier: undefined,
    };
    const secondOrder = {
      ...orderDetail,
      id: 'ORD-A-1003',
      sourceShopifyOrderId: 'gid://shopify/Order/1003',
      sourceShopifyOrderNumber: '#1003',
      customer: 'Second Customer',
      date: '2026-05-07T09:20:00Z',
    };
    const createdShipment = {
      ...shipmentExecution,
      id: 'shipment-created',
      allocationId: 'ORD-A-1002',
      labelUrl: 'https://labels.example/new-label.pdf',
    };
    const openMock = vi.spyOn(globalThis, 'open').mockImplementation(() => null);
    listOrdersMock.mockResolvedValue([toSummary(awaitingShipmentOrder), toSummary(secondOrder)]);
    getOrderMock.mockImplementation(async (orderId) => {
      if (orderId === 'ORD-A-1003') {
        return secondOrder;
      }
      return awaitingShipmentOrder;
    });
    createShipmentExecutionMock.mockResolvedValue(createdShipment);

    renderOrdersPage();

    const labelButton = await screen.findByRole('button', { name: /Kargo etiketi yazdır/i });
    await userEvent.click(labelButton);

    expect(await screen.findByText('Shipment label created and opened.')).toBeInTheDocument();

    await userEvent.click(screen.getByText('Second Customer'));

    expect(screen.queryByText('Shipment label created and opened.')).not.toBeInTheDocument();

    openMock.mockRestore();
  });

  it('does not store stale shipment feedback when a label action finishes after another order is selected', async () => {
    const awaitingShipmentOrder = {
      ...orderDetail,
      id: 'ORD-A-1002',
      status: 'Pending',
      fulfillmentStatus: 'Pending',
      shippingStatus: 'Awaiting Shipment',
      fulfillmentActionState: 'awaiting_shipment',
      fulfilledAt: undefined,
      shipmentCreatedAt: undefined,
      shipmentUpdatedAt: undefined,
      trackingNumber: undefined,
      trackingUrl: undefined,
      carrier: undefined,
    };
    const secondOrder = {
      ...orderDetail,
      id: 'ORD-A-1003',
      sourceShopifyOrderId: 'gid://shopify/Order/1003',
      sourceShopifyOrderNumber: '#1003',
      customer: 'Second Customer',
      date: '2026-05-07T09:20:00Z',
    };
    const createdShipment = {
      ...shipmentExecution,
      id: 'shipment-created',
      allocationId: 'ORD-A-1002',
      labelUrl: 'https://labels.example/new-label.pdf',
    };
    const shipmentResult = deferred<ShipmentExecution>();
    const openMock = vi.spyOn(globalThis, 'open').mockImplementation(() => null);
    listOrdersMock.mockResolvedValue([toSummary(awaitingShipmentOrder), toSummary(secondOrder)]);
    getOrderMock.mockImplementation(async (orderId) => {
      if (orderId === 'ORD-A-1003') {
        return secondOrder;
      }
      return awaitingShipmentOrder;
    });
    createShipmentExecutionMock.mockReturnValue(shipmentResult.promise);

    renderOrdersPage();

    const labelButton = await screen.findByRole('button', { name: /Kargo etiketi yazdır/i });
    await userEvent.click(labelButton);
    await userEvent.click(screen.getByText('Second Customer'));

    await act(async () => {
      shipmentResult.resolve(createdShipment);
      await shipmentResult.promise;
    });

    await waitFor(() =>
      expect(openMock).toHaveBeenCalledWith('https://labels.example/new-label.pdf', '_blank', 'noopener,noreferrer'),
    );
    expect(screen.queryByText('Shipment label created and opened.')).not.toBeInTheDocument();

    await userEvent.click(screen.getAllByText('Acme Supply Co.')[0]);

    expect(screen.queryByText('Shipment label created and opened.')).not.toBeInTheDocument();

    openMock.mockRestore();
  });

  it('clears shipment label success feedback when vendor context changes', async () => {
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
    setCurrentVendorId('demo-vendor-a');
    const vendorAOrder = {
      ...orderDetail,
      id: 'ORD-A-1002',
      status: 'Pending',
      fulfillmentStatus: 'Pending',
      shippingStatus: 'Awaiting Shipment',
      fulfillmentActionState: 'awaiting_shipment',
      fulfilledAt: undefined,
      shipmentCreatedAt: undefined,
      shipmentUpdatedAt: undefined,
      trackingNumber: undefined,
      trackingUrl: undefined,
      carrier: undefined,
    };
    const vendorBOrder = {
      ...orderDetail,
      id: 'ORD-B-2001',
      originalVendorId: 'demo-vendor-b',
      assignedVendorId: 'demo-vendor-b',
      vendorId: 'demo-vendor-b',
      sourceShopifyOrderId: 'gid://shopify/Order/2001',
      sourceShopifyOrderNumber: '#2001',
      customer: 'Vendor B Customer',
    };
    const createdShipment = {
      ...shipmentExecution,
      id: 'shipment-created',
      allocationId: 'ORD-A-1002',
      vendorId: 'demo-vendor-a',
      labelUrl: 'https://labels.example/new-label.pdf',
    };
    const openMock = vi.spyOn(globalThis, 'open').mockImplementation(() => null);
    listOrdersMock.mockImplementation(async (options) => (
      options?.vendorId === 'demo-vendor-b' ? [toSummary(vendorBOrder)] : [toSummary(vendorAOrder)]
    ));
    getOrderMock.mockImplementation(async (orderId) => {
      if (orderId === 'ORD-B-2001') {
        return vendorBOrder;
      }
      return vendorAOrder;
    });
    createShipmentExecutionMock.mockResolvedValue(createdShipment);

    renderOrdersPage();

    const labelButton = await screen.findByRole('button', { name: /Kargo etiketi yazdır/i });
    await userEvent.click(labelButton);

    expect(await screen.findByText('Shipment label created and opened.')).toBeInTheDocument();

    await act(async () => {
      setCurrentVendorId('demo-vendor-b');
    });

    await waitFor(() =>
      expect(listOrdersMock).toHaveBeenCalledWith(expect.objectContaining({ vendorId: 'demo-vendor-b' })),
    );
    expect(screen.queryByText('Shipment label created and opened.')).not.toBeInTheDocument();

    openMock.mockRestore();
  });

  it('does not restore stale shipment feedback when a label action finishes after vendor context changes', async () => {
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
    setCurrentVendorId('demo-vendor-a');
    const vendorAOrder = {
      ...orderDetail,
      id: 'ORD-A-1002',
      status: 'Pending',
      fulfillmentStatus: 'Pending',
      shippingStatus: 'Awaiting Shipment',
      fulfillmentActionState: 'awaiting_shipment',
      fulfilledAt: undefined,
      shipmentCreatedAt: undefined,
      shipmentUpdatedAt: undefined,
      trackingNumber: undefined,
      trackingUrl: undefined,
      carrier: undefined,
    };
    const vendorBOrder = {
      ...orderDetail,
      id: 'ORD-B-2001',
      originalVendorId: 'demo-vendor-b',
      assignedVendorId: 'demo-vendor-b',
      vendorId: 'demo-vendor-b',
      sourceShopifyOrderId: 'gid://shopify/Order/2001',
      sourceShopifyOrderNumber: '#2001',
      customer: 'Vendor B Customer',
    };
    const createdShipment = {
      ...shipmentExecution,
      id: 'shipment-created',
      allocationId: 'ORD-A-1002',
      vendorId: 'demo-vendor-a',
      labelUrl: 'https://labels.example/new-label.pdf',
    };
    const shipmentResult = deferred<ShipmentExecution>();
    const openMock = vi.spyOn(globalThis, 'open').mockImplementation(() => null);
    listOrdersMock.mockImplementation(async (options) => (
      options?.vendorId === 'demo-vendor-b' ? [toSummary(vendorBOrder)] : [toSummary(vendorAOrder)]
    ));
    getOrderMock.mockImplementation(async (orderId) => {
      if (orderId === 'ORD-B-2001') {
        return vendorBOrder;
      }
      return vendorAOrder;
    });
    createShipmentExecutionMock.mockReturnValue(shipmentResult.promise);

    renderOrdersPage();

    const labelButton = await screen.findByRole('button', { name: /Kargo etiketi yazdır/i });
    await userEvent.click(labelButton);

    await act(async () => {
      setCurrentVendorId('demo-vendor-b');
    });
    await waitFor(() =>
      expect(listOrdersMock).toHaveBeenCalledWith(expect.objectContaining({ vendorId: 'demo-vendor-b' })),
    );

    await act(async () => {
      shipmentResult.resolve(createdShipment);
      await shipmentResult.promise;
    });

    await waitFor(() =>
      expect(openMock).toHaveBeenCalledWith('https://labels.example/new-label.pdf', '_blank', 'noopener,noreferrer'),
    );
    expect(screen.queryByText('Shipment label created and opened.')).not.toBeInTheDocument();

    await act(async () => {
      setCurrentVendorId('demo-vendor-a');
    });
    await waitFor(() =>
      expect(listOrdersMock).toHaveBeenCalledWith(expect.objectContaining({ vendorId: 'demo-vendor-a' })),
    );
    expect(screen.queryByText('Shipment label created and opened.')).not.toBeInTheDocument();

    openMock.mockRestore();
  });

  it('uses the existing shipment retry flow when label creation previously failed', async () => {
    const failedShipment = {
      ...shipmentExecution,
      id: 'shipment-failed',
      providerShipmentId: null,
      trackingNumber: null,
      trackingUrl: null,
      labelUrl: null,
      shipmentStatus: 'failed' as const,
    };
    const retriedShipment = {
      ...shipmentExecution,
      id: 'shipment-retried',
      labelUrl: 'https://labels.example/retried-label.pdf',
    };
    const detailWithFailedShipment = {
      ...orderDetail,
      shipmentExecution: failedShipment,
    };
    const openMock = vi.spyOn(globalThis, 'open').mockImplementation(() => null);
    listOrdersMock.mockResolvedValue([toSummary(detailWithFailedShipment)]);
    getOrderMock.mockResolvedValue(detailWithFailedShipment);
    retryFailedShipmentExecutionMock.mockResolvedValue(retriedShipment);

    renderOrdersPage();

    const labelButton = await screen.findByRole('button', { name: /Tekrar dene/i });
    await userEvent.click(labelButton);

    await waitFor(() =>
      expect(retryFailedShipmentExecutionMock).toHaveBeenCalledWith('shipment-failed', expect.objectContaining({ vendorId: 'demo-vendor-a' })),
    );
    expect(createShipmentExecutionMock).not.toHaveBeenCalled();
    expect(openMock).toHaveBeenCalledWith('https://labels.example/retried-label.pdf', '_blank', 'noopener,noreferrer');

    openMock.mockRestore();
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

    expect(screen.getByRole('heading', { name: 'Orders' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Order' })).toBeInTheDocument();
    expect(screen.getAllByRole('row').length).toBeGreaterThan(1);
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
