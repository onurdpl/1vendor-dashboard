import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '../backend/node_modules/@prisma/client/index.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
const describeWithPostgres = testDatabaseUrl ? describe : describe.skip;

describeWithPostgres('zero-net financial correction with isolated PostgreSQL', () => {
  let db: PrismaClient;
  let counter = 0;
  let ids: Record<string, string>;
  let normalizeRefundEvidence: typeof import('../backend/src/modules/finance/refund-evidence-normalizer.service.js')['normalizeRefundEvidence'];
  let previewTerminalFinancialCorrection: typeof import('../backend/src/modules/finance/financial-correction-preview.service.js')['previewTerminalFinancialCorrection'];
  let acknowledgeZeroNetReconciliation: typeof import('../backend/src/modules/finance/financial-correction-zero-net-acknowledgement.service.js')['acknowledgeZeroNetReconciliation'];

  function normalized(amount: string) {
    return normalizeRefundEvidence({
      sourceShopifyRefundId: ids.shopifyRefund,
      sourceShopifyOrderId: ids.shopifyOrder,
      vendorAllocationId: ids.allocation,
      monetaryClassification: 'MONETARY_REFUND',
      refundTotalAmount: '150.00',
      currency: 'TRY',
      transactions: [{ transactionGid: `gid://shopify/OrderTransaction/${ids.run}`,
        kind: 'REFUND', status: 'SUCCESS', amount: '150.00', currency: 'TRY' }],
      refundLines: [{ sourceLineItemId: `gid://shopify/LineItem/${ids.run}`,
        quantity: 2, subtotalAmount: amount, currency: 'TRY' }],
      historicalEconomicVendorId: ids.vendor,
      historicalSaleFinanceLedgerEntryId: ids.sale,
      supersededSaleLedgerIds: [],
    });
  }

  async function seed() {
    const accepted = normalized('100.00');
    const incoming = normalized('120.00');
    await db.user.create({ data: { id: ids.admin, email: `${ids.run}@example.test`,
      name: 'Phase 2B Admin', role: 'ADMIN', passwordHash: 'test-only' } });
    await db.vendor.create({ data: { id: ids.vendor, name: 'Phase 2B Vendor' } });
    await db.shopifyOrder.create({ data: { id: ids.order,
      sourceShopifyOrderId: ids.shopifyOrder, sourceShopifyOrderNumber: `#${ids.run}` } });
    await db.vendorAllocation.create({ data: { id: ids.allocation,
      sourceShopifyOrderId: ids.order, sourceShopifyOrderNumber: `#${ids.run}`,
      originalVendorId: ids.vendor, assignedVendorId: ids.vendor } });
    await db.refundRecord.create({ data: { id: ids.refundRecord,
      vendorAllocationId: ids.allocation, sourceShopifyOrderId: ids.shopifyOrder,
      sourceShopifyOrderNumber: `#${ids.run}`, sourceShopifyRefundId: ids.shopifyRefund,
      amount: '100.00', status: 'processed' } });
    await db.financeLedgerEntry.create({ data: { id: ids.sale,
      vendorAllocationId: ids.allocation, vendorId: ids.vendor, entryType: 'sale', amount: '200.00',
      commissionPercentSnapshot: '100.00', commissionVatPercentSnapshot: '0.00' } });
    await db.financeLedgerEntry.create({ data: { id: ids.refundLedger,
      vendorAllocationId: ids.allocation, vendorId: ids.vendor, entryType: 'refund', amount: '100.00',
      commissionPercentSnapshot: '100.00', commissionVatPercentSnapshot: '0.00' } });
    await db.refundEvidenceSnapshot.create({ data: {
      id: ids.snapshot, sourceShopifyRefundId: ids.shopifyRefund, sourceShopifyOrderId: ids.shopifyOrder,
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
      normalizationVersion: accepted.normalizationVersion, evidenceSource: 'phase2b_postgres_test',
      capturedAt: new Date('2026-09-01T10:00:00.000Z'),
    } });
    await db.refundTerminalEvidenceReview.create({ data: {
      id: ids.review, sourceShopifyRefundId: ids.shopifyRefund, sourceShopifyOrderId: ids.shopifyOrder,
      vendorAllocationId: ids.allocation, terminalRefundFinanceLedgerEntryId: ids.refundLedger,
      refundRecordId: ids.refundRecord, economicVendorId: ids.vendor,
      storedEvidenceSnapshotId: ids.snapshot, dedupeKey: `${ids.run}-dedupe`,
      conflictCategory: 'financial_evidence_conflict', storedEvidenceHash: accepted.evidenceHash,
      incomingEvidenceHash: incoming.evidenceHash, conflictSummaryJson: {},
      status: 'RESOLVED', resolutionOutcome: 'CORRECTION_REQUIRED',
    } });
    await db.refundTerminalConflictEvidence.create({ data: {
      id: ids.incoming, reviewId: ids.review, sourceShopifyRefundId: ids.shopifyRefund,
      sourceShopifyOrderId: ids.shopifyOrder, vendorAllocationId: ids.allocation,
      economicVendorId: ids.vendor, historicalSaleFinanceLedgerEntryId: ids.sale,
      supersededSaleLedgerIdsJson: [], refundTotalAmount: '150.00', currency: 'TRY',
      normalizedEvidenceJson: incoming.normalizedEvidenceJson, evidenceHash: incoming.evidenceHash,
      hashAlgorithm: incoming.hashAlgorithm, evidenceVersion: incoming.evidenceVersion,
      normalizationVersion: incoming.normalizationVersion,
    } });
    await db.refundTerminalEvidenceReviewEvent.create({ data: {
      id: ids.resolvedEvent, reviewId: ids.review, eventType: 'RESOLVED',
      resolutionOutcome: 'CORRECTION_REQUIRED', actorUserId: ids.admin,
    } });
  }

  async function preview() {
    return previewTerminalFinancialCorrection(ids.review, db as never);
  }

  async function acknowledge(fingerprint: string) {
    return acknowledgeZeroNetReconciliation({ reviewId: ids.review,
      previewFingerprint: fingerprint, actorUserId: ids.admin, note: 'Verified zero-net reconciliation' }, db as never);
  }

  async function monetaryCounts() {
    const [authority, balance, credit, deduction, creditSettlement, creditPayout,
      deductionSettlement, deductionPayout, approvedDeductionCoverage, approvedDeductionPayout,
      ledger, payout, settlement] = await Promise.all([
      db.financialCorrectionAuthority.count({ where: { reviewId: ids.review } }),
      db.vendorBalanceEvent.count({ where: { vendorId: ids.vendor } }),
      db.financialCorrectionCredit.count({ where: { authority: { reviewId: ids.review } } }),
      db.financialCorrectionDeduction.count({ where: { authority: { reviewId: ids.review } } }),
      db.financialCorrectionCreditSettlementLine.count(),
      db.financialCorrectionCreditPayoutLine.count(),
      db.financialCorrectionDeductionSettlementLine.count(),
      db.financialCorrectionDeductionPayoutLine.count(),
      db.financialCorrectionApprovedDeductionCoverage.count(),
      db.financialCorrectionApprovedDeductionPayoutLine.count(),
      db.financeLedgerEntry.count({ where: { vendorAllocationId: ids.allocation } }),
      db.payoutBatch.count({ where: { vendorId: ids.vendor } }),
      db.settlementApproval.count({ where: { vendorId: ids.vendor } }),
    ]);
    return { authority, balance, credit, deduction, creditSettlement, creditPayout,
      deductionSettlement, deductionPayout, approvedDeductionCoverage, approvedDeductionPayout,
      ledger, payout, settlement };
  }

  async function durableState() {
    return {
      acknowledgements: await db.financialCorrectionZeroNetAcknowledgement.count({ where: { reviewId: ids.review } }),
      claims: await db.financialCorrectionBaselineClaim.count({ where: { acceptedEvidenceSnapshotId: ids.snapshot } }),
      money: await monetaryCounts(),
    };
  }

  const noMoney = { authority: 0, balance: 0, credit: 0, deduction: 0,
    creditSettlement: 0, creditPayout: 0, deductionSettlement: 0, deductionPayout: 0,
    approvedDeductionCoverage: 0, approvedDeductionPayout: 0, ledger: 2, payout: 0, settlement: 0 };

  beforeAll(async () => {
    const target = new URL(testDatabaseUrl!);
    if (process.env.PHASE2B_TEST_DATABASE_ISOLATED !== '1' ||
        !['127.0.0.1', 'localhost'].includes(target.hostname) ||
        target.pathname.slice(1) !== 'phase2b_validation') {
      throw new Error('Phase 2B PostgreSQL test requires an explicitly isolated local test database.');
    }
    process.env.DATABASE_URL = testDatabaseUrl;
    ({ normalizeRefundEvidence } = await import('../backend/src/modules/finance/refund-evidence-normalizer.service.js'));
    ({ previewTerminalFinancialCorrection } = await import('../backend/src/modules/finance/financial-correction-preview.service.js'));
    ({ acknowledgeZeroNetReconciliation } = await import('../backend/src/modules/finance/financial-correction-zero-net-acknowledgement.service.js'));
    db = new PrismaClient({ datasources: { db: { url: testDatabaseUrl } } });
    await db.$connect();
  });

  beforeEach(async () => {
    const run = `phase2b-${process.pid}-${Date.now()}-${++counter}`;
    ids = {
      run, admin: `${run}-admin`, vendor: `${run}-vendor`, order: `${run}-order`,
      allocation: `${run}-allocation`, refundRecord: `${run}-refund-record`,
      sale: `${run}-sale`, refundLedger: `${run}-refund-ledger`, snapshot: `${run}-snapshot`,
      review: `${run}-review`, incoming: `${run}-incoming`, resolvedEvent: `${run}-resolved`,
      shopifyOrder: `gid://shopify/Order/${run}`, shopifyRefund: `gid://shopify/Refund/${run}`,
    };
    await seed();
  });

  afterEach(async () => {
    if (!db || !ids) return;
    await db.financialCorrectionZeroNetAcknowledgement.deleteMany({ where: { reviewId: ids.review } });
    await db.financialCorrectionBaselineClaim.deleteMany({ where: { acceptedEvidenceSnapshotId: ids.snapshot } });
    await db.refundTerminalEvidenceReviewEvent.deleteMany({ where: { reviewId: ids.review } });
    await db.refundTerminalConflictEvidence.deleteMany({ where: { reviewId: ids.review } });
    await db.refundTerminalEvidenceReview.deleteMany({ where: { id: ids.review } });
    await db.refundEvidenceSnapshot.deleteMany({ where: { id: ids.snapshot } });
    await db.financeLedgerEntry.deleteMany({ where: { id: { in: [ids.sale, ids.refundLedger] } } });
    await db.refundRecord.deleteMany({ where: { id: ids.refundRecord } });
    await db.vendorAllocation.deleteMany({ where: { id: ids.allocation } });
    await db.shopifyOrder.deleteMany({ where: { id: ids.order } });
    await db.vendor.deleteMany({ where: { id: ids.vendor } });
    await db.user.deleteMany({ where: { id: ids.admin } });
  });

  afterAll(async () => {
    await db?.$disconnect();
  });

  it('persists one eligible acknowledgement and its exact accepted-baseline claim', async () => {
    const eligible = await preview();
    expect(eligible).toMatchObject({ currency: 'TRY', economicDirection: 'NONE',
      difference: { refundAmountMinor: 2000, commissionReversalMinor: 2000,
        vendorPayableReversalMinor: 0 } });
    const result = await acknowledge(eligible.previewFingerprint);
    const stored = await db.financialCorrectionZeroNetAcknowledgement.findUniqueOrThrow({ where: { reviewId: ids.review } });
    const claim = await db.financialCorrectionBaselineClaim.findUniqueOrThrow({ where: { acceptedEvidenceSnapshotId: ids.snapshot } });
    expect(result).toMatchObject({ id: stored.id, reviewId: ids.review,
      previewFingerprint: eligible.previewFingerprint, acknowledgedByUserId: ids.admin,
      acceptedEvidenceSnapshotId: ids.snapshot, incomingConflictEvidenceId: ids.incoming,
      resolvedReviewEventId: ids.resolvedEvent, economicDirection: 'NONE', vendorPayableDifferenceMinor: 0 });
    expect(stored).toMatchObject({ reviewId: ids.review, acceptedEvidenceSnapshotId: ids.snapshot,
      incomingConflictEvidenceId: ids.incoming, resolvedReviewEventId: ids.resolvedEvent,
      previewFingerprint: eligible.previewFingerprint, acknowledgedByUserId: ids.admin,
      acceptedRefundAmountMinor: 10000, correctedRefundAmountMinor: 12000,
      refundDifferenceMinor: 2000, commissionDifferenceMinor: 2000,
      vendorPayableDifferenceMinor: 0, economicDirection: 'NONE', currency: 'TRY' });
    expect(claim).toMatchObject({ consumerType: 'zero_net_acknowledgement', consumerId: stored.id });
    expect(await durableState()).toMatchObject({ acknowledgements: 1, claims: 1, money: noMoney });
  });

  it('writes no monetary effect and leaves persisted historical authority unchanged', async () => {
    const before = {
      accepted: await db.refundEvidenceSnapshot.findUniqueOrThrow({ where: { id: ids.snapshot } }),
      incoming: await db.refundTerminalConflictEvidence.findUniqueOrThrow({ where: { id: ids.incoming } }),
      sale: await db.financeLedgerEntry.findUniqueOrThrow({ where: { id: ids.sale } }),
      refund: await db.financeLedgerEntry.findUniqueOrThrow({ where: { id: ids.refundLedger } }),
      review: await db.refundTerminalEvidenceReview.findUniqueOrThrow({ where: { id: ids.review } }),
      resolved: await db.refundTerminalEvidenceReviewEvent.findUniqueOrThrow({ where: { id: ids.resolvedEvent } }),
    };
    expect(await monetaryCounts()).toEqual(noMoney);
    await acknowledge((await preview()).previewFingerprint);
    expect(await monetaryCounts()).toEqual(noMoney);
    expect(await db.refundEvidenceSnapshot.findUniqueOrThrow({ where: { id: ids.snapshot } })).toEqual(before.accepted);
    expect(await db.refundTerminalConflictEvidence.findUniqueOrThrow({ where: { id: ids.incoming } })).toEqual(before.incoming);
    expect(await db.financeLedgerEntry.findUniqueOrThrow({ where: { id: ids.sale } })).toEqual(before.sale);
    expect(await db.financeLedgerEntry.findUniqueOrThrow({ where: { id: ids.refundLedger } })).toEqual(before.refund);
    expect(await db.refundTerminalEvidenceReview.findUniqueOrThrow({ where: { id: ids.review } })).toEqual(before.review);
    expect(await db.refundTerminalEvidenceReviewEvent.findUniqueOrThrow({ where: { id: ids.resolvedEvent } })).toEqual(before.resolved);
  });

  it('returns the same durable acknowledgement on an exact retry', async () => {
    const fingerprint = (await preview()).previewFingerprint;
    const first = await acknowledge(fingerprint);
    const second = await acknowledge(fingerprint);
    expect(second).toEqual(first);
    expect(await durableState()).toEqual({ acknowledgements: 1, claims: 1, money: noMoney });
  });

  it('rejects a stale preview fingerprint without consuming the baseline', async () => {
    const stale = (await preview()).previewFingerprint;
    await db.refundTerminalEvidenceReview.update({ where: { id: ids.review },
      data: { occurrenceCount: { increment: 1 } } });
    expect((await preview()).previewFingerprint).not.toBe(stale);
    await expect(acknowledge(stale)).rejects.toMatchObject({ code: 'PREVIEW_STALE' });
    expect(await durableState()).toEqual({ acknowledgements: 0, claims: 0, money: noMoney });
  });

  it('rejects an accepted baseline already claimed by a monetary correction route', async () => {
    const fingerprint = (await preview()).previewFingerprint;
    await db.financialCorrectionBaselineClaim.create({ data: {
      acceptedEvidenceSnapshotId: ids.snapshot, consumerType: 'paid_vendor_debt',
      consumerId: `${ids.run}-prior-monetary-consumer`,
    } });
    await expect(acknowledge(fingerprint)).rejects.toMatchObject({ code: 'CONCURRENT_ACKNOWLEDGEMENT' });
    expect(await durableState()).toEqual({ acknowledgements: 0, claims: 1, money: noMoney });
    expect(await db.financialCorrectionBaselineClaim.findUniqueOrThrow({ where: { acceptedEvidenceSnapshotId: ids.snapshot } }))
      .toMatchObject({ consumerType: 'paid_vendor_debt', consumerId: `${ids.run}-prior-monetary-consumer` });
  });

  it('rejects a nonzero payable preview through the zero-net service', async () => {
    await db.financeLedgerEntry.update({ where: { id: ids.sale }, data: { commissionPercentSnapshot: '10.00' } });
    await db.financeLedgerEntry.update({ where: { id: ids.refundLedger }, data: { commissionPercentSnapshot: '10.00' } });
    const nonzero = await preview();
    expect(nonzero).toMatchObject({ economicDirection: 'VENDOR_DEDUCTION',
      difference: { vendorPayableReversalMinor: 1800 } });
    await expect(acknowledge(nonzero.previewFingerprint)).rejects.toMatchObject({ code: 'NONZERO_CORRECTION_NOT_SUPPORTED' });
    expect(await durableState()).toEqual({ acknowledgements: 0, claims: 0, money: noMoney });
  });

  it('consumes the accepted baseline once under two concurrent PostgreSQL attempts', async () => {
    const fingerprint = (await preview()).previewFingerprint;
    const outcomes = await Promise.allSettled([acknowledge(fingerprint), acknowledge(fingerprint)]);
    expect(outcomes.some((outcome) => outcome.status === 'fulfilled')).toBe(true);
    const acknowledgements = await db.financialCorrectionZeroNetAcknowledgement.findMany({ where: { reviewId: ids.review } });
    const claims = await db.financialCorrectionBaselineClaim.findMany({ where: { acceptedEvidenceSnapshotId: ids.snapshot } });
    expect(acknowledgements).toHaveLength(1);
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({ consumerType: 'zero_net_acknowledgement', consumerId: acknowledgements[0].id });
    for (const outcome of outcomes) {
      if (outcome.status === 'fulfilled') expect(outcome.value.id).toBe(acknowledgements[0].id);
    }
    expect(await durableState()).toEqual({ acknowledgements: 1, claims: 1, money: noMoney });
  });
});
