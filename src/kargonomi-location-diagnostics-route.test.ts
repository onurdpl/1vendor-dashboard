import { describe, expect, it, vi } from 'vitest';
import type { AppEnv } from '../backend/src/config/env.js';
import { registerDiagnosticsRoutes } from '../backend/src/modules/diagnostics/diagnostics.routes.js';

function buildEnv(overrides: Partial<AppEnv> = {}): AppEnv {
  return {
    NODE_ENV: 'test',
    PORT: 4000,
    DATABASE_URL: undefined,
    CORS_ORIGIN: [],
    JWT_SECRET: 'unused',
    JWT_EXPIRES_IN: '12h',
    SHOPIFY_WEBHOOK_SECRET: 'unused',
    SHOPIFY_API_VERSION: '2026-01',
    SHOPIFY_SELLER_INFO_RETRY_DELAY_MS: 25,
    SCHEDULED_RECONCILIATION_ENABLED: false,
    SCHEDULED_RECONCILIATION_EXECUTE_DUE: false,
    SCHEDULED_RECONCILIATION_INTERVAL_MS: 1800000,
    SCHEDULED_RECONCILIATION_COOLDOWN_MS: 1800000,
    SCHEDULED_RECONCILIATION_CANDIDATE_LIMIT: 25,
    EMAIL_NOTIFICATIONS_ENABLED: false,
    EMAIL_PROVIDER: 'noop',
    EMAIL_ADMIN_RECIPIENTS: [],
    SHIPPING_EXECUTION_ENABLED: false,
    SHIPPING_SANDBOX_MODE: false,
    SHIPPING_PROVIDER: 'kargonomi',
    KARGO_ENTEGRATOR_ENABLED: false,
    KARGO_ENTEGRATOR_WEBHOOK_INGEST_ENABLED: false,
    TRY_OTO_ENABLED: false,
    TRY_OTO_SANDBOX_MODE: false,
    TRY_OTO_WEBHOOK_INGEST_ENABLED: false,
    KARGONOMI_BASE_URL: 'https://app.kargonomi.com.tr/api/v1',
    KARGONOMI_API_TOKEN: 'secret-token',
    ...overrides,
  };
}

function registerRoute(env: AppEnv) {
  const gets = new Map<string, (request: { authUser?: { role?: string } }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => unknown>();
  const app = {
    get: vi.fn((path: string, ...args: unknown[]) => {
      const handler = args.at(-1) as (
        request: { authUser?: { role?: string } },
        reply: { code: (status: number) => { send: (body: unknown) => unknown } },
      ) => unknown;
      gets.set(path, handler);
    }),
    post: vi.fn(),
  };
  registerDiagnosticsRoutes(app as never, env);
  return gets.get('/admin/diagnostics/kargonomi/location-lookup');
}

function buildReply() {
  return {
    code: vi.fn((status: number) => ({
      send: vi.fn((body: unknown) => ({ status, body })),
    })),
  };
}

describe('Kargonomi location lookup diagnostics route', () => {
  it('requires admin access', async () => {
    const handler = registerRoute(buildEnv());
    const reply = buildReply();

    const result = await handler?.({ authUser: { role: 'vendor' } }, reply);

    expect(result).toMatchObject({
      status: 403,
      body: { message: 'Forbidden' },
    });
  });

  it('returns sanitized states and cities diagnostics without exposing token', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      const body = String(url).endsWith('/states/1')
        ? { data: [{ id: 34, name: 'İstanbul' }, { id: 6, name: 'Ankara' }] }
        : { data: [{ id: 829, name: 'Kartal' }, { id: 830, name: 'Kadıköy' }] };

      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    try {
      const handler = registerRoute(buildEnv());
      const result = await handler?.({ authUser: { role: 'admin' } }, buildReply());

      expect(result).toMatchObject({
        baseUrlHost: 'app.kargonomi.com.tr',
        baseUrlPath: '/api/v1',
        tokenPresent: true,
        statesRequestUrl: '/states/1',
        statesHttpStatus: 200,
        firstStateNames: ['İstanbul', 'Ankara'],
        istanbulStateId: '34',
        citiesRequestUrl: '/cities/34',
        citiesHttpStatus: 200,
        firstCityNames: ['Kartal', 'Kadıköy'],
      });
      expect(calls.map((call) => [call.init.method, call.url])).toEqual([
        ['GET', 'https://app.kargonomi.com.tr/api/v1/states/1'],
        ['GET', 'https://app.kargonomi.com.tr/api/v1/cities/34'],
      ]);
      expect(JSON.stringify(result)).not.toContain('secret-token');
      expect(calls.some((call) => call.url.endsWith('/shipments'))).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('returns fetch failed diagnostics safely', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('fetch failed')) as unknown as typeof fetch;

    try {
      const handler = registerRoute(buildEnv());
      const result = await handler?.({ authUser: { role: 'admin' } }, buildReply());

      expect(result).toMatchObject({
        statesRequestUrl: '/states/1',
        statesFetchError: {
          name: 'TypeError',
          message: 'fetch failed',
        },
      });
      expect(JSON.stringify(result)).not.toContain('secret-token');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
