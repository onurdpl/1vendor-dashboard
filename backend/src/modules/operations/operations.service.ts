import { prisma } from '../../db/prisma.js';
import type {
  OperationsQueueDashboardDto,
  OperationsQueueItemDto,
  OperationsQueueSeverity,
} from './operations.types.js';

function isAwaitingShipment(fulfillmentStatus: string, shippingStatus: string) {
  const fulfillment = fulfillmentStatus.trim().toLowerCase();
  const shipping = shippingStatus.trim().toLowerCase();
  return (
    fulfillment === 'processing' ||
    fulfillment === 'pending' ||
    shipping === 'awaiting shipment' ||
    shipping === 'awaiting_shipment'
  );
}

function getSeverityCount(items: OperationsQueueItemDto[], severity: OperationsQueueSeverity) {
  return items.filter((item) => item.severity === severity).length;
}

function createSummary(items: OperationsQueueItemDto[]): OperationsQueueDashboardDto['summary'] {
  return {
    total: items.length,
    critical: getSeverityCount(items, 'critical'),
    warning: getSeverityCount(items, 'warning'),
    attention: getSeverityCount(items, 'attention'),
    normal: getSeverityCount(items, 'normal'),
    pendingReassignment: items.filter((item) => item.type === 'pending_reassignment').length,
    vendorBlocked: items.filter((item) => item.type === 'vendor_blocked').length,
    awaitingShipment: items.filter((item) => item.type === 'awaiting_shipment').length,
    refundAttention: items.filter((item) => item.type === 'refund_attention').length,
  };
}

export async function getAdminOperationsQueue(): Promise<OperationsQueueDashboardDto> {
  const allocations = await prisma.vendorAllocation.findMany({
    include: {
      assignedVendor: true,
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
      order: true,
    },
    orderBy: {
      createdAt: 'desc',
    },
  });

  const items: OperationsQueueItemDto[] = [];

  for (const allocation of allocations) {
    const vendorName = allocation.assignedVendor.name;
    const orderId = allocation.id;
    const shopifyOrderId = allocation.order.sourceShopifyOrderId;

    if (allocation.reassignmentRequired || allocation.allocationStatus === 'PENDING_REASSIGNMENT') {
      items.push({
        id: `op-pending-${allocation.id}`,
        type: 'pending_reassignment',
        severity: 'critical',
        title: 'Pending vendor reassignment',
        description: `Allocation ${allocation.id} requires reassignment review.`,
        vendorId: allocation.assignedVendorId,
        vendorName,
        relatedOrderId: orderId,
        relatedShopifyOrderId: shopifyOrderId,
        relatedReturnId: allocation.returnRecords[0]?.id ?? null,
        relatedRefundId: allocation.refundRecords[0]?.sourceShopifyRefundId ?? null,
        status: allocation.allocationStatus.toLowerCase(),
        createdAt: allocation.updatedAt.toISOString(),
        actionLabel: 'Review allocation',
        destinationPath: `/admin/orders/${shopifyOrderId}`,
      });
    }

    if (allocation.allocationStatus === 'VENDOR_BLOCKED') {
      items.push({
        id: `op-blocked-${allocation.id}`,
        type: 'vendor_blocked',
        severity: 'warning',
        title: 'Vendor blocked allocation',
        description: `Vendor ${vendorName} marked allocation ${allocation.id} as blocked.`,
        vendorId: allocation.assignedVendorId,
        vendorName,
        relatedOrderId: orderId,
        relatedShopifyOrderId: shopifyOrderId,
        relatedReturnId: allocation.returnRecords[0]?.id ?? null,
        relatedRefundId: allocation.refundRecords[0]?.sourceShopifyRefundId ?? null,
        status: allocation.allocationStatus.toLowerCase(),
        createdAt: allocation.updatedAt.toISOString(),
        actionLabel: 'Investigate blocker',
        destinationPath: `/admin/orders/${shopifyOrderId}`,
      });
    }

    if (isAwaitingShipment(allocation.fulfillmentStatus, allocation.shippingStatus)) {
      items.push({
        id: `op-shipment-${allocation.id}`,
        type: 'awaiting_shipment',
        severity: 'attention',
        title: 'Awaiting shipment update',
        description: `Allocation ${allocation.id} is waiting for shipment progress.`,
        vendorId: allocation.assignedVendorId,
        vendorName,
        relatedOrderId: orderId,
        relatedShopifyOrderId: shopifyOrderId,
        relatedReturnId: null,
        relatedRefundId: null,
        status: allocation.shippingStatus.toLowerCase(),
        createdAt: allocation.updatedAt.toISOString(),
        actionLabel: 'Check fulfillment',
        destinationPath: `/admin/orders/${shopifyOrderId}`,
      });
    }
  }

  const pendingReturns = await prisma.returnRecord.findMany({
    where: {
      status: {
        in: ['pending', 'open', 'needs_review'],
      },
    },
    include: {
      vendorAllocation: {
        include: {
          assignedVendor: true,
          order: true,
          refundRecords: {
            orderBy: {
              createdAt: 'desc',
            },
          },
        },
      },
    },
    orderBy: {
      createdAt: 'desc',
    },
  });

  for (const returnRecord of pendingReturns) {
    items.push({
      id: `op-refund-${returnRecord.id}`,
      type: 'refund_attention',
      severity: 'attention',
      title: 'Refund requires attention',
      description: `Return ${returnRecord.id} is pending review.`,
      vendorId: returnRecord.vendorAllocation.assignedVendorId,
      vendorName: returnRecord.vendorAllocation.assignedVendor.name,
      relatedOrderId: returnRecord.vendorAllocation.id,
      relatedShopifyOrderId: returnRecord.vendorAllocation.order.sourceShopifyOrderId,
      relatedReturnId: returnRecord.id,
      relatedRefundId: returnRecord.vendorAllocation.refundRecords[0]?.sourceShopifyRefundId ?? null,
      status: returnRecord.status.toLowerCase(),
      createdAt: returnRecord.createdAt.toISOString(),
      actionLabel: 'Review return',
      destinationPath: `/admin/orders/${returnRecord.vendorAllocation.order.sourceShopifyOrderId}`,
    });
  }

  items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  return {
    summary: createSummary(items),
    items,
  };
}
