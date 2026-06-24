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

vi.mock('../features/support/api', async () => {
  const actual = await vi.importActual<typeof import('../features/support/api')>('../features/support/api');
  return {
    ...actual,
    addAdminSupportTicketNote: vi.fn(),
    addAdminSupportTicketReply: vi.fn(),
    addVendorSupportTicketReply: vi.fn(),
    assignAdminSupportTicketToSelf: vi.fn(),
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
