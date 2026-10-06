import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppEnv } from '../backend/src/config/env.js';
import { createShopifyAdminService } from '../backend/src/modules/shopify/shopify-admin.service.js';

const env = { SHOPIFY_API_VERSION: '2026-10', SHOPIFY_SHOP_DOMAIN: 'example.myshopify.com',
  SHOPIFY_ADMIN_ACCESS_TOKEN: 'test-token' } as AppEnv;
const fulfillment = {
  id: 'gid://shopify/Fulfillment/1', status: 'SUCCESS',
  order: { id: 'gid://shopify/Order/10' }, location: { id: 'gid://shopify/Location/2' },
  trackingInfo: [{ company: 'Carrier', number: 'TRACK' }],
  fulfillmentOrders: { pageInfo: { hasNextPage: false },
    nodes: [{ id: 'gid://shopify/FulfillmentOrder/3' }, { id: 'gid://shopify/FulfillmentOrder/4' }] },
  fulfillmentLineItems: { pageInfo: { hasNextPage: false },
    nodes: [{ quantity: 2, lineItem: { id: 'gid://shopify/LineItem/5' } }] },
};
const input = {
  orderGid: 'gid://shopify/Order/10', company: 'Carrier', trackingNumber: 'TRACK',
  lineItemsByFulfillmentOrder: [
    { fulfillmentOrderId: 'gid://shopify/FulfillmentOrder/3',
      fulfillmentOrderLineItems: [{ id: 'gid://shopify/FulfillmentOrderLineItem/6', quantity: 1 }] },
    { fulfillmentOrderId: 'gid://shopify/FulfillmentOrder/4',
      fulfillmentOrderLineItems: [{ id: 'gid://shopify/FulfillmentOrderLineItem/7', quantity: 1 }] },
  ],
};

describe('Sopyo Shopify 2026-10 fulfillment GraphQL transport', () => {
  afterEach(() => vi.restoreAllMocks());

  it('sends one mutation with both exact fulfillment-order line GIDs and tracking', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ data: {
      fulfillmentCreate: { userErrors: [], fulfillment },
    } }));
    const result = await createShopifyAdminService(env).createSopyoFulfillment(input);
    expect(result).toMatchObject({ outcome: 'success', fulfillment: { id: fulfillment.id } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://example.myshopify.com/admin/api/2026-10/graphql.json');
    const body = JSON.parse(String(options?.body));
    expect(body.query).toContain('fulfillmentCreate');
    expect(body.variables.fulfillment.lineItemsByFulfillmentOrder).toEqual(input.lineItemsByFulfillmentOrder);
    expect(body.variables.fulfillment.trackingInfo).toEqual({ company: 'Carrier', number: 'TRACK' });
    expect(body.variables.fulfillment.notifyCustomer).toBe(false);
  });

  it('classifies GraphQL userErrors without a fulfillment as definite rejection', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ data: {
      fulfillmentCreate: { userErrors: [{ field: ['fulfillment'], message: 'Rejected' }], fulfillment: null },
    } }));
    expect(await createShopifyAdminService(env).createSopyoFulfillment(input)).toEqual({ outcome: 'rejected' });
  });

  it.each(['transport', 'http', 'invalid-json', 'malformed-success', 'graphql-errors'])(
    'classifies %s as uncertain, never retrying', async (kind) => {
      const fetchMock = vi.spyOn(globalThis, 'fetch');
      if (kind === 'transport') fetchMock.mockRejectedValue(new Error('socket reset'));
      else if (kind === 'http') fetchMock.mockResolvedValue(Response.json({}, { status: 500 }));
      else if (kind === 'invalid-json') fetchMock.mockResolvedValue(new Response('bad JSON'));
      else if (kind === 'graphql-errors') fetchMock.mockResolvedValue(Response.json({ errors: [{ message: 'Unknown' }] }));
      else fetchMock.mockResolvedValue(Response.json({ data: {
        fulfillmentCreate: { userErrors: [], fulfillment: { id: fulfillment.id } },
      } }));
      expect(await createShopifyAdminService(env).createSopyoFulfillment(input)).toEqual({ outcome: 'unknown' });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it('requires a complete canonical fulfillment list and nested identity', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ data: { order: {
      id: input.orderGid, fulfillmentsCount: { count: 1 }, fulfillments: [fulfillment],
    } } }));
    const result = await createShopifyAdminService(env).fetchSopyoFulfillmentsForReconciliation(input.orderGid);
    expect(result).toHaveLength(1);
    expect(result[0]?.fulfillmentOrderGids).toEqual([
      'gid://shopify/FulfillmentOrder/3', 'gid://shopify/FulfillmentOrder/4',
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body));
    expect(body.query).toContain('fulfillmentsCount');
    expect(body.query).not.toContain('fulfillmentCreate');
  });

  it('rejects truncated canonical fulfillment evidence', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ data: { order: {
      id: input.orderGid, fulfillmentsCount: { count: 2 }, fulfillments: [fulfillment],
    } } }));
    await expect(createShopifyAdminService(env).fetchSopyoFulfillmentsForReconciliation(input.orderGid))
      .rejects.toThrow('incomplete');
  });
});
