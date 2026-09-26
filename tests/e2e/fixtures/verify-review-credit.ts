import { PrismaClient } from '../../../backend/node_modules/@prisma/client/index.js';

const databaseUrl = process.env.DATABASE_URL?.trim();
const target = databaseUrl ? new URL(databaseUrl) : null;
if (process.env.BROWSER_SMOKE_ALLOW_LOCAL_DB !== '1' || !target ||
    !['localhost', '127.0.0.1'].includes(target.hostname) ||
    !/^\/vendor_dashboard_browser_smoke_[0-9]+_[0-9]+$/.test(target.pathname)) {
  throw new Error('Applied-state verification requires the dedicated local browser-smoke database.');
}

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
try {
  const reviewId = 'browser-smoke-review-credit-review';
  const authority = await db.financialCorrectionAuthority.findUnique({ where: { reviewId } });
  if (!authority || authority.applicationRoute !== 'REVIEW_PAYOUT_VENDOR_CREDIT' ||
      authority.economicDirection !== 'VENDOR_CREDIT' || !authority.historicalPayoutBatchId ||
      !authority.reviewEftNotSentConfirmedAt) {
    throw new Error('Expected applied REVIEW vendor-credit authority was not found.');
  }
  const [credit, payout, payoutCount] = await Promise.all([
    db.financialCorrectionCredit.findUnique({ where: { authorityId: authority.id } }),
    db.payoutBatch.findUnique({ where: { id: authority.historicalPayoutBatchId } }),
    db.payoutBatch.count({ where: { vendorId: authority.vendorId } }),
  ]);
  if (!credit || credit.amountMinor <= 0 || !payout || payout.status !== 'CANCELLED' || payoutCount !== 1) {
    throw new Error('REVIEW credit, cancelled historical payout, or no-replacement invariant failed.');
  }
  console.log(JSON.stringify({ authorityId: authority.id, payoutId: payout.id,
    payoutStatus: payout.status, payoutCount, creditMinor: credit.amountMinor }));
} finally {
  await db.$disconnect();
}
