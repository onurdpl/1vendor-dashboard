import { isDeepStrictEqual } from 'node:util';
import { PrismaClient } from '../../../backend/node_modules/@prisma/client/index.js';
import { normalizeRefundEvidence } from '../../../backend/src/modules/finance/refund-evidence-normalizer.service.js';

const databaseUrl = process.env.DATABASE_URL?.trim();
const target = databaseUrl ? new URL(databaseUrl) : null;
if (process.env.BROWSER_SMOKE_ALLOW_LOCAL_DB !== '1' || !target ||
    !['localhost', '127.0.0.1'].includes(target.hostname) ||
    !/^\/vendor_dashboard_browser_smoke_[0-9]+_[0-9]+$/.test(target.pathname)) {
  throw new Error('Zero-net post-check requires the dedicated local browser-smoke database.');
}

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const run = 'browser-smoke-zero-net';
const id = (suffix: string) => `${run}-${suffix}`;
const shopifyOrder = `gid://shopify/Order/${run}`;
const shopifyRefund = `gid://shopify/Refund/${run}`;
const historicalAt = '2026-09-01T10:00:00.000Z';

function evidence(amount: string) {
  return normalizeRefundEvidence({
    sourceShopifyRefundId: shopifyRefund, sourceShopifyOrderId: shopifyOrder,
    vendorAllocationId: id('allocation'), monetaryClassification: 'MONETARY_REFUND',
    refundTotalAmount: '150.00', currency: 'TRY',
    transactions: [{ transactionGid: `gid://shopify/OrderTransaction/${run}`,
      kind: 'REFUND', status: 'SUCCESS', amount: '150.00', currency: 'TRY' }],
    refundLines: [{ sourceLineItemId: `gid://shopify/LineItem/${run}`,
      quantity: 2, subtotalAmount: amount, currency: 'TRY' }],
    historicalEconomicVendorId: id('vendor'), historicalSaleFinanceLedgerEntryId: id('sale'),
    supersededSaleLedgerIds: [],
  });
}

