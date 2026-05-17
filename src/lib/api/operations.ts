import { getAvailableVendors, type VendorId } from '../auth/vendorContext';
import type {
  OperationsAttentionDashboard,
  OperationsAttentionItem,
  OperationsAttentionSeverity,
  OperationsQueueItem,
} from './contracts';
import { listMockOrders } from './mockOrders';
import { listMockReturns } from './mockReturns';

function toVendorNameMap() {
  return new Map(getAvailableVendors().map((vendor) => [vendor.vendorId, vendor.vendorName] as const));
}

function buildOrderQueueItems(): OperationsQueueItem[] {
  const vendorNameMap = toVendorNameMap();
  const allOrders = [...listMockOrders('demo-vendor-a'), ...listMockOrders('demo-vendor-b')];

  const allocationItems = allOrders.flatMap((order) => {
    const createdAt = order.assignmentBlockedAt ?? order.date;
    const shopifyOrderId = String(order.sourceShopifyOrderNumber);
    const base = {
      vendorId: order.assignedVendorId as VendorId,
      vendorName: vendorNameMap.get(order.assignedVendorId),
      relatedOrderId: order.id,
      relatedShopifyOrderId: shopifyOrderId,
      actionTo: `/admin/orders/${shopifyOrderId}`,
      createdAt,
    };

    const items: OperationsQueueItem[] = [];

    if (order.allocationStatus === 'pending_reassignment') {
      items.push({
        id: `queue-pending-${order.id}`,
        type: 'pending_reassignment',
        severity: 'critical',
        title: `Reassignment required for ${order.id}`,
        description: order.reassignmentRequired
          ? 'Allocation is waiting for admin reassignment review.'
          : 'Allocation status indicates reassignment workflow.',
        status: order.allocationStatus,
        actionLabel: 'Open Shopify breakdown',
        ...base,
      });
    }

    if (order.assignmentHistory.some((entry) => entry.action === 'vendor_blocked')) {
      items.push({
        id: `queue-blocked-${order.id}`,
        type: 'vendor_blocked',
        severity: 'high',
        title: `Vendor blocked fulfillment on ${order.id}`,
        description: order.cancellationReason ?? 'Vendor reported a fulfillment blocker.',
        status: order.allocationStatus,
        actionLabel: 'Review blocked allocation',
        ...base,
      });
    }

    if (order.fulfillmentActionState === 'awaiting_shipment' && order.allocationStatus === 'active') {
      items.push({
        id: `queue-awaiting-${order.id}`,
        type: 'awaiting_shipment',
        severity: 'medium',
        title: `Awaiting shipment for ${order.id}`,
        description: 'Assigned vendor has not progressed shipment yet.',
        status: order.fulfillmentActionState,
        actionLabel: 'Monitor fulfillment',
        ...base,
      });
    }

    return items;
  });

  return allocationItems;
}

function buildRefundQueueItems(): OperationsQueueItem[] {
  const vendorNameMap = toVendorNameMap();
  const allReturns = [...listMockReturns('demo-vendor-a'), ...listMockReturns('demo-vendor-b')];

  return allReturns
    .filter((item) => item.status === 'Pending' || item.status === 'In Review')
    .map((item) => {
      const shopifyOrderId = String(item.sourceShopifyOrderNumber);
      return {
        id: `queue-refund-${item.id}`,
        type: 'refund_attention' as const,
        severity: 'medium' as const,
        title: `Refund attention: ${item.id}`,
        description: item.reason,
        vendorId: item.assignedVendorId,
        vendorName: vendorNameMap.get(item.assignedVendorId),
        relatedOrderId: item.relatedOrderId,
        relatedShopifyOrderId: shopifyOrderId,
        status: item.status,
        createdAt: item.date,
        actionLabel: 'Open Shopify breakdown',
        actionTo: `/admin/orders/${shopifyOrderId}`,
      };
    });
}

