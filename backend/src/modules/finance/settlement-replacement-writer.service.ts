import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { createReplacementDraftApprovalInTransaction } from './settlement-approval.service.js';
import {
  assessCancelledScheduledSettlementReplacement,
  type SettlementReplacementAssessment,
} from './settlement-replacement-assessment.service.js';

export class SettlementReplacementNotEligibleError extends Error {
  constructor(readonly assessment: SettlementReplacementAssessment) {
    super(`Settlement replacement is ${assessment.outcome.toLowerCase()}; no draft was created.`);
    this.name = 'SettlementReplacementNotEligibleError';
  }
}

type ReplacementRequest = {
  originalSettlementApprovalId: string;
  vendorId: string;
  requestId: string;
  adminUserId: string;
  reason: string;
};

type ReplacementResult = {
  outcome: 'CREATED' | 'REPLAYED';
  replacementSettlementApprovalId: string;
  originalSettlementApprovalId: string;
  vendorId: string;
  requestId: string;
  status: string;
  writesPerformed: boolean;
};

/** Internal only: no route, scheduler, or automatic approval calls this writer. */
export async function createControlledSettlementReplacementDraft(input: ReplacementRequest): Promise<ReplacementResult> {
  const originalId = input.originalSettlementApprovalId?.trim();
  const vendorId = input.vendorId?.trim();
  const requestId = input.requestId?.trim();
  const adminUserId = input.adminUserId?.trim();
  const reason = input.reason?.trim();
  if (!originalId || !vendorId || !requestId || !adminUserId || !reason) {
    throw new Error('Replacement requires original, vendor, request, Admin actor and reason.');
  }

  return prisma.$transaction(async (tx) => {
    // Match the existing draft writer: the vendor row is the first database operation.
    const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id" FROM "Vendor" WHERE "id" = ${vendorId} FOR UPDATE
    `);
    if (locked.length !== 1) throw new Error('Replacement vendor does not exist.');

    const actor = await tx.user.findUnique({ where: { id: adminUserId }, select: { role: true, status: true } });
    if (actor?.role !== 'ADMIN' || actor.status !== 'active') {
      throw new Error('Replacement requires an active Admin actor.');
    }

    const byRequest = await tx.settlementApproval.findUnique({ where: { replacementRequestId: requestId } });
    if (byRequest) {
      if (byRequest.replacesSettlementApprovalId !== originalId || byRequest.vendorId !== vendorId ||
          byRequest.replacementRequestedBy !== adminUserId || byRequest.replacementReason !== reason) {
        throw new Error('Replacement request ID is already bound to different authority or audit evidence.');
      }
      return { outcome: 'REPLAYED', replacementSettlementApprovalId: byRequest.id,
        originalSettlementApprovalId: originalId, vendorId, requestId,
        status: byRequest.status, writesPerformed: false };
    }
    const byOriginal = await tx.settlementApproval.findFirst({
      where: { replacesSettlementApprovalId: originalId, vendorId },
      select: { id: true },
    });
    if (byOriginal) throw new Error('Original settlement already has a replacement claim.');

    // This reads the same Serializable snapshot as the write. No cached 2A result is accepted.
    const assessment = await assessCancelledScheduledSettlementReplacement({
      originalSettlementApprovalId: originalId, vendorId,
    }, tx);
    if (assessment.outcome !== 'ELIGIBLE' || !assessment.originalCutoff) {
      throw new SettlementReplacementNotEligibleError(assessment);
    }
    const cutoff = new Date(assessment.originalCutoff);
    const created = await createReplacementDraftApprovalInTransaction({
      vendorId, periodStart: null, periodEnd: cutoff, asOfDate: cutoff,
      candidateScope: 'date_range',
      // The predecessor retains its unique normal scheduled key and run metadata.
      // B1's unique predecessor relation is this replacement's separate identity.
    }, {
      originalSettlementApprovalId: originalId, requestId,
      requestedBy: adminUserId, reason, requestedAt: new Date(),
    }, tx);
    return { outcome: 'CREATED', replacementSettlementApprovalId: created.id,
      originalSettlementApprovalId: originalId, vendorId, requestId,
      status: 'DRAFT', writesPerformed: true };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15_000 });
}
