import { describe, expect, it, vi } from 'vitest';
import { registerSupportRoutes } from '../backend/src/modules/support/support.routes.js';

const prismaMock = vi.hoisted(() => ({
  vendor: {
    findUnique: vi.fn(),
  },
}));
const createSupportTicketMock = vi.hoisted(() => vi.fn());
const listAdminSupportTicketsMock = vi.hoisted(() => vi.fn());
const listAdminSupportAttentionTicketsMock = vi.hoisted(() => vi.fn());
const getAdminSupportAnalyticsMock = vi.hoisted(() => vi.fn());
const listVendorSupportTicketsMock = vi.hoisted(() => vi.fn());
const getAdminSupportTicketMock = vi.hoisted(() => vi.fn());
const getVendorSupportTicketMock = vi.hoisted(() => vi.fn());
const updateAdminSupportTicketStatusMock = vi.hoisted(() => vi.fn());
const addAdminSupportTicketNoteMock = vi.hoisted(() => vi.fn());
const addAdminSupportTicketReplyMock = vi.hoisted(() => vi.fn());
const addVendorSupportTicketReplyMock = vi.hoisted(() => vi.fn());
const assignSupportTicketToSelfMock = vi.hoisted(() => vi.fn());
const unassignSupportTicketMock = vi.hoisted(() => vi.fn());

