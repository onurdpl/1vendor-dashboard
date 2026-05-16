import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  supportTicket: {
    create: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  supportTicketNote: {
    create: vi.fn(),
  },
  vendorAllocation: {
    findFirst: vi.fn(),
  },
  returnRecord: {
    findFirst: vi.fn(),
  },
  shipmentExecution: {
    findFirst: vi.fn(),
  },
}));

vi.mock('../backend/src/db/prisma.js', () => ({
  prisma: prismaMock,
}));

const {
  addAdminSupportTicketNote,
  createSupportTicket,
  getAdminSupportTicket,
  getVendorSupportTicket,
  listAdminSupportTickets,
  sanitizeSupportContextSnapshot,
  updateAdminSupportTicketStatus,
} = await import('../backend/src/modules/support/support.service.js');

const authUser = {
  id: 'user-vendor',
  email: 'vendor@example.com',
  name: 'Vendor User',
  role: 'vendor' as const,
  status: 'active',
};

const vendorContext = {
  vendorId: 'vendor-a',
  vendorName: 'Vendor A',
  role: 'vendor' as const,
  accessScope: 'vendor' as const,
};

function ticketRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ticket-1',
    createdAt: new Date('2026-05-16T10:00:00Z'),
    updatedAt: new Date('2026-05-16T10:00:00Z'),
    createdByUserId: 'user-vendor',
    createdByRole: 'vendor',
    vendorId: 'vendor-a',
    subject: 'Return help',
    message: 'Please review this return.',
    priority: 'normal',
    status: 'OPEN',
    category: 'RETURN',
    contextType: 'return',
    contextId: 'return-1',
    contextSnapshot: { route: '/returns/return-1' },
    resolvedAt: null,
    closedAt: null,
    vendor: { name: 'Vendor A' },
    notes: [],
    ...overrides,
  };
}

