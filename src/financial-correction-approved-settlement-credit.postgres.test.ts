import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '../backend/node_modules/@prisma/client/index.js';

const databaseUrl = process.env.TEST_DATABASE_URL?.trim();
const describeWithPostgres = databaseUrl ? describe : describe.skip;

describeWithPostgres('approved-settlement financial correction credit with isolated PostgreSQL', () => {
  const runId = `phase2e3a-${process.pid}-${Date.now()}`;
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
  let applyCredit: typeof import('../backend/src/modules/finance/financial-correction-approved-settlement-credit.service.js')['applyApprovedSettlementFinancialCorrectionCredit'];
  let getState: typeof import('../backend/src/modules/finance/financial-correction-approved-settlement-credit.service.js')['getApprovedSettlementFinancialCorrectionCreditState'];
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
      refundLines: [{ sourceLineItemId: `gid://shopify/LineItem/${runId}`, quantity: 1, subtotalAmount: amount, currency: 'TRY' }],
      historicalEconomicVendorId: ids.vendor, historicalSaleFinanceLedgerEntryId: ids.sale,
      supersededSaleLedgerIds: [],
    });
  }

  beforeEach(async () => {
    const target = new URL(databaseUrl!);
    if (process.env.PHASE2E3A_TEST_DATABASE_ISOLATED !== '1' ||
        !['127.0.0.1', 'localhost'].includes(target.hostname) ||
        target.pathname.slice(1) !== 'phase2e3a_validation') {
      throw new Error('Phase 2E3A PostgreSQL test requires the explicitly isolated local phase2e3a_validation database.');
    }
    process.env.DATABASE_URL = databaseUrl;
    ({ normalizeRefundEvidence } = await import('../backend/src/modules/finance/refund-evidence-normalizer.service.js'));
    ({ previewTerminalFinancialCorrection } = await import('../backend/src/modules/finance/financial-correction-preview.service.js'));
    ({ applyApprovedSettlementFinancialCorrectionCredit: applyCredit,
      getApprovedSettlementFinancialCorrectionCreditState: getState } =
      await import('../backend/src/modules/finance/financial-correction-approved-settlement-credit.service.js'));
    ({ createDraftApproval, approveSettlementApproval, cancelSettlementApproval } = await import('../backend/src/modules/finance/settlement-approval.service.js'));
    ({ preparePayoutBatch, cancelPayoutBatch } = await import('../backend/src/modules/finance/finance.service.js'));
    db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await db.$connect();
    const accepted = normalized('150.00');
    const incoming = normalized('50.00');
    await db.user.create({ data: { id: ids.admin, email: `${runId}@example.test`, name: 'Phase 2E3A Admin', role: 'ADMIN', passwordHash: 'test-only' } });
    await db.vendor.create({ data: { id: ids.vendor, name: 'Phase 2E3A Vendor' } });
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
      sourceShopifyOrderNumber: `#${runId}`, sourceShopifyRefundId, amount: '150.00', status: 'processed',
    } });
    await db.financeLedgerEntry.create({ data: {
      id: ids.sale, vendorAllocationId: ids.allocation, vendorId: ids.vendor,
      entryType: 'sale', amount: '1150.00', commissionPercentSnapshot: '0.00',
      commissionVatPercentSnapshot: '20.00', settlementStatus: 'PAYABLE', payoutStatus: 'APPROVED',
      settlementDelayDaysSnapshot: 0,
    } });
    await db.financeLedgerEntry.create({ data: {
      id: ids.refundLedger, vendorAllocationId: ids.allocation, vendorId: ids.vendor,
      entryType: 'refund', amount: '150.00', commissionPercentSnapshot: '0.00',
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
      normalizationVersion: accepted.normalizationVersion, evidenceSource: 'phase2e3a_postgres_test',
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
        { id: ids.saleLine, financeLedgerEntryId: ids.sale, lineType: 'SALE', amountMinor: 115000,
          commissionMinor: 0, commissionVatMinor: 0, payableImpactMinor: 115000, sourceSnapshotJson: {} },
        { id: ids.refundLine, financeLedgerEntryId: ids.refundLedger, lineType: 'REFUND', amountMinor: 15000,
          commissionMinor: 0, commissionVatMinor: 0, payableImpactMinor: -15000, sourceSnapshotJson: {} },
      ] },
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
      await db.financialCorrectionCreditSettlementLine.deleteMany({ where: { settlementApprovalId: { in: settlementIds } } });
      await db.settlementApproval.deleteMany({ where: { id: { in: settlementIds } } });
    }
    await db.vendorBalanceEvent.deleteMany({ where: { vendorId: ids.vendor } });
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
    await db.refundRecord.deleteMany({ where: { id: ids.refundRecord } });
    await db.fulfillment.deleteMany({ where: { id: ids.fulfillment } });
    await db.vendorAllocation.deleteMany({ where: { id: ids.allocation } });
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
      actorUserId: ids.admin, reason: 'Verified approved-settlement credit' };
  };

  it('applies one gross credit, gates first payout, then pays two distinct approvals with debt offset', async () => {
    const originBefore = await db.settlementApproval.findUniqueOrThrow({ where: { id: ids.origin }, include: { lines: true } });
    const originalSale = await db.financeLedgerEntry.findUniqueOrThrow({ where: { id: ids.sale } });
    const originalRefund = await db.financeLedgerEntry.findUniqueOrThrow({ where: { id: ids.refundLedger } });
    const originalSnapshot = await db.refundEvidenceSnapshot.findUniqueOrThrow({ where: { id: ids.snapshot } });
    const originalIncoming = await db.refundTerminalConflictEvidence.findUniqueOrThrow({ where: { id: ids.incoming } });
    const state = await getState(ids.review, db as never);
    expect(state.eligible).toBe(true);
    expect(state.approvedSettlement?.id).toBe(ids.origin);
    const input = await inputFor();
    const attempts = await Promise.allSettled([applyCredit(input, db as never), applyCredit(input, db as never)]);
    expect(attempts.some((result) => result.status === 'fulfilled')).toBe(true);
    const applied = await applyCredit(input, db as never);
    expect(applied.grossCreditMinor).toBe(10000);
    expect(applied.historicalApprovedSettlementId).toBe(ids.origin);
    expect(await db.financialCorrectionAuthority.count({ where: { reviewId: ids.review } })).toBe(1);
    expect(await db.financialCorrectionBaselineClaim.count({ where: { acceptedEvidenceSnapshotId: ids.snapshot } })).toBe(1);
    expect(await db.financialCorrectionCredit.count({ where: { authorityId: applied.id } })).toBe(1);
    expect(await db.settlementApproval.findUniqueOrThrow({ where: { id: ids.origin }, include: { lines: true } })).toEqual(originBefore);
    expect(await db.financeLedgerEntry.findUniqueOrThrow({ where: { id: ids.sale } })).toEqual(originalSale);
    expect(await db.financeLedgerEntry.findUniqueOrThrow({ where: { id: ids.refundLedger } })).toEqual(originalRefund);
    expect(await db.refundEvidenceSnapshot.findUniqueOrThrow({ where: { id: ids.snapshot } })).toEqual(originalSnapshot);
    expect(await db.refundTerminalConflictEvidence.findUniqueOrThrow({ where: { id: ids.incoming } })).toEqual(originalIncoming);
    await expect(preparePayoutBatch({ vendorId: ids.vendor }, ids.admin))
      .rejects.toThrow('FINANCIAL_CORRECTION_CREDIT_AWAITING_SETTLEMENT_APPROVAL');
    const draft = await createDraftApproval({ vendorId: ids.vendor });
    settlementIds.push(draft.id);
    expect(draft.lines).toHaveLength(0);
    expect(draft.correctionCreditLines).toHaveLength(1);
    await approveSettlementApproval(draft.id, ids.admin);
    await db.vendorBalanceEvent.create({ data: {
      vendorId: ids.vendor, type: 'VENDOR_DEBT_CREATED', amountMinor: -6000, currency: 'TRY',
      sourceType: 'phase2e3a_test_existing_debt', sourceId: runId, idempotencyKey: `${runId}-debt`,
    } });
    const payout = await preparePayoutBatch({ vendorId: ids.vendor }, ids.admin);
    payoutIds.push(payout.id);
    expect(payout.correctionCreditAmount).toBe('100.00');
    expect(payout.payableBeforeDebtOffset).toBe('1100.00');
    expect(payout.debtOffsetAmount).toBe('60.00');
    expect(payout.netAmount).toBe('1040.00');
    expect(payout.lines).toHaveLength(2);
    expect(payout.correctionCreditLines).toHaveLength(1);
    expect(await db.settlementApproval.findUniqueOrThrow({ where: { id: ids.origin }, include: { lines: true } })).toEqual(originBefore);
    await expect(preparePayoutBatch({ vendorId: ids.vendor }, ids.admin)).rejects.toThrow();
    await cancelPayoutBatch(payout.id);
  });

  it.each(['DRAFT', 'REVIEW', 'PAID', 'CANCELLED'] as const)('rejects %s payout history', async (status) => {
    await db.payoutBatch.create({ data: { id: ids.historicalPayout, vendorId: ids.vendor, currency: 'TRY',
      status, paidAt: status === 'PAID' ? new Date('2026-09-01T12:00:00.000Z') : null } });
    await db.payoutBatchLine.create({ data: {
      payoutBatchId: ids.historicalPayout, financeLedgerEntryId: ids.sale,
      settlementApprovalLineId: ids.saleLine, amountSnapshot: '1150.00',
    } });
    await expect(applyCredit(await inputFor(), db as never)).rejects.toMatchObject({ code: 'PAYOUT_HISTORY_EXISTS' });
    expect(await db.financialCorrectionAuthority.count({ where: { reviewId: ids.review } })).toBe(0);
  });

  it('rejects a stale preview without consuming the baseline or creating a credit', async () => {
    await expect(applyCredit({ ...await inputFor(), previewFingerprint: `financial-correction-preview-v1:${'0'.repeat(64)}` }, db as never))
      .rejects.toMatchObject({ code: 'PREVIEW_STALE' });
    expect(await db.financialCorrectionAuthority.count({ where: { reviewId: ids.review } })).toBe(0);
    expect(await db.financialCorrectionCredit.count({ where: { vendorId: ids.vendor } })).toBe(0);
    expect(await db.financialCorrectionBaselineClaim.count({ where: { acceptedEvidenceSnapshotId: ids.snapshot } })).toBe(0);
  });

  it('rolls back authority and baseline claim when the gross credit effect insert fails', async () => {
    await db.$executeRawUnsafe(`CREATE FUNCTION phase2e3a_reject_credit_insert() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'phase2e3a injected credit write failure'; END; $$`);
    await db.$executeRawUnsafe(`CREATE TRIGGER phase2e3a_reject_credit_insert BEFORE INSERT ON "FinancialCorrectionCredit"
      FOR EACH ROW EXECUTE FUNCTION phase2e3a_reject_credit_insert()`);
    try {
      await expect(applyCredit(await inputFor(), db as never)).rejects.toThrow('phase2e3a injected credit write failure');
      expect(await db.financialCorrectionAuthority.count({ where: { reviewId: ids.review } })).toBe(0);
      expect(await db.financialCorrectionBaselineClaim.count({ where: { acceptedEvidenceSnapshotId: ids.snapshot } })).toBe(0);
      expect(await db.financialCorrectionCredit.count({ where: { vendorId: ids.vendor } })).toBe(0);
    } finally {
      await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS phase2e3a_reject_credit_insert ON "FinancialCorrectionCredit"');
      await db.$executeRawUnsafe('DROP FUNCTION IF EXISTS phase2e3a_reject_credit_insert()');
    }
  });

  it('fails closed if the historical approved settlement changes before Apply', async () => {
    const input = await inputFor();
    await db.settlementApproval.update({ where: { id: ids.origin }, data: { status: 'CANCELLED' } });
    await expect(applyCredit(input, db as never)).rejects.toMatchObject({ code: 'APPROVED_SETTLEMENT_REQUIRED' });
    expect(await db.financialCorrectionAuthority.count({ where: { reviewId: ids.review } })).toBe(0);
    expect(await db.financialCorrectionCredit.count({ where: { vendorId: ids.vendor } })).toBe(0);
  });

  it('rejects a different retry while preserving one immutable applied credit', async () => {
    const input = await inputFor();
    const applied = await applyCredit(input, db as never);
    await expect(applyCredit({ ...input, reason: 'Different authorization' }, db as never))
      .rejects.toMatchObject({ code: 'CREDIT_EFFECT_ALREADY_EXISTS' });
    expect(await db.financialCorrectionAuthority.count({ where: { reviewId: ids.review } })).toBe(1);
    expect(await db.financialCorrectionCredit.count({ where: { authorityId: applied.id } })).toBe(1);
  });

  it('refuses an accepted baseline already claimed by another correction route', async () => {
    await db.financialCorrectionBaselineClaim.create({ data: {
      acceptedEvidenceSnapshotId: ids.snapshot, consumerType: 'zero_net_acknowledgement', consumerId: `${runId}-other`,
    } });
    await expect(applyCredit(await inputFor(), db as never)).rejects.toMatchObject({ code: 'BASELINE_ALREADY_CLAIMED' });
    expect(await db.financialCorrectionAuthority.count({ where: { reviewId: ids.review } })).toBe(0);
  });

  it('redrafts a cancelled correction settlement and restores sources after cancelling an unpaid payout', async () => {
    const original = await db.settlementApproval.findUniqueOrThrow({ where: { id: ids.origin }, include: { lines: true } });
    const applied = await applyCredit(await inputFor(), db as never);
    const first = await createDraftApproval({ vendorId: ids.vendor });
    settlementIds.push(first.id);
    expect(first.correctionCreditLines).toHaveLength(1);
    await cancelSettlementApproval(first.id, ids.admin);
    const second = await createDraftApproval({ vendorId: ids.vendor });
    settlementIds.push(second.id);
    expect(second.correctionCreditLines).toHaveLength(1);
    expect(second.correctionCreditLines[0]?.creditId).toBe(applied.creditId);
    await approveSettlementApproval(second.id, ids.admin);
    const payout = await preparePayoutBatch({ vendorId: ids.vendor }, ids.admin);
    payoutIds.push(payout.id);
    expect(payout.correctionCreditAmount).toBe('100.00');
    await cancelPayoutBatch(payout.id);
    const reprepared = await preparePayoutBatch({ vendorId: ids.vendor }, ids.admin);
    payoutIds.push(reprepared.id);
    expect(reprepared.correctionCreditAmount).toBe('100.00');
    expect(reprepared.payableBeforeDebtOffset).toBe('1100.00');
    await cancelPayoutBatch(reprepared.id);
    expect(await db.settlementApproval.findUniqueOrThrow({ where: { id: ids.origin }, include: { lines: true } })).toEqual(original);
  });

  it.each([1, 2, 3, 4, 5])('serializes Apply against first payout preparation race %i', async () => {
    const input = await inputFor();
    const results = await Promise.allSettled([
      applyCredit(input, db as never), preparePayoutBatch({ vendorId: ids.vendor }, ids.admin),
    ]);
    const applied = results[0].status === 'fulfilled' ? results[0].value : null;
    const payout = results[1].status === 'fulfilled' ? results[1].value : null;
    if (payout) payoutIds.push(payout.id);
    if (applied) {
      expect(payout).toBeNull();
      expect(await db.financialCorrectionCredit.count({ where: { authorityId: applied.id } })).toBe(1);
    } else {
      expect(payout).not.toBeNull();
      expect(await db.financialCorrectionAuthority.count({ where: { reviewId: ids.review } })).toBe(0);
    }
  });
});
