import { prisma } from '../../db/prisma.js';
import type {
  OperationsQueueDashboardDto,
  OperationsQueueItemDto,
  OperationsQueueSeverity,
} from './operations.types.js';
import { listOperationalSignals } from '../rules/rules.service.js';
import type { OperationalSignalSeverityDto } from '../rules/rules.types.js';
import { listAutomationActions } from '../automation/automation-actions.service.js';

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
    operationalSignals: items.filter((item) => item.type === 'operational_signal').length,
    automationActions: items.filter((item) => item.type === 'automation_action').length,
  };
}

function getSeverityRank(severity: OperationsQueueSeverity) {
  if (severity === 'critical') {
    return 0;
  }
  if (severity === 'warning') {
    return 1;
  }
  if (severity === 'attention') {
    return 2;
  }
  return 3;
}

function mapSignalSeverity(severity: OperationalSignalSeverityDto): OperationsQueueSeverity {
  if (severity === 'critical') {
    return 'critical';
  }
  if (severity === 'high') {
    return 'warning';
  }
  if (severity === 'warning') {
    return 'attention';
  }
  return 'normal';
}

export async function getAdminOperationsQueue(options: { limit?: number; offset?: number } = {}): Promise<OperationsQueueDashboardDto> {
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

  const signalDashboard = await listOperationalSignals({
    includeInternal: true,
    limit: 100,
  });
  for (const signal of signalDashboard.signals) {
    const relatedShopifyOrderId =
      typeof signal.metadata === 'object' && signal.metadata !== null && 'sourceShopifyOrderId' in signal.metadata
        ? String(signal.metadata.sourceShopifyOrderId ?? '')
        : null;
    items.push({
      id: `op-signal-${signal.id}`,
      type: 'operational_signal',
      severity: mapSignalSeverity(signal.severity),
      title: signal.title,
      description: signal.description,
      vendorId: signal.vendorId ?? 'platform',
      vendorName: signal.vendorId ?? 'Platform',
      relatedOrderId: signal.allocationId,
      relatedShopifyOrderId,
      relatedReturnId: null,
      relatedRefundId: null,
      status: signal.status,
      createdAt: signal.triggeredAt,
      actionLabel: signal.suggestedAction ? 'Review signal' : 'Inspect signal',
      destinationPath: relatedShopifyOrderId ? `/admin/orders/${relatedShopifyOrderId}` : '/admin/operations',
    });
  }

  const automationDashboard = await listAutomationActions();
  for (const action of automationDashboard.actions) {
    if (action.status !== 'suggested' && action.status !== 'pending' && action.status !== 'failed') {
      continue;
    }

    items.push({
      id: `op-automation-${action.id}`,
      type: 'automation_action',
      severity: action.executionMode === 'auto_safe' ? 'attention' : 'normal',
      title: action.title,
      description: action.description,
      vendorId: action.vendorId ?? 'platform',
      vendorName: action.vendorId ?? 'Platform',
      relatedOrderId: action.allocationId,
      relatedShopifyOrderId: null,
      relatedReturnId: null,
      relatedRefundId: null,
      status: action.status,
      createdAt: action.createdAt,
      actionLabel: action.executionMode === 'auto_safe' ? 'Review safe action' : 'Review suggestion',
      destinationPath: '/admin/operations',
    });
  }

  items.sort((a, b) => {
    const severityDelta = getSeverityRank(a.severity) - getSeverityRank(b.severity);
    if (severityDelta !== 0) {
      return severityDelta;
    }
    return a.createdAt < b.createdAt ? 1 : -1;
  });

  const offset = options.offset ?? 0;
  const limit = options.limit ?? 100;

  return {
    summary: createSummary(items),
    items: items.slice(offset, offset + limit),
  };
}
