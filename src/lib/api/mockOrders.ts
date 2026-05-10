import { getCurrentVendorContext, type VendorId } from '../auth/vendorContext';
import { allocateShopifyOrderToVendors, type ShopifyOrderInput } from '../shopify/vendorMapping';
import type { OrderDetail, OrderSummary, OrderLineItem, OrderStatus } from './contracts';

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
  allocationLineItems: ShopifySourceOrder['lineItems'],
): OrderLineItem[] {
  return allocationLineItems.map(({ vendorMetafield: _vendorMetafield, ...lineItem }) => ({
    ...lineItem,
    vendorId,
    name: lineItem.title,
  }));
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

function mapSourceOrder(sourceOrder: ShopifySourceOrder) {
  const allocationResult = allocateShopifyOrderToVendors(sourceOrder);

  return allocationResult.allocations.map<VendorOrder>((allocation) => {
    const lineItems = createLineItems(allocation.vendorId, allocation.lineItems);
    const amount = lineItems.reduce((total, lineItem) => total + parseMoney(lineItem.price) * lineItem.quantity, 0);

    return {
      vendorId: allocation.vendorId,
      id: `ORD-${allocation.vendorId === 'demo-vendor-a' ? 'A' : 'B'}-${sourceOrder.orderNumber}`,
      sourceShopifyOrderId: sourceOrder.id,
      sourceShopifyOrderNumber: sourceOrder.orderNumber,
      status: sourceOrder.status,
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

export function listMockOrders(vendorId?: VendorId): OrderSummary[] {
  const currentVendorId = resolveVendorId(vendorId);

  return orders
    .filter((order) => order.vendorId === currentVendorId)
    .map(({ vendorId: _vendorId, shippingAddress, notes, lineItems, items, timeline, ...summary }) => ({
      ...summary,
      vendorId: currentVendorId,
    }));
}

export function getMockOrder(orderId: string, vendorId?: VendorId): OrderDetail | null {
  const currentVendorId = resolveVendorId(vendorId);

  return orders.find((order) => order.vendorId === currentVendorId && order.id === orderId) ?? null;
}
