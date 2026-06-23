import { prisma } from '../../db/prisma.js';
import { AllocationStatus, CancellationReason, ShipmentExecutionStatus } from '@prisma/client';
import type {
  AllocationSplitExecutionResponseDto,
  AllocationSplitPlannerResponseDto,
  AllocationSplitSummaryDto,
  AdminOrderBreakdownDto,
  OrderDetailDto,
  OrderShipmentExecutionDto,
  OrderSummaryDto,
  ShopifyFulfillmentSyncDto,
  ShopifyReturnSignalDiscoveryDto,
} from './orders.types.js';
import type { ReturnOwnershipSummaryDto } from '../returns/returns.types.js';
import { getFinanceLedgerPreviewForAllocation } from '../finance/finance-ledger-preview.service.js';
import { FINANCE_INTEGRITY_ALERT_BLOCKING_STATUSES } from '../finance/finance-integrity-alert.service.js';
import { hasBlockingCancelRefundReviewStatus } from '../finance/cancel-refund-review-hold.service.js';
import {
  transferAllocationEconomics,
  type EconomicTransferResult,
} from '../finance/economic-transfer.service.js';
import {
  isShopifyReturnSignalTopic,
  mapWebhookEventToReturnSignalDiscovery,
} from '../shopify/return-signal-discovery.service.js';
import type { FetchOrderLineItemImagesResult } from '../shopify/shopify-admin.types.js';
import type {
  CancelFulfillmentOrderResult,
  CreateShopifyRefundInput,
  CreateShopifyRefundResult,
  PreviewSuggestedRefundInput,
  PreviewSuggestedRefundResult,
  ShopifyFulfillmentOrderCancellationClassificationResponse,
  ShopifyRefundRestockType,
} from '../shopify/shopify-admin.types.js';
import {
  buildUnrunFulfillmentOrderCancellationClassification,
  classifyFulfillmentOrdersForAllocationRefund,
  type FulfillmentOrderCancellationClassificationResult,
} from '../shopify/shopify-fulfillment-order-cancel-classifier.service.js';
import {
  createOrLockOutboundShopifyRefundExecutionAttempt,
  createPreviewOutboundShopifyRefundAttempt,
  findActiveOutboundShopifyRefundAttemptForAllocation,
  findOpenOutboundShopifyRefundAttemptForAllocation,
  markOutboundShopifyRefundAttemptFailed,
  markOutboundShopifyRefundAttemptSubmitted,
  mapOutboundShopifyRefundAttemptSummary,
  OUTBOUND_SHOPIFY_REFUND_ATTEMPT_STATUSES,
} from './outbound-shopify-refund-attempt.service.js';
import {
  planAllocationSplitForLineItemReject,
  type AllocationSplitPlannerResult,
} from './allocation-split-planner.service.js';
import {
  splitAllocationForLineItemReject,
  type AllocationSplitServiceResult,
} from './allocation-split.service.js';
import { withDashboardTiming } from '../../lib/dashboard-timing.js';

function toAmountString(value: number) {
  return value.toFixed(2);
}

function toNullableAmountString(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? toAmountString(numeric) : null;
}

function computeTotalAmount(lineItems: Array<{ lineAmount: unknown; quantity: number }>) {
  return lineItems.reduce((sum, item) => {
    const numeric = Number(item.lineAmount ?? 0);
    if (!Number.isFinite(numeric)) {
      return sum;
    }

    return sum + numeric;
  }, 0);
}

function toNumber(value: unknown) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function toIsoString(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

function isActiveSaleLedger(entry: { entryType: string; voidedAt: Date | null }) {
  return entry.entryType.trim().toLowerCase() === 'sale' && !entry.voidedAt;
}

function buildReturnOwnershipSummary(input: {
  returnRecord: {
    ownerVendorId?: string | null;
    ownerVendor?: { id: string; name: string | null } | null;
  };
  allocation: {
    originalVendorId: string;
    assignedVendorId: string;
    originalVendor?: { id: string; name: string | null } | null;
    assignedVendor?: { id: string; name: string | null } | null;
    financeEntries?: Array<{
      vendorId: string;
      entryType: string;
      voidedAt: Date | null;
      vendor?: { id: string; name: string | null } | null;
    }>;
    economicTransfers?: Array<{
      status: string;
      fromVendorId: string;
      toVendorId: string;
      completedAt: Date | null;
      createdAt: Date;
      fromVendor?: { name: string | null } | null;
      toVendor?: { name: string | null } | null;
    }>;
  };
}): ReturnOwnershipSummaryDto {
  const activeSaleLedgers = (input.allocation.financeEntries ?? []).filter(isActiveSaleLedger);
  const activeSaleLedger = activeSaleLedgers.length === 1 ? activeSaleLedgers[0] : null;
  const latestTransfer = [...(input.allocation.economicTransfers ?? [])]
    .filter((transfer) => transfer.status.trim().toUpperCase() === 'COMPLETED')
    .sort((left, right) => {
      const rightTime = right.completedAt?.getTime() ?? right.createdAt.getTime();
      const leftTime = left.completedAt?.getTime() ?? left.createdAt.getTime();
      return rightTime - leftTime;
    })[0] ?? null;
  const ownershipSource: ReturnOwnershipSummaryDto['ownershipSource'] = input.returnRecord.ownerVendorId
    ? 'return_owner_snapshot'
    : activeSaleLedger
      ? 'active_sale_ledger'
      : input.allocation.assignedVendorId
        ? 'assigned_vendor'
        : 'unknown';

  return {
    originalVendorId: input.allocation.originalVendorId ?? null,
    originalVendorName: input.allocation.originalVendor?.name ?? null,
    assignedVendorId: input.allocation.assignedVendorId ?? null,
    assignedVendorName: input.allocation.assignedVendor?.name ?? null,
    returnOwnerVendorId: input.returnRecord.ownerVendorId ?? null,
    returnOwnerVendorName: input.returnRecord.ownerVendor?.name ?? null,
    refundFinanceOwnerVendorId: activeSaleLedger?.vendorId ?? null,
    refundFinanceOwnerVendorName: activeSaleLedger?.vendor?.name ?? null,
    economicOwnerVendorId: activeSaleLedger?.vendorId ?? null,
    economicOwnerVendorName: activeSaleLedger?.vendor?.name ?? null,
    ownershipSource,
    transferSummary: latestTransfer
      ? {
          fromVendorId: latestTransfer.fromVendorId,
          fromVendorName: latestTransfer.fromVendor?.name ?? null,
          toVendorId: latestTransfer.toVendorId,
          toVendorName: latestTransfer.toVendor?.name ?? null,
          transferCompletedAt: toIsoString(latestTransfer.completedAt),
        }
      : null,
  };
}

function mapAllocationSplitSummary(event: {
  id: string;
  sourceAllocationId: string;
  childAllocationId: string;
  reason: string;
  note?: string | null;
  actorUserId?: string | null;
  actorUser?: {
    name: string;
  } | null;
  createdAt: Date;
  childAllocation?: {
    lineItems?: Array<{
      id: string;
      quantity: number;
      lineAmount: unknown;
      shopifyOrderLineItem: {
        sourceLineItemId: string;
        sku?: string | null;
        title?: string | null;
      };
    }>;
  } | null;
} | null | undefined, allocationId?: string | null): AllocationSplitSummaryDto | null {
  if (!event) {
    return null;
  }

  const lineageRole: AllocationSplitSummaryDto['lineageRole'] =
    allocationId === event.sourceAllocationId ? 'source' : allocationId === event.childAllocationId ? 'child' : 'unknown';

  return {
    splitEventId: event.id,
    sourceAllocationId: event.sourceAllocationId,
    childAllocationId: event.childAllocationId,
    reason: event.reason,
    note: event.note ?? null,
    createdAt: event.createdAt.toISOString(),
    actorUserId: event.actorUserId ?? null,
    actorName: event.actorUser?.name ?? null,
    lineageRole,
    movedItems: (event.childAllocation?.lineItems ?? []).map((lineItem) => ({
      vendorAllocationLineItemId: lineItem.id,
      shopifyLineItemId: lineItem.shopifyOrderLineItem.sourceLineItemId,
      sku: lineItem.shopifyOrderLineItem.sku ?? null,
      title: lineItem.shopifyOrderLineItem.title ?? null,
      quantity: lineItem.quantity,
      lineAmount: toNumber(lineItem.lineAmount),
    })),
  };
}

function mapAllocationSplitPlannerResponse(result: AllocationSplitPlannerResult): AllocationSplitPlannerResponseDto {
  return {
    ok: true,
    writesPerformed: false,
    canSplit: result.canSplit,
    decision: result.decision,
    blockers: result.blockers,
    warnings: result.warnings,
    sourceAllocation: result.sourceAllocation,
    selectedLines: result.selectedLines,
    remainingLines: result.remainingLines,
    amountPlan: result.amountPlan,
    proposedChildAllocation: result.proposedChildAllocation,
  };
}

function mapAllocationSplitExecutionResponse(
  result: AllocationSplitServiceResult,
  input: { reason: string; note?: string | null; actorUserId?: string | null },
): AllocationSplitExecutionResponseDto {
  const splitSummary: AllocationSplitSummaryDto = {
    splitEventId: result.splitEventId,
    sourceAllocationId: result.sourceAllocationId,
    childAllocationId: result.childAllocationId,
    reason: input.reason,
    note: input.note ?? null,
    actorUserId: input.actorUserId ?? null,
    actorName: null,
    lineageRole: 'unknown',
    movedItems: [],
  };

  return {
    ok: true,
    splitSummary,
    sourceAllocationId: result.sourceAllocationId,
    childAllocationId: result.childAllocationId,
    sourceSaleLedgerId: result.sourceSaleLedgerId,
    remainingSaleLedgerId: result.remainingSaleLedgerId,
    childSaleLedgerId: result.childSaleLedgerId,
    idempotent: result.idempotent,
  };
}

export class OrderRejectValidationError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'OrderRejectValidationError';
    this.statusCode = statusCode;
  }
}

export type RejectVendorOrderInput = {
  reason?: string | null;
  note?: string | null;
  actorUserId?: string | null;
};

export type AdminAllocationResolutionInput = {
  note?: string | null;
  actorUserId?: string | null;
};

export type AdminEconomicTransferInput = {
  toVendorId: string;
  reason: string;
  actorUserId?: string | null;
};

export type AdminCancelRefundReviewInput = {
  reason?: string | null;
  note?: string | null;
  actorUserId?: string | null;
};

export type AdminEconomicTransferResponse = {
  ok: true;
  transfer: EconomicTransferResult;
  order: AdminOrderBreakdownDto;
};

export type ShopifySuggestedRefundPreviewService = {
  previewSuggestedRefund(input: PreviewSuggestedRefundInput): Promise<PreviewSuggestedRefundResult>;
  fetchFulfillmentOrdersForCancellationClassification(
    shopifyOrderId: string,
  ): Promise<ShopifyFulfillmentOrderCancellationClassificationResponse>;
};

export type ShopifyRefundExecutionService = ShopifySuggestedRefundPreviewService & {
  cancelFulfillmentOrder(input: { fulfillmentOrderId: string }): Promise<CancelFulfillmentOrderResult>;
  createShopifyRefund(input: CreateShopifyRefundInput): Promise<CreateShopifyRefundResult>;
};

export type AdminShopifyRefundPreviewInput = {
  restockType?: string | null;
  refundShipping?: boolean | null;
  actorUserId?: string | null;
  shopifyAdminService: ShopifySuggestedRefundPreviewService;
};

export type AdminShopifyRefundExecutionInput = {
  restockType?: string | null;
  refundShipping?: boolean | null;
  notifyCustomer?: boolean | null;
  note?: string | null;
  confirmRefund?: boolean | null;
  confirmPostRefundFulfillmentCheck?: boolean | null;
  confirmMixedFulfillmentOrderDirectRefundProbe?: boolean | null;
  actorUserId?: string | null;
  shopifyAdminService: ShopifyRefundExecutionService;
};

export type AdminShopifyRefundExecutionResponse = {
  ok: true;
  writesPerformed: true;
  status: 'SHOPIFY_ACTION_PENDING';
  shopifyRefundId: string | null;
  attemptId: string;
  message: string;
};

export type AdminShopifyRefundPreviewResponse = {
  ok: true;
  writesPerformed: false;
  allocationId: string;
  shopifyOrderId: string;
  refundLineItemsPreview: Array<{
    lineItemId: string;
    quantity: number;
    restockType: ShopifyRefundRestockType;
  }>;
  suggestedRefund: {
    totalRefundAmount: string | null;
    currencyCode: string | null;
    totalTaxAmount: string | null;
    shippingAmount: string | null;
    suggestedTransactions: Array<{
      gateway: string | null;
      amount: string | null;
      currencyCode: string | null;
      parentTransactionId: string | null;
    }>;
  } | null;
  fulfillmentOrderCancellation: FulfillmentOrderCancellationClassificationResult;
  warnings: string[];
  blockers: string[];
  missingData: string[];
  mixedFulfillmentOrderDirectRefundProbe: MixedFulfillmentOrderDirectRefundProbeEvaluation;
};

type MixedFulfillmentOrderDirectRefundProbeEvaluation = {
  eligible: boolean;
  code: 'mixed_fulfillment_order_direct_refund_probe';
  message: string;
  blockers: string[];
  warnings: string[];
  selectedLineItems: Array<{
    lineItemId: string;
    quantity: number;
  }>;
  sourceLineItems: Array<{
    lineItemId: string;
    preRefundRemainingQuantity: number;
  }>;
};

const BLOCKED_ALLOCATION_STATUSES = new Set<AllocationStatus>([
  AllocationStatus.VENDOR_BLOCKED,
  AllocationStatus.PENDING_REASSIGNMENT,
  AllocationStatus.REASSIGNED,
  AllocationStatus.FULFILLED,
]);

const SHIPPED_STATUS_VALUES = new Set(['shipped', 'delivered', 'in transit', 'in_transit', 'label created', 'label_created', 'partially_shipped']);
const FULFILLED_STATUS_VALUES = new Set(['fulfilled', 'partially fulfilled', 'partially_fulfilled']);
const REFUND_PREVIEW_RESTOCK_TYPES = new Set<ShopifyRefundRestockType>(['CANCEL', 'NO_RESTOCK']);

function normalizeRejectReason(reason: string | null | undefined): CancellationReason {
  const normalized = reason?.trim().toUpperCase();
  if (!normalized || !Object.values(CancellationReason).includes(normalized as CancellationReason)) {
    throw new OrderRejectValidationError('Reject reason is required.');
  }
  return normalized as CancellationReason;
}

function normalizeRejectNote(note: string | null | undefined) {
  const normalized = note?.trim() ?? '';
  if (!normalized) {
    throw new OrderRejectValidationError('Reject note is required.');
  }
  if (normalized.length > 500) {
    throw new OrderRejectValidationError('Reject note must be 500 characters or fewer.');
  }
  return normalized;
}

function normalizeAdminResolutionNote(note: string | null | undefined) {
  const normalized = note?.trim() ?? '';
  if (!normalized) {
    throw new OrderRejectValidationError('Admin resolution note is required.');
  }
  if (normalized.length > 500) {
    throw new OrderRejectValidationError('Admin resolution note must be 500 characters or fewer.');
  }
  return normalized;
}

function normalizeCancelRefundReviewNote(note: string | null | undefined) {
  const normalized = note?.trim() ?? '';
  if (!normalized) {
    throw new OrderRejectValidationError('Cancel/refund review note is required.');
  }
  if (normalized.length > 1000) {
    throw new OrderRejectValidationError('Cancel/refund review note must be 1000 characters or fewer.');
  }
  return normalized;
}

function normalizeStatus(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? '';
}

function normalizeShopifyRefundPreviewRestockType(value: string | null | undefined): ShopifyRefundRestockType {
  const normalized = value?.trim().toUpperCase() ?? '';
  if (!REFUND_PREVIEW_RESTOCK_TYPES.has(normalized as ShopifyRefundRestockType)) {
    throw new OrderRejectValidationError('Refund preview restockType must be CANCEL or NO_RESTOCK.', 400);
  }
  return normalized as ShopifyRefundRestockType;
}

function sanitizeFulfillmentOrderClassifierError(error: unknown) {
  const fallback = 'Fulfillment order cancellation classifier failed before returning details.';
  const rawMessage = error instanceof Error ? error.message : fallback;
  const sanitized = rawMessage
    .replace(/(x-shopify-access-token|shopify_admin_access_token|access_token|token)\s*[:=]\s*[^,\s;]+/gi, '$1=[redacted]')
    .replace(/\s+/g, ' ')
    .trim();

  return sanitized.slice(0, 500) || fallback;
}

function normalizeShopifyIdentifier(value: string | null | undefined) {
  const text = value?.trim() ?? '';
  if (!text) {
    return '';
  }
  return text.split('/').at(-1)?.trim().toLowerCase() || text.toLowerCase();
}

function normalizeShopifyAction(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? '';
}

function hasDirectFulfillmentOrderCancelAction(actions: string[] | null | undefined) {
  return (actions ?? []).some((action) => {
    const normalized = normalizeShopifyAction(action);
    return normalized === 'cancel' || normalized === 'cancel_fulfillment_order';
  });
}

function hasFulfillmentOrderSplitAction(actions: string[] | null | undefined) {
  return (actions ?? []).some((action) => normalizeShopifyAction(action) === 'split');
}

function buildMixedFulfillmentOrderDirectRefundProbeEvaluation(
  overrides: Partial<MixedFulfillmentOrderDirectRefundProbeEvaluation> = {},
): MixedFulfillmentOrderDirectRefundProbeEvaluation {
  return {
    eligible: false,
    code: 'mixed_fulfillment_order_direct_refund_probe',
    message:
      'Mixed fulfillment order direct refundCreate probe is not available for this allocation.',
    blockers: [],
    warnings: [],
    selectedLineItems: [],
    sourceLineItems: [],
    ...overrides,
  };
}

