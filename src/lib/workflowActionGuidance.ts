export type WorkflowActionTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'attention';

export type WorkflowActionGuidance = {
  actionLabel: string;
  description: string;
  tone: WorkflowActionTone;
};

export const workflowRoutes = {
  blockedAllocation: '/orders?workflow=blocked-allocation',
  awaitingShipment: '/orders?workflow=awaiting-shipment',
  staleFulfillment: '/orders?workflow=stale-fulfillment',
  trackingMissing: '/orders?workflow=tracking-missing',
  pendingReturnReview: '/returns?workflow=pending-review',
  settlementReview: '/finance?workflow=settlement-review',
  openSupportIssues: '/support?workflow=open-support-issues',
  activeAutomationIssueGroups: '/automation?workflow=active-issue-groups',
} as const;

function normalize(value: unknown) {
  return String(value ?? '').toLowerCase().replace(/[_-]+/g, ' ').trim();
}

function hasAny(text: string, terms: string[]) {
  return terms.some((term) => text.includes(term));
}

export function getDashboardWorkflowAction(label: string): WorkflowActionGuidance {
  const normalized = normalize(label);

  if (hasAny(normalized, ['stale fulfillment', 'awaiting shipment', 'shipment', 'fulfillment'])) {
    return {
      actionLabel: 'Create shipment',
      description: 'Open Orders and progress the affected shipment work.',
      tone: 'attention',
    };
  }

  if (normalized.includes('tracking')) {
    return {
      actionLabel: 'Sync tracking',
      description: 'Open Orders and verify provider tracking state.',
      tone: 'attention',
    };
  }

  if (hasAny(normalized, ['return', 'refund'])) {
    return {
      actionLabel: 'Review return',
      description: 'Open Returns and review the active return or refund item.',
      tone: 'attention',
    };
  }

  if (hasAny(normalized, ['settlement', 'finance', 'payout'])) {
    return {
      actionLabel: 'Review settlement',
      description: 'Open Finance and inspect pending settlement review rows.',
      tone: 'info',
    };
  }

  if (normalized.includes('support')) {
    return {
      actionLabel: 'Open linked support record',
      description: 'Open Support and continue the active conversation.',
      tone: 'warning',
    };
  }

  if (normalized.includes('automation')) {
    return {
      actionLabel: 'Review automation queue',
      description: 'Open Automation and inspect grouped active issues.',
      tone: 'warning',
    };
  }

  if (normalized.includes('blocked')) {
    return {
      actionLabel: 'Review allocation',
      description: 'Open Orders and resolve the blocked allocation state.',
      tone: 'warning',
    };
  }

  return {
    actionLabel: 'Review queue',
    description: 'Open the linked workspace and inspect the current item.',
    tone: 'info',
  };
}

export function getDashboardWorkflowRoute(label: string) {
  const normalized = normalize(label);

  if (normalized.includes('tracking')) {
    return workflowRoutes.trackingMissing;
  }
  if (normalized.includes('blocked')) {
    return workflowRoutes.blockedAllocation;
  }
  if (normalized.includes('stale fulfillment')) {
    return workflowRoutes.staleFulfillment;
  }
  if (hasAny(normalized, ['awaiting shipment', 'shipment', 'fulfillment'])) {
    return workflowRoutes.awaitingShipment;
  }
  if (hasAny(normalized, ['return', 'refund'])) {
    return workflowRoutes.pendingReturnReview;
  }
  if (hasAny(normalized, ['settlement', 'finance', 'payout'])) {
    return workflowRoutes.settlementReview;
  }
  if (normalized.includes('support')) {
    return workflowRoutes.openSupportIssues;
  }
  if (normalized.includes('automation')) {
    return workflowRoutes.activeAutomationIssueGroups;
  }

  return '/orders';
}

