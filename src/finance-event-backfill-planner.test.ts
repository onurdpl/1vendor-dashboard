import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  financeLedgerEntry: {
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
  },
  financeEvent: {
    findMany: vi.fn(),
    create: vi.fn(),
    createMany: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
  },
}));

vi.mock('../backend/src/db/prisma.js', () => ({
  prisma: prismaMock,
}));

const { getFinanceEventBackfillPlan } = await import(
  '../backend/src/modules/finance/finance-event-backfill-planner.service.js'
);
const { resolveFinanceCurrency } = await import(
  '../backend/src/modules/finance/finance-currency-policy.service.js'
);

function order(currency: string | null = 'TRY') {
  return {
    id: 'shopify-order-db-1',
    sourceShopifyOrderId: '9001',
    currency,
  };
}

function allocation(id: string, orderInput = order()) {
  return {
    id,
    sourceShopifyOrderId: orderInput.id,
    sourceShopifyOrderNumber: '#9001',
    order: orderInput,
  };
}

function ledgerRow(input: {
  id: string;
  vendorId?: string;
  entryType: 'sale' | 'refund';
  amount?: number;
  allocationId: string;
  financeEvents?: Array<{ eventType: string; idempotencyKey: string; financeLedgerEntryId: string | null }>;
  currency?: string | null;
}) {
  return {
    id: input.id,
    vendorId: input.vendorId ?? 'sporjinal',
    entryType: input.entryType,
    amount: input.amount ?? 100,
    vendorAllocationId: input.allocationId,
    commissionPercentSnapshot: input.entryType === 'sale' ? 10 : null,
    commissionVatPercentSnapshot: input.entryType === 'sale' ? 18 : null,
    vendorAllocation: allocation(
      input.allocationId,
      order(Object.prototype.hasOwnProperty.call(input, 'currency') ? input.currency ?? null : 'TRY'),
    ),
    financeEvents: input.financeEvents ?? [],
  };
}

function completeSaleEvents(ledgerId: string) {
  return ['SALE_RECORDED', 'COMMISSION_RESERVED', 'COMMISSION_VAT_RESERVED', 'VENDOR_PAYABLE_RESERVED'].map((eventType) => ({
    eventType,
    idempotencyKey: `${ledgerId}:${eventType}`,
    financeLedgerEntryId: ledgerId,
  }));
}