function evaluateMixedFulfillmentOrderDirectRefundProbe(input: {
  allocation: {
    id: string;
    allocationStatus?: string | null;
    childAllocationSplitEvents?: Array<{ id: string }>;
  };
  selectedLineItems: Array<{
    lineItemId: string;
    quantity: number;
  }>;
  fulfillmentOrderCancellation: FulfillmentOrderCancellationClassificationResult;
}) {
  const blockers: string[] = [];
  const selectedLineItems = input.selectedLineItems
    .map((lineItem) => ({
      lineItemId: lineItem.lineItemId,
      quantity: lineItem.quantity,
    }))
    .filter((lineItem) => normalizeShopifyIdentifier(lineItem.lineItemId));
  const selectedLineItemIds = new Set(selectedLineItems.map((lineItem) => normalizeShopifyIdentifier(lineItem.lineItemId)));

  if ((input.allocation.childAllocationSplitEvents ?? []).length === 0) {
    blockers.push('Controlled mixed fulfillment order refund probe is only available for split child allocations.');
  }
  if (input.allocation.allocationStatus?.trim().toUpperCase() !== AllocationStatus.VENDOR_BLOCKED) {
    blockers.push('Controlled mixed fulfillment order refund probe requires a vendor-blocked allocation.');
  }
  if (input.fulfillmentOrderCancellation.overallClassification !== 'blocked') {
    blockers.push('Controlled mixed fulfillment order refund probe requires a blocked mixed fulfillment order classification.');
  }

  const mixedAffectedOrders = input.fulfillmentOrderCancellation.affectedFulfillmentOrders.filter(
    (order) => order.classification === 'unsafe_mixed_fulfillment_order',
  );
  if (mixedAffectedOrders.length !== 1) {
    blockers.push('Controlled mixed fulfillment order refund probe requires exactly one affected mixed fulfillment order.');
  }

  const affectedOrder = mixedAffectedOrders[0];
  const sourceLineItems: MixedFulfillmentOrderDirectRefundProbeEvaluation['sourceLineItems'] = [];

  if (affectedOrder) {
    if (normalizeShopifyAction(affectedOrder.status) !== 'open') {
      blockers.push('Controlled mixed fulfillment order refund probe requires Shopify fulfillment order status OPEN.');
    }
    if (normalizeShopifyAction(affectedOrder.requestStatus) !== 'unsubmitted') {
      blockers.push('Controlled mixed fulfillment order refund probe requires Shopify fulfillment order requestStatus UNSUBMITTED.');
    }
    if (!hasFulfillmentOrderSplitAction(affectedOrder.supportedActions)) {
      blockers.push('Controlled mixed fulfillment order refund probe requires Shopify fulfillment order SPLIT support.');
    }
    if (hasDirectFulfillmentOrderCancelAction(affectedOrder.supportedActions)) {
      blockers.push('Controlled mixed fulfillment order refund probe is not used when Shopify advertises a direct cancel action.');
    }
    if (!affectedOrder.assignedLocationId?.trim()) {
      blockers.push('Missing Shopify locationId required for restockType CANCEL.');
    }

    const selectedLinesInFulfillmentOrder = affectedOrder.lineItems.filter((lineItem) => lineItem.selected);
    const selectedLinesInFulfillmentOrderIds = new Set(
      selectedLinesInFulfillmentOrder.map((lineItem) => normalizeShopifyIdentifier(lineItem.shopifyLineItemId)),
    );
    for (const selectedLineItem of selectedLineItems) {
      if (!selectedLinesInFulfillmentOrderIds.has(normalizeShopifyIdentifier(selectedLineItem.lineItemId))) {
        blockers.push(`Selected Shopify line item ${selectedLineItem.lineItemId} was not found in the affected fulfillment order.`);
      }
    }

    for (const lineItem of affectedOrder.lineItems) {
      if (lineItem.selected) {
        if (lineItem.ownerAllocationId !== input.allocation.id) {
          blockers.push(`Selected Shopify line item ${lineItem.shopifyLineItemId} is not owned by the split child allocation.`);
        }
        if (lineItem.remainingQuantity === null || !Number.isFinite(lineItem.remainingQuantity)) {
          blockers.push(`Fulfillment order line item ${lineItem.fulfillmentOrderLineItemId} is missing remainingQuantity.`);
        } else if (lineItem.selectedQuantity !== lineItem.remainingQuantity) {
          blockers.push(`Selected Shopify line item ${lineItem.shopifyLineItemId} quantity does not match remainingQuantity.`);
        }
        if (!selectedLineItemIds.has(normalizeShopifyIdentifier(lineItem.shopifyLineItemId))) {
          blockers.push(`Fulfillment order selected line item ${lineItem.shopifyLineItemId} is not part of the refundCreate input.`);
        }
        continue;
      }

      if (!lineItem.ownerAllocationId) {
        blockers.push(`Mixed fulfillment order line item ${lineItem.shopifyLineItemId} has no local allocation owner.`);
        continue;
      }
      if (lineItem.ownerAllocationId === input.allocation.id) {
        blockers.push(`Split child line item ${lineItem.shopifyLineItemId} is present in the fulfillment order but not selected for refund.`);
        continue;
      }
      if (lineItem.remainingQuantity === null || !Number.isFinite(lineItem.remainingQuantity) || lineItem.remainingQuantity <= 0) {
        blockers.push(`Source allocation line item ${lineItem.shopifyLineItemId} is not currently fulfillable in Shopify.`);
        continue;
      }

      sourceLineItems.push({
        lineItemId: lineItem.shopifyLineItemId,
        preRefundRemainingQuantity: lineItem.remainingQuantity,
      });
    }
  }

  if (sourceLineItems.length === 0) {
    blockers.push('Controlled mixed fulfillment order refund probe requires at least one source allocation line to remain fulfillable.');
  }

  const eligible = blockers.length === 0;
  return buildMixedFulfillmentOrderDirectRefundProbeEvaluation({
    eligible,
    message: eligible
      ? 'Controlled mixed fulfillment order direct refundCreate probe is available. It bypasses fulfillmentOrderCancel and requires post-refund Shopify fulfillment verification.'
      : 'Mixed fulfillment order direct refundCreate probe is blocked by safety gates.',
    blockers,
    warnings: eligible
      ? [
          'Controlled probe only: refundCreate will run without fulfillmentOrderCancel, then Shopify fulfillment remainingQuantity will be rechecked.',
        ]
      : [],
    selectedLineItems,
    sourceLineItems,
  });
}

function refundRestockTypeRequiresLocation(restockType: ShopifyRefundRestockType) {
  return restockType === 'CANCEL';
}

function resolveRefundLineItemLocationIds(input: {
  refundLineItems: CreateShopifyRefundInput['refundLineItems'];
  fulfillmentOrderCancellation: FulfillmentOrderCancellationClassificationResult;
}) {
  const locationIdsByLineItemId = new Map<string, string>();
  for (const lineItem of input.refundLineItems) {
    if (!refundRestockTypeRequiresLocation(lineItem.restockType)) {
      continue;
    }

    const normalizedLineItemId = normalizeShopifyIdentifier(lineItem.lineItemId);
    const matchingLocationIds = new Set<string>();
    let missingLocation = false;

    for (const fulfillmentOrder of input.fulfillmentOrderCancellation.affectedFulfillmentOrders) {
      const hasSelectedLineItem = fulfillmentOrder.lineItems.some(
        (fulfillmentOrderLineItem) =>
          fulfillmentOrderLineItem.selected &&
          normalizeShopifyIdentifier(fulfillmentOrderLineItem.shopifyLineItemId) === normalizedLineItemId,
      );
      if (!hasSelectedLineItem) {
        continue;
      }

      const locationId = fulfillmentOrder.assignedLocationId?.trim();
      if (!locationId) {
        missingLocation = true;
        continue;
      }
      matchingLocationIds.add(locationId);
    }

    if (missingLocation || matchingLocationIds.size === 0) {
      throw new OrderRejectValidationError('Missing Shopify locationId required for restockType CANCEL.', 409);
    }
    if (matchingLocationIds.size > 1) {
      throw new OrderRejectValidationError('Conflicting Shopify locationIds found for restockType CANCEL.', 409);
    }

    locationIdsByLineItemId.set(normalizedLineItemId, Array.from(matchingLocationIds)[0]);
  }

  return locationIdsByLineItemId;
}

function attachRefundLineItemLocationIds(input: {
  refundLineItems: CreateShopifyRefundInput['refundLineItems'];
  locationIdsByLineItemId: Map<string, string>;
}) {
  return input.refundLineItems.map((lineItem) => {
    if (!refundRestockTypeRequiresLocation(lineItem.restockType)) {
      return lineItem;
    }

    const locationId = input.locationIdsByLineItemId.get(normalizeShopifyIdentifier(lineItem.lineItemId));
    if (!locationId) {
      throw new OrderRejectValidationError('Missing Shopify locationId required for restockType CANCEL.', 409);
    }

    return {
      ...lineItem,
      locationId,
    };
  });
}

function isTerminalOrInactiveFulfillmentOrderStatus(status: string | null | undefined) {
  return ['closed', 'cancelled', 'canceled', 'incomplete'].includes(normalizeStatus(status));
}

function buildPostRefundFulfillmentCheck(input: {
  preCheck: FulfillmentOrderCancellationClassificationResult;
  postCheck: ShopifyFulfillmentOrderCancellationClassificationResponse;
  selectedLineItems: Array<{
    lineItemId: string;
    quantity: number;
  }>;
  sourceLineItems?: Array<{
    lineItemId: string;
    preRefundRemainingQuantity: number;
  }>;
  mode?: 'standard_open_unsubmitted' | 'mixed_fulfillment_order_direct_refund_probe';
}) {
  const selectedLineItemIds = new Set(input.selectedLineItems.map((lineItem) => normalizeShopifyIdentifier(lineItem.lineItemId)).filter(Boolean));
  const sourceLineItemIds = new Set((input.sourceLineItems ?? []).map((lineItem) => normalizeShopifyIdentifier(lineItem.lineItemId)).filter(Boolean));
  const inspectedFulfillmentOrders = input.postCheck.fulfillmentOrders.map((fulfillmentOrder) => ({
    fulfillmentOrderId: fulfillmentOrder.id,
    status: fulfillmentOrder.status,
    requestStatus: fulfillmentOrder.requestStatus,
    supportedActions: fulfillmentOrder.supportedActions,
    assignedLocationId: fulfillmentOrder.assignedLocationId,
    lineItems: fulfillmentOrder.lineItems
      .filter((lineItem) => {
        const normalizedLineItemId = normalizeShopifyIdentifier(lineItem.lineItemId);
        return selectedLineItemIds.has(normalizedLineItemId) || sourceLineItemIds.has(normalizedLineItemId);
      })
      .map((lineItem) => ({
        fulfillmentOrderLineItemId: lineItem.id,
        shopifyLineItemId: lineItem.lineItemId,
        role: selectedLineItemIds.has(normalizeShopifyIdentifier(lineItem.lineItemId)) ? 'selected_refund_line' : 'source_line',
        remainingQuantity: lineItem.remainingQuantity,
        totalQuantity: lineItem.totalQuantity,
      })),
  }));

  const activeFulfillableLineItems = inspectedFulfillmentOrders.flatMap((fulfillmentOrder) => {
    if (isTerminalOrInactiveFulfillmentOrderStatus(fulfillmentOrder.status)) {
      return [];
    }

    return fulfillmentOrder.lineItems
      .filter(
        (lineItem) =>
          lineItem.role === 'selected_refund_line' &&
          (lineItem.remainingQuantity === null || lineItem.remainingQuantity > 0),
      )
      .map((lineItem) => ({
        fulfillmentOrderId: fulfillmentOrder.fulfillmentOrderId,
        status: fulfillmentOrder.status,
        requestStatus: fulfillmentOrder.requestStatus,
        shopifyLineItemId: lineItem.shopifyLineItemId,
        remainingQuantity: lineItem.remainingQuantity,
      }));
  });

  const sourceLineItemsWithoutFulfillableQuantity = (input.sourceLineItems ?? []).filter((sourceLineItem) => {
    const normalizedSourceLineItemId = normalizeShopifyIdentifier(sourceLineItem.lineItemId);
    return !inspectedFulfillmentOrders.some((fulfillmentOrder) => {
      if (isTerminalOrInactiveFulfillmentOrderStatus(fulfillmentOrder.status)) {
        return false;
      }
      return fulfillmentOrder.lineItems.some(
        (lineItem) =>
          lineItem.role === 'source_line' &&
          normalizeShopifyIdentifier(lineItem.shopifyLineItemId) === normalizedSourceLineItemId &&
          lineItem.remainingQuantity !== null &&
          lineItem.remainingQuantity > 0,
      );
    });
  });

  const selectedLineItemsWithoutZeroRemainingQuantity =
    input.mode === 'mixed_fulfillment_order_direct_refund_probe'
      ? input.selectedLineItems.filter((selectedLineItem) => {
          const normalizedSelectedLineItemId = normalizeShopifyIdentifier(selectedLineItem.lineItemId);
          return !inspectedFulfillmentOrders.some((fulfillmentOrder) =>
            fulfillmentOrder.lineItems.some(
              (lineItem) =>
                lineItem.role === 'selected_refund_line' &&
                normalizeShopifyIdentifier(lineItem.shopifyLineItemId) === normalizedSelectedLineItemId &&
                lineItem.remainingQuantity === 0,
            ),
          );
        })
      : [];

  const passed =
    activeFulfillableLineItems.length === 0 &&
    sourceLineItemsWithoutFulfillableQuantity.length === 0 &&
    selectedLineItemsWithoutZeroRemainingQuantity.length === 0;
  const failedBecauseSelectedLinesStillFulfillable = activeFulfillableLineItems.length > 0;
  return {
    status: passed ? 'passed' : 'warning',
    message: passed
      ? 'Refunded line items are no longer fulfillable in active Shopify fulfillment orders.'
      : failedBecauseSelectedLinesStillFulfillable
        ? 'Refund was submitted, but Shopify still shows fulfillable quantity. Manual attention required.'
        : selectedLineItemsWithoutZeroRemainingQuantity.length > 0
          ? 'Refund was submitted, but Shopify did not confirm selected child lines at remainingQuantity 0. Manual attention required.'
          : 'Refund was submitted, but Shopify no longer shows source allocation lines as fulfillable. Manual attention required.',
    mode: input.mode ?? 'standard_open_unsubmitted',
    preCheck: input.preCheck,
    postCheck: {
      source: input.postCheck.source,
      fulfillmentOrders: inspectedFulfillmentOrders,
    },
    activeFulfillableLineItems,
    sourceLineItemsWithoutFulfillableQuantity,
    selectedLineItemsWithoutZeroRemainingQuantity,
  };
}

function normalizeShopifyRefundExecutionNote(note: string | null | undefined) {
  const normalized = note?.trim() ?? '';
  if (!normalized) {
    throw new OrderRejectValidationError('Shopify refund note is required.', 400);
  }
  if (normalized.length > 1000) {
    throw new OrderRejectValidationError('Shopify refund note must be 1000 characters or fewer.', 400);
  }
  return normalized;
}

function hasSettlementPayoutOrLogoEvidence(allocation: {
  financeEntries?: Array<{
    payoutStatus?: string | null;
    payoutBatchLines?: Array<{ payoutBatch?: { status?: string | null } | null }>;
    settlementApprovalLines?: Array<{
      settlementApproval?: {
        status?: string | null;
        commissionInvoices?: Array<{ status?: string | null }>;
      } | null;
    }>;
  }>;
}) {
  return (allocation.financeEntries ?? []).some((entry) => {
    if (normalizeStatus(entry.payoutStatus) === 'paid') {
      return true;
    }

    if ((entry.payoutBatchLines ?? []).some((line) => normalizeStatus(line.payoutBatch?.status) !== 'cancelled')) {
      return true;
    }

    return (entry.settlementApprovalLines ?? []).some((line) => {
      const settlementStatus = normalizeStatus(line.settlementApproval?.status);
      if (settlementStatus && settlementStatus !== 'cancelled') {
        return true;
      }

      return (line.settlementApproval?.commissionInvoices ?? []).some((invoice) => normalizeStatus(invoice.status) !== 'cancelled');
    });
  });
}

const TERMINAL_RETURN_STATUS_TOKENS = ['closed', 'cancelled', 'canceled', 'declined', 'rejected', 'deleted'];

function hasActiveReturnState(allocation: {
  returnRecords: Array<{
    status: string;
    returnLifecycleStatus: string | null;
  }>;
}) {
  return allocation.returnRecords.some((record) => {
    const normalized = `${record.status ?? ''} ${record.returnLifecycleStatus ?? ''}`.trim().toLowerCase();
    if (!normalized) {
      return true;
    }
    return !TERMINAL_RETURN_STATUS_TOKENS.some((token) => normalized.includes(token));
  });
}

function hasRefundState(allocation: {
  refundRecords: Array<unknown>;
}) {
  return allocation.refundRecords.length > 0;
}

function hasShipmentEvidence(allocation: {
  trackingNumber: string | null;
  carrier: string | null;
  fulfillmentStatus: string;
  shippingStatus: string;
  fulfillment: {
    fulfilledAt: Date | null;
    shipmentCreatedAt: Date | null;
    shipmentUpdatedAt: Date | null;
    shopifyFulfillmentId: string | null;
    trackingNumber: string | null;
    trackingUrl: string | null;
  } | null;
  shipmentExecutions: Array<{
    providerShipmentId: string | null;
    trackingNumber: string | null;
    trackingUrl: string | null;
    shipmentStatus: ShipmentExecutionStatus;
  }>;
}) {
  if (FULFILLED_STATUS_VALUES.has(normalizeStatus(allocation.fulfillmentStatus))) {
    return true;
  }
  if (SHIPPED_STATUS_VALUES.has(normalizeStatus(allocation.shippingStatus))) {
    return true;
  }
  if (allocation.trackingNumber?.trim() || allocation.carrier?.trim()) {
    return true;
  }
  if (
    allocation.fulfillment?.fulfilledAt ||
    allocation.fulfillment?.shipmentCreatedAt ||
    allocation.fulfillment?.shipmentUpdatedAt ||
    allocation.fulfillment?.shopifyFulfillmentId ||
    allocation.fulfillment?.trackingNumber?.trim() ||
    allocation.fulfillment?.trackingUrl?.trim()
  ) {
    return true;
  }

  return allocation.shipmentExecutions.some((execution) => {
    if (execution.providerShipmentId?.trim() || execution.trackingNumber?.trim() || execution.trackingUrl?.trim()) {
      return true;
    }
    return execution.shipmentStatus !== ShipmentExecutionStatus.FAILED && execution.shipmentStatus !== ShipmentExecutionStatus.CANCELLED;
  });
}

export type ShopifyLineItemImageLookupService = {
  fetchOrderLineItemImages(orderId: string): Promise<FetchOrderLineItemImagesResult>;
};

export type OrderDetailLineItemRecord = {
  shopifyOrderLineItem: {
    id: string;
    sourceLineItemId: string;
    sku: string | null;
    imageUrl: string | null;
  };
};

export async function backfillMissingLineItemImages(
  allocation: {
    order: { sourceShopifyOrderId: string };
    lineItems: OrderDetailLineItemRecord[];
  },
  shopifyAdminService?: ShopifyLineItemImageLookupService,
) {
  const missingItems = allocation.lineItems.filter((item) => !item.shopifyOrderLineItem.imageUrl);
  if (!shopifyAdminService || missingItems.length === 0 || !allocation.order.sourceShopifyOrderId) {
    return new Map<string, string>();
  }

  if (!missingItems.some((item) => item.shopifyOrderLineItem.sourceLineItemId || item.shopifyOrderLineItem.sku)) {
    return new Map<string, string>();
  }

  try {
    const imageResult = await shopifyAdminService.fetchOrderLineItemImages(allocation.order.sourceShopifyOrderId);
    const byLineItemId = new Map<string, string>();
    const bySku = new Map<string, string>();

    for (const image of imageResult.lineItems) {
      const imageUrl = image.imageUrl?.trim();
      if (!imageUrl) {
        continue;
      }

      if (image.sourceLineItemId) {
        byLineItemId.set(image.sourceLineItemId, imageUrl);
      }

      if (image.lineItemGid) {
        byLineItemId.set(image.lineItemGid, imageUrl);
        const gidTail = image.lineItemGid.split('/').at(-1)?.trim();
        if (gidTail) {
          byLineItemId.set(gidTail, imageUrl);
        }
      }

      if (image.sku) {
        bySku.set(image.sku, imageUrl);
      }
    }

    const resolved = new Map<string, string>();
    await Promise.all(
      missingItems.map(async (item) => {
        const line = item.shopifyOrderLineItem;
        const imageUrl = byLineItemId.get(line.sourceLineItemId) ?? (line.sku ? bySku.get(line.sku) : undefined);
        if (!imageUrl) {
          return;
        }

        await prisma.shopifyOrderLineItem.updateMany({
          where: {
            id: line.id,
            imageUrl: null,
          },
          data: {
            imageUrl,
          },
        });
        resolved.set(line.id, imageUrl);
      }),
    );

    return resolved;
  } catch (error) {
    console.warn('[orders] Shopify line item image backfill failed; returning existing order detail.', {
      sourceShopifyOrderId: allocation.order.sourceShopifyOrderId,
      errorMessage: error instanceof Error ? error.message : 'Unknown Shopify line item image backfill error.',
    });
    return new Map<string, string>();
  }
}

