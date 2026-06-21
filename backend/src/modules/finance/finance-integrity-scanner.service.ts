import type { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { isLedgerVoided } from './active-ledger-policy.service.js';
import {
  createOrUpdateAlert,
  FinanceIntegrityAlertLifecycleError,
  financeIntegrityAlertDedupeKey,
  type FinanceIntegrityAlertCategory,
  type FinanceIntegrityAlertActionResult,
  type FinanceIntegrityAlertSeverity,
} from './finance-integrity-alert.service.js';

type FinanceIntegrityScannerDbClient = Pick<
  Prisma.TransactionClient,
  'vendorAllocation' | 'allocationEconomicTransfer' | 'financeIntegrityAlert'
>;

type SaleLedgerSnapshot = {
  id: string;
  entryType: string;
  vendorId?: string | null;
  voidedAt?: Date | string | null;
  supersededByLedgerId?: string | null;
  supersededBy?: {
    id: string;
    entryType: string;
    voidedAt?: Date | string | null;
  } | null;
};

type TransferSnapshot = {
  id: string;
  status: string;
  failureReason?: string | null;
  fromFinanceLedgerEntryId?: string | null;
  toFinanceLedgerEntryId?: string | null;
};

type AllocationIntegritySnapshot = {
  id: string;
  financeEntries: SaleLedgerSnapshot[];
  economicTransfers: TransferSnapshot[];
};

export type FinanceIntegrityScannerFinding = {
  category: FinanceIntegrityAlertCategory;
  severity: FinanceIntegrityAlertSeverity;
  reason: string;
  dedupeKey: string;
  vendorAllocationId: string;
  allocationEconomicTransferId: string | null;
  affectedLedgerIds: string[];
  createdAlertId: string | null;
};

export type FinanceIntegrityScannerResult = {
  ok: true;
  dryRun: boolean;
  writesPerformed: boolean;
  scope: {
    vendorAllocationId: string | null;
    allocationEconomicTransferId: string | null;
  };
  findings: FinanceIntegrityScannerFinding[];
};

export type FinanceIntegrityAlertRescanResult = FinanceIntegrityScannerResult & {
  alertId: string;
  matchingAlertStillDetected: boolean;
};

export type ResolveFinanceIntegrityAlertWithScannerValidationInput = {
  alertId: string;
  note?: string | null;
  resolvedByUserId?: string | null;
  resolvedAt?: Date;
  db?: FinanceIntegrityScannerDbClient;
};

export class FinanceIntegrityScannerValidationError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'FinanceIntegrityScannerValidationError';
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, FinanceIntegrityScannerValidationError.prototype);
  }
}

type ScannerFindingResult = {
  finding: FinanceIntegrityScannerFinding;
  metadataJson: Prisma.InputJsonValue | null;
};

const IN_PROGRESS_TRANSFER_STATUSES = new Set([
  'PENDING',
  'IN_PROGRESS',
  'PROCESSING',
  'STARTED',
]);

const FAILED_TRANSFER_STATUSES = new Set([
  'FAILED',
  'FAILURE',
  'ERROR',
]);
const TRANSFER_INTEGRITY_ALERT_CATEGORIES = new Set([
  'transfer_in_progress',
  'transfer_failed',
]);
const ACTIVE_LEDGER_INTEGRITY_ALERT_CATEGORIES = new Set([
  'no_active_sale_ledger',
  'multiple_active_sale_ledgers',
  'voided_sale_ledger_without_successor',
  'superseded_ledger_missing_target',
]);
const MAX_RESOLUTION_NOTE_LENGTH = 500;

function normalize(value: unknown) {
  return String(value ?? '').trim().toUpperCase();
}

function isSaleLedger(ledger: Pick<SaleLedgerSnapshot, 'entryType'>) {
  return normalize(ledger.entryType) === 'SALE';
}

