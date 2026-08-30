import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppEnv } from '../backend/src/config/env.js';
import {
  CanonicalShopifySnapshotParseError,
  createShopifyAdminService,
} from '../backend/src/modules/shopify/shopify-admin.service.js';
import { __currentStateOrderRepairTesting } from '../backend/src/modules/shopify/current-state-order-repair.service.js';
import type { CanonicalShopifyOrderSnapshot } from '../backend/src/modules/shopify/shopify-admin.types.js';

const env = {
  NODE_ENV: 'test',
  SHOPIFY_SHOP_DOMAIN: 'shop.myshopify.com',
  SHOPIFY_ADMIN_ACCESS_TOKEN: 'test-token',
  SHOPIFY_API_VERSION: '2026-01',
} as AppEnv;

function response(data: unknown) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function refundNode(id: string, lineItemId: string, sku: string) {
  return {
    id: `gid://shopify/Refund/${id}`,
    createdAt: '2026-07-06T08:39:10Z',
    updatedAt: '2026-07-06T08:39:11Z',
    note: null,
    totalRefundedSet: { shopMoney: { amount: '100.00', currencyCode: 'TRY' } },
    transactions: {
      pageInfo: { hasNextPage: false },
      edges: [{
        node: {
          id: `gid://shopify/OrderTransaction/${id}`,
          kind: 'REFUND',
          status: 'SUCCESS',
          amountSet: { shopMoney: { amount: '100.00', currencyCode: 'TRY' } },
          parentTransaction: { id: 'gid://shopify/OrderTransaction/parent' },
          createdAt: '2026-07-06T08:39:10Z',
          processedAt: '2026-07-06T08:39:11Z',
        },
      }],
    },
    refundLineItems: {
      pageInfo: { hasNextPage: false },
      edges: [
        {
          node: {
            id: `gid://shopify/RefundLineItem/${id}01`,
            quantity: 1,
            subtotalSet: { shopMoney: { amount: '100.00', currencyCode: 'TRY' } },
            lineItem: {
              id: `gid://shopify/LineItem/${lineItemId}`,
              sku,
              title: 'Product',
              name: 'Product',
              variantTitle: null,
            },
          },
        },
      ],
    },
  };
}

function returnsConnection(nodes: unknown[] = []) {
  return {
    pageInfo: { hasNextPage: false },
    edges: nodes.map((node) => ({ node })),
  };
}

