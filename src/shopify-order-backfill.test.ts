import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type BackfillLocalStore,
  runShopifyOrderBackfill,
  validateShopifyOrderBackfillEnv,
} from '../backend/src/modules/shopify/order-backfill.service';

const validEnv = {
  SHOPIFY_ORDER_BACKFILL_CONFIRM: 'YES',
  SHOPIFY_ORDER_BACKFILL_NAME: '#1048',
  SHOPIFY_ORDER_BACKFILL_BACKEND_URL: 'https://backend.example.com',
  SHOPIFY_SHOP_DOMAIN: 'shop.example.myshopify.com',
  SHOPIFY_ADMIN_ACCESS_TOKEN: 'shpat_test_token',
  SHOPIFY_API_VERSION: '2024-01',
  SHOPIFY_WEBHOOK_SECRET: 'test_secret',
  SHOPIFY_ORDER_BACKFILL_MAX_AGE_DAYS: '90',
};

function response(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: vi.fn(async () => JSON.stringify(body)),
    json: vi.fn(async () => body),
  };
}

function shopifyOrderNode(name = '#1048') {
  return {
    id: 'gid://shopify/Order/7632165011793',
    legacyResourceId: '7632165011793',
    name,
    createdAt: '2026-05-20T13:07:18Z',
    currencyCode: 'TRY',
    displayFinancialStatus: 'PAID',
    cancelledAt: null,
    cancelReason: null,
    paymentGatewayNames: ['shopify_payments'],
    taxesIncluded: true,
    note: null,
    tags: ['safe-backfill'],
    email: 'customer@example.com',
    phone: null,
    totalPriceSet: {
      shopMoney: {
        amount: '1999.00',
        currencyCode: 'TRY',
      },
    },
    currentTotalTaxSet: {
      shopMoney: {
        amount: '333.17',
        currencyCode: 'TRY',
      },
    },
    totalShippingPriceSet: {
      shopMoney: {
        amount: '0.00',
        currencyCode: 'TRY',
      },
    },
    currentTotalDiscountsSet: {
      shopMoney: {
        amount: '0.00',
        currencyCode: 'TRY',
      },
    },
    customer: {
      email: 'customer@example.com',
      firstName: 'Test',
      lastName: 'Customer',
      phone: '+905551112233',
    },
    shippingAddress: {
      phone: '+905551112233',
      country: 'Turkey',
      countryCodeV2: 'TR',
      zip: '34000',
      city: 'Istanbul',
      province: 'Istanbul',
      address1: 'Safe test street',
      address2: null,
    },
    billingAddress: {
      name: 'Test Customer',
      firstName: 'Test',
      lastName: 'Customer',
      company: null,
      phone: '+905551112233',
      country: 'Turkey',
      countryCodeV2: 'TR',
      zip: '34000',
      city: 'Istanbul',
      province: 'Istanbul',
      address1: 'Safe billing street',
      address2: null,
    },
    metafield: {
      value: JSON.stringify({
        'IF1208-010-L': 'sporjinal',
      }),
    },
    lineItems: {
      pageInfo: {
        hasNextPage: false,
      },
      nodes: [
        {
          id: 'gid://shopify/LineItem/111',
          legacyResourceId: '111',
          sku: 'IF1208-010-L',
          title: 'Safe test item',
          name: 'Safe test item',
          variantTitle: 'L',
          quantity: 1,
          currentQuantity: 1,
          refundableQuantity: 1,
          originalUnitPriceSet: {
            shopMoney: {
              amount: '1999.00',
              currencyCode: 'TRY',
            },
          },
          discountedTotalSet: {
            shopMoney: {
              amount: '1999.00',
              currencyCode: 'TRY',
            },
          },
          taxLines: [
            {
              title: 'VAT',
              rate: 0.2,
              ratePercentage: 20,
              priceSet: {
                shopMoney: {
                  amount: '333.17',
                  currencyCode: 'TRY',
                },
              },
            },
          ],
          variant: {
            id: 'gid://shopify/ProductVariant/222',
            legacyResourceId: '222',
          },
          product: {
            id: 'gid://shopify/Product/333',
            legacyResourceId: '333',
          },
        },
      ],
    },
    fulfillmentOrders: {
      nodes: [
        {
          id: 'gid://shopify/FulfillmentOrder/444',
          status: 'OPEN',
          requestStatus: 'UNSUBMITTED',
          lineItems: {
            nodes: [
              {
                id: 'gid://shopify/FulfillmentOrderLineItem/555',
                remainingQuantity: 1,
                totalQuantity: 1,
                lineItem: {
                  id: 'gid://shopify/LineItem/111',
                },
              },
            ],
          },
        },
      ],
    },
    refunds: {
      nodes: [],
    },
    returns: {
      nodes: [],
    },
  };
}

