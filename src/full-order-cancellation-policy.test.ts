import { describe, expect, it } from 'vitest';
import {
  FULL_ORDER_CANCELLATION_BLOCKED_MESSAGE,
  assertFullOrderOperationallyEligible,
  fullOrderOperationalAllocationWhere,
  isFullOrderCancelled,
} from '../backend/src/modules/orders/full-order-cancellation-policy.js';

describe('full-order cancellation policy', () => {
  it('uses ShopifyOrder.cancelledAt as the canonical cancellation truth', () => {
    expect(isFullOrderCancelled({ cancelledAt: new Date('2026-07-11T20:23:00.000Z') })).toBe(true);
    expect(isFullOrderCancelled({ cancelledAt: '2026-07-11T20:23:00.000Z' })).toBe(true);
    expect(isFullOrderCancelled({ cancelledAt: null })).toBe(false);
    expect(isFullOrderCancelled(undefined)).toBe(false);
  });

  it('provides one deterministic guard and Prisma exclusion fragment', () => {
    expect(() => assertFullOrderOperationallyEligible({ cancelledAt: new Date() }))
      .toThrow(FULL_ORDER_CANCELLATION_BLOCKED_MESSAGE);
    expect(fullOrderOperationalAllocationWhere).toEqual({
      order: { cancelledAt: null },
    });
  });
});