export function getOrderWorkflowAction(input: {
  shippingStatus?: string | null;
  fulfillmentStatus?: string | null;
  trackingNumber?: string | null;
  carrier?: string | null;
  hasShipment?: boolean;
  hasLabel?: boolean;
}): WorkflowActionGuidance {
  const shippingStatus = normalize(input.shippingStatus);
  const fulfillmentStatus = normalize(input.fulfillmentStatus);
  const trackingMissing = !input.trackingNumber && !input.carrier;

  if (!input.hasShipment && hasAny(shippingStatus, ['awaiting shipment', 'pending'])) {
    return {
      actionLabel: 'Create shipment',
      description: 'Use the shipment action to create the provider record and label.',
      tone: 'attention',
    };
  }

  if (trackingMissing && !hasAny(fulfillmentStatus, ['fulfilled', 'delivered'])) {
    return {
      actionLabel: 'Sync tracking',
      description: 'Verify provider tracking and sync it to Shopify when available.',
      tone: 'warning',
    };
  }

  if (input.hasShipment && !input.hasLabel) {
    return {
      actionLabel: 'Check label availability',
      description: 'Shipment exists; open provider evidence or retry only when safe.',
      tone: 'info',
    };
  }

  if (hasAny(fulfillmentStatus, ['fulfilled', 'delivered'])) {
    return {
      actionLabel: 'Monitor delivery evidence',
      description: 'Shipment workflow is fulfilled; keep timeline and tracking evidence current.',
      tone: 'success',
    };
  }

  return {
    actionLabel: 'Review shipment state',
    description: 'Inspect fulfillment, provider, and tracking context before acting.',
    tone: 'info',
  };
}

export function getReturnWorkflowAction(input: {
  status?: string | null;
  sourceType?: string | null;
  vendorReceivedAt?: string | null;
  vendorDecision?: string | null;
  refundStatus?: string | null;
}): WorkflowActionGuidance {
  const status = normalize(input.status);
  const refundStatus = normalize(input.refundStatus);
  const isPendingReturn =
    normalize(input.sourceType).includes('shopify return request') ||
    hasAny(status, ['requested', 'pending', 'review', 'awaiting']);

  if (isPendingReturn && !input.vendorReceivedAt) {
    return {
      actionLabel: 'Review return',
      description: 'Inspect returned items and mark receipt when the item arrives.',
      tone: 'attention',
    };
  }

  if (isPendingReturn && !input.vendorDecision) {
    return {
      actionLabel: 'Approve or reject return',
      description: 'Complete the vendor decision after inspection.',
      tone: 'warning',
    };
  }

  if (refundStatus.includes('pending')) {
    return {
      actionLabel: 'Monitor refund progress',
      description: 'Keep return evidence current while admin refund handling continues.',
      tone: 'info',
    };
  }

  return {
    actionLabel: 'Open return details',
    description: 'Review returned items, shipment evidence, and linked records.',
    tone: 'info',
  };
}

export function getFinanceWorkflowAction(input: {
  status?: string | null;
  settlementStatus?: string | null;
  payoutReady?: boolean | null;
  hasRefundImpact?: boolean;
  audience?: 'admin' | 'vendor';
}): WorkflowActionGuidance {
  const status = normalize(input.status);
  const settlementStatus = normalize(input.settlementStatus);
  const needsReview =
    input.payoutReady === true ||
    hasAny(status, ['pending', 'held', 'disputed', 'failed', 'blocked']) ||
    hasAny(settlementStatus, ['held', 'disputed', 'blocked']);

  if (needsReview) {
    return {
      actionLabel: 'Review settlement',
      description:
        input.audience === 'vendor'
          ? 'Review the settlement preview and linked order context.'
          : 'Inspect review state before draft preparation or reconciliation.',
      tone: 'warning',
    };
  }

  if (input.hasRefundImpact) {
    return {
      actionLabel: 'Review refund impact',
      description: 'Inspect refund deductions before treating the estimate as stable.',
      tone: 'attention',
    };
  }

  return {
    actionLabel: 'Review settlement estimate',
    description: 'Open the order settlement workspace for source context.',
    tone: 'info',
  };
}

export function getSupportWorkflowAction(hasOpenIssue: boolean): WorkflowActionGuidance {
  return hasOpenIssue
    ? {
        actionLabel: 'Open linked support record',
        description: 'Continue from the existing support ticket instead of creating a duplicate.',
        tone: 'warning',
      }
    : {
        actionLabel: 'Request support',
        description: 'Open a support request only if the operational record needs correction.',
        tone: 'info',
      };
}
