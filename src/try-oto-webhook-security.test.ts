import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadEnv, type AppEnv } from '../backend/src/config/env.js';

const prismaMock = vi.hoisted(() => ({
  shipmentExecution: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
  },
  fulfillment: {
    upsert: vi.fn(),
  },
}));

vi.mock('../backend/src/db/prisma.js', () => ({
  prisma: prismaMock,
}));

const { registerShippingExecutionRoutes } = await import('../backend/src/modules/shipping/shipping-execution.routes.js');

const originalEnv = { ...process.env };

function resetEnv(overrides: Record<string, string | undefined>) {
  process.env = {
    ...originalEnv,
    NODE_ENV: 'test',
    JWT_SECRET: 'test',
    SHOPIFY_WEBHOOK_SECRET: 'test',
    SHIPPING_PROVIDER: 'kargonomi',
    KARGONOMI_BASE_URL: 'https://app.kargonomi.com.tr/api/v1',
    KARGONOMI_API_TOKEN: 'configured-token',
    ...overrides,
  };
}

function buildEnv(overrides: Partial<AppEnv> = {}): AppEnv {
  return {
    NODE_ENV: 'test',
    PORT: 4000,
    DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:5432/vendor_dashboard_dev',
    CORS_ORIGIN: ['http://localhost:5173'],
    JWT_SECRET: 'test',
    JWT_EXPIRES_IN: '12h',
    SHOPIFY_WEBHOOK_SECRET: 'test',
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
    SHIPPING_EXECUTION_ENABLED: true,
    SHIPPING_SANDBOX_MODE: false,
    SHIPPING_PROVIDER: 'kargonomi',
    KARGO_ENTEGRATOR_ENABLED: false,
    KARGO_ENTEGRATOR_WEBHOOK_INGEST_ENABLED: false,
    TRY_OTO_ENABLED: true,
    TRY_OTO_SANDBOX_MODE: false,
    TRY_OTO_WEBHOOK_INGEST_ENABLED: true,
    KARGONOMI_BASE_URL: 'https://app.kargonomi.com.tr/api/v1',
    KARGONOMI_API_TOKEN: 'configured-token',
    KARGONOMI_APP_KEY: undefined,
    KARGONOMI_DEFAULT_WAREHOUSE_ID: undefined,
    NAVLUNGO_BASE_URL: undefined,
    NAVLUNGO_API_USERNAME: undefined,
    NAVLUNGO_API_PASSWORD: undefined,
    NAVLUNGO_DEFAULT_SENDER_ADDRESS_ID: undefined,
    NAVLUNGO_RETURN_RECIPIENT_ADDRESS_ID: undefined,
    NAVLUNGO_DEFAULT_BARCODE_FORMAT: undefined,
    NAVLUNGO_DEFAULT_CARRIER_ID: undefined,
    ...overrides,
  };
}

function createWebhookRoute(env: AppEnv) {
  const posts = new Map<
    string,
    (
      request: { body?: unknown; method?: string; headers?: Record<string, string> },
      reply: { code: (status: number) => { send: (body: unknown) => unknown } },
    ) => unknown
  >();
  const app = {
    get: vi.fn(),
    put: vi.fn(),
    post: vi.fn((path: string, ...args: unknown[]) => {
      const handler = args.at(-1) as (
        request: { body?: unknown; method?: string; headers?: Record<string, string> },
        reply: { code: (status: number) => { send: (body: unknown) => unknown } },
      ) => unknown;
      posts.set(path, handler);
    }),
  };

  registerShippingExecutionRoutes(app as never, env);
  return posts.get('/webhooks/try-oto');
}

function createReply() {
  return {
    code: vi.fn((status: number) => ({
      send: vi.fn((body: unknown) => ({ status, body })),
    })),
  };
}

