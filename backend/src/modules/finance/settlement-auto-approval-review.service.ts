import { Prisma, SettlementAutoApprovalAttemptOutcome } from '@prisma/client';
import { prisma } from '../../db/prisma.js';

const OUTCOMES = new Set<SettlementAutoApprovalAttemptOutcome>([
  'STARTED', 'APPROVED', 'BLOCKED', 'TECHNICAL_FAILURE', 'UNKNOWN',
]);

export class AutoApprovalReviewQueryError extends Error {}

export type AutoApprovalReviewFilters = {
  vendorId?: string;
  settlementApprovalId?: string;
  outcome?: string;
  reasonCode?: string;
  from?: string;
  to?: string;
  cursor?: string;
  limit?: number;
};

function bounded(value: string | undefined, name: string, max = 128) {
  if (value !== undefined && (!value.trim() || value.length > max)) {
    throw new AutoApprovalReviewQueryError(`${name} is invalid.`);
  }
  return value?.trim();
}

function date(value: string | undefined, name: string) {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new AutoApprovalReviewQueryError(`${name} must be an ISO UTC timestamp.`);
  }
  return parsed;
}

/** Read-only, keyset-paginated Admin evidence. Never calls reconciliation or approval. */
export async function listAutoApprovalAttemptsForAdmin(filters: AutoApprovalReviewFilters) {
  const vendorId = bounded(filters.vendorId, 'vendorId');
  const settlementApprovalId = bounded(filters.settlementApprovalId, 'settlementApprovalId');
  const reasonCode = bounded(filters.reasonCode, 'reasonCode', 128);
  const cursor = bounded(filters.cursor, 'cursor');
  if (filters.outcome && !OUTCOMES.has(filters.outcome as SettlementAutoApprovalAttemptOutcome)) {
    throw new AutoApprovalReviewQueryError('outcome is invalid.');
  }
  const from = date(filters.from, 'from');
  const to = date(filters.to, 'to');
  if (from && to && from > to) throw new AutoApprovalReviewQueryError('from must be before to.');
  const limit = filters.limit ?? 25;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new AutoApprovalReviewQueryError('limit must be between 1 and 50.');
  }
  const where: Prisma.SettlementAutoApprovalAttemptWhereInput = {
    ...(vendorId ? { vendorId, settlementApproval: { vendorId } } : {}),
    ...(settlementApprovalId ? { settlementApprovalId } : {}),
    ...(filters.outcome ? { outcome: filters.outcome as SettlementAutoApprovalAttemptOutcome } : {}),
    ...(reasonCode ? { reasonCode: { contains: reasonCode, mode: 'insensitive' } } : {}),
    ...(from || to ? { createdAt: { gte: from, lte: to } } : {}),
  };
  if (cursor && !await prisma.settlementAutoApprovalAttempt.findFirst({ where: { ...where, id: cursor }, select: { id: true } })) {
    throw new AutoApprovalReviewQueryError('cursor is invalid for these filters.');
  }
  const rows = await prisma.settlementAutoApprovalAttempt.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    take: limit + 1,
    select: {
      id: true, settlementApprovalId: true, vendorId: true, actorId: true,
      outcome: true, reasonCode: true, createdAt: true, completedAt: true,
      settlementApproval: { select: { vendorId: true, status: true, successfulAutoApprovalAttemptId: true,
        vendor: { select: { name: true } } } },
      events: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1,
        select: { id: true, outcome: true, reasonCode: true, createdAt: true } },
      _count: { select: { events: true } },
    },
  });
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  return {
    ok: true as const, writesPerformed: false as const,
    attempts: page.map((row) => ({
      id: row.id, settlementApprovalId: row.settlementApprovalId,
      vendorId: row.vendorId, vendorName: row.settlementApproval.vendor.name,
      actorId: row.actorId, outcome: row.outcome, reasonCode: row.reasonCode,
      createdAt: row.createdAt, completedAt: row.completedAt,
      currentSettlementStatus: row.settlementApproval.status,
      exactSuccessfulAttempt: row.settlementApproval.successfulAutoApprovalAttemptId === row.id,
      latestEvent: row.events[0] ?? null, eventCount: row._count.events,
    })),
    nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
  };
}

export async function listAutoApprovalAttemptEventsForAdmin(attemptId: string, cursor?: string, limit = 50) {
  bounded(attemptId, 'attemptId');
  bounded(cursor, 'cursor');
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new AutoApprovalReviewQueryError('limit must be between 1 and 100.');
  }
  const attempt = await prisma.settlementAutoApprovalAttempt.findUnique({
    where: { id: attemptId },
    select: { id: true, settlementApprovalId: true, vendorId: true, actorId: true,
      outcome: true, reasonCode: true, createdAt: true, completedAt: true,
      settlementApproval: { select: { status: true, successfulAutoApprovalAttemptId: true, vendorId: true } } },
  });
  if (!attempt || attempt.vendorId !== attempt.settlementApproval.vendorId) return null;
  if (cursor && !await prisma.settlementAutoApprovalAttemptEvent.findFirst({
    where: { id: cursor, attemptId }, select: { id: true },
  })) throw new AutoApprovalReviewQueryError('cursor is invalid for this attempt.');
  const rows = await prisma.settlementAutoApprovalAttemptEvent.findMany({
    where: { attemptId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    take: limit + 1,
    select: { id: true, outcome: true, reasonCode: true, createdAt: true },
  });
  const page = rows.slice(0, limit);
  return { ok: true as const, writesPerformed: false as const,
    attempt: { id: attempt.id, settlementApprovalId: attempt.settlementApprovalId,
      vendorId: attempt.vendorId, actorId: attempt.actorId, outcome: attempt.outcome,
      reasonCode: attempt.reasonCode, createdAt: attempt.createdAt, completedAt: attempt.completedAt,
      currentSettlementStatus: attempt.settlementApproval.status,
      exactSuccessfulAttempt: attempt.settlementApproval.successfulAutoApprovalAttemptId === attempt.id },
    events: page, nextCursor: rows.length > limit ? page[page.length - 1]?.id ?? null : null };
}
