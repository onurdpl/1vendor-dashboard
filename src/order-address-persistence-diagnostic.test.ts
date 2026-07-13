import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppEnv } from '../backend/src/config/env.js';

const prismaMock = vi.hoisted(() => ({
  shopifyOrder: {
    findFirst: vi.fn(),
  },
  webhookEvent: {
    findMany: vi.fn(),
  },
  operationalJob: {
    findMany: vi.fn(),
  },
}));

vi.mock('../backend/src/db/prisma.js', () => ({
  prisma: prismaMock,
}));

const {
  getOrderAddressHistoryDiagnostic,
  getOrderAddressPersistenceDiagnostic,
  getOrderStateInspectorDiagnostic,
  getOrderWebhookEventsDiagnostic,
  listShopifyWebhookSubscriptionDiagnostics,
} = await import('../backend/src/modules/diagnostics/diagnostics.service.js');
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
    SHIPPING_EXECUTION_ENABLED: false,
    SHIPPING_SANDBOX_MODE: false,
    SHIPPING_PROVIDER: 'hepsijet',
    KARGO_ENTEGRATOR_ENABLED: false,
    KARGO_ENTEGRATOR_WEBHOOK_INGEST_ENABLED: false,
    TRY_OTO_ENABLED: false,
    TRY_OTO_SANDBOX_MODE: false,
    TRY_OTO_WEBHOOK_INGEST_ENABLED: false,
  };
}

function buildShopifyEnv(): AppEnv {
  return {
    ...buildEnv(),
    SHOPIFY_SHOP_DOMAIN: 'sporgym.myshopify.com',
    SHOPIFY_ADMIN_ACCESS_TOKEN: 'test-token',
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
    prismaMock.operationalJob.findMany.mockReset();
    prismaMock.operationalJob.findMany.mockResolvedValue([]);
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
    status: 'PROCESSED',
    errorMessage: null,
    shopifyOrderId: 'order-db-1',
    rawPayload: buildRawPayload(),
    ...overrides,
  };
}

