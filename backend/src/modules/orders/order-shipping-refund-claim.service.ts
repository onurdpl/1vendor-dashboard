import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { OUTBOUND_SHOPIFY_REFUND_ATTEMPT_STATUSES } from './outbound-shopify-refund-attempt.service.js';

export const ORDER_SHIPPING_REFUND_CLAIM_STATUSES = {
  ACTIVE: 'ACTIVE',
  RELEASED: 'RELEASED',
} as const;

export type OrderShippingRefundClaimAcquisitionResult =
  | { outcome: 'ACQUIRED'; claimId: string; ownerAttemptId: string }
  | { outcome: 'SAME_OWNER'; claimId: string; ownerAttemptId: string }
  | { outcome: 'OWNED_BY_ANOTHER_ATTEMPT'; claimId: string; ownerAttemptId: string }
  | { outcome: 'OWNER_TERMINAL'; claimId: string; ownerAttemptId: string };

export type OrderShippingRefundClaimReleaseResult =
  | { outcome: 'RELEASED'; releasedClaims: number }
  | { outcome: 'NOT_RELEASED'; releasedClaims: 0 };

export class OrderShippingRefundClaimValidationError extends Error {}

function isUniqueConstraintError(error: unknown) {
  return (
    (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') ||
    (error !== null && typeof error === 'object' && Reflect.get(error, 'code') === 'P2002')
  );
}

function normalizeRequiredId(value: string, field: string) {
  const normalized = value.trim();
  if (!normalized) {
    throw new OrderShippingRefundClaimValidationError(`${field} is required.`);
  }
  return normalized;
}

export function buildShopifyRefundIdempotencyKey(input: {
  allocationId: string;
  attemptId: string;
}) {
  return `shopify-refund:${normalizeRequiredId(input.allocationId, 'allocationId')}:${normalizeRequiredId(input.attemptId, 'attemptId')}`;
}

export async function acquireOrderShippingRefundClaim(input: {
  shopifyOrderId: string;
  attemptId: string;
}): Promise<OrderShippingRefundClaimAcquisitionResult> {
  const shopifyOrderId = normalizeRequiredId(input.shopifyOrderId, 'shopifyOrderId');
  const attemptId = normalizeRequiredId(input.attemptId, 'attemptId');
  const attempt = await prisma.outboundShopifyRefundAttempt.findUnique({
    where: { id: attemptId },
    select: {
      id: true,
      shopifyOrderId: true,
      status: true,
    },
  });

  if (!attempt || attempt.shopifyOrderId !== shopifyOrderId) {
    throw new OrderShippingRefundClaimValidationError('Refund attempt does not belong to the requested Shopify order.');
  }

  if (
    attempt.status !== OUTBOUND_SHOPIFY_REFUND_ATTEMPT_STATUSES.READY_TO_SUBMIT &&
    attempt.status !== OUTBOUND_SHOPIFY_REFUND_ATTEMPT_STATUSES.SHOPIFY_ACTION_PENDING
  ) {
    throw new OrderShippingRefundClaimValidationError('Refund attempt must be nonterminal before acquiring shipping ownership.');
  }

  const ownerClaim = await prisma.orderShippingRefundClaim.findUnique({
    where: { ownerAttemptId: attemptId },
  });
  if (ownerClaim) {
    if (ownerClaim.shopifyOrderId !== shopifyOrderId) {
      throw new OrderShippingRefundClaimValidationError('Refund attempt shipping ownership belongs to another Shopify order.');
    }
    return ownerClaim.status === ORDER_SHIPPING_REFUND_CLAIM_STATUSES.ACTIVE && ownerClaim.activeOrderKey === shopifyOrderId
      ? { outcome: 'SAME_OWNER', claimId: ownerClaim.id, ownerAttemptId: attemptId }
      : { outcome: 'OWNER_TERMINAL', claimId: ownerClaim.id, ownerAttemptId: attemptId };
  }

  for (let acquisitionAttempt = 0; acquisitionAttempt < 2; acquisitionAttempt += 1) {
    try {
      const claim = await prisma.orderShippingRefundClaim.create({
        data: {
          shopifyOrderId,
          ownerAttemptId: attemptId,
          activeOrderKey: shopifyOrderId,
          status: ORDER_SHIPPING_REFUND_CLAIM_STATUSES.ACTIVE,
        },
      });
      return { outcome: 'ACQUIRED', claimId: claim.id, ownerAttemptId: attemptId };
    } catch (error) {
      if (!isUniqueConstraintError(error)) {
        throw error;
      }

      const conflictingClaim = await prisma.orderShippingRefundClaim.findFirst({
        where: {
          OR: [
            { activeOrderKey: shopifyOrderId },
            { ownerAttemptId: attemptId },
          ],
        },
        orderBy: { acquiredAt: 'desc' },
      });
      if (!conflictingClaim) {
        if (acquisitionAttempt === 0) {
          continue;
        }
        throw new OrderShippingRefundClaimValidationError(
          'Shipping refund ownership changed concurrently; retry the same logical attempt.',
        );
      }
      if (conflictingClaim.ownerAttemptId === attemptId) {
        return conflictingClaim.status === ORDER_SHIPPING_REFUND_CLAIM_STATUSES.ACTIVE &&
          conflictingClaim.activeOrderKey === shopifyOrderId
          ? { outcome: 'SAME_OWNER', claimId: conflictingClaim.id, ownerAttemptId: attemptId }
          : { outcome: 'OWNER_TERMINAL', claimId: conflictingClaim.id, ownerAttemptId: attemptId };
      }
      return {
        outcome: 'OWNED_BY_ANOTHER_ATTEMPT',
        claimId: conflictingClaim.id,
        ownerAttemptId: conflictingClaim.ownerAttemptId,
      };
    }
  }

  throw new OrderShippingRefundClaimValidationError('Shipping refund ownership could not be acquired.');
}

export async function releaseResolvedOrderShippingRefundClaimsForAllocation(
  tx: Prisma.TransactionClient,
  input: { vendorAllocationId: string; releasedAt: Date },
): Promise<OrderShippingRefundClaimReleaseResult> {
  const result = await tx.orderShippingRefundClaim.updateMany({
    where: {
      status: ORDER_SHIPPING_REFUND_CLAIM_STATUSES.ACTIVE,
      activeOrderKey: { not: null },
      ownerAttempt: {
        vendorAllocationId: input.vendorAllocationId,
        status: OUTBOUND_SHOPIFY_REFUND_ATTEMPT_STATUSES.RESOLVED,
      },
    },
    data: {
      status: ORDER_SHIPPING_REFUND_CLAIM_STATUSES.RELEASED,
      activeOrderKey: null,
      releasedAt: input.releasedAt,
      releaseReason: 'OWNER_ATTEMPT_RESOLVED',
    },
  });
  return result.count > 0
    ? { outcome: 'RELEASED', releasedClaims: result.count }
    : { outcome: 'NOT_RELEASED', releasedClaims: 0 };
}
