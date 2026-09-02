import {
  AllocationStatus,
  CustomerCancellationStatus,
  Prisma,
} from '@prisma/client';
import type { AppEnv } from '../../config/env.js';
import { prisma } from '../../db/prisma.js';
import { createShopifyAdminService } from '../shopify/shopify-admin.service.js';
import type {
  CanonicalShopifyRefundSnapshot,
  ShopifyFulfillmentOrderCancellationClassificationResponse,
} from '../shopify/shopify-admin.types.js';
import {
  classifyCanonicalRefundMonetaryEvidence,
  REFUND_MONETARY_CLASSIFICATIONS,
} from '../shopify/shopify-refund-monetary-evidence.js';
import { acquireShopifyOrderTransactionLock } from '../shopify/orders-create-ownership.service.js';
import { FINANCE_INTEGRITY_ALERT_BLOCKING_STATUSES } from '../finance/finance-integrity-alert.service.js';
import { buildShopifyRefundIdempotencyKey } from './order-shipping-refund-claim.service.js';
import { OUTBOUND_SHOPIFY_REFUND_ATTEMPT_STATUSES } from './outbound-shopify-refund-attempt.service.js';
import {
  submitShopifyRefundCore,
  validateSuggestedRefundForSubmission,
} from './shopify-refund-core.service.js';
import { processCustomerCancellationOrderCancel } from './customer-cancellation-order-cancel.service.js';

export const CUSTOMER_CANCELLATION_AUTO_REFUND_CLASSIFICATIONS = {
  CLEAN: 'CLEAN',
  TOO_LATE: 'TOO_LATE',
  CONFLICTED: 'CONFLICTED',
  FINANCE_CONFLICT: 'FINANCE_CONFLICT',
  CANONICAL_UNAVAILABLE: 'CANONICAL_UNAVAILABLE',
  REFUND_CONFLICT: 'REFUND_CONFLICT',
  SIBLING_IN_PROGRESS: 'SIBLING_IN_PROGRESS',
  OTHER_UNSAFE: 'OTHER_UNSAFE',
} as const;

export type CustomerCancellationAutoRefundClassification =
  (typeof CUSTOMER_CANCELLATION_AUTO_REFUND_CLASSIFICATIONS)[keyof typeof CUSTOMER_CANCELLATION_AUTO_REFUND_CLASSIFICATIONS];

type ShopifyService = ReturnType<typeof createShopifyAdminService>;

export type CustomerCancellationAutoRefundCleanContext = {
  sourceShopifyOrderId: string;
  orderCurrency: string | null;
  allocationId: string;
  sourceLineItemId: string;
  requestedQuantity: number;
  preRefundCurrentQuantity: number;
  preRefundRefundableQuantity: number;
  locationId: string;
  preview: Awaited<ReturnType<ShopifyService['previewSuggestedRefund']>>;
  fulfillmentOrders: ShopifyFulfillmentOrderCancellationClassificationResponse;
};

export type CustomerCancellationAutoRefundEligibility = {
  classification: CustomerCancellationAutoRefundClassification;
  reason: string;
  context: CustomerCancellationAutoRefundCleanContext | null;
};

function gidTail(value: string | null | undefined) {
  const normalized = value?.trim() ?? '';
  return normalized.split('/').at(-1) ?? normalized;
}

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function localShipmentConflict(allocation: {
  trackingNumber: string | null;
  carrier: string | null;
  vendorIntegrationTrackingUrl: string | null;
  vendorIntegrationShippedAt: Date | null;
  fulfillment: { id: string; shopifyFulfillmentId: string | null; trackingNumber: string | null; shipmentCreatedAt: Date | null; fulfilledAt: Date | null; syncStatus: string | null } | null;
  shipmentExecutions: Array<{ providerShipmentId: string | null; trackingNumber: string | null; shipmentStatus: string; responseSnapshot: Prisma.JsonValue | null }>;
  vendorIntegrationShipmentEvents: Array<{ id: string }>;
}) {
  return Boolean(
    allocation.trackingNumber || allocation.carrier || allocation.vendorIntegrationTrackingUrl ||
    allocation.vendorIntegrationShippedAt || allocation.fulfillment?.id || allocation.fulfillment?.shopifyFulfillmentId ||
    allocation.fulfillment?.trackingNumber || allocation.fulfillment?.shipmentCreatedAt ||
    allocation.fulfillment?.fulfilledAt || allocation.fulfillment?.syncStatus ||
    allocation.vendorIntegrationShipmentEvents.length || allocation.shipmentExecutions.some((execution) =>
      Boolean(execution.providerShipmentId || execution.trackingNumber || execution.shipmentStatus !== 'PENDING' || execution.responseSnapshot),
    )
  );
}

