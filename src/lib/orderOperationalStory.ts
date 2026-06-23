type OrderOperationalStoryInput = {
  allocationStatus?: string | null;
  cancellationReason?: string | null;
  reassignmentRequired?: boolean | null;
  fulfillmentStatus?: string | null;
  shippingStatus?: string | null;
  cancelRefundReviewStatus?: string | null;
  outboundRefundAttemptStatus?: string | null;
  latestOutboundRefundAttemptStatus?: string | null;
  refundRecordCount?: number | null;
  refundedItems?: unknown[] | null;
  refundTotal?: string | null;
};

export type VendorBlockedOperationalStory = {
  isVendorBlocked: boolean;
  resolvedByRefund: boolean;
  primaryLabel: string;
  secondaryLabel: string;
  trackingLabel: string;
  trackingHelper: string;
  workflowCopy: string;
  fulfillmentLabel: string;
  shipmentLabel: string;
  financeLabel: string;
  nextAction: string;
  nextActionDescription: string;
  rejectUnavailableTitle: string;
  rejectUnavailableCopy: string;
  adminActionTitle: string;
  adminActionCopy: string;
  timelineEvents: Array<{ label: string; detail?: string }>;
  hideShipmentActions: boolean;
};

function normalizeToken(value: string | null | undefined) {
  return value?.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_') ?? '';
}

function parseAmount(value: string | null | undefined) {
  if (!value) {
    return 0;
  }
  const numeric = Number.parseFloat(value.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(numeric) ? numeric : 0;
}

export function isVendorBlockedResolvedByRefund(input: OrderOperationalStoryInput | null | undefined) {
  if (!input || normalizeToken(input.allocationStatus) !== 'vendor_blocked') {
    return false;
  }

  const reviewResolved = normalizeToken(input.cancelRefundReviewStatus) === 'resolved';
  if (!reviewResolved) {
    return false;
  }

  return Boolean(
    (input.refundRecordCount ?? 0) > 0 ||
      (input.refundedItems?.length ?? 0) > 0 ||
      normalizeToken(input.outboundRefundAttemptStatus) === 'resolved' ||
      normalizeToken(input.latestOutboundRefundAttemptStatus) === 'resolved' ||
      parseAmount(input.refundTotal) > 0,
  );
}

export function getVendorBlockedOperationalStory(input: OrderOperationalStoryInput): VendorBlockedOperationalStory | null {
  if (normalizeToken(input.allocationStatus) !== 'vendor_blocked') {
    return null;
  }

  const reason = input.cancellationReason?.trim();
  const resolvedByRefund = isVendorBlockedResolvedByRefund(input);

  if (resolvedByRefund) {
    return {
      isVendorBlocked: true,
      resolvedByRefund: true,
      primaryLabel: 'Refunded',
      secondaryLabel: 'Fulfillment not required',
      trackingLabel: 'Fulfillment not required',
      trackingHelper: 'Refund completed for this blocked allocation.',
      workflowCopy: 'Refund completed',
      fulfillmentLabel: 'Fulfillment not required',
      shipmentLabel: 'Unavailable',
      financeLabel: 'Refund completed',
      nextAction: 'No action required',
      nextActionDescription: 'Shopify refund is complete and fulfillment is no longer required for this allocation.',
      rejectUnavailableTitle: 'Reject unavailable',
      rejectUnavailableCopy: 'Vendor rejection was resolved by Shopify refund. No further rejection action is required.',
      adminActionTitle: 'Refund completed',
      adminActionCopy: 'Shopify refund processed. Fulfillment is not required.',
      timelineEvents: [
        {
          label: 'Vendor rejected allocation',
          detail: reason ? `Reason: ${reason}` : 'Vendor rejected allocation.',
        },
        {
          label: 'Refund processed',
          detail: 'Shopify refund webhook recorded refund finance.',
        },
        {
          label: 'Refund completed',
          detail: 'Cancel/refund review resolved.',
        },
        {
          label: 'Fulfillment not required',
          detail: 'Shipment work is closed for the refunded allocation.',
        },
      ],
      hideShipmentActions: true,
    };
  }

  return {
    isVendorBlocked: true,
    resolvedByRefund: false,
    primaryLabel: 'Vendor Blocked',
    secondaryLabel: 'Awaiting admin resolution',
    trackingLabel: 'Awaiting admin resolution',
    trackingHelper: 'Vendor rejected allocation.',
    workflowCopy: 'Awaiting admin resolution',
    fulfillmentLabel: 'Blocked',
    shipmentLabel: 'Unavailable',
    financeLabel: 'Held',
    nextAction: 'Review allocation',
    nextActionDescription: 'Open the order detail to inspect the blocked assignment and resolve vendor scope before shipment work.',
    rejectUnavailableTitle: 'Reject unavailable',
    rejectUnavailableCopy: 'Vendor rejection already submitted. This allocation is awaiting Sporgym admin review.',
    adminActionTitle: 'Admin action required',
    adminActionCopy: 'Awaiting admin resolution. Shopify not fulfilled.',
    timelineEvents: [
      {
        label: 'Vendor rejected allocation',
        detail: reason ? `Reason: ${reason}` : 'Vendor rejected allocation.',
      },
      {
        label: 'Awaiting admin resolution',
        detail: 'Transfer allocation, refund review, or return to vendor.',
      },
    ],
    hideShipmentActions: true,
  };
}
