import { createHash } from 'node:crypto';
import { prisma } from '../../db/prisma.js';
import { CustomerCancellationStatus, FinanceEventType, OperationalJobStatus, type Prisma } from '@prisma/client';
import { createEventsIdempotently } from '../finance/finance-event.service.js';
import { normalizeRefundEvidence } from '../finance/refund-evidence-normalizer.service.js';
import {
  resolveCompleteSaleLineage,
  type CompleteSaleLineage,
} from '../finance/complete-sale-lineage.service.js';
import { evaluateCanonicalRefundLineAuthority } from '../finance/canonical-refund-line-authority.service.js';
import { assertResolvedEconomicOwnerForMoneyMovement } from '../finance/economic-owner-resolution.service.js';
import { CANCEL_REFUND_REVIEW_BLOCKING_STATUSES } from '../finance/cancel-refund-review-hold.service.js';
import { assertNoOpenFinanceIntegrityAlertForMoneyMovement } from '../finance/finance-integrity-alert.service.js';
import {
  calculateRefundOffsetAmounts,
  classifyPostApprovalRefundRisk,
  getUnsettledRefundOffsetEligibility,
} from '../finance/refund-offset.service.js';
import {
  buildLegacyRefundLedgerEntryId,
  buildRefundLedgerEntryId,
} from '../finance/refund-ledger-id.service.js';
import { createSettlementRefundAdjustmentForRefundLedger } from '../finance/settlement-refund-adjustment.service.js';
import { createVendorDebtForPaidRefund } from '../finance/vendor-balance.service.js';
import { OUTBOUND_SHOPIFY_REFUND_ATTEMPT_STATUSES } from '../orders/outbound-shopify-refund-attempt.service.js';
import {
  ORDER_SHIPPING_REFUND_CLAIM_STATUSES,
  releaseResolvedOrderShippingRefundClaimsForAllocation,
} from '../orders/order-shipping-refund-claim.service.js';
import { resolveAllocationForShopifyOrderLineItem } from '../orders/allocation-ownership-resolution.service.js';
import type {
  ParsedShopifyRefundLineItem,
  ParsedShopifyRefundPayload,
  RefundIngestionFailureResult,
  RefundIngestionInput,
  RefundIngestionResult,
  ShopifyRefundLineItemPayload,
  ShopifyRefundsCreateWebhookPayload,
} from './refund-ingestion.types.js';
import {
  REFUND_MONETARY_CLASSIFICATIONS,
  type CanonicalRefundEvidenceTransport,
  type CanonicalRefundItemMonetaryEvidence,
} from './shopify-refund-monetary-evidence.js';
import { synchronizeCanonicalShopifyOrderFinancialStatus } from './shopify-order-financial-status.service.js';
import { acquireShopifyOrderTransactionLock } from './orders-create-ownership.service.js';
import { classifyPersistedRefundFinanceEvidence } from './refund-persisted-finance-classifier.js';

const CANCEL_REFUND_REVIEW_RESOLVABLE_STATUS_SET = new Set<string>(CANCEL_REFUND_REVIEW_BLOCKING_STATUSES);

const TERMINAL_REFUND_CONFLICT_CATEGORIES = {
  evidenceHashMismatch: 'refund_evidence_hash_mismatch',
  evidenceVersionMismatch: 'refund_evidence_version_mismatch',
  normalizationVersionMismatch: 'refund_normalization_version_mismatch',
  multipleMismatch: 'refund_evidence_multiple_mismatch',
} as const;