function localStore(overrides: Partial<BackfillLocalStore> = {}): BackfillLocalStore {
  return {
    findOrderBySourceId: vi.fn(async () => null),
    findOrdersByNumber: vi.fn(async () => []),
    listVendors: vi.fn(async () => [{ id: 'sporjinal' }]),
    listActiveFinancialProfiles: vi.fn(async () => [
      {
        vendorId: 'sporjinal',
        commissionPercent: '12.00',
        commissionVatPercent: '20.00',
        settlementDelayDays: 14,
      },
    ]),
    ...overrides,
  };
}

function shopifyFetchFor(order: unknown) {
  return vi.fn().mockResolvedValueOnce(
    response({
      data: {
        orders: {
          nodes: [order],
        },
      },
    }),
  );
}

describe('manual Shopify order backfill', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-01T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('defaults to dry-run without explicit live confirmation', () => {
    const config = validateShopifyOrderBackfillEnv({
      ...validEnv,
      SHOPIFY_ORDER_BACKFILL_CONFIRM: undefined,
    });

    expect(config.liveConfirmed).toBe(false);
  });

  it('refuses to run without an explicit order name', () => {
    expect(() =>
      validateShopifyOrderBackfillEnv({
        ...validEnv,
        SHOPIFY_ORDER_BACKFILL_NAME: '',
      }),
    ).toThrow(/SHOPIFY_ORDER_BACKFILL_NAME/);
  });

  it('returns an eligible dry-run preflight without mutating when live confirmation is missing', async () => {
    const fetchMock = shopifyFetchFor(shopifyOrderNode('#1048'));

    const result = await runShopifyOrderBackfill(
      {
        ...validEnv,
        SHOPIFY_ORDER_BACKFILL_CONFIRM: undefined,
      },
      { fetch: fetchMock, localStore: localStore() },
    );

    expect(result.ok).toBe(true);
    expect(result.liveBackfillAttempted).toBe(false);
    expect(result.eligibleForLiveBackfill).toBe(true);
    expect(result.expectedVendors).toEqual(['sporjinal']);
    expect(result.expectedAllocations).toEqual(['alloc-sporjinal-7632165011793']);
    expect(result.expectedSaleLedgerIds).toEqual([
      'fin-sporjinal-sale-7632165011793-alloc-sporjinal-7632165011793',
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('imports only the requested eligible order through the existing orders/create endpoint after explicit confirmation', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          data: {
            orders: {
              nodes: [shopifyOrderNode('#1048')],
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        response({
          ok: true,
          duplicate: false,
          action: 'accepted',
          processingStatus: 'processed',
          shopifyOrderId: 'shopify-order-id',
          allocationCount: 1,
        }, 202),
      );

    const result = await runShopifyOrderBackfill(
      {
        ...validEnv,
        SHOPIFY_ORDER_BACKFILL_CONFIRM: 'BACKFILL_FRESH_MISSING_ORDER',
      },
      { fetch: fetchMock, localStore: localStore() },
    );

    expect(result.ok).toBe(true);
    expect(result.orderName).toBe('#1048');
    expect(result.liveBackfillAttempted).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const shopifyRequest = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(shopifyRequest.variables.query).toBe('name:1048');

    const backendUrl = String(fetchMock.mock.calls[1][0]);
    expect(backendUrl).toBe('https://backend.example.com/webhooks/shopify/orders-create');
    const backendBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(backendBody.name).toBe('#1048');
    expect(backendBody.line_items).toHaveLength(1);
    expect(backendBody.currency).toBe('TRY');
    expect(backendBody.financial_status).toBe('paid');
    expect(backendBody.total_discounts).toBe('0.00');
    expect(backendBody.billing_address.name).toBe('Test Customer');
    expect(backendBody.line_items[0].product_id).toBe('333');
    expect(backendBody.line_items[0].tax_lines).toHaveLength(1);
    expect(fetchMock.mock.calls[1][1]?.headers).toMatchObject({
      'x-shopify-topic': 'orders/create',
      'x-shopify-shop-domain': 'shop.example.myshopify.com',
      'x-shopify-webhook-id': 'manual-backfill-orders-create-7632165011793',
    });
  });

  it('does not duplicate an existing order when the backend idempotency path reports duplicate', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          data: {
            orders: {
              nodes: [shopifyOrderNode('#1048')],
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        response({
          ok: true,
          duplicate: true,
          action: 'duplicate_ignored',
        }, 202),
      );

    const result = await runShopifyOrderBackfill(
      {
        ...validEnv,
        SHOPIFY_ORDER_BACKFILL_CONFIRM: 'BACKFILL_FRESH_MISSING_ORDER',
      },
      { fetch: fetchMock, localStore: localStore() },
    );

    expect(result.duplicate).toBe(true);
    expect(result.backendAction).toBe('duplicate_ignored');
  });

  it('does not trigger shipment execution or provider APIs', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          data: {
            orders: {
              nodes: [shopifyOrderNode('#1048')],
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        response({
          ok: true,
          duplicate: false,
          action: 'accepted',
          allocationCount: 1,
        }, 202),
      );

    await runShopifyOrderBackfill(
      {
        ...validEnv,
        SHOPIFY_ORDER_BACKFILL_CONFIRM: 'BACKFILL_FRESH_MISSING_ORDER',
      },
      { fetch: fetchMock, localStore: localStore() },
    );

    const requestedUrls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(requestedUrls).toEqual([
      'https://shop.example.myshopify.com/admin/api/2024-01/graphql.json',
      'https://backend.example.com/webhooks/shopify/orders-create',
    ]);
    expect(requestedUrls.some((url) => /shipments|kargonomi|try_oto|fulfillment/i.test(url))).toBe(false);
  });

  it('blocks an existing local order before calling the webhook endpoint', async () => {
    const fetchMock = shopifyFetchFor(shopifyOrderNode('#1048'));

    const result = await runShopifyOrderBackfill(
      {
        ...validEnv,
        SHOPIFY_ORDER_BACKFILL_CONFIRM: 'BACKFILL_FRESH_MISSING_ORDER',
      },
      {
        fetch: fetchMock,
        localStore: localStore({
          findOrderBySourceId: vi.fn(async () => ({ id: 'existing-local-order' })),
        }),
      },
    );

    expect(result.ok).toBe(false);
    expect(result.liveBackfillAttempted).toBe(false);
    expect(result.blockedReasonCodes).toContain('backfill_order_already_exists');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('blocks duplicate order name conflicts', async () => {
    const result = await runShopifyOrderBackfill(
      {
        ...validEnv,
        SHOPIFY_ORDER_BACKFILL_CONFIRM: 'BACKFILL_FRESH_MISSING_ORDER',
      },
      {
        fetch: shopifyFetchFor(shopifyOrderNode('#1048')),
        localStore: localStore({
          findOrdersByNumber: vi.fn(async () => [{ sourceShopifyOrderId: 'different-shopify-order' }]),
        }),
      },
    );

    expect(result.blockedReasonCodes).toContain('backfill_duplicate_order_name_conflict');
    expect(result.liveBackfillAttempted).toBe(false);
  });

  it.each([
    ['cancelled', { cancelledAt: '2026-05-21T00:00:00Z' }, 'backfill_cancelled_order_blocked'],
    [
      'fulfilled',
      {
        fulfillmentOrders: {
          nodes: [
            {
              id: 'gid://shopify/FulfillmentOrder/444',
              status: 'CLOSED',
              requestStatus: 'UNSUBMITTED',
              lineItems: {
                nodes: [
                  {
                    id: 'gid://shopify/FulfillmentOrderLineItem/555',
                    remainingQuantity: 0,
                    totalQuantity: 1,
                    lineItem: { id: 'gid://shopify/LineItem/111' },
                  },
                ],
              },
            },
          ],
        },
      },
      'backfill_fulfilled_order_blocked',
    ],
    ['partially fulfilled', {
      fulfillmentOrders: {
        nodes: [
          {
            id: 'gid://shopify/FulfillmentOrder/444',
            status: 'OPEN',
            requestStatus: 'UNSUBMITTED',
            lineItems: {
              nodes: [
                {
                  id: 'gid://shopify/FulfillmentOrderLineItem/555',
                  remainingQuantity: 1,
                  totalQuantity: 2,
                  lineItem: { id: 'gid://shopify/LineItem/111' },
                },
              ],
            },
          },
        ],
      },
    }, 'backfill_fulfilled_order_blocked'],
    ['refunded', { refunds: { nodes: [{ id: 'gid://shopify/Refund/1' }] } }, 'backfill_refunded_order_blocked'],
    ['returned', { returns: { nodes: [{ id: 'gid://shopify/Return/1', status: 'OPEN' }] } }, 'backfill_returned_order_blocked'],
  ])('blocks %s orders', async (_label, override, reasonCode) => {
    const order = {
      ...shopifyOrderNode('#1048'),
      ...override,
    };

    const result = await runShopifyOrderBackfill(
      {
        ...validEnv,
        SHOPIFY_ORDER_BACKFILL_CONFIRM: 'BACKFILL_FRESH_MISSING_ORDER',
      },
      { fetch: shopifyFetchFor(order), localStore: localStore() },
    );

    expect(result.blockedReasonCodes).toContain(reasonCode);
    expect(result.liveBackfillAttempted).toBe(false);
  });

  it('blocks historical orders outside the configured safety window', async () => {
    const result = await runShopifyOrderBackfill(
      {
        ...validEnv,
        SHOPIFY_ORDER_BACKFILL_CONFIRM: 'BACKFILL_FRESH_MISSING_ORDER',
        SHOPIFY_ORDER_BACKFILL_MAX_AGE_DAYS: '0',
      },
      { fetch: shopifyFetchFor(shopifyOrderNode('#1048')), localStore: localStore() },
    );

    expect(result.blockedReasonCodes).toContain('backfill_historical_order_requires_manual_review');
    expect(result.liveBackfillAttempted).toBe(false);
  });

  it('blocks missing seller_info', async () => {
    const order = {
      ...shopifyOrderNode('#1048'),
      metafield: null,
    };

    const result = await runShopifyOrderBackfill(
      {
        ...validEnv,
        SHOPIFY_ORDER_BACKFILL_CONFIRM: 'BACKFILL_FRESH_MISSING_ORDER',
      },
      { fetch: shopifyFetchFor(order), localStore: localStore() },
    );

    expect(result.blockedReasonCodes).toContain('backfill_seller_info_missing');
    expect(result.liveBackfillAttempted).toBe(false);
  });

  it('blocks unknown vendor mappings', async () => {
    const order = {
      ...shopifyOrderNode('#1048'),
      metafield: {
        value: JSON.stringify({
          'IF1208-010-L': 'unknownvendor',
        }),
      },
    };

    const result = await runShopifyOrderBackfill(
      {
        ...validEnv,
        SHOPIFY_ORDER_BACKFILL_CONFIRM: 'BACKFILL_FRESH_MISSING_ORDER',
      },
      { fetch: shopifyFetchFor(order), localStore: localStore() },
    );

    expect(result.blockedReasonCodes).toContain('backfill_unknown_vendor');
    expect(result.liveBackfillAttempted).toBe(false);
  });

  it('blocks incomplete synthetic payloads', async () => {
    const order = {
      ...shopifyOrderNode('#1048'),
      currencyCode: null,
      lineItems: {
        pageInfo: {
          hasNextPage: false,
        },
        nodes: [
          {
            ...shopifyOrderNode('#1048').lineItems.nodes[0],
            taxLines: [],
          },
        ],
      },
    };

    const result = await runShopifyOrderBackfill(
      {
        ...validEnv,
        SHOPIFY_ORDER_BACKFILL_CONFIRM: 'BACKFILL_FRESH_MISSING_ORDER',
      },
      { fetch: shopifyFetchFor(order), localStore: localStore() },
    );

    expect(result.blockedReasonCodes).toContain('backfill_payload_incomplete');
    expect(result.missingFields).toContain('order.currencyCode');
    expect(result.liveBackfillAttempted).toBe(false);
  });
});
