import { PrismaClient } from '../../../backend/node_modules/@prisma/client/index.js';
import { upsertSeedUser } from '../../../backend/prisma/seed-user-utils.js';

const databaseUrl = process.env.DATABASE_URL?.trim();
const target = databaseUrl ? new URL(databaseUrl) : null;
if (process.env.BROWSER_SMOKE_ALLOW_LOCAL_DB !== '1' || !target ||
    !['localhost', '127.0.0.1'].includes(target.hostname) ||
    !/^\/vendor_dashboard_browser_smoke_[0-9]+_[0-9]+$/.test(target.pathname)) {
  throw new Error('Zero-net fixture requires an explicitly enabled, dedicated local browser-smoke database.');
}

process.env.DATABASE_URL = databaseUrl;
const { normalizeRefundEvidence } = await import('../../../backend/src/modules/finance/refund-evidence-normalizer.service.js');
const { previewTerminalFinancialCorrection } = await import('../../../backend/src/modules/finance/financial-correction-preview.service.js');
const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

const run = 'browser-smoke-zero-net';
const ids = Object.fromEntries([
  'vendor', 'order', 'allocation', 'refundRecord', 'sale', 'refundLedger', 'snapshot', 'review', 'incoming', 'resolved',
].map((key) => [key, `${run}-${key}`]));
const shopifyOrder = `gid://shopify/Order/${run}`;
const shopifyRefund = `gid://shopify/Refund/${run}`;
const historicalAt = new Date('2026-09-01T10:00:00.000Z');

function evidence(amount: string) {
  return normalizeRefundEvidence({
    sourceShopifyRefundId: shopifyRefund, sourceShopifyOrderId: shopifyOrder,
    vendorAllocationId: ids.allocation, monetaryClassification: 'MONETARY_REFUND',
    refundTotalAmount: '150.00', currency: 'TRY',
    transactions: [{ transactionGid: `gid://shopify/OrderTransaction/${run}`,
      kind: 'REFUND', status: 'SUCCESS', amount: '150.00', currency: 'TRY' }],
    refundLines: [{ sourceLineItemId: `gid://shopify/LineItem/${run}`,
      quantity: 2, subtotalAmount: amount, currency: 'TRY' }],
    historicalEconomicVendorId: ids.vendor, historicalSaleFinanceLedgerEntryId: ids.sale,
    supersededSaleLedgerIds: [],
  });
}

