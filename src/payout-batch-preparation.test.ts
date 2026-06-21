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
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  vendorBalanceEvent: {
    findMany: vi.fn(),
    upsert: vi.fn(),
  },
}));

vi.mock('../backend/src/db/prisma.js', () => ({
  prisma: prismaMock,
}));

const {
  PayoutBatchTransitionRevalidationError,
  markPayoutBatchReview,
  preparePayoutBatch,
} = await import('../backend/src/modules/finance/finance.service.js');

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
  payoutStatus?: 'PENDING' | 'PAID' | 'HOLD';
  settlementHoldReason?: string | null;
  relatedSalePaid?: boolean;
  relatedSaleActiveApproval?: boolean;
  relatedSaleActivePayoutBatch?: boolean;
  activeSettlementApproval?: boolean;
  approvedRefundOffsetRepresented?: boolean;
  voidedAt?: Date | null;
  refundRecords?: Array<{ id: string; sourceShopifyRefundId: string; amount: number; createdAt?: Date }>;
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
    payoutStatus: input.payoutStatus ?? 'PENDING',
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
    settlementHoldReason: input.settlementHoldReason ?? null,
    voidedAt: input.voidedAt ?? null,
    voidReason: input.voidedAt ? 'economic transfer superseded source ledger' : null,
    supersededByLedgerId: input.voidedAt ? `replacement-${input.id}` : null,
    createdAt: new Date('2026-05-13T09:00:00Z'),
    vendorAllocation: {
      allocationStatus: 'ACTIVE',
      fulfillmentStatus: fulfilled ? 'Fulfilled' : 'Pending',
      shippingStatus: fulfilled ? 'Delivered' : 'Awaiting Shipment',
      fulfillment: {
        fulfilledAt: fulfilled ? new Date('2026-05-13T10:00:00Z') : null,
        shipmentUpdatedAt: deliveredAt,
      },
      refundRecords: input.refundRecords ?? (
        input.entryType === 'refund'
          ? [{ id: `refund-record-${input.id}`, sourceShopifyRefundId: `refund-${input.id}`, amount: input.amount }]
          : []
      ),
      financeEntries: input.entryType === 'refund'
        ? [
            {
              id: `sale-for-${input.id}`,
              entryType: 'sale',
              payoutStatus: input.relatedSalePaid ? 'PAID' : 'PENDING',
              settlementStatus: input.relatedSalePaid ? 'SETTLED' : 'PAYABLE',
              commissionPercentSnapshot: 10,
              commissionVatPercentSnapshot: 0,
              payoutBatchLines: input.relatedSaleActivePayoutBatch
                ? [{ payoutBatch: { status: 'DRAFT' } }]
                : [],
              settlementApprovalLines: input.relatedSaleActiveApproval
                ? [{ settlementApproval: { id: `approval-sale-for-${input.id}`, status: 'APPROVED' } }]
                : [],
            },
          ]
        : input.approvedRefundOffsetRepresented
          ? [
              {
                id: `refund-for-${input.id}`,
                entryType: 'refund',
                payoutStatus: 'PENDING',
                settlementStatus: 'PARTIALLY_REFUNDED',
                commissionPercentSnapshot: 10,
                commissionVatPercentSnapshot: 0,
                payoutBatchLines: [],
                settlementApprovalLines: [{ settlementApproval: { id: `approval-refund-for-${input.id}`, status: 'APPROVED' } }],
              },
            ]
          : [],
      returnRecords: (input.returnRecords ?? []).map((record) => ({
        ...record,
        sourceShopifyRefundId: record.sourceShopifyRefundId ?? null,
      })),
    },
    payoutBatchLines: input.batched
      ? [{ id: `line-${input.id}`, payoutBatch: { id: 'batch-review', status: 'DRAFT' } }]
      : [],
    settlementApprovalLines: input.activeSettlementApproval
      ? [{ settlementApproval: { id: `approval-${input.id}`, status: 'APPROVED' } }]
      : [],
  };
}

