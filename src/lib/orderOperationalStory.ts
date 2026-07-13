type OrderOperationalStoryInput = {
  allocationStatus?: string | null;
  isCancelled?: boolean | null;
  isCancellationConflict?: boolean | null;
  cancelledAt?: string | null;
  cancelReason?: string | null;
  cancellationReason?: string | null;
  reassignmentRequired?: boolean | null;
  fulfillmentStatus?: string | null;
  shippingStatus?: string | null;
  trackingNumber?: string | null;
  carrier?: string | null;
  cancelRefundReviewStatus?: string | null;
  outboundRefundAttemptStatus?: string | null;
  latestOutboundRefundAttemptStatus?: string | null;
  hasResolvedRefundEvidence?: boolean | null;
  refundRecordCount?: number | null;
  refundedLineItems?: unknown[] | null;
  refundedItems?: unknown[] | null;
  refundTotal?: string | null;
  outboundRefundAttemptSummary?: {
    status?: string | null;
    resolvedAt?: string | null;
    shopifyRefundId?: string | null;
  } | null;
};

export type OperationalStoryState =
  | 'shopify_order_cancelled'
  | 'shopify_order_cancelled_conflict'
  | 'vendor_blocked_awaiting_admin_resolution'
  | 'vendor_blocked_resolved_by_refund'
  | 'refunded_completed'
  | 'active_or_unknown';

export type OperationalStory = {
  state: OperationalStoryState;
  resolvedByRefund: boolean;
  primaryLabel: string;
  secondaryLabel: string;
  fulfillmentLabel: string;
  shippingLabel: string;
  financeLabel: string;
  nextActionLabel: string;
  queueVisible: boolean;
  actionVisibility: {
    canCreateShipment: boolean;
    canReject: boolean;
    canTransfer: boolean;
    canPreviewRefund: boolean;
  };
  timelineEvents: Array<{
    label: string;
    detail?: string;
    at?: string;
    tone?: 'neutral' | 'warning' | 'success';
  }>;
};

