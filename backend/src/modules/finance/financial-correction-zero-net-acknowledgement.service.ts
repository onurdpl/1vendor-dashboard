import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { prisma } from '../../db/prisma.js';
import {
  FinancialCorrectionPreviewError,
  previewTerminalFinancialCorrection,
} from './financial-correction-preview.service.js';

export class ZeroNetAcknowledgementError extends Error {
  constructor(readonly code: string, readonly statusCode = 409) {
    super(`Zero-net reconciliation acknowledgement unavailable: ${code}.`);
    this.name = 'ZeroNetAcknowledgementError';
  }
}

const fail = (code: string, statusCode?: number): never => {
  throw new ZeroNetAcknowledgementError(code, statusCode);
};

type AcknowledgementDb = Pick<typeof prisma, 'financialCorrectionZeroNetAcknowledgement'>;

function serialize(record: Awaited<ReturnType<AcknowledgementDb['financialCorrectionZeroNetAcknowledgement']['findUnique']>>) {
  if (!record) return null;
  return {
    id: record.id,
    reviewId: record.reviewId,
    resolvedReviewEventId: record.resolvedReviewEventId,
    acceptedEvidenceSnapshotId: record.acceptedEvidenceSnapshotId,
    incomingConflictEvidenceId: record.incomingConflictEvidenceId,
    previewFingerprint: record.previewFingerprint,
    economicDirection: record.economicDirection,
    vendorPayableDifferenceMinor: record.vendorPayableDifferenceMinor,
    acknowledgedByUserId: record.acknowledgedByUserId,
    acknowledgedAt: record.acknowledgedAt.toISOString(),
    note: record.note,
  };
}

export async function getZeroNetAcknowledgement(reviewId: string, db: AcknowledgementDb = prisma) {
  return serialize(await db.financialCorrectionZeroNetAcknowledgement.findUnique({ where: { reviewId } }));
}