try {
  const [acknowledgements, claims, actor, authority, balance, credit, deduction,
    creditSettlement, creditPayout, deductionSettlement, deductionPayout,
    approvedDeductionCoverage, approvedDeductionPayout, ledgers, payout, settlement,
    snapshot, incoming, review, resolvedEvent] = await Promise.all([
    db.financialCorrectionZeroNetAcknowledgement.findMany({ where: { reviewId: id('review') } }),
    db.financialCorrectionBaselineClaim.findMany({ where: { acceptedEvidenceSnapshotId: id('snapshot') } }),
    db.user.findUnique({ where: { email: 'admin@demo.com' } }),
    db.financialCorrectionAuthority.count(),
    db.vendorBalanceEvent.count({ where: { vendorId: id('vendor') } }),
    db.financialCorrectionCredit.count(), db.financialCorrectionDeduction.count(),
    db.financialCorrectionCreditSettlementLine.count(), db.financialCorrectionCreditPayoutLine.count(),
    db.financialCorrectionDeductionSettlementLine.count(), db.financialCorrectionDeductionPayoutLine.count(),
    db.financialCorrectionApprovedDeductionCoverage.count(), db.financialCorrectionApprovedDeductionPayoutLine.count(),
    db.financeLedgerEntry.findMany({ where: { vendorAllocationId: id('allocation') }, orderBy: { id: 'asc' } }),
    db.payoutBatch.count({ where: { vendorId: id('vendor') } }),
    db.settlementApproval.count({ where: { vendorId: id('vendor') } }),
    db.refundEvidenceSnapshot.findUnique({ where: { id: id('snapshot') } }),
    db.refundTerminalConflictEvidence.findUnique({ where: { id: id('incoming') } }),
    db.refundTerminalEvidenceReview.findUnique({ where: { id: id('review') } }),
    db.refundTerminalEvidenceReviewEvent.findUnique({ where: { id: id('resolved') } }),
  ]);
  const acknowledgement = acknowledgements[0];
  const claim = claims[0];
  const accepted = evidence('100.00');
  const corrected = evidence('120.00');
  if (acknowledgements.length !== 1 || claims.length !== 1 || !actor ||
      acknowledgement.reviewId !== id('review') ||
      acknowledgement.resolvedReviewEventId !== id('resolved') ||
      acknowledgement.acceptedEvidenceSnapshotId !== id('snapshot') ||
      acknowledgement.incomingConflictEvidenceId !== id('incoming') ||
      acknowledgement.acknowledgedByUserId !== actor.id ||
      acknowledgement.economicDirection !== 'NONE' ||
      acknowledgement.vendorPayableDifferenceMinor !== 0 ||
      acknowledgement.currency !== 'TRY' || acknowledgement.note !== null ||
      acknowledgement.acceptedRefundAmountMinor !== 10000 ||
      acknowledgement.correctedRefundAmountMinor !== 12000 ||
      acknowledgement.refundDifferenceMinor !== 2000 ||
      acknowledgement.commissionDifferenceMinor !== 2000 ||
      !/^financial-correction-preview-v1:[a-f0-9]{64}$/.test(acknowledgement.previewFingerprint) ||
      claim.consumerType !== 'zero_net_acknowledgement' || claim.consumerId !== acknowledgement.id ||
      authority !== 0 || balance !== 0 || credit !== 0 || deduction !== 0 ||
      creditSettlement !== 0 || creditPayout !== 0 || deductionSettlement !== 0 ||
      deductionPayout !== 0 || approvedDeductionCoverage !== 0 || approvedDeductionPayout !== 0 ||
      payout !== 0 || settlement !== 0 || ledgers.length !== 2 ||
      !snapshot || snapshot.evidenceHash !== accepted.evidenceHash ||
      snapshot.createdAt.toISOString() !== historicalAt || snapshot.capturedAt.toISOString() !== historicalAt ||
      !isDeepStrictEqual(snapshot.normalizedEvidenceJson, accepted.normalizedEvidenceJson) ||
      !isDeepStrictEqual(snapshot.normalizedTransactionsJson, accepted.normalizedTransactionsJson) ||
      !isDeepStrictEqual(snapshot.normalizedRefundLinesJson, accepted.normalizedRefundLinesJson) ||
      !isDeepStrictEqual(snapshot.normalizedOwnershipJson, accepted.normalizedOwnershipJson) ||
      !incoming || incoming.evidenceHash !== corrected.evidenceHash ||
      incoming.createdAt.toISOString() !== historicalAt ||
      !isDeepStrictEqual(incoming.normalizedEvidenceJson, corrected.normalizedEvidenceJson) ||
      !review || review.status !== 'RESOLVED' || review.resolutionOutcome !== 'CORRECTION_REQUIRED' ||
      review.storedEvidenceHash !== accepted.evidenceHash || review.incomingEvidenceHash !== corrected.evidenceHash ||
      !resolvedEvent || resolvedEvent.eventType !== 'RESOLVED' ||
      resolvedEvent.resolutionOutcome !== 'CORRECTION_REQUIRED') {
    throw new Error('Zero-net acknowledgement, baseline, historical evidence, or zero-money invariant failed.');
  }
  for (const [ledgerId, entryType, amount] of [
    [id('sale'), 'sale', '200'], [id('refundLedger'), 'refund', '100'],
  ]) {
    const ledger = ledgers.find((row) => row.id === ledgerId);
    if (!ledger || ledger.entryType !== entryType || ledger.amount.toString() !== amount ||
        ledger.vendorId !== id('vendor') || ledger.vendorAllocationId !== id('allocation') ||
        ledger.commissionPercentSnapshot?.toString() !== '100' ||
        ledger.commissionVatPercentSnapshot?.toString() !== '0' ||
        ledger.createdAt.toISOString() !== historicalAt || ledger.updatedAt.toISOString() !== historicalAt ||
        ledger.voidedAt !== null || ledger.supersededByLedgerId !== null) {
      throw new Error('Zero-net acknowledgement changed original SALE or REFUND ledger authority.');
    }
  }
  console.log(JSON.stringify({ reviewId: id('review'), acknowledgementCount: acknowledgements.length,
    baselineClaimCount: claims.length, baselineConsumerType: claim.consumerType,
    monetaryAuthorityCount: authority, creditCount: credit, deductionCount: deduction,
    correctionDebtCount: balance, correctionSettlementEffectCount: creditSettlement + deductionSettlement + approvedDeductionCoverage,
    correctionPayoutEffectCount: creditPayout + deductionPayout + approvedDeductionPayout,
    ledgerCount: ledgers.length, payoutCount: payout, settlementCount: settlement,
    historicalEvidenceUnchanged: true }));
} finally {
  await db.$disconnect();
}
