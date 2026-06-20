import { Prisma, SettlementScheduleJobRunStatus } from '@prisma/client';
import type { AppEnv } from '../../config/env.js';
import { prisma } from '../../db/prisma.js';
import {
  createSettlementScheduleDrafts,
  getSettlementScheduleDryRun,
  toSettlementRunDate,
  toSettlementRunDateKey,
  type SettlementScheduleCreateDraftsResponseDto,
  type SettlementScheduleDryRunResponseDto,
  type SettlementScheduleDryRunVendorDto,
} from './settlement-schedule.service.js';

export type SettlementScheduleAutoDraftJobMode = 'DRY_RUN' | 'WRITE';

export type SettlementScheduleAutoDraftJobVendorResult = {
  vendorId: string;
  state: string;
  due: boolean;
  autoDraftEnabled: boolean;
  eligibleLineCount: number;
  pendingRefundAdjustmentCount: number;
  estimatedNetPayableMinor: number;
  createdSettlementApprovalId: string | null;
  skippedReason: string | null;
  blockers: string[];
};

export type SettlementScheduleAutoDraftJobResponse = {
  ok: boolean;
  writesPerformed: boolean;
  runDate: string;
  mode: SettlementScheduleAutoDraftJobMode;
  enabled: boolean;
  dryRun: boolean;
  summary: {
    vendorsChecked: number;
    dueVendors: number;
    readyVendors: number;
    createdDrafts: number;
    skipped: number;
    blocked: number;
    existingDrafts: number;
  };
  vendors: SettlementScheduleAutoDraftJobVendorResult[];
  notes: string[];
  jobRun: {
    id: string | null;
    status: string | null;
    startedAt: string | null;
    finishedAt: string | null;
  } | null;
};

export type SettlementScheduleAutoDraftJobStatusResponse = {
  ok: true;
  writesPerformed: false;
  enabled: boolean;
  dryRun: boolean;
  mode: SettlementScheduleAutoDraftJobMode;
  lastRun: {
    id: string;
    runDate: string;
    status: string;
    writesPerformed: boolean;
    createdDraftCount: number;
    skippedCount: number;
    blockedCount: number;
    startedAt: string;
    finishedAt: string | null;
  } | null;
  notes: string[];
};

type JobInput = {
  env: Pick<AppEnv, 'SETTLEMENT_AUTO_DRAFT_JOB_ENABLED' | 'SETTLEMENT_AUTO_DRAFT_JOB_DRY_RUN'>;
  runDate?: string | Date | null;
  confirmScheduledSettlementAutoDraftJob?: boolean;
  triggeredBy?: string | null;
};

