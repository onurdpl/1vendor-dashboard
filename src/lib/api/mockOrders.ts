import { getAvailableVendors, getCurrentVendorContext, type VendorId } from '../auth/vendorContext';
import {
  allocateShopifyOrderToVendors,
  type ShopifyOrderInput,
  type VendorAllocationLineItem,
  type ShopifyOrderLineItemInput,
} from '../shopify/vendorMapping';
import type {
  OrderDetail,
  OrderSummary,
  OrderLineItem,
  OrderStatus,
  FulfillmentStatus,
  ShippingStatus,
  ShopifyOrderBreakdown,
  AllocationStatus,
  AllocationBlockReason,
  AssignmentHistoryEntry,
  FulfillmentActionState,
} from './contracts';
import { getMockReturn, listMockReturns } from './mockReturns';

type ShopifySourceOrder = ShopifyOrderInput & {
  customer: string;
  date: string;
  status: OrderStatus;
  channel: string;
  shippingAddress: string;
  notes: string;
  timeline: Array<{ label: string; at: string }>;
};

type VendorOrder = OrderDetail & {
  vendorId: VendorId;
};

type AllocationFulfillmentState = {
  status: OrderStatus;
  allocationStatus: AllocationStatus;
  cancellationReason?: AllocationBlockReason;
  reassignmentRequired: boolean;
  assignmentBlockedAt?: string;
  fulfillmentActionState: FulfillmentActionState;
  fulfillmentActionAvailable: boolean;
  fulfilledAt?: string;
  fulfilledByVendorId?: VendorId;
  shipmentCreatedAt?: string;
  shipmentUpdatedAt?: string;
  fulfillmentStatus: FulfillmentStatus;
  shippingStatus: ShippingStatus;
  trackingNumber?: string;
  carrier?: string;
  estimatedDelivery?: string;
};

function parseMoney(value: string) {
  return Number(value.replace(/[^0-9.-]/g, ''));
}