function buildTransitionLine(input: {
  id?: string;
  entry: ReturnType<typeof buildEntry> | null;
  amountSnapshot?: number;
  financeLedgerEntryId?: string;
}) {
  return {
    id: input.id ?? `batch-line-${input.financeLedgerEntryId ?? input.entry?.id ?? 'missing'}`,
    financeLedgerEntryId: input.financeLedgerEntryId ?? input.entry?.id ?? 'missing-ledger',
    amountSnapshot: input.amountSnapshot ?? 900,
    createdAt: new Date('2026-05-13T11:00:00Z'),
    financeLedgerEntry: input.entry,
  };
}

function buildTransitionBatch(lines: ReturnType<typeof buildTransitionLine>[]) {
  return {
    id: 'batch-review',
    vendorId: 'demo-vendor-a',
    status: 'DRAFT',
    grossAmount: 1000,
    commissionAmount: 100,
    commissionVatAmount: 0,
    shippingDeductionAmount: 0,
    refundAmount: 0,
    netAmount: lines.reduce((sum, line) => sum + Number(line.amountSnapshot ?? 0), 0),
    currency: 'TRY',
    createdByUserId: 'admin-user',
    createdAt: new Date('2026-05-13T11:00:00Z'),
    updatedAt: new Date('2026-05-13T11:00:00Z'),
    lines,
  };
}

function mockTransitionBatch(batch: ReturnType<typeof buildTransitionBatch>) {
  prismaMock.payoutBatch.findUnique.mockResolvedValue(batch);
  prismaMock.payoutBatch.update.mockResolvedValue({
    ...batch,
    status: 'REVIEW',
    updatedAt: new Date('2026-05-13T11:05:00Z'),
  });
}

