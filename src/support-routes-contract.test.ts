import { describe, expect, it, vi } from 'vitest';
import { registerSupportRoutes } from '../backend/src/modules/support/support.routes.js';

const createSupportTicketMock = vi.hoisted(() => vi.fn());
const listAdminSupportTicketsMock = vi.hoisted(() => vi.fn());

vi.mock('../backend/src/modules/support/support.service.js', () => ({
  createSupportTicket: createSupportTicketMock,
  listAdminSupportTickets: listAdminSupportTicketsMock,
  SupportTicketError: class SupportTicketError extends Error {
    statusCode: number;

    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  },
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
});
