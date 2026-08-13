import {
  OperationalSignalSeverity,
  OperationalSignalSourceArea,
  OperationalSignalStatus,
  Prisma,
} from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import type { AppEnv } from '../../config/env.js';
import { buildSaleLedgerEntryId, upsertSaleLedgerForAllocation } from '../finance/sale-ledger.service.js';
import { createShopifyAdminService } from '../shopify/shopify-admin.service.js';
import type {
  CanonicalShopifyOrderLineItemSnapshot,
  CanonicalShopifyOrderSnapshot,
  ShopifyOrderFulfillment,
  ShopifyOrderFulfillmentState,
} from '../shopify/shopify-admin.types.js';
import { normalizeCanonicalShopifyOrderFinancialStatus } from '../shopify/shopify-order-financial-status.service.js';
import type {
  OrderReconciliationResult,
  ReconciliationAllocationResult,
  ReconciliationFieldChange,
} from './reconciliation.types.js';
import {
  classifyPostApprovalRefundRisk,
  getUnsettledRefundOffsetEligibility,
} from '../finance/refund-offset.service.js';
import {
  buildLegacyRefundLedgerEntryId,
  buildRefundLedgerEntryId,
  matchesRefundLedgerSource,
} from '../finance/refund-ledger-id.service.js';
import { createVendorDebtForPaidRefund } from '../finance/vendor-balance.service.js';
import { isLedgerVoided } from '../finance/active-ledger-policy.service.js';
import {
  classifySaleLedgerRepairReadiness,
  isTransferRepairBlocked,
  repairBlockerMessage,
  resolveActiveEconomicOwnerForRepair,
} from './reconciliation-transfer-policy.service.js';

function extractShopifyGidTail(gid: string) {
  const tail = gid.split('/').at(-1)?.trim() ?? '';
  return tail || null;
}

function normalizeLineItemId(value: string) {
  return extractShopifyGidTail(value) ?? value;
}

function buildExpectedSaleLedgerIdForReconciliation(input: {
  assignedVendorId: string;
  sourceShopifyOrderId: string;
  vendorAllocationId: string;
}) {
  return buildSaleLedgerEntryId(input.assignedVendorId, input.sourceShopifyOrderId, input.vendorAllocationId);
}

function buildExpectedRefundLedgerIdForReconciliation(input: {
  vendorId: string;
  sourceShopifyRefundId: string;
  vendorAllocationId: string;
}) {
  return buildRefundLedgerEntryId(input);
}

const CANONICAL_FULFILLMENT_MATCH_MISSING_RULE_KEY = 'canonical_fulfillment_match_missing';
const CANONICAL_FULFILLMENT_MATCH_MISSING_MESSAGE =
  'Canonical fulfillment line could not be matched. Local state preserved. Manual review recommended.';
const CANONICAL_ORDER_SIGNAL_RULE_KEYS = {
  snapshotStale: 'canonical_order_snapshot_stale',
  missingLocalRecord: 'canonical_order_missing_local_record',
  lineItemMismatch: 'canonical_order_line_item_mismatch',
  requiresManualReview: 'canonical_order_requires_manual_review',
  operationalConflict: 'canonical_order_conflicts_with_operational_state',
} as const;

type CanonicalOrderSignalRuleKey =
  (typeof CANONICAL_ORDER_SIGNAL_RULE_KEYS)[keyof typeof CANONICAL_ORDER_SIGNAL_RULE_KEYS];

function sanitizeSignalPart(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unknown';
}

function normalizeVendorSlug(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase() ?? '';
  return normalized || null;
}

function buildCanonicalOrderSignalId(ruleKey: CanonicalOrderSignalRuleKey, sourceShopifyOrderId: string) {
  return `signal-${sanitizeSignalPart(ruleKey)}-${sanitizeSignalPart(sourceShopifyOrderId)}`;
}

function buildCanonicalFulfillmentMatchMissingSignalId(allocationId: string) {
  return `signal-${sanitizeSignalPart(CANONICAL_FULFILLMENT_MATCH_MISSING_RULE_KEY)}-${sanitizeSignalPart(allocationId)}`;
}

function isCancelledStatus(value: string | null | undefined) {
  return (value ?? '').trim().toLowerCase() === 'cancelled' || (value ?? '').trim().toLowerCase() === 'canceled';
}

function normalizeFulfillmentEventStatus(status: string) {
  const normalized = status.trim().toLowerCase();
  if (normalized === 'delivered') {
    return 'delivered';
  }
  if (normalized === 'in_transit' || normalized === 'out_for_delivery' || normalized === 'confirmed') {
    return 'in_transit';
  }
  if (normalized === 'failure' || normalized === 'failed' || normalized === 'attempted_delivery') {
    return 'fulfillment_event_attention';
  }
  return null;
}

