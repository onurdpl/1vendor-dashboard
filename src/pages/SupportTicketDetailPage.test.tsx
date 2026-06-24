import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setCurrentUser, setToken } from '../lib/auth';
import type { SupportTicket } from '../lib/api/contracts';
import { SupportTicketDetailPage } from './SupportTicketDetailPage';

const getAdminSupportTicketMock = vi.fn<(ticketId: string) => Promise<SupportTicket>>();
const getVendorSupportTicketMock = vi.fn<(ticketId: string) => Promise<SupportTicket>>();
const assignAdminSupportTicketToSelfMock = vi.fn<() => Promise<SupportTicket>>();

vi.mock('../features/support/api', async () => {
  const actual = await vi.importActual<typeof import('../features/support/api')>('../features/support/api');
  return {
    ...actual,
    addAdminSupportTicketNote: vi.fn(),
    addAdminSupportTicketReply: vi.fn(),
    addVendorSupportTicketReply: vi.fn(),
    assignAdminSupportTicketToSelf: () => assignAdminSupportTicketToSelfMock(),
    getAdminSupportTicket: (ticketId: string) => getAdminSupportTicketMock(ticketId),
    getVendorSupportTicket: (ticketId: string) => getVendorSupportTicketMock(ticketId),
    unassignAdminSupportTicket: vi.fn(),
    updateAdminSupportTicketStatus: vi.fn(),
  };
});

function ticket(overrides: Partial<SupportTicket> = {}): SupportTicket {
  return {
    id: 'ticket-1',
    createdAt: '2026-05-16T10:00:00.000Z',
    updatedAt: '2026-05-16T10:00:00.000Z',
    createdByUserId: 'vendor-user',
    createdByRole: 'vendor',
    vendorId: 'vendor-a',
    vendorName: 'Vendor A',
    subject: 'Return support',
    message: 'Please help with this return.',
    priority: 'normal',
    status: 'OPEN',
    category: 'RETURN',
    assigneeUserId: null,
    assigneeName: null,
    vendorUnreadCount: 0,
    adminUnreadCount: 0,
    lastReplyAt: null,
    lastReplyByRole: null,
    firstResponseDueAt: null,
    nextResponseDueAt: null,
    escalatedAt: null,
    escalationReason: null,
    sla: null,
    contextType: 'return',
    contextId: 'return-1',
    contextSummary: {
      route: '/returns/return-1',
      orderNumber: '#1023',
      status: 'Awaiting review',
    },
    contextSnapshot: {
      route: '/returns/return-1',
      orderNumber: '#1023',
      status: 'Awaiting review',
      reconciliationState: 'internal-review',
      lifecycleStatus: 'webhook-synced',
    },
    resolvedAt: null,
    closedAt: null,
    notes: [],
    replies: [],
    ...overrides,
  };
}

