import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VendorInboxPage } from './VendorInboxPage';

const appReadinessOverride = vi.hoisted(() => ({
  value: {
	    status: 'ready',
	    ready: true,
	    authConfirmed: true,
	    authRestorePhase: 'confirmed',
	    sessionReady: true,
    vendorReady: true,
    unauthorized: false,
    token: 'test-token',
    currentUser: {
      email: 'vendor@demo.com',
      name: 'Vendor User',
      role: 'vendor',
      vendorAccess: ['demo-vendor-a'],
      vendorDetails: [{ vendorId: 'demo-vendor-a', vendorName: 'Demo Vendor A' }],
      canSwitchVendors: false,
      defaultVendorId: 'demo-vendor-a',
    },
    currentVendor: {
      vendorId: 'demo-vendor-a',
      vendorName: 'Demo Vendor A',
    },
  },
}));
const listVendorSupportTicketsMock = vi.fn();
const listOrdersMock = vi.fn();
const listReturnsMock = vi.fn();
const getFinanceDashboardMock = vi.fn();

vi.mock('../lib/appReadiness', () => ({
  useAppReadiness: () => appReadinessOverride.value,
}));

vi.mock('../features/support/api', () => ({
  listVendorSupportTickets: (...args: unknown[]) => listVendorSupportTicketsMock(...args),
}));

vi.mock('../features/orders/api', () => ({
  listOrders: (...args: unknown[]) => listOrdersMock(...args),
}));

vi.mock('../features/returns/api', () => ({
  listReturns: (...args: unknown[]) => listReturnsMock(...args),
}));

vi.mock('../features/finance/api', () => ({
  getFinanceDashboard: (...args: unknown[]) => getFinanceDashboardMock(...args),
}));

function renderVendorInboxPage() {
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
        <VendorInboxPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('VendorInboxPage', () => {
  beforeEach(() => {
    appReadinessOverride.value = {
	      status: 'ready',
	      ready: true,
	      authConfirmed: true,
	      authRestorePhase: 'confirmed',
	      sessionReady: true,
      vendorReady: true,
      unauthorized: false,
      token: 'test-token',
      currentUser: {
        email: 'vendor@demo.com',
        name: 'Vendor User',
        role: 'vendor',
        vendorAccess: ['demo-vendor-a'],
        vendorDetails: [{ vendorId: 'demo-vendor-a', vendorName: 'Demo Vendor A' }],
        canSwitchVendors: false,
        defaultVendorId: 'demo-vendor-a',
      },
      currentVendor: {
        vendorId: 'demo-vendor-a',
        vendorName: 'Demo Vendor A',
      },
    };
    listVendorSupportTicketsMock.mockResolvedValue([]);
    listOrdersMock.mockResolvedValue([]);
    listReturnsMock.mockResolvedValue([]);
    getFinanceDashboardMock.mockResolvedValue({
      summary: {},
      transactions: [],
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders communication metric scope metadata', async () => {
    renderVendorInboxPage();

    const actionLabel = await screen.findByText('Action needed');
    const actionCard = actionLabel.closest('.op-kpi');

    expect(actionCard).toHaveTextContent('Communication events requiring action');
    expect(actionCard).toHaveAttribute(
      'title',
      expect.stringContaining('Scope: Communication events. Time window: Current vendor feed.'),
    );
  });

  it('renders missing vendor context as a terminal state instead of loading forever', async () => {
    appReadinessOverride.value = {
      ...appReadinessOverride.value,
      status: 'missing_vendor_context',
      ready: false,
      vendorReady: false,
      currentVendor: {
        vendorId: '',
        vendorName: 'All vendors',
      },
    };

    renderVendorInboxPage();

    expect(await screen.findByText('Select vendor')).toBeInTheDocument();
    expect(screen.queryByText('Loading communication center')).not.toBeInTheDocument();
    expect(listVendorSupportTicketsMock).not.toHaveBeenCalled();
    expect(listOrdersMock).not.toHaveBeenCalled();
    expect(listReturnsMock).not.toHaveBeenCalled();
    expect(getFinanceDashboardMock).not.toHaveBeenCalled();
  });
});
