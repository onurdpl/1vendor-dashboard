import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '../backend/node_modules/@prisma/client/index.js';

const databaseUrl = process.env.TEST_DATABASE_URL?.trim();
const describeWithPostgres = databaseUrl ? describe : describe.skip;

describeWithPostgres('approved-settlement financial correction deduction with isolated PostgreSQL', () => {
  const runId = `phase2e3b-${process.pid}-${Date.now()}`;
  const ids = {
    vendor: `${runId}-vendor`, admin: `${runId}-admin`, order: `${runId}-order`,
    allocation: `${runId}-allocation`, refundRecord: `${runId}-refund-record`,
    sale: `${runId}-sale`, refundLedger: `${runId}-refund-ledger`, snapshot: `${runId}-snapshot`,
    review: `${runId}-review`, incoming: `${runId}-incoming`, resolved: `${runId}-resolved`,
    origin: `${runId}-origin`, saleLine: `${runId}-sale-line`, refundLine: `${runId}-refund-line`,
    fulfillment: `${runId}-fulfillment`, historicalPayout: `${runId}-historical-payout`,
  };
  const sourceShopifyOrderId = `gid://shopify/Order/${runId}`;
  const sourceShopifyRefundId = `gid://shopify/Refund/${runId}`;
  let db: PrismaClient;
  let normalizeRefundEvidence: typeof import('../backend/src/modules/finance/refund-evidence-normalizer.service.js')['normalizeRefundEvidence'];
  let previewTerminalFinancialCorrection: typeof import('../backend/src/modules/finance/financial-correction-preview.service.js')['previewTerminalFinancialCorrection'];
  let applyDeduction: typeof import('../backend/src/modules/finance/financial-correction-approved-settlement-deduction.service.js')['applyApprovedSettlementFinancialCorrectionDeduction'];
  let getState: typeof import('../backend/src/modules/finance/financial-correction-approved-settlement-deduction.service.js')['getApprovedSettlementFinancialCorrectionDeductionState'];
  let createDraftApproval: typeof import('../backend/src/modules/finance/settlement-approval.service.js')['createDraftApproval'];
  let approveSettlementApproval: typeof import('../backend/src/modules/finance/settlement-approval.service.js')['approveSettlementApproval'];
  let cancelSettlementApproval: typeof import('../backend/src/modules/finance/settlement-approval.service.js')['cancelSettlementApproval'];
  let preparePayoutBatch: typeof import('../backend/src/modules/finance/finance.service.js')['preparePayoutBatch'];
  let cancelPayoutBatch: typeof import('../backend/src/modules/finance/finance.service.js')['cancelPayoutBatch'];
  let markPayoutBatchReview: typeof import('../backend/src/modules/finance/finance.service.js')['markPayoutBatchReview'];
  let markPayoutBatchPaid: typeof import('../backend/src/modules/finance/finance.service.js')['markPayoutBatchPaid'];
  let applyApprovedCredit: typeof import('../backend/src/modules/finance/financial-correction-approved-settlement-credit.service.js')['applyApprovedSettlementFinancialCorrectionCredit'];
  const settlementIds: string[] = [];
  const payoutIds: string[] = [];
  const extraSaleLedgerIds: string[] = [];
  const extraReviews: Array<{ refundRecord: string; refundLedger: string; snapshot: string;
    review: string; incoming: string; resolved: string }> = [];

  function normalized(amount: string, refundId = sourceShopifyRefundId, suffix = runId, total = '150.00') {
    return normalizeRefundEvidence({
      sourceShopifyRefundId: refundId, sourceShopifyOrderId, vendorAllocationId: ids.allocation,
      monetaryClassification: 'MONETARY_REFUND', refundTotalAmount: total, currency: 'TRY',
      transactions: [{ transactionGid: `gid://shopify/OrderTransaction/${suffix}`, kind: 'REFUND', status: 'SUCCESS', amount: total, currency: 'TRY' }],
      refundLines: [{ sourceLineItemId: `gid://shopify/LineItem/${runId}`, quantity: 1, subtotalAmount: amount, currency: 'TRY' }],
      historicalEconomicVendorId: ids.vendor, historicalSaleFinanceLedgerEntryId: ids.sale,
      supersededSaleLedgerIds: [],
    });
  }

  beforeEach(async () => {
    const target = new URL(databaseUrl!);
    if (process.env.PHASE2E3B_TEST_DATABASE_ISOLATED !== '1' ||
        !['127.0.0.1', 'localhost'].includes(target.hostname) ||
        target.pathname.slice(1) !== 'phase2e3b_validation') {
      throw new Error('Phase 2E3B PostgreSQL test requires the explicitly isolated local phase2e3b_validation database.');
    }
    process.env.DATABASE_URL = databaseUrl;
    ({ normalizeRefundEvidence } = await import('../backend/src/modules/finance/refund-evidence-normalizer.service.js'));
    ({ previewTerminalFinancialCorrection } = await import('../backend/src/modules/finance/financial-correction-preview.service.js'));
    ({ applyApprovedSettlementFinancialCorrectionDeduction: applyDeduction,
      getApprovedSettlementFinancialCorrectionDeductionState: getState } =
      await import('../backend/src/modules/finance/financial-correction-approved-settlement-deduction.service.js'));
    ({ createDraftApproval, approveSettlementApproval, cancelSettlementApproval } = await import('../backend/src/modules/finance/settlement-approval.service.js'));
    ({ preparePayoutBatch, cancelPayoutBatch, markPayoutBatchReview, markPayoutBatchPaid } =
      await import('../backend/src/modules/finance/finance.service.js'));
    ({ applyApprovedSettlementFinancialCorrectionCredit: applyApprovedCredit } =
      await import('../backend/src/modules/finance/financial-correction-approved-settlement-credit.service.js'));
    db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await db.$connect();
    const accepted = normalized('50.00');
    const incoming = normalized('150.00');
    await db.user.create({ data: { id: ids.admin, email: `${runId}@example.test`, name: 'Phase 2E3B Admin', role: 'ADMIN', passwordHash: 'test-only' } });
    await db.vendor.create({ data: { id: ids.vendor, name: 'Phase 2E3B Vendor' } });
    await db.shopifyOrder.create({ data: { id: ids.order, sourceShopifyOrderId, sourceShopifyOrderNumber: `#${runId}` } });
    await db.vendorAllocation.create({ data: {
      id: ids.allocation, sourceShopifyOrderId: ids.order, sourceShopifyOrderNumber: `#${runId}`,
      originalVendorId: ids.vendor, assignedVendorId: ids.vendor,
      fulfillmentStatus: 'Fulfilled', shippingStatus: 'Delivered',
    } });
    await db.fulfillment.create({ data: {
      id: ids.fulfillment, vendorAllocationId: ids.allocation, fulfillmentStatus: 'Fulfilled',
      fulfilledAt: new Date('2026-08-01T00:00:00.000Z'), shipmentUpdatedAt: new Date('2026-08-01T00:00:00.000Z'),
    } });
    await db.refundRecord.create({ data: {
      id: ids.refundRecord, vendorAllocationId: ids.allocation, sourceShopifyOrderId,
      sourceShopifyOrderNumber: `#${runId}`, sourceShopifyRefundId, amount: '50.00', status: 'processed',
    } });
    await db.financeLedgerEntry.create({ data: {
      id: ids.sale, vendorAllocationId: ids.allocation, vendorId: ids.vendor,
      entryType: 'sale', amount: '1050.00', commissionPercentSnapshot: '0.00',
      commissionVatPercentSnapshot: '20.00', settlementStatus: 'PAYABLE', payoutStatus: 'APPROVED',
      settlementDelayDaysSnapshot: 0,
    } });
    await db.financeLedgerEntry.create({ data: {
      id: ids.refundLedger, vendorAllocationId: ids.allocation, vendorId: ids.vendor,
      entryType: 'refund', amount: '50.00', commissionPercentSnapshot: '0.00',
      commissionVatPercentSnapshot: '20.00', settlementStatus: 'PAYABLE', payoutStatus: 'APPROVED',
    } });
    await db.refundEvidenceSnapshot.create({ data: {
      id: ids.snapshot, sourceShopifyRefundId, sourceShopifyOrderId, vendorAllocationId: ids.allocation,
      refundRecordId: ids.refundRecord, refundFinanceLedgerEntryId: ids.refundLedger,
      historicalEconomicVendorId: ids.vendor, historicalSaleFinanceLedgerEntryId: ids.sale,
      monetaryClassification: 'MONETARY_REFUND', refundTotalAmount: '150.00', currency: 'TRY',
      normalizedTransactionsJson: accepted.normalizedTransactionsJson,
      normalizedRefundLinesJson: accepted.normalizedRefundLinesJson,
      normalizedOwnershipJson: accepted.normalizedOwnershipJson,
      normalizedEvidenceJson: accepted.normalizedEvidenceJson,
      supersededSaleLedgerIdsJson: [], evidenceHash: accepted.evidenceHash,
      hashAlgorithm: accepted.hashAlgorithm, evidenceVersion: accepted.evidenceVersion,
      normalizationVersion: accepted.normalizationVersion, evidenceSource: 'phase2e3b_postgres_test',
      capturedAt: new Date('2026-09-01T10:00:00.000Z'),
    } });
    await db.refundTerminalEvidenceReview.create({ data: {
      id: ids.review, sourceShopifyRefundId, sourceShopifyOrderId, vendorAllocationId: ids.allocation,
      terminalRefundFinanceLedgerEntryId: ids.refundLedger, refundRecordId: ids.refundRecord,
      economicVendorId: ids.vendor, storedEvidenceSnapshotId: ids.snapshot, dedupeKey: `${runId}-dedupe`,
      conflictCategory: 'financial_evidence_conflict', storedEvidenceHash: accepted.evidenceHash,
      incomingEvidenceHash: incoming.evidenceHash, conflictSummaryJson: {}, status: 'RESOLVED',
      resolutionOutcome: 'CORRECTION_REQUIRED',
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
    await db.settlementApproval.create({ data: {
      id: ids.origin, vendorId: ids.vendor, status: 'APPROVED', currency: 'TRY',
      grossSalesMinor: 115000, refundTotalMinor: 15000, commissionMinor: 0, commissionVatMinor: 0,
      netPayableMinor: 100000, sourceSnapshotJson: {}, approvedBy: ids.admin,
      approvedAt: new Date('2026-09-01T11:00:00.000Z'),
      lines: { create: [
        { id: ids.saleLine, financeLedgerEntryId: ids.sale, lineType: 'SALE', amountMinor: 105000,
          commissionMinor: 0, commissionVatMinor: 0, payableImpactMinor: 105000, sourceSnapshotJson: {} },
        { id: ids.refundLine, financeLedgerEntryId: ids.refundLedger, lineType: 'REFUND', amountMinor: 5000,
          commissionMinor: 0, commissionVatMinor: 0, payableImpactMinor: -5000, sourceSnapshotJson: {} },
      ] },
    } });
  });

  afterEach(async () => {
    if (!db) return;
    if (payoutIds.length) {
      await db.financeEvent.deleteMany({ where: { referenceType: 'payout_batch', referenceId: { in: payoutIds } } });
      await db.vendorBalanceEvent.deleteMany({ where: { payoutBatchId: { in: payoutIds } } });
      await db.payoutBatchLine.deleteMany({ where: { payoutBatchId: { in: payoutIds } } });
      await db.financialCorrectionApprovedDeductionPayoutLine.deleteMany({ where: { payoutBatchId: { in: payoutIds } } });
      await db.financialCorrectionCreditPayoutLine.deleteMany({ where: { payoutBatchId: { in: payoutIds } } });
      await db.payoutBatch.deleteMany({ where: { id: { in: payoutIds } } });
    }
    if (settlementIds.length) {
      await db.financialCorrectionCreditSettlementLine.deleteMany({ where: { settlementApprovalId: { in: settlementIds } } });
      await db.settlementApproval.deleteMany({ where: { id: { in: settlementIds } } });
    }
    await db.vendorBalanceEvent.deleteMany({ where: { vendorId: ids.vendor } });
    for (const extra of extraReviews) {
      await db.financialCorrectionApprovedDeductionCoverage.deleteMany({ where: { deduction: { authority: { reviewId: extra.review } } } });
      await db.financialCorrectionDeduction.deleteMany({ where: { authority: { reviewId: extra.review } } });
      await db.financialCorrectionCreditSettlementLine.deleteMany({ where: { credit: { authority: { reviewId: extra.review } } } });
      await db.financialCorrectionCredit.deleteMany({ where: { authority: { reviewId: extra.review } } });
      await db.financialCorrectionAuthority.deleteMany({ where: { reviewId: extra.review } });
      await db.financialCorrectionBaselineClaim.deleteMany({ where: { acceptedEvidenceSnapshotId: extra.snapshot } });
      await db.refundTerminalEvidenceReviewEvent.deleteMany({ where: { id: extra.resolved } });
      await db.refundTerminalConflictEvidence.deleteMany({ where: { id: extra.incoming } });
      await db.refundTerminalEvidenceReview.deleteMany({ where: { id: extra.review } });
      await db.refundEvidenceSnapshot.deleteMany({ where: { id: extra.snapshot } });
      await db.financeLedgerEntry.deleteMany({ where: { id: extra.refundLedger } });
      await db.refundRecord.deleteMany({ where: { id: extra.refundRecord } });
    }
    await db.financialCorrectionApprovedDeductionCoverage.deleteMany({ where: { deduction: { authority: { reviewId: ids.review } } } });
    await db.financialCorrectionDeduction.deleteMany({ where: { authority: { reviewId: ids.review } } });
    await db.financialCorrectionCredit.deleteMany({ where: { authority: { reviewId: ids.review } } });
    await db.financialCorrectionAuthority.deleteMany({ where: { reviewId: ids.review } });
    await db.financialCorrectionBaselineClaim.deleteMany({ where: { acceptedEvidenceSnapshotId: ids.snapshot } });
    await db.payoutBatchLine.deleteMany({ where: { payoutBatchId: ids.historicalPayout } });
    await db.payoutBatch.deleteMany({ where: { id: ids.historicalPayout } });
    await db.settlementApprovalLine.deleteMany({ where: { settlementApprovalId: ids.origin } });
    await db.settlementApproval.deleteMany({ where: { id: ids.origin } });
    await db.refundTerminalEvidenceReviewEvent.deleteMany({ where: { id: ids.resolved } });
    await db.refundTerminalConflictEvidence.deleteMany({ where: { id: ids.incoming } });
    await db.refundTerminalEvidenceReview.deleteMany({ where: { id: ids.review } });
    await db.refundEvidenceSnapshot.deleteMany({ where: { id: ids.snapshot } });
    await db.financeLedgerEntry.deleteMany({ where: { id: { in: [ids.sale, ids.refundLedger] } } });
    if (extraSaleLedgerIds.length) await db.financeLedgerEntry.deleteMany({ where: { id: { in: extraSaleLedgerIds } } });
    await db.refundRecord.deleteMany({ where: { id: ids.refundRecord } });
    await db.fulfillment.deleteMany({ where: { id: ids.fulfillment } });
    await db.vendorAllocation.deleteMany({ where: { id: ids.allocation } });
    await db.shopifyOrder.deleteMany({ where: { id: ids.order } });
    await db.vendor.deleteMany({ where: { id: ids.vendor } });
    await db.user.deleteMany({ where: { id: ids.admin } });
    await db.$disconnect();
    settlementIds.length = 0;
    payoutIds.length = 0;
    extraReviews.length = 0;
    extraSaleLedgerIds.length = 0;
  });

  const inputFor = async () => {
    const preview = await previewTerminalFinancialCorrection(ids.review, db as never);
    return { reviewId: ids.review, previewFingerprint: preview.previewFingerprint,
      actorUserId: ids.admin, reason: 'Verified approved-settlement deduction' };
  };

  async function addReview(suffix: string, acceptedAmount: string, correctedAmount: string) {
    const extra = {
      refundRecord: `${runId}-${suffix}-record`, refundLedger: `${runId}-${suffix}-ledger`,
      snapshot: `${runId}-${suffix}-snapshot`, review: `${runId}-${suffix}-review`,
      incoming: `${runId}-${suffix}-incoming`, resolved: `${runId}-${suffix}-resolved`,
    };
    const refundId = `gid://shopify/Refund/${runId}-${suffix}`;
    const accepted = normalized(acceptedAmount, refundId, `${runId}-${suffix}`, acceptedAmount);
    const incoming = normalized(correctedAmount, refundId, `${runId}-${suffix}`, correctedAmount);
    await db.refundRecord.create({ data: {
      id: extra.refundRecord, vendorAllocationId: ids.allocation, sourceShopifyOrderId,
      sourceShopifyOrderNumber: `#${runId}`, sourceShopifyRefundId: refundId,
      amount: acceptedAmount, status: 'processed',
    } });
    await db.financeLedgerEntry.create({ data: {
      id: extra.refundLedger, vendorAllocationId: ids.allocation, vendorId: ids.vendor,
      entryType: 'refund', amount: acceptedAmount, commissionPercentSnapshot: '0.00',
      commissionVatPercentSnapshot: '20.00', settlementStatus: 'PAYABLE', payoutStatus: 'APPROVED',
    } });
    await db.refundEvidenceSnapshot.create({ data: {
      id: extra.snapshot, sourceShopifyRefundId: refundId, sourceShopifyOrderId,
      vendorAllocationId: ids.allocation, refundRecordId: extra.refundRecord,
      refundFinanceLedgerEntryId: extra.refundLedger, historicalEconomicVendorId: ids.vendor,
      historicalSaleFinanceLedgerEntryId: ids.sale, monetaryClassification: 'MONETARY_REFUND',
      refundTotalAmount: acceptedAmount, currency: 'TRY',
      normalizedTransactionsJson: accepted.normalizedTransactionsJson,
      normalizedRefundLinesJson: accepted.normalizedRefundLinesJson,
      normalizedOwnershipJson: accepted.normalizedOwnershipJson,
      normalizedEvidenceJson: accepted.normalizedEvidenceJson,
      supersededSaleLedgerIdsJson: [], evidenceHash: accepted.evidenceHash,
      hashAlgorithm: accepted.hashAlgorithm, evidenceVersion: accepted.evidenceVersion,
      normalizationVersion: accepted.normalizationVersion, evidenceSource: 'phase2e3b_postgres_test',
      capturedAt: new Date('2026-09-01T10:00:00.000Z'),
    } });
    await db.refundTerminalEvidenceReview.create({ data: {
      id: extra.review, sourceShopifyRefundId: refundId, sourceShopifyOrderId,
      vendorAllocationId: ids.allocation, terminalRefundFinanceLedgerEntryId: extra.refundLedger,
      refundRecordId: extra.refundRecord, economicVendorId: ids.vendor,
      storedEvidenceSnapshotId: extra.snapshot, dedupeKey: `${runId}-${suffix}-dedupe`,
      conflictCategory: 'financial_evidence_conflict', storedEvidenceHash: accepted.evidenceHash,
      incomingEvidenceHash: incoming.evidenceHash, conflictSummaryJson: {}, status: 'RESOLVED',
      resolutionOutcome: 'CORRECTION_REQUIRED',
    } });
    await db.refundTerminalConflictEvidence.create({ data: {
      id: extra.incoming, reviewId: extra.review, sourceShopifyRefundId: refundId, sourceShopifyOrderId,
      vendorAllocationId: ids.allocation, economicVendorId: ids.vendor,
      historicalSaleFinanceLedgerEntryId: ids.sale, supersededSaleLedgerIdsJson: [],
      refundTotalAmount: correctedAmount, currency: 'TRY', normalizedEvidenceJson: incoming.normalizedEvidenceJson,
      evidenceHash: incoming.evidenceHash, hashAlgorithm: incoming.hashAlgorithm,
      evidenceVersion: incoming.evidenceVersion, normalizationVersion: incoming.normalizationVersion,
    } });
    await db.refundTerminalEvidenceReviewEvent.create({ data: {
      id: extra.resolved, reviewId: extra.review, eventType: 'RESOLVED',
      resolutionOutcome: 'CORRECTION_REQUIRED', actorUserId: ids.admin,
    } });
    extraReviews.push(extra);
    const preview = await previewTerminalFinancialCorrection(extra.review, db as never);
    return { ...extra, input: { reviewId: extra.review, previewFingerprint: preview.previewFingerprint,
      actorUserId: ids.admin, reason: `Verified ${suffix}` } };
  }

  async function setMainCorrectedAmount(amount: string) {
    const incoming = normalized(amount, sourceShopifyRefundId, runId, amount);
    await db.refundTerminalConflictEvidence.update({ where: { id: ids.incoming }, data: {
      refundTotalAmount: amount, normalizedEvidenceJson: incoming.normalizedEvidenceJson,
      evidenceHash: incoming.evidenceHash,
    } });
    await db.refundTerminalEvidenceReview.update({ where: { id: ids.review }, data: {
      incomingEvidenceHash: incoming.evidenceHash,
    } });
  }

  it('reserves the whole historical approval and deducts from its first payout without debt or rewriting history', async () => {
    const originBefore = await db.settlementApproval.findUniqueOrThrow({ where: { id: ids.origin }, include: { lines: true } });
    const state = await getState(ids.review, db as never);
    expect(state.eligible).toBe(true);
    expect(state.approvedSettlement?.netPayableMinor).toBe(100000);
    expect(state.approvedSettlement?.availableCoverageMinor).toBe(100000);
    const applied = await applyDeduction(await inputFor(), db as never);
    expect(applied.grossDeductionMinor).toBe(10000);
    expect(applied.coverageAmountMinor).toBe(10000);
    expect(applied.historicalApprovedSettlementId).toBe(ids.origin);
    expect(await db.financialCorrectionBaselineClaim.count({ where: { acceptedEvidenceSnapshotId: ids.snapshot } })).toBe(1);
    expect(await db.financialCorrectionDeduction.count({ where: { authorityId: applied.id } })).toBe(1);
    expect(await db.financialCorrectionApprovedDeductionCoverage.count({ where: { deductionId: applied.deductionId } })).toBe(1);
    expect(await db.vendorBalanceEvent.count({ where: { vendorId: ids.vendor } })).toBe(0);
    expect(await db.settlementApproval.findUniqueOrThrow({ where: { id: ids.origin }, include: { lines: true } })).toEqual(originBefore);
    const payout = await preparePayoutBatch({ vendorId: ids.vendor }, ids.admin);
    payoutIds.push(payout.id);
    expect(payout.correctionDeductionAmount).toBe('100.00');
    expect(payout.payableBeforeDebtOffset).toBe('900.00');
    expect(payout.netAmount).toBe('900.00');
    expect(payout.lines).toHaveLength(2);
    expect(payout.approvedDeductionLines).toHaveLength(1);
    expect(await db.settlementApproval.findUniqueOrThrow({ where: { id: ids.origin }, include: { lines: true } })).toEqual(originBefore);
    await cancelPayoutBatch(payout.id);
    const reprepared = await preparePayoutBatch({ vendorId: ids.vendor }, ids.admin);
    payoutIds.push(reprepared.id);
    expect(reprepared.correctionDeductionAmount).toBe('100.00');
    expect(reprepared.netAmount).toBe('900.00');
    await cancelPayoutBatch(reprepared.id);
  });

  it('applies the deduction before existing vendor debt offset', async () => {
    await applyDeduction(await inputFor(), db as never);
    await db.vendorBalanceEvent.create({ data: {
      vendorId: ids.vendor, type: 'VENDOR_DEBT_CREATED', amountMinor: -6000, currency: 'TRY',
      sourceType: 'phase2e3b_test_existing_debt', sourceId: runId, idempotencyKey: `${runId}-debt`,
    } });
    const payout = await preparePayoutBatch({ vendorId: ids.vendor }, ids.admin);
    payoutIds.push(payout.id);
    expect(payout.payableBeforeDebtOffset).toBe('900.00');
    expect(payout.debtOffsetAmount).toBe('60.00');
    expect(payout.netAmount).toBe('840.00');
    expect(payout.approvedDeductionLines).toHaveLength(1);
    await cancelPayoutBatch(payout.id);
  });

  it('keeps separately approved credit, deduction and vendor debt distinct in the same payout', async () => {
    await setMainCorrectedAmount('250.00');
    const deduction = await applyDeduction(await inputFor(), db as never);
    expect(deduction.grossDeductionMinor).toBe(20000);
    const creditReview = await addReview('credit', '150.00', '50.00');
    const credit = await applyApprovedCredit(creditReview.input, db as never);
    const creditApproval = await db.settlementApproval.create({ data: {
      vendorId: ids.vendor, status: 'APPROVED', currency: 'TRY', grossSalesMinor: 0,
      refundTotalMinor: 0, commissionMinor: 0, commissionVatMinor: 0,
      netPayableMinor: 10000, correctionCreditMinor: 10000, sourceSnapshotJson: {},
      approvedAt: new Date(), approvedBy: ids.admin,
      correctionCreditLines: { create: [{ creditId: credit.creditId, amountMinor: 10000, status: 'ACTIVE' }] },
    } });
    settlementIds.push(creditApproval.id);
    await db.vendorBalanceEvent.create({ data: {
      vendorId: ids.vendor, type: 'VENDOR_DEBT_CREATED', amountMinor: -6000, currency: 'TRY',
      sourceType: 'phase2e3b_test_existing_debt', sourceId: runId, idempotencyKey: `${runId}-debt`,
    } });
    const payout = await preparePayoutBatch({ vendorId: ids.vendor }, ids.admin);
    payoutIds.push(payout.id);
    expect(payout.correctionCreditAmount).toBe('100.00');
    expect(payout.correctionDeductionAmount).toBe('200.00');
    expect(payout.payableBeforeDebtOffset).toBe('900.00');
    expect(payout.debtOffsetAmount).toBe('60.00');
    expect(payout.netAmount).toBe('840.00');
    expect(payout.lines).toHaveLength(2);
    expect(payout.correctionCreditLines).toHaveLength(1);
    expect(payout.approvedDeductionLines).toHaveLength(1);
    await cancelPayoutBatch(payout.id);
  });

  it('fails closed when the single lineage-matched approval cannot cover the whole deduction', async () => {
    await db.settlementApproval.update({ where: { id: ids.origin }, data: { netPayableMinor: 6000 } });
    await db.settlementApprovalLine.update({ where: { id: ids.saleLine }, data: { payableImpactMinor: 11000 } });
    const state = await getState(ids.review, db as never);
    expect(state.eligible).toBe(false);
    expect(state.reasonCode).toBe('INSUFFICIENT_APPROVED_PAYABLE');
    await expect(applyDeduction(await inputFor(), db as never)).rejects.toMatchObject({ code: 'INSUFFICIENT_APPROVED_PAYABLE' });
    expect(await db.financialCorrectionAuthority.count({ where: { reviewId: ids.review } })).toBe(0);
    expect(await db.financialCorrectionApprovedDeductionCoverage.count({ where: { vendorId: ids.vendor } })).toBe(0);
    expect(await db.vendorBalanceEvent.count({ where: { vendorId: ids.vendor } })).toBe(0);
  });

  it('does not pool another approved settlement without the correction SALE lineage', async () => {
    await db.settlementApproval.update({ where: { id: ids.origin }, data: { netPayableMinor: 6000 } });
    await db.settlementApprovalLine.update({ where: { id: ids.saleLine }, data: { payableImpactMinor: 11000 } });
    const otherSale = `${runId}-other-sale`;
    extraSaleLedgerIds.push(otherSale);
    await db.financeLedgerEntry.create({ data: {
      id: otherSale, vendorAllocationId: ids.allocation, vendorId: ids.vendor, entryType: 'sale',
      amount: '50.00', settlementStatus: 'PAYABLE', payoutStatus: 'APPROVED',
    } });
    const otherApproval = await db.settlementApproval.create({ data: {
      vendorId: ids.vendor, status: 'APPROVED', currency: 'TRY', grossSalesMinor: 5000,
      refundTotalMinor: 0, commissionMinor: 0, commissionVatMinor: 0, netPayableMinor: 5000,
      sourceSnapshotJson: {}, approvedAt: new Date(), approvedBy: ids.admin,
      lines: { create: [{ financeLedgerEntryId: otherSale, lineType: 'SALE', amountMinor: 5000,
        commissionMinor: 0, commissionVatMinor: 0, payableImpactMinor: 5000, sourceSnapshotJson: {} }] },
    } });
    settlementIds.push(otherApproval.id);
    await expect(applyDeduction(await inputFor(), db as never))
      .rejects.toMatchObject({ code: 'INSUFFICIENT_APPROVED_PAYABLE' });
    expect(await db.financialCorrectionApprovedDeductionCoverage.count({ where: { vendorId: ids.vendor } })).toBe(0);
  });

  it('does not count a separately approved correction credit as coverage', async () => {
    await db.settlementApproval.update({ where: { id: ids.origin }, data: { netPayableMinor: 6000 } });
    await db.settlementApprovalLine.update({ where: { id: ids.saleLine }, data: { payableImpactMinor: 11000 } });
    const creditReview = await addReview('credit', '150.00', '50.00');
    const credit = await applyApprovedCredit(creditReview.input, db as never);
    const creditApproval = await db.settlementApproval.create({ data: {
      vendorId: ids.vendor, status: 'APPROVED', currency: 'TRY', grossSalesMinor: 0,
      refundTotalMinor: 0, commissionMinor: 0, commissionVatMinor: 0,
      netPayableMinor: 10000, correctionCreditMinor: 10000, sourceSnapshotJson: {},
      approvedAt: new Date(), approvedBy: ids.admin,
      correctionCreditLines: { create: [{ creditId: credit.creditId, amountMinor: 10000, status: 'ACTIVE' }] },
    } });
    settlementIds.push(creditApproval.id);
    await expect(applyDeduction(await inputFor(), db as never))
      .rejects.toMatchObject({ code: 'INSUFFICIENT_APPROVED_PAYABLE' });
    expect(await db.financialCorrectionApprovedDeductionCoverage.count({ where: { vendorId: ids.vendor } })).toBe(0);
  });

  it('prevents two distinct corrections from over-reserving one 250 TRY origin', async () => {
    await db.financeLedgerEntry.update({ where: { id: ids.sale }, data: { amount: '300.00' } });
    await db.settlementApprovalLine.update({ where: { id: ids.saleLine }, data: {
      amountMinor: 30000, payableImpactMinor: 30000,
    } });
    await db.settlementApproval.update({ where: { id: ids.origin }, data: {
      grossSalesMinor: 30000, netPayableMinor: 25000,
    } });
    const second = await addReview('second', '50.00', '250.00');
    const first = await applyDeduction(await inputFor(), db as never);
    expect(first.coverageAmountMinor).toBe(10000);
    await expect(applyDeduction(second.input, db as never))
      .rejects.toMatchObject({ code: 'INSUFFICIENT_APPROVED_PAYABLE' });
    expect(await db.financialCorrectionApprovedDeductionCoverage.count({ where: { settlementApprovalId: ids.origin } })).toBe(1);
  });

  it('serializes competing distinct deductions against the same approval', async () => {
    await db.financeLedgerEntry.update({ where: { id: ids.sale }, data: { amount: '300.00' } });
    await db.settlementApprovalLine.update({ where: { id: ids.saleLine }, data: {
      amountMinor: 30000, payableImpactMinor: 30000,
    } });
    await db.settlementApproval.update({ where: { id: ids.origin }, data: {
      grossSalesMinor: 30000, netPayableMinor: 25000,
    } });
    const second = await addReview('second', '50.00', '250.00');
    const results = await Promise.allSettled([
      applyDeduction(await inputFor(), db as never), applyDeduction(second.input, db as never),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const coverages = await db.financialCorrectionApprovedDeductionCoverage.findMany({
      where: { settlementApprovalId: ids.origin },
    });
    expect(coverages).toHaveLength(1);
    expect(coverages[0]?.amountMinor).toBeLessThanOrEqual(25000);
  });

  it('blocks cancellation of an origin approval with active coverage', async () => {
    await applyDeduction(await inputFor(), db as never);
    await expect(cancelSettlementApproval(ids.origin, ids.admin)).rejects.toThrow('ORIGIN_SETTLEMENT_CANCELLATION_BLOCKED');
    expect((await db.settlementApproval.findUniqueOrThrow({ where: { id: ids.origin } })).status).toBe('APPROVED');
  });

  it.each(['DRAFT', 'REVIEW', 'PAID', 'CANCELLED'] as const)('rejects %s payout history before Apply', async (status) => {
    await db.payoutBatch.create({ data: { id: ids.historicalPayout, vendorId: ids.vendor, currency: 'TRY',
      status, paidAt: status === 'PAID' ? new Date('2026-09-01T12:00:00.000Z') : null } });
    await db.payoutBatchLine.create({ data: {
      payoutBatchId: ids.historicalPayout, financeLedgerEntryId: ids.sale,
      settlementApprovalLineId: ids.saleLine, amountSnapshot: '1050.00',
    } });
    await expect(applyDeduction(await inputFor(), db as never)).rejects.toMatchObject({ code: 'PAYOUT_HISTORY_EXISTS' });
    expect(await db.financialCorrectionAuthority.count({ where: { reviewId: ids.review } })).toBe(0);
  });

  it('rolls back authority, deduction and claim if coverage insertion fails', async () => {
    await db.$executeRawUnsafe(`CREATE FUNCTION phase2e3b_reject_coverage_insert() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'phase2e3b injected coverage failure'; END; $$`);
    await db.$executeRawUnsafe(`CREATE TRIGGER phase2e3b_reject_coverage_insert BEFORE INSERT ON "FinancialCorrectionApprovedDeductionCoverage"
      FOR EACH ROW EXECUTE FUNCTION phase2e3b_reject_coverage_insert()`);
    try {
      await expect(applyDeduction(await inputFor(), db as never)).rejects.toThrow('phase2e3b injected coverage failure');
      expect(await db.financialCorrectionAuthority.count({ where: { reviewId: ids.review } })).toBe(0);
      expect(await db.financialCorrectionDeduction.count({ where: { vendorId: ids.vendor } })).toBe(0);
      expect(await db.financialCorrectionBaselineClaim.count({ where: { acceptedEvidenceSnapshotId: ids.snapshot } })).toBe(0);
    } finally {
      await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS phase2e3b_reject_coverage_insert ON "FinancialCorrectionApprovedDeductionCoverage"');
      await db.$executeRawUnsafe('DROP FUNCTION IF EXISTS phase2e3b_reject_coverage_insert()');
    }
  });

  it('blocks an accepted baseline claimed by another correction route', async () => {
    await db.financialCorrectionBaselineClaim.create({ data: {
      acceptedEvidenceSnapshotId: ids.snapshot,
      consumerType: 'zero_net_acknowledgement', consumerId: `${runId}-other`,
    } });
    await expect(applyDeduction(await inputFor(), db as never))
      .rejects.toMatchObject({ code: 'BASELINE_ALREADY_CLAIMED' });
    expect(await db.financialCorrectionApprovedDeductionCoverage.count({ where: { vendorId: ids.vendor } })).toBe(0);
  });

  it('keeps payout review and Mark Paid tied to the covered deduction', async () => {
    await applyDeduction(await inputFor(), db as never);
    const draft = await preparePayoutBatch({ vendorId: ids.vendor }, ids.admin);
    payoutIds.push(draft.id);
    const review = await markPayoutBatchReview(draft.id);
    expect(review.status).toBe('review');
    const paid = await markPayoutBatchPaid(draft.id, { paidAt: '2026-09-02T12:00:00.000Z' }, ids.admin);
    expect(paid.status).toBe('paid');
    expect(paid.netAmount).toBe('900.00');
    expect((await db.financialCorrectionApprovedDeductionPayoutLine.findFirstOrThrow({
      where: { payoutBatchId: draft.id },
    })).status).toBe('PAID');
    await expect(cancelPayoutBatch(draft.id)).rejects.toThrow('Paid payout batches cannot be cancelled.');
  });

  it('deduplicates retries and rejects a stale fingerprint', async () => {
    const input = await inputFor();
    await expect(applyDeduction({ ...input, previewFingerprint: `financial-correction-preview-v1:${'0'.repeat(64)}` }, db as never))
      .rejects.toMatchObject({ code: 'PREVIEW_STALE' });
    const first = await applyDeduction(input, db as never);
    expect(await applyDeduction(input, db as never)).toEqual(first);
    expect(await db.financialCorrectionApprovedDeductionCoverage.count({ where: { vendorId: ids.vendor } })).toBe(1);
    await expect(applyDeduction({ ...input, actorUserId: 'other-admin' }, db as never))
      .rejects.toMatchObject({ code: 'DEDUCTION_EFFECT_ALREADY_EXISTS' });
  });

  it.each([1, 2, 3, 4, 5])('serializes Apply with payout preparation race %i', async () => {
    const results = await Promise.allSettled([
      applyDeduction(await inputFor(), db as never), preparePayoutBatch({ vendorId: ids.vendor }, ids.admin),
    ]);
    const applied = results[0].status === 'fulfilled' ? results[0].value : null;
    const payout = results[1].status === 'fulfilled' ? results[1].value : null;
    if (payout) payoutIds.push(payout.id);
    if (applied && payout) expect(payout.correctionDeductionAmount).toBe('100.00');
    if (!applied && payout) expect(payout.correctionDeductionAmount).toBe('0.00');
    if (applied && !payout) expect(await db.financialCorrectionApprovedDeductionCoverage.count({ where: { vendorId: ids.vendor } })).toBe(1);
    if (payout) await cancelPayoutBatch(payout.id);
  });
});