function mapShopifyFulfillmentSync(
  fulfillment:
    | {
        shopifyFulfillmentOrderId: string | null;
        shopifyFulfillmentId: string | null;
        syncStatus: string | null;
        errorMessage: string | null;
        trackingNumber: string | null;
        updatedAt: Date;
      }
    | null
    | undefined,
  allocation: { trackingNumber: string | null; carrier: string | null; trackingUrl?: string | null },
): ShopifyFulfillmentSyncDto {
  const fulfillmentOrderIdPresent = Boolean(fulfillment?.shopifyFulfillmentOrderId);
  const fulfillmentIdPresent = Boolean(fulfillment?.shopifyFulfillmentId);
  const localTrackingPresent = Boolean(
    allocation.trackingNumber || allocation.carrier || allocation.trackingUrl || fulfillment?.trackingNumber,
  );
  const failed = fulfillment?.syncStatus === 'fulfillment_sync_failed' || Boolean(fulfillment?.errorMessage);
  const status = fulfillmentIdPresent
    ? 'synced'
    : failed
      ? 'failed'
      : localTrackingPresent
        ? 'pending'
        : 'not_available';

  return {
    status,
    fulfillmentOrderIdPresent,
    fulfillmentIdPresent,
    syncStatus: fulfillment?.syncStatus ?? null,
    skippedReason: null,
    errorMessage: fulfillment?.errorMessage ?? null,
    lastAttemptedAt: fulfillment ? fulfillment.updatedAt.toISOString() : null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readString(value: Record<string, unknown> | null, keys: string[]) {
  if (!value) {
    return null;
  }

  for (const key of keys) {
    const raw = value[key];
    if (typeof raw === 'string' && raw.trim()) {
      return raw.trim().length > 220 ? `${raw.trim().slice(0, 217)}...` : raw.trim();
    }
  }

  return null;
}

function readStringOrNumber(value: Record<string, unknown> | null, keys: string[]) {
  const text = readString(value, keys);
  if (text) {
    return text;
  }

  if (!value) {
    return null;
  }

  for (const key of keys) {
    const raw = value[key];
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      return String(raw);
    }
  }

  return null;
}

function readBoolean(value: Record<string, unknown> | null, keys: string[]) {
  if (!value) {
    return false;
  }

  return keys.some((key) => value[key] === true);
}

function readStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function readTryOtoWebhookAuthenticityVerification(value: unknown): {
  mode: 'shared_secret' | 'disabled_dev_only';
  providerNativeSignatureVerified: false;
  note: string;
} | null {
  if (!isRecord(value)) {
    return null;
  }

  return {
    mode: readString(value, ['mode']) === 'shared_secret' ? 'shared_secret' : 'disabled_dev_only',
    providerNativeSignatureVerified: false,
    note: readString(value, ['note']) ?? 'Provider-native Try OTO signature semantics remain unknown.',
  };
}

const NAVLUNGO_UPDATE_RECIPIENT_OVERRIDE_FIELDS = [
  'name',
  'phone',
  'email',
  'country',
  'postcode',
  'city',
  'district',
  'address',
] as const;

function readNavlungoUpdateRecipientOverrides(value: unknown) {
  if (!isRecord(value)) {
    return {};
  }

  return Object.fromEntries(
    NAVLUNGO_UPDATE_RECIPIENT_OVERRIDE_FIELDS
      .map((field) => {
        const raw = value[field];
        return [field, typeof raw === 'string' ? raw.trim() : ''] as const;
      })
      .filter(([, raw]) => raw.length > 0),
  );
}

function redactValidationDiagnosticText(value: string) {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]')
    .replace(/\+?\d[\d\s().-]{7,}\d/g, '[redacted-phone]')
    .trim();
}

function readValidationStringArray(value: unknown) {
  return readStringArray(value)
    .map(redactValidationDiagnosticText)
    .filter(Boolean);
}

function mergeUniqueStrings(...groups: string[][]) {
  return Array.from(new Set(groups.flat().map((value) => value.trim()).filter(Boolean)));
}

function readNumber(value: Record<string, unknown> | null, keys: string[]) {
  if (!value) {
    return null;
  }

  for (const key of keys) {
    const numeric = Number(value[key]);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }

  return null;
}

function readStringFieldArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => String(item ?? '').trim()).filter(Boolean);
}

function readShopifyUserErrors(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isRecord).map((error) => ({
    field: readStringFieldArray(error.field),
    message: readString(error, ['message']) ?? 'Unknown Shopify user error.',
  }));
}

function readRecord(value: Record<string, unknown> | null, key: string) {
  if (!value) {
    return null;
  }

  const raw = value[key];
  return isRecord(raw) ? raw : null;
}

function readShipmentProviderCarrierName(snapshot: Record<string, unknown> | null) {
  return (
    readString(snapshot, ['selectedDeliveryCompanyName', 'deliveryCompany', 'deliveryCompanyName']) ??
    readString(readRecord(snapshot, 'deliveryOptionLookup'), ['selectedDeliveryCompanyName', 'deliveryCompanyName'])
  );
}

function readShipmentTimeline(value: Record<string, unknown> | null) {
  const events = Array.isArray(value?.timeline) ? value.timeline : [];
  return events
    .filter(isRecord)
    .map((event) => ({
      label: readString(event, ['label']) ?? 'Shipment update',
      at: readString(event, ['at']) ?? new Date().toISOString(),
      status: readString(event, ['status']),
    }));
}

function mapShopifyReturnLabelUploadProbe(returnShipment: Record<string, unknown>) {
  const probe = readRecord(returnShipment, 'shopifyReturnLabelUploadProbe');
  if (!probe) {
    return null;
  }
  const skippedReason = readString(probe, ['skippedReason']);
  const isLegacyMissingLabelGate = skippedReason === 'missing_return_label_url';

  return {
    status: isLegacyMissingLabelGate ? 'tracking_only_ready' : readString(probe, ['status']) ?? 'not_started',
    attemptedAt: readString(probe, ['attemptedAt']),
    reverseFulfillmentOrderIdPresent: readBoolean(probe, ['reverseFulfillmentOrderIdPresent']),
    reverseLineItemIdsPresent: readBoolean(probe, ['reverseLineItemIdsPresent']),
    mutationUsed: readString(probe, ['mutationUsed']),
    shopifyUserErrors: readShopifyUserErrors(probe.shopifyUserErrors),
    reverseDeliveryIdPresent: readBoolean(probe, ['reverseDeliveryIdPresent']),
    shopifyReturnIdPresent: readBoolean(probe, ['shopifyReturnIdPresent']),
    trackingAccepted: readBoolean(probe, ['trackingAccepted']),
    labelAccepted: readBoolean(probe, ['labelAccepted']),
    returnedCarrierName: readString(probe, ['returnedCarrierName']),
    carrierNamePresent: readBoolean(probe, ['carrierNamePresent']),
    trackingOnlyMode: isLegacyMissingLabelGate || readBoolean(probe, ['trackingOnlyMode']),
    labelInputSent: readBoolean(probe, ['labelInputSent']),
    shopifyCallAttempted: readBoolean(probe, ['shopifyCallAttempted']),
    skippedReason: isLegacyMissingLabelGate ? 'return_label_url_missing_tracking_only' : skippedReason,
    errorMessage: isLegacyMissingLabelGate
      ? 'Return label URL missing; probing Shopify with tracking only.'
      : readString(probe, ['errorMessage']),
  };
}

function mapTryOtoReturnDiagnostics(returnShipment: Record<string, unknown>) {
  const diagnostics = readRecord(returnShipment, 'diagnostics');
  if (!diagnostics) {
    return null;
  }
  const normalizedReturnLabelUrl = readTryOtoReturnLabelUrl(returnShipment);
  const normalizedReturnLabelSource = readString(returnShipment, [
    'printReturnAWBURL',
    'printReturnAWBUrl',
    'printReturnAwbURL',
    'printReturnAwbUrl',
  ])
    ? 'returnShipment.printReturnAWBURL'
    : normalizedReturnLabelUrl
      ? 'returnShipment.labelUrl'
      : null;

  return {
    endpoint: readString(diagnostics, ['endpoint']),
    httpStatus: readNumber(diagnostics, ['httpStatus']),
    requestKeys: readStringArray(diagnostics.requestKeys),
    responseKeys: readStringArray(diagnostics.responseKeys),
    returnProviderIdPresent: readBoolean(diagnostics, ['returnProviderIdPresent']),
    returnTrackingPresent: readBoolean(diagnostics, ['returnTrackingPresent']),
    returnBarcodePresent: readBoolean(diagnostics, ['returnBarcodePresent']),
    returnStatus: readString(diagnostics, ['returnStatus']),
    returnCarrierName: readString(diagnostics, ['returnCarrierName']),
    labelFieldPresent: Boolean(normalizedReturnLabelUrl) || readBoolean(diagnostics, ['labelFieldPresent']),
    returnLabelSourceChecked: readString(diagnostics, ['returnLabelSourceChecked']) ?? normalizedReturnLabelSource,
    returnTrackingSourceChecked: readString(diagnostics, ['returnTrackingSourceChecked']),
    rawPrintReturnAwbUrlPresent: readBoolean(diagnostics, ['rawPrintReturnAwbUrlPresent']),
    normalizedReturnLabelUrlPresent: Boolean(normalizedReturnLabelUrl) || readBoolean(diagnostics, ['normalizedReturnLabelUrlPresent']),
    returnLabelPersistenceStage: readString(diagnostics, ['returnLabelPersistenceStage']),
    returnLabelOverwrittenByStaleSnapshot: readBoolean(diagnostics, ['returnLabelOverwrittenByStaleSnapshot']),
    providerMessage: readString(diagnostics, ['providerMessage']),
    returnSkippedReason: readString(diagnostics, ['returnSkippedReason', 'skippedReason']),
    forwardDeliveryOptionIdPresent: readBoolean(diagnostics, ['forwardDeliveryOptionIdPresent']),
    forwardDeliveryOptionIdSource: readString(diagnostics, ['forwardDeliveryOptionIdSource']),
    forwardDeliveryOptionPersistedAt: readString(diagnostics, ['forwardDeliveryOptionPersistedAt']),
    forwardDeliveryOptionRetainedAfterWebhook: readBoolean(diagnostics, ['forwardDeliveryOptionRetainedAfterWebhook']),
    forwardDeliveryOptionRetainedAfterStatusRefresh: readBoolean(diagnostics, ['forwardDeliveryOptionRetainedAfterStatusRefresh']),
    returnDeliveryOptionIdPresent: readBoolean(diagnostics, ['returnDeliveryOptionIdPresent']),
    returnDeliveryOptionIdSource: readString(diagnostics, ['returnDeliveryOptionIdSource']),
    pickupLocationCodePresent: readBoolean(diagnostics, ['pickupLocationCodePresent']),
    returnItemSkuPresent: readBoolean(diagnostics, ['returnItemSkuPresent']),
    returnItemQuantityPresent: readBoolean(diagnostics, ['returnItemQuantityPresent']),
    createReturnShipmentFinalized: readBoolean(diagnostics, ['createReturnShipmentFinalized']),
    returnDeliveryOptionLookupCalled: readBoolean(diagnostics, ['returnDeliveryOptionLookupCalled']),
    returnDeliveryOptionLookupImplemented: readBoolean(diagnostics, ['returnDeliveryOptionLookupImplemented']),
    returnPriceLookupCalled: readBoolean(diagnostics, ['returnPriceLookupCalled']),
    returnPriceLookupSuccess: readBoolean(diagnostics, ['returnPriceLookupSuccess']),
    returnPriceLookupOptionCount: readNumber(diagnostics, ['returnPriceLookupOptionCount']),
    selectedReturnPriceOptionIdPresent: readBoolean(diagnostics, ['selectedReturnPriceOptionIdPresent']),
    reverseCreateShipmentCalled: readBoolean(diagnostics, ['reverseCreateShipmentCalled']),
    reverseCreateShipmentSuccess: readBoolean(diagnostics, ['reverseCreateShipmentSuccess']),
    reverseCreateShipmentResponseKeys: readStringArray(diagnostics.reverseCreateShipmentResponseKeys),
    reverseCreateShipmentTrackingPresent: readBoolean(diagnostics, ['reverseCreateShipmentTrackingPresent']),
    reverseCreateShipmentBarcodePresent: readBoolean(diagnostics, ['reverseCreateShipmentBarcodePresent']),
    reverseCreateShipmentLabelPresent: readBoolean(diagnostics, ['reverseCreateShipmentLabelPresent']),
    returnFinalized: readBoolean(diagnostics, ['returnFinalized']),
    returnFinalizationEndpointConfirmed: readBoolean(diagnostics, ['returnFinalizationEndpointConfirmed']),
    returnFinalizeEndpointImplemented: readBoolean(diagnostics, ['returnFinalizeEndpointImplemented']),
    returnLabelRetrievable: Boolean(normalizedReturnLabelUrl) || readBoolean(diagnostics, ['returnLabelRetrievable']),
    providerStatusSource: readString(diagnostics, ['providerStatusSource']),
  };
}

function mapTryOtoReturnDetailsProbe(returnShipment: Record<string, unknown>) {
  const probe = readRecord(returnShipment, 'detailsProbe');
  if (!probe) {
    return null;
  }

  return {
    status: readString(probe, ['status']) ?? 'not_started',
    attemptedAt: readString(probe, ['attemptedAt']),
    endpoint: readString(probe, ['endpoint']),
    httpStatus: readNumber(probe, ['httpStatus']),
    responseKeys: readStringArray(probe.responseKeys),
    nestedKeys: readStringArray(probe.nestedKeys),
    labelLikeFieldsPresent: readBoolean(probe, ['labelLikeFieldsPresent']),
    awbLikeFieldsPresent: readBoolean(probe, ['awbLikeFieldsPresent']),
    pdfLikeFieldsPresent: readBoolean(probe, ['pdfLikeFieldsPresent']),
    urlLikeFieldsPresent: readBoolean(probe, ['urlLikeFieldsPresent']),
    trackingPresent: readBoolean(probe, ['trackingPresent']),
    barcodePresent: readBoolean(probe, ['barcodePresent']),
    providerStatus: readString(probe, ['providerStatus']),
    labelUrlPresent: readBoolean(probe, ['labelUrlPresent']),
    errorMessage: readString(probe, ['errorMessage']),
  };
}

function mapTryOtoReturnLinkProbe(returnShipment: Record<string, unknown>) {
  const probe = readRecord(returnShipment, 'linkProbe');
  if (!probe) {
    return null;
  }

  return {
    status: readString(probe, ['status']) ?? 'not_started',
    attemptedAt: readString(probe, ['attemptedAt']),
    endpoint: readString(probe, ['endpoint']),
    httpStatus: readNumber(probe, ['httpStatus']),
    responseKeys: readStringArray(probe.responseKeys),
    nestedKeys: readStringArray(probe.nestedKeys),
    labelLikeFieldsPresent: readBoolean(probe, ['labelLikeFieldsPresent']),
    awbLikeFieldsPresent: readBoolean(probe, ['awbLikeFieldsPresent']),
    pdfLikeFieldsPresent: readBoolean(probe, ['pdfLikeFieldsPresent']),
    urlLikeFieldsPresent: readBoolean(probe, ['urlLikeFieldsPresent']),
    actionUrlPresent: readBoolean(probe, ['actionUrlPresent']),
    trackingPresent: readBoolean(probe, ['trackingPresent']),
    barcodePresent: readBoolean(probe, ['barcodePresent']),
    providerStatus: readString(probe, ['providerStatus']),
    labelUrlPresent: readBoolean(probe, ['labelUrlPresent']),
    providerMessage: readString(probe, ['providerMessage']),
    errorMessage: readString(probe, ['errorMessage']),
  };
}

function mapTryOtoReturnAwbPrintProbe(returnShipment: Record<string, unknown>) {
  const probe = readRecord(returnShipment, 'awbPrintProbe');
  if (!probe) {
    return null;
  }

  return {
    status: readString(probe, ['status']) ?? 'not_started',
    attemptedAt: readString(probe, ['attemptedAt']),
    endpoint: readString(probe, ['endpoint']),
    httpStatus: readNumber(probe, ['httpStatus']),
    responseKeys: readStringArray(probe.responseKeys),
    nestedKeys: readStringArray(probe.nestedKeys),
    labelLikeFieldsPresent: readBoolean(probe, ['labelLikeFieldsPresent']),
    awbLikeFieldsPresent: readBoolean(probe, ['awbLikeFieldsPresent']),
    pdfLikeFieldsPresent: readBoolean(probe, ['pdfLikeFieldsPresent']),
    urlLikeFieldsPresent: readBoolean(probe, ['urlLikeFieldsPresent']),
    trackingPresent: readBoolean(probe, ['trackingPresent']),
    barcodePresent: readBoolean(probe, ['barcodePresent']),
    providerStatus: readString(probe, ['providerStatus']),
    labelUrlPresent: readBoolean(probe, ['labelUrlPresent']),
    providerMessage: readString(probe, ['providerMessage']),
    errorMessage: readString(probe, ['errorMessage']),
  };
}

function readTryOtoReturnLabelUrl(returnShipment: Record<string, unknown>) {
  return readString(returnShipment, [
    'labelUrl',
    'returnLabelUrl',
    'printReturnAWBURL',
    'printReturnAWBUrl',
    'printReturnAwbURL',
    'printReturnAwbUrl',
  ]);
}

function readTryOtoReturnTrackingUrl(returnShipment: Record<string, unknown>) {
  return readString(returnShipment, ['trackingUrl', 'returnTrackingUrl', 'brandedTrackingURL', 'brandedTrackingUrl']);
}

function mapReturnShipment(snapshot: Record<string, unknown> | null): OrderShipmentExecutionDto['returnShipment'] {
  const returnShipment = readRecord(snapshot, 'returnShipment');
  if (!returnShipment) {
    return null;
  }

  const labelUrl = readTryOtoReturnLabelUrl(returnShipment);
  const trackingNumber = readString(returnShipment, ['trackingNumber', 'returnTrackingNumber']);
  return {
    provider: 'try_oto',
    returnOrderId: readString(returnShipment, ['returnOrderId', 'returnProviderId', 'providerReturnId', 'returnOtoId']),
    trackingNumber,
    trackingUrl: readTryOtoReturnTrackingUrl(returnShipment),
    labelUrl,
    barcode: readString(returnShipment, ['barcode', 'returnBarcode']),
    carrierName: readString(returnShipment, ['carrierName', 'returnCarrierName']),
    status: readString(returnShipment, ['status', 'returnStatus']),
    createdAt: readString(returnShipment, ['createdAt']),
    requestKeys: readStringArray(returnShipment.requestKeys),
    responseKeys: readStringArray(returnShipment.responseKeys),
    trackingPresent: Boolean(trackingNumber),
    labelPresent: Boolean(labelUrl),
    labelRetrievalConfirmed: Boolean(labelUrl) || readBoolean(returnShipment, ['labelRetrievalConfirmed']),
    labelRetrievalNote: readString(returnShipment, ['labelRetrievalNote']),
    finalized: readBoolean(returnShipment, ['finalized']),
    labelRetrievable: Boolean(labelUrl) || readBoolean(returnShipment, ['labelRetrievable']),
    providerStatusSource: readString(returnShipment, ['providerStatusSource']),
    diagnostics: mapTryOtoReturnDiagnostics(returnShipment),
    detailsProbe: mapTryOtoReturnDetailsProbe(returnShipment),
    linkProbe: mapTryOtoReturnLinkProbe(returnShipment),
    awbPrintProbe: mapTryOtoReturnAwbPrintProbe(returnShipment),
    shopifyReturnLabelUploadProbe: mapShopifyReturnLabelUploadProbe(returnShipment),
  };
}

function mapNavlungoRequestSummary(value: unknown): NonNullable<OrderShipmentExecutionDto['providerResponseSummary']>['navlungoRequestSummary'] {
  if (!isRecord(value)) {
    return null;
  }

  return {
    baseUrl: readString(value, ['baseUrl']),
    baseUrlHost: readString(value, ['baseUrlHost']),
    baseUrlPath: readString(value, ['baseUrlPath']),
    endpointPath: readString(value, ['endpointPath']) ?? '—',
    method: readString(value, ['method']) ?? '—',
    headerKeys: readStringArray(value.headerKeys),
    topLevelBodyKeys: readStringArray(value.topLevelBodyKeys),
    postKeys: readStringArray(value.postKeys),
    senderKeys: readStringArray(value.senderKeys),
    recipientKeys: readStringArray(value.recipientKeys),
    postPayloadKeys: readStringArray(value.postPayloadKeys),
    barcodeFormatPresent: Boolean(value.barcodeFormatPresent),
    barcodeFormatType: readString(value, ['barcodeFormatType']),
    codPaymentTypePresent: Boolean(value.codPaymentTypePresent),
    codPaymentType: readString(value, ['codPaymentType']),
    postPricePresent: Boolean(value.postPricePresent),
    postPriceType: readString(value, ['postPriceType']),
    requestedCarrierId: readNumber(value, ['requestedCarrierId']) ?? readString(value, ['requestedCarrierId']),
    requestedPostType: readNumber(value, ['requestedPostType']) ?? readString(value, ['requestedPostType']),
    senderUsesAddressId: Boolean(value.senderUsesAddressId),
    senderFullObjectKeysPresent: Boolean(value.senderFullObjectKeysPresent),
    customData1Present: Boolean(value.customData1Present),
    customData2Present: Boolean(value.customData2Present),
    customData3Present: Boolean(value.customData3Present),
    customData4Present: Boolean(value.customData4Present),
    recipientDistrictPresent: Boolean(value.recipientDistrictPresent),
    recipientCityPresent: Boolean(value.recipientCityPresent),
    recipientCountryPresent: Boolean(value.recipientCountryPresent),
    recipientPostCodePresent: Boolean(value.recipientPostCodePresent),
    recipientPhonePresent: Boolean(value.recipientPhonePresent),
    recipientPhoneFormatValid: Boolean(value.recipientPhoneFormatValid),
    recipientEmailPresent: Boolean(value.recipientEmailPresent),
    recipientEmailFormatValid: Boolean(value.recipientEmailFormatValid),
    recipientAddressPresent: Boolean(value.recipientAddressPresent),
    recipientAddressLength: readNumber(value, ['recipientAddressLength']) ?? 0,
    packageCountPresent: Boolean(value.packageCountPresent),
    packageCountType: readString(value, ['packageCountType']),
    requestedPackageCount: readNumber(value, ['requestedPackageCount']) ?? readString(value, ['requestedPackageCount']),
    desiPresent: Boolean(value.desiPresent),
    desiType: readString(value, ['desiType']),
    requestedDesi: readNumber(value, ['requestedDesi']) ?? readString(value, ['requestedDesi']),
    postNotePresent: Boolean(value.postNotePresent),
    postNoteType: readString(value, ['postNoteType']),
    postNoteLength: readNumber(value, ['postNoteLength']) ?? 0,
  };
}

