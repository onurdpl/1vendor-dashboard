import { describe, expect, it } from 'vitest';
import {
  appendLedgerEntry,
  buildLineItemSaleReservationEntries,
  buildRefundReversalEntries,
  calculateCommissionMinor,
  calculateLedgerBalance,
  freezeLedgerEntry,
} from '../backend/src/modules/finance/finance-ledger';
import type { FinanceLedgerEntry } from '../backend/src/modules/finance/finance-ledger.types';

function manualEntry(overrides: Partial<FinanceLedgerEntry>): FinanceLedgerEntry {
  return {
    id: 'manual-entry-1',
    eventType: 'MANUAL_ADJUSTMENT',
    sourceType: 'manual',
    vendorId: 'sporjinal',
    currency: 'TRY',
    occurredAt: '2026-05-20T10:00:00.000Z',
    createdAt: '2026-05-20T10:00:00.000Z',
    sequence: 1,
    orderId: null,
    orderNumber: null,
    lineItemId: null,
    returnId: null,
    refundId: null,
    payoutBatchId: null,
    reversalOfEntryId: null,
    amountMinor: 0,
    impact: {},
    ...overrides,
  };
}

describe('append-only finance ledger foundation', () => {
  it('calculates vendor payable from line-item sale reservation entries', () => {
    const entries = buildLineItemSaleReservationEntries({
      vendorId: 'sporjinal',
      orderId: 'gid://shopify/Order/1039',
      orderNumber: '#1039',
      lineItemId: 'line-1039-1',
      grossAmountMinor: 10_000,
      commissionBps: 1_000,
      occurredAt: '2026-05-20T10:00:00.000Z',
    });

    const balance = calculateLedgerBalance(entries);

    expect(balance.grossSalesMinor).toBe(10_000);
    expect(balance.marketplaceCommissionMinor).toBe(1_000);
    expect(balance.vendorPayableMinor).toBe(9_000);
    expect(balance.netVendorPositionMinor).toBe(9_000);
    expect(balance.byLineItem['line-1039-1']).toMatchObject({
      grossSalesMinor: 10_000,
      marketplaceCommissionMinor: 1_000,
      vendorPayableMinor: 9_000,
    });
  });

  it('calculates commission in minor units deterministically', () => {
    expect(calculateCommissionMinor(12_345, 1_500)).toBe(1_852);
    expect(calculateCommissionMinor(12_345.4, 1_500)).toBe(1_852);
    expect(calculateCommissionMinor(Number.NaN, 1_500)).toBe(0);
  });

  it('reverses only the refunded portion for unpaid partial refunds', () => {
    const saleEntries = buildLineItemSaleReservationEntries({
      vendorId: 'sporjinal',
      orderId: 'gid://shopify/Order/1040',
      orderNumber: '#1040',
      lineItemId: 'line-1040-1',
      grossAmountMinor: 10_000,
      commissionBps: 1_000,
      occurredAt: '2026-05-20T10:00:00.000Z',
    });
    const refundEntries = buildRefundReversalEntries({
      vendorId: 'sporjinal',
      orderId: 'gid://shopify/Order/1040',
      orderNumber: '#1040',
      lineItemId: 'line-1040-1',
      refundId: 'refund-1040-partial',
      refundAmountMinor: 4_000,
      commissionBps: 1_000,
      payoutAlreadyPaid: false,
      occurredAt: '2026-05-20T11:00:00.000Z',
      sequenceStart: 10,
    });

    const balance = calculateLedgerBalance([...saleEntries, ...refundEntries]);

    expect(balance.marketplaceCommissionMinor).toBe(600);
    expect(balance.vendorPayableMinor).toBe(5_400);
    expect(balance.vendorDebtMinor).toBe(0);
    expect(balance.netVendorPositionMinor).toBe(5_400);
  });

  it('creates vendor debt instead of mutating paid payout balances', () => {
    const saleEntries = buildLineItemSaleReservationEntries({
      vendorId: 'sporjinal',
      orderId: 'gid://shopify/Order/1041',
      orderNumber: '#1041',
      lineItemId: 'line-1041-1',
      grossAmountMinor: 10_000,
      commissionBps: 1_000,
      occurredAt: '2026-05-20T10:00:00.000Z',
    });
    const refundEntries = buildRefundReversalEntries({
      vendorId: 'sporjinal',
      orderId: 'gid://shopify/Order/1041',
      orderNumber: '#1041',
      lineItemId: 'line-1041-1',
      refundId: 'refund-1041-paid',
      refundAmountMinor: 4_000,
      commissionBps: 1_000,
      payoutAlreadyPaid: true,
      occurredAt: '2026-05-20T11:00:00.000Z',
      sequenceStart: 10,
    });

    const balance = calculateLedgerBalance([...saleEntries, ...refundEntries]);

    expect(balance.marketplaceCommissionMinor).toBe(600);
    expect(balance.vendorPayableMinor).toBe(9_000);
    expect(balance.vendorDebtMinor).toBe(3_600);
    expect(balance.netVendorPositionMinor).toBe(5_400);
  });

  it('appends new entries without mutating existing ledger history', () => {
    const initialEntry = freezeLedgerEntry(
      manualEntry({
        id: 'entry-1',
        impact: { vendorPayableMinor: 1_000 },
      }),
    );
    const existingEntries = Object.freeze([initialEntry]);
    const appended = appendLedgerEntry(
      existingEntries,
      manualEntry({
        id: 'entry-2',
        sequence: 2,
        impact: { shippingCostReservedMinor: 100 },
      }),
    );

    expect(existingEntries).toHaveLength(1);
    expect(appended).toHaveLength(2);
    expect(appended).not.toBe(existingEntries);
    expect(Object.isFrozen(appended)).toBe(true);
    expect(Object.isFrozen(appended[0])).toBe(true);
    expect(calculateLedgerBalance(appended).netVendorPositionMinor).toBe(900);
    expect(() => appendLedgerEntry(appended, manualEntry({ id: 'entry-2' }))).toThrow('Duplicate finance ledger entry id');
  });
});
