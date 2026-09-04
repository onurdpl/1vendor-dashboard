import type {
  CanonicalShopifyOrderSnapshot,
  FetchCanonicalShopifyOrderSnapshotResult,
  FetchCanonicalShopifyRefundsForOrderResult,
} from '../shopify/shopify-admin.types.js';
import {
  classifyCanonicalRefundMonetaryEvidence,
  REFUND_MONETARY_CLASSIFICATIONS,
} from '../shopify/shopify-refund-monetary-evidence.js';

export const ALLOCATION_FULL_REFUND_TERMINAL_RESULTS = {
  qualifies: 'QUALIFIES',
  doesNotQualify: 'DOES_NOT_QUALIFY',
  indeterminate: 'INDETERMINATE',
} as const;

export type AllocationFullRefundTerminalResultState =
  (typeof ALLOCATION_FULL_REFUND_TERMINAL_RESULTS)[keyof typeof ALLOCATION_FULL_REFUND_TERMINAL_RESULTS];

export type AllocationFullRefundTerminalEvidence = {
  schemaVersion: 1;
  orderLineItemsComplete: true;
  refundsListComplete: true;
  fulfillmentCollectionsComplete: true;
  refundEvidenceClassification: 'MONETARY_REFUND';
  refundEvidenceReasonCode: 'monetary_refund_verified';
  lines: Array<{
    vendorAllocationLineItemId: string;
    shopifyLineItemGid: string;
    ownedQuantity: number;
    successfullyRefundedQuantity: number;
    remainingFulfillableQuantity: number;
    refunds: Array<{
      shopifyRefundGid: string;
      classification: 'MONETARY_REFUND';
      reasonCode: 'monetary_refund_verified';
      refundLineItemsComplete: true;
      transactionsComplete: true;
      refundLineItems: Array<{
        shopifyRefundLineItemGid: string;
        refundedQuantity: number;
      }>;
      transactions: Array<{
        shopifyTransactionGid: string;
        kind: 'REFUND';
        status: 'SUCCESS';
      }>;
    }>;
    fulfillmentOrderLines: Array<{
      shopifyFulfillmentOrderGid: string;
      shopifyFulfillmentOrderStatus: string;
      shopifyFulfillmentOrderLineItemGid: string;
      remainingQuantity: number;
    }>;
  }>;
};

export type AllocationFullRefundTerminalVerifierResult =
  | {
      state: 'QUALIFIES';
      reasonCode: 'allocation_full_refund_terminal_verified';
      shopifyOrderGid: string;
      evidence: AllocationFullRefundTerminalEvidence;
    }
  | {
      state: 'DOES_NOT_QUALIFY';
      reasonCode:
        | 'refund_quantity_below_owned_quantity'
        | 'open_fulfillment_remaining_quantity_positive';
      evidence: null;
    }
  | {
      state: 'INDETERMINATE';
      reasonCode: string;
      evidence: null;
    };

export type AllocationForFullRefundTerminalVerification = {
  id: string;
  sourceShopifyOrderId: string;
  order: {
    id: string;
    sourceShopifyOrderId: string;
  } | null;
  lineItems: Array<{
    id: string;
    shopifyLineItemId: string;
    quantity: number;
    shopifyOrderLineItem: {
      id: string;
      sourceLineItemId: string;
    } | null;
  }>;
};

export type CanonicalCompleteness = {
  orderLineItemsComplete: boolean;
  fulfillmentOrderPaginationComplete: boolean;
  fulfillmentOrderLineItemPaginationComplete: boolean;
};

export type VerifyAllocationFullRefundTerminalInput = {
  allocation: AllocationForFullRefundTerminalVerification;
  orderSnapshot: CanonicalShopifyOrderSnapshot;
  refundCollection: NonNullable<FetchCanonicalShopifyRefundsForOrderResult>;
  completeness: CanonicalCompleteness;
};

export type AllocationFullRefundTerminalVerifierShopifySource = {
  fetchCanonicalOrderSnapshot(orderId: string): Promise<FetchCanonicalShopifyOrderSnapshotResult>;
  fetchCanonicalRefundsForOrder(orderId: string): Promise<FetchCanonicalShopifyRefundsForOrderResult>;
};

