import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DashboardPage } from './DashboardPage';
import type { DashboardOverview, NotificationIntent, NotificationsResponse } from '../lib/api/contracts';
import { setCurrentUser, setCurrentVendorId, setToken } from '../lib/auth';

const getDashboardOverviewMock = vi.fn<(vendorId?: string) => Promise<DashboardOverview>>();
const getDashboardDeferredOverviewMock = vi.fn<(vendorId?: string) => Promise<DashboardOverview>>();
const listNotificationsMock = vi.fn<(vendorId?: string | null, options?: { headers?: HeadersInit }) => Promise<NotificationsResponse>>();
const getObservabilitySummaryMock = vi.fn();
const markNotificationReadMock = vi.fn<(notificationId: string) => Promise<NotificationIntent>>();
const dismissNotificationMock = vi.fn<(notificationId: string) => Promise<NotificationIntent>>();

vi.mock('../lib/api/dashboard', async () => {
  const actual = await vi.importActual<typeof import('../lib/api/dashboard')>('../lib/api/dashboard');
  return {
    ...actual,
    getDashboardOverview: (vendorId?: string) => getDashboardOverviewMock(vendorId),
    getDashboardDeferredOverview: (vendorId?: string) => getDashboardDeferredOverviewMock(vendorId),
  };
});

