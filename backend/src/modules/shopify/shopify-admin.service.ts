import type { AppEnv } from '../../config/env.js';
import type {
  CreateFulfillmentTrackingInput,
  CreateFulfillmentTrackingResult,
  FetchOrderSellerInfoResult,
  SellerInfoMap,
  ShopifyFulfillmentOrder,
  ShopifyFulfillmentOrdersResponse,
  ShopifyGraphqlResponse,
} from './shopify-admin.types.js';

type OrderSellerInfoQueryResponse = {
  order: {
    metafield: {
      value: string | null;
    } | null;
  } | null;
};

function toShopifyOrderGid(orderId: string) {
  return `gid://shopify/Order/${orderId}`;
}

function parseSellerInfoValue(value: string | null): SellerInfoMap | null {
  if (!value) {
    return null;
  }

  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Shopify seller_info metafield must be a JSON object.');
  }

  const sellerInfo = Object.entries(parsed).reduce<SellerInfoMap>((acc, [sku, vendorSlug]) => {
    if (typeof vendorSlug === 'string' && sku) {
      acc[sku] = vendorSlug;
    }

    return acc;
  }, {});

  return Object.keys(sellerInfo).length > 0 ? sellerInfo : null;
}

function parseMockSellerInfoByOrderId(rawValue: string | undefined): Record<string, SellerInfoMap> {
  if (!rawValue) {
    return {};
  }

  const parsed = JSON.parse(rawValue) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('SHOPIFY_MOCK_SELLER_INFO must be a JSON object keyed by Shopify order id.');
  }

  return Object.entries(parsed).reduce<Record<string, SellerInfoMap>>((acc, [orderId, value]) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return acc;
    }

    const sellerInfo = Object.entries(value).reduce<SellerInfoMap>((map, [sku, vendorSlug]) => {
      if (typeof vendorSlug === 'string' && sku) {
        map[sku] = vendorSlug;
      }

      return map;
    }, {});

    acc[orderId] = sellerInfo;
    return acc;
  }, {});
}

function parseMockFulfillmentOrdersByOrderId(rawValue: string | undefined): Record<string, ShopifyFulfillmentOrder[]> {
  if (!rawValue) {
    return {};
  }

  const parsed = JSON.parse(rawValue) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('SHOPIFY_MOCK_FULFILLMENT_ORDERS must be a JSON object keyed by Shopify order id.');
  }

  return Object.entries(parsed).reduce<Record<string, ShopifyFulfillmentOrder[]>>((acc, [orderId, value]) => {
    if (!Array.isArray(value)) {
      return acc;
    }

    acc[orderId] = value
      .filter((entry) => entry && typeof entry === 'object' && !Array.isArray(entry))
      .map((entry) => {
        const lineItems = Array.isArray((entry as { lineItems?: unknown }).lineItems)
          ? (entry as { lineItems: Array<Record<string, unknown>> }).lineItems
          : [];

        return {
          id: String((entry as { id?: unknown }).id ?? ''),
          status: typeof (entry as { status?: unknown }).status === 'string'
            ? String((entry as { status?: unknown }).status)
            : 'open',
          lineItems: lineItems.map((lineItem) => ({
            id: String(lineItem.id ?? ''),
            lineItemId: String(lineItem.lineItemId ?? ''),
            quantity: typeof lineItem.quantity === 'number' && lineItem.quantity > 0 ? lineItem.quantity : 1,
          })),
        };
      })
      .filter((entry) => entry.id);

    return acc;
  }, {});
}

