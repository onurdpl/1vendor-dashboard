import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrderDetail } from '../features/orders/api';
import { setCurrentUser, setToken } from '../lib/auth';
import { OrderDetailPage } from './OrderDetailPage';

const getOrderMock = vi.fn<(orderId: string) => Promise<OrderDetail>>();
const getShippingProviderDiagnosticsMock = vi.fn();

vi.mock('../features/orders/api', async () => {
  const actual = await vi.importActual<typeof import('../features/orders/api')>('../features/orders/api');
  return {
    ...actual,
    getOrder: (orderId: string) => getOrderMock(orderId),
    getShippingProviderDiagnostics: () => getShippingProviderDiagnosticsMock(),
    createShipmentExecution: vi.fn(),
    submitFulfillmentTracking: vi.fn(),
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
      shippingExecutionEnabled: false,
      providerEnabled: true,
      baseUrlConfigured: true,
      apiKeyConfigured: true,
      missing: ['SHIPPING_EXECUTION_ENABLED'],
    });
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
    expect(screen.queryByText('test-kargo-key')).not.toBeInTheDocument();
    expect(screen.queryByText(/bearer/i)).not.toBeInTheDocument();
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

    expect(await screen.findByText('Order ##1028')).toBeInTheDocument();
    expect(screen.queryByLabelText('Provider response summary')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Shipping provider diagnostics')).not.toBeInTheDocument();
    expect(screen.queryByText('message, shipment_id')).not.toBeInTheDocument();
    expect(getShippingProviderDiagnosticsMock).not.toHaveBeenCalled();
  });
});
