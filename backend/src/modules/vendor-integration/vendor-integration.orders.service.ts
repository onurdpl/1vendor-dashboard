import { AllocationStatus } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;
const ALLOCATION_STATUSES = new Set<string>(Object.values(AllocationStatus));

export type VendorIntegrationOrdersQuery = {
  status?: string;
  limit?: string | number;
  cursor?: string;
};

export type VendorIntegrationOrdersResult = {
  data: Array<ReturnType<typeof serializeAllocation>>;
  pagination: {
    limit: number;
    nextCursor: string | null;
  };
};

function toIsoDate(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

function toDecimalString(value: Prisma.Decimal | number | string | null | undefined) {
  return value === null || value === undefined ? null : value.toString();
}

function sumLineAmounts(lineItems: SelectedAllocation['lineItems']) {
  return lineItems.reduce<Prisma.Decimal | null>((sum, item) => {
    if (!item.lineAmount) {
      return sum;
    }

    return sum ? sum.plus(item.lineAmount) : item.lineAmount;
  }, null);
}

function resolveLimit(value: VendorIntegrationOrdersQuery['limit']) {
  if (value === undefined || value === null || value === '') {
    return DEFAULT_LIMIT;
  }

  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_LIMIT;
  }

  return Math.min(parsed, MAX_LIMIT);
}

function normalizeStatus(value: string | undefined) {
  const status = value?.trim();
  if (!status) {
    return null;
  }

  const normalized = status.toUpperCase();
  if (!ALLOCATION_STATUSES.has(normalized)) {
    throw new Error(`Unsupported allocation status filter: ${status}`);
  }

  return normalized as AllocationStatus;
}

const allocationSelect = {
  id: true,
  sourceShopifyOrderNumber: true,
  originalVendorId: true,
  assignedVendorId: true,
  allocationStatus: true,
  fulfillmentStatus: true,
  shippingStatus: true,
  trackingNumber: true,
  carrier: true,
  vendorIntegrationTrackingUrl: true,
  vendorIntegrationShippedAt: true,
  vendorIntegrationStatus: true,
  vendorIntegrationStatusMessage: true,
  vendorIntegrationStatusUpdatedAt: true,
  vendorIntegrationProvider: true,
  vendorInvoiceNumber: true,
  vendorInvoiceDate: true,
  vendorInvoiceUrl: true,
  vendorInvoiceAmount: true,
  vendorInvoiceReceivedAt: true,
  createdAt: true,
  updatedAt: true,
  order: {
    select: {
      sourceShopifyOrderId: true,
      sourceShopifyOrderNumber: true,
      shopifyCreatedAt: true,
      currency: true,
      financialStatus: true,
      paymentGatewayName: true,
      taxesIncluded: true,
      orderTaxAmount: true,
      shippingAmount: true,
      discountAmount: true,
      orderNote: true,
      orderTags: true,
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
    },
  },
  fulfillment: {
    select: {
      trackingUrl: true,
      fulfilledAt: true,
      shipmentCreatedAt: true,
      shipmentUpdatedAt: true,
    },
  },
  lineItems: {
    select: {
      id: true,
      quantity: true,
      lineAmount: true,
      shopifyOrderLineItem: {
        select: {
          sourceLineItemId: true,
          shopifyProductId: true,
          sourceVariantId: true,
          sku: true,
          title: true,
          imageUrl: true,
          unitPrice: true,
          unitPriceVatIncluded: true,
          lineTotalVatIncluded: true,
          lineTaxAmount: true,
          vatRate: true,
        },
      },
    },
    orderBy: {
      createdAt: 'asc' as const,
    },
  },
} satisfies Prisma.VendorAllocationSelect;

type SelectedAllocation = Prisma.VendorAllocationGetPayload<{ select: typeof allocationSelect }>;

