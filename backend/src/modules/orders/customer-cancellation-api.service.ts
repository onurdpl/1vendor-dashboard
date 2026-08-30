import { CustomerCancellationStatus, type Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import type { CustomerAccountSession } from './customer-cancellation-session-token.service.js';
import {
  ACTIVE_CUSTOMER_CANCELLATION_REQUEST_STATUSES,
  isPendingCustomerCancellationHoldState,
} from './customer-cancellation-hold.service.js';
import {
  createPendingCustomerCancellationRequest,
  CustomerCancellationRequestConflictError,
  CustomerCancellationRequestValidationError,
  type CreateVerifiedCustomerCancellationRequestInput,
} from './customer-cancellation-request.service.js';
import { createShopifyAdminService } from '../shopify/shopify-admin.service.js';
import type { AppEnv } from '../../config/env.js';
import type {
  CustomerCancellationCanonicalOrderSnapshot,
  FetchCanonicalShopifyRefundsForOrderResult,
  FetchCanonicalShopifyReturnsForOrderResult,
} from '../shopify/shopify-admin.types.js';
import { FINANCE_INTEGRITY_ALERT_BLOCKING_STATUSES } from '../finance/finance-integrity-alert.service.js';
import { OUTBOUND_SHOPIFY_REFUND_ATTEMPT_STATUSES } from './outbound-shopify-refund-attempt.service.js';

export type CustomerCancellationApiErrorCode =
  | 'CUSTOMER_CANCELLATION_INTAKE_DISABLED'
  | 'ORDER_NOT_OWNED_BY_CUSTOMER'
  | 'INVALID_LINE_OR_QUANTITY'
  | 'CANCELLATION_ALREADY_PENDING'
  | 'CANCELLATION_TOO_LATE'
  | 'CANCELLATION_CONFLICT'
  | 'CUSTOMER_CANCELLATION_PENDING'
  | 'IDEMPOTENCY_CONFLICT'
  | 'SHOPIFY_CANONICAL_STATE_UNAVAILABLE';

export class CustomerCancellationApiError extends Error {
  constructor(
    readonly code: CustomerCancellationApiErrorCode,
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'CustomerCancellationApiError';
    Object.setPrototypeOf(this, CustomerCancellationApiError.prototype);
  }
}

type CustomerCancellationDb = Pick<Prisma.TransactionClient, 'shopifyOrder'>;
type ShopifyReadService = Pick<
  ReturnType<typeof createShopifyAdminService>,
  'fetchCustomerCancellationOrderSnapshot' | 'fetchCanonicalRefundsForOrder' | 'fetchCanonicalReturnsForOrder'
>;

type LocalOrder = NonNullable<Awaited<ReturnType<typeof loadLocalOrder>>>;
type LocalLine = LocalOrder['lineItems'][number];
type LocalAllocationLine = LocalLine['allocationLineItems'][number];

export type CustomerCancellationStatusRead = {
  shopifyOrderId: string;
  orderNumber: string;
  requests: Array<{
    requestId: string;
    status: CustomerCancellationStatus;
    requestedAt: Date;
    resolvedAt: Date | null;
  }>;
};

export type CustomerCancellationEligibilityLine = {
  shopifyLineItemId: string;
  title: string | null;
  variantTitle: string | null;
  imageUrl: string | null;
  quantity: number;
  requestableQuantity: number;
  eligible: boolean;
  unavailableReason: 'ALREADY_PENDING' | 'ALREADY_SHIPPED' | 'RETURN_OR_REFUND_ACTIVE' | 'NOT_FULFILLABLE' | null;
};

export type CustomerCancellationEligibility = {
  shopifyOrderId: string;
  orderNumber: string;
  canRequestCancellation: boolean;
  unavailableReason: 'ORDER_CANCELLED' | 'NO_ELIGIBLE_ITEMS' | null;
  activeRequest: { id: string; status: CustomerCancellationStatus; requestedAt: Date } | null;
  lineItems: CustomerCancellationEligibilityLine[];
};

type CreateRequestInput = {
  shopifyOrderId: string;
  items?: unknown;
  reasonCode: string;
  note?: string | null;
  idempotencyKey: string;
};

function normalizeGidTail(value: string) {
  const normalized = value.trim();
  return normalized.split('/').filter(Boolean).at(-1) ?? normalized;
}

function isActiveRequestStatus(status: CustomerCancellationStatus) {
  return (ACTIVE_CUSTOMER_CANCELLATION_REQUEST_STATUSES as readonly CustomerCancellationStatus[]).includes(status);
}

function assertCustomerCancellationIntakeEnabled(env: AppEnv) {
  if (!env.CUSTOMER_CANCELLATION_INTAKE_ENABLED) {
    throw new CustomerCancellationApiError(
      'CUSTOMER_CANCELLATION_INTAKE_DISABLED',
      503,
      'Customer cancellation intake is unavailable.',
    );
  }
}

function assertBoundedText(value: unknown, field: string, maxLength: number) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maxLength) {
    throw new CustomerCancellationApiError('INVALID_LINE_OR_QUANTITY', 400, `${field} is invalid.`);
  }
  return value.trim();
}

