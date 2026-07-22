import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn((queries: Array<Promise<unknown>>) => Promise.all(queries)),
  supportTicket: {
    count: vi.fn(),
    create: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  supportTicketNote: {
    create: vi.fn(),
  },
  supportTicketReply: {
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
  addAdminSupportTicketReply,
  addVendorSupportTicketReply,
  buildSupportAnalytics,
  calculateSupportResponseDueAt,
  assignSupportTicketToSelf,
  createSupportTicket,
  deriveSupportSlaState,
  deriveSupportAttentionSeverity,
  getAdminSupportAnalytics,
  getAdminSupportTicket,
  getVendorSupportTicket,
  listAdminSupportAttentionTickets,
  listAdminSupportTickets,
  listVendorSupportTickets,
  sanitizeSupportContextSnapshot,
  unassignSupportTicket,
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
    vendor: { name: 'Vendor A' },
    notes: [],
    replies: [],
    ...overrides,
  };
}

describe('support tickets', () => {
  beforeEach(() => {
    prismaMock.supportTicket.create.mockReset();
    prismaMock.supportTicket.count.mockReset();
    prismaMock.supportTicket.findMany.mockReset();
    prismaMock.supportTicket.findFirst.mockReset();
    prismaMock.supportTicket.findUnique.mockReset();
    prismaMock.supportTicket.update.mockReset();
    prismaMock.supportTicket.updateMany.mockReset();
    prismaMock.supportTicketNote.create.mockReset();
    prismaMock.supportTicketReply.create.mockReset();
    prismaMock.$transaction.mockReset();
    prismaMock.$transaction.mockImplementation((queries: Array<Promise<unknown>>) => Promise.all(queries));
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
        firstResponseDueAt: expect.any(Date),
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

  it('lists support attention tickets with database filtering before pagination and authoritative total', async () => {
    const now = new Date('2026-05-17T12:00:00Z');
    prismaMock.supportTicket.count.mockResolvedValueOnce(23);
    prismaMock.supportTicket.findMany.mockResolvedValueOnce([
      ticketRecord({
        id: 'ticket-oldest-open',
        status: 'OPEN',
        priority: 'normal',
        updatedAt: new Date('2026-05-16T08:00:00Z'),
        firstResponseDueAt: new Date('2026-05-17T08:00:00Z'),
        contextType: 'order',
        contextId: 'order-1',
        contextSnapshot: { orderNumber: '#1001' },
      }),
      ticketRecord({
        id: 'ticket-high',
        status: 'IN_REVIEW',
        priority: 'high',
        updatedAt: new Date('2026-05-16T09:00:00Z'),
        firstResponseDueAt: new Date('2026-05-18T08:00:00Z'),
        vendorId: 'vendor-b',
        vendor: { name: 'Vendor B' },
      }),
    ]);

    const result = await listAdminSupportAttentionTickets({ limit: 2, offset: 20 }, now);

    expect(result.total).toBe(23);
    expect(result.limit).toBe(2);
    expect(result.offset).toBe(20);
    expect(result.sort).toBe('updatedAt_asc_id_asc');
    expect(result.items.map((ticket) => ticket.id)).toEqual(['ticket-oldest-open', 'ticket-high']);
    expect(result.items[0]).toEqual(expect.objectContaining({
      relatedOrderReference: '#1001',
      severity: 'critical',
      destinationPath: '/admin/support/ticket-oldest-open',
    }));
    expect(result.items[1]).toEqual(expect.objectContaining({
      vendorId: 'vendor-b',
      severity: 'critical',
      status: 'IN_REVIEW',
    }));
    expect(prismaMock.supportTicket.count).toHaveBeenCalledWith({
      where: {
        status: {
          in: ['OPEN', 'IN_REVIEW', 'WAITING_FOR_VENDOR'],
        },
      },
    });
    expect(prismaMock.supportTicket.findMany).toHaveBeenCalledWith({
      where: {
        status: {
          in: ['OPEN', 'IN_REVIEW', 'WAITING_FOR_VENDOR'],
        },
      },
      include: {
        vendor: {
          select: { name: true },
        },
      },
      orderBy: [
        { updatedAt: 'asc' },
        { id: 'asc' },
      ],
      skip: 20,
      take: 2,
    });
  });

  it('derives support attention severity from the canonical SLA helper inputs', () => {
    const overdue = deriveSupportSlaState({
      status: 'OPEN',
      firstResponseDueAt: new Date('2026-05-17T08:00:00Z'),
      nextResponseDueAt: null,
    }, new Date('2026-05-17T12:00:00Z'));
    const active = deriveSupportSlaState({
      status: 'IN_REVIEW',
      firstResponseDueAt: new Date('2026-05-18T08:00:00Z'),
      nextResponseDueAt: null,
    }, new Date('2026-05-17T12:00:00Z'));

    expect(deriveSupportAttentionSeverity({
      ageHours: 1,
      priority: 'normal',
      status: 'OPEN',
      sla: overdue,
    })).toBe('critical');
    expect(deriveSupportAttentionSeverity({
      ageHours: 2,
      priority: 'high',
      status: 'IN_REVIEW',
      sla: active,
    })).toBe('critical');
    expect(deriveSupportAttentionSeverity({
      ageHours: 25,
      priority: 'normal',
      status: 'WAITING_FOR_VENDOR',
      sla: active,
    })).toBe('warning');
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
        firstResponseDueAt: null,
        nextResponseDueAt: null,
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
      contextSnapshot: {
        route: '/returns/return-1',
        orderNumber: '#1023',
        reconciliationState: 'internal-review',
        lifecycleStatus: 'webhook-synced',
      },
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
      replies: [
        {
          id: 'reply-1',
          supportTicketId: 'ticket-1',
          authorUserId: 'admin-1',
          authorName: 'Admin User',
          authorRole: 'ADMIN',
          message: 'Public reply.',
          createdAt: new Date('2026-05-16T12:06:00Z'),
        },
      ],
    }));
    prismaMock.supportTicket.findFirst.mockResolvedValueOnce(ticketRecord({
      contextSnapshot: {
        route: '/returns/return-1',
        orderNumber: '#1023',
        reconciliationState: 'internal-review',
        lifecycleStatus: 'webhook-synced',
      },
      replies: [
        {
          id: 'reply-1',
          supportTicketId: 'ticket-1',
          authorUserId: 'admin-1',
          authorName: 'Admin User',
          authorRole: 'ADMIN',
          message: 'Public reply.',
          createdAt: new Date('2026-05-16T12:06:00Z'),
        },
      ],
    }));

    const adminTicket = await getAdminSupportTicket('ticket-1');
    const vendorTicket = await getVendorSupportTicket('ticket-1', 'vendor-a');

    expect(adminTicket?.notes?.[0]?.content).toBe('Internal investigation note.');
    expect(adminTicket?.replies?.[0]?.message).toBe('Public reply.');
    expect(adminTicket?.contextSnapshot).toEqual(expect.objectContaining({
      reconciliationState: 'internal-review',
      lifecycleStatus: 'webhook-synced',
    }));
    expect(adminTicket?.contextSummary).toEqual(expect.objectContaining({
      route: '/returns/return-1',
      orderNumber: '#1023',
    }));
    expect(vendorTicket?.notes).toBeUndefined();
    expect(vendorTicket?.replies?.[0]?.message).toBe('Public reply.');
    expect(vendorTicket).not.toHaveProperty('contextSnapshot');
    expect(vendorTicket?.contextSummary).toEqual(expect.objectContaining({
      route: '/returns/return-1',
      orderNumber: '#1023',
    }));
  });

  it('omits broad context snapshots from vendor support list responses', async () => {
    prismaMock.supportTicket.findMany.mockResolvedValueOnce([
      ticketRecord({
        contextSnapshot: {
          route: '/orders/order-1',
          orderNumber: '#1029',
          status: 'Awaiting shipment',
          trackingPresent: false,
          reconciliationState: 'internal-only',
          lifecycleStatus: 'admin-only',
        },
      }),
    ]);

    const result = await listVendorSupportTickets('vendor-a');

    expect(result).toHaveLength(1);
    expect(result[0]).not.toHaveProperty('contextSnapshot');
    expect(result[0]?.contextSummary).toEqual({
      route: '/orders/order-1',
      orderNumber: '#1029',
      status: 'Awaiting shipment',
      flags: {
        trackingPresent: false,
      },
    });
    expect(JSON.stringify(result[0])).not.toContain('internal-only');
    expect(JSON.stringify(result[0])).not.toContain('admin-only');
  });

  it('lets a vendor reply to own waiting ticket and moves it to review', async () => {
    prismaMock.supportTicket.findFirst.mockResolvedValueOnce({ id: 'ticket-1', status: 'WAITING_FOR_VENDOR' });
    prismaMock.supportTicketReply.create.mockResolvedValueOnce({
      id: 'reply-vendor',
      supportTicketId: 'ticket-1',
      authorUserId: 'user-vendor',
      authorName: 'Vendor User',
      authorRole: 'VENDOR',
      message: 'Here is the requested context.',
      createdAt: new Date('2026-05-16T12:10:00Z'),
    });
    prismaMock.supportTicket.update.mockResolvedValueOnce(ticketRecord({ status: 'IN_REVIEW' }));
    prismaMock.supportTicket.findFirst.mockResolvedValueOnce(ticketRecord({
      status: 'IN_REVIEW',
      replies: [
        {
          id: 'reply-vendor',
          supportTicketId: 'ticket-1',
          authorUserId: 'user-vendor',
          authorName: 'Vendor User',
          authorRole: 'VENDOR',
          message: 'Here is the requested context.',
          createdAt: new Date('2026-05-16T12:10:00Z'),
        },
      ],
    }));

    const result = await addVendorSupportTicketReply('ticket-1', 'vendor-a', authUser, {
      message: 'Here is the requested context.',
    });

    expect(result.status).toBe('IN_REVIEW');
    expect(result.replies?.[0]?.message).toBe('Here is the requested context.');
    expect(prismaMock.supportTicket.findFirst).toHaveBeenNthCalledWith(1, {
      where: { id: 'ticket-1', vendorId: 'vendor-a' },
      select: { id: true, status: true, priority: true, firstResponseDueAt: true, nextResponseDueAt: true },
    });
    expect(prismaMock.supportTicket.update).toHaveBeenCalledWith({
      where: { id: 'ticket-1' },
      data: expect.objectContaining({
        status: 'IN_REVIEW',
        nextResponseDueAt: expect.any(Date),
        adminUnreadCount: { increment: 1 },
        vendorUnreadCount: 0,
        lastReplyByRole: 'VENDOR',
        lastReplyAt: expect.any(Date),
      }),
    });
  });

  it('blocks vendor replies to another vendor ticket', async () => {
    prismaMock.supportTicket.findFirst.mockResolvedValueOnce(null);

    await expect(addVendorSupportTicketReply('ticket-1', 'vendor-b', authUser, {
      message: 'Trying to reply.',
    })).rejects.toThrow('Support ticket not found.');

    expect(prismaMock.supportTicketReply.create).not.toHaveBeenCalled();
  });

  it('lets admins reply to any open ticket', async () => {
    prismaMock.supportTicket.findUnique.mockResolvedValueOnce({ id: 'ticket-1', status: 'OPEN' });
    prismaMock.supportTicketReply.create.mockResolvedValueOnce({
      id: 'reply-admin',
      supportTicketId: 'ticket-1',
      authorUserId: 'admin-1',
      authorName: 'Admin User',
      authorRole: 'ADMIN',
      message: 'Can you send a photo?',
      createdAt: new Date('2026-05-16T12:12:00Z'),
    });
    prismaMock.supportTicket.update.mockResolvedValueOnce(ticketRecord({ status: 'WAITING_FOR_VENDOR' }));
    prismaMock.supportTicket.findUnique.mockResolvedValueOnce(ticketRecord({
      status: 'WAITING_FOR_VENDOR',
      replies: [
        {
          id: 'reply-admin',
          supportTicketId: 'ticket-1',
          authorUserId: 'admin-1',
          authorName: 'Admin User',
          authorRole: 'ADMIN',
          message: 'Can you send a photo?',
          createdAt: new Date('2026-05-16T12:12:00Z'),
        },
      ],
    }));

    const result = await addAdminSupportTicketReply('ticket-1', {
      id: 'admin-1',
      email: 'admin@example.com',
      name: 'Admin User',
      role: 'admin',
      status: 'active',
    }, { message: 'Can you send a photo?', status: 'WAITING_FOR_VENDOR' });

    expect(result.status).toBe('WAITING_FOR_VENDOR');
    expect(result.replies?.[0]?.authorRole).toBe('ADMIN');
    expect(prismaMock.supportTicketReply.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        supportTicketId: 'ticket-1',
        authorRole: 'ADMIN',
        message: 'Can you send a photo?',
      }),
    });
    expect(prismaMock.supportTicket.update).toHaveBeenCalledWith({
      where: { id: 'ticket-1' },
      data: expect.objectContaining({
        firstResponseDueAt: null,
        nextResponseDueAt: null,
        vendorUnreadCount: { increment: 1 },
        adminUnreadCount: 0,
        lastReplyByRole: 'ADMIN',
        lastReplyAt: expect.any(Date),
      }),
    });
  });

  it('marks admin unread as read only when admin opens detail', async () => {
    prismaMock.supportTicket.findUnique.mockResolvedValueOnce(ticketRecord({
      adminUnreadCount: 0,
      vendorUnreadCount: 2,
    }));

    const result = await getAdminSupportTicket('ticket-1');

    expect(result?.adminUnreadCount).toBe(0);
    expect(result?.vendorUnreadCount).toBe(2);
    expect(prismaMock.supportTicket.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'ticket-1',
        adminUnreadCount: { gt: 0 },
      },
      data: {
        adminUnreadCount: 0,
      },
    });
  });

  it('marks vendor unread as read only when vendor opens own detail', async () => {
    prismaMock.supportTicket.findFirst.mockResolvedValueOnce(ticketRecord({
      vendorUnreadCount: 0,
      adminUnreadCount: 3,
    }));

    const result = await getVendorSupportTicket('ticket-1', 'vendor-a');

    expect(result?.vendorUnreadCount).toBe(0);
    expect(result?.adminUnreadCount).toBe(3);
    expect(prismaMock.supportTicket.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'ticket-1',
        vendorId: 'vendor-a',
        vendorUnreadCount: { gt: 0 },
      },
      data: {
        vendorUnreadCount: 0,
      },
    });
  });

  it('blocks replies to closed tickets', async () => {
    prismaMock.supportTicket.findUnique.mockResolvedValueOnce({ id: 'ticket-1', status: 'CLOSED' });

    await expect(addAdminSupportTicketReply('ticket-1', {
      id: 'admin-1',
      email: 'admin@example.com',
      name: 'Admin User',
      role: 'admin',
      status: 'active',
    }, { message: 'Closed follow-up.' })).rejects.toThrow('Closed support tickets cannot receive replies.');

    expect(prismaMock.supportTicketReply.create).not.toHaveBeenCalled();
  });

  it('supports admin assignment and unassignment', async () => {
    prismaMock.supportTicket.update
      .mockResolvedValueOnce(ticketRecord({
        assigneeUserId: 'admin-1',
        assigneeName: 'Admin User',
      }))
      .mockResolvedValueOnce(ticketRecord());

    const assigned = await assignSupportTicketToSelf('ticket-1', {
      id: 'admin-1',
      email: 'admin@example.com',
      name: 'Admin User',
      role: 'admin',
      status: 'active',
    });
    const unassigned = await unassignSupportTicket('ticket-1');

    expect(assigned.assigneeName).toBe('Admin User');
    expect(unassigned.assigneeName).toBeNull();
    expect(prismaMock.supportTicket.update).toHaveBeenNthCalledWith(1, expect.objectContaining({
      data: {
        assigneeUserId: 'admin-1',
        assigneeName: 'Admin User',
      },
    }));
    expect(prismaMock.supportTicket.update).toHaveBeenNthCalledWith(2, expect.objectContaining({
      data: {
        assigneeUserId: null,
        assigneeName: null,
      },
    }));
  });

  it('calculates support response due dates from priority', () => {
    const base = new Date('2026-05-16T10:00:00Z');

    expect(calculateSupportResponseDueAt('high', base).toISOString()).toBe('2026-05-16T14:00:00.000Z');
    expect(calculateSupportResponseDueAt('normal', base).toISOString()).toBe('2026-05-17T10:00:00.000Z');
    expect(calculateSupportResponseDueAt('low', base).toISOString()).toBe('2026-05-18T10:00:00.000Z');
  });

  it('derives overdue SLA state for admin queues', () => {
    const result = deriveSupportSlaState({
      status: 'OPEN',
      firstResponseDueAt: new Date('2026-05-16T09:00:00Z'),
      nextResponseDueAt: null,
      escalatedAt: null,
      escalationReason: null,
    }, new Date('2026-05-16T12:00:00Z'));

    expect(result.isOverdue).toBe(true);
    expect(result.escalationLevel).toBe('overdue');
    expect(result.dueLabel).toBe('Overdue by 3h');
  });

  it('aggregates support analytics by SLA, vendor, category, and assignment', () => {
    const now = new Date('2026-05-16T12:00:00Z');
    const analytics = buildSupportAnalytics([
      ticketRecord({
        id: 'ticket-overdue',
        priority: 'high',
        category: 'RETURN',
        assigneeName: 'Admin User',
        firstResponseDueAt: new Date('2026-05-16T08:00:00Z'),
        replies: [
          {
            id: 'reply-admin',
            supportTicketId: 'ticket-overdue',
            authorUserId: 'admin-1',
            authorName: 'Admin User',
            authorRole: 'ADMIN',
            message: 'First response.',
            createdAt: new Date('2026-05-16T11:00:00Z'),
          },
        ],
      }),
      ticketRecord({
        id: 'ticket-resolved',
        status: 'RESOLVED',
        category: 'ORDER',
        vendorId: 'vendor-b',
        vendor: { name: 'Vendor B' },
        resolvedAt: new Date('2026-05-16T12:00:00Z'),
        replies: [
          {
            id: 'reply-admin-2',
            supportTicketId: 'ticket-resolved',
            authorUserId: 'admin-1',
            authorName: 'Admin User',
            authorRole: 'ADMIN',
            message: 'Resolved.',
            createdAt: new Date('2026-05-16T11:00:00Z'),
          },
        ],
      }),
    ], now);

    expect(analytics.kpis.openTickets).toBe(1);
    expect(analytics.kpis.overdueTickets).toBe(1);
    expect(analytics.kpis.avgFirstResponseHours).toBe(1);
    expect(analytics.kpis.resolvedToday).toBe(1);
    expect(analytics.categoryInsights.find((entry) => entry.category === 'RETURN')?.overdueCount).toBe(1);
    expect(analytics.vendorInsights.find((entry) => entry.vendorId === 'vendor-a')?.needsAttention).toBe(true);
    expect(analytics.assignmentInsights.find((entry) => entry.assigneeName === 'Admin User')?.overdueCount).toBe(1);
    expect(analytics.slaInsights.breachesByCategory).toEqual([{ category: 'RETURN', overdueCount: 1 }]);
  });

  it('loads admin support analytics from aggregate-safe fields', async () => {
    prismaMock.supportTicket.findMany.mockResolvedValueOnce([
      ticketRecord({ id: 'ticket-analytics' }),
    ]);

    const analytics = await getAdminSupportAnalytics();

    expect(analytics.kpis.openTickets).toBe(1);
    expect(prismaMock.supportTicket.findMany).toHaveBeenCalledWith({
      include: {
        vendor: {
          select: { name: true },
        },
        replies: {
          select: {
            authorRole: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 1000,
    });
  });
});
