import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DashboardPage } from './DashboardPage';
import type { DashboardOverview, OrderSummary } from '../lib/api/contracts';
import { setCurrentUser, setCurrentVendorId, setToken } from '../lib/auth';

const getDashboardOverviewMock = vi.fn<(vendorId?: string) => Promise<DashboardOverview>>();
const getDashboardDeferredOverviewMock = vi.fn<(vendorId?: string) => Promise<DashboardOverview>>();
const listOrdersMock = vi.fn<(options?: { vendorId?: string | null; signal?: AbortSignal }) => Promise<OrderSummary[]>>();

vi.mock('../lib/api/dashboard', async () => {
  const actual = await vi.importActual<typeof import('../lib/api/dashboard')>('../lib/api/dashboard');
  return {
    ...actual,
    getDashboardOverview: (vendorId?: string) => getDashboardOverviewMock(vendorId),
    getDashboardDeferredOverview: (vendorId?: string) => getDashboardDeferredOverviewMock(vendorId),
  };
});

vi.mock('../features/orders/api', () => ({
  listOrders: (options?: { vendorId?: string | null; signal?: AbortSignal }) => listOrdersMock(options),
}));

const dashboardOverview: DashboardOverview = {
  vendorId: 'demo-vendor-a',
  vendorName: 'Demo Vendor A',
  title: 'Demo Vendor A command center',
  description: 'Monitor backend-derived operational state.',
  stats: [
    { label: 'Vendor orders', value: '8' },
    { label: 'Awaiting shipment', value: '13' },
    { label: 'Payout estimate', value: 'TRY 24,580' },
  ],
  recentActivity: ['Refund webhook processed: Refund ID 123 processed successfully.'],
  workspaceStatus: 'Demo Vendor A has vendor-scoped activity.',
  priorityWork: [
    { label: 'Refund attention', value: '5', tone: 'severity-warning', description: 'Returns requiring review.' },
  ],
  financeSnapshot: {
    grossSales: 'TRY 42,000',
    refunds: 'TRY 1,200',
    netRevenue: 'TRY 40,800',
    payoutEstimate: 'TRY 24,580',
    latestCompletedPayment: null,
  },
};

const deferredDashboardOverview: DashboardOverview = {
  ...dashboardOverview,
  priorityWork: [
    { label: 'Refund attention', value: '6', tone: 'severity-warning', description: 'Updated return review count.' },
  ],
};

function makeOrder(overrides: Partial<OrderSummary>): OrderSummary {
  return {
    id: 'order-1',
    originalVendorId: 'demo-vendor-a',
    assignedVendorId: 'demo-vendor-a',
    vendorId: 'demo-vendor-a',
    sourceShopifyOrderId: 'gid://shopify/Order/1',
    sourceShopifyOrderNumber: '1081',
    status: 'Open',
    allocationStatus: 'active',
    operationalActionability: { actionable: true, reason: null },
    reassignmentRequired: false,
    assignmentHistory: [],
    fulfillmentActionState: 'ready',
    fulfillmentActionAvailable: true,
    fulfillmentStatus: 'Pending',
    shippingStatus: 'Awaiting Shipment',
    lineItemCount: 1,
    date: '2026-06-11T08:00:00.000Z',
    customer: 'Customer',
    amount: 'TRY 100',
    channel: 'Shopify',
    ...overrides,
  };
}

