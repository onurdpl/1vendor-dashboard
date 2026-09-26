import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { FinancialCorrectionPreviewError, previewTerminalFinancialCorrection } from './financial-correction-preview.service.js';

export class ApprovedSettlementFinancialCorrectionCreditError extends Error {
  constructor(readonly code: string, readonly statusCode = 409) {
    super(`Approved-settlement financial correction credit unavailable: ${code}.`);
    this.name = 'ApprovedSettlementFinancialCorrectionCreditError';
  }
}

const fail = (code: string, statusCode?: number): never => {
  throw new ApprovedSettlementFinancialCorrectionCreditError(code, statusCode);
};

type Preview = Awaited<ReturnType<typeof previewTerminalFinancialCorrection>>;
type Db = typeof prisma | Prisma.TransactionClient;
const appliedInclude = {
  creditEffect: { include: { settlementLines: { include: { settlementApproval: true,
    payoutLines: { include: { payoutBatch: true } } } } } },
} as const;
type AppliedCredit = Prisma.FinancialCorrectionAuthorityGetPayload<{ include: typeof appliedInclude }>;

function serialize(record: AppliedCredit) {
  const credit = record.creditEffect;
  if (record.applicationRoute !== 'APPROVED_SETTLEMENT_VENDOR_CREDIT' ||
      record.economicDirection !== 'VENDOR_CREDIT' || record.currency !== 'TRY' ||
      !record.historicalApprovedSettlementId || !record.historicalApprovedSettlementAt ||
      record.historicalApprovedSettlementNetMinor === null ||
      record.historicalPayoutBatchId || record.historicalPayoutPaidAt ||
      record.vendorPayableDifferenceMinor >= 0 || !credit ||
      credit.authorityId !== record.id || credit.vendorId !== record.vendorId ||
      credit.currency !== 'TRY' || credit.amountMinor !== -record.vendorPayableDifferenceMinor) {
    return fail('CREDIT_EFFECT_MISMATCH', 500);
  }
  const settlementLine = credit.settlementLines.find((line) => line.status === 'ACTIVE' &&
    line.settlementApproval.status !== 'CANCELLED');
  const payoutLine = settlementLine?.payoutLines.find((line) => line.status !== 'CANCELLED' &&
    line.payoutBatch.status !== 'CANCELLED');
  return {
    id: record.id, reviewId: record.reviewId, creditId: credit.id,
    status: 'APPLIED' as const, direction: 'VENDOR_CREDIT' as const,
    route: 'APPROVED_SETTLEMENT_VENDOR_CREDIT' as const,
    grossCreditMinor: credit.amountMinor, currency: 'TRY' as const,
    historicalApprovedSettlementId: record.historicalApprovedSettlementId,
    historicalApprovedSettlementAt: record.historicalApprovedSettlementAt.toISOString(),
    historicalApprovedSettlementNetMinor: record.historicalApprovedSettlementNetMinor,
    authorizedByUserId: record.authorizedByUserId, reason: record.reason,
    authorizedAt: record.authorizedAt.toISOString(), appliedAt: record.appliedAt.toISOString(),
    previewFingerprint: record.previewFingerprint,
    settlementApprovalId: settlementLine?.settlementApprovalId ?? null,
    settlementStatus: settlementLine?.settlementApproval.status ?? null,
    payoutBatchId: payoutLine?.payoutBatchId ?? null,
    payoutStatus: payoutLine?.payoutBatch.status ?? null,
  };
}

