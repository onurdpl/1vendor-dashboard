import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
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
    updateMany: vi.fn(),
    upsert: vi.fn(),
  },
}));

vi.mock('../backend/src/db/prisma.js', () => ({
  prisma: prismaMock,
}));

const { getFinanceEventRelinkPlan, relinkExistingFinanceEvents } = await import(
  '../backend/src/modules/finance/finance-event-relink.service.js'
);

function ledgerRow(input: { id: string; vendorId?: string; entryType?: 'sale' | 'refund' }) {
  return {
    id: input.id,
    vendorId: input.vendorId ?? 'sporjinal',
    entryType: input.entryType ?? 'sale',
  };
}

function financeEvent(input: {
  id: string;
  vendorId?: string;
  eventType?: string;
  financeLedgerEntryId?: string | null;
  idempotencyKey?: string;
}) {
  return {
    id: input.id,
    vendorId: input.vendorId ?? 'sporjinal',
    eventType: input.eventType ?? 'SALE_RECORDED',
    financeLedgerEntryId: Object.prototype.hasOwnProperty.call(input, 'financeLedgerEntryId')
      ? input.financeLedgerEntryId
      : null,
    idempotencyKey: input.idempotencyKey ?? 'ledger-1:SALE_RECORDED',
  };
}

describe('finance event relink service', () => {
  beforeEach(() => {
    prismaMock.$transaction.mockReset();
    prismaMock.$transaction.mockImplementation(async (callback: (tx: typeof prismaMock) => unknown) => callback(prismaMock));
    prismaMock.financeLedgerEntry.findMany.mockReset();
    prismaMock.financeLedgerEntry.create.mockReset();
    prismaMock.financeLedgerEntry.update.mockReset();
    prismaMock.financeLedgerEntry.upsert.mockReset();
    prismaMock.financeEvent.findMany.mockReset();
    prismaMock.financeEvent.create.mockReset();
    prismaMock.financeEvent.createMany.mockReset();
    prismaMock.financeEvent.update.mockReset();
    prismaMock.financeEvent.updateMany.mockReset();
    prismaMock.financeEvent.upsert.mockReset();
  });

  it('dry-run returns writesPerformed false with relink candidates', async () => {
    prismaMock.financeLedgerEntry.findMany.mockResolvedValueOnce([ledgerRow({ id: 'ledger-1' })]);
    prismaMock.financeEvent.findMany.mockResolvedValueOnce([financeEvent({ id: 'event-1' })]);

    const plan = await getFinanceEventRelinkPlan();

    expect(plan).toEqual({
      ok: true,
      writesPerformed: false,
      summary: {
        relinkCandidateEvents: 1,
        affectedLedgerRows: 1,
      },
      samples: [
        expect.objectContaining({
          financeEventId: 'event-1',
          financeLedgerEntryId: 'ledger-1',
          idempotencyKey: 'ledger-1:SALE_RECORDED',
          vendorId: 'sporjinal',
          eventType: 'SALE_RECORDED',
        }),
      ],
    });
    expect(prismaMock.financeEvent.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.financeEvent.create).not.toHaveBeenCalled();
    expect(prismaMock.financeEvent.createMany).not.toHaveBeenCalled();
  });

  it('execution relinks a null financeLedgerEntryId event when idempotency key, vendor, and eventType match', async () => {
    prismaMock.financeLedgerEntry.findMany.mockResolvedValueOnce([ledgerRow({ id: 'ledger-1' })]);
    prismaMock.financeEvent.findMany.mockResolvedValueOnce([financeEvent({ id: 'event-1' })]);
    prismaMock.financeEvent.updateMany.mockResolvedValueOnce({ count: 1 });

    const result = await relinkExistingFinanceEvents();

    expect(result.writesPerformed).toBe(true);
    expect(result.summary).toMatchObject({
      relinkCandidateEvents: 1,
      affectedLedgerRows: 1,
      relinkedEvents: 1,
      skippedEvents: 0,
    });
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(prismaMock.financeEvent.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'event-1',
        financeLedgerEntryId: null,
        idempotencyKey: 'ledger-1:SALE_RECORDED',
        vendorId: 'sporjinal',
        eventType: 'SALE_RECORDED',
      },
      data: {
        financeLedgerEntryId: 'ledger-1',
      },
    });
  });

  it('execution does not duplicate events', async () => {
    prismaMock.financeLedgerEntry.findMany.mockResolvedValueOnce([ledgerRow({ id: 'ledger-1' })]);
    prismaMock.financeEvent.findMany.mockResolvedValueOnce([financeEvent({ id: 'event-1' })]);
    prismaMock.financeEvent.updateMany.mockResolvedValueOnce({ count: 1 });

    await relinkExistingFinanceEvents();

    expect(prismaMock.financeEvent.create).not.toHaveBeenCalled();
    expect(prismaMock.financeEvent.createMany).not.toHaveBeenCalled();
    expect(prismaMock.financeEvent.upsert).not.toHaveBeenCalled();
  });

  it('execution skips mismatched vendor', async () => {
    prismaMock.financeLedgerEntry.findMany.mockResolvedValueOnce([ledgerRow({ id: 'ledger-1', vendorId: 'sporjinal' })]);
    prismaMock.financeEvent.findMany.mockResolvedValueOnce([
      financeEvent({ id: 'event-1', vendorId: 'yalispor', idempotencyKey: 'ledger-1:SALE_RECORDED' }),
    ]);

    const result = await relinkExistingFinanceEvents();

    expect(result.writesPerformed).toBe(false);
    expect(result.summary.relinkedEvents).toBe(0);
    expect(prismaMock.financeEvent.updateMany).not.toHaveBeenCalled();
  });

  it('execution skips unexpected event type', async () => {
    prismaMock.financeLedgerEntry.findMany.mockResolvedValueOnce([ledgerRow({ id: 'ledger-1', entryType: 'sale' })]);
    prismaMock.financeEvent.findMany.mockResolvedValueOnce([
      financeEvent({
        id: 'event-1',
        eventType: 'REFUND_RECORDED',
        idempotencyKey: 'ledger-1:REFUND_RECORDED',
      }),
    ]);

    const result = await relinkExistingFinanceEvents();

    expect(result.writesPerformed).toBe(false);
    expect(result.summary.relinkedEvents).toBe(0);
    expect(prismaMock.financeEvent.updateMany).not.toHaveBeenCalled();
  });

  it('execution skips already linked events', async () => {
    prismaMock.financeLedgerEntry.findMany.mockResolvedValueOnce([ledgerRow({ id: 'ledger-1' })]);
    prismaMock.financeEvent.findMany.mockResolvedValueOnce([
      financeEvent({ id: 'event-1', financeLedgerEntryId: 'ledger-1' }),
    ]);

    const result = await relinkExistingFinanceEvents();

    expect(result.writesPerformed).toBe(false);
    expect(result.summary.relinkedEvents).toBe(0);
    expect(prismaMock.financeEvent.updateMany).not.toHaveBeenCalled();
  });

  it('execution does not modify non-link fields', async () => {
    prismaMock.financeLedgerEntry.findMany.mockResolvedValueOnce([ledgerRow({ id: 'ledger-1' })]);
    prismaMock.financeEvent.findMany.mockResolvedValueOnce([financeEvent({ id: 'event-1' })]);
    prismaMock.financeEvent.updateMany.mockResolvedValueOnce({ count: 1 });

    await relinkExistingFinanceEvents();

    const updateCall = prismaMock.financeEvent.updateMany.mock.calls[0]?.[0];
    expect(updateCall.data).toEqual({
      financeLedgerEntryId: 'ledger-1',
    });
    expect(Object.keys(updateCall.data)).toEqual(['financeLedgerEntryId']);
  });
});
