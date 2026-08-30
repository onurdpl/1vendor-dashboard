import { CustomerCancellationStatus, type Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import type { CustomerAccountSession } from './customer-cancellation-session-token.service.js';
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

export type CustomerCancellationApiErrorCode =
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
  items: Array<{ shopifyLineItemId: string; requestedQuantity: number }>;
  reasonCode: string;
  note?: string | null;
  idempotencyKey: string;
};

function normalizeGidTail(value: string) {
  const normalized = value.trim();
  return normalized.split('/').filter(Boolean).at(-1) ?? normalized;
}

function isActiveRequestStatus(status: CustomerCancellationStatus) {
  return (
    [
      CustomerCancellationStatus.PENDING,
      CustomerCancellationStatus.PARTIALLY_RESOLVED,
    ] as CustomerCancellationStatus[]
  ).includes(status);
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
                  trackingNumber: true,
                  carrier: true,
                  vendorIntegrationTrackingUrl: true,
                  vendorIntegrationShippedAt: true,
                  returnRecords: { select: { id: true }, take: 1 },
                  refundRecords: { select: { id: true }, take: 1 },
                  vendorIntegrationShipmentEvents: { select: { id: true }, take: 1 },
                  fulfillment: { select: { shopifyFulfillmentId: true, trackingNumber: true, fulfilledAt: true, shipmentCreatedAt: true, syncStatus: true } },
                  shipmentExecutions: { select: { shipmentStatus: true, providerShipmentId: true, trackingNumber: true, trackingUrl: true, labelUrl: true, responseSnapshot: true } },
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
              item.shopifyOrderLineItemId === localLine.id && item.status === CustomerCancellationStatus.PENDING,
          ),
        ),
    );
    const shipped = Boolean(allocationLine && (hasShipmentAuthority(allocationLine) || hasCommittedShipmentIntent(allocationLine)));
    const returnedOrRefunded = Boolean(
      allocationLine &&
        (allocationLine.vendorAllocation.returnRecords.length > 0 ||
          allocationLine.vendorAllocation.refundRecords.length > 0 ||
          hasCanonicalReturn(input.returns, canonicalLine.sourceLineItemId)),
    );
    const canonicalAvailable = Math.min(
      canonicalLine.currentQuantity ?? canonicalLine.quantity,
      canonicalLine.refundableQuantity ?? canonicalLine.quantity,
      canonicalFulfillableQuantity(input.canonical, canonicalLine.lineItemGid),
      Math.max(0, canonicalLine.quantity - canonicalRefundedQuantity(input.refunds, canonicalLine.sourceLineItemId)),
    );
    const structurallyEligible = Boolean(
      allocationLine &&
        allocationLine.vendorAllocation.allocationStatus === 'ACTIVE' &&
        !allocationLine.vendorAllocation.cancellationReason,
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

  return {
    shopifyOrderId: input.canonical.orderGid,
    orderNumber: input.canonical.sourceShopifyOrderNumber,
    canRequestCancellation: !input.canonical.cancelledAt && lineItems.some((line) => line.eligible),
    unavailableReason: input.canonical.cancelledAt ? 'ORDER_CANCELLED' : lineItems.some((line) => line.eligible) ? null : 'NO_ELIGIBLE_ITEMS',
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
    const shopifyOrderId = assertBoundedText(rawInput.shopifyOrderId, 'shopifyOrderId', 200);
    const reasonCode = assertBoundedText(rawInput.reasonCode, 'reasonCode', 80);
    const idempotencyKey = assertBoundedText(rawInput.idempotencyKey, 'idempotencyKey', 200);
    const note = rawInput.note == null ? null : rawInput.note.trim();
    if (note && note.length > 1000) {
      throw new CustomerCancellationApiError('INVALID_LINE_OR_QUANTITY', 400, 'note is invalid.');
    }
    if (!Array.isArray(rawInput.items) || rawInput.items.length === 0 || rawInput.items.length > 50) {
      throw new CustomerCancellationApiError('INVALID_LINE_OR_QUANTITY', 400, 'items are invalid.');
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
      const expectedItems = rawInput.items.map((item) => {
        const localLine = local.lineItems.find(
          (line) => normalizeGidTail(line.sourceLineItemId) === normalizeGidTail(String(item.shopifyLineItemId ?? '')),
        );
        const allocationLine = localLine?.allocationLineItems.length === 1 ? localLine.allocationLineItems[0] : null;
        return `${localLine?.id ?? ''}:${allocationLine?.vendorAllocation.id ?? ''}:${item.requestedQuantity}`;
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
      const responseLineByLocalLine = new Map(
        local.lineItems.map((line) => [line.id, `gid://shopify/LineItem/${line.sourceLineItemId}`]),
      );
      return {
        requestId: existingByIdempotency.id,
        status: existingByIdempotency.status,
        requestedAt: existingByIdempotency.requestedAt,
        idempotent: true,
        items: existingByIdempotency.items.map((item) => ({
          shopifyLineItemId: responseLineByLocalLine.get(item.shopifyOrderLineItemId) ?? null,
          requestedQuantity: item.requestedQuantity,
          status: item.status,
        })),
      };
    }
    if (eligibility.unavailableReason === 'ORDER_CANCELLED') {
      throw new CustomerCancellationApiError(
        'CANCELLATION_CONFLICT',
        409,
        'The order is already cancelled.',
      );
    }
    const verifiedItems = rawInput.items.map((requested) => {
      const requestedId = assertBoundedText(requested.shopifyLineItemId, 'shopifyLineItemId', 200);
      if (!Number.isSafeInteger(requested.requestedQuantity) || requested.requestedQuantity <= 0) {
        throw new CustomerCancellationApiError('INVALID_LINE_OR_QUANTITY', 400, 'requestedQuantity is invalid.');
      }
      const eligible = eligibility.lineItems.find(
        (line) => line.shopifyLineItemId === requestedId || normalizeGidTail(line.shopifyLineItemId) === normalizeGidTail(requestedId),
      );
      if (!eligible) {
        throw new CustomerCancellationApiError('INVALID_LINE_OR_QUANTITY', 400, 'Requested line item is invalid.');
      }
      if (eligible.unavailableReason === 'ALREADY_PENDING') {
        throw new CustomerCancellationApiError('CANCELLATION_ALREADY_PENDING', 409, 'A cancellation request is already pending.');
      }
      if (eligible.unavailableReason === 'ALREADY_SHIPPED') {
        throw new CustomerCancellationApiError('CANCELLATION_TOO_LATE', 409, 'Shipment has already started.');
      }
      if (!eligible.eligible || requested.requestedQuantity > eligible.requestableQuantity) {
        throw new CustomerCancellationApiError('INVALID_LINE_OR_QUANTITY', 400, 'Requested quantity is unavailable.');
      }
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
        requestedQuantity: requested.requestedQuantity,
        responseLineItemId: eligible.shopifyLineItemId,
      };
    });
    if (new Set(verifiedItems.map((item) => `${item.shopifyOrderLineItemId}:${item.vendorAllocationId}`)).size !== verifiedItems.length) {
      throw new CustomerCancellationApiError('INVALID_LINE_OR_QUANTITY', 400, 'Cancellation items must be unique.');
    }

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

    const responseIdByLocalLine = new Map(verifiedItems.map((item) => [item.shopifyOrderLineItemId, item.responseLineItemId]));
    return {
      requestId: result.request.id,
      status: result.request.status,
      requestedAt: result.request.requestedAt,
      idempotent: result.idempotent,
      items: result.request.items.map((item) => ({
        shopifyLineItemId: responseIdByLocalLine.get(item.shopifyOrderLineItemId) ?? null,
        requestedQuantity: item.requestedQuantity,
        status: item.status,
      })),
    };
  }

  return { getEligibility, createCancellationRequest };
}
