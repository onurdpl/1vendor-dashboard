import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerAutomationActionRoutes } from '../backend/src/modules/automation/automation-actions.routes.js';

const executeAutomationActionMock = vi.hoisted(() => vi.fn());
const generateAutomationActionsForUserMock = vi.hoisted(() => vi.fn());
const listAutomationActionsMock = vi.hoisted(() => vi.fn());

vi.mock('../backend/src/modules/automation/automation-actions.service.js', () => ({
  automationActionEnums: {
    status: {
      PENDING: 'PENDING',
      SUGGESTED: 'SUGGESTED',
      FAILED: 'FAILED',
    },
  },
  executeAutomationAction: executeAutomationActionMock,
  generateAutomationActionsForUser: generateAutomationActionsForUserMock,
  listAutomationActions: listAutomationActionsMock,
}));

vi.mock('../backend/src/modules/auth/auth.service.js', () => ({
  createAuthService: vi.fn(() => ({})),
}));

vi.mock('../backend/src/modules/auth/auth.middleware.js', () => ({
  createAuthMiddleware: vi.fn(() => ({
    authenticateRequest: vi.fn(),
  })),
}));

type Reply = {
  code: (status: number) => { send: (body: unknown) => unknown };
};

describe('automation action route contract', () => {
  beforeEach(() => {
    executeAutomationActionMock.mockReset();
    generateAutomationActionsForUserMock.mockReset();
    listAutomationActionsMock.mockReset();
  });

  it('keeps GET /admin/automation-actions read-only', async () => {
    listAutomationActionsMock.mockResolvedValueOnce({ summary: { total: 1 }, actions: [] });
    const gets = new Map<string, (request: { authUser?: { role?: string }; query?: unknown }, reply: Reply) => unknown>();
    const app = {
      get: vi.fn((path: string, _options: unknown, handler: (request: { authUser?: { role?: string }; query?: unknown }, reply: Reply) => unknown) => {
        gets.set(path, handler);
      }),
      post: vi.fn(),
    };

    registerAutomationActionRoutes(app as never, {} as never);
    const response = await gets.get('/admin/automation-actions')?.({
      authUser: { role: 'admin' },
      query: { status: 'suggested' },
    }, {} as Reply);

    expect(response).toEqual({ summary: { total: 1 }, actions: [] });
    expect(listAutomationActionsMock).toHaveBeenCalledWith({ status: 'SUGGESTED' });
    expect(generateAutomationActionsForUserMock).not.toHaveBeenCalled();
  });

  it('runs automation action generation only through explicit POST', async () => {
    generateAutomationActionsForUserMock.mockResolvedValueOnce({ summary: { total: 2 }, actions: [] });
    const posts = new Map<string, (request: { authUser?: { role?: string }; query?: unknown }, reply: Reply) => unknown>();
    const app = {
      get: vi.fn(),
      post: vi.fn((path: string, _options: unknown, handler: (request: { authUser?: { role?: string }; query?: unknown }, reply: Reply) => unknown) => {
        posts.set(path, handler);
      }),
    };
    const reply = {
      code: vi.fn((status: number) => ({
        send: vi.fn((body: unknown) => ({ status, body })),
      })),
    };

    registerAutomationActionRoutes(app as never, {} as never);
    const blocked = await posts.get('/admin/automation-actions/generate')?.({ authUser: { role: 'vendor' } }, reply);
    const generated = await posts.get('/admin/automation-actions/generate')?.({
      authUser: { role: 'admin' },
      query: { status: 'failed' },
    }, reply);

    expect(blocked).toEqual({ status: 403, body: { message: 'Forbidden' } });
    expect(generated).toEqual({ summary: { total: 2 }, actions: [] });
    expect(generateAutomationActionsForUserMock).toHaveBeenCalledWith({
      status: 'FAILED',
      includeNotifications: true,
    });
    expect(listAutomationActionsMock).not.toHaveBeenCalled();
  });
});
