import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setCurrentUser, setCurrentVendorId, setToken } from '../lib/auth';
import type { SupportAnalytics } from '../lib/api/contracts';

const getAdminSupportAnalyticsMock = vi.hoisted(() => vi.fn<() => Promise<SupportAnalytics>>());

vi.mock('../features/support/api', () => ({
  getAdminSupportAnalytics: getAdminSupportAnalyticsMock,
}));

import { AdminSupportAnalyticsPage } from './AdminSupportAnalyticsPage';

function buildAnalytics(overrides: Partial<SupportAnalytics> = {}): SupportAnalytics {
  return {
    generatedAt: '2026-06-08T10:00:00.000Z',
    kpis: {
      openTickets: 4,
      overdueTickets: 1,
      avgFirstResponseHours: 2,
      avgResolutionHours: 6,
      waitingOnVendor: 1,
      resolvedToday: 2,
    },
    trends: [
      { date: '2026-06-02', created: 2, resolved: 1, overdue: 0 },
      { date: '2026-06-03', created: 0, resolved: 0, overdue: 1 },
    ],
    slaInsights: {
      overdueTickets: 1,
      overduePercent: 25,
      avgResponseDelayHours: 3,
      avgResolutionHours: 7,
      breachesByCategory: [{ category: 'RETURN', overdueCount: 1 }],
    },
    vendorInsights: [
      {
        vendorId: 'vendor-a',
        vendorName: 'Vendor A',
        ticketCount: 4,
        unresolvedCount: 2,
        overdueCount: 1,
        overduePercent: 25,
        avgResolutionHours: 8,
        needsAttention: true,
      },
    ],
    categoryInsights: [
      {
        category: 'RETURN',
        ticketCount: 4,
        overdueCount: 1,
        overduePercent: 25,
        avgResolutionHours: 9,
      },
    ],
    assignmentInsights: [
      {
        assigneeName: 'Admin User',
        ticketCount: 4,
        overdueCount: 1,
        avgFirstResponseHours: 2,
        unassignedOpenTickets: 0,
      },
    ],
    ...overrides,
  };
}

function renderAnalyticsPage(analytics: SupportAnalytics) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
  getAdminSupportAnalyticsMock.mockResolvedValueOnce(analytics);

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/admin/support/analytics']}>
        <AdminSupportAnalyticsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AdminSupportAnalyticsPage readability', () => {
  beforeEach(() => {
    window.localStorage.clear();
    setToken('test-token');
    setCurrentUser({
      email: 'admin@demo.com',
      name: 'Demo Admin',
      role: 'admin',
      vendorAccess: ['vendor-a'],
      vendorDetails: [{ vendorId: 'vendor-a', vendorName: 'Vendor A' }],
      canSwitchVendors: false,
      defaultVendorId: 'vendor-a',
    });
    setCurrentVendorId('vendor-a');
    getAdminSupportAnalyticsMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders retained support analytics sections with desktop table structure', async () => {
    const { container } = renderAnalyticsPage(buildAnalytics());

    expect(await screen.findByText('Support mix')).toBeInTheDocument();
    expect(screen.getByText('Based on the latest 1000 support tickets.')).toBeInTheDocument();
    await waitFor(() => {
      expect(container.querySelector('.support-analytics-category-table')).not.toBeNull();
    });

    const categoryTable = container.querySelector('.support-analytics-category-table');

    expect(categoryTable).not.toBeNull();
    expect(categoryTable?.querySelectorAll('td')).toHaveLength(0);
    expect(categoryTable?.querySelector('.op-table-row')?.children).toHaveLength(5);

    expect(within(categoryTable as HTMLElement).getByText('Total tickets')).toBeInTheDocument();
    expect(within(categoryTable as HTMLElement).getByText('Overdue %')).toBeInTheDocument();
    expect(screen.getByText('Response health')).toBeInTheDocument();
    expect(screen.getByText('Avg overdue age')).toBeInTheDocument();
    expect(screen.queryByText('Avg delay')).not.toBeInTheDocument();
    expect(screen.getByText('Last 7 days')).toBeInTheDocument();
    expect(screen.getByText('Vendors with elevated support load')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Overdue tickets/i })).toHaveAttribute('href', '/admin/support?filter=overdue');
    expect(screen.getByRole('link', { name: /Waiting on vendor/i })).toHaveAttribute('href', '/admin/support?filter=waiting_vendor');
    expect(screen.queryByText('Operational support load')).not.toBeInTheDocument();
    expect(screen.queryByText('Workload')).not.toBeInTheDocument();
    expect(screen.queryByText('Assignee')).not.toBeInTheDocument();
    expect(screen.queryByText('Unassigned open')).not.toBeInTheDocument();
  });

  it('hides empty avg resolution fields and omits all-zero trends', async () => {
    const { container } = renderAnalyticsPage(buildAnalytics({
      kpis: {
        openTickets: 0,
        overdueTickets: 0,
        avgFirstResponseHours: 2,
        avgResolutionHours: null,
        waitingOnVendor: 0,
        resolvedToday: 0,
      },
      trends: [
        { date: '2026-06-02', created: 0, resolved: 0, overdue: 0 },
        { date: '2026-06-03', created: 0, resolved: 0, overdue: 0 },
      ],
      slaInsights: {
        overdueTickets: 0,
        overduePercent: 0,
        avgResponseDelayHours: 3,
        avgResolutionHours: null,
        breachesByCategory: [],
      },
      vendorInsights: [
        {
          vendorId: 'vendor-a',
          vendorName: 'Vendor A',
          ticketCount: 0,
          unresolvedCount: 0,
          overdueCount: 0,
          overduePercent: 0,
          avgResolutionHours: null,
          needsAttention: false,
        },
      ],
      categoryInsights: [
        {
          category: 'RETURN',
          ticketCount: 0,
          overdueCount: 0,
          overduePercent: 0,
          avgResolutionHours: null,
        },
      ],
    }));

    expect(await screen.findByText('Support mix')).toBeInTheDocument();
    await waitFor(() => {
      expect(container.querySelector('.support-analytics-category-table')).not.toBeNull();
    });

    expect(screen.queryByText('Last 7 days')).not.toBeInTheDocument();
    expect(screen.queryByText('No ticket activity in selected period.')).not.toBeInTheDocument();
    expect(screen.queryByText('Avg resolution')).not.toBeInTheDocument();
    expect(container.querySelector('.support-analytics-category-table .op-table-row')?.children).toHaveLength(4);
    expect(screen.queryByText('Operational support load')).not.toBeInTheDocument();
    expect(screen.queryByText('Workload')).not.toBeInTheDocument();
  });
});
