import { describe, expect, it, vi } from 'vitest';
import { __saleLedgerTesting, upsertSaleLedgerForAllocation } from '../backend/src/modules/finance/sale-ledger.service';

const baseOrder = {
  id: 'shopify-order-db-1023',
  sourceShopifyOrderId: '7616676626769',
  sourceShopifyOrderNumber: '#1023',
  currency: 'TRY',
};

function buildAllocation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'alloc-1',
    assignedVendorId: 'sporjinal',
    createdAt: new Date('2026-05-13T10:00:00.000Z'),
    updatedAt: new Date('2026-05-13T10:30:00.000Z'),
    fulfillmentStatus: 'Fulfilled',
    shippingStatus: 'Delivered',
    order: baseOrder,
    lineItems: [{ lineAmount: 3399 }],
    fulfillment: {
      fulfilledAt: new Date('2026-05-13T10:20:00.000Z'),
      shipmentUpdatedAt: new Date('2026-05-13T10:20:00.000Z'),
    },
    ...overrides,
  };
}

function buildLedger(overrides: Record<string, unknown> = {}) {
  return {
    id: 'fin-sporjinal-sale-7616676626769-alloc-1',
    vendorAllocationId: 'alloc-1',
    vendorId: 'sporjinal',
    entryType: 'sale',
    amount: '3399.00',
    payoutStatus: 'PENDING',
    description: 'Allocated sale for Shopify order #1023',
    commissionPercentSnapshot: '10.00',
    commissionVatPercentSnapshot: '0.00',
    deductShippingEnabledSnapshot: false,
    shippingModeSnapshot: 'DISABLED',
    fixedShippingFeeSnapshot: null,
    shippingCostSnapshot: null,
    shippingVatAmountSnapshot: null,
    shippingCostSourceSnapshot: null,
    shippingCostProviderSnapshot: null,
    shippingCostIdSnapshot: null,
    financialProfileIdSnapshot: null,
    settlementDelayDaysSnapshot: 21,
    settlementStatus: 'PAYABLE',
    settlementEligibleAt: new Date('2026-06-03T10:20:00.000Z'),
    accruedAt: new Date('2026-05-13T10:00:00.000Z'),
    payableAt: new Date('2026-06-03T10:20:00.000Z'),
    settledAt: null,
    settlementHoldReason: null,
    voidedAt: null,
    voidReason: null,
    supersededByLedgerId: null,
    createdAt: new Date('2026-05-13T10:00:01.000Z'),
    updatedAt: new Date('2026-05-13T10:00:01.000Z'),
    ...overrides,
  };
}

function buildMutableLedger(overrides: Record<string, unknown> = {}) {
  return buildLedger({
    settlementStatus: 'ACCRUING',
    settlementEligibleAt: null,
    payableAt: null,
    ...overrides,
  });
}

function buildTx(input: {
  allocation?: Record<string, unknown>;
  existingLedger?: Record<string, unknown> | null;
  counts?: Partial<Record<'financeEvent' | 'settlementApprovalLine' | 'payoutBatchLine' | 'vendorBalanceEvent' | 'refundRecord' | 'refundLedger', number>>;
  activeProfile?: Record<string, unknown> | null;
  shippingCost?: Record<string, unknown> | null;
} = {}) {
  const createMany = vi.fn(async () => ({ count: 4 }));
  const create = vi.fn(async (args: { data: Record<string, unknown> }) => args.data);
  const update = vi.fn(async (args: { data: Record<string, unknown> }) => ({
    ...(input.existingLedger ?? {}),
    ...args.data,
  }));
  const operationalSignalUpsert = vi.fn(async () => ({}));

  type EvidenceCountKey = 'financeEvent' | 'settlementApprovalLine' | 'payoutBatchLine' | 'vendorBalanceEvent' | 'refundRecord' | 'refundLedger';
  const countFor = (key: EvidenceCountKey) => vi.fn(async () => input.counts?.[key] ?? 0);

  return {
    tx: {
      vendorAllocation: {
        findUnique: async () => input.allocation ?? buildAllocation(),
      },
      vendorFinancialProfile: {
        findFirst: async () => input.activeProfile ?? null,
      },
      shipmentShippingCost: {
        findFirst: async () => input.shippingCost ?? null,
      },
      financeLedgerEntry: {
        findUnique: async () => input.existingLedger ?? null,
        create,
        update,
        count: async (args: { where?: { entryType?: string } }) =>
          args.where?.entryType === 'refund'
            ? input.counts?.refundLedger ?? 0
            : input.counts?.financeEvent ?? 0,
      },
      financeEvent: {
        createMany,
        count: countFor('financeEvent'),
      },
      settlementApprovalLine: {
        count: countFor('settlementApprovalLine'),
      },
      payoutBatchLine: {
        count: countFor('payoutBatchLine'),
      },
      vendorBalanceEvent: {
        count: countFor('vendorBalanceEvent'),
      },
      refundRecord: {
        count: countFor('refundRecord'),
      },
      operationalSignal: {
        upsert: operationalSignalUpsert,
      },
    },
    createMany,
    create,
    update,
    operationalSignalUpsert,
  };
}