function isUniqueRunDateError(error: unknown) {
  return (
    (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') ||
    (error !== null && typeof error === 'object' && Reflect.get(error, 'code') === 'P2002')
  );
}

function toIso(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

function countExistingDrafts(result: SettlementScheduleCreateDraftsResponseDto | null) {
  if (!result) {
    return 0;
  }
  return result.skipped.filter((item) => isExistingDraftReason(item.reason)).length;
}

function isExistingDraftReason(reason: string) {
  return /already|active approval|active settlement|existing draft|draft already|approval already|locked/i.test(reason);
}

function getVendorDryRunState(vendor: SettlementScheduleDryRunVendorDto) {
  if (vendor.state) return vendor.state;
  if (!vendor.due) return 'NOT_DUE';
  if (!vendor.schedule.autoSettlementDraftEnabled) return 'AUTO_DRAFT_DISABLED';
  if (vendor.canCreateDraft) return 'READY';
  if (vendor.eligibleLineCount === 0) return 'NO_ELIGIBLE_ROWS';
  return 'BLOCKED';
}

function buildVendorResults(
  dryRun: SettlementScheduleDryRunResponseDto,
  createResult: SettlementScheduleCreateDraftsResponseDto | null,
  alreadyProcessed = false,
) {
  return dryRun.vendors.map((vendor) => {
    const created = createResult?.createdDrafts.find((draft) => draft.vendorId === vendor.vendorId) ?? null;
    const skipped = createResult?.skipped.find((item) => item.vendorId === vendor.vendorId) ?? null;
    const failed = createResult?.failed.find((item) => item.vendorId === vendor.vendorId) ?? null;
    const blockers = [
      vendor.blockedReason,
      skipped?.reason,
      failed?.reason,
      ...vendor.warnings,
    ].filter((value): value is string => Boolean(value));
    const state = alreadyProcessed
      ? 'ALREADY_PROCESSED'
      : created
        ? 'CREATED'
        : failed
          ? 'BLOCKED'
          : skipped && isExistingDraftReason(skipped.reason)
            ? 'DRAFT_EXISTS'
            : skipped
              ? getVendorDryRunState(vendor)
              : getVendorDryRunState(vendor);

    return {
      vendorId: vendor.vendorId,
      state,
      due: vendor.due,
      autoDraftEnabled: vendor.schedule.autoSettlementDraftEnabled,
      eligibleLineCount: vendor.eligibleLineCount,
      pendingRefundAdjustmentCount: vendor.pendingRefundAdjustmentCount,
      estimatedNetPayableMinor: vendor.netPayableMinor,
      createdSettlementApprovalId: created?.settlementApprovalId ?? null,
      skippedReason: skipped?.reason ?? failed?.reason ?? (alreadyProcessed ? 'Job already processed for this run date.' : null),
      blockers,
    };
  });
}

function buildSummary(
  dryRun: SettlementScheduleDryRunResponseDto,
  createResult: SettlementScheduleCreateDraftsResponseDto | null,
  alreadyProcessed = false,
) {
  const existingDrafts = countExistingDrafts(createResult);
  return {
    vendorsChecked: dryRun.summary.vendorsChecked,
    dueVendors: dryRun.summary.dueVendors,
    readyVendors: dryRun.summary.autoDraftEligibleVendors,
    createdDrafts: alreadyProcessed ? 0 : createResult?.summary.created ?? 0,
    skipped: alreadyProcessed ? dryRun.summary.autoDraftEligibleVendors : createResult?.summary.skipped ?? 0,
    blocked: alreadyProcessed ? 0 : (createResult?.summary.failed ?? 0) + Math.max((createResult?.summary.skipped ?? 0) - existingDrafts, 0),
    existingDrafts,
  };
}

async function latestJobRun() {
  return prisma.settlementScheduleJobRun.findFirst({
    orderBy: { startedAt: 'desc' },
  });
}

export async function getSettlementScheduleAutoDraftJobStatus(
  env: JobInput['env'],
): Promise<SettlementScheduleAutoDraftJobStatusResponse> {
  const lastRun = await latestJobRun();
  return {
    ok: true,
    writesPerformed: false,
    enabled: env.SETTLEMENT_AUTO_DRAFT_JOB_ENABLED,
    dryRun: env.SETTLEMENT_AUTO_DRAFT_JOB_DRY_RUN,
    mode: env.SETTLEMENT_AUTO_DRAFT_JOB_DRY_RUN ? 'DRY_RUN' : 'WRITE',
    lastRun: lastRun
      ? {
          id: lastRun.id,
          runDate: toSettlementRunDateKey(lastRun.runDate),
          status: lastRun.status,
          writesPerformed: lastRun.writesPerformed,
          createdDraftCount: lastRun.createdDraftCount,
          skippedCount: lastRun.skippedCount,
          blockedCount: lastRun.blockedCount,
          startedAt: lastRun.startedAt.toISOString(),
          finishedAt: toIso(lastRun.finishedAt),
        }
      : null,
    notes: [
      'Scheduled settlement auto-draft job creates draft settlement approvals only.',
      'Approval, Logo invoice creation, and payout execution are not automated by this job.',
      env.SETTLEMENT_AUTO_DRAFT_JOB_DRY_RUN
        ? 'Dry-run mode is enabled; job trigger will not create drafts.'
        : 'Write mode is enabled; confirmation is required before drafts can be created.',
    ],
  };
}

export async function runSettlementScheduleAutoDraftJob(
  input: JobInput,
): Promise<SettlementScheduleAutoDraftJobResponse> {
  const runDate = toSettlementRunDate(input.runDate);
  const runDateKey = toSettlementRunDateKey(runDate);
  const enabled = input.env.SETTLEMENT_AUTO_DRAFT_JOB_ENABLED;
  const dryRunMode = input.env.SETTLEMENT_AUTO_DRAFT_JOB_DRY_RUN;
  const mode: SettlementScheduleAutoDraftJobMode = dryRunMode ? 'DRY_RUN' : 'WRITE';
  const dryRun = await getSettlementScheduleDryRun({ runDate });

  if (!enabled) {
    return {
      ok: false,
      writesPerformed: false,
      runDate: runDateKey,
      mode,
      enabled,
      dryRun: dryRunMode,
      summary: buildSummary(dryRun, null),
      vendors: buildVendorResults(dryRun, null),
      notes: [
        'SETTLEMENT_AUTO_DRAFT_JOB_ENABLED is false; no drafts were created.',
        'Set SETTLEMENT_AUTO_DRAFT_JOB_ENABLED=true before enabling scheduled auto draft execution.',
      ],
      jobRun: null,
    };
  }

  if (dryRunMode) {
    return {
      ok: true,
      writesPerformed: false,
      runDate: runDateKey,
      mode,
      enabled,
      dryRun: dryRunMode,
      summary: buildSummary(dryRun, null),
      vendors: buildVendorResults(dryRun, null),
      notes: [
        'SETTLEMENT_AUTO_DRAFT_JOB_DRY_RUN is true; this response is preview-only.',
        'No settlement drafts were created.',
      ],
      jobRun: null,
    };
  }

  if (input.confirmScheduledSettlementAutoDraftJob !== true) {
    return {
      ok: false,
      writesPerformed: false,
      runDate: runDateKey,
      mode,
      enabled,
      dryRun: dryRunMode,
      summary: buildSummary(dryRun, null),
      vendors: buildVendorResults(dryRun, null),
      notes: ['confirmScheduledSettlementAutoDraftJob must be true before write-mode auto draft execution.'],
      jobRun: null,
    };
  }

  let jobRun;
  try {
    jobRun = await prisma.settlementScheduleJobRun.create({
      data: {
        runDate,
        status: SettlementScheduleJobRunStatus.PROCESSING,
        writesPerformed: false,
        metadataJson: {
          triggeredBy: input.triggeredBy ?? null,
          mode,
          runDate: runDateKey,
        },
      },
    });
  } catch (error) {
    if (isUniqueRunDateError(error)) {
      const existingRun = await prisma.settlementScheduleJobRun.findUnique({ where: { runDate } });
      return {
        ok: true,
        writesPerformed: false,
        runDate: runDateKey,
        mode,
        enabled,
        dryRun: dryRunMode,
        summary: buildSummary(dryRun, null, true),
        vendors: buildVendorResults(dryRun, null, true),
        notes: ['A scheduled settlement auto-draft job has already been recorded for this run date. No duplicate drafts were created.'],
        jobRun: existingRun
          ? {
              id: existingRun.id,
              status: existingRun.status,
              startedAt: existingRun.startedAt.toISOString(),
              finishedAt: toIso(existingRun.finishedAt),
            }
          : null,
      };
    }
    throw error;
  }

  try {
    const createResult = await createSettlementScheduleDrafts({
      runDate,
      confirmAutoSettlementDrafts: true,
      createdBy: input.triggeredBy ?? null,
    });
    const existingDrafts = countExistingDrafts(createResult);
    const blockedCount = createResult.summary.failed + Math.max(createResult.summary.skipped - existingDrafts, 0);
    const finishedRun = await prisma.settlementScheduleJobRun.update({
      where: { id: jobRun.id },
      data: {
        status: createResult.summary.failed > 0 ? SettlementScheduleJobRunStatus.FAILED : SettlementScheduleJobRunStatus.COMPLETED,
        writesPerformed: createResult.writesPerformed,
        createdDraftCount: createResult.summary.created,
        skippedCount: createResult.summary.skipped,
        blockedCount,
        finishedAt: new Date(),
        metadataJson: {
          triggeredBy: input.triggeredBy ?? null,
          mode,
          runDate: runDateKey,
          summary: createResult.summary,
          createdDrafts: createResult.createdDrafts.map((draft) => ({
            vendorId: draft.vendorId,
            settlementApprovalId: draft.settlementApprovalId,
            lineCount: draft.lineCount,
            netPayableMinor: draft.netPayableMinor,
          })),
          skipped: createResult.skipped,
          failed: createResult.failed,
        },
      },
    });

    return {
      ok: createResult.summary.failed === 0,
      writesPerformed: createResult.writesPerformed,
      runDate: runDateKey,
      mode,
      enabled,
      dryRun: dryRunMode,
      summary: buildSummary(dryRun, createResult),
      vendors: buildVendorResults(dryRun, createResult),
      notes: [
        'Scheduled settlement auto-draft job completed using existing settlement draft creation logic.',
        'Approval, Logo invoicing, and payout execution were not automated.',
      ],
      jobRun: {
        id: finishedRun.id,
        status: finishedRun.status,
        startedAt: finishedRun.startedAt.toISOString(),
        finishedAt: toIso(finishedRun.finishedAt),
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Scheduled settlement auto-draft job failed.';
    const failedRun = await prisma.settlementScheduleJobRun.update({
      where: { id: jobRun.id },
      data: {
        status: SettlementScheduleJobRunStatus.FAILED,
        writesPerformed: false,
        finishedAt: new Date(),
        metadataJson: {
          triggeredBy: input.triggeredBy ?? null,
          mode,
          runDate: runDateKey,
          error: message,
        },
      },
    });

    return {
      ok: false,
      writesPerformed: false,
      runDate: runDateKey,
      mode,
      enabled,
      dryRun: dryRunMode,
      summary: buildSummary(dryRun, null),
      vendors: buildVendorResults(dryRun, null),
      notes: [message],
      jobRun: {
        id: failedRun.id,
        status: failedRun.status,
        startedAt: failedRun.startedAt.toISOString(),
        finishedAt: toIso(failedRun.finishedAt),
      },
    };
  }
}
