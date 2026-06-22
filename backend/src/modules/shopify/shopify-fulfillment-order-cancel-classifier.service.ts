import { prisma } from '../../db/prisma.js';
import type {
  ShopifyFulfillmentOrderCancellationClassificationResponse,
  ShopifyFulfillmentOrderForCancellationClassification,
} from './shopify-admin.types.js';

export type FulfillmentOrderCancellationClassification =
  | 'safe_to_cancel'
  | 'unsafe_mixed_fulfillment_order'
  | 'already_closed_or_cancelled'
  | 'unsupported_request_status'
  | 'quantity_mismatch'
  | 'unknown';

export type FulfillmentOrderCancellationOverallClassification =
  | 'safe_to_cancel'
  | 'no_cancellation_needed'
  | 'blocked'
  | 'unknown';

export type FulfillmentOrderCancellationLineItemClassification = {
  fulfillmentOrderLineItemId: string;
  shopifyLineItemId: string;
  selected: boolean;
  ownerAllocationId: string | null;
  selectedQuantity: number | null;
  remainingQuantity: number | null;
  totalQuantity: number | null;
};

export type FulfillmentOrderCancellationAffectedOrder = {
  fulfillmentOrderId: string;
  status: string | null;
  requestStatus: string | null;
  supportedActions: string[] | null;
  assignedLocationId: string | null;
  assignedLocationName: string | null;
  classification: FulfillmentOrderCancellationClassification;
  blockers: string[];
  warnings: string[];
  lineItems: FulfillmentOrderCancellationLineItemClassification[];
};

export type FulfillmentOrderCancellationClassificationResult = {
  affectedFulfillmentOrders: FulfillmentOrderCancellationAffectedOrder[];
  overallClassification: FulfillmentOrderCancellationOverallClassification;
  blockers: string[];
  warnings: string[];
  diagnosticCode?: string;
  diagnosticMessage?: string;
};

export type FulfillmentOrderCancellationClassifierShopifyService = {
  fetchFulfillmentOrdersForCancellationClassification(
    shopifyOrderId: string,
  ): Promise<ShopifyFulfillmentOrderCancellationClassificationResponse>;
};

export type ClassifyFulfillmentOrdersForAllocationRefundInput = {
  shopifyOrderId: string;
  allocationId: string;
  selectedLineItems: Array<{
    lineItemId: string;
    quantity: number;
  }>;
  shopifyAdminService: FulfillmentOrderCancellationClassifierShopifyService;
};

type LocalLineItemOwner = {
  sourceLineItemId: string;
  allocationId: string;
  vendorId: string;
};

const TERMINAL_FULFILLMENT_ORDER_STATUSES = new Set(['closed', 'cancelled', 'canceled', 'incomplete']);
const CANCELLATION_COMPATIBLE_STATUSES = new Set(['submitted', 'cancellation_requested']);
const DIRECT_CANCEL_ACTIONS = new Set(['cancel', 'cancel_fulfillment_order']);

function normalizeShopifyIdentifier(value: string | null | undefined) {
  const text = value?.trim() ?? '';
  if (!text) {
    return '';
  }
  return text.split('/').at(-1)?.trim().toLowerCase() || text.toLowerCase();
}

function normalizeToken(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? '';
}

function normalizeAction(value: string) {
  return value.trim().toLowerCase();
}

function isTerminalFulfillmentOrder(status: string | null | undefined) {
  return TERMINAL_FULFILLMENT_ORDER_STATUSES.has(normalizeToken(status));
}

function hasDirectCancelAction(supportedActions: string[] | null) {
  if (!supportedActions) {
    return false;
  }
  return supportedActions.some((action) => DIRECT_CANCEL_ACTIONS.has(normalizeAction(action)));
}

function hasConfirmedCancellationCompatibleStatus(fulfillmentOrder: ShopifyFulfillmentOrderForCancellationClassification) {
  return (
    CANCELLATION_COMPATIBLE_STATUSES.has(normalizeToken(fulfillmentOrder.status)) ||
    CANCELLATION_COMPATIBLE_STATUSES.has(normalizeToken(fulfillmentOrder.requestStatus))
  );
}

function createUnrunClassification(reason: string, diagnostic?: {
  code?: string;
  message?: string;
}): FulfillmentOrderCancellationClassificationResult {
  return {
    affectedFulfillmentOrders: [],
    overallClassification: 'unknown',
    blockers: [reason],
    warnings: [],
    diagnosticCode: diagnostic?.code,
    diagnosticMessage: diagnostic?.message,
  };
}

export function buildUnrunFulfillmentOrderCancellationClassification(
  reason = 'Fulfillment order cancellation classification was not run.',
  diagnostic?: {
    code?: string;
    message?: string;
  },
): FulfillmentOrderCancellationClassificationResult {
  return createUnrunClassification(reason, diagnostic);
}

