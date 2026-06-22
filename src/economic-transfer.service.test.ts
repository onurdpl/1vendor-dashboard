import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
  vendor: {
    findUnique: vi.fn(),
  },
  vendorAllocation: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  allocationEconomicTransfer: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  financeLedgerEntry: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  vendorFinancialProfile: {
    findFirst: vi.fn(),
  },
  shipmentShippingCost: {
    findFirst: vi.fn(),
  },
  allocationAssignmentHistory: {
    create: vi.fn(),
  },
  financeEvent: {
    createMany: vi.fn(),
  },
  financeIntegrityAlert: {
    findMany: vi.fn(),
    upsert: vi.fn(),
    update: vi.fn(),
  },
}));

const runFinanceIntegrityScannerDiagnosticsMock = vi.hoisted(() => vi.fn());

vi.mock('../backend/src/db/prisma.js', () => ({
  prisma: prismaMock,
}));

vi.mock('../backend/src/modules/finance/finance-integrity-scanner.service.js', () => ({
  runFinanceIntegrityScannerDiagnostics: runFinanceIntegrityScannerDiagnosticsMock,
}));

const {
  EconomicTransferValidationError,
  retryFailedEconomicTransfer,
  transferAllocationEconomics,
} = await import('../backend/src/modules/finance/economic-transfer.service.js');

type TransferRow = {
  id: string;
  vendorAllocationId: string;
  fromVendorId: string;
  toVendorId: string;
  fromFinanceLedgerEntryId: string | null;
  toFinanceLedgerEntryId: string | null;
  status: string;
  reason: string | null;
  adminActorUserId: string | null;
  pricingSnapshotJson?: unknown;
  idempotencyKey: string;
  createdAt: Date;
  completedAt: Date | null;
  failedAt: Date | null;
  failureReason: string | null;
};

type LedgerRow = Record<string, unknown> & {
  id: string;
  vendorId: string;
  entryType: string;
  amount: string;
  payoutStatus: string;
  settlementStatus: string;
  voidedAt: Date | null;
  supersededByLedgerId: string | null;
  settlementApprovalLines: Array<Record<string, unknown>>;
  payoutBatchLines: Array<Record<string, unknown>>;
};

type AllocationRow = Record<string, unknown> & {
  id: string;
  assignedVendorId: string;
  originalVendorId: string;
  allocationStatus: string;
  reassignmentRequired: boolean;
  cancellationReason: string | null;
  financeEntries: LedgerRow[];
  economicTransfers: TransferRow[];
};

function buildSourceLedger(overrides: Partial<LedgerRow> = {}): LedgerRow {
  return {
    id: 'fin-vendor-a-sale-1001',
    vendorAllocationId: 'alloc-1',
    vendorId: 'vendor-a',
    entryType: 'sale',
    amount: '1000.00',
    payoutStatus: 'PENDING',
    description: 'Allocated sale for Shopify order #1001',
    commissionPercentSnapshot: '10.00',
    commissionVatPercentSnapshot: '20.00',
    deductShippingEnabledSnapshot: false,
    shippingModeSnapshot: 'DISABLED',
    fixedShippingFeeSnapshot: null,
    shippingCostSnapshot: null,
    shippingVatAmountSnapshot: null,
    shippingCostSourceSnapshot: null,
    shippingCostProviderSnapshot: null,
    shippingCostIdSnapshot: null,
    financialProfileIdSnapshot: 'profile-vendor-a',
    settlementDelayDaysSnapshot: 21,
    settlementStatus: 'ACCRUING',
    settlementEligibleAt: null,
    accruedAt: new Date('2026-06-20T10:00:00.000Z'),
    payableAt: null,
    settledAt: null,
    settlementHoldReason: null,
    voidedAt: null,
    voidReason: null,
    supersededByLedgerId: null,
    settlementApprovalLines: [],
    payoutBatchLines: [],
    ...overrides,
  };
}

function buildAllocation(overrides: Partial<AllocationRow> = {}): AllocationRow {
  const sourceLedger = buildSourceLedger();
  return {
    id: 'alloc-1',
    sourceShopifyOrderId: 'shopify-order-db-1001',
    sourceShopifyOrderNumber: '#1001',
    originalVendorId: 'vendor-a',
    assignedVendorId: 'vendor-a',
    allocationStatus: 'VENDOR_BLOCKED',
    cancellationReason: 'OUT_OF_STOCK',
    reassignmentRequired: true,
    fulfillmentStatus: 'Pending',
    shippingStatus: 'Awaiting Shipment',
    trackingNumber: null,
    carrier: null,
    createdAt: new Date('2026-06-20T10:00:00.000Z'),
    updatedAt: new Date('2026-06-20T10:05:00.000Z'),
    order: {
      id: 'shopify-order-db-1001',
      sourceShopifyOrderId: '1001',
      sourceShopifyOrderNumber: '#1001',
      currency: 'TRY',
    },
    lineItems: [],
    fulfillment: null,
    shipmentExecutions: [],
    returnRecords: [],
    refundRecords: [],
    financeEntries: [sourceLedger],
    economicTransfers: [],
    ...overrides,
  };
}

