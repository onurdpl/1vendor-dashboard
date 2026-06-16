import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppEnv } from '../backend/src/config/env.js';

const prismaMock = vi.hoisted(() => ({
  shopifyOrder: {
    findFirst: vi.fn(),
  },
  webhookEvent: {
    findMany: vi.fn(),
  },
}));

vi.mock('../backend/src/db/prisma.js', () => ({
  prisma: prismaMock,
}));

const { getOrderAddressHistoryDiagnostic, getOrderAddressPersistenceDiagnostic } = await import('../backend/src/modules/diagnostics/diagnostics.service.js');
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

function registerOrderDiagnosticRoute(path: string) {
  const gets = new Map<string, (request: { authUser?: { role?: string }; params: { orderNumber: string } }, reply: ReturnType<typeof buildReply>) => unknown>();
  const app = {
    get: vi.fn((path: string, ...args: unknown[]) => {
      const handler = args.at(-1) as (request: { authUser?: { role?: string }; params: { orderNumber: string } }, reply: ReturnType<typeof buildReply>) => unknown;
      gets.set(path, handler);
    }),
    post: vi.fn(),
  };
  registerDiagnosticsRoutes(app as never, buildEnv());
  return gets.get(path);
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
    prismaMock.webhookEvent.findMany.mockReset();
  });

  it('requires admin access on the diagnostic route', async () => {
    const handler = registerOrderDiagnosticRoute('/admin/diagnostics/orders/:orderNumber/address-persistence');
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

function buildWebhookEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'webhook-create-1',
    topic: 'orders/create',
    receivedAt: new Date('2026-06-01T10:00:00.000Z'),
    processedAt: new Date('2026-06-01T10:00:01.000Z'),
    shopifyOrderId: 'order-db-1',
    rawPayload: buildRawPayload(),
    ...overrides,
  };
}

