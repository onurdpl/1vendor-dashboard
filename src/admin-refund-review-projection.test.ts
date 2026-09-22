import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  refundTerminalEvidenceReview: { count: vi.fn(), findMany: vi.fn() },
  $queryRaw: vi.fn(),
}));
vi.mock('../backend/src/db/prisma.js', () => ({ prisma: db }));

const { listAdminRefundReviews } = await import('../backend/src/modules/finance/admin-refund-review-projection.service.js');

const page = { limit: 2, offset: 0 };
const request = { vendorId: 'vendor', terminal: page, legacy: page };

function sourceRow(overrides: Record<string, unknown> = {}) {
  return {
    artifactType: 'refund_ledger', artifactId: 'fin-vendor-refund-r1-a1',
    vendorId: 'vendor', vendorName: 'Vendor', sourceShopifyOrderId: 'order',
    sourceShopifyRefundId: 'r1', vendorAllocationId: 'a1', amount: { toString: () => '42.00' },
    amountMinor: null, currency: null, observedAt: new Date('2026-07-01T00:00:00Z'),
    state: 'PENDING', voidedAt: null, supersededByLedgerId: null, exactRefundRecordId: 'record-1',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.refundTerminalEvidenceReview.count.mockResolvedValue(0);
  db.refundTerminalEvidenceReview.findMany.mockResolvedValue([]);
  db.$queryRaw.mockImplementation((query: { strings: readonly string[] }) =>
    query.strings.join('').includes('COUNT(*)') ? Promise.resolve([{ count: 0n }]) : Promise.resolve([]));
});

describe('Admin refund review read-only projection', () => {
  it('returns distinct terminal review IDs with only persisted accepted money', async () => {
    const review = (id: string) => ({
      id, status: 'ACTIVE', resolutionOutcome: null, sourceShopifyRefundId: 'r1', sourceShopifyOrderId: 'order',
      vendorAllocationId: 'a1', economicVendorId: 'vendor', economicVendor: { name: 'Vendor' },
      terminalRefundFinanceLedgerEntryId: 'ledger', storedEvidenceSnapshotId: 'snapshot',
      storedEvidenceSnapshot: { currency: 'TRY' },
      conflictCategory: 'refund_evidence_hash_mismatch', storedEvidenceHash: 'stored', incomingEvidenceHash: 'incoming',
      occurrenceCount: 2, firstObservedAt: new Date('2026-07-01T00:00:00Z'), lastObservedAt: new Date('2026-07-02T00:00:00Z'),
      createdAt: new Date('2026-07-01T00:00:00Z'), updatedAt: new Date('2026-07-02T00:00:00Z'),
      terminalRefundFinanceLedgerEntry: { amount: { toString: () => '42.00' } },
    });
    db.refundTerminalEvidenceReview.count.mockResolvedValue(2);
    db.refundTerminalEvidenceReview.findMany.mockResolvedValue([review('review-1'), review('review-2')]);
    const result = await listAdminRefundReviews(request);
    expect(result.terminalReviews.items.map((item) => item.id)).toEqual(['review-1', 'review-2']);
    expect(result.terminalReviews.items[0]).toMatchObject({ acceptedRecordedAmount: '42.00', acceptedRecordedCurrency: 'TRY', occurrenceCount: 2 });
    expect(JSON.stringify(result)).not.toMatch(/customerEmail|shippingAddress|incomingAmount|normalizedEvidenceJson/);
    expect(db.refundTerminalEvidenceReview.findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: [{ lastObservedAt: 'desc' }, { id: 'desc' }], skip: 0, take: 2 }));
  });

  it('retains exact, voided, superseded and ambiguous legacy artifacts without a RefundRecord-only row', async () => {
    db.$queryRaw.mockImplementation((query: { strings: readonly string[] }) =>
      query.strings.join('').includes('COUNT(*)') ? Promise.resolve([{ count: 5n }]) : Promise.resolve([
        sourceRow({ voidedAt: new Date('2026-07-03T00:00:00Z') }),
        sourceRow({ artifactId: 'legacy-unknown', exactRefundRecordId: null, sourceShopifyRefundId: null, supersededByLedgerId: 'later-ledger' }),
        sourceRow({ artifactId: 'ledger-linked-event', exactRefundRecordId: null, sourceShopifyRefundId: 'r1' }),
        sourceRow({ artifactType: 'settlement_refund_adjustment', artifactId: 'adjustment-1', amount: null, amountMinor: 3000, currency: 'TRY', exactRefundRecordId: 'record-1' }),
        sourceRow({ artifactType: 'vendor_debt_event', artifactId: 'debt-1', amount: null, amountMinor: -900, currency: 'TRY', exactRefundRecordId: 'record-1' }),
      ]));
    const result = await listAdminRefundReviews(request);
    expect(result.legacyCandidates.items).toHaveLength(5);
    expect(result.legacyCandidates.items[0]).toMatchObject({ id: 'fin-vendor-refund-r1-a1', attribution: 'exact', voidedAt: '2026-07-03T00:00:00.000Z' });
    expect(result.legacyCandidates.items[1]).toMatchObject({ id: 'legacy-unknown', attribution: 'ambiguous', sourceShopifyRefundId: null, supersededByLedgerId: 'later-ledger' });
    expect(result.legacyCandidates.items[2]).toMatchObject({ id: 'ledger-linked-event', attribution: 'exact' });
    expect(result.legacyCandidates.items[3]).toMatchObject({ artifactType: 'settlement_refund_adjustment', recordedAmountMinor: 3000, attribution: 'exact' });
    expect(result.legacyCandidates.items[4]).toMatchObject({ artifactType: 'vendor_debt_event', recordedAmountMinor: -900, attribution: 'exact' });
  });

  it('keeps independent pagination and errors; SQL excludes snapshot-backed evidence', async () => {
    db.refundTerminalEvidenceReview.count.mockRejectedValue(new Error('database unavailable'));
    db.$queryRaw.mockImplementation((query: { strings: readonly string[] }) =>
      query.strings.join('').includes('COUNT(*)') ? Promise.resolve([{ count: 0n }]) : Promise.resolve([]));
    const result = await listAdminRefundReviews({ vendorId: null, terminal: { limit: 3, offset: 6 }, legacy: { limit: 7, offset: 14 } });
    expect(result.terminalReviews.error).toBeTruthy();
    expect(result.legacyCandidates.error).toBeNull();
    expect(db.refundTerminalEvidenceReview.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 6, take: 3 }));
    const queries = db.$queryRaw.mock.calls.map(([query]) => query.strings.join(''));
    expect(queries.every((sql) => sql.includes('RefundEvidenceSnapshot'))).toBe(true);
    expect(queries.some((sql) => sql.includes('ORDER BY "observedAt" DESC, "artifactId" DESC'))).toBe(true);
    expect(queries.every((sql) => sql.includes('COUNT(DISTINCT matched."sourceShopifyRefundId") = 1'))).toBe(true);
    expect(queries.some((sql) => sql.includes('VENDOR_DEBT_CREATED'))).toBe(true);
    expect(queries.some((sql) => sql.includes('SettlementRefundAdjustment'))).toBe(true);
    expect(queries.some((sql) => sql.includes('shopify_refund'))).toBe(true);
  });
});