// This deliberately excludes *all* payout history, including cancelled rows.
async function approvedUnpaidPosition(db: Db, preview: Preview) {
  const ids = [preview.historicalSaleFinanceLedgerEntryId, preview.acceptedRefundFinanceLedgerEntryId];
  if (ids[0] === ids[1]) return fail('HISTORICAL_FINANCE_MISMATCH');
  const rows = await db.financeLedgerEntry.findMany({
    where: { id: { in: ids } },
    include: {
      settlementApprovalLines: { include: { settlementApproval: {
        select: { id: true, vendorId: true, currency: true, status: true, approvedAt: true, netPayableMinor: true },
      } } },
      payoutBatchLines: { select: { id: true } },
    },
  });
  if (rows.length !== 2) return fail('HISTORICAL_FINANCE_MISMATCH');
  const sale = rows.find((row) => row.id === ids[0]);
  const refund = rows.find((row) => row.id === ids[1]);
  if (!sale || !refund || sale.entryType !== 'sale' || refund.entryType !== 'refund' ||
      [sale, refund].some((row) => row.vendorId !== preview.vendorId ||
        row.vendorAllocationId !== preview.vendorAllocationId || row.voidedAt || row.supersededByLedgerId)) {
    return fail('HISTORICAL_FINANCE_MISMATCH');
  }
  if ([sale, refund].some((row) => row.payoutBatchLines.length > 0 ||
      !['PENDING', 'APPROVED'].includes(row.payoutStatus))) {
    return fail('PAYOUT_HISTORY_EXISTS');
  }
  const approvedSaleLines = sale.settlementApprovalLines.filter((line) =>
    line.lineType === 'SALE' && line.settlementApproval.status === 'APPROVED' &&
    line.settlementApproval.vendorId === preview.vendorId && line.settlementApproval.currency === 'TRY' &&
    !!line.settlementApproval.approvedAt);
  if (approvedSaleLines.length !== 1) return fail('APPROVED_SETTLEMENT_REQUIRED');
  const origin = approvedSaleLines[0]!.settlementApproval;
  if (sale.settlementApprovalLines.some((line) =>
      line.settlementApproval.status !== 'CANCELLED' && line.settlementApproval.id !== origin.id) ||
      refund.settlementApprovalLines.some((line) =>
        line.settlementApproval.status !== 'CANCELLED' && line.settlementApproval.id !== origin.id)) {
    return fail('APPROVED_SETTLEMENT_CREDIT_ROUTE_UNAVAILABLE');
  }
  const approval = await db.settlementApproval.findUnique({
    where: { id: origin.id },
    include: {
      lines: { include: { payoutBatchLines: { select: { id: true } } } },
      correctionCreditLines: { include: { payoutLines: { select: { id: true } } } },
      correctionDeductionLines: { include: { payoutLines: { select: { id: true } } } },
    },
  });
  if (!approval || approval.status !== 'APPROVED' || approval.vendorId !== preview.vendorId ||
      approval.currency !== 'TRY' || !approval.approvedAt ||
      !approval.lines.some((line) => line.id === approvedSaleLines[0]!.id)) {
    return fail('APPROVED_SETTLEMENT_CHANGED');
  }
  if (approval.lines.some((line) => line.payoutBatchLines.length > 0) ||
      approval.correctionCreditLines.some((line) => line.payoutLines.length > 0) ||
      approval.correctionDeductionLines.some((line) => line.payoutLines.length > 0)) {
    return fail('PAYOUT_HISTORY_EXISTS');
  }
  return { id: approval.id, approvedAt: approval.approvedAt, netPayableMinor: approval.netPayableMinor };
}

