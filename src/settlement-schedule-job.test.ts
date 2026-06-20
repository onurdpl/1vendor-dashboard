import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
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

  it('does not create duplicate drafts for repeated runDate calls', async () => {
    const uniqueError = Object.assign(new Error('Unique constraint failed'), {
      code: 'P2002',
      clientVersion: '6.19.3',
    });
    Object.setPrototypeOf(uniqueError, Error.prototype);
    prismaMock.settlementScheduleJobRun.create.mockRejectedValue(uniqueError);
    prismaMock.settlementScheduleJobRun.findUnique.mockResolvedValue({
      id: 'job-run-existing',
      status: 'COMPLETED',
      startedAt: new Date('2026-06-24T01:00:00.000Z'),
      finishedAt: new Date('2026-06-24T01:01:00.000Z'),
    });

    const result = await runSettlementScheduleAutoDraftJob({
      env: envWrite,
      runDate: '2026-06-24',
      confirmScheduledSettlementAutoDraftJob: true,
    });

    expect(result.writesPerformed).toBe(false);
    expect(result.summary.createdDrafts).toBe(0);
    expect(result.vendors[0].state).toBe('ALREADY_PROCESSED');
    expect(createDraftsMock).not.toHaveBeenCalled();
  });
});
