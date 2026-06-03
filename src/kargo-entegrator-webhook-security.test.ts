import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadEnv, type AppEnv } from '../backend/src/config/env.js';

const prismaMock = vi.hoisted(() => ({
  shipmentExecution: {
    findFirst: vi.fn(),
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
const configuredSecret = 'kargo-entegrator-webhook-shared-secret-12345';

function resetEnv(overrides: Record<string, string | undefined>) {
  process.env = {
    ...originalEnv,
    NODE_ENV: 'test',
    JWT_SECRET: 'test',
    SHOPIFY_WEBHOOK_SECRET: 'test',
    TRY_OTO_WEBHOOK_INGEST_ENABLED: 'false',
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
    INVOICE_EXECUTION_ENABLED: false,
    INVOICE_PROVIDER: 'bizimhesap',
    BIZIMHESAP_ENABLED: false,
    SHIPPING_EXECUTION_ENABLED: true,
    SHIPPING_SANDBOX_MODE: true,
    SHIPPING_PROVIDER: 'kargo_entegrator',
    KARGO_ENTEGRATOR_ENABLED: true,
    KARGO_ENTEGRATOR_WEBHOOK_INGEST_ENABLED: true,
    KARGO_ENTEGRATOR_BASE_URL: 'https://kargo.example',
    KARGO_ENTEGRATOR_API_KEY: 'test-kargo-key',
    TRY_OTO_ENABLED: false,
    TRY_OTO_SANDBOX_MODE: false,
    TRY_OTO_WEBHOOK_INGEST_ENABLED: false,
    KARGONOMI_BASE_URL: undefined,
    KARGONOMI_API_TOKEN: undefined,
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
  return posts.get('/webhooks/shipping/kargo-entegrator');
}

function createReply() {
  return {
    code: vi.fn((status: number) => ({
      send: vi.fn((body: unknown) => ({ status, body })),
    })),
  };
}

function buildShipmentExecution() {
  return {
    id: 'shipment-kargo_entegrator-alloc-1',
    allocationId: 'alloc-1',
    vendorId: 'sporjinal',
    sourceShopifyOrderId: '7616544244049',
    sourceShopifyOrderNumber: '1027',
    sourceShopifyFulfillmentId: null,
    provider: 'KARGO_ENTEGRATOR',
    providerShipmentId: 'ke-dummy-1',
    trackingNumber: null,
    trackingUrl: null,
    labelUrl: null,
    shipmentStatus: 'PENDING',
    desi: 3,
    cargoIntegrationId: null,
    warehouseId: null,
    shippingCost: null,
    shippingVat: null,
    currency: 'TRY',
    requestSnapshot: {},
    responseSnapshot: {},
    createdAt: new Date('2026-05-15T10:00:00.000Z'),
    updatedAt: new Date('2026-05-15T10:00:00.000Z'),
  };
}

function mockMatchedKargoExecution() {
  const existing = buildShipmentExecution();
  const updated = {
    ...existing,
    trackingNumber: 'DUMMY-TRACK-1',
    shipmentStatus: 'CREATED',
    responseSnapshot: {
      webhookReceived: true,
    },
  };
  prismaMock.shipmentExecution.findFirst.mockResolvedValue(existing);
  prismaMock.shipmentExecution.update.mockResolvedValue(updated);
}

describe('Kargo Entegrator webhook security', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.shipmentExecution.findFirst.mockResolvedValue(null);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('fails production config validation when ingestion is enabled without a shared secret', () => {
    resetEnv({
      NODE_ENV: 'production',
      CORS_ORIGIN: 'https://onevendor-dashboard.onrender.com',
      SHOPIFY_SHOP_DOMAIN: 'sporgym-test.myshopify.com',
      SHOPIFY_ADMIN_ACCESS_TOKEN: 'configured-admin-token',
      KARGO_ENTEGRATOR_WEBHOOK_INGEST_ENABLED: 'true',
      KARGO_ENTEGRATOR_WEBHOOK_SHARED_SECRET: undefined,
    });

    expect(() => loadEnv()).toThrow(
      'KARGO_ENTEGRATOR_WEBHOOK_SHARED_SECRET is required in production when KARGO_ENTEGRATOR_WEBHOOK_INGEST_ENABLED=true.',
    );
  });

  it('fails production config validation when the shared secret is too short', () => {
    resetEnv({
      NODE_ENV: 'production',
      CORS_ORIGIN: 'https://onevendor-dashboard.onrender.com',
      SHOPIFY_SHOP_DOMAIN: 'sporgym-test.myshopify.com',
      SHOPIFY_ADMIN_ACCESS_TOKEN: 'configured-admin-token',
      KARGO_ENTEGRATOR_WEBHOOK_INGEST_ENABLED: 'true',
      KARGO_ENTEGRATOR_WEBHOOK_SHARED_SECRET: 'short-secret',
    });

    expect(() => loadEnv()).toThrow('KARGO_ENTEGRATOR_WEBHOOK_SHARED_SECRET must be at least 32 characters in production.');
  });

  it('returns 401 without mutating when the shared secret header is missing', async () => {
    const handler = createWebhookRoute(buildEnv({ KARGO_ENTEGRATOR_WEBHOOK_SHARED_SECRET: configuredSecret }));

    const result = await handler?.(
      { body: { data: { id: 'ke-dummy-1' } }, method: 'POST', headers: { 'content-type': 'application/json' } },
      createReply(),
    );

    expect(result).toEqual({
      status: 401,
      body: {
        message: 'Kargo Entegratör webhook authenticity verification failed.',
        authenticityVerification: {
          mode: 'shared_secret',
          providerNativeSignatureVerified: false,
          note: 'Provider-native Kargo Entegratör signature semantics remain unknown.',
        },
      },
    });
    expect(prismaMock.shipmentExecution.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.shipmentExecution.update).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain(configuredSecret);
  });

  it('returns 401 without mutating when the shared secret header is invalid', async () => {
    const handler = createWebhookRoute(buildEnv({ KARGO_ENTEGRATOR_WEBHOOK_SHARED_SECRET: configuredSecret }));

    const result = await handler?.(
      {
        body: { data: { id: 'ke-dummy-1' } },
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-kargo-entegrator-webhook-secret': 'invalid-secret-value',
        },
      },
      createReply(),
    );

    expect(result).toEqual({
      status: 401,
      body: {
        message: 'Kargo Entegratör webhook authenticity verification failed.',
        authenticityVerification: {
          mode: 'shared_secret',
          providerNativeSignatureVerified: false,
          note: 'Provider-native Kargo Entegratör signature semantics remain unknown.',
        },
      },
    });
    expect(prismaMock.shipmentExecution.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.shipmentExecution.update).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('invalid-secret-value');
    expect(JSON.stringify(result)).not.toContain(configuredSecret);
  });

  it('allows the existing ingestion path when the shared secret header is valid', async () => {
    mockMatchedKargoExecution();
    const handler = createWebhookRoute(buildEnv({ KARGO_ENTEGRATOR_WEBHOOK_SHARED_SECRET: configuredSecret }));

    const result = await handler?.(
      {
        body: {
          data: {
            id: 'ke-dummy-1',
            status: 'created',
            tracking_number: 'DUMMY-TRACK-1',
          },
        },
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-kargo-entegrator-webhook-secret': configuredSecret,
        },
      },
      createReply(),
    );

    expect(result).toEqual({
      ok: true,
      shipmentExecutionId: 'shipment-kargo_entegrator-alloc-1',
      shipmentStatus: 'created',
    });
    expect(prismaMock.shipmentExecution.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'shipment-kargo_entegrator-alloc-1' },
        data: expect.objectContaining({
          trackingNumber: 'DUMMY-TRACK-1',
          shipmentStatus: 'CREATED',
        }),
      }),
    );
    expect(JSON.stringify(result)).not.toContain(configuredSecret);
  });

  it('preserves non-production local behavior when no shared secret is configured', async () => {
    mockMatchedKargoExecution();
    const handler = createWebhookRoute(buildEnv({ KARGO_ENTEGRATOR_WEBHOOK_SHARED_SECRET: undefined }));

    const result = await handler?.(
      {
        body: {
          data: {
            id: 'ke-dummy-1',
            status: 'created',
            tracking_number: 'DUMMY-TRACK-1',
          },
        },
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      },
      createReply(),
    );

    expect(result).toEqual({
      ok: true,
      shipmentExecutionId: 'shipment-kargo_entegrator-alloc-1',
      shipmentStatus: 'created',
    });
    expect(prismaMock.shipmentExecution.update).toHaveBeenCalled();
  });
});
