import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { cancelReviewPayoutBatchWithClient } from './finance.service.js';
import { FinancialCorrectionPreviewError, previewTerminalFinancialCorrection } from './financial-correction-preview.service.js';

export const REVIEW_EFT_NOT_SENT_CONFIRMATION_V1 = {
  version: 'review-eft-not-sent-v1',
  text: 'I confirm that no external bank/EFT instruction for this payout has been sent.',
} as const;

export class ReviewPayoutFinancialCorrectionError extends Error {
  constructor(readonly code: string, readonly statusCode = 409) {
    super(`Review payout financial correction unavailable: ${code}.`);
    this.name = 'ReviewPayoutFinancialCorrectionError';
  }
}

const fail = (code: string, statusCode?: number): never => {
  throw new ReviewPayoutFinancialCorrectionError(code, statusCode);
};
type Preview = Awaited<ReturnType<typeof previewTerminalFinancialCorrection>>;
type Db = typeof prisma | Prisma.TransactionClient;

const appliedInclude = {
  historicalPayoutBatch: true,
  creditEffect: true,
  deductionEffect: { include: { approvedCoverage: true } },
} as const;
type Applied = Prisma.FinancialCorrectionAuthorityGetPayload<{ include: typeof appliedInclude }>;

function minor(value: Prisma.Decimal | number) {
  const result = new Prisma.Decimal(value).mul(100).toNumber();
  if (!Number.isSafeInteger(result)) return fail('HISTORICAL_FINANCE_MISMATCH');
  return result;
}

function serialize(record: Applied) {
  const credit = record.economicDirection === 'VENDOR_CREDIT';
  const route = credit ? 'REVIEW_PAYOUT_VENDOR_CREDIT' : 'REVIEW_PAYOUT_VENDOR_DEDUCTION';
  const amount = Math.abs(record.vendorPayableDifferenceMinor);
  if (record.applicationRoute !== route || record.currency !== 'TRY' ||
      !record.historicalPayoutBatchId || !record.historicalPayoutBatch ||
      record.historicalPayoutBatch.status !== 'CANCELLED' || record.historicalPayoutPaidAt ||
      record.historicalReviewPayoutGrossMinor === null || record.historicalReviewPayoutNetMinor === null ||
      record.historicalReviewPayoutDebtOffsetMinor === null || !record.historicalReviewPayoutSourceFingerprint ||
      !record.historicalReviewPayoutCancelledAt || !record.reviewEftNotSentConfirmedAt ||
      record.reviewEftNotSentConfirmationVersion !== REVIEW_EFT_NOT_SENT_CONFIRMATION_V1.version ||
      record.reviewPayoutObservedStatus !== 'REVIEW' || !record.historicalApprovedSettlementId ||
      !record.historicalApprovedSettlementAt || record.historicalApprovedSettlementNetMinor === null ||
      amount <= 0 || (credit && record.vendorPayableDifferenceMinor >= 0) ||
      (!credit && record.vendorPayableDifferenceMinor <= 0) ||
      (credit && (!record.creditEffect || record.deductionEffect || record.creditEffect.amountMinor !== amount)) ||
      (!credit && (!record.deductionEffect || record.creditEffect || record.deductionEffect.amountMinor !== amount ||
        !record.deductionEffect.approvedCoverage ||
        record.deductionEffect.approvedCoverage.settlementApprovalId !== record.historicalApprovedSettlementId ||
        record.deductionEffect.approvedCoverage.amountMinor !== amount))) {
    return fail('CORRECTION_EFFECT_MISMATCH', 500);
  }
  return {
    id: record.id, reviewId: record.reviewId, route, status: 'APPLIED' as const,
    direction: record.economicDirection as 'VENDOR_CREDIT' | 'VENDOR_DEDUCTION',
    amountMinor: amount, currency: 'TRY' as const,
    creditId: record.creditEffect?.id ?? null, deductionId: record.deductionEffect?.id ?? null,
    coverageId: record.deductionEffect?.approvedCoverage?.id ?? null,
    historicalApprovedSettlementId: record.historicalApprovedSettlementId,
    historicalPayoutBatchId: record.historicalPayoutBatchId,
    historicalPayoutNetMinor: record.historicalReviewPayoutNetMinor,
    historicalPayoutGrossMinor: record.historicalReviewPayoutGrossMinor,
    historicalPayoutDebtOffsetMinor: record.historicalReviewPayoutDebtOffsetMinor,
    historicalPayoutCancelledAt: record.historicalReviewPayoutCancelledAt.toISOString(),
    eftNotSentConfirmedAt: record.reviewEftNotSentConfirmedAt.toISOString(),
    eftNotSentConfirmationVersion: record.reviewEftNotSentConfirmationVersion,
    observedPayoutStatus: record.reviewPayoutObservedStatus,
    authorizedByUserId: record.authorizedByUserId, reason: record.reason,
    authorizedAt: record.authorizedAt.toISOString(), appliedAt: record.appliedAt.toISOString(),
    previewFingerprint: record.previewFingerprint,
  };
}

