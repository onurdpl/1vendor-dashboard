import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppEnv } from '../backend/src/config/env.js';
import { createShopifyAdminService } from '../backend/src/modules/shopify/shopify-admin.service.js';

const env = { SHOPIFY_API_VERSION: '2026-01', SHOPIFY_SHOP_DOMAIN: 'example.myshopify.com',
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

describe('Sopyo Shopify 2026-01 fulfillment GraphQL transport', () => {
  afterEach(() => vi.restoreAllMocks());

  it('sends one mutation with both exact fulfillment-order line GIDs and tracking', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ data: {
      fulfillmentCreate: { userErrors: [], fulfillment },
    } }));
    const result = await createShopifyAdminService(env).createSopyoFulfillment(input);
    expect(result).toMatchObject({ outcome: 'success', fulfillment: { id: fulfillment.id } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://example.myshopify.com/admin/api/2026-01/graphql.json');
    const body = JSON.parse(String(options?.body));
    expect(body.query).toContain('fulfillmentCreate');
    expect(body.query).not.toContain('fulfillmentCreateV2');
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

  it('exhausts order and fulfillment-order pages, deduplicating shared fulfillment IDs', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      const { id, after } = body.variables;
      if (body.query.includes('SopyoFulfillmentOrderMembership')) {
        expect(body.query).toContain('displayable: false');
        const second = after === 'order-cursor';
        return Response.json({ data: { order: { id: input.orderGid, fulfillmentOrders: {
          pageInfo: { hasNextPage: !second, endCursor: second ? null : 'order-cursor' },
          nodes: [{ id: `gid://shopify/FulfillmentOrder/${second ? '4' : '3'}` }],
        } } } });
      }
      if (body.query.includes('SopyoFulfillmentEvidence')) {
        return Response.json({ data: { fulfillment } });
      }
      expect(body.query).toContain('fulfillments(first: 100, after: $after)');
      const firstOrder = id === 'gid://shopify/FulfillmentOrder/3';
      const secondPage = after === 'fulfillment-cursor';
      return Response.json({ data: { fulfillmentOrder: { id, order: { id: input.orderGid },
        fulfillments: { pageInfo: {
          hasNextPage: firstOrder && !secondPage,
          endCursor: firstOrder && !secondPage ? 'fulfillment-cursor' : null,
        }, nodes: firstOrder && secondPage ? [] : [{ id: fulfillment.id }] },
      } } });
    });
    const result = await createShopifyAdminService(env).fetchSopyoFulfillmentsForReconciliation(input.orderGid);
    expect(result).toHaveLength(1);
    expect(result[0]?.fulfillmentOrderGids).toEqual([
      'gid://shopify/FulfillmentOrder/3', 'gid://shopify/FulfillmentOrder/4',
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(6);
    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body));
    expect(body.query).not.toContain('fulfillmentsCount');
    expect(body.query).not.toContain('fulfillments(first: 250)');
    expect(body.query).not.toContain('fulfillmentCreate');
  });

  it('rejects malformed pagination instead of accepting truncated membership', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ data: { order: {
      id: input.orderGid, fulfillmentOrders: {
        pageInfo: { hasNextPage: true, endCursor: null }, nodes: [{ id: 'gid://shopify/FulfillmentOrder/3' }],
      },
    } } }));
    await expect(createShopifyAdminService(env).fetchSopyoFulfillmentsForReconciliation(input.orderGid))
      .rejects.toThrow('incomplete');
  });

  it('rejects truncated fulfillment-order relationship pages', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      if (body.query.includes('SopyoFulfillmentOrderMembership')) {
        return Response.json({ data: { order: { id: input.orderGid, fulfillmentOrders: {
          pageInfo: { hasNextPage: false }, nodes: [{ id: 'gid://shopify/FulfillmentOrder/3' }],
        } } } });
      }
      return Response.json({ data: { fulfillmentOrder: {
        id: 'gid://shopify/FulfillmentOrder/3', order: { id: input.orderGid },
        fulfillments: { pageInfo: { hasNextPage: true, endCursor: null },
          nodes: [{ id: fulfillment.id }] },
      } } });
    });
    await expect(createShopifyAdminService(env).fetchSopyoFulfillmentsForReconciliation(input.orderGid))
      .rejects.toThrow('incomplete');
  });

  it('fails closed on an unsupported Shopify version before any request', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const unsupported = createShopifyAdminService({ ...env, SHOPIFY_API_VERSION: '2024-01' });
    await expect(unsupported.fetchSopyoFulfillmentsForReconciliation(input.orderGid)).rejects.toThrow('not configured');
    await expect(unsupported.fetchFulfillmentOrdersForSopyoPlanning(input.orderGid)).rejects.toThrow('not configured');
    await expect(unsupported.createSopyoFulfillment(input)).rejects.toThrow('not configured');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('Sopyo exact Shopify Delivered event transport', () => {
  afterEach(() => vi.restoreAllMocks());
  const fulfillmentId = 'gid://shopify/Fulfillment/44';
  const orderGid = 'gid://shopify/Order/55';

  it('exhausts exact fulfillment event pages and recognizes an existing DELIVERED', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      expect(body.variables.id).toBe(fulfillmentId);
      return Response.json({ data: { fulfillment: { id: fulfillmentId, order: { id: orderGid },
        events: { nodes: [{ id: body.variables.after ? 'event-2' : 'event-1',
          status: body.variables.after ? 'DELIVERED' : 'IN_TRANSIT' }],
          pageInfo: { hasNextPage: !body.variables.after,
            endCursor: body.variables.after ? null : 'cursor-1' } },
      } } });
    });
    expect(await createShopifyAdminService(env).readSopyoFulfillmentDelivered({ fulfillmentId, orderGid }))
      .toEqual({ delivered: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each(['wrong-fulfillment', 'wrong-order', 'missing-page-info', 'repeated-cursor'])(
    'fails closed on %s rather than proving absence', async (kind) => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        return Response.json({ data: { fulfillment: {
          id: kind === 'wrong-fulfillment' ? 'gid://shopify/Fulfillment/99' : fulfillmentId,
          order: { id: kind === 'wrong-order' ? 'gid://shopify/Order/99' : orderGid },
          events: { nodes: [{ id: 'event-1', status: 'IN_TRANSIT' }],
            pageInfo: kind === 'missing-page-info' ? null :
              { hasNextPage: kind === 'repeated-cursor', endCursor: body.variables.after ?? 'cursor-1' } },
        } } });
      });
      await expect(createShopifyAdminService(env).readSopyoFulfillmentDelivered({ fulfillmentId, orderGid }))
        .rejects.toThrow();
    },
  );

  it('sends only a DELIVERED event for the stored fulfillment', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ data: {
      fulfillmentEventCreate: { userErrors: [],
        fulfillmentEvent: { id: 'gid://shopify/FulfillmentEvent/1', status: 'DELIVERED' } },
    } }));
    expect(await createShopifyAdminService(env).createSopyoDeliveredEvent(fulfillmentId))
      .toEqual({ outcome: 'success' });
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.query).toContain('fulfillmentEventCreate');
    expect(body.query).not.toContain('fulfillmentCreate(');
    expect(body.variables.fulfillmentEvent).toEqual({ fulfillmentId, status: 'DELIVERED' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('classifies userErrors as rejected and transport/partial responses as unknown', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    fetchMock.mockResolvedValueOnce(Response.json({ data: { fulfillmentEventCreate: {
      userErrors: [{ field: ['status'], message: 'Rejected' }], fulfillmentEvent: null,
    } } }));
    expect(await createShopifyAdminService(env).createSopyoDeliveredEvent(fulfillmentId))
      .toEqual({ outcome: 'rejected' });
    fetchMock.mockRejectedValueOnce(new Error('token-sensitive transport failure'));
    expect(await createShopifyAdminService(env).createSopyoDeliveredEvent(fulfillmentId))
      .toEqual({ outcome: 'unknown' });
    fetchMock.mockResolvedValueOnce(Response.json({ data: { fulfillmentEventCreate: {
      userErrors: [], fulfillmentEvent: null,
    } } }));
    expect(await createShopifyAdminService(env).createSopyoDeliveredEvent(fulfillmentId))
      .toEqual({ outcome: 'unknown' });
  });
});
