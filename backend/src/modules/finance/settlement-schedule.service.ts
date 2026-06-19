import { prisma } from '../../db/prisma.js';
import {
  createDraftApproval,
  previewApproval,
  type SettlementApprovalDto,
  type SettlementApprovalPreviewDto,
} from './settlement-approval.service.js';

export type SettlementFrequencyTypeDto = 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY';
export type SettlementWeekdayDto = 'MONDAY' | 'TUESDAY' | 'WEDNESDAY' | 'THURSDAY' | 'FRIDAY';

export type SettlementScheduleProfileDto = {
  settlementDelayDays: number;
  settlementFrequencyType: SettlementFrequencyTypeDto;
  weeklySettlementDay: SettlementWeekdayDto;
  monthlySettlementDay: number | null;
  autoSettlementDraftEnabled: boolean;
  autoSettlementApproveEnabled: boolean;
  autoSettlementInvoiceEnabled: boolean;
};

export type SettlementScheduleDryRunVendorDto = {
  vendorId: string;
  vendorName: string | null;
  due: boolean;
  dueReason: string;
  schedule: SettlementScheduleProfileDto;
  preview: SettlementApprovalPreviewDto | null;
  eligibleLineCount: number;
  excludedActiveApprovalRowCount: number;
  netPayableMinor: number;
  pendingRefundAdjustmentCount: number;
  pendingRefundAdjustmentTotalMinor: number;
  netAfterPendingRefundAdjustmentsMinor: number;
  canCreateDraft: boolean;
  blockedReason: string | null;
  warnings: string[];
};

export type SettlementScheduleDryRunResponseDto = {
  ok: true;
  writesPerformed: false;
  runDate: string;
  periodEnd: string;
  summary: {
    vendorsChecked: number;
    dueVendors: number;
    autoDraftEligibleVendors: number;
    totalEligibleLineCount: number;
    totalNetPayableMinor: number;
  };
  vendors: SettlementScheduleDryRunVendorDto[];
  notes: string[];
};

export type SettlementScheduleCreateDraftsResponseDto = {
  ok: true;
  writesPerformed: boolean;
  runDate: string;
  periodEnd: string;
  summary: {
    vendorsChecked: number;
    dueVendors: number;
    created: number;
    skipped: number;
    failed: number;
  };
  createdDrafts: Array<{
    vendorId: string;
    settlementApprovalId: string;
    status: SettlementApprovalDto['status'];
    lineCount: number;
    netPayableMinor: number;
  }>;
  skipped: Array<{
    vendorId: string;
    reason: string;
  }>;
  failed: Array<{
    vendorId: string;
    reason: string;
  }>;
  dryRun: SettlementScheduleDryRunResponseDto;
};

type SettlementScheduleProfileRow = {
  vendorId: string;
  settlementDelayDays: number;
  settlementFrequencyType: string;
  weeklySettlementDay: string;
  monthlySettlementDay: number | null;
  autoSettlementDraftEnabled: boolean;
  autoSettlementApproveEnabled: boolean;
  autoSettlementInvoiceEnabled: boolean;
  vendor: {
    name: string | null;
  } | null;
};

type SettlementScheduleRequestInput = {
  runDate?: string | Date | null;
  vendorId?: string | null;
  limit?: number | null;
};

type SettlementScheduleCreateDraftsInput = SettlementScheduleRequestInput & {
  confirmAutoSettlementDrafts?: boolean;
  createdBy?: string | null;
};

const WEEKDAYS: SettlementWeekdayDto[] = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'];
const DEFAULT_MONTHLY_SETTLEMENT_DAY = 28;

function pad2(value: number) {
  return String(value).padStart(2, '0');
}

export function toSettlementRunDate(value?: string | Date | null) {
  if (!value) {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  }

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new Error('runDate must be a valid date.');
    }
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  }

  const trimmed = value.trim();
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (dateOnly) {
    const year = Number(dateOnly[1]);
    const monthIndex = Number(dateOnly[2]) - 1;
    const day = Number(dateOnly[3]);
    const parsed = new Date(Date.UTC(year, monthIndex, day));
    if (
      parsed.getUTCFullYear() !== year ||
      parsed.getUTCMonth() !== monthIndex ||
      parsed.getUTCDate() !== day
    ) {
      throw new Error('runDate must be a valid date.');
    }
    return parsed;
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('runDate must be a valid date.');
  }
  return new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()));
}

export function toSettlementRunDateKey(date: Date) {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

function endOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999));
}

function getSettlementWeekday(date: Date): SettlementWeekdayDto | null {
  return WEEKDAYS[date.getUTCDay() - 1] ?? null;
}

