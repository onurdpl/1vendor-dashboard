import type { Prisma } from '@prisma/client';

export const FULL_ORDER_CANCELLATION_BLOCKED_MESSAGE =
  'Full Shopify order cancellation blocks this operation.';

type FullOrderCancellationState = {
  cancelledAt?: Date | string | null;
} | null | undefined;

export function isFullOrderCancelled(order: FullOrderCancellationState) {
  return Boolean(order?.cancelledAt);
}

// Allocation cancellationReason is legacy/secondary metadata, not Shopify full-order cancellation truth.

export function assertFullOrderOperationallyEligible(
  order: FullOrderCancellationState,
  message = FULL_ORDER_CANCELLATION_BLOCKED_MESSAGE,
) {
  if (isFullOrderCancelled(order)) {
    throw new Error(message);
  }
}

export const fullOrderOperationalAllocationWhere = {
  order: {
    cancelledAt: null,
  },
} satisfies Prisma.VendorAllocationWhereInput;