export async function acknowledgeZeroNetReconciliation(input: {
  reviewId: string;
  previewFingerprint: string;
  actorUserId: string;
  note?: string | null;
}, db: typeof prisma = prisma) {
  if (!input.actorUserId.trim()) fail('ADMIN_ACTOR_REQUIRED', 403);
  if (!/^financial-correction-preview-v1:[a-f0-9]{64}$/.test(input.previewFingerprint)) {
    fail('PREVIEW_FINGERPRINT_REQUIRED', 400);
  }
  const note = input.note?.trim() || null;
  if (note && note.length > 500) fail('NOTE_TOO_LONG', 400);

  try {
    return await db.$transaction(async (tx) => {
      // Serialize against review lifecycle and repeated-conflict observation updates.
      await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id" FROM "RefundTerminalEvidenceReview"
        WHERE "id" = ${input.reviewId} FOR UPDATE
      `);

      const existing = await tx.financialCorrectionZeroNetAcknowledgement.findUnique({
        where: { reviewId: input.reviewId },
      });
      if (existing) {
        if (existing.previewFingerprint === input.previewFingerprint &&
            existing.acknowledgedByUserId === input.actorUserId) return serialize(existing)!;
        return fail('ALREADY_ACKNOWLEDGED');
      }

      let preview: Awaited<ReturnType<typeof previewTerminalFinancialCorrection>>;
      try {
        preview = await previewTerminalFinancialCorrection(input.reviewId, tx);
      } catch (error) {
        if (error instanceof FinancialCorrectionPreviewError) {
          return fail(error.reasonCode === 'correction_required_outcome_missing'
            ? 'REVIEW_NOT_ELIGIBLE' : `AUTHORITY_INVALID_${error.reasonCode.toUpperCase()}`);
        }
        throw error;
      }
      if (preview.previewFingerprint !== input.previewFingerprint) return fail('PREVIEW_STALE');
      if (preview.currency !== 'TRY' || preview.difference.vendorPayableReversalMinor !== 0 ||
          preview.economicDirection !== 'NONE') return fail('NONZERO_CORRECTION_NOT_SUPPORTED');

      // One accepted baseline may not be acknowledged against two different incoming states.
      const otherBaseline = await tx.financialCorrectionZeroNetAcknowledgement.findUnique({
        where: { acceptedEvidenceSnapshotId: preview.acceptedEvidence.id },
      });
      if (otherBaseline) return fail('ACCEPTED_BASELINE_ALREADY_ACKNOWLEDGED');
      const paidCorrection = await tx.financialCorrectionAuthority.findUnique({
        where: { acceptedEvidenceSnapshotId: preview.acceptedEvidence.id },
      });
      if (paidCorrection) return fail('ACCEPTED_BASELINE_ALREADY_CONSUMED');

      const resolvedEvent = await tx.refundTerminalEvidenceReviewEvent.findFirst({
        where: { reviewId: input.reviewId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      if (resolvedEvent?.eventType !== 'RESOLVED' ||
          resolvedEvent.resolutionOutcome !== 'CORRECTION_REQUIRED') return fail('REVIEW_NOT_ELIGIBLE');

      const acknowledgementId = randomUUID();
      await tx.financialCorrectionBaselineClaim.create({
        data: {
          acceptedEvidenceSnapshotId: preview.acceptedEvidence.id,
          consumerType: 'zero_net_acknowledgement',
          consumerId: acknowledgementId,
        },
      });
      const record = await tx.financialCorrectionZeroNetAcknowledgement.create({
        data: {
          id: acknowledgementId,
          reviewId: input.reviewId,
          resolvedReviewEventId: resolvedEvent.id,
          sourceShopifyRefundId: preview.sourceShopifyRefundId,
          sourceShopifyOrderId: preview.sourceShopifyOrderId,
          vendorAllocationId: preview.vendorAllocationId,
          vendorId: preview.vendorId,
          acceptedEvidenceSnapshotId: preview.acceptedEvidence.id,
          incomingConflictEvidenceId: preview.incomingEvidence.id,
          acceptedEvidenceHash: preview.acceptedEvidence.hash,
          incomingEvidenceHash: preview.incomingEvidence.hash,
          acceptedEvidenceVersion: preview.acceptedEvidence.version,
          acceptedNormalizationVersion: preview.acceptedEvidence.normalizationVersion,
          incomingEvidenceVersion: preview.incomingEvidence.version,
          incomingNormalizationVersion: preview.incomingEvidence.normalizationVersion,
          historicalSaleFinanceLedgerEntryId: preview.historicalSaleFinanceLedgerEntryId,
          acceptedRefundFinanceLedgerEntryId: preview.acceptedRefundFinanceLedgerEntryId,
          commissionPercent: new Prisma.Decimal(preview.commissionPercent),
          commissionVatPercent: new Prisma.Decimal(preview.commissionVatPercent),
          currency: preview.currency,
          acceptedRefundAmountMinor: preview.accepted.refundAmountMinor,
          acceptedCommissionReversalMinor: preview.accepted.commissionReversalMinor,
          acceptedCommissionVatReversalMinor: preview.accepted.commissionVatReversalMinor,
          acceptedVendorPayableReversalMinor: preview.accepted.vendorPayableReversalMinor,
          correctedRefundAmountMinor: preview.corrected.refundAmountMinor,
          correctedCommissionReversalMinor: preview.corrected.commissionReversalMinor,
          correctedCommissionVatReversalMinor: preview.corrected.commissionVatReversalMinor,
          correctedVendorPayableReversalMinor: preview.corrected.vendorPayableReversalMinor,
          refundDifferenceMinor: preview.difference.refundAmountMinor,
          commissionDifferenceMinor: preview.difference.commissionReversalMinor,
          commissionVatDifferenceMinor: preview.difference.commissionVatReversalMinor,
          vendorPayableDifferenceMinor: preview.difference.vendorPayableReversalMinor,
          economicDirection: preview.economicDirection,
          previewFingerprint: preview.previewFingerprint,
          acknowledgedByUserId: input.actorUserId,
          note,
        },
      });
      return serialize(record)!;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002' || error.code === 'P2034') {
        const existing = await db.financialCorrectionZeroNetAcknowledgement.findUnique({
          where: { reviewId: input.reviewId },
        });
        if (existing?.previewFingerprint === input.previewFingerprint &&
            existing.acknowledgedByUserId === input.actorUserId) return serialize(existing)!;
        throw new ZeroNetAcknowledgementError('CONCURRENT_ACKNOWLEDGEMENT');
      }
    }
    throw error;
  }
}
