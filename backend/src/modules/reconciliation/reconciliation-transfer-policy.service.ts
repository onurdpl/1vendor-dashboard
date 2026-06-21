import type { Prisma } from '@prisma/client';
import { isLedgerVoided } from '../finance/active-ledger-policy.service.js';
import {
  resolveEconomicOwnerForAllocation,
  type EconomicOwnerResolution,
} from '../finance/economic-owner-resolution.service.js';

export type TransferRepairStatus = 'allowed' | 'transfer_in_progress' | 'transfer_failed';

type EconomicOwnerRepairDbClient = Pick<Prisma.TransactionClient, 'vendorAllocation'>;

export type TransferSnapshot = {
  status: string | null;
};

export type LedgerRepairSnapshot = {
  id: string;
  entryType: string;
  voidedAt?: Date | string | null;
};

export type SaleLedgerRepairReadiness =
  | {
      status: 'active_sale_ledger_exists';
      activeSaleLedgerIds: string[];
      voidedSaleLedgerIds: string[];
    }
  | {
      status:
        | 'missing_active_sale_ledger'
        | 'multiple_active_sale_ledgers'
        | 'voided_sale_ledger_ignored'
        | 'transfer_in_progress'
        | 'transfer_failed';
      activeSaleLedgerIds: string[];
      voidedSaleLedgerIds: string[];
      reason: string;
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

function isSaleLedger(entry: LedgerRepairSnapshot) {
  return normalize(entry.entryType) === 'SALE';
}

export function isTransferRepairBlocked(transfers: TransferSnapshot[] = []): TransferRepairStatus {
  if (transfers.some((transfer) => IN_PROGRESS_TRANSFER_STATUSES.has(normalize(transfer.status)))) {
    return 'transfer_in_progress';
  }

  if (transfers.some((transfer) => FAILED_TRANSFER_STATUSES.has(normalize(transfer.status)))) {
    return 'transfer_failed';
  }

  return 'allowed';
}

export function repairBlockerMessage(status: Exclude<TransferRepairStatus, 'allowed'>) {
  return status === 'transfer_in_progress'
    ? 'Economic transfer is in progress for allocation; reconciliation repair is diagnostic-only.'
    : 'Economic transfer failed for allocation; reconciliation repair is diagnostic-only.';
}

export function assertRepairAllowed(transfers: TransferSnapshot[] = []): void {
  const transferStatus = isTransferRepairBlocked(transfers);
  if (transferStatus !== 'allowed') {
    throw new Error(repairBlockerMessage(transferStatus));
  }
}

export async function resolveActiveEconomicOwnerForRepair(input: {
  vendorAllocationId: string;
  transfers?: TransferSnapshot[];
  db?: EconomicOwnerRepairDbClient;
}): Promise<EconomicOwnerResolution & {
  resolutionStatus: 'resolved';
  economicOwnerVendorId: string;
  activeSaleLedgerId: string;
}> {
  assertRepairAllowed(input.transfers ?? []);

  const resolution = await resolveEconomicOwnerForAllocation({
    vendorAllocationId: input.vendorAllocationId,
    db: input.db,
  });

  if (resolution.resolutionStatus === 'resolved') {
    return resolution as EconomicOwnerResolution & {
      resolutionStatus: 'resolved';
      economicOwnerVendorId: string;
      activeSaleLedgerId: string;
    };
  }

  if (resolution.resolutionStatus === 'multiple_active_sale_ledgers') {
    throw new Error('Multiple active sale ledgers found for allocation; reconciliation repair is diagnostic-only.');
  }

  if (resolution.resolutionStatus === 'transfer_in_progress') {
    throw new Error(repairBlockerMessage('transfer_in_progress'));
  }

  if (resolution.resolutionStatus === 'transfer_failed') {
    throw new Error(repairBlockerMessage('transfer_failed'));
  }

  throw new Error('No active sale ledger found for allocation; reconciliation repair is diagnostic-only.');
}

export function classifySaleLedgerRepairReadiness(input: {
  financeEntries: LedgerRepairSnapshot[];
  transfers?: TransferSnapshot[];
}): SaleLedgerRepairReadiness {
  const saleLedgers = input.financeEntries.filter(isSaleLedger);
  const activeSaleLedgerIds = saleLedgers
    .filter((entry) => !isLedgerVoided(entry))
    .map((entry) => entry.id);
  const voidedSaleLedgerIds = saleLedgers
    .filter((entry) => isLedgerVoided(entry))
    .map((entry) => entry.id);
  const transferStatus = isTransferRepairBlocked(input.transfers ?? []);

  if (transferStatus !== 'allowed') {
    return {
      status: transferStatus,
      activeSaleLedgerIds,
      voidedSaleLedgerIds,
      reason: repairBlockerMessage(transferStatus),
    };
  }

  if (activeSaleLedgerIds.length === 1) {
    return {
      status: 'active_sale_ledger_exists',
      activeSaleLedgerIds,
      voidedSaleLedgerIds,
    };
  }

  if (activeSaleLedgerIds.length > 1) {
    return {
      status: 'multiple_active_sale_ledgers',
      activeSaleLedgerIds,
      voidedSaleLedgerIds,
      reason: 'Multiple active sale ledgers found for allocation; reconciliation repair is diagnostic-only.',
    };
  }

  if (voidedSaleLedgerIds.length > 0) {
    return {
      status: 'voided_sale_ledger_ignored',
      activeSaleLedgerIds,
      voidedSaleLedgerIds,
      reason: 'Allocation has only voided sale ledger rows; reconciliation will not treat them as active.',
    };
  }

  return {
    status: 'missing_active_sale_ledger',
    activeSaleLedgerIds,
    voidedSaleLedgerIds,
    reason: 'No active sale ledger exists for allocation.',
  };
}

export const __reconciliationTransferPolicyTesting = {
  IN_PROGRESS_TRANSFER_STATUSES,
  FAILED_TRANSFER_STATUSES,
};
