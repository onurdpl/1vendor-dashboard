export const CUSTOMER_CHECKOUT_SHIPPING_REFUND_ELIGIBILITY = {
  ELIGIBLE: 'ELIGIBLE',
  NOT_ELIGIBLE: 'NOT_ELIGIBLE',
  UNRESOLVED: 'UNRESOLVED',
} as const;

export type CustomerCheckoutShippingRefundEligibility = {
  status: (typeof CUSTOMER_CHECKOUT_SHIPPING_REFUND_ELIGIBILITY)[keyof typeof CUSTOMER_CHECKOUT_SHIPPING_REFUND_ELIGIBILITY];
  reasonCode: string;
};

type ShipmentExecutionEvidence = {
  providerShipmentId: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  shipmentStatus: string;
};

export type CustomerCheckoutShippingAllocationEvidence = {
  id: string;
  allocationStatus: string;
  reassignmentRequired: boolean;
  fulfillmentStatus: string;
  shippingStatus: string;
  trackingNumber: string | null;
  carrier: string | null;
  fulfillment: {
    fulfilledAt: Date | null;
    shipmentCreatedAt: Date | null;
    shipmentUpdatedAt: Date | null;
    shopifyFulfillmentId: string | null;
    trackingNumber: string | null;
    trackingUrl: string | null;
  } | null;
  shipmentExecutions: ShipmentExecutionEvidence[];
};

const PRE_SHIPMENT_FULFILLMENT_STATUSES = new Set(['pending', 'unfulfilled', 'cancelled', 'canceled']);
const PRE_SHIPMENT_SHIPPING_STATUSES = new Set(['awaiting shipment', 'awaiting_shipment', 'not required', 'not_required']);
const INACTIVE_SHIPMENT_EXECUTION_STATUSES = new Set(['failed', 'cancelled', 'canceled']);

function normalize(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? '';
}

function hasText(value: string | null | undefined) {
  return Boolean(value?.trim());
}

function hasConcreteShipmentEvidence(allocation: CustomerCheckoutShippingAllocationEvidence) {
  if (hasText(allocation.trackingNumber) || hasText(allocation.carrier)) {
    return true;
  }
  if (
    allocation.fulfillment?.fulfilledAt ||
    allocation.fulfillment?.shipmentCreatedAt ||
    allocation.fulfillment?.shipmentUpdatedAt ||
    hasText(allocation.fulfillment?.shopifyFulfillmentId) ||
    hasText(allocation.fulfillment?.trackingNumber) ||
    hasText(allocation.fulfillment?.trackingUrl)
  ) {
    return true;
  }
  return (allocation.shipmentExecutions ?? []).some((execution) =>
    hasText(execution.providerShipmentId) ||
    hasText(execution.trackingNumber) ||
    hasText(execution.trackingUrl) ||
    !INACTIVE_SHIPMENT_EXECUTION_STATUSES.has(normalize(execution.shipmentStatus)),
  );
}

export function evaluateCustomerCheckoutShippingRefundEligibility(input: {
  targetAllocationId: string;
  allocations: CustomerCheckoutShippingAllocationEvidence[];
}): CustomerCheckoutShippingRefundEligibility {
  const targetAllocationId = input.targetAllocationId.trim();
  if (!targetAllocationId || input.allocations.length === 0) {
    return { status: CUSTOMER_CHECKOUT_SHIPPING_REFUND_ELIGIBILITY.UNRESOLVED, reasonCode: 'order_allocations_missing' };
  }
  if (!input.allocations.some((allocation) => allocation.id === targetAllocationId)) {
    return { status: CUSTOMER_CHECKOUT_SHIPPING_REFUND_ELIGIBILITY.UNRESOLVED, reasonCode: 'target_allocation_missing' };
  }

  for (const allocation of input.allocations) {
    if (hasConcreteShipmentEvidence(allocation)) {
      return { status: CUSTOMER_CHECKOUT_SHIPPING_REFUND_ELIGIBILITY.NOT_ELIGIBLE, reasonCode: 'shipment_or_fulfillment_evidence_exists' };
    }
    if (
      !PRE_SHIPMENT_FULFILLMENT_STATUSES.has(normalize(allocation.fulfillmentStatus)) ||
      !PRE_SHIPMENT_SHIPPING_STATUSES.has(normalize(allocation.shippingStatus))
    ) {
      return { status: CUSTOMER_CHECKOUT_SHIPPING_REFUND_ELIGIBILITY.UNRESOLVED, reasonCode: 'pre_shipment_state_unresolved' };
    }
    if (normalize(allocation.allocationStatus) !== 'vendor_blocked' || allocation.reassignmentRequired !== true) {
      return { status: CUSTOMER_CHECKOUT_SHIPPING_REFUND_ELIGIBILITY.NOT_ELIGIBLE, reasonCode: 'customer_fulfillment_allocation_remains' };
    }
  }

  return { status: CUSTOMER_CHECKOUT_SHIPPING_REFUND_ELIGIBILITY.ELIGIBLE, reasonCode: 'all_allocations_vendor_blocked_pre_shipment' };
}
