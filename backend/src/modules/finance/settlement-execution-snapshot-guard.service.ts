import { SettlementApprovalStatus } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { isLedgerVoided } from './active-ledger-policy.service.js';

type SnapshotCompletenessItem = {
  present: boolean;
  missingLineIds: string[];
  resolvedFromLedgerLineIds: string[];
};

export type SettlementExecutionSnapshotGuardDto = {
  ok: boolean;
  blockers: string[];
  warnings: string[];
  snapshotCompleteness: {
    settlementApprovalFound: boolean;
    settlementApprovalStatus: string | null;
    lineCount: number;
    executionLineCount: number;
    commissionPercentSnapshot: SnapshotCompletenessItem;
    commissionVatPercentSnapshot: SnapshotCompletenessItem;
    deductShippingEnabledSnapshot: SnapshotCompletenessItem;
    shippingModeSnapshot: SnapshotCompletenessItem;
    fixedShippingFeeSnapshot: SnapshotCompletenessItem;
    externalShippingCostSnapshot: SnapshotCompletenessItem;
    lineAmountSnapshots: SnapshotCompletenessItem;
  };
  detectedCommissionRates: number[];
  detectedCommissionVatRates: number[];
  detectedShippingModes: string[];
  requiredSnapshotsPresent: boolean;
};

type GuardLine = {
  id: string;
  lineType: string;
  amountMinor: number;
  commissionMinor: number;
  commissionVatMinor: number;
  payableImpactMinor: number;
  sourceSnapshotJson: unknown;
  financeLedgerEntry: {
    commissionPercentSnapshot: unknown;
    commissionVatPercentSnapshot: unknown;
    deductShippingEnabledSnapshot: boolean | null;
    shippingModeSnapshot: string | null;
    fixedShippingFeeSnapshot: unknown;
    shippingCostSnapshot: unknown;
    shippingVatAmountSnapshot: unknown;
    shippingCostSourceSnapshot: string | null;
    shippingCostProviderSnapshot: string | null;
    shippingCostIdSnapshot: string | null;
    voidedAt?: Date | null;
    voidReason?: string | null;
    supersededByLedgerId?: string | null;
  } | null;
};

type SnapshotField =
  | 'commissionPercentSnapshot'
  | 'commissionVatPercentSnapshot'
  | 'deductShippingEnabledSnapshot'
  | 'shippingModeSnapshot'
  | 'fixedShippingFeeSnapshot'
  | 'shippingCostSnapshot'
  | 'shippingVatAmountSnapshot'
  | 'shippingCostSourceSnapshot'
  | 'shippingCostProviderSnapshot'
  | 'shippingCostIdSnapshot';

const EMPTY_COMPLETENESS_ITEM: SnapshotCompletenessItem = {
  present: false,
  missingLineIds: [],
  resolvedFromLedgerLineIds: [],
};

function emptyCompleteness(): SettlementExecutionSnapshotGuardDto['snapshotCompleteness'] {
  return {
    settlementApprovalFound: false,
    settlementApprovalStatus: null,
    lineCount: 0,
    executionLineCount: 0,
    commissionPercentSnapshot: { ...EMPTY_COMPLETENESS_ITEM },
    commissionVatPercentSnapshot: { ...EMPTY_COMPLETENESS_ITEM },
    deductShippingEnabledSnapshot: { ...EMPTY_COMPLETENESS_ITEM },
    shippingModeSnapshot: { ...EMPTY_COMPLETENESS_ITEM },
    fixedShippingFeeSnapshot: { ...EMPTY_COMPLETENESS_ITEM },
    externalShippingCostSnapshot: { ...EMPTY_COMPLETENESS_ITEM },
    lineAmountSnapshots: { ...EMPTY_COMPLETENESS_ITEM },
  };
}

function createResult(input: {
  blockers?: string[];
  warnings?: string[];
  snapshotCompleteness?: SettlementExecutionSnapshotGuardDto['snapshotCompleteness'];
  detectedCommissionRates?: number[];
  detectedCommissionVatRates?: number[];
  detectedShippingModes?: string[];
}): SettlementExecutionSnapshotGuardDto {
  const blockers = input.blockers ?? [];
  return {
    ok: blockers.length === 0,
    blockers,
    warnings: input.warnings ?? [],
    snapshotCompleteness: input.snapshotCompleteness ?? emptyCompleteness(),
    detectedCommissionRates: input.detectedCommissionRates ?? [],
    detectedCommissionVatRates: input.detectedCommissionVatRates ?? [],
    detectedShippingModes: input.detectedShippingModes ?? [],
    requiredSnapshotsPresent: blockers.length === 0,
  };
}

export function buildSkippedExecutionSnapshotGuard(reason: string): SettlementExecutionSnapshotGuardDto {
  return createResult({
    blockers: [reason],
  });
}

function readSnapshotRecord(value: unknown): Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function hasSnapshotValue(value: unknown) {
  return value !== null && value !== undefined && value !== '';
}