const SUPPORTED_FULFILLMENT_ORDER_STATUSES = new Set([
  'OPEN',
  'CLOSED',
  'CANCELLED',
  'CANCELED',
  'INCOMPLETE',
]);
const SUPPORTED_REFUND_TRANSACTION_KINDS = new Set(['REFUND', 'VOID']);
const SUPPORTED_REFUND_TRANSACTION_STATUSES = new Set([
  'SUCCESS',
  'PENDING',
  'FAILURE',
  'ERROR',
  'AWAITING_RESPONSE',
]);

function indeterminate(reasonCode: string): AllocationFullRefundTerminalVerifierResult {
  return { state: ALLOCATION_FULL_REFUND_TERMINAL_RESULTS.indeterminate, reasonCode, evidence: null };
}

function doesNotQualify(
  reasonCode: 'refund_quantity_below_owned_quantity' | 'open_fulfillment_remaining_quantity_positive',
): AllocationFullRefundTerminalVerifierResult {
  return { state: ALLOCATION_FULL_REFUND_TERMINAL_RESULTS.doesNotQualify, reasonCode, evidence: null };
}

function normalizeRequired(value: string | null | undefined) {
  const normalized = value?.trim() ?? '';
  return normalized || null;
}

function normalizeStatus(value: string | null | undefined) {
  return normalizeRequired(value)?.toUpperCase() ?? null;
}

function isPositiveInteger(value: number) {
  return Number.isInteger(value) && value > 0;
}

function isNonNegativeInteger(value: number | null) {
  return value !== null && Number.isInteger(value) && value >= 0;
}

