import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '../backend/node_modules/@prisma/client/index.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
const describeWithPostgres = testDatabaseUrl ? describe : describe.skip;

describeWithPostgres('before-settlement financial correction deduction with isolated PostgreSQL', () => {
  const runId = `phase2e2-${process.pid}-${Date.now()}`;
  const ids = {
    vendor: `${runId}-vendor`, admin: `${runId}-admin`, order: `${runId}-order`,
    allocation: `${runId}-allocation`, refundRecord: `${runId}-refund-record`,
    sale: `${runId}-sale`, refundLedger: `${runId}-refund-ledger`, snapshot: `${runId}-snapshot`,
    review: `${runId}-review`, incoming: `${runId}-incoming`, resolved: `${runId}-resolved`,
    historicalSettlement: `${runId}-historical-settlement`, historicalLine: `${runId}-historical-line`,
    historicalPayout: `${runId}-historical-payout`, historicalPayoutLine: `${runId}-historical-payout-line`,
    futureAllocation: `${runId}-future-allocation`, futureFulfillment: `${runId}-future-fulfillment`,
    futureSale: `${runId}-future-sale`,
    originalFulfillment: `${runId}-original-fulfillment`,
    creditAllocation: `${runId}-credit-allocation`, creditRefundRecord: `${runId}-credit-refund-record`,
    creditSale: `${runId}-credit-sale`, creditRefundLedger: `${runId}-credit-refund-ledger`,
    creditSnapshot: `${runId}-credit-snapshot`, creditReview: `${runId}-credit-review`,
    creditIncoming: `${runId}-credit-incoming`, creditResolved: `${runId}-credit-resolved`,
    creditFulfillment: `${runId}-credit-fulfillment`,
  };
  const sourceShopifyOrderId = `gid://shopify/Order/${runId}`;
  const sourceShopifyRefundId = `gid://shopify/Refund/${runId}`;
  let db: PrismaClient;
  let normalizeRefundEvidence: typeof import('../backend/src/modules/finance/refund-evidence-normalizer.service.js')['normalizeRefundEvidence'];
  let previewTerminalFinancialCorrection: typeof import('../backend/src/modules/finance/financial-correction-preview.service.js')['previewTerminalFinancialCorrection'];
  let applyBeforeSettlementFinancialCorrectionDeduction: typeof import('../backend/src/modules/finance/financial-correction-before-settlement-deduction.service.js')['applyBeforeSettlementFinancialCorrectionDeduction'];
  let getBeforeSettlementFinancialCorrectionDeductionState: typeof import('../backend/src/modules/finance/financial-correction-before-settlement-deduction.service.js')['getBeforeSettlementFinancialCorrectionDeductionState'];
  let applyBeforeSettlementFinancialCorrectionCredit: typeof import('../backend/src/modules/finance/financial-correction-before-settlement-credit.service.js')['applyBeforeSettlementFinancialCorrectionCredit'];
  let previewApproval: typeof import('../backend/src/modules/finance/settlement-approval.service.js')['previewApproval'];
  let createDraftApproval: typeof import('../backend/src/modules/finance/settlement-approval.service.js')['createDraftApproval'];
  let approveSettlementApproval: typeof import('../backend/src/modules/finance/settlement-approval.service.js')['approveSettlementApproval'];
  let cancelSettlementApproval: typeof import('../backend/src/modules/finance/settlement-approval.service.js')['cancelSettlementApproval'];
  let preparePayoutBatch: typeof import('../backend/src/modules/finance/finance.service.js')['preparePayoutBatch'];
  let cancelPayoutBatch: typeof import('../backend/src/modules/finance/finance.service.js')['cancelPayoutBatch'];
  let markPayoutBatchReview: typeof import('../backend/src/modules/finance/finance.service.js')['markPayoutBatchReview'];
  let markPayoutBatchPaid: typeof import('../backend/src/modules/finance/finance.service.js')['markPayoutBatchPaid'];
  const settlementIds: string[] = [];
  const payoutIds: string[] = [];

  function normalized(amount: string, refundTotalAmount = '150.00') {
    return normalizeRefundEvidence({
      sourceShopifyRefundId, sourceShopifyOrderId, vendorAllocationId: ids.allocation,
      monetaryClassification: 'MONETARY_REFUND', refundTotalAmount, currency: 'TRY',
      transactions: [{ transactionGid: `gid://shopify/OrderTransaction/${runId}`, kind: 'REFUND', status: 'SUCCESS', amount: refundTotalAmount, currency: 'TRY' }],
      refundLines: [{ sourceLineItemId: `gid://shopify/LineItem/${runId}`, quantity: 2, subtotalAmount: amount, currency: 'TRY' }],
      historicalEconomicVendorId: ids.vendor, historicalSaleFinanceLedgerEntryId: ids.sale,
      supersededSaleLedgerIds: [],
    });
  }

  async function setHundredTryDeductionFixture() {
    const accepted = normalized('50.00');
    const incoming = normalized('150.00');
    await db.refundRecord.update({ where: { id: ids.refundRecord }, data: { amount: '50.00' } });
    await db.financeLedgerEntry.updateMany({ where: { id: { in: [ids.sale, ids.refundLedger] } },
      data: { commissionPercentSnapshot: '0.00', commissionVatPercentSnapshot: '20.00' } });
    await db.financeLedgerEntry.update({ where: { id: ids.refundLedger }, data: { amount: '50.00' } });
    await db.refundEvidenceSnapshot.update({ where: { id: ids.snapshot }, data: {
      normalizedTransactionsJson: accepted.normalizedTransactionsJson,
      normalizedRefundLinesJson: accepted.normalizedRefundLinesJson,
      normalizedOwnershipJson: accepted.normalizedOwnershipJson,
      normalizedEvidenceJson: accepted.normalizedEvidenceJson,
      evidenceHash: accepted.evidenceHash,
    } });
    await db.refundTerminalConflictEvidence.update({ where: { id: ids.incoming }, data: {
      normalizedEvidenceJson: incoming.normalizedEvidenceJson, evidenceHash: incoming.evidenceHash,
    } });
    await db.refundTerminalEvidenceReview.update({ where: { id: ids.review }, data: {
      storedEvidenceHash: accepted.evidenceHash, incomingEvidenceHash: incoming.evidenceHash,
    } });
  }

  async function setTwoHundredTryDeductionFixture() {
    await setHundredTryDeductionFixture();
    const accepted = normalized('50.00', '250.00');
    const incoming = normalized('250.00', '250.00');
    await db.financeLedgerEntry.update({ where: { id: ids.sale }, data: { amount: '300.00' } });
    await db.refundEvidenceSnapshot.update({ where: { id: ids.snapshot }, data: {
      refundTotalAmount: '250.00', normalizedTransactionsJson: accepted.normalizedTransactionsJson,
      normalizedRefundLinesJson: accepted.normalizedRefundLinesJson,
      normalizedOwnershipJson: accepted.normalizedOwnershipJson,
      normalizedEvidenceJson: accepted.normalizedEvidenceJson, evidenceHash: accepted.evidenceHash,
    } });
    await db.refundTerminalConflictEvidence.update({ where: { id: ids.incoming }, data: {
      refundTotalAmount: '250.00', normalizedEvidenceJson: incoming.normalizedEvidenceJson,
      evidenceHash: incoming.evidenceHash,
    } });
    await db.refundTerminalEvidenceReview.update({ where: { id: ids.review }, data: {
      storedEvidenceHash: accepted.evidenceHash, incomingEvidenceHash: incoming.evidenceHash,
    } });
  }

  beforeEach(async () => {
    const target = new URL(testDatabaseUrl!);
    if (process.env.PHASE2E2_TEST_DATABASE_ISOLATED !== '1' ||
        !['127.0.0.1', 'localhost'].includes(target.hostname) ||
        target.pathname.slice(1) !== 'phase2e2_validation') {
      throw new Error('Phase 2E2 PostgreSQL test requires the explicitly isolated local phase2e2_validation database.');
    }
    process.env.DATABASE_URL = testDatabaseUrl;
    ({ normalizeRefundEvidence } = await import('../backend/src/modules/finance/refund-evidence-normalizer.service.js'));
    ({ previewTerminalFinancialCorrection } = await import('../backend/src/modules/finance/financial-correction-preview.service.js'));
    ({ applyBeforeSettlementFinancialCorrectionDeduction, getBeforeSettlementFinancialCorrectionDeductionState } = await import('../backend/src/modules/finance/financial-correction-before-settlement-deduction.service.js'));
    ({ applyBeforeSettlementFinancialCorrectionCredit } = await import('../backend/src/modules/finance/financial-correction-before-settlement-credit.service.js'));
    ({ previewApproval, createDraftApproval, approveSettlementApproval, cancelSettlementApproval } = await import('../backend/src/modules/finance/settlement-approval.service.js'));
    ({ preparePayoutBatch, cancelPayoutBatch, markPayoutBatchReview, markPayoutBatchPaid } = await import('../backend/src/modules/finance/finance.service.js'));
    db = new PrismaClient({ datasources: { db: { url: testDatabaseUrl } } });
    await db.$connect();
    const accepted = normalized('120.00');
    const incoming = normalized('150.00');
    await db.user.create({ data: { id: ids.admin, email: `${runId}@example.test`, name: 'Phase 2E2 Admin', role: 'ADMIN', passwordHash: 'test-only' } });
    await db.vendor.create({ data: { id: ids.vendor, name: 'Phase 2E2 Vendor' } });
    await db.shopifyOrder.create({ data: { id: ids.order, sourceShopifyOrderId, sourceShopifyOrderNumber: `#${runId}` } });
    await db.vendorAllocation.create({ data: {
      id: ids.allocation, sourceShopifyOrderId: ids.order, sourceShopifyOrderNumber: `#${runId}`,
      originalVendorId: ids.vendor, assignedVendorId: ids.vendor,
      fulfillmentStatus: 'Fulfilled', shippingStatus: 'Delivered',
    } });
    await db.fulfillment.create({ data: {
      id: ids.originalFulfillment, vendorAllocationId: ids.allocation,
      fulfillmentStatus: 'Fulfilled', fulfilledAt: new Date('2026-08-01T00:00:00.000Z'),
      shipmentUpdatedAt: new Date('2026-08-01T00:00:00.000Z'),
    } });
    await db.refundRecord.create({ data: {
      id: ids.refundRecord, vendorAllocationId: ids.allocation, sourceShopifyOrderId,
      sourceShopifyOrderNumber: `#${runId}`, sourceShopifyRefundId, amount: '120.00', status: 'processed',
    } });
    await db.financeLedgerEntry.create({ data: {
      id: ids.sale, vendorAllocationId: ids.allocation, vendorId: ids.vendor,
      entryType: 'sale', amount: '200.00', settlementDelayDaysSnapshot: 0, commissionPercentSnapshot: '10.00',
      commissionVatPercentSnapshot: '20.00', settlementStatus: 'PENDING', payoutStatus: 'PENDING',
    } });
    await db.financeLedgerEntry.create({ data: {
      id: ids.refundLedger, vendorAllocationId: ids.allocation, vendorId: ids.vendor,
      entryType: 'refund', amount: '120.00', commissionPercentSnapshot: '10.00',
      commissionVatPercentSnapshot: '20.00', settlementStatus: 'PENDING', payoutStatus: 'PENDING',
    } });
    await db.refundEvidenceSnapshot.create({ data: {
      id: ids.snapshot, sourceShopifyRefundId, sourceShopifyOrderId,
      vendorAllocationId: ids.allocation, refundRecordId: ids.refundRecord,
      refundFinanceLedgerEntryId: ids.refundLedger, historicalEconomicVendorId: ids.vendor,
      historicalSaleFinanceLedgerEntryId: ids.sale, monetaryClassification: 'MONETARY_REFUND',
      refundTotalAmount: '150.00', currency: 'TRY',
      normalizedTransactionsJson: accepted.normalizedTransactionsJson,
      normalizedRefundLinesJson: accepted.normalizedRefundLinesJson,
      normalizedOwnershipJson: accepted.normalizedOwnershipJson,
      normalizedEvidenceJson: accepted.normalizedEvidenceJson,
      supersededSaleLedgerIdsJson: [], evidenceHash: accepted.evidenceHash,
      hashAlgorithm: accepted.hashAlgorithm, evidenceVersion: accepted.evidenceVersion,
      normalizationVersion: accepted.normalizationVersion, evidenceSource: 'phase2e2_postgres_test',
      capturedAt: new Date('2026-09-01T10:00:00.000Z'),
    } });
    await db.refundTerminalEvidenceReview.create({ data: {
      id: ids.review, sourceShopifyRefundId, sourceShopifyOrderId,
      vendorAllocationId: ids.allocation, terminalRefundFinanceLedgerEntryId: ids.refundLedger,
      refundRecordId: ids.refundRecord, economicVendorId: ids.vendor,
      storedEvidenceSnapshotId: ids.snapshot, dedupeKey: `${runId}-dedupe`,
      conflictCategory: 'financial_evidence_conflict', storedEvidenceHash: accepted.evidenceHash,
      incomingEvidenceHash: incoming.evidenceHash, conflictSummaryJson: {},
      status: 'RESOLVED', resolutionOutcome: 'CORRECTION_REQUIRED',
    } });
    await db.refundTerminalConflictEvidence.create({ data: {
      id: ids.incoming, reviewId: ids.review, sourceShopifyRefundId, sourceShopifyOrderId,
      vendorAllocationId: ids.allocation, economicVendorId: ids.vendor,
      historicalSaleFinanceLedgerEntryId: ids.sale, supersededSaleLedgerIdsJson: [],
      refundTotalAmount: '150.00', currency: 'TRY', normalizedEvidenceJson: incoming.normalizedEvidenceJson,
      evidenceHash: incoming.evidenceHash, hashAlgorithm: incoming.hashAlgorithm,
      evidenceVersion: incoming.evidenceVersion, normalizationVersion: incoming.normalizationVersion,
    } });
    await db.refundTerminalEvidenceReviewEvent.create({ data: {
      id: ids.resolved, reviewId: ids.review, eventType: 'RESOLVED',
      resolutionOutcome: 'CORRECTION_REQUIRED', actorUserId: ids.admin,
    } });
  });

  afterEach(async () => {
    if (!db) return;
    // A failed assertion must not leave an untracked draft in this isolated fixture.
    const allOwnedSettlements = await db.settlementApproval.findMany({ where: { vendorId: ids.vendor }, select: { id: true } });
    for (const approval of allOwnedSettlements) {
      if (!settlementIds.includes(approval.id) && approval.id !== ids.historicalSettlement) settlementIds.push(approval.id);
    }
    if (payoutIds.length) {
      await db.financeEvent.deleteMany({ where: { referenceType: 'payout_batch', referenceId: { in: payoutIds } } });
      await db.vendorBalanceEvent.deleteMany({ where: { payoutBatchId: { in: payoutIds } } });
      await db.payoutBatchLine.deleteMany({ where: { payoutBatchId: { in: payoutIds } } });
      await db.financialCorrectionDeductionPayoutLine.deleteMany({ where: { payoutBatchId: { in: payoutIds } } });
      await db.financialCorrectionCreditPayoutLine.deleteMany({ where: { payoutBatchId: { in: payoutIds } } });
      await db.payoutBatch.deleteMany({ where: { id: { in: payoutIds } } });
    }
    if (settlementIds.length) {
      await db.settlementApprovalLine.deleteMany({ where: { settlementApprovalId: { in: settlementIds } } });
      await db.financialCorrectionDeductionSettlementLine.deleteMany({ where: { settlementApprovalId: { in: settlementIds } } });
      await db.financialCorrectionCreditSettlementLine.deleteMany({ where: { settlementApprovalId: { in: settlementIds } } });
      await db.settlementApproval.deleteMany({ where: { id: { in: settlementIds } } });
    }
    await db.vendorBalanceEvent.deleteMany({ where: { vendorId: ids.vendor } });
    await db.financialCorrectionDeduction.deleteMany({ where: { authority: { reviewId: ids.review } } });
    await db.financialCorrectionCreditSettlementLine.deleteMany({ where: { credit: { authority: { reviewId: ids.creditReview } } } });
    await db.financialCorrectionCredit.deleteMany({ where: { authority: { reviewId: ids.creditReview } } });
    await db.financialCorrectionAuthority.deleteMany({ where: { reviewId: ids.review } });
    await db.financialCorrectionAuthority.deleteMany({ where: { reviewId: ids.creditReview } });
    await db.financialCorrectionBaselineClaim.deleteMany({ where: { acceptedEvidenceSnapshotId: ids.snapshot } });
    await db.financialCorrectionBaselineClaim.deleteMany({ where: { acceptedEvidenceSnapshotId: ids.creditSnapshot } });
    await db.payoutBatchLine.deleteMany({ where: { id: ids.historicalPayoutLine } });
    await db.payoutBatch.deleteMany({ where: { id: ids.historicalPayout } });
    await db.settlementApprovalLine.deleteMany({ where: { id: ids.historicalLine } });
    await db.settlementApproval.deleteMany({ where: { id: ids.historicalSettlement } });
    await db.refundTerminalEvidenceReviewEvent.deleteMany({ where: { id: ids.resolved } });
    await db.refundTerminalEvidenceReviewEvent.deleteMany({ where: { id: ids.creditResolved } });
    await db.refundTerminalConflictEvidence.deleteMany({ where: { id: ids.incoming } });
    await db.refundTerminalConflictEvidence.deleteMany({ where: { id: ids.creditIncoming } });
    await db.refundTerminalEvidenceReview.deleteMany({ where: { id: ids.review } });
    await db.refundTerminalEvidenceReview.deleteMany({ where: { id: ids.creditReview } });
    await db.refundEvidenceSnapshot.deleteMany({ where: { id: ids.snapshot } });
    await db.refundEvidenceSnapshot.deleteMany({ where: { id: ids.creditSnapshot } });
    await db.financeLedgerEntry.deleteMany({ where: { id: { in: [ids.sale, ids.refundLedger] } } });
    await db.financeLedgerEntry.deleteMany({ where: { id: { in: [ids.creditSale, ids.creditRefundLedger] } } });
    await db.financeLedgerEntry.deleteMany({ where: { id: ids.futureSale } });
    await db.fulfillment.deleteMany({ where: { id: ids.futureFulfillment } });
    await db.refundRecord.deleteMany({ where: { id: ids.refundRecord } });
    await db.refundRecord.deleteMany({ where: { id: ids.creditRefundRecord } });
    await db.fulfillment.deleteMany({ where: { id: ids.originalFulfillment } });
    await db.fulfillment.deleteMany({ where: { id: ids.creditFulfillment } });
    await db.vendorAllocation.deleteMany({ where: { id: ids.allocation } });
    await db.vendorAllocation.deleteMany({ where: { id: ids.creditAllocation } });
    await db.vendorAllocation.deleteMany({ where: { id: ids.futureAllocation } });
    await db.shopifyOrder.deleteMany({ where: { id: ids.order } });
    await db.vendor.deleteMany({ where: { id: ids.vendor } });
    await db.user.deleteMany({ where: { id: ids.admin } });
    await db.$disconnect();
    settlementIds.length = 0;
    payoutIds.length = 0;
  });

  const inputFor = async () => {
    const preview = await previewTerminalFinancialCorrection(ids.review, db as never);
    return { reviewId: ids.review, previewFingerprint: preview.previewFingerprint,
      actorUserId: ids.admin, reason: 'Verified before-settlement deduction' };
  };

  async function addPayableSale(amount: string) {
    await db.vendorAllocation.create({ data: {
      id: ids.futureAllocation, sourceShopifyOrderId: ids.order, sourceShopifyOrderNumber: `#${runId}`,
      originalVendorId: ids.vendor, assignedVendorId: ids.vendor,
      fulfillmentStatus: 'Fulfilled', shippingStatus: 'Delivered',
    } });
    await db.fulfillment.create({ data: {
      id: ids.futureFulfillment, vendorAllocationId: ids.futureAllocation,
      fulfillmentStatus: 'Fulfilled', fulfilledAt: new Date('2026-08-01T00:00:00.000Z'),
      shipmentUpdatedAt: new Date('2026-08-01T00:00:00.000Z'),
    } });
    await db.financeLedgerEntry.create({ data: {
      id: ids.futureSale, vendorAllocationId: ids.futureAllocation, vendorId: ids.vendor,
      entryType: 'sale', amount, settlementDelayDaysSnapshot: 0,
      settlementStatus: 'PAYABLE', payoutStatus: 'APPROVED',
      commissionPercentSnapshot: '0.00', commissionVatPercentSnapshot: '0.00',
    } });
  }

  async function addIndependentHundredTryCredit() {
    const refundId = `gid://shopify/Refund/${runId}-credit`;
    const evidence = (lineAmount: string) => normalizeRefundEvidence({
      sourceShopifyRefundId: refundId, sourceShopifyOrderId,
      vendorAllocationId: ids.creditAllocation, monetaryClassification: 'MONETARY_REFUND',
      refundTotalAmount: '150.00', currency: 'TRY',
      transactions: [{ transactionGid: `gid://shopify/OrderTransaction/${runId}-credit`,
        kind: 'REFUND', status: 'SUCCESS', amount: '150.00', currency: 'TRY' }],
      refundLines: [{ sourceLineItemId: `gid://shopify/LineItem/${runId}-credit`,
        quantity: 2, subtotalAmount: lineAmount, currency: 'TRY' }],
      historicalEconomicVendorId: ids.vendor, historicalSaleFinanceLedgerEntryId: ids.creditSale,
      supersededSaleLedgerIds: [],
    });
    const accepted = evidence('150.00');
    const incoming = evidence('50.00');
    await db.vendorAllocation.create({ data: {
      id: ids.creditAllocation, sourceShopifyOrderId: ids.order, sourceShopifyOrderNumber: `#${runId}`,
      originalVendorId: ids.vendor, assignedVendorId: ids.vendor,
      fulfillmentStatus: 'Fulfilled', shippingStatus: 'Delivered',
    } });
    await db.fulfillment.create({ data: {
      id: ids.creditFulfillment, vendorAllocationId: ids.creditAllocation,
      fulfillmentStatus: 'Fulfilled', fulfilledAt: new Date('2026-08-01T00:00:00.000Z'),
      shipmentUpdatedAt: new Date('2026-08-01T00:00:00.000Z'),
    } });
    await db.refundRecord.create({ data: {
      id: ids.creditRefundRecord, vendorAllocationId: ids.creditAllocation, sourceShopifyOrderId,
      sourceShopifyOrderNumber: `#${runId}`, sourceShopifyRefundId: refundId,
      amount: '150.00', status: 'processed',
    } });
    await db.financeLedgerEntry.create({ data: {
      id: ids.creditSale, vendorAllocationId: ids.creditAllocation, vendorId: ids.vendor,
      entryType: 'sale', amount: '200.00', settlementDelayDaysSnapshot: 0,
      commissionPercentSnapshot: '0.00', commissionVatPercentSnapshot: '20.00',
      settlementStatus: 'PENDING', payoutStatus: 'PENDING',
    } });
    await db.financeLedgerEntry.create({ data: {
      id: ids.creditRefundLedger, vendorAllocationId: ids.creditAllocation, vendorId: ids.vendor,
      entryType: 'refund', amount: '150.00', commissionPercentSnapshot: '0.00',
      commissionVatPercentSnapshot: '20.00', settlementStatus: 'PENDING', payoutStatus: 'PENDING',
    } });
    await db.refundEvidenceSnapshot.create({ data: {
      id: ids.creditSnapshot, sourceShopifyRefundId: refundId, sourceShopifyOrderId,
      vendorAllocationId: ids.creditAllocation, refundRecordId: ids.creditRefundRecord,
      refundFinanceLedgerEntryId: ids.creditRefundLedger, historicalEconomicVendorId: ids.vendor,
      historicalSaleFinanceLedgerEntryId: ids.creditSale, monetaryClassification: 'MONETARY_REFUND',
      refundTotalAmount: '150.00', currency: 'TRY',
      normalizedTransactionsJson: accepted.normalizedTransactionsJson,
      normalizedRefundLinesJson: accepted.normalizedRefundLinesJson,
      normalizedOwnershipJson: accepted.normalizedOwnershipJson,
      normalizedEvidenceJson: accepted.normalizedEvidenceJson,
      supersededSaleLedgerIdsJson: [], evidenceHash: accepted.evidenceHash,
      hashAlgorithm: accepted.hashAlgorithm, evidenceVersion: accepted.evidenceVersion,
      normalizationVersion: accepted.normalizationVersion, evidenceSource: 'phase2e2_postgres_test',
      capturedAt: new Date('2026-09-01T10:00:00.000Z'),
    } });
    await db.refundTerminalEvidenceReview.create({ data: {
      id: ids.creditReview, sourceShopifyRefundId: refundId, sourceShopifyOrderId,
      vendorAllocationId: ids.creditAllocation, terminalRefundFinanceLedgerEntryId: ids.creditRefundLedger,
      refundRecordId: ids.creditRefundRecord, economicVendorId: ids.vendor,
      storedEvidenceSnapshotId: ids.creditSnapshot, dedupeKey: `${runId}-credit-dedupe`,
      conflictCategory: 'financial_evidence_conflict', storedEvidenceHash: accepted.evidenceHash,
      incomingEvidenceHash: incoming.evidenceHash, conflictSummaryJson: {},
      status: 'RESOLVED', resolutionOutcome: 'CORRECTION_REQUIRED',
    } });
    await db.refundTerminalConflictEvidence.create({ data: {
      id: ids.creditIncoming, reviewId: ids.creditReview, sourceShopifyRefundId: refundId,
      sourceShopifyOrderId, vendorAllocationId: ids.creditAllocation, economicVendorId: ids.vendor,
      historicalSaleFinanceLedgerEntryId: ids.creditSale, supersededSaleLedgerIdsJson: [],
      refundTotalAmount: '150.00', currency: 'TRY', normalizedEvidenceJson: incoming.normalizedEvidenceJson,
      evidenceHash: incoming.evidenceHash, hashAlgorithm: incoming.hashAlgorithm,
      evidenceVersion: incoming.evidenceVersion, normalizationVersion: incoming.normalizationVersion,
    } });
    await db.refundTerminalEvidenceReviewEvent.create({ data: {
      id: ids.creditResolved, reviewId: ids.creditReview, eventType: 'RESOLVED',
      resolutionOutcome: 'CORRECTION_REQUIRED', actorUserId: ids.admin,
    } });
    const preview = await previewTerminalFinancialCorrection(ids.creditReview, db as never);
    return applyBeforeSettlementFinancialCorrectionCredit({
      reviewId: ids.creditReview, previewFingerprint: preview.previewFingerprint,
      actorUserId: ids.admin, reason: 'Independent before-settlement credit',
    }, db as never);
  }

  it('applies one exact gross payable reduction and no vendor debt under concurrent retries', async () => {
    await setHundredTryDeductionFixture();
    const input = await inputFor();
    const before = await Promise.all([
      db.financeLedgerEntry.findUniqueOrThrow({ where: { id: ids.sale } }),
      db.financeLedgerEntry.findUniqueOrThrow({ where: { id: ids.refundLedger } }),
      db.refundEvidenceSnapshot.findUniqueOrThrow({ where: { id: ids.snapshot } }),
      db.refundTerminalConflictEvidence.findUniqueOrThrow({ where: { id: ids.incoming } }),
    ]);
    expect((await getBeforeSettlementFinancialCorrectionDeductionState(ids.review, db as never)).eligible).toBe(true);
    await expect(applyBeforeSettlementFinancialCorrectionDeduction({ ...input,
      previewFingerprint: `financial-correction-preview-v1:${'0'.repeat(64)}` }, db as never))
      .rejects.toMatchObject({ code: 'PREVIEW_STALE' });
    const raced = await Promise.allSettled([
      applyBeforeSettlementFinancialCorrectionDeduction(input, db as never),
      applyBeforeSettlementFinancialCorrectionDeduction(input, db as never),
    ]);
    expect(raced.some((result) => result.status === 'fulfilled')).toBe(true);
    const applied = await applyBeforeSettlementFinancialCorrectionDeduction(input, db as never);
    expect(applied.grossDeductionMinor).toBe(10000);
    expect(applied.direction).toBe('VENDOR_DEDUCTION');
    expect(applied.route).toBe('BEFORE_SETTLEMENT_VENDOR_DEDUCTION');
    expect(applied.settlementApprovalId).toBeNull();
    expect(await db.financialCorrectionAuthority.count({ where: { reviewId: ids.review } })).toBe(1);
    expect(await db.financialCorrectionBaselineClaim.count({ where: { acceptedEvidenceSnapshotId: ids.snapshot } })).toBe(1);
    expect(await db.financialCorrectionDeduction.count({ where: { authorityId: applied.id } })).toBe(1);
    await expect(db.financialCorrectionDeduction.create({ data: {
      authorityId: applied.id, vendorId: ids.vendor, amountMinor: 10000, currency: 'TRY',
    } })).rejects.toMatchObject({ code: 'P2002' });
    expect(await db.vendorBalanceEvent.count({ where: { vendorId: ids.vendor } })).toBe(0);
    expect(await Promise.all([
      db.financeLedgerEntry.findUniqueOrThrow({ where: { id: ids.sale } }),
      db.financeLedgerEntry.findUniqueOrThrow({ where: { id: ids.refundLedger } }),
      db.refundEvidenceSnapshot.findUniqueOrThrow({ where: { id: ids.snapshot } }),
      db.refundTerminalConflictEvidence.findUniqueOrThrow({ where: { id: ids.incoming } }),
    ])).toEqual(before);
  });

  it('fails closed for active settlement and any payout membership', async () => {
    await setHundredTryDeductionFixture();
    const input = await inputFor();
    await db.settlementApproval.create({ data: {
      id: ids.historicalSettlement, vendorId: ids.vendor, status: 'DRAFT', currency: 'TRY',
      grossSalesMinor: 0, refundTotalMinor: 0, commissionMinor: 0, commissionVatMinor: 0,
      netPayableMinor: 0, sourceSnapshotJson: {},
    } });
    await db.settlementApprovalLine.create({ data: {
      id: ids.historicalLine, settlementApprovalId: ids.historicalSettlement, financeLedgerEntryId: ids.sale,
      lineType: 'SALE', amountMinor: 20000, commissionMinor: 0, commissionVatMinor: 0,
      payableImpactMinor: 20000, sourceSnapshotJson: {},
    } });
    await expect(applyBeforeSettlementFinancialCorrectionDeduction(input, db as never))
      .rejects.toMatchObject({ code: 'ACTIVE_SETTLEMENT_EXISTS' });
    await db.settlementApproval.update({ where: { id: ids.historicalSettlement }, data: { status: 'CANCELLED' } });
    expect((await getBeforeSettlementFinancialCorrectionDeductionState(ids.review, db as never)).eligible).toBe(true);
    await db.payoutBatch.create({ data: { id: ids.historicalPayout, vendorId: ids.vendor, status: 'DRAFT', currency: 'TRY' } });
    await db.payoutBatchLine.create({ data: {
      id: ids.historicalPayoutLine, payoutBatchId: ids.historicalPayout,
      financeLedgerEntryId: ids.sale, settlementApprovalLineId: ids.historicalLine, amountSnapshot: '200.00',
    } });
    await expect(applyBeforeSettlementFinancialCorrectionDeduction(input, db as never))
      .rejects.toMatchObject({ code: 'PAYOUT_ALREADY_EXISTS' });
    expect(await db.financialCorrectionAuthority.count({ where: { reviewId: ids.review } })).toBe(0);
  });

  it('rolls back the baseline claim and authority if deduction-source creation fails', async () => {
    await setHundredTryDeductionFixture();
    const input = await inputFor();
    await db.$executeRaw`ALTER TABLE "FinancialCorrectionDeduction" ADD CONSTRAINT "Phase2E2RejectDeductionTest" CHECK (false) NOT VALID`;
    try {
      await expect(applyBeforeSettlementFinancialCorrectionDeduction(input, db as never)).rejects.toThrow();
      expect(await db.financialCorrectionBaselineClaim.count({ where: { acceptedEvidenceSnapshotId: ids.snapshot } })).toBe(0);
      expect(await db.financialCorrectionAuthority.count({ where: { reviewId: ids.review } })).toBe(0);
      expect(await db.financialCorrectionDeduction.count({ where: { vendorId: ids.vendor } })).toBe(0);
    } finally {
      await db.$executeRaw`ALTER TABLE "FinancialCorrectionDeduction" DROP CONSTRAINT "Phase2E2RejectDeductionTest"`;
    }
  });

  it('reduces settlement entitlement before existing vendor-debt offset and restores source after cancellation', async () => {
    await setHundredTryDeductionFixture();
    const applied = await applyBeforeSettlementFinancialCorrectionDeduction(await inputFor(), db as never);
    await addPayableSale('850.00');
    const preview = await previewApproval(ids.vendor);
    expect(preview.summary.correctionDeductionMinor).toBe(10000);
    expect(preview.correctionDeductions[0]?.id).toBe(applied.deductionId);
    expect(preview.summary.netPayableMinor).toBe(90000);
    const draft = await createDraftApproval({ vendorId: ids.vendor });
    settlementIds.push(draft.id);
    expect(draft.netPayableMinor).toBe(90000);
    expect(draft.correctionDeductionLines[0]?.deductionId).toBe(applied.deductionId);
    const competingApprovalId = `${runId}-competing-approval`;
    await db.settlementApproval.create({ data: {
      id: competingApprovalId, vendorId: ids.vendor, status: 'DRAFT', currency: 'TRY',
      grossSalesMinor: 0, refundTotalMinor: 0, commissionMinor: 0, commissionVatMinor: 0,
      netPayableMinor: 0, sourceSnapshotJson: {},
    } });
    settlementIds.push(competingApprovalId);
    await expect(db.financialCorrectionDeductionSettlementLine.create({ data: {
      deductionId: applied.deductionId, settlementApprovalId: competingApprovalId, amountMinor: 10000,
    } })).rejects.toMatchObject({ code: 'P2002' });
    await db.settlementApproval.delete({ where: { id: competingApprovalId } });
    await approveSettlementApproval(draft.id, ids.admin);
    await db.vendorBalanceEvent.create({ data: {
      vendorId: ids.vendor, type: 'VENDOR_DEBT_CREATED', amountMinor: -6000, currency: 'TRY',
      sourceType: 'phase2e2_test_existing_debt', sourceId: runId, idempotencyKey: `${runId}-debt`,
    } });
    const payout = await preparePayoutBatch({ vendorId: ids.vendor }, ids.admin);
    payoutIds.push(payout.id);
    expect(payout.grossAmount).toBe('1050.00');
    expect(payout.refundAmount).toBe('50.00');
    expect(payout.correctionDeductionAmount).toBe('100.00');
    expect(payout.payableBeforeDebtOffset).toBe('900.00');
    expect(payout.debtOffsetAmount).toBe('60.00');
    expect(payout.netAmount).toBe('840.00');
    expect(payout.correctionDeductionLines).toHaveLength(1);
    const competingPayoutId = `${runId}-competing-payout`;
    await db.payoutBatch.create({ data: { id: competingPayoutId, vendorId: ids.vendor, currency: 'TRY', status: 'DRAFT' } });
    payoutIds.push(competingPayoutId);
    await expect(db.financialCorrectionDeductionPayoutLine.create({ data: {
      settlementDeductionLineId: draft.correctionDeductionLines[0]!.id,
      payoutBatchId: competingPayoutId, amountMinor: 10000,
    } })).rejects.toMatchObject({ code: 'P2002' });
    await db.payoutBatch.delete({ where: { id: competingPayoutId } });
    expect(await db.vendorBalanceEvent.count({ where: { vendorId: ids.vendor, type: 'VENDOR_DEBT_CREATED' } })).toBe(1);
    await cancelPayoutBatch(payout.id);
    await cancelSettlementApproval(draft.id, ids.admin);
    expect((await previewApproval(ids.vendor)).correctionDeductions).toHaveLength(1);
    const redraft = await createDraftApproval({ vendorId: ids.vendor });
    settlementIds.push(redraft.id);
    expect(redraft.correctionDeductionLines).toHaveLength(1);
    expect(redraft.correctionDeductionLines[0]?.deductionId).toBe(applied.deductionId);
    expect(await db.financialCorrectionDeductionSettlementLine.count({ where: { deductionId: applied.deductionId, status: 'ACTIVE' } })).toBe(1);
  });

  it('fails closed when payable cannot absorb the whole deduction', async () => {
    await setHundredTryDeductionFixture();
    await applyBeforeSettlementFinancialCorrectionDeduction(await inputFor(), db as never);
    await db.financeLedgerEntry.update({ where: { id: ids.sale }, data: { amount: '110.00' } });
    await expect(createDraftApproval({ vendorId: ids.vendor })).rejects.toThrow('INSUFFICIENT_PAYABLE_FOR_FULL_DEDUCTION');
    expect(await db.financialCorrectionDeductionSettlementLine.count({ where: { deduction: { vendorId: ids.vendor } } })).toBe(0);
    expect(await db.vendorBalanceEvent.count({ where: { vendorId: ids.vendor } })).toBe(0);
  });

  it('keeps independent credit, deduction, and debt-offset sources gross and separately traceable', async () => {
    await setTwoHundredTryDeductionFixture();
    const deduction = await applyBeforeSettlementFinancialCorrectionDeduction(await inputFor(), db as never);
    const credit = await addIndependentHundredTryCredit();
    expect(credit.grossCreditMinor).toBe(10000);
    expect(deduction.grossDeductionMinor).toBe(20000);
    await addPayableSale('700.00');
    const preview = await previewApproval(ids.vendor);
    expect(preview.summary.correctionCreditMinor).toBe(10000);
    expect(preview.summary.correctionDeductionMinor).toBe(20000);
    expect(preview.summary.netPayableMinor).toBe(90000);
    const draft = await createDraftApproval({ vendorId: ids.vendor });
    settlementIds.push(draft.id);
    expect(draft.correctionCreditLines[0]?.creditId).toBe(credit.creditId);
    expect(draft.correctionDeductionLines[0]?.deductionId).toBe(deduction.deductionId);
    await approveSettlementApproval(draft.id, ids.admin);
    await db.vendorBalanceEvent.create({ data: {
      vendorId: ids.vendor, type: 'VENDOR_DEBT_CREATED', amountMinor: -6000, currency: 'TRY',
      sourceType: 'phase2e2_test_existing_debt', sourceId: `${runId}-coexist`, idempotencyKey: `${runId}-coexist-debt`,
    } });
    const payout = await preparePayoutBatch({ vendorId: ids.vendor }, ids.admin);
    payoutIds.push(payout.id);
    expect(payout.correctionCreditAmount).toBe('100.00');
    expect(payout.correctionDeductionAmount).toBe('200.00');
    expect(payout.payableBeforeDebtOffset).toBe('900.00');
    expect(payout.debtOffsetAmount).toBe('60.00');
    expect(payout.netAmount).toBe('840.00');
    expect(payout.correctionCreditLines).toHaveLength(1);
    expect(payout.correctionDeductionLines).toHaveLength(1);
    expect(await db.vendorBalanceEvent.count({ where: { vendorId: ids.vendor, type: 'VENDOR_DEBT_CREATED' } })).toBe(1);
  });

  it('rejects a baseline already consumed by another correction route', async () => {
    await setHundredTryDeductionFixture();
    const input = await inputFor();
    await db.financialCorrectionBaselineClaim.create({ data: {
      acceptedEvidenceSnapshotId: ids.snapshot, consumerType: 'before_settlement_vendor_credit', consumerId: `${runId}-other`,
    } });
    expect((await getBeforeSettlementFinancialCorrectionDeductionState(ids.review, db as never)).reasonCode).toBe('BASELINE_ALREADY_CLAIMED');
    await expect(applyBeforeSettlementFinancialCorrectionDeduction(input, db as never))
      .rejects.toMatchObject({ code: 'BASELINE_ALREADY_CLAIMED' });
    expect(await db.financialCorrectionAuthority.count({ where: { reviewId: ids.review } })).toBe(0);
    expect(await db.financialCorrectionDeduction.count({ where: { vendorId: ids.vendor } })).toBe(0);
  });

  it('carries the deduction into one PAID payout line without creating debt or changing the gross source', async () => {
    await setHundredTryDeductionFixture();
    const applied = await applyBeforeSettlementFinancialCorrectionDeduction(await inputFor(), db as never);
    await addPayableSale('850.00');
    const draft = await createDraftApproval({ vendorId: ids.vendor });
    settlementIds.push(draft.id);
    await approveSettlementApproval(draft.id, ids.admin);
    const payout = await preparePayoutBatch({ vendorId: ids.vendor }, ids.admin);
    payoutIds.push(payout.id);
    await markPayoutBatchReview(payout.id);
    const paid = await markPayoutBatchPaid(payout.id, {
      paidAt: '2026-09-29T12:00:00.000Z', paymentReference: `${runId}-payment`,
    }, ids.admin);
    expect(paid.status).toBe('paid');
    expect(paid.netAmount).toBe('900.00');
    expect(paid.correctionDeductionAmount).toBe('100.00');
    expect(await db.financialCorrectionDeductionPayoutLine.count({ where: { payoutBatchId: payout.id, status: 'PAID' } })).toBe(1);
    expect((await db.financialCorrectionDeduction.findUniqueOrThrow({ where: { id: applied.deductionId } })).amountMinor).toBe(10000);
    expect(await db.vendorBalanceEvent.count({ where: { vendorId: ids.vendor } })).toBe(0);
  });

  it.each([1, 2, 3, 4, 5])('does not silently omit a committed deduction in draft/Apply race %i', async () => {
    await setHundredTryDeductionFixture();
    await addPayableSale('1000.00');
    const raced = await Promise.allSettled([
      applyBeforeSettlementFinancialCorrectionDeduction(await inputFor(), db as never),
      createDraftApproval({ vendorId: ids.vendor }),
    ]);
    const applied = raced[0].status === 'fulfilled' ? raced[0].value : null;
    const draft = raced[1].status === 'fulfilled' ? raced[1].value : null;
    expect(applied || draft).toBeTruthy();
    if (draft) settlementIds.push(draft.id);
    if (applied && draft) {
      expect(draft.correctionDeductionLines.some((line) => line.deductionId === applied.deductionId)).toBe(true);
    }
  });
});
