import { PrismaClient } from '../../../backend/node_modules/@prisma/client/index.js';
import { upsertSeedUser } from '../../../backend/prisma/seed-user-utils.js';

const databaseUrl = process.env.DATABASE_URL?.trim();
const target = databaseUrl ? new URL(databaseUrl) : null;
if (process.env.BROWSER_SMOKE_ALLOW_LOCAL_DB !== '1' || !target ||
    !['localhost', '127.0.0.1'].includes(target.hostname) ||
    !/^\/vendor_dashboard_browser_smoke_[0-9]+_[0-9]+$/.test(target.pathname)) {
  throw new Error('Draft-deduction fixture requires an explicitly enabled, dedicated local browser-smoke database.');
}

process.env.DATABASE_URL = databaseUrl;
const { normalizeRefundEvidence } = await import('../../../backend/src/modules/finance/refund-evidence-normalizer.service.js');
const { previewTerminalFinancialCorrection } = await import('../../../backend/src/modules/finance/financial-correction-preview.service.js');
const { getDraftPayoutFinancialCorrectionState } = await import('../../../backend/src/modules/finance/financial-correction-draft-payout.service.js');
const { preparePayoutBatch } = await import('../../../backend/src/modules/finance/finance.service.js');
const { recordVerifiedDeliveredObservation } = await import('../../../backend/src/modules/shipping/allocation-delivered-observation.service.js');
const { evaluateSaleSettlementDelay } = await import('../../../backend/src/modules/finance/settlement-delay-eligibility.service.js');
const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

