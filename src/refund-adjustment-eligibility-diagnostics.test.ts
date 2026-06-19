import { describe, expect, it, vi } from 'vitest';
import {
  backfillPendingRefundAdjustments,
  classifyRefundAdjustmentEligibility,
  previewPendingRefundAdjustmentApplication,
  previewRefundAdjustmentEligibility,
} from '../backend/src/modules/finance/settlement-refund-adjustment-eligibility-diagnostics.service.js';

function refundLedgerRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'fin-yalispor-refund-1001',
    vendorId: 'yalispor',
    entryType: 'refund',
    amount: 1000,
    createdAt: new Date('2026-06-19T10:00:00.000Z'),
    commissionPercentSnapshot: 10,
    commissionVatPercentSnapshot: 20,
    refundAdjustments: [],
    vendorBalanceEvents: [],
    vendorAllocation: {
      id: 'allocation-1',
      sourceShopifyOrderId: '1086',
      sourceShopifyOrderNumber: '#1086',
      order: {
        id: 'order-1086',
        currency: 'TRY',
      },
      refundRecords: [
        {
          id: 'refund-record-1001',
          sourceShopifyRefundId: '1001',
        },
      ],
      financeEntries: [
        {
          id: 'sale-ledger-1',
          entryType: 'sale',
          payoutStatus: 'PENDING',
          settlementStatus: 'PAYABLE',
          commissionPercentSnapshot: 10,
          commissionVatPercentSnapshot: 20,
          settlementApprovalLines: [
            {
              id: 'settlement-line-1',
              settlementApproval: {
                id: 'settlement-approval-1',
                status: 'APPROVED',
                approvedAt: new Date('2026-06-18T10:00:00.000Z'),
                commissionInvoices: [
                  {
                    id: 'commission-invoice-1',
                    status: 'CREATED',
                    createdAt: new Date('2026-06-18T11:00:00.000Z'),
                  },
                ],
              },
            },
          ],
        },
      ],
    },
    ...overrides,
  } as any;
}