async function loadItem(itemId: string) {
  return prisma.customerCancellationRequestItem.findUnique({
    where: { id: itemId },
    include: {
      request: {
        include: {
          order: { select: { id: true, sourceShopifyOrderId: true, currency: true, cancelledAt: true } },
          items: {
            select: {
              id: true,
              outboundShopifyRefundAttempt: { select: { id: true, status: true } },
            },
          },
        },
      },
      shopifyOrderLineItem: { select: { sourceLineItemId: true } },
      outboundShopifyRefundAttempt: true,
      vendorAllocation: {
        include: {
          lineItems: { select: { shopifyLineItemId: true, quantity: true } },
          fulfillment: true,
          shipmentExecutions: true,
          vendorIntegrationShipmentEvents: { select: { id: true }, take: 1 },
          returnRecords: { select: { id: true, sourceShopifyLineItemId: true }, take: 5 },
          refundRecords: {
            select: {
              id: true,
              lineItems: { select: { sourceLineItemId: true, quantity: true } },
            },
          },
          economicTransfers: { select: { id: true, status: true }, take: 5 },
          financeIntegrityAlerts: {
            where: { status: { in: [...FINANCE_INTEGRITY_ALERT_BLOCKING_STATUSES] }, severity: { in: ['critical', 'warning'] } },
            select: { id: true }, take: 1,
          },
          financeEntries: {
            where: { entryType: 'sale', voidedAt: null },
            select: {
              id: true,
              payoutStatus: true,
              payoutBatchLines: { select: { payoutBatch: { select: { status: true } } } },
              settlementApprovalLines: { select: { settlementApproval: { select: { status: true, commissionInvoices: { select: { status: true } } } } } },
            },
            take: 10,
          },
          outboundShopifyRefundAttempts: {
            where: { status: { in: [
              OUTBOUND_SHOPIFY_REFUND_ATTEMPT_STATUSES.PREVIEWED,
              OUTBOUND_SHOPIFY_REFUND_ATTEMPT_STATUSES.READY_TO_SUBMIT,
              OUTBOUND_SHOPIFY_REFUND_ATTEMPT_STATUSES.SHOPIFY_ACTION_PENDING,
            ] } },
            select: { id: true, customerCancellationRequestItemId: true },
          },
        },
      },
    },
  });
}

