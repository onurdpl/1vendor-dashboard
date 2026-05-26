import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DashboardPage } from './DashboardPage';
import type { DashboardOverview, NotificationIntent, NotificationsResponse } from '../lib/api/contracts';
import { setCurrentUser, setCurrentVendorId, setToken } from '../lib/auth';

const getDashboardOverviewMock = vi.fn<(vendorId?: string) => Promise<DashboardOverview>>();
const listNotificationsMock = vi.fn<(vendorId?: string | null) => Promise<NotificationsResponse>>();
const markNotificationReadMock = vi.fn<(notificationId: string) => Promise<NotificationIntent>>();
const dismissNotificationMock = vi.fn<(notificationId: string) => Promise<NotificationIntent>>();

vi.mock('../lib/api/dashboard', async () => {
  const actual = await vi.importActual<typeof import('../lib/api/dashboard')>('../lib/api/dashboard');
  return {
    ...actual,
    getDashboardOverview: (vendorId?: string) => getDashboardOverviewMock(vendorId),
  };
});

vi.mock('../services/runtime-services', () => ({
  runtimeServices: {
    notifications: {
      list: (vendorId?: string) => listNotificationsMock(vendorId),
      markRead: (notificationId: string) => markNotificationReadMock(notificationId),
      dismiss: (notificationId: string) => dismissNotificationMock(notificationId),
    },
  },
}));

const dashboardOverview: DashboardOverview = {
  vendorId: 'demo-vendor-a',
  vendorName: 'Demo Vendor A',
  title: 'Demo Vendor A command center',
  description: 'Monitor backend-derived operational state.',
  stats: [
    { label: 'Vendor orders', value: '4' },
    { label: 'Awaiting shipment', value: '2' },
    { label: 'Blocked / attention', value: '1' },
    { label: 'Payout estimate', value: '$1,200.00' },
  ],
  recentActivity: ['Refund webhook processed: Refund ID 123 processed successfully.'],
  workspaceStatus: 'Demo Vendor A has 4 vendor-scoped orders.',
  priorityWork: [
    { label: 'Blocked allocations', value: '1', tone: 'severity-warning', description: 'Allocations waiting for recovery.' },
    { label: 'Awaiting shipment', value: '2', tone: 'severity-attention', description: 'Allocations still waiting for shipment progress.' },
    { label: 'Refund attention', value: '0', tone: 'severity-normal', description: 'No active refund attention items.' },
  ],
  financeSnapshot: {
    grossSales: '$2,000.00',
    refunds: '$300.00',
    netRevenue: '$1,700.00',
    payoutEstimate: '$1,530.00',
  },
  diagnosticsSummary: {
    failedWebhooks: 0,
    stuckReceived: 0,
    fulfillmentSyncFailures: 0,
  },
  observabilitySummary: {
    health: 'warning',
    retryPressureScore: 5,
    deadLetterReady: 1,
    failedWebhooks24h: 1,
    successRate24h: 0.91,
    reconciliationBacklog: 2,
    staleStateCount: 4,
    note: '1 operational job is dead-letter ready.',
  },
  notificationSummary: {
    unread: 1,
    highPriority: 1,
    latest: [{ id: 'notif-1', title: 'Shipping cost is pending', severity: 'warning', status: 'delivered' }],
  },
};

const notification: NotificationIntent = {
  id: 'notif-1',
  signalId: 'signal-1',
  vendorId: 'demo-vendor-a',
  recipientRole: 'vendor',
  channel: 'in_app',
  status: 'delivered',
  title: 'Shipping cost is pending',
  message: 'External-provider shipping cost is missing.',
  severity: 'warning',
  deliveredAt: '2026-05-13T10:00:00.000Z',
  readAt: null,
  metadata: {
    signalSourceArea: 'SHIPPING_COST',
  },
  createdAt: '2026-05-13T10:00:00.000Z',
  updatedAt: '2026-05-13T10:00:00.000Z',
};

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

