import { beforeEach, describe, expect, it, vi } from 'vitest';
const LegacyRefundFinanceReviewStatus = {
  ACTIVE: 'ACTIVE', ACKNOWLEDGED: 'ACKNOWLEDGED', RESOLVED: 'RESOLVED',
} as const;
const LegacyRefundFinanceResolutionOutcome = {
  NO_CORRECTION_NEEDED: 'NO_CORRECTION_NEEDED',
  CORRECTION_REQUIRED: 'CORRECTION_REQUIRED',
  INSUFFICIENT_EVIDENCE: 'INSUFFICIENT_EVIDENCE',
} as const;

const loadCandidatesMock = vi.hoisted(() => vi.fn());
const tx = vi.hoisted(() => ({
  legacyRefundFinanceReview: {
    findUnique: vi.fn(), createMany: vi.fn(), update: vi.fn(), updateMany: vi.fn(),
  },
  legacyRefundFinanceReviewSource: { upsert: vi.fn() },
  legacyRefundFinanceReviewEvent: { create: vi.fn() },
}));
const prismaMock = vi.hoisted(() => ({
  legacyRefundFinanceReviewSource: { findMany: vi.fn() },
  $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
}));

vi.mock('../backend/src/db/prisma.js', () => ({ prisma: prismaMock }));
vi.mock('../backend/src/modules/finance/admin-refund-review-projection.service.js', () => ({
  loadLegacyRefundFinanceCandidates: loadCandidatesMock,
}));

const {
  acknowledgeAdminLegacyRefundReview,
  buildLegacyReviewCaseKey,
  reopenAdminLegacyRefundReview,
  resolveAdminLegacyRefundReview,
  syncLegacyRefundFinanceReviews,
} = await import('../backend/src/modules/finance/admin-legacy-refund-review.service.js');

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    artifactType: 'refund_ledger', artifactId: 'ledger-1', attribution: 'exact',
    sourceShopifyOrderId: 'order-1', sourceShopifyRefundId: 'refund-1',
    vendorAllocationId: 'allocation-1', observedVendorId: 'vendor-1', vendorName: 'Vendor One',
    recordedAmount: '42.00', recordedAmountMinor: null, recordedCurrency: 'TRY',
    observedAt: new Date('2026-09-20T10:00:00.000Z'), state: 'PENDING',
    voidedAt: null, supersededByLedgerId: null, ...overrides,
  } as any;
}

function review(overrides: Record<string, unknown> = {}) {
  return {
    id: 'legacy-1', caseKey: 'case-1', status: LegacyRefundFinanceReviewStatus.ACTIVE,
    resolutionOutcome: null, attribution: 'EXACT', sourceShopifyRefundId: 'refund-1',
    sourceShopifyOrderId: 'order-1', vendorAllocationId: 'allocation-1', observedVendorId: 'vendor-1',
    observedVendor: { name: 'Vendor One' }, firstObservedAt: new Date('2026-09-20T10:00:00.000Z'),
    lastObservedAt: new Date('2026-09-20T10:00:00.000Z'), occurrenceCount: 1,
    createdAt: new Date('2026-09-20T10:00:00.000Z'), updatedAt: new Date('2026-09-20T10:00:00.000Z'),
    sources: [], events: [{ id: 'detected', eventType: 'DETECTED', actorUserId: null, actorUser: null, note: null, resolutionOutcome: null, createdAt: new Date('2026-09-20T10:00:00.000Z') }],
    ...overrides,
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.legacyRefundFinanceReviewSource.findMany.mockResolvedValue([]);
  tx.legacyRefundFinanceReview.createMany.mockResolvedValue({ count: 1 });
  tx.legacyRefundFinanceReview.update.mockResolvedValue({});
  tx.legacyRefundFinanceReviewSource.upsert.mockResolvedValue({});
  tx.legacyRefundFinanceReviewEvent.create.mockResolvedValue({});
});