function classifyLocal(item: NonNullable<Awaited<ReturnType<typeof loadItem>>>): CustomerCancellationAutoRefundEligibility | null {
  if (item.status !== CustomerCancellationStatus.PENDING && item.status !== CustomerCancellationStatus.APPROVED_FOR_REFUND) {
    return { classification: 'OTHER_UNSAFE', reason: 'Cancellation item is terminal or not processable.', context: null };
  }
  const allocation = item.vendorAllocation;
  const exactMappings = allocation.lineItems.filter((line) => line.shopifyLineItemId === item.shopifyOrderLineItemId);
  if (exactMappings.length !== 1 || exactMappings[0]!.quantity < item.requestedQuantity) {
    return { classification: 'CONFLICTED', reason: 'Exact local allocation/line/quantity mapping is unavailable.', context: null };
  }
  if (
    allocation.allocationStatus !== AllocationStatus.ACTIVE || allocation.reassignmentRequired ||
    allocation.cancellationReason || allocation.cancelRefundReviewStatus
  ) return { classification: 'CONFLICTED', reason: 'Allocation authority is not clean and active.', context: null };
  if (localShipmentConflict(allocation)) return { classification: 'TOO_LATE', reason: 'Local shipment or fulfillment authority exists.', context: null };
  if (allocation.returnRecords.length) return { classification: 'CONFLICTED', reason: 'Local return evidence overlaps the allocation.', context: null };
  if (allocation.refundRecords.some((refund) =>
    refund.lineItems.some((line) => line.sourceLineItemId === item.shopifyOrderLineItem.sourceLineItemId && line.quantity > 0),
  )) return { classification: 'REFUND_CONFLICT', reason: 'Local refund evidence overlaps the exact line item.', context: null };
  const activeSiblingAttempt = item.request.items.some((candidate) =>
    candidate.id !== item.id &&
    candidate.outboundShopifyRefundAttempt &&
    [
      OUTBOUND_SHOPIFY_REFUND_ATTEMPT_STATUSES.PREVIEWED,
      OUTBOUND_SHOPIFY_REFUND_ATTEMPT_STATUSES.READY_TO_SUBMIT,
      OUTBOUND_SHOPIFY_REFUND_ATTEMPT_STATUSES.SHOPIFY_ACTION_PENDING,
    ].includes(candidate.outboundShopifyRefundAttempt.status as never),
  );
  if (activeSiblingAttempt) {
    return { classification: 'SIBLING_IN_PROGRESS', reason: 'A sibling full-order refund item is still active.', context: null };
  }
  if (allocation.outboundShopifyRefundAttempts.some((attempt) => attempt.customerCancellationRequestItemId !== item.id)) {
    return { classification: 'REFUND_CONFLICT', reason: 'Another active refund attempt owns the allocation.', context: null };
  }
  if (
    allocation.economicTransfers.some((transfer) => transfer.status === 'COMPLETED') ||
    allocation.financeIntegrityAlerts.length ||
    allocation.financeEntries.some((entry) =>
      entry.payoutStatus === 'PAID' ||
      entry.payoutBatchLines.some((line) => line.payoutBatch.status.toLowerCase() !== 'cancelled') ||
      entry.settlementApprovalLines.some((line) => {
        const status = line.settlementApproval.status.toLowerCase();
        return status !== 'cancelled' || line.settlementApproval.commissionInvoices.some((invoice) => invoice.status.toLowerCase() !== 'cancelled');
      })
    )
  ) return { classification: 'FINANCE_CONFLICT', reason: 'Vendor economics have progressed or require finance review.', context: null };
  if (!Number.isSafeInteger(item.requestedQuantity) || item.requestedQuantity <= 0) {
    return { classification: 'OTHER_UNSAFE', reason: 'Requested quantity is invalid.', context: null };
  }
  return null;
}

function exactRefundedQuantity(refund: CanonicalShopifyRefundSnapshot, lineItemId: string) {
  return refund.refundLineItems
    .filter((line) => gidTail(line.lineItemGid ?? line.sourceLineItemId) === gidTail(lineItemId))
    .reduce((sum, line) => sum + line.quantity, 0);
}

