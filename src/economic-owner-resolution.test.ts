import { describe, expect, it } from 'vitest';

import {
  assertResolvedEconomicOwnerForMoneyMovement,
  resolveEconomicOwnerForAllocation,
} from '../backend/src/modules/finance/economic-owner-resolution.service.js';

type LedgerInput = {
  id: string;
  vendorId: string;
  entryType?: string;
  voidedAt?: Date | null;
  supersededByLedgerId?: string | null;
  supersededBy?: LedgerInput | null;
};

type TransferInput = {
  id?: string;
  status: string;
  createdAt?: Date;
};

function buildDb(input: {
  allocationId?: string;
  financeEntries?: LedgerInput[];
  economicTransfers?: TransferInput[];
} = {}) {
  const allocationId = input.allocationId ?? 'alloc-1';
  return {
    vendorAllocation: {
      findUnique: async (args: { where: { id: string } }) => {
        if (args.where.id !== allocationId) {
          return null;
        }

        return {
          id: allocationId,
          financeEntries: input.financeEntries ?? [],
          economicTransfers: input.economicTransfers ?? [],
        };
      },
    },
  };
}

describe('economic owner resolution', () => {
  it('resolves owner from one active sale ledger', async () => {
    const result = await resolveEconomicOwnerForAllocation({
      vendorAllocationId: 'alloc-1',
      db: buildDb({
        financeEntries: [
          {
            id: 'fin-sporjinal-sale-1001',
            vendorId: 'sporjinal',
            entryType: 'sale',
            voidedAt: null,
          },
        ],
      }) as never,
    });

    expect(result).toEqual({
      vendorAllocationId: 'alloc-1',
      economicOwnerVendorId: 'sporjinal',
      activeSaleLedgerId: 'fin-sporjinal-sale-1001',
      supersededFromLedgerIds: [],
      resolutionStatus: 'resolved',
    });
  });

  it('ignores a voided source ledger when an active replacement ledger exists directly on the allocation', async () => {
    const result = await resolveEconomicOwnerForAllocation({
      vendorAllocationId: 'alloc-1',
      db: buildDb({
        financeEntries: [
          {
            id: 'fin-yalispor-sale-1001',
            vendorId: 'yalispor',
            entryType: 'sale',
            voidedAt: new Date('2026-06-21T10:00:00.000Z'),
            supersededByLedgerId: 'fin-sporjinal-sale-1001',
          },
          {
            id: 'fin-sporjinal-sale-1001',
            vendorId: 'sporjinal',
            entryType: 'sale',
            voidedAt: null,
          },
        ],
      }) as never,
    });

    expect(result.resolutionStatus).toBe('resolved');
    expect(result.economicOwnerVendorId).toBe('sporjinal');
    expect(result.activeSaleLedgerId).toBe('fin-sporjinal-sale-1001');
    expect(result.supersededFromLedgerIds).toEqual([]);
  });

  it('follows supersededByLedgerId from a voided source ledger to an active replacement ledger', async () => {
    const result = await resolveEconomicOwnerForAllocation({
      vendorAllocationId: 'alloc-1',
      db: buildDb({
        financeEntries: [
          {
            id: 'fin-yalispor-sale-1001',
            vendorId: 'yalispor',
            entryType: 'sale',
            voidedAt: new Date('2026-06-21T10:00:00.000Z'),
            supersededByLedgerId: 'fin-sporjinal-sale-1001',
            supersededBy: {
              id: 'fin-sporjinal-sale-1001',
              vendorId: 'sporjinal',
              entryType: 'sale',
              voidedAt: null,
            },
          },
        ],
      }) as never,
    });

    expect(result).toEqual({
      vendorAllocationId: 'alloc-1',
      economicOwnerVendorId: 'sporjinal',
      activeSaleLedgerId: 'fin-sporjinal-sale-1001',
      supersededFromLedgerIds: ['fin-yalispor-sale-1001'],
      resolutionStatus: 'resolved',
    });
  });

  it('resolves a transferred allocation from an allocation-scoped active target ledger', async () => {
    const result = await resolveEconomicOwnerForAllocation({
      vendorAllocationId: 'alloc-1',
      db: buildDb({
        financeEntries: [
          {
            id: 'fin-vendor-a-sale-1001',
            vendorId: 'vendor-a',
            entryType: 'sale',
            voidedAt: new Date('2026-06-21T10:00:00.000Z'),
            supersededByLedgerId: 'fin-vendor-b-sale-1001-alloc-1',
          },
          {
            id: 'fin-vendor-b-sale-1001-alloc-1',
            vendorId: 'vendor-b',
            entryType: 'sale',
            voidedAt: null,
          },
        ],
      }) as never,
    });

    expect(result).toEqual({
      vendorAllocationId: 'alloc-1',
      economicOwnerVendorId: 'vendor-b',
      activeSaleLedgerId: 'fin-vendor-b-sale-1001-alloc-1',
      supersededFromLedgerIds: [],
      resolutionStatus: 'resolved',
    });
  });

  it('returns no_active_sale_ledger when none exists', async () => {
    const result = await resolveEconomicOwnerForAllocation({
      vendorAllocationId: 'alloc-1',
      db: buildDb() as never,
    });

    expect(result).toEqual({
      vendorAllocationId: 'alloc-1',
      economicOwnerVendorId: null,
      activeSaleLedgerId: null,
      supersededFromLedgerIds: [],
      resolutionStatus: 'no_active_sale_ledger',
    });
  });

  it('returns multiple_active_sale_ledgers when two active sale ledgers exist', async () => {
    const result = await resolveEconomicOwnerForAllocation({
      vendorAllocationId: 'alloc-1',
      db: buildDb({
        financeEntries: [
          {
            id: 'fin-yalispor-sale-1001',
            vendorId: 'yalispor',
            entryType: 'sale',
            voidedAt: null,
          },
          {
            id: 'fin-sporjinal-sale-1001',
            vendorId: 'sporjinal',
            entryType: 'sale',
            voidedAt: null,
          },
        ],
      }) as never,
    });

    expect(result.resolutionStatus).toBe('multiple_active_sale_ledgers');
    expect(result.economicOwnerVendorId).toBeNull();
  });

  it('returns transfer_in_progress when transfer status is pending and owner cannot be safely resolved', async () => {
    const result = await resolveEconomicOwnerForAllocation({
      vendorAllocationId: 'alloc-1',
      db: buildDb({
        economicTransfers: [
          {
            id: 'transfer-1',
            status: 'pending',
            createdAt: new Date('2026-06-21T10:00:00.000Z'),
          },
        ],
      }) as never,
    });

    expect(result.resolutionStatus).toBe('transfer_in_progress');
  });

  it('returns transfer_in_progress when transfer status is in_progress and owner cannot be safely resolved', async () => {
    const result = await resolveEconomicOwnerForAllocation({
      vendorAllocationId: 'alloc-1',
      db: buildDb({
        economicTransfers: [
          {
            id: 'transfer-1',
            status: 'in_progress',
            createdAt: new Date('2026-06-21T10:00:00.000Z'),
          },
        ],
      }) as never,
    });

    expect(result.resolutionStatus).toBe('transfer_in_progress');
  });

  it('returns transfer_failed when transfer status is failed and no active owner exists', async () => {
    const result = await resolveEconomicOwnerForAllocation({
      vendorAllocationId: 'alloc-1',
      db: buildDb({
        economicTransfers: [
          {
            id: 'transfer-1',
            status: 'failed',
            createdAt: new Date('2026-06-21T10:00:00.000Z'),
          },
        ],
      }) as never,
    });

    expect(result.resolutionStatus).toBe('transfer_failed');
  });

  it('assertion helper throws for unresolved statuses', async () => {
    await expect(assertResolvedEconomicOwnerForMoneyMovement({
      vendorAllocationId: 'alloc-1',
      db: buildDb() as never,
    })).rejects.toThrow('No active sale ledger found for allocation.');

    await expect(assertResolvedEconomicOwnerForMoneyMovement({
      vendorAllocationId: 'alloc-1',
      db: buildDb({
        financeEntries: [
          { id: 'fin-a-sale-1001', vendorId: 'a', entryType: 'sale', voidedAt: null },
          { id: 'fin-b-sale-1001', vendorId: 'b', entryType: 'sale', voidedAt: null },
        ],
      }) as never,
    })).rejects.toThrow('Multiple active sale ledgers found for allocation.');

    await expect(assertResolvedEconomicOwnerForMoneyMovement({
      vendorAllocationId: 'alloc-1',
      db: buildDb({
        economicTransfers: [{ status: 'in_progress' }],
      }) as never,
    })).rejects.toThrow('Economic transfer is in progress for allocation.');

    await expect(assertResolvedEconomicOwnerForMoneyMovement({
      vendorAllocationId: 'alloc-1',
      db: buildDb({
        economicTransfers: [{ status: 'failed' }],
      }) as never,
    })).rejects.toThrow('Economic transfer failed for allocation.');
  });

  it('assertion helper returns resolved owner for resolved status', async () => {
    await expect(assertResolvedEconomicOwnerForMoneyMovement({
      vendorAllocationId: 'alloc-1',
      db: buildDb({
        financeEntries: [
          {
            id: 'fin-sporjinal-sale-1001',
            vendorId: 'sporjinal',
            entryType: 'sale',
            voidedAt: null,
          },
        ],
      }) as never,
    })).resolves.toMatchObject({
      resolutionStatus: 'resolved',
      economicOwnerVendorId: 'sporjinal',
      activeSaleLedgerId: 'fin-sporjinal-sale-1001',
    });
  });
});