function setupDb(input: {
  allocation?: AllocationRow;
  vendors?: string[];
  alerts?: Array<Record<string, unknown>>;
  extraLedgerEntries?: LedgerRow[];
  failOnTargetLedgerCreate?: boolean;
} = {}) {
  const allocation = input.allocation ?? buildAllocation();
  const vendors = new Set(input.vendors ?? ['vendor-a', 'vendor-b']);
  const transfers = allocation.economicTransfers;
  const alerts = input.alerts ?? [];
  const ledgerEntries = [...allocation.financeEntries, ...(input.extraLedgerEntries ?? [])];
  const financeEvents: Array<Record<string, unknown>> = [];
  const histories: Array<Record<string, unknown>> = [];

  prismaMock.$transaction.mockImplementation(async (callback) => callback(prismaMock));
  prismaMock.vendor.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
    vendors.has(where.id) ? { id: where.id } : null,
  );
  prismaMock.vendorAllocation.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
    where.id === allocation.id ? allocation : null,
  );
  prismaMock.vendorAllocation.update.mockImplementation(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
    if (where.id !== allocation.id) {
      throw new Error('Allocation not found');
    }
    Object.assign(allocation, data);
    return allocation;
  });
  prismaMock.allocationEconomicTransfer.findUnique.mockImplementation(async ({ where }: { where: { idempotencyKey?: string; id?: string } }) =>
    transfers.find((transfer) =>
      where.idempotencyKey ? transfer.idempotencyKey === where.idempotencyKey : transfer.id === where.id
    ) ?? null,
  );
  prismaMock.allocationEconomicTransfer.create.mockImplementation(async ({ data }: { data: TransferRow }) => {
    const row = {
      createdAt: new Date('2026-06-21T10:00:00.000Z'),
      completedAt: null,
      failedAt: null,
      failureReason: null,
      fromFinanceLedgerEntryId: null,
      toFinanceLedgerEntryId: null,
      ...data,
    };
    transfers.push(row);
    allocation.economicTransfers = transfers;
    return row;
  });
  prismaMock.allocationEconomicTransfer.update.mockImplementation(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
    const transfer = transfers.find((row) => row.id === where.id);
    if (!transfer) {
      throw new Error('Transfer not found');
    }
    Object.assign(transfer, data);
    return transfer;
  });
  prismaMock.financeLedgerEntry.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
    ledgerEntries.find((ledger) => ledger.id === where.id) ?? null,
  );
  prismaMock.financeLedgerEntry.create.mockImplementation(async ({ data }: { data: LedgerRow }) => {
    if (input.failOnTargetLedgerCreate) {
      throw new Error('target ledger create failed');
    }
    const row = {
      voidedAt: null,
      supersededByLedgerId: null,
      settlementApprovalLines: [],
      payoutBatchLines: [],
      ...data,
    } as LedgerRow;
    allocation.financeEntries.push(row);
    ledgerEntries.push(row);
    return row;
  });
  prismaMock.financeLedgerEntry.update.mockImplementation(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
    const ledger = ledgerEntries.find((row) => row.id === where.id);
    if (!ledger) {
      throw new Error('Ledger not found');
    }
    Object.assign(ledger, data);
    return ledger;
  });
  prismaMock.vendorFinancialProfile.findFirst.mockResolvedValue({
    id: 'profile-vendor-b',
    commissionPercent: '12.00',
    commissionVatPercent: '20.00',
    deductShippingEnabled: false,
    shippingMode: 'DISABLED',
    fixedShippingFee: null,
    settlementDelayDays: 21,
  });
  prismaMock.shipmentShippingCost.findFirst.mockResolvedValue(null);
  prismaMock.financeEvent.createMany.mockImplementation(async ({ data }: { data: Array<Record<string, unknown>> }) => {
    financeEvents.push(...data);
    return { count: data.length };
  });
  prismaMock.allocationAssignmentHistory.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
    histories.push(data);
    return data;
  });
  prismaMock.financeIntegrityAlert.findMany.mockImplementation(async (args: { where?: Record<string, unknown> }) => {
    const where = args.where ?? {};
    const status = where.status as { in?: string[] } | undefined;
    const severity = where.severity as { in?: string[] } | undefined;
    const relationFilters = where.OR as Array<{ vendorAllocationId?: string; allocationEconomicTransferId?: string }> | undefined;
    return alerts.filter((alert) => {
      if (status?.in && !status.in.includes(String(alert.status))) {
        return false;
      }
      if (severity?.in && !severity.in.includes(String(alert.severity))) {
        return false;
      }
      if (relationFilters?.length) {
        return relationFilters.some((filter) =>
          (filter.vendorAllocationId && filter.vendorAllocationId === alert.vendorAllocationId) ||
          (filter.allocationEconomicTransferId && filter.allocationEconomicTransferId === alert.allocationEconomicTransferId)
        );
      }
      return true;
    });
  });
  prismaMock.financeIntegrityAlert.upsert.mockImplementation(async ({ where, create, update }: {
    where: { dedupeKey: string };
    create: Record<string, unknown>;
    update: Record<string, unknown>;
  }) => {
    const existing = alerts.find((alert) => alert.dedupeKey === where.dedupeKey);
    if (existing) {
      Object.assign(existing, update);
      return existing;
    }
    const created = {
      id: `alert-${alerts.length + 1}`,
      detectedAt: new Date('2026-06-21T10:00:00.000Z'),
      createdAt: new Date('2026-06-21T10:00:00.000Z'),
      updatedAt: new Date('2026-06-21T10:00:00.000Z'),
      ...create,
    };
    alerts.push(created);
    return created;
  });
  prismaMock.financeIntegrityAlert.update.mockImplementation(async ({ where, data }: {
    where: { id: string };
    data: Record<string, unknown>;
  }) => {
    const alert = alerts.find((row) => row.id === where.id);
    if (!alert) {
      throw new Error('Alert not found');
    }
    Object.assign(alert, data);
    return alert;
  });

  return {
    allocation,
    transfers,
    alerts,
    financeEvents,
    histories,
  };
}

