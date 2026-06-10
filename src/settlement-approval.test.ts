import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
  financeLedgerEntry: {
    findMany: vi.fn(),
  },
  settlementApproval: {
    create: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  settlementApprovalLine: {
    count: vi.fn(),
  },
  payoutBatch: {
    create: vi.fn(),
  },
  invoiceExecution: {
    create: vi.fn(),
  },
}));

vi.mock('../backend/src/db/prisma.js', () => ({
  prisma: prismaMock,
}));

const {
  approveSettlementApproval,
  cancelSettlementApproval,
  createDraftApproval,
  getSettlementApprovalAudit,
  previewApproval,
  __settlementApprovalTesting,
} = await import('../backend/src/modules/finance/settlement-approval.service.js');

function buildLedgerRow(input: {
  id: string;
  entryType: 'sale' | 'refund';
  amount: number;
  fulfilled?: boolean;
  activeApproval?: boolean;
  settlementStatus?: string;
  payoutStatus?: string;
  refundRecords?: Array<{ id: string; sourceShopifyRefundId: string; amount: number }>;
}) {
  const fulfilled = input.fulfilled ?? true;
  const createdAt = new Date('2026-06-01T10:00:00.000Z');
  return {
    id: input.id,
    vendorId: 'vendor-a',
    entryType: input.entryType,
    amount: input.amount,
    payoutStatus: input.payoutStatus ?? 'PENDING',
    description: `${input.entryType} row`,
    commissionPercentSnapshot: input.entryType === 'sale' ? 10 : null,
    commissionVatPercentSnapshot: input.entryType === 'sale' ? 20 : null,
    deductShippingEnabledSnapshot: false,
    shippingModeSnapshot: 'DISABLED',
    fixedShippingFeeSnapshot: null,
    shippingCostSnapshot: null,
    shippingVatAmountSnapshot: null,
    shippingCostSourceSnapshot: null,
    shippingCostProviderSnapshot: null,
    settlementStatus:
      input.settlementStatus ??
      (input.entryType === 'refund' ? 'PARTIALLY_REFUNDED' : fulfilled ? 'PAYABLE' : 'ACCRUING'),
    settlementEligibleAt: fulfilled ? createdAt : null,
    accruedAt: createdAt,
    payableAt: fulfilled ? createdAt : null,
    settledAt: null,
    settlementHoldReason: null,
    createdAt,
    vendorAllocation: {
      id: `alloc-${input.id}`,
      allocationStatus: 'ACTIVE',
      fulfillmentStatus: fulfilled ? 'Fulfilled' : 'Pending',
      shippingStatus: fulfilled ? 'Delivered' : 'Awaiting Shipment',
      sourceShopifyOrderId: `order-${input.id}`,
      sourceShopifyOrderNumber: '#1001',
      fulfillment: {
        fulfilledAt: fulfilled ? createdAt : null,
      },
      refundRecords: input.refundRecords ?? [],
    },
    settlementApprovalLines: input.activeApproval
      ? [
          {
            id: `approval-line-${input.id}`,
            settlementApproval: {
              id: `approval-${input.id}`,
              status: 'APPROVED',
            },
          },
        ]
      : [],
  };
}

function buildApproval(input: {
  id: string;
  status: 'DRAFT' | 'APPROVED' | 'CANCELLED';
  commissionInvoices?: Array<{ id: string; status: 'PENDING' | 'CREATED' | 'FAILED' | 'CANCELLED' | 'UNKNOWN' }>;
}) {
  return {
    id: input.id,
    createdAt: new Date('2026-06-01T11:00:00.000Z'),
    updatedAt: new Date('2026-06-01T11:00:00.000Z'),
    vendorId: 'vendor-a',
    periodStart: null,
    periodEnd: null,
    status: input.status,
    currency: 'TRY',
    grossSalesMinor: 100000,
    refundTotalMinor: 10000,
    commissionMinor: 10000,
    commissionVatMinor: 2000,
    netPayableMinor: 78000,
    approvedBy: input.status === 'APPROVED' ? 'admin-1' : null,
    approvedAt: input.status === 'APPROVED' ? new Date('2026-06-01T12:00:00.000Z') : null,
    cancelledBy: input.status === 'CANCELLED' ? 'admin-2' : null,
    cancelledAt: input.status === 'CANCELLED' ? new Date('2026-06-01T13:00:00.000Z') : null,
    notes: null,
    sourceSnapshotJson: { vendorId: 'vendor-a' },
    commissionInvoices: input.commissionInvoices ?? [],
    lines: [
      {
        id: 'line-1',
        settlementApprovalId: input.id,
        financeLedgerEntryId: 'sale-1',
        lineType: 'SALE',
        amountMinor: 100000,
        commissionMinor: 10000,
        commissionVatMinor: 2000,
        payableImpactMinor: 88000,
        sourceSnapshotJson: { financeLedgerEntryId: 'sale-1' },
      },
    ],
  };
}