function toDate(value: string | null | undefined) {
  if (!value) {
    return new Date();
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function toRefundLineItemTitle(lineItem: ShopifyRefundLineItemPayload['line_item']) {
  if (!lineItem) {
    return null;
  }

  const baseTitle = typeof lineItem.title === 'string'
    ? lineItem.title
    : typeof lineItem.name === 'string'
      ? lineItem.name
      : null;
  const variantTitle = typeof lineItem.variant_title === 'string' ? lineItem.variant_title : null;

  if (baseTitle && variantTitle) {
    return `${baseTitle} / ${variantTitle}`;
  }

  return baseTitle;
}

function readPostRefundFulfillmentCheckStatus(value: unknown) {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const mutationResponse = value as Record<string, unknown>;
  const postRefundFulfillmentCheck = mutationResponse.postRefundFulfillmentCheck;
  if (typeof postRefundFulfillmentCheck !== 'object' || postRefundFulfillmentCheck === null) {
    return null;
  }

  const status = (postRefundFulfillmentCheck as Record<string, unknown>).status;
  return typeof status === 'string' ? status.trim().toLowerCase() : null;
}

function hasBlockingPostRefundFulfillmentCheck(value: unknown) {
  const status = readPostRefundFulfillmentCheckStatus(value);
  return Boolean(status && status !== 'passed');
}

function normalizeMoneyAmount(value: unknown) {
  const parsed = typeof value === 'string' || typeof value === 'number' ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed.toFixed(2) : null;
}

function hasPositiveIntendedCustomerCancellationShippingRefund(value: unknown) {
  const firstLine = Array.isArray(value) ? value[0] : null;
  if (!firstLine || typeof firstLine !== 'object' || Array.isArray(firstLine)) return false;
  const intendedShipping = normalizeMoneyAmount(
    Reflect.get(firstLine, 'intendedShippingRefundAmount'),
  );
  return intendedShipping !== null && Number(intendedShipping) > 0;
}

function parseRefundPayload(payload: ShopifyRefundsCreateWebhookPayload): ParsedShopifyRefundPayload {
  const refundLineItems = Array.isArray(payload.refund_line_items) ? payload.refund_line_items : [];

  return {
    sourceShopifyRefundId: String(payload.id),
    sourceShopifyOrderId:
      payload.order_id !== undefined && payload.order_id !== null ? String(payload.order_id) : '',
    createdAt: toDate(payload.created_at),
    note: typeof payload.note === 'string' && payload.note.trim() ? payload.note.trim() : null,
    refundLineItems: refundLineItems.map<ParsedShopifyRefundLineItem>((lineItem, index) => ({
      sourceRefundLineItemId:
        lineItem.id !== undefined && lineItem.id !== null
          ? String(lineItem.id)
          : `refund-line-item-${index + 1}`,
      sourceLineItemId:
        lineItem.line_item?.id !== undefined && lineItem.line_item?.id !== null
          ? String(lineItem.line_item.id)
          : lineItem.line_item_id !== undefined && lineItem.line_item_id !== null
            ? String(lineItem.line_item_id)
            : null,
      sku: typeof lineItem.line_item?.sku === 'string' && lineItem.line_item.sku.trim()
        ? lineItem.line_item.sku
        : null,
      title: toRefundLineItemTitle(lineItem.line_item),
      quantity: typeof lineItem.quantity === 'number' && lineItem.quantity > 0 ? lineItem.quantity : 1,
      subtotal:
        lineItem.subtotal !== undefined && lineItem.subtotal !== null ? String(lineItem.subtotal) : null,
    })),
  };
}

function toAmountString(value: string | null, quantity: number) {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) {
    return '0.00';
  }

  return (numeric * quantity).toFixed(2);
}

function sumAmounts(values: string[]) {
  return values.reduce((sum, value) => {
    const numeric = Number(value);
    return sum + (Number.isFinite(numeric) ? numeric : 0);
  }, 0).toFixed(2);
}

function toNumber(value: unknown) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function toMinorUnits(value: number) {
  return Math.round(value * 100);
}

function buildRefundRecordId(input: {
  vendorId: string;
  sourceShopifyRefundId: string;
  vendorAllocationId: string;
}) {
  return `refund-${input.vendorId}-${input.sourceShopifyRefundId}-${input.vendorAllocationId}`;
}

function buildRefundReturnRecordId(input: {
  originalVendorId: string;
  sourceShopifyRefundId: string;
  vendorAllocationId: string;
}) {
  return `return-${input.originalVendorId}-${input.sourceShopifyRefundId}-${input.vendorAllocationId}`;
}

async function reconcileCustomerCancellationItemsFromVerifiedRefund(
  tx: Prisma.TransactionClient,
  input: {
    parsedRefund: ParsedShopifyRefundPayload;
    sourceShopifyRefundId: string;
    targetVendorAllocationId?: string;
  },
) {
  const quantitiesByLineItemId = new Map<string, number>();
  for (const line of input.parsedRefund.refundLineItems) {
    if (!line.sourceLineItemId) continue;
    quantitiesByLineItemId.set(line.sourceLineItemId, (quantitiesByLineItemId.get(line.sourceLineItemId) ?? 0) + line.quantity);
  }
  if (!quantitiesByLineItemId.size) return;
  const candidates = await tx.customerCancellationRequestItem.findMany({
    where: {
      status: CustomerCancellationStatus.APPROVED_FOR_REFUND,
      ...(input.targetVendorAllocationId
        ? { vendorAllocationId: input.targetVendorAllocationId }
        : {}),
      shopifyOrderLineItem: { sourceLineItemId: { in: [...quantitiesByLineItemId.keys()] } },
      outboundShopifyRefundAttempt: {
        status: OUTBOUND_SHOPIFY_REFUND_ATTEMPT_STATUSES.SHOPIFY_ACTION_PENDING,
        OR: [
          { shopifyRefundId: null },
          { shopifyRefundId: input.sourceShopifyRefundId },
          { shopifyRefundId: { endsWith: `/${input.sourceShopifyRefundId}` } },
        ],
      },
    },
    include: {
      shopifyOrderLineItem: { select: { sourceLineItemId: true } },
      outboundShopifyRefundAttempt: { select: { refundLineItemsJson: true } },
      request: { include: { items: { select: { id: true, status: true } } } },
    },
  });
  for (const item of candidates) {
    if (hasPositiveIntendedCustomerCancellationShippingRefund(item.outboundShopifyRefundAttempt?.refundLineItemsJson)) {
      continue;
    }
    const refundedQuantity = quantitiesByLineItemId.get(item.shopifyOrderLineItem.sourceLineItemId) ?? 0;
    if (refundedQuantity !== item.requestedQuantity) continue;
    await tx.customerCancellationRequestItem.update({
      where: { id: item.id },
      data: {
        status: CustomerCancellationStatus.REFUNDED_AWAITING_ORDER_CANCEL,
        resolvedQuantity: item.requestedQuantity,
      },
    });
    const statuses = item.request.items.map((candidate) =>
      candidate.id === item.id ? CustomerCancellationStatus.REFUNDED_AWAITING_ORDER_CANCEL : candidate.status,
    );
    const parentStatus = new Set(statuses).size === 1 ? statuses[0]! : CustomerCancellationStatus.PARTIALLY_RESOLVED;
    const allTerminal = statuses.every((status) =>
      status !== CustomerCancellationStatus.PENDING &&
      status !== CustomerCancellationStatus.APPROVED_FOR_REFUND &&
      status !== CustomerCancellationStatus.REFUNDED_AWAITING_ORDER_CANCEL &&
      status !== CustomerCancellationStatus.PARTIALLY_RESOLVED,
    );
    await tx.customerCancellationRequest.update({
      where: { id: item.requestId },
      data: { status: parentStatus, resolvedAt: allTerminal ? new Date() : null },
    });
    await tx.outboundShopifyRefundAttempt.updateMany({
      where: { customerCancellationRequestItemId: item.id },
      data: { status: OUTBOUND_SHOPIFY_REFUND_ATTEMPT_STATUSES.RESOLVED, resolvedAt: new Date(), shopifyRefundId: input.sourceShopifyRefundId },
    });
  }
}

async function resolveCancelRefundReviewAfterRefundIngestion(
  tx: Prisma.TransactionClient,
  input: {
    vendorAllocationId: string;
    cancelRefundReviewStatus: string | null;
    sourceShopifyRefundId: string;
    resolvedAt: Date;
  },
) {
  const normalizedReviewStatus = input.cancelRefundReviewStatus?.trim().toUpperCase() ?? '';
  const blockingPostCheckAttempt = await tx.outboundShopifyRefundAttempt.findFirst({
    where: {
      vendorAllocationId: input.vendorAllocationId,
      status: OUTBOUND_SHOPIFY_REFUND_ATTEMPT_STATUSES.SHOPIFY_ACTION_PENDING,
    },
    select: {
      mutationResponseJson: true,
    },
    orderBy: {
      requestedAt: 'desc',
    },
  });
  const shouldKeepReviewOpen = hasBlockingPostRefundFulfillmentCheck(blockingPostCheckAttempt?.mutationResponseJson);

  if (CANCEL_REFUND_REVIEW_RESOLVABLE_STATUS_SET.has(normalizedReviewStatus) && !shouldKeepReviewOpen) {
    await tx.vendorAllocation.updateMany({
      where: {
        id: input.vendorAllocationId,
        cancelRefundReviewStatus: {
          in: [...CANCEL_REFUND_REVIEW_BLOCKING_STATUSES],
        },
      },
      data: {
        cancelRefundReviewStatus: 'RESOLVED',
      },
    });
  }

  if (shouldKeepReviewOpen) {
    await tx.outboundShopifyRefundAttempt.updateMany({
      where: {
        vendorAllocationId: input.vendorAllocationId,
        status: OUTBOUND_SHOPIFY_REFUND_ATTEMPT_STATUSES.SHOPIFY_ACTION_PENDING,
      },
      data: {
        shopifyRefundId: input.sourceShopifyRefundId,
      },
    });
    return;
  }

  await tx.outboundShopifyRefundAttempt.updateMany({
    where: {
      vendorAllocationId: input.vendorAllocationId,
      status: {
        in: [
          OUTBOUND_SHOPIFY_REFUND_ATTEMPT_STATUSES.PREVIEWED,
          OUTBOUND_SHOPIFY_REFUND_ATTEMPT_STATUSES.SHOPIFY_ACTION_PENDING,
        ],
      },
    },
    data: {
      status: OUTBOUND_SHOPIFY_REFUND_ATTEMPT_STATUSES.RESOLVED,
      shopifyRefundId: input.sourceShopifyRefundId,
      resolvedAt: input.resolvedAt,
    },
  });
  await releaseResolvedOrderShippingRefundClaimsForAllocation(tx, {
    vendorAllocationId: input.vendorAllocationId,
    releasedAt: input.resolvedAt,
  });
}

type ResolvedRefundLineItem = ParsedShopifyRefundLineItem & {
  vendorId: string;
  originalVendorId: string;
  vendorAllocationId: string;
  activeSaleLedgerId: string;
  supersededSaleLedgerIds: readonly string[];
  shopifyOrderLineItemId: string;
  sourceShopifyOrderNumber: string;
  cancelRefundReviewStatus: string | null;
  refundAmount: string;
};

type RefundIngestionScope = Readonly<{
  targetVendorAllocationId?: string;
}>;

async function classifyPersistedRefundFinance(
  tx: Prisma.TransactionClient,
  input: {
    sourceShopifyRefundId: string;
    vendorAllocationId: string;
    expectedRefundLedgerId: string;
    legacyRefundLedgerId: string;
  },
) {
  const snapshot = await tx.refundEvidenceSnapshot.findUnique({
    where: {
      sourceShopifyRefundId_vendorAllocationId: {
        sourceShopifyRefundId: input.sourceShopifyRefundId,
        vendorAllocationId: input.vendorAllocationId,
      },
    },
  });
  if (snapshot) return { kind: 'snapshot' as const, snapshot };

  // Do not filter out voided/superseded rows: they are historical financial effects.
  const ledgers = await tx.financeLedgerEntry.findMany({
    where: {
      entryType: 'refund',
      OR: [
        { id: input.expectedRefundLedgerId },
        { id: input.legacyRefundLedgerId },
        { id: { contains: `-refund-${input.sourceShopifyRefundId}-` } },
      ],
    },
    select: { id: true, vendorAllocationId: true },
  });
  const refundRecord = await tx.refundRecord.findFirst({
    where: {
      vendorAllocationId: input.vendorAllocationId,
      sourceShopifyRefundId: input.sourceShopifyRefundId,
    },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  });
  const [adjustment, debtEvent, financeEvents] = await Promise.all([
    refundRecord
      ? tx.settlementRefundAdjustment.findFirst({
          where: { refundRecordId: refundRecord.id },
          select: { id: true },
        })
      : Promise.resolve(null),
    refundRecord
      ? tx.vendorBalanceEvent.findFirst({
          where: { refundRecordId: refundRecord.id, type: 'VENDOR_DEBT_CREATED' },
          select: { id: true },
        })
      : Promise.resolve(null),
    tx.financeEvent.findMany({
      where: { referenceType: 'shopify_refund', referenceId: input.sourceShopifyRefundId },
      select: {
        id: true,
        financeLedgerEntry: { select: { vendorAllocationId: true } },
        metadataJson: true,
      },
    }),
  ]);
  return classifyPersistedRefundFinanceEvidence({
    snapshot,
    ledgers,
    expectedRefundLedgerId: input.expectedRefundLedgerId,
    legacyRefundLedgerId: input.legacyRefundLedgerId,
    vendorAllocationId: input.vendorAllocationId,
    refundRecord,
    adjustment,
    debtEvent,
    financeEvents,
  });
}

function normalizeAllocationRefundEvidence(input: {
  canonicalEvidence: CanonicalRefundEvidenceTransport;
  vendorLineItems: readonly ResolvedRefundLineItem[];
  vendorAllocationId: string;
}) {
  const { canonicalEvidence, vendorLineItems } = input;
  if (!canonicalEvidence.refundTotalAmount || !canonicalEvidence.refundCurrency) {
    throw new Error('Canonical refund total and currency are required for accepted refund evidence.');
  }
  const activeSaleLedgerId = vendorLineItems[0]!.activeSaleLedgerId;
  const vendorId = vendorLineItems[0]!.vendorId;
  if (vendorLineItems.some((line) => line.activeSaleLedgerId !== activeSaleLedgerId || line.vendorId !== vendorId)) {
    throw new Error('Allocation refund lines have conflicting historical economic ownership.');
  }
  const refundLines = vendorLineItems.map((line) => {
    const matches = canonicalEvidence.lines.filter((candidate) =>
      candidate.sourceRefundLineItemId === line.sourceRefundLineItemId);
    if (matches.length !== 1 || !matches[0]!.sourceLineItemId ||
        matches[0]!.quantityProvenance !== 'OBSERVED_VALID' ||
        matches[0]!.subtotalAmountProvenance !== 'OBSERVED') {
      throw new Error(`Canonical refund line ${line.sourceRefundLineItemId} is not authoritative.`);
    }
    const canonicalLine = matches[0]!;
    return {
      sourceLineItemId: canonicalLine.sourceLineItemId!,
      quantity: canonicalLine.quantity!,
      subtotalAmount: canonicalLine.subtotalAmount!,
      currency: canonicalLine.subtotalCurrency,
    };
  });
  const transactions = canonicalEvidence.selectedTransactions.map((transaction) => {
    if (transaction.kind !== 'REFUND' || transaction.status !== 'SUCCESS') {
      throw new Error('Only selected canonical REFUND/SUCCESS transactions may enter refund evidence.');
    }
    return { ...transaction, kind: 'REFUND' as const, status: 'SUCCESS' as const };
  });
  return normalizeRefundEvidence({
    sourceShopifyRefundId: canonicalEvidence.sourceShopifyRefundId,
    sourceShopifyOrderId: canonicalEvidence.sourceShopifyOrderId,
    vendorAllocationId: input.vendorAllocationId,
    monetaryClassification: 'MONETARY_REFUND',
    refundTotalAmount: canonicalEvidence.refundTotalAmount,
    currency: canonicalEvidence.refundCurrency,
    transactions,
    refundLines,
    historicalEconomicVendorId: vendorId,
    historicalSaleFinanceLedgerEntryId: activeSaleLedgerId,
    supersededSaleLedgerIds: [...new Set(vendorLineItems.flatMap((line) => line.supersededSaleLedgerIds))],
  });
}

function classifyTerminalRefundEvidenceConflict(input: {
  storedEvidenceVersion: number;
  incomingEvidenceVersion: number;
  storedNormalizationVersion: number;
  incomingNormalizationVersion: number;
  storedEvidenceHash: string;
  incomingEvidenceHash: string;
}) {
  const evidenceHashMismatch = input.storedEvidenceHash !== input.incomingEvidenceHash;
  const evidenceVersionMismatch = input.storedEvidenceVersion !== input.incomingEvidenceVersion;
  const normalizationVersionMismatch =
    input.storedNormalizationVersion !== input.incomingNormalizationVersion;
  const mismatchCount = [evidenceHashMismatch, evidenceVersionMismatch, normalizationVersionMismatch]
    .filter(Boolean).length;
  const conflictCategory = mismatchCount > 1
    ? TERMINAL_REFUND_CONFLICT_CATEGORIES.multipleMismatch
    : evidenceHashMismatch
      ? TERMINAL_REFUND_CONFLICT_CATEGORIES.evidenceHashMismatch
      : evidenceVersionMismatch
        ? TERMINAL_REFUND_CONFLICT_CATEGORIES.evidenceVersionMismatch
        : TERMINAL_REFUND_CONFLICT_CATEGORIES.normalizationVersionMismatch;

  return {
    conflictCategory,
    conflictSummaryJson: {
      storedEvidenceVersion: input.storedEvidenceVersion,
      incomingEvidenceVersion: input.incomingEvidenceVersion,
      storedNormalizationVersion: input.storedNormalizationVersion,
      incomingNormalizationVersion: input.incomingNormalizationVersion,
      evidenceHashMismatch,
      evidenceVersionMismatch,
      normalizationVersionMismatch,
    },
  };
}

function buildTerminalRefundEvidenceReviewDedupeKey(input: {
  sourceShopifyRefundId: string;
  vendorAllocationId: string;
  storedEvidenceVersion: number;
  storedNormalizationVersion: number;
  storedEvidenceHash: string;
  incomingEvidenceVersion: number;
  incomingNormalizationVersion: number;
  incomingEvidenceHash: string;
}) {
  const fingerprint = JSON.stringify({
    sourceShopifyRefundId: input.sourceShopifyRefundId,
    vendorAllocationId: input.vendorAllocationId,
    storedEvidenceVersion: input.storedEvidenceVersion,
    storedNormalizationVersion: input.storedNormalizationVersion,
    storedEvidenceHash: input.storedEvidenceHash,
    incomingEvidenceVersion: input.incomingEvidenceVersion,
    incomingNormalizationVersion: input.incomingNormalizationVersion,
    incomingEvidenceHash: input.incomingEvidenceHash,
  });
  return createHash('sha256').update(fingerprint, 'utf8').digest('hex');
}

async function persistTerminalRefundEvidenceConflictReview(
  tx: Prisma.TransactionClient,
  input: {
    stored: {
      id: string;
      sourceShopifyRefundId: string;
      sourceShopifyOrderId: string;
      vendorAllocationId: string;
      refundRecordId: string;
      refundFinanceLedgerEntryId: string;
      historicalEconomicVendorId: string;
      evidenceHash: string;
      evidenceVersion: number;
      normalizationVersion: number;
    };
    incoming: ReturnType<typeof normalizeRefundEvidence>;
  },
) {
  const comparison = classifyTerminalRefundEvidenceConflict({
    storedEvidenceVersion: input.stored.evidenceVersion,
    incomingEvidenceVersion: input.incoming.evidenceVersion,
    storedNormalizationVersion: input.stored.normalizationVersion,
    incomingNormalizationVersion: input.incoming.normalizationVersion,
    storedEvidenceHash: input.stored.evidenceHash,
    incomingEvidenceHash: input.incoming.evidenceHash,
  });
  const dedupeKey = buildTerminalRefundEvidenceReviewDedupeKey({
    sourceShopifyRefundId: input.stored.sourceShopifyRefundId,
    vendorAllocationId: input.stored.vendorAllocationId,
    storedEvidenceVersion: input.stored.evidenceVersion,
    storedNormalizationVersion: input.stored.normalizationVersion,
    storedEvidenceHash: input.stored.evidenceHash,
    incomingEvidenceVersion: input.incoming.evidenceVersion,
    incomingNormalizationVersion: input.incoming.normalizationVersion,
    incomingEvidenceHash: input.incoming.evidenceHash,
  });
  const observedAt = new Date();
  const existing = await tx.refundTerminalEvidenceReview.findUnique({ where: { dedupeKey } });
  if (existing) {
    await tx.refundTerminalEvidenceReview.update({
      where: { dedupeKey },
      data: {
        occurrenceCount: { increment: 1 },
        lastObservedAt: observedAt,
      },
    });
    return;
  }

  const review = await tx.refundTerminalEvidenceReview.create({
    data: {
      sourceShopifyRefundId: input.stored.sourceShopifyRefundId,
      sourceShopifyOrderId: input.stored.sourceShopifyOrderId,
      vendorAllocationId: input.stored.vendorAllocationId,
      terminalRefundFinanceLedgerEntryId: input.stored.refundFinanceLedgerEntryId,
      refundRecordId: input.stored.refundRecordId,
      economicVendorId: input.stored.historicalEconomicVendorId,
      storedEvidenceSnapshotId: input.stored.id,
      dedupeKey,
      conflictCategory: comparison.conflictCategory,
      storedEvidenceHash: input.stored.evidenceHash,
      incomingEvidenceHash: input.incoming.evidenceHash,
      conflictSummaryJson: comparison.conflictSummaryJson,
      status: 'ACTIVE',
      firstObservedAt: observedAt,
      lastObservedAt: observedAt,
      occurrenceCount: 1,
    },
  });
  await tx.refundTerminalEvidenceReviewEvent.create({
    data: {
      reviewId: review.id,
      eventType: 'DETECTED',
    },
  });
}

function hasEmptySubmittedRefundLineItems(value: Prisma.JsonValue | null) {
  return Array.isArray(value) && value.length === 0;
}

function normalizeShopifyResourceId(value: string | null | undefined) {
  const normalized = value?.trim();
  if (!normalized) {
    return null;
  }
  if (!normalized.includes('/')) {
    return normalized;
  }
  const refundGidPrefix = 'gid://shopify/Refund/';
  return normalized.startsWith(refundGidPrefix) && normalized.length > refundGidPrefix.length
    ? normalized.slice(refundGidPrefix.length)
    : null;
}

async function reconcileVerifiedShippingOnlyRefund(
  tx: Prisma.TransactionClient,
  input: {
    sourceShopifyOrderId: string;
    sourceShopifyRefundId: string;
    resolvedAt: Date;
    targetVendorAllocationId?: string;
  },
) {
  const matchingClaims = await tx.orderShippingRefundClaim.findMany({
    where: {
      shopifyOrderId: input.sourceShopifyOrderId,
      ownerAttempt: {
        shopifyOrderId: input.sourceShopifyOrderId,
        refundShipping: true,
        OR: [
          { shopifyRefundId: input.sourceShopifyRefundId },
          { shopifyRefundId: { endsWith: `/${input.sourceShopifyRefundId}` } },
        ],
      },
    },
    select: {
      id: true,
      status: true,
      activeOrderKey: true,
      ownerAttempt: {
        select: {
          id: true,
          status: true,
          shopifyOrderId: true,
          shopifyRefundId: true,
          refundShipping: true,
          refundLineItemsJson: true,
          vendorAllocationId: true,
          vendorAllocation: {
            select: {
              cancelRefundReviewStatus: true,
              order: {
                select: {
                  sourceShopifyOrderId: true,
                },
              },
            },
          },
        },
      },
    },
    orderBy: {
      acquiredAt: 'desc',
    },
    take: 2,
  });

  if (matchingClaims.length !== 1) {
    throw new Error('Shipping-only refund could not be matched to one exact order shipping refund owner.');
  }

  const claim = matchingClaims[0];
  const attempt = claim.ownerAttempt;
  if (
    attempt.shopifyOrderId !== input.sourceShopifyOrderId ||
    attempt.vendorAllocation.order.sourceShopifyOrderId !== input.sourceShopifyOrderId ||
    normalizeShopifyResourceId(attempt.shopifyRefundId) !== normalizeShopifyResourceId(input.sourceShopifyRefundId) ||
    !attempt.refundShipping ||
    !hasEmptySubmittedRefundLineItems(attempt.refundLineItemsJson)
  ) {
    throw new Error('Shipping-only refund ownership evidence does not match the submitted refund attempt.');
  }

  if (
    input.targetVendorAllocationId &&
    attempt.vendorAllocationId !== input.targetVendorAllocationId
  ) {
    return {
      vendorAllocationId: attempt.vendorAllocationId,
      terminalStateChanged: false,
    };
  }

  const alreadyTerminal =
    attempt.status === OUTBOUND_SHOPIFY_REFUND_ATTEMPT_STATUSES.RESOLVED &&
    claim.status === ORDER_SHIPPING_REFUND_CLAIM_STATUSES.RELEASED &&
    claim.activeOrderKey === null;
  if (alreadyTerminal) {
    return { vendorAllocationId: attempt.vendorAllocationId, terminalStateChanged: false };
  }

  const activeOwner =
    attempt.status === OUTBOUND_SHOPIFY_REFUND_ATTEMPT_STATUSES.SHOPIFY_ACTION_PENDING &&
    claim.status === ORDER_SHIPPING_REFUND_CLAIM_STATUSES.ACTIVE &&
    claim.activeOrderKey === input.sourceShopifyOrderId;
  if (!activeOwner) {
    throw new Error('Shipping-only refund owner is not the active pending attempt for this Shopify order.');
  }

  const attemptResolution = await tx.outboundShopifyRefundAttempt.updateMany({
    where: {
      id: attempt.id,
      status: OUTBOUND_SHOPIFY_REFUND_ATTEMPT_STATUSES.SHOPIFY_ACTION_PENDING,
      shopifyOrderId: input.sourceShopifyOrderId,
      OR: [
        { shopifyRefundId: input.sourceShopifyRefundId },
        { shopifyRefundId: { endsWith: `/${input.sourceShopifyRefundId}` } },
      ],
      refundShipping: true,
    },
    data: {
      status: OUTBOUND_SHOPIFY_REFUND_ATTEMPT_STATUSES.RESOLVED,
      resolvedAt: input.resolvedAt,
    },
  });
  if (attemptResolution.count !== 1) {
    throw new Error('Shipping-only refund attempt changed before terminal reconciliation completed.');
  }

  const normalizedReviewStatus = attempt.vendorAllocation.cancelRefundReviewStatus?.trim().toUpperCase() ?? '';
  if (CANCEL_REFUND_REVIEW_RESOLVABLE_STATUS_SET.has(normalizedReviewStatus)) {
    await tx.vendorAllocation.updateMany({
      where: {
        id: attempt.vendorAllocationId,
        cancelRefundReviewStatus: {
          in: [...CANCEL_REFUND_REVIEW_BLOCKING_STATUSES],
        },
      },
      data: {
        cancelRefundReviewStatus: 'RESOLVED',
      },
    });
  }

  await releaseResolvedOrderShippingRefundClaimsForAllocation(tx, {
    vendorAllocationId: attempt.vendorAllocationId,
    releasedAt: input.resolvedAt,
  });
  return {
    vendorAllocationId: attempt.vendorAllocationId,
    terminalStateChanged: true,
  };
}

async function ingestShopifyRefundWebhookInternal(
  input: RefundIngestionInput,
  monetaryEvidence?: CanonicalRefundItemMonetaryEvidence,
  canonicalEvidence?: CanonicalRefundEvidenceTransport,
  canonicalFinancialStatus?: string | null,
  scope: RefundIngestionScope = {},
): Promise<RefundIngestionResult> {
  const parsedRefund = parseRefundPayload(input.payload);

  if (!parsedRefund.sourceShopifyOrderId) {
    if (input.event) {
      await prisma.webhookEvent.update({
        where: { id: input.event.id },
        data: {
          status: 'FAILED',
          errorMessage: 'Shopify refunds/create payload did not include an order id.',
        },
      });
    }

    return {
      ok: false,
      action: 'received_needs_attention',
      processingStatus: 'needs_attention',
      error: 'Shopify refunds/create payload did not include an order id.',
    };
  }

  if (
    parsedRefund.refundLineItems.length === 0 &&
    (
      monetaryEvidence?.sourceShopifyRefundId !== parsedRefund.sourceShopifyRefundId ||
      monetaryEvidence.classification !== REFUND_MONETARY_CLASSIFICATIONS.monetaryRefund ||
      !(Number(monetaryEvidence.monetaryRefundAmount) > 0)
    )
  ) {
    if (input.event) {
      await prisma.webhookEvent.update({
        where: { id: input.event.id },
        data: {
          status: 'FAILED',
          errorMessage: 'Shopify refunds/create payload did not include refund line items.',
        },
      });
    }

    return {
      ok: false,
      action: 'received_needs_attention',
      processingStatus: 'needs_attention',
      error: 'Shopify refunds/create payload did not include refund line items.',
    };
  }

  try {
    const applyRefund = async (tx: Prisma.TransactionClient) => {
      await acquireShopifyOrderTransactionLock(tx, parsedRefund.sourceShopifyOrderId);
      if (input.event) {
        await tx.webhookEvent.update({
          where: { id: input.event.id },
          data: {
            status: 'PROCESSING',
            errorMessage: null,
          },
        });
      }

      const shopifyOrder = await tx.shopifyOrder.findUnique({
        where: {
          sourceShopifyOrderId: parsedRefund.sourceShopifyOrderId,
        },
        include: {
          lineItems: true,
          allocations: true,
        },
      });

      if (!shopifyOrder) {
        throw new Error(`No ingested Shopify order found for refund order id ${parsedRefund.sourceShopifyOrderId}.`);
      }

      if (monetaryEvidence) {
        await synchronizeCanonicalShopifyOrderFinancialStatus({
          db: tx,
          shopifyOrder,
          canonicalFinancialStatus,
        });
      }

      if (parsedRefund.refundLineItems.length === 0) {
        const terminalization = await reconcileVerifiedShippingOnlyRefund(tx, {
          sourceShopifyOrderId: parsedRefund.sourceShopifyOrderId,
          sourceShopifyRefundId: parsedRefund.sourceShopifyRefundId,
          resolvedAt: new Date(),
          targetVendorAllocationId: scope.targetVendorAllocationId,
        });

        if (input.event) {
          await tx.webhookEvent.update({
            where: { id: input.event.id },
            data: {
              status: 'PROCESSED',
              processedAt: new Date(),
              errorMessage: null,
              shopifyOrderId: shopifyOrder.id,
            },
          });
        }

        return {
          shopifyOrderId: parsedRefund.sourceShopifyOrderId,
          refundAllocationCount: 0,
          reconciliationMode: 'shipping_only' as const,
          terminalStateChanged: terminalization.terminalStateChanged,
        };
      }

      const resolvedLineItems: ResolvedRefundLineItem[] = [];
      const completeSaleLineageByActiveLedgerId = new Map<string, CompleteSaleLineage>();
      for (const lineItem of parsedRefund.refundLineItems) {
        if (!lineItem.sku) {
          throw new Error(`Refund line item ${lineItem.sourceRefundLineItemId} is missing SKU and cannot be allocated.`);
        }

        const skuMatches = shopifyOrder.lineItems.filter((orderLineItem) => orderLineItem.sku === lineItem.sku);
        const matchedOrderLineItem = lineItem.sourceLineItemId
          ? skuMatches.find((orderLineItem) => orderLineItem.sourceLineItemId === lineItem.sourceLineItemId)
          : skuMatches.length === 1
            ? skuMatches[0]
            : null;

        if (!matchedOrderLineItem) {
          if (skuMatches.length > 1) {
            throw new Error(`Refund SKU ${lineItem.sku} matched multiple original order line items and could not be resolved safely.`);
          }

          throw new Error(`No original order mapping found for refund SKU ${lineItem.sku}.`);
        }

        const ownership = await resolveAllocationForShopifyOrderLineItem({
          shopifyOrderId: shopifyOrder.id,
          shopifyOrderLineItemId: matchedOrderLineItem.id,
          sourceLineItemId: matchedOrderLineItem.sourceLineItemId ?? lineItem.sourceLineItemId ?? null,
        }, tx);
        const vendorAllocation = ownership.allocation;
        const originalVendorId = vendorAllocation.originalVendorId;

        if (
          scope.targetVendorAllocationId &&
          vendorAllocation.id !== scope.targetVendorAllocationId
        ) {
          continue;
        }

        const economicOwner = await assertResolvedEconomicOwnerForMoneyMovement({
          vendorAllocationId: vendorAllocation.id,
          db: tx,
        });
        let completeSaleLineage = completeSaleLineageByActiveLedgerId.get(economicOwner.activeSaleLedgerId);
        if (!completeSaleLineage) {
          completeSaleLineage = await resolveCompleteSaleLineage({
            activeSaleFinanceLedgerEntryId: economicOwner.activeSaleLedgerId,
            db: tx,
          });
          completeSaleLineageByActiveLedgerId.set(economicOwner.activeSaleLedgerId, completeSaleLineage);
        }
        await assertNoOpenFinanceIntegrityAlertForMoneyMovement({
          vendorAllocationId: vendorAllocation.id,
        }, tx);

        resolvedLineItems.push({
          ...lineItem,
          vendorId: economicOwner.economicOwnerVendorId,
          originalVendorId,
          vendorAllocationId: vendorAllocation.id,
          activeSaleLedgerId: economicOwner.activeSaleLedgerId,
          supersededSaleLedgerIds: completeSaleLineage.supersededSaleLedgerIds,
          shopifyOrderLineItemId: ownership.shopifyOrderLineItem.id,
          sourceShopifyOrderNumber: vendorAllocation.sourceShopifyOrderNumber,
          cancelRefundReviewStatus: vendorAllocation.cancelRefundReviewStatus ?? null,
          refundAmount: toAmountString(lineItem.subtotal, lineItem.quantity),
        });
      }

      const shopifyRefund = await tx.shopifyRefund.upsert({
        where: {
          sourceShopifyRefundId: parsedRefund.sourceShopifyRefundId,
        },
        update: {
          shopifyOrderId: shopifyOrder.id,
          sourceShopifyOrderId: shopifyOrder.sourceShopifyOrderId,
          sourceShopifyOrderNumber: shopifyOrder.sourceShopifyOrderNumber,
          createdAt: parsedRefund.createdAt,
        },
        create: {
          sourceShopifyRefundId: parsedRefund.sourceShopifyRefundId,
          shopifyOrderId: shopifyOrder.id,
          sourceShopifyOrderId: shopifyOrder.sourceShopifyOrderId,
          sourceShopifyOrderNumber: shopifyOrder.sourceShopifyOrderNumber,
          createdAt: parsedRefund.createdAt,
        },
      });

      const groupedByAllocationAndVendor = new Map<string, typeof resolvedLineItems>();
      for (const lineItem of resolvedLineItems) {
        const groupKey = `${lineItem.vendorAllocationId}:${lineItem.vendorId}`;
        const group = groupedByAllocationAndVendor.get(groupKey) ?? [];
        group.push(lineItem);
        groupedByAllocationAndVendor.set(groupKey, group);
      }

      const reviewRequiredAllocations: Array<{
        vendorAllocationId: string;
        reason: string;
        reasonCode: NonNullable<RefundIngestionFailureResult['reasonCode']>;
      }> = [];
      for (const [, vendorLineItems] of groupedByAllocationAndVendor.entries()) {
        const vendorId = vendorLineItems[0].vendorId;
        const vendorAllocationId = vendorLineItems[0].vendorAllocationId;
        const expectedRefundLedgerId = buildRefundLedgerEntryId({
          vendorId,
          sourceShopifyRefundId: parsedRefund.sourceShopifyRefundId,
          vendorAllocationId,
        });
        const legacyRefundLedgerId = buildLegacyRefundLedgerEntryId({
          vendorId,
          sourceShopifyRefundId: parsedRefund.sourceShopifyRefundId,
        });
        const persistedFinance = await classifyPersistedRefundFinance(tx, {
          sourceShopifyRefundId: parsedRefund.sourceShopifyRefundId,
          vendorAllocationId,
          expectedRefundLedgerId,
          legacyRefundLedgerId,
        });
        if (persistedFinance.kind === 'historical_finance' || persistedFinance.kind === 'ambiguous_legacy') {
          reviewRequiredAllocations.push({
            vendorAllocationId,
            reason: persistedFinance.kind === 'historical_finance'
              ? 'historical refund finance has no accepted evidence snapshot'
              : 'legacy refund finance cannot be attributed to one allocation',
            reasonCode: 'refund_finance_review_required',
          });
          continue;
        }
        if (!canonicalEvidence) {
          reviewRequiredAllocations.push({
            vendorAllocationId,
            reason: 'verified canonical refund evidence is absent',
            reasonCode: 'refund_finance_review_required',
          });
          continue;
        }
        const authority = evaluateCanonicalRefundLineAuthority({
            sourceRefundLineItemIds: vendorLineItems.map((lineItem) => lineItem.sourceRefundLineItemId),
            canonicalLines: canonicalEvidence.lines,
        });
        if (!authority.authoritative) {
          reviewRequiredAllocations.push({
            vendorAllocationId,
            reason: authority.failures.map((failure) =>
              `${failure.sourceRefundLineItemId}:${failure.reasonCode}`).join(','),
            reasonCode: 'canonical_refund_line_evidence_incomplete',
          });
          continue;
        }
        let normalizedEvidence: ReturnType<typeof normalizeRefundEvidence>;
        try {
          normalizedEvidence = normalizeAllocationRefundEvidence({
            canonicalEvidence,
            vendorLineItems,
            vendorAllocationId,
          });
        } catch (error) {
          reviewRequiredAllocations.push({
            vendorAllocationId,
            reason: error instanceof Error ? error.message : 'canonical refund evidence could not be normalized',
            reasonCode: 'refund_finance_review_required',
          });
          continue;
        }
        if (persistedFinance.kind === 'snapshot') {
          const stored = persistedFinance.snapshot;
          if (stored.evidenceVersion === normalizedEvidence.evidenceVersion &&
              stored.normalizationVersion === normalizedEvidence.normalizationVersion &&
              stored.evidenceHash === normalizedEvidence.evidenceHash) {
            continue;
          }
          await persistTerminalRefundEvidenceConflictReview(tx, {
            stored,
            incoming: normalizedEvidence,
          });
          reviewRequiredAllocations.push({
            vendorAllocationId,
            reason: 'terminal refund evidence conflicts with accepted snapshot',
            reasonCode: 'refund_terminal_evidence_conflict',
          });
          continue;
        }
        const existingRefundRecord = persistedFinance.refundRecord;
        const refundRecordId = existingRefundRecord?.id ?? buildRefundRecordId({
          vendorId,
          sourceShopifyRefundId: parsedRefund.sourceShopifyRefundId,
          vendorAllocationId,
        });
        const totalRefundAmount = sumAmounts(vendorLineItems.map((lineItem) => lineItem.refundAmount));
        const orderNumber = vendorLineItems[0].sourceShopifyOrderNumber;
        const sourceLineItemIds = vendorLineItems
          .map((lineItem) => lineItem.sourceLineItemId)
          .filter((sourceLineItemId): sourceLineItemId is string => Boolean(sourceLineItemId));
        const linkedReturnRequest = sourceLineItemIds.length > 0
          ? await tx.returnRecord.findFirst({
              where: {
                vendorAllocationId,
                sourceShopifyOrderId: parsedRefund.sourceShopifyOrderId,
                returnRequestSource: 'shopify_return_request',
                sourceShopifyLineItemId: {
                  in: sourceLineItemIds,
                },
              },
              orderBy: {
                createdAt: 'desc',
              },
            })
          : null;
        const returnRecordOwnerId = vendorLineItems[0].originalVendorId;
        const existingRefundReturnRecord = linkedReturnRequest
          ? null
          : await tx.returnRecord.findFirst({
              where: {
                vendorAllocationId,
                sourceShopifyOrderId: parsedRefund.sourceShopifyOrderId,
                sourceShopifyRefundId: parsedRefund.sourceShopifyRefundId,
              },
              select: {
                id: true,
              },
              orderBy: {
                createdAt: 'desc',
              },
            });
        const returnRecordId = linkedReturnRequest?.id ?? existingRefundReturnRecord?.id ?? buildRefundReturnRecordId({
          originalVendorId: returnRecordOwnerId,
          sourceShopifyRefundId: parsedRefund.sourceShopifyRefundId,
          vendorAllocationId,
        });

        await tx.returnRecord.upsert({
          where: {
            id: returnRecordId,
          },
          update: {
            vendorAllocationId,
            sourceShopifyOrderId: parsedRefund.sourceShopifyOrderId,
            sourceShopifyOrderNumber: orderNumber,
            sourceShopifyRefundId: parsedRefund.sourceShopifyRefundId,
            status: 'processed',
            reason: parsedRefund.note ?? linkedReturnRequest?.reason ?? null,
          },
          create: {
            id: returnRecordId,
            vendorAllocationId,
            ownerVendorId: vendorId,
            sourceShopifyOrderId: parsedRefund.sourceShopifyOrderId,
            sourceShopifyOrderNumber: orderNumber,
            sourceShopifyRefundId: parsedRefund.sourceShopifyRefundId,
            status: 'processed',
            reason: parsedRefund.note,
          },
        });

        await tx.refundRecord.upsert({
          where: {
            id: refundRecordId,
          },
          update: {
            vendorAllocationId,
            sourceShopifyOrderId: parsedRefund.sourceShopifyOrderId,
            sourceShopifyOrderNumber: orderNumber,
            sourceShopifyRefundId: parsedRefund.sourceShopifyRefundId,
            amount: totalRefundAmount,
            status: 'processed',
          },
          create: {
            id: refundRecordId,
            vendorAllocationId,
            sourceShopifyOrderId: parsedRefund.sourceShopifyOrderId,
            sourceShopifyOrderNumber: orderNumber,
            sourceShopifyRefundId: parsedRefund.sourceShopifyRefundId,
            amount: totalRefundAmount,
            status: 'processed',
          },
        });

        for (const lineItem of vendorLineItems) {
          await tx.shopifyRefundLineItem.upsert({
            where: {
              shopifyRefundId_sourceRefundLineItemId: {
                shopifyRefundId: shopifyRefund.id,
                sourceRefundLineItemId: lineItem.sourceRefundLineItemId,
              },
            },
            update: {
              refundRecordId,
              shopifyOrderLineItemId: lineItem.shopifyOrderLineItemId,
              sourceLineItemId: lineItem.sourceLineItemId ?? lineItem.sourceRefundLineItemId,
              sku: lineItem.sku,
              title: lineItem.title,
              quantity: lineItem.quantity,
              subtotal: lineItem.refundAmount,
            },
            create: {
              shopifyRefundId: shopifyRefund.id,
              refundRecordId,
              shopifyOrderLineItemId: lineItem.shopifyOrderLineItemId,
              sourceRefundLineItemId: lineItem.sourceRefundLineItemId,
              sourceLineItemId: lineItem.sourceLineItemId ?? lineItem.sourceRefundLineItemId,
              sku: lineItem.sku,
              title: lineItem.title,
              quantity: lineItem.quantity,
              subtotal: lineItem.refundAmount,
            },
          });
        }

        const refundLedgerId = expectedRefundLedgerId;
        const saleLedgerEntry = await tx.financeLedgerEntry.findFirst({
          where: {
            id: vendorLineItems[0].activeSaleLedgerId,
            entryType: 'sale',
            voidedAt: null,
          },
          select: {
            id: true,
            entryType: true,
            payoutStatus: true,
            settlementStatus: true,
            commissionPercentSnapshot: true,
            commissionVatPercentSnapshot: true,
            payoutBatchLines: {
              where: {
                payoutBatch: {
                  status: {
                    in: ['DRAFT', 'REVIEW', 'APPROVED', 'EXECUTION_PENDING', 'PAID_PLACEHOLDER'],
                  },
                },
              },
              select: {
                payoutBatch: {
                  select: {
                    status: true,
                  },
                },
              },
            },
            settlementApprovalLines: {
              where: {
                settlementApproval: {
                  status: {
                    in: ['DRAFT', 'APPROVED'],
                  },
                },
              },
              select: {
                settlementApproval: {
                  select: {
                    id: true,
                    status: true,
                  },
                },
              },
            },
          },
        });
        if (!saleLedgerEntry) {
          throw new Error(
            `Active sale ledger ${vendorLineItems[0].activeSaleLedgerId} could not be loaded for allocation ${vendorAllocationId}.`,
          );
        }

        const refundOffsetEligibility = getUnsettledRefundOffsetEligibility({
          refundRecord: {
            id: refundRecordId,
            sourceShopifyRefundId: parsedRefund.sourceShopifyRefundId,
          },
          relatedSaleLedgerEntry: saleLedgerEntry,
        });
        const postApprovalRefundRisk = classifyPostApprovalRefundRisk({
          refundRecord: {
            id: refundRecordId,
            sourceShopifyRefundId: parsedRefund.sourceShopifyRefundId,
          },
          relatedSaleLedgerEntry: saleLedgerEntry,
        });
        const refundPayoutStatus = refundOffsetEligibility.eligible ? 'PENDING' : 'HOLD';
        const refundSettlementHoldReason = refundOffsetEligibility.eligible
          ? null
          : postApprovalRefundRisk.reason ?? refundOffsetEligibility.reason;

        await tx.financeLedgerEntry.create({
          data: {
            id: refundLedgerId,
            vendorAllocationId,
            vendorId,
            entryType: 'refund',
            amount: totalRefundAmount,
            payoutStatus: refundPayoutStatus,
            commissionPercentSnapshot: saleLedgerEntry?.commissionPercentSnapshot ?? null,
            commissionVatPercentSnapshot: saleLedgerEntry?.commissionVatPercentSnapshot ?? null,
            settlementStatus: 'PARTIALLY_REFUNDED',
            settlementHoldReason: refundSettlementHoldReason,
            description: `Refund allocation for Shopify refund ${parsedRefund.sourceShopifyRefundId}`,
          },
        });

        const capturedAt = new Date();
        await tx.refundEvidenceSnapshot.create({
          data: {
            sourceShopifyRefundId: normalizedEvidence.sourceShopifyRefundId,
            sourceShopifyOrderId: normalizedEvidence.sourceShopifyOrderId,
            vendorAllocationId: normalizedEvidence.vendorAllocationId,
            refundRecordId,
            refundFinanceLedgerEntryId: refundLedgerId,
            historicalEconomicVendorId: normalizedEvidence.historicalEconomicVendorId,
            historicalSaleFinanceLedgerEntryId: normalizedEvidence.historicalSaleFinanceLedgerEntryId,
            monetaryClassification: normalizedEvidence.monetaryClassification,
            refundTotalAmount: normalizedEvidence.refundTotalAmount,
            currency: normalizedEvidence.currency,
            normalizedTransactionsJson: normalizedEvidence.normalizedTransactionsJson,
            normalizedRefundLinesJson: normalizedEvidence.normalizedRefundLinesJson,
            normalizedOwnershipJson: normalizedEvidence.normalizedOwnershipJson,
            normalizedEvidenceJson: normalizedEvidence.normalizedEvidenceJson,
            supersededSaleLedgerIdsJson: normalizedEvidence.supersededSaleLedgerIdsJson,
            evidenceHash: normalizedEvidence.evidenceHash,
            hashAlgorithm: normalizedEvidence.hashAlgorithm,
            evidenceVersion: normalizedEvidence.evidenceVersion,
            normalizationVersion: normalizedEvidence.normalizationVersion,
            evidenceSource: canonicalEvidence.evidenceSource,
            capturedAt,
          },
        });

        if (postApprovalRefundRisk.state === 'already_paid_requires_vendor_debt') {
          await createVendorDebtForPaidRefund(tx, {
            vendorId,
            refundRecordId,
            sourceShopifyRefundId: parsedRefund.sourceShopifyRefundId,
            financeLedgerEntryId: refundLedgerId,
            refundAmount: totalRefundAmount,
            commissionPercentSnapshot: saleLedgerEntry?.commissionPercentSnapshot,
            commissionVatPercentSnapshot: saleLedgerEntry?.commissionVatPercentSnapshot,
            currency: shopifyOrder.currency ?? 'TRY',
            sourceShopifyOrderId: parsedRefund.sourceShopifyOrderId,
            sourceShopifyOrderNumber: orderNumber,
            vendorAllocationId,
          });
        } else {
          await createSettlementRefundAdjustmentForRefundLedger(tx, {
            refundFinanceLedgerEntryId: refundLedgerId,
            refundRecordId,
            createdBy: 'system:shopify_refunds_create',
          });
        }

        const refundOffset = calculateRefundOffsetAmounts({
          refundAmount: totalRefundAmount,
          commissionPercentSnapshot: saleLedgerEntry?.commissionPercentSnapshot,
          commissionVatPercentSnapshot: saleLedgerEntry?.commissionVatPercentSnapshot,
        });
        const baseEvent = {
          vendorId,
          shopifyOrderId: shopifyOrder.id,
          financeLedgerEntryId: refundLedgerId,
          currency: shopifyOrder.currency ?? 'TRY',
          referenceType: 'shopify_refund',
          referenceId: parsedRefund.sourceShopifyRefundId,
          createdBy: 'system:shopify_refunds_create',
          metadataJson: {
            sourceShopifyOrderId: parsedRefund.sourceShopifyOrderId,
            sourceShopifyOrderNumber: orderNumber,
            sourceShopifyRefundId: parsedRefund.sourceShopifyRefundId,
            vendorAllocationId,
            financeLedgerEntryId: refundLedgerId,
            commissionPercentSnapshot: refundOffset.commissionPercent,
            commissionVatPercentSnapshot: refundOffset.commissionVatPercent,
            commissionReversalMinor: refundOffset.commissionReversalMinor,
            commissionVatReversalMinor: refundOffset.commissionVatReversalMinor,
            vendorPayableReversalMinor: refundOffset.vendorPayableReversalMinor,
            refundOffsetEligibility: refundOffsetEligibility.code,
            postApprovalRefundRisk: postApprovalRefundRisk.state,
            originalVendorIds: [...new Set(vendorLineItems.map((lineItem) => lineItem.originalVendorId))],
            activeSaleLedgerId: vendorLineItems[0].activeSaleLedgerId,
            supersededFromLedgerIds: [
              ...new Set(vendorLineItems.flatMap((lineItem) => lineItem.supersededSaleLedgerIds)),
            ],
            sourceRefundLineItemIds: vendorLineItems.map((lineItem) => lineItem.sourceRefundLineItemId),
            sourceLineItemIds,
          },
        };

        const refundEvents = [
          {
            ...baseEvent,
            eventType: FinanceEventType.REFUND_RECORDED,
            amountMinor: refundOffset.refundMinor,
            idempotencyKey: `${refundLedgerId}:REFUND_RECORDED`,
          },
          {
            ...baseEvent,
            eventType: FinanceEventType.COMMISSION_REVERSED,
            amountMinor: -refundOffset.commissionReversalMinor,
            idempotencyKey: `${refundLedgerId}:COMMISSION_REVERSED`,
          },
          refundOffset.commissionVatReversalMinor > 0
            ? {
                ...baseEvent,
                eventType: FinanceEventType.COMMISSION_VAT_REVERSED,
                amountMinor: -refundOffset.commissionVatReversalMinor,
                idempotencyKey: `${refundLedgerId}:COMMISSION_VAT_REVERSED`,
              }
            : null,
          {
            ...baseEvent,
            eventType: FinanceEventType.VENDOR_PAYABLE_REVERSED,
            amountMinor: -refundOffset.vendorPayableReversalMinor,
            idempotencyKey: `${refundLedgerId}:VENDOR_PAYABLE_REVERSED`,
          },
        ].filter((event): event is NonNullable<typeof event> => Boolean(event));

        await createEventsIdempotently(refundEvents, tx);

        await resolveCancelRefundReviewAfterRefundIngestion(tx, {
          vendorAllocationId,
          cancelRefundReviewStatus: vendorLineItems[0].cancelRefundReviewStatus,
          sourceShopifyRefundId: parsedRefund.sourceShopifyRefundId,
          resolvedAt: new Date(),
        });
      }

      if (
        monetaryEvidence?.sourceShopifyRefundId === parsedRefund.sourceShopifyRefundId &&
        monetaryEvidence.classification === REFUND_MONETARY_CLASSIFICATIONS.monetaryRefund
      ) {
        await reconcileCustomerCancellationItemsFromVerifiedRefund(tx, {
          parsedRefund,
          sourceShopifyRefundId: parsedRefund.sourceShopifyRefundId,
          targetVendorAllocationId: scope.targetVendorAllocationId,
        });
      }

      if (reviewRequiredAllocations.length > 0) {
        const error = `Canonical refund evidence requires finance review: ${reviewRequiredAllocations
          .map(({ vendorAllocationId, reason }) => `${vendorAllocationId}[${reason}]`)
          .join(';')}.`;
        if (input.event) {
          await tx.webhookEvent.update({
            where: { id: input.event.id },
            data: {
              status: 'FAILED',
              errorMessage: error,
              shopifyOrderId: shopifyOrder.id,
            },
          });
        }
        return {
          shopifyOrderId: parsedRefund.sourceShopifyOrderId,
          refundAllocationCount: groupedByAllocationAndVendor.size - reviewRequiredAllocations.length,
          reviewRequiredError: error,
          reviewReasonCode: reviewRequiredAllocations.some(({ reasonCode }) =>
            reasonCode === 'refund_terminal_evidence_conflict')
            ? 'refund_terminal_evidence_conflict' as const
            : reviewRequiredAllocations.every(({ reasonCode }) =>
              reasonCode === 'canonical_refund_line_evidence_incomplete')
              ? 'canonical_refund_line_evidence_incomplete' as const
              : 'refund_finance_review_required' as const,
        };
      }

      if (input.event) {
        await tx.webhookEvent.update({
          where: { id: input.event.id },
          data: {
            status: 'PROCESSED',
            processedAt: new Date(),
            errorMessage: null,
            shopifyOrderId: shopifyOrder.id,
          },
        });
      }

      return {
        shopifyOrderId: parsedRefund.sourceShopifyOrderId,
        refundAllocationCount: groupedByAllocationAndVendor.size,
      };
    };
    const result = input.transactionClient
      ? await applyRefund(input.transactionClient)
      : await prisma.$transaction(applyRefund);

    if ('reviewRequiredError' in result && typeof result.reviewRequiredError === 'string') {
      return {
        ok: false,
        action: 'received_needs_attention',
        processingStatus: 'needs_attention',
        error: result.reviewRequiredError,
        reasonCode: result.reviewReasonCode,
        refundAllocationCount: result.refundAllocationCount,
      };
    }

    return {
      ok: true,
      action: 'accepted',
      processingStatus: 'processed',
      shopifyOrderId: result.shopifyOrderId,
      refundAllocationCount: result.refundAllocationCount,
      ...('reconciliationMode' in result
        ? {
            reconciliationMode: result.reconciliationMode,
            terminalStateChanged: result.terminalStateChanged,
          }
        : {}),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Shopify refund ingestion failed.';

    if (input.event) {
      await prisma.webhookEvent.update({
        where: { id: input.event.id },
        data: {
          status: 'FAILED',
          errorMessage: message,
        },
      });
    }

    return {
      ok: false,
      action: 'received_needs_attention',
      processingStatus: 'needs_attention',
      error: message,
    };
  }
}

export async function ingestShopifyRefundWebhook(input: RefundIngestionInput): Promise<RefundIngestionResult> {
  return ingestShopifyRefundWebhookInternal(input);
}

export async function ingestVerifiedShopifyRefund(
  input: RefundIngestionInput & {
    monetaryEvidence: CanonicalRefundItemMonetaryEvidence;
    canonicalEvidence: CanonicalRefundEvidenceTransport;
    canonicalFinancialStatus: string | null | undefined;
    targetVendorAllocationId?: string;
  },
): Promise<RefundIngestionResult> {
  const sourceShopifyRefundId = String(input.payload.id);
  if (
    input.monetaryEvidence.sourceShopifyRefundId !== sourceShopifyRefundId ||
    input.monetaryEvidence.classification !== REFUND_MONETARY_CLASSIFICATIONS.monetaryRefund
  ) {
    throw new Error('Verified positive Shopify monetary refund evidence is required before refund ingestion.');
  }

  const canonicalEvidence = input.canonicalEvidence;
  const hasMerchandiseLines = Array.isArray(input.payload.refund_line_items) && input.payload.refund_line_items.length > 0;
  if (!canonicalEvidence && hasMerchandiseLines) {
    throw new Error('Canonical Shopify refund evidence transport is required before verified refund ingestion.');
  }
  if (canonicalEvidence && (
    canonicalEvidence.sourceShopifyRefundId !== sourceShopifyRefundId ||
    canonicalEvidence.sourceShopifyOrderId !== String(input.payload.order_id ?? '') ||
    canonicalEvidence.monetaryClassification !== REFUND_MONETARY_CLASSIFICATIONS.monetaryRefund
  )) {
    throw new Error('Canonical Shopify refund evidence transport identity does not match verified refund ingestion.');
  }

  return ingestShopifyRefundWebhookInternal(
    input,
    input.monetaryEvidence,
    canonicalEvidence,
    input.canonicalFinancialStatus,
    { targetVendorAllocationId: input.targetVendorAllocationId },
  );
}