function serializeAllocation(allocation: SelectedAllocation) {
  return {
    id: allocation.id,
    shopifyOrderId: allocation.order.sourceShopifyOrderId,
    shopifyOrderNumber: allocation.order.sourceShopifyOrderNumber,
    allocationStatus: allocation.allocationStatus,
    fulfillmentStatus: allocation.fulfillmentStatus,
    shippingStatus: allocation.shippingStatus,
    vendorIdentifier: allocation.assignedVendorId,
    originalVendorIdentifier: allocation.originalVendorId,
    vendorIntegrationStatus: allocation.vendorIntegrationStatus,
    vendorIntegrationStatusMessage: allocation.vendorIntegrationStatusMessage,
    vendorIntegrationStatusUpdatedAt: toIsoDate(allocation.vendorIntegrationStatusUpdatedAt),
    vendorIntegrationProvider: allocation.vendorIntegrationProvider,
    shopifyCreatedAt: toIsoDate(allocation.order.shopifyCreatedAt),
    createdAt: allocation.createdAt.toISOString(),
    updatedAt: allocation.updatedAt.toISOString(),
    financial: {
      currency: allocation.order.currency,
      financialStatus: allocation.order.financialStatus,
      paymentGatewayName: allocation.order.paymentGatewayName,
      taxesIncluded: allocation.order.taxesIncluded,
      orderTaxAmount: toDecimalString(allocation.order.orderTaxAmount),
      shippingAmount: toDecimalString(allocation.order.shippingAmount),
      discountAmount: toDecimalString(allocation.order.discountAmount),
    },
    orderNote: allocation.order.orderNote,
    orderTags: allocation.order.orderTags,
    customer: {
      name: allocation.order.customerName,
      email: allocation.order.customerEmail,
      phone: allocation.order.customerPhone,
    },
    billingAddress: {
      fullName: allocation.order.billingFullName,
      company: allocation.order.billingCompany,
      phone: allocation.order.billingPhone,
      city: allocation.order.billingCity,
      district: allocation.order.billingDistrict,
      address1: allocation.order.billingAddress1,
      address2: allocation.order.billingAddress2,
      postcode: allocation.order.billingPostcode,
    },
    shippingAddress: {
      country: allocation.order.shippingCountry,
      postcode: allocation.order.shippingPostcode,
      city: allocation.order.shippingCity,
      district: allocation.order.shippingDistrict,
      address: allocation.order.shippingAddress,
    },
    shipment: {
      carrier: allocation.carrier,
      trackingNumber: allocation.trackingNumber,
      trackingUrl: allocation.fulfillment?.trackingUrl ?? allocation.vendorIntegrationTrackingUrl,
      fulfilledAt: toIsoDate(allocation.fulfillment?.fulfilledAt),
      shipmentCreatedAt: toIsoDate(allocation.fulfillment?.shipmentCreatedAt ?? allocation.vendorIntegrationShippedAt),
      shipmentUpdatedAt: toIsoDate(allocation.fulfillment?.shipmentUpdatedAt),
      externalShippedAt: toIsoDate(allocation.vendorIntegrationShippedAt),
    },
    vendorInvoice: {
      invoiceNumber: allocation.vendorInvoiceNumber,
      invoiceDate: allocation.vendorInvoiceDate ? allocation.vendorInvoiceDate.toISOString().slice(0, 10) : null,
      invoiceUrl: allocation.vendorInvoiceUrl,
      invoiceAmount: toDecimalString(allocation.vendorInvoiceAmount),
      receivedAt: toIsoDate(allocation.vendorInvoiceReceivedAt),
    },
    totals: {
      orderTotal: toDecimalString(allocation.order.totalPrice),
      allocationLineTotal: toDecimalString(sumLineAmounts(allocation.lineItems)),
    },
    lineItems: allocation.lineItems.map((item) => ({
      id: item.id,
      shopifyLineItemId: item.shopifyOrderLineItem.sourceLineItemId,
      shopifyProductId: item.shopifyOrderLineItem.shopifyProductId,
      shopifyVariantId: item.shopifyOrderLineItem.sourceVariantId,
      sku: item.shopifyOrderLineItem.sku,
      title: item.shopifyOrderLineItem.title,
      imageUrl: item.shopifyOrderLineItem.imageUrl,
      quantity: item.quantity,
      unitPrice: toDecimalString(item.shopifyOrderLineItem.unitPrice),
      unitPriceVatIncluded: toDecimalString(item.shopifyOrderLineItem.unitPriceVatIncluded),
      lineTotalVatIncluded: toDecimalString(item.shopifyOrderLineItem.lineTotalVatIncluded),
      lineTaxAmount: toDecimalString(item.shopifyOrderLineItem.lineTaxAmount),
      vatRate: toDecimalString(item.shopifyOrderLineItem.vatRate),
      lineAmount: toDecimalString(item.lineAmount),
    })),
  };
}

export async function listVendorIntegrationOrders(
  vendorIdentifier: string,
  query: VendorIntegrationOrdersQuery,
): Promise<VendorIntegrationOrdersResult> {
  const limit = resolveLimit(query.limit);
  const status = normalizeStatus(query.status);
  const where: Prisma.VendorAllocationWhereInput = {
    assignedVendorId: vendorIdentifier,
    ...(status ? { allocationStatus: status } : {}),
  };
  const allocations = await prisma.vendorAllocation.findMany({
    where,
    select: allocationSelect,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  });
  const page = allocations.slice(0, limit);

  return {
    data: page.map(serializeAllocation),
    pagination: {
      limit,
      nextCursor: allocations.length > limit ? page.at(-1)?.id ?? null : null,
    },
  };
}
