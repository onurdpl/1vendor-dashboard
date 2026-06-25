import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  vendorAllocation: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
  },
  refundRecord: {
    findMany: vi.fn(),
  },
  operationalJob: {
    findMany: vi.fn(),
  },
}));

vi.mock('../backend/src/db/prisma.js', () => ({
  prisma: prismaMock,
}));

const { findScheduledReconciliationCandidates } = await import(
  '../backend/src/modules/reconciliation/scheduled-reconciliation.service.js'
);

function saleLedger() {
  return {
    id: 'fin-vendor-a-sale-order-1-alloc-a',
    vendorId: 'vendor-a',
    entryType: 'sale',
    voidedAt: null,
  };
}

function refundRecordWithLedger(input: {
  ledgerId: string;
}) {
  return {
    id: 'refund-record-1',
    vendorAllocationId: 'alloc-a',
    sourceShopifyRefundId: 'refund-1',
    updatedAt: new Date('2026-06-01T10:00:00.000Z'),
    vendorAllocation: {
      id: 'alloc-a',
      order: {
        sourceShopifyOrderId: 'order-1',
      },
      financeEntries: [
        {
          id: input.ledgerId,
          vendorId: 'vendor-a',
          voidedAt: null,
        },
      ],
    },
  };
}

describe('scheduled reconciliation refund ledger ids', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.vendorAllocation.findMany.mockResolvedValue([]);
    prismaMock.operationalJob.findMany.mockResolvedValue([]);
    prismaMock.vendorAllocation.findUnique.mockResolvedValue({
      id: 'alloc-a',
      financeEntries: [saleLedger()],
      economicTransfers: [],
    });
  });

  it('does not schedule missing-refund-ledger work when allocation-scoped ledger exists', async () => {
    prismaMock.refundRecord.findMany.mockResolvedValue([
      refundRecordWithLedger({
        ledgerId: 'fin-vendor-a-refund-refund-1-alloc-a',
      }),
    ]);

    const candidates = await findScheduledReconciliationCandidates({
      now: new Date('2026-06-01T11:00:00.000Z'),
    });

    expect(candidates).toEqual([]);
  });

  it('reports legacy refund ledger rows as migration/backfill work', async () => {
    prismaMock.refundRecord.findMany.mockResolvedValue([
      refundRecordWithLedger({
        ledgerId: 'fin-vendor-a-refund-refund-1',
      }),
    ]);

    const candidates = await findScheduledReconciliationCandidates({
      now: new Date('2026-06-01T11:00:00.000Z'),
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      type: 'missing_refund_ledger',
      vendorAllocationId: 'alloc-a',
      refundRecordId: 'refund-record-1',
      reason: expect.stringContaining('legacy refund ledger fin-vendor-a-refund-refund-1'),
    });
  });
});