function readSnapshotValue(line: GuardLine, field: SnapshotField) {
  const lineSnapshot = readSnapshotRecord(line.sourceSnapshotJson);
  const lineValue = lineSnapshot[field];
  if (hasSnapshotValue(lineValue)) {
    return {
      value: lineValue,
      source: 'line' as const,
    };
  }

  const ledgerValue = line.financeLedgerEntry?.[field];
  if (hasSnapshotValue(ledgerValue)) {
    return {
      value: ledgerValue,
      source: 'ledger' as const,
    };
  }

  return {
    value: null,
    source: 'missing' as const,
  };
}

function toNumber(value: unknown) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizePercent(value: unknown) {
  const numeric = toNumber(value);
  if (numeric === null || numeric < 0 || numeric > 100) {
    return null;
  }
  return Math.round(numeric * 10000) / 10000;
}

function normalizeShippingMode(value: unknown) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'disabled') {
    return 'disabled';
  }
  if (normalized === 'fixed') {
    return 'fixed';
  }
  if (normalized === 'external_provider') {
    return 'external_provider';
  }
  return null;
}

function normalizeBoolean(value: unknown) {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') {
      return true;
    }
    if (normalized === 'false') {
      return false;
    }
  }
  return null;
}

function lineRequiresPolicySnapshots(line: GuardLine) {
  return (
    line.lineType.toUpperCase() === 'SALE' ||
    line.commissionMinor > 0 ||
    line.commissionVatMinor > 0
  );
}

function markMissing(item: SnapshotCompletenessItem, lineId: string) {
  item.present = false;
  item.missingLineIds.push(lineId);
}

function markResolvedFromLedger(item: SnapshotCompletenessItem, lineId: string) {
  item.resolvedFromLedgerLineIds.push(lineId);
}

function initializePresent(item: SnapshotCompletenessItem) {
  item.present = true;
}

function sortedNumbers(values: Set<number>) {
  return Array.from(values).sort((a, b) => a - b);
}

function sortedStrings(values: Set<string>) {
  return Array.from(values).sort();
}