describe('Shopify webhook subscription diagnostic', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    delete process.env.SHOPIFY_ORDER_WEBHOOK_BASE_URL;
  });

  it('requires admin access on the subscription diagnostic route', async () => {
    const handler = registerOrderDiagnosticRoute('/admin/diagnostics/shopify/webhook-subscriptions');
    const result = await handler?.({ authUser: { role: 'vendor' }, params: { orderNumber: 'unused' } }, buildReply());

    expect(result).toMatchObject({
      status: 403,
      body: { message: 'Forbidden' },
    });
  });

  it('lists Shopify webhook subscriptions safely and flags missing orders/updated', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        data: {
          webhookSubscriptions: {
            edges: [
              {
                node: {
                  id: 'gid://shopify/WebhookSubscription/1',
                  topic: 'ORDERS_CREATE',
                  endpoint: {
                    __typename: 'WebhookHttpEndpoint',
                    callbackUrl: 'https://backend.example/webhooks/shopify/orders-create',
                  },
                },
              },
            ],
          },
        },
      }),
    })));

    const diagnostic = await listShopifyWebhookSubscriptionDiagnostics(buildShopifyEnv());

    expect(fetch).toHaveBeenCalledWith(
      'https://sporgym.myshopify.com/admin/api/2026-01/graphql.json',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'x-shopify-access-token': 'test-token',
        }),
      }),
    );
    expect(diagnostic).toMatchObject({
      ok: true,
      config: {
        shopDomainConfigured: true,
        adminAccessTokenConfigured: true,
      },
      subscriptions: [
        {
          topic: 'ORDERS_CREATE',
          callbackUrl: 'https://backend.example/webhooks/shopify/orders-create',
          expectedRoutePath: '/webhooks/shopify/orders-create',
          callbackMatchesExpectedRoute: true,
        },
      ],
      derived: {
        ordersCreateSubscribed: true,
        ordersUpdatedSubscribed: false,
        ordersUpdatedCallbackMatchesExpected: false,
        likelyRootCause: 'orders_updated_not_subscribed',
      },
    });
    expect(JSON.stringify(diagnostic)).not.toContain('test-token');
  });

  it('detects orders/updated subscription callback matching the deployed backend base URL', async () => {
    process.env.SHOPIFY_ORDER_WEBHOOK_BASE_URL = 'https://backend.example';
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        data: {
          webhookSubscriptions: {
            edges: [
              {
                node: {
                  id: 'gid://shopify/WebhookSubscription/2',
                  topic: 'ORDERS_UPDATED',
                  endpoint: {
                    __typename: 'WebhookHttpEndpoint',
                    callbackUrl: 'https://backend.example/webhooks/shopify/orders-updated',
                  },
                },
              },
            ],
          },
        },
      }),
    })));

    const diagnostic = await listShopifyWebhookSubscriptionDiagnostics(buildShopifyEnv());

    expect(diagnostic).toMatchObject({
      derived: {
        ordersUpdatedSubscribed: true,
        ordersUpdatedCallbackMatchesExpected: true,
        likelyRootCause: 'unknown',
      },
      subscriptions: [
        {
          topic: 'ORDERS_UPDATED',
          expectedRoutePath: '/webhooks/shopify/orders-updated',
          callbackMatchesExpectedRoute: true,
        },
      ],
    });
  });
});

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

  it('exposes safe raw address keys and exact district candidate values in address history', async () => {
    prismaMock.shopifyOrder.findFirst.mockResolvedValueOnce(buildOrder());
    prismaMock.webhookEvent.findMany.mockResolvedValueOnce([
      buildWebhookEvent({
        rawPayload: buildRawPayload({
          shipping_address: {
            address1: 'İncirağacı Sokak no 6b',
            address2: 'Daire 4',
            districtName: 'Kartal',
            cityArea: null,
            county: null,
            city: 'İstanbul',
            province: 'İstanbul',
            province_code: '34',
            zip: '34870',
            country: 'Türkiye',
            country_code: 'TR',
            company: null,
            latitude: 40.9,
            longitude: 29.2,
            phone: '+90 555 777 88 99',
            localizedFields: {
              district: 'Kartal',
            },
          },
          billing_address: {
            address1: 'Billing Sokak',
            address2: 'Kat 2',
            district_name: 'Maltepe',
            city: 'İstanbul',
            province: 'İstanbul',
            country: 'Türkiye',
            country_code: 'TR',
            phone: '+90 555 000 00 00',
          },
        }),
      }),
    ]);

    const diagnostic = await getOrderAddressHistoryDiagnostic('1080');

    expect(diagnostic).toMatchObject({
      timeline: [
        {
          shipping_address: {
            keys: expect.arrayContaining(['address1', 'address2', 'districtName', 'latitude', 'longitude', 'localizedFields']),
            address1: 'İncirağacı Sokak no 6b',
            address2: 'Daire 4',
            districtName: 'Kartal',
            cityArea: null,
            county: null,
            city: 'İstanbul',
            province: 'İstanbul',
            province_code: '34',
            zip: '34870',
            country: 'Türkiye',
            country_code: 'TR',
            coordinatePresence: {
              latitude: true,
              longitude: true,
            },
            localizedOrCustomFields: {
              localizedFields: {
                present: true,
                type: 'object',
                keys: ['district'],
              },
            },
          },
          billing_address: {
            district_name: 'Maltepe',
          },
        },
      ],
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

describe('order webhook events diagnostic', () => {
  beforeEach(() => {
    prismaMock.shopifyOrder.findFirst.mockReset();
    prismaMock.webhookEvent.findMany.mockReset();
  });

  it('requires admin access on the order webhook events route', async () => {
    const handler = registerOrderDiagnosticRoute('/admin/diagnostics/orders/:orderNumber/webhook-events');
    const result = await handler?.({ authUser: { role: 'vendor' }, params: { orderNumber: '1080' } }, buildReply());

    expect(result).toMatchObject({
      status: 403,
      body: { message: 'Forbidden' },
    });
    expect(prismaMock.shopifyOrder.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.webhookEvent.findMany).not.toHaveBeenCalled();
  });

  it('returns sanitized stored webhook events for one order', async () => {
    prismaMock.shopifyOrder.findFirst.mockResolvedValueOnce(buildOrder());
    prismaMock.webhookEvent.findMany.mockResolvedValueOnce([
      buildWebhookEvent(),
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
            phone: '+90 555 777 88 99',
          },
        }),
      }),
    ]);

    const diagnostic = await getOrderWebhookEventsDiagnostic('1080');

    expect(diagnostic).toMatchObject({
      ok: true,
      orderNumber: '#1080',
      webhookEvents: [
        {
          webhookEventId: 'webhook-create-1',
          topic: 'orders/create',
          hasRawPayload: true,
          safeOrder: {
            shopifyOrderNumber: '#1080',
          },
          shipping_address: {
            address1: 'Orhan Sokak',
            address2: 'Gungoren',
          },
        },
        {
          webhookEventId: 'webhook-update-1',
          topic: 'orders/updated',
          hasRawPayload: true,
          shipping_address: {
            address1: 'Orhan Sokak',
            city: 'istanbul',
            zip: '34160',
          },
        },
      ],
      derived: {
        ordersUpdatedStored: true,
        ordersUpdatedProcessed: true,
      },
    });
    expect(JSON.stringify(diagnostic)).not.toContain('+90 555');
  });
});

