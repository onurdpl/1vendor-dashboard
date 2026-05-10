import type { OrderDetail, OrderSummary } from './contracts';

const orders: OrderDetail[] = [
  {
    id: 'ORD-10482',
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
    id: 'ORD-10483',
    status: 'Pending',
    date: '2026-05-09T13:40:00Z',
    customer: 'Acme Supply Co.',
    amount: '$1,920.00',
    channel: 'Marketplace',
    shippingAddress: '22 Harbor Ave, Dublin',
    notes: 'Waiting on stock confirmation from warehouse.',
    items: [
      { name: 'Thermal receipt rolls', quantity: 20, price: '$18.00' },
      { name: 'Desktop scanner dock', quantity: 1, price: '$420.00' },
    ],
    timeline: [
      { label: 'Order received', at: '2026-05-09T13:40:00Z' },
      { label: 'Awaiting inventory review', at: '2026-05-09T13:55:00Z' },
    ],
  },
  {
    id: 'ORD-10484',
    status: 'Shipped',
    date: '2026-05-08T18:05:00Z',
    customer: 'Warehouse One',
    amount: '$9,740.00',
    channel: 'Direct',
    shippingAddress: '8 Foundry Road, Amsterdam',
    notes: 'Carrier pickup completed and tracking shared.',
    items: [
      { name: 'Industrial tablet', quantity: 8, price: '$1,100.00' },
      { name: 'Mounting cradle', quantity: 8, price: '$120.00' },
    ],
    timeline: [
      { label: 'Order received', at: '2026-05-08T18:05:00Z' },
      { label: 'Packed for shipment', at: '2026-05-08T20:30:00Z' },
      { label: 'Carrier collected', at: '2026-05-09T07:45:00Z' },
    ],
  },
  {
    id: 'ORD-10485',
    status: 'Delivered',
    date: '2026-05-07T09:20:00Z',
    customer: 'Cobalt Logistics',
    amount: '$2,630.00',
    channel: 'Web',
    shippingAddress: '76 King Street, London',
    notes: 'Delivered without exceptions.',
    items: [
      { name: 'Barcode gateway license', quantity: 3, price: '$650.00' },
      { name: 'Support training module', quantity: 1, price: '$680.00' },
    ],
    timeline: [
      { label: 'Order received', at: '2026-05-07T09:20:00Z' },
      { label: 'Shipped', at: '2026-05-07T16:10:00Z' },
      { label: 'Delivered', at: '2026-05-08T12:25:00Z' },
    ],
  },
];

export function listMockOrders(): OrderSummary[] {
  return orders.map(({ shippingAddress, notes, items, timeline, ...summary }) => summary);
}

export function getMockOrder(orderId: string): OrderDetail | null {
  return orders.find((order) => order.id === orderId) ?? null;
}
