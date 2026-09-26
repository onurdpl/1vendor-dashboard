import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { FinancialCorrectionPreviewError, previewTerminalFinancialCorrection } from './financial-correction-preview.service.js';

export class BeforeSettlementFinancialCorrectionError extends Error {
  constructor(readonly code: string, readonly statusCode = 409) {
    super(`Before-settlement financial correction unavailable: ${code}.`);
    this.name = 'BeforeSettlementFinancialCorrectionError';
  }
}

const fail = (code: string, statusCode?: number): never => {
  throw new BeforeSettlementFinancialCorrectionError(code, statusCode);
};

const appliedInclude = {
  creditEffect: { include: { settlementLines: { include: { settlementApproval: true,
    payoutLines: { include: { payoutBatch: true } } } } } },
} as const;
type AppliedCredit = Prisma.FinancialCorrectionAuthorityGetPayload<{ include: typeof appliedInclude }>;
type Preview = Awaited<ReturnType<typeof previewTerminalFinancialCorrection>>;

function serialize(record: AppliedCredit) {
  const credit = record.creditEffect;
  if (record.applicationRoute !== 'BEFORE_SETTLEMENT_VENDOR_CREDIT' ||
      record.economicDirection !== 'VENDOR_CREDIT' || record.currency !== 'TRY' ||
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
    route: 'BEFORE_SETTLEMENT_VENDOR_CREDIT' as const,
    grossCreditMinor: credit.amountMinor, currency: 'TRY' as const,
    authorizedByUserId: record.authorizedByUserId, reason: record.reason,
    authorizedAt: record.authorizedAt.toISOString(), appliedAt: record.appliedAt.toISOString(),
    previewFingerprint: record.previewFingerprint,
    settlementApprovalId: settlementLine?.settlementApprovalId ?? null,
    settlementStatus: settlementLine?.settlementApproval.status ?? null,
    payoutBatchId: payoutLine?.payoutBatchId ?? null,
    payoutStatus: payoutLine?.payoutBatch.status ?? null,
  };
}

// Both original finance rows must still be outside settlement/payout authority.
// CANCELLED settlement lines release their sources; *any* payout membership excludes this route.
async function assertBeforeSettlement(db: Pick<typeof prisma, 'financeLedgerEntry'>, preview: Preview) {
  const ids = [preview.historicalSaleFinanceLedgerEntryId, preview.acceptedRefundFinanceLedgerEntryId];
  const rows = await db.financeLedgerEntry.findMany({
    where: { id: { in: ids } },
    include: {
      settlementApprovalLines: { include: { settlementApproval: { select: { status: true } } } },
      payoutBatchLines: { select: { id: true } },
    },
  });
  if (ids[0] === ids[1] || rows.length !== 2) return fail('HISTORICAL_FINANCE_MISMATCH');
  for (const [id, entryType] of [[ids[0], 'sale'], [ids[1], 'refund']] as const) {
    const row = rows.find((candidate) => candidate.id === id);
    if (!row || row.entryType !== entryType || row.vendorId !== preview.vendorId ||
        row.vendorAllocationId !== preview.vendorAllocationId || row.voidedAt || row.supersededByLedgerId) {
      return fail('HISTORICAL_FINANCE_MISMATCH');
    }
    if (row.settlementApprovalLines.some((line) => line.settlementApproval.status !== 'CANCELLED')) {
      return fail('ACTIVE_SETTLEMENT_EXISTS');
    }
    if (row.payoutBatchLines.length > 0) return fail('PAYOUT_ALREADY_EXISTS');
    if (row.payoutStatus !== 'PENDING' ||
        !['PENDING', 'ACCRUING', 'PAYABLE', 'PARTIALLY_REFUNDED'].includes(row.settlementStatus)) {
      return fail('BEFORE_SETTLEMENT_ROUTE_UNAVAILABLE');
    }
  }
}