describe('settlement approval foundation', () => {
  beforeEach(() => {
    prismaMock.$transaction.mockReset();
    prismaMock.$transaction.mockImplementation(async (callback: (tx: typeof prismaMock) => unknown) => callback(prismaMock));
    prismaMock.financeLedgerEntry.findMany.mockReset();
    prismaMock.settlementApproval.create.mockReset();
    prismaMock.settlementApproval.findUnique.mockReset();
    prismaMock.settlementApproval.update.mockReset();
    prismaMock.settlementApprovalLine.count.mockReset();
    prismaMock.payoutBatch.create.mockReset();
    prismaMock.invoiceExecution.create.mockReset();
  });

  it('previews eligible settlement approval rows without writes', async () => {
    prismaMock.financeLedgerEntry.findMany.mockResolvedValue([
      buildLedgerRow({ id: 'sale-1', entryType: 'sale', amount: 1000 }),
      buildLedgerRow({ id: 'refund-1', entryType: 'refund', amount: 100 }),
      buildLedgerRow({ id: 'sale-accruing', entryType: 'sale', amount: 500, fulfilled: false }),
    ]);

    const preview = await previewApproval('vendor-a');

    expect(preview.writesPerformed).toBe(false);
    expect(preview.summary).toMatchObject({
      eligibleRowCount: 2,
      grossSalesMinor: 100000,
      refundTotalMinor: 10000,
      commissionMinor: 10000,
      commissionVatMinor: 2000,
      netPayableMinor: 78000,
    });
    expect(preview.lines).toEqual([
      expect.objectContaining({
        financeLedgerEntryId: 'sale-1',
        lineType: 'SALE',
        payableImpactMinor: 88000,
        storedSettlementStatus: 'PAYABLE',
        derivedSettlementStatus: 'payable',
        payoutStatus: 'PENDING',
        eligibilityDecision: 'included',
        eligibilityReason: 'Derived payable because fulfillment evidence exists.',
        refundDetected: false,
        refundCount: 0,
        fulfillmentEvidencePresent: true,
        shippingEvidencePresent: true,
      }),
      expect.objectContaining({
        financeLedgerEntryId: 'refund-1',
        lineType: 'REFUND',
        payableImpactMinor: -10000,
        storedSettlementStatus: 'PARTIALLY_REFUNDED',
        derivedSettlementStatus: 'partially_refunded',
        eligibilityReason: 'Derived partially refunded because refund records exist.',
        refundDetected: true,
      }),
    ]);
    expect(prismaMock.settlementApproval.create).not.toHaveBeenCalled();
    expect(prismaMock.payoutBatch.create).not.toHaveBeenCalled();
    expect(prismaMock.invoiceExecution.create).not.toHaveBeenCalled();
  });

  it('creates a draft approval with total and line snapshots', async () => {
    prismaMock.financeLedgerEntry.findMany.mockResolvedValue([
      buildLedgerRow({ id: 'sale-1', entryType: 'sale', amount: 1000 }),
      buildLedgerRow({ id: 'refund-1', entryType: 'refund', amount: 100 }),
    ]);
    prismaMock.settlementApprovalLine.count.mockResolvedValue(0);
    prismaMock.settlementApproval.create.mockImplementation(async ({ data }) => ({
      id: 'settlement-approval-1',
      createdAt: new Date('2026-06-01T11:00:00.000Z'),
      updatedAt: new Date('2026-06-01T11:00:00.000Z'),
      vendorId: data.vendorId,
      periodStart: data.periodStart,
      periodEnd: data.periodEnd,
      status: data.status,
      currency: data.currency,
      grossSalesMinor: data.grossSalesMinor,
      refundTotalMinor: data.refundTotalMinor,
      commissionMinor: data.commissionMinor,
      commissionVatMinor: data.commissionVatMinor,
      netPayableMinor: data.netPayableMinor,
      approvedBy: null,
      approvedAt: null,
      cancelledBy: null,
      cancelledAt: null,
      notes: data.notes,
      sourceSnapshotJson: data.sourceSnapshotJson,
      lines: data.lines.create.map((line: Record<string, unknown>, index: number) => ({
        id: `line-${index}`,
        settlementApprovalId: 'settlement-approval-1',
        ...line,
      })),
    }));

    const approval = await createDraftApproval({ vendorId: 'vendor-a', notes: 'June review' });

    expect(prismaMock.settlementApproval.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          vendorId: 'vendor-a',
          status: 'DRAFT',
          grossSalesMinor: 100000,
          refundTotalMinor: 10000,
          commissionMinor: 10000,
          commissionVatMinor: 2000,
          netPayableMinor: 78000,
          lines: {
            create: [
              expect.objectContaining({
                financeLedgerEntryId: 'sale-1',
                lineType: 'SALE',
                payableImpactMinor: 88000,
                sourceSnapshotJson: expect.objectContaining({
                  storedSettlementStatus: 'PAYABLE',
                  derivedSettlementStatus: 'payable',
                  payoutStatus: 'PENDING',
                  eligibilityDecision: 'included',
                  eligibilityReason: 'Derived payable because fulfillment evidence exists.',
                  refundDetected: false,
                  refundCount: 0,
                  fulfillmentEvidencePresent: true,
                  shippingEvidencePresent: true,
                }),
              }),
              expect.objectContaining({
                financeLedgerEntryId: 'refund-1',
                lineType: 'REFUND',
                payableImpactMinor: -10000,
                sourceSnapshotJson: expect.objectContaining({
                  storedSettlementStatus: 'PARTIALLY_REFUNDED',
                  derivedSettlementStatus: 'partially_refunded',
                  eligibilityReason: 'Derived partially refunded because refund records exist.',
                }),
              }),
            ],
          },
        }),
        include: {
          lines: true,
        },
      }),
    );
    expect(approval).toMatchObject({
      id: 'settlement-approval-1',
      writesPerformed: true,
      status: 'draft',
      grossSalesMinor: 100000,
      netPayableMinor: 78000,
    });
    expect(prismaMock.payoutBatch.create).not.toHaveBeenCalled();
    expect(prismaMock.invoiceExecution.create).not.toHaveBeenCalled();
  });

  it('approves only draft approvals without invoice or payout execution', async () => {
    prismaMock.settlementApproval.findUnique.mockResolvedValue(buildApproval({ id: 'approval-1', status: 'DRAFT' }));
    prismaMock.settlementApproval.update.mockResolvedValue(buildApproval({ id: 'approval-1', status: 'APPROVED' }));

    const approval = await approveSettlementApproval('approval-1', 'admin-1');

    expect(prismaMock.settlementApproval.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'approval-1' },
        data: expect.objectContaining({
          status: 'APPROVED',
          approvedBy: 'admin-1',
        }),
      }),
    );
    expect(approval.status).toBe('approved');
    expect(prismaMock.payoutBatch.create).not.toHaveBeenCalled();
    expect(prismaMock.invoiceExecution.create).not.toHaveBeenCalled();
  });

  it('rejects approval when approval is not draft', async () => {
    prismaMock.settlementApproval.findUnique.mockResolvedValue(buildApproval({ id: 'approval-1', status: 'APPROVED' }));

    await expect(approveSettlementApproval('approval-1', 'admin-1')).rejects.toThrow(
      'Only draft settlement approvals can be approved.',
    );
    expect(prismaMock.settlementApproval.update).not.toHaveBeenCalled();
  });

  it('cancels active approvals so rows are released from future previews', async () => {
    prismaMock.settlementApproval.findUnique.mockResolvedValue(buildApproval({ id: 'approval-1', status: 'APPROVED' }));
    prismaMock.settlementApproval.update.mockResolvedValue(buildApproval({ id: 'approval-1', status: 'CANCELLED' }));

    const cancelled = await cancelSettlementApproval('approval-1', 'admin-2');

    expect(cancelled.status).toBe('cancelled');
    expect(prismaMock.settlementApproval.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'CANCELLED',
          cancelledBy: 'admin-2',
        }),
      }),
    );
  });

  it.each([
    ['DRAFT', 'PENDING'],
    ['APPROVED', 'PENDING'],
    ['APPROVED', 'CREATED'],
    ['APPROVED', 'FAILED'],
    ['APPROVED', 'UNKNOWN'],
  ] as const)(
    'blocks cancellation for %s settlement approvals with active %s commission invoice records',
    async (approvalStatus, invoiceStatus) => {
      prismaMock.settlementApproval.findUnique.mockResolvedValue(
        buildApproval({
          id: 'approval-1',
          status: approvalStatus,
          commissionInvoices: [{ id: 'commission-invoice-1', status: invoiceStatus }],
        }),
      );

      await expect(cancelSettlementApproval('approval-1', 'admin-2')).rejects.toThrow(
        'Settlement approval cannot be cancelled because an active commission invoice record exists.',
      );
      expect(prismaMock.settlementApproval.update).not.toHaveBeenCalled();
    },
  );

  it('allows cancellation when only cancelled commission invoice records exist', async () => {
    prismaMock.settlementApproval.findUnique.mockResolvedValue(buildApproval({ id: 'approval-1', status: 'APPROVED' }));
    prismaMock.settlementApproval.update.mockResolvedValue(buildApproval({ id: 'approval-1', status: 'CANCELLED' }));

    const cancelled = await cancelSettlementApproval('approval-1', 'admin-2');

    expect(prismaMock.settlementApproval.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          commissionInvoices: {
            where: {
              status: {
                not: 'CANCELLED',
              },
            },
            select: {
              id: true,
            },
          },
        }),
      }),
    );
    expect(cancelled.status).toBe('cancelled');
    expect(prismaMock.settlementApproval.update).toHaveBeenCalled();
  });

  it('excludes rows already linked to active approvals from new preview', async () => {
    prismaMock.financeLedgerEntry.findMany.mockResolvedValue([
      buildLedgerRow({ id: 'sale-active', entryType: 'sale', amount: 1000, activeApproval: true }),
      buildLedgerRow({ id: 'sale-free', entryType: 'sale', amount: 500 }),
    ]);

    const preview = await previewApproval('vendor-a');

    expect(preview.summary).toMatchObject({
      eligibleRowCount: 1,
      excludedActiveApprovalRowCount: 1,
      grossSalesMinor: 50000,
    });
    expect(preview.lines).toEqual([
      expect.objectContaining({
        financeLedgerEntryId: 'sale-free',
      }),
    ]);
  });

  it('captures derived partially refunded explanation when stored status differs', async () => {
    const row = buildLedgerRow({
      id: 'sale-with-refund',
      entryType: 'sale',
      amount: 120,
      fulfilled: false,
      settlementStatus: 'ACCRUING',
      refundRecords: [{ id: 'refund-1', sourceShopifyRefundId: 'rf-1', amount: 120 }],
    });

    const line = __settlementApprovalTesting.buildLine(row);

    expect(line.sourceSnapshotJson).toEqual(
      expect.objectContaining({
        storedSettlementStatus: 'ACCRUING',
        derivedSettlementStatus: 'partially_refunded',
        payoutStatus: 'PENDING',
        eligibilityDecision: 'included',
        eligibilityReason: 'Derived partially refunded because refund records exist.',
        refundDetected: true,
        refundCount: 1,
        fulfillmentEvidencePresent: false,
        shippingEvidencePresent: false,
      }),
    );
  });

  it('explains excluded active approval and hold rows without changing eligibility math', async () => {
    const activeApprovalExplanation = __settlementApprovalTesting.buildSettlementEligibilityExplanation(
      buildLedgerRow({ id: 'sale-active', entryType: 'sale', amount: 1000, activeApproval: true }),
    );
    const holdExplanation = __settlementApprovalTesting.buildSettlementEligibilityExplanation(
      buildLedgerRow({ id: 'sale-hold', entryType: 'sale', amount: 1000, payoutStatus: 'HOLD' }),
    );

    expect(activeApprovalExplanation).toMatchObject({
      eligibilityDecision: 'excluded',
      eligibilityReason: 'Excluded because row already belongs to active settlement approval.',
    });
    expect(holdExplanation).toMatchObject({
      derivedSettlementStatus: 'held',
      eligibilityDecision: 'excluded',
      eligibilityReason: 'Excluded because payout status is HOLD.',
    });
  });

  it('returns audit lines from stored source snapshot explanations', async () => {
    prismaMock.settlementApproval.findUnique.mockResolvedValue({
      ...buildApproval({ id: 'approval-1', status: 'DRAFT' }),
      lines: [
        {
          id: 'line-1',
          settlementApprovalId: 'approval-1',
          financeLedgerEntryId: 'sale-1',
          lineType: 'SALE',
          amountMinor: 100000,
          commissionMinor: 10000,
          commissionVatMinor: 2000,
          payableImpactMinor: 88000,
          sourceSnapshotJson: {
            storedSettlementStatus: 'ACCRUING',
            derivedSettlementStatus: 'partially_refunded',
            payoutStatus: 'PENDING',
            eligibilityDecision: 'included',
            eligibilityReason: 'Derived partially refunded because refund records exist.',
            refundDetected: true,
            refundCount: 1,
            fulfillmentEvidencePresent: false,
            shippingEvidencePresent: false,
          },
        },
      ],
    });

    const audit = await getSettlementApprovalAudit('approval-1');

    expect(audit).toEqual({
      approvalId: 'approval-1',
      status: 'draft',
      totals: {
        grossSalesMinor: 100000,
        refundTotalMinor: 10000,
        commissionMinor: 10000,
        commissionVatMinor: 2000,
        netPayableMinor: 78000,
        currency: 'TRY',
      },
      lines: [
        {
          financeLedgerEntryId: 'sale-1',
          storedSettlementStatus: 'ACCRUING',
          derivedSettlementStatus: 'partially_refunded',
          payoutStatus: 'PENDING',
          eligibilityDecision: 'included',
          eligibilityReason: 'Derived partially refunded because refund records exist.',
        },
      ],
    });
    expect(prismaMock.payoutBatch.create).not.toHaveBeenCalled();
    expect(prismaMock.invoiceExecution.create).not.toHaveBeenCalled();
  });
});
