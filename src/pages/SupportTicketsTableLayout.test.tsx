import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupportTicket } from '../lib/api/contracts';
import { setCurrentUser, setToken } from '../lib/auth';
import { AdminSupportTicketsPage } from './AdminSupportTicketsPage';
import { VendorSupportTicketsPage } from './VendorSupportTicketsPage';

const listAdminSupportTicketsMock = vi.fn<() => Promise<SupportTicket[]>>();
const listVendorSupportTicketsMock = vi.fn<() => Promise<SupportTicket[]>>();

vi.mock('../features/support/api', async () => {
  const actual = await vi.importActual<typeof import('../features/support/api')>('../features/support/api');
  return {
    ...actual,
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
  });

  it('renders admin support tickets as aligned grid cells instead of table-cell dumps', async () => {
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
    expect(within(row as HTMLElement).getByRole('link', { name: 'Open' })).toHaveAttribute(
      'href',
      '/admin/support/ticket-1',
    );
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