export async function classifyCustomerCancellationAutoRefundEligibility(input: {
  itemId: string;
  shopifyAdminService: ShopifyService;
}): Promise<CustomerCancellationAutoRefundEligibility> {
  const item = await loadItem(input.itemId);
  if (!item) return { classification: 'OTHER_UNSAFE', reason: 'Cancellation item was not found.', context: null };
  const local = classifyLocal(item);
  if (local) return local;

  const sourceOrderId = item.request.order.sourceShopifyOrderId;
  try {
    const [order, refunds, returns, fulfillmentOrders] = await Promise.all([
      input.shopifyAdminService.fetchCustomerCancellationOrderSnapshot(sourceOrderId),
      input.shopifyAdminService.fetchCanonicalRefundsForOrder(sourceOrderId),
      input.shopifyAdminService.fetchCanonicalReturnsForOrder(sourceOrderId),
      input.shopifyAdminService.fetchFulfillmentOrdersForCancellationClassification(sourceOrderId),
    ]);
    if (!order || !refunds || !returns) {
      return { classification: 'CANONICAL_UNAVAILABLE', reason: 'Canonical Shopify order/refund/return evidence is unavailable.', context: null };
    }
    if (order.cancelledAt) return { classification: 'CONFLICTED', reason: 'Canonical Shopify order is cancelled.', context: null };
    const sourceLineItemId = item.shopifyOrderLineItem.sourceLineItemId;
    const canonicalLine = order.lineItems.find((line) => gidTail(line.lineItemGid) === gidTail(sourceLineItemId));
    if (!canonicalLine || canonicalLine.currentQuantity === null || canonicalLine.refundableQuantity === null ||
      canonicalLine.currentQuantity < item.requestedQuantity || canonicalLine.refundableQuantity < item.requestedQuantity) {
      return { classification: 'CONFLICTED', reason: 'Canonical current/refundable quantity is insufficient.', context: null };
    }
    if (refunds.refunds.some((refund) => exactRefundedQuantity(refund, sourceLineItemId) > 0)) {
      return { classification: 'REFUND_CONFLICT', reason: 'Canonical refund evidence already overlaps the line item.', context: null };
    }
    if (returns.returns.some((record) => record.returnLineItems.some((line) => gidTail(line.lineItemGid ?? line.sourceLineItemId) === gidTail(sourceLineItemId)))) {
      return { classification: 'CONFLICTED', reason: 'Canonical return evidence overlaps the line item.', context: null };
    }
    const owners = fulfillmentOrders.fulfillmentOrders.filter((order) =>
      order.lineItems.some((line) => gidTail(line.lineItemId) === gidTail(sourceLineItemId)),
    );
    if (owners.length !== 1) return { classification: 'CONFLICTED', reason: 'FulfillmentOrder ownership is ambiguous.', context: null };
    const owner = owners[0]!;
    const fulfillmentLine = owner.lineItems.find((line) => gidTail(line.lineItemId) === gidTail(sourceLineItemId));
    if (owner.status?.toUpperCase() !== 'OPEN' || owner.requestStatus?.toUpperCase() !== 'UNSUBMITTED' ||
      !fulfillmentLine || fulfillmentLine.remainingQuantity === null || fulfillmentLine.remainingQuantity < item.requestedQuantity) {
      return { classification: 'TOO_LATE', reason: 'FulfillmentOrder is not clean OPEN/UNSUBMITTED with sufficient remaining quantity.', context: null };
    }
    if (!owner.assignedLocationId?.trim()) return { classification: 'OTHER_UNSAFE', reason: 'Required restock location is unavailable.', context: null };
    const preview = await input.shopifyAdminService.previewSuggestedRefund({
      shopifyOrderId: sourceOrderId,
      refundLineItems: [{ sourceLineItemId, quantity: item.requestedQuantity, restockType: 'CANCEL' }],
      refundShipping: false,
    });
    const validation = validateSuggestedRefundForSubmission({ preview, orderCurrency: item.request.order.currency });
    const previewLine = preview.refundLineItemsPreview.find((line) => gidTail(line.lineItemId) === gidTail(sourceLineItemId));
    if (validation.blockers.length || !previewLine || previewLine.quantity !== item.requestedQuantity) {
      return { classification: 'FINANCE_CONFLICT', reason: validation.blockers.join(' ') || 'Suggested refund quantity did not match.', context: null };
    }
    return {
      classification: 'CLEAN',
      reason: 'Exact item is clean, unshipped, refundable, and canonically eligible.',
      context: {
        sourceShopifyOrderId: sourceOrderId,
        orderCurrency: item.request.order.currency,
        allocationId: item.vendorAllocationId,
        sourceLineItemId,
        requestedQuantity: item.requestedQuantity,
        preRefundCurrentQuantity: canonicalLine.currentQuantity,
        preRefundRefundableQuantity: canonicalLine.refundableQuantity,
        locationId: owner.assignedLocationId,
        preview,
        fulfillmentOrders,
      },
    };
  } catch (error) {
    return { classification: 'CANONICAL_UNAVAILABLE', reason: error instanceof Error ? error.message : 'Canonical Shopify reads failed.', context: null };
  }
}

