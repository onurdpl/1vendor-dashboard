import { PrismaClient } from '../../../backend/node_modules/@prisma/client/index.js';
import { upsertSeedUser } from '../../../backend/prisma/seed-user-utils.js';

const databaseUrl = process.env.DATABASE_URL?.trim();
const databaseName = databaseUrl ? new URL(databaseUrl).pathname.slice(1) : '';
if (process.env.BROWSER_SMOKE_ALLOW_LOCAL_DB !== '1' || !databaseUrl ||
    !['localhost', '127.0.0.1'].includes(new URL(databaseUrl).hostname) ||
    !/^vendor_dashboard_browser_smoke_[0-9]+_[0-9]+$/.test(databaseName)) {
  throw new Error('Review-credit fixture requires an explicitly enabled, dedicated local browser-smoke database.');
}

process.env.DATABASE_URL = databaseUrl;
const { normalizeRefundEvidence } = await import('../../../backend/src/modules/finance/refund-evidence-normalizer.service.js');
const { previewTerminalFinancialCorrection } = await import('../../../backend/src/modules/finance/financial-correction-preview.service.js');
const { getReviewPayoutFinancialCorrectionState } = await import('../../../backend/src/modules/finance/financial-correction-review-payout.service.js');
const { preparePayoutBatch, markPayoutBatchReview } = await import('../../../backend/src/modules/finance/finance.service.js');
const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

const run = 'browser-smoke-review-credit';
const ids = Object.fromEntries([
  'vendor', 'order', 'allocation', 'fulfillment', 'refundRecord', 'sale', 'refundLedger',
  'snapshot', 'review', 'incoming', 'resolved', 'origin', 'saleLine', 'refundLine',
].map((key) => [key, `${run}-${key}`]));
const shopifyOrder = `gid://shopify/Order/${run}`;
const shopifyRefund = `gid://shopify/Refund/${run}`;

function evidence(amount: string) {
  return normalizeRefundEvidence({
    sourceShopifyRefundId: shopifyRefund, sourceShopifyOrderId: shopifyOrder,
    vendorAllocationId: ids.allocation, monetaryClassification: 'MONETARY_REFUND',
    refundTotalAmount: '150.00', currency: 'TRY',
    transactions: [{ transactionGid: `gid://shopify/OrderTransaction/${run}`, kind: 'REFUND',
      status: 'SUCCESS', amount: '150.00', currency: 'TRY' }],
    refundLines: [{ sourceLineItemId: `gid://shopify/LineItem/${run}`, quantity: 1,
      subtotalAmount: amount, currency: 'TRY' }],
    historicalEconomicVendorId: ids.vendor, historicalSaleFinanceLedgerEntryId: ids.sale,
    supersededSaleLedgerIds: [],
  });
}