describe('Try OTO webhook security', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.shipmentExecution.findFirst.mockResolvedValue(null);
    prismaMock.shipmentExecution.findMany.mockResolvedValue([]);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('does not require Try OTO webhook secret in production because ingest is passive', () => {
    resetEnv({
      NODE_ENV: 'production',
      CORS_ORIGIN: 'https://onevendor-dashboard.onrender.com',
      SHOPIFY_SHOP_DOMAIN: 'sporgym-test.myshopify.com',
      SHOPIFY_ADMIN_ACCESS_TOKEN: 'configured-admin-token',
      TRY_OTO_WEBHOOK_INGEST_ENABLED: 'true',
      TRY_OTO_WEBHOOK_SHARED_SECRET: undefined,
    });

    const env = loadEnv();

    expect(env.SHIPPING_PROVIDER).toBe('kargonomi');
    expect(env.TRY_OTO_WEBHOOK_INGEST_ENABLED).toBe(false);
    expect(env.TRY_OTO_WEBHOOK_SHARED_SECRET).toBeUndefined();
  });

  it('ignores short Try OTO webhook secret because ingest is passive', () => {
    resetEnv({
      NODE_ENV: 'production',
      CORS_ORIGIN: 'https://onevendor-dashboard.onrender.com',
      SHOPIFY_SHOP_DOMAIN: 'sporgym-test.myshopify.com',
      SHOPIFY_ADMIN_ACCESS_TOKEN: 'configured-admin-token',
      TRY_OTO_WEBHOOK_INGEST_ENABLED: 'true',
      TRY_OTO_WEBHOOK_SHARED_SECRET: 'short-secret',
    });

    const env = loadEnv();

    expect(env.TRY_OTO_WEBHOOK_INGEST_ENABLED).toBe(false);
    expect(env.TRY_OTO_WEBHOOK_SHARED_SECRET).toBe('short-secret');
  });

  it('returns inactive-provider response without mutating when called without a shared secret header', async () => {
    const handler = createWebhookRoute(buildEnv({ TRY_OTO_WEBHOOK_SHARED_SECRET: 'try-oto-webhook-shared-secret-12345' }));

    const result = await handler?.(
      { body: { data: { orderId: 'OTO-ORDER-1' } }, method: 'POST', headers: { 'content-type': 'application/json' } },
      createReply(),
    );

    expect(result).toEqual({
      status: 409,
      body: {
        code: 'inactive_shipping_provider',
        provider: 'try_oto',
        activeProvider: 'kargonomi',
        message: 'Try OTO is passive. Kargonomi is the only active shipping provider.',
      },
    });
    expect(prismaMock.shipmentExecution.update).not.toHaveBeenCalled();
  });

  it('returns inactive-provider response without exposing secret values', async () => {
    const handler = createWebhookRoute(buildEnv({ TRY_OTO_WEBHOOK_SHARED_SECRET: 'try-oto-webhook-shared-secret-12345' }));

    const result = await handler?.(
      {
        body: { data: { orderId: 'OTO-ORDER-1' } },
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-try-oto-webhook-secret': 'invalid-secret-value',
        },
      },
      createReply(),
    );

    expect(result).toEqual({
      status: 409,
      body: {
        code: 'inactive_shipping_provider',
        provider: 'try_oto',
        activeProvider: 'kargonomi',
        message: 'Try OTO is passive. Kargonomi is the only active shipping provider.',
      },
    });
    expect(prismaMock.shipmentExecution.update).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('invalid-secret-value');
    expect(JSON.stringify(result)).not.toContain('try-oto-webhook-shared-secret-12345');
  });

  it('does not ingest even when the legacy shared secret header is valid', async () => {
    const handler = createWebhookRoute(buildEnv({ TRY_OTO_WEBHOOK_SHARED_SECRET: 'try-oto-webhook-shared-secret-12345' }));

    const result = await handler?.(
      {
        body: { data: { unknown: true } },
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-try-oto-webhook-secret': 'try-oto-webhook-shared-secret-12345',
        },
      },
      createReply(),
    );

    expect(result).toMatchObject({
      status: 409,
      body: {
        code: 'inactive_shipping_provider',
        provider: 'try_oto',
        activeProvider: 'kargonomi',
      },
    });
    expect(prismaMock.shipmentExecution.update).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('try-oto-webhook-shared-secret-12345');
  });

  it('keeps non-production Try OTO webhook ingest passive without a shared secret', async () => {
    const handler = createWebhookRoute(buildEnv({ TRY_OTO_WEBHOOK_SHARED_SECRET: undefined }));

    const result = await handler?.(
      { body: { data: { unknown: true } }, method: 'POST', headers: { 'content-type': 'application/json' } },
      createReply(),
    );

    expect(result).toMatchObject({
      status: 409,
      body: {
        code: 'inactive_shipping_provider',
        provider: 'try_oto',
        activeProvider: 'kargonomi',
      },
    });
    expect(prismaMock.shipmentExecution.update).not.toHaveBeenCalled();
  });
});