export function createShopifyAdminService(env: AppEnv) {
  const mockSellerInfoByOrderId = parseMockSellerInfoByOrderId(env.SHOPIFY_MOCK_SELLER_INFO);
  const mockFulfillmentOrdersByOrderId = parseMockFulfillmentOrdersByOrderId(env.SHOPIFY_MOCK_FULFILLMENT_ORDERS);
  const mockFailAllocationIds = new Set(
    (env.SHOPIFY_MOCK_FULFILLMENT_FAIL_ALLOCATION_IDS || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  );

  async function fetchOrderSellerInfo(orderId: string): Promise<FetchOrderSellerInfoResult> {
    if (mockSellerInfoByOrderId[orderId]) {
      return {
        sellerInfo: mockSellerInfoByOrderId[orderId],
        source: 'mock',
      };
    }

    if (!env.SHOPIFY_SHOP_DOMAIN || !env.SHOPIFY_ADMIN_ACCESS_TOKEN) {
      return {
        sellerInfo: null,
        source: 'mock',
      };
    }

    const response = await fetch(
      `https://${env.SHOPIFY_SHOP_DOMAIN}/admin/api/${env.SHOPIFY_API_VERSION}/graphql.json`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-shopify-access-token': env.SHOPIFY_ADMIN_ACCESS_TOKEN,
        },
        body: JSON.stringify({
          query: `
            query GetOrderSellerInfo($id: ID!) {
              order(id: $id) {
                metafield(namespace: "custom", key: "seller_info") {
                  value
                }
              }
            }
          `,
          variables: {
            id: toShopifyOrderGid(orderId),
          },
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`Shopify Admin seller_info fetch failed with status ${response.status}.`);
    }

    const json = (await response.json()) as ShopifyGraphqlResponse<OrderSellerInfoQueryResponse>;
    if (json.errors?.length) {
      throw new Error(`Shopify Admin seller_info fetch returned GraphQL errors: ${json.errors.map((error) => error.message).join('; ')}`);
    }

    return {
      sellerInfo: parseSellerInfoValue(json.data?.order?.metafield?.value ?? null),
      source: 'shopify_admin',
    };
  }

  async function fetchFulfillmentOrders(shopifyOrderId: string): Promise<ShopifyFulfillmentOrdersResponse> {
    if (mockFulfillmentOrdersByOrderId[shopifyOrderId]) {
      return {
        fulfillmentOrders: mockFulfillmentOrdersByOrderId[shopifyOrderId],
        source: 'mock',
      };
    }

    if (!env.SHOPIFY_SHOP_DOMAIN || !env.SHOPIFY_ADMIN_ACCESS_TOKEN) {
      return {
        fulfillmentOrders: [],
        source: 'mock',
      };
    }

    const response = await fetch(
      `https://${env.SHOPIFY_SHOP_DOMAIN}/admin/api/${env.SHOPIFY_API_VERSION}/orders/${encodeURIComponent(shopifyOrderId)}/fulfillment_orders.json`,
      {
        headers: {
          'content-type': 'application/json',
          'x-shopify-access-token': env.SHOPIFY_ADMIN_ACCESS_TOKEN,
        },
      },
    );

    if (!response.ok) {
      throw new Error(`Shopify fulfillment orders fetch failed with status ${response.status}.`);
    }

    const json = (await response.json()) as {
      fulfillment_orders?: Array<{
        id: string | number;
        status?: string;
        line_items?: Array<{
          id: string | number;
          line_item_id: string | number;
          quantity?: number;
        }>;
      }>;
    };

    return {
      fulfillmentOrders: (json.fulfillment_orders || []).map((order) => ({
        id: String(order.id),
        status: typeof order.status === 'string' ? order.status : 'open',
        lineItems: (order.line_items || []).map((lineItem) => ({
          id: String(lineItem.id),
          lineItemId: String(lineItem.line_item_id),
          quantity: typeof lineItem.quantity === 'number' && lineItem.quantity > 0 ? lineItem.quantity : 1,
        })),
      })),
      source: 'shopify_admin',
    };
  }

  async function createFulfillmentTracking(
    input: CreateFulfillmentTrackingInput,
  ): Promise<CreateFulfillmentTrackingResult> {
    if (mockFailAllocationIds.has(input.allocationId)) {
      throw new Error(`Mock Shopify fulfillment sync failed for allocation ${input.allocationId}.`);
    }

    if (mockFulfillmentOrdersByOrderId[input.shopifyOrderId]) {
      return {
        fulfillmentId: `mock-fulfillment-${input.allocationId}`,
        status: 'mock_submitted',
        source: 'mock',
      };
    }

    if (!env.SHOPIFY_SHOP_DOMAIN || !env.SHOPIFY_ADMIN_ACCESS_TOKEN) {
      throw new Error('Shopify fulfillment sync is not configured.');
    }

    const response = await fetch(
      `https://${env.SHOPIFY_SHOP_DOMAIN}/admin/api/${env.SHOPIFY_API_VERSION}/fulfillments.json`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-shopify-access-token': env.SHOPIFY_ADMIN_ACCESS_TOKEN,
        },
        body: JSON.stringify({
          fulfillment: {
            notify_customer: input.notifyCustomer,
            tracking_info: {
              number: input.trackingNumber,
              company: input.carrier,
              ...(input.trackingUrl ? { url: input.trackingUrl } : {}),
            },
            line_items_by_fulfillment_order: input.lineItemsByFulfillmentOrder.map((entry) => ({
              fulfillment_order_id: entry.fulfillmentOrderId,
              fulfillment_order_line_items: entry.fulfillmentOrderLineItems.map((lineItem) => ({
                id: lineItem.id,
                quantity: lineItem.quantity,
              })),
            })),
          },
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`Shopify fulfillment creation failed with status ${response.status}.`);
    }

    const json = (await response.json()) as {
      fulfillment?: {
        id?: string | number;
      };
    };

    return {
      fulfillmentId: String(json.fulfillment?.id ?? `shopify-fulfillment-${input.allocationId}`),
      status: 'submitted',
      source: 'shopify_admin',
    };
  }

  return {
    fetchOrderSellerInfo,
    fetchFulfillmentOrders,
    createFulfillmentTracking,
  };
}
