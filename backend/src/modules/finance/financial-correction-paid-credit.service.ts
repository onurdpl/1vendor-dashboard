import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { FinancialCorrectionPreviewError, previewTerminalFinancialCorrection } from './financial-correction-preview.service.js';
import { paidPayoutForSale, PaidFinancialCorrectionError } from './financial-correction-paid-debt.service.js';

const fail = (code: string, statusCode?: number): never => {
  throw new PaidFinancialCorrectionError(code, statusCode);
};

const appliedCreditInclude = {
  creditEffect: { include: { settlementLines: { include: { settlementApproval: true,
    payoutLines: { include: { payoutBatch: true } } } } } },
} as const;
type AppliedCredit = Prisma.FinancialCorrectionAuthorityGetPayload<{ include: typeof appliedCreditInclude }>;

function serialize(record: AppliedCredit) {
  const credit = record.creditEffect;
  if (record.economicDirection !== 'VENDOR_CREDIT' || record.applicationRoute !== 'PAID_VENDOR_CREDIT' ||
      record.currency !== 'TRY' || record.vendorPayableDifferenceMinor >= 0 ||
      !credit || credit.authorityId !== record.id || credit.vendorId !== record.vendorId ||
      credit.currency !== 'TRY' || credit.amountMinor !== -record.vendorPayableDifferenceMinor) {
    return fail('CREDIT_EFFECT_MISMATCH', 500);
  }
  const activeSettlementLine = credit.settlementLines.find((line) => line.status === 'ACTIVE' &&
    line.settlementApproval.status !== 'CANCELLED');
  const activePayoutLine = activeSettlementLine?.payoutLines.find((line) => line.status !== 'CANCELLED' &&
    line.payoutBatch.status !== 'CANCELLED');
  return {
    id: record.id,
    reviewId: record.reviewId,
    creditId: credit.id,
    grossCreditMinor: credit.amountMinor,
    currency: 'TRY' as const,
    status: 'APPLIED' as const,
    direction: 'VENDOR_CREDIT' as const,
    authorizedByUserId: record.authorizedByUserId,
    authorizedAt: record.authorizedAt.toISOString(),
    appliedAt: record.appliedAt.toISOString(),
    reason: record.reason,
    previewFingerprint: record.previewFingerprint,
    historicalPayoutBatchId: record.historicalPayoutBatchId,
    historicalPayoutPaidAt: record.historicalPayoutPaidAt.toISOString(),
    settlementApprovalId: activeSettlementLine?.settlementApprovalId ?? null,
    settlementStatus: activeSettlementLine?.settlementApproval.status ?? null,
    payoutBatchId: activePayoutLine?.payoutBatchId ?? null,
    payoutStatus: activePayoutLine?.payoutBatch.status ?? null,
  };
}