function buildInspectorOrder(overrides: Record<string, unknown> = {}) {
  const createdAt = new Date('2026-07-11T16:07:00.000Z');
  const cancelledAt = new Date('2026-07-11T18:07:00.000Z');
  return {
    id: 'order-db-1108',
    sourceShopifyOrderId: '7856124985681',
    sourceShopifyOrderNumber: '#1108',
    shopifyCreatedAt: createdAt,
    currency: 'TRY',
    financialStatus: 'voided',
    cancelledAt,
    cancelReason: 'customer',
    createdAt,
    updatedAt: cancelledAt,
    lineItems: [{ originalVendorId: 'yalispor' }],
    financeEvents: [],
    allocations: [
      {
        id: 'allocation-1108',
        originalVendorId: 'yalispor',
        assignedVendorId: 'yalispor',
        allocationStatus: 'ACTIVE',
        fulfillmentStatus: 'Pending',
        shippingStatus: 'Awaiting Shipment',
        cancellationReason: 'VENDOR_CANCELLED',
        trackingNumber: null,
        carrier: null,
        createdAt,
        updatedAt: cancelledAt,
        originalVendor: { id: 'yalispor', name: 'Yali Spor' },
        assignedVendor: { id: 'yalispor', name: 'Yali Spor' },
        fulfillment: null,
        shipmentExecutions: [],
        returnRecords: [],
        refundRecords: [],
        financeEntries: [
          {
            id: 'ledger-sale-1108',
            vendorId: 'yalispor',
            entryType: 'sale',
            payoutStatus: 'HOLD',
            settlementStatus: 'HELD',
            settledAt: null,
            voidedAt: cancelledAt,
            voidReason: 'shopify_order_cancelled',
            createdAt,
            updatedAt: cancelledAt,
            settlementApprovalLines: [],
            payoutBatchLines: [],
            operationalSignals: [],
          },
        ],
        operationalSignals: [],
      },
    ],
    ...overrides,
  };
}

function buildInspectorWebhook(overrides: Record<string, unknown> = {}) {
  return {
    id: 'webhook-cancel-1108',
    webhookId: 'shopify-webhook-1108',
    topic: 'orders/cancelled',
    receivedAt: new Date('2026-07-11T18:07:00.000Z'),
    processedAt: new Date('2026-07-11T18:07:01.000Z'),
    status: 'PROCESSED',
    errorMessage: null,
    shopifyOrderId: 'order-db-1108',
    rawPayload: JSON.stringify({ id: '7856124985681', name: '#1108', email: 'customer@example.com' }),
    ...overrides,
  };
}

