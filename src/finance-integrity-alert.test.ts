import { describe, expect, it } from 'vitest';

import {
  createOrUpdateAlert,
  assertNoOpenFinanceIntegrityAlertForMoneyMovement,
  findBlockingFinanceIntegrityAlerts,
  findAlertsForAllocation,
  findOpenAlerts,
  resolveAlert,
} from '../backend/src/modules/finance/finance-integrity-alert.service.js';
import {
  detectMultipleActiveSaleLedgers,
  detectNoActiveSaleLedger,
  detectTransferFailureStates,
  detectVoidedLedgerWithoutSuccessor,
} from '../backend/src/modules/finance/finance-integrity-scanner.service.js';

type AlertRow = Record<string, unknown> & {
  id: string;
  dedupeKey: string;
  status: string;
  category: string;
  vendorAllocationId?: string | null;
  detectedAt: Date;
};

type AllocationInput = {
  id: string;
  financeEntries?: Array<{
    id: string;
    vendorId?: string;
    entryType: string;
    voidedAt?: Date | null;
    supersededByLedgerId?: string | null;
    supersededBy?: {
      id: string;
      entryType: string;
      voidedAt?: Date | null;
    } | null;
  }>;
  economicTransfers?: Array<{
    id: string;
    status: string;
    failureReason?: string | null;
    fromFinanceLedgerEntryId?: string | null;
    toFinanceLedgerEntryId?: string | null;
  }>;
};

