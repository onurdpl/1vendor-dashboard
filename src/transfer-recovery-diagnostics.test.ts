import { describe, expect, it } from 'vitest';

import {
  getTransferRecoveryDiagnostics,
} from '../backend/src/modules/finance/transfer-recovery-diagnostics.service.js';

type LedgerInput = {
  id: string;
  vendorId: string;
  entryType?: string;
  voidedAt?: Date | null;
  supersededByLedgerId?: string | null;
  supersededBy?: {
    id: string;
    vendorId: string;
    entryType: string;
    voidedAt?: Date | null;
  } | null;
};

type TransferInput = {
  id: string;
  vendorAllocationId?: string;
  fromVendorId?: string;
  toVendorId?: string;
  fromFinanceLedgerEntryId?: string | null;
  toFinanceLedgerEntryId?: string | null;
  status: string;
  createdAt?: Date;
  completedAt?: Date | null;
};

type AlertInput = {
  id: string;
  severity: string;
  category: string;
  reason: string;
  status: string;
  vendorAllocationId?: string | null;
  allocationEconomicTransferId?: string | null;
  detectedAt?: Date;
};

function buildDb(input: {
  assignedVendorId?: string;
  financeEntries?: LedgerInput[];
  transfers?: TransferInput[];
  alerts?: AlertInput[];
} = {}) {
  const allocationId = 'alloc-1';
  const transfers = input.transfers ?? [];
  const financeEntries = input.financeEntries ?? [];
  const alerts = input.alerts ?? [];

  return {
    allocationEconomicTransfer: {
      findUnique: async (args: { where: { id: string } }) => {
        const transfer = transfers.find((item) => item.id === args.where.id);
        return transfer
          ? {
              vendorAllocationId: allocationId,
              fromVendorId: 'vendor-a',
              toVendorId: 'vendor-b',
              fromFinanceLedgerEntryId: null,
              toFinanceLedgerEntryId: null,
              createdAt: new Date('2026-06-21T10:00:00.000Z'),
              ...transfer,
            }
          : null;
      },
      findFirst: async () => {
        const transfer = transfers[0];
        return transfer
          ? {
              vendorAllocationId: allocationId,
              fromVendorId: 'vendor-a',
              toVendorId: 'vendor-b',
              fromFinanceLedgerEntryId: null,
              toFinanceLedgerEntryId: null,
              createdAt: new Date('2026-06-21T10:00:00.000Z'),
              ...transfer,
            }
          : null;
      },
    },
    vendorAllocation: {
      findUnique: async (args: { where: { id: string } }) => {
        if (args.where.id !== allocationId) {
          return null;
        }

        return {
          id: allocationId,
          assignedVendorId: input.assignedVendorId ?? 'vendor-a',
          financeEntries,
          economicTransfers: transfers,
        };
      },
    },
    financeIntegrityAlert: {
      findMany: async () => alerts.map((alert) => ({
        detectedAt: new Date('2026-06-21T11:00:00.000Z'),
        vendorAllocationId: allocationId,
        allocationEconomicTransferId: null,
        ...alert,
      })),
    },
  };
}

