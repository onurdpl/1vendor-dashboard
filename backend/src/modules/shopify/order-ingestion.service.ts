import { prisma } from '../../db/prisma.js';
import { upsertSaleLedgerForAllocation } from '../finance/sale-ledger.service.js';
import type {
  ParsedShopifyOrderLineItem,
  ParsedShopifyOrderPayload,
  OrderIngestionFailureDetails,
  OrderIngestionInput,
  OrderIngestionResult,
  ShopifyOrdersCreateLineItemPayload,
  ShopifyOrdersCreateWebhookPayload,
} from './order-ingestion.types.js';
import type { FetchOrderTaxSnapshotResult, ShopifyOrderLineItemImage, ShopifyTaxLineSnapshot } from './shopify-admin.types.js';

const DEFAULT_VENDOR_INTEGRATION_VAT_RATE = '10';

const TRANSIENT_DATABASE_OR_NETWORK_CODES = new Set([
  'P1001',
  'P1002',
  'P1008',
  'P1017',
  'P2024',
  'ECONNREFUSED',
  'ECONNRESET',
  'EAI_AGAIN',
  'ETIMEDOUT',
]);

class StructuredOrderIngestionError extends Error {
  readonly details: OrderIngestionFailureDetails;

  constructor(details: OrderIngestionFailureDetails) {
    super(details.error);
    this.name = 'StructuredOrderIngestionError';
    this.details = details;
  }
}

function readErrorCode(error: unknown) {
  if (!error || typeof error !== 'object' || !('code' in error)) {
    return null;
  }

  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

export function classifyOrderIngestionException(error: unknown): OrderIngestionFailureDetails {
  if (error instanceof StructuredOrderIngestionError) {
    return error.details;
  }

  const errorCode = readErrorCode(error);
  const message = error instanceof Error ? error.message : 'Shopify order ingestion failed.';

  if (errorCode === 'P2034') {
    return {
      failureCode: 'transaction_contention',
      failureDisposition: 'RETRYABLE',
      failureCategory: 'transient',
      retryable: true,
      error: message,
    };
  }

  if (errorCode && TRANSIENT_DATABASE_OR_NETWORK_CODES.has(errorCode)) {
    return {
      failureCode: 'transient_database_or_network',
      failureDisposition: 'RETRYABLE',
      failureCategory: 'transient',
      retryable: true,
      error: message,
    };
  }

  return {
    failureCode: 'unknown_internal_error',
    failureDisposition: 'UNKNOWN',
    failureCategory: 'reconciliation_required',
    retryable: false,
    error: message,
  };
}

function nonRetryableFailure(
  failureCode: OrderIngestionFailureDetails['failureCode'],
  error: string,
  failureCategory: OrderIngestionFailureDetails['failureCategory'] = 'validation',
) {
  return new StructuredOrderIngestionError({
    failureCode,
    failureDisposition: 'NON_RETRYABLE',
    failureCategory,
    retryable: false,
    error,
  });
}

function buildCustomerName(payload: ShopifyOrdersCreateWebhookPayload) {
  const firstName = payload.customer?.first_name?.trim();
  const lastName = payload.customer?.last_name?.trim();
  const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();
  return fullName || null;
}

function buildCustomerEmail(payload: ShopifyOrdersCreateWebhookPayload) {
  return typeof payload.customer?.email === 'string'
    ? readAddressString(payload.customer.email)
    : typeof payload.email === 'string'
      ? readAddressString(payload.email)
      : null;
}

function readAddressString(value: string | null | undefined) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || null;
}

function readPayloadString(value: string | null | undefined) {
  return readAddressString(value);
}

function isTurkeyAddress(address: { country?: string | null; country_code?: string | null } | null | undefined) {
  const countryCode = readAddressString(address?.country_code)?.toUpperCase();
  if (countryCode === 'TR') {
    return true;
  }

  const country = readAddressString(address?.country)?.toLocaleLowerCase('tr-TR');
  return country === 'turkey' || country === 'türkiye' || country === 'turkiye';
}

function readTurkeyAddress2District(address: { address2?: string | null; country?: string | null; country_code?: string | null } | null | undefined) {
  return isTurkeyAddress(address) ? readAddressString(address?.address2) : null;
}

