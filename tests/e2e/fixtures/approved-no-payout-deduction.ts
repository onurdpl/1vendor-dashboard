import { PrismaClient } from '../../../backend/node_modules/@prisma/client/index.js';
import { upsertSeedUser } from '../../../backend/prisma/seed-user-utils.js';

const databaseUrl = process.env.DATABASE_URL?.trim();
const target = databaseUrl ? new URL(databaseUrl) : null;
if (process.env.BROWSER_SMOKE_ALLOW_LOCAL_DB !== '1' || !target ||
    !['localhost', '127.0.0.1'].includes(target.hostname) ||
    !/^\/vendor_dashboard_browser_smoke_[0-9]+_[0-9]+$/.test(target.pathname)) {
  throw new Error('Approved/no-payout deduction fixture requires a dedicated local browser-smoke database.');
}

process.env.DATABASE_URL = databaseUrl;
const { normalizeRefundEvidence } = await import('../../../backend/src/modules/finance/refund-evidence-normalizer.service.js');
const { previewTerminalFinancialCorrection } = await import('../../../backend/src/modules/finance/financial-correction-preview.service.js');
const { getApprovedSettlementFinancialCorrectionDeductionState } = await import('../../../backend/src/modules/finance/financial-correction-approved-settlement-deduction.service.js');
const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

const run = 'browser-smoke-approved-no-payout-deduction';
const id = (suffix: string) => `${run}-${suffix}`;
const shopifyOrder = `gid://shopify/Order/${run}`;
const shopifyRefund = `gid://shopify/Refund/${run}`;
const approvedAt = new Date('2026-09-01T11:00:00.000Z');

function evidence(amount: string) {
  return normalizeRefundEvidence({
    sourceShopifyRefundId: shopifyRefund, sourceShopifyOrderId: shopifyOrder,
    vendorAllocationId: id('allocation'), monetaryClassification: 'MONETARY_REFUND',
    refundTotalAmount: '150.00', currency: 'TRY',
    transactions: [{ transactionGid: `gid://shopify/OrderTransaction/${run}`, kind: 'REFUND',
      status: 'SUCCESS', amount: '150.00', currency: 'TRY' }],
    refundLines: [{ sourceLineItemId: `gid://shopify/LineItem/${run}`, quantity: 1,
      subtotalAmount: amount, currency: 'TRY' }],
    historicalEconomicVendorId: id('vendor'), historicalSaleFinanceLedgerEntryId: id('sale'),
    supersededSaleLedgerIds: [],
  });
}