async function runTransfer() {
  return transferAllocationEconomics({
    vendorAllocationId: 'alloc-1',
    toVendorId: 'vendor-b',
    adminUserId: 'admin-1',
    reason: 'Replacement vendor has stock.',
    confirmTransfer: true,
  });
}

async function runRetry(transferId = 'transfer-failed') {
  return retryFailedEconomicTransfer({
    transferId,
    adminUserId: 'admin-1',
    note: 'Retry after target ledger id fix.',
    confirmRetry: true,
  });
}

describe('economic transfer service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runFinanceIntegrityScannerDiagnosticsMock.mockResolvedValue({
      ok: true,
      dryRun: true,
      writesPerformed: false,
      scope: {
        vendorAllocationId: 'alloc-1',
        allocationEconomicTransferId: 'transfer-failed',
      },
      findings: [],
    });
  });

  it('transfers a blocked allocation to the replacement vendor and supersedes the source ledger', async () => {
    const db = setupDb();

    const result = await runTransfer();

    expect(result).toMatchObject({
      fromVendorId: 'vendor-a',
      toVendorId: 'vendor-b',
      sourceLedgerId: 'fin-vendor-a-sale-1001',
      targetLedgerId: 'fin-vendor-b-sale-1001-alloc-1',
      allocationId: 'alloc-1',
      status: 'COMPLETED',
    });
    const sourceLedger = db.allocation.financeEntries.find((ledger) => ledger.id === 'fin-vendor-a-sale-1001');
    const targetLedger = db.allocation.financeEntries.find((ledger) => ledger.id === 'fin-vendor-b-sale-1001-alloc-1');
    expect(sourceLedger).toMatchObject({
      supersededByLedgerId: 'fin-vendor-b-sale-1001-alloc-1',
      voidReason: expect.stringContaining('economic_transfer:'),
    });
    expect(sourceLedger?.voidedAt).toBeInstanceOf(Date);
    const activeSaleLedgersForAllocation = db.allocation.financeEntries.filter((ledger) =>
      ledger.entryType === 'sale' && !ledger.voidedAt
    );
    expect(activeSaleLedgersForAllocation).toHaveLength(1);
    expect(targetLedger).toMatchObject({
      vendorId: 'vendor-b',
      entryType: 'sale',
      amount: '1000.00',
      voidedAt: null,
      payoutStatus: 'PENDING',
    });
    expect(db.allocation).toMatchObject({
      assignedVendorId: 'vendor-b',
      originalVendorId: 'vendor-a',
      allocationStatus: 'ACTIVE',
      reassignmentRequired: false,
      cancellationReason: null,
    });
    expect(db.transfers[0]).toMatchObject({
      status: 'COMPLETED',
      fromFinanceLedgerEntryId: 'fin-vendor-a-sale-1001',
      toFinanceLedgerEntryId: 'fin-vendor-b-sale-1001-alloc-1',
    });
    expect(db.histories).toContainEqual(expect.objectContaining({
      action: 'economic_transfer_completed',
      fromVendorId: 'vendor-a',
      toVendorId: 'vendor-b',
      actorUserId: 'admin-1',
    }));
    expect(db.financeEvents).toHaveLength(4);
    expect(db.financeEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        eventType: 'SALE_RECORDED',
        vendorId: 'vendor-b',
        financeLedgerEntryId: 'fin-vendor-b-sale-1001-alloc-1',
      }),
      expect.objectContaining({
        eventType: 'VENDOR_PAYABLE_RESERVED',
        vendorId: 'vendor-b',
        financeLedgerEntryId: 'fin-vendor-b-sale-1001-alloc-1',
      }),
    ]));
  });

  it('creates a distinct target ledger when the target vendor already has another allocation in the same Shopify order', async () => {
    const existingTargetVendorOrderLedger = buildSourceLedger({
      id: 'fin-vendor-b-sale-1001',
      vendorAllocationId: 'alloc-existing-vendor-b',
      vendorId: 'vendor-b',
      amount: '250.00',
    });
    const db = setupDb({
      extraLedgerEntries: [existingTargetVendorOrderLedger],
    });

    const result = await runTransfer();

    expect(result.targetLedgerId).toBe('fin-vendor-b-sale-1001-alloc-1');
    expect(db.allocation.financeEntries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'fin-vendor-b-sale-1001-alloc-1',
        vendorAllocationId: 'alloc-1',
        vendorId: 'vendor-b',
        voidedAt: null,
      }),
    ]));
    expect(existingTargetVendorOrderLedger).toMatchObject({
      id: 'fin-vendor-b-sale-1001',
      vendorAllocationId: 'alloc-existing-vendor-b',
      vendorId: 'vendor-b',
      amount: '250.00',
    });
    expect(prismaMock.financeLedgerEntry.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        id: 'fin-vendor-b-sale-1001-alloc-1',
      }),
    }));
  });

  it('still blocks when the allocation-scoped target ledger id already exists', async () => {
    setupDb({
      extraLedgerEntries: [
        buildSourceLedger({
          id: 'fin-vendor-b-sale-1001-alloc-1',
          vendorAllocationId: 'alloc-1',
          vendorId: 'vendor-b',
        }),
      ],
    });

    await expect(runTransfer()).rejects.toThrow('Target vendor sale ledger already exists for this allocation.');
    expect(prismaMock.financeLedgerEntry.create).not.toHaveBeenCalled();
  });

  it.each([
    ['allocation is not VENDOR_BLOCKED', { allocationStatus: 'ACTIVE' }, 'Only vendor-blocked allocations can be economically transferred.'],
    ['reassignmentRequired is false', { reassignmentRequired: false }, 'Allocation is not marked for reassignment review.'],
    ['tracking exists', { trackingNumber: 'TRK-1' }, 'Economic transfer cannot run after fulfillment, shipment, carrier, or tracking evidence exists.'],
    ['carrier exists', { carrier: 'MNG' }, 'Economic transfer cannot run after fulfillment, shipment, carrier, or tracking evidence exists.'],
    ['fulfillment exists', { fulfillment: { id: 'fulfillment-1' } }, 'Economic transfer cannot run after fulfillment, shipment, carrier, or tracking evidence exists.'],
    ['shipment execution exists', { shipmentExecutions: [{ shipmentStatus: 'CREATED', providerShipmentId: null, trackingNumber: null, trackingUrl: null }] }, 'Economic transfer cannot run after fulfillment, shipment, carrier, or tracking evidence exists.'],
    ['return exists', { returnRecords: [{ id: 'return-1' }] }, 'Economic transfer cannot run after return evidence exists.'],
    ['refund exists', { refundRecords: [{ id: 'refund-1' }] }, 'Economic transfer cannot run after refund evidence exists.'],
  ])('blocks transfer when %s', async (_name, overrides, message) => {
    setupDb({
      allocation: buildAllocation(overrides as Partial<AllocationRow>),
    });

    await expect(runTransfer()).rejects.toThrow(message);
    expect(prismaMock.allocationEconomicTransfer.create).not.toHaveBeenCalled();
  });

  it.each([
    [
      'settlement approval line exists',
      buildSourceLedger({
        settlementApprovalLines: [
          {
            settlementApproval: {
              commissionInvoices: [],
            },
          },
        ],
      }),
      'Economic transfer cannot run after settlement approval evidence exists.',
    ],
    [
      'payout batch line exists',
      buildSourceLedger({
        payoutBatchLines: [
          {
            payoutBatch: {
              status: 'DRAFT',
            },
          },
        ],
      }),
      'Economic transfer cannot run after payout batch evidence exists.',
    ],
    [
      'Logo invoice exists',
      buildSourceLedger({
        settlementApprovalLines: [
          {
            settlementApproval: {
              commissionInvoices: [
                {
                  status: 'CREATED',
                },
              ],
            },
          },
        ],
      }),
      'Economic transfer cannot run after commission invoice evidence exists.',
    ],
    [
      'vendor payment evidence exists',
      buildSourceLedger({
        payoutStatus: 'PAID',
      }),
      'Economic transfer cannot run after vendor payment evidence exists.',
    ],
  ])('blocks transfer when %s', async (_name, sourceLedger, message) => {
    setupDb({
      allocation: buildAllocation({
        financeEntries: [sourceLedger],
      }),
    });

    await expect(runTransfer()).rejects.toThrow(message);
    expect(prismaMock.allocationEconomicTransfer.create).not.toHaveBeenCalled();
  });

  it.each([
    [
      'open finance integrity alert exists',
      [{ id: 'alert-1', status: 'open', severity: 'critical', category: 'multiple_active_sale_ledgers', vendorAllocationId: 'alloc-1', reason: 'Bad ledger state.' }],
    ],
    [
      'acknowledged finance integrity alert exists',
      [{ id: 'alert-1', status: 'acknowledged', severity: 'warning', category: 'transfer_in_progress', vendorAllocationId: 'alloc-1', reason: 'Operator saw it.' }],
    ],
  ])('blocks transfer when %s', async (_name, alerts) => {
    setupDb({ alerts });

    await expect(runTransfer()).rejects.toThrow('Money movement blocked by blocking finance integrity alert');
    expect(prismaMock.allocationEconomicTransfer.create).not.toHaveBeenCalled();
  });

  it('blocks transfer when no active sale ledger exists', async () => {
    setupDb({
      allocation: buildAllocation({
        financeEntries: [],
      }),
    });

    await expect(runTransfer()).rejects.toThrow('No active sale ledger found for allocation.');
  });

  it('blocks transfer when multiple active sale ledgers exist', async () => {
    setupDb({
      allocation: buildAllocation({
        financeEntries: [
          buildSourceLedger(),
          buildSourceLedger({ id: 'fin-vendor-c-sale-1001', vendorId: 'vendor-c' }),
        ],
      }),
    });

    await expect(runTransfer()).rejects.toThrow('Multiple active sale ledgers found for allocation.');
  });

  it('blocks transfer when replacement vendor is current vendor', async () => {
    setupDb();

    await expect(transferAllocationEconomics({
      vendorAllocationId: 'alloc-1',
      toVendorId: 'vendor-a',
      reason: 'Same vendor.',
      confirmTransfer: true,
    })).rejects.toThrow('Replacement vendor must differ from current vendor.');
  });

  it.each([
    ['active transfer exists', [{ id: 'transfer-1', status: 'IN_PROGRESS', toVendorId: 'vendor-b' }], 'Economic transfer is already in progress for this allocation.'],
    ['failed transfer exists', [{ id: 'transfer-1', status: 'FAILED', toVendorId: 'vendor-b' }], 'Previous economic transfer failed and must be resolved first.'],
    ['completed transfer exists', [{ id: 'transfer-1', status: 'COMPLETED', toVendorId: 'vendor-c' }], 'Economic transfer already completed for this allocation.'],
  ])('blocks transfer when %s', async (_name, transfers, message) => {
    setupDb({
      allocation: buildAllocation({
        economicTransfers: transfers.map((transfer) => ({
          vendorAllocationId: 'alloc-1',
          fromVendorId: 'vendor-a',
          toVendorId: transfer.toVendorId,
          fromFinanceLedgerEntryId: null,
          toFinanceLedgerEntryId: null,
          reason: null,
          adminActorUserId: null,
          pricingSnapshotJson: null,
          idempotencyKey: `economic-transfer:alloc-1:vendor-a:${transfer.toVendorId}`,
          createdAt: new Date('2026-06-21T10:00:00.000Z'),
          completedAt: null,
          failedAt: null,
          failureReason: null,
          ...transfer,
        })),
      }),
    });

    await expect(runTransfer()).rejects.toThrow(message);
  });

  it('marks transfer failed and creates a critical alert when transaction execution fails', async () => {
    const db = setupDb({ failOnTargetLedgerCreate: true });

    await expect(runTransfer()).rejects.toThrow('target ledger create failed');

    expect(db.transfers[0]).toMatchObject({
      status: 'FAILED',
      failureReason: 'target ledger create failed',
    });
    expect(db.alerts).toContainEqual(expect.objectContaining({
      category: 'transfer_failed',
      severity: 'critical',
      vendorAllocationId: 'alloc-1',
      allocationEconomicTransferId: db.transfers[0].id,
      status: 'open',
    }));
  });

  it('retries a failed transfer using the existing transfer row and resolves the linked transfer failed alert', async () => {
    const failedTransfer: TransferRow = {
      id: 'transfer-failed',
      vendorAllocationId: 'alloc-1',
      fromVendorId: 'vendor-a',
      toVendorId: 'vendor-b',
      fromFinanceLedgerEntryId: null,
      toFinanceLedgerEntryId: null,
      status: 'FAILED',
      reason: 'Original transfer.',
      adminActorUserId: 'admin-1',
      pricingSnapshotJson: null,
      idempotencyKey: 'economic-transfer:alloc-1:vendor-a:vendor-b',
      createdAt: new Date('2026-06-21T10:00:00.000Z'),
      completedAt: null,
      failedAt: new Date('2026-06-21T10:01:00.000Z'),
      failureReason: 'Target vendor sale ledger already exists for this allocation.',
    };
    const db = setupDb({
      allocation: buildAllocation({
        economicTransfers: [failedTransfer],
      }),
      alerts: [
        {
          id: 'alert-transfer-failed',
          dedupeKey: 'finance-integrity:transfer_failed:transfer:transfer-failed',
          status: 'open',
          severity: 'critical',
          category: 'transfer_failed',
          vendorAllocationId: 'alloc-1',
          allocationEconomicTransferId: 'transfer-failed',
          reason: 'Economic transfer failed: Target vendor sale ledger already exists for this allocation.',
        },
      ],
    });

    const result = await runRetry();

    expect(result.transfer).toEqual({
      transferId: 'transfer-failed',
      fromVendorId: 'vendor-a',
      toVendorId: 'vendor-b',
      sourceLedgerId: 'fin-vendor-a-sale-1001',
      targetLedgerId: 'fin-vendor-b-sale-1001-alloc-1',
      allocationId: 'alloc-1',
      status: 'COMPLETED',
    });
    expect(db.transfers).toHaveLength(1);
    expect(prismaMock.allocationEconomicTransfer.create).not.toHaveBeenCalled();
    expect(db.transfers[0]).toMatchObject({
      id: 'transfer-failed',
      status: 'COMPLETED',
      fromFinanceLedgerEntryId: 'fin-vendor-a-sale-1001',
      toFinanceLedgerEntryId: 'fin-vendor-b-sale-1001-alloc-1',
      failedAt: null,
      failureReason: null,
    });
    expect(db.allocation).toMatchObject({
      assignedVendorId: 'vendor-b',
      allocationStatus: 'ACTIVE',
      reassignmentRequired: false,
      cancellationReason: null,
    });
    expect(db.allocation.financeEntries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'fin-vendor-b-sale-1001-alloc-1',
        vendorAllocationId: 'alloc-1',
        vendorId: 'vendor-b',
        voidedAt: null,
      }),
    ]));
    expect(db.allocation.financeEntries.find((ledger) => ledger.id === 'fin-vendor-a-sale-1001')).toMatchObject({
      supersededByLedgerId: 'fin-vendor-b-sale-1001-alloc-1',
      voidReason: 'economic_transfer:transfer-failed',
    });
    expect(db.histories).toContainEqual(expect.objectContaining({
      action: 'economic_transfer_retry_completed',
      reason: 'Retry after target ledger id fix.',
    }));
    expect(db.alerts.find((alert) => alert.id === 'alert-transfer-failed')).toMatchObject({
      status: 'resolved',
      resolutionType: 'scanner_validated',
      resolutionNote: 'Resolved after successful economic transfer retry.',
    });
    expect(result.alertResolution).toEqual({
      scannerValidated: true,
      resolvedAlertIds: ['alert-transfer-failed'],
      remainingFindingCategories: [],
    });
  });

  it('keeps the linked transfer failed alert open when scanner still detects the issue after retry', async () => {
    runFinanceIntegrityScannerDiagnosticsMock.mockResolvedValueOnce({
      ok: true,
      dryRun: true,
      writesPerformed: false,
      scope: {
        vendorAllocationId: 'alloc-1',
        allocationEconomicTransferId: 'transfer-failed',
      },
      findings: [
        {
          category: 'transfer_failed',
          severity: 'critical',
          reason: 'Economic transfer failed for allocation.',
          dedupeKey: 'finance-integrity:transfer_failed:transfer:transfer-failed',
          vendorAllocationId: 'alloc-1',
          allocationEconomicTransferId: 'transfer-failed',
          affectedLedgerIds: [],
          createdAlertId: null,
        },
      ],
    });
    const db = setupDb({
      allocation: buildAllocation({
        economicTransfers: [
          {
            id: 'transfer-failed',
            vendorAllocationId: 'alloc-1',
            fromVendorId: 'vendor-a',
            toVendorId: 'vendor-b',
            fromFinanceLedgerEntryId: null,
            toFinanceLedgerEntryId: null,
            status: 'FAILED',
            reason: 'Original transfer.',
            adminActorUserId: 'admin-1',
            pricingSnapshotJson: null,
            idempotencyKey: 'economic-transfer:alloc-1:vendor-a:vendor-b',
            createdAt: new Date('2026-06-21T10:00:00.000Z'),
            completedAt: null,
            failedAt: new Date('2026-06-21T10:01:00.000Z'),
            failureReason: 'Original failure.',
          },
        ],
      }),
      alerts: [
        {
          id: 'alert-transfer-failed',
          dedupeKey: 'finance-integrity:transfer_failed:transfer:transfer-failed',
          status: 'open',
          severity: 'critical',
          category: 'transfer_failed',
          vendorAllocationId: 'alloc-1',
          allocationEconomicTransferId: 'transfer-failed',
          reason: 'Economic transfer failed.',
        },
      ],
    });

    const result = await runRetry();

    expect(db.alerts.find((alert) => alert.id === 'alert-transfer-failed')).toMatchObject({
      status: 'open',
    });
    expect(result.alertResolution).toEqual({
      scannerValidated: true,
      resolvedAlertIds: [],
      remainingFindingCategories: ['transfer_failed'],
    });
  });

  it('blocks retry when an unrelated blocking finance integrity alert exists', async () => {
    setupDb({
      allocation: buildAllocation({
        economicTransfers: [
          {
            id: 'transfer-failed',
            vendorAllocationId: 'alloc-1',
            fromVendorId: 'vendor-a',
            toVendorId: 'vendor-b',
            fromFinanceLedgerEntryId: null,
            toFinanceLedgerEntryId: null,
            status: 'FAILED',
            reason: null,
            adminActorUserId: null,
            pricingSnapshotJson: null,
            idempotencyKey: 'economic-transfer:alloc-1:vendor-a:vendor-b',
            createdAt: new Date('2026-06-21T10:00:00.000Z'),
            completedAt: null,
            failedAt: new Date('2026-06-21T10:01:00.000Z'),
            failureReason: 'Original failure.',
          },
        ],
      }),
      alerts: [
        {
          id: 'alert-transfer-failed',
          status: 'open',
          severity: 'critical',
          category: 'transfer_failed',
          vendorAllocationId: 'alloc-1',
          allocationEconomicTransferId: 'transfer-failed',
          reason: 'Economic transfer failed.',
        },
        {
          id: 'alert-multiple-ledgers',
          status: 'open',
          severity: 'critical',
          category: 'multiple_active_sale_ledgers',
          vendorAllocationId: 'alloc-1',
          allocationEconomicTransferId: null,
          reason: 'Multiple active ledgers.',
        },
      ],
    });

    await expect(runRetry()).rejects.toThrow('Economic transfer retry blocked by finance integrity alert: multiple_active_sale_ledgers.');
    expect(prismaMock.financeLedgerEntry.create).not.toHaveBeenCalled();
  });

  it.each([
    ['source ledger voided', { financeEntries: [buildSourceLedger({ voidedAt: new Date('2026-06-21T10:00:00.000Z') })] }, 'No active sale ledger found for allocation.'],
    ['target ledger already exists', { extraLedgerEntries: [buildSourceLedger({ id: 'fin-vendor-b-sale-1001-alloc-1', vendorId: 'vendor-b' })] }, 'Target vendor sale ledger already exists for this allocation.'],
    ['assignment already changed', { assignedVendorId: 'vendor-c' }, 'Economic transfer retry requires allocation to still be assigned to the source vendor.'],
    ['return exists', { returnRecords: [{ id: 'return-1' }] }, 'Economic transfer cannot run after return evidence exists.'],
    ['refund exists', { refundRecords: [{ id: 'refund-1' }] }, 'Economic transfer cannot run after refund evidence exists.'],
    ['tracking exists', { trackingNumber: 'TRK-1' }, 'Economic transfer cannot run after fulfillment, shipment, carrier, or tracking evidence exists.'],
    ['settlement approval exists', { financeEntries: [buildSourceLedger({ settlementApprovalLines: [{ settlementApproval: { commissionInvoices: [] } }] })] }, 'Economic transfer cannot run after settlement approval evidence exists.'],
    ['payout batch exists', { financeEntries: [buildSourceLedger({ payoutBatchLines: [{ payoutBatch: { status: 'DRAFT' } }] })] }, 'Economic transfer cannot run after payout batch evidence exists.'],
    ['commission invoice exists', { financeEntries: [buildSourceLedger({ settlementApprovalLines: [{ settlementApproval: { commissionInvoices: [{ status: 'CREATED' }] } }] })] }, 'Economic transfer cannot run after commission invoice evidence exists.'],
    ['vendor payment exists', { financeEntries: [buildSourceLedger({ payoutStatus: 'PAID' })] }, 'Economic transfer cannot run after vendor payment evidence exists.'],
  ])('blocks retry when %s', async (_name, overrides, message) => {
    setupDb({
      allocation: buildAllocation({
        ...(overrides as Partial<AllocationRow>),
        economicTransfers: [
          {
            id: 'transfer-failed',
            vendorAllocationId: 'alloc-1',
            fromVendorId: 'vendor-a',
            toVendorId: 'vendor-b',
            fromFinanceLedgerEntryId: null,
            toFinanceLedgerEntryId: null,
            status: 'FAILED',
            reason: null,
            adminActorUserId: null,
            pricingSnapshotJson: null,
            idempotencyKey: 'economic-transfer:alloc-1:vendor-a:vendor-b',
            createdAt: new Date('2026-06-21T10:00:00.000Z'),
            completedAt: null,
            failedAt: new Date('2026-06-21T10:01:00.000Z'),
            failureReason: 'Original failure.',
          },
        ],
      }),
      extraLedgerEntries: (overrides as { extraLedgerEntries?: LedgerRow[] }).extraLedgerEntries,
    });

    await expect(runRetry()).rejects.toThrow(message);
  });

  it('returns completed transfer idempotently for duplicate retry after completion', async () => {
    setupDb({
      allocation: buildAllocation({
        assignedVendorId: 'vendor-b',
        allocationStatus: 'ACTIVE',
        reassignmentRequired: false,
        cancellationReason: null,
        financeEntries: [
          buildSourceLedger({
            voidedAt: new Date('2026-06-21T10:00:00.000Z'),
            supersededByLedgerId: 'fin-vendor-b-sale-1001-alloc-1',
          }),
          buildSourceLedger({
            id: 'fin-vendor-b-sale-1001-alloc-1',
            vendorId: 'vendor-b',
          }),
        ],
        economicTransfers: [
          {
            id: 'transfer-failed',
            vendorAllocationId: 'alloc-1',
            fromVendorId: 'vendor-a',
            toVendorId: 'vendor-b',
            fromFinanceLedgerEntryId: 'fin-vendor-a-sale-1001',
            toFinanceLedgerEntryId: 'fin-vendor-b-sale-1001-alloc-1',
            status: 'COMPLETED',
            reason: null,
            adminActorUserId: null,
            pricingSnapshotJson: null,
            idempotencyKey: 'economic-transfer:alloc-1:vendor-a:vendor-b',
            createdAt: new Date('2026-06-21T10:00:00.000Z'),
            completedAt: new Date('2026-06-21T10:01:00.000Z'),
            failedAt: null,
            failureReason: null,
          },
        ],
      }),
    });

    const result = await runRetry();

    expect(result.transfer.status).toBe('COMPLETED');
    expect(result.alertResolution.scannerValidated).toBe(false);
    expect(prismaMock.financeLedgerEntry.create).not.toHaveBeenCalled();
  });

  it('returns an idempotent completed transfer result without creating duplicate target ledgers', async () => {
    const source = buildSourceLedger({
      voidedAt: new Date('2026-06-21T10:00:00.000Z'),
      supersededByLedgerId: 'fin-vendor-b-sale-1001-alloc-1',
    });
    const target = buildSourceLedger({
      id: 'fin-vendor-b-sale-1001-alloc-1',
      vendorId: 'vendor-b',
      voidedAt: null,
      supersededByLedgerId: null,
    });
    setupDb({
      allocation: buildAllocation({
        assignedVendorId: 'vendor-b',
        allocationStatus: 'ACTIVE',
        reassignmentRequired: false,
        cancellationReason: null,
        financeEntries: [source, target],
        economicTransfers: [
          {
            id: 'transfer-completed',
            vendorAllocationId: 'alloc-1',
            fromVendorId: 'vendor-a',
            toVendorId: 'vendor-b',
            fromFinanceLedgerEntryId: 'fin-vendor-a-sale-1001',
            toFinanceLedgerEntryId: 'fin-vendor-b-sale-1001-alloc-1',
            status: 'COMPLETED',
            reason: 'Already completed.',
            adminActorUserId: 'admin-1',
            pricingSnapshotJson: null,
            idempotencyKey: 'economic-transfer:alloc-1:vendor-a:vendor-b',
            createdAt: new Date('2026-06-21T10:00:00.000Z'),
            completedAt: new Date('2026-06-21T10:01:00.000Z'),
            failedAt: null,
            failureReason: null,
          },
        ],
      }),
    });

    const result = await runTransfer();

    expect(result).toEqual({
      transferId: 'transfer-completed',
      fromVendorId: 'vendor-a',
      toVendorId: 'vendor-b',
      sourceLedgerId: 'fin-vendor-a-sale-1001',
      targetLedgerId: 'fin-vendor-b-sale-1001-alloc-1',
      allocationId: 'alloc-1',
      status: 'COMPLETED',
    });
    expect(prismaMock.financeLedgerEntry.create).not.toHaveBeenCalled();
    expect(prismaMock.allocationEconomicTransfer.create).not.toHaveBeenCalled();
  });

  it('keeps previously completed transfers with legacy target ledger ids idempotent', async () => {
    const source = buildSourceLedger({
      voidedAt: new Date('2026-06-21T10:00:00.000Z'),
      supersededByLedgerId: 'fin-vendor-b-sale-1001',
    });
    const legacyTarget = buildSourceLedger({
      id: 'fin-vendor-b-sale-1001',
      vendorId: 'vendor-b',
      voidedAt: null,
      supersededByLedgerId: null,
    });
    setupDb({
      allocation: buildAllocation({
        assignedVendorId: 'vendor-b',
        allocationStatus: 'ACTIVE',
        reassignmentRequired: false,
        cancellationReason: null,
        financeEntries: [source, legacyTarget],
        economicTransfers: [
          {
            id: 'transfer-completed-legacy',
            vendorAllocationId: 'alloc-1',
            fromVendorId: 'vendor-a',
            toVendorId: 'vendor-b',
            fromFinanceLedgerEntryId: 'fin-vendor-a-sale-1001',
            toFinanceLedgerEntryId: 'fin-vendor-b-sale-1001',
            status: 'COMPLETED',
            reason: 'Already completed before allocation-scoped ids.',
            adminActorUserId: 'admin-1',
            pricingSnapshotJson: null,
            idempotencyKey: 'economic-transfer:alloc-1:vendor-a:vendor-b',
            createdAt: new Date('2026-06-21T10:00:00.000Z'),
            completedAt: new Date('2026-06-21T10:01:00.000Z'),
            failedAt: null,
            failureReason: null,
          },
        ],
      }),
    });

    const result = await runTransfer();

    expect(result).toEqual({
      transferId: 'transfer-completed-legacy',
      fromVendorId: 'vendor-a',
      toVendorId: 'vendor-b',
      sourceLedgerId: 'fin-vendor-a-sale-1001',
      targetLedgerId: 'fin-vendor-b-sale-1001',
      allocationId: 'alloc-1',
      status: 'COMPLETED',
    });
    expect(prismaMock.financeLedgerEntry.create).not.toHaveBeenCalled();
    expect(prismaMock.allocationEconomicTransfer.create).not.toHaveBeenCalled();
  });

  it('requires explicit confirmation and a non-empty reason', async () => {
    setupDb();

    await expect(transferAllocationEconomics({
      vendorAllocationId: 'alloc-1',
      toVendorId: 'vendor-b',
      reason: 'Valid reason',
      confirmTransfer: false as true,
    })).rejects.toThrow('Economic transfer requires explicit confirmation.');
    await expect(transferAllocationEconomics({
      vendorAllocationId: 'alloc-1',
      toVendorId: 'vendor-b',
      reason: '   ',
      confirmTransfer: true,
    })).rejects.toThrow('Economic transfer reason is required.');
  });

  it('uses explicit validation error type for business blockers', async () => {
    setupDb({
      allocation: buildAllocation({
        allocationStatus: 'ACTIVE',
      }),
    });

    await expect(runTransfer()).rejects.toBeInstanceOf(EconomicTransferValidationError);
  });
});