export function verifyAllocationFullRefundTerminal(
  input: VerifyAllocationFullRefundTerminalInput,
): AllocationFullRefundTerminalVerifierResult {
  const { allocation, orderSnapshot, refundCollection, completeness } = input;
  const canonicalShopifyOrderId = normalizeRequired(allocation.order?.sourceShopifyOrderId);

  if (!canonicalShopifyOrderId) {
    return indeterminate('canonical_shopify_order_identity_missing');
  }

  if (!completeness.orderLineItemsComplete) {
    return indeterminate('canonical_order_line_items_incomplete');
  }
  if (
    !completeness.fulfillmentOrderPaginationComplete ||
    !completeness.fulfillmentOrderLineItemPaginationComplete
  ) {
    return indeterminate('canonical_fulfillment_collections_incomplete');
  }
  if (!refundCollection.refundsListComplete) {
    return indeterminate('canonical_refunds_list_incomplete');
  }
  if (
    canonicalShopifyOrderId !== orderSnapshot.sourceShopifyOrderId ||
    refundCollection.sourceShopifyOrderId !== orderSnapshot.sourceShopifyOrderId ||
    refundCollection.orderGid !== orderSnapshot.orderGid
  ) {
    return indeterminate('canonical_order_identity_mismatch');
  }
  if (allocation.lineItems.length === 0) {
    return indeterminate('allocation_line_items_missing');
  }

  const canonicalBySourceId = new Map<string, CanonicalShopifyOrderSnapshot['lineItems']>();
  const canonicalLineGids = new Set<string>();
  for (const canonicalLine of orderSnapshot.lineItems) {
    const sourceLineItemId = normalizeRequired(canonicalLine.sourceLineItemId);
    const lineItemGid = normalizeRequired(canonicalLine.lineItemGid);
    if (
      !sourceLineItemId ||
      !lineItemGid ||
      lineItemGid.split('/').at(-1) !== sourceLineItemId ||
      canonicalLineGids.has(lineItemGid)
    ) {
      return indeterminate('canonical_order_line_identity_missing');
    }
    canonicalLineGids.add(lineItemGid);
    const existing = canonicalBySourceId.get(sourceLineItemId) ?? [];
    existing.push(canonicalLine);
    canonicalBySourceId.set(sourceLineItemId, existing);
  }

  const resolvedAllocationLines: Array<{
    allocationLine: AllocationForFullRefundTerminalVerification['lineItems'][number];
    canonicalLine: CanonicalShopifyOrderSnapshot['lineItems'][number];
  }> = [];
  const claimedCanonicalGids = new Set<string>();
  const allocationLineIds = new Set<string>();

  for (const allocationLine of allocation.lineItems) {
    const allocationLineId = normalizeRequired(allocationLine.id);
    const localShopifyLineItemId = normalizeRequired(allocationLine.shopifyLineItemId);
    const relatedLineId = normalizeRequired(allocationLine.shopifyOrderLineItem?.id);
    const sourceLineItemId = normalizeRequired(allocationLine.shopifyOrderLineItem?.sourceLineItemId);
    if (
      !allocationLineId ||
      allocationLineIds.has(allocationLineId) ||
      !localShopifyLineItemId ||
      localShopifyLineItemId !== relatedLineId ||
      !sourceLineItemId
    ) {
      return indeterminate('allocation_line_identity_missing_or_ambiguous');
    }
    allocationLineIds.add(allocationLineId);
    if (!isPositiveInteger(allocationLine.quantity)) {
      return indeterminate('allocation_owned_quantity_invalid');
    }
    const canonicalMatches = canonicalBySourceId.get(sourceLineItemId) ?? [];
    if (canonicalMatches.length !== 1) {
      return indeterminate('canonical_order_line_identity_missing_or_ambiguous');
    }
    const canonicalLine = canonicalMatches[0];
    if (claimedCanonicalGids.has(canonicalLine.lineItemGid)) {
      return indeterminate('allocation_line_ownership_ambiguous');
    }
    claimedCanonicalGids.add(canonicalLine.lineItemGid);
    resolvedAllocationLines.push({ allocationLine, canonicalLine });
  }

  const seenRefundLineItemGids = new Set<string>();
  for (const refund of refundCollection.refunds) {
    const refundGid = normalizeRequired(refund.refundGid);
    const sourceShopifyRefundId = normalizeRequired(refund.sourceShopifyRefundId);
    if (
      !refundGid ||
      !sourceShopifyRefundId ||
      refundGid.split('/').at(-1) !== sourceShopifyRefundId
    ) {
      return indeterminate('canonical_refund_identity_missing_or_ambiguous');
    }
    if (!refund.lineItemPaginationComplete) {
      return indeterminate('canonical_refund_line_items_incomplete');
    }
    if (!refund.transactionPaginationComplete) {
      return indeterminate('canonical_refund_transactions_incomplete');
    }
    for (const transaction of refund.transactions) {
      const kind = normalizeStatus(transaction.kind);
      const status = normalizeStatus(transaction.status);
      if (
        !normalizeRequired(transaction.transactionGid) ||
        !kind ||
        !status ||
        !SUPPORTED_REFUND_TRANSACTION_KINDS.has(kind) ||
        !SUPPORTED_REFUND_TRANSACTION_STATUSES.has(status)
      ) {
        return indeterminate('canonical_refund_transaction_identity_or_state_unknown');
      }
    }
    for (const refundLine of refund.refundLineItems) {
      const refundLineItemGid = normalizeRequired(refundLine.refundLineItemGid);
      const lineItemGid = normalizeRequired(refundLine.lineItemGid);
      const sourceLineItemId = normalizeRequired(refundLine.sourceLineItemId);
      if (
        !refundLineItemGid ||
        !lineItemGid ||
        !sourceLineItemId ||
        lineItemGid.split('/').at(-1) !== sourceLineItemId
      ) {
        return indeterminate('canonical_refund_line_identity_missing');
      }
      if (seenRefundLineItemGids.has(refundLineItemGid)) {
        return indeterminate('canonical_refund_line_identity_ambiguous');
      }
      seenRefundLineItemGids.add(refundLineItemGid);
      if (!isPositiveInteger(refundLine.quantity)) {
        return indeterminate('canonical_refund_line_quantity_invalid');
      }
    }
  }

  if (refundCollection.refunds.length === 0) {
    return doesNotQualify('refund_quantity_below_owned_quantity');
  }

  const monetaryEvidence = classifyCanonicalRefundMonetaryEvidence(refundCollection);
  if (monetaryEvidence.classification === REFUND_MONETARY_CLASSIFICATIONS.zeroValueVoid) {
    return doesNotQualify('refund_quantity_below_owned_quantity');
  }
  if (
    monetaryEvidence.classification !== REFUND_MONETARY_CLASSIFICATIONS.monetaryRefund ||
    monetaryEvidence.reasonCode !== 'monetary_refund_verified'
  ) {
    return indeterminate(`canonical_monetary_evidence_${monetaryEvidence.reasonCode}`);
  }

  const monetaryRefundBySourceId = new Map(monetaryEvidence.refunds.map((refund) => [refund.sourceShopifyRefundId, refund]));
  if (monetaryRefundBySourceId.size !== monetaryEvidence.refunds.length) {
    return indeterminate('canonical_refund_identity_ambiguous');
  }

  for (const fulfillmentOrder of orderSnapshot.fulfillmentOrders) {
    const fulfillmentOrderId = normalizeRequired(fulfillmentOrder.id);
    const status = normalizeStatus(fulfillmentOrder.status);
    for (const fulfillmentLine of fulfillmentOrder.lineItems) {
      const fulfillmentLineId = normalizeRequired(fulfillmentLine.id);
      const lineItemId = normalizeRequired(fulfillmentLine.lineItemId);
      if (!fulfillmentLineId || !lineItemId) {
        return indeterminate('canonical_fulfillment_line_identity_missing');
      }
      if (!claimedCanonicalGids.has(lineItemId)) continue;
      if (!fulfillmentOrderId || !status || !SUPPORTED_FULFILLMENT_ORDER_STATUSES.has(status)) {
        return indeterminate('canonical_fulfillment_order_status_unknown');
      }
      if (status === 'OPEN' && !isNonNegativeInteger(fulfillmentLine.remainingQuantity)) {
        return indeterminate('canonical_open_fulfillment_remaining_quantity_unknown');
      }
    }
  }

  const evidenceLines: AllocationFullRefundTerminalEvidence['lines'] = [];
  for (const { allocationLine, canonicalLine } of resolvedAllocationLines) {
    const supportingRefunds: AllocationFullRefundTerminalEvidence['lines'][number]['refunds'] = [];
    let successfullyRefundedQuantity = 0;

    for (const refund of refundCollection.refunds) {
      const matchingRefundLines = refund.refundLineItems.filter(
        (refundLine) => refundLine.lineItemGid === canonicalLine.lineItemGid,
      );
      if (matchingRefundLines.length === 0) continue;

      const itemMonetaryEvidence = monetaryRefundBySourceId.get(refund.sourceShopifyRefundId);
      if (
        !itemMonetaryEvidence ||
        itemMonetaryEvidence.classification !== REFUND_MONETARY_CLASSIFICATIONS.monetaryRefund ||
        itemMonetaryEvidence.reasonCode !== 'monetary_refund_verified'
      ) {
        continue;
      }

      const successfulTransactions = new Map<string, {
        shopifyTransactionGid: string;
        kind: 'REFUND';
        status: 'SUCCESS';
      }>();
      for (const transaction of refund.transactions) {
        const transactionGid = normalizeRequired(transaction.transactionGid);
        const kind = normalizeStatus(transaction.kind);
        const status = normalizeStatus(transaction.status);
        if (!transactionGid || !kind || !status) {
          return indeterminate('canonical_refund_transaction_identity_or_state_unknown');
        }
        if (kind === 'REFUND' && status === 'SUCCESS') {
          successfulTransactions.set(transactionGid, {
            shopifyTransactionGid: transactionGid,
            kind: 'REFUND',
            status: 'SUCCESS',
          });
        }
      }
      if (successfulTransactions.size === 0) {
        return indeterminate('canonical_refund_success_transaction_missing');
      }

      const refundLineItems = matchingRefundLines.map((refundLine) => ({
        shopifyRefundLineItemGid: refundLine.refundLineItemGid,
        refundedQuantity: refundLine.quantity,
      }));
      successfullyRefundedQuantity += refundLineItems.reduce((sum, line) => sum + line.refundedQuantity, 0);
      supportingRefunds.push({
        shopifyRefundGid: refund.refundGid,
        classification: 'MONETARY_REFUND',
        reasonCode: 'monetary_refund_verified',
        refundLineItemsComplete: true,
        transactionsComplete: true,
        refundLineItems,
        transactions: [...successfulTransactions.values()],
      });
    }

    if (successfullyRefundedQuantity > allocationLine.quantity) {
      return indeterminate('canonical_refund_quantity_exceeds_owned_quantity');
    }
    if (successfullyRefundedQuantity < allocationLine.quantity) {
      return doesNotQualify('refund_quantity_below_owned_quantity');
    }

    const fulfillmentOrderLines: AllocationFullRefundTerminalEvidence['lines'][number]['fulfillmentOrderLines'] = [];
    let remainingFulfillableQuantity = 0;
    for (const fulfillmentOrder of orderSnapshot.fulfillmentOrders) {
      const status = normalizeStatus(fulfillmentOrder.status)!;
      if (status !== 'OPEN') continue;
      for (const fulfillmentLine of fulfillmentOrder.lineItems) {
        if (fulfillmentLine.lineItemId !== canonicalLine.lineItemGid) continue;
        const remainingQuantity = fulfillmentLine.remainingQuantity!;
        remainingFulfillableQuantity += remainingQuantity;
        fulfillmentOrderLines.push({
          shopifyFulfillmentOrderGid: fulfillmentOrder.id,
          shopifyFulfillmentOrderStatus: status,
          shopifyFulfillmentOrderLineItemGid: fulfillmentLine.id,
          remainingQuantity,
        });
      }
    }
    if (remainingFulfillableQuantity > 0) {
      return doesNotQualify('open_fulfillment_remaining_quantity_positive');
    }

    evidenceLines.push({
      vendorAllocationLineItemId: allocationLine.id,
      shopifyLineItemGid: canonicalLine.lineItemGid,
      ownedQuantity: allocationLine.quantity,
      successfullyRefundedQuantity,
      remainingFulfillableQuantity,
      refunds: supportingRefunds,
      fulfillmentOrderLines,
    });
  }

  return {
    state: ALLOCATION_FULL_REFUND_TERMINAL_RESULTS.qualifies,
    reasonCode: 'allocation_full_refund_terminal_verified',
    shopifyOrderGid: orderSnapshot.orderGid,
    evidence: {
      schemaVersion: 1,
      orderLineItemsComplete: true,
      refundsListComplete: true,
      fulfillmentCollectionsComplete: true,
      refundEvidenceClassification: 'MONETARY_REFUND',
      refundEvidenceReasonCode: 'monetary_refund_verified',
      lines: evidenceLines,
    },
  };
}

