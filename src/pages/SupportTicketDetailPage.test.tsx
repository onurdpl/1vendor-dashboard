import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setCurrentUser, setToken } from '../lib/auth';
import type { SupportTicket } from '../lib/api/contracts';
import { SupportTicketDetailPage } from './SupportTicketDetailPage';

const getAdminSupportTicketMock = vi.fn<(ticketId: string) => Promise<SupportTicket>>();
const getVendorSupportTicketMock = vi.fn<(ticketId: string) => Promise<SupportTicket>>();
const assignAdminSupportTicketToSelfMock = vi.fn<() => Promise<SupportTicket>>();
const addVendorSupportTicketReplyMock = vi.fn<(ticketId: string, content: string) => Promise<SupportTicket>>();

vi.mock('../features/support/api', async () => {
  const actual = await vi.importActual<typeof import('../features/support/api')>('../features/support/api');
  return {
    ...actual,
    addAdminSupportTicketNote: vi.fn(),
    addAdminSupportTicketReply: vi.fn(),
    addVendorSupportTicketReply: (ticketId: string, content: string) => addVendorSupportTicketReplyMock(ticketId, content),
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
    addVendorSupportTicketReplyMock.mockReset();
  });

  it('renders compact ticket metadata without an operations summary', async () => {
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

    expect(await screen.findByRole('heading', { name: 'Return support' })).toBeInTheDocument();
    expect(screen.getByText('Ticket #ticket-1')).toBeInTheDocument();
    const metadata = screen.getByLabelText('Ticket metadata');
    expect(within(metadata).getByText('Business context')).toBeInTheDocument();
    expect(within(metadata).getByText('Order #1023')).toBeInTheDocument();
    expect(within(metadata).getByText('Vendor')).toBeInTheDocument();
    expect(within(metadata).getByText('Vendor A')).toBeInTheDocument();
    expect(within(metadata).getByText('Workflow')).toBeInTheDocument();
    expect(within(metadata).getByText('Open')).toBeInTheDocument();
    expect(within(metadata).getByText('Created')).toBeInTheDocument();
    expect(within(metadata).getByText(/May 16, 2026/)).toBeInTheDocument();
    expect(within(metadata).getByText('Priority')).toBeInTheDocument();
    expect(within(metadata).getByText('Normal')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Operations Summary' })).not.toBeInTheDocument();
    expect(document.querySelector('.support-command-grid')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Context summary' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Suggested next steps' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Unified activity' })).not.toBeInTheDocument();
    expect(screen.getAllByText('Admin reply required')).toHaveLength(1);
    expect(screen.queryByText('Owner required before investigation.')).not.toBeInTheDocument();
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

    expect(await screen.findByRole('heading', { name: 'Manage ticket' })).toBeInTheDocument();
    expect(screen.getAllByText('Admin User').length).toBeGreaterThan(0);
    expect(screen.getAllByText('67h overdue').length).toBeGreaterThan(0);
    expect(screen.getByText(/Status: Awaiting review/)).toBeInTheDocument();
    expect(screen.getByText(/Allocation: Active/)).toBeInTheDocument();
    expect(screen.getByLabelText('Reply template')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Internal notes' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add note' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Unassign' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark In Review' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Mark Waiting For Vendor' }).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Mark Resolved' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark Closed' })).toBeInTheDocument();
    const history = screen.getByText(/Activity history/).closest('details') as HTMLDetailsElement;
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

    const history = await screen.findByText(/Activity history/);
    await user.click(history);

    expect(screen.getByText('Support reply added')).toBeInTheDocument();
    expect(screen.getByText('Vendor reply added')).toBeInTheDocument();
    expect(screen.queryAllByText('Status Open')).toHaveLength(0);
    expect(screen.getAllByText(/Activity history/)).toHaveLength(1);
  });

  it('preserves resolution and closure evidence in collapsed activity history', async () => {
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
      status: 'CLOSED',
      resolvedAt: '2026-05-16T11:00:00.000Z',
      closedAt: '2026-05-16T12:00:00.000Z',
    }));

    renderPage('/admin/support/ticket-1');

    const history = await screen.findByText('Activity history (3 events)');
    expect((history.closest('details') as HTMLDetailsElement).open).toBe(false);
    expect(screen.getByText('Ticket resolved')).toBeInTheDocument();
    expect(screen.getByText('Ticket closed')).toBeInTheDocument();
  });

  it('keeps the conversation primary without dashboard reply metrics or a nested empty state', async () => {
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
      status: 'IN_REVIEW',
      replies: [
        {
          id: 'reply-vendor',
          supportTicketId: 'ticket-1',
          authorUserId: 'vendor-user',
          authorName: 'Vendor User',
          authorRole: 'VENDOR',
          message: 'Here is the requested context.',
          createdAt: '2026-05-16T11:00:00.000Z',
        },
      ],
    }));

    renderPage('/admin/support/ticket-1');

    const conversationHeading = await screen.findByRole('heading', { name: 'Public thread' });
    const conversation = conversationHeading.closest('article') as HTMLElement;
    expect(within(conversation).getByText('Please help with this return.')).toBeInTheDocument();
    expect(within(conversation).getByText('Here is the requested context.')).toBeInTheDocument();
    expect(screen.getAllByText('Admin reply required')).toHaveLength(1);
    expect(screen.queryByText('Unread messages')).not.toBeInTheDocument();
    expect(screen.queryByText('Last vendor reply')).not.toBeInTheDocument();
    expect(screen.queryByText('Last admin reply')).not.toBeInTheDocument();
    expect(document.querySelector('.support-conversation-summary')).not.toBeInTheDocument();
    expect(screen.queryByText('No replies yet')).not.toBeInTheDocument();
    expect(screen.queryByText('Public support replies will appear here.')).not.toBeInTheDocument();
  });

  it('keeps an empty public thread and vendor reply composer without passive support-review chrome', async () => {
    const user = userEvent.setup();
    setCurrentUser({
      email: 'vendor@example.com',
      name: 'Vendor User',
      role: 'vendor',
      vendorAccess: ['vendor-a'],
      vendorDetails: [{ vendorId: 'vendor-a', vendorName: 'Vendor A' }],
      canSwitchVendors: false,
      defaultVendorId: 'vendor-a',
    });
    const currentTicket = ticket();
    getVendorSupportTicketMock.mockResolvedValue(currentTicket);
    addVendorSupportTicketReplyMock.mockResolvedValueOnce(currentTicket);

    renderPage('/support/ticket-1');

    expect(await screen.findByText('Please help with this return.')).toBeInTheDocument();
    expect(screen.queryByText('No replies yet')).not.toBeInTheDocument();
    expect(screen.queryByText('Public support replies will appear here.')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Support review' })).not.toBeInTheDocument();
    expect(screen.queryByText('Support is reviewing this.')).not.toBeInTheDocument();

    await user.type(screen.getByPlaceholderText('Write a public reply...'), 'Vendor reply');
    await user.click(screen.getByRole('button', { name: 'Post reply' }));

    await waitFor(() => expect(addVendorSupportTicketReplyMock).toHaveBeenCalledWith('ticket-1', 'Vendor reply'));
  });

  it('keeps actionable waiting-for-vendor guidance near the conversation', async () => {
    setCurrentUser({
      email: 'vendor@example.com',
      name: 'Vendor User',
      role: 'vendor',
      vendorAccess: ['vendor-a'],
      vendorDetails: [{ vendorId: 'vendor-a', vendorName: 'Vendor A' }],
      canSwitchVendors: false,
      defaultVendorId: 'vendor-a',
    });
    getVendorSupportTicketMock.mockResolvedValueOnce(ticket({ status: 'WAITING_FOR_VENDOR' }));

    renderPage('/support/ticket-1');

    expect(await screen.findByText('Waiting for your reply.')).toBeInTheDocument();
    expect(screen.getAllByText('Vendor reply required')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Post reply' })).toBeDisabled();
    expect(screen.queryByRole('heading', { name: 'Support review' })).not.toBeInTheDocument();
  });

  it('does not project allocation, fulfillment, or a linked record for general profile correction context', async () => {
    setCurrentUser({
      email: 'vendor@example.com',
      name: 'Vendor User',
      role: 'vendor',
      vendorAccess: ['vendor-a'],
      vendorDetails: [{ vendorId: 'vendor-a', vendorName: 'Vendor A' }],
      canSwitchVendors: false,
      defaultVendorId: 'vendor-a',
    });
    getVendorSupportTicketMock.mockResolvedValueOnce(ticket({
      subject: 'Vendor profile correction',
      category: 'OTHER',
      contextType: 'general',
      contextId: 'vendor-a',
      contextSummary: { status: 'correction_requested' },
      contextSnapshot: { status: 'correction_requested' },
    }));

    renderPage('/support/ticket-1');

    const metadata = await screen.findByLabelText('Ticket metadata');
    expect(within(metadata).getByText('Vendor account issue')).toBeInTheDocument();
    expect(screen.queryByText('Allocation')).not.toBeInTheDocument();
    expect(screen.queryByText('Fulfillment')).not.toBeInTheDocument();
    expect(screen.queryByText('correction_requested')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Operational record' })).not.toBeInTheDocument();
  });

  it.each(['support', 'finance'] as const)('preserves the existing %s non-admin reply branch', async (role) => {
    setCurrentUser({
      email: `${role}@example.com`,
      name: `${role} User`,
      role,
      vendorAccess: ['vendor-a'],
      vendorDetails: [{ vendorId: 'vendor-a', vendorName: 'Vendor A' }],
      canSwitchVendors: false,
      defaultVendorId: 'vendor-a',
    });
    getVendorSupportTicketMock.mockResolvedValueOnce(ticket());

    renderPage('/support/ticket-1');

    expect(await screen.findByRole('button', { name: 'Post reply' })).toBeDisabled();
    expect(getVendorSupportTicketMock).toHaveBeenCalledWith('ticket-1');
    expect(screen.queryByRole('heading', { name: 'Manage ticket' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Audit Details' })).not.toBeInTheDocument();
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