export async function getBeforeSettlementFinancialCorrectionCreditState(reviewId: string, db: typeof prisma = prisma) {
  const existing = await db.financialCorrectionAuthority.findUnique({ where: { reviewId }, include: appliedInclude });
  if (existing) return existing.applicationRoute === 'BEFORE_SETTLEMENT_VENDOR_CREDIT'
    ? { application: serialize(existing), eligible: false, reasonCode: 'CREDIT_EFFECT_ALREADY_EXISTS' }
    : { application: null, eligible: false, reasonCode: 'BASELINE_ALREADY_CLAIMED' };
  try {
    const preview = await previewTerminalFinancialCorrection(reviewId, db);
    if (preview.economicDirection !== 'VENDOR_CREDIT' || preview.currency !== 'TRY' ||
        !Number.isSafeInteger(preview.difference.vendorPayableReversalMinor) ||
        preview.difference.vendorPayableReversalMinor >= 0) {
      return { application: null, eligible: false, reasonCode: 'WRONG_CORRECTION_DIRECTION' };
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
    await assertBeforeSettlement(db, preview);
    return { application: null, eligible: true, reasonCode: null };
  } catch (error) {
    if (error instanceof BeforeSettlementFinancialCorrectionError) return { application: null, eligible: false, reasonCode: error.code };
    if (error instanceof FinancialCorrectionPreviewError) return { application: null, eligible: false, reasonCode: 'REVIEW_NOT_ELIGIBLE' };
    throw error;
  }
}

export async function applyBeforeSettlementFinancialCorrectionCredit(input: {
  reviewId: string; previewFingerprint: string; actorUserId: string; reason: string;
}, db: typeof prisma = prisma) {
  if (!input.actorUserId?.trim()) return fail('ADMIN_ACTOR_REQUIRED', 403);
  if (!/^financial-correction-preview-v1:[a-f0-9]{64}$/.test(input.previewFingerprint)) return fail('PREVIEW_FINGERPRINT_REQUIRED', 400);
  const reason = input.reason?.trim();
  if (!reason || reason.length > 500) return fail('REASON_REQUIRED', 400);

  const matchingExisting = async () => {
    const existing = await db.financialCorrectionAuthority.findUnique({ where: { reviewId: input.reviewId }, include: appliedInclude });
    if (!existing) return null;
    if (existing.applicationRoute === 'BEFORE_SETTLEMENT_VENDOR_CREDIT' &&
        existing.previewFingerprint === input.previewFingerprint && existing.authorizedByUserId === input.actorUserId &&
        existing.reason === reason) return serialize(existing);
    return fail('CREDIT_EFFECT_ALREADY_EXISTS');
  };

  // Discover only the lock key outside the transaction. The authority is re-read and verified after locking.
  const lockKey = await db.refundTerminalEvidenceReview.findUnique({
    where: { id: input.reviewId }, select: { economicVendorId: true },
  });
  if (!lockKey?.economicVendorId) return fail('REVIEW_NOT_ELIGIBLE');
  // A draft created while Apply is acquiring the vendor lock must not become a stale
  // finance snapshot that silently omits this newly-authorized credit.
  const settlementIdsAtStart = new Set((await db.settlementApproval.findMany({
    where: { vendorId: lockKey.economicVendorId, status: { in: ['DRAFT', 'APPROVED'] } }, select: { id: true },
  })).map((approval) => approval.id));
  try {
    return await db.$transaction(async (tx) => {
      // Settlement drafting takes this same vendor lock before it snapshots candidate rows or credits.
      const vendorRows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id" FROM "Vendor" WHERE "id" = ${lockKey.economicVendorId} FOR UPDATE
      `);
      if (vendorRows.length !== 1) return fail('HISTORICAL_FINANCE_MISMATCH');
      await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id" FROM "RefundTerminalEvidenceReview" WHERE "id" = ${input.reviewId} FOR UPDATE
      `);
      const existing = await tx.financialCorrectionAuthority.findUnique({ where: { reviewId: input.reviewId }, include: appliedInclude });
      if (existing) {
        if (existing.applicationRoute === 'BEFORE_SETTLEMENT_VENDOR_CREDIT' &&
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
      await assertBeforeSettlement(tx, preview);
      const currentActiveApprovals = await tx.settlementApproval.findMany({
        where: { vendorId: preview.vendorId, status: { in: ['DRAFT', 'APPROVED'] } }, select: { id: true },
      });
      if (currentActiveApprovals.some((approval) => !settlementIdsAtStart.has(approval.id))) {
        return fail('CONCURRENT_FINANCE_STATE_CHANGE');
      }

      const authorityId = randomUUID();
      await tx.financialCorrectionBaselineClaim.create({
        data: { acceptedEvidenceSnapshotId: preview.acceptedEvidence.id,
          consumerType: 'before_settlement_vendor_credit', consumerId: authorityId },
      });
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
        applicationRoute: 'BEFORE_SETTLEMENT_VENDOR_CREDIT', authorizedByUserId: input.actorUserId, reason,
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
