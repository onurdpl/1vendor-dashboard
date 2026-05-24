import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { upsertSaleLedgerForAllocation } from '../finance/sale-ledger.service.js';
import type {
  ParsedShopifyOrderLineItem,
  ParsedShopifyOrderPayload,
  OrderIngestionInput,
  OrderIngestionResult,
  ShopifyOrdersCreateLineItemPayload,
  ShopifyOrdersCreateWebhookPayload,
} from './order-ingestion.types.js';
import type { ShopifyOrderLineItemImage } from './shopify-admin.types.js';

function buildCustomerName(payload: ShopifyOrdersCreateWebhookPayload) {
  const firstName = payload.customer?.first_name?.trim();
  const lastName = payload.customer?.last_name?.trim();
  const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();
  return fullName || null;
}

function readAddressString(value: string | null | undefined) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || null;
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
    shippingDistrict:
      readAddressString(address?.district) ??
      readAddressString(address?.district_name) ??
      readAddressString(address?.city_area) ??
      readAddressString(address?.province),
    shippingAddress: composeShopifyShippingAddress(address),
  };
}

function toDate(value: string | null | undefined) {
  if (!value) {
    return new Date();
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
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

function parseOrderPayload(payload: ShopifyOrdersCreateWebhookPayload): ParsedShopifyOrderPayload {
  const lineItems = Array.isArray(payload.line_items) ? payload.line_items : [];
  const sourceShopifyOrderId = String(payload.id);
  const sourceShopifyOrderNumber =
    typeof payload.name === 'string' && payload.name.trim()
      ? payload.name.trim()
      : payload.order_number !== undefined && payload.order_number !== null
        ? `#${String(payload.order_number)}`
        : `#${sourceShopifyOrderId}`;
  const shippingAddress = mapShopifyShippingAddress(payload);

  return {
    sourceShopifyOrderId,
    sourceShopifyOrderNumber,
    createdAt: toDate(payload.created_at),
    totalPrice:
      payload.total_price !== undefined && payload.total_price !== null
        ? String(payload.total_price)
        : null,
    customerName: buildCustomerName(payload),
    customerEmail:
      typeof payload.customer?.email === 'string'
        ? payload.customer.email
        : typeof payload.email === 'string'
          ? payload.email
          : null,
    ...shippingAddress,
    lineItems: lineItems.map<ParsedShopifyOrderLineItem>((lineItem) => ({
      sourceLineItemId: String(lineItem.id),
      sourceVariantId:
        lineItem.variant_id !== undefined && lineItem.variant_id !== null ? String(lineItem.variant_id) : null,
      sku: typeof lineItem.sku === 'string' && lineItem.sku.trim() ? lineItem.sku : null,
      title: toLineItemTitle(lineItem),
      quantity: typeof lineItem.quantity === 'number' && lineItem.quantity > 0 ? lineItem.quantity : 1,
      unitPrice:
        lineItem.price !== undefined && lineItem.price !== null ? String(lineItem.price) : null,
      imageUrl: null,
    })),
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

export async function ingestShopifyOrderWebhook(input: OrderIngestionInput): Promise<OrderIngestionResult> {
  const parsedOrder = parseOrderPayload(input.payload);
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
      error: 'Shopify order payload did not include line items.',
    };
  }

  try {
    const vendors = await prisma.vendor.findMany();
    const vendorIds = new Set(vendors.map((vendor) => vendor.id));

    const resolvedLineItems = parsedOrder.lineItems.map((lineItem) => {
      if (!lineItem.sku) {
        throw new Error(`Line item ${lineItem.sourceLineItemId} is missing SKU and cannot be allocated.`);
      }

      const vendorId = normalizeVendorSlug(input.sellerInfo[lineItem.sku]);
      if (!vendorId) {
        throw new Error(`No seller_info mapping found for SKU ${lineItem.sku}.`);
      }

      if (!vendorIds.has(vendorId)) {
        throw new Error(`seller_info mapped SKU ${lineItem.sku} to unknown vendor ${vendorId}.`);
      }

      return {
        ...lineItem,
        vendorId,
        imageUrl: resolveImageUrl(lineItem),
      };
    });

    const result = await prisma.$transaction(async (tx) => {
      await tx.webhookEvent.update({
        where: { id: input.event.id },
        data: {
          status: 'PROCESSING',
          errorMessage: null,
        },
      });

      const shopifyOrder = await tx.shopifyOrder.upsert({
        where: {
          sourceShopifyOrderId: parsedOrder.sourceShopifyOrderId,
        },
        update: {
          sourceShopifyOrderNumber: parsedOrder.sourceShopifyOrderNumber,
          customerName: parsedOrder.customerName,
          customerEmail: parsedOrder.customerEmail,
          customerPhone: parsedOrder.customerPhone,
          shippingCountry: parsedOrder.shippingCountry,
          shippingPostcode: parsedOrder.shippingPostcode,
          shippingCity: parsedOrder.shippingCity,
          shippingDistrict: parsedOrder.shippingDistrict,
          shippingAddress: parsedOrder.shippingAddress,
          totalPrice: parsedOrder.totalPrice,
          createdAt: parsedOrder.createdAt,
        },
        create: {
          sourceShopifyOrderId: parsedOrder.sourceShopifyOrderId,
          sourceShopifyOrderNumber: parsedOrder.sourceShopifyOrderNumber,
          customerName: parsedOrder.customerName,
          customerEmail: parsedOrder.customerEmail,
          customerPhone: parsedOrder.customerPhone,
          shippingCountry: parsedOrder.shippingCountry,
          shippingPostcode: parsedOrder.shippingPostcode,
          shippingCity: parsedOrder.shippingCity,
          shippingDistrict: parsedOrder.shippingDistrict,
          shippingAddress: parsedOrder.shippingAddress,
          totalPrice: parsedOrder.totalPrice,
          createdAt: parsedOrder.createdAt,
        },
      });

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
            sourceVariantId: lineItem.sourceVariantId,
            sku: lineItem.sku,
            title: lineItem.title,
            imageUrl: lineItem.imageUrl,
            quantity: lineItem.quantity,
            unitPrice: lineItem.unitPrice,
            originalVendorId: lineItem.vendorId,
          },
          create: {
            shopifyOrderId: shopifyOrder.id,
            sourceLineItemId: lineItem.sourceLineItemId,
            sourceVariantId: lineItem.sourceVariantId,
            sku: lineItem.sku,
            title: lineItem.title,
            imageUrl: lineItem.imageUrl,
            quantity: lineItem.quantity,
            unitPrice: lineItem.unitPrice,
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
          create: {
            id: allocationId,
            sourceShopifyOrderId: shopifyOrder.id,
            sourceShopifyOrderNumber: parsedOrder.sourceShopifyOrderNumber,
            originalVendorId: lineItem.vendorId,
            assignedVendorId: lineItem.vendorId,
            allocationStatus: 'ACTIVE',
            reassignmentRequired: false,
            fulfillmentStatus: 'Pending',
            shippingStatus: 'Awaiting Shipment',
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
    const message = error instanceof Error ? error.message : 'Shopify order ingestion failed.';

    await prisma.webhookEvent.update({
      where: { id: input.event.id },
      data: {
        status: 'FAILED',
        errorMessage: message,
      },
    });

    return {
      ok: false,
      action: 'received_needs_attention',
      processingStatus: 'needs_attention',
      error: message,
    };
  }
}