export async function getApprovedSettlementFinancialCorrectionCreditState(reviewId: string, db: typeof prisma = prisma) {
  const existing = await db.financialCorrectionAuthority.findUnique({ where: { reviewId }, include: appliedInclude });
  if (existing) return existing.applicationRoute === 'APPROVED_SETTLEMENT_VENDOR_CREDIT'
    ? { application: serialize(existing), eligible: false, reasonCode: 'CREDIT_EFFECT_ALREADY_EXISTS', approvedSettlement: null }
    : { application: null, eligible: false, reasonCode: 'BASELINE_ALREADY_CLAIMED', approvedSettlement: null };
  try {
    const preview = await previewTerminalFinancialCorrection(reviewId, db);
    if (preview.economicDirection !== 'VENDOR_CREDIT' || preview.currency !== 'TRY' ||
        !Number.isSafeInteger(preview.difference.vendorPayableReversalMinor) ||
        preview.difference.vendorPayableReversalMinor >= 0) {
      return { application: null, eligible: false, reasonCode: 'WRONG_CORRECTION_DIRECTION', approvedSettlement: null };
    }
    const [zeroNet, claim, resolvedEvent] = await Promise.all([
      db.financialCorrectionZeroNetAcknowledgement.findUnique({ where: { acceptedEvidenceSnapshotId: preview.acceptedEvidence.id } }),
      db.financialCorrectionBaselineClaim.findUnique({ where: { acceptedEvidenceSnapshotId: preview.acceptedEvidence.id } }),
      db.refundTerminalEvidenceReviewEvent.findFirst({ where: { reviewId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }),
    ]);
    if (zeroNet || claim) return { application: null, eligible: false, reasonCode: 'BASELINE_ALREADY_CLAIMED', approvedSettlement: null };
    if (resolvedEvent?.eventType !== 'RESOLVED' || resolvedEvent.resolutionOutcome !== 'CORRECTION_REQUIRED') {
      return { application: null, eligible: false, reasonCode: 'REVIEW_NOT_ELIGIBLE', approvedSettlement: null };
    }
    const approvedSettlement = await approvedUnpaidPosition(db, preview);
    return { application: null, eligible: true, reasonCode: null, approvedSettlement };
  } catch (error) {
    if (error instanceof ApprovedSettlementFinancialCorrectionCreditError) {
      return { application: null, eligible: false, reasonCode: error.code, approvedSettlement: null };
    }
    if (error instanceof FinancialCorrectionPreviewError) {
      return { application: null, eligible: false, reasonCode: 'REVIEW_NOT_ELIGIBLE', approvedSettlement: null };
    }
    throw error;
  }
}

export async function applyApprovedSettlementFinancialCorrectionCredit(input: {
  reviewId: string; previewFingerprint: string; actorUserId: string; reason: string;
}, db: typeof prisma = prisma) {
  if (!input.actorUserId?.trim()) return fail('ADMIN_ACTOR_REQUIRED', 403);
  if (!/^financial-correction-preview-v1:[a-f0-9]{64}$/.test(input.previewFingerprint)) return fail('PREVIEW_FINGERPRINT_REQUIRED', 400);
  const reason = input.reason?.trim();
  if (!reason || reason.length > 500) return fail('REASON_REQUIRED', 400);
  const matchingExisting = async () => {
    const existing = await db.financialCorrectionAuthority.findUnique({ where: { reviewId: input.reviewId }, include: appliedInclude });
    if (!existing) return null;
    if (existing.applicationRoute === 'APPROVED_SETTLEMENT_VENDOR_CREDIT' &&
        existing.previewFingerprint === input.previewFingerprint && existing.authorizedByUserId === input.actorUserId &&
        existing.reason === reason) return serialize(existing);
    return fail('CREDIT_EFFECT_ALREADY_EXISTS');
  };
  const lockKey = await db.refundTerminalEvidenceReview.findUnique({
    where: { id: input.reviewId }, select: { economicVendorId: true },
  });
  if (!lockKey?.economicVendorId) return fail('REVIEW_NOT_ELIGIBLE');
  try {
    return await db.$transaction(async (tx) => {
      const vendorRows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id" FROM "Vendor" WHERE "id" = ${lockKey.economicVendorId} FOR UPDATE
      `);
      if (vendorRows.length !== 1) return fail('HISTORICAL_FINANCE_MISMATCH');
      await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id" FROM "RefundTerminalEvidenceReview" WHERE "id" = ${input.reviewId} FOR UPDATE
      `);
      const existing = await tx.financialCorrectionAuthority.findUnique({ where: { reviewId: input.reviewId }, include: appliedInclude });
      if (existing) {
        if (existing.applicationRoute === 'APPROVED_SETTLEMENT_VENDOR_CREDIT' &&
            existing.previewFingerprint === input.previewFingerprint && existing.authorizedByUserId === input.actorUserId &&
            existing.reason === reason) return serialize(existing);
        return fail('CREDIT_EFFECT_ALREADY_EXISTS');
      }
      const review = await tx.refundTerminalEvidenceReview.findUnique({
        where: { id: input.reviewId }, select: { storedEvidenceSnapshotId: true, economicVendorId: true },
      });
      if (!review?.storedEvidenceSnapshotId || review.economicVendorId !== lockKey.economicVendorId) return fail('REVIEW_NOT_ELIGIBLE');
      await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id" FROM "RefundEvidenceSnapshot" WHERE "id" = ${review.storedEvidenceSnapshotId} FOR UPDATE
      `);
      let preview: Preview;
      try {
        preview = await previewTerminalFinancialCorrection(input.reviewId, tx);
      } catch (error) {
        if (error instanceof FinancialCorrectionPreviewError) return fail(`EVIDENCE_CHANGED_${error.reasonCode.toUpperCase()}`);
        throw error;
      }
      if (preview.vendorId !== lockKey.economicVendorId || preview.acceptedEvidence.id !== review.storedEvidenceSnapshotId) {
        return fail('EVIDENCE_CHANGED');
      }
      if (preview.previewFingerprint !== input.previewFingerprint) return fail('PREVIEW_STALE');
      if (preview.economicDirection !== 'VENDOR_CREDIT' || preview.currency !== 'TRY' ||
          !Number.isSafeInteger(preview.difference.vendorPayableReversalMinor) ||
          preview.difference.vendorPayableReversalMinor >= 0) return fail('WRONG_CORRECTION_DIRECTION');
      const [zeroNet, claim] = await Promise.all([
        tx.financialCorrectionZeroNetAcknowledgement.findUnique({ where: { acceptedEvidenceSnapshotId: preview.acceptedEvidence.id } }),
        tx.financialCorrectionBaselineClaim.findUnique({ where: { acceptedEvidenceSnapshotId: preview.acceptedEvidence.id } }),
      ]);
      if (zeroNet || claim) return fail('BASELINE_ALREADY_CLAIMED');
      const resolvedEvent = await tx.refundTerminalEvidenceReviewEvent.findFirst({
        where: { reviewId: input.reviewId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      if (resolvedEvent?.eventType !== 'RESOLVED' || resolvedEvent.resolutionOutcome !== 'CORRECTION_REQUIRED') return fail('REVIEW_NOT_ELIGIBLE');
      const approval = await approvedUnpaidPosition(tx, preview);
      const authorityId = randomUUID();
      await tx.financialCorrectionBaselineClaim.create({ data: {
        acceptedEvidenceSnapshotId: preview.acceptedEvidence.id,
        consumerType: 'approved_settlement_vendor_credit', consumerId: authorityId,
      } });
      await tx.financialCorrectionAuthority.create({ data: {
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
        vendorPayableDifferenceMinor: preview.difference.vendorPayableReversalMinor,
        economicDirection: 'VENDOR_CREDIT', previewFingerprint: preview.previewFingerprint,
        historicalPayoutBatchId: null, historicalPayoutPaidAt: null,
        historicalApprovedSettlementId: approval.id,
        historicalApprovedSettlementAt: approval.approvedAt,
        historicalApprovedSettlementNetMinor: approval.netPayableMinor,
        applicationRoute: 'APPROVED_SETTLEMENT_VENDOR_CREDIT', authorizedByUserId: input.actorUserId, reason,
      } });
      await tx.financialCorrectionCredit.create({ data: {
        authorityId, vendorId: preview.vendorId,
        amountMinor: -preview.difference.vendorPayableReversalMinor, currency: 'TRY',
      } });
      const applied = await tx.financialCorrectionAuthority.findUnique({ where: { id: authorityId }, include: appliedInclude });
      if (!applied) return fail('CREDIT_EFFECT_WRITE_FAILED', 500);
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