vi.mock('../backend/src/modules/support/support.service.js', () => ({
  createSupportTicket: createSupportTicketMock,
  getAdminSupportAnalytics: getAdminSupportAnalyticsMock,
  addAdminSupportTicketNote: addAdminSupportTicketNoteMock,
  addAdminSupportTicketReply: addAdminSupportTicketReplyMock,
  addVendorSupportTicketReply: addVendorSupportTicketReplyMock,
  assignSupportTicketToSelf: assignSupportTicketToSelfMock,
  getAdminSupportTicket: getAdminSupportTicketMock,
  getVendorSupportTicket: getVendorSupportTicketMock,
  listAdminSupportAttentionTickets: listAdminSupportAttentionTicketsMock,
  listAdminSupportTickets: listAdminSupportTicketsMock,
  listVendorSupportTickets: listVendorSupportTicketsMock,
  unassignSupportTicket: unassignSupportTicketMock,
  updateAdminSupportTicketStatus: updateAdminSupportTicketStatusMock,
  SupportTicketError: class SupportTicketError extends Error {
    statusCode: number;

    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));

vi.mock('../backend/src/db/prisma.js', () => ({
  prisma: prismaMock,
}));

vi.mock('../backend/src/modules/auth/auth.service.js', () => ({
  createAuthService: vi.fn(() => ({})),
}));

vi.mock('../backend/src/modules/auth/auth.middleware.js', () => ({
  createAuthMiddleware: vi.fn(() => ({
    authenticateRequest: vi.fn(),
  })),
}));

vi.mock('../backend/src/modules/vendor-access/vendor-access.middleware.js', () => ({
  requireVendorAccess: vi.fn(),
}));

describe('support route contract', () => {
  it('creates support tickets with request vendor context', async () => {
    createSupportTicketMock.mockResolvedValueOnce({ id: 'ticket-1' });
    const posts = new Map<string, (request: unknown, reply: unknown) => unknown>();
    const app = {
      post: vi.fn((path: string, _options: unknown, handler: (request: unknown, reply: unknown) => unknown) => {
        posts.set(path, handler);
      }),
      get: vi.fn(),
    };

    registerSupportRoutes(app as never, {} as never);
    const response = await posts.get('/support/tickets')?.({
      authUser: { id: 'user-1', role: 'vendor' },
      vendorContext: { vendorId: 'vendor-a', vendorName: 'Vendor A' },
      body: { subject: 'Help', message: 'Need help', contextType: 'return', contextId: 'return-1' },
    }, {});

    expect(response).toEqual({ id: 'ticket-1' });
    expect(createSupportTicketMock).toHaveBeenCalledWith(
      { id: 'user-1', role: 'vendor' },
      { vendorId: 'vendor-a', vendorName: 'Vendor A' },
      { subject: 'Help', message: 'Need help', contextType: 'return', contextId: 'return-1' },
    );
  });

  it('creates admin vendor profile support tickets with route vendor context', async () => {
    createSupportTicketMock.mockClear();
    prismaMock.vendor.findUnique.mockReset();
    createSupportTicketMock.mockResolvedValueOnce({ id: 'ticket-admin-vendor' });
    prismaMock.vendor.findUnique.mockResolvedValueOnce({
      id: 'sporborsa',
      name: 'Sporborsa',
      status: 'inactive',
    });
    const posts = new Map<string, (request: unknown, reply: unknown) => unknown>();
    const app = {
      post: vi.fn((path: string, _options: unknown, handler: (request: unknown, reply: unknown) => unknown) => {
        posts.set(path, handler);
      }),
      get: vi.fn(),
    };

    registerSupportRoutes(app as never, {} as never);
    const response = await posts.get('/admin/vendors/:vendorId/support-tickets')?.({
      authUser: { id: 'admin-1', email: 'admin@example.test', role: 'admin' },
      params: { vendorId: 'sporborsa' },
      body: { subject: 'Profile correction', message: 'Review profile', priority: 'normal', contextType: 'general' },
    }, {});

    expect(response).toEqual({ id: 'ticket-admin-vendor' });
    expect(prismaMock.vendor.findUnique).toHaveBeenCalledWith({
      where: { id: 'sporborsa' },
      select: {
        id: true,
        name: true,
        status: true,
      },
    });
    expect(createSupportTicketMock).toHaveBeenCalledWith(
      { id: 'admin-1', email: 'admin@example.test', role: 'admin' },
      {
        vendorId: 'sporborsa',
        vendorName: 'Sporborsa',
        vendorStatus: 'inactive',
        role: 'admin',
        accessScope: 'admin',
      },
      { subject: 'Profile correction', message: 'Review profile', priority: 'normal', contextType: 'general' },
    );
  });

  it('blocks non-admin users from admin vendor profile support ticket creation', async () => {
    createSupportTicketMock.mockClear();
    prismaMock.vendor.findUnique.mockReset();
    const posts = new Map<string, (request: { authUser?: { role?: string } }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => unknown>();
    const app = {
      post: vi.fn((path: string, _options: unknown, handler: (request: { authUser?: { role?: string } }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => unknown) => {
        posts.set(path, handler);
      }),
      get: vi.fn(),
    };
    const reply = {
      code: vi.fn((status: number) => ({
        send: vi.fn((body: unknown) => ({ status, body })),
      })),
    };

    registerSupportRoutes(app as never, {} as never);
    const blocked = await posts.get('/admin/vendors/:vendorId/support-tickets')?.({
      authUser: { role: 'vendor' },
    }, reply);

    expect(blocked).toEqual({ status: 403, body: { message: 'Admin access required.' } });
    expect(prismaMock.vendor.findUnique).not.toHaveBeenCalled();
    expect(createSupportTicketMock).not.toHaveBeenCalled();
  });

  it('returns a safe not found error when an admin creates support for a missing route vendor', async () => {
    createSupportTicketMock.mockClear();
    prismaMock.vendor.findUnique.mockReset();
    prismaMock.vendor.findUnique.mockResolvedValueOnce(null);
    const posts = new Map<string, (request: { authUser?: { role?: string }; params: { vendorId: string } }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => unknown>();
    const app = {
      post: vi.fn((path: string, _options: unknown, handler: (request: { authUser?: { role?: string }; params: { vendorId: string } }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => unknown) => {
        posts.set(path, handler);
      }),
      get: vi.fn(),
    };
    const reply = {
      code: vi.fn((status: number) => ({
        send: vi.fn((body: unknown) => ({ status, body })),
      })),
    };

    registerSupportRoutes(app as never, {} as never);
    const missing = await posts.get('/admin/vendors/:vendorId/support-tickets')?.({
      authUser: { role: 'admin' },
      params: { vendorId: 'missing-vendor' },
    }, reply);

    expect(missing).toEqual({ status: 404, body: { message: 'Vendor not found.' } });
    expect(createSupportTicketMock).not.toHaveBeenCalled();
  });

  it('lists tickets for admins and blocks vendors', async () => {
    listAdminSupportTicketsMock.mockResolvedValueOnce([{ id: 'ticket-1' }]);
    const gets = new Map<string, (request: { authUser?: { role?: string } }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => unknown>();
    const app = {
      post: vi.fn(),
      get: vi.fn((path: string, _options: unknown, handler: (request: { authUser?: { role?: string } }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => unknown) => {
        gets.set(path, handler);
      }),
    };
    const reply = {
      code: vi.fn((status: number) => ({
        send: vi.fn((body: unknown) => ({ status, body })),
      })),
    };

    registerSupportRoutes(app as never, {} as never);
    const blocked = await gets.get('/admin/support/tickets')?.({ authUser: { role: 'vendor' } }, reply);
    const allowed = await gets.get('/admin/support/tickets')?.({ authUser: { role: 'admin' } }, reply);

    expect(blocked).toEqual({ status: 403, body: { message: 'Admin access required.' } });
    expect(allowed).toEqual([{ id: 'ticket-1' }]);
  });

  it('lists paginated support attention tickets for admins through the opt-in filter', async () => {
    listAdminSupportTicketsMock.mockClear();
    listAdminSupportAttentionTicketsMock.mockClear();
    listAdminSupportAttentionTicketsMock.mockResolvedValueOnce({ total: 21, items: [] });
    const gets = new Map<string, (request: { authUser?: { role?: string }; query?: unknown }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => unknown>();
    const app = {
      post: vi.fn(),
      get: vi.fn((path: string, _options: unknown, handler: (request: { authUser?: { role?: string }; query?: unknown }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => unknown) => {
        gets.set(path, handler);
      }),
    };
    const reply = {
      code: vi.fn((status: number) => ({
        send: vi.fn((body: unknown) => ({ status, body })),
      })),
    };

    registerSupportRoutes(app as never, {} as never);
    const allowed = await gets.get('/admin/support/tickets')?.({
      authUser: { role: 'admin' },
      query: { attention: 'true', limit: '20', offset: '20' },
    }, reply);

    expect(allowed).toEqual({ total: 21, items: [] });
    expect(listAdminSupportAttentionTicketsMock).toHaveBeenCalledWith({ limit: 20, offset: 20 });
    expect(listAdminSupportTicketsMock).not.toHaveBeenCalled();
  });

  it('rejects unsupported support attention filter values', async () => {
    listAdminSupportTicketsMock.mockClear();
    listAdminSupportAttentionTicketsMock.mockClear();
    const gets = new Map<string, (request: { authUser?: { role?: string }; query?: unknown }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => unknown>();
    const app = {
      post: vi.fn(),
      get: vi.fn((path: string, _options: unknown, handler: (request: { authUser?: { role?: string }; query?: unknown }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => unknown) => {
        gets.set(path, handler);
      }),
    };
    const reply = {
      code: vi.fn((status: number) => ({
        send: vi.fn((body: unknown) => ({ status, body })),
      })),
    };

    registerSupportRoutes(app as never, {} as never);
    const response = await gets.get('/admin/support/tickets')?.({
      authUser: { role: 'admin' },
      query: { attention: 'queue' },
    }, reply);

    expect(response).toEqual({ status: 400, body: { message: 'Unsupported support ticket attention filter.' } });
    expect(listAdminSupportAttentionTicketsMock).not.toHaveBeenCalled();
    expect(listAdminSupportTicketsMock).not.toHaveBeenCalled();
  });

  it('serves support analytics for admins only', async () => {
    getAdminSupportAnalyticsMock.mockResolvedValueOnce({ kpis: { openTickets: 1 } });
    const gets = new Map<string, (request: { authUser?: { role?: string } }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => unknown>();
    const app = {
      post: vi.fn(),
      get: vi.fn((path: string, _options: unknown, handler: (request: { authUser?: { role?: string } }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => unknown) => {
        gets.set(path, handler);
      }),
    };
    const reply = {
      code: vi.fn((status: number) => ({
        send: vi.fn((body: unknown) => ({ status, body })),
      })),
    };

    registerSupportRoutes(app as never, {} as never);
    const blocked = await gets.get('/admin/support/analytics')?.({ authUser: { role: 'vendor' } }, reply);
    const allowed = await gets.get('/admin/support/analytics')?.({ authUser: { role: 'admin' } }, reply);

    expect(blocked).toEqual({ status: 403, body: { message: 'Admin access required.' } });
    expect(allowed).toEqual({ kpis: { openTickets: 1 } });
  });

  it('registers vendor ticket list and detail without internal notes', async () => {
    listVendorSupportTicketsMock.mockResolvedValueOnce([{ id: 'ticket-1', notes: undefined }]);
    getVendorSupportTicketMock.mockResolvedValueOnce({ id: 'ticket-1', notes: undefined });
    const gets = new Map<string, (request: { vendorContext?: { vendorId?: string }; params?: { ticketId: string }; query?: unknown }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => unknown>();
    const app = {
      post: vi.fn(),
      get: vi.fn((path: string, _options: unknown, handler: (request: { vendorContext?: { vendorId?: string }; params?: { ticketId: string }; query?: unknown }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => unknown) => {
        gets.set(path, handler);
      }),
    };
    const reply = {
      code: vi.fn((status: number) => ({
        send: vi.fn((body: unknown) => ({ status, body })),
      })),
    };

    registerSupportRoutes(app as never, {} as never);
    const list = await gets.get('/support/tickets')?.({ vendorContext: { vendorId: 'vendor-a' }, query: {} }, reply);
    const detail = await gets.get('/support/tickets/:ticketId')?.({
      vendorContext: { vendorId: 'vendor-a' },
      params: { ticketId: 'ticket-1' },
    }, reply);

    expect(list).toEqual([{ id: 'ticket-1', notes: undefined }]);
    expect(detail).toEqual({ id: 'ticket-1', notes: undefined });
    expect(listVendorSupportTicketsMock).toHaveBeenCalledWith('vendor-a', {});
    expect(getVendorSupportTicketMock).toHaveBeenCalledWith('ticket-1', 'vendor-a');
  });

  it('registers admin status and internal note actions', async () => {
    updateAdminSupportTicketStatusMock.mockResolvedValueOnce({ id: 'ticket-1', status: 'IN_REVIEW' });
    addAdminSupportTicketNoteMock.mockResolvedValueOnce({ id: 'note-1', content: 'Internal note.' });
    const posts = new Map<string, (request: { authUser?: { id?: string; role?: string }; params: { ticketId: string }; body?: unknown }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => unknown>();
    const app = {
      get: vi.fn(),
      post: vi.fn((path: string, _options: unknown, handler: (request: { authUser?: { id?: string; role?: string }; params: { ticketId: string }; body?: unknown }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => unknown) => {
        posts.set(path, handler);
      }),
    };
    const reply = {
      code: vi.fn((status: number) => ({
        send: vi.fn((body: unknown) => ({ status, body })),
      })),
    };

    registerSupportRoutes(app as never, {} as never);
    const status = await posts.get('/admin/support/tickets/:ticketId/status')?.({
      authUser: { id: 'admin-1', role: 'admin' },
      params: { ticketId: 'ticket-1' },
      body: { status: 'IN_REVIEW' },
    }, reply);
    const note = await posts.get('/admin/support/tickets/:ticketId/notes')?.({
      authUser: { id: 'admin-1', role: 'admin' },
      params: { ticketId: 'ticket-1' },
      body: { content: 'Internal note.' },
    }, reply);

    expect(status).toEqual({ id: 'ticket-1', status: 'IN_REVIEW' });
    expect(note).toEqual({ id: 'note-1', content: 'Internal note.' });
  });

  it('registers support replies and assignment actions', async () => {
    addVendorSupportTicketReplyMock.mockResolvedValueOnce({ id: 'ticket-1', replies: [{ id: 'reply-vendor' }] });
    addAdminSupportTicketReplyMock.mockResolvedValueOnce({ id: 'ticket-1', replies: [{ id: 'reply-admin' }] });
    assignSupportTicketToSelfMock.mockResolvedValueOnce({ id: 'ticket-1', assigneeUserId: 'admin-1' });
    unassignSupportTicketMock.mockResolvedValueOnce({ id: 'ticket-1', assigneeUserId: null });
    const posts = new Map<string, (request: {
      authUser?: { id?: string; role?: string };
      vendorContext?: { vendorId?: string };
      params: { ticketId: string };
      body?: unknown;
    }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => unknown>();
    const app = {
      get: vi.fn(),
      post: vi.fn((path: string, _options: unknown, handler: (request: {
        authUser?: { id?: string; role?: string };
        vendorContext?: { vendorId?: string };
        params: { ticketId: string };
        body?: unknown;
      }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => unknown) => {
        posts.set(path, handler);
      }),
    };
    const reply = {
      code: vi.fn((status: number) => ({
        send: vi.fn((body: unknown) => ({ status, body })),
      })),
    };

    registerSupportRoutes(app as never, {} as never);
    const vendorReply = await posts.get('/support/tickets/:ticketId/replies')?.({
      authUser: { id: 'vendor-1', role: 'vendor' },
      vendorContext: { vendorId: 'vendor-a' },
      params: { ticketId: 'ticket-1' },
      body: { message: 'Vendor reply.' },
    }, reply);
    const adminReply = await posts.get('/admin/support/tickets/:ticketId/replies')?.({
      authUser: { id: 'admin-1', role: 'admin' },
      params: { ticketId: 'ticket-1' },
      body: { message: 'Admin reply.', status: 'WAITING_FOR_VENDOR' },
    }, reply);
    const assign = await posts.get('/admin/support/tickets/:ticketId/assign-self')?.({
      authUser: { id: 'admin-1', role: 'admin' },
      params: { ticketId: 'ticket-1' },
    }, reply);
    const unassign = await posts.get('/admin/support/tickets/:ticketId/unassign')?.({
      authUser: { id: 'admin-1', role: 'admin' },
      params: { ticketId: 'ticket-1' },
    }, reply);

    expect(vendorReply).toEqual({ id: 'ticket-1', replies: [{ id: 'reply-vendor' }] });
    expect(adminReply).toEqual({ id: 'ticket-1', replies: [{ id: 'reply-admin' }] });
    expect(assign).toEqual({ id: 'ticket-1', assigneeUserId: 'admin-1' });
    expect(unassign).toEqual({ id: 'ticket-1', assigneeUserId: null });
    expect(addVendorSupportTicketReplyMock).toHaveBeenCalledWith(
      'ticket-1',
      'vendor-a',
      { id: 'vendor-1', role: 'vendor' },
      { message: 'Vendor reply.' },
    );
    expect(addAdminSupportTicketReplyMock).toHaveBeenCalledWith(
      'ticket-1',
      { id: 'admin-1', role: 'admin' },
      { message: 'Admin reply.', status: 'WAITING_FOR_VENDOR' },
    );
    expect(assignSupportTicketToSelfMock).toHaveBeenCalledWith('ticket-1', { id: 'admin-1', role: 'admin' });
    expect(unassignSupportTicketMock).toHaveBeenCalledWith('ticket-1');
  });
});
