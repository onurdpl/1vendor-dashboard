import { describe, expect, it, vi } from 'vitest';

const {
  calculateVendorDebtMinorForRefund,
  calculateVendorDebtOffset,
  createVendorDebtForPaidRefund,
  getVendorBalanceSummary,
} = await import('../backend/src/modules/finance/vendor-balance.service.js');

describe('vendor balance events', () => {
  it('calculates vendor debt from the existing refund offset formula', () => {
    expect(calculateVendorDebtMinorForRefund({
      refundAmount: 3399,
      commissionPercentSnapshot: 10,
      commissionVatPercentSnapshot: 18,
    })).toBe(299792);
  });

  it('summarizes outstanding debt by vendor and ignores offsets from cancelled payout batches', async () => {
    const db = {
      vendorBalanceEvent: {
        findMany: vi.fn().mockResolvedValue([
          { type: 'VENDOR_DEBT_CREATED', amountMinor: -100000, payoutBatch: null },
          { type: 'VENDOR_DEBT_OFFSET', amountMinor: 40000, payoutBatch: { status: 'DRAFT' } },
          { type: 'VENDOR_DEBT_OFFSET', amountMinor: 10000, payoutBatch: { status: 'CANCELLED' } },
        ]),
      },
    };

    const summary = await getVendorBalanceSummary(db as never, 'vendor-a', 'TRY');

    expect(db.vendorBalanceEvent.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        vendorId: 'vendor-a',
        currency: 'TRY',
      },
    }));
    expect(summary).toEqual({
      vendorId: 'vendor-a',
      currency: 'TRY',
      balanceMinor: -60000,
      outstandingDebtMinor: 60000,
    });
  });

  it('offsets payable against debt without allowing a negative payout', () => {
    expect(calculateVendorDebtOffset({
      grossPayableMinor: 90000,
      outstandingDebtMinor: 100000,
    })).toEqual({
      grossPayableMinor: 90000,
      outstandingDebtMinor: 100000,
      debtOffsetMinor: 90000,
      netPayableMinor: 0,
      remainingDebtMinor: 10000,
    });
  });

  it('uses an idempotent vendor debt event key for duplicate refund webhooks', async () => {
    const db = {
      vendorBalanceEvent: {
        upsert: vi.fn().mockImplementation(async ({ create }) => ({
          id: 'vendor-debt-event',
          ...create,
        })),
      },
    };

    await createVendorDebtForPaidRefund(db as never, {
      vendorId: 'vendor-a',
      refundRecordId: 'refund-a',
      sourceShopifyRefundId: 'gid://shopify/Refund/1',
      financeLedgerEntryId: 'ledger-refund-a',
      refundAmount: 1000,
      commissionPercentSnapshot: 10,
      commissionVatPercentSnapshot: 20,
      currency: 'TRY',
    });
    await createVendorDebtForPaidRefund(db as never, {
      vendorId: 'vendor-a',
      refundRecordId: 'refund-a',
      sourceShopifyRefundId: 'gid://shopify/Refund/1',
      financeLedgerEntryId: 'ledger-refund-a',
      refundAmount: 1000,
      commissionPercentSnapshot: 10,
      commissionVatPercentSnapshot: 20,
      currency: 'TRY',
    });

    expect(db.vendorBalanceEvent.upsert).toHaveBeenCalledTimes(2);
    expect(db.vendorBalanceEvent.upsert).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: {
        idempotencyKey: 'vendor-a:refund-a:VENDOR_DEBT_CREATED',
      },
      update: {},
    }));
    expect(db.vendorBalanceEvent.upsert).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: {
        idempotencyKey: 'vendor-a:refund-a:VENDOR_DEBT_CREATED',
      },
      update: {},
    }));
  });
});
