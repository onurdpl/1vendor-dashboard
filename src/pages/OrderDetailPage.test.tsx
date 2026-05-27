import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrderDetail } from '../features/orders/api';
import { setCurrentUser, setToken } from '../lib/auth';
import { ApiError } from '../lib/api/errors';
import type { SupportTicket } from '../lib/api/contracts';
import { OrderDetailPage } from './OrderDetailPage';

const getOrderMock = vi.fn<(orderId: string) => Promise<OrderDetail>>();
const getShippingProviderDiagnosticsMock = vi.fn();
const getVendorShippingConfigMock = vi.fn();
const updateVendorShippingConfigMock = vi.fn();
const createShipmentExecutionMock = vi.fn();
const retryShipmentExecutionMock = vi.fn();
const retryFailedShipmentExecutionMock = vi.fn();
const refreshShipmentExecutionStatusMock = vi.fn();
const cancelShipmentExecutionMock = vi.fn();
const updateNavlungoShipmentExecutionMock = vi.fn();
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
const createSupportTicketMock = vi.fn();
const escalateVendorSupportTicketMock = vi.fn();
const runtimeDiagnosticsMocks = vi.hoisted(() => ({
  kargonomiLocationLookup: vi.fn(),
  navlungoAuth: vi.fn(),
  navlungoCarriers: vi.fn(),
  navlungoCreatePostProbe: vi.fn(),
  navlungoCheckPostProbe: vi.fn(),
  navlungoBarcodeProbe: vi.fn(),
}));

vi.mock('../config/runtime', () => ({
  runtimeConfig: {
    apiMode: 'real',
    apiBaseUrl: 'http://localhost:4000',
  },
}));

vi.mock('../services/runtime-services', () => ({
  runtimeServices: {
    diagnostics: {
      kargonomiLocationLookup: () => runtimeDiagnosticsMocks.kargonomiLocationLookup(),
      navlungoAuth: () => runtimeDiagnosticsMocks.navlungoAuth(),
      navlungoCarriers: () => runtimeDiagnosticsMocks.navlungoCarriers(),
      navlungoCreatePostProbe: (payload: { confirm: 'YES' }) => runtimeDiagnosticsMocks.navlungoCreatePostProbe(payload),
      navlungoCheckPostProbe: (payload: { postNumber: string }) => runtimeDiagnosticsMocks.navlungoCheckPostProbe(payload),
      navlungoBarcodeProbe: (payload: { postNumber: string }) => runtimeDiagnosticsMocks.navlungoBarcodeProbe(payload),
    },
  },
}));

