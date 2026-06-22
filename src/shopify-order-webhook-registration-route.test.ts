import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppEnv } from '../backend/src/config/env.js';

const registrationLibMock = vi.hoisted(() => ({
  createShopifyGraphqlClient: vi.fn(() => ({ kind: 'client' })),
  isValidShopDomain: vi.fn(() => true),
  registerWebhookTopics: vi.fn(),
}));

vi.mock('../backend/scripts/shopify-webhook-registration-lib.mjs', () => registrationLibMock);

const { registerShopifyOrderWebhookRegistrationRoutes } = await import('../backend/src/modules/shopify/order-webhook-registration.routes.js');

function buildEnv(overrides: Partial<AppEnv> = {}): AppEnv {
  return {
    NODE_ENV: 'test',
    PORT: 4000,
    DATABASE_URL: undefined,
    CORS_ORIGIN: [],
    JWT_SECRET: 'test-secret',
    JWT_EXPIRES_IN: '12h',
    LOGIN_RATE_LIMIT_MAX_ATTEMPTS: 10,
    LOGIN_RATE_LIMIT_WINDOW_SECONDS: 600,
    SHOPIFY_WEBHOOK_SECRET: 'unused',
    SHOPIFY_SHOP_DOMAIN: 'sporgym.myshopify.com',
    SHOPIFY_ADMIN_ACCESS_TOKEN: 'shpat_secret_token',
    SHOPIFY_API_VERSION: '2026-01',
    SHOPIFY_ORDER_WEBHOOK_BASE_URL: 'https://backend.example',
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
    SHIPPING_PROVIDER: 'hepsijet',
    KARGO_ENTEGRATOR_ENABLED: false,
    KARGO_ENTEGRATOR_WEBHOOK_INGEST_ENABLED: false,
    TRY_OTO_ENABLED: false,
    TRY_OTO_SANDBOX_MODE: false,
    TRY_OTO_WEBHOOK_INGEST_ENABLED: false,
    ...overrides,
  };
}

function registerRoute(env: AppEnv = buildEnv()) {
  const posts = new Map<string, (request: { authUser?: { role?: string } }, reply: ReturnType<typeof buildReply>) => unknown>();
  const app = {
    post: vi.fn((path: string, ...args: unknown[]) => {
      const handler = args.at(-1) as (request: { authUser?: { role?: string } }, reply: ReturnType<typeof buildReply>) => unknown;
      posts.set(path, handler);
    }),
  };
  registerShopifyOrderWebhookRegistrationRoutes(app as never, env);
  return posts.get('/admin/shopify/order-webhooks/register');
}

function buildReply() {
  return {
    code: vi.fn((status: number) => ({
      send: vi.fn((body: unknown) => ({ status, body })),
    })),
  };
}

describe('admin Shopify order webhook registration route', () => {
  beforeEach(() => {
    registrationLibMock.createShopifyGraphqlClient.mockClear();
    registrationLibMock.isValidShopDomain.mockClear();
    registrationLibMock.isValidShopDomain.mockReturnValue(true);
    registrationLibMock.registerWebhookTopics.mockReset();
  });

  it('enforces admin access', async () => {
    const handler = registerRoute();

    const result = await handler?.({ authUser: { role: 'vendor' } }, buildReply());

    expect(result).toMatchObject({
      status: 403,
      body: { message: 'Forbidden' },
    });
    expect(registrationLibMock.registerWebhookTopics).not.toHaveBeenCalled();
  });

  it('skips existing ORDERS_CREATE and creates missing ORDERS_UPDATED', async () => {
    registrationLibMock.registerWebhookTopics.mockResolvedValueOnce({
      existing: [
        {
          topic: 'ORDERS_CREATE',
          callbackUrl: 'https://backend.example/webhooks/shopify/orders-create',
          subscriptionId: 'gid://shopify/WebhookSubscription/1',
        },
      ],
      created: [
        {
          topic: 'ORDERS_UPDATED',
          callbackUrl: 'https://backend.example/webhooks/shopify/orders-updated',
          subscriptionId: 'gid://shopify/WebhookSubscription/2',
        },
      ],
      failed: [],
    });
    const handler = registerRoute();

    const result = await handler?.({ authUser: { role: 'admin' } }, buildReply());

    expect(registrationLibMock.registerWebhookTopics).toHaveBeenCalledWith({
      client: { kind: 'client' },
      topics: [
        { topic: 'ORDERS_CREATE', routePath: '/webhooks/shopify/orders-create' },
        { topic: 'ORDERS_UPDATED', routePath: '/webhooks/shopify/orders-updated' },
      ],
      baseUrl: 'https://backend.example',
    });
    expect(result).toMatchObject({
      ok: true,
      baseUrl: 'https://backend.example',
      results: [
        {
          topic: 'ORDERS_CREATE',
          action: 'exists',
          subscriptionId: 'gid://shopify/WebhookSubscription/1',
        },
        {
          topic: 'ORDERS_UPDATED',
          action: 'created',
          subscriptionId: 'gid://shopify/WebhookSubscription/2',
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain('shpat_secret_token');
  });

  it('reports callback mismatch without exposing secrets', async () => {
    registrationLibMock.registerWebhookTopics.mockResolvedValueOnce({
      existing: [],
      created: [],
      failed: [
        {
          topic: 'ORDERS_UPDATED',
          callbackUrl: 'https://backend.example/webhooks/shopify/orders-updated',
          reason: 'Existing ORDERS_UPDATED subscription uses a different callback URL: https://old.example/webhooks/shopify/orders-updated',
        },
      ],
    });
    const handler = registerRoute();

    const result = await handler?.({ authUser: { role: 'admin' } }, buildReply());

    expect(result).toMatchObject({
      status: 502,
      body: {
        ok: false,
        results: [
          {
            topic: 'ORDERS_UPDATED',
            action: 'mismatch',
            subscriptionId: null,
          },
        ],
      },
    });
    expect(JSON.stringify(result)).not.toContain('shpat_secret_token');
  });

  it('uses the explicit Render backend fallback when no base URL env is configured', async () => {
    registrationLibMock.registerWebhookTopics.mockResolvedValueOnce({
      existing: [],
      created: [],
      failed: [],
    });
    const handler = registerRoute(buildEnv({ SHOPIFY_ORDER_WEBHOOK_BASE_URL: undefined }));

    await handler?.({ authUser: { role: 'admin' } }, buildReply());

    expect(registrationLibMock.registerWebhookTopics).toHaveBeenCalledWith(expect.objectContaining({
      baseUrl: 'https://vendor-dashboard-backend-398h.onrender.com',
    }));
  });
});