export async function getPaidFinancialCorrectionCreditState(reviewId: string, db: typeof prisma = prisma) {
  const existing = await db.financialCorrectionAuthority.findUnique({ where: { reviewId }, include: appliedCreditInclude });
  if (existing) return existing.economicDirection === 'VENDOR_CREDIT'
    ? { application: serialize(existing), eligible: false, reasonCode: 'CREDIT_EFFECT_ALREADY_EXISTS' }
    : { application: null, eligible: false, reasonCode: 'BASELINE_ALREADY_CLAIMED' };
  try {
    const preview = await previewTerminalFinancialCorrection(reviewId, db);
    if (preview.economicDirection !== 'VENDOR_CREDIT' ||
        !Number.isSafeInteger(preview.difference.vendorPayableReversalMinor) ||
        preview.difference.vendorPayableReversalMinor >= 0 || preview.currency !== 'TRY') {
      return { application: null, eligible: false, reasonCode: 'CREDIT_ROUTE_UNSUPPORTED' };
    }
    const [zeroNet, claim, resolvedEvent] = await Promise.all([
      db.financialCorrectionZeroNetAcknowledgement.findUnique({ where: { acceptedEvidenceSnapshotId: preview.acceptedEvidence.id } }),
      db.financialCorrectionBaselineClaim.findUnique({ where: { acceptedEvidenceSnapshotId: preview.acceptedEvidence.id } }),
      db.refundTerminalEvidenceReviewEvent.findFirst({ where: { reviewId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }),
    ]);
    if (zeroNet || claim) return { application: null, eligible: false, reasonCode: 'BASELINE_ALREADY_CLAIMED' };
    if (resolvedEvent?.eventType !== 'RESOLVED' || resolvedEvent.resolutionOutcome !== 'CORRECTION_REQUIRED') {
      return { application: null, eligible: false, reasonCode: 'REVIEW_NOT_ELIGIBLE' };
    }
    await paidPayoutForSale(db, { saleId: preview.historicalSaleFinanceLedgerEntryId, vendorId: preview.vendorId, currency: preview.currency });
    return { application: null, eligible: true, reasonCode: null };
  } catch (error) {
    if (error instanceof PaidFinancialCorrectionError) return { application: null, eligible: false, reasonCode: error.code };
    if (error instanceof FinancialCorrectionPreviewError) return { application: null, eligible: false, reasonCode: 'REVIEW_NOT_ELIGIBLE' };
    throw error;
  }
}

export async function applyPaidFinancialCorrectionCredit(input: {
  reviewId: string;
  previewFingerprint: string;
  actorUserId: string;
  reason: string;
}, db: typeof prisma = prisma) {
  if (!input.actorUserId?.trim()) return fail('ADMIN_ACTOR_REQUIRED', 403);
  if (!/^financial-correction-preview-v1:[a-f0-9]{64}$/.test(input.previewFingerprint)) return fail('PREVIEW_FINGERPRINT_REQUIRED', 400);
  const reason = input.reason?.trim();
  if (!reason || reason.length > 500) return fail('REASON_REQUIRED', 400);

  const matchingExisting = async () => {
    const existing = await db.financialCorrectionAuthority.findUnique({ where: { reviewId: input.reviewId }, include: appliedCreditInclude });
    if (!existing) return null;
    if (existing.economicDirection === 'VENDOR_CREDIT' && existing.previewFingerprint === input.previewFingerprint &&
        existing.authorizedByUserId === input.actorUserId && existing.reason === reason) return serialize(existing);
    return fail('CREDIT_EFFECT_ALREADY_EXISTS');
  };

  try {
    return await db.$transaction(async (tx) => {
      await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id" FROM "RefundTerminalEvidenceReview" WHERE "id" = ${input.reviewId} FOR UPDATE
      `);
      const existing = await tx.financialCorrectionAuthority.findUnique({ where: { reviewId: input.reviewId }, include: appliedCreditInclude });
      if (existing) {
        if (existing.economicDirection === 'VENDOR_CREDIT' && existing.previewFingerprint === input.previewFingerprint &&
            existing.authorizedByUserId === input.actorUserId && existing.reason === reason) return serialize(existing);
        return fail('CREDIT_EFFECT_ALREADY_EXISTS');
      }
      const review = await tx.refundTerminalEvidenceReview.findUnique({ where: { id: input.reviewId }, select: { storedEvidenceSnapshotId: true } });
      if (!review?.storedEvidenceSnapshotId) return fail('REVIEW_NOT_ELIGIBLE');
      await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id" FROM "RefundEvidenceSnapshot" WHERE "id" = ${review.storedEvidenceSnapshotId} FOR UPDATE
      `);
      let preview: Awaited<ReturnType<typeof previewTerminalFinancialCorrection>>;
      try {
        preview = await previewTerminalFinancialCorrection(input.reviewId, tx);
      } catch (error) {
        if (error instanceof FinancialCorrectionPreviewError) return fail(`EVIDENCE_CHANGED_${error.reasonCode.toUpperCase()}`);
        throw error;
      }
      if (preview.acceptedEvidence.id !== review.storedEvidenceSnapshotId) return fail('EVIDENCE_CHANGED');
      if (preview.previewFingerprint !== input.previewFingerprint) return fail('PREVIEW_STALE');
      if (preview.economicDirection !== 'VENDOR_CREDIT' ||
          !Number.isSafeInteger(preview.difference.vendorPayableReversalMinor) ||
          preview.difference.vendorPayableReversalMinor >= 0 || preview.currency !== 'TRY') return fail('CREDIT_ROUTE_UNSUPPORTED');
      const [zeroNet, claim] = await Promise.all([
        tx.financialCorrectionZeroNetAcknowledgement.findUnique({ where: { acceptedEvidenceSnapshotId: preview.acceptedEvidence.id } }),
        tx.financialCorrectionBaselineClaim.findUnique({ where: { acceptedEvidenceSnapshotId: preview.acceptedEvidence.id } }),
      ]);
      if (zeroNet || claim) return fail('BASELINE_ALREADY_CLAIMED');
      const resolvedEvent = await tx.refundTerminalEvidenceReviewEvent.findFirst({
        where: { reviewId: input.reviewId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      if (resolvedEvent?.eventType !== 'RESOLVED' || resolvedEvent.resolutionOutcome !== 'CORRECTION_REQUIRED') return fail('REVIEW_NOT_ELIGIBLE');
      const payout = await paidPayoutForSale(tx, {
        saleId: preview.historicalSaleFinanceLedgerEntryId, vendorId: preview.vendorId, currency: preview.currency,
      });
      await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id" FROM "PayoutBatch" WHERE "id" = ${payout.id} FOR UPDATE
      `);
      const confirmedPayout = await paidPayoutForSale(tx, {
        saleId: preview.historicalSaleFinanceLedgerEntryId, vendorId: preview.vendorId, currency: preview.currency,
      });
      if (confirmedPayout.id !== payout.id || confirmedPayout.paidAt.getTime() !== payout.paidAt.getTime()) return fail('PAYOUT_STATE_CHANGED');

      const authorityId = randomUUID();
      await tx.financialCorrectionBaselineClaim.create({
        data: { acceptedEvidenceSnapshotId: preview.acceptedEvidence.id, consumerType: 'paid_vendor_credit', consumerId: authorityId },
      });
      await tx.financialCorrectionAuthority.create({
        data: {
          id: authorityId, reviewId: input.reviewId, resolvedReviewEventId: resolvedEvent.id,
          acceptedEvidenceSnapshotId: preview.acceptedEvidence.id, incomingConflictEvidenceId: preview.incomingEvidence.id,
          sourceShopifyRefundId: preview.sourceShopifyRefundId, sourceShopifyOrderId: preview.sourceShopifyOrderId,
          vendorAllocationId: preview.vendorAllocationId, vendorId: preview.vendorId,
          historicalSaleFinanceLedgerEntryId: preview.historicalSaleFinanceLedgerEntryId,
          acceptedRefundFinanceLedgerEntryId: preview.acceptedRefundFinanceLedgerEntryId,
          acceptedEvidenceHash: preview.acceptedEvidence.hash, incomingEvidenceHash: preview.incomingEvidence.hash,
          acceptedEvidenceVersion: preview.acceptedEvidence.version,
          acceptedNormalizationVersion: preview.acceptedEvidence.normalizationVersion,
          incomingEvidenceVersion: preview.incomingEvidence.version,
          incomingNormalizationVersion: preview.incomingEvidence.normalizationVersion,
          commissionPercent: new Prisma.Decimal(preview.commissionPercent),
          commissionVatPercent: new Prisma.Decimal(preview.commissionVatPercent), currency: preview.currency,
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
          economicDirection: 'VENDOR_CREDIT', previewFingerprint: preview.previewFingerprint,
          historicalPayoutBatchId: confirmedPayout.id, historicalPayoutPaidAt: confirmedPayout.paidAt,
          applicationRoute: 'PAID_VENDOR_CREDIT', authorizedByUserId: input.actorUserId, reason,
        },
      });
      await tx.financialCorrectionCredit.create({
        data: { authorityId, vendorId: preview.vendorId,
          amountMinor: -preview.difference.vendorPayableReversalMinor, currency: 'TRY' },
      });
      const applied = await tx.financialCorrectionAuthority.findUnique({ where: { id: authorityId }, include: appliedCreditInclude });
      if (!applied) return fail('CREDIT_EFFECT_WRITE_FAILED', 500);
      return serialize(applied);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === 'P2002' || error.code === 'P2034')) {
      const existing = await matchingExisting();
      if (existing) return existing;
      return fail(error.code === 'P2002' ? 'BASELINE_ALREADY_CLAIMED' : 'CONCURRENT_APPLICATION');
    }
    throw error;
  }
}
