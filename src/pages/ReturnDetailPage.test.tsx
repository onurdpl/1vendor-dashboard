import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReturnDetailPage } from './ReturnDetailPage';
import type { ReturnDetail } from '../features/returns/api';
import { setCurrentUser, setToken } from '../lib/auth';

const getReturnMock = vi.fn<(returnId: string) => Promise<ReturnDetail>>();
const markReturnReceivedMock = vi.fn<(returnId: string) => Promise<ReturnDetail>>();
const reviewReturnMock = vi.fn<
  (returnId: string, input: { decision: 'approved' | 'rejected'; reason?: string }) => Promise<ReturnDetail>
>();
const createNavlungoReturnPickupMock = vi.fn<
  (returnId: string, input: { dryRun?: boolean; customerOverrides?: Record<string, string | undefined> }) => Promise<ReturnDetail>
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
    createNavlungoReturnPickup: (returnId: string, input: { dryRun?: boolean; customerOverrides?: Record<string, string | undefined> }) =>
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

describe('ReturnDetailPage vendor review screen', () => {
  beforeEach(() => {
    cleanup();
    window.localStorage.clear();
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
    await user.click(screen.getByLabelText('Creates a live Navlungo return pickup.'));
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
