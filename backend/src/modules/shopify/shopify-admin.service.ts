import type { AppEnv } from '../../config/env.js';
import type { FetchOrderSellerInfoResult, SellerInfoMap, ShopifyGraphqlResponse } from './shopify-admin.types.js';

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

export function createShopifyAdminService(env: AppEnv) {
  const mockSellerInfoByOrderId = parseMockSellerInfoByOrderId(env.SHOPIFY_MOCK_SELLER_INFO);

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

  return {
    fetchOrderSellerInfo,
  };
}
