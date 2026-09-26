import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '../backend/node_modules/@prisma/client/index.js';

const databaseUrl = process.env.TEST_DATABASE_URL?.trim();
const describeWithPostgres = databaseUrl ? describe : describe.skip;

describeWithPostgres('draft payout financial correction with isolated PostgreSQL', () => {
  const runId = `phase2f1-${process.pid}-${Date.now()}`;
  let counter = 0;
  let db: PrismaClient;
  let normalize: typeof import('../backend/src/modules/finance/refund-evidence-normalizer.service.js')['normalizeRefundEvidence'];
  let preview: typeof import('../backend/src/modules/finance/financial-correction-preview.service.js')['previewTerminalFinancialCorrection'];
  let apply: typeof import('../backend/src/modules/finance/financial-correction-draft-payout.service.js')['applyDraftPayoutFinancialCorrection'];
  let state: typeof import('../backend/src/modules/finance/financial-correction-draft-payout.service.js')['getDraftPayoutFinancialCorrectionState'];
  let prepare: typeof import('../backend/src/modules/finance/finance.service.js')['preparePayoutBatch'];
  let markReview: typeof import('../backend/src/modules/finance/finance.service.js')['markPayoutBatchReview'];
  let cancel: typeof import('../backend/src/modules/finance/finance.service.js')['cancelPayoutBatch'];
  let createDraft: typeof import('../backend/src/modules/finance/settlement-approval.service.js')['createDraftApproval'];
  let approve: typeof import('../backend/src/modules/finance/settlement-approval.service.js')['approveSettlementApproval'];
  let ids: Record<string, string>;
  let payoutIds: string[];
  let settlementIds: string[];

  function evidence(amount: string) {
    return normalize({
      sourceShopifyRefundId: ids.shopifyRefund, sourceShopifyOrderId: ids.shopifyOrder,
      vendorAllocationId: ids.allocation, monetaryClassification: 'MONETARY_REFUND',
      refundTotalAmount: '150.00', currency: 'TRY',
      transactions: [{ transactionGid: `gid://shopify/OrderTransaction/${ids.run}`, kind: 'REFUND',
        status: 'SUCCESS', amount: '150.00', currency: 'TRY' }],
      refundLines: [{ sourceLineItemId: `gid://shopify/LineItem/${ids.run}`, quantity: 1,
        subtotalAmount: amount, currency: 'TRY' }],
      historicalEconomicVendorId: ids.vendor, historicalSaleFinanceLedgerEntryId: ids.sale,
      supersededSaleLedgerIds: [],
    });
  }

  async function seed(direction: 'VENDOR_CREDIT' | 'VENDOR_DEDUCTION', debtMinor = 0) {
    const acceptedAmount = direction === 'VENDOR_CREDIT' ? '150.00' : '50.00';
    const correctedAmount = direction === 'VENDOR_CREDIT' ? '50.00' : '150.00';
    const accepted = evidence(acceptedAmount);
    const incoming = evidence(correctedAmount);
    await db.user.create({ data: { id: ids.admin, email: `${ids.run}@example.test`, name: 'Phase 2F1 Admin',
      role: 'ADMIN', passwordHash: 'test-only' } });
    await db.vendor.create({ data: { id: ids.vendor, name: 'Phase 2F1 Vendor' } });
    await db.shopifyOrder.create({ data: { id: ids.order, sourceShopifyOrderId: ids.shopifyOrder,
      sourceShopifyOrderNumber: `#${ids.run}` } });
    await db.vendorAllocation.create({ data: { id: ids.allocation, sourceShopifyOrderId: ids.order,
      sourceShopifyOrderNumber: `#${ids.run}`, originalVendorId: ids.vendor, assignedVendorId: ids.vendor,
      fulfillmentStatus: 'Fulfilled', shippingStatus: 'Delivered' } });
    await db.fulfillment.create({ data: { id: ids.fulfillment, vendorAllocationId: ids.allocation,
      fulfillmentStatus: 'Fulfilled', fulfilledAt: new Date('2026-08-01T00:00:00Z'),
      shipmentUpdatedAt: new Date('2026-08-01T00:00:00Z') } });
    await db.refundRecord.create({ data: { id: ids.refundRecord, vendorAllocationId: ids.allocation,
      sourceShopifyOrderId: ids.shopifyOrder, sourceShopifyOrderNumber: `#${ids.run}`,
      sourceShopifyRefundId: ids.shopifyRefund, amount: acceptedAmount, status: 'processed' } });
    await db.financeLedgerEntry.create({ data: { id: ids.sale, vendorAllocationId: ids.allocation,
      vendorId: ids.vendor, entryType: 'sale', amount: direction === 'VENDOR_CREDIT' ? '1150.00' : '1050.00',
      commissionPercentSnapshot: '0.00', commissionVatPercentSnapshot: '20.00',
      settlementStatus: 'PAYABLE', payoutStatus: 'APPROVED', settlementDelayDaysSnapshot: 0 } });
    await db.financeLedgerEntry.create({ data: { id: ids.refundLedger, vendorAllocationId: ids.allocation,
      vendorId: ids.vendor, entryType: 'refund', amount: acceptedAmount,
      commissionPercentSnapshot: '0.00', commissionVatPercentSnapshot: '20.00',
      settlementStatus: 'PAYABLE', payoutStatus: 'APPROVED' } });
    await db.refundEvidenceSnapshot.create({ data: {
      id: ids.snapshot, sourceShopifyRefundId: ids.shopifyRefund, sourceShopifyOrderId: ids.shopifyOrder,
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
      evidenceSource: 'phase2f1_postgres_test', capturedAt: new Date('2026-09-01T10:00:00Z'),
    } });
    await db.refundTerminalEvidenceReview.create({ data: {
      id: ids.review, sourceShopifyRefundId: ids.shopifyRefund, sourceShopifyOrderId: ids.shopifyOrder,
      vendorAllocationId: ids.allocation, terminalRefundFinanceLedgerEntryId: ids.refundLedger,
      refundRecordId: ids.refundRecord, economicVendorId: ids.vendor, storedEvidenceSnapshotId: ids.snapshot,
      dedupeKey: `${ids.run}-dedupe`, conflictCategory: 'financial_evidence_conflict',
      storedEvidenceHash: accepted.evidenceHash, incomingEvidenceHash: incoming.evidenceHash,
      conflictSummaryJson: {}, status: 'RESOLVED', resolutionOutcome: 'CORRECTION_REQUIRED',
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
    await db.refundTerminalEvidenceReviewEvent.create({ data: { id: ids.resolved, reviewId: ids.review,
      eventType: 'RESOLVED', resolutionOutcome: 'CORRECTION_REQUIRED', actorUserId: ids.admin } });
    await db.settlementApproval.create({ data: {
      id: ids.origin, vendorId: ids.vendor, status: 'APPROVED', currency: 'TRY',
      grossSalesMinor: direction === 'VENDOR_CREDIT' ? 115000 : 105000,
      refundTotalMinor: direction === 'VENDOR_CREDIT' ? 15000 : 5000,
      commissionMinor: 0, commissionVatMinor: 0, netPayableMinor: 100000,
      sourceSnapshotJson: {}, approvedBy: ids.admin, approvedAt: new Date('2026-09-01T11:00:00Z'),
      lines: { create: [
        { id: ids.saleLine, financeLedgerEntryId: ids.sale, lineType: 'SALE',
          amountMinor: direction === 'VENDOR_CREDIT' ? 115000 : 105000,
          commissionMinor: 0, commissionVatMinor: 0,
          payableImpactMinor: direction === 'VENDOR_CREDIT' ? 115000 : 105000, sourceSnapshotJson: {} },
        { id: ids.refundLine, financeLedgerEntryId: ids.refundLedger, lineType: 'REFUND',
          amountMinor: direction === 'VENDOR_CREDIT' ? 15000 : 5000,
          commissionMinor: 0, commissionVatMinor: 0,
          payableImpactMinor: direction === 'VENDOR_CREDIT' ? -15000 : -5000, sourceSnapshotJson: {} },
      ] },
    } });
    if (debtMinor > 0) await db.vendorBalanceEvent.create({ data: {
      vendorId: ids.vendor, type: 'VENDOR_DEBT_CREATED', amountMinor: -debtMinor, currency: 'TRY',
      sourceType: 'phase2f1_test_debt', sourceId: ids.run, idempotencyKey: `${ids.run}-debt`,
    } });
    const draft = await prepare({ vendorId: ids.vendor }, ids.admin);
    payoutIds.push(draft.id);
    const input = { reviewId: ids.review,
      previewFingerprint: (await preview(ids.review, db as never)).previewFingerprint,
      actorUserId: ids.admin, reason: 'Verified draft payout correction' };
    return { draft, input };
  }

  beforeEach(async () => {
    const target = new URL(databaseUrl!);
    if (process.env.PHASE2F1_TEST_DATABASE_ISOLATED !== '1' ||
        !['127.0.0.1', 'localhost'].includes(target.hostname) ||
        target.pathname.slice(1) !== 'phase2f1_validation') {
      throw new Error('Phase 2F1 test requires the isolated local phase2f1_validation database.');
    }
    process.env.DATABASE_URL = databaseUrl;
    ({ normalizeRefundEvidence: normalize } = await import('../backend/src/modules/finance/refund-evidence-normalizer.service.js'));
    ({ previewTerminalFinancialCorrection: preview } = await import('../backend/src/modules/finance/financial-correction-preview.service.js'));
    ({ applyDraftPayoutFinancialCorrection: apply,
      getDraftPayoutFinancialCorrectionState: state } = await import('../backend/src/modules/finance/financial-correction-draft-payout.service.js'));
    ({ preparePayoutBatch: prepare, markPayoutBatchReview: markReview,
      cancelPayoutBatch: cancel } = await import('../backend/src/modules/finance/finance.service.js'));
    ({ createDraftApproval: createDraft, approveSettlementApproval: approve } =
      await import('../backend/src/modules/finance/settlement-approval.service.js'));
    db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await db.$connect();
    const run = `${runId}-${++counter}`;
    ids = Object.fromEntries(['vendor', 'admin', 'order', 'allocation', 'fulfillment', 'refundRecord',
      'sale', 'refundLedger', 'snapshot', 'review', 'incoming', 'resolved', 'origin', 'saleLine', 'refundLine']
      .map((key) => [key, `${run}-${key}`]));
    ids.run = run;
    ids.shopifyOrder = `gid://shopify/Order/${run}`;
    ids.shopifyRefund = `gid://shopify/Refund/${run}`;
    payoutIds = [];
    settlementIds = [];
  });

  afterEach(async () => {
    if (!db) return;
    await db.vendorBalanceEvent.deleteMany({ where: { vendorId: ids.vendor } });
    await db.financialCorrectionApprovedDeductionPayoutLine.deleteMany({ where: { payoutBatchId: { in: payoutIds } } });
    await db.financialCorrectionCreditPayoutLine.deleteMany({ where: { payoutBatchId: { in: payoutIds } } });
    await db.payoutBatchLine.deleteMany({ where: { payoutBatchId: { in: payoutIds } } });
    await db.financialCorrectionCreditSettlementLine.deleteMany({ where: { settlementApprovalId: { in: settlementIds } } });
    await db.financialCorrectionApprovedDeductionCoverage.deleteMany({ where: { deduction: { authority: { reviewId: ids.review } } } });
    await db.financialCorrectionDeduction.deleteMany({ where: { authority: { reviewId: ids.review } } });
    await db.financialCorrectionCredit.deleteMany({ where: { authority: { reviewId: ids.review } } });
    await db.financialCorrectionAuthority.deleteMany({ where: { reviewId: ids.review } });
    await db.financialCorrectionBaselineClaim.deleteMany({ where: { acceptedEvidenceSnapshotId: ids.snapshot } });
    await db.payoutBatch.deleteMany({ where: { id: { in: payoutIds } } });
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
  });

  it.each(['VENDOR_CREDIT', 'VENDOR_DEDUCTION'] as const)('cancels DRAFT and applies one %s effect, then re-prepares', async (direction) => {
    const { draft, input } = await seed(direction, 6000);
    expect(draft.status).toBe('draft');
    expect(draft.netAmount).toBe('940.00');
    expect((await state(ids.review, db as never)).eligible).toBe(true);
    const original = await db.payoutBatch.findUniqueOrThrow({ where: { id: draft.id }, include: { lines: true } });
    const applied = await apply(input, db as never);
    expect(applied.route).toBe(direction === 'VENDOR_CREDIT' ? 'DRAFT_PAYOUT_VENDOR_CREDIT' : 'DRAFT_PAYOUT_VENDOR_DEDUCTION');
    expect(applied.amountMinor).toBe(10000);
    expect(applied.historicalPayoutBatchId).toBe(draft.id);
    expect(await db.financialCorrectionAuthority.count({ where: { reviewId: ids.review } })).toBe(1);
    expect(await db.financialCorrectionBaselineClaim.count({ where: { acceptedEvidenceSnapshotId: ids.snapshot } })).toBe(1);
    const old = await db.payoutBatch.findUniqueOrThrow({ where: { id: draft.id }, include: { lines: true } });
    expect(old.status).toBe('CANCELLED');
    expect(old.netAmount).toEqual(original.netAmount);
    expect(old.lines).toEqual(original.lines);
    expect(await db.payoutBatch.count({ where: { vendorId: ids.vendor } })).toBe(1);
    expect((await state(ids.review, db as never)).application?.id).toBe(applied.id);
    expect((await apply(input, db as never)).id).toBe(applied.id);
    if (direction === 'VENDOR_CREDIT') {
      expect(await db.financialCorrectionCredit.count({ where: { authorityId: applied.id, amountMinor: 10000 } })).toBe(1);
      await expect(prepare({ vendorId: ids.vendor }, ids.admin))
        .rejects.toThrow('FINANCIAL_CORRECTION_CREDIT_AWAITING_SETTLEMENT_APPROVAL');
      const correctionSettlement = await createDraft({ vendorId: ids.vendor });
      settlementIds.push(correctionSettlement.id);
      await approve(correctionSettlement.id, ids.admin);
    } else {
      expect(await db.financialCorrectionDeduction.count({ where: { authorityId: applied.id, amountMinor: 10000 } })).toBe(1);
      expect(await db.financialCorrectionApprovedDeductionCoverage.count({ where: { deduction: { authorityId: applied.id }, amountMinor: 10000 } })).toBe(1);
      expect(await db.vendorBalanceEvent.count({ where: { financialCorrectionAuthorityId: applied.id } })).toBe(0);
    }
    const replacement = await prepare({ vendorId: ids.vendor }, ids.admin);
    payoutIds.push(replacement.id);
    expect(replacement.payableBeforeDebtOffset).toBe(direction === 'VENDOR_CREDIT' ? '1100.00' : '900.00');
    expect(replacement.debtOffsetAmount).toBe('60.00');
    expect(replacement.netAmount).toBe(direction === 'VENDOR_CREDIT' ? '1040.00' : '840.00');
  });

  it.each(['VENDOR_CREDIT', 'VENDOR_DEDUCTION'] as const)('blocks REVIEW for %s without finance writes', async (direction) => {
    const { draft, input } = await seed(direction);
    await markReview(draft.id);
    expect((await state(ids.review, db as never)).reasonCode).toBe('PAYOUT_ALREADY_REVIEW');
    await expect(apply(input, db as never)).rejects.toMatchObject({ code: 'PAYOUT_ALREADY_REVIEW' });
    expect(await db.financialCorrectionAuthority.count({ where: { reviewId: ids.review } })).toBe(0);
    expect(await db.financialCorrectionBaselineClaim.count({ where: { acceptedEvidenceSnapshotId: ids.snapshot } })).toBe(0);
    expect((await db.payoutBatch.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe('REVIEW');
  });

  it('cannot resurrect a cancelled payout into REVIEW', async () => {
    const { draft } = await seed('VENDOR_CREDIT');
    await cancel(draft.id);
    await expect(markReview(draft.id)).rejects.toThrow();
    expect((await db.payoutBatch.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe('CANCELLED');
  });

  it('fails closed when the DRAFT net no longer reconciles with frozen sources', async () => {
    const { draft, input } = await seed('VENDOR_CREDIT', 6000);
    await db.payoutBatch.update({ where: { id: draft.id }, data: { netAmount: '999.00' } });
    await expect(apply(input, db as never)).rejects.toMatchObject({ code: 'PAYOUT_SOURCE_MISMATCH' });
    expect((await db.payoutBatch.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe('DRAFT');
    expect(await db.financialCorrectionAuthority.count({ where: { reviewId: ids.review } })).toBe(0);
  });

  it.each(['VENDOR_CREDIT', 'VENDOR_DEDUCTION'] as const)('only one of concurrent Mark Review and %s Cancel + Apply can win', async (direction) => {
    const { draft, input } = await seed(direction);
    const results = await Promise.allSettled([apply(input, db as never), markReview(draft.id)]);
    const batch = await db.payoutBatch.findUniqueOrThrow({ where: { id: draft.id } });
    expect(['CANCELLED', 'REVIEW']).toContain(batch.status);
    if (batch.status === 'CANCELLED') {
      expect(results[0].status).toBe('fulfilled');
      expect(await db.financialCorrectionAuthority.count({ where: { reviewId: ids.review } })).toBe(1);
    } else {
      expect(results[1].status).toBe('fulfilled');
      expect(await db.financialCorrectionAuthority.count({ where: { reviewId: ids.review } })).toBe(0);
    }
  });

  it.each(['VENDOR_CREDIT', 'VENDOR_DEDUCTION'] as const)('concurrent %s Apply creates one authority and one effect', async (direction) => {
    const { draft, input } = await seed(direction);
    const results = await Promise.allSettled([apply(input, db as never), apply(input, db as never)]);
    expect(results.some((result) => result.status === 'fulfilled')).toBe(true);
    expect((await db.payoutBatch.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe('CANCELLED');
    expect(await db.financialCorrectionAuthority.count({ where: { reviewId: ids.review } })).toBe(1);
    expect(await db.financialCorrectionBaselineClaim.count({ where: { acceptedEvidenceSnapshotId: ids.snapshot } })).toBe(1);
    expect(direction === 'VENDOR_CREDIT'
      ? await db.financialCorrectionCredit.count({ where: { authority: { reviewId: ids.review } } })
      : await db.financialCorrectionDeduction.count({ where: { authority: { reviewId: ids.review } } })).toBe(1);
  });

  it('manual cancellation racing with Apply cannot apply after manual cancel wins', async () => {
    const { draft, input } = await seed('VENDOR_CREDIT');
    const results = await Promise.allSettled([apply(input, db as never), cancel(draft.id)]);
    expect((await db.payoutBatch.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe('CANCELLED');
    const count = await db.financialCorrectionAuthority.count({ where: { reviewId: ids.review } });
    expect([0, 1]).toContain(count);
    if (results[1].status === 'fulfilled') expect(count).toBe(0);
    if (results[0].status === 'fulfilled') expect(count).toBe(1);
  });

  it('rolls back cancellation and baseline when credit-effect writing fails', async () => {
    const { draft, input } = await seed('VENDOR_CREDIT');
    await db.$executeRawUnsafe(`CREATE FUNCTION phase2f1_reject_credit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'phase2f1 injected effect failure'; END; $$`);
    await db.$executeRawUnsafe(`CREATE TRIGGER phase2f1_reject_credit BEFORE INSERT ON "FinancialCorrectionCredit"
      FOR EACH ROW EXECUTE FUNCTION phase2f1_reject_credit()`);
    try {
      await expect(apply(input, db as never)).rejects.toThrow('phase2f1 injected effect failure');
      expect((await db.payoutBatch.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe('DRAFT');
      expect(await db.financialCorrectionAuthority.count({ where: { reviewId: ids.review } })).toBe(0);
      expect(await db.financialCorrectionBaselineClaim.count({ where: { acceptedEvidenceSnapshotId: ids.snapshot } })).toBe(0);
    } finally {
      await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS phase2f1_reject_credit ON "FinancialCorrectionCredit"');
      await db.$executeRawUnsafe('DROP FUNCTION IF EXISTS phase2f1_reject_credit()');
    }
  });

  it('does not claim a baseline when DRAFT cancellation itself fails', async () => {
    const { draft, input } = await seed('VENDOR_DEDUCTION');
    await db.$executeRawUnsafe(`CREATE FUNCTION phase2f1_reject_cancel() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW."status" = 'CANCELLED' THEN RAISE EXCEPTION 'phase2f1 injected cancellation failure'; END IF;
      RETURN NEW; END; $$`);
    await db.$executeRawUnsafe(`CREATE TRIGGER phase2f1_reject_cancel BEFORE UPDATE ON "PayoutBatch"
      FOR EACH ROW EXECUTE FUNCTION phase2f1_reject_cancel()`);
    try {
      await expect(apply(input, db as never)).rejects.toThrow('phase2f1 injected cancellation failure');
      expect((await db.payoutBatch.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe('DRAFT');
      expect(await db.financialCorrectionAuthority.count({ where: { reviewId: ids.review } })).toBe(0);
      expect(await db.financialCorrectionBaselineClaim.count({ where: { acceptedEvidenceSnapshotId: ids.snapshot } })).toBe(0);
    } finally {
      await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS phase2f1_reject_cancel ON "PayoutBatch"');
      await db.$executeRawUnsafe('DROP FUNCTION IF EXISTS phase2f1_reject_cancel()');
    }
  });
});