const recentOrders: OrderSummary[] = [
  makeOrder({
    id: 'order-1084',
    sourceShopifyOrderNumber: '1084',
    shippingStatus: 'Delivered',
    fulfillmentStatus: 'Fulfilled',
    date: '2026-06-10T14:15:00.000Z',
  }),
  makeOrder({
    id: 'order-1088',
    sourceShopifyOrderNumber: '1088',
    shippingStatus: 'Awaiting Shipment',
    fulfillmentStatus: 'Pending',
    date: '2026-06-11T10:32:00.000Z',
  }),
  makeOrder({
    id: 'order-1087',
    sourceShopifyOrderNumber: '1087',
    shippingStatus: 'Awaiting Shipment',
    fulfillmentStatus: 'Pending',
    date: '2026-06-11T09:15:00.000Z',
  }),
  makeOrder({
    id: 'order-1086',
    sourceShopifyOrderNumber: '1086',
    shippingStatus: 'Processing',
    fulfillmentStatus: 'Processing',
    date: '2026-06-11T08:47:00.000Z',
  }),
  makeOrder({
    id: 'order-1085',
    sourceShopifyOrderNumber: '1085',
    shippingStatus: 'Shipped',
    fulfillmentStatus: 'Fulfilled',
    date: '2026-06-10T18:20:00.000Z',
  }),
  makeOrder({
    id: 'order-1083',
    sourceShopifyOrderNumber: '1083',
    shippingStatus: 'Delivered',
    fulfillmentStatus: 'Fulfilled',
    date: '2026-06-09T08:00:00.000Z',
  }),
];

const dashboardRoles = ['admin', 'vendor', 'support', 'finance'] as const;

function setDashboardRole(role: (typeof dashboardRoles)[number]) {
  setCurrentUser({
    email: `${role}@demo.com`,
    name: `Demo ${role}`,
    role,
    vendorAccess: ['demo-vendor-a'],
    vendorDetails: [{ vendorId: 'demo-vendor-a', vendorName: 'Demo Vendor A' }],
    canSwitchVendors: false,
    defaultVendorId: 'demo-vendor-a',
  });
}

function getRecentOrderRow(orderNumber: string) {
  const orderCell = within(screen.getByLabelText('Recent changes')).getByText(`#${orderNumber}`);
  const row = orderCell.closest('tr');
  expect(row).not.toBeNull();
  return row as HTMLTableRowElement;
}

function renderDashboardPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <DashboardPage />
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