function hasShipmentAuthority(allocationLine: LocalAllocationLine) {
  const allocation = allocationLine.vendorAllocation;
  return Boolean(
    allocation.trackingNumber ||
      allocation.carrier ||
      allocation.vendorIntegrationTrackingUrl ||
      allocation.vendorIntegrationShippedAt ||
      allocation.vendorIntegrationShipmentEvents.length > 0 ||
      allocation.fulfillment?.shopifyFulfillmentId ||
      allocation.fulfillment?.trackingNumber ||
      allocation.fulfillment?.fulfilledAt ||
      allocation.fulfillment?.shipmentCreatedAt ||
      allocation.shipmentExecutions.some((execution) =>
        Boolean(
          execution.providerShipmentId ||
            execution.trackingNumber ||
            execution.trackingUrl ||
            execution.labelUrl ||
            ['CREATED', 'IN_TRANSIT', 'DELIVERED', 'RETURNED'].includes(execution.shipmentStatus),
        ),
      ),
  );
}

function hasCommittedShipmentIntent(allocationLine: LocalAllocationLine) {
  const allocation = allocationLine.vendorAllocation;
  return Boolean(
    allocation.fulfillment?.syncStatus === 'fulfillment_submission_pending' ||
      allocation.fulfillment?.syncStatus === 'fulfillment_sync_failed' ||
      allocation.shipmentExecutions.some((execution) => {
        const snapshot = execution.responseSnapshot;
        return Boolean(
          snapshot &&
            typeof snapshot === 'object' &&
            !Array.isArray(snapshot) &&
            typeof Reflect.get(snapshot, 'providerCallClaimedAt') === 'string',
        );
      }),
  );
}

function canonicalRefundedQuantity(
  refunds: FetchCanonicalShopifyRefundsForOrderResult,
  sourceLineItemId: string,
) {
  return (refunds?.refunds ?? []).reduce(
    (total, refund) =>
      total +
      refund.refundLineItems.reduce(
        (lineTotal, item) => lineTotal + (item.sourceLineItemId === sourceLineItemId ? item.quantity : 0),
        0,
      ),
    0,
  );
}

function hasCanonicalReturn(
  returns: FetchCanonicalShopifyReturnsForOrderResult,
  sourceLineItemId: string,
) {
  return (returns?.returns ?? []).some((entry) =>
    entry.returnLineItems.some((item) => item.sourceLineItemId === sourceLineItemId),
  );
}

function canonicalFulfillableQuantity(order: CustomerCancellationCanonicalOrderSnapshot, lineItemGid: string) {
  return order.fulfillmentOrders.reduce((total, fulfillmentOrder) => {
    if (fulfillmentOrder.status !== 'OPEN') return total;
    return total + fulfillmentOrder.lineItems.reduce(
      (lineTotal, item) => lineTotal + (item.lineItemId === lineItemGid ? Math.max(0, item.remainingQuantity ?? 0) : 0),
      0,
    );
  }, 0);
}

