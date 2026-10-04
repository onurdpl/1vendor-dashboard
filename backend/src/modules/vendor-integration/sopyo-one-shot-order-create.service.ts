import { Prisma, VendorIntegrationProviderCode, VendorOutboundMethod } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { mapShopifyShippingAddress, normalizeShopifyShipmentPhone } from '../shopify/order-ingestion.service.js';
import type { ShopifyOrdersCreateWebhookPayload } from '../shopify/order-ingestion.types.js';
import { getDecryptedSopyoCredentialForInternalUse } from './sopyo-credential.service.js';
import { createSopyoDeliveryClient, type SopyoCreateAmbiguousReason, type SopyoCreateOrderInput, type SopyoUnexpectedResponseDiagnostic } from './sopyo-delivery.client.js';

const TEST_AMOUNT = '4299.00';
const allocationSelect = {
  id: true, assignedVendorId: true, outboundMethodSnapshot: true,
  outboundIntegrationProviderSnapshot: true, allocationStatus: true,
  reassignmentRequired: true,
  order: { select: {
    id: true, sourceShopifyOrderId: true, sourceShopifyOrderNumber: true,
    cancelledAt: true, currency: true, totalPrice: true, discountAmount: true,
    shippingAmount: true, orderTaxAmount: true, taxesIncluded: true,
    customerName: true, customerEmail: true, customerPhone: true,
    shippingAddress: true, shippingCity: true, shippingDistrict: true,
    billingFullName: true, billingPhone: true, billingCity: true, billingDistrict: true,
  } },
  lineItems: { select: {
    quantity: true, lineAmount: true,
    shopifyOrderLineItem: { select: {
      shopifyOrderId: true, sku: true, title: true,
      unitPriceVatIncluded: true, lineTotalVatIncluded: true,
    } },
  } },
} satisfies Prisma.VendorAllocationSelect;

type SelectedAllocation = Prisma.VendorAllocationGetPayload<{ select: typeof allocationSelect }>;
type RecordValue = Record<string, unknown>;

export type SopyoOneShotPreSend = {
  allocationId: string;
  assignedVendorId: string;
  orderCode: string;
  currency: 'TRY';
  lineCount: 1;
  quantityTotal: 1;
  numericTotal: 4299;
  shippingNamePresent: boolean;
  shippingPhonePresent: boolean;
  shippingAddressPresent: boolean;
  billingNamePresent: boolean;
  billingSourceAddressPresent: boolean;
  billingPayloadAddressIncluded: boolean;
};

export type SopyoOneShotResult =
  | { status: 'SUCCESS' | 'ALREADY_EXISTS'; sopyoOrderId: number; sopyoOrderCode: string; sopyoOrderType: string }
  | ({ status: 'FOUND_AFTER_AMBIGUOUS_POST'; sopyoOrderId: number; sopyoOrderCode: string; sopyoOrderType: string } & SopyoCreateAmbiguousDiagnostic)
  | { status: 'CONFLICT' | 'AMBIGUOUS' }
  | ({ status: 'NOT_FOUND_AFTER_AMBIGUOUS_POST' | 'AMBIGUOUS_AFTER_POST' } & SopyoCreateAmbiguousDiagnostic)
  | { status: 'REJECTED'; httpStatus: number; message: string };

type SopyoCreateAmbiguousDiagnostic = { ambiguousReason: SopyoCreateAmbiguousReason; httpStatus?: number } &
  Partial<SopyoUnexpectedResponseDiagnostic>;

export class SopyoOneShotBlockedError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'SopyoOneShotBlockedError';
  }
}

function fail(code: string): never {
  throw new SopyoOneShotBlockedError(code);
}

function record(value: unknown): RecordValue | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : null;
}

function nonblank(value: unknown): string | null {
  return typeof value === 'string' ? value.trim() || null : null;
}

function required(value: unknown, code: string): string {
  return nonblank(value) ?? fail(code);
}

function moneyEquals(value: Prisma.Decimal | null, expected: string): boolean {
  return value !== null && value.toFixed(2) === expected;
}

const explicitDistrictKeys = [
  'district', 'district_name', 'districtName', 'city_area', 'cityArea',
  'county', 'county_name', 'countyName',
] as const;

function explicitDistrict(address: RecordValue, stored: string | null): string | null {
  for (const key of explicitDistrictKeys) {
    const value = nonblank(address[key]);
    if (value) {
      if (value !== stored) fail('DISTRICT_SNAPSHOT_MISMATCH');
      return value;
    }
  }
  // Shopify's Turkey address2/province fallbacks are not a proven distinct district.
  return null;
}