function buildShipmentProviderResponseSummary(
  execution: {
    providerShipmentId: string | null;
    trackingNumber: string | null;
    labelUrl: string | null;
    responseSnapshot?: unknown;
  },
  includeSummary: boolean,
): OrderShipmentExecutionDto['providerResponseSummary'] | undefined {
  if (!includeSummary) {
    return undefined;
  }

  const snapshot = isRecord(execution.responseSnapshot) ? execution.responseSnapshot : null;
  const responseKeys = Array.isArray(snapshot?.bodyKeys)
    ? snapshot.bodyKeys.filter((key): key is string => typeof key === 'string')
    : snapshot
      ? Object.keys(snapshot).filter((key) => !['body', 'request', 'payload'].includes(key)).sort()
      : [];
  const disabledGates = Array.isArray(snapshot?.disabledGates)
    ? snapshot.disabledGates.filter((gate): gate is string => typeof gate === 'string')
    : [];
  const payloadDiagnostics = isRecord(snapshot?.payloadDiagnostics) ? snapshot.payloadDiagnostics : null;
  const addressFieldPresence: Record<string, unknown> = isRecord(payloadDiagnostics?.addressFieldPresence)
    ? payloadDiagnostics.addressFieldPresence
    : {};
  const createOrderDiagnostics = isRecord(snapshot?.createOrder) ? snapshot.createOrder : null;
  const createShipmentDiagnostics = isRecord(snapshot?.createShipment) ? snapshot.createShipment : null;
  const createPostDiagnostics = isRecord(snapshot?.createPost) ? snapshot.createPost : null;
  const updatePostDiagnostics = isRecord(snapshot?.updatePost) ? snapshot.updatePost : null;
  const createShipmentRequestDiagnostics = isRecord(snapshot?.createShipmentRequestDiagnostics)
    ? snapshot.createShipmentRequestDiagnostics
    : null;
  const orderStatusDiagnostics = isRecord(snapshot?.orderStatus) ? snapshot.orderStatus : null;
  const deliveryOptionLookupDiagnostics = isRecord(snapshot?.deliveryOptionLookup) ? snapshot.deliveryOptionLookup : null;
  const deliveryOptionLookupRequest = isRecord(deliveryOptionLookupDiagnostics?.request)
    ? deliveryOptionLookupDiagnostics.request
    : null;
  const deliveryOptionLookupResponse = isRecord(deliveryOptionLookupDiagnostics?.response)
    ? deliveryOptionLookupDiagnostics.response
    : null;
  const deliveryOptionLookupSourceFieldPresence = isRecord(deliveryOptionLookupRequest?.sourceFieldPresence)
    ? deliveryOptionLookupRequest.sourceFieldPresence
    : null;
  const tryOtoFinalization = snapshot?.provider === 'try_oto'
    ? {
        createOrderSuccess: typeof createOrderDiagnostics?.ok === 'boolean' ? createOrderDiagnostics.ok : null,
        createShipmentCalled: Boolean(createShipmentDiagnostics),
        createShipmentSuccess: typeof createShipmentDiagnostics?.ok === 'boolean' ? createShipmentDiagnostics.ok : null,
        createShipmentResponseKeys: Array.isArray(createShipmentDiagnostics?.bodyKeys)
          ? createShipmentDiagnostics.bodyKeys.filter((key): key is string => typeof key === 'string')
          : [],
        createShipmentProviderMessage: readString(createShipmentDiagnostics, ['providerError', 'message', 'reason']),
        createShipmentProviderErrorCode: readString(createShipmentDiagnostics, ['providerErrorCode', 'errorCode', 'otoErrorCode', 'code']),
        createShipmentEndpoint:
          readString(createShipmentRequestDiagnostics, ['endpoint']) ?? readString(createShipmentDiagnostics, ['requestPath']),
        createShipmentResponseStatus:
          typeof createShipmentDiagnostics?.status === 'number' ? createShipmentDiagnostics.status : null,
        createShipmentRequestKeys: Array.isArray(createShipmentRequestDiagnostics?.topLevelKeys)
          ? createShipmentRequestDiagnostics.topLevelKeys.filter((key): key is string => typeof key === 'string')
          : [],
        createShipmentDeliveryOptionIdPresent:
          typeof createShipmentRequestDiagnostics?.deliveryOptionIdPresent === 'boolean'
            ? createShipmentRequestDiagnostics.deliveryOptionIdPresent
            : null,
        deliveryOptionIdPresent:
          typeof payloadDiagnostics?.deliveryOptionIdPresent === 'boolean'
            ? payloadDiagnostics.deliveryOptionIdPresent
            : null,
        orderStatusValue:
          readString(snapshot, ['providerStatus', 'statusField', 'shipmentStatus', 'cargoStatus']) ??
          readString(orderStatusDiagnostics, ['providerError', 'statusField', 'shipmentStatus', 'cargoStatus']),
        deliveryOptionLookupCalled: deliveryOptionLookupDiagnostics?.called === true,
        deliveryOptionLookupSuccess:
          typeof deliveryOptionLookupDiagnostics?.success === 'boolean'
            ? deliveryOptionLookupDiagnostics.success
            : null,
        deliveryOptionLookupOptionCount:
          typeof deliveryOptionLookupDiagnostics?.optionCount === 'number'
            ? deliveryOptionLookupDiagnostics.optionCount
            : null,
        selectedDeliveryCompanyName: readString(deliveryOptionLookupDiagnostics, ['selectedDeliveryCompanyName']),
        selectedDeliveryOptionIdPresent: deliveryOptionLookupDiagnostics?.selectedDeliveryOptionIdPresent === true,
        deliveryOptionLookupErrorMessage:
          readString(deliveryOptionLookupDiagnostics, ['lookupErrorMessage', 'providerError']) ??
          readString(deliveryOptionLookupResponse, ['providerError']),
        deliveryOptionLookupEndpoint: readString(deliveryOptionLookupRequest, ['endpoint']),
        deliveryOptionLookupRequestKeys: Array.isArray(deliveryOptionLookupRequest?.topLevelKeys)
          ? deliveryOptionLookupRequest.topLevelKeys.filter((key): key is string => typeof key === 'string')
          : [],
        deliveryOptionLookupRequestPresence: deliveryOptionLookupRequest
          ? {
              pickupLocationCode: deliveryOptionLookupRequest.pickupLocationCodePresent === true,
              originCity: deliveryOptionLookupRequest.originCityPresent === true,
              packageWeight: deliveryOptionLookupRequest.packageWeightPresent === true,
              weight: deliveryOptionLookupRequest.weightPresent === true,
              customerCity: deliveryOptionLookupRequest.customerCityPresent === true,
              customerCountry: deliveryOptionLookupRequest.customerCountryPresent === true,
              paymentMethod: deliveryOptionLookupRequest.paymentMethodPresent === true,
            }
          : null,
        deliveryOptionLookupSourcePresence: deliveryOptionLookupSourceFieldPresence
          ? {
              pickupLocationCode: deliveryOptionLookupSourceFieldPresence.pickupLocationCode === true,
              originCity: deliveryOptionLookupSourceFieldPresence.originCity === true,
              packageWeight: deliveryOptionLookupSourceFieldPresence.packageWeight === true,
              customerCity: deliveryOptionLookupSourceFieldPresence.customerCity === true,
              customerCountry: deliveryOptionLookupSourceFieldPresence.customerCountry === true,
              paymentMethod: deliveryOptionLookupSourceFieldPresence.paymentMethod === true,
            }
          : null,
        deliveryOptionLookupResponseStatus:
          typeof deliveryOptionLookupResponse?.status === 'number' ? deliveryOptionLookupResponse.status : null,
        deliveryOptionLookupResponseKeys: Array.isArray(deliveryOptionLookupResponse?.topLevelKeys)
          ? deliveryOptionLookupResponse.topLevelKeys.filter((key): key is string => typeof key === 'string')
          : [],
        deliveryOptionLookupResponseBodyKeys: Array.isArray(deliveryOptionLookupResponse?.bodyKeys)
          ? deliveryOptionLookupResponse.bodyKeys.filter((key): key is string => typeof key === 'string')
          : [],
        deliveryOptionLookupResponseHasDeliveryOptionId:
          typeof deliveryOptionLookupResponse?.deliveryOptionIdPresent === 'boolean'
            ? deliveryOptionLookupResponse.deliveryOptionIdPresent
            : null,
        deliveryOptionLookupResponseHasDeliveryCompanyName:
          typeof deliveryOptionLookupResponse?.deliveryCompanyNamePresent === 'boolean'
            ? deliveryOptionLookupResponse.deliveryCompanyNamePresent
            : null,
        deliveryOptionLookupResponseHasPricing:
          typeof deliveryOptionLookupResponse?.pricingPresent === 'boolean' ? deliveryOptionLookupResponse.pricingPresent : null,
        deliveryOptionLookupResponsePricingKeys: Array.isArray(deliveryOptionLookupResponse?.pricingKeys)
          ? deliveryOptionLookupResponse.pricingKeys.filter((key): key is string => typeof key === 'string')
          : [],
        deliveryOptionLookupWeightFieldNames: Array.isArray(deliveryOptionLookupRequest?.weightFieldNames)
          ? deliveryOptionLookupRequest.weightFieldNames.filter((key): key is string => typeof key === 'string')
          : [],
        deliveryOptionLookupNumericWeightPresent:
          typeof deliveryOptionLookupRequest?.numericWeightPresent === 'boolean'
            ? deliveryOptionLookupRequest.numericWeightPresent
            : null,
        deliveryOptionLookupWeightType: readString(deliveryOptionLookupRequest, ['weightType']),
        lastWebhookReceivedAt: readString(snapshot, ['lastTryOtoWebhookReceivedAt']),
        lastWebhookMatchStatus: readString(snapshot, ['lastTryOtoWebhookMatchStatus']),
        lastWebhookMatchedByField: readString(snapshot, ['lastTryOtoWebhookMatchedByField']),
        lastWebhookHttpMethod: readString(snapshot, ['lastTryOtoWebhookHttpMethod']),
        lastWebhookContentType: readString(snapshot, ['lastTryOtoWebhookContentType']),
        lastWebhookStatusField: readString(snapshot, ['lastTryOtoWebhookStatusField']),
        lastWebhookStatusMapped:
          typeof snapshot?.lastTryOtoWebhookStatusMapped === 'boolean' ? snapshot.lastTryOtoWebhookStatusMapped : null,
        lastWebhookMappedShipmentStatus: readString(snapshot, ['lastTryOtoWebhookMappedShipmentStatus']),
        latestProviderStatusSource: readString(snapshot, ['latestProviderStatusSource']),
        lastWebhookParseError: readString(snapshot, ['lastTryOtoWebhookParseError']),
        webhookSignatureVerificationImplemented:
          typeof snapshot?.tryOtoWebhookSignatureVerificationImplemented === 'boolean'
            ? snapshot.tryOtoWebhookSignatureVerificationImplemented
            : null,
        webhookAuthenticityVerification: readTryOtoWebhookAuthenticityVerification(snapshot?.tryOtoWebhookAuthenticityVerification),
        webhookWarning: readString(snapshot, ['tryOtoWebhookWarning']),
      }
    : undefined;
  const validationResponseShape = isRecord(snapshot?.validationResponseShape)
    ? snapshot.validationResponseShape
    : isRecord(createPostDiagnostics?.validationResponseShape)
      ? createPostDiagnostics.validationResponseShape
      : null;
  const mappedValidationResponseShape = validationResponseShape
    ? {
        kind: readString(validationResponseShape, ['kind']) ?? 'unknown',
        topLevelKeys: readStringArray(validationResponseShape.topLevelKeys),
      }
    : null;
  const navlungoUpdateResponseShape = isRecord(snapshot?.navlungoUpdateResponseShape)
    ? {
        kind: readString(snapshot.navlungoUpdateResponseShape, ['kind']) ?? 'unknown',
        topLevelKeys: readStringArray(snapshot.navlungoUpdateResponseShape.topLevelKeys),
      }
    : isRecord(updatePostDiagnostics?.navlungoUpdateResponseShape)
      ? {
          kind: readString(updatePostDiagnostics.navlungoUpdateResponseShape, ['kind']) ?? 'unknown',
          topLevelKeys: readStringArray(updatePostDiagnostics.navlungoUpdateResponseShape.topLevelKeys),
        }
      : isRecord(updatePostDiagnostics?.responseShape)
        ? {
            kind: readString(updatePostDiagnostics.responseShape, ['kind']) ?? 'unknown',
            topLevelKeys: readStringArray(updatePostDiagnostics.responseShape.topLevelKeys),
          }
        : null;
  const confirmShippingPriceDiagnostics = isRecord(snapshot?.confirmShippingPrice) ? snapshot.confirmShippingPrice : null;
  const providerValidationErrors = mergeUniqueStrings(
    readValidationStringArray(snapshot?.providerValidationErrors),
    readValidationStringArray(createPostDiagnostics?.providerValidationErrors),
    readValidationStringArray(createPostDiagnostics?.validationErrorMessages),
    readValidationStringArray(snapshot?.navlungoUpdateValidationMessages),
    readValidationStringArray(updatePostDiagnostics?.validationErrorMessages),
  );
  const validationErrorKeys = mergeUniqueStrings(
    readStringArray(snapshot?.validationErrorKeys),
    readStringArray(createPostDiagnostics?.validationErrorKeys),
    readStringArray(updatePostDiagnostics?.validationErrorKeys),
  );
  const validationErrorMessages = mergeUniqueStrings(
    readValidationStringArray(snapshot?.validationErrorMessages),
    readValidationStringArray(createPostDiagnostics?.validationErrorMessages),
    readValidationStringArray(createPostDiagnostics?.providerValidationErrors),
    readValidationStringArray(snapshot?.navlungoUpdateValidationMessages),
    readValidationStringArray(updatePostDiagnostics?.validationErrorMessages),
  );
  const failedFieldNames = mergeUniqueStrings(
    readStringArray(snapshot?.failedFieldNames),
    readStringArray(createPostDiagnostics?.failedFieldNames),
    readStringArray(snapshot?.navlungoUpdateValidationFields),
    readStringArray(updatePostDiagnostics?.failedFieldNames),
  );
  const kargonomiGetShipmentAfterConfirm = isRecord(snapshot?.getShipmentAfterConfirm)
    ? snapshot.getShipmentAfterConfirm
    : null;
  const kargonomiBarcodeFetch = isRecord(snapshot?.barcodeFetch) ? snapshot.barcodeFetch : null;

  return {
    httpStatus: readNumber(snapshot, ['status', 'httpStatus', 'createPostHttpStatus', 'providerCallHttpStatus', 'navlungoCancelHttpStatus', 'navlungoUpdateHttpStatus', 'statusCode']),
    ok: typeof snapshot?.ok === 'boolean' ? snapshot.ok : null,
    contentType: typeof snapshot?.contentType === 'string' ? snapshot.contentType : null,
    parsedBodyType: typeof snapshot?.parsedBodyType === 'string' ? snapshot.parsedBodyType : null,
    responseKeys,
    providerError: readString(snapshot, ['providerError', 'providerMessage', 'navlungoCancelProviderMessage', 'navlungoUpdateProviderMessage', 'error', 'message', 'reason']),
    providerErrorMessage:
      readString(snapshot, ['providerErrorMessage']) ?? readString(confirmShippingPriceDiagnostics, ['providerErrorMessage']),
    providerErrorErrors: snapshot?.providerErrorErrors ?? confirmShippingPriceDiagnostics?.providerErrorErrors,
    providerErrorBodyPreview: snapshot?.providerErrorBodyPreview ?? confirmShippingPriceDiagnostics?.providerErrorBodyPreview,
    confirmShipmentId:
      readStringOrNumber(confirmShippingPriceDiagnostics, ['shipmentId']) ?? readStringOrNumber(snapshot, ['shipmentId']),
    confirmShippingProviderId:
      readStringOrNumber(confirmShippingPriceDiagnostics, ['shippingProviderId']) ?? readStringOrNumber(snapshot, ['shippingProviderId']),
    dryRun: typeof snapshot?.dryRun === 'boolean' ? snapshot.dryRun : null,
    disabledGates,
    providerValidationErrors,
    validationErrorKeys,
    validationErrorMessages,
    failedFieldNames,
    validationErrorKeysCount:
      readNumber(snapshot, ['validationErrorKeysCount']) ??
      readNumber(createPostDiagnostics, ['validationErrorKeysCount']) ??
      validationErrorKeys.length,
    failedFieldNamesCount:
      readNumber(snapshot, ['failedFieldNamesCount']) ??
      readNumber(createPostDiagnostics, ['failedFieldNamesCount']) ??
      failedFieldNames.length,
    validationErrorMessagesCount:
      readNumber(snapshot, ['validationErrorMessagesCount']) ??
      readNumber(createPostDiagnostics, ['validationErrorMessagesCount']) ??
      validationErrorMessages.length,
    providerValidationErrorsShape:
      readString(snapshot, ['providerValidationErrorsShape']) ??
      readString(createPostDiagnostics, ['providerValidationErrorsShape']),
    createPostErrorShape:
      readString(snapshot, ['createPostErrorShape']) ?? readString(createPostDiagnostics, ['createPostErrorShape']),
    topLevelErrorShape:
      readString(snapshot, ['topLevelErrorShape']) ?? readString(createPostDiagnostics, ['topLevelErrorShape']),
    nestedCreatePostErrorShape:
      readString(snapshot, ['nestedCreatePostErrorShape']) ?? readString(createPostDiagnostics, ['nestedCreatePostErrorShape']),
    providerErrorCode:
      readString(snapshot, ['providerErrorCode', 'errorCode', 'code']) ??
      readString(createPostDiagnostics, ['providerErrorCode', 'errorCode', 'code']),
    providerTrackingId:
      readString(snapshot, ['providerTrackingId', 'navlungoUpdateProviderTrackingId']) ??
      readString(createPostDiagnostics, ['providerTrackingId']) ??
      readString(updatePostDiagnostics, ['providerTrackingId']),
    validationResponseShape: mappedValidationResponseShape,
    providerShipmentIdPresent: Boolean(execution.providerShipmentId),
    trackingNumberPresent: Boolean(execution.trackingNumber),
    labelPresent: Boolean(execution.labelUrl),
    barcodePresent: Boolean(readString(snapshot, ['barcode', 'barcodeNumber'])),
    notificationUrlIncluded: typeof snapshot?.notificationUrlIncluded === 'boolean' ? snapshot.notificationUrlIncluded : null,
    statusField: readString(snapshot, ['statusField', 'shipmentStatus', 'cargoStatus']),
    detectedResponseFormat: readString(snapshot, ['detectedResponseFormat']),
    responseSnippet: readString(snapshot, ['responseSnippet']),
    authHeaderMode: readString(snapshot, ['authHeaderMode']),
    requestId: readString(snapshot, ['requestId']),
    requestPath: readString(snapshot, ['requestPath']),
    selectedEnvironment: readString(snapshot, ['selectedEnvironment']),
    requestTargetHostname: readString(snapshot, ['requestTargetHostname']),
    providerMode: readString(snapshot, ['providerMode']),
    navlungoRequestSummary: mapNavlungoRequestSummary(snapshot?.navlungoRequestSummary),
    lastSuccessfulNavlungoRequestSummary: mapNavlungoRequestSummary(snapshot?.lastSuccessfulNavlungoRequestSummary),
    lastSuccessfulNavlungoRequestSummarySource: readString(snapshot, ['lastSuccessfulNavlungoRequestSummarySource']),
    lastSuccessfulNavlungoRequestSummaryReason: readString(snapshot, ['lastSuccessfulNavlungoRequestSummaryReason']),
    providerApiCallAttempted:
      typeof snapshot?.providerApiCallAttempted === 'boolean' ? snapshot.providerApiCallAttempted : null,
    senderAddressIdPresent: typeof snapshot?.senderAddressIdPresent === 'boolean' ? snapshot.senderAddressIdPresent : null,
    senderAddressIdValid: typeof snapshot?.senderAddressIdValid === 'boolean' ? snapshot.senderAddressIdValid : null,
    senderUsesAddressId: typeof snapshot?.senderUsesAddressId === 'boolean' ? snapshot.senderUsesAddressId : null,
    senderMode: readString(snapshot, ['senderMode']),
    fullSenderRetryRequested:
      typeof snapshot?.fullSenderRetryRequested === 'boolean' ? snapshot.fullSenderRetryRequested : null,
    shopifyFulfillmentSyncAttempted:
      typeof snapshot?.shopifyFulfillmentSyncAttempted === 'boolean' ? snapshot.shopifyFulfillmentSyncAttempted : null,
    shopifyFulfillmentSyncSkippedReason: readString(snapshot, ['shopifyFulfillmentSyncSkippedReason']),
    shopifyFulfillmentSynced:
      typeof snapshot?.shopifyFulfillmentSynced === 'boolean' ? snapshot.shopifyFulfillmentSynced : null,
    autoSyncAttempted:
      typeof snapshot?.autoSyncAttempted === 'boolean' ? snapshot.autoSyncAttempted : null,
    autoSyncSucceeded:
      typeof snapshot?.autoSyncSucceeded === 'boolean' ? snapshot.autoSyncSucceeded : null,
    autoSyncSkippedReason: readString(snapshot, ['autoSyncSkippedReason']),
    shopifyFulfillmentId: readString(snapshot, ['shopifyFulfillmentId']),
    shopifyFulfillmentOrderId: readString(snapshot, ['shopifyFulfillmentOrderId']),
    shopifyFulfillmentCancelSyncSkippedReason: readString(snapshot, ['shopifyFulfillmentCancelSyncSkippedReason']),
    fulfillmentTrackingNumberPresent:
      typeof snapshot?.fulfillmentTrackingNumberPresent === 'boolean' ? snapshot.fulfillmentTrackingNumberPresent : null,
    fulfillmentTrackingUrlPresent:
      typeof snapshot?.fulfillmentTrackingUrlPresent === 'boolean' ? snapshot.fulfillmentTrackingUrlPresent : null,
    navlungoCancelAttempted:
      typeof snapshot?.navlungoCancelAttempted === 'boolean' ? snapshot.navlungoCancelAttempted : null,
    navlungoCancelHttpStatus: readNumber(snapshot, ['navlungoCancelHttpStatus']),
    navlungoCancelSucceeded:
      typeof snapshot?.navlungoCancelSucceeded === 'boolean' ? snapshot.navlungoCancelSucceeded : null,
    navlungoCancelProviderMessage: readString(snapshot, ['navlungoCancelProviderMessage']),
    navlungoCancelValidationFields: readStringArray(snapshot?.navlungoCancelValidationFields),
    navlungoCancelValidationMessages: readValidationStringArray(snapshot?.navlungoCancelValidationMessages),
    navlungoCancelProviderTrackingId: readString(snapshot, ['navlungoCancelProviderTrackingId']),
    navlungoCancelledAt: readString(snapshot, ['navlungoCancelledAt']),
    navlungoUpdateAttempted:
      typeof snapshot?.navlungoUpdateAttempted === 'boolean' ? snapshot.navlungoUpdateAttempted : null,
    navlungoUpdateHttpStatus: readNumber(snapshot, ['navlungoUpdateHttpStatus']),
    navlungoUpdateSucceeded:
      typeof snapshot?.navlungoUpdateSucceeded === 'boolean' ? snapshot.navlungoUpdateSucceeded : null,
    navlungoUpdateProviderMessage: readString(snapshot, ['navlungoUpdateProviderMessage']),
    navlungoUpdateValidationFields: readStringArray(snapshot?.navlungoUpdateValidationFields),
    navlungoUpdateValidationMessages: readValidationStringArray(snapshot?.navlungoUpdateValidationMessages),
    navlungoUpdateProviderTrackingId: readString(snapshot, ['navlungoUpdateProviderTrackingId']),
    navlungoUpdateResponseShape,
    navlungoUpdateSenderMode: readString(snapshot, ['navlungoUpdateSenderMode']),
    navlungoUpdateSenderFieldKeys: readStringArray(snapshot?.navlungoUpdateSenderFieldKeys),
    navlungoUpdateMissingSenderFields: readStringArray(snapshot?.navlungoUpdateMissingSenderFields),
    navlungoUpdateRecipientOverridePresent:
      typeof snapshot?.navlungoUpdateRecipientOverridePresent === 'boolean'
        ? snapshot.navlungoUpdateRecipientOverridePresent
        : null,
    navlungoUpdateRecipientOverrideKeys: readStringArray(snapshot?.navlungoUpdateRecipientOverrideKeys),
    navlungoUpdateSubmittedRecipientOverrideKeys: readStringArray(snapshot?.navlungoUpdateSubmittedRecipientOverrideKeys),
    navlungoUpdateOptionOverrideKeys: readStringArray(snapshot?.navlungoUpdateOptionOverrideKeys),
    navlungoUpdateRecipientOverrides: readNavlungoUpdateRecipientOverrides(snapshot?.navlungoUpdateRecipientOverrides),
    navlungoUpdatePostNote: readString(snapshot, ['navlungoUpdatePostNote']),
    navlungoUpdateBarcodeFormat: readString(snapshot, ['navlungoUpdateBarcodeFormat']),
    navlungoUpdatedAt: readString(snapshot, ['navlungoUpdatedAt']),
    shopifyFulfillmentUpdateSyncSkippedReason: readString(snapshot, ['shopifyFulfillmentUpdateSyncSkippedReason']),
    lastProviderStage: readString(snapshot, ['lastProviderStage']),
    createShipmentCalled:
      typeof snapshot?.createShipmentCalled === 'boolean'
        ? snapshot.createShipmentCalled
        : typeof snapshot?.createShipmentDraftCalled === 'boolean'
          ? snapshot.createShipmentDraftCalled
          : null,
    priceComparisonCalled:
      typeof snapshot?.priceComparisonCalled === 'boolean' ? snapshot.priceComparisonCalled : null,
    confirmShippingPriceCalled:
      typeof snapshot?.confirmShippingPriceCalled === 'boolean' ? snapshot.confirmShippingPriceCalled : null,
    getShipmentCalled:
      typeof snapshot?.getShipmentCalled === 'boolean'
        ? snapshot.getShipmentCalled
        : typeof snapshot?.getShipmentAfterConfirmCalled === 'boolean'
          ? snapshot.getShipmentAfterConfirmCalled
          : null,
    barcodeFetchCalled:
      typeof snapshot?.barcodeFetchCalled === 'boolean' ? snapshot.barcodeFetchCalled : null,
    providerStatus: readString(snapshot, ['providerStatus', 'status']),
    providerStatusLabel: readString(snapshot, ['providerStatusLabel', 'statusLabel']),
    kargonomiCancelled:
      typeof snapshot?.kargonomiCancelled === 'boolean' ? snapshot.kargonomiCancelled : null,
    kargonomiPostCreateDiagnostics: kargonomiGetShipmentAfterConfirm || kargonomiBarcodeFetch
      ? {
          getShipmentAfterConfirm: kargonomiGetShipmentAfterConfirm
            ? {
                httpStatus: readNumber(kargonomiGetShipmentAfterConfirm, ['httpStatus', 'status']),
                contentType: readString(kargonomiGetShipmentAfterConfirm, ['contentType']),
                bodyKeys: readStringArray(kargonomiGetShipmentAfterConfirm.bodyKeys),
                safeFields: kargonomiGetShipmentAfterConfirm.safeFields ?? null,
              }
            : null,
          barcodeFetch: kargonomiBarcodeFetch
            ? {
                httpStatus: readNumber(kargonomiBarcodeFetch, ['httpStatus', 'status']),
                contentType: readString(kargonomiBarcodeFetch, ['contentType']),
                topLevelKeys: readStringArray(kargonomiBarcodeFetch.topLevelKeys),
                bodyKeys: readStringArray(kargonomiBarcodeFetch.bodyKeys),
                detectedFormat: readString(kargonomiBarcodeFetch, ['detectedFormat']),
                labelUrlPresent:
                  typeof kargonomiBarcodeFetch.labelUrlPresent === 'boolean'
                    ? kargonomiBarcodeFetch.labelUrlPresent
                    : null,
                pdfLikeValuePresent:
                  typeof kargonomiBarcodeFetch.pdfLikeValuePresent === 'boolean'
                    ? kargonomiBarcodeFetch.pdfLikeValuePresent
                    : null,
              }
            : null,
        }
      : null,
    payloadDiagnostics: payloadDiagnostics
      ? {
          topLevelKeys: Array.isArray(payloadDiagnostics.topLevelKeys)
            ? payloadDiagnostics.topLevelKeys.filter((key): key is string => typeof key === 'string')
            : [],
          customerKeys: Array.isArray(payloadDiagnostics.customerKeys)
            ? payloadDiagnostics.customerKeys.filter((key): key is string => typeof key === 'string')
            : [],
          receiverKeys: Array.isArray(payloadDiagnostics.receiverKeys)
            ? payloadDiagnostics.receiverKeys.filter((key): key is string => typeof key === 'string')
            : [],
          cargoIntegrationIdPresent: payloadDiagnostics.cargoIntegrationIdPresent === true,
          warehouseIdPresent: payloadDiagnostics.warehouseIdPresent === true,
          paymentType: readString(payloadDiagnostics, ['paymentType']),
          packageType: readString(payloadDiagnostics, ['packageType']),
          payorType: readString(payloadDiagnostics, ['payorType']),
          kgPresent: payloadDiagnostics.kgPresent === true,
          kgType: readString(payloadDiagnostics, ['kgType']),
          desiPresent: payloadDiagnostics.desiPresent === true,
          desiType: readString(payloadDiagnostics, ['desiType']),
          platformIdPresent: payloadDiagnostics.platformIdPresent === true,
          platformDIdPresent: payloadDiagnostics.platformDIdPresent === true,
          customerPhonePresent: payloadDiagnostics.customerPhonePresent === true,
          customerDistrictPresent: payloadDiagnostics.customerDistrictPresent === true,
          customerCityPresent: payloadDiagnostics.customerCityPresent === true,
          deliveryOptionIdPresent: payloadDiagnostics.deliveryOptionIdPresent === true,
          addressFieldPresence: {
            customerAddress: addressFieldPresence.customerAddress === true,
            customerPostcode: addressFieldPresence.customerPostcode === true,
            customerCountry: addressFieldPresence.customerCountry === true,
            customerCity: addressFieldPresence.customerCity === true,
            customerDistrict: addressFieldPresence.customerDistrict === true,
          },
        }
      : undefined,
    tryOtoFinalization,
  };
}

