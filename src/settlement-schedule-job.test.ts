import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  settlementApproval: { findMany: vi.fn() },
  settlementScheduleJobRun: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
}));

const dryRunMock = vi.hoisted(() => vi.fn());
const createDraftsMock = vi.hoisted(() => vi.fn());

vi.mock('../backend/src/db/prisma.js', () => ({
  prisma: prismaMock,
}));

vi.mock('../backend/src/modules/finance/settlement-schedule.service.js', () => ({
  buildScheduledSettlementCycleKey: (vendorId: string, date: Date) => `scheduled-settlement:${vendorId}:${date.toISOString().slice(0, 10)}`,
  getSettlementScheduleDryRun: dryRunMock,
  createSettlementScheduleDrafts: createDraftsMock,
  toSettlementRunDate: (value?: string | Date | null) => {
    if (value instanceof Date) {
      return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
    }
    const raw = value || '2026-06-24';
    const [year, month, day] = String(raw).slice(0, 10).split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day));
  },
  toSettlementRunDateKey: (date: Date) => date.toISOString().slice(0, 10),
}));

const {
  getSettlementScheduleAutoDraftJobStatus,
  runSettlementScheduleAutoDraftJob,
} = await import('../backend/src/modules/finance/settlement-schedule-job.service.js');

const envDisabled = {
  SETTLEMENT_AUTO_DRAFT_JOB_ENABLED: false,
  SETTLEMENT_AUTO_DRAFT_JOB_DRY_RUN: true,
};

const envDryRun = {
  SETTLEMENT_AUTO_DRAFT_JOB_ENABLED: true,
  SETTLEMENT_AUTO_DRAFT_JOB_DRY_RUN: true,
};

const envWrite = {
  SETTLEMENT_AUTO_DRAFT_JOB_ENABLED: true,
  SETTLEMENT_AUTO_DRAFT_JOB_DRY_RUN: false,
};

function dryRunResponse(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    writesPerformed: false,
    runDate: '2026-06-24',
    periodEnd: '2026-06-24T23:59:59.999Z',
    summary: {
      vendorsChecked: 3,
      dueVendors: 2,
      autoDraftEligibleVendors: 1,
      totalEligibleLineCount: 2,
      totalNetPayableMinor: 88000,
    },
    vendors: [
      {
        vendorId: 'ready-vendor',
        vendorName: 'Ready Vendor',
        due: true,
        dueReason: 'Weekly WEDNESDAY run is due.',
        schedule: {
          settlementDelayDays: 21,
          settlementFrequencyType: 'WEEKLY',
          weeklySettlementDay: 'WEDNESDAY',
          autoSettlementDraftEnabled: true,
          autoSettlementApproveEnabled: false,
          autoSettlementInvoiceEnabled: false,
        },
        eligibleLineCount: 2,
        excludedActiveApprovalRowCount: 0,
        netPayableMinor: 88000,
        pendingRefundAdjustmentCount: 0,
        pendingRefundAdjustmentTotalMinor: 0,
        netAfterPendingRefundAdjustmentsMinor: 88000,
        canCreateDraft: true,
        blockedReason: null,
        warnings: [],
      },
      {
        vendorId: 'not-due-vendor',
        vendorName: 'Not Due Vendor',
        due: false,
        dueReason: 'Configured settlement weekday is FRIDAY; run date is WEDNESDAY.',
        schedule: {
          settlementDelayDays: 21,
          settlementFrequencyType: 'WEEKLY',
          weeklySettlementDay: 'FRIDAY',
          autoSettlementDraftEnabled: true,
          autoSettlementApproveEnabled: false,
          autoSettlementInvoiceEnabled: false,
        },
        eligibleLineCount: 0,
        excludedActiveApprovalRowCount: 0,
        netPayableMinor: 0,
        pendingRefundAdjustmentCount: 0,
        pendingRefundAdjustmentTotalMinor: 0,
        netAfterPendingRefundAdjustmentsMinor: 0,
        canCreateDraft: false,
        blockedReason: 'Configured settlement weekday is FRIDAY; run date is WEDNESDAY.',
        warnings: [],
      },
      {
        vendorId: 'disabled-vendor',
        vendorName: 'Disabled Vendor',
        due: true,
        dueReason: 'Weekly WEDNESDAY run is due.',
        schedule: {
          settlementDelayDays: 21,
          settlementFrequencyType: 'WEEKLY',
          weeklySettlementDay: 'WEDNESDAY',
          autoSettlementDraftEnabled: false,
          autoSettlementApproveEnabled: false,
          autoSettlementInvoiceEnabled: false,
        },
        eligibleLineCount: 1,
        excludedActiveApprovalRowCount: 0,
        netPayableMinor: 44000,
        pendingRefundAdjustmentCount: 0,
        pendingRefundAdjustmentTotalMinor: 0,
        netAfterPendingRefundAdjustmentsMinor: 44000,
        canCreateDraft: false,
        blockedReason: 'Auto settlement draft is disabled for this vendor.',
        warnings: [],
      },
    ],
    notes: [],
    ...overrides,
  };
}

