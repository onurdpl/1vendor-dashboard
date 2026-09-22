import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  refundTerminalEvidenceReview: { count: vi.fn(), findMany: vi.fn() },
  legacyRefundFinanceReview: { count: vi.fn(), findMany: vi.fn() },
  $queryRaw: vi.fn(),
}));
vi.mock('../backend/src/db/prisma.js', () => ({ prisma: db }));

const { listAdminRefundReviews, loadLegacyRefundFinanceCandidates } = await import('../backend/src/modules/finance/admin-refund-review-projection.service.js');

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
  db.legacyRefundFinanceReview.count.mockResolvedValue(0);
  db.legacyRefundFinanceReview.findMany.mockResolvedValue([]);
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
    const items = await loadLegacyRefundFinanceCandidates('vendor');
    expect(items).toHaveLength(5);
    expect(items[0]).toMatchObject({ artifactId: 'fin-vendor-refund-r1-a1', attribution: 'exact', voidedAt: new Date('2026-07-03T00:00:00Z') });
    expect(items[1]).toMatchObject({ artifactId: 'legacy-unknown', attribution: 'ambiguous', sourceShopifyRefundId: null, supersededByLedgerId: 'later-ledger' });
    expect(items[2]).toMatchObject({ artifactId: 'ledger-linked-event', attribution: 'exact' });
    expect(items[3]).toMatchObject({ artifactType: 'settlement_refund_adjustment', recordedAmountMinor: 3000, attribution: 'exact' });
    expect(items[4]).toMatchObject({ artifactType: 'vendor_debt_event', recordedAmountMinor: -900, attribution: 'exact' });
    const sql = db.$queryRaw.mock.calls[0][0].strings.join('');
    expect(sql).toContain('RefundEvidenceSnapshot');
    expect(sql).toContain('COUNT(DISTINCT matched."sourceShopifyRefundId") = 1');
    expect(sql).toContain('VENDOR_DEBT_CREATED');
    expect(sql).toContain('SettlementRefundAdjustment');
    expect(sql).toContain('shopify_refund');
    expect(sql).toContain('ORDER BY "observedAt" ASC, "artifactId" ASC');
  });

  it('lists only persisted legacy review cases without invoking discovery SQL', async () => {
    db.legacyRefundFinanceReview.count.mockResolvedValue(1);
    db.legacyRefundFinanceReview.findMany.mockResolvedValue([{
      id: 'legacy-1', status: 'ACKNOWLEDGED', resolutionOutcome: null, attribution: 'EXACT',
      sourceShopifyOrderId: 'order-1', sourceShopifyRefundId: 'refund-1', vendorAllocationId: 'allocation-1',
      observedVendorId: 'vendor', observedVendor: { name: 'Vendor' }, _count: { sources: 4 },
      firstObservedAt: new Date('2026-07-01T00:00:00Z'), lastObservedAt: new Date('2026-07-02T00:00:00Z'),
      occurrenceCount: 3, createdAt: new Date('2026-07-01T00:00:00Z'), updatedAt: new Date('2026-07-02T00:00:00Z'),
    }]);
    const result = await listAdminRefundReviews(request);
    expect(result.legacyCandidates).toMatchObject({ count: 1, items: [{
      id: 'legacy-1', status: 'ACKNOWLEDGED', attribution: 'exact', sourceCount: 4, occurrenceCount: 3,
    }] });
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });

  it('keeps independent pagination and errors; SQL excludes snapshot-backed evidence', async () => {
    db.refundTerminalEvidenceReview.count.mockRejectedValue(new Error('database unavailable'));
    db.$queryRaw.mockImplementation((query: { strings: readonly string[] }) =>
      query.strings.join('').includes('COUNT(*)') ? Promise.resolve([{ count: 0n }]) : Promise.resolve([]));
    const result = await listAdminRefundReviews({ vendorId: null, terminal: { limit: 3, offset: 6 }, legacy: { limit: 7, offset: 14 } });
    expect(result.terminalReviews.error).toBeTruthy();
    expect(result.legacyCandidates.error).toBeNull();
    expect(db.refundTerminalEvidenceReview.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 6, take: 3 }));
  });
});
