import { describe, expect, it, vi } from 'vitest';
import {
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
    email: 'customer@example.com',
    phone: null,
    totalPriceSet: {
      shopMoney: {
        amount: '1999.00',
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
    lineItems: {
      nodes: [
        {
          id: 'gid://shopify/LineItem/111',
          legacyResourceId: '111',
          sku: 'IF1208-010-L',
          title: 'Safe test item',
          name: 'Safe test item',
          variantTitle: 'L',
          quantity: 1,
          originalUnitPriceSet: {
            shopMoney: {
              amount: '1999.00',
            },
          },
          variant: {
            legacyResourceId: '222',
          },
        },
      ],
    },
  };
}

describe('manual Shopify order backfill', () => {
  it('refuses to run without explicit confirmation', () => {
    expect(() =>
      validateShopifyOrderBackfillEnv({
        ...validEnv,
        SHOPIFY_ORDER_BACKFILL_CONFIRM: undefined,
      }),
    ).toThrow(/SHOPIFY_ORDER_BACKFILL_CONFIRM=YES/);
  });

  it('refuses to run without an explicit order name', () => {
    expect(() =>
      validateShopifyOrderBackfillEnv({
        ...validEnv,
        SHOPIFY_ORDER_BACKFILL_NAME: '',
      }),
    ).toThrow(/SHOPIFY_ORDER_BACKFILL_NAME/);
  });

  it('imports only the requested order through the existing orders/create endpoint', async () => {
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

    const result = await runShopifyOrderBackfill(validEnv, { fetch: fetchMock });

    expect(result.ok).toBe(true);
    expect(result.orderName).toBe('#1048');
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const shopifyRequest = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(shopifyRequest.variables.query).toBe('name:1048');

    const backendUrl = String(fetchMock.mock.calls[1][0]);
    expect(backendUrl).toBe('https://backend.example.com/webhooks/shopify/orders-create');
    const backendBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(backendBody.name).toBe('#1048');
    expect(backendBody.line_items).toHaveLength(1);
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

    const result = await runShopifyOrderBackfill(validEnv, { fetch: fetchMock });

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

    await runShopifyOrderBackfill(validEnv, { fetch: fetchMock });

    const requestedUrls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(requestedUrls).toEqual([
      'https://shop.example.myshopify.com/admin/api/2024-01/graphql.json',
      'https://backend.example.com/webhooks/shopify/orders-create',
    ]);
    expect(requestedUrls.some((url) => /shipments|kargonomi|try_oto|fulfillment/i.test(url))).toBe(false);
  });
});