function activeSaleLedgers(allocation: AllocationIntegritySnapshot) {
  return allocation.financeEntries.filter((ledger) => isSaleLedger(ledger) && !isLedgerVoided(ledger));
}

function voidedSaleLedgers(allocation: AllocationIntegritySnapshot) {
  return allocation.financeEntries.filter((ledger) => isSaleLedger(ledger) && isLedgerVoided(ledger));
}

function activeSupersededTargets(allocation: AllocationIntegritySnapshot) {
  const targets = new Map<string, NonNullable<SaleLedgerSnapshot['supersededBy']>>();
  for (const ledger of voidedSaleLedgers(allocation)) {
    const target = ledger.supersededBy;
    if (!target || !isSaleLedger(target) || isLedgerVoided(target)) {
      continue;
    }
    targets.set(target.id, target);
  }
  return [...targets.values()];
}

function alertSeverityForCategory(category: FinanceIntegrityAlertCategory): FinanceIntegrityAlertSeverity {
  return category === 'transfer_in_progress' ? 'warning' : 'critical';
}

function readResolutionNote(note: string | null | undefined) {
  const trimmed = note?.trim() ?? '';
  if (!trimmed) {
    throw new FinanceIntegrityAlertLifecycleError('Resolution note is required.', 400);
  }
  if (trimmed.length > MAX_RESOLUTION_NOTE_LENGTH) {
    throw new FinanceIntegrityAlertLifecycleError('Resolution note must be 500 characters or fewer.', 400);
  }
  return trimmed;
}

function scannerFindingsIncludeAlertIssue(input: {
  alert: {
    dedupeKey: string;
    category: string;
  };
  result: FinanceIntegrityScannerResult;
}) {
  return input.result.findings.some((finding) => {
    const sameScope = finding.vendorAllocationId === input.result.scope.vendorAllocationId &&
      finding.allocationEconomicTransferId === input.result.scope.allocationEconomicTransferId;
    if (finding.dedupeKey === input.alert.dedupeKey) {
      return true;
    }
    if (!sameScope) {
      return false;
    }
    if (finding.category === input.alert.category) {
      return true;
    }
    if (
      TRANSFER_INTEGRITY_ALERT_CATEGORIES.has(input.alert.category) &&
      TRANSFER_INTEGRITY_ALERT_CATEGORIES.has(finding.category)
    ) {
      return true;
    }
    return ACTIVE_LEDGER_INTEGRITY_ALERT_CATEGORIES.has(input.alert.category) &&
      ACTIVE_LEDGER_INTEGRITY_ALERT_CATEGORIES.has(finding.category);
  });
}

async function loadAllocationSnapshot(
  vendorAllocationId: string,
  db: FinanceIntegrityScannerDbClient,
): Promise<AllocationIntegritySnapshot | null> {
  return db.vendorAllocation.findUnique({
    where: {
      id: vendorAllocationId,
    },
    select: {
      id: true,
      financeEntries: {
        where: {
          entryType: 'sale',
        },
        select: {
          id: true,
          vendorId: true,
          entryType: true,
          voidedAt: true,
          supersededByLedgerId: true,
          supersededBy: {
            select: {
              id: true,
              entryType: true,
              voidedAt: true,
            },
          },
        },
      },
      economicTransfers: {
        select: {
          id: true,
          status: true,
          failureReason: true,
          fromFinanceLedgerEntryId: true,
          toFinanceLedgerEntryId: true,
        },
        orderBy: {
          createdAt: 'desc',
        },
      },
    },
  });
}

async function resolveVendorAllocationIdForTransfer(
  allocationEconomicTransferId: string,
  db: FinanceIntegrityScannerDbClient,
) {
  const transfer = await db.allocationEconomicTransfer.findUnique({
    where: {
      id: allocationEconomicTransferId,
    },
    select: {
      vendorAllocationId: true,
    },
  });

  return transfer?.vendorAllocationId ?? null;
}

