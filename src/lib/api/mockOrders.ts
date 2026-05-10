import { getCurrentVendorContext, type VendorId } from '../auth/vendorContext';
import type { OrderDetail, OrderSummary } from './contracts';

type VendorOrder = OrderDetail & {
  vendorId: VendorId;
};

const orders: VendorOrder[] = [
  {
    vendorId: 'demo-vendor-a',
    id: 'ORD-A-1001',
    status: 'Processing',
    date: '2026-05-09T10:15:00Z',
    customer: 'Northwind Retail',
    amount: '$4,280.00',
    channel: 'Web',
    shippingAddress: '120 Market Street, Berlin',
    notes: 'Priority fulfillment requested by account manager.',
    items: [
      { name: 'Wireless label printer', quantity: 2, price: '$1,250.00' },
      { name: 'Replacement power kit', quantity: 4, price: '$145.00' },
    ],
    timeline: [
      { label: 'Order received', at: '2026-05-09T10:15:00Z' },
      { label: 'Payment confirmed', at: '2026-05-09T10:21:00Z' },
      { label: 'Packed for fulfillment', at: '2026-05-09T14:30:00Z' },
    ],
  },
  {
    vendorId: 'demo-vendor-a',
    id: 'ORD-A-1002',
    status: 'Delivered',
    date: '2026-05-08T09:20:00Z',
    customer: 'Acme Supply Co.',
    amount: '$2,630.00',
    channel: 'Direct',
    shippingAddress: '22 Harbor Ave, Dublin',
    notes: 'Delivered without exceptions.',
    items: [
      { name: 'Barcode gateway license', quantity: 3, price: '$650.00' },
      { name: 'Support training module', quantity: 1, price: '$680.00' },
    ],
    timeline: [
      { label: 'Order received', at: '2026-05-08T09:20:00Z' },
      { label: 'Shipped', at: '2026-05-08T16:10:00Z' },
      { label: 'Delivered', at: '2026-05-09T12:25:00Z' },
    ],
  },
  {
    vendorId: 'demo-vendor-b',
    id: 'ORD-B-2001',
    status: 'Pending',
    date: '2026-05-10T13:40:00Z',
    customer: 'Warehouse One',
    amount: '$1,920.00',
    channel: 'Marketplace',
    shippingAddress: '8 Foundry Road, Amsterdam',
    notes: 'Waiting on stock confirmation from warehouse.',
    items: [
      { name: 'Thermal receipt rolls', quantity: 20, price: '$18.00' },
      { name: 'Desktop scanner dock', quantity: 1, price: '$420.00' },
    ],
    timeline: [
      { label: 'Order received', at: '2026-05-10T13:40:00Z' },
      { label: 'Awaiting inventory review', at: '2026-05-10T13:55:00Z' },
    ],
  },
  {
    vendorId: 'demo-vendor-b',
    id: 'ORD-B-2002',
    status: 'Shipped',
    date: '2026-05-09T18:05:00Z',
    customer: 'Cobalt Logistics',
    amount: '$9,740.00',
    channel: 'Web',
    shippingAddress: '76 King Street, London',
    notes: 'Carrier pickup completed and tracking shared.',
    items: [
      { name: 'Industrial tablet', quantity: 8, price: '$1,100.00' },
      { name: 'Mounting cradle', quantity: 8, price: '$120.00' },
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

export function listMockOrders(vendorId?: VendorId): OrderSummary[] {
  const currentVendorId = resolveVendorId(vendorId);

  return orders
    .filter((order) => order.vendorId === currentVendorId)
    .map(({ vendorId: _vendorId, shippingAddress, notes, items, timeline, ...summary }) => summary);
}

export function getMockOrder(orderId: string, vendorId?: VendorId): OrderDetail | null {
  const currentVendorId = resolveVendorId(vendorId);

  return orders.find((order) => order.vendorId === currentVendorId && order.id === orderId) ?? null;
}
