import { createHmac } from 'node:crypto';
import type { ShopifyOrdersCreateWebhookPayload } from './order-ingestion.types.js';

export type ShopifyOrderBackfillEnv = {
  SHOPIFY_ORDER_BACKFILL_CONFIRM?: string;
  SHOPIFY_ORDER_BACKFILL_NAME?: string;
  SHOPIFY_ORDER_BACKFILL_BACKEND_URL?: string;
  SHOPIFY_SHOP_DOMAIN?: string;
  SHOPIFY_ADMIN_ACCESS_TOKEN?: string;
  SHOPIFY_API_VERSION?: string;
  SHOPIFY_WEBHOOK_SECRET?: string;
};

export type ShopifyOrderBackfillConfig = {
  orderName: string;
  backendUrl: string;
  shopDomain: string;
  adminAccessToken: string;
  apiVersion: string;
  webhookSecret: string;
};

export type ShopifyOrderBackfillFetch = (
  input: string | URL,
  init?: RequestInit,
) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
}>;

type MoneySet = {
  shopMoney?: {
    amount?: string | null;
  } | null;
} | null;

type ShopifyOrderNode = {
  id: string;
  legacyResourceId?: string | null;
  name: string | null;
  createdAt: string | null;
  email?: string | null;
  phone?: string | null;
  totalPriceSet?: MoneySet;
  customer?: {
    email?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    phone?: string | null;
  } | null;
  shippingAddress?: {
    phone?: string | null;
    country?: string | null;
    countryCodeV2?: string | null;
    zip?: string | null;
    city?: string | null;
    province?: string | null;
    address1?: string | null;
    address2?: string | null;
  } | null;
  lineItems?: {
    nodes?: ShopifyOrderLineItemNode[];
  } | null;
};

type ShopifyOrderLineItemNode = {
  id: string;
  sku?: string | null;
  title?: string | null;
  name?: string | null;
  variantTitle?: string | null;
  quantity?: number | null;
  originalUnitPriceSet?: MoneySet;
  variant?: {
    legacyResourceId?: string | null;
  } | null;
};

type ShopifyOrderLookupResponse = {
  data?: {
    orders?: {
      nodes?: ShopifyOrderNode[];
    } | null;
  } | null;
  errors?: Array<{
    message?: string | null;
  }>;
};

export type ShopifyOrderBackfillResult = {
  ok: boolean;
  orderName: string;
  shopifyOrderId: string | null;
  webhookId: string | null;
  backendStatus: number | null;
  backendAction: string | null;
  duplicate: boolean;
  allocationCount: number | null;
  message: string | null;
};

const ORDER_LOOKUP_QUERY = `#graphql
  query BackfillOrderByName($query: String!) {
    orders(first: 5, query: $query) {
      nodes {
        id
        legacyResourceId
        name
        createdAt
        email
        phone
        totalPriceSet {
          shopMoney {
            amount
          }
        }
        customer {
          email
          firstName
          lastName
          phone
        }
        shippingAddress {
          phone
          country
          countryCodeV2
          zip
          city
          province
          address1
          address2
        }
        lineItems(first: 100) {
          nodes {
            id
            sku
            title
            name
            variantTitle
            quantity
            originalUnitPriceSet {
              shopMoney {
                amount
              }
            }
            variant {
              legacyResourceId
            }
          }
        }
      }
    }
  }
`;

function normalizeOptionalString(value: string | null | undefined) {
  const trimmed = value?.trim() ?? '';
  return trimmed || null;
}

function extractShopifyGidTail(gid: string) {
  const tail = gid.split('/').at(-1)?.trim() ?? '';
  return tail || gid;
}

function requireHttpsUrl(value: string, label: string) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:') {
      throw new Error();
    }
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    throw new Error(`${label} must be a valid HTTPS URL.`);
  }
}

function getWebhookId(order: ShopifyOrderNode) {
  const orderId = order.legacyResourceId || extractShopifyGidTail(order.id);
  return `manual-backfill-orders-create-${orderId}`;
}

