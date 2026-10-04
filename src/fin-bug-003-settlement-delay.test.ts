import { describe, expect, it } from 'vitest';
import {
  evaluateSaleSettlementDelay,
  resolveSettlementDeliveryDate,
} from '../backend/src/modules/finance/settlement-delay-eligibility.service.js';

const observedAt = new Date('2026-09-01T00:00:00.000Z');
const cutoff = new Date('2026-09-22T00:00:00.000Z');

function allocation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'allocation-a',
    outboundMethodSnapshot: 'KARGONOMI',
    outboundIntegrationProviderSnapshot: null,
    shippingStatus: 'delivered',
    fulfillment: { shipmentUpdatedAt: new Date('2020-01-01T00:00:00.000Z') },
    deliveredObservation: {
      vendorAllocationId: 'allocation-a',
      outboundMethod: 'KARGONOMI',
      outboundIntegrationProvider: null,
      firstObservedDeliveredAt: observedAt,
    },
    ...overrides,
  };
}

function sale(vendorAllocation: ReturnType<typeof allocation> | null, now: Date) {
  return evaluateSaleSettlementDelay({
    entryType: 'sale', settlementDelayDaysSnapshot: 21, vendorAllocation,
  }, now);
}

describe('FIN-BUG-003 provider-neutral SALE delivery clock', () => {
  it('uses only first observed delivery and preserves before/exact/after cutoff', () => {
    const source = allocation();
    expect(sale(source, new Date(cutoff.getTime() - 1)).eligible).toBe(false);
    expect(sale(source, cutoff)).toMatchObject({ eligible: true, deliveryDate: observedAt, eligibleAt: cutoff });
    expect(sale(source, new Date(cutoff.getTime() + 1)).eligible).toBe(true);
    expect(resolveSettlementDeliveryDate(source)).toEqual(observedAt);
  });

  it('fails closed with no observation despite delivered status and shipment timestamp', () => {
    expect(sale(allocation({ deliveredObservation: null }), cutoff)).toMatchObject({
      eligible: false, deliveryDate: null, eligibleAt: null,
    });
  });

  it('does not require a current delivered projection after a valid observation', () => {
    expect(sale(allocation({ shippingStatus: 'returned' }), cutoff).eligible).toBe(true);
    expect(sale(allocation({ shippingStatus: 'cancelled' }), cutoff).eligible).toBe(true);
  });

  it('rejects mismatched allocation, method, provider, and legacy NULL snapshots', () => {
    const mismatches = [
      allocation({ deliveredObservation: { ...allocation().deliveredObservation, vendorAllocationId: 'other' } }),
      allocation({ deliveredObservation: { ...allocation().deliveredObservation, outboundMethod: 'VENDOR_INTEGRATION' } }),
      allocation({ outboundIntegrationProviderSnapshot: 'SOPYO' }),
      allocation({ outboundMethodSnapshot: null, outboundIntegrationProviderSnapshot: null }),
      allocation({ deliveredObservation: { ...allocation().deliveredObservation, firstObservedDeliveredAt: new Date(NaN) } }),
    ];
    for (const source of mismatches) expect(sale(source, cutoff).eligible).toBe(false);
  });

  it('accepts a matching Vendor Integration observation without a provider-specific branch', () => {
    const source = allocation({
      outboundMethodSnapshot: 'VENDOR_INTEGRATION',
      outboundIntegrationProviderSnapshot: 'SOPYO',
      deliveredObservation: {
        ...allocation().deliveredObservation,
        outboundMethod: 'VENDOR_INTEGRATION',
        outboundIntegrationProvider: 'SOPYO',
      },
    });
    expect(sale(source, cutoff).eligible).toBe(true);
  });

  it('does not apply SALE delivery delay to an independent REFUND ledger', () => {
    expect(evaluateSaleSettlementDelay({ entryType: 'refund', vendorAllocation: null }).eligible).toBe(true);
  });
});
