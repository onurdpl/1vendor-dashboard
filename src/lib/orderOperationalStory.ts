type OrderOperationalStoryInput = {
  allocationStatus?: string | null;
  cancellationReason?: string | null;
  reassignmentRequired?: boolean | null;
  fulfillmentStatus?: string | null;
  shippingStatus?: string | null;
  cancelRefundReviewStatus?: string | null;
  outboundRefundAttemptStatus?: string | null;
};

export type VendorBlockedOperationalStory = {
  isVendorBlocked: boolean;
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

export function getVendorBlockedOperationalStory(input: OrderOperationalStoryInput): VendorBlockedOperationalStory | null {
  if (normalizeToken(input.allocationStatus) !== 'vendor_blocked') {
    return null;
  }

  const reason = input.cancellationReason?.trim();

  return {
    isVendorBlocked: true,
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