describe('transfer recovery diagnostics', () => {
  it('classifies a completed transfer with active target and voided source as healthy', async () => {
    const result = await getTransferRecoveryDiagnostics({
      allocationEconomicTransferId: 'transfer-1',
      db: buildDb({
        assignedVendorId: 'vendor-b',
        transfers: [
          {
            id: 'transfer-1',
            status: 'COMPLETED',
            fromFinanceLedgerEntryId: 'fin-a-sale',
            toFinanceLedgerEntryId: 'fin-b-sale',
          },
        ],
        financeEntries: [
          {
            id: 'fin-a-sale',
            vendorId: 'vendor-a',
            entryType: 'sale',
            voidedAt: new Date('2026-06-21T10:00:00.000Z'),
            supersededByLedgerId: 'fin-b-sale',
          },
          {
            id: 'fin-b-sale',
            vendorId: 'vendor-b',
            entryType: 'sale',
            voidedAt: null,
          },
        ],
      }) as never,
    });

    expect(result).toMatchObject({
      transferId: 'transfer-1',
      transferStatus: 'COMPLETED',
      recoveryClassification: 'healthy',
      sourceLedger: {
        id: 'fin-a-sale',
        exists: true,
        active: false,
        voided: true,
        supersededByLedgerId: 'fin-b-sale',
      },
      targetLedger: {
        id: 'fin-b-sale',
        exists: true,
        active: true,
        voided: false,
      },
      assignment: {
        assignedVendorId: 'vendor-b',
        expectedVendorId: 'vendor-b',
        consistent: true,
      },
      economicOwner: {
        ownerVendorId: 'vendor-b',
        activeSaleLedgerId: 'fin-b-sale',
        resolutionStatus: 'resolved',
      },
    });
  });

  it('classifies a failed transfer with source active, target missing, and assignment unchanged as retry candidate', async () => {
    const result = await getTransferRecoveryDiagnostics({
      allocationEconomicTransferId: 'transfer-1',
      db: buildDb({
        assignedVendorId: 'vendor-a',
        transfers: [
          {
            id: 'transfer-1',
            status: 'FAILED',
            fromFinanceLedgerEntryId: 'fin-a-sale',
            toFinanceLedgerEntryId: 'fin-b-sale',
          },
        ],
        financeEntries: [
          {
            id: 'fin-a-sale',
            vendorId: 'vendor-a',
            entryType: 'sale',
            voidedAt: null,
          },
        ],
      }) as never,
    });

    expect(result.recoveryClassification).toBe('retry_candidate');
    expect(result.recommendedAction).toContain('Retry may be safe');
  });

  it('classifies transferred ledger and assignment state with incomplete transfer status as force complete candidate', async () => {
    const result = await getTransferRecoveryDiagnostics({
      allocationEconomicTransferId: 'transfer-1',
      db: buildDb({
        assignedVendorId: 'vendor-b',
        transfers: [
          {
            id: 'transfer-1',
            status: 'FAILED',
            fromFinanceLedgerEntryId: 'fin-a-sale',
            toFinanceLedgerEntryId: 'fin-b-sale',
          },
        ],
        financeEntries: [
          {
            id: 'fin-a-sale',
            vendorId: 'vendor-a',
            entryType: 'sale',
            voidedAt: new Date('2026-06-21T10:00:00.000Z'),
            supersededByLedgerId: 'fin-b-sale',
          },
          {
            id: 'fin-b-sale',
            vendorId: 'vendor-b',
            entryType: 'sale',
            voidedAt: null,
          },
        ],
      }) as never,
    });

    expect(result.recoveryClassification).toBe('force_complete_candidate');
    expect(result.recommendedAction).toContain('Force completion may be safe');
  });

  it('classifies multiple active ledgers as manual investigation required', async () => {
    const result = await getTransferRecoveryDiagnostics({
      allocationEconomicTransferId: 'transfer-1',
      db: buildDb({
        assignedVendorId: 'vendor-b',
        transfers: [
          {
            id: 'transfer-1',
            status: 'COMPLETED',
            fromFinanceLedgerEntryId: 'fin-a-sale',
            toFinanceLedgerEntryId: 'fin-b-sale',
          },
        ],
        financeEntries: [
          {
            id: 'fin-a-sale',
            vendorId: 'vendor-a',
            entryType: 'sale',
            voidedAt: null,
          },
          {
            id: 'fin-b-sale',
            vendorId: 'vendor-b',
            entryType: 'sale',
            voidedAt: null,
          },
        ],
      }) as never,
    });

    expect(result.recoveryClassification).toBe('manual_investigation_required');
    expect(result.recommendedAction).toContain('Multiple active sale ledgers');
  });

  it('classifies blocking finance integrity alerts as manual investigation required', async () => {
    const result = await getTransferRecoveryDiagnostics({
      allocationEconomicTransferId: 'transfer-1',
      db: buildDb({
        assignedVendorId: 'vendor-a',
        transfers: [
          {
            id: 'transfer-1',
            status: 'FAILED',
            fromFinanceLedgerEntryId: 'fin-a-sale',
            toFinanceLedgerEntryId: 'fin-b-sale',
          },
        ],
        financeEntries: [
          {
            id: 'fin-a-sale',
            vendorId: 'vendor-a',
            entryType: 'sale',
            voidedAt: null,
          },
        ],
        alerts: [
          {
            id: 'alert-1',
            severity: 'critical',
            category: 'transfer_failed',
            reason: 'Economic transfer failed.',
            status: 'open',
            allocationEconomicTransferId: 'transfer-1',
          },
        ],
      }) as never,
    });

    expect(result.recoveryClassification).toBe('manual_investigation_required');
    expect(result.financeIntegrityAlerts).toHaveLength(1);
  });
});
