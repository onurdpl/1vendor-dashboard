import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AutomationPage } from './AutomationPage';
import { setCurrentUser, setToken } from '../lib/auth';
import type { AutomationDashboard } from '../lib/api/contracts';

const getAutomationDashboardMock = vi.fn<() => Promise<AutomationDashboard>>();

vi.mock('../features/automation/api', () => ({
  getAutomationDashboard: () => getAutomationDashboardMock(),
}));

function renderAutomationPage(initialEntries = ['/automation']) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={initialEntries}>
        <AutomationPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const automationDashboard: AutomationDashboard = {
  alerts: [
    {
      id: 'alert-1',
      type: 'Critical',
      message: 'Return request is overdue.',
      status: 'New',
      timestamp: '2026-05-13T10:00:00.000Z',
      source: 'Returns engine',
    },
  ],
  suggestions: [
    {
      title: 'Escalate vendor A overdue return',
      description: 'Notify the operations lead when a return remains in review too long.',
      actionLabel: 'Escalate',
    },
    {
      title: 'Prepare vendor A follow-up queue',
      description: 'Group unresolved alerts into a review queue for the support team.',
      actionLabel: 'Create queue',
    },
    {
      title: 'Summarize vendor A signals',
      description: 'Generate a compact snapshot of alerts for the shift handoff.',
      actionLabel: 'Summarize',
    },
  ],
};

describe('AutomationPage suggested actions', () => {
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
    getAutomationDashboardMock.mockReset();
    getAutomationDashboardMock.mockResolvedValue(automationDashboard);
  });

  it('marks legacy suggested actions as disabled future placeholders', async () => {
    renderAutomationPage();

    expect(await screen.findByRole('heading', { name: 'Suggested actions' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Escalate' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Create queue' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Summarize' })).toBeDisabled();
    expect(screen.getAllByText(/Action execution coming in a future phase/i).length).toBeGreaterThan(0);
  });

  it('uses workflow query params to show active automation issue context', async () => {
    getAutomationDashboardMock.mockResolvedValue({
      ...automationDashboard,
      alerts: [
        ...automationDashboard.alerts,
        {
          id: 'alert-resolved',
          type: 'Info',
          message: 'Resolved automation history item.',
          status: 'Resolved',
          timestamp: '2026-05-13T11:00:00.000Z',
          source: 'Automation engine',
        },
      ],
    });

    renderAutomationPage(['/automation?workflow=active-issue-groups']);

    expect(await screen.findByLabelText('Active workflow filter')).toHaveTextContent('Active automation issue groups');
    expect(screen.getByText('Return request is overdue.')).toBeInTheDocument();
    expect(screen.queryByText('Resolved automation history item.')).not.toBeInTheDocument();
  });

  it('renders an honest empty state for empty automation workflow queues', async () => {
    getAutomationDashboardMock.mockResolvedValue({
      ...automationDashboard,
      alerts: [
        {
          id: 'alert-resolved',
          type: 'Info',
          message: 'Resolved automation history item.',
          status: 'Resolved',
          timestamp: '2026-05-13T11:00:00.000Z',
          source: 'Automation engine',
        },
      ],
    });

    renderAutomationPage(['/automation?workflow=active-issue-groups']);

    expect(await screen.findByText('No active automation issue groups')).toBeInTheDocument();
    expect(screen.getByText('This workflow queue is clear. Clear the workflow to inspect passive automation history.')).toBeInTheDocument();
  });
});
