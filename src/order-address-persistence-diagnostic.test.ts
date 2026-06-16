import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppEnv } from '../backend/src/config/env.js';

const prismaMock = vi.hoisted(() => ({
  shopifyOrder: {
    findFirst: vi.fn(),
  },
}));

vi.mock('../backend/src/db/prisma.js', () => ({
  prisma: prismaMock,
}));

const { getOrderAddressPersistenceDiagnostic } = await import('../backend/src/modules/diagnostics/diagnostics.service.js');
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

function buildRawPayload(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    id: 1080,
    name: '#1080',
    shipping_address: {
      address1: 'Orhan Sokak',
      address2: 'Gungoren',
      city: 'istanbul',
      province: 'istanbul',
      zip: '34160',
      country: 'Türkiye',
      country_code: 'TR',
      company: null,
      phone: '+90 555 111 22 33',
    },
    billing_address: {
      address1: 'Billing street',
      address2: 'Billing district',
      city: 'istanbul',
      province: 'istanbul',
      zip: '34160',
      country: 'Türkiye',
      country_code: 'TR',
      company: 'Billing Co',
      phone: '+90 555 444 55 66',
    },
    ...overrides,
  });
}

function buildOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 'order-db-1',
    sourceShopifyOrderId: '1080-shopify',
    sourceShopifyOrderNumber: '#1080',
    customerPhone: '+905551112233',
    billingFullName: 'Billing Customer',
    billingCompany: 'Billing Co',
    billingPhone: '+905554445566',
    billingCity: 'istanbul',
    billingDistrict: 'Billing district',
    billingAddress1: 'Billing street',
    billingAddress2: 'Billing district',
    billingPostcode: '34160',
    shippingCountry: 'TR',
    shippingPostcode: '34160',
    shippingCity: 'istanbul',
    shippingDistrict: 'Gungoren',
    shippingAddress: 'Orhan Sokak, Gungoren',
    webhookEvents: [
      {
        rawPayload: buildRawPayload(),
      },
    ],
    ...overrides,
  };
}

function registerAddressPersistenceRoute() {
  const gets = new Map<string, (request: { authUser?: { role?: string }; params: { orderNumber: string } }, reply: ReturnType<typeof buildReply>) => unknown>();
  const app = {
    get: vi.fn((path: string, ...args: unknown[]) => {
      const handler = args.at(-1) as (request: { authUser?: { role?: string }; params: { orderNumber: string } }, reply: ReturnType<typeof buildReply>) => unknown;
      gets.set(path, handler);
    }),
    post: vi.fn(),
  };
  registerDiagnosticsRoutes(app as never, buildEnv());
  return gets.get('/admin/diagnostics/orders/:orderNumber/address-persistence');
}

function buildReply() {
  return {
    code: vi.fn((status: number) => ({
      send: vi.fn((body: unknown) => ({ status, body })),
    })),
  };
}

