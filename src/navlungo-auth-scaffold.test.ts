import { describe, expect, it, vi } from 'vitest';
import type { AppEnv } from '../backend/src/config/env.js';
import { registerDiagnosticsRoutes } from '../backend/src/modules/diagnostics/diagnostics.routes.js';
import {
  getNavlungoConfigDiagnostics,
  NavlungoAdapter,
  NavlungoHttpClient,
  NAVLUNGO_ENV_NAMES,
  NAVLUNGO_PROVIDER_DISPLAY_NAME,
  NAVLUNGO_PROVIDER_KEY,
  runNavlungoAuthDiagnostics,
} from '../backend/src/modules/shipping/navlungo-provider.adapter.js';

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
    INVOICE_EXECUTION_ENABLED: false,
    INVOICE_PROVIDER: 'bizimhesap',
    BIZIMHESAP_ENABLED: false,
    SHIPPING_EXECUTION_ENABLED: false,
    SHIPPING_SANDBOX_MODE: false,
    SHIPPING_PROVIDER: 'hepsijet',
    KARGO_ENTEGRATOR_ENABLED: false,
    KARGO_ENTEGRATOR_WEBHOOK_INGEST_ENABLED: false,
    TRY_OTO_ENABLED: false,
    TRY_OTO_SANDBOX_MODE: false,
    TRY_OTO_WEBHOOK_INGEST_ENABLED: false,
    NAVLUNGO_BASE_URL: 'https://domestic-api.navlungo.com/v2',
    NAVLUNGO_API_USERNAME: 'api-user',
    NAVLUNGO_API_PASSWORD: 'secret-password',
    NAVLUNGO_DEFAULT_SENDER_ADDRESS_ID: '55574',
    NAVLUNGO_DEFAULT_BARCODE_FORMAT: 'pdf-A6',
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
  return gets.get('/admin/diagnostics/navlungo/auth');
}

function buildReply() {
  return {
    code: vi.fn((status: number) => ({
      send: vi.fn((body: unknown) => ({ status, body })),
    })),
  };
}