try {
  await db.$connect();
  if (await db.user.count() || await db.vendor.count() || await db.refundTerminalEvidenceReview.count()) {
    throw new Error('Browser-smoke fixture refuses a database that already contains users, vendors, or reviews.');
  }
  const accepted = evidence('50.00');
  const incoming = evidence('150.00');
  await db.vendor.create({ data: { id: id('vendor'), name: 'Browser Smoke Vendor' } });
  const admin = await upsertSeedUser(db, {
    email: 'admin@demo.com', name: 'Browser Smoke Admin', role: 'ADMIN', vendorIds: [id('vendor')],
  });
  await db.shopifyOrder.create({ data: { id: id('order'), sourceShopifyOrderId: shopifyOrder,
    sourceShopifyOrderNumber: `#${run}` } });
  await db.vendorAllocation.create({ data: { id: id('allocation'), sourceShopifyOrderId: id('order'),
    sourceShopifyOrderNumber: `#${run}`, originalVendorId: id('vendor'), assignedVendorId: id('vendor'),
    fulfillmentStatus: 'Fulfilled', shippingStatus: 'Delivered' } });
  await db.fulfillment.create({ data: { id: id('fulfillment'), vendorAllocationId: id('allocation'),
    fulfillmentStatus: 'Fulfilled', fulfilledAt: new Date('2026-08-01T00:00:00.000Z'),
    shipmentUpdatedAt: new Date('2026-08-01T00:00:00.000Z') } });
  await db.refundRecord.create({ data: { id: id('refundRecord'), vendorAllocationId: id('allocation'),
    sourceShopifyOrderId: shopifyOrder, sourceShopifyOrderNumber: `#${run}`,
    sourceShopifyRefundId: shopifyRefund, amount: '50.00', status: 'processed' } });
  await db.financeLedgerEntry.create({ data: { id: id('sale'), vendorAllocationId: id('allocation'),
    vendorId: id('vendor'), entryType: 'sale', amount: '1050.00',
    commissionPercentSnapshot: '0.00', commissionVatPercentSnapshot: '20.00',
    settlementStatus: 'PAYABLE', payoutStatus: 'APPROVED', settlementDelayDaysSnapshot: 0 } });
  await db.financeLedgerEntry.create({ data: { id: id('refundLedger'), vendorAllocationId: id('allocation'),
    vendorId: id('vendor'), entryType: 'refund', amount: '50.00',
    commissionPercentSnapshot: '0.00', commissionVatPercentSnapshot: '20.00',
    settlementStatus: 'PAYABLE', payoutStatus: 'APPROVED' } });
  await db.refundEvidenceSnapshot.create({ data: {
    id: id('snapshot'), sourceShopifyRefundId: shopifyRefund, sourceShopifyOrderId: shopifyOrder,
    vendorAllocationId: id('allocation'), refundRecordId: id('refundRecord'),
    refundFinanceLedgerEntryId: id('refundLedger'), historicalEconomicVendorId: id('vendor'),
    historicalSaleFinanceLedgerEntryId: id('sale'), monetaryClassification: 'MONETARY_REFUND',
    refundTotalAmount: '150.00', currency: 'TRY',
    normalizedTransactionsJson: accepted.normalizedTransactionsJson,
    normalizedRefundLinesJson: accepted.normalizedRefundLinesJson,
    normalizedOwnershipJson: accepted.normalizedOwnershipJson,
    normalizedEvidenceJson: accepted.normalizedEvidenceJson, supersededSaleLedgerIdsJson: [],
    evidenceHash: accepted.evidenceHash, hashAlgorithm: accepted.hashAlgorithm,
    evidenceVersion: accepted.evidenceVersion, normalizationVersion: accepted.normalizationVersion,
    evidenceSource: 'browser_smoke_approved_no_payout_deduction',
    capturedAt: new Date('2026-09-01T10:00:00.000Z'),
  } });
  await db.refundTerminalEvidenceReview.create({ data: {
    id: id('review'), sourceShopifyRefundId: shopifyRefund, sourceShopifyOrderId: shopifyOrder,
    vendorAllocationId: id('allocation'), terminalRefundFinanceLedgerEntryId: id('refundLedger'),
    refundRecordId: id('refundRecord'), economicVendorId: id('vendor'),
    storedEvidenceSnapshotId: id('snapshot'), dedupeKey: `${run}-dedupe`,
    conflictCategory: 'financial_evidence_conflict', storedEvidenceHash: accepted.evidenceHash,
    incomingEvidenceHash: incoming.evidenceHash, conflictSummaryJson: {},
    status: 'RESOLVED', resolutionOutcome: 'CORRECTION_REQUIRED',
  } });
  await db.refundTerminalConflictEvidence.create({ data: {
    id: id('incoming'), reviewId: id('review'), sourceShopifyRefundId: shopifyRefund,
    sourceShopifyOrderId: shopifyOrder, vendorAllocationId: id('allocation'),
    economicVendorId: id('vendor'), historicalSaleFinanceLedgerEntryId: id('sale'),
    supersededSaleLedgerIdsJson: [], refundTotalAmount: '150.00', currency: 'TRY',
    normalizedEvidenceJson: incoming.normalizedEvidenceJson, evidenceHash: incoming.evidenceHash,
    hashAlgorithm: incoming.hashAlgorithm, evidenceVersion: incoming.evidenceVersion,
    normalizationVersion: incoming.normalizationVersion,
  } });
  await db.refundTerminalEvidenceReviewEvent.create({ data: { id: id('resolved'), reviewId: id('review'),
    eventType: 'RESOLVED', resolutionOutcome: 'CORRECTION_REQUIRED', actorUserId: admin.id } });
  await db.settlementApproval.create({ data: {
    id: id('origin'), vendorId: id('vendor'), status: 'APPROVED', currency: 'TRY',
    grossSalesMinor: 105000, refundTotalMinor: 5000, commissionMinor: 0, commissionVatMinor: 0,
    netPayableMinor: 100000, sourceSnapshotJson: {}, approvedBy: admin.id,
    approvedAt, createdAt: approvedAt, updatedAt: approvedAt,
    lines: { create: [
      { id: id('saleLine'), financeLedgerEntryId: id('sale'), lineType: 'SALE',
        amountMinor: 105000, commissionMinor: 0, commissionVatMinor: 0,
        payableImpactMinor: 105000, sourceSnapshotJson: {} },
      { id: id('refundLine'), financeLedgerEntryId: id('refundLedger'), lineType: 'REFUND',
        amountMinor: 5000, commissionMinor: 0, commissionVatMinor: 0,
        payableImpactMinor: -5000, sourceSnapshotJson: {} },
    ] },
  } });

  const [review, preview, state, approval, payoutCount, authorityCount, claimCount,
    deductionCount, coverageCount, correctionDebtCount] = await Promise.all([
    db.refundTerminalEvidenceReview.findUniqueOrThrow({ where: { id: id('review') } }),
    previewTerminalFinancialCorrection(id('review'), db as never),
    getApprovedSettlementFinancialCorrectionDeductionState(id('review'), db as never),
    db.settlementApproval.findUniqueOrThrow({ where: { id: id('origin') },
      include: { lines: { include: { payoutBatchLines: true } } } }),
    db.payoutBatch.count({ where: { vendorId: id('vendor') } }),
    db.financialCorrectionAuthority.count({ where: { reviewId: id('review') } }),
    db.financialCorrectionBaselineClaim.count({ where: { acceptedEvidenceSnapshotId: id('snapshot') } }),
    db.financialCorrectionDeduction.count(), db.financialCorrectionApprovedDeductionCoverage.count(),
    db.vendorBalanceEvent.count({ where: { vendorId: id('vendor') } }),
  ]);
  if (review.status !== 'RESOLVED' || review.resolutionOutcome !== 'CORRECTION_REQUIRED' ||
      review.economicVendorId !== id('vendor') || preview.vendorId !== id('vendor') ||
      preview.vendorAllocationId !== id('allocation') || preview.currency !== 'TRY' ||
      preview.economicDirection !== 'VENDOR_DEDUCTION' ||
      preview.difference.vendorPayableReversalMinor !== 10000 ||
      !state.eligible || state.application || state.reasonCode !== null ||
      state.approvedSettlement?.id !== id('origin') ||
      state.approvedSettlement?.availableCoverageMinor !== 100000 ||
      approval.status !== 'APPROVED' || approval.approvedAt?.getTime() !== approvedAt.getTime() ||
      approval.netPayableMinor !== 100000 || approval.lines.length !== 2 ||
      approval.lines.some((line) => line.payoutBatchLines.length !== 0) ||
      payoutCount !== 0 || authorityCount !== 0 || claimCount !== 0 ||
      deductionCount !== 0 || coverageCount !== 0 || correctionDebtCount !== 0) {
    throw new Error('Approved/no-payout deduction fixture failed canonical self-verification.');
  }
  console.log(JSON.stringify({ reviewId: id('review'), vendorId: id('vendor'),
    approvedSettlementId: id('origin'), approvedAt: approval.approvedAt?.toISOString(),
    payoutCount, direction: preview.economicDirection,
    deductionMinor: preview.difference.vendorPayableReversalMinor, eligible: state.eligible }));
} finally {
  await db.$disconnect();
}
