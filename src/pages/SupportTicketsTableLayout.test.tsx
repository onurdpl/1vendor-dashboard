import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupportTicket } from '../lib/api/contracts';
import { setCurrentUser, setToken } from '../lib/auth';
import { AdminSupportTicketsPage } from './AdminSupportTicketsPage';
import { VendorSupportTicketsPage } from './VendorSupportTicketsPage';

const listAdminSupportTicketsMock = vi.fn<() => Promise<SupportTicket[]>>();
const listVendorSupportTicketsMock = vi.fn<() => Promise<SupportTicket[]>>();
const assignAdminSupportTicketToSelfMock = vi.fn<(ticketId: string) => Promise<SupportTicket>>();

vi.mock('../features/support/api', async () => {
  const actual = await vi.importActual<typeof import('../features/support/api')>('../features/support/api');
  return {
    ...actual,
    assignAdminSupportTicketToSelf: (ticketId: string) => assignAdminSupportTicketToSelfMock(ticketId),
    listAdminSupportTickets: () => listAdminSupportTicketsMock(),
    listVendorSupportTickets: () => listVendorSupportTicketsMock(),
  };
});

function supportTicket(overrides: Partial<SupportTicket> = {}): SupportTicket {
  return {
    id: 'ticket-1',
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
    vendorUnreadCount: 1,
    adminUnreadCount: 2,
    lastReplyAt: '2026-05-15T09:30:00Z',
    lastReplyByRole: 'VENDOR',
    firstResponseDueAt: '2026-05-16T09:00:00Z',
    nextResponseDueAt: null,
    escalatedAt: null,
    escalationReason: null,
    sla: {
      isOverdue: false,
      dueLabel: 'Due tomorrow',
      escalationLevel: 'none',
      dueAt: '2026-05-16T09:00:00Z',
      overdueByHours: null,
    },
    contextType: 'order',
    contextId: 'alloc-1030',
    contextSummary: { orderNumber: '#1030', status: 'Awaiting shipment' },
    contextSnapshot: { orderNumber: '#1030' },
    resolvedAt: null,
    closedAt: null,
    ...overrides,
  };
}