async function reviewPosition(db: Db, preview: Preview) {
  const saleId = preview.historicalSaleFinanceLedgerEntryId;
  const refundId = preview.acceptedRefundFinanceLedgerEntryId;
  if (saleId === refundId) return fail('HISTORICAL_FINANCE_MISMATCH');
  const rows = await db.financeLedgerEntry.findMany({
    where: { id: { in: [saleId, refundId] } },
    include: {
      settlementApprovalLines: { include: { settlementApproval: true } },
      payoutBatchLines: { include: { payoutBatch: true } },
    },
  });
  const sale = rows.find((row) => row.id === saleId);
  const refund = rows.find((row) => row.id === refundId);
  if (rows.length !== 2 || !sale || !refund || sale.entryType !== 'sale' || refund.entryType !== 'refund' ||
      [sale, refund].some((row) => row.vendorId !== preview.vendorId ||
        row.vendorAllocationId !== preview.vendorAllocationId || row.voidedAt || row.supersededByLedgerId)) {
    return fail('HISTORICAL_FINANCE_MISMATCH');
  }
  const saleApprovals = sale.settlementApprovalLines.filter((line) =>
    line.lineType === 'SALE' && line.settlementApproval.status === 'APPROVED' &&
    line.settlementApproval.vendorId === preview.vendorId && line.settlementApproval.currency === 'TRY' &&
    !!line.settlementApproval.approvedAt);
  if (saleApprovals.length !== 1) return fail('APPROVED_SETTLEMENT_REQUIRED');
  const origin = saleApprovals[0]!.settlementApproval;
  if ([sale, refund].some((row) => row.settlementApprovalLines.some((line) =>
      line.settlementApproval.status !== 'CANCELLED' && line.settlementApprovalId !== origin.id)) ||
      !refund.settlementApprovalLines.some((line) => line.settlementApprovalId === origin.id && line.lineType === 'REFUND')) {
    return fail('PAYOUT_LINEAGE_MISMATCH');
  }
  const activeLines = [sale, refund].map((row) => row.payoutBatchLines.filter((line) =>
    line.payoutBatch.status !== 'CANCELLED'));
  if (activeLines.some((lines) => lines.length !== 1)) return fail('REVIEW_PAYOUT_REQUIRED');
  const payoutId = activeLines[0]![0]!.payoutBatchId;
  if (activeLines[1]![0]!.payoutBatchId !== payoutId) return fail('PAYOUT_LINEAGE_MISMATCH');
  const payout = await db.payoutBatch.findUnique({
    where: { id: payoutId },
    include: {
      lines: true, correctionCreditLines: true, correctionDeductionLines: true,
      approvedDeductionLines: true,
      vendorBalanceEvents: { where: { type: 'VENDOR_DEBT_OFFSET' } },
    },
  });
  if (!payout || payout.vendorId !== preview.vendorId || payout.currency !== 'TRY') return fail('PAYOUT_LINEAGE_MISMATCH');
  if (payout.status === 'PAID') return fail('PAYOUT_ALREADY_PAID');
  if (payout.status === 'CANCELLED') return fail('PAYOUT_ALREADY_CANCELLED');
  if (payout.status !== 'REVIEW' || payout.paidAt) return fail('REVIEW_PAYOUT_REQUIRED');
  const approval = await db.settlementApproval.findUnique({
    where: { id: origin.id },
    include: {
      lines: { include: { payoutBatchLines: { include: { payoutBatch: true } } } },
      correctionCreditLines: true, correctionDeductionLines: true,
      approvedDeductionCoverages: true,
    },
  });
  if (!approval || approval.status !== 'APPROVED' || !approval.approvedAt ||
      approval.vendorId !== preview.vendorId || approval.currency !== 'TRY' ||
      approval.lines.length === 0 || approval.lines.some((line) =>
        line.payoutBatchLines.filter((membership) => membership.payoutBatch.status !== 'CANCELLED').length !== 1 ||
        line.payoutBatchLines.find((membership) => membership.payoutBatch.status !== 'CANCELLED')?.payoutBatchId !== payoutId) ||
      !approval.lines.some((line) => line.id === saleApprovals[0]!.id) ||
      payout.lines.filter((line) => line.settlementApprovalLineId === saleApprovals[0]!.id).length !== 1 ||
      payout.lines.filter((line) => line.financeLedgerEntryId === refundId).length !== 1) {
    return fail('PAYOUT_LINEAGE_MISMATCH');
  }
  const creditMinor = payout.correctionCreditLines.reduce((sum, line) => sum + line.amountMinor, 0);
  const deductionMinor = [...payout.correctionDeductionLines, ...payout.approvedDeductionLines]
    .reduce((sum, line) => sum + line.amountMinor, 0);
  const debtOffsetMinor = payout.vendorBalanceEvents.reduce((sum, event) => sum + event.amountMinor, 0);
  const ordinaryMinor = payout.lines.reduce((sum, line) => sum + minor(line.amountSnapshot), 0);
  if (payout.correctionCreditLines.some((line) => line.status !== 'ACTIVE' || line.cancelledAt || line.paidAt) ||
      payout.correctionDeductionLines.some((line) => line.status !== 'ACTIVE' || line.cancelledAt || line.paidAt) ||
      payout.approvedDeductionLines.some((line) => line.status !== 'ACTIVE' || line.cancelledAt || line.paidAt) ||
      ![creditMinor, deductionMinor, debtOffsetMinor, ordinaryMinor].every(Number.isSafeInteger) ||
      creditMinor < 0 || deductionMinor < 0 || debtOffsetMinor < 0 ||
      minor(payout.correctionCreditAmount) !== creditMinor ||
      minor(payout.correctionDeductionAmount) !== deductionMinor ||
      minor(payout.netAmount) !== ordinaryMinor + creditMinor - deductionMinor - debtOffsetMinor) {
    return fail('PAYOUT_SOURCE_MISMATCH');
  }
  const signedNet = approval.lines.reduce((sum, line) => sum + line.payableImpactMinor, 0) +
    approval.correctionCreditLines.filter((line) => line.status === 'ACTIVE').reduce((sum, line) => sum + line.amountMinor, 0) -
    approval.correctionDeductionLines.filter((line) => line.status === 'ACTIVE').reduce((sum, line) => sum + line.amountMinor, 0);
  const reserved = approval.approvedDeductionCoverages.filter((coverage) => coverage.status === 'ACTIVE')
    .reduce((sum, coverage) => sum + coverage.amountMinor, 0);
  if (!Number.isSafeInteger(signedNet) || signedNet !== approval.netPayableMinor ||
      signedNet <= 0 || reserved < 0 || reserved > signedNet) return fail('APPROVED_SETTLEMENT_CHANGED');
  const composition = {
    lines: payout.lines.map((line) => [line.id, line.settlementApprovalLineId, minor(line.amountSnapshot)]).sort(),
    credits: payout.correctionCreditLines.map((line) => [line.id, line.settlementCreditLineId, line.amountMinor]).sort(),
    deductions: payout.correctionDeductionLines.map((line) => [line.id, line.settlementDeductionLineId, line.amountMinor]).sort(),
    coveredDeductions: payout.approvedDeductionLines.map((line) => [line.id, line.coverageId, line.amountMinor]).sort(),
    debtOffsets: payout.vendorBalanceEvents.map((event) => [event.id, event.amountMinor]).sort(),
  };
  const sourceFingerprint = createHash('sha256').update(JSON.stringify(composition)).digest('hex');
  return { payout, approval, availableCoverageMinor: signedNet - reserved, sourceFingerprint,
    debtOffsetMinor };
}