async function loadLocalOrder(db: CustomerCancellationDb, sourceShopifyOrderId: string) {
  return db.shopifyOrder.findUnique({
    where: { sourceShopifyOrderId },
    select: {
      id: true,
      sourceShopifyOrderId: true,
      sourceShopifyOrderNumber: true,
      customerCancellationRequests: {
        select: {
          id: true,
          status: true,
          requestedAt: true,
          shopifyCustomerId: true,
          idempotencyKey: true,
          reasonCode: true,
          customerNote: true,
          items: { select: { shopifyOrderLineItemId: true, vendorAllocationId: true, requestedQuantity: true, status: true } },
        },
        orderBy: { requestedAt: 'asc' },
      },
      lineItems: {
        select: {
          id: true,
          sourceLineItemId: true,
          title: true,
          imageUrl: true,
          quantity: true,
          allocationLineItems: {
            select: {
              quantity: true,
              vendorAllocation: {
                select: {
                  id: true,
                  allocationStatus: true,
                  cancellationReason: true,
                  reassignmentRequired: true,
                  cancelRefundReviewStatus: true,
                  trackingNumber: true,
                  carrier: true,
                  vendorIntegrationTrackingUrl: true,
                  vendorIntegrationShippedAt: true,
                  returnRecords: { select: { id: true }, take: 1 },
                  refundRecords: {
                    select: {
                      id: true,
                      lineItems: { select: { sourceLineItemId: true, quantity: true } },
                    },
                  },
                  vendorIntegrationShipmentEvents: { select: { id: true }, take: 1 },
                  fulfillment: { select: { shopifyFulfillmentId: true, trackingNumber: true, fulfilledAt: true, shipmentCreatedAt: true, syncStatus: true } },
                  shipmentExecutions: { select: { shipmentStatus: true, providerShipmentId: true, trackingNumber: true, trackingUrl: true, labelUrl: true, responseSnapshot: true } },
                  economicTransfers: { select: { status: true } },
                  financeIntegrityAlerts: {
                    where: {
                      status: { in: [...FINANCE_INTEGRITY_ALERT_BLOCKING_STATUSES] },
                      severity: { in: ['critical', 'warning'] },
                    },
                    select: { id: true },
                    take: 1,
                  },
                  financeEntries: {
                    where: { entryType: 'sale', voidedAt: null },
                    select: {
                      payoutStatus: true,
                      settlementStatus: true,
                      payoutBatchLines: { select: { payoutBatch: { select: { status: true } } } },
                      settlementApprovalLines: {
                        select: {
                          settlementApproval: {
                            select: {
                              status: true,
                              commissionInvoices: { select: { status: true } },
                            },
                          },
                        },
                      },
                    },
                  },
                  outboundShopifyRefundAttempts: {
                    where: {
                      status: {
                        in: [
                          OUTBOUND_SHOPIFY_REFUND_ATTEMPT_STATUSES.PREVIEWED,
                          OUTBOUND_SHOPIFY_REFUND_ATTEMPT_STATUSES.READY_TO_SUBMIT,
                          OUTBOUND_SHOPIFY_REFUND_ATTEMPT_STATUSES.SHOPIFY_ACTION_PENDING,
                        ],
                      },
                    },
                    select: { id: true },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
}

function requireOwnedCanonicalOrder(
  canonical: CustomerCancellationCanonicalOrderSnapshot | null,
  session: CustomerAccountSession,
) {
  if (!canonical || canonical.customerGid !== session.customerGid) {
    throw new CustomerCancellationApiError(
      'ORDER_NOT_OWNED_BY_CUSTOMER',
      403,
      'The requested order is not available for this customer.',
    );
  }
  return canonical;
}

function deriveEligibility(input: {
  canonical: CustomerCancellationCanonicalOrderSnapshot;
  local: LocalOrder;
  refunds: FetchCanonicalShopifyRefundsForOrderResult;
  returns: FetchCanonicalShopifyReturnsForOrderResult;
  customerGid: string;
}): CustomerCancellationEligibility {
  const activeRequest = input.local.customerCancellationRequests.find(
    (request) =>
      request.shopifyCustomerId === input.customerGid &&
      isActiveRequestStatus(request.status),
  ) ?? null;

  const lineItems = input.canonical.lineItems.map<CustomerCancellationEligibilityLine>((canonicalLine) => {
    const localLine = input.local.lineItems.find((line) => line.sourceLineItemId === canonicalLine.sourceLineItemId);
    const allocationLine = localLine?.allocationLineItems.length === 1 ? localLine.allocationLineItems[0] : null;
    const pending = Boolean(
      localLine &&
        input.local.customerCancellationRequests.some((request) =>
          isActiveRequestStatus(request.status) &&
          request.items.some(
            (item) =>
              item.shopifyOrderLineItemId === localLine.id &&
              isPendingCustomerCancellationHoldState({
                requestStatus: request.status,
                itemStatus: item.status,
              }),
          ),
        ),
    );
    const shipped = Boolean(allocationLine && (hasShipmentAuthority(allocationLine) || hasCommittedShipmentIntent(allocationLine)));
    const localRefundedQuantity = allocationLine?.vendorAllocation.refundRecords.reduce(
      (total, refund) => total + refund.lineItems.reduce(
        (lineTotal, item) => lineTotal + (item.sourceLineItemId === canonicalLine.sourceLineItemId ? item.quantity : 0),
        0,
      ),
      0,
    ) ?? 0;
    const canonicalRefunded = canonicalRefundedQuantity(input.refunds, canonicalLine.sourceLineItemId);
    const returnedOrRefunded = Boolean(
      allocationLine &&
        (allocationLine.vendorAllocation.returnRecords.length > 0 ||
          localRefundedQuantity > 0 ||
          canonicalRefunded > 0 ||
          hasCanonicalReturn(input.returns, canonicalLine.sourceLineItemId)),
    );
    const canonicalAvailable = Math.min(
      canonicalLine.currentQuantity ?? canonicalLine.quantity,
      canonicalLine.refundableQuantity ?? canonicalLine.quantity,
      canonicalFulfillableQuantity(input.canonical, canonicalLine.lineItemGid),
      Math.max(0, canonicalLine.quantity - canonicalRefunded),
    );
    const financeUnsafe = Boolean(
      allocationLine &&
        (allocationLine.vendorAllocation.economicTransfers.some((transfer) => transfer.status === 'COMPLETED') ||
          allocationLine.vendorAllocation.financeIntegrityAlerts.length > 0 ||
          allocationLine.vendorAllocation.financeEntries.some((entry) =>
            entry.payoutStatus !== 'PENDING' ||
            entry.settlementStatus !== 'PENDING' ||
            entry.payoutBatchLines.some((line) => line.payoutBatch.status.toLowerCase() !== 'cancelled') ||
            entry.settlementApprovalLines.some((line) => {
              const status = line.settlementApproval.status.toLowerCase();
              return status !== 'cancelled' ||
                line.settlementApproval.commissionInvoices.some((invoice) => invoice.status.toLowerCase() !== 'cancelled');
            }),
          ) ||
          allocationLine.vendorAllocation.outboundShopifyRefundAttempts.length > 0),
    );
    const fulfillmentOwners = input.canonical.fulfillmentOrders.filter((fulfillmentOrder) =>
      fulfillmentOrder.lineItems.some((item) =>
        item.lineItemId && normalizeGidTail(item.lineItemId) === normalizeGidTail(canonicalLine.lineItemGid),
      ),
    );
    const fulfillmentOwner = fulfillmentOwners.length === 1 ? fulfillmentOwners[0] : null;
    const fulfillmentLine = fulfillmentOwner?.lineItems.find((item) =>
      item.lineItemId && normalizeGidTail(item.lineItemId) === normalizeGidTail(canonicalLine.lineItemGid),
    );
    const structurallyEligible = Boolean(
      allocationLine &&
        allocationLine.vendorAllocation.allocationStatus === 'ACTIVE' &&
        !allocationLine.vendorAllocation.cancellationReason &&
        !allocationLine.vendorAllocation.reassignmentRequired &&
        !allocationLine.vendorAllocation.cancelRefundReviewStatus &&
        localLine?.quantity === canonicalLine.quantity &&
        allocationLine.quantity === canonicalLine.quantity &&
        canonicalLine.currentQuantity === canonicalLine.quantity &&
        canonicalLine.refundableQuantity === canonicalLine.quantity &&
        fulfillmentOwner?.status === 'OPEN' &&
        fulfillmentOwner.requestStatus === 'UNSUBMITTED' &&
        fulfillmentLine?.remainingQuantity === canonicalLine.quantity &&
        fulfillmentLine.totalQuantity === canonicalLine.quantity &&
        !financeUnsafe,
    );
    const requestableQuantity = structurallyEligible && !pending && !shipped && !returnedOrRefunded
      ? Math.max(0, Math.min(allocationLine?.quantity ?? 0, canonicalAvailable))
      : 0;
    const unavailableReason = pending
      ? 'ALREADY_PENDING'
      : shipped
        ? 'ALREADY_SHIPPED'
        : returnedOrRefunded
          ? 'RETURN_OR_REFUND_ACTIVE'
          : requestableQuantity <= 0
            ? 'NOT_FULFILLABLE'
            : null;

    return {
      shopifyLineItemId: canonicalLine.lineItemGid,
      title: canonicalLine.title ?? localLine?.title ?? null,
      variantTitle: canonicalLine.variantTitle,
      imageUrl: canonicalLine.imageUrl ?? localLine?.imageUrl ?? null,
      quantity: canonicalLine.quantity,
      requestableQuantity,
      eligible: requestableQuantity > 0,
      unavailableReason,
    };
  });

  const canonicalEvidenceComplete = Boolean(
    input.refunds &&
      input.refunds.refundsListComplete &&
      input.refunds.refunds.every((refund) => refund.lineItemPaginationComplete && refund.transactionPaginationComplete) &&
      input.returns,
  );
  const completeOrderEligible = canonicalEvidenceComplete && lineItems.length > 0 &&
    lineItems.every((line) => line.eligible && line.requestableQuantity === line.quantity);

  return {
    shopifyOrderId: input.canonical.orderGid,
    orderNumber: input.canonical.sourceShopifyOrderNumber,
    canRequestCancellation: !input.canonical.cancelledAt && completeOrderEligible,
    unavailableReason: input.canonical.cancelledAt
      ? 'ORDER_CANCELLED'
      : completeOrderEligible
        ? null
        : 'NO_ELIGIBLE_ITEMS',
    activeRequest: activeRequest ? { id: activeRequest.id, status: activeRequest.status, requestedAt: activeRequest.requestedAt } : null,
    lineItems,
  };
}

export function createCustomerCancellationApiService(
  env: AppEnv,
  dependencies: {
    db?: CustomerCancellationDb;
    shopify?: ShopifyReadService;
    createRequest?: (input: CreateVerifiedCustomerCancellationRequestInput) => ReturnType<typeof createPendingCustomerCancellationRequest>;
  } = {},
) {
  const db = dependencies.db ?? prisma;
  const shopify = dependencies.shopify ?? createShopifyAdminService(env);
  const createRequest = dependencies.createRequest ?? createPendingCustomerCancellationRequest;

  async function getEligibility(session: CustomerAccountSession, rawOrderId: string) {
    assertCustomerCancellationIntakeEnabled(env);
    const orderId = assertBoundedText(rawOrderId, 'shopifyOrderId', 200);
    let canonical: CustomerCancellationCanonicalOrderSnapshot | null;
    let refunds: FetchCanonicalShopifyRefundsForOrderResult;
    let returns: FetchCanonicalShopifyReturnsForOrderResult;
    try {
      [canonical, refunds, returns] = await Promise.all([
        shopify.fetchCustomerCancellationOrderSnapshot(orderId),
        shopify.fetchCanonicalRefundsForOrder(orderId),
        shopify.fetchCanonicalReturnsForOrder(orderId),
      ]);
    } catch {
      throw new CustomerCancellationApiError(
        'SHOPIFY_CANONICAL_STATE_UNAVAILABLE',
        503,
        'Canonical order state is temporarily unavailable.',
      );
    }
    const ownedCanonical = requireOwnedCanonicalOrder(canonical, session);
    const local = await loadLocalOrder(db, ownedCanonical.sourceShopifyOrderId);
    if (!local) {
      throw new CustomerCancellationApiError('CANCELLATION_CONFLICT', 409, 'Order state is not ready for cancellation.');
    }
    return deriveEligibility({ canonical: ownedCanonical, local, refunds, returns, customerGid: session.customerGid });
  }

  async function createCancellationRequest(session: CustomerAccountSession, rawInput: CreateRequestInput) {
    assertCustomerCancellationIntakeEnabled(env);
    const shopifyOrderId = assertBoundedText(rawInput.shopifyOrderId, 'shopifyOrderId', 200);
    const reasonCode = assertBoundedText(rawInput.reasonCode, 'reasonCode', 80);
    const idempotencyKey = assertBoundedText(rawInput.idempotencyKey, 'idempotencyKey', 200);
    const note = rawInput.note == null ? null : rawInput.note.trim();
    if (note && note.length > 1000) {
      throw new CustomerCancellationApiError('INVALID_LINE_OR_QUANTITY', 400, 'note is invalid.');
    }
    if (rawInput.items !== undefined) {
      throw new CustomerCancellationApiError('INVALID_LINE_OR_QUANTITY', 400, 'Customer-selected items are not supported.');
    }
    const eligibility = await getEligibility(session, shopifyOrderId);
    const canonicalSourceId = normalizeGidTail(eligibility.shopifyOrderId);
    const local = await loadLocalOrder(db, canonicalSourceId);
    if (!local) {
      throw new CustomerCancellationApiError('CANCELLATION_CONFLICT', 409, 'Order state is not ready for cancellation.');
    }
    const existingByIdempotency = local.customerCancellationRequests.find(
      (request) =>
        request.shopifyCustomerId === session.customerGid && request.idempotencyKey === idempotencyKey,
    );
    if (existingByIdempotency) {
      const expectedItems = local.lineItems.map((localLine) => {
        const allocationLine = localLine.allocationLineItems.length === 1 ? localLine.allocationLineItems[0] : null;
        return `${localLine.id}:${allocationLine?.vendorAllocation.id ?? ''}:${localLine.quantity}`;
      }).sort();
      const actualItems = existingByIdempotency.items
        .map((item) => `${item.shopifyOrderLineItemId}:${item.vendorAllocationId}:${item.requestedQuantity}`)
        .sort();
      if (
        existingByIdempotency.reasonCode !== reasonCode ||
        (existingByIdempotency.customerNote ?? null) !== note ||
        JSON.stringify(expectedItems) !== JSON.stringify(actualItems)
      ) {
        throw new CustomerCancellationApiError('IDEMPOTENCY_CONFLICT', 409, 'Idempotency key is already in use.');
      }
      return {
        requestId: existingByIdempotency.id,
        status: existingByIdempotency.status,
        requestedAt: existingByIdempotency.requestedAt,
        idempotent: true,
        itemCount: existingByIdempotency.items.length,
      };
    }
    if (!eligibility.canRequestCancellation) {
      if (eligibility.activeRequest) {
        throw new CustomerCancellationApiError(
          'CANCELLATION_ALREADY_PENDING',
          409,
          'A cancellation request is already pending.',
        );
      }
      if (eligibility.lineItems.some((line) => line.unavailableReason === 'ALREADY_SHIPPED')) {
        throw new CustomerCancellationApiError('CANCELLATION_TOO_LATE', 409, 'Shipment has already started.');
      }
      throw new CustomerCancellationApiError(
        'CANCELLATION_CONFLICT',
        409,
        eligibility.unavailableReason === 'ORDER_CANCELLED'
          ? 'The order is already cancelled.'
          : 'The complete order is not eligible for cancellation.',
      );
    }
    const verifiedItems = eligibility.lineItems.map((eligible) => {
      const requestedId = eligible.shopifyLineItemId;
      const localLine = local.lineItems.find(
        (line) => normalizeGidTail(line.sourceLineItemId) === normalizeGidTail(requestedId),
      );
      const allocationLine = localLine?.allocationLineItems.length === 1 ? localLine.allocationLineItems[0] : null;
      if (!localLine || !allocationLine) {
        throw new CustomerCancellationApiError('CANCELLATION_CONFLICT', 409, 'Allocation mapping is ambiguous.');
      }
      return {
        shopifyOrderLineItemId: localLine.id,
        vendorAllocationId: allocationLine.vendorAllocation.id,
        requestedQuantity: eligible.quantity,
        responseLineItemId: eligible.shopifyLineItemId,
      };
    });
    let result;
    try {
      result = await createRequest({
        shopifyOrderId: local.id,
        shopDomain: session.shopDomain,
        shopifyCustomerId: session.customerGid,
        reasonCode,
        customerNote: note,
        idempotencyKey,
        items: verifiedItems.map(({ responseLineItemId: _responseLineItemId, ...item }) => item),
      });
    } catch (error) {
      if (error instanceof CustomerCancellationRequestConflictError) {
        throw new CustomerCancellationApiError('CUSTOMER_CANCELLATION_PENDING', 409, 'A cancellation request already affects this allocation.');
      }
      if (error instanceof CustomerCancellationRequestValidationError) {
        throw new CustomerCancellationApiError('CANCELLATION_CONFLICT', 409, 'Order state changed before the request completed.');
      }
      throw error;
    }

    const expectedItems = verifiedItems.map((item) => `${item.shopifyOrderLineItemId}:${item.vendorAllocationId}:${item.requestedQuantity}`).sort();
    const actualItems = result.request.items.map((item) => `${item.shopifyOrderLineItemId}:${item.vendorAllocationId}:${item.requestedQuantity}`).sort();
    if (
      result.request.shopifyOrderId !== local.id ||
      result.request.reasonCode !== reasonCode ||
      (result.request.customerNote ?? null) !== note ||
      JSON.stringify(expectedItems) !== JSON.stringify(actualItems)
    ) {
      throw new CustomerCancellationApiError('IDEMPOTENCY_CONFLICT', 409, 'Idempotency key is already in use.');
    }
    if (result.request.status === CustomerCancellationStatus.TOO_LATE) {
      throw new CustomerCancellationApiError('CANCELLATION_TOO_LATE', 409, 'Shipment has already started.');
    }
    if (result.request.status !== CustomerCancellationStatus.PENDING) {
      throw new CustomerCancellationApiError('CANCELLATION_CONFLICT', 409, 'Cancellation request conflicted with shipment state.');
    }

    return {
      requestId: result.request.id,
      status: result.request.status,
      requestedAt: result.request.requestedAt,
      idempotent: result.idempotent,
      itemCount: result.request.items.length,
    };
  }

  async function getStatus(
    session: CustomerAccountSession,
    rawOrderId: string,
  ): Promise<CustomerCancellationStatusRead> {
    const orderId = assertBoundedText(rawOrderId, 'shopifyOrderId', 200);
    let canonical: CustomerCancellationCanonicalOrderSnapshot | null;
    try {
      canonical = await shopify.fetchCustomerCancellationOrderSnapshot(orderId);
    } catch {
      throw new CustomerCancellationApiError(
        'SHOPIFY_CANONICAL_STATE_UNAVAILABLE',
        503,
        'Canonical order state is temporarily unavailable.',
      );
    }
    const ownedCanonical = requireOwnedCanonicalOrder(canonical, session);
    const local = await db.shopifyOrder.findUnique({
      where: { sourceShopifyOrderId: ownedCanonical.sourceShopifyOrderId },
      select: {
        customerCancellationRequests: {
          where: { shopifyCustomerId: session.customerGid },
          orderBy: { requestedAt: 'asc' },
          select: {
            id: true,
            status: true,
            requestedAt: true,
            resolvedAt: true,
          },
        },
      },
    });
    if (!local) {
      throw new CustomerCancellationApiError('CANCELLATION_CONFLICT', 409, 'Order state is not ready for cancellation.');
    }

    return {
      shopifyOrderId: ownedCanonical.orderGid,
      orderNumber: ownedCanonical.sourceShopifyOrderNumber,
      requests: local.customerCancellationRequests.map((request) => ({
        requestId: request.id,
        status: request.status,
        requestedAt: request.requestedAt,
        resolvedAt: request.resolvedAt,
      })),
    };
  }

  return { getEligibility, createCancellationRequest, getStatus };
}
