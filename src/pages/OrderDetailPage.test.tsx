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
const getVendorShippingConfigMock = vi.fn();
const updateVendorShippingConfigMock = vi.fn();
const createShipmentExecutionMock = vi.fn();
const retryShipmentExecutionMock = vi.fn();
const retryFailedShipmentExecutionMock = vi.fn();
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
    getShippingProviderDiagnostics: (options?: { vendorId?: string | null; provider?: 'kargo_entegrator' | 'try_oto' | null }) =>
      getShippingProviderDiagnosticsMock(options),
    getVendorShippingConfig: (options?: { vendorId?: string | null }) => getVendorShippingConfigMock(options),
    updateVendorShippingConfig: (vendorId: string, input: unknown) => updateVendorShippingConfigMock(vendorId, input),
    createShipmentExecution: (allocationId: string, options?: { vendorId?: string | null }) => createShipmentExecutionMock(allocationId, options),
    retryShipmentExecution: (shipmentExecutionId: string) => retryShipmentExecutionMock(shipmentExecutionId),
    retryFailedShipmentExecution: (
      shipmentExecutionId: string,
      options?: { vendorId?: string | null; customerOverrides?: Record<string, string> },
    ) => retryFailedShipmentExecutionMock(shipmentExecutionId, options),
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
      providerValidationErrors: [],
      providerShipmentIdPresent: false,
      trackingNumberPresent: false,
      labelPresent: false,
      barcodePresent: false,
      notificationUrlIncluded: null,
      statusField: 'pending',
      requestId: null,
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
    getShippingProviderDiagnosticsMock.mockImplementation((options?: { provider?: 'kargo_entegrator' | 'try_oto' | null }) => {
      if (options?.provider === 'try_oto') {
        return Promise.resolve({
          provider: 'try_oto',
          supportedProviders: ['kargo_entegrator', 'hepsijet'],
          executionReady: false,
          sandboxModeEnabled: true,
          shippingExecutionEnabled: false,
          providerSelected: false,
          providerEnabled: false,
          webhookIngestEnabled: false,
          baseUrlConfigured: true,
          apiKeyConfigured: true,
          cargoIntegrationIdConfigured: false,
          warehouseIdConfigured: false,
          defaultDesiConfigured: true,
          packageTypeUsed: 'box',
          notificationUrlConfigured: false,
          webhookRouteImplemented: true,
          receiverAddressAvailability: 'confirmed_required',
          dummyKargoSupport: 'not_implemented',
          statusSyncSupport: 'not_implemented',
          missing: ['TRY_OTO_ENABLED'],
          deprecatedEnvFallbacks: [],
          warnings: ['Try OTO is sandbox-only in this phase.'],
        });
      }

      return Promise.resolve({
        provider: 'kargo_entegrator',
        supportedProviders: ['kargo_entegrator', 'hepsijet'],
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
        packageTypeUsed: 'box',
        notificationUrlConfigured: false,
        webhookRouteImplemented: false,
        receiverAddressAvailability: 'confirmed_required',
        dummyKargoSupport: 'not_implemented',
        statusSyncSupport: 'not_implemented',
        missing: ['SHIPPING_EXECUTION_ENABLED'],
        deprecatedEnvFallbacks: [],
        warnings: ['Live carrier execution is not enabled or verified.'],
      });
    });
    getVendorShippingConfigMock.mockReset();
    getVendorShippingConfigMock.mockResolvedValue({
      vendorId: 'sporjinal',
      preferredProvider: 'kargo_entegrator',
      shippingEnabled: true,
      defaultDesi: '3.00',
      cargoIntegrationId: '2547',
      defaultWarehouseId: '1774',
      shippingVatPercent: '18.00',
      warehouses: [
        {
          id: 'warehouse-sporjinal-1774',
          vendorId: 'sporjinal',
          provider: 'kargo_entegrator',
          warehouseId: '1774',
          name: 'Sporjinal warehouse',
          address: null,
          isDefault: true,
        },
      ],
      providerMetadata: {
        packageType: 'box',
      },
      source: 'configured',
      updatedAt: '2026-05-15T19:28:50.786Z',
    });
    updateVendorShippingConfigMock.mockReset();
    updateVendorShippingConfigMock.mockResolvedValue({
      vendorId: 'sporjinal',
      preferredProvider: 'kargo_entegrator',
      shippingEnabled: true,
      defaultDesi: '3.00',
      cargoIntegrationId: '9999',
      defaultWarehouseId: '1774',
      shippingVatPercent: '18.00',
      warehouses: [],
      providerMetadata: {
        packageType: 'box',
      },
      source: 'configured',
      updatedAt: '2026-05-15T19:45:00.000Z',
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
    retryFailedShipmentExecutionMock.mockReset();
    retryFailedShipmentExecutionMock.mockResolvedValue({
      ...orderWithShipmentSummary.shipmentExecution,
      shipmentStatus: 'created',
      providerShipmentId: 'ke-recovered-1028',
      barcode: 'barcode-recovered-1028',
      updatedAt: '2026-05-15T19:45:00.000Z',
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
    expect(screen.getAllByText('Package type').length).toBeGreaterThan(0);
    expect(screen.getAllByText('box').length).toBeGreaterThan(0);
    expect(screen.getByText('Webhook route implemented')).toBeInTheDocument();
    expect(screen.getByText('Dummy Kargo support')).toBeInTheDocument();
    expect(screen.getByText('Live carrier execution is not enabled or verified.')).toBeInTheDocument();
    expect(screen.queryByText('Kargo Entegratör create contract is not verified.')).not.toBeInTheDocument();
    expect(screen.queryByText('Receiver address and phone requirements are unknown.')).not.toBeInTheDocument();
    expect(screen.queryByText('test-kargo-key')).not.toBeInTheDocument();
    expect(screen.queryByText(/bearer/i)).not.toBeInTheDocument();
  });

  it('lets admins update vendor shipping provider configuration and refresh diagnostics', async () => {
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

    expect(await screen.findByLabelText('Shipping provider configuration editor')).toBeInTheDocument();
    const cargoInput = screen.getByLabelText('Cargo integration ID');
    await user.clear(cargoInput);
    await user.type(cargoInput, '9999');
    await user.click(screen.getByRole('button', { name: 'Save shipping config' }));

    await waitFor(() =>
      expect(updateVendorShippingConfigMock).toHaveBeenCalledWith(
        'sporjinal',
        expect.objectContaining({
          preferredProvider: 'kargo_entegrator',
          cargoIntegrationId: '9999',
          defaultWarehouseId: '1774',
          defaultDesi: 3,
          providerMetadata: expect.objectContaining({
            packageType: 'box',
          }),
        }),
      ),
    );
    expect(await screen.findByText('Shipping provider configuration saved.')).toBeInTheDocument();
    await waitFor(() => expect(getShippingProviderDiagnosticsMock).toHaveBeenCalledTimes(3));
    expect(getVendorShippingConfigMock).toHaveBeenCalledWith({ vendorId: 'sporjinal' });
  });

  it('lets admins update Try OTO pickup location configuration', async () => {
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
    getVendorShippingConfigMock.mockResolvedValueOnce({
      vendorId: 'sporjinal',
      preferredProvider: 'try_oto',
      shippingEnabled: true,
      defaultDesi: '3.00',
      cargoIntegrationId: null,
      defaultWarehouseId: null,
      shippingVatPercent: '18.00',
      warehouses: [],
      providerMetadata: {
        tryOtoPickupLocationCode: 'tr-test-store-001',
      },
      source: 'configured',
      updatedAt: '2026-05-15T19:28:50.786Z',
    });
    updateVendorShippingConfigMock.mockResolvedValueOnce({
      vendorId: 'sporjinal',
      preferredProvider: 'try_oto',
      shippingEnabled: true,
      defaultDesi: '3.00',
      cargoIntegrationId: null,
      defaultWarehouseId: null,
      shippingVatPercent: '18.00',
      warehouses: [],
      providerMetadata: {
        tryOtoPickupLocationCode: 'tr-test-store-002',
      },
      source: 'configured',
      updatedAt: '2026-05-15T19:45:00.000Z',
    });

    renderOrderDetail();

    const pickupInput = await screen.findByLabelText('Try OTO pickup location code');
    expect(pickupInput).toHaveValue('tr-test-store-001');
    expect(screen.queryByLabelText('Cargo integration ID')).not.toBeInTheDocument();
    await user.clear(pickupInput);
    await user.type(pickupInput, 'tr-test-store-002');
    await user.click(screen.getByRole('button', { name: 'Save shipping config' }));

    await waitFor(() =>
      expect(updateVendorShippingConfigMock).toHaveBeenCalledWith(
        'sporjinal',
        expect.objectContaining({
          preferredProvider: 'try_oto',
          cargoIntegrationId: null,
          defaultWarehouseId: null,
          defaultDesi: 3,
          warehouses: [],
          providerMetadata: expect.objectContaining({
            tryOtoPickupLocationCode: 'tr-test-store-002',
          }),
        }),
      ),
    );
  });

  it('shows Try OTO provider option when backend diagnostics expose it as supported', async () => {
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
    getShippingProviderDiagnosticsMock.mockImplementation((options?: { provider?: 'kargo_entegrator' | 'try_oto' | null }) =>
      Promise.resolve({
        provider: options?.provider === 'try_oto' ? 'try_oto' : 'kargo_entegrator',
        supportedProviders: ['kargo_entegrator', 'hepsijet', 'try_oto'],
        executionReady: false,
        sandboxModeEnabled: options?.provider === 'try_oto',
        shippingExecutionEnabled: false,
        providerSelected: options?.provider !== 'try_oto',
        providerEnabled: options?.provider === 'try_oto',
        webhookIngestEnabled: false,
        baseUrlConfigured: true,
        apiKeyConfigured: true,
        cargoIntegrationIdConfigured: options?.provider !== 'try_oto',
        warehouseIdConfigured: options?.provider !== 'try_oto',
        defaultDesiConfigured: true,
        packageTypeUsed: 'box',
        notificationUrlConfigured: false,
        webhookRouteImplemented: true,
        receiverAddressAvailability: 'confirmed_required',
        dummyKargoSupport: 'not_implemented',
        statusSyncSupport: 'not_implemented',
        missing: [],
        deprecatedEnvFallbacks: [],
        warnings: [],
      }),
    );

    renderOrderDetail();

    const providerSelect = await screen.findByLabelText('Provider');
    expect(providerSelect).toHaveValue('kargo_entegrator');
    expect(screen.getByRole('option', { name: 'Try OTO' })).toBeInTheDocument();
    await user.selectOptions(providerSelect, 'try_oto');
    expect(await screen.findByLabelText('Try OTO pickup location code')).toBeInTheDocument();
    expect(screen.queryByLabelText('Cargo integration ID')).not.toBeInTheDocument();
  });

  it('keeps Try OTO config editing hidden from vendors', async () => {
    setCurrentUser({
      email: 'vendor@demo.com',
      name: 'Demo Vendor',
      role: 'vendor',
      vendorAccess: ['sporjinal'],
      vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
      canSwitchVendors: false,
      defaultVendorId: 'sporjinal',
    });
    getVendorShippingConfigMock.mockResolvedValueOnce({
      vendorId: 'sporjinal',
      preferredProvider: 'try_oto',
      shippingEnabled: true,
      defaultDesi: '3.00',
      cargoIntegrationId: null,
      defaultWarehouseId: null,
      shippingVatPercent: '18.00',
      warehouses: [],
      providerMetadata: {
        tryOtoPickupLocationCode: 'tr-test-store-001',
      },
      source: 'configured',
      updatedAt: '2026-05-15T19:28:50.786Z',
    });

    renderOrderDetail();

    await screen.findByText('Order #1028');
    expect(screen.queryByLabelText('Shipping provider configuration editor')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Try OTO pickup location code')).not.toBeInTheDocument();
  });

  it('renders shipping config editor fields for admins on active order detail actions', async () => {
    getOrderMock.mockResolvedValue({
      ...orderWithoutShipment,
      shipmentExecution: null,
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

    expect(await screen.findByLabelText('Shipping provider configuration editor')).toBeInTheDocument();
    expect(screen.getByLabelText('Cargo integration ID')).toHaveValue('2547');
    expect(screen.getByLabelText('Warehouse ID')).toHaveValue('1774');
    expect(screen.getByLabelText('Default desi')).toHaveValue(3);
    expect(screen.getByLabelText('Package type')).toHaveValue('box');
    expect(screen.getByRole('button', { name: 'Save shipping config' })).toBeInTheDocument();
  });

  it('blocks invalid admin shipping provider configuration before save', async () => {
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

    const warehouseInput = await screen.findByLabelText('Warehouse ID');
    await user.clear(warehouseInput);
    await user.type(warehouseInput, 'warehouse-1774');
    await user.click(screen.getByRole('button', { name: 'Save shipping config' }));

    expect(await screen.findByText('Warehouse ID must be numeric.')).toBeInTheDocument();
    expect(updateVendorShippingConfigMock).not.toHaveBeenCalled();
  });

  it('renders safe admin provider validation diagnostics for failed shipments', async () => {
    getOrderMock.mockResolvedValueOnce({
      ...orderWithShipmentSummary,
      shipmentExecution: {
        ...orderWithShipmentSummary.shipmentExecution!,
        shipmentStatus: 'failed',
        providerResponseSummary: {
          ...orderWithShipmentSummary.shipmentExecution!.providerResponseSummary!,
          httpStatus: 422,
          ok: false,
          providerError: 'Validation failed.',
          providerValidationErrors: ['The district field is required.'],
          requestId: 'ke-req-422',
          barcodePresent: false,
          notificationUrlIncluded: true,
          responseSnippet: '{"message":"Validation failed."}',
          requestPath: '/api/shipments',
          selectedEnvironment: 'production',
          requestTargetHostname: 'app.kargoentegrator.com',
          providerMode: 'live',
          payloadDiagnostics: {
            topLevelKeys: ['cargo_integration_id', 'customer', 'payment_type'],
            customerKeys: ['address', 'city', 'district', 'phone'],
            receiverKeys: [],
            cargoIntegrationIdPresent: true,
            warehouseIdPresent: true,
            paymentType: 'cash_money',
            packageType: 'box',
            payorType: 'sender',
            kgPresent: true,
            kgType: 'number',
            desiPresent: true,
            desiType: 'number',
            platformIdPresent: true,
            platformDIdPresent: true,
            customerPhonePresent: true,
            customerDistrictPresent: false,
            customerCityPresent: true,
            addressFieldPresence: {
              customerAddress: true,
              customerPostcode: true,
              customerCountry: true,
              customerCity: true,
              customerDistrict: false,
            },
          },
        },
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
    expect(screen.getByText('Validation failed.')).toBeInTheDocument();
    expect(screen.getByText('Payload keys')).toBeInTheDocument();
    expect(screen.getByText(/cargo_integration_id, customer, payment_type/)).toBeInTheDocument();
    expect(screen.getByText('Shipment enums')).toBeInTheDocument();
    expect(screen.getByText(/payment cash_money · package box · payor sender/)).toBeInTheDocument();
    expect(screen.getByText('Customer required fields')).toBeInTheDocument();
    expect(screen.getByText(/phone yes · district no · city yes/)).toBeInTheDocument();
    expect(screen.getByText('Shipment recovery')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry shipment' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry provider request' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reset failed execution' })).toBeDisabled();
    expect(screen.getByRole('link', { name: 'View diagnostics' })).toBeInTheDocument();
    expect(screen.queryByText(/test-kargo-key/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/\+905551112233/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Test Mahallesi/)).not.toBeInTheDocument();
  });

  it('renders the existing district completion input for admin failed Kargo shipments', async () => {
    getOrderMock.mockResolvedValueOnce({
      ...orderWithShipmentSummary,
      shipmentExecution: {
        ...orderWithShipmentSummary.shipmentExecution!,
        shipmentStatus: 'failed',
        providerResponseSummary: {
          ...orderWithShipmentSummary.shipmentExecution!.providerResponseSummary!,
          ok: false,
          httpStatus: 422,
          providerError: 'Validation failed.',
          providerValidationErrors: ['The district field is required.'],
          dryRun: false,
          disabledGates: [],
        },
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

    expect(await screen.findByText('Complete shipment-only fields')).toBeInTheDocument();
    expect(screen.getAllByLabelText('District *')).toHaveLength(1);
    expect(screen.queryByLabelText('Phone *')).not.toBeInTheDocument();
  });

  it('renders the existing district completion input for vendor retry and submits customer.district', async () => {
    const user = userEvent.setup();
    getOrderMock.mockResolvedValue({
      ...orderWithShipmentSummary,
      shipmentExecution: {
        ...orderWithShipmentSummary.shipmentExecution!,
        shipmentStatus: 'failed',
        providerResponseSummary: {
          ...orderWithShipmentSummary.shipmentExecution!.providerResponseSummary!,
          ok: false,
          httpStatus: 422,
          providerError: 'Müşteri ilçe bilgisi zorunludur.',
          providerValidationErrors: ['Müşteri ilçe bilgisi zorunludur.'],
          dryRun: false,
          disabledGates: [],
          payloadDiagnostics: {
            topLevelKeys: ['customer'],
            customerKeys: ['address', 'district', 'phone'],
            receiverKeys: [],
            cargoIntegrationIdPresent: true,
            warehouseIdPresent: true,
            paymentType: 'cash_money',
            packageType: 'box',
            payorType: 'sender',
            kgPresent: true,
            kgType: 'number',
            desiPresent: true,
            desiType: 'number',
            platformIdPresent: true,
            platformDIdPresent: true,
            customerPhonePresent: true,
            customerDistrictPresent: false,
            customerCityPresent: true,
            addressFieldPresence: {
              customerAddress: true,
              customerPostcode: true,
              customerCountry: true,
              customerCity: true,
              customerDistrict: false,
            },
          },
        },
      },
    });
    retryFailedShipmentExecutionMock.mockResolvedValueOnce({
      ...orderWithShipmentSummary.shipmentExecution!,
      shipmentStatus: 'created',
      providerShipmentId: 'ke-recovered-1028',
      barcode: 'barcode-recovered-1028',
      updatedAt: '2026-05-15T19:45:00.000Z',
    });
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

    expect(screen.queryByText('Payload keys')).not.toBeInTheDocument();
    expect(screen.queryByText('Provider response summary')).not.toBeInTheDocument();
    await user.type(await screen.findByLabelText('District *'), 'Kadikoy');
    await user.click(screen.getByRole('button', { name: 'Retry shipment with completed fields' }));

    await waitFor(() =>
      expect(retryFailedShipmentExecutionMock).toHaveBeenCalledWith('shipment-kargo_entegrator-alloc-sporjinal-7621783322961', {
        vendorId: 'sporjinal',
        customerOverrides: {
          district: 'Kadikoy',
        },
      }),
    );
  });

  it('retries failed shipment executions and refreshes order detail', async () => {
    const user = userEvent.setup();
    getOrderMock.mockResolvedValue({
      ...orderWithShipmentSummary,
      shipmentExecution: {
        ...orderWithShipmentSummary.shipmentExecution!,
        shipmentStatus: 'failed',
        providerResponseSummary: {
          ...orderWithShipmentSummary.shipmentExecution!.providerResponseSummary!,
          ok: false,
          httpStatus: 422,
          providerError: 'Validation failed.',
          providerValidationErrors: ['customer.district is required'],
          dryRun: false,
          disabledGates: [],
        },
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

    await user.click(await screen.findByRole('button', { name: 'Retry shipment' }));

    expect(retryFailedShipmentExecutionMock).toHaveBeenCalledWith('shipment-kargo_entegrator-alloc-sporjinal-7621783322961', {
      vendorId: 'sporjinal',
      customerOverrides: undefined,
    });
    expect((await screen.findAllByText('Shipment ke-recovered-1028 recorded.')).length).toBeGreaterThan(0);
    expect(screen.getByText(/Endpoint:\s*POST \/shipments\/shipment-kargo_entegrator-alloc-sporjinal-7621783322961\/retry/)).toBeInTheDocument();
    await waitFor(() => expect(getOrderMock).toHaveBeenCalledTimes(2));
  });

  it('renders retry action for failed shipments even when provider response summary is missing', async () => {
    getOrderMock.mockResolvedValue({
      ...orderWithShipmentSummary,
      shipmentExecution: {
        ...orderWithShipmentSummary.shipmentExecution!,
        shipmentStatus: 'Failed',
        providerResponseSummary: null,
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

    expect(await screen.findByLabelText('Shipment retry eligibility')).toBeInTheDocument();
    expect(screen.getByText(/Retry eligible:\s*yes/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry shipment' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View diagnostics' })).toBeInTheDocument();
  });

  it('does not render unsafe failed retry when barcode success evidence exists', async () => {
    getOrderMock.mockResolvedValue({
      ...orderWithShipmentSummary,
      shipmentExecution: {
        ...orderWithShipmentSummary.shipmentExecution!,
        shipmentStatus: 'Failed',
        barcode: 'BARCODE-1028',
        providerResponseSummary: null,
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

    expect(await screen.findByLabelText('Shipment retry eligibility')).toBeInTheDocument();
    expect(screen.getByText(/Retry eligible:\s*no · Barcode already exists/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry shipment' })).not.toBeInTheDocument();
  });

  it('keeps manual tracking separate from failed provider retry actions', async () => {
    getOrderMock.mockResolvedValue({
      ...orderWithShipmentSummary,
      shipmentExecution: {
        ...orderWithShipmentSummary.shipmentExecution!,
        shipmentStatus: 'Failed',
        providerResponseSummary: null,
      },
    });
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

    expect(await screen.findByRole('button', { name: 'Retry shipment' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add tracking information' })).toBeInTheDocument();
  });

  it('uses completed shipment-only fields when retrying a failed execution', async () => {
    const user = userEvent.setup();
    getOrderMock.mockResolvedValue({
      ...orderWithShipmentSummary,
      shipmentExecution: {
        ...orderWithShipmentSummary.shipmentExecution!,
        shipmentStatus: 'failed',
        providerResponseSummary: {
          ...orderWithShipmentSummary.shipmentExecution!.providerResponseSummary!,
          ok: false,
          httpStatus: 400,
          providerError: 'Missing required shipment fields.',
          providerValidationErrors: ['customer.district is required'],
          dryRun: false,
          disabledGates: [],
        },
      },
    });
    retryFailedShipmentExecutionMock
      .mockRejectedValueOnce(new Error('Missing required shipment fields:\n- customer.district\n\nProvider request blocked before create call.'))
      .mockResolvedValueOnce({
        ...orderWithShipmentSummary.shipmentExecution!,
        shipmentStatus: 'created',
        providerShipmentId: 'ke-recovered-1028',
        barcode: 'barcode-recovered-1028',
        updatedAt: '2026-05-15T19:45:00.000Z',
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

    await user.click(await screen.findByRole('button', { name: 'Retry shipment' }));
    expect(await screen.findByText('Complete shipment-only fields')).toBeInTheDocument();
    await user.type(screen.getByLabelText('District *'), 'Kadikoy');
    await user.click(screen.getByRole('button', { name: 'Retry shipment with completed fields' }));

    await waitFor(() =>
      expect(retryFailedShipmentExecutionMock).toHaveBeenLastCalledWith('shipment-kargo_entegrator-alloc-sporjinal-7621783322961', {
        vendorId: 'sporjinal',
        customerOverrides: {
          district: 'Kadikoy',
        },
      }),
    );
  });

  it('does not expose failed shipment recovery when provider identifiers already exist', async () => {
    getOrderMock.mockResolvedValueOnce({
      ...orderWithShipmentSummary,
      shipmentExecution: {
        ...orderWithShipmentSummary.shipmentExecution!,
        shipmentStatus: 'failed',
        providerShipmentId: 'ke-created-1028',
        providerResponseSummary: {
          ...orderWithShipmentSummary.shipmentExecution!.providerResponseSummary!,
          ok: false,
          dryRun: false,
          disabledGates: [],
        },
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
    expect(screen.queryByText('Shipment recovery')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry shipment' })).not.toBeInTheDocument();
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

    expect(createShipmentExecutionMock).toHaveBeenCalledWith('alloc-sporjinal-7621783322961', {
      vendorId: 'sporjinal',
      customerOverrides: undefined,
    });
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

  it('renders missing shipment field inputs and retries with shipment-only overrides', async () => {
    const user = userEvent.setup();
    getOrderMock.mockResolvedValue(orderWithoutShipment);
    createShipmentExecutionMock
      .mockRejectedValueOnce(
        new Error('Missing required shipment fields:\n- customer.district\n\nProvider request blocked before create call.'),
      )
      .mockResolvedValueOnce({
        id: 'shipment-created-1028',
        allocationId: 'alloc-sporjinal-7621783322961',
        vendorId: 'sporjinal',
        provider: 'kargo_entegrator',
        providerShipmentId: 'ke-created-1028',
        trackingNumber: null,
        trackingUrl: null,
        labelUrl: null,
        shipmentStatus: 'created',
        desi: '3.00',
        shippingCost: null,
        shippingVat: null,
        currency: 'TRY',
        shippingCostLinked: false,
        barcode: 'barcode-1028',
        createdAt: '2026-05-15T10:00:00.000Z',
        updatedAt: '2026-05-15T10:00:00.000Z',
      });
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

    expect(await screen.findByText('Complete shipment-only fields')).toBeInTheDocument();
    expect(screen.getByLabelText('District *')).toBeInTheDocument();
    expect(screen.queryByLabelText('Phone *')).not.toBeInTheDocument();

    await user.type(screen.getByLabelText('District *'), 'Kadikoy');
    await user.click(screen.getByRole('button', { name: 'Create shipment with completed fields' }));

    await waitFor(() =>
      expect(createShipmentExecutionMock).toHaveBeenLastCalledWith('alloc-sporjinal-7621783322961', {
        vendorId: 'sporjinal',
        customerOverrides: {
          district: 'Kadikoy',
        },
      }),
    );
    expect((await screen.findAllByText('Shipment ke-created-1028 recorded.')).length).toBeGreaterThan(0);
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
    expect(screen.queryByLabelText('Shipping provider configuration editor')).not.toBeInTheDocument();
    expect(screen.queryByText('message, shipment_id')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry live shipment' })).not.toBeInTheDocument();
    expect(getShippingProviderDiagnosticsMock).not.toHaveBeenCalled();
    expect(getVendorShippingConfigMock).not.toHaveBeenCalled();
  });
});
