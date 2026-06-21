import type { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { isLedgerVoided } from './active-ledger-policy.service.js';

export type EconomicOwnerResolutionStatus =
  | 'resolved'
  | 'no_active_sale_ledger'
  | 'multiple_active_sale_ledgers'
  | 'transfer_in_progress'
  | 'transfer_failed';

export type EconomicOwnerResolution = {
  vendorAllocationId: string;
  economicOwnerVendorId: string | null;
  activeSaleLedgerId: string | null;
  supersededFromLedgerIds: string[];
  resolutionStatus: EconomicOwnerResolutionStatus;
};

type EconomicOwnerResolutionDbClient = Pick<Prisma.TransactionClient, 'vendorAllocation'>;

type SaleLedgerSnapshot = {
  id: string;
  vendorId: string;
  entryType: string;
  voidedAt?: Date | string | null;
  supersededByLedgerId?: string | null;
  supersededBy?: {
    id: string;
    vendorId: string;
    entryType: string;
    voidedAt?: Date | string | null;
  } | null;
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

function isSaleLedger(ledger: Pick<SaleLedgerSnapshot, 'entryType'> | null | undefined) {
  return normalize(ledger?.entryType) === 'SALE';
}

function buildUnresolvedResult(
  vendorAllocationId: string,
  resolutionStatus: Exclude<EconomicOwnerResolutionStatus, 'resolved'>,
): EconomicOwnerResolution {
  return {
    vendorAllocationId,
    economicOwnerVendorId: null,
    activeSaleLedgerId: null,
    supersededFromLedgerIds: [],
    resolutionStatus,
  };
}

function buildResolvedResult(input: {
  vendorAllocationId: string;
  ledger: Pick<SaleLedgerSnapshot, 'id' | 'vendorId'>;
  supersededFromLedgerIds?: string[];
}): EconomicOwnerResolution {
  return {
    vendorAllocationId: input.vendorAllocationId,
    economicOwnerVendorId: input.ledger.vendorId,
    activeSaleLedgerId: input.ledger.id,
    supersededFromLedgerIds: input.supersededFromLedgerIds ?? [],
    resolutionStatus: 'resolved',
  };
}

function resolveFromDirectActiveLedgers(
  vendorAllocationId: string,
  saleLedgers: SaleLedgerSnapshot[],
): EconomicOwnerResolution | null {
  const activeSaleLedgers = saleLedgers.filter((ledger) => isSaleLedger(ledger) && !isLedgerVoided(ledger));

  if (activeSaleLedgers.length === 1) {
    return buildResolvedResult({
      vendorAllocationId,
      ledger: activeSaleLedgers[0],
    });
  }

  if (activeSaleLedgers.length > 1) {
    return buildUnresolvedResult(vendorAllocationId, 'multiple_active_sale_ledgers');
  }

  return null;
}

function resolveFromSupersededLedgers(
  vendorAllocationId: string,
  saleLedgers: SaleLedgerSnapshot[],
): EconomicOwnerResolution | null {
  const replacementMap = new Map<string, {
    ledger: NonNullable<SaleLedgerSnapshot['supersededBy']>;
    supersededFromLedgerIds: Set<string>;
  }>();

  for (const ledger of saleLedgers) {
    if (!isSaleLedger(ledger) || !isLedgerVoided(ledger) || !ledger.supersededByLedgerId || !ledger.supersededBy) {
      continue;
    }

    const replacement = ledger.supersededBy;
    if (!isSaleLedger(replacement) || isLedgerVoided(replacement)) {
      continue;
    }

    const existing = replacementMap.get(replacement.id) ?? {
      ledger: replacement,
      supersededFromLedgerIds: new Set<string>(),
    };
    existing.supersededFromLedgerIds.add(ledger.id);
    replacementMap.set(replacement.id, existing);
  }

  const replacements = [...replacementMap.values()];
  if (replacements.length === 1) {
    const replacement = replacements[0];
    return buildResolvedResult({
      vendorAllocationId,
      ledger: replacement.ledger,
      supersededFromLedgerIds: [...replacement.supersededFromLedgerIds],
    });
  }

  if (replacements.length > 1) {
    return buildUnresolvedResult(vendorAllocationId, 'multiple_active_sale_ledgers');
  }

  return null;
}

export async function resolveEconomicOwnerForAllocation(input: {
  vendorAllocationId: string;
  db?: EconomicOwnerResolutionDbClient;
}): Promise<EconomicOwnerResolution> {
  const db = input.db ?? prisma;
  const vendorAllocationId = input.vendorAllocationId;
  const allocation = await db.vendorAllocation.findUnique({
    where: { id: vendorAllocationId },
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
              vendorId: true,
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
          createdAt: true,
        },
        orderBy: {
          createdAt: 'desc',
        },
      },
    },
  });

  if (!allocation) {
    return buildUnresolvedResult(vendorAllocationId, 'no_active_sale_ledger');
  }

  const hasInProgressTransfer = allocation.economicTransfers.some((transfer) =>
    IN_PROGRESS_TRANSFER_STATUSES.has(normalize(transfer.status))
  );
  if (hasInProgressTransfer) {
    return buildUnresolvedResult(vendorAllocationId, 'transfer_in_progress');
  }

  const directResolution = resolveFromDirectActiveLedgers(vendorAllocationId, allocation.financeEntries);
  if (directResolution) {
    return directResolution;
  }

  const supersededResolution = resolveFromSupersededLedgers(vendorAllocationId, allocation.financeEntries);
  if (supersededResolution) {
    return supersededResolution;
  }

  const hasFailedTransfer = allocation.economicTransfers.some((transfer) =>
    FAILED_TRANSFER_STATUSES.has(normalize(transfer.status))
  );
  if (hasFailedTransfer) {
    return buildUnresolvedResult(vendorAllocationId, 'transfer_failed');
  }

  return buildUnresolvedResult(vendorAllocationId, 'no_active_sale_ledger');
}

export async function assertResolvedEconomicOwnerForMoneyMovement(input: {
  vendorAllocationId: string;
  db?: EconomicOwnerResolutionDbClient;
}): Promise<EconomicOwnerResolution & {
  resolutionStatus: 'resolved';
  economicOwnerVendorId: string;
  activeSaleLedgerId: string;
}> {
  const resolution = await resolveEconomicOwnerForAllocation(input);

  if (resolution.resolutionStatus === 'resolved') {
    return resolution as EconomicOwnerResolution & {
      resolutionStatus: 'resolved';
      economicOwnerVendorId: string;
      activeSaleLedgerId: string;
    };
  }

  if (resolution.resolutionStatus === 'multiple_active_sale_ledgers') {
    throw new Error('Multiple active sale ledgers found for allocation.');
  }

  if (resolution.resolutionStatus === 'transfer_in_progress') {
    throw new Error('Economic transfer is in progress for allocation.');
  }

  if (resolution.resolutionStatus === 'transfer_failed') {
    throw new Error('Economic transfer failed for allocation.');
  }

  throw new Error('No active sale ledger found for allocation.');
}

export const __economicOwnerResolutionTesting = {
  IN_PROGRESS_TRANSFER_STATUSES,
  FAILED_TRANSFER_STATUSES,
};