function toDate(value: string | null) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toIso(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

function latestDate(values: Array<Date | null>) {
  return values
    .filter((value): value is Date => Boolean(value))
    .sort((left, right) => right.getTime() - left.getTime())[0] ?? null;
}

function getTrackingInfo(fulfillment: ShopifyOrderFulfillment) {
  return fulfillment.trackingInfo.find((tracking) => tracking.number || tracking.company || tracking.url) ?? null;
}

function getLatestFulfillmentEvent(fulfillment: ShopifyOrderFulfillment) {
  return [...fulfillment.events]
    .filter((event) => event.status || event.happenedAt)
    .sort((a, b) => {
      const left = a.happenedAt ? new Date(a.happenedAt).getTime() : 0;
      const right = b.happenedAt ? new Date(b.happenedAt).getTime() : 0;
      return right - left;
    })[0] ?? null;
}

function getCanonicalEventStatus(fulfillment: ShopifyOrderFulfillment) {
  const latestEvent = getLatestFulfillmentEvent(fulfillment);
  return normalizeFulfillmentEventStatus((latestEvent?.status ?? '').toLowerCase());
}

function hasLocalFulfillmentEvidence(input: {
  fulfillmentStatus: string | null;
  shippingStatus: string | null;
  trackingNumber?: string | null;
  carrier?: string | null;
  fulfillment?: {
    trackingUrl?: string | null;
    shopifyFulfillmentId?: string | null;
    fulfilledAt?: Date | null;
    shipmentCreatedAt?: Date | null;
    shipmentUpdatedAt?: Date | null;
  } | null;
}) {
  const lifecycle = `${input.fulfillmentStatus ?? ''} ${input.shippingStatus ?? ''}`.trim().toLowerCase();
  return Boolean(
    input.trackingNumber ||
      input.carrier ||
      input.fulfillment?.trackingUrl ||
      input.fulfillment?.shopifyFulfillmentId ||
      input.fulfillment?.fulfilledAt ||
      input.fulfillment?.shipmentCreatedAt ||
      input.fulfillment?.shipmentUpdatedAt ||
      lifecycle.includes('fulfilled') ||
      lifecycle.includes('shipped') ||
      lifecycle.includes('in_transit') ||
      lifecycle.includes('in transit') ||
      lifecycle.includes('delivered') ||
      lifecycle.includes('label_created') ||
      lifecycle.includes('label created'),
  );
}

async function upsertCanonicalFulfillmentMatchMissingSignal(input: {
  allocationId: string;
  vendorId: string;
  sourceShopifyOrderId: string;
  sourceShopifyOrderNumber: string;
  fulfillmentState: ShopifyOrderFulfillmentState;
  localFulfillmentStatus: string | null;
  localShippingStatus: string | null;
  localTrackingNumber?: string | null;
  localCarrier?: string | null;
}) {
  const reconciledAt = new Date();
  const metadata: Prisma.InputJsonObject = {
    reason: CANONICAL_FULFILLMENT_MATCH_MISSING_RULE_KEY,
    diagnosticReason: CANONICAL_FULFILLMENT_MATCH_MISSING_MESSAGE,
    vendorId: input.vendorId,
    allocationId: input.allocationId,
    sourceShopifyOrderId: input.sourceShopifyOrderId,
    sourceShopifyOrderNumber: input.sourceShopifyOrderNumber,
    fulfillmentIds: input.fulfillmentState.fulfillments.map((fulfillment) => fulfillment.sourceFulfillmentId || fulfillment.id),
    fulfillmentOrderIds: input.fulfillmentState.fulfillmentOrders.map((fulfillmentOrder) => fulfillmentOrder.id),
    displayFulfillmentStatus: input.fulfillmentState.displayFulfillmentStatus,
    localFulfillmentStatus: input.localFulfillmentStatus,
    localShippingStatus: input.localShippingStatus,
    localTrackingNumber: input.localTrackingNumber ?? null,
    localCarrier: input.localCarrier ?? null,
    reconciledAt: reconciledAt.toISOString(),
  };

  await prisma.operationalSignal.upsert({
    where: {
      id: buildCanonicalFulfillmentMatchMissingSignalId(input.allocationId),
    },
    update: {
      type: 'reconciliation_issue',
      severity: OperationalSignalSeverity.WARNING,
      sourceArea: OperationalSignalSourceArea.RECONCILIATION,
      vendorId: input.vendorId,
      allocationId: input.allocationId,
      title: 'Fulfillment reconciliation needs attention',
      description: CANONICAL_FULFILLMENT_MATCH_MISSING_MESSAGE,
      suggestedAction: 'Retry fulfillment reconciliation or review Shopify fulfillment line-item mapping.',
      status: OperationalSignalStatus.ACTIVE,
      ruleKey: CANONICAL_FULFILLMENT_MATCH_MISSING_RULE_KEY,
      triggeredAt: reconciledAt,
      resolvedAt: null,
      metadata,
    },
    create: {
      id: buildCanonicalFulfillmentMatchMissingSignalId(input.allocationId),
      type: 'reconciliation_issue',
      severity: OperationalSignalSeverity.WARNING,
      sourceArea: OperationalSignalSourceArea.RECONCILIATION,
      vendorId: input.vendorId,
      allocationId: input.allocationId,
      title: 'Fulfillment reconciliation needs attention',
      description: CANONICAL_FULFILLMENT_MATCH_MISSING_MESSAGE,
      suggestedAction: 'Retry fulfillment reconciliation or review Shopify fulfillment line-item mapping.',
      ruleKey: CANONICAL_FULFILLMENT_MATCH_MISSING_RULE_KEY,
      triggeredAt: reconciledAt,
      metadata,
    },
  });
}

async function resolveCanonicalFulfillmentMatchMissingSignal(allocationId: string) {
  await prisma.operationalSignal.updateMany({
    where: {
      id: buildCanonicalFulfillmentMatchMissingSignalId(allocationId),
      status: {
        in: [OperationalSignalStatus.ACTIVE, OperationalSignalStatus.ACKNOWLEDGED],
      },
    },
    data: {
      status: OperationalSignalStatus.RESOLVED,
      resolvedAt: new Date(),
    },
  });
}

async function upsertCanonicalOrderSignal(input: {
  ruleKey: CanonicalOrderSignalRuleKey;
  sourceShopifyOrderId: string;
  sourceShopifyOrderNumber?: string | null;
  severity?: OperationalSignalSeverity;
  title: string;
  description: string;
  suggestedAction?: string | null;
  metadata?: Prisma.InputJsonObject;
}) {
  const reconciledAt = new Date();
  const metadata: Prisma.InputJsonObject = {
    reason: input.ruleKey,
    sourceShopifyOrderId: input.sourceShopifyOrderId,
    sourceShopifyOrderNumber: input.sourceShopifyOrderNumber ?? null,
    reconciledAt: reconciledAt.toISOString(),
    ...(input.metadata ?? {}),
  };

  await prisma.operationalSignal.upsert({
    where: {
      id: buildCanonicalOrderSignalId(input.ruleKey, input.sourceShopifyOrderId),
    },
    update: {
      type: 'reconciliation_issue',
      severity: input.severity ?? OperationalSignalSeverity.WARNING,
      sourceArea: OperationalSignalSourceArea.RECONCILIATION,
      vendorId: null,
      allocationId: null,
      title: input.title,
      description: input.description,
      suggestedAction: input.suggestedAction ?? null,
      status: OperationalSignalStatus.ACTIVE,
      ruleKey: input.ruleKey,
      triggeredAt: reconciledAt,
      resolvedAt: null,
      metadata,
    },
    create: {
      id: buildCanonicalOrderSignalId(input.ruleKey, input.sourceShopifyOrderId),
      type: 'reconciliation_issue',
      severity: input.severity ?? OperationalSignalSeverity.WARNING,
      sourceArea: OperationalSignalSourceArea.RECONCILIATION,
      vendorId: null,
      allocationId: null,
      title: input.title,
      description: input.description,
      suggestedAction: input.suggestedAction ?? null,
      ruleKey: input.ruleKey,
      triggeredAt: reconciledAt,
      metadata,
    },
  });
}

async function resolveCanonicalOrderSignal(ruleKey: CanonicalOrderSignalRuleKey, sourceShopifyOrderId: string) {
  await prisma.operationalSignal.updateMany({
    where: {
      id: buildCanonicalOrderSignalId(ruleKey, sourceShopifyOrderId),
      status: {
        in: [OperationalSignalStatus.ACTIVE, OperationalSignalStatus.ACKNOWLEDGED],
      },
    },
    data: {
      status: OperationalSignalStatus.RESOLVED,
      resolvedAt: new Date(),
    },
  });
}

function recordChange(input: {
  scope: string;
  field: string;
  localValue: unknown;
  canonicalValue: unknown;
}) {
  const localValue = input.localValue === undefined || input.localValue === null ? null : String(input.localValue);
  const canonicalValue =
    input.canonicalValue === undefined || input.canonicalValue === null ? null : String(input.canonicalValue);

  if (localValue === canonicalValue) {
    return null;
  }

  return {
    scope: input.scope,
    field: input.field,
    localValue,
    canonicalValue,
  };
}

function normalizeComparableString(value: unknown) {
  if (value === undefined || value === null) {
    return null;
  }
  const normalized = String(value).trim();
  return normalized || null;
}

function normalizeComparableAmount(value: unknown) {
  if (value === undefined || value === null) {
    return null;
  }
  const parsed = Number(String(value));
  return Number.isFinite(parsed) ? parsed.toFixed(2) : normalizeComparableString(value);
}

function normalizeComparableDate(value: unknown) {
  if (value === undefined || value === null) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? normalizeComparableString(value) : date.toISOString();
}

function normalizeStringArray(value: unknown) {
  return Array.isArray(value) ? value.map((entry) => String(entry)).sort() : [];
}

function recordComparableChange(input: {
  scope: string;
  field: string;
  localValue: unknown;
  canonicalValue: unknown;
  kind?: 'string' | 'amount' | 'date' | 'string_array' | 'boolean' | 'number';
}) {
  let localValue: string | null;
  let canonicalValue: string | null;

  if (input.kind === 'amount') {
    localValue = normalizeComparableAmount(input.localValue);
    canonicalValue = normalizeComparableAmount(input.canonicalValue);
  } else if (input.kind === 'date') {
    localValue = normalizeComparableDate(input.localValue);
    canonicalValue = normalizeComparableDate(input.canonicalValue);
  } else if (input.kind === 'string_array') {
    localValue = JSON.stringify(normalizeStringArray(input.localValue));
    canonicalValue = JSON.stringify(normalizeStringArray(input.canonicalValue));
  } else if (input.kind === 'boolean') {
    localValue = input.localValue === undefined || input.localValue === null ? null : String(Boolean(input.localValue));
    canonicalValue =
      input.canonicalValue === undefined || input.canonicalValue === null ? null : String(Boolean(input.canonicalValue));
  } else if (input.kind === 'number') {
    localValue = input.localValue === undefined || input.localValue === null ? null : String(Number(input.localValue));
    canonicalValue =
      input.canonicalValue === undefined || input.canonicalValue === null ? null : String(Number(input.canonicalValue));
  } else {
    localValue = normalizeComparableString(input.localValue);
    canonicalValue = normalizeComparableString(input.canonicalValue);
  }

  if (localValue === canonicalValue) {
    return null;
  }

  return {
    scope: input.scope,
    field: input.field,
    localValue,
    canonicalValue,
  };
}

function canonicalSummaryFromSnapshot(
  canonicalOrderSnapshot: CanonicalShopifyOrderSnapshot,
  fallbackShopifyOrderId: string,
) {
  return {
    source: canonicalOrderSnapshot.source,
    shopifyOrderId: canonicalOrderSnapshot.sourceShopifyOrderId || fallbackShopifyOrderId,
    orderName: canonicalOrderSnapshot.sourceShopifyOrderNumber,
    displayFulfillmentStatus: null,
    fulfillmentCount: 0,
    fulfillmentOrderCount: canonicalOrderSnapshot.fulfillmentOrders.length,
    fulfilledLineItemIds: [],
    cancelledLineItemIds: [],
  };
}

function canonicalSummaryFromFailure(sourceShopifyOrderId: string) {
  return {
    source: 'shopify_admin' as const,
    shopifyOrderId: sourceShopifyOrderId,
    orderName: null,
    displayFulfillmentStatus: null,
    fulfillmentCount: 0,
    fulfillmentOrderCount: 0,
    fulfilledLineItemIds: [],
    cancelledLineItemIds: [],
  };
}

function localSummaryFromUnknown(sourceShopifyOrderId: string, shopifyOrderNumber: string | null = null) {
  return {
    shopifyOrderId: sourceShopifyOrderId,
    shopifyOrderNumber: shopifyOrderNumber ?? sourceShopifyOrderId,
    allocationCount: 0,
    refundRecordCount: 0,
    returnRecordCount: 0,
  };
}

function normalizeCanonicalLineItemId(value: string | null | undefined) {
  return normalizeLineItemId(value ?? '');
}

function lineItemIdSet(values: string[]) {
  return new Set(values.map(normalizeCanonicalLineItemId).filter(Boolean));
}

function areEqualSets(left: Set<string>, right: Set<string>) {
  if (left.size !== right.size) {
    return false;
  }
  for (const value of left) {
    if (!right.has(value)) {
      return false;
    }
  }
  return true;
}

function decimalUpdateValue(value: string | null) {
  return value === null ? null : value;
}

function recordSkippedRepair(input: {
  scope: string;
  field: string;
  localValue?: unknown;
  canonicalValue?: unknown;
  reason: string;
  skippedFields: ReconciliationFieldChange[];
  allocationResult: ReconciliationAllocationResult;
}) {
  const change = {
    scope: input.scope,
    field: input.field,
    localValue: input.localValue === undefined || input.localValue === null ? null : String(input.localValue),
    canonicalValue: input.canonicalValue === undefined || input.canonicalValue === null ? null : String(input.canonicalValue),
  };
  input.skippedFields.push(change);
  input.allocationResult.skippedFields.push(change);
  input.allocationResult.warnings.push(input.reason);
}

type LocalCanonicalLineItem = {
  id: string;
  sourceLineItemId: string;
  shopifyProductId?: unknown;
  sourceVariantId?: unknown;
  sku?: unknown;
  title?: unknown;
  imageUrl?: unknown;
  quantity?: unknown;
  unitPrice?: unknown;
  unitPriceVatIncluded?: unknown;
  lineTotalVatIncluded?: unknown;
  lineTaxAmount?: unknown;
  vatRate?: unknown;
  originalVendorId?: unknown;
  allocationLineItems?: unknown[];
};

type LocalOrderForCanonicalRepair = {
  id: string;
  sourceShopifyOrderId: string;
  sourceShopifyOrderNumber: string;
  lineItems?: LocalCanonicalLineItem[];
  allocations?: Array<{
    id: string;
    assignedVendorId: string;
    refundRecords?: unknown[];
    returnRecords?: unknown[];
  }>;
} & Record<string, unknown>;

async function repairCanonicalOrderSnapshot(input: {
  shopifyOrder: LocalOrderForCanonicalRepair;
  canonicalOrderSnapshot: CanonicalShopifyOrderSnapshot;
  staleFields: ReconciliationFieldChange[];
  repairedFields: ReconciliationFieldChange[];
}) {
  const { shopifyOrder, canonicalOrderSnapshot, staleFields, repairedFields } = input;
  const orderUpdate: Prisma.ShopifyOrderUpdateInput = {};
  const changes: ReconciliationFieldChange[] = [];

  const addField = (field: keyof Prisma.ShopifyOrderUpdateInput & keyof CanonicalShopifyOrderSnapshot, options?: {
    kind?: 'string' | 'amount' | 'date' | 'string_array' | 'boolean';
    value?: unknown;
  }) => {
    const canonicalValue = options?.value ?? canonicalOrderSnapshot[field];
    const change = recordComparableChange({
      scope: shopifyOrder.id,
      field,
      localValue: shopifyOrder[field],
      canonicalValue,
      kind: options?.kind,
    });
    if (!change) {
      return;
    }

    changes.push(change);
    if (field === 'shopifyCreatedAt') {
      orderUpdate.shopifyCreatedAt = toDate(canonicalOrderSnapshot.shopifyCreatedAt);
    } else if (field === 'orderTags') {
      orderUpdate.orderTags = { set: canonicalOrderSnapshot.orderTags };
    } else if (options?.kind === 'amount') {
      (orderUpdate as Record<string, unknown>)[field] = decimalUpdateValue(canonicalValue as string | null);
    } else {
      (orderUpdate as Record<string, unknown>)[field] = canonicalValue ?? null;
    }
  };

  addField('sourceShopifyOrderNumber');
  addField('shopifyCreatedAt', { kind: 'date' });
  addField('currency');
  addField('financialStatus', {
    value: normalizeCanonicalShopifyOrderFinancialStatus(canonicalOrderSnapshot.financialStatus),
  });
  addField('paymentGatewayName');
  addField('taxesIncluded', { kind: 'boolean' });
  addField('orderTaxAmount', { kind: 'amount' });
  addField('shippingAmount', { kind: 'amount' });
  addField('discountAmount', { kind: 'amount' });
  addField('orderNote');
  addField('orderTags', { kind: 'string_array' });
  addField('customerName');
  addField('customerEmail');
  addField('customerPhone');
  addField('billingFullName');
  addField('billingCompany');
  addField('billingPhone');
  addField('billingCity');
  addField('billingDistrict');
  addField('billingAddress1');
  addField('billingAddress2');
  addField('billingPostcode');
  addField('shippingCountry');
  addField('shippingPostcode');
  addField('shippingCity');
  addField('shippingDistrict');
  addField('shippingAddress');
  addField('totalPrice', { kind: 'amount' });

  if (changes.length === 0) {
    await resolveCanonicalOrderSignal(CANONICAL_ORDER_SIGNAL_RULE_KEYS.snapshotStale, shopifyOrder.sourceShopifyOrderId);
    return 0;
  }

  await upsertCanonicalOrderSignal({
    ruleKey: CANONICAL_ORDER_SIGNAL_RULE_KEYS.snapshotStale,
    sourceShopifyOrderId: shopifyOrder.sourceShopifyOrderId,
    sourceShopifyOrderNumber: shopifyOrder.sourceShopifyOrderNumber,
    title: 'Shopify order snapshot repaired',
    description: 'Canonical Shopify order reconciliation repaired stale local order snapshot fields.',
    suggestedAction: 'Review order snapshot repair history if the change looks unexpected.',
    metadata: {
      changedFields: changes.map((change) => change.field),
    },
  });

  await prisma.shopifyOrder.update({
    where: { id: shopifyOrder.id },
    data: orderUpdate,
  });

  staleFields.push(...changes);
  repairedFields.push(...changes);
  await resolveCanonicalOrderSignal(CANONICAL_ORDER_SIGNAL_RULE_KEYS.snapshotStale, shopifyOrder.sourceShopifyOrderId);
  return changes.length;
}

async function repairCanonicalOrderLineItems(input: {
  shopifyOrder: LocalOrderForCanonicalRepair;
  canonicalOrderSnapshot: CanonicalShopifyOrderSnapshot;
  staleFields: ReconciliationFieldChange[];
  repairedFields: ReconciliationFieldChange[];
  skippedFields: ReconciliationFieldChange[];
  warnings: string[];
  affectedVendorIds: Set<string>;
}) {
  const { shopifyOrder, canonicalOrderSnapshot, staleFields, repairedFields, skippedFields, warnings, affectedVendorIds } =
    input;
  const localLineItems = shopifyOrder.lineItems ?? [];
  const localLineItemIds = lineItemIdSet(localLineItems.map((lineItem) => lineItem.sourceLineItemId));
  const canonicalLineItemIds = lineItemIdSet(
    canonicalOrderSnapshot.lineItems.map((lineItem) => lineItem.sourceLineItemId || lineItem.lineItemGid),
  );

  if (!areEqualSets(localLineItemIds, canonicalLineItemIds)) {
    const change = {
      scope: shopifyOrder.id,
      field: 'lineItems',
      localValue: JSON.stringify(Array.from(localLineItemIds).sort()),
      canonicalValue: JSON.stringify(Array.from(canonicalLineItemIds).sort()),
    };
    skippedFields.push(change);
    warnings.push('Canonical Shopify order line items differ from local line items. Local line-item state preserved.');
    await upsertCanonicalOrderSignal({
      ruleKey: CANONICAL_ORDER_SIGNAL_RULE_KEYS.lineItemMismatch,
      sourceShopifyOrderId: shopifyOrder.sourceShopifyOrderId,
      sourceShopifyOrderNumber: shopifyOrder.sourceShopifyOrderNumber,
      title: 'Shopify order line items need review',
      description: 'Canonical Shopify order line items do not match local line items. Local allocations were preserved.',
      suggestedAction: 'Review Shopify order line items before running repair or recovery workflows.',
      metadata: {
        localLineItemIds: Array.from(localLineItemIds).sort(),
        canonicalLineItemIds: Array.from(canonicalLineItemIds).sort(),
      },
    });
    return {
      blocked: true,
      operationalConflict: false,
      manualReview: false,
    };
  }

  await resolveCanonicalOrderSignal(CANONICAL_ORDER_SIGNAL_RULE_KEYS.lineItemMismatch, shopifyOrder.sourceShopifyOrderId);

  const canonicalByLineItemId = new Map<string, CanonicalShopifyOrderLineItemSnapshot>();
  for (const lineItem of canonicalOrderSnapshot.lineItems) {
    canonicalByLineItemId.set(normalizeCanonicalLineItemId(lineItem.sourceLineItemId || lineItem.lineItemGid), lineItem);
  }

  const sellerVendorIds = canonicalOrderSnapshot.sellerInfo
    ? new Set((await prisma.vendor.findMany({ select: { id: true } })).map((vendor) => vendor.id))
    : null;
  let operationalConflict = false;
  let manualReview = false;
  let repairedCount = 0;

  for (const localLineItem of localLineItems) {
    const canonicalLineItem = canonicalByLineItemId.get(normalizeCanonicalLineItemId(localLineItem.sourceLineItemId));
    if (!canonicalLineItem) {
      continue;
    }

    const quantityChange = recordComparableChange({
      scope: localLineItem.id,
      field: 'quantity',
      localValue: localLineItem.quantity,
      canonicalValue: canonicalLineItem.quantity,
      kind: 'number',
    });
    if (quantityChange) {
      skippedFields.push(quantityChange);
      warnings.push('Canonical Shopify line-item quantity differs from local allocation state. Local line item preserved.');
      operationalConflict = true;
      continue;
    }

    const lineItemUpdate: Prisma.ShopifyOrderLineItemUpdateInput = {};
    const lineItemChanges: ReconciliationFieldChange[] = [];
    const addLineField = (
      field: keyof Prisma.ShopifyOrderLineItemUpdateInput & keyof CanonicalShopifyOrderLineItemSnapshot,
      options?: { kind?: 'string' | 'amount'; value?: unknown },
    ) => {
      const canonicalValue = options?.value ?? canonicalLineItem[field];
      const change = recordComparableChange({
        scope: localLineItem.id,
        field,
        localValue: localLineItem[field],
        canonicalValue,
        kind: options?.kind,
      });
      if (!change) {
        return;
      }

      lineItemChanges.push(change);
      if (options?.kind === 'amount') {
        (lineItemUpdate as Record<string, unknown>)[field] = decimalUpdateValue(canonicalValue as string | null);
      } else {
        (lineItemUpdate as Record<string, unknown>)[field] = canonicalValue ?? null;
      }
    };

    addLineField('shopifyProductId');
    addLineField('sourceVariantId');
    addLineField('sku');
    addLineField('title');
    addLineField('imageUrl');
    addLineField('unitPrice', { kind: 'amount' });
    addLineField('unitPriceVatIncluded', { kind: 'amount' });
    addLineField('lineTotalVatIncluded', { kind: 'amount' });
    addLineField('lineTaxAmount', { kind: 'amount' });
    addLineField('vatRate', { kind: 'amount' });

    const sellerInfoVendorId =
      canonicalOrderSnapshot.sellerInfo && canonicalLineItem.sku
        ? normalizeVendorSlug(canonicalOrderSnapshot.sellerInfo[canonicalLineItem.sku])
        : null;
    if (sellerInfoVendorId) {
      if (!sellerVendorIds?.has(sellerInfoVendorId)) {
        const change = {
          scope: localLineItem.id,
          field: 'sellerInfo',
          localValue: normalizeComparableString(localLineItem.originalVendorId),
          canonicalValue: sellerInfoVendorId,
        };
        skippedFields.push(change);
        warnings.push(`seller_info mapped SKU ${canonicalLineItem.sku} to unknown vendor ${sellerInfoVendorId}.`);
        manualReview = true;
      } else if (normalizeComparableString(localLineItem.originalVendorId) !== sellerInfoVendorId) {
        const hasAllocationLinks = (localLineItem.allocationLineItems ?? []).length > 0;
        if (hasAllocationLinks || normalizeComparableString(localLineItem.originalVendorId)) {
          const change = {
            scope: localLineItem.id,
            field: 'originalVendorId',
            localValue: normalizeComparableString(localLineItem.originalVendorId),
            canonicalValue: sellerInfoVendorId,
          };
          skippedFields.push(change);
          warnings.push('seller_info conflicts with existing allocation ownership. Local ownership preserved.');
          operationalConflict = true;
        } else {
          lineItemChanges.push({
            scope: localLineItem.id,
            field: 'originalVendorId',
            localValue: normalizeComparableString(localLineItem.originalVendorId),
            canonicalValue: sellerInfoVendorId,
          });
          lineItemUpdate.originalVendorId = sellerInfoVendorId;
        }
      }
    }

    if (lineItemChanges.length === 0) {
      continue;
    }

    await prisma.shopifyOrderLineItem.update({
      where: { id: localLineItem.id },
      data: lineItemUpdate,
    });
    staleFields.push(...lineItemChanges);
    repairedFields.push(...lineItemChanges);
    if (typeof lineItemUpdate.originalVendorId === 'string') {
      affectedVendorIds.add(lineItemUpdate.originalVendorId);
    }
    repairedCount += lineItemChanges.length;
  }

  if (repairedCount > 0) {
    await upsertCanonicalOrderSignal({
      ruleKey: CANONICAL_ORDER_SIGNAL_RULE_KEYS.snapshotStale,
      sourceShopifyOrderId: shopifyOrder.sourceShopifyOrderId,
      sourceShopifyOrderNumber: shopifyOrder.sourceShopifyOrderNumber,
      title: 'Shopify order snapshot repaired',
      description: 'Canonical Shopify order reconciliation repaired stale local line-item metadata.',
      suggestedAction: 'Review order snapshot repair history if the change looks unexpected.',
      metadata: {
        changedLineItemFieldCount: repairedCount,
      },
    });
    await resolveCanonicalOrderSignal(CANONICAL_ORDER_SIGNAL_RULE_KEYS.snapshotStale, shopifyOrder.sourceShopifyOrderId);
  }

  if (operationalConflict) {
    await upsertCanonicalOrderSignal({
      ruleKey: CANONICAL_ORDER_SIGNAL_RULE_KEYS.operationalConflict,
      sourceShopifyOrderId: shopifyOrder.sourceShopifyOrderId,
      sourceShopifyOrderNumber: shopifyOrder.sourceShopifyOrderNumber,
      severity: OperationalSignalSeverity.CRITICAL,
      title: 'Shopify order snapshot conflicts with operational state',
      description: 'Canonical Shopify order data conflicts with existing allocations. Local operational state was preserved.',
      suggestedAction: 'Review allocation ownership and line-item quantities before attempting repair.',
      metadata: {
        skippedFields: skippedFields.map((field) => ({
          scope: field.scope,
          field: field.field,
          localValue: field.localValue,
          canonicalValue: field.canonicalValue,
        })),
      },
    });
  } else {
    await resolveCanonicalOrderSignal(
      CANONICAL_ORDER_SIGNAL_RULE_KEYS.operationalConflict,
      shopifyOrder.sourceShopifyOrderId,
    );
  }

  if (manualReview) {
    await upsertCanonicalOrderSignal({
      ruleKey: CANONICAL_ORDER_SIGNAL_RULE_KEYS.requiresManualReview,
      sourceShopifyOrderId: shopifyOrder.sourceShopifyOrderId,
      sourceShopifyOrderNumber: shopifyOrder.sourceShopifyOrderNumber,
      title: 'Shopify order snapshot requires manual review',
      description: 'Canonical Shopify order metadata could not be safely applied automatically.',
      suggestedAction: 'Review Shopify seller_info and local vendor mappings.',
      metadata: {
        skippedFields: skippedFields.map((field) => ({
          scope: field.scope,
          field: field.field,
          localValue: field.localValue,
          canonicalValue: field.canonicalValue,
        })),
      },
    });
  } else {
    await resolveCanonicalOrderSignal(
      CANONICAL_ORDER_SIGNAL_RULE_KEYS.requiresManualReview,
      shopifyOrder.sourceShopifyOrderId,
    );
  }

  return {
    blocked: operationalConflict || manualReview,
    operationalConflict,
    manualReview,
  };
}

function buildCanonicalLineItemMaps(fulfillmentState: ShopifyOrderFulfillmentState) {
  const fulfilledLineItemIds = new Set<string>();
  const cancelledLineItemIds = new Set<string>();
  const fulfillmentByLineItemId = new Map<string, ShopifyOrderFulfillment>();

  for (const fulfillment of fulfillmentState.fulfillments) {
    for (const lineItem of fulfillment.lineItems) {
      const normalizedId = normalizeLineItemId(lineItem.sourceLineItemId || lineItem.lineItemGid);
      if (!normalizedId) {
        continue;
      }

      if (isCancelledStatus(fulfillment.status)) {
        cancelledLineItemIds.add(normalizedId);
        continue;
      }

      fulfilledLineItemIds.add(normalizedId);
      fulfillmentByLineItemId.set(normalizedId, fulfillment);
    }
  }

  for (const fulfillmentOrder of fulfillmentState.fulfillmentOrders) {
    if (!isCancelledStatus(fulfillmentOrder.status)) {
      continue;
    }

    for (const lineItem of fulfillmentOrder.lineItems) {
      const normalizedId = normalizeLineItemId(lineItem.lineItemId);
      if (normalizedId) {
        cancelledLineItemIds.add(normalizedId);
      }
    }
  }

  return {
    fulfilledLineItemIds,
    cancelledLineItemIds,
    fulfillmentByLineItemId,
  };
}

type ReconcileOrderOptions = {
  targetAllocationId?: string;
};

export function createReconciliationService(env: AppEnv) {
  const shopifyAdminService = createShopifyAdminService(env);

  async function reconcileShopifyOrder(
    sourceShopifyOrderId: string,
    options: ReconcileOrderOptions = {},
  ): Promise<OrderReconciliationResult | null> {
    const staleFields: ReconciliationFieldChange[] = [];
    const repairedFields: ReconciliationFieldChange[] = [];
    const skippedFields: ReconciliationFieldChange[] = [];
    const warnings: string[] = [];
    const affectedAllocations: ReconciliationAllocationResult[] = [];
    const affectedVendorIds = new Set<string>();

    let canonicalOrderSnapshot: CanonicalShopifyOrderSnapshot | null = null;
    try {
      canonicalOrderSnapshot = await shopifyAdminService.fetchCanonicalOrderSnapshot(sourceShopifyOrderId);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Shopify canonical order snapshot fetch failed for an unknown reason.';
      const change = {
        scope: sourceShopifyOrderId,
        field: 'canonicalShopifyOrderSnapshot',
        localValue: null,
        canonicalValue: null,
      };
      skippedFields.push(change);
      warnings.push(message);
      await upsertCanonicalOrderSignal({
        ruleKey: CANONICAL_ORDER_SIGNAL_RULE_KEYS.requiresManualReview,
        sourceShopifyOrderId,
        title: 'Shopify order reconciliation requires manual review',
        description: 'Canonical Shopify order snapshot could not be fetched safely. Local state was preserved.',
        suggestedAction: 'Retry canonical order reconciliation after Shopify Admin access or pagination is verified.',
        metadata: {
          error: message,
        },
      });
      return {
        reconciliationStatus: 'needs_attention',
        staleFields,
        repairedFields,
        skippedFields,
        canonicalShopifySummary: canonicalSummaryFromFailure(sourceShopifyOrderId),
        localStateSummary: localSummaryFromUnknown(sourceShopifyOrderId),
        affectedAllocations,
        affectedVendorIds: [],
        warnings,
        requiresManualReview: true,
      };
    }

    const shopifyOrder = await prisma.shopifyOrder.findUnique({
      where: { sourceShopifyOrderId },
      include: {
        lineItems: {
          include: {
            allocationLineItems: true,
          },
          orderBy: {
            createdAt: 'asc',
          },
        },
        allocations: {
          include: {
            fulfillment: true,
            lineItems: {
              include: {
                shopifyOrderLineItem: true,
              },
            },
            refundRecords: true,
            returnRecords: true,
            economicTransfers: {
              select: {
                id: true,
                status: true,
                createdAt: true,
              },
              orderBy: {
                createdAt: 'desc',
              },
            },
            financeEntries: {
              include: {
                payoutBatchLines: {
                  include: {
                    payoutBatch: true,
                  },
                },
                settlementApprovalLines: {
                  include: {
                    settlementApproval: true,
                  },
                },
              },
            },
          },
          orderBy: {
            createdAt: 'asc',
          },
        },
      },
    });

    if (!shopifyOrder) {
      if (canonicalOrderSnapshot) {
        const change = {
          scope: sourceShopifyOrderId,
          field: 'shopifyOrder',
          localValue: null,
          canonicalValue: canonicalOrderSnapshot.sourceShopifyOrderNumber,
        };
        skippedFields.push(change);
        warnings.push('Canonical Shopify order exists but the local order record is missing.');
        await upsertCanonicalOrderSignal({
          ruleKey: CANONICAL_ORDER_SIGNAL_RULE_KEYS.missingLocalRecord,
          sourceShopifyOrderId,
          sourceShopifyOrderNumber: canonicalOrderSnapshot.sourceShopifyOrderNumber,
          severity: OperationalSignalSeverity.CRITICAL,
          title: 'Shopify order missing local record',
          description: 'Canonical Shopify order exists but the local order record is missing. Commerce state was not recreated automatically.',
          suggestedAction: 'Review missed orders/create ingestion and replay the webhook or perform supervised recovery.',
          metadata: {
            canonicalOrderGid: canonicalOrderSnapshot.orderGid,
            canonicalLineItemIds: canonicalOrderSnapshot.lineItems.map((lineItem) => lineItem.sourceLineItemId),
          },
        });
        return {
          reconciliationStatus: 'needs_attention',
          staleFields,
          repairedFields,
          skippedFields,
          canonicalShopifySummary: canonicalSummaryFromSnapshot(canonicalOrderSnapshot, sourceShopifyOrderId),
          localStateSummary: localSummaryFromUnknown(sourceShopifyOrderId, canonicalOrderSnapshot.sourceShopifyOrderNumber),
          affectedAllocations,
          affectedVendorIds: [],
          warnings,
          requiresManualReview: true,
        };
      }
      return null;
    }

    if (canonicalOrderSnapshot) {
      await resolveCanonicalOrderSignal(CANONICAL_ORDER_SIGNAL_RULE_KEYS.missingLocalRecord, sourceShopifyOrderId);
      await repairCanonicalOrderSnapshot({
        shopifyOrder,
        canonicalOrderSnapshot,
        staleFields,
        repairedFields,
      });
      const canonicalLineItemResult = await repairCanonicalOrderLineItems({
        shopifyOrder,
        canonicalOrderSnapshot,
        staleFields,
        repairedFields,
        skippedFields,
        warnings,
        affectedVendorIds,
      });

      if (canonicalLineItemResult.blocked) {
        return {
          reconciliationStatus: 'needs_attention',
          staleFields,
          repairedFields,
          skippedFields,
          canonicalShopifySummary: canonicalSummaryFromSnapshot(canonicalOrderSnapshot, sourceShopifyOrderId),
          localStateSummary: {
            shopifyOrderId: sourceShopifyOrderId,
            shopifyOrderNumber: shopifyOrder.sourceShopifyOrderNumber,
            allocationCount: shopifyOrder.allocations.length,
            refundRecordCount: shopifyOrder.allocations.reduce((sum, allocation) => sum + allocation.refundRecords.length, 0),
            returnRecordCount: shopifyOrder.allocations.reduce((sum, allocation) => sum + allocation.returnRecords.length, 0),
          },
          affectedAllocations,
          affectedVendorIds: Array.from(affectedVendorIds),
          warnings,
          requiresManualReview: true,
        };
      }
    }

    const fulfillmentState = await shopifyAdminService.fetchOrderFulfillmentState(sourceShopifyOrderId);
    const canonicalMaps = buildCanonicalLineItemMaps(fulfillmentState);

    const allocations = options.targetAllocationId
      ? shopifyOrder.allocations.filter((allocation) => allocation.id === options.targetAllocationId)
      : shopifyOrder.allocations;

    if (options.targetAllocationId && allocations.length === 0) {
      return null;
    }

    for (const allocation of allocations) {
      const allocationResult: ReconciliationAllocationResult = {
        allocationId: allocation.id,
        vendorId: allocation.assignedVendorId,
        staleFields: [],
        repairedFields: [],
        skippedFields: [],
        warnings: [],
      };
      const transferRepairStatus = isTransferRepairBlocked(allocation.economicTransfers);
      const transferRepairBlocked = transferRepairStatus !== 'allowed';
      const transferRepairBlockerReason = transferRepairBlocked
        ? repairBlockerMessage(transferRepairStatus)
        : null;
      if (transferRepairBlockerReason) {
        allocationResult.warnings.push(transferRepairBlockerReason);
      }

      const allocationLineItemIds = allocation.lineItems.map((lineItem) =>
        normalizeLineItemId(lineItem.shopifyOrderLineItem.sourceLineItemId),
      );
      const matchedFulfilledIds = allocationLineItemIds.filter((lineItemId) =>
        canonicalMaps.fulfilledLineItemIds.has(lineItemId),
      );
      const matchedCancelledIds = allocationLineItemIds.filter((lineItemId) =>
        canonicalMaps.cancelledLineItemIds.has(lineItemId),
      );
      const allItemsFulfilled =
        allocationLineItemIds.length > 0 && matchedFulfilledIds.length === allocationLineItemIds.length;
      const representativeFulfillment = matchedFulfilledIds.length > 0
        ? canonicalMaps.fulfillmentByLineItemId.get(matchedFulfilledIds[0])
        : null;
      const hasCanonicalFulfillmentTruth = Boolean(representativeFulfillment) || matchedCancelledIds.length > 0;

      if (!hasCanonicalFulfillmentTruth) {
        if (hasLocalFulfillmentEvidence(allocation)) {
          recordSkippedRepair({
            scope: allocation.id,
            field: 'canonicalFulfillmentMatch',
            localValue: 'local_fulfillment_state_preserved',
            canonicalValue: null,
            reason: CANONICAL_FULFILLMENT_MATCH_MISSING_MESSAGE,
            skippedFields,
            allocationResult,
          });
          await upsertCanonicalFulfillmentMatchMissingSignal({
            allocationId: allocation.id,
            vendorId: allocation.assignedVendorId,
            sourceShopifyOrderId: shopifyOrder.sourceShopifyOrderId,
            sourceShopifyOrderNumber: shopifyOrder.sourceShopifyOrderNumber,
            fulfillmentState,
            localFulfillmentStatus: allocation.fulfillmentStatus,
            localShippingStatus: allocation.shippingStatus,
            localTrackingNumber: allocation.trackingNumber,
            localCarrier: allocation.carrier,
          });
          affectedVendorIds.add(allocation.assignedVendorId);
        }
      } else {
        let desiredFulfillmentStatus = 'pending';
        let desiredShippingStatus = 'awaiting_shipment';
        let desiredTrackingNumber: string | null = null;
        let desiredCarrier: string | null = null;
        let desiredTrackingUrl: string | null = null;
        let desiredFulfilledAt: Date | null = null;
        let desiredShipmentCreatedAt: Date | null = null;
        let desiredShipmentUpdatedAt: Date | null = null;
        let desiredSyncStatus = matchedCancelledIds.length > 0 ? 'shopify_reconciled_cancelled' : 'shopify_reconciled';

        if (representativeFulfillment) {
          const tracking = getTrackingInfo(representativeFulfillment);
          const canonicalEventStatus = getCanonicalEventStatus(representativeFulfillment);
          desiredFulfillmentStatus = allItemsFulfilled ? 'fulfilled' : 'partially_fulfilled';
          desiredShippingStatus =
            canonicalEventStatus === 'delivered'
              ? 'delivered'
              : canonicalEventStatus === 'in_transit'
                ? 'in_transit'
                : canonicalEventStatus === 'fulfillment_event_attention'
                  ? 'fulfillment_event_attention'
                  : allItemsFulfilled
                    ? 'shipped'
                    : 'partially_shipped';
          desiredTrackingNumber = tracking?.number ?? null;
          desiredCarrier = tracking?.company ?? null;
          desiredTrackingUrl = tracking?.url ?? null;
          desiredFulfilledAt = toDate(representativeFulfillment.createdAt);
          const latestEvent = getLatestFulfillmentEvent(representativeFulfillment);
          desiredShipmentCreatedAt = desiredFulfilledAt;
          desiredShipmentUpdatedAt = latestDate([
            toDate(latestEvent?.happenedAt ?? null),
            toDate(representativeFulfillment.updatedAt),
            desiredFulfilledAt,
          ]);
        }

        if (!representativeFulfillment && matchedCancelledIds.length > 0) {
          desiredSyncStatus = 'shopify_reconciled_cancelled';
        }

        const fieldComparisons = [
          recordChange({
            scope: allocation.id,
            field: 'fulfillmentStatus',
            localValue: allocation.fulfillmentStatus,
            canonicalValue: desiredFulfillmentStatus,
          }),
          recordChange({
            scope: allocation.id,
            field: 'shippingStatus',
            localValue: allocation.shippingStatus,
            canonicalValue: desiredShippingStatus,
          }),
          recordChange({
            scope: allocation.id,
            field: 'trackingNumber',
            localValue: allocation.trackingNumber,
            canonicalValue: desiredTrackingNumber,
          }),
          recordChange({
            scope: allocation.id,
            field: 'carrier',
            localValue: allocation.carrier,
            canonicalValue: desiredCarrier,
          }),
          recordChange({
            scope: allocation.id,
            field: 'trackingUrl',
            localValue: allocation.fulfillment?.trackingUrl ?? null,
            canonicalValue: desiredTrackingUrl,
          }),
          recordChange({
            scope: allocation.id,
            field: 'fulfilledAt',
            localValue: toIso(allocation.fulfillment?.fulfilledAt),
            canonicalValue: toIso(desiredFulfilledAt),
          }),
          recordChange({
            scope: allocation.id,
            field: 'shipmentCreatedAt',
            localValue: toIso(allocation.fulfillment?.shipmentCreatedAt),
            canonicalValue: toIso(desiredShipmentCreatedAt),
          }),
          recordChange({
            scope: allocation.id,
            field: 'shipmentUpdatedAt',
            localValue: toIso(allocation.fulfillment?.shipmentUpdatedAt),
            canonicalValue: toIso(desiredShipmentUpdatedAt),
          }),
        ].filter((change): change is ReconciliationFieldChange => Boolean(change));

        allocationResult.staleFields.push(...fieldComparisons);
        staleFields.push(...fieldComparisons);

        if (fieldComparisons.length > 0 && transferRepairBlockerReason) {
          for (const change of fieldComparisons) {
            recordSkippedRepair({
              scope: change.scope,
              field: change.field,
              localValue: change.localValue,
              canonicalValue: change.canonicalValue,
              reason: transferRepairBlockerReason,
              skippedFields,
              allocationResult,
            });
          }
        } else if (fieldComparisons.length > 0) {
          await prisma.$transaction(async (tx) => {
            await tx.vendorAllocation.update({
              where: { id: allocation.id },
              data: {
                fulfillmentStatus: desiredFulfillmentStatus,
                shippingStatus: desiredShippingStatus,
                trackingNumber: desiredTrackingNumber,
                carrier: desiredCarrier,
              },
            });

            await tx.fulfillment.upsert({
              where: { vendorAllocationId: allocation.id },
              update: {
                fulfillmentStatus: desiredFulfillmentStatus,
                trackingNumber: desiredTrackingNumber,
                carrier: desiredCarrier,
                trackingUrl: desiredTrackingUrl,
                fulfilledAt: desiredFulfilledAt,
                shipmentCreatedAt: desiredShipmentCreatedAt,
                shipmentUpdatedAt: desiredShipmentUpdatedAt ?? new Date(),
                syncStatus: desiredSyncStatus,
                errorMessage: null,
              },
              create: {
                vendorAllocationId: allocation.id,
                fulfillmentStatus: desiredFulfillmentStatus,
                trackingNumber: desiredTrackingNumber,
                carrier: desiredCarrier,
                trackingUrl: desiredTrackingUrl,
                notifyCustomer: false,
                fulfilledAt: desiredFulfilledAt,
                shipmentCreatedAt: desiredShipmentCreatedAt,
                shipmentUpdatedAt: desiredShipmentUpdatedAt ?? new Date(),
                syncStatus: desiredSyncStatus,
              },
            });
          });

          allocationResult.repairedFields.push(...fieldComparisons);
          repairedFields.push(...fieldComparisons);
          affectedVendorIds.add(allocation.assignedVendorId);
        }

        await resolveCanonicalFulfillmentMatchMissingSignal(allocation.id);
      }
      for (const refundRecord of allocation.refundRecords) {
        if (refundRecord.status !== 'processed') {
          const change = recordChange({
            scope: refundRecord.id,
            field: 'refund.status',
            localValue: refundRecord.status,
            canonicalValue: 'processed',
          });
          if (change) {
            staleFields.push(change);
            allocationResult.staleFields.push(change);
            if (transferRepairBlockerReason) {
              recordSkippedRepair({
                scope: change.scope,
                field: change.field,
                localValue: change.localValue,
                canonicalValue: change.canonicalValue,
                reason: transferRepairBlockerReason,
                skippedFields,
                allocationResult,
              });
            } else {
              await prisma.refundRecord.update({
                where: { id: refundRecord.id },
                data: { status: 'processed' },
              });
              repairedFields.push(change);
              allocationResult.repairedFields.push(change);
              affectedVendorIds.add(allocation.assignedVendorId);
            }
          }
        }

        let expectedLedgerId: string | null = null;
        let legacyLedgerId: string | null = null;
        let economicOwnerVendorId: string | null = null;
        let activeSaleLedgerId: string | null = null;
        let refundLedgerRepairReason: string | null = transferRepairBlockerReason;
        if (!refundLedgerRepairReason) {
          try {
            const economicOwner = await resolveActiveEconomicOwnerForRepair({
              vendorAllocationId: allocation.id,
              transfers: allocation.economicTransfers,
            });
            economicOwnerVendorId = economicOwner.economicOwnerVendorId;
            activeSaleLedgerId = economicOwner.activeSaleLedgerId;
            expectedLedgerId = buildExpectedRefundLedgerIdForReconciliation({
              vendorId: economicOwnerVendorId,
              sourceShopifyRefundId: refundRecord.sourceShopifyRefundId,
              vendorAllocationId: allocation.id,
            });
            legacyLedgerId = buildLegacyRefundLedgerEntryId({
              vendorId: economicOwnerVendorId,
              sourceShopifyRefundId: refundRecord.sourceShopifyRefundId,
            });
          } catch (error) {
            refundLedgerRepairReason = error instanceof Error ? error.message : 'Refund ledger repair owner resolution failed.';
          }
        }

        const hasActiveLedger = expectedLedgerId
          ? allocation.financeEntries.some((entry) =>
              entry.id === expectedLedgerId &&
              entry.entryType === 'refund' &&
              entry.vendorId === economicOwnerVendorId &&
              !isLedgerVoided(entry)
            )
          : false;
        const legacyActiveLedger = legacyLedgerId
          ? allocation.financeEntries.find((entry) =>
              entry.id === legacyLedgerId &&
              entry.entryType === 'refund' &&
              entry.vendorId === economicOwnerVendorId &&
              !isLedgerVoided(entry)
            )
          : null;
        const conflictingActiveLedger = expectedLedgerId
          ? allocation.financeEntries.find((entry) =>
              entry.entryType === 'refund' &&
              matchesRefundLedgerSource({
                ledgerId: entry.id,
                sourceShopifyRefundId: refundRecord.sourceShopifyRefundId,
              }) &&
              entry.id !== expectedLedgerId &&
              entry.id !== legacyLedgerId &&
              !isLedgerVoided(entry)
            )
          : null;
        if (!hasActiveLedger && legacyActiveLedger) {
          refundLedgerRepairReason =
            `Legacy refund ledger ${legacyActiveLedger.id} already exists for allocation ${allocation.id}; manual migration/backfill is required before allocation-scoped repair.`;
        } else if (conflictingActiveLedger) {
          refundLedgerRepairReason =
            `Active refund ledger ${conflictingActiveLedger.id} already exists for allocation ${allocation.id} under a different economic owner.`;
        }
        const hasLedger = hasActiveLedger;
        if (!hasLedger && refundRecord.amount) {
          if (refundLedgerRepairReason || !expectedLedgerId || !economicOwnerVendorId || !activeSaleLedgerId) {
            recordSkippedRepair({
              scope: refundRecord.id,
              field: 'financeLedgerEntry',
              localValue: null,
              canonicalValue: expectedLedgerId,
              reason: refundLedgerRepairReason ?? 'Refund ledger repair owner resolution failed.',
              skippedFields,
              allocationResult,
            });
            continue;
          }

          const saleLedgerEntry = allocation.financeEntries.find((entry) =>
            entry.id === activeSaleLedgerId &&
            entry.entryType === 'sale' &&
            !isLedgerVoided(entry)
          ) ?? null;
          if (!saleLedgerEntry) {
            recordSkippedRepair({
              scope: refundRecord.id,
              field: 'financeLedgerEntry',
              localValue: null,
              canonicalValue: expectedLedgerId,
              reason: `Active sale ledger ${activeSaleLedgerId} could not be loaded for reconciliation repair.`,
              skippedFields,
              allocationResult,
            });
            continue;
          }
          const refundOffsetEligibility = getUnsettledRefundOffsetEligibility({
            refundRecord,
            relatedSaleLedgerEntry: saleLedgerEntry,
          });
          const postApprovalRefundRisk = classifyPostApprovalRefundRisk({
            refundRecord,
            relatedSaleLedgerEntry: saleLedgerEntry,
          });
          const change = {
            scope: refundRecord.id,
            field: 'financeLedgerEntry',
            localValue: null,
            canonicalValue: expectedLedgerId,
          };
          await prisma.financeLedgerEntry.create({
            data: {
              id: expectedLedgerId,
              vendorAllocationId: allocation.id,
              vendorId: economicOwnerVendorId,
              entryType: 'refund',
              amount: refundRecord.amount,
              payoutStatus: refundOffsetEligibility.eligible ? 'PENDING' : 'HOLD',
              commissionPercentSnapshot: saleLedgerEntry?.commissionPercentSnapshot ?? null,
              commissionVatPercentSnapshot: saleLedgerEntry?.commissionVatPercentSnapshot ?? null,
              settlementStatus: 'PARTIALLY_REFUNDED',
              settlementHoldReason: refundOffsetEligibility.eligible
                ? null
                : postApprovalRefundRisk.reason ?? refundOffsetEligibility.reason,
              description: `Reconciled refund ledger for Shopify refund ${refundRecord.sourceShopifyRefundId}`,
            },
          });
          if (postApprovalRefundRisk.state === 'already_paid_requires_vendor_debt') {
            await createVendorDebtForPaidRefund(prisma, {
              vendorId: economicOwnerVendorId,
              refundRecordId: refundRecord.id,
              sourceShopifyRefundId: refundRecord.sourceShopifyRefundId,
              financeLedgerEntryId: expectedLedgerId,
              refundAmount: refundRecord.amount,
              commissionPercentSnapshot: saleLedgerEntry?.commissionPercentSnapshot,
              commissionVatPercentSnapshot: saleLedgerEntry?.commissionVatPercentSnapshot,
              currency: shopifyOrder.currency ?? 'TRY',
              sourceShopifyOrderId: refundRecord.sourceShopifyOrderId,
              sourceShopifyOrderNumber: refundRecord.sourceShopifyOrderNumber,
              vendorAllocationId: allocation.id,
            });
          }
          staleFields.push(change);
          repairedFields.push(change);
          allocationResult.staleFields.push(change);
          allocationResult.repairedFields.push(change);
          affectedVendorIds.add(economicOwnerVendorId);
        }
      }

      for (const returnRecord of allocation.returnRecords) {
        if (returnRecord.returnLifecycleStatus && returnRecord.status !== returnRecord.returnLifecycleStatus) {
          const change = recordChange({
            scope: returnRecord.id,
            field: 'return.status',
            localValue: returnRecord.status,
            canonicalValue: returnRecord.returnLifecycleStatus,
          });
          if (change) {
            staleFields.push(change);
            allocationResult.staleFields.push(change);
            if (transferRepairBlockerReason) {
              recordSkippedRepair({
                scope: change.scope,
                field: change.field,
                localValue: change.localValue,
                canonicalValue: change.canonicalValue,
                reason: transferRepairBlockerReason,
                skippedFields,
                allocationResult,
              });
            } else {
              await prisma.returnRecord.update({
                where: { id: returnRecord.id },
                data: {
                  status: returnRecord.returnLifecycleStatus,
                  requestUpdatedAt: new Date(),
                },
              });
              repairedFields.push(change);
              allocationResult.repairedFields.push(change);
              affectedVendorIds.add(allocation.assignedVendorId);
            }
          }
        }
      }

      const saleLedgerRepairReadiness = classifySaleLedgerRepairReadiness({
        financeEntries: allocation.financeEntries,
        transfers: allocation.economicTransfers,
      });
      const expectedSaleLedgerId = buildExpectedSaleLedgerIdForReconciliation({
        assignedVendorId: allocation.assignedVendorId,
        sourceShopifyOrderId: shopifyOrder.sourceShopifyOrderId,
        vendorAllocationId: allocation.id,
      });
      if (saleLedgerRepairReadiness.status === 'missing_active_sale_ledger') {
        const change = {
          scope: allocation.id,
          field: 'saleFinanceLedgerEntry',
          localValue: null,
          canonicalValue: expectedSaleLedgerId,
        };
        await prisma.$transaction(async (tx) => {
          await upsertSaleLedgerForAllocation(tx, allocation.id);
        });
        staleFields.push(change);
        repairedFields.push(change);
        allocationResult.staleFields.push(change);
        allocationResult.repairedFields.push(change);
        affectedVendorIds.add(allocation.assignedVendorId);
      } else if (
        saleLedgerRepairReadiness.status !== 'active_sale_ledger_exists'
      ) {
        recordSkippedRepair({
          scope: allocation.id,
          field: 'saleFinanceLedgerEntry',
          localValue: saleLedgerRepairReadiness.voidedSaleLedgerIds.length > 0
            ? saleLedgerRepairReadiness.voidedSaleLedgerIds.join(',')
            : null,
          canonicalValue: expectedSaleLedgerId,
          reason: saleLedgerRepairReadiness.reason,
          skippedFields,
          allocationResult,
        });
      }

      if (
        allocationResult.staleFields.length > 0 ||
        allocationResult.skippedFields.length > 0 ||
        allocationResult.warnings.length > 0
      ) {
        affectedAllocations.push(allocationResult);
      }

      warnings.push(...allocationResult.warnings);
    }

    const requiresManualReview = skippedFields.length > 0 || warnings.length > 0;
    const reconciliationStatus = requiresManualReview
      ? 'needs_attention'
      : repairedFields.length > 0
        ? 'repaired'
        : 'in_sync';

    return {
      reconciliationStatus,
      staleFields,
      repairedFields,
      skippedFields,
      canonicalShopifySummary: {
        source: fulfillmentState.source,
        shopifyOrderId: sourceShopifyOrderId,
        orderName: fulfillmentState.orderName,
        displayFulfillmentStatus: fulfillmentState.displayFulfillmentStatus,
        fulfillmentCount: fulfillmentState.fulfillments.length,
        fulfillmentOrderCount: fulfillmentState.fulfillmentOrders.length,
        fulfilledLineItemIds: Array.from(canonicalMaps.fulfilledLineItemIds),
        cancelledLineItemIds: Array.from(canonicalMaps.cancelledLineItemIds),
      },
      localStateSummary: {
        shopifyOrderId: sourceShopifyOrderId,
        shopifyOrderNumber: shopifyOrder.sourceShopifyOrderNumber,
        allocationCount: allocations.length,
        refundRecordCount: allocations.reduce((sum, allocation) => sum + allocation.refundRecords.length, 0),
        returnRecordCount: allocations.reduce((sum, allocation) => sum + allocation.returnRecords.length, 0),
      },
      affectedAllocations,
      affectedVendorIds: Array.from(affectedVendorIds),
      warnings,
      requiresManualReview,
    };
  }

  async function reconcileAllocation(allocationId: string): Promise<OrderReconciliationResult | null> {
    const allocation = await prisma.vendorAllocation.findUnique({
      where: { id: allocationId },
      include: {
        order: true,
      },
    });

    if (!allocation?.order?.sourceShopifyOrderId) {
      return null;
    }

    return reconcileShopifyOrder(allocation.order.sourceShopifyOrderId, {
      targetAllocationId: allocationId,
    });
  }

  return {
    reconcileAllocation,
    reconcileShopifyOrder,
  };
}

export const __reconciliationTesting = {
  buildExpectedSaleLedgerIdForReconciliation,
  buildExpectedRefundLedgerIdForReconciliation,
  buildCanonicalFulfillmentMatchMissingSignalId,
  CANONICAL_FULFILLMENT_MATCH_MISSING_RULE_KEY,
  buildCanonicalOrderSignalId,
  CANONICAL_ORDER_SIGNAL_RULE_KEYS,
};
