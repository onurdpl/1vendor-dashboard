import type { Prisma } from '@prisma/client';
import {
  ALLOCATION_ACTIONABILITY_REASONS,
  evaluateAllocationActionability,
} from './allocation-actionability-policy.service.js';
import { acquireShopifyOrderTransactionLock } from '../shopify/orders-create-ownership.service.js';

export const ALLOCATION_ACTIONABILITY_GUARD_ERROR_CODES = {
  notFound: 'ALLOCATION_NOT_FOUND',
  canonicalOrderIdentityMissing: 'ALLOCATION_CANONICAL_ORDER_IDENTITY_MISSING',
  refundTerminal: ALLOCATION_ACTIONABILITY_REASONS.refundTerminal,
} as const;

export type AllocationActionabilityGuardErrorCode =
  (typeof ALLOCATION_ACTIONABILITY_GUARD_ERROR_CODES)[keyof typeof ALLOCATION_ACTIONABILITY_GUARD_ERROR_CODES];

export class AllocationActionabilityGuardError extends Error {
  constructor(public readonly code: AllocationActionabilityGuardErrorCode) {
    super(
      code === ALLOCATION_ACTIONABILITY_GUARD_ERROR_CODES.refundTerminal
        ? 'Allocation is operationally closed by a verified full refund.'
        : code === ALLOCATION_ACTIONABILITY_GUARD_ERROR_CODES.notFound
          ? 'Allocation was not found.'
          : 'Allocation canonical Shopify order identity is unavailable.',
    );
    this.name = 'AllocationActionabilityGuardError';
  }
}

type ActionabilityGuardTransaction = Pick<Prisma.TransactionClient, 'vendorAllocation'>;
type AcquireOrderLock = typeof acquireShopifyOrderTransactionLock;

function normalizeRequired(value: string | null | undefined) {
  const normalized = value?.trim() ?? '';
  return normalized || null;
}

export async function assertAllocationActionable(
  tx: ActionabilityGuardTransaction,
  vendorAllocationId: string,
  dependencies: { acquireOrderLock?: AcquireOrderLock } = {},
) {
  const allocationId = normalizeRequired(vendorAllocationId);
  if (!allocationId) {
    throw new AllocationActionabilityGuardError(ALLOCATION_ACTIONABILITY_GUARD_ERROR_CODES.notFound);
  }

  const initial = await tx.vendorAllocation.findUnique({
    where: { id: allocationId },
    select: {
      id: true,
      sourceShopifyOrderId: true,
      order: {
        select: {
          id: true,
          sourceShopifyOrderId: true,
        },
      },
    },
  });
  if (!initial) {
    throw new AllocationActionabilityGuardError(ALLOCATION_ACTIONABILITY_GUARD_ERROR_CODES.notFound);
  }

  const canonicalShopifyOrderId = normalizeRequired(initial.order.sourceShopifyOrderId);
  if (!canonicalShopifyOrderId) {
    throw new AllocationActionabilityGuardError(
      ALLOCATION_ACTIONABILITY_GUARD_ERROR_CODES.canonicalOrderIdentityMissing,
    );
  }

  await (dependencies.acquireOrderLock ?? acquireShopifyOrderTransactionLock)(
    tx as Prisma.TransactionClient,
    canonicalShopifyOrderId,
  );

  const current = await tx.vendorAllocation.findUnique({
    where: { id: allocationId },
    select: {
      id: true,
      sourceShopifyOrderId: true,
      allocationStatus: true,
      fulfillmentStatus: true,
      shippingStatus: true,
      reassignmentRequired: true,
      carrier: true,
      trackingNumber: true,
      order: {
        select: {
          id: true,
          sourceShopifyOrderId: true,
        },
      },
      fullRefundTerminalFact: {
        select: { id: true },
      },
    },
  });
  if (!current) {
    throw new AllocationActionabilityGuardError(ALLOCATION_ACTIONABILITY_GUARD_ERROR_CODES.notFound);
  }
  if (normalizeRequired(current.order.sourceShopifyOrderId) !== canonicalShopifyOrderId) {
    throw new AllocationActionabilityGuardError(
      ALLOCATION_ACTIONABILITY_GUARD_ERROR_CODES.canonicalOrderIdentityMissing,
    );
  }

  const decision = evaluateAllocationActionability({
    fullRefundTerminalFactPresent: Boolean(current.fullRefundTerminalFact),
  });
  if (!decision.actionable) {
    throw new AllocationActionabilityGuardError(decision.reason);
  }

  return {
    allocation: current,
    sourceShopifyOrderId: canonicalShopifyOrderId,
    decision,
  };
}