function mapShipmentExecution(execution: {
  id: string;
  provider: string;
  sourceShopifyOrderId: string | null;
  sourceShopifyOrderNumber: string | null;
  sourceShopifyFulfillmentId: string | null;
  providerShipmentId: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  labelUrl: string | null;
  shipmentStatus: string;
  desi: unknown;
  cargoIntegrationId: string | null;
  warehouseId: string | null;
  shippingCost: unknown;
  shippingVat: unknown;
  currency: string;
  responseSnapshot?: unknown;
  createdAt: Date;
  updatedAt: Date;
} | null | undefined, options: { includeProviderResponseSummary?: boolean } = {}): OrderShipmentExecutionDto | null {
  if (!execution) {
    return null;
  }
  const snapshot = isRecord(execution.responseSnapshot) ? execution.responseSnapshot : null;
  const barcode = readString(snapshot, ['barcode', 'barcodeNumber']);

  return {
    id: execution.id,
    provider: execution.provider.trim().toLowerCase(),
    sourceShopifyOrderId: execution.sourceShopifyOrderId,
    sourceShopifyOrderNumber: execution.sourceShopifyOrderNumber,
    sourceShopifyFulfillmentId: execution.sourceShopifyFulfillmentId,
    providerShipmentId: execution.providerShipmentId,
    providerCarrierName: readShipmentProviderCarrierName(snapshot),
    trackingNumber: execution.trackingNumber,
    trackingUrl: execution.trackingUrl,
    labelUrl: execution.labelUrl,
    shipmentStatus: execution.shipmentStatus.trim().toLowerCase(),
    desi: toAmountString(toNumber(execution.desi)),
    cargoIntegrationId: execution.cargoIntegrationId,
    warehouseId: execution.warehouseId,
    shippingCost: execution.shippingCost === null || execution.shippingCost === undefined ? null : toAmountString(toNumber(execution.shippingCost)),
    shippingVat: execution.shippingVat === null || execution.shippingVat === undefined ? null : toAmountString(toNumber(execution.shippingVat)),
    currency: execution.currency,
    providerStatus: readString(snapshot, ['providerStatus', 'statusField', 'shipmentStatus', 'cargoStatus']),
    barcode,
    lastProviderResponseAt: readString(snapshot, ['lastProviderResponseAt']),
    dummyCarrierDetected: readBoolean(snapshot, ['dummyCarrierDetected']),
    webhookReceived: readBoolean(snapshot, ['webhookReceived']),
    barcodeAssigned: Boolean(barcode),
    trackingAssigned: Boolean(execution.trackingNumber),
    returnShipment: mapReturnShipment(snapshot),
    timeline: readShipmentTimeline(snapshot),
    createdAt: execution.createdAt.toISOString(),
    updatedAt: execution.updatedAt.toISOString(),
    providerResponseSummary: buildShipmentProviderResponseSummary(
      execution,
      Boolean(options.includeProviderResponseSummary),
    ),
  };
}

async function getLatestShopifyReturnSignalForOrder(shopifyOrderDbId: string): Promise<ShopifyReturnSignalDiscoveryDto | null> {
  const events = await prisma.webhookEvent.findMany({
    where: {
      shopifyOrderId: shopifyOrderDbId,
      topic: {
        in: [
          'returns/create',
          'returns/request',
          'returns/update',
          'returns/approve',
          'returns/decline',
          'returns/close',
          'returns/cancel',
          'refunds/create',
          'orders/updated',
          'fulfillment_orders/updated',
        ],
      },
    },
    orderBy: {
      receivedAt: 'desc',
    },
    take: 10,
  });

  for (const event of events) {
    if (!isShopifyReturnSignalTopic(event.topic)) {
      continue;
    }
    const summary = mapWebhookEventToReturnSignalDiscovery(event);
    if (summary) {
      return summary;
    }
  }

  return null;
}

export async function listVendorOrders(
  vendorId: string,
  options: { limit?: number; offset?: number } = {},
): Promise<OrderSummaryDto[]> {
  const allocations = await withDashboardTiming('orders.vendor_allocation_fetch', () => prisma.vendorAllocation.findMany({
    where: {
      assignedVendorId: vendorId,
    },
    select: {
      id: true,
      assignedVendorId: true,
      originalVendorId: true,
      allocationStatus: true,
      cancelRefundReviewStatus: true,
      fulfillmentStatus: true,
      shippingStatus: true,
      trackingNumber: true,
      carrier: true,
      vendorIntegrationTrackingUrl: true,
      vendorIntegrationShippedAt: true,
      createdAt: true,
      updatedAt: true,
      order: {
        select: {
          sourceShopifyOrderId: true,
          sourceShopifyOrderNumber: true,
        },
      },
      fulfillment: {
        select: {
          trackingUrl: true,
          fulfilledAt: true,
          shipmentCreatedAt: true,
          shipmentUpdatedAt: true,
        },
      },
      lineItems: {
        select: {
          quantity: true,
          lineAmount: true,
        },
      },
      refundRecords: {
        select: {
          id: true,
        },
      },
      outboundShopifyRefundAttempts: {
        select: {
          status: true,
        },
        orderBy: {
          updatedAt: 'desc',
        },
        take: 1,
      },
    },
    orderBy: {
      updatedAt: 'desc',
    },
    take: options.limit ?? 100,
    skip: options.offset ?? 0,
  }));

  return withDashboardTiming('orders.metrics_aggregation', () => allocations.map((allocation) => {
    const totalAmount = computeTotalAmount(allocation.lineItems);
    const cancelRefundReviewStatus =
      allocation.cancelRefundReviewStatus?.trim().toUpperCase() === 'RESOLVED'
        ? allocation.cancelRefundReviewStatus
        : null;
    const latestOutboundRefundAttemptStatus =
      allocation.outboundShopifyRefundAttempts?.[0]?.status?.trim().toUpperCase() === 'RESOLVED'
        ? allocation.outboundShopifyRefundAttempts[0]?.status ?? null
        : null;
    return {
      id: allocation.id,
      sourceShopifyOrderId: allocation.order.sourceShopifyOrderId,
      sourceShopifyOrderNumber: allocation.order.sourceShopifyOrderNumber,
      vendorId: allocation.assignedVendorId,
      assignedVendorId: allocation.assignedVendorId,
      originalVendorId: allocation.originalVendorId,
      allocationStatus: allocation.allocationStatus,
      refundRecordCount: (allocation.refundRecords ?? []).length,
      ...(cancelRefundReviewStatus ? { cancelRefundReviewStatus } : {}),
      ...(latestOutboundRefundAttemptStatus ? { latestOutboundRefundAttemptStatus } : {}),
      fulfillmentStatus: allocation.fulfillmentStatus,
      shippingStatus: allocation.shippingStatus,
      carrier: allocation.carrier,
      trackingNumber: allocation.trackingNumber,
      trackingUrl: allocation.fulfillment?.trackingUrl ?? allocation.vendorIntegrationTrackingUrl,
      fulfilledAt: toIsoString(allocation.fulfillment?.fulfilledAt),
      shipmentCreatedAt: toIsoString(allocation.fulfillment?.shipmentCreatedAt ?? allocation.vendorIntegrationShippedAt),
      shipmentUpdatedAt: toIsoString(allocation.fulfillment?.shipmentUpdatedAt),
      totalAmount: toAmountString(totalAmount),
      lineItemCount: allocation.lineItems.length,
      createdAt: allocation.createdAt.toISOString(),
      updatedAt: allocation.updatedAt.toISOString(),
    };
  }));
}

export async function rejectVendorOrderAllocation(
  vendorId: string,
  orderId: string,
  input: RejectVendorOrderInput,
): Promise<OrderDetailDto> {
  const reason = normalizeRejectReason(input.reason);
  const note = normalizeRejectNote(input.note);

  await prisma.$transaction(async (transaction) => {
    const allocation = await transaction.vendorAllocation.findFirst({
      where: {
        id: orderId,
      },
      select: {
        id: true,
        assignedVendorId: true,
        allocationStatus: true,
        fulfillmentStatus: true,
        shippingStatus: true,
        trackingNumber: true,
        carrier: true,
        fulfillment: {
          select: {
            fulfilledAt: true,
            shipmentCreatedAt: true,
            shipmentUpdatedAt: true,
            shopifyFulfillmentId: true,
            trackingNumber: true,
            trackingUrl: true,
          },
        },
        shipmentExecutions: {
          select: {
            providerShipmentId: true,
            trackingNumber: true,
            trackingUrl: true,
            shipmentStatus: true,
          },
          orderBy: {
            createdAt: 'desc',
          },
          take: 1,
        },
      },
    });

    if (!allocation || allocation.assignedVendorId !== vendorId) {
      throw new OrderRejectValidationError('Order not found.', 404);
    }

    if (allocation.allocationStatus !== AllocationStatus.ACTIVE) {
      const message = BLOCKED_ALLOCATION_STATUSES.has(allocation.allocationStatus)
        ? 'Order allocation cannot be rejected in its current status.'
        : 'Only active order allocations can be rejected.';
      throw new OrderRejectValidationError(message, 409);
    }

    if (hasShipmentEvidence(allocation)) {
      throw new OrderRejectValidationError('Order cannot be rejected after fulfillment, shipment, carrier, or tracking evidence exists.', 409);
    }

    await transaction.vendorAllocation.update({
      where: {
        id: allocation.id,
      },
      data: {
        allocationStatus: AllocationStatus.VENDOR_BLOCKED,
        reassignmentRequired: true,
        cancellationReason: reason,
      },
    });

    await transaction.allocationAssignmentHistory.create({
      data: {
        vendorAllocationId: allocation.id,
        action: 'vendor_blocked',
        fromVendorId: allocation.assignedVendorId,
        toVendorId: allocation.assignedVendorId,
        reason: `${reason}: ${note}`,
        actorUserId: input.actorUserId ?? null,
      },
    });
  });

  const updatedOrder = await getVendorOrderById(vendorId, orderId);
  if (!updatedOrder) {
    throw new OrderRejectValidationError('Order not found after reject update.', 404);
  }

  return updatedOrder;
}

