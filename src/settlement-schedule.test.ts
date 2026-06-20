import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  vendorFinancialProfile: {
    findMany: vi.fn(),
  },
  settlementApproval: {
    findFirst: vi.fn(),
  },
}));

const previewApprovalMock = vi.hoisted(() => vi.fn());
const createDraftApprovalMock = vi.hoisted(() => vi.fn());

vi.mock('../backend/src/db/prisma.js', () => ({
  prisma: prismaMock,
}));

vi.mock('../backend/src/modules/finance/settlement-approval.service.js', () => ({
  previewApproval: previewApprovalMock,
  createDraftApproval: createDraftApprovalMock,
}));

const {
  createSettlementScheduleDrafts,
  evaluateSettlementScheduleDue,
  getSettlementScheduleDryRun,
  toSettlementRunDate,
} = await import('../backend/src/modules/finance/settlement-schedule.service.js');

function profileRow(overrides: Record<string, unknown> = {}) {
  return {
    vendorId: 'yalispor',
    settlementDelayDays: 21,
    settlementFrequencyType: 'WEEKLY',
    weeklySettlementDay: 'WEDNESDAY',
    autoSettlementDraftEnabled: true,
    autoSettlementApproveEnabled: false,
    autoSettlementInvoiceEnabled: false,
    vendor: {
      name: 'Yali Spor',
    },
    ...overrides,
  };
}

function preview(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    writesPerformed: false,
    vendorId: 'yalispor',
    periodStart: null,
    periodEnd: '2026-01-21T23:59:59.999Z',
    candidateScope: 'date_range',
    candidateSelectionSummary: {
      requestedOrders: [],
      matchedOrders: [],
      unmatchedOrders: [],
      requestedAllocations: [],
      matchedAllocations: [],
      unmatchedAllocations: [],
      candidateRowCount: 2,
    },
    selectedOrderDiagnostics: [],
    summary: {
      grossSalesMinor: 100000,
      refundTotalMinor: 0,
      commissionMinor: 10000,
      commissionVatMinor: 2000,
      netPayableMinor: 88000,
      currency: 'TRY',
      eligibleRowCount: 2,
      excludedActiveApprovalRowCount: 0,
      detectedCommissionRates: [10],
      detectedCommissionVatRates: [20],
      detectedShippingModes: ['DISABLED'],
      detectedFinancialProfileSnapshotIds: ['profile-1'],
      mixedCommissionRate: false,
      mixedCommissionVatRate: false,
      mixedShippingMode: false,
      candidateQualityWarnings: [],
      outstandingVendorDebtMinor: 0,
      debtOffsetPreviewMinor: 0,
      netPayableAfterDebtOffsetMinor: 88000,
      remainingVendorDebtMinor: 0,
      pendingRefundAdjustmentCount: 0,
      pendingRefundAdjustmentTotalMinor: 0,
      netAfterPendingRefundAdjustmentsMinor: 88000,
    },
    pendingRefundAdjustments: {
      ok: true,
      writesPerformed: false,
      vendorId: 'yalispor',
      pendingAdjustmentCount: 0,
      pendingAdjustmentTotalMinor: 0,
      currencyCode: 'TRY',
      currentCandidateNetPayableMinor: 88000,
      netAfterPendingRefundAdjustmentsMinor: 88000,
      records: [],
      notes: [],
    },
    lines: [{ financeLedgerEntryId: 'ledger-1' }, { financeLedgerEntryId: 'ledger-2' }],
    ...overrides,
  };
}

