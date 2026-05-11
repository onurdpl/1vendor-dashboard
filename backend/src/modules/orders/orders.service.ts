import { prisma } from '../../db/prisma.js';
import type { OrderDetailDto, OrderSummaryDto } from './orders.types.js';

function toAmountString(value: number) {
  return value.toFixed(2);
}

function computeTotalAmount(lineItems: Array<{ lineAmount: unknown; quantity: number }>) {
  return lineItems.reduce((sum, item) => {
    const numeric = Number(item.lineAmount ?? 0);
    if (!Number.isFinite(numeric)) {
      return sum;
    }

    return sum + numeric;
  }, 0);
}

export async function listVendorOrders(vendorId: string): Promise<OrderSummaryDto[]> {
  const allocations = await prisma.vendorAllocation.findMany({
    where: {
      assignedVendorId: vendorId,
    },
    include: {
      order: true,
      lineItems: true,
    },
    orderBy: {
      createdAt: 'desc',
    },
  });

  return allocations.map((allocation) => {
    const totalAmount = computeTotalAmount(allocation.lineItems);
    return {
      id: allocation.id,
      sourceShopifyOrderId: allocation.order.sourceShopifyOrderId,
      sourceShopifyOrderNumber: allocation.order.sourceShopifyOrderNumber,
      vendorId: allocation.assignedVendorId,
      assignedVendorId: allocation.assignedVendorId,
      originalVendorId: allocation.originalVendorId,
      allocationStatus: allocation.allocationStatus,
      fulfillmentStatus: allocation.fulfillmentStatus,
      shippingStatus: allocation.shippingStatus,
      totalAmount: toAmountString(totalAmount),
      lineItemCount: allocation.lineItems.length,
      createdAt: allocation.createdAt.toISOString(),
      updatedAt: allocation.updatedAt.toISOString(),
    };
  });
}

export async function getVendorOrderById(vendorId: string, orderId: string): Promise<OrderDetailDto | null> {
  const allocation = await prisma.vendorAllocation.findFirst({
    where: {
      id: orderId,
      assignedVendorId: vendorId,
    },
    include: {
      order: true,
      lineItems: {
        include: {
          shopifyOrderLineItem: true,
        },
      },
      assignmentHistory: {
        orderBy: {
          createdAt: 'asc',
        },
      },
    },
  });

  if (!allocation) {
    return null;
  }

  const totalAmount = computeTotalAmount(allocation.lineItems);

  return {
    id: allocation.id,
    sourceShopifyOrderId: allocation.order.sourceShopifyOrderId,
    sourceShopifyOrderNumber: allocation.order.sourceShopifyOrderNumber,
    vendorId: allocation.assignedVendorId,
    assignedVendorId: allocation.assignedVendorId,
    originalVendorId: allocation.originalVendorId,
    allocationStatus: allocation.allocationStatus,
    fulfillmentStatus: allocation.fulfillmentStatus,
    shippingStatus: allocation.shippingStatus,
    totalAmount: toAmountString(totalAmount),
    lineItemCount: allocation.lineItems.length,
    createdAt: allocation.createdAt.toISOString(),
    updatedAt: allocation.updatedAt.toISOString(),
    carrier: allocation.carrier,
    trackingNumber: allocation.trackingNumber,
    reassignmentRequired: allocation.reassignmentRequired,
    cancellationReason: allocation.cancellationReason,
    lineItems: allocation.lineItems.map((item) => ({
      id: item.id,
      sourceLineItemId: item.shopifyOrderLineItem.sourceLineItemId,
      sourceVariantId: item.shopifyOrderLineItem.sourceVariantId,
      sku: item.shopifyOrderLineItem.sku,
      title: item.shopifyOrderLineItem.title,
      quantity: item.quantity,
      lineAmount: toAmountString(Number(item.lineAmount ?? 0)),
    })),
    assignmentHistory: allocation.assignmentHistory.map((entry) => ({
      id: entry.id,
      action: entry.action,
      fromVendorId: entry.fromVendorId,
      toVendorId: entry.toVendorId,
      reason: entry.reason,
      actorUserId: entry.actorUserId,
      createdAt: entry.createdAt.toISOString(),
    })),
  };
}

