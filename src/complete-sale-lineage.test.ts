import { describe, expect, it } from 'vitest';
import {
  CompleteSaleLineageResolutionError,
  resolveCompleteSaleLineage,
} from '../backend/src/modules/finance/complete-sale-lineage.service.js';
import { resolveEconomicOwnerForAllocation } from '../backend/src/modules/finance/economic-owner-resolution.service.js';

type LedgerNode = {
  id: string;
  vendorId: string;
  entryType: string;
  voidedAt: Date | null;
  supersededByLedgerId: string | null;
  supersedes: LedgerNode[];
  economicTransfersTo: Array<{
    status: string;
    fromFinanceLedgerEntryId: string | null;
    toFinanceLedgerEntryId: string | null;
    fromFinanceLedgerEntry: LedgerNode | null;
  }>;
  remainingAllocationSplitEvents: Array<{
    sourceFinanceLedgerEntryId: string | null;
    remainingFinanceLedgerEntryId: string | null;
    childFinanceLedgerEntryId: string | null;
    sourceFinanceLedgerEntry: LedgerNode | null;
  }>;
  childAllocationSplitEvents: Array<{
    sourceFinanceLedgerEntryId: string | null;
    remainingFinanceLedgerEntryId: string | null;
    childFinanceLedgerEntryId: string | null;
    sourceFinanceLedgerEntry: LedgerNode | null;
  }>;
};

function ledger(
  id: string,
  input: Partial<Omit<LedgerNode, 'id'>> = {},
): LedgerNode {
  return {
    id,
    vendorId: 'vendor-a',
    entryType: 'sale',
    voidedAt: null,
    supersededByLedgerId: null,
    supersedes: [],
    economicTransfersTo: [],
    remainingAllocationSplitEvents: [],
    childAllocationSplitEvents: [],
    ...input,
  };
}

function directPredecessor(predecessor: LedgerNode, replacement: LedgerNode) {
  predecessor.voidedAt = new Date('2026-09-01T10:00:00.000Z');
  predecessor.supersededByLedgerId = replacement.id;
  replacement.supersedes.push(predecessor);
}

function buildDb(nodes: LedgerNode[]) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return {
    financeLedgerEntry: {
      findUnique: async ({ where }: { where: { id: string } }) => byId.get(where.id) ?? null,
    },
  };
}

