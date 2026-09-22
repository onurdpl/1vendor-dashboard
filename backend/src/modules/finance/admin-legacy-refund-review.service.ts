import { createHash } from 'node:crypto';
import {
  LegacyRefundFinanceArtifactType,
  LegacyRefundFinanceAttribution,
  LegacyRefundFinanceResolutionOutcome,
  LegacyRefundFinanceReviewEventType,
  LegacyRefundFinanceReviewStatus,
  Prisma,
} from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { loadLegacyRefundFinanceCandidates, type LegacyRefundFinanceCandidate } from './admin-refund-review-projection.service.js';

const artifactTypes = {
  refund_ledger: LegacyRefundFinanceArtifactType.REFUND_LEDGER,
  settlement_refund_adjustment: LegacyRefundFinanceArtifactType.SETTLEMENT_REFUND_ADJUSTMENT,
  vendor_debt_event: LegacyRefundFinanceArtifactType.VENDOR_DEBT_EVENT,
  finance_event: LegacyRefundFinanceArtifactType.FINANCE_EVENT,
} as const;

const detailSelect = {
  id: true, status: true, resolutionOutcome: true, attribution: true,
  sourceShopifyRefundId: true, sourceShopifyOrderId: true, vendorAllocationId: true,
  observedVendorId: true, observedVendor: { select: { name: true } },
  firstObservedAt: true, lastObservedAt: true, occurrenceCount: true, createdAt: true, updatedAt: true,
  sources: { orderBy: [{ observedAt: 'asc' as const }, { id: 'asc' as const }] },
  events: {
    orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
    select: { id: true, eventType: true, actorUserId: true, actorUser: { select: { name: true } }, note: true, resolutionOutcome: true, createdAt: true },
  },
} satisfies Prisma.LegacyRefundFinanceReviewSelect;

type Detail = Prisma.LegacyRefundFinanceReviewGetPayload<{ select: typeof detailSelect }>;
type TransactionDb = Pick<Prisma.TransactionClient, 'legacyRefundFinanceReview' | 'legacyRefundFinanceReviewSource' | 'legacyRefundFinanceReviewEvent'>;
type LifecycleDb = TransactionDb & Pick<typeof prisma, '$transaction'>;

export class AdminLegacyRefundReviewError extends Error {
  constructor(message: string, public statusCode = 409) { super(message); this.name = 'AdminLegacyRefundReviewError'; }
}