function buildDb(allocations: AllocationInput[] = []) {
  const alerts: AlertRow[] = [];
  let nextAlertNumber = 1;

  return {
    __alerts: alerts,
    financeIntegrityAlert: {
      upsert: async (args: { where: { dedupeKey: string }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
        const existing = alerts.find((alert) => alert.dedupeKey === args.where.dedupeKey);
        if (existing) {
          Object.assign(existing, args.update, { updatedAt: new Date('2026-06-21T12:00:00.000Z') });
          return existing;
        }

        const created = {
          id: `alert-${nextAlertNumber++}`,
          detectedAt: new Date('2026-06-21T10:00:00.000Z'),
          createdAt: new Date('2026-06-21T10:00:00.000Z'),
          updatedAt: new Date('2026-06-21T10:00:00.000Z'),
          ...args.create,
        } as AlertRow;
        alerts.push(created);
        return created;
      },
      update: async (args: { where: { id?: string; dedupeKey?: string }; data: Record<string, unknown> }) => {
        const alert = alerts.find((row) =>
          args.where.id ? row.id === args.where.id : row.dedupeKey === args.where.dedupeKey
        );
        if (!alert) {
          throw new Error('Alert not found');
        }

        Object.assign(alert, args.data, { updatedAt: new Date('2026-06-21T12:00:00.000Z') });
        return alert;
      },
      findMany: async (args: {
        where?: {
          status?: string;
          vendorAllocationId?: string;
          allocationEconomicTransferId?: string;
          severity?: { in?: string[] };
          category?: { in?: string[] };
          OR?: Array<{ vendorAllocationId?: string; allocationEconomicTransferId?: string }>;
        };
        select?: Record<string, boolean>;
        orderBy?: unknown;
      }) => {
        return alerts.filter((alert) => {
          if (args.where?.status && alert.status !== args.where.status) {
            return false;
          }
          if (args.where?.severity?.in && !args.where.severity.in.includes(String(alert.severity))) {
            return false;
          }
          if (args.where?.category?.in && !args.where.category.in.includes(alert.category)) {
            return false;
          }
          if (args.where?.vendorAllocationId && alert.vendorAllocationId !== args.where.vendorAllocationId) {
            return false;
          }
          if (
            args.where?.allocationEconomicTransferId &&
            alert.allocationEconomicTransferId !== args.where.allocationEconomicTransferId
          ) {
            return false;
          }
          if (args.where?.OR?.length) {
            return args.where.OR.some((filter) => {
              if (filter.vendorAllocationId && alert.vendorAllocationId === filter.vendorAllocationId) {
                return true;
              }
              if (
                filter.allocationEconomicTransferId &&
                alert.allocationEconomicTransferId === filter.allocationEconomicTransferId
              ) {
                return true;
              }
              return false;
            });
          }
          return true;
        });
      },
    },
    vendorAllocation: {
      findUnique: async (args: { where: { id: string } }) => {
        const allocation = allocations.find((item) => item.id === args.where.id);
        if (!allocation) {
          return null;
        }
        return {
          id: allocation.id,
          financeEntries: allocation.financeEntries ?? [],
          economicTransfers: allocation.economicTransfers ?? [],
        };
      },
    },
  };
}

describe('finance integrity alert foundation', () => {
  it('creates an alert', async () => {
    const db = buildDb();

    const alert = await createOrUpdateAlert({
      dedupeKey: 'finance-integrity:no-active:alloc-1',
      severity: 'critical',
      category: 'no_active_sale_ledger',
      vendorAllocationId: 'alloc-1',
      reason: 'No active sale ledger exists for allocation.',
    }, db as never);

    expect(alert).toMatchObject({
      dedupeKey: 'finance-integrity:no-active:alloc-1',
      severity: 'critical',
      category: 'no_active_sale_ledger',
      status: 'open',
    });
    expect(db.__alerts).toHaveLength(1);
  });

  it('dedupes and updates an existing alert', async () => {
    const db = buildDb();

    await createOrUpdateAlert({
      dedupeKey: 'finance-integrity:multiple:alloc-1',
      severity: 'warning',
      category: 'multiple_active_sale_ledgers',
      vendorAllocationId: 'alloc-1',
      reason: 'Initial reason.',
    }, db as never);
    const updated = await createOrUpdateAlert({
      dedupeKey: 'finance-integrity:multiple:alloc-1',
      severity: 'critical',
      category: 'multiple_active_sale_ledgers',
      vendorAllocationId: 'alloc-1',
      reason: 'Updated reason.',
    }, db as never);

    expect(db.__alerts).toHaveLength(1);
    expect(updated.reason).toBe('Updated reason.');
    expect(updated.severity).toBe('critical');
  });

  it('resolves an alert and can read open/allocation-scoped alerts', async () => {
    const db = buildDb();

    await createOrUpdateAlert({
      dedupeKey: 'finance-integrity:resolve:alloc-1',
      severity: 'critical',
      category: 'transfer_failed',
      vendorAllocationId: 'alloc-1',
      reason: 'Economic transfer failed for allocation.',
    }, db as never);
    await createOrUpdateAlert({
      dedupeKey: 'finance-integrity:open:alloc-2',
      severity: 'warning',
      category: 'transfer_in_progress',
      vendorAllocationId: 'alloc-2',
      reason: 'Economic transfer is in progress for allocation.',
    }, db as never);

    const resolved = await resolveAlert({
      dedupeKey: 'finance-integrity:resolve:alloc-1',
      resolutionNote: 'Verified recovery.',
      resolvedByUserId: 'admin-1',
      resolvedAt: new Date('2026-06-21T11:00:00.000Z'),
    }, db as never);

    expect(resolved).toMatchObject({
      status: 'resolved',
      resolutionNote: 'Verified recovery.',
      resolvedByUserId: 'admin-1',
    });
    await expect(findOpenAlerts(db as never)).resolves.toHaveLength(1);
    await expect(findAlertsForAllocation('alloc-1', db as never)).resolves.toHaveLength(1);
  });

  it('finds warning and critical open alerts as money movement blockers', async () => {
    const db = buildDb();

    await createOrUpdateAlert({
      dedupeKey: 'finance-integrity:warning:alloc-1',
      severity: 'warning',
      category: 'transfer_in_progress',
      vendorAllocationId: 'alloc-1',
      reason: 'Economic transfer is in progress for allocation.',
    }, db as never);
    await createOrUpdateAlert({
      dedupeKey: 'finance-integrity:critical:transfer-1',
      severity: 'critical',
      category: 'transfer_failed',
      allocationEconomicTransferId: 'transfer-1',
      reason: 'Economic transfer failed for allocation.',
    }, db as never);

    await expect(findBlockingFinanceIntegrityAlerts({
      vendorAllocationId: 'alloc-1',
      allocationEconomicTransferId: 'transfer-1',
    }, db as never)).resolves.toHaveLength(2);
  });

  it('does not block money movement for info or resolved alerts by default', async () => {
    const db = buildDb();

    await createOrUpdateAlert({
      dedupeKey: 'finance-integrity:info:alloc-1',
      severity: 'info',
      category: 'transfer_in_progress',
      vendorAllocationId: 'alloc-1',
      reason: 'Advisory transfer note.',
    }, db as never);
    await createOrUpdateAlert({
      dedupeKey: 'finance-integrity:resolved:alloc-1',
      severity: 'critical',
      category: 'multiple_active_sale_ledgers',
      vendorAllocationId: 'alloc-1',
      reason: 'Multiple active sale ledgers exist for allocation.',
    }, db as never);
    await resolveAlert({
      dedupeKey: 'finance-integrity:resolved:alloc-1',
      resolutionNote: 'Fixed.',
    }, db as never);

    await expect(findBlockingFinanceIntegrityAlerts({ vendorAllocationId: 'alloc-1' }, db as never))
      .resolves.toEqual([]);
    await expect(assertNoOpenFinanceIntegrityAlertForMoneyMovement({ vendorAllocationId: 'alloc-1' }, db as never))
      .resolves.toBeUndefined();
  });

  it('throws useful error detail for an open critical blocker', async () => {
    const db = buildDb();

    await createOrUpdateAlert({
      dedupeKey: 'finance-integrity:multiple:alloc-1',
      severity: 'critical',
      category: 'multiple_active_sale_ledgers',
      vendorAllocationId: 'alloc-1',
      reason: 'Multiple active sale ledgers exist for allocation.',
    }, db as never);

    await expect(assertNoOpenFinanceIntegrityAlertForMoneyMovement({ vendorAllocationId: 'alloc-1' }, db as never))
      .rejects.toMatchObject({
        name: 'FinanceIntegrityMoneyMovementBlockedError',
        message: 'Money movement blocked by open finance integrity alert: multiple_active_sale_ledgers.',
        alert: expect.objectContaining({
          category: 'multiple_active_sale_ledgers',
          severity: 'critical',
          reason: 'Multiple active sale ledgers exist for allocation.',
          dedupeKey: 'finance-integrity:multiple:alloc-1',
        }),
      });
  });

  it('creates a multiple active sale ledger alert', async () => {
    const db = buildDb([
      {
        id: 'alloc-1',
        financeEntries: [
          { id: 'fin-a-sale', vendorId: 'vendor-a', entryType: 'sale', voidedAt: null },
          { id: 'fin-b-sale', vendorId: 'vendor-b', entryType: 'sale', voidedAt: null },
        ],
      },
    ]);

    const alert = await detectMultipleActiveSaleLedgers({ vendorAllocationId: 'alloc-1', db: db as never });

    expect(alert).toMatchObject({
      category: 'multiple_active_sale_ledgers',
      severity: 'critical',
      vendorAllocationId: 'alloc-1',
      affectedLedgerIds: ['fin-a-sale', 'fin-b-sale'],
    });
  });

  it('creates a no active sale ledger alert', async () => {
    const db = buildDb([
      {
        id: 'alloc-1',
        financeEntries: [],
      },
    ]);

    const alert = await detectNoActiveSaleLedger({ vendorAllocationId: 'alloc-1', db: db as never });

    expect(alert).toMatchObject({
      category: 'no_active_sale_ledger',
      severity: 'critical',
      reason: 'No active sale ledger exists for allocation.',
    });
  });

  it('creates a transfer failure alert', async () => {
    const db = buildDb([
      {
        id: 'alloc-1',
        economicTransfers: [
          {
            id: 'transfer-1',
            status: 'FAILED',
            failureReason: 'Target ledger create failed.',
            fromFinanceLedgerEntryId: 'fin-a-sale',
          },
        ],
      },
    ]);

    const alerts = await detectTransferFailureStates({ vendorAllocationId: 'alloc-1', db: db as never });

    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      category: 'transfer_failed',
      severity: 'critical',
      allocationEconomicTransferId: 'transfer-1',
      affectedLedgerIds: ['fin-a-sale'],
    });
  });

  it('creates the expected superseded ledger missing target scanner category', async () => {
    const db = buildDb([
      {
        id: 'alloc-1',
        financeEntries: [
          {
            id: 'fin-a-sale',
            vendorId: 'vendor-a',
            entryType: 'sale',
            voidedAt: new Date('2026-06-21T10:00:00.000Z'),
            supersededByLedgerId: 'fin-b-sale',
            supersededBy: null,
          },
        ],
      },
    ]);

    const alerts = await detectVoidedLedgerWithoutSuccessor({ vendorAllocationId: 'alloc-1', db: db as never });

    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      category: 'superseded_ledger_missing_target',
      severity: 'critical',
      affectedLedgerIds: ['fin-a-sale', 'fin-b-sale'],
    });
  });
});
