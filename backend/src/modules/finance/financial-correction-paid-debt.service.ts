import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { FinancialCorrectionPreviewError, previewTerminalFinancialCorrection } from './financial-correction-preview.service.js';
import { createVendorDebtForPaidFinancialCorrection } from './vendor-balance.service.js';

export class PaidFinancialCorrectionError extends Error {
  constructor(readonly code: string, readonly statusCode = 409) {
    super(`Paid financial correction unavailable: ${code}.`);
    this.name = 'PaidFinancialCorrectionError';
  }
}

const fail = (code: string, statusCode?: number): never => {
  throw new PaidFinancialCorrectionError(code, statusCode);
};

type CorrectionDb = Pick<typeof prisma, 'financialCorrectionAuthority' | 'payoutBatchLine' | 'financeLedgerEntry'>;

export async function paidPayoutForSale(db: CorrectionDb, input: {
  saleId: string;
  vendorId: string;
  currency: 'TRY';
}) {
  const sale = await db.financeLedgerEntry.findUnique({
    where: { id: input.saleId },
    select: { id: true, entryType: true, vendorId: true, payoutStatus: true, settlementStatus: true, voidedAt: true },
  });
  if (!sale || sale.entryType !== 'sale' || sale.vendorId !== input.vendorId || sale.voidedAt ||
      sale.payoutStatus !== 'PAID' || sale.settlementStatus !== 'SETTLED') return fail('HISTORICAL_FINANCE_MISMATCH');

  const lines = await db.payoutBatchLine.findMany({
    where: { financeLedgerEntryId: input.saleId },
    include: {
      payoutBatch: true,
      settlementApprovalLine: { include: { settlementApproval: true } },
    },
  });
  const active = lines.filter((line) => line.payoutBatch.status !== 'CANCELLED');
  if (active.length === 0) return fail('PAID_PAYOUT_NOT_FOUND');
  if (active.length !== 1) return fail('PAID_PAYOUT_MISMATCH');
  const line = active[0];
  const batch = line.payoutBatch;
  if (batch.status !== 'PAID') return fail('PAYOUT_NOT_PAID');
  if (!batch.paidAt) return fail('PAYOUT_PAID_AT_MISSING');
  const settlementLine = line.settlementApprovalLine;
  if (!line.settlementApprovalLineId || !settlementLine ||
      settlementLine.id !== line.settlementApprovalLineId ||
      settlementLine.financeLedgerEntryId !== input.saleId || settlementLine.lineType !== 'SALE' ||
      settlementLine.settlementApproval.status !== 'APPROVED' ||
      settlementLine.settlementApproval.vendorId !== input.vendorId ||
      settlementLine.settlementApproval.currency !== input.currency ||
      batch.vendorId !== input.vendorId || batch.currency !== input.currency) return fail('PAID_PAYOUT_MISMATCH');
  return { id: batch.id, paidAt: batch.paidAt };
}

type AppliedRecord = Prisma.FinancialCorrectionAuthorityGetPayload<{ include: { debtEvent: true } }>;

function serialize(record: AppliedRecord) {
  if (record.economicDirection !== 'VENDOR_DEDUCTION' || record.currency !== 'TRY' ||
      record.applicationRoute !== 'PAID_VENDOR_DEBT' || record.vendorPayableDifferenceMinor <= 0 ||
      !record.historicalPayoutBatchId || !record.historicalPayoutPaidAt ||
      !record.debtEvent || record.debtEvent.financialCorrectionAuthorityId !== record.id ||
      record.debtEvent.sourceType !== 'financial_correction' || record.debtEvent.sourceId !== record.id ||
      record.debtEvent.type !== 'VENDOR_DEBT_CREATED' || record.debtEvent.vendorId !== record.vendorId ||
      record.debtEvent.currency !== 'TRY' ||
      record.debtEvent.amountMinor !== -record.vendorPayableDifferenceMinor) return fail('EFFECT_WRITE_FAILED', 500);
  return {
    id: record.id,
    reviewId: record.reviewId,
    status: 'APPLIED' as const,
    economicDirection: 'VENDOR_DEDUCTION' as const,
    authorizedDebtMinor: record.vendorPayableDifferenceMinor,
    currency: 'TRY' as const,
    authorizedByUserId: record.authorizedByUserId,
    reason: record.reason,
    authorizedAt: record.authorizedAt.toISOString(),
    appliedAt: record.appliedAt.toISOString(),
    previewFingerprint: record.previewFingerprint,
    historicalPayoutBatchId: record.historicalPayoutBatchId,
    historicalPayoutPaidAt: record.historicalPayoutPaidAt.toISOString(),
    vendorBalanceEventId: record.debtEvent.id,
  };
}