function aggregate(statuses: CustomerCancellationStatus[]) {
  return new Set(statuses).size === 1 ? statuses[0]! : CustomerCancellationStatus.PARTIALLY_RESOLVED;
}

class CustomerCancellationSiblingRefundInProgressError extends Error {}

async function approveAndCreateAttempt(itemId: string, context: CustomerCancellationAutoRefundCleanContext) {
  return prisma.$transaction(async (tx) => {
    const initial = await tx.customerCancellationRequestItem.findUnique({
      where: { id: itemId },
      select: { request: { select: { order: { select: { sourceShopifyOrderId: true } } } } },
    });
    if (!initial) throw new Error('Customer cancellation item disappeared.');
    await acquireShopifyOrderTransactionLock(tx, initial.request.order.sourceShopifyOrderId);
    const current = await tx.customerCancellationRequestItem.findUnique({
      where: { id: itemId },
      include: {
        request: { include: { items: { select: { id: true, status: true } } } },
        vendorAllocation: { include: { lineItems: { select: { shopifyLineItemId: true, quantity: true } }, fulfillment: true, shipmentExecutions: true, vendorIntegrationShipmentEvents: { select: { id: true }, take: 1 } } },
        outboundShopifyRefundAttempt: true,
      },
    });
    if (!current || (current.status !== CustomerCancellationStatus.PENDING && current.status !== CustomerCancellationStatus.APPROVED_FOR_REFUND)) {
      throw new Error('Customer cancellation item no longer has processable authority.');
    }
    const activeSiblingAttempt = await tx.outboundShopifyRefundAttempt.findFirst({
      where: {
        customerCancellationRequestItem: {
          requestId: current.requestId,
          id: { not: current.id },
        },
        status: {
          in: [
            OUTBOUND_SHOPIFY_REFUND_ATTEMPT_STATUSES.PREVIEWED,
            OUTBOUND_SHOPIFY_REFUND_ATTEMPT_STATUSES.READY_TO_SUBMIT,
            OUTBOUND_SHOPIFY_REFUND_ATTEMPT_STATUSES.SHOPIFY_ACTION_PENDING,
          ],
        },
      },
      select: { id: true },
    });
    if (activeSiblingAttempt) {
      throw new CustomerCancellationSiblingRefundInProgressError(
        'A sibling full-order refund item is still active.',
      );
    }
    if (current.vendorAllocation.allocationStatus !== AllocationStatus.ACTIVE || current.vendorAllocation.reassignmentRequired ||
      current.vendorAllocation.cancellationReason || current.vendorAllocation.cancelRefundReviewStatus || localShipmentConflict(current.vendorAllocation)) {
      throw new Error('Local allocation authority changed before auto-approval.');
    }
    const exactMappings = current.vendorAllocation.lineItems.filter((line) => line.shopifyLineItemId === current.shopifyOrderLineItemId);
    if (exactMappings.length !== 1 || exactMappings[0]!.quantity < current.requestedQuantity) {
      throw new Error('Local allocation line authority changed before auto-approval.');
    }
    if (current.status === CustomerCancellationStatus.PENDING) {
      await tx.customerCancellationRequestItem.update({ where: { id: itemId }, data: {
        status: CustomerCancellationStatus.APPROVED_FOR_REFUND,
        reviewedByUserId: null,
        reviewedAt: new Date(),
        reviewReason: 'AUTO_APPROVED_CLEAN_PRE_SHIPMENT',
      } });
      await tx.customerCancellationRequest.update({ where: { id: current.requestId }, data: {
        status: aggregate(current.request.items.map((candidate) => candidate.id === itemId ? CustomerCancellationStatus.APPROVED_FOR_REFUND : candidate.status)),
        resolvedAt: null,
      } });
    }
    return tx.outboundShopifyRefundAttempt.upsert({
      where: { customerCancellationRequestItemId: itemId },
      create: {
        customerCancellationRequestItemId: itemId,
        vendorAllocationId: current.vendorAllocationId,
        shopifyOrderId: context.sourceShopifyOrderId,
        status: OUTBOUND_SHOPIFY_REFUND_ATTEMPT_STATUSES.READY_TO_SUBMIT,
        restockType: 'CANCEL', refundShipping: false, notifyCustomer: false,
        note: `Customer cancellation item ${itemId}`,
        refundLineItemsJson: json([{
          lineItemId: context.sourceLineItemId,
          quantity: context.requestedQuantity,
          restockType: 'CANCEL',
          locationId: context.locationId,
          preRefundCurrentQuantity: context.preRefundCurrentQuantity,
          preRefundRefundableQuantity: context.preRefundRefundableQuantity,
        }]),
        suggestedTransactionsJson: json(context.preview.suggestedRefund?.suggestedTransactions ?? []),
        fulfillmentOrderCancellationJson: json(context.fulfillmentOrders),
        blockersJson: [], warningsJson: [], previewedAt: new Date(),
      },
      update: {},
    });
  });
}