function buildScannerFinding(input: {
  category: FinanceIntegrityAlertCategory;
  vendorAllocationId: string;
  allocationEconomicTransferId?: string | null;
  ledgerId?: string | null;
  affectedLedgerIds?: string[];
  reason: string;
}): FinanceIntegrityScannerFinding {
  return {
    dedupeKey: financeIntegrityAlertDedupeKey({
      category: input.category,
      vendorAllocationId: input.vendorAllocationId,
      allocationEconomicTransferId: input.allocationEconomicTransferId,
      ledgerId: input.ledgerId,
    }),
    category: input.category,
    severity: alertSeverityForCategory(input.category),
    vendorAllocationId: input.vendorAllocationId,
    allocationEconomicTransferId: input.allocationEconomicTransferId ?? null,
    affectedLedgerIds: input.affectedLedgerIds ?? [],
    reason: input.reason,
    createdAlertId: null,
  };
}

async function persistScannerFinding(
  finding: FinanceIntegrityScannerFinding,
  metadataJson: Prisma.InputJsonValue | null | undefined,
  db: FinanceIntegrityScannerDbClient,
) {
  const alert = await createOrUpdateAlert({
    dedupeKey: finding.dedupeKey,
    severity: finding.severity,
    category: finding.category,
    vendorAllocationId: finding.vendorAllocationId,
    allocationEconomicTransferId: finding.allocationEconomicTransferId,
    affectedLedgerIds: finding.affectedLedgerIds,
    reason: finding.reason,
    status: 'open',
    metadataJson: metadataJson ?? null,
  }, db);

  return {
    ...finding,
    createdAlertId: alert.id,
  };
}

async function createScannerAlert(input: {
  category: FinanceIntegrityAlertCategory;
  vendorAllocationId: string;
  allocationEconomicTransferId?: string | null;
  ledgerId?: string | null;
  affectedLedgerIds?: string[];
  reason: string;
  metadataJson?: Prisma.InputJsonValue | null;
}, db: FinanceIntegrityScannerDbClient) {
  return createOrUpdateAlert({
    dedupeKey: financeIntegrityAlertDedupeKey({
      category: input.category,
      vendorAllocationId: input.vendorAllocationId,
      allocationEconomicTransferId: input.allocationEconomicTransferId,
      ledgerId: input.ledgerId,
    }),
    severity: alertSeverityForCategory(input.category),
    category: input.category,
    vendorAllocationId: input.vendorAllocationId,
    allocationEconomicTransferId: input.allocationEconomicTransferId ?? null,
    affectedLedgerIds: input.affectedLedgerIds ?? [],
    reason: input.reason,
    status: 'open',
    metadataJson: input.metadataJson ?? null,
  }, db);
}

function getNoActiveSaleLedgerFinding(allocation: AllocationIntegritySnapshot): ScannerFindingResult | null {
  const activeLedgers = activeSaleLedgers(allocation);
  const supersededTargets = activeSupersededTargets(allocation);
  if (activeLedgers.length > 0 || supersededTargets.length > 0) {
    return null;
  }

  const voidedSaleLedgerIds = voidedSaleLedgers(allocation).map((ledger) => ledger.id);
  return {
    finding: buildScannerFinding({
      category: 'no_active_sale_ledger',
      vendorAllocationId: allocation.id,
      affectedLedgerIds: voidedSaleLedgerIds,
      reason: 'No active sale ledger exists for allocation.',
    }),
    metadataJson: {
      voidedSaleLedgerIds,
    } satisfies Prisma.InputJsonValue,
  };
}