export async function getReviewPayoutFinancialCorrectionState(reviewId: string, db: typeof prisma = prisma) {
  const existing = await db.financialCorrectionAuthority.findUnique({ where: { reviewId }, include: appliedInclude });
  if (existing) return existing.applicationRoute.startsWith('REVIEW_PAYOUT_VENDOR_')
    ? { application: serialize(existing), eligible: false, reasonCode: 'CORRECTION_ALREADY_APPLIED', reviewPayout: null }
    : { application: null, eligible: false, reasonCode: 'BASELINE_ALREADY_CLAIMED', reviewPayout: null };
  try {
    const preview = await previewTerminalFinancialCorrection(reviewId, db);
    if (preview.currency !== 'TRY' || preview.economicDirection === 'NONE' ||
        !Number.isSafeInteger(preview.difference.vendorPayableReversalMinor) ||
        preview.difference.vendorPayableReversalMinor === 0) {
      return { application: null, eligible: false, reasonCode: 'NONZERO_ROUTE_UNSUPPORTED', reviewPayout: null };
    }
    const [zeroNet, claim, event] = await Promise.all([
      db.financialCorrectionZeroNetAcknowledgement.findUnique({ where: { acceptedEvidenceSnapshotId: preview.acceptedEvidence.id } }),
      db.financialCorrectionBaselineClaim.findUnique({ where: { acceptedEvidenceSnapshotId: preview.acceptedEvidence.id } }),
      db.refundTerminalEvidenceReviewEvent.findFirst({ where: { reviewId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }),
    ]);
    if (zeroNet || claim) return { application: null, eligible: false, reasonCode: 'BASELINE_ALREADY_CLAIMED', reviewPayout: null };
    if (event?.eventType !== 'RESOLVED' || event.resolutionOutcome !== 'CORRECTION_REQUIRED') {
      return { application: null, eligible: false, reasonCode: 'REVIEW_NOT_ELIGIBLE', reviewPayout: null };
    }
    const position = await reviewPosition(db, preview);
    if (preview.economicDirection === 'VENDOR_DEDUCTION' &&
        position.availableCoverageMinor < preview.difference.vendorPayableReversalMinor) {
      return { application: null, eligible: false, reasonCode: 'INSUFFICIENT_APPROVED_PAYABLE', reviewPayout: null };
    }
    return { application: null, eligible: true, reasonCode: null, reviewPayout: {
      id: position.payout.id, netAmountMinor: minor(position.payout.netAmount),
      grossAmountMinor: minor(position.payout.grossAmount),
      debtOffsetMinor: position.debtOffsetMinor,
      status: 'REVIEW' as const,
    } };
  } catch (error) {
    if (error instanceof ReviewPayoutFinancialCorrectionError) {
      return { application: null, eligible: false, reasonCode: error.code, reviewPayout: null };
    }
    if (error instanceof FinancialCorrectionPreviewError) {
      return { application: null, eligible: false, reasonCode: 'REVIEW_NOT_ELIGIBLE', reviewPayout: null };
    }
    throw error;
  }
}

export async function applyReviewPayoutFinancialCorrection(input: {
  reviewId: string; previewFingerprint: string; actorUserId: string; reason: string;
  confirmEftNotSent: boolean;
}, db: typeof prisma = prisma) {
  if (!input.actorUserId?.trim()) return fail('ADMIN_ACTOR_REQUIRED', 403);
  if (!/^financial-correction-preview-v1:[a-f0-9]{64}$/.test(input.previewFingerprint)) return fail('PREVIEW_FINGERPRINT_REQUIRED', 400);
  const reason = input.reason?.trim();
  if (!reason || reason.length > 500) return fail('REASON_REQUIRED', 400);
  // REVIEW and paidAt=null do not prove bank state. This explicit Admin attestation
  // is the only local operational evidence; database locks cannot fence a human EFT.
  if (input.confirmEftNotSent !== true) return fail('EFT_NOT_SENT_CONFIRMATION_REQUIRED', 400);
  const matchingExisting = async () => {
    const existing = await db.financialCorrectionAuthority.findUnique({ where: { reviewId: input.reviewId }, include: appliedInclude });
    if (!existing) return null;
    if (existing.applicationRoute.startsWith('REVIEW_PAYOUT_VENDOR_') &&
        existing.previewFingerprint === input.previewFingerprint && existing.authorizedByUserId === input.actorUserId &&
        existing.reason === reason) return serialize(existing);
    return fail('CORRECTION_ALREADY_APPLIED');
  };
  const lockKey = await db.refundTerminalEvidenceReview.findUnique({
    where: { id: input.reviewId }, select: { economicVendorId: true },
  });
  if (!lockKey?.economicVendorId) return fail('REVIEW_NOT_ELIGIBLE');
  try {
    return await db.$transaction(async (tx) => {
      const vendor = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id" FROM "Vendor" WHERE "id" = ${lockKey.economicVendorId} FOR UPDATE
      `);
      if (vendor.length !== 1) return fail('HISTORICAL_FINANCE_MISMATCH');
      await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id" FROM "RefundTerminalEvidenceReview" WHERE "id" = ${input.reviewId} FOR UPDATE
      `);
      const existing = await tx.financialCorrectionAuthority.findUnique({ where: { reviewId: input.reviewId }, include: appliedInclude });
      if (existing) {
        if (existing.applicationRoute.startsWith('REVIEW_PAYOUT_VENDOR_') &&
            existing.previewFingerprint === input.previewFingerprint && existing.authorizedByUserId === input.actorUserId &&
            existing.reason === reason) return serialize(existing);
        return fail('CORRECTION_ALREADY_APPLIED');
      }
      const review = await tx.refundTerminalEvidenceReview.findUnique({
        where: { id: input.reviewId }, select: { storedEvidenceSnapshotId: true, economicVendorId: true },
      });
      if (!review?.storedEvidenceSnapshotId || review.economicVendorId !== lockKey.economicVendorId) return fail('REVIEW_NOT_ELIGIBLE');
      await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id" FROM "RefundEvidenceSnapshot" WHERE "id" = ${review.storedEvidenceSnapshotId} FOR UPDATE
      `);
      let preview: Preview;
      try { preview = await previewTerminalFinancialCorrection(input.reviewId, tx); }
      catch (error) {
        if (error instanceof FinancialCorrectionPreviewError) return fail(`EVIDENCE_CHANGED_${error.reasonCode.toUpperCase()}`);
        throw error;
      }
      if (preview.vendorId !== lockKey.economicVendorId || preview.acceptedEvidence.id !== review.storedEvidenceSnapshotId) return fail('EVIDENCE_CHANGED');
      if (preview.previewFingerprint !== input.previewFingerprint) return fail('PREVIEW_STALE');
      const difference = preview.difference.vendorPayableReversalMinor;
      if (preview.currency !== 'TRY' || !Number.isSafeInteger(difference) || difference === 0 ||
          preview.economicDirection === 'NONE' ||
          (preview.economicDirection === 'VENDOR_CREDIT' && difference >= 0) ||
          (preview.economicDirection === 'VENDOR_DEDUCTION' && difference <= 0)) return fail('NONZERO_ROUTE_UNSUPPORTED');
      const [zeroNet, claim, event] = await Promise.all([
        tx.financialCorrectionZeroNetAcknowledgement.findUnique({ where: { acceptedEvidenceSnapshotId: preview.acceptedEvidence.id } }),
        tx.financialCorrectionBaselineClaim.findUnique({ where: { acceptedEvidenceSnapshotId: preview.acceptedEvidence.id } }),
        tx.refundTerminalEvidenceReviewEvent.findFirst({ where: { reviewId: input.reviewId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }),
      ]);
      if (zeroNet || claim) return fail('BASELINE_ALREADY_CLAIMED');
      if (event?.eventType !== 'RESOLVED' || event.resolutionOutcome !== 'CORRECTION_REQUIRED') return fail('REVIEW_NOT_ELIGIBLE');
      const position = await reviewPosition(tx, preview);
      await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id" FROM "PayoutBatch" WHERE "id" = ${position.payout.id} FOR UPDATE
      `);
      const lockedPosition = await reviewPosition(tx, preview);
      if (lockedPosition.payout.id !== position.payout.id ||
          lockedPosition.sourceFingerprint !== position.sourceFingerprint) return fail('PAYOUT_STATE_CHANGED');
      if (preview.economicDirection === 'VENDOR_DEDUCTION' &&
          position.availableCoverageMinor < difference) return fail('INSUFFICIENT_APPROVED_PAYABLE');
      const cancelledAt = new Date();
      try { await cancelReviewPayoutBatchWithClient(tx, position.payout.id, cancelledAt); }
      catch (error) {
        if (error instanceof Error && error.message === 'REVIEW_PAYOUT_STATE_CHANGED') return fail('PAYOUT_CANCELLATION_FAILED');
        throw error;
      }
      const released = await tx.payoutBatch.findUnique({
        where: { id: position.payout.id },
        include: { correctionCreditLines: true, correctionDeductionLines: true, approvedDeductionLines: true },
      });
      if (released?.status !== 'CANCELLED' || released.paidAt ||
          [...released.correctionCreditLines, ...released.correctionDeductionLines,
            ...released.approvedDeductionLines].some((line) => line.status !== 'CANCELLED' ||
              line.cancelledAt?.getTime() !== cancelledAt.getTime())) return fail('PAYOUT_CANCELLATION_FAILED');
      const authorityId = randomUUID();
      const route = preview.economicDirection === 'VENDOR_CREDIT'
        ? 'REVIEW_PAYOUT_VENDOR_CREDIT' : 'REVIEW_PAYOUT_VENDOR_DEDUCTION';
      await tx.financialCorrectionBaselineClaim.create({ data: {
        acceptedEvidenceSnapshotId: preview.acceptedEvidence.id,
        consumerType: route.toLowerCase(), consumerId: authorityId,
      } });
      await tx.financialCorrectionAuthority.create({ data: {
        id: authorityId, reviewId: input.reviewId, resolvedReviewEventId: event.id,
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
        commissionVatPercent: new Prisma.Decimal(preview.commissionVatPercent), currency: 'TRY',
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
        vendorPayableDifferenceMinor: difference,
        economicDirection: preview.economicDirection, previewFingerprint: preview.previewFingerprint,
        historicalPayoutBatchId: position.payout.id, historicalPayoutPaidAt: null,
        historicalReviewPayoutGrossMinor: minor(position.payout.grossAmount),
        historicalReviewPayoutNetMinor: minor(position.payout.netAmount),
        historicalReviewPayoutDebtOffsetMinor: position.debtOffsetMinor,
        historicalReviewPayoutSourceFingerprint: position.sourceFingerprint,
        historicalReviewPayoutCancelledAt: cancelledAt,
        reviewEftNotSentConfirmedAt: cancelledAt,
        reviewEftNotSentConfirmationVersion: REVIEW_EFT_NOT_SENT_CONFIRMATION_V1.version,
        reviewPayoutObservedStatus: 'REVIEW',
        historicalApprovedSettlementId: position.approval.id,
        historicalApprovedSettlementAt: position.approval.approvedAt,
        historicalApprovedSettlementNetMinor: position.approval.netPayableMinor,
        applicationRoute: route, authorizedByUserId: input.actorUserId, reason,
      } });
      if (preview.economicDirection === 'VENDOR_CREDIT') {
        await tx.financialCorrectionCredit.create({ data: {
          authorityId, vendorId: preview.vendorId, amountMinor: -difference, currency: 'TRY',
        } });
      } else {
        await tx.financialCorrectionDeduction.create({ data: {
          authorityId, vendorId: preview.vendorId, amountMinor: difference, currency: 'TRY',
          approvedCoverage: { create: {
            settlementApprovalId: position.approval.id, vendorId: preview.vendorId,
            amountMinor: difference, currency: 'TRY', status: 'ACTIVE',
          } },
        } });
      }
      const applied = await tx.financialCorrectionAuthority.findUnique({ where: { id: authorityId }, include: appliedInclude });
      if (!applied) return fail('CORRECTION_EFFECT_WRITE_FAILED', 500);
      return serialize(applied);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === 'P2002' || error.code === 'P2034')) {
      const existing = await matchingExisting();
      if (existing) return existing;
      return fail(error.code === 'P2002' ? 'BASELINE_ALREADY_CLAIMED' : 'CONCURRENT_FINANCE_STATE_CHANGE');
    }
    throw error;
  }
}