export async function returnBlockedAllocationToVendor(
  shopifyOrderId: string,
  allocationId: string,
  input: AdminAllocationResolutionInput,
): Promise<AdminOrderBreakdownDto> {
  const note = normalizeAdminResolutionNote(input.note);

  await prisma.$transaction(async (transaction) => {
    const allocation = await transaction.vendorAllocation.findFirst({
      where: {
        id: allocationId,
        order: {
          sourceShopifyOrderId: shopifyOrderId,
        },
      },
      select: {
        id: true,
        assignedVendorId: true,
        allocationStatus: true,
        reassignmentRequired: true,
        fulfillmentStatus: true,
        shippingStatus: true,
        trackingNumber: true,
        carrier: true,
        fulfillment: {
          select: {
            fulfilledAt: true,
            shipmentCreatedAt: true,
            shipmentUpdatedAt: true,
            shopifyFulfillmentId: true,
            trackingNumber: true,
            trackingUrl: true,
          },
        },
        shipmentExecutions: {
          select: {
            providerShipmentId: true,
            trackingNumber: true,
            trackingUrl: true,
            shipmentStatus: true,
          },
          orderBy: {
            createdAt: 'desc',
          },
          take: 1,
        },
        returnRecords: {
          select: {
            status: true,
            returnLifecycleStatus: true,
          },
        },
        refundRecords: {
          select: {
            id: true,
          },
        },
      },
    });

    if (!allocation) {
      throw new OrderRejectValidationError('Allocation not found for Shopify order.', 404);
    }

    if (allocation.allocationStatus !== AllocationStatus.VENDOR_BLOCKED) {
      throw new OrderRejectValidationError('Only vendor-blocked allocations can be returned to vendor.', 409);
    }

    if (!allocation.reassignmentRequired) {
      throw new OrderRejectValidationError('Allocation is not marked for admin reassignment review.', 409);
    }

    if (hasShipmentEvidence(allocation)) {
      throw new OrderRejectValidationError('Allocation cannot be returned to vendor after fulfillment, shipment, carrier, or tracking evidence exists.', 409);
    }

    if (hasActiveReturnState(allocation)) {
      throw new OrderRejectValidationError('Allocation cannot be returned to vendor while an active return is linked.', 409);
    }

    if (hasRefundState(allocation)) {
      throw new OrderRejectValidationError('Allocation cannot be returned to vendor after refund evidence exists.', 409);
    }

    await transaction.vendorAllocation.update({
      where: {
        id: allocation.id,
      },
      data: {
        allocationStatus: AllocationStatus.ACTIVE,
        reassignmentRequired: false,
        cancellationReason: null,
      },
    });

    await transaction.allocationAssignmentHistory.create({
      data: {
        vendorAllocationId: allocation.id,
        action: 'admin_returned_to_vendor',
        fromVendorId: allocation.assignedVendorId,
        toVendorId: allocation.assignedVendorId,
        reason: note,
        actorUserId: input.actorUserId ?? null,
      },
    });
  });

  const updatedBreakdown = await getAdminShopifyOrderBreakdown(shopifyOrderId);
  if (!updatedBreakdown) {
    throw new OrderRejectValidationError('Shopify order not found after allocation resolution.', 404);
  }

  return updatedBreakdown;
}

export async function addBlockedAllocationResolutionNote(
  shopifyOrderId: string,
  allocationId: string,
  input: AdminAllocationResolutionInput,
): Promise<AdminOrderBreakdownDto> {
  const note = normalizeAdminResolutionNote(input.note);

  await prisma.$transaction(async (transaction) => {
    const allocation = await transaction.vendorAllocation.findFirst({
      where: {
        id: allocationId,
        order: {
          sourceShopifyOrderId: shopifyOrderId,
        },
      },
      select: {
        id: true,
        assignedVendorId: true,
      },
    });

    if (!allocation) {
      throw new OrderRejectValidationError('Allocation not found for Shopify order.', 404);
    }

    await transaction.allocationAssignmentHistory.create({
      data: {
        vendorAllocationId: allocation.id,
        action: 'admin_note',
        fromVendorId: allocation.assignedVendorId,
        toVendorId: allocation.assignedVendorId,
        reason: note,
        actorUserId: input.actorUserId ?? null,
      },
    });
  });

  const updatedBreakdown = await getAdminShopifyOrderBreakdown(shopifyOrderId);
  if (!updatedBreakdown) {
    throw new OrderRejectValidationError('Shopify order not found after allocation note.', 404);
  }

  return updatedBreakdown;
}

export async function requestCancelRefundReviewForAdminOrder(
  shopifyOrderId: string,
  allocationId: string,
  input: AdminCancelRefundReviewInput,
): Promise<AdminOrderBreakdownDto> {
  const reason = normalizeRejectReason(input.reason);
  const note = normalizeCancelRefundReviewNote(input.note);
  const requestedAt = new Date();

  await prisma.$transaction(async (transaction) => {
    const allocation = await transaction.vendorAllocation.findFirst({
      where: {
        id: allocationId,
        order: {
          sourceShopifyOrderId: shopifyOrderId,
        },
      },
      select: {
        id: true,
        assignedVendorId: true,
        allocationStatus: true,
        reassignmentRequired: true,
        fulfillmentStatus: true,
        shippingStatus: true,
        trackingNumber: true,
        carrier: true,
        fulfillment: {
          select: {
            fulfilledAt: true,
            shipmentCreatedAt: true,
            shipmentUpdatedAt: true,
            shopifyFulfillmentId: true,
            trackingNumber: true,
            trackingUrl: true,
          },
        },
        shipmentExecutions: {
          select: {
            providerShipmentId: true,
            trackingNumber: true,
            trackingUrl: true,
            shipmentStatus: true,
          },
          orderBy: {
            createdAt: 'desc',
          },
          take: 1,
        },
        returnRecords: {
          select: {
            status: true,
            returnLifecycleStatus: true,
          },
        },
        refundRecords: {
          select: {
            id: true,
          },
        },
        economicTransfers: {
          select: {
            status: true,
          },
        },
      },
    });

    if (!allocation) {
      throw new OrderRejectValidationError('Allocation not found for Shopify order.', 404);
    }

    if (allocation.allocationStatus !== AllocationStatus.VENDOR_BLOCKED) {
      throw new OrderRejectValidationError('Only vendor-blocked allocations can enter cancel/refund review.', 409);
    }

    if (!allocation.reassignmentRequired) {
      throw new OrderRejectValidationError('Allocation is not marked for admin reassignment review.', 409);
    }

    if (hasShipmentEvidence(allocation)) {
      throw new OrderRejectValidationError('Allocation cannot enter cancel/refund review after fulfillment, shipment, carrier, or tracking evidence exists.', 409);
    }

    if (hasActiveReturnState(allocation)) {
      throw new OrderRejectValidationError('Allocation cannot enter cancel/refund review while an active return is linked.', 409);
    }

    if (hasRefundState(allocation)) {
      throw new OrderRejectValidationError('Allocation cannot enter cancel/refund review after refund evidence exists.', 409);
    }

    if (allocation.economicTransfers.some((transfer) => transfer.status.trim().toUpperCase() === 'COMPLETED')) {
      throw new OrderRejectValidationError('Allocation cannot enter cancel/refund review after economic transfer completed.', 409);
    }

    await transaction.vendorAllocation.update({
      where: {
        id: allocation.id,
      },
      data: {
        cancelRefundReviewStatus: 'PENDING_REVIEW',
        cancelRefundReviewReason: reason,
        cancelRefundReviewNote: note,
        cancelRefundReviewRequestedAt: requestedAt,
        cancelRefundReviewRequestedByUserId: input.actorUserId ?? null,
      },
    });

    await transaction.allocationAssignmentHistory.create({
      data: {
        vendorAllocationId: allocation.id,
        action: 'cancel_refund_review_requested',
        fromVendorId: allocation.assignedVendorId,
        toVendorId: allocation.assignedVendorId,
        reason: `${reason}: ${note}`,
        actorUserId: input.actorUserId ?? null,
      },
    });
  });

  const updatedBreakdown = await getAdminShopifyOrderBreakdown(shopifyOrderId);
  if (!updatedBreakdown) {
    throw new OrderRejectValidationError('Shopify order not found after cancel/refund review request.', 404);
  }

  return updatedBreakdown;
}

export async function previewShopifyRefundForAdminOrder(
  shopifyOrderId: string,
  allocationId: string,
  input: AdminShopifyRefundPreviewInput,
): Promise<AdminShopifyRefundPreviewResponse> {
  const restockType = normalizeShopifyRefundPreviewRestockType(input.restockType);
  if (input.refundShipping !== false) {
    throw new OrderRejectValidationError('Refund shipping preview is not supported for allocation-scoped cancel/refund review.', 400);
  }

  const allocation = await prisma.vendorAllocation.findFirst({
    where: {
      id: allocationId,
      order: {
        sourceShopifyOrderId: shopifyOrderId,
      },
    },
    select: {
      id: true,
      allocationStatus: true,
      reassignmentRequired: true,
      cancelRefundReviewStatus: true,
      fulfillmentStatus: true,
      shippingStatus: true,
      trackingNumber: true,
      carrier: true,
      order: {
        select: {
          sourceShopifyOrderId: true,
        },
      },
      fulfillment: {
        select: {
          fulfilledAt: true,
          shipmentCreatedAt: true,
          shipmentUpdatedAt: true,
          shopifyFulfillmentId: true,
          trackingNumber: true,
          trackingUrl: true,
        },
      },
      shipmentExecutions: {
        select: {
          providerShipmentId: true,
          trackingNumber: true,
          trackingUrl: true,
          shipmentStatus: true,
        },
        orderBy: {
          createdAt: 'desc',
        },
        take: 1,
      },
      returnRecords: {
        select: {
          status: true,
          returnLifecycleStatus: true,
        },
      },
      refundRecords: {
        select: {
          id: true,
        },
      },
      economicTransfers: {
        select: {
          status: true,
        },
      },
      financeIntegrityAlerts: {
        where: {
          status: {
            in: [...FINANCE_INTEGRITY_ALERT_BLOCKING_STATUSES],
          },
          severity: {
            in: ['critical', 'warning'],
          },
        },
        select: {
          id: true,
          category: true,
        },
      },
      lineItems: {
        select: {
          id: true,
          quantity: true,
          shopifyOrderLineItem: {
            select: {
              sourceLineItemId: true,
            },
          },
        },
        orderBy: {
          id: 'asc',
        },
      },
      childAllocationSplitEvents: {
        select: {
          id: true,
        },
        take: 1,
      },
    },
  });

  if (!allocation) {
    throw new OrderRejectValidationError('Allocation not found for Shopify order.', 404);
  }

  if (!hasBlockingCancelRefundReviewStatus(allocation)) {
    throw new OrderRejectValidationError('Allocation must be in cancel/refund review before Shopify refund preview.', 409);
  }

  if (allocation.economicTransfers.some((transfer) => transfer.status.trim().toUpperCase() === 'COMPLETED')) {
    throw new OrderRejectValidationError('Allocation cannot be previewed for Shopify refund after economic transfer completed.', 409);
  }

  if (hasShipmentEvidence(allocation)) {
    throw new OrderRejectValidationError('Allocation cannot be previewed for Shopify refund after fulfillment, shipment, carrier, or tracking evidence exists.', 409);
  }

  if (allocation.returnRecords.length > 0) {
    throw new OrderRejectValidationError('Allocation cannot be previewed for Shopify refund after return evidence exists.', 409);
  }

  if (hasRefundState(allocation)) {
    throw new OrderRejectValidationError('Allocation cannot be previewed for Shopify refund after refund evidence exists.', 409);
  }

  if (allocation.financeIntegrityAlerts.length > 0) {
    throw new OrderRejectValidationError('Allocation has open or acknowledged finance integrity alerts and cannot be previewed for Shopify refund.', 409);
  }

  const pendingOutboundAttempt = await findOpenOutboundShopifyRefundAttemptForAllocation(allocation.id);
  if (pendingOutboundAttempt) {
    throw new OrderRejectValidationError('A Shopify refund attempt is already pending for this allocation.', 409);
  }

  const blockers: string[] = [];
  const missingData: string[] = [];
  const warnings: string[] = [];
  const refundLineItems = allocation.lineItems.map((lineItem) => {
    const sourceLineItemId = lineItem.shopifyOrderLineItem.sourceLineItemId?.trim() ?? '';
    if (!sourceLineItemId) {
      const message = `Allocation line item ${lineItem.id} is missing sourceLineItemId.`;
      blockers.push(message);
      missingData.push(message);
    }
    if (!Number.isFinite(lineItem.quantity) || lineItem.quantity <= 0) {
      blockers.push(`Allocation line item ${lineItem.id} has invalid refund quantity.`);
    }
    return {
      sourceLineItemId,
      quantity: lineItem.quantity,
      restockType,
    };
  });

  if (refundLineItems.length === 0) {
    blockers.push('Allocation has no line items to preview for refund.');
  }

  let fulfillmentOrderCancellation: FulfillmentOrderCancellationClassificationResult =
    buildUnrunFulfillmentOrderCancellationClassification(
      'Fulfillment order cancellation classification was not run because refund preview input is blocked.',
    );
  let mixedFulfillmentOrderDirectRefundProbe = buildMixedFulfillmentOrderDirectRefundProbeEvaluation();

  const blockedResponse = (): AdminShopifyRefundPreviewResponse => ({
    ok: true,
    writesPerformed: false,
    allocationId: allocation.id,
    shopifyOrderId: allocation.order.sourceShopifyOrderId,
    refundLineItemsPreview: refundLineItems.map((lineItem) => ({
      lineItemId: lineItem.sourceLineItemId,
      quantity: lineItem.quantity,
      restockType: lineItem.restockType,
    })),
    suggestedRefund: null,
    fulfillmentOrderCancellation,
    warnings,
    blockers,
    missingData,
    mixedFulfillmentOrderDirectRefundProbe,
  });

  if (blockers.length > 0) {
    await createPreviewOutboundShopifyRefundAttempt({
      vendorAllocationId: allocation.id,
      shopifyOrderId: allocation.order.sourceShopifyOrderId,
      restockType,
      refundShipping: false,
      requestedByUserId: input.actorUserId ?? null,
      refundLineItems: refundLineItems.map((lineItem) => ({
        lineItemId: lineItem.sourceLineItemId,
        quantity: lineItem.quantity,
        restockType: lineItem.restockType,
      })),
      suggestedTransactions: [],
      fulfillmentOrderCancellation,
      blockers,
      warnings,
    });
    return blockedResponse();
  }

  try {
    fulfillmentOrderCancellation = await classifyFulfillmentOrdersForAllocationRefund({
      shopifyOrderId: allocation.order.sourceShopifyOrderId,
      allocationId: allocation.id,
      selectedLineItems: refundLineItems.map((lineItem) => ({
        lineItemId: lineItem.sourceLineItemId,
        quantity: lineItem.quantity,
      })),
      shopifyAdminService: input.shopifyAdminService,
    });
    warnings.push(...fulfillmentOrderCancellation.warnings);
    if (fulfillmentOrderCancellation.overallClassification === 'blocked' || fulfillmentOrderCancellation.overallClassification === 'unknown') {
      blockers.push(...fulfillmentOrderCancellation.blockers);
    }
  } catch (error) {
    const diagnosticMessage = sanitizeFulfillmentOrderClassifierError(error);
    fulfillmentOrderCancellation = buildUnrunFulfillmentOrderCancellationClassification(
      'Shopify fulfillment order cancellation classification failed. Future refundCreate must verify affected fulfillment orders before running.',
      {
        code: 'fulfillment_order_classifier_exception',
        message: diagnosticMessage,
      },
    );
    blockers.push(...fulfillmentOrderCancellation.blockers);
  }

  mixedFulfillmentOrderDirectRefundProbe = evaluateMixedFulfillmentOrderDirectRefundProbe({
    allocation,
    selectedLineItems: refundLineItems.map((lineItem) => ({
      lineItemId: lineItem.sourceLineItemId,
      quantity: lineItem.quantity,
    })),
    fulfillmentOrderCancellation,
  });
  if (mixedFulfillmentOrderDirectRefundProbe.eligible) {
    warnings.push(...mixedFulfillmentOrderDirectRefundProbe.warnings);
  }

  const preview = await input.shopifyAdminService.previewSuggestedRefund({
    shopifyOrderId: allocation.order.sourceShopifyOrderId,
    refundLineItems,
    refundShipping: false,
  });

  for (const graphqlError of preview.graphqlErrors) {
    blockers.push(`Shopify suggested refund returned GraphQL error: ${graphqlError}`);
  }

  const transactions = preview.suggestedRefund?.suggestedTransactions ?? [];
  if (transactions.length === 0 || transactions.some((transaction) => !transaction.parentTransactionId?.trim())) {
    blockers.push('Suggested refund has no refundable payment transaction. Future refundCreate must not run.');
  }

  const suggestedTransactions = transactions.map((transaction) => ({
    gateway: transaction.gateway,
    amount: transaction.amount,
    currencyCode: transaction.currencyCode,
    parentTransactionId: transaction.parentTransactionId,
  }));

  await createPreviewOutboundShopifyRefundAttempt({
    vendorAllocationId: allocation.id,
    shopifyOrderId: allocation.order.sourceShopifyOrderId,
    restockType,
    refundShipping: false,
    requestedByUserId: input.actorUserId ?? null,
    refundLineItems: preview.refundLineItemsPreview,
    suggestedTransactions,
    fulfillmentOrderCancellation,
    blockers,
    warnings,
  });

  return {
    ok: true,
    writesPerformed: false,
    allocationId: allocation.id,
    shopifyOrderId: allocation.order.sourceShopifyOrderId,
    refundLineItemsPreview: preview.refundLineItemsPreview,
    suggestedRefund: preview.suggestedRefund
      ? {
          totalRefundAmount: preview.suggestedRefund.totalRefundAmount,
          currencyCode: preview.suggestedRefund.currencyCode,
          totalTaxAmount: preview.suggestedRefund.totalTaxAmount,
          shippingAmount: preview.suggestedRefund.shippingAmount,
          suggestedTransactions,
        }
      : null,
    fulfillmentOrderCancellation,
    warnings,
    blockers,
    missingData,
    mixedFulfillmentOrderDirectRefundProbe,
  };
}

