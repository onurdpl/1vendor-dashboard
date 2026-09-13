import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupportTicket } from '../lib/api/contracts';
import { setCurrentUser, setToken } from '../lib/auth';
import { formatDateTime } from '../services/real/formatting';
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

  it('renders missing vendor context as a terminal state instead of loading support requests', async () => {
    setCurrentUser({
      email: 'vendor@example.com',
      name: 'Vendor User',
      role: 'vendor',
      vendorAccess: [],
      vendorDetails: [],
      canSwitchVendors: false,
      defaultVendorId: '',
    });
    listVendorSupportTicketsMock.mockResolvedValue([]);

    renderSupportPage();

    expect(await screen.findByText('Select vendor')).toBeInTheDocument();
    expect(screen.queryByText('Loading support requests')).not.toBeInTheDocument();
    expect(listVendorSupportTicketsMock).not.toHaveBeenCalled();
  });

  it('renders a compact vendor ticket table without exposing the route id', async () => {
    const user = userEvent.setup();
    const unreadTicket = supportTicket({
      id: 'cuid-unread-ticket',
      vendorUnreadCount: 2,
    });
    const waitingTicket = supportTicket({
      id: 'cuid-waiting-ticket',
      subject: 'Return details requested',
      message: 'The requested return photos are attached.',
      category: 'RETURN',
      status: 'WAITING_FOR_VENDOR',
      vendorUnreadCount: 0,
      lastReplyAt: null,
      lastReplyByRole: null,
    });
    listVendorSupportTicketsMock.mockResolvedValue([unreadTicket, waitingTicket]);

    renderSupportPage();

    const subjectLink = await screen.findByRole('link', { name: unreadTicket.subject });
    const table = subjectLink.closest('.op-table');
    const header = table?.querySelector('.op-table-head') as HTMLElement | null;
    const unreadRow = subjectLink.closest('.op-table-row') as HTMLElement;

    expect(screen.getByRole('heading', { name: 'Vendor Support Requests' })).toBeInTheDocument();
    expect(screen.queryByText('Track support requests submitted with order, return, and shipment context.')).not.toBeInTheDocument();
    expect(header).toBeTruthy();
    expect(within(header as HTMLElement).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual([
      'Subject',
      'Category',
      'Status',
      'Last reply',
      'Updated',
    ]);
    expect(subjectLink).toHaveAttribute('href', `/support/${unreadTicket.id}`);
    expect(screen.queryByText(unreadTicket.id)).not.toBeInTheDocument();
    expect(screen.queryByText(waitingTicket.id)).not.toBeInTheDocument();
    expect(within(unreadRow).getByText(unreadTicket.message)).toBeInTheDocument();
    expect(within(unreadRow).getByText('Shipment')).toBeInTheDocument();
    expect(within(unreadRow).getByText('Open')).toHaveClass('op-tone-attention');
    expect(within(unreadRow).getByText('2 unread')).toBeInTheDocument();
    expect(screen.getByText('Waiting For Vendor')).toHaveClass('op-tone-warning');
    expect(screen.getByText('No replies')).toBeInTheDocument();
    expect(within(unreadRow).getByText(formatDateTime(unreadTicket.updatedAt, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }))).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: 'Unread only' }));

    expect(screen.getByRole('link', { name: unreadTicket.subject })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: waitingTicket.subject })).not.toBeInTheDocument();
  });
});