export function listAdminOperationsQueue(): OperationsQueueItem[] {
  return [...buildOrderQueueItems(), ...buildRefundQueueItems()].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

function mapQueueItemToAttention(item: OperationsQueueItem): OperationsAttentionItem {
  return {
    id: `attention-${item.id}`,
    type: item.type === 'refund_attention' ? 'return' : item.type === 'automation_action' ? 'automation' : 'shipment',
    severity: item.severity === 'critical' ? 'critical' : item.severity === 'high' || item.severity === 'medium' ? 'warning' : 'info',
    vendorId: item.vendorId,
    vendorName: item.vendorName ?? item.vendorId,
    objectType: item.type,
    objectReference: item.relatedShopifyOrderId ? `Order ${item.relatedShopifyOrderId}` : item.relatedOrderId ?? item.id,
    objectId: item.relatedOrderId ?? null,
    status: item.status,
    ageHours: Math.max(1, Math.round((Date.now() - new Date(item.createdAt).getTime()) / (60 * 60 * 1000))),
    title: item.title,
    description: item.description,
    recommendedAction: item.actionLabel ?? 'Review',
    destinationPath: item.actionTo ?? null,
    createdAt: item.createdAt,
  };
}

export function getMockAdminOperationsAttention(): OperationsAttentionDashboard {
  const queue = listAdminOperationsQueue().map(mapQueueItemToAttention).sort((left, right) => {
    const severityRank = { critical: 0, warning: 1, info: 2 };
    const severityDelta = severityRank[left.severity] - severityRank[right.severity];
    if (severityDelta !== 0) {
      return severityDelta;
    }
    return right.ageHours - left.ageHours;
  });
  const vendorGroups = new Map<string, OperationsAttentionItem[]>();
  queue.forEach((item) => {
    const items = vendorGroups.get(item.vendorId) ?? [];
    items.push(item);
    vendorGroups.set(item.vendorId, items);
  });
  const vendorRisks = [...vendorGroups.entries()].map(([vendorId, items]) => {
    const riskLevel: OperationsAttentionSeverity = items.some((item) => item.severity === 'critical') ? 'critical' : 'warning';
    return {
      vendorId,
      vendorName: items[0]?.vendorName ?? vendorId,
      riskLevel,
      totalAttentionItems: items.length,
      criticalItems: items.filter((item) => item.severity === 'critical').length,
      warningItems: items.filter((item) => item.severity === 'warning').length,
      supportItems: items.filter((item) => item.type === 'support').length,
      shipmentItems: items.filter((item) => item.type === 'shipment').length,
      returnItems: items.filter((item) => item.type === 'return').length,
      financeItems: items.filter((item) => item.type === 'finance').length,
      drivers: [`${items.length} attention items`],
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      total: queue.length,
      critical: queue.filter((item) => item.severity === 'critical').length,
      warning: queue.filter((item) => item.severity === 'warning').length,
      info: queue.filter((item) => item.severity === 'info').length,
      overdueSupport: queue.filter((item) => item.type === 'support' && item.severity === 'critical').length,
      shipmentIssues: queue.filter((item) => item.type === 'shipment').length,
      returnBacklog: queue.filter((item) => item.type === 'return').length,
      financeReview: queue.filter((item) => item.type === 'finance').length,
      vendorRisks: vendorRisks.length,
    },
    queue,
    sections: [
      {
        key: 'support',
        title: 'Support attention',
        count: queue.filter((item) => item.type === 'support').length,
        critical: queue.filter((item) => item.type === 'support' && item.severity === 'critical').length,
        warning: queue.filter((item) => item.type === 'support' && item.severity === 'warning').length,
        items: queue.filter((item) => item.type === 'support').slice(0, 5),
      },
      {
        key: 'shipment',
        title: 'Shipment attention',
        count: queue.filter((item) => item.type === 'shipment').length,
        critical: queue.filter((item) => item.type === 'shipment' && item.severity === 'critical').length,
        warning: queue.filter((item) => item.type === 'shipment' && item.severity === 'warning').length,
        items: queue.filter((item) => item.type === 'shipment').slice(0, 5),
      },
      {
        key: 'return',
        title: 'Return backlog',
        count: queue.filter((item) => item.type === 'return').length,
        critical: queue.filter((item) => item.type === 'return' && item.severity === 'critical').length,
        warning: queue.filter((item) => item.type === 'return' && item.severity === 'warning').length,
        items: queue.filter((item) => item.type === 'return').slice(0, 5),
      },
      {
        key: 'finance',
        title: 'Finance review',
        count: queue.filter((item) => item.type === 'finance').length,
        critical: queue.filter((item) => item.type === 'finance' && item.severity === 'critical').length,
        warning: queue.filter((item) => item.type === 'finance' && item.severity === 'warning').length,
        items: queue.filter((item) => item.type === 'finance').slice(0, 5),
      },
    ],
    vendorRisks,
    recentActivity: queue.slice(0, 10).map((item) => ({
      id: `activity-${item.id}`,
      type: item.type,
      severity: item.severity,
      vendorId: item.vendorId,
      vendorName: item.vendorName,
      title: item.title,
      description: item.objectReference,
      occurredAt: item.createdAt,
      destinationPath: item.destinationPath,
    })),
  };
}
