import type { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { isLedgerVoided } from './active-ledger-policy.service.js';
import {
  createOrUpdateAlert,
  financeIntegrityAlertDedupeKey,
  type FinanceIntegrityAlertCategory,
  type FinanceIntegrityAlertSeverity,
} from './finance-integrity-alert.service.js';

type FinanceIntegrityScannerDbClient = Pick<Prisma.TransactionClient, 'vendorAllocation' | 'financeIntegrityAlert'>;

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

export async function detectNoActiveSaleLedger(input: {
  vendorAllocationId: string;
  db?: FinanceIntegrityScannerDbClient;
}) {
  const db = input.db ?? prisma;
  const allocation = await loadAllocationSnapshot(input.vendorAllocationId, db);
  if (!allocation) {
    return null;
  }

  const activeLedgers = activeSaleLedgers(allocation);
  const supersededTargets = activeSupersededTargets(allocation);
  if (activeLedgers.length > 0 || supersededTargets.length > 0) {
    return null;
  }

  return createScannerAlert({
    category: 'no_active_sale_ledger',
    vendorAllocationId: allocation.id,
    affectedLedgerIds: voidedSaleLedgers(allocation).map((ledger) => ledger.id),
    reason: 'No active sale ledger exists for allocation.',
    metadataJson: {
      voidedSaleLedgerIds: voidedSaleLedgers(allocation).map((ledger) => ledger.id),
    },
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

  const ledgers = activeSaleLedgers(allocation);
  if (ledgers.length <= 1) {
    return null;
  }

  return createScannerAlert({
    category: 'multiple_active_sale_ledgers',
    vendorAllocationId: allocation.id,
    affectedLedgerIds: ledgers.map((ledger) => ledger.id),
    reason: 'Multiple active sale ledgers exist for allocation.',
    metadataJson: {
      activeSaleLedgerIds: ledgers.map((ledger) => ledger.id),
    },
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

  const alerts = [];
  for (const ledger of voidedSaleLedgers(allocation)) {
    if (!ledger.supersededByLedgerId) {
      alerts.push(await createScannerAlert({
        category: 'voided_sale_ledger_without_successor',
        vendorAllocationId: allocation.id,
        ledgerId: ledger.id,
        affectedLedgerIds: [ledger.id],
        reason: 'Voided sale ledger does not reference a successor ledger.',
      }, db));
      continue;
    }

    if (!ledger.supersededBy || isLedgerVoided(ledger.supersededBy)) {
      alerts.push(await createScannerAlert({
        category: 'superseded_ledger_missing_target',
        vendorAllocationId: allocation.id,
        ledgerId: ledger.id,
        affectedLedgerIds: [ledger.id, ledger.supersededByLedgerId],
        reason: 'Voided sale ledger references a missing or voided successor ledger.',
        metadataJson: {
          supersededByLedgerId: ledger.supersededByLedgerId,
        },
      }, db));
    }
  }

  return alerts;
}

export async function detectTransferFailureStates(input: {
  vendorAllocationId: string;
  db?: FinanceIntegrityScannerDbClient;
}) {
  const db = input.db ?? prisma;
  const allocation = await loadAllocationSnapshot(input.vendorAllocationId, db);
  if (!allocation) {
    return [];
  }

  const alerts = [];
  for (const transfer of allocation.economicTransfers) {
    const status = normalize(transfer.status);
    const category = IN_PROGRESS_TRANSFER_STATUSES.has(status)
      ? 'transfer_in_progress'
      : FAILED_TRANSFER_STATUSES.has(status)
        ? 'transfer_failed'
        : null;

    if (!category) {
      continue;
    }

    alerts.push(await createScannerAlert({
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
      metadataJson: {
        transferStatus: transfer.status,
        failureReason: transfer.failureReason ?? null,
      },
    }, db));
  }

  return alerts;
}

export const __financeIntegrityScannerTesting = {
  IN_PROGRESS_TRANSFER_STATUSES,
  FAILED_TRANSFER_STATUSES,
};
