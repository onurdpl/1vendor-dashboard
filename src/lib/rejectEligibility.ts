import type { OrderDetail, OrderSummary } from './api/contracts';
import { getOperationalStory, getVendorBlockedOperationalStory } from './orderOperationalStory';

type RejectableOrder = (OrderSummary | OrderDetail) & {
  shipmentExecution?: {
    shipmentStatus?: string | null;
  } | null;
};

export function getRejectUnavailableReason(order: RejectableOrder | null | undefined) {
  if (!order) {
    return 'This order is not eligible for rejection.';
  }
  const story = getOperationalStory(order);
  const vendorBlockedStory = getVendorBlockedOperationalStory(order);
  if (!story.actionVisibility.canReject && vendorBlockedStory) {
    return vendorBlockedStory.rejectUnavailableCopy;
  }
  if (story.state === 'refunded_completed') {
    return 'Refund completed. No further rejection action is required.';
  }
  if (story.state === 'shopify_order_cancelled' || story.state === 'shopify_order_cancelled_conflict') {
    return 'Cancelled orders cannot be rejected.';
  }
  if (order.allocationStatus !== 'active') {
    return 'This order is already blocked or no longer active.';
  }
  if (order.fulfillmentStatus === 'Fulfilled') {
    return 'This order cannot be rejected after fulfillment.';
  }
  if (order.shippingStatus !== 'Awaiting Shipment') {
    return 'This order cannot be rejected after shipping has started.';
  }
  if (order.trackingNumber) {
    return 'This order cannot be rejected after tracking has been added.';
  }
  if (order.carrier) {
    return 'This order cannot be rejected after a carrier has been assigned.';
  }

  const shipmentExecution = order.shipmentExecution;
  if (!shipmentExecution || shipmentExecution.shipmentStatus === 'failed' || shipmentExecution.shipmentStatus === 'cancelled') {
    return null;
  }

  return 'This order cannot be rejected because a shipment is already being processed.';
}

export function canRejectOrder(order: RejectableOrder | null | undefined) {
  return getRejectUnavailableReason(order) === null;
}

export function getRejectableLineItemCount(order: OrderSummary | OrderDetail | null | undefined) {
  return (
    (order as OrderDetail | null | undefined)?.lineItems?.length ??
    (order as OrderDetail | null | undefined)?.items?.length ??
    (order as OrderSummary & { lineItemCount?: number } | null | undefined)?.lineItemCount ??
    0
  );
}

export function canShowAllocationSplitRejectAction(order: RejectableOrder | null | undefined) {
  return canRejectOrder(order) && getRejectableLineItemCount(order) > 1;
}
