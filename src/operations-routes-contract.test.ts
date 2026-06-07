import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerOperationsRoutes } from '../backend/src/modules/operations/operations.routes.js';

const getAdminOperationsQueueMock = vi.hoisted(() => vi.fn());
const getAdminOperationsAttentionCenterMock = vi.hoisted(() => vi.fn());
const generateAdminOperationsSignalsMock = vi.hoisted(() => vi.fn());
const generateAdminOperationsAutomationActionsMock = vi.hoisted(() => vi.fn());

vi.mock('../backend/src/modules/operations/operations.service.js', () => ({
  generateAdminOperationsAutomationActions: generateAdminOperationsAutomationActionsMock,
  generateAdminOperationsSignals: generateAdminOperationsSignalsMock,
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
  beforeEach(() => {
    getAdminOperationsQueueMock.mockReset();
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