describe('complete persisted SALE lineage', () => {
  it('returns a proven empty predecessor array for an active SALE with no predecessor', async () => {
    await expect(resolveCompleteSaleLineage({
      activeSaleFinanceLedgerEntryId: 'sale-a',
      db: buildDb([ledger('sale-a')]) as never,
    })).resolves.toEqual({
      activeSaleFinanceLedgerEntryId: 'sale-a',
      supersededSaleLedgerIds: [],
    });
  });

  it.each([
    [['sale-a', 'sale-b'], ['sale-a']],
    [['sale-a', 'sale-b', 'sale-c'], ['sale-a', 'sale-b']],
    [['sale-a', 'sale-b', 'sale-c', 'sale-d'], ['sale-a', 'sale-b', 'sale-c']],
  ])('walks every persisted direct predecessor in %j', async (ids, expected) => {
    const nodes = ids.map((id) => ledger(id));
    for (let index = 0; index < nodes.length - 1; index += 1) {
      directPredecessor(nodes[index], nodes[index + 1]);
    }

    const result = await resolveCompleteSaleLineage({
      activeSaleFinanceLedgerEntryId: nodes.at(-1)!.id,
      db: buildDb(nodes) as never,
    });

    expect(result.supersededSaleLedgerIds).toEqual(expected);
  });

  it('completes T1C lineage even when direct-active economic-owner resolution reports no predecessors', async () => {
    const source = ledger('sale-source', {
      voidedAt: new Date('2026-09-01T10:00:00.000Z'),
      supersededByLedgerId: 'sale-active',
    });
    const active = ledger('sale-active', { supersedes: [source] });
    const db = {
      ...buildDb([source, active]),
      vendorAllocation: {
        findUnique: async () => ({
          id: 'alloc-1',
          financeEntries: [source, active],
          economicTransfers: [],
        }),
      },
    };

    const owner = await resolveEconomicOwnerForAllocation({ vendorAllocationId: 'alloc-1', db: db as never });
    const lineage = await resolveCompleteSaleLineage({
      activeSaleFinanceLedgerEntryId: owner.activeSaleLedgerId!,
      db: db as never,
    });

    expect(owner).toMatchObject({
      activeSaleLedgerId: 'sale-active',
      supersededFromLedgerIds: [],
      economicOwnerVendorId: 'vendor-a',
    });
    expect(lineage.supersededSaleLedgerIds).toEqual(['sale-source']);
  });

  it('includes persisted completed economic-transfer lineage', async () => {
    const source = ledger('sale-transfer-source', { voidedAt: new Date(), supersededByLedgerId: 'sale-transfer-target' });
    const target = ledger('sale-transfer-target', {
      economicTransfersTo: [{
        status: 'COMPLETED',
        fromFinanceLedgerEntryId: source.id,
        toFinanceLedgerEntryId: 'sale-transfer-target',
        fromFinanceLedgerEntry: source,
      }],
    });

    await expect(resolveCompleteSaleLineage({
      activeSaleFinanceLedgerEntryId: target.id,
      db: buildDb([source, target]) as never,
    })).resolves.toMatchObject({ supersededSaleLedgerIds: [source.id] });
  });

  it.each(['remaining', 'child'] as const)('includes persisted allocation-split %s lineage', async (role) => {
    const source = ledger('sale-split-source', { voidedAt: new Date(), supersededByLedgerId: 'sale-split-remaining' });
    const activeId = role === 'remaining' ? 'sale-split-remaining' : 'sale-split-child';
    const event = {
      sourceFinanceLedgerEntryId: source.id,
      remainingFinanceLedgerEntryId: 'sale-split-remaining',
      childFinanceLedgerEntryId: 'sale-split-child',
      sourceFinanceLedgerEntry: source,
    };
    const active = ledger(activeId, role === 'remaining'
      ? { remainingAllocationSplitEvents: [event] }
      : { childAllocationSplitEvents: [event] });

    await expect(resolveCompleteSaleLineage({
      activeSaleFinanceLedgerEntryId: active.id,
      db: buildDb([source, active]) as never,
    })).resolves.toMatchObject({ supersededSaleLedgerIds: [source.id] });
  });

  it('deduplicates the same predecessor persisted by supersession, transfer, and split links', async () => {
    const source = ledger('sale-source', { voidedAt: new Date(), supersededByLedgerId: 'sale-active' });
    const splitEvent = {
      sourceFinanceLedgerEntryId: source.id,
      remainingFinanceLedgerEntryId: 'sale-active',
      childFinanceLedgerEntryId: 'sale-child',
      sourceFinanceLedgerEntry: source,
    };
    const active = ledger('sale-active', {
      supersedes: [source],
      economicTransfersTo: [{
        status: 'COMPLETED',
        fromFinanceLedgerEntryId: source.id,
        toFinanceLedgerEntryId: 'sale-active',
        fromFinanceLedgerEntry: source,
      }],
      remainingAllocationSplitEvents: [splitEvent],
    });

    const result = await resolveCompleteSaleLineage({
      activeSaleFinanceLedgerEntryId: active.id,
      db: buildDb([source, active]) as never,
    });
    expect(result.supersededSaleLedgerIds).toEqual([source.id]);
  });

  it('is deterministic when duplicate persisted mechanisms are returned in different orders', async () => {
    const source = ledger('sale-source', { voidedAt: new Date(), supersededByLedgerId: 'sale-active' });
    const transfers = [
      {
        status: 'COMPLETED',
        fromFinanceLedgerEntryId: source.id,
        toFinanceLedgerEntryId: 'sale-active',
        fromFinanceLedgerEntry: source,
      },
      {
        status: 'COMPLETED',
        fromFinanceLedgerEntryId: source.id,
        toFinanceLedgerEntryId: 'sale-active',
        fromFinanceLedgerEntry: source,
      },
    ];
    const first = ledger('sale-active', { supersedes: [source], economicTransfersTo: transfers });
    const second = ledger('sale-active', { supersedes: [source], economicTransfersTo: [...transfers].reverse() });

    const firstResult = await resolveCompleteSaleLineage({
      activeSaleFinanceLedgerEntryId: first.id,
      db: buildDb([source, first]) as never,
    });
    const secondResult = await resolveCompleteSaleLineage({
      activeSaleFinanceLedgerEntryId: second.id,
      db: buildDb([source, second]) as never,
    });
    expect(secondResult).toEqual(firstResult);
  });

  it('does not include an unrelated nearby REFUND ledger', async () => {
    const active = ledger('sale-active');
    const refund = ledger('refund-nearby', { entryType: 'refund' });
    const result = await resolveCompleteSaleLineage({
      activeSaleFinanceLedgerEntryId: active.id,
      db: buildDb([refund, active]) as never,
    });
    expect(result.supersededSaleLedgerIds).toEqual([]);
  });

  it('fails closed when a persisted lineage edge points to a non-SALE entry', async () => {
    const refund = ledger('refund-linked', {
      entryType: 'refund',
      voidedAt: new Date(),
      supersededByLedgerId: 'sale-active',
    });
    const active = ledger('sale-active', { supersedes: [refund] });
    await expect(resolveCompleteSaleLineage({
      activeSaleFinanceLedgerEntryId: active.id,
      db: buildDb([refund, active]) as never,
    })).rejects.toMatchObject({ code: 'lineage_non_sale' });
  });

  it('fails closed for a multi-node cycle', async () => {
    const a = ledger('sale-a', { voidedAt: new Date(), supersededByLedgerId: 'sale-b' });
    const b = ledger('sale-b', { voidedAt: new Date(), supersededByLedgerId: 'sale-c', supersedes: [a] });
    const c = ledger('sale-c', { supersededByLedgerId: 'sale-a', supersedes: [b] });
    a.supersedes = [c];

    await expect(resolveCompleteSaleLineage({
      activeSaleFinanceLedgerEntryId: c.id,
      db: buildDb([a, b, c]) as never,
    })).rejects.toMatchObject({ code: 'lineage_cycle' });
  });

  it('fails closed for a self-cycle', async () => {
    const active = ledger('sale-active', { supersededByLedgerId: 'sale-active' });
    active.supersedes = [active];
    await expect(resolveCompleteSaleLineage({
      activeSaleFinanceLedgerEntryId: active.id,
      db: buildDb([active]) as never,
    })).rejects.toMatchObject({ code: 'lineage_cycle' });
  });

  it('fails closed for contradictory predecessor branches', async () => {
    const a = ledger('sale-a', { voidedAt: new Date(), supersededByLedgerId: 'sale-active' });
    const b = ledger('sale-b', { voidedAt: new Date(), supersededByLedgerId: 'sale-active' });
    const active = ledger('sale-active', { supersedes: [b, a] });
    await expect(resolveCompleteSaleLineage({
      activeSaleFinanceLedgerEntryId: active.id,
      db: buildDb([a, b, active]) as never,
    })).rejects.toMatchObject({ code: 'lineage_ambiguous' });
  });

  it('fails closed when a persisted split predecessor reference cannot be loaded', async () => {
    const active = ledger('sale-child', {
      childAllocationSplitEvents: [{
        sourceFinanceLedgerEntryId: 'sale-missing',
        remainingFinanceLedgerEntryId: 'sale-remaining',
        childFinanceLedgerEntryId: 'sale-child',
        sourceFinanceLedgerEntry: null,
      }],
    });
    await expect(resolveCompleteSaleLineage({
      activeSaleFinanceLedgerEntryId: active.id,
      db: buildDb([active]) as never,
    })).rejects.toMatchObject({ code: 'lineage_reference_missing' });
  });

  it('uses the repository domain error for structural lineage failures', async () => {
    await expect(resolveCompleteSaleLineage({
      activeSaleFinanceLedgerEntryId: 'missing',
      db: buildDb([]) as never,
    })).rejects.toBeInstanceOf(CompleteSaleLineageResolutionError);
  });
});