describe('refund adjustment eligibility diagnostics', () => {
  it('marks eligible refund after approved settlement as CREATE_PENDING_ADJUSTMENT', () => {
    const result = classifyRefundAdjustmentEligibility(refundLedgerRow());

    expect(result.recommendedAction).toBe('CREATE_PENDING_ADJUSTMENT');
    expect(result.refundFinanceLedgerEntryId).toBe('fin-yalispor-refund-1001');
    expect(result.refundRecordId).toBe('refund-record-1001');
    expect(result.amountMinor).toBe(100000);
    expect(result.evidence).toEqual(expect.objectContaining({
      relatedSaleFinanceLedgerEntryId: 'sale-ledger-1',
      settlementApprovalLineId: 'settlement-line-1',
      settlementApprovalId: 'settlement-approval-1',
      settlementApprovalStatus: 'APPROVED',
      settlementCommissionInvoiceId: 'commission-invoice-1',
      settlementCommissionInvoiceStatus: 'CREATED',
    }));
  });

  it('returns ALREADY_HAS_ADJUSTMENT when one already exists', () => {
    const result = classifyRefundAdjustmentEligibility(refundLedgerRow({
      refundAdjustments: [{ id: 'adjustment-1', status: 'PENDING' }],
    }));

    expect(result.recommendedAction).toBe('ALREADY_HAS_ADJUSTMENT');
    expect(result.existingAdjustmentId).toBe('adjustment-1');
  });

  it('returns VENDOR_DEBT_REQUIRED after paid sale', () => {
    const row = refundLedgerRow();
    row.vendorAllocation.financeEntries[0].payoutStatus = 'PAID';
    row.vendorBalanceEvents = [{
      id: 'vendor-debt-event-1',
      type: 'VENDOR_DEBT_CREATED',
      createdAt: new Date('2026-06-19T11:00:00.000Z'),
    }];

    const result = classifyRefundAdjustmentEligibility(row);

    expect(result.recommendedAction).toBe('VENDOR_DEBT_REQUIRED');
    expect(result.evidence.vendorDebtEventId).toBe('vendor-debt-event-1');
  });

  it('returns VENDOR_DEBT_REQUIRED after settled sale', () => {
    const row = refundLedgerRow();
    row.vendorAllocation.financeEntries[0].settlementStatus = 'SETTLED';

    expect(classifyRefundAdjustmentEligibility(row).recommendedAction).toBe('VENDOR_DEBT_REQUIRED');
  });

  it('returns ZERO_OR_INVALID_AMOUNT for zero, negative, or invalid refund adjustment amounts', () => {
    expect(classifyRefundAdjustmentEligibility(refundLedgerRow({ amount: 0 })).recommendedAction)
      .toBe('ZERO_OR_INVALID_AMOUNT');
    expect(classifyRefundAdjustmentEligibility(refundLedgerRow({ amount: -10 })).recommendedAction)
      .toBe('ZERO_OR_INVALID_AMOUNT');
    expect(classifyRefundAdjustmentEligibility(refundLedgerRow({ amount: 'not-a-number' })).recommendedAction)
      .toBe('ZERO_OR_INVALID_AMOUNT');
  });

  it('returns MISSING_RELATED_SALE_LEDGER when allocation has no sale ledger', () => {
    const row = refundLedgerRow();
    row.vendorAllocation.financeEntries = [];

    const result = classifyRefundAdjustmentEligibility(row);

    expect(result.recommendedAction).toBe('MISSING_RELATED_SALE_LEDGER');
    expect(result.blockerReason).toContain('no related sale ledger');
  });

  it('returns MISSING_APPROVED_SETTLEMENT_LINE when sale is not approved in settlement', () => {
    const row = refundLedgerRow();
    row.vendorAllocation.financeEntries[0].settlementApprovalLines = [];

    const result = classifyRefundAdjustmentEligibility(row);

    expect(result.recommendedAction).toBe('MISSING_APPROVED_SETTLEMENT_LINE');
    expect(result.blockerReason).toContain('no approved settlement approval line');
  });

  it('returns write-free preview with summary counts and safe evidence only', async () => {
    const rows = [
      refundLedgerRow(),
      refundLedgerRow({
        id: 'fin-yalispor-refund-1002',
        refundAdjustments: [{ id: 'adjustment-2', status: 'PENDING' }],
      }),
      (() => {
        const row = refundLedgerRow({ id: 'fin-yalispor-refund-1003' });
        row.vendorAllocation.financeEntries[0].payoutStatus = 'PAID';
        return row;
      })(),
    ];
    const db = {
      financeLedgerEntry: {
        findMany: vi.fn().mockResolvedValue(rows),
      },
    };

    const result = await previewRefundAdjustmentEligibility({ db: db as never });

    expect(result.writesPerformed).toBe(false);
    expect(result.summary).toEqual(expect.objectContaining({
      totalRefundLedgers: 3,
      createPendingAdjustment: 1,
      alreadyHasAdjustment: 1,
      vendorDebtRequired: 1,
    }));
    expect(db.financeLedgerEntry.findMany).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain('rawPayload');
    expect(JSON.stringify(result)).not.toContain('requestSnapshotJson');
    expect(JSON.stringify(result)).not.toContain('responseSnapshotJson');
  });

  it('filters by recommended action after classification', async () => {
    const db = {
      financeLedgerEntry: {
        findMany: vi.fn().mockResolvedValue([
          refundLedgerRow(),
          refundLedgerRow({
            id: 'fin-yalispor-refund-1002',
            refundAdjustments: [{ id: 'adjustment-2', status: 'PENDING' }],
          }),
        ]),
      },
    };

    const result = await previewRefundAdjustmentEligibility({
      db: db as never,
      recommendedAction: 'CREATE_PENDING_ADJUSTMENT',
    });

    expect(result.records).toHaveLength(1);
    expect(result.records[0].recommendedAction).toBe('CREATE_PENDING_ADJUSTMENT');
    expect(result.summary.createPendingAdjustment).toBe(1);
    expect(result.summary.alreadyHasAdjustment).toBe(0);
  });

  it('keeps multiple refunds for the same order separate by refund ledger id', async () => {
    const first = refundLedgerRow({
      id: 'fin-yalispor-refund-1001',
      amount: 1000,
    });
    const second = refundLedgerRow({
      id: 'fin-yalispor-refund-1002',
      amount: 500,
      vendorAllocation: {
        ...refundLedgerRow().vendorAllocation,
        refundRecords: [
          {
            id: 'refund-record-1002',
            sourceShopifyRefundId: '1002',
          },
        ],
      },
    });
    const db = {
      financeLedgerEntry: {
        findMany: vi.fn().mockResolvedValue([first, second]),
      },
    };

    const result = await previewRefundAdjustmentEligibility({ db: db as never });

    expect(result.summary.createPendingAdjustment).toBe(2);
    expect(result.records.map((record) => record.refundFinanceLedgerEntryId)).toEqual([
      'fin-yalispor-refund-1001',
      'fin-yalispor-refund-1002',
    ]);
    expect(result.records.map((record) => record.refundRecordId)).toEqual([
      'refund-record-1001',
      'refund-record-1002',
    ]);
  });

  it('backfills only CREATE_PENDING_ADJUSTMENT rows with pending adjustment records', async () => {
    const findManyRows = [
      refundLedgerRow(),
      (() => {
        const row = refundLedgerRow({ id: 'fin-yalispor-refund-1002' });
        row.vendorAllocation.financeEntries[0].payoutStatus = 'PAID';
        return row;
      })(),
    ];
    const adjustmentRow = {
      id: 'adjustment-1',
      refundRecordId: 'refund-record-1001',
      refundFinanceLedgerEntryId: 'fin-yalispor-refund-1001',
      vendorId: 'yalispor',
      originalOrderId: 'order-1086',
      originalSettlementApprovalId: 'settlement-approval-1',
      originalSettlementApprovalLineId: 'settlement-line-1',
      originalSettlementCommissionInvoiceId: 'commission-invoice-1',
      status: 'PENDING',
      amountMinor: 88000,
      currencyCode: 'TRY',
      reason: 'Refund after invoiced settlement requires future settlement adjustment.',
      createdAt: new Date('2026-06-19T12:00:00.000Z'),
      updatedAt: new Date('2026-06-19T12:00:00.000Z'),
      appliedSettlementApprovalId: null,
      appliedSettlementApprovalLineId: null,
      blockedReason: null,
      createdBy: 'admin-user',
    };
    const tx = {
      financeLedgerEntry: {
        findUnique: vi.fn().mockResolvedValue(refundLedgerRow()),
      },
      settlementRefundAdjustment: {
        upsert: vi.fn().mockResolvedValue(adjustmentRow),
      },
    };
    const db = {
      financeLedgerEntry: {
        findMany: vi.fn().mockResolvedValue(findManyRows),
      },
      settlementRefundAdjustment: tx.settlementRefundAdjustment,
      $transaction: vi.fn((callback) => callback(tx)),
    };

    const result = await backfillPendingRefundAdjustments({
      db: db as never,
      createdBy: 'admin-user',
    });

    expect(result.writesPerformed).toBe(true);
    expect(result.summary).toEqual({
      eligible: 1,
      created: 1,
      alreadyExisting: 0,
      skipped: 1,
      failed: 0,
    });
    expect(result.createdRecords).toEqual([
      {
        id: 'adjustment-1',
        refundFinanceLedgerEntryId: 'fin-yalispor-refund-1001',
        refundRecordId: 'refund-record-1001',
        vendorId: 'yalispor',
        status: 'pending',
      },
    ]);
    expect(tx.settlementRefundAdjustment.upsert).toHaveBeenCalledTimes(1);
    expect(tx.settlementRefundAdjustment.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        status: 'PENDING',
        refundFinanceLedgerEntryId: 'fin-yalispor-refund-1001',
      }),
    }));
  });

  it('reports already existing adjustments without creating new rows', async () => {
    const db = {
      financeLedgerEntry: {
        findMany: vi.fn().mockResolvedValue([
          refundLedgerRow({
            refundAdjustments: [{ id: 'adjustment-2', status: 'PENDING' }],
          }),
        ]),
      },
      settlementRefundAdjustment: {
        upsert: vi.fn(),
      },
      $transaction: vi.fn(),
    };

    const result = await backfillPendingRefundAdjustments({ db: db as never });

    expect(result.writesPerformed).toBe(false);
    expect(result.summary).toEqual({
      eligible: 0,
      created: 0,
      alreadyExisting: 1,
      skipped: 1,
      failed: 0,
    });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('returns writesPerformed false when no eligible records exist', async () => {
    const row = refundLedgerRow();
    row.vendorAllocation.financeEntries = [];
    const db = {
      financeLedgerEntry: {
        findMany: vi.fn().mockResolvedValue([row]),
      },
      settlementRefundAdjustment: {
        upsert: vi.fn(),
      },
      $transaction: vi.fn(),
    };

    const result = await backfillPendingRefundAdjustments({ db: db as never });

    expect(result.writesPerformed).toBe(false);
    expect(result.summary.created).toBe(0);
    expect(result.summary.skipped).toBe(1);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('previews pending adjustment application without writing or changing settlement totals', async () => {
    const db = {
      settlementRefundAdjustment: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'adjustment-1',
            originalOrderId: 'order-1086',
            refundRecordId: 'refund-record-1001',
            refundFinanceLedgerEntryId: 'fin-yalispor-refund-1001',
            originalSettlementApprovalId: 'settlement-approval-1',
            originalSettlementCommissionInvoiceId: 'commission-invoice-1',
            amountMinor: 88000,
            originalAmountMinor: 88000,
            appliedAmountMinor: 0,
            remainingAmountMinor: 88000,
            status: 'PENDING',
            currencyCode: 'TRY',
            reason: 'Refund after invoiced settlement requires future settlement adjustment.',
          },
          {
            id: 'adjustment-2',
            originalOrderId: 'order-1087',
            refundRecordId: 'refund-record-1002',
            refundFinanceLedgerEntryId: 'fin-yalispor-refund-1002',
            originalSettlementApprovalId: null,
            originalSettlementCommissionInvoiceId: null,
            amountMinor: 12000,
            originalAmountMinor: 20000,
            appliedAmountMinor: 8000,
            remainingAmountMinor: 12000,
            status: 'PARTIALLY_APPLIED',
            currencyCode: 'TRY',
            reason: 'Refund after approved settlement requires future settlement adjustment.',
          },
        ]),
      },
    };

    const result = await previewPendingRefundAdjustmentApplication({
      db: db as never,
      vendorId: 'yalispor',
      currencyCode: 'TRY',
      currentCandidateNetPayableMinor: 150000,
    });

    expect(result.writesPerformed).toBe(false);
    expect(result.pendingAdjustmentCount).toBe(2);
    expect(result.pendingAdjustmentTotalMinor).toBe(100000);
    expect(result.netAfterPendingRefundAdjustmentsMinor).toBe(50000);
    expect(result.records[0]).toEqual(expect.objectContaining({
      adjustmentId: 'adjustment-1',
      previewImpactMinor: 88000,
      originalSettlementCommissionInvoiceId: 'commission-invoice-1',
    }));
    expect(db.settlementRefundAdjustment.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        vendorId: 'yalispor',
        status: {
          in: ['PENDING', 'PARTIALLY_APPLIED'],
        },
        remainingAmountMinor: { gt: 0 },
        currencyCode: 'TRY',
      }),
    }));
    expect(JSON.stringify(result)).not.toContain('requestSnapshotJson');
    expect(JSON.stringify(result)).not.toContain('responseSnapshotJson');
  });

  it('reports application preview exclusions for currency mismatch and terminal statuses', async () => {
    const db = {
      settlementRefundAdjustment: {
        findMany: vi.fn()
          .mockResolvedValueOnce([
            {
              id: 'adjustment-try',
              originalOrderId: 'order-1086',
              refundRecordId: 'refund-record-1001',
              refundFinanceLedgerEntryId: 'fin-yalispor-refund-1001',
              originalSettlementApprovalId: null,
              originalSettlementCommissionInvoiceId: null,
              amountMinor: 10000,
              originalAmountMinor: 10000,
              appliedAmountMinor: 0,
              remainingAmountMinor: 10000,
              status: 'PENDING',
              currencyCode: 'TRY',
              reason: 'Eligible adjustment.',
            },
          ])
          .mockResolvedValueOnce([
            { status: 'PENDING', amountMinor: 10000, remainingAmountMinor: 10000, currencyCode: 'TRY' },
            { status: 'PENDING', amountMinor: 10000, remainingAmountMinor: 10000, currencyCode: 'USD' },
            { status: 'PENDING', amountMinor: 0, remainingAmountMinor: 0, currencyCode: 'TRY' },
            { status: 'APPLIED', amountMinor: 10000, remainingAmountMinor: 0, currencyCode: 'TRY' },
            { status: 'BLOCKED', amountMinor: 10000, remainingAmountMinor: 10000, currencyCode: 'TRY' },
            { status: 'CANCELLED', amountMinor: 10000, remainingAmountMinor: 10000, currencyCode: 'TRY' },
            { status: 'PARTIALLY_APPLIED', amountMinor: 20000, remainingAmountMinor: 5000, currencyCode: 'TRY' },
          ]),
      },
    };

    const result = await previewPendingRefundAdjustmentApplication({
      db: db as never,
      vendorId: 'yalispor',
      currencyCode: 'TRY',
    });

    expect(result.diagnosticExclusions).toEqual({
      eligiblePending: 1,
      partiallyApplied: 1,
      currencyMismatch: 1,
      zeroOrInvalidAmount: 1,
      alreadyApplied: 1,
      blocked: 1,
      cancelled: 1,
    });
    expect(result.notes).toEqual(expect.arrayContaining([
      'Currency mismatches are excluded; Sporgym does not convert adjustment currencies.',
      'Already applied, blocked, cancelled, and zero-remaining adjustments are excluded from settlement draft application.',
    ]));
  });

  it('uses pending-positive vendor and currency filters for adjustment application preview', async () => {
    const db = {
      settlementRefundAdjustment: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };

    const result = await previewPendingRefundAdjustmentApplication({
      db: db as never,
      vendorId: 'sporjinal',
      currencyCode: 'TRY',
      currentCandidateNetPayableMinor: 0,
      limit: 25,
    });

    expect(result.pendingAdjustmentCount).toBe(0);
    expect(result.pendingAdjustmentTotalMinor).toBe(0);
    expect(result.netAfterPendingRefundAdjustmentsMinor).toBe(0);
    expect(db.settlementRefundAdjustment.findMany).toHaveBeenCalledWith(expect.objectContaining({
      take: 25,
      where: {
        vendorId: 'sporjinal',
        status: {
          in: ['PENDING', 'PARTIALLY_APPLIED'],
        },
        remainingAmountMinor: { gt: 0 },
        currencyCode: 'TRY',
      },
    }));
  });
});