function renderPage(page: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{page}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('support ticket table layout', () => {
  beforeEach(() => {
    cleanup();
    window.localStorage.clear();
    setToken('test-token');
    listAdminSupportTicketsMock.mockReset();
    listVendorSupportTicketsMock.mockReset();
    assignAdminSupportTicketToSelfMock.mockReset();
  });

  it('renders admin support tickets as action-oriented rows instead of table-cell dumps', async () => {
    setCurrentUser({
      email: 'admin@example.com',
      name: 'Admin User',
      role: 'admin',
      vendorAccess: ['demo-vendor-a'],
      vendorDetails: [{ vendorId: 'demo-vendor-a', vendorName: 'Demo Vendor A' }],
      canSwitchVendors: true,
      defaultVendorId: 'demo-vendor-a',
    });
    listAdminSupportTicketsMock.mockResolvedValue([supportTicket()]);

    renderPage(<AdminSupportTicketsPage />);

    const table = await screen.findByText('Shipment tracking help');
    const row = table.closest('.op-table-row');

    expect(row).toBeTruthy();
    expect(row?.querySelectorAll(':scope > [role="cell"]')).toHaveLength(11);
    expect(row?.querySelector('td')).toBeNull();
    expect(screen.getByRole('button', { name: /All/i })).toHaveTextContent('1');
    expect(screen.getByRole('button', { name: /Needs Assignment/i })).toHaveTextContent('1');
    expect(screen.getByRole('button', { name: /Needs Admin Response/i })).toHaveTextContent('1');
    expect(screen.getByRole('button', { name: /Escalated/i })).toHaveTextContent('0');
    expect(screen.getByRole('button', { name: /Overdue/i })).toHaveTextContent('0');
    expect(screen.getByRole('button', { name: /Waiting on Vendor/i })).toHaveTextContent('0');
    expect(screen.getByRole('button', { name: /Resolved/i })).toHaveTextContent('0');
    expect(within(row as HTMLElement).getByText('Order #1030')).toBeInTheDocument();
    expect(within(row as HTMLElement).getByText('Workflow')).toBeInTheDocument();
    expect(within(row as HTMLElement).getByText('SLA')).toBeInTheDocument();
    expect(within(row as HTMLElement).getAllByText('Needs assignment').length).toBeGreaterThan(0);
    expect(within(row as HTMLElement).getByRole('link', { name: 'Open' })).toHaveAttribute(
      'href',
      '/admin/support/ticket-1',
    );
  });

  it('filters by support workflow tabs and assigns tickets inline', async () => {
    const user = userEvent.setup();
    const baseTicket = supportTicket({
      adminUnreadCount: 0,
      lastReplyByRole: 'ADMIN',
      lastReplyAt: '2026-05-15T09:30:00Z',
    });
    assignAdminSupportTicketToSelfMock.mockResolvedValue({
      ...baseTicket,
      assigneeUserId: 'admin-user',
      assigneeName: 'Admin User',
    });
    setCurrentUser({
      email: 'admin@example.com',
      name: 'Admin User',
      role: 'admin',
      vendorAccess: ['demo-vendor-a'],
      vendorDetails: [{ vendorId: 'demo-vendor-a', vendorName: 'Demo Vendor A' }],
      canSwitchVendors: true,
      defaultVendorId: 'demo-vendor-a',
    });
    listAdminSupportTicketsMock.mockResolvedValue([
      baseTicket,
      supportTicket({
        id: 'ticket-2',
        subject: 'Vendor reply waiting',
        status: 'OPEN',
        adminUnreadCount: 3,
        lastReplyByRole: 'VENDOR',
        assigneeUserId: 'admin-user',
        assigneeName: 'Admin User',
      }),
      supportTicket({
        id: 'ticket-3',
        subject: 'Escalated support case',
        status: 'IN_REVIEW',
        escalatedAt: '2026-05-15T11:00:00Z',
        escalationReason: 'Vendor raised urgency.',
        assigneeUserId: 'admin-user',
        assigneeName: 'Admin User',
        adminUnreadCount: 0,
      }),
      supportTicket({
        id: 'ticket-4',
        subject: 'Overdue support case',
        status: 'IN_REVIEW',
        assigneeUserId: 'admin-user',
        assigneeName: 'Admin User',
        adminUnreadCount: 0,
        sla: {
          isOverdue: true,
          dueLabel: 'Overdue by 4h',
          escalationLevel: 'overdue',
          dueAt: '2026-05-15T06:00:00Z',
          overdueByHours: 4,
        },
      }),
      supportTicket({
        id: 'ticket-5',
        subject: 'Waiting vendor update',
        status: 'WAITING_FOR_VENDOR',
        assigneeUserId: 'admin-user',
        assigneeName: 'Admin User',
        adminUnreadCount: 0,
        lastReplyByRole: 'ADMIN',
      }),
      supportTicket({
        id: 'ticket-6',
        subject: 'Resolved support history',
        status: 'RESOLVED',
        resolvedAt: '2026-05-15T11:00:00Z',
        assigneeUserId: 'admin-user',
        assigneeName: 'Admin User',
        adminUnreadCount: 0,
      }),
    ]);

    renderPage(<AdminSupportTicketsPage />);

    expect(await screen.findByText('Shipment tracking help')).toBeInTheDocument();
    expect(screen.queryByLabelText('Quick filter')).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /Needs response/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /^Escalated$/i })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Search')).toBeInTheDocument();
    expect(screen.getByLabelText('Status')).toBeInTheDocument();
    expect(screen.getByLabelText('Category')).toBeInTheDocument();
    expect(screen.getByLabelText('Priority')).toBeInTheDocument();
    expect(screen.getByLabelText('Assignee')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Unresolved only/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Needs Assignment/i }));
    expect(await screen.findByText('Shipment tracking help')).toBeInTheDocument();
    expect(screen.queryByText('Vendor reply waiting')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Assign to me' }));

    expect(assignAdminSupportTicketToSelfMock).toHaveBeenCalledWith('ticket-1');

    await user.click(screen.getByRole('button', { name: /Needs Admin Response/i }));
    expect(await screen.findByText('Vendor reply waiting')).toBeInTheDocument();
    expect(screen.queryByText('Shipment tracking help')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Escalated/i }));
    expect(await screen.findByText('Escalated support case')).toBeInTheDocument();
    expect(screen.queryByText('Vendor reply waiting')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Overdue/i }));
    expect(await screen.findByText('Overdue support case')).toBeInTheDocument();
    expect(screen.queryByText('Escalated support case')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Waiting on Vendor/i }));
    expect(await screen.findByText('Waiting vendor update')).toBeInTheDocument();
    expect(screen.queryByText('Overdue support case')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Resolved/i }));
    expect(await screen.findByText('Resolved support history')).toBeInTheDocument();
    expect(screen.queryByText('Shipment tracking help')).not.toBeInTheDocument();
  });

  it('renders vendor support tickets as aligned grid cells instead of table-cell dumps', async () => {
    setCurrentUser({
      email: 'vendor@example.com',
      name: 'Vendor User',
      role: 'vendor',
      vendorAccess: ['demo-vendor-a'],
      vendorDetails: [{ vendorId: 'demo-vendor-a', vendorName: 'Demo Vendor A' }],
      canSwitchVendors: false,
      defaultVendorId: 'demo-vendor-a',
    });
    listVendorSupportTicketsMock.mockResolvedValue([supportTicket()]);

    renderPage(<VendorSupportTicketsPage />);

    const table = await screen.findByText('Shipment tracking help');
    const row = table.closest('.op-table-row');

    expect(row).toBeTruthy();
    expect(row?.querySelectorAll(':scope > [role="cell"]')).toHaveLength(6);
    expect(row?.querySelector('td')).toBeNull();
    expect(within(row as HTMLElement).getByText('ticket-1')).toBeInTheDocument();
  });
});
