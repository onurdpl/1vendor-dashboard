import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppEnv } from '../backend/src/config/env.js';

const planMock = vi.hoisted(() => vi.fn());

vi.mock('../backend/src/modules/orders/terminal-current-state-repair-dry-run.service.js', () => {
  class TerminalCurrentStateDryRunError extends Error {
    constructor(
      public readonly code: string,
      message: string,
      public readonly statusCode: number,
    ) {
      super(message);
    }
  }
  return {
    TerminalCurrentStateDryRunError,
    createTerminalCurrentStateRepairDryRunService: vi.fn(() => ({ plan: planMock })),
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

function registerRoute() {
  const posts = new Map<string, (request: {
    authUser?: { role: string };
    body?: { orderIdentifier?: string; execute?: boolean };
    log: { error: ReturnType<typeof vi.fn> };
  }, reply: ReturnType<typeof buildReply>) => unknown>();
  const app = {
    get: vi.fn(),
    post: vi.fn((path: string, ...args: unknown[]) => posts.set(path, args.at(-1) as never)),
  };
  registerDiagnosticsRoutes(app as never, { NODE_ENV: 'test' } as AppEnv);
  return posts.get('/admin/diagnostics/shopify/terminal-current-state-repair/dry-run');
}

describe('terminal Current-State Repair dry-run admin route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    planMock.mockResolvedValue({ dryRun: true, scanned: 1 });
  });

  it('is admin-only', async () => {
    const result = await registerRoute()?.({
      authUser: { role: 'vendor' }, body: { orderIdentifier: '#1128' }, log: { error: vi.fn() },
    }, buildReply());
    expect(result).toEqual({ statusCode: 403, payload: { message: 'Forbidden' } });
    expect(planMock).not.toHaveBeenCalled();
  });

  it('accepts exactly one identifier', async () => {
    await registerRoute()?.({
      authUser: { role: 'admin' }, body: { orderIdentifier: '#1128' }, log: { error: vi.fn() },
    }, buildReply());
    expect(planMock).toHaveBeenCalledWith({ orderIdentifier: '#1128' });
  });

  it('rejects execute mode explicitly', async () => {
    const result = await registerRoute()?.({
      authUser: { role: 'admin' }, body: { orderIdentifier: '#1128', execute: true }, log: { error: vi.fn() },
    }, buildReply());
    expect(result).toEqual({
      statusCode: 400,
      payload: { code: 'write_mode_not_supported', message: 'Terminal current-state repair supports dry-run only.' },
    });
    expect(planMock).not.toHaveBeenCalled();
  });

  it('rejects a missing identifier', async () => {
    const result = await registerRoute()?.({
      authUser: { role: 'admin' }, body: {}, log: { error: vi.fn() },
    }, buildReply());
    expect(result).toEqual({
      statusCode: 400,
      payload: { code: 'invalid_order_identifier', message: 'Provide exactly one Shopify order ID or order number.' },
    });
  });
});