const run = 'browser-smoke-draft-deduction';
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
  const accepted = evidence('50.00');
  const incoming = evidence('150.00');
  await db.vendor.create({ data: { id: ids.vendor, name: 'Browser Smoke Vendor' } });
  const admin = await upsertSeedUser(db, {
    email: 'admin@demo.com', name: 'Browser Smoke Admin', role: 'ADMIN', vendorIds: [ids.vendor],
  });
  await db.shopifyOrder.create({ data: { id: ids.order, sourceShopifyOrderId: shopifyOrder,
    sourceShopifyOrderNumber: `#${run}` } });
  await db.vendorAllocation.create({ data: { id: ids.allocation, sourceShopifyOrderId: ids.order,
    sourceShopifyOrderNumber: `#${run}`, originalVendorId: ids.vendor, assignedVendorId: ids.vendor,
    outboundMethodSnapshot: 'KARGONOMI',
    fulfillmentStatus: 'Fulfilled', shippingStatus: 'Delivered' } });
  await db.fulfillment.create({ data: { id: ids.fulfillment, vendorAllocationId: ids.allocation,
    fulfillmentStatus: 'Fulfilled', fulfilledAt: new Date('2026-08-01T00:00:00Z'),
    shipmentUpdatedAt: new Date('2026-08-01T00:00:00Z') } });
  await db.refundRecord.create({ data: { id: ids.refundRecord, vendorAllocationId: ids.allocation,
    sourceShopifyOrderId: shopifyOrder, sourceShopifyOrderNumber: `#${run}`,
    sourceShopifyRefundId: shopifyRefund, amount: '50.00', status: 'processed' } });
  await db.financeLedgerEntry.create({ data: { id: ids.sale, vendorAllocationId: ids.allocation,
    vendorId: ids.vendor, entryType: 'sale', amount: '1050.00',
    commissionPercentSnapshot: '0.00', commissionVatPercentSnapshot: '20.00',
    settlementStatus: 'PAYABLE', payoutStatus: 'APPROVED', settlementDelayDaysSnapshot: 0 } });
  await db.financeLedgerEntry.create({ data: { id: ids.refundLedger, vendorAllocationId: ids.allocation,
    vendorId: ids.vendor, entryType: 'refund', amount: '50.00',
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
    evidenceSource: 'browser_smoke_draft_deduction', capturedAt: new Date('2026-09-01T10:00:00Z'),
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
  const shipmentExecutionId = `${run}-shipment-execution`;
  const sourceReference = `${run}-shipment`;
  await db.shipmentExecution.create({ data: {
    id: shipmentExecutionId, allocationId: ids.allocation, vendorId: ids.vendor,
    provider: 'KARGONOMI', providerShipmentId: sourceReference,
    shipmentStatus: 'DELIVERED', requestSnapshot: {},
  } });
  const observation = await recordVerifiedDeliveredObservation({
    allocationId: ids.allocation,
    source: { method: 'KARGONOMI', shipmentExecutionId, sourceReference },
  }, db as never);
  const sale = await db.financeLedgerEntry.findUniqueOrThrow({
    where: { id: ids.sale }, include: { vendorAllocation: { include: { deliveredObservation: true } } },
  });
  if (sale.vendorId !== ids.vendor || sale.vendorAllocation?.assignedVendorId !== ids.vendor ||
      sale.vendorAllocation.outboundMethodSnapshot !== 'KARGONOMI' ||
      sale.vendorAllocation.outboundIntegrationProviderSnapshot !== null ||
      sale.vendorAllocation.deliveredObservation?.id !== observation.id ||
      observation.shipmentExecutionId !== shipmentExecutionId || observation.sourceReference !== sourceReference ||
      sale.settlementDelayDaysSnapshot !== 0 || !evaluateSaleSettlementDelay(sale).eligible) {
    throw new Error('Draft-deduction SALE lacks source-aligned, mature delivery authority.');
  }
  const approvedAt = new Date(Math.max(Date.now(), observation.firstObservedDeliveredAt.getTime()));
  await db.settlementApproval.create({ data: {
    id: ids.origin, vendorId: ids.vendor, status: 'APPROVED', currency: 'TRY',
    grossSalesMinor: 105000, refundTotalMinor: 5000,
    commissionMinor: 0, commissionVatMinor: 0, netPayableMinor: 100000,
    sourceSnapshotJson: {}, approvedBy: admin.id, approvedAt,
    lines: { create: [
      { id: ids.saleLine, financeLedgerEntryId: ids.sale, lineType: 'SALE',
        amountMinor: 105000, commissionMinor: 0, commissionVatMinor: 0,
        payableImpactMinor: 105000, sourceSnapshotJson: {} },
      { id: ids.refundLine, financeLedgerEntryId: ids.refundLedger, lineType: 'REFUND',
        amountMinor: 5000, commissionMinor: 0, commissionVatMinor: 0,
        payableImpactMinor: -5000, sourceSnapshotJson: {} },
    ] },
  } });
  const draft = await preparePayoutBatch({ vendorId: ids.vendor }, admin.id);

  const [review, preview, state, payout, authority, debts] = await Promise.all([
    db.refundTerminalEvidenceReview.findUniqueOrThrow({ where: { id: ids.review } }),
    previewTerminalFinancialCorrection(ids.review, db as never),
    getDraftPayoutFinancialCorrectionState(ids.review, db as never),
    db.payoutBatch.findUniqueOrThrow({ where: { id: draft.id }, include: { lines: true } }),
    db.financialCorrectionAuthority.findUnique({ where: { reviewId: ids.review } }),
    db.vendorBalanceEvent.count({ where: { vendorId: ids.vendor } }),
  ]);
  if (review.status !== 'RESOLVED' || review.resolutionOutcome !== 'CORRECTION_REQUIRED' ||
      review.economicVendorId !== ids.vendor || preview.vendorId !== ids.vendor ||
      preview.vendorAllocationId !== ids.allocation || preview.economicDirection !== 'VENDOR_DEDUCTION' ||
      preview.difference.vendorPayableReversalMinor !== 10000 || !state.eligible || state.application ||
      state.draftPayout?.id !== draft.id || payout.status !== 'DRAFT' || payout.paidAt !== null ||
      payout.vendorId !== ids.vendor || payout.netAmount.toString() !== '1000' ||
      payout.lines.length !== 2 ||
      !payout.lines.some((line) => line.financeLedgerEntryId === ids.sale && line.settlementApprovalLineId === ids.saleLine) ||
      !payout.lines.some((line) => line.financeLedgerEntryId === ids.refundLedger && line.settlementApprovalLineId === ids.refundLine) ||
      authority || debts !== 0) {
    throw new Error('Browser-smoke DRAFT deduction fixture failed canonical self-verification.');
  }
  console.log(JSON.stringify({ reviewId: ids.review, vendorId: ids.vendor,
    payoutId: draft.id, direction: preview.economicDirection, eligible: state.eligible }));
} finally {
  await db.$disconnect();
}