function getMultipleActiveSaleLedgersFinding(allocation: AllocationIntegritySnapshot): ScannerFindingResult | null {
  const ledgers = activeSaleLedgers(allocation);
  if (ledgers.length <= 1) {
    return null;
  }

  const activeSaleLedgerIds = ledgers.map((ledger) => ledger.id);
  return {
    finding: buildScannerFinding({
      category: 'multiple_active_sale_ledgers',
      vendorAllocationId: allocation.id,
      affectedLedgerIds: activeSaleLedgerIds,
      reason: 'Multiple active sale ledgers exist for allocation.',
    }),
    metadataJson: {
      activeSaleLedgerIds,
    } satisfies Prisma.InputJsonValue,
  };
}

function getVoidedLedgerFindings(allocation: AllocationIntegritySnapshot): ScannerFindingResult[] {
  const findings: ScannerFindingResult[] = [];

  for (const ledger of voidedSaleLedgers(allocation)) {
    if (!ledger.supersededByLedgerId) {
      findings.push({
        finding: buildScannerFinding({
          category: 'voided_sale_ledger_without_successor',
          vendorAllocationId: allocation.id,
          ledgerId: ledger.id,
          affectedLedgerIds: [ledger.id],
          reason: 'Voided sale ledger does not reference a successor ledger.',
        }),
        metadataJson: null,
      });
      continue;
    }

    if (!ledger.supersededBy || isLedgerVoided(ledger.supersededBy)) {
      findings.push({
        finding: buildScannerFinding({
          category: 'superseded_ledger_missing_target',
          vendorAllocationId: allocation.id,
          ledgerId: ledger.id,
          affectedLedgerIds: [ledger.id, ledger.supersededByLedgerId],
          reason: 'Voided sale ledger references a missing or voided successor ledger.',
        }),
        metadataJson: {
          supersededByLedgerId: ledger.supersededByLedgerId,
        } satisfies Prisma.InputJsonValue,
      });
    }
  }

  return findings;
}

function getTransferFailureFindings(
  allocation: AllocationIntegritySnapshot,
  allocationEconomicTransferId?: string | null,
): ScannerFindingResult[] {
  const transfers = allocationEconomicTransferId
    ? allocation.economicTransfers.filter((transfer) => transfer.id === allocationEconomicTransferId)
    : allocation.economicTransfers;

  return transfers.flatMap((transfer) => {
    const status = normalize(transfer.status);
    const category = IN_PROGRESS_TRANSFER_STATUSES.has(status)
      ? 'transfer_in_progress'
      : FAILED_TRANSFER_STATUSES.has(status)
        ? 'transfer_failed'
        : null;

    if (!category) {
      return [];
    }

    return [{
      finding: buildScannerFinding({
        category,
        vendorAllocationId: allocation.id,
        allocationEconomicTransferId: transfer.id,
        affectedLedgerIds: [
          transfer.fromFinanceLedgerEntryId,
          transfer.toFinanceLedgerEntryId,
        ].filter(Boolean) as string[],
        reason: category === 'transfer_in_progress'
          ? 'Economic transfer is in progress for allocation.'
          : 'Economic transfer failed for allocation.',
      }),
      metadataJson: {
        transferStatus: transfer.status,
        failureReason: transfer.failureReason ?? null,
      } satisfies Prisma.InputJsonValue,
    }];
  });
}

export async function detectNoActiveSaleLedger(input: {
  vendorAllocationId: string;
  db?: FinanceIntegrityScannerDbClient;
}) {
  const db = input.db ?? prisma;
  const allocation = await loadAllocationSnapshot(input.vendorAllocationId, db);
  if (!allocation) {
    return null;
  }

  const result = getNoActiveSaleLedgerFinding(allocation);
  if (!result) {
    return null;
  }

  return createScannerAlert({
    ...result.finding,
    metadataJson: result.metadataJson,
  }, db);
}

export async function detectMultipleActiveSaleLedgers(input: {
  vendorAllocationId: string;
  db?: FinanceIntegrityScannerDbClient;
}) {
  const db = input.db ?? prisma;
  const allocation = await loadAllocationSnapshot(input.vendorAllocationId, db);
  if (!allocation) {
    return null;
  }

  const result = getMultipleActiveSaleLedgersFinding(allocation);
  if (!result) {
    return null;
  }

  return createScannerAlert({
    ...result.finding,
    metadataJson: result.metadataJson,
  }, db);
}

