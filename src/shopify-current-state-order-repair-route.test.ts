import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppEnv } from '../backend/src/config/env.js';

const repairMock = vi.hoisted(() => vi.fn());

vi.mock('../backend/src/modules/shopify/current-state-order-repair.service.js', () => {
  class CurrentStateOrderRepairError extends Error {
    constructor(
      public readonly code: string,
      message: string,
      public readonly statusCode: number,
    ) {
      super(message);
    }
  }
  return {
    CurrentStateOrderRepairError,
    createCurrentStateOrderRepairService: vi.fn(() => ({ repair: repairMock })),
  };
});

const { registerDiagnosticsRoutes } = await import('../backend/src/modules/diagnostics/diagnostics.routes.js');

function buildEnv(): AppEnv {
  return {
    NODE_ENV: 'test',
    SHOPIFY_API_VERSION: '2026-01',
  } as AppEnv;
}

function registerRoute() {
  const posts = new Map<string, (request: {
    authUser?: { id: string; email: string; role: string };
    body?: { orderIdentifier?: string; execute?: boolean };
    log: { error: ReturnType<typeof vi.fn> };
  }, reply: ReturnType<typeof buildReply>) => unknown>();
  const app = {
    get: vi.fn(),
    post: vi.fn((path: string, ...args: unknown[]) => {
      posts.set(path, args.at(-1) as never);
    }),
  };
  registerDiagnosticsRoutes(app as never, buildEnv());
  return posts.get('/admin/diagnostics/shopify/order-repair');
}

function buildReply() {
  return {
    code: vi.fn((statusCode: number) => ({
      send: vi.fn((payload: unknown) => ({ statusCode, payload })),
    })),
  };
}

describe('Shopify current-state order repair route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    repairMock.mockResolvedValue({ ok: true, dryRun: true, executed: false });
  });

  it('is admin-only', async () => {
    const route = registerRoute();
    const result = await route?.({
      authUser: { id: 'vendor-1', email: 'vendor@example.com', role: 'vendor' },
      body: { orderIdentifier: '#1105' },
      log: { error: vi.fn() },
    }, buildReply());

    expect(result).toEqual({ statusCode: 403, payload: { message: 'Forbidden' } });
    expect(repairMock).not.toHaveBeenCalled();
  });

  it('defaults to dry-run and passes the authenticated actor safely', async () => {
    const route = registerRoute();
    await route?.({
      authUser: { id: 'admin-1', email: 'admin@example.com', role: 'admin' },
      body: { orderIdentifier: '#1105' },
      log: { error: vi.fn() },
    }, buildReply());

    expect(repairMock).toHaveBeenCalledWith({
      orderIdentifier: '#1105',
      execute: false,
      actor: { userId: 'admin-1', email: 'admin@example.com' },
    });
  });

  it('requires an explicit single order identifier', async () => {
    const route = registerRoute();
    const result = await route?.({
      authUser: { id: 'admin-1', email: 'admin@example.com', role: 'admin' },
      body: {},
      log: { error: vi.fn() },
    }, buildReply());

    expect(result).toEqual({
      statusCode: 400,
      payload: {
        code: 'invalid_order_identifier',
        message: 'Provide exactly one Shopify order ID or order number.',
      },
    });
  });

  it('requires execute=true for mutation', async () => {
    const route = registerRoute();
    await route?.({
      authUser: { id: 'admin-1', email: 'admin@example.com', role: 'admin' },
      body: { orderIdentifier: '7856043819345', execute: true },
      log: { error: vi.fn() },
    }, buildReply());

    expect(repairMock).toHaveBeenCalledWith(expect.objectContaining({
      orderIdentifier: '7856043819345',
      execute: true,
    }));
  });
});