export function classifyFulfillmentOrderCancellationSafety(input: {
  allocationId: string;
  selectedLineItems: Array<{
    lineItemId: string;
    quantity: number;
  }>;
  fulfillmentOrders: ShopifyFulfillmentOrderForCancellationClassification[];
  localLineItemOwners: LocalLineItemOwner[];
}): FulfillmentOrderCancellationClassificationResult {
  const selectedQuantitiesByLineItemId = new Map<string, number>();
  for (const lineItem of input.selectedLineItems) {
    const normalizedLineItemId = normalizeShopifyIdentifier(lineItem.lineItemId);
    if (!normalizedLineItemId) {
      continue;
    }
    selectedQuantitiesByLineItemId.set(normalizedLineItemId, lineItem.quantity);
  }

  const ownersByLineItemId = new Map<string, LocalLineItemOwner>();
  const ambiguousLineItemIds = new Set<string>();
  for (const owner of input.localLineItemOwners) {
    const normalizedLineItemId = normalizeShopifyIdentifier(owner.sourceLineItemId);
    if (!normalizedLineItemId) {
      continue;
    }
    if (ownersByLineItemId.has(normalizedLineItemId)) {
      ambiguousLineItemIds.add(normalizedLineItemId);
    }
    ownersByLineItemId.set(normalizedLineItemId, owner);
  }

  const affectedFulfillmentOrders: FulfillmentOrderCancellationAffectedOrder[] = [];

  for (const fulfillmentOrder of input.fulfillmentOrders) {
    const lineItems = fulfillmentOrder.lineItems.map((lineItem) => {
      const normalizedLineItemId = normalizeShopifyIdentifier(lineItem.lineItemId);
      const selectedQuantity = selectedQuantitiesByLineItemId.get(normalizedLineItemId) ?? null;
      const owner = ownersByLineItemId.get(normalizedLineItemId) ?? null;

      return {
        fulfillmentOrderLineItemId: lineItem.id,
        shopifyLineItemId: lineItem.lineItemId,
        selected: selectedQuantity !== null,
        ownerAllocationId: owner?.allocationId ?? null,
        selectedQuantity,
        remainingQuantity: lineItem.remainingQuantity,
        totalQuantity: lineItem.totalQuantity,
      };
    });
    const affected = lineItems.some((lineItem) => lineItem.selected);
    if (!affected) {
      continue;
    }

    const blockers: string[] = [];
    const warnings: string[] = [];
    let classification: FulfillmentOrderCancellationClassification = 'safe_to_cancel';

    if (isTerminalFulfillmentOrder(fulfillmentOrder.status)) {
      affectedFulfillmentOrders.push({
        fulfillmentOrderId: fulfillmentOrder.id,
        status: fulfillmentOrder.status,
        requestStatus: fulfillmentOrder.requestStatus,
        supportedActions: fulfillmentOrder.supportedActions,
        assignedLocationId: fulfillmentOrder.assignedLocationId,
        assignedLocationName: fulfillmentOrder.assignedLocationName,
        classification: 'already_closed_or_cancelled',
        blockers,
        warnings,
        lineItems,
      });
      continue;
    }

    for (const lineItem of lineItems) {
      const normalizedLineItemId = normalizeShopifyIdentifier(lineItem.shopifyLineItemId);
      if (!normalizedLineItemId) {
        blockers.push(`Fulfillment order ${fulfillmentOrder.id} has a line item without a Shopify line item id.`);
        classification = 'unknown';
        continue;
      }
      if (ambiguousLineItemIds.has(normalizedLineItemId)) {
        blockers.push(`Shopify line item ${lineItem.shopifyLineItemId} maps to multiple local allocations.`);
        classification = 'unknown';
        continue;
      }
      if (!lineItem.ownerAllocationId) {
        blockers.push(`Shopify line item ${lineItem.shopifyLineItemId} is not mapped to a local allocation.`);
        classification = 'unknown';
        continue;
      }
      if (!lineItem.selected || lineItem.ownerAllocationId !== input.allocationId) {
        blockers.push(
          `Fulfillment order ${fulfillmentOrder.id} contains Shopify line item ${lineItem.shopifyLineItemId} outside the selected allocation refund.`,
        );
        classification = 'unsafe_mixed_fulfillment_order';
        continue;
      }
      if (lineItem.remainingQuantity === null || !Number.isFinite(lineItem.remainingQuantity)) {
        blockers.push(`Fulfillment order line item ${lineItem.fulfillmentOrderLineItemId} is missing remainingQuantity.`);
        classification = classification === 'unsafe_mixed_fulfillment_order' ? classification : 'unknown';
        continue;
      }
      if (lineItem.selectedQuantity !== lineItem.remainingQuantity) {
        blockers.push(
          `Selected refund quantity for Shopify line item ${lineItem.shopifyLineItemId} does not match fulfillment order remainingQuantity.`,
        );
        if (classification !== 'unsafe_mixed_fulfillment_order') {
          classification = 'quantity_mismatch';
        }
      }
    }

    if (fulfillmentOrder.supportedActions === null) {
      blockers.push(
        `fulfillment_order_supported_actions_missing: Fulfillment order ${fulfillmentOrder.id} is missing supportedActions from Shopify.`,
      );
      if (classification === 'safe_to_cancel') {
        classification = 'unknown';
      }
    } else if (!hasDirectCancelAction(fulfillmentOrder.supportedActions)) {
      blockers.push(
        `fulfillment_order_cancel_action_not_supported: Fulfillment order ${fulfillmentOrder.id} does not advertise a direct cancel action.`,
      );
      if (classification === 'safe_to_cancel') {
        classification = 'unsupported_request_status';
      }
    }

    if (!normalizeToken(fulfillmentOrder.requestStatus)) {
      blockers.push(
        `fulfillment_order_request_status_missing: Fulfillment order ${fulfillmentOrder.id} is missing requestStatus from Shopify.`,
      );
      if (classification === 'safe_to_cancel') {
        classification = 'unknown';
      }
    } else if (!hasConfirmedCancellationCompatibleStatus(fulfillmentOrder)) {
      blockers.push(
        `fulfillment_order_status_not_confirmed_cancelable: Fulfillment order ${fulfillmentOrder.id} status/requestStatus is not confirmed compatible with fulfillmentOrderCancel.`,
      );
      if (classification === 'safe_to_cancel') {
        classification = 'unsupported_request_status';
      }
    }

    if (classification === 'safe_to_cancel') {
      warnings.push('Affected fulfillment orders must be cancelled before refundCreate.');
    }

    affectedFulfillmentOrders.push({
      fulfillmentOrderId: fulfillmentOrder.id,
      status: fulfillmentOrder.status,
      requestStatus: fulfillmentOrder.requestStatus,
      supportedActions: fulfillmentOrder.supportedActions,
      assignedLocationId: fulfillmentOrder.assignedLocationId,
      assignedLocationName: fulfillmentOrder.assignedLocationName,
      classification,
      blockers,
      warnings,
      lineItems,
    });
  }

  const activeAffectedOrders = affectedFulfillmentOrders.filter(
    (order) => order.classification !== 'already_closed_or_cancelled',
  );

  let overallClassification: FulfillmentOrderCancellationOverallClassification = 'no_cancellation_needed';
  if (activeAffectedOrders.some((order) => order.classification === 'unknown')) {
    overallClassification = 'unknown';
  }
  if (
    activeAffectedOrders.some((order) =>
      ['unsafe_mixed_fulfillment_order', 'unsupported_request_status', 'quantity_mismatch'].includes(order.classification),
    )
  ) {
    overallClassification = 'blocked';
  }
  if (activeAffectedOrders.length > 0 && activeAffectedOrders.every((order) => order.classification === 'safe_to_cancel')) {
    overallClassification = 'safe_to_cancel';
  }

  return {
    affectedFulfillmentOrders,
    overallClassification,
    blockers: affectedFulfillmentOrders.flatMap((order) => order.blockers),
    warnings: affectedFulfillmentOrders.flatMap((order) => order.warnings),
  };
}