export async function reconcileCustomerCancellationItemFromCanonicalRefunds(input: {
  itemId: string;
  shopifyAdminService: ShopifyService;
}) {
  const item = await loadItem(input.itemId);
  if (!item) return false;
  if (item.status === CustomerCancellationStatus.REFUNDED_AWAITING_ORDER_CANCEL) return true;
  if (item.status !== CustomerCancellationStatus.APPROVED_FOR_REFUND) return false;
  const [refunds, order] = await Promise.all([
    input.shopifyAdminService.fetchCanonicalRefundsForOrder(item.request.order.sourceShopifyOrderId),
    input.shopifyAdminService.fetchCustomerCancellationOrderSnapshot(item.request.order.sourceShopifyOrderId),
  ]);
  if (!refunds || !order) return false;
  const evidence = classifyCanonicalRefundMonetaryEvidence(refunds);
  const monetaryIds = new Set(evidence.refunds.filter((entry) => entry.classification === REFUND_MONETARY_CLASSIFICATIONS.monetaryRefund).map((entry) => entry.sourceShopifyRefundId));
  const relevant = refunds.refunds.filter((refund) => monetaryIds.has(refund.sourceShopifyRefundId) &&
    (!item.outboundShopifyRefundAttempt?.shopifyRefundId || gidTail(refund.refundGid) === gidTail(item.outboundShopifyRefundAttempt.shopifyRefundId)));
  const quantity = relevant.reduce((sum, refund) => sum + exactRefundedQuantity(refund, item.shopifyOrderLineItem.sourceLineItemId), 0);
  if (quantity !== item.requestedQuantity) return false;
  const submittedLine = Array.isArray(item.outboundShopifyRefundAttempt?.refundLineItemsJson)
    ? item.outboundShopifyRefundAttempt.refundLineItemsJson[0]
    : null;
  const preCurrent = submittedLine && typeof submittedLine === 'object' && !Array.isArray(submittedLine)
    ? Reflect.get(submittedLine, 'preRefundCurrentQuantity') : null;
  const preRefundable = submittedLine && typeof submittedLine === 'object' && !Array.isArray(submittedLine)
    ? Reflect.get(submittedLine, 'preRefundRefundableQuantity') : null;
  const canonicalLine = order.lineItems.find((line) => gidTail(line.lineItemGid) === gidTail(item.shopifyOrderLineItem.sourceLineItemId));
  if (
    typeof preCurrent !== 'number' || typeof preRefundable !== 'number' ||
    canonicalLine?.currentQuantity === null || canonicalLine?.currentQuantity === undefined ||
    canonicalLine.refundableQuantity === null || canonicalLine.refundableQuantity === undefined ||
    preCurrent - canonicalLine.currentQuantity < item.requestedQuantity ||
    preRefundable - canonicalLine.refundableQuantity < item.requestedQuantity
  ) return false;
  await prisma.$transaction(async (tx) => {
    await acquireShopifyOrderTransactionLock(tx, item.request.order.sourceShopifyOrderId);
    const current = await tx.customerCancellationRequestItem.findUnique({ where: { id: item.id }, include: { request: { include: { items: { select: { id: true, status: true } } } } } });
    if (!current || current.status !== CustomerCancellationStatus.APPROVED_FOR_REFUND) return;
    await tx.customerCancellationRequestItem.update({
      where: { id: item.id },
      data: {
        status: CustomerCancellationStatus.REFUNDED_AWAITING_ORDER_CANCEL,
        resolvedQuantity: current.requestedQuantity,
      },
    });
    const statuses = current.request.items.map((candidate) =>
      candidate.id === item.id ? CustomerCancellationStatus.REFUNDED_AWAITING_ORDER_CANCEL : candidate.status,
    );
    const parentStatus = aggregate(statuses);
    const allTerminal = statuses.every((status) =>
      status !== CustomerCancellationStatus.PENDING &&
      status !== CustomerCancellationStatus.APPROVED_FOR_REFUND &&
      status !== CustomerCancellationStatus.REFUNDED_AWAITING_ORDER_CANCEL &&
      status !== CustomerCancellationStatus.PARTIALLY_RESOLVED,
    );
    await tx.customerCancellationRequest.update({ where: { id: current.requestId }, data: { status: parentStatus, resolvedAt: allTerminal ? new Date() : null } });
    await tx.outboundShopifyRefundAttempt.updateMany({ where: { customerCancellationRequestItemId: item.id }, data: { status: OUTBOUND_SHOPIFY_REFUND_ATTEMPT_STATUSES.RESOLVED, resolvedAt: new Date(), failedAt: null, failureReason: null } });
  });
  return true;
}

