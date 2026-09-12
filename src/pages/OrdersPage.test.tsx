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
  VendorOrdersWorkflow,
  VendorOrdersWorkflowSummary,
} from '../features/orders/api';
import { setCurrentUser, setCurrentVendorId, setSession, setToken } from '../lib/auth';
import { formatDateTime } from '../services/real/formatting';
import { getRejectUnavailableReason } from '../lib/rejectEligibility';

const listOrdersMock = vi.fn<(options?: {
  vendorId?: string | null;
  workflow?: VendorOrdersWorkflow;
  limit?: number;
  offset?: number;
}) => Promise<OrderSummary[]>>();
const getVendorOrdersWorkflowSummaryMock = vi.fn<
  (options?: { vendorId?: string | null }) => Promise<VendorOrdersWorkflowSummary>
>();
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
    listOrders: (options?: {
      vendorId?: string | null;
      workflow?: VendorOrdersWorkflow;
      limit?: number;
      offset?: number;
    }) => listOrdersMock(options),
    getVendorOrdersWorkflowSummary: (options?: { vendorId?: string | null }) =>
      getVendorOrdersWorkflowSummaryMock(options),
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
  operationalActionability: { actionable: true, reason: null },
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
    getVendorOrdersWorkflowSummaryMock.mockReset();
    getVendorOrdersWorkflowSummaryMock.mockResolvedValue({
      all: 1,
      awaitingShipment: 0,
      shipmentReview: 0,
      trackingMissing: 0,
    });
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
    const allOrdersTab = within(workflowTabs).getByRole('button', { name: /All orders/i });
    expect(allOrdersTab).toHaveClass('is-active');
    expect(allOrdersTab).toHaveTextContent('1');
    expect(within(workflowTabs).queryByText('Full order list')).not.toBeInTheDocument();
    const trackingMissingTab = within(workflowTabs).getByRole('button', { name: /Tracking missing/i });
    expect(trackingMissingTab).toHaveTextContent('0');
    expect(within(workflowTabs).queryByText('Needs tracking evidence')).not.toBeInTheDocument();
    expect(within(workflowTabs).getByText('Awaiting shipment')).toBeInTheDocument();
    expect(within(workflowTabs).getByText('Needs admin resolution')).toBeInTheDocument();
    expect(within(workflowTabs).getByText('Stale fulfillment')).toBeInTheDocument();
    expect(screen.queryByLabelText('Orders operational metrics')).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search order, customer, tracking, carrier...')).toBeInTheDocument();
    expect(screen.getAllByRole('combobox')).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Reset filters' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Filters' })).not.toBeInTheDocument();
    expect(screen.getAllByText('Tracking').length).toBeGreaterThan(0);
    expect(screen.getAllByText('DHL / TRK-A-1002').length).toBeGreaterThan(0);
    expect(screen.getAllByText('1 line items').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'View details' })).toHaveAttribute('href', '/orders/ORD-A-1002');
    expect(await screen.findByText('Barcode gateway license')).toBeInTheDocument();
    expect(screen.getByLabelText('Workflow action guidance')).toHaveTextContent('Monitor delivery evidence');
    expect(screen.getByRole('img', { name: 'Barcode gateway license product image' })).toHaveAttribute(
      'src',
      'https://cdn.example.com/barcode-license.png',
    );
    expect(screen.queryByText('0 attention')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'View' })).not.toBeInTheDocument();
    const orderRow = screen.getByRole('button', { name: /#1002/ });
    expect(within(orderRow).getByText('Acme Supply Co.')).toBeInTheDocument();
    expect(within(orderRow).getByText('Shopify')).toBeInTheDocument();
    expect(within(orderRow).queryByText('Demo Vendor A · Shopify')).not.toBeInTheDocument();
    expect(within(orderRow).queryByText('Demo Vendor A')).not.toBeInTheDocument();
    expect(within(orderRow).queryByText('Tracking visible')).not.toBeInTheDocument();
    expect(within(orderRow).getByText('DHL / TRK-A-1002')).toBeInTheDocument();
  });

  it('removes fixed identity and source microcopy from vendor rows without changing row data or selection', async () => {
    setVendorUser();
    const secondOrder = {
      ...orderDetail,
      id: 'ORD-A-1003',
      sourceShopifyOrderId: 'gid://shopify/Order/1003',
      sourceShopifyOrderNumber: '#1003',
      customer: 'Second Customer',
      date: '2026-05-07T09:20:00Z',
    };
    listOrdersMock.mockResolvedValue([toSummary(orderDetail), toSummary(secondOrder)]);
    getOrderMock.mockImplementation(async (orderId) => (orderId === secondOrder.id ? secondOrder : orderDetail));

    renderOrdersPage();

    const orderRow = await screen.findByRole('button', { name: /#1002/ });
    expect(within(orderRow).getByText('#1002')).toBeInTheDocument();
    expect(within(orderRow).queryByText('Customer hidden for vendor scope')).not.toBeInTheDocument();
    expect(within(orderRow).queryByText('Demo Vendor A · Shopify')).not.toBeInTheDocument();
    expect(within(orderRow).queryByText('Shopify')).not.toBeInTheDocument();
    expect(within(orderRow).getByText('Fulfilled')).toBeInTheDocument();
    expect(within(orderRow).queryByText('Tracking visible')).not.toBeInTheDocument();
    expect(within(orderRow).getByText('Tracking synced')).toBeInTheDocument();
    expect(within(orderRow).getByText('DHL / TRK-A-1002')).toBeInTheDocument();
    expect(within(orderRow).getByText('$1,950.00')).toBeInTheDocument();
    expect(within(orderRow).getByText('1 line items')).toBeInTheDocument();
    const updatedValue = orderRow.querySelector('.orders-table-updated-value');
    const expectedUpdatedDate = formatDateTime(orderDetail.shipmentUpdatedAt, { month: 'short', day: 'numeric' }, 'Not synced');
    const expectedUpdatedTime = formatDateTime(orderDetail.shipmentUpdatedAt, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }, 'Not synced');
    expect(updatedValue).toHaveTextContent(`${expectedUpdatedDate} · ${expectedUpdatedTime}`);
    expect(updatedValue).not.toHaveTextContent('2026');
    expect(updatedValue).not.toHaveTextContent(/\b(?:AM|PM)\b/);
    const openDetail = within(orderRow).getByRole('link', { name: 'Open detail' });
    expect(openDetail).toHaveAttribute('href', '/orders/ORD-A-1002');
    expect(openDetail).toHaveClass('button', 'orders-row-detail-action');
    expect(openDetail).not.toHaveClass('button-primary');
    const sidebarViewDetails = screen.getByRole('link', { name: 'View details' });
    expect(sidebarViewDetails).toHaveClass('button-secondary');
    expect(sidebarViewDetails).not.toHaveClass('orders-row-detail-action');

    const secondRow = screen.getByRole('button', { name: /#1003/ });
    await userEvent.click(secondRow);
    expect(secondRow).toHaveClass('op-row-selected');
    expect(await screen.findByRole('heading', { name: '#1003' })).toBeInTheDocument();
    expect(getOrderMock).toHaveBeenCalledWith('ORD-A-1003', expect.objectContaining({ vendorId: 'demo-vendor-a' }));
  });

  it('formats only the Orders table Updated value compactly while preserving timestamp precedence and fallback', async () => {
    const shipmentUpdatedOrder = buildSummary({
      id: 'ORD-A-1101',
      sourceShopifyOrderNumber: '#1101',
      shipmentUpdatedAt: '2026-08-13T13:55:00',
      fulfilledAt: '2026-08-12T10:10:00',
      date: '2026-08-11T09:09:00',
    });
    const fulfilledOrder = buildSummary({
      id: 'ORD-A-1102',
      sourceShopifyOrderNumber: '#1102',
      shipmentUpdatedAt: undefined,
      fulfilledAt: '2026-09-03T12:04:00',
      date: '2026-09-02T09:09:00',
    });
    const createdOrder = buildSummary({
      id: 'ORD-A-1103',
      sourceShopifyOrderNumber: '#1103',
      shipmentUpdatedAt: undefined,
      fulfilledAt: undefined,
      date: '2026-12-01T08:07:00',
    });
    const invalidOrder = buildSummary({
      id: 'ORD-A-1104',
      sourceShopifyOrderNumber: '#1104',
      shipmentUpdatedAt: undefined,
      fulfilledAt: undefined,
      date: 'invalid-date',
    });
    const missingOrder = buildSummary({
      id: 'ORD-A-1105',
      sourceShopifyOrderNumber: '#1105',
      shipmentUpdatedAt: undefined,
      fulfilledAt: undefined,
      date: undefined as unknown as OrderSummary['date'],
    });
    listOrdersMock.mockResolvedValue([shipmentUpdatedOrder, fulfilledOrder, createdOrder, invalidOrder, missingOrder]);
    getOrderMock.mockResolvedValue(orderDetail);

    renderOrdersPage();

    const shipmentUpdatedRow = await screen.findByRole('button', { name: /#1101/ });
    const fulfilledRow = screen.getByRole('button', { name: /#1102/ });
    const createdRow = screen.getByRole('button', { name: /#1103/ });
    const invalidRow = screen.getByRole('button', { name: /#1104/ });
    const missingRow = screen.getByRole('button', { name: /#1105/ });

    expect(shipmentUpdatedRow.querySelector('.orders-table-updated-value')).toHaveTextContent('Aug 13 · 13:55');
    expect(fulfilledRow.querySelector('.orders-table-updated-value')).toHaveTextContent('Sep 3 · 12:04');
    expect(createdRow.querySelector('.orders-table-updated-value')).toHaveTextContent('Dec 1 · 08:07');
    expect(invalidRow.querySelector('.orders-table-updated-value')).toHaveTextContent('Not synced');
    expect(missingRow.querySelector('.orders-table-updated-value')).toHaveTextContent('Not synced');
    expect(shipmentUpdatedRow.querySelector('.orders-table-updated-value')).not.toHaveTextContent(/2026|\b(?:AM|PM)\b/);
    expect(shipmentUpdatedRow.querySelector('.orders-table-updated-value')?.parentElement?.querySelector('small')).toBeNull();
    expect(within(shipmentUpdatedRow).getByText('Acme Supply Co.')).toBeInTheDocument();
    expect(within(shipmentUpdatedRow).getByText('Shopify')).toBeInTheDocument();
    expect(within(shipmentUpdatedRow).queryByText('Demo Vendor A · Shopify')).not.toBeInTheDocument();
    expect(within(shipmentUpdatedRow).getByText('Fulfilled')).toBeInTheDocument();
    expect(within(shipmentUpdatedRow).getByText('DHL / TRK-A-1002')).toBeInTheDocument();
    expect(within(shipmentUpdatedRow).getByText('$1,950.00')).toBeInTheDocument();
    expect(within(shipmentUpdatedRow).getByRole('link', { name: 'Open detail' })).toHaveAttribute('href', '/orders/ORD-A-1101');
  });

  it('keeps vendor scope in the page header without repeating it in the selected-order sidebar header', async () => {
    setVendorUser();
    listOrdersMock.mockResolvedValue([toSummary(orderDetail)]);
    getOrderMock.mockResolvedValue(orderDetail);

    const { container } = renderOrdersPage();

    expect(await screen.findByRole('heading', { name: '#1002' })).toBeInTheDocument();
    const pageHeader = container.querySelector('.orders-compact-header');
    const sidebar = container.querySelector('.op-side-panel');
    const sidebarHeader = sidebar?.querySelector('.op-side-panel-header');
    expect(pageHeader).not.toBeNull();
    expect(sidebar).not.toBeNull();
    expect(sidebarHeader).not.toBeNull();
    expect(within(pageHeader as HTMLElement).getByText('Demo Vendor A')).toBeInTheDocument();
    expect(within(sidebarHeader as HTMLElement).queryByText('Demo Vendor A')).not.toBeInTheDocument();
    expect(within(sidebarHeader as HTMLElement).getByRole('heading', { name: '#1002' })).toBeInTheDocument();
    expect(within(sidebarHeader as HTMLElement).getByRole('link', { name: 'View details' })).toHaveAttribute(
      'href',
      '/orders/ORD-A-1002',
    );
    expect(within(sidebar as HTMLElement).getByText('Operational Status')).toBeInTheDocument();
    expect(within(sidebar as HTMLElement).getByRole('heading', { name: 'Shipment' })).toBeInTheDocument();
    expect(within(sidebar as HTMLElement).getByLabelText('Smart label action')).toBeInTheDocument();
  });

  it.each(['admin', 'support', 'finance'] as const)(
    'preserves the selected-order sidebar vendor eyebrow for %s users',
    async (role) => {
      setCurrentUser({
        email: `${role}@demo.com`,
        name: `Demo ${role}`,
        role,
        vendorAccess: ['demo-vendor-a'],
        vendorDetails: [{ vendorId: 'demo-vendor-a', vendorName: 'Demo Vendor A' }],
        canSwitchVendors: false,
        defaultVendorId: 'demo-vendor-a',
      });
      listOrdersMock.mockResolvedValue([toSummary(orderDetail)]);
      getOrderMock.mockResolvedValue(orderDetail);

      const { container } = renderOrdersPage();

      expect(await screen.findByRole('heading', { name: '#1002' })).toBeInTheDocument();
      const sidebarHeader = container.querySelector('.op-side-panel-header');
      expect(sidebarHeader).not.toBeNull();
      expect(within(sidebarHeader as HTMLElement).getByText('Demo Vendor A')).toBeInTheDocument();
      const orderRow = screen.getByRole('button', { name: /#1002/ });
      expect(within(orderRow).getByText('Shopify')).toBeInTheDocument();
      expect(within(orderRow).queryByText('Demo Vendor A · Shopify')).not.toBeInTheDocument();
      expect(within(orderRow).queryByText('Demo Vendor A')).not.toBeInTheDocument();
      expect(within(sidebarHeader as HTMLElement).getByRole('link', { name: 'View details' })).toHaveAttribute(
        'href',
        '/orders/ORD-A-1002',
      );
    },
  );

  it('removes all secondary copy from status cells while preserving primary and tracking content', async () => {
    setVendorUser();
    const inFlowOrder = buildAwaitingRejectableOrder({
      id: 'ORD-A-1004',
      sourceShopifyOrderNumber: '#1004',
      shippingStatus: 'Label Created',
      trackingNumber: 'TRK-A-1004',
      trackingUrl: 'https://tracking.example/TRK-A-1004',
      carrier: 'DHL',
      date: '2026-05-07T09:20:00Z',
    });
    const awaitingOrder = buildAwaitingRejectableOrder({
      id: 'ORD-A-1005',
      sourceShopifyOrderNumber: '#1005',
      date: '2026-05-06T09:20:00Z',
    });
    const blockedOrder = buildAwaitingRejectableOrder({
      id: 'ORD-A-1006',
      sourceShopifyOrderNumber: '#1006',
      allocationStatus: 'vendor_blocked',
      reassignmentRequired: true,
      cancellationReason: 'OUT_OF_STOCK',
      fulfillmentActionAvailable: false,
      date: '2026-05-05T09:20:00Z',
    });
    const cleanCancelledOrder = buildAwaitingRejectableOrder({
      id: 'ORD-A-1007',
      sourceShopifyOrderNumber: '#1007',
      status: 'Cancelled',
      isCancelled: true,
      cancelledAt: '2026-05-04T09:20:00Z',
      fulfillmentStatus: 'Not Required',
      shippingStatus: 'Not Required',
      fulfillmentActionState: 'not_required',
      fulfillmentActionAvailable: false,
      date: '2026-05-04T09:20:00Z',
    });
    const cancellationConflictOrder: OrderDetail = {
      ...orderDetail,
      id: 'ORD-A-1008',
      sourceShopifyOrderNumber: '#1008',
      status: 'Cancelled',
      isCancelled: true,
      isCancellationConflict: true,
      cancelledAt: '2026-05-03T09:20:00Z',
      fulfillmentActionAvailable: false,
      date: '2026-05-03T09:20:00Z',
    };
    const orders = [orderDetail, inFlowOrder, awaitingOrder, blockedOrder, cleanCancelledOrder, cancellationConflictOrder];
    listOrdersMock.mockResolvedValue(orders.map(toSummary));
    getOrderMock.mockImplementation(async (orderId) => orders.find((order) => order.id === orderId) ?? orderDetail);

    renderOrdersPage();

    const fulfilledRow = await screen.findByRole('button', { name: /#1002/ });
    expect(within(fulfilledRow).getByText('Fulfilled')).toBeInTheDocument();
    expect(fulfilledRow.querySelector('.orders-table-status-cell small')).toBeNull();
    expect(within(fulfilledRow).queryByText('Tracking visible')).not.toBeInTheDocument();
    expect(within(fulfilledRow).getByText('Tracking synced')).toBeInTheDocument();
    expect(within(fulfilledRow).getByText('DHL / TRK-A-1002')).toBeInTheDocument();

    const inFlowRow = screen.getByRole('button', { name: /#1004/ });
    expect(within(inFlowRow).getByText('In flow')).toBeInTheDocument();
    expect(inFlowRow.querySelector('.orders-table-status-cell small')).toBeNull();
    expect(within(inFlowRow).queryByText('Tracking visible')).not.toBeInTheDocument();
    expect(within(inFlowRow).getByText('Tracking synced')).toBeInTheDocument();
    expect(within(inFlowRow).getByText('DHL / TRK-A-1004')).toBeInTheDocument();

    const awaitingRow = screen.getByRole('button', { name: /#1005/ });
    expect(within(awaitingRow).getByText('Awaiting shipment')).toBeInTheDocument();
    expect(awaitingRow.querySelector('.orders-table-status-cell small')).toBeNull();
    expect(within(awaitingRow).queryByText('Tracking pending')).not.toBeInTheDocument();
    expect(within(awaitingRow).getByText('No tracking yet')).toBeInTheDocument();

    const blockedRow = screen.getByRole('button', { name: /#1006/ });
    expect(within(blockedRow).getByText('Vendor Blocked')).toBeInTheDocument();
    const blockedStatusCell = blockedRow.querySelector('.orders-table-status-cell');
    expect(blockedStatusCell).not.toBeNull();
    expect(within(blockedStatusCell as HTMLElement).queryByText('Awaiting admin resolution')).not.toBeInTheDocument();
    expect(blockedStatusCell?.querySelector('small')).toBeNull();
    const blockedTrackingCell = blockedRow.querySelector('.orders-table-shipping-cell');
    expect(blockedTrackingCell).not.toBeNull();
    expect(within(blockedTrackingCell as HTMLElement).getByText('Awaiting admin resolution')).toBeInTheDocument();
    expect(within(blockedTrackingCell as HTMLElement).queryByText('Vendor rejected allocation.')).not.toBeInTheDocument();

    const cancelledRow = screen.getByRole('button', { name: /#1007/ });
    expect(within(cancelledRow).getByText('Cancelled')).toBeInTheDocument();
    const cancelledStatusCell = cancelledRow.querySelector('.orders-table-status-cell');
    expect(cancelledStatusCell).not.toBeNull();
    expect(within(cancelledStatusCell as HTMLElement).queryByText('Fulfillment not required')).not.toBeInTheDocument();
    expect(cancelledStatusCell?.querySelector('small')).toBeNull();
    const cancelledTrackingCell = cancelledRow.querySelector('.orders-table-shipping-cell');
    expect(cancelledTrackingCell).not.toBeNull();
    expect(within(cancelledTrackingCell as HTMLElement).getByText('Shipment not required')).toBeInTheDocument();
    expect(within(cancelledTrackingCell as HTMLElement).queryByText('Shopify order cancelled.')).not.toBeInTheDocument();

    const cancellationConflictRow = screen.getByRole('button', { name: /#1008/ });
    expect(within(cancellationConflictRow).getByText('Cancelled')).toBeInTheDocument();
    const cancellationConflictStatusCell = cancellationConflictRow.querySelector('.orders-table-status-cell');
    expect(cancellationConflictStatusCell).not.toBeNull();
    expect(within(cancellationConflictStatusCell as HTMLElement).queryByText('Review existing fulfillment evidence')).not.toBeInTheDocument();
    expect(cancellationConflictStatusCell?.querySelector('small')).toBeNull();
    const cancellationConflictTrackingCell = cancellationConflictRow.querySelector('.orders-table-shipping-cell');
    expect(cancellationConflictTrackingCell).not.toBeNull();
    expect(within(cancellationConflictTrackingCell as HTMLElement).getByText('Review required')).toBeInTheDocument();
    expect(within(cancellationConflictTrackingCell as HTMLElement).queryByText('Delivered')).not.toBeInTheDocument();
    expect(within(cancellationConflictTrackingCell as HTMLElement).queryByText('DHL / TRK-A-1002')).not.toBeInTheDocument();
    expect(within(cancellationConflictTrackingCell as HTMLElement).queryByText('Review existing fulfillment evidence')).not.toBeInTheDocument();

    expect(screen.getAllByRole('button', { name: /#100[245678]/ })).toHaveLength(6);
    expect(screen.getByLabelText('Orders workflow tabs')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search order, customer, tracking, carrier...')).toBeInTheDocument();
  });

  it('keeps unresolved vendor tracking primaries and concrete evidence unchanged', async () => {
    setVendorUser();
    const shopifySyncPendingOrder = buildAwaitingRejectableOrder({
      id: 'ORD-A-1009',
      sourceShopifyOrderNumber: '#1009',
      shippingStatus: 'Label Created',
      trackingNumber: 'TRK-A-1009',
      trackingUrl: undefined,
      carrier: 'DHL',
    });
    const providerPendingOrder = buildAwaitingRejectableOrder({
      id: 'ORD-A-1010',
      sourceShopifyOrderNumber: '#1010',
      shippingStatus: 'Label Created',
    });
    const reassignmentOrder = buildAwaitingRejectableOrder({
      id: 'ORD-A-1011',
      sourceShopifyOrderNumber: '#1011',
      allocationStatus: 'pending_reassignment',
      reassignmentRequired: true,
    });
    const orders = [shopifySyncPendingOrder, providerPendingOrder, reassignmentOrder];
    listOrdersMock.mockResolvedValue(orders.map(toSummary));
    getOrderMock.mockImplementation(async (orderId) => orders.find((order) => order.id === orderId) ?? shopifySyncPendingOrder);

    renderOrdersPage();

    const syncPendingRow = await screen.findByRole('button', { name: /#1009/ });
    expect(within(syncPendingRow).getByText('Shopify sync pending')).toBeInTheDocument();
    expect(within(syncPendingRow).getByText('DHL / TRK-A-1009')).toBeInTheDocument();

    const providerPendingRow = screen.getByRole('button', { name: /#1010/ });
    expect(within(providerPendingRow).getByText('Provider pending')).toBeInTheDocument();

    const reassignmentRow = screen.getByRole('button', { name: /#1011/ });
    expect(within(reassignmentRow).getByText('Needs review')).toBeInTheDocument();
  });

  it('keeps pending reassignment in Status across shipment evidence without changing Tracking', async () => {
    const pendingOrders = [
      buildAwaitingRejectableOrder({
        id: 'allocation-pending-tracking-url',
        sourceShopifyOrderNumber: '#1140',
        allocationStatus: 'pending_reassignment',
        reassignmentRequired: true,
        trackingNumber: 'TRK-1140',
        trackingUrl: 'https://tracking.example/TRK-1140',
        carrier: 'DHL',
      }),
      buildAwaitingRejectableOrder({
        id: 'allocation-pending-tracking-number',
        sourceShopifyOrderNumber: '#1141',
        allocationStatus: 'pending_reassignment',
        reassignmentRequired: true,
        trackingNumber: 'TRK-1141',
      }),
      buildAwaitingRejectableOrder({
        id: 'allocation-pending-carrier',
        sourceShopifyOrderNumber: '#1142',
        allocationStatus: 'pending_reassignment',
        reassignmentRequired: true,
        carrier: 'DHL',
      }),
      buildAwaitingRejectableOrder({
        id: 'allocation-pending-fulfilled',
        sourceShopifyOrderNumber: '#1143',
        allocationStatus: 'pending_reassignment',
        reassignmentRequired: true,
        fulfillmentStatus: 'Fulfilled',
        shippingStatus: 'In Transit',
      }),
      buildAwaitingRejectableOrder({
        id: 'allocation-pending-fulfilled-tracked',
        sourceShopifyOrderNumber: '#1144',
        allocationStatus: 'pending_reassignment',
        reassignmentRequired: true,
        fulfillmentStatus: 'Fulfilled',
        shippingStatus: 'Delivered',
        trackingNumber: 'TRK-1144',
        trackingUrl: 'https://tracking.example/TRK-1144',
        carrier: 'DHL',
      }),
      buildAwaitingRejectableOrder({
        id: 'allocation-pending-generic',
        sourceShopifyOrderNumber: '#1145',
        allocationStatus: 'pending_reassignment',
        reassignmentRequired: true,
        shippingStatus: 'Label Created',
      }),
    ];
    listOrdersMock.mockResolvedValue(pendingOrders.map(toSummary));
    getOrderMock.mockImplementation(async (orderId) => pendingOrders.find((order) => order.id === orderId) ?? pendingOrders[0]);

    renderOrdersPage();

    for (const orderNumber of ['#1140', '#1141', '#1142']) {
      const row = await screen.findByRole('button', { name: new RegExp(orderNumber) });
      const statusCell = row.querySelector('.orders-table-status-cell');
      const trackingCell = row.querySelector('.orders-table-shipping-cell');
      expect(statusCell).not.toBeNull();
      expect(trackingCell).not.toBeNull();
      expect(within(statusCell as HTMLElement).getByText('Awaiting shipment')).toBeInTheDocument();
      expect(within(statusCell as HTMLElement).queryByText('Pending Reassignment')).not.toBeInTheDocument();
      expect(statusCell?.querySelector('small')).toBeNull();
      expect(within(statusCell as HTMLElement).queryByText('Tracking visible')).not.toBeInTheDocument();
      expect(within(trackingCell as HTMLElement).getByText('Needs review')).toBeInTheDocument();
    }

    for (const orderNumber of ['#1143', '#1144']) {
      const row = screen.getByRole('button', { name: new RegExp(orderNumber) });
      const statusCell = row.querySelector('.orders-table-status-cell');
      const trackingCell = row.querySelector('.orders-table-shipping-cell');
      expect(statusCell).not.toBeNull();
      expect(trackingCell).not.toBeNull();
      expect(within(statusCell as HTMLElement).getByText('Fulfilled')).toBeInTheDocument();
      expect(within(statusCell as HTMLElement).queryByText('Pending Reassignment')).not.toBeInTheDocument();
      expect(statusCell?.querySelector('small')).toBeNull();
      expect(within(trackingCell as HTMLElement).getByText('Needs review')).toBeInTheDocument();
    }

    const genericRow = screen.getByRole('button', { name: /#1145/ });
    const genericStatusCell = genericRow.querySelector('.orders-table-status-cell');
    const genericTrackingCell = genericRow.querySelector('.orders-table-shipping-cell');
    expect(genericStatusCell).not.toBeNull();
    expect(genericTrackingCell).not.toBeNull();
    expect(within(genericStatusCell as HTMLElement).getByText('Reassignment needed')).toBeInTheDocument();
    expect(within(genericStatusCell as HTMLElement).queryByText('Pending Reassignment')).not.toBeInTheDocument();
    expect(within(genericTrackingCell as HTMLElement).getByText('Needs review')).toBeInTheDocument();
  });

  it.each(['admin', 'vendor', 'support', 'finance'] as const)(
    'renders primary-only status cells for %s while preserving tracking content',
    async (role) => {
      setCurrentUser({
        email: `${role}@demo.com`,
        name: `Demo ${role}`,
        role,
        vendorAccess: ['demo-vendor-a'],
        vendorDetails: [{ vendorId: 'demo-vendor-a', vendorName: 'Demo Vendor A' }],
        canSwitchVendors: role === 'admin',
        defaultVendorId: 'demo-vendor-a',
      });
      const terminalOrder = buildAwaitingRejectableOrder({
        id: 'allocation-1128',
        sourceShopifyOrderNumber: '#1128',
        operationalActionability: {
          actionable: false,
          reason: 'ALLOCATION_REFUND_TERMINAL',
        },
        fulfillmentActionAvailable: false,
      });
      const cleanCancelledOrder = buildAwaitingRejectableOrder({
        id: 'allocation-1129',
        sourceShopifyOrderNumber: '#1129',
        status: 'Cancelled',
        isCancelled: true,
        cancelledAt: '2026-05-04T09:20:00Z',
        fulfillmentStatus: 'Not Required',
        shippingStatus: 'Not Required',
        fulfillmentActionState: 'not_required',
        fulfillmentActionAvailable: false,
      });
      const cancellationConflictOrder = buildAwaitingRejectableOrder({
        id: 'allocation-1130',
        sourceShopifyOrderNumber: '#1130',
        status: 'Cancelled',
        isCancelled: true,
        isCancellationConflict: true,
        cancelledAt: '2026-05-03T09:20:00Z',
        shippingStatus: 'Delivered',
        fulfillmentActionAvailable: false,
      });
      const blockedOrder = buildAwaitingRejectableOrder({
        id: 'allocation-1131',
        sourceShopifyOrderNumber: '#1131',
        allocationStatus: 'vendor_blocked',
        reassignmentRequired: true,
        cancellationReason: 'OUT_OF_STOCK',
        fulfillmentActionAvailable: false,
      });
      const reassignmentOrder = buildAwaitingRejectableOrder({
        id: 'allocation-1132',
        sourceShopifyOrderNumber: '#1132',
        allocationStatus: 'pending_reassignment',
        reassignmentRequired: true,
      });
      const orders = [terminalOrder, cleanCancelledOrder, cancellationConflictOrder, blockedOrder, reassignmentOrder];
      listOrdersMock.mockResolvedValue(orders.map(toSummary));
      getOrderMock.mockImplementation(async (orderId) => orders.find((order) => order.id === orderId) ?? terminalOrder);

      const { container } = renderOrdersPage();

      expect(container.querySelectorAll('.orders-table-status-cell small')).toHaveLength(0);

      const terminalRow = await screen.findByRole('button', { name: /#1128/ });
      const terminalStatusCell = terminalRow.querySelector('.orders-table-status-cell');
      const terminalTrackingCell = terminalRow.querySelector('.orders-table-shipping-cell');
      expect(terminalStatusCell).not.toBeNull();
      expect(terminalTrackingCell).not.toBeNull();
      expect(within(terminalStatusCell as HTMLElement).getByText('Refunded')).toBeInTheDocument();
      expect(within(terminalStatusCell as HTMLElement).queryByText('Fulfillment not required')).not.toBeInTheDocument();
      expect(terminalStatusCell?.querySelector('small')).toBeNull();
      expect(within(terminalTrackingCell as HTMLElement).getByText('Fulfillment not required')).toBeInTheDocument();
      expect(within(terminalTrackingCell as HTMLElement).queryByText('Refund completed for this allocation.')).not.toBeInTheDocument();

      const cancelledRow = screen.getByRole('button', { name: /#1129/ });
      const cancelledStatusCell = cancelledRow.querySelector('.orders-table-status-cell');
      const cancelledTrackingCell = cancelledRow.querySelector('.orders-table-shipping-cell');
      expect(cancelledStatusCell).not.toBeNull();
      expect(cancelledTrackingCell).not.toBeNull();
      expect(within(cancelledStatusCell as HTMLElement).getByText('Cancelled')).toBeInTheDocument();
      expect(within(cancelledStatusCell as HTMLElement).queryByText('Fulfillment not required')).not.toBeInTheDocument();
      expect(cancelledStatusCell?.querySelector('small')).toBeNull();
      expect(within(cancelledTrackingCell as HTMLElement).getByText('Shipment not required')).toBeInTheDocument();
      expect(within(cancelledTrackingCell as HTMLElement).queryByText('Shopify order cancelled.')).not.toBeInTheDocument();

      const conflictRow = screen.getByRole('button', { name: /#1130/ });
      const conflictStatusCell = conflictRow.querySelector('.orders-table-status-cell');
      const conflictTrackingCell = conflictRow.querySelector('.orders-table-shipping-cell');
      expect(conflictStatusCell).not.toBeNull();
      expect(conflictTrackingCell).not.toBeNull();
      expect(within(conflictStatusCell as HTMLElement).getByText('Cancelled')).toBeInTheDocument();
      expect(within(conflictStatusCell as HTMLElement).queryByText('Review existing fulfillment evidence')).not.toBeInTheDocument();
      expect(conflictStatusCell?.querySelector('small')).toBeNull();
      expect(within(conflictTrackingCell as HTMLElement).getByText('Review required')).toBeInTheDocument();
      expect(within(conflictTrackingCell as HTMLElement).queryByText('Delivered')).not.toBeInTheDocument();
      expect(within(conflictTrackingCell as HTMLElement).queryByText('DHL / TRK-A-1002')).not.toBeInTheDocument();
      expect(within(conflictTrackingCell as HTMLElement).queryByText('Tracking synced')).not.toBeInTheDocument();
      expect(within(conflictTrackingCell as HTMLElement).queryByText('Shopify sync pending')).not.toBeInTheDocument();
      expect(within(conflictTrackingCell as HTMLElement).queryByText('Review existing fulfillment evidence')).not.toBeInTheDocument();

      const blockedRow = screen.getByRole('button', { name: /#1131/ });
      const blockedStatusCell = blockedRow.querySelector('.orders-table-status-cell');
      const blockedTrackingCell = blockedRow.querySelector('.orders-table-shipping-cell');
      expect(blockedStatusCell).not.toBeNull();
      expect(blockedTrackingCell).not.toBeNull();
      expect(within(blockedStatusCell as HTMLElement).getByText('Vendor Blocked')).toBeInTheDocument();
      expect(within(blockedStatusCell as HTMLElement).queryByText('Awaiting admin resolution')).not.toBeInTheDocument();
      expect(blockedStatusCell?.querySelector('small')).toBeNull();
      expect(within(blockedTrackingCell as HTMLElement).getByText('Awaiting admin resolution')).toBeInTheDocument();
      expect(within(blockedTrackingCell as HTMLElement).queryByText('Vendor rejected allocation.')).not.toBeInTheDocument();

      const reassignmentRow = screen.getByRole('button', { name: /#1132/ });
      const reassignmentStatusCell = reassignmentRow.querySelector('.orders-table-status-cell');
      const reassignmentTrackingCell = reassignmentRow.querySelector('.orders-table-shipping-cell');
      expect(reassignmentStatusCell).not.toBeNull();
      expect(reassignmentTrackingCell).not.toBeNull();
      expect(within(reassignmentStatusCell as HTMLElement).getByText('Awaiting shipment')).toBeInTheDocument();
      expect(within(reassignmentStatusCell as HTMLElement).queryByText('Pending Reassignment')).not.toBeInTheDocument();
      expect(within(reassignmentStatusCell as HTMLElement).queryByText('Tracking pending')).not.toBeInTheDocument();
      expect(reassignmentStatusCell?.querySelector('small')).toBeNull();
      expect(within(reassignmentTrackingCell as HTMLElement).getByText('Needs review')).toBeInTheDocument();
    },
  );

  it.each([
    {
      name: 'awaiting shipment',
      shippingStatus: 'Awaiting Shipment' as const,
      trackingNumber: undefined,
      carrier: undefined,
    },
    {
      name: 'label created',
      shippingStatus: 'Label Created' as const,
      trackingNumber: undefined,
      carrier: undefined,
    },
    {
      name: 'in transit',
      shippingStatus: 'In Transit' as const,
      trackingNumber: undefined,
      carrier: undefined,
    },
    {
      name: 'delivered',
      shippingStatus: 'Delivered' as const,
      trackingNumber: undefined,
      carrier: undefined,
    },
    {
      name: 'tracking number',
      shippingStatus: 'Awaiting Shipment' as const,
      trackingNumber: 'TRACK-CONFLICT',
      carrier: undefined,
    },
    {
      name: 'carrier',
      shippingStatus: 'Awaiting Shipment' as const,
      trackingNumber: undefined,
      carrier: 'DHL',
    },
    {
      name: 'tracking number and carrier',
      shippingStatus: 'Awaiting Shipment' as const,
      trackingNumber: 'TRACK-CONFLICT',
      carrier: 'DHL',
    },
  ])('renders Review required for a cancellation conflict with $name', async ({ shippingStatus, trackingNumber, carrier }) => {
    setVendorUser();
    const cancellationConflictOrder = buildAwaitingRejectableOrder({
      id: 'allocation-conflict',
      sourceShopifyOrderNumber: '#1133',
      status: 'Cancelled',
      isCancelled: true,
      isCancellationConflict: true,
      cancelledAt: '2026-05-03T09:20:00Z',
      shippingStatus,
      trackingNumber,
      carrier,
      trackingUrl: trackingNumber ? 'https://tracking.example/TRACK-CONFLICT' : undefined,
      fulfillmentActionAvailable: false,
    });
    listOrdersMock.mockResolvedValue([toSummary(cancellationConflictOrder)]);
    getOrderMock.mockResolvedValue(cancellationConflictOrder);

    renderOrdersPage();

    const conflictRow = await screen.findByRole('button', { name: /#1133/ });
    const conflictStatusCell = conflictRow.querySelector('.orders-table-status-cell');
    const conflictTrackingCell = conflictRow.querySelector('.orders-table-shipping-cell');
    expect(conflictStatusCell).not.toBeNull();
    expect(conflictTrackingCell).not.toBeNull();
    expect(within(conflictStatusCell as HTMLElement).getByText('Cancelled')).toBeInTheDocument();
    expect(conflictStatusCell?.querySelector('small')).toBeNull();
    expect(within(conflictTrackingCell as HTMLElement).getByText('Review required')).toBeInTheDocument();
    expect(within(conflictTrackingCell as HTMLElement).queryByText('Awaiting Shipment')).not.toBeInTheDocument();
    expect(within(conflictTrackingCell as HTMLElement).queryByText('Label Created')).not.toBeInTheDocument();
    expect(within(conflictTrackingCell as HTMLElement).queryByText('In Transit')).not.toBeInTheDocument();
    expect(within(conflictTrackingCell as HTMLElement).queryByText('Delivered')).not.toBeInTheDocument();
    expect(within(conflictTrackingCell as HTMLElement).queryByText('TRACK-CONFLICT')).not.toBeInTheDocument();
    expect(within(conflictTrackingCell as HTMLElement).queryByText('DHL')).not.toBeInTheDocument();
    expect(within(conflictTrackingCell as HTMLElement).queryByText('DHL / TRACK-CONFLICT')).not.toBeInTheDocument();
    expect(within(conflictTrackingCell as HTMLElement).queryByText('Tracking synced')).not.toBeInTheDocument();
    expect(within(conflictTrackingCell as HTMLElement).queryByText('Shopify sync pending')).not.toBeInTheDocument();
    expect(conflictTrackingCell?.querySelector('small')).toBeNull();
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

  it('renders full Shopify cancellations as terminal and non-actionable', async () => {
    const cancelledOrder = buildAwaitingRejectableOrder({
      status: 'Cancelled',
      isCancelled: true,
      cancelledAt: '2026-07-11T10:00:00.000Z',
      cancelReason: 'customer',
      fulfillmentStatus: 'Not Required',
      shippingStatus: 'Not Required',
      fulfillmentActionState: 'not_required',
      fulfillmentActionAvailable: false,
      trackingNumber: undefined,
      carrier: undefined,
      orderSnapshot: {
        ...orderDetail.orderSnapshot!,
        financialStatus: 'voided',
        cancelledAt: '2026-07-11T10:00:00.000Z',
        cancelReason: 'customer',
      },
      lineItems: orderDetail.lineItems.map((item) => ({
        ...item,
        isCancelled: true,
        cancelledAt: '2026-07-11T10:00:00.000Z',
        cancelReason: 'customer',
        fulfillmentStatus: 'Not Required',
        shippingStatus: 'Not Required',
        fulfillmentActionState: 'not_required',
        fulfillmentActionAvailable: false,
      })),
    });
    listOrdersMock.mockResolvedValue([toSummary(cancelledOrder)]);
    getOrderMock.mockResolvedValue(cancelledOrder);

    renderOrdersPage();

    const axes = await screen.findByLabelText('Order status axes');
    expect(within(axes).getByText('Cancelled')).toBeInTheDocument();
    expect(screen.getAllByText('Fulfillment not required').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Shipment not required').length).toBeGreaterThan(0);
    const cancelledRow = screen.getByRole('button', { name: /#1002/ });
    const cancelledTrackingCell = cancelledRow.querySelector('.orders-table-shipping-cell');
    expect(cancelledTrackingCell).not.toBeNull();
    expect(within(cancelledTrackingCell as HTMLElement).queryByText('Shopify order cancelled.')).not.toBeInTheDocument();
    expect(screen.getByText('Tracking not required')).toBeInTheDocument();
    expect(screen.queryByText('Tracking pending')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Kargo etiketi yazdır/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Reject/i })).not.toBeInTheDocument();
  });

  it('preserves fulfillment evidence for cancelled orders that already have shipping history', async () => {
    const cancelledShippedOrder: OrderDetail = {
      ...orderDetail,
      status: 'Cancelled',
      isCancelled: true,
      isCancellationConflict: true,
      cancelledAt: '2026-07-11T10:00:00.000Z',
      cancelReason: 'customer',
      fulfillmentActionAvailable: false,
      orderSnapshot: {
        ...orderDetail.orderSnapshot!,
        financialStatus: 'voided',
        cancelledAt: '2026-07-11T10:00:00.000Z',
        cancelReason: 'customer',
      },
      lineItems: orderDetail.lineItems.map((item) => ({
        ...item,
        isCancelled: true,
        isCancellationConflict: true,
        cancelledAt: '2026-07-11T10:00:00.000Z',
        cancelReason: 'customer',
        fulfillmentActionAvailable: false,
      })),
    };
    listOrdersMock.mockResolvedValue([toSummary(cancelledShippedOrder)]);
    getOrderMock.mockResolvedValue(cancelledShippedOrder);

    renderOrdersPage();

    const axes = await screen.findByLabelText('Order status axes');
    expect(within(axes).getByText('Cancelled')).toBeInTheDocument();
    expect(screen.getAllByText('Review existing fulfillment evidence').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Delivered').length).toBeGreaterThan(0);
    expect(screen.getByText('DHL / TRK-A-1002')).toBeInTheDocument();
    const cancelledRow = screen.getByRole('button', { name: /#1002/ });
    const cancellationTrackingCell = cancelledRow.querySelector('.orders-table-shipping-cell');
    expect(cancellationTrackingCell).not.toBeNull();
    expect(within(cancellationTrackingCell as HTMLElement).getByText('Review required')).toBeInTheDocument();
    expect(within(cancellationTrackingCell as HTMLElement).queryByText('Delivered')).not.toBeInTheDocument();
    expect(within(cancellationTrackingCell as HTMLElement).queryByText('DHL / TRK-A-1002')).not.toBeInTheDocument();
    expect(within(cancellationTrackingCell as HTMLElement).queryByText('Review existing fulfillment evidence')).not.toBeInTheDocument();
    expect(screen.queryByText('Shipment not required')).not.toBeInTheDocument();
    expect(screen.queryByText('Tracking not required')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Kargo etiketi yazdır/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Reject/i })).not.toBeInTheDocument();
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
    listOrdersMock.mockImplementation(async (options) =>
      options?.workflow === 'awaitingShipment'
        ? [toSummary(awaitingShipmentOrder)]
        : [toSummary(awaitingShipmentOrder), toSummary(deliveredOrder)],
    );
    getOrderMock.mockImplementation(async (orderId) => (orderId === awaitingShipmentOrder.id ? awaitingShipmentOrder : deliveredOrder));

    renderOrdersPage(['/orders?workflow=awaiting-shipment']);

    const workflowTabs = await screen.findByLabelText('Orders workflow tabs');
    expect(workflowTabs).toHaveTextContent('Ready to ship');
    expect(within(workflowTabs).getByRole('button', { name: /Ready to ship/i })).toHaveClass('is-active');
    expect(listOrdersMock).toHaveBeenCalledWith(expect.objectContaining({
      vendorId: 'demo-vendor-a',
      workflow: 'awaitingShipment',
      limit: 100,
      offset: 0,
    }));
    expect((await screen.findAllByText('#1001')).length).toBeGreaterThan(0);
    expect(screen.queryByText('#1002')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Reset filters' }));

    expect(within(workflowTabs).getByRole('button', { name: /All orders/i })).toHaveClass('is-active');
    expect((await screen.findAllByText('#1002')).length).toBeGreaterThan(0);
  });

  it('preserves the local filter reset behavior under the Reset filters label', async () => {
    setVendorUser();
    listOrdersMock.mockResolvedValue([toSummary(orderDetail)]);
    getOrderMock.mockResolvedValue(orderDetail);

    renderOrdersPage();

    const searchInput = await screen.findByPlaceholderText(
      'Search order, customer, tracking, carrier...'
    );
    const [allocationFilter, fulfillmentFilter, shippingFilter] =
      screen.getAllByRole('combobox');
    const workflowTabs = screen.getByLabelText('Orders workflow tabs');
    const quickFilters = screen.getByLabelText('Order quick filters');
    const highValueQuickFilter = within(quickFilters).getByRole('button', {
      name: /High value/i,
    });

    await userEvent.type(searchInput, 'DHL');
    await userEvent.selectOptions(allocationFilter, 'fulfilled');
    await userEvent.selectOptions(fulfillmentFilter, 'Fulfilled');
    await userEvent.selectOptions(shippingFilter, 'Delivered');
    await userEvent.click(highValueQuickFilter);

    expect(searchInput).toHaveValue('DHL');
    expect(allocationFilter).toHaveValue('fulfilled');
    expect(fulfillmentFilter).toHaveValue('Fulfilled');
    expect(shippingFilter).toHaveValue('Delivered');
    expect(highValueQuickFilter).toHaveClass('is-active');

    await userEvent.click(screen.getByRole('button', { name: 'Reset filters' }));

    await waitFor(() => {
      expect(within(workflowTabs).getByRole('button', { name: /All orders/i })).toHaveClass(
        'is-active'
      );
    });
    expect(searchInput).toHaveValue('');
    expect(allocationFilter).toHaveValue('all');
    expect(fulfillmentFilter).toHaveValue('all');
    expect(shippingFilter).toHaveValue('all');
    expect(within(quickFilters).getByRole('button', { name: /All orders/i })).toHaveClass(
      'is-active'
    );
    expect(highValueQuickFilter).not.toHaveClass('is-active');
    expect(screen.queryByRole('button', { name: 'Filters' })).not.toBeInTheDocument();
  });

  it.each([
    ['awaiting-shipment', 'awaitingShipment', 'No shipments currently awaiting action'],
    ['stale-fulfillment', 'shipmentReview', 'No stale fulfillment work in this queue'],
    ['tracking-missing', 'trackingMissing', 'No orders missing tracking'],
  ] as const)(
    'requests the authoritative %s workflow instead of loading All',
    async (routeWorkflow, apiWorkflow, emptyTitle) => {
      listOrdersMock.mockResolvedValue([]);

      renderOrdersPage([`/orders?workflow=${routeWorkflow}`]);

      expect(await screen.findByText(emptyTitle)).toBeInTheDocument();
      expect(listOrdersMock).toHaveBeenCalledWith(expect.objectContaining({
        vendorId: 'demo-vendor-a',
        workflow: apiWorkflow,
        limit: 100,
        offset: 0,
      }));
      expect(listOrdersMock).not.toHaveBeenCalledWith(expect.objectContaining({ workflow: 'all' }));
    },
  );

  it.each([
    ['awaiting-shipment', 'awaitingShipment', 'No shipments currently awaiting action'],
    ['stale-fulfillment', 'shipmentReview', 'No stale fulfillment work in this queue'],
    ['tracking-missing', 'trackingMissing', 'No orders missing tracking'],
  ] as const)(
    'defensively excludes terminal allocations returned for the %s workflow',
    async (routeWorkflow, apiWorkflow, emptyTitle) => {
      const terminalOrder = buildAwaitingRejectableOrder({
        id: 'allocation-1128',
        sourceShopifyOrderId: 'gid://shopify/Order/8151983227217',
        sourceShopifyOrderNumber: '#1128',
        operationalActionability: {
          actionable: false,
          reason: 'ALLOCATION_REFUND_TERMINAL',
        },
        fulfillmentActionAvailable: false,
      });
      listOrdersMock.mockResolvedValue([toSummary(terminalOrder)]);

      renderOrdersPage([`/orders?workflow=${routeWorkflow}`]);

      expect(await screen.findByText(emptyTitle)).toBeInTheDocument();
      expect(screen.queryByText('#1128')).not.toBeInTheDocument();
      expect(listOrdersMock).toHaveBeenCalledWith(expect.objectContaining({ workflow: apiWorkflow }));
    },
  );

  it('uses backend workflow summary values for authoritative badges', async () => {
    listOrdersMock.mockResolvedValue([]);
    getVendorOrdersWorkflowSummaryMock.mockResolvedValueOnce({
      all: 11,
      awaitingShipment: 7,
      shipmentReview: 5,
      trackingMissing: 3,
    });

    renderOrdersPage();

    const workflowTabs = await screen.findByLabelText('Orders workflow tabs');
    await waitFor(() => {
      expect(within(workflowTabs).getByRole('button', { name: /All orders/i })).toHaveTextContent('11');
      expect(within(workflowTabs).getByRole('button', { name: /Ready to ship/i })).toHaveTextContent('7');
      expect(within(workflowTabs).getByRole('button', { name: /Shipment review/i })).toHaveTextContent('5');
      expect(within(workflowTabs).getByRole('button', { name: /Tracking missing/i })).toHaveTextContent('3');
    });
    expect(getVendorOrdersWorkflowSummaryMock).toHaveBeenCalledWith(expect.objectContaining({
      vendorId: 'demo-vendor-a',
    }));
  });

  it('keeps a terminal allocation visible in All with terminal story and no shipment action', async () => {
    const terminalOrder = buildAwaitingRejectableOrder({
      id: 'allocation-1128',
      sourceShopifyOrderId: 'gid://shopify/Order/8151983227217',
      sourceShopifyOrderNumber: '#1128',
      allocationStatus: 'active',
      fulfillmentStatus: 'Pending',
      shippingStatus: 'Awaiting Shipment',
      operationalActionability: {
        actionable: false,
        reason: 'ALLOCATION_REFUND_TERMINAL',
      },
      fulfillmentActionAvailable: false,
      refundRecordCount: 0,
      assignmentHistory: [
        {
          action: 'assigned',
          fromVendorId: null,
          toVendorId: 'demo-vendor-a',
          actorName: 'System',
          actorRole: 'system',
          createdAt: '2026-09-06T10:00:00.000Z',
        },
      ],
    });
    listOrdersMock.mockResolvedValue([toSummary(terminalOrder)]);
    getOrderMock.mockResolvedValue(terminalOrder);
    getVendorOrdersWorkflowSummaryMock.mockResolvedValueOnce({
      all: 1,
      awaitingShipment: 0,
      shipmentReview: 0,
      trackingMissing: 0,
    });

    renderOrdersPage();

    expect((await screen.findAllByText('#1128')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Refunded').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Fulfillment not required').length).toBeGreaterThan(0);
    const paymentStatusAxis = screen.getByText('Payment Status').closest('.orders-status-axis');
    expect(paymentStatusAxis).not.toBeNull();
    expect(within(paymentStatusAxis as HTMLElement).getByText('Refund completed')).toBeInTheDocument();
    const terminalRow = screen.getByRole('button', { name: /#1128/ });
    const terminalTrackingCell = terminalRow.querySelector('.orders-table-shipping-cell');
    expect(terminalTrackingCell).not.toBeNull();
    expect(within(terminalTrackingCell as HTMLElement).queryByText('Refund completed for this allocation.')).not.toBeInTheDocument();
    expect(screen.getByText('Barcode gateway license')).toBeInTheDocument();
    expect(screen.queryByLabelText('Smart label action')).not.toBeInTheDocument();
    expect(listOrdersMock).toHaveBeenCalledWith(expect.objectContaining({ workflow: 'all' }));
    expect(getOrderMock).toHaveBeenCalledWith('allocation-1128', expect.objectContaining({ vendorId: 'demo-vendor-a' }));
  });

  it('keeps conflict-cancelled raw awaiting-shipment rows out of open workflow filters', async () => {
    const cancelledConflict = buildAwaitingRejectableOrder({
      id: 'ORD-A-1108',
      sourceShopifyOrderNumber: '#1108',
      status: 'Cancelled',
      isCancelled: true,
      isCancellationConflict: true,
      cancelledAt: '2026-07-11T20:23:00.000Z',
      allocationStatus: 'active',
      fulfillmentStatus: 'Pending',
      shippingStatus: 'Awaiting Shipment',
      trackingNumber: undefined,
      carrier: undefined,
    });
    listOrdersMock.mockImplementation(async (options) =>
      options?.workflow === 'all' ? [toSummary(cancelledConflict)] : [],
    );
    getOrderMock.mockResolvedValue(cancelledConflict);

    renderOrdersPage(['/orders?workflow=awaiting-shipment']);

    expect(await screen.findByText('No shipments currently awaiting action')).toBeInTheDocument();
    expect(screen.queryByText('#1108')).not.toBeInTheDocument();

    await userEvent.click(within(screen.getByLabelText('Orders workflow tabs')).getByRole('button', { name: /All orders/i }));

    expect((await screen.findAllByText('#1108')).length).toBeGreaterThan(0);

    await userEvent.click(within(screen.getByLabelText('Orders workflow tabs')).getByRole('button', { name: /Tracking missing/i }));

    expect(await screen.findByText('No orders missing tracking')).toBeInTheDocument();
    expect(screen.queryByText('#1108')).not.toBeInTheDocument();
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
    listOrdersMock.mockImplementation(async (options) =>
      options?.workflow === 'awaitingShipment' ? [] : [toSummary(orderDetail)],
    );
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
    const orderRow = screen.getByRole('button', { name: /#1038/ });
    expect(within(orderRow).queryByText('Customer hidden for vendor scope')).not.toBeInTheDocument();
    expect(screen.getByText('Customer hidden for vendor scope')).toBeInTheDocument();
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

    expect(await screen.findByText('Shipment')).toBeInTheDocument();
    expect(screen.getByText('Carrier')).toBeInTheDocument();
    expect(screen.getByText('Shipment status')).toBeInTheDocument();
    expect(screen.getByText('Shipping label')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Items' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Order activity' })).toBeInTheDocument();
    expect(screen.queryByText('Internal metadata')).not.toBeInTheDocument();
    expect(screen.queryByText(orderDetail.sourceShopifyOrderId)).not.toBeInTheDocument();
    expect(screen.queryByText(orderDetail.id)).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Shopify order snapshot' })).not.toBeInTheDocument();
    expect(screen.queryByText('Payment gateway')).not.toBeInTheDocument();
    expect(screen.queryByText('Vendor integration')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Vendor Invoice' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Shopify product gid:\/\/shopify\/Product\/1002/)).not.toBeInTheDocument();
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
    expect(screen.getByText('Payment Status')).toBeInTheDocument();
    expect(within(screen.getByLabelText('Shopify order snapshot')).queryByText('Financial status')).not.toBeInTheDocument();
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
    expect(screen.getByText('SKU456 · Standard')).toBeInTheDocument();
    expect(screen.queryByText(/Shopify product gid:\/\/shopify\/Product\/1002/)).not.toBeInTheDocument();
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
    setVendorUser();
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

  it('disables the smart label shipment action for restricted vendors while keeping order details visible', async () => {
    setCurrentUser({
      email: 'vendor@demo.com',
      name: 'Demo Vendor',
      role: 'vendor',
      vendorAccess: ['demo-vendor-a'],
      vendorDetails: [
        {
          vendorId: 'demo-vendor-a',
          vendorName: 'Demo Vendor A',
          status: 'inactive',
          restrictionReason: 'Operational review',
        },
      ],
      canSwitchVendors: false,
      defaultVendorId: 'demo-vendor-a',
    });
    const awaitingShipmentOrder = buildAwaitingRejectableOrder();
    listOrdersMock.mockResolvedValue([toSummary(awaitingShipmentOrder)]);
    getOrderMock.mockResolvedValue(awaitingShipmentOrder);

    renderOrdersPage();

    expect(await screen.findByText('Barcode gateway license')).toBeInTheDocument();
    const smartLabelAction = await screen.findByLabelText('Smart label action');
    const labelButton = within(smartLabelAction).getByRole('button');
    expect(labelButton).toBeDisabled();
    expect(labelButton).toHaveAttribute('title', 'Vendor account is restricted. Operational actions are disabled.');
    expect(smartLabelAction).toHaveTextContent('Vendor account is restricted. Operational actions are disabled.');
    expect(createShipmentExecutionMock).not.toHaveBeenCalled();
  });

  it('does not show reject actions in the orders detail rail', async () => {
    setVendorUser();
    const awaitingShipmentOrder = buildAwaitingRejectableOrder();
    listOrdersMock.mockResolvedValue([toSummary(awaitingShipmentOrder)]);
    getOrderMock.mockResolvedValue(awaitingShipmentOrder);

    renderOrdersPage();

    expect(await screen.findByLabelText('Order status axes')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Order issue' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reject selected items' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reject full order' })).not.toBeInTheDocument();
  });

  it('does not show selected line item rejection in the orders detail rail', async () => {
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
    listOrdersMock.mockResolvedValue([toSummary(multiLineOrder)]);
    getOrderMock.mockResolvedValue(multiLineOrder);

    renderOrdersPage();

    expect(await screen.findByLabelText('Order status axes')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Order issue' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reject selected items' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reject full order' })).not.toBeInTheDocument();
    expect(planAllocationSplitMock).not.toHaveBeenCalled();
    expect(splitAllocationMock).not.toHaveBeenCalled();
  });

  it('removes vendor reject-unavailable presentation when shipment processing exists', async () => {
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

    expect(getRejectUnavailableReason(awaitingShipmentOrder)).toBe(
      'This order cannot be rejected because a shipment is already being processed.',
    );

    renderOrdersPage();

    const sidebar = (await screen.findByRole('heading', { name: '#1002' })).closest('aside');
    expect(sidebar).not.toBeNull();
    const sidebarScope = within(sidebar as HTMLElement);
    expect(sidebarScope.queryByLabelText('Reject unavailable')).not.toBeInTheDocument();
    expect(sidebarScope.queryByText('This order cannot be rejected because a shipment is already being processed.')).not.toBeInTheDocument();
    expect(sidebarScope.queryByText('Shipment status: Pending')).not.toBeInTheDocument();
    expect(sidebarScope.getByRole('heading', { name: 'Shipment' })).toBeInTheDocument();
    const labelGuidance = sidebarScope.getByLabelText('Workflow action guidance');
    expect(labelGuidance).toHaveTextContent('Check label availability');
    expect(labelGuidance).toHaveTextContent('Shipment exists; open provider evidence or retry only when safe.');
    expect(sidebarScope.getByRole('heading', { name: 'Items' })).toBeInTheDocument();
    expect(sidebarScope.getByRole('heading', { name: 'Order activity' })).toBeInTheDocument();
    expect(sidebarScope.getByRole('link', { name: 'View details' })).toHaveAttribute('href', '/orders/ORD-A-1002');
    expect(screen.queryByRole('button', { name: 'Reject order' })).not.toBeInTheDocument();
  });

  it('removes vendor reject-unavailable presentation after fulfillment', async () => {
    setVendorUser();
    const fulfilledOrder = buildAwaitingRejectableOrder({
      fulfillmentStatus: 'Fulfilled',
    });
    listOrdersMock.mockResolvedValue([toSummary(fulfilledOrder)]);
    getOrderMock.mockResolvedValue(fulfilledOrder);

    expect(getRejectUnavailableReason(fulfilledOrder)).toBe('This order cannot be rejected after fulfillment.');

    renderOrdersPage();

    const sidebar = (await screen.findByRole('heading', { name: '#1002' })).closest('aside');
    expect(sidebar).not.toBeNull();
    const sidebarScope = within(sidebar as HTMLElement);
    expect(sidebarScope.queryByLabelText('Reject unavailable')).not.toBeInTheDocument();
    expect(sidebarScope.queryByText('This order cannot be rejected after fulfillment.')).not.toBeInTheDocument();
    expect(sidebarScope.getByLabelText('Workflow action guidance')).toHaveTextContent('Create shipment');
    const shipmentCard = sidebarScope.getByRole('heading', { name: 'Shipment' }).closest('section');
    expect(shipmentCard).not.toBeNull();
    expect(within(shipmentCard as HTMLElement).getByText('Fulfilled')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reject order' })).not.toBeInTheDocument();
  });

  it('removes vendor reject-unavailable presentation after tracking or carrier evidence exists', async () => {
    setVendorUser();
    const trackedOrder = buildAwaitingRejectableOrder({
      trackingNumber: 'TRK-1092',
    });
    listOrdersMock.mockResolvedValue([toSummary(trackedOrder)]);
    getOrderMock.mockResolvedValue(trackedOrder);

    expect(getRejectUnavailableReason(trackedOrder)).toBe('This order cannot be rejected after tracking has been added.');

    renderOrdersPage();

    const trackedSidebar = (await screen.findByRole('heading', { name: '#1002' })).closest('aside');
    expect(trackedSidebar).not.toBeNull();
    const trackedSidebarScope = within(trackedSidebar as HTMLElement);
    expect(trackedSidebarScope.queryByLabelText('Reject unavailable')).not.toBeInTheDocument();
    expect(trackedSidebarScope.queryByText('This order cannot be rejected after tracking has been added.')).not.toBeInTheDocument();
    expect(trackedSidebarScope.getAllByText('TRK-1092').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Reject order' })).not.toBeInTheDocument();

    cleanup();
    listOrdersMock.mockReset();
    getOrderMock.mockReset();

    const carrierOrder = buildAwaitingRejectableOrder({
      carrier: 'Yurtiçi Kargo',
    });
    listOrdersMock.mockResolvedValue([toSummary(carrierOrder)]);
    getOrderMock.mockResolvedValue(carrierOrder);

    expect(getRejectUnavailableReason(carrierOrder)).toBe('This order cannot be rejected after a carrier has been assigned.');

    renderOrdersPage();

    const carrierSidebar = (await screen.findByRole('heading', { name: '#1002' })).closest('aside');
    expect(carrierSidebar).not.toBeNull();
    const carrierSidebarScope = within(carrierSidebar as HTMLElement);
    expect(carrierSidebarScope.queryByLabelText('Reject unavailable')).not.toBeInTheDocument();
    expect(carrierSidebarScope.queryByText('This order cannot be rejected after a carrier has been assigned.')).not.toBeInTheDocument();
    expect(carrierSidebarScope.getByText('Yurtiçi Kargo')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reject order' })).not.toBeInTheDocument();
  });

  it.each([
    {
      name: 'terminal refund',
      order: buildAwaitingRejectableOrder({
        operationalActionability: { actionable: false, reason: 'ALLOCATION_REFUND_TERMINAL' },
        fulfillmentActionAvailable: false,
      }),
      operationalStatus: 'Refunded',
      actionlessGuidance: 'No action required',
      stripCopy: 'Fulfillment not required',
      rejectReason: 'Refund completed. No further rejection action is required.',
    },
    {
      name: 'clean cancellation',
      order: buildAwaitingRejectableOrder({
        status: 'Cancelled',
        isCancelled: true,
        cancelledAt: '2026-07-11T10:00:00.000Z',
        fulfillmentActionAvailable: false,
      }),
      operationalStatus: 'Cancelled',
      actionlessGuidance: 'No action required',
      stripCopy: 'Fulfillment not required',
      rejectReason: 'Cancelled orders cannot be rejected.',
    },
    {
      name: 'cancellation conflict',
      order: buildAwaitingRejectableOrder({
        status: 'Cancelled',
        isCancelled: true,
        isCancellationConflict: true,
        cancelledAt: '2026-07-11T10:00:00.000Z',
        fulfillmentActionAvailable: false,
      }),
      operationalStatus: 'Cancelled',
      actionlessGuidance: 'Review cancellation',
      stripCopy: 'Review existing fulfillment evidence',
      rejectReason: 'Cancelled orders cannot be rejected.',
    },
  ])(
    'removes vendor reject-unavailable presentation for $name while preserving the sidebar',
    async ({ order, operationalStatus, actionlessGuidance, stripCopy, rejectReason }) => {
      setVendorUser();
      listOrdersMock.mockResolvedValue([toSummary(order)]);
      getOrderMock.mockResolvedValue(order);

      expect(getRejectUnavailableReason(order)).toBe(rejectReason);

      renderOrdersPage();

      const sidebar = (await screen.findByRole('heading', { name: '#1002' })).closest('aside');
      expect(sidebar).not.toBeNull();
      const sidebarScope = within(sidebar as HTMLElement);
      expect(sidebarScope.queryByLabelText('Reject unavailable')).not.toBeInTheDocument();
      expect(sidebarScope.queryByText(rejectReason)).not.toBeInTheDocument();
      expect(within(sidebarScope.getByLabelText('Order status axes')).getByText(operationalStatus)).toBeInTheDocument();
      const statusStrip = (sidebar as HTMLElement).querySelector('.orders-detail-status-strip');
      expect(statusStrip).not.toBeNull();
      expect(statusStrip).toHaveTextContent(stripCopy);
      expect(sidebarScope.queryByLabelText('Workflow action guidance')).not.toBeInTheDocument();
      expect(sidebarScope.queryByText('Next action')).not.toBeInTheDocument();
      expect(sidebarScope.queryByText(actionlessGuidance)).not.toBeInTheDocument();
      expect(sidebarScope.getByRole('heading', { name: 'Shipment' })).toBeInTheDocument();
      expect(sidebarScope.getByRole('heading', { name: 'Items' })).toBeInTheDocument();
      expect(sidebarScope.getByRole('heading', { name: 'Order activity' })).toBeInTheDocument();
      expect(sidebarScope.getByRole('link', { name: 'View details' })).toHaveAttribute('href', '/orders/ORD-A-1002');
      expect(screen.queryByRole('button', { name: 'Reject order' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Reject selected items' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Reject full order' })).not.toBeInTheDocument();
    },
  );

  it.each([
    {
      name: 'pending reassignment',
      order: buildAwaitingRejectableOrder({
        allocationStatus: 'pending_reassignment',
        reassignmentRequired: true,
      }),
      actionlessGuidance: 'Review order',
    },
    {
      name: 'tracking missing without a sidebar sync control',
      order: buildAwaitingRejectableOrder({
        shippingStatus: 'Label Created',
      }),
      actionlessGuidance: 'Sync tracking',
    },
    {
      name: 'fulfilled delivery monitoring',
      order: buildAwaitingRejectableOrder({
        fulfillmentStatus: 'Fulfilled',
        shippingStatus: 'Delivered',
        trackingNumber: 'TRK-DELIVERED',
        trackingUrl: 'https://tracking.example/TRK-DELIVERED',
        carrier: 'DHL',
      }),
      actionlessGuidance: 'Monitor delivery evidence',
    },
    {
      name: 'fallback shipment review',
      order: buildAwaitingRejectableOrder({
        shippingStatus: 'Label Created',
        trackingNumber: 'TRK-FALLBACK',
        carrier: 'DHL',
      }),
      actionlessGuidance: 'Review shipment state',
    },
  ])(
    'removes actionless vendor guidance for $name while preserving factual and actionable sidebar content',
    async ({ order, actionlessGuidance }) => {
      setVendorUser();
      listOrdersMock.mockResolvedValue([toSummary(order)]);
      getOrderMock.mockResolvedValue(order);

      renderOrdersPage();

      const sidebar = (await screen.findByRole('heading', { name: '#1002' })).closest('aside');
      expect(sidebar).not.toBeNull();
      const sidebarScope = within(sidebar as HTMLElement);
      expect(sidebarScope.queryByLabelText('Workflow action guidance')).not.toBeInTheDocument();
      expect(sidebarScope.queryByText('Next action')).not.toBeInTheDocument();
      expect(sidebarScope.queryByText(actionlessGuidance)).not.toBeInTheDocument();
      expect((sidebar as HTMLElement).querySelector('.orders-detail-status-strip')).not.toBeNull();
      expect(sidebarScope.getByRole('heading', { name: 'Shipment' })).toBeInTheDocument();
      expect(sidebarScope.getByRole('heading', { name: 'Items' })).toBeInTheDocument();
      expect(sidebarScope.getByRole('heading', { name: 'Order activity' })).toBeInTheDocument();
      expect(sidebarScope.getByRole('link', { name: 'View details' })).toHaveAttribute('href', '/orders/ORD-A-1002');
      expect(sidebarScope.getByLabelText('Smart label action')).toBeInTheDocument();
      expect(sidebarScope.queryByLabelText('Reject unavailable')).not.toBeInTheDocument();
    },
  );

  it('removes redundant non-actionable guidance from the vendor-blocked sidebar', async () => {
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

    const sidebar = (await screen.findByRole('heading', { name: '#1002' })).closest('aside');
    expect(sidebar).not.toBeNull();
    const sidebarScope = within(sidebar as HTMLElement);

    expect(sidebarScope.getByRole('link', { name: 'View details' })).toHaveAttribute('href', '/orders/ORD-A-1002');
    const axes = sidebarScope.getByLabelText('Order status axes');
    expect(within(axes).getByText('Vendor Blocked')).toBeInTheDocument();
    expect(within(axes).getByText('Payment Status')).toBeInTheDocument();
    expect(within(axes).getByText('Held')).toBeInTheDocument();
    expect(sidebarScope.queryByText('Admin action required')).not.toBeInTheDocument();
    expect(sidebarScope.queryByText('Awaiting admin resolution. Fulfillment is not ready.')).not.toBeInTheDocument();
    expect(sidebarScope.queryByText('Next action')).not.toBeInTheDocument();
    expect(sidebarScope.queryByText('Review order')).not.toBeInTheDocument();
    expect(sidebarScope.queryByText('Review the blocked order before shipment work continues.')).not.toBeInTheDocument();
    expect(sidebarScope.queryByLabelText('Workflow action guidance')).not.toBeInTheDocument();
    expect(sidebarScope.queryByText('Reject unavailable')).not.toBeInTheDocument();
    expect(sidebarScope.queryByText('Vendor rejection already submitted. This order is awaiting Sporgym admin review.')).not.toBeInTheDocument();
    expect(sidebarScope.queryByLabelText('Reject unavailable')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reject order' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Kargo etiketi yazdır/i })).not.toBeInTheDocument();
    const fulfillmentCard = screen.getByRole('heading', { name: 'Shipment' }).closest('section');
    expect(fulfillmentCard).not.toBeNull();
    expect(within(fulfillmentCard as HTMLElement).getByText('Carrier')).toBeInTheDocument();
    expect(within(fulfillmentCard as HTMLElement).getByText('Tracking')).toBeInTheDocument();
    expect(within(fulfillmentCard as HTMLElement).getByText('Shipment status')).toBeInTheDocument();
    expect(within(fulfillmentCard as HTMLElement).getByText('Shipping label')).toBeInTheDocument();
    expect(within(fulfillmentCard as HTMLElement).getByText('Last update')).toBeInTheDocument();
    expect(within(fulfillmentCard as HTMLElement).getAllByText('Blocked').length).toBeGreaterThan(0);
    expect(within(fulfillmentCard as HTMLElement).queryByText('Not fulfilled')).not.toBeInTheDocument();
    expect(within(fulfillmentCard as HTMLElement).getByText('Unavailable')).toBeInTheDocument();
    expect(screen.queryByLabelText('Shopify order snapshot')).not.toBeInTheDocument();
    expect(screen.queryByText('Vendor integration')).not.toBeInTheDocument();
    expect(screen.queryByText('Shopify sync')).not.toBeInTheDocument();
    expect(sidebarScope.getByRole('heading', { name: 'Items' })).toBeInTheDocument();
    expect(sidebarScope.getByRole('heading', { name: 'Order activity' })).toBeInTheDocument();
    expect(screen.getAllByText('Vendor rejected order').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Awaiting admin resolution').length).toBeGreaterThan(0);

    const blockedRow = screen.getByRole('button', { name: /#1002/ });
    expect(within(blockedRow).getByText('Vendor Blocked')).toBeInTheDocument();
    expect(within(blockedRow).getAllByText('Awaiting admin resolution')).toHaveLength(1);
    expect(blockedRow.querySelector('.orders-table-status-cell small')).toBeNull();
  });

  it.each(['admin', 'support', 'finance'] as const)(
    'preserves blocked sidebar status and workflow guidance for %s users',
    async (role) => {
      setCurrentUser({
        email: `${role}@demo.com`,
        name: `Demo ${role}`,
        role,
        vendorAccess: ['demo-vendor-a'],
        vendorDetails: [{ vendorId: 'demo-vendor-a', vendorName: 'Demo Vendor A' }],
        canSwitchVendors: role === 'admin',
        defaultVendorId: 'demo-vendor-a',
      });
      const blockedOrder = buildAwaitingRejectableOrder({
        status: 'On Hold',
        allocationStatus: 'vendor_blocked',
        reassignmentRequired: true,
        cancellationReason: 'OUT_OF_STOCK',
        fulfillmentActionAvailable: false,
      });
      listOrdersMock.mockResolvedValue([toSummary(blockedOrder)]);
      getOrderMock.mockResolvedValue(blockedOrder);

      renderOrdersPage();

      expect(await screen.findByText('Admin action required')).toBeInTheDocument();
      if (role === 'admin') {
        expect(screen.queryByText('Awaiting admin resolution. Shopify not fulfilled.')).not.toBeInTheDocument();
        const fulfillmentCard = screen.getByRole('heading', { name: 'Fulfillment and shipping' }).closest('section');
        expect(fulfillmentCard).not.toBeNull();
        expect(within(fulfillmentCard as HTMLElement).getByText('Shopify sync')).toBeInTheDocument();
        expect(within(fulfillmentCard as HTMLElement).getByText('Not fulfilled')).toBeInTheDocument();
      } else {
        expect(screen.getByText('Awaiting admin resolution. Fulfillment is not ready.')).toBeInTheDocument();
      }
      const guidance = screen.getByLabelText('Workflow action guidance');
      expect(guidance).toHaveTextContent(role === 'admin' ? 'Review allocation' : 'Review order');
      expect(guidance).toHaveTextContent(
        role === 'admin'
          ? 'Open the order detail to inspect the blocked assignment and resolve vendor scope before shipment work.'
          : 'Review the blocked order before shipment work continues.',
      );
      expect(screen.queryByLabelText('Reject unavailable')).not.toBeInTheDocument();
    },
  );

  it('uses the latest recorded vendor rejection in the selected-order timeline', async () => {
    setVendorUser();
    const firstRejectAt = '2026-05-08T09:30:00Z';
    const latestRejectAt = '2026-05-08T15:30:00Z';
    const blockedOrder = buildAwaitingRejectableOrder({
      status: 'On Hold',
      allocationStatus: 'vendor_blocked',
      reassignmentRequired: true,
      cancellationReason: 'OUT_OF_STOCK',
      fulfillmentActionAvailable: false,
      assignmentHistory: [
        { action: 'vendor_blocked', fromVendorId: 'demo-vendor-a', toVendorId: 'demo-vendor-a', actorName: 'Vendor user', actorRole: 'vendor', createdAt: firstRejectAt },
        { action: 'admin_returned_to_vendor', fromVendorId: 'demo-vendor-a', toVendorId: 'demo-vendor-a', actorName: 'Admin user', actorRole: 'admin', createdAt: '2026-05-08T11:30:00Z' },
        { action: 'vendor_blocked', fromVendorId: 'demo-vendor-a', toVendorId: 'demo-vendor-a', actorName: 'Vendor user', actorRole: 'vendor', createdAt: latestRejectAt },
      ],
    });
    listOrdersMock.mockResolvedValue([toSummary(blockedOrder)]);
    getOrderMock.mockResolvedValue(blockedOrder);

    renderOrdersPage();

    const timeline = (await screen.findByRole('heading', { name: 'Order activity' })).closest('section');
    expect(timeline).not.toBeNull();
    const blockedRow = within(timeline as HTMLElement).getByText('Vendor blocked').closest('li');
    expect(blockedRow).not.toBeNull();
    expect(blockedRow).toHaveTextContent(formatDateTime(latestRejectAt, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }, 'Not synced'));
    expect(blockedRow).not.toHaveTextContent(formatDateTime(firstRejectAt, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }, 'Not synced'));
  });

  it('does not infer terminal operational closure from vendor-blocked refund evidence', async () => {
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

    expect((await screen.findAllByText('Vendor Blocked')).length).toBeGreaterThan(0);
    const axes = screen.getByLabelText('Order status axes');
    expect(within(axes).getByText('Operational Status')).toBeInTheDocument();
    expect(within(axes).getByText('Payment Status')).toBeInTheDocument();
    expect(within(axes).getByText('Vendor Blocked')).toBeInTheDocument();
    expect(within(axes).getByText('Held')).toBeInTheDocument();
    expect(within(axes).queryByText('Refunded')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Reject unavailable')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Workflow action guidance')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Kargo etiketi yazdır/i })).not.toBeInTheDocument();

    expect(screen.queryByLabelText('Shopify order snapshot')).not.toBeInTheDocument();
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
