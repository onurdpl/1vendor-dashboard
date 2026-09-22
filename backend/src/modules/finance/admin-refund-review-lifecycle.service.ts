import {
  Prisma,
  RefundTerminalEvidenceResolutionOutcome,
  RefundTerminalEvidenceReviewEventType,
  RefundTerminalEvidenceReviewStatus,
} from '@prisma/client';
import { prisma } from '../../db/prisma.js';

const detailSelect = {
  id: true,
  status: true,
  resolutionOutcome: true,
  sourceShopifyRefundId: true,
  sourceShopifyOrderId: true,
  vendorAllocationId: true,
  economicVendorId: true,
  economicVendor: { select: { name: true } },
  terminalRefundFinanceLedgerEntryId: true,
  terminalRefundFinanceLedgerEntry: { select: { amount: true } },
  storedEvidenceSnapshotId: true,
  storedEvidenceSnapshot: {
    select: {
      currency: true,
      evidenceVersion: true,
      normalizationVersion: true,
    },
  },
  conflictCategory: true,
  storedEvidenceHash: true,
  incomingEvidenceHash: true,
  conflictSummaryJson: true,
  firstObservedAt: true,
  lastObservedAt: true,
  occurrenceCount: true,
  createdAt: true,
  updatedAt: true,
  events: {
    orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
    select: {
      id: true,
      eventType: true,
      actorUserId: true,
      actorUser: { select: { name: true } },
      note: true,
      resolutionOutcome: true,
      createdAt: true,
    },
  },
} satisfies Prisma.RefundTerminalEvidenceReviewSelect;

type ReviewDetailRecord = Prisma.RefundTerminalEvidenceReviewGetPayload<{ select: typeof detailSelect }>;
type TransactionDb = Pick<Prisma.TransactionClient, 'refundTerminalEvidenceReview' | 'refundTerminalEvidenceReviewEvent'>;
type LifecycleDb = TransactionDb & Pick<typeof prisma, '$transaction'>;

export class AdminRefundReviewLifecycleError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 409) {
    super(message);
    this.name = 'AdminRefundReviewLifecycleError';
    this.statusCode = statusCode;
  }
}

export type RefundReviewFreshness = {
  expectedStatus: RefundTerminalEvidenceReviewStatus;
  expectedUpdatedAt: string;
  expectedOccurrenceCount: number;
};

export type RefundReviewResolutionOutcome = RefundTerminalEvidenceResolutionOutcome;

function serializeReview(review: ReviewDetailRecord) {
  return {
    id: review.id,
    status: review.status,
    resolutionOutcome: review.resolutionOutcome,
    sourceShopifyRefundId: review.sourceShopifyRefundId,
    sourceShopifyOrderId: review.sourceShopifyOrderId,
    vendorAllocationId: review.vendorAllocationId,
    economicVendorId: review.economicVendorId,
    vendorName: review.economicVendor.name,
    terminalRefundFinanceLedgerEntryId: review.terminalRefundFinanceLedgerEntryId,
    acceptedRecordedAmount: review.terminalRefundFinanceLedgerEntry.amount.toString(),
    acceptedRecordedCurrency: review.storedEvidenceSnapshot?.currency ?? null,
    storedEvidenceSnapshotId: review.storedEvidenceSnapshotId,
    evidenceVersion: review.storedEvidenceSnapshot?.evidenceVersion ?? null,
    normalizationVersion: review.storedEvidenceSnapshot?.normalizationVersion ?? null,
    storedEvidenceHash: review.storedEvidenceHash,
    incomingEvidenceHash: review.incomingEvidenceHash,
    conflictCategory: review.conflictCategory,
    conflictSummary: review.conflictSummaryJson,
    firstObservedAt: review.firstObservedAt.toISOString(),
    lastObservedAt: review.lastObservedAt.toISOString(),
    occurrenceCount: review.occurrenceCount,
    createdAt: review.createdAt.toISOString(),
    updatedAt: review.updatedAt.toISOString(),
    events: review.events.map((event) => ({
      id: event.id,
      eventType: event.eventType,
      actorUserId: event.actorUserId,
      actorName: event.actorUser?.name ?? null,
      note: event.note,
      resolutionOutcome: event.resolutionOutcome,
      createdAt: event.createdAt.toISOString(),
    })),
  };
}

async function loadReview(db: TransactionDb, reviewId: string) {
  const review = await db.refundTerminalEvidenceReview.findUnique({
    where: { id: reviewId },
    select: detailSelect,
  });
  if (!review) {
    throw new AdminRefundReviewLifecycleError('Refund evidence review not found.', 404);
  }
  return review;
}

export async function getAdminRefundReviewDetail(reviewId: string, db: TransactionDb = prisma) {
  return serializeReview(await loadReview(db, reviewId));
}

function normalizeNote(note: string | null | undefined) {
  const normalized = note?.trim();
  return normalized ? normalized : null;
}