describe('Navlungo dormant auth scaffold', () => {
  it('exposes provider constants without enabling runtime shipment execution', () => {
    expect(NAVLUNGO_PROVIDER_KEY).toBe('navlungo');
    expect(NAVLUNGO_PROVIDER_DISPLAY_NAME).toBe('Navlungo');
    expect(NAVLUNGO_ENV_NAMES).toEqual({
      baseUrl: 'NAVLUNGO_BASE_URL',
      apiUsername: 'NAVLUNGO_API_USERNAME',
      apiPassword: 'NAVLUNGO_API_PASSWORD',
      defaultSenderAddressId: 'NAVLUNGO_DEFAULT_SENDER_ADDRESS_ID',
      defaultBarcodeFormat: 'NAVLUNGO_DEFAULT_BARCODE_FORMAT',
    });
    expect(getNavlungoConfigDiagnostics(buildEnv())).toMatchObject({
      provider: 'navlungo',
      displayName: 'Navlungo',
      dormant: true,
      runtimeShipmentExecutionEnabled: false,
      missing: [],
    });
  });

  it('keeps adapter shipment and return execution unsupported', async () => {
    const adapter = new NavlungoAdapter();

    await expect(adapter.createShipment({
      allocationId: 'allocation-1',
      vendorId: 'vendor-1',
      provider: 'hepsijet',
      requestSnapshot: {},
    })).rejects.toThrow('Navlungo adapter is dormant');
    await expect(adapter.createReturnShipment()).rejects.toThrow('Navlungo return shipment creation is not implemented yet.');
  });

  it('uses configured base URL and does not expose credentials in auth diagnostics', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({
        token_type: 'Bearer',
        expires_in: 86400,
        access_token: 'secret-access-token',
        refresh_token: 'secret-refresh-token',
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    const result = await runNavlungoAuthDiagnostics(buildEnv(), { fetchImpl });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://domestic-api.navlungo.com/v2/auth/api');
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.headers).toMatchObject({
      Accept: 'application/json',
      'Content-Type': 'application/json',
    });
    expect(result).toMatchObject({
      baseUrlHost: 'domestic-api.navlungo.com',
      baseUrlPath: '/v2',
      authRequestUrl: '/v2/auth/api',
      authHttpStatus: 200,
      tokenReceived: true,
      refreshTokenReceived: true,
      expiresIn: 86400,
      responseShapeSummary: {
        kind: 'json:object',
        topLevelKeys: ['token_type', 'expires_in', 'access_token', 'refresh_token'],
      },
      responseDataShapeSummary: null,
      tokenKeyPresence: {
        rootAccessToken: true,
        dataAccessToken: false,
        dataToken: false,
        anyTokenLikeKey: true,
      },
      refreshTokenKeyPresence: {
        rootRefreshToken: true,
        dataRefreshToken: false,
      },
      expiresInPresent: true,
      tokenTypePresent: true,
    });
    expect(JSON.stringify(result)).not.toContain('secret-password');
    expect(JSON.stringify(result)).not.toContain('secret-access-token');
    expect(JSON.stringify(result)).not.toContain('secret-refresh-token');
  });

  it('detects live-style data-wrapped auth tokens without exposing token values', async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({
      status: true,
      message: 'Success',
      data: {
        token_type: 'Bearer',
        expires_in: 86400,
        access_token: 'secret-data-access-token',
        refresh_token: 'secret-data-refresh-token',
      },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;

    const result = await runNavlungoAuthDiagnostics(buildEnv(), { fetchImpl });

    expect(result).toMatchObject({
      authHttpStatus: 200,
      responseShapeSummary: {
        kind: 'json:object',
        topLevelKeys: ['status', 'message', 'data'],
      },
      responseDataShapeSummary: {
        kind: 'json:object',
        topLevelKeys: ['token_type', 'expires_in', 'access_token', 'refresh_token'],
      },
      tokenKeyPresence: {
        rootAccessToken: false,
        dataAccessToken: true,
        dataToken: false,
        anyTokenLikeKey: true,
      },
      refreshTokenKeyPresence: {
        rootRefreshToken: false,
        dataRefreshToken: true,
      },
      expiresInPresent: true,
      tokenTypePresent: true,
      tokenReceived: true,
      refreshTokenReceived: true,
      expiresIn: 86400,
    });
    expect(JSON.stringify(result)).not.toContain('secret-password');
    expect(JSON.stringify(result)).not.toContain('secret-data-access-token');
    expect(JSON.stringify(result)).not.toContain('secret-data-refresh-token');
  });

  it('returns network failure diagnostics safely', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('fetch failed')) as unknown as typeof fetch;

    const result = await runNavlungoAuthDiagnostics(buildEnv(), { fetchImpl });

    expect(result).toMatchObject({
      authRequestUrl: '/v2/auth/api',
      authHttpStatus: null,
      tokenReceived: false,
      tokenKeyPresence: {
        rootAccessToken: false,
        dataAccessToken: false,
        dataToken: false,
        anyTokenLikeKey: false,
      },
      fetchError: {
        name: 'TypeError',
        message: 'fetch failed',
      },
    });
    expect(JSON.stringify(result)).not.toContain('secret-password');
  });

  it('HTTP client supports auth only and makes no shipment create calls', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ access_token: 'token' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    const client = new NavlungoHttpClient(buildEnv(), { fetchImpl });
    await client.createAuthToken();

    expect(calls.map((call) => call.url)).toEqual(['https://domestic-api.navlungo.com/v2/auth/api']);
    expect(calls.some((call) => call.url.includes('post/create'))).toBe(false);
  });
});

describe('Navlungo auth diagnostics route', () => {
  it('requires admin access', async () => {
    const handler = registerRoute(buildEnv());
    const result = await handler?.({ authUser: { role: 'vendor' } }, buildReply());

    expect(result).toMatchObject({
      status: 403,
      body: { message: 'Forbidden' },
    });
  });

  it('returns sanitized diagnostics without exposing credentials or tokens', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({
      expires_in: 86400,
      access_token: 'secret-access-token',
      refresh_token: 'secret-refresh-token',
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;

    try {
      const handler = registerRoute(buildEnv());
      const result = await handler?.({ authUser: { role: 'admin' } }, buildReply());

      expect(result).toMatchObject({
        provider: 'navlungo',
        dormant: true,
        usernamePresent: true,
        passwordPresent: true,
        authHttpStatus: 200,
        tokenReceived: true,
        responseDataShapeSummary: null,
        tokenKeyPresence: {
          rootAccessToken: true,
          dataAccessToken: false,
          dataToken: false,
          anyTokenLikeKey: true,
        },
      });
      expect(JSON.stringify(result)).not.toContain('secret-password');
      expect(JSON.stringify(result)).not.toContain('secret-access-token');
      expect(JSON.stringify(result)).not.toContain('secret-refresh-token');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