function getIsoWeekNumber(date: Date) {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNumber = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - dayNumber);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  return Math.ceil((((target.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

function normalizeProfile(row: SettlementScheduleProfileRow): SettlementScheduleProfileDto {
  return {
    settlementDelayDays: row.settlementDelayDays,
    settlementFrequencyType:
      row.settlementFrequencyType === 'BIWEEKLY' || row.settlementFrequencyType === 'MONTHLY'
        ? row.settlementFrequencyType
        : 'WEEKLY',
    weeklySettlementDay: WEEKDAYS.includes(row.weeklySettlementDay as SettlementWeekdayDto)
      ? row.weeklySettlementDay as SettlementWeekdayDto
      : 'WEDNESDAY',
    monthlySettlementDay: row.monthlySettlementDay ?? DEFAULT_MONTHLY_SETTLEMENT_DAY,
    autoSettlementDraftEnabled: row.autoSettlementDraftEnabled,
    autoSettlementApproveEnabled: row.autoSettlementApproveEnabled,
    autoSettlementInvoiceEnabled: row.autoSettlementInvoiceEnabled,
  };
}

export function evaluateSettlementScheduleDue(profile: SettlementScheduleProfileDto, runDate: Date) {
  const runWeekday = getSettlementWeekday(runDate);
  if (profile.settlementFrequencyType === 'MONTHLY') {
    const monthlyDay = profile.monthlySettlementDay ?? DEFAULT_MONTHLY_SETTLEMENT_DAY;
    const due = runDate.getUTCDate() === monthlyDay;
    return {
      due,
      reason: due
        ? `Monthly settlement day ${monthlyDay} is due.`
        : `Monthly settlement day ${monthlyDay} is not due on day ${runDate.getUTCDate()}.`,
    };
  }

  if (!runWeekday || runWeekday !== profile.weeklySettlementDay) {
    return {
      due: false,
      reason: `Configured settlement weekday is ${profile.weeklySettlementDay}; run date is ${runWeekday ?? 'WEEKEND'}.`,
    };
  }

  if (profile.settlementFrequencyType === 'BIWEEKLY') {
    const isoWeek = getIsoWeekNumber(runDate);
    const due = isoWeek % 2 === 0;
    return {
      due,
      reason: due
        ? `Biweekly ${profile.weeklySettlementDay} run is due on ISO week ${isoWeek}.`
        : `Biweekly ${profile.weeklySettlementDay} run is skipped on ISO week ${isoWeek}.`,
    };
  }

  return {
    due: true,
    reason: `Weekly ${profile.weeklySettlementDay} run is due.`,
  };
}

function readLimit(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (!Number.isFinite(value) || value < 1 || value > 500) {
    throw new Error('limit must be between 1 and 500.');
  }
  return Math.round(value);
}

async function listScheduleProfiles(input: SettlementScheduleRequestInput): Promise<SettlementScheduleProfileRow[]> {
  return prisma.vendorFinancialProfile.findMany({
    where: {
      active: true,
      ...(input.vendorId ? { vendorId: input.vendorId } : {}),
    },
    orderBy: {
      vendorId: 'asc',
    },
    take: readLimit(input.limit),
    select: {
      vendorId: true,
      settlementDelayDays: true,
      settlementFrequencyType: true,
      weeklySettlementDay: true,
      monthlySettlementDay: true,
      autoSettlementDraftEnabled: true,
      autoSettlementApproveEnabled: true,
      autoSettlementInvoiceEnabled: true,
      vendor: {
        select: {
          name: true,
        },
      },
    },
  });
}

function buildAutomationWarnings(profile: SettlementScheduleProfileDto) {
  const warnings: string[] = [];
  if (profile.autoSettlementApproveEnabled) {
    warnings.push('autoSettlementApproveEnabled is configured, but Phase 4A does not auto approve settlements.');
  }
  if (profile.autoSettlementInvoiceEnabled) {
    warnings.push('autoSettlementInvoiceEnabled is configured, but Phase 4A does not auto create invoices.');
  }
  return warnings;
}

function summarizeDryRunVendor(input: {
  row: SettlementScheduleProfileRow;
  runDate: Date;
  preview: SettlementApprovalPreviewDto | null;
}) {
  const schedule = normalizeProfile(input.row);
  const dueResult = evaluateSettlementScheduleDue(schedule, input.runDate);
  const eligibleLineCount = input.preview?.summary.eligibleRowCount ?? 0;
  const pendingRefundAdjustmentCount = input.preview?.summary.pendingRefundAdjustmentCount ?? 0;
  const blockedReason = !dueResult.due
    ? dueResult.reason
    : !schedule.autoSettlementDraftEnabled
      ? 'Auto settlement draft is disabled for this vendor.'
      : eligibleLineCount === 0 && pendingRefundAdjustmentCount > 0
        ? 'Adjustment-only settlement drafts are not supported yet.'
        : eligibleLineCount === 0
          ? 'No eligible settlement rows are available for auto draft.'
          : null;

  return {
    vendorId: input.row.vendorId,
    vendorName: input.row.vendor?.name ?? null,
    due: dueResult.due,
    dueReason: dueResult.reason,
    schedule,
    preview: input.preview,
    eligibleLineCount,
    excludedActiveApprovalRowCount: input.preview?.summary.excludedActiveApprovalRowCount ?? 0,
    netPayableMinor: input.preview?.summary.netPayableMinor ?? 0,
    pendingRefundAdjustmentCount,
    pendingRefundAdjustmentTotalMinor: input.preview?.summary.pendingRefundAdjustmentTotalMinor ?? 0,
    netAfterPendingRefundAdjustmentsMinor: input.preview?.summary.netAfterPendingRefundAdjustmentsMinor ?? 0,
    canCreateDraft: dueResult.due && schedule.autoSettlementDraftEnabled && eligibleLineCount > 0,
    blockedReason,
    warnings: buildAutomationWarnings(schedule),
  };
}

export async function getSettlementScheduleDryRun(
  input: SettlementScheduleRequestInput = {},
): Promise<SettlementScheduleDryRunResponseDto> {
  const runDate = toSettlementRunDate(input.runDate);
  const periodEnd = endOfUtcDay(runDate);
  const rows = await listScheduleProfiles(input);
  const vendors: SettlementScheduleDryRunVendorDto[] = [];

  for (const row of rows) {
    const schedule = normalizeProfile(row);
    const dueResult = evaluateSettlementScheduleDue(schedule, runDate);
    const preview = dueResult.due
      ? await previewApproval(row.vendorId, null, periodEnd, {
          candidateScope: 'date_range',
          asOfDate: periodEnd,
        })
      : null;
    vendors.push(summarizeDryRunVendor({ row, runDate, preview }));
  }

  return {
    ok: true,
    writesPerformed: false,
    runDate: toSettlementRunDateKey(runDate),
    periodEnd: periodEnd.toISOString(),
    summary: {
      vendorsChecked: vendors.length,
      dueVendors: vendors.filter((vendor) => vendor.due).length,
      autoDraftEligibleVendors: vendors.filter((vendor) => vendor.canCreateDraft).length,
      totalEligibleLineCount: vendors.reduce((sum, vendor) => sum + vendor.eligibleLineCount, 0),
      totalNetPayableMinor: vendors.reduce((sum, vendor) => sum + vendor.netPayableMinor, 0),
    },
    vendors,
    notes: [
      'Dry run is read-only and reuses settlement approval preview eligibility.',
      'Scheduled previews use periodEnd at the end of runDate and asOfDate equal to that periodEnd.',
      'Biweekly schedules use ISO week parity for the every-second-week rule until a dedicated business cycle field is introduced.',
      'Phase 4A creates drafts only; approval, Logo invoicing, and payout execution are not automated.',
    ],
  };
}

export async function createSettlementScheduleDrafts(
  input: SettlementScheduleCreateDraftsInput = {},
): Promise<SettlementScheduleCreateDraftsResponseDto> {
  if (input.confirmAutoSettlementDrafts !== true) {
    throw new Error('confirmAutoSettlementDrafts must be true to create scheduled settlement drafts.');
  }

  const dryRun = await getSettlementScheduleDryRun(input);
  const createdDrafts: SettlementScheduleCreateDraftsResponseDto['createdDrafts'] = [];
  const skipped: SettlementScheduleCreateDraftsResponseDto['skipped'] = [];
  const failed: SettlementScheduleCreateDraftsResponseDto['failed'] = [];

  for (const vendor of dryRun.vendors) {
    if (!vendor.canCreateDraft) {
      skipped.push({
        vendorId: vendor.vendorId,
        reason: vendor.blockedReason ?? 'Vendor is not eligible for scheduled auto draft.',
      });
      continue;
    }

    try {
      const approval = await createDraftApproval({
        vendorId: vendor.vendorId,
        periodEnd: new Date(dryRun.periodEnd),
        asOfDate: new Date(dryRun.periodEnd),
        candidateScope: 'date_range',
        notes: `Auto settlement draft generated for ${dryRun.runDate}.`,
      });
      createdDrafts.push({
        vendorId: vendor.vendorId,
        settlementApprovalId: approval.id,
        status: approval.status,
        lineCount: approval.lines.length,
        netPayableMinor: approval.netPayableMinor,
      });
    } catch (error) {
      failed.push({
        vendorId: vendor.vendorId,
        reason: error instanceof Error ? error.message : 'Scheduled settlement draft could not be created.',
      });
    }
  }

  return {
    ok: true,
    writesPerformed: createdDrafts.length > 0,
    runDate: dryRun.runDate,
    periodEnd: dryRun.periodEnd,
    summary: {
      vendorsChecked: dryRun.summary.vendorsChecked,
      dueVendors: dryRun.summary.dueVendors,
      created: createdDrafts.length,
      skipped: skipped.length,
      failed: failed.length,
    },
    createdDrafts,
    skipped,
    failed,
    dryRun,
  };
}