function formatMoney(value: number) {
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function createLineItems(
  vendorId: VendorId,
  allocationLineItems: Array<VendorAllocationLineItem<ShopifyOrderLineItemInput>>,
  allocationFulfillment: AllocationFulfillmentState,
): OrderLineItem[] {
  return allocationLineItems.map(({ vendorMetafield: _vendorMetafield, ...lineItem }) => ({
    ...lineItem,
    originalVendorId: lineItem.originalVendorId,
    assignedVendorId: lineItem.assignedVendorId,
    vendorId,
    name: lineItem.title,
    allocationStatus: allocationFulfillment.allocationStatus,
    cancellationReason: allocationFulfillment.cancellationReason,
    reassignmentRequired: allocationFulfillment.reassignmentRequired,
    assignmentBlockedAt: allocationFulfillment.assignmentBlockedAt,
    fulfillmentActionState: allocationFulfillment.fulfillmentActionState,
    fulfillmentActionAvailable: allocationFulfillment.fulfillmentActionAvailable,
    fulfilledAt: allocationFulfillment.fulfilledAt,
    fulfilledByVendorId: allocationFulfillment.fulfilledByVendorId,
    shipmentCreatedAt: allocationFulfillment.shipmentCreatedAt,
    shipmentUpdatedAt: allocationFulfillment.shipmentUpdatedAt,
    fulfillmentStatus: allocationFulfillment.fulfillmentStatus,
    shippingStatus: allocationFulfillment.shippingStatus,
    trackingNumber: allocationFulfillment.trackingNumber,
    carrier: allocationFulfillment.carrier,
    estimatedDelivery: allocationFulfillment.estimatedDelivery,
  }));
}

function getAllocationFulfillment(vendorId: VendorId, orderNumber: string | number): AllocationFulfillmentState {
  const normalizedOrderNumber = Number(orderNumber);

  if (normalizedOrderNumber === 1001 && vendorId === 'demo-vendor-a') {
    return {
      status: 'Processing',
      allocationStatus: 'pending_reassignment',
      cancellationReason: 'out_of_stock',
      reassignmentRequired: true,
      assignmentBlockedAt: '2026-05-09T15:05:00Z',
      fulfillmentActionState: 'awaiting_shipment',
      fulfillmentActionAvailable: false,
      fulfillmentStatus: 'Processing',
      shippingStatus: 'Awaiting Shipment',
    };
  }

  if (normalizedOrderNumber === 1001 && vendorId === 'demo-vendor-b') {
    return {
      status: 'Shipped',
      allocationStatus: 'active',
      reassignmentRequired: false,
      fulfillmentActionState: 'shipped',
      fulfillmentActionAvailable: true,
      shipmentCreatedAt: '2026-05-09T18:40:00Z',
      shipmentUpdatedAt: '2026-05-10T07:45:00Z',
      fulfilledAt: '2026-05-10T07:45:00Z',
      fulfilledByVendorId: 'demo-vendor-b',
      fulfillmentStatus: 'Fulfilled',
      shippingStatus: 'In Transit',
      trackingNumber: 'TRK-B-1001',
      carrier: 'UPS',
      estimatedDelivery: '2026-05-12T12:00:00Z',
    };
  }

  if (normalizedOrderNumber === 1002 && vendorId === 'demo-vendor-a') {
    return {
      status: 'Delivered',
      allocationStatus: 'fulfilled',
      reassignmentRequired: false,
      fulfillmentActionState: 'delivered',
      fulfillmentActionAvailable: true,
      shipmentCreatedAt: '2026-05-08T15:55:00Z',
      shipmentUpdatedAt: '2026-05-09T12:25:00Z',
      fulfilledAt: '2026-05-08T16:10:00Z',
      fulfilledByVendorId: 'demo-vendor-a',
      fulfillmentStatus: 'Fulfilled',
      shippingStatus: 'Delivered',
      trackingNumber: 'TRK-A-1002',
      carrier: 'DHL',
      estimatedDelivery: '2026-05-09T12:00:00Z',
    };
  }

  if (normalizedOrderNumber === 2001 && vendorId === 'demo-vendor-b') {
    return {
      status: 'Pending',
      allocationStatus: 'active',
      reassignmentRequired: false,
      fulfillmentActionState: 'awaiting_shipment',
      fulfillmentActionAvailable: true,
      fulfillmentStatus: 'Pending',
      shippingStatus: 'Awaiting Shipment',
    };
  }

  if (normalizedOrderNumber === 2002 && vendorId === 'demo-vendor-b') {
    return {
      status: 'Shipped',
      allocationStatus: 'active',
      reassignmentRequired: false,
      fulfillmentActionState: 'label_created',
      fulfillmentActionAvailable: true,
      shipmentCreatedAt: '2026-05-10T06:15:00Z',
      shipmentUpdatedAt: '2026-05-10T06:15:00Z',
      fulfillmentStatus: 'Fulfilled',
      shippingStatus: 'In Transit',
      trackingNumber: 'TRK-B-2002',
      carrier: 'FedEx',
      estimatedDelivery: '2026-05-11T12:00:00Z',
    };
  }

  return {
    status: sourceOrders.find((order) => order.orderNumber === normalizedOrderNumber)?.status ?? 'Pending',
    allocationStatus: 'active',
    reassignmentRequired: false,
    fulfillmentActionState: 'awaiting_shipment',
    fulfillmentActionAvailable: true,
    fulfillmentStatus: 'Processing',
    shippingStatus: 'Awaiting Shipment',
  };
}

const sourceOrders: ShopifySourceOrder[] = [
  {
    id: 'gid://shopify/Order/1001',
    orderNumber: 1001,
    customer: 'Northwind Retail',
    date: '2026-05-09T10:15:00Z',
    status: 'Processing',
    channel: 'Web',
    shippingAddress: '120 Market Street, Berlin',
    notes: 'Priority fulfillment requested by account manager.',
    lineItems: [
      {
        id: 'line-1001-a1',
        variantId: 'variant-1001-a1',
        sku: 'SKU123',
        title: 'Wireless label printer',
        variantTitle: 'Medium',
        quantity: 2,
        price: '$1,250.00',
        vendorMetafield: 'Demo Vendor A',
      },
      {
        id: 'line-1001-b1',
        variantId: 'variant-1001-b1',
        sku: 'SKU123',
        title: 'Wireless label printer',
        variantTitle: 'Large',
        quantity: 1,
        price: '$1,600.00',
        vendorMetafield: 'Demo Vendor B',
      },
      {
        id: 'line-1001-a2',
        variantId: 'variant-1001-a2',
        sku: 'STANDARD',
        title: 'Standard Product',
        variantTitle: 'Default',
        quantity: 1,
        price: '$180.00',
        vendorMetafield: 'Demo Vendor A',
      },
    ],
    timeline: [
      { label: 'Order received', at: '2026-05-09T10:15:00Z' },
      { label: 'Payment confirmed', at: '2026-05-09T10:21:00Z' },
      { label: 'Packed for fulfillment', at: '2026-05-09T14:30:00Z' },
    ],
  },
  {
    id: 'gid://shopify/Order/1002',
    orderNumber: 1002,
    customer: 'Acme Supply Co.',
    date: '2026-05-08T09:20:00Z',
    status: 'Delivered',
    channel: 'Direct',
    shippingAddress: '22 Harbor Ave, Dublin',
    notes: 'Delivered without exceptions.',
    lineItems: [
      {
        id: 'line-1002-a1',
        variantId: 'variant-1002-a1',
        sku: 'SKU456',
        title: 'Barcode gateway license',
        variantTitle: 'Standard',
        quantity: 3,
        price: '$650.00',
        vendorMetafield: 'Demo Vendor A',
      },
      {
        id: 'line-1002-a2',
        variantId: 'variant-1002-a2',
        sku: 'SKU457',
        title: 'Support training module',
        variantTitle: 'Default',
        quantity: 1,
        price: '$680.00',
        vendorMetafield: 'Demo Vendor A',
      },
    ],
    timeline: [
      { label: 'Order received', at: '2026-05-08T09:20:00Z' },
      { label: 'Shipped', at: '2026-05-08T16:10:00Z' },
      { label: 'Delivered', at: '2026-05-09T12:25:00Z' },
    ],
  },
  {
    id: 'gid://shopify/Order/2001',
    orderNumber: 2001,
    customer: 'Warehouse One',
    date: '2026-05-10T13:40:00Z',
    status: 'Pending',
    channel: 'Marketplace',
    shippingAddress: '8 Foundry Road, Amsterdam',
    notes: 'Waiting on stock confirmation from warehouse.',
    lineItems: [
      {
        id: 'line-2001-b1',
        variantId: 'variant-2001-b1',
        sku: 'SKU123',
        title: 'Wireless label printer',
        variantTitle: 'Large',
        quantity: 1,
        price: '$1,600.00',
        vendorMetafield: 'Demo Vendor B',
      },
      {
        id: 'line-2001-b2',
        variantId: 'variant-2001-b2',
        sku: 'SKU999',
        title: 'Thermal receipt rolls',
        variantTitle: 'Bundle',
        quantity: 20,
        price: '$18.00',
        vendorMetafield: 'Demo Vendor B',
      },
    ],
    timeline: [
      { label: 'Order received', at: '2026-05-10T13:40:00Z' },
      { label: 'Awaiting inventory review', at: '2026-05-10T13:55:00Z' },
    ],
  },
  {
    id: 'gid://shopify/Order/2002',
    orderNumber: 2002,
    customer: 'Cobalt Logistics',
    date: '2026-05-09T18:05:00Z',
    status: 'Shipped',
    channel: 'Web',
    shippingAddress: '76 King Street, London',
    notes: 'Carrier pickup completed and tracking shared.',
    lineItems: [
      {
        id: 'line-2002-b1',
        variantId: 'variant-2002-b1',
        sku: 'SKU777',
        title: 'Industrial tablet',
        variantTitle: 'One size',
        quantity: 8,
        price: '$1,100.00',
        vendorMetafield: 'Demo Vendor B',
      },
      {
        id: 'line-2002-b2',
        variantId: 'variant-2002-b2',
        sku: 'SKU778',
        title: 'Mounting cradle',
        variantTitle: 'One size',
        quantity: 8,
        price: '$117.50',
        vendorMetafield: 'Demo Vendor B',
      },
    ],
    timeline: [
      { label: 'Order received', at: '2026-05-09T18:05:00Z' },
      { label: 'Packed for shipment', at: '2026-05-09T20:30:00Z' },
      { label: 'Carrier collected', at: '2026-05-10T07:45:00Z' },
    ],
  },
];

function resolveVendorId(vendorId?: VendorId) {
  return vendorId ?? getCurrentVendorContext().vendorId;
}

function getAssignmentHistory(vendorId: VendorId, orderNumber: string | number): AssignmentHistoryEntry[] {
  const orderDate = sourceOrders.find((order) => Number(order.orderNumber) === Number(orderNumber))?.date;
  const assignedAt = orderDate ?? '2026-05-09T10:15:00Z';

  if (Number(orderNumber) === 1001 && vendorId === 'demo-vendor-a') {
    return [
      {
        action: 'assigned',
        fromVendorId: null,
        toVendorId: 'demo-vendor-a',
        reason: 'Variant metafield matched Demo Vendor A',
        actorName: 'System Allocation Engine',
        actorRole: 'system',
        createdAt: assignedAt,
      },
      {
        action: 'vendor_blocked',
        fromVendorId: 'demo-vendor-a',
        toVendorId: 'demo-vendor-a',
        reason: 'out_of_stock',
        actorName: 'Vendor A User',
        actorRole: 'vendor',
        createdAt: '2026-05-09T15:05:00Z',
      },
      {
        action: 'reassignment_requested',
        fromVendorId: 'demo-vendor-a',
        toVendorId: 'demo-vendor-a',
        reason: 'Fulfillment blocked, admin reassignment requested',
        actorName: 'Ops Monitor',
        actorRole: 'system',
        createdAt: '2026-05-09T15:06:00Z',
      },
    ];
  }

  return [
    {
      action: 'assigned',
      fromVendorId: null,
      toVendorId: vendorId,
      reason: `Variant metafield matched ${vendorId}`,
      actorName: 'System Allocation Engine',
      actorRole: 'system',
      createdAt: assignedAt,
    },
  ];
}

export function getReassignmentCandidates(allocation: { assignedVendorId: VendorId }): VendorId[] {
  return getAvailableVendors()
    .map((vendor) => vendor.vendorId)
    .filter((vendorId) => vendorId !== allocation.assignedVendorId);
}

function mapSourceOrder(sourceOrder: ShopifySourceOrder) {
  const allocationResult = allocateShopifyOrderToVendors(sourceOrder);

  return allocationResult.allocations.map<VendorOrder>((allocation) => {
    const allocationFulfillment = getAllocationFulfillment(allocation.assignedVendorId, sourceOrder.orderNumber);
    const lineItems = createLineItems(allocation.assignedVendorId, allocation.lineItems, allocationFulfillment);
    const amount = lineItems.reduce((total, lineItem) => total + parseMoney(lineItem.price) * lineItem.quantity, 0);

    return {
      originalVendorId: allocation.originalVendorId,
      assignedVendorId: allocation.assignedVendorId,
      vendorId: allocation.assignedVendorId,
      id: `ORD-${allocation.assignedVendorId === 'demo-vendor-a' ? 'A' : 'B'}-${sourceOrder.orderNumber}`,
      sourceShopifyOrderId: sourceOrder.id,
      sourceShopifyOrderNumber: sourceOrder.orderNumber,
      status: allocationFulfillment.status,
      allocationStatus: allocationFulfillment.allocationStatus,
      cancellationReason: allocationFulfillment.cancellationReason,
      reassignmentRequired: allocationFulfillment.reassignmentRequired,
      assignmentBlockedAt: allocationFulfillment.assignmentBlockedAt,
      assignmentHistory: getAssignmentHistory(allocation.assignedVendorId, sourceOrder.orderNumber),
      fulfillmentActionState: allocationFulfillment.fulfillmentActionState,
      fulfillmentActionAvailable: allocationFulfillment.fulfillmentActionAvailable,
      fulfilledAt: allocationFulfillment.fulfilledAt,
      fulfilledByVendorId: allocationFulfillment.fulfilledByVendorId,
      shipmentCreatedAt: allocationFulfillment.shipmentCreatedAt,
      shipmentUpdatedAt: allocationFulfillment.shipmentUpdatedAt,
      fulfillmentStatus: allocationFulfillment.fulfillmentStatus,
      shippingStatus: allocationFulfillment.shippingStatus,
      trackingNumber: allocationFulfillment.trackingNumber,
      carrier: allocationFulfillment.carrier,
      estimatedDelivery: allocationFulfillment.estimatedDelivery,
      date: sourceOrder.date,
      customer: sourceOrder.customer,
      amount: formatMoney(amount),
      channel: sourceOrder.channel,
      shippingAddress: sourceOrder.shippingAddress,
      notes: sourceOrder.notes,
      lineItems,
      items: lineItems,
      timeline: sourceOrder.timeline,
    };
  });
}

const orders = sourceOrders.flatMap(mapSourceOrder);

function parseSourceOrderKey(shopifyOrderId: string) {
  if (/^\d+$/.test(shopifyOrderId)) {
    return Number(shopifyOrderId);
  }

  const idSegment = shopifyOrderId.split('/').pop();
  const maybeNumber = Number(idSegment);
  return Number.isNaN(maybeNumber) ? shopifyOrderId : maybeNumber;
}

export function listMockOrders(vendorId?: VendorId): OrderSummary[] {
  const currentVendorId = resolveVendorId(vendorId);

  return orders
    .filter((order) => order.assignedVendorId === currentVendorId)
    .map(({ vendorId: _vendorId, shippingAddress, notes, lineItems, items, timeline, ...summary }) => ({
      ...summary,
      assignedVendorId: currentVendorId,
      vendorId: currentVendorId,
    }));
}

export function getMockOrder(orderId: string, vendorId?: VendorId): OrderDetail | null {
  const currentVendorId = resolveVendorId(vendorId);

  return orders.find((order) => order.assignedVendorId === currentVendorId && order.id === orderId) ?? null;
}

export function canVendorReportFulfillmentIssue(orderId: string, vendorId: VendorId): boolean {
  const order = getMockOrder(orderId, vendorId);

  if (!order) {
    return false;
  }

  return order.assignedVendorId === vendorId && (order.allocationStatus === 'active' || order.allocationStatus === 'fulfilled');
}

export function canVendorPerformFulfillmentActions(orderId: string, vendorId: VendorId): boolean {
  const order = getMockOrder(orderId, vendorId);

  if (!order) {
    return false;
  }

  if (order.assignedVendorId !== vendorId) {
    return false;
  }

  if (order.allocationStatus === 'pending_reassignment' || order.allocationStatus === 'vendor_blocked') {
    return false;
  }

  return order.fulfillmentActionAvailable;
}

export function getShopifyOrderBreakdown(shopifyOrderId: string): ShopifyOrderBreakdown | null {
  const sourceKey = parseSourceOrderKey(shopifyOrderId);
  const sourceMatches = orders.filter(
    (order) =>
      order.sourceShopifyOrderId === shopifyOrderId ||
      order.sourceShopifyOrderNumber === sourceKey ||
      String(order.sourceShopifyOrderNumber) === String(sourceKey),
  );

  if (sourceMatches.length === 0) {
    return null;
  }

  const vendorLookup = new Map(getAvailableVendors().map((vendor) => [vendor.vendorId, vendor.vendorName] as const));
  const allocationMap = new Map(sourceMatches.map((order) => [order.assignedVendorId, order] as const));
  const sourceOrderNumber = sourceMatches[0].sourceShopifyOrderNumber;
  const sourceReturns = listMockReturns('demo-vendor-a')
    .concat(listMockReturns('demo-vendor-b'))
    .filter((returnRequest) => String(returnRequest.sourceShopifyOrderNumber) === String(sourceOrderNumber));

  const allocations = Array.from(allocationMap.values()).map((allocationOrder) => {
    const vendorReturns = sourceReturns.filter((item) => item.assignedVendorId === allocationOrder.assignedVendorId);
    const refundedItems = vendorReturns.flatMap((item) => {
      const detail = getMockReturn(item.id, allocationOrder.assignedVendorId);
      return detail?.items ?? [];
    });

    return {
      originalVendorId: allocationOrder.originalVendorId,
      assignedVendorId: allocationOrder.assignedVendorId,
      vendorId: allocationOrder.assignedVendorId,
      vendorName: vendorLookup.get(allocationOrder.assignedVendorId) ?? allocationOrder.assignedVendorId,
      allocationOrderId: allocationOrder.id,
      status: allocationOrder.status,
      allocationStatus: allocationOrder.allocationStatus,
      cancellationReason: allocationOrder.cancellationReason,
      reassignmentRequired: allocationOrder.reassignmentRequired,
      assignmentBlockedAt: allocationOrder.assignmentBlockedAt,
      reassignmentCandidateVendorIds: getReassignmentCandidates({
        assignedVendorId: allocationOrder.assignedVendorId,
      }),
      reassignmentNote: allocationOrder.reassignmentRequired
        ? 'Vendor reported a fulfillment issue. Reassignment review is required.'
        : undefined,
      reassignedAt: undefined,
      reassignedBy: undefined,
      assignmentHistory: allocationOrder.assignmentHistory,
      fulfillmentActionState: allocationOrder.fulfillmentActionState,
      fulfillmentActionAvailable: allocationOrder.fulfillmentActionAvailable,
      fulfilledAt: allocationOrder.fulfilledAt,
      fulfilledByVendorId: allocationOrder.fulfilledByVendorId,
      shipmentCreatedAt: allocationOrder.shipmentCreatedAt,
      shipmentUpdatedAt: allocationOrder.shipmentUpdatedAt,
      fulfillmentStatus: allocationOrder.fulfillmentStatus,
      shippingStatus: allocationOrder.shippingStatus,
      trackingNumber: allocationOrder.trackingNumber,
      carrier: allocationOrder.carrier,
      estimatedDelivery: allocationOrder.estimatedDelivery,
      allocationTotal: allocationOrder.amount,
      lineItems: allocationOrder.lineItems,
      refundedItems,
      refundTotal: formatMoney(
        vendorReturns.reduce((total, returnRequest) => total + parseMoney(returnRequest.amount), 0),
      ),
    };
  });

  const reference = sourceMatches[0];

  return {
    sourceShopifyOrderId: reference.sourceShopifyOrderId,
    sourceShopifyOrderNumber: reference.sourceShopifyOrderNumber,
    customer: reference.customer,
    createdAt: reference.date,
    allocations,
  };
}
