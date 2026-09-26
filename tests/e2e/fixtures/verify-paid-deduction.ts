import { PrismaClient } from '../../../backend/node_modules/@prisma/client/index.js';

const databaseUrl = process.env.DATABASE_URL?.trim();
const target = databaseUrl ? new URL(databaseUrl) : null;
if (process.env.BROWSER_SMOKE_ALLOW_LOCAL_DB !== '1' || !target ||
    !['localhost', '127.0.0.1'].includes(target.hostname) ||
    !/^\/vendor_dashboard_browser_smoke_[0-9]+_[0-9]+$/.test(target.pathname)) {
  throw new Error('PAID applied-state verification requires the dedicated local browser-smoke database.');
}

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
try {
  const run = 'browser-smoke-paid-deduction';
  const reviewId = `${run}-review`;
  const authorities = await db.financialCorrectionAuthority.findMany({ where: { reviewId } });
  const authority = authorities[0];
  if (authorities.length !== 1 || authority.applicationRoute !== 'PAID_VENDOR_DEBT' ||
      authority.economicDirection !== 'VENDOR_DEDUCTION' || authority.vendorPayableDifferenceMinor !== 1760 ||
      !authority.historicalPayoutBatchId || authority.historicalPayoutPaidAt?.toISOString() !== '2026-09-01T12:00:00.000Z') {
    throw new Error('Expected one applied PAID vendor-debt authority was not found.');
  }
  const [claim, claimCount, debts, creditCount, payout, payoutCount, settlement, saleLine, refundLine] = await Promise.all([
    db.financialCorrectionBaselineClaim.findUnique({
      where: { acceptedEvidenceSnapshotId: authority.acceptedEvidenceSnapshotId },
    }),
    db.financialCorrectionBaselineClaim.count({
      where: { acceptedEvidenceSnapshotId: authority.acceptedEvidenceSnapshotId },
    }),
    db.vendorBalanceEvent.findMany({ where: { financialCorrectionAuthorityId: authority.id } }),
    db.financialCorrectionCredit.count({ where: { authorityId: authority.id } }),
    db.payoutBatch.findUnique({ where: { id: authority.historicalPayoutBatchId }, include: { lines: true } }),
    db.payoutBatch.count({ where: { vendorId: authority.vendorId } }),
    db.settlementApproval.findUnique({ where: { id: `${run}-origin` } }),
    db.settlementApprovalLine.findUnique({ where: { id: `${run}-saleLine` } }),
    db.settlementApprovalLine.findUnique({ where: { id: `${run}-refundLine` } }),
  ]);
  const debt = debts[0];
  if (!claim || claimCount !== 1 || claim.consumerType !== 'paid_vendor_debt' || claim.consumerId !== authority.id ||
      debts.length !== 1 || debt.type !== 'VENDOR_DEBT_CREATED' || debt.sourceType !== 'financial_correction' ||
      debt.sourceId !== authority.id || debt.vendorId !== authority.vendorId || debt.currency !== 'TRY' ||
      debt.amountMinor !== -authority.vendorPayableDifferenceMinor || creditCount !== 0 ||
      !payout || payout.status !== 'PAID' || payout.paidAt?.toISOString() !== '2026-09-01T12:00:00.000Z' ||
      payout.grossAmount.toString() !== '200' || payout.commissionAmount.toString() !== '30' ||
      payout.commissionVatAmount.toString() !== '6' || payout.netAmount.toString() !== '88' ||
      payout.paymentReference !== 'browser-smoke-local-paid-evidence' || payoutCount !== 1 ||
      payout.lines.length !== 2 || !payout.lines.some((line) =>
        line.financeLedgerEntryId === `${run}-sale` && line.settlementApprovalLineId === `${run}-saleLine`) ||
      !settlement || settlement.status !== 'APPROVED' || settlement.vendorId !== authority.vendorId ||
      settlement.approvedAt?.toISOString() !== '2026-09-01T11:00:00.000Z' ||
      settlement.grossSalesMinor !== 20000 || settlement.refundTotalMinor !== 10000 ||
      settlement.commissionMinor !== 1000 || settlement.commissionVatMinor !== 200 ||
      settlement.netPayableMinor !== 8800 ||
      !saleLine || saleLine.financeLedgerEntryId !== `${run}-sale` || saleLine.payableImpactMinor !== 17600 ||
      !refundLine || refundLine.financeLedgerEntryId !== `${run}-refundLedger` || refundLine.payableImpactMinor !== -8800) {
    throw new Error('PAID payout terminality, additive debt, baseline, or settlement immutability failed.');
  }
  console.log(JSON.stringify({ authorityId: authority.id, route: authority.applicationRoute,
    payoutId: payout.id, payoutStatus: payout.status, paidAt: payout.paidAt,
    payoutCount, baselineClaimCount: claimCount, correctionDebtCount: debts.length,
    correctionDebtMinor: debt.amountMinor, creditCount, settlementStatus: settlement.status,
    payoutGross: payout.grossAmount.toString(), payoutCommission: payout.commissionAmount.toString(),
    payoutCommissionVat: payout.commissionVatAmount.toString(), payoutNet: payout.netAmount.toString() }));
} finally {
  await db.$disconnect();
}
