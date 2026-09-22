import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RefundTerminalEvidenceResolutionOutcome,
  RefundTerminalEvidenceReviewEventType,
  RefundTerminalEvidenceReviewStatus,
} from '../backend/node_modules/@prisma/client/index.js';
import {
  acknowledgeAdminRefundReview,
  AdminRefundReviewLifecycleError,
  getAdminRefundReviewDetail,
  reopenAdminRefundReview,
  resolveAdminRefundReview,
} from '../backend/src/modules/finance/admin-refund-review-lifecycle.service.js';

function createDb(initialStatus: RefundTerminalEvidenceReviewStatus) {
  let revision = 0;
  const review = {
    id: 'review-1',
    status: initialStatus,
    resolutionOutcome: initialStatus === RefundTerminalEvidenceReviewStatus.RESOLVED
      ? RefundTerminalEvidenceResolutionOutcome.NO_CORRECTION_NEEDED
      : null,
    sourceShopifyRefundId: 'refund-1',
    sourceShopifyOrderId: 'order-1',
    vendorAllocationId: 'allocation-1',
    economicVendorId: 'vendor-1',
    economicVendor: { name: 'Vendor' },
    terminalRefundFinanceLedgerEntryId: 'ledger-1',
    terminalRefundFinanceLedgerEntry: { amount: { toString: () => '42.00' } },
    storedEvidenceSnapshotId: 'snapshot-1',
    storedEvidenceSnapshot: { currency: 'TRY', evidenceVersion: 'v1', normalizationVersion: 'n1' },
    conflictCategory: 'refund_evidence_hash_mismatch',
    storedEvidenceHash: 'stored', incomingEvidenceHash: 'incoming',
    storedEvidenceSummaryJson: { amount: '42.00' },
    incomingEvidenceSummaryJson: { amount: '44.00' },
    conflictSummaryJson: { changed: ['amount'] },
    firstObservedAt: new Date('2026-09-20T10:00:00.000Z'),
    lastObservedAt: new Date('2026-09-20T10:00:00.000Z'),
    occurrenceCount: 1,
    createdAt: new Date('2026-09-20T10:00:00.000Z'),
    updatedAt: new Date('2026-09-20T10:00:00.000Z'),
    events: [] as Array<Record<string, unknown>>,
  };
  if (initialStatus === RefundTerminalEvidenceReviewStatus.RESOLVED) {
    review.events.push({
      id: 'event-resolved', eventType: RefundTerminalEvidenceReviewEventType.RESOLVED,
      actorUserId: 'admin-1', actorUser: { name: 'Admin' }, note: null,
      resolutionOutcome: RefundTerminalEvidenceResolutionOutcome.NO_CORRECTION_NEEDED,
      createdAt: new Date('2026-09-20T11:00:00.000Z'),
    });
  }

  const db = {
    refundTerminalEvidenceReview: {
      findUnique: vi.fn(async () => ({
        ...review,
        economicVendor: { ...review.economicVendor },
        terminalRefundFinanceLedgerEntry: review.terminalRefundFinanceLedgerEntry,
        storedEvidenceSnapshot: review.storedEvidenceSnapshot ? { ...review.storedEvidenceSnapshot } : null,
        events: review.events.map((event) => ({
          ...event,
          actorUser: event.actorUser ? { ...(event.actorUser as Record<string, unknown>) } : null,
        })),
      })),
      updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        if (review.status !== where.status
          || review.updatedAt.getTime() !== (where.updatedAt as Date).getTime()
          || review.occurrenceCount !== where.occurrenceCount) return { count: 0 };
        review.status = data.status as RefundTerminalEvidenceReviewStatus;
        review.resolutionOutcome = data.resolutionOutcome as RefundTerminalEvidenceResolutionOutcome | null;
        revision += 1;
        review.updatedAt = new Date(`2026-09-20T10:00:0${revision}.000Z`);
        return { count: 1 };
      }),
    },
    refundTerminalEvidenceReviewEvent: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        review.events.push({
          id: `event-${review.events.length + 1}`,
          eventType: data.eventType,
          actorUserId: data.actorUserId,
          actorUser: { name: 'Admin' },
          note: data.note,
          resolutionOutcome: data.resolutionOutcome,
          createdAt: new Date(`2026-09-20T12:00:0${review.events.length}.000Z`),
        });
      }),
    },
    $transaction: vi.fn(async (callback: (tx: unknown) => unknown) => callback(db)),
  };
  return { db, review };
}

