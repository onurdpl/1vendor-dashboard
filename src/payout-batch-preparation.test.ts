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

function buildEntry(input: {
  id: string;
  entryType: 'sale' | 'refund';
  amount: number;
  fulfilled?: boolean;
  batched?: boolean;
}) {
  const fulfilled = input.fulfilled ?? true;
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
    settlementStatus: input.entryType === 'sale' && !fulfilled ? 'ACCRUING' : input.entryType === 'refund' ? 'PARTIALLY_REFUNDED' : 'PAYABLE',
    settlementEligibleAt: fulfilled ? new Date('2026-05-13T10:00:00Z') : null,
    accruedAt: new Date('2026-05-13T09:00:00Z'),
    payableAt: fulfilled ? new Date('2026-05-13T10:00:00Z') : null,
    settledAt: null,
    settlementHoldReason: null,
    createdAt: new Date('2026-05-13T09:00:00Z'),
    vendorAllocation: {
      allocationStatus: 'ACTIVE',
      fulfillmentStatus: fulfilled ? 'Fulfilled' : 'Pending',
      shippingStatus: fulfilled ? 'Delivered' : 'Awaiting Shipment',
      fulfillment: {
        fulfilledAt: fulfilled ? new Date('2026-05-13T10:00:00Z') : null,
      },
      refundRecords: [],
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
});
