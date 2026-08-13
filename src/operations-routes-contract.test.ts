import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerOperationsRoutes } from '../backend/src/modules/operations/operations.routes.js';

const getAdminOperationsQueueMock = vi.hoisted(() => vi.fn());
const getAdminOperationsQueueSummaryMock = vi.hoisted(() => vi.fn());
const getAdminOperationsAttentionCenterMock = vi.hoisted(() => vi.fn());
const generateAdminOperationsSignalsMock = vi.hoisted(() => vi.fn());
const generateAdminOperationsAutomationActionsMock = vi.hoisted(() => vi.fn());

vi.mock('../backend/src/modules/operations/operations.service.js', () => ({
  generateAdminOperationsAutomationActions: generateAdminOperationsAutomationActionsMock,
  generateAdminOperationsSignals: generateAdminOperationsSignalsMock,
  getAdminOperationsQueue: getAdminOperationsQueueMock,
  getAdminOperationsQueueSummary: getAdminOperationsQueueSummaryMock,
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
  beforeEach(() => {
    getAdminOperationsQueueMock.mockReset();
    getAdminOperationsQueueSummaryMock.mockReset();
    getAdminOperationsAttentionCenterMock.mockReset();
    generateAdminOperationsSignalsMock.mockReset();
    generateAdminOperationsAutomationActionsMock.mockReset();
  });

  it('serves attention center to admins only', async () => {
    getAdminOperationsAttentionCenterMock.mockResolvedValueOnce({ summary: { total: 1 }, queue: [] });
    const gets = new Map<string, (request: { authUser?: { role?: string }; query?: unknown }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => unknown>();
    const app = {
      get: vi.fn((path: string, _options: unknown, handler: (request: { authUser?: { role?: string }; query?: unknown }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => unknown) => {
        gets.set(path, handler);
      }),
      post: vi.fn(),
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
      post: vi.fn(),
    };

    registerOperationsRoutes(app as never, {} as never);
    const allowed = await gets.get('/admin/operations')?.({ authUser: { role: 'admin' }, query: {} }, {});

    expect(allowed).toEqual({ summary: { total: 0 }, items: [] });
    expect(getAdminOperationsQueueMock).toHaveBeenCalledWith({ limit: 100, offset: 0, type: undefined });
  });

  it('passes the supported vendor-blocked queue type filter to the operations service', async () => {
    getAdminOperationsQueueMock.mockResolvedValueOnce({ summary: { total: 7 }, items: [] });
    const gets = new Map<string, (request: { authUser?: { role?: string }; query?: unknown }, reply: unknown) => unknown>();
    const app = {
      get: vi.fn((path: string, _options: unknown, handler: (request: { authUser?: { role?: string }; query?: unknown }, reply: unknown) => unknown) => {
        gets.set(path, handler);
      }),
      post: vi.fn(),
    };

    registerOperationsRoutes(app as never, {} as never);
    const allowed = await gets.get('/admin/operations')?.({ authUser: { role: 'admin' }, query: { type: 'vendor_blocked', limit: '5', offset: '5' } }, {});

    expect(allowed).toEqual({ summary: { total: 7 }, items: [] });
    expect(getAdminOperationsQueueMock).toHaveBeenCalledWith({ limit: 5, offset: 5, type: 'vendor_blocked' });
  });

  it('passes an explicit resolved vendor-blocked scope and rejects scope on other queues', async () => {
    getAdminOperationsQueueMock.mockResolvedValueOnce({ summary: { total: 3 }, items: [] });
    const gets = new Map<string, (request: { authUser?: { role?: string }; query?: unknown }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => unknown>();
    const app = {
      get: vi.fn((path: string, _options: unknown, handler: (request: { authUser?: { role?: string }; query?: unknown }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => unknown) => {
        gets.set(path, handler);
      }),
      post: vi.fn(),
    };
    const reply = {
      code: vi.fn((status: number) => ({
        send: vi.fn((body: unknown) => ({ status, body })),
      })),
    };

    registerOperationsRoutes(app as never, {} as never);
    const resolved = await gets.get('/admin/operations')?.({
      authUser: { role: 'admin' },
      query: { type: 'vendor_blocked', scope: 'resolved', limit: '10', offset: '20' },
    }, reply);
    const invalid = await gets.get('/admin/operations')?.({
      authUser: { role: 'admin' },
      query: { type: 'awaiting_shipment', scope: 'resolved' },
    }, reply);

    expect(resolved).toEqual({ summary: { total: 3 }, items: [] });
    expect(getAdminOperationsQueueMock).toHaveBeenCalledWith({
      limit: 10,
      offset: 20,
      type: 'vendor_blocked',
      scope: 'resolved',
    });
    expect(invalid).toEqual({
      status: 400,
      body: { message: 'scope must be active or resolved and may only be used with type=vendor_blocked.' },
    });
  });

  it('passes the supported shipment queue type filter and normalized pagination to the operations service', async () => {
    getAdminOperationsQueueMock.mockResolvedValueOnce({ summary: { total: 12 }, items: [] });
    const gets = new Map<string, (request: { authUser?: { role?: string }; query?: unknown }, reply: unknown) => unknown>();
    const app = {
      get: vi.fn((path: string, _options: unknown, handler: (request: { authUser?: { role?: string }; query?: unknown }, reply: unknown) => unknown) => {
        gets.set(path, handler);
      }),
      post: vi.fn(),
    };

    registerOperationsRoutes(app as never, {} as never);
    const response = await gets.get('/admin/operations')?.({
      authUser: { role: 'admin' },
      query: { type: 'awaiting_shipment', limit: '10', offset: '20' },
    }, {});

    expect(response).toEqual({ summary: { total: 12 }, items: [] });
    expect(getAdminOperationsQueueMock).toHaveBeenCalledWith({
      limit: 10,
      offset: 20,
      type: 'awaiting_shipment',
    });
  });

  it('passes the supported return-review queue type filter to the operations service', async () => {
    getAdminOperationsQueueMock.mockResolvedValueOnce({ summary: { total: 8 }, items: [] });
    const gets = new Map<string, (request: { authUser?: { role?: string }; query?: unknown }, reply: unknown) => unknown>();
    const app = {
      get: vi.fn((path: string, _options: unknown, handler: (request: { authUser?: { role?: string }; query?: unknown }, reply: unknown) => unknown) => {
        gets.set(path, handler);
      }),
      post: vi.fn(),
    };

    registerOperationsRoutes(app as never, {} as never);
    const response = await gets.get('/admin/operations')?.({
      authUser: { role: 'admin' },
      query: { type: 'return_review', limit: '10', offset: '10' },
    }, {});

    expect(response).toEqual({ summary: { total: 8 }, items: [] });
    expect(getAdminOperationsQueueMock).toHaveBeenCalledWith({
      limit: 10,
      offset: 10,
      type: 'return_review',
    });
  });

  it('passes the supported finance integrity alert queue type filter to the operations service', async () => {
    getAdminOperationsQueueMock.mockResolvedValueOnce({ summary: { total: 4 }, items: [] });
    const gets = new Map<string, (request: { authUser?: { role?: string }; query?: unknown }, reply: unknown) => unknown>();
    const app = {
      get: vi.fn((path: string, _options: unknown, handler: (request: { authUser?: { role?: string }; query?: unknown }, reply: unknown) => unknown) => {
        gets.set(path, handler);
      }),
      post: vi.fn(),
    };

    registerOperationsRoutes(app as never, {} as never);
    const response = await gets.get('/admin/operations')?.({
      authUser: { role: 'admin' },
      query: { type: 'finance_integrity_alert', limit: '10', offset: '30' },
    }, {});

    expect(response).toEqual({ summary: { total: 4 }, items: [] });
    expect(getAdminOperationsQueueMock).toHaveBeenCalledWith({
      limit: 10,
      offset: 30,
      type: 'finance_integrity_alert',
    });
  });

  it('passes the supported finance review queue type filter to the operations service', async () => {
    getAdminOperationsQueueMock.mockResolvedValueOnce({ summary: { total: 6 }, items: [] });
    const gets = new Map<string, (request: { authUser?: { role?: string }; query?: unknown }, reply: unknown) => unknown>();
    const app = {
      get: vi.fn((path: string, _options: unknown, handler: (request: { authUser?: { role?: string }; query?: unknown }, reply: unknown) => unknown) => {
        gets.set(path, handler);
      }),
      post: vi.fn(),
    };

    registerOperationsRoutes(app as never, {} as never);
    const response = await gets.get('/admin/operations')?.({
      authUser: { role: 'admin' },
      query: { type: 'finance_review', limit: '10', offset: '40' },
    }, {});

    expect(response).toEqual({ summary: { total: 6 }, items: [] });
    expect(getAdminOperationsQueueMock).toHaveBeenCalledWith({
      limit: 10,
      offset: 40,
      type: 'finance_review',
    });
  });

  it('preserves shared pagination validation for the return-review queue', async () => {
    getAdminOperationsQueueMock
      .mockResolvedValueOnce({ summary: { total: 0 }, items: [] })
      .mockResolvedValueOnce({ summary: { total: 0 }, items: [] });
    const gets = new Map<string, (request: { authUser?: { role?: string }; query?: unknown }, reply: unknown) => unknown>();
    const app = {
      get: vi.fn((path: string, _options: unknown, handler: (request: { authUser?: { role?: string }; query?: unknown }, reply: unknown) => unknown) => {
        gets.set(path, handler);
      }),
      post: vi.fn(),
    };

    registerOperationsRoutes(app as never, {} as never);
    await gets.get('/admin/operations')?.({
      authUser: { role: 'admin' },
      query: { type: 'return_review', limit: '0', offset: '-1' },
    }, {});
    await gets.get('/admin/operations')?.({
      authUser: { role: 'admin' },
      query: { type: 'return_review', limit: '1000', offset: 'invalid' },
    }, {});

    expect(getAdminOperationsQueueMock).toHaveBeenNthCalledWith(1, {
      limit: 1,
      offset: 0,
      type: 'return_review',
    });
    expect(getAdminOperationsQueueMock).toHaveBeenNthCalledWith(2, {
      limit: 250,
      offset: 0,
      type: 'return_review',
    });
  });

  it('preserves shared pagination validation for the finance integrity alert queue', async () => {
    getAdminOperationsQueueMock
      .mockResolvedValueOnce({ summary: { total: 0 }, items: [] })
      .mockResolvedValueOnce({ summary: { total: 0 }, items: [] });
    const gets = new Map<string, (request: { authUser?: { role?: string }; query?: unknown }, reply: unknown) => unknown>();
    const app = {
      get: vi.fn((path: string, _options: unknown, handler: (request: { authUser?: { role?: string }; query?: unknown }, reply: unknown) => unknown) => {
        gets.set(path, handler);
      }),
      post: vi.fn(),
    };

    registerOperationsRoutes(app as never, {} as never);
    await gets.get('/admin/operations')?.({
      authUser: { role: 'admin' },
      query: { type: 'finance_integrity_alert', limit: '0', offset: '-1' },
    }, {});
    await gets.get('/admin/operations')?.({
      authUser: { role: 'admin' },
      query: { type: 'finance_integrity_alert', limit: '1000', offset: 'invalid' },
    }, {});

    expect(getAdminOperationsQueueMock).toHaveBeenNthCalledWith(1, {
      limit: 1,
      offset: 0,
      type: 'finance_integrity_alert',
    });
    expect(getAdminOperationsQueueMock).toHaveBeenNthCalledWith(2, {
      limit: 250,
      offset: 0,
      type: 'finance_integrity_alert',
    });
  });

  it('preserves shared pagination validation for the finance review queue', async () => {
    getAdminOperationsQueueMock
      .mockResolvedValueOnce({ summary: { total: 0 }, items: [] })
      .mockResolvedValueOnce({ summary: { total: 0 }, items: [] });
    const gets = new Map<string, (request: { authUser?: { role?: string }; query?: unknown }, reply: unknown) => unknown>();
    const app = {
      get: vi.fn((path: string, _options: unknown, handler: (request: { authUser?: { role?: string }; query?: unknown }, reply: unknown) => unknown) => {
        gets.set(path, handler);
      }),
      post: vi.fn(),
    };

    registerOperationsRoutes(app as never, {} as never);
    await gets.get('/admin/operations')?.({
      authUser: { role: 'admin' },
      query: { type: 'finance_review', limit: '0', offset: '-1' },
    }, {});
    await gets.get('/admin/operations')?.({
      authUser: { role: 'admin' },
      query: { type: 'finance_review', limit: '1000', offset: 'invalid' },
    }, {});

    expect(getAdminOperationsQueueMock).toHaveBeenNthCalledWith(1, {
      limit: 1,
      offset: 0,
      type: 'finance_review',
    });
    expect(getAdminOperationsQueueMock).toHaveBeenNthCalledWith(2, {
      limit: 250,
      offset: 0,
      type: 'finance_review',
    });
  });

  it('preserves shared pagination validation for the shipment queue', async () => {
    getAdminOperationsQueueMock
      .mockResolvedValueOnce({ summary: { total: 0 }, items: [] })
      .mockResolvedValueOnce({ summary: { total: 0 }, items: [] })
      .mockResolvedValueOnce({ summary: { total: 0 }, items: [] });
    const gets = new Map<string, (request: { authUser?: { role?: string }; query?: unknown }, reply: unknown) => unknown>();
    const app = {
      get: vi.fn((path: string, _options: unknown, handler: (request: { authUser?: { role?: string }; query?: unknown }, reply: unknown) => unknown) => {
        gets.set(path, handler);
      }),
      post: vi.fn(),
    };

    registerOperationsRoutes(app as never, {} as never);
    await gets.get('/admin/operations')?.({
      authUser: { role: 'admin' },
      query: { type: 'awaiting_shipment', limit: '0', offset: '-5' },
    }, {});
    await gets.get('/admin/operations')?.({
      authUser: { role: 'admin' },
      query: { type: 'awaiting_shipment', limit: '1000', offset: '10.5' },
    }, {});
    await gets.get('/admin/operations')?.({
      authUser: { role: 'admin' },
      query: { type: 'awaiting_shipment', limit: 'invalid', offset: 'invalid' },
    }, {});

    expect(getAdminOperationsQueueMock).toHaveBeenNthCalledWith(1, {
      limit: 1,
      offset: 0,
      type: 'awaiting_shipment',
    });
    expect(getAdminOperationsQueueMock).toHaveBeenNthCalledWith(2, {
      limit: 250,
      offset: 10,
      type: 'awaiting_shipment',
    });
    expect(getAdminOperationsQueueMock).toHaveBeenNthCalledWith(3, {
      limit: 100,
      offset: 0,
      type: 'awaiting_shipment',
    });
  });

  it('rejects unsupported operations queue type filters', async () => {
    const gets = new Map<string, (request: { authUser?: { role?: string }; query?: unknown }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => unknown>();
    const app = {
      get: vi.fn((path: string, _options: unknown, handler: (request: { authUser?: { role?: string }; query?: unknown }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => unknown) => {
        gets.set(path, handler);
      }),
      post: vi.fn(),
    };
    const reply = {
      code: vi.fn((status: number) => ({
        send: vi.fn((body: unknown) => ({ status, body })),
      })),
    };

    registerOperationsRoutes(app as never, {} as never);
    const response = await gets.get('/admin/operations')?.({ authUser: { role: 'admin' }, query: { type: 'shipment' } }, reply);

    expect(response).toEqual({ status: 400, body: { message: 'type must be vendor_blocked, awaiting_shipment, return_review, finance_review, or finance_integrity_alert.' } });
    expect(getAdminOperationsQueueMock).not.toHaveBeenCalled();
  });

  it('serves summary-only operations counts to admins without loading queue items', async () => {
    getAdminOperationsQueueSummaryMock.mockResolvedValueOnce({ total: 7, critical: 1 });
    const gets = new Map<string, (request: { authUser?: { role?: string }; query?: unknown }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => unknown>();
    const app = {
      get: vi.fn((path: string, _options: unknown, handler: (request: { authUser?: { role?: string }; query?: unknown }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => unknown) => {
        gets.set(path, handler);
      }),
      post: vi.fn(),
    };
    const reply = {
      code: vi.fn((status: number) => ({
        send: vi.fn((body: unknown) => ({ status, body })),
      })),
    };

    registerOperationsRoutes(app as never, {} as never);
    const blocked = await gets.get('/admin/operations/summary')?.({ authUser: { role: 'vendor' } }, reply);
    const allowed = await gets.get('/admin/operations/summary')?.({ authUser: { role: 'admin' }, query: { limit: 20 } }, reply);

    expect(blocked).toEqual({ status: 403, body: { message: 'Forbidden' } });
    expect(allowed).toEqual({ total: 7, critical: 1 });
    expect(getAdminOperationsQueueSummaryMock).toHaveBeenCalledTimes(1);
    expect(getAdminOperationsQueueMock).not.toHaveBeenCalled();
  });

  it('keeps operations generation explicit and admin-only', async () => {
    generateAdminOperationsSignalsMock.mockResolvedValueOnce({ generated: 2, signals: [] });
    generateAdminOperationsAutomationActionsMock.mockResolvedValueOnce({ generated: 3, actions: [] });
    const posts = new Map<string, (request: { authUser?: { role?: string } }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => unknown>();
    const app = {
      get: vi.fn(),
      post: vi.fn((path: string, _options: unknown, handler: (request: { authUser?: { role?: string } }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => unknown) => {
        posts.set(path, handler);
      }),
    };
    const reply = {
      code: vi.fn((status: number) => ({
        send: vi.fn((body: unknown) => ({ status, body })),
      })),
    };

    registerOperationsRoutes(app as never, {} as never);
    const blocked = await posts.get('/admin/operations/generate-signals')?.({ authUser: { role: 'vendor' } }, reply);
    const generatedSignals = await posts.get('/admin/operations/generate-signals')?.({ authUser: { role: 'admin' } }, reply);
    const generatedActions = await posts.get('/admin/operations/generate-actions')?.({ authUser: { role: 'admin' } }, reply);

    expect(blocked).toEqual({ status: 403, body: { message: 'Forbidden' } });
    expect(generatedSignals).toEqual({ generated: 2, signals: [] });
    expect(generatedActions).toEqual({ generated: 3, actions: [] });
    expect(generateAdminOperationsSignalsMock).toHaveBeenCalledTimes(1);
    expect(generateAdminOperationsAutomationActionsMock).toHaveBeenCalledTimes(1);
  });
});