describe('legacy refund finance review discovery', () => {
  it('groups all proven artifact types under one exact refund/allocation review and preserves sources', async () => {
    loadCandidatesMock.mockResolvedValue([
      candidate(),
      candidate({ artifactType: 'settlement_refund_adjustment', artifactId: 'adjustment-1' }),
      candidate({ artifactType: 'vendor_debt_event', artifactId: 'debt-1' }),
      candidate({ artifactType: 'finance_event', artifactId: 'event-1' }),
    ]);

    const result = await syncLegacyRefundFinanceReviews({ vendorId: 'vendor-1' });

    expect(result).toMatchObject({ candidates: 4, createdReviews: 1, createdSources: 4 });
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.legacyRefundFinanceReview.createMany).toHaveBeenCalledTimes(1);
    expect(tx.legacyRefundFinanceReviewSource.upsert).toHaveBeenCalledTimes(4);
    expect(tx.legacyRefundFinanceReviewEvent.create).toHaveBeenCalledTimes(1);
    expect(tx.legacyRefundFinanceReviewEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ eventType: 'DETECTED' }),
    }));
  });

  it('keeps ambiguous artifacts in separate artifact-scoped cases', async () => {
    loadCandidatesMock.mockResolvedValue([
      candidate({ attribution: 'ambiguous', artifactId: 'ledger-a', sourceShopifyRefundId: null, vendorAllocationId: null }),
      candidate({ attribution: 'ambiguous', artifactId: 'ledger-b', sourceShopifyRefundId: null, vendorAllocationId: null }),
    ]);

    const result = await syncLegacyRefundFinanceReviews();
    expect(result.createdReviews).toBe(2);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(2);
    const caseKeys = tx.legacyRefundFinanceReview.createMany.mock.calls.map((call) => call[0].data[0].caseKey);
    expect(new Set(caseKeys).size).toBe(2);
  });

  it('rediscovery updates observations without duplicating the review, source, or DETECTED event', async () => {
    const item = candidate();
    loadCandidatesMock.mockResolvedValue([item]);
    const caseKey = buildLegacyReviewCaseKey(item);
    prismaMock.legacyRefundFinanceReviewSource.findMany.mockResolvedValue([{
      artifactType: 'REFUND_LEDGER', artifactId: 'ledger-1', reviewId: 'legacy-1', review: { caseKey },
    }]);
    tx.legacyRefundFinanceReview.findUnique.mockResolvedValue({ caseKey });
    tx.legacyRefundFinanceReview.createMany.mockResolvedValue({ count: 0 });

    const result = await syncLegacyRefundFinanceReviews();
    expect(result).toMatchObject({ createdReviews: 0, updatedReviews: 1, createdSources: 0, updatedSources: 1 });
    expect(tx.legacyRefundFinanceReview.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ occurrenceCount: { increment: 1 } }),
    }));
    expect(tx.legacyRefundFinanceReviewEvent.create).not.toHaveBeenCalled();
  });
});