export type CustomerCancellationAutoRefundProcessResult = 'COMPLETED' | 'AWAITING_RECONCILIATION' | 'RETRYABLE' | 'TERMINAL_EXCEPTION' | 'SKIPPED';

export function buildCustomerCancellationRefundSubmission(input: {
  itemId: string;
  attemptId: string;
  context: CustomerCancellationAutoRefundCleanContext;
}) {
  const validation = validateSuggestedRefundForSubmission({
    preview: input.context.preview,
    orderCurrency: input.context.orderCurrency,
  });
  return {
    blockers: validation.blockers,
    refund: {
      orderId: input.context.sourceShopifyOrderId,
      refundLineItems: [{
        lineItemId: input.context.sourceLineItemId,
        quantity: input.context.requestedQuantity,
        restockType: 'CANCEL' as const,
        locationId: input.context.locationId,
      }],
      transactions: validation.transactions.map((transaction) => ({
        parentTransactionId: transaction.parentTransactionId,
        amount: transaction.amount,
        gateway: transaction.gateway,
      })),
      shipping: null,
      note: `Customer cancellation item ${input.itemId}`,
      notify: false,
      idempotencyKey: buildShopifyRefundIdempotencyKey({
        allocationId: input.context.allocationId,
        attemptId: input.attemptId,
      }),
    },
  };
}