try {
  await db.$connect();
  if (await db.user.count() || await db.vendor.count() || await db.refundTerminalEvidenceReview.count()) {
    throw new Error('Browser-smoke fixture refuses a database that already contains users, vendors, or reviews.');
  }
  const accepted = evidence('100.00');
  const incoming = evidence('120.00');
  await db.vendor.create({ data: { id: ids.vendor, name: 'Browser Smoke Vendor' } });
  const admin = await upsertSeedUser(db, {
    email: 'admin@demo.com', name: 'Browser Smoke Admin', role: 'ADMIN', vendorIds: [ids.vendor],
  });
  await db.shopifyOrder.create({ data: { id: ids.order, sourceShopifyOrderId: shopifyOrder,
    sourceShopifyOrderNumber: `#${run}` } });
  await db.vendorAllocation.create({ data: { id: ids.allocation,
    sourceShopifyOrderId: ids.order, sourceShopifyOrderNumber: `#${run}`,
    originalVendorId: ids.vendor, assignedVendorId: ids.vendor } });
  await db.refundRecord.create({ data: { id: ids.refundRecord,
    vendorAllocationId: ids.allocation, sourceShopifyOrderId: shopifyOrder,
    sourceShopifyOrderNumber: `#${run}`, sourceShopifyRefundId: shopifyRefund,
    amount: '100.00', status: 'processed' } });
  await db.financeLedgerEntry.create({ data: { id: ids.sale,
    vendorAllocationId: ids.allocation, vendorId: ids.vendor, entryType: 'sale', amount: '200.00',
    commissionPercentSnapshot: '100.00', commissionVatPercentSnapshot: '0.00',
    createdAt: historicalAt, updatedAt: historicalAt } });
  await db.financeLedgerEntry.create({ data: { id: ids.refundLedger,
    vendorAllocationId: ids.allocation, vendorId: ids.vendor, entryType: 'refund', amount: '100.00',
    commissionPercentSnapshot: '100.00', commissionVatPercentSnapshot: '0.00',
    createdAt: historicalAt, updatedAt: historicalAt } });
  await db.refundEvidenceSnapshot.create({ data: {
    id: ids.snapshot, sourceShopifyRefundId: shopifyRefund, sourceShopifyOrderId: shopifyOrder,
    vendorAllocationId: ids.allocation, refundRecordId: ids.refundRecord,
    refundFinanceLedgerEntryId: ids.refundLedger, historicalEconomicVendorId: ids.vendor,
    historicalSaleFinanceLedgerEntryId: ids.sale, monetaryClassification: 'MONETARY_REFUND',
    refundTotalAmount: '150.00', currency: 'TRY',
    normalizedTransactionsJson: accepted.normalizedTransactionsJson,
    normalizedRefundLinesJson: accepted.normalizedRefundLinesJson,
    normalizedOwnershipJson: accepted.normalizedOwnershipJson,
    normalizedEvidenceJson: accepted.normalizedEvidenceJson, supersededSaleLedgerIdsJson: [],
    evidenceHash: accepted.evidenceHash, hashAlgorithm: accepted.hashAlgorithm,
    evidenceVersion: accepted.evidenceVersion, normalizationVersion: accepted.normalizationVersion,
    evidenceSource: 'browser_smoke_zero_net', capturedAt: historicalAt, createdAt: historicalAt,
  } });
  await db.refundTerminalEvidenceReview.create({ data: {
    id: ids.review, sourceShopifyRefundId: shopifyRefund, sourceShopifyOrderId: shopifyOrder,
    vendorAllocationId: ids.allocation, terminalRefundFinanceLedgerEntryId: ids.refundLedger,
    refundRecordId: ids.refundRecord, economicVendorId: ids.vendor,
    storedEvidenceSnapshotId: ids.snapshot, dedupeKey: `${run}-dedupe`,
    conflictCategory: 'financial_evidence_conflict', storedEvidenceHash: accepted.evidenceHash,
    incomingEvidenceHash: incoming.evidenceHash, conflictSummaryJson: {},
    status: 'RESOLVED', resolutionOutcome: 'CORRECTION_REQUIRED',
  } });
  await db.refundTerminalConflictEvidence.create({ data: {
    id: ids.incoming, reviewId: ids.review, sourceShopifyRefundId: shopifyRefund,
    sourceShopifyOrderId: shopifyOrder, vendorAllocationId: ids.allocation,
    economicVendorId: ids.vendor, historicalSaleFinanceLedgerEntryId: ids.sale,
    supersededSaleLedgerIdsJson: [], refundTotalAmount: '150.00', currency: 'TRY',
    normalizedEvidenceJson: incoming.normalizedEvidenceJson, evidenceHash: incoming.evidenceHash,
    hashAlgorithm: incoming.hashAlgorithm, evidenceVersion: incoming.evidenceVersion,
    normalizationVersion: incoming.normalizationVersion, createdAt: historicalAt,
  } });
  await db.refundTerminalEvidenceReviewEvent.create({ data: { id: ids.resolved,
    reviewId: ids.review, eventType: 'RESOLVED', resolutionOutcome: 'CORRECTION_REQUIRED',
    actorUserId: admin.id } });

  const [review, preview, acknowledgements, claims, authority, credit, deduction, balance, payout, settlement] = await Promise.all([
    db.refundTerminalEvidenceReview.findUniqueOrThrow({ where: { id: ids.review } }),
    previewTerminalFinancialCorrection(ids.review, db as never),
    db.financialCorrectionZeroNetAcknowledgement.count({ where: { reviewId: ids.review } }),
    db.financialCorrectionBaselineClaim.count({ where: { acceptedEvidenceSnapshotId: ids.snapshot } }),
    db.financialCorrectionAuthority.count({ where: { reviewId: ids.review } }),
    db.financialCorrectionCredit.count(), db.financialCorrectionDeduction.count(),
    db.vendorBalanceEvent.count({ where: { vendorId: ids.vendor } }),
    db.payoutBatch.count({ where: { vendorId: ids.vendor } }),
    db.settlementApproval.count({ where: { vendorId: ids.vendor } }),
  ]);
  if (review.status !== 'RESOLVED' || review.resolutionOutcome !== 'CORRECTION_REQUIRED' ||
      review.economicVendorId !== ids.vendor || review.vendorAllocationId !== ids.allocation ||
      preview.reviewId !== ids.review || preview.vendorId !== ids.vendor ||
      preview.vendorAllocationId !== ids.allocation || preview.currency !== 'TRY' ||
      preview.economicDirection !== 'NONE' || preview.difference.vendorPayableReversalMinor !== 0 ||
      preview.difference.refundAmountMinor !== 2000 || preview.difference.commissionReversalMinor !== 2000 ||
      acknowledgements !== 0 || claims !== 0 || authority !== 0 || credit !== 0 || deduction !== 0 ||
      balance !== 0 || payout !== 0 || settlement !== 0) {
    throw new Error('Browser-smoke zero-net fixture failed canonical self-verification.');
  }
  console.log(JSON.stringify({ reviewId: ids.review, vendorId: ids.vendor,
    direction: preview.economicDirection, currency: preview.currency,
    vendorPayableDifferenceMinor: preview.difference.vendorPayableReversalMinor,
    refundDifferenceMinor: preview.difference.refundAmountMinor, acknowledged: acknowledgements,
    baselineClaims: claims, monetaryAuthority: authority, payout, settlement }));
} finally {
  await db.$disconnect();
}