export function createAllocationFullRefundTerminalVerifier(input: {
  shopifyAdminService: AllocationFullRefundTerminalVerifierShopifySource;
}) {
  return {
    async verify(
      allocation: AllocationForFullRefundTerminalVerification,
    ): Promise<AllocationFullRefundTerminalVerifierResult> {
      const canonicalShopifyOrderId = normalizeRequired(allocation.order?.sourceShopifyOrderId);
      if (!canonicalShopifyOrderId) {
        return indeterminate('canonical_shopify_order_identity_missing');
      }

      try {
        const [orderSnapshot, refundCollection] = await Promise.all([
          input.shopifyAdminService.fetchCanonicalOrderSnapshot(canonicalShopifyOrderId),
          input.shopifyAdminService.fetchCanonicalRefundsForOrder(canonicalShopifyOrderId),
        ]);
        if (!orderSnapshot || !refundCollection) {
          return indeterminate('canonical_shopify_snapshot_unavailable');
        }
        return verifyAllocationFullRefundTerminal({
          allocation,
          orderSnapshot,
          refundCollection,
          completeness: {
            orderLineItemsComplete: true,
            fulfillmentOrderPaginationComplete: true,
            fulfillmentOrderLineItemPaginationComplete: true,
          },
        });
      } catch {
        return indeterminate('canonical_shopify_read_failed');
      }
    },
  };
}
