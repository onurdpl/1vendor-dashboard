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

  it('renders support analytics tables with desktop column structure', async () => {
    const { container } = renderAnalyticsPage(buildAnalytics({
      vendorInsights: [
        {
          vendorId: 'yalispor',
          vendorName: 'Yalı Spor',
          ticketCount: 4,
          unresolvedCount: 2,
          overdueCount: 1,
          overduePercent: 25,
          avgResolutionHours: 8,
          needsAttention: true,
        },
        {
          vendorId: 'vendor-42',
          vendorName: 'Acme Retail',
          ticketCount: 2,
          unresolvedCount: 1,
          overdueCount: 0,
          overduePercent: 0,
          avgResolutionHours: 4,
          needsAttention: false,
        },
      ],
    }));

    expect(await screen.findByText('Operational support load')).toBeInTheDocument();
    expect(screen.getByText('Based on the latest 1000 support tickets.')).toBeInTheDocument();
    await waitFor(() => {
      expect(container.querySelector('.support-analytics-vendor-table')).not.toBeNull();
    });

    const vendorTable = container.querySelector('.support-analytics-vendor-table');
    const categoryTable = container.querySelector('.support-analytics-category-table');
    const assignmentTable = container.querySelector('.support-analytics-assignment-table');

    expect(vendorTable).not.toBeNull();
    expect(categoryTable).not.toBeNull();
    expect(assignmentTable).not.toBeNull();
    expect(vendorTable?.querySelectorAll('td')).toHaveLength(0);
    expect(categoryTable?.querySelectorAll('td')).toHaveLength(0);
    expect(assignmentTable?.querySelectorAll('td')).toHaveLength(0);
    expect(vendorTable?.querySelector('.op-table-row')?.children).toHaveLength(6);
    expect(categoryTable?.querySelector('.op-table-row')?.children).toHaveLength(5);
    expect(assignmentTable?.querySelector('.op-table-row')?.children).toHaveLength(5);

    expect(within(vendorTable as HTMLElement).getByText('Vendor')).toBeInTheDocument();
    expect(within(vendorTable as HTMLElement).getByText('Total tickets')).toBeInTheDocument();
    expect(within(vendorTable as HTMLElement).getByText('Unresolved')).toBeInTheDocument();
    expect(within(vendorTable as HTMLElement).getByText('Overdue rate')).toBeInTheDocument();
    expect(within(vendorTable as HTMLElement).queryByText('Signal')).not.toBeInTheDocument();
    expect(within(categoryTable as HTMLElement).getByText('Total tickets')).toBeInTheDocument();
    expect(within(assignmentTable as HTMLElement).getByText('Total tickets')).toBeInTheDocument();
    expect(within(assignmentTable as HTMLElement).getByText('Unassigned open')).toBeInTheDocument();
    expect(within(assignmentTable as HTMLElement).queryByText('Open unassigned')).not.toBeInTheDocument();
    expect(screen.getByText('Avg overdue age')).toBeInTheDocument();
    expect(screen.queryByText('Avg delay')).not.toBeInTheDocument();
    expect(within(vendorTable as HTMLElement).getByText('Yalı Spor')).toBeInTheDocument();
    expect(within(vendorTable as HTMLElement).queryByText('yalispor')).not.toBeInTheDocument();
    expect(within(vendorTable as HTMLElement).getByText('Acme Retail')).toBeInTheDocument();
    expect(within(vendorTable as HTMLElement).getByText('vendor-42')).toBeInTheDocument();
  });

  it('hides empty avg resolution fields and replaces all-zero trends with an empty state', async () => {
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

    expect(await screen.findByText('No ticket activity in selected period.')).toBeInTheDocument();
    await waitFor(() => {
      expect(container.querySelector('.support-analytics-vendor-table')).not.toBeNull();
    });

    const trendsCard = screen.getByText('Last 7 days').closest('article');
    expect(trendsCard).not.toBeNull();
    expect(within(trendsCard as HTMLElement).queryByText('created')).not.toBeInTheDocument();
    expect(screen.queryByText('Avg resolution')).not.toBeInTheDocument();
    expect(container.querySelector('.support-analytics-vendor-table .op-table-row')?.children).toHaveLength(5);
    expect(container.querySelector('.support-analytics-category-table .op-table-row')?.children).toHaveLength(4);
  });
});
