import { describe, expect, it } from 'vitest';
import {
  classifyFulfillmentOrderCancellationSafety,
} from '../backend/src/modules/shopify/shopify-fulfillment-order-cancel-classifier.service.js';

function buildFulfillmentOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 'gid://shopify/FulfillmentOrder/fo-1',
    status: 'OPEN',
    requestStatus: 'UNREQUESTED',
    supportedActions: ['CANCEL_FULFILLMENT_ORDER'],
    assignedLocationId: 'gid://shopify/Location/location-1',
    assignedLocationName: 'Main Warehouse',
    lineItems: [
      {
        id: 'gid://shopify/FulfillmentOrderLineItem/fo-line-1',
        lineItemId: 'gid://shopify/LineItem/line-1',
        remainingQuantity: 1,
        totalQuantity: 1,
      },
    ],
    ...overrides,
  };
}

const selectedLineItems = [
  {
    lineItemId: 'gid://shopify/LineItem/line-1',
    quantity: 1,
  },
];

const localLineItemOwners = [
  {
    sourceLineItemId: 'line-1',
    allocationId: 'alloc-1',
    vendorId: 'vendor-1',
  },
];

describe('Shopify fulfillment order cancel classifier', () => {
  it('marks a single fulfillment order safe when every line belongs to the selected allocation', () => {
    const result = classifyFulfillmentOrderCancellationSafety({
      allocationId: 'alloc-1',
      selectedLineItems,
      fulfillmentOrders: [buildFulfillmentOrder()],
      localLineItemOwners,
    });

    expect(result.overallClassification).toBe('safe_to_cancel');
    expect(result.blockers).toEqual([]);
    expect(result.warnings).toContain('Affected fulfillment orders must be cancelled before refundCreate.');
    expect(result.affectedFulfillmentOrders[0]?.classification).toBe('safe_to_cancel');
  });

  it('blocks mixed fulfillment orders containing another vendor allocation line', () => {
    const result = classifyFulfillmentOrderCancellationSafety({
      allocationId: 'alloc-1',
      selectedLineItems,
      fulfillmentOrders: [
        buildFulfillmentOrder({
          lineItems: [
            {
              id: 'gid://shopify/FulfillmentOrderLineItem/fo-line-1',
              lineItemId: 'gid://shopify/LineItem/line-1',
              remainingQuantity: 1,
              totalQuantity: 1,
            },
            {
              id: 'gid://shopify/FulfillmentOrderLineItem/fo-line-2',
              lineItemId: 'gid://shopify/LineItem/line-2',
              remainingQuantity: 1,
              totalQuantity: 1,
            },
          ],
        }),
      ],
      localLineItemOwners: [
        ...localLineItemOwners,
        {
          sourceLineItemId: 'line-2',
          allocationId: 'alloc-2',
          vendorId: 'vendor-2',
        },
      ],
    });

    expect(result.overallClassification).toBe('blocked');
    expect(result.affectedFulfillmentOrders[0]?.classification).toBe('unsafe_mixed_fulfillment_order');
    expect(result.blockers[0]).toContain('outside the selected allocation refund');
  });

  it('blocks same-vendor unrelated allocation lines when they are not selected', () => {
    const result = classifyFulfillmentOrderCancellationSafety({
      allocationId: 'alloc-1',
      selectedLineItems,
      fulfillmentOrders: [
        buildFulfillmentOrder({
          lineItems: [
            {
              id: 'gid://shopify/FulfillmentOrderLineItem/fo-line-1',
              lineItemId: 'gid://shopify/LineItem/line-1',
              remainingQuantity: 1,
              totalQuantity: 1,
            },
            {
              id: 'gid://shopify/FulfillmentOrderLineItem/fo-line-2',
              lineItemId: 'gid://shopify/LineItem/line-2',
              remainingQuantity: 1,
              totalQuantity: 1,
            },
          ],
        }),
      ],
      localLineItemOwners: [
        ...localLineItemOwners,
        {
          sourceLineItemId: 'line-2',
          allocationId: 'alloc-2',
          vendorId: 'vendor-1',
        },
      ],
    });

    expect(result.overallClassification).toBe('blocked');
    expect(result.affectedFulfillmentOrders[0]?.classification).toBe('unsafe_mixed_fulfillment_order');
  });

  it('blocks when selected quantity is lower than remaining quantity', () => {
    const result = classifyFulfillmentOrderCancellationSafety({
      allocationId: 'alloc-1',
      selectedLineItems,
      fulfillmentOrders: [
        buildFulfillmentOrder({
          lineItems: [
            {
              id: 'gid://shopify/FulfillmentOrderLineItem/fo-line-1',
              lineItemId: 'gid://shopify/LineItem/line-1',
              remainingQuantity: 2,
              totalQuantity: 2,
            },
          ],
        }),
      ],
      localLineItemOwners,
    });

    expect(result.overallClassification).toBe('blocked');
    expect(result.affectedFulfillmentOrders[0]?.classification).toBe('quantity_mismatch');
  });

  it('ignores closed fulfillment orders for cancellation needs', () => {
    const result = classifyFulfillmentOrderCancellationSafety({
      allocationId: 'alloc-1',
      selectedLineItems,
      fulfillmentOrders: [buildFulfillmentOrder({ status: 'CLOSED' })],
      localLineItemOwners,
    });

    expect(result.overallClassification).toBe('no_cancellation_needed');
    expect(result.affectedFulfillmentOrders[0]?.classification).toBe('already_closed_or_cancelled');
  });

  it('classifies missing supportedActions as unknown', () => {
    const result = classifyFulfillmentOrderCancellationSafety({
      allocationId: 'alloc-1',
      selectedLineItems,
      fulfillmentOrders: [buildFulfillmentOrder({ supportedActions: null })],
      localLineItemOwners,
    });

    expect(result.overallClassification).toBe('unknown');
    expect(result.affectedFulfillmentOrders[0]?.classification).toBe('unknown');
    expect(result.blockers[0]).toContain('missing supportedActions');
  });

  it('blocks unsupported request status even when quantities are safe', () => {
    const result = classifyFulfillmentOrderCancellationSafety({
      allocationId: 'alloc-1',
      selectedLineItems,
      fulfillmentOrders: [buildFulfillmentOrder({ requestStatus: 'ACCEPTED', supportedActions: [] })],
      localLineItemOwners,
    });

    expect(result.overallClassification).toBe('blocked');
    expect(result.affectedFulfillmentOrders[0]?.classification).toBe('unsupported_request_status');
  });
});
