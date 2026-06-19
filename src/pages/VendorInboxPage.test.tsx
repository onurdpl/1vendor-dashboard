import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VendorInboxPage } from './VendorInboxPage';

const listVendorSupportTicketsMock = vi.fn();
const listOrdersMock = vi.fn();
const listReturnsMock = vi.fn();
const getFinanceDashboardMock = vi.fn();

vi.mock('../lib/appReadiness', () => ({
  useAppReadiness: () => ({
    ready: true,
    currentVendor: {
      vendorId: 'demo-vendor-a',
      vendorName: 'Demo Vendor A',
    },
  }),
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
});