describe('support tickets', () => {
  beforeEach(() => {
    prismaMock.supportTicket.create.mockReset();
    prismaMock.supportTicket.findMany.mockReset();
    prismaMock.supportTicket.findFirst.mockReset();
    prismaMock.supportTicket.findUnique.mockReset();
    prismaMock.supportTicket.update.mockReset();
    prismaMock.supportTicketNote.create.mockReset();
    prismaMock.vendorAllocation.findFirst.mockReset();
    prismaMock.returnRecord.findFirst.mockReset();
    prismaMock.shipmentExecution.findFirst.mockReset();
  });

  it('lets a vendor create a support ticket from own return context', async () => {
    prismaMock.returnRecord.findFirst.mockResolvedValueOnce({ id: 'return-1' });
    prismaMock.supportTicket.create.mockResolvedValueOnce(ticketRecord());

    const result = await createSupportTicket(authUser, vendorContext, {
      subject: 'Return help',
      message: 'Please review this return.',
      priority: 'normal',
      contextType: 'return',
      contextId: 'return-1',
      vendorId: 'vendor-b',
      contextSnapshot: {
        route: '/returns/return-1',
        customerEmail: 'hidden@example.com',
        token: 'secret',
        orderNumber: '#1023',
      },
    } as Parameters<typeof createSupportTicket>[2] & { vendorId: string });

    expect(result.id).toBe('ticket-1');
    expect(prismaMock.supportTicket.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        createdByUserId: 'user-vendor',
        createdByRole: 'vendor',
        vendorId: 'vendor-a',
        status: 'OPEN',
        category: 'RETURN',
        contextType: 'return',
        contextId: 'return-1',
        contextSnapshot: {
          route: '/returns/return-1',
          orderNumber: '#1023',
        },
      }),
      include: {
        vendor: {
          select: { name: true },
        },
      },
    });
  });

  it('blocks vendor context spoofing against another vendor return', async () => {
    prismaMock.returnRecord.findFirst.mockResolvedValueOnce(null);

    await expect(createSupportTicket(authUser, vendorContext, {
      subject: 'Return help',
      message: 'Please review this return.',
      priority: 'normal',
      contextType: 'return',
      contextId: 'return-other',
    })).rejects.toThrow('Support context is not available for this vendor.');

    expect(prismaMock.supportTicket.create).not.toHaveBeenCalled();
  });

  it('sanitizes context snapshots before persistence', () => {
    expect(sanitizeSupportContextSnapshot({
      route: '/orders/order-1',
      status: 'Awaiting shipment',
      phone: '+15555555555',
      nested: {
        address: 'Hidden',
        safe: 'Visible',
      },
    })).toEqual({
      route: '/orders/order-1',
      status: 'Awaiting shipment',
      nested: {
        safe: 'Visible',
      },
    });
  });

  it('lets admins list all support tickets', async () => {
    prismaMock.supportTicket.findMany.mockResolvedValueOnce([
      ticketRecord({ id: 'ticket-2', priority: 'high' }),
    ]);

    const result = await listAdminSupportTickets();

    expect(result).toEqual([
      expect.objectContaining({
        id: 'ticket-2',
        vendorName: 'Vendor A',
        priority: 'high',
        status: 'OPEN',
        category: 'RETURN',
      }),
    ]);
    expect(prismaMock.supportTicket.findMany).toHaveBeenCalledWith({
      include: {
        vendor: {
          select: { name: true },
        },
      },
      orderBy: {
        updatedAt: 'desc',
      },
      take: 250,
    });
  });

  it('filters the admin queue by unresolved status and category', async () => {
    prismaMock.supportTicket.findMany.mockResolvedValueOnce([
      ticketRecord({ id: 'ticket-open', status: 'OPEN', category: 'RETURN', subject: 'Return help' }),
      ticketRecord({ id: 'ticket-closed', status: 'CLOSED', category: 'ORDER', subject: 'Order help' }),
    ]);

    const result = await listAdminSupportTickets({ unresolvedOnly: 'true', category: 'RETURN', search: 'return' });

    expect(result.map((ticket) => ticket.id)).toEqual(['ticket-open']);
  });

  it('updates lifecycle status and resolution timestamps', async () => {
    prismaMock.supportTicket.update.mockResolvedValueOnce(ticketRecord({
      status: 'RESOLVED',
      resolvedAt: new Date('2026-05-16T12:00:00Z'),
    }));

    const result = await updateAdminSupportTicketStatus('ticket-1', { status: 'RESOLVED' });

    expect(result.status).toBe('RESOLVED');
    expect(result.resolvedAt).toBe('2026-05-16T12:00:00.000Z');
    expect(prismaMock.supportTicket.update).toHaveBeenCalledWith({
      where: { id: 'ticket-1' },
      data: expect.objectContaining({
        status: 'RESOLVED',
        resolvedAt: expect.any(Date),
      }),
      include: expect.any(Object),
    });
  });

  it('stores admin-only internal notes', async () => {
    prismaMock.supportTicket.findUnique.mockResolvedValueOnce({ id: 'ticket-1' });
    prismaMock.supportTicketNote.create.mockResolvedValueOnce({
      id: 'note-1',
      supportTicketId: 'ticket-1',
      authorUserId: 'admin-1',
      authorName: 'Admin User',
      authorRole: 'admin',
      content: 'Investigating carrier status.',
      createdAt: new Date('2026-05-16T12:05:00Z'),
    });

    const result = await addAdminSupportTicketNote('ticket-1', {
      id: 'admin-1',
      email: 'admin@example.com',
      name: 'Admin User',
      role: 'admin',
      status: 'active',
    }, { content: 'Investigating carrier status.' });

    expect(result.content).toBe('Investigating carrier status.');
    expect(prismaMock.supportTicketNote.create).toHaveBeenCalledWith({
      data: {
        supportTicketId: 'ticket-1',
        authorUserId: 'admin-1',
        authorName: 'Admin User',
        authorRole: 'admin',
        content: 'Investigating carrier status.',
      },
    });
  });

  it('shows internal notes to admin detail but hides them from vendor detail', async () => {
    prismaMock.supportTicket.findUnique.mockResolvedValueOnce(ticketRecord({
      notes: [
        {
          id: 'note-1',
          supportTicketId: 'ticket-1',
          authorUserId: 'admin-1',
          authorName: 'Admin User',
          authorRole: 'admin',
          content: 'Internal investigation note.',
          createdAt: new Date('2026-05-16T12:05:00Z'),
        },
      ],
    }));
    prismaMock.supportTicket.findFirst.mockResolvedValueOnce(ticketRecord());

    const adminTicket = await getAdminSupportTicket('ticket-1');
    const vendorTicket = await getVendorSupportTicket('ticket-1', 'vendor-a');

    expect(adminTicket?.notes?.[0]?.content).toBe('Internal investigation note.');
    expect(vendorTicket?.notes).toBeUndefined();
  });
});