function readShopifyAddressDistrict(address: {
  district?: string | null;
  district_name?: string | null;
  districtName?: string | null;
  city_area?: string | null;
  cityArea?: string | null;
  county?: string | null;
  county_name?: string | null;
  countyName?: string | null;
  address2?: string | null;
  province?: string | null;
  country?: string | null;
  country_code?: string | null;
} | null | undefined) {
  return (
    readAddressString(address?.district) ??
    readAddressString(address?.district_name) ??
    readAddressString(address?.districtName) ??
    readAddressString(address?.city_area) ??
    readAddressString(address?.cityArea) ??
    readAddressString(address?.county) ??
    readAddressString(address?.county_name) ??
    readAddressString(address?.countyName) ??
    readTurkeyAddress2District(address) ??
    readAddressString(address?.province)
  );
}

function toMoneyString(value: string | number | null | undefined) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return parsed.toFixed(2);
}

function sumMoneyValues(values: Array<string | number | null | undefined>) {
  let sawValue = false;
  let sum = 0;

  for (const value of values) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      continue;
    }

    sawValue = true;
    sum += parsed;
  }

  return sawValue ? sum.toFixed(2) : null;
}

export function normalizeShopifyShipmentPhone(value: string | null | undefined) {
  const normalized = readAddressString(value);
  return normalized ? normalized.replace(/\s+/g, '') : null;
}

function composeShopifyShippingAddress(address: ShopifyOrdersCreateWebhookPayload['shipping_address']) {
  if (!address) {
    return null;
  }

  const directAddress = readAddressString(address.address);
  if (directAddress) {
    return directAddress;
  }

  const parts = [readAddressString(address.address1), readAddressString(address.address2)].filter(
    (part): part is string => Boolean(part),
  );
  return parts.join(', ') || null;
}

export function mapShopifyShippingAddress(payload: ShopifyOrdersCreateWebhookPayload) {
  const address = payload.shipping_address;
  return {
    customerPhone:
      normalizeShopifyShipmentPhone(address?.phone) ??
      normalizeShopifyShipmentPhone(payload.phone) ??
      normalizeShopifyShipmentPhone(payload.customer?.phone),
    shippingCountry: readAddressString(address?.country_code) ?? readAddressString(address?.country),
    shippingPostcode: readAddressString(address?.zip) ?? readAddressString(address?.postcode),
    shippingCity: readAddressString(address?.city),
    shippingDistrict: readShopifyAddressDistrict(address),
    shippingAddress: composeShopifyShippingAddress(address),
  };
}

function buildBillingFullName(address: ShopifyOrdersCreateWebhookPayload['billing_address']) {
  const directName = readAddressString(address?.name);
  if (directName) {
    return directName;
  }

  const firstName = readAddressString(address?.first_name);
  const lastName = readAddressString(address?.last_name);
  const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();
  return fullName || null;
}

export function mapShopifyBillingAddress(payload: ShopifyOrdersCreateWebhookPayload) {
  const address = payload.billing_address;
  return {
    billingFullName: buildBillingFullName(address),
    billingCompany: readAddressString(address?.company),
    billingPhone: normalizeShopifyShipmentPhone(address?.phone),
    billingCity: readAddressString(address?.city),
    billingDistrict: readShopifyAddressDistrict(address),
    billingAddress1: readAddressString(address?.address1),
    billingAddress2: readAddressString(address?.address2),
    billingPostcode: readAddressString(address?.zip) ?? readAddressString(address?.postcode),
  };
}

function mapShopifyOrderContactAddressSnapshot(payload: ShopifyOrdersCreateWebhookPayload) {
  return {
    customerName: buildCustomerName(payload),
    customerEmail: buildCustomerEmail(payload),
    ...mapShopifyShippingAddress(payload),
    ...mapShopifyBillingAddress(payload),
  };
}

function normalizeComparableSnapshotValue(value: unknown) {
  return typeof value === 'string' ? value.trim() || null : value ?? null;
}

function resolveShopifyOrderWebhookIdentifiers(payload: ShopifyOrdersCreateWebhookPayload) {
  const sourceShopifyOrderId = payload.id !== undefined && payload.id !== null ? String(payload.id) : null;
  const sourceShopifyOrderNumber =
    typeof payload.name === 'string' && payload.name.trim()
      ? payload.name.trim()
      : payload.order_number !== undefined && payload.order_number !== null
        ? `#${String(payload.order_number)}`
        : null;

  return {
    sourceShopifyOrderId,
    sourceShopifyOrderNumber,
  };
}

