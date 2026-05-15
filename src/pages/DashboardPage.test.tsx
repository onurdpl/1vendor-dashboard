import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DashboardPage } from './DashboardPage';
import type { DashboardOverview, NotificationIntent, NotificationsResponse } from '../lib/api/contracts';
import { setCurrentUser, setToken } from '../lib/auth';

const getDashboardOverviewMock = vi.fn<() => Promise<DashboardOverview>>();
const listNotificationsMock = vi.fn<() => Promise<NotificationsResponse>>();
const markNotificationReadMock = vi.fn<(notificationId: string) => Promise<NotificationIntent>>();
const dismissNotificationMock = vi.fn<(notificationId: string) => Promise<NotificationIntent>>();

vi.mock('../lib/api/dashboard', async () => {
  const actual = await vi.importActual<typeof import('../lib/api/dashboard')>('../lib/api/dashboard');
  return {
    ...actual,
    getDashboardOverview: () => getDashboardOverviewMock(),
  };
});

vi.mock('../services/runtime-services', () => ({
  runtimeServices: {
    notifications: {
      list: () => listNotificationsMock(),
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

function getNotificationCenter() {
  const headings = screen.getAllByRole('heading', { name: 'Notification center' });
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
    expect(screen.getAllByText('Operational priority queue')).toHaveLength(1);
    expect(screen.queryByText('Operational signals')).not.toBeInTheDocument();
    expect(screen.getByText('Diagnostics summary')).toBeInTheDocument();
    expect(screen.getByText('Operational health')).toBeInTheDocument();
    expect(screen.getByText('1 operational job is dead-letter ready.')).toBeInTheDocument();
  });

  it('renders the notification center list with compact metadata', async () => {
    getDashboardOverviewMock.mockResolvedValue(dashboardOverview);

    renderDashboardPage();

    expect(await screen.findByText('Notification center')).toBeInTheDocument();
    expect(screen.getByText('Shipping cost is pending')).toBeInTheDocument();
    expect(screen.getByText('External-provider shipping cost is missing.')).toBeInTheDocument();
    expect(screen.getByText('shipping cost')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /mark as read/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /dismiss/i })).toBeInTheDocument();
  });

  it('renders recent activity as a compact title and description feed', async () => {
    getDashboardOverviewMock.mockResolvedValue(dashboardOverview);

    renderDashboardPage();

    expect(await screen.findByText('Recent operational events')).toBeInTheDocument();
    expect(screen.getByText('Refund webhook processed')).toBeInTheDocument();
    expect(screen.getByText('Refund ID 123 processed successfully.')).toBeInTheDocument();
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
