import { createHmac } from 'node:crypto';
import { prisma } from '../../db/prisma.js';
import { buildSaleLedgerEntryId } from '../finance/sale-ledger.service.js';
import type { ShopifyOrdersCreateWebhookPayload } from './order-ingestion.types.js';

const LIVE_BACKFILL_CONFIRMATION = 'BACKFILL_FRESH_MISSING_ORDER';
const DEFAULT_MAX_BACKFILL_AGE_DAYS = 3;

export type ShopifyOrderBackfillEnv = {
  SHOPIFY_ORDER_BACKFILL_CONFIRM?: string;
  SHOPIFY_ORDER_BACKFILL_NAME?: string;
  SHOPIFY_ORDER_BACKFILL_BACKEND_URL?: string;
  SHOPIFY_SHOP_DOMAIN?: string;
  SHOPIFY_ADMIN_ACCESS_TOKEN?: string;
  SHOPIFY_API_VERSION?: string;
  SHOPIFY_WEBHOOK_SECRET?: string;
  SHOPIFY_ORDER_BACKFILL_MAX_AGE_DAYS?: string;
};

export type ShopifyOrderBackfillConfig = {
  orderName: string;
  backendUrl: string;
  shopDomain: string;
  adminAccessToken: string;
  apiVersion: string;
  webhookSecret: string;
  liveConfirmed: boolean;
  maxAgeDays: number;
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
    currencyCode?: string | null;
  } | null;
} | null;

type ShopifyAddressNode = {
  name?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  company?: string | null;
  phone?: string | null;
  country?: string | null;
  countryCodeV2?: string | null;
  zip?: string | null;
  city?: string | null;
  province?: string | null;
  address1?: string | null;
  address2?: string | null;
} | null;

type ShopifyTaxLineNode = {
  title?: string | null;
  rate?: number | null;
  ratePercentage?: number | null;
  priceSet?: MoneySet;
};

type ShopifyOrderNode = {
  id: string;
  legacyResourceId?: string | null;
  name: string | null;
  createdAt: string | null;
  currencyCode?: string | null;
  displayFinancialStatus?: string | null;
  cancelledAt?: string | null;
  cancelReason?: string | null;
  paymentGatewayNames?: string[] | null;
  taxesIncluded?: boolean | null;
  note?: string | null;
  tags?: string[] | null;
  email?: string | null;
  phone?: string | null;
  totalPriceSet?: MoneySet;
  currentTotalTaxSet?: MoneySet;
  totalShippingPriceSet?: MoneySet;
  currentTotalDiscountsSet?: MoneySet;
  customer?: {
    email?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    phone?: string | null;
  } | null;
  shippingAddress?: ShopifyAddressNode;
  billingAddress?: ShopifyAddressNode;
  metafield?: {
    value?: string | null;
  } | null;
  lineItems?: {
    pageInfo?: {
      hasNextPage?: boolean | null;
    } | null;
    nodes?: ShopifyOrderLineItemNode[];
  } | null;
  fulfillmentOrders?: {
    nodes?: Array<{
      id: string;
      status?: string | null;
      requestStatus?: string | null;
      lineItems?: {
        nodes?: Array<{
          id: string;
          remainingQuantity?: number | null;
          totalQuantity?: number | null;
          lineItem?: {
            id?: string | null;
          } | null;
        }>;
      } | null;
    }>;
  } | null;
  refunds?: {
    nodes?: Array<{ id: string }>;
  } | null;
  returns?: {
    nodes?: Array<{ id: string; status?: string | null }>;
  } | null;
};

