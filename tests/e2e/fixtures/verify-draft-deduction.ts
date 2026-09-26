import { PrismaClient } from '../../../backend/node_modules/@prisma/client/index.js';

const databaseUrl = process.env.DATABASE_URL?.trim();
const target = databaseUrl ? new URL(databaseUrl) : null;
if (process.env.BROWSER_SMOKE_ALLOW_LOCAL_DB !== '1' || !target ||
    !['localhost', '127.0.0.1'].includes(target.hostname) ||
    !/^\/vendor_dashboard_browser_smoke_[0-9]+_[0-9]+$/.test(target.pathname)) {
  throw new Error('DRAFT applied-state verification requires the dedicated local browser-smoke database.');
}

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
try {
  const reviewId = 'browser-smoke-draft-deduction-review';
  const authority = await db.financialCorrectionAuthority.findUnique({ where: { reviewId } });
  if (!authority || authority.applicationRoute !== 'DRAFT_PAYOUT_VENDOR_DEDUCTION' ||
      authority.economicDirection !== 'VENDOR_DEDUCTION' || !authority.historicalPayoutBatchId ||
      authority.historicalPayoutPaidAt !== null || !authority.historicalApprovedSettlementId) {
    throw new Error('Expected applied DRAFT vendor-deduction authority was not found.');
  }
  const [deduction, payout, claim, claimCount, payoutCount, correctionDebtCount] = await Promise.all([
    db.financialCorrectionDeduction.findUnique({ where: { authorityId: authority.id },
      include: { approvedCoverage: true } }),
    db.payoutBatch.findUnique({ where: { id: authority.historicalPayoutBatchId } }),
    db.financialCorrectionBaselineClaim.findUnique({
      where: { acceptedEvidenceSnapshotId: authority.acceptedEvidenceSnapshotId },
    }),
    db.financialCorrectionBaselineClaim.count({
      where: { acceptedEvidenceSnapshotId: authority.acceptedEvidenceSnapshotId },
    }),
    db.payoutBatch.count({ where: { vendorId: authority.vendorId } }),
    db.vendorBalanceEvent.count({ where: { financialCorrectionAuthorityId: authority.id } }),
  ]);
  if (!deduction || deduction.amountMinor <= 0 || deduction.amountMinor !== authority.vendorPayableDifferenceMinor ||
      !deduction.approvedCoverage || deduction.approvedCoverage.status !== 'ACTIVE' ||
      deduction.approvedCoverage.settlementApprovalId !== authority.historicalApprovedSettlementId ||
      deduction.approvedCoverage.amountMinor !== deduction.amountMinor ||
      !payout || payout.status !== 'CANCELLED' || payout.paidAt !== null || payoutCount !== 1 ||
      !claim || claimCount !== 1 || claim.consumerType !== 'draft_payout_vendor_deduction' ||
      claim.consumerId !== authority.id || correctionDebtCount !== 0) {
    throw new Error('DRAFT deduction, coverage, baseline, no-debt, or no-replacement invariant failed.');
  }
  console.log(JSON.stringify({ authorityId: authority.id, payoutId: payout.id,
    payoutStatus: payout.status, paidAt: payout.paidAt, payoutCount,
    deductionMinor: deduction.amountMinor, coverageId: deduction.approvedCoverage.id,
    baselineClaimCount: claimCount, correctionDebtCount }));
} finally {
  await db.$disconnect();
}