describe('admin order state inspector', () => {
  beforeEach(() => {
    prismaMock.shopifyOrder.findFirst.mockReset();
    prismaMock.webhookEvent.findMany.mockReset();
  });

  it('allows an admin to inspect one order and rejects non-admin roles', async () => {
    const handler = registerOrderDiagnosticRoute('/admin/diagnostics/orders/:orderNumber/state');
    const forbidden = await handler?.(
      { authUser: { role: 'support' }, params: { orderNumber: '1108' } },
      buildReply(),
    );
    expect(forbidden).toMatchObject({ status: 403, body: { message: 'Forbidden' } });

    prismaMock.shopifyOrder.findFirst
      .mockResolvedValueOnce(buildInspectorOrder())
      .mockResolvedValueOnce(buildInspectorOrder());
    prismaMock.webhookEvent.findMany.mockResolvedValueOnce([buildInspectorWebhook()]);

    const diagnostic = await handler?.(
      { authUser: { role: 'admin' }, params: { orderNumber: '#1108' } },
      buildReply(),
    );
    expect(diagnostic).toMatchObject({
      orderIdentity: { orderNumber: '#1108' },
      localOrderState: { isCancelled: true },
    });
  });

  it('returns a safe deterministic 404 when the order is missing', async () => {
    prismaMock.shopifyOrder.findFirst.mockResolvedValueOnce(null);
    const handler = registerOrderDiagnosticRoute('/admin/diagnostics/orders/:orderNumber/state');
    const result = await handler?.(
      { authUser: { role: 'admin' }, params: { orderNumber: 'missing' } },
      buildReply(),
    );

    expect(result).toMatchObject({ status: 404, body: { message: 'Order not found.' } });
  });

  it('explains a simple cancelled order without exposing raw payloads, customer PII, or payment secrets', async () => {
    prismaMock.shopifyOrder.findFirst
      .mockResolvedValueOnce(buildInspectorOrder({
        customerEmail: 'must-not-be-selected@example.com',
        shippingAddress: 'must not be selected',
      }))
      .mockResolvedValueOnce(buildInspectorOrder());
    prismaMock.webhookEvent.findMany.mockResolvedValueOnce([buildInspectorWebhook()]);

    const diagnostic = await getOrderStateInspectorDiagnostic('1108');
    expect(diagnostic).toMatchObject({
      projectionExplanation: {
        orderStatus: {
          label: 'Cancelled',
          reasons: expect.arrayContaining([
            'ShopifyOrder.cancelledAt is the canonical full-order cancellation source.',
            'Raw allocation, fulfillment, and shipping values are preserved as ownership and history; they do not grant operational eligibility.',
          ]),
        },
        fulfillment: { label: 'Fulfillment not required' },
        shipment: { label: 'Shipment not required' },
        tracking: { label: 'Tracking not required' },
        finance: { label: 'Sale voided' },
        actions: expect.arrayContaining([
          expect.objectContaining({ action: 'create_shipment', available: false, blockedReason: 'full_order_cancelled' }),
          expect.objectContaining({ action: 'update_tracking', available: false, blockedReason: 'full_order_cancelled' }),
          expect.objectContaining({ action: 'vendor_reject', available: false, blockedReason: 'full_order_cancelled' }),
          expect.objectContaining({ action: 'allocation_split', available: false, blockedReason: 'full_order_cancelled' }),
          expect.objectContaining({ action: 'vendor_integration_write', available: false, blockedReason: 'full_order_cancelled' }),
        ]),
      },
      repairReadiness: { repairClassification: 'no_repair_needed' },
    });
    const serialized = JSON.stringify(diagnostic);
    expect(serialized).not.toContain('customer@example.com');
    expect(serialized).not.toContain('rawPayload');
    expect(serialized).not.toContain('paymentReference');
    expect(serialized).not.toContain('requestSnapshot');
  });

  it('distinguishes return requests from refund-derived records and explains cancellation conflict evidence', async () => {
    const recordDates = {
      createdAt: new Date('2026-07-11T20:00:00.000Z'),
      updatedAt: new Date('2026-07-11T20:05:00.000Z'),
    };
    const order = buildInspectorOrder();
    const allocation = order.allocations[0];
    allocation.returnRecords = [
      {
        id: 'return-real',
        ownerVendorId: 'yalispor',
        sourceShopifyRefundId: null,
        sourceShopifyReturnId: 'shopify-return-1',
        returnRequestSource: 'shopify_return_request',
        requestCreatedAt: recordDates.createdAt,
        status: 'Requested',
        ...recordDates,
      },
      {
        id: 'return-refund-derived',
        ownerVendorId: 'yalispor',
        sourceShopifyRefundId: 'shopify-refund-1',
        sourceShopifyReturnId: null,
        returnRequestSource: 'shopify_refund',
        requestCreatedAt: null,
        status: 'Refunded',
        ...recordDates,
      },
    ];
    allocation.refundRecords = [{
      id: 'refund-1',
      sourceShopifyRefundId: 'shopify-refund-1',
      status: 'Processed',
      ...recordDates,
    }];
    allocation.operationalSignals = [{
      id: 'signal-1',
      allocationId: 'allocation-1108',
      financeLedgerEntryId: null,
      type: 'canonical_cancellation_conflict',
      severity: 'HIGH',
      status: 'ACTIVE',
      sourceArea: 'RECONCILIATION',
      title: 'Cancellation conflict',
      description: 'Existing refund evidence requires review.',
      suggestedAction: 'Review evidence.',
      triggeredAt: recordDates.createdAt,
      resolvedAt: null,
      metadata: {
        conflictType: 'refund_evidence',
        orderNumber: '#1108',
        customerEmail: 'must-not-leak@example.com',
        accessToken: 'must-not-leak',
      },
    }];

    prismaMock.shopifyOrder.findFirst.mockResolvedValueOnce(order).mockResolvedValueOnce(order);
    prismaMock.webhookEvent.findMany.mockResolvedValueOnce([buildInspectorWebhook()]);
    const diagnostic = await getOrderStateInspectorDiagnostic('#1108');

    expect(diagnostic?.returnRefundState.returnRequests).toHaveLength(1);
    expect(diagnostic?.returnRefundState.refundDerivedReturns).toHaveLength(1);
    expect(diagnostic?.returnRefundState.refundRecords).toHaveLength(1);
    expect(diagnostic).toMatchObject({
      localOrderState: { hasOperationalConflict: true },
      projectionExplanation: { finance: { label: 'Review required' } },
      repairReadiness: { repairClassification: 'cancellation_conflict_review_required' },
      operationalSignals: [{ metadata: { conflictType: 'refund_evidence', orderNumber: '#1108' } }],
    });
    expect(JSON.stringify(diagnostic)).not.toContain('must-not-leak');
  });

  it('shows safe current-state repair history without raw Shopify payloads', async () => {
    const order = buildInspectorOrder();
    prismaMock.shopifyOrder.findFirst.mockResolvedValueOnce(order).mockResolvedValueOnce(order);
    prismaMock.webhookEvent.findMany.mockResolvedValueOnce([]);
    prismaMock.operationalJob.findMany.mockResolvedValueOnce([
      {
        id: 'repair-job-1',
        status: 'COMPLETED',
        payload: {
          operation: 'shopify_current_state_order_repair',
          repairSource: 'shopify_admin_current_state',
          dryRun: false,
          executed: true,
          actorUserId: 'admin-1',
          actorEmail: 'admin@example.com',
          rawPayload: 'must-not-leak',
        },
        startedAt: new Date('2026-07-13T10:00:00.000Z'),
        completedAt: new Date('2026-07-13T10:00:02.000Z'),
        failedAt: null,
        createdAt: new Date('2026-07-13T10:00:00.000Z'),
        errorSummary: null,
      },
    ]);

    const diagnostic = await getOrderStateInspectorDiagnostic('1108');

    expect(diagnostic?.repairHistory).toEqual([
      expect.objectContaining({
        jobId: 'repair-job-1',
        repairSource: 'shopify_admin_current_state',
        repairTimestamp: '2026-07-13T10:00:02.000Z',
        dryRun: false,
        executed: true,
        status: 'COMPLETED',
        actorEmail: 'admin@example.com',
      }),
    ]);
    expect(JSON.stringify(diagnostic)).not.toContain('must-not-leak');
  });

  it('keeps finance, signals, and webhook history target-scoped and enforces result limits', async () => {
    const order = buildInspectorOrder();
    const allocation = order.allocations[0];
    allocation.operationalSignals = Array.from({ length: 60 }, (_, index) => ({
      id: `signal-${index}`,
      allocationId: 'allocation-1108',
      financeLedgerEntryId: 'ledger-sale-1108',
      type: 'test_signal',
      severity: 'INFO',
      status: 'ACTIVE',
      sourceArea: 'DIAGNOSTICS',
      title: `Signal ${index}`,
      description: 'Scoped signal.',
      suggestedAction: null,
      triggeredAt: new Date(1_700_000_000_000 + index),
      resolvedAt: null,
      metadata: null,
    }));
    order.financeEvents = Array.from({ length: 120 }, (_, index) => ({
      id: `finance-event-${index}`,
      vendorId: 'yalispor',
      financeLedgerEntryId: 'ledger-sale-1108',
      eventType: 'SALE_RECORDED',
      amountMinor: 100,
      currency: 'TRY',
      createdAt: new Date(1_700_000_000_000 + index),
    }));
    prismaMock.shopifyOrder.findFirst.mockResolvedValueOnce(order).mockResolvedValueOnce(order);
    prismaMock.webhookEvent.findMany.mockResolvedValueOnce(
      Array.from({ length: 60 }, (_, index) => buildInspectorWebhook({ id: `webhook-${index}` })),
    );

    const diagnostic = await getOrderStateInspectorDiagnostic('1108');
    expect(diagnostic?.operationalSignals).toHaveLength(50);
    expect(diagnostic?.financeState.events).toHaveLength(100);
    expect(diagnostic?.webhookHistory).toHaveLength(50);
    expect(diagnostic?.financeState.ledgers.every((ledger) => ledger.allocationId === 'allocation-1108')).toBe(true);
    expect(prismaMock.webhookEvent.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 50 }));
  });

  it('classifies a local order without allocations as supported current-state repair', async () => {
    const order = buildInspectorOrder({ allocations: [] });
    prismaMock.shopifyOrder.findFirst.mockResolvedValueOnce(order).mockResolvedValueOnce(order);
    prismaMock.webhookEvent.findMany.mockResolvedValueOnce([buildInspectorWebhook()]);

    const diagnostic = await getOrderStateInspectorDiagnostic('1108');
    expect(diagnostic).toMatchObject({
      localOrderState: { allocationCount: 0 },
      repairReadiness: {
        repairNeeded: true,
        repairSupported: true,
        repairClassification: 'current_state_repair_required',
      },
    });
  });
});