export async function updateShopifyOrderContactAddressSnapshotFromWebhook(payload: ShopifyOrdersCreateWebhookPayload) {
  const { sourceShopifyOrderId, sourceShopifyOrderNumber } = resolveShopifyOrderWebhookIdentifiers(payload);
  const order = await prisma.shopifyOrder.findFirst({
    where: {
      OR: [
        ...(sourceShopifyOrderId ? [{ sourceShopifyOrderId }] : []),
        ...(sourceShopifyOrderNumber
          ? [
              { sourceShopifyOrderNumber: sourceShopifyOrderNumber },
              { sourceShopifyOrderNumber: sourceShopifyOrderNumber.replace(/^#/, '') },
            ]
          : []),
      ],
    },
    select: {
      id: true,
      sourceShopifyOrderId: true,
      sourceShopifyOrderNumber: true,
      customerName: true,
      customerEmail: true,
      customerPhone: true,
      shippingAddress: true,
      shippingCity: true,
      shippingDistrict: true,
      shippingPostcode: true,
      shippingCountry: true,
      billingFullName: true,
      billingCompany: true,
      billingPhone: true,
      billingCity: true,
      billingDistrict: true,
      billingAddress1: true,
      billingAddress2: true,
      billingPostcode: true,
    },
  });

  if (!order) {
    return {
      matched: false,
      updated: false,
      orderId: null,
      sourceShopifyOrderId,
      changedFields: [],
    };
  }

  const snapshot = mapShopifyOrderContactAddressSnapshot(payload);
  const updateData: Partial<typeof snapshot> = {};
  const changedFields: string[] = [];

  for (const [field, value] of Object.entries(snapshot) as Array<[keyof typeof snapshot, string | null]>) {
    if (value === null) {
      continue;
    }

    if (normalizeComparableSnapshotValue(order[field]) !== normalizeComparableSnapshotValue(value)) {
      updateData[field] = value;
      changedFields.push(field);
    }
  }

  if (changedFields.length > 0) {
    await prisma.shopifyOrder.update({
      where: {
        id: order.id,
      },
      data: updateData,
    });
  }

  return {
    matched: true,
    updated: changedFields.length > 0,
    orderId: order.id,
    sourceShopifyOrderId: order.sourceShopifyOrderId,
    changedFields,
  };
}

export async function syncShopifyOrderPaidSnapshotFromWebhook(payload: ShopifyOrdersCreateWebhookPayload) {
  const { sourceShopifyOrderId, sourceShopifyOrderNumber } = resolveShopifyOrderWebhookIdentifiers(payload);
  const orderLookup = [
    ...(sourceShopifyOrderId ? [{ sourceShopifyOrderId }] : []),
    ...(sourceShopifyOrderNumber
      ? [
          { sourceShopifyOrderNumber },
          { sourceShopifyOrderNumber: sourceShopifyOrderNumber.replace(/^#/, '') },
        ]
      : []),
  ];

  if (orderLookup.length === 0) {
    return {
      matched: false,
      updated: false,
      orderId: null,
      sourceShopifyOrderId,
      changedFields: [],
      financialStatus: null,
      paymentGatewayName: null,
    };
  }

  const order = await prisma.shopifyOrder.findFirst({
    where: {
      OR: orderLookup,
    },
    select: {
      id: true,
      sourceShopifyOrderId: true,
      financialStatus: true,
      paymentGatewayName: true,
    },
  });

  if (!order) {
    return {
      matched: false,
      updated: false,
      orderId: null,
      sourceShopifyOrderId,
      changedFields: [],
      financialStatus: null,
      paymentGatewayName: null,
    };
  }

  const financialStatus = readPayloadString(payload.financial_status) ?? 'paid';
  const paymentGatewayName = resolvePaymentGatewayName(payload);
  const updateData: { financialStatus?: string; paymentGatewayName?: string } = {};
  const changedFields: string[] = [];

  if (normalizeComparableSnapshotValue(order.financialStatus) !== financialStatus) {
    updateData.financialStatus = financialStatus;
    changedFields.push('financialStatus');
  }

  if (paymentGatewayName && normalizeComparableSnapshotValue(order.paymentGatewayName) !== paymentGatewayName) {
    updateData.paymentGatewayName = paymentGatewayName;
    changedFields.push('paymentGatewayName');
  }

  if (changedFields.length > 0) {
    await prisma.shopifyOrder.update({
      where: {
        id: order.id,
      },
      data: updateData,
    });
  }

  return {
    matched: true,
    updated: changedFields.length > 0,
    orderId: order.id,
    sourceShopifyOrderId: order.sourceShopifyOrderId,
    changedFields,
    financialStatus,
    paymentGatewayName,
  };
}

function toDate(value: string | null | undefined) {
  if (!value) {
    return new Date();
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function toOptionalDate(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseOrderTags(value: ShopifyOrdersCreateWebhookPayload['tags']) {
  if (Array.isArray(value)) {
    return value.map((entry) => entry.trim()).filter(Boolean);
  }

  if (typeof value !== 'string') {
    return [];
  }

  return value.split(',').map((entry) => entry.trim()).filter(Boolean);
}

function resolvePaymentGatewayName(payload: ShopifyOrdersCreateWebhookPayload) {
  const firstGateway = Array.isArray(payload.payment_gateway_names)
    ? payload.payment_gateway_names.find((entry) => typeof entry === 'string' && entry.trim())
    : null;

  return readPayloadString(firstGateway ?? null) ?? readPayloadString(payload.gateway);
}

function resolveShippingAmount(payload: ShopifyOrdersCreateWebhookPayload) {
  const aggregateAmount = toMoneyString(payload.total_shipping_price_set?.shop_money?.amount);
  if (aggregateAmount) {
    return aggregateAmount;
  }

  return sumMoneyValues((payload.shipping_lines ?? []).map((line) => line.price));
}

function toNullableBoolean(value: boolean | null | undefined) {
  return typeof value === 'boolean' ? value : null;
}

function readRestTaxLineRatePercentage(taxLine: NonNullable<ShopifyOrdersCreateLineItemPayload['tax_lines']>[number] | undefined) {
  if (!taxLine) {
    return null;
  }

  const explicitPercentage = Number(taxLine.rate_percentage);
  if (Number.isFinite(explicitPercentage)) {
    return explicitPercentage.toFixed(2);
  }

  const rate = Number(taxLine.rate);
  return Number.isFinite(rate) ? (rate * 100).toFixed(2) : null;
}

function readRestTaxLineAmount(taxLine: NonNullable<ShopifyOrdersCreateLineItemPayload['tax_lines']>[number] | undefined) {
  return toMoneyString(taxLine?.price_set?.shop_money?.amount ?? taxLine?.price);
}

function readGraphqlTaxRatePercentage(taxLine: ShopifyTaxLineSnapshot | undefined) {
  if (!taxLine) {
    return null;
  }

  if (typeof taxLine.ratePercentage === 'number' && Number.isFinite(taxLine.ratePercentage)) {
    return taxLine.ratePercentage.toFixed(2);
  }

  if (typeof taxLine.rate === 'number' && Number.isFinite(taxLine.rate)) {
    return (taxLine.rate * 100).toFixed(2);
  }

  return null;
}

function calculateUnitPriceFromDiscountedTotal(discountedTotal: string | null, quantity: number) {
  const total = Number(discountedTotal);
  if (!Number.isFinite(total) || quantity <= 0) {
    return null;
  }

  return (total / quantity).toFixed(2);
}

function toLineItemTitle(lineItem: ShopifyOrdersCreateLineItemPayload) {
  if (!lineItem) {
    return null;
  }

  const baseTitle = typeof lineItem.title === 'string' ? lineItem.title : typeof lineItem.name === 'string' ? lineItem.name : null;
  const variantTitle = typeof lineItem.variant_title === 'string' ? lineItem.variant_title : null;
  if (baseTitle && variantTitle) {
    return `${baseTitle} / ${variantTitle}`;
  }

  return baseTitle;
}

function createLineItemTaxResolver(taxSnapshot: FetchOrderTaxSnapshotResult | null | undefined) {
  const byLineItemId = new Map<string, FetchOrderTaxSnapshotResult['lineItems'][number]>();
  const bySku = new Map<string, FetchOrderTaxSnapshotResult['lineItems'][number]>();

  for (const item of taxSnapshot?.lineItems ?? []) {
    byLineItemId.set(item.sourceLineItemId, item);
    byLineItemId.set(item.lineItemGid, item);
    const gidTail = item.lineItemGid.split('/').at(-1)?.trim();
    if (gidTail) {
      byLineItemId.set(gidTail, item);
    }
    if (item.sku) {
      bySku.set(item.sku, item);
    }
  }

  return (lineItem: ShopifyOrdersCreateLineItemPayload) => {
    const sourceLineItemId = String(lineItem.id);
    return byLineItemId.get(sourceLineItemId) ?? (lineItem.sku ? bySku.get(lineItem.sku) : undefined) ?? null;
  };
}

function parseOrderPayload(
  payload: ShopifyOrdersCreateWebhookPayload,
  taxSnapshot?: FetchOrderTaxSnapshotResult | null,
): ParsedShopifyOrderPayload {
  const lineItems = Array.isArray(payload.line_items) ? payload.line_items : [];
  const sourceShopifyOrderId = String(payload.id);
  const sourceShopifyOrderNumber =
    typeof payload.name === 'string' && payload.name.trim()
      ? payload.name.trim()
      : payload.order_number !== undefined && payload.order_number !== null
        ? `#${String(payload.order_number)}`
        : `#${sourceShopifyOrderId}`;
  const shippingAddress = mapShopifyShippingAddress(payload);
  const billingAddress = mapShopifyBillingAddress(payload);
  const shopifyCreatedAt = toOptionalDate(payload.created_at);
  const resolveTaxSnapshot = createLineItemTaxResolver(taxSnapshot);

  return {
    sourceShopifyOrderId,
    sourceShopifyOrderNumber,
    createdAt: shopifyCreatedAt ?? toDate(payload.created_at),
    shopifyCreatedAt,
    currency:
      readPayloadString(payload.currency) ??
      readPayloadString(payload.total_shipping_price_set?.shop_money?.currency_code),
    financialStatus: readPayloadString(payload.financial_status),
    paymentGatewayName: resolvePaymentGatewayName(payload),
    taxesIncluded: toNullableBoolean(taxSnapshot?.taxesIncluded) ?? toNullableBoolean(payload.taxes_included),
    orderTaxAmount: toMoneyString(taxSnapshot?.orderTaxAmount.amount ?? payload.current_total_tax ?? payload.total_tax),
    totalPrice: toMoneyString(payload.total_price),
    shippingAmount: resolveShippingAmount(payload),
    discountAmount: toMoneyString(payload.total_discounts),
    orderNote: readPayloadString(payload.note),
    orderTags: parseOrderTags(payload.tags),
    customerName: buildCustomerName(payload),
    customerEmail: buildCustomerEmail(payload),
    ...shippingAddress,
    ...billingAddress,
    lineItems: lineItems.map<ParsedShopifyOrderLineItem>((lineItem) => {
      const quantity = typeof lineItem.quantity === 'number' && lineItem.quantity > 0 ? lineItem.quantity : 1;
      const unitPrice = toMoneyString(lineItem.price);
      const graphqlTax = resolveTaxSnapshot(lineItem);
      const graphqlTaxLine = graphqlTax?.taxLines[0];
      const restTaxLine = lineItem.tax_lines?.[0];
      const graphqlVatRate = readGraphqlTaxRatePercentage(graphqlTaxLine);
      const restVatRate = readRestTaxLineRatePercentage(restTaxLine);
      const graphqlDiscountedTotal = toMoneyString(graphqlTax?.discountedTotal.amount);
      const taxesIncluded = toNullableBoolean(taxSnapshot?.taxesIncluded) ?? toNullableBoolean(payload.taxes_included);
      const lineTotalVatIncluded = taxesIncluded === true
        ? graphqlDiscountedTotal ?? toLineTotalVatIncluded(unitPrice, quantity)
        : toLineTotalVatIncluded(unitPrice, quantity);

      return {
        sourceLineItemId: String(lineItem.id),
        shopifyProductId:
          lineItem.product_id !== undefined && lineItem.product_id !== null ? String(lineItem.product_id) : null,
        sourceVariantId:
          lineItem.variant_id !== undefined && lineItem.variant_id !== null ? String(lineItem.variant_id) : null,
        sku: typeof lineItem.sku === 'string' && lineItem.sku.trim() ? lineItem.sku : null,
        title: toLineItemTitle(lineItem),
        quantity,
        unitPrice,
        unitPriceVatIncluded: taxesIncluded === true
          ? calculateUnitPriceFromDiscountedTotal(lineTotalVatIncluded, quantity) ?? unitPrice
          : unitPrice,
        lineTotalVatIncluded,
        lineTaxAmount: toMoneyString(graphqlTaxLine?.price.amount) ?? readRestTaxLineAmount(restTaxLine),
        vatRate: graphqlVatRate ?? restVatRate ?? DEFAULT_VENDOR_INTEGRATION_VAT_RATE,
        imageUrl: null,
      };
    }),
  };
}

function createLineItemImageResolver(lineItemImages: ShopifyOrderLineItemImage[] | undefined) {
  const byLineItemId = new Map<string, string>();
  const bySku = new Map<string, string>();

  for (const image of lineItemImages ?? []) {
    const imageUrl = image.imageUrl?.trim();
    if (!imageUrl) {
      continue;
    }

    if (image.sourceLineItemId) {
      byLineItemId.set(image.sourceLineItemId, imageUrl);
    }

    if (image.lineItemGid) {
      byLineItemId.set(image.lineItemGid, imageUrl);
      const gidTail = image.lineItemGid.split('/').at(-1)?.trim();
      if (gidTail) {
        byLineItemId.set(gidTail, imageUrl);
      }
    }

    if (image.sku) {
      bySku.set(image.sku, imageUrl);
    }
  }

  return (lineItem: ParsedShopifyOrderLineItem) =>
    byLineItemId.get(lineItem.sourceLineItemId) ?? (lineItem.sku ? bySku.get(lineItem.sku) : undefined) ?? null;
}

function normalizeVendorSlug(value: string | undefined) {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return normalized || null;
}

function toLineAmount(unitPrice: string | null, quantity: number) {
  const unit = Number(unitPrice ?? 0);
  if (!Number.isFinite(unit)) {
    return '0.00';
  }

  return (unit * quantity).toFixed(2);
}

function toLineTotalVatIncluded(unitPrice: string | null, quantity: number) {
  if (unitPrice === null) {
    return null;
  }

  return toLineAmount(unitPrice, quantity);
}

export async function ingestShopifyOrderWebhook(input: OrderIngestionInput): Promise<OrderIngestionResult> {
  const parsedOrder = parseOrderPayload(input.payload, input.taxSnapshot);
  const resolveImageUrl = createLineItemImageResolver(input.lineItemImages);

  if (parsedOrder.lineItems.length === 0) {
    await prisma.webhookEvent.update({
      where: { id: input.event.id },
      data: {
        status: 'FAILED',
        errorMessage: 'Shopify order payload did not include line items.',
      },
    });

    return {
      ok: false,
      action: 'received_needs_attention',
      processingStatus: 'needs_attention',
      failureCode: 'no_line_items',
      failureDisposition: 'NON_RETRYABLE',
      failureCategory: 'validation',
      retryable: false,
      error: 'Shopify order payload did not include line items.',
    };
  }

  try {
    const vendors = await prisma.vendor.findMany();
    const vendorIds = new Set(vendors.map((vendor) => vendor.id));

    const resolvedLineItems = parsedOrder.lineItems.map((lineItem) => {
      if (!lineItem.sku) {
        throw nonRetryableFailure(
          'missing_sku',
          `Line item ${lineItem.sourceLineItemId} is missing SKU and cannot be allocated.`,
        );
      }

      const vendorId = normalizeVendorSlug(input.sellerInfo[lineItem.sku]);
      if (!vendorId) {
        throw nonRetryableFailure(
          'missing_seller_mapping',
          `No seller_info mapping found for SKU ${lineItem.sku}.`,
          'reconciliation_required',
        );
      }

      if (!vendorIds.has(vendorId)) {
        throw nonRetryableFailure(
          'unknown_vendor',
          `seller_info mapped SKU ${lineItem.sku} to unknown vendor ${vendorId}.`,
          'reconciliation_required',
        );
      }

      return {
        ...lineItem,
        vendorId,
        imageUrl: resolveImageUrl(lineItem),
      };
    });

    const orderSnapshot = {
      sourceShopifyOrderNumber: parsedOrder.sourceShopifyOrderNumber,
      shopifyCreatedAt: parsedOrder.shopifyCreatedAt,
      currency: parsedOrder.currency,
      financialStatus: parsedOrder.financialStatus,
      paymentGatewayName: parsedOrder.paymentGatewayName,
      taxesIncluded: parsedOrder.taxesIncluded,
      orderTaxAmount: parsedOrder.orderTaxAmount,
      shippingAmount: parsedOrder.shippingAmount,
      discountAmount: parsedOrder.discountAmount,
      orderNote: parsedOrder.orderNote,
      orderTags: parsedOrder.orderTags,
      customerName: parsedOrder.customerName,
      customerEmail: parsedOrder.customerEmail,
      customerPhone: parsedOrder.customerPhone,
      billingFullName: parsedOrder.billingFullName,
      billingCompany: parsedOrder.billingCompany,
      billingPhone: parsedOrder.billingPhone,
      billingCity: parsedOrder.billingCity,
      billingDistrict: parsedOrder.billingDistrict,
      billingAddress1: parsedOrder.billingAddress1,
      billingAddress2: parsedOrder.billingAddress2,
      billingPostcode: parsedOrder.billingPostcode,
      shippingCountry: parsedOrder.shippingCountry,
      shippingPostcode: parsedOrder.shippingPostcode,
      shippingCity: parsedOrder.shippingCity,
      shippingDistrict: parsedOrder.shippingDistrict,
      shippingAddress: parsedOrder.shippingAddress,
      totalPrice: parsedOrder.totalPrice,
      createdAt: parsedOrder.createdAt,
    };
    const orderCreateData = {
      sourceShopifyOrderId: parsedOrder.sourceShopifyOrderId,
      ...orderSnapshot,
    };

    const result = await prisma.$transaction(async (tx) => {
      let shopifyOrder;
      if (input.mode === 'missing_order_only') {
        const existingOrder = await tx.shopifyOrder.findUnique({
          where: {
            sourceShopifyOrderId: parsedOrder.sourceShopifyOrderId,
          },
          select: { id: true },
        });

        if (existingOrder) {
          throw nonRetryableFailure(
            'existing_local_order_requires_current_state_repair',
            'Existing local Shopify order requires Current-State Repair; retained webhook snapshot was not applied.',
            'reconciliation_required',
          );
        }

        shopifyOrder = await tx.shopifyOrder.create({
          data: orderCreateData,
        });
      } else {
        shopifyOrder = await tx.shopifyOrder.upsert({
          where: {
            sourceShopifyOrderId: parsedOrder.sourceShopifyOrderId,
          },
          update: orderSnapshot,
          create: orderCreateData,
        });
      }

      const allocationIds = new Set<string>();

      for (const lineItem of resolvedLineItems) {
        const shopifyOrderLineItem = await tx.shopifyOrderLineItem.upsert({
          where: {
            shopifyOrderId_sourceLineItemId: {
              shopifyOrderId: shopifyOrder.id,
              sourceLineItemId: lineItem.sourceLineItemId,
            },
          },
          update: {
            shopifyProductId: lineItem.shopifyProductId,
            sourceVariantId: lineItem.sourceVariantId,
            sku: lineItem.sku,
            title: lineItem.title,
            imageUrl: lineItem.imageUrl,
            quantity: lineItem.quantity,
            unitPrice: lineItem.unitPrice,
            unitPriceVatIncluded: lineItem.unitPriceVatIncluded,
            lineTotalVatIncluded: lineItem.lineTotalVatIncluded,
            lineTaxAmount: lineItem.lineTaxAmount,
            vatRate: lineItem.vatRate,
            originalVendorId: lineItem.vendorId,
          },
          create: {
            shopifyOrderId: shopifyOrder.id,
            sourceLineItemId: lineItem.sourceLineItemId,
            shopifyProductId: lineItem.shopifyProductId,
            sourceVariantId: lineItem.sourceVariantId,
            sku: lineItem.sku,
            title: lineItem.title,
            imageUrl: lineItem.imageUrl,
            quantity: lineItem.quantity,
            unitPrice: lineItem.unitPrice,
            unitPriceVatIncluded: lineItem.unitPriceVatIncluded,
            lineTotalVatIncluded: lineItem.lineTotalVatIncluded,
            lineTaxAmount: lineItem.lineTaxAmount,
            vatRate: lineItem.vatRate,
            originalVendorId: lineItem.vendorId,
          },
        });

        const allocationId = `alloc-${lineItem.vendorId}-${parsedOrder.sourceShopifyOrderId}`;
        allocationIds.add(allocationId);

        const allocation = await tx.vendorAllocation.upsert({
          where: {
            id: allocationId,
          },
          update: {
            sourceShopifyOrderId: shopifyOrder.id,
            sourceShopifyOrderNumber: parsedOrder.sourceShopifyOrderNumber,
          },
          create: {
            id: allocationId,
            sourceShopifyOrderId: shopifyOrder.id,
            sourceShopifyOrderNumber: parsedOrder.sourceShopifyOrderNumber,
            originalVendorId: lineItem.vendorId,
            assignedVendorId: lineItem.vendorId,
            allocationStatus: 'ACTIVE',
            cancellationReason: null,
            reassignmentRequired: false,
            fulfillmentStatus: 'Pending',
            shippingStatus: 'Awaiting Shipment',
            carrier: null,
            trackingNumber: null,
          },
        });

        await tx.vendorAllocationLineItem.upsert({
          where: {
            vendorAllocationId_shopifyLineItemId: {
              vendorAllocationId: allocation.id,
              shopifyLineItemId: shopifyOrderLineItem.id,
            },
          },
          update: {
            quantity: lineItem.quantity,
            lineAmount: toLineAmount(lineItem.unitPrice, lineItem.quantity),
          },
          create: {
            vendorAllocationId: allocation.id,
            shopifyLineItemId: shopifyOrderLineItem.id,
            quantity: lineItem.quantity,
            lineAmount: toLineAmount(lineItem.unitPrice, lineItem.quantity),
          },
        });

        await tx.allocationAssignmentHistory.upsert({
          where: {
            id: `assignment-history-${lineItem.vendorId}-${parsedOrder.sourceShopifyOrderId}-initial`,
          },
          update: {
            action: 'assigned',
            fromVendorId: null,
            toVendorId: lineItem.vendorId,
            reason: 'Initial seller_info allocation',
          },
          create: {
            id: `assignment-history-${lineItem.vendorId}-${parsedOrder.sourceShopifyOrderId}-initial`,
            vendorAllocationId: allocation.id,
            action: 'assigned',
            fromVendorId: null,
            toVendorId: lineItem.vendorId,
            reason: 'Initial seller_info allocation',
          },
        });
      }

      for (const allocationId of allocationIds) {
        await upsertSaleLedgerForAllocation(tx, allocationId);
      }

      await tx.webhookEvent.update({
        where: { id: input.event.id },
        data: {
          status: 'PROCESSED',
          processedAt: new Date(),
          errorMessage: null,
          shopifyOrderId: shopifyOrder.id,
        },
      });

      return {
        shopifyOrderId: parsedOrder.sourceShopifyOrderId,
        allocationCount: allocationIds.size,
        allocationIds: Array.from(allocationIds),
      };
    });

    return {
      ok: true,
      action: 'accepted',
      processingStatus: 'processed',
      shopifyOrderId: result.shopifyOrderId,
      allocationCount: result.allocationCount,
    };
  } catch (error) {
    const failure =
      input.mode === 'missing_order_only' &&
      readErrorCode(error) === 'P2002'
        ? {
            failureCode: 'existing_local_order_requires_current_state_repair' as const,
            failureDisposition: 'NON_RETRYABLE' as const,
            failureCategory: 'reconciliation_required' as const,
            retryable: false,
            error: 'Existing local Shopify order requires Current-State Repair; retained webhook snapshot was not applied.',
          }
        : classifyOrderIngestionException(error);

    await prisma.webhookEvent.update({
      where: { id: input.event.id },
      data: {
        status: 'FAILED',
        errorMessage: failure.error,
      },
    });

    return {
      ok: false,
      action: 'received_needs_attention',
      processingStatus: 'needs_attention',
      ...failure,
    };
  }
}