type ShopifyOrderLineItemNode = {
  id: string;
  sku?: string | null;
  title?: string | null;
  name?: string | null;
  variantTitle?: string | null;
  quantity?: number | null;
  currentQuantity?: number | null;
  refundableQuantity?: number | null;
  originalUnitPriceSet?: MoneySet;
  discountedTotalSet?: MoneySet;
  taxLines?: ShopifyTaxLineNode[];
  variant?: {
    id?: string | null;
    legacyResourceId?: string | null;
  } | null;
  product?: {
    id?: string | null;
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
  liveBackfillAttempted: boolean;
  eligibleForLiveBackfill: boolean;
  blockedReasonCodes: ShopifyOrderBackfillBlockReasonCode[];
  missingFields: string[];
  expectedVendors: string[];
  expectedAllocations: string[];
  expectedLineItems: Array<{
    sourceLineItemId: string;
    sku: string | null;
    vendorId: string | null;
    quantity: number;
  }>;
  expectedSaleLedgerIds: string[];
  expectedFinanceProfileSnapshots: Array<{
    vendorId: string;
    commissionPercentSnapshot: string;
    commissionVatPercentSnapshot: string;
    settlementDelayDaysSnapshot: number;
  }>;
  backendStatus: number | null;
  backendAction: string | null;
  duplicate: boolean;
  allocationCount: number | null;
  message: string | null;
};

export type ShopifyOrderBackfillBlockReasonCode =
  | 'backfill_order_already_exists'
  | 'backfill_duplicate_order_name_conflict'
  | 'backfill_historical_order_requires_manual_review'
  | 'backfill_cancelled_order_blocked'
  | 'backfill_fulfilled_order_blocked'
  | 'backfill_refunded_order_blocked'
  | 'backfill_returned_order_blocked'
  | 'backfill_seller_info_missing'
  | 'backfill_unknown_vendor'
  | 'backfill_payload_incomplete';

export type BackfillLocalStore = {
  findOrderBySourceId(sourceShopifyOrderId: string): Promise<{ id: string } | null>;
  findOrdersByNumber(sourceShopifyOrderNumber: string): Promise<Array<{ sourceShopifyOrderId: string }>>;
  listVendors(): Promise<Array<{ id: string }>>;
  listActiveFinancialProfiles(vendorIds: string[]): Promise<Array<{
    vendorId: string;
    commissionPercent: unknown;
    commissionVatPercent: unknown;
    settlementDelayDays: number | null;
  }>>;
};

const ORDER_LOOKUP_QUERY = `#graphql
  query BackfillOrderByName($query: String!) {
    orders(first: 5, query: $query) {
      nodes {
        id
        legacyResourceId
        name
        createdAt
        currencyCode
        displayFinancialStatus
        cancelledAt
        cancelReason
        paymentGatewayNames
        taxesIncluded
        note
        tags
        email
        phone
        totalPriceSet {
          shopMoney {
            amount
            currencyCode
          }
        }
        currentTotalTaxSet {
          shopMoney {
            amount
            currencyCode
          }
        }
        totalShippingPriceSet {
          shopMoney {
            amount
            currencyCode
          }
        }
        currentTotalDiscountsSet {
          shopMoney {
            amount
            currencyCode
          }
        }
        customer {
          email
          firstName
          lastName
          phone
        }
        shippingAddress {
          name
          firstName
          lastName
          company
          phone
          country
          countryCodeV2
          zip
          city
          province
          address1
          address2
        }
        billingAddress {
          name
          firstName
          lastName
          company
          phone
          country
          countryCodeV2
          zip
          city
          province
          address1
          address2
        }
        metafield(namespace: "custom", key: "seller_info") {
          value
        }
        lineItems(first: 100) {
          pageInfo {
            hasNextPage
          }
          nodes {
            id
            sku
            title
            name
            variantTitle
            quantity
            currentQuantity
            refundableQuantity
            originalUnitPriceSet {
              shopMoney {
                amount
                currencyCode
              }
            }
            discountedTotalSet {
              shopMoney {
                amount
                currencyCode
              }
            }
            taxLines {
              title
              rate
              ratePercentage
              priceSet {
                shopMoney {
                  amount
                  currencyCode
                }
              }
            }
            variant {
              id
              legacyResourceId
            }
            product {
              id
              legacyResourceId
            }
          }
        }
        fulfillmentOrders(first: 50) {
          nodes {
            id
            status
            requestStatus
            lineItems(first: 50) {
              nodes {
                id
                remainingQuantity
                totalQuantity
                lineItem {
                  id
                }
              }
            }
          }
        }
        refunds(first: 1) {
          nodes {
            id
          }
        }
        returns(first: 1) {
          nodes {
            id
            status
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

function getDefaultLocalStore(): BackfillLocalStore {
  return {
    findOrderBySourceId: (sourceShopifyOrderId) =>
      prisma.shopifyOrder.findUnique({
        where: { sourceShopifyOrderId },
        select: { id: true },
      }),
    findOrdersByNumber: (sourceShopifyOrderNumber) =>
      prisma.shopifyOrder.findMany({
        where: { sourceShopifyOrderNumber },
        select: { sourceShopifyOrderId: true },
      }),
    listVendors: () => prisma.vendor.findMany({ select: { id: true } }),
    listActiveFinancialProfiles: (vendorIds) =>
      prisma.vendorFinancialProfile.findMany({
        where: {
          vendorId: { in: vendorIds },
          active: true,
        },
        select: {
          vendorId: true,
          commissionPercent: true,
          commissionVatPercent: true,
          settlementDelayDays: true,
        },
      }),
  };
}

function parseMaxAgeDays(value: string | undefined) {
  if (value === undefined || value.trim() === '') {
    return DEFAULT_MAX_BACKFILL_AGE_DAYS;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error('SHOPIFY_ORDER_BACKFILL_MAX_AGE_DAYS must be a non-negative number.');
  }
  return parsed;
}

export function validateShopifyOrderBackfillEnv(env: ShopifyOrderBackfillEnv): ShopifyOrderBackfillConfig {
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
    liveConfirmed: env.SHOPIFY_ORDER_BACKFILL_CONFIRM === LIVE_BACKFILL_CONFIRMATION,
    maxAgeDays: parseMaxAgeDays(env.SHOPIFY_ORDER_BACKFILL_MAX_AGE_DAYS),
  };
}

function readMoneyAmount(value: MoneySet | undefined) {
  return normalizeOptionalString(value?.shopMoney?.amount ?? null);
}

function readMoneyCurrency(value: MoneySet | undefined) {
  return normalizeOptionalString(value?.shopMoney?.currencyCode ?? null);
}

function buildAddressLine(address: ShopifyAddressNode) {
  return [address?.address1, address?.address2].filter(Boolean).join(' ') || null;
}

function buildFullName(address: ShopifyAddressNode) {
  return normalizeOptionalString(address?.name) ?? ([address?.firstName, address?.lastName].filter(Boolean).join(' ') || null);
}

function parseSellerInfoValue(value: string | null | undefined): Record<string, string> | null {
  const trimmed = normalizeOptionalString(value);
  if (!trimmed) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    return Object.entries(parsed).reduce<Record<string, string>>((acc, [key, rawValue]) => {
      if (typeof rawValue === 'string' && key.trim() && rawValue.trim()) {
        acc[key.trim()] = rawValue.trim().toLowerCase();
      }
      return acc;
    }, {});
  } catch {
    return null;
  }
}

function pushMissing(missingFields: string[], field: string, value: unknown) {
  if (value === null || value === undefined || value === '') {
    missingFields.push(field);
  }
}

function buildTaxLinePayload(taxLine: ShopifyTaxLineNode) {
  return {
    title: taxLine.title ?? null,
    rate: taxLine.rate ?? null,
    rate_percentage: taxLine.ratePercentage ?? null,
    price: taxLine.priceSet?.shopMoney?.amount ?? null,
    price_set: {
      shop_money: {
        amount: taxLine.priceSet?.shopMoney?.amount ?? null,
        currency_code: taxLine.priceSet?.shopMoney?.currencyCode ?? null,
      },
    },
  };
}

export function buildOrdersCreatePayloadFromShopifyOrder(order: ShopifyOrderNode): ShopifyOrdersCreateWebhookPayload {
  const orderId = order.legacyResourceId || extractShopifyGidTail(order.id);
  const orderName = order.name ?? `#${orderId}`;
  const shippingAddress = order.shippingAddress ?? null;
  const billingAddress = order.billingAddress ?? null;

  return {
    id: orderId,
    order_number: getOrderNumber(orderName),
    name: orderName,
    created_at: order.createdAt,
    currency: order.currencyCode ?? readMoneyCurrency(order.totalPriceSet ?? undefined),
    financial_status: order.displayFinancialStatus?.toLowerCase() ?? null,
    gateway: order.paymentGatewayNames?.find((gateway) => Boolean(normalizeOptionalString(gateway))) ?? null,
    payment_gateway_names: order.paymentGatewayNames ?? null,
    taxes_included: typeof order.taxesIncluded === 'boolean' ? order.taxesIncluded : null,
    total_tax: readMoneyAmount(order.currentTotalTaxSet ?? undefined),
    current_total_tax: readMoneyAmount(order.currentTotalTaxSet ?? undefined),
    total_price: order.totalPriceSet?.shopMoney?.amount ?? null,
    total_discounts: readMoneyAmount(order.currentTotalDiscountsSet ?? undefined),
    total_shipping_price_set: {
      shop_money: {
        amount: readMoneyAmount(order.totalShippingPriceSet ?? undefined),
        currency_code: readMoneyCurrency(order.totalShippingPriceSet ?? undefined),
      },
    },
    note: order.note ?? null,
    tags: order.tags ?? [],
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
    billing_address: billingAddress
      ? {
          name: buildFullName(billingAddress),
          first_name: billingAddress.firstName ?? null,
          last_name: billingAddress.lastName ?? null,
          company: billingAddress.company ?? null,
          phone: billingAddress.phone ?? null,
          country: billingAddress.country ?? null,
          country_code: billingAddress.countryCodeV2 ?? null,
          zip: billingAddress.zip ?? null,
          city: billingAddress.city ?? null,
          province: billingAddress.province ?? null,
          address1: billingAddress.address1 ?? null,
          address2: billingAddress.address2 ?? null,
        }
      : null,
    line_items: (order.lineItems?.nodes ?? []).map((lineItem) => ({
      id: extractShopifyGidTail(lineItem.id),
      product_id: lineItem.product?.legacyResourceId ?? (lineItem.product?.id ? extractShopifyGidTail(lineItem.product.id) : null),
      variant_id: lineItem.variant?.legacyResourceId ?? null,
      sku: lineItem.sku ?? null,
      title: lineItem.title ?? lineItem.name ?? null,
      name: lineItem.name ?? lineItem.title ?? null,
      variant_title: lineItem.variantTitle ?? null,
      quantity: lineItem.quantity ?? 0,
      price: lineItem.originalUnitPriceSet?.shopMoney?.amount ?? null,
      tax_lines: (lineItem.taxLines ?? []).map(buildTaxLinePayload),
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

function hasFulfillmentProgress(order: ShopifyOrderNode) {
  const lineItems = (order.fulfillmentOrders?.nodes ?? []).flatMap((fulfillmentOrder) =>
    fulfillmentOrder.lineItems?.nodes ?? []
  );
  return lineItems.some((lineItem) =>
    typeof lineItem.remainingQuantity === 'number' &&
    typeof lineItem.totalQuantity === 'number' &&
    lineItem.remainingQuantity < lineItem.totalQuantity
  );
}

function getOrderAgeDays(order: ShopifyOrderNode, now = new Date()) {
  if (!order.createdAt) {
    return null;
  }
  const createdAt = new Date(order.createdAt);
  if (Number.isNaN(createdAt.getTime())) {
    return null;
  }
  return Math.max(0, (now.getTime() - createdAt.getTime()) / (24 * 60 * 60 * 1000));
}

function addBlockReason(
  reasons: Set<ShopifyOrderBackfillBlockReasonCode>,
  code: ShopifyOrderBackfillBlockReasonCode,
) {
  reasons.add(code);
}

async function buildPreflightReport(input: {
  config: ShopifyOrderBackfillConfig;
  order: ShopifyOrderNode;
  localStore: BackfillLocalStore;
}) {
  const reasons = new Set<ShopifyOrderBackfillBlockReasonCode>();
  const missingFields: string[] = [];
  const orderId = input.order.legacyResourceId || extractShopifyGidTail(input.order.id);
  const orderName = input.order.name ?? `#${orderId}`;
  const sellerInfo = parseSellerInfoValue(input.order.metafield?.value ?? null);
  const lineItems = input.order.lineItems?.nodes ?? [];

  const existingOrder = await input.localStore.findOrderBySourceId(orderId);
  if (existingOrder) {
    addBlockReason(reasons, 'backfill_order_already_exists');
  }
  const sameNumberOrders = await input.localStore.findOrdersByNumber(orderName);
  if (sameNumberOrders.some((order) => order.sourceShopifyOrderId !== orderId)) {
    addBlockReason(reasons, 'backfill_duplicate_order_name_conflict');
  }
  if (input.order.cancelledAt) {
    addBlockReason(reasons, 'backfill_cancelled_order_blocked');
  }
  if (hasFulfillmentProgress(input.order)) {
    addBlockReason(reasons, 'backfill_fulfilled_order_blocked');
  }
  if ((input.order.refunds?.nodes ?? []).length > 0) {
    addBlockReason(reasons, 'backfill_refunded_order_blocked');
  }
  if ((input.order.returns?.nodes ?? []).length > 0) {
    addBlockReason(reasons, 'backfill_returned_order_blocked');
  }
  const ageDays = getOrderAgeDays(input.order);
  if (ageDays === null || ageDays > input.config.maxAgeDays) {
    addBlockReason(reasons, 'backfill_historical_order_requires_manual_review');
  }
  if (!sellerInfo) {
    addBlockReason(reasons, 'backfill_seller_info_missing');
  }
  if (input.order.lineItems?.pageInfo?.hasNextPage) {
    addBlockReason(reasons, 'backfill_payload_incomplete');
    missingFields.push('lineItems.paginationComplete');
  }

  pushMissing(missingFields, 'order.id', orderId);
  pushMissing(missingFields, 'order.name', input.order.name);
  pushMissing(missingFields, 'order.createdAt', input.order.createdAt);
  pushMissing(missingFields, 'order.currencyCode', input.order.currencyCode);
  pushMissing(missingFields, 'order.displayFinancialStatus', input.order.displayFinancialStatus);
  pushMissing(missingFields, 'order.totalPriceSet.shopMoney.amount', input.order.totalPriceSet?.shopMoney?.amount);
  pushMissing(missingFields, 'order.currentTotalTaxSet.shopMoney.amount', input.order.currentTotalTaxSet?.shopMoney?.amount);
  pushMissing(missingFields, 'order.totalShippingPriceSet.shopMoney.amount', input.order.totalShippingPriceSet?.shopMoney?.amount);
  pushMissing(missingFields, 'order.currentTotalDiscountsSet.shopMoney.amount', input.order.currentTotalDiscountsSet?.shopMoney?.amount);
  if (typeof input.order.taxesIncluded !== 'boolean') {
    missingFields.push('order.taxesIncluded');
  }

  const vendors = await input.localStore.listVendors();
  const vendorIds = new Set(vendors.map((vendor) => vendor.id));
  const expectedLineItems = lineItems.map((lineItem, index) => {
    const sku = normalizeOptionalString(lineItem.sku);
    const vendorId = sku && sellerInfo ? normalizeOptionalString(sellerInfo[sku]) : null;
    if (!sku) {
      missingFields.push(`lineItems[${index}].sku`);
    }
    if (!vendorId) {
      addBlockReason(reasons, 'backfill_seller_info_missing');
    } else if (!vendorIds.has(vendorId)) {
      addBlockReason(reasons, 'backfill_unknown_vendor');
    }
    pushMissing(missingFields, `lineItems[${index}].id`, lineItem.id);
    pushMissing(missingFields, `lineItems[${index}].title`, lineItem.title ?? lineItem.name);
    pushMissing(missingFields, `lineItems[${index}].variant.legacyResourceId`, lineItem.variant?.legacyResourceId);
    pushMissing(missingFields, `lineItems[${index}].originalUnitPriceSet.shopMoney.amount`, lineItem.originalUnitPriceSet?.shopMoney?.amount);
    pushMissing(missingFields, `lineItems[${index}].discountedTotalSet.shopMoney.amount`, lineItem.discountedTotalSet?.shopMoney?.amount);
    if (!lineItem.taxLines || lineItem.taxLines.length === 0) {
      missingFields.push(`lineItems[${index}].taxLines`);
    }
    if (typeof lineItem.quantity !== 'number' || lineItem.quantity <= 0) {
      missingFields.push(`lineItems[${index}].quantity`);
    }
    return {
      sourceLineItemId: extractShopifyGidTail(lineItem.id),
      sku,
      vendorId,
      quantity: lineItem.quantity ?? 0,
    };
  });

  if (missingFields.length > 0 || lineItems.length === 0) {
    addBlockReason(reasons, 'backfill_payload_incomplete');
  }

  const expectedVendors = Array.from(new Set(expectedLineItems.map((lineItem) => lineItem.vendorId).filter(Boolean) as string[]));
  const expectedAllocations = expectedVendors.map((vendorId) => `alloc-${vendorId}-${orderId}`);
  const expectedSaleLedgerIds = expectedVendors.map((vendorId) =>
    buildSaleLedgerEntryId(vendorId, orderId, `alloc-${vendorId}-${orderId}`)
  );
  const profiles = await input.localStore.listActiveFinancialProfiles(expectedVendors);
  const profileByVendor = new Map(profiles.map((profile) => [profile.vendorId, profile]));
  const expectedFinanceProfileSnapshots = expectedVendors.map((vendorId) => {
    const profile = profileByVendor.get(vendorId);
    return {
      vendorId,
      commissionPercentSnapshot: String(profile?.commissionPercent ?? '10.00'),
      commissionVatPercentSnapshot: String(profile?.commissionVatPercent ?? '0.00'),
      settlementDelayDaysSnapshot: profile?.settlementDelayDays ?? 21,
    };
  });

  return {
    eligibleForLiveBackfill: reasons.size === 0,
    blockedReasonCodes: Array.from(reasons),
    missingFields,
    expectedVendors,
    expectedAllocations,
    expectedLineItems,
    expectedSaleLedgerIds,
    expectedFinanceProfileSnapshots,
  };
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
  deps: { fetch?: ShopifyOrderBackfillFetch; localStore?: BackfillLocalStore } = {},
): Promise<ShopifyOrderBackfillResult> {
  const config = validateShopifyOrderBackfillEnv(env);
  const fetchImpl = deps.fetch ?? fetch;
  const localStore = deps.localStore ?? getDefaultLocalStore();
  const order = await fetchShopifyOrderByName(config, fetchImpl as ShopifyOrderBackfillFetch);
  const preflight = await buildPreflightReport({
    config,
    order,
    localStore,
  });
  const payload = buildOrdersCreatePayloadFromShopifyOrder(order);
  const webhookId = getWebhookId(order);

  if (!config.liveConfirmed || !preflight.eligibleForLiveBackfill) {
    return {
      ok: preflight.eligibleForLiveBackfill,
      orderName: config.orderName,
      shopifyOrderId: String(payload.id),
      webhookId,
      liveBackfillAttempted: false,
      ...preflight,
      backendStatus: null,
      backendAction: null,
      duplicate: false,
      allocationCount: null,
      message: preflight.eligibleForLiveBackfill
        ? `Dry-run eligible. Set SHOPIFY_ORDER_BACKFILL_CONFIRM=${LIVE_BACKFILL_CONFIRMATION} to execute live backfill.`
        : `Backfill blocked: ${preflight.blockedReasonCodes.join(', ') || 'unknown reason'}.`,
    };
  }

  const rawBody = JSON.stringify(payload);
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
    liveBackfillAttempted: true,
    ...preflight,
    backendStatus: response.status,
    backendAction: backendSummary.action,
    duplicate: backendSummary.duplicate,
    allocationCount: backendSummary.allocationCount,
    message: backendSummary.message,
  };
}
