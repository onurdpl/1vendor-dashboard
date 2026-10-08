import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '../backend/node_modules/@prisma/client/index.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
const describeWithPostgres = testDatabaseUrl ? describe : describe.skip;

describeWithPostgres('paid financial correction credit with isolated PostgreSQL', () => {
  let sequence = 0;
  let runId: string;
  const fixtureIds = (id: string) => ({
    vendor: `${id}-vendor`, admin: `${id}-admin`, order: `${id}-order`,
    allocation: `${id}-allocation`, refundRecord: `${id}-refund-record`,
    sale: `${id}-sale`, refundLedger: `${id}-refund-ledger`, snapshot: `${id}-snapshot`,
    review: `${id}-review`, incoming: `${id}-incoming`, resolved: `${id}-resolved`,
    historicalSettlement: `${id}-historical-settlement`, historicalLine: `${id}-historical-line`,
    historicalPayout: `${id}-historical-payout`, historicalPayoutLine: `${id}-historical-payout-line`,
    futureAllocation: `${id}-future-allocation`, futureFulfillment: `${id}-future-fulfillment`,
    futureSale: `${id}-future-sale`,
  });
  let ids: ReturnType<typeof fixtureIds>;
  let sourceShopifyOrderId: string;
  let sourceShopifyRefundId: string;
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
  let recordVerifiedDeliveredObservation: typeof import('../backend/src/modules/shipping/allocation-delivered-observation.service.js')['recordVerifiedDeliveredObservation'];
  let evaluateSaleSettlementDelay: typeof import('../backend/src/modules/finance/settlement-delay-eligibility.service.js')['evaluateSaleSettlementDelay'];

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
    runId = `phase2d-${process.pid}-${Date.now()}-${sequence++}`;
    ids = fixtureIds(runId);
    sourceShopifyOrderId = `gid://shopify/Order/${runId}`;
    sourceShopifyRefundId = `gid://shopify/Refund/${runId}`;
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
    ({ recordVerifiedDeliveredObservation } = await import('../backend/src/modules/shipping/allocation-delivered-observation.service.js'));
    ({ evaluateSaleSettlementDelay } = await import('../backend/src/modules/finance/settlement-delay-eligibility.service.js'));
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
    // The delivery observation is immutable; the isolated suite database owns fixture disposal.
    await db?.$disconnect();
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
    await approveSettlementApproval(rebuiltDraft.id, ids.admin);
    const rebuiltPayout = await preparePayoutBatch({ vendorId: ids.vendor }, ids.admin);
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
    const historicalPayout = await db.payoutBatch.findUniqueOrThrow({ where: { id: ids.historicalPayout } });
    await setHundredTryCreditFixture();
    const correctionPreview = await previewTerminalFinancialCorrection(ids.review, db as never);
    expect(correctionPreview.difference.vendorPayableReversalMinor).toBe(-10000);
    const applied = await applyPaidFinancialCorrectionCredit({ reviewId: ids.review,
      previewFingerprint: correctionPreview.previewFingerprint, actorUserId: ids.admin,
      reason: 'Combined credit and sale' }, db as never);
    await db.vendorAllocation.create({ data: {
      id: ids.futureAllocation, sourceShopifyOrderId: ids.order, sourceShopifyOrderNumber: `#${runId}`,
      originalVendorId: ids.vendor, assignedVendorId: ids.vendor,
      outboundMethodSnapshot: 'KARGONOMI',
      fulfillmentStatus: 'Fulfilled', shippingStatus: 'Delivered',
    } });
    const executionId = `${ids.futureAllocation}-execution`;
    const sourceReference = `${ids.futureAllocation}-shipment`;
    await db.shipmentExecution.create({ data: {
      id: executionId, allocationId: ids.futureAllocation, vendorId: ids.vendor,
      provider: 'KARGONOMI', providerShipmentId: sourceReference,
      shipmentStatus: 'DELIVERED', requestSnapshot: {},
    } });
    const observation = await recordVerifiedDeliveredObservation({
      allocationId: ids.futureAllocation,
      source: { method: 'KARGONOMI', shipmentExecutionId: executionId, sourceReference },
    }, db as never);
    expect(observation).toMatchObject({
      vendorAllocationId: ids.futureAllocation, outboundMethod: 'KARGONOMI',
      outboundIntegrationProvider: null, shipmentExecutionId: executionId, sourceReference,
    });
    expect(observation.firstObservedDeliveredAt).toBeInstanceOf(Date);
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
    const futureSale = await db.financeLedgerEntry.findUniqueOrThrow({
      where: { id: ids.futureSale }, include: { vendorAllocation: { include: { deliveredObservation: true } } },
    });
    expect(futureSale.amount.toString()).toBe('300');
    expect(futureSale.vendorId).toBe(ids.vendor);
    expect(futureSale.vendorAllocation?.assignedVendorId).toBe(ids.vendor);
    expect(futureSale.vendorAllocation?.outboundMethodSnapshot).toBe('KARGONOMI');
    expect(futureSale.vendorAllocation?.outboundIntegrationProviderSnapshot).toBeNull();
    expect(futureSale.vendorAllocation?.deliveredObservation?.id).toBe(observation.id);
    expect(futureSale.settlementDelayDaysSnapshot).toBe(0);
    const delay = evaluateSaleSettlementDelay(futureSale);
    expect(delay.eligible).toBe(true);
    expect(delay.deliveryDate).toEqual(observation.firstObservedDeliveredAt);
    expect(delay.eligibleAt).toEqual(observation.firstObservedDeliveredAt);
    await db.vendorBalanceEvent.create({ data: {
      vendorId: ids.vendor, type: 'VENDOR_DEBT_CREATED', amountMinor: -6000, currency: 'TRY',
      sourceType: 'phase2d_test_existing_debt', sourceId: runId, idempotencyKey: `${runId}-mixed-debt`,
    } });
    const preview = await previewApproval(ids.vendor);
    expect(preview.summary.eligibleRowCount).toBe(1);
    expect(preview.lines.map((line) => line.financeLedgerEntryId)).toEqual([ids.futureSale]);
    expect(preview.correctionCredits).toHaveLength(1);
    expect(preview.correctionCredits[0]?.id).toBe(applied.creditId);
    expect(preview.summary.grossSalesMinor).toBe(30000);
    expect(preview.summary.correctionCreditMinor).toBe(10000);
    expect(preview.summary.netPayableMinor).toBe(40000);
    const draft = await createDraftApproval({ vendorId: ids.vendor });
    expect(draft.lines).toHaveLength(1);
    expect(draft.lines[0]?.financeLedgerEntryId).toBe(ids.futureSale);
    expect(draft.correctionCreditLines).toHaveLength(1);
    expect(draft.correctionCreditLines[0]?.creditId).toBe(applied.creditId);
    expect(await db.financialCorrectionCreditSettlementLine.count({ where: { creditId: applied.creditId, status: 'ACTIVE' } })).toBe(1);
    await approveSettlementApproval(draft.id, ids.admin);
    const payout = await preparePayoutBatch({ vendorId: ids.vendor }, ids.admin);
    expect(payout.grossAmount).toBe('300.00');
    expect(payout.correctionCreditAmount).toBe('100.00');
    expect(payout.payableBeforeDebtOffset).toBe('400.00');
    expect(payout.debtOffsetAmount).toBe('60.00');
    expect(payout.netAmount).toBe('340.00');
    expect(payout.lines).toHaveLength(1);
    expect(payout.correctionCreditLines).toHaveLength(1);
    expect(payout.lines[0]?.financeLedgerEntryId).toBe(ids.futureSale);
    const payoutLines = await db.payoutBatchLine.findMany({ where: { payoutBatchId: payout.id } });
    expect(payoutLines).toHaveLength(1);
    expect(payoutLines[0]).toMatchObject({ financeLedgerEntryId: ids.futureSale,
      settlementApprovalLineId: draft.lines[0]?.id });
    expect(await db.financialCorrectionCreditPayoutLine.count({ where: { payoutBatchId: payout.id, status: 'ACTIVE' } })).toBe(1);
    expect(await db.vendorBalanceEvent.findMany({ where: { payoutBatchId: payout.id, type: 'VENDOR_DEBT_OFFSET' } }))
      .toEqual([expect.objectContaining({ amountMinor: 6000, vendorId: ids.vendor })]);
    expect(await db.payoutBatch.findUniqueOrThrow({ where: { id: ids.historicalPayout } })).toEqual(historicalPayout);
    expect(historicalPayout.status).toBe('PAID');
    expect(historicalPayout.netAmount.toString()).toBe('176');
  });
});
