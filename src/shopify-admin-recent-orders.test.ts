import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppEnv } from '../backend/src/config/env.js';
import { createShopifyAdminService } from '../backend/src/modules/shopify/shopify-admin.service.js';

afterEach(() => vi.unstubAllGlobals());

describe('Shopify recent-order discovery query', () => {
  it('requests only identity fields with the closed created-at window and cursor', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: {
        orders: {
          nodes: [{ id: 'gid://shopify/Order/1001', legacyResourceId: '1001', name: '#1001', createdAt: '2026-08-26T10:00:00Z' }],
          pageInfo: { hasNextPage: true, endCursor: 'cursor-1' },
        },
      },
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const service = createShopifyAdminService({
      NODE_ENV: 'test',
      SHOPIFY_SHOP_DOMAIN: 'example.myshopify.com',
      SHOPIFY_ADMIN_ACCESS_TOKEN: 'test-token',
      SHOPIFY_API_VERSION: '2026-01',
    } as AppEnv);

    const result = await service.fetchRecentOrdersPage({
      createdAtFrom: new Date('2026-08-19T12:00:00.000Z'),
      createdAtTo: new Date('2026-08-26T11:45:00.000Z'),
      first: 100,
      after: 'cursor-0',
    });

    const request = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(fetchMock.mock.calls[0][0]).toContain('/admin/api/2026-01/graphql.json');
    expect(request.query).toContain('orders(first: $first, after: $after, query: $query, sortKey: CREATED_AT, reverse: true)');
    expect(request.query).toContain('legacyResourceId');
    expect(request.query).not.toMatch(/customer|lineItems|metafield|fulfillments|refunds|returns/);
    expect(request.variables).toEqual({
      first: 100,
      after: 'cursor-0',
      query: "created_at:>='2026-08-19T12:00:00.000Z' created_at:<='2026-08-26T11:45:00.000Z'",
    });
    expect(result).toMatchObject({ nodesCount: 1, malformedNodes: 0, hasNextPage: true, endCursor: 'cursor-1' });
  });

  it('reports malformed identities without retaining their response data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: { orders: { nodes: [{ id: 'gid://shopify/Order/1002', name: '#1002', createdAt: '2026-08-26T10:00:00Z' }], pageInfo: { hasNextPage: false, endCursor: null } } },
    }), { status: 200 })));
    const service = createShopifyAdminService({
      NODE_ENV: 'test', SHOPIFY_SHOP_DOMAIN: 'example.myshopify.com', SHOPIFY_ADMIN_ACCESS_TOKEN: 'test-token', SHOPIFY_API_VERSION: '2026-01',
    } as AppEnv);
    const result = await service.fetchRecentOrdersPage({ createdAtFrom: new Date(0), createdAtTo: new Date(), first: 100 });
    expect(result).toMatchObject({ orders: [], nodesCount: 1, malformedNodes: 1 });
  });
});