function freshness(status: RefundTerminalEvidenceReviewStatus, updatedAt = '2026-09-20T10:00:00.000Z', occurrenceCount = 1) {
  return { expectedStatus: status, expectedUpdatedAt: updatedAt, expectedOccurrenceCount: occurrenceCount };
}

describe('terminal refund evidence review lifecycle', () => {
  beforeEach(() => vi.clearAllMocks());

  it('acknowledges ACTIVE atomically with actor and optional note', async () => {
    const { db, review } = createDb(RefundTerminalEvidenceReviewStatus.ACTIVE);
    const result = await acknowledgeAdminRefundReview({
      reviewId: review.id, actorUserId: 'admin-1', note: 'Investigating',
      freshness: freshness(RefundTerminalEvidenceReviewStatus.ACTIVE),
    }, db as never);
    expect(result.status).toBe('ACKNOWLEDGED');
    expect(review.events.at(-1)).toMatchObject({ eventType: 'ACKNOWLEDGED', actorUserId: 'admin-1', note: 'Investigating' });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });

  it.each(Object.values(RefundTerminalEvidenceResolutionOutcome))('resolves ACKNOWLEDGED with %s on review and history', async (outcome) => {
    const { db, review } = createDb(RefundTerminalEvidenceReviewStatus.ACKNOWLEDGED);
    const result = await resolveAdminRefundReview({
      reviewId: review.id, actorUserId: 'admin-1', resolutionOutcome: outcome,
      freshness: freshness(RefundTerminalEvidenceReviewStatus.ACKNOWLEDGED),
    }, db as never);
    expect(result).toMatchObject({ status: 'RESOLVED', resolutionOutcome: outcome });
    expect(review.events.at(-1)).toMatchObject({ eventType: 'RESOLVED', resolutionOutcome: outcome });
  });

  it('rejects direct ACTIVE resolution and ACKNOWLEDGED reopen', async () => {
    const active = createDb(RefundTerminalEvidenceReviewStatus.ACTIVE);
    await expect(resolveAdminRefundReview({
      reviewId: active.review.id, actorUserId: 'admin-1',
      resolutionOutcome: RefundTerminalEvidenceResolutionOutcome.NO_CORRECTION_NEEDED,
      freshness: freshness(RefundTerminalEvidenceReviewStatus.ACKNOWLEDGED),
    }, active.db as never)).rejects.toBeInstanceOf(AdminRefundReviewLifecycleError);
    const acknowledged = createDb(RefundTerminalEvidenceReviewStatus.ACKNOWLEDGED);
    await expect(reopenAdminRefundReview({
      reviewId: acknowledged.review.id, actorUserId: 'admin-1',
      freshness: freshness(RefundTerminalEvidenceReviewStatus.RESOLVED),
    }, acknowledged.db as never)).rejects.toBeInstanceOf(AdminRefundReviewLifecycleError);
  });

  it('reopens RESOLVED, clears current outcome, and preserves resolved history', async () => {
    const { db, review } = createDb(RefundTerminalEvidenceReviewStatus.RESOLVED);
    const result = await reopenAdminRefundReview({
      reviewId: review.id, actorUserId: 'admin-1', note: 'New investigation',
      freshness: freshness(RefundTerminalEvidenceReviewStatus.RESOLVED),
    }, db as never);
    expect(result).toMatchObject({ status: 'ACTIVE', resolutionOutcome: null });
    expect(result.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ eventType: 'RESOLVED', resolutionOutcome: 'NO_CORRECTION_NEEDED' }),
      expect.objectContaining({ eventType: 'REOPENED', resolutionOutcome: null }),
    ]));
  });

  it('treats safe same-actor retries as idempotent without duplicate events', async () => {
    const { db, review } = createDb(RefundTerminalEvidenceReviewStatus.ACTIVE);
    const input = { reviewId: review.id, actorUserId: 'admin-1', freshness: freshness(RefundTerminalEvidenceReviewStatus.ACTIVE) };
    await acknowledgeAdminRefundReview(input, db as never);
    await acknowledgeAdminRefundReview(input, db as never);
    expect(db.refundTerminalEvidenceReviewEvent.create).toHaveBeenCalledTimes(1);
  });

  it('does not duplicate RESOLVED or REOPENED events on safe same-actor retries', async () => {
    const resolving = createDb(RefundTerminalEvidenceReviewStatus.ACKNOWLEDGED);
    const resolveInput = {
      reviewId: resolving.review.id,
      actorUserId: 'admin-1',
      resolutionOutcome: RefundTerminalEvidenceResolutionOutcome.INSUFFICIENT_EVIDENCE,
      freshness: freshness(RefundTerminalEvidenceReviewStatus.ACKNOWLEDGED),
    };
    await resolveAdminRefundReview(resolveInput, resolving.db as never);
    await resolveAdminRefundReview(resolveInput, resolving.db as never);
    expect(resolving.db.refundTerminalEvidenceReviewEvent.create).toHaveBeenCalledTimes(1);

    const reopening = createDb(RefundTerminalEvidenceReviewStatus.RESOLVED);
    const reopenInput = {
      reviewId: reopening.review.id,
      actorUserId: 'admin-1',
      freshness: freshness(RefundTerminalEvidenceReviewStatus.RESOLVED),
    };
    await reopenAdminRefundReview(reopenInput, reopening.db as never);
    await reopenAdminRefundReview(reopenInput, reopening.db as never);
    expect(reopening.db.refundTerminalEvidenceReviewEvent.create).toHaveBeenCalledTimes(1);
  });

  it('rejects stale updatedAt and changed occurrence count without an event', async () => {
    const staleTime = createDb(RefundTerminalEvidenceReviewStatus.ACTIVE);
    await expect(acknowledgeAdminRefundReview({
      reviewId: staleTime.review.id, actorUserId: 'admin-1',
      freshness: freshness(RefundTerminalEvidenceReviewStatus.ACTIVE, '2026-09-19T10:00:00.000Z'),
    }, staleTime.db as never)).rejects.toMatchObject({ statusCode: 409 });
    const staleOccurrence = createDb(RefundTerminalEvidenceReviewStatus.ACTIVE);
    staleOccurrence.review.occurrenceCount = 2;
    await expect(acknowledgeAdminRefundReview({
      reviewId: staleOccurrence.review.id, actorUserId: 'admin-1',
      freshness: freshness(RefundTerminalEvidenceReviewStatus.ACTIVE, undefined, 1),
    }, staleOccurrence.db as never)).rejects.toMatchObject({ statusCode: 409 });
    expect(staleTime.db.refundTerminalEvidenceReviewEvent.create).not.toHaveBeenCalled();
    expect(staleOccurrence.db.refundTerminalEvidenceReviewEvent.create).not.toHaveBeenCalled();
  });

  it('allows exactly one winner for concurrent transitions', async () => {
    const { db, review } = createDb(RefundTerminalEvidenceReviewStatus.ACTIVE);
    const input = { reviewId: review.id, actorUserId: 'admin-1', freshness: freshness(RefundTerminalEvidenceReviewStatus.ACTIVE) };
    const results = await Promise.allSettled([
      acknowledgeAdminRefundReview(input, db as never),
      acknowledgeAdminRefundReview({ ...input, actorUserId: 'admin-2' }, db as never),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(db.refundTerminalEvidenceReviewEvent.create).toHaveBeenCalledTimes(1);
  });

  it('returns safe detail fields and exposes no raw payload or customer PII', async () => {
    const { db } = createDb(RefundTerminalEvidenceReviewStatus.ACTIVE);
    const result = await getAdminRefundReviewDetail('review-1', db as never);
    expect(result).toMatchObject({ acceptedRecordedAmount: '42.00', evidenceVersion: 'v1', occurrenceCount: 1 });
    expect(JSON.stringify(result)).not.toMatch(/customerEmail|shippingAddress|rawPayload|accessToken/);
  });

  it('does not expose any finance mutation dependency for lifecycle commands', async () => {
    const { db, review } = createDb(RefundTerminalEvidenceReviewStatus.ACKNOWLEDGED);
    await resolveAdminRefundReview({
      reviewId: review.id, actorUserId: 'admin-1',
      resolutionOutcome: RefundTerminalEvidenceResolutionOutcome.CORRECTION_REQUIRED,
      freshness: freshness(RefundTerminalEvidenceReviewStatus.ACKNOWLEDGED),
    }, db as never);
    expect(Object.keys(db).sort()).toEqual(['$transaction', 'refundTerminalEvidenceReview', 'refundTerminalEvidenceReviewEvent']);
  });
});