function getNotificationCenter() {
  const headings = screen.getAllByRole('heading', { name: /notification (center|history)/i });
  const heading = headings[headings.length - 1];
  const section = heading.closest('section');
  if (!section) {
    throw new Error('Notification center section not found.');
  }
  return within(section);
}

function getNotificationSummaryValue(label: string) {
  const labelNode = getNotificationCenter().getByText(label);
  return labelNode.nextElementSibling?.textContent ?? '';
}

describe('DashboardPage command center', () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
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
    getDashboardOverviewMock.mockReset();
    listNotificationsMock.mockReset();
    markNotificationReadMock.mockReset();
    dismissNotificationMock.mockReset();
    listNotificationsMock.mockResolvedValue({
      summary: {
        total: 1,
        unread: 1,
        critical: 0,
        high: 0,
        warning: 1,
      },
      notifications: [notification],
    });
    markNotificationReadMock.mockResolvedValue({
      ...notification,
      status: 'read',
      readAt: '2026-05-13T10:05:00.000Z',
    });
    dismissNotificationMock.mockResolvedValue({
      ...notification,
      status: 'dismissed',
    });
  });

  it('renders dashboard command center without duplicated operational signal sections', async () => {
    getDashboardOverviewMock.mockResolvedValue(dashboardOverview);

    renderDashboardPage();

    expect(await screen.findByRole('heading', { name: /demo vendor a command center/i })).toBeInTheDocument();
    expect(screen.getAllByText('Operational queues')).toHaveLength(1);
    expect(screen.queryByText('Operational signals')).not.toBeInTheDocument();
    expect(screen.getByText('Diagnostics summary')).toBeInTheDocument();
    expect(screen.getByText('Operational health')).toBeInTheDocument();
    expect(screen.getByText('1 operational job is dead-letter ready.')).toBeInTheDocument();
  });

  it('renders the dashboard shell and skeleton cards while overview data loads', () => {
    const dashboardResult = deferred<DashboardOverview>();
    getDashboardOverviewMock.mockReturnValue(dashboardResult.promise);

    renderDashboardPage();

    expect(screen.getByRole('heading', { name: 'Operations dashboard' })).toBeInTheDocument();
    expect(screen.getByText('Needs attention')).toBeInTheDocument();
    expect(screen.getByText('Operational queues')).toBeInTheDocument();
    expect(screen.getByLabelText('Dashboard action skeleton')).toBeInTheDocument();
    expect(screen.getByLabelText('Dashboard priority skeleton')).toBeInTheDocument();
    expect(screen.getByText('Vendor orders')).toBeInTheDocument();
    expect(screen.queryByText('Loading operational overview')).not.toBeInTheDocument();
  });

  it('orders dashboard hierarchy from action work to queues before passive insight history', async () => {
    getDashboardOverviewMock.mockResolvedValue(dashboardOverview);

    const { container } = renderDashboardPage();

    expect(await screen.findByRole('heading', { name: /demo vendor a command center/i })).toBeInTheDocument();
    const pageText = container.textContent ?? '';
    expect(pageText.indexOf('Needs attention')).toBeLessThan(pageText.indexOf('Operational queues'));
    expect(pageText.indexOf('Operational queues')).toBeLessThan(pageText.indexOf('Passive insights'));
    expect(pageText.indexOf('Passive insights')).toBeLessThan(pageText.indexOf('Finance snapshot'));
    expect(screen.getByText('Fulfillment queue')).toBeInTheDocument();
    expect(screen.getByText('Returns queue')).toBeInTheDocument();
    expect(screen.getByText('Finance review queue')).toBeInTheDocument();
    expect(screen.getByText('Support queue')).toBeInTheDocument();
    expect(screen.getByText('Automation queue')).toBeInTheDocument();
  });

  it('loads admin dashboard data for the selected vendor and admin notifications globally', async () => {
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
    setCurrentVendorId('demo-vendor-b');
    getDashboardOverviewMock.mockResolvedValue({
      ...dashboardOverview,
      vendorId: 'demo-vendor-b',
      vendorName: 'Demo Vendor B',
      title: 'Demo Vendor B command center',
    });

    renderDashboardPage();

    expect(await screen.findByRole('heading', { name: /demo vendor b command center/i })).toBeInTheDocument();
    expect(getDashboardOverviewMock).toHaveBeenCalledWith('demo-vendor-b');
    expect(listNotificationsMock).toHaveBeenCalledWith(null);
    expect(screen.getByText('Admin notification history')).toBeInTheDocument();
    expect(screen.getByText('Grouped global admin alert history.')).toBeInTheDocument();
  });

  it('loads vendor notifications with the selected vendor scope for vendor users', async () => {
    setCurrentUser({
      email: 'vendor@demo.com',
      name: 'Demo Vendor User',
      role: 'vendor',
      vendorAccess: ['demo-vendor-a'],
      vendorDetails: [{ vendorId: 'demo-vendor-a', vendorName: 'Demo Vendor A' }],
      canSwitchVendors: false,
      defaultVendorId: 'demo-vendor-a',
    });
    getDashboardOverviewMock.mockResolvedValue(dashboardOverview);

    renderDashboardPage();

    expect(await screen.findByRole('heading', { name: /demo vendor a command center/i })).toBeInTheDocument();
    expect(listNotificationsMock).toHaveBeenCalledWith('demo-vendor-a');
  });

  it('renders the notification center list with compact metadata', async () => {
    getDashboardOverviewMock.mockResolvedValue(dashboardOverview);

    renderDashboardPage();

    expect(await screen.findByRole('heading', { name: /demo vendor a command center/i })).toBeInTheDocument();
    expect(await screen.findByText(/notification history/i)).toBeInTheDocument();
    expect(screen.getByText('Shipping cost is pending')).toBeInTheDocument();
    expect(screen.getByText('External-provider shipping cost is missing.')).toBeInTheDocument();
    expect(screen.getByText('shipping cost')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /mark as read/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /dismiss/i })).toBeInTheDocument();
  });

  it('renders recent activity as a compact title and description feed', async () => {
    getDashboardOverviewMock.mockResolvedValue(dashboardOverview);

    renderDashboardPage();

    expect(await screen.findByRole('heading', { name: /demo vendor a command center/i })).toBeInTheDocument();
    expect(await screen.findByText('Recent operational events')).toBeInTheDocument();
    expect(screen.getByText('Refund webhook processed')).toBeInTheDocument();
    expect(screen.getByText('Refund ID 123 processed successfully.')).toBeInTheDocument();
  });

  it('groups repeated recent operational events into one dashboard signal', async () => {
    getDashboardOverviewMock.mockResolvedValue({
      ...dashboardOverview,
      recentActivity: [
        'Fulfillment is stale: 102h awaiting shipment',
        'Fulfillment is stale: 91h awaiting shipment',
        'Fulfillment is stale: 88h awaiting shipment',
      ],
    });

    renderDashboardPage();

    expect(await screen.findByText('3 stale fulfillments')).toBeInTheDocument();
    expect(screen.getByText('Latest issue: 102h awaiting shipment')).toBeInTheDocument();
    expect(screen.getByText('Show 3 matching events')).toBeInTheDocument();
  });

  it('groups repeated notification alerts while preserving the latest action surface', async () => {
    getDashboardOverviewMock.mockResolvedValue(dashboardOverview);
    listNotificationsMock.mockResolvedValue({
      summary: {
        total: 3,
        unread: 3,
        critical: 0,
        high: 3,
        warning: 0,
      },
      notifications: [
        {
          ...notification,
          id: 'notif-stale-1',
          signalId: 'signal-stale-1',
          title: 'Fulfillment is stale',
          message: 'Order #1061 has waited 102h.',
          severity: 'high',
          createdAt: '2026-05-13T12:00:00.000Z',
          updatedAt: '2026-05-13T12:00:00.000Z',
          metadata: {
            signalSourceArea: 'FULFILLMENT',
          },
        },
        {
          ...notification,
          id: 'notif-stale-2',
          signalId: 'signal-stale-2',
          title: 'Fulfillment is stale',
          message: 'Order #1059 has waited 91h.',
          severity: 'high',
          createdAt: '2026-05-13T11:00:00.000Z',
          updatedAt: '2026-05-13T11:00:00.000Z',
          metadata: {
            signalSourceArea: 'FULFILLMENT',
          },
        },
        {
          ...notification,
          id: 'notif-stale-3',
          signalId: 'signal-stale-3',
          title: 'Fulfillment is stale',
          message: 'Order #1058 has waited 88h.',
          severity: 'high',
          createdAt: '2026-05-13T10:00:00.000Z',
          updatedAt: '2026-05-13T10:00:00.000Z',
          metadata: {
            signalSourceArea: 'FULFILLMENT',
          },
        },
      ],
    });

    renderDashboardPage();

    expect(await screen.findByText('3 stale fulfillment alerts')).toBeInTheDocument();
    expect(screen.getByText('Latest issue: Order #1061 has waited 102h.')).toBeInTheDocument();
    expect(screen.getByText('3 linked alerts')).toBeInTheDocument();
    expect(screen.getByText('3 unread')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /mark as read/i })).toBeInTheDocument();
  });

  it('renders an empty notification state', async () => {
    getDashboardOverviewMock.mockResolvedValue(dashboardOverview);
    listNotificationsMock.mockResolvedValue({
      summary: {
        total: 0,
        unread: 0,
        critical: 0,
        high: 0,
        warning: 0,
      },
      notifications: [],
    });

    renderDashboardPage();

    expect(await screen.findByText('No active notifications')).toBeInTheDocument();
  });

  it('marks notifications as read and refreshes dashboard state', async () => {
    const user = userEvent.setup();
    getDashboardOverviewMock.mockResolvedValue(dashboardOverview);

    renderDashboardPage();

    const readButtons = await screen.findAllByRole('button', { name: /mark as read/i });
    expect(getNotificationSummaryValue('Unread')).toBe('1');
    await user.click(readButtons[0]);

    expect(markNotificationReadMock).toHaveBeenCalledWith('notif-1');
    expect(await screen.findByText('Notification marked as read.')).toBeInTheDocument();
    expect(getNotificationSummaryValue('Unread')).toBe('0');
    expect(screen.getByText('read')).toBeInTheDocument();
    await waitFor(() => expect(listNotificationsMock.mock.calls.length).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect(getDashboardOverviewMock.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it('dismisses notifications and refreshes dashboard state', async () => {
    const user = userEvent.setup();
    getDashboardOverviewMock.mockResolvedValue(dashboardOverview);

    renderDashboardPage();

    const dismissButtons = await screen.findAllByRole('button', { name: /dismiss/i });
    await user.click(dismissButtons[0]);

    expect(dismissNotificationMock).toHaveBeenCalledWith('notif-1');
    expect(await screen.findByText('Notification dismissed.')).toBeInTheDocument();
    expect(getNotificationSummaryValue('Unread')).toBe('0');
    expect(getNotificationCenter().getByText('No active notifications')).toBeInTheDocument();
    await waitFor(() => expect(listNotificationsMock.mock.calls.length).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect(getDashboardOverviewMock.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it('shows a compact error when notification actions fail', async () => {
    const user = userEvent.setup();
    getDashboardOverviewMock.mockResolvedValue(dashboardOverview);
    markNotificationReadMock.mockRejectedValue(new Error('Network failed'));

    renderDashboardPage();

    const readButtons = await screen.findAllByRole('button', { name: /mark as read/i });
    await user.click(readButtons[0]);

    expect(markNotificationReadMock).toHaveBeenCalledWith('notif-1');
    expect(await screen.findByText('Notification could not be marked as read.')).toBeInTheDocument();
  });
});
