import { afterEach, describe, expect, it, vi } from 'vitest';
import { createShopifyAdminService } from '../backend/src/modules/shopify/shopify-admin.service.js';

function buildGraphqlResponse(data: unknown) {
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('Shopify return tracking fetch', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('maps reverse delivery shipping tracking fields from Shopify return details', async () => {
    const fetchMock = vi.fn().mockResolvedValue(buildGraphqlResponse({
      return: {
        id: 'gid://shopify/Return/231',
        order: { id: 'gid://shopify/Order/1028' },
        returnLineItems: {
          edges: [
            {
              node: {
                id: 'gid://shopify/ReturnLineItem/1',
                customerNote: null,
                returnReason: 'SIZE_TOO_LARGE',
                returnReasonNote: 'Beden büyük geldi.',
                fulfillmentLineItem: {
                  id: 'gid://shopify/FulfillmentLineItem/1',
                  lineItem: {
                    id: 'gid://shopify/LineItem/99',
                    sku: 'SKU-99',
                  },
                },
              },
            },
          ],
        },
        reverseFulfillmentOrders: {
          edges: [
            {
              node: {
                reverseDeliveries: {
                  edges: [
                    {
                      node: {
                        deliverable: {
                          tracking: {
                            carrierName: 'Yurtiçi Kargo',
                            number: 'returnkargo-123',
                            url: 'https://tracking.example/returnkargo-123',
                          },
                        },
                      },
                    },
                  ],
                },
                lineItems: { edges: [] },
              },
            },
          ],
        },
      },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await createShopifyAdminService({
      SHOPIFY_SHOP_DOMAIN: 'example.myshopify.com',
      SHOPIFY_ADMIN_ACCESS_TOKEN: 'shpat_test',
      SHOPIFY_API_VERSION: '2025-07',
    } as never).fetchReturnDetails('gid://shopify/Return/231');

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as { query: string };
    expect(body.query).toContain('reverseDeliveries');
    expect(body.query).toContain('ReverseDeliveryShippingDeliverable');
    expect(result.returnTracking).toEqual({
      carrierName: 'Yurtiçi Kargo',
      trackingNumber: 'returnkargo-123',
      trackingUrl: 'https://tracking.example/returnkargo-123',
    });
  });

  it('keeps return tracking null when Shopify does not provide reverse delivery tracking', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(buildGraphqlResponse({
      return: {
        id: 'gid://shopify/Return/232',
        order: { id: 'gid://shopify/Order/1029' },
        returnLineItems: { edges: [] },
        reverseFulfillmentOrders: {
          edges: [
            {
              node: {
                reverseDeliveries: {
                  edges: [
                    {
                      node: {
                        deliverable: {
                          tracking: {
                            carrierName: null,
                            number: null,
                            url: null,
                          },
                        },
                      },
                    },
                  ],
                },
                lineItems: { edges: [] },
              },
            },
          ],
        },
      },
    })));

    const result = await createShopifyAdminService({
      SHOPIFY_SHOP_DOMAIN: 'example.myshopify.com',
      SHOPIFY_ADMIN_ACCESS_TOKEN: 'shpat_test',
      SHOPIFY_API_VERSION: '2025-07',
    } as never).fetchReturnDetails('gid://shopify/Return/232');

    expect(result.returnTracking).toBeNull();
  });
});
