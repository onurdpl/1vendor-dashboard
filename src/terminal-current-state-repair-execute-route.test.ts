import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppEnv } from '../backend/src/config/env.js';

const executeMock = vi.hoisted(() => vi.fn());

vi.mock('../backend/src/modules/orders/terminal-current-state-repair-execute.service.js', () => {
  class TerminalCurrentStateExecuteError extends Error {
    constructor(
      public readonly code: string,
      message: string,
      public readonly statusCode: number,
    ) {
      super(message);
    }
  }
  return {
    TerminalCurrentStateExecuteError,
    createTerminalCurrentStateRepairExecuteService: vi.fn(() => ({ execute: executeMock })),
  };
});

const { registerDiagnosticsRoutes } = await import('../backend/src/modules/diagnostics/diagnostics.routes.js');

function buildReply() {
  return {
    code: vi.fn((statusCode: number) => ({
      send: vi.fn((payload: unknown) => ({ statusCode, payload })),
    })),
  };
}

function registerRoute(envOverrides: Partial<AppEnv> = {}) {
  const posts = new Map<string, {
    options: { preHandler?: unknown[] };
    handler: (request: {
      authUser?: { role: string };
      body?: { orderIdentifier?: unknown; execute?: unknown };
      log: { error: ReturnType<typeof vi.fn> };
    }, reply: ReturnType<typeof buildReply>) => unknown;
  }>();
  const app = {
    get: vi.fn(),
    post: vi.fn((path: string, options: unknown, handler: unknown) => posts.set(path, {
      options: options as never,
      handler: handler as never,
    })),
  };
  registerDiagnosticsRoutes(app as never, {
    NODE_ENV: 'test',
    FULL_REFUND_CURRENT_STATE_REPAIR_WRITE_ENABLED: true,
    FULL_REFUND_TERMINAL_WRITER_ENABLED: true,
    ...envOverrides,
  } as AppEnv);
  return posts.get('/admin/diagnostics/shopify/terminal-current-state-repair/execute');
}

describe('terminal Current-State Repair execute admin route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    executeMock.mockResolvedValue({ executed: true, created: 1 });
  });

  it('is admin-only and registered behind authenticated middleware', async () => {
    const route = registerRoute();
    expect(route?.options.preHandler).toHaveLength(1);
    const result = await route?.handler({
      authUser: { role: 'vendor' },
      body: { orderIdentifier: '#1128', execute: true },
      log: { error: vi.fn() },
    }, buildReply());
    expect(result).toEqual({ statusCode: 403, payload: { message: 'Forbidden' } });
    expect(executeMock).not.toHaveBeenCalled();
  });

  it.each([undefined, false])('requires literal execute=true', async (execute) => {
    const result = await registerRoute()?.handler({
      authUser: { role: 'admin' },
      body: { orderIdentifier: '#1128', execute },
      log: { error: vi.fn() },
    }, buildReply());
    expect(result).toEqual({
      statusCode: 400,
      payload: { code: 'execution_confirmation_required', message: 'Literal execute=true is required.' },
    });
    expect(executeMock).not.toHaveBeenCalled();
  });

  it('rejects non-string identities', async () => {
    const result = await registerRoute()?.handler({
      authUser: { role: 'admin' },
      body: { orderIdentifier: ['#1128'], execute: true },
      log: { error: vi.fn() },
    }, buildReply());
    expect(result).toEqual({
      statusCode: 400,
      payload: { code: 'invalid_order_identifier', message: 'Provide exactly one Shopify order ID or order number.' },
    });
  });

  it.each([
    [{ FULL_REFUND_CURRENT_STATE_REPAIR_WRITE_ENABLED: false }, 'terminal_current_state_repair_write_disabled'],
    [{ FULL_REFUND_TERMINAL_WRITER_ENABLED: false }, 'full_refund_terminal_writer_disabled'],
  ] as const)('fails before service invocation when a required flag is disabled', async (flags, code) => {
    const result = await registerRoute(flags)?.handler({
      authUser: { role: 'admin' },
      body: { orderIdentifier: '#1128', execute: true },
      log: { error: vi.fn() },
    }, buildReply());
    expect(result).toMatchObject({ statusCode: 503, payload: { code } });
    expect(executeMock).not.toHaveBeenCalled();
  });

  it('invokes only the separate execute service for a confirmed request', async () => {
    const result = await registerRoute()?.handler({
      authUser: { role: 'admin' },
      body: { orderIdentifier: '#1128', execute: true },
      log: { error: vi.fn() },
    }, buildReply());
    expect(result).toEqual({ executed: true, created: 1 });
    expect(executeMock).toHaveBeenCalledWith({ orderIdentifier: '#1128', execute: true });
  });
});
