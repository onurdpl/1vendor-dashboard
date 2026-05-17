import { describe, expect, it, vi } from 'vitest';
import { registerOperationsRoutes } from '../backend/src/modules/operations/operations.routes.js';

const getAdminOperationsQueueMock = vi.hoisted(() => vi.fn());
const getAdminOperationsAttentionCenterMock = vi.hoisted(() => vi.fn());

vi.mock('../backend/src/modules/operations/operations.service.js', () => ({
  getAdminOperationsQueue: getAdminOperationsQueueMock,
  getAdminOperationsAttentionCenter: getAdminOperationsAttentionCenterMock,
}));

vi.mock('../backend/src/modules/auth/auth.service.js', () => ({
  createAuthService: vi.fn(() => ({})),
}));

vi.mock('../backend/src/modules/auth/auth.middleware.js', () => ({
  createAuthMiddleware: vi.fn(() => ({
    authenticateRequest: vi.fn(),
  })),
}));

describe('operations route contract', () => {
  it('serves attention center to admins only', async () => {
    getAdminOperationsAttentionCenterMock.mockResolvedValueOnce({ summary: { total: 1 }, queue: [] });
    const gets = new Map<string, (request: { authUser?: { role?: string }; query?: unknown }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => unknown>();
    const app = {
      get: vi.fn((path: string, _options: unknown, handler: (request: { authUser?: { role?: string }; query?: unknown }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => unknown) => {
        gets.set(path, handler);
      }),
    };
    const reply = {
      code: vi.fn((status: number) => ({
        send: vi.fn((body: unknown) => ({ status, body })),
      })),
    };

    registerOperationsRoutes(app as never, {} as never);
    const blocked = await gets.get('/admin/operations/attention')?.({ authUser: { role: 'vendor' } }, reply);
    const allowed = await gets.get('/admin/operations/attention')?.({ authUser: { role: 'admin' } }, reply);

    expect(blocked).toEqual({ status: 403, body: { message: 'Forbidden' } });
    expect(allowed).toEqual({ summary: { total: 1 }, queue: [] });
  });

  it('keeps the existing queue route available', async () => {
    getAdminOperationsQueueMock.mockResolvedValueOnce({ summary: { total: 0 }, items: [] });
    const gets = new Map<string, (request: { authUser?: { role?: string }; query?: unknown }, reply: unknown) => unknown>();
    const app = {
      get: vi.fn((path: string, _options: unknown, handler: (request: { authUser?: { role?: string }; query?: unknown }, reply: unknown) => unknown) => {
        gets.set(path, handler);
      }),
    };

    registerOperationsRoutes(app as never, {} as never);
    const allowed = await gets.get('/admin/operations')?.({ authUser: { role: 'admin' }, query: {} }, {});

    expect(allowed).toEqual({ summary: { total: 0 }, items: [] });
  });
});
