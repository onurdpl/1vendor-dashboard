import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
  vendorFinancialProfile: {
    findFirst: vi.fn(),
  },
  financeLedgerEntry: {
    findMany: vi.fn(),
  },
  payoutBatch: {
    create: vi.fn(),
  },
}));

vi.mock('../backend/src/db/prisma.js', () => ({
  prisma: prismaMock,
}));

const { preparePayoutBatch } = await import('../backend/src/modules/finance/finance.service.js');

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function buildEntry(input: {
  id: string;
  entryType: 'sale' | 'refund';
  amount: number;
  fulfilled?: boolean;
  deliveredAt?: Date | null;
  settlementDelayDaysSnapshot?: number;
  batched?: boolean;
  refundRecords?: Array<{ id: string; sourceShopifyRefundId: string; amount: number }>;
  returnRecords?: Array<{
    id: string;
    status: string;
    returnLifecycleStatus: string | null;
    sourceShopifyRefundId?: string | null;
  }>;
}) {
  const fulfilled = input.fulfilled ?? true;
  const deliveredAt =
    input.deliveredAt === undefined
      ? fulfilled
        ? new Date('2026-05-10T10:00:00Z')
        : null
      : input.deliveredAt;
  const settlementDelayDaysSnapshot = input.settlementDelayDaysSnapshot ?? 21;
  const eligibleAt = fulfilled && deliveredAt ? addDays(deliveredAt, settlementDelayDaysSnapshot) : null;
  return {
    id: input.id,
    vendorId: 'demo-vendor-a',
    entryType: input.entryType,
    amount: input.amount,
    payoutStatus: 'PENDING',
    commissionPercentSnapshot: input.entryType === 'sale' ? 10 : null,
    commissionVatPercentSnapshot: input.entryType === 'sale' ? 0 : null,
    deductShippingEnabledSnapshot: false,
    shippingModeSnapshot: 'DISABLED',
    fixedShippingFeeSnapshot: null,
    settlementDelayDaysSnapshot,
    settlementStatus: input.entryType === 'sale' && !fulfilled ? 'ACCRUING' : input.entryType === 'refund' ? 'PARTIALLY_REFUNDED' : 'PAYABLE',
    settlementEligibleAt: eligibleAt,
    accruedAt: new Date('2026-05-13T09:00:00Z'),
    payableAt: eligibleAt,
    settledAt: null,
    settlementHoldReason: null,
    createdAt: new Date('2026-05-13T09:00:00Z'),
    vendorAllocation: {
      allocationStatus: 'ACTIVE',
      fulfillmentStatus: fulfilled ? 'Fulfilled' : 'Pending',
      shippingStatus: fulfilled ? 'Delivered' : 'Awaiting Shipment',
      fulfillment: {
        fulfilledAt: fulfilled ? new Date('2026-05-13T10:00:00Z') : null,
        shipmentUpdatedAt: deliveredAt,
      },
      refundRecords: input.refundRecords ?? [],
      returnRecords: (input.returnRecords ?? []).map((record) => ({
        ...record,
        sourceShopifyRefundId: record.sourceShopifyRefundId ?? null,
      })),
    },
    payoutBatchLines: input.batched ? [{ id: `line-${input.id}` }] : [],
  };
}

