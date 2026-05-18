import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrderDetail } from '../features/orders/api';
import { setCurrentUser, setToken } from '../lib/auth';
import { ApiError } from '../lib/api/errors';
import { OrderDetailPage } from './OrderDetailPage';

const getOrderMock = vi.fn<(orderId: string) => Promise<OrderDetail>>();
const getShippingProviderDiagnosticsMock = vi.fn();
const createShipmentExecutionMock = vi.fn();
const retryShipmentExecutionMock = vi.fn();
const listReturnsMock = vi.fn();
const getFinanceDashboardMock = vi.fn();
const listAdminSupportTicketsMock = vi.fn();
const listVendorSupportTicketsMock = vi.fn();

vi.mock('../config/runtime', () => ({
  runtimeConfig: {
    apiMode: 'real',
    apiBaseUrl: 'http://localhost:4000',
  },
}));

vi.mock('../features/orders/api', async () => {
  const actual = await vi.importActual<typeof import('../features/orders/api')>('../features/orders/api');
  return {
    ...actual,
    getOrder: (orderId: string) => getOrderMock(orderId),
    getShippingProviderDiagnostics: () => getShippingProviderDiagnosticsMock(),
    createShipmentExecution: (allocationId: string, options?: { vendorId?: string | null }) => createShipmentExecutionMock(allocationId, options),
    retryShipmentExecution: (shipmentExecutionId: string) => retryShipmentExecutionMock(shipmentExecutionId),
    submitFulfillmentTracking: vi.fn(),
  };
});

vi.mock('../features/returns/api', async () => {
  const actual = await vi.importActual<typeof import('../features/returns/api')>('../features/returns/api');
  return {
    ...actual,
    listReturns: (options?: { vendorId?: string | null }) => listReturnsMock(options),
  };
});

vi.mock('../features/finance/api', async () => {
  const actual = await vi.importActual<typeof import('../features/finance/api')>('../features/finance/api');
  return {
    ...actual,
    getFinanceDashboard: (options?: { vendorId?: string | null }) => getFinanceDashboardMock(options),
  };
});

vi.mock('../features/support/api', async () => {
  const actual = await vi.importActual<typeof import('../features/support/api')>('../features/support/api');
  return {
    ...actual,
    listAdminSupportTickets: () => listAdminSupportTicketsMock(),
    listVendorSupportTickets: () => listVendorSupportTicketsMock(),
  };
});

const orderWithShipmentSummary: OrderDetail = {
  originalVendorId: 'sporjinal',
  assignedVendorId: 'sporjinal',
  vendorId: 'sporjinal',
  id: 'alloc-sporjinal-7621783322961',
  sourceShopifyOrderId: '7616544244049',
  sourceShopifyOrderNumber: '#1028',
  status: 'Pending',
  allocationStatus: 'active',
  reassignmentRequired: false,
  assignmentHistory: [],
  fulfillmentActionState: 'awaiting_shipment',
  fulfillmentActionAvailable: true,
  fulfillmentStatus: 'Pending',
  shippingStatus: 'Awaiting Shipment',
  date: '2026-05-15T12:08:00.000Z',
  customer: 'Customer unavailable',
  amount: 'TRY 4,999.00',
  channel: 'Shopify',
  shippingAddress: 'Unknown',
  notes: '—',
  lineItems: [
    {
      originalVendorId: 'sporjinal',
      assignedVendorId: 'sporjinal',
      vendorId: 'sporjinal',
      id: 'line-1028',
      sku: 'FQ1833-200-41',
      variantTitle: '41',
      name: 'Nike Air Max Alpha Trainer 6',
      quantity: 1,
      price: 'TRY 4,999.00',
      fulfillmentStatus: 'Pending',
      allocationStatus: 'active',
      reassignmentRequired: false,
      fulfillmentActionState: 'awaiting_shipment',
      fulfillmentActionAvailable: true,
      shippingStatus: 'Awaiting Shipment',
    },
  ],
  items: [],
  timeline: [{ label: 'Order received', at: '2026-05-15T12:08:00.000Z' }],
  shipmentExecution: {
    id: 'shipment-kargo_entegrator-alloc-sporjinal-7621783322961',
    allocationId: 'alloc-sporjinal-7621783322961',
    vendorId: 'sporjinal',
    sourceShopifyOrderId: '7616544244049',
    sourceShopifyOrderNumber: '#1028',
    sourceShopifyFulfillmentId: null,
    provider: 'kargo_entegrator',
    providerShipmentId: null,
    trackingNumber: null,
    trackingUrl: null,
    labelUrl: null,
    shipmentStatus: 'pending',
    desi: '3.00',
    cargoIntegrationId: '2547',
    warehouseId: '1774',
    shippingCost: null,
    shippingVat: null,
    currency: 'TRY',
    shippingCostLinked: false,
    createdAt: '2026-05-15T19:28:50.693Z',
    updatedAt: '2026-05-15T19:28:50.786Z',
    providerResponseSummary: {
      httpStatus: 200,
      ok: true,
      contentType: 'application/json',
      parsedBodyType: 'object',
      responseKeys: ['message', 'shipment_id'],
      providerError: 'Provider returned no shipment identifiers.',
      dryRun: true,
      disabledGates: ['SHIPPING_EXECUTION_ENABLED'],
      providerShipmentIdPresent: false,
      trackingNumberPresent: false,
      labelPresent: false,
      statusField: 'pending',
    },
  },
};

