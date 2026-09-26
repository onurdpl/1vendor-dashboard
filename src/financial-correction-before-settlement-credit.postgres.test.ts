import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '../backend/node_modules/@prisma/client/index.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
const describeWithPostgres = testDatabaseUrl ? describe : describe.skip;

describeWithPostgres('before-settlement financial correction credit with isolated PostgreSQL', () => {
  const runId = `phase2e1-${process.pid}-${Date.now()}`;
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
  let db: PrismaClient;
  let normalizeRefundEvidence: typeof import('../backend/src/modules/finance/refund-evidence-normalizer.service.js')['normalizeRefundEvidence'];
  let previewTerminalFinancialCorrection: typeof import('../backend/src/modules/finance/financial-correction-preview.service.js')['previewTerminalFinancialCorrection'];
  let applyBeforeSettlementFinancialCorrectionCredit: typeof import('../backend/src/modules/finance/financial-correction-before-settlement-credit.service.js')['applyBeforeSettlementFinancialCorrectionCredit'];
  let getBeforeSettlementFinancialCorrectionCreditState: typeof import('../backend/src/modules/finance/financial-correction-before-settlement-credit.service.js')['getBeforeSettlementFinancialCorrectionCreditState'];
  let previewApproval: typeof import('../backend/src/modules/finance/settlement-approval.service.js')['previewApproval'];
  let createDraftApproval: typeof import('../backend/src/modules/finance/settlement-approval.service.js')['createDraftApproval'];
  let approveSettlementApproval: typeof import('../backend/src/modules/finance/settlement-approval.service.js')['approveSettlementApproval'];
  let cancelSettlementApproval: typeof import('../backend/src/modules/finance/settlement-approval.service.js')['cancelSettlementApproval'];
  let preparePayoutBatch: typeof import('../backend/src/modules/finance/finance.service.js')['preparePayoutBatch'];
  let cancelPayoutBatch: typeof import('../backend/src/modules/finance/finance.service.js')['cancelPayoutBatch'];
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
    if (process.env.PHASE2E1_TEST_DATABASE_ISOLATED !== '1' ||
        !['127.0.0.1', 'localhost'].includes(target.hostname) ||
        target.pathname.slice(1) !== 'phase2e1_validation') {
      throw new Error('Phase 2E1 PostgreSQL test requires the explicitly isolated local phase2e1_validation database.');
    }
    process.env.DATABASE_URL = testDatabaseUrl;
    ({ normalizeRefundEvidence } = await import('../backend/src/modules/finance/refund-evidence-normalizer.service.js'));
    ({ previewTerminalFinancialCorrection } = await import('../backend/src/modules/finance/financial-correction-preview.service.js'));
    ({ applyBeforeSettlementFinancialCorrectionCredit, getBeforeSettlementFinancialCorrectionCreditState } = await import('../backend/src/modules/finance/financial-correction-before-settlement-credit.service.js'));
    ({ previewApproval, createDraftApproval, approveSettlementApproval, cancelSettlementApproval } = await import('../backend/src/modules/finance/settlement-approval.service.js'));
    ({ preparePayoutBatch, cancelPayoutBatch } = await import('../backend/src/modules/finance/finance.service.js'));
    db = new PrismaClient({ datasources: { db: { url: testDatabaseUrl } } });
    await db.$connect();
    const accepted = normalized('120.00');
    const incoming = normalized('100.00');
    await db.user.create({ data: { id: ids.admin, email: `${runId}@example.test`, name: 'Phase 2E1 Admin', role: 'ADMIN', passwordHash: 'test-only' } });
    await db.vendor.create({ data: { id: ids.vendor, name: 'Phase 2E1 Vendor' } });
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
      normalizationVersion: accepted.normalizationVersion, evidenceSource: 'phase2e1_postgres_test',
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

  const inputFor = async () => {
    const preview = await previewTerminalFinancialCorrection(ids.review, db as never);
    return { reviewId: ids.review, previewFingerprint: preview.previewFingerprint,
      actorUserId: ids.admin, reason: 'Verified before-settlement credit' };
  };

  it('applies exactly one gross credit with no PAID provenance and does not alter accepted authority', async () => {
    const input = await inputFor();
    await expect(applyBeforeSettlementFinancialCorrectionCredit({ ...input,
      previewFingerprint: `financial-correction-preview-v1:${'0'.repeat(64)}` }, db as never))
      .rejects.toMatchObject({ code: 'PREVIEW_STALE' });
    const before = await Promise.all([
      db.financeLedgerEntry.findUniqueOrThrow({ where: { id: ids.sale } }),
      db.financeLedgerEntry.findUniqueOrThrow({ where: { id: ids.refundLedger } }),
      db.refundEvidenceSnapshot.findUniqueOrThrow({ where: { id: ids.snapshot } }),
      db.refundTerminalConflictEvidence.findUniqueOrThrow({ where: { id: ids.incoming } }),
    ]);
    expect((await getBeforeSettlementFinancialCorrectionCreditState(ids.review, db as never)).eligible).toBe(true);
    const results = await Promise.allSettled([
      applyBeforeSettlementFinancialCorrectionCredit(input, db as never),
      applyBeforeSettlementFinancialCorrectionCredit(input, db as never),
    ]);
    expect(results.some((result) => result.status === 'fulfilled')).toBe(true);
    const applied = await applyBeforeSettlementFinancialCorrectionCredit(input, db as never);
    expect(applied.grossCreditMinor).toBe(1760);
    expect(applied.route).toBe('BEFORE_SETTLEMENT_VENDOR_CREDIT');
    expect(applied.settlementApprovalId).toBeNull();
    expect(applied.payoutBatchId).toBeNull();
    expect(await db.financialCorrectionAuthority.count({ where: { reviewId: ids.review,
      applicationRoute: 'BEFORE_SETTLEMENT_VENDOR_CREDIT', historicalPayoutBatchId: null,
      historicalPayoutPaidAt: null } })).toBe(1);
    expect(await db.financialCorrectionBaselineClaim.count({ where: { acceptedEvidenceSnapshotId: ids.snapshot } })).toBe(1);
    expect(await db.financialCorrectionCredit.count({ where: { authorityId: applied.id } })).toBe(1);
    expect(await Promise.all([
      db.financeLedgerEntry.findUniqueOrThrow({ where: { id: ids.sale } }),
      db.financeLedgerEntry.findUniqueOrThrow({ where: { id: ids.refundLedger } }),
      db.refundEvidenceSnapshot.findUniqueOrThrow({ where: { id: ids.snapshot } }),
      db.refundTerminalConflictEvidence.findUniqueOrThrow({ where: { id: ids.incoming } }),
    ])).toEqual(before);
  });

  it('never routes zero-net or vendor deduction through before-settlement credit', async () => {
    const accepted = normalized('120.00');
    for (const [lineAmount, direction] of [['120.00', 'NONE'], ['150.00', 'VENDOR_DEDUCTION']] as const) {
      const incoming = normalized(lineAmount);
      await db.refundTerminalConflictEvidence.update({ where: { id: ids.incoming }, data: {
        normalizedEvidenceJson: incoming.normalizedEvidenceJson, evidenceHash: incoming.evidenceHash,
      } });
      await db.refundTerminalEvidenceReview.update({ where: { id: ids.review }, data: {
        incomingEvidenceHash: incoming.evidenceHash,
      } });
      const preview = await previewTerminalFinancialCorrection(ids.review, db as never);
      expect(preview.economicDirection).toBe(direction);
      await expect(applyBeforeSettlementFinancialCorrectionCredit({
        reviewId: ids.review, previewFingerprint: preview.previewFingerprint,
        actorUserId: ids.admin, reason: 'Unsupported direction',
      }, db as never)).rejects.toMatchObject({ code: 'WRONG_CORRECTION_DIRECTION' });
    }
    expect(await db.financialCorrectionAuthority.count({ where: { reviewId: ids.review } })).toBe(0);
    expect(await db.financialCorrectionCredit.count({ where: { vendorId: ids.vendor } })).toBe(0);
    expect(accepted.evidenceHash).toBe((await db.refundEvidenceSnapshot.findUniqueOrThrow({ where: { id: ids.snapshot } })).evidenceHash);
  });

  it('fails closed for active settlements, payout membership and claimed baselines', async () => {
    const input = await inputFor();
    const approval = await db.settlementApproval.create({ data: {
      id: ids.historicalSettlement, vendorId: ids.vendor, status: 'DRAFT', currency: 'TRY',
      grossSalesMinor: 0, refundTotalMinor: 0, commissionMinor: 0, commissionVatMinor: 0,
      netPayableMinor: 0, sourceSnapshotJson: {},
    } });
    await db.settlementApprovalLine.create({ data: {
      id: ids.historicalLine, settlementApprovalId: approval.id, financeLedgerEntryId: ids.sale,
      lineType: 'SALE', amountMinor: 20000, commissionMinor: 2000,
      commissionVatMinor: 400, payableImpactMinor: 17600, sourceSnapshotJson: {},
    } });
    await expect(applyBeforeSettlementFinancialCorrectionCredit(input, db as never))
      .rejects.toMatchObject({ code: 'ACTIVE_SETTLEMENT_EXISTS' });
    await db.settlementApproval.update({ where: { id: approval.id }, data: { status: 'APPROVED' } });
    await expect(applyBeforeSettlementFinancialCorrectionCredit(input, db as never))
      .rejects.toMatchObject({ code: 'ACTIVE_SETTLEMENT_EXISTS' });
    await db.settlementApproval.update({ where: { id: approval.id }, data: { status: 'CANCELLED' } });
    expect((await getBeforeSettlementFinancialCorrectionCreditState(ids.review, db as never)).eligible).toBe(true);
    await db.payoutBatch.create({ data: {
      id: ids.historicalPayout, vendorId: ids.vendor, currency: 'TRY', status: 'DRAFT',
    } });
    await db.payoutBatchLine.create({ data: {
      id: ids.historicalPayoutLine, payoutBatchId: ids.historicalPayout,
      financeLedgerEntryId: ids.sale, settlementApprovalLineId: ids.historicalLine,
      amountSnapshot: '176.00',
    } });
    for (const status of ['DRAFT', 'REVIEW', 'PAID'] as const) {
      await db.payoutBatch.update({ where: { id: ids.historicalPayout }, data: {
        status, paidAt: status === 'PAID' ? new Date('2026-09-01T12:00:00.000Z') : null,
      } });
      await expect(applyBeforeSettlementFinancialCorrectionCredit(input, db as never))
        .rejects.toMatchObject({ code: 'PAYOUT_ALREADY_EXISTS' });
    }
    await db.payoutBatchLine.delete({ where: { id: ids.historicalPayoutLine } });
    await db.payoutBatch.delete({ where: { id: ids.historicalPayout } });
    await db.settlementApprovalLine.delete({ where: { id: ids.historicalLine } });
    await db.settlementApproval.delete({ where: { id: ids.historicalSettlement } });
    for (const consumerType of ['zero_net_acknowledgement', 'paid_vendor_debt', 'paid_vendor_credit']) {
      await db.financialCorrectionBaselineClaim.create({ data: {
        acceptedEvidenceSnapshotId: ids.snapshot, consumerType, consumerId: `${runId}-${consumerType}`,
      } });
      await expect(applyBeforeSettlementFinancialCorrectionCredit(input, db as never))
        .rejects.toMatchObject({ code: 'BASELINE_ALREADY_CLAIMED' });
      expect(await db.financialCorrectionAuthority.count({ where: { reviewId: ids.review } })).toBe(0);
      await db.financialCorrectionBaselineClaim.delete({ where: { acceptedEvidenceSnapshotId: ids.snapshot } });
    }
  });

  it('rolls back the claim and authority if gross credit creation fails', async () => {
    const input = await inputFor();
    await db.$executeRaw`ALTER TABLE "FinancialCorrectionCredit" ADD CONSTRAINT "Phase2E1RejectCreditTest" CHECK (false) NOT VALID`;
    try {
      await expect(applyBeforeSettlementFinancialCorrectionCredit(input, db as never)).rejects.toThrow();
      expect(await db.financialCorrectionBaselineClaim.count({ where: { acceptedEvidenceSnapshotId: ids.snapshot } })).toBe(0);
      expect(await db.financialCorrectionAuthority.count({ where: { reviewId: ids.review } })).toBe(0);
      expect(await db.financialCorrectionCredit.count({ where: { vendorId: ids.vendor } })).toBe(0);
    } finally {
      await db.$executeRaw`ALTER TABLE "FinancialCorrectionCredit" DROP CONSTRAINT "Phase2E1RejectCreditTest"`;
    }
  });

  it('settles a standalone gross credit and offsets existing debt only at payout', async () => {
    await setHundredTryCreditFixture();
    const applied = await applyBeforeSettlementFinancialCorrectionCredit(await inputFor(), db as never);
    // The original sale/refund are no longer settlement candidates; the correction remains independent.
    await db.financeLedgerEntry.updateMany({ where: { id: { in: [ids.sale, ids.refundLedger] } },
      data: { payoutStatus: 'PAID', settlementStatus: 'SETTLED' } });
    const preview = await previewApproval(ids.vendor);
    expect(preview.correctionCredits).toHaveLength(1);
    expect(preview.summary.correctionCreditMinor).toBe(10000);
    const draft = await createDraftApproval({ vendorId: ids.vendor });
    settlementIds.push(draft.id);
    expect(draft.lines).toHaveLength(0);
    expect(draft.correctionCreditLines).toHaveLength(1);
    expect(draft.correctionCreditLines[0]?.creditId).toBe(applied.creditId);
    await approveSettlementApproval(draft.id, ids.admin);
    await db.vendorBalanceEvent.create({ data: {
      vendorId: ids.vendor, type: 'VENDOR_DEBT_CREATED', amountMinor: -6000, currency: 'TRY',
      sourceType: 'phase2e1_test_existing_debt', sourceId: runId, idempotencyKey: `${runId}-debt`,
    } });
    const payout = await preparePayoutBatch({ vendorId: ids.vendor }, ids.admin);
    payoutIds.push(payout.id);
    expect(payout.correctionCreditAmount).toBe('100.00');
    expect(payout.debtOffsetAmount).toBe('60.00');
    expect(payout.netAmount).toBe('40.00');
    expect(await db.financialCorrectionCredit.findUniqueOrThrow({ where: { id: applied.creditId } }))
      .toMatchObject({ amountMinor: 10000 });
    await cancelPayoutBatch(payout.id);
    await cancelSettlementApproval(draft.id, ids.admin);
    expect((await previewApproval(ids.vendor)).correctionCredits).toHaveLength(1);
  });

  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])('does not silently omit a committed credit in draft/Apply race %i', async () => {
    await setHundredTryCreditFixture();
    const input = await inputFor();
    // An independent payable gives the draft a candidate before this correction exists.
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
    const raced = await Promise.allSettled([
      applyBeforeSettlementFinancialCorrectionCredit(input, db as never),
      createDraftApproval({ vendorId: ids.vendor }),
    ]);
    const applied = raced[0].status === 'fulfilled' ? raced[0].value : null;
    const draft = raced[1].status === 'fulfilled' ? raced[1].value : null;
    expect(applied || draft).toBeTruthy();
    if (draft) settlementIds.push(draft.id);
    if (applied && draft) {
      expect(draft.correctionCreditLines.some((line) => line.creditId === applied.creditId)).toBe(true);
    }
    expect(await db.financialCorrectionCredit.count({ where: { vendorId: ids.vendor } })).toBe(applied ? 1 : 0);
  });

  it('settles a future SALE and correction credit as separate sources before debt offset', async () => {
    await setHundredTryCreditFixture();
    const applied = await applyBeforeSettlementFinancialCorrectionCredit(await inputFor(), db as never);
    // The original refund position is not a future settlement candidate in this scenario.
    await db.financeLedgerEntry.updateMany({ where: { id: { in: [ids.sale, ids.refundLedger] } },
      data: { payoutStatus: 'PAID', settlementStatus: 'SETTLED' } });
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
      sourceType: 'phase2e1_test_existing_debt', sourceId: runId, idempotencyKey: `${runId}-mixed-debt`,
    } });
    const draft = await createDraftApproval({ vendorId: ids.vendor });
    settlementIds.push(draft.id);
    expect(draft.lines).toHaveLength(1);
    expect(draft.correctionCreditLines).toHaveLength(1);
    expect(draft.correctionCreditLines[0]?.creditId).toBe(applied.creditId);
    expect(draft.netPayableMinor).toBe(40000);
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
    expect(await db.vendorBalanceEvent.count({ where: { vendorId: ids.vendor,
      type: 'VENDOR_DEBT_CREATED' } })).toBe(1);
  });
});
