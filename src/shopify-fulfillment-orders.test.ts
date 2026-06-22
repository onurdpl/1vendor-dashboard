import { afterEach, describe, expect, it, vi } from 'vitest';
import { createShopifyAdminService } from '../backend/src/modules/shopify/shopify-admin.service.js';
import type { AppEnv } from '../backend/src/config/env.js';

const env: AppEnv = {
  NODE_ENV: 'test',
  PORT: 4000,
  DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:5432/vendor_dashboard_dev',
  CORS_ORIGIN: ['http://localhost:5173'],
  JWT_SECRET: 'test',
  JWT_EXPIRES_IN: '12h',
  SHOPIFY_WEBHOOK_SECRET: 'test',
  SHOPIFY_API_VERSION: '2026-01',
  SHOPIFY_SHOP_DOMAIN: 'demo.myshopify.com',
  SHOPIFY_ADMIN_ACCESS_TOKEN: 'test-token',
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

describe('Shopify fulfillment order lookup', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('normalizes Shopify order GIDs before calling the REST fulfillment order endpoint', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          fulfillment_orders: [
            {
              id: 998877,
              status: 'open',
              line_items: [
                {
                  id: 112233,
                  line_item_id: 20346971095377,
                  quantity: 1,
                },
              ],
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const service = createShopifyAdminService(env);

    const result = await service.fetchFulfillmentOrders('gid://shopify/Order/7616544244049');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://demo.myshopify.com/admin/api/2026-01/orders/7616544244049/fulfillment_orders.json',
      expect.any(Object),
    );
    expect(result.fulfillmentOrders).toEqual([
      {
        id: '998877',
        status: 'open',
        lineItems: [
          {
            id: '112233',
            lineItemId: '20346971095377',
            quantity: 1,
          },
        ],
      },
    ]);
  });

  it('fetches canonical GraphQL fulfillment order fields for cancellation classification', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            order: {
              id: 'gid://shopify/Order/7616544244049',
              fulfillmentOrders: {
                nodes: [
                  {
                    id: 'gid://shopify/FulfillmentOrder/998877',
                    status: 'OPEN',
                    requestStatus: 'UNREQUESTED',
                    supportedActions: [{ action: 'CANCEL_FULFILLMENT_ORDER' }],
                    assignedLocation: {
                      name: 'Main Warehouse Snapshot',
                      location: {
                        id: 'gid://shopify/Location/44',
                        name: 'Main Warehouse',
                      },
                    },
                    lineItems: {
                      nodes: [
                        {
                          id: 'gid://shopify/FulfillmentOrderLineItem/112233',
                          remainingQuantity: 1,
                          totalQuantity: 1,
                          lineItem: {
                            id: 'gid://shopify/LineItem/20346971095377',
                          },
                        },
                      ],
                    },
                  },
                ],
              },
            },
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const service = createShopifyAdminService(env);

    const result = await service.fetchFulfillmentOrdersForCancellationClassification('gid://shopify/Order/7616544244049');

    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      variables: {
        id: string;
      };
    };
    expect(fetchMock).toHaveBeenCalledWith(
      'https://demo.myshopify.com/admin/api/2026-01/graphql.json',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(requestBody.variables.id).toBe('gid://shopify/Order/7616544244049');
    expect(result.fulfillmentOrders).toEqual([
      {
        id: 'gid://shopify/FulfillmentOrder/998877',
        status: 'OPEN',
        requestStatus: 'UNREQUESTED',
        supportedActions: ['CANCEL_FULFILLMENT_ORDER'],
        assignedLocationId: 'gid://shopify/Location/44',
        assignedLocationName: 'Main Warehouse',
        lineItems: [
          {
            id: 'gid://shopify/FulfillmentOrderLineItem/112233',
            lineItemId: 'gid://shopify/LineItem/20346971095377',
            remainingQuantity: 1,
            totalQuantity: 1,
          },
        ],
      },
    ]);
  });
});
