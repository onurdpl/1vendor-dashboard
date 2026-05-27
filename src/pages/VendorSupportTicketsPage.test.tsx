import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupportTicket } from '../lib/api/contracts';
import { setCurrentUser, setToken } from '../lib/auth';
import { VendorSupportTicketsPage } from './VendorSupportTicketsPage';

const listVendorSupportTicketsMock = vi.fn<() => Promise<SupportTicket[]>>();

vi.mock('../features/support/api', async () => {
  const actual = await vi.importActual<typeof import('../features/support/api')>('../features/support/api');
  return {
    ...actual,
    listVendorSupportTickets: () => listVendorSupportTicketsMock(),
  };
});

function supportTicket(overrides: Partial<SupportTicket> = {}): SupportTicket {
  return {
    id: 'ticket-open',
    createdAt: '2026-05-15T09:00:00Z',
    updatedAt: '2026-05-15T10:00:00Z',
    createdByUserId: 'vendor-user-1',
    createdByRole: 'vendor',
    vendorId: 'demo-vendor-a',
    vendorName: 'Demo Vendor A',
    subject: 'Shipment tracking help',
    message: 'Please help with this shipment.',
    priority: 'normal',
    status: 'OPEN',
    category: 'SHIPMENT',
    assigneeUserId: null,
    assigneeName: null,
    vendorUnreadCount: 0,
    adminUnreadCount: 0,
    lastReplyAt: '2026-05-15T09:30:00Z',
    lastReplyByRole: 'VENDOR',
    firstResponseDueAt: '2026-05-16T09:00:00Z',
    nextResponseDueAt: null,
    escalatedAt: null,
    escalationReason: null,
    sla: null,
    contextType: 'order',
    contextId: 'alloc-1030',
    contextSummary: { orderNumber: '#1030', status: 'Awaiting shipment' },
    contextSnapshot: { orderNumber: '#1030' },
    resolvedAt: null,
    closedAt: null,
    notes: [],
    replies: [],
    ...overrides,
  };
}

function renderSupportPage(initialEntries = ['/support']) {
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
        <VendorSupportTicketsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('VendorSupportTicketsPage workflow filtering', () => {
  beforeEach(() => {
    cleanup();
    window.localStorage.clear();
    setToken('test-token');
    setCurrentUser({
      email: 'vendor@example.com',
      name: 'Vendor User',
      role: 'vendor',
      vendorAccess: ['demo-vendor-a'],
      vendorDetails: [{ vendorId: 'demo-vendor-a', vendorName: 'Demo Vendor A' }],
      canSwitchVendors: false,
      defaultVendorId: 'demo-vendor-a',
    });
    listVendorSupportTicketsMock.mockReset();
  });

  it('uses workflow query params to show open support issues and allows clearing', async () => {
    listVendorSupportTicketsMock.mockResolvedValue([
      supportTicket(),
      supportTicket({
        id: 'ticket-closed',
        subject: 'Closed support history',
        status: 'CLOSED',
        closedAt: '2026-05-15T11:00:00Z',
      }),
    ]);

    renderSupportPage(['/support?workflow=open-support-issues']);

    expect(await screen.findByLabelText('Active workflow filter')).toHaveTextContent('Open support issues');
    expect(await screen.findByText('Shipment tracking help')).toBeInTheDocument();
    expect(screen.queryByText('Closed support history')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Clear workflow' }));

    expect(await screen.findByText('Closed support history')).toBeInTheDocument();
  });

  it('renders an honest empty state for empty support workflow queues', async () => {
    listVendorSupportTicketsMock.mockResolvedValue([
      supportTicket({
        id: 'ticket-closed',
        subject: 'Closed support history',
        status: 'CLOSED',
        closedAt: '2026-05-15T11:00:00Z',
      }),
    ]);

    renderSupportPage(['/support?workflow=open-support-issues']);

    expect(await screen.findByText('No open support issues')).toBeInTheDocument();
    expect(screen.getByText('This workflow queue is clear. Clear the workflow to inspect all support history.')).toBeInTheDocument();
  });
});