vi.mock('../features/orders/api', async () => {
  const actual = await vi.importActual<typeof import('../features/orders/api')>('../features/orders/api');
  return {
    ...actual,
    getOrder: (orderId: string) => getOrderMock(orderId),
    getShippingProviderDiagnostics: (options?: { vendorId?: string | null; provider?: string | null }) =>
      getShippingProviderDiagnosticsMock(options),
    getVendorShippingConfig: (options?: { vendorId?: string | null }) => getVendorShippingConfigMock(options),
    updateVendorShippingConfig: (vendorId: string, input: unknown) => updateVendorShippingConfigMock(vendorId, input),
    createShipmentExecution: (allocationId: string, options?: { vendorId?: string | null }) => createShipmentExecutionMock(allocationId, options),
    retryShipmentExecution: (shipmentExecutionId: string) => retryShipmentExecutionMock(shipmentExecutionId),
    retryFailedShipmentExecution: (
      shipmentExecutionId: string,
      options?: {
        vendorId?: string | null;
        customerOverrides?: Record<string, string>;
        useFullSenderDetailsForThisRetry?: boolean;
      },
    ) => retryFailedShipmentExecutionMock(shipmentExecutionId, options),
    refreshShipmentExecutionStatus: (shipmentExecutionId: string, options?: { vendorId?: string | null }) =>
      refreshShipmentExecutionStatusMock(shipmentExecutionId, options),
    cancelShipmentExecution: (shipmentExecutionId: string, options?: { vendorId?: string | null }) =>
      cancelShipmentExecutionMock(shipmentExecutionId, options),
    updateNavlungoShipmentExecution: (
      shipmentExecutionId: string,
      payload: unknown,
      options?: { vendorId?: string | null },
    ) => updateNavlungoShipmentExecutionMock(shipmentExecutionId, payload, options),
    createReturnShipmentLabel: (shipmentExecutionId: string, options?: { vendorId?: string | null; dryRun?: boolean }) =>
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
    createSupportTicket: (input: unknown) => createSupportTicketMock(input),
    escalateVendorSupportTicket: (ticketId: string) => escalateVendorSupportTicketMock(ticketId),
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

function buildSupportTicket(overrides: Partial<SupportTicket> = {}): SupportTicket {
  return {
    id: 'ticket-shipment-1',
    createdAt: '2026-05-15T20:00:00.000Z',
    updatedAt: '2026-05-15T20:05:00.000Z',
    createdByUserId: 'vendor-user',
    createdByRole: 'VENDOR',
    vendorId: 'sporjinal',
    vendorName: 'Sporjinal',
    subject: 'Help with order #1028',
    message: 'Tracking has not updated.',
    priority: 'normal',
    status: 'OPEN',
    category: 'TRACKING',
    assigneeUserId: null,
    assigneeName: null,
    vendorUnreadCount: 0,
    adminUnreadCount: 1,
    lastReplyAt: null,
    lastReplyByRole: null,
    firstResponseDueAt: null,
    nextResponseDueAt: null,
    escalatedAt: null,
    escalationReason: null,
    sla: null,
    contextType: 'shipment',
    contextId: orderWithShipmentSummary.shipmentExecution!.id,
    contextSummary: { orderNumber: '#1028' },
    resolvedAt: null,
    closedAt: null,
    ...overrides,
  };
}

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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function buildNavlungoRequestSummary(overrides: Partial<NonNullable<NonNullable<OrderDetail['shipmentExecution']>['providerResponseSummary']>['navlungoRequestSummary']> = {}) {
  return {
    baseUrl: 'domestic-api.navlungo.com/v2',
    baseUrlHost: 'domestic-api.navlungo.com',
    baseUrlPath: '/v2',
    endpointPath: '/post/create',
    method: 'POST',
    headerKeys: ['Accept', 'Authorization', 'Content-Type', 'X-localization'],
    topLevelBodyKeys: ['platform', 'posts'],
    postKeys: ['barcode_format', 'carrier_id', 'custom_data_1', 'custom_data_2', 'custom_data_3', 'custom_data_4', 'post', 'post_type', 'recipient', 'reference_id', 'sender'],
    senderKeys: ['address', 'city', 'country', 'district', 'email', 'name', 'phone', 'post_code'],
    recipientKeys: ['address', 'city', 'country', 'district', 'email', 'name', 'phone', 'post_code'],
    postPayloadKeys: ['desi', 'note', 'package_count'],
    barcodeFormatPresent: true,
    barcodeFormatType: 'string',
    codPaymentTypePresent: false,
    codPaymentType: null,
    postPricePresent: false,
    postPriceType: null,
    requestedCarrierId: 9,
    requestedPostType: 2,
    senderUsesAddressId: false,
    senderFullObjectKeysPresent: true,
    customData1Present: true,
    customData2Present: true,
    customData3Present: true,
    customData4Present: true,
    recipientDistrictPresent: true,
    recipientCityPresent: true,
    recipientCountryPresent: true,
    recipientPostCodePresent: false,
    recipientPhonePresent: true,
    recipientPhoneFormatValid: true,
    recipientEmailPresent: true,
    recipientEmailFormatValid: true,
    recipientAddressPresent: true,
    recipientAddressLength: 38,
    packageCountPresent: true,
    packageCountType: 'number',
    requestedPackageCount: 1,
    desiPresent: true,
    desiType: 'number',
    requestedDesi: 3,
    postNotePresent: true,
    postNoteType: 'string-empty',
    postNoteLength: 0,
    ...overrides,
  };
}

describe('OrderDetailPage shipment provider response visibility', () => {
  beforeEach(() => {
    cleanup();
    window.localStorage.clear();
    setToken('test-token');
    getOrderMock.mockReset();
    getOrderMock.mockResolvedValue(orderWithShipmentSummary);
    getShippingProviderDiagnosticsMock.mockReset();
    getShippingProviderDiagnosticsMock.mockImplementation((options?: { provider?: string | null }) => {
      if (options?.provider === 'navlungo') {
        return Promise.resolve({
          provider: 'navlungo',
          supportedProviders: ['navlungo'],
          executionReady: true,
          sandboxModeEnabled: false,
          shippingExecutionEnabled: true,
          providerSelected: true,
          providerEnabled: true,
          webhookIngestEnabled: false,
          baseUrlConfigured: true,
          apiKeyConfigured: true,
          cargoIntegrationIdConfigured: false,
          warehouseIdConfigured: true,
          defaultDesiConfigured: true,
          packageTypeUsed: '',
          notificationUrlConfigured: false,
          webhookRouteImplemented: false,
          receiverAddressAvailability: 'unknown_required',
          dummyKargoSupport: 'not_implemented',
          statusSyncSupport: 'not_implemented',
          missing: [],
          deprecatedEnvFallbacks: [],
          warnings: ['Navlungo forward shipment execution is enabled only when explicitly selected.'],
          navlungo: {
            usernameConfigured: true,
            passwordConfigured: true,
            defaultSenderAddressIdConfigured: true,
            defaultBarcodeFormat: 'pdf-A6',
            defaultCarrierId: '9',
            authDiagnosticsAvailable: true,
            runtimeShipmentExecutionEnabled: true,
            returnReverseImplementation: 'not_implemented',
          },
        });
      }
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
      if (options?.provider === 'kargonomi') {
        return Promise.resolve({
          provider: 'kargonomi',
          supportedProviders: ['kargo_entegrator', 'hepsijet', 'kargonomi'],
          executionReady: true,
          sandboxModeEnabled: false,
          shippingExecutionEnabled: true,
          providerSelected: true,
          providerEnabled: true,
          webhookIngestEnabled: false,
          baseUrlConfigured: true,
          apiKeyConfigured: true,
          cargoIntegrationIdConfigured: false,
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
          warnings: ['Kargonomi return/reverse shipment is not implemented.'],
        });
      }

      return Promise.resolve({
        provider: 'kargo_entegrator',
        supportedProviders: ['kargo_entegrator', 'hepsijet', 'kargonomi'],
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
    runtimeDiagnosticsMocks.kargonomiLocationLookup.mockReset();
    runtimeDiagnosticsMocks.kargonomiLocationLookup.mockResolvedValue({
      baseUrlHost: 'app.kargonomi.com.tr',
      baseUrlPath: '/api/v1',
      baseUrlParseError: null,
      tokenPresent: true,
      statesRequestUrl: '/states/1',
      statesHttpStatus: 200,
      statesFetchError: null,
      statesContentType: 'application/json',
      statesShapeSummary: {
        kind: 'json:array',
        itemCount: 2,
        topLevelKeys: [],
      },
      firstStateNames: ['İstanbul', 'Ankara'],
      istanbulStateId: '34',
      citiesRequestUrl: '/cities/34',
      citiesHttpStatus: 200,
      citiesFetchError: null,
      citiesContentType: 'application/json',
      citiesShapeSummary: {
        kind: 'json:array',
        itemCount: 2,
        topLevelKeys: [],
      },
      firstCityNames: ['Kartal', 'Kadıköy'],
    });
    runtimeDiagnosticsMocks.navlungoAuth.mockReset();
    runtimeDiagnosticsMocks.navlungoAuth.mockResolvedValue({
      provider: 'navlungo',
      displayName: 'Navlungo',
      dormant: true,
      baseUrlHost: 'domestic-api.navlungo.com',
      baseUrlPath: '/v2',
      baseUrlParseError: null,
      usernamePresent: true,
      passwordPresent: true,
      authRequestUrl: '/v2/auth/api',
      authHttpStatus: 200,
      authContentType: 'application/json',
      responseShapeSummary: {
        kind: 'json:object',
        topLevelKeys: ['status', 'message', 'data'],
      },
      responseDataShapeSummary: {
        kind: 'json:object',
        topLevelKeys: ['token_type', 'expires_in', 'access_token', 'refresh_token'],
      },
      tokenKeyPresence: {
        rootAccessToken: false,
        dataAccessToken: true,
        dataToken: false,
        anyTokenLikeKey: true,
      },
      refreshTokenKeyPresence: {
        rootRefreshToken: false,
        dataRefreshToken: true,
      },
      expiresInPresent: true,
      tokenTypePresent: true,
      tokenReceived: true,
      refreshTokenReceived: true,
      expiresIn: 86400,
      authValidationErrorKeys: [],
      authValidationErrorMessages: [],
      authFailedFieldNames: [],
      fetchError: null,
    });
    runtimeDiagnosticsMocks.navlungoCarriers.mockReset();
    runtimeDiagnosticsMocks.navlungoCarriers.mockResolvedValue({
      provider: 'navlungo',
      displayName: 'Navlungo',
      dormant: true,
      authHttpStatus: 200,
      authContentType: 'application/json',
      authTokenReceived: true,
      carrierEndpointPathsKnown: false,
      skippedReason: 'carrier_endpoint_paths_unknown',
      myCarriersRequestUrl: null,
      myCarriersHttpStatus: null,
      myCarriersContentType: null,
      myCarriersResponseShape: null,
      myCarriersDataShape: null,
      myCarrierCount: null,
      myCarrierSamples: [],
      listCarriersRequestUrl: null,
      listCarriersHttpStatus: null,
      listCarriersContentType: null,
      listCarriersResponseShape: null,
      listCarriersDataShape: null,
      listCarrierCount: null,
      listCarrierSamples: [],
      anyConfiguredCarrier: false,
      providerMessages: ['Navlungo carrier endpoint paths are unknown. Official carrier pages do not expose request paths.'],
      fetchError: null,
    });
    runtimeDiagnosticsMocks.navlungoCreatePostProbe.mockReset();
    runtimeDiagnosticsMocks.navlungoCreatePostProbe.mockResolvedValue({
      provider: 'navlungo',
      dormant: true,
      authHttpStatus: 200,
      authContentType: 'application/json',
      authTokenReceived: true,
      requestedCarrierId: 9,
      requestedPostType: 2,
      requestedBarcodeFormat: 'pdf-A6',
      codPaymentIncluded: false,
      priceIncluded: false,
      requestSummary: buildNavlungoRequestSummary(),
      createPostHttpStatus: 201,
      createPostContentType: 'application/json',
      responseShape: {
        kind: 'json:object',
        topLevelKeys: ['post_number', 'reference_id', 'tracking_url', 'barcode_url', 'post'],
      },
      dataShape: null,
      topLevelKeys: ['post_number', 'reference_id', 'tracking_url', 'barcode_url', 'post'],
      dataKeys: [],
      postNumber: 'NP12345',
      postNumberPresent: true,
      referenceId: 'NAVLUNGO-PROBE-1700000000000',
      referenceIdPresent: true,
      trackingUrlPresent: true,
      barcodeUrlPresent: true,
      barcodePresent: true,
      barcodeType: 'string',
      carrierIdPresent: true,
      carrierId: 9,
      carrierNamePresent: true,
      carrierName: 'Sürat Kargo',
      postCarrierKeys: ['carrier_id', 'carrier_name'],
      providerMessage: null,
      errorMessage: null,
    });
    runtimeDiagnosticsMocks.navlungoCheckPostProbe.mockReset();
    runtimeDiagnosticsMocks.navlungoCheckPostProbe.mockResolvedValue({
      provider: 'navlungo',
      dormant: true,
      postNumber: 'NP12345',
      authHttpStatus: 200,
      authContentType: 'application/json',
      authTokenReceived: true,
      checkPostHttpStatus: 200,
      checkPostContentType: 'application/json',
      responseShape: { kind: 'json:object', topLevelKeys: ['status', 'message', 'data'] },
      dataShape: { kind: 'json:object', topLevelKeys: ['post_number', 'tracking_url', 'barcode', 'post', 'status'] },
      dataKeys: ['post_number', 'tracking_url', 'barcode', 'post', 'status'],
      statusKeys: ['status_code', 'status_name'],
      postNumberPresent: true,
      trackingUrlPresent: true,
      carrierTrackingUrlPresent: false,
      barcodePresent: true,
      barcodeType: 'string',
      carrierIdPresent: true,
      carrierNamePresent: true,
      statusCode: 1,
      statusName: 'To be Picked Up',
      providerMessage: null,
      errorMessage: null,
    });
    runtimeDiagnosticsMocks.navlungoBarcodeProbe.mockReset();
    runtimeDiagnosticsMocks.navlungoBarcodeProbe.mockResolvedValue({
      provider: 'navlungo',
      dormant: true,
      postNumber: 'NP12345',
      barcodeEndpointPathKnown: false,
      skippedReason: 'barcode_endpoint_path_unknown',
      barcodeHttpStatus: null,
      barcodeContentType: null,
      responseShape: null,
      barcodeFieldPresent: false,
      barcodeUrlPresent: false,
      barcodeBase64Present: false,
      providerMessage: 'Official Navlungo Barcode > Get Barcode page does not expose an endpoint path in the reviewed HTML.',
      errorMessage: null,
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
        kargonomiBuyerStateId: '34',
        kargonomiBuyerCityId: '828',
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
        kargonomiBuyerStateId: '34',
        kargonomiBuyerCityId: '828',
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
    cancelShipmentExecutionMock.mockReset();
    cancelShipmentExecutionMock.mockResolvedValue({
      ...orderWithShipmentSummary.shipmentExecution,
      provider: 'navlungo',
      shipmentStatus: 'cancelled',
      providerShipmentId: 'NAV-1028',
      trackingNumber: 'NAV-1028',
      labelUrl: 'barcode-pdf',
      providerResponseSummary: {
        ...orderWithShipmentSummary.shipmentExecution!.providerResponseSummary!,
        navlungoCancelAttempted: true,
        navlungoCancelSucceeded: true,
        navlungoCancelHttpStatus: 200,
        navlungoCancelledAt: '2026-05-22T10:00:00.000Z',
        shopifyFulfillmentCancelSyncSkippedReason: 'not_implemented',
      },
      updatedAt: '2026-05-22T10:00:00.000Z',
    });
    updateNavlungoShipmentExecutionMock.mockReset();
    updateNavlungoShipmentExecutionMock.mockResolvedValue({
      ...orderWithShipmentSummary.shipmentExecution,
      provider: 'navlungo',
      shipmentStatus: 'created',
      providerShipmentId: 'NAV-1028',
      trackingNumber: 'NAV-1028',
      labelUrl: 'barcode-pdf',
      providerResponseSummary: {
        ...orderWithShipmentSummary.shipmentExecution!.providerResponseSummary!,
        navlungoUpdateAttempted: true,
        navlungoUpdateSucceeded: true,
        navlungoUpdateHttpStatus: 200,
        navlungoUpdatedAt: '2026-05-22T10:00:00.000Z',
        shopifyFulfillmentUpdateSyncSkippedReason: 'not_implemented',
      },
      updatedAt: '2026-05-22T10:00:00.000Z',
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
          shopifyReturnIdPresent: true,
          trackingAccepted: true,
          labelAccepted: true,
          returnedCarrierName: 'Sürat Kargo',
          carrierNamePresent: true,
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
    createSupportTicketMock.mockReset();
    createSupportTicketMock.mockResolvedValue({
      id: 'support-ticket-1',
      subject: 'Help with order #1028',
      status: 'OPEN',
    });
    escalateVendorSupportTicketMock.mockReset();
  });

  it('renders the Order Detail frame before primary data and defers provider diagnostics', () => {
    setCurrentUser({
      email: 'admin@demo.com',
      name: 'Demo Admin',
      role: 'admin',
      vendorAccess: ['sporjinal'],
      vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
      canSwitchVendors: true,
      defaultVendorId: 'sporjinal',
    });
    const orderResult = deferred<OrderDetail>();
    getOrderMock.mockReturnValue(orderResult.promise);

    renderOrderDetail();

    expect(screen.getByLabelText('Order detail render frame')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Order detail' })).toBeInTheDocument();
    expect(screen.getByLabelText('Order summary skeleton')).toBeInTheDocument();
    expect(screen.getByLabelText('Order line item skeleton')).toBeInTheDocument();
    expect(screen.getByLabelText('Order timeline skeleton')).toBeInTheDocument();
    expect(getShippingProviderDiagnosticsMock).not.toHaveBeenCalled();
    expect(getVendorShippingConfigMock).not.toHaveBeenCalled();
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

  it('renders Shopify line item image snapshots when available', async () => {
    setCurrentUser({
      email: 'admin@demo.com',
      name: 'Demo Admin',
      role: 'admin',
      vendorAccess: ['sporjinal'],
      vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
      canSwitchVendors: true,
      defaultVendorId: 'sporjinal',
    });
    getOrderMock.mockResolvedValue({
      ...orderWithShipmentSummary,
      lineItems: [
        {
          ...orderWithShipmentSummary.lineItems[0],
          imageUrl: 'https://cdn.shopify.com/s/files/line-item.jpg',
        },
      ],
    });

    const { container } = renderOrderDetail();

    await screen.findByText('Nike Air Max Alpha Trainer 6');
    const image = container.querySelector<HTMLImageElement>('.order-item-thumb img');
    expect(image).toBeTruthy();
    expect(image?.src).toBe('https://cdn.shopify.com/s/files/line-item.jpg');
  });

  it('opens and closes a line item image preview modal from the thumbnail', async () => {
    setCurrentUser({
      email: 'admin@demo.com',
      name: 'Demo Admin',
      role: 'admin',
      vendorAccess: ['sporjinal'],
      vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
      canSwitchVendors: true,
      defaultVendorId: 'sporjinal',
    });
    getOrderMock.mockResolvedValue({
      ...orderWithShipmentSummary,
      lineItems: [
        {
          ...orderWithShipmentSummary.lineItems[0],
          imageUrl: 'https://cdn.shopify.com/s/files/line-item.jpg',
        },
      ],
    });

    renderOrderDetail();

    const previewButton = await screen.findByRole('button', {
      name: /Preview Nike Air Max Alpha Trainer 6/i,
    });
    await userEvent.click(previewButton);

    expect(screen.getByRole('dialog', { name: /Nike Air Max Alpha Trainer 6 image preview/i })).toBeInTheDocument();
    const backdrop = document.querySelector('.line-item-image-lightbox-backdrop');
    expect(backdrop?.parentElement).toBe(document.body);
    expect(document.body.style.overflow).toBe('hidden');

    await userEvent.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /Nike Air Max Alpha Trainer 6 image preview/i })).not.toBeInTheDocument();
      expect(document.body.style.overflow).toBe('');
    });
  });

  it('keeps the line item thumbnail fallback when no Shopify image snapshot exists', async () => {
    setCurrentUser({
      email: 'admin@demo.com',
      name: 'Demo Admin',
      role: 'admin',
      vendorAccess: ['sporjinal'],
      vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
      canSwitchVendors: true,
      defaultVendorId: 'sporjinal',
    });
    getOrderMock.mockResolvedValue({
      ...orderWithShipmentSummary,
      lineItems: [
        {
          ...orderWithShipmentSummary.lineItems[0],
          imageUrl: null,
        },
      ],
    });

    const { container } = renderOrderDetail();

    await screen.findByText('Nike Air Max Alpha Trainer 6');
    expect(container.querySelector('.order-item-thumb img')).toBeNull();
    expect(container.querySelector('.order-item-thumb-fallback')?.textContent).toBe('NA');
  });

  it('requires confirmation before cancelling a Navlungo shipment', async () => {
    setCurrentUser({
      email: 'admin@demo.com',
      name: 'Demo Admin',
      vendorId: 'sporjinal',
      role: 'admin',
      vendorAccess: ['sporjinal'],
      vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
      canSwitchVendors: true,
      defaultVendorId: 'sporjinal',
    });
    const navlungoOrder: OrderDetail = {
      ...orderWithShipmentSummary,
      shipmentExecution: {
        ...orderWithShipmentSummary.shipmentExecution!,
        provider: 'navlungo',
        providerShipmentId: 'NAV-1028',
        trackingNumber: 'NAV-1028',
        trackingUrl: 'https://tracking.navlungo.test/NAV-1028',
        labelUrl: 'barcode-pdf',
        shipmentStatus: 'created',
        providerResponseSummary: {
          ...orderWithShipmentSummary.shipmentExecution!.providerResponseSummary!,
          ok: true,
          providerShipmentIdPresent: true,
          trackingNumberPresent: true,
          labelPresent: true,
          barcodePresent: true,
        },
      },
    };
    getOrderMock.mockResolvedValue(navlungoOrder);
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValueOnce(true);

    renderOrderDetail();

    const cancelButtons = await screen.findAllByRole('button', { name: 'Cancel Navlungo shipment' });
    await userEvent.click(cancelButtons[0]);

    expect(confirmSpy).toHaveBeenCalledWith(
      'Cancel this Navlungo shipment? Shopify fulfillment will not be deleted in this phase.',
    );
    expect(cancelShipmentExecutionMock).toHaveBeenCalledWith('shipment-kargo_entegrator-alloc-sporjinal-7621783322961', {
      vendorId: 'sporjinal',
    });
    expect((await screen.findAllByText('Navlungo shipment cancelled.')).length).toBeGreaterThan(0);
    confirmSpy.mockRestore();
  });

  it('allows admins to confirm and update a Navlungo shipment', async () => {
    const user = userEvent.setup();
    setCurrentUser({
      email: 'admin@demo.com',
      name: 'Demo Admin',
      vendorId: 'sporjinal',
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
        provider: 'navlungo',
        providerShipmentId: 'NAV-1028',
        trackingNumber: 'NAV-1028',
        trackingUrl: 'https://tracking.navlungo.example/NAV-1028',
        labelUrl: 'barcode-pdf',
        shipmentStatus: 'created',
      },
    });

    renderOrderDetail();

    await user.click((await screen.findAllByText('Update Navlungo shipment'))[0]);
    expect(screen.getByText('Leave fields empty to keep current shipment values.')).toBeInTheDocument();
    expect(screen.getByText('Recipient info')).toBeInTheDocument();
    expect(screen.getByText('Shipment options')).toBeInTheDocument();
    await user.type(screen.getAllByLabelText('District *')[0], 'Kartal');
    const updateButton = screen.getAllByRole('button', { name: 'Update Navlungo shipment' })[0];
    expect(updateButton).toBeDisabled();
    await user.click(screen.getByLabelText(/Update only the Navlungo shipment/i));
    await user.click(updateButton);

    await waitFor(() =>
      expect(updateNavlungoShipmentExecutionMock).toHaveBeenCalledWith(
        'shipment-kargo_entegrator-alloc-sporjinal-7621783322961',
        {
          recipient: {
            district: 'Kartal',
          },
          postNote: '',
          barcodeFormat: '',
        },
        {
          vendorId: 'sporjinal',
        },
      ),
    );
    expect((await screen.findAllByText('Navlungo shipment updated')).length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText('District *')[0]).toHaveValue('Kartal');
    expect(await screen.findByText('Update Post')).toBeInTheDocument();
    expect(screen.getByText(/attempted yes · HTTP 200 · succeeded yes/i)).toBeInTheDocument();
    expect(screen.getByText('Updated at')).toBeInTheDocument();
  });

  it('repopulates persisted Navlungo update overrides after reload', async () => {
    setCurrentUser({
      email: 'admin@demo.com',
      name: 'Demo Admin',
      vendorId: 'sporjinal',
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
        provider: 'navlungo',
        providerShipmentId: 'NAV-1028',
        trackingNumber: 'NAV-1028',
        shipmentStatus: 'created',
        providerResponseSummary: {
          ...orderWithShipmentSummary.shipmentExecution!.providerResponseSummary!,
          navlungoUpdateAttempted: true,
          navlungoUpdateSucceeded: true,
          navlungoUpdateHttpStatus: 200,
          navlungoUpdateRecipientOverridePresent: true,
          navlungoUpdateRecipientOverrideKeys: ['city', 'district', 'postcode'],
          navlungoUpdateSubmittedRecipientOverrideKeys: ['district'],
          navlungoUpdateOptionOverrideKeys: ['postNote', 'barcodeFormat'],
          navlungoUpdateRecipientOverrides: {
            city: 'Istanbul',
            district: 'Kartal',
            postcode: '34870',
          },
          navlungoUpdatePostNote: 'Leave at reception',
          navlungoUpdateBarcodeFormat: 'pdf-A6',
        },
      },
    });

    renderOrderDetail();

    const updatePanel = await screen.findByLabelText('Navlungo shipment update');

    await waitFor(() => expect(within(updatePanel).getByLabelText('City *')).toHaveValue('Istanbul'));
    expect(within(updatePanel).getByLabelText('District *')).toHaveValue('Kartal');
    expect(within(updatePanel).getByLabelText('Postcode')).toHaveValue('34870');
    expect(within(updatePanel).getByLabelText('Post note')).toHaveValue('Leave at reception');
    expect(within(updatePanel).getByLabelText('Barcode format')).toHaveValue('pdf-A6');
    expect(screen.getByText(/yes · keys city, district, postcode/i)).toBeInTheDocument();
    expect(screen.getByText(/recipient district · options postNote, barcodeFormat/i)).toBeInTheDocument();
  });

  it('hides the Navlungo shipment update form from vendors while preserving cancellation', async () => {
    setCurrentUser({
      email: 'vendor@example.com',
      name: 'Sporjinal Vendor',
      vendorId: 'sporjinal',
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
        provider: 'navlungo',
        providerShipmentId: 'NAV-1028',
        trackingNumber: 'NAV-1028',
        shipmentStatus: 'created',
      },
    });

    renderOrderDetail();

    expect(await screen.findByRole('button', { name: 'Cancel Navlungo shipment' })).toBeInTheDocument();
    expect(screen.queryByText('Update Navlungo shipment')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('District *')).not.toBeInTheDocument();
  });

  it('renders failed Navlungo update diagnostics after provider rejection', async () => {
    const user = userEvent.setup();
    setCurrentUser({
      email: 'admin@demo.com',
      name: 'Demo Admin',
      vendorId: 'sporjinal',
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
        provider: 'navlungo',
        providerShipmentId: 'NAV-1028',
        trackingNumber: 'NAV-1028',
        trackingUrl: 'https://tracking.navlungo.example/NAV-1028',
        labelUrl: 'barcode-pdf',
        shipmentStatus: 'created',
      },
    });
    updateNavlungoShipmentExecutionMock.mockResolvedValueOnce({
      ...orderWithShipmentSummary.shipmentExecution!,
      provider: 'navlungo',
      providerShipmentId: 'NAV-1028',
      trackingNumber: 'NAV-1028',
      trackingUrl: 'https://tracking.navlungo.example/NAV-1028',
      labelUrl: 'barcode-pdf',
      shipmentStatus: 'created',
      providerResponseSummary: {
        ...orderWithShipmentSummary.shipmentExecution!.providerResponseSummary!,
        navlungoUpdateAttempted: true,
        navlungoUpdateSucceeded: false,
        navlungoUpdateHttpStatus: 422,
        navlungoUpdateProviderMessage: 'Doğrulama Hatası',
        navlungoUpdateValidationFields: ['posts.0.recipient.district'],
        navlungoUpdateValidationMessages: ['posts.0.recipient.district validation failed'],
        navlungoUpdateProviderTrackingId: '#update422',
        navlungoUpdateResponseShape: {
          kind: 'json:object',
          topLevelKeys: ['message', 'status', 'error'],
        },
        providerError: 'Doğrulama Hatası',
      },
    });

    renderOrderDetail();

    await user.click((await screen.findAllByText('Update Navlungo shipment'))[0]);
    await user.click(screen.getByLabelText(/Update only the Navlungo shipment/i));
    await user.click(screen.getAllByRole('button', { name: 'Update Navlungo shipment' })[0]);

    expect((await screen.findAllByText('Doğrulama Hatası')).length).toBeGreaterThan(0);
    expect(await screen.findByText(/attempted yes · HTTP 422 · succeeded no/i)).toBeInTheDocument();
    expect(screen.getByText('#update422')).toBeInTheDocument();
    expect(screen.getByText('json:object · message, status, error')).toBeInTheDocument();
    expect(screen.getByText('posts.0.recipient.district')).toBeInTheDocument();
    expect(screen.getByText('posts.0.recipient.district validation failed')).toBeInTheDocument();
  });

  it('renders Navlungo update provider tracking id for 500 diagnostics', async () => {
    setCurrentUser({
      email: 'admin@demo.com',
      name: 'Demo Admin',
      vendorId: 'sporjinal',
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
        provider: 'navlungo',
        providerShipmentId: 'NAV-1028',
        trackingNumber: 'NAV-1028',
        trackingUrl: 'https://tracking.navlungo.example/NAV-1028',
        labelUrl: 'barcode-pdf',
        shipmentStatus: 'created',
        providerResponseSummary: {
          ...orderWithShipmentSummary.shipmentExecution!.providerResponseSummary!,
          navlungoUpdateAttempted: true,
          navlungoUpdateSucceeded: false,
          navlungoUpdateHttpStatus: 500,
          navlungoUpdateProviderMessage: 'Execution of ServiceCallout failed.',
          navlungoUpdateProviderTrackingId: '#update500',
          providerError: 'Execution of ServiceCallout failed.',
        },
      },
    });

    renderOrderDetail();

    expect(await screen.findByText(/attempted yes · HTTP 500 · succeeded no/i)).toBeInTheDocument();
    expect(screen.getAllByText('Execution of ServiceCallout failed.').length).toBeGreaterThan(0);
    expect(screen.getByText('#update500')).toBeInTheDocument();
  });

  it('renders Navlungo cancel validation diagnostics safely', async () => {
    setCurrentUser({
      email: 'admin@demo.com',
      name: 'Demo Admin',
      vendorId: 'sporjinal',
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
        provider: 'navlungo',
        providerShipmentId: 'NAV-1028',
        shipmentStatus: 'created',
        providerResponseSummary: {
          ...orderWithShipmentSummary.shipmentExecution!.providerResponseSummary!,
          navlungoCancelAttempted: true,
          navlungoCancelHttpStatus: 422,
          navlungoCancelSucceeded: false,
          navlungoCancelProviderMessage: 'Validation Errors',
          navlungoCancelValidationFields: ['post_number'],
          navlungoCancelValidationMessages: ['post_number validation failed'],
          navlungoCancelProviderTrackingId: '#cancel422',
          shopifyFulfillmentCancelSyncSkippedReason: 'not_implemented',
        },
      },
    });

    renderOrderDetail();

    expect(await screen.findByText('Cancel validation fields')).toBeInTheDocument();
    expect(screen.getByText('post_number')).toBeInTheDocument();
    expect(screen.getByText('post_number validation failed')).toBeInTheDocument();
    expect(screen.getByText('#cancel422')).toBeInTheDocument();
    expect(screen.getByText('not_implemented')).toBeInTheDocument();
  });

  it('shows Navlungo detailed status sync diagnostics safely', async () => {
    setCurrentUser({
      email: 'admin@demo.com',
      name: 'Demo Admin',
      vendorId: 'sporjinal',
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
        provider: 'navlungo',
        providerShipmentId: 'NAV-1028',
        trackingNumber: 'SURAT-1028',
        shipmentStatus: 'in_transit',
        providerResponseSummary: {
          ...orderWithShipmentSummary.shipmentExecution!.providerResponseSummary!,
          navlungoStatusSyncAttempted: true,
          navlungoStatusSyncHttpStatus: 200,
          navlungoStatusSyncResolvedProviderUrl: 'https://domestic-api.navlungo.com/v2.1/post/check',
          navlungoStatusSyncRequestPayloadKeys: ['post', 'limit'],
          navlungoStatusSyncPostPayloadKeys: ['post_number'],
          navlungoStatusSyncLimit: 1,
          navlungoStatusSyncResponseShape: { kind: 'json:object', topLevelKeys: ['status', 'data'] },
          navlungoProviderStatusCode: 17,
          navlungoProviderStatusName: 'In Transit',
          navlungoNormalizedStatus: 'in_transit',
          navlungoPickedUpDate: '2026-05-22T09:00:00.000Z',
          navlungoCarrierTrackingCode: 'SURAT-1028',
          navlungoCarrierTrackingUrl: 'https://tracking.navlungo.example/SURAT-1028',
          navlungoBarcodeStatus: 'created',
          navlungoTrackingEnriched: true,
          navlungoGeoStatus: 'verified',
          navlungoGeoBadAddress: true,
          navlungoCarrierTrackingPresent: true,
          navlungoLogsCount: 2,
          navlungoStatusLogs: [
            { statusCode: 16, action: 'PickedUp', actionResult: 'Teslim Alındı', createdAt: '2026-05-22T09:00:00.000Z' },
            { statusCode: 17, action: 'Transfer', actionResult: 'Transfer merkezinde', createdAt: '2026-05-22T10:00:00.000Z' },
          ],
          navlungoStatusSyncProviderTrackingId: '#status-sync',
          navlungoStatusSyncValidationFields: ['post.post_number'],
          navlungoStatusSyncValidationMessages: ['post.post_number validation failed'],
          shopifyDeliveryStatusSyncSkippedReason: 'not_implemented',
        },
      },
    });

    renderOrderDetail();

    expect(await screen.findByText('Detailed status sync')).toBeInTheDocument();
    expect(screen.getByText(/attempted yes · HTTP 200 · status in_transit/)).toBeInTheDocument();
    expect(screen.getByText('https://domestic-api.navlungo.com/v2.1/post/check')).toBeInTheDocument();
    expect(screen.getByText(/body post, limit · post post_number · limit 1/)).toBeInTheDocument();
    expect(screen.getByText(/json:object · status, data/)).toBeInTheDocument();
    expect(screen.getByText('17 · In Transit')).toBeInTheDocument();
    expect(screen.getByText('SURAT-1028 · https://tracking.navlungo.example/SURAT-1028')).toBeInTheDocument();
    expect(screen.getByText('created')).toBeInTheDocument();
    expect(screen.getAllByText('Transfer Aşamasında').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Transfer merkezinde').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Carrier reported address validation issue.').length).toBeGreaterThan(0);
    expect(screen.getByText('#status-sync')).toBeInTheDocument();
    expect(screen.getByText('post.post_number')).toBeInTheDocument();
    expect(screen.getByText('post.post_number validation failed')).toBeInTheDocument();
    expect(screen.getAllByText('not_implemented').length).toBeGreaterThan(0);
  });

  it('adds successful Navlungo update events to the Order Detail timeline without leaking PII', async () => {
    setCurrentUser({
      email: 'vendor@example.com',
      name: 'Vendor User',
      role: 'vendor',
      vendorAccess: ['sporjinal'],
      vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
      canSwitchVendors: false,
      defaultVendorId: 'sporjinal',
    });
    getOrderMock.mockResolvedValueOnce({
      ...orderWithShipmentSummary,
      shipmentExecution: {
        ...orderWithShipmentSummary.shipmentExecution!,
        provider: 'navlungo',
        providerShipmentId: 'NAV-1028',
        trackingNumber: 'NAV-1028',
        shipmentStatus: 'created',
        providerResponseSummary: {
          ...orderWithShipmentSummary.shipmentExecution!.providerResponseSummary!,
          navlungoUpdateAttempted: true,
          navlungoUpdateSucceeded: true,
          navlungoUpdateHttpStatus: 200,
          navlungoUpdatedAt: '2026-05-22T10:00:00.000Z',
          navlungoUpdateProviderMessage: 'Recipient phone +90 532 123 45 67 updated',
        },
      },
    });

    renderOrderDetail();

    await screen.findByText('Shipment updated');
    const timeline = screen.getByRole('heading', { name: 'Timeline' }).closest('article');
    expect(timeline).not.toBeNull();
    expect(within(timeline as HTMLElement).getByText('Shipment updated')).toBeInTheDocument();
    expect(within(timeline as HTMLElement).getByText('Updated')).toBeInTheDocument();
    expect(within(timeline as HTMLElement).getByText('Recipient phone [redacted-phone] updated')).toBeInTheDocument();
    expect(within(timeline as HTMLElement).queryByText(/\+90 532/)).not.toBeInTheDocument();
  });

  it('adds successful Navlungo cancel events to the Order Detail timeline', async () => {
    setCurrentUser({
      email: 'vendor@example.com',
      name: 'Vendor User',
      role: 'vendor',
      vendorAccess: ['sporjinal'],
      vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
      canSwitchVendors: false,
      defaultVendorId: 'sporjinal',
    });
    getOrderMock.mockResolvedValueOnce({
      ...orderWithShipmentSummary,
      shipmentExecution: {
        ...orderWithShipmentSummary.shipmentExecution!,
        provider: 'navlungo',
        providerShipmentId: 'NAV-1028',
        trackingNumber: 'NAV-1028',
        shipmentStatus: 'cancelled',
        providerResponseSummary: {
          ...orderWithShipmentSummary.shipmentExecution!.providerResponseSummary!,
          navlungoCancelAttempted: true,
          navlungoCancelSucceeded: true,
          navlungoCancelHttpStatus: 200,
          navlungoCancelledAt: '2026-05-22T10:00:00.000Z',
          navlungoCancelProviderMessage: 'Provider shipment cancelled',
        },
      },
    });

    renderOrderDetail();

    await screen.findByText('Shipment cancelled');
    const timeline = screen.getByRole('heading', { name: 'Timeline' }).closest('article');
    expect(timeline).not.toBeNull();
    expect(within(timeline as HTMLElement).getByText('Shipment cancelled')).toBeInTheDocument();
    expect(within(timeline as HTMLElement).getByText('Cancelled')).toBeInTheDocument();
    expect(within(timeline as HTMLElement).getByText('Provider shipment cancelled')).toBeInTheDocument();
  });

  it('does not add successful Navlungo update or cancel timeline events when provider actions fail', async () => {
    setCurrentUser({
      email: 'vendor@example.com',
      name: 'Vendor User',
      role: 'vendor',
      vendorAccess: ['sporjinal'],
      vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
      canSwitchVendors: false,
      defaultVendorId: 'sporjinal',
    });
    getOrderMock.mockResolvedValueOnce({
      ...orderWithShipmentSummary,
      shipmentExecution: {
        ...orderWithShipmentSummary.shipmentExecution!,
        provider: 'navlungo',
        providerShipmentId: 'NAV-1028',
        trackingNumber: 'NAV-1028',
        shipmentStatus: 'created',
        providerResponseSummary: {
          ...orderWithShipmentSummary.shipmentExecution!.providerResponseSummary!,
          navlungoUpdateAttempted: true,
          navlungoUpdateSucceeded: false,
          navlungoUpdateHttpStatus: 422,
          navlungoCancelAttempted: true,
          navlungoCancelSucceeded: false,
          navlungoCancelHttpStatus: 422,
        },
      },
    });

    renderOrderDetail();

    await screen.findByText('Order created');
    const timeline = screen.getByRole('heading', { name: 'Timeline' }).closest('article');
    expect(timeline).not.toBeNull();
    expect(within(timeline as HTMLElement).queryByText('Shipment updated')).not.toBeInTheDocument();
    expect(within(timeline as HTMLElement).queryByText('Shipment cancelled')).not.toBeInTheDocument();
    expect(within(timeline as HTMLElement).getByText('Order created')).toBeInTheDocument();
  });

  it('shows customer fallback and hides raw provider timeline events', async () => {
    setCurrentUser({
      email: 'vendor@example.com',
      name: 'Vendor User',
      role: 'vendor',
      vendorAccess: ['sporjinal'],
      vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
      canSwitchVendors: false,
      defaultVendorId: 'sporjinal',
    });
    getOrderMock.mockResolvedValueOnce({
      ...orderWithShipmentSummary,
      customer: 'Customer unavailable',
      timeline: [
        { label: 'Carrier webhook received', at: '2026-05-15T19:40:00.000Z' },
        { label: 'Carrier webhook received', at: '2026-05-15T19:41:00.000Z' },
        { label: 'Provider status updated', at: '2026-05-15T19:42:00.000Z' },
        { label: 'SearchingDriver', at: '2026-05-15T19:43:00.000Z' },
        { label: 'reverseShipmentProcessing', at: '2026-05-15T19:44:00.000Z' },
        { label: 'Tracking pending', at: '2026-05-15T19:45:00.000Z' },
      ],
    });

    renderOrderDetail();

    expect((await screen.findAllByText('Customer unavailable')).length).toBeGreaterThan(0);
    const timeline = screen.getByRole('heading', { name: 'Timeline' }).closest('article');
    expect(timeline).not.toBeNull();
    expect(within(timeline as HTMLElement).queryByText(/webhook/i)).not.toBeInTheDocument();
    expect(within(timeline as HTMLElement).queryByText(/provider status/i)).not.toBeInTheDocument();
    expect(within(timeline as HTMLElement).queryByText(/SearchingDriver/i)).not.toBeInTheDocument();
    expect(within(timeline as HTMLElement).queryByText(/reverseShipment/i)).not.toBeInTheDocument();
    expect(within(timeline as HTMLElement).queryByText(/Tracking pending/i)).not.toBeInTheDocument();
    expect(within(timeline as HTMLElement).getByText('Order created')).toBeInTheDocument();
    expect(within(timeline as HTMLElement).getByText(/Order, shipment, return, and support activity/)).toBeInTheDocument();
  });

  it('renders stored customer names for vendor users', async () => {
    setCurrentUser({
      email: 'vendor@example.com',
      name: 'Vendor User',
      role: 'vendor',
      vendorAccess: ['sporjinal'],
      vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
      canSwitchVendors: false,
      defaultVendorId: 'sporjinal',
    });
    getOrderMock.mockResolvedValueOnce({
      ...orderWithShipmentSummary,
      customer: 'Ada Lovelace',
    });

    renderOrderDetail();

    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText('Customer')).toBeInTheDocument();
    expect(screen.queryByText('Customer hidden for vendor scope')).not.toBeInTheDocument();
  });

  it('removes dead Order Detail header actions', async () => {
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

    expect(await screen.findByRole('heading', { name: 'Order #1028' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'İNCELE' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'More order actions' })).not.toBeInTheDocument();
  });

  it('renders the dense operational foundation without exposing vendor diagnostics', async () => {
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

    expect(await screen.findByLabelText('Primary operational status')).toBeInTheDocument();
    expect(screen.getByLabelText('Operational alerts')).toBeInTheDocument();
    expect(screen.getByText('Tracking missing')).toBeInTheDocument();
    expect(screen.getByText('Awaiting shipment')).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Order detail sections' })).not.toBeInTheDocument();
    expect(screen.queryByText('Operational summary')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Context' })).not.toBeInTheDocument();
    expect(screen.queryByText(/^Context$/)).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Guided Operations/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/^Guided Operations$/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Overview' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Overview' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Shipment & delivery' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Line items/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Settlement preview' })).toBeInTheDocument();
    expect(screen.getByText('Gross order amount')).toBeInTheDocument();
    expect(screen.getByText('Estimated settlement')).toBeInTheDocument();
    expect(screen.queryByText('Estimated marketplace commission')).not.toBeInTheDocument();
    expect(screen.queryByText('Shipping cost status')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Linked records' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Vendor actions' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Timeline' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Support' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Provider response summary')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Shipping provider diagnostics')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Shipment timeline')).not.toBeInTheDocument();
    expect(screen.queryByText('Provider returned no shipment identifiers.')).not.toBeInTheDocument();
    expect(screen.queryByText('SHIPPING_EXECUTION_ENABLED')).not.toBeInTheDocument();
    expect(screen.queryByText('Endpoint:')).not.toBeInTheDocument();
    expect(screen.queryByText('Shipment recovery')).not.toBeInTheDocument();
  });

  it('keeps support directly below timeline in the right sidebar flow', async () => {
    setCurrentUser({
      email: 'vendor@example.com',
      name: 'Vendor User',
      role: 'vendor',
      vendorAccess: ['sporjinal'],
      vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
      canSwitchVendors: false,
      defaultVendorId: 'sporjinal',
    });
    getOrderMock.mockResolvedValueOnce({
      ...orderWithShipmentSummary,
      timeline: Array.from({ length: 16 }, (_, index) => ({
        label: index % 2 === 0 ? 'Order received' : 'Shipment created',
        at: `2026-05-15T12:${String(index).padStart(2, '0')}:00.000Z`,
      })),
    });

    renderOrderDetail();

    const rail = await screen.findByLabelText('Order timeline and support');
    const sidebarFlow = rail.querySelector('.order-detail-sidebar-flow');
    expect(sidebarFlow).toBeInstanceOf(HTMLElement);

    const timelineCard = within(sidebarFlow as HTMLElement).getByRole('heading', { name: 'Timeline' }).closest('article');
    const supportCard = within(sidebarFlow as HTMLElement).getByRole('heading', { name: 'Support' }).closest('article');

    expect(timelineCard).not.toBeNull();
    expect(supportCard).not.toBeNull();
    expect(timelineCard?.parentElement).toBe(sidebarFlow);
    expect(supportCard?.parentElement).toBe(sidebarFlow);
    expect(supportCard?.parentElement).not.toBe(rail);
    expect(Boolean(timelineCard!.compareDocumentPosition(supportCard!) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(Array.from(sidebarFlow!.children).map((child) => child.className)).toEqual([
      expect.stringContaining('operational-timeline-card'),
      expect.stringContaining('order-support-card'),
    ]);
    expect(Array.from(sidebarFlow!.children).some((child) => /spacer|placeholder|offset/i.test(String(child.className)))).toBe(false);
  });

  it('collapses provider-heavy admin diagnostics by default', async () => {
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
      shipmentExecution: {
        ...orderWithShipmentSummary.shipmentExecution!,
        shipmentStatus: 'searchingDriver',
        providerShipmentId: 'ke-created-1028',
        trackingNumber: 'KE-TRACK-1028',
        providerResponseSummary: {
          ...orderWithShipmentSummary.shipmentExecution!.providerResponseSummary!,
          dryRun: false,
          disabledGates: [],
          providerShipmentIdPresent: true,
          trackingNumberPresent: true,
        },
      },
    });

    renderOrderDetail();

    const providerDiagnostics = (await screen.findByLabelText('Provider response summary')) as HTMLDetailsElement;
    const shippingDiagnostics = (await screen.findByLabelText('Shipping provider diagnostics')) as HTMLDetailsElement;
    expect(providerDiagnostics.tagName).toBe('DETAILS');
    expect(providerDiagnostics.open).toBe(false);
    expect(shippingDiagnostics.tagName).toBe('DETAILS');
    expect(shippingDiagnostics.open).toBe(false);
  });

  it('lets vendors open shipment support tickets with safe operational context', async () => {
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
    getOrderMock.mockResolvedValueOnce({
      ...orderWithShipmentSummary,
      carrier: 'Sürat Kargo',
      trackingNumber: 'OTO-TRACK-1028',
      trackingUrl: 'https://tracking.tryoto.example/OTO-TRACK-1028',
      shopifyFulfillmentSync: {
        status: 'synced',
        fulfillmentOrderIdPresent: true,
        fulfillmentIdPresent: true,
        syncStatus: 'fulfilled',
        skippedReason: null,
        errorMessage: null,
        lastAttemptedAt: '2026-05-15T19:47:00.000Z',
      },
      shipmentExecution: {
        ...orderWithShipmentSummary.shipmentExecution!,
        provider: 'try_oto',
        providerCarrierName: 'Sürat Kargo',
        providerShipmentId: 'SPJ-1028',
        trackingNumber: 'OTO-TRACK-1028',
        trackingUrl: 'https://tracking.tryoto.example/OTO-TRACK-1028',
        shipmentStatus: 'delivered',
        returnShipment: {
          provider: 'try_oto',
          returnOrderId: 'SPJ-1028-R1',
          trackingNumber: 'RET-TRACK-1028',
          trackingUrl: 'https://tracking.tryoto.example/RET-TRACK-1028',
          labelUrl: null,
          barcode: 'RET-TRACK-1028',
          carrierName: 'Sürat Kargo',
          status: 'reverseReturned',
          createdAt: '2026-05-15T19:46:00.000Z',
          requestKeys: ['orderId', 'deliveryOptionId', 'items'],
          responseKeys: ['returnOrderId', 'trackingNumber'],
          trackingPresent: true,
          labelPresent: false,
          labelRetrievalConfirmed: false,
          labelRetrievalNote: null,
          finalized: true,
          labelRetrievable: false,
          providerStatusSource: 'createReturnShipment',
          diagnostics: null,
        },
      },
    });

    renderOrderDetail();

    await user.click(await screen.findByRole('button', { name: 'Contact support' }));
    await user.selectOptions(screen.getByLabelText('Category'), 'TRACKING');
    await user.type(screen.getByLabelText('Message'), 'Customer is asking for a delivery update.');
    await user.click(screen.getByRole('button', { name: 'Create ticket' }));

    await waitFor(() =>
      expect(createSupportTicketMock).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'TRACKING',
          contextType: 'shipment',
          contextId: 'shipment-kargo_entegrator-alloc-sporjinal-7621783322961',
          contextSnapshot: expect.objectContaining({
            orderNumber: '#1028',
            shipmentProvider: 'Try OTO',
            carrier: 'Sürat Kargo',
            trackingNumber: 'OTO-TRACK-1028',
            returnOrderId: 'SPJ-1028-R1',
            vendorId: 'sporjinal',
            supportCorrelationId: 'support:alloc-sporjinal-7621783322961:shipment-kargo_entegrator-alloc-sporjinal-7621783322961',
            flags: expect.objectContaining({
              trackingPresent: true,
              returnTrackingPresent: true,
              shopifyFulfillmentIdPresent: true,
            }),
          }),
        }),
      ),
    );
    expect(createSupportTicketMock.mock.calls[0][0].contextSnapshot).not.toHaveProperty('adminDiagnostics');
  });

  it('opens an existing linked support ticket instead of creating a duplicate', async () => {
    setCurrentUser({
      email: 'vendor@example.com',
      name: 'Vendor User',
      role: 'vendor',
      vendorAccess: ['sporjinal'],
      vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
      canSwitchVendors: false,
      defaultVendorId: 'sporjinal',
    });
    listVendorSupportTicketsMock.mockResolvedValueOnce([buildSupportTicket()]);
    getOrderMock.mockResolvedValueOnce(orderWithShipmentSummary);

    renderOrderDetail();

    const supportCard = await screen.findByLabelText('Shipment and return support');
    const contactSupport = await within(supportCard).findByRole('link', { name: 'Contact support' });
    expect(contactSupport).toHaveAttribute('href', '/support/ticket-shipment-1');
    expect(await within(supportCard).findByText(/already open/i)).toBeInTheDocument();
    expect(within(supportCard).queryByRole('button', { name: 'Contact support' })).not.toBeInTheDocument();
    expect(createSupportTicketMock).not.toHaveBeenCalled();
  });

  it('escalates an existing linked support ticket without creating a new one', async () => {
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
    const supportTicket = buildSupportTicket();
    listVendorSupportTicketsMock.mockResolvedValueOnce([supportTicket]);
    escalateVendorSupportTicketMock.mockResolvedValueOnce({
      ...supportTicket,
      priority: 'high',
      status: 'IN_REVIEW',
      escalatedAt: '2026-05-15T20:10:00.000Z',
    });
    getOrderMock.mockResolvedValueOnce(orderWithShipmentSummary);

    renderOrderDetail();

    await user.click(await screen.findByRole('button', { name: 'Escalate' }));

    await waitFor(() => expect(escalateVendorSupportTicketMock).toHaveBeenCalledWith('ticket-shipment-1'));
    expect(createSupportTicketMock).not.toHaveBeenCalled();
  });

  it('disables escalation before a support ticket exists and hides unsupported internal notes for vendors', async () => {
    setCurrentUser({
      email: 'vendor@example.com',
      name: 'Vendor User',
      role: 'vendor',
      vendorAccess: ['sporjinal'],
      vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
      canSwitchVendors: false,
      defaultVendorId: 'sporjinal',
    });
    getOrderMock.mockResolvedValueOnce(orderWithShipmentSummary);

    renderOrderDetail();

    const supportCard = await screen.findByLabelText('Shipment and return support');
    expect(within(supportCard).getByRole('button', { name: 'Escalate' })).toBeDisabled();
    expect(within(supportCard).getByText(/Create a support ticket before escalating/i)).toBeInTheDocument();
    expect(within(supportCard).queryByRole('button', { name: 'Internal note' })).not.toBeInTheDocument();
  });

  it('deduplicates duplicate-looking linked support ticket rows', async () => {
    setCurrentUser({
      email: 'vendor@example.com',
      name: 'Vendor User',
      role: 'vendor',
      vendorAccess: ['sporjinal'],
      vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
      canSwitchVendors: false,
      defaultVendorId: 'sporjinal',
    });
    listVendorSupportTicketsMock.mockResolvedValueOnce([
      buildSupportTicket({ id: 'ticket-shipment-1' }),
      buildSupportTicket({ id: 'ticket-shipment-duplicate', createdAt: '2026-05-15T20:01:00.000Z' }),
    ]);
    getOrderMock.mockResolvedValueOnce(orderWithShipmentSummary);

    renderOrderDetail();

    const ticketSummary = await screen.findByLabelText('Support ticket summary');
    expect(ticketSummary).toHaveTextContent('Tickets · 1');
    expect(within(ticketSummary).getAllByText('Help with order #1028')).toHaveLength(1);
    expect(within(ticketSummary).getByText('Normal priority')).toBeInTheDocument();
    expect(within(ticketSummary).getByText(/Updated May 15, 2026/)).toBeInTheDocument();
  });

  it('groups support activity in order linked records while preserving support history access', async () => {
    setCurrentUser({
      email: 'vendor@example.com',
      name: 'Vendor User',
      role: 'vendor',
      vendorAccess: ['sporjinal'],
      vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
      canSwitchVendors: false,
      defaultVendorId: 'sporjinal',
    });
    listVendorSupportTicketsMock.mockResolvedValueOnce([
      buildSupportTicket({ id: 'ticket-shipment-1', status: 'OPEN', updatedAt: '2026-05-15T20:05:00.000Z' }),
      buildSupportTicket({
        id: 'ticket-finance-review',
        subject: 'Settlement review question for #1028',
        status: 'IN_REVIEW',
        priority: 'high',
        updatedAt: '2026-05-16T09:15:00.000Z',
      }),
    ]);
    getOrderMock.mockResolvedValueOnce(orderWithShipmentSummary);

    renderOrderDetail();

    const linkedRecords = (await screen.findByRole('heading', { name: 'Linked records' })).closest('.order-linked-records-panel');
    expect(linkedRecords).toBeTruthy();
    expect(await within(linkedRecords as HTMLElement).findByText('Support activity')).toBeInTheDocument();
    expect(within(linkedRecords as HTMLElement).getAllByText(/2 linked tickets/i).length).toBeGreaterThan(0);
    expect(within(linkedRecords as HTMLElement).getByText('Latest status: In Review')).toBeInTheDocument();
    expect(within(linkedRecords as HTMLElement).getByText('Settlement review question for #1028')).toBeInTheDocument();
  });

  it('shows finance ledger preview to admins and hides it from vendors', async () => {
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
      financeLedgerPreview: {
        status: 'partial',
        currency: 'TRY',
        entries: [
          {
            id: 'preview-entry-1',
            eventType: 'ORDER_CREATED',
            sourceType: 'shopify_order',
            lineItemId: 'line-1028',
            returnId: null,
            refundId: null,
            amount: '4999.00',
            currency: 'TRY',
            occurredAt: '2026-05-15T12:08:00.000Z',
            impact: {
              grossSales: '4999.00',
              marketplaceCommission: null,
              vendorPayable: null,
              shippingCostReserved: null,
              vendorDebt: null,
            },
          },
          {
            id: 'preview-entry-2',
            eventType: 'MARKETPLACE_COMMISSION_RESERVED',
            sourceType: 'shopify_order',
            lineItemId: 'line-1028',
            returnId: null,
            refundId: null,
            amount: '499.90',
            currency: 'TRY',
            occurredAt: '2026-05-15T12:08:00.000Z',
            impact: {
              grossSales: null,
              marketplaceCommission: '499.90',
              vendorPayable: null,
              shippingCostReserved: null,
              vendorDebt: null,
            },
          },
        ],
        balance: {
          grossSales: '4999.00',
          marketplaceCommission: '499.90',
          vendorPayable: '4499.10',
          shippingCostReserved: '0.00',
          vendorDebt: '0.00',
          netVendorPosition: '4499.10',
        },
        unknowns: ['shipping_cost'],
        assumptions: ['Preview is read-only and does not mutate payouts, refunds, Shopify, invoices, or balances.'],
        sourceFields: {
          orderId: '7616544244049',
          orderNumber: '#1028',
          allocationId: 'alloc-sporjinal-7621783322961',
          vendorId: 'sporjinal',
          lineItemCount: 1,
          returnCount: 0,
          refundCount: 0,
          commissionProfile: 'configured',
          shippingCost: 'unknown',
          payoutAlreadyPaid: false,
        },
      },
    });

    renderOrderDetail();

    const settlementPreview = await screen.findByLabelText('Order finance preview');
    expect(settlementPreview).toHaveAttribute('id', 'settlement-preview');
    expect(within(settlementPreview).getByRole('heading', { name: 'Settlement preview' })).toBeInTheDocument();
    expect(settlementPreview).toHaveTextContent(
      'Values may change after refunds, shipping reconciliation, manual review, or settlement adjustments.',
    );
    expect(within(settlementPreview).getByText('Gross order amount')).toBeInTheDocument();
    expect(within(settlementPreview).getByText('Commission estimate')).toBeInTheDocument();
    expect(within(settlementPreview).getByText('Shipping deduction')).toBeInTheDocument();
    expect(within(settlementPreview).getByText('Refund impact')).toBeInTheDocument();
    expect(within(settlementPreview).getByText('Estimated settlement')).toBeInTheDocument();
    expect(settlementPreview).toHaveTextContent(/TRY\s*4,999\.00/);
    expect(settlementPreview).toHaveTextContent(/TRY\s*499\.90/);
    expect(settlementPreview).toHaveTextContent(/TRY\s*4,499\.10/);
    expect(within(settlementPreview).getAllByText('Unknown').length).toBeGreaterThan(0);
    expect(within(settlementPreview).getAllByText('Estimated').length).toBeGreaterThan(0);
    expect(settlementPreview).not.toHaveTextContent(/Payable|Balance|Confirmed/i);

    const financeTimeline = screen.getByLabelText('Finance timeline');
    expect(within(financeTimeline).getByRole('heading', { name: 'Finance timeline' })).toBeInTheDocument();
    expect(financeTimeline).toHaveTextContent('Finance events are previews until settlement review is completed.');
    expect(within(financeTimeline).getByText('Settlement preview generated')).toBeInTheDocument();
    expect(within(financeTimeline).getByText('Commission estimated')).toBeInTheDocument();
    expect(within(financeTimeline).getByText('Shipping deduction unknown')).toBeInTheDocument();
    expect(within(financeTimeline).getByText('Settlement awaiting review')).toBeInTheDocument();
    expect(within(financeTimeline).getAllByText('Estimated').length).toBeGreaterThan(0);
    expect(financeTimeline).not.toHaveTextContent(/Payout scheduled|Payout paid|Confirmed settlement/i);

    expect(await screen.findByLabelText('Finance ledger preview')).toBeInTheDocument();
    expect(screen.getByText('Admin-only calculation trace for reconciliation. Not settlement, invoice, tax, or payout truth.')).toBeInTheDocument();
    expect(screen.getAllByText('shipping_cost').length).toBeGreaterThan(0);
    expect(screen.getByText(/Marketplace commission reserved/i)).toBeInTheDocument();

    cleanup();
    window.localStorage.clear();
    setToken('test-token');
    setCurrentUser({
      email: 'vendor@example.com',
      name: 'Vendor User',
      role: 'vendor',
      vendorAccess: ['sporjinal'],
      vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
      canSwitchVendors: false,
      defaultVendorId: 'sporjinal',
    });
    getOrderMock.mockResolvedValueOnce({
      ...orderWithShipmentSummary,
      financeLedgerPreview: {
        status: 'ready',
        currency: 'TRY',
        entries: [],
        balance: {
          grossSales: '0.00',
          marketplaceCommission: '0.00',
          vendorPayable: '0.00',
          shippingCostReserved: '0.00',
          vendorDebt: '0.00',
          netVendorPosition: '0.00',
        },
        unknowns: [],
        assumptions: [],
        sourceFields: {
          orderId: '7616544244049',
          orderNumber: '#1028',
          allocationId: 'alloc-sporjinal-7621783322961',
          vendorId: 'sporjinal',
          lineItemCount: 1,
          returnCount: 0,
          refundCount: 0,
          commissionProfile: 'configured',
          shippingCost: 'confirmed',
          payoutAlreadyPaid: false,
        },
      },
    });

    renderOrderDetail();

    await screen.findByText('Contact support');
    const vendorSettlementPreview = screen.getByLabelText('Order finance preview');
    expect(vendorSettlementPreview).toHaveTextContent('Settlement preview');
    expect(vendorSettlementPreview).toHaveTextContent('Gross order amount');
    expect(vendorSettlementPreview).toHaveTextContent('Unknown');
    expect(vendorSettlementPreview).not.toHaveTextContent(/Payable|Balance|Confirmed/i);
    const vendorFinanceTimeline = screen.getByLabelText('Finance timeline');
    expect(vendorFinanceTimeline).toHaveTextContent('No finance events available yet.');
    expect(vendorFinanceTimeline).not.toHaveTextContent(/Admin diagnostics|shipping_cost|commission_rate/i);
    expect(screen.queryByLabelText('Finance ledger preview')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Finance unknown indicators')).not.toBeInTheDocument();
  });

  it('shows admin support diagnostics copy tooling without exposing it to vendors', async () => {
    const writeText = vi.fn();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const supportTicket = {
      id: 'ticket-shipment-1',
      createdAt: '2026-05-15T20:00:00.000Z',
      updatedAt: '2026-05-15T20:05:00.000Z',
      createdByUserId: 'vendor-user',
      createdByRole: 'VENDOR',
      vendorId: 'sporjinal',
      vendorName: 'Sporjinal',
      subject: 'Tracking help',
      message: 'Tracking has not updated.',
      priority: 'normal',
      status: 'OPEN',
      category: 'TRACKING',
      assigneeUserId: null,
      assigneeName: null,
      vendorUnreadCount: 0,
      adminUnreadCount: 1,
      lastReplyAt: null,
      lastReplyByRole: null,
      firstResponseDueAt: null,
      nextResponseDueAt: null,
      escalatedAt: null,
      escalationReason: null,
      sla: null,
      contextType: 'shipment',
      contextId: orderWithShipmentSummary.shipmentExecution!.id,
      contextSummary: { orderNumber: '#1028' },
      resolvedAt: null,
      closedAt: null,
    };

    setCurrentUser({
      email: 'admin@demo.com',
      name: 'Demo Admin',
      role: 'admin',
      vendorAccess: ['sporjinal'],
      vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
      canSwitchVendors: true,
      defaultVendorId: 'sporjinal',
    });
    listAdminSupportTicketsMock.mockResolvedValueOnce([supportTicket]);

    renderOrderDetail();

    const supportDiagnostics = (await screen.findByLabelText('Admin support diagnostics')) as HTMLDetailsElement;
    expect(await screen.findByLabelText('Support ticket summary')).toHaveTextContent('Tickets · 1');
    expect(supportDiagnostics).toBeInTheDocument();
    expect(supportDiagnostics.tagName).toBe('DETAILS');
    expect(supportDiagnostics.open).toBe(false);
    expect(screen.getByText('Tracking has not updated.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Copy diagnostics' }));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Shipment diagnostics'));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Return diagnostics'));
    await userEvent.click(screen.getByRole('button', { name: 'Copy shipment summary' }));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Shipment summary'));
    await userEvent.click(screen.getByRole('button', { name: 'Copy return summary' }));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Return summary'));
    expect(writeText).toHaveBeenCalledWith(expect.not.stringMatching(/token|secret|authorization|payload/i));
    expect(await screen.findByText('Copied return summary.')).toBeInTheDocument();

    cleanup();
    window.localStorage.clear();
    setToken('test-token');
    setCurrentUser({
      email: 'vendor@example.com',
      name: 'Vendor User',
      role: 'vendor',
      vendorAccess: ['sporjinal'],
      vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
      canSwitchVendors: false,
      defaultVendorId: 'sporjinal',
    });
    getOrderMock.mockResolvedValueOnce(orderWithShipmentSummary);
    listVendorSupportTicketsMock.mockResolvedValueOnce([supportTicket]);

    renderOrderDetail();

    expect(await screen.findByLabelText('Support ticket summary')).toBeInTheDocument();
    expect(screen.queryByLabelText('Admin support diagnostics')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copy diagnostics' })).not.toBeInTheDocument();
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
            kargonomiBuyerStateId: '34',
            kargonomiBuyerCityId: '828',
          }),
        }),
      ),
    );
    expect(await screen.findByText('Shipping provider configuration saved.')).toBeInTheDocument();
    await waitFor(() => expect(getShippingProviderDiagnosticsMock).toHaveBeenCalledTimes(5));
    expect(getVendorShippingConfigMock).toHaveBeenCalledWith(expect.objectContaining({ vendorId: 'sporjinal' }));
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
    getShippingProviderDiagnosticsMock.mockImplementation((options?: { provider?: string | null }) =>
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
    getShippingProviderDiagnosticsMock.mockImplementation((options?: { provider?: string | null }) =>
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

  it('shows Kargonomi provider option and warehouse config when backend diagnostics expose it as supported', async () => {
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
    getShippingProviderDiagnosticsMock.mockImplementation((options?: { provider?: string | null }) =>
      Promise.resolve({
        provider: options?.provider === 'kargonomi' ? 'kargonomi' : options?.provider === 'try_oto' ? 'try_oto' : 'kargo_entegrator',
        supportedProviders: ['kargo_entegrator', 'hepsijet', 'kargonomi'],
        executionReady: options?.provider === 'kargonomi',
        sandboxModeEnabled: false,
        shippingExecutionEnabled: true,
        providerSelected: options?.provider === 'kargonomi',
        providerEnabled: true,
        webhookIngestEnabled: false,
        baseUrlConfigured: true,
        apiKeyConfigured: true,
        cargoIntegrationIdConfigured: options?.provider === 'kargo_entegrator',
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
        warnings: [],
      }),
    );
    const savedKargonomiConfig = {
      vendorId: 'sporjinal',
      preferredProvider: 'kargonomi' as const,
      shippingEnabled: true,
      defaultDesi: '3.00',
      cargoIntegrationId: null,
      defaultWarehouseId: '112668',
      shippingVatPercent: '18.00',
      warehouses: [
        {
          id: 'warehouse-sporjinal-112668',
          vendorId: 'sporjinal',
          provider: 'kargonomi',
          warehouseId: '112668',
          name: 'Sporjinal warehouse',
          address: null,
          isDefault: true,
        },
      ],
      providerMetadata: {
        packageType: 'box',
        kargonomiBuyerStateId: '34',
        kargonomiBuyerCityId: '828',
      },
      source: 'configured' as const,
      updatedAt: '2026-05-15T19:45:00.000Z',
    };
    updateVendorShippingConfigMock.mockResolvedValueOnce(savedKargonomiConfig);

    renderOrderDetail();

    const providerSelect = await screen.findByLabelText('Provider');
    expect(screen.getByRole('option', { name: 'Kargonomi' })).toBeInTheDocument();
    await user.selectOptions(providerSelect, 'kargonomi');
    const warehouseInput = await screen.findByLabelText('Kargonomi warehouse ID');
    const buyerStateInput = await screen.findByLabelText('Fallback Kargonomi buyer state ID (PoC override)');
    const buyerCityInput = await screen.findByLabelText('Fallback Kargonomi buyer city ID (PoC override)');
    expect(screen.getByRole('button', { name: 'Run Kargonomi lookup diagnostic' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Run Navlungo auth diagnostic' })).not.toBeInTheDocument();
    await user.clear(warehouseInput);
    await user.type(warehouseInput, '112668');
    await user.clear(buyerStateInput);
    await user.type(buyerStateInput, '34');
    await user.clear(buyerCityInput);
    await user.type(buyerCityInput, '828');
    await user.click(screen.getByRole('button', { name: 'Save shipping config' }));

    await waitFor(() =>
      expect(updateVendorShippingConfigMock).toHaveBeenCalledWith(
        'sporjinal',
        expect.objectContaining({
          preferredProvider: 'kargonomi',
          cargoIntegrationId: null,
          defaultWarehouseId: '112668',
          defaultDesi: 3,
          providerMetadata: expect.objectContaining({
            kargonomiBuyerStateId: '34',
            kargonomiBuyerCityId: '828',
          }),
          warehouses: [
            expect.objectContaining({
              provider: 'kargonomi',
              warehouseId: '112668',
              isDefault: true,
            }),
          ],
        }),
      ),
    );
    expect(screen.queryByLabelText('Cargo integration ID')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Try OTO pickup location code')).not.toBeInTheDocument();
  });

  it('shows Navlungo diagnostics config and allows live provider save', async () => {
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

    const providerSelect = await screen.findByLabelText('Provider');
    expect(screen.getByRole('option', { name: 'Navlungo' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Run Navlungo auth diagnostic' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Run Kargonomi lookup diagnostic' })).not.toBeInTheDocument();
    await user.selectOptions(providerSelect, 'navlungo');

    expect(await screen.findByLabelText('Navlungo sender address ID')).toHaveValue('55574');
    expect(screen.getByLabelText('Navlungo return recipient address ID')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Run Navlungo auth diagnostic' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run Navlungo carrier diagnostic' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Run Kargonomi lookup diagnostic' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Navlungo Create Post probe controls')).toBeInTheDocument();
    expect(screen.getByText('Creates one Navlungo test post. Does not sync Shopify or create a local shipment execution.')).toBeInTheDocument();
    expect(screen.getByLabelText('I understand this creates one Navlungo test post')).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Run Navlungo Create Post probe' })).toBeDisabled();
    expect(screen.getByLabelText('Default barcode format')).toHaveValue('pdf-A6');
    expect(screen.getByText('Username configured').closest('.shipping-config-readonly')).toHaveTextContent('yes');
    expect(screen.getByText('Password configured').closest('.shipping-config-readonly')).toHaveTextContent('yes');
    expect(screen.getByText('Runtime shipment execution enabled').closest('.shipping-config-readonly')).toHaveTextContent('yes');
    expect(screen.getByText('Return/reverse implementation').closest('.shipping-config-readonly')).toHaveTextContent('NOT IMPLEMENTED');
    expect(screen.getByRole('button', { name: 'Save shipping config' })).toBeEnabled();
    expect(updateVendorShippingConfigMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Run Navlungo auth diagnostic' }));

    expect(await screen.findByLabelText('Navlungo auth diagnostic result')).toBeInTheDocument();
    expect(screen.getByText('domestic-api.navlungo.com/v2')).toBeInTheDocument();
    expect(screen.getByText('Auth result').closest('.summary-row')).toHaveTextContent('200');
    expect(screen.getByText('Response shape').closest('.summary-row')).toHaveTextContent('status, message, data');
    expect(screen.getByText('Data shape').closest('.summary-row')).toHaveTextContent('access_token');
    expect(screen.getByText('Access token field').closest('.summary-row')).toHaveTextContent('data.access_token');
    expect(screen.getByText('Refresh token field').closest('.summary-row')).toHaveTextContent('data.refresh_token');
    expect(screen.getByText('token_type present').closest('.summary-row')).toHaveTextContent('yes');
    expect(screen.getByText('expires_in present').closest('.summary-row')).toHaveTextContent('yes');
    expect(screen.getByText('Token received').closest('.summary-row')).toHaveTextContent('yes');
    expect(screen.getByText('Expires in').closest('.summary-row')).toHaveTextContent('86400');
    expect(screen.queryByText('secret-password')).not.toBeInTheDocument();
    expect(screen.queryByText('secret-access-token')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Run Navlungo carrier diagnostic' }));

    expect(runtimeDiagnosticsMocks.navlungoCarriers).toHaveBeenCalled();
    expect(await screen.findByLabelText('Navlungo carrier diagnostic result')).toBeInTheDocument();
    expect(screen.getByText('Carrier endpoint paths known').closest('.summary-row')).toHaveTextContent('no');
    expect(screen.getByText('Skipped reason').closest('.summary-row')).toHaveTextContent('carrier_endpoint_paths_unknown');
    expect(screen.getByText('My Carriers HTTP').closest('.summary-row')).toHaveTextContent('—');
    expect(screen.getByText('Configured carriers').closest('.summary-row')).toHaveTextContent('—');
    expect(screen.getByText('List Carriers HTTP').closest('.summary-row')).toHaveTextContent('—');
    expect(screen.getByText('Listed carriers').closest('.summary-row')).toHaveTextContent('—');
    expect(screen.getByText('Configured carrier available').closest('.summary-row')).toHaveTextContent('no');
    expect(screen.queryByText('secret-password')).not.toBeInTheDocument();
    expect(screen.queryByText('secret-access-token')).not.toBeInTheDocument();

    const createPostProbeButton = screen.getByRole('button', { name: 'Run Navlungo Create Post probe' });
    expect(createPostProbeButton).toBeDisabled();
    await user.click(screen.getByLabelText('I understand this creates one Navlungo test post'));
    expect(createPostProbeButton).toBeEnabled();
    await user.click(createPostProbeButton);

    expect(runtimeDiagnosticsMocks.navlungoCreatePostProbe).toHaveBeenCalledWith({ confirm: 'YES' });
    expect(await screen.findByLabelText('Navlungo Create Post probe result')).toBeInTheDocument();
    expect(screen.getByText('Create Post HTTP').closest('.summary-row')).toHaveTextContent('201');
    expect(screen.getByText('Requested carrier id').closest('.summary-row')).toHaveTextContent('9');
    expect(screen.getByText('Requested post type').closest('.summary-row')).toHaveTextContent('2');
    expect(screen.getByText('Requested barcode format').closest('.summary-row')).toHaveTextContent('pdf-A6');
    expect(screen.getByText('COD payment included').closest('.summary-row')).toHaveTextContent('no');
    expect(screen.getByText('Price included').closest('.summary-row')).toHaveTextContent('no');
    expect(screen.getByText('Post number').closest('.summary-row')).toHaveTextContent('NP12345');
    expect(screen.getByText('Tracking URL').closest('.summary-row')).toHaveTextContent('present');
    expect(screen.getByText('Barcode URL').closest('.summary-row')).toHaveTextContent('present');
    expect(screen.getByText('Barcode field').closest('.summary-row')).toHaveTextContent('present');
    expect(screen.getByText('Carrier fields').closest('.summary-row')).toHaveTextContent('carrier_id, carrier_name');
    expect(screen.getByText('Last probe post_number: NP12345')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run Navlungo Check Post probe' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run Navlungo Barcode probe' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Run Navlungo Check Post probe' }));
    expect(runtimeDiagnosticsMocks.navlungoCheckPostProbe).toHaveBeenCalledWith({ postNumber: 'NP12345' });
    expect(await screen.findByLabelText('Navlungo Check Post probe result')).toBeInTheDocument();
    expect(screen.getByText('Check Post HTTP').closest('.summary-row')).toHaveTextContent('200');
    expect(screen.getByText('Status').closest('.summary-row')).toHaveTextContent('To be Picked Up');

    await user.click(screen.getByRole('button', { name: 'Run Navlungo Barcode probe' }));
    expect(runtimeDiagnosticsMocks.navlungoBarcodeProbe).toHaveBeenCalledWith({ postNumber: 'NP12345' });
    const barcodeProbeResult = await screen.findByLabelText('Navlungo Barcode probe result');
    expect(within(barcodeProbeResult).getByText('Barcode endpoint path known').closest('.summary-row')).toHaveTextContent('no');
    expect(within(barcodeProbeResult).getByText('Skipped reason').closest('.summary-row')).toHaveTextContent('barcode_endpoint_path_unknown');
    expect(createShipmentExecutionMock).not.toHaveBeenCalled();
    expect(submitFulfillmentTrackingMock).not.toHaveBeenCalled();
    expect(screen.queryByText('secret-password')).not.toBeInTheDocument();
    expect(screen.queryByText('secret-access-token')).not.toBeInTheDocument();

    await user.selectOptions(providerSelect, 'kargonomi');

    await waitFor(() => {
      expect(screen.queryByLabelText('Navlungo auth diagnostic result')).not.toBeInTheDocument();
    });
    expect(screen.queryByLabelText('Navlungo carrier diagnostic result')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Navlungo Create Post probe result')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run Kargonomi lookup diagnostic' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Run Navlungo auth diagnostic' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Run Navlungo carrier diagnostic' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Run Navlungo Create Post probe' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Navlungo Create Post probe controls')).not.toBeInTheDocument();
  });

  it('persists and restores Navlungo sender and return recipient config fields after save', async () => {
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
      preferredProvider: 'navlungo',
      shippingEnabled: true,
      defaultDesi: '3.00',
      cargoIntegrationId: null,
      defaultWarehouseId: '55574',
      shippingVatPercent: '18.00',
      warehouses: [],
      providerMetadata: {
        navlungoSenderAddressId: '55574',
        navlungoSenderName: 'Old Sender',
        navlungoSenderCountry: 'tr',
        navlungoReturnRecipientAddressId: '77701',
        navlungoReturnRecipientName: 'Old Return Warehouse',
        navlungoReturnRecipientCountry: 'tr',
        navlungoBarcodeFormat: 'pdf-A6',
        navlungoCarrierId: '9',
      },
      source: 'configured',
      updatedAt: '2026-05-15T19:28:50.786Z',
    });
    const savedConfig = {
      vendorId: 'sporjinal',
      preferredProvider: 'navlungo' as const,
      shippingEnabled: true,
      defaultDesi: '4.00',
      cargoIntegrationId: null,
      defaultWarehouseId: '55580',
      shippingVatPercent: '18.00',
      warehouses: [],
      providerMetadata: {
        navlungoSenderAddressId: '55580',
        navlungoSenderName: 'Sporjinal Sender',
        navlungoSenderPhone: '+90 532 123 45 67',
        navlungoSenderEmail: 'sender@example.test',
        navlungoSenderAddress: 'Sender Street 1',
        navlungoSenderCountry: 'tr',
        navlungoSenderCity: 'Istanbul',
        navlungoSenderDistrict: 'Kadikoy',
        navlungoSenderPostCode: '34710',
        navlungoReturnRecipientAddressId: '77702',
        navlungoReturnRecipientName: 'Return Warehouse',
        navlungoReturnRecipientPhone: '+90 532 765 43 21',
        navlungoReturnRecipientEmail: 'returns@example.test',
        navlungoReturnRecipientAddress: 'Return Street 2',
        navlungoReturnRecipientCountry: 'tr',
        navlungoReturnRecipientCity: 'Istanbul',
        navlungoReturnRecipientDistrict: 'Ataşehir',
        navlungoReturnRecipientPostCode: '34750',
        navlungoBarcodeFormat: 'pdf-A5',
        navlungoCarrierId: '9',
      },
      source: 'configured' as const,
      updatedAt: '2026-05-15T19:45:00.000Z',
    };
    updateVendorShippingConfigMock.mockResolvedValueOnce(savedConfig);
    getVendorShippingConfigMock.mockResolvedValueOnce(savedConfig);

    renderOrderDetail();

    expect(await screen.findByLabelText('Navlungo sender address ID')).toHaveValue('55574');
    fireEvent.change(screen.getByLabelText('Navlungo sender address ID'), { target: { value: '55580' } });
    fireEvent.change(screen.getByLabelText('Default desi'), { target: { value: '4' } });
    fireEvent.change(screen.getByLabelText('Navlungo return recipient address ID'), { target: { value: '77702' } });
    await user.click(screen.getByText('Full sender details for diagnostics'));
    fireEvent.change(screen.getByLabelText('Sender name'), { target: { value: 'Sporjinal Sender' } });
    fireEvent.change(screen.getByLabelText('Sender phone'), { target: { value: '+90 532 123 45 67' } });
    fireEvent.change(screen.getByLabelText('Sender email'), { target: { value: 'sender@example.test' } });
    fireEvent.change(screen.getByLabelText('Sender address'), { target: { value: 'Sender Street 1' } });
    fireEvent.change(screen.getByLabelText('Sender city'), { target: { value: 'Istanbul' } });
    fireEvent.change(screen.getByLabelText('Sender district'), { target: { value: 'Kadikoy' } });
    fireEvent.change(screen.getByLabelText('Sender post code'), { target: { value: '34710' } });
    await user.click(screen.getByText('Return recipient address book details'));
    fireEvent.change(screen.getByLabelText('Return recipient name'), { target: { value: 'Return Warehouse' } });
    fireEvent.change(screen.getByLabelText('Return recipient phone'), { target: { value: '+90 532 765 43 21' } });
    fireEvent.change(screen.getByLabelText('Return recipient email'), { target: { value: 'returns@example.test' } });
    fireEvent.change(screen.getByLabelText('Return recipient address'), { target: { value: 'Return Street 2' } });
    fireEvent.change(screen.getByLabelText('Return recipient city'), { target: { value: 'Istanbul' } });
    fireEvent.change(screen.getByLabelText('Return recipient district'), { target: { value: 'Ataşehir' } });
    fireEvent.change(screen.getByLabelText('Return recipient post code'), { target: { value: '34750' } });
    fireEvent.change(screen.getByLabelText('Default barcode format'), { target: { value: 'pdf-A5' } });
    await user.click(screen.getByRole('button', { name: 'Save shipping config' }));

    await waitFor(() =>
      expect(updateVendorShippingConfigMock).toHaveBeenCalledWith(
        'sporjinal',
        expect.objectContaining({
          preferredProvider: 'navlungo',
          defaultWarehouseId: '55580',
          defaultDesi: 4,
          providerMetadata: expect.objectContaining({
            navlungoSenderAddressId: '55580',
            navlungoSenderName: 'Sporjinal Sender',
            navlungoSenderPhone: '+90 532 123 45 67',
            navlungoSenderEmail: 'sender@example.test',
            navlungoSenderAddress: 'Sender Street 1',
            navlungoSenderCountry: 'tr',
            navlungoSenderCity: 'Istanbul',
            navlungoSenderDistrict: 'Kadikoy',
            navlungoSenderPostCode: '34710',
            navlungoReturnRecipientAddressId: '77702',
            navlungoReturnRecipientName: 'Return Warehouse',
            navlungoReturnRecipientPhone: '+90 532 765 43 21',
            navlungoReturnRecipientEmail: 'returns@example.test',
            navlungoReturnRecipientAddress: 'Return Street 2',
            navlungoReturnRecipientCountry: 'tr',
            navlungoReturnRecipientCity: 'Istanbul',
            navlungoReturnRecipientDistrict: 'Ataşehir',
            navlungoReturnRecipientPostCode: '34750',
            navlungoBarcodeFormat: 'pdf-A5',
            navlungoCarrierId: '9',
          }),
        }),
      ),
    );
    expect(await screen.findByText('Shipping provider configuration saved.')).toBeInTheDocument();
    expect(screen.getByLabelText('Navlungo sender address ID')).toHaveValue('55580');
    expect(screen.getByLabelText('Navlungo return recipient address ID')).toHaveValue('77702');
    expect(screen.getByLabelText('Sender name')).toHaveValue('Sporjinal Sender');
    expect(screen.getByLabelText('Return recipient city')).toHaveValue('Istanbul');
    expect(screen.getByLabelText('Return recipient district')).toHaveValue('Ataşehir');
  });

  it('renders Navlungo auth validation fields and messages safely', async () => {
    const user = userEvent.setup();
    runtimeDiagnosticsMocks.navlungoAuth.mockResolvedValueOnce({
      provider: 'navlungo',
      displayName: 'Navlungo',
      dormant: true,
      baseUrlHost: 'domestic-api.navlungo.com',
      baseUrlPath: '/v2.1',
      baseUrlParseError: null,
      usernamePresent: true,
      passwordPresent: true,
      authRequestUrl: '/v2.1/auth/api',
      authHttpStatus: 422,
      authContentType: 'application/json',
      responseShapeSummary: {
        kind: 'json:object',
        topLevelKeys: ['message', 'status', 'error'],
      },
      responseDataShapeSummary: null,
      tokenKeyPresence: {
        rootAccessToken: false,
        dataAccessToken: false,
        dataToken: false,
        anyTokenLikeKey: false,
      },
      refreshTokenKeyPresence: {
        rootRefreshToken: false,
        dataRefreshToken: false,
      },
      expiresInPresent: false,
      tokenTypePresent: false,
      tokenReceived: false,
      refreshTokenReceived: false,
      expiresIn: null,
      authValidationErrorKeys: ['username', 'password', 'another_field'],
      authFailedFieldNames: ['username', 'password', 'another_field'],
      authValidationErrorMessages: [
        'username validation failed',
        'password validation failed',
        'Another field is invalid',
      ],
      fetchError: null,
    });
    setCurrentUser({
      email: 'admin@example.com',
      name: 'Admin',
      role: 'admin',
      vendorAccess: ['sporjinal'],
      vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
      canSwitchVendors: true,
      defaultVendorId: 'sporjinal',
    });

    renderOrderDetail();

    await user.selectOptions(await screen.findByLabelText('Provider'), 'navlungo');
    await user.click(screen.getByRole('button', { name: 'Run Navlungo auth diagnostic' }));

    expect(await screen.findByLabelText('Navlungo auth diagnostic result')).toBeInTheDocument();
    expect(screen.getByText('Auth result').closest('.summary-row')).toHaveTextContent('422');
    expect(screen.getByText('Auth validation fields').closest('.summary-row')).toHaveTextContent('username, password, another_field');
    expect(screen.getByText('Auth validation messages').closest('.summary-row')).toHaveTextContent(
      'username validation failed · password validation failed · Another field is invalid',
    );
    expect(screen.queryByText('secret-password')).not.toBeInTheDocument();
  });

  it('renders Kargonomi label and hides Try OTO-only return/status controls for Kargonomi shipments', async () => {
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
      carrier: 'kargonomi',
      shipmentExecution: {
        ...orderWithShipmentSummary.shipmentExecution!,
        id: 'shipment-kargonomi-alloc-sporjinal-7621783322961',
        provider: 'kargonomi',
        providerCarrierName: 'Kargonomi',
        warehouseId: '112668',
        providerShipmentId: 'kg-1048',
        trackingNumber: null,
        trackingUrl: null,
        labelUrl: null,
        shipmentStatus: 'created',
        providerResponseSummary: {
          ...orderWithShipmentSummary.shipmentExecution!.providerResponseSummary!,
          providerApiCallAttempted: true,
          lastProviderStage: 'create_shipment',
          providerError: 'Kargonomi shipment draft creation failed before provider response: fetch failed.',
        },
        returnShipment: {
          provider: 'try_oto',
          returnOrderId: 'should-not-render',
          trackingNumber: 'RET-TRACK',
          trackingUrl: null,
          labelUrl: null,
          barcode: 'RET-TRACK',
          carrierName: 'Sürat Kargo',
          status: 'newReturn',
          createdAt: '2026-05-15T19:46:00.000Z',
          requestKeys: [],
          responseKeys: [],
          trackingPresent: true,
          labelPresent: false,
          labelRetrievalConfirmed: false,
          labelRetrievalNote: null,
          finalized: true,
          labelRetrievable: false,
          providerStatusSource: 'createReturnShipment',
          diagnostics: null,
        },
      },
    });

    renderOrderDetail();

    expect((await screen.findAllByText('Kargonomi')).length).toBeGreaterThan(0);
    expect(screen.queryByLabelText('Try OTO return shipment')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Try OTO shipment status refresh')).not.toBeInTheDocument();
    expect(screen.queryByText('Try OTO status refresh')).not.toBeInTheDocument();
    expect(screen.queryByText('should-not-render')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add tracking information' })).not.toBeInTheDocument();
    expect(screen.getByText('Provider API call attempted')).toBeInTheDocument();
    expect(screen.getAllByText('Create shipment').length).toBeGreaterThan(0);
    expect(screen.getByText('Kargonomi shipment draft creation failed before provider response: fetch failed.')).toBeInTheDocument();
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
        shipmentStatus: 'pending',
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

  it('renders returned Navlungo retry shipment evidence without waiting for order refetch', async () => {
    const user = userEvent.setup();
    getOrderMock.mockResolvedValue({
      ...orderWithShipmentSummary,
      shipmentExecution: {
        ...orderWithShipmentSummary.shipmentExecution!,
        id: 'shipment-navlungo-alloc-sporjinal-7621783322961',
        provider: 'navlungo',
        providerShipmentId: null,
        trackingNumber: null,
        trackingUrl: null,
        labelUrl: null,
        barcode: null,
        shipmentStatus: 'pending',
        providerResponseSummary: {
          ...orderWithShipmentSummary.shipmentExecution!.providerResponseSummary!,
          ok: false,
          providerError: 'Provider did not return a shipment id or tracking yet.',
          providerShipmentIdPresent: false,
          trackingNumberPresent: false,
          labelPresent: false,
          barcodePresent: false,
        },
      },
    });
    retryFailedShipmentExecutionMock.mockResolvedValueOnce({
      ...orderWithShipmentSummary.shipmentExecution!,
      id: 'shipment-navlungo-alloc-sporjinal-7621783322961',
      provider: 'navlungo',
      shipmentStatus: 'created',
      providerShipmentId: 'NAV-RETRY-1048',
      trackingNumber: 'NAV-TRACK-1048',
      trackingUrl: 'https://track.navlungo.test/NAV-RETRY-1048',
      labelUrl: 'barcode-string',
      barcode: 'barcode-string',
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

    await user.click(await screen.findByRole('button', { name: 'Retry shipment' }));

    await waitFor(() =>
      expect(retryFailedShipmentExecutionMock).toHaveBeenCalledWith('shipment-navlungo-alloc-sporjinal-7621783322961', {
        vendorId: 'sporjinal',
        customerOverrides: undefined,
      }),
    );
    expect(await screen.findByText('Shipment NAV-RETRY-1048 recorded.')).toBeInTheDocument();
    expect(screen.getAllByText('NAV-TRACK-1048').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: /Open tracking/i })).toHaveAttribute('href', 'https://track.navlungo.test/NAV-RETRY-1048');
  });

  it('lets admins request full Navlungo sender details for one failed retry', async () => {
    const user = userEvent.setup();
    getOrderMock.mockResolvedValue({
      ...orderWithShipmentSummary,
      shipmentExecution: {
        ...orderWithShipmentSummary.shipmentExecution!,
        id: 'shipment-navlungo-alloc-sporjinal-7621783322961',
        provider: 'navlungo',
        providerShipmentId: null,
        trackingNumber: null,
        trackingUrl: null,
        labelUrl: null,
        barcode: null,
        shipmentStatus: 'failed',
        providerResponseSummary: {
          ...orderWithShipmentSummary.shipmentExecution!.providerResponseSummary!,
          ok: false,
          dryRun: false,
          disabledGates: [],
          providerError: 'Execution of ServiceCallout failed.',
        },
      },
    });
    retryFailedShipmentExecutionMock.mockResolvedValueOnce({
      ...orderWithShipmentSummary.shipmentExecution!,
      id: 'shipment-navlungo-alloc-sporjinal-7621783322961',
      provider: 'navlungo',
      shipmentStatus: 'failed',
      providerShipmentId: null,
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

    const fullSenderToggle = (await screen.findAllByLabelText('Use full Navlungo sender details for this retry'))[0];
    await user.click(fullSenderToggle);
    await user.click(screen.getByRole('button', { name: 'Retry shipment' }));

    await waitFor(() =>
      expect(retryFailedShipmentExecutionMock).toHaveBeenCalledWith('shipment-navlungo-alloc-sporjinal-7621783322961', {
        vendorId: 'sporjinal',
        customerOverrides: undefined,
        useFullSenderDetailsForThisRetry: true,
      }),
    );
  });

  it('lets vendors request full Navlungo sender details for one failed retry', async () => {
    const user = userEvent.setup();
    getOrderMock.mockResolvedValue({
      ...orderWithShipmentSummary,
      shipmentExecution: {
        ...orderWithShipmentSummary.shipmentExecution!,
        id: 'shipment-navlungo-alloc-sporjinal-7621783322961',
        provider: 'navlungo',
        providerShipmentId: null,
        trackingNumber: null,
        trackingUrl: null,
        labelUrl: null,
        barcode: null,
        shipmentStatus: 'failed',
        providerResponseSummary: {
          ...orderWithShipmentSummary.shipmentExecution!.providerResponseSummary!,
          ok: false,
          dryRun: false,
          disabledGates: [],
          providerError: 'Execution of ServiceCallout failed.',
        },
      },
    });
    retryFailedShipmentExecutionMock.mockResolvedValueOnce({
      ...orderWithShipmentSummary.shipmentExecution!,
      id: 'shipment-navlungo-alloc-sporjinal-7621783322961',
      provider: 'navlungo',
      shipmentStatus: 'failed',
      providerShipmentId: null,
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

    const fullSenderToggle = await screen.findByLabelText('Use full Navlungo sender details for this retry');
    await user.click(fullSenderToggle);
    await user.click(screen.getByRole('button', { name: 'Retry shipment' }));

    await waitFor(() =>
      expect(retryFailedShipmentExecutionMock).toHaveBeenCalledWith('shipment-navlungo-alloc-sporjinal-7621783322961', {
        vendorId: 'sporjinal',
        customerOverrides: undefined,
        useFullSenderDetailsForThisRetry: true,
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
    expect((await screen.findAllByText(/Shipment ke-live-1028 recorded/i)).length).toBeGreaterThan(0);
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
    expect(screen.queryByText(/Provider id: yes · Barcode:\s*yes · Tracking:\s*yes · Label:\s*yes/)).not.toBeInTheDocument();
  });

  it('renders Navlungo manual detailed status sync diagnostics and timeline events', async () => {
    const user = userEvent.setup();
    refreshShipmentExecutionStatusMock.mockResolvedValue({
      ...orderWithShipmentSummary.shipmentExecution!,
      provider: 'navlungo',
      providerShipmentId: 'NAV-1054',
      trackingNumber: 'SURAT-1054',
      trackingUrl: 'https://tracking.navlungo.example/NAV-1054',
      labelUrl: 'barcode-string',
      shipmentStatus: 'in_transit',
      providerResponseSummary: {
        ...orderWithShipmentSummary.shipmentExecution!.providerResponseSummary!,
        navlungoStatusSyncAttempted: true,
        navlungoStatusSyncHttpStatus: 200,
        navlungoProviderStatusCode: 2,
        navlungoProviderStatusName: 'Delivered',
        navlungoNormalizedStatus: 'delivered',
        navlungoDeliveredDate: '2026-05-22T12:00:00.000Z',
        navlungoCarrierTrackingCode: 'SURAT-1054',
        navlungoCarrierTrackingUrl: 'https://tracking.navlungo.example/NAV-1054',
        navlungoBarcodeStatus: 'created',
        navlungoGeoBadAddress: true,
        navlungoCarrierTrackingPresent: true,
        navlungoLogsCount: 1,
        navlungoStatusLogs: [
          { statusCode: 2, action: 'Delivered', actionResult: 'Alıcıya teslim edildi', createdAt: '2026-05-22T12:00:00.000Z' },
        ],
        shopifyDeliveryStatusSyncSkippedReason: 'not_implemented',
      },
    });
    getOrderMock.mockResolvedValue({
      ...orderWithShipmentSummary,
      shipmentExecution: {
        ...orderWithShipmentSummary.shipmentExecution!,
        id: 'shipment-navlungo-alloc-sporjinal-7621783322961',
        provider: 'navlungo',
        providerShipmentId: 'NAV-1054',
        shipmentStatus: 'created',
        trackingNumber: 'SURAT-1054',
        trackingUrl: 'https://tracking.navlungo.example/NAV-1054',
        labelUrl: 'barcode-string',
        timeline: [],
        providerResponseSummary: {
          ...orderWithShipmentSummary.shipmentExecution!.providerResponseSummary!,
          httpStatus: 200,
          navlungoStatusSyncAttempted: true,
          navlungoStatusSyncHttpStatus: 200,
          navlungoProviderStatusCode: 17,
          navlungoProviderStatusName: 'In Transit',
          navlungoNormalizedStatus: 'in_transit',
          navlungoCarrierTrackingCode: 'SURAT-1054',
          navlungoCarrierTrackingUrl: 'https://tracking.navlungo.example/NAV-1054',
          navlungoBarcodeStatus: 'created',
          navlungoGeoBadAddress: true,
          navlungoCarrierTrackingPresent: true,
          navlungoLogsCount: 1,
          navlungoStatusLogs: [
            { statusCode: 17, action: 'Transfer', actionResult: 'Transfer merkezinde', createdAt: '2026-05-22T10:00:00.000Z' },
            { statusCode: 17, action: 'Transfer', actionResult: 'Transfer merkezinde', createdAt: '2026-05-22T10:00:00.000Z' },
          ],
          shopifyDeliveryStatusSyncSkippedReason: 'not_implemented',
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

    expect(await screen.findByRole('button', { name: 'Sync Navlungo status' })).toBeInTheDocument();
    expect(screen.getAllByText('Carrier reported address validation issue.').length).toBeGreaterThan(0);
    const timeline = screen.getByRole('heading', { name: 'Timeline' }).closest('article');
    expect(timeline).not.toBeNull();
    expect(within(timeline as HTMLElement).getByText('Transfer Aşamasında')).toBeInTheDocument();
    expect(within(timeline as HTMLElement).getAllByText('Transfer Aşamasında')).toHaveLength(1);
    expect(within(timeline as HTMLElement).getAllByText('Transfer merkezinde').length).toBeGreaterThan(0);
    expect(screen.getAllByText('SURAT-1054').length).toBeGreaterThan(0);
    expect(screen.getAllByText('created').length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: 'Sync Navlungo status' }));

    expect(refreshShipmentExecutionStatusMock).toHaveBeenCalledWith('shipment-navlungo-alloc-sporjinal-7621783322961', {
      vendorId: 'sporjinal',
    });
    await waitFor(() => expect(getOrderMock).toHaveBeenCalledTimes(2));
    expect((await screen.findAllByText('Navlungo status synced.')).length).toBeGreaterThan(0);
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
        shipmentStatus: 'searchingDriver',
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
    expect(screen.getByText('Shipment processing')).toBeInTheDocument();
    expect(screen.queryByText('SearchingDriver')).not.toBeInTheDocument();
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
          trackingUrl: 'https://tracking.tryoto.example/RET-TRACK-1028',
          labelUrl: 'https://app.tryoto.example/return-label-1028.pdf',
          barcode: 'RET-BARCODE-1028',
          carrierName: 'Sürat Kargo',
          status: 'created',
          createdAt: '2026-05-15T19:46:00.000Z',
          requestKeys: ['items', 'orderId'],
          responseKeys: ['printReturnAWBURL', 'returnOrderId', 'trackingNumber'],
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
    expect(screen.getByText('Sürat Kargo')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open return tracking' })).toHaveAttribute(
      'href',
      'https://tracking.tryoto.example/RET-TRACK-1028',
    );
    expect(screen.getByRole('link', { name: 'Open return label PDF' })).toHaveAttribute(
      'href',
      'https://app.tryoto.example/return-label-1028.pdf',
    );
    const timeline = screen.getByRole('heading', { name: 'Timeline' }).closest('article');
    expect(timeline).not.toBeNull();
    expect(within(timeline as HTMLElement).getByText('Return tracking attached')).toBeInTheDocument();
    expect(within(timeline as HTMLElement).queryByText(/reverseShipment/i)).not.toBeInTheDocument();
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
    const probeButton = within(probeSection).getByRole('button', { name: 'Probe Shopify return label upload' });
    expect(probeButton).toBeEnabled();
    expect(within(probeSection).getByText('Shopify return id').nextElementSibling).toHaveTextContent('present');
    expect(within(probeSection).getByText('Return tracking/barcode').nextElementSibling).toHaveTextContent('present');
    expect(within(probeSection).getByText('Return label URL').nextElementSibling).toHaveTextContent('present');
    await user.click(probeButton);

    expect(probeShopifyReturnLabelUploadMock).toHaveBeenCalledWith('shipment-try_oto-alloc-sporjinal-7621783322961');
    expect((await screen.findAllByText('Shopify accepted the return label PDF URL.')).length).toBeGreaterThan(0);
    expect((await screen.findAllByText('Shopify return label attached')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Tracking accepted')[0]).toBeInTheDocument();
    expect(screen.getAllByText('Sürat Kargo').length).toBeGreaterThan(0);
  });

  it('lets admins sync Shopify return tracking when Try OTO return label URL is missing', async () => {
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
        returnShipment: {
          provider: 'try_oto',
          returnOrderId: 'OTO-ORDER-1028-R1',
          trackingNumber: 'RET-TRACK-1028',
          trackingUrl: 'https://tracking.example/RET-TRACK-1028',
          labelUrl: null,
          barcode: 'RET-BARCODE-1028',
          status: 'created',
          createdAt: '2026-05-15T19:46:00.000Z',
          requestKeys: ['items', 'orderId'],
          responseKeys: ['brandedTrackingURL', 'returnOrderId', 'trackingNumber'],
          trackingPresent: true,
          labelPresent: false,
          labelRetrievalConfirmed: false,
          labelRetrievalNote: null,
          shopifyReturnLabelUploadProbe: null,
        },
        providerResponseSummary: null,
      },
    });
    probeShopifyReturnLabelUploadMock.mockResolvedValueOnce({
      ...orderWithShipmentSummary.shipmentExecution,
      id: 'shipment-try_oto-alloc-sporjinal-7621783322961',
      provider: 'try_oto',
      shipmentStatus: 'delivered',
      providerShipmentId: 'OTO-SHIP-1028',
      trackingNumber: 'OTO-TRACK-1028',
      returnShipment: {
        provider: 'try_oto',
        returnOrderId: 'OTO-ORDER-1028-R1',
        trackingNumber: 'RET-TRACK-1028',
        trackingUrl: 'https://tracking.example/RET-TRACK-1028',
        labelUrl: null,
        barcode: 'RET-BARCODE-1028',
        status: 'created',
        createdAt: '2026-05-15T19:46:00.000Z',
        requestKeys: ['items', 'orderId'],
        responseKeys: ['brandedTrackingURL', 'returnOrderId', 'trackingNumber'],
        trackingPresent: true,
        labelPresent: false,
        labelRetrievalConfirmed: false,
        labelRetrievalNote: null,
        shopifyReturnLabelUploadProbe: {
          status: 'success',
          attemptedAt: '2026-05-15T19:48:00.000Z',
          reverseFulfillmentOrderIdPresent: true,
          reverseLineItemIdsPresent: true,
          mutationUsed: 'reverseDeliveryCreateWithShipping',
          shopifyUserErrors: [],
          reverseDeliveryIdPresent: true,
          shopifyReturnIdPresent: true,
          trackingAccepted: true,
          labelAccepted: false,
          returnedCarrierName: 'Sürat Kargo',
          carrierNamePresent: true,
          trackingOnlyMode: true,
          labelInputSent: false,
          shopifyCallAttempted: true,
          skippedReason: 'return_label_url_missing_tracking_only',
          errorMessage: null,
        },
      },
      updatedAt: '2026-05-15T19:48:00.000Z',
    });

    renderOrderDetail();

    const probeSection = await screen.findByLabelText('Shopify return label upload probe');
    const probeButton = within(probeSection).getByRole('button', { name: 'Probe Shopify return label upload' });
    expect(probeButton).toBeEnabled();
    expect(within(probeSection).getByText('Return label URL').nextElementSibling).toHaveTextContent('missing');
    expect(await screen.findByText('Printable return label unavailable')).toBeInTheDocument();
    await user.click(probeButton);

    expect(probeShopifyReturnLabelUploadMock).toHaveBeenCalledWith('shipment-try_oto-alloc-sporjinal-7621783322961');
    expect((await screen.findAllByText('Shopify return tracking attached.')).length).toBeGreaterThan(0);
    expect((await screen.findAllByText('Shopify return tracking attached. Customer can track return shipment in Shopify.')).length).toBeGreaterThan(0);
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
          status: 'newReturn',
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
          status: 'newReturn',
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
          status: 'newReturn',
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
      dryRun: false,
    });
    expect((await screen.findAllByText('Try OTO return shipment label created.')).length).toBeGreaterThan(0);
  });

  it('does not expose detached Navlungo return pickup creation from Order Detail', async () => {
    setCurrentUser({
      email: 'admin@example.com',
      name: 'Admin User',
      role: 'admin',
      vendorAccess: ['sporjinal'],
      vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
      canSwitchVendors: true,
      defaultVendorId: 'sporjinal',
    });
    const navlungoShipment = {
      ...orderWithShipmentSummary.shipmentExecution!,
      id: 'shipment-navlungo-alloc-sporjinal-7621783322961',
      provider: 'navlungo' as const,
      shipmentStatus: 'delivered' as const,
      providerShipmentId: 'NAV-1028',
      trackingNumber: 'NAV-TRACK-1028',
      returnShipment: null,
      providerResponseSummary: null,
    };
    getOrderMock.mockResolvedValue({
      ...orderWithShipmentSummary,
      shipmentExecution: navlungoShipment,
    });

    renderOrderDetail();

    await screen.findByText('Carrier');
    expect(screen.queryByRole('button', { name: 'Preview Navlungo return pickup' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create live Navlungo return pickup' })).not.toBeInTheDocument();
    expect(createReturnShipmentLabelMock).not.toHaveBeenCalled();
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
          labelRetrievalNote: null,
          finalized: false,
          labelRetrievable: false,
          providerStatusSource: 'createReturnShipment',
          diagnostics: null,
        },
        providerResponseSummary: null,
      },
    });

    renderOrderDetail();

    expect(screen.queryByText('newReturn')).not.toBeInTheDocument();
    expect((await screen.findAllByText(/Return created/)).length).toBeGreaterThan(0);
    expect((await screen.findAllByText('Printable return label unavailable')).length).toBeGreaterThan(0);
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
          labelRetrievalNote: null,
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
            returnStatus: 'newReturn',
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

    expect(screen.queryByText('newReturn')).not.toBeInTheDocument();
    expect((await screen.findAllByText(/Return created/)).length).toBeGreaterThan(0);
    expect((await screen.findAllByText('Printable return label unavailable')).length).toBeGreaterThan(0);
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
          labelRetrievalNote: null,
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
            returnStatus: 'newReturn',
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

    expect(screen.queryByText('newReturn')).not.toBeInTheDocument();
    expect((await screen.findAllByText(/Return created/)).length).toBeGreaterThan(0);
    expect((await screen.findAllByText('Printable return label unavailable')).length).toBeGreaterThan(0);
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

    const diagnostics = (await screen.findByLabelText('Shopify return signal diagnostics')) as HTMLDetailsElement;
    expect(diagnostics.tagName).toBe('DETAILS');
    expect(diagnostics.open).toBe(false);
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
    const diagnostics = screen.getByLabelText('Shopify fulfillment diagnostics') as HTMLDetailsElement;
    expect(diagnostics.tagName).toBe('DETAILS');
    expect(diagnostics.open).toBe(false);
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

  it('renders returned admin Navlungo retry evidence instead of stale pending fallback', async () => {
    const user = userEvent.setup();
    getOrderMock.mockResolvedValue({
      ...orderWithShipmentSummary,
      shipmentExecution: {
        ...orderWithShipmentSummary.shipmentExecution!,
        id: 'shipment-navlungo-alloc-sporjinal-7621783322961',
        provider: 'navlungo',
        providerShipmentId: null,
        trackingNumber: null,
        trackingUrl: null,
        labelUrl: null,
        barcode: null,
        shipmentStatus: 'pending',
        providerResponseSummary: {
          ...orderWithShipmentSummary.shipmentExecution!.providerResponseSummary!,
          ok: true,
          dryRun: true,
          disabledGates: ['SHIPPING_EXECUTION_ENABLED'],
          providerError: 'Provider did not return a shipment id or tracking yet.',
          providerShipmentIdPresent: false,
          trackingNumberPresent: false,
          trackingUrlPresent: false,
          labelPresent: false,
          barcodePresent: false,
        },
      },
    });
    retryShipmentExecutionMock.mockResolvedValueOnce({
      ...orderWithShipmentSummary.shipmentExecution!,
      id: 'shipment-navlungo-alloc-sporjinal-7621783322961',
      provider: 'navlungo',
      shipmentStatus: 'created',
      providerShipmentId: 'NAV-ADMIN-1051',
      trackingNumber: 'NAV-ADMIN-TRACK-1051',
      trackingUrl: 'https://track.navlungo.test/NAV-ADMIN-1051',
      labelUrl: 'barcode-string',
      barcode: 'barcode-string',
      providerResponseSummary: {
        ...orderWithShipmentSummary.shipmentExecution!.providerResponseSummary!,
        ok: true,
        dryRun: false,
        disabledGates: [],
        providerError: null,
        providerShipmentIdPresent: true,
        trackingNumberPresent: true,
        trackingUrlPresent: true,
        labelPresent: true,
        barcodePresent: true,
      },
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

    await user.click(await screen.findByRole('button', { name: 'Retry live shipment' }));

    await waitFor(() => expect(retryShipmentExecutionMock).toHaveBeenCalledWith('shipment-navlungo-alloc-sporjinal-7621783322961'));
    expect((await screen.findAllByText('Shipment NAV-ADMIN-1051 recorded.')).length).toBeGreaterThan(0);
    expect(screen.getByText('NAV-ADMIN-TRACK-1051')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open tracking/i })).toHaveAttribute('href', 'https://track.navlungo.test/NAV-ADMIN-1051');
    expect(screen.queryByText(/Provider id: pending/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Provider did not return a shipment id or tracking yet/)).not.toBeInTheDocument();
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
    expect((await screen.findAllByText('Shipment action completed.')).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Endpoint:\s*POST \/shipments\/create/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Provider id: yes · Barcode: yes/)).not.toBeInTheDocument();
    expect(screen.getByText('ke-created-1028')).toBeInTheDocument();
    expect(screen.getByText('barcode-1028')).toBeInTheDocument();
    await waitFor(() => expect(getOrderMock).toHaveBeenCalledTimes(2));
  });

  it('does not show a successful completion message for Kargonomi needs-review shipment without provider evidence', async () => {
    const user = userEvent.setup();
    getOrderMock.mockResolvedValue(orderWithoutShipment);
    createShipmentExecutionMock.mockResolvedValueOnce({
      ...orderWithShipmentSummary.shipmentExecution!,
      id: 'shipment-kargonomi-pending',
      provider: 'kargonomi',
      providerShipmentId: null,
      trackingNumber: null,
      trackingUrl: null,
      labelUrl: null,
      barcode: null,
      shipmentStatus: 'pending',
      warehouseId: '112668',
      providerResponseSummary: {
        ...orderWithShipmentSummary.shipmentExecution!.providerResponseSummary!,
        ok: false,
        providerError: 'Kargonomi shipment draft creation failed before provider response: fetch failed.',
        providerApiCallAttempted: true,
        lastProviderStage: 'create_shipment',
        createShipmentCalled: true,
        priceComparisonCalled: false,
        confirmShippingPriceCalled: false,
        getShipmentCalled: false,
        barcodeFetchCalled: false,
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

    await user.click(await screen.findByRole('button', { name: 'Create shipment' }));

    expect((await screen.findAllByText('Shipment needs review. Provider did not return a shipment id or tracking yet.')).length).toBeGreaterThan(0);
    expect(screen.queryByText('Shipment action completed.')).not.toBeInTheDocument();
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
    expect(screen.getByText('Shipment action needs attention.')).toBeInTheDocument();
    expect(screen.queryByText(/Endpoint:\s*\/shipments\/create/)).not.toBeInTheDocument();
    expect(screen.queryByText(/HTTP:\s*400.*Request:\s*req-shipment-1/)).not.toBeInTheDocument();
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
    expect(screen.getByText('Complete the missing shipment fields to continue.')).toBeInTheDocument();
    expect(screen.queryByText(/Endpoint:\s*POST \/shipments\/create/)).not.toBeInTheDocument();
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
    expect(screen.queryByRole('button', { name: 'Add tracking information' })).not.toBeInTheDocument();

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

  it('uses shipment-only district override for Kargonomi destination recovery', async () => {
    const user = userEvent.setup();
    getOrderMock.mockResolvedValue(orderWithoutShipment);
    createShipmentExecutionMock.mockRejectedValueOnce(
      new Error(
        'Kargonomi destination district is missing from the order shipping address.\nMissing required shipment fields:\n- buyer.buyer_state_id\n- buyer.buyer_city_id\nProvider request blocked before create call.',
      ),
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

    expect(await screen.findByText('Complete shipment-only fields')).toBeInTheDocument();
    expect(screen.getByLabelText('District *')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add tracking information' })).not.toBeInTheDocument();

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
  });

  it('renders shipment-only District for Navlungo recipient district messages and submits override', async () => {
    const user = userEvent.setup();
    getOrderMock.mockResolvedValue({
      ...orderWithShipmentSummary,
      shipmentExecution: {
        ...orderWithShipmentSummary.shipmentExecution!,
        provider: 'navlungo',
        providerShipmentId: null,
        trackingNumber: null,
        labelUrl: null,
        barcode: null,
        shipmentStatus: 'validation_failed',
        providerResponseSummary: {
          ...orderWithShipmentSummary.shipmentExecution!.providerResponseSummary!,
          ok: false,
          providerError: 'Missing required shipment fields:\n- recipient.district\n\nProvider request blocked before create call.',
          providerValidationErrors: ['recipient.district is required'],
        },
      },
    });
    retryFailedShipmentExecutionMock.mockResolvedValueOnce({
      ...orderWithShipmentSummary.shipmentExecution!,
      provider: 'navlungo',
      shipmentStatus: 'created',
      providerShipmentId: 'NAV-RECIPIENT-DISTRICT',
      barcode: 'barcode-string',
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

    await screen.findByText('Order #1028');

    expect(await screen.findByText('Complete shipment-only fields')).toBeInTheDocument();
    await user.type(screen.getByLabelText('District *'), 'Kartal');
    await user.click(screen.getByRole('button', { name: 'Retry shipment with completed fields' }));

    await waitFor(() =>
      expect(retryFailedShipmentExecutionMock).toHaveBeenCalledWith('shipment-kargo_entegrator-alloc-sporjinal-7621783322961', {
        vendorId: 'sporjinal',
        customerOverrides: {
          district: 'Kartal',
        },
      }),
    );
  });

  it('renders sanitized Navlungo validation fields and messages in admin diagnostics', async () => {
    getOrderMock.mockResolvedValue({
      ...orderWithShipmentSummary,
      shipmentExecution: {
        ...orderWithShipmentSummary.shipmentExecution!,
        provider: 'navlungo',
        providerShipmentId: null,
        trackingNumber: null,
        trackingUrl: null,
        labelUrl: null,
        barcode: null,
        shipmentStatus: 'validation_failed',
        providerResponseSummary: {
          ...orderWithShipmentSummary.shipmentExecution!.providerResponseSummary!,
          ok: false,
          httpStatus: 422,
          providerError: 'Validation Errors',
          providerValidationErrors: [
            'errors.recipient.phone validation failed',
            'The desi field is required.',
          ],
          realPathCreatePostHttpStatus: 422,
          providerCallHttpStatus: 422,
          validationErrorKeys: ['errors'],
          failedFieldNames: ['errors.recipient.phone', 'errors.post.desi'],
          validationErrorMessages: [
            'errors.recipient.phone validation failed',
            'The desi field is required.',
          ],
          providerErrorCode: 'VALIDATION_ERROR',
        },
      },
    });
    setCurrentUser({
      email: 'admin@example.com',
      name: 'Admin',
      role: 'admin',
      vendorAccess: ['sporjinal'],
      vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
      canSwitchVendors: true,
      defaultVendorId: 'sporjinal',
    });

    renderOrderDetail();

    await screen.findByText('Order #1028');

    expect(screen.getAllByText('Navlungo retry diagnostics').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Create Post HTTP').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Validation fields').length).toBeGreaterThan(0);
    expect(screen.getAllByText('errors.recipient.phone, errors.post.desi').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Validation messages').length).toBeGreaterThan(0);
    expect(screen.getAllByText('errors.recipient.phone validation failed · The desi field is required.').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Provider error code').length).toBeGreaterThan(0);
    expect(screen.getAllByText('VALIDATION_ERROR').length).toBeGreaterThan(0);
    expect(screen.queryByText('+90 532 123 45 68')).not.toBeInTheDocument();
    expect(screen.queryByText('recipient@example.test')).not.toBeInTheDocument();
  });

  it('renders Navlungo error-object validation fields and messages in admin diagnostics', async () => {
    getOrderMock.mockResolvedValue({
      ...orderWithShipmentSummary,
      shipmentExecution: {
        ...orderWithShipmentSummary.shipmentExecution!,
        provider: 'navlungo',
        providerShipmentId: null,
        trackingNumber: null,
        trackingUrl: null,
        labelUrl: null,
        barcode: null,
        shipmentStatus: 'validation_failed',
        providerResponseSummary: {
          ...orderWithShipmentSummary.shipmentExecution!.providerResponseSummary!,
          ok: false,
          httpStatus: 422,
          providerError: 'Validation Errors',
          providerValidationErrors: [
            'This reference id has already been registered.',
            'Carrier field is required',
          ],
          realPathCreatePostHttpStatus: 422,
          providerCallHttpStatus: 422,
          validationErrorKeys: ['posts.0.reference_id', 'posts.0.carrier_id'],
          failedFieldNames: ['posts.0.reference_id', 'posts.0.carrier_id'],
          validationErrorMessages: [
            'This reference id has already been registered.',
            'Carrier field is required',
          ],
          validationErrorKeysCount: 2,
          failedFieldNamesCount: 2,
          validationErrorMessagesCount: 2,
          topLevelErrorShape: 'object:2',
          nestedCreatePostErrorShape: 'missing',
          providerValidationErrorsShape: 'array:2',
        },
      },
    });
    setCurrentUser({
      email: 'admin@example.com',
      name: 'Admin',
      role: 'admin',
      vendorAccess: ['sporjinal'],
      vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
      canSwitchVendors: true,
      defaultVendorId: 'sporjinal',
    });

    renderOrderDetail();

    await screen.findByText('Order #1028');

    expect(screen.getAllByText('Validation fields').length).toBeGreaterThan(0);
    expect(screen.getAllByText('posts.0.reference_id, posts.0.carrier_id').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Validation messages').length).toBeGreaterThan(0);
    expect(screen.getAllByText('This reference id has already been registered. · Carrier field is required').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Validation counts').length).toBeGreaterThan(0);
    expect(screen.getAllByText('fields 2 · messages 2 · keys 2').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Validation shapes').length).toBeGreaterThan(0);
    expect(screen.getAllByText('top object:2 · nested missing · provider array:2').length).toBeGreaterThan(0);
  });

  it('compares sanitized Navlungo probe and real retry request shapes without exposing PII', async () => {
    const user = userEvent.setup();
    getOrderMock.mockResolvedValue({
      ...orderWithShipmentSummary,
      shipmentExecution: {
        ...orderWithShipmentSummary.shipmentExecution!,
        provider: 'navlungo',
        providerShipmentId: null,
        trackingNumber: null,
        trackingUrl: null,
        labelUrl: null,
        barcode: null,
        shipmentStatus: 'failed',
        providerResponseSummary: {
          ...orderWithShipmentSummary.shipmentExecution!.providerResponseSummary!,
          ok: false,
          httpStatus: 500,
          providerError: 'Execution of ServiceCallout failed',
          providerTrackingId: '#e41c3430fb2d4e9c98bd023a94d29a60',
          realPathCreatePostHttpStatus: 500,
          providerCallHttpStatus: 500,
          realPathRequestedCarrierId: 9,
          realPathRequestedPostType: 2,
          realPathRequestedBarcodeFormat: 'pdf-A6',
          realPathCodPaymentIncluded: true,
          realPathPriceIncluded: true,
          navlungoRequestSummary: buildNavlungoRequestSummary({
            senderKeys: ['addressId'],
            senderUsesAddressId: true,
            senderFullObjectKeysPresent: false,
            recipientAddressLength: 42,
            codPaymentTypePresent: true,
            codPaymentType: 'string-empty',
            postPricePresent: true,
            postPriceType: 'string-empty',
          }),
          lastSuccessfulNavlungoRequestSummary: buildNavlungoRequestSummary({
            senderKeys: ['addressId'],
            senderUsesAddressId: true,
            senderFullObjectKeysPresent: false,
            recipientDistrictPresent: true,
            recipientCityPresent: true,
            recipientCountryPresent: true,
            recipientPostCodePresent: false,
            recipientPhoneFormatValid: true,
            recipientEmailPresent: true,
            recipientAddressPresent: true,
            recipientAddressLength: 38,
            requestedDesi: 3,
            requestedPackageCount: 1,
            requestedCarrierId: 9,
            requestedPostType: 2,
          }),
          lastSuccessfulNavlungoRequestSummarySource: 'latest_successful_vendor_execution',
        },
      },
    });
    setCurrentUser({
      email: 'admin@example.com',
      name: 'Admin',
      role: 'admin',
      vendorAccess: ['sporjinal'],
      vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
      canSwitchVendors: true,
      defaultVendorId: 'sporjinal',
    });

    renderOrderDetail();

    await user.selectOptions(await screen.findByLabelText('Provider'), 'navlungo');
    await user.click(screen.getByLabelText('I understand this creates one Navlungo test post'));
    await user.click(screen.getByRole('button', { name: 'Run Navlungo Create Post probe' }));

    const diff = await screen.findByLabelText('Navlungo probe retry request diff');
    expect(within(diff).getByText('Response summary').closest('.summary-row')).toHaveTextContent(
      'probe HTTP 201 · real HTTP 500 · tracking ID #e41c3430fb2d4e9c98bd023a94d29a60',
    );
    expect(within(diff).getByText('sender keys').closest('.summary-row')).toHaveTextContent(
      'different · probe: address, city, country, district, email, name, phone, post_code · real: addressId',
    );
    expect(within(diff).getByText('sender uses addressId').closest('.summary-row')).toHaveTextContent('different · probe: no · real: yes');
    expect(within(diff).getByText('recipient phone format').closest('.summary-row')).toHaveTextContent('same · probe: yes · real: yes');
    expect(within(diff).getByText('recipient address length').closest('.summary-row')).toHaveTextContent('different · probe: 38 · real: 42');
    expect(within(diff).getByText('cod_payment_type').closest('.summary-row')).toHaveTextContent(
      'different · probe: missing · — · real: present · string-empty',
    );
    expect(within(diff).getByText('post.price').closest('.summary-row')).toHaveTextContent(
      'different · probe: missing · — · real: present · string-empty',
    );
    expect(screen.queryByText('+90 532 123 45 68')).not.toBeInTheDocument();
    expect(screen.queryByText('recipient.test@example.invalid')).not.toBeInTheDocument();
    expect(screen.queryByText('Navlungo Test Recipient')).not.toBeInTheDocument();
    expect(screen.queryByText('Navlungo manual probe recipient address')).not.toBeInTheDocument();
    const successDiff = screen.getByLabelText('Navlungo successful failing request diff');
    expect(within(successDiff).getByText('sender uses addressId').closest('.summary-row')).toHaveTextContent('same · success: yes · current: yes');
    expect(within(successDiff).getByText('recipient address length').closest('.summary-row')).toHaveTextContent('different · success: 38 · current: 42');
    expect(within(successDiff).getByText('recipient district present').closest('.summary-row')).toHaveTextContent('same · success: yes · current: yes');
    const visibleSummary = screen.getByLabelText('Navlungo request summary diagnostics');
    expect(within(visibleSummary).getByText('Request summary present').closest('.summary-row')).toHaveTextContent('yes');
    expect(within(visibleSummary).getByText('Last successful summary present').closest('.summary-row')).toHaveTextContent('yes');
    expect(within(visibleSummary).getByText('Last successful summary source').closest('.summary-row')).toHaveTextContent(
      'latest_successful_vendor_execution',
    );
    expect(within(visibleSummary).getByText('Current Navlungo request summary').closest('.summary-row')).toHaveTextContent(
      'available',
    );
    expect(within(visibleSummary).getByText('Last successful Navlungo request summary').closest('.summary-row')).toHaveTextContent(
      'available',
    );
    expect(within(visibleSummary).getByText('Last successful vs current request diff').closest('.summary-row')).toHaveTextContent(
      'safe fields compared',
    );
    expect((screen.getByLabelText('Navlungo retry diagnostics') as HTMLDetailsElement).open).toBe(true);
  });

  it('renders current-only Navlungo request diagnostics when no last successful summary exists', async () => {
    getOrderMock.mockResolvedValue({
      ...orderWithShipmentSummary,
      shipmentExecution: {
        ...orderWithShipmentSummary.shipmentExecution!,
        provider: 'navlungo',
        providerShipmentId: null,
        trackingNumber: null,
        trackingUrl: null,
        labelUrl: null,
        barcode: null,
        shipmentStatus: 'failed',
        providerResponseSummary: {
          ...orderWithShipmentSummary.shipmentExecution!.providerResponseSummary!,
          ok: false,
          httpStatus: 500,
          providerError: 'Execution of ServiceCallout failed',
          realPathCreatePostHttpStatus: 500,
          providerCallHttpStatus: 500,
          navlungoRequestSummary: buildNavlungoRequestSummary({
            senderKeys: ['addressId'],
            senderUsesAddressId: true,
            senderFullObjectKeysPresent: false,
            recipientDistrictPresent: true,
            recipientCityPresent: true,
            recipientPhoneFormatValid: true,
            recipientEmailPresent: true,
            recipientAddressPresent: true,
            recipientAddressLength: 42,
            requestedDesi: 3,
            requestedPackageCount: 1,
            requestedCarrierId: 9,
            requestedPostType: 2,
            barcodeFormatType: 'string',
          }),
          lastSuccessfulNavlungoRequestSummary: null,
          lastSuccessfulNavlungoRequestSummaryReason: 'no_valid_successful_real_navlungo_summary',
        },
      },
    });
    setCurrentUser({
      email: 'admin@example.com',
      name: 'Admin',
      role: 'admin',
      vendorAccess: ['sporjinal'],
      vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
      canSwitchVendors: true,
      defaultVendorId: 'sporjinal',
    });

    renderOrderDetail();

    await screen.findByText('Order #1028');

    const diff = screen.getByLabelText('Navlungo successful failing request diff');
    const visibleSummary = screen.getByLabelText('Navlungo request summary diagnostics');
    expect((screen.getByLabelText('Navlungo retry diagnostics') as HTMLDetailsElement).open).toBe(true);
    expect(within(visibleSummary).getByText('Request summary present').closest('.summary-row')).toHaveTextContent('yes');
    expect(within(visibleSummary).getByText('Last successful summary present').closest('.summary-row')).toHaveTextContent('no');
    expect(within(visibleSummary).getByText('Last successful summary source').closest('.summary-row')).toHaveTextContent('—');
    expect(within(visibleSummary).getByText('Last successful summary reason').closest('.summary-row')).toHaveTextContent(
      'no_valid_successful_real_navlungo_summary',
    );
    expect(within(visibleSummary).getByText('Current Navlungo request summary').closest('.summary-row')).toHaveTextContent(
      'available',
    );
    expect(within(diff).getByText('Last successful request').closest('.summary-row')).toHaveTextContent('not available');
    expect(within(diff).getByText('current sender mode').closest('.summary-row')).toHaveTextContent(
      'addressId yes · sender keys addressId',
    );
    expect(within(diff).getByText('current recipient presence').closest('.summary-row')).toHaveTextContent(
      'district yes · city yes · email yes · address yes',
    );
    expect(within(diff).getByText('current recipient format').closest('.summary-row')).toHaveTextContent(
      'phone format yes · address length 42',
    );
    expect(within(diff).getByText('current package').closest('.summary-row')).toHaveTextContent('desi 3 · package_count 1');
    expect(within(diff).getByText('current provider choices').closest('.summary-row')).toHaveTextContent(
      'carrier 9 · post 2 · barcode string',
    );
    expect(screen.queryByText('+90 532 123 45 68')).not.toBeInTheDocument();
    expect(screen.queryByText('recipient.test@example.invalid')).not.toBeInTheDocument();
    expect(screen.queryByText('Navlungo Test Recipient')).not.toBeInTheDocument();
    expect(screen.queryByText('Navlungo manual probe recipient address')).not.toBeInTheDocument();
  });

  it('renders Navlungo provider tracking id in admin retry diagnostics', async () => {
    const providerMessage =
      'Execution of ServiceCallout failed. Please report for error resolution with Tracking ID: #35440d91ec90403483413b548ba91844';
    getOrderMock.mockResolvedValue({
      ...orderWithShipmentSummary,
      shipmentExecution: {
        ...orderWithShipmentSummary.shipmentExecution!,
        provider: 'navlungo',
        providerShipmentId: null,
        trackingNumber: null,
        trackingUrl: null,
        labelUrl: null,
        barcode: null,
        shipmentStatus: 'failed',
        providerResponseSummary: {
          ...orderWithShipmentSummary.shipmentExecution!.providerResponseSummary!,
          ok: false,
          httpStatus: 500,
          providerError: providerMessage,
          realPathCreatePostHttpStatus: 500,
          providerCallHttpStatus: 500,
          providerTrackingId: '#35440d91ec90403483413b548ba91844',
          senderAddressIdPresent: true,
          senderAddressIdValid: true,
          senderUsesAddressId: true,
          realPathRequestedCarrierId: 9,
          realPathRequestedPostType: 2,
          realPathRequestedBarcodeFormat: 'pdf-A6',
        },
      },
    });
    setCurrentUser({
      email: 'admin@example.com',
      name: 'Admin',
      role: 'admin',
      vendorAccess: ['sporjinal'],
      vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
      canSwitchVendors: true,
      defaultVendorId: 'sporjinal',
    });

    renderOrderDetail();

    await screen.findByText('Order #1028');

    expect(screen.getAllByText('Provider call HTTP').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Provider message').length).toBeGreaterThan(0);
    expect(screen.getAllByText(providerMessage).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Provider tracking ID').length).toBeGreaterThan(0);
    expect(screen.getAllByText('#35440d91ec90403483413b548ba91844').length).toBeGreaterThan(0);
    expect(screen.getAllByText('present yes · valid yes · addressId sender yes').length).toBeGreaterThan(0);
    expect(screen.getAllByText('carrier 9 · post 2 · barcode pdf-A6').length).toBeGreaterThan(0);
    expect(screen.queryByText('recipient@example.test')).not.toBeInTheDocument();
  });

  it('hides payment evidence internals from vendor order finance timeline', async () => {
    setCurrentUser({
      email: 'vendor@example.com',
      name: 'Vendor User',
      role: 'vendor',
      vendorAccess: ['sporjinal'],
      vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
      canSwitchVendors: false,
      defaultVendorId: 'sporjinal',
    });
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
          id: 'finance-payment-evidence-1028',
          date: '2026-05-15T12:08:00.000Z',
          description: 'Sale recorded',
          counterparty: 'Shopify',
          category: 'Payout',
          amount: 'TRY 4,999.00',
          status: 'Pending',
          shopifyOrderNumber: '#1028',
          shopifyOrderId: 'gid://shopify/Order/7616544244049',
          payoutCalculation: {
            grossAmount: 'TRY 4,999.00',
            commission: 'TRY 499.90',
            commissionVat: 'TRY 0.00',
            shippingDeduction: 'TRY 0.00',
            refundImpact: 'TRY 0.00',
            estimatedPayout: 'TRY 4,499.10',
            shippingApplied: false,
            shippingMode: 'disabled',
            profileSource: 'snapshot',
            commissionPercent: '10.00',
            commissionVatPercent: '0.00',
          },
          payoutBatch: {
            id: 'batch-payment-evidence-1028',
            status: 'paid_placeholder',
            netAmount: 'TRY 4,499.10',
            createdAt: '2026-05-16T12:08:00.000Z',
          },
        },
      ],
    });

    renderOrderDetail();

    const financeTimeline = await screen.findByLabelText('Finance timeline');
    expect(financeTimeline).toHaveTextContent('Settlement preview generated');
    expect(financeTimeline).toHaveTextContent('Settlement awaiting review');
    expect(financeTimeline).not.toHaveTextContent('Payment evidence pending');
    expect(financeTimeline).not.toHaveTextContent('Evidence pending');
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

    expect((await screen.findAllByText(/Returned trainer/)).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Return active')).toHaveLength(1);
    expect(screen.queryByLabelText('Primary operational status')).not.toBeInTheDocument();
    const alertRegion = screen.getByLabelText('Operational alerts');
    expect(within(alertRegion).getByText(/Customer return requested/i)).toBeInTheDocument();
    expect(within(alertRegion).getByRole('link', { name: 'Open return details' })).toHaveAttribute('href', '/returns/return-1028');
    expect(screen.getByLabelText('Shipping address summary')).toHaveTextContent('Ship to');
    expect(screen.getByText('Shopify shipping address available in future detail sync.')).toBeInTheDocument();
    const returnLink = screen.getByRole('link', { name: /Return for #1028/i });
    expect(returnLink).toHaveAttribute('href', '/returns/return-1028');
    const financeLink = screen.getByRole('link', { name: /Settlement activity/i });
    expect(financeLink.getAttribute('href')).toContain('/finance');
    expect(screen.getAllByText('Return linked').length).toBeGreaterThan(0);
    expect(screen.getByText('Pending review')).toBeInTheDocument();
    expect(screen.getByText('TRY 4,999.00 · Pending')).toBeInTheDocument();
    const financeTimeline = screen.getByLabelText('Finance timeline');
    expect(within(financeTimeline).getByText('Refund impact pending')).toBeInTheDocument();
    expect(financeTimeline).not.toHaveTextContent(/Payout scheduled|Payout paid|Confirmed settlement/i);
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
    expect(screen.queryByText('Provider returned no shipment identifiers.')).not.toBeInTheDocument();
    expect(screen.queryByText('SHIPPING_EXECUTION_ENABLED')).not.toBeInTheDocument();
    expect(screen.queryByText('Shipment recovery')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Shipment timeline')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry live shipment' })).not.toBeInTheDocument();
    expect(getShippingProviderDiagnosticsMock).not.toHaveBeenCalled();
    expect(getVendorShippingConfigMock).not.toHaveBeenCalled();
  });
});