describe('payout batch preparation', () => {
  beforeEach(() => {
    prismaMock.$transaction.mockReset();
    prismaMock.vendorFinancialProfile.findFirst.mockReset();
    prismaMock.financeLedgerEntry.findMany.mockReset();
    prismaMock.payoutBatch.create.mockReset();
    prismaMock.payoutBatch.findUnique.mockReset();
    prismaMock.payoutBatch.update.mockReset();
    prismaMock.vendorBalanceEvent.findMany.mockReset();
    prismaMock.vendorBalanceEvent.upsert.mockReset();

    prismaMock.$transaction.mockImplementation(async (callback) => callback(prismaMock));
    prismaMock.vendorBalanceEvent.findMany.mockResolvedValue([]);
    prismaMock.vendorBalanceEvent.upsert.mockImplementation(async ({ create }) => ({
      id: 'vendor-balance-event-offset',
      createdAt: new Date('2026-05-13T11:00:00Z'),
      ...create,
    }));
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
          commissionAmount: 90,
          refundAmount: 100,
          netAmount: 810,
          lines: {
            create: [
              { financeLedgerEntryId: 'sale-payable', amountSnapshot: 900 },
              { financeLedgerEntryId: 'refund-payable', amountSnapshot: -90 },
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
      netAmount: '810.00',
      lineCount: 2,
    });
    expect(prismaMock.financeLedgerEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          vendorId: 'demo-vendor-a',
          voidedAt: null,
          entryType: {
            in: ['sale', 'refund'],
          },
        }),
      }),
    );
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

  it('does not offset refund rows when the related sale is already paid', async () => {
    prismaMock.financeLedgerEntry.findMany.mockResolvedValue([
      buildEntry({ id: 'refund-after-paid-sale', entryType: 'refund', amount: 100, relatedSalePaid: true }),
    ]);

    await expect(preparePayoutBatch({ vendorId: 'demo-vendor-a' }, 'admin-user')).rejects.toThrow(
      'No eligible payable ledger rows',
    );
    expect(prismaMock.payoutBatch.create).not.toHaveBeenCalled();
  });

  it('blocks payout preparation when refund arrives after settlement approval and no unaffected rows remain', async () => {
    prismaMock.financeLedgerEntry.findMany.mockResolvedValue([
      buildEntry({
        id: 'approved-sale-with-late-refund',
        entryType: 'sale',
        amount: 1000,
        activeSettlementApproval: true,
        refundRecords: [{ id: 'refund-late', sourceShopifyRefundId: 'refund-late', amount: 100 }],
      }),
    ]);

    await expect(preparePayoutBatch({ vendorId: 'demo-vendor-a' }, 'admin-user')).rejects.toThrow(
      'Refund after settlement approval requires adjustment before payout',
    );
    expect(prismaMock.payoutBatch.create).not.toHaveBeenCalled();
  });

  it('excludes post-approval refund risk rows while preparing unaffected payout rows', async () => {
    prismaMock.financeLedgerEntry.findMany.mockResolvedValue([
      buildEntry({
        id: 'approved-sale-with-late-refund',
        entryType: 'sale',
        amount: 1000,
        activeSettlementApproval: true,
        refundRecords: [{ id: 'refund-late', sourceShopifyRefundId: 'refund-late', amount: 100 }],
      }),
      buildEntry({ id: 'unaffected-sale', entryType: 'sale', amount: 500 }),
    ]);
    prismaMock.payoutBatch.create.mockImplementation(async ({ data }) => ({
      id: 'batch-unaffected',
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
        id: `batch-line-unaffected-${index}`,
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
          commissionAmount: 50,
          refundAmount: 0,
          netAmount: 450,
          lines: {
            create: [
              { financeLedgerEntryId: 'unaffected-sale', amountSnapshot: 450 },
            ],
          },
        }),
      }),
    );
    expect(batch).toMatchObject({
      id: 'batch-unaffected',
      lineCount: 1,
      netAmount: '450.00',
    });
  });

  it('keeps approved refund offset lines eligible when the refund was already represented in settlement approval', async () => {
    prismaMock.financeLedgerEntry.findMany.mockResolvedValue([
      buildEntry({
        id: 'approved-sale-with-approved-refund',
        entryType: 'sale',
        amount: 1000,
        activeSettlementApproval: true,
        approvedRefundOffsetRepresented: true,
        refundRecords: [{ id: 'refund-approved', sourceShopifyRefundId: 'refund-approved', amount: 100 }],
      }),
      buildEntry({
        id: 'approved-refund-offset',
        entryType: 'refund',
        amount: 100,
        activeSettlementApproval: true,
        relatedSaleActiveApproval: true,
      }),
    ]);
    prismaMock.payoutBatch.create.mockImplementation(async ({ data }) => ({
      id: 'batch-approved-offset',
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
        id: `batch-line-approved-offset-${index}`,
        financeLedgerEntryId: line.financeLedgerEntryId,
        amountSnapshot: line.amountSnapshot,
        createdAt: new Date('2026-05-13T11:00:00Z'),
      })),
    }));

    const batch = await preparePayoutBatch({ vendorId: 'demo-vendor-a' }, 'admin-user');

    expect(prismaMock.payoutBatch.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          grossAmount: 1000,
          commissionAmount: 90,
          refundAmount: 100,
          netAmount: 810,
          lines: {
            create: [
              { financeLedgerEntryId: 'approved-sale-with-approved-refund', amountSnapshot: 900 },
              { financeLedgerEntryId: 'approved-refund-offset', amountSnapshot: -90 },
            ],
          },
        }),
      }),
    );
    expect(batch).toMatchObject({
      id: 'batch-approved-offset',
      lineCount: 2,
      netAmount: '810.00',
    });
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
          commissionAmount: 40,
          refundAmount: 100,
          netAmount: 360,
          lines: {
            create: [
              { financeLedgerEntryId: 'sale-14-day-delay', amountSnapshot: 450 },
              { financeLedgerEntryId: 'refund-payable', amountSnapshot: -90 },
            ],
          },
        }),
      }),
    );
    expect(batch).toMatchObject({
      id: 'batch-delay',
      lineCount: 2,
      netAmount: '360.00',
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
          commissionAmount: 40,
          refundAmount: 100,
          netAmount: 360,
          lines: {
            create: [
              { financeLedgerEntryId: 'sale-requested-return', amountSnapshot: 450 },
              { financeLedgerEntryId: 'refund-row', amountSnapshot: -90 },
            ],
          },
        }),
      }),
    );
    expect(batch).toMatchObject({
      id: 'batch-open-return',
      lineCount: 2,
      netAmount: '360.00',
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

  it('offsets future payout against outstanding vendor debt and carries remaining debt', async () => {
    prismaMock.vendorBalanceEvent.findMany.mockResolvedValue([
      {
        type: 'VENDOR_DEBT_CREATED',
        amountMinor: -100000,
        payoutBatch: null,
      },
    ]);
    prismaMock.financeLedgerEntry.findMany.mockResolvedValue([
      buildEntry({ id: 'sale-payable-with-debt', entryType: 'sale', amount: 1000 }),
    ]);
    prismaMock.payoutBatch.create.mockImplementation(async ({ data }) => ({
      id: 'batch-debt-carry',
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
        id: `batch-line-debt-carry-${index}`,
        financeLedgerEntryId: line.financeLedgerEntryId,
        amountSnapshot: line.amountSnapshot,
        createdAt: new Date('2026-05-13T11:00:00Z'),
      })),
    }));

    const batch = await preparePayoutBatch({ vendorId: 'demo-vendor-a' }, 'admin-user');

    expect(prismaMock.payoutBatch.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          grossAmount: 1000,
          commissionAmount: 100,
          netAmount: 0,
          lines: {
            create: [
              { financeLedgerEntryId: 'sale-payable-with-debt', amountSnapshot: 900 },
            ],
          },
        }),
      }),
    );
    expect(prismaMock.vendorBalanceEvent.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { idempotencyKey: 'batch-debt-carry:VENDOR_DEBT_OFFSET' },
        create: expect.objectContaining({
          vendorId: 'demo-vendor-a',
          type: 'VENDOR_DEBT_OFFSET',
          amountMinor: 90000,
          payoutBatchId: 'batch-debt-carry',
          metadataJson: expect.objectContaining({
            grossPayableMinor: 90000,
            outstandingDebtMinor: 100000,
            remainingDebtMinor: 10000,
          }),
        }),
      }),
    );
    expect(batch).toMatchObject({
      id: 'batch-debt-carry',
      netAmount: '0.00',
      payableBeforeDebtOffset: '900.00',
      outstandingDebtAmount: '1000.00',
      debtOffsetAmount: '900.00',
      remainingDebtAmount: '100.00',
      warning: 'Vendor debt remains after this payout draft.',
    });
  });

  it('offsets debt and clears it when payable is larger than outstanding debt', async () => {
    prismaMock.vendorBalanceEvent.findMany.mockResolvedValue([
      {
        type: 'VENDOR_DEBT_CREATED',
        amountMinor: -10000,
        payoutBatch: null,
      },
    ]);
    prismaMock.financeLedgerEntry.findMany.mockResolvedValue([
      buildEntry({ id: 'sale-clears-debt', entryType: 'sale', amount: 1000 }),
    ]);
    prismaMock.payoutBatch.create.mockImplementation(async ({ data }) => ({
      id: 'batch-debt-cleared',
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
        id: `batch-line-debt-cleared-${index}`,
        financeLedgerEntryId: line.financeLedgerEntryId,
        amountSnapshot: line.amountSnapshot,
        createdAt: new Date('2026-05-13T11:00:00Z'),
      })),
    }));

    const batch = await preparePayoutBatch({ vendorId: 'demo-vendor-a' }, 'admin-user');

    expect(prismaMock.payoutBatch.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          netAmount: 800,
        }),
      }),
    );
    expect(prismaMock.vendorBalanceEvent.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          amountMinor: 10000,
          metadataJson: expect.objectContaining({
            grossPayableMinor: 90000,
            outstandingDebtMinor: 10000,
            remainingDebtMinor: 0,
          }),
        }),
      }),
    );
    expect(batch).toMatchObject({
      netAmount: '800.00',
      payableBeforeDebtOffset: '900.00',
      outstandingDebtAmount: '100.00',
      debtOffsetAmount: '100.00',
      remainingDebtAmount: '0.00',
      warning: null,
    });
  });

  it('moves a clean draft payout batch to review', async () => {
    const sale = buildEntry({ id: 'sale-clean-review', entryType: 'sale', amount: 1000, batched: true });
    const batch = buildTransitionBatch([
      buildTransitionLine({ entry: sale, amountSnapshot: 900 }),
    ]);
    mockTransitionBatch(batch);

    const reviewed = await markPayoutBatchReview('batch-review');

    expect(prismaMock.payoutBatch.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'batch-review' },
        data: { status: 'REVIEW' },
      }),
    );
    expect(reviewed).toMatchObject({
      id: 'batch-review',
      status: 'review',
      lineCount: 1,
    });
  });

  it('blocks review when a refund arrived after batch creation', async () => {
    const sale = buildEntry({
      id: 'sale-late-refund',
      entryType: 'sale',
      amount: 1000,
      batched: true,
      refundRecords: [{
        id: 'refund-late',
        sourceShopifyRefundId: 'refund-late',
        amount: 100,
        createdAt: new Date('2026-05-14T11:00:00Z'),
      }],
    });
    mockTransitionBatch(buildTransitionBatch([
      buildTransitionLine({ entry: sale, amountSnapshot: 900 }),
    ]));

    await expect(markPayoutBatchReview('batch-review')).rejects.toMatchObject({
      message: 'Payout batch requires revision because financial facts changed after batch creation.',
      blockers: [expect.objectContaining({ code: 'refund_arrived_after_batch_creation' })],
    });
    expect(prismaMock.payoutBatch.update).not.toHaveBeenCalled();
  });

  it('blocks review when a related refund row is held for payout offset', async () => {
    const sale = buildEntry({ id: 'sale-refund-hold', entryType: 'sale', amount: 1000, batched: true }) as any;
    sale.vendorAllocation.financeEntries = [
      {
        id: 'refund-held',
        entryType: 'refund',
        payoutStatus: 'HOLD',
        settlementStatus: 'PARTIALLY_REFUNDED',
        settlementHoldReason: 'Refund offset required before payout.',
        commissionPercentSnapshot: 10,
        commissionVatPercentSnapshot: 0,
        payoutBatchLines: [],
        settlementApprovalLines: [],
      },
    ];
    mockTransitionBatch(buildTransitionBatch([
      buildTransitionLine({ entry: sale, amountSnapshot: 900 }),
    ]));

    try {
      await markPayoutBatchReview('batch-review');
      throw new Error('Expected transition to fail.');
    } catch (error) {
      expect(error).toBeInstanceOf(PayoutBatchTransitionRevalidationError);
      expect(error).toMatchObject({
        blockers: [expect.objectContaining({ code: 'refund_offset_required_before_payout' })],
      });
    }
    expect(prismaMock.payoutBatch.update).not.toHaveBeenCalled();
  });

  it('blocks review when the payout amount snapshot no longer matches current truth', async () => {
    const sale = buildEntry({ id: 'sale-amount-changed', entryType: 'sale', amount: 1000, batched: true });
    mockTransitionBatch(buildTransitionBatch([
      buildTransitionLine({ entry: sale, amountSnapshot: 899 }),
    ]));

    await expect(markPayoutBatchReview('batch-review')).rejects.toMatchObject({
      blockers: [expect.objectContaining({ code: 'payout_amount_changed_since_batch_creation' })],
    });
    expect(prismaMock.payoutBatch.update).not.toHaveBeenCalled();
  });

  it('blocks review when an approved return hold is active', async () => {
    const sale = buildEntry({
      id: 'sale-active-return-hold',
      entryType: 'sale',
      amount: 1000,
      batched: true,
      returnRecords: [{
        id: 'return-approved',
        status: 'requested',
        returnLifecycleStatus: 'approved',
      }],
    });
    mockTransitionBatch(buildTransitionBatch([
      buildTransitionLine({ entry: sale, amountSnapshot: 900 }),
    ]));

    try {
      await markPayoutBatchReview('batch-review');
      throw new Error('Expected transition to fail.');
    } catch (error) {
      expect(error).toMatchObject({
        blockers: expect.arrayContaining([expect.objectContaining({ code: 'approved_return_hold_active' })]),
      });
    }
    expect(prismaMock.payoutBatch.update).not.toHaveBeenCalled();
  });

  it('blocks review when a ledger row is already paid', async () => {
    const sale = buildEntry({
      id: 'sale-paid-after-batch',
      entryType: 'sale',
      amount: 1000,
      batched: true,
      payoutStatus: 'PAID',
    });
    mockTransitionBatch(buildTransitionBatch([
      buildTransitionLine({ entry: sale, amountSnapshot: 900 }),
    ]));

    try {
      await markPayoutBatchReview('batch-review');
      throw new Error('Expected transition to fail.');
    } catch (error) {
      expect(error).toMatchObject({
        blockers: expect.arrayContaining([expect.objectContaining({ code: 'ledger_row_paid' })]),
      });
    }
    expect(prismaMock.payoutBatch.update).not.toHaveBeenCalled();
  });

  it('blocks review when a ledger row is missing', async () => {
    mockTransitionBatch(buildTransitionBatch([
      buildTransitionLine({ entry: null, amountSnapshot: 900, financeLedgerEntryId: 'missing-ledger' }),
    ]));

    await expect(markPayoutBatchReview('batch-review')).rejects.toMatchObject({
      blockers: [expect.objectContaining({
        code: 'ledger_row_missing',
        financeLedgerEntryId: 'missing-ledger',
      })],
    });
    expect(prismaMock.payoutBatch.update).not.toHaveBeenCalled();
  });

  it('blocks review when a ledger row has been voided', async () => {
    const sale = buildEntry({
      id: 'sale-voided-after-batch',
      entryType: 'sale',
      amount: 1000,
      batched: true,
      voidedAt: new Date('2026-06-21T10:00:00.000Z'),
    });
    mockTransitionBatch(buildTransitionBatch([
      buildTransitionLine({ entry: sale, amountSnapshot: 900 }),
    ]));

    await expect(markPayoutBatchReview('batch-review')).rejects.toMatchObject({
      blockers: [
        expect.objectContaining({
          code: 'ledger_row_voided',
          financeLedgerEntryId: 'sale-voided-after-batch',
        }),
      ],
    });
    expect(prismaMock.payoutBatch.update).not.toHaveBeenCalled();
  });

  it('keeps an unchanged refund offset line valid during review transition', async () => {
    const refund = buildEntry({
      id: 'refund-offset-in-batch',
      entryType: 'refund',
      amount: 100,
      batched: true,
      refundRecords: [{
        id: 'refund-before-batch',
        sourceShopifyRefundId: 'refund-before-batch',
        amount: 100,
        createdAt: new Date('2026-05-12T11:00:00Z'),
      }],
    });
    const batch = buildTransitionBatch([
      buildTransitionLine({ entry: refund, amountSnapshot: -90 }),
    ]);
    mockTransitionBatch(batch);

    const reviewed = await markPayoutBatchReview('batch-review');

    expect(prismaMock.payoutBatch.update).toHaveBeenCalled();
    expect(reviewed).toMatchObject({
      status: 'review',
      lineCount: 1,
    });
  });
});