export async function detectVoidedLedgerWithoutSuccessor(input: {
  vendorAllocationId: string;
  db?: FinanceIntegrityScannerDbClient;
}) {
  const db = input.db ?? prisma;
  const allocation = await loadAllocationSnapshot(input.vendorAllocationId, db);
  if (!allocation) {
    return [];
  }

  return Promise.all(getVoidedLedgerFindings(allocation).map((result) => createScannerAlert({
    ...result.finding,
    metadataJson: result.metadataJson,
  }, db)));
}

export async function detectTransferFailureStates(input: {
  vendorAllocationId: string;
  allocationEconomicTransferId?: string | null;
  db?: FinanceIntegrityScannerDbClient;
}) {
  const db = input.db ?? prisma;
  const allocation = await loadAllocationSnapshot(input.vendorAllocationId, db);
  if (!allocation) {
    return [];
  }

  return Promise.all(getTransferFailureFindings(allocation, input.allocationEconomicTransferId).map((result) =>
    createScannerAlert({
      ...result.finding,
      metadataJson: result.metadataJson,
    }, db)
  ));
}

export async function runFinanceIntegrityScannerDiagnostics(input: {
  vendorAllocationId?: string | null;
  allocationEconomicTransferId?: string | null;
  dryRun?: boolean;
  db?: FinanceIntegrityScannerDbClient;
}): Promise<FinanceIntegrityScannerResult> {
  const db = input.db ?? prisma;
  const requestedVendorAllocationId = input.vendorAllocationId?.trim() || null;
  const allocationEconomicTransferId = input.allocationEconomicTransferId?.trim() || null;
  const dryRun = input.dryRun ?? true;

  if (!requestedVendorAllocationId && !allocationEconomicTransferId) {
    throw new FinanceIntegrityScannerValidationError(
      'vendorAllocationId or allocationEconomicTransferId is required for scoped finance integrity scans.',
    );
  }

  const resolvedVendorAllocationId = requestedVendorAllocationId ?? (
    allocationEconomicTransferId
      ? await resolveVendorAllocationIdForTransfer(allocationEconomicTransferId, db)
      : null
  );

  if (!resolvedVendorAllocationId) {
    throw new FinanceIntegrityScannerValidationError(
      'Allocation economic transfer was not found for scoped finance integrity scan.',
      404,
    );
  }

  const allocation = await loadAllocationSnapshot(resolvedVendorAllocationId, db);
  if (!allocation) {
    throw new FinanceIntegrityScannerValidationError(
      'Vendor allocation was not found for scoped finance integrity scan.',
      404,
    );
  }

  const rawFindings = [
    getNoActiveSaleLedgerFinding(allocation),
    getMultipleActiveSaleLedgersFinding(allocation),
    ...getVoidedLedgerFindings(allocation),
    ...getTransferFailureFindings(allocation, allocationEconomicTransferId),
  ].filter((finding): finding is ScannerFindingResult => Boolean(finding));

  const findings = dryRun
    ? rawFindings.map((result) => result.finding)
    : await Promise.all(rawFindings.map((result) => persistScannerFinding(result.finding, result.metadataJson, db)));

  return {
    ok: true,
    dryRun,
    writesPerformed: !dryRun && findings.length > 0,
    scope: {
      vendorAllocationId: resolvedVendorAllocationId,
      allocationEconomicTransferId,
    },
    findings,
  };
}