export async function validateSettlementApprovalExecutionSnapshots(
  settlementApprovalId: string,
): Promise<SettlementExecutionSnapshotGuardDto> {
  const approval = await prisma.settlementApproval.findUnique({
    where: {
      id: settlementApprovalId,
    },
    include: {
      lines: {
        include: {
          financeLedgerEntry: {
            select: {
              commissionPercentSnapshot: true,
              commissionVatPercentSnapshot: true,
              deductShippingEnabledSnapshot: true,
              shippingModeSnapshot: true,
              fixedShippingFeeSnapshot: true,
              shippingCostSnapshot: true,
              shippingVatAmountSnapshot: true,
              shippingCostSourceSnapshot: true,
              shippingCostProviderSnapshot: true,
              shippingCostIdSnapshot: true,
              voidedAt: true,
              voidReason: true,
              supersededByLedgerId: true,
            },
          },
        },
      },
    },
  });

  if (!approval) {
    return createResult({
      blockers: ['SettlementApproval must exist before financial execution.'],
    });
  }

  const blockers: string[] = [];
  const warnings: string[] = [];
  const completeness = emptyCompleteness();
  completeness.settlementApprovalFound = true;
  completeness.settlementApprovalStatus = approval.status;
  completeness.lineCount = approval.lines.length;

  if (approval.status !== SettlementApprovalStatus.APPROVED) {
    blockers.push(`SettlementApproval status must be APPROVED before financial execution. Current status: ${approval.status}.`);
  }

  const commissionRates = new Set<number>();
  const commissionVatRates = new Set<number>();
  const shippingModes = new Set<string>();
  const lines = approval.lines as GuardLine[];
  const executionLines = lines.filter(lineRequiresPolicySnapshots);
  completeness.executionLineCount = executionLines.length;

  for (const item of [
    completeness.commissionPercentSnapshot,
    completeness.commissionVatPercentSnapshot,
    completeness.deductShippingEnabledSnapshot,
    completeness.shippingModeSnapshot,
    completeness.fixedShippingFeeSnapshot,
    completeness.externalShippingCostSnapshot,
    completeness.lineAmountSnapshots,
  ]) {
    initializePresent(item);
  }

  for (const line of lines) {
    if (isLedgerVoided(line.financeLedgerEntry)) {
      blockers.push(
        `SettlementApprovalLine ${line.id} references a voided or superseded ledger row and cannot be used for financial execution.`,
      );
    }

    const lineAmountsPresent = [
      line.amountMinor,
      line.commissionMinor,
      line.commissionVatMinor,
      line.payableImpactMinor,
    ].every((value) => Number.isFinite(Number(value)));
    if (!lineAmountsPresent) {
      markMissing(completeness.lineAmountSnapshots, line.id);
      blockers.push(`SettlementApprovalLine ${line.id} is missing required line amount snapshots.`);
    }

    if (!lineRequiresPolicySnapshots(line)) {
      continue;
    }

    const commissionPercent = readSnapshotValue(line, 'commissionPercentSnapshot');
    const normalizedCommissionPercent = normalizePercent(commissionPercent.value);
    if (normalizedCommissionPercent === null) {
      markMissing(completeness.commissionPercentSnapshot, line.id);
      blockers.push(`SettlementApprovalLine ${line.id} is missing commissionPercentSnapshot.`);
    } else {
      commissionRates.add(normalizedCommissionPercent);
      if (commissionPercent.source === 'ledger') {
        markResolvedFromLedger(completeness.commissionPercentSnapshot, line.id);
      }
    }

    const commissionVatPercent = readSnapshotValue(line, 'commissionVatPercentSnapshot');
    const normalizedCommissionVatPercent = normalizePercent(commissionVatPercent.value);
    if (normalizedCommissionVatPercent === null) {
      markMissing(completeness.commissionVatPercentSnapshot, line.id);
      blockers.push(`SettlementApprovalLine ${line.id} is missing commissionVatPercentSnapshot.`);
    } else {
      commissionVatRates.add(normalizedCommissionVatPercent);
      if (commissionVatPercent.source === 'ledger') {
        markResolvedFromLedger(completeness.commissionVatPercentSnapshot, line.id);
      }
    }

    const deductShippingEnabled = readSnapshotValue(line, 'deductShippingEnabledSnapshot');
    const normalizedDeductShippingEnabled = normalizeBoolean(deductShippingEnabled.value);
    if (normalizedDeductShippingEnabled === null) {
      markMissing(completeness.deductShippingEnabledSnapshot, line.id);
      blockers.push(`SettlementApprovalLine ${line.id} is missing deductShippingEnabledSnapshot.`);
    } else if (deductShippingEnabled.source === 'ledger') {
      markResolvedFromLedger(completeness.deductShippingEnabledSnapshot, line.id);
    }

    const shippingMode = readSnapshotValue(line, 'shippingModeSnapshot');
    const normalizedShippingMode = normalizeShippingMode(shippingMode.value);
    if (!normalizedShippingMode) {
      markMissing(completeness.shippingModeSnapshot, line.id);
      blockers.push(`SettlementApprovalLine ${line.id} is missing shippingModeSnapshot.`);
    } else {
      shippingModes.add(normalizedShippingMode);
      if (shippingMode.source === 'ledger') {
        markResolvedFromLedger(completeness.shippingModeSnapshot, line.id);
      }
    }

    if (normalizedDeductShippingEnabled && normalizedShippingMode === 'fixed') {
      const fixedShippingFee = readSnapshotValue(line, 'fixedShippingFeeSnapshot');
      if (toNumber(fixedShippingFee.value) === null) {
        markMissing(completeness.fixedShippingFeeSnapshot, line.id);
        blockers.push(`SettlementApprovalLine ${line.id} is missing fixedShippingFeeSnapshot for fixed shipping deduction.`);
      } else if (fixedShippingFee.source === 'ledger') {
        markResolvedFromLedger(completeness.fixedShippingFeeSnapshot, line.id);
      }
    }

    if (normalizedDeductShippingEnabled && normalizedShippingMode === 'external_provider') {
      const shippingCost = readSnapshotValue(line, 'shippingCostSnapshot');
      const providerEvidence = [
        readSnapshotValue(line, 'shippingCostIdSnapshot').value,
        readSnapshotValue(line, 'shippingCostProviderSnapshot').value,
        readSnapshotValue(line, 'shippingCostSourceSnapshot').value,
      ].some(hasSnapshotValue);

      if (toNumber(shippingCost.value) === null || !providerEvidence) {
        markMissing(completeness.externalShippingCostSnapshot, line.id);
        blockers.push(`SettlementApprovalLine ${line.id} is missing external provider shipping cost snapshot or provider evidence.`);
      } else if (shippingCost.source === 'ledger') {
        markResolvedFromLedger(completeness.externalShippingCostSnapshot, line.id);
      }
    }
  }

  const detectedCommissionVatRates = sortedNumbers(commissionVatRates);
  if (detectedCommissionVatRates.length > 1) {
    blockers.push('Commission VAT rate is not uniform across settlement lines; Logo invoice creation is blocked until reviewed.');
  }

  for (const [label, item] of Object.entries(completeness)) {
    if (
      typeof item === 'object' &&
      item !== null &&
      'resolvedFromLedgerLineIds' in item &&
      Array.isArray(item.resolvedFromLedgerLineIds) &&
      item.resolvedFromLedgerLineIds.length > 0
    ) {
      warnings.push(
        `${label} was resolved from linked FinanceLedgerEntry for ${item.resolvedFromLedgerLineIds.length} settlement line(s); execution must persist a request snapshot before provider calls.`,
      );
    }
  }

  return createResult({
    blockers: Array.from(new Set(blockers)),
    warnings: Array.from(new Set(warnings)),
    snapshotCompleteness: completeness,
    detectedCommissionRates: sortedNumbers(commissionRates),
    detectedCommissionVatRates,
    detectedShippingModes: sortedStrings(shippingModes),
  });
}

export const __settlementExecutionSnapshotGuardTesting = {
  readSnapshotValue,
  normalizeShippingMode,
  normalizePercent,
};