function renderPage(path: string) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/support/:ticketId" element={<SupportTicketDetailPage />} />
          <Route path="/admin/support/:ticketId" element={<SupportTicketDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('SupportTicketDetailPage context visibility', () => {
  beforeEach(() => {
    cleanup();
    window.localStorage.clear();
    setToken('test-token');
    getAdminSupportTicketMock.mockReset();
    getVendorSupportTicketMock.mockReset();
    assignAdminSupportTicketToSelfMock.mockReset();
  });

  it('renders a consolidated operations summary instead of competing top-level blocks', async () => {
    setCurrentUser({
      email: 'admin@example.com',
      name: 'Admin User',
      role: 'admin',
      vendorAccess: ['vendor-a'],
      vendorDetails: [{ vendorId: 'vendor-a', vendorName: 'Vendor A' }],
      canSwitchVendors: true,
      defaultVendorId: 'vendor-a',
    });
    getAdminSupportTicketMock.mockResolvedValueOnce(ticket({
      adminUnreadCount: 1,
      lastReplyByRole: 'VENDOR',
    }));

    renderPage('/admin/support/ticket-1');

    expect(await screen.findByRole('heading', { name: 'Operations Summary' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Context summary' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Suggested next steps' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Unified activity' })).not.toBeInTheDocument();
    expect(screen.getAllByText('Admin reply required').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Owner required before investigation.').length).toBeGreaterThan(0);
    expect(screen.getByText('No investigation started.')).toBeInTheDocument();
  });

  it('renders assigned ownership, SLA summary, context links, and collapsed audit/history details', async () => {
    setCurrentUser({
      email: 'admin@example.com',
      name: 'Admin User',
      role: 'admin',
      vendorAccess: ['vendor-a'],
      vendorDetails: [{ vendorId: 'vendor-a', vendorName: 'Vendor A' }],
      canSwitchVendors: true,
      defaultVendorId: 'vendor-a',
    });
    getAdminSupportTicketMock.mockResolvedValueOnce(ticket({
      assigneeUserId: 'admin-1',
      assigneeName: 'Admin User',
      contextSnapshot: {
        route: '/returns/return-1',
        orderNumber: '#1023',
        status: 'Awaiting review',
        allocationStatus: 'Active',
        fulfillmentStatus: 'Awaiting Shipment',
        allocationId: 'alloc-vendor-a-1023',
      },
      firstResponseDueAt: '2026-05-16T12:00:00.000Z',
      sla: {
        isOverdue: true,
        dueLabel: '67h overdue',
        escalationLevel: 'overdue',
        dueAt: '2026-05-16T12:00:00.000Z',
        overdueByHours: 67,
      },
    }));

    renderPage('/admin/support/ticket-1');

    expect(await screen.findByText('Owned by')).toBeInTheDocument();
    expect(screen.getAllByText('Admin User').length).toBeGreaterThan(0);
    expect(screen.getAllByText('67h overdue').length).toBeGreaterThan(0);
    expect(screen.getByText(/Status: Awaiting review/)).toBeInTheDocument();
    expect(screen.getByText(/Allocation: Active/)).toBeInTheDocument();
    const history = screen.getAllByText(/Activity history/)[0].closest('details') as HTMLDetailsElement;
    const audit = screen.getByText('Audit Details').closest('details') as HTMLDetailsElement;
    expect(history.open).toBe(false);
    expect(audit.open).toBe(false);
    expect(screen.getByText('Raw context id')).toBeInTheDocument();
    expect(screen.getAllByText('return-1').length).toBeGreaterThan(0);
  });

  it('expands activity history without duplicated status projections', async () => {
    const user = userEvent.setup();
    setCurrentUser({
      email: 'admin@example.com',
      name: 'Admin User',
      role: 'admin',
      vendorAccess: ['vendor-a'],
      vendorDetails: [{ vendorId: 'vendor-a', vendorName: 'Vendor A' }],
      canSwitchVendors: true,
      defaultVendorId: 'vendor-a',
    });
    getAdminSupportTicketMock.mockResolvedValueOnce(ticket({
      replies: [
        {
          id: 'reply-admin',
          supportTicketId: 'ticket-1',
          authorUserId: 'admin-1',
          authorName: 'Admin User',
          authorRole: 'ADMIN',
          message: 'We are checking.',
          createdAt: '2026-05-16T10:30:00.000Z',
        },
        {
          id: 'reply-vendor',
          supportTicketId: 'ticket-1',
          authorUserId: 'vendor-user',
          authorName: 'Vendor User',
          authorRole: 'VENDOR',
          message: 'Thanks.',
          createdAt: '2026-05-16T11:00:00.000Z',
        },
      ],
    }));

    renderPage('/admin/support/ticket-1');

    const history = (await screen.findAllByText(/Activity history/))[0];
    await user.click(history);

    expect(screen.getByText('Support reply added')).toBeInTheDocument();
    expect(screen.getByText('Vendor reply added')).toBeInTheDocument();
    expect(screen.queryAllByText('Status Open')).toHaveLength(0);
  });

  it('shows suggested action buttons connected to the action panel', async () => {
    const user = userEvent.setup();
    const currentTicket = ticket();
    assignAdminSupportTicketToSelfMock.mockResolvedValueOnce({
      ...currentTicket,
      assigneeUserId: 'admin-1',
      assigneeName: 'Admin User',
    });
    setCurrentUser({
      email: 'admin@example.com',
      name: 'Admin User',
      role: 'admin',
      vendorAccess: ['vendor-a'],
      vendorDetails: [{ vendorId: 'vendor-a', vendorName: 'Vendor A' }],
      canSwitchVendors: true,
      defaultVendorId: 'vendor-a',
    });
    getAdminSupportTicketMock.mockResolvedValueOnce(currentTicket);

    renderPage('/admin/support/ticket-1');

    expect(await screen.findByText('Assign support ownership')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Assign to me' }));

    expect(assignAdminSupportTicketToSelfMock).toHaveBeenCalled();
  });

  it('projects waiting vendor conversation ownership', async () => {
    setCurrentUser({
      email: 'admin@example.com',
      name: 'Admin User',
      role: 'admin',
      vendorAccess: ['vendor-a'],
      vendorDetails: [{ vendorId: 'vendor-a', vendorName: 'Vendor A' }],
      canSwitchVendors: true,
      defaultVendorId: 'vendor-a',
    });
    getAdminSupportTicketMock.mockResolvedValueOnce(ticket({
      status: 'WAITING_FOR_VENDOR',
      assigneeUserId: 'admin-1',
      assigneeName: 'Admin User',
    }));

    renderPage('/admin/support/ticket-1');

    await waitFor(() => expect(screen.getAllByText('Waiting vendor response').length).toBeGreaterThan(0));
    expect(screen.getAllByText('Vendor reply required').length).toBeGreaterThan(0);
  });

  it('does not render arbitrary snapshot keys for vendors', async () => {
    setCurrentUser({
      email: 'vendor@example.com',
      name: 'Vendor User',
      role: 'vendor',
      vendorAccess: ['vendor-a'],
      vendorDetails: [{ vendorId: 'vendor-a', vendorName: 'Vendor A' }],
      canSwitchVendors: false,
      defaultVendorId: 'vendor-a',
    });
    getVendorSupportTicketMock.mockResolvedValueOnce(ticket());

    renderPage('/support/ticket-1');

    await waitFor(() => {
      expect(screen.getAllByText('#1023').length).toBeGreaterThan(0);
    });
    expect(screen.queryByText('internal-review')).not.toBeInTheDocument();
    expect(screen.queryByText('webhook-synced')).not.toBeInTheDocument();
    expect(screen.queryByText(/Reconciliation state/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Lifecycle status/i)).not.toBeInTheDocument();
  });

  it('keeps sanitized context visible for admins', async () => {
    setCurrentUser({
      email: 'admin@example.com',
      name: 'Admin User',
      role: 'admin',
      vendorAccess: ['vendor-a'],
      vendorDetails: [{ vendorId: 'vendor-a', vendorName: 'Vendor A' }],
      canSwitchVendors: true,
      defaultVendorId: 'vendor-a',
    });
    getAdminSupportTicketMock.mockResolvedValueOnce(ticket());

    renderPage('/admin/support/ticket-1');

    await waitFor(() => {
      expect(screen.getByText('internal-review')).toBeInTheDocument();
    });
    expect(screen.getByText('webhook-synced')).toBeInTheDocument();
    expect(screen.getAllByText('Order #1023').length).toBeGreaterThan(0);
  });

  it('renders assignment and escalation events when ticket data contains them', async () => {
    setCurrentUser({
      email: 'admin@example.com',
      name: 'Admin User',
      role: 'admin',
      vendorAccess: ['vendor-a'],
      vendorDetails: [{ vendorId: 'vendor-a', vendorName: 'Vendor A' }],
      canSwitchVendors: true,
      defaultVendorId: 'vendor-a',
    });
    getAdminSupportTicketMock.mockResolvedValueOnce(ticket({
      assigneeUserId: 'admin-1',
      assigneeName: 'Admin User',
      escalatedAt: '2026-05-16T11:00:00.000Z',
      escalationReason: 'Vendor dispute',
      sla: {
        isOverdue: false,
        dueLabel: 'Escalated',
        escalationLevel: 'escalated',
        dueAt: null,
        overdueByHours: null,
      },
    }));

    renderPage('/admin/support/ticket-1');

    expect(await screen.findByText('Assignment current')).toBeInTheDocument();
    expect(screen.getByText('Owner: Admin User')).toBeInTheDocument();
    expect(screen.getByText('Ticket escalated')).toBeInTheDocument();
    expect(screen.getAllByText('Vendor dispute').length).toBeGreaterThan(0);
  });

  it('lets admins insert editable public reply templates', async () => {
    setCurrentUser({
      email: 'admin@example.com',
      name: 'Admin User',
      role: 'admin',
      vendorAccess: ['vendor-a'],
      vendorDetails: [{ vendorId: 'vendor-a', vendorName: 'Vendor A' }],
      canSwitchVendors: true,
      defaultVendorId: 'vendor-a',
    });
    getAdminSupportTicketMock.mockResolvedValueOnce(ticket());

    renderPage('/admin/support/ticket-1');

    await screen.findByRole('heading', { name: 'Public thread' });
    await userEvent.selectOptions(screen.getByLabelText('Reply template'), 'Tracking required');

    expect(screen.getByPlaceholderText('Write a public reply...')).toHaveValue(
      'Hi, please add tracking information when the shipment is ready so we can keep the customer updated.',
    );
  });
});
