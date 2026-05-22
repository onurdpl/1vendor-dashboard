import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReturnDetailPage } from './ReturnDetailPage';
import type { ReturnDetail } from '../features/returns/api';
import { clearToken, setCurrentUser, setToken } from '../lib/auth';
import { ApiError } from '../lib/api/errors';

const appReadinessOverride = vi.hoisted(() => ({
  value: null as null | {
    status: string;
    token: string | null;
    currentUser: unknown;
    currentVendor: { vendorId: string; vendorName: string; scope: string };
    sessionReady: boolean;
    vendorReady: boolean;
    ready: boolean;
    unauthorized: boolean;
  },
}));

vi.mock('../lib/appReadiness', async () => {
  const actual = await vi.importActual<typeof import('../lib/appReadiness')>('../lib/appReadiness');
  return {
    ...actual,
    useAppReadiness: () => appReadinessOverride.value ?? actual.getAppReadinessSnapshot(),
  };
});

const getReturnMock = vi.fn<(returnId: string) => Promise<ReturnDetail>>();
const markReturnReceivedMock = vi.fn<(returnId: string) => Promise<ReturnDetail>>();
const reviewReturnMock = vi.fn<
  (returnId: string, input: { decision: 'approved' | 'rejected'; reason?: string }) => Promise<ReturnDetail>
>();
const createNavlungoReturnPickupMock = vi.fn<
  (
    returnId: string,
    input: {
      dryRun?: boolean;
      apiVersionOverride?: 'current' | 'v2' | 'v2.1';
      carrierOverride?: 'current' | '9' | '10';
      endpointPathOverride?: '/post/create' | '/post/return';
      diagnosticConfirm?: 'YES';
      customerOverrides?: Record<string, string | undefined>;
    },
  ) => Promise<ReturnDetail>
>();
const saveNavlungoReturnPickupAddressCompletionMock = vi.fn<
  (returnId: string, input: { customerOverrides?: Record<string, string | undefined> }) => Promise<ReturnDetail>
>();
const syncNavlungoReturnStatusMock = vi.fn<(returnId: string) => Promise<ReturnDetail>>();
const createSupportTicketMock = vi.fn();
const listAdminSupportTicketsMock = vi.fn();
const listVendorSupportTicketsMock = vi.fn();
const getFinanceDashboardMock = vi.fn();

vi.mock('../features/returns/api', async () => {
  const actual = await vi.importActual<typeof import('../features/returns/api')>('../features/returns/api');
  return {
    ...actual,
    getReturn: (returnId: string) => getReturnMock(returnId),
    markReturnReceived: (returnId: string) => markReturnReceivedMock(returnId),
    reviewReturn: (returnId: string, input: { decision: 'approved' | 'rejected'; reason?: string }) =>
      reviewReturnMock(returnId, input),
    createNavlungoReturnPickup: (
      returnId: string,
      input: {
        dryRun?: boolean;
        apiVersionOverride?: 'current' | 'v2' | 'v2.1';
        carrierOverride?: 'current' | '9' | '10';
        endpointPathOverride?: '/post/create' | '/post/return';
        diagnosticConfirm?: 'YES';
        customerOverrides?: Record<string, string | undefined>;
      },
    ) =>
      createNavlungoReturnPickupMock(returnId, input),
    saveNavlungoReturnPickupAddressCompletion: (
      returnId: string,
      input: { customerOverrides?: Record<string, string | undefined> },
    ) => saveNavlungoReturnPickupAddressCompletionMock(returnId, input),
    syncNavlungoReturnStatus: (returnId: string) => syncNavlungoReturnStatusMock(returnId),
  };
});

vi.mock('../features/support/api', async () => {
  const actual = await vi.importActual<typeof import('../features/support/api')>('../features/support/api');
  return {
    ...actual,
    createSupportTicket: (input: unknown) => createSupportTicketMock(input),
    listAdminSupportTickets: () => listAdminSupportTicketsMock(),
    listVendorSupportTickets: () => listVendorSupportTicketsMock(),
  };
});

vi.mock('../features/finance/api', async () => {
  const actual = await vi.importActual<typeof import('../features/finance/api')>('../features/finance/api');
  return {
    ...actual,
    getFinanceDashboard: (options?: { vendorId?: string | null }) => getFinanceDashboardMock(options),
  };
});