function createResult(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    writesPerformed: true,
    runDate: '2026-06-24',
    periodEnd: '2026-06-24T23:59:59.999Z',
    summary: {
      vendorsChecked: 3,
      dueVendors: 2,
      created: 1,
      skipped: 2,
      failed: 0,
    },
    createdDrafts: [
      {
        vendorId: 'ready-vendor',
        settlementApprovalId: 'approval-ready',
        status: 'draft',
        lineCount: 2,
        netPayableMinor: 88000,
      },
    ],
    skipped: [
      { vendorId: 'not-due-vendor', reason: 'Configured settlement weekday is FRIDAY; run date is WEDNESDAY.' },
      { vendorId: 'disabled-vendor', reason: 'Auto settlement draft is disabled for this vendor.' },
    ],
    failed: [],
    dryRun: dryRunResponse(),
    ...overrides,
  };
}

describe('settlement schedule auto draft job service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dryRunMock.mockResolvedValue(dryRunResponse());
    createDraftsMock.mockResolvedValue(createResult());
    prismaMock.settlementScheduleJobRun.findFirst.mockResolvedValue(null);
    prismaMock.settlementApproval.findMany.mockResolvedValue([]);
    prismaMock.settlementScheduleJobRun.findUnique.mockResolvedValue(null);
    prismaMock.settlementScheduleJobRun.create.mockResolvedValue({
      id: 'job-run-1',
      runDate: new Date('2026-06-24T00:00:00.000Z'),
      status: 'PROCESSING',
      writesPerformed: false,
      createdDraftCount: 0,
      skippedCount: 0,
      blockedCount: 0,
      startedAt: new Date('2026-06-24T01:00:00.000Z'),
      finishedAt: null,
      metadataJson: null,
    });
    prismaMock.settlementScheduleJobRun.update.mockResolvedValue({
      id: 'job-run-1',
      runDate: new Date('2026-06-24T00:00:00.000Z'),
      status: 'COMPLETED',
      writesPerformed: true,
      createdDraftCount: 1,
      skippedCount: 2,
      blockedCount: 2,
      startedAt: new Date('2026-06-24T01:00:00.000Z'),
      finishedAt: new Date('2026-06-24T01:01:00.000Z'),
      metadataJson: null,
    });
  });

  it('reports status with env gates and latest run summary', async () => {
    prismaMock.settlementScheduleJobRun.findFirst.mockResolvedValue({
      id: 'job-run-latest',
      runDate: new Date('2026-06-24T00:00:00.000Z'),
      status: 'COMPLETED',
      writesPerformed: true,
      createdDraftCount: 1,
      skippedCount: 2,
      blockedCount: 1,
      startedAt: new Date('2026-06-24T01:00:00.000Z'),
      finishedAt: new Date('2026-06-24T01:01:00.000Z'),
    });

    const result = await getSettlementScheduleAutoDraftJobStatus(envWrite);

    expect(result.enabled).toBe(true);
    expect(result.dryRun).toBe(false);
    expect(result.lastRun).toEqual(expect.objectContaining({
      id: 'job-run-latest',
      runDate: '2026-06-24',
      status: 'COMPLETED',
    }));
    expect(result.evidence).toEqual(expect.objectContaining({
      settlements: [], createdClaimsAvailable: false,
    }));
    expect(prismaMock.settlementApproval.findMany).toHaveBeenCalledWith(expect.objectContaining({
      take: 101,
      where: { OR: [
        { scheduledRunDate: new Date('2026-06-24T00:00:00.000Z'), scheduledCycleKey: { not: null } },
        { id: { in: [] } },
      ] },
    }));
  });

  it.each(['COMPLETED', 'FAILED', 'PROCESSING'] as const)(
    'reconciles %s job metadata with current settlement and source-line evidence without writes', async (status) => {
      prismaMock.settlementScheduleJobRun.findFirst.mockResolvedValue({
        id: 'run-1', runDate: new Date('2026-06-24T00:00:00.000Z'), status,
        writesPerformed: true, createdDraftCount: 1, skippedCount: 0, blockedCount: status === 'FAILED' ? 1 : 0,
        startedAt: new Date('2026-06-24T01:00:00.000Z'), finishedAt: status === 'PROCESSING' ? null : new Date('2026-06-24T01:01:00.000Z'),
        metadataJson: {
          createdDrafts: [{ vendorId: 'vendor-a', settlementApprovalId: 'approval-a' }],
          ...(status === 'FAILED' ? {
            summary: { failed: 1 }, skipped: [], failed: [{ vendorId: 'vendor-b', reason: 'Write failed.' }],
          } : {}),
        },
      });
      prismaMock.settlementApproval.findMany.mockResolvedValue([{
        id: 'approval-a', vendorId: 'vendor-a', status: 'DRAFT',
        scheduledRunDate: new Date('2026-06-24T00:00:00.000Z'),
        scheduledCycleKey: 'scheduled-settlement:vendor-a:2026-06-24',
        _count: { lines: 1 },
        lines: [{ id: 'line-a', financeLedgerEntryId: 'ledger-a', lineType: 'SALE' }],
      }]);
      const result = await getSettlementScheduleAutoDraftJobStatus(envWrite);
      expect(result.lastRun?.status).toBe(status);
      expect(result.evidence?.settlements).toEqual([
        expect.objectContaining({ id: 'approval-a', status: 'DRAFT', jobProvenance: 'MATCHED_METADATA', lineCount: 1,
          sourceLines: [{ id: 'line-a', financeLedgerEntryId: 'ledger-a', lineType: 'SALE' }] }),
      ]);
      expect(result.evidence?.jobCreatedClaims).toEqual([expect.objectContaining({ evidence: 'MATCHED' })]);
      if (status === 'FAILED') {
        expect(result.evidence?.jobVendorOutcomes).toEqual([{ vendorId: 'vendor-b', state: 'FAILED', reason: 'Write failed.' }]);
        expect(result.evidence?.jobOutcomeMetadataComplete).toBe(true);
      }
      if (status === 'PROCESSING') expect(result.evidence?.notes.join(' ')).toContain('does not prove');
      expect(prismaMock.settlementScheduleJobRun.create).not.toHaveBeenCalled();
      expect(prismaMock.settlementScheduleJobRun.update).not.toHaveBeenCalled();
      expect(createDraftsMock).not.toHaveBeenCalled();
    },
  );

  it.each(['CANCELLED', 'APPROVED'] as const)('reports current %s settlement state without calling it a job result', async (status) => {
    prismaMock.settlementScheduleJobRun.findFirst.mockResolvedValue({
      id: 'run-1', runDate: new Date('2026-06-24T00:00:00.000Z'), status: 'COMPLETED',
      writesPerformed: false, createdDraftCount: 0, skippedCount: 0, blockedCount: 0,
      startedAt: new Date('2026-06-24T01:00:00.000Z'), finishedAt: new Date('2026-06-24T01:01:00.000Z'),
      metadataJson: { createdDrafts: [] },
    });
    prismaMock.settlementApproval.findMany.mockResolvedValue([{
      id: 'manual-approval', vendorId: 'vendor-b', status,
      scheduledRunDate: new Date('2026-06-24T00:00:00.000Z'),
      scheduledCycleKey: 'scheduled-settlement:vendor-b:2026-06-24',
      _count: { lines: 0 }, lines: [],
    }]);
    const result = await getSettlementScheduleAutoDraftJobStatus(envWrite);
    expect(result.evidence?.settlements).toEqual([expect.objectContaining({
      id: 'manual-approval', status, jobProvenance: 'UNKNOWN', lineCount: 0,
    })]);
  });

  it('keeps missing and contradictory job claims visible without inventing a successful settlement', async () => {
    prismaMock.settlementScheduleJobRun.findFirst.mockResolvedValue({
      id: 'run-1', runDate: new Date('2026-06-24T00:00:00.000Z'), status: 'FAILED',
      writesPerformed: false, createdDraftCount: 2, skippedCount: 0, blockedCount: 0,
      startedAt: new Date('2026-06-24T01:00:00.000Z'), finishedAt: new Date('2026-06-24T01:01:00.000Z'),
      metadataJson: { createdDrafts: [
        { vendorId: 'vendor-a', settlementApprovalId: 'missing-approval' },
        { vendorId: 'vendor-b', settlementApprovalId: 'wrong-vendor-approval' },
      ] },
    });
    prismaMock.settlementApproval.findMany.mockResolvedValue([{
      id: 'wrong-vendor-approval', vendorId: 'other-vendor', status: 'DRAFT',
      scheduledRunDate: new Date('2026-06-24T00:00:00.000Z'),
      scheduledCycleKey: 'scheduled-settlement:other-vendor:2026-06-24',
      _count: { lines: 0 }, lines: [],
    }]);
    const result = await getSettlementScheduleAutoDraftJobStatus(envWrite);
    expect(result.evidence?.jobCreatedClaims).toEqual([
      expect.objectContaining({ settlementApprovalId: 'missing-approval', evidence: 'MISSING_OR_UNLISTED' }),
      expect.objectContaining({ settlementApprovalId: 'wrong-vendor-approval', evidence: 'CONTRADICTORY' }),
    ]);
    expect(result.evidence?.settlements[0].jobProvenance).toBe('UNKNOWN');
  });

  it('marks incomplete metadata without discarding its one verifiable claim', async () => {
    prismaMock.settlementScheduleJobRun.findFirst.mockResolvedValue({
      id: 'run-1', runDate: new Date('2026-06-24T00:00:00.000Z'), status: 'COMPLETED',
      writesPerformed: true, createdDraftCount: 2, skippedCount: 0, blockedCount: 0,
      startedAt: new Date('2026-06-24T01:00:00.000Z'), finishedAt: new Date('2026-06-24T01:01:00.000Z'),
      metadataJson: { createdDrafts: [{ vendorId: 'vendor-a', settlementApprovalId: 'approval-a' }] },
    });
    prismaMock.settlementApproval.findMany.mockResolvedValue([{
      id: 'approval-a', vendorId: 'vendor-a', status: 'APPROVED',
      scheduledRunDate: new Date('2026-06-24T00:00:00.000Z'),
      scheduledCycleKey: 'scheduled-settlement:vendor-a:2026-06-24',
      _count: { lines: 0 }, lines: [],
    }]);
    const result = await getSettlementScheduleAutoDraftJobStatus(envWrite);
    expect(result.evidence?.createdClaimsAvailable).toBe(false);
    expect(result.evidence?.jobCreatedClaims).toEqual([expect.objectContaining({ evidence: 'MATCHED' })]);
    expect(result.evidence?.notes.join(' ')).toContain('incomplete');
  });

  it('does not let one vendor claim borrow another vendor’s matching approval ID', async () => {
    prismaMock.settlementScheduleJobRun.findFirst.mockResolvedValue({
      id: 'run-1', runDate: new Date('2026-06-24T00:00:00.000Z'), status: 'COMPLETED',
      writesPerformed: true, createdDraftCount: 2, skippedCount: 0, blockedCount: 0,
      startedAt: new Date('2026-06-24T01:00:00.000Z'), finishedAt: new Date('2026-06-24T01:01:00.000Z'),
      metadataJson: { createdDrafts: [
        { vendorId: 'vendor-a', settlementApprovalId: 'approval-a' },
        { vendorId: 'vendor-b', settlementApprovalId: 'approval-a' },
      ] },
    });
    prismaMock.settlementApproval.findMany.mockResolvedValue([{
      id: 'approval-a', vendorId: 'vendor-a', status: 'DRAFT',
      scheduledRunDate: new Date('2026-06-24T00:00:00.000Z'),
      scheduledCycleKey: 'scheduled-settlement:vendor-a:2026-06-24',
      _count: { lines: 0 }, lines: [],
    }]);
    const result = await getSettlementScheduleAutoDraftJobStatus(envWrite);
    expect(result.evidence?.jobCreatedClaims).toEqual([
      expect.objectContaining({ vendorId: 'vendor-a', evidence: 'MATCHED' }),
      expect.objectContaining({ vendorId: 'vendor-b', evidence: 'CONTRADICTORY' }),
    ]);
  });

  it('blocks when env is disabled and does not create drafts', async () => {
    const result = await runSettlementScheduleAutoDraftJob({
      env: envDisabled,
      runDate: '2026-06-24',
      confirmScheduledSettlementAutoDraftJob: true,
    });

    expect(result.ok).toBe(false);
    expect(result.writesPerformed).toBe(false);
    expect(result.notes[0]).toContain('SETTLEMENT_AUTO_DRAFT_JOB_ENABLED is false');
    expect(createDraftsMock).not.toHaveBeenCalled();
    expect(prismaMock.settlementScheduleJobRun.create).not.toHaveBeenCalled();
  });

  it('runs dry-run mode without creating drafts or job run rows', async () => {
    const result = await runSettlementScheduleAutoDraftJob({
      env: envDryRun,
      runDate: '2026-06-24',
      confirmScheduledSettlementAutoDraftJob: true,
    });

    expect(result.ok).toBe(true);
    expect(result.mode).toBe('DRY_RUN');
    expect(result.writesPerformed).toBe(false);
    expect(result.summary.readyVendors).toBe(1);
    expect(createDraftsMock).not.toHaveBeenCalled();
    expect(prismaMock.settlementScheduleJobRun.create).not.toHaveBeenCalled();
  });

  it('requires confirmation in write mode', async () => {
    const result = await runSettlementScheduleAutoDraftJob({
      env: envWrite,
      runDate: '2026-06-24',
      confirmScheduledSettlementAutoDraftJob: false,
    });

    expect(result.ok).toBe(false);
    expect(result.writesPerformed).toBe(false);
    expect(result.notes[0]).toContain('confirmScheduledSettlementAutoDraftJob must be true');
    expect(createDraftsMock).not.toHaveBeenCalled();
  });

  it('creates drafts for ready vendors and skips not-due or disabled vendors through existing draft service', async () => {
    const result = await runSettlementScheduleAutoDraftJob({
      env: envWrite,
      runDate: '2026-06-24',
      confirmScheduledSettlementAutoDraftJob: true,
      triggeredBy: 'admin-1',
    });

    expect(result.writesPerformed).toBe(true);
    expect(result.summary).toEqual(expect.objectContaining({
      createdDrafts: 1,
      skipped: 2,
      blocked: 2,
      existingDrafts: 0,
    }));
    expect(result.vendors.find((vendor) => vendor.vendorId === 'ready-vendor')).toEqual(expect.objectContaining({
      state: 'CREATED',
      createdSettlementApprovalId: 'approval-ready',
    }));
    expect(result.vendors.find((vendor) => vendor.vendorId === 'not-due-vendor')).toEqual(expect.objectContaining({
      state: 'NOT_DUE',
    }));
    expect(result.vendors.find((vendor) => vendor.vendorId === 'disabled-vendor')).toEqual(expect.objectContaining({
      state: 'AUTO_DRAFT_DISABLED',
    }));
    expect(createDraftsMock).toHaveBeenCalledWith(expect.objectContaining({
      runDate: new Date('2026-06-24T00:00:00.000Z'),
      confirmAutoSettlementDrafts: true,
      createdBy: 'admin-1',
    }));
  });

  it('reports the second-pass blocker instead of stale preliminary READY and completes partial success', async () => {
    const reason = 'A pending Financial Correction deduction requires a vendor-wide settlement draft.';
    const preliminary = dryRunResponse({
      summary: { vendorsChecked: 3, dueVendors: 3, autoDraftEligibleVendors: 3, totalEligibleLineCount: 3, totalNetPayableMinor: 132000 },
      vendors: ['a', 'b', 'c'].map((vendorId) => ({
        ...dryRunResponse().vendors[0], vendorId, state: 'READY', eligibleLineCount: 1, netPayableMinor: 44000,
      })),
    });
    const second = dryRunResponse({
      summary: { vendorsChecked: 3, dueVendors: 3, autoDraftEligibleVendors: 2, totalEligibleLineCount: 2, totalNetPayableMinor: 88000 },
      vendors: preliminary.vendors.map((vendor, index) => index === 0
        ? { ...vendor, state: 'BLOCKED', preview: null, canCreateDraft: false, blockedReason: reason,
            eligibleLineCount: 0, netPayableMinor: 0 }
        : vendor),
    });
    dryRunMock.mockResolvedValue(preliminary);
    createDraftsMock.mockResolvedValue(createResult({
      summary: { vendorsChecked: 3, dueVendors: 3, created: 2, skipped: 1, failed: 0 },
      createdDrafts: ['b', 'c'].map((vendorId) => ({ vendorId, settlementApprovalId: `approval-${vendorId}`,
        status: 'draft', lineCount: 1, netPayableMinor: 44000 })),
      skipped: [{ vendorId: 'a', reason }],
      dryRun: second,
    }));
    const result = await runSettlementScheduleAutoDraftJob({
      env: envWrite, runDate: '2026-06-24', confirmScheduledSettlementAutoDraftJob: true,
    });
    expect(result.ok).toBe(true);
    expect(result.jobRun?.status).toBe('COMPLETED');
    expect(result.summary).toEqual(expect.objectContaining({ readyVendors: 2, createdDrafts: 2, skipped: 1, blocked: 1 }));
    expect(result.vendors).toEqual([
      expect.objectContaining({ vendorId: 'a', state: 'BLOCKED', skippedReason: reason, createdSettlementApprovalId: null }),
      expect.objectContaining({ vendorId: 'b', state: 'CREATED' }),
      expect.objectContaining({ vendorId: 'c', state: 'CREATED' }),
    ]);
    expect(prismaMock.settlementScheduleJobRun.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'COMPLETED', createdDraftCount: 2, skippedCount: 1, blockedCount: 1,
        metadataJson: expect.objectContaining({ skipped: [{ vendorId: 'a', reason }] }) }),
    }));
  });

  it('keeps genuine create-time failures as a FAILED job', async () => {
    createDraftsMock.mockResolvedValue(createResult({
      summary: { vendorsChecked: 3, dueVendors: 2, created: 0, skipped: 2, failed: 1 },
      createdDrafts: [],
      failed: [{ vendorId: 'ready-vendor', reason: 'database write failed' }],
    }));
    const result = await runSettlementScheduleAutoDraftJob({
      env: envWrite, runDate: '2026-06-24', confirmScheduledSettlementAutoDraftJob: true,
    });
    expect(result.ok).toBe(false);
    expect(prismaMock.settlementScheduleJobRun.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'FAILED', blockedCount: 3 }),
    }));
  });

  it('reports persisted COMPLETED evidence rather than a fresh preview on a repeated runDate', async () => {
    prismaMock.settlementScheduleJobRun.findUnique.mockResolvedValue({
      id: 'job-run-existing', status: 'COMPLETED', writesPerformed: true,
      createdDraftCount: 1, skippedCount: 1, blockedCount: 1,
      startedAt: new Date('2026-06-24T01:00:00.000Z'),
      finishedAt: new Date('2026-06-24T01:01:00.000Z'),
      metadataJson: {
        summary: { vendorsChecked: 2, dueVendors: 2, created: 1, skipped: 1, failed: 0 },
        createdDrafts: [{ vendorId: 'historical-vendor', settlementApprovalId: 'historical-approval', lineCount: 1, netPayableMinor: 12345 }],
        skipped: [{ vendorId: 'historical-blocked', reason: 'Historical correction block.' }],
        failed: [],
      },
    });

    const result = await runSettlementScheduleAutoDraftJob({
      env: envWrite, runDate: '2026-06-24', confirmScheduledSettlementAutoDraftJob: true,
    });

    expect(result.ok).toBe(true);
    expect(result.writesPerformed).toBe(false);
    expect(result.jobRun).toEqual(expect.objectContaining({ status: 'COMPLETED', recordedWritesPerformed: true }));
    expect(result.summary).toEqual(expect.objectContaining({ vendorsChecked: 2, readyVendors: null, createdDrafts: 1 }));
    expect(result.vendors).toEqual([
      expect.objectContaining({ vendorId: 'historical-vendor', state: 'CREATED', estimatedNetPayableMinor: 12345 }),
      expect.objectContaining({ vendorId: 'historical-blocked', state: 'SKIPPED', skippedReason: 'Historical correction block.' }),
    ]);
    expect(dryRunMock).not.toHaveBeenCalled();
    expect(prismaMock.settlementScheduleJobRun.create).not.toHaveBeenCalled();
    expect(createDraftsMock).not.toHaveBeenCalled();
  });

  it.each(['FAILED', 'PROCESSING'] as const)('reports persisted %s without pretending the run completed', async (status) => {
    prismaMock.settlementScheduleJobRun.findUnique.mockResolvedValue({
      id: 'job-run-existing', status, writesPerformed: false,
      createdDraftCount: 0, skippedCount: 0, blockedCount: 0,
      startedAt: new Date('2026-06-24T01:00:00.000Z'),
      finishedAt: status === 'FAILED' ? new Date('2026-06-24T01:01:00.000Z') : null,
      metadataJson: status === 'FAILED' ? { error: 'Existing database failure.' } : null,
    });
    const result = await runSettlementScheduleAutoDraftJob({
      env: envWrite, runDate: '2026-06-24', confirmScheduledSettlementAutoDraftJob: true,
    });
    expect(result.ok).toBe(false);
    expect(result.jobRun?.status).toBe(status);
    expect(result.summary.createdDrafts).toBeNull();
    expect(result.vendors).toEqual([]);
    expect(result.notes.join(' ')).toContain(status === 'FAILED' ? 'Existing database failure.' : 'does not prove');
    expect(dryRunMock).not.toHaveBeenCalled();
    expect(prismaMock.settlementScheduleJobRun.create).not.toHaveBeenCalled();
    expect(createDraftsMock).not.toHaveBeenCalled();
  });

  it('preserves available FAILED run vendor results without retrying', async () => {
    prismaMock.settlementScheduleJobRun.findUnique.mockResolvedValue({
      id: 'job-run-existing', status: 'FAILED', writesPerformed: true,
      createdDraftCount: 1, skippedCount: 0, blockedCount: 1,
      startedAt: new Date('2026-06-24T01:00:00.000Z'), finishedAt: new Date('2026-06-24T01:01:00.000Z'),
      metadataJson: {
        summary: { vendorsChecked: 2, dueVendors: 2, created: 1, skipped: 0, failed: 1 },
        createdDrafts: [{ vendorId: 'historical-created', settlementApprovalId: 'approval-created', netPayableMinor: 5000 }],
        skipped: [], failed: [{ vendorId: 'historical-failed', reason: 'Database write failed.' }],
      },
    });
    const result = await runSettlementScheduleAutoDraftJob({
      env: envWrite, runDate: '2026-06-24', confirmScheduledSettlementAutoDraftJob: true,
    });
    expect(result.ok).toBe(false);
    expect(result.jobRun).toEqual(expect.objectContaining({ status: 'FAILED', recordedWritesPerformed: true }));
    expect(result.summary).toEqual(expect.objectContaining({ createdDrafts: 1, skipped: 0, blocked: 1 }));
    expect(result.vendors).toEqual([
      expect.objectContaining({ vendorId: 'historical-created', state: 'CREATED' }),
      expect.objectContaining({ vendorId: 'historical-failed', state: 'FAILED', skippedReason: 'Database write failed.' }),
    ]);
    expect(createDraftsMock).not.toHaveBeenCalled();
  });

  it('does not invent vendors when historical metadata is incomplete', async () => {
    prismaMock.settlementScheduleJobRun.findUnique.mockResolvedValue({
      id: 'job-run-existing', status: 'COMPLETED', writesPerformed: true,
      createdDraftCount: 1, skippedCount: 0, blockedCount: 0,
      startedAt: new Date('2026-06-24T01:00:00.000Z'), finishedAt: new Date('2026-06-24T01:01:00.000Z'),
      metadataJson: { summary: { vendorsChecked: 2 }, createdDrafts: [{ vendorId: 'known-vendor', settlementApprovalId: 'known-approval' }] },
    });
    const result = await runSettlementScheduleAutoDraftJob({
      env: envWrite, runDate: '2026-06-24', confirmScheduledSettlementAutoDraftJob: true,
    });
    expect(result.summary).toEqual(expect.objectContaining({ vendorsChecked: 2, dueVendors: null, readyVendors: null, createdDrafts: 1 }));
    expect(result.vendors).toEqual([expect.objectContaining({ vendorId: 'known-vendor', state: 'CREATED', estimatedNetPayableMinor: null })]);
    expect(result.notes.join(' ')).toContain('incomplete');
  });

  it('keeps persisted aggregate counts but marks absent COMPLETED vendor evidence unknown', async () => {
    prismaMock.settlementScheduleJobRun.findUnique.mockResolvedValue({
      id: 'job-run-existing', status: 'COMPLETED', writesPerformed: true,
      createdDraftCount: 2, skippedCount: 1, blockedCount: 1,
      startedAt: new Date('2026-06-24T01:00:00.000Z'), finishedAt: new Date('2026-06-24T01:01:00.000Z'),
      metadataJson: null,
    });
    const result = await runSettlementScheduleAutoDraftJob({
      env: envWrite, runDate: '2026-06-24', confirmScheduledSettlementAutoDraftJob: true,
    });
    expect(result.ok).toBe(true);
    expect(result.summary).toEqual(expect.objectContaining({
      vendorsChecked: null, dueVendors: null, readyVendors: null,
      createdDrafts: 2, skipped: 1, blocked: 1, existingDrafts: null,
    }));
    expect(result.vendors).toEqual([]);
    expect(result.notes.join(' ')).toContain('missing or incomplete');
  });

  it('uses persisted status after a concurrent unique-runDate collision', async () => {
    const uniqueError = Object.assign(new Error('Unique constraint failed'), {
      code: 'P2002',
      clientVersion: '6.19.3',
    });
    Object.setPrototypeOf(uniqueError, Error.prototype);
    prismaMock.settlementScheduleJobRun.create.mockRejectedValue(uniqueError);
    prismaMock.settlementScheduleJobRun.findUnique.mockResolvedValue({
      id: 'job-run-existing',
      status: 'FAILED',
      writesPerformed: false,
      createdDraftCount: 0,
      skippedCount: 0,
      blockedCount: 0,
      startedAt: new Date('2026-06-24T01:00:00.000Z'),
      finishedAt: new Date('2026-06-24T01:01:00.000Z'),
      metadataJson: { error: 'Historical failure.' },
    });
    prismaMock.settlementScheduleJobRun.findUnique.mockResolvedValueOnce(null);

    const result = await runSettlementScheduleAutoDraftJob({
      env: envWrite,
      runDate: '2026-06-24',
      confirmScheduledSettlementAutoDraftJob: true,
    });

    expect(result.writesPerformed).toBe(false);
    expect(result.ok).toBe(false);
    expect(result.jobRun?.status).toBe('FAILED');
    expect(result.summary.createdDrafts).toBeNull();
    expect(result.vendors).toEqual([]);
    expect(createDraftsMock).not.toHaveBeenCalled();
  });
});
