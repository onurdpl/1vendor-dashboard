import { isDeepStrictEqual } from 'node:util';
import { PrismaClient } from '../../../backend/node_modules/@prisma/client/index.js';

const databaseUrl = process.env.DATABASE_URL?.trim();
const target = databaseUrl ? new URL(databaseUrl) : null;
if (process.env.BROWSER_SMOKE_ALLOW_LOCAL_DB !== '1' || !target ||
    !['localhost', '127.0.0.1'].includes(target.hostname) ||
    !/^\/vendor_dashboard_browser_smoke_[0-9]+_[0-9]+$/.test(target.pathname)) {
  throw new Error('Approved/no-payout post-check requires the dedicated local browser-smoke database.');
}

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const run = 'browser-smoke-approved-no-payout-deduction';
const id = (suffix: string) => `${run}-${suffix}`;
const approvedAt = '2026-09-01T11:00:00.000Z';

try {
  const [authorities, claims, approval, payouts, credits, vendorBalanceEvents,
    creditSettlementLines, deductionSettlementLines, deductionPayoutLines,
    approvedDeductionPayoutLines] = await Promise.all([
    db.financialCorrectionAuthority.findMany({ where: { reviewId: id('review') } }),
    db.financialCorrectionBaselineClaim.findMany({ where: { acceptedEvidenceSnapshotId: id('snapshot') } }),
    db.settlementApproval.findUnique({ where: { id: id('origin') },
      include: { lines: { include: { payoutBatchLines: true } } } }),
    db.payoutBatch.count({ where: { vendorId: id('vendor') } }),
    db.financialCorrectionCredit.count({ where: { vendorId: id('vendor') } }),
    db.vendorBalanceEvent.count({ where: { vendorId: id('vendor') } }),
    db.financialCorrectionCreditSettlementLine.count(),
    db.financialCorrectionDeductionSettlementLine.count(),
    db.financialCorrectionDeductionPayoutLine.count(),
    db.financialCorrectionApprovedDeductionPayoutLine.count(),
  ]);
  const authority = authorities[0];
  const claim = claims[0];
  if (authorities.length !== 1 || !authority ||
      authority.applicationRoute !== 'APPROVED_SETTLEMENT_VENDOR_DEDUCTION' ||
      authority.economicDirection !== 'VENDOR_DEDUCTION' || authority.currency !== 'TRY' ||
      authority.reviewId !== id('review') || authority.acceptedEvidenceSnapshotId !== id('snapshot') ||
      authority.historicalApprovedSettlementId !== id('origin') ||
      authority.historicalApprovedSettlementAt?.toISOString() !== approvedAt ||
      authority.historicalApprovedSettlementNetMinor !== 100000 ||
      authority.historicalPayoutBatchId !== null || authority.historicalPayoutPaidAt !== null ||
      authority.vendorPayableDifferenceMinor !== 10000 ||
      claims.length !== 1 || !claim || claim.consumerType !== 'approved_settlement_vendor_deduction' ||
      claim.consumerId !== authority.id || claim.acceptedEvidenceSnapshotId !== id('snapshot') ||
      payouts !== 0 || credits !== 0 || vendorBalanceEvents !== 0 ||
      creditSettlementLines !== 0 || deductionSettlementLines !== 0 ||
      deductionPayoutLines !== 0 || approvedDeductionPayoutLines !== 0) {
    throw new Error('Approved/no-payout correction authority, baseline, or zero-payout/debt invariant failed.');
  }

  const [deductions, coverages, actor] = await Promise.all([
    db.financialCorrectionDeduction.findMany({ where: { authorityId: authority.id } }),
    db.financialCorrectionApprovedDeductionCoverage.findMany({ where: { settlementApprovalId: id('origin') } }),
    db.user.findUnique({ where: { email: 'admin@demo.com' } }),
  ]);
  const deduction = deductions[0];
  const coverage = coverages[0];
  if (deductions.length !== 1 || !deduction || deduction.vendorId !== id('vendor') ||
      deduction.amountMinor !== 10000 || deduction.currency !== 'TRY' ||
      coverages.length !== 1 || !coverage || coverage.deductionId !== deduction.id ||
      coverage.settlementApprovalId !== id('origin') || coverage.vendorId !== id('vendor') ||
      coverage.amountMinor !== 10000 || coverage.currency !== 'TRY' || coverage.status !== 'ACTIVE' ||
      coverage.releasedAt !== null || !actor || authority.authorizedByUserId !== actor.id) {
    throw new Error('Approved/no-payout deduction or reserved coverage linkage failed.');
  }

  const expectedLines = [
    { id: id('refundLine'), settlementApprovalId: id('origin'), financeLedgerEntryId: id('refundLedger'),
      settlementRefundAdjustmentId: null, settlementRefundAdjustmentApplicationId: null,
      lineType: 'REFUND', amountMinor: 5000, commissionMinor: 0, commissionVatMinor: 0,
      payableImpactMinor: -5000, sourceSnapshotJson: {} },
    { id: id('saleLine'), settlementApprovalId: id('origin'), financeLedgerEntryId: id('sale'),
      settlementRefundAdjustmentId: null, settlementRefundAdjustmentApplicationId: null,
      lineType: 'SALE', amountMinor: 105000, commissionMinor: 0, commissionVatMinor: 0,
      payableImpactMinor: 105000, sourceSnapshotJson: {} },
  ];
  const actualLines = approval?.lines.map(({ payoutBatchLines, ...line }) => line)
    .sort((left, right) => left.id.localeCompare(right.id));
  if (!approval || approval.vendorId !== id('vendor') || approval.status !== 'APPROVED' ||
      approval.currency !== 'TRY' || approval.approvedAt?.toISOString() !== approvedAt ||
      approval.createdAt.toISOString() !== approvedAt || approval.updatedAt.toISOString() !== approvedAt ||
      approval.approvedBy !== actor.id || approval.cancelledAt !== null || approval.cancelledBy !== null ||
      approval.grossSalesMinor !== 105000 || approval.refundTotalMinor !== 5000 ||
      approval.commissionMinor !== 0 || approval.commissionVatMinor !== 0 ||
      approval.netPayableMinor !== 100000 || approval.correctionCreditMinor !== 0 ||
      approval.correctionDeductionMinor !== 0 || !isDeepStrictEqual(approval.sourceSnapshotJson, {}) ||
      !isDeepStrictEqual(actualLines, expectedLines) ||
      approval.lines.some((line) => line.payoutBatchLines.length !== 0)) {
    throw new Error('APPROVED SETTLEMENT IMMUTABILITY DEFECT: original approval or lines changed.');
  }

  console.log(JSON.stringify({ authorityId: authority.id, route: authority.applicationRoute,
    baselineClaimCount: claims.length, deductionCount: deductions.length,
    coverageCount: coverages.length, coverageStatus: coverage.status,
    coverageSettlementId: coverage.settlementApprovalId, coverageMinor: coverage.amountMinor,
    settlementStatusBefore: 'APPROVED', settlementStatusAfter: approval.status,
    approvedAtBefore: approvedAt, approvedAtAfter: approval.approvedAt?.toISOString(),
    settlementLinesUnchanged: true, vendorBalanceDebtCount: vendorBalanceEvents,
    creditCount: credits, payoutCountBefore: 0, payoutCountAfter: payouts }));
} finally {
  await db.$disconnect();
}