describe('sale ledger foundation', () => {
  it('builds deterministic vendor/order/allocation sale ledger ids for idempotent creates', () => {
    expect(__saleLedgerTesting.buildSaleLedgerEntryId('yalispor', '12345', 'alloc-a')).toBe('fin-yalispor-sale-12345-alloc-a');
    expect(__saleLedgerTesting.buildSaleLedgerEntryId('sporjinal', '12345', 'alloc-b')).toBe('fin-sporjinal-sale-12345-alloc-b');
  });

  it('snapshots the active vendor finance profile only when creating a sale ledger row', async () => {
    const { tx, createMany } = buildTx({
      activeProfile: {
        id: 'profile-sporjinal',
        commissionPercent: 15,
        commissionVatPercent: 18,
        deductShippingEnabled: true,
        shippingMode: 'EXTERNAL_PROVIDER',
        fixedShippingFee: 88,
        settlementDelayDays: 21,
      },
      shippingCost: {
        id: 'shipcost-sporjinal-alloc-1-manual',
        shippingCost: 72,
        shippingVatAmount: 12,
        sourceType: 'MANUAL',
        providerName: 'Manual provider',
      },
    });

    const result = await upsertSaleLedgerForAllocation(tx as never, 'alloc-1') as Record<string, unknown>;

    expect(result).toMatchObject({
      id: 'fin-sporjinal-sale-7616676626769-alloc-1',
      commissionPercentSnapshot: 15,
      commissionVatPercentSnapshot: 18,
      deductShippingEnabledSnapshot: true,
      shippingModeSnapshot: 'EXTERNAL_PROVIDER',
      fixedShippingFeeSnapshot: 88,
      shippingCostSnapshot: 72,
      shippingVatAmountSnapshot: 12,
      shippingCostSourceSnapshot: 'MANUAL',
      shippingCostProviderSnapshot: 'Manual provider',
      shippingCostIdSnapshot: 'shipcost-sporjinal-alloc-1-manual',
      financialProfileIdSnapshot: 'profile-sporjinal',
      settlementDelayDaysSnapshot: 21,
      settlementStatus: 'PAYABLE',
      accruedAt: new Date('2026-05-13T10:00:00.000Z'),
      payableAt: new Date('2026-06-03T10:20:00.000Z'),
      settlementEligibleAt: new Date('2026-06-03T10:20:00.000Z'),
    });
    expect(createMany).toHaveBeenCalledWith(expect.objectContaining({
      skipDuplicates: true,
      data: [
        expect.objectContaining({
          eventType: 'SALE_RECORDED',
          amountMinor: 339900,
          idempotencyKey: 'fin-sporjinal-sale-7616676626769-alloc-1:SALE_RECORDED',
        }),
        expect.objectContaining({
          eventType: 'COMMISSION_RESERVED',
          amountMinor: 50985,
          idempotencyKey: 'fin-sporjinal-sale-7616676626769-alloc-1:COMMISSION_RESERVED',
        }),
        expect.objectContaining({
          eventType: 'COMMISSION_VAT_RESERVED',
          amountMinor: 9177,
          idempotencyKey: 'fin-sporjinal-sale-7616676626769-alloc-1:COMMISSION_VAT_RESERVED',
        }),
        expect.objectContaining({
          eventType: 'VENDOR_PAYABLE_RESERVED',
          amountMinor: 279738,
          idempotencyKey: 'fin-sporjinal-sale-7616676626769-alloc-1:VENDOR_PAYABLE_RESERVED',
        }),
      ],
    }));
  });

  it('returns an existing identical sale ledger without creating events or updating the row', async () => {
    const { tx, createMany, update } = buildTx({
      existingLedger: buildLedger(),
    });

    await upsertSaleLedgerForAllocation(tx as never, 'alloc-1');

    expect(createMany).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('repairs a pre-material sale ledger before downstream evidence exists', async () => {
    const { tx, update, operationalSignalUpsert } = buildTx({
      allocation: buildAllocation({
        lineItems: [{ lineAmount: 3450 }],
        shippingStatus: 'Awaiting Shipment',
        fulfillment: null,
      }),
      existingLedger: buildMutableLedger({ amount: '3399.00' }),
    });

    await upsertSaleLedgerForAllocation(tx as never, 'alloc-1');

    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'fin-sporjinal-sale-7616676626769-alloc-1' },
      data: expect.objectContaining({
        amount: '3450.00',
        settlementStatus: 'ACCRUING',
      }),
    }));
    expect(operationalSignalUpsert).not.toHaveBeenCalled();
  });

  it.each([
    ['FinanceEvents', { financeEvent: 1 }],
    ['SettlementApprovalLine', { settlementApprovalLine: 1 }],
    ['PayoutBatchLine', { payoutBatchLine: 1 }],
    ['RefundRecord', { refundRecord: 1 }],
    ['refund ledger', { refundLedger: 1 }],
    ['VendorBalanceEvent', { vendorBalanceEvent: 1 }],
  ])('blocks amount repair when %s evidence exists', async (_label, counts) => {
    const { tx, update, operationalSignalUpsert } = buildTx({
      allocation: buildAllocation({
        lineItems: [{ lineAmount: 3450 }],
      }),
      existingLedger: buildMutableLedger({ amount: '3399.00' }),
      counts,
    });

    const result = await upsertSaleLedgerForAllocation(tx as never, 'alloc-1');

    expect(result).toMatchObject({ amount: '3399.00' });
    expect(update).not.toHaveBeenCalled();
    expect(operationalSignalUpsert).toHaveBeenCalledTimes(1);
    expect(operationalSignalUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: 'finance:sale_ledger_immutable_update_blocked:fin-sporjinal-sale-7616676626769-alloc-1',
      },
      update: expect.objectContaining({
        ruleKey: 'sale_ledger_immutable_update_blocked',
        status: 'ACTIVE',
        metadata: expect.objectContaining({
          attemptedChangedFields: expect.arrayContaining(['amount']),
          reason: 'downstream_financial_evidence_exists',
        }),
      }),
    }));
  });

  it('blocks replay reset when payout status is not initial', async () => {
    const { tx, update, operationalSignalUpsert } = buildTx({
      existingLedger: buildMutableLedger({
        amount: '3399.00',
        payoutStatus: 'HOLD',
      }),
    });

    await upsertSaleLedgerForAllocation(tx as never, 'alloc-1');

    expect(update).not.toHaveBeenCalled();
    expect(operationalSignalUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: 'finance:sale_ledger_immutable_update_blocked:fin-sporjinal-sale-7616676626769-alloc-1',
      },
      update: expect.objectContaining({
        metadata: expect.objectContaining({
          attemptedChangedFields: expect.arrayContaining(['payoutStatus']),
          evidence: expect.objectContaining({
            reasons: expect.arrayContaining(['ledger_status_is_not_initial']),
          }),
        }),
      }),
    }));
  });

  it('creates an idempotent signal when immutability evidence cannot be checked', async () => {
    const { tx, update, operationalSignalUpsert } = buildTx({
      allocation: buildAllocation({
        lineItems: [{ lineAmount: 3450 }],
      }),
      existingLedger: buildMutableLedger({ amount: '3399.00' }),
    });
    (tx.financeEvent.count as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('database unavailable'));

    await upsertSaleLedgerForAllocation(tx as never, 'alloc-1');

    expect(update).not.toHaveBeenCalled();
    expect(operationalSignalUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: 'finance:sale_ledger_immutability_check_failed:fin-sporjinal-sale-7616676626769-alloc-1',
      },
      update: expect.objectContaining({
        ruleKey: 'sale_ledger_immutability_check_failed',
        status: 'ACTIVE',
        metadata: expect.objectContaining({
          reason: 'database unavailable',
        }),
      }),
    }));
  });

  it('creates distinct sale ledgers for two allocations from the same vendor and Shopify order', async () => {
    const ledgerIdsLookedUp: string[] = [];
    const creates: Array<Record<string, unknown>> = [];
    const allocations = new Map([
      ['alloc-1', buildAllocation({ id: 'alloc-1', lineItems: [{ lineAmount: 100 }] })],
      ['alloc-2', buildAllocation({ id: 'alloc-2', lineItems: [{ lineAmount: 200 }] })],
    ]);
    const { tx } = buildTx();
    tx.vendorAllocation.findUnique = async (args: { where: { id: string } }) => allocations.get(args.where.id);
    tx.financeLedgerEntry.findUnique = async (args: { where: { id: string } }) => {
      ledgerIdsLookedUp.push(args.where.id);
      return null;
    };
    tx.financeLedgerEntry.create = vi.fn(async (args: { data: Record<string, unknown> }) => {
      creates.push(args.data);
      return args.data;
    });

    await upsertSaleLedgerForAllocation(tx as never, 'alloc-1');
    await upsertSaleLedgerForAllocation(tx as never, 'alloc-2');

    expect(ledgerIdsLookedUp).toEqual([
      'fin-sporjinal-sale-7616676626769-alloc-1',
      'fin-sporjinal-sale-7616676626769-alloc-2',
    ]);
    expect(creates.map((create) => create.id)).toEqual([
      'fin-sporjinal-sale-7616676626769-alloc-1',
      'fin-sporjinal-sale-7616676626769-alloc-2',
    ]);
    expect(creates.map((create) => create.vendorAllocationId)).toEqual(['alloc-1', 'alloc-2']);
    expect(creates.map((create) => create.amount)).toEqual(['100.00', '200.00']);
  });

  it('blocks order replay from repairing a voided sale ledger row', async () => {
    const { tx, update } = buildTx({
      existingLedger: buildLedger({
        voidedAt: new Date('2026-06-21T10:00:00.000Z'),
        voidReason: 'superseded_by_reassignment',
        supersededByLedgerId: 'fin-yalispor-sale-7616676626769-alloc-1',
      }),
    });

    await expect(upsertSaleLedgerForAllocation(tx as never, 'alloc-1')).rejects.toThrow(
      'Sale ledger fin-sporjinal-sale-7616676626769-alloc-1 has been voided or superseded and cannot be repaired by order replay.',
    );
    expect(update).not.toHaveBeenCalled();
  });
});