describe('payout batch preparation', () => {
  beforeEach(() => {
    prismaMock.$transaction.mockReset();
    prismaMock.vendorFinancialProfile.findFirst.mockReset();
    prismaMock.financeLedgerEntry.findMany.mockReset();
    prismaMock.payoutBatch.create.mockReset();

    prismaMock.$transaction.mockImplementation(async (callback) => callback(prismaMock));
    prismaMock.vendorFinancialProfile.findFirst.mockResolvedValue({
      id: 'profile-demo-vendor-a',
      vendorId: 'demo-vendor-a',
      commissionPercent: 10,
      commissionVatPercent: 0,
      deductShippingEnabled: false,
      shippingMode: 'DISABLED',
      fixedShippingFee: null,
      settlementDelayDays: 21,
      active: true,
    });
  });

  it('prepares a draft batch from payable rows and refund reductions only', async () => {
    prismaMock.financeLedgerEntry.findMany.mockResolvedValue([
      buildEntry({ id: 'sale-payable', entryType: 'sale', amount: 1000 }),
      buildEntry({ id: 'sale-accruing', entryType: 'sale', amount: 500, fulfilled: false }),
      buildEntry({ id: 'refund-payable', entryType: 'refund', amount: 100 }),
    ]);
    prismaMock.payoutBatch.create.mockImplementation(async ({ data }) => ({
      id: 'batch-1',
      vendorId: data.vendorId,
      status: data.status,
      grossAmount: data.grossAmount,
      commissionAmount: data.commissionAmount,
      commissionVatAmount: data.commissionVatAmount,
      shippingDeductionAmount: data.shippingDeductionAmount,
      refundAmount: data.refundAmount,
      netAmount: data.netAmount,
      currency: data.currency,
      createdByUserId: data.createdByUserId,
      createdAt: new Date('2026-05-13T11:00:00Z'),
      updatedAt: new Date('2026-05-13T11:00:00Z'),
      lines: data.lines.create.map((line: { financeLedgerEntryId: string; amountSnapshot: number }, index: number) => ({
        id: `batch-line-${index}`,
        financeLedgerEntryId: line.financeLedgerEntryId,
        amountSnapshot: line.amountSnapshot,
        createdAt: new Date('2026-05-13T11:00:00Z'),
      })),
    }));

    const batch = await preparePayoutBatch({ vendorId: 'demo-vendor-a' }, 'admin-user');

    expect(prismaMock.payoutBatch.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          vendorId: 'demo-vendor-a',
          grossAmount: 1000,
          commissionAmount: 100,
          refundAmount: 100,
          netAmount: 800,
          lines: {
            create: [
              { financeLedgerEntryId: 'sale-payable', amountSnapshot: 900 },
              { financeLedgerEntryId: 'refund-payable', amountSnapshot: -100 },
            ],
          },
        }),
      }),
    );
    expect(batch).toMatchObject({
      id: 'batch-1',
      status: 'draft',
      grossAmount: '1000.00',
      refundAmount: '100.00',
      netAmount: '800.00',
      lineCount: 2,
    });
  });

  it('prevents duplicate active batch inclusion', async () => {
    prismaMock.financeLedgerEntry.findMany.mockResolvedValue([
      buildEntry({ id: 'sale-already-batched', entryType: 'sale', amount: 1000, batched: true }),
    ]);

    await expect(preparePayoutBatch({ vendorId: 'demo-vendor-a' }, 'admin-user')).rejects.toThrow(
      'No eligible payable ledger rows',
    );
    expect(prismaMock.payoutBatch.create).not.toHaveBeenCalled();
  });

  it('excludes sales from payout batch preparation before the settlement delay passes', async () => {
    prismaMock.financeLedgerEntry.findMany.mockResolvedValue([
      buildEntry({
        id: 'sale-delay-pending',
        entryType: 'sale',
        amount: 1000,
        deliveredAt: new Date('2999-01-01T00:00:00Z'),
      }),
      buildEntry({
        id: 'sale-14-day-delay',
        entryType: 'sale',
        amount: 500,
        deliveredAt: new Date('2026-06-01T00:00:00Z'),
        settlementDelayDaysSnapshot: 14,
      }),
      buildEntry({ id: 'refund-payable', entryType: 'refund', amount: 100 }),
    ]);
    prismaMock.payoutBatch.create.mockImplementation(async ({ data }) => ({
      id: 'batch-delay',
      vendorId: data.vendorId,
      status: data.status,
      grossAmount: data.grossAmount,
      commissionAmount: data.commissionAmount,
      commissionVatAmount: data.commissionVatAmount,
      shippingDeductionAmount: data.shippingDeductionAmount,
      refundAmount: data.refundAmount,
      netAmount: data.netAmount,
      currency: data.currency,
      createdByUserId: data.createdByUserId,
      createdAt: new Date('2026-06-15T11:00:00Z'),
      updatedAt: new Date('2026-06-15T11:00:00Z'),
      lines: data.lines.create.map((line: { financeLedgerEntryId: string; amountSnapshot: number }, index: number) => ({
        id: `batch-line-delay-${index}`,
        financeLedgerEntryId: line.financeLedgerEntryId,
        amountSnapshot: line.amountSnapshot,
        createdAt: new Date('2026-06-15T11:00:00Z'),
      })),
    }));

    const batch = await preparePayoutBatch({ vendorId: 'demo-vendor-a' }, 'admin-user');

    expect(prismaMock.payoutBatch.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          grossAmount: 500,
          refundAmount: 100,
          netAmount: 350,
          lines: {
            create: [
              { financeLedgerEntryId: 'sale-14-day-delay', amountSnapshot: 450 },
              { financeLedgerEntryId: 'refund-payable', amountSnapshot: -100 },
            ],
          },
        }),
      }),
    );
    expect(batch).toMatchObject({
      id: 'batch-delay',
      lineCount: 2,
      netAmount: '350.00',
    });
  });

  it('excludes Shopify-approved open return sales from payout batch preparation', async () => {
    prismaMock.financeLedgerEntry.findMany.mockResolvedValue([
      buildEntry({
        id: 'sale-approved-return',
        entryType: 'sale',
        amount: 1000,
        returnRecords: [{
          id: 'return-approved',
          status: 'requested',
          returnLifecycleStatus: 'approved',
        }],
      }),
      buildEntry({
        id: 'sale-legacy-approved-return',
        entryType: 'sale',
        amount: 600,
        returnRecords: [{
          id: 'return-legacy-approved',
          status: 'approved',
          returnLifecycleStatus: null,
        }],
      }),
      buildEntry({
        id: 'sale-requested-return',
        entryType: 'sale',
        amount: 500,
        returnRecords: [{
          id: 'return-requested',
          status: 'requested',
          returnLifecycleStatus: 'requested',
        }],
      }),
      buildEntry({ id: 'refund-row', entryType: 'refund', amount: 100 }),
    ]);
    prismaMock.payoutBatch.create.mockImplementation(async ({ data }) => ({
      id: 'batch-open-return',
      vendorId: data.vendorId,
      status: data.status,
      grossAmount: data.grossAmount,
      commissionAmount: data.commissionAmount,
      commissionVatAmount: data.commissionVatAmount,
      shippingDeductionAmount: data.shippingDeductionAmount,
      refundAmount: data.refundAmount,
      netAmount: data.netAmount,
      currency: data.currency,
      createdByUserId: data.createdByUserId,
      createdAt: new Date('2026-05-13T11:00:00Z'),
      updatedAt: new Date('2026-05-13T11:00:00Z'),
      lines: data.lines.create.map((line: { financeLedgerEntryId: string; amountSnapshot: number }, index: number) => ({
        id: `batch-line-open-return-${index}`,
        financeLedgerEntryId: line.financeLedgerEntryId,
        amountSnapshot: line.amountSnapshot,
        createdAt: new Date('2026-05-13T11:00:00Z'),
      })),
    }));

    const batch = await preparePayoutBatch({ vendorId: 'demo-vendor-a' }, 'admin-user');

    expect(prismaMock.payoutBatch.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          grossAmount: 500,
          refundAmount: 100,
          netAmount: 350,
          lines: {
            create: [
              { financeLedgerEntryId: 'sale-requested-return', amountSnapshot: 450 },
              { financeLedgerEntryId: 'refund-row', amountSnapshot: -100 },
            ],
          },
        }),
      }),
    );
    expect(batch).toMatchObject({
      id: 'batch-open-return',
      lineCount: 2,
      netAmount: '350.00',
    });
  });

  it('keeps processed refund impact eligible instead of applying open-return hold', async () => {
    prismaMock.financeLedgerEntry.findMany.mockResolvedValue([
      buildEntry({
        id: 'sale-refund-processed',
        entryType: 'sale',
        amount: 1000,
        refundRecords: [{ id: 'refund-processed', sourceShopifyRefundId: 'refund-1', amount: 100 }],
        returnRecords: [{
          id: 'return-approved-processed',
          status: 'processed',
          returnLifecycleStatus: 'approved',
          sourceShopifyRefundId: 'refund-1',
        }],
      }),
    ]);
    prismaMock.payoutBatch.create.mockImplementation(async ({ data }) => ({
      id: 'batch-processed-refund',
      vendorId: data.vendorId,
      status: data.status,
      grossAmount: data.grossAmount,
      commissionAmount: data.commissionAmount,
      commissionVatAmount: data.commissionVatAmount,
      shippingDeductionAmount: data.shippingDeductionAmount,
      refundAmount: data.refundAmount,
      netAmount: data.netAmount,
      currency: data.currency,
      createdByUserId: data.createdByUserId,
      createdAt: new Date('2026-05-13T11:00:00Z'),
      updatedAt: new Date('2026-05-13T11:00:00Z'),
      lines: data.lines.create.map((line: { financeLedgerEntryId: string; amountSnapshot: number }, index: number) => ({
        id: `batch-line-processed-refund-${index}`,
        financeLedgerEntryId: line.financeLedgerEntryId,
        amountSnapshot: line.amountSnapshot,
        createdAt: new Date('2026-05-13T11:00:00Z'),
      })),
    }));

    const batch = await preparePayoutBatch({ vendorId: 'demo-vendor-a' }, 'admin-user');

    expect(prismaMock.payoutBatch.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lines: {
            create: [
              { financeLedgerEntryId: 'sale-refund-processed', amountSnapshot: 900 },
            ],
          },
        }),
      }),
    );
    expect(batch).toMatchObject({
      id: 'batch-processed-refund',
      lineCount: 1,
    });
  });
});
