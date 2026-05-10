import type { ReturnDetail, ReturnSummary } from './contracts';

const returns: ReturnDetail[] = [
  {
    id: 'RET-20041',
    status: 'Pending',
    relatedOrderId: 'ORD-10483',
    date: '2026-05-10T08:20:00Z',
    customer: 'Acme Supply Co.',
    reason: 'Wrong accessory kit delivered.',
    amount: '$420.00',
    resolution: 'Waiting on warehouse inspection.',
    refundMethod: 'Original payment method',
    processedBy: 'Unassigned',
    items: [
      { name: 'Accessory kit', quantity: 1, condition: 'Opened' },
    ],
    timeline: [
      { label: 'Return created', at: '2026-05-10T08:20:00Z' },
      { label: 'Awaiting review', at: '2026-05-10T08:32:00Z' },
    ],
  },
  {
    id: 'RET-20042',
    status: 'Approved',
    relatedOrderId: 'ORD-10482',
    date: '2026-05-09T15:10:00Z',
    customer: 'Northwind Retail',
    reason: 'Damaged shipment on arrival.',
    amount: '$1,250.00',
    resolution: 'Approved for replacement and refund.',
    refundMethod: 'Store credit',
    processedBy: 'Maya Chen',
    items: [
      { name: 'Wireless label printer', quantity: 1, condition: 'Damaged' },
    ],
    timeline: [
      { label: 'Return created', at: '2026-05-09T15:10:00Z' },
      { label: 'Reviewed by support', at: '2026-05-09T16:05:00Z' },
      { label: 'Approved', at: '2026-05-09T16:18:00Z' },
    ],
  },
  {
    id: 'RET-20043',
    status: 'Rejected',
    relatedOrderId: 'ORD-10484',
    date: '2026-05-08T21:40:00Z',
    customer: 'Warehouse One',
    reason: 'Return requested outside policy window.',
    amount: '$120.00',
    resolution: 'Rejected due to policy limits.',
    refundMethod: 'None',
    processedBy: 'Jordan Lee',
    items: [
      { name: 'Mounting cradle', quantity: 1, condition: 'Opened' },
    ],
    timeline: [
      { label: 'Return created', at: '2026-05-08T21:40:00Z' },
      { label: 'Policy check completed', at: '2026-05-08T22:05:00Z' },
      { label: 'Rejected', at: '2026-05-08T22:12:00Z' },
    ],
  },
  {
    id: 'RET-20044',
    status: 'Refunded',
    relatedOrderId: 'ORD-10485',
    date: '2026-05-07T14:15:00Z',
    customer: 'Cobalt Logistics',
    reason: 'Duplicate billing on training module.',
    amount: '$680.00',
    resolution: 'Refund issued and return closed.',
    refundMethod: 'Original payment method',
    processedBy: 'Sarah Patel',
    items: [
      { name: 'Support training module', quantity: 1, condition: 'New' },
    ],
    timeline: [
      { label: 'Return created', at: '2026-05-07T14:15:00Z' },
      { label: 'Refund approved', at: '2026-05-07T15:10:00Z' },
      { label: 'Refund completed', at: '2026-05-07T15:35:00Z' },
    ],
  },
];

export function listMockReturns(): ReturnSummary[] {
  return returns.map(({ resolution, refundMethod, processedBy, items, timeline, ...summary }) => summary);
}

export function getMockReturn(returnId: string): ReturnDetail | null {
  return returns.find((item) => item.id === returnId) ?? null;
}