function canonicalOrderResult() {
  return {
    sourceShopifyOrderId: '7856043819345',
    sourceShopifyOrderNumber: '#1105',
  } as CanonicalShopifyOrderSnapshot;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Shopify API 2026-01 canonical current-state queries', () => {
  it('uses a minimal customer-cancellation ownership query without protected contact data', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({
      data: {
        order: {
          id: 'gid://shopify/Order/7856043819345',
          legacyResourceId: '7856043819345',
          name: '#1105',
          cancelledAt: null,
          customer: { id: 'gid://shopify/Customer/42' },
          lineItems: {
            pageInfo: { hasNextPage: false },
            edges: [{ node: {
              id: 'gid://shopify/LineItem/20754005197137',
              title: 'Product',
              name: 'Product',
              quantity: 2,
              currentQuantity: 2,
              refundableQuantity: 2,
              image: { url: 'https://cdn.shopify.com/product.jpg' },
              variant: { title: 'Large', image: null },
            } }],
          },
          fulfillmentOrders: {
            pageInfo: { hasNextPage: false },
            edges: [{ node: {
              id: 'gid://shopify/FulfillmentOrder/1',
              status: 'OPEN',
              requestStatus: 'UNSUBMITTED',
              lineItems: {
                pageInfo: { hasNextPage: false },
                edges: [{ node: {
                  id: 'gid://shopify/FulfillmentOrderLineItem/1',
                  remainingQuantity: 2,
                  totalQuantity: 2,
                  lineItem: { id: 'gid://shopify/LineItem/20754005197137' },
                } }],
              },
            } }],
          },
        },
      },
    }));

    const result = await createShopifyAdminService(env)
      .fetchCustomerCancellationOrderSnapshot('7856043819345');
    const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as { query: string };

    expect(request.query).toContain('query CustomerCancellationOrderSnapshot');
    expect(request.query).toContain('customer {');
    expect(request.query).not.toMatch(/\bemail\b/);
    expect(request.query).not.toMatch(/\bphone\b/);
    expect(request.query).not.toContain('shippingAddress');
    expect(request.query).not.toContain('billingAddress');
    expect(result).toMatchObject({
      customerGid: 'gid://shopify/Customer/42',
      lineItems: [{
        sourceLineItemId: '20754005197137',
        variantTitle: 'Large',
        currentQuantity: 2,
      }],
      fulfillmentOrders: [{ status: 'OPEN' }],
    });
  });

  it('parses refunds as the API 2026-01 direct Refund list without Refund pageInfo or edges', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({
      data: {
        order: {
          id: 'gid://shopify/Order/7856043819345',
          legacyResourceId: '7856043819345',
          displayFinancialStatus: 'PARTIALLY_REFUNDED',
          totalReceivedSet: { shopMoney: { amount: '200.00', currencyCode: 'TRY' } },
          totalRefundedSet: { shopMoney: { amount: '100.00', currencyCode: 'TRY' } },
          netPaymentSet: { shopMoney: { amount: '100.00', currencyCode: 'TRY' } },
          totalOutstandingSet: { shopMoney: { amount: '0.00', currencyCode: 'TRY' } },
          totalRefundedShippingSet: { shopMoney: { amount: '0.00', currencyCode: 'TRY' } },
          refunds: [refundNode('1083708080465', '20754005197137', 'HJ5228-001-46')],
        },
      },
    }));

    const result = await createShopifyAdminService(env).fetchCanonicalRefundsForOrder('7856043819345');
    const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as { query: string };

    expect(request.query).toContain('refunds(first: 250)');
    expect(request.query).toContain('transactions(first: 250)');
    expect(request.query).toContain('refundLineItems(first: 250)');
    expect(request.query).toContain('totalRefundedSet');
    expect(request.query).toContain('displayFinancialStatus');
    expect(request.query).toContain('totalReceivedSet');
    expect(request.query).toContain('netPaymentSet');
    expect(request.query).toContain('totalOutstandingSet');
    expect(request.query).toContain('totalRefundedShippingSet');
    expect(result).toMatchObject({
      displayFinancialStatus: 'PARTIALLY_REFUNDED',
      orderTotalReceivedAmount: '200.00',
      orderTotalRefundedAmount: '100.00',
      orderNetPaymentAmount: '100.00',
      orderTotalOutstandingAmount: '0.00',
      orderTotalRefundedShippingAmount: '0.00',
    });
    expect(result?.refunds).toHaveLength(1);
    expect(result?.refunds[0].sourceShopifyRefundId).toBe('1083708080465');
  });

  it('preserves multiple refunds and their Shopify order line-item linkage', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({
      data: {
        order: {
          id: 'gid://shopify/Order/7856043819345',
          legacyResourceId: '7856043819345',
          totalRefundedSet: { shopMoney: { amount: '200.00', currencyCode: 'TRY' } },
          refunds: [
            refundNode('1083708080465', '20754005197137', 'HJ5228-001-46'),
            refundNode('1083708080466', '20754005229905', 'HJ5228-300-46'),
          ],
        },
      },
    }));

    const result = await createShopifyAdminService(env).fetchCanonicalRefundsForOrder('7856043819345');

    expect(result?.refunds.map((refund) => refund.sourceShopifyRefundId)).toEqual([
      '1083708080465',
      '1083708080466',
    ]);
    expect(result?.refunds.map((refund) => refund.refundLineItems[0].sourceLineItemId)).toEqual([
      '20754005197137',
      '20754005229905',
    ]);
  });

  it('returns an empty canonical refund collection safely', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({
      data: {
        order: {
          id: 'gid://shopify/Order/7856043819345',
          legacyResourceId: '7856043819345',
          totalRefundedSet: { shopMoney: { amount: '0.00', currencyCode: 'TRY' } },
          refunds: [],
        },
      },
    }));

    await expect(createShopifyAdminService(env).fetchCanonicalRefundsForOrder('7856043819345'))
      .resolves.toMatchObject({ refunds: [] });
  });

  it('marks an exactly 250-refund response incomplete', async () => {
    const refunds = Array.from({ length: 250 }, (_, index) =>
      refundNode(String(10_000 + index), String(20_000 + index), `SKU-${index}`));
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({
      data: {
        order: {
          id: 'gid://shopify/Order/7856043819345',
          legacyResourceId: '7856043819345',
          totalRefundedSet: { shopMoney: { amount: '25000.00', currencyCode: 'TRY' } },
          refunds,
        },
      },
    }));

    await expect(createShopifyAdminService(env).fetchCanonicalRefundsForOrder('7856043819345'))
      .resolves.toMatchObject({ refundsListComplete: false, refunds: { length: 250 } });
  });

  it('does not request Return.legacyResourceId and derives stable return identity from GraphQL ID', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({
      data: {
        order: {
          id: 'gid://shopify/Order/7856043819345',
          legacyResourceId: '7856043819345',
          returns: returnsConnection([
            {
              id: 'gid://shopify/Return/9001',
              status: 'OPEN',
              createdAt: '2026-07-06T09:00:00Z',
              requestApprovedAt: null,
              closedAt: null,
              returnLineItems: {
                pageInfo: { hasNextPage: false },
                edges: [
                  {
                    node: {
                      id: 'gid://shopify/ReturnLineItem/9101',
                      returnReason: 'OTHER',
                      returnReasonNote: null,
                      customerNote: null,
                      fulfillmentLineItem: {
                        id: 'gid://shopify/FulfillmentLineItem/9201',
                        lineItem: {
                          id: 'gid://shopify/LineItem/20754005197137',
                          sku: 'HJ5228-001-46',
                        },
                      },
                    },
                  },
                ],
              },
            },
          ]),
        },
      },
    }));

    const result = await createShopifyAdminService(env).fetchCanonicalReturnsForOrder('7856043819345');
    const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as { query: string };

    expect(request.query.match(/legacyResourceId/g)).toHaveLength(1);
    expect(result?.returns[0]).toMatchObject({
      returnGid: 'gid://shopify/Return/9001',
      sourceShopifyReturnId: '9001',
    });
  });

  it('returns an empty canonical return collection safely', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({
      data: {
        order: {
          id: 'gid://shopify/Order/7856043819345',
          legacyResourceId: '7856043819345',
          returns: returnsConnection(),
        },
      },
    }));

    await expect(createShopifyAdminService(env).fetchCanonicalReturnsForOrder('7856043819345'))
      .resolves.toMatchObject({ returns: [] });
  });

  it('fails closed when a canonical refund response is malformed', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({
      data: {
        order: {
          id: 'gid://shopify/Order/7856043819345',
          legacyResourceId: '7856043819345',
          refunds: { unexpected: true },
        },
      },
    }));

    await expect(createShopifyAdminService(env).fetchCanonicalRefundsForOrder('7856043819345'))
      .rejects.toBeInstanceOf(CanonicalShopifySnapshotParseError);
  });

  it('fails closed when a canonical return response omits order data', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ data: {} }));

    await expect(createShopifyAdminService(env).fetchCanonicalReturnsForOrder('7856043819345'))
      .rejects.toBeInstanceOf(CanonicalShopifySnapshotParseError);
  });

  it('classifies a refund GraphQL error as canonical_refund_fetch_failed', async () => {
    const admin = createShopifyAdminService(env);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({
      errors: [{ message: 'Refund schema error' }],
    }));
    const source = {
      fetchCanonicalOrderSnapshot: vi.fn(async () => canonicalOrderResult()),
      fetchCanonicalRefundsForOrder: admin.fetchCanonicalRefundsForOrder,
      fetchCanonicalReturnsForOrder: vi.fn(async () => ({
        orderGid: 'gid://shopify/Order/7856043819345',
        sourceShopifyOrderId: '7856043819345',
        returns: [],
        source: 'mock' as const,
      })),
    };

    await expect(__currentStateOrderRepairTesting.fetchCanonicalRepairBundle(source, '7856043819345'))
      .rejects.toMatchObject({
        code: 'canonical_refund_fetch_failed',
        message: 'Shopify canonical refund state could not be fetched.',
        statusCode: 502,
      });
  });

  it('classifies a return GraphQL error as canonical_return_fetch_failed', async () => {
    const admin = createShopifyAdminService(env);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({
      errors: [{ message: 'Return schema error' }],
    }));
    const source = {
      fetchCanonicalOrderSnapshot: vi.fn(async () => canonicalOrderResult()),
      fetchCanonicalRefundsForOrder: vi.fn(async () => ({
        orderGid: 'gid://shopify/Order/7856043819345',
        sourceShopifyOrderId: '7856043819345',
        orderTotalRefundedAmount: '0.00',
        orderTotalRefundedCurrencyCode: 'TRY',
        refundsListComplete: true,
        refunds: [],
        source: 'mock' as const,
      })),
      fetchCanonicalReturnsForOrder: admin.fetchCanonicalReturnsForOrder,
    };

    await expect(__currentStateOrderRepairTesting.fetchCanonicalRepairBundle(source, '7856043819345'))
      .rejects.toMatchObject({
        code: 'canonical_return_fetch_failed',
        message: 'Shopify canonical return state could not be fetched.',
        statusCode: 502,
      });
  });
});