export async function rescanFinanceIntegrityAlert(input: {
  alertId: string;
  dryRun?: boolean;
  db?: FinanceIntegrityScannerDbClient;
}): Promise<FinanceIntegrityAlertRescanResult> {
  const db = input.db ?? prisma;
  const dryRun = true;
  const alert = await db.financeIntegrityAlert.findUnique({
    where: {
      id: input.alertId,
    },
    select: {
      id: true,
      dedupeKey: true,
      category: true,
      vendorAllocationId: true,
      allocationEconomicTransferId: true,
    },
  });

  if (!alert) {
    throw new FinanceIntegrityScannerValidationError('Finance integrity alert was not found.', 404);
  }

  if (!alert.vendorAllocationId && !alert.allocationEconomicTransferId) {
    throw new FinanceIntegrityScannerValidationError('Finance integrity alert has no allocation or transfer scope to rescan.');
  }

  const result = await runFinanceIntegrityScannerDiagnostics({
    vendorAllocationId: alert.vendorAllocationId,
    allocationEconomicTransferId: alert.allocationEconomicTransferId,
    dryRun,
    db,
  });
  const matchingAlertStillDetected = scannerFindingsIncludeAlertIssue({ alert, result });

  return {
    ...result,
    alertId: alert.id,
    matchingAlertStillDetected,
  };
}

export async function resolveFinanceIntegrityAlertWithScannerValidation(
  input: ResolveFinanceIntegrityAlertWithScannerValidationInput,
): Promise<FinanceIntegrityAlertActionResult> {
  const db = input.db ?? prisma;
  const note = readResolutionNote(input.note);
  const alert = await db.financeIntegrityAlert.findUnique({
    where: {
      id: input.alertId,
    },
    select: {
      id: true,
      dedupeKey: true,
      severity: true,
      category: true,
      reason: true,
      status: true,
      vendorAllocationId: true,
      allocationEconomicTransferId: true,
      acknowledgedAt: true,
      acknowledgedByUserId: true,
      acknowledgmentNote: true,
      resolvedAt: true,
      resolvedByUserId: true,
      resolutionNote: true,
      detectedAt: true,
      updatedAt: true,
    },
  });

  if (!alert) {
    throw new FinanceIntegrityAlertLifecycleError('Finance integrity alert was not found.', 404);
  }

  if (alert.status === 'resolved') {
    throw new FinanceIntegrityAlertLifecycleError('Resolved finance integrity alerts cannot be resolved again.', 409);
  }

  if (alert.status !== 'open' && alert.status !== 'acknowledged') {
    throw new FinanceIntegrityAlertLifecycleError(`Finance integrity alert status ${alert.status} cannot be resolved.`, 409);
  }

  if (!alert.vendorAllocationId && !alert.allocationEconomicTransferId) {
    throw new FinanceIntegrityAlertLifecycleError('Finance integrity alert has no allocation or transfer scope to validate.', 400);
  }

  const validation = await runFinanceIntegrityScannerDiagnostics({
    vendorAllocationId: alert.vendorAllocationId,
    allocationEconomicTransferId: alert.allocationEconomicTransferId,
    dryRun: true,
    db,
  });

  if (scannerFindingsIncludeAlertIssue({ alert, result: validation })) {
    throw new FinanceIntegrityAlertLifecycleError('Cannot resolve alert because the issue is still detected.', 409);
  }

  const resolvedAt = input.resolvedAt ?? new Date();
  return db.financeIntegrityAlert.update({
    where: {
      id: input.alertId,
    },
    data: {
      status: 'resolved',
      resolvedAt,
      resolvedByUserId: input.resolvedByUserId ?? null,
      resolutionNote: note,
      resolutionValidationJson: {
        validatedAt: resolvedAt.toISOString(),
        findingsReturned: validation.findings,
        categoryResolved: alert.category,
        scannerValidated: true,
      } satisfies Prisma.InputJsonValue,
      resolutionType: 'scanner_validated',
    },
  });
}

export const __financeIntegrityScannerTesting = {
  IN_PROGRESS_TRANSFER_STATUSES,
  FAILED_TRANSFER_STATUSES,
};