describe('settlement schedule service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.vendorFinancialProfile.findMany.mockResolvedValue([profileRow()]);
    prismaMock.settlementApproval.findFirst.mockResolvedValue(null);
    previewApprovalMock.mockResolvedValue(preview());
    createDraftApprovalMock.mockResolvedValue({
      ok: true,
      writesPerformed: true,
      id: 'approval-1',
      status: 'draft',
      lines: [{ id: 'line-1' }, { id: 'line-2' }],
      netPayableMinor: 88000,
    });
  });

  it('detects weekly schedule due only on configured weekday', () => {
    const schedule = {
      settlementDelayDays: 21,
      settlementFrequencyType: 'WEEKLY' as const,
      weeklySettlementDay: 'WEDNESDAY' as const,
      autoSettlementDraftEnabled: true,
      autoSettlementApproveEnabled: false,
      autoSettlementInvoiceEnabled: false,
    };

    expect(evaluateSettlementScheduleDue(schedule, toSettlementRunDate('2026-01-21')).due).toBe(true);
    expect(evaluateSettlementScheduleDue(schedule, toSettlementRunDate('2026-01-22')).due).toBe(false);
  });

  it('detects biweekly schedule by configured weekday and deterministic ISO week parity', () => {
    const schedule = {
      settlementDelayDays: 14,
      settlementFrequencyType: 'BIWEEKLY' as const,
      weeklySettlementDay: 'WEDNESDAY' as const,
      autoSettlementDraftEnabled: true,
      autoSettlementApproveEnabled: false,
      autoSettlementInvoiceEnabled: false,
    };

    expect(evaluateSettlementScheduleDue(schedule, toSettlementRunDate('2026-01-21')).due).toBe(true);
    expect(evaluateSettlementScheduleDue(schedule, toSettlementRunDate('2026-01-28')).due).toBe(false);
  });

  it('dry-runs due vendors with date-range settlement preview as of the run date', async () => {
    const result = await getSettlementScheduleDryRun({ runDate: '2026-01-21', vendorId: 'yalispor' });

    expect(result.writesPerformed).toBe(false);
    expect(result.summary).toEqual(expect.objectContaining({
      vendorsChecked: 1,
      dueVendors: 1,
      autoDraftEligibleVendors: 1,
      totalEligibleLineCount: 2,
    }));
    expect(result.vendors[0]).toEqual(expect.objectContaining({
      vendorId: 'yalispor',
      due: true,
      state: 'READY',
      scheduledCycleKey: 'scheduled-settlement:yalispor:2026-01-21',
      existingSettlementApprovalId: null,
      existingSettlementApprovalStatus: null,
      canCreateDraft: true,
      eligibleLineCount: 2,
      netPayableMinor: 88000,
    }));
    expect(previewApprovalMock).toHaveBeenCalledWith(
      'yalispor',
      null,
      new Date('2026-01-21T23:59:59.999Z'),
      {
        candidateScope: 'date_range',
        asOfDate: new Date('2026-01-21T23:59:59.999Z'),
      },
    );
  });

  it('dry-run detects existing DRAFT scheduled approval for the same vendor run date', async () => {
    prismaMock.settlementApproval.findFirst.mockResolvedValue({
      id: 'approval-existing-draft',
      status: 'DRAFT',
    });

    const result = await getSettlementScheduleDryRun({ runDate: '2026-01-21', vendorId: 'yalispor' });

    expect(result.summary.autoDraftEligibleVendors).toBe(0);
    expect(result.vendors[0]).toEqual(expect.objectContaining({
      state: 'DRAFT_EXISTS',
      canCreateDraft: false,
      existingSettlementApprovalId: 'approval-existing-draft',
      existingSettlementApprovalStatus: 'draft',
      blockedReason: 'Scheduled settlement cycle already has an approval.',
    }));
  });

  it('dry-run detects existing APPROVED scheduled approval and blocks late rows for the same run date', async () => {
    prismaMock.settlementApproval.findFirst.mockResolvedValue({
      id: 'approval-existing-approved',
      status: 'APPROVED',
    });

    const result = await getSettlementScheduleDryRun({ runDate: '2026-01-21', vendorId: 'yalispor' });

    expect(result.summary.autoDraftEligibleVendors).toBe(0);
    expect(result.vendors[0]).toEqual(expect.objectContaining({
      state: 'SETTLEMENT_EXISTS',
      canCreateDraft: false,
      eligibleLineCount: 2,
      existingSettlementApprovalId: 'approval-existing-approved',
      existingSettlementApprovalStatus: 'approved',
    }));
  });

  it('ignores cancelled scheduled approvals for cycle blocking', async () => {
    prismaMock.settlementApproval.findFirst.mockResolvedValue(null);

    const result = await getSettlementScheduleDryRun({ runDate: '2026-01-21', vendorId: 'yalispor' });

    expect(prismaMock.settlementApproval.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: {
          not: 'CANCELLED',
        },
      }),
    }));
    expect(result.vendors[0].state).toBe('READY');
  });

  it('does not preview vendors that are not due', async () => {
    prismaMock.vendorFinancialProfile.findMany.mockResolvedValue([profileRow({ weeklySettlementDay: 'FRIDAY' })]);

    const result = await getSettlementScheduleDryRun({ runDate: '2026-01-21' });

    expect(result.summary.dueVendors).toBe(0);
    expect(result.vendors[0].canCreateDraft).toBe(false);
    expect(result.vendors[0].blockedReason).toContain('Configured settlement weekday is FRIDAY');
    expect(previewApprovalMock).not.toHaveBeenCalled();
  });

  it('requires confirmation before creating scheduled drafts', async () => {
    await expect(createSettlementScheduleDrafts({ runDate: '2026-01-21' })).rejects.toThrow(
      'confirmAutoSettlementDrafts must be true',
    );
    expect(createDraftApprovalMock).not.toHaveBeenCalled();
  });

  it('creates draft only for due auto-draft vendors with eligible rows', async () => {
    const result = await createSettlementScheduleDrafts({
      runDate: '2026-01-21',
      confirmAutoSettlementDrafts: true,
    });

    expect(result.writesPerformed).toBe(true);
    expect(result.summary.created).toBe(1);
    expect(result.createdDrafts[0]).toEqual(expect.objectContaining({
      vendorId: 'yalispor',
      settlementApprovalId: 'approval-1',
      lineCount: 2,
    }));
    expect(createDraftApprovalMock).toHaveBeenCalledWith(expect.objectContaining({
      vendorId: 'yalispor',
      periodEnd: new Date('2026-01-21T23:59:59.999Z'),
      asOfDate: new Date('2026-01-21T23:59:59.999Z'),
      scheduledRunDate: new Date('2026-01-21T00:00:00.000Z'),
      scheduledPeriodEnd: new Date('2026-01-21T23:59:59.999Z'),
      scheduledCycleKey: 'scheduled-settlement:yalispor:2026-01-21',
      candidateScope: 'date_range',
    }));
  });

  it('skips create-drafts when the scheduled cycle already has an approved settlement', async () => {
    prismaMock.settlementApproval.findFirst.mockResolvedValue({
      id: 'approval-existing-approved',
      status: 'APPROVED',
    });

    const result = await createSettlementScheduleDrafts({
      runDate: '2026-01-21',
      confirmAutoSettlementDrafts: true,
    });

    expect(result.writesPerformed).toBe(false);
    expect(result.summary.created).toBe(0);
    expect(result.skipped[0]).toEqual({
      vendorId: 'yalispor',
      reason: 'Scheduled settlement cycle already has an approval.',
    });
    expect(createDraftApprovalMock).not.toHaveBeenCalled();
  });

  it('skips adjustment-only previews and surfaces the existing settlement blocker', async () => {
    previewApprovalMock.mockResolvedValue(preview({
      summary: {
        ...preview().summary,
        eligibleRowCount: 0,
        netPayableMinor: 0,
        pendingRefundAdjustmentCount: 4,
        pendingRefundAdjustmentTotalMinor: 972654,
        netAfterPendingRefundAdjustmentsMinor: -972654,
      },
      lines: [],
    }));

    const result = await createSettlementScheduleDrafts({
      runDate: '2026-01-21',
      confirmAutoSettlementDrafts: true,
    });

    expect(result.writesPerformed).toBe(false);
    expect(result.summary.created).toBe(0);
    expect(result.skipped[0]).toEqual({
      vendorId: 'yalispor',
      reason: 'Adjustment-only settlement drafts are not supported yet.',
    });
    expect(createDraftApprovalMock).not.toHaveBeenCalled();
  });
});