describe('order address persistence diagnostic', () => {
  beforeEach(() => {
    prismaMock.shopifyOrder.findFirst.mockReset();
  });

  it('requires admin access on the diagnostic route', async () => {
    const handler = registerAddressPersistenceRoute();
    const result = await handler?.({ authUser: { role: 'vendor' }, params: { orderNumber: '1080' } }, buildReply());

    expect(result).toMatchObject({
      status: 403,
      body: { message: 'Forbidden' },
    });
    expect(prismaMock.shopifyOrder.findFirst).not.toHaveBeenCalled();
  });

  it('compares persisted address fields against stored orders/create payload safely', async () => {
    prismaMock.shopifyOrder.findFirst.mockResolvedValueOnce(buildOrder());

    const diagnostic = await getOrderAddressPersistenceDiagnostic('1080');

    expect(prismaMock.shopifyOrder.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: expect.any(Array),
      }),
    }));
    expect(diagnostic).toMatchObject({
      ok: true,
      orderNumber: '#1080',
      orderId: 'order-db-1',
      shopifyOrderId: '1080-shopify',
      persistedShippingFields: {
        shippingAddress: 'Orhan Sokak, Gungoren',
        shippingCity: 'istanbul',
        shippingDistrict: 'Gungoren',
        shippingPostcode: '34160',
        shippingCountry: 'TR',
        customerPhonePresent: true,
      },
      persistedBillingFields: {
        billingFullName: 'Billing Customer',
        billingCompany: 'Billing Co',
        billingPhonePresent: true,
        billingCity: 'istanbul',
        billingDistrict: 'Billing district',
        billingAddress1: 'Billing street',
        billingAddress2: 'Billing district',
        billingPostcode: '34160',
      },
      rawOrdersCreateWebhook: {
        shipping_address: {
          address1: 'Orhan Sokak',
          address2: 'Gungoren',
          city: 'istanbul',
          province: 'istanbul',
          zip: '34160',
          country: 'Türkiye',
          country_code: 'TR',
          company: null,
          phonePresent: true,
        },
        billing_address: {
          address1: 'Billing street',
          address2: 'Billing district',
          phonePresent: true,
        },
      },
      derived: {
        shippingAddressPersistedFromRaw: 'yes',
        shippingCityPersistedFromRaw: 'yes',
        shippingDistrictSource: 'address2',
        billingAddressPersistedFromRaw: 'yes',
        likelyRootCause: 'rendering_issue',
      },
    });
    expect(JSON.stringify(diagnostic)).not.toContain('+90 555');
    expect(JSON.stringify(diagnostic)).not.toContain('+90555');
  });

  it('reports raw_missing when stored orders/create payload has no address data', async () => {
    prismaMock.shopifyOrder.findFirst.mockResolvedValueOnce(buildOrder({
      customerPhone: null,
      billingPhone: null,
      billingFullName: null,
      billingCompany: null,
      billingCity: null,
      billingDistrict: null,
      billingAddress1: null,
      billingAddress2: null,
      billingPostcode: null,
      shippingCountry: null,
      shippingPostcode: null,
      shippingCity: null,
      shippingDistrict: null,
      shippingAddress: null,
      webhookEvents: [
        {
          rawPayload: JSON.stringify({ id: 1080, name: '#1080' }),
        },
      ],
    }));

    const diagnostic = await getOrderAddressPersistenceDiagnostic('#1080');

    expect(diagnostic).toMatchObject({
      rawOrdersCreateWebhook: {
        shipping_address: {
          address1: null,
          phonePresent: false,
        },
        billing_address: {
          address1: null,
          phonePresent: false,
        },
      },
      derived: {
        shippingAddressPersistedFromRaw: 'unknown',
        shippingCityPersistedFromRaw: 'unknown',
        shippingDistrictSource: 'unknown',
        billingAddressPersistedFromRaw: 'unknown',
        likelyRootCause: 'raw_missing',
      },
    });
  });

  it('reports persistence_missing when raw address exists but persisted fields are missing', async () => {
    prismaMock.shopifyOrder.findFirst.mockResolvedValueOnce(buildOrder({
      shippingAddress: null,
      shippingCity: null,
      shippingPostcode: null,
      shippingCountry: null,
      customerPhone: null,
      billingFullName: null,
      billingCompany: null,
      billingAddress1: null,
      billingAddress2: null,
      billingCity: null,
      billingDistrict: null,
      billingPostcode: null,
      billingPhone: null,
      shippingDistrict: null,
    }));

    const diagnostic = await getOrderAddressPersistenceDiagnostic('1080');

    expect(diagnostic).toMatchObject({
      persistedShippingFields: {
        customerPhonePresent: false,
      },
      persistedBillingFields: {
        billingPhonePresent: false,
      },
      rawOrdersCreateWebhook: {
        shipping_address: {
          phonePresent: true,
        },
        billing_address: {
          phonePresent: true,
        },
      },
      derived: {
        shippingAddressPersistedFromRaw: 'no',
        shippingCityPersistedFromRaw: 'no',
        billingAddressPersistedFromRaw: 'no',
        likelyRootCause: 'persistence_missing',
      },
    });
  });

  it('reports ingestion_missing when persisted address values diverge from raw payload', async () => {
    prismaMock.shopifyOrder.findFirst.mockResolvedValueOnce(buildOrder({
      shippingAddress: 'Different address',
      shippingCity: 'istanbul',
      billingAddress1: 'Different billing address',
    }));

    const diagnostic = await getOrderAddressPersistenceDiagnostic('1080');

    expect(diagnostic).toMatchObject({
      derived: {
        shippingAddressPersistedFromRaw: 'no',
        shippingCityPersistedFromRaw: 'yes',
        billingAddressPersistedFromRaw: 'no',
        likelyRootCause: 'ingestion_missing',
      },
    });
  });
});
