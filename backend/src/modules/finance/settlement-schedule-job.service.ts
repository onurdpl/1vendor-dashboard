import { Prisma, SettlementScheduleJobRunStatus, type SettlementScheduleJobRun } from '@prisma/client';
import type { AppEnv } from '../../config/env.js';
import { prisma } from '../../db/prisma.js';
import {
  createSettlementScheduleDrafts,
  buildScheduledSettlementCycleKey,
  getSettlementScheduleDryRun,
  toSettlementRunDate,
  toSettlementRunDateKey,
  type SettlementScheduleCreateDraftsResponseDto,
  type SettlementScheduleDryRunResponseDto,
  type SettlementScheduleDryRunVendorDto,
} from './settlement-schedule.service.js';
import { assertScheduledDraftDayComplete } from './settlement-schedule-utc-boundary.js';

export type SettlementScheduleAutoDraftJobMode = 'DRY_RUN' | 'WRITE';

export type SettlementScheduleAutoDraftJobVendorResult = {
  vendorId: string;
  state: string;
  due: boolean | null;
  autoDraftEnabled: boolean | null;
  eligibleLineCount: number | null;
  pendingRefundAdjustmentCount: number | null;
  estimatedNetPayableMinor: number | null;
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
    vendorsChecked: number | null;
    dueVendors: number | null;
    readyVendors: number | null;
    createdDrafts: number | null;
    skipped: number | null;
    blocked: number | null;
    existingDrafts: number | null;
  };
  vendors: SettlementScheduleAutoDraftJobVendorResult[];
  notes: string[];
  jobRun: {
    id: string | null;
    status: string | null;
    startedAt: string | null;
    finishedAt: string | null;
    recordedWritesPerformed?: boolean;
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
  evidence: SettlementScheduleJobEvidence | null;
  notes: string[];
};

export type SettlementScheduleJobEvidence = {
  runDate: string;
  recordsTruncated: boolean;
  createdClaimsAvailable: boolean;
  jobOutcomeMetadataComplete: boolean;
  jobOutcomesTruncated: boolean;
  jobError: string | null;
  jobVendorOutcomes: Array<{ vendorId: string; state: 'SKIPPED' | 'FAILED'; reason: string }>;
  settlements: Array<{
    id: string;
    vendorId: string;
    scheduledCycleKey: string | null;
    status: string;
    cycleAligned: boolean;
    jobProvenance: 'MATCHED_METADATA' | 'UNKNOWN';
    lineCount: number;
    sourceLines: Array<{ id: string; financeLedgerEntryId: string; lineType: string }>;
    sourceLinesTruncated: boolean;
  }>;
  jobCreatedClaims: Array<{
    vendorId: string;
    settlementApprovalId: string;
    evidence: 'MATCHED' | 'MISSING_OR_UNLISTED' | 'CONTRADICTORY';
  }>;
  notes: string[];
};

type JobInput = {
  env: Pick<AppEnv, 'SETTLEMENT_AUTO_DRAFT_JOB_ENABLED' | 'SETTLEMENT_AUTO_DRAFT_JOB_DRY_RUN'>;
  runDate?: string | Date | null;
  confirmScheduledSettlementAutoDraftJob?: boolean;
  triggeredBy?: string | null;
};

export class SettlementJobReportingPersistenceError extends Error {
  readonly confirmedWritesPerformed: boolean | null;
  readonly confirmedCreatedDraftCount: number | null;

  constructor(originalError: string, reportingError: unknown, confirmed: SettlementScheduleCreateDraftsResponseDto | null) {
    const reportingMessage = reportingError instanceof Error ? reportingError.message : String(reportingError);
    super(`Settlement job reporting could not be persisted; ${confirmed
      ? `${confirmed.summary.created} DRAFT creation(s) were confirmed by this execution, but persisted JobRun outcome is unknown`
      : 'financial write outcome is unknown'}. Original error: ${originalError}. Reporting error: ${reportingMessage}`);
    this.name = 'SettlementJobReportingPersistenceError';
    this.confirmedWritesPerformed = confirmed?.writesPerformed ?? null;
    this.confirmedCreatedDraftCount = confirmed?.summary.created ?? null;
  }
}

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
    const state = created
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
      skippedReason: skipped?.reason ?? failed?.reason ?? null,
      blockers,
    };
  });
}

