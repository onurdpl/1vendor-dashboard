import { describe, expect, it } from 'vitest';
import { calculateVendorPayout } from '../backend/src/modules/finance/payout-calculator';

const baseProfile = {
  commissionPercent: 12,
  commissionVatPercent: 20,
  deductShippingEnabled: true,
  shippingMode: 'fixed' as const,
  fixedShippingFee: 35,
};

describe('vendor payout calculation foundation', () => {
  it('calculates vendor commission and commission VAT', () => {
    const result = calculateVendorPayout({
      grossAmount: 1000,
      refundAmount: 0,
      fulfilled: false,
      profile: baseProfile,
    });

    expect(result.commission).toBe(120);
    expect(result.commissionVat).toBe(24);
    expect(result.estimatedPayout).toBe(856);
  });

  it('applies shipping deduction only after fulfillment', () => {
    const beforeFulfillment = calculateVendorPayout({
      grossAmount: 1000,
      refundAmount: 0,
      fulfilled: false,
      profile: baseProfile,
    });
    const afterFulfillment = calculateVendorPayout({
      grossAmount: 1000,
      refundAmount: 0,
      fulfilled: true,
      profile: baseProfile,
    });

    expect(beforeFulfillment.shippingDeduction).toBe(0);
    expect(afterFulfillment.shippingDeduction).toBe(35);
    expect(afterFulfillment.estimatedPayout).toBe(821);
  });

  it('fully subtracts refunds from payout without protection', () => {
    const result = calculateVendorPayout({
      grossAmount: 1000,
      refundAmount: 250,
      fulfilled: true,
      profile: baseProfile,
    });

    expect(result.refundImpact).toBe(250);
    expect(result.estimatedPayout).toBe(571);
  });

  it('does not deduct shipping when shipping mode is disabled', () => {
    const result = calculateVendorPayout({
      grossAmount: 1000,
      refundAmount: 0,
      fulfilled: true,
      profile: {
        ...baseProfile,
        deductShippingEnabled: false,
        shippingMode: 'disabled',
      },
    });

    expect(result.shippingDeduction).toBe(0);
    expect(result.shippingApplied).toBe(false);
  });
});
