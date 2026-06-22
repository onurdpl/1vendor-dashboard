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
  SHOPIFY_API_VERSION: '2026-04',
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

function buildSuggestedRefundResponse(lineItemId: string) {
  return {
    data: {
      order: {
        id: 'gid://shopify/Order/1088',
        suggestedRefund: {
          amountSet: {
            shopMoney: {
              amount: '1000.00',
              currencyCode: 'TRY',
            },
          },
          maximumRefundableSet: {
            shopMoney: {
              amount: '1000.00',
              currencyCode: 'TRY',
            },
          },
          subtotalSet: {
            shopMoney: {
              amount: '900.00',
              currencyCode: 'TRY',
            },
          },
          totalTaxSet: {
            shopMoney: {
              amount: '100.00',
              currencyCode: 'TRY',
            },
          },
          shipping: {
            amountSet: {
              shopMoney: {
                amount: '0.00',
                currencyCode: 'TRY',
              },
            },
          },
          refundLineItems: [
            {
              lineItem: {
                id: lineItemId,
              },
              quantity: 1,
              restockType: 'CANCEL',
              subtotalSet: {
                shopMoney: {
                  amount: '900.00',
                  currencyCode: 'TRY',
                },
              },
              totalTaxSet: {
                shopMoney: {
                  amount: '100.00',
                  currencyCode: 'TRY',
                },
              },
            },
          ],
          suggestedTransactions: [
            {
              gateway: 'bogus',
              formattedGateway: '(For Testing) Bogus Gateway',
              parentTransaction: {
                id: 'gid://shopify/OrderTransaction/1',
              },
              amountSet: {
                shopMoney: {
                  amount: '1000.00',
                  currencyCode: 'TRY',
                },
              },
            },
          ],
        },
      },
    },
  };
}

describe('Shopify suggested refund preview', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('wraps numeric order and line item ids before calling suggestedRefund', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(buildSuggestedRefundResponse('gid://shopify/LineItem/20346971095377')), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const service = createShopifyAdminService(env);

    const result = await service.previewSuggestedRefund({
      shopifyOrderId: '1088',
      refundShipping: false,
      refundLineItems: [
        {
          sourceLineItemId: '20346971095377',
          quantity: 1,
          restockType: 'CANCEL',
        },
      ],
    });

    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      variables: {
        id: string;
        refundLineItems: Array<{ lineItemId: string; quantity: number; restockType: string }>;
        refundShipping: boolean;
      };
    };
    expect(requestBody.variables.id).toBe('gid://shopify/Order/1088');
    expect(requestBody.variables.refundLineItems).toEqual([
      {
        lineItemId: 'gid://shopify/LineItem/20346971095377',
        quantity: 1,
        restockType: 'CANCEL',
      },
    ]);
    expect(result.suggestedRefund?.suggestedTransactions[0]).toMatchObject({
      gateway: 'bogus',
      amount: '1000.00',
      currencyCode: 'TRY',
      parentTransactionId: 'gid://shopify/OrderTransaction/1',
    });
  });

  it('keeps Shopify GIDs intact instead of double-wrapping them', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(buildSuggestedRefundResponse('gid://shopify/LineItem/20346971095377')), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const service = createShopifyAdminService(env);

    await service.previewSuggestedRefund({
      shopifyOrderId: 'gid://shopify/Order/1088',
      refundShipping: false,
      refundLineItems: [
        {
          sourceLineItemId: 'gid://shopify/LineItem/20346971095377',
          quantity: 1,
          restockType: 'NO_RESTOCK',
        },
      ],
    });

    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      variables: {
        id: string;
        refundLineItems: Array<{ lineItemId: string; quantity: number; restockType: string }>;
      };
    };
    expect(requestBody.variables.id).toBe('gid://shopify/Order/1088');
    expect(requestBody.variables.refundLineItems[0]?.lineItemId).toBe('gid://shopify/LineItem/20346971095377');
    expect(requestBody.variables.refundLineItems[0]?.restockType).toBe('NO_RESTOCK');
  });
});
