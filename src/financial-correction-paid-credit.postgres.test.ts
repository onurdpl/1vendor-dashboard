import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '../backend/node_modules/@prisma/client/index.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
const describeWithPostgres = testDatabaseUrl ? describe : describe.skip;

describeWithPostgres('paid financial correction credit with isolated PostgreSQL', () => {
  const runId = `phase2d-${process.pid}-${Date.now()}`;
  const ids = {
    vendor: `${runId}-vendor`, admin: `${runId}-admin`, order: `${runId}-order`,
    allocation: `${runId}-allocation`, refundRecord: `${runId}-refund-record`,
    sale: `${runId}-sale`, refundLedger: `${runId}-refund-ledger`, snapshot: `${runId}-snapshot`,
    review: `${runId}-review`, incoming: `${runId}-incoming`, resolved: `${runId}-resolved`,
    historicalSettlement: `${runId}-historical-settlement`, historicalLine: `${runId}-historical-line`,
    historicalPayout: `${runId}-historical-payout`, historicalPayoutLine: `${runId}-historical-payout-line`,
    futureAllocation: `${runId}-future-allocation`, futureFulfillment: `${runId}-future-fulfillment`,
    futureSale: `${runId}-future-sale`,
  };
  const sourceShopifyOrderId = `gid://shopify/Order/${runId}`;
  const sourceShopifyRefundId = `gid://shopify/Refund/${runId}`;
  const paidAt = new Date('2026-09-01T12:00:00.000Z');
  let db: PrismaClient;
  let normalizeRefundEvidence: typeof import('../backend/src/modules/finance/refund-evidence-normalizer.service.js')['normalizeRefundEvidence'];
  let previewTerminalFinancialCorrection: typeof import('../backend/src/modules/finance/financial-correction-preview.service.js')['previewTerminalFinancialCorrection'];
  let applyPaidFinancialCorrectionCredit: typeof import('../backend/src/modules/finance/financial-correction-paid-credit.service.js')['applyPaidFinancialCorrectionCredit'];
  let getPaidFinancialCorrectionCreditState: typeof import('../backend/src/modules/finance/financial-correction-paid-credit.service.js')['getPaidFinancialCorrectionCreditState'];
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

  function normalized(amount: string) {
    return normalizeRefundEvidence({
      sourceShopifyRefundId, sourceShopifyOrderId, vendorAllocationId: ids.allocation,
      monetaryClassification: 'MONETARY_REFUND', refundTotalAmount: '150.00', currency: 'TRY',
      transactions: [{ transactionGid: `gid://shopify/OrderTransaction/${runId}`, kind: 'REFUND', status: 'SUCCESS', amount: '150.00', currency: 'TRY' }],
      refundLines: [{ sourceLineItemId: `gid://shopify/LineItem/${runId}`, quantity: 2, subtotalAmount: amount, currency: 'TRY' }],
      historicalEconomicVendorId: ids.vendor, historicalSaleFinanceLedgerEntryId: ids.sale,
      supersededSaleLedgerIds: [],
    });
  }

  async function setHundredTryCreditFixture() {
    const accepted = normalized('150.00');
    const incoming = normalized('50.00');
    await db.refundRecord.update({ where: { id: ids.refundRecord }, data: { amount: '150.00' } });
    await db.financeLedgerEntry.updateMany({ where: { id: { in: [ids.sale, ids.refundLedger] } },
      data: { commissionPercentSnapshot: '0.00', commissionVatPercentSnapshot: '20.00' } });
    await db.financeLedgerEntry.update({ where: { id: ids.refundLedger }, data: { amount: '150.00' } });
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

  beforeEach(async () => {
    const target = new URL(testDatabaseUrl!);
    if (process.env.PHASE2D_TEST_DATABASE_ISOLATED !== '1' ||
        !['127.0.0.1', 'localhost'].includes(target.hostname) ||
        target.pathname.slice(1) !== 'phase2d_validation') {
      throw new Error('Phase 2D PostgreSQL test requires the explicitly isolated local phase2d_validation database.');
    }
    process.env.DATABASE_URL = testDatabaseUrl;
    ({ normalizeRefundEvidence } = await import('../backend/src/modules/finance/refund-evidence-normalizer.service.js'));
    ({ previewTerminalFinancialCorrection } = await import('../backend/src/modules/finance/financial-correction-preview.service.js'));
    ({ applyPaidFinancialCorrectionCredit, getPaidFinancialCorrectionCreditState } = await import('../backend/src/modules/finance/financial-correction-paid-credit.service.js'));
    ({ previewApproval, createDraftApproval, approveSettlementApproval, cancelSettlementApproval } = await import('../backend/src/modules/finance/settlement-approval.service.js'));
    ({ preparePayoutBatch, cancelPayoutBatch, markPayoutBatchReview, markPayoutBatchPaid } = await import('../backend/src/modules/finance/finance.service.js'));
    db = new PrismaClient({ datasources: { db: { url: testDatabaseUrl } } });
    await db.$connect();
    const accepted = normalized('120.00');
    const incoming = normalized('100.00');
    await db.user.create({ data: { id: ids.admin, email: `${runId}@example.test`, name: 'Phase 2D Admin', role: 'ADMIN', passwordHash: 'test-only' } });
    await db.vendor.create({ data: { id: ids.vendor, name: 'Phase 2D Vendor' } });
    await db.shopifyOrder.create({ data: { id: ids.order, sourceShopifyOrderId, sourceShopifyOrderNumber: `#${runId}` } });
    await db.vendorAllocation.create({ data: {
      id: ids.allocation, sourceShopifyOrderId: ids.order, sourceShopifyOrderNumber: `#${runId}`,
      originalVendorId: ids.vendor, assignedVendorId: ids.vendor,
    } });
    await db.refundRecord.create({ data: {
      id: ids.refundRecord, vendorAllocationId: ids.allocation, sourceShopifyOrderId,
      sourceShopifyOrderNumber: `#${runId}`, sourceShopifyRefundId, amount: '120.00', status: 'processed',
    } });
    await db.financeLedgerEntry.create({ data: {
      id: ids.sale, vendorAllocationId: ids.allocation, vendorId: ids.vendor,
      entryType: 'sale', amount: '200.00', commissionPercentSnapshot: '10.00',
      commissionVatPercentSnapshot: '20.00', settlementStatus: 'SETTLED', payoutStatus: 'PAID',
    } });
    await db.financeLedgerEntry.create({ data: {
      id: ids.refundLedger, vendorAllocationId: ids.allocation, vendorId: ids.vendor,
      entryType: 'refund', amount: '120.00', commissionPercentSnapshot: '10.00',
      commissionVatPercentSnapshot: '20.00', settlementStatus: 'SETTLED', payoutStatus: 'PAID',
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
      normalizationVersion: accepted.normalizationVersion, evidenceSource: 'phase2d_postgres_test',
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
    await db.settlementApproval.create({ data: {
      id: ids.historicalSettlement, vendorId: ids.vendor, status: 'APPROVED', currency: 'TRY',
      grossSalesMinor: 20000, refundTotalMinor: 0, commissionMinor: 2000,
      commissionVatMinor: 400, netPayableMinor: 17600, sourceSnapshotJson: {},
    } });
    await db.settlementApprovalLine.create({ data: {
      id: ids.historicalLine, settlementApprovalId: ids.historicalSettlement, financeLedgerEntryId: ids.sale,
      lineType: 'SALE', amountMinor: 20000, commissionMinor: 2000,
      commissionVatMinor: 400, payableImpactMinor: 17600, sourceSnapshotJson: {},
    } });
    await db.payoutBatch.create({ data: {
      id: ids.historicalPayout, vendorId: ids.vendor, status: 'PAID', paidAt, currency: 'TRY',
      grossAmount: '200.00', commissionAmount: '20.00', commissionVatAmount: '4.00', netAmount: '176.00',
    } });
    await db.payoutBatchLine.create({ data: {
      id: ids.historicalPayoutLine, payoutBatchId: ids.historicalPayout,
      financeLedgerEntryId: ids.sale, settlementApprovalLineId: ids.historicalLine, amountSnapshot: '176.00',
    } });
  });

  afterEach(async () => {
    if (!db) return;
    if (payoutIds.length) {
      await db.financeEvent.deleteMany({ where: { referenceType: 'payout_batch', referenceId: { in: payoutIds } } });
      await db.vendorBalanceEvent.deleteMany({ where: { payoutBatchId: { in: payoutIds } } });
      await db.payoutBatchLine.deleteMany({ where: { payoutBatchId: { in: payoutIds } } });
      await db.financialCorrectionCreditPayoutLine.deleteMany({ where: { payoutBatchId: { in: payoutIds } } });
      await db.payoutBatch.deleteMany({ where: { id: { in: payoutIds } } });
    }
    if (settlementIds.length) {
      await db.settlementApprovalLine.deleteMany({ where: { settlementApprovalId: { in: settlementIds } } });
      await db.financialCorrectionCreditSettlementLine.deleteMany({ where: { settlementApprovalId: { in: settlementIds } } });
      await db.settlementApproval.deleteMany({ where: { id: { in: settlementIds } } });
    }
    await db.vendorBalanceEvent.deleteMany({ where: { vendorId: ids.vendor } });
    await db.financialCorrectionCredit.deleteMany({ where: { authority: { reviewId: ids.review } } });
    await db.financialCorrectionAuthority.deleteMany({ where: { reviewId: ids.review } });
    await db.financialCorrectionBaselineClaim.deleteMany({ where: { acceptedEvidenceSnapshotId: ids.snapshot } });
    await db.payoutBatchLine.deleteMany({ where: { id: ids.historicalPayoutLine } });
    await db.payoutBatch.deleteMany({ where: { id: ids.historicalPayout } });
    await db.settlementApprovalLine.deleteMany({ where: { id: ids.historicalLine } });
    await db.settlementApproval.deleteMany({ where: { id: ids.historicalSettlement } });
    await db.refundTerminalEvidenceReviewEvent.deleteMany({ where: { id: ids.resolved } });
    await db.refundTerminalConflictEvidence.deleteMany({ where: { id: ids.incoming } });
    await db.refundTerminalEvidenceReview.deleteMany({ where: { id: ids.review } });
    await db.refundEvidenceSnapshot.deleteMany({ where: { id: ids.snapshot } });
    await db.financeLedgerEntry.deleteMany({ where: { id: { in: [ids.sale, ids.refundLedger] } } });
    await db.financeLedgerEntry.deleteMany({ where: { id: ids.futureSale } });
    await db.fulfillment.deleteMany({ where: { id: ids.futureFulfillment } });
    await db.refundRecord.deleteMany({ where: { id: ids.refundRecord } });
    await db.vendorAllocation.deleteMany({ where: { id: ids.allocation } });
    await db.vendorAllocation.deleteMany({ where: { id: ids.futureAllocation } });
    await db.shopifyOrder.deleteMany({ where: { id: ids.order } });
    await db.vendor.deleteMany({ where: { id: ids.vendor } });
    await db.user.deleteMany({ where: { id: ids.admin } });
    await db.$disconnect();
    settlementIds.length = 0;
    payoutIds.length = 0;
  });

  it('applies one gross credit without changing PAID history and rejects duplicate economic use', async () => {
    const preview = await previewTerminalFinancialCorrection(ids.review, db as never);
    expect(preview.economicDirection).toBe('VENDOR_CREDIT');
    expect(preview.difference.vendorPayableReversalMinor).toBe(-1760);
    const input = { reviewId: ids.review, previewFingerprint: preview.previewFingerprint,
      actorUserId: ids.admin, reason: 'Verified correction credit' };
    await expect(applyPaidFinancialCorrectionCredit({ ...input,
      previewFingerprint: `financial-correction-preview-v1:${'0'.repeat(64)}` }, db as never))
      .rejects.toMatchObject({ code: 'PREVIEW_STALE' });
    await db.payoutBatch.update({ where: { id: ids.historicalPayout }, data: { status: 'REVIEW', paidAt: null } });
    await expect(applyPaidFinancialCorrectionCredit(input, db as never))
      .rejects.toMatchObject({ code: 'PAYOUT_NOT_PAID' });
    await db.payoutBatch.update({ where: { id: ids.historicalPayout }, data: { status: 'PAID', paidAt } });
    expect(await db.financialCorrectionAuthority.count({ where: { reviewId: ids.review } })).toBe(0);
    const historicalBefore = await Promise.all([
      db.financeLedgerEntry.findUniqueOrThrow({ where: { id: ids.sale } }),
      db.financeLedgerEntry.findUniqueOrThrow({ where: { id: ids.refundLedger } }),
      db.refundEvidenceSnapshot.findUniqueOrThrow({ where: { id: ids.snapshot } }),
      db.refundTerminalConflictEvidence.findUniqueOrThrow({ where: { id: ids.incoming } }),
      db.settlementApproval.findUniqueOrThrow({ where: { id: ids.historicalSettlement } }),
      db.payoutBatch.findUniqueOrThrow({ where: { id: ids.historicalPayout } }),
    ]);
    const concurrent = await Promise.allSettled([
      applyPaidFinancialCorrectionCredit(input, db as never),
      applyPaidFinancialCorrectionCredit(input, db as never),
    ]);
    const firstResult = concurrent.find((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof applyPaidFinancialCorrectionCredit>>> => result.status === 'fulfilled');
    expect(firstResult).toBeDefined();
    const first = firstResult!.value;
    const retry = await applyPaidFinancialCorrectionCredit(input, db as never);
    expect(retry.id).toBe(first.id);
    expect(first.grossCreditMinor).toBe(1760);
    expect(await db.financialCorrectionAuthority.count({ where: { reviewId: ids.review } })).toBe(1);
    expect(await db.financialCorrectionCredit.count({ where: { authorityId: first.id } })).toBe(1);
    expect(await db.vendorBalanceEvent.count({ where: { financialCorrectionAuthorityId: first.id } })).toBe(0);
    expect(await Promise.all([
      db.financeLedgerEntry.findUniqueOrThrow({ where: { id: ids.sale } }),
      db.financeLedgerEntry.findUniqueOrThrow({ where: { id: ids.refundLedger } }),
      db.refundEvidenceSnapshot.findUniqueOrThrow({ where: { id: ids.snapshot } }),
      db.refundTerminalConflictEvidence.findUniqueOrThrow({ where: { id: ids.incoming } }),
      db.settlementApproval.findUniqueOrThrow({ where: { id: ids.historicalSettlement } }),
      db.payoutBatch.findUniqueOrThrow({ where: { id: ids.historicalPayout } }),
    ])).toEqual(historicalBefore);
    expect((await db.payoutBatch.findUniqueOrThrow({ where: { id: ids.historicalPayout } })).status).toBe('PAID');
    expect((await getPaidFinancialCorrectionCreditState(ids.review, db as never)).eligible).toBe(false);
  });

  it('rejects a baseline already claimed by zero-net or deduction without creating credit authority', async () => {
    const preview = await previewTerminalFinancialCorrection(ids.review, db as never);
    const input = { reviewId: ids.review, previewFingerprint: preview.previewFingerprint,
      actorUserId: ids.admin, reason: 'Existing baseline must stay exclusive' };
    for (const consumerType of ['zero_net_acknowledgement', 'paid_vendor_debt']) {
      await db.financialCorrectionBaselineClaim.create({ data: {
        acceptedEvidenceSnapshotId: ids.snapshot, consumerType, consumerId: `${runId}-${consumerType}`,
      } });
      await expect(applyPaidFinancialCorrectionCredit(input, db as never))
        .rejects.toMatchObject({ code: 'BASELINE_ALREADY_CLAIMED' });
      expect(await db.financialCorrectionAuthority.count({ where: { reviewId: ids.review } })).toBe(0);
      expect(await db.financialCorrectionCredit.count({ where: { vendorId: ids.vendor } })).toBe(0);
      await db.financialCorrectionBaselineClaim.delete({ where: { acceptedEvidenceSnapshotId: ids.snapshot } });
    }
  });

  it('rolls back the baseline claim and authority when the gross credit write fails', async () => {
    const preview = await previewTerminalFinancialCorrection(ids.review, db as never);
    await db.$executeRaw`ALTER TABLE "FinancialCorrectionCredit" ADD CONSTRAINT "Phase2DRejectCreditTest" CHECK (false) NOT VALID`;
    try {
      await expect(applyPaidFinancialCorrectionCredit({
        reviewId: ids.review, previewFingerprint: preview.previewFingerprint,
        actorUserId: ids.admin, reason: 'Atomic credit creation',
      }, db as never)).rejects.toThrow();
      expect(await db.financialCorrectionAuthority.count({ where: { reviewId: ids.review } })).toBe(0);
      expect(await db.financialCorrectionBaselineClaim.count({ where: { acceptedEvidenceSnapshotId: ids.snapshot } })).toBe(0);
      expect(await db.financialCorrectionCredit.count({ where: { vendorId: ids.vendor } })).toBe(0);
    } finally {
      await db.$executeRaw`ALTER TABLE "FinancialCorrectionCredit" DROP CONSTRAINT "Phase2DRejectCreditTest"`;
    }
  });

  it('settles and pays a credit with no future SALE, retaining gross provenance', async () => {
    await setHundredTryCreditFixture();
    const correctionPreview = await previewTerminalFinancialCorrection(ids.review, db as never);
    expect(correctionPreview.difference.vendorPayableReversalMinor).toBe(-10000);
    await applyPaidFinancialCorrectionCredit({ reviewId: ids.review, previewFingerprint: correctionPreview.previewFingerprint,
      actorUserId: ids.admin, reason: 'Standalone credit payout' }, db as never);
    const preview = await previewApproval(ids.vendor);
    expect(preview.summary.eligibleRowCount).toBe(0);
    expect(preview.correctionCredits).toHaveLength(1);
    expect(preview.summary.correctionCreditMinor).toBe(10000);
    const concurrentDrafts = await Promise.allSettled([
      createDraftApproval({ vendorId: ids.vendor }), createDraftApproval({ vendorId: ids.vendor }),
    ]);
    expect(concurrentDrafts.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const draft = (concurrentDrafts.find((result) => result.status === 'fulfilled') as PromiseFulfilledResult<Awaited<ReturnType<typeof createDraftApproval>>>).value;
    settlementIds.push(draft.id);
    expect(draft.lines).toHaveLength(0);
    expect(draft.correctionCreditLines).toHaveLength(1);
    expect(draft.netPayableMinor).toBe(10000);
    const approved = await approveSettlementApproval(draft.id, ids.admin);
    expect(approved.status).toBe('approved');
    const concurrentPayouts = await Promise.allSettled([
      preparePayoutBatch({ vendorId: ids.vendor }, ids.admin),
      preparePayoutBatch({ vendorId: ids.vendor }, ids.admin),
    ]);
    expect(concurrentPayouts.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const payout = (concurrentPayouts.find((result) => result.status === 'fulfilled') as PromiseFulfilledResult<Awaited<ReturnType<typeof preparePayoutBatch>>>).value;
    payoutIds.push(payout.id);
    expect(payout.lineCount).toBe(1);
    expect(payout.correctionCreditAmount).toBe('100.00');
    expect(payout.netAmount).toBe('100.00');
    expect(payout.correctionCreditLines).toHaveLength(1);
    await expect(preparePayoutBatch({ vendorId: ids.vendor }, ids.admin)).rejects.toThrow();
    await cancelPayoutBatch(payout.id);
    await cancelSettlementApproval(draft.id, ids.admin);
    expect((await previewApproval(ids.vendor)).correctionCredits).toHaveLength(1);

    await db.vendorBalanceEvent.create({ data: {
      vendorId: ids.vendor, type: 'VENDOR_DEBT_CREATED', amountMinor: -6000, currency: 'TRY',
      sourceType: 'phase2d_test_existing_debt', sourceId: runId, idempotencyKey: `${runId}-debt`,
    } });
    const rebuiltDraft = await createDraftApproval({ vendorId: ids.vendor });
    settlementIds.push(rebuiltDraft.id);
    await approveSettlementApproval(rebuiltDraft.id, ids.admin);
    const rebuiltPayout = await preparePayoutBatch({ vendorId: ids.vendor }, ids.admin);
    payoutIds.push(rebuiltPayout.id);
    expect(rebuiltPayout.correctionCreditAmount).toBe('100.00');
    expect(rebuiltPayout.debtOffsetAmount).toBe('60.00');
    expect(rebuiltPayout.netAmount).toBe('40.00');
    await markPayoutBatchReview(rebuiltPayout.id);
    const paid = await markPayoutBatchPaid(rebuiltPayout.id, { paidAt: '2026-09-02T12:00:00.000Z', paymentReference: `phase2d-${runId}` }, ids.admin);
    expect(paid.status).toBe('paid');
    expect(paid.correctionCreditLines?.[0]?.status).toBe('PAID');
    expect(await db.vendorBalanceEvent.count({ where: { vendorId: ids.vendor, type: 'VENDOR_DEBT_OFFSET', payoutBatchId: rebuiltPayout.id } })).toBe(1);
    expect((await db.payoutBatch.findUniqueOrThrow({ where: { id: ids.historicalPayout } })).status).toBe('PAID');
  });

  it('keeps an ordinary SALE, gross credit, debt source and payout offset distinct', async () => {
    await setHundredTryCreditFixture();
    const correctionPreview = await previewTerminalFinancialCorrection(ids.review, db as never);
    expect(correctionPreview.difference.vendorPayableReversalMinor).toBe(-10000);
    const applied = await applyPaidFinancialCorrectionCredit({ reviewId: ids.review,
      previewFingerprint: correctionPreview.previewFingerprint, actorUserId: ids.admin,
      reason: 'Combined credit and sale' }, db as never);
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
      entryType: 'sale', amount: '300.00', settlementDelayDaysSnapshot: 0,
      settlementStatus: 'PAYABLE', payoutStatus: 'APPROVED',
      commissionPercentSnapshot: '0.00', commissionVatPercentSnapshot: '0.00',
    } });
    await db.vendorBalanceEvent.create({ data: {
      vendorId: ids.vendor, type: 'VENDOR_DEBT_CREATED', amountMinor: -6000, currency: 'TRY',
      sourceType: 'phase2d_test_existing_debt', sourceId: runId, idempotencyKey: `${runId}-mixed-debt`,
    } });
    const preview = await previewApproval(ids.vendor);
    expect(preview.summary.eligibleRowCount).toBe(1);
    expect(preview.correctionCredits).toHaveLength(1);
    expect(preview.summary.grossSalesMinor).toBe(30000);
    expect(preview.summary.correctionCreditMinor).toBe(10000);
    expect(preview.summary.netPayableMinor).toBe(40000);
    const draft = await createDraftApproval({ vendorId: ids.vendor });
    settlementIds.push(draft.id);
    expect(draft.lines).toHaveLength(1);
    expect(draft.correctionCreditLines).toHaveLength(1);
    expect(draft.correctionCreditLines[0]?.creditId).toBe(applied.creditId);
    await approveSettlementApproval(draft.id, ids.admin);
    const payout = await preparePayoutBatch({ vendorId: ids.vendor }, ids.admin);
    payoutIds.push(payout.id);
    expect(payout.grossAmount).toBe('300.00');
    expect(payout.correctionCreditAmount).toBe('100.00');
    expect(payout.payableBeforeDebtOffset).toBe('400.00');
    expect(payout.debtOffsetAmount).toBe('60.00');
    expect(payout.netAmount).toBe('340.00');
    expect(payout.lines).toHaveLength(1);
    expect(payout.correctionCreditLines).toHaveLength(1);
  });
});
