import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerRulesRoutes } from '../backend/src/modules/rules/rules.routes.js';

const evaluateOperationalSignalsForUserMock = vi.hoisted(() => vi.fn());
const listDashboardOperationalSignalsMock = vi.hoisted(() => vi.fn());
const listOperationalSignalsMock = vi.hoisted(() => vi.fn());
const updateOperationalSignalStatusMock = vi.hoisted(() => vi.fn());

vi.mock('../backend/src/modules/rules/rules.service.js', () => ({
  evaluateOperationalSignalsForUser: evaluateOperationalSignalsForUserMock,
  listDashboardOperationalSignals: listDashboardOperationalSignalsMock,
  listOperationalSignals: listOperationalSignalsMock,
  updateOperationalSignalStatus: updateOperationalSignalStatusMock,
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

type Reply = {
  code: (status: number) => { send: (body: unknown) => unknown };
};

describe('rules route contract', () => {
  beforeEach(() => {
    evaluateOperationalSignalsForUserMock.mockReset();
    listDashboardOperationalSignalsMock.mockReset();
    listOperationalSignalsMock.mockReset();
    updateOperationalSignalStatusMock.mockReset();
  });

  it('keeps GET /signals read-only for dashboard deferred reads', async () => {
    listOperationalSignalsMock.mockResolvedValueOnce({ summary: { total: 1 }, signals: [] });
    const gets = new Map<string, (request: { authUser?: { role?: string }; vendorContext?: { vendorId?: string }; query?: { limit?: string } }, reply: Reply) => unknown>();
    const app = {
      get: vi.fn((path: string, _options: unknown, handler: (request: { authUser?: { role?: string }; vendorContext?: { vendorId?: string }; query?: { limit?: string } }, reply: Reply) => unknown) => {
        gets.set(path, handler);
      }),
      post: vi.fn(),
    };

    registerRulesRoutes(app as never, {} as never);
    const response = await gets.get('/signals')?.({
      authUser: { role: 'vendor' },
      vendorContext: { vendorId: 'sporjinal' },
      query: { limit: '10' },
    }, {} as Reply);

    expect(response).toEqual({ summary: { total: 1 }, signals: [] });
    expect(listOperationalSignalsMock).toHaveBeenCalledWith({
      vendorId: 'sporjinal',
      includeInternal: false,
      limit: 10,
    });
    expect(evaluateOperationalSignalsForUserMock).not.toHaveBeenCalled();
    expect(listDashboardOperationalSignalsMock).not.toHaveBeenCalled();
  });

  it('routes GET /signals/dashboard through the dashboard projection service with pagination', async () => {
    listDashboardOperationalSignalsMock.mockResolvedValueOnce({ signals: [] });
    const gets = new Map<string, (request: { authUser?: { role?: string }; vendorContext?: { vendorId?: string }; query?: { limit?: string; offset?: string } }, reply: Reply) => unknown>();
    const app = {
      get: vi.fn((path: string, _options: unknown, handler: (request: { authUser?: { role?: string }; vendorContext?: { vendorId?: string }; query?: { limit?: string; offset?: string } }, reply: Reply) => unknown) => {
        gets.set(path, handler);
      }),
      post: vi.fn(),
    };

    registerRulesRoutes(app as never, {} as never);
    const response = await gets.get('/signals/dashboard')?.({
      authUser: { role: 'vendor' },
      vendorContext: { vendorId: 'sporjinal' },
      query: { limit: '10', offset: '0' },
    }, {} as Reply);

    expect(response).toEqual({ signals: [] });
    expect(listDashboardOperationalSignalsMock).toHaveBeenCalledWith({
      vendorId: 'sporjinal',
      includeInternal: false,
      limit: 10,
      offset: 0,
    });
    expect(listOperationalSignalsMock).not.toHaveBeenCalled();
    expect(evaluateOperationalSignalsForUserMock).not.toHaveBeenCalled();
  });

  it('keeps GET /signals default limit behavior when no limit query is provided', async () => {
    listOperationalSignalsMock.mockResolvedValueOnce({ summary: { total: 1 }, signals: [] });
    const gets = new Map<string, (request: { authUser?: { role?: string }; vendorContext?: { vendorId?: string }; query?: { limit?: string } }, reply: Reply) => unknown>();
    const app = {
      get: vi.fn((path: string, _options: unknown, handler: (request: { authUser?: { role?: string }; vendorContext?: { vendorId?: string }; query?: { limit?: string } }, reply: Reply) => unknown) => {
        gets.set(path, handler);
      }),
      post: vi.fn(),
    };

    registerRulesRoutes(app as never, {} as never);
    await gets.get('/signals')?.({
      authUser: { role: 'vendor' },
      vendorContext: { vendorId: 'sporjinal' },
      query: {},
    }, {} as Reply);

    expect(listOperationalSignalsMock).toHaveBeenCalledWith({
      vendorId: 'sporjinal',
      includeInternal: false,
      limit: undefined,
    });
  });

  it('runs vendor-scoped signal evaluation only through POST /signals/evaluate', async () => {
    evaluateOperationalSignalsForUserMock.mockResolvedValueOnce({ summary: { total: 2 }, signals: [] });
    const posts = new Map<string, (request: { authUser?: { role?: string }; vendorContext?: { vendorId?: string } }, reply: Reply) => unknown>();
    const app = {
      get: vi.fn(),
      post: vi.fn((path: string, _options: unknown, handler: (request: { authUser?: { role?: string }; vendorContext?: { vendorId?: string } }, reply: Reply) => unknown) => {
        posts.set(path, handler);
      }),
    };

    registerRulesRoutes(app as never, {} as never);
    const response = await posts.get('/signals/evaluate')?.({
      authUser: { role: 'vendor' },
      vendorContext: { vendorId: 'sporjinal' },
    }, {} as Reply);

    expect(response).toEqual({ summary: { total: 2 }, signals: [] });
    expect(evaluateOperationalSignalsForUserMock).toHaveBeenCalledWith({
      vendorId: 'sporjinal',
      includeInternal: false,
    });
    expect(listOperationalSignalsMock).not.toHaveBeenCalled();
  });

  it('keeps admin signal reads passive and admin evaluation explicit', async () => {
    listOperationalSignalsMock.mockResolvedValueOnce({ summary: { total: 3 }, signals: [] });
    evaluateOperationalSignalsForUserMock.mockResolvedValueOnce({ summary: { total: 4 }, signals: [] });
    const gets = new Map<string, (request: { authUser?: { role?: string } }, reply: Reply) => unknown>();
    const posts = new Map<string, (request: { authUser?: { role?: string } }, reply: Reply) => unknown>();
    const app = {
      get: vi.fn((path: string, _options: unknown, handler: (request: { authUser?: { role?: string } }, reply: Reply) => unknown) => {
        gets.set(path, handler);
      }),
      post: vi.fn((path: string, _options: unknown, handler: (request: { authUser?: { role?: string } }, reply: Reply) => unknown) => {
        posts.set(path, handler);
      }),
    };
    const reply = {
      code: vi.fn((status: number) => ({
        send: vi.fn((body: unknown) => ({ status, body })),
      })),
    };

    registerRulesRoutes(app as never, {} as never);
    const blocked = await posts.get('/admin/signals/evaluate')?.({ authUser: { role: 'vendor' } }, reply);
    const read = await gets.get('/admin/signals')?.({ authUser: { role: 'admin' } }, reply);
    const generated = await posts.get('/admin/signals/evaluate')?.({ authUser: { role: 'admin' } }, reply);

    expect(blocked).toEqual({ status: 403, body: { message: 'Forbidden' } });
    expect(read).toEqual({ summary: { total: 3 }, signals: [] });
    expect(generated).toEqual({ summary: { total: 4 }, signals: [] });
    expect(listOperationalSignalsMock).toHaveBeenCalledWith({
      includeInternal: true,
    });
    expect(evaluateOperationalSignalsForUserMock).toHaveBeenCalledWith({
      includeInternal: true,
    });
  });
});
