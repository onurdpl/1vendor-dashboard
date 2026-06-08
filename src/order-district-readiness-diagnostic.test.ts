import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { AppEnv } from '../backend/src/config/env.js';

const prismaMock = vi.hoisted(() => ({
  shopifyOrder: {
    findFirst: vi.fn(),
  },
  vendorShippingConfig: {
    findUnique: vi.fn(),
  },
}));

vi.mock('../backend/src/db/prisma.js', () => ({
  prisma: prismaMock,
}));

const { getOrderDistrictReadinessDiagnostic } = await import('../backend/src/modules/diagnostics/diagnostics.service.js');
const { registerDiagnosticsRoutes } = await import('../backend/src/modules/diagnostics/diagnostics.routes.js');

function buildEnv(): AppEnv {
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
    PARATIKA_MARKETPLACE_MODEL: 'SELLER_COMMISSION_RATE',
  };
}

function buildOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 'order-1072',
    sourceShopifyOrderNumber: '#1072',
    shippingDistrict: 'Kartal',
    billingDistrict: null,
    shippingCity: 'Istanbul',
    billingCity: 'Istanbul',
    webhookEvents: [
      {
        rawPayload: JSON.stringify({
          order_number: 1072,
          shipping_address: {
            country_code: 'TR',
            city: 'Istanbul',
            province: 'Istanbul',
            address1: 'hidden street address',
            address2: 'Kartal',
            phone: '+905551112233',
          },
          billing_address: {
            city: 'Istanbul',
            province: 'Istanbul',
            address1: 'hidden billing address',
          },
        }),
      },
    ],
    allocations: [
      {
        id: 'alloc-yalispor-1072',
        assignedVendorId: 'yalispor',
        returnRecords: [{ id: 'return-1072' }],
      },
    ],
    ...overrides,
  };
}

function registerRoute() {
  const gets = new Map<string, (request: { authUser?: { role?: string }; params: { orderNumber: string } }, reply: ReturnType<typeof buildReply>) => unknown>();
  const app = {
    get: vi.fn((path: string, ...args: unknown[]) => {
      const handler = args.at(-1) as (request: { authUser?: { role?: string }; params: { orderNumber: string } }, reply: ReturnType<typeof buildReply>) => unknown;
      gets.set(path, handler);
    }),
    post: vi.fn(),
  };
  registerDiagnosticsRoutes(app as never, buildEnv());
  return gets.get('/admin/diagnostics/orders/:orderNumber/district-readiness');
}

function buildReply() {
  return {
    code: vi.fn((status: number) => ({
      send: vi.fn((body: unknown) => ({ status, body })),
    })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.vendorShippingConfig.findUnique.mockResolvedValue({
    providerMetadata: {
      fallbackBuyerStateId: '34',
      fallbackBuyerCityId: '828',
    },
  });
});

describe('order district readiness diagnostic', () => {
  it('requires admin access', async () => {
    const handler = registerRoute();
    const result = await handler?.({ authUser: { role: 'vendor' }, params: { orderNumber: '1072' } }, buildReply());

    expect(result).toMatchObject({
      status: 403,
      body: { message: 'Forbidden' },
    });
    expect(prismaMock.shopifyOrder.findFirst).not.toHaveBeenCalled();
  });

  it('reports persisted district and raw candidate keys without exposing full payload', async () => {
    prismaMock.shopifyOrder.findFirst.mockResolvedValue(buildOrder());

    const result = await getOrderDistrictReadinessDiagnostic('1072');

    expect(result).toMatchObject({
      ok: true,
      orderNumber: '#1072',
      orderId: 'order-1072',
      allocationIds: ['alloc-yalispor-1072'],
      returnIds: ['return-1072'],
      shippingDistrict: 'Kartal',
      billingDistrict: null,
      shippingCity: 'Istanbul',
      billingCity: 'Istanbul',
      shippingProvince: 'Istanbul',
      billingProvince: 'Istanbul',
      districtPresent: true,
      districtSourceField: 'shipping_address.address2',
      districtSourceValue: 'Kartal',
      rawDistrictCandidateKeysPresent: {
        shipping_address: expect.objectContaining({
          district: false,
          address2: true,
          province: true,
        }),
        billing_address: expect.objectContaining({
          district: false,
          province: true,
        }),
      },
      kargonomiReturnSenderPreview: {
        senderCityIdPresent: true,
        senderStateIdPresent: true,
        senderDistrictPresent: true,
      },
    });
    expect(JSON.stringify(result)).not.toContain('hidden street address');
    expect(JSON.stringify(result)).not.toContain('+905551112233');
  });

  it('accepts order numbers with a leading hash', async () => {
    prismaMock.shopifyOrder.findFirst.mockResolvedValue(buildOrder());

    await getOrderDistrictReadinessDiagnostic('#1072');

    expect(prismaMock.shopifyOrder.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          sourceShopifyOrderNumber: {
            in: ['1072', '#1072'],
          },
        },
      }),
    );
  });

  it('falls back to raw candidate district when persisted fields are empty', async () => {
    prismaMock.shopifyOrder.findFirst.mockResolvedValue(
      buildOrder({
        shippingDistrict: null,
        billingDistrict: null,
      }),
    );

    const result = await getOrderDistrictReadinessDiagnostic('1072');

    expect(result).toMatchObject({
      districtPresent: true,
      districtSourceField: 'shipping_address.address2',
      districtSourceValue: 'Kartal',
      kargonomiReturnSenderPreview: {
        senderDistrictPresent: true,
      },
    });
  });

  it('does not report address2 as a raw district candidate for non-Turkey addresses', async () => {
    prismaMock.shopifyOrder.findFirst.mockResolvedValue(
      buildOrder({
        shippingDistrict: null,
        billingDistrict: null,
        webhookEvents: [
          {
            rawPayload: JSON.stringify({
              order_number: 1072,
              shipping_address: {
                country_code: 'US',
                city: 'New York',
                province: 'NY',
                address1: 'hidden street address',
                address2: 'Apartment 4',
              },
            }),
          },
        ],
      }),
    );

    const result = await getOrderDistrictReadinessDiagnostic('1072');

    expect(result).toMatchObject({
      districtSourceField: 'shipping_address.province',
      districtSourceValue: 'NY',
      rawDistrictCandidateKeysPresent: {
        shipping_address: expect.objectContaining({
          address2: false,
          province: true,
        }),
      },
    });
  });

  it('returns null for a missing order', async () => {
    prismaMock.shopifyOrder.findFirst.mockResolvedValue(null);

    await expect(getOrderDistrictReadinessDiagnostic('1072')).resolves.toBeNull();
  });

  it('route returns 404 for a missing order', async () => {
    prismaMock.shopifyOrder.findFirst.mockResolvedValue(null);
    const handler = registerRoute();
    const result = await handler?.({ authUser: { role: 'admin' }, params: { orderNumber: '1072' } }, buildReply());

    expect(result).toMatchObject({
      status: 404,
      body: { message: 'Order not found.' },
    });
  });
});