vi.mock('../services/runtime-services', () => ({
  runtimeServices: {
    notifications: {
      list: (vendorId?: string, options?: { headers?: HeadersInit }) => listNotificationsMock(vendorId, options),
      markRead: (notificationId: string) => markNotificationReadMock(notificationId),
      dismiss: (notificationId: string) => dismissNotificationMock(notificationId),
    },
    observability: {
      summary: () => getObservabilitySummaryMock(),
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

const dashboardShellOverview: DashboardOverview = {
  vendorId: 'demo-vendor-a',
  vendorName: 'Demo Vendor A',
  title: 'Demo Vendor A command center',
  description: 'Operational overview is loading.',
  loadPhase: 'initial',
  stats: [],
  recentActivity: [],
  workspaceStatus: 'Dashboard data is loading.',
  priorityWork: [],
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

const pendingDeferredDashboard = new Promise<DashboardOverview>(() => undefined);

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
    getDashboardDeferredOverviewMock.mockReset();
    getDashboardDeferredOverviewMock.mockReturnValue(pendingDeferredDashboard);
    listNotificationsMock.mockReset();
    getObservabilitySummaryMock.mockReset();
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
    getObservabilitySummaryMock.mockResolvedValue({
      health: 'warning',
      generatedAt: '2026-05-13T10:00:00.000Z',
      windows: [],
      retryPressure: {
        retryScheduled: 0,
        retrying: 1,
        deadLetterReady: 1,
        permanentlyFailed: 0,
        pressureScore: 5,
      },
      reconciliation: {
        pending: 1,
        processing: 1,
        completed24h: 0,
        failed24h: 0,
        scheduled: 0,
        staleStateCount: 4,
      },
      webhookHealth: {
        received: 0,
        processing: 0,
        processed24h: 10,
        failed24h: 1,
        successRate24h: 0.91,
      },
      staleStates: {
        stuckReceived: 0,
        fulfillmentSyncFailures: 0,
        missingPayload: 0,
        staleAllocations: 0,
        scheduledReconciliationJobs: 0,
        total: 4,
      },
      notes: ['1 operational job is dead-letter ready.'],
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
    expect(screen.queryByText('Priority')).not.toBeInTheDocument();
    expect(screen.queryByText('Business Snapshot')).not.toBeInTheDocument();
    expect(screen.queryByText('Vendor orders')).not.toBeInTheDocument();
    expect(screen.queryByText('Passive insights')).not.toBeInTheDocument();
    expect(screen.queryByText('Workspace context')).not.toBeInTheDocument();
    expect(screen.getByText('Needs attention')).toBeInTheDocument();
    expect(screen.getByText('Recent operational events')).toBeInTheDocument();
    expect(screen.getByText('Diagnostics summary')).toBeInTheDocument();
    expect(screen.getByText('Operational health')).toBeInTheDocument();
    expect(screen.getByText('1 operational job is dead-letter ready.')).toBeInTheDocument();
    expect(screen.getByText('Finance snapshot')).toBeInTheDocument();
    expect(screen.getByText('Gross sales')).toBeInTheDocument();
    expect(screen.getByText('$2,000.00')).toBeInTheDocument();
    expect(screen.getByText('Refunds')).toBeInTheDocument();
    expect(screen.getByText('$300.00')).toBeInTheDocument();
    expect(screen.getByText('Net revenue')).toBeInTheDocument();
    expect(screen.getByText('$1,700.00')).toBeInTheDocument();
    expect(screen.getAllByText('Payout estimate').length).toBeGreaterThan(0);
    expect(screen.getAllByText('$1,530.00').length).toBeGreaterThan(0);
  });

  it('renders the dashboard shell and skeleton cards while overview data loads', () => {
    const dashboardResult = deferred<DashboardOverview>();
    getDashboardOverviewMock.mockReturnValue(dashboardResult.promise);

    renderDashboardPage();

    expect(screen.getByRole('heading', { name: 'Operations dashboard' })).toBeInTheDocument();
    expect(screen.getByText('Needs attention')).toBeInTheDocument();
    expect(screen.getByText('Operational queues')).toBeInTheDocument();
    expect(screen.getByLabelText('Dashboard action skeleton')).toBeInTheDocument();
    expect(screen.queryByLabelText('Dashboard priority skeleton')).not.toBeInTheDocument();
    expect(screen.queryByText('Vendor orders')).not.toBeInTheDocument();
    expect(screen.queryByText('Loading operational overview')).not.toBeInTheDocument();
  });

  it('renders the dashboard shell without waiting for deferred dashboard domains', async () => {
    const deferredDashboard = deferred<DashboardOverview>();
    getDashboardOverviewMock.mockResolvedValue(dashboardShellOverview);
    getDashboardDeferredOverviewMock.mockReturnValue(deferredDashboard.promise);

    renderDashboardPage();

    expect(getDashboardDeferredOverviewMock).not.toHaveBeenCalled();
    expect(await screen.findByRole('heading', { name: /demo vendor a command center/i })).toBeInTheDocument();
    expect(screen.getByLabelText('Dashboard action skeleton')).toBeInTheDocument();
    expect(screen.getByText('Operational overview is loading.')).toBeInTheDocument();
  });

  it('fetches deferred dashboard domains after the initial shell renders', async () => {
    const deferredDashboard = deferred<DashboardOverview>();
    getDashboardOverviewMock.mockResolvedValue(dashboardShellOverview);
    getDashboardDeferredOverviewMock.mockReturnValue(deferredDashboard.promise);

    renderDashboardPage();

    expect(getDashboardDeferredOverviewMock).not.toHaveBeenCalled();
    expect(await screen.findByRole('heading', { name: /demo vendor a command center/i })).toBeInTheDocument();
    await waitFor(() => expect(getDashboardDeferredOverviewMock).toHaveBeenCalledWith('demo-vendor-a'));
  });

  it('marks dashboard widget notification requests as deferred, not initial', async () => {
    getDashboardOverviewMock.mockResolvedValue(dashboardShellOverview);

    renderDashboardPage();

    await waitFor(() => expect(listNotificationsMock).toHaveBeenCalledWith(null, expect.any(Object)));
    const notificationOptions = listNotificationsMock.mock.calls[0]?.[1];
    const headers = new Headers(notificationOptions?.headers);

    expect(headers.get('X-Request-Id')).toEqual(expect.any(String));
    expect(headers.get('X-Dashboard-Deferred-Load')).toBe('true');
    expect(headers.get('X-Dashboard-Initial-Load')).toBeNull();
  });

  it('orders dashboard hierarchy from action work to queues before passive insight history', async () => {
    getDashboardOverviewMock.mockResolvedValue(dashboardOverview);

    const { container } = renderDashboardPage();

    expect(await screen.findByRole('heading', { name: /demo vendor a command center/i })).toBeInTheDocument();
    const pageText = container.textContent ?? '';
    expect(pageText.indexOf('Needs attention')).toBeLessThan(pageText.indexOf('Operational queues'));
    expect(pageText.indexOf('Operational queues')).toBeLessThan(pageText.indexOf('Recent operational events'));
    expect(pageText.indexOf('Recent operational events')).toBeLessThan(pageText.indexOf('Finance snapshot'));
    expect(pageText.indexOf('Finance snapshot')).toBeLessThan(pageText.indexOf('Admin passive notification history'));
    expect(screen.getByText('Fulfillment queue')).toBeInTheDocument();
    expect(screen.getByText('Returns queue')).toBeInTheDocument();
    expect(screen.getByText('Finance review queue')).toBeInTheDocument();
    expect(screen.getByText('Open support issues')).toBeInTheDocument();
    expect(screen.getByText('Automation issue groups')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Review allocation' })).toHaveAttribute('href', '/orders?workflow=blocked-allocation');
    expect(screen.getByRole('link', { name: 'Create shipment' })).toHaveAttribute('href', '/orders?workflow=awaiting-shipment');
    expect(screen.getByRole('link', { name: 'Review return' })).toHaveAttribute('href', '/returns?workflow=pending-review');
    expect(screen.getAllByLabelText('Workflow action guidance').some((node) => node.textContent?.includes('Create shipment'))).toBe(true);
    expect(screen.getByRole('link', { name: 'Open finance' })).toHaveAttribute('href', '/finance?workflow=settlement-review');
    expect(screen.getByRole('link', { name: 'Open support' })).toHaveAttribute('href', '/support?workflow=open-support-issues');
    expect(screen.getByRole('link', { name: 'Open automation' })).toHaveAttribute('href', '/automation?workflow=active-issue-groups');
    expect(screen.getAllByLabelText('Workflow action guidance').length).toBeGreaterThan(0);
    expect(screen.queryByText('Priority')).not.toBeInTheDocument();
    expect(screen.queryByText('Blocked / attention')).not.toBeInTheDocument();
    expect(screen.queryByText('Refund amount')).not.toBeInTheDocument();
    expect(screen.queryByText('Business Snapshot')).not.toBeInTheDocument();
    expect(screen.queryByText('Vendor orders')).not.toBeInTheDocument();
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
    await waitFor(() => expect(listNotificationsMock).toHaveBeenCalledWith(null, expect.any(Object)));
    expect(screen.getByText('Admin passive notification history')).toBeInTheDocument();
    expect(screen.getByText('Top grouped admin alert history. Lower priority groups stay collapsed.')).toBeInTheDocument();
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
    await waitFor(() => expect(listNotificationsMock).toHaveBeenCalledWith('demo-vendor-a', expect.any(Object)));
  });

  it('renders the notification center list with compact metadata', async () => {
    getDashboardOverviewMock.mockResolvedValue(dashboardOverview);

    renderDashboardPage();

    expect(await screen.findByRole('heading', { name: /demo vendor a command center/i })).toBeInTheDocument();
    await waitFor(() => expect(listNotificationsMock).toHaveBeenCalled());
    const notificationCenter = getNotificationCenter();
    expect(notificationCenter.getByText(/notification history/i)).toBeInTheDocument();
    expect(await notificationCenter.findByText('Shipping cost review needed')).toBeInTheDocument();
    expect(await notificationCenter.findByText('External-provider shipping cost is missing from the operational record.')).toBeInTheDocument();
    expect(notificationCenter.getByText('shipping cost')).toBeInTheDocument();
    expect(notificationCenter.getByText('Internal reference')).toBeInTheDocument();
    expect(notificationCenter.getByText('Signal signal-1')).toBeInTheDocument();
    expect(notificationCenter.getByRole('button', { name: /mark as read/i })).toBeInTheDocument();
    expect(notificationCenter.getByRole('button', { name: /dismiss/i })).toBeInTheDocument();
  });

  it('renders recent activity as a compact title and description feed', async () => {
    getDashboardOverviewMock.mockResolvedValue(dashboardOverview);

    renderDashboardPage();

    expect(await screen.findByRole('heading', { name: /demo vendor a command center/i })).toBeInTheDocument();
    expect(await screen.findByText('Recent operational events')).toBeInTheDocument();
    expect(screen.getByText('Refund processed')).toBeInTheDocument();
    expect(screen.getByText('Refund event processing completed successfully.')).toBeInTheDocument();
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

    expect(await screen.findByText('3 fulfillment delays')).toBeInTheDocument();
    expect(screen.getByText('Latest issue: A shipment has not progressed for 102 hours.')).toBeInTheDocument();
    expect(screen.getByText('Show 3 matching events')).toBeInTheDocument();
  });

  it('limits passive event history while preserving collapsed evidence access', async () => {
    getDashboardOverviewMock.mockResolvedValue({
      ...dashboardOverview,
      recentActivity: [
        'Fulfillment is stale: 102h awaiting shipment',
        'Refund webhook processed: Refund ID 123 processed successfully.',
        'Return requested: Return waiting for refund review.',
        'Shipping cost is pending: External-provider shipping cost is missing.',
      ],
    });

    renderDashboardPage();

    expect(await screen.findByLabelText('Dashboard reporting sections')).toBeInTheDocument();
    expect(await screen.findByText('1 older event group collapsed')).toBeInTheDocument();
    expect(screen.getByText('Historical records remain available in operational detail pages.')).toBeInTheDocument();
  });

  it('labels support workload as notification-based when only notification data is available', async () => {
    getDashboardOverviewMock.mockResolvedValue(dashboardOverview);
    listNotificationsMock.mockResolvedValue({
      summary: {
        total: 2,
        unread: 2,
        critical: 0,
        high: 1,
        warning: 1,
      },
      notifications: [
        {
          ...notification,
          id: 'support-notif-1',
          signalId: 'support-signal-1',
          title: 'Support reply received',
          message: 'A support ticket needs vendor review.',
          severity: 'high',
          metadata: {
            signalSourceArea: 'SUPPORT',
            linkedEntityType: 'order',
            linkedEntityId: 'order-1061',
          },
        },
        {
          ...notification,
          id: 'support-notif-2',
          signalId: 'support-signal-2',
          title: 'Support reply received',
          message: 'A second support notification for the same order.',
          severity: 'warning',
          metadata: {
            signalSourceArea: 'SUPPORT',
            linkedEntityType: 'order',
            linkedEntityId: 'order-1061',
          },
        },
      ],
    });

    renderDashboardPage();

    const supportLabel = await screen.findByText('Unread support notifications');
    const supportCard = supportLabel.closest('article');
    expect(supportCard).not.toBeNull();
    expect(within(supportCard as HTMLElement).getByText('1')).toBeInTheDocument();
    expect(within(supportCard as HTMLElement).getByText('1 grouped unread support notification.')).toBeInTheDocument();
    expect(screen.queryByText('Support queue')).not.toBeInTheDocument();
  });

  it('prefers backend-normalized operational counts when present', async () => {
    getDashboardOverviewMock.mockResolvedValue({
      ...dashboardOverview,
      normalizedOperationalCounts: {
        openSupportIssueCount: 5,
        groupedAutomationIssueCount: 4,
        financeReviewItemCount: 3,
        staleFulfillmentGroupCount: 2,
        metadata: {
          openSupportIssueCount: {
            label: 'Open support issues',
            source: 'support.tickets.open_grouped_by_context',
            rawCount: 7,
            groupedCount: 5,
          },
          groupedAutomationIssueCount: {
            label: 'Automation issue groups',
            source: 'automation.alerts_and_operational_signals.grouped',
            rawCount: 31,
            groupedCount: 4,
          },
          financeReviewItemCount: {
            label: 'Finance review items',
            source: 'finance.records.pending_failed_or_held',
            rawCount: 3,
            groupedCount: 3,
          },
          staleFulfillmentGroupCount: {
            label: 'Stale fulfillment groups',
            source: 'operational_signals.fulfillment_stale_grouped_by_allocation',
            rawCount: 4,
            groupedCount: 2,
          },
        },
      },
    });

    renderDashboardPage();

    const staleLabel = await screen.findByText('Stale fulfillment groups');
    expect(within(staleLabel.closest('article') as HTMLElement).getByText('2')).toBeInTheDocument();
    const supportLabel = screen.getByText('Open support issues');
    expect(within(supportLabel.closest('article') as HTMLElement).getByText('5')).toBeInTheDocument();
    const financeLabel = screen.getByText('Finance review queue');
    expect(within(financeLabel.closest('article') as HTMLElement).getByText('3')).toBeInTheDocument();
    const automationLabel = screen.getAllByText('Automation issue groups')[0];
    expect(within(automationLabel.closest('article') as HTMLElement).getByText('4')).toBeInTheDocument();
  });

  it('renders accurate primary action counts without sampled badge', async () => {
    getDashboardOverviewMock.mockResolvedValue({
      ...dashboardOverview,
      stats: [
        { label: 'Vendor orders', value: '30' },
        { label: 'Awaiting shipment', value: '15' },
        { label: 'Blocked / attention', value: '26' },
      ],
      priorityWork: [
        {
          label: 'Blocked allocations',
          value: '12',
          tone: 'severity-warning',
          description: 'Latest 10 order allocations are loaded for recent activity and detail. Full blocked count comes from dashboard summary.',
        },
        {
          label: 'Awaiting shipment',
          value: '15',
          tone: 'severity-attention',
          description: 'Latest 10 order allocations are loaded for recent activity and detail. Full shipment queue count comes from dashboard summary.',
        },
        {
          label: 'Refund attention',
          value: '14',
          tone: 'severity-warning',
          description: 'Latest 10 return records are loaded for recent activity and detail. Full return/refund attention count comes from dashboard summary.',
        },
      ],
    });

    renderDashboardPage();

    expect(await screen.findByText('41 Actions')).toBeInTheDocument();
    expect(screen.queryByText('Sampled actions')).not.toBeInTheDocument();
    expect(screen.queryByText('Action counts include deferred slices where full totals are unavailable.')).not.toBeInTheDocument();
    expect(screen.queryByText(/in latest 10/i)).not.toBeInTheDocument();
    expect(screen.getAllByText(/Latest 10 order allocations are loaded/i).length).toBeGreaterThan(0);
  });

  it('projects raw automation counts as grouped issue semantics', async () => {
    getDashboardOverviewMock.mockResolvedValue({
      ...dashboardOverview,
      priorityWork: [
        ...dashboardOverview.priorityWork,
        {
          label: 'Automation signals',
          value: '31',
          tone: 'severity-attention',
          description: 'Raw backend automation signals are active.',
        },
      ],
    });

    renderDashboardPage();

    expect(await screen.findByRole('heading', { name: /demo vendor a command center/i })).toBeInTheDocument();
    expect(screen.getAllByText('Automation issue groups').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Grouped active automation and rules issues. Raw signals remain in automation history.').length).toBeGreaterThan(0);
    expect(screen.queryByText('Automation signals')).not.toBeInTheDocument();
    expect(screen.queryByText('Automation queue')).not.toBeInTheDocument();
  });

  it('keeps notification history passive while actionable support uses grouped projections', async () => {
    getDashboardOverviewMock.mockResolvedValue(dashboardOverview);

    renderDashboardPage();

    expect(await screen.findByText(/notification history/i)).toBeInTheDocument();
    expect(screen.getByText('Top grouped admin alert history. Lower priority groups stay collapsed.')).toBeInTheDocument();
    expect(screen.getByText('Open support issues')).toBeInTheDocument();
    expect(screen.getByText('Support workspace remains available; no unread support notification groups.')).toBeInTheDocument();
  });

  it('does not use currency values as the finance review queue count', async () => {
    getDashboardOverviewMock.mockResolvedValue(dashboardOverview);

    renderDashboardPage();

    expect(await screen.findByRole('heading', { name: /demo vendor a command center/i })).toBeInTheDocument();
    const financeLabel = screen.getByText('Finance review queue');
    const financeCard = financeLabel.closest('article');
    expect(financeCard).not.toBeNull();
    expect(financeCard).toHaveTextContent('Review pending');
    expect(financeCard).not.toHaveTextContent('$1,530.00');
    expect(financeCard).not.toHaveTextContent('$1,200.00');
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

    expect(await screen.findByText('3 fulfillment delay alerts')).toBeInTheDocument();
    expect(screen.getByText('Latest issue: Order #1061 has not progressed for 102 hours.')).toBeInTheDocument();
    expect(screen.getByText('3 linked alerts')).toBeInTheDocument();
    expect(screen.getByText('3 unread')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /mark as read/i })).toBeInTheDocument();
  });

  it('keeps notification history compact by collapsing lower priority groups', async () => {
    getDashboardOverviewMock.mockResolvedValue(dashboardOverview);
    listNotificationsMock.mockResolvedValue({
      summary: {
        total: 4,
        unread: 4,
        critical: 0,
        high: 2,
        warning: 2,
      },
      notifications: [
        {
          ...notification,
          id: 'notif-ship',
          signalId: 'signal-shipping-cost',
          title: 'Shipping cost is pending',
          message: 'External-provider shipping cost is missing.',
          severity: 'high',
          createdAt: '2026-05-13T12:00:00.000Z',
        },
        {
          ...notification,
          id: 'notif-return',
          signalId: 'signal-return-review',
          title: 'Return request against refund',
          message: 'A return request needs refund review.',
          severity: 'high',
          createdAt: '2026-05-13T11:00:00.000Z',
        },
        {
          ...notification,
          id: 'notif-automation',
          signalId: 'signal-automation',
          title: 'Automation signal active',
          message: 'Raw backend automation signals are active.',
          severity: 'warning',
          createdAt: '2026-05-13T10:00:00.000Z',
        },
        {
          ...notification,
          id: 'notif-fulfillment',
          signalId: 'signal-fulfillment',
          title: 'Fulfillment is stale',
          message: 'Order #1058 has waited 88h.',
          severity: 'warning',
          createdAt: '2026-05-13T09:00:00.000Z',
        },
      ],
    });

    renderDashboardPage();

    expect(await screen.findByText('2 lower-priority notification groups collapsed')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /mark as read/i }).length).toBeGreaterThan(0);
    expect(screen.getByText(/passive notification history/i)).toBeInTheDocument();
  });

  it('removes workspace context and duplicate business snapshot cards', async () => {
    getDashboardOverviewMock.mockResolvedValue(dashboardOverview);

    renderDashboardPage();

    expect(await screen.findByText('Recent operational events')).toBeInTheDocument();
    expect(screen.queryByText('Business Snapshot')).not.toBeInTheDocument();
    expect(screen.queryByText('Vendor orders')).not.toBeInTheDocument();
    expect(document.querySelector('.dashboard-passive-kpis')).toBeNull();
    expect(screen.queryByText('Workspace context')).not.toBeInTheDocument();
    expect(screen.queryByText('History mode')).not.toBeInTheDocument();
    expect(screen.queryByText('Grouped')).not.toBeInTheDocument();
    expect(screen.queryByText('Top groups')).not.toBeInTheDocument();
    expect(screen.queryByText('Traceable')).not.toBeInTheDocument();
    expect(screen.queryByText('Operational items')).not.toBeInTheDocument();
    expect(screen.queryByText('Pending attention')).not.toBeInTheDocument();
    expect(screen.queryByText('Queue items')).not.toBeInTheDocument();
    expect(screen.queryByText('Blocked / attention')).not.toBeInTheDocument();
    expect(screen.queryByText('Refund amount')).not.toBeInTheDocument();
  });

  it('projects raw operational identifiers into readable dashboard history copy', async () => {
    getDashboardOverviewMock.mockResolvedValue({
      ...dashboardOverview,
      recentActivity: [
        'alloc-sporjinal-7637649883473 is awaiting shipment for Shopify order ##1061: 75h awaiting shipment',
        'return-request-23165600081-sporjinal-20393734144337 is requested against refund',
      ],
    });
    listNotificationsMock.mockResolvedValue({
      summary: {
        total: 1,
        unread: 1,
        critical: 0,
        high: 1,
        warning: 0,
      },
      notifications: [
        {
          ...notification,
          id: 'notif-raw-signal',
          signalId: 'signal-fulfillment-stale-awaiting-shipment-sporjinal-1061',
          title: 'signal-fulfillment-stale-awaiting-shipment',
          message: 'alloc-sporjinal-7637649883473 is awaiting shipment for Shopify order ##1061 after 75h.',
          severity: 'high',
          metadata: {
            signalSourceArea: 'FULFILLMENT_STALE',
          },
        },
      ],
    });

    renderDashboardPage();

    expect((await screen.findAllByText('Shipment awaiting fulfillment')).length).toBeGreaterThan(0);
    expect(screen.getByText('Return review requested')).toBeInTheDocument();
    expect((await screen.findAllByText('Fulfillment progress delayed')).length).toBeGreaterThan(0);
    expect(screen.queryByText(/alloc-sporjinal/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/return-request-23165600081/i)).not.toBeInTheDocument();
    expect(screen.queryByText('signal-fulfillment-stale-awaiting-shipment')).not.toBeInTheDocument();
    expect(screen.getByText('Internal reference')).toBeInTheDocument();
    expect(screen.getByText('Signal signal-fulfillment-stale-awaiting-shipment-sporjinal-1061')).toBeInTheDocument();
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
