import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  supportTicket: {
    create: vi.fn(),
    findMany: vi.fn(),
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
  createSupportTicket,
  listAdminSupportTickets,
  sanitizeSupportContextSnapshot,
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
    status: 'open',
    contextType: 'return',
    contextId: 'return-1',
    contextSnapshot: { route: '/returns/return-1' },
    vendor: { name: 'Vendor A' },
    ...overrides,
  };
}

describe('support tickets', () => {
  beforeEach(() => {
    prismaMock.supportTicket.create.mockReset();
    prismaMock.supportTicket.findMany.mockReset();
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
      }),
    ]);
    expect(prismaMock.supportTicket.findMany).toHaveBeenCalledWith({
      include: {
        vendor: {
          select: { name: true },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 100,
    });
  });
});