function validateAllocation(allocation: SelectedAllocation | null): SelectedAllocation {
  if (!allocation) fail('ALLOCATION_NOT_FOUND');
  if (!allocation.assignedVendorId ||
      allocation.outboundMethodSnapshot !== VendorOutboundMethod.VENDOR_INTEGRATION ||
      allocation.outboundIntegrationProviderSnapshot !== VendorIntegrationProviderCode.SOPYO ||
      allocation.allocationStatus !== 'ACTIVE' || allocation.reassignmentRequired ||
      allocation.order.cancelledAt !== null) fail('ALLOCATION_NOT_ELIGIBLE');
  if (allocation.order.sourceShopifyOrderNumber !== '#1138' ||
      allocation.order.currency !== 'TRY' ||
      !moneyEquals(allocation.order.totalPrice, TEST_AMOUNT) ||
      !moneyEquals(allocation.order.discountAmount, '0.00') ||
      !moneyEquals(allocation.order.shippingAmount, '0.00') ||
      !moneyEquals(allocation.order.orderTaxAmount, '390.82') ||
      allocation.order.taxesIncluded !== true) fail('TEST_MONETARY_EVIDENCE_CHANGED');
  if (allocation.lineItems.length !== 1) fail('TEST_LINE_COUNT_CHANGED');
  const line = allocation.lineItems[0]!;
  if (line.quantity !== 1 || !nonblank(line.shopifyOrderLineItem.sku) ||
      !nonblank(line.shopifyOrderLineItem.title) ||
      line.shopifyOrderLineItem.shopifyOrderId !== allocation.order.id ||
      !moneyEquals(line.lineAmount, TEST_AMOUNT) ||
      !moneyEquals(line.shopifyOrderLineItem.unitPriceVatIncluded, TEST_AMOUNT) ||
      !moneyEquals(line.shopifyOrderLineItem.lineTotalVatIncluded, TEST_AMOUNT)) {
    fail('TEST_LINE_EVIDENCE_CHANGED');
  }
  return allocation;
}

function buildPayload(allocation: SelectedAllocation, rawPayload: string): SopyoCreateOrderInput {
  let source: RecordValue | null;
  try {
    source = record(JSON.parse(rawPayload) as unknown);
  } catch {
    fail('RAW_WEBHOOK_INVALID');
  }
  if (!source || String(source.id ?? '') !== allocation.order.sourceShopifyOrderId) {
    fail('RAW_WEBHOOK_ORDER_MISMATCH');
  }
  const customer = record(source.customer) ?? fail('RAW_CUSTOMER_MISSING');
  const shipping = record(source.shipping_address) ?? fail('RAW_SHIPPING_MISSING');
  const billing = record(source.billing_address) ?? fail('RAW_BILLING_MISSING');
  const customerName = [required(customer.first_name, 'CUSTOMER_NAME_MISSING'), required(customer.last_name, 'CUSTOMER_NAME_MISSING')].join(' ');
  const customerEmail = nonblank(customer.email) ?? required(source.email, 'CUSTOMER_EMAIL_MISSING');
  if (customerName !== allocation.order.customerName || customerEmail !== allocation.order.customerEmail) {
    fail('CUSTOMER_SNAPSHOT_MISMATCH');
  }
  const shippingName = required(shipping.name, 'SHIPPING_NAME_MISSING');
  const shippingPhone = normalizeShopifyShipmentPhone(required(shipping.phone, 'SHIPPING_PHONE_MISSING'))!;
  const shippingCity = required(shipping.city, 'SHIPPING_CITY_MISSING');
  const composedShipping = mapShopifyShippingAddress(source as ShopifyOrdersCreateWebhookPayload);
  const shippingAddress = required(composedShipping.shippingAddress, 'SHIPPING_ADDRESS_MISSING');
  if (shippingPhone !== allocation.order.customerPhone || shippingCity !== allocation.order.shippingCity ||
      shippingAddress !== allocation.order.shippingAddress) fail('SHIPPING_SNAPSHOT_MISMATCH');

  const billingName = required(billing.name, 'BILLING_NAME_MISSING');
  const billingPhone = normalizeShopifyShipmentPhone(required(billing.phone, 'BILLING_PHONE_MISSING'))!;
  const billingCity = required(billing.city, 'BILLING_CITY_MISSING');
  required(billing.address1, 'BILLING_ADDRESS_SOURCE_MISSING');
  if (billingName !== allocation.order.billingFullName || billingPhone !== allocation.order.billingPhone ||
      billingCity !== allocation.order.billingCity) fail('BILLING_SNAPSHOT_MISMATCH');

  const shippingDistrict = explicitDistrict(shipping, allocation.order.shippingDistrict);
  const billingDistrict = explicitDistrict(billing, allocation.order.billingDistrict);
  const line = allocation.lineItems[0]!;
  return {
    order_code: allocation.id,
    order_status: 1,
    total_price: 4299,
    customer_info: { email: customerEmail, name: customerName },
    shipping_info: {
      full_name: shippingName, gsm: shippingPhone, city: shippingCity,
      address: shippingAddress,
      ...(shippingDistrict ? { district: shippingDistrict } : {}),
    },
    // There is no canonical Shopify billing-line composition helper. Omit address.
    billing_info: {
      full_name: billingName, gsm: billingPhone, city: billingCity,
      ...(billingDistrict ? { district: billingDistrict } : {}),
    },
    order_items: [{
      stock_code: nonblank(line.shopifyOrderLineItem.sku)!,
      product_name: nonblank(line.shopifyOrderLineItem.title)!,
      quantity: 1,
      total_price: 4299,
    }],
  };
}