describe('finance event backfill planner', () => {
  beforeEach(() => {
    prismaMock.financeLedgerEntry.findMany.mockReset();
    prismaMock.financeEvent.findMany.mockReset();
    prismaMock.financeLedgerEntry.create.mockReset();
    prismaMock.financeLedgerEntry.update.mockReset();
    prismaMock.financeLedgerEntry.upsert.mockReset();
    prismaMock.financeEvent.create.mockReset();
    prismaMock.financeEvent.createMany.mockReset();
    prismaMock.financeEvent.update.mockReset();
    prismaMock.financeEvent.upsert.mockReset();
  });

  it('classifies missing sale, safe refund, unsafe refund, relink candidates, and completed rows without writes', async () => {
    const completeSale = ledgerRow({
      id: 'fin-sporjinal-sale-complete',
      entryType: 'sale',
      allocationId: 'alloc-complete',
      financeEvents: completeSaleEvents('fin-sporjinal-sale-complete'),
    });
    const missingSale = ledgerRow({
      id: 'fin-sporjinal-sale-missing',
      entryType: 'sale',
      allocationId: 'alloc-sale-missing',
      currency: null,
    });
    const matchingSale = ledgerRow({
      id: 'fin-sporjinal-sale-refund-match',
      entryType: 'sale',
      allocationId: 'alloc-refund-match',
    });
    const safeRefund = ledgerRow({
      id: 'fin-sporjinal-refund-safe',
      entryType: 'refund',
      allocationId: 'alloc-refund-match',
    });
    const unsafeRefund = ledgerRow({
      id: 'fin-sporjinal-refund-unsafe',
      entryType: 'refund',
      allocationId: 'alloc-refund-without-sale',
    });
    const relinkSale = ledgerRow({
      id: 'fin-sporjinal-sale-relink',
      entryType: 'sale',
      allocationId: 'alloc-relink',
    });
    const nullLinkedEvent = {
      id: 'event-null-link',
      eventType: 'SALE_RECORDED',
      financeLedgerEntryId: null,
      idempotencyKey: 'fin-sporjinal-sale-relink:SALE_RECORDED',
    };
    const linkedCompleteEvents = completeSale.financeEvents.map((event, index) => ({
      id: `event-complete-${index}`,
      ...event,
    }));

    prismaMock.financeLedgerEntry.findMany.mockResolvedValue([
      completeSale,
      missingSale,
      matchingSale,
      safeRefund,
      unsafeRefund,
      relinkSale,
    ]);
    prismaMock.financeEvent.findMany.mockResolvedValue([
      ...linkedCompleteEvents,
      nullLinkedEvent,
    ]);

    const plan = await getFinanceEventBackfillPlan();

    expect(plan.writesPerformed).toBe(false);
    expect(plan.summary).toMatchObject({
      financeLedgerRows: 6,
      financeEvents: 5,
      safeSaleBackfillRows: 3,
      safeRefundBackfillRows: 1,
      unsafeRefundRows: 1,
      relinkCandidateEvents: 1,
      alreadyCompleteRows: 1,
    });
    expect(plan.samples.safeSaleBackfill).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          financeLedgerEntryId: 'fin-sporjinal-sale-missing',
          missingEventTypes: ['SALE_RECORDED', 'COMMISSION_RESERVED', 'COMMISSION_VAT_RESERVED', 'VENDOR_PAYABLE_RESERVED'],
          reason: expect.stringContaining('policy-approved for TRY backfill'),
        }),
      ]),
    );
    expect(plan.samples.safeRefundBackfill).toEqual([
        expect.objectContaining({
          financeLedgerEntryId: 'fin-sporjinal-refund-safe',
          missingEventTypes: ['REFUND_RECORDED', 'COMMISSION_REVERSED', 'COMMISSION_VAT_REVERSED', 'VENDOR_PAYABLE_REVERSED'],
        }),
      ]);
    expect(plan.samples.unsafeRefundMissingSale).toEqual([
      expect.objectContaining({
        financeLedgerEntryId: 'fin-sporjinal-refund-unsafe',
        reason: expect.stringContaining('no matching sale ledger row'),
      }),
    ]);
    expect(plan.samples.existingEventNeedsRelink).toEqual([
      expect.objectContaining({
        financeLedgerEntryId: 'fin-sporjinal-sale-relink',
        missingEventTypes: ['SALE_RECORDED'],
        reason: expect.stringContaining('financeLedgerEntryId is null'),
      }),
    ]);
    expect(plan.warnings).toEqual(
      expect.arrayContaining([
        'TRY-only finance policy: null historical ledger currency will be backfilled as TRY.',
        expect.stringContaining('refund rows cannot be safely backfilled'),
        expect.stringContaining('null financeLedgerEntryId'),
      ]),
    );
    expect(prismaMock.financeLedgerEntry.create).not.toHaveBeenCalled();
    expect(prismaMock.financeLedgerEntry.update).not.toHaveBeenCalled();
    expect(prismaMock.financeLedgerEntry.upsert).not.toHaveBeenCalled();
    expect(prismaMock.financeEvent.create).not.toHaveBeenCalled();
    expect(prismaMock.financeEvent.createMany).not.toHaveBeenCalled();
    expect(prismaMock.financeEvent.update).not.toHaveBeenCalled();
    expect(prismaMock.financeEvent.upsert).not.toHaveBeenCalled();
  });

  it('resolves null historical finance currency to TRY by policy', () => {
    expect(resolveFinanceCurrency(null)).toEqual({
      ok: true,
      currency: 'TRY',
      usedDefault: true,
      unsupportedCurrency: null,
    });
    expect(resolveFinanceCurrency(undefined)).toEqual({
      ok: true,
      currency: 'TRY',
      usedDefault: true,
      unsupportedCurrency: null,
    });
  });

  it('resolves TRY finance currency to TRY without defaulting', () => {
    expect(resolveFinanceCurrency('TRY')).toEqual({
      ok: true,
      currency: 'TRY',
      usedDefault: false,
      unsupportedCurrency: null,
    });
    expect(resolveFinanceCurrency(' try ')).toEqual({
      ok: true,
      currency: 'TRY',
      usedDefault: false,
      unsupportedCurrency: null,
    });
  });

  it('flags non-TRY finance currency as unsupported', () => {
    expect(resolveFinanceCurrency('USD')).toEqual({
      ok: false,
      currency: null,
      usedDefault: false,
      unsupportedCurrency: 'USD',
    });
  });

  it('reports unsupported non-TRY finance currency in the backfill planner warnings', async () => {
    prismaMock.financeLedgerEntry.findMany.mockResolvedValue([
      ledgerRow({
        id: 'fin-sporjinal-sale-usd',
        entryType: 'sale',
        allocationId: 'alloc-sale-usd',
        currency: 'USD',
      }),
    ]);
    prismaMock.financeEvent.findMany.mockResolvedValue([]);

    const plan = await getFinanceEventBackfillPlan();

    expect(plan.writesPerformed).toBe(false);
    expect(plan.warnings).toContain('Unsupported non-TRY finance currency found.');
    expect(plan.warnings).not.toContain('TRY-only finance policy: null historical ledger currency will be backfilled as TRY.');
    expect(plan.samples.safeSaleBackfill).toEqual([
      expect.objectContaining({
        financeLedgerEntryId: 'fin-sporjinal-sale-usd',
        reason: expect.stringContaining('Unsupported non-TRY finance currency USD requires review before backfill.'),
      }),
    ]);
    expect(prismaMock.financeLedgerEntry.create).not.toHaveBeenCalled();
    expect(prismaMock.financeLedgerEntry.update).not.toHaveBeenCalled();
    expect(prismaMock.financeLedgerEntry.upsert).not.toHaveBeenCalled();
    expect(prismaMock.financeEvent.create).not.toHaveBeenCalled();
    expect(prismaMock.financeEvent.createMany).not.toHaveBeenCalled();
    expect(prismaMock.financeEvent.update).not.toHaveBeenCalled();
    expect(prismaMock.financeEvent.upsert).not.toHaveBeenCalled();
  });
});
