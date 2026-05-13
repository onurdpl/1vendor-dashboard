import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DashboardPage } from './DashboardPage';
import type { DashboardOverview } from '../lib/api/contracts';
import { setCurrentUser, setToken } from '../lib/auth';

const getDashboardOverviewMock = vi.fn<() => Promise<DashboardOverview>>();

vi.mock('../lib/api/dashboard', async () => {
  const actual = await vi.importActual<typeof import('../lib/api/dashboard')>('../lib/api/dashboard');
  return {
    ...actual,
    getDashboardOverview: () => getDashboardOverviewMock(),
  };
});

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
  recentActivity: ['ORD-A-1002 is delivered for Shopify order #1002'],
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

describe('DashboardPage command center', () => {
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
  });

  it('renders dashboard command center without duplicated operational signal sections', async () => {
    getDashboardOverviewMock.mockResolvedValue(dashboardOverview);

    renderDashboardPage();

    expect(await screen.findByRole('heading', { name: /demo vendor a command center/i })).toBeInTheDocument();
    expect(screen.getAllByText('Priority work')).toHaveLength(1);
    expect(screen.queryByText('Operational signals')).not.toBeInTheDocument();
    expect(screen.getByText('Diagnostics summary')).toBeInTheDocument();
    expect(screen.getByText('Operational health')).toBeInTheDocument();
    expect(screen.getByText('1 operational job is dead-letter ready.')).toBeInTheDocument();
  });
});
