import { getAvailableVendors, type VendorId } from '../auth/vendorContext';
import type { OperationsQueueItem } from './contracts';
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
