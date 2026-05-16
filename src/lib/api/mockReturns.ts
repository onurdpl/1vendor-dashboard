import { getCurrentVendorContext, type VendorId } from '../auth/vendorContext';
import type {
  ReturnDetail,
  ReturnLineItem,
  ReturnSummary,
  ReturnStatus,
} from './contracts';
import {
  allocateShopifyOrderToVendors,
  type ShopifyOrderInput,
  type ShopifyOrderLineItemInput,
  type VendorAllocationLineItem,
} from '../shopify/vendorMapping';

type RefundLineItemInput = ShopifyOrderLineItemInput & {
  condition: ReturnLineItem['condition'];
};

type ShopifySourceRefund = ShopifyOrderInput & {
  refundId: string;
  status: ReturnStatus;
  date: string;
  reason: string;
  customer: string;
  resolution: string;
  refundMethod: string;
  processedBy: string;
  timeline: Array<{ label: string; at: string }>;
  lineItems: RefundLineItemInput[];
};

type VendorReturn = ReturnDetail & {
  vendorId: VendorId;
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

function toReturnLineItems(vendorId: VendorId, items: Array<VendorAllocationLineItem<RefundLineItemInput>>): ReturnLineItem[] {
  return items.map(({ vendorMetafield: _vendorMetafield, ...item }) => ({
    originalVendorId: item.originalVendorId,
    assignedVendorId: item.assignedVendorId,
    id: item.id,
    sku: item.sku,
    variantTitle: item.variantTitle,
    name: item.title,
    quantity: item.quantity,
    condition: item.condition,
    refundAmount: item.price,
    vendorId,
  }));
}

const sourceRefunds: ShopifySourceRefund[] = [
  {
    id: 'gid://shopify/Order/1001',
    orderNumber: 1001,
    refundId: 'gid://shopify/Refund/5001',
    status: 'Pending',
    date: '2026-05-10T08:20:00Z',
    customer: 'Acme Supply Co.',
    reason: 'Mixed vendor refund from shared Shopify order.',
    resolution: 'Waiting on operations review.',
    refundMethod: 'Original payment method',
    processedBy: 'Unassigned',
    timeline: [
      { label: 'Refund created', at: '2026-05-10T08:20:00Z' },
      { label: 'Awaiting review', at: '2026-05-10T08:32:00Z' },
    ],
    lineItems: [
      {
        id: 'refund-1001-a1',
        variantId: 'variant-refund-1001-a1',
        sku: 'SKU123',
        title: 'Wireless label printer',
        variantTitle: 'Medium',
        quantity: 1,
        price: '$1,250.00',
        vendorMetafield: 'Demo Vendor A',
        condition: 'Opened',
      },
      {
        id: 'refund-1001-b1',
        variantId: 'variant-refund-1001-b1',
        sku: 'SKU123',
        title: 'Wireless label printer',
        variantTitle: 'Large',
        quantity: 1,
        price: '$1,600.00',
        vendorMetafield: 'Demo Vendor B',
        condition: 'Opened',
      },
    ],
  },
  {
    id: 'gid://shopify/Order/1002',
    orderNumber: 1002,
    refundId: 'gid://shopify/Refund/5002',
    status: 'Approved',
    date: '2026-05-09T15:10:00Z',
    customer: 'Northwind Retail',
    reason: 'Damaged shipment on arrival.',
    resolution: 'Approved for replacement and refund.',
    refundMethod: 'Store credit',
    processedBy: 'Maya Chen',
    timeline: [
      { label: 'Refund created', at: '2026-05-09T15:10:00Z' },
      { label: 'Reviewed by support', at: '2026-05-09T16:05:00Z' },
      { label: 'Approved', at: '2026-05-09T16:18:00Z' },
    ],
    lineItems: [
      {
        id: 'refund-1002-a1',
        variantId: 'variant-refund-1002-a1',
        sku: 'SKU456',
        title: 'Barcode gateway license',
        variantTitle: 'Standard',
        quantity: 1,
        price: '$650.00',
        vendorMetafield: 'Demo Vendor A',
        condition: 'Damaged',
      },
    ],
  },
  {
    id: 'gid://shopify/Order/2002',
    orderNumber: 2002,
    refundId: 'gid://shopify/Refund/6001',
    status: 'Refunded',
    date: '2026-05-07T14:15:00Z',
    customer: 'Cobalt Logistics',
    reason: 'Duplicate billing on training module.',
    resolution: 'Refund issued and return closed.',
    refundMethod: 'Original payment method',
    processedBy: 'Sarah Patel',
    timeline: [
      { label: 'Refund created', at: '2026-05-07T14:15:00Z' },
      { label: 'Refund approved', at: '2026-05-07T15:10:00Z' },
      { label: 'Refund completed', at: '2026-05-07T15:35:00Z' },
    ],
    lineItems: [
      {
        id: 'refund-2002-b1',
        variantId: 'variant-refund-2002-b1',
        sku: 'SKU777',
        title: 'Industrial tablet',
        variantTitle: 'One size',
        quantity: 1,
        price: '$1,100.00',
        vendorMetafield: 'Demo Vendor B',
        condition: 'New',
      },
    ],
  },
];

function resolveVendorId(vendorId?: VendorId) {
  return vendorId ?? getCurrentVendorContext().vendorId;
}

function mapSourceRefund(sourceRefund: ShopifySourceRefund): VendorReturn[] {
  const allocationResult = allocateShopifyOrderToVendors(sourceRefund);

  return allocationResult.allocations.map<VendorReturn>((allocation) => {
    const refundedItems = toReturnLineItems(allocation.assignedVendorId, allocation.lineItems);
    const amount = refundedItems.reduce((total, item) => total + parseMoney(item.refundAmount) * item.quantity, 0);
    const suffix = allocation.assignedVendorId === 'demo-vendor-a' ? 'A' : 'B';

    return {
      originalVendorId: allocation.originalVendorId,
      assignedVendorId: allocation.assignedVendorId,
      vendorId: allocation.assignedVendorId,
      id: `RET-${suffix}-${sourceRefund.orderNumber}`,
      sourceShopifyOrderId: sourceRefund.id,
      sourceShopifyOrderNumber: sourceRefund.orderNumber,
      sourceShopifyRefundId: sourceRefund.refundId,
      status: sourceRefund.status,
      relatedOrderId: `ORD-${suffix}-${sourceRefund.orderNumber}`,
      date: sourceRefund.date,
      customer: sourceRefund.customer,
      reason: sourceRefund.reason,
      amount: formatMoney(amount),
      resolution: sourceRefund.resolution,
      refundMethod: sourceRefund.refundMethod,
      processedBy: sourceRefund.processedBy,
      refundedItems,
      items: refundedItems,
      timeline: sourceRefund.timeline,
    };
  });
}

const returns = sourceRefunds.flatMap(mapSourceRefund);

export function listMockReturns(vendorId?: VendorId): ReturnSummary[] {
  const currentVendorId = resolveVendorId(vendorId);

  return returns
    .filter((item) => item.assignedVendorId === currentVendorId)
    .map(
      ({
        vendorId,
        resolution,
        refundMethod,
        processedBy,
        items: _items,
        timeline,
        ...summary
      }) => ({
        ...summary,
        assignedVendorId: currentVendorId,
        vendorId,
      }),
    );
}

export function getMockReturn(returnId: string, vendorId?: VendorId): ReturnDetail | null {
  const currentVendorId = resolveVendorId(vendorId);

  return returns.find((item) => item.assignedVendorId === currentVendorId && item.id === returnId) ?? null;
}