try {
  await db.$connect();
  if (await db.user.count() || await db.vendor.count() || await db.refundTerminalEvidenceReview.count()) {
    throw new Error('Browser-smoke fixture refuses a database that already contains users, vendors, or reviews.');
  }
  const accepted = evidence('150.00');
  const incoming = evidence('50.00');
  await db.vendor.create({ data: { id: ids.vendor, name: 'Browser Smoke Vendor' } });
  const admin = await upsertSeedUser(db, {
    email: 'admin@demo.com', name: 'Browser Smoke Admin', role: 'ADMIN', vendorIds: [ids.vendor],
  });
  await db.shopifyOrder.create({ data: { id: ids.order, sourceShopifyOrderId: shopifyOrder,
    sourceShopifyOrderNumber: `#${run}` } });
  await db.vendorAllocation.create({ data: { id: ids.allocation, sourceShopifyOrderId: ids.order,
    sourceShopifyOrderNumber: `#${run}`, originalVendorId: ids.vendor, assignedVendorId: ids.vendor,
    fulfillmentStatus: 'Fulfilled', shippingStatus: 'Delivered' } });
  await db.fulfillment.create({ data: { id: ids.fulfillment, vendorAllocationId: ids.allocation,
    fulfillmentStatus: 'Fulfilled', fulfilledAt: new Date('2026-08-01T00:00:00Z'),
    shipmentUpdatedAt: new Date('2026-08-01T00:00:00Z') } });
  await db.refundRecord.create({ data: { id: ids.refundRecord, vendorAllocationId: ids.allocation,
    sourceShopifyOrderId: shopifyOrder, sourceShopifyOrderNumber: `#${run}`,
    sourceShopifyRefundId: shopifyRefund, amount: '150.00', status: 'processed' } });
  await db.financeLedgerEntry.create({ data: { id: ids.sale, vendorAllocationId: ids.allocation,
    vendorId: ids.vendor, entryType: 'sale', amount: '1150.00',
    commissionPercentSnapshot: '0.00', commissionVatPercentSnapshot: '20.00',
    settlementStatus: 'PAYABLE', payoutStatus: 'APPROVED', settlementDelayDaysSnapshot: 0 } });
  await db.financeLedgerEntry.create({ data: { id: ids.refundLedger, vendorAllocationId: ids.allocation,
    vendorId: ids.vendor, entryType: 'refund', amount: '150.00',
    commissionPercentSnapshot: '0.00', commissionVatPercentSnapshot: '20.00',
    settlementStatus: 'PAYABLE', payoutStatus: 'APPROVED' } });
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
    evidenceSource: 'browser_smoke_review_credit', capturedAt: new Date('2026-09-01T10:00:00Z'),
  } });
  await db.refundTerminalEvidenceReview.create({ data: {
    id: ids.review, sourceShopifyRefundId: shopifyRefund, sourceShopifyOrderId: shopifyOrder,
    vendorAllocationId: ids.allocation, terminalRefundFinanceLedgerEntryId: ids.refundLedger,
    refundRecordId: ids.refundRecord, economicVendorId: ids.vendor, storedEvidenceSnapshotId: ids.snapshot,
    dedupeKey: `${run}-dedupe`, conflictCategory: 'financial_evidence_conflict',
    storedEvidenceHash: accepted.evidenceHash, incomingEvidenceHash: incoming.evidenceHash,
    conflictSummaryJson: {}, status: 'RESOLVED', resolutionOutcome: 'CORRECTION_REQUIRED',
  } });
  await db.refundTerminalConflictEvidence.create({ data: {
    id: ids.incoming, reviewId: ids.review, sourceShopifyRefundId: shopifyRefund,
    sourceShopifyOrderId: shopifyOrder, vendorAllocationId: ids.allocation,
    economicVendorId: ids.vendor, historicalSaleFinanceLedgerEntryId: ids.sale,
    supersededSaleLedgerIdsJson: [], refundTotalAmount: '150.00', currency: 'TRY',
    normalizedEvidenceJson: incoming.normalizedEvidenceJson, evidenceHash: incoming.evidenceHash,
    hashAlgorithm: incoming.hashAlgorithm, evidenceVersion: incoming.evidenceVersion,
    normalizationVersion: incoming.normalizationVersion,
  } });
  await db.refundTerminalEvidenceReviewEvent.create({ data: { id: ids.resolved, reviewId: ids.review,
    eventType: 'RESOLVED', resolutionOutcome: 'CORRECTION_REQUIRED', actorUserId: admin.id } });
  await db.settlementApproval.create({ data: {
    id: ids.origin, vendorId: ids.vendor, status: 'APPROVED', currency: 'TRY',
    grossSalesMinor: 115000, refundTotalMinor: 15000,
    commissionMinor: 0, commissionVatMinor: 0, netPayableMinor: 100000,
    sourceSnapshotJson: {}, approvedBy: admin.id, approvedAt: new Date('2026-09-01T11:00:00Z'),
    lines: { create: [
      { id: ids.saleLine, financeLedgerEntryId: ids.sale, lineType: 'SALE',
        amountMinor: 115000, commissionMinor: 0, commissionVatMinor: 0,
        payableImpactMinor: 115000, sourceSnapshotJson: {} },
      { id: ids.refundLine, financeLedgerEntryId: ids.refundLedger, lineType: 'REFUND',
        amountMinor: 15000, commissionMinor: 0, commissionVatMinor: 0,
        payableImpactMinor: -15000, sourceSnapshotJson: {} },
    ] },
  } });
  const draft = await preparePayoutBatch({ vendorId: ids.vendor }, admin.id);
  await markPayoutBatchReview(draft.id);

  const [review, preview, state, payout] = await Promise.all([
    db.refundTerminalEvidenceReview.findUniqueOrThrow({ where: { id: ids.review } }),
    previewTerminalFinancialCorrection(ids.review, db as never),
    getReviewPayoutFinancialCorrectionState(ids.review, db as never),
    db.payoutBatch.findUniqueOrThrow({ where: { id: draft.id }, include: { lines: true } }),
  ]);
  if (review.status !== 'RESOLVED' || review.resolutionOutcome !== 'CORRECTION_REQUIRED' ||
      review.economicVendorId !== ids.vendor || preview.economicDirection !== 'VENDOR_CREDIT' ||
      preview.difference.vendorPayableReversalMinor >= 0 || !state.eligible ||
      state.reviewPayout?.id !== draft.id || payout.status !== 'REVIEW' || payout.paidAt !== null ||
      payout.lines.length !== 2) {
    throw new Error('Browser-smoke REVIEW credit fixture failed canonical self-verification.');
  }
  console.log(JSON.stringify({ reviewId: ids.review, vendorId: ids.vendor,
    payoutId: draft.id, direction: preview.economicDirection, eligible: state.eligible }));
} finally {
  await db.$disconnect();
}