export async function executeShopifyRefundForAdminOrder(
  shopifyOrderId: string,
  allocationId: string,
  input: AdminShopifyRefundExecutionInput,
): Promise<AdminShopifyRefundExecutionResponse> {
  if (input.confirmRefund !== true) {
    throw new OrderRejectValidationError('Shopify refund confirmation is required.', 400);
  }
  const restockType = normalizeShopifyRefundPreviewRestockType(input.restockType);
  const note = normalizeShopifyRefundExecutionNote(input.note);
  const notifyCustomer = input.notifyCustomer === true;
  if (input.refundShipping !== false) {
    throw new OrderRejectValidationError('Refund shipping is not supported for allocation-scoped Shopify refund execution.', 400);
  }

  const allocation = await prisma.vendorAllocation.findFirst({
    where: {
      id: allocationId,
      order: {
        sourceShopifyOrderId: shopifyOrderId,
      },
    },
    select: {
      id: true,
      allocationStatus: true,
      reassignmentRequired: true,
      cancelRefundReviewStatus: true,
      fulfillmentStatus: true,
      shippingStatus: true,
      trackingNumber: true,
      carrier: true,
      order: {
        select: {
          sourceShopifyOrderId: true,
        },
      },
      fulfillment: {
        select: {
          fulfilledAt: true,
          shipmentCreatedAt: true,
          shipmentUpdatedAt: true,
          shopifyFulfillmentId: true,
          trackingNumber: true,
          trackingUrl: true,
        },
      },
      shipmentExecutions: {
        select: {
          providerShipmentId: true,
          trackingNumber: true,
          trackingUrl: true,
          shipmentStatus: true,
        },
        orderBy: {
          createdAt: 'desc',
        },
        take: 1,
      },
      returnRecords: {
        select: {
          status: true,
          returnLifecycleStatus: true,
        },
      },
      refundRecords: {
        select: {
          id: true,
        },
      },
      economicTransfers: {
        select: {
          status: true,
        },
      },
      financeIntegrityAlerts: {
        where: {
          status: {
            in: [...FINANCE_INTEGRITY_ALERT_BLOCKING_STATUSES],
          },
          severity: {
            in: ['critical', 'warning'],
          },
        },
        select: {
          id: true,
          category: true,
        },
      },
      financeEntries: {
        where: {
          entryType: 'sale',
          voidedAt: null,
        },
        select: {
          payoutStatus: true,
          payoutBatchLines: {
            select: {
              payoutBatch: {
                select: {
                  status: true,
                },
              },
            },
          },
          settlementApprovalLines: {
            select: {
              settlementApproval: {
                select: {
                  status: true,
                  commissionInvoices: {
                    select: {
                      status: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
      lineItems: {
        select: {
          id: true,
          quantity: true,
          shopifyOrderLineItem: {
            select: {
              sourceLineItemId: true,
            },
          },
        },
        orderBy: {
          id: 'asc',
        },
      },
      childAllocationSplitEvents: {
        select: {
          id: true,
        },
        take: 1,
      },
    },
  });

  if (!allocation) {
    throw new OrderRejectValidationError('Allocation not found for Shopify order.', 404);
  }

  const reviewStatus = allocation.cancelRefundReviewStatus?.trim().toUpperCase() ?? '';
  if (reviewStatus === 'SHOPIFY_ACTION_PENDING') {
    throw new OrderRejectValidationError('A Shopify refund action is already pending for this allocation.', 409);
  }
  if (reviewStatus !== 'PENDING_REVIEW' && reviewStatus !== 'CUSTOMER_CONTACTED') {
    throw new OrderRejectValidationError('Allocation must be in cancel/refund review before Shopify refund execution.', 409);
  }

  if (allocation.economicTransfers.some((transfer) => transfer.status.trim().toUpperCase() === 'COMPLETED')) {
    throw new OrderRejectValidationError('Allocation cannot be Shopify-refunded after economic transfer completed.', 409);
  }

  if (hasShipmentEvidence(allocation)) {
    throw new OrderRejectValidationError('Allocation cannot be Shopify-refunded after fulfillment, shipment, carrier, or tracking evidence exists.', 409);
  }

  if (allocation.returnRecords.length > 0) {
    throw new OrderRejectValidationError('Allocation cannot be Shopify-refunded after return evidence exists.', 409);
  }

  if (hasRefundState(allocation)) {
    throw new OrderRejectValidationError('Allocation cannot be Shopify-refunded after refund evidence exists.', 409);
  }

  if (allocation.financeIntegrityAlerts.length > 0) {
    throw new OrderRejectValidationError('Allocation has open or acknowledged finance integrity alerts and cannot be Shopify-refunded.', 409);
  }

  if (hasSettlementPayoutOrLogoEvidence(allocation)) {
    throw new OrderRejectValidationError(
      'Allocation cannot be Shopify-refunded through this flow after settlement, payout, vendor payment, or Logo invoice evidence exists.',
      409,
    );
  }

  const activeAttempt = await findActiveOutboundShopifyRefundAttemptForAllocation(allocation.id);
  if (activeAttempt) {
    throw new OrderRejectValidationError('A Shopify refund attempt is already pending for this allocation.', 409);
  }

  const blockers: string[] = [];
  const warnings: string[] = [];
  const refundLineItems = allocation.lineItems.map((lineItem) => {
    const sourceLineItemId = lineItem.shopifyOrderLineItem.sourceLineItemId?.trim() ?? '';
    if (!sourceLineItemId) {
      blockers.push(`Allocation line item ${lineItem.id} is missing sourceLineItemId.`);
    }
    if (!Number.isFinite(lineItem.quantity) || lineItem.quantity <= 0) {
      blockers.push(`Allocation line item ${lineItem.id} has invalid refund quantity.`);
    }
    return {
      lineItemId: sourceLineItemId,
      quantity: lineItem.quantity,
      restockType,
    };
  });

  if (refundLineItems.length === 0) {
    blockers.push('Allocation has no line items to execute for refund.');
  }
  if (blockers.length > 0) {
    throw new OrderRejectValidationError(blockers.join(' '), 409);
  }

  let fulfillmentOrderCancellation: FulfillmentOrderCancellationClassificationResult =
    buildUnrunFulfillmentOrderCancellationClassification('Fulfillment order cancellation classification has not run yet.');
  const attempt = await createOrLockOutboundShopifyRefundExecutionAttempt({
    vendorAllocationId: allocation.id,
    shopifyOrderId: allocation.order.sourceShopifyOrderId,
    restockType,
    refundShipping: false,
    notifyCustomer,
    note,
    requestedByUserId: input.actorUserId ?? null,
    refundLineItems,
    suggestedTransactions: [],
    fulfillmentOrderCancellation,
    blockers: [],
    warnings: [],
  });

  const failAttempt = async (failureReason: string, options: {
    shopifyUserErrors?: unknown;
    mutationResponse?: unknown;
    fulfillmentOrderCancellation?: unknown;
    blockers?: unknown;
    warnings?: unknown;
  } = {}) => {
    await markOutboundShopifyRefundAttemptFailed({
      attemptId: attempt.id,
      failureReason,
      ...options,
    });
    throw new OrderRejectValidationError(failureReason, 409);
  };

  try {
    fulfillmentOrderCancellation = await classifyFulfillmentOrdersForAllocationRefund({
      shopifyOrderId: allocation.order.sourceShopifyOrderId,
      allocationId: allocation.id,
      selectedLineItems: refundLineItems.map((lineItem) => ({
        lineItemId: lineItem.lineItemId,
        quantity: lineItem.quantity,
      })),
      shopifyAdminService: input.shopifyAdminService,
    });
  } catch (error) {
    const failureReason = error instanceof Error
      ? `Shopify fulfillment order cancellation classification failed: ${error.message}`
      : 'Shopify fulfillment order cancellation classification failed.';
    await failAttempt(failureReason, {
      fulfillmentOrderCancellation,
      blockers: [failureReason],
      warnings,
    });
  }

  warnings.push(...fulfillmentOrderCancellation.warnings);
  const mixedFulfillmentOrderDirectRefundProbe = evaluateMixedFulfillmentOrderDirectRefundProbe({
    allocation,
    selectedLineItems: refundLineItems.map((lineItem) => ({
      lineItemId: lineItem.lineItemId,
      quantity: lineItem.quantity,
    })),
    fulfillmentOrderCancellation,
  });
  const mixedFulfillmentOrderDirectRefundProbeRequested =
    input.confirmMixedFulfillmentOrderDirectRefundProbe === true;
  const mixedFulfillmentOrderDirectRefundProbeAllowed =
    mixedFulfillmentOrderDirectRefundProbeRequested && mixedFulfillmentOrderDirectRefundProbe.eligible;

  if (fulfillmentOrderCancellation.overallClassification === 'blocked' || fulfillmentOrderCancellation.overallClassification === 'unknown') {
    if (mixedFulfillmentOrderDirectRefundProbe.eligible && !mixedFulfillmentOrderDirectRefundProbeRequested) {
      await failAttempt('Mixed fulfillment order direct refundCreate probe confirmation is required.', {
        fulfillmentOrderCancellation: {
          classification: fulfillmentOrderCancellation,
          mixedFulfillmentOrderDirectRefundProbe,
        },
        blockers: ['Mixed fulfillment order direct refundCreate probe confirmation is required.'],
        warnings,
      });
    }
    if (!mixedFulfillmentOrderDirectRefundProbeAllowed) {
      const probeBlockers = mixedFulfillmentOrderDirectRefundProbeRequested
        ? mixedFulfillmentOrderDirectRefundProbe.blockers
        : [];
      const failureReason = [...fulfillmentOrderCancellation.blockers, ...probeBlockers].length
        ? [...fulfillmentOrderCancellation.blockers, ...probeBlockers].join(' ')
        : 'Shopify fulfillment order cancellation classification did not pass.';
      await failAttempt(failureReason, {
        fulfillmentOrderCancellation: {
          classification: fulfillmentOrderCancellation,
          mixedFulfillmentOrderDirectRefundProbe,
        },
        blockers: [...fulfillmentOrderCancellation.blockers, ...probeBlockers],
        warnings,
      });
    }
    warnings.push(...mixedFulfillmentOrderDirectRefundProbe.warnings);
  }
  const postRefundFulfillmentCheckRequired =
    fulfillmentOrderCancellation.overallClassification === 'post_check_required' || mixedFulfillmentOrderDirectRefundProbeAllowed;
  if (postRefundFulfillmentCheckRequired && input.confirmPostRefundFulfillmentCheck !== true) {
    await failAttempt('Post-refund Shopify fulfillment check confirmation is required for this refund probe.', {
      fulfillmentOrderCancellation: {
        classification: fulfillmentOrderCancellation,
        mixedFulfillmentOrderDirectRefundProbe,
      },
      blockers: ['Post-refund Shopify fulfillment check confirmation is required for this refund probe.'],
      warnings,
    });
  }

  let refundLineItemLocationIds: Map<string, string>;
  try {
    refundLineItemLocationIds = resolveRefundLineItemLocationIds({
      refundLineItems,
      fulfillmentOrderCancellation,
    });
  } catch (error) {
    const failureReason = error instanceof Error ? error.message : 'Unable to resolve Shopify refund line item locationId.';
    await failAttempt(failureReason, {
      fulfillmentOrderCancellation: {
        classification: fulfillmentOrderCancellation,
        mixedFulfillmentOrderDirectRefundProbe,
      },
      blockers: [failureReason],
      warnings,
    });
    throw error;
  }

  const safeFulfillmentOrders = mixedFulfillmentOrderDirectRefundProbeAllowed
    ? []
    : fulfillmentOrderCancellation.affectedFulfillmentOrders.filter((order) => order.classification === 'safe_to_cancel');
  const fulfillmentOrderCancellationResults: Array<{
    fulfillmentOrderId: string;
    result: CancelFulfillmentOrderResult;
  }> = [];
  for (const fulfillmentOrder of safeFulfillmentOrders) {
    try {
      const result = await input.shopifyAdminService.cancelFulfillmentOrder({
        fulfillmentOrderId: fulfillmentOrder.fulfillmentOrderId,
      });
      fulfillmentOrderCancellationResults.push({
        fulfillmentOrderId: fulfillmentOrder.fulfillmentOrderId,
        result,
      });
      if (result.userErrors.length > 0) {
        await failAttempt(
          `Shopify fulfillment order cancellation failed: ${result.userErrors.map((error) => error.message).join('; ')}`,
          {
            shopifyUserErrors: result.userErrors,
            mutationResponse: fulfillmentOrderCancellationResults,
            fulfillmentOrderCancellation: {
              classification: fulfillmentOrderCancellation,
              cancellationResults: fulfillmentOrderCancellationResults,
            },
            blockers: result.userErrors.map((error) => error.message),
            warnings,
          },
        );
      }
    } catch (error) {
      const failureReason = error instanceof Error
        ? `Shopify fulfillment order cancellation failed: ${error.message}`
        : 'Shopify fulfillment order cancellation failed.';
      await failAttempt(failureReason, {
        mutationResponse: fulfillmentOrderCancellationResults,
        fulfillmentOrderCancellation: {
          classification: fulfillmentOrderCancellation,
          cancellationResults: fulfillmentOrderCancellationResults,
        },
        blockers: [failureReason],
        warnings,
      });
    }
  }

  const preview = await input.shopifyAdminService.previewSuggestedRefund({
    shopifyOrderId: allocation.order.sourceShopifyOrderId,
    refundLineItems: refundLineItems.map((lineItem) => ({
      sourceLineItemId: lineItem.lineItemId,
      quantity: lineItem.quantity,
      restockType: lineItem.restockType,
    })),
    refundShipping: false,
  });

  const suggestedRefundBlockers = [...preview.graphqlErrors.map((error) => `Shopify suggested refund returned GraphQL error: ${error}`)];
  const transactions = preview.suggestedRefund?.suggestedTransactions ?? [];
  if (transactions.length === 0) {
    suggestedRefundBlockers.push('Suggested refund has no refundable payment transaction. RefundCreate must not run.');
  }
  for (const transaction of transactions) {
    if (!transaction.parentTransactionId?.trim()) {
      suggestedRefundBlockers.push('Suggested refund transaction is missing parentTransactionId. RefundCreate must not run.');
    }
    if (!transaction.amount?.trim()) {
      suggestedRefundBlockers.push('Suggested refund transaction is missing amount. RefundCreate must not run.');
    }
    if (!transaction.gateway?.trim()) {
      suggestedRefundBlockers.push('Suggested refund transaction is missing gateway. RefundCreate must not run.');
    }
  }

  if (suggestedRefundBlockers.length > 0) {
    await failAttempt(suggestedRefundBlockers.join(' '), {
      mutationResponse: {
        suggestedRefund: preview.suggestedRefund,
        graphqlErrors: preview.graphqlErrors,
      },
      fulfillmentOrderCancellation: {
        classification: fulfillmentOrderCancellation,
        cancellationResults: fulfillmentOrderCancellationResults,
        mixedFulfillmentOrderDirectRefundProbe,
      },
      blockers: suggestedRefundBlockers,
      warnings,
    });
  }

  const suggestedTransactions = transactions.map((transaction) => ({
    gateway: transaction.gateway?.trim() ?? '',
    amount: transaction.amount?.trim() ?? '',
    currencyCode: transaction.currencyCode,
    parentTransactionId: transaction.parentTransactionId?.trim() ?? '',
  }));
  let refundLineItemsWithLocationIds: CreateShopifyRefundInput['refundLineItems'];
  refundLineItemsWithLocationIds = attachRefundLineItemLocationIds({
    refundLineItems: preview.refundLineItemsPreview,
    locationIdsByLineItemId: refundLineItemLocationIds,
  });
  const refundCreateResult = await input.shopifyAdminService.createShopifyRefund({
    orderId: allocation.order.sourceShopifyOrderId,
    refundLineItems: refundLineItemsWithLocationIds,
    transactions: suggestedTransactions.map((transaction) => ({
      parentTransactionId: transaction.parentTransactionId,
      amount: transaction.amount,
      gateway: transaction.gateway,
    })),
    note,
    notify: notifyCustomer,
    idempotencyKey: `shopify-refund:${allocation.id}:${attempt.id}`,
  });

  if (refundCreateResult.userErrors.length > 0) {
    await failAttempt(`Shopify refundCreate failed: ${refundCreateResult.userErrors.map((error) => error.message).join('; ')}`, {
      shopifyUserErrors: refundCreateResult.userErrors,
      mutationResponse: refundCreateResult.rawResponse,
      fulfillmentOrderCancellation: {
        classification: fulfillmentOrderCancellation,
        cancellationResults: fulfillmentOrderCancellationResults,
        mixedFulfillmentOrderDirectRefundProbe,
      },
      blockers: refundCreateResult.userErrors.map((error) => error.message),
      warnings,
    });
  }

  let postRefundFulfillmentCheck: ReturnType<typeof buildPostRefundFulfillmentCheck> | {
    status: 'warning';
    message: string;
    mode: 'standard_open_unsubmitted' | 'mixed_fulfillment_order_direct_refund_probe';
    preCheck: FulfillmentOrderCancellationClassificationResult;
    postCheck: null;
    activeFulfillableLineItems: [];
    sourceLineItemsWithoutFulfillableQuantity: MixedFulfillmentOrderDirectRefundProbeEvaluation['sourceLineItems'];
    selectedLineItemsWithoutZeroRemainingQuantity: Array<{
      lineItemId: string;
      quantity: number;
    }>;
  } | null = null;
  if (postRefundFulfillmentCheckRequired) {
    try {
      const postCheckFulfillmentOrders = await input.shopifyAdminService.fetchFulfillmentOrdersForCancellationClassification(
        allocation.order.sourceShopifyOrderId,
      );
      postRefundFulfillmentCheck = buildPostRefundFulfillmentCheck({
        preCheck: fulfillmentOrderCancellation,
        postCheck: postCheckFulfillmentOrders,
        selectedLineItems: refundLineItems.map((lineItem) => ({
          lineItemId: lineItem.lineItemId,
          quantity: lineItem.quantity,
        })),
        sourceLineItems: mixedFulfillmentOrderDirectRefundProbeAllowed
          ? mixedFulfillmentOrderDirectRefundProbe.sourceLineItems
          : undefined,
        mode: mixedFulfillmentOrderDirectRefundProbeAllowed
          ? 'mixed_fulfillment_order_direct_refund_probe'
          : 'standard_open_unsubmitted',
      });
    } catch (error) {
      postRefundFulfillmentCheck = {
        status: 'warning',
        message: `Refund was submitted, but Shopify fulfillment post-check failed: ${sanitizeFulfillmentOrderClassifierError(error)}`,
        mode: mixedFulfillmentOrderDirectRefundProbeAllowed
          ? 'mixed_fulfillment_order_direct_refund_probe'
          : 'standard_open_unsubmitted',
        preCheck: fulfillmentOrderCancellation,
        postCheck: null,
        activeFulfillableLineItems: [],
        sourceLineItemsWithoutFulfillableQuantity: mixedFulfillmentOrderDirectRefundProbeAllowed
          ? mixedFulfillmentOrderDirectRefundProbe.sourceLineItems
          : [],
        selectedLineItemsWithoutZeroRemainingQuantity: mixedFulfillmentOrderDirectRefundProbeAllowed
          ? mixedFulfillmentOrderDirectRefundProbe.selectedLineItems
          : [],
      };
    }
    if (postRefundFulfillmentCheck.status !== 'passed') {
      warnings.push(postRefundFulfillmentCheck.message);
    }
  }

  const mutationResponse = postRefundFulfillmentCheck
    ? {
        refundCreate: refundCreateResult.rawResponse,
        postRefundFulfillmentCheck,
      }
    : refundCreateResult.rawResponse;

  await markOutboundShopifyRefundAttemptSubmitted({
    attemptId: attempt.id,
    shopifyRefundId: refundCreateResult.refundId,
    mutationResponse,
    fulfillmentOrderCancellation: {
      classification: fulfillmentOrderCancellation,
      cancellationResults: fulfillmentOrderCancellationResults,
      postRefundFulfillmentCheck,
      mixedFulfillmentOrderDirectRefundProbe,
    },
    suggestedTransactions,
    blockers: [],
    warnings,
  });
  await prisma.vendorAllocation.update({
    where: {
      id: allocation.id,
    },
    data: {
      cancelRefundReviewStatus: OUTBOUND_SHOPIFY_REFUND_ATTEMPT_STATUSES.SHOPIFY_ACTION_PENDING,
    },
  });

  return {
    ok: true,
    writesPerformed: true,
    status: OUTBOUND_SHOPIFY_REFUND_ATTEMPT_STATUSES.SHOPIFY_ACTION_PENDING,
    shopifyRefundId: refundCreateResult.refundId,
    attemptId: attempt.id,
    message: postRefundFulfillmentCheck
      ? postRefundFulfillmentCheck.status === 'passed'
        ? 'Shopify refund submitted. Fulfillment post-check passed. Waiting for refunds/create webhook.'
        : postRefundFulfillmentCheck.message
      : 'Shopify refund submitted. Waiting for refunds/create webhook.',
  };
}

export async function transferAllocationEconomicsForAdminOrder(
  shopifyOrderId: string,
  allocationId: string,
  input: AdminEconomicTransferInput,
): Promise<AdminEconomicTransferResponse> {
  const allocation = await prisma.vendorAllocation.findFirst({
    where: {
      id: allocationId,
      order: {
        sourceShopifyOrderId: shopifyOrderId,
      },
    },
    select: {
      id: true,
    },
  });

  if (!allocation) {
    throw new OrderRejectValidationError('Allocation not found for Shopify order.', 404);
  }

  const transfer = await transferAllocationEconomics({
    vendorAllocationId: allocation.id,
    toVendorId: input.toVendorId,
    adminUserId: input.actorUserId ?? null,
    reason: input.reason,
    confirmTransfer: true,
  });

  const updatedBreakdown = await getAdminShopifyOrderBreakdown(shopifyOrderId);
  if (!updatedBreakdown) {
    throw new OrderRejectValidationError('Shopify order not found after economic transfer.', 404);
  }

  return {
    ok: true,
    transfer,
    order: updatedBreakdown,
  };
}

export async function planAllocationSplitForVendorOrder(
  vendorId: string,
  allocationId: string,
  input: {
    selectedVendorAllocationLineItemIds?: string[];
    reason?: string | null;
    note?: string | null;
  },
): Promise<AllocationSplitPlannerResponseDto> {
  const result = await planAllocationSplitForLineItemReject({
    vendorAllocationId: allocationId,
    selectedVendorAllocationLineItemIds: input.selectedVendorAllocationLineItemIds,
    actorVendorId: vendorId,
    reason: input.reason ?? undefined,
    note: input.note ?? undefined,
  });

  return mapAllocationSplitPlannerResponse(result);
}

export async function splitAllocationForVendorOrder(
  vendorId: string,
  allocationId: string,
  input: {
    selectedVendorAllocationLineItemIds?: string[];
    reason: string;
    note?: string | null;
    actorUserId?: string | null;
  },
): Promise<AllocationSplitExecutionResponseDto> {
  const result = await splitAllocationForLineItemReject({
    vendorAllocationId: allocationId,
    selectedVendorAllocationLineItemIds: input.selectedVendorAllocationLineItemIds,
    actorVendorId: vendorId,
    actorUserId: input.actorUserId ?? undefined,
    reason: input.reason,
    note: input.note ?? undefined,
    confirmSplit: true,
  });

  return mapAllocationSplitExecutionResponse(result, {
    reason: input.reason,
    note: input.note ?? null,
    actorUserId: input.actorUserId ?? null,
  });
}

export async function getVendorOrderById(
  vendorId: string,
  orderId: string,
): Promise<OrderDetailDto | null> {
  const allocation = await prisma.vendorAllocation.findFirst({
    where: {
      id: orderId,
      assignedVendorId: vendorId,
    },
    include: {
      order: true,
      fulfillment: true,
      shipmentExecutions: {
        orderBy: {
          createdAt: 'desc',
        },
        take: 1,
      },
      lineItems: {
        include: {
          shopifyOrderLineItem: true,
        },
      },
      assignmentHistory: {
        orderBy: {
          createdAt: 'asc',
        },
      },
      sourceAllocationSplitEvents: {
        orderBy: {
          createdAt: 'desc',
        },
        include: {
          actorUser: {
            select: {
              name: true,
            },
          },
          childAllocation: {
            include: {
              lineItems: {
                include: {
                  shopifyOrderLineItem: true,
                },
                orderBy: {
                  createdAt: 'asc',
                },
              },
            },
          },
        },
        take: 1,
      },
      childAllocationSplitEvents: {
        orderBy: {
          createdAt: 'desc',
        },
        include: {
          actorUser: {
            select: {
              name: true,
            },
          },
          childAllocation: {
            include: {
              lineItems: {
                include: {
                  shopifyOrderLineItem: true,
                },
                orderBy: {
                  createdAt: 'asc',
                },
              },
            },
          },
        },
        take: 1,
      },
      refundRecords: {
        select: {
          id: true,
        },
      },
      outboundShopifyRefundAttempts: {
        select: {
          status: true,
        },
        orderBy: {
          updatedAt: 'desc',
        },
        take: 1,
      },
    },
  });

  if (!allocation) {
    return null;
  }

  const totalAmount = computeTotalAmount(allocation.lineItems);
  const shopifyReturnSignal = await getLatestShopifyReturnSignalForOrder(allocation.order.id);
  const cancelRefundReviewStatus =
    allocation.cancelRefundReviewStatus?.trim().toUpperCase() === 'RESOLVED'
      ? allocation.cancelRefundReviewStatus
      : null;
  const latestOutboundRefundAttemptStatus =
    allocation.outboundShopifyRefundAttempts?.[0]?.status?.trim().toUpperCase() === 'RESOLVED'
      ? allocation.outboundShopifyRefundAttempts[0]?.status ?? null
      : null;

  return {
    id: allocation.id,
    sourceShopifyOrderId: allocation.order.sourceShopifyOrderId,
    sourceShopifyOrderNumber: allocation.order.sourceShopifyOrderNumber,
    customerName: allocation.order.customerName,
    vendorId: allocation.assignedVendorId,
    assignedVendorId: allocation.assignedVendorId,
    originalVendorId: allocation.originalVendorId,
    allocationStatus: allocation.allocationStatus,
    refundRecordCount: (allocation.refundRecords ?? []).length,
    ...(cancelRefundReviewStatus ? { cancelRefundReviewStatus } : {}),
    ...(latestOutboundRefundAttemptStatus ? { latestOutboundRefundAttemptStatus } : {}),
    fulfillmentStatus: allocation.fulfillmentStatus,
    shippingStatus: allocation.shippingStatus,
    totalAmount: toAmountString(totalAmount),
    lineItemCount: allocation.lineItems.length,
    createdAt: allocation.createdAt.toISOString(),
    updatedAt: allocation.updatedAt.toISOString(),
    carrier: allocation.carrier,
    trackingNumber: allocation.trackingNumber,
    trackingUrl: allocation.fulfillment?.trackingUrl ?? allocation.vendorIntegrationTrackingUrl,
    fulfilledAt: toIsoString(allocation.fulfillment?.fulfilledAt),
    shipmentCreatedAt: toIsoString(allocation.fulfillment?.shipmentCreatedAt ?? allocation.vendorIntegrationShippedAt),
    shipmentUpdatedAt: toIsoString(allocation.fulfillment?.shipmentUpdatedAt),
    shopifyFulfillmentSync: mapShopifyFulfillmentSync(allocation.fulfillment, {
      trackingNumber: allocation.trackingNumber,
      carrier: allocation.carrier,
      trackingUrl: allocation.fulfillment?.trackingUrl ?? allocation.vendorIntegrationTrackingUrl,
    }),
    shopifyReturnSignal,
    shipmentExecution: mapShipmentExecution(allocation.shipmentExecutions?.[0]),
    reassignmentRequired: allocation.reassignmentRequired,
    cancellationReason: allocation.cancellationReason,
    orderSnapshot: {
      shopifyCreatedAt: toIsoString(allocation.order.shopifyCreatedAt),
      currency: allocation.order.currency,
      financialStatus: allocation.order.financialStatus,
      paymentGatewayName: allocation.order.paymentGatewayName,
      taxesIncluded: allocation.order.taxesIncluded,
      orderTaxAmount: toNullableAmountString(allocation.order.orderTaxAmount),
      shippingAmount: toNullableAmountString(allocation.order.shippingAmount),
      discountAmount: toNullableAmountString(allocation.order.discountAmount),
      orderNote: allocation.order.orderNote,
      orderTags: allocation.order.orderTags,
      vendorIntegrationStatus: allocation.vendorIntegrationStatus,
      vendorIntegrationStatusMessage: allocation.vendorIntegrationStatusMessage,
      vendorIntegrationStatusUpdatedAt: toIsoString(allocation.vendorIntegrationStatusUpdatedAt),
      vendorIntegrationProvider: allocation.vendorIntegrationProvider,
      vendorIntegrationTrackingUrl: allocation.vendorIntegrationTrackingUrl,
      vendorIntegrationShippedAt: toIsoString(allocation.vendorIntegrationShippedAt),
      vendorInvoiceNumber: allocation.vendorInvoiceNumber,
      vendorInvoiceDate: allocation.vendorInvoiceDate ? allocation.vendorInvoiceDate.toISOString().slice(0, 10) : null,
      vendorInvoiceUrl: allocation.vendorInvoiceUrl,
      vendorInvoiceAmount: toNullableAmountString(allocation.vendorInvoiceAmount),
      vendorInvoiceReceivedAt: toIsoString(allocation.vendorInvoiceReceivedAt),
      shippingAddress: {
        address: allocation.order.shippingAddress,
        city: allocation.order.shippingCity,
        district: allocation.order.shippingDistrict,
        postcode: allocation.order.shippingPostcode,
        country: allocation.order.shippingCountry,
        customerPhonePresent: Boolean(allocation.order.customerPhone?.trim()),
      },
      billingAddress: {
        fullName: allocation.order.billingFullName,
        company: allocation.order.billingCompany,
        phone: allocation.order.billingPhone,
        city: allocation.order.billingCity,
        district: allocation.order.billingDistrict,
        address1: allocation.order.billingAddress1,
        address2: allocation.order.billingAddress2,
        postcode: allocation.order.billingPostcode,
      },
    },
    lineItems: allocation.lineItems.map((item) => ({
      id: item.id,
      sourceLineItemId: item.shopifyOrderLineItem.sourceLineItemId,
      sourceVariantId: item.shopifyOrderLineItem.sourceVariantId,
      sku: item.shopifyOrderLineItem.sku,
      title: item.shopifyOrderLineItem.title,
      imageUrl: item.shopifyOrderLineItem.imageUrl,
      quantity: item.quantity,
      lineAmount: toAmountString(Number(item.lineAmount ?? 0)),
      shopifyProductId: item.shopifyOrderLineItem.shopifyProductId,
      unitPriceVatIncluded: toNullableAmountString(item.shopifyOrderLineItem.unitPriceVatIncluded),
      lineTotalVatIncluded: toNullableAmountString(item.shopifyOrderLineItem.lineTotalVatIncluded),
      lineTaxAmount: toNullableAmountString(item.shopifyOrderLineItem.lineTaxAmount),
      vatRate: toNullableAmountString(item.shopifyOrderLineItem.vatRate),
    })),
    assignmentHistory: allocation.assignmentHistory.map((entry) => ({
      id: entry.id,
      action: entry.action,
      fromVendorId: entry.fromVendorId,
      toVendorId: entry.toVendorId,
      reason: entry.reason,
      actorUserId: entry.actorUserId,
      createdAt: entry.createdAt.toISOString(),
    })),
    splitSummary: mapAllocationSplitSummary(
      allocation.childAllocationSplitEvents[0] ?? allocation.sourceAllocationSplitEvents[0] ?? null,
      allocation.id,
    ),
  };
}

export async function getVendorOrderByIdForUser(
  vendorId: string,
  orderId: string,
  options: {
    includeShipmentProviderResponseSummary?: boolean;
    includeFinanceLedgerPreview?: boolean;
  } = {},
): Promise<OrderDetailDto | null> {
  const order = await getVendorOrderById(vendorId, orderId);
  if (!order) {
    return order;
  }

  const financeLedgerPreview = options.includeFinanceLedgerPreview
    ? await getFinanceLedgerPreviewForAllocation(vendorId, order.id)
    : undefined;

  const shipmentExecution = options.includeShipmentProviderResponseSummary
    ? await prisma.shipmentExecution.findFirst({
        where: {
          allocationId: order.id,
          vendorId,
        },
        orderBy: {
          createdAt: 'desc',
        },
      })
    : null;

  return {
    ...order,
    ...(financeLedgerPreview !== undefined ? { financeLedgerPreview } : {}),
    shipmentExecution: options.includeShipmentProviderResponseSummary
      ? mapShipmentExecution(shipmentExecution, {
          includeProviderResponseSummary: true,
        })
      : order.shipmentExecution,
  };
}

export async function getAdminShopifyOrderBreakdown(
  shopifyOrderId: string,
): Promise<AdminOrderBreakdownDto | null> {
  const order = await prisma.shopifyOrder.findUnique({
    where: {
      sourceShopifyOrderId: shopifyOrderId,
    },
    include: {
        allocations: {
          include: {
            assignedVendor: true,
            originalVendor: true,
            fulfillment: true,
            lineItems: {
            include: {
              shopifyOrderLineItem: true,
            },
          },
          assignmentHistory: {
            orderBy: {
              createdAt: 'asc',
            },
          },
          sourceAllocationSplitEvents: {
            orderBy: {
              createdAt: 'desc',
            },
            include: {
              actorUser: {
                select: {
                  name: true,
                },
              },
              childAllocation: {
                include: {
                  lineItems: {
                    include: {
                      shopifyOrderLineItem: true,
                    },
                    orderBy: {
                      createdAt: 'asc',
                    },
                  },
                },
              },
            },
            take: 1,
          },
          childAllocationSplitEvents: {
            orderBy: {
              createdAt: 'desc',
            },
            include: {
              actorUser: {
                select: {
                  name: true,
                },
              },
              childAllocation: {
                include: {
                  lineItems: {
                    include: {
                      shopifyOrderLineItem: true,
                    },
                    orderBy: {
                      createdAt: 'asc',
                    },
                  },
                },
              },
            },
            take: 1,
          },
            returnRecords: {
              orderBy: {
                createdAt: 'desc',
              },
              include: {
                ownerVendor: true,
              },
            },
          refundRecords: {
            orderBy: {
              createdAt: 'desc',
            },
            include: {
              lineItems: {
                orderBy: {
                  createdAt: 'asc',
                },
              },
            },
          },
          economicTransfers: {
            select: {
              id: true,
              status: true,
              fromVendorId: true,
              toVendorId: true,
              reason: true,
              completedAt: true,
              adminActorUserId: true,
              createdAt: true,
              fromVendor: {
                select: {
                  name: true,
                },
              },
              toVendor: {
                select: {
                  name: true,
                },
              },
            },
            orderBy: [
              {
                completedAt: 'desc',
              },
              {
                createdAt: 'desc',
              },
            ],
          },
          financeEntries: {
            select: {
              vendorId: true,
              entryType: true,
              voidedAt: true,
              vendor: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
          financeIntegrityAlerts: {
            where: {
              status: {
                in: [...FINANCE_INTEGRITY_ALERT_BLOCKING_STATUSES],
              },
              severity: {
                in: ['critical', 'warning'],
              },
            },
            select: {
              id: true,
              severity: true,
              category: true,
              reason: true,
              status: true,
              detectedAt: true,
              vendorAllocationId: true,
              allocationEconomicTransferId: true,
              affectedLedgerIds: true,
            },
            orderBy: {
              detectedAt: 'desc',
            },
          },
          outboundShopifyRefundAttempts: {
            select: {
              id: true,
              status: true,
              restockType: true,
              refundShipping: true,
              notifyCustomer: true,
              previewedAt: true,
              requestedAt: true,
              submittedAt: true,
              resolvedAt: true,
              failedAt: true,
              failureReason: true,
              shopifyRefundId: true,
              mutationResponseJson: true,
            },
            orderBy: {
              requestedAt: 'desc',
            },
            take: 1,
          },
        },
        orderBy: {
          createdAt: 'asc',
        },
      },
    },
  });

  if (!order) {
    return null;
  }

  const orderTotal = order.allocations.reduce(
    (sum, allocation) =>
      sum +
      allocation.lineItems.reduce((lineSum, lineItem) => lineSum + toNumber(lineItem.lineAmount), 0),
    0,
  );

  return {
    order: {
      sourceShopifyOrderId: order.sourceShopifyOrderId,
      sourceShopifyOrderNumber: order.sourceShopifyOrderNumber,
      customerName: order.customerName,
      customerEmail: order.customerEmail,
      totalAmount: order.totalPrice ? toAmountString(toNumber(order.totalPrice)) : toAmountString(orderTotal),
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString(),
    },
    allocations: order.allocations.map((allocation) => {
      const allocationTotal = allocation.lineItems.reduce(
        (sum, lineItem) => sum + toNumber(lineItem.lineAmount),
        0,
      );
      const latestCompletedTransfer = [...allocation.economicTransfers]
        .filter((transfer) => transfer.status.trim().toUpperCase() === 'COMPLETED')
        .sort((left, right) => {
          const rightTime = right.completedAt?.getTime() ?? right.createdAt.getTime();
          const leftTime = left.completedAt?.getTime() ?? left.createdAt.getTime();
          return rightTime - leftTime;
        })[0] ?? null;

      return {
        id: allocation.id,
        vendorId: allocation.assignedVendorId,
        vendorName: allocation.assignedVendor.name,
        originalVendorId: allocation.originalVendorId,
        assignedVendorId: allocation.assignedVendorId,
        allocationStatus: allocation.allocationStatus,
        cancellationReason: allocation.cancellationReason,
        reassignmentRequired: allocation.reassignmentRequired,
        cancelRefundReview: allocation.cancelRefundReviewStatus
          ? {
              status: allocation.cancelRefundReviewStatus,
              reason: allocation.cancelRefundReviewReason,
              note: allocation.cancelRefundReviewNote,
              requestedAt: toIsoString(allocation.cancelRefundReviewRequestedAt),
              requestedByUserId: allocation.cancelRefundReviewRequestedByUserId,
            }
          : null,
        fulfillmentStatus: allocation.fulfillmentStatus,
        shippingStatus: allocation.shippingStatus,
        trackingNumber: allocation.trackingNumber,
        carrier: allocation.carrier,
        trackingUrl: allocation.fulfillment?.trackingUrl ?? null,
        fulfilledAt: toIsoString(allocation.fulfillment?.fulfilledAt),
        shipmentCreatedAt: toIsoString(allocation.fulfillment?.shipmentCreatedAt),
        shipmentUpdatedAt: toIsoString(allocation.fulfillment?.shipmentUpdatedAt),
        totalAmount: toAmountString(allocationTotal),
        lineItems: allocation.lineItems.map((lineItem) => ({
          id: lineItem.id,
          sourceLineItemId: lineItem.shopifyOrderLineItem.sourceLineItemId,
          sourceVariantId: lineItem.shopifyOrderLineItem.sourceVariantId,
          sku: lineItem.shopifyOrderLineItem.sku,
          title: lineItem.shopifyOrderLineItem.title,
          imageUrl: lineItem.shopifyOrderLineItem.imageUrl,
          quantity: lineItem.quantity,
          lineAmount: toAmountString(toNumber(lineItem.lineAmount)),
        })),
        assignmentHistory: allocation.assignmentHistory.map((history) => ({
          id: history.id,
          action: history.action,
          fromVendorId: history.fromVendorId,
          toVendorId: history.toVendorId,
          reason: history.reason,
          actorUserId: history.actorUserId,
          createdAt: history.createdAt.toISOString(),
        })),
          returnRecords: allocation.returnRecords.map((returnRecord) => ({
            id: returnRecord.id,
            status: returnRecord.status,
            reason: returnRecord.reason,
            createdAt: returnRecord.createdAt.toISOString(),
            updatedAt: returnRecord.updatedAt.toISOString(),
            returnOwnershipSummary: buildReturnOwnershipSummary({ returnRecord, allocation }),
          })),
        refundRecords: allocation.refundRecords.map((refundRecord) => ({
          id: refundRecord.id,
          sourceShopifyRefundId: refundRecord.sourceShopifyRefundId,
          amount: toAmountString(toNumber(refundRecord.amount)),
          status: refundRecord.status,
          createdAt: refundRecord.createdAt.toISOString(),
          updatedAt: refundRecord.updatedAt.toISOString(),
          lineItems: refundRecord.lineItems.map((lineItem) => ({
            id: lineItem.id,
            sku: lineItem.sku,
            title: lineItem.title,
            sourceLineItemId: lineItem.sourceLineItemId,
            quantity: lineItem.quantity,
            subtotal: lineItem.subtotal === null ? null : toAmountString(toNumber(lineItem.subtotal)),
          })),
        })),
        financeIntegrityAlerts: allocation.financeIntegrityAlerts.map((alert) => ({
          id: alert.id,
          severity: alert.severity,
          category: alert.category,
          reason: alert.reason,
          status: alert.status,
          detectedAt: alert.detectedAt.toISOString(),
          vendorAllocationId: alert.vendorAllocationId,
          allocationEconomicTransferId: alert.allocationEconomicTransferId,
          affectedLedgerIds: alert.affectedLedgerIds,
        })),
        outboundRefundAttemptSummary: allocation.outboundShopifyRefundAttempts[0]
          ? mapOutboundShopifyRefundAttemptSummary(allocation.outboundShopifyRefundAttempts[0])
          : null,
        transferSummary: latestCompletedTransfer
          ? {
              id: latestCompletedTransfer.id,
              status: latestCompletedTransfer.status,
              fromVendorId: latestCompletedTransfer.fromVendorId,
              toVendorId: latestCompletedTransfer.toVendorId,
              reason: latestCompletedTransfer.reason,
              completedAt: toIsoString(latestCompletedTransfer.completedAt),
              adminActorUserId: latestCompletedTransfer.adminActorUserId,
            }
          : null,
        splitSummary: mapAllocationSplitSummary(
          allocation.childAllocationSplitEvents[0] ?? allocation.sourceAllocationSplitEvents[0] ?? null,
          allocation.id,
        ),
      };
    }),
  };
}
