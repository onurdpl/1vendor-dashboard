import type { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';

export type CompleteSaleLineage = Readonly<{
  activeSaleFinanceLedgerEntryId: string;
  supersededSaleLedgerIds: readonly string[];
}>;

export type CompleteSaleLineageErrorCode =
  | 'active_sale_missing'
  | 'active_sale_not_authoritative'
  | 'lineage_ambiguous'
  | 'lineage_cycle'
  | 'lineage_reference_missing'
  | 'lineage_non_sale';

export class CompleteSaleLineageResolutionError extends Error {
  constructor(
    public readonly code: CompleteSaleLineageErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CompleteSaleLineageResolutionError';
  }
}

type CompleteSaleLineageDbClient = Pick<Prisma.TransactionClient, 'financeLedgerEntry'>;

type LinkedLedger = {
  id: string;
  entryType: string;
  voidedAt: Date | string | null;
  supersededByLedgerId: string | null;
};

type SaleLineageNode = LinkedLedger & {
  supersedes: LinkedLedger[];
  economicTransfersTo: Array<{
    status: string;
    fromFinanceLedgerEntryId: string | null;
    toFinanceLedgerEntryId: string | null;
    fromFinanceLedgerEntry: LinkedLedger | null;
  }>;
  remainingAllocationSplitEvents: Array<{
    sourceFinanceLedgerEntryId: string | null;
    remainingFinanceLedgerEntryId: string | null;
    childFinanceLedgerEntryId: string | null;
    sourceFinanceLedgerEntry: LinkedLedger | null;
  }>;
  childAllocationSplitEvents: Array<{
    sourceFinanceLedgerEntryId: string | null;
    remainingFinanceLedgerEntryId: string | null;
    childFinanceLedgerEntryId: string | null;
    sourceFinanceLedgerEntry: LinkedLedger | null;
  }>;
};

const ledgerSelect = {
  id: true,
  entryType: true,
  voidedAt: true,
  supersededByLedgerId: true,
} as const;

function normalize(value: unknown) {
  return String(value ?? '').trim().toUpperCase();
}

function assertSaleLedger(ledger: LinkedLedger, context: string) {
  if (normalize(ledger.entryType) !== 'SALE') {
    throw new CompleteSaleLineageResolutionError(
      'lineage_non_sale',
      `${context} ${ledger.id} is not a SALE finance ledger.`,
    );
  }
}

function addReferencedPredecessor(input: {
  candidates: Map<string, LinkedLedger>;
  referencedId: string | null;
  ledger: LinkedLedger | null;
  context: string;
}) {
  if (!input.referencedId || !input.ledger || input.ledger.id !== input.referencedId) {
    throw new CompleteSaleLineageResolutionError(
      'lineage_reference_missing',
      `${input.context} does not resolve to one persisted predecessor finance ledger.`,
    );
  }
  assertSaleLedger(input.ledger, input.context);
  input.candidates.set(input.ledger.id, input.ledger);
}

async function loadLineageNode(
  db: CompleteSaleLineageDbClient,
  ledgerId: string,
): Promise<SaleLineageNode | null> {
  return db.financeLedgerEntry.findUnique({
    where: { id: ledgerId },
    select: {
      ...ledgerSelect,
      supersedes: {
        select: ledgerSelect,
      },
      economicTransfersTo: {
        select: {
          status: true,
          fromFinanceLedgerEntryId: true,
          toFinanceLedgerEntryId: true,
          fromFinanceLedgerEntry: {
            select: ledgerSelect,
          },
        },
      },
      remainingAllocationSplitEvents: {
        select: {
          sourceFinanceLedgerEntryId: true,
          remainingFinanceLedgerEntryId: true,
          childFinanceLedgerEntryId: true,
          sourceFinanceLedgerEntry: {
            select: ledgerSelect,
          },
        },
      },
      childAllocationSplitEvents: {
        select: {
          sourceFinanceLedgerEntryId: true,
          remainingFinanceLedgerEntryId: true,
          childFinanceLedgerEntryId: true,
          sourceFinanceLedgerEntry: {
            select: ledgerSelect,
          },
        },
      },
    },
  });
}

function collectPredecessors(node: SaleLineageNode): Map<string, LinkedLedger> {
  const candidates = new Map<string, LinkedLedger>();

  for (const predecessor of node.supersedes) {
    if (predecessor.supersededByLedgerId !== node.id) {
      throw new CompleteSaleLineageResolutionError(
        'lineage_ambiguous',
        `SALE supersession evidence for ${predecessor.id} does not point to ${node.id}.`,
      );
    }
    assertSaleLedger(predecessor, 'SALE supersession predecessor');
    candidates.set(predecessor.id, predecessor);
  }

  for (const transfer of node.economicTransfersTo) {
    if (normalize(transfer.status) !== 'COMPLETED' || transfer.toFinanceLedgerEntryId !== node.id) {
      throw new CompleteSaleLineageResolutionError(
        'lineage_ambiguous',
        `Economic-transfer lineage targeting ${node.id} is not a completed coherent transition.`,
      );
    }
    addReferencedPredecessor({
      candidates,
      referencedId: transfer.fromFinanceLedgerEntryId,
      ledger: transfer.fromFinanceLedgerEntry,
      context: `Economic-transfer lineage targeting ${node.id}`,
    });
  }

  const splitEvents = [
    ...node.remainingAllocationSplitEvents.map((event) => ({ event, role: 'remaining' as const })),
    ...node.childAllocationSplitEvents.map((event) => ({ event, role: 'child' as const })),
  ];
  for (const { event, role } of splitEvents) {
    const isRemaining = event.remainingFinanceLedgerEntryId === node.id;
    const isChild = event.childFinanceLedgerEntryId === node.id;
    if ((role === 'remaining' && !isRemaining) || (role === 'child' && !isChild) || (isRemaining && isChild)) {
      throw new CompleteSaleLineageResolutionError(
        'lineage_ambiguous',
        `Allocation-split lineage targeting ${node.id} is contradictory.`,
      );
    }
    addReferencedPredecessor({
      candidates,
      referencedId: event.sourceFinanceLedgerEntryId,
      ledger: event.sourceFinanceLedgerEntry,
      context: `Allocation-split lineage targeting ${node.id}`,
    });
  }

  return candidates;
}

export async function resolveCompleteSaleLineage(input: {
  activeSaleFinanceLedgerEntryId: string;
  db?: CompleteSaleLineageDbClient;
}): Promise<CompleteSaleLineage> {
  const activeSaleFinanceLedgerEntryId = input.activeSaleFinanceLedgerEntryId.trim();
  if (!activeSaleFinanceLedgerEntryId) {
    throw new CompleteSaleLineageResolutionError('active_sale_missing', 'Active SALE finance ledger identity is required.');
  }

  const db = input.db ?? prisma;
  const visited = new Set<string>();
  const newestToOldest: string[] = [];
  let currentLedgerId = activeSaleFinanceLedgerEntryId;
  let isActive = true;
  let activeSupersededByLedgerId: string | null = null;

  while (true) {
    if (visited.has(currentLedgerId)) {
      throw new CompleteSaleLineageResolutionError(
        'lineage_cycle',
        `SALE lineage contains a cycle at ${currentLedgerId}.`,
      );
    }
    visited.add(currentLedgerId);

    const node = await loadLineageNode(db, currentLedgerId);
    if (!node) {
      throw new CompleteSaleLineageResolutionError(
        isActive ? 'active_sale_missing' : 'lineage_reference_missing',
        `SALE lineage ledger ${currentLedgerId} could not be loaded.`,
      );
    }
    assertSaleLedger(node, isActive ? 'Active finance ledger' : 'Historical predecessor');

    if (isActive) {
      if (node.voidedAt) {
        throw new CompleteSaleLineageResolutionError(
          'active_sale_not_authoritative',
          `Active SALE finance ledger ${node.id} is voided.`,
        );
      }
      activeSupersededByLedgerId = node.supersededByLedgerId;
      isActive = false;
    } else if (!node.voidedAt) {
      throw new CompleteSaleLineageResolutionError(
        'lineage_ambiguous',
        `Historical SALE predecessor ${node.id} is not voided.`,
      );
    }

    const candidates = collectPredecessors(node);
    const candidateIds = [...candidates.keys()].sort();
    if (candidateIds.length === 0) {
      break;
    }
    if (candidateIds.length > 1) {
      throw new CompleteSaleLineageResolutionError(
        'lineage_ambiguous',
        `SALE lineage for ${node.id} has multiple persisted predecessors: ${candidateIds.join(', ')}.`,
      );
    }

    const predecessorId = candidateIds[0];
    newestToOldest.push(predecessorId);
    currentLedgerId = predecessorId;
  }

  if (activeSupersededByLedgerId) {
    throw new CompleteSaleLineageResolutionError(
      'active_sale_not_authoritative',
      `Active SALE finance ledger ${activeSaleFinanceLedgerEntryId} is superseded by ${activeSupersededByLedgerId}.`,
    );
  }

  return {
    activeSaleFinanceLedgerEntryId,
    supersededSaleLedgerIds: newestToOldest.reverse(),
  };
}