const returnDetail: ReturnDetail = {
  id: 'RET-REQUEST-1023-LONG-SLUG',
  originalVendorId: 'demo-vendor-a',
  assignedVendorId: 'demo-vendor-a',
  vendorId: 'demo-vendor-a',
  sourceShopifyOrderId: 'gid://shopify/Order/1023',
  sourceShopifyOrderNumber: 1023,
  sourceShopifyRefundId: '',
  sourceShopifyReturnId: 'gid://shopify/Return/9001',
  sourceType: 'shopify_return_request',
  status: 'Requested',
  relatedOrderId: 'ORD-1023',
  date: '2026-05-13T04:44:00Z',
  updatedAt: '2026-05-13T05:00:00Z',
  customer: 'Customer unavailable',
  reason: 'Shopify return request lifecycle - Return 23165600081',
  returnProvider: null,
  returnProviderShipmentId: null,
  returnLabel: null,
  returnReferenceId: null,
  navlungoReturnCreatedAt: null,
  returnProviderSnapshot: null,
  returnCarrierName: null,
  returnTrackingNumber: null,
  returnTrackingUrl: null,
  vendorReceivedAt: null,
  vendorReviewedAt: null,
  vendorDecision: null,
  vendorDecisionReason: null,
  amount: '$0.00',
  refundedSkus: ['DJ1196-002-40,5'],
  resolution: 'Pending return request synced from Shopify return lifecycle.',
  refundMethod: 'Pending return request',
  processedBy: 'Shopify return lifecycle webhook ingestion via backend',
  refundedItems: [
    {
      id: 'line-1',
      originalVendorId: 'demo-vendor-a',
      assignedVendorId: 'demo-vendor-a',
      vendorId: 'demo-vendor-a',
      sku: 'DJ1196-002-40,5',
      variantTitle: 'White / 42',
      name: 'Nike Air Force 1 07',
      quantity: 1,
      condition: 'Opened',
      refundAmount: '$0.00',
    },
  ],
  items: [],
  timeline: [
    { label: 'Return requested', at: '2026-05-13T04:44:00Z' },
    { label: 'Latest backend update', at: '2026-05-13T05:00:00Z' },
  ],
};

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/returns/RET-REQUEST-1023-LONG-SLUG']}>
        <Routes>
          <Route path="/returns/:returnId" element={<ReturnDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function renderPageAt(path: string) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/returns/:returnId" element={<ReturnDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ReturnDetailPage vendor review screen', () => {
  beforeEach(() => {
    cleanup();
    window.localStorage.clear();
    appReadinessOverride.value = null;
    setToken('test-token');
    setCurrentUser({
      email: 'vendor@example.com',
      name: 'Vendor User',
      role: 'vendor',
      vendorAccess: ['demo-vendor-a'],
      vendorDetails: [{ vendorId: 'demo-vendor-a', vendorName: 'Demo Vendor A' }],
      canSwitchVendors: false,
      defaultVendorId: 'demo-vendor-a',
    });
    getReturnMock.mockReset();
    markReturnReceivedMock.mockReset();
    reviewReturnMock.mockReset();
    createNavlungoReturnPickupMock.mockReset();
    saveNavlungoReturnPickupAddressCompletionMock.mockReset();
    syncNavlungoReturnStatusMock.mockReset();
    createSupportTicketMock.mockReset();
    listAdminSupportTicketsMock.mockReset();
    listAdminSupportTicketsMock.mockResolvedValue([]);
    listVendorSupportTicketsMock.mockReset();
    listVendorSupportTicketsMock.mockResolvedValue([]);
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
  });

  it('renders a vendor-facing return review without internal lifecycle wording', async () => {
    getReturnMock.mockResolvedValue(returnDetail);

    renderPage();

    expect(await screen.findByRole('heading', { name: 'Return request' })).toBeInTheDocument();
    expect(screen.getAllByText('Order #1023').length).toBeGreaterThan(0);
    expect(screen.getByText('Nike Air Force 1 07')).toBeInTheDocument();
    expect(screen.getByText('DJ1196-002-40,5')).toBeInTheDocument();
    expect(screen.getByText('White / 42')).toBeInTheDocument();
    expect(screen.getByText('Vendor review')).toBeInTheDocument();
    expect(screen.getByText('Mark received')).toBeInTheDocument();
    expect(screen.getByText('Contact support')).toBeInTheDocument();
    expect(screen.getAllByText('Return requested').length).toBeGreaterThan(0);

    expect(screen.queryByText('RET-REQUEST-1023-LONG-SLUG')).not.toBeInTheDocument();
    expect(screen.queryByText(/backend/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/webhook/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/ingestion/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/lifecycle/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/sync source/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/workflow summary/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/finance context/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Shopify order ID/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Shopify return ID/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Latest backend update/i)).not.toBeInTheDocument();
  });

  it('shows waiting reason when vendor context is not ready', async () => {
    appReadinessOverride.value = {
      status: 'loading_vendor_context',
      token: 'test-token',
      currentUser: {
        email: 'admin@example.com',
        name: 'Admin User',
        role: 'admin',
        vendorAccess: ['demo-vendor-a'],
        vendorDetails: [{ vendorId: 'demo-vendor-a', vendorName: 'Demo Vendor A' }],
        canSwitchVendors: true,
        defaultVendorId: 'demo-vendor-a',
      },
      currentVendor: { vendorId: '', vendorName: '', scope: '' },
      sessionReady: true,
      vendorReady: false,
      ready: false,
      unauthorized: false,
    };

    renderPageAt('/returns/return-request-23391502673-yalispor-20393734144337');

    expect(await screen.findByRole('heading', { name: 'Waiting for vendor context' })).toBeInTheDocument();
    expect(screen.getByText('return-request-23391502673-yalispor-20393734144337')).toBeInTheDocument();
    expect(getReturnMock).not.toHaveBeenCalled();
  });

  it('shows a bounded retry fallback when loading takes too long', async () => {
    vi.useFakeTimers();
    getReturnMock.mockReturnValue(new Promise(() => undefined));

    renderPageAt('/returns/return-request-23391502673-yalispor-20393734144337');

    expect(screen.getByRole('heading', { name: 'Loading return request' })).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(8100);
    });

    expect(screen.getByRole('heading', { name: 'Return request is taking longer than expected' })).toBeInTheDocument();
    expect(screen.getByText('return-request-23391502673-yalispor-20393734144337')).toBeInTheDocument();
    expect(screen.getByText('Query enabled')).toBeInTheDocument();
    vi.useRealTimers();
  });

  it('shows not found when the return API returns 404', async () => {
    getReturnMock.mockRejectedValue(
      new ApiError('Return not found.', 'server', {
        status: 404,
        diagnostics: {
          endpoint: '/returns/return-request-23391502673-yalispor-20393734144337',
          status: 404,
          requestId: 'req-404',
          hasAuthHeader: true,
          hasVendorHeader: true,
          selectedVendorPresent: true,
          readinessState: 'ready',
        },
      }),
    );

    renderPageAt('/returns/return-request-23391502673-yalispor-20393734144337');

    expect(await screen.findByRole('heading', { name: 'Return request not found' })).toBeInTheDocument();
    expect(screen.getAllByText('Return not found.').length).toBeGreaterThan(0);
    expect(screen.getAllByText('/returns/return-request-23391502673-yalispor-20393734144337').length).toBeGreaterThan(0);
  });

  it('shows permission error when the return API returns 403', async () => {
    getReturnMock.mockRejectedValue(
      new ApiError('You do not have access to this workspace.', 'server', {
        status: 403,
        diagnostics: {
          endpoint: '/returns/return-request-23391502673-yalispor-20393734144337',
          status: 403,
          requestId: 'req-403',
          hasAuthHeader: true,
          hasVendorHeader: true,
          selectedVendorPresent: true,
          readinessState: 'ready',
        },
      }),
    );

    renderPageAt('/returns/return-request-23391502673-yalispor-20393734144337');

    expect(await screen.findByRole('heading', { name: 'Return access denied' })).toBeInTheDocument();
    expect(screen.getAllByText('You do not have access to this workspace.').length).toBeGreaterThan(0);
  });

  it('shows retry fallback when the return API times out', async () => {
    getReturnMock.mockRejectedValue(new Error('Request timed out after 15000ms.'));

    renderPageAt('/returns/return-request-23391502673-yalispor-20393734144337');

    expect(await screen.findByRole('heading', { name: 'Return unavailable' })).toBeInTheDocument();
    expect(screen.getAllByText('Request timed out after 15000ms.').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('does not crash when the return detail response is null or malformed', async () => {
    getReturnMock.mockResolvedValue({ id: returnDetail.id } as ReturnDetail);

    renderPage();

    expect(await screen.findByRole('heading', { name: 'Return response unavailable' })).toBeInTheDocument();
    expect(screen.getByText('The return detail response was empty or malformed. Retry the request.')).toBeInTheDocument();
  });

  it('does not show infinite loading for an unauthorized session', async () => {
    clearToken();

    renderPage();

    expect(await screen.findByRole('heading', { name: 'Session required' })).toBeInTheDocument();
    expect(screen.getByText('Sign in again to load this return request.')).toBeInTheDocument();
  });

  it('renders existing Navlungo return pickup evidence on Return Detail', async () => {
    getReturnMock.mockResolvedValue({
      ...returnDetail,
      returnProvider: 'navlungo',
      returnProviderShipmentId: 'NAV-RET-1',
      returnTrackingNumber: 'NAV-RET-1',
      returnTrackingUrl: 'https://tracking.example/NAV-RET-1',
      returnLabel: 'barcode-string',
      returnCarrierName: 'Sürat Kargo',
      returnReferenceId: 'SP-RET-1023-ABC123',
      navlungoReturnCreatedAt: '2026-05-22T09:00:00Z',
      returnProviderSnapshot: {
        shopifyReturnSyncSkippedReason: 'not_implemented',
      },
    });

    renderPage();

    expect(await screen.findByText('Provider ID')).toBeInTheDocument();
    expect(screen.getAllByText('NAV-RET-1').length).toBeGreaterThan(0);
    expect(screen.getByText('Sürat Kargo')).toBeInTheDocument();
    expect(screen.getByText('SP-RET-1023-ABC123')).toBeInTheDocument();
    expect(screen.getAllByText('Navlungo return pickup created').length).toBeGreaterThan(0);
  });

  it('renders Return Detail as a main column plus one ordered operational sidebar', async () => {
    setCurrentUser({
      email: 'admin@example.com',
      name: 'Admin User',
      role: 'admin',
      vendorAccess: ['demo-vendor-a'],
      vendorDetails: [{ vendorId: 'demo-vendor-a', vendorName: 'Demo Vendor A' }],
      canSwitchVendors: true,
      defaultVendorId: 'demo-vendor-a',
    });
    getReturnMock.mockResolvedValue(returnDetail);

    const { container } = renderPage();

    expect(await screen.findByRole('heading', { name: 'Return request' })).toBeInTheDocument();
    const grid = container.querySelector('.return-review-grid');
    const main = container.querySelector('.return-review-main');
    const sidebar = screen.getByLabelText('Return operational sidebar');
    expect(grid).toBeInTheDocument();
    expect(main).toBeInTheDocument();
    expect(sidebar).toHaveClass('return-review-side');

    const summary = screen.getByRole('heading', { name: 'Return details' });
    const timeline = screen.getAllByText('Timeline')[0];
    const operations = screen.getAllByText('Operations')[0];
    const nextAction = screen.getByRole('heading', { name: 'Vendor review' });
    const navlungo = screen.getByRole('heading', { name: 'Provider return shipment' });

    expect(sidebar).toContainElement(summary.closest('article'));
    expect(sidebar).toContainElement(timeline.closest('article'));
    expect(sidebar).toContainElement(operations.closest('article'));
    expect(sidebar).toContainElement(navlungo.closest('article'));
    expect(navlungo.closest('article')).toHaveClass('return-review-navlungo-card');
    expect(summary.compareDocumentPosition(timeline) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(timeline.compareDocumentPosition(operations) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(operations.compareDocumentPosition(nextAction) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(nextAction.compareDocumentPosition(navlungo) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('renders Navlungo return lifecycle logs and lets admin sync status', async () => {
    const user = userEvent.setup();
    setCurrentUser({
      email: 'admin@example.com',
      name: 'Admin User',
      role: 'admin',
      vendorAccess: ['demo-vendor-a'],
      vendorDetails: [{ vendorId: 'demo-vendor-a', vendorName: 'Demo Vendor A' }],
      canSwitchVendors: true,
      defaultVendorId: 'demo-vendor-a',
    });
    const syncedReturn = {
      ...returnDetail,
      returnProvider: 'navlungo',
      returnProviderShipmentId: 'NAV-RET-1',
      returnTrackingNumber: 'CARRIER-RET-1',
      returnTrackingUrl: 'https://tracking.example/CARRIER-RET-1',
      returnLabel: 'barcode-string',
      returnCarrierName: 'Sürat Kargo',
      navlungoReturnCreatedAt: '2026-05-22T09:00:00Z',
      returnProviderSnapshot: {
        navlungoReturnStatusSyncHttpStatus: 200,
        navlungoReturnProviderStatusCode: 17,
        navlungoReturnProviderStatusName: 'Transfer Aşamasında',
        navlungoReturnNormalizedStatus: 'in_transit',
        navlungoReturnLastStatusSyncedAt: '2026-05-22T12:00:00Z',
        navlungoReturnStatusLogs: [
          {
            status_code: 16,
            action: 'Teslim Alındı',
            action_result: 'Pickup completed',
            created_at: '2026-05-22T10:00:00Z',
          },
          {
            status_code: 17,
            action: 'Transfer Aşamasında',
            action_result: 'In transit',
            created_at: '2026-05-22T11:00:00Z',
          },
          {
            status_code: 17,
            action: 'Transfer Aşamasında',
            action_result: 'In transit',
            created_at: '2026-05-22T11:00:00Z',
          },
        ],
        shopifyReturnStatusSyncSkippedReason: 'not_implemented',
      },
    } satisfies ReturnDetail;
    getReturnMock.mockResolvedValue(syncedReturn);
    syncNavlungoReturnStatusMock.mockResolvedValueOnce(syncedReturn);

    renderPage();

    expect(await screen.findByText('Transfer Aşamasında')).toBeInTheDocument();
    expect(screen.getByText('Provider status')).toBeInTheDocument();
    expect(screen.getByText('Shopify return status sync')).toBeInTheDocument();
    expect(screen.getAllByText('not_implemented').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Picked up')).toHaveLength(1);
    expect(screen.getAllByText('In transit').length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: 'Sync Navlungo return status' }));

    expect(syncNavlungoReturnStatusMock).toHaveBeenCalledWith(returnDetail.id);
    expect(await screen.findByText('Navlungo return status synced.')).toBeInTheDocument();
  });

  it('keeps Navlungo return status sync action admin-only', async () => {
    getReturnMock.mockResolvedValue({
      ...returnDetail,
      returnProvider: 'navlungo',
      returnProviderShipmentId: 'NAV-RET-1',
      returnTrackingNumber: 'NAV-RET-1',
      returnCarrierName: 'Sürat Kargo',
      navlungoReturnCreatedAt: '2026-05-22T09:00:00Z',
    });

    renderPage();

    expect(await screen.findByText('Customer shipment')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sync Navlungo return status' })).not.toBeInTheDocument();
  });

  it('lets admin preview Navlungo return pickup from the return request context', async () => {
    const user = userEvent.setup();
    setCurrentUser({
      email: 'admin@example.com',
      name: 'Admin User',
      role: 'admin',
      vendorAccess: ['demo-vendor-a'],
      vendorDetails: [{ vendorId: 'demo-vendor-a', vendorName: 'Demo Vendor A' }],
      canSwitchVendors: true,
      defaultVendorId: 'demo-vendor-a',
    });
    getReturnMock.mockResolvedValue(returnDetail);
    createNavlungoReturnPickupMock.mockResolvedValueOnce({
      ...returnDetail,
      returnProviderSnapshot: {
        navlungoReturnPickupDryRun: true,
        navlungoReturnPickupMissingFields: [],
        recipientAddressIdValid: true,
        navlungoReturnPickupPayloadSummary: {
          endpointPath: '/post/create',
          requestedPostType: 3,
          requestedCarrierId: 9,
          senderKeys: ['name', 'phone', 'email', 'address', 'country', 'city', 'district', 'post_code'],
          recipientKeys: ['addressId'],
          customData1Present: true,
          customData2Present: true,
          customData3Present: true,
          customData4Present: true,
        },
      },
    });

    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Preview Navlungo return pickup' }));

    expect(createNavlungoReturnPickupMock).toHaveBeenCalledWith(returnDetail.id, { dryRun: true });
    expect(await screen.findByText('Navlungo return pickup preview generated. No provider call was made.')).toBeInTheDocument();
  });

  it('lets admin send Navlungo return pickup diagnostic API version and carrier overrides', async () => {
    const user = userEvent.setup();
    setCurrentUser({
      email: 'admin@example.com',
      name: 'Admin User',
      role: 'admin',
      vendorAccess: ['demo-vendor-a'],
      vendorDetails: [{ vendorId: 'demo-vendor-a', vendorName: 'Demo Vendor A' }],
      canSwitchVendors: true,
      defaultVendorId: 'demo-vendor-a',
    });
    getReturnMock.mockResolvedValue(returnDetail);
    createNavlungoReturnPickupMock.mockResolvedValueOnce({
      ...returnDetail,
      returnProvider: 'navlungo',
      returnProviderShipmentId: 'NAV-RET-DIAG-1',
    });

    renderPage();

    await screen.findByRole('heading', { name: 'Provider return shipment' });
    await user.selectOptions(screen.getByLabelText('API version'), 'v2.1');
    await user.selectOptions(screen.getByLabelText('Carrier'), '10');
    await user.click(screen.getByLabelText('I understand this may create a live Navlungo return pickup.'));
    await user.click(screen.getByRole('button', { name: 'Create live Navlungo return pickup' }));

    expect(createNavlungoReturnPickupMock).toHaveBeenCalledWith(returnDetail.id, {
      dryRun: false,
      apiVersionOverride: 'v2.1',
      carrierOverride: '10',
      endpointPathOverride: '/post/create',
      diagnosticConfirm: 'YES',
    });
  });

  it('lets admin probe Navlungo return pickup against the post return endpoint', async () => {
    const user = userEvent.setup();
    setCurrentUser({
      email: 'admin@example.com',
      name: 'Admin User',
      role: 'admin',
      vendorAccess: ['demo-vendor-a'],
      vendorDetails: [{ vendorId: 'demo-vendor-a', vendorName: 'Demo Vendor A' }],
      canSwitchVendors: true,
      defaultVendorId: 'demo-vendor-a',
    });
    getReturnMock.mockResolvedValue(returnDetail);
    createNavlungoReturnPickupMock.mockResolvedValueOnce({
      ...returnDetail,
      returnProvider: 'navlungo',
      returnProviderShipmentId: 'NAV-RET-RETURN-1',
    });

    renderPage();

    await screen.findByRole('heading', { name: 'Provider return shipment' });
    await user.selectOptions(screen.getByLabelText('API version'), 'v2.1');
    await user.selectOptions(screen.getByLabelText('Endpoint path'), '/post/return');
    await user.click(screen.getByLabelText('I understand this may create a live Navlungo return pickup.'));
    await user.click(screen.getByRole('button', { name: 'Create live Navlungo return pickup' }));

    expect(createNavlungoReturnPickupMock).toHaveBeenCalledWith(returnDetail.id, {
      dryRun: false,
      apiVersionOverride: 'v2.1',
      carrierOverride: 'current',
      endpointPathOverride: '/post/return',
      diagnosticConfirm: 'YES',
    });
  });

  it('renders admin completion fields for missing Navlungo return pickup customer address data', async () => {
    const user = userEvent.setup();
    setCurrentUser({
      email: 'admin@example.com',
      name: 'Admin User',
      role: 'admin',
      vendorAccess: ['demo-vendor-a'],
      vendorDetails: [{ vendorId: 'demo-vendor-a', vendorName: 'Demo Vendor A' }],
      canSwitchVendors: true,
      defaultVendorId: 'demo-vendor-a',
    });
    getReturnMock.mockResolvedValue({
      ...returnDetail,
      returnProviderSnapshot: {
        navlungoReturnPickupMissingFields: ['sender.district'],
        navlungoReturnAutoCreateSkippedReason: 'missing_required_fields',
      },
    });
    saveNavlungoReturnPickupAddressCompletionMock.mockResolvedValueOnce({
      ...returnDetail,
      returnProviderSnapshot: {
        navlungoReturnPickupMissingFields: [],
        navlungoReturnPickupCustomerOverrideKeys: ['district'],
        navlungoReturnPickupCustomerOverrideValuesRedacted: true,
        navlungoReturnPickupStatus: 'ready',
      },
    });

    renderPage();

    expect(await screen.findByLabelText('Return pickup address completion')).toBeInTheDocument();
    expect(screen.getByLabelText('District')).toBeInTheDocument();
    expect(screen.queryByLabelText('City')).not.toBeInTheDocument();

    await user.type(screen.getByLabelText('District'), 'Kadikoy');
    await user.click(screen.getByRole('button', { name: 'Save return pickup address' }));

    expect(saveNavlungoReturnPickupAddressCompletionMock).toHaveBeenCalledWith(returnDetail.id, {
      customerOverrides: {
        district: 'Kadikoy',
      },
    });
    expect(await screen.findByText('Return pickup address saved.')).toBeInTheDocument();
  });

  it('renders admin completion fields from alternate Navlungo missing-field diagnostics', async () => {
    setCurrentUser({
      email: 'admin@example.com',
      name: 'Admin User',
      role: 'admin',
      vendorAccess: ['demo-vendor-a'],
      vendorDetails: [{ vendorId: 'demo-vendor-a', vendorName: 'Demo Vendor A' }],
      canSwitchVendors: true,
      defaultVendorId: 'demo-vendor-a',
    });
    getReturnMock.mockResolvedValue({
      ...returnDetail,
      returnProviderSnapshot: {
        navlungoReturnMissingFields: ['sender.district'],
        navlungoReturnAutoCreateSkippedReason: 'missing_required_fields',
      },
    });

    renderPage();

    expect(await screen.findByLabelText('Return pickup address completion')).toBeInTheDocument();
    expect(screen.getByLabelText('District')).toBeInTheDocument();
  });

  it('shows skipped Navlungo return auto-create diagnostics', async () => {
    setCurrentUser({
      email: 'admin@example.com',
      name: 'Admin User',
      role: 'admin',
      vendorAccess: ['demo-vendor-a'],
      vendorDetails: [{ vendorId: 'demo-vendor-a', vendorName: 'Demo Vendor A' }],
      canSwitchVendors: true,
      defaultVendorId: 'demo-vendor-a',
    });
    getReturnMock.mockResolvedValue({
      ...returnDetail,
      returnProviderSnapshot: {
        navlungoReturnAutoCreateAttempted: false,
        navlungoReturnAutoCreateSkippedReason: 'provider_not_navlungo',
      },
    });

    renderPage();

    const diagnostics = await screen.findByLabelText('Navlungo return auto-create diagnostics');
    expect(within(diagnostics).getByText('Auto-create attempted')).toBeInTheDocument();
    expect(within(diagnostics).getByText('no')).toBeInTheDocument();
    expect(within(diagnostics).getByText('provider not navlungo')).toBeInTheDocument();
  });

  it('shows missing fields in Navlungo return auto-create diagnostics', async () => {
    setCurrentUser({
      email: 'admin@example.com',
      name: 'Admin User',
      role: 'admin',
      vendorAccess: ['demo-vendor-a'],
      vendorDetails: [{ vendorId: 'demo-vendor-a', vendorName: 'Demo Vendor A' }],
      canSwitchVendors: true,
      defaultVendorId: 'demo-vendor-a',
    });
    getReturnMock.mockResolvedValue({
      ...returnDetail,
      returnProviderSnapshot: {
        navlungoReturnAutoCreateAttempted: true,
        navlungoReturnAutoCreateSkippedReason: 'missing_required_fields',
        navlungoReturnMissingFields: ['sender.district'],
      },
    });

    renderPage();

    const diagnostics = await screen.findByLabelText('Navlungo return auto-create diagnostics');
    expect(within(diagnostics).getByText('yes')).toBeInTheDocument();
    expect(within(diagnostics).getByText('missing required fields')).toBeInTheDocument();
    expect(within(diagnostics).getByText('sender.district')).toBeInTheDocument();
  });

  it('shows Navlungo return provider failure diagnostics', async () => {
    setCurrentUser({
      email: 'admin@example.com',
      name: 'Admin User',
      role: 'admin',
      vendorAccess: ['demo-vendor-a'],
      vendorDetails: [{ vendorId: 'demo-vendor-a', vendorName: 'Demo Vendor A' }],
      canSwitchVendors: true,
      defaultVendorId: 'demo-vendor-a',
    });
    getReturnMock.mockResolvedValue({
      ...returnDetail,
      returnProviderSnapshot: {
        navlungoReturnAutoCreateAttempted: true,
        navlungoReturnCreateHttpStatus: 422,
        navlungoReturnCreateSucceeded: false,
        navlungoReturnEndpointVersionTried: 'v2.1',
        navlungoReturnResolvedProviderPath: '/v2.1/post/create',
        navlungoReturnResolvedProviderUrl: 'https://domestic-api.navlungo.com/v2.1/post/create',
        providerMessage: 'Validation Errors',
        navlungoReturnValidationFields: ['posts.0.sender.district'],
        navlungoReturnValidationMessages: ['Sender district is required.'],
        navlungoReturnValidationResponseShape: {
          kind: 'json:object',
          topLevelKeys: ['message', 'status', 'errors'],
        },
        responseKeys: ['message', 'status', 'error'],
      },
    });

    renderPage();

    const diagnostics = await screen.findByLabelText('Navlungo return auto-create diagnostics');
    expect(within(diagnostics).getByText('422')).toBeInTheDocument();
    expect(within(diagnostics).getByText('Validation Errors')).toBeInTheDocument();
    expect(within(diagnostics).getByText('v2.1')).toBeInTheDocument();
    expect(within(diagnostics).getByText('/v2.1/post/create')).toBeInTheDocument();
    expect(within(diagnostics).getByText('https://domestic-api.navlungo.com/v2.1/post/create')).toBeInTheDocument();
    expect(within(diagnostics).getByText('posts.0.sender.district')).toBeInTheDocument();
    expect(within(diagnostics).getByText('Sender district is required.')).toBeInTheDocument();
    expect(within(diagnostics).getByText('json:object · message, status, errors')).toBeInTheDocument();
    expect(within(diagnostics).getByText(/responseKeys/)).toBeInTheDocument();
  });

  it('renders sanitized Navlungo return request summary without PII', async () => {
    setCurrentUser({
      email: 'admin@example.com',
      name: 'Admin User',
      role: 'admin',
      vendorAccess: ['demo-vendor-a'],
      vendorDetails: [{ vendorId: 'demo-vendor-a', vendorName: 'Demo Vendor A' }],
      canSwitchVendors: true,
      defaultVendorId: 'demo-vendor-a',
    });
    getReturnMock.mockResolvedValue({
      ...returnDetail,
      returnProviderSnapshot: {
        navlungoReturnAutoCreateAttempted: true,
        navlungoReturnCreateHttpStatus: 500,
        navlungoReturnCreateSucceeded: false,
        providerMessage: 'Execution of ServiceCallout failed. Tracking ID: #safe123',
        navlungoReturnRequestedBarcodeFormat: 'pdf-A6',
        navlungoReturnRequestedCarrierId: 9,
        navlungoReturnRequestedPostType: 3,
        recipientAddressIdValid: true,
        navlungoReturnRequestSummary: {
          baseUrl: 'domestic-api.navlungo.com/v2',
          endpointPath: '/post/create',
          method: 'POST',
          topLevelBodyKeys: ['platform', 'posts'],
          postKeys: [
            'barcode_format',
            'carrier_id',
            'cod_payment_type',
            'custom_data_1',
            'custom_data_2',
            'custom_data_3',
            'custom_data_4',
            'post',
            'post_type',
            'recipient',
            'reference_id',
            'sender',
          ],
          senderKeys: ['address', 'city', 'country', 'district', 'email', 'name', 'phone', 'post_code'],
          recipientKeys: ['addressId'],
          postPayloadKeys: ['desi', 'note', 'package_count', 'price'],
          requestedCarrierId: 9,
          requestedPostType: 3,
          requestedBarcodeFormat: 'pdf-A6',
          desiPresent: true,
          desiType: 'number',
          requestedDesi: 1,
          packageCountPresent: true,
          packageCountType: 'number',
          requestedPackageCount: 1,
          postPricePresent: true,
          postPriceType: 'string-empty',
          customData1Present: true,
          customData2Present: true,
          customData3Present: true,
          customData4Present: true,
        },
      },
    });

    renderPage();

    const diagnostics = await screen.findByLabelText('Navlungo return auto-create diagnostics');
    expect(within(diagnostics).getByText('3')).toBeInTheDocument();
    expect(within(diagnostics).getByText('9')).toBeInTheDocument();
    expect(within(diagnostics).getByText('pdf-A6')).toBeInTheDocument();
    expect(within(diagnostics).getByText('domestic-api.navlungo.com/v2')).toBeInTheDocument();
    expect(within(diagnostics).getByText('/post/create')).toBeInTheDocument();
    expect(within(diagnostics).getByText('addressId')).toBeInTheDocument();
    expect(within(diagnostics).getByText('valid')).toBeInTheDocument();
    expect(within(diagnostics).getAllByText('1 (number)').length).toBeGreaterThanOrEqual(2);
    expect(within(diagnostics).getByText('string-empty')).toBeInTheDocument();
    expect(screen.queryByText('John Doe')).not.toBeInTheDocument();
    expect(screen.queryByText('+90 535 123 45 67')).not.toBeInTheDocument();
    expect(screen.queryByText('recipient@firma.com')).not.toBeInTheDocument();
    expect(screen.queryByText('Deneme Mahallesi, Ural Sk. No:999')).not.toBeInTheDocument();
  });

  it('shows successful Navlungo return provider evidence in diagnostics', async () => {
    setCurrentUser({
      email: 'admin@example.com',
      name: 'Admin User',
      role: 'admin',
      vendorAccess: ['demo-vendor-a'],
      vendorDetails: [{ vendorId: 'demo-vendor-a', vendorName: 'Demo Vendor A' }],
      canSwitchVendors: true,
      defaultVendorId: 'demo-vendor-a',
    });
    getReturnMock.mockResolvedValue({
      ...returnDetail,
      returnProvider: 'navlungo',
      returnProviderShipmentId: 'NAV-RET-77',
      returnTrackingUrl: 'https://tracking.example/NAV-RET-77',
      returnLabel: 'barcode-string',
      returnProviderSnapshot: {
        navlungoReturnAutoCreateAttempted: true,
        navlungoReturnCreateHttpStatus: 201,
        navlungoReturnCreateSucceeded: true,
        navlungoReturnProviderMessage: 'Created',
      },
    });

    renderPage();

    const diagnostics = await screen.findByLabelText('Navlungo return auto-create diagnostics');
    expect(within(diagnostics).getByText('201')).toBeInTheDocument();
    expect(within(diagnostics).getByText('Created')).toBeInTheDocument();
    expect(within(diagnostics).getByText('NAV-RET-77')).toBeInTheDocument();
    expect(within(diagnostics).getByText('Open tracking')).toBeInTheDocument();
    expect(within(diagnostics).getByText('available')).toBeInTheDocument();
  });

  it('keeps completion fields and typed district visible across background refetch', async () => {
    const user = userEvent.setup();
    setCurrentUser({
      email: 'admin@example.com',
      name: 'Admin User',
      role: 'admin',
      vendorAccess: ['demo-vendor-a'],
      vendorDetails: [{ vendorId: 'demo-vendor-a', vendorName: 'Demo Vendor A' }],
      canSwitchVendors: true,
      defaultVendorId: 'demo-vendor-a',
    });
    getReturnMock
      .mockResolvedValueOnce({
        ...returnDetail,
        returnProviderSnapshot: {
          navlungoReturnMissingFields: ['sender.district'],
          navlungoReturnAutoCreateSkippedReason: 'missing_required_fields',
        },
      })
      .mockResolvedValue({
        ...returnDetail,
        returnProviderSnapshot: {
          navlungoReturnAutoCreateSkippedReason: 'missing_required_fields',
        },
      });
    createNavlungoReturnPickupMock.mockResolvedValueOnce({
      ...returnDetail,
      returnProviderSnapshot: {
        navlungoReturnPickupDryRun: true,
        navlungoReturnPickupPayloadSummary: {
          endpointPath: '/post/create',
          requestedPostType: 3,
          requestedCarrierId: 9,
        },
      },
    });

    renderPage();

    const districtInput = await screen.findByLabelText('District');
    await user.type(districtInput, 'Kartal');
    await user.click(screen.getByRole('button', { name: 'Preview Navlungo return pickup' }));

    expect(await screen.findByText('Navlungo return pickup preview generated. No provider call was made.')).toBeInTheDocument();
    expect(screen.getByLabelText('Return pickup address completion')).toBeInTheDocument();
    expect(screen.getByLabelText('District')).toHaveValue('Kartal');
  });

  it('hides completion fields after saved completion resolves missing sender district', async () => {
    const user = userEvent.setup();
    setCurrentUser({
      email: 'admin@example.com',
      name: 'Admin User',
      role: 'admin',
      vendorAccess: ['demo-vendor-a'],
      vendorDetails: [{ vendorId: 'demo-vendor-a', vendorName: 'Demo Vendor A' }],
      canSwitchVendors: true,
      defaultVendorId: 'demo-vendor-a',
    });
    const missingReturn = {
      ...returnDetail,
      returnProviderSnapshot: {
        navlungoReturnMissingFields: ['sender.district'],
        navlungoReturnAutoCreateSkippedReason: 'missing_required_fields',
      },
    } satisfies ReturnDetail;
    const resolvedReturn = {
      ...returnDetail,
      returnProviderSnapshot: {
        navlungoReturnPickupMissingFields: [],
        navlungoReturnMissingFields: [],
        navlungoReturnPickupCustomerOverrideKeys: ['district'],
        navlungoReturnPickupCustomerOverrideValuesRedacted: true,
        navlungoReturnPickupStatus: 'ready',
      },
    } satisfies ReturnDetail;
    getReturnMock.mockResolvedValueOnce(missingReturn).mockResolvedValue(resolvedReturn);
    saveNavlungoReturnPickupAddressCompletionMock.mockResolvedValueOnce(resolvedReturn);

    renderPage();

    await user.type(await screen.findByLabelText('District'), 'Kartal');
    await user.click(screen.getByRole('button', { name: 'Save return pickup address' }));

    expect(await screen.findByText('Return pickup address saved.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Return pickup address completion')).not.toBeInTheDocument();
  });

  it('hides completion fields when Navlungo return pickup evidence exists', async () => {
    setCurrentUser({
      email: 'admin@example.com',
      name: 'Admin User',
      role: 'admin',
      vendorAccess: ['demo-vendor-a'],
      vendorDetails: [{ vendorId: 'demo-vendor-a', vendorName: 'Demo Vendor A' }],
      canSwitchVendors: true,
      defaultVendorId: 'demo-vendor-a',
    });
    getReturnMock.mockResolvedValue({
      ...returnDetail,
      returnProvider: 'navlungo',
      returnProviderShipmentId: 'NAV-RET-1',
      returnProviderSnapshot: {
        navlungoReturnMissingFields: ['sender.district'],
      },
    });

    renderPage();

    expect(await screen.findByText('Provider ID')).toBeInTheDocument();
    expect(screen.queryByLabelText('Return pickup address completion')).not.toBeInTheDocument();
  });

  it('renders admin completion fields after live create reports missing sender district', async () => {
    const user = userEvent.setup();
    setCurrentUser({
      email: 'admin@example.com',
      name: 'Admin User',
      role: 'admin',
      vendorAccess: ['demo-vendor-a'],
      vendorDetails: [{ vendorId: 'demo-vendor-a', vendorName: 'Demo Vendor A' }],
      canSwitchVendors: true,
      defaultVendorId: 'demo-vendor-a',
    });
    getReturnMock.mockResolvedValue(returnDetail);
    createNavlungoReturnPickupMock.mockRejectedValueOnce(
      new Error('Missing required Navlungo return pickup fields:\n- sender.district\n\nProvider request blocked before create call.'),
    );

    renderPage();

    await screen.findByRole('heading', { name: 'Provider return shipment' });
    await user.click(screen.getByLabelText('I understand this may create a live Navlungo return pickup.'));
    await user.click(screen.getByRole('button', { name: 'Create live Navlungo return pickup' }));

    expect(await screen.findByText(/Missing required Navlungo return pickup fields/)).toBeInTheDocument();
    expect(screen.getByLabelText('Return pickup address completion')).toBeInTheDocument();
    expect(screen.getByLabelText('District')).toBeInTheDocument();
  });

  it('does not render return pickup completion fields for vendors', async () => {
    getReturnMock.mockResolvedValue({
      ...returnDetail,
      returnProviderSnapshot: {
        navlungoReturnPickupMissingFields: ['sender.district'],
        navlungoReturnAutoCreateSkippedReason: 'missing_required_fields',
      },
    });

    renderPage();

    expect(await screen.findByRole('heading', { name: 'Return request' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Return pickup address completion')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save return pickup address' })).not.toBeInTheDocument();
  });

  it('links to Orders with a query parameter when the related order id is a Shopify id', async () => {
    getReturnMock.mockResolvedValue({
      ...returnDetail,
      relatedOrderId: 'gid://shopify/Order/1023',
      sourceShopifyOrderId: 'gid://shopify/Order/1023',
    });

    renderPage();

    await screen.findByRole('heading', { name: 'Return request' });
    const orderLinks = screen
      .getAllByText('Order #1023')
      .map((element) => element.closest('a'))
      .filter(Boolean);

    expect(orderLinks.some((link) => link?.getAttribute('href') === '/orders?shopifyOrderId=gid%3A%2F%2Fshopify%2FOrder%2F1023')).toBe(true);
  });

  it('keeps internal order route ids in the linked order route segment', async () => {
    getReturnMock.mockResolvedValue(returnDetail);

    renderPage();

    await screen.findByRole('heading', { name: 'Return request' });
    const orderLinks = screen
      .getAllByText('Order #1023')
      .map((element) => element.closest('a'))
      .filter(Boolean);

    expect(orderLinks.some((link) => link?.getAttribute('href') === '/orders/ORD-1023')).toBe(true);
  });

  it('renders actual Shopify return reason and customer note when available', async () => {
    getReturnMock.mockResolvedValue({
      ...returnDetail,
      reason: 'Size Too Large',
      returnReasonNote: 'Beden büyük geldi.',
      resolution: 'Beden büyük geldi.',
    });

    renderPage();

    expect(await screen.findByText('Size Too Large')).toBeInTheDocument();
    expect(screen.getByText('Beden büyük geldi.')).toBeInTheDocument();
    expect(screen.queryByText(/Shopify return request lifecycle/i)).not.toBeInTheDocument();
  });

  it('renders return shipment details and tracking-backed timeline stage when available', async () => {
    getReturnMock.mockResolvedValue({
      ...returnDetail,
      returnCarrierName: 'Yurtiçi Kargo',
      returnTrackingNumber: 'returnkargo-123',
      returnTrackingUrl: 'https://tracking.example/returnkargo-123',
    });

    renderPage();

    expect(await screen.findByText('Customer shipment')).toBeInTheDocument();
    expect(screen.getByText('Yurtiçi Kargo')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'returnkargo-123' })).toHaveAttribute(
      'href',
      'https://tracking.example/returnkargo-123',
    );
    expect(screen.getByText('Return shipment created')).toBeInTheDocument();
    expect(screen.queryByText(/in transit/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/delivered/i)).not.toBeInTheDocument();
  });

  it('hides return shipment details when Shopify tracking is unavailable', async () => {
    getReturnMock.mockResolvedValue(returnDetail);

    renderPage();

    expect(await screen.findByRole('heading', { name: 'Return request' })).toBeInTheDocument();
    expect(screen.queryByText('Customer shipment')).not.toBeInTheDocument();
    expect(screen.queryByText('Return shipment created')).not.toBeInTheDocument();
  });

  it('adds approved and refund processed timeline stages only when status data supports them', async () => {
    getReturnMock.mockResolvedValue({
      ...returnDetail,
      status: 'Approved',
    });

    const { unmount } = renderPage();

    expect(await screen.findByText('Return approved')).toBeInTheDocument();
    expect(screen.queryByText('Refund processed')).not.toBeInTheDocument();

    unmount();
    getReturnMock.mockResolvedValue({
      ...returnDetail,
      sourceType: 'shopify_refund',
      status: 'Processed',
      sourceShopifyRefundId: 'gid://shopify/Refund/1',
    });

    renderPage();

    expect(await screen.findByText('Refund processed')).toBeInTheDocument();
  });

  it('lets a vendor mark their own return received and approve it without issuing a refund', async () => {
    const user = userEvent.setup();
    getReturnMock
      .mockResolvedValueOnce(returnDetail)
      .mockResolvedValueOnce({ ...returnDetail, vendorReceivedAt: '2026-05-14T10:00:00Z' })
      .mockResolvedValueOnce({
        ...returnDetail,
        vendorReceivedAt: '2026-05-14T10:00:00Z',
        vendorReviewedAt: '2026-05-14T10:05:00Z',
        vendorDecision: 'approved',
      });
    markReturnReceivedMock.mockResolvedValueOnce({ ...returnDetail, vendorReceivedAt: '2026-05-14T10:00:00Z' });
    reviewReturnMock.mockResolvedValueOnce({
      ...returnDetail,
      vendorReceivedAt: '2026-05-14T10:00:00Z',
      vendorReviewedAt: '2026-05-14T10:05:00Z',
      vendorDecision: 'approved',
    });

    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Mark received' }));
    expect(markReturnReceivedMock).toHaveBeenCalledWith(returnDetail.id);
    expect(await screen.findByText('Received by vendor')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Approve return' }));
    expect(reviewReturnMock).toHaveBeenCalledWith(returnDetail.id, { decision: 'approved' });
    expect(await screen.findByText('Approved by vendor')).toBeInTheDocument();
    expect(screen.queryByText(/refund issued/i)).not.toBeInTheDocument();
  });

  it('requires a reason before rejecting a received return', async () => {
    const user = userEvent.setup();
    getReturnMock.mockResolvedValue({
      ...returnDetail,
      vendorReceivedAt: '2026-05-14T10:00:00Z',
    });
    reviewReturnMock.mockResolvedValueOnce({
      ...returnDetail,
      vendorReceivedAt: '2026-05-14T10:00:00Z',
      vendorReviewedAt: '2026-05-14T10:05:00Z',
      vendorDecision: 'rejected',
      vendorDecisionReason: 'Item is damaged.',
    });

    renderPage();

    expect(await screen.findByRole('button', { name: 'Reject return' })).toBeDisabled();
    await user.type(screen.getByLabelText('Reject reason'), 'Item is damaged.');
    await user.click(screen.getByRole('button', { name: 'Reject return' }));

    expect(reviewReturnMock).toHaveBeenCalledWith(returnDetail.id, {
      decision: 'rejected',
      reason: 'Item is damaged.',
    });
  });

  it('creates a context-aware support ticket from return detail', async () => {
    const user = userEvent.setup();
    getReturnMock.mockResolvedValue(returnDetail);
    createSupportTicketMock.mockResolvedValueOnce({
      id: 'ticket-1',
      createdAt: '2026-05-16T10:00:00Z',
      updatedAt: '2026-05-16T10:00:00Z',
      createdByUserId: 'user-1',
      createdByRole: 'vendor',
      vendorId: 'demo-vendor-a',
      vendorName: 'Demo Vendor A',
      subject: 'Help with return #1023',
      message: 'Can you help with this return?',
      priority: 'normal',
      status: 'open',
      contextType: 'return',
      contextId: returnDetail.id,
      contextSnapshot: {},
    });

    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Contact support' }));
    expect(screen.getByRole('dialog', { name: 'Contact support' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('Message'), 'Can you help with this return?');
    await user.click(screen.getByRole('button', { name: 'Create ticket' }));

    expect(createSupportTicketMock).toHaveBeenCalledWith(expect.objectContaining({
      contextType: 'return',
      contextId: returnDetail.id,
      priority: 'normal',
      subject: 'Help with return #1023',
      message: 'Can you help with this return?',
      contextSnapshot: expect.objectContaining({
        route: `/returns/${returnDetail.id}`,
        orderNumber: '#1023',
        returnStatus: 'Awaiting review',
        refundStatus: 'Refund pending',
      }),
    }));
    expect((await screen.findAllByText('Support ticket created.')).length).toBeGreaterThan(0);
  });

  it('hides vendor review actions from a vendor outside the assigned return scope', async () => {
    setCurrentUser({
      email: 'vendor-b@example.com',
      name: 'Vendor B',
      role: 'vendor',
      vendorAccess: ['demo-vendor-b'],
      vendorDetails: [{ vendorId: 'demo-vendor-b', vendorName: 'Demo Vendor B' }],
      canSwitchVendors: false,
      defaultVendorId: 'demo-vendor-b',
    });
    getReturnMock.mockResolvedValue(returnDetail);

    renderPage();

    expect(await screen.findByText('Vendor review')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark received' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve return' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reject return' })).not.toBeInTheDocument();
  });
});
