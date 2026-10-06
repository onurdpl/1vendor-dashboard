import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppEnv } from '../backend/src/config/env.js';
import { createShopifyAdminService } from '../backend/src/modules/shopify/shopify-admin.service.js';

const env = {
  SHOPIFY_API_VERSION: '2026-01', SHOPIFY_SHOP_DOMAIN: 'example.myshopify.com',
  SHOPIFY_ADMIN_ACCESS_TOKEN: 'test-token',
} as AppEnv;

function response(options: { orderPage?: boolean; linePage?: boolean; fulfillmentPage?: boolean;
  fulfillmentIds?: string[] } = {}) {
  return Response.json({ data: { order: {
    id: 'gid://shopify/Order/123',
    fulfillmentOrders: {
      pageInfo: { hasNextPage: options.orderPage ?? false },
      nodes: [{
        id: 'gid://shopify/FulfillmentOrder/1', status: 'OPEN', requestStatus: 'UNSUBMITTED',
        supportedActions: [{ action: 'CREATE_FULFILLMENT' }],
        assignedLocation: { location: { id: 'gid://shopify/Location/2' } },
        lineItems: { pageInfo: { hasNextPage: options.linePage ?? false }, nodes: [{
          id: 'gid://shopify/FulfillmentOrderLineItem/3', remainingQuantity: 1, totalQuantity: 1,
          lineItem: { id: 'gid://shopify/LineItem/4' },
        }] },
        fulfillments: { pageInfo: { hasNextPage: options.fulfillmentPage ?? false },
          nodes: (options.fulfillmentIds ?? []).map((id) => ({ id })) },
      }],
    },
  } } });
}

describe('strict Sopyo Shopify fulfillment planning read', () => {
  afterEach(() => vi.restoreAllMocks());

  it('uses only canonical 2026-01 GraphQL and preserves distinct FO line IDs', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response());
    const result = await createShopifyAdminService(env).fetchFulfillmentOrdersForSopyoPlanning('123');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://example.myshopify.com/admin/api/2026-01/graphql.json');
    expect(init?.method).toBe('POST');
    const body = JSON.parse(String(init?.body)) as { query: string; variables: { id: string } };
    expect(body.variables.id).toBe('gid://shopify/Order/123');
    expect(body.query).toContain('fulfillments(first: 1)');
    expect(body.query).toContain('remainingQuantity');
    expect(body.query).not.toContain('fulfillmentCreate');
    expect(body.query).not.toContain('fulfillmentTrackingInfoUpdate');
    expect(result.fulfillmentOrders[0]?.lineItems[0]).toEqual({
      id: 'gid://shopify/FulfillmentOrderLineItem/3',
      lineItemId: 'gid://shopify/LineItem/4', remainingQuantity: 1, totalQuantity: 1,
    });
  });

  it.each(['orderPage', 'linePage', 'fulfillmentPage'] as const)(
    'fails closed when %s is truncated', async (field) => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ [field]: true }));
      await expect(createShopifyAdminService(env).fetchFulfillmentOrdersForSopyoPlanning('123')).rejects.toThrow();
    },
  );

  it('returns existing fulfillment IDs as ambiguous evidence, not success', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ fulfillmentIds: ['gid://shopify/Fulfillment/9'] }));
    const read = await createShopifyAdminService(env).fetchFulfillmentOrdersForSopyoPlanning('123');
    expect(read.fulfillmentOrders[0]?.existingFulfillmentIds).toEqual(['gid://shopify/Fulfillment/9']);
  });
});