function getOrderNumber(orderName: string) {
  const numeric = orderName.replace(/^#/, '').trim();
  return numeric || orderName;
}

export function validateShopifyOrderBackfillEnv(env: ShopifyOrderBackfillEnv): ShopifyOrderBackfillConfig {
  if (env.SHOPIFY_ORDER_BACKFILL_CONFIRM !== 'YES') {
    throw new Error('Set SHOPIFY_ORDER_BACKFILL_CONFIRM=YES to run the manual Shopify order backfill.');
  }

  const orderName = normalizeOptionalString(env.SHOPIFY_ORDER_BACKFILL_NAME);
  if (!orderName) {
    throw new Error('SHOPIFY_ORDER_BACKFILL_NAME is required, for example #1048.');
  }

  const backendUrl = normalizeOptionalString(env.SHOPIFY_ORDER_BACKFILL_BACKEND_URL);
  const shopDomain = normalizeOptionalString(env.SHOPIFY_SHOP_DOMAIN);
  const adminAccessToken = normalizeOptionalString(env.SHOPIFY_ADMIN_ACCESS_TOKEN);
  const apiVersion = normalizeOptionalString(env.SHOPIFY_API_VERSION) ?? '2024-01';
  const webhookSecret = normalizeOptionalString(env.SHOPIFY_WEBHOOK_SECRET);

  const missing = [
    ['SHOPIFY_ORDER_BACKFILL_BACKEND_URL', backendUrl],
    ['SHOPIFY_SHOP_DOMAIN', shopDomain],
    ['SHOPIFY_ADMIN_ACCESS_TOKEN', adminAccessToken],
    ['SHOPIFY_WEBHOOK_SECRET', webhookSecret],
  ]
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length > 0) {
    throw new Error(`Missing required variables: ${missing.join(', ')}`);
  }

  return {
    orderName,
    backendUrl: requireHttpsUrl(backendUrl as string, 'SHOPIFY_ORDER_BACKFILL_BACKEND_URL'),
    shopDomain: shopDomain as string,
    adminAccessToken: adminAccessToken as string,
    apiVersion,
    webhookSecret: webhookSecret as string,
  };
}

export function buildOrdersCreatePayloadFromShopifyOrder(order: ShopifyOrderNode): ShopifyOrdersCreateWebhookPayload {
  const orderId = order.legacyResourceId || extractShopifyGidTail(order.id);
  const orderName = order.name ?? `#${orderId}`;
  const shippingAddress = order.shippingAddress ?? null;

  return {
    id: orderId,
    order_number: getOrderNumber(orderName),
    name: orderName,
    created_at: order.createdAt,
    total_price: order.totalPriceSet?.shopMoney?.amount ?? null,
    email: order.email ?? order.customer?.email ?? null,
    phone: order.phone ?? order.customer?.phone ?? shippingAddress?.phone ?? null,
    customer: order.customer
      ? {
          email: order.customer.email ?? order.email ?? null,
          first_name: order.customer.firstName ?? null,
          last_name: order.customer.lastName ?? null,
          phone: order.customer.phone ?? order.phone ?? shippingAddress?.phone ?? null,
        }
      : null,
    shipping_address: shippingAddress
      ? {
          phone: shippingAddress.phone ?? order.phone ?? order.customer?.phone ?? null,
          country: shippingAddress.country ?? null,
          country_code: shippingAddress.countryCodeV2 ?? null,
          zip: shippingAddress.zip ?? null,
          city: shippingAddress.city ?? null,
          province: shippingAddress.province ?? null,
          address1: shippingAddress.address1 ?? null,
          address2: shippingAddress.address2 ?? null,
          address: [shippingAddress.address1, shippingAddress.address2].filter(Boolean).join(' ') || null,
        }
      : null,
    line_items: (order.lineItems?.nodes ?? []).map((lineItem) => ({
      id: extractShopifyGidTail(lineItem.id),
      variant_id: lineItem.variant?.legacyResourceId ?? null,
      sku: lineItem.sku ?? null,
      title: lineItem.title ?? lineItem.name ?? null,
      name: lineItem.name ?? lineItem.title ?? null,
      variant_title: lineItem.variantTitle ?? null,
      quantity: lineItem.quantity ?? 0,
      price: lineItem.originalUnitPriceSet?.shopMoney?.amount ?? null,
    })),
  };
}