const orderWithoutShipment: OrderDetail = {
  ...orderWithShipmentSummary,
  shipmentExecution: null,
};

function renderOrderDetail() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/orders/alloc-sporjinal-7621783322961']}>
        <Routes>
          <Route path="/orders/:orderId" element={<OrderDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('OrderDetailPage shipment provider response visibility', () => {
  beforeEach(() => {
    cleanup();
    window.localStorage.clear();
    setToken('test-token');
    getOrderMock.mockReset();
    getOrderMock.mockResolvedValue(orderWithShipmentSummary);
    getShippingProviderDiagnosticsMock.mockReset();
    getShippingProviderDiagnosticsMock.mockResolvedValue({
      provider: 'kargo_entegrator',
      executionReady: false,
      sandboxModeEnabled: false,
      shippingExecutionEnabled: false,
      providerSelected: true,
      providerEnabled: true,
      webhookIngestEnabled: false,
      baseUrlConfigured: true,
      apiKeyConfigured: true,
      cargoIntegrationIdConfigured: true,
      warehouseIdConfigured: true,
      defaultDesiConfigured: true,
      notificationUrlConfigured: false,
      webhookRouteImplemented: false,
      receiverAddressAvailability: 'unknown_required',
      dummyKargoSupport: 'not_implemented',
      statusSyncSupport: 'not_implemented',
      missing: ['SHIPPING_EXECUTION_ENABLED'],
      deprecatedEnvFallbacks: [],
      warnings: ['Dummy Kargo creation is not enabled.'],
    });
    createShipmentExecutionMock.mockReset();
    createShipmentExecutionMock.mockResolvedValue({
      ...orderWithShipmentSummary.shipmentExecution,
      id: 'shipment-created-1028',
      shipmentStatus: 'created',
      providerShipmentId: 'ke-created-1028',
      barcode: 'barcode-1028',
      timeline: [{ label: 'Shipment created', at: '2026-05-15T19:40:00.000Z', status: 'created' }],
    });
    retryShipmentExecutionMock.mockReset();
    retryShipmentExecutionMock.mockResolvedValue({
      ...orderWithShipmentSummary.shipmentExecution,
      shipmentStatus: 'created',
      providerShipmentId: 'ke-live-1028',
      updatedAt: '2026-05-15T19:40:00.000Z',
    });
    listReturnsMock.mockReset();
    listReturnsMock.mockResolvedValue([]);
    getFinanceDashboardMock.mockReset();
    getFinanceDashboardMock.mockResolvedValue({
      summary: {
        grossSales: '$0.00',
        refunds: '$0.00',
        netRevenue: '$0.00',
        platformFee: '$0.00',
        payoutEstimate: '$0.00',
        totalRevenue: '$0.00',
        availableBalance: '$0.00',
        pendingPayouts: '$0.00',
        refundsThisMonth: '$0.00',
      },
      transactions: [],
    });
    listAdminSupportTicketsMock.mockReset();
    listAdminSupportTicketsMock.mockResolvedValue([]);
    listVendorSupportTicketsMock.mockReset();
    listVendorSupportTicketsMock.mockResolvedValue([]);
  });

  it('shows safe provider response summary to admins for pending shipments without identifiers', async () => {
    setCurrentUser({
      email: 'admin@demo.com',
      name: 'Demo Admin',
      role: 'admin',
      vendorAccess: ['sporjinal'],
      vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
      canSwitchVendors: true,
      defaultVendorId: 'sporjinal',
    });

    renderOrderDetail();

    expect(await screen.findByLabelText('Provider response summary')).toBeInTheDocument();
    expect(screen.getByText('message, shipment_id')).toBeInTheDocument();
    expect(screen.getByText('Provider returned no shipment identifiers.')).toBeInTheDocument();
    expect(screen.getByText('Stored dry-run response')).toBeInTheDocument();
    expect(screen.getAllByText('SHIPPING_EXECUTION_ENABLED').length).toBeGreaterThan(0);
    expect(screen.getByText('Provider id present')).toBeInTheDocument();
    expect(await screen.findByLabelText('Shipping provider diagnostics')).toBeInTheDocument();
    expect(screen.getByText('Shipping execution enabled')).toBeInTheDocument();
    expect(screen.getByText('Cargo integration configured')).toBeInTheDocument();
    expect(screen.getByText('Warehouse configured')).toBeInTheDocument();
    expect(screen.getByText('Webhook route implemented')).toBeInTheDocument();
    expect(screen.getByText('Dummy Kargo support')).toBeInTheDocument();
    expect(screen.getByText('Dummy Kargo creation is not enabled.')).toBeInTheDocument();
    expect(screen.queryByText('test-kargo-key')).not.toBeInTheDocument();
    expect(screen.queryByText(/bearer/i)).not.toBeInTheDocument();
  });

  it('shows retry action to admins for eligible stale dry-run pending shipments', async () => {
    setCurrentUser({
      email: 'admin@demo.com',
      name: 'Demo Admin',
      role: 'admin',
      vendorAccess: ['sporjinal'],
      vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
      canSwitchVendors: true,
      defaultVendorId: 'sporjinal',
    });

    renderOrderDetail();

    expect(await screen.findByRole('button', { name: 'Retry live shipment' })).toBeInTheDocument();
  });

  it('does not show retry action when a provider shipment id exists', async () => {
    getOrderMock.mockResolvedValueOnce({
      ...orderWithShipmentSummary,
      shipmentExecution: {
        ...orderWithShipmentSummary.shipmentExecution!,
        providerShipmentId: 'ke-created-1028',
      },
    });
    setCurrentUser({
      email: 'admin@demo.com',
      name: 'Demo Admin',
      role: 'admin',
      vendorAccess: ['sporjinal'],
      vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
      canSwitchVendors: true,
      defaultVendorId: 'sporjinal',
    });

    renderOrderDetail();

    expect(await screen.findByLabelText('Provider response summary')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry live shipment' })).not.toBeInTheDocument();
  });

  it('does not show retry action when a tracking number exists', async () => {
    getOrderMock.mockResolvedValueOnce({
      ...orderWithShipmentSummary,
      shipmentExecution: {
        ...orderWithShipmentSummary.shipmentExecution!,
        trackingNumber: 'TRACK-1028',
      },
    });
    setCurrentUser({
      email: 'admin@demo.com',
      name: 'Demo Admin',
      role: 'admin',
      vendorAccess: ['sporjinal'],
      vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
      canSwitchVendors: true,
      defaultVendorId: 'sporjinal',
    });

    renderOrderDetail();

    expect(await screen.findByLabelText('Provider response summary')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry live shipment' })).not.toBeInTheDocument();
  });

  it('calls the admin retry endpoint and refreshes order detail on success', async () => {
    const user = userEvent.setup();
    setCurrentUser({
      email: 'admin@demo.com',
      name: 'Demo Admin',
      role: 'admin',
      vendorAccess: ['sporjinal'],
      vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
      canSwitchVendors: true,
      defaultVendorId: 'sporjinal',
    });

    renderOrderDetail();

    await user.click(await screen.findByRole('button', { name: 'Retry live shipment' }));

    expect(retryShipmentExecutionMock).toHaveBeenCalledWith('shipment-kargo_entegrator-alloc-sporjinal-7621783322961');
    await waitFor(() => expect(getOrderMock).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/Shipment ke-live-1028 refreshed/i)).toBeInTheDocument();
  });

  it('shows a safe backend error when retry fails', async () => {
    const user = userEvent.setup();
    retryShipmentExecutionMock.mockRejectedValueOnce(
      new Error('Shipping provider execution is not ready. Missing: SHIPPING_EXECUTION_ENABLED.'),
    );
    setCurrentUser({
      email: 'admin@demo.com',
      name: 'Demo Admin',
      role: 'admin',
      vendorAccess: ['sporjinal'],
      vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
      canSwitchVendors: true,
      defaultVendorId: 'sporjinal',
    });

    renderOrderDetail();

    await user.click(await screen.findByRole('button', { name: 'Retry live shipment' }));

    expect(await screen.findByText('Shipping provider execution is not ready. Missing: SHIPPING_EXECUTION_ENABLED.')).toBeInTheDocument();
  });

  it('calls create shipment endpoint, shows success evidence, and refreshes order detail', async () => {
    const user = userEvent.setup();
    getOrderMock.mockResolvedValue(orderWithoutShipment);
    setCurrentUser({
      email: 'vendor@example.com',
      name: 'Sporjinal Vendor',
      role: 'vendor',
      vendorAccess: ['sporjinal'],
      vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
      canSwitchVendors: false,
      defaultVendorId: 'sporjinal',
    });

    renderOrderDetail();

    await user.click(await screen.findByRole('button', { name: 'Create shipment' }));

    expect(createShipmentExecutionMock).toHaveBeenCalledWith('alloc-sporjinal-7621783322961', { vendorId: 'sporjinal' });
    expect((await screen.findAllByText('Shipment ke-created-1028 recorded.')).length).toBeGreaterThan(0);
    expect(screen.getByText(/Endpoint:\s*POST \/shipments\/create/)).toBeInTheDocument();
    expect(screen.getByText(/Provider id: yes · Barcode: yes/)).toBeInTheDocument();
    expect(screen.getByText('ke-created-1028')).toBeInTheDocument();
    expect(screen.getByText('barcode-1028')).toBeInTheDocument();
    await waitFor(() => expect(getOrderMock).toHaveBeenCalledTimes(2));
  });

  it('shows visible create shipment API diagnostics when the request fails', async () => {
    const user = userEvent.setup();
    getOrderMock.mockResolvedValue(orderWithoutShipment);
    createShipmentExecutionMock.mockRejectedValueOnce(
      new ApiError('Vendor shipping warehouse is not configured.', 'server', {
        status: 400,
        diagnostics: {
          endpoint: '/shipments/create',
          status: 400,
          requestId: 'req-shipment-1',
          hasAuthHeader: true,
          hasVendorHeader: true,
          selectedVendorPresent: true,
          readinessState: 'ready',
        },
      }),
    );
    setCurrentUser({
      email: 'vendor@example.com',
      name: 'Sporjinal Vendor',
      role: 'vendor',
      vendorAccess: ['sporjinal'],
      vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
      canSwitchVendors: false,
      defaultVendorId: 'sporjinal',
    });

    renderOrderDetail();

    await user.click(await screen.findByRole('button', { name: 'Create shipment' }));

    expect((await screen.findAllByText('Vendor shipping warehouse is not configured.')).length).toBeGreaterThan(0);
    expect(screen.getByText(/Endpoint:\s*\/shipments\/create/)).toBeInTheDocument();
    expect(screen.getByText(/HTTP:\s*400.*Request:\s*req-shipment-1/)).toBeInTheDocument();
  });

  it('shows validation-blocked create shipment errors next to the button', async () => {
    const user = userEvent.setup();
    getOrderMock.mockResolvedValue(orderWithoutShipment);
    createShipmentExecutionMock.mockRejectedValueOnce(
      new Error('Missing required shipment fields:\n- customer.phone\n- customer.postcode\n\nProvider request blocked before create call.'),
    );
    setCurrentUser({
      email: 'vendor@example.com',
      name: 'Sporjinal Vendor',
      role: 'vendor',
      vendorAccess: ['sporjinal'],
      vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
      canSwitchVendors: false,
      defaultVendorId: 'sporjinal',
    });

    renderOrderDetail();

    await user.click(await screen.findByRole('button', { name: 'Create shipment' }));

    expect((await screen.findAllByText(/Missing required shipment fields:/)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/customer\.phone/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Provider request blocked before create call/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Endpoint:\s*POST \/shipments\/create/)).toBeInTheDocument();
  });

  it('matches related returns and finance records across Shopify GID and numeric order ids', async () => {
    setCurrentUser({
      email: 'vendor@example.com',
      name: 'Sporjinal Vendor',
      role: 'vendor',
      vendorAccess: ['sporjinal'],
      vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
      canSwitchVendors: false,
      defaultVendorId: 'sporjinal',
    });
    listReturnsMock.mockResolvedValueOnce([
      {
        originalVendorId: 'sporjinal',
        assignedVendorId: 'sporjinal',
        vendorId: 'sporjinal',
        id: 'return-1028',
        sourceShopifyOrderId: 'gid://shopify/Order/7616544244049',
        sourceShopifyOrderNumber: '#1028',
        sourceShopifyRefundId: '',
        sourceShopifyReturnId: 'gid://shopify/Return/9001',
        sourceType: 'shopify_return_request',
        status: 'Requested',
        relatedOrderId: 'return-related-shopify-id',
        date: '2026-05-15T12:08:00.000Z',
        customer: 'Customer unavailable',
        reason: 'Return requested',
        amount: 'TRY 0.00',
        itemTitle: 'Returned trainer',
        displayTitle: 'Returned trainer',
        refundedSkus: ['FQ1833-200-41'],
      },
    ]);
    getFinanceDashboardMock.mockResolvedValueOnce({
      summary: {
        grossSales: 'TRY 0.00',
        refunds: 'TRY 0.00',
        netRevenue: 'TRY 0.00',
        platformFee: 'TRY 0.00',
        payoutEstimate: 'TRY 0.00',
        totalRevenue: 'TRY 0.00',
        availableBalance: 'TRY 0.00',
        pendingPayouts: 'TRY 0.00',
        refundsThisMonth: 'TRY 0.00',
      },
      transactions: [
        {
          id: 'finance-1028',
          date: '2026-05-15T12:08:00.000Z',
          description: 'Sale recorded',
          counterparty: 'Shopify',
          category: 'Payout',
          amount: 'TRY 4,999.00',
          status: 'Pending',
          shopifyOrderNumber: null,
          shopifyOrderId: 'gid://shopify/Order/7616544244049',
        },
      ],
    });

    renderOrderDetail();

    expect(await screen.findByText('Returned trainer')).toBeInTheDocument();
    expect(screen.getByText('TRY 4,999.00 · Pending')).toBeInTheDocument();
  });

  it('does not show provider response internals to vendors', async () => {
    setCurrentUser({
      email: 'vendor@example.com',
      name: 'Sporjinal Vendor',
      role: 'vendor',
      vendorAccess: ['sporjinal'],
      vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
      canSwitchVendors: false,
      defaultVendorId: 'sporjinal',
    });

    renderOrderDetail();

    expect(await screen.findByText('Order #1028')).toBeInTheDocument();
    expect(screen.queryByText('Order ##1028')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Provider response summary')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Shipping provider diagnostics')).not.toBeInTheDocument();
    expect(screen.queryByText('message, shipment_id')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry live shipment' })).not.toBeInTheDocument();
    expect(getShippingProviderDiagnosticsMock).not.toHaveBeenCalled();
  });
});