export type VendorBlockedOperationalStory = OperationalStory & {
  isVendorBlocked: boolean;
  trackingLabel: string;
  trackingHelper: string;
  workflowCopy: string;
  shipmentLabel: string;
  nextAction: string;
  nextActionDescription: string;
  rejectUnavailableTitle: string;
  rejectUnavailableCopy: string;
  adminActionTitle: string;
  adminActionCopy: string;
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

function hasRefundEvidence(input: OrderOperationalStoryInput | null | undefined) {
  if (!input) {
    return false;
  }

  return Boolean(
    input.hasResolvedRefundEvidence ||
      (input.refundRecordCount ?? 0) > 0 ||
      (input.refundedLineItems?.length ?? 0) > 0 ||
      (input.refundedItems?.length ?? 0) > 0 ||
      normalizeToken(input.outboundRefundAttemptStatus) === 'resolved' ||
      normalizeToken(input.latestOutboundRefundAttemptStatus) === 'resolved' ||
      normalizeToken(input.outboundRefundAttemptSummary?.status) === 'resolved' ||
      Boolean(input.outboundRefundAttemptSummary?.resolvedAt) ||
      parseAmount(input.refundTotal) > 0,
  );
}

export function isVendorBlockedResolvedByRefund(input: OrderOperationalStoryInput | null | undefined) {
  if (!input || normalizeToken(input.allocationStatus) !== 'vendor_blocked') {
    return false;
  }

  const reviewResolved = normalizeToken(input.cancelRefundReviewStatus) === 'resolved';
  if (!reviewResolved) {
    return false;
  }

  return hasRefundEvidence(input);
}

// Operational story projection should be centralized here before adding page-specific state copy.
export function getOperationalStory(input: OrderOperationalStoryInput): OperationalStory {
  const reason = input.cancellationReason?.trim();
  const allocationStatus = normalizeToken(input.allocationStatus);
  const resolvedByRefund = isVendorBlockedResolvedByRefund(input);
  const isFullOrderCancelled = input.isCancelled === true || Boolean(input.cancelledAt);
  const cancellationConflict =
    input.isCancellationConflict === true ||
    (
      isFullOrderCancelled &&
      (
        hasRefundEvidence(input) ||
        ['fulfilled', 'partially_fulfilled'].includes(normalizeToken(input.fulfillmentStatus)) ||
        ['delivered', 'in_transit', 'label_created', 'shipped'].includes(normalizeToken(input.shippingStatus)) ||
        Boolean(input.trackingNumber?.trim()) ||
        Boolean(input.carrier?.trim())
      )
    );

  if (isFullOrderCancelled && cancellationConflict) {
    return {
      state: 'shopify_order_cancelled_conflict',
      resolvedByRefund: false,
      primaryLabel: 'Cancelled',
      secondaryLabel: 'Review existing fulfillment evidence',
      fulfillmentLabel: input.fulfillmentStatus?.trim() || 'Review required',
      shippingLabel: input.shippingStatus?.trim() || 'Review required',
      financeLabel: 'Review required',
      nextActionLabel: 'Review cancellation',
      queueVisible: false,
      actionVisibility: {
        canCreateShipment: false,
        canReject: false,
        canTransfer: false,
        canPreviewRefund: false,
      },
      timelineEvents: [
        {
          label: 'Shopify order cancelled',
          detail: input.cancelReason ? `Reason: ${input.cancelReason}.` : 'Shopify confirmed full order cancellation.',
          at: input.cancelledAt ?? undefined,
          tone: 'warning',
        },
        {
          label: 'Existing operational evidence',
          detail: 'Local fulfillment, shipment, refund, or return evidence was preserved for review.',
          tone: 'warning',
        },
      ],
    };
  }

  if (isFullOrderCancelled) {
    return {
      state: 'shopify_order_cancelled',
      resolvedByRefund: false,
      primaryLabel: 'Cancelled',
      secondaryLabel: 'Fulfillment not required',
      fulfillmentLabel: 'Fulfillment not required',
      shippingLabel: 'Shipment not required',
      financeLabel: 'Sale voided',
      nextActionLabel: 'No action required',
      queueVisible: false,
      actionVisibility: {
        canCreateShipment: false,
        canReject: false,
        canTransfer: false,
        canPreviewRefund: false,
      },
      timelineEvents: [
        {
          label: 'Shopify order cancelled',
          detail: input.cancelReason ? `Reason: ${input.cancelReason}.` : 'Shopify confirmed full order cancellation.',
          at: input.cancelledAt ?? undefined,
          tone: 'neutral',
        },
        {
          label: 'Fulfillment not required',
          detail: 'Shipment and tracking work are closed for this order.',
          tone: 'success',
        },
      ],
    };
  }

  if (resolvedByRefund) {
    return {
      state: 'vendor_blocked_resolved_by_refund',
      resolvedByRefund: true,
      primaryLabel: 'Refunded',
      secondaryLabel: 'Fulfillment not required',
      fulfillmentLabel: 'Fulfillment not required',
      shippingLabel: 'Unavailable',
      financeLabel: 'Refund completed',
      nextActionLabel: 'No action required',
      queueVisible: false,
      actionVisibility: {
        canCreateShipment: false,
        canReject: false,
        canTransfer: false,
        canPreviewRefund: false,
      },
      timelineEvents: [
        {
          label: 'Vendor rejected allocation',
          detail: reason ? `Reason: ${reason}.` : 'Vendor rejected allocation.',
          tone: 'warning',
        },
        {
          label: 'Refund processed',
          detail: 'Shopify refund webhook recorded refund finance.',
          tone: 'success',
        },
        {
          label: 'Refund completed',
          detail: 'Cancel/refund review resolved.',
          tone: 'success',
        },
        {
          label: 'Fulfillment not required',
          detail: 'Shipment work is closed for the refunded allocation.',
          tone: 'success',
        },
      ],
    };
  }

  if (allocationStatus === 'vendor_blocked') {
    return {
      state: 'vendor_blocked_awaiting_admin_resolution',
      resolvedByRefund: false,
      primaryLabel: 'Vendor Blocked',
      secondaryLabel: 'Awaiting admin resolution',
      fulfillmentLabel: 'Blocked',
      shippingLabel: 'Unavailable',
      financeLabel: 'Held',
      nextActionLabel: 'Review allocation',
      queueVisible: true,
      actionVisibility: {
        canCreateShipment: false,
        canReject: false,
        canTransfer: true,
        canPreviewRefund: true,
      },
      timelineEvents: [
        {
          label: 'Vendor rejected allocation',
          detail: reason ? `Reason: ${reason}.` : 'Vendor rejected allocation.',
          tone: 'warning',
        },
        {
          label: 'Vendor blocked',
          detail: 'Fulfillment is blocked for this allocation.',
          tone: 'warning',
        },
        {
          label: 'Finance hold activated',
          detail: 'Settlement and payout movement are held until admin resolution.',
          tone: 'warning',
        },
        {
          label: 'Awaiting admin resolution',
          detail: 'Transfer allocation, refund review, or return to vendor.',
          tone: 'warning',
        },
      ],
    };
  }

  if (
    allocationStatus === 'refunded' ||
    allocationStatus === 'refund_completed' ||
    normalizeToken(input.fulfillmentStatus) === 'refunded' ||
    input.hasResolvedRefundEvidence === true
  ) {
    return {
      state: 'refunded_completed',
      resolvedByRefund: true,
      primaryLabel: 'Refunded',
      secondaryLabel: 'Fulfillment not required',
      fulfillmentLabel: 'Fulfillment not required',
      shippingLabel: 'Unavailable',
      financeLabel: 'Refund completed',
      nextActionLabel: 'No action required',
      queueVisible: false,
      actionVisibility: {
        canCreateShipment: false,
        canReject: false,
        canTransfer: false,
        canPreviewRefund: false,
      },
      timelineEvents: [
        {
          label: 'Refund completed',
          detail: 'Shopify refund is complete.',
          tone: 'success',
        },
        {
          label: 'Fulfillment not required',
          detail: 'Shipment work is closed for the refunded allocation.',
          tone: 'success',
        },
      ],
    };
  }

  return {
    state: 'active_or_unknown',
    resolvedByRefund: false,
    primaryLabel: input.allocationStatus?.trim() || 'Active',
    secondaryLabel: input.shippingStatus?.trim() || 'In flow',
    fulfillmentLabel: input.fulfillmentStatus?.trim() || 'Pending',
    shippingLabel: input.shippingStatus?.trim() || 'Awaiting shipment',
    financeLabel: 'In flow',
    nextActionLabel: 'Continue fulfillment',
    queueVisible: false,
    actionVisibility: {
      canCreateShipment: true,
      canReject: true,
      canTransfer: false,
      canPreviewRefund: false,
    },
    timelineEvents: [],
  };
}

export function getVendorBlockedOperationalStory(input: OrderOperationalStoryInput): VendorBlockedOperationalStory | null {
  const story = getOperationalStory(input);
  if (story.state !== 'vendor_blocked_awaiting_admin_resolution' && story.state !== 'vendor_blocked_resolved_by_refund') {
    return null;
  }

  if (story.state === 'vendor_blocked_resolved_by_refund') {
    return {
      ...story,
      isVendorBlocked: true,
      trackingLabel: story.fulfillmentLabel,
      trackingHelper: 'Refund completed for this blocked allocation.',
      workflowCopy: 'Refund completed',
      shipmentLabel: story.shippingLabel,
      nextAction: story.nextActionLabel,
      nextActionDescription: 'Shopify refund is complete and fulfillment is no longer required for this allocation.',
      rejectUnavailableTitle: 'Reject unavailable',
      rejectUnavailableCopy: 'Vendor rejection was resolved by Shopify refund. No further rejection action is required.',
      adminActionTitle: 'Refund completed',
      adminActionCopy: 'Shopify refund processed. Fulfillment is not required.',
      hideShipmentActions: !story.actionVisibility.canCreateShipment,
    };
  }

  return {
    ...story,
    isVendorBlocked: true,
    trackingLabel: story.secondaryLabel,
    trackingHelper: 'Vendor rejected allocation.',
    workflowCopy: story.secondaryLabel,
    shipmentLabel: story.shippingLabel,
    nextAction: story.nextActionLabel,
    nextActionDescription: 'Open the order detail to inspect the blocked assignment and resolve vendor scope before shipment work.',
    rejectUnavailableTitle: 'Reject unavailable',
    rejectUnavailableCopy: 'Vendor rejection already submitted. This allocation is awaiting Sporgym admin review.',
    adminActionTitle: 'Admin action required',
    adminActionCopy: 'Awaiting admin resolution. Shopify not fulfilled.',
    hideShipmentActions: !story.actionVisibility.canCreateShipment,
  };
}
