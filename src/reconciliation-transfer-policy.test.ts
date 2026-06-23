import { describe, expect, it } from 'vitest';

import {
  assertRepairAllowed,
  classifySaleLedgerRepairReadiness,
  isTransferRepairBlocked,
  resolveActiveEconomicOwnerForRepair,
} from '../backend/src/modules/reconciliation/reconciliation-transfer-policy.service.js';
import { __reconciliationTesting } from '../backend/src/modules/reconciliation/reconciliation.service.js';

function buildDb(input: {
  allocationId?: string;
  financeEntries?: Array<{
    id: string;
    vendorId: string;
    entryType: string;
    voidedAt?: Date | null;
  }>;
  economicTransfers?: Array<{
    id?: string;
    status: string;
    createdAt?: Date;
  }>;
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

describe('reconciliation transfer-aware repair policy', () => {
  it('blocks repair while an economic transfer is in progress', () => {
    expect(isTransferRepairBlocked([{ status: 'PENDING' }])).toBe('transfer_in_progress');
    expect(isTransferRepairBlocked([{ status: 'in_progress' }])).toBe('transfer_in_progress');
    expect(() => assertRepairAllowed([{ status: 'PROCESSING' }])).toThrow(
      'Economic transfer is in progress for allocation; reconciliation repair is diagnostic-only.',
    );
  });

  it('blocks repair when an economic transfer failed', () => {
    expect(isTransferRepairBlocked([{ status: 'FAILED' }])).toBe('transfer_failed');
    expect(isTransferRepairBlocked([{ status: 'error' }])).toBe('transfer_failed');
    expect(() => assertRepairAllowed([{ status: 'FAILURE' }])).toThrow(
      'Economic transfer failed for allocation; reconciliation repair is diagnostic-only.',
    );
  });

  it('allows repair when no blocking transfer exists', () => {
    expect(isTransferRepairBlocked([])).toBe('allowed');
    expect(isTransferRepairBlocked([{ status: 'COMPLETED' }])).toBe('allowed');
    expect(() => assertRepairAllowed([{ status: 'COMPLETED' }])).not.toThrow();
  });

  it('does not treat voided sale ledgers as active sale ledger evidence', () => {
    expect(classifySaleLedgerRepairReadiness({
      financeEntries: [
        {
          id: 'fin-yalispor-sale-1001',
          entryType: 'sale',
          voidedAt: new Date('2026-06-21T10:00:00.000Z'),
        },
      ],
      transfers: [],
    })).toEqual({
      status: 'voided_sale_ledger_ignored',
      activeSaleLedgerIds: [],
      voidedSaleLedgerIds: ['fin-yalispor-sale-1001'],
      reason: 'Allocation has only voided sale ledger rows; reconciliation will not treat them as active.',
    });
  });

  it('classifies exactly one non-voided sale ledger as active', () => {
    expect(classifySaleLedgerRepairReadiness({
      financeEntries: [
        {
          id: 'fin-sporjinal-sale-1001',
          entryType: 'sale',
          voidedAt: null,
        },
      ],
      transfers: [],
    })).toEqual({
      status: 'active_sale_ledger_exists',
      activeSaleLedgerIds: ['fin-sporjinal-sale-1001'],
      voidedSaleLedgerIds: [],
    });
  });

  it('uses allocation-scoped sale ledger ids for reconciliation repair expectations', () => {
    expect(__reconciliationTesting.buildExpectedSaleLedgerIdForReconciliation({
      assignedVendorId: 'sporjinal',
      sourceShopifyOrderId: '7616676626769',
      vendorAllocationId: 'alloc-sporjinal-7616676626769-a',
    })).toBe('fin-sporjinal-sale-7616676626769-alloc-sporjinal-7616676626769-a');

    expect(__reconciliationTesting.buildExpectedSaleLedgerIdForReconciliation({
      assignedVendorId: 'sporjinal',
      sourceShopifyOrderId: '7616676626769',
      vendorAllocationId: 'alloc-sporjinal-7616676626769-b',
    })).toBe('fin-sporjinal-sale-7616676626769-alloc-sporjinal-7616676626769-b');
  });

  it('resolves repair owner from active economic sale ledger', async () => {
    await expect(resolveActiveEconomicOwnerForRepair({
      vendorAllocationId: 'alloc-1',
      transfers: [{ status: 'COMPLETED' }],
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

  it('throws diagnostic-only errors when repair owner cannot be resolved', async () => {
    await expect(resolveActiveEconomicOwnerForRepair({
      vendorAllocationId: 'alloc-1',
      db: buildDb() as never,
    })).rejects.toThrow('No active sale ledger found for allocation; reconciliation repair is diagnostic-only.');

    await expect(resolveActiveEconomicOwnerForRepair({
      vendorAllocationId: 'alloc-1',
      transfers: [{ status: 'STARTED' }],
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
    })).rejects.toThrow('Economic transfer is in progress for allocation; reconciliation repair is diagnostic-only.');
  });
});
