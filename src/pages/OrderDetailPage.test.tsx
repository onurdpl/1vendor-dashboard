import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AllocationSplitExecutionResponse, AllocationSplitPlannerResponse, OrderDetail } from '../features/orders/api';
import { clearToken, getCurrentUser, markAuthConfirmed, setCurrentUser as setCachedCurrentUser, setCurrentVendorId, setToken, type CurrentUser } from '../lib/auth';
import { getAdminVendorSelection, verifyAdminVendorSelection } from '../lib/auth/vendorContext';
import { useAppReadiness } from '../lib/appReadiness';
import { ApiError } from '../lib/api/errors';
import { queryKeys } from '../lib/api/queryKeys';
import { queryClient as mutationQueryClient } from '../lib/api/queryClient';
import type { SupportTicket } from '../lib/api/contracts';
import { OrderDetailPage } from './OrderDetailPage';

const getOrderMock = vi.fn<(orderId: string, options?: { vendorId?: string | null }) => Promise<OrderDetail>>();

// These Order Detail fixtures exercise authenticated sessions in real API mode.
function setCurrentUser(user: CurrentUser) {
  setCachedCurrentUser(user);
  markAuthConfirmed({ restoreAttemptId: 'order-detail-test-restore' });
  if (user.role === 'admin') setCurrentVendorId(user.defaultVendorId);
}

async function verifySelectedAdminVendorForTest() {
  const user = getCurrentUser();
  const selectedVendorId = getAdminVendorSelection().vendorId;
  if (user?.role !== 'admin' || !selectedVendorId) return;
  await verifyAdminVendorSelection(
    async (vendorId) => {
      const vendor = user.vendorDetails?.find((item) => item.vendorId === vendorId);
      if (!vendor) throw new Error(`No Order Detail test Vendor fixture for ${vendorId}.`);
      return {
        vendorId: vendor.vendorId,
        vendorName: vendor.vendorName,
        status: vendor.status ?? 'active',
        restricted: (vendor.status ?? 'active') !== 'active',
        restrictionReason: vendor.restrictionReason ?? null,
        changedByUserId: vendor.restrictionChangedByUserId ?? null,
        changedByEmail: vendor.restrictionChangedByEmail ?? null,
        changedAt: vendor.restrictionChangedAt ?? null,
      };
    },
    async () => { throw new Error('Order Detail test Vendor confirmation is unavailable.'); },
  );
}

function TestAdminVendorVerifier() {
  const readiness = useAppReadiness();
  const selection = getAdminVendorSelection();
  useEffect(() => {
    if (readiness.currentUser?.role !== 'admin' || !readiness.authConfirmed
      || !selection.vendorId || selection.status === 'verified') return;
    void verifySelectedAdminVendorForTest();
  }, [readiness.authConfirmed, readiness.currentUser?.role, selection.vendorId, selection.generation]);
  return <OrderDetailPage />;
}

const rejectOrderMock = vi.fn();
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
const getShippingProviderDiagnosticsMock = vi.fn();
const getVendorShippingConfigMock = vi.fn();
const getAdminVendorShippingConfigMock = vi.fn();
const updateVendorShippingConfigMock = vi.fn();
const syncKargonomiWarehouseDetailsMock = vi.fn();
const createShipmentExecutionMock = vi.fn();
const retryShipmentExecutionMock = vi.fn();
const retryFailedShipmentExecutionMock = vi.fn();
const refreshShipmentExecutionStatusMock = vi.fn();
const refreshShipmentProviderDataMock = vi.fn();
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
    getOrder: (orderId: string, options?: { vendorId?: string | null }) => getOrderMock(orderId, options),
    rejectOrder: (orderId: string, payload: unknown, options?: { vendorId?: string | null }) =>
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
    getShippingProviderDiagnostics: (options?: { vendorId?: string | null; provider?: string | null }) =>
      getShippingProviderDiagnosticsMock(options),
    getVendorShippingConfig: (options?: { vendorId?: string | null }) => getVendorShippingConfigMock(options),
    getAdminVendorShippingConfig: (vendorId: string, options?: { signal?: AbortSignal }) =>
      getAdminVendorShippingConfigMock(vendorId, options),
    updateVendorShippingConfig: (vendorId: string, input: unknown) => updateVendorShippingConfigMock(vendorId, input),
    syncKargonomiWarehouseDetails: (vendorId: string, warehouseId: string) =>
      syncKargonomiWarehouseDetailsMock(vendorId, warehouseId),
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
    refreshShipmentProviderData: (shipmentExecutionId: string, options?: { vendorId?: string | null }) =>
      refreshShipmentProviderDataMock(shipmentExecutionId, options),
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
  operationalActionability: { actionable: true, reason: null },
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
  orderSnapshot: {
    shopifyCreatedAt: '2026-05-15T12:05:00.000Z',
    currency: 'TRY',
    financialStatus: 'paid',
    paymentGatewayName: 'PayTR Marketplace',
    taxesIncluded: true,
    orderTaxAmount: '454.45',
    shippingAmount: '49.90',
    discountAmount: '125.00',
    orderNote: 'Integration note',
    orderTags: ['entegrasyon', 'priority'],
    vendorIntegrationStatus: 'acknowledged',
    vendorIntegrationStatusMessage: 'Order imported into Entegra',
    vendorIntegrationStatusUpdatedAt: '2026-05-15T12:10:00.000Z',
    vendorIntegrationProvider: 'Provider A',
    vendorIntegrationTrackingUrl: 'https://tracking.example/FQ1833-200-41',
    vendorIntegrationShippedAt: '2026-06-02T12:00:00.000Z',
    vendorInvoiceNumber: 'ABC202600001',
    vendorInvoiceDate: '2026-06-02',
    vendorInvoiceUrl: 'https://example.com/invoices/ABC202600001.pdf',
    vendorInvoiceAmount: '4999.00',
    vendorInvoiceReceivedAt: '2026-06-02T12:30:00.000Z',
    shippingAddress: {
      address: 'Shipping street 9',
      city: 'Istanbul',
      district: 'Kadikoy',
      postcode: '34710',
      country: 'TR',
      customerPhonePresent: true,
    },
    billingAddress: {
      fullName: 'Billing Customer',
      company: 'Billing Co',
      phone: '+900000000001',
      city: 'Istanbul',
      district: 'Besiktas',
      address1: 'Billing street 1',
      address2: 'Floor 2',
      postcode: '34330',
    },
  },
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
      shopifyProductId: 'gid://shopify/Product/1028',
      unitPriceVatIncluded: '4999.00',
      lineTotalVatIncluded: '4999.00',
      lineTaxAmount: '454.45',
      vatRate: '10.00',
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

function renderOrderDetail(providedClient?: QueryClient) {
  const queryClient = providedClient ?? new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  const rendered = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/orders/alloc-sporjinal-7621783322961']}>
        <Link to="/orders/alloc-yalispor-2099">Open Vendor B order</Link>
        <Routes>
          <Route path="/orders/:orderId" element={<TestAdminVendorVerifier />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...rendered, queryClient };
}

function buildOrderFinanceDashboard(options: { estimatedPayout?: string; includeProductRefund?: boolean } = {}) {
  const estimatedPayout = options.estimatedPayout ?? 'TRY 4,449.20';
  return {
    summary: {
      grossSales: 'TRY 4,999.00',
      refunds: options.includeProductRefund ? 'TRY 4,999.00' : 'TRY 0.00',
      netRevenue: options.includeProductRefund ? 'TRY 0.00' : 'TRY 4,999.00',
      platformFee: 'TRY 499.90',
      payoutEstimate: estimatedPayout,
    },
    transactions: [
      {
        id: 'finance-sale-1028',
        category: 'Invoice' as const,
        shopifyOrderId: '7616544244049',
        shopifyOrderNumber: '#1028',
        amount: 'TRY 4,999.00',
        date: '2026-05-15T12:08:00.000Z',
        status: 'Pending' as const,
        payoutCalculation: {
          grossAmount: 'TRY 4,999.00',
          commission: 'TRY 499.90',
          commissionVat: 'TRY 99.98',
          shippingDeduction: 'TRY 0.00',
          refundImpact: options.includeProductRefund ? 'TRY 4,999.00' : 'TRY 0.00',
          estimatedPayout,
          shippingApplied: false,
          shippingMode: 'disabled' as const,
        },
      },
      ...(options.includeProductRefund
        ? [{
            id: 'finance-refund-1028',
            category: 'Refund' as const,
            shopifyOrderId: '7616544244049',
            shopifyOrderNumber: '#1028',
            amount: 'TRY 4,999.00',
            date: '2026-05-16T12:08:00.000Z',
            status: 'Recorded' as const,
            payoutCalculation: {
              grossAmount: 'TRY 0.00',
              commission: 'TRY 0.00',
              commissionVat: 'TRY 0.00',
              shippingDeduction: 'TRY 0.00',
              refundImpact: 'TRY 4,999.00',
              estimatedPayout: 'TRY -4,999.00',
              shippingApplied: false,
              shippingMode: 'disabled' as const,
            },
          }]
        : []),
    ],
  };
}

function formatTimelineDateForTest(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function getOrderActivityRow(title: string) {
  const timeline = screen.getByRole('heading', { name: 'Activity' }).closest('article');
  expect(timeline).not.toBeNull();
  const row = within(timeline as HTMLElement).getByText(title).closest('li');
  expect(row).not.toBeNull();
  return row as HTMLElement;
}

function expectRedundantVendorFinanceCopyToBeAbsent(financialSummary: HTMLElement) {
  const summary = within(financialSummary);
  expect(summary.queryByText('Simple payment summary for this order. Detailed deductions are available in Finance.')).not.toBeInTheDocument();
  expect(summary.queryByText('Total value for this order.')).not.toBeInTheDocument();
  expect(summary.queryByText('Commission for this order.')).not.toBeInTheDocument();
  expect(summary.queryByText('Shipping deduction for this order.')).not.toBeInTheDocument();
  expect(summary.queryByText('Estimated amount for this order.')).not.toBeInTheDocument();
}

function expectVendorSupportHelperCopyToBeAbsent(supportCard: HTMLElement) {
  const support = within(supportCard);
  expect(support.queryByText('Create a support ticket before escalating.')).not.toBeInTheDocument();
  expect(
    support.queryByText(
      'A linked support ticket is already open. Escalate only when the existing case needs attention.',
    ),
  ).not.toBeInTheDocument();
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
    rejectOrderMock.mockReset();
    planAllocationSplitMock.mockReset();
    splitAllocationMock.mockReset();
    getShippingProviderDiagnosticsMock.mockReset();
    getShippingProviderDiagnosticsMock.mockImplementation((options?: { provider?: string | null }) => {
      if (options?.provider === 'navlungo') {
        return Promise.resolve({
          provider: 'navlungo',
          supportedProviders: ['hepsijet', 'kargonomi', 'navlungo'],
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
          supportedProviders: ['hepsijet', 'kargonomi'],
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
          supportedProviders: ['hepsijet', 'kargonomi'],
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
        provider: 'kargonomi',
        supportedProviders: ['hepsijet', 'kargonomi'],
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
        receiverAddressAvailability: 'confirmed_required',
        dummyKargoSupport: 'not_implemented',
        statusSyncSupport: 'not_implemented',
        missing: [],
        deprecatedEnvFallbacks: [],
        warnings: ['Kargonomi return/reverse shipment is not implemented.'],
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
    getAdminVendorShippingConfigMock.mockReset();
    const defaultShippingConfig = {
      vendorId: 'sporjinal',
      preferredProvider: 'kargonomi',
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
        kargonomiShippingProviderId: '44',
        kargonomiBuyerStateId: '34',
        kargonomiBuyerCityId: '828',
      },
      source: 'configured',
      updatedAt: '2026-05-15T19:28:50.786Z',
    };
    getVendorShippingConfigMock.mockResolvedValue(defaultShippingConfig);
    getAdminVendorShippingConfigMock.mockResolvedValue(defaultShippingConfig);
    updateVendorShippingConfigMock.mockReset();
    updateVendorShippingConfigMock.mockResolvedValue({
      vendorId: 'sporjinal',
      preferredProvider: 'kargonomi',
      shippingEnabled: true,
      defaultDesi: '3.00',
      cargoIntegrationId: null,
      defaultWarehouseId: '112668',
      shippingVatPercent: '18.00',
      warehouses: [],
      providerMetadata: {
        kargonomiReturnReceiverName: 'Sporjinal return warehouse',
        kargonomiReturnReceiverPhone: '+902121112233',
        kargonomiReturnReceiverAddress: 'Return warehouse address',
        kargonomiBuyerStateId: '34',
        kargonomiBuyerCityId: '828',
      },
      source: 'configured',
      updatedAt: '2026-05-15T19:45:00.000Z',
    });
    syncKargonomiWarehouseDetailsMock.mockReset();
    syncKargonomiWarehouseDetailsMock.mockResolvedValue({
      ok: true,
      provider: 'KARGONOMI',
      mode: 'warehouse_detail_sync',
      vendorId: 'sporjinal',
      warehouseId: '112668',
      writesPerformed: true,
      warehouse: {
        contactNamePresent: true,
        phonePresent: true,
        addressPresent: true,
        stateName: 'Istanbul',
        cityName: 'Kadikoy',
        stateId: '34',
        cityId: '828',
      },
      syncedConfig: {
        vendorId: 'sporjinal',
        preferredProvider: 'kargonomi',
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
            address: 'Synced warehouse address',
            isDefault: true,
            syncStatus: {
              contactNamePresent: true,
              phonePresent: true,
              addressPresent: true,
              stateIdPresent: true,
              cityIdPresent: true,
              stateName: 'Istanbul',
              cityName: 'Kadikoy',
              syncedAt: '2026-06-08T10:00:00.000Z',
              lookupStatus: 'resolved',
              lookupError: null,
            },
          },
        ],
        providerMetadata: {
          kargonomiBuyerStateId: '34',
          kargonomiBuyerCityId: '828',
        },
        source: 'configured',
        updatedAt: '2026-06-08T10:00:00.000Z',
      },
      warnings: [],
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
    refreshShipmentProviderDataMock.mockReset();
    refreshShipmentProviderDataMock.mockResolvedValue({
      ...orderWithShipmentSummary.shipmentExecution,
      provider: 'kargonomi',
      providerCarrierName: 'Sürat Kargo',
      shipmentStatus: 'created',
      providerShipmentId: '2653543',
      trackingNumber: 'KSUR2653543SKDXP',
      barcode: 'data:application/pdf;base64,JVBERi0xLjQ=',
      labelUrl: 'data:application/pdf;base64,JVBERi0xLjQ=',
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

  it('renders the Order Detail frame before primary data and defers provider diagnostics', async () => {
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

    await verifySelectedAdminVendorForTest();
    renderOrderDetail();

    expect(screen.getByLabelText('Order detail render frame')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Order detail' })).toBeInTheDocument();
    expect(screen.getByLabelText('Order summary skeleton')).toBeInTheDocument();
    expect(screen.getByText('Shopify ID')).toBeInTheDocument();
    expect(screen.getByLabelText('Order line item skeleton')).toBeInTheDocument();
    expect(screen.getByLabelText('Order timeline skeleton')).toBeInTheDocument();
    expect(getShippingProviderDiagnosticsMock).not.toHaveBeenCalled();
    expect(getVendorShippingConfigMock).not.toHaveBeenCalled();
  });

  it('hides source identifiers from the vendor loading frame', () => {
    setCurrentUser({
      email: 'vendor@example.com',
      name: 'Vendor User',
      role: 'vendor',
      vendorAccess: ['sporjinal'],
      vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
      canSwitchVendors: false,
      defaultVendorId: 'sporjinal',
    });
    const orderResult = deferred<OrderDetail>();
    getOrderMock.mockReturnValue(orderResult.promise);

    renderOrderDetail();

    const summarySkeleton = screen.getByLabelText('Order summary skeleton');
    expect(summarySkeleton).toBeInTheDocument();
    expect(summarySkeleton).toHaveClass('order-detail-meta-strip-vendor');
    expect(within(summarySkeleton).queryByText('Created')).not.toBeInTheDocument();
    expect(within(summarySkeleton).getByText('Customer')).toBeInTheDocument();
    expect(screen.queryByText('Shopify ID')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Activity' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Timeline' })).not.toBeInTheDocument();
  });

  it('shows a compact operational and fulfillment summary in the vendor header', async () => {
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
      allocationStatus: 'active',
      orderSnapshot: {
        ...orderWithShipmentSummary.orderSnapshot!,
        financialStatus: 'paid',
      },
    });

    renderOrderDetail();

    const currentState = await screen.findByLabelText('Current order state');
    expect(within(currentState).getByText('Active')).toBeInTheDocument();
    expect(within(currentState).getByText('Pending')).toBeInTheDocument();
    expect(within(currentState).queryByText('Operational state')).not.toBeInTheDocument();
    expect(within(currentState).queryByText('Fulfillment')).not.toBeInTheDocument();
    expect(within(currentState).queryByText('Finance projection')).not.toBeInTheDocument();
    expect(within(currentState).queryByText('Next operational action')).not.toBeInTheDocument();
    expect(within(currentState).queryByText('In flow')).not.toBeInTheDocument();
    expect(within(currentState).queryByText('Continue fulfillment')).not.toBeInTheDocument();
    expect(within(currentState).queryByText('Payment Status')).not.toBeInTheDocument();
    expect(within(currentState).queryByText('paid')).not.toBeInTheDocument();
    const alerts = screen.getByLabelText('Operational alerts');
    expect(within(alerts).queryByText('Vendor rejected allocation')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Right panel status')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Activity' })).toBeInTheDocument();
  });

  it.each(['support', 'finance'] as const)('keeps the %s role on the existing non-admin presentation branch without vendor actions', async (role) => {
    setCurrentUser({
      email: `${role}@example.com`,
      name: `${role} user`,
      role,
      vendorAccess: ['sporjinal'],
      vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
      canSwitchVendors: false,
      defaultVendorId: 'sporjinal',
    });
    getOrderMock.mockResolvedValueOnce(orderWithShipmentSummary);

    renderOrderDetail();

    const currentState = await screen.findByLabelText('Current order state');
    expect(within(currentState).getByText('Operational state')).toBeInTheDocument();
    expect(within(currentState).getByText('Finance projection')).toBeInTheDocument();
    expect(within(currentState).getByText('Next operational action')).toBeInTheDocument();
    expect(screen.queryByText('Shopify ID')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Shopify order snapshot')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Order finance preview')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Internal notes' })).not.toBeInTheDocument();
    expect(screen.queryByText('Admin collaboration')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Admin support diagnostics')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create shipment' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add tracking information' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reject full order' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reject selected items' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Contact support' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Escalate' })).not.toBeInTheDocument();
    const header = screen.getByText('Created').closest('.order-detail-topbar');
    expect(header).not.toBeNull();
    expect(within(header as HTMLElement).getByText('Customer')).toBeInTheDocument();
    expect(within(header as HTMLElement).queryByText('Shopify ID')).not.toBeInTheDocument();
  });

  it('labels a normal paid Shopify snapshot with its explicit authority', async () => {
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
      allocationStatus: 'active',
      orderSnapshot: {
        ...orderWithShipmentSummary.orderSnapshot!,
        financialStatus: 'paid',
      },
    });

    renderOrderDetail();

    const snapshot = (await screen.findByLabelText('Shopify order snapshot')) as HTMLDetailsElement;
    expect(snapshot.open).toBe(false);
    expect(within(snapshot).getByText('Shopify financial status')).toBeInTheDocument();
    expect(within(snapshot).getByText('Paid')).toBeInTheDocument();
    expect(within(snapshot).queryByText('Finance state')).not.toBeInTheDocument();
    expect(screen.queryByText('Payment Status')).not.toBeInTheDocument();
  });

  it('does not fabricate a Shopify financial status when the snapshot value is absent', async () => {
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
      orderSnapshot: {
        ...orderWithShipmentSummary.orderSnapshot!,
        financialStatus: null,
      },
    });

    renderOrderDetail();

    const snapshot = await screen.findByLabelText('Shopify order snapshot');
    expect(within(snapshot).queryByText('Shopify financial status')).not.toBeInTheDocument();
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
    expect(screen.queryByText('Cargo integration configured')).not.toBeInTheDocument();
    expect(screen.queryByText('Warehouse configured')).not.toBeInTheDocument();
    expect(screen.getByText('Webhook route implemented')).toBeInTheDocument();
    expect(screen.queryByText('Dummy Kargo support')).not.toBeInTheDocument();
    expect(screen.getByText('Kargonomi return/reverse shipment is not implemented.')).toBeInTheDocument();
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

  it('renders persisted integration snapshot fields without exposing raw Shopify payloads', async () => {
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

    const snapshot = await screen.findByLabelText('Shopify order snapshot');
    const shopifyCard = screen.getByLabelText('Shopify details section');
    expect(within(shopifyCard).getByRole('heading', { name: 'Shopify order snapshot' })).toBeInTheDocument();
    expect(within(shopifyCard).queryByText(/^Shopify details$/i)).not.toBeInTheDocument();
    expect(within(shopifyCard).queryByText('Reference values synced from Shopify.')).not.toBeInTheDocument();
    expect(snapshot).not.toHaveAttribute('open');
    await user.click(within(snapshot).getByText('Show details'));
    expect(snapshot).toHaveAttribute('open');
    expect(within(snapshot).getByText('Full-order Shopify values; not allocation-projected.')).toBeInTheDocument();
    expect(screen.queryByText('This order was split. Tax, shipping, and discount below are full-order Shopify snapshot values.')).not.toBeInTheDocument();
    expect(within(snapshot).getByText('Shopify financial status')).toBeInTheDocument();
    expect(within(snapshot).getByText('Paid')).toBeInTheDocument();
    expect(screen.getByText('PayTR Marketplace')).toBeInTheDocument();
    expect(screen.getByText('TRY')).toBeInTheDocument();
    expect(screen.getByText(/TRY\s*49\.90/)).toBeInTheDocument();
    expect(screen.getByText(/TRY\s*125\.00/)).toBeInTheDocument();
    expect(screen.getAllByText(/TRY\s*454\.45/).length).toBeGreaterThan(0);
    expect(screen.getByText('Shipping address')).toBeInTheDocument();
    expect(screen.getByText(/Shipping street 9/)).toBeInTheDocument();
    expect(screen.getByText(/Kadikoy/)).toBeInTheDocument();
    expect(screen.getByText(/34710/)).toBeInTheDocument();
    expect(screen.queryByText('Used for shipment destination.')).not.toBeInTheDocument();
    expect(screen.queryByText('Shipping address is invalid or incomplete. Kargonomi shipment will be blocked.')).not.toBeInTheDocument();
    expect(screen.getByText('Billing address')).toBeInTheDocument();
    expect(screen.getByText(/Billing Customer/)).toBeInTheDocument();
    expect(screen.getByText(/Billing street 1/)).toBeInTheDocument();
    expect(screen.queryByText('Used for billing/invoice reference.')).not.toBeInTheDocument();
    expect(screen.getAllByText('Integration note').length).toBeGreaterThan(0);
    expect(screen.getByText('entegrasyon, priority')).toBeInTheDocument();
    expect(screen.getByText('acknowledged')).toBeInTheDocument();
    expect(screen.getByText('Order imported into Entegra')).toBeInTheDocument();
    expect(screen.getByText('Provider A')).toBeInTheDocument();
    expect(screen.getByText('External shipment')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open external tracking' })).toHaveAttribute('href', 'https://tracking.example/FQ1833-200-41');
    expect(screen.getByText('External shipped at')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Vendor Invoice' })).toBeInTheDocument();
    expect(screen.getByText('ABC202600001')).toBeInTheDocument();
    expect(screen.getByText('2026-06-02')).toBeInTheDocument();
    expect(screen.getAllByText(/TRY\s*4,999\.00/).length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'Open invoice' })).toHaveAttribute('href', 'https://example.com/invoices/ABC202600001.pdf');
    expect(screen.getByText(/VAT 10%/)).toBeInTheDocument();
    expect(screen.getByText(/VAT amount TRY\s*454\.45/)).toBeInTheDocument();
    expect(screen.getByText(/Unit price incl\. VAT TRY\s*4,999\.00/)).toBeInTheDocument();
    expect(screen.getByText(/Line total incl\. VAT TRY\s*4,999\.00/)).toBeInTheDocument();
    expect(screen.getByText(/Shopify product gid:\/\/shopify\/Product\/1028/)).toBeInTheDocument();
    expect(screen.queryByText(/rawPayload/i)).not.toBeInTheDocument();
  });

  it('shows split-specific Shopify snapshot scope copy on split order detail', async () => {
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
      splitSummary: {
        sourceAllocationId: orderWithShipmentSummary.id,
        childAllocationId: 'alloc-child-1028',
        reason: 'OUT_OF_STOCK',
        note: null,
        actorName: null,
        lineageRole: 'source',
        movedItems: [],
      },
    });

    renderOrderDetail();

    const snapshot = await screen.findByLabelText('Shopify order snapshot');
    const shopifyCard = screen.getByLabelText('Shopify details section');
    expect(within(shopifyCard).getByRole('heading', { name: 'Shopify order snapshot' })).toBeInTheDocument();
    expect(snapshot).not.toHaveAttribute('open');
    expect(within(snapshot).getByText('Full-order Shopify values; not allocation-projected.')).toBeInTheDocument();
    expect(within(snapshot).getByText('This order was split. Tax, shipping, and discount below are full-order Shopify snapshot values.')).toBeInTheDocument();
    expect(within(snapshot).getByText('Vendor integration')).toBeInTheDocument();
    expect(within(snapshot).getByText('Tax total')).toBeInTheDocument();
    expect(within(snapshot).getByText('Shipping amount')).toBeInTheDocument();
    expect(within(snapshot).getByText('Discount amount')).toBeInTheDocument();
  });

  it('renders duplicate shipping district only once when the address already contains it as a segment', async () => {
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
      orderSnapshot: {
        ...orderWithShipmentSummary.orderSnapshot,
        shippingAddress: {
          address: 'Çınar Mahallesi Orhan Sokak 1/3, Maltepe',
          city: 'İstanbul',
          district: 'Maltepe',
          postcode: '34841',
          country: 'TR',
          customerPhonePresent: false,
        },
      },
    });

    renderOrderDetail();

    expect(await screen.findByRole('heading', { name: 'Shopify order snapshot' })).toBeInTheDocument();
    const shippingAddressRow = screen.getByText('Shipping address').closest('div');
    expect(shippingAddressRow).toHaveTextContent('Çınar Mahallesi Orhan Sokak 1/3, Maltepe · İstanbul · 34841 · TR');
    expect(shippingAddressRow).not.toHaveTextContent('Maltepe · Maltepe');
    expect((shippingAddressRow?.textContent?.match(/Maltepe/g) ?? []).length).toBe(1);
  });

  it('renders shipping district when it is absent from the composed address', async () => {
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
      orderSnapshot: {
        ...orderWithShipmentSummary.orderSnapshot,
        shippingAddress: {
          address: 'Çınar Mahallesi Orhan Sokak 1/3/1',
          city: 'İstanbul',
          district: 'Maltepe',
          postcode: '34841',
          country: 'TR',
          customerPhonePresent: false,
        },
      },
    });

    renderOrderDetail();

    expect(await screen.findByRole('heading', { name: 'Shopify order snapshot' })).toBeInTheDocument();
    const shippingAddressRow = screen.getByText('Shipping address').closest('div');
    expect(shippingAddressRow).toHaveTextContent('Çınar Mahallesi Orhan Sokak 1/3/1 · Maltepe · İstanbul · 34841 · TR');
  });

  it('keeps shipping address display unchanged when district is null', async () => {
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
      orderSnapshot: {
        ...orderWithShipmentSummary.orderSnapshot,
        shippingAddress: {
          address: 'Çınar Mahallesi Orhan Sokak 1/3/1',
          city: 'İstanbul',
          district: null,
          postcode: '34841',
          country: 'TR',
          customerPhonePresent: false,
        },
      },
    });

    renderOrderDetail();

    expect(await screen.findByRole('heading', { name: 'Shopify order snapshot' })).toBeInTheDocument();
    const shippingAddressRow = screen.getByText('Shipping address').closest('div');
    expect(shippingAddressRow).toHaveTextContent('Çınar Mahallesi Orhan Sokak 1/3/1 · İstanbul · 34841 · TR');
  });

  it('warns when persisted shipping address is invalid for Kargonomi destination', async () => {
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
      orderSnapshot: {
        ...orderWithShipmentSummary.orderSnapshot,
        shippingAddress: {
          address: 'NA, NA NA',
          city: 'NA',
          district: null,
          postcode: null,
          country: 'TR',
          customerPhonePresent: false,
        },
      },
    });

    renderOrderDetail();

    expect(await screen.findByRole('heading', { name: 'Shopify order snapshot' })).toBeInTheDocument();
    const snapshot = screen.getByLabelText('Shopify order snapshot') as HTMLDetailsElement;
    const blocker = screen.getByLabelText('Shopify shipping blocker');
    expect(snapshot.open).toBe(false);
    expect(snapshot).not.toContainElement(blocker);
    expect(screen.getByText('Shipping address')).toBeInTheDocument();
    expect(screen.getByText(/NA, NA NA/)).toBeInTheDocument();
    expect(screen.getByText('Shipping address is invalid or incomplete. Kargonomi shipment will be blocked.')).toBeInTheDocument();
    expect(screen.getByText(/Billing Customer/)).toBeInTheDocument();
  });

  it('renders missing optional integration snapshot fields safely', async () => {
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
      orderSnapshot: {
        shopifyCreatedAt: null,
        currency: null,
        financialStatus: null,
        paymentGatewayName: null,
        taxesIncluded: null,
        orderTaxAmount: null,
        shippingAmount: null,
        discountAmount: null,
        orderNote: null,
        orderTags: [],
        vendorIntegrationStatus: null,
        vendorIntegrationStatusMessage: null,
        vendorIntegrationStatusUpdatedAt: null,
        vendorIntegrationProvider: null,
        vendorIntegrationTrackingUrl: null,
        vendorIntegrationShippedAt: null,
        vendorInvoiceNumber: null,
        vendorInvoiceDate: null,
        vendorInvoiceUrl: null,
        vendorInvoiceAmount: null,
        vendorInvoiceReceivedAt: null,
        shippingAddress: {
          address: null,
          city: null,
          district: null,
          postcode: null,
          country: null,
          customerPhonePresent: false,
        },
        billingAddress: {
          fullName: null,
          company: null,
          phone: null,
          city: null,
          district: null,
          address1: null,
          address2: null,
          postcode: null,
        },
      },
      lineItems: orderWithShipmentSummary.lineItems.map((item) => ({
        ...item,
        unitPriceVatIncluded: null,
        lineTotalVatIncluded: null,
        lineTaxAmount: null,
        vatRate: null,
      })),
    });

    renderOrderDetail();

    expect(await screen.findByRole('heading', { name: 'Shopify order snapshot' })).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    expect(screen.queryByText('Integration note')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Vendor Invoice' })).not.toBeInTheDocument();
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

    const fulfillmentSection = (await screen.findByRole('heading', { name: 'Fulfillment' })).closest('article') as HTMLElement;
    expect(fulfillmentSection).not.toBeNull();
    expect(within(fulfillmentSection).getByText('Shipment provider')).toBeInTheDocument();
    expect(within(fulfillmentSection).getByText('Carrier status')).toBeInTheDocument();
    expect(within(fulfillmentSection).queryByText('Carrier, tracking, label, and Shopify sync controls.')).not.toBeInTheDocument();
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
  }, 10000);

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

    expect(await screen.findByRole('button', { name: 'Cancel shipment' })).toBeInTheDocument();
    const fulfillmentSection = screen.getByRole('heading', { name: 'Fulfillment' }).closest('article') as HTMLElement;
    expect(fulfillmentSection).not.toBeNull();
    expect(within(fulfillmentSection).getByRole('heading', { name: 'Shipment details' })).toBeInTheDocument();
    expect(within(fulfillmentSection).getAllByText('Carrier').length).toBeGreaterThan(0);
    expect(within(fulfillmentSection).getByRole('button', { name: 'Refresh shipment status' })).toBeInTheDocument();
    expect(within(fulfillmentSection).queryByText('Carrier, tracking, and label details.')).not.toBeInTheDocument();
    expect(within(fulfillmentSection).queryByText('Refresh the latest carrier status for this shipment.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel Navlungo shipment' })).not.toBeInTheDocument();
    expect(screen.queryByText('Update Navlungo shipment')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('District *')).not.toBeInTheDocument();
  });

  it('hides empty and duplicate vendor shipment details while preserving primary shipment information', async () => {
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
      carrier: 'Navlungo',
      trackingNumber: 'NAV-1028',
      trackingUrl: 'https://tracking.navlungo.test/NAV-1028',
      shipmentExecution: {
        ...orderWithShipmentSummary.shipmentExecution!,
        provider: 'navlungo',
        providerShipmentId: 'NAV-1028',
        trackingNumber: 'NAV-1028',
        trackingUrl: 'https://tracking.navlungo.test/NAV-1028',
        labelUrl: 'barcode-pdf',
        barcode: null,
        shipmentStatus: 'created',
        providerResponseSummary: undefined,
      },
    });

    const { container } = renderOrderDetail();

    const primaryDetails = await screen.findByRole('heading', { name: 'Shipment details' });
    const fulfillmentSection = primaryDetails.closest('article') as HTMLElement;
    const primarySummary = fulfillmentSection.querySelector('.order-tracking-summary-card') as HTMLElement;
    const currentState = screen.getByLabelText('Current order state');
    expect(within(currentState).getByText('Active')).toBeInTheDocument();
    expect(within(currentState).getByText('Pending')).toBeInTheDocument();
    expect(within(currentState).queryByText('Shipment created')).not.toBeInTheDocument();
    expect(within(currentState).queryByText('NAV-1028')).not.toBeInTheDocument();
    expect(within(primarySummary).getByText('Carrier')).toBeInTheDocument();
    expect(within(primarySummary).getByText('Shipment created')).toBeInTheDocument();
    expect(within(primarySummary).getByText('NAV-1028')).toBeInTheDocument();
    expect(within(primarySummary).getByRole('link', { name: 'Open tracking' })).toBeInTheDocument();
    expect(within(primarySummary).getByRole('button', { name: 'Open label PDF' })).toBeInTheDocument();
    expect(screen.queryByText('Additional shipment details')).not.toBeInTheDocument();
    expect(container.querySelector('.shipment-provider-details')).toBeNull();
  });

  it('hides Navlungo carrier tracking when it matches primary tracking', async () => {
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
      trackingNumber: 'NAV-1028',
      trackingUrl: 'https://tracking.navlungo.test/NAV-1028',
      shipmentExecution: {
        ...orderWithShipmentSummary.shipmentExecution!,
        provider: 'navlungo',
        providerShipmentId: 'NAV-1028',
        trackingNumber: 'NAV-1028',
        trackingUrl: 'https://tracking.navlungo.test/NAV-1028',
        barcode: null,
        providerResponseSummary: {
          ...orderWithShipmentSummary.shipmentExecution!.providerResponseSummary!,
          navlungoCarrierTrackingCode: 'NAV-1028',
          navlungoCarrierTrackingUrl: 'https://tracking.navlungo.test/NAV-1028',
        },
      },
    });

    renderOrderDetail();

    const shipmentDetailsHeading = await screen.findByRole('heading', { name: 'Shipment details' });
    const shipmentPanel = shipmentDetailsHeading.closest('.vendor-action-panel') as HTMLElement;
    const primarySummary = shipmentPanel.querySelector('.order-tracking-summary-card') as HTMLElement;
    expect(within(primarySummary).getByText('NAV-1028')).toBeInTheDocument();
    expect(screen.queryByText('Carrier tracking')).not.toBeInTheDocument();
    expect(screen.queryByText('Additional shipment details')).not.toBeInTheDocument();
  });

  it('keeps only meaningful distinct Navlungo secondary details for vendors', async () => {
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
      carrier: 'Navlungo',
      trackingNumber: 'NAV-1028',
      trackingUrl: 'https://tracking.navlungo.test/NAV-1028',
      shipmentExecution: {
        ...orderWithShipmentSummary.shipmentExecution!,
        provider: 'navlungo',
        providerShipmentId: 'NAV-1028',
        trackingNumber: 'NAV-1028',
        trackingUrl: 'https://tracking.navlungo.test/NAV-1028',
        labelUrl: 'barcode-pdf',
        barcode: null,
        shipmentStatus: 'in_transit',
        providerResponseSummary: {
          ...orderWithShipmentSummary.shipmentExecution!.providerResponseSummary!,
          navlungoProviderStatusName: 'In Transit',
          navlungoCarrierTrackingCode: 'CARRIER-1028',
          navlungoCarrierTrackingUrl: 'https://carrier.example/CARRIER-1028',
          navlungoPickedUpDate: '2026-05-22T09:00:00.000Z',
          navlungoBarcodeStatus: 'created',
          navlungoGeoStatus: 'verified',
          navlungoGeoBadAddress: true,
        },
      },
    });

    renderOrderDetail();

    const detailsSummary = await screen.findByText('Additional shipment details');
    const details = detailsSummary.closest('details') as HTMLElement;
    expect(screen.getAllByText('Shipment progress')).toHaveLength(1);
    expect(within(details).queryByText('Carrier')).not.toBeInTheDocument();
    expect(within(details).queryByText('Shipment progress')).not.toBeInTheDocument();
    expect(within(details).queryByText('Barcode status')).not.toBeInTheDocument();
    expect(within(details).queryByText('Address intelligence')).not.toBeInTheDocument();
    expect(within(details).getByRole('link', { name: 'CARRIER-1028' })).toHaveAttribute(
      'href',
      'https://carrier.example/CARRIER-1028',
    );
    expect(within(details).getByText('Lifecycle dates')).toBeInTheDocument();
    expect(screen.getAllByText('Carrier reported address validation issue.')).toHaveLength(1);
  });

  it('preserves a unique non-placeholder vendor barcode as meaningful secondary information', async () => {
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
      carrier: 'Try OTO',
      trackingNumber: 'OTO-TRACK-1028',
      shipmentExecution: {
        ...orderWithShipmentSummary.shipmentExecution!,
        provider: 'try_oto',
        providerShipmentId: 'OTO-SHIP-1028',
        trackingNumber: 'OTO-TRACK-1028',
        barcode: 'OTO-BARCODE-1028',
        labelUrl: null,
        providerResponseSummary: undefined,
      },
    });

    renderOrderDetail();

    const detailsSummary = await screen.findByText('Additional shipment details');
    const details = detailsSummary.closest('details') as HTMLElement;
    expect(within(details).getByText('Barcode')).toBeInTheDocument();
    expect(within(details).getByText('OTO-BARCODE-1028')).toBeInTheDocument();
    expect(within(details).queryByText('Lifecycle dates')).not.toBeInTheDocument();
    expect(within(details).queryByText('Barcode status')).not.toBeInTheDocument();
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
    const timeline = screen.getByRole('heading', { name: 'Activity' }).closest('article');
    expect(timeline).not.toBeNull();
    const shipmentUpdatedEvent = within(timeline as HTMLElement).getByText('Shipment updated');
    expect(shipmentUpdatedEvent).toBeInTheDocument();
    expect(within(shipmentUpdatedEvent.closest('li') as HTMLElement).queryByText('Updated')).not.toBeInTheDocument();
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
    const timeline = screen.getByRole('heading', { name: 'Activity' }).closest('article');
    expect(timeline).not.toBeNull();
    const shipmentCancelledEvent = within(timeline as HTMLElement).getByText('Shipment cancelled');
    expect(shipmentCancelledEvent).toBeInTheDocument();
    expect(within(shipmentCancelledEvent.closest('li') as HTMLElement).queryByText('Cancelled')).not.toBeInTheDocument();
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
    const timeline = screen.getByRole('heading', { name: 'Activity' }).closest('article');
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
      shippingStatus: 'Label Created',
      shipmentCreatedAt: '2026-05-15T19:39:00.000Z',
      carrier: 'Navlungo',
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
    const timeline = screen.getByRole('heading', { name: 'Activity' }).closest('article');
    expect(timeline).not.toBeNull();
    expect(within(timeline as HTMLElement).queryByText(/webhook/i)).not.toBeInTheDocument();
    expect(within(timeline as HTMLElement).queryByText(/provider status/i)).not.toBeInTheDocument();
    expect(within(timeline as HTMLElement).queryByText(/SearchingDriver/i)).not.toBeInTheDocument();
    expect(within(timeline as HTMLElement).queryByText(/reverseShipment/i)).not.toBeInTheDocument();
    expect(within(timeline as HTMLElement).queryByText(/Tracking pending/i)).not.toBeInTheDocument();
    expect(within(timeline as HTMLElement).getByText('Order created')).toBeInTheDocument();
    const orderCreatedRow = getOrderActivityRow('Order created');
    expect(orderCreatedRow).toHaveTextContent(formatTimelineDateForTest(orderWithShipmentSummary.date));
    expect(orderCreatedRow).not.toHaveTextContent('entered the vendor workspace');
    const shipmentCreatedRow = getOrderActivityRow('Shipment created');
    expect(shipmentCreatedRow).toHaveTextContent('Carrier: Navlungo');
    expect(shipmentCreatedRow).toHaveTextContent(formatTimelineDateForTest('2026-05-15T19:39:00.000Z'));
    expect(within(shipmentCreatedRow).queryByText('Label Created')).not.toBeInTheDocument();
    expect(shipmentCreatedRow.querySelector('.op-badge')).toBeNull();
    expect(Boolean(orderCreatedRow.compareDocumentPosition(shipmentCreatedRow) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(within(timeline as HTMLElement).queryByText(/^Timeline$/)).not.toBeInTheDocument();
    expect(within(timeline as HTMLElement).queryByRole('heading', { name: 'Order activity' })).not.toBeInTheDocument();
    expect(within(timeline as HTMLElement).queryByText('Order, shipment, return, and support activity.')).not.toBeInTheDocument();
  });

  it('keeps delivered as current fulfillment state and a separate event without attaching it to shipment creation', async () => {
    setCurrentUser({
      email: 'vendor@example.com',
      name: 'Vendor User',
      role: 'vendor',
      vendorAccess: ['sporjinal'],
      vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
      canSwitchVendors: false,
      defaultVendorId: 'sporjinal',
    });
    const shipmentCreatedAt = '2026-05-15T19:39:00.000Z';
    const shipmentUpdatedAt = '2026-05-15T19:45:00.000Z';
    const deliveredAt = '2026-05-15T20:00:00.000Z';
    getOrderMock.mockResolvedValueOnce({
      ...orderWithShipmentSummary,
      shippingStatus: 'Delivered',
      shipmentCreatedAt,
      shipmentUpdatedAt,
      fulfilledAt: deliveredAt,
      carrier: 'Sürat Kargo',
      trackingNumber: 'SURAT-1028',
      trackingUrl: 'https://tracking.example/SURAT-1028',
      shipmentExecution: {
        ...orderWithShipmentSummary.shipmentExecution!,
        provider: 'try_oto',
        providerCarrierName: 'Sürat Kargo',
        shipmentStatus: 'delivered',
        trackingNumber: 'SURAT-1028',
        trackingUrl: 'https://tracking.example/SURAT-1028',
        lastProviderResponseAt: deliveredAt,
      },
    });

    renderOrderDetail();

    const shipmentCreatedRow = await screen.findByText('Shipment created').then(() => getOrderActivityRow('Shipment created'));
    expect(shipmentCreatedRow).toHaveTextContent('Carrier: Sürat Kargo');
    expect(shipmentCreatedRow).toHaveTextContent(formatTimelineDateForTest(shipmentCreatedAt));
    expect(within(shipmentCreatedRow).queryByText('Delivered')).not.toBeInTheDocument();
    expect(shipmentCreatedRow.querySelector('.op-badge')).toBeNull();

    const trackingSyncedRow = getOrderActivityRow('Tracking synced');
    expect(trackingSyncedRow).toHaveTextContent('Sürat Kargo / SURAT-1028');
    expect(trackingSyncedRow.querySelector('small')).toHaveTextContent(/^—$/);
    const deliveredRow = getOrderActivityRow('Delivered');
    expect(deliveredRow.querySelector('small')).toHaveTextContent(/^—$/);
    expect(deliveredRow).not.toHaveTextContent('Carrier delivery is confirmed.');
    expect(deliveredRow).toHaveTextContent('Delivery observation time unavailable or unverified.');
    const fulfillment = screen.getByRole('heading', { name: 'Fulfillment' }).closest('article');
    expect(fulfillment).not.toBeNull();
    expect(within(fulfillment as HTMLElement).getByText('Status').parentElement).toHaveTextContent('Delivered');
    expect(Boolean(shipmentCreatedRow.compareDocumentPosition(trackingSyncedRow) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(Boolean(trackingSyncedRow.compareDocumentPosition(deliveredRow) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  });

  it('omits the redundant shipment-created fallback when carrier detail is unavailable', async () => {
    setCurrentUser({
      email: 'vendor@example.com',
      name: 'Vendor User',
      role: 'vendor',
      vendorAccess: ['sporjinal'],
      vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
      canSwitchVendors: false,
      defaultVendorId: 'sporjinal',
    });
    const shipmentCreatedAt = '2026-05-15T19:39:00.000Z';
    getOrderMock.mockResolvedValueOnce({
      ...orderWithoutShipment,
      shippingStatus: 'Label Created',
      shipmentCreatedAt,
      carrier: undefined,
    });

    renderOrderDetail();

    const orderCreatedRow = await screen.findByText('Order created').then(() => getOrderActivityRow('Order created'));
    const shipmentCreatedRow = getOrderActivityRow('Shipment created');
    expect(shipmentCreatedRow).toHaveTextContent(formatTimelineDateForTest(shipmentCreatedAt));
    expect(shipmentCreatedRow).not.toHaveTextContent('Shipment record is available.');
    expect(shipmentCreatedRow.querySelector('p')).toBeNull();
    expect(shipmentCreatedRow.querySelector('.op-badge')).toBeNull();
    expect(Boolean(orderCreatedRow.compareDocumentPosition(shipmentCreatedRow) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
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

  it('compacts vendor header metadata with structured shipping and distinct billing addresses', async () => {
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
      shippingAddress: 'Shopify shipping address available in future detail sync.',
    });

    renderOrderDetail();

    const heading = await screen.findByRole('heading', { name: 'Order #1028' });
    const header = heading.closest('.order-detail-topbar');
    expect(header).not.toBeNull();
    const allocationCreatedAt = new Intl.DateTimeFormat('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(orderWithShipmentSummary.date));
    const shopifyCreatedAt = new Intl.DateTimeFormat('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(orderWithShipmentSummary.orderSnapshot!.shopifyCreatedAt!));
    const headerRegion = within(header as HTMLElement);
    const metadata = (header as HTMLElement).querySelector('.order-detail-meta-strip');

    expect(metadata).toHaveClass('order-detail-meta-strip-vendor');
    expect(headerRegion.getByText(allocationCreatedAt)).toBeInTheDocument();
    expect(headerRegion.queryByText(shopifyCreatedAt)).not.toBeInTheDocument();
    expect(headerRegion.queryByText('Created')).not.toBeInTheDocument();
    expect(headerRegion.getByText('Customer')).toBeInTheDocument();
    expect(headerRegion.getByText('Ada Lovelace')).toBeInTheDocument();
    const shippingSummary = headerRegion.getByLabelText('Shipping address summary');
    expect(shippingSummary).toHaveTextContent('Ship to');
    expect(shippingSummary).toHaveTextContent('Shipping street 9 · Kadikoy · Istanbul · 34710 · TR');
    expect(shippingSummary).not.toHaveTextContent('Ada Lovelace');
    expect(headerRegion.queryByText('Shopify shipping address available in future detail sync.')).not.toBeInTheDocument();
    expect(headerRegion.queryByText('Phone present')).not.toBeInTheDocument();
    const billingSummary = headerRegion.getByLabelText('Billing address summary');
    expect(billingSummary).toHaveTextContent('Billing address');
    expect(billingSummary).toHaveTextContent('Billing street 1 · Floor 2 · Besiktas · Istanbul · 34330');
    expect(billingSummary).not.toHaveTextContent('Shipping street 9');
    expect(headerRegion.queryByText('Billing Customer')).not.toBeInTheDocument();
    expect(headerRegion.queryByText('Billing Co')).not.toBeInTheDocument();
    expect(headerRegion.queryByText('+900000000001')).not.toBeInTheDocument();
    const currentState = headerRegion.getByLabelText('Current order state');
    expect(within(currentState).getByText('Active')).toBeInTheDocument();
    expect(within(currentState).getByText('Pending')).toBeInTheDocument();
  });

  it('shows a vendor shipping address once when billing has the same normalized address', async () => {
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
      orderSnapshot: {
        ...orderWithShipmentSummary.orderSnapshot!,
        shippingAddress: {
          address: '  Same Street 9  ',
          city: 'ISTANBUL',
          district: 'Kadikoy',
          postcode: '34710',
          country: 'TR',
          customerPhonePresent: false,
        },
        billingAddress: {
          fullName: 'Private Billing Name',
          company: null,
          phone: null,
          address1: 'same street 9',
          address2: null,
          city: 'istanbul',
          district: 'kadikoy',
          postcode: '34710',
        },
      },
    });

    renderOrderDetail();

    const header = (await screen.findByRole('heading', { name: 'Order #1028' })).closest('.order-detail-topbar');
    expect(header).not.toBeNull();
    const headerRegion = within(header as HTMLElement);
    expect(headerRegion.getByLabelText('Shipping address summary')).toHaveTextContent(
      'Same Street 9 · Kadikoy · ISTANBUL · 34710 · TR',
    );
    expect(headerRegion.queryByLabelText('Billing address summary')).not.toBeInTheDocument();
    expect(headerRegion.queryByText('Private Billing Name')).not.toBeInTheDocument();
  });

  it('omits vendor billing when the structured billing address is missing', async () => {
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
      orderSnapshot: {
        ...orderWithShipmentSummary.orderSnapshot!,
        billingAddress: {
          fullName: null,
          company: null,
          phone: null,
          address1: null,
          address2: null,
          city: null,
          district: null,
          postcode: null,
        },
      },
    });

    renderOrderDetail();

    const header = (await screen.findByRole('heading', { name: 'Order #1028' })).closest('.order-detail-topbar');
    const headerRegion = within(header as HTMLElement);
    expect(headerRegion.getByLabelText('Shipping address summary')).toHaveTextContent('Shipping street 9');
    expect(headerRegion.queryByLabelText('Billing address summary')).not.toBeInTheDocument();
  });

  it('omits placeholder billing while keeping the valid vendor shipping address', async () => {
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
      orderSnapshot: {
        ...orderWithShipmentSummary.orderSnapshot!,
        billingAddress: {
          fullName: null,
          company: null,
          phone: null,
          address1: 'N/A',
          address2: null,
          city: 'NA',
          district: null,
          postcode: null,
        },
      },
    });

    renderOrderDetail();

    const header = (await screen.findByRole('heading', { name: 'Order #1028' })).closest('.order-detail-topbar');
    const headerRegion = within(header as HTMLElement);
    expect(headerRegion.getByLabelText('Shipping address summary')).toHaveTextContent('Shipping street 9');
    expect(headerRegion.queryByLabelText('Billing address summary')).not.toBeInTheDocument();
    expect(headerRegion.queryByText(/^NA$|^N\/A$/)).not.toBeInTheDocument();
  });

  it.each(['', 'NA', 'N/A'])('omits vendor address rows for invalid shipping address %j', async (invalidAddress) => {
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
      shippingAddress: 'Shopify shipping address available in future detail sync.',
      orderSnapshot: {
        ...orderWithShipmentSummary.orderSnapshot!,
        shippingAddress: {
          address: invalidAddress,
          city: invalidAddress,
          district: null,
          postcode: null,
          country: 'TR',
          customerPhonePresent: false,
        },
      },
    });

    renderOrderDetail();

    const header = (await screen.findByRole('heading', { name: 'Order #1028' })).closest('.order-detail-topbar');
    const headerRegion = within(header as HTMLElement);
    expect(headerRegion.queryByLabelText('Shipping address summary')).not.toBeInTheDocument();
    expect(headerRegion.queryByLabelText('Billing address summary')).not.toBeInTheDocument();
    expect(headerRegion.queryByText('Shopify shipping address available in future detail sync.')).not.toBeInTheDocument();
    expect(headerRegion.queryByText(/^NA$|^N\/A$/)).not.toBeInTheDocument();
  });

  it('deduplicates a district already embedded in the vendor shipping address', async () => {
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
      orderSnapshot: {
        ...orderWithShipmentSummary.orderSnapshot!,
        shippingAddress: {
          address: 'Çınar Mahallesi Orhan Sokak 1/3, Maltepe',
          city: 'İstanbul',
          district: 'Maltepe',
          postcode: '34841',
          country: 'TR',
          customerPhonePresent: false,
        },
      },
    });

    renderOrderDetail();

    const header = (await screen.findByRole('heading', { name: 'Order #1028' })).closest('.order-detail-topbar');
    const shippingSummary = within(header as HTMLElement).getByLabelText('Shipping address summary');
    expect(shippingSummary).toHaveTextContent('Çınar Mahallesi Orhan Sokak 1/3, Maltepe · İstanbul · 34841 · TR');
    expect((shippingSummary.textContent?.match(/Maltepe/g) ?? []).length).toBe(1);
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

    const heading = await screen.findByRole('heading', { name: 'Order #1028' });
    expect(heading).toBeInTheDocument();
    const header = heading.closest('.order-detail-topbar');
    expect(header).not.toBeNull();
    expect(within(header as HTMLElement).getByText('Created')).toBeInTheDocument();
    expect(within(header as HTMLElement).getByText('Customer')).toBeInTheDocument();
    expect(within(header as HTMLElement).getByText('Vendor')).toBeInTheDocument();
    expect(within(header as HTMLElement).getByText('Shopify ID')).toBeInTheDocument();
    expect(within(header as HTMLElement).getByLabelText('Shipping address summary')).toHaveTextContent(
      'Shipping address will appear when available.',
    );
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
    getFinanceDashboardMock.mockResolvedValueOnce({
      summary: {
        grossSales: 'TRY 4,999.00',
        refunds: 'TRY 0.00',
        netRevenue: 'TRY 4,449.20',
        platformFee: 'TRY 499.90',
        payoutEstimate: 'TRY 4,449.20',
      },
      transactions: [
        {
          id: 'finance-sale-1028',
          category: 'Invoice',
          shopifyOrderId: '7616544244049',
          shopifyOrderNumber: '#1028',
          amount: 'TRY 4,999.00',
          date: '2026-05-15T12:08:00.000Z',
          status: 'Pending review',
          payoutCalculation: {
            grossAmount: 'TRY 4,999.00',
            commission: 'TRY 499.90',
            shippingDeduction: 'TRY 49.90',
            estimatedPayout: 'TRY 4,449.20',
            shippingCostStatus: 'confirmed',
          },
        },
        {
          id: 'finance-refund-1028',
          category: 'Refund',
          shopifyOrderId: '7616544244049',
          shopifyOrderNumber: '#1028',
          amount: 'TRY 0.00',
          date: '2026-05-15T12:08:00.000Z',
          status: 'Recorded',
          payoutCalculation: {
            refundImpact: 'TRY 0.00',
          },
        },
      ],
    });

    renderOrderDetail();

    const currentState = await screen.findByLabelText('Current order state');
    expect(within(currentState).getByText('Active')).toBeInTheDocument();
    expect(within(currentState).getByText('Pending')).toBeInTheDocument();
    expect(within(currentState).queryByText('Operational state')).not.toBeInTheDocument();
    expect(within(currentState).queryByText('Fulfillment')).not.toBeInTheDocument();
    expect(within(currentState).queryByText('Finance projection')).not.toBeInTheDocument();
    expect(within(currentState).queryByText('Next operational action')).not.toBeInTheDocument();
    expect(within(currentState).queryByText('In flow')).not.toBeInTheDocument();
    expect(within(currentState).queryByText('Continue fulfillment')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Primary operational status')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Operational alerts')).toBeInTheDocument();
    expect(screen.getByText('Tracking missing')).toBeInTheDocument();
    expect(screen.getByText('Awaiting shipment')).toBeInTheDocument();
    expect(screen.queryByText('Tracking is not visible to the operational workspace yet.')).not.toBeInTheDocument();
    expect(screen.queryByText('Create shipment or add tracking when the package is ready.')).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Order detail sections' })).not.toBeInTheDocument();
    expect(screen.queryByText('Operational summary')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Context' })).not.toBeInTheDocument();
    expect(screen.queryByText(/^Context$/)).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Guided Operations/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/^Guided Operations$/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Overview' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Overview' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Fulfillment' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Items/ })).toBeInTheDocument();
    const itemsSection = screen.getByRole('heading', { name: /Items/ }).closest('article') as HTMLElement;
    const financialSummary = screen.getByLabelText('Order financial summary');
    expect(within(financialSummary).getByRole('heading', { name: 'Order financial summary' })).toBeInTheDocument();
    expect(within(financialSummary).getByText('Gross Allocation Amount')).toBeInTheDocument();
    expect(within(financialSummary).queryByText('Gross Order Amount')).not.toBeInTheDocument();
    expect(within(financialSummary).getByText('TRY 4,999.00')).toBeInTheDocument();
    expect(await within(financialSummary).findByText('Commission')).toBeInTheDocument();
    expect(within(financialSummary).getByText('Commission')).toBeInTheDocument();
    expect(within(financialSummary).getByText('TRY 499.90')).toBeInTheDocument();
    expect(within(financialSummary).getByText('Shipping Deduction')).toBeInTheDocument();
    expect(within(financialSummary).getByText('TRY 49.90')).toBeInTheDocument();
    expect(within(financialSummary).getByText('Refund Impact')).toBeInTheDocument();
    expect(within(financialSummary).getByText('TRY 0.00')).toBeInTheDocument();
    expect(within(financialSummary).getByText('Estimated Earnings')).toBeInTheDocument();
    expect(within(financialSummary).getByText('TRY 4,449.20')).toBeInTheDocument();
    expect(within(financialSummary).getByText('Refund activity linked to this order.')).toBeInTheDocument();
    expectRedundantVendorFinanceCopyToBeAbsent(financialSummary);
    expect(within(financialSummary).queryByText('Payment status')).not.toBeInTheDocument();
    const shipmentSection = screen.getByRole('heading', { name: 'Fulfillment' }).closest('article') as HTMLElement;
    expect(Boolean(itemsSection.compareDocumentPosition(financialSummary) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(Boolean(financialSummary.compareDocumentPosition(shipmentSection) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(screen.queryByRole('heading', { name: 'Settlement preview' })).not.toBeInTheDocument();
    expect(screen.queryByText('Gross order amount')).not.toBeInTheDocument();
    expect(screen.queryByText('Estimated settlement')).not.toBeInTheDocument();
    expect(screen.queryByText('Commission estimate')).not.toBeInTheDocument();
    expect(screen.queryByText('Shipping deduction')).not.toBeInTheDocument();
    expect(screen.queryByText('Shipping cost status')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Linked records' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Fulfillment' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Vendor actions' })).not.toBeInTheDocument();
    expect(screen.queryByText('Shipment, tracking, and return controls for this order.')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Activity' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Timeline' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Support' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Provider response summary')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Shipping provider diagnostics')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Shipment timeline')).not.toBeInTheDocument();
    expect(screen.queryByText('Provider returned no shipment identifiers.')).not.toBeInTheDocument();
    expect(screen.queryByText('SHIPPING_EXECUTION_ENABLED')).not.toBeInTheDocument();
    expect(screen.queryByText('Endpoint:')).not.toBeInTheDocument();
    expect(screen.queryByText('Shipment recovery')).not.toBeInTheDocument();
  });

  it('hides negative Estimated Earnings after a posted full product refund', async () => {
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
      refundRecordCount: 1,
    });
    getFinanceDashboardMock.mockResolvedValueOnce(buildOrderFinanceDashboard({
      estimatedPayout: 'TRY -599.88',
      includeProductRefund: true,
    }));

    renderOrderDetail();

    const financialSummary = await screen.findByLabelText('Order financial summary');
    expect(within(financialSummary).getByText('Gross Allocation Amount')).toBeInTheDocument();
    expect(await within(financialSummary).findByText('Commission')).toBeInTheDocument();
    expect(within(financialSummary).getByText('Refund Impact')).toBeInTheDocument();
    expect(within(financialSummary).getAllByText('TRY 4,999.00')).toHaveLength(2);
    expect(within(financialSummary).queryByText('Estimated Earnings')).not.toBeInTheDocument();
    expect(within(financialSummary).queryByText('TRY -599.88')).not.toBeInTheDocument();
  });

  it('keeps an unknown shipping deduction out of the vendor financial summary', async () => {
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
        grossSales: 'TRY 4,999.00',
        refunds: 'TRY 0.00',
        netRevenue: 'TRY 4,449.20',
        platformFee: 'TRY 499.90',
        payoutEstimate: 'TRY 4,449.20',
      },
      transactions: [
        {
          id: 'finance-sale-unknown-shipping-1028',
          category: 'Invoice',
          shopifyOrderId: '7616544244049',
          shopifyOrderNumber: '#1028',
          amount: 'TRY 4,999.00',
          date: '2026-05-15T12:08:00.000Z',
          status: 'Pending review',
          payoutCalculation: {
            grossAmount: 'TRY 4,999.00',
            commission: 'TRY 499.90',
            shippingDeduction: 'TRY 0.00',
            estimatedPayout: 'TRY 4,449.20',
            shippingCostStatus: 'pending_provider_cost',
          },
        },
      ],
    });

    renderOrderDetail();

    const financialSummary = await screen.findByLabelText('Order financial summary');
    expect(within(financialSummary).getByText('Gross Allocation Amount')).toBeInTheDocument();
    expect(await within(financialSummary).findByText('Commission')).toBeInTheDocument();
    expect(within(financialSummary).getByText('Estimated Earnings')).toBeInTheDocument();
    expect(within(financialSummary).queryByText('Shipping Deduction')).not.toBeInTheDocument();
    expect(within(financialSummary).queryByText('TRY 0.00')).not.toBeInTheDocument();
    expectRedundantVendorFinanceCopyToBeAbsent(financialSummary);
  });

  it('keeps refund finance presentation without inferring terminal operational closure', async () => {
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
      allocationStatus: 'vendor_blocked',
      cancellationReason: 'OUT_OF_STOCK',
      cancelRefundReviewStatus: 'RESOLVED',
      refundRecordCount: 1,
      latestOutboundRefundAttemptStatus: 'RESOLVED',
      fulfillmentStatus: 'Pending',
      shippingStatus: 'Awaiting Shipment',
      shipmentExecution: null,
    });
    getFinanceDashboardMock.mockResolvedValueOnce(buildOrderFinanceDashboard({
      estimatedPayout: 'TRY -599.88',
      includeProductRefund: true,
    }));

    renderOrderDetail();

    const financialSummary = await screen.findByLabelText('Order financial summary');
    expect(within(financialSummary).queryByText('Estimated Earnings')).not.toBeInTheDocument();
    expect(await within(financialSummary).findByText('Refund Impact')).toBeInTheDocument();
    expect(within(financialSummary).getByText('Refund completed for this order.')).toBeInTheDocument();
    expectRedundantVendorFinanceCopyToBeAbsent(financialSummary);
    const currentState = screen.getByLabelText('Current order state');
    expect(within(currentState).getByText('Vendor Blocked')).toBeInTheDocument();
    expect(within(currentState).getByText('Awaiting admin resolution')).toBeInTheDocument();
    expect(within(currentState).queryByText('Held')).not.toBeInTheDocument();
    expect(within(currentState).queryByText('Review allocation')).not.toBeInTheDocument();
    expect(within(currentState).queryByText('Refunded')).not.toBeInTheDocument();
  });

  it('hides Estimated Earnings for resolved shipping refund evidence without inferring terminality', async () => {
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
      allocationStatus: 'vendor_blocked',
      cancellationReason: 'OUT_OF_STOCK',
      cancelRefundReviewStatus: 'RESOLVED',
      refundRecordCount: 0,
      latestOutboundRefundAttemptStatus: 'RESOLVED',
      fulfillmentStatus: 'Pending',
      shippingStatus: 'Awaiting Shipment',
      shipmentExecution: null,
    });
    getFinanceDashboardMock.mockResolvedValueOnce(buildOrderFinanceDashboard());

    renderOrderDetail();

    const financialSummary = await screen.findByLabelText('Order financial summary');
    expect(within(financialSummary).getByText('Gross Allocation Amount')).toBeInTheDocument();
    expect(within(financialSummary).queryByText('Estimated Earnings')).not.toBeInTheDocument();
    const axes = screen.getByLabelText('Current order state');
    expect(within(axes).getByText('Vendor Blocked')).toBeInTheDocument();
    expect(within(axes).queryByText('Refunded')).not.toBeInTheDocument();
  });

  it('keeps Estimated Earnings for a non-terminal return without posted refund evidence', async () => {
    setCurrentUser({
      email: 'vendor@example.com',
      name: 'Vendor User',
      role: 'vendor',
      vendorAccess: ['sporjinal'],
      vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
      canSwitchVendors: false,
      defaultVendorId: 'sporjinal',
    });
    listReturnsMock.mockResolvedValueOnce([{
      id: 'return-1028',
      relatedOrderId: orderWithShipmentSummary.id,
      sourceShopifyOrderId: orderWithShipmentSummary.sourceShopifyOrderId,
      sourceShopifyOrderNumber: orderWithShipmentSummary.sourceShopifyOrderNumber,
      date: '2026-05-16T12:08:00.000Z',
      status: 'Requested',
    }]);
    getFinanceDashboardMock.mockResolvedValueOnce(buildOrderFinanceDashboard());

    renderOrderDetail();

    const financialSummary = await screen.findByLabelText('Order financial summary');
    expect(await within(financialSummary).findByText('Estimated Earnings')).toBeInTheDocument();
    expect(within(financialSummary).getByText('TRY 4,449.20')).toBeInTheDocument();
  });

  it('shows selected item rejection on detail for multi-line rejectable allocations', async () => {
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
      lineItemCount: 2,
      fulfilledAt: undefined,
      shipmentCreatedAt: undefined,
      shipmentUpdatedAt: undefined,
      trackingNumber: undefined,
      trackingUrl: undefined,
      carrier: undefined,
      shipmentExecution: undefined,
      lineItems: [
        {
          ...orderWithShipmentSummary.lineItems[0],
          trackingNumber: undefined,
          trackingUrl: undefined,
          carrier: undefined,
        },
        {
          ...orderWithShipmentSummary.lineItems[0],
          id: 'line-1028-extra',
          sku: 'FQ1833-200-42',
          variantTitle: '42',
          name: 'Nike Air Max Alpha Trainer 6 - size 42',
          trackingNumber: undefined,
          trackingUrl: undefined,
          carrier: undefined,
        },
      ],
      items: [],
    });

    renderOrderDetail();

    const orderIssue = await screen.findByLabelText('Order issue');
    expect(within(orderIssue).getByRole('heading', { name: 'Order issue' })).toBeInTheDocument();
    expect(within(orderIssue).queryByText('Unavailable items')).not.toBeInTheDocument();
    expect(within(orderIssue).queryByText('Reject selected items or send the full order to admin review.')).not.toBeInTheDocument();
    expect(within(orderIssue).getByRole('button', { name: 'Reject selected items' })).toBeInTheDocument();
    expect(within(orderIssue).getByRole('button', { name: 'Reject full order' })).toBeInTheDocument();
    const shipmentSection = screen.getByRole('heading', { name: 'Fulfillment' }).closest('article') as HTMLElement;
    expect(within(shipmentSection).queryByRole('button', {
      name: 'Reject selected items',
    })).not.toBeInTheDocument();
    const rail = screen.getByLabelText('Order timeline and support');
    expect(rail).toContainElement(orderIssue);
    expect(
      shipmentSection.compareDocumentPosition(orderIssue) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    await user.click(within(orderIssue).getByRole('button', { name: 'Reject selected items' }));

    const splitDialog = screen.getByRole('dialog', { name: 'Reject selected items' });
    expect(splitDialog).toBeInTheDocument();
    await user.click(within(splitDialog).getByRole('button', { name: 'Close reject selected items form' }));

    await user.click(within(orderIssue).getByRole('button', { name: 'Reject full order' }));

    const fullOrderDialog = screen.getByRole('dialog', { name: 'Reject order' });
    expect(within(fullOrderDialog).getByText('This will block fulfillment and send the order to Sporgym admin review.')).toBeInTheDocument();
    expect(within(fullOrderDialog).getByLabelText('Reason')).toBeInTheDocument();
    expect(within(fullOrderDialog).getByLabelText('Note')).toBeInTheDocument();
    expect(within(fullOrderDialog).getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(within(fullOrderDialog).getByRole('button', { name: 'Reject order' })).toBeInTheDocument();
  });

  it('lets a vendor reject the full order from the detail right panel', async () => {
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
    const rejectableOrder = {
      ...orderWithoutShipment,
      fulfilledAt: undefined,
      shipmentCreatedAt: undefined,
      shipmentUpdatedAt: undefined,
      trackingNumber: undefined,
      trackingUrl: undefined,
      carrier: undefined,
    };
    getOrderMock.mockResolvedValue(rejectableOrder);
    rejectOrderMock.mockResolvedValue({
      ...rejectableOrder,
      allocationStatus: 'vendor_blocked',
      reassignmentRequired: true,
      cancellationReason: 'DAMAGED_INVENTORY',
      fulfillmentActionAvailable: false,
    });

    renderOrderDetail();

    const orderIssue = await screen.findByLabelText('Order issue');
    expect(within(orderIssue).queryByRole('button', { name: 'Reject selected items' })).not.toBeInTheDocument();
    await user.click(within(orderIssue).getByRole('button', { name: 'Reject full order' }));

    const dialog = screen.getByRole('dialog', { name: 'Reject order' });
    await user.selectOptions(within(dialog).getByLabelText('Reason'), 'DAMAGED_INVENTORY');
    await user.type(within(dialog).getByLabelText('Note'), 'Damaged box on shelf');
    await user.click(within(dialog).getByRole('button', { name: 'Reject order' }));

    await waitFor(() =>
      expect(rejectOrderMock).toHaveBeenCalledWith(
        rejectableOrder.id,
        {
          reason: 'DAMAGED_INVENTORY',
          note: 'Damaged box on shelf',
        },
        expect.objectContaining({ vendorId: 'sporjinal' }),
      ),
    );
    expect(await screen.findByText('Order rejected and sent to admin review.')).toBeInTheDocument();
  });

  it('frames vendor-blocked orders as admin-resolution work instead of shipment work', async () => {
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
      allocationStatus: 'vendor_blocked',
      cancellationReason: 'OUT_OF_STOCK',
      reassignmentRequired: true,
      fulfillmentStatus: 'Pending',
      shippingStatus: 'Awaiting Shipment',
      shipmentExecution: null,
      assignmentHistory: [
        {
          action: 'vendor_blocked',
          fromVendorId: 'sporjinal',
          toVendorId: 'sporjinal',
          reason: 'OUT_OF_STOCK',
          actorName: 'Vendor User',
          actorRole: 'vendor',
          createdAt: '2026-05-15T12:12:00.000Z',
        },
      ],
    });

    renderOrderDetail();

    expect((await screen.findAllByText('Vendor Blocked')).length).toBeGreaterThan(0);
    const currentState = screen.getByLabelText('Current order state');
    expect(within(currentState).getByText('Vendor Blocked')).toBeInTheDocument();
    expect(within(currentState).getByText('Awaiting admin resolution')).toBeInTheDocument();
    expect(within(currentState).queryByText('Operational state')).not.toBeInTheDocument();
    expect(within(currentState).queryByText('Fulfillment')).not.toBeInTheDocument();
    expect(within(currentState).queryByText('Finance projection')).not.toBeInTheDocument();
    expect(within(currentState).queryByText('Next operational action')).not.toBeInTheDocument();
    expect(within(currentState).queryByText('Blocked')).not.toBeInTheDocument();
    expect(within(currentState).queryByText('Held')).not.toBeInTheDocument();
    expect(within(currentState).queryByText('Review allocation')).not.toBeInTheDocument();
    expect(within(currentState).queryByText('Payment Status')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Primary operational status')).not.toBeInTheDocument();

    const alerts = screen.getByLabelText('Operational alerts');
    expect(alerts.querySelectorAll('.order-operational-alert')).toHaveLength(1);
    expect(within(alerts).getByText('Vendor rejected allocation')).toBeInTheDocument();
    expect(within(alerts).getByText('Reason: Out of stock. Admin resolution required.')).toBeInTheDocument();
    expect(within(alerts).queryByText('OUT_OF_STOCK')).not.toBeInTheDocument();
    expect(within(alerts).queryByText('Tracking missing')).not.toBeInTheDocument();
    expect(within(alerts).queryByText('Awaiting shipment')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Right panel status')).not.toBeInTheDocument();
    expect(screen.queryByText('Add shipment details when the package is ready.')).not.toBeInTheDocument();

    const financialSummary = screen.getByLabelText('Order financial summary');
    expect(within(financialSummary).getByText('Gross Allocation Amount')).toBeInTheDocument();
    expectRedundantVendorFinanceCopyToBeAbsent(financialSummary);

    const fulfillmentSection = screen.getByRole('heading', { name: 'Fulfillment' }).closest('article');
    expect(fulfillmentSection).not.toBeNull();
    const shipmentRequirement = within(fulfillmentSection as HTMLElement).getByLabelText('Shipment requirement state');
    expect(shipmentRequirement).toHaveTextContent('Blocked');
    expect(shipmentRequirement).not.toHaveTextContent('Shipment work is paused until the allocation is resolved.');
    expect(shipmentRequirement.parentElement).toHaveClass('vendor-blocked-panel');
    expect(shipmentRequirement.parentElement).not.toHaveClass('order-fulfillment-complete-panel');
    expect(screen.queryByRole('button', { name: 'Create shipment' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reject selected items' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reject full order' })).not.toBeInTheDocument();

    expect(screen.queryByText('Current state')).not.toBeInTheDocument();
    expect(screen.queryByText('Finance')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Order finance preview')).not.toBeInTheDocument();

    const timeline = screen.getByRole('heading', { name: 'Activity' }).closest('article');
    expect(timeline).not.toBeNull();
    const timelineScope = within(timeline as HTMLElement);
    const rejectedEvent = timelineScope.getByText('Vendor rejected selected items');
    const blockedEvent = timelineScope.getByText('Order blocked from shipment');
    const financeHoldEvent = timelineScope.getByText('Order review started');
    const adminResolutionEvent = timelineScope.getByText('Awaiting admin resolution');
    expect(rejectedEvent.closest('li')).toHaveTextContent('Reason: Out of stock.');
    expect(rejectedEvent.closest('li')).not.toHaveTextContent('OUT_OF_STOCK');
    expect(within(rejectedEvent.closest('li') as HTMLElement).queryByText('Rejected')).not.toBeInTheDocument();
    expect(blockedEvent.closest('li')).not.toHaveTextContent('Fulfillment is blocked for this order assignment.');
    expect(within(blockedEvent.closest('li') as HTMLElement).queryByText('Blocked')).not.toBeInTheDocument();
    expect(timelineScope.getByText('Settlement and payout movement are held until admin resolution.')).toBeInTheDocument();
    expect(within(financeHoldEvent.closest('li') as HTMLElement).queryByText('Held')).not.toBeInTheDocument();
    expect(adminResolutionEvent.closest('li')).not.toHaveTextContent('Transfer order assignment, refund review, or return to vendor.');
    expect(within(adminResolutionEvent.closest('li') as HTMLElement).queryByText('Action required')).not.toBeInTheDocument();
    expect(Boolean(rejectedEvent.compareDocumentPosition(blockedEvent) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(Boolean(blockedEvent.compareDocumentPosition(financeHoldEvent) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(Boolean(financeHoldEvent.compareDocumentPosition(adminResolutionEvent) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  });

  it('uses the latest recorded reject time and never falls back to order creation time', async () => {
    setCurrentUser({
      email: 'vendor@example.com',
      name: 'Vendor User',
      role: 'vendor',
      vendorAccess: ['sporjinal'],
      vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
      canSwitchVendors: false,
      defaultVendorId: 'sporjinal',
    });
    const firstRejectAt = '2026-05-15T10:00:00.000Z';
    const latestRejectAt = '2026-05-15T15:00:00.000Z';
    getOrderMock.mockResolvedValueOnce({
      ...orderWithShipmentSummary,
      allocationStatus: 'vendor_blocked',
      cancellationReason: 'OUT_OF_STOCK',
      reassignmentRequired: true,
      assignmentHistory: [
        { action: 'vendor_blocked', fromVendorId: 'sporjinal', toVendorId: 'sporjinal', actorName: 'Vendor user', actorRole: 'vendor', createdAt: firstRejectAt },
        { action: 'admin_returned_to_vendor', fromVendorId: 'sporjinal', toVendorId: 'sporjinal', actorName: 'Admin user', actorRole: 'admin', createdAt: '2026-05-15T11:00:00.000Z' },
        { action: 'vendor_blocked', fromVendorId: 'sporjinal', toVendorId: 'sporjinal', actorName: 'Vendor user', actorRole: 'vendor', createdAt: latestRejectAt },
      ],
    });

    renderOrderDetail();

    await screen.findByText('Order blocked from shipment');
    const row = getOrderActivityRow('Order blocked from shipment');
    expect(row).toHaveTextContent(formatTimelineDateForTest(latestRejectAt));
    expect(row).not.toHaveTextContent(formatTimelineDateForTest(firstRejectAt));

    cleanup();
    getOrderMock.mockResolvedValueOnce({
      ...orderWithShipmentSummary,
      allocationStatus: 'vendor_blocked',
      cancellationReason: 'OUT_OF_STOCK',
      reassignmentRequired: true,
      assignmentHistory: [],
    });
    renderOrderDetail();
    await screen.findByText('Order blocked from shipment');
    expect(getOrderActivityRow('Order blocked from shipment')).not.toHaveTextContent(formatTimelineDateForTest(orderWithShipmentSummary.date));
  });

  it('keeps local Held finance state separate from a paid Shopify snapshot', async () => {
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
      allocationStatus: 'vendor_blocked',
      cancellationReason: 'OUT_OF_STOCK',
      reassignmentRequired: true,
      fulfillmentStatus: 'Pending',
      shippingStatus: 'Awaiting Shipment',
      shipmentExecution: null,
      orderSnapshot: {
        ...orderWithShipmentSummary.orderSnapshot!,
        financialStatus: 'paid',
      },
    });

    renderOrderDetail();

    const axes = await screen.findByLabelText('Current order state');
    expect(within(axes).getByText('Finance projection')).toBeInTheDocument();
    expect(within(axes).getByText('Held')).toBeInTheDocument();
    expect(within(axes).queryByText('Paid')).not.toBeInTheDocument();

    const snapshot = screen.getByLabelText('Shopify order snapshot');
    expect(within(snapshot).getByText('Shopify financial status')).toBeInTheDocument();
    expect(within(snapshot).getByText('Paid')).toBeInTheDocument();
    expect(screen.queryByText('Payment Status')).not.toBeInTheDocument();

    expect(document.querySelector('.order-status-summary-grid')).not.toBeInTheDocument();
    expect(within(axes).getByText('Fulfillment')).toBeInTheDocument();
    expect(within(axes).getByText('Next operational action')).toBeInTheDocument();
    expect(within(axes).getByText('Vendor Blocked')).toBeInTheDocument();
    expect(within(axes).getByText('Blocked')).toBeInTheDocument();
    expect(within(axes).getByText('Held')).toBeInTheDocument();
    expect(within(axes).getByText('Review allocation')).toBeInTheDocument();
    expect(screen.queryByLabelText('Right panel status')).not.toBeInTheDocument();
  });

  it('keeps vendor-blocked operational state while retaining refund finance evidence', async () => {
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
      allocationStatus: 'vendor_blocked',
      cancellationReason: 'vendor_cancelled',
      reassignmentRequired: true,
      cancelRefundReviewStatus: 'RESOLVED',
      refundRecordCount: 1,
      latestOutboundRefundAttemptStatus: 'RESOLVED',
      fulfillmentStatus: 'Pending',
      shippingStatus: 'Awaiting Shipment',
      shipmentExecution: null,
      assignmentHistory: [
        {
          action: 'vendor_blocked',
          fromVendorId: 'sporjinal',
          toVendorId: 'sporjinal',
          reason: 'vendor_cancelled',
          actorName: 'Vendor User',
          actorRole: 'vendor',
          createdAt: '2026-05-15T12:12:00.000Z',
        },
      ],
    });

    renderOrderDetail();

    await screen.findByText('Vendor Blocked');
    const currentState = screen.getByLabelText('Current order state');
    expect(within(currentState).getByText('Vendor Blocked')).toBeInTheDocument();
    expect(within(currentState).getByText('Awaiting admin resolution')).toBeInTheDocument();
    expect(within(currentState).queryByText('Operational state')).not.toBeInTheDocument();
    expect(within(currentState).queryByText('Fulfillment')).not.toBeInTheDocument();
    expect(within(currentState).queryByText('Finance projection')).not.toBeInTheDocument();
    expect(within(currentState).queryByText('Next operational action')).not.toBeInTheDocument();
    expect(within(currentState).queryByText('Blocked')).not.toBeInTheDocument();
    expect(within(currentState).queryByText('Held')).not.toBeInTheDocument();
    expect(within(currentState).queryByText('Review allocation')).not.toBeInTheDocument();
    expect(within(currentState).queryByText('Refunded')).not.toBeInTheDocument();
    expect(within(currentState).queryByText('Payment Status')).not.toBeInTheDocument();

    const alerts = screen.getByLabelText('Operational alerts');
    expect(within(alerts).getByText('Vendor rejected allocation')).toBeInTheDocument();
    expect(within(alerts).getByText(/Admin resolution required/i)).toBeInTheDocument();

    expect(screen.queryByLabelText('Primary operational status')).not.toBeInTheDocument();

    const shipmentRequirement = screen.getByLabelText('Shipment requirement state');
    expect(shipmentRequirement).toHaveTextContent('Blocked');
    expect(shipmentRequirement).not.toHaveTextContent('Shipment work is paused');
    expect(shipmentRequirement.parentElement).toHaveClass('vendor-blocked-panel');
    expect(shipmentRequirement.parentElement).not.toHaveClass('order-fulfillment-complete-panel');
    expect(screen.queryByRole('button', { name: 'Create shipment' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry shipment' })).not.toBeInTheDocument();

    expect(screen.queryByLabelText('Order finance preview')).not.toBeInTheDocument();

    const timeline = screen.getByRole('heading', { name: 'Activity' }).closest('article');
    expect(timeline).not.toBeNull();
    const timelineScope = within(timeline as HTMLElement);
    const rejectedEvent = timelineScope.getByText('Vendor rejected selected items');
    expect(rejectedEvent).toBeInTheDocument();
    expect(rejectedEvent.closest('li')).toHaveTextContent('Reason: Vendor cancelled.');
    expect(rejectedEvent.closest('li')).not.toHaveTextContent('vendor_cancelled');
    expect(timelineScope.queryByText('Refund processed')).not.toBeInTheDocument();
    expect(timelineScope.queryByText('Refund completed')).not.toBeInTheDocument();
    expect(timelineScope.getByText('Order review started')).toBeInTheDocument();
    expect(timelineScope.getByText('Awaiting admin resolution')).toBeInTheDocument();
  });

  it('keeps a terminal allocation detail visible while removing shipment, tracking, reject, and split actions', async () => {
    setCurrentUser({
      email: 'vendor@example.com',
      name: 'Vendor User',
      role: 'vendor',
      vendorAccess: ['sporjinal'],
      vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
      canSwitchVendors: false,
      defaultVendorId: 'sporjinal',
    });
    const terminalOrder: OrderDetail = {
      ...orderWithoutShipment,
      sourceShopifyOrderNumber: '#1128',
      allocationStatus: 'active',
      fulfillmentStatus: 'Pending',
      shippingStatus: 'Awaiting Shipment',
      operationalActionability: {
        actionable: false,
        reason: 'ALLOCATION_REFUND_TERMINAL',
      },
      fulfillmentActionAvailable: false,
      fulfilledAt: undefined,
      shipmentCreatedAt: undefined,
      shipmentUpdatedAt: undefined,
      trackingNumber: undefined,
      trackingUrl: undefined,
      carrier: undefined,
      refundRecordCount: 0,
      lineItemCount: 2,
      lineItems: [
        orderWithShipmentSummary.lineItems[0],
        {
          ...orderWithShipmentSummary.lineItems[0],
          id: 'line-terminal-second',
          sku: 'TERMINAL-SECOND',
        },
      ],
      timeline: [{ label: 'Order received', at: '2026-09-06T10:00:00.000Z' }],
    };
    getOrderMock.mockResolvedValueOnce(terminalOrder);

    renderOrderDetail();

    expect(await screen.findByRole('heading', { name: 'Order #1128' })).toBeInTheDocument();
    const currentState = screen.getByLabelText('Current order state');
    expect(within(currentState).getByText('Refunded')).toBeInTheDocument();
    expect(within(currentState).getByText('Fulfillment not required')).toBeInTheDocument();
    expect(within(currentState).getByText('No action required')).toBeInTheDocument();
    expect(within(currentState).queryByText('Operational state')).not.toBeInTheDocument();
    expect(within(currentState).queryByText('Fulfillment')).not.toBeInTheDocument();
    expect(within(currentState).queryByText('Finance projection')).not.toBeInTheDocument();
    expect(within(currentState).queryByText('Next operational action')).not.toBeInTheDocument();
    expect(within(currentState).queryByText('Refund completed')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Primary operational status')).not.toBeInTheDocument();
    expect(document.querySelector('.order-status-summary-grid')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Operational alerts')).not.toBeInTheDocument();
    expect(screen.getAllByText('Refunded').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Fulfillment not required').length).toBeGreaterThan(0);
    const financialSummary = screen.getByLabelText('Order financial summary');
    expect(within(financialSummary).getByText('Gross Allocation Amount')).toBeInTheDocument();
    expectRedundantVendorFinanceCopyToBeAbsent(financialSummary);
    expect(screen.queryByText('Add shipment details when the package is ready.')).not.toBeInTheDocument();
    const shipmentRequirement = screen.getByLabelText('Shipment requirement state');
    const shipmentSection = screen.getByRole('heading', { name: 'Fulfillment' }).closest('article');
    expect(shipmentSection).not.toBeNull();
    expect(screen.queryByRole('heading', { name: 'Shipment & delivery' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Shipment' })).not.toBeInTheDocument();
    expect(within(shipmentSection as HTMLElement).queryByText('Shipment work is closed for the refunded allocation.')).not.toBeInTheDocument();
    expect(within(shipmentSection as HTMLElement).queryByText('No shipment is required for this order.')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Fulfillment' }).parentElement?.querySelector('p')).toBeNull();
    expect(shipmentRequirement).toHaveTextContent('Fulfillment not required');
    expect(shipmentRequirement).not.toHaveTextContent('Shipment work is closed for the refunded allocation.');
    expect(shipmentRequirement.parentElement).toHaveClass('order-fulfillment-complete-panel');
    expect(shipmentRequirement.parentElement).toHaveClass('order-fulfillment-terminal-panel');
    expect(shipmentRequirement.parentElement).not.toHaveClass('vendor-blocked-panel');
    const fulfillmentActionRequirement = within(shipmentSection as HTMLElement).getByLabelText('Fulfillment action requirement');
    expect(fulfillmentActionRequirement).toHaveTextContent('No operational action required');
    expect(fulfillmentActionRequirement).not.toHaveTextContent('No shipment is required for this order.');
    expect(screen.getAllByText('Nike Air Max Alpha Trainer 6')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Create shipment' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add tracking information' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reject selected items' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reject full order' })).not.toBeInTheDocument();
    expect(planAllocationSplitMock).not.toHaveBeenCalled();
    expect(splitAllocationMock).not.toHaveBeenCalled();
    expect(submitFulfillmentTrackingMock).not.toHaveBeenCalled();
    expect(createShipmentExecutionMock).not.toHaveBeenCalled();
    const timeline = screen.getByRole('heading', { name: 'Activity' }).closest('article');
    expect(timeline).not.toBeNull();
    expect(within(timeline as HTMLElement).queryByText(/^Timeline$/)).not.toBeInTheDocument();
    expect(within(timeline as HTMLElement).queryByText('Order, shipment, return, and support activity.')).not.toBeInTheDocument();
    const refundCompletedEvent = within(timeline as HTMLElement).getByText('Refund completed');
    const fulfillmentClosedEvent = within(timeline as HTMLElement).getByText('Fulfillment not required');
    expect(within(refundCompletedEvent.closest('li') as HTMLElement).queryByText('Completed')).not.toBeInTheDocument();
    expect(refundCompletedEvent.closest('li')).not.toHaveTextContent('authoritatively closed after a full refund');
    expect(refundCompletedEvent.closest('li')?.querySelector('small')).toBeInTheDocument();
    expect(within(fulfillmentClosedEvent.closest('li') as HTMLElement).queryByText('Closed')).not.toBeInTheDocument();
    expect(fulfillmentClosedEvent.closest('li')).not.toHaveTextContent('Shipment work is closed for the refunded');
    expect(fulfillmentClosedEvent.closest('li')?.querySelector('small')).toBeInTheDocument();
    expect(Boolean(refundCompletedEvent.compareDocumentPosition(fulfillmentClosedEvent) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(terminalOrder.allocationStatus).toBe('active');
    expect(terminalOrder.fulfillmentStatus).toBe('Pending');
    expect(terminalOrder.shippingStatus).toBe('Awaiting Shipment');
  });

  it('shows one compact terminal-refund summary to admins without duplicate success surfaces', async () => {
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
      ...orderWithoutShipment,
      sourceShopifyOrderNumber: '#1128',
      allocationStatus: 'active',
      fulfillmentStatus: 'Pending',
      shippingStatus: 'Awaiting Shipment',
      operationalActionability: {
        actionable: false,
        reason: 'ALLOCATION_REFUND_TERMINAL',
      },
      fulfillmentActionAvailable: false,
      shipmentExecution: null,
      trackingNumber: undefined,
      trackingUrl: undefined,
      carrier: undefined,
      timeline: [{ label: 'Order received', at: '2026-09-06T10:00:00.000Z' }],
    });

    renderOrderDetail();

    const currentState = await screen.findByLabelText('Current order state');
    expect(within(currentState).getByText('Refunded')).toBeInTheDocument();
    expect(within(currentState).getByText('Fulfillment not required')).toBeInTheDocument();
    expect(within(currentState).getByText('No action required')).toBeInTheDocument();
    expect(within(currentState).queryByText('Operational state')).not.toBeInTheDocument();
    expect(within(currentState).queryByText('Fulfillment')).not.toBeInTheDocument();
    expect(within(currentState).queryByText('Finance projection')).not.toBeInTheDocument();
    expect(within(currentState).queryByText('Next operational action')).not.toBeInTheDocument();
    expect(within(currentState).queryByText('Refund completed')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Primary operational status')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Operational alerts')).not.toBeInTheDocument();
    expect(document.querySelector('.order-status-summary-grid')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Fulfillment' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Shipment & delivery' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Shipment' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create shipment' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add tracking information' })).not.toBeInTheDocument();
    const timeline = screen.getByRole('heading', { name: 'Activity' }).closest('article');
    expect(timeline).not.toBeNull();
    expect(within(timeline as HTMLElement).getByText('Refund completed')).toBeInTheDocument();
    expect(within(timeline as HTMLElement).getByText('Fulfillment not required')).toBeInTheDocument();
    expect(within(timeline as HTMLElement).queryByText('Completed')).not.toBeInTheDocument();
    expect(within(timeline as HTMLElement).queryByText('Closed')).not.toBeInTheDocument();
    expect(within(timeline as HTMLElement).queryByText(/authoritatively closed after a full refund/i)).not.toBeInTheDocument();
    expect(within(timeline as HTMLElement).queryByText(/Shipment work is closed for the refunded/i)).not.toBeInTheDocument();
  });

  it('keeps refund finance presentation separate from non-terminal operational status', async () => {
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
      allocationStatus: 'vendor_blocked',
      cancellationReason: 'OUT_OF_STOCK',
      cancelRefundReviewStatus: 'RESOLVED',
      refundRecordCount: 1,
      latestOutboundRefundAttemptStatus: 'RESOLVED',
      fulfillmentStatus: 'Pending',
      shippingStatus: 'Awaiting Shipment',
      shipmentExecution: null,
      financeLedgerPreview: {
        status: 'ready',
        currency: 'TRY',
        entries: [],
        balance: {
          grossSales: '4999.00',
          marketplaceCommission: '499.90',
          vendorPayable: '0.00',
          shippingCostReserved: '0.00',
          vendorDebt: '0.00',
          netVendorPosition: '-599.88',
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
          refundCount: 1,
          commissionProfile: 'configured',
          shippingCost: 'confirmed',
          payoutAlreadyPaid: false,
        },
      },
    });
    getFinanceDashboardMock.mockResolvedValueOnce(buildOrderFinanceDashboard({
      estimatedPayout: 'TRY -599.88',
      includeProductRefund: true,
    }));

    renderOrderDetail();

    const axes = await screen.findByLabelText('Current order state');
    expect(within(axes).getByText('Finance projection')).toBeInTheDocument();
    expect(within(axes).getByText('Held')).toBeInTheDocument();
    expect(within(axes).getByText('Vendor Blocked')).toBeInTheDocument();
    expect(within(axes).queryByText('Refund completed')).not.toBeInTheDocument();

    const snapshot = screen.getByLabelText('Shopify order snapshot');
    expect(within(snapshot).getByText('Shopify financial status')).toBeInTheDocument();
    expect(within(snapshot).getByText('Paid')).toBeInTheDocument();
    expect(within(snapshot).queryByText('Refunded')).not.toBeInTheDocument();

    const financePreview = await screen.findByLabelText('Order finance preview');
    expect(within(financePreview).getByRole('heading', { name: 'Refund completed' })).toBeInTheDocument();
    const monetaryRows = financePreview.querySelector('.order-finance-preview-grid') as HTMLElement;
    expect(monetaryRows).not.toBeNull();
    expect(within(monetaryRows).queryByText('Refund completed')).not.toBeInTheDocument();
    expect(within(monetaryRows).queryByText('Estimated settlement')).not.toBeInTheDocument();
    expect(monetaryRows).not.toHaveTextContent(/TRY\s*-599\.88/);
    expect(within(financePreview).getByText('Refund impact recorded.')).toBeInTheDocument();
  });

  it('uses canonical Shopify cancellation time instead of order creation time', async () => {
    setCurrentUser({
      email: 'vendor@example.com',
      name: 'Vendor User',
      role: 'vendor',
      vendorAccess: ['sporjinal'],
      vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
      canSwitchVendors: false,
      defaultVendorId: 'sporjinal',
    });
    const orderCreatedAt = '2026-07-11T16:07:00.000Z';
    const cancelledAt = '2026-07-11T21:23:00.000Z';
    getOrderMock.mockResolvedValueOnce({
      ...orderWithShipmentSummary,
      isCancelled: true,
      isCancellationConflict: false,
      cancelledAt,
      cancelReason: 'declined',
      date: orderCreatedAt,
      shipmentExecution: null,
    });

    renderOrderDetail();

    await screen.findByText('Shopify order cancelled');
    const currentState = screen.getByLabelText('Current order state');
    expect(within(currentState).getByText('Cancelled')).toBeInTheDocument();
    expect(within(currentState).getByText('No action required')).toBeInTheDocument();
    expect(within(currentState).queryByText('Operational state')).not.toBeInTheDocument();
    expect(within(currentState).queryByText('Fulfillment')).not.toBeInTheDocument();
    expect(within(currentState).queryByText('Finance projection')).not.toBeInTheDocument();
    expect(within(currentState).queryByText('Next operational action')).not.toBeInTheDocument();
    expect(within(currentState).queryByText('Fulfillment not required')).not.toBeInTheDocument();
    expect(within(currentState).queryByText('Sale voided')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Primary operational status')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Operational alerts')).not.toBeInTheDocument();
    expect(document.querySelector('.order-status-summary-grid')).not.toBeInTheDocument();
    expect(screen.queryByText('Add shipment details when the package is ready.')).not.toBeInTheDocument();
    const shipmentRequirement = screen.getByLabelText('Shipment requirement state');
    const shipmentSection = screen.getByRole('heading', { name: 'Fulfillment' }).closest('article');
    expect(shipmentSection).not.toBeNull();
    expect(screen.queryByRole('heading', { name: 'Shipment & delivery' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Shipment' })).not.toBeInTheDocument();
    expect(within(shipmentSection as HTMLElement).queryByText('Shipment and tracking work are closed for this order.')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Fulfillment' }).parentElement?.querySelector('p')).toBeNull();
    expect(shipmentRequirement).toHaveTextContent('Fulfillment not required');
    expect(shipmentRequirement).not.toHaveTextContent('Shipment and tracking work are closed for this order.');
    expect(shipmentRequirement.parentElement).toHaveClass('order-fulfillment-complete-panel');
    expect(shipmentRequirement.parentElement).not.toHaveClass('order-fulfillment-terminal-panel');
    expect(shipmentRequirement.parentElement).not.toHaveClass('vendor-blocked-panel');
    expect(within(shipmentSection as HTMLElement).queryByText('No operational action required')).not.toBeInTheDocument();
    expect(within(shipmentSection as HTMLElement).queryByText('No shipment is required for this order.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create shipment' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add tracking information' })).toBeInTheDocument();
    const cancellationRow = getOrderActivityRow('Shopify order cancelled');
    expect(cancellationRow).toHaveTextContent(formatTimelineDateForTest(cancelledAt));
    expect(cancellationRow).not.toHaveTextContent(formatTimelineDateForTest(orderCreatedAt));
    expect(cancellationRow).toHaveTextContent('Reason: declined.');
    const fulfillmentClosedEvent = getOrderActivityRow('Fulfillment not required');
    expect(within(fulfillmentClosedEvent).queryByText('Closed')).not.toBeInTheDocument();
    expect(fulfillmentClosedEvent).not.toHaveTextContent('Shipment and tracking work are closed for this order.');
  });

  it('uses the existing assignment fallback for legacy cancellation without cancelledAt', async () => {
    setCurrentUser({
      email: 'vendor@example.com',
      name: 'Vendor User',
      role: 'vendor',
      vendorAccess: ['sporjinal'],
      vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
      canSwitchVendors: false,
      defaultVendorId: 'sporjinal',
    });
    const assignmentBlockedAt = '2026-07-11T20:45:00.000Z';
    getOrderMock.mockResolvedValueOnce({
      ...orderWithShipmentSummary,
      isCancelled: true,
      isCancellationConflict: false,
      cancelledAt: null,
      cancelReason: 'legacy cancellation',
      assignmentBlockedAt,
      shipmentExecution: null,
    });

    renderOrderDetail();

    await screen.findByText('Shopify order cancelled');
    expect(getOrderActivityRow('Shopify order cancelled')).toHaveTextContent(
      formatTimelineDateForTest(assignmentBlockedAt),
    );
  });

  it.each([
    { viewport: 'mobile', width: 390 },
    { viewport: 'desktop', width: 1440 },
  ])('keeps return and refund activity source-specific on $viewport', async ({ width }) => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
    window.dispatchEvent(new Event('resize'));
    setCurrentUser({
      email: 'vendor@example.com',
      name: 'Vendor User',
      role: 'vendor',
      vendorAccess: ['sporjinal'],
      vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
      canSwitchVendors: false,
      defaultVendorId: 'sporjinal',
    });
    const cancelledAt = '2026-07-11T21:23:00.000Z';
    getOrderMock.mockResolvedValueOnce({
      ...orderWithShipmentSummary,
      isCancelled: true,
      isCancellationConflict: true,
      cancelledAt,
      cancelReason: 'declined',
      refundRecordCount: 1,
      date: '2026-07-11T16:07:00.000Z',
      shipmentExecution: null,
    });
    listReturnsMock.mockResolvedValueOnce([
      {
        originalVendorId: 'sporjinal',
        assignedVendorId: 'sporjinal',
        vendorId: 'sporjinal',
        id: 'return-request-1028',
        sourceShopifyOrderId: '7616544244049',
        sourceShopifyOrderNumber: '#1028',
        sourceShopifyRefundId: '',
        sourceShopifyReturnId: 'gid://shopify/Return/1028',
        sourceType: 'shopify_return_request',
        status: 'Requested',
        relatedOrderId: '7616544244049',
        date: '2026-07-11T22:00:00.000Z',
        customer: 'Customer unavailable',
        reason: 'Customer return request',
        amount: 'TRY 0.00',
        itemTitle: 'Return-request item',
      },
      {
        originalVendorId: 'sporjinal',
        assignedVendorId: 'sporjinal',
        vendorId: 'sporjinal',
        id: 'refund-derived-1028',
        sourceShopifyOrderId: '7616544244049',
        sourceShopifyOrderNumber: '#1028',
        sourceShopifyRefundId: 'gid://shopify/Refund/1028',
        sourceShopifyReturnId: null,
        sourceType: 'shopify_refund',
        status: 'Processed',
        relatedOrderId: '7616544244049',
        date: '2026-07-11T21:24:00.000Z',
        customer: 'Customer unavailable',
        reason: 'Shopify refund webhook allocation',
        amount: 'TRY 4,999.00',
        itemTitle: 'Refund-derived item',
      },
    ]);

    renderOrderDetail();

    await screen.findByText('Shopify order cancelled');
    const timeline = screen.getByRole('heading', { name: 'Activity' }).closest('article');
    expect(timeline).not.toBeNull();
    const timelineScope = within(timeline as HTMLElement);
    const existingEvidenceEvent = timelineScope.getByText('Existing operational evidence');
    expect(existingEvidenceEvent).toBeInTheDocument();
    expect(existingEvidenceEvent.closest('li')).not.toHaveTextContent('Local fulfillment, shipment, refund, or return evidence was preserved for review.');
    const currentState = screen.getByLabelText('Current order state');
    expect(within(currentState).getByText('Cancelled')).toBeInTheDocument();
    expect(within(currentState).getByText('Review cancellation')).toBeInTheDocument();
    expect(within(currentState).queryByText('Operational state')).not.toBeInTheDocument();
    expect(within(currentState).queryByText('Fulfillment')).not.toBeInTheDocument();
    expect(within(currentState).queryByText('Finance projection')).not.toBeInTheDocument();
    expect(within(currentState).queryByText('Next operational action')).not.toBeInTheDocument();
    expect(within(currentState).queryByText('Review required')).not.toBeInTheDocument();
    const alerts = screen.getByLabelText('Operational alerts');
    expect(within(alerts).getByText('Cancelled')).toBeInTheDocument();
    expect(within(alerts).getByText(/Existing fulfillment, shipment, refund, or return evidence is preserved/i)).toBeInTheDocument();
    expect(screen.queryByLabelText('Right panel status')).not.toBeInTheDocument();
    expect(within(currentState).queryByText('Pending')).not.toBeInTheDocument();
    expect(screen.queryByText('Add shipment details when the package is ready.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create shipment' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add tracking information' })).toBeInTheDocument();

    const financialSummary = screen.getByLabelText('Order financial summary');
    expect(within(financialSummary).getByText('Gross Allocation Amount')).toBeInTheDocument();
    expectRedundantVendorFinanceCopyToBeAbsent(financialSummary);

    const cancellationRow = getOrderActivityRow('Shopify order cancelled');
    expect(cancellationRow).toHaveTextContent(formatTimelineDateForTest(cancelledAt));
    expect(cancellationRow).toHaveTextContent('Reason: declined.');

    const returnRow = (await timelineScope.findByText('Return requested')).closest('li');
    const refundRow = (await timelineScope.findByText('Refund processed')).closest('li');
    expect(returnRow).not.toBeNull();
    expect(refundRow).not.toBeNull();
    expect(returnRow).not.toBe(refundRow);
    expect(returnRow).toHaveTextContent('Return-request item');
    expect(returnRow).toHaveTextContent(formatTimelineDateForTest('2026-07-11T22:00:00.000Z'));
    expect(within(returnRow as HTMLElement).queryByText('Requested')).not.toBeInTheDocument();
    expect(returnRow).not.toHaveTextContent('Return-request item · requested');
    expect(returnRow?.querySelector('.op-badge')).not.toBeInTheDocument();
    expect(refundRow).toHaveTextContent('Refund-derived item');
    expect(within(refundRow as HTMLElement).queryByText('Processed')).not.toBeInTheDocument();
    expect(refundRow).not.toHaveTextContent('Refund-derived item · processed');
    expect(refundRow).not.toHaveTextContent('Return requested');
    expect(cancellationRow.compareDocumentPosition(refundRow as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(refundRow?.compareDocumentPosition(returnRow as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const linkedRecords = screen.getByRole('heading', { name: 'Linked records' }).closest('.order-linked-records-panel');
    expect(linkedRecords).not.toBeNull();
    const requestedReturnLink = linkedRecords?.querySelector('a[href="/returns/return-request-1028"]');
    expect(requestedReturnLink).not.toBeNull();
    expect(requestedReturnLink).toHaveTextContent('Requested');
    expect(requestedReturnLink).toHaveTextContent('Return linked');
    const processedReturnLink = linkedRecords?.querySelector('a[href="/returns/refund-derived-1028"]');
    expect(processedReturnLink).not.toBeNull();
    expect(processedReturnLink).toHaveAttribute('href', '/returns/refund-derived-1028');
    expect(processedReturnLink).toHaveTextContent('Processed');
    expect(processedReturnLink).toHaveTextContent('Return linked');
    expect(within(processedReturnLink as HTMLElement).queryByText(/^Return$/)).not.toBeInTheDocument();
    expect(within(processedReturnLink as HTMLElement).queryByText('Open return detail')).not.toBeInTheDocument();
  });

  it.each([
    { status: 'Created', title: 'Refund created', suffix: 'created' },
    { status: 'Pending', title: 'Refund pending', suffix: 'pending' },
    { status: 'Refunded', title: 'Refund processed', suffix: 'refunded' },
    { status: 'Failed', title: 'Refund failed', suffix: 'failed' },
  ])('removes redundant vendor refund Activity status for $status without removing the event', async ({ status, title, suffix }) => {
    setCurrentUser({
      email: 'vendor@example.com',
      name: 'Vendor User',
      role: 'vendor',
      vendorAccess: ['sporjinal'],
      vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
      canSwitchVendors: false,
      defaultVendorId: 'sporjinal',
    });
    const eventAt = '2026-07-11T21:24:00.000Z';
    listReturnsMock.mockResolvedValueOnce([
      {
        originalVendorId: 'sporjinal',
        assignedVendorId: 'sporjinal',
        vendorId: 'sporjinal',
        id: `refund-${suffix}-1028`,
        sourceShopifyOrderId: '7616544244049',
        sourceShopifyOrderNumber: '#1028',
        sourceShopifyRefundId: `gid://shopify/Refund/${suffix}`,
        sourceShopifyReturnId: null,
        sourceType: 'shopify_refund',
        status,
        relatedOrderId: '7616544244049',
        date: eventAt,
        customer: 'Customer unavailable',
        reason: 'Shopify refund webhook allocation',
        amount: 'TRY 4,999.00',
        itemTitle: 'Refund activity item',
      },
    ]);
    getOrderMock.mockResolvedValueOnce(orderWithShipmentSummary);

    renderOrderDetail();

    const refundRow = await screen.findByText(title).then(() => getOrderActivityRow(title));
    expect(refundRow).toHaveTextContent('Refund activity item');
    expect(refundRow).toHaveTextContent(formatTimelineDateForTest(eventAt));
    expect(refundRow).not.toHaveTextContent(`Refund activity item · ${suffix}`);
    expect(refundRow.querySelector('.op-badge')).toBeNull();
  });

  it('preserves unknown Refund recorded status copy and badge for vendors', async () => {
    setCurrentUser({
      email: 'vendor@example.com',
      name: 'Vendor User',
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
        id: 'refund-manual-review-1028',
        sourceShopifyOrderId: '7616544244049',
        sourceShopifyOrderNumber: '#1028',
        sourceShopifyRefundId: 'gid://shopify/Refund/manual-review',
        sourceShopifyReturnId: null,
        sourceType: 'shopify_refund',
        status: 'Manual Review',
        relatedOrderId: '7616544244049',
        date: '2026-07-11T21:24:00.000Z',
        customer: 'Customer unavailable',
        reason: 'Shopify refund webhook allocation',
        amount: 'TRY 4,999.00',
        itemTitle: 'Fallback refund item',
      },
    ]);
    getOrderMock.mockResolvedValueOnce(orderWithShipmentSummary);

    renderOrderDetail();

    const refundRow = await screen.findByText('Refund recorded').then(() => getOrderActivityRow('Refund recorded'));
    expect(refundRow).toHaveTextContent('Fallback refund item · manual review');
    expect(within(refundRow).getByText('Manual Review')).toBeInTheDocument();
  });

  it.each(['admin', 'support', 'finance'] as const)('preserves %s refund Activity status presentation', async (role) => {
    setCurrentUser({
      email: `${role}@example.com`,
      name: `${role} User`,
      role,
      vendorAccess: ['sporjinal'],
      vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
      canSwitchVendors: role === 'admin',
      defaultVendorId: 'sporjinal',
    });
    listReturnsMock.mockResolvedValueOnce([
      {
        originalVendorId: 'sporjinal',
        assignedVendorId: 'sporjinal',
        vendorId: 'sporjinal',
        id: 'refund-created-admin-1028',
        sourceShopifyOrderId: '7616544244049',
        sourceShopifyOrderNumber: '#1028',
        sourceShopifyRefundId: 'gid://shopify/Refund/created-admin',
        sourceShopifyReturnId: null,
        sourceType: 'shopify_refund',
        status: 'Created',
        relatedOrderId: '7616544244049',
        date: '2026-07-11T21:24:00.000Z',
        customer: 'Customer unavailable',
        reason: 'Shopify refund webhook allocation',
        amount: 'TRY 4,999.00',
        itemTitle: 'Admin refund item',
      },
    ]);
    getOrderMock.mockResolvedValueOnce(orderWithShipmentSummary);

    renderOrderDetail();

    const refundRow = await screen.findByText('Refund created').then(() => getOrderActivityRow('Refund created'));
    expect(refundRow).toHaveTextContent('Admin refund item · created');
    expect(within(refundRow).getByText('Created')).toBeInTheDocument();
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

    const timelineCard = within(sidebarFlow as HTMLElement).getByRole('heading', { name: 'Activity' }).closest('article');
    const supportCard = within(sidebarFlow as HTMLElement).getByRole('heading', { name: 'Support' }).closest('article');

    expect(within(sidebarFlow as HTMLElement).queryByLabelText('Right panel status')).not.toBeInTheDocument();
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
    expect(supportCard).not.toHaveClass('order-support-card-empty');
    const contactSupport = await within(supportCard).findByRole('link', { name: 'Contact support' });
    expect(contactSupport).toHaveAttribute('href', '/support/ticket-shipment-1');
    expectVendorSupportHelperCopyToBeAbsent(supportCard);
    const ticketSummary = within(supportCard).getByLabelText('Support ticket summary');
    expect(ticketSummary).toHaveTextContent('Tickets · 1');
    expect(ticketSummary).toHaveTextContent('Open');
    expect(ticketSummary).toHaveTextContent('Help with order #1028');
    expect(ticketSummary).toHaveTextContent('Normal priority');
    expect(within(supportCard).queryByRole('button', { name: 'Contact support' })).not.toBeInTheDocument();
    expect(within(supportCard).getByRole('button', { name: 'Escalate' })).toBeEnabled();
    expect(createSupportTicketMock).not.toHaveBeenCalled();
  });

  it('preserves the waiting-for-vendor support notice and its existing link', async () => {
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
      buildSupportTicket({ status: 'WAITING_FOR_VENDOR', subject: 'Vendor response required' }),
    ]);
    getOrderMock.mockResolvedValueOnce(orderWithShipmentSummary);

    renderOrderDetail();

    expect(await screen.findByLabelText('Current order state')).toBeInTheDocument();
    const alerts = screen.getByLabelText('Operational alerts');
    expect(await within(alerts).findByText('Support action needed')).toBeInTheDocument();
    expect(within(alerts).getByText('Vendor response required')).toBeInTheDocument();
    expect(within(alerts).getByRole('link', { name: 'Open support' })).toHaveAttribute(
      'href',
      '/support/ticket-shipment-1',
    );
    const supportCard = screen.getByLabelText('Shipment and return support');
    expect(within(supportCard).getByLabelText('Support ticket summary')).toHaveTextContent('Vendor response required');
    expectVendorSupportHelperCopyToBeAbsent(supportCard);
    expect(screen.queryByLabelText('Primary operational status')).not.toBeInTheDocument();
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

    const supportCard = await screen.findByLabelText('Shipment and return support');
    expectVendorSupportHelperCopyToBeAbsent(supportCard);
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
    expect(supportCard).toHaveClass('order-support-card');
    expect(supportCard).not.toHaveClass('order-support-card-empty');
    expect(within(supportCard).getByRole('heading', { name: 'Support' })).toBeInTheDocument();
    expect(within(supportCard).getByRole('button', { name: 'Contact support' })).toBeEnabled();
    expect(within(supportCard).getByRole('button', { name: 'Escalate' })).toBeDisabled();
    expect(within(supportCard).queryByText('No linked support tickets')).not.toBeInTheDocument();
    expect(within(supportCard).queryByText(/Order, shipment, and return context attached\./)).not.toBeInTheDocument();
    expectVendorSupportHelperCopyToBeAbsent(supportCard);
    expect(within(supportCard).queryByRole('button', { name: 'Internal note' })).not.toBeInTheDocument();
  });

  it('removes vendor support-unavailable helper copy without changing disabled actions', async () => {
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
      allocationStatus: 'vendor_blocked',
      operationalActionability: { actionable: false, reason: 'Vendor rejected allocation' },
      fulfillmentActionAvailable: false,
      shipmentExecution: null,
    });

    renderOrderDetail();

    const supportCard = await screen.findByLabelText('Shipment and return support');
    expect(within(supportCard).getByRole('heading', { name: 'Support' })).toBeInTheDocument();
    expect(within(supportCard).getByRole('button', { name: 'Contact support' })).toBeDisabled();
    expect(within(supportCard).getByRole('button', { name: 'Escalate' })).toBeDisabled();
    expect(within(supportCard).queryByText('No linked support tickets')).not.toBeInTheDocument();
    expect(
      within(supportCard).queryByText('Support is available for active or fulfilled assigned orders.'),
    ).not.toBeInTheDocument();
    expectVendorSupportHelperCopyToBeAbsent(supportCard);
  });

  it.each(['RESOLVED', 'CLOSED'] as const)(
    'keeps a %s vendor ticket card and support actions while removing helper copy',
    async (status) => {
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
        buildSupportTicket({
          status,
          resolvedAt: status === 'RESOLVED' ? '2026-05-15T20:10:00.000Z' : null,
          closedAt: status === 'CLOSED' ? '2026-05-15T20:10:00.000Z' : null,
        }),
      ]);
      getOrderMock.mockResolvedValueOnce(orderWithShipmentSummary);

      renderOrderDetail();

      const supportCard = await screen.findByLabelText('Shipment and return support');
      expect(await within(supportCard).findByLabelText('Support ticket summary')).toHaveTextContent(
        status === 'RESOLVED' ? 'Resolved' : 'Closed',
      );
      expect(within(supportCard).getByRole('button', { name: 'Contact support' })).toBeEnabled();
      expect(within(supportCard).getByRole('button', { name: 'Escalate' })).toBeDisabled();
      expectVendorSupportHelperCopyToBeAbsent(supportCard);
    },
  );

  it('keeps the escalated button state while removing the open-ticket advisory', async () => {
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
      buildSupportTicket({ priority: 'high', escalatedAt: '2026-05-15T20:10:00.000Z' }),
    ]);
    getOrderMock.mockResolvedValueOnce(orderWithShipmentSummary);

    renderOrderDetail();

    const supportCard = await screen.findByLabelText('Shipment and return support');
    expect(await within(supportCard).findByRole('button', { name: 'Escalated' })).toBeDisabled();
    expect(within(supportCard).getByLabelText('Support ticket summary')).toHaveTextContent('High priority');
    expectVendorSupportHelperCopyToBeAbsent(supportCard);
  });

  it('keeps the escalating button state while removing the open-ticket advisory', async () => {
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
    const escalationResult = deferred<SupportTicket>();
    listVendorSupportTicketsMock.mockResolvedValueOnce([supportTicket]);
    escalateVendorSupportTicketMock.mockReturnValueOnce(escalationResult.promise);
    getOrderMock.mockResolvedValueOnce(orderWithShipmentSummary);

    renderOrderDetail();

    const supportCard = await screen.findByLabelText('Shipment and return support');
    await user.click(within(supportCard).getByRole('button', { name: 'Escalate' }));
    expect(await within(supportCard).findByRole('button', { name: 'Escalating…' })).toBeDisabled();
    expectVendorSupportHelperCopyToBeAbsent(supportCard);

    escalationResult.resolve({
      ...supportTicket,
      priority: 'high',
      status: 'IN_REVIEW',
      escalatedAt: '2026-05-15T20:10:00.000Z',
    });
    await waitFor(() => expect(escalateVendorSupportTicketMock).toHaveBeenCalledWith('ticket-shipment-1'));
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

    const linkedRecord = (await screen.findByRole('heading', { name: 'Linked record' })).closest('.order-linked-records-panel');
    expect(screen.queryByRole('heading', { name: 'Linked records' })).not.toBeInTheDocument();
    expect(linkedRecord).toBeTruthy();
    expect(within(linkedRecord as HTMLElement).queryByText(/^Linked records$/i)).not.toBeInTheDocument();
    expect(within(linkedRecord as HTMLElement).queryByText('Secondary operational context linked to this order.')).not.toBeInTheDocument();
    expect(within(linkedRecord as HTMLElement).getByText('Support activity')).toBeInTheDocument();
    expect(within(linkedRecord as HTMLElement).getByText(/2 linked tickets/i)).toBeInTheDocument();
    expect(linkedRecord).toHaveTextContent('Latest status: In Review');
    const supportLink = within(linkedRecord as HTMLElement).getByRole('link', { name: /Support activity/i });
    expect(supportLink).toHaveAttribute('href', '/support/ticket-finance-review');
    expect(within(supportLink).queryByText(/^Support$/)).not.toBeInTheDocument();
    expect(within(supportLink).queryByText('Open latest support ticket')).not.toBeInTheDocument();

    const ticketSummary = screen.getByLabelText('Support ticket summary');
    expect(ticketSummary).toHaveTextContent('Tickets · 2');
    expect(within(ticketSummary).getByText('Settlement review question for #1028')).toBeInTheDocument();
  });

  it('keeps the full linked records card when multiple meaningful records are available', async () => {
    setCurrentUser({
      email: 'admin@demo.com',
      name: 'Demo Admin',
      role: 'admin',
      vendorAccess: ['sporjinal'],
      vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
      canSwitchVendors: true,
      defaultVendorId: 'sporjinal',
    });
    listAdminSupportTicketsMock.mockResolvedValueOnce([buildSupportTicket()]);
    getFinanceDashboardMock.mockResolvedValueOnce(buildOrderFinanceDashboard({ includeProductRefund: true }));
    getOrderMock.mockResolvedValueOnce(orderWithShipmentSummary);

    renderOrderDetail();

    const supportEventTitle = await screen.findByText('Support ticket created');
    const activity = supportEventTitle.closest('article');
    expect(activity).toBeTruthy();
    const financeRefundEvent = within(activity as HTMLElement).getByText('Refund processed').closest('li');
    expect(financeRefundEvent).toHaveTextContent('TRY 4,999.00');
    expect(financeRefundEvent).toHaveTextContent('Recorded');
    expect(financeRefundEvent).not.toHaveTextContent('Refund · TRY 4,999.00');
    const supportEvent = supportEventTitle.closest('li');
    expect(supportEvent).toHaveTextContent('Help with order #1028');
    expect(supportEvent).toHaveTextContent(formatTimelineDateForTest('2026-05-15T20:00:00.000Z'));
    expect(within(supportEvent as HTMLElement).queryByText('Open')).not.toBeInTheDocument();
    expect(supportEvent?.querySelector('.op-badge')).not.toBeInTheDocument();
    expect(within(supportEvent as HTMLElement).getByRole('link', { name: 'Support ticket created' })).toHaveAttribute(
      'href',
      '/admin/support/ticket-shipment-1',
    );

    const linkedRecords = (await screen.findByRole('heading', { name: 'Linked records' })).closest('.order-linked-records-panel');
    expect(linkedRecords).toBeTruthy();
    expect(within(linkedRecords as HTMLElement).getAllByText('Linked records')).toHaveLength(1);
    expect(within(linkedRecords as HTMLElement).queryByText(/Returns, settlement activity, and grouped support context linked to this order\./)).not.toBeInTheDocument();
    expect(within(linkedRecords as HTMLElement).getByText('Support activity')).toBeInTheDocument();
    expect(within(linkedRecords as HTMLElement).getByText('Settlement activity')).toBeInTheDocument();
    const financeLink = within(linkedRecords as HTMLElement).getByRole('link', { name: /Settlement activity/i });
    expect(financeLink).toHaveAttribute('href', expect.stringContaining('/finance'));
    expect(financeLink).toHaveTextContent('TRY 4,999.00');
    expect(financeLink).toHaveTextContent('Pending review');
    expect(financeLink).not.toHaveTextContent('TRY 4,999.00 · Pending');
    expect(within(financeLink).queryByText(/^Finance$/)).not.toBeInTheDocument();
    expect(within(financeLink).queryByText('Open finance detail')).not.toBeInTheDocument();
    const refundLink = within(linkedRecords as HTMLElement).getByRole('link', { name: /Refund impact/i });
    expect(refundLink).toHaveTextContent('TRY 4,999.00 · Recorded');
    expect(refundLink).toHaveTextContent('Refund');
    expect(within(refundLink).queryByText('Open finance detail')).not.toBeInTheDocument();
    const supportLink = within(linkedRecords as HTMLElement).getByRole('link', { name: /Support activity/i });
    expect(supportLink).toHaveAttribute('href', '/admin/support/ticket-shipment-1');
    expect(within(supportLink).queryByText('Open latest support ticket')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Support ticket summary')).toHaveTextContent('Open');
    expect(screen.queryByLabelText('Linked record')).not.toBeInTheDocument();
  });

  it('keeps resolved support status current while support activity rows remain historical', async () => {
    setCurrentUser({
      email: 'admin@demo.com',
      name: 'Demo Admin',
      role: 'admin',
      vendorAccess: ['sporjinal'],
      vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
      canSwitchVendors: true,
      defaultVendorId: 'sporjinal',
    });
    const createdAt = '2026-05-15T20:00:00.000Z';
    const lastReplyAt = '2026-05-15T20:04:00.000Z';
    const resolvedAt = '2026-05-15T20:05:00.000Z';
    listAdminSupportTicketsMock.mockResolvedValueOnce([
      buildSupportTicket({
        subject: 'Resolved shipment help',
        status: 'RESOLVED',
        createdAt,
        updatedAt: resolvedAt,
        lastReplyAt,
        lastReplyByRole: 'ADMIN',
        resolvedAt,
      }),
    ]);
    getOrderMock.mockResolvedValueOnce(orderWithShipmentSummary);

    renderOrderDetail();

    const createdEventTitle = await screen.findByText('Support ticket created');
    const activity = createdEventTitle.closest('article');
    expect(activity).not.toBeNull();
    const activityScope = within(activity as HTMLElement);
    const createdRow = activityScope.getByText('Support ticket created').closest('li');
    const replyRow = activityScope.getByText('Support reply added').closest('li');
    const resolvedRow = activityScope.getByText('Support ticket resolved').closest('li');

    expect(createdRow).toHaveTextContent('Resolved shipment help');
    expect(createdRow).toHaveTextContent(formatTimelineDateForTest(createdAt));
    expect(within(createdRow as HTMLElement).queryByText('Resolved')).not.toBeInTheDocument();
    expect(createdRow?.querySelector('.op-badge')).not.toBeInTheDocument();
    expect(within(createdRow as HTMLElement).getByRole('link', { name: 'Support ticket created' })).toHaveAttribute(
      'href',
      '/admin/support/ticket-shipment-1',
    );

    expect(replyRow).toHaveTextContent('Resolved shipment help');
    expect(replyRow).toHaveTextContent(formatTimelineDateForTest(lastReplyAt));
    expect(within(replyRow as HTMLElement).getByText('ADMIN')).toBeInTheDocument();
    expect(replyRow?.querySelector('.op-badge')).toBeInTheDocument();

    expect(resolvedRow).toHaveTextContent('Resolved shipment help');
    expect(resolvedRow).toHaveTextContent(formatTimelineDateForTest(resolvedAt));
    expect(within(resolvedRow as HTMLElement).queryByText('Resolved')).not.toBeInTheDocument();
    expect(resolvedRow?.querySelector('.op-badge')).not.toBeInTheDocument();
    expect(within(resolvedRow as HTMLElement).getByRole('link', { name: 'Support ticket resolved' })).toHaveAttribute(
      'href',
      '/admin/support/ticket-shipment-1',
    );

    expect(createdRow?.compareDocumentPosition(replyRow as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(replyRow?.compareDocumentPosition(resolvedRow as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByLabelText('Support ticket summary')).toHaveTextContent('Resolved');
  });

  it('integrates a single finance linked record into Settlement', async () => {
    setCurrentUser({
      email: 'admin@demo.com',
      name: 'Demo Admin',
      role: 'admin',
      vendorAccess: ['sporjinal'],
      vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
      canSwitchVendors: true,
      defaultVendorId: 'sporjinal',
    });
    getFinanceDashboardMock.mockResolvedValueOnce(buildOrderFinanceDashboard());
    getOrderMock.mockResolvedValueOnce(orderWithShipmentSummary);

    renderOrderDetail();

    const settlement = await screen.findByLabelText('Order finance preview');
    const openFinance = await within(settlement).findByRole('link', { name: 'Open finance' });
    expect(openFinance).toHaveAttribute('href', expect.stringContaining('/finance'));
    expect(screen.queryByRole('heading', { name: 'Linked record' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Linked records' })).not.toBeInTheDocument();
  });

  it('keeps the admin right rail as timeline, Support, then a normal Internal notes card', async () => {
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

    const rail = await screen.findByLabelText('Order timeline and support');
    const sidebar = rail.querySelector('.order-detail-sidebar-flow') as HTMLElement;
    const timeline = within(sidebar).getByRole('heading', { name: 'Activity' }).closest('article') as HTMLElement;
    const support = within(sidebar).getByRole('heading', { name: 'Support' }).closest('article') as HTMLElement;
    const notes = within(sidebar).getByRole('heading', { name: 'Internal notes' }).closest('article') as HTMLElement;

    expect(within(support).getByText('No linked support tickets')).toBeInTheDocument();
    const supportDiagnostics = within(support).getByLabelText('Admin support diagnostics') as HTMLDetailsElement;
    expect(within(supportDiagnostics).getByText('Admin support context')).toBeInTheDocument();
    expect(within(supportDiagnostics).queryByText('Copy utilities')).not.toBeInTheDocument();
    expect(within(notes).getByText('No internal notes yet.')).toBeInTheDocument();
    expect(within(notes).getByRole('button', { name: 'Add note' })).toBeInTheDocument();
    expect(notes.querySelector('.admin-collab-empty')).not.toBeNull();
    expect(notes).not.toHaveClass('admin-collab-card-compact');
    expect(Boolean(timeline.compareDocumentPosition(support) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(Boolean(support.compareDocumentPosition(notes) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  });

  it('uses Order Detail-local styles to remove only redundant empty-note chrome', () => {
    const styles = readFileSync(`${process.cwd()}/src/styles.css`, 'utf8');

    expect(styles).toContain(`.order-detail-sidebar-flow > .admin-collab-card .admin-collab-heading .eyebrow {
  display: none;
}`);
    expect(styles).toContain(`.order-detail-sidebar-flow > .admin-collab-card:has(.admin-collab-empty) .admin-collab-heading > span {
  display: none;
}`);
    expect(styles).not.toContain('.order-detail-sidebar-flow > .admin-collab-card .admin-collab-heading > span {\n  display: none;');
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
    const settlementSummary = within(settlementPreview).getByLabelText('Settlement summary values');
    expect(within(settlementSummary).getByText('Estimated vendor payable')).toBeInTheDocument();
    expect(settlementSummary).toHaveTextContent(/TRY\s*4,499\.10/);
    expect(within(settlementSummary).queryByText('Refund impact')).not.toBeInTheDocument();
    expect(within(settlementSummary).queryByText('Shipping deduction')).not.toBeInTheDocument();

    const financeDetails = within(settlementPreview).getByLabelText('Finance details') as HTMLDetailsElement;
    expect(financeDetails.open).toBe(false);
    expect(within(financeDetails).getByText('Gross order amount')).toBeInTheDocument();
    expect(within(financeDetails).getByText('Commission estimate')).toBeInTheDocument();
    expect(within(financeDetails).getByText('Shipping deduction')).toBeInTheDocument();
    expect(within(financeDetails).getByText('Refund impact')).toBeInTheDocument();
    expect(within(financeDetails).getByText('Estimated settlement')).toBeInTheDocument();
    expect(financeDetails).toHaveTextContent(/TRY\s*4,999\.00/);
    expect(financeDetails).toHaveTextContent(/TRY\s*499\.90/);
    expect(within(financeDetails).getAllByText('Unknown').length).toBeGreaterThan(0);
    expect(within(settlementPreview).getByLabelText('Workflow action guidance')).toHaveTextContent('Review settlement estimate');
    expect(settlementPreview).not.toHaveTextContent(/Confirmed/i);

    const financeTimeline = screen.getByLabelText('Finance timeline') as HTMLDetailsElement;
    expect(financeTimeline.open).toBe(false);
    expect(within(financeTimeline).getByText('Finance activity')).toBeInTheDocument();
    expect(financeTimeline.closest('article')).toBe(settlementPreview);
    expect(financeTimeline).not.toHaveClass('order-finance-timeline-card');
    expect(financeTimeline).toHaveTextContent('Finance events are previews until settlement review is completed.');
    expect(within(financeTimeline).getByText('Settlement preview generated')).toBeInTheDocument();
    expect(within(financeTimeline).getByText('Commission estimated')).toBeInTheDocument();
    expect(within(financeTimeline).getByText('Shipping deduction unknown')).toBeInTheDocument();
    expect(within(financeTimeline).getByText('Settlement awaiting review')).toBeInTheDocument();
    expect(within(financeTimeline).getAllByText('Estimated').length).toBeGreaterThan(0);
    expect(financeTimeline).not.toHaveTextContent(/Payout scheduled|Payout paid|Confirmed settlement/i);

    const financeLedgerPreview = (await screen.findByLabelText('Finance ledger preview')) as HTMLDetailsElement;
    expect(financeLedgerPreview.open).toBe(false);
    expect(financeLedgerPreview.closest('article')).toBe(settlementPreview);
    expect(financeLedgerPreview).not.toHaveClass('order-finance-ledger-card');
    expect(screen.getByText('Admin-only reconciliation trace; not settlement or payout truth.')).toBeInTheDocument();
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
    expect(screen.getByLabelText('Order financial summary')).toBeInTheDocument();
    expect(screen.queryByLabelText('Order finance preview')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Finance timeline')).not.toBeInTheDocument();
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
    const diagnosticsSummary = within(supportDiagnostics).getByText('Admin support context').closest('summary');
    expect(diagnosticsSummary).not.toBeNull();
    expect(within(diagnosticsSummary as HTMLElement).queryByText('Copy utilities')).not.toBeInTheDocument();
    expect(screen.queryByText('Support context and diagnostics.')).not.toBeInTheDocument();
    await userEvent.click(diagnosticsSummary as HTMLElement);
    expect(supportDiagnostics.open).toBe(true);
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
    expect(screen.queryByText('Shipment and return context attached.')).not.toBeInTheDocument();
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

    expect(await screen.findByLabelText('Shipping provider configuration editor', {}, { timeout: 10000 })).toBeInTheDocument();
    const warehouseInput = screen.getByLabelText('Warehouse ID');
    await user.clear(warehouseInput);
    await user.type(warehouseInput, '112669');
    await user.click(screen.getByRole('button', { name: 'Save shipping config' }));

    await waitFor(() =>
      expect(updateVendorShippingConfigMock).toHaveBeenCalledWith(
        'sporjinal',
        expect.objectContaining({
          preferredProvider: 'kargonomi',
          cargoIntegrationId: null,
          defaultWarehouseId: '112669',
          defaultDesi: 3,
          providerMetadata: expect.objectContaining({
            kargonomiBuyerStateId: '34',
            kargonomiBuyerCityId: '828',
          }),
        }),
      ),
    );
    expect(await screen.findByText('Shipping provider configuration saved.')).toBeInTheDocument();
    await waitFor(() => expect(getShippingProviderDiagnosticsMock).toHaveBeenCalledTimes(2));
    expect(getShippingProviderDiagnosticsMock.mock.calls.map(([options]) => options?.provider)).toEqual([
      'kargonomi',
      'kargonomi',
    ]);
    expect(getAdminVendorShippingConfigMock).toHaveBeenCalledWith('sporjinal', expect.any(Object));
    expect(getVendorShippingConfigMock).not.toHaveBeenCalled();
  }, 10000);

  it('does not initialize Admin Order Detail shipping from another Vendor response', async () => {
    setCurrentUser({
      email: 'admin@demo.com', name: 'Demo Admin', role: 'admin',
      vendorAccess: ['sporjinal'],
      vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
      canSwitchVendors: true, defaultVendorId: 'sporjinal',
    });
    getAdminVendorShippingConfigMock.mockResolvedValue({
      vendorId: 'other-vendor', preferredProvider: 'navlungo', shippingEnabled: true,
      warehouses: [{ id: 'other-warehouse', vendorId: 'other-vendor', name: 'Other vendor warehouse' }],
    });

    renderOrderDetail();
    expect(await screen.findByText('Order #1028')).toBeInTheDocument();
    await waitFor(() => expect(getAdminVendorShippingConfigMock).toHaveBeenCalledWith('sporjinal', expect.any(Object)));
    expect(getVendorShippingConfigMock).not.toHaveBeenCalled();
    expect(screen.queryByText('Other vendor warehouse')).not.toBeInTheDocument();
  });

  it('normalizes saved Try OTO config to Kargonomi for active editing', async () => {
    setCurrentUser({
      email: 'admin@demo.com',
      name: 'Demo Admin',
      role: 'admin',
      vendorAccess: ['sporjinal'],
      vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
      canSwitchVendors: true,
      defaultVendorId: 'sporjinal',
    });
    getAdminVendorShippingConfigMock.mockResolvedValueOnce({
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
        provider: options?.provider === 'try_oto' ? 'try_oto' : 'kargonomi',
        supportedProviders: ['hepsijet', 'kargonomi', 'try_oto'],
        executionReady: options?.provider === 'try_oto',
        sandboxModeEnabled: options?.provider === 'try_oto',
        shippingExecutionEnabled: true,
        providerSelected: options?.provider === 'try_oto',
        providerEnabled: true,
        webhookIngestEnabled: false,
        baseUrlConfigured: true,
        apiKeyConfigured: true,
        cargoIntegrationIdConfigured: false,
        warehouseIdConfigured: true,
        defaultDesiConfigured: true,
        packageTypeUsed: '',
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

    const providerSelect = await screen.findByLabelText('Provider', {}, { timeout: 10000 });
    expect(providerSelect).toHaveValue('kargonomi');
    expect(within(providerSelect).getByRole('option', { name: 'Kargonomi' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Try OTO' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Try OTO pickup location code')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Try OTO origin city')).not.toBeInTheDocument();
  });

  it('keeps passive provider options hidden even if stale diagnostics expose them', async () => {
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
        provider: options?.provider === 'try_oto' ? 'try_oto' : 'kargonomi',
        supportedProviders: ['hepsijet', 'kargonomi', 'try_oto'],
        executionReady: false,
        sandboxModeEnabled: options?.provider === 'try_oto',
        shippingExecutionEnabled: false,
        providerSelected: options?.provider !== 'try_oto',
        providerEnabled: options?.provider === 'try_oto',
        webhookIngestEnabled: false,
        baseUrlConfigured: true,
        apiKeyConfigured: true,
        cargoIntegrationIdConfigured: false,
        warehouseIdConfigured: options?.provider !== 'try_oto',
        defaultDesiConfigured: true,
        packageTypeUsed: '',
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

    const providerSelect = await screen.findByLabelText('Provider', {}, { timeout: 10000 });
    expect(providerSelect).toHaveValue('kargonomi');
    expect(screen.queryByRole('option', { name: 'Try OTO' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Navlungo' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Hepsijet' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Kargo Entegratör' })).not.toBeInTheDocument();
    expect(within(providerSelect).getByRole('option', { name: 'Kargonomi' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Try OTO pickup location code')).not.toBeInTheDocument();
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
        provider: options?.provider === 'kargonomi' ? 'kargonomi' : options?.provider === 'try_oto' ? 'try_oto' : 'kargonomi',
        supportedProviders: ['hepsijet', 'kargonomi'],
        executionReady: options?.provider === 'kargonomi',
        sandboxModeEnabled: false,
        shippingExecutionEnabled: true,
        providerSelected: options?.provider === 'kargonomi',
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

    const providerSelect = await screen.findByLabelText('Provider', {}, { timeout: 10000 });
    expect(within(providerSelect).getByRole('option', { name: 'Kargonomi' })).toBeInTheDocument();
    await user.selectOptions(providerSelect, 'kargonomi');
    const warehouseInput = await screen.findByLabelText('Warehouse ID');
    const carrierInput = await screen.findByLabelText(/Kargonomi carrier\/provider ID/);
    const buyerStateInput = await screen.findByLabelText('Fallback Kargonomi buyer state ID (PoC override)');
    const buyerCityInput = await screen.findByLabelText('Fallback Kargonomi buyer city ID (PoC override)');
    const returnReceiverNameInput = await screen.findByLabelText('Return receiver fallback name');
    const returnReceiverPhoneInput = await screen.findByLabelText('Return receiver fallback phone');
    const returnReceiverAddressInput = await screen.findByLabelText('Return receiver fallback address');
    expect(carrierInput).toHaveValue('44');
    expect(returnReceiverNameInput).toHaveValue('Sporjinal warehouse');
    expect(returnReceiverPhoneInput).toHaveValue('');
    expect(returnReceiverAddressInput).toHaveValue('');
    expect(screen.getByText('Provider basics')).toBeInTheDocument();
    expect(screen.getByText('Warehouse synchronization')).toBeInTheDocument();
    expect(screen.getByText('Return receiver override / fallback')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sync Kargonomi warehouse details' })).toBeInTheDocument();
    expect(screen.getByText('Phone missing')).toBeInTheDocument();
    expect(screen.getByText(/-1 means automatic cheapest provider selection/)).toBeInTheDocument();
    expect(screen.getByText('Only used when synced warehouse data is missing or intentionally overridden.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run Kargonomi lookup diagnostic' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Run Navlungo auth diagnostic' })).not.toBeInTheDocument();
    await user.clear(warehouseInput);
    await user.type(warehouseInput, '112668');
    await user.clear(carrierInput);
    await user.type(carrierInput, '9');
    await user.clear(buyerStateInput);
    await user.type(buyerStateInput, '34');
    await user.clear(buyerCityInput);
    await user.type(buyerCityInput, '828');
    fireEvent.change(returnReceiverNameInput, { target: { value: 'Yalispor return depot' } });
    fireEvent.change(returnReceiverPhoneInput, { target: { value: '+902122223344' } });
    fireEvent.change(returnReceiverAddressInput, { target: { value: 'Yalispor return address' } });
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
            kargonomiShippingProviderId: '9',
            kargonomiBuyerStateId: '34',
            kargonomiBuyerCityId: '828',
            kargonomiReturnReceiverName: 'Yalispor return depot',
            kargonomiReturnReceiverPhone: '+902122223344',
            kargonomiReturnReceiverAddress: 'Yalispor return address',
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
  }, 20000);

  it('syncs saved Kargonomi warehouse details from the shipping config editor', async () => {
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
        provider: options?.provider === 'kargonomi' ? 'kargonomi' : 'kargonomi',
        supportedProviders: ['hepsijet', 'kargonomi'],
        executionReady: options?.provider === 'kargonomi',
        sandboxModeEnabled: false,
        shippingExecutionEnabled: true,
        providerSelected: options?.provider === 'kargonomi',
        providerEnabled: true,
        webhookIngestEnabled: false,
        baseUrlConfigured: true,
        apiKeyConfigured: true,
        cargoIntegrationIdConfigured: false,
        warehouseIdConfigured: true,
        defaultDesiConfigured: true,
        packageTypeUsed: '',
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
    getAdminVendorShippingConfigMock.mockResolvedValueOnce({
      vendorId: 'sporjinal',
      preferredProvider: 'kargonomi',
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
          syncStatus: {
            contactNamePresent: true,
            phonePresent: false,
            addressPresent: false,
            stateIdPresent: false,
            cityIdPresent: false,
            stateName: null,
            cityName: null,
            syncedAt: null,
            lookupStatus: null,
            lookupError: null,
          },
        },
      ],
      providerMetadata: {
        kargonomiBuyerStateId: '34',
        kargonomiBuyerCityId: '828',
      },
      source: 'configured',
      updatedAt: '2026-05-15T19:45:00.000Z',
    });

    renderOrderDetail();

    expect(await screen.findByLabelText('Warehouse ID')).toHaveValue('112668');
    expect(screen.getByText('Phone missing')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Sync Kargonomi warehouse details' }));

    await waitFor(() => expect(syncKargonomiWarehouseDetailsMock).toHaveBeenCalledWith('sporjinal', '112668'));
    expect(await screen.findByText('Kargonomi warehouse details synced.')).toBeInTheDocument();
    expect(screen.getByText('Phone present')).toBeInTheDocument();
    expect(screen.getByText('State ID present')).toBeInTheDocument();
    expect(screen.getByText('City ID present')).toBeInTheDocument();
  }, 20000);

  it('preserves Kargonomi automatic carrier selection when carrier id is empty', async () => {
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
    getShippingProviderDiagnosticsMock.mockImplementation((options?: { provider?: string }) =>
      Promise.resolve({
        provider: options?.provider ?? 'kargonomi',
        supportedProviders: ['kargonomi'],
        executionReady: true,
        sandboxModeEnabled: false,
        shippingExecutionEnabled: true,
        providerSelected: options?.provider === 'kargonomi',
        providerEnabled: true,
        webhookIngestEnabled: false,
        baseUrlConfigured: true,
        apiKeyConfigured: true,
        cargoIntegrationIdConfigured: false,
        warehouseIdConfigured: true,
        defaultDesiConfigured: true,
        packageTypeUsed: '',
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
    getAdminVendorShippingConfigMock.mockResolvedValueOnce({
      vendorId: 'sporjinal',
      preferredProvider: 'kargonomi',
      shippingEnabled: true,
      defaultDesi: '3.00',
      cargoIntegrationId: null,
      defaultWarehouseId: '112668',
      shippingVatPercent: '18.00',
      warehouses: [],
      providerMetadata: {
        kargonomiBuyerStateId: '34',
        kargonomiBuyerCityId: '828',
      },
      source: 'configured',
      updatedAt: '2026-05-15T19:45:00.000Z',
    });

    renderOrderDetail();

    await user.selectOptions(await screen.findByLabelText('Provider', {}, { timeout: 10000 }), 'kargonomi');
    const warehouseInput = await screen.findByLabelText('Warehouse ID');
    const carrierInput = await screen.findByLabelText(/Kargonomi carrier\/provider ID/);
    expect(carrierInput).toHaveValue('');
    await user.clear(warehouseInput);
    await user.type(warehouseInput, '112668');
    await user.click(screen.getByRole('button', { name: 'Save shipping config' }));

    await waitFor(() => expect(updateVendorShippingConfigMock).toHaveBeenCalled());
    const savedPayload = updateVendorShippingConfigMock.mock.calls.at(-1)?.[1] as { providerMetadata?: Record<string, unknown> };
    expect(savedPayload.providerMetadata).not.toHaveProperty('kargonomiShippingProviderId');
  }, 10000);

  it('keeps Navlungo hidden from the active provider editor', async () => {
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

    const providerSelect = await screen.findByLabelText('Provider', {}, { timeout: 10000 });
    expect(providerSelect).toHaveValue('kargonomi');
    expect(screen.queryByRole('option', { name: 'Navlungo' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Run Navlungo auth diagnostic' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run Kargonomi lookup diagnostic' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Navlungo sender address ID')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Navlungo Create Post probe controls')).not.toBeInTheDocument();
    expect(updateVendorShippingConfigMock).not.toHaveBeenCalled();
    expect(runtimeDiagnosticsMocks.navlungoAuth).not.toHaveBeenCalled();
    expect(runtimeDiagnosticsMocks.navlungoCarriers).not.toHaveBeenCalled();
    expect(runtimeDiagnosticsMocks.navlungoCreatePostProbe).not.toHaveBeenCalled();
    expect(createShipmentExecutionMock).not.toHaveBeenCalled();
    expect(submitFulfillmentTrackingMock).not.toHaveBeenCalled();
  });

  it('normalizes saved Navlungo config to Kargonomi for active editing', async () => {
    setCurrentUser({
      email: 'admin@demo.com',
      name: 'Demo Admin',
      role: 'admin',
      vendorAccess: ['sporjinal'],
      vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
      canSwitchVendors: true,
      defaultVendorId: 'sporjinal',
    });
    getAdminVendorShippingConfigMock.mockResolvedValueOnce({
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

    renderOrderDetail();

    const providerSelect = await screen.findByLabelText('Provider', {}, { timeout: 10000 });
    expect(providerSelect).toHaveValue('kargonomi');
    expect(screen.queryByLabelText('Navlungo sender address ID')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Navlungo return recipient address ID')).not.toBeInTheDocument();
    expect(screen.queryByText('Full sender details for diagnostics')).not.toBeInTheDocument();
    expect(screen.queryByText('Return recipient address book details')).not.toBeInTheDocument();
    expect(updateVendorShippingConfigMock).not.toHaveBeenCalled();
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
          lastProviderStage: 'confirm_price',
          confirmShipmentId: '123',
          confirmShippingProviderId: '9',
          providerError: 'Kargonomi shipping price confirmation failed with HTTP 422.',
          providerErrorMessage: 'Shipping provider cannot be confirmed.',
          providerErrorErrors: {
            shipping_provider_id: ['Selected carrier quote is invalid.'],
            phone: '[redacted]',
          },
          providerErrorBodyPreview: {
            message: 'Shipping provider cannot be confirmed.',
            errors: {
              shipping_provider_id: ['Selected carrier quote is invalid.'],
              phone: '[redacted]',
            },
          },
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

    const carrierRow = (await screen.findByText('Carrier', { exact: true })).closest('.summary-row');
    expect(carrierRow).not.toBeNull();
    expect(within(carrierRow as HTMLElement).getByText('Kargonomi', { exact: true })).toBeInTheDocument();
    expect(screen.queryByLabelText('Try OTO return shipment')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Try OTO shipment status refresh')).not.toBeInTheDocument();
    expect(screen.queryByText('Try OTO status refresh')).not.toBeInTheDocument();
    expect(screen.queryByText('should-not-render')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add tracking information' })).not.toBeInTheDocument();
    expect(screen.queryByText('Carrier update attempted')).not.toBeInTheDocument();
    expect(screen.queryByText('Last carrier update')).not.toBeInTheDocument();
    expect(screen.queryByText('Confirm price')).not.toBeInTheDocument();
    expect(screen.getByText('Kargonomi shipping price confirmation failed with HTTP 422.')).toBeInTheDocument();
  });

  it('lets admins refresh existing Kargonomi provider shipment data without retrying creation', async () => {
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
      outboundMethodSnapshot: 'VENDOR_INTEGRATION', outboundIntegrationProviderSnapshot: 'SOPYO',
      carrier: 'kargonomi',
      shipmentExecution: {
        ...orderWithShipmentSummary.shipmentExecution!,
        id: 'shipment-kargonomi-alloc-sporjinal-7621783322961',
        provider: 'kargonomi',
        providerCarrierName: 'Sürat Kargo',
        warehouseId: '112668',
        providerShipmentId: '2653543',
        trackingNumber: null,
        trackingUrl: null,
        labelUrl: null,
        barcode: null,
        shipmentStatus: 'created',
      },
    });

    renderOrderDetail();

    await user.click(await screen.findByRole('button', { name: 'Refresh provider data' }));

    expect(refreshShipmentProviderDataMock).toHaveBeenCalledWith('shipment-kargonomi-alloc-sporjinal-7621783322961', {
      vendorId: 'sporjinal',
    });
    expect(createShipmentExecutionMock).not.toHaveBeenCalled();
    expect(retryFailedShipmentExecutionMock).not.toHaveBeenCalled();
    expect((await screen.findAllByText('Provider shipment data refreshed.')).length).toBeGreaterThan(0);
    expect(screen.getByText(/Endpoint:\s*POST \/shipments\/shipment-kargonomi-alloc-sporjinal-7621783322961\/refresh-provider-data/)).toBeInTheDocument();
  });

  it('shows cancelled Kargonomi shipment status while preserving historical tracking and label', async () => {
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
      carrier: 'kargonomi',
      trackingNumber: null,
      trackingUrl: null,
      shipmentExecution: {
        ...orderWithShipmentSummary.shipmentExecution!,
        id: 'shipment-kargonomi-alloc-sporjinal-7621783322961',
        provider: 'kargonomi',
        providerCarrierName: 'Sürat Kargo',
        warehouseId: '112668',
        providerShipmentId: '2653543',
        trackingNumber: 'KSUR2653543SKDXP',
        trackingUrl: 'https://tracking.test/KSUR2653543SKDXP',
        labelUrl: 'data:application/pdf;base64,JVBER',
        barcode: 'KSUR2653543SKDXP',
        shipmentStatus: 'cancelled',
        providerResponseSummary: {
          ...orderWithShipmentSummary.shipmentExecution!.providerResponseSummary!,
          provider: 'kargonomi',
          kargonomiCancelled: true,
          providerStatus: 'cancelled',
          providerStatusLabel: 'İptal edildi',
        },
      },
    });

    renderOrderDetail();

    expect(await screen.findByText(/Kargonomi shipment cancelled/)).toBeInTheDocument();
    expect(screen.getByText(/Tracking and label are retained as historical data/)).toBeInTheDocument();
    expect(screen.getByText('KSUR2653543SKDXP')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh provider data' })).toBeInTheDocument();
  });

  it('renders sanitized Kargonomi confirm-price diagnostics for admins', async () => {
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
      carrier: 'kargonomi',
      shipmentExecution: {
        ...orderWithShipmentSummary.shipmentExecution!,
        id: 'shipment-kargonomi-alloc-sporjinal-7621783322961',
        provider: 'kargonomi',
        providerCarrierName: 'Kargonomi',
        warehouseId: '112668',
        shipmentStatus: 'failed',
        providerResponseSummary: {
          ...orderWithShipmentSummary.shipmentExecution!.providerResponseSummary!,
          providerApiCallAttempted: true,
          lastProviderStage: 'confirm_price',
          confirmShipmentId: '123',
          confirmShippingProviderId: '9',
          providerError: 'Kargonomi shipping price confirmation failed with HTTP 422.',
          providerErrorMessage: 'Shipping provider cannot be confirmed.',
          providerErrorErrors: {
            shipping_provider_id: ['Selected carrier quote is invalid.'],
            phone: '[redacted]',
          },
          providerErrorBodyPreview: {
            message: 'Shipping provider cannot be confirmed.',
            errors: {
              shipping_provider_id: ['Selected carrier quote is invalid.'],
              phone: '[redacted]',
            },
          },
          kargonomiPostCreateDiagnostics: {
            getShipmentAfterConfirm: {
              httpStatus: 200,
              contentType: 'application/json',
              bodyKeys: ['shipment'],
              safeFields: {
                id: '2653543',
                status: 'webservice_order_created',
                status_label: 'Kargo Oluşturuldu',
                shipping_provider_name: 'Sürat Kargo',
                shipping_provider_slug: 'surat',
                shipping_webservice_order_id: 'WS-1',
                shipping_webservice_barcode: 'KSUR2653543SKDXP',
                shipment_packages: [{ barcode: 'PKG-BAR-1' }],
              },
            },
            barcodeFetch: {
              httpStatus: 200,
              contentType: 'application/json',
              topLevelKeys: ['barcode_pdf_base64'],
              bodyKeys: ['barcode_pdf_base64'],
              detectedFormat: 'pdf_like_value',
              pdfLikeValuePresent: true,
              labelUrlPresent: true,
            },
          },
        },
      },
    });

    renderOrderDetail();

    expect(await screen.findByLabelText('Kargonomi execution diagnostics')).toBeInTheDocument();
    expect(screen.getByText(/shipment\s+123\s+·\s+shipping_provider_id\s+9/)).toBeInTheDocument();
    expect(screen.getByText('Post-create safe fields')).toBeInTheDocument();
    expect(screen.getByText(/KSUR2653543SKDXP/)).toBeInTheDocument();
    expect(screen.getByText(/Sürat Kargo/)).toBeInTheDocument();
    expect(screen.getByText('Barcode fetch response')).toBeInTheDocument();
    expect(screen.getByText(/pdf_like_value/)).toBeInTheDocument();
    expect(screen.getAllByText('Shipping provider cannot be confirmed.').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Selected carrier quote is invalid/).length).toBeGreaterThan(0);
    expect(screen.queryByText('5551112233')).not.toBeInTheDocument();
  });

  it('keeps shipment actions available for vendor orders when Try OTO is the saved provider', async () => {
    getOrderMock.mockResolvedValue(orderWithoutShipment);
    getAdminVendorShippingConfigMock.mockResolvedValueOnce({
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
    getAdminVendorShippingConfigMock.mockResolvedValueOnce({
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
    expect(screen.queryByLabelText('Cargo integration ID')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Warehouse ID')).toHaveValue('112668');
    expect(screen.getByLabelText('Default desi')).toHaveValue(3);
    expect(screen.queryByLabelText('Package type')).not.toBeInTheDocument();
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
    await user.type(warehouseInput, 'warehouse-112668');
    await user.click(screen.getByRole('button', { name: 'Save shipping config' }));

    expect(await screen.findByText('Kargonomi warehouse ID must be numeric.')).toBeInTheDocument();
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

  it('renders the existing district completion input for admin failed Hepsijet shipments', async () => {
    getOrderMock.mockResolvedValueOnce({
      ...orderWithShipmentSummary,
      shipmentExecution: {
        ...orderWithShipmentSummary.shipmentExecution!,
        provider: 'hepsijet',
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
        provider: 'hepsijet',
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

  it('keeps full Navlungo sender retry diagnostics admin-only for vendors', async () => {
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

    expect(screen.queryByLabelText('Use full Navlungo sender details for this retry')).not.toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Retry shipment' }));

    await waitFor(() =>
      expect(retryFailedShipmentExecutionMock).toHaveBeenCalledWith('shipment-navlungo-alloc-sporjinal-7621783322961', {
        vendorId: 'sporjinal',
        customerOverrides: undefined,
        useFullSenderDetailsForThisRetry: undefined,
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

    expect(await screen.findByRole('button', { name: 'Refresh shipment status' })).toBeInTheDocument();
    expect(screen.getAllByText('Carrier reported address validation issue.').length).toBeGreaterThan(0);
    const timeline = screen.getByRole('heading', { name: 'Activity' }).closest('article');
    expect(timeline).not.toBeNull();
    expect(within(timeline as HTMLElement).getByText('Transfer Aşamasında')).toBeInTheDocument();
    expect(within(timeline as HTMLElement).getAllByText('Transfer Aşamasında')).toHaveLength(1);
    expect(within(timeline as HTMLElement).getAllByText('Transfer merkezinde').length).toBeGreaterThan(0);
    expect(screen.getAllByText('SURAT-1054').length).toBeGreaterThan(0);
    expect(screen.queryByText('Barcode status')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Refresh shipment status' }));

    expect(refreshShipmentExecutionStatusMock).toHaveBeenCalledWith('shipment-navlungo-alloc-sporjinal-7621783322961', {
      vendorId: 'sporjinal',
    });
    await waitFor(() => expect(getOrderMock).toHaveBeenCalledTimes(2));
    expect((await screen.findAllByText('Shipment status refreshed.')).length).toBeGreaterThan(0);
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

      expect(await screen.findByRole('button', { name: 'Open label PDF' })).toBeInTheDocument();
      expect(screen.queryByText('Same as tracking')).not.toBeInTheDocument();
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

  it('renders polished Try OTO shipment links without a tracking-backed barcode placeholder', async () => {
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

    expect(await screen.findByText('Sürat Kargo')).toBeInTheDocument();
    expect(screen.queryByText('Try Oto')).not.toBeInTheDocument();
    expect(screen.getByText('Shipment processing')).toBeInTheDocument();
    expect(screen.queryByText('SearchingDriver')).not.toBeInTheDocument();
    expect(screen.queryByText('Shipment reference')).not.toBeInTheDocument();
    expect(screen.queryByText('Provider id')).not.toBeInTheDocument();
    expect(screen.queryByText('shopify-cmpce0fbh0003cf3odp0j35yw-allocation-alloc-sporjinal-7621783322961')).not.toBeInTheDocument();
    expect(screen.queryByText('shopify-cmpce0fbh0003cf3...1783322961')).not.toBeInTheDocument();
    expect(screen.queryByText('Same as tracking')).not.toBeInTheDocument();
    expect(screen.queryByText('Additional shipment details')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open tracking' })).toHaveAttribute('href', 'https://tracking.tryoto.example/OTO-TRACK-1028');
    expect(screen.getByRole('button', { name: 'Open label PDF' })).toBeInTheDocument();
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
    expect(screen.getByRole('button', { name: 'Open return label PDF' })).toBeInTheDocument();
    const timeline = screen.getByRole('heading', { name: 'Activity' }).closest('article');
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
    expect(screen.getByRole('button', { name: 'Open return label PDF' })).toBeInTheDocument();
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
    expect(screen.queryByRole('button', { name: 'Open return label PDF' })).not.toBeInTheDocument();
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
    expect(screen.getByRole('button', { name: 'Open return label PDF' })).toBeInTheDocument();
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
    expect(screen.queryByRole('button', { name: 'Open return label PDF' })).not.toBeInTheDocument();
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
      email: 'admin@example.com',
      name: 'Admin User',
      role: 'admin',
      vendorAccess: ['sporjinal'],
      vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
      canSwitchVendors: true,
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
      email: 'admin@example.com',
      name: 'Admin User',
      role: 'admin',
      vendorAccess: ['sporjinal'],
      vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
      canSwitchVendors: true,
      defaultVendorId: 'sporjinal',
    });

    renderOrderDetail();

    expect(
      await screen.findByText('Pending · Tracking is stored locally, but Shopify fulfillment has not been confirmed.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Shopify fulfillment diagnostics')).toBeInTheDocument();
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
      email: 'admin@example.com',
      name: 'Admin User',
      role: 'admin',
      vendorAccess: ['sporjinal'],
      vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
      canSwitchVendors: true,
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

  it('syncs Kargonomi shipment tracking to Shopify with the refreshed carrier and tracking values', async () => {
    const user = userEvent.setup();
    submitFulfillmentTrackingMock.mockResolvedValueOnce({
      ok: true,
      allocationId: 'alloc-sporjinal-7621783322961',
      trackingNumber: 'KSUR2653543SKDXP',
      carrier: 'Sürat Kargo',
      trackingUrl: null,
      notifyCustomer: false,
      fulfillmentStatus: 'fulfillment_submitted',
      shippingStatus: 'shipped',
      shopifySyncSource: 'shopify_admin',
      shopifyFulfillmentId: 'gid://shopify/Fulfillment/2653543',
      fulfilledAt: '2026-05-15T19:47:00.000Z',
      shipmentCreatedAt: '2026-05-15T19:46:00.000Z',
      shipmentUpdatedAt: '2026-05-15T19:47:00.000Z',
    });
    getOrderMock.mockResolvedValue({
      ...orderWithShipmentSummary,
      carrier: 'Sürat Kargo',
      trackingNumber: null,
      trackingUrl: null,
      fulfilledAt: undefined,
      shipmentExecution: {
        ...orderWithShipmentSummary.shipmentExecution!,
        id: 'shipment-kargonomi-alloc-sporjinal-7621783322961',
        provider: 'kargonomi',
        providerCarrierName: 'Sürat Kargo',
        shipmentStatus: 'created',
        providerShipmentId: '2653543',
        trackingNumber: 'KSUR2653543SKDXP',
        trackingUrl: null,
        barcode: 'data:application/pdf;base64,JVBERi0xLjQ=',
        labelUrl: 'data:application/pdf;base64,JVBERi0xLjQ=',
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
      trackingNumber: 'KSUR2653543SKDXP',
      carrier: 'Sürat Kargo',
      trackingUrl: undefined,
      notifyCustomer: false,
    });
    expect(await screen.findByText('Tracking KSUR2653543SKDXP synced to Shopify.')).toBeInTheDocument();
  });

  it('does not show Shopify sync action for Kargonomi when tracking is missing', async () => {
    getOrderMock.mockResolvedValue({
      ...orderWithShipmentSummary,
      carrier: 'Sürat Kargo',
      trackingNumber: null,
      fulfilledAt: undefined,
      shipmentExecution: {
        ...orderWithShipmentSummary.shipmentExecution!,
        id: 'shipment-kargonomi-alloc-sporjinal-7621783322961',
        provider: 'kargonomi',
        providerCarrierName: 'Sürat Kargo',
        shipmentStatus: 'created',
        providerShipmentId: '2653543',
        trackingNumber: null,
        trackingUrl: null,
        barcode: 'data:application/pdf;base64,JVBERi0xLjQ=',
        labelUrl: 'data:application/pdf;base64,JVBERi0xLjQ=',
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

    await screen.findByRole('heading', { name: /Order #1028/i });
    expect(screen.queryByRole('button', { name: 'Sync tracking to Shopify' })).not.toBeInTheDocument();
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

    expect(await screen.findByRole('button', { name: 'Open label PDF' })).toBeInTheDocument();
    expect(screen.queryByText('Same as tracking')).not.toBeInTheDocument();
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

  it('U6 keeps existing integration-allocation tracking and label access without creation', async () => {
    setCurrentUser({ email: 'admin@example.test', name: 'Admin', role: 'admin', vendorAccess: ['sporjinal'],
      vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }], canSwitchVendors: false, defaultVendorId: 'sporjinal' });
    getOrderMock.mockResolvedValue({ ...orderWithoutShipment,
      shipmentExecution: { ...orderWithShipmentSummary.shipmentExecution!, labelUrl: 'https://example.test/label.pdf', trackingUrl: 'https://example.test/track' },
      outboundMethodSnapshot: 'VENDOR_INTEGRATION', outboundIntegrationProviderSnapshot: 'SOPYO' });
    renderOrderDetail();
    const region = await screen.findByRole('region', { name: 'Smart label action' });
    expect(within(region).getByRole('button')).toBeEnabled();
    expect(screen.getAllByRole('link', { name: /tracking/i }).length).toBeGreaterThan(0);
    expect(createShipmentExecutionMock).not.toHaveBeenCalled();
    expect(retryFailedShipmentExecutionMock).not.toHaveBeenCalled();
  });

  it.each(['admin', 'vendor'] as const)('U6 blocks new integration outbound create for %s', async (role) => {
    setCurrentUser({ email: 'test@example.test', name: 'Test', role, vendorAccess: ['sporjinal'],
      vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }], canSwitchVendors: false, defaultVendorId: 'sporjinal' });
    getOrderMock.mockResolvedValue({ ...orderWithoutShipment, outboundMethodSnapshot: 'VENDOR_INTEGRATION', outboundIntegrationProviderSnapshot: 'SOPYO' });
    renderOrderDetail();
    const region = await screen.findByRole('region', { name: 'Smart label action' });
    const button = within(region).getByRole('button');
    expect(button).toBeDisabled();
    await userEvent.click(button);
    expect(createShipmentExecutionMock).not.toHaveBeenCalled();
    expect(screen.getAllByText(/allocation uses Vendor Integration/).length).toBeGreaterThan(0);
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

    const createShipmentButton = await screen.findByRole('button', { name: 'Create shipment' });
    expect(screen.getByRole('heading', { name: 'Fulfillment' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Shipment & delivery' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Shipment' })).not.toBeInTheDocument();
    expect(screen.getByText('Tracking missing')).toBeInTheDocument();
    expect(screen.getByText('Awaiting shipment')).toBeInTheDocument();
    expect(screen.queryByText('Tracking is not visible to the operational workspace yet.')).not.toBeInTheDocument();
    expect(screen.queryByText('Create shipment or add tracking when the package is ready.')).not.toBeInTheDocument();
    expect(screen.getByText('Add shipment details when the package is ready.')).toBeInTheDocument();
    expect(createShipmentButton).toHaveClass('button-primary');
    expect(screen.getByRole('button', { name: 'Add tracking information' })).toHaveClass('button-secondary');

    await user.click(createShipmentButton);

    expect(createShipmentExecutionMock).toHaveBeenCalledWith('alloc-sporjinal-7621783322961', {
      vendorId: 'sporjinal',
      customerOverrides: undefined,
    });
    expect((await screen.findAllByText('Shipment action completed.')).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Endpoint:\s*POST \/shipments\/create/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Provider id: yes · Barcode: yes/)).not.toBeInTheDocument();
    expect(screen.queryByText('ke-created-1028')).not.toBeInTheDocument();
    expect(screen.getByText('barcode-1028')).toBeInTheDocument();
    await waitFor(() => expect(getOrderMock).toHaveBeenCalledTimes(2));
  });

  it('disables shipment actions for restricted vendors', async () => {
    const user = userEvent.setup();
    getOrderMock.mockResolvedValue(orderWithoutShipment);
    setCurrentUser({
      email: 'vendor@example.com',
      name: 'Sporjinal Vendor',
      role: 'vendor',
      vendorAccess: ['sporjinal'],
      vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal', status: 'inactive' }],
      canSwitchVendors: false,
      defaultVendorId: 'sporjinal',
    });

    renderOrderDetail();

    expect((await screen.findAllByText('Unavailable while your account is restricted.')).length).toBeGreaterThan(0);
    const createShipmentButton = screen.getByRole('button', { name: 'Create shipment' });
    expect(createShipmentButton).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add tracking information' })).toBeDisabled();
    const orderIssue = screen.getByLabelText('Order issue');
    expect(within(orderIssue).getByText('Unavailable while your account is restricted.')).toBeInTheDocument();
    expect(within(orderIssue).queryByRole('button', { name: 'Reject selected items' })).not.toBeInTheDocument();
    expect(within(orderIssue).getByRole('button', { name: 'Reject full order' })).toBeDisabled();

    await user.click(createShipmentButton);

    expect(createShipmentExecutionMock).not.toHaveBeenCalled();
    expect(submitFulfillmentTrackingMock).not.toHaveBeenCalled();
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
    const shipmentError = screen.getByText('Shipment action needs attention.').closest('.shipment-action-feedback');
    expect(shipmentError).toHaveClass('action-error');
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

  it('shows clear Kargonomi invalid destination create shipment errors', async () => {
    const user = userEvent.setup();
    getOrderMock.mockResolvedValue(orderWithoutShipment);
    createShipmentExecutionMock.mockRejectedValueOnce(
      new Error(
        [
          'Order destination address is invalid or incomplete. Kargonomi shipment was blocked before provider call.',
          'invalidOrderDestination: true',
          'skippedReason: invalid_order_destination',
          'Missing required shipment fields:',
          '- buyer.buyer_address',
          '- buyer.buyer_state_id',
          '- buyer.buyer_city_id',
          '',
          'Provider request blocked before create call.',
        ].join('\n'),
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

    expect((await screen.findAllByText('Order destination address is invalid or incomplete. Kargonomi shipment was blocked before provider call.')).length).toBeGreaterThan(0);
    expect(screen.queryByText('invalidOrderDestination: true')).not.toBeInTheDocument();
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

    expect(await screen.findByLabelText('Navlungo retry diagnostics')).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Navlungo' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Run Navlungo Create Post probe' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Navlungo probe retry request diff')).not.toBeInTheDocument();
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
  }, 10000);

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

    await screen.findByText('Contact support');
    expect(screen.queryByLabelText('Finance timeline')).not.toBeInTheDocument();
    expect(screen.queryByText('Settlement preview generated')).not.toBeInTheDocument();
    expect(screen.queryByText('Settlement awaiting review')).not.toBeInTheDocument();
    expect(screen.queryByText('Payment evidence pending')).not.toBeInTheDocument();
    expect(screen.queryByText('Evidence pending')).not.toBeInTheDocument();
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
    getOrderMock.mockResolvedValueOnce(orderWithoutShipment);
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
    const currentState = screen.getByLabelText('Current order state');
    expect(within(currentState).getByText('Active')).toBeInTheDocument();
    expect(within(currentState).queryByText('Pending')).not.toBeInTheDocument();
    expect(within(currentState).queryByText('Return active')).not.toBeInTheDocument();
    expect(within(currentState).queryByText('Finance projection')).not.toBeInTheDocument();
    expect(within(currentState).queryByText('Next operational action')).not.toBeInTheDocument();
    expect(within(currentState).queryByText('In flow')).not.toBeInTheDocument();
    expect(within(currentState).queryByText('Continue fulfillment')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Fulfillment' })).toBeInTheDocument();
    expect(screen.getByText('Add shipment details when the package is ready.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create shipment' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add tracking information' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Primary operational status')).not.toBeInTheDocument();
    const alertRegion = screen.getByLabelText('Operational alerts');
    expect(within(alertRegion).getByText(/Customer return requested/i)).toBeInTheDocument();
    expect(within(alertRegion).getByRole('link', { name: 'Open return details' })).toHaveAttribute('href', '/returns/return-1028');
    const shippingSummary = screen.getByLabelText('Shipping address summary');
    expect(shippingSummary).toHaveTextContent('Ship to');
    expect(shippingSummary).toHaveTextContent('Shipping street 9 · Kadikoy · Istanbul · 34710 · TR');
    expect(screen.queryByText('Shipping address will appear when available.')).not.toBeInTheDocument();
    const returnLink = screen.getByRole('link', { name: /Return for #1028/i });
    expect(returnLink).toHaveAttribute('href', '/returns/return-1028');
    expect(screen.queryByRole('link', { name: /Settlement activity/i })).not.toBeInTheDocument();
    const linkedRecord = screen.getByRole('heading', { name: 'Linked record' }).closest('.order-linked-records-panel');
    expect(linkedRecord).toHaveTextContent('Return linked');
    expect(screen.queryByRole('heading', { name: 'Linked records' })).not.toBeInTheDocument();
    expect(screen.queryByText('Pending review')).not.toBeInTheDocument();
    expect(screen.queryByText('TRY 4,999.00 · Pending')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Finance timeline')).not.toBeInTheDocument();
    expect(screen.queryByText('Refund impact pending')).not.toBeInTheDocument();
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

  it('hides the previous Vendor order and form while the selected Vendor detail is pending', async () => {
    setCurrentUser({
      email: 'admin@demo.com', name: 'Demo Admin', role: 'admin',
      vendorAccess: ['sporjinal', 'yalispor'],
      vendorDetails: [
        { vendorId: 'sporjinal', vendorName: 'Sporjinal' },
        { vendorId: 'yalispor', vendorName: 'Yalıspor' },
      ],
      canSwitchVendors: true, defaultVendorId: 'sporjinal',
    });
    const nextOrder = deferred<OrderDetail>();
    getOrderMock.mockImplementation((_id, options) => options?.vendorId === 'yalispor'
      ? nextOrder.promise
      : Promise.resolve(orderWithShipmentSummary));
    renderOrderDetail();
    expect(await screen.findByText('Order #1028')).toBeInTheDocument();

    act(() => setCurrentVendorId('yalispor'));
    expect(screen.queryByText('Order #1028')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Order detail render frame')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create shipment' })).not.toBeInTheDocument();
    await waitFor(() => expect(getOrderMock).toHaveBeenCalledWith(orderWithShipmentSummary.id, expect.objectContaining({ vendorId: 'yalispor' })));

    await act(async () => nextOrder.resolve({
      ...orderWithShipmentSummary,
      originalVendorId: 'yalispor', assignedVendorId: 'yalispor', vendorId: 'yalispor',
      sourceShopifyOrderNumber: '#2099', amount: 'TRY 8,888.00',
    }));
    expect(await screen.findByText('Order #2099')).toBeInTheDocument();
    expect(screen.queryByText('Order #1028')).not.toBeInTheDocument();
  });

  it('rejects a late previous-Vendor order response after switching context', async () => {
    setCurrentUser({
      email: 'admin@demo.com', name: 'Demo Admin', role: 'admin',
      vendorAccess: ['sporjinal', 'yalispor'],
      vendorDetails: [
        { vendorId: 'sporjinal', vendorName: 'Sporjinal' },
        { vendorId: 'yalispor', vendorName: 'Yalıspor' },
      ],
      canSwitchVendors: true, defaultVendorId: 'sporjinal',
    });
    const oldOrder = deferred<OrderDetail>();
    const nextOrder = deferred<OrderDetail>();
    getOrderMock.mockImplementation((_id, options) => options?.vendorId === 'yalispor'
      ? nextOrder.promise : oldOrder.promise);
    renderOrderDetail();
    act(() => setCurrentVendorId('yalispor'));
    await act(async () => oldOrder.resolve(orderWithShipmentSummary));
    expect(screen.queryByText('Order #1028')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create shipment' })).not.toBeInTheDocument();
    await act(async () => nextOrder.resolve({
      ...orderWithShipmentSummary,
      originalVendorId: 'yalispor', assignedVendorId: 'yalispor', vendorId: 'yalispor',
      sourceShopifyOrderNumber: '#2099', amount: 'TRY 8,888.00',
    }));
    expect(await screen.findByText('Order #2099')).toBeInTheDocument();
    expect(screen.queryByText('Order #1028')).not.toBeInTheDocument();
  });

  it.each([
    ['save', 'success'], ['save', 'failure'], ['sync', 'success'], ['sync', 'failure'],
  ] as const)('keeps Order Detail Vendor B isolated from a pending Vendor A shipping %s %s', async (operation, outcome) => {
    const user = userEvent.setup();
    setCurrentUser({
      email: 'admin@demo.com', name: 'Demo Admin', role: 'admin',
      vendorAccess: ['sporjinal', 'yalispor'],
      vendorDetails: [
        { vendorId: 'sporjinal', vendorName: 'Sporjinal' },
        { vendorId: 'yalispor', vendorName: 'Yalıspor' },
      ],
      canSwitchVendors: true, defaultVendorId: 'sporjinal',
    });
    const aConfig = await getAdminVendorShippingConfigMock('sporjinal');
    const bConfig = {
      ...aConfig, vendorId: 'yalispor', defaultWarehouseId: '223344',
      warehouses: [{ ...aConfig.warehouses[0], id: 'warehouse-b', vendorId: 'yalispor', warehouseId: '223344', name: 'Yalıspor warehouse' }],
    };
    getAdminVendorShippingConfigMock.mockImplementation(async (id) => id === 'sporjinal' ? aConfig : bConfig);
    getOrderMock.mockImplementation(async (id, options) => options?.vendorId === 'yalispor'
      ? { ...orderWithShipmentSummary, id, originalVendorId: 'yalispor', assignedVendorId: 'yalispor', vendorId: 'yalispor', sourceShopifyOrderNumber: '#2099' }
      : orderWithShipmentSummary);
    const pending = deferred<unknown>();
    if (operation === 'save') updateVendorShippingConfigMock.mockReturnValue(pending.promise);
    else syncKargonomiWarehouseDetailsMock.mockReturnValue(pending.promise);
    const { queryClient } = renderOrderDetail();
    expect(await screen.findByLabelText('Warehouse ID')).toHaveValue('112668');
    await user.click(screen.getByRole('button', { name: operation === 'save' ? 'Save shipping config' : 'Sync Kargonomi warehouse details' }));
    if (operation === 'save') await waitFor(() => expect(updateVendorShippingConfigMock).toHaveBeenCalledWith('sporjinal', expect.any(Object)));
    else await waitFor(() => expect(syncKargonomiWarehouseDetailsMock).toHaveBeenCalledWith('sporjinal', '112668'));
    act(() => setCurrentVendorId('yalispor'));
    await user.click(screen.getByRole('link', { name: 'Open Vendor B order' }));
    expect(await screen.findByText('Order #2099')).toBeInTheDocument();
    expect(await screen.findByLabelText('Warehouse ID')).toHaveValue('223344');
    await user.clear(screen.getByLabelText('Warehouse ID'));
    await user.type(screen.getByLabelText('Warehouse ID'), '223345');
    await act(async () => {
      if (outcome === 'failure') pending.reject(new Error('Late Vendor A shipping failure.'));
      else pending.resolve(operation === 'save' ? aConfig : { syncedConfig: aConfig });
    });
    expect(screen.getByLabelText('Warehouse ID')).toHaveValue('223345');
    expect(screen.queryByText('Late Vendor A shipping failure.')).not.toBeInTheDocument();
    expect(screen.queryByText('Shipping provider configuration saved.')).not.toBeInTheDocument();
    expect(screen.queryByText('Kargonomi warehouse details synced.')).not.toBeInTheDocument();
    expect(queryClient.getQueryData(queryKeys.admin.shipments.vendorShippingConfig('yalispor'))).toMatchObject({ vendorId: 'yalispor', defaultWarehouseId: '223344' });
    expect(updateVendorShippingConfigMock).toHaveBeenCalledTimes(operation === 'save' ? 1 : 0);
    expect(syncKargonomiWarehouseDetailsMock).toHaveBeenCalledTimes(operation === 'sync' ? 1 : 0);
    expect(getOrderMock).toHaveBeenCalledWith('alloc-yalispor-2099', expect.objectContaining({ vendorId: 'yalispor' }));
  });

  it('does not accept a delayed Vendor A Shipping GET after Vendor B Order Detail loads', async () => {
    setCurrentUser({
      email: 'admin@demo.com', name: 'Demo Admin', role: 'admin',
      vendorAccess: ['sporjinal', 'yalispor'],
      vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }, { vendorId: 'yalispor', vendorName: 'Yalıspor' }],
      canSwitchVendors: true, defaultVendorId: 'sporjinal',
    });
    const aConfig = await getAdminVendorShippingConfigMock('sporjinal');
    const pendingA = deferred<typeof aConfig>();
    const bConfig = {
      ...aConfig, vendorId: 'yalispor', defaultWarehouseId: '223344',
      warehouses: [{ ...aConfig.warehouses[0], id: 'warehouse-b', vendorId: 'yalispor', warehouseId: '223344', name: 'Yalıspor warehouse' }],
    };
    getAdminVendorShippingConfigMock.mockImplementation((id) => id === 'sporjinal' ? pendingA.promise : Promise.resolve(bConfig));
    getOrderMock.mockImplementation(async (id, options) => options?.vendorId === 'yalispor'
      ? { ...orderWithShipmentSummary, id, originalVendorId: 'yalispor', assignedVendorId: 'yalispor', vendorId: 'yalispor', sourceShopifyOrderNumber: '#2099' }
      : orderWithShipmentSummary);
    renderOrderDetail();
    await waitFor(() => expect(getAdminVendorShippingConfigMock).toHaveBeenCalledWith('sporjinal', expect.any(Object)));
    act(() => setCurrentVendorId('yalispor'));
    await userEvent.click(screen.getByRole('link', { name: 'Open Vendor B order' }));
    expect(await screen.findByLabelText('Warehouse ID')).toHaveValue('223344');
    await act(async () => pendingA.resolve(aConfig));
    expect(screen.getByLabelText('Warehouse ID')).toHaveValue('223344');
    expect(screen.queryByText('Sporjinal warehouse')).not.toBeInTheDocument();
    expect(getAdminVendorShippingConfigMock).toHaveBeenCalledWith('yalispor', expect.any(Object));
  });

  describe('P01 Admin allocation finance summary preservation', () => {
    const summary: NonNullable<OrderDetail['allocationFinanceSummary']> = {
      available: true, resolutionStatus: 'resolved', productValue: '1234.56',
      commission: '123.45', commissionVat: '24.69', shippingDeduction: '45.67',
      shippingDeductionStatus: 'available', primaryPayable: { type: 'estimated', amount: '1040.75' },
      settlementStatus: 'accruing', payoutStatus: 'pending', paidAt: null,
    };
    function admin() {
      setCurrentUser({
        email: 'admin@demo.com', name: 'Demo Admin', role: 'admin',
        vendorAccess: ['sporjinal', 'yalispor'],
        vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }, { vendorId: 'yalispor', vendorName: 'Yalıspor' }],
        canSwitchVendors: true, defaultVendorId: 'sporjinal',
      });
    }
    function withSummary(overrides: Partial<typeof summary> = {}): OrderDetail {
      return { ...orderWithShipmentSummary, allocationFinanceSummary: { ...summary, ...overrides } };
    }
    async function section(overrides: Partial<typeof summary> = {}) {
      getOrderMock.mockResolvedValue(withSummary(overrides));
      renderOrderDetail();
      return within(await screen.findByRole('article', { name: 'Allocation finance summary' }));
    }
    beforeEach(admin);

    it('renders authoritative allocation amounts separately from existing order finance content and Shopify currency', async () => {
      getOrderMock.mockResolvedValue({ ...withSummary(), orderSnapshot: { ...orderWithShipmentSummary.orderSnapshot, currency: 'USD' } });
      renderOrderDetail();
      const card = within(await screen.findByRole('article', { name: 'Allocation finance summary' }));
      expect(card.getByText('Product value').nextElementSibling).toHaveTextContent('TRY 1,234.56');
      expect(card.getByText('Commission').nextElementSibling).toHaveTextContent('TRY 123.45');
      expect(card.getByText('Commission VAT').nextElementSibling).toHaveTextContent('TRY 24.69');
      expect(card.getByText('Shipping deduction').nextElementSibling).toHaveTextContent('TRY 45.67');
      expect(card.getByText('Shipping deduction status').nextElementSibling).toHaveTextContent('Available');
      expect(card.getByText('Estimated payable').nextElementSibling).toHaveTextContent('TRY 1,040.75');
      expect(card.queryByText('TRY 4,999.00')).not.toBeInTheDocument();
      expect(screen.getByLabelText('Order finance preview')).toBeInTheDocument();
      expect(createShipmentExecutionMock).not.toHaveBeenCalled();
    });

    it.each([
      ['estimated', 'Estimated payable'], ['approved', 'Approved payable'],
      ['paid_payout_contribution', 'Paid payout contribution'], ['cashless_offset_contribution', 'Completed by offsets (no EFT)'],
    ] as const)('preserves %s contribution authority without inferring paid evidence', async (type, label) => {
      const card = await section({ primaryPayable: { type, amount: '765.43' } });
      expect(card.getByText(label).nextElementSibling).toHaveTextContent('TRY 765.43');
      expect(card.queryByText('Paid at')).not.toBeInTheDocument();
      if (type !== 'paid_payout_contribution') expect(card.queryByText('Paid payout contribution')).not.toBeInTheDocument();
    });

    it.each([
      ['pending', 'Not prepared'], ['draft', 'Estimated'], ['review', 'Pending review'],
      ['execution_pending', 'Scheduled'], ['paid_placeholder', 'Payment evidence pending'],
      ['cashless_completed', 'Completed by offsets (no EFT)'], ['approved', 'Approved'], ['paid', 'Paid'], ['hold', 'Hold'],
    ] as const)('preserves the %s payout status independently from settlement', async (payoutStatus, label) => {
      const card = await section({ payoutStatus });
      expect(card.getByText('Payout').nextElementSibling).toHaveTextContent(label);
      expect(card.getByText('Settlement').nextElementSibling).toHaveTextContent('Accruing');
    });

    it('renders the supplied paid timestamp and paid contribution', async () => {
      const card = await section({ primaryPayable: { type: 'paid_payout_contribution', amount: '432.10' },
        payoutStatus: 'paid', settlementStatus: 'settled', paidAt: '2026-05-15T12:08:00.000Z' });
      expect(card.getByText('Paid payout contribution').nextElementSibling).toHaveTextContent('TRY 432.10');
      expect(card.getByText('Paid at').nextElementSibling).toHaveTextContent('May 15, 2026');
    });

    it.each(['pending', 'unavailable'] as const)('keeps %s shipping and null amounts unavailable rather than zero', async (shippingDeductionStatus) => {
      const card = await section({ productValue: null, commission: null, commissionVat: null,
        shippingDeduction: null, shippingDeductionStatus, primaryPayable: null, payoutStatus: null, settlementStatus: null });
      for (const label of ['Product value', 'Commission', 'Commission VAT', 'Shipping deduction', 'Payout']) {
        expect(card.getByText(label).nextElementSibling).toHaveTextContent('Not available');
      }
      expect(card.getByText('Settlement').nextElementSibling).toHaveTextContent('Not Available');
      expect(card.getByText('Shipping deduction status').nextElementSibling).toHaveTextContent(shippingDeductionStatus === 'pending' ? 'Pending' : 'Unavailable');
      expect(card.queryByText(/TRY 0/)).not.toBeInTheDocument();
      expect(card.queryByText('Estimated payable')).not.toBeInTheDocument();
    });

    it.each(['finance_record_unavailable', 'ambiguous_settlement_authority', 'ambiguous_payout_authority'])('fails closed for %s even if monetary fields are present', async (resolutionStatus) => {
      const card = await section({ available: false, resolutionStatus });
      expect(card.getByText('Finance data unavailable. Requires review.')).toBeInTheDocument();
      expect(card.queryByText(/TRY/)).not.toBeInTheDocument();
    });

    it('suppresses the existing negative partially-refunded estimate without suppressing other fields', async () => {
      const card = await section({ primaryPayable: { type: 'estimated', amount: '-77.77' }, settlementStatus: 'partially_refunded' });
      expect(card.queryByText('Estimated payable')).not.toBeInTheDocument();
      expect(card.queryByText(/77.77/)).not.toBeInTheDocument();
      expect(card.getByText('Settlement').nextElementSibling).toHaveTextContent('Refund recorded');
      expect(card.getByText('Product value').nextElementSibling).toHaveTextContent('TRY 1,234.56');
    });

    it('does not suppress a negative approved contribution using the estimate-only rule', async () => {
      const card = await section({ primaryPayable: { type: 'approved', amount: '-77.77' }, settlementStatus: 'partially_refunded' });
      expect(card.getByText('Approved payable').nextElementSibling).toHaveTextContent('-TRY 77.77');
    });

    it('does not invent a summary when the DTO omits it', async () => {
      renderOrderDetail();
      expect(await screen.findByText('Order #1028')).toBeInTheDocument();
      expect(screen.queryByRole('article', { name: 'Allocation finance summary' })).not.toBeInTheDocument();
    });

    it('preserves an explicit zero amount', async () => {
      const card = await section({ shippingDeduction: '0.00' });
      expect(card.getByText('Shipping deduction').nextElementSibling).toHaveTextContent('TRY 0.00');
    });

    it.each(['held', 'disputed'] as const)('keeps %s settlement without a primary payable', async (settlementStatus) => {
      const card = await section({ settlementStatus, primaryPayable: null });
      expect(card.queryByText('Estimated payable')).not.toBeInTheDocument();
      expect(card.getByText('Settlement').nextElementSibling).toHaveTextContent(settlementStatus === 'held' ? 'Held' : 'Disputed');
    });

    it.each(['vendor', 'support', 'finance'] as const)('does not render Admin summary data for %s even when a response contains it', async (role) => {
      setCurrentUser({ email: `${role}@demo.com`, name: role, role, vendorAccess: ['sporjinal'],
        vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }], canSwitchVendors: false, defaultVendorId: 'sporjinal' });
      getOrderMock.mockResolvedValue(withSummary());
      renderOrderDetail();
      expect(await screen.findByText('Order #1028')).toBeInTheDocument();
      expect(screen.queryByRole('article', { name: 'Allocation finance summary' })).not.toBeInTheDocument();
    });

    it('does not expose the summary when authentication is missing', async () => {
      clearToken();
      getOrderMock.mockResolvedValue(withSummary());
      renderOrderDetail();
      await waitFor(() => expect(screen.queryByText('Order #1028')).not.toBeInTheDocument());
      expect(screen.queryByRole('article', { name: 'Allocation finance summary' })).not.toBeInTheDocument();
      expect(getOrderMock).not.toHaveBeenCalled();
    });

    it('does not render the summary for a foreign allocation returned in the wrong Vendor context', async () => {
      getOrderMock.mockResolvedValue({ ...withSummary(), assignedVendorId: 'yalispor', vendorId: 'yalispor' });
      renderOrderDetail();
      await waitFor(() => expect(getOrderMock).toHaveBeenCalled());
      expect(screen.queryByRole('article', { name: 'Allocation finance summary' })).not.toBeInTheDocument();
      expect(screen.queryByText('Order #1028')).not.toBeInTheDocument();
    });

    it('fails closed when the backend denies allocation access', async () => {
      getOrderMock.mockRejectedValue(new ApiError('Forbidden', 'server', { status: 403 }));
      renderOrderDetail();
      await waitFor(() => expect(getOrderMock).toHaveBeenCalled());
      expect(screen.queryByRole('article', { name: 'Allocation finance summary' })).not.toBeInTheDocument();
    });

    it('keeps Admin A to B to A summaries isolated while each Vendor loads', async () => {
      const b = deferred<OrderDetail>();
      getOrderMock.mockImplementation(async (_id, options) => options?.vendorId === 'yalispor' ? b.promise : withSummary());
      renderOrderDetail();
      expect(await screen.findByRole('article', { name: 'Allocation finance summary' })).toHaveTextContent('TRY 1,234.56');
      act(() => setCurrentVendorId('yalispor'));
      expect(screen.queryByRole('article', { name: 'Allocation finance summary' })).not.toBeInTheDocument();
      await waitFor(() => expect(getOrderMock).toHaveBeenCalledWith(orderWithShipmentSummary.id, expect.objectContaining({ vendorId: 'yalispor' })));
      await act(async () => b.resolve({ ...withSummary({ productValue: '8888.88' }), assignedVendorId: 'yalispor', vendorId: 'yalispor' }));
      expect(await screen.findByRole('article', { name: 'Allocation finance summary' })).toHaveTextContent('TRY 8,888.88');
      act(() => setCurrentVendorId('sporjinal'));
      const card = await screen.findByRole('article', { name: 'Allocation finance summary' });
      expect(card).toHaveTextContent('TRY 1,234.56');
      expect(card).not.toHaveTextContent('TRY 8,888.88');
    });

    it('ignores a late Vendor A summary after Vendor B has rendered', async () => {
      const a = deferred<OrderDetail>();
      getOrderMock.mockImplementation(async (_id, options) => options?.vendorId === 'yalispor'
        ? { ...withSummary({ productValue: '8888.88' }), assignedVendorId: 'yalispor', vendorId: 'yalispor' } : a.promise);
      renderOrderDetail();
      await waitFor(() => expect(getOrderMock).toHaveBeenCalledWith(orderWithShipmentSummary.id, expect.objectContaining({ vendorId: 'sporjinal' })));
      act(() => setCurrentVendorId('yalispor'));
      expect(await screen.findByRole('article', { name: 'Allocation finance summary' })).toHaveTextContent('TRY 8,888.88');
      await act(async () => a.resolve(withSummary()));
      const card = screen.getByRole('article', { name: 'Allocation finance summary' });
      expect(card).toHaveTextContent('TRY 8,888.88');
      expect(card).not.toHaveTextContent('TRY 1,234.56');
    });
  });

  describe('I01 real Detail cache invalidation', () => {
    beforeEach(() => mutationQueryClient.clear());
    afterEach(() => { cleanup(); mutationQueryClient.clear(); });

    it.each([false, true])('refreshes only initiating Detail/list scope (late Vendor switch: %s)', async (switchVendor) => {
      setCurrentUser({ email: 'admin@demo.com', name: 'Admin', role: 'admin',
        vendorAccess: ['sporjinal', 'yalispor'], canSwitchVendors: true, defaultVendorId: 'sporjinal',
        vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }, { vendorId: 'yalispor', vendorName: 'Yalı Spor' }] });
      const a = orderWithoutShipment;
      const b = { ...a, id: 'alloc-yalispor-2099', assignedVendorId: 'yalispor', vendorId: 'yalispor', sourceShopifyOrderNumber: '#2099' };
      const aLists = [queryKeys.orders.list('sporjinal'), queryKeys.orders.list('sporjinal', { limit: 101, offset: 100 })];
      const untouched = [queryKeys.orders.list('yalispor'), queryKeys.orders.list('yalispor', { limit: 101 }),
        queryKeys.orders.detail('another-allocation', 'sporjinal'), queryKeys.finance.summary('sporjinal')];
      aLists.forEach((key) => mutationQueryClient.setQueryData(key, []));
      untouched.forEach((key) => mutationQueryClient.setQueryData(key, { untouched: true }));
      mutationQueryClient.setQueryData(queryKeys.orders.detail(a.id, 'sporjinal'), a);
      mutationQueryClient.setQueryData(queryKeys.orders.detail(b.id, 'yalispor'), b);
      getOrderMock.mockImplementation(async (id) => id === b.id ? b : a);
      const config = await getAdminVendorShippingConfigMock('sporjinal');
      getAdminVendorShippingConfigMock.mockImplementation(async (vendorId) => ({ ...config, vendorId }));
      const pending = deferred<NonNullable<OrderDetail['shipmentExecution']>>();
      createShipmentExecutionMock.mockReturnValue(pending.promise);
      renderOrderDetail(mutationQueryClient);
      await userEvent.click(await screen.findByRole('button', { name: 'Create shipment label' }));
      await waitFor(() => expect(createShipmentExecutionMock).toHaveBeenCalledWith(a.id,
        expect.objectContaining({ vendorId: 'sporjinal' })));
      if (switchVendor) {
        await act(async () => setCurrentVendorId('yalispor'));
        await userEvent.click(screen.getByRole('link', { name: 'Open Vendor B order' }));
        await screen.findByRole('heading', { name: 'Order #2099' });
      }
      await act(async () => pending.resolve({ ...orderWithShipmentSummary.shipmentExecution!, labelUrl: null }));
      await waitFor(() => expect(mutationQueryClient.isMutating()).toBe(0));
      aLists.forEach((key) => expect(mutationQueryClient.getQueryState(key)?.isInvalidated).toBe(true));
      untouched.forEach((key) => expect(mutationQueryClient.getQueryState(key)?.isInvalidated).toBe(false));
      if (switchVendor) {
        expect(mutationQueryClient.getQueryState(queryKeys.orders.detail(a.id, 'sporjinal'))?.isInvalidated).toBe(true);
        expect(mutationQueryClient.getQueryState(queryKeys.orders.detail(b.id, 'yalispor'))?.isInvalidated).toBe(false);
      } else {
        expect(getOrderMock).toHaveBeenCalledWith(a.id, expect.objectContaining({ vendorId: 'sporjinal' }));
        expect(mutationQueryClient.getQueryState(queryKeys.orders.detail(a.id, 'sporjinal'))?.isInvalidated).toBe(false);
      }
      expect(createShipmentExecutionMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('P02 shipment action and operational parity', () => {
    const openWindow = vi.fn();
    function actor(role: 'admin' | 'vendor' | 'support' = 'vendor', restricted = false) {
      setCurrentUser({ email: `${role}@demo.com`, name: role, role,
        vendorAccess: ['sporjinal', 'yalispor'],
        vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal', status: restricted ? 'inactive' : 'active' },
          { vendorId: 'yalispor', vendorName: 'Yalıspor' }],
        canSwitchVendors: role === 'admin', defaultVendorId: 'sporjinal' });
    }
    function shipment(overrides: Partial<NonNullable<OrderDetail['shipmentExecution']>> = {}) {
      return { ...orderWithShipmentSummary.shipmentExecution!, provider: 'kargonomi' as const,
        shipmentStatus: 'created' as const, providerShipmentId: null, barcode: null,
        providerResponseSummary: { ...orderWithShipmentSummary.shipmentExecution!.providerResponseSummary!,
          providerError: null, dryRun: false, disabledGates: [], ok: true }, ...overrides };
    }
    beforeEach(() => {
      actor();
      openWindow.mockReset();
      vi.stubGlobal('open', openWindow);
      getOrderMock.mockResolvedValue(orderWithoutShipment);
    });
    afterEach(() => vi.unstubAllGlobals());

    it('opens an existing label without creation or retry mutations', async () => {
      getOrderMock.mockResolvedValue({ ...orderWithoutShipment, shipmentExecution: shipment({ labelUrl: 'https://example.com/existing.pdf' }) });
      renderOrderDetail();
      await userEvent.click(await screen.findByRole('button', { name: 'Open shipping label' }));
      expect(openWindow).toHaveBeenCalledWith('https://example.com/existing.pdf', '_blank', 'noopener,noreferrer');
      expect(createShipmentExecutionMock).not.toHaveBeenCalled();
      expect(retryFailedShipmentExecutionMock).not.toHaveBeenCalled();
      expect(retryShipmentExecutionMock).not.toHaveBeenCalled();
    });

    it('uses the existing creation payload and opens the returned label once in the current context', async () => {
      createShipmentExecutionMock.mockResolvedValue(shipment({ providerShipmentId: 'P02-created', labelUrl: 'https://example.com/new.pdf' }));
      renderOrderDetail();
      const button = await screen.findByRole('button', { name: 'Create shipment label' });
      expect(createShipmentExecutionMock).not.toHaveBeenCalled();
      await userEvent.click(button);
      expect(createShipmentExecutionMock).toHaveBeenCalledExactlyOnceWith(orderWithoutShipment.id, { vendorId: 'sporjinal', customerOverrides: undefined });
      expect(await screen.findByRole('button', { name: 'Open shipping label' })).toBeEnabled();
      expect(openWindow).toHaveBeenCalledExactlyOnceWith('https://example.com/new.pdf', '_blank', 'noopener,noreferrer');
    });

    it('uses ordinary failed-shipment retry rather than Admin diagnostic retry', async () => {
      getOrderMock.mockResolvedValue({ ...orderWithoutShipment, shipmentExecution: shipment({ shipmentStatus: 'failed' }) });
      retryFailedShipmentExecutionMock.mockResolvedValue(shipment({ providerShipmentId: 'P02-retried', labelUrl: 'https://example.com/retried.pdf' }));
      renderOrderDetail();
      await userEvent.click(await screen.findByRole('button', { name: 'Retry shipment label' }));
      expect(retryFailedShipmentExecutionMock).toHaveBeenCalledExactlyOnceWith(orderWithShipmentSummary.shipmentExecution!.id,
        { vendorId: 'sporjinal', customerOverrides: undefined });
      expect(retryShipmentExecutionMock).not.toHaveBeenCalled();
      expect(createShipmentExecutionMock).not.toHaveBeenCalled();
      expect(await screen.findByRole('button', { name: 'Open shipping label' })).toBeEnabled();
      expect(openWindow).toHaveBeenCalledExactlyOnceWith('https://example.com/retried.pdf', '_blank', 'noopener,noreferrer');
    });

    it.each(['create', 'retry'] as const)('B3: Admin cannot %s a pending-reassignment shipment', async (action) => {
      actor('admin');
      getOrderMock.mockResolvedValue({ ...orderWithoutShipment,
        allocationStatus: 'pending_reassignment', reassignmentRequired: true, fulfillmentActionAvailable: false,
        shipmentExecution: action === 'retry' ? shipment({ shipmentStatus: 'failed', labelUrl: null }) : null,
      });
      renderOrderDetail();
      const button = await screen.findByRole('button', { name: action === 'retry' ? 'Retry shipment label' : 'Create shipment label' });
      expect(button).toBeDisabled();
      fireEvent.click(button);
      expect(createShipmentExecutionMock).not.toHaveBeenCalled();
      expect(retryFailedShipmentExecutionMock).not.toHaveBeenCalled();
    });

    it('U5: guides Admin to review a pending reassignment instead of continuing fulfillment', async () => {
      actor('admin');
      getOrderMock.mockResolvedValue({ ...orderWithoutShipment,
        allocationStatus: 'pending_reassignment', reassignmentRequired: true, fulfillmentActionAvailable: false,
      });
      renderOrderDetail();
      const currentState = await screen.findByLabelText('Current order state');
      expect(within(currentState).getByText('Pending Reassignment')).toBeInTheDocument();
      expect(within(currentState).getByText('Next operational action')).toBeInTheDocument();
      expect(within(currentState).getByText('Review allocation')).toBeInTheDocument();
      expect(within(currentState).queryByText('Continue fulfillment')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Create shipment label' })).toBeDisabled();
      expect(createShipmentExecutionMock).not.toHaveBeenCalled();
      expect(retryFailedShipmentExecutionMock).not.toHaveBeenCalled();
    });

    it('U5: retains Vendor pending-reassignment status without new guidance or shipment actions', async () => {
      actor('vendor');
      getOrderMock.mockResolvedValue({ ...orderWithoutShipment,
        allocationStatus: 'pending_reassignment', reassignmentRequired: true, fulfillmentActionAvailable: false,
      });
      renderOrderDetail();
      const currentState = await screen.findByLabelText('Current order state');
      expect(within(currentState).getByText('Pending Reassignment')).toBeInTheDocument();
      expect(within(currentState).getByText('Pending')).toBeInTheDocument();
      expect(within(currentState).queryByText('Review allocation')).not.toBeInTheDocument();
      expect(screen.queryByRole('region', { name: 'Smart label action' })).not.toBeInTheDocument();
      expect(createShipmentExecutionMock).not.toHaveBeenCalled();
      expect(retryFailedShipmentExecutionMock).not.toHaveBeenCalled();
    });

    it('B3: Admin retains existing-label access for pending reassignment', async () => {
      actor('admin');
      getOrderMock.mockResolvedValue({ ...orderWithoutShipment,
        allocationStatus: 'pending_reassignment', reassignmentRequired: true, fulfillmentActionAvailable: false,
        shipmentExecution: shipment({ labelUrl: 'https://example.com/existing-pending.pdf' }),
      });
      renderOrderDetail();
      const button = await screen.findByRole('button', { name: 'Open shipping label' });
      expect(button).toBeEnabled();
      await userEvent.click(button);
      expect(openWindow).toHaveBeenCalledWith('https://example.com/existing-pending.pdf', '_blank', 'noopener,noreferrer');
      expect(createShipmentExecutionMock).not.toHaveBeenCalled();
      expect(retryFailedShipmentExecutionMock).not.toHaveBeenCalled();
    });

    it.each(['pending', 'created'] as const)('does not retry a non-failed %s shipment without a label', async (shipmentStatus) => {
      getOrderMock.mockResolvedValue({ ...orderWithoutShipment, shipmentExecution: shipment({ shipmentStatus }) });
      renderOrderDetail();
      const button = await screen.findByRole('button', { name: 'Create shipment label' });
      expect(button).toBeDisabled();
      await userEvent.click(button);
      expect(screen.getByText('Shipment exists. Label availability is controlled by the provider.')).toBeInTheDocument();
      expect(createShipmentExecutionMock).not.toHaveBeenCalled();
      expect(retryFailedShipmentExecutionMock).not.toHaveBeenCalled();
    });

    it('blocks both Smart label and existing creation while the same request is pending', async () => {
      const pending = deferred<ReturnType<typeof shipment>>();
      createShipmentExecutionMock.mockReturnValue(pending.promise);
      renderOrderDetail();
      const smart = await screen.findByRole('button', { name: 'Create shipment label' });
      const existing = screen.getByRole('button', { name: 'Create shipment', exact: true });
      await act(async () => { fireEvent.click(smart); fireEvent.click(existing); fireEvent.click(smart); });
      expect(createShipmentExecutionMock).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('button', { name: 'Preparing shipping label...' })).toBeDisabled();
      await act(async () => pending.resolve(shipment({ providerShipmentId: 'P02-created', labelUrl: 'https://example.com/new.pdf' })));
      expect(await screen.findByRole('button', { name: 'Open shipping label' })).toBeEnabled();
    });

    it('releases the synchronous reservation after an error and presents the existing error feedback', async () => {
      createShipmentExecutionMock.mockRejectedValueOnce(new Error('P02 provider request rejected'));
      renderOrderDetail();
      await userEvent.click(await screen.findByRole('button', { name: 'Create shipment label' }));
      await waitFor(() => expect(screen.getAllByText('P02 provider request rejected').length).toBeGreaterThan(0));
      expect(screen.getByRole('button', { name: 'Create shipment label' })).toBeEnabled();
      await userEvent.click(screen.getByRole('button', { name: 'Create shipment label' }));
      expect(createShipmentExecutionMock).toHaveBeenCalledTimes(2);
    });

    it('does not create again when creation succeeds without a label', async () => {
      createShipmentExecutionMock.mockResolvedValue(shipment({ providerShipmentId: 'P02-created' }));
      renderOrderDetail();
      await userEvent.click(await screen.findByRole('button', { name: 'Create shipment label' }));
      await waitFor(() => expect(screen.getByRole('button', { name: 'Create shipment label' })).toBeDisabled());
      expect(screen.getByText('Shipment exists. Label availability is controlled by the provider.')).toBeInTheDocument();
      expect(openWindow).not.toHaveBeenCalled();
      expect(createShipmentExecutionMock).toHaveBeenCalledTimes(1);
    });

    it('blocks rapid failed-retry clicks and releases the reservation after rejection', async () => {
      const pending = deferred<ReturnType<typeof shipment>>();
      getOrderMock.mockResolvedValue({ ...orderWithoutShipment, shipmentExecution: shipment({ shipmentStatus: 'failed' }) });
      retryFailedShipmentExecutionMock.mockReturnValueOnce(pending.promise);
      renderOrderDetail();
      const button = await screen.findByRole('button', { name: 'Retry shipment label' });
      await act(async () => { fireEvent.click(button); fireEvent.click(button); });
      expect(retryFailedShipmentExecutionMock).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('button', { name: 'Preparing shipping label...' })).toBeDisabled();
      await act(async () => pending.reject(new Error('P02 retry failed')));
      expect(screen.getByRole('button', { name: 'Retry shipment label' })).toBeEnabled();
      await userEvent.click(screen.getByRole('button', { name: 'Retry shipment label' }));
      expect(retryFailedShipmentExecutionMock).toHaveBeenCalledTimes(2);
    });

    it('retains the existing missing-field recovery form without a Smart label bypass', async () => {
      createShipmentExecutionMock.mockRejectedValueOnce(new Error('Missing required shipment customer fields: customer.phone'));
      renderOrderDetail();
      await userEvent.click(await screen.findByRole('button', { name: 'Create shipment label' }));
      await waitFor(() => expect(screen.getAllByText('Complete shipment-only fields').length).toBeGreaterThan(0));
      expect(screen.getByRole('button', { name: 'Create shipment label' })).toBeDisabled();
      expect(screen.getByText('Complete shipment-only fields below.')).toBeInTheDocument();
      expect(createShipmentExecutionMock).toHaveBeenCalledTimes(1);
    });

    it('keeps Admin missing-field recovery reachable from the Smart label action', async () => {
      actor('admin');
      createShipmentExecutionMock.mockRejectedValueOnce(new Error('Missing required shipment customer fields: customer.phone'));
      renderOrderDetail();
      await userEvent.click(await screen.findByRole('button', { name: 'Create shipment label' }));
      expect(await screen.findByText('Complete shipment-only fields')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Create shipment with completed fields' })).toBeInTheDocument();
      expect(screen.queryByText('Shipping actions are currently unavailable.')).not.toBeInTheDocument();
    });

    it('keeps Allocation metadata hidden from Vendor users', async () => {
      renderOrderDetail();
      await screen.findByText('Order #1028');
      expect(screen.queryByText('Allocation', { exact: true })).not.toBeInTheDocument();
    });

    it('ignores creation completion after navigating to another allocation in the same Vendor', async () => {
      const pending = deferred<ReturnType<typeof shipment>>();
      createShipmentExecutionMock.mockReturnValue(pending.promise);
      getOrderMock.mockImplementation(async (id) => ({ ...orderWithoutShipment, id,
        sourceShopifyOrderNumber: id === orderWithoutShipment.id ? '#1028' : '#2099' }));
      renderOrderDetail();
      await userEvent.click(await screen.findByRole('button', { name: 'Create shipment label' }));
      await userEvent.click(screen.getByRole('link', { name: 'Open Vendor B order' }));
      await screen.findByText('Order #2099');
      await act(async () => pending.resolve(shipment({ providerShipmentId: 'P02-old-order', labelUrl: 'https://example.com/old-order.pdf' })));
      expect(screen.queryByRole('button', { name: 'Open shipping label' })).not.toBeInTheDocument();
      expect(openWindow).not.toHaveBeenCalled();
    });

    it('preserves restricted Vendor action blocking', async () => {
      actor('vendor', true);
      renderOrderDetail();
      const button = await screen.findByRole('button', { name: 'Create shipment label' });
      expect(button).toBeDisabled();
      await userEvent.click(button);
      expect(createShipmentExecutionMock).not.toHaveBeenCalled();
    });

    it.each(['cancelled', 'blocked', 'refunded'] as const)('does not expose Smart label for an operationally %s allocation', async (state) => {
      getOrderMock.mockResolvedValue({ ...orderWithoutShipment,
        ...(state === 'cancelled' ? { isCancelled: true, cancelledAt: '2026-05-16T12:00:00Z' }
          : state === 'blocked' ? { allocationStatus: 'vendor_blocked', reassignmentRequired: true }
            : { operationalActionability: { actionable: false, reason: 'ALLOCATION_REFUND_TERMINAL' }, refundRecordCount: 1 }) });
      renderOrderDetail();
      await screen.findByText('Order #1028');
      expect(screen.queryByRole('region', { name: 'Smart label action' })).not.toBeInTheDocument();
      expect(createShipmentExecutionMock).not.toHaveBeenCalled();
    });

    it('presents label-opening errors without repeating successful shipment creation', async () => {
      createShipmentExecutionMock.mockResolvedValue(shipment({ providerShipmentId: 'P02-created', labelUrl: 'not-a-supported-label' }));
      renderOrderDetail();
      await userEvent.click(await screen.findByRole('button', { name: 'Create shipment label' }));
      expect(await screen.findByText('Shipment label data is not a supported PDF link.')).toBeInTheDocument();
      expect(screen.getByText('Shipment P02-created recorded.')).toBeInTheDocument();
      expect(openWindow).not.toHaveBeenCalled();
      expect(createShipmentExecutionMock).toHaveBeenCalledTimes(1);
    });

    it('keeps shipment success separate when browser label opening throws', async () => {
      openWindow.mockImplementationOnce(() => { throw new Error('Browser refused opening'); });
      createShipmentExecutionMock.mockResolvedValue(shipment({ providerShipmentId: 'P02-created', labelUrl: 'https://example.com/new.pdf' }));
      renderOrderDetail();
      await userEvent.click(await screen.findByRole('button', { name: 'Create shipment label' }));
      expect(await screen.findByText('Shipment label could not be opened.')).toBeInTheDocument();
      expect(screen.getByText('Shipment P02-created recorded.')).toBeInTheDocument();
      expect(createShipmentExecutionMock).toHaveBeenCalledTimes(1);
      expect(retryFailedShipmentExecutionMock).not.toHaveBeenCalled();
    });

    it('I02 manual existing-label exceptions preserve evidence without shipment mutations', async () => {
      getOrderMock.mockResolvedValue({ ...orderWithoutShipment,
        shipmentExecution: shipment({ labelUrl: 'https://example.com/historical.pdf' }) });
      openWindow.mockImplementationOnce(() => { throw new Error('Browser denied historical label'); });
      renderOrderDetail();
      await userEvent.click(await screen.findByRole('button', { name: 'Open shipping label' }));
      expect(await screen.findByText('Shipment label could not be opened.')).toBeInTheDocument();
      expect(createShipmentExecutionMock).not.toHaveBeenCalled();
      expect(retryShipmentExecutionMock).not.toHaveBeenCalled();
      expect(retryFailedShipmentExecutionMock).not.toHaveBeenCalled();
      expect(refreshShipmentProviderDataMock).not.toHaveBeenCalled();
      expect(refreshShipmentExecutionStatusMock).not.toHaveBeenCalled();
    });

    it('ignores a late failed-retry label after changing allocation', async () => {
      const pending = deferred<ReturnType<typeof shipment>>();
      retryFailedShipmentExecutionMock.mockReturnValue(pending.promise);
      getOrderMock.mockImplementation(async (id) => id === orderWithoutShipment.id
        ? { ...orderWithoutShipment, shipmentExecution: shipment({ shipmentStatus: 'failed' }) }
        : { ...orderWithoutShipment, id, sourceShopifyOrderNumber: '#2099' });
      renderOrderDetail();
      await userEvent.click(await screen.findByRole('button', { name: 'Retry shipment label' }));
      await userEvent.click(screen.getByRole('link', { name: 'Open Vendor B order' }));
      await screen.findByText('Order #2099');
      await act(async () => pending.resolve(shipment({ providerShipmentId: 'P02-old-retry', labelUrl: 'https://example.com/old-retry.pdf' })));
      expect(openWindow).not.toHaveBeenCalled();
      expect(screen.queryByRole('button', { name: 'Open shipping label' })).not.toBeInTheDocument();
    });

    it('does not open a late label after leaving the detail page', async () => {
      const pending = deferred<ReturnType<typeof shipment>>();
      createShipmentExecutionMock.mockReturnValue(pending.promise);
      const view = renderOrderDetail();
      await userEvent.click(await screen.findByRole('button', { name: 'Create shipment label' }));
      view.unmount();
      await act(async () => pending.resolve(shipment({ providerShipmentId: 'P02-left', labelUrl: 'https://example.com/left.pdf' })));
      expect(openWindow).not.toHaveBeenCalled();
    });

    it('keeps Support read-only and Allocation metadata Admin-only', async () => {
      actor('support');
      renderOrderDetail();
      await screen.findByText('Order #1028');
      expect(screen.queryByRole('region', { name: 'Smart label action' })).not.toBeInTheDocument();
      expect(screen.queryByText('Allocation', { exact: true })).not.toBeInTheDocument();
    });

    it('preserves Admin metadata and panel timestamp precedence without a new event', async () => {
      actor('admin');
      getOrderMock.mockResolvedValue({ ...orderWithoutShipment, shipmentUpdatedAt: '2026-06-02T09:10:00Z' });
      renderOrderDetail();
      await screen.findByText('Order #1028');
      expect(screen.getByText('Allocation', { exact: true }).nextElementSibling).toHaveTextContent(orderWithoutShipment.id);
      expect(screen.getByLabelText('Last update')).toHaveTextContent('Jun 2, 2026');
      expect(screen.getByRole('heading', { name: 'Shopify order snapshot' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Vendor Invoice' })).toBeInTheDocument();
    });

    it('does not expose a foreign allocation or its Smart label action', async () => {
      getOrderMock.mockResolvedValue({ ...orderWithoutShipment, assignedVendorId: 'yalispor' });
      renderOrderDetail();
      await waitFor(() => expect(getOrderMock).toHaveBeenCalled());
      expect(screen.queryByText('Order #1028')).not.toBeInTheDocument();
      expect(screen.queryByRole('region', { name: 'Smart label action' })).not.toBeInTheDocument();
    });

    it('ignores late creation success after Admin A to B to A navigation', async () => {
      actor('admin');
      const pending = deferred<ReturnType<typeof shipment>>();
      createShipmentExecutionMock.mockReturnValue(pending.promise);
      getOrderMock.mockImplementation(async (_id, options) => options?.vendorId === 'yalispor'
        ? { ...orderWithoutShipment, assignedVendorId: 'yalispor', vendorId: 'yalispor', sourceShopifyOrderNumber: '#2099' }
        : orderWithoutShipment);
      renderOrderDetail();
      await userEvent.click(await screen.findByRole('button', { name: 'Create shipment label' }));
      act(() => setCurrentVendorId('yalispor'));
      expect(await screen.findByText('Order #2099')).toBeInTheDocument();
      await act(async () => pending.resolve(shipment({ providerShipmentId: 'P02-old-A', labelUrl: 'https://example.com/old-A.pdf' })));
      expect(screen.queryByRole('button', { name: 'Open shipping label' })).not.toBeInTheDocument();
      expect(openWindow).not.toHaveBeenCalled();
      act(() => setCurrentVendorId('sporjinal'));
      expect(await screen.findByText('Order #1028')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Open shipping label' })).not.toBeInTheDocument();
      expect(createShipmentExecutionMock).toHaveBeenCalledTimes(1);
    });

    it('ignores a late failed retry error after switching Vendor', async () => {
      actor('admin');
      const pending = deferred<ReturnType<typeof shipment>>();
      retryFailedShipmentExecutionMock.mockReturnValue(pending.promise);
      getOrderMock.mockImplementation(async (_id, options) => options?.vendorId === 'yalispor'
        ? { ...orderWithoutShipment, assignedVendorId: 'yalispor', vendorId: 'yalispor', sourceShopifyOrderNumber: '#2099' }
        : { ...orderWithoutShipment, shipmentExecution: shipment({ shipmentStatus: 'failed' }) });
      renderOrderDetail();
      await userEvent.click(await screen.findByRole('button', { name: 'Retry shipment label' }));
      act(() => setCurrentVendorId('yalispor'));
      await screen.findByText('Order #2099');
      await act(async () => pending.reject(new Error('P02-old-A-error')));
      expect(screen.queryByText('P02-old-A-error')).not.toBeInTheDocument();
      expect(retryFailedShipmentExecutionMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('P04-01 delivery sync parity', () => {
    function actor(role: 'admin' | 'vendor' = 'admin') {
      setCurrentUser({ email: `${role}@demo.com`, name: role, role,
        vendorAccess: ['sporjinal', 'yalispor'],
        vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' },
          { vendorId: 'yalispor', vendorName: 'Yalıspor' }],
        canSwitchVendors: role === 'admin', defaultVendorId: 'sporjinal' });
    }
    function delivered(overrides: Partial<OrderDetail> = {}): OrderDetail {
      return { ...orderWithoutShipment, shippingStatus: 'Delivered',
        shopifyDeliverySync: { status: 'confirmed' }, ...overrides };
    }
    const syncMessage = /Shopify delivery sync(?:ed| pending| failed| needs verification)/;
    beforeEach(() => actor());

    it.each([
      ['confirmed', 'Shopify delivery synced', null],
      ['pending', 'Shopify delivery sync pending', null],
      ['rejected', 'Shopify delivery sync failed', 'op-tone-danger'],
      ['outcome_unknown', 'Shopify delivery sync needs verification', 'op-tone-warning'],
    ] as const)('shows Admin %s evidence with the panel warning convention', async (status, label, tone) => {
      getOrderMock.mockResolvedValue(delivered({ shopifyDeliverySync: { status } }));
      renderOrderDetail();
      const sync = await screen.findByLabelText('Shopify Delivered event sync');
      expect(screen.getByRole('heading', { name: 'Fulfillment', exact: true }).closest('article')).toContainElement(sync);
      const message = within(sync).getByText(label);
      if (tone) expect(message).toHaveClass('op-badge', tone);
      else expect(message).not.toHaveClass('op-tone-danger', 'op-tone-warning');
      expect(screen.getAllByText(syncMessage)).toHaveLength(1);
      expect(getOrderMock).toHaveBeenCalledTimes(1);
      expect(createShipmentExecutionMock).not.toHaveBeenCalled();
      expect(submitFulfillmentTrackingMock).not.toHaveBeenCalled();
      expect(refreshShipmentExecutionStatusMock).not.toHaveBeenCalled();
      expect(retryShipmentExecutionMock).not.toHaveBeenCalled();
    });

    it.each(['confirmed', 'pending', 'rejected', 'outcome_unknown'] as const)(
      'preserves Vendor visibility for %s', async (status) => {
        actor('vendor');
        getOrderMock.mockResolvedValue(delivered({ shopifyDeliverySync: { status } }));
        renderOrderDetail();
        await screen.findByText('Order #1028');
        if (status === 'confirmed' || status === 'pending') {
          expect(screen.getByLabelText('Shopify Delivered event sync')).toHaveTextContent(
            status === 'confirmed' ? 'Shopify delivery synced' : 'Shopify delivery sync pending');
        } else {
          expect(screen.queryByLabelText('Shopify Delivered event sync')).not.toBeInTheDocument();
          expect(screen.queryByText(syncMessage)).not.toBeInTheDocument();
        }
      });

    it.each([null, undefined])('does not infer delivery sync from local Delivered or fulfillment success (%s)', async (evidence) => {
      getOrderMock.mockResolvedValue(delivered({ shopifyDeliverySync: evidence,
        shopifyFulfillmentSync: { status: 'synced', fulfillmentOrderIdPresent: true, fulfillmentIdPresent: true,
          syncStatus: 'synced', skippedReason: null, errorMessage: null, lastAttemptedAt: null } }));
      renderOrderDetail();
      await screen.findByText('Order #1028');
      expect(screen.queryByText(syncMessage)).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Shopify Delivered event sync')).not.toBeInTheDocument();
    });

    it.each(['Awaiting Shipment', 'In Transit'])('hides delivery sync outside exact Delivered (%s)', async (shippingStatus) => {
      getOrderMock.mockResolvedValue(delivered({ shippingStatus }));
      renderOrderDetail();
      await screen.findByText('Order #1028');
      expect(screen.queryByText(syncMessage)).not.toBeInTheDocument();
    });

    it.each([
      ['cancellation', { isCancelled: true, shippingStatus: 'Awaiting Shipment' }],
      ['cancellation conflict', { isCancelled: true, isCancellationConflict: true }],
      ['refund terminal', { operationalActionability: { actionable: false, reason: 'ALLOCATION_REFUND_TERMINAL' } }],
      ['Vendor blocked', { allocationStatus: 'vendor_blocked' }],
    ] satisfies Array<[string, Partial<OrderDetail>]>)(
      'suppresses delivery evidence in canonical %s state', async (_name, overrides) => {
        getOrderMock.mockResolvedValue(delivered(overrides));
        renderOrderDetail();
        await screen.findByText('Order #1028');
        expect(screen.queryByText(syncMessage)).not.toBeInTheDocument();
      });

    it('preserves Vendor-blocked suppression for the Vendor role', async () => {
      actor('vendor');
      getOrderMock.mockResolvedValue(delivered({ allocationStatus: 'vendor_blocked' }));
      renderOrderDetail();
      await screen.findByText('Order #1028');
      expect(screen.queryByText(syncMessage)).not.toBeInTheDocument();
    });

    it('keeps delivery evidence independent of a pending fulfillment sync', async () => {
      getOrderMock.mockResolvedValue(delivered({ shopifyFulfillmentSync: {
        status: 'pending', fulfillmentOrderIdPresent: true, fulfillmentIdPresent: false,
        syncStatus: 'pending', skippedReason: null, errorMessage: null, lastAttemptedAt: null } }));
      renderOrderDetail();
      expect(await screen.findByText('Shopify delivery synced')).toBeInTheDocument();
    });

    it('removes the previous order message during same-Vendor navigation', async () => {
      const next = deferred<OrderDetail>();
      getOrderMock.mockImplementation((id) => id === 'alloc-yalispor-2099' ? next.promise : Promise.resolve(delivered()));
      renderOrderDetail();
      await screen.findByText('Shopify delivery synced');
      await userEvent.click(screen.getByRole('link', { name: 'Open Vendor B order' }));
      expect(screen.queryByText(syncMessage)).not.toBeInTheDocument();
      await act(async () => next.resolve(delivered({ id: 'alloc-yalispor-2099',
        sourceShopifyOrderNumber: '#2099', shopifyDeliverySync: { status: 'pending' } })));
      expect(await screen.findByText('Shopify delivery sync pending')).toBeInTheDocument();
      expect(screen.queryByText('Shopify delivery synced')).not.toBeInTheDocument();
    });

    it('clears Vendor A evidence and ignores its delayed refetch after switching to B', async () => {
      const lateA = deferred<OrderDetail>();
      let aReads = 0;
      getOrderMock.mockImplementation(async (_id, options) => options?.vendorId === 'yalispor'
        ? delivered({ originalVendorId: 'yalispor', assignedVendorId: 'yalispor', vendorId: 'yalispor',
          sourceShopifyOrderNumber: '#2099', shopifyDeliverySync: { status: 'pending' } })
        : ++aReads === 1 ? delivered() : lateA.promise);
      const { queryClient } = renderOrderDetail();
      await screen.findByText('Shopify delivery synced');
      act(() => { void queryClient.invalidateQueries({ queryKey: queryKeys.orders.detail(orderWithoutShipment.id, 'sporjinal') }); });
      await waitFor(() => expect(aReads).toBe(2));
      act(() => setCurrentVendorId('yalispor'));
      expect(screen.queryByText('Shopify delivery synced')).not.toBeInTheDocument();
      await screen.findByText('Order #2099');
      expect(screen.getByText('Shopify delivery sync pending')).toBeInTheDocument();
      await act(async () => lateA.resolve(delivered({ shopifyDeliverySync: { status: 'rejected' } })));
      expect(screen.queryByText('Shopify delivery sync failed')).not.toBeInTheDocument();
      expect(screen.getByText('Shopify delivery sync pending')).toBeInTheDocument();
    });
  });

  describe('P04-02A payment status parity', () => {
    function actor(role: 'admin' | 'vendor' | 'support' | 'finance' = 'vendor', canSwitchVendors = role === 'admin') {
      setCurrentUser({ email: `${role}@demo.com`, name: role, role,
        vendorAccess: ['sporjinal', 'yalispor'],
        vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' },
          { vendorId: 'yalispor', vendorName: 'Yalıspor' }],
        canSwitchVendors, defaultVendorId: 'sporjinal' });
    }
    function paymentOrder(financialStatus: string | null = 'paid', overrides: Partial<OrderDetail> = {}): OrderDetail {
      return { ...orderWithoutShipment,
        orderSnapshot: { ...orderWithShipmentSummary.orderSnapshot!, financialStatus }, ...overrides };
    }
    async function paymentValue() {
      const summary = await screen.findByLabelText('Order financial summary');
      return within(summary).getByText('Payment Status').nextElementSibling;
    }
    beforeEach(() => actor());

    it.each([
      ['vendor', 'paid'], ['vendor', 'partially_refunded'],
      ['support', 'paid'], ['support', 'partially_refunded'],
      ['finance', 'paid'], ['finance', 'partially_refunded'],
    ] as const)('preserves active %s payment information (%s) without Admin snapshot disclosure', async (role, status) => {
      actor(role);
      getOrderMock.mockResolvedValue(paymentOrder(status));
      renderOrderDetail();
      expect(await paymentValue()).toHaveTextContent(status);
      expect(within(screen.getByLabelText('Current order state')).queryByText('Payment Status')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Shopify details section')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Allocation finance summary')).not.toBeInTheDocument();
      expect(screen.queryByText('PayTR Marketplace')).not.toBeInTheDocument();
      expect(getOrderMock).toHaveBeenCalledTimes(1);
      expect(createShipmentExecutionMock).not.toHaveBeenCalled();
      expect(submitFulfillmentTrackingMock).not.toHaveBeenCalled();
      expect(rejectOrderMock).not.toHaveBeenCalled();
      expect(retryShipmentExecutionMock).not.toHaveBeenCalled();
    });

    it.each([
      ['missing snapshot', undefined], ['null snapshot', null],
      ['null status', { ...orderWithShipmentSummary.orderSnapshot!, financialStatus: null }],
      ['empty status', { ...orderWithShipmentSummary.orderSnapshot!, financialStatus: '' }],
      ['blank status', { ...orderWithShipmentSummary.orderSnapshot!, financialStatus: '   ' }],
    ] satisfies Array<[string, OrderDetail['orderSnapshot']]>)(
      'preserves the dash for %s', async (_name, orderSnapshot) => {
        getOrderMock.mockResolvedValue(paymentOrder('paid', { orderSnapshot }));
        renderOrderDetail();
        expect(await paymentValue()).toHaveTextContent(/^—$/);
      });

    it('trims the existing snapshot value without changing its meaning', async () => {
      getOrderMock.mockResolvedValue(paymentOrder('  partially_refunded  '));
      renderOrderDetail();
      expect(await paymentValue()).toHaveTextContent(/^partially_refunded$/);
    });

    const terminalCases: Array<[string, Partial<OrderDetail>, string]> = [
      ['cancellation', { isCancelled: true }, 'Sale voided'],
      ['cancellation conflict', { isCancelled: true, isCancellationConflict: true }, 'Review required'],
      ['refund completed', { operationalActionability: { actionable: false, reason: 'ALLOCATION_REFUND_TERMINAL' } }, 'Refund completed'],
      ['Vendor blocked', { allocationStatus: 'vendor_blocked' }, 'Held'],
    ];
    it.each((['vendor', 'support', 'finance'] as const).flatMap((role) =>
      terminalCases.map(([name, overrides, expected]) => ({ role, name, overrides, expected }))))(
      'uses canonical $name finance label for $role instead of raw Shopify paid', async ({ role, overrides, expected }) => {
        actor(role);
        getOrderMock.mockResolvedValue(paymentOrder('paid', overrides));
        renderOrderDetail();
        expect(await paymentValue()).toHaveTextContent(expected);
        expect(await paymentValue()).not.toHaveTextContent(/^paid$/);
      });

    it('keeps payment information available when no monetary summary rows exist', async () => {
      getOrderMock.mockResolvedValue(paymentOrder('paid', { amount: 'Unknown' }));
      renderOrderDetail();
      expect(await paymentValue()).toHaveTextContent(/^paid$/);
      const summary = screen.getByLabelText('Order financial summary');
      expect(within(summary).queryByText('Gross Allocation Amount')).not.toBeInTheDocument();
      expect(within(summary).queryByText('Commission')).not.toBeInTheDocument();
      expect(within(summary).queryByText('Shipping Deduction')).not.toBeInTheDocument();
      expect(within(summary).queryByText('Estimated Earnings')).not.toBeInTheDocument();
      expect(summary.querySelectorAll('.order-financial-impact-grid > div')).toHaveLength(1);
    });

    it('retains the Admin-only snapshot and creates no non-Admin payment row for Admin', async () => {
      actor('admin');
      getOrderMock.mockResolvedValue(paymentOrder());
      renderOrderDetail();
      const snapshot = await screen.findByLabelText('Shopify order snapshot');
      expect(within(snapshot).getByText('Shopify financial status').nextElementSibling).toHaveTextContent('Paid');
      expect(within(snapshot).getByText('Payment gateway').nextElementSibling).toHaveTextContent('PayTR Marketplace');
      expect(screen.queryByText('Payment Status')).not.toBeInTheDocument();
    });

    it('clears the old payment status while navigating to another allocation', async () => {
      const next = deferred<OrderDetail>();
      getOrderMock.mockImplementation((id) => id === 'alloc-yalispor-2099' ? next.promise : Promise.resolve(paymentOrder()));
      renderOrderDetail();
      expect(await paymentValue()).toHaveTextContent(/^paid$/);
      await userEvent.click(screen.getByRole('link', { name: 'Open Vendor B order' }));
      expect(screen.queryByText('Payment Status')).not.toBeInTheDocument();
      await act(async () => next.resolve(paymentOrder('partially_refunded', {
        id: 'alloc-yalispor-2099', sourceShopifyOrderNumber: '#2099' })));
      expect(await paymentValue()).toHaveTextContent(/^partially_refunded$/);
    });

    it('does not retain Vendor A payment evidence or accept its late refetch under Vendor B', async () => {
      // Synthetic multi-membership Vendor with the existing explicit switching capability.
      actor('vendor', true);
      const lateA = deferred<OrderDetail>();
      let aReads = 0;
      getOrderMock.mockImplementation(async (_id, options) => options?.vendorId === 'yalispor'
        ? paymentOrder('partially_refunded', { originalVendorId: 'yalispor', assignedVendorId: 'yalispor', vendorId: 'yalispor', sourceShopifyOrderNumber: '#2099' })
        : ++aReads === 1 ? paymentOrder() : lateA.promise);
      const { queryClient } = renderOrderDetail();
      expect(await paymentValue()).toHaveTextContent(/^paid$/);
      act(() => { void queryClient.invalidateQueries({ queryKey: queryKeys.orders.detail(orderWithoutShipment.id, 'sporjinal') }); });
      await waitFor(() => expect(aReads).toBe(2));
      act(() => setCurrentVendorId('yalispor'));
      expect(screen.queryByText('Payment Status')).not.toBeInTheDocument();
      await screen.findByText('Order #2099');
      expect(await paymentValue()).toHaveTextContent(/^partially_refunded$/);
      await act(async () => lateA.resolve(paymentOrder('OLD_A_PAYMENT')));
      expect(screen.queryByText('OLD_A_PAYMENT')).not.toBeInTheDocument();
      expect(await paymentValue()).toHaveTextContent(/^partially_refunded$/);
    });
  });

  describe('P04-02C G1 read-only shipment evidence', () => {
    const openWindow = vi.fn();
    function actor(role: 'admin' | 'vendor' | 'support' | 'finance' = 'vendor', restricted = false, canSwitchVendors = role === 'admin') {
      setCurrentUser({ email: `${role}@demo.com`, name: role, role,
        vendorAccess: ['sporjinal', 'yalispor'],
        vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal', status: restricted ? 'inactive' : 'active' },
          { vendorId: 'yalispor', vendorName: 'Yalıspor' }],
        canSwitchVendors, defaultVendorId: 'sporjinal' });
    }
    function evidence(overrides: Partial<NonNullable<OrderDetail['shipmentExecution']>> = {}) {
      return { ...orderWithShipmentSummary.shipmentExecution!, provider: 'kargonomi' as const,
        shipmentStatus: 'created' as const, trackingNumber: 'G1-SHIPMENT-TRACK',
        trackingUrl: 'https://tracking.example/g1', labelUrl: 'https://example.com/g1.pdf',
        providerResponseSummary: { ...orderWithShipmentSummary.shipmentExecution!.providerResponseSummary!,
          providerError: null, dryRun: false, disabledGates: [], ok: true }, ...overrides };
    }
    function readOrder(overrides: Partial<OrderDetail> = {}): OrderDetail {
      return { ...orderWithoutShipment, allocationStatus: 'fulfilled', fulfillmentActionAvailable: false,
        fulfillmentStatus: 'Fulfilled', shippingStatus: 'In Transit',
        trackingNumber: undefined, trackingUrl: undefined, carrier: undefined,
        shipmentExecution: evidence(), ...overrides };
    }
    function expectNoShipmentMutations() {
      for (const mutation of [createShipmentExecutionMock, retryFailedShipmentExecutionMock, retryShipmentExecutionMock,
        submitFulfillmentTrackingMock, refreshShipmentExecutionStatusMock, refreshShipmentProviderDataMock,
        cancelShipmentExecutionMock, updateNavlungoShipmentExecutionMock, createReturnShipmentLabelMock,
        probeShopifyReturnLabelUploadMock, probeTryOtoReturnDetailsMock, probeTryOtoReturnLinkMock,
        probeTryOtoReturnAwbPrintMock, updateVendorShippingConfigMock, syncKargonomiWarehouseDetailsMock]) {
        expect(mutation).not.toHaveBeenCalled();
      }
    }
    beforeEach(() => {
      actor();
      openWindow.mockReset();
      vi.stubGlobal('open', openWindow);
      getOrderMock.mockResolvedValue(readOrder());
    });
    afterEach(() => vi.unstubAllGlobals());

    it.each((['admin', 'vendor', 'support', 'finance'] as const).flatMap((role) =>
      (['active', 'fulfilled'] as const).map((allocationStatus) => ({ role, allocationStatus }))))(
      'preserves existing evidence for $role on $allocationStatus without any mutation', async ({ role, allocationStatus }) => {
        actor(role);
        getOrderMock.mockResolvedValue(readOrder({ allocationStatus, fulfillmentActionAvailable: allocationStatus === 'active' }));
        renderOrderDetail();
        await screen.findByText('Order #1028');
        expect(screen.getAllByText('G1-SHIPMENT-TRACK').length).toBeGreaterThan(0);
        const link = screen.getByRole('link', { name: 'Open tracking', exact: true });
        expect(link).toHaveAttribute('href', 'https://tracking.example/g1');
        expect(link).toHaveAttribute('target', '_blank');
        expect(link.getAttribute('rel')).toContain('noreferrer');
        const shouldUseReadOnlySection = role === 'support' || role === 'finance' || (role === 'vendor' && allocationStatus === 'fulfilled');
        expect(Boolean(screen.queryByRole('region', { name: 'Shipment information' }))).toBe(shouldUseReadOnlySection);
        expect(screen.getAllByRole('link', { name: 'Open tracking', exact: true })).toHaveLength(1);
        await userEvent.click(screen.getByRole('button', { name: 'Open label PDF' }));
        expect(openWindow).toHaveBeenCalledExactlyOnceWith('https://example.com/g1.pdf', '_blank', 'noopener,noreferrer');
        expect(getOrderMock).toHaveBeenCalledTimes(1);
        expectNoShipmentMutations();
        if (role === 'support' || role === 'finance' || allocationStatus === 'fulfilled' && role === 'vendor') {
          expect(screen.queryByRole('region', { name: 'Smart label action' })).not.toBeInTheDocument();
          expect(screen.queryByRole('button', { name: 'Add tracking information' })).not.toBeInTheDocument();
        }
      });

    it('preserves reads for an active Vendor with fulfillmentActionAvailable false', async () => {
      getOrderMock.mockResolvedValue(readOrder({ allocationStatus: 'active', fulfillmentActionAvailable: false }));
      renderOrderDetail();
      const section = await screen.findByRole('region', { name: 'Shipment information' });
      expect(within(section).getByText('G1-SHIPMENT-TRACK')).toBeInTheDocument();
      await userEvent.click(within(section).getByRole('button', { name: 'Open label PDF' }));
      expect(openWindow).toHaveBeenCalledTimes(1);
      expectNoShipmentMutations();
    });

    it.each(['active', 'fulfilled'] as const)('preserves restricted Vendor reads without enabling %s mutations', async (allocationStatus) => {
      actor('vendor', true);
      getOrderMock.mockResolvedValue(readOrder({ allocationStatus, fulfillmentActionAvailable: allocationStatus === 'active' }));
      renderOrderDetail();
      await screen.findByText('Order #1028');
      if (allocationStatus === 'active') {
        const action = screen.getByRole('button', { name: 'Open shipping label' });
        expect(action).toBeDisabled();
        await userEvent.click(action);
        expect(openWindow).not.toHaveBeenCalled();
      }
      await userEvent.click(screen.getByRole('button', { name: 'Open label PDF' }));
      expect(openWindow).toHaveBeenCalledTimes(1);
      expectNoShipmentMutations();
    });

    it.each(['label', 'url', 'both', 'all'] as const)('keeps the missing %s evidence unavailable without creating replacements', async (missing) => {
      getOrderMock.mockResolvedValue(readOrder({ shipmentExecution: evidence({
        labelUrl: missing === 'url' ? 'https://example.com/g1.pdf' : null,
        trackingUrl: missing === 'label' ? 'https://tracking.example/g1' : null,
        ...(missing === 'all' ? { trackingNumber: null } : {}),
      }) }));
      renderOrderDetail();
      const section = await screen.findByRole('region', { name: 'Shipment information' });
      expect(within(section).getAllByText('Not available').length).toBeGreaterThan(0);
      if (missing !== 'url') expect(within(section).queryByRole('button', { name: 'Open label PDF' })).not.toBeInTheDocument();
      if (missing !== 'label') expect(within(section).queryByRole('link', { name: 'Open tracking' })).not.toBeInTheDocument();
      expectNoShipmentMutations();
    });

    it('retains allocation tracking precedence over shipment tracking', async () => {
      getOrderMock.mockResolvedValue(readOrder({ trackingNumber: 'G1-ALLOCATION-TRACK', trackingUrl: 'https://tracking.example/allocation' }));
      renderOrderDetail();
      const section = await screen.findByRole('region', { name: 'Shipment information' });
      expect(within(section).getByText('G1-ALLOCATION-TRACK')).toBeInTheDocument();
      expect(within(section).queryByText('G1-SHIPMENT-TRACK')).not.toBeInTheDocument();
      expect(within(section).getByRole('link', { name: 'Open tracking' })).toHaveAttribute('href', 'https://tracking.example/allocation');
      expectNoShipmentMutations();
    });

    it('shows an unsupported-label error without retry, creation or payload disclosure', async () => {
      getOrderMock.mockResolvedValue(readOrder({ shipmentExecution: evidence({ labelUrl: 'not-a-supported-label' }) }));
      renderOrderDetail();
      await userEvent.click(await screen.findByRole('button', { name: 'Open label PDF' }));
      expect(await screen.findByText('Shipment label data is not a supported PDF link.')).toBeInTheDocument();
      expect(screen.queryByText('not-a-supported-label')).not.toBeInTheDocument();
      expect(openWindow).not.toHaveBeenCalled();
      expectNoShipmentMutations();
    });

    it('keeps a failed PDF opening separate from shipment operations', async () => {
      const BrowserURL = URL;
      vi.stubGlobal('URL', class extends BrowserURL {
        static createObjectURL() { throw new Error('synthetic PDF opening failure'); }
      });
      getOrderMock.mockResolvedValue(readOrder({ shipmentExecution: evidence({ labelUrl: 'data:application/pdf;base64,JVBERi0xLjQ=' }) }));
      renderOrderDetail();
      await userEvent.click(await screen.findByRole('button', { name: 'Open label PDF' }));
      expect(await screen.findByText('Shipment label PDF could not be opened.')).toBeInTheDocument();
      expect(openWindow).not.toHaveBeenCalled();
      expectNoShipmentMutations();
    });

    const terminalStates: Array<[string, Partial<OrderDetail>]> = [
      ['cancelled', { isCancelled: true, shippingStatus: 'Awaiting Shipment', fulfillmentStatus: 'Pending' }],
      ['conflict', { isCancelled: true, isCancellationConflict: true }],
      ['refunded', { operationalActionability: { actionable: false, reason: 'ALLOCATION_REFUND_TERMINAL' } }],
      ['blocked', { allocationStatus: 'vendor_blocked' }],
    ];
    it.each((['admin', 'vendor', 'support', 'finance'] as const).flatMap((role) =>
      terminalStates.map(([state, overrides]) => ({ role, state, overrides }))))(
      'does not introduce read-only controls for $role in canonical $state state', async ({ role, overrides }) => {
        actor(role);
        getOrderMock.mockResolvedValue(readOrder(overrides));
        renderOrderDetail();
        await screen.findByText('Order #1028');
        expect(screen.queryByRole('region', { name: 'Shipment information' })).not.toBeInTheDocument();
        if (role !== 'admin') {
          expect(screen.queryByRole('link', { name: 'Open tracking', exact: true })).not.toBeInTheDocument();
          expect(screen.queryByRole('button', { name: 'Open label PDF' })).not.toBeInTheDocument();
        }
        expect(openWindow).not.toHaveBeenCalled();
        expectNoShipmentMutations();
      });

    it('rejects foreign Vendor shipment evidence before rendering or opening it', async () => {
      getOrderMock.mockResolvedValue(readOrder({ assignedVendorId: 'yalispor', vendorId: 'yalispor' }));
      renderOrderDetail();
      await screen.findByText('Order unavailable');
      expect(screen.queryByRole('region', { name: 'Shipment information' })).not.toBeInTheDocument();
      expect(screen.queryByText('G1-SHIPMENT-TRACK')).not.toBeInTheDocument();
      expect(openWindow).not.toHaveBeenCalled();
      expectNoShipmentMutations();
    });

    it('keeps a late Vendor A response and its label out of Vendor B', async () => {
      actor('vendor', false, true);
      const late = deferred<OrderDetail>();
      let reads = 0;
      getOrderMock.mockImplementation(async (_id, options) => options?.vendorId === 'yalispor'
        ? readOrder({ assignedVendorId: 'yalispor', vendorId: 'yalispor', sourceShopifyOrderNumber: '#2099',
          shipmentExecution: evidence({ vendorId: 'yalispor', trackingNumber: 'G1-B-TRACK', trackingUrl: 'https://tracking.example/b', labelUrl: 'https://example.com/b.pdf' }) })
        : ++reads === 1 ? readOrder() : late.promise);
      const { queryClient } = renderOrderDetail();
      const oldButton = await screen.findByRole('button', { name: 'Open label PDF' });
      act(() => { void queryClient.invalidateQueries({ queryKey: queryKeys.orders.detail(orderWithoutShipment.id, 'sporjinal') }); });
      await waitFor(() => expect(reads).toBe(2));
      act(() => setCurrentVendorId('yalispor'));
      expect(oldButton).not.toBeInTheDocument();
      expect(screen.queryByText('G1-SHIPMENT-TRACK')).not.toBeInTheDocument();
      await screen.findByText('G1-B-TRACK');
      await act(async () => late.resolve(readOrder({ shipmentExecution: evidence({ labelUrl: 'https://example.com/stale.pdf' }) })));
      expect(openWindow).not.toHaveBeenCalled();
      expect(screen.queryByText('G1-SHIPMENT-TRACK')).not.toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Open tracking' })).toHaveAttribute('href', 'https://tracking.example/b');
      await userEvent.click(screen.getByRole('button', { name: 'Open label PDF' }));
      expect(openWindow).toHaveBeenCalledExactlyOnceWith('https://example.com/b.pdf', '_blank', 'noopener,noreferrer');
      expectNoShipmentMutations();
    });

    it('does not retain the prior allocation label during navigation or a late refetch', async () => {
      const late = deferred<OrderDetail>();
      const next = deferred<OrderDetail>();
      let reads = 0;
      getOrderMock.mockImplementation((id) => id === 'alloc-yalispor-2099' ? next.promise
        : ++reads === 1 ? Promise.resolve(readOrder()) : late.promise);
      const { queryClient } = renderOrderDetail();
      const oldButton = await screen.findByRole('button', { name: 'Open label PDF' });
      act(() => { void queryClient.invalidateQueries({ queryKey: queryKeys.orders.detail(orderWithoutShipment.id, 'sporjinal') }); });
      await waitFor(() => expect(reads).toBe(2));
      await userEvent.click(screen.getByRole('link', { name: 'Open Vendor B order' }));
      expect(oldButton).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Open label PDF' })).not.toBeInTheDocument();
      await act(async () => late.resolve(readOrder()));
      expect(openWindow).not.toHaveBeenCalled();
      expect(screen.queryByText('G1-SHIPMENT-TRACK')).not.toBeInTheDocument();
      await act(async () => next.resolve(readOrder({ id: 'alloc-yalispor-2099', sourceShopifyOrderNumber: '#2099',
        shipmentExecution: evidence({ allocationId: 'alloc-yalispor-2099', trackingNumber: 'G1-NEXT-TRACK', labelUrl: 'https://example.com/next.pdf' }) })));
      await userEvent.click(await screen.findByRole('button', { name: 'Open label PDF' }));
      expect(openWindow).toHaveBeenCalledExactlyOnceWith('https://example.com/next.pdf', '_blank', 'noopener,noreferrer');
      expectNoShipmentMutations();
    });
  });

  describe('P04-02D G2 carrier presentation', () => {
    const openWindow = vi.fn();
    function actor(role: 'admin' | 'vendor' | 'support' | 'finance' = 'vendor', restricted = false, canSwitchVendors = role === 'admin') {
      setCurrentUser({ email: `${role}@demo.com`, name: role, role,
        vendorAccess: ['sporjinal', 'yalispor'],
        vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal', status: restricted ? 'inactive' : 'active' },
          { vendorId: 'yalispor', vendorName: 'Yalıspor' }], canSwitchVendors, defaultVendorId: 'sporjinal' });
    }
    function shipment(overrides: Partial<NonNullable<OrderDetail['shipmentExecution']>> = {}) {
      return { ...orderWithShipmentSummary.shipmentExecution!, provider: 'kargonomi' as const,
        providerCarrierName: 'aras_kargo', shipmentStatus: 'created' as const,
        trackingNumber: 'G2-TRACK', trackingUrl: 'https://tracking.example/g2', labelUrl: 'https://example.com/g2.pdf',
        providerResponseSummary: { ...orderWithShipmentSummary.shipmentExecution!.providerResponseSummary!,
          providerError: null, dryRun: false, disabledGates: [], ok: true }, ...overrides };
    }
    function order(overrides: Partial<OrderDetail> = {}): OrderDetail {
      return { ...orderWithoutShipment, carrier: 'LEGACY-CARRIER', trackingNumber: undefined, trackingUrl: undefined,
        fulfilledAt: undefined, shippingStatus: 'In Transit', shipmentExecution: shipment(), ...overrides };
    }
    async function carrierValues() {
      await screen.findByText(/Order #(?:1028|2099)/);
      const article = screen.getByRole('heading', { name: 'Fulfillment', exact: true }).closest('article')!;
      return within(article).queryAllByText('Carrier', { exact: true }).map((label) => label.nextElementSibling?.textContent?.trim());
    }
    function noMutations() {
      for (const fn of [createShipmentExecutionMock, retryFailedShipmentExecutionMock, retryShipmentExecutionMock,
        submitFulfillmentTrackingMock, refreshShipmentExecutionStatusMock, refreshShipmentProviderDataMock,
        cancelShipmentExecutionMock, updateNavlungoShipmentExecutionMock, createReturnShipmentLabelMock,
        probeShopifyReturnLabelUploadMock, probeTryOtoReturnDetailsMock, probeTryOtoReturnLinkMock, probeTryOtoReturnAwbPrintMock]) {
        expect(fn).not.toHaveBeenCalled();
      }
    }
    beforeEach(() => {
      actor();
      vi.stubGlobal('open', openWindow);
      openWindow.mockReset();
      getOrderMock.mockResolvedValue(order());
    });
    afterEach(() => vi.unstubAllGlobals());

    it.each((['admin', 'vendor', 'support', 'finance'] as const).flatMap((role) =>
      (['active', 'fulfilled'] as const).map((allocationStatus) => ({ role, allocationStatus }))))(
      'preserves the panel carrier evidence for $role on $allocationStatus without duplicating fields or changing G1', async ({ role, allocationStatus }) => {
        actor(role);
        getOrderMock.mockResolvedValue(order({ allocationStatus, fulfillmentActionAvailable: allocationStatus === 'active' }));
        renderOrderDetail();
        expect(await carrierValues()).toEqual(['Aras Kargo']);
        expect(screen.getByRole('link', { name: 'Open tracking', exact: true })).toHaveAttribute('href', 'https://tracking.example/g2');
        expect(screen.getAllByText('G2-TRACK').length).toBeGreaterThan(0);
        await userEvent.click(screen.getByRole('button', { name: 'Open label PDF' }));
        expect(openWindow).toHaveBeenCalledExactlyOnceWith('https://example.com/g2.pdf', '_blank', 'noopener,noreferrer');
        expect(getOrderMock).toHaveBeenCalledTimes(1);
        if (role === 'admin') expect(screen.getByLabelText('Provider response summary')).toBeInTheDocument();
        else expect(screen.queryByLabelText('Provider response summary')).not.toBeInTheDocument();
        noMutations();
      });

    it.each([
      ['carrier evidence without allocation carrier', { carrier: undefined }, 'Aras Kargo'],
      ['formatted carrier alias', { shipmentExecution: shipment({ providerCarrierName: 'kargo_entegrator' }) }, 'Kargo Entegratör'],
      ['provider fallback', { carrier: undefined, shipmentExecution: shipment({ providerCarrierName: null }) }, 'Kargonomi'],
      ['allocation fallback', { shipmentExecution: shipment({ providerCarrierName: null }) }, 'LEGACY-CARRIER'],
      ['blank carrier evidence', { shipmentExecution: shipment({ providerCarrierName: '   ' }) }, 'LEGACY-CARRIER'],
      ['allocation without shipment', { shipmentExecution: null, carrier: 'DHL' }, 'DHL'],
      ['all source evidence absent', { shipmentExecution: null, carrier: undefined }, 'Not available'],
      ['Try OTO Sürat', { shipmentExecution: shipment({ provider: 'try_oto', providerCarrierName: 'surat kargo' }) }, 'Sürat Kargo'],
      ['Try OTO allocation fallback', { shipmentExecution: shipment({ provider: 'try_oto', providerCarrierName: null }), carrier: 'DHL' }, 'DHL'],
      ['Try OTO provider fallback', { shipmentExecution: shipment({ provider: 'try_oto', providerCarrierName: null }), carrier: undefined }, 'Try OTO'],
      ['Try OTO self-reference fallback', { shipmentExecution: shipment({ provider: 'try_oto', providerCarrierName: null }), carrier: 'try_oto' }, 'Try OTO'],
    ] satisfies Array<[string, Partial<OrderDetail>, string]>)(
      'preserves %s without inventing carrier evidence', async (_name, overrides, expected) => {
        actor('support');
        getOrderMock.mockResolvedValue(order(overrides));
        renderOrderDetail();
        expect(await carrierValues()).toEqual([expected]);
        noMutations();
      });

    it.each(['active', 'fulfilled'] as const)('preserves restricted Vendor carrier/G1 reads while %s mutation controls stay restricted', async (allocationStatus) => {
      actor('vendor', true);
      getOrderMock.mockResolvedValue(order({ allocationStatus, fulfillmentActionAvailable: allocationStatus === 'active' }));
      renderOrderDetail();
      expect(await carrierValues()).toEqual(['Aras Kargo']);
      if (allocationStatus === 'active') expect(screen.getByRole('button', { name: 'Open shipping label' })).toBeDisabled();
      await userEvent.click(screen.getByRole('button', { name: 'Open label PDF' }));
      expect(openWindow).toHaveBeenCalledTimes(1);
      noMutations();
    });

    const terminalCases: Array<[string, Partial<OrderDetail>]> = [
      ['blocked', { allocationStatus: 'vendor_blocked' }],
      ['cancelled', { isCancelled: true, carrier: undefined, shippingStatus: 'Awaiting Shipment', fulfillmentStatus: 'Pending' }],
      ['conflict', { isCancelled: true, isCancellationConflict: true }],
      ['refunded', { operationalActionability: { actionable: false, reason: 'ALLOCATION_REFUND_TERMINAL' } }],
    ];
    it.each((['admin', 'vendor', 'support', 'finance'] as const).flatMap((role) =>
      terminalCases.map(([state, overrides]) => ({ role, state, overrides }))))(
      'preserves existing $role terminal $state presentation without introducing current carrier evidence', async ({ role, state, overrides }) => {
        actor(role);
        getOrderMock.mockResolvedValue(order({ fulfillmentActionAvailable: false, ...overrides }));
        renderOrderDetail();
        expect(await carrierValues()).toEqual(role === 'admin' ? [state === 'cancelled' ? 'Not available' : 'LEGACY-CARRIER'] : []);
        expect(screen.queryByRole('region', { name: 'Shipment information' })).not.toBeInTheDocument();
        noMutations();
      });

    it('leaves the Shopify tracking payload carrier unchanged when the displayed evidence differs', async () => {
      actor('admin');
      renderOrderDetail();
      expect(await carrierValues()).toEqual(['Aras Kargo']);
      noMutations();
      await userEvent.click(screen.getByRole('button', { name: 'Sync tracking to Shopify' }));
      await waitFor(() => expect(submitFulfillmentTrackingMock).toHaveBeenCalledExactlyOnceWith(orderWithoutShipment.id, {
        trackingNumber: 'G2-TRACK', carrier: 'LEGACY-CARRIER', trackingUrl: 'https://tracking.example/g2', notifyCustomer: false,
      }));
      expect(createShipmentExecutionMock).not.toHaveBeenCalled();
      expect(retryFailedShipmentExecutionMock).not.toHaveBeenCalled();
    });

    it('does not retain another allocation carrier or its late refetch', async () => {
      actor('support');
      const late = deferred<OrderDetail>();
      const next = deferred<OrderDetail>();
      let reads = 0;
      getOrderMock.mockImplementation((id) => id === 'alloc-yalispor-2099' ? next.promise
        : ++reads === 1 ? Promise.resolve(order()) : late.promise);
      const { queryClient } = renderOrderDetail();
      expect(await carrierValues()).toEqual(['Aras Kargo']);
      act(() => { void queryClient.invalidateQueries({ queryKey: queryKeys.orders.detail(orderWithoutShipment.id, 'sporjinal') }); });
      await waitFor(() => expect(reads).toBe(2));
      await userEvent.click(screen.getByRole('link', { name: 'Open Vendor B order' }));
      expect(screen.queryByText('Aras Kargo')).not.toBeInTheDocument();
      await act(async () => late.resolve(order({ shipmentExecution: shipment({ providerCarrierName: 'OLD_CARRIER' }) })));
      expect(screen.queryByText('Old Carrier')).not.toBeInTheDocument();
      await act(async () => next.resolve(order({ id: 'alloc-yalispor-2099', sourceShopifyOrderNumber: '#2099',
        shipmentExecution: shipment({ allocationId: 'alloc-yalispor-2099', providerCarrierName: 'DHL' }) })));
      expect(await carrierValues()).toEqual(['DHL']);
      noMutations();
    });

    it('keeps a delayed Vendor A carrier out of Vendor B', async () => {
      actor('vendor', false, true);
      const late = deferred<OrderDetail>();
      let reads = 0;
      getOrderMock.mockImplementation(async (_id, options) => options?.vendorId === 'yalispor'
        ? order({ assignedVendorId: 'yalispor', vendorId: 'yalispor', sourceShopifyOrderNumber: '#2099', fulfillmentActionAvailable: false,
          shipmentExecution: shipment({ vendorId: 'yalispor', providerCarrierName: 'DHL' }) })
        : ++reads === 1 ? order() : late.promise);
      const { queryClient } = renderOrderDetail();
      expect(await carrierValues()).toEqual(['Aras Kargo']);
      act(() => { void queryClient.invalidateQueries({ queryKey: queryKeys.orders.detail(orderWithoutShipment.id, 'sporjinal') }); });
      await waitFor(() => expect(reads).toBe(2));
      act(() => setCurrentVendorId('yalispor'));
      expect(screen.queryByText('Aras Kargo')).not.toBeInTheDocument();
      await screen.findByText('Order #2099');
      expect(await carrierValues()).toEqual(['DHL']);
      await act(async () => late.resolve(order({ shipmentExecution: shipment({ providerCarrierName: 'OLD_CARRIER' }) })));
      expect(await carrierValues()).toEqual(['DHL']);
      expect(screen.queryByText('Old Carrier')).not.toBeInTheDocument();
      noMutations();
    });
  });

  describe('P04-02E G3 fulfillment completion evidence', () => {
    const completedAt = '2026-06-02T09:00:00.000Z';
    const trackingAt = '2026-06-02T10:00:00.000Z';
    const providerAt = '2026-06-02T11:00:00.000Z';
    function actor(role: 'admin' | 'vendor' | 'support' | 'finance' = 'vendor', canSwitchVendors = role === 'admin') {
      setCurrentUser({ email: `${role}@demo.com`, name: role, role, vendorAccess: ['sporjinal', 'yalispor'],
        vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }, { vendorId: 'yalispor', vendorName: 'Yalıspor' }],
        canSwitchVendors, defaultVendorId: 'sporjinal' });
    }
    function order(overrides: Partial<OrderDetail> = {}): OrderDetail {
      return { ...orderWithoutShipment, allocationStatus: 'fulfilled', fulfillmentActionAvailable: false,
        fulfillmentStatus: 'Fulfilled', shippingStatus: 'Delivered', fulfilledAt: completedAt,
        shipmentCreatedAt: '2026-06-02T08:00:00.000Z', shipmentUpdatedAt: trackingAt,
        trackingNumber: 'G3-TRACK', trackingUrl: 'https://tracking.example/g3', carrier: 'LEGACY-CARRIER',
        shopifyDeliverySync: null, assignmentHistory: [], timeline: [],
        shipmentExecution: { ...orderWithShipmentSummary.shipmentExecution!, provider: 'kargonomi', providerCarrierName: 'aras_kargo',
          shipmentStatus: 'delivered', trackingNumber: 'G3-TRACK', trackingUrl: 'https://tracking.example/g3',
          labelUrl: 'https://example.com/g3.pdf', lastProviderResponseAt: providerAt,
          providerResponseSummary: { ...orderWithShipmentSummary.shipmentExecution!.providerResponseSummary!,
            ok: true, providerError: null, dryRun: false, disabledGates: [] } }, ...overrides };
    }
    const synced: NonNullable<OrderDetail['shopifyFulfillmentSync']> = {
      status: 'synced', fulfillmentOrderIdPresent: true, fulfillmentIdPresent: true,
      syncStatus: 'synced', skippedReason: null, errorMessage: null, lastAttemptedAt: trackingAt,
    };
    function noMutations() {
      for (const fn of [createShipmentExecutionMock, retryFailedShipmentExecutionMock, retryShipmentExecutionMock,
        submitFulfillmentTrackingMock, refreshShipmentExecutionStatusMock, refreshShipmentProviderDataMock,
        cancelShipmentExecutionMock, updateNavlungoShipmentExecutionMock, createReturnShipmentLabelMock,
        probeShopifyReturnLabelUploadMock, probeTryOtoReturnDetailsMock, probeTryOtoReturnLinkMock, probeTryOtoReturnAwbPrintMock,
        rejectOrderMock, planAllocationSplitMock, splitAllocationMock]) expect(fn).not.toHaveBeenCalled();
    }
    beforeEach(() => {
      actor();
      getOrderMock.mockResolvedValue(order());
    });

    it.each(['admin', 'vendor', 'support', 'finance'] as const)(
      'preserves independent completion, tracking and delivery dates for %s with no native history', async (role) => {
        actor(role);
        renderOrderDetail();
        await screen.findByText('Fulfillment synced', { exact: true });
        const completion = getOrderActivityRow('Fulfillment synced');
        expect(within(completion).getByText(formatTimelineDateForTest(completedAt))).toBeInTheDocument();
        expect(completion).not.toHaveTextContent(formatTimelineDateForTest(trackingAt));
        expect(completion).not.toHaveTextContent(formatTimelineDateForTest(providerAt));
        expect(getOrderActivityRow('Tracking synced').querySelector('small')).toHaveTextContent(/^—$/);
        expect(getOrderActivityRow('Delivered').querySelector('small')).toHaveTextContent(/^—$/);
        expect(getOrderActivityRow('Shipment created')).toHaveTextContent(formatTimelineDateForTest('2026-06-02T08:00:00.000Z'));
        expect(screen.getAllByText('Fulfillment synced', { exact: true })).toHaveLength(1);
        expect(screen.queryByText('Shopify delivery synced', { exact: true })).not.toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Open tracking', exact: true })).toHaveAttribute('href', 'https://tracking.example/g3');
        const fulfillment = screen.getByRole('heading', { name: 'Fulfillment', exact: true }).closest('article')!;
        expect(within(fulfillment).getByText('Aras Kargo')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Open label PDF' })).toBeInTheDocument();
        expect(getOrderMock).toHaveBeenCalledTimes(1);
        noMutations();
      });

    it.each(['admin', 'vendor'] as const)('labels the verified first delivery observation for %s without claiming physical delivery time', async (role) => {
      actor(role);
      const observedAt = '2026-06-04T12:34:56.000Z';
      getOrderMock.mockResolvedValue(order({ firstObservedDeliveredAt: observedAt }));
      renderOrderDetail();
      await screen.findByText('Order #1028');
      const delivered = getOrderActivityRow('Delivered');
      expect(delivered).toHaveTextContent('First delivery observed by SPORGYM');
      expect(delivered.querySelector('small')).toHaveTextContent(formatTimelineDateForTest(observedAt));
      expect(delivered).not.toHaveTextContent(formatTimelineDateForTest(providerAt));
      expect(getOrderActivityRow('Tracking synced').querySelector('small')).toHaveTextContent(/^—$/);
      expect(screen.getByRole('link', { name: 'Open tracking', exact: true })).toHaveAttribute('href', 'https://tracking.example/g3');
      noMutations();
    });

    it.each([undefined, null, 'invalid-time'])(
      'keeps Delivered status without inventing an observation date for %s', async (observedAt) => {
        getOrderMock.mockResolvedValue(order({ firstObservedDeliveredAt: observedAt }));
        renderOrderDetail();
        await screen.findByText('Order #1028');
        const delivered = getOrderActivityRow('Delivered');
        expect(delivered.querySelector('small')).toHaveTextContent(/^—$/);
        expect(delivered).toHaveTextContent('Delivery observation time unavailable or unverified.');
        for (const otherTime of [providerAt, completedAt, trackingAt, orderWithShipmentSummary.date]) {
          expect(delivered).not.toHaveTextContent(formatTimelineDateForTest(otherTime));
        }
        noMutations();
      });

    it('does not create Delivered from a historical observation when current status is not delivered', async () => {
      getOrderMock.mockResolvedValue(order({
        shippingStatus: 'In Transit', shipmentExecution: { ...order().shipmentExecution!, shipmentStatus: 'in_transit' },
        firstObservedDeliveredAt: '2026-06-04T12:34:56.000Z',
      }));
      renderOrderDetail();
      await screen.findByText('Order #1028');
      expect(screen.queryByText('Delivered', { exact: true })).not.toBeInTheDocument();
      noMutations();
    });

    it('keeps native tracking history time while the derived tracking time stays unknown', async () => {
      const nativeAt = '2026-06-03T09:00:00.000Z';
      getOrderMock.mockResolvedValue(order({
        timeline: [{ label: 'tracking added', at: nativeAt, assignmentHistoryId: 'tracked-history-1' }],
        assignmentHistory: [],
      }));
      renderOrderDetail();
      await screen.findByText('Order #1028');
      const rows = Array.from(screen.getByRole('heading', { name: 'Activity' }).closest('article')!
        .querySelectorAll('li')).filter((row) => row.textContent?.includes('Tracking synced'));
      expect(rows).toHaveLength(2);
      expect(rows.some((row) => row.textContent?.includes('Tracking synced')
        && row.textContent?.includes(formatTimelineDateForTest(nativeAt)))).toBe(true);
      expect(rows.at(-1)?.querySelector('small')).toHaveTextContent(/^—$/);
      noMutations();
    });

    it('keeps same-day native tracking identity without a second derived row', async () => {
      const nativeAt = '2026-06-02T10:00:00.000Z';
      getOrderMock.mockResolvedValue(order({
        timeline: [{ label: 'tracking added', at: nativeAt, assignmentHistoryId: 'tracked-history-2' }],
      }));
      renderOrderDetail();
      await screen.findByText('Order #1028');
      const activity = screen.getByRole('heading', { name: 'Activity' }).closest('article')!;
      const trackingRows = within(activity).getAllByText('Tracking synced').map((node) => node.closest('li')!);
      expect(trackingRows).toHaveLength(1);
      expect(trackingRows[0].querySelector('small')).toHaveTextContent(formatTimelineDateForTest(nativeAt));
      noMutations();
    });

    it('keeps URL-only tracking visible with an unknown event time', async () => {
      getOrderMock.mockResolvedValue(order({ trackingNumber: undefined, trackingUrl: 'https://tracking.example/url-only',
        shipmentUpdatedAt: undefined, fulfilledAt: undefined, shopifyFulfillmentSync: null }));
      renderOrderDetail();
      await screen.findByText('Order #1028');
      expect(getOrderActivityRow('Tracking synced').querySelector('small')).toHaveTextContent(/^—$/);
      expect(screen.getByRole('link', { name: 'Open tracking', exact: true }))
        .toHaveAttribute('href', 'https://tracking.example/url-only');
      noMutations();
    });

    it.each([undefined, null])('does not infer completion from raw Fulfilled without timestamp/sync (%s)', async (fulfilledAt) => {
      getOrderMock.mockResolvedValue(order({ fulfilledAt: fulfilledAt as OrderDetail['fulfilledAt'], shopifyFulfillmentSync: null }));
      renderOrderDetail();
      await screen.findByText('Order #1028');
      expect(screen.queryByText('Fulfillment synced', { exact: true })).not.toBeInTheDocument();
      noMutations();
    });

    it.each([
      ['synced', undefined], ['synced', null], ['fulfillment ID', undefined], ['fulfillment ID', null],
    ] as const)('shows %s evidence with missing time %s using the existing dash', async (evidence, fulfilledAt) => {
      getOrderMock.mockResolvedValue(order({ fulfilledAt: fulfilledAt as OrderDetail['fulfilledAt'],
        shopifyFulfillmentSync: evidence === 'synced' ? { ...synced, fulfillmentIdPresent: false } : { ...synced, status: 'pending' } }));
      renderOrderDetail();
      await screen.findByText('Fulfillment synced', { exact: true });
      const row = getOrderActivityRow('Fulfillment synced');
      expect(row.querySelector('small')).toHaveTextContent(/^—$/);
      for (const otherTime of [trackingAt, providerAt, orderWithShipmentSummary.date]) {
        expect(row).not.toHaveTextContent(formatTimelineDateForTest(otherTime));
      }
      noMutations();
    });

    it('does not replace an invalid supplied completion time with another event time', async () => {
      getOrderMock.mockResolvedValue(order({ fulfilledAt: 'invalid-completion-date' }));
      renderOrderDetail();
      await screen.findByText('Fulfillment synced', { exact: true });
      expect(getOrderActivityRow('Fulfillment synced').querySelector('small')).toHaveTextContent(/^—$/);
      noMutations();
    });

    it.each(['admin', 'vendor', 'support', 'finance'] as const)(
      'shows equivalent native completion evidence once for %s without losing its current date', async (role) => {
        actor(role);
        getOrderMock.mockResolvedValue(order({ timeline: [
          { label: 'fulfillment synced', at: '2026-06-02T12:00:00+03:00' },
        ] }));
        renderOrderDetail();
        await screen.findByText('Fulfillment synced', { exact: true });
        const activity = screen.getByRole('heading', { name: 'Activity' }).closest('article')!;
        expect(within(activity).getAllByText(/fulfillment synced/i)).toHaveLength(1);
        expect(getOrderActivityRow('Fulfillment synced')).toHaveTextContent(formatTimelineDateForTest(completedAt));
        noMutations();
      });

    it('does not discard a native completion with a different timestamp', async () => {
      actor('admin');
      const historicalAt = '2026-06-01T09:00:00.000Z';
      getOrderMock.mockResolvedValue(order({ timeline: [{ label: 'fulfillment synced', at: historicalAt }] }));
      renderOrderDetail();
      await screen.findByText('Fulfillment synced', { exact: true });
      const activity = screen.getByRole('heading', { name: 'Activity' }).closest('article')!;
      const rows = within(activity).getAllByText(/fulfillment synced/i).map((title) => title.closest('li')!);
      expect(rows).toHaveLength(2);
      expect(rows.some((row) => row.textContent?.includes(formatTimelineDateForTest(completedAt)))).toBe(true);
      expect(rows.some((row) => row.textContent?.includes(formatTimelineDateForTest(historicalAt)))).toBe(true);
      noMutations();
    });

    it('preserves supplied fulfilledAt without shipment or tracking evidence', async () => {
      getOrderMock.mockResolvedValue(order({ shipmentExecution: null, trackingNumber: undefined, trackingUrl: undefined,
        carrier: undefined, shipmentCreatedAt: undefined, shipmentUpdatedAt: undefined, shippingStatus: 'Awaiting Shipment',
        shopifyFulfillmentSync: null }));
      renderOrderDetail();
      await screen.findByText('Fulfillment synced', { exact: true });
      expect(getOrderActivityRow('Fulfillment synced')).toHaveTextContent(formatTimelineDateForTest(completedAt));
      expect(screen.queryByText('Shopify delivery synced', { exact: true })).not.toBeInTheDocument();
      noMutations();
    });

    it('preserves the panel pending-reassignment event condition without enabling actions', async () => {
      getOrderMock.mockResolvedValue(order({ allocationStatus: 'pending_reassignment', reassignmentRequired: true }));
      renderOrderDetail();
      await screen.findByText('Fulfillment synced', { exact: true });
      expect(getOrderActivityRow('Fulfillment synced')).toHaveTextContent(formatTimelineDateForTest(completedAt));
      expect(screen.queryByRole('region', { name: 'Smart label action' })).not.toBeInTheDocument();
      noMutations();
    });

    const terminalCases: Array<[string, Partial<OrderDetail>]> = [
      ['cancelled', { isCancelled: true, carrier: undefined, trackingNumber: undefined, trackingUrl: undefined,
        shippingStatus: 'Awaiting Shipment', fulfillmentStatus: 'Pending' }],
      ['conflict', { isCancelled: true, isCancellationConflict: true }],
      ['refunded', { operationalActionability: { actionable: false, reason: 'ALLOCATION_REFUND_TERMINAL' } }],
      ['blocked', { allocationStatus: 'vendor_blocked' }],
    ];
    it.each((['admin', 'vendor', 'support', 'finance'] as const).flatMap((role) =>
      terminalCases.map(([state, overrides]) => ({ role, state, overrides }))))(
      'suppresses the new completion event for $role in canonical $state state', async ({ role, overrides }) => {
        actor(role);
        getOrderMock.mockResolvedValue(order({ shopifyFulfillmentSync: synced, ...overrides }));
        renderOrderDetail();
        await screen.findByText('Order #1028');
        expect(screen.queryByText('Fulfillment synced', { exact: true })).not.toBeInTheDocument();
        noMutations();
      });

    it('does not retain a previous allocation completion or accept its delayed refetch', async () => {
      const late = deferred<OrderDetail>();
      const next = deferred<OrderDetail>();
      const nextAt = '2026-06-03T09:00:00.000Z';
      let reads = 0;
      getOrderMock.mockImplementation((id) => id === 'alloc-yalispor-2099' ? next.promise
        : ++reads === 1 ? Promise.resolve(order()) : late.promise);
      const { queryClient } = renderOrderDetail();
      await screen.findByText('Fulfillment synced', { exact: true });
      const oldRow = getOrderActivityRow('Fulfillment synced');
      act(() => { void queryClient.invalidateQueries({ queryKey: queryKeys.orders.detail(orderWithoutShipment.id, 'sporjinal') }); });
      await waitFor(() => expect(reads).toBe(2));
      await userEvent.click(screen.getByRole('link', { name: 'Open Vendor B order' }));
      expect(oldRow).not.toBeInTheDocument();
      await act(async () => late.resolve(order()));
      expect(screen.queryByText('Fulfillment synced', { exact: true })).not.toBeInTheDocument();
      await act(async () => next.resolve(order({ id: 'alloc-yalispor-2099', sourceShopifyOrderNumber: '#2099', fulfilledAt: nextAt })));
      await screen.findByText('Fulfillment synced', { exact: true });
      expect(getOrderActivityRow('Fulfillment synced')).toHaveTextContent(formatTimelineDateForTest(nextAt));
      expect(getOrderActivityRow('Fulfillment synced')).not.toHaveTextContent(formatTimelineDateForTest(completedAt));
      noMutations();
    });

    it('keeps delayed Vendor A completion evidence out of Vendor B', async () => {
      actor('vendor', true);
      const late = deferred<OrderDetail>();
      const nextAt = '2026-06-03T09:00:00.000Z';
      let reads = 0;
      getOrderMock.mockImplementation(async (_id, options) => options?.vendorId === 'yalispor'
        ? order({ assignedVendorId: 'yalispor', vendorId: 'yalispor', sourceShopifyOrderNumber: '#2099', fulfilledAt: nextAt })
        : ++reads === 1 ? order() : late.promise);
      const { queryClient } = renderOrderDetail();
      await screen.findByText('Fulfillment synced', { exact: true });
      const oldRow = getOrderActivityRow('Fulfillment synced');
      act(() => { void queryClient.invalidateQueries({ queryKey: queryKeys.orders.detail(orderWithoutShipment.id, 'sporjinal') }); });
      await waitFor(() => expect(reads).toBe(2));
      act(() => setCurrentVendorId('yalispor'));
      expect(oldRow).not.toBeInTheDocument();
      await screen.findByText('Order #2099');
      expect(getOrderActivityRow('Fulfillment synced')).toHaveTextContent(formatTimelineDateForTest(nextAt));
      await act(async () => late.resolve(order()));
      expect(getOrderActivityRow('Fulfillment synced')).toHaveTextContent(formatTimelineDateForTest(nextAt));
      expect(getOrderActivityRow('Fulfillment synced')).not.toHaveTextContent(formatTimelineDateForTest(completedAt));
      noMutations();
    });
  });

  describe('P04-U2 Admin historical integration evidence', () => {
    const status = orderWithShipmentSummary.orderSnapshot!.vendorIntegrationStatus!;
    const states: Array<{ state: string; overrides: Partial<OrderDetail>; terminal: boolean }> = [
      { state: 'active', overrides: {}, terminal: false },
      { state: 'cancelled', overrides: { isCancelled: true, carrier: undefined, trackingNumber: undefined,
        trackingUrl: undefined, shippingStatus: 'Awaiting Shipment', fulfillmentStatus: 'Pending' }, terminal: true },
      { state: 'conflict', overrides: { isCancelled: true, isCancellationConflict: true }, terminal: true },
      { state: 'refunded', overrides: { operationalActionability: { actionable: false, reason: 'ALLOCATION_REFUND_TERMINAL' } }, terminal: true },
      { state: 'blocked', overrides: { allocationStatus: 'vendor_blocked' }, terminal: true },
    ];
    function actor(role: CurrentUser['role'] = 'admin') {
      setCurrentUser({ email: `${role}@demo.com`, name: role, role,
        vendorAccess: ['sporjinal', 'yalispor'],
        vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }, { vendorId: 'yalispor', vendorName: 'Yalıspor' }],
        canSwitchVendors: role === 'admin', defaultVendorId: 'sporjinal' });
    }
    function order(overrides: Partial<OrderDetail> = {}): OrderDetail {
      return { ...orderWithoutShipment, ...overrides };
    }
    function noMutations() {
      for (const fn of [createShipmentExecutionMock, retryFailedShipmentExecutionMock, retryShipmentExecutionMock,
        submitFulfillmentTrackingMock, refreshShipmentExecutionStatusMock, refreshShipmentProviderDataMock,
        cancelShipmentExecutionMock, updateNavlungoShipmentExecutionMock, createReturnShipmentLabelMock,
        probeShopifyReturnLabelUploadMock, probeTryOtoReturnDetailsMock, probeTryOtoReturnLinkMock, probeTryOtoReturnAwbPrintMock,
        rejectOrderMock, planAllocationSplitMock, splitAllocationMock, updateVendorShippingConfigMock,
        syncKargonomiWarehouseDetailsMock]) expect(fn).not.toHaveBeenCalled();
    }
    async function snapshot() {
      await screen.findByText('Order #1028');
      const section = screen.getByRole('heading', { name: 'Shopify order snapshot' }).closest('article')!;
      await userEvent.click(within(section).getByText('Show details', { exact: true }));
      return section;
    }
    beforeEach(() => { actor(); getOrderMock.mockResolvedValue(order()); });

    it.each(states)('preserves supplied Admin snapshot evidence in $state without making it current operational state', async ({ overrides, terminal }) => {
      getOrderMock.mockResolvedValue(order(overrides));
      renderOrderDetail();
      const section = await snapshot();
      const value = within(section).getByText('Vendor integration', { exact: true }).nextElementSibling;
      expect(value).toHaveTextContent(new RegExp(`^${status}$`));
      expect(value).toBeVisible();
      expect(within(section).getByText('Order imported into Entegra')).toBeVisible();
      expect(within(section).getByText('Provider A')).toBeVisible();
      const tracking = within(section).getByRole('link', { name: 'Open external tracking' });
      expect(tracking).toHaveAttribute('href', orderWithShipmentSummary.orderSnapshot!.vendorIntegrationTrackingUrl);
      expect(tracking).toHaveAttribute('target', '_blank');
      expect(tracking.getAttribute('rel')).toContain('noreferrer');
      expect(within(section).getByText('External shipped at').nextElementSibling).not.toHaveTextContent(/^—$/);
      expect(within(section).queryByRole('button')).not.toBeInTheDocument();
      expect(screen.getByLabelText('Current order state')).not.toHaveTextContent(status);
      const fulfillment = screen.getByRole('heading', { name: 'Fulfillment', exact: true }).closest('article')!;
      expect(fulfillment).not.toHaveTextContent(status);
      if (terminal) {
        expect(screen.getByLabelText('Current order state')).toHaveClass('is-canonical');
        expect(screen.queryByRole('region', { name: 'Smart label action' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Create shipment', exact: true })).not.toBeInTheDocument();
      }
      expect(getOrderMock).toHaveBeenCalledExactlyOnceWith(orderWithoutShipment.id,
        expect.objectContaining({ vendorId: 'sporjinal' }));
      noMutations();
    });

    it.each([undefined, null, '', '   '])('uses the existing dash for terminal missing status %j', async (value) => {
      getOrderMock.mockResolvedValue(order({ ...states[1].overrides,
        orderSnapshot: { ...orderWithoutShipment.orderSnapshot!, vendorIntegrationStatus: value } }));
      renderOrderDetail();
      const section = await snapshot();
      expect(within(section).getByText('Vendor integration', { exact: true }).nextElementSibling).toHaveTextContent(/^—$/);
      noMutations();
    });

    it('keeps a terminal record with no snapshot compatible', async () => {
      getOrderMock.mockResolvedValue(order({ ...states[1].overrides, orderSnapshot: null }));
      renderOrderDetail();
      const section = await snapshot();
      expect(within(section).getByText('Vendor integration', { exact: true }).nextElementSibling).toHaveTextContent(/^—$/);
      expect(within(section).queryByText('Integration note')).not.toBeInTheDocument();
      expect(within(section).queryByRole('link', { name: 'Open external tracking' })).not.toBeInTheDocument();
      noMutations();
    });

    it.each((['vendor', 'support', 'finance'] as const).flatMap((role) => states.map((state) => ({ role, ...state }))))(
      'does not disclose the Admin snapshot to authorized $role on $state', async ({ role, overrides }) => {
        actor(role);
        getOrderMock.mockResolvedValue(order(overrides));
        renderOrderDetail();
        await screen.findByText('Order #1028');
        expect(screen.queryByRole('heading', { name: 'Shopify order snapshot' })).not.toBeInTheDocument();
        expect(screen.queryByText('Vendor integration', { exact: true })).not.toBeInTheDocument();
        expect(screen.queryByText('Order imported into Entegra')).not.toBeInTheDocument();
        expect(screen.queryByText('Provider A')).not.toBeInTheDocument();
        expect(screen.queryByRole('link', { name: 'Open external tracking' })).not.toBeInTheDocument();
        noMutations();
      });

    it('discards a prior allocation snapshot and ignores its delayed response', async () => {
      const late = deferred<OrderDetail>();
      const next = deferred<OrderDetail>();
      let reads = 0;
      getOrderMock.mockImplementation((id) => id === 'alloc-yalispor-2099' ? next.promise
        : ++reads === 1 ? Promise.resolve(order(states[1].overrides)) : late.promise);
      const { queryClient } = renderOrderDetail();
      await snapshot();
      act(() => { void queryClient.invalidateQueries({ queryKey: queryKeys.orders.detail(orderWithoutShipment.id, 'sporjinal') }); });
      await waitFor(() => expect(reads).toBe(2));
      await userEvent.click(screen.getByRole('link', { name: 'Open Vendor B order' }));
      expect(screen.queryByText('Order imported into Entegra')).not.toBeInTheDocument();
      await act(async () => late.resolve(order(states[1].overrides)));
      expect(screen.queryByText('Order imported into Entegra')).not.toBeInTheDocument();
      await act(async () => next.resolve(order({ id: 'alloc-yalispor-2099', sourceShopifyOrderNumber: '#2099',
        ...states[1].overrides, orderSnapshot: { ...orderWithoutShipment.orderSnapshot!,
          vendorIntegrationStatus: null, vendorIntegrationStatusMessage: null, vendorIntegrationProvider: null,
          vendorIntegrationTrackingUrl: null, vendorIntegrationShippedAt: null } })));
      await screen.findByText('Order #2099');
      const section = screen.getByRole('heading', { name: 'Shopify order snapshot' }).closest('article')!;
      await userEvent.click(within(section).getByText('Show details', { exact: true }));
      expect(within(section).getByText('Vendor integration', { exact: true }).nextElementSibling).toHaveTextContent(/^—$/);
      expect(section).not.toHaveTextContent('Order imported into Entegra');
      noMutations();
    });

    it('does not restore Vendor A historical integration after an Admin switches to Vendor B', async () => {
      const late = deferred<OrderDetail>();
      let reads = 0;
      getOrderMock.mockImplementation(async (_id, options) => options?.vendorId === 'yalispor'
        ? order({ ...states[1].overrides, assignedVendorId: 'yalispor', vendorId: 'yalispor', sourceShopifyOrderNumber: '#2099',
          orderSnapshot: { ...orderWithoutShipment.orderSnapshot!, vendorIntegrationStatus: null,
            vendorIntegrationStatusMessage: null, vendorIntegrationProvider: null, vendorIntegrationTrackingUrl: null,
            vendorIntegrationShippedAt: null } })
        : ++reads === 1 ? order(states[1].overrides) : late.promise);
      const { queryClient } = renderOrderDetail();
      await snapshot();
      act(() => { void queryClient.invalidateQueries({ queryKey: queryKeys.orders.detail(orderWithoutShipment.id, 'sporjinal') }); });
      await waitFor(() => expect(reads).toBe(2));
      act(() => setCurrentVendorId('yalispor'));
      expect(screen.queryByText('Order imported into Entegra')).not.toBeInTheDocument();
      await screen.findByText('Order #2099');
      await act(async () => late.resolve(order(states[1].overrides)));
      const section = screen.getByRole('heading', { name: 'Shopify order snapshot' }).closest('article')!;
      await userEvent.click(within(section).getByText('Show details', { exact: true }));
      expect(within(section).getByText('Vendor integration', { exact: true }).nextElementSibling).toHaveTextContent(/^—$/);
      expect(section).not.toHaveTextContent('Order imported into Entegra');
      expect(section).not.toHaveTextContent('Provider A');
      expect(within(section).queryByRole('link', { name: 'Open external tracking' })).not.toBeInTheDocument();
      noMutations();
    });
  });
  describe('P04-U3 canonical refund-terminal timestamp authority', () => {
    const ledgerAt = '2026-06-03T10:00:00.000Z';
    const olderLedgerAt = '2026-06-01T08:00:00.000Z';
    const blockedAt = '2026-06-02T09:00:00.000Z';
    function actor(role: 'admin' | 'vendor') {
      setCurrentUser({ email: `${role}@demo.com`, name: role, role, vendorAccess: ['sporjinal'],
        vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
        canSwitchVendors: role === 'admin', defaultVendorId: 'sporjinal' });
    }
    const cases = [
      { name: 'no timestamp evidence', dates: [] },
      { name: 'ledger creation only', dates: [ledgerAt] },
      { name: 'assignment timestamp only', dates: [], block: blockedAt },
      { name: 'both unrelated sources', dates: [ledgerAt], block: blockedAt },
      { name: 'multiple refund ledger entries', dates: [ledgerAt, olderLedgerAt], block: blockedAt },
      { name: 'missing Finance record', dates: [], block: blockedAt },
      { name: 'invalid timestamps', dates: ['invalid-ledger-date'], block: 'invalid-block-date' },
      { name: 'empty timestamps', dates: [''], block: '' },
    ];
    it.each((['admin', 'vendor'] as const).flatMap((role) => cases.map((fixture) => ({ role, ...fixture }))))(
      'keeps canonical dates unknown for $role with $name, preserving separate Finance evidence', async ({ role, dates, block }) => {
        actor(role);
        const dashboard = buildOrderFinanceDashboard({ includeProductRefund: true });
        const refund = dashboard.transactions.find((record) => record.category === 'Refund')!;
        const refunds = dates.map((date, index) => ({ ...refund, id: `u3-refund-${index}`, date }));
        getFinanceDashboardMock.mockResolvedValue({ ...dashboard, transactions: refunds });
        getOrderMock.mockResolvedValue({ ...orderWithoutShipment,
          operationalActionability: { actionable: false, reason: 'ALLOCATION_REFUND_TERMINAL' },
          fulfillmentActionAvailable: false, allocationStatus: 'active', assignmentBlockedAt: block,
          assignmentHistory: [], timeline: [], trackingNumber: undefined, trackingUrl: undefined,
          shippingStatus: 'Awaiting Shipment', fulfillmentStatus: 'Pending' });
        renderOrderDetail();
        await screen.findByLabelText('Current order state');
        await waitFor(() => expect(getFinanceDashboardMock).toHaveBeenCalled());
        const activity = screen.getByRole('heading', { name: 'Activity' }).closest('article')!;
        if (role === 'admin' && refunds.length) {
          await waitFor(() => expect(within(activity).getAllByRole('link', { name: 'Refund processed' })).toHaveLength(refunds.length));
          for (const record of refunds) {
            const link = within(activity).getAllByRole('link', { name: 'Refund processed' })
              .find((item) => item.getAttribute('href') === `/finance?ledgerId=${record.id}`);
            expect(link).toBeDefined();
            const row = link!.closest('li')!;
            expect(row).toHaveTextContent(record.amount);
            expect(row.querySelector('small')).toHaveTextContent(
              record.date && record.date !== 'invalid-ledger-date' ? formatTimelineDateForTest(record.date) : '—');
          }
        } else {
          expect(within(activity).queryByRole('link', { name: 'Refund processed' })).not.toBeInTheDocument();
        }
        for (const title of ['Refund completed', 'Fulfillment not required']) {
          const row = getOrderActivityRow(title);
          expect(row.querySelector('small')).toHaveTextContent(/^—$/);
          for (const unrelated of [ledgerAt, olderLedgerAt, blockedAt, orderWithoutShipment.date]) {
            expect(row).not.toHaveTextContent(formatTimelineDateForTest(unrelated));
          }
        }
        expect(screen.getByLabelText('Current order state')).toHaveTextContent('Refunded');
        expect(screen.queryByRole('button', { name: 'Create shipment', exact: true })).not.toBeInTheDocument();
        for (const mutation of [createShipmentExecutionMock, retryFailedShipmentExecutionMock, retryShipmentExecutionMock,
          submitFulfillmentTrackingMock, rejectOrderMock, splitAllocationMock]) expect(mutation).not.toHaveBeenCalled();
        expect(getOrderMock).toHaveBeenCalledWith(orderWithoutShipment.id, expect.objectContaining({ vendorId: 'sporjinal' }));
      });

    it.each(['admin', 'vendor'] as const)('retains legitimate Vendor-block event dates for %s', async (role) => {
      actor(role);
      getOrderMock.mockResolvedValue({ ...orderWithoutShipment, allocationStatus: 'vendor_blocked',
        assignmentBlockedAt: blockedAt, assignmentHistory: [{ id: 'u3-block', action: 'vendor_blocked',
          createdAt: blockedAt, actorName: 'Vendor', actorRole: 'vendor' }], timeline: [],
        shippingStatus: 'Awaiting Shipment', fulfillmentStatus: 'Pending' });
      renderOrderDetail();
      await screen.findByLabelText('Current order state');
      const row = getOrderActivityRow(role === 'admin' ? 'Current state: Vendor blocked' : 'Order blocked from shipment');
      expect(row.querySelector('small')).toHaveTextContent(formatTimelineDateForTest(blockedAt));
    });
  });

  describe('P04-U4-A1 canonical refund audience visibility', () => {
    const nativeAt = '2025-10-02T09:30:00.000Z';
    const noteAt = '2025-10-01T08:00:00.000Z';
    const collisions = [
      { name: 'no collision', labels: [] },
      { name: 'refund collision', labels: ['refund completed'] },
      { name: 'fulfillment collision', labels: ['fulfillment not required'] },
      { name: 'both collisions', labels: ['refund completed', 'fulfillment not required'] },
    ];
    it.each((['vendor', 'admin'] as const).flatMap((role) => collisions.map((item) => ({ role, ...item }))))(
      'preserves $role handling with $name without exposing hidden native data', async ({ role, labels }) => {
        setCurrentUser({ email: `${role}@demo.com`, name: role, role, vendorAccess: ['sporjinal'],
          vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
          canSwitchVendors: role === 'admin', defaultVendorId: 'sporjinal' });
        getOrderMock.mockResolvedValue({ ...orderWithoutShipment,
          allocationStatus: 'active', fulfillmentActionAvailable: false,
          operationalActionability: { actionable: false, reason: 'ALLOCATION_REFUND_TERMINAL' },
          fulfillmentStatus: 'Pending', shippingStatus: 'Awaiting Shipment',
          trackingNumber: undefined, trackingUrl: undefined,
          timeline: [...labels.map((label) => ({ label, at: nativeAt })),
            { label: 'Internal review note', at: noteAt }] });
        renderOrderDetail();
        await screen.findByLabelText('Current order state');
        const activity = screen.getByRole('heading', { name: 'Activity' }).closest('article')!;
        for (const title of ['Refund completed', 'Fulfillment not required']) {
          const rows = within(activity).getAllByText(new RegExp(`^${title}$`, 'i'));
          expect(rows).toHaveLength(1);
          const row = rows[0].closest('li')!;
          const nativeWins = role === 'admin' && labels.includes(title.toLowerCase());
          expect(row.querySelector('small')).toHaveTextContent(
            nativeWins ? formatTimelineDateForTest(nativeAt) : /^—$/);
          if (!nativeWins) expect(row).not.toHaveTextContent(formatTimelineDateForTest(nativeAt));
        }
        if (role === 'vendor') {
          expect(activity).not.toHaveTextContent(formatTimelineDateForTest(nativeAt));
          expect(within(activity).queryByText(/internal review note/i)).not.toBeInTheDocument();
        } else {
          const nativeNote = within(activity).getByText(/internal review note/i).closest('li')!;
          expect(nativeNote).toHaveTextContent(formatTimelineDateForTest(noteAt));
        }
        expect(screen.getByLabelText('Current order state')).toHaveTextContent('Refunded');
        expect(screen.queryByRole('region', { name: 'Smart label action' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Create shipment', exact: true })).not.toBeInTheDocument();
        expect(getOrderMock).toHaveBeenCalledWith(orderWithoutShipment.id, expect.objectContaining({ vendorId: 'sporjinal' }));
        for (const mutation of [createShipmentExecutionMock, retryFailedShipmentExecutionMock, retryShipmentExecutionMock,
          submitFulfillmentTrackingMock, refreshShipmentExecutionStatusMock, refreshShipmentProviderDataMock,
          cancelShipmentExecutionMock, rejectOrderMock, planAllocationSplitMock, splitAllocationMock]) {
          expect(mutation).not.toHaveBeenCalled();
        }
      });
  });

  describe('P04-U4-B1 distinct linked Return Activity', () => {
    const firstAt = '2026-06-02T09:00:00.000Z';
    const laterAt = '2026-06-02T11:00:00.000Z';
    function actor(role: 'admin' | 'vendor') {
      setCurrentUser({ email: `${role}@demo.com`, name: role, role, vendorAccess: ['sporjinal'],
        vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
        canSwitchVendors: role === 'admin', defaultVendorId: 'sporjinal' });
    }
    function record(id: string, date: string, displayTitle: string) {
      return { id, date, displayTitle, status: 'Requested', sourceType: 'shopify_return_request' as const,
        relatedOrderId: orderWithoutShipment.id, sourceShopifyOrderId: orderWithoutShipment.sourceShopifyOrderId,
        sourceShopifyOrderNumber: orderWithoutShipment.sourceShopifyOrderNumber };
    }
    function noMutations() {
      for (const fn of [createShipmentExecutionMock, retryFailedShipmentExecutionMock, retryShipmentExecutionMock,
        submitFulfillmentTrackingMock, refreshShipmentExecutionStatusMock, refreshShipmentProviderDataMock,
        cancelShipmentExecutionMock, createReturnShipmentLabelMock, probeShopifyReturnLabelUploadMock,
        probeTryOtoReturnDetailsMock, probeTryOtoReturnLinkMock, probeTryOtoReturnAwbPrintMock,
        rejectOrderMock, planAllocationSplitMock, splitAllocationMock]) expect(fn).not.toHaveBeenCalled();
    }
    const cases = [
      { name: 'distinct IDs at identical instants', records: [record('b1-a', firstAt, 'First returned product'), record('b1-b', firstAt, 'Second returned product')] },
      { name: 'distinct IDs at different same-day instants', records: [record('b1-a', firstAt, 'First returned product'), record('b1-b', laterAt, 'Second returned product')] },
      { name: 'distinct IDs on different days', records: [record('b1-a', firstAt, 'First returned product'), record('b1-b', '2026-06-03T09:00:00.000Z', 'Second returned product')] },
      { name: 'single Return', records: [record('b1-a', firstAt, 'First returned product')] },
      { name: 'same ID retains existing grouping', records: [record('b1-a', firstAt, 'First returned product'), record('b1-a', laterAt, 'Second returned product')] },
      { name: 'empty ID retains existing grouping', records: [record('', firstAt, 'First returned product'), record('', laterAt, 'Second returned product')] },
    ];
    it.each((['admin', 'vendor'] as const).flatMap((role) => cases.map((item) => ({ role, ...item }))))(
      'preserves $role Return evidence with $name', async ({ role, records }) => {
        actor(role);
        getOrderMock.mockResolvedValue({ ...orderWithoutShipment, timeline: [], trackingNumber: undefined,
          trackingUrl: undefined, shipmentCreatedAt: undefined, fulfilledAt: undefined });
        listReturnsMock.mockResolvedValue([...records, { ...record('unrelated-return', firstAt, 'Unrelated order item'),
          relatedOrderId: 'another-allocation', sourceShopifyOrderId: '999999999', sourceShopifyOrderNumber: '#999999999' }]);
        renderOrderDetail();
        await screen.findByLabelText('Current order state');
        const activity = screen.getByRole('heading', { name: 'Activity' }).closest('article')!;
        const expected = records.filter((entry, index) => records.findIndex((other) => other.id === entry.id) === index);
        await waitFor(() => expect(within(activity).getAllByRole('link', { name: 'Return requested', exact: true })).toHaveLength(expected.length));
        for (const entry of expected) {
          const link = within(activity).getAllByRole('link', { name: 'Return requested', exact: true })
            .find((item) => item.getAttribute('href') === `/returns/${entry.id}`);
          expect(link).toBeDefined();
          const row = link!.closest('li')!;
          expect(row).toHaveTextContent(entry.displayTitle);
          expect(row.querySelector('small')).toHaveTextContent(formatTimelineDateForTest(entry.date));
          expect(within(row).queryByText('Requested', { exact: true })).not.toBeInTheDocument();
        }
        expect(activity).not.toHaveTextContent('Unrelated order item');
        expect(activity.querySelector('a[href="/returns/unrelated-return"]')).toBeNull();
        expect(getOrderMock).toHaveBeenCalledWith(orderWithoutShipment.id, expect.objectContaining({ vendorId: 'sporjinal' }));
        noMutations();
      });

    it.each(['admin', 'vendor'] as const)('keeps native Return and non-Return same-day grouping unchanged for %s', async (role) => {
      actor(role);
      getOrderMock.mockResolvedValue({ ...orderWithoutShipment, trackingNumber: undefined, trackingUrl: undefined,
        shipmentCreatedAt: undefined, fulfilledAt: undefined, timeline: [
          { label: 'return requested', at: firstAt }, { label: 'return requested', at: laterAt },
          { label: 'tracking added', at: firstAt }, { label: 'tracking synced', at: laterAt },
        ] });
      renderOrderDetail();
      await screen.findByLabelText('Current order state');
      const activity = screen.getByRole('heading', { name: 'Activity' }).closest('article')!;
      for (const title of ['Return requested', 'Tracking synced']) {
        const titles = within(activity).getAllByText(new RegExp(`^${title}$`, 'i'));
        expect(titles).toHaveLength(1);
        const row = titles[0].closest('li')!;
        expect(row.querySelector('small')).toHaveTextContent(formatTimelineDateForTest(firstAt));
        expect(row).not.toHaveTextContent(formatTimelineDateForTest(laterAt));
      }
      noMutations();
    });
  });

  describe('P04-U4-D1 canonical-present cancellation Activity', () => {
    const orderAt = '2024-01-02T08:00:00.000Z';
    const cancelledAt = '2026-06-02T11:00:00.000Z';
    const blockedAt = '2026-06-01T09:00:00.000Z';
    function actor(role: 'admin' | 'vendor') {
      setCurrentUser({ email: `${role}@demo.com`, name: role, role, vendorAccess: ['sporjinal'],
        vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
        canSwitchVendors: role === 'admin', defaultVendorId: 'sporjinal' });
    }
    function order(overrides: Partial<OrderDetail> = {}): OrderDetail {
      return { ...orderWithoutShipment, date: orderAt, allocationStatus: 'active', isCancelled: true,
        isCancellationConflict: false, cancelledAt, cancelReason: 'declined', assignmentHistory: [],
        shippingStatus: 'Awaiting Shipment', fulfillmentStatus: 'Pending', carrier: undefined,
        trackingNumber: undefined, trackingUrl: undefined, fulfilledAt: undefined,
        shipmentCreatedAt: undefined, shipmentUpdatedAt: undefined, timeline: [], ...overrides };
    }
    function noMutations() {
      for (const fn of [createShipmentExecutionMock, retryFailedShipmentExecutionMock, retryShipmentExecutionMock,
        submitFulfillmentTrackingMock, refreshShipmentExecutionStatusMock, refreshShipmentProviderDataMock,
        cancelShipmentExecutionMock, createReturnShipmentLabelMock, probeShopifyReturnLabelUploadMock,
        rejectOrderMock, planAllocationSplitMock, splitAllocationMock]) expect(fn).not.toHaveBeenCalled();
    }
    const cases = [
      { name: 'no native collision', native: false, nativeAt: cancelledAt },
      { name: 'same instant', native: true, nativeAt: cancelledAt },
      { name: 'different same-day instant', native: true, nativeAt: '2026-06-02T09:00:00.000Z' },
      { name: 'different day', native: true, nativeAt: '2026-06-03T09:00:00.000Z' },
      { name: 'missing native time', native: true, nativeAt: undefined as unknown as string },
      { name: 'invalid native time', native: true, nativeAt: 'invalid-native-time' },
      { name: 'legacy canonical fallback', native: true, nativeAt: cancelledAt, missingCanonical: true },
    ];
    it.each((['admin', 'vendor'] as const).flatMap((role) => [false, true].flatMap((conflict) =>
      cases.map((item) => ({ role, conflict, ...item }))))) (
      'preserves $role canonical cancellation conflict=$conflict with $name', async ({ role, conflict, native, nativeAt, missingCanonical }) => {
        actor(role);
        getOrderMock.mockResolvedValue(order({ isCancellationConflict: conflict,
          cancelledAt: missingCanonical ? null : cancelledAt,
          assignmentBlockedAt: missingCanonical ? blockedAt : undefined,
          timeline: native ? [{ label: 'Shopify order cancelled', at: nativeAt }] : [] }));
        renderOrderDetail();
        await screen.findByLabelText('Current order state');
        const activity = screen.getByRole('heading', { name: 'Activity' }).closest('article')!;
        const cancellation = within(activity).getAllByText('Shopify order cancelled', { exact: true });
        expect(cancellation).toHaveLength(1);
        const row = cancellation[0].closest('li')!;
        expect(row.querySelector('small')).toHaveTextContent(formatTimelineDateForTest(missingCanonical ? blockedAt : cancelledAt));
        expect(row).toHaveTextContent('Reason: declined.');
        const creation = within(activity).getAllByText(/^Order created$/i);
        expect(creation).toHaveLength(1);
        expect(creation[0].closest('li')!.querySelector('small')).toHaveTextContent(formatTimelineDateForTest(orderAt));
        if (conflict) {
          expect(within(activity).getByText('Existing operational evidence')).toBeInTheDocument();
          expect(screen.getByLabelText('Current order state')).toHaveTextContent('Review');
        } else {
          expect(within(activity).getByText('Fulfillment not required')).toBeInTheDocument();
        }
        expect(screen.queryByRole('region', { name: 'Smart label action' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Create shipment', exact: true })).not.toBeInTheDocument();
        expect(getOrderMock).toHaveBeenCalledWith(orderWithoutShipment.id, expect.objectContaining({ vendorId: 'sporjinal' }));
        noMutations();
      });

    it.each(['admin', 'vendor'] as const)('keeps native-only cancellation history role visibility for %s', async (role) => {
      actor(role);
      getOrderMock.mockResolvedValue(order({ isCancelled: false, cancelledAt: undefined,
        timeline: [{ label: 'Shopify order cancelled', at: cancelledAt }] }));
      renderOrderDetail();
      await screen.findByLabelText('Current order state');
      const activity = screen.getByRole('heading', { name: 'Activity' }).closest('article')!;
      expect(within(activity).queryByText('Shopify order cancelled')).not.toBeInTheDocument();
      const rows = within(activity).getAllByText(/^Order created$/i).map((title) => title.closest('li')!);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toHaveTextContent(formatTimelineDateForTest(orderAt));
      const native = within(activity).queryByText('Cancellation history entry');
      expect(Boolean(native)).toBe(role === 'admin');
      if (native) {
        expect(native.closest('li')).toHaveTextContent('record time unverified');
        expect(native.closest('li')?.querySelector('small')).toHaveTextContent(/^—$/);
      }
      noMutations();
    });

    it.each((['admin', 'vendor'] as const).flatMap((role) =>
      ['Order created', 'Order received'].map((label) => ({ role, label }))))(
      'preserves ordinary $label history for $role', async ({ role, label }) => {
        actor(role);
        getOrderMock.mockResolvedValue(order({ timeline: [{ label, at: orderAt }] }));
        renderOrderDetail();
        await screen.findByLabelText('Current order state');
        expect(getOrderActivityRow('Order created').querySelector('small')).toHaveTextContent(formatTimelineDateForTest(orderAt));
        expect(getOrderActivityRow('Shopify order cancelled').querySelector('small')).toHaveTextContent(formatTimelineDateForTest(cancelledAt));
        noMutations();
      });

    it('does not exclude similar unknown native action labels by substring', async () => {
      actor('admin');
      getOrderMock.mockResolvedValue(order({ timeline: [{ label: 'Shopify order cancelled note', at: cancelledAt }] }));
      renderOrderDetail();
      await screen.findByLabelText('Current order state');
      const activity = screen.getByRole('heading', { name: 'Activity' }).closest('article')!;
      expect(within(activity).getAllByText(/^Order created$/i)).toHaveLength(2);
      expect(getOrderActivityRow('Shopify order cancelled').querySelector('small')).toHaveTextContent(formatTimelineDateForTest(cancelledAt));
      noMutations();
    });
  });

  describe('P04-U4-C1 native assignment Activity identity', () => {
    const firstAt = '2026-06-02T09:00:00.000Z';
    const laterAt = '2026-06-02T11:00:00.000Z';
    type Entry = { label: string; at: string; assignmentHistoryId?: unknown };
    function actor(role: 'admin' | 'vendor') {
      setCurrentUser({ email: `${role}@demo.com`, name: role, role, vendorAccess: ['sporjinal'],
        vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
        canSwitchVendors: role === 'admin', defaultVendorId: 'sporjinal' });
    }
    function order(entries: Entry[], overrides: Partial<OrderDetail> = {}): OrderDetail {
      return { ...orderWithoutShipment, assignmentHistory: [],
        timeline: entries as OrderDetail['timeline'], shipmentCreatedAt: undefined, shipmentUpdatedAt: undefined,
        trackingNumber: undefined, trackingUrl: undefined, carrier: undefined, fulfilledAt: undefined,
        ...overrides };
    }
    function noMutations() {
      for (const fn of [createShipmentExecutionMock, retryFailedShipmentExecutionMock, retryShipmentExecutionMock,
        submitFulfillmentTrackingMock, refreshShipmentExecutionStatusMock, refreshShipmentProviderDataMock,
        cancelShipmentExecutionMock, rejectOrderMock, planAllocationSplitMock, splitAllocationMock]) expect(fn).not.toHaveBeenCalled();
    }
    const scenarios = [
      { name: 'distinct IDs identical time', ids: ['history-A', 'history-B'], times: [firstAt, firstAt], count: 2 },
      { name: 'distinct IDs same UTC day', ids: ['history-A', 'history-B'], times: [firstAt, laterAt], count: 2 },
      { name: 'distinct IDs different days', ids: ['history-A', 'history-B'], times: [firstAt, '2026-06-03T09:00:00.000Z'], count: 2 },
      { name: 'repeated same persisted ID', ids: ['history-A', 'history-A'], times: [firstAt, firstAt], count: 1 },
      { name: 'missing identities', ids: [undefined, undefined], times: [firstAt, laterAt], count: 1 },
      { name: 'blank identities', ids: ['', '   '], times: [firstAt, laterAt], count: 1 },
      { name: 'invalid identities', ids: [42, null], times: [firstAt, laterAt], count: 1 },
      { name: 'distinct IDs invalid times', ids: ['history-A', 'history-B'], times: ['invalid-time', ''], count: 2 },
      { name: 'missing IDs invalid times', ids: [undefined, undefined], times: ['invalid-time', ''], count: 1 },
      { name: 'reversed distinct records', ids: ['history-B', 'history-A'], times: [laterAt, firstAt], count: 2 },
    ];
    it.each((['admin', 'vendor'] as const).flatMap((role) => ['tracking added', 'shipment created'].flatMap((label) =>
      scenarios.map((scenario) => ({ role, label, ...scenario }))))) (
      'preserves $role $label with $name', async ({ role, label, ids, times, count }) => {
        actor(role);
        getOrderMock.mockResolvedValue(order(ids.map((assignmentHistoryId, index) => ({ label, at: times[index], assignmentHistoryId }))));
        renderOrderDetail();
        await screen.findByLabelText('Current order state');
        const activity = screen.getByRole('heading', { name: 'Activity' }).closest('article')!;
        const title = label === 'tracking added' ? 'Tracking synced' : 'Shipment created';
        const rows = within(activity).getAllByText(new RegExp(`^${title}$`, 'i')).map((node) => node.closest('li')!);
        expect(rows).toHaveLength(count);
        const expectedTimes = count === 2 ? times : [times[0]];
        const displayed = rows.map((row) => row.querySelector('small')!.textContent);
        for (const time of expectedTimes) {
          const valid = time && !time.startsWith('invalid');
          expect(displayed).toContain(valid ? formatTimelineDateForTest(time) : '—');
        }
        if (count === 2 && times[0] === laterAt && times[1] === firstAt) {
          expect(displayed).toEqual([formatTimelineDateForTest(firstAt), formatTimelineDateForTest(laterAt)]);
        }
        expect(activity).not.toHaveTextContent('history-A');
        expect(activity).not.toHaveTextContent('history-B');
        expect(getOrderMock).toHaveBeenCalledWith(orderWithoutShipment.id, expect.objectContaining({ vendorId: 'sporjinal' }));
        noMutations();
      });

    it.each((['admin', 'vendor'] as const).flatMap((role) => ['tracking added', 'shipment created'].map((label) => ({ role, label }))))(
      'keeps derived $label equivalence for $role with two native identities', async ({ role, label }) => {
        actor(role);
        getOrderMock.mockResolvedValue(order([
          { label, at: firstAt, assignmentHistoryId: 'history-A' },
          { label, at: laterAt, assignmentHistoryId: 'history-B' },
        ], label === 'tracking added' ? { trackingNumber: 'CURRENT-TRACK', shipmentUpdatedAt: laterAt }
          : { shipmentCreatedAt: laterAt }));
        renderOrderDetail();
        await screen.findByLabelText('Current order state');
        const activity = screen.getByRole('heading', { name: 'Activity' }).closest('article')!;
        const title = label === 'tracking added' ? 'Tracking synced' : 'Shipment created';
        expect(within(activity).getAllByText(new RegExp(`^${title}$`, 'i'))).toHaveLength(2);
        noMutations();
      });

    it.each(['admin', 'vendor'] as const)('keeps hidden-first and raw provider restrictions for %s', async (role) => {
      actor(role);
      getOrderMock.mockResolvedValue(order([
        { label: 'shipment updated', at: firstAt, assignmentHistoryId: 'history-hidden' },
        { label: 'provider tracking added', at: firstAt, assignmentHistoryId: 'history-raw' },
        { label: 'tracking added', at: firstAt, assignmentHistoryId: 'history-A' },
        { label: 'tracking synced', at: laterAt, assignmentHistoryId: 'history-B' },
      ]));
      renderOrderDetail();
      await screen.findByLabelText('Current order state');
      const activity = screen.getByRole('heading', { name: 'Activity' }).closest('article')!;
      expect(within(activity).getAllByText(/^Tracking synced$/i)).toHaveLength(2);
      expect(within(activity).queryByText(/^Shipment updated$/i) !== null).toBe(role === 'admin');
      expect(activity).not.toHaveTextContent('Provider tracking added');
      noMutations();
    });

    it.each(['admin', 'vendor'] as const)('does not change creation grouping or canonical refund handling for %s', async (role) => {
      actor(role);
      getOrderMock.mockResolvedValue(order([
        { label: 'Order created', at: firstAt, assignmentHistoryId: 'history-create-A' },
        { label: 'Order received', at: laterAt, assignmentHistoryId: 'history-create-B' },
        { label: 'Refund completed', at: firstAt, assignmentHistoryId: 'history-refund' },
      ], { operationalActionability: { actionable: false, reason: 'ALLOCATION_REFUND_TERMINAL' }, fulfillmentActionAvailable: false }));
      renderOrderDetail();
      await screen.findByLabelText('Current order state');
      const activity = screen.getByRole('heading', { name: 'Activity' }).closest('article')!;
      const creationRows = within(activity).getAllByText(/^Order created$/i).map((title) => title.closest('li')!);
      expect(creationRows).toHaveLength(2); // Native June history and the existing May order snapshot.
      expect(creationRows.some((row) => row.textContent?.includes(formatTimelineDateForTest(firstAt)))).toBe(true);
      expect(creationRows.some((row) => row.textContent?.includes(formatTimelineDateForTest(laterAt)))).toBe(false);
      const refund = within(activity).getByText(/^Refund completed$/i).closest('li')!;
      expect(refund.querySelector('small')).toHaveTextContent(role === 'admin' ? formatTimelineDateForTest(firstAt) : /^—$/);
      expect(screen.queryByRole('button', { name: 'Create shipment', exact: true })).not.toBeInTheDocument();
      noMutations();
    });
  });

  describe('P04-U4-F3 Admin return history identity', () => {
    const firstAt = '2026-06-02T09:00:00.000Z';
    const laterAt = '2026-06-02T11:00:00.000Z';
    const title = /^Admin returned to vendor$/i;
    function actor(role: 'admin' | 'vendor') {
      setCurrentUser({ email: `${role}@demo.com`, name: role, role, vendorAccess: ['sporjinal'],
        vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
        canSwitchVendors: role === 'admin', defaultVendorId: 'sporjinal' });
    }
    function order(entries: Array<{ at: string; assignmentHistoryId?: unknown }>): OrderDetail {
      return { ...orderWithoutShipment, assignmentHistory: [],
        timeline: entries.map((entry) => ({ label: 'admin returned to vendor', ...entry })) as OrderDetail['timeline'],
        shipmentCreatedAt: undefined, shipmentUpdatedAt: undefined, trackingNumber: undefined,
        trackingUrl: undefined, carrier: undefined, fulfilledAt: undefined };
    }
    function rows() {
      const activity = screen.getByRole('heading', { name: 'Activity' }).closest('article')!;
      return { activity, rows: within(activity).queryAllByText(title).map((node) => node.closest('li')!) };
    }
    const cases = [
      { name: 'distinct IDs identical time', ids: ['history-A', 'history-B'], times: [firstAt, firstAt], count: 2 },
      { name: 'distinct IDs same UTC day', ids: ['history-A', 'history-B'], times: [firstAt, laterAt], count: 2 },
      { name: 'distinct IDs different UTC days', ids: ['history-A', 'history-B'], times: [firstAt, '2026-06-03T09:00:00.000Z'], count: 2 },
      { name: 'same ID repeated', ids: ['history-A', 'history-A'], times: [firstAt, firstAt], count: 1 },
      { name: 'missing IDs', ids: [undefined, undefined], times: [firstAt, laterAt], count: 1 },
      { name: 'empty IDs', ids: ['', ''], times: [firstAt, laterAt], count: 1 },
      { name: 'whitespace IDs', ids: ['   ', '   '], times: [firstAt, laterAt], count: 1 },
      { name: 'invalid nonstring IDs', ids: [42, null], times: [firstAt, laterAt], count: 1 },
      { name: 'distinct IDs invalid times', ids: ['history-A', 'history-B'], times: ['invalid-time', ''], count: 2 },
      { name: 'missing IDs invalid times', ids: [undefined, undefined], times: ['invalid-time', ''], count: 1 },
      { name: 'reversed source order', ids: ['history-B', 'history-A'], times: [laterAt, firstAt], count: 2 },
    ];
    it.each(cases)('$name retains expected Admin rows', async ({ ids, times, count }) => {
      actor('admin');
      getOrderMock.mockResolvedValue(order(ids.map((assignmentHistoryId, index) => ({ assignmentHistoryId, at: times[index] }))));
      renderOrderDetail();
      await screen.findByLabelText('Current order state');
      const result = rows();
      expect(result.rows).toHaveLength(count);
      const displayed = result.rows.map((row) => row.querySelector('small')!.textContent);
      const expected = count === 2 ? times : [times[0]];
      for (const at of expected) expect(displayed).toContain(at && at !== 'invalid-time' ? formatTimelineDateForTest(at) : '—');
      if (count === 2 && times[0] === laterAt) expect(displayed).toEqual([formatTimelineDateForTest(firstAt), formatTimelineDateForTest(laterAt)]);
      expect(result.activity).not.toHaveTextContent('history-A');
      expect(result.activity).not.toHaveTextContent('history-B');
      expect(getOrderMock).toHaveBeenCalledWith(orderWithoutShipment.id, expect.objectContaining({ vendorId: 'sporjinal' }));
      expect(createShipmentExecutionMock).not.toHaveBeenCalled();
      expect(retryFailedShipmentExecutionMock).not.toHaveBeenCalled();
      expect(submitFulfillmentTrackingMock).not.toHaveBeenCalled();
    });
    it('keeps Admin return history hidden from Vendor', async () => {
      actor('vendor');
      getOrderMock.mockResolvedValue(order([
        { assignmentHistoryId: 'history-A', at: firstAt },
        { assignmentHistoryId: 'history-B', at: laterAt },
      ]));
      renderOrderDetail();
      await screen.findByLabelText('Current order state');
      expect(rows().rows).toHaveLength(0);
    });
  });

  describe('P04-U4-F2 vendor block state and history', () => {
    const firstAt = '2026-06-02T09:00:00.000Z';
    const laterAt = '2026-06-02T11:00:00.000Z';
    function actor(role: 'admin' | 'vendor') {
      setCurrentUser({ email: `${role}@demo.com`, name: role, role, vendorAccess: ['sporjinal'],
        vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
        canSwitchVendors: role === 'admin', defaultVendorId: 'sporjinal' });
    }
    function blocked(ids: string[], times: string[]): OrderDetail {
      const entries = ids.map((id, index) => ({ id, action: 'vendor_blocked' as const,
        fromVendorId: 'sporjinal', toVendorId: 'sporjinal', reason: 'OUT_OF_STOCK',
        actorName: 'Vendor user', actorRole: 'vendor' as const, createdAt: times[index] }));
      return { ...orderWithoutShipment, allocationStatus: 'vendor_blocked', cancellationReason: 'OUT_OF_STOCK',
        reassignmentRequired: true, assignmentHistory: entries,
        timeline: entries.map((entry) => ({ label: 'vendor blocked', at: entry.createdAt, assignmentHistoryId: entry.id })),
        shipmentCreatedAt: undefined, shipmentUpdatedAt: undefined, trackingNumber: undefined,
        trackingUrl: undefined, carrier: undefined, fulfilledAt: undefined };
    }
    function activity() { return screen.getByRole('heading', { name: 'Activity' }).closest('article')!; }
    it('keeps the current state and one persisted history record separate for Admin', async () => {
      actor('admin');
      getOrderMock.mockResolvedValue(blocked(['block-A'], [firstAt]));
      renderOrderDetail();
      await screen.findByLabelText('Current order state');
      expect(within(activity()).getByText('Current state: Vendor blocked')).toBeInTheDocument();
      expect(within(activity()).getByText('Vendor block history entry')).toBeInTheDocument();
    });
    it('keeps Vendor current state when the native history is Admin-only', async () => {
      actor('vendor');
      getOrderMock.mockResolvedValue(blocked(['block-A'], [firstAt]));
      renderOrderDetail();
      await screen.findByLabelText('Current order state');
      expect(within(activity()).getByText('Order blocked from shipment')).toBeInTheDocument();
      expect(within(activity()).queryByText('Vendor block history entry')).not.toBeInTheDocument();
    });
    it('does not present the same persisted history ID twice', async () => {
      actor('admin');
      const order = blocked(['block-A'], [firstAt]);
      getOrderMock.mockResolvedValue({ ...order, timeline: [...order.timeline, ...order.timeline] });
      renderOrderDetail();
      await screen.findByLabelText('Current order state');
      const historyRows = within(activity()).getAllByText(/^(Vendor Blocked|Vendor block history entry)$/i)
        .map((node) => node.closest('li')!)
        .filter((row) => within(row).queryByText('Blocked', { exact: true }) === null);
      expect(historyRows).toHaveLength(1);
    });
    it.each([
      { name: 'same UTC day', ids: ['block-A', 'block-B'], times: [firstAt, laterAt] },
      { name: 'different UTC days', ids: ['block-A', 'block-B'], times: [firstAt, '2026-06-03T09:00:00.000Z'] },
      { name: 'reversed source order', ids: ['block-B', 'block-A'], times: [laterAt, firstAt] },
    ])('preserves distinct persisted block records with $name', async ({ ids, times }) => {
      actor('admin');
      getOrderMock.mockResolvedValue(blocked(ids, times));
      renderOrderDetail();
      await screen.findByLabelText('Current order state');
      const records = within(activity()).getAllByText('Vendor block history entry').map((node) => node.closest('li')!);
      expect(records).toHaveLength(2);
      expect(records.map((row) => row.querySelector('small')?.textContent)).toEqual(
        [...times].sort().map(formatTimelineDateForTest),
      );
      for (const row of records) expect(row).toHaveTextContent('History record time.');
      expect(within(activity()).getByText('Current state: Vendor blocked')).toBeInTheDocument();
      expect(activity()).not.toHaveTextContent('block-A');
      expect(activity()).not.toHaveTextContent('block-B');
    });
    it('keeps current blocked explanation with no matching history and no invented date', async () => {
      actor('admin');
      getOrderMock.mockResolvedValue(blocked([], []));
      renderOrderDetail();
      await screen.findByLabelText('Current order state');
      const row = getOrderActivityRow('Current state: Vendor blocked');
      expect(row.querySelector('small')).toHaveTextContent(/^—$/);
      expect(row).toHaveTextContent('Block history record time unavailable.');
      expect(within(activity()).queryByText('Vendor block history entry')).not.toBeInTheDocument();
    });
    it('keeps previous block as Admin history after the allocation becomes active', async () => {
      actor('admin');
      getOrderMock.mockResolvedValue({ ...blocked(['block-A'], [firstAt]), allocationStatus: 'active',
        cancellationReason: undefined, reassignmentRequired: false });
      renderOrderDetail();
      await screen.findByLabelText('Current order state');
      expect(screen.getByLabelText('Current order state')).toHaveTextContent('Active');
      expect(within(activity()).queryByText('Current state: Vendor blocked')).not.toBeInTheDocument();
      expect(within(activity()).getByText('Vendor block history entry')).toBeInTheDocument();
    });
    it('retains both block records around an Admin return-to-Vendor cycle', async () => {
      actor('admin');
      const order = blocked(['block-A', 'block-B'], [firstAt, laterAt]);
      getOrderMock.mockResolvedValue({ ...order,
        assignmentHistory: [...order.assignmentHistory, {
          id: 'return-A', action: 'admin_returned_to_vendor', fromVendorId: 'sporjinal',
          toVendorId: 'sporjinal', actorName: 'Admin', actorRole: 'admin', createdAt: '2026-06-02T10:00:00.000Z',
        }],
        timeline: [order.timeline[0], {
          label: 'admin returned to vendor', at: '2026-06-02T10:00:00.000Z', assignmentHistoryId: 'return-A',
        }, order.timeline[1]],
      });
      renderOrderDetail();
      await screen.findByLabelText('Current order state');
      expect(within(activity()).getAllByText('Vendor block history entry')).toHaveLength(2);
      expect(within(activity()).getByText(/^Admin returned to vendor$/i)).toBeInTheDocument();
      expect(within(activity()).getByText('Current state: Vendor blocked')).toBeInTheDocument();
      expect(getOrderActivityRow('Current state: Vendor blocked').querySelector('small'))
        .toHaveTextContent(formatTimelineDateForTest(laterAt));
    });
    it('does not claim a verified history record when its timestamp is missing', async () => {
      actor('admin');
      const order = blocked(['block-A'], [firstAt]);
      getOrderMock.mockResolvedValue({ ...order,
        timeline: [{ label: 'vendor blocked', at: undefined as unknown as string, assignmentHistoryId: 'block-A' }],
      });
      renderOrderDetail();
      await screen.findByLabelText('Current order state');
      expect(within(activity()).getByText('Current state: Vendor blocked')).toBeInTheDocument();
      expect(within(activity()).queryByText('Vendor block history entry')).not.toBeInTheDocument();
      expect(within(activity()).getByText(/^Vendor Blocked$/i).closest('li')?.querySelector('small'))
        .toHaveTextContent(/^—$/);
    });
    it('preserves legacy behavior for missing IDs and unverified timestamps', async () => {
      actor('admin');
      const order = blocked(['block-A'], [firstAt]);
      getOrderMock.mockResolvedValue({ ...order, timeline: [
        { label: 'vendor blocked', at: firstAt },
        { label: 'vendor blocked', at: 'invalid-time', assignmentHistoryId: 'block-A' },
      ] });
      renderOrderDetail();
      await screen.findByLabelText('Current order state');
      expect(within(activity()).getByText('Current state: Vendor blocked')).toBeInTheDocument();
      expect(within(activity()).getAllByText(/^Vendor Blocked$/i)).toHaveLength(2);
      expect(within(activity()).queryByText('Vendor block history entry')).not.toBeInTheDocument();
    });
    it('keeps Vendor rejection reason and hides native history without enabling mutations', async () => {
      actor('vendor');
      getOrderMock.mockResolvedValue(blocked(['block-A'], [firstAt]));
      renderOrderDetail();
      await screen.findByLabelText('Current order state');
      expect(getOrderActivityRow('Order blocked from shipment')).toHaveTextContent('Current operational state.');
      expect(screen.getByLabelText('Operational alerts')).toHaveTextContent('Out of stock');
      expect(within(activity()).queryByText('Vendor block history entry')).not.toBeInTheDocument();
      for (const fn of [createShipmentExecutionMock, retryFailedShipmentExecutionMock, submitFulfillmentTrackingMock,
        rejectOrderMock, planAllocationSplitMock, splitAllocationMock]) expect(fn).not.toHaveBeenCalled();
    });
  });

  describe('P04-U4-F1 native cancellation history provenance', () => {
    it('shows exact native-only cancellation as history, not order creation', async () => {
      setCurrentUser({ email: 'admin@demo.com', name: 'Admin', role: 'admin', vendorAccess: ['sporjinal'],
        vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }], canSwitchVendors: true, defaultVendorId: 'sporjinal' });
      const at = '2026-06-02T09:00:00.000Z';
      getOrderMock.mockResolvedValue({ ...orderWithoutShipment, isCancelled: false, cancelledAt: undefined,
        assignmentHistory: [{ id: 'native-cancel-1', action: 'Shopify order cancelled', fromVendorId: 'sporjinal',
          toVendorId: 'sporjinal', actorName: 'Admin', actorRole: 'admin', createdAt: at }],
        timeline: [{ label: 'Shopify order cancelled', at, assignmentHistoryId: 'native-cancel-1' }] });
      renderOrderDetail();
      await screen.findByLabelText('Current order state');
      const activity = screen.getByRole('heading', { name: 'Activity' }).closest('article')!;
      const history = within(activity).getByText('Cancellation history entry').closest('li')!;
      expect(history).toHaveTextContent('History record time');
      expect(history).toHaveTextContent('Shopify cancellation time not verified.');
      expect(history.querySelector('small')).toHaveTextContent(formatTimelineDateForTest(at));
      expect(within(activity).getAllByText(/^Order created$/i)).toHaveLength(1);
    });
    const at = '2026-06-02T09:00:00.000Z';
    const history = { id: 'native-cancel-1', action: 'Shopify order cancelled' as const,
      fromVendorId: 'sporjinal', toVendorId: 'sporjinal', actorName: 'Admin', actorRole: 'admin' as const,
      createdAt: at };
    const provenanceCases = [
      { name: 'missing ID', entryId: undefined, entryAt: at, record: history, verified: false },
      { name: 'wrong ID', entryId: 'other-id', entryAt: at, record: history, verified: false },
      { name: 'blank ID', entryId: '   ', entryAt: at, record: history, verified: false },
      { name: 'missing record', entryId: history.id, entryAt: at, record: null, verified: false },
      { name: 'mismatched record action', entryId: history.id, entryAt: at,
        record: { ...history, action: 'admin_note' as const }, verified: false },
      { name: 'mismatched record time', entryId: history.id, entryAt: '2026-06-02T10:00:00.000Z', record: history, verified: false },
      { name: 'missing time', entryId: history.id, entryAt: undefined, record: history, verified: false },
      { name: 'invalid time', entryId: history.id, entryAt: 'invalid-time', record: history, verified: false },
    ];
    it.each(provenanceCases)('keeps $name without inventing cancellation time', async ({ entryId, entryAt, record, verified }) => {
      setCurrentUser({ email: 'admin@demo.com', name: 'Admin', role: 'admin', vendorAccess: ['sporjinal'],
        vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }], canSwitchVendors: true, defaultVendorId: 'sporjinal' });
      getOrderMock.mockResolvedValue({ ...orderWithoutShipment, isCancelled: false, cancelledAt: undefined,
        assignmentHistory: record ? [record] : [],
        timeline: [{ label: 'Shopify order cancelled', at: entryAt, assignmentHistoryId: entryId }] });
      renderOrderDetail();
      await screen.findByLabelText('Current order state');
      const row = getOrderActivityRow('Cancellation history entry');
      expect(row.querySelector('small')).toHaveTextContent(verified ? formatTimelineDateForTest(at) : /^—$/);
      expect(row).toHaveTextContent(verified ? 'History record time' : 'record time unverified');
      expect(row).toHaveTextContent('Shopify cancellation time not verified.');
      expect(within(screen.getByRole('heading', { name: 'Activity' }).closest('article')!).getAllByText(/^Order created$/i)).toHaveLength(1);
    });
    it('retains distinct native records and suppresses the repeated same history ID', async () => {
      setCurrentUser({ email: 'admin@demo.com', name: 'Admin', role: 'admin', vendorAccess: ['sporjinal'],
        vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }], canSwitchVendors: true, defaultVendorId: 'sporjinal' });
      const secondAt = '2026-06-02T11:00:00.000Z';
      getOrderMock.mockResolvedValue({ ...orderWithoutShipment, isCancelled: false, cancelledAt: undefined,
        assignmentHistory: [history, { ...history, id: 'native-cancel-2', createdAt: secondAt }],
        timeline: [
          { label: 'Shopify order cancelled', at, assignmentHistoryId: history.id },
          { label: 'Shopify order cancelled', at: secondAt, assignmentHistoryId: 'native-cancel-2' },
          { label: 'Shopify order cancelled', at, assignmentHistoryId: history.id },
        ] });
      renderOrderDetail();
      await screen.findByLabelText('Current order state');
      const activity = screen.getByRole('heading', { name: 'Activity' }).closest('article')!;
      const rows = within(activity).getAllByText('Cancellation history entry').map((node) => node.closest('li')!);
      expect(rows).toHaveLength(2);
      expect(rows.map((row) => row.querySelector('small')?.textContent)).toEqual([
        formatTimelineDateForTest(at), formatTimelineDateForTest(secondAt),
      ]);
      expect(activity).not.toHaveTextContent(history.id);
      expect(createShipmentExecutionMock).not.toHaveBeenCalled();
    });
    it('leaves a similar nonmatching native action on its existing mapping', async () => {
      setCurrentUser({ email: 'admin@demo.com', name: 'Admin', role: 'admin', vendorAccess: ['sporjinal'],
        vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }], canSwitchVendors: true, defaultVendorId: 'sporjinal' });
      getOrderMock.mockResolvedValue({ ...orderWithoutShipment, isCancelled: false, cancelledAt: undefined,
        assignmentHistory: [], timeline: [{ label: 'Shopify order cancelled note', at }] });
      renderOrderDetail();
      await screen.findByLabelText('Current order state');
      const activity = screen.getByRole('heading', { name: 'Activity' }).closest('article')!;
      expect(within(activity).queryByText('Cancellation history entry')).not.toBeInTheDocument();
      expect(within(activity).getAllByText(/^Order created$/i)).toHaveLength(2);
      expect(createShipmentExecutionMock).not.toHaveBeenCalled();
    });
  });

  describe('P04-U4-E1 audience-first Activity grouping', () => {
    const orderAt = '2026-06-02T00:00:00.000Z';
    const visibleAt = '2026-06-02T09:00:00.000Z';
    const hiddenAt = '2026-06-02T11:00:00.000Z';
    function actor(role: 'admin' | 'vendor') {
      setCurrentUser({ email: `${role}@demo.com`, name: role, role, vendorAccess: ['sporjinal'],
        vendorDetails: [{ vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
        canSwitchVendors: role === 'admin', defaultVendorId: 'sporjinal' });
    }
    function order(timeline: OrderDetail['timeline'], overrides: Partial<OrderDetail> = {}): OrderDetail {
      return { ...orderWithoutShipment, date: orderAt, timeline, trackingNumber: undefined, trackingUrl: undefined,
        carrier: undefined, shipmentCreatedAt: undefined, shipmentUpdatedAt: undefined, fulfilledAt: undefined,
        assignmentHistory: [], isCancelled: false, isCancellationConflict: false, cancelledAt: null, ...overrides };
    }
    function activity() { return screen.getByRole('heading', { name: 'Activity' }).closest('article')!; }
    function creationRows() { return within(activity()).getAllByText(/^Order created$/i).map((title) => title.closest('li')!); }
    function noMutations() {
      for (const fn of [createShipmentExecutionMock, retryFailedShipmentExecutionMock, retryShipmentExecutionMock,
        submitFulfillmentTrackingMock, refreshShipmentExecutionStatusMock, refreshShipmentProviderDataMock,
        cancelShipmentExecutionMock, createReturnShipmentLabelMock, probeShopifyReturnLabelUploadMock,
        rejectOrderMock, planAllocationSplitMock, splitAllocationMock]) expect(fn).not.toHaveBeenCalled();
      expect(getOrderMock).toHaveBeenCalledWith(orderWithoutShipment.id, expect.objectContaining({ vendorId: 'sporjinal' }));
    }
    const times = [
      { name: 'same UTC day', hidden: hiddenAt, visible: visibleAt },
      { name: 'invalid and missing timestamps', hidden: 'invalid-history-date', visible: '' },
      { name: 'different UTC days', hidden: '2026-06-03T11:00:00.000Z', visible: visibleAt },
    ];
    it.each((['admin', 'vendor'] as const).flatMap((role) => [true, false].flatMap((hiddenFirst) =>
      times.map((time) => ({ role, hiddenFirst, ...time }))))) (
      'keeps $role eligible evidence hiddenFirst=$hiddenFirst with $name', async ({ role, hiddenFirst, name, hidden, visible }) => {
        actor(role);
        // Valid native-history contract; production existence of this historical action is unknown.
        const hiddenEntry = { label: 'Order audit note', at: hidden };
        const visibleEntry = { label: 'Order received', at: visible };
        getOrderMock.mockResolvedValue(order(hiddenFirst ? [hiddenEntry, visibleEntry] : [visibleEntry, hiddenEntry]));
        renderOrderDetail();
        await screen.findByLabelText('Current order state');
        const rows = creationRows();
        const dates = rows.map((row) => row.querySelector('small')!.textContent);
        if (name === 'invalid and missing timestamps') {
          expect(rows).toHaveLength(2);
          expect(dates).toContain('—');
          expect(dates).toContain(formatTimelineDateForTest(orderAt));
        } else if (name === 'different UTC days') {
          expect(rows).toHaveLength(role === 'admin' ? 2 : 1);
          expect(dates).toContain(formatTimelineDateForTest(visible));
          expect(dates.includes(formatTimelineDateForTest(hidden))).toBe(role === 'admin');
        } else {
          expect(rows).toHaveLength(1);
          // Admin keeps source-order precedence, even when the hidden row is chronologically later.
          expect(dates).toEqual([formatTimelineDateForTest(role === 'admin' && hiddenFirst ? hidden : visible)]);
        }
        noMutations();
      });

    it.each((['admin', 'vendor'] as const).flatMap((role) => [true, false].map((hidden) => ({ role, hidden }))))(
      'keeps existing eligible duplicate grouping for $role, hidden=$hidden', async ({ role, hidden }) => {
        actor(role);
        const label = hidden ? 'Order audit note' : 'Order received';
        getOrderMock.mockResolvedValue(order([{ label, at: hiddenAt }, { label, at: visibleAt }]));
        renderOrderDetail();
        await screen.findByLabelText('Current order state');
        const rows = creationRows();
        expect(rows).toHaveLength(1);
        expect(rows[0].querySelector('small')).toHaveTextContent(formatTimelineDateForTest(hidden && role === 'vendor' ? orderAt : hiddenAt));
        noMutations();
      });

    it.each(['admin', 'vendor'] as const)('preserves native identities, Return links and legacy grouping for %s', async (role) => {
      actor(role);
      getOrderMock.mockResolvedValue(order([
        { label: 'Order audit note', at: hiddenAt },
        { label: 'shipment updated', at: hiddenAt },
        { label: 'tracking added', at: visibleAt, assignmentHistoryId: 'e1-tracking-A' },
        { label: 'tracking synced', at: hiddenAt, assignmentHistoryId: 'e1-tracking-B' },
        { label: 'tracking synced', at: hiddenAt, assignmentHistoryId: 'e1-tracking-B' },
        { label: 'shipment created', at: visibleAt, assignmentHistoryId: 'e1-shipment-A' },
        { label: 'shipment created', at: hiddenAt, assignmentHistoryId: 'e1-shipment-B' },
        { label: 'shipment created', at: hiddenAt, assignmentHistoryId: 'e1-shipment-B' },
      ]));
      listReturnsMock.mockResolvedValue(['e1-return-A', 'e1-return-B'].map((id) => ({ id, date: visibleAt,
        status: 'Requested', sourceType: 'shopify_return_request', displayTitle: id,
        relatedOrderId: orderWithoutShipment.id, sourceShopifyOrderId: orderWithoutShipment.sourceShopifyOrderId,
        sourceShopifyOrderNumber: orderWithoutShipment.sourceShopifyOrderNumber })));
      renderOrderDetail();
      await screen.findByLabelText('Current order state');
      await waitFor(() => expect(within(activity()).getAllByRole('link', { name: 'Return requested', exact: true })).toHaveLength(2));
      for (const id of ['e1-return-A', 'e1-return-B']) {
        expect(activity().querySelector(`a[href="/returns/${id}"]`)).not.toBeNull();
      }
      for (const title of ['Tracking synced', 'Shipment created']) {
        expect(within(activity()).getAllByText(new RegExp(`^${title}$`, 'i'))).toHaveLength(2);
      }
      expect(within(activity()).queryByText(/^Shipment updated$/i) !== null).toBe(role === 'admin');
      noMutations();
    });

    const states: Array<[string, Partial<OrderDetail>]> = [
      ['refund', { operationalActionability: { actionable: false, reason: 'ALLOCATION_REFUND_TERMINAL' }, fulfillmentActionAvailable: false }],
      ['cancelled', { isCancelled: true, cancelledAt: hiddenAt }],
      ['conflict', { isCancelled: true, isCancellationConflict: true, cancelledAt: hiddenAt }],
      ['blocked', { allocationStatus: 'vendor_blocked' }],
    ];
    it.each((['admin', 'vendor'] as const).flatMap((role) => states.map(([state, overrides]) => ({ role, state, overrides }))))(
      'preserves $role canonical $state evidence with conditional hidden-first history', async ({ role, state, overrides }) => {
        actor(role);
        getOrderMock.mockResolvedValue(order([
          { label: 'Order audit note', at: hiddenAt },
          { label: 'Order received', at: visibleAt },
          ...(state === 'refund' ? [{ label: 'Refund completed', at: hiddenAt }] : []),
          ...(state === 'cancelled' || state === 'conflict' ? [{ label: 'Shopify order cancelled', at: visibleAt }] : []),
        ], overrides));
        renderOrderDetail();
        await screen.findByLabelText('Current order state');
        expect(creationRows()).toHaveLength(1);
        expect(creationRows()[0].querySelector('small')).toHaveTextContent(formatTimelineDateForTest(role === 'admin' ? hiddenAt : visibleAt));
        if (state === 'refund') {
          const refund = within(activity()).getByText(/^Refund completed$/i).closest('li')!;
          expect(refund.querySelector('small')).toHaveTextContent(role === 'admin' ? formatTimelineDateForTest(hiddenAt) : /^—$/);
          expect(getOrderActivityRow('Fulfillment not required').querySelector('small')).toHaveTextContent(/^—$/);
        } else if (state === 'blocked') {
          expect(within(activity()).getByText(role === 'admin' ? 'Current state: Vendor blocked' : 'Order blocked from shipment')).toBeInTheDocument();
        } else {
          expect(getOrderActivityRow('Shopify order cancelled').querySelector('small')).toHaveTextContent(formatTimelineDateForTest(hiddenAt));
          if (state === 'conflict') expect(within(activity()).getByText('Existing operational evidence')).toBeInTheDocument();
        }
        expect(screen.queryByRole('button', { name: 'Create shipment', exact: true })).not.toBeInTheDocument();
        noMutations();
      });
  });

});
