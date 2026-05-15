import { prisma } from '../../db/prisma.js';
import type { AdminOrderBreakdownDto, OrderDetailDto, OrderShipmentExecutionDto, OrderSummaryDto } from './orders.types.js';

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

function toNumber(value: unknown) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function toIsoString(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

function mapShipmentExecution(execution: {
  id: string;
  provider: string;
  sourceShopifyOrderId: string | null;
  sourceShopifyOrderNumber: string | null;
  sourceShopifyFulfillmentId: string | null;
  providerShipmentId: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  labelUrl: string | null;
  shipmentStatus: string;
  desi: unknown;
  shippingCost: unknown;
  shippingVat: unknown;
  currency: string;
  createdAt: Date;
  updatedAt: Date;
} | null | undefined): OrderShipmentExecutionDto | null {
  if (!execution) {
    return null;
  }

  return {
    id: execution.id,
    provider: execution.provider.trim().toLowerCase(),
    sourceShopifyOrderId: execution.sourceShopifyOrderId,
    sourceShopifyOrderNumber: execution.sourceShopifyOrderNumber,
    sourceShopifyFulfillmentId: execution.sourceShopifyFulfillmentId,
    providerShipmentId: execution.providerShipmentId,
    trackingNumber: execution.trackingNumber,
    trackingUrl: execution.trackingUrl,
    labelUrl: execution.labelUrl,
    shipmentStatus: execution.shipmentStatus.trim().toLowerCase(),
    desi: toAmountString(toNumber(execution.desi)),
    shippingCost: execution.shippingCost === null || execution.shippingCost === undefined ? null : toAmountString(toNumber(execution.shippingCost)),
    shippingVat: execution.shippingVat === null || execution.shippingVat === undefined ? null : toAmountString(toNumber(execution.shippingVat)),
    currency: execution.currency,
    createdAt: execution.createdAt.toISOString(),
    updatedAt: execution.updatedAt.toISOString(),
  };
}

export async function listVendorOrders(
  vendorId: string,
  options: { limit?: number; offset?: number } = {},
): Promise<OrderSummaryDto[]> {
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
    take: options.limit ?? 100,
    skip: options.offset ?? 0,
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
      fulfillment: true,
      shipmentExecutions: {
        orderBy: {
          createdAt: 'desc',
        },
        take: 1,
      },
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
    trackingUrl: allocation.fulfillment?.trackingUrl ?? null,
    fulfilledAt: toIsoString(allocation.fulfillment?.fulfilledAt),
    shipmentCreatedAt: toIsoString(allocation.fulfillment?.shipmentCreatedAt),
    shipmentUpdatedAt: toIsoString(allocation.fulfillment?.shipmentUpdatedAt),
    shipmentExecution: mapShipmentExecution(allocation.shipmentExecutions?.[0]),
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

export async function getAdminShopifyOrderBreakdown(
  shopifyOrderId: string,
): Promise<AdminOrderBreakdownDto | null> {
  const order = await prisma.shopifyOrder.findUnique({
    where: {
      sourceShopifyOrderId: shopifyOrderId,
    },
    include: {
      allocations: {
        include: {
          assignedVendor: true,
          fulfillment: true,
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
          returnRecords: {
            orderBy: {
              createdAt: 'desc',
            },
          },
          refundRecords: {
            orderBy: {
              createdAt: 'desc',
            },
          },
        },
        orderBy: {
          createdAt: 'asc',
        },
      },
    },
  });

  if (!order) {
    return null;
  }

  const orderTotal = order.allocations.reduce(
    (sum, allocation) =>
      sum +
      allocation.lineItems.reduce((lineSum, lineItem) => lineSum + toNumber(lineItem.lineAmount), 0),
    0,
  );

  return {
    order: {
      sourceShopifyOrderId: order.sourceShopifyOrderId,
      sourceShopifyOrderNumber: order.sourceShopifyOrderNumber,
      customerName: order.customerName,
      customerEmail: order.customerEmail,
      totalAmount: order.totalPrice ? toAmountString(toNumber(order.totalPrice)) : toAmountString(orderTotal),
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString(),
    },
    allocations: order.allocations.map((allocation) => {
      const allocationTotal = allocation.lineItems.reduce(
        (sum, lineItem) => sum + toNumber(lineItem.lineAmount),
        0,
      );

      return {
        id: allocation.id,
        vendorId: allocation.assignedVendorId,
        vendorName: allocation.assignedVendor.name,
        originalVendorId: allocation.originalVendorId,
        assignedVendorId: allocation.assignedVendorId,
        allocationStatus: allocation.allocationStatus,
        cancellationReason: allocation.cancellationReason,
        reassignmentRequired: allocation.reassignmentRequired,
        fulfillmentStatus: allocation.fulfillmentStatus,
        shippingStatus: allocation.shippingStatus,
        trackingNumber: allocation.trackingNumber,
        carrier: allocation.carrier,
        trackingUrl: allocation.fulfillment?.trackingUrl ?? null,
        fulfilledAt: toIsoString(allocation.fulfillment?.fulfilledAt),
        shipmentCreatedAt: toIsoString(allocation.fulfillment?.shipmentCreatedAt),
        shipmentUpdatedAt: toIsoString(allocation.fulfillment?.shipmentUpdatedAt),
        totalAmount: toAmountString(allocationTotal),
        lineItems: allocation.lineItems.map((lineItem) => ({
          id: lineItem.id,
          sourceLineItemId: lineItem.shopifyOrderLineItem.sourceLineItemId,
          sourceVariantId: lineItem.shopifyOrderLineItem.sourceVariantId,
          sku: lineItem.shopifyOrderLineItem.sku,
          title: lineItem.shopifyOrderLineItem.title,
          quantity: lineItem.quantity,
          lineAmount: toAmountString(toNumber(lineItem.lineAmount)),
        })),
        assignmentHistory: allocation.assignmentHistory.map((history) => ({
          id: history.id,
          action: history.action,
          fromVendorId: history.fromVendorId,
          toVendorId: history.toVendorId,
          reason: history.reason,
          actorUserId: history.actorUserId,
          createdAt: history.createdAt.toISOString(),
        })),
        returnRecords: allocation.returnRecords.map((returnRecord) => ({
          id: returnRecord.id,
          status: returnRecord.status,
          reason: returnRecord.reason,
          createdAt: returnRecord.createdAt.toISOString(),
          updatedAt: returnRecord.updatedAt.toISOString(),
        })),
        refundRecords: allocation.refundRecords.map((refundRecord) => ({
          id: refundRecord.id,
          sourceShopifyRefundId: refundRecord.sourceShopifyRefundId,
          amount: toAmountString(toNumber(refundRecord.amount)),
          status: refundRecord.status,
          createdAt: refundRecord.createdAt.toISOString(),
          updatedAt: refundRecord.updatedAt.toISOString(),
        })),
      };
    }),
  };
}
