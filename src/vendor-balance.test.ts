import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  vendorBalanceEvent: {
    findMany: vi.fn(),
  },
}));

vi.mock('../backend/src/db/prisma.js', () => ({
  prisma: prismaMock,
}));

const {
  calculateVendorDebtMinorForRefund,
  calculateVendorDebtOffset,
  createVendorDebtForPaidRefund,
  getVendorDebtHistory,
  getVendorBalanceSummary,
} = await import('../backend/src/modules/finance/vendor-balance.service.js');

describe('vendor balance events', () => {
  beforeEach(() => {
    prismaMock.vendorBalanceEvent.findMany.mockReset();
  });

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

  it('builds an auditable vendor debt history with order, refund, products, and offsets', async () => {
    prismaMock.vendorBalanceEvent.findMany.mockResolvedValue([
      {
        id: 'debt-created-1',
        vendorId: 'vendor-a',
        type: 'VENDOR_DEBT_CREATED',
        amountMinor: -300000,
        currency: 'TRY',
        sourceType: 'shopify_refund',
        sourceId: 'refund-record-1',
        financeLedgerEntryId: 'ledger-refund-1',
        refundRecordId: 'refund-record-1',
        payoutBatchId: null,
        metadataJson: {
          refundMinor: 340000,
          commissionReversalMinor: 34000,
          commissionVatReversalMinor: 6000,
          vendorDebtMinor: 300000,
          formula: 'vendorDebtMinor = refundMinor - commissionReversalMinor - commissionVatReversalMinor',
        },
        createdAt: new Date('2026-06-01T10:00:00.000Z'),
        vendor: { id: 'vendor-a', name: 'Vendor A' },
        refundRecord: {
          id: 'refund-record-1',
          sourceShopifyRefundId: 'gid://shopify/Refund/1',
          sourceShopifyOrderId: 'gid://shopify/Order/1082',
          sourceShopifyOrderNumber: '#1082',
          amount: 3400,
          createdAt: new Date('2026-06-01T10:00:00.000Z'),
          lineItems: [
            { title: 'Running Shoe', sku: 'RUN-42', quantity: 2 },
          ],
          vendorAllocation: {
            id: 'allocation-1',
            sourceShopifyOrderId: 'gid://shopify/Order/1082',
            sourceShopifyOrderNumber: '#1082',
            order: { createdAt: new Date('2026-05-28T08:00:00.000Z') },
            lineItems: [],
          },
        },
        financeLedgerEntry: {
          id: 'ledger-refund-1',
          vendorAllocation: null,
        },
        payoutBatch: null,
      },
      {
        id: 'debt-offset-1',
        vendorId: 'vendor-a',
        type: 'VENDOR_DEBT_OFFSET',
        amountMinor: 50000,
        currency: 'TRY',
        sourceType: 'payout_batch',
        sourceId: 'batch-1',
        financeLedgerEntryId: null,
        refundRecordId: null,
        payoutBatchId: 'batch-1',
        metadataJson: {
          debtOffsetMinor: 50000,
          remainingDebtMinor: 250000,
        },
        createdAt: new Date('2026-06-05T10:00:00.000Z'),
        vendor: { id: 'vendor-a', name: 'Vendor A' },
        refundRecord: null,
        financeLedgerEntry: null,
        payoutBatch: {
          id: 'batch-1',
          status: 'DRAFT',
          createdAt: new Date('2026-06-05T10:00:00.000Z'),
          updatedAt: new Date('2026-06-05T10:00:00.000Z'),
        },
      },
    ]);

    const history = await getVendorDebtHistory('vendor-a');

    expect(history.summary).toEqual({
      outstandingDebtMinor: 250000,
      totalDebtCreatedMinor: 300000,
      totalDebtOffsetMinor: 50000,
      remainingDebtMinor: 250000,
      lastDebtActivityAt: '2026-06-05T10:00:00.000Z',
    });
    expect(history.events[1]).toMatchObject({
      id: 'debt-created-1',
      label: 'Debt Created',
      orderNumber: '#1082',
      refundReference: 'gid://shopify/Refund/1',
      itemCount: 2,
      productCount: 1,
      remainingDebtAfterEventMinor: 300000,
      products: [
        { title: 'Running Shoe', sku: 'RUN-42', quantity: 2 },
      ],
      calculation: expect.objectContaining({
        vendorDebtMinor: 300000,
      }),
    });
    expect(history.events[0]).toMatchObject({
      id: 'debt-offset-1',
      label: 'Debt Offset Applied',
      payoutBatchId: 'batch-1',
      remainingDebtAfterEventMinor: 250000,
      offsetHistory: [
        expect.objectContaining({
          payoutBatchId: 'batch-1',
          offsetAmountMinor: 50000,
        }),
      ],
    });
  });
});
