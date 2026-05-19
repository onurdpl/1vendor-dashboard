import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
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
const refreshShipmentExecutionStatusMock = vi.fn();
const createReturnShipmentLabelMock = vi.fn();
const probeShopifyReturnLabelUploadMock = vi.fn();
const probeTryOtoReturnDetailsMock = vi.fn();
const probeTryOtoReturnLinkMock = vi.fn();
const probeTryOtoReturnAwbPrintMock = vi.fn();
const submitFulfillmentTrackingMock = vi.fn();
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
    refreshShipmentExecutionStatus: (shipmentExecutionId: string, options?: { vendorId?: string | null }) =>
      refreshShipmentExecutionStatusMock(shipmentExecutionId, options),
    createReturnShipmentLabel: (shipmentExecutionId: string, options?: { vendorId?: string | null }) =>
      createReturnShipmentLabelMock(shipmentExecutionId, options),
    probeShopifyReturnLabelUpload: (shipmentExecutionId: string) => probeShopifyReturnLabelUploadMock(shipmentExecutionId),
    probeTryOtoReturnDetails: (shipmentExecutionId: string) => probeTryOtoReturnDetailsMock(shipmentExecutionId),
    probeTryOtoReturnLink: (shipmentExecutionId: string) => probeTryOtoReturnLinkMock(shipmentExecutionId),
    probeTryOtoReturnAwbPrint: (shipmentExecutionId: string) => probeTryOtoReturnAwbPrintMock(shipmentExecutionId),
    submitFulfillmentTracking: (
      allocationId: string,
      payload: { trackingNumber: string; carrier: string; trackingUrl?: string; notifyCustomer?: boolean },
    ) => submitFulfillmentTrackingMock(allocationId, payload),
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
    refreshShipmentExecutionStatusMock.mockReset();
    refreshShipmentExecutionStatusMock.mockResolvedValue({
      ...orderWithShipmentSummary.shipmentExecution,
      provider: 'try_oto',
      shipmentStatus: 'created',
      providerShipmentId: 'OTO-SHIP-1028',
      trackingNumber: 'OTO-TRACK-1028',
      barcode: 'OTO-BARCODE-1028',
      labelUrl: 'https://app.tryoto.example/label-1028.pdf',
      updatedAt: '2026-05-15T19:46:00.000Z',
    });
    createReturnShipmentLabelMock.mockReset();
    createReturnShipmentLabelMock.mockResolvedValue({
      ...orderWithShipmentSummary.shipmentExecution,
      provider: 'try_oto',
      shipmentStatus: 'delivered',
      providerShipmentId: 'OTO-SHIP-1028',
      trackingNumber: 'OTO-TRACK-1028',
      returnShipment: {
        provider: 'try_oto',
        returnOrderId: 'OTO-ORDER-1028-R1',
        trackingNumber: 'RET-TRACK-1028',
        trackingUrl: null,
        labelUrl: 'https://app.tryoto.example/return-label-1028.pdf',
        barcode: 'RET-BARCODE-1028',
        status: 'created',
        createdAt: '2026-05-15T19:46:00.000Z',
        requestKeys: ['items', 'orderId'],
        responseKeys: ['printAWBURL', 'returnOrderId'],
        trackingPresent: true,
        labelPresent: true,
        labelRetrievalConfirmed: true,
        labelRetrievalNote: null,
      },
      updatedAt: '2026-05-15T19:46:00.000Z',
    });
    probeShopifyReturnLabelUploadMock.mockReset();
    probeShopifyReturnLabelUploadMock.mockResolvedValue({
      ...orderWithShipmentSummary.shipmentExecution,
      provider: 'try_oto',
      shipmentStatus: 'delivered',
      providerShipmentId: 'OTO-SHIP-1028',
      trackingNumber: 'OTO-TRACK-1028',
      returnShipment: {
        provider: 'try_oto',
        returnOrderId: 'OTO-ORDER-1028-R1',
        trackingNumber: 'RET-TRACK-1028',
        trackingUrl: null,
        labelUrl: 'https://app.tryoto.example/return-label-1028.pdf',
        barcode: 'RET-BARCODE-1028',
        status: 'created',
        createdAt: '2026-05-15T19:46:00.000Z',
        requestKeys: ['items', 'orderId'],
        responseKeys: ['printAWBURL', 'returnOrderId'],
        trackingPresent: true,
        labelPresent: true,
        labelRetrievalConfirmed: true,
        labelRetrievalNote: null,
        shopifyReturnLabelUploadProbe: {
          status: 'success',
          attemptedAt: '2026-05-15T19:48:00.000Z',
          reverseFulfillmentOrderIdPresent: true,
          reverseLineItemIdsPresent: true,
          mutationUsed: 'reverseDeliveryCreateWithShipping',
          shopifyUserErrors: [],
          reverseDeliveryIdPresent: true,
          labelAccepted: true,
          skippedReason: null,
          errorMessage: null,
        },
      },
      updatedAt: '2026-05-15T19:48:00.000Z',
    });
    probeTryOtoReturnDetailsMock.mockReset();
    probeTryOtoReturnDetailsMock.mockResolvedValue({
      ...orderWithShipmentSummary.shipmentExecution,
      provider: 'try_oto',
      shipmentStatus: 'delivered',
      providerShipmentId: 'OTO-SHIP-1028',
      trackingNumber: 'OTO-TRACK-1028',
      returnShipment: {
        provider: 'try_oto',
        returnOrderId: 'OTO-ORDER-1028-R1',
        trackingNumber: 'RET-TRACK-1028',
        trackingUrl: null,
        labelUrl: 'https://app.tryoto.example/return-label-1028.pdf',
        barcode: 'RET-BARCODE-1028',
        status: 'created',
        createdAt: '2026-05-15T19:46:00.000Z',
        requestKeys: ['items', 'orderId'],
        responseKeys: ['returnOrderId'],
        trackingPresent: true,
        labelPresent: true,
        labelRetrievalConfirmed: true,
        labelRetrievalNote: null,
        finalized: true,
        labelRetrievable: true,
        providerStatusSource: 'getReturnDetails',
        detailsProbe: {
          status: 'success',
          attemptedAt: '2026-05-15T19:49:00.000Z',
          endpoint: '/rest/v2/getReturnDetails',
          httpStatus: 200,
          responseKeys: ['data'],
          nestedKeys: ['data.printAWBURL', 'data.trackingNumber'],
          labelLikeFieldsPresent: true,
          awbLikeFieldsPresent: true,
          pdfLikeFieldsPresent: false,
          urlLikeFieldsPresent: true,
          trackingPresent: true,
          barcodePresent: true,
          providerStatus: 'created',
          labelUrlPresent: true,
          errorMessage: null,
        },
      },
      updatedAt: '2026-05-15T19:49:00.000Z',
    });
    probeTryOtoReturnLinkMock.mockReset();
    probeTryOtoReturnLinkMock.mockResolvedValue({
      ...orderWithShipmentSummary.shipmentExecution,
      provider: 'try_oto',
      shipmentStatus: 'delivered',
      providerShipmentId: 'OTO-SHIP-1028',
      trackingNumber: 'OTO-TRACK-1028',
      returnShipment: {
        provider: 'try_oto',
        returnOrderId: 'OTO-ORDER-1028-R1',
        trackingNumber: 'RET-TRACK-1028',
        trackingUrl: null,
        labelUrl: 'https://app.tryoto.example/return-label-1028.pdf',
        barcode: 'RET-BARCODE-1028',
        status: 'created',
        createdAt: '2026-05-15T19:46:00.000Z',
        requestKeys: ['items', 'orderId'],
        responseKeys: ['returnOrderId'],
        trackingPresent: true,
        labelPresent: true,
        labelRetrievalConfirmed: true,
        labelRetrievalNote: null,
        finalized: true,
        labelRetrievable: true,
        providerStatusSource: 'getReturnLink',
        linkProbe: {
          status: 'success',
          attemptedAt: '2026-05-15T19:50:00.000Z',
          endpoint: '/rest/v2/getReturnLink',
          httpStatus: 200,
          responseKeys: ['data'],
          nestedKeys: ['data.printAWBURL'],
          labelLikeFieldsPresent: true,
          awbLikeFieldsPresent: true,
          pdfLikeFieldsPresent: false,
          urlLikeFieldsPresent: true,
          actionUrlPresent: false,
          trackingPresent: false,
          barcodePresent: false,
          providerStatus: null,
          labelUrlPresent: true,
          providerMessage: null,
          errorMessage: null,
        },
      },
      updatedAt: '2026-05-15T19:50:00.000Z',
    });
    probeTryOtoReturnAwbPrintMock.mockReset();
    probeTryOtoReturnAwbPrintMock.mockResolvedValue({
      ...orderWithShipmentSummary.shipmentExecution,
      provider: 'try_oto',
      shipmentStatus: 'delivered',
      providerShipmentId: 'OTO-SHIP-1028',
      trackingNumber: 'OTO-TRACK-1028',
      returnShipment: {
        provider: 'try_oto',
        returnOrderId: 'OTO-ORDER-1028-R1',
        trackingNumber: 'RET-TRACK-1028',
        trackingUrl: null,
        labelUrl: 'https://app.tryoto.example/return-label-1028.pdf',
        barcode: 'RET-BARCODE-1028',
        status: 'created',
        createdAt: '2026-05-15T19:46:00.000Z',
        requestKeys: ['returnOrderId', 'printReverseShipment'],
        responseKeys: ['printAWBURL', 'returnOrderId'],
        trackingPresent: true,
        labelPresent: true,
        labelRetrievalConfirmed: true,
        labelRetrievalNote: null,
        finalized: true,
        labelRetrievable: true,
        providerStatusSource: 'return AWB print',
        awbPrintProbe: {
          status: 'success',
          attemptedAt: '2026-05-15T19:51:00.000Z',
          endpoint: '/rest/v2/print/OTO-ORDER-1028-R1?printReverseShipment=true',
          httpStatus: 200,
          responseKeys: ['printAWBURL', 'trackingNumber'],
          nestedKeys: ['printAWBURL', 'trackingNumber'],
          labelLikeFieldsPresent: true,
          awbLikeFieldsPresent: true,
          pdfLikeFieldsPresent: false,
          urlLikeFieldsPresent: true,
          trackingPresent: true,
          barcodePresent: true,
          providerStatus: 'created',
          labelUrlPresent: true,
          providerMessage: null,
          errorMessage: null,
        },
      },
      updatedAt: '2026-05-15T19:51:00.000Z',
    });
    submitFulfillmentTrackingMock.mockReset();
    submitFulfillmentTrackingMock.mockResolvedValue({
      ok: true,
      allocationId: 'alloc-sporjinal-7621783322961',
      trackingNumber: 'OTO-TRACK-1028',
      carrier: 'Sürat Kargo',
      trackingUrl: 'https://tracking.tryoto.example/OTO-TRACK-1028',
      notifyCustomer: false,
      fulfillmentStatus: 'fulfillment_submitted',
      shippingStatus: 'shipped',
      shopifySyncSource: 'shopify_admin',
      shopifyFulfillmentId: 'gid://shopify/Fulfillment/123',
      fulfilledAt: '2026-05-15T19:47:00.000Z',
      shipmentCreatedAt: '2026-05-15T19:46:00.000Z',
      shipmentUpdatedAt: '2026-05-15T19:47:00.000Z',
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
        tryOtoOriginCity: 'Istanbul',
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
        tryOtoOriginCity: 'Ankara',
      },
      source: 'configured',
      updatedAt: '2026-05-15T19:45:00.000Z',
    });
    renderOrderDetail();

    const pickupInput = await screen.findByLabelText('Try OTO pickup location code');
    const originCityInput = await screen.findByLabelText('Try OTO origin city');
    expect(pickupInput).toHaveValue('tr-test-store-001');
    expect(originCityInput).toHaveValue('Istanbul');
    expect(screen.queryByLabelText('Cargo integration ID')).not.toBeInTheDocument();
    await user.clear(pickupInput);
    await user.type(pickupInput, 'tr-test-store-002');
    await user.clear(originCityInput);
    await user.type(originCityInput, 'Ankara');
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
            tryOtoOriginCity: 'Ankara',
          }),
        }),
      ),
    );
  });

  it('shows Try OTO as selected in admin diagnostics when vendor config uses Try OTO', async () => {
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
        tryOtoOriginCity: 'Istanbul',
      },
      source: 'configured',
      updatedAt: '2026-05-15T19:28:50.786Z',
    });
    getShippingProviderDiagnosticsMock.mockImplementation((options?: { provider?: 'kargo_entegrator' | 'try_oto' | null }) =>
      Promise.resolve({
        provider: options?.provider === 'try_oto' ? 'try_oto' : 'kargo_entegrator',
        supportedProviders: ['kargo_entegrator', 'hepsijet', 'try_oto'],
        executionReady: options?.provider === 'try_oto',
        sandboxModeEnabled: options?.provider === 'try_oto',
        shippingExecutionEnabled: true,
        providerSelected: options?.provider === 'try_oto',
        providerEnabled: true,
        webhookIngestEnabled: false,
        baseUrlConfigured: true,
        apiKeyConfigured: true,
        cargoIntegrationIdConfigured: options?.provider !== 'try_oto',
        warehouseIdConfigured: true,
        defaultDesiConfigured: true,
        packageTypeUsed: 'box',
        notificationUrlConfigured: false,
        webhookRouteImplemented: true,
        receiverAddressAvailability: 'confirmed_required',
        dummyKargoSupport: 'not_implemented',
        statusSyncSupport: 'not_implemented',
        missing: [],
        deprecatedEnvFallbacks: [],
        warnings: ['Try OTO is sandbox-only in this phase.'],
      }),
    );

    renderOrderDetail();

    expect(await screen.findByText('Try OTO pickup location')).toBeInTheDocument();
    expect(screen.getByText('tr-test-store-001')).toBeInTheDocument();
    const selectedRow = screen.getByText('Provider selected').closest('.summary-row');
    expect(selectedRow).toHaveTextContent('yes');
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
    expect(screen.getByLabelText('Try OTO origin city')).toBeInTheDocument();
    expect(screen.queryByLabelText('Cargo integration ID')).not.toBeInTheDocument();
  });

  it('keeps shipment actions available for vendor orders when Try OTO is the saved provider', async () => {
    getOrderMock.mockResolvedValue(orderWithoutShipment);
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
        tryOtoOriginCity: 'Istanbul',
      },
      source: 'configured',
      updatedAt: '2026-05-15T19:28:50.786Z',
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

    expect(await screen.findByRole('button', { name: 'Create shipment' })).toBeInTheDocument();
    expect(screen.queryByText('Shipping actions are currently unavailable.')).not.toBeInTheDocument();
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
    expect(screen.queryByLabelText('Try OTO origin city')).not.toBeInTheDocument();
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

  it('renders admin-only Try OTO shipment finalization diagnostics', async () => {
    getOrderMock.mockResolvedValueOnce({
      ...orderWithShipmentSummary,
      shipmentExecution: {
        ...orderWithShipmentSummary.shipmentExecution!,
        provider: 'try_oto',
        shipmentStatus: 'created',
        providerShipmentId: 'OTO-ORDER-1028',
        providerResponseSummary: {
          ...orderWithShipmentSummary.shipmentExecution!.providerResponseSummary!,
          dryRun: false,
          disabledGates: [],
          providerShipmentIdPresent: true,
          payloadDiagnostics: {
            topLevelKeys: ['amount', 'customer', 'orderId', 'pickupLocationCode'],
            customerKeys: ['address', 'city', 'country', 'district', 'mobile', 'name'],
            receiverKeys: [],
            cargoIntegrationIdPresent: false,
            warehouseIdPresent: false,
            paymentType: null,
            packageType: null,
            payorType: null,
            kgPresent: false,
            kgType: null,
            desiPresent: false,
            desiType: null,
            platformIdPresent: false,
            platformDIdPresent: false,
            customerPhonePresent: false,
            customerDistrictPresent: true,
            customerCityPresent: true,
            deliveryOptionIdPresent: false,
            addressFieldPresence: {
              customerAddress: false,
              customerPostcode: false,
              customerCountry: false,
              customerCity: true,
              customerDistrict: true,
            },
          },
          tryOtoFinalization: {
            createOrderSuccess: true,
            createShipmentCalled: true,
            createShipmentSuccess: true,
            createShipmentResponseKeys: ['message', 'success'],
            createShipmentProviderMessage: 'create shipment request is received.',
            createShipmentProviderErrorCode: null,
            createShipmentEndpoint: '/rest/v2/createShipment',
            createShipmentResponseStatus: 200,
            createShipmentRequestKeys: ['deliveryOptionId', 'orderId'],
            createShipmentDeliveryOptionIdPresent: true,
            deliveryOptionIdPresent: true,
            orderStatusValue: 'Depoya Atandı',
            deliveryOptionLookupCalled: true,
            deliveryOptionLookupSuccess: true,
            deliveryOptionLookupOptionCount: 1,
            selectedDeliveryCompanyName: 'surat-kargo-marketplace',
            selectedDeliveryOptionIdPresent: true,
            deliveryOptionLookupEndpoint: '/rest/v2/checkOTODeliveryFee',
            deliveryOptionLookupRequestKeys: ['currency', 'customer', 'destinationCity', 'packageWeight', 'payment_method', 'pickupLocationCode', 'weight'],
            deliveryOptionLookupRequestPresence: {
              pickupLocationCode: true,
              originCity: false,
              packageWeight: true,
              weight: true,
              customerCity: true,
              customerCountry: true,
              paymentMethod: true,
            },
            deliveryOptionLookupSourcePresence: {
              pickupLocationCode: true,
              originCity: true,
              packageWeight: true,
              customerCity: true,
              customerCountry: true,
              paymentMethod: true,
            },
            deliveryOptionLookupResponseStatus: 200,
            deliveryOptionLookupResponseKeys: ['deliveryCompany', 'success'],
            deliveryOptionLookupResponseBodyKeys: ['deliveryCompany', 'success'],
            deliveryOptionLookupResponseHasDeliveryOptionId: true,
            deliveryOptionLookupResponseHasDeliveryCompanyName: true,
            deliveryOptionLookupResponseHasPricing: true,
            deliveryOptionLookupResponsePricingKeys: ['currency', 'price'],
            deliveryOptionLookupWeightFieldNames: ['weight', 'packageWeight'],
            deliveryOptionLookupNumericWeightPresent: true,
            deliveryOptionLookupWeightType: 'number',
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
    expect(screen.getByText('Delivery option')).toBeInTheDocument();
    expect(screen.getByText('missing')).toBeInTheDocument();
    expect(screen.getByText('Try OTO createOrder')).toBeInTheDocument();
    expect(screen.getByText('Try OTO createShipment')).toBeInTheDocument();
    expect(screen.getAllByText(/called yes · success yes/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Delivery option lookup')).toBeInTheDocument();
    expect(screen.getByText(/called yes · success yes · options 1/)).toBeInTheDocument();
    expect(screen.getByText('Delivery lookup endpoint')).toBeInTheDocument();
    expect(screen.getByText('/rest/v2/checkOTODeliveryFee')).toBeInTheDocument();
    expect(screen.getByText('Delivery lookup request keys')).toBeInTheDocument();
    expect(screen.getByText('currency, customer, destinationCity, packageWeight, payment_method, pickupLocationCode, weight')).toBeInTheDocument();
    expect(screen.getByText('Delivery lookup payload fields')).toBeInTheDocument();
    expect(screen.getByText(/pickup yes · origin no · weight yes · lookup\.weight yes · customer\.city yes · customer\.country yes · payment yes/)).toBeInTheDocument();
    expect(screen.getByText('Delivery lookup source fields')).toBeInTheDocument();
    expect(screen.getByText(/pickup yes · origin yes · weight yes · lookup\.weight — · customer\.city yes · customer\.country yes · payment yes/)).toBeInTheDocument();
    expect(screen.getByText('Delivery lookup response')).toBeInTheDocument();
    expect(screen.getByText(/HTTP 200 · keys deliveryCompany, success/)).toBeInTheDocument();
    expect(screen.getByText('Delivery lookup response options')).toBeInTheDocument();
    expect(screen.getByText(/deliveryOptionId yes · company yes · pricing yes \(currency, price\)/)).toBeInTheDocument();
    expect(screen.getByText('Delivery lookup weight fields')).toBeInTheDocument();
    expect(screen.getByText(/weight, packageWeight · numeric yes \(number\)/)).toBeInTheDocument();
    expect(screen.getByText('Selected delivery option')).toBeInTheDocument();
    expect(screen.getByText(/present · surat-kargo-marketplace/)).toBeInTheDocument();
    expect(screen.getByText('createShipment request keys')).toBeInTheDocument();
    expect(screen.getByText('createShipment endpoint')).toBeInTheDocument();
    expect(screen.getByText('/rest/v2/createShipment')).toBeInTheDocument();
    expect(screen.getByText('createShipment response keys')).toBeInTheDocument();
    expect(screen.getByText('createShipment response status')).toBeInTheDocument();
    expect(screen.getAllByText('200').length).toBeGreaterThan(0);
    expect(screen.getByText('create shipment request is received.')).toBeInTheDocument();
    expect(screen.getByText(/createOrder present · createShipment present/)).toBeInTheDocument();
    expect(screen.getByText('Depoya Atandı')).toBeInTheDocument();
    expect(screen.queryByText(/905551112233/)).not.toBeInTheDocument();
  });

  it('does not expose Try OTO provider finalization diagnostics to vendors', async () => {
    getOrderMock.mockResolvedValueOnce({
      ...orderWithShipmentSummary,
      shipmentExecution: {
        ...orderWithShipmentSummary.shipmentExecution!,
        provider: 'try_oto',
        shipmentStatus: 'created',
        providerShipmentId: 'OTO-ORDER-1028',
        providerResponseSummary: {
          ...orderWithShipmentSummary.shipmentExecution!.providerResponseSummary!,
          dryRun: false,
          disabledGates: [],
          tryOtoFinalization: {
            createOrderSuccess: true,
            createShipmentCalled: true,
            createShipmentSuccess: true,
            createShipmentResponseKeys: ['message', 'success'],
            createShipmentProviderMessage: 'create shipment request is received.',
            createShipmentRequestKeys: ['orderId'],
            createShipmentDeliveryOptionIdPresent: false,
            deliveryOptionIdPresent: false,
            orderStatusValue: 'Depoya Atandı',
          },
        },
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

    expect(await screen.findByText('Try OTO status refresh')).toBeInTheDocument();
    expect(screen.queryByText('Provider response summary')).not.toBeInTheDocument();
    expect(screen.queryByText('Try OTO createShipment')).not.toBeInTheDocument();
    expect(screen.queryByText('create shipment request is received.')).not.toBeInTheDocument();
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

  it('renders Try OTO status refresh action and updates created shipment evidence', async () => {
    const user = userEvent.setup();
    getOrderMock.mockResolvedValue({
      ...orderWithShipmentSummary,
      shipmentExecution: {
        ...orderWithShipmentSummary.shipmentExecution!,
        id: 'shipment-try_oto-alloc-sporjinal-7621783322961',
        provider: 'try_oto',
        providerShipmentId: 'OTO-SHIP-1028',
        shipmentStatus: 'created',
        trackingNumber: null,
        barcode: null,
        labelUrl: null,
        providerResponseSummary: {
          ...orderWithShipmentSummary.shipmentExecution!.providerResponseSummary!,
          dryRun: false,
          providerShipmentIdPresent: true,
        },
      },
    });
    setCurrentUser({
      email: 'vendor@example.com',
      name: 'Vendor User',
      role: 'vendor',
      vendorAccess: ['sporjinal'],
      vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
      canSwitchVendors: false,
      defaultVendorId: 'sporjinal',
    });

    renderOrderDetail();

    await user.click(await screen.findByRole('button', { name: 'Refresh shipment status' }));

    expect(refreshShipmentExecutionStatusMock).toHaveBeenCalledWith('shipment-try_oto-alloc-sporjinal-7621783322961', {
      vendorId: 'sporjinal',
    });
    await waitFor(() => expect(getOrderMock).toHaveBeenCalledTimes(2));
    expect((await screen.findAllByText('Shipment status refreshed.')).length).toBeGreaterThan(0);
    expect(screen.getByText(/Provider id: yes · Barcode:\s*yes · Tracking:\s*yes · Label:\s*yes/)).toBeInTheDocument();
  });

  it('automatically refreshes Try OTO created shipments while tracking or label is missing', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      getOrderMock.mockResolvedValue({
        ...orderWithShipmentSummary,
        shipmentExecution: {
          ...orderWithShipmentSummary.shipmentExecution!,
          id: 'shipment-try_oto-alloc-sporjinal-7621783322961',
          provider: 'try_oto',
          providerShipmentId: 'OTO-SHIP-1028',
          shipmentStatus: 'created',
          trackingNumber: null,
          barcode: null,
          labelUrl: null,
          providerResponseSummary: {
            ...orderWithShipmentSummary.shipmentExecution!.providerResponseSummary!,
            dryRun: false,
            providerShipmentIdPresent: true,
          },
        },
      });
      setCurrentUser({
        email: 'vendor@example.com',
        name: 'Vendor User',
        role: 'vendor',
        vendorAccess: ['sporjinal'],
        vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
        canSwitchVendors: false,
        defaultVendorId: 'sporjinal',
      });

      renderOrderDetail();

      expect(await screen.findByText('Status will refresh automatically while OTO finishes label generation.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Refresh shipment status' })).toBeInTheDocument();
      expect(refreshShipmentExecutionStatusMock).not.toHaveBeenCalled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });

      expect(refreshShipmentExecutionStatusMock).toHaveBeenCalledWith('shipment-try_oto-alloc-sporjinal-7621783322961', {
        vendorId: 'sporjinal',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops automatic Try OTO refresh once tracking and label exist', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      getOrderMock.mockResolvedValue({
        ...orderWithShipmentSummary,
        trackingNumber: 'OTO-TRACK-1028',
        shipmentExecution: {
          ...orderWithShipmentSummary.shipmentExecution!,
          id: 'shipment-try_oto-alloc-sporjinal-7621783322961',
          provider: 'try_oto',
          providerShipmentId: 'OTO-SHIP-1028',
          shipmentStatus: 'created',
          trackingNumber: 'OTO-TRACK-1028',
          barcode: null,
          labelUrl: 'https://app.tryoto.example/label-1028.pdf',
          providerResponseSummary: null,
        },
      });
      setCurrentUser({
        email: 'vendor@example.com',
        name: 'Vendor User',
        role: 'vendor',
        vendorAccess: ['sporjinal'],
        vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
        canSwitchVendors: false,
        defaultVendorId: 'sporjinal',
      });

      renderOrderDetail();

      expect(await screen.findByText('Same as tracking')).toBeInTheDocument();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300_000);
      });

      expect(refreshShipmentExecutionStatusMock).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not automatically refresh Kargo shipments', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      setCurrentUser({
        email: 'vendor@example.com',
        name: 'Vendor User',
        role: 'vendor',
        vendorAccess: ['sporjinal'],
        vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
        canSwitchVendors: false,
        defaultVendorId: 'sporjinal',
      });

      renderOrderDetail();

      expect((await screen.findAllByText('Kargo Entegratör')).length).toBeGreaterThan(0);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300_000);
      });

      expect(refreshShipmentExecutionStatusMock).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('limits automatic Try OTO refresh attempts', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const pendingTryOtoOrder = {
        ...orderWithShipmentSummary,
        shipmentExecution: {
          ...orderWithShipmentSummary.shipmentExecution!,
          id: 'shipment-try_oto-alloc-sporjinal-7621783322961',
          provider: 'try_oto' as const,
          providerShipmentId: 'OTO-SHIP-1028',
          shipmentStatus: 'created',
          trackingNumber: null,
          barcode: null,
          labelUrl: null,
          providerResponseSummary: {
            ...orderWithShipmentSummary.shipmentExecution!.providerResponseSummary!,
            dryRun: false,
            providerShipmentIdPresent: true,
          },
        },
      };
      getOrderMock.mockResolvedValue(pendingTryOtoOrder);
      refreshShipmentExecutionStatusMock.mockResolvedValue(pendingTryOtoOrder.shipmentExecution);
      setCurrentUser({
        email: 'vendor@example.com',
        name: 'Vendor User',
        role: 'vendor',
        vendorAccess: ['sporjinal'],
        vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
        canSwitchVendors: false,
        defaultVendorId: 'sporjinal',
      });

      renderOrderDetail();

      expect(await screen.findByText('Status will refresh automatically while OTO finishes label generation.')).toBeInTheDocument();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(90_000);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(180_000);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300_000);
      });

      expect(refreshShipmentExecutionStatusMock).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('renders polished Try OTO shipment links and treats missing barcode as tracking-backed', async () => {
    getOrderMock.mockResolvedValue({
      ...orderWithShipmentSummary,
      carrier: 'try_oto',
      trackingNumber: 'OTO-TRACK-1028',
      trackingUrl: 'https://tracking.tryoto.example/OTO-TRACK-1028',
      shipmentExecution: {
        ...orderWithShipmentSummary.shipmentExecution!,
        id: 'shipment-try_oto-alloc-sporjinal-7621783322961',
        provider: 'try_oto',
        providerCarrierName: 'Sürat Marketplace',
        shipmentStatus: 'created',
        providerShipmentId: 'shopify-cmpce0fbh0003cf3odp0j35yw-allocation-alloc-sporjinal-7621783322961',
        trackingNumber: 'OTO-TRACK-1028',
        trackingUrl: 'https://tracking.tryoto.example/OTO-TRACK-1028',
        barcode: null,
        labelUrl: 'https://app.tryoto.example/label-1028.pdf',
        providerResponseSummary: null,
      },
    });
    setCurrentUser({
      email: 'vendor@example.com',
      name: 'Vendor User',
      role: 'vendor',
      vendorAccess: ['sporjinal'],
      vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
      canSwitchVendors: false,
      defaultVendorId: 'sporjinal',
    });

    renderOrderDetail();

    expect((await screen.findAllByText('Try OTO')).length).toBeGreaterThan(0);
    expect(screen.queryByText('Try Oto')).not.toBeInTheDocument();
    expect(screen.getByText('Internal reference')).toBeInTheDocument();
    expect(screen.queryByText('Provider id')).not.toBeInTheDocument();
    expect(screen.queryByText('shopify-cmpce0fbh0003cf3odp0j35yw-allocation-alloc-sporjinal-7621783322961')).not.toBeInTheDocument();
    expect(screen.getByText('shopify-cmpce0fbh0003cf3...1783322961')).toBeInTheDocument();
    expect(screen.getByText('Sürat Kargo')).toBeInTheDocument();
    expect(screen.getByText('Same as tracking')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open tracking' })).toHaveAttribute('href', 'https://tracking.tryoto.example/OTO-TRACK-1028');
    expect(screen.getByRole('link', { name: 'Open label PDF' })).toHaveAttribute('href', 'https://app.tryoto.example/label-1028.pdf');
    expect(screen.queryByLabelText('Try OTO shipment status refresh')).not.toBeInTheDocument();
  });

  it('renders Try OTO return label links when return shipment exists', async () => {
    setCurrentUser({
      email: 'vendor@example.com',
      name: 'Vendor User',
      role: 'vendor',
      vendorAccess: ['sporjinal'],
      vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
      canSwitchVendors: false,
      defaultVendorId: 'sporjinal',
    });
    getOrderMock.mockResolvedValue({
      ...orderWithShipmentSummary,
      shipmentExecution: {
        ...orderWithShipmentSummary.shipmentExecution!,
        id: 'shipment-try_oto-alloc-sporjinal-7621783322961',
        provider: 'try_oto',
        shipmentStatus: 'delivered',
        providerShipmentId: 'OTO-SHIP-1028',
        trackingNumber: 'OTO-TRACK-1028',
        labelUrl: 'https://app.tryoto.example/label-1028.pdf',
        returnShipment: {
          provider: 'try_oto',
          returnOrderId: 'OTO-ORDER-1028-R1',
          trackingNumber: 'RET-TRACK-1028',
          trackingUrl: null,
          labelUrl: 'https://app.tryoto.example/return-label-1028.pdf',
          barcode: 'RET-BARCODE-1028',
          status: 'created',
          createdAt: '2026-05-15T19:46:00.000Z',
          requestKeys: ['items', 'orderId'],
          responseKeys: ['printAWBURL', 'returnOrderId'],
          trackingPresent: true,
          labelPresent: true,
          labelRetrievalConfirmed: true,
          labelRetrievalNote: null,
          finalized: true,
          labelRetrievable: true,
        },
        providerResponseSummary: null,
      },
    });

    renderOrderDetail();

    expect(await screen.findByLabelText('Try OTO return shipment')).toBeInTheDocument();
    expect(screen.getByText('RET-TRACK-1028')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open return label PDF' })).toHaveAttribute(
      'href',
      'https://app.tryoto.example/return-label-1028.pdf',
    );
    expect(screen.queryByRole('button', { name: 'Finalize Try OTO return shipment' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Shopify return label upload probe')).not.toBeInTheDocument();
  });

  it('lets admins probe Shopify return label upload from return shipment details', async () => {
    const user = userEvent.setup();
    setCurrentUser({
      email: 'admin@example.com',
      name: 'Admin User',
      role: 'admin',
      vendorAccess: ['sporjinal'],
      vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
      canSwitchVendors: true,
      defaultVendorId: 'sporjinal',
    });
    getOrderMock.mockResolvedValue({
      ...orderWithShipmentSummary,
      shopifyReturnSignal: {
        topic: 'returns/request',
        receivedAt: '2026-05-19T08:00:00.000Z',
        topLevelPayloadKeys: ['admin_graphql_api_id', 'id'],
        orderIdPresent: true,
        returnIdPresent: true,
        lineItemIdsPresent: true,
        refundIdPresent: false,
        financialStatus: null,
        fulfillmentStatus: null,
        matchedOrderId: 'shopify-order-1028',
        matchedByField: 'order_id',
      },
      shipmentExecution: {
        ...orderWithShipmentSummary.shipmentExecution!,
        id: 'shipment-try_oto-alloc-sporjinal-7621783322961',
        provider: 'try_oto',
        shipmentStatus: 'delivered',
        providerShipmentId: 'OTO-SHIP-1028',
        trackingNumber: 'OTO-TRACK-1028',
        labelUrl: 'https://app.tryoto.example/label-1028.pdf',
        returnShipment: {
          provider: 'try_oto',
          returnOrderId: 'OTO-ORDER-1028-R1',
          trackingNumber: 'RET-TRACK-1028',
          trackingUrl: null,
          labelUrl: 'https://app.tryoto.example/return-label-1028.pdf',
          barcode: 'RET-BARCODE-1028',
          status: 'created',
          createdAt: '2026-05-15T19:46:00.000Z',
          requestKeys: ['items', 'orderId'],
          responseKeys: ['printAWBURL', 'returnOrderId'],
          trackingPresent: true,
          labelPresent: true,
          labelRetrievalConfirmed: true,
          labelRetrievalNote: null,
          shopifyReturnLabelUploadProbe: null,
        },
        providerResponseSummary: null,
      },
    });

    renderOrderDetail();

    const probeSection = await screen.findByLabelText('Shopify return label upload probe');
    await user.click(within(probeSection).getByRole('button', { name: 'Probe Shopify return label upload' }));

    expect(probeShopifyReturnLabelUploadMock).toHaveBeenCalledWith('shipment-try_oto-alloc-sporjinal-7621783322961');
    expect((await screen.findAllByText('Shopify accepted the return label PDF URL.')).length).toBeGreaterThan(0);
  });

  it('lets admins probe Try OTO return details and shows safe diagnostics', async () => {
    const user = userEvent.setup();
    setCurrentUser({
      email: 'admin@example.com',
      name: 'Admin User',
      role: 'admin',
      vendorAccess: ['sporjinal'],
      vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
      canSwitchVendors: true,
      defaultVendorId: 'sporjinal',
    });
    getOrderMock.mockResolvedValue({
      ...orderWithShipmentSummary,
      shipmentExecution: {
        ...orderWithShipmentSummary.shipmentExecution!,
        id: 'shipment-try_oto-alloc-sporjinal-7621783322961',
        provider: 'try_oto',
        shipmentStatus: 'delivered',
        providerShipmentId: 'OTO-SHIP-1028',
        trackingNumber: 'OTO-TRACK-1028',
        labelUrl: 'https://app.tryoto.example/label-1028.pdf',
        returnShipment: {
          provider: 'try_oto',
          returnOrderId: 'OTO-ORDER-1028-R1',
          trackingNumber: 'RET-TRACK-1028',
          trackingUrl: null,
          labelUrl: null,
          barcode: 'RET-BARCODE-1028',
          status: 'request_created',
          createdAt: '2026-05-15T19:46:00.000Z',
          requestKeys: ['items', 'orderId'],
          responseKeys: ['returnOrderId'],
          trackingPresent: true,
          labelPresent: false,
          labelRetrievalConfirmed: false,
          labelRetrievalNote: 'Return label is not available from getReturnDetails yet.',
          finalized: false,
          labelRetrievable: false,
          providerStatusSource: 'createReturnShipment',
          diagnostics: null,
          detailsProbe: null,
        },
        providerResponseSummary: null,
      },
    });

    renderOrderDetail();

    const probeSection = await screen.findByLabelText('Try OTO return details action');
    await user.click(within(probeSection).getByRole('button', { name: 'Probe Try OTO return details' }));

    expect(probeTryOtoReturnDetailsMock).toHaveBeenCalledWith('shipment-try_oto-alloc-sporjinal-7621783322961');
    expect((await screen.findAllByText('Try OTO return label found in return details.')).length).toBeGreaterThan(0);
    expect(screen.getByText(/Return provider id: yes · Return barcode: yes · Return tracking: yes · Return label: yes/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open return label PDF' })).toHaveAttribute(
      'href',
      'https://app.tryoto.example/return-label-1028.pdf',
    );
  });

  it('does not report forward shipment labels as return labels after return details probe', async () => {
    const user = userEvent.setup();
    setCurrentUser({
      email: 'admin@example.com',
      name: 'Admin User',
      role: 'admin',
      vendorAccess: ['sporjinal'],
      vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
      canSwitchVendors: true,
      defaultVendorId: 'sporjinal',
    });
    getOrderMock.mockResolvedValue({
      ...orderWithShipmentSummary,
      shipmentExecution: {
        ...orderWithShipmentSummary.shipmentExecution!,
        id: 'shipment-try_oto-alloc-sporjinal-7621783322961',
        provider: 'try_oto',
        shipmentStatus: 'delivered',
        providerShipmentId: 'OTO-SHIP-1028',
        trackingNumber: 'OTO-TRACK-1028',
        labelUrl: 'https://app.tryoto.example/forward-label-1028.pdf',
        returnShipment: {
          provider: 'try_oto',
          returnOrderId: 'OTO-ORDER-1028-R1',
          trackingNumber: 'RET-TRACK-1028',
          trackingUrl: null,
          labelUrl: null,
          barcode: 'RET-BARCODE-1028',
          status: 'request_created',
          createdAt: '2026-05-15T19:46:00.000Z',
          requestKeys: ['items', 'orderId'],
          responseKeys: ['returnOrderId'],
          trackingPresent: true,
          labelPresent: false,
          labelRetrievalConfirmed: false,
          labelRetrievalNote: 'Return label is not available from getReturnDetails yet.',
          finalized: false,
          labelRetrievable: false,
          providerStatusSource: 'createReturnShipment',
          diagnostics: null,
          detailsProbe: null,
        },
        providerResponseSummary: null,
      },
    });
    probeTryOtoReturnDetailsMock.mockResolvedValueOnce({
      ...orderWithShipmentSummary.shipmentExecution,
      provider: 'try_oto',
      shipmentStatus: 'delivered',
      providerShipmentId: 'OTO-SHIP-1028',
      trackingNumber: 'OTO-TRACK-1028',
      labelUrl: 'https://app.tryoto.example/forward-label-1028.pdf',
      returnShipment: {
        provider: 'try_oto',
        returnOrderId: 'OTO-ORDER-1028-R1',
        trackingNumber: 'RET-TRACK-1028',
        trackingUrl: null,
        labelUrl: null,
        barcode: 'RET-BARCODE-1028',
        status: 'request_created',
        createdAt: '2026-05-15T19:46:00.000Z',
        requestKeys: ['items', 'orderId'],
        responseKeys: ['returnOrderId'],
        trackingPresent: true,
        labelPresent: false,
        labelRetrievalConfirmed: false,
        labelRetrievalNote: 'Return label is not available from getReturnDetails yet.',
        finalized: false,
        labelRetrievable: false,
        providerStatusSource: 'getReturnDetails',
        detailsProbe: {
          status: 'no_label',
          attemptedAt: '2026-05-15T19:49:00.000Z',
          endpoint: '/rest/v2/getReturnDetails',
          httpStatus: 200,
          responseKeys: ['data'],
          nestedKeys: ['data.orderId'],
          labelLikeFieldsPresent: false,
          awbLikeFieldsPresent: false,
          pdfLikeFieldsPresent: false,
          urlLikeFieldsPresent: false,
          trackingPresent: true,
          barcodePresent: true,
          providerStatus: 'request_created',
          labelUrlPresent: false,
          errorMessage: 'Return label is not available from getReturnDetails yet.',
        },
      },
      updatedAt: '2026-05-15T19:49:00.000Z',
    });

    renderOrderDetail();

    const probeSection = await screen.findByLabelText('Try OTO return details action');
    await user.click(within(probeSection).getByRole('button', { name: 'Probe Try OTO return details' }));

    expect((await screen.findAllByText('Return label is not available from getReturnDetails yet.')).length).toBeGreaterThan(0);
    expect(screen.getByText(/Return provider id: yes · Return barcode: yes · Return tracking: yes · Return label: pending/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open return label PDF' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Provider id: yes · Barcode:.*Label: yes/)).not.toBeInTheDocument();
  });

  it('lets admins probe Try OTO return link and shows safe diagnostics', async () => {
    const user = userEvent.setup();
    setCurrentUser({
      email: 'admin@example.com',
      name: 'Admin User',
      role: 'admin',
      vendorAccess: ['sporjinal'],
      vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
      canSwitchVendors: true,
      defaultVendorId: 'sporjinal',
    });
    getOrderMock.mockResolvedValue({
      ...orderWithShipmentSummary,
      shipmentExecution: {
        ...orderWithShipmentSummary.shipmentExecution!,
        id: 'shipment-try_oto-alloc-sporjinal-7621783322961',
        provider: 'try_oto',
        shipmentStatus: 'delivered',
        providerShipmentId: 'OTO-SHIP-1028',
        trackingNumber: 'OTO-TRACK-1028',
        labelUrl: 'https://app.tryoto.example/label-1028.pdf',
        returnShipment: {
          provider: 'try_oto',
          returnOrderId: 'OTO-ORDER-1028-R1',
          trackingNumber: 'RET-TRACK-1028',
          trackingUrl: null,
          labelUrl: null,
          barcode: 'RET-BARCODE-1028',
          status: 'request_created',
          createdAt: '2026-05-15T19:46:00.000Z',
          requestKeys: ['items', 'orderId'],
          responseKeys: ['returnOrderId'],
          trackingPresent: true,
          labelPresent: false,
          labelRetrievalConfirmed: false,
          labelRetrievalNote: 'Return label is not available from getReturnDetails yet.',
          finalized: false,
          labelRetrievable: false,
          providerStatusSource: 'createReturnShipment',
          diagnostics: null,
          detailsProbe: null,
          linkProbe: null,
        },
        providerResponseSummary: null,
      },
    });

    renderOrderDetail();

    const probeSection = await screen.findByLabelText('Try OTO return details action');
    await user.click(within(probeSection).getByRole('button', { name: 'Probe Try OTO return link' }));

    expect(probeTryOtoReturnLinkMock).toHaveBeenCalledWith('shipment-try_oto-alloc-sporjinal-7621783322961');
    expect((await screen.findAllByText('Try OTO return label found in return link response.')).length).toBeGreaterThan(0);
    expect(screen.getByText(/Return provider id: yes · Return barcode: yes · Return tracking: yes · Return label: yes/)).toBeInTheDocument();
  });

  it('lets admins probe Try OTO return AWB print and persist the return label URL', async () => {
    const user = userEvent.setup();
    setCurrentUser({
      email: 'admin@example.com',
      name: 'Admin User',
      role: 'admin',
      vendorAccess: ['sporjinal'],
      vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
      canSwitchVendors: true,
      defaultVendorId: 'sporjinal',
    });
    getOrderMock.mockResolvedValue({
      ...orderWithShipmentSummary,
      shipmentExecution: {
        ...orderWithShipmentSummary.shipmentExecution!,
        id: 'shipment-try_oto-alloc-sporjinal-7621783322961',
        provider: 'try_oto',
        shipmentStatus: 'delivered',
        providerShipmentId: 'OTO-SHIP-1028',
        trackingNumber: 'OTO-TRACK-1028',
        labelUrl: 'https://app.tryoto.example/label-1028.pdf',
        returnShipment: {
          provider: 'try_oto',
          returnOrderId: 'OTO-ORDER-1028-R1',
          trackingNumber: 'RET-TRACK-1028',
          trackingUrl: null,
          labelUrl: null,
          barcode: 'RET-BARCODE-1028',
          status: 'request_created',
          createdAt: '2026-05-15T19:46:00.000Z',
          requestKeys: ['items', 'orderId'],
          responseKeys: ['returnOrderId'],
          trackingPresent: true,
          labelPresent: false,
          labelRetrievalConfirmed: false,
          labelRetrievalNote: 'Return AWB print did not return a label URL yet.',
          finalized: false,
          labelRetrievable: false,
          providerStatusSource: 'createReturnShipment',
          diagnostics: null,
          detailsProbe: null,
          linkProbe: null,
          awbPrintProbe: null,
        },
        providerResponseSummary: null,
      },
    });

    renderOrderDetail();

    const probeSection = await screen.findByLabelText('Try OTO return details action');
    expect(within(probeSection).getByRole('button', { name: 'Probe Try OTO return AWB print' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Finalize Try OTO return shipment' })).not.toBeInTheDocument();
    await user.click(within(probeSection).getByRole('button', { name: 'Probe Try OTO return AWB print' }));

    expect(probeTryOtoReturnAwbPrintMock).toHaveBeenCalledWith('shipment-try_oto-alloc-sporjinal-7621783322961');
    expect((await screen.findAllByText('Try OTO return label found in AWB print response.')).length).toBeGreaterThan(0);
    expect(screen.getByText(/Return provider id: yes · Return barcode: yes · Return tracking: yes · Return label: yes/)).toBeInTheDocument();
    const summary = await screen.findByLabelText('Try OTO return AWB print probe');
    expect(within(summary).getByText('200')).toBeInTheDocument();
    expect(within(summary).getByText('Label/PDF/URL')).toBeInTheDocument();
    expect(within(summary).getByText('Tracking/barcode')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open return label PDF' })).toHaveAttribute(
      'href',
      'https://app.tryoto.example/return-label-1028.pdf',
    );
  });

  it('keeps AWB print fallback when the probe returns no label URL', async () => {
    const user = userEvent.setup();
    setCurrentUser({
      email: 'admin@example.com',
      name: 'Admin User',
      role: 'admin',
      vendorAccess: ['sporjinal'],
      vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
      canSwitchVendors: true,
      defaultVendorId: 'sporjinal',
    });
    getOrderMock.mockResolvedValue({
      ...orderWithShipmentSummary,
      shipmentExecution: {
        ...orderWithShipmentSummary.shipmentExecution!,
        id: 'shipment-try_oto-alloc-sporjinal-7621783322961',
        provider: 'try_oto',
        shipmentStatus: 'delivered',
        providerShipmentId: 'OTO-SHIP-1028',
        trackingNumber: 'OTO-TRACK-1028',
        labelUrl: 'https://app.tryoto.example/label-1028.pdf',
        returnShipment: {
          provider: 'try_oto',
          returnOrderId: 'OTO-ORDER-1028-R1',
          trackingNumber: 'RET-TRACK-1028',
          trackingUrl: null,
          labelUrl: null,
          barcode: 'RET-BARCODE-1028',
          status: 'request_created',
          createdAt: '2026-05-15T19:46:00.000Z',
          requestKeys: ['items', 'orderId'],
          responseKeys: ['returnOrderId'],
          trackingPresent: true,
          labelPresent: false,
          labelRetrievalConfirmed: false,
          labelRetrievalNote: 'Return AWB print did not return a label URL yet.',
          finalized: false,
          labelRetrievable: false,
          providerStatusSource: 'createReturnShipment',
          diagnostics: null,
          detailsProbe: null,
          linkProbe: null,
          awbPrintProbe: null,
        },
        providerResponseSummary: null,
      },
    });
    probeTryOtoReturnAwbPrintMock.mockResolvedValueOnce({
      ...orderWithShipmentSummary.shipmentExecution,
      provider: 'try_oto',
      shipmentStatus: 'delivered',
      providerShipmentId: 'OTO-SHIP-1028',
      trackingNumber: 'OTO-TRACK-1028',
      labelUrl: 'https://app.tryoto.example/label-1028.pdf',
      returnShipment: {
        provider: 'try_oto',
        returnOrderId: 'OTO-ORDER-1028-R1',
        trackingNumber: 'RET-TRACK-1028',
        trackingUrl: null,
        labelUrl: null,
        barcode: 'RET-BARCODE-1028',
        status: 'request_created',
        createdAt: '2026-05-15T19:46:00.000Z',
        requestKeys: ['returnOrderId', 'printReverseShipment'],
        responseKeys: ['message'],
        trackingPresent: true,
        labelPresent: false,
        labelRetrievalConfirmed: false,
        labelRetrievalNote: 'Return AWB print did not return a label URL yet.',
        finalized: false,
        labelRetrievable: false,
        providerStatusSource: 'return AWB print',
        awbPrintProbe: {
          status: 'no_label',
          attemptedAt: '2026-05-15T19:51:00.000Z',
          endpoint: '/rest/v2/print/OTO-ORDER-1028-R1?printReverseShipment=true',
          httpStatus: 200,
          responseKeys: ['message'],
          nestedKeys: ['message'],
          labelLikeFieldsPresent: false,
          awbLikeFieldsPresent: false,
          pdfLikeFieldsPresent: false,
          urlLikeFieldsPresent: false,
          trackingPresent: false,
          barcodePresent: false,
          providerStatus: null,
          labelUrlPresent: false,
          providerMessage: 'No print data yet',
          errorMessage: 'Return AWB print did not return a label URL yet.',
        },
      },
      updatedAt: '2026-05-15T19:51:00.000Z',
    });

    renderOrderDetail();

    const probeSection = await screen.findByLabelText('Try OTO return details action');
    await user.click(within(probeSection).getByRole('button', { name: 'Probe Try OTO return AWB print' }));

    expect((await screen.findAllByText('Return AWB print did not return a label URL yet.')).length).toBeGreaterThan(0);
    const summary = await screen.findByLabelText('Try OTO return AWB print probe');
    expect(within(summary).getByText('No print data yet')).toBeInTheDocument();
    expect(screen.getByText(/Return provider id: yes · Return barcode: yes · Return tracking: yes · Return label: pending/)).toBeInTheDocument();
  });

  it('blocks Try OTO return AWB print probe when returnOrderId is missing', async () => {
    setCurrentUser({
      email: 'admin@example.com',
      name: 'Admin User',
      role: 'admin',
      vendorAccess: ['sporjinal'],
      vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
      canSwitchVendors: true,
      defaultVendorId: 'sporjinal',
    });
    getOrderMock.mockResolvedValue({
      ...orderWithShipmentSummary,
      shipmentExecution: {
        ...orderWithShipmentSummary.shipmentExecution!,
        id: 'shipment-try_oto-alloc-sporjinal-7621783322961',
        provider: 'try_oto',
        shipmentStatus: 'delivered',
        providerShipmentId: 'OTO-SHIP-1028',
        trackingNumber: 'OTO-TRACK-1028',
        returnShipment: {
          provider: 'try_oto',
          returnOrderId: null,
          trackingNumber: 'RET-TRACK-1028',
          trackingUrl: null,
          labelUrl: null,
          barcode: 'RET-BARCODE-1028',
          status: 'request_created',
          createdAt: '2026-05-15T19:46:00.000Z',
          requestKeys: ['items', 'orderId'],
          responseKeys: ['returnOrderId'],
          trackingPresent: true,
          labelPresent: false,
          labelRetrievalConfirmed: false,
          labelRetrievalNote: 'Return AWB print did not return a label URL yet.',
          finalized: false,
          labelRetrievable: false,
          providerStatusSource: 'createReturnShipment',
          diagnostics: null,
          detailsProbe: null,
          linkProbe: null,
          awbPrintProbe: null,
        },
        providerResponseSummary: null,
      },
    });

    renderOrderDetail();

    const probeSection = await screen.findByLabelText('Try OTO return details action');
    expect(within(probeSection).getByRole('button', { name: 'Probe Try OTO return details' })).toBeDisabled();
    expect(within(probeSection).getByRole('button', { name: 'Probe Try OTO return link' })).toBeDisabled();
    expect(within(probeSection).getByRole('button', { name: 'Probe Try OTO return AWB print' })).toBeDisabled();
    expect(screen.getByText('Return probes require returnOrderId.')).toBeInTheDocument();
  });

  it('explains why Try OTO return probes are blocked when return creation was skipped', async () => {
    setCurrentUser({
      email: 'admin@example.com',
      name: 'Admin User',
      role: 'admin',
      vendorAccess: ['sporjinal'],
      vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
      canSwitchVendors: true,
      defaultVendorId: 'sporjinal',
    });
    getOrderMock.mockResolvedValue({
      ...orderWithShipmentSummary,
      shipmentExecution: {
        ...orderWithShipmentSummary.shipmentExecution!,
        provider: 'try_oto',
        shipmentStatus: 'delivered',
        providerShipmentId: 'OTO-SHIP-1028',
        trackingNumber: 'OTO-TRACK-1028',
        returnShipment: {
          provider: 'try_oto',
          returnOrderId: null,
          trackingNumber: null,
          trackingUrl: null,
          labelUrl: null,
          barcode: null,
          status: 'skipped',
          createdAt: '2026-05-15T19:46:00.000Z',
          requestKeys: [],
          responseKeys: [],
          trackingPresent: false,
          labelPresent: false,
          labelRetrievalConfirmed: false,
          labelRetrievalNote: 'Try OTO return shipment was not created because deliveryOptionId is missing.',
          finalized: false,
          labelRetrievable: false,
          providerStatusSource: 'createReturnShipment:blocked',
          diagnostics: {
            endpoint: '/rest/v2/createReturnShipment',
            httpStatus: null,
            requestKeys: [],
            responseKeys: [],
            returnProviderIdPresent: false,
            returnTrackingPresent: false,
            returnBarcodePresent: false,
            returnStatus: 'skipped',
            labelFieldPresent: false,
            providerMessage: 'Try OTO return shipment was not created because deliveryOptionId is missing.',
            returnSkippedReason: 'missing_delivery_option_id',
            forwardDeliveryOptionIdPresent: false,
            forwardDeliveryOptionIdSource: null,
            forwardDeliveryOptionPersistedAt: null,
            forwardDeliveryOptionRetainedAfterWebhook: false,
            forwardDeliveryOptionRetainedAfterStatusRefresh: false,
            returnDeliveryOptionIdPresent: false,
            returnDeliveryOptionIdSource: null,
            pickupLocationCodePresent: true,
            returnItemSkuPresent: true,
            returnItemQuantityPresent: true,
            returnDeliveryOptionLookupCalled: false,
            returnDeliveryOptionLookupImplemented: false,
            returnPriceLookupCalled: false,
            returnPriceLookupSuccess: false,
            returnPriceLookupOptionCount: null,
            selectedReturnPriceOptionIdPresent: false,
            reverseCreateShipmentCalled: false,
            reverseCreateShipmentSuccess: false,
            reverseCreateShipmentResponseKeys: [],
            reverseCreateShipmentTrackingPresent: false,
            reverseCreateShipmentBarcodePresent: false,
            reverseCreateShipmentLabelPresent: false,
            returnFinalized: false,
            returnFinalizationEndpointConfirmed: false,
            returnFinalizeEndpointImplemented: false,
            returnLabelRetrievable: false,
            providerStatusSource: 'createReturnShipment:blocked',
          },
          detailsProbe: null,
          linkProbe: null,
          awbPrintProbe: null,
        },
        providerResponseSummary: null,
      },
    });

    renderOrderDetail();

    const probeSection = await screen.findByLabelText('Try OTO return details action');
    expect(within(probeSection).getByRole('button', { name: 'Probe Try OTO return details' })).toBeDisabled();
    expect(within(probeSection).getByRole('button', { name: 'Probe Try OTO return link' })).toBeDisabled();
    expect(within(probeSection).getByRole('button', { name: 'Probe Try OTO return AWB print' })).toBeDisabled();
    expect(
      screen.getByText('Return probes require returnOrderId. Return shipment was not created because deliveryOptionId is missing.'),
    ).toBeInTheDocument();
  });

  it('hides Try OTO return details probe action from vendors', async () => {
    setCurrentUser({
      email: 'vendor@example.com',
      name: 'Vendor User',
      role: 'vendor',
      vendorAccess: ['sporjinal'],
      vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
      canSwitchVendors: false,
      defaultVendorId: 'sporjinal',
    });
    getOrderMock.mockResolvedValue({
      ...orderWithShipmentSummary,
      shipmentExecution: {
        ...orderWithShipmentSummary.shipmentExecution!,
        provider: 'try_oto',
        shipmentStatus: 'delivered',
        providerShipmentId: 'OTO-SHIP-1028',
        trackingNumber: 'OTO-TRACK-1028',
        returnShipment: {
          provider: 'try_oto',
          returnOrderId: 'OTO-ORDER-1028-R1',
          trackingNumber: 'RET-TRACK-1028',
          trackingUrl: null,
          labelUrl: null,
          barcode: 'RET-BARCODE-1028',
          status: 'request_created',
          createdAt: '2026-05-15T19:46:00.000Z',
          requestKeys: ['items', 'orderId'],
          responseKeys: ['returnOrderId'],
          trackingPresent: true,
          labelPresent: false,
          labelRetrievalConfirmed: false,
          labelRetrievalNote: 'Return label is not available from getReturnDetails yet.',
          finalized: false,
          labelRetrievable: false,
          providerStatusSource: 'createReturnShipment',
          diagnostics: null,
          detailsProbe: null,
        },
      },
    });

    renderOrderDetail();

    expect(await screen.findByLabelText('Try OTO return shipment')).toBeInTheDocument();
    expect(screen.queryByLabelText('Try OTO return details action')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Probe Try OTO return details' })).not.toBeInTheDocument();
  });

  it('hides Try OTO return details probe action when no return exists', async () => {
    setCurrentUser({
      email: 'admin@example.com',
      name: 'Admin User',
      role: 'admin',
      vendorAccess: ['sporjinal'],
      vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
      canSwitchVendors: true,
      defaultVendorId: 'sporjinal',
    });
    getOrderMock.mockResolvedValue({
      ...orderWithShipmentSummary,
      shipmentExecution: {
        ...orderWithShipmentSummary.shipmentExecution!,
        provider: 'try_oto',
        shipmentStatus: 'delivered',
        providerShipmentId: 'OTO-SHIP-1028',
        trackingNumber: 'OTO-TRACK-1028',
        returnShipment: null,
      },
    });

    renderOrderDetail();

    expect(await screen.findByRole('heading', { name: /Order #1028/ })).toBeInTheDocument();
    expect(screen.queryByLabelText('Try OTO return details action')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Probe Try OTO return details' })).not.toBeInTheDocument();
  });

  it('creates Try OTO return labels from delivered shipments', async () => {
    const user = userEvent.setup();
    setCurrentUser({
      email: 'vendor@example.com',
      name: 'Vendor User',
      role: 'vendor',
      vendorAccess: ['sporjinal'],
      vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
      canSwitchVendors: false,
      defaultVendorId: 'sporjinal',
    });
    getOrderMock.mockResolvedValue({
      ...orderWithShipmentSummary,
      shipmentExecution: {
        ...orderWithShipmentSummary.shipmentExecution!,
        id: 'shipment-try_oto-alloc-sporjinal-7621783322961',
        provider: 'try_oto',
        shipmentStatus: 'delivered',
        providerShipmentId: 'OTO-SHIP-1028',
        trackingNumber: 'OTO-TRACK-1028',
        labelUrl: 'https://app.tryoto.example/label-1028.pdf',
        returnShipment: null,
        providerResponseSummary: null,
      },
    });

    renderOrderDetail();

    await user.click(await screen.findByRole('button', { name: 'Create return label' }));

    expect(createReturnShipmentLabelMock).toHaveBeenCalledWith('shipment-try_oto-alloc-sporjinal-7621783322961', {
      vendorId: 'sporjinal',
    });
    expect((await screen.findAllByText('Try OTO return label created.')).length).toBeGreaterThan(0);
  });

  it('does not describe unfinalized Try OTO return requests as created return shipments', async () => {
    setCurrentUser({
      email: 'vendor@example.com',
      name: 'Vendor User',
      role: 'vendor',
      vendorAccess: ['sporjinal'],
      vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
      canSwitchVendors: false,
      defaultVendorId: 'sporjinal',
    });
    getOrderMock.mockResolvedValue({
      ...orderWithShipmentSummary,
      shipmentExecution: {
        ...orderWithShipmentSummary.shipmentExecution!,
        id: 'shipment-try_oto-alloc-sporjinal-7621783322961',
        provider: 'try_oto',
        shipmentStatus: 'delivered',
        providerShipmentId: 'OTO-SHIP-1028',
        trackingNumber: 'OTO-TRACK-1028',
        labelUrl: 'https://app.tryoto.example/label-1028.pdf',
        returnShipment: {
          provider: 'try_oto',
          returnOrderId: 'OTO-ORDER-1028-R1',
          trackingNumber: 'RET-TRACK-1028',
          trackingUrl: null,
          labelUrl: null,
          barcode: 'RET-BARCODE-1028',
          status: 'request_created',
          createdAt: '2026-05-15T19:46:00.000Z',
          requestKeys: ['items', 'orderId'],
          responseKeys: ['returnOrderId', 'trackingNumber'],
          trackingPresent: true,
          labelPresent: false,
          labelRetrievalConfirmed: false,
          labelRetrievalNote: 'Return request created; waiting for Try OTO return shipment details.',
          finalized: false,
          labelRetrievable: false,
          providerStatusSource: 'createReturnShipment',
          diagnostics: null,
        },
        providerResponseSummary: null,
      },
    });

    renderOrderDetail();

    expect((await screen.findAllByText('Return request created; waiting for Try OTO return shipment details.')).length).toBeGreaterThan(0);
    expect(screen.queryByText('Return shipment created')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open return label PDF' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Finalize Try OTO return shipment' })).not.toBeInTheDocument();
    expect(createReturnShipmentLabelMock).not.toHaveBeenCalled();
  });

  it('hides return finalization even when diagnostics provider id is present', async () => {
    setCurrentUser({
      email: 'vendor@example.com',
      name: 'Vendor User',
      role: 'vendor',
      vendorAccess: ['sporjinal'],
      vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
      canSwitchVendors: false,
      defaultVendorId: 'sporjinal',
    });
    getOrderMock.mockResolvedValue({
      ...orderWithShipmentSummary,
      shipmentExecution: {
        ...orderWithShipmentSummary.shipmentExecution!,
        id: 'shipment-try_oto-alloc-sporjinal-7621783322961',
        provider: 'try_oto',
        shipmentStatus: 'delivered',
        providerShipmentId: 'OTO-SHIP-1028',
        trackingNumber: 'OTO-TRACK-1028',
        labelUrl: 'https://app.tryoto.example/label-1028.pdf',
        returnShipment: {
          provider: 'try_oto',
          returnOrderId: null,
          trackingNumber: null,
          trackingUrl: null,
          labelUrl: null,
          barcode: null,
          status: 'request_created',
          createdAt: '2026-05-15T19:46:00.000Z',
          requestKeys: ['items', 'orderId'],
          responseKeys: ['returnProviderId'],
          trackingPresent: false,
          labelPresent: false,
          labelRetrievalConfirmed: false,
          labelRetrievalNote: 'Return request created; waiting for Try OTO return shipment details.',
          finalized: false,
          labelRetrievable: false,
          providerStatusSource: 'createReturnShipment',
          diagnostics: {
            endpoint: '/rest/v2/createReturnShipment',
            httpStatus: 200,
            requestKeys: ['items', 'orderId'],
            responseKeys: ['returnProviderId'],
            returnProviderIdPresent: true,
            returnTrackingPresent: false,
            returnBarcodePresent: false,
            returnStatus: 'request_created',
            labelFieldPresent: false,
            providerMessage: null,
            returnDeliveryOptionIdPresent: false,
            returnDeliveryOptionLookupCalled: false,
            returnDeliveryOptionLookupImplemented: false,
            returnPriceLookupCalled: false,
            returnPriceLookupSuccess: false,
            returnPriceLookupOptionCount: 0,
            selectedReturnPriceOptionIdPresent: false,
            reverseCreateShipmentCalled: false,
            reverseCreateShipmentSuccess: false,
            reverseCreateShipmentResponseKeys: [],
            reverseCreateShipmentTrackingPresent: false,
            reverseCreateShipmentBarcodePresent: false,
            reverseCreateShipmentLabelPresent: false,
            returnFinalized: false,
            returnFinalizationEndpointConfirmed: false,
            returnFinalizeEndpointImplemented: false,
            returnLabelRetrievable: false,
            providerStatusSource: 'createReturnShipment',
          },
        },
        providerResponseSummary: null,
      },
    });

    renderOrderDetail();

    expect((await screen.findAllByText('Return request created; waiting for Try OTO return shipment details.')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Finalize Try OTO return shipment' })).not.toBeInTheDocument();
    expect(createReturnShipmentLabelMock).not.toHaveBeenCalled();
  });

  it('shows return request waiting state when provider id is missing', async () => {
    setCurrentUser({
      email: 'vendor@example.com',
      name: 'Vendor User',
      role: 'vendor',
      vendorAccess: ['sporjinal'],
      vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
      canSwitchVendors: false,
      defaultVendorId: 'sporjinal',
    });
    getOrderMock.mockResolvedValue({
      ...orderWithShipmentSummary,
      shipmentExecution: {
        ...orderWithShipmentSummary.shipmentExecution!,
        id: 'shipment-try_oto-alloc-sporjinal-7621783322961',
        provider: 'try_oto',
        shipmentStatus: 'delivered',
        providerShipmentId: 'OTO-SHIP-1028',
        trackingNumber: 'OTO-TRACK-1028',
        labelUrl: 'https://app.tryoto.example/label-1028.pdf',
        returnShipment: {
          provider: 'try_oto',
          returnOrderId: null,
          trackingNumber: null,
          trackingUrl: null,
          labelUrl: null,
          barcode: null,
          status: 'request_created',
          createdAt: '2026-05-15T19:46:00.000Z',
          requestKeys: ['items', 'orderId'],
          responseKeys: [],
          trackingPresent: false,
          labelPresent: false,
          labelRetrievalConfirmed: false,
          labelRetrievalNote: 'Return request created; waiting for Try OTO return shipment details.',
          finalized: false,
          labelRetrievable: false,
          providerStatusSource: 'createReturnShipment',
          diagnostics: {
            endpoint: '/rest/v2/createReturnShipment',
            httpStatus: 200,
            requestKeys: ['items', 'orderId'],
            responseKeys: [],
            returnProviderIdPresent: false,
            returnTrackingPresent: false,
            returnBarcodePresent: false,
            returnStatus: 'request_created',
            labelFieldPresent: false,
            providerMessage: null,
            returnDeliveryOptionIdPresent: false,
            returnDeliveryOptionLookupCalled: false,
            returnDeliveryOptionLookupImplemented: false,
            returnPriceLookupCalled: false,
            returnPriceLookupSuccess: false,
            returnPriceLookupOptionCount: 0,
            selectedReturnPriceOptionIdPresent: false,
            reverseCreateShipmentCalled: false,
            reverseCreateShipmentSuccess: false,
            reverseCreateShipmentResponseKeys: [],
            reverseCreateShipmentTrackingPresent: false,
            reverseCreateShipmentBarcodePresent: false,
            reverseCreateShipmentLabelPresent: false,
            returnFinalized: false,
            returnFinalizationEndpointConfirmed: false,
            returnFinalizeEndpointImplemented: false,
            returnLabelRetrievable: false,
            providerStatusSource: 'createReturnShipment',
          },
        },
        providerResponseSummary: null,
      },
    });

    renderOrderDetail();

    expect((await screen.findAllByText('Return request created; waiting for Try OTO return shipment details.')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Finalize Try OTO return shipment' })).not.toBeInTheDocument();
  });

  it('shows confirmed Shopify fulfillment when a fulfillment id exists', async () => {
    getOrderMock.mockResolvedValue({
      ...orderWithShipmentSummary,
      carrier: 'Sürat Kargo',
      trackingNumber: 'OTO-TRACK-1028',
      fulfilledAt: '2026-05-15T19:47:00.000Z',
      shopifyFulfillmentSync: {
        status: 'synced',
        fulfillmentOrderIdPresent: true,
        fulfillmentIdPresent: true,
        syncStatus: 'submitted',
        skippedReason: null,
        errorMessage: null,
        lastAttemptedAt: '2026-05-15T19:47:00.000Z',
      },
      shipmentExecution: {
        ...orderWithShipmentSummary.shipmentExecution!,
        provider: 'try_oto',
        providerCarrierName: 'Sürat Marketplace',
        shipmentStatus: 'created',
        providerShipmentId: 'OTO-SHIP-1028',
        trackingNumber: 'OTO-TRACK-1028',
        trackingUrl: 'https://tracking.tryoto.example/OTO-TRACK-1028',
        labelUrl: 'https://app.tryoto.example/label-1028.pdf',
        providerResponseSummary: null,
      },
    });
    setCurrentUser({
      email: 'vendor@example.com',
      name: 'Vendor User',
      role: 'vendor',
      vendorAccess: ['sporjinal'],
      vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
      canSwitchVendors: false,
      defaultVendorId: 'sporjinal',
    });

    renderOrderDetail();

    const fulfillmentStatus = await screen.findByLabelText('Shopify fulfillment status');
    expect(within(fulfillmentStatus).getByText('Shopify fulfillment')).toBeInTheDocument();
    expect(within(fulfillmentStatus).getByText('Synced · Shopify fulfillment is confirmed.')).toBeInTheDocument();
  });

  it('shows admin-only Shopify return signal diagnostics when available', async () => {
    setCurrentUser({
      email: 'admin@demo.com',
      name: 'Demo Admin',
      role: 'admin',
      vendorAccess: ['sporjinal'],
      vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
      canSwitchVendors: true,
      defaultVendorId: 'sporjinal',
    });
    getOrderMock.mockResolvedValueOnce({
      ...orderWithShipmentSummary,
      shopifyReturnSignal: {
        topic: 'returns/update',
        receivedAt: '2026-05-19T08:00:00.000Z',
        topLevelPayloadKeys: ['admin_graphql_api_id', 'id', 'order_id', 'return_line_items'],
        orderIdPresent: true,
        returnIdPresent: true,
        lineItemIdsPresent: true,
        refundIdPresent: false,
        financialStatus: null,
        fulfillmentStatus: null,
        matchedOrderId: 'shopify-order-db-1029',
        matchedByField: 'order_id',
      },
    });

    renderOrderDetail();

    const diagnostics = await screen.findByLabelText('Shopify return signal diagnostics');
    expect(within(diagnostics).getByText('Shopify return signal discovery')).toBeInTheDocument();
    expect(within(diagnostics).getByText('returns/update')).toBeInTheDocument();
    expect(within(diagnostics).getByText('order_id')).toBeInTheDocument();
    expect(within(diagnostics).getAllByText('yes').length).toBeGreaterThanOrEqual(2);
    expect(within(diagnostics).getByText('admin_graphql_api_id, id, order_id, return_line_items')).toBeInTheDocument();
  });

  it('warns when tracking is stored locally but Shopify fulfillment is unconfirmed', async () => {
    getOrderMock.mockResolvedValue({
      ...orderWithShipmentSummary,
      carrier: 'Sürat Kargo',
      trackingNumber: 'OTO-TRACK-1028',
      fulfilledAt: undefined,
      shopifyFulfillmentSync: {
        status: 'pending',
        fulfillmentOrderIdPresent: true,
        fulfillmentIdPresent: false,
        syncStatus: 'carrier_created',
        skippedReason: null,
        errorMessage: null,
        lastAttemptedAt: '2026-05-15T19:47:00.000Z',
      },
      shipmentExecution: {
        ...orderWithShipmentSummary.shipmentExecution!,
        provider: 'try_oto',
        providerCarrierName: 'Sürat Marketplace',
        shipmentStatus: 'created',
        providerShipmentId: 'OTO-SHIP-1028',
        trackingNumber: 'OTO-TRACK-1028',
        trackingUrl: 'https://tracking.tryoto.example/OTO-TRACK-1028',
        labelUrl: 'https://app.tryoto.example/label-1028.pdf',
        providerResponseSummary: null,
      },
    });
    setCurrentUser({
      email: 'vendor@example.com',
      name: 'Vendor User',
      role: 'vendor',
      vendorAccess: ['sporjinal'],
      vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
      canSwitchVendors: false,
      defaultVendorId: 'sporjinal',
    });

    renderOrderDetail();

    expect(
      await screen.findByText('Pending · Tracking is stored locally, but Shopify fulfillment has not been confirmed.'),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Shopify fulfillment diagnostics')).not.toBeInTheDocument();
  });

  it('shows Shopify fulfillment sync status when no latest shipment execution is present', async () => {
    getOrderMock.mockResolvedValue({
      ...orderWithShipmentSummary,
      carrier: 'Sürat Kargo',
      trackingNumber: 'OTO-TRACK-1028',
      trackingUrl: 'https://tracking.tryoto.example/OTO-TRACK-1028',
      fulfilledAt: undefined,
      shipmentExecution: null,
      shopifyFulfillmentSync: {
        status: 'pending',
        fulfillmentOrderIdPresent: true,
        fulfillmentIdPresent: false,
        syncStatus: 'carrier_created',
        skippedReason: null,
        errorMessage: null,
        lastAttemptedAt: '2026-05-15T19:47:00.000Z',
      },
    });
    setCurrentUser({
      email: 'vendor@example.com',
      name: 'Vendor User',
      role: 'vendor',
      vendorAccess: ['sporjinal'],
      vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
      canSwitchVendors: false,
      defaultVendorId: 'sporjinal',
    });

    renderOrderDetail();

    const fulfillmentStatus = await screen.findByLabelText('Shopify fulfillment status');
    expect(within(fulfillmentStatus).getByText('Shopify fulfillment')).toBeInTheDocument();
    expect(
      within(fulfillmentStatus).getByText('Pending · Tracking is stored locally, but Shopify fulfillment has not been confirmed.'),
    ).toBeInTheDocument();
  });

  it('shows admin-only Shopify fulfillment diagnostics for missing fulfillment order data', async () => {
    getOrderMock.mockResolvedValue({
      ...orderWithShipmentSummary,
      carrier: 'Sürat Kargo',
      trackingNumber: 'OTO-TRACK-1028',
      fulfilledAt: undefined,
      shopifyFulfillmentSync: {
        status: 'failed',
        fulfillmentOrderIdPresent: false,
        fulfillmentIdPresent: false,
        syncStatus: 'fulfillment_sync_failed',
        skippedReason: null,
        errorMessage: 'Shopify fulfillment order data is missing; cannot sync tracking automatically.',
        lastAttemptedAt: '2026-05-15T19:47:00.000Z',
      },
      shipmentExecution: {
        ...orderWithShipmentSummary.shipmentExecution!,
        provider: 'try_oto',
        providerCarrierName: 'Sürat Marketplace',
        shipmentStatus: 'created',
        providerShipmentId: 'OTO-SHIP-1028',
        trackingNumber: 'OTO-TRACK-1028',
        trackingUrl: 'https://tracking.tryoto.example/OTO-TRACK-1028',
        labelUrl: 'https://app.tryoto.example/label-1028.pdf',
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

    expect(
      await screen.findByText('Failed · Shopify fulfillment sync failed. Admin diagnostics include the safe error summary.'),
    ).toBeInTheDocument();
    const diagnostics = screen.getByLabelText('Shopify fulfillment diagnostics');
    expect(within(diagnostics).getByText('Fulfillment order id present')).toBeInTheDocument();
    expect(within(diagnostics).getAllByText('no').length).toBeGreaterThanOrEqual(2);
    expect(
      within(diagnostics).getByText('Shopify fulfillment order data is missing; cannot sync tracking automatically.'),
    ).toBeInTheDocument();
  });

  it('syncs Try OTO shipment tracking to Shopify with the selected carrier name', async () => {
    const user = userEvent.setup();
    getOrderMock.mockResolvedValue({
      ...orderWithShipmentSummary,
      carrier: 'try_oto',
      trackingNumber: null,
      trackingUrl: null,
      fulfilledAt: undefined,
      shipmentExecution: {
        ...orderWithShipmentSummary.shipmentExecution!,
        id: 'shipment-try_oto-alloc-sporjinal-7621783322961',
        provider: 'try_oto',
        providerCarrierName: 'Sürat Marketplace',
        shipmentStatus: 'created',
        providerShipmentId: 'OTO-SHIP-1028',
        trackingNumber: 'OTO-TRACK-1028',
        trackingUrl: 'https://tracking.tryoto.example/OTO-TRACK-1028',
        barcode: null,
        labelUrl: 'https://app.tryoto.example/label-1028.pdf',
        providerResponseSummary: null,
      },
    });
    setCurrentUser({
      email: 'vendor@example.com',
      name: 'Vendor User',
      role: 'vendor',
      vendorAccess: ['sporjinal'],
      vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
      canSwitchVendors: false,
      defaultVendorId: 'sporjinal',
    });

    renderOrderDetail();

    await user.click(await screen.findByRole('button', { name: 'Sync tracking to Shopify' }));

    expect(submitFulfillmentTrackingMock).toHaveBeenCalledWith('alloc-sporjinal-7621783322961', {
      trackingNumber: 'OTO-TRACK-1028',
      carrier: 'Sürat Kargo',
      trackingUrl: 'https://tracking.tryoto.example/OTO-TRACK-1028',
      notifyCustomer: false,
    });
    expect(await screen.findByText('Tracking OTO-TRACK-1028 synced to Shopify.')).toBeInTheDocument();
  });

  it('falls back to Try OTO as the Shopify carrier when delivery company is unavailable', async () => {
    const user = userEvent.setup();
    getOrderMock.mockResolvedValue({
      ...orderWithShipmentSummary,
      carrier: 'try_oto',
      trackingNumber: null,
      fulfilledAt: undefined,
      shipmentExecution: {
        ...orderWithShipmentSummary.shipmentExecution!,
        id: 'shipment-try_oto-alloc-sporjinal-7621783322961',
        provider: 'try_oto',
        providerCarrierName: null,
        shipmentStatus: 'created',
        providerShipmentId: 'OTO-SHIP-1028',
        trackingNumber: 'OTO-TRACK-1028',
        trackingUrl: null,
        barcode: null,
        labelUrl: 'https://app.tryoto.example/label-1028.pdf',
        providerResponseSummary: null,
      },
    });
    setCurrentUser({
      email: 'vendor@example.com',
      name: 'Vendor User',
      role: 'vendor',
      vendorAccess: ['sporjinal'],
      vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
      canSwitchVendors: false,
      defaultVendorId: 'sporjinal',
    });

    renderOrderDetail();

    await user.click(await screen.findByRole('button', { name: 'Sync tracking to Shopify' }));

    expect(submitFulfillmentTrackingMock).toHaveBeenCalledWith('alloc-sporjinal-7621783322961', {
      trackingNumber: 'OTO-TRACK-1028',
      carrier: 'Try OTO',
      trackingUrl: undefined,
      notifyCustomer: false,
    });
  });

  it('does not show Shopify sync action after fulfillment sync has a fulfilled timestamp', async () => {
    getOrderMock.mockResolvedValue({
      ...orderWithShipmentSummary,
      carrier: 'try_oto',
      trackingNumber: 'OTO-TRACK-1028',
      fulfilledAt: '2026-05-15T19:47:00.000Z',
      shipmentExecution: {
        ...orderWithShipmentSummary.shipmentExecution!,
        id: 'shipment-try_oto-alloc-sporjinal-7621783322961',
        provider: 'try_oto',
        providerCarrierName: 'Sürat Marketplace',
        shipmentStatus: 'created',
        providerShipmentId: 'OTO-SHIP-1028',
        trackingNumber: 'OTO-TRACK-1028',
        labelUrl: 'https://app.tryoto.example/label-1028.pdf',
        providerResponseSummary: null,
      },
    });
    setCurrentUser({
      email: 'vendor@example.com',
      name: 'Vendor User',
      role: 'vendor',
      vendorAccess: ['sporjinal'],
      vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
      canSwitchVendors: false,
      defaultVendorId: 'sporjinal',
    });

    renderOrderDetail();

    expect(await screen.findByText('Same as tracking')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sync tracking to Shopify' })).not.toBeInTheDocument();
  });

  it('keeps Kargo provider display unchanged in shipment summaries', async () => {
    setCurrentUser({
      email: 'vendor@example.com',
      name: 'Vendor User',
      role: 'vendor',
      vendorAccess: ['sporjinal'],
      vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
      canSwitchVendors: false,
      defaultVendorId: 'sporjinal',
    });

    renderOrderDetail();

    expect((await screen.findAllByText('Kargo Entegratör')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Sync tracking to Shopify' })).not.toBeInTheDocument();
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