export async function processCustomerCancellationAutoRefundItem(input: {
  itemId: string;
  shopifyAdminService: ShopifyService;
}): Promise<CustomerCancellationAutoRefundProcessResult> {
  if (await reconcileCustomerCancellationItemFromCanonicalRefunds(input)) {
    const cancelResult = await processCustomerCancellationOrderCancel(input);
    if (cancelResult.outcome === 'APPROVED' || cancelResult.outcome === 'ALREADY_CANCELLED_APPROVED') return 'COMPLETED';
    if (cancelResult.outcome === 'AWAITING_JOB' || cancelResult.outcome === 'RETRYABLE') return 'RETRYABLE';
    if (cancelResult.outcome === 'TERMINAL_EXCEPTION') return 'TERMINAL_EXCEPTION';
    return 'SKIPPED';
  }
  let eligibility = await classifyCustomerCancellationAutoRefundEligibility(input);
  if (eligibility.classification === 'CANONICAL_UNAVAILABLE') return 'RETRYABLE';
  if (eligibility.classification === 'SIBLING_IN_PROGRESS') return 'RETRYABLE';
  if (eligibility.classification !== 'CLEAN' || !eligibility.context) return 'TERMINAL_EXCEPTION';
  let attempt;
  try {
    attempt = await approveAndCreateAttempt(input.itemId, eligibility.context);
  } catch (error) {
    if (error instanceof CustomerCancellationSiblingRefundInProgressError) return 'RETRYABLE';
    throw error;
  }
  if (attempt.status === OUTBOUND_SHOPIFY_REFUND_ATTEMPT_STATUSES.SHOPIFY_ACTION_PENDING) return 'AWAITING_RECONCILIATION';

  // Re-read all canonical authority after the transaction/lock has committed and before mutation.
  eligibility = await classifyCustomerCancellationAutoRefundEligibility(input);
  if (eligibility.classification !== 'CLEAN' || !eligibility.context) {
    return eligibility.classification === 'CANONICAL_UNAVAILABLE' || eligibility.classification === 'SIBLING_IN_PROGRESS'
      ? 'RETRYABLE'
      : 'TERMINAL_EXCEPTION';
  }
  const submission = buildCustomerCancellationRefundSubmission({ itemId: input.itemId, attemptId: attempt.id, context: eligibility.context });
  if (submission.blockers.length) return 'TERMINAL_EXCEPTION';
  let result;
  try {
    result = await submitShopifyRefundCore({
      service: input.shopifyAdminService,
      refund: submission.refund,
    });
  } catch {
    return 'RETRYABLE';
  }
  if (result.userErrors.length) {
    await prisma.outboundShopifyRefundAttempt.update({ where: { id: attempt.id }, data: {
      status: OUTBOUND_SHOPIFY_REFUND_ATTEMPT_STATUSES.FAILED,
      failedAt: new Date(),
      failureReason: result.userErrors.map((error) => error.message).join('; '),
      shopifyUserErrorsJson: json(result.userErrors),
      mutationResponseJson: result.rawResponse === undefined ? undefined : json(result.rawResponse),
    } });
    return 'TERMINAL_EXCEPTION';
  }
  await prisma.outboundShopifyRefundAttempt.update({ where: { id: attempt.id }, data: {
    status: OUTBOUND_SHOPIFY_REFUND_ATTEMPT_STATUSES.SHOPIFY_ACTION_PENDING,
    submittedAt: new Date(), shopifyRefundId: result.refundId,
    mutationResponseJson: result.rawResponse === undefined ? undefined : json(result.rawResponse),
  } });
  // A successful mutation response is deliberately not completion authority.
  if (!(await reconcileCustomerCancellationItemFromCanonicalRefunds(input))) return 'AWAITING_RECONCILIATION';
  const cancelResult = await processCustomerCancellationOrderCancel(input);
  if (cancelResult.outcome === 'APPROVED' || cancelResult.outcome === 'ALREADY_CANCELLED_APPROVED') return 'COMPLETED';
  if (cancelResult.outcome === 'AWAITING_JOB' || cancelResult.outcome === 'RETRYABLE') return 'RETRYABLE';
  if (cancelResult.outcome === 'TERMINAL_EXCEPTION') return 'TERMINAL_EXCEPTION';
  return 'SKIPPED';
}

export function createCustomerCancellationAutoRefundService(env: AppEnv) {
  return {
    processItem: (itemId: string) => processCustomerCancellationAutoRefundItem({ itemId, shopifyAdminService: createShopifyAdminService(env) }),
  };
}