describe('legacy refund finance review lifecycle', () => {
  const freshness = { expectedStatus: LegacyRefundFinanceReviewStatus.ACTIVE, expectedUpdatedAt: '2026-09-20T10:00:00.000Z', expectedOccurrenceCount: 1 };

  it('atomically acknowledges with actor and note and performs only review-model writes', async () => {
    tx.legacyRefundFinanceReview.findUnique
      .mockResolvedValueOnce(review())
      .mockResolvedValueOnce(review({ status: 'ACKNOWLEDGED', events: [...review().events, { id: 'ack', eventType: 'ACKNOWLEDGED', actorUserId: 'admin-1', actorUser: { name: 'Admin' }, note: 'Investigating', resolutionOutcome: null, createdAt: new Date() }] }));
    tx.legacyRefundFinanceReview.updateMany.mockResolvedValue({ count: 1 });

    const result = await acknowledgeAdminLegacyRefundReview({ reviewId: 'legacy-1', actorUserId: 'admin-1', note: ' Investigating ', freshness }, prismaMock as any);
    expect(result.status).toBe('ACKNOWLEDGED');
    expect(tx.legacyRefundFinanceReviewEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ actorUserId: 'admin-1', note: 'Investigating', eventType: 'ACKNOWLEDGED' }) });
    expect(Object.keys(tx).sort()).toEqual(['legacyRefundFinanceReview', 'legacyRefundFinanceReviewEvent', 'legacyRefundFinanceReviewSource']);
  });

  it.each(Object.values(LegacyRefundFinanceResolutionOutcome))('resolves ACKNOWLEDGED with outcome %s', async (outcome) => {
    const acknowledged = review({ status: 'ACKNOWLEDGED' });
    tx.legacyRefundFinanceReview.findUnique
      .mockResolvedValueOnce(acknowledged)
      .mockResolvedValueOnce(review({ status: 'RESOLVED', resolutionOutcome: outcome }));
    tx.legacyRefundFinanceReview.updateMany.mockResolvedValue({ count: 1 });
    const result = await resolveAdminLegacyRefundReview({
      reviewId: 'legacy-1', actorUserId: 'admin-1', resolutionOutcome: outcome,
      freshness: { ...freshness, expectedStatus: LegacyRefundFinanceReviewStatus.ACKNOWLEDGED },
    }, prismaMock as any);
    expect(result).toMatchObject({ status: 'RESOLVED', resolutionOutcome: outcome });
  });

  it('rejects direct ACTIVE to RESOLVED and stale observation freshness without writing an event', async () => {
    tx.legacyRefundFinanceReview.findUnique.mockResolvedValue(review());
    await expect(resolveAdminLegacyRefundReview({
      reviewId: 'legacy-1', actorUserId: 'admin-1', resolutionOutcome: LegacyRefundFinanceResolutionOutcome.NO_CORRECTION_NEEDED,
      freshness: { ...freshness, expectedStatus: LegacyRefundFinanceReviewStatus.ACKNOWLEDGED },
    }, prismaMock as any)).rejects.toThrow(/cannot transition/);
    await expect(acknowledgeAdminLegacyRefundReview({
      reviewId: 'legacy-1', actorUserId: 'admin-1', freshness: { ...freshness, expectedOccurrenceCount: 2 },
    }, prismaMock as any)).rejects.toThrow(/changed after it was loaded/);
    expect(tx.legacyRefundFinanceReviewEvent.create).not.toHaveBeenCalled();
  });

  it('rejects ACKNOWLEDGED to ACTIVE while treating an approved retry as idempotent', async () => {
    tx.legacyRefundFinanceReview.findUnique.mockResolvedValue(review({ status: 'ACKNOWLEDGED' }));
    await expect(reopenAdminLegacyRefundReview({
      reviewId: 'legacy-1', actorUserId: 'admin-1', freshness: { ...freshness, expectedStatus: LegacyRefundFinanceReviewStatus.RESOLVED },
    }, prismaMock as any)).rejects.toThrow(/cannot transition/);

    const acknowledged = review({ status: 'ACKNOWLEDGED', events: [...review().events, {
      id: 'ack', eventType: 'ACKNOWLEDGED', actorUserId: 'admin-1', actorUser: { name: 'Admin' }, note: null,
      resolutionOutcome: null, createdAt: new Date(),
    }] });
    tx.legacyRefundFinanceReview.findUnique.mockResolvedValue(acknowledged);
    await expect(acknowledgeAdminLegacyRefundReview({
      reviewId: 'legacy-1', actorUserId: 'admin-1', freshness,
    }, prismaMock as any)).resolves.toMatchObject({ status: 'ACKNOWLEDGED' });
    expect(tx.legacyRefundFinanceReviewEvent.create).not.toHaveBeenCalled();
  });

  it('reopens RESOLVED, clears current outcome, and retains historical resolved evidence', async () => {
    const resolvedEvent = { id: 'resolved', eventType: 'RESOLVED', actorUserId: 'admin-1', actorUser: { name: 'Admin' }, note: null, resolutionOutcome: 'CORRECTION_REQUIRED', createdAt: new Date() };
    tx.legacyRefundFinanceReview.findUnique
      .mockResolvedValueOnce(review({ status: 'RESOLVED', resolutionOutcome: 'CORRECTION_REQUIRED', events: [...review().events, resolvedEvent] }))
      .mockResolvedValueOnce(review({ status: 'ACTIVE', resolutionOutcome: null, events: [...review().events, resolvedEvent, { ...resolvedEvent, id: 'reopen', eventType: 'REOPENED', resolutionOutcome: null }] }));
    tx.legacyRefundFinanceReview.updateMany.mockResolvedValue({ count: 1 });
    const result = await reopenAdminLegacyRefundReview({
      reviewId: 'legacy-1', actorUserId: 'admin-2', freshness: { ...freshness, expectedStatus: LegacyRefundFinanceReviewStatus.RESOLVED },
    }, prismaMock as any);
    expect(result.status).toBe('ACTIVE');
    expect(result.events.some((event: any) => event.eventType === 'RESOLVED' && event.resolutionOutcome === 'CORRECTION_REQUIRED')).toBe(true);
  });

  it('allows exactly one concurrent transition winner for the same freshness token', async () => {
    let current = review();
    const events: any[] = [];
    const localTx = {
      legacyRefundFinanceReview: {
        findUnique: vi.fn(async () => structuredClone(current)),
        updateMany: vi.fn(async ({ where, data }: any) => {
          if (current.status !== where.status || current.updatedAt.getTime() !== where.updatedAt.getTime() || current.occurrenceCount !== where.occurrenceCount) return { count: 0 };
          current = { ...current, ...data, updatedAt: new Date('2026-09-20T10:01:00.000Z') };
          return { count: 1 };
        }),
      },
      legacyRefundFinanceReviewSource: {},
      legacyRefundFinanceReviewEvent: {
        create: vi.fn(async ({ data }: any) => { events.push(data); current = { ...current, events: [...current.events, { id: 'ack', actorUser: null, createdAt: new Date(), resolutionOutcome: null, note: null, ...data }] }; }),
      },
    };
    const db = { $transaction: async (callback: (client: typeof localTx) => unknown) => callback(localTx) } as any;
    const attempts = await Promise.allSettled([
      acknowledgeAdminLegacyRefundReview({ reviewId: 'legacy-1', actorUserId: 'admin-1', freshness }, db),
      acknowledgeAdminLegacyRefundReview({ reviewId: 'legacy-1', actorUserId: 'admin-2', freshness }, db),
    ]);
    expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter((attempt) => attempt.status === 'rejected')).toHaveLength(1);
    expect(events).toHaveLength(1);
  });
});