export function signShopifyWebhookBody(rawBody: string, secret: string) {
  return createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64');
}

async function fetchShopifyOrderByName(config: ShopifyOrderBackfillConfig, fetchImpl: ShopifyOrderBackfillFetch) {
  const searchableOrderName = config.orderName.replace(/^#/, '');
  const response = await fetchImpl(
    `https://${config.shopDomain}/admin/api/${config.apiVersion}/graphql.json`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-shopify-access-token': config.adminAccessToken,
      },
      body: JSON.stringify({
        query: ORDER_LOOKUP_QUERY,
        variables: {
          query: `name:${searchableOrderName}`,
        },
      }),
    },
  );

  const parsed = (await response.json()) as ShopifyOrderLookupResponse;
  if (!response.ok) {
    const message = parsed.errors?.map((error) => error.message).filter(Boolean).join('; ');
    throw new Error(`Shopify order lookup failed with HTTP ${response.status}${message ? `: ${message}` : ''}.`);
  }
  if (parsed.errors && parsed.errors.length > 0) {
    const message = parsed.errors.map((error) => error.message).filter(Boolean).join('; ');
    throw new Error(`Shopify order lookup failed: ${message || 'unknown GraphQL error'}.`);
  }

  const exactMatches = (parsed.data?.orders?.nodes ?? []).filter((order) => order.name === config.orderName);
  if (exactMatches.length !== 1) {
    throw new Error(`Expected exactly one Shopify order named ${config.orderName}, found ${exactMatches.length}.`);
  }

  const order = exactMatches[0];
  if ((order.lineItems?.nodes ?? []).length === 0) {
    throw new Error(`Shopify order ${config.orderName} has no line items to ingest.`);
  }

  return order;
}

function readBackendAction(body: unknown) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return {
      action: null,
      duplicate: false,
      allocationCount: null,
      message: null,
    };
  }

  const value = body as Record<string, unknown>;
  return {
    action: typeof value.action === 'string' ? value.action : null,
    duplicate: value.duplicate === true,
    allocationCount: typeof value.allocationCount === 'number' ? value.allocationCount : null,
    message: typeof value.message === 'string' ? value.message : null,
  };
}

export async function runShopifyOrderBackfill(
  env: ShopifyOrderBackfillEnv,
  deps: { fetch?: ShopifyOrderBackfillFetch } = {},
): Promise<ShopifyOrderBackfillResult> {
  const config = validateShopifyOrderBackfillEnv(env);
  const fetchImpl = deps.fetch ?? fetch;
  const order = await fetchShopifyOrderByName(config, fetchImpl as ShopifyOrderBackfillFetch);
  const payload = buildOrdersCreatePayloadFromShopifyOrder(order);
  const rawBody = JSON.stringify(payload);
  const webhookId = getWebhookId(order);
  const response = await fetchImpl(`${config.backendUrl}/webhooks/shopify/orders-create`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-shopify-hmac-sha256': signShopifyWebhookBody(rawBody, config.webhookSecret),
      'x-shopify-topic': 'orders/create',
      'x-shopify-shop-domain': config.shopDomain,
      'x-shopify-webhook-id': webhookId,
    },
    body: rawBody,
  });

  let backendBody: unknown = null;
  try {
    backendBody = await response.json();
  } catch {
    backendBody = { message: await response.text() };
  }

  const backendSummary = readBackendAction(backendBody);
  return {
    ok: response.ok,
    orderName: config.orderName,
    shopifyOrderId: String(payload.id),
    webhookId,
    backendStatus: response.status,
    backendAction: backendSummary.action,
    duplicate: backendSummary.duplicate,
    allocationCount: backendSummary.allocationCount,
    message: backendSummary.message,
  };
}