function hash(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

export function buildLegacyReviewCaseKey(candidate: LegacyRefundFinanceCandidate) {
  if (candidate.attribution === 'exact' && candidate.sourceShopifyRefundId && candidate.vendorAllocationId) {
    return `exact:${hash({ sourceShopifyRefundId: candidate.sourceShopifyRefundId, vendorAllocationId: candidate.vendorAllocationId })}`;
  }
  return `artifact:${hash({ artifactType: candidate.artifactType, artifactId: candidate.artifactId })}`;
}

function sourceFingerprint(candidate: LegacyRefundFinanceCandidate) {
  return hash({
    artifactType: candidate.artifactType, artifactId: candidate.artifactId,
    sourceShopifyOrderId: candidate.sourceShopifyOrderId, sourceShopifyRefundId: candidate.sourceShopifyRefundId,
    vendorAllocationId: candidate.vendorAllocationId, observedVendorId: candidate.observedVendorId,
    recordedAmount: candidate.recordedAmount, recordedAmountMinor: candidate.recordedAmountMinor,
    recordedCurrency: candidate.recordedCurrency, observedAt: candidate.observedAt.toISOString(),
    state: candidate.state, voidedAt: candidate.voidedAt?.toISOString() ?? null,
    supersededByLedgerId: candidate.supersededByLedgerId,
  });
}

function serialize(review: Detail) {
  return {
    id: review.id, status: review.status, resolutionOutcome: review.resolutionOutcome,
    attribution: review.attribution.toLowerCase() as 'exact' | 'ambiguous',
    sourceShopifyRefundId: review.sourceShopifyRefundId, sourceShopifyOrderId: review.sourceShopifyOrderId,
    vendorAllocationId: review.vendorAllocationId, observedVendorId: review.observedVendorId,
    vendorName: review.observedVendor?.name ?? null, firstObservedAt: review.firstObservedAt.toISOString(),
    lastObservedAt: review.lastObservedAt.toISOString(), occurrenceCount: review.occurrenceCount,
    createdAt: review.createdAt.toISOString(), updatedAt: review.updatedAt.toISOString(),
    sources: review.sources.map((source) => ({
      id: source.id, artifactType: source.artifactType.toLowerCase(), artifactId: source.artifactId,
      observedAt: source.observedAt.toISOString(), sourceState: source.sourceState,
      recordedAmount: source.recordedAmount?.toString() ?? null, recordedAmountMinor: source.recordedAmountMinor,
      currency: source.currency, voidedAt: source.voidedAt?.toISOString() ?? null,
      supersededByLedgerId: source.supersededByLedgerId,
    })),
    events: review.events.map((event) => ({
      id: event.id, eventType: event.eventType, actorUserId: event.actorUserId,
      actorName: event.actorUser?.name ?? null, note: event.note,
      resolutionOutcome: event.resolutionOutcome, createdAt: event.createdAt.toISOString(),
    })),
  };
}

async function loadReview(db: TransactionDb, reviewId: string) {
  const review = await db.legacyRefundFinanceReview.findUnique({ where: { id: reviewId }, select: detailSelect });
  if (!review) throw new AdminLegacyRefundReviewError('Legacy refund finance review not found.', 404);
  return review;
}

export async function getAdminLegacyRefundReviewDetail(reviewId: string, db: TransactionDb = prisma) {
  return serialize(await loadReview(db, reviewId));
}

export async function syncLegacyRefundFinanceReviews(input: { vendorId?: string | null } = {}) {
  const candidates = await loadLegacyRefundFinanceCandidates(input.vendorId ?? null);
  const artifactKeys = candidates.map((candidate) => ({
    artifactType: artifactTypes[candidate.artifactType], artifactId: candidate.artifactId,
  }));
  const existingSources = artifactKeys.length ? await prisma.legacyRefundFinanceReviewSource.findMany({
    where: { OR: artifactKeys },
    select: { artifactType: true, artifactId: true, reviewId: true, review: { select: { caseKey: true } } },
  }) : [];
  const existingByArtifact = new Map(existingSources.map((source) => [`${source.artifactType}:${source.artifactId}`, source.reviewId]));
  const existingByCaseKey = new Map(existingSources.map((source) => [source.review.caseKey, source.reviewId]));
  const observedArtifacts = new Set(existingByArtifact.keys());
  const groups = new Map<string, LegacyRefundFinanceCandidate[]>();
  for (const candidate of candidates) {
    const existingReviewId = existingByArtifact.get(`${artifactTypes[candidate.artifactType]}:${candidate.artifactId}`);
    const derivedCaseKey = buildLegacyReviewCaseKey(candidate);
    const reviewId = existingReviewId ?? existingByCaseKey.get(derivedCaseKey);
    const key = reviewId ? `existing:${reviewId}` : derivedCaseKey;
    groups.set(key, [...(groups.get(key) ?? []), candidate]);
  }

  const result = { candidates: candidates.length, createdReviews: 0, updatedReviews: 0, createdSources: 0, updatedSources: 0 };
  for (const [groupKey, group] of groups) {
    await prisma.$transaction(async (tx) => {
      const derivedCaseKey = buildLegacyReviewCaseKey(group[0]);
      const existingReviewId = groupKey.startsWith('existing:') ? groupKey.slice('existing:'.length) : null;
      const caseKey = existingReviewId
        ? (await tx.legacyRefundFinanceReview.findUnique({ where: { id: existingReviewId }, select: { caseKey: true } }))?.caseKey ?? derivedCaseKey
        : derivedCaseKey;
      const reviewId = existingReviewId ?? `legacy-review-${hash(caseKey)}`;
      const fingerprints = group.map(sourceFingerprint).sort();
      const fingerprint = hash(fingerprints);
      const exact = group[0].attribution === 'exact';
      const observedVendors = [...new Set(group.map((candidate) => candidate.observedVendorId))];
      const firstObservedAt = new Date(Math.min(...group.map((candidate) => candidate.observedAt.getTime())));
      const created = await tx.legacyRefundFinanceReview.createMany({
        data: [{
          id: reviewId, caseKey,
          attribution: exact ? LegacyRefundFinanceAttribution.EXACT : LegacyRefundFinanceAttribution.AMBIGUOUS,
          sourceShopifyRefundId: exact ? group[0].sourceShopifyRefundId : null,
          sourceShopifyOrderId: exact ? group.find((candidate) => candidate.sourceShopifyOrderId)?.sourceShopifyOrderId ?? null : group[0].sourceShopifyOrderId,
          vendorAllocationId: exact ? group[0].vendorAllocationId : null,
          observedVendorId: observedVendors.length === 1 ? observedVendors[0] : null,
          firstObservedAt, lastObservedAt: new Date(), occurrenceCount: 1, projectionFingerprint: fingerprint,
        }],
        skipDuplicates: true,
      });
      if (created.count === 1) {
        result.createdReviews += 1;
        await tx.legacyRefundFinanceReviewEvent.create({ data: { reviewId, eventType: LegacyRefundFinanceReviewEventType.DETECTED } });
      } else {
        result.updatedReviews += 1;
        await tx.legacyRefundFinanceReview.update({
          where: { id: reviewId },
          data: { lastObservedAt: new Date(), occurrenceCount: { increment: 1 }, projectionFingerprint: fingerprint },
        });
      }
      for (const candidate of group) {
        const type = artifactTypes[candidate.artifactType];
        const sourceId = `legacy-source-${hash({ type, artifactId: candidate.artifactId })}`;
        await tx.legacyRefundFinanceReviewSource.upsert({
          where: { artifactType_artifactId: { artifactType: type, artifactId: candidate.artifactId } },
          create: {
            id: sourceId, reviewId, artifactType: type, artifactId: candidate.artifactId,
            observedAt: candidate.observedAt, sourceState: candidate.state,
            recordedAmount: candidate.recordedAmount, recordedAmountMinor: candidate.recordedAmountMinor,
            currency: candidate.recordedCurrency, voidedAt: candidate.voidedAt,
            supersededByLedgerId: candidate.supersededByLedgerId, sourceFingerprint: sourceFingerprint(candidate),
          },
          update: {
            observedAt: candidate.observedAt, sourceState: candidate.state,
            recordedAmount: candidate.recordedAmount, recordedAmountMinor: candidate.recordedAmountMinor,
            currency: candidate.recordedCurrency, voidedAt: candidate.voidedAt,
            supersededByLedgerId: candidate.supersededByLedgerId, sourceFingerprint: sourceFingerprint(candidate),
          },
        });
        const artifactKey = `${type}:${candidate.artifactId}`;
        if (observedArtifacts.has(artifactKey)) result.updatedSources += 1;
        else {
          result.createdSources += 1;
          observedArtifacts.add(artifactKey);
        }
      }
    });
  }
  return { ok: true as const, ...result };
}

export type LegacyReviewFreshness = { expectedStatus: LegacyRefundFinanceReviewStatus; expectedUpdatedAt: string; expectedOccurrenceCount: number };

function normalizeNote(note: string | null | undefined) { return note?.trim() || null; }

async function transition(input: {
  reviewId: string; actorUserId: string; note?: string | null; freshness: LegacyReviewFreshness;
  sourceStatus: LegacyRefundFinanceReviewStatus; targetStatus: LegacyRefundFinanceReviewStatus;
  eventType: LegacyRefundFinanceReviewEventType; resolutionOutcome: LegacyRefundFinanceResolutionOutcome | null;
}, db: LifecycleDb = prisma) {
  if (!input.actorUserId.trim()) throw new AdminLegacyRefundReviewError('Authenticated Admin actor is required.', 403);
  if (input.freshness.expectedStatus !== input.sourceStatus) throw new AdminLegacyRefundReviewError(`Expected status must be ${input.sourceStatus}.`, 400);
  const expectedUpdatedAt = new Date(input.freshness.expectedUpdatedAt);
  if (Number.isNaN(expectedUpdatedAt.getTime()) || !Number.isInteger(input.freshness.expectedOccurrenceCount) || input.freshness.expectedOccurrenceCount < 1) {
    throw new AdminLegacyRefundReviewError('Valid freshness values are required.', 400);
  }
  return db.$transaction(async (tx) => {
    const current = await loadReview(tx, input.reviewId);
    const last = current.events.at(-1);
    if (current.status === input.targetStatus && current.resolutionOutcome === input.resolutionOutcome && last?.eventType === input.eventType && last.actorUserId === input.actorUserId) return serialize(current);
    if (current.status !== input.sourceStatus) throw new AdminLegacyRefundReviewError(`Legacy refund finance review cannot transition from ${current.status} to ${input.targetStatus}.`);
    if (current.updatedAt.getTime() !== expectedUpdatedAt.getTime() || current.occurrenceCount !== input.freshness.expectedOccurrenceCount) throw new AdminLegacyRefundReviewError('Legacy refund finance review changed after it was loaded. Reload and try again.');
    const updated = await tx.legacyRefundFinanceReview.updateMany({
      where: { id: input.reviewId, status: input.sourceStatus, updatedAt: expectedUpdatedAt, occurrenceCount: input.freshness.expectedOccurrenceCount },
      data: { status: input.targetStatus, resolutionOutcome: input.resolutionOutcome },
    });
    if (updated.count !== 1) throw new AdminLegacyRefundReviewError('Legacy refund finance review changed after it was loaded. Reload and try again.');
    await tx.legacyRefundFinanceReviewEvent.create({ data: {
      reviewId: input.reviewId, eventType: input.eventType, actorUserId: input.actorUserId,
      note: normalizeNote(input.note), resolutionOutcome: input.resolutionOutcome,
    } });
    return serialize(await loadReview(tx, input.reviewId));
  });
}

export function acknowledgeAdminLegacyRefundReview(input: { reviewId: string; actorUserId: string; note?: string | null; freshness: LegacyReviewFreshness }, db?: LifecycleDb) {
  return transition({ ...input, sourceStatus: LegacyRefundFinanceReviewStatus.ACTIVE, targetStatus: LegacyRefundFinanceReviewStatus.ACKNOWLEDGED, eventType: LegacyRefundFinanceReviewEventType.ACKNOWLEDGED, resolutionOutcome: null }, db);
}
export function resolveAdminLegacyRefundReview(input: { reviewId: string; actorUserId: string; note?: string | null; freshness: LegacyReviewFreshness; resolutionOutcome: LegacyRefundFinanceResolutionOutcome }, db?: LifecycleDb) {
  return transition({ ...input, sourceStatus: LegacyRefundFinanceReviewStatus.ACKNOWLEDGED, targetStatus: LegacyRefundFinanceReviewStatus.RESOLVED, eventType: LegacyRefundFinanceReviewEventType.RESOLVED }, db);
}
export function reopenAdminLegacyRefundReview(input: { reviewId: string; actorUserId: string; note?: string | null; freshness: LegacyReviewFreshness }, db?: LifecycleDb) {
  return transition({ ...input, sourceStatus: LegacyRefundFinanceReviewStatus.RESOLVED, targetStatus: LegacyRefundFinanceReviewStatus.ACTIVE, eventType: LegacyRefundFinanceReviewEventType.REOPENED, resolutionOutcome: null }, db);
}
