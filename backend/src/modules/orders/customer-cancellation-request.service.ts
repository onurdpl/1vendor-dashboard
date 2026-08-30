import { CustomerCancellationStatus, Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { acquireShopifyOrderTransactionLock } from '../shopify/orders-create-ownership.service.js';
import {
  ACTIVE_CUSTOMER_CANCELLATION_REQUEST_STATUSES,
  CUSTOMER_CANCELLATION_PENDING_ITEM_STATUS,
} from './customer-cancellation-hold.service.js';

const requestWithItems = Prisma.validator<Prisma.CustomerCancellationRequestDefaultArgs>()({
  include: {
    items: true,
  },
});

export type CustomerCancellationRequestWithItems = Prisma.CustomerCancellationRequestGetPayload<
  typeof requestWithItems
>;

export type VerifiedCustomerCancellationRequestItemInput = {
  shopifyOrderLineItemId: string;
  vendorAllocationId: string;
  requestedQuantity: number;
};

export type CreateVerifiedCustomerCancellationRequestInput = {
  shopifyOrderId: string;
  shopDomain: string;
  shopifyCustomerId: string;
  reasonCode: string;
  customerNote?: string | null;
  idempotencyKey: string;
  items: VerifiedCustomerCancellationRequestItemInput[];
};

export type CreateCustomerCancellationRequestResult = {
  request: CustomerCancellationRequestWithItems;
  idempotent: boolean;
};

export class CustomerCancellationRequestValidationError extends Error {}
export class CustomerCancellationRequestConflictError extends Error {}

function normalizeRequiredText(value: string, field: string) {
  const normalized = value.trim();
  if (!normalized) {
    throw new CustomerCancellationRequestValidationError(`${field} is required.`);
  }
  return normalized;
}

function normalizeOptionalText(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized || null;
}

function normalizeInput(input: CreateVerifiedCustomerCancellationRequestInput) {
  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new CustomerCancellationRequestValidationError('At least one cancellation request item is required.');
  }

  const itemKeys = new Set<string>();
  const items = input.items.map((item) => {
    const shopifyOrderLineItemId = normalizeRequiredText(
      item.shopifyOrderLineItemId,
      'shopifyOrderLineItemId',
    );
    const vendorAllocationId = normalizeRequiredText(item.vendorAllocationId, 'vendorAllocationId');
    if (!Number.isSafeInteger(item.requestedQuantity) || item.requestedQuantity <= 0) {
      throw new CustomerCancellationRequestValidationError('requestedQuantity must be a positive integer.');
    }

    const itemKey = `${shopifyOrderLineItemId}:${vendorAllocationId}`;
    if (itemKeys.has(itemKey)) {
      throw new CustomerCancellationRequestValidationError(
        'Cancellation request items must be unique by Shopify line item and allocation.',
      );
    }
    itemKeys.add(itemKey);

    return {
      shopifyOrderLineItemId,
      vendorAllocationId,
      requestedQuantity: item.requestedQuantity,
    };
  });

  return {
    shopifyOrderId: normalizeRequiredText(input.shopifyOrderId, 'shopifyOrderId'),
    shopDomain: normalizeRequiredText(input.shopDomain, 'shopDomain').toLowerCase(),
    shopifyCustomerId: normalizeRequiredText(input.shopifyCustomerId, 'shopifyCustomerId'),
    reasonCode: normalizeRequiredText(input.reasonCode, 'reasonCode'),
    customerNote: normalizeOptionalText(input.customerNote),
    idempotencyKey: normalizeRequiredText(input.idempotencyKey, 'idempotencyKey'),
    items,
  };
}