describe('DashboardPage vendor launchpad', () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    window.localStorage.clear();
    setToken('test-token');
    setCurrentVendorId(null);
    setCurrentUser({
      email: 'admin@demo.com',
      name: 'Demo Admin',
      role: 'admin',
      vendorAccess: ['demo-vendor-a'],
      vendorDetails: [{ vendorId: 'demo-vendor-a', vendorName: 'Demo Vendor A' }],
      canSwitchVendors: false,
      defaultVendorId: 'demo-vendor-a',
    });
    getDashboardOverviewMock.mockReset();
    getDashboardDeferredOverviewMock.mockReset();
    getDashboardDeferredOverviewMock.mockResolvedValue(deferredDashboardOverview);
    listOrdersMock.mockReset();
    listOrdersMock.mockResolvedValue(recentOrders);
  });

  it('renders the simplified vendor launchpad header and topbar shortcuts', async () => {
    getDashboardOverviewMock.mockResolvedValue(dashboardOverview);

    renderDashboardPage();

    expect(await screen.findByRole('heading', { name: /today, demo vendor a/i })).toBeInTheDocument();
    expect(screen.getByText('Start with the work that needs attention, then check orders, returns, and payment timing.')).toBeInTheDocument();
    const shortcuts = screen.getByLabelText('Dashboard shortcuts');
    expect(within(shortcuts).getByRole('button', { name: 'Open support tickets' })).toBeInTheDocument();
    expect(within(shortcuts).queryByRole('button', { name: 'Open inbox' })).not.toBeInTheDocument();
    expect(within(shortcuts).queryByText('3')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open vendor profile' })).toBeInTheDocument();
  });

  it('renders the dashboard summary and supporting metrics with current dashboard values', async () => {
    getDashboardOverviewMock.mockResolvedValue(dashboardOverview);
    getDashboardDeferredOverviewMock.mockReturnValue(new Promise<DashboardOverview>(() => undefined));

    renderDashboardPage();

    const summaryRegion = await screen.findByLabelText('Today dashboard summary');
    expect(within(summaryRegion).getByText('Most important today')).toBeInTheDocument();
    expect(within(summaryRegion).getByRole('heading', { name: 'Needs Attention Today' })).toBeInTheDocument();
    const actionSummary = await within(summaryRegion).findByLabelText('Today action summary');
    expect(within(actionSummary).getByText('5')).toBeInTheDocument();
    expect(within(summaryRegion).getByText('5 actions need your attention today.')).toBeInTheDocument();
    expect(within(summaryRegion).getByText('returns waiting review')).toBeInTheDocument();
    expect(within(summaryRegion).getByRole('link', { name: /review work/i })).toHaveAttribute('href', '/returns');

    const metricsRegion = within(summaryRegion).getByLabelText('Dashboard supporting metrics');
    const cards = within(metricsRegion).getAllByRole('article');
    expect(cards).toHaveLength(3);

    expect(within(metricsRegion).getByText('Orders to Ship')).toBeInTheDocument();
    expect(within(metricsRegion).getByText('13')).toBeInTheDocument();
    expect(within(metricsRegion).getByText('Awaiting shipment')).toBeInTheDocument();
    expect(within(metricsRegion).getByRole('link', { name: /ship orders/i })).toHaveAttribute('href', '/orders');
    expect(within(metricsRegion).getByText('Returns to Review')).toBeInTheDocument();
    expect(within(metricsRegion).getByText('5')).toBeInTheDocument();
    expect(within(metricsRegion).getByText('Returns requiring review.')).toBeInTheDocument();
    expect(within(metricsRegion).getByRole('link', { name: /review returns/i })).toHaveAttribute('href', '/returns');
    expect(within(metricsRegion).getByText('Upcoming Payment')).toBeInTheDocument();
    expect(within(metricsRegion).getByText('TRY 24,580')).toBeInTheDocument();
    expect(within(metricsRegion).getByText('Expected payment')).toBeInTheDocument();
    expect(within(metricsRegion).getByRole('link', { name: /view payment/i })).toHaveAttribute('href', '/finance');
  });

  it('loads dashboard and order data for the selected vendor', async () => {
    getDashboardOverviewMock.mockResolvedValue(dashboardOverview);

    renderDashboardPage();

    expect(await screen.findByRole('heading', { name: /today, demo vendor a/i })).toBeInTheDocument();
    expect(getDashboardOverviewMock).toHaveBeenCalledWith('demo-vendor-a');
    await waitFor(() => expect(listOrdersMock).toHaveBeenCalledWith(expect.objectContaining({ vendorId: 'demo-vendor-a' })));
  });

  it('renders missing vendor context as a terminal state instead of dashboard skeletons', async () => {
    setCurrentVendorId(null);
    setCurrentUser({
      email: 'admin@demo.com',
      name: 'Demo Admin',
      role: 'admin',
      vendorAccess: [],
      vendorDetails: [],
      canSwitchVendors: false,
      defaultVendorId: '',
    });

    renderDashboardPage();

    expect(await screen.findByText('Select vendor')).toBeInTheDocument();
    expect(screen.getByText('No vendor context available. Choose a vendor context before loading the vendor dashboard.')).toBeInTheDocument();
    expect(getDashboardOverviewMock).not.toHaveBeenCalled();
    expect(listOrdersMock).not.toHaveBeenCalled();
  });

  it('loads deferred dashboard data after the initial launchpad shell renders', async () => {
    const deferredDashboard = deferred<DashboardOverview>();
    getDashboardOverviewMock.mockResolvedValue({
      ...dashboardOverview,
      priorityWork: [],
    });
    getDashboardDeferredOverviewMock.mockReturnValue(deferredDashboard.promise);

    renderDashboardPage();

    expect(getDashboardDeferredOverviewMock).not.toHaveBeenCalled();
    expect(await screen.findByRole('heading', { name: /today, demo vendor a/i })).toBeInTheDocument();
    await waitFor(() => expect(getDashboardDeferredOverviewMock).toHaveBeenCalledWith('demo-vendor-a'));

    deferredDashboard.resolve(deferredDashboardOverview);
    const actionSummary = await screen.findByLabelText('Today action summary');
    expect(within(actionSummary).getByText('6')).toBeInTheDocument();
  });

  it('renders recent orders from the existing order client, sorted to the latest five', async () => {
    getDashboardOverviewMock.mockResolvedValue(dashboardOverview);

    renderDashboardPage();

    const recentChangesRegion = await screen.findByLabelText('Recent changes');
    await within(recentChangesRegion).findByText('#1088');
    expect(within(recentChangesRegion).getByRole('heading', { name: 'Recent Changes' })).toBeInTheDocument();
    expect(within(recentChangesRegion).getByRole('link', { name: /open orders/i })).toHaveAttribute('href', '/orders');
    expect(within(recentChangesRegion).getByText('Recent orders')).toBeInTheDocument();

    const rows = within(recentChangesRegion).getAllByRole('row');
    expect(rows).toHaveLength(6);
    expect(within(rows[1]).getByText('#1088')).toBeInTheDocument();
    expect(within(rows[1]).getByRole('link', { name: 'Open' })).toHaveAttribute('href', '/orders/order-1088');
    expect(within(recentChangesRegion).getByText('#1084')).toBeInTheDocument();
    expect(within(recentChangesRegion).queryByText('#1083')).not.toBeInTheDocument();
  });

  it.each(dashboardRoles)('uses canonical non-active recent-order labels for %s', async (role) => {
    setDashboardRole(role);
    getDashboardOverviewMock.mockResolvedValue(dashboardOverview);
    listOrdersMock.mockResolvedValue([
      makeOrder({
        id: 'order-1201',
        sourceShopifyOrderNumber: '1201',
        operationalActionability: { actionable: false, reason: 'ALLOCATION_REFUND_TERMINAL' },
        fulfillmentActionAvailable: false,
        date: '2026-06-12T12:01:00.000Z',
      }),
      makeOrder({
        id: 'order-1202',
        sourceShopifyOrderNumber: '1202',
        status: 'Cancelled',
        isCancelled: true,
        cancelledAt: '2026-06-12T11:02:00.000Z',
        fulfillmentStatus: 'Not Required',
        shippingStatus: 'Not Required',
        fulfillmentActionState: 'not_required',
        fulfillmentActionAvailable: false,
        date: '2026-06-12T11:02:00.000Z',
      }),
      makeOrder({
        id: 'order-1203',
        sourceShopifyOrderNumber: '1203',
        status: 'Cancelled',
        isCancelled: true,
        isCancellationConflict: true,
        cancelledAt: '2026-06-12T10:03:00.000Z',
        shippingStatus: 'Delivered',
        fulfillmentActionAvailable: false,
        date: '2026-06-12T10:03:00.000Z',
      }),
      makeOrder({
        id: 'order-1204',
        sourceShopifyOrderNumber: '1204',
        status: 'On Hold',
        allocationStatus: 'vendor_blocked',
        reassignmentRequired: true,
        fulfillmentActionAvailable: false,
        date: '2026-06-12T09:04:00.000Z',
      }),
    ]);

    renderDashboardPage();

    await screen.findByText('#1201');
    const refundedRow = getRecentOrderRow('1201');
    const cancelledRow = getRecentOrderRow('1202');
    const conflictRow = getRecentOrderRow('1203');
    const blockedRow = getRecentOrderRow('1204');

    expect(within(refundedRow).getByText('Refunded')).toBeInTheDocument();
    expect(within(refundedRow).queryByText('Awaiting Shipment')).not.toBeInTheDocument();
    expect(within(refundedRow).getByText('Refunded')).toHaveClass('dashboard-vendor-status-green');
    expect(within(cancelledRow).getByText('Cancelled')).toBeInTheDocument();
    expect(within(cancelledRow).queryByText('Not Required')).not.toBeInTheDocument();
    expect(within(cancelledRow).getByText('Cancelled')).toHaveClass('dashboard-vendor-status-blue');
    expect(within(conflictRow).getByText('Cancelled')).toBeInTheDocument();
    expect(within(conflictRow).queryByText('Delivered')).not.toBeInTheDocument();
    expect(within(conflictRow).queryByText('Review required')).not.toBeInTheDocument();
    expect(within(conflictRow).getByText('Cancelled')).toHaveClass('dashboard-vendor-status-green');
    expect(within(blockedRow).getByText('Vendor Blocked')).toBeInTheDocument();
    expect(within(blockedRow).queryByText('Awaiting Shipment')).not.toBeInTheDocument();
    expect(within(blockedRow).getByText('Vendor Blocked')).toHaveClass('dashboard-vendor-status-green');
    expect(within(refundedRow).getByRole('link', { name: 'Open' })).toHaveAttribute('href', '/orders/order-1201');
    await waitFor(() => expect(listOrdersMock).toHaveBeenCalledWith(expect.objectContaining({ vendorId: 'demo-vendor-a' })));
  });

  it.each(dashboardRoles)('preserves active recent-order lifecycle labels for %s', async (role) => {
    setDashboardRole(role);
    getDashboardOverviewMock.mockResolvedValue(dashboardOverview);
    listOrdersMock.mockResolvedValue([
      makeOrder({ id: 'order-1211', sourceShopifyOrderNumber: '1211', date: '2026-06-12T12:11:00.000Z' }),
      makeOrder({ id: 'order-1212', sourceShopifyOrderNumber: '1212', date: '2026-06-12T11:12:00.000Z' }),
      makeOrder({
        id: 'order-1213',
        sourceShopifyOrderNumber: '1213',
        status: 'Shipped',
        fulfillmentStatus: 'Fulfilled',
        shippingStatus: 'In Transit',
        date: '2026-06-12T10:13:00.000Z',
      }),
      makeOrder({
        id: 'order-1214',
        sourceShopifyOrderNumber: '1214',
        status: 'Delivered',
        fulfillmentStatus: 'Fulfilled',
        shippingStatus: 'Delivered',
        date: '2026-06-12T09:14:00.000Z',
      }),
    ]);

    renderDashboardPage();

    await screen.findByText('#1211');
    expect(within(getRecentOrderRow('1211')).getByText('Awaiting Shipment')).toBeInTheDocument();
    expect(within(getRecentOrderRow('1212')).getByText('Awaiting Shipment')).toBeInTheDocument();
    expect(within(getRecentOrderRow('1212')).queryByText('Refunded')).not.toBeInTheDocument();
    expect(within(getRecentOrderRow('1212')).queryByText('Cancelled')).not.toBeInTheDocument();
    expect(within(getRecentOrderRow('1212')).queryByText('Vendor Blocked')).not.toBeInTheDocument();
    expect(within(getRecentOrderRow('1213')).getByText('In Transit')).toBeInTheDocument();
    expect(within(getRecentOrderRow('1214')).getByText('Delivered')).toBeInTheDocument();
  });

  it.each(dashboardRoles)('uses the canonical recent-order label in fallback recent changes for %s', async (role) => {
    setDashboardRole(role);
    getDashboardOverviewMock.mockResolvedValue({ ...dashboardOverview, recentActivity: [] });
    getDashboardDeferredOverviewMock.mockReturnValue(new Promise<DashboardOverview>(() => undefined));
    listOrdersMock.mockResolvedValue([
      makeOrder({
        id: 'order-1221',
        sourceShopifyOrderNumber: '1221',
        operationalActionability: { actionable: false, reason: 'ALLOCATION_REFUND_TERMINAL' },
        fulfillmentActionAvailable: false,
        date: '2026-06-12T12:21:00.000Z',
      }),
    ]);

    renderDashboardPage();

    expect(await screen.findByText('#1221 is Refunded')).toBeInTheDocument();
    expect(screen.queryByText('#1221 is Awaiting Shipment')).not.toBeInTheDocument();
  });

  it('renders a polished empty recent orders state when no orders are available', async () => {
    getDashboardOverviewMock.mockResolvedValue({ ...dashboardOverview, recentActivity: [] });
    listOrdersMock.mockResolvedValue([]);

    renderDashboardPage();

    expect(await screen.findByText('No recent changes yet.')).toBeInTheDocument();
    expect(screen.getByText('Order, return, payment, and support updates will appear here when they happen.')).toBeInTheDocument();
  });

  it('renders an order-list error state without breaking the rest of the launchpad', async () => {
    getDashboardOverviewMock.mockResolvedValue({ ...dashboardOverview, recentActivity: [] });
    listOrdersMock.mockRejectedValue(new Error('Orders unavailable'));

    renderDashboardPage();

    expect(await screen.findByRole('heading', { name: /today, demo vendor a/i })).toBeInTheDocument();
    expect(await screen.findByText('Recent changes could not be loaded.')).toBeInTheDocument();
    expect(screen.getByText('Open Orders to review the vendor order list.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Payment Summary' })).toBeInTheDocument();
  });

  it('renders the compact payment summary from the current finance snapshot', async () => {
    getDashboardOverviewMock.mockResolvedValue(dashboardOverview);

    renderDashboardPage();

    const paymentRegion = await screen.findByLabelText('Payment summary');
    await within(paymentRegion).findByText('TRY 24,580');
    expect(within(paymentRegion).getByRole('heading', { name: 'Payment Summary' })).toBeInTheDocument();
    expect(within(paymentRegion).getByText('Upcoming Payment')).toBeInTheDocument();
    expect(within(paymentRegion).getByText('TRY 24,580')).toBeInTheDocument();
    expect(within(paymentRegion).getByText('Estimated from current payment preparation.')).toBeInTheDocument();
    expect(within(paymentRegion).getByText('Last Payment')).toBeInTheDocument();
    expect(within(paymentRegion).getByText('No completed payments yet')).toBeInTheDocument();
    expect(within(paymentRegion).queryByText('No payment history available yet.')).not.toBeInTheDocument();
    expect(within(paymentRegion).queryByText('Completed payments will appear in Finance after payment records exist.')).not.toBeInTheDocument();
    expect(within(paymentRegion).getByRole('link', { name: /payment history/i })).toHaveAttribute('href', '/finance');
  });

  it('renders the latest completed payment from the finance snapshot', async () => {
    getDashboardOverviewMock.mockResolvedValue({
      ...dashboardOverview,
      financeSnapshot: {
        ...dashboardOverview.financeSnapshot,
        payoutEstimate: 'TRY 24,580',
        latestCompletedPayment: {
          id: 'payout-paid-1',
          netAmount: 'TRY 9,875.50',
          currency: 'TRY',
          paidAt: '2026-07-14T11:25:00.000Z',
        },
      },
    });

    renderDashboardPage();

    const paymentRegion = await screen.findByLabelText('Payment summary');
    await within(paymentRegion).findByText('TRY 24,580');
    expect(within(paymentRegion).getByText('Upcoming Payment')).toBeInTheDocument();
    expect(within(paymentRegion).getByText('TRY 24,580')).toBeInTheDocument();
    expect(within(paymentRegion).getByText('Last Payment')).toBeInTheDocument();
    expect(within(paymentRegion).getByText('TRY 9,875.50')).toBeInTheDocument();
    expect(within(paymentRegion).getByText('Paid Jul 14, 2026')).toBeInTheDocument();
    expect(within(paymentRegion).getByRole('link', { name: /payment history/i })).toHaveAttribute('href', '/finance');
  });

  it('does not render old command-center notification or diagnostics sections', async () => {
    getDashboardOverviewMock.mockResolvedValue(dashboardOverview);

    renderDashboardPage();

    expect(await screen.findByRole('heading', { name: /today, demo vendor a/i })).toBeInTheDocument();
    expect(screen.queryByText(/demo vendor a command center/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Needs attention')).not.toBeInTheDocument();
    expect(screen.queryByText('Operational queues')).not.toBeInTheDocument();
    expect(screen.queryByText('Recent operational events')).not.toBeInTheDocument();
    expect(screen.queryByText('Diagnostics summary')).not.toBeInTheDocument();
    expect(screen.queryByText('Operational health')).not.toBeInTheDocument();
    expect(screen.queryByText('No active notifications')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /mark as read/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /dismiss/i })).not.toBeInTheDocument();
  });
});
