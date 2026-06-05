import { PaymentProvider, type Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { calculateVendorPayout } from '../finance/payout-calculator.js';
import { resolveVendorPaymentSellerId, VendorPaymentSellerMappingError } from '../payments/vendor-payment-seller.service.js';

type JsonRecord = Record<string, unknown>;

type ParatikaOrderItemPreview = {
  productCode: string;
  name: string;
  description: string;
  quantity: number;
  amount: string;
  sellerID: string;
  sellerPaymentAmount: string;
  sku: string | null;
  vendorId: string;
  shopifyLineItemId: string;
};

type ParatikaPayloadPreview = Record<string, string>;

export type ParatikaSessionTokenPayloadPreview = {
  ok: boolean;
  writesPerformed: false;
  provider: 'PARATIKA';
  model: 'seller_payment_amount_based';
  paymentReference: string | null;
  sessionTokenPayloadPreview: ParatikaPayloadPreview | null;
  itemBreakdown: ParatikaOrderItemPreview[];
  validationErrors: string[];
  omittedCredentialFields: ['MERCHANTUSER', 'MERCHANTPASSWORD', 'MERCHANT'];
  externalApiCallAttempted: false;
  cardDataIncluded: false;
};

type BuildPreviewOptions = {
  returnUrl?: string | null;
};

const MONEY_PATTERN = /^(0|[1-9]\d*)(\.\d{1,2})?$/;
const PARATIKA_CREDENTIAL_FIELDS: ['MERCHANTUSER', 'MERCHANTPASSWORD', 'MERCHANT'] = [
  'MERCHANTUSER',
  'MERCHANTPASSWORD',
  'MERCHANT',
];

const orderSelect = {
  id: true,
  sourceShopifyOrderId: true,
  sourceShopifyOrderNumber: true,
  customerName: true,
  customerEmail: true,
  customerPhone: true,
  billingFullName: true,
  billingCompany: true,
  billingPhone: true,
  billingCity: true,
  billingDistrict: true,
  billingAddress1: true,
  billingAddress2: true,
  billingPostcode: true,
  shippingCountry: true,
  shippingPostcode: true,
  shippingCity: true,
  shippingDistrict: true,
  shippingAddress: true,
  totalPrice: true,
  lineItems: {
    select: {
      id: true,
      sourceLineItemId: true,
      sourceVariantId: true,
      sku: true,
      title: true,
      quantity: true,
      unitPriceVatIncluded: true,
      lineTotalVatIncluded: true,
      unitPrice: true,
      originalVendorId: true,
    },
    orderBy: {
      createdAt: 'asc' as const,
    },
  },
  webhookEvents: {
    select: {
      rawPayload: true,
    },
    where: {
      topic: 'orders/create',
    },
    orderBy: {
      receivedAt: 'desc' as const,
    },
    take: 1,
  },
} satisfies Prisma.ShopifyOrderSelect;

type SelectedOrder = Prisma.ShopifyOrderGetPayload<{ select: typeof orderSelect }>;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseRawPayload(value: string | null) {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function readString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readCustomerIp(order: SelectedOrder) {
  const payload = parseRawPayload(order.webhookEvents[0]?.rawPayload ?? null);
  return readString(payload?.browser_ip) ?? readString(payload?.client_ip);
}

function readCustomerUserAgent(order: SelectedOrder) {
  const payload = parseRawPayload(order.webhookEvents[0]?.rawPayload ?? null);
  const clientDetails = isRecord(payload?.client_details) ? payload.client_details : null;
  return readString(clientDetails?.user_agent) ?? readString(payload?.customer_user_agent);
}

function centsToMoney(cents: number) {
  return (cents / 100).toFixed(2);
}

function parseMoneyToCents(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }

  const raw = typeof value === 'object' && 'toString' in value ? value.toString() : String(value);
  const normalized = raw.trim();
  if (!MONEY_PATTERN.test(normalized)) {
    return null;
  }

  const [whole, fraction = ''] = normalized.split('.');
  const cents = Number.parseInt(whole, 10) * 100 + Number.parseInt(fraction.padEnd(2, '0'), 10);
  return Number.isSafeInteger(cents) && cents >= 0 ? cents : null;
}

function multiplyMoneyByQuantity(unitPrice: unknown, quantity: number) {
  const unitPriceCents = parseMoneyToCents(unitPrice);
  if (unitPriceCents === null) {
    return null;
  }

  const total = unitPriceCents * quantity;
  return Number.isSafeInteger(total) ? total : null;
}

function normalizeOrderLookup(orderId: string) {
  const trimmed = orderId.trim();
  if (!trimmed) {
    return null;
  }

  const withoutHash = trimmed.replace(/^#/, '');
  return {
    id: trimmed,
    sourceShopifyOrderId: trimmed,
    sourceShopifyOrderNumber: trimmed.startsWith('#') ? trimmed : `#${trimmed}`,
    alternateSourceShopifyOrderNumber: withoutHash,
  };
}

async function findOrder(orderId: string) {
  const lookup = normalizeOrderLookup(orderId);
  if (!lookup) {
    return null;
  }

  return prisma.shopifyOrder.findFirst({
    where: {
      OR: [
        { id: lookup.id },
        { sourceShopifyOrderId: lookup.sourceShopifyOrderId },
        { sourceShopifyOrderNumber: lookup.sourceShopifyOrderNumber },
        { sourceShopifyOrderNumber: lookup.alternateSourceShopifyOrderNumber },
      ],
    },
    select: orderSelect,
  });
}

async function readActiveVendorFinancialProfile(vendorId: string) {
  return prisma.vendorFinancialProfile.findFirst({
    where: {
      vendorId,
      active: true,
    },
    select: {
      commissionPercent: true,
      commissionVatPercent: true,
      deductShippingEnabled: true,
      shippingMode: true,
      fixedShippingFee: true,
    },
  });
}

function toNumber(value: unknown) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : null;
}

function buildPaymentReference(order: SelectedOrder) {
  return `SPORGYM-SHOPIFY-${order.sourceShopifyOrderId}`;
}

function buildEmptyResult(validationErrors: string[], itemBreakdown: ParatikaOrderItemPreview[] = []): ParatikaSessionTokenPayloadPreview {
  return {
    ok: false,
    writesPerformed: false,
    provider: 'PARATIKA',
    model: 'seller_payment_amount_based',
    paymentReference: null,
    sessionTokenPayloadPreview: null,
    itemBreakdown,
    validationErrors,
    omittedCredentialFields: PARATIKA_CREDENTIAL_FIELDS,
    externalApiCallAttempted: false,
    cardDataIncluded: false,
  };
}

async function buildOrderItemPreview(
  lineItem: SelectedOrder['lineItems'][number],
  validationErrors: string[],
): Promise<ParatikaOrderItemPreview | null> {
  const vendorId = lineItem.originalVendorId?.trim().toLowerCase() ?? '';
  const productCode = lineItem.sourceVariantId?.trim() || lineItem.sku?.trim() || '';
  const quantity = lineItem.quantity;

  if (!vendorId) {
    validationErrors.push(`Line item ${lineItem.sourceLineItemId} is missing original vendor mapping.`);
  }
  if (!productCode) {
    validationErrors.push(`Line item ${lineItem.sourceLineItemId} is missing productCode sourceVariantId/SKU.`);
  }
  if (!Number.isInteger(quantity) || quantity <= 0) {
    validationErrors.push(`Line item ${lineItem.sourceLineItemId} has invalid quantity.`);
  }

  const amountCents =
    parseMoneyToCents(lineItem.lineTotalVatIncluded) ??
    multiplyMoneyByQuantity(lineItem.unitPriceVatIncluded ?? lineItem.unitPrice, quantity);
  if (amountCents === null || amountCents <= 0) {
    validationErrors.push(`Line item ${lineItem.sourceLineItemId} has invalid gross amount.`);
  }

  if (!vendorId || !productCode || !Number.isInteger(quantity) || quantity <= 0 || amountCents === null || amountCents <= 0) {
    return null;
  }

  let sellerID: string;
  try {
    sellerID = await resolveVendorPaymentSellerId(PaymentProvider.PARATIKA, vendorId);
  } catch (error) {
    if (error instanceof VendorPaymentSellerMappingError) {
      validationErrors.push(`Line item ${lineItem.sourceLineItemId} cannot resolve Paratika sellerID: ${error.code}.`);
    } else {
      validationErrors.push(`Line item ${lineItem.sourceLineItemId} cannot resolve Paratika sellerID.`);
    }
    return null;
  }

  const profile = await readActiveVendorFinancialProfile(vendorId);
  if (!profile) {
    validationErrors.push(`Line item ${lineItem.sourceLineItemId} cannot compute sellerPaymentAmount: active vendor financial profile is missing.`);
    return null;
  }
  if (profile.deductShippingEnabled) {
    validationErrors.push(
      `Line item ${lineItem.sourceLineItemId} cannot compute sellerPaymentAmount: shipping deductions are not modeled for item-level Paratika previews.`,
    );
    return null;
  }

  const commissionPercent = toNumber(profile.commissionPercent);
  const commissionVatPercent = toNumber(profile.commissionVatPercent);
  if (commissionPercent === null || commissionVatPercent === null) {
    validationErrors.push(`Line item ${lineItem.sourceLineItemId} cannot compute sellerPaymentAmount: vendor financial profile is invalid.`);
    return null;
  }

  const payout = calculateVendorPayout({
    grossAmount: Number(centsToMoney(amountCents)),
    refundAmount: 0,
    fulfilled: false,
    profile: {
      commissionPercent,
      commissionVatPercent,
      deductShippingEnabled: false,
      shippingMode: 'disabled',
      fixedShippingFee: null,
    },
  });
  const sellerPaymentAmountCents = parseMoneyToCents(payout.estimatedPayout.toFixed(2));
  if (sellerPaymentAmountCents === null || sellerPaymentAmountCents < 0) {
    validationErrors.push(`Line item ${lineItem.sourceLineItemId} cannot compute sellerPaymentAmount.`);
    return null;
  }

  const fallbackName = lineItem.sku ?? productCode;
  return {
    productCode,
    name: lineItem.title?.trim() || fallbackName,
    description: lineItem.sku?.trim() || productCode,
    quantity,
    amount: centsToMoney(amountCents),
    sellerID,
    sellerPaymentAmount: centsToMoney(sellerPaymentAmountCents),
    sku: lineItem.sku,
    vendorId,
    shopifyLineItemId: lineItem.sourceLineItemId,
  };
}

function validateRequiredCustomerFields(order: SelectedOrder, options: BuildPreviewOptions, validationErrors: string[]) {
  const returnUrl = options.returnUrl?.trim() || null;
  const customer = order.customerEmail?.trim() || null;
  const customerName = order.customerName?.trim() || order.billingFullName?.trim() || null;
  const customerEmail = order.customerEmail?.trim() || null;
  const customerPhone = order.customerPhone?.trim() || order.billingPhone?.trim() || null;
  const customerIp = readCustomerIp(order);
  const customerUserAgent = readCustomerUserAgent(order);

  if (!returnUrl) {
    validationErrors.push('RETURNURL is required for Paratika SESSIONTOKEN preview.');
  }
  if (!customer) {
    validationErrors.push('CUSTOMER is required and no persisted customer email is available.');
  }
  if (!customerName) {
    validationErrors.push('CUSTOMERNAME is required and no persisted customer name is available.');
  }
  if (!customerEmail) {
    validationErrors.push('CUSTOMEREMAIL is required and no persisted customer email is available.');
  }
  if (!customerIp) {
    validationErrors.push('CUSTOMERIP is required and no stored Shopify browser_ip is available.');
  }
  if (!customerUserAgent) {
    validationErrors.push('CUSTOMERUSERAGENT is required and no stored Shopify client_details.user_agent is available.');
  }
  if (!customerPhone) {
    validationErrors.push('CUSTOMERPHONE is required and no persisted customer phone is available.');
  }

  return {
    returnUrl,
    customer,
    customerName,
    customerEmail,
    customerPhone,
    customerIp,
    customerUserAgent,
  };
}

export async function buildParatikaSessionTokenPayloadPreviewForOrder(
  orderId: string,
  options: BuildPreviewOptions = {},
): Promise<ParatikaSessionTokenPayloadPreview> {
  const order = await findOrder(orderId);
  if (!order) {
    return buildEmptyResult([`Shopify order ${orderId} was not found.`]);
  }

  const validationErrors: string[] = [];
  const requiredFields = validateRequiredCustomerFields(order, options, validationErrors);
  const items: ParatikaOrderItemPreview[] = [];

  for (const lineItem of order.lineItems) {
    const item = await buildOrderItemPreview(lineItem, validationErrors);
    if (item) {
      items.push(item);
    }
  }

  if (order.lineItems.length === 0) {
    validationErrors.push('Order has no line items.');
  }

  const orderItemsTotalCents = items.reduce((sum, item) => sum + (parseMoneyToCents(item.amount) ?? 0), 0);
  const sellerPaymentTotalCents = items.reduce((sum, item) => sum + (parseMoneyToCents(item.sellerPaymentAmount) ?? 0), 0);
  const orderTotalCents = parseMoneyToCents(order.totalPrice);
  if (orderTotalCents !== null && orderTotalCents !== orderItemsTotalCents) {
    validationErrors.push('AMOUNT does not match sum of ORDERITEMS[].amount.');
  }
  if (sellerPaymentTotalCents < 0) {
    validationErrors.push('TOTALSELLERPAYMENTAMOUNT is invalid.');
  }

  if (validationErrors.length) {
    return {
      ...buildEmptyResult(validationErrors, items),
      paymentReference: buildPaymentReference(order),
    };
  }

  const amount = centsToMoney(orderTotalCents ?? orderItemsTotalCents);
  const orderItems = items.map((item) => ({
    productCode: item.productCode,
    name: item.name,
    description: item.description,
    quantity: item.quantity,
    amount: item.amount,
    sellerID: item.sellerID,
    sellerPaymentAmount: item.sellerPaymentAmount,
  }));

  const sessionTokenPayloadPreview: ParatikaPayloadPreview = {
    ACTION: 'SESSIONTOKEN',
    AMOUNT: amount,
    CURRENCY: 'TRY',
    MERCHANTPAYMENTID: buildPaymentReference(order),
    RETURNURL: requiredFields.returnUrl ?? '',
    CUSTOMER: requiredFields.customer ?? '',
    CUSTOMERNAME: requiredFields.customerName ?? '',
    CUSTOMEREMAIL: requiredFields.customerEmail ?? '',
    CUSTOMERIP: requiredFields.customerIp ?? '',
    CUSTOMERUSERAGENT: requiredFields.customerUserAgent ?? '',
    CUSTOMERPHONE: requiredFields.customerPhone ?? '',
    ORDERITEMS: JSON.stringify(orderItems),
    TOTALSELLERPAYMENTAMOUNT: centsToMoney(sellerPaymentTotalCents),
    SESSIONTYPE: 'PAYMENTSESSION',
  };

  return {
    ok: true,
    writesPerformed: false,
    provider: 'PARATIKA',
    model: 'seller_payment_amount_based',
    paymentReference: buildPaymentReference(order),
    sessionTokenPayloadPreview,
    itemBreakdown: items,
    validationErrors: [],
    omittedCredentialFields: PARATIKA_CREDENTIAL_FIELDS,
    externalApiCallAttempted: false,
    cardDataIncluded: false,
  };
}