export async function getPaidFinancialCorrectionState(reviewId: string, db: typeof prisma = prisma) {
  const existing = await db.financialCorrectionAuthority.findUnique({ where: { reviewId }, include: { debtEvent: true } });
  if (existing) return existing.economicDirection === 'VENDOR_DEDUCTION'
    ? { application: serialize(existing), eligible: false, reasonCode: 'ALREADY_APPLIED' }
    : { application: null, eligible: false, reasonCode: 'BASELINE_ALREADY_CONSUMED' };
  try {
    const preview = await previewTerminalFinancialCorrection(reviewId, db);
    if (preview.economicDirection === 'VENDOR_CREDIT') return { application: null, eligible: false, reasonCode: 'VENDOR_CREDIT_NOT_SUPPORTED' };
    if (preview.economicDirection !== 'VENDOR_DEDUCTION' || preview.difference.vendorPayableReversalMinor <= 0) {
      return { application: null, eligible: false, reasonCode: 'NONZERO_ROUTE_UNSUPPORTED' };
    }
    const priorZero = await db.financialCorrectionZeroNetAcknowledgement.findUnique({
      where: { acceptedEvidenceSnapshotId: preview.acceptedEvidence.id },
    });
    const claim = await db.financialCorrectionBaselineClaim.findUnique({
      where: { acceptedEvidenceSnapshotId: preview.acceptedEvidence.id },
    });
    if (priorZero || claim) return { application: null, eligible: false, reasonCode: 'BASELINE_ALREADY_CONSUMED' };
    const resolvedEvent = await db.refundTerminalEvidenceReviewEvent.findFirst({
      where: { reviewId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
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

export async function applyPaidFinancialCorrectionDebt(input: {
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
    const existing = await db.financialCorrectionAuthority.findUnique({ where: { reviewId: input.reviewId }, include: { debtEvent: true } });
    if (!existing) return null;
    if (existing.economicDirection === 'VENDOR_DEDUCTION' && existing.previewFingerprint === input.previewFingerprint &&
        existing.authorizedByUserId === input.actorUserId && existing.reason === reason) return serialize(existing);
    return fail('ALREADY_APPLIED');
  };

  try {
    return await db.$transaction(async (tx) => {
      await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id" FROM "RefundTerminalEvidenceReview" WHERE "id" = ${input.reviewId} FOR UPDATE
      `);
      const existing = await tx.financialCorrectionAuthority.findUnique({ where: { reviewId: input.reviewId }, include: { debtEvent: true } });
      if (existing) {
        if (existing.economicDirection === 'VENDOR_DEDUCTION' && existing.previewFingerprint === input.previewFingerprint &&
            existing.authorizedByUserId === input.actorUserId && existing.reason === reason) return serialize(existing);
        return fail('ALREADY_APPLIED');
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
      if (preview.economicDirection === 'VENDOR_CREDIT') return fail('VENDOR_CREDIT_NOT_SUPPORTED');
      if (preview.economicDirection !== 'VENDOR_DEDUCTION' ||
          !Number.isSafeInteger(preview.difference.vendorPayableReversalMinor) ||
          preview.difference.vendorPayableReversalMinor <= 0 || preview.currency !== 'TRY') return fail('NONZERO_ROUTE_UNSUPPORTED');

      const [zeroNet, claim] = await Promise.all([
        tx.financialCorrectionZeroNetAcknowledgement.findUnique({ where: { acceptedEvidenceSnapshotId: preview.acceptedEvidence.id } }),
        tx.financialCorrectionBaselineClaim.findUnique({ where: { acceptedEvidenceSnapshotId: preview.acceptedEvidence.id } }),
      ]);
      if (zeroNet || claim) return fail('BASELINE_ALREADY_CONSUMED');
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
      // Re-read after locking the actual payout, not a denormalized SALE status.
      const confirmedPayout = await paidPayoutForSale(tx, {
        saleId: preview.historicalSaleFinanceLedgerEntryId, vendorId: preview.vendorId, currency: preview.currency,
      });
      if (confirmedPayout.id !== payout.id || confirmedPayout.paidAt.getTime() !== payout.paidAt.getTime()) return fail('PAID_PAYOUT_MISMATCH');

      const authorityId = randomUUID();
      await tx.financialCorrectionBaselineClaim.create({
        data: { acceptedEvidenceSnapshotId: preview.acceptedEvidence.id, consumerType: 'paid_vendor_debt', consumerId: authorityId },
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
          economicDirection: 'VENDOR_DEDUCTION', previewFingerprint: preview.previewFingerprint,
          historicalPayoutBatchId: confirmedPayout.id, historicalPayoutPaidAt: confirmedPayout.paidAt,
          applicationRoute: 'PAID_VENDOR_DEBT', authorizedByUserId: input.actorUserId, reason,
        },
      });
      try {
        await createVendorDebtForPaidFinancialCorrection(tx, {
          authorityId, vendorId: preview.vendorId, authorizedDebtMinor: preview.difference.vendorPayableReversalMinor,
          currency: preview.currency, sourceShopifyRefundId: preview.sourceShopifyRefundId,
          sourceShopifyOrderId: preview.sourceShopifyOrderId, vendorAllocationId: preview.vendorAllocationId,
        });
      } catch {
        return fail('EFFECT_WRITE_FAILED', 500);
      }
      const applied = await tx.financialCorrectionAuthority.findUnique({ where: { id: authorityId }, include: { debtEvent: true } });
      if (!applied) return fail('EFFECT_WRITE_FAILED', 500);
      return serialize(applied);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === 'P2002' || error.code === 'P2034')) {
      const existing = await matchingExisting();
      if (existing) return existing;
      return fail(error.code === 'P2002' ? 'BASELINE_ALREADY_CONSUMED' : 'CONCURRENT_APPLICATION');
    }
    throw error;
  }
}