describe('order address history diagnostic', () => {
  beforeEach(() => {
    prismaMock.shopifyOrder.findFirst.mockReset();
    prismaMock.webhookEvent.findMany.mockReset();
  });

  it('requires admin access on the address history route', async () => {
    const handler = registerOrderDiagnosticRoute('/admin/diagnostics/orders/:orderNumber/address-history');
    const result = await handler?.({ authUser: { role: 'vendor' }, params: { orderNumber: '1080' } }, buildReply());

    expect(result).toMatchObject({
      status: 403,
      body: { message: 'Forbidden' },
    });
    expect(prismaMock.shopifyOrder.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.webhookEvent.findMany).not.toHaveBeenCalled();
  });

  it('reports create-only address history', async () => {
    prismaMock.shopifyOrder.findFirst.mockResolvedValueOnce(buildOrder());
    prismaMock.webhookEvent.findMany.mockResolvedValueOnce([buildWebhookEvent()]);

    const diagnostic = await getOrderAddressHistoryDiagnostic('1080');

    expect(prismaMock.webhookEvent.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        AND: expect.any(Array),
      }),
    }));
    expect(diagnostic).toMatchObject({
      ok: true,
      orderNumber: '#1080',
      orderId: 'order-db-1',
      shopifyOrderId: '1080-shopify',
      timeline: [
        {
          webhookEventId: 'webhook-create-1',
          topic: 'orders/create',
          receivedAt: '2026-06-01T10:00:00.000Z',
          processedAt: '2026-06-01T10:00:01.000Z',
          shipping_address: {
            address1: 'Orhan Sokak',
            address2: 'Gungoren',
            city: 'istanbul',
            province: 'istanbul',
            zip: '34160',
            country: 'Türkiye',
          },
          billing_address: {
            address1: 'Billing street',
            address2: 'Billing district',
            city: 'istanbul',
            province: 'istanbul',
            zip: '34160',
            country: 'Türkiye',
          },
        },
      ],
      comparison: {
        firstCreate: {
          shipping_address: {
            address1: 'Orhan Sokak',
            address2: 'Gungoren',
          },
        },
        latestUpdate: {
          shipping_address: null,
        },
        currentPersistedOrder: {
          shippingAddress: 'Orhan Sokak, Gungoren',
          shippingCity: 'istanbul',
          shippingDistrict: 'Gungoren',
          shippingPostcode: '34160',
          shippingCountry: 'TR',
        },
      },
      derived: {
        addressChangedAfterCreate: false,
        ordersUpdatedExists: false,
        persistedMatchesLatestWebhook: false,
        likelyRootCause: 'rendering_issue',
      },
    });
    expect(JSON.stringify(diagnostic)).not.toContain('+90 555');
  });

  it('detects create plus orders/updated address change as update_ignored when persisted still matches create', async () => {
    prismaMock.shopifyOrder.findFirst.mockResolvedValueOnce(buildOrder({
      shippingAddress: 'NA, NA NA',
      shippingCity: 'NA',
      shippingDistrict: null,
      shippingPostcode: null,
      shippingCountry: 'TR',
    }));
    prismaMock.webhookEvent.findMany.mockResolvedValueOnce([
      buildWebhookEvent({
        id: 'webhook-create-na',
        rawPayload: buildRawPayload({
          shipping_address: {
            address1: 'NA',
            address2: 'NA NA',
            city: 'NA',
            province: null,
            zip: null,
            country: 'Türkiye',
          },
        }),
      }),
      buildWebhookEvent({
        id: 'webhook-update-1',
        topic: 'orders/updated',
        receivedAt: new Date('2026-06-01T11:00:00.000Z'),
        processedAt: new Date('2026-06-01T11:00:01.000Z'),
        rawPayload: buildRawPayload({
          shipping_address: {
            address1: 'Orhan Sokak',
            address2: null,
            city: 'istanbul',
            province: 'istanbul',
            zip: '34160',
            country: 'Türkiye',
          },
        }),
      }),
    ]);

    const diagnostic = await getOrderAddressHistoryDiagnostic('#1080');

    expect(diagnostic).toMatchObject({
      comparison: {
        firstCreate: {
          shipping_address: {
            address1: 'NA',
            address2: 'NA NA',
            city: 'NA',
            zip: null,
          },
        },
        latestUpdate: {
          shipping_address: {
            address1: 'Orhan Sokak',
            city: 'istanbul',
            zip: '34160',
          },
        },
      },
      derived: {
        addressChangedAfterCreate: true,
        ordersUpdatedExists: true,
        persistedMatchesLatestWebhook: false,
        likelyRootCause: 'update_ignored',
      },
    });
  });

  it('detects persisted mismatch against latest webhook as persistence_issue', async () => {
    prismaMock.shopifyOrder.findFirst.mockResolvedValueOnce(buildOrder({
      shippingAddress: 'Different address',
      shippingCity: 'istanbul',
      shippingPostcode: '34160',
    }));
    prismaMock.webhookEvent.findMany.mockResolvedValueOnce([
      buildWebhookEvent(),
      buildWebhookEvent({
        id: 'webhook-update-same',
        topic: 'orders/updated',
        receivedAt: new Date('2026-06-01T11:00:00.000Z'),
        processedAt: new Date('2026-06-01T11:00:01.000Z'),
      }),
    ]);

    const diagnostic = await getOrderAddressHistoryDiagnostic('1080');

    expect(diagnostic).toMatchObject({
      derived: {
        addressChangedAfterCreate: false,
        ordersUpdatedExists: true,
        persistedMatchesLatestWebhook: false,
        likelyRootCause: 'persistence_issue',
      },
    });
  });

  it('reports update_processed when persisted address matches the latest orders/updated payload', async () => {
    prismaMock.shopifyOrder.findFirst.mockResolvedValueOnce(buildOrder({
      shippingAddress: 'Orhan Sokak',
      shippingCity: 'istanbul',
      shippingDistrict: null,
      shippingPostcode: '34160',
      shippingCountry: 'TR',
    }));
    prismaMock.webhookEvent.findMany.mockResolvedValueOnce([
      buildWebhookEvent({
        id: 'webhook-create-na',
        rawPayload: buildRawPayload({
          shipping_address: {
            address1: 'NA',
            address2: 'NA NA',
            city: 'NA',
            province: null,
            zip: null,
            country: 'Türkiye',
          },
        }),
      }),
      buildWebhookEvent({
        id: 'webhook-update-processed',
        topic: 'orders/updated',
        receivedAt: new Date('2026-06-01T11:00:00.000Z'),
        processedAt: new Date('2026-06-01T11:00:01.000Z'),
        rawPayload: buildRawPayload({
          shipping_address: {
            address1: 'Orhan Sokak',
            address2: null,
            city: 'istanbul',
            province: 'istanbul',
            zip: '34160',
            country: 'Türkiye',
          },
        }),
      }),
    ]);

    const diagnostic = await getOrderAddressHistoryDiagnostic('1080');

    expect(diagnostic).toMatchObject({
      derived: {
        addressChangedAfterCreate: true,
        ordersUpdatedExists: true,
        persistedMatchesLatestWebhook: true,
        likelyRootCause: 'update_processed',
      },
    });
  });

  it('classifies placeholder create-only address as create_payload_missing', async () => {
    prismaMock.shopifyOrder.findFirst.mockResolvedValueOnce(buildOrder({
      shippingAddress: 'NA, NA NA',
      shippingCity: 'NA',
      shippingPostcode: null,
    }));
    prismaMock.webhookEvent.findMany.mockResolvedValueOnce([
      buildWebhookEvent({
        rawPayload: buildRawPayload({
          shipping_address: {
            address1: 'NA',
            address2: 'NA NA',
            city: 'NA',
            province: null,
            zip: null,
            country: null,
          },
        }),
      }),
    ]);

    const diagnostic = await getOrderAddressHistoryDiagnostic('1080');

    expect(diagnostic).toMatchObject({
      derived: {
        addressChangedAfterCreate: false,
        ordersUpdatedExists: false,
        persistedMatchesLatestWebhook: false,
        likelyRootCause: 'create_payload_missing',
      },
    });
  });
});
