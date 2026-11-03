import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AutomationPage } from './AutomationPage';
import { setCurrentUser, setCurrentVendorId, setToken } from '../lib/auth';
import type { AutomationDashboard } from '../lib/api/contracts';

const getAutomationDashboardMock = vi.fn<() => Promise<AutomationDashboard>>();

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function vendorDashboard(vendor: string): AutomationDashboard {
  return { alerts: [{ id: `alert-${vendor}`, type: 'Warning', message: `${vendor} only alert`,
    status: 'New', timestamp: '2026-05-13T10:00:00.000Z', source: 'Allocation monitor' }], suggestions: [] };
}

function enableTwoVendors() {
  setCurrentUser({
    email: 'admin@demo.com', name: 'Demo Admin', role: 'admin',
    vendorAccess: ['demo-vendor-a', 'demo-vendor-b'],
    vendorDetails: [
      { vendorId: 'demo-vendor-a', vendorName: 'Demo Vendor A' },
      { vendorId: 'demo-vendor-b', vendorName: 'Demo Vendor B' },
    ],
    canSwitchVendors: true, defaultVendorId: 'demo-vendor-a',
  });
}

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
    setCurrentVendorId('demo-vendor-a');
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
    expect(await screen.findByText('Return request is overdue.')).toBeInTheDocument();
    expect(screen.queryByText('Resolved automation history item.')).not.toBeInTheDocument();
  });

  it('projects raw automation signal keys into readable alert copy', async () => {
    getAutomationDashboardMock.mockResolvedValue({
      ...automationDashboard,
      alerts: [
        {
          id: 'signal-fulfillment-stale-awaiting-shipment-sporjinal-1061',
          type: 'Critical',
          message: 'signal-fulfillment-stale-awaiting-shipment',
          status: 'New',
          timestamp: '2026-05-13T10:00:00.000Z',
          source: 'signal-fulfillment-stale-awaiting-shipment',
        },
      ],
    });

    renderAutomationPage();

    expect(await screen.findByRole('heading', { name: 'Fulfillment progress delayed' })).toBeInTheDocument();
    expect(screen.getByText('A shipment has not progressed within the expected window.')).toBeInTheDocument();
    expect(screen.getByText('Fulfillment Stale Awaiting Shipment')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'signal-fulfillment-stale-awaiting-shipment' })).not.toBeInTheDocument();
    expect(screen.getAllByText('Internal reference').length).toBeGreaterThan(0);
    expect(screen.getByText('signal-fulfillment-stale-awaiting-shipment-sporjinal-1061')).toBeInTheDocument();
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

  it('hides a loaded Vendor A alert while Vendor B loads and after B fails', async () => {
    enableTwoVendors();
    const pendingB = deferred<AutomationDashboard>();
    getAutomationDashboardMock.mockResolvedValueOnce(vendorDashboard('Vendor A'))
      .mockImplementationOnce(() => pendingB.promise);
    renderAutomationPage();
    expect(await screen.findByText('Vendor A only alert')).toBeInTheDocument();

    act(() => setCurrentVendorId('demo-vendor-b'));
    await waitFor(() => expect(getAutomationDashboardMock).toHaveBeenCalledTimes(2));
    expect(screen.getByText('Demo Vendor B alerts and actions workspace')).toBeInTheDocument();
    expect(screen.queryByText('Vendor A only alert')).not.toBeInTheDocument();
    await act(async () => pendingB.reject(new Error('Vendor B request failed')));
    expect(screen.queryByText('Vendor A only alert')).not.toBeInTheDocument();
    expect(await screen.findByText('Automation unavailable')).toBeInTheDocument();
  });

  it('rejects a delayed A response across A → B → A and retains disabled actions', async () => {
    enableTwoVendors();
    const oldA = deferred<AutomationDashboard>();
    const pendingB = deferred<AutomationDashboard>();
    const currentA = deferred<AutomationDashboard>();
    getAutomationDashboardMock.mockImplementationOnce(() => oldA.promise)
      .mockImplementationOnce(() => pendingB.promise)
      .mockImplementationOnce(() => currentA.promise);
    renderAutomationPage();
    await waitFor(() => expect(getAutomationDashboardMock).toHaveBeenCalledTimes(1));

    act(() => setCurrentVendorId('demo-vendor-b'));
    await waitFor(() => expect(getAutomationDashboardMock).toHaveBeenCalledTimes(2));
    await act(async () => pendingB.resolve(vendorDashboard('Vendor B')));
    expect(await screen.findByText('Vendor B only alert')).toBeInTheDocument();

    act(() => setCurrentVendorId('demo-vendor-a'));
    await waitFor(() => expect(getAutomationDashboardMock).toHaveBeenCalledTimes(3));
    expect(screen.queryByText('Vendor B only alert')).not.toBeInTheDocument();
    await act(async () => oldA.resolve(vendorDashboard('Old Vendor A')));
    expect(screen.queryByText('Old Vendor A only alert')).not.toBeInTheDocument();
    await act(async () => currentA.resolve(vendorDashboard('Current Vendor A')));
    expect(await screen.findByText('Current Vendor A only alert')).toBeInTheDocument();
    expect(screen.queryByText('Old Vendor A only alert')).not.toBeInTheDocument();
  });

  it('does not request Automation data without a selected Vendor', async () => {
    setCurrentUser({ email: 'admin@demo.com', name: 'Demo Admin', role: 'admin', vendorAccess: [],
      vendorDetails: [], canSwitchVendors: true, defaultVendorId: '' });
    setCurrentVendorId('');
    renderAutomationPage();
    expect(screen.queryByText('Vendor A only alert')).not.toBeInTheDocument();
    expect(getAutomationDashboardMock).not.toHaveBeenCalled();
  });
});