export async function runSopyoOneShotOrderCreateTest(options: {
  allocationId: string;
  expectedVendorId?: string;
  db?: typeof prisma;
  fetcher?: typeof fetch;
  loadCredential?: (vendorId: string) => Promise<string>;
  onPreSend?: (safe: SopyoOneShotPreSend) => void;
}): Promise<SopyoOneShotResult> {
  const db = options.db ?? prisma;
  const allocation = validateAllocation(await db.vendorAllocation.findUnique({
    where: { id: options.allocationId }, select: allocationSelect,
  }));
  if (allocation.id !== options.allocationId) fail('ALLOCATION_ID_MISMATCH');
  if (options.expectedVendorId && allocation.assignedVendorId !== options.expectedVendorId) {
    fail('ASSIGNED_VENDOR_CHANGED');
  }
  const events = await db.webhookEvent.findMany({
    where: {
      topic: 'orders/create', status: 'PROCESSED',
      OR: [
        { shopifyOrderId: allocation.order.id },
        { sourceShopifyOrderId: allocation.order.sourceShopifyOrderId },
      ],
    },
    select: { rawPayload: true },
  });
  if (events.length !== 1 || !events[0]!.rawPayload) fail('RAW_WEBHOOK_NOT_UNIQUE');
  const payload = buildPayload(allocation, events[0]!.rawPayload);
  const credential = await (options.loadCredential ?? getDecryptedSopyoCredentialForInternalUse)(allocation.assignedVendorId);
  const client = createSopyoDeliveryClient(options.fetcher);
  const bearer = await client.authenticate(credential);
  const existing = await client.ordersByCode(bearer, payload.order_code);
  if (existing.length > 1) return { status: 'AMBIGUOUS' };
  if (existing.length === 1) {
    const found = existing[0]!;
    return found.orderType === 'SOPYOAPI'
      ? { status: 'ALREADY_EXISTS', sopyoOrderId: found.id, sopyoOrderCode: found.orderCode, sopyoOrderType: found.orderType }
      : { status: 'CONFLICT' };
  }

  options.onPreSend?.({
    allocationId: allocation.id, assignedVendorId: allocation.assignedVendorId,
    orderCode: payload.order_code, currency: 'TRY', lineCount: 1,
    quantityTotal: 1, numericTotal: 4299,
    shippingNamePresent: true, shippingPhonePresent: true,
    shippingAddressPresent: true, billingNamePresent: true,
    billingSourceAddressPresent: true,
    billingPayloadAddressIncluded: 'address' in payload.billing_info,
  });
  const created = await client.createOrderOnce(bearer, payload, credential);
  if (created.kind === 'CREATED') {
    return created.orderCode === payload.order_code && created.orderType === 'SOPYOAPI'
      ? { status: 'SUCCESS', sopyoOrderId: created.id, sopyoOrderCode: created.orderCode, sopyoOrderType: created.orderType }
      : { status: 'CONFLICT' };
  }
  if (created.kind === 'REJECTED') {
    return { status: 'REJECTED', httpStatus: created.httpStatus, message: created.message };
  }

  // A timeout, transport error, malformed response, unexpected status, or 5xx may have created an order.
  // Look up once, but never send a second POST in this invocation.
  const diagnostic: SopyoCreateAmbiguousDiagnostic = {
    ambiguousReason: created.ambiguousReason,
    ...('httpStatus' in created ? { httpStatus: created.httpStatus } : {}),
    ...('responseBodyType' in created ? { responseBodyType: created.responseBodyType } : {}),
    ...('providerStatus' in created ? { providerStatus: created.providerStatus } : {}),
    ...('providerSuccess' in created ? { providerSuccess: created.providerSuccess } : {}),
    ...('providerMessage' in created ? { providerMessage: created.providerMessage } : {}),
    ...('providerValidationFields' in created ? { providerValidationFields: created.providerValidationFields } : {}),
  };
  try {
    const after = await client.ordersByCode(bearer, payload.order_code);
    if (after.length === 0) return { status: 'NOT_FOUND_AFTER_AMBIGUOUS_POST', ...diagnostic };
    if (after.length !== 1 || after[0]!.orderType !== 'SOPYOAPI') return { status: 'AMBIGUOUS_AFTER_POST', ...diagnostic };
    return {
      status: 'FOUND_AFTER_AMBIGUOUS_POST', sopyoOrderId: after[0]!.id,
      sopyoOrderCode: after[0]!.orderCode, sopyoOrderType: after[0]!.orderType!,
      ...diagnostic,
    };
  } catch {
    return { status: 'AMBIGUOUS_AFTER_POST', ...diagnostic };
  }
}
