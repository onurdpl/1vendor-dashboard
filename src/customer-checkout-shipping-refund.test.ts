import { describe, expect, it } from 'vitest';
import {
  CUSTOMER_CHECKOUT_SHIPPING_REFUND_ELIGIBILITY,
  evaluateCustomerCheckoutShippingRefundEligibility,
  type CustomerCheckoutShippingAllocationEvidence,
} from '../backend/src/modules/orders/customer-checkout-shipping-refund.service.js';

function allocation(overrides: Partial<CustomerCheckoutShippingAllocationEvidence> = {}): CustomerCheckoutShippingAllocationEvidence {
  return {
    id: 'allocation-1',
    allocationStatus: 'VENDOR_BLOCKED',
    reassignmentRequired: true,
    fulfillmentStatus: 'Pending',
    shippingStatus: 'Awaiting Shipment',
    trackingNumber: null,
    carrier: null,
    fulfillment: null,
    shipmentExecutions: [],
    ...overrides,
  };
}

describe('customer checkout shipping refund eligibility', () => {
  it('allows one rejected pre-shipment allocation', () => {
    expect(evaluateCustomerCheckoutShippingRefundEligibility({
      targetAllocationId: 'allocation-1',
      allocations: [allocation()],
    })).toEqual({
      status: CUSTOMER_CHECKOUT_SHIPPING_REFUND_ELIGIBILITY.ELIGIBLE,
      reasonCode: 'all_allocations_vendor_blocked_pre_shipment',
    });
  });

  it('allows a multi-vendor order only when every allocation is blocked pre-shipment', () => {
    expect(evaluateCustomerCheckoutShippingRefundEligibility({
      targetAllocationId: 'allocation-1',
      allocations: [allocation(), allocation({ id: 'allocation-2' })],
    }).status).toBe(CUSTOMER_CHECKOUT_SHIPPING_REFUND_ELIGIBILITY.ELIGIBLE);

    expect(evaluateCustomerCheckoutShippingRefundEligibility({
      targetAllocationId: 'allocation-1',
      allocations: [allocation(), allocation({
        id: 'allocation-2',
        allocationStatus: 'ACTIVE',
        reassignmentRequired: false,
      })],
    })).toEqual({
      status: CUSTOMER_CHECKOUT_SHIPPING_REFUND_ELIGIBILITY.NOT_ELIGIBLE,
      reasonCode: 'customer_fulfillment_allocation_remains',
    });
  });

  it('rejects concrete shipment evidence', () => {
    expect(evaluateCustomerCheckoutShippingRefundEligibility({
      targetAllocationId: 'allocation-1',
      allocations: [allocation({ trackingNumber: 'TRACK-1' })],
    })).toEqual({
      status: CUSTOMER_CHECKOUT_SHIPPING_REFUND_ELIGIBILITY.NOT_ELIGIBLE,
      reasonCode: 'shipment_or_fulfillment_evidence_exists',
    });
  });

  it('fails closed when pre-shipment state is not proven', () => {
    expect(evaluateCustomerCheckoutShippingRefundEligibility({
      targetAllocationId: 'allocation-1',
      allocations: [allocation({ fulfillmentStatus: 'UNKNOWN' })],
    })).toEqual({
      status: CUSTOMER_CHECKOUT_SHIPPING_REFUND_ELIGIBILITY.UNRESOLVED,
      reasonCode: 'pre_shipment_state_unresolved',
    });
  });
});