function validateFreshness(input: RefundReviewFreshness) {
  const expectedUpdatedAt = new Date(input.expectedUpdatedAt);
  if (Number.isNaN(expectedUpdatedAt.getTime())) {
    throw new AdminRefundReviewLifecycleError('A valid expectedUpdatedAt value is required.', 400);
  }
  if (!Number.isInteger(input.expectedOccurrenceCount) || input.expectedOccurrenceCount < 1) {
    throw new AdminRefundReviewLifecycleError('A valid expectedOccurrenceCount value is required.', 400);
  }
  return expectedUpdatedAt;
}

function isSafeDuplicate(
  review: ReviewDetailRecord,
  targetStatus: RefundTerminalEvidenceReviewStatus,
  eventType: RefundTerminalEvidenceReviewEventType,
  actorUserId: string,
  outcome: RefundTerminalEvidenceResolutionOutcome | null,
) {
  const lastEvent = review.events.at(-1);
  return review.status === targetStatus
    && review.resolutionOutcome === outcome
    && lastEvent?.eventType === eventType
    && lastEvent.actorUserId === actorUserId
    && lastEvent.resolutionOutcome === outcome;
}

async function transitionReview(input: {
  reviewId: string;
  actorUserId: string;
  note?: string | null;
  freshness: RefundReviewFreshness;
  sourceStatus: RefundTerminalEvidenceReviewStatus;
  targetStatus: RefundTerminalEvidenceReviewStatus;
  eventType: RefundTerminalEvidenceReviewEventType;
  resolutionOutcome: RefundTerminalEvidenceResolutionOutcome | null;
}, db: LifecycleDb = prisma) {
  if (!input.actorUserId.trim()) {
    throw new AdminRefundReviewLifecycleError('Authenticated Admin actor is required.', 403);
  }
  if (input.freshness.expectedStatus !== input.sourceStatus) {
    throw new AdminRefundReviewLifecycleError(`Expected status must be ${input.sourceStatus}.`, 400);
  }
  const expectedUpdatedAt = validateFreshness(input.freshness);

  return db.$transaction(async (tx) => {
    const current = await loadReview(tx, input.reviewId);
    if (isSafeDuplicate(current, input.targetStatus, input.eventType, input.actorUserId, input.resolutionOutcome)) {
      return serializeReview(current);
    }
    if (current.status !== input.sourceStatus) {
      throw new AdminRefundReviewLifecycleError(
        `Refund evidence review cannot transition from ${current.status} to ${input.targetStatus}.`,
      );
    }
    if (current.updatedAt.getTime() !== expectedUpdatedAt.getTime()
      || current.occurrenceCount !== input.freshness.expectedOccurrenceCount) {
      throw new AdminRefundReviewLifecycleError('Refund evidence review changed after it was loaded. Reload and try again.');
    }

    const updated = await tx.refundTerminalEvidenceReview.updateMany({
      where: {
        id: input.reviewId,
        status: input.sourceStatus,
        updatedAt: expectedUpdatedAt,
        occurrenceCount: input.freshness.expectedOccurrenceCount,
      },
      data: {
        status: input.targetStatus,
        resolutionOutcome: input.resolutionOutcome,
      },
    });
    if (updated.count !== 1) {
      throw new AdminRefundReviewLifecycleError('Refund evidence review changed after it was loaded. Reload and try again.');
    }

    await tx.refundTerminalEvidenceReviewEvent.create({
      data: {
        reviewId: input.reviewId,
        eventType: input.eventType,
        actorUserId: input.actorUserId,
        note: normalizeNote(input.note),
        resolutionOutcome: input.resolutionOutcome,
      },
    });
    return serializeReview(await loadReview(tx, input.reviewId));
  });
}

export function acknowledgeAdminRefundReview(input: {
  reviewId: string;
  actorUserId: string;
  note?: string | null;
  freshness: RefundReviewFreshness;
}, db: LifecycleDb = prisma) {
  return transitionReview({
    ...input,
    sourceStatus: RefundTerminalEvidenceReviewStatus.ACTIVE,
    targetStatus: RefundTerminalEvidenceReviewStatus.ACKNOWLEDGED,
    eventType: RefundTerminalEvidenceReviewEventType.ACKNOWLEDGED,
    resolutionOutcome: null,
  }, db);
}

export function resolveAdminRefundReview(input: {
  reviewId: string;
  actorUserId: string;
  note?: string | null;
  resolutionOutcome: RefundTerminalEvidenceResolutionOutcome;
  freshness: RefundReviewFreshness;
}, db: LifecycleDb = prisma) {
  return transitionReview({
    ...input,
    sourceStatus: RefundTerminalEvidenceReviewStatus.ACKNOWLEDGED,
    targetStatus: RefundTerminalEvidenceReviewStatus.RESOLVED,
    eventType: RefundTerminalEvidenceReviewEventType.RESOLVED,
  }, db);
}

export function reopenAdminRefundReview(input: {
  reviewId: string;
  actorUserId: string;
  note?: string | null;
  freshness: RefundReviewFreshness;
}, db: LifecycleDb = prisma) {
  return transitionReview({
    ...input,
    sourceStatus: RefundTerminalEvidenceReviewStatus.RESOLVED,
    targetStatus: RefundTerminalEvidenceReviewStatus.ACTIVE,
    eventType: RefundTerminalEvidenceReviewEventType.REOPENED,
    resolutionOutcome: null,
  }, db);
}