function buildSummary(
  dryRun: SettlementScheduleDryRunResponseDto,
  createResult: SettlementScheduleCreateDraftsResponseDto | null,
) {
  const existingDrafts = countExistingDrafts(createResult);
  return {
    vendorsChecked: dryRun.summary.vendorsChecked,
    dueVendors: dryRun.summary.dueVendors,
    readyVendors: dryRun.summary.autoDraftEligibleVendors,
    createdDrafts: createResult?.summary.created ?? 0,
    skipped: createResult?.summary.skipped ?? 0,
    blocked: (createResult?.summary.failed ?? 0) + Math.max((createResult?.summary.skipped ?? 0) - existingDrafts, 0),
    existingDrafts,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonNegativeCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function historicalVendorRows(value: unknown, state: 'CREATED' | 'SKIPPED' | 'FAILED') {
  if (!Array.isArray(value)) return null;
  if (value.some((item) => {
    const row = asRecord(item);
    return !row || typeof row.vendorId !== 'string' ||
      (state === 'CREATED' && typeof row.settlementApprovalId !== 'string') ||
      (state !== 'CREATED' && typeof row.reason !== 'string');
  })) return null;
  return value.flatMap((item): SettlementScheduleAutoDraftJobVendorResult[] => {
    const row = asRecord(item);
    if (!row || typeof row.vendorId !== 'string') return [];
    const reason = typeof row.reason === 'string' ? row.reason : null;
    return [{
      vendorId: row.vendorId,
      state,
      due: null,
      autoDraftEnabled: null,
      eligibleLineCount: null,
      pendingRefundAdjustmentCount: null,
      estimatedNetPayableMinor: state === 'CREATED' ? nonNegativeCount(row.netPayableMinor) : null,
      createdSettlementApprovalId: state === 'CREATED' && typeof row.settlementApprovalId === 'string'
        ? row.settlementApprovalId : null,
      skippedReason: reason,
      blockers: reason ? [reason] : [],
    }];
  });
}

function existingRunResponse(
  run: SettlementScheduleJobRun,
  context: { runDate: string; mode: SettlementScheduleAutoDraftJobMode; enabled: boolean; dryRun: boolean },
): SettlementScheduleAutoDraftJobResponse {
  const metadata = asRecord(run.metadataJson);
  const metadataSummary = asRecord(metadata?.summary);
  const finalized = run.status !== SettlementScheduleJobRunStatus.PROCESSING;
  const created = finalized ? historicalVendorRows(metadata?.createdDrafts, 'CREATED') : null;
  const skipped = finalized ? historicalVendorRows(metadata?.skipped, 'SKIPPED') : null;
  const failed = finalized ? historicalVendorRows(metadata?.failed, 'FAILED') : null;
  const hasResultSummary = metadataSummary !== null;
  const completeVendorMetadata = created !== null && skipped !== null && failed !== null &&
    created.length === run.createdDraftCount && skipped.length === run.skippedCount &&
    nonNegativeCount(metadataSummary?.failed) === failed.length;
  const error = typeof metadata?.error === 'string' ? metadata.error : null;
  const notes = [
    `A scheduled settlement auto-draft job already exists for this run date with status ${run.status}; no retry or draft creation occurred.`,
    'This response reports persisted execution evidence, not a new settlement preview.',
  ];
  if (error) notes.push(error);
  if (!completeVendorMetadata || !hasResultSummary) {
    notes.push('Historical vendor results are missing or incomplete; unavailable values are unknown.');
  }
  if (run.status === SettlementScheduleJobRunStatus.PROCESSING) {
    notes.push('PROCESSING does not prove that a worker is still active or that its vendor work is complete.');
  }
  return {
    ok: run.status === SettlementScheduleJobRunStatus.COMPLETED,
    writesPerformed: false,
    ...context,
    summary: {
      vendorsChecked: finalized ? nonNegativeCount(metadataSummary?.vendorsChecked) : null,
      dueVendors: finalized ? nonNegativeCount(metadataSummary?.dueVendors) : null,
      readyVendors: null,
      createdDrafts: finalized && (run.status === SettlementScheduleJobRunStatus.COMPLETED || hasResultSummary)
        ? run.createdDraftCount : null,
      skipped: finalized && (run.status === SettlementScheduleJobRunStatus.COMPLETED || hasResultSummary)
        ? run.skippedCount : null,
      blocked: finalized && (run.status === SettlementScheduleJobRunStatus.COMPLETED || hasResultSummary)
        ? run.blockedCount : null,
      existingDrafts: completeVendorMetadata && skipped
        ? skipped.filter((item) => item.skippedReason && isExistingDraftReason(item.skippedReason)).length : null,
    },
    vendors: [...(created ?? []), ...(skipped ?? []), ...(failed ?? [])],
    notes,
    jobRun: {
      id: run.id,
      status: run.status,
      startedAt: run.startedAt.toISOString(),
      finishedAt: toIso(run.finishedAt),
      recordedWritesPerformed: run.writesPerformed,
    },
  };
}

async function latestJobRun() {
  return prisma.settlementScheduleJobRun.findFirst({
    orderBy: { startedAt: 'desc' },
  });
}

async function readJobEvidence(run: SettlementScheduleJobRun): Promise<SettlementScheduleJobEvidence> {
  const metadata = asRecord(run.metadataJson);
  const metadataSummary = asRecord(metadata?.summary);
  const rawClaims = metadata?.createdDrafts;
  const validClaims = Array.isArray(rawClaims) && rawClaims.every((value) => {
    const row = asRecord(value);
    return row && typeof row.vendorId === 'string' && typeof row.settlementApprovalId === 'string';
  });
  const claims = validClaims ? (rawClaims as Array<{ vendorId: string; settlementApprovalId: string }>) : [];
  const createdClaimsAvailable = validClaims &&
    (run.status === SettlementScheduleJobRunStatus.PROCESSING || claims.length === run.createdDraftCount);
  const readOutcomes = (value: unknown, state: 'SKIPPED' | 'FAILED') => {
    if (!Array.isArray(value) || !value.every((item) => {
      const row = asRecord(item);
      return row && typeof row.vendorId === 'string' && typeof row.reason === 'string';
    })) return null;
    return value.map((item): { vendorId: string; state: 'SKIPPED' | 'FAILED'; reason: string } => {
      const row = item as { vendorId: string; reason: string };
      return { vendorId: row.vendorId, state, reason: row.reason };
    });
  };
  const skippedOutcomes = readOutcomes(metadata?.skipped, 'SKIPPED');
  const failedOutcomes = readOutcomes(metadata?.failed, 'FAILED');
  const jobOutcomeMetadataComplete = skippedOutcomes !== null && failedOutcomes !== null &&
    skippedOutcomes.length === run.skippedCount &&
    nonNegativeCount(metadataSummary?.failed) === failedOutcomes.length;
  const jobOutcomesTruncated = (skippedOutcomes?.length ?? 0) + (failedOutcomes?.length ?? 0) > 100;
  const claimIds = claims.slice(0, 100).map((claim) => claim.settlementApprovalId);
  const rows = await prisma.settlementApproval.findMany({
    where: {
      OR: [
        { scheduledRunDate: run.runDate, scheduledCycleKey: { not: null } },
        { id: { in: claimIds } },
      ],
    },
    orderBy: { id: 'asc' },
    take: 101,
    select: {
      id: true, vendorId: true, scheduledRunDate: true, scheduledCycleKey: true, status: true,
      _count: { select: { lines: true } },
      lines: {
        orderBy: { id: 'asc' }, take: 21,
        select: { id: true, financeLedgerEntryId: true, lineType: true },
      },
    },
  });
  const recordsTruncated = rows.length > 100 || claims.length > 100;
  const visibleRows = rows.slice(0, 100);
  const matchingClaims = new Set<string>();
  const settlements = visibleRows.map((row) => {
    const expectedKey = buildScheduledSettlementCycleKey(row.vendorId, run.runDate);
    const matchingClaim = claims.find((claim) => claim.settlementApprovalId === row.id && claim.vendorId === row.vendorId);
    const aligned = row.scheduledRunDate?.getTime() === run.runDate.getTime() && row.scheduledCycleKey === expectedKey;
    if (matchingClaim && aligned) matchingClaims.add(JSON.stringify([row.vendorId, row.id]));
    return {
      id: row.id,
      vendorId: row.vendorId,
      scheduledCycleKey: row.scheduledCycleKey,
      status: row.status,
      cycleAligned: aligned,
      jobProvenance: matchingClaim && aligned ? 'MATCHED_METADATA' as const : 'UNKNOWN' as const,
      lineCount: row._count.lines,
      sourceLines: row.lines.slice(0, 20).map((line) => ({
        id: line.id, financeLedgerEntryId: line.financeLedgerEntryId, lineType: line.lineType,
      })),
      sourceLinesTruncated: row._count.lines > 20,
    };
  });
  const visibleById = new Map(visibleRows.map((row) => [row.id, row]));
  const jobCreatedClaims = claims.slice(0, 100).map((claim) => {
    const row = visibleById.get(claim.settlementApprovalId);
    return {
      vendorId: claim.vendorId,
      settlementApprovalId: claim.settlementApprovalId,
      evidence: matchingClaims.has(JSON.stringify([claim.vendorId, claim.settlementApprovalId])) ? 'MATCHED' as const
        : row ? 'CONTRADICTORY' as const : 'MISSING_OR_UNLISTED' as const,
    };
  });
  const notes = [
    'Cycle-matched settlement records alone do not establish which execution path created them.',
    'No settlement record does not prove a vendor was never attempted.',
  ];
  if (!createdClaimsAvailable) notes.push('JobRun created-draft metadata is unavailable or incomplete; unrecorded job provenance is unknown.');
  if (!jobOutcomeMetadataComplete) notes.push('JobRun skipped/failed vendor metadata is unavailable or incomplete; unrecorded vendor outcomes are unknown.');
  if (jobOutcomesTruncated) notes.push('JobRun vendor outcomes are limited to the first 100 persisted records.');
  if (recordsTruncated) notes.push('Evidence is limited to 100 settlement records and 20 source lines per settlement; omitted records remain unknown.');
  if (run.status === SettlementScheduleJobRunStatus.PROCESSING) notes.push('PROCESSING does not prove that a worker is still active.');
  return {
    runDate: toSettlementRunDateKey(run.runDate),
    recordsTruncated,
    createdClaimsAvailable,
    jobOutcomeMetadataComplete,
    jobOutcomesTruncated,
    jobError: typeof metadata?.error === 'string' ? metadata.error : null,
    jobVendorOutcomes: [...(skippedOutcomes ?? []), ...(failedOutcomes ?? [])].slice(0, 100),
    settlements,
    jobCreatedClaims,
    notes,
  };
}

export async function getSettlementScheduleAutoDraftJobStatus(
  env: JobInput['env'],
): Promise<SettlementScheduleAutoDraftJobStatusResponse> {
  const lastRun = await latestJobRun();
  const evidence = lastRun ? await readJobEvidence(lastRun) : null;
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
    evidence,
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
  if (enabled && !dryRunMode && input.confirmScheduledSettlementAutoDraftJob === true) {
    const existingRun = await prisma.settlementScheduleJobRun.findUnique({ where: { runDate } });
    if (existingRun) {
      return existingRunResponse(existingRun, { runDate: runDateKey, mode, enabled, dryRun: dryRunMode });
    }
    assertScheduledDraftDayComplete(runDate);
  }
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

  // Preserve read-only modes and same-date idempotency, but never consume a new
  // JobRun identity before its UTC run date has finished.
  assertScheduledDraftDayComplete(runDate);

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
      if (existingRun) {
        return existingRunResponse(existingRun, { runDate: runDateKey, mode, enabled, dryRun: dryRunMode });
      }
    }
    throw error;
  }

  let createResult: SettlementScheduleCreateDraftsResponseDto | null = null;
  try {
    createResult = await createSettlementScheduleDrafts({
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
      summary: buildSummary(createResult.dryRun, createResult),
      vendors: buildVendorResults(createResult.dryRun, createResult),
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
    // A returned createResult records vendor transactions that committed independently of
    // the final JobRun update. Never erase those confirmed outcomes on a reporting failure.
    const confirmed = createResult;
    const existingDrafts = countExistingDrafts(confirmed);
    const failedRun = await prisma.settlementScheduleJobRun.update({
      where: { id: jobRun.id },
      data: {
        status: SettlementScheduleJobRunStatus.FAILED,
        writesPerformed: confirmed?.writesPerformed ?? false,
        createdDraftCount: confirmed?.summary.created ?? 0,
        skippedCount: confirmed?.summary.skipped ?? 0,
        blockedCount: confirmed
          ? confirmed.summary.failed + Math.max(confirmed.summary.skipped - existingDrafts, 0)
          : 0,
        finishedAt: new Date(),
        metadataJson: {
          triggeredBy: input.triggeredBy ?? null,
          mode,
          runDate: runDateKey,
          error: message,
          ...(confirmed ? {
            summary: confirmed.summary,
            createdDrafts: confirmed.createdDrafts.map((draft) => ({
              vendorId: draft.vendorId,
              settlementApprovalId: draft.settlementApprovalId,
              lineCount: draft.lineCount,
              netPayableMinor: draft.netPayableMinor,
            })),
            skipped: confirmed.skipped,
            failed: confirmed.failed,
          } : {}),
        },
      },
    }).catch((reportingError: unknown) => {
      throw new SettlementJobReportingPersistenceError(message, reportingError, confirmed);
    });

    return {
      ok: false,
      writesPerformed: confirmed?.writesPerformed ?? false,
      runDate: runDateKey,
      mode,
      enabled,
      dryRun: dryRunMode,
      summary: confirmed ? buildSummary(confirmed.dryRun, confirmed) : buildSummary(dryRun, null),
      vendors: confirmed ? buildVendorResults(confirmed.dryRun, confirmed) : buildVendorResults(dryRun, null),
      notes: [message, ...(confirmed ? ['Confirmed vendor results were retained despite JobRun finalization failure.'] : [])],
      jobRun: {
        id: failedRun.id,
        status: failedRun.status,
        startedAt: failedRun.startedAt.toISOString(),
        finishedAt: toIso(failedRun.finishedAt),
        recordedWritesPerformed: failedRun.writesPerformed,
      },
    };
  }
}