export async function classifyFulfillmentOrdersForAllocationRefund(
  input: ClassifyFulfillmentOrdersForAllocationRefundInput,
): Promise<FulfillmentOrderCancellationClassificationResult> {
  const localAllocations = await prisma.vendorAllocation.findMany({
    where: {
      order: {
        sourceShopifyOrderId: input.shopifyOrderId,
      },
    },
    select: {
      id: true,
      assignedVendorId: true,
      lineItems: {
        select: {
          shopifyOrderLineItem: {
            select: {
              sourceLineItemId: true,
            },
          },
        },
      },
    },
  });

  const localLineItemOwners = localAllocations.flatMap((allocation) =>
    allocation.lineItems.map((lineItem) => ({
      sourceLineItemId: lineItem.shopifyOrderLineItem.sourceLineItemId,
      allocationId: allocation.id,
      vendorId: allocation.assignedVendorId,
    })),
  );

  const fulfillmentOrders = await input.shopifyAdminService.fetchFulfillmentOrdersForCancellationClassification(
    input.shopifyOrderId,
  );

  return classifyFulfillmentOrderCancellationSafety({
    allocationId: input.allocationId,
    selectedLineItems: input.selectedLineItems,
    fulfillmentOrders: fulfillmentOrders.fulfillmentOrders,
    localLineItemOwners,
  });
}