function isUniqueConstraintError(error: unknown) {
  return (
    (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') ||
    (error !== null && typeof error === 'object' && Reflect.get(error, 'code') === 'P2002')
  );
}

function hasClaimedProviderCall(snapshot: Prisma.JsonValue | null) {
  return Boolean(
    snapshot &&
      typeof snapshot === 'object' &&
      !Array.isArray(snapshot) &&
      typeof snapshot.providerCallClaimedAt === 'string',
  );
}

function classifyExistingShipmentAuthority(allocation: {
  id: string;
  trackingNumber: string | null;
  carrier: string | null;
  vendorIntegrationTrackingUrl: string | null;
  vendorIntegrationShippedAt: Date | null;
  fulfillment: {
    shopifyFulfillmentId: string | null;
    trackingNumber: string | null;
    fulfilledAt: Date | null;
    shipmentCreatedAt: Date | null;
    syncStatus: string | null;
  } | null;
  shipmentExecutions: Array<{
    shipmentStatus: string;
    providerShipmentId: string | null;
    trackingNumber: string | null;
    trackingUrl: string | null;
    labelUrl: string | null;
    responseSnapshot: Prisma.JsonValue | null;
  }>;
  vendorIntegrationShipmentEvents: Array<{ id: string }>;
}) {
  const hasExistingShipmentTruth = Boolean(
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
  if (hasExistingShipmentTruth) {
    return CustomerCancellationStatus.TOO_LATE;
  }

  const hasCommittedShipmentIntent = Boolean(
    allocation.fulfillment?.syncStatus === 'fulfillment_submission_pending' ||
      allocation.fulfillment?.syncStatus === 'fulfillment_sync_failed' ||
      allocation.shipmentExecutions.some((execution) => hasClaimedProviderCall(execution.responseSnapshot)),
  );

  return hasCommittedShipmentIntent
    ? CustomerCancellationStatus.CONFLICTED
    : CustomerCancellationStatus.PENDING;
}

function idempotencyWhere(input: {
  shopDomain: string;
  shopifyCustomerId: string;
  idempotencyKey: string;
}) {
  return {
    shopDomain_shopifyCustomerId_idempotencyKey: {
      shopDomain: input.shopDomain,
      shopifyCustomerId: input.shopifyCustomerId,
      idempotencyKey: input.idempotencyKey,
    },
  };
}

async function findIdempotentRequest(
  db: Pick<Prisma.TransactionClient, 'customerCancellationRequest'>,
  input: { shopDomain: string; shopifyCustomerId: string; idempotencyKey: string },
) {
  return db.customerCancellationRequest.findUnique({
    where: idempotencyWhere(input),
    ...requestWithItems,
  });
}
async function createPendingCustomerCancellationRequestInTransaction(
  tx: Prisma.TransactionClient,
  input: ReturnType<typeof normalizeInput>,
): Promise<CreateCustomerCancellationRequestResult> {
  const order = await tx.shopifyOrder.findUnique({
    where: {
      id: input.shopifyOrderId,
    },
    select: {
      id: true,
      sourceShopifyOrderId: true,
    },
  });
  if (!order) {
    throw new CustomerCancellationRequestValidationError('Shopify order was not found.');
  }

  await acquireShopifyOrderTransactionLock(tx, order.sourceShopifyOrderId);

  const existingRequest = await findIdempotentRequest(tx, input);
  if (existingRequest) {
    return {
      request: existingRequest,
      idempotent: true,
    };
  }

  for (const item of input.items) {
    const allocationLineItem = await tx.vendorAllocationLineItem.findFirst({
      where: {
        vendorAllocationId: item.vendorAllocationId,
        shopifyLineItemId: item.shopifyOrderLineItemId,
        vendorAllocation: {
          sourceShopifyOrderId: order.id,
        },
        shopifyOrderLineItem: {
          shopifyOrderId: order.id,
        },
      },
      select: {
        quantity: true,
      },
    });
    if (!allocationLineItem) {
      throw new CustomerCancellationRequestValidationError(
        'Cancellation request item does not belong to the verified Shopify order allocation.',
      );
    }
    if (item.requestedQuantity > allocationLineItem.quantity) {
      throw new CustomerCancellationRequestValidationError(
        'requestedQuantity exceeds the verified allocation line-item quantity.',
      );
    }
  }

  const affectedAllocations = await tx.vendorAllocation.findMany({
    where: {
      id: {
        in: [...new Set(input.items.map((item) => item.vendorAllocationId))],
      },
      sourceShopifyOrderId: order.id,
    },
    select: {
      id: true,
      trackingNumber: true,
      carrier: true,
      vendorIntegrationTrackingUrl: true,
      vendorIntegrationShippedAt: true,
      fulfillment: {
        select: {
          shopifyFulfillmentId: true,
          trackingNumber: true,
          fulfilledAt: true,
          shipmentCreatedAt: true,
          syncStatus: true,
        },
      },
      shipmentExecutions: {
        select: {
          shipmentStatus: true,
          providerShipmentId: true,
          trackingNumber: true,
          trackingUrl: true,
          labelUrl: true,
          responseSnapshot: true,
        },
      },
      vendorIntegrationShipmentEvents: {
        select: {
          id: true,
        },
        take: 1,
      },
    },
  });
  const statusByAllocationId = new Map(
    affectedAllocations.map((allocation) => [allocation.id, classifyExistingShipmentAuthority(allocation)]),
  );
  const itemStatuses = input.items.map((item) =>
    statusByAllocationId.get(item.vendorAllocationId) ?? CustomerCancellationStatus.CONFLICTED,
  );
  const uniqueItemStatuses = new Set(itemStatuses);
  const initialStatus = uniqueItemStatuses.size === 1
    ? itemStatuses[0] ?? CustomerCancellationStatus.CONFLICTED
    : CustomerCancellationStatus.PARTIALLY_RESOLVED;

  const existingPendingItem = await tx.customerCancellationRequestItem.findFirst({
    where: {
      vendorAllocationId: {
        in: [...new Set(input.items.map((item) => item.vendorAllocationId))],
      },
      status: CUSTOMER_CANCELLATION_PENDING_ITEM_STATUS,
      request: {
        status: {
          in: [...ACTIVE_CUSTOMER_CANCELLATION_REQUEST_STATUSES],
        },
      },
    },
    select: {
      id: true,
    },
  });
  if (existingPendingItem) {
    throw new CustomerCancellationRequestConflictError(
      'An unresolved customer cancellation request already affects this allocation.',
    );
  }

  const request = await tx.customerCancellationRequest.create({
    data: {
      shopifyOrderId: order.id,
      shopDomain: input.shopDomain,
      shopifyCustomerId: input.shopifyCustomerId,
      status: initialStatus,
      reasonCode: input.reasonCode,
      customerNote: input.customerNote,
      idempotencyKey: input.idempotencyKey,
      items: {
        create: input.items.map((item, index) => ({
          shopifyOrderLineItemId: item.shopifyOrderLineItemId,
          vendorAllocationId: item.vendorAllocationId,
          requestedQuantity: item.requestedQuantity,
          status: itemStatuses[index] ?? CustomerCancellationStatus.CONFLICTED,
        })),
      },
    },
    ...requestWithItems,
  });

  return {
    request,
    idempotent: false,
  };
}

export async function createPendingCustomerCancellationRequest(
  rawInput: CreateVerifiedCustomerCancellationRequestInput,
): Promise<CreateCustomerCancellationRequestResult> {
  const input = normalizeInput(rawInput);

  try {
    return await prisma.$transaction((tx) => createPendingCustomerCancellationRequestInTransaction(tx, input));
  } catch (error) {
    if (!isUniqueConstraintError(error)) {
      throw error;
    }

    const existingRequest = await findIdempotentRequest(prisma, input);
    if (!existingRequest) {
      throw error;
    }
    return {
      request: existingRequest,
      idempotent: true,
    };
  }
}

export async function loadActiveCustomerCancellationRequestsForOrder(shopifyOrderId: string) {
  const normalizedOrderId = normalizeRequiredText(shopifyOrderId, 'shopifyOrderId');
  return prisma.customerCancellationRequest.findMany({
    where: {
      shopifyOrderId: normalizedOrderId,
      status: {
        in: [...ACTIVE_CUSTOMER_CANCELLATION_REQUEST_STATUSES],
      },
    },
    orderBy: [
      { requestedAt: 'asc' },
      { id: 'asc' },
    ],
    ...requestWithItems,
  });
}

export async function loadPendingCustomerCancellationItemsForAllocation(vendorAllocationId: string) {
  const normalizedAllocationId = normalizeRequiredText(vendorAllocationId, 'vendorAllocationId');
  return prisma.customerCancellationRequestItem.findMany({
    where: {
      vendorAllocationId: normalizedAllocationId,
      status: CUSTOMER_CANCELLATION_PENDING_ITEM_STATUS,
      request: {
        status: {
          in: [...ACTIVE_CUSTOMER_CANCELLATION_REQUEST_STATUSES],
        },
      },
    },
    include: {
      request: true,
    },
    orderBy: [
      { createdAt: 'asc' },
      { id: 'asc' },
    ],
  });
}
