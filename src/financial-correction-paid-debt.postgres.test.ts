import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../backend/node_modules/@prisma/client/index.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
const describeWithPostgres = testDatabaseUrl ? describe : describe.skip;

describeWithPostgres('paid financial correction with real PostgreSQL', () => {
  const runId = `phase2c-${process.pid}-${Date.now()}`;
  const ids = {
    vendor: `${runId}-vendor`, admin: `${runId}-admin`, order: `${runId}-order`,
    allocation: `${runId}-allocation`, refundRecord: `${runId}-refund-record`,
    sale: `${runId}-sale`, refundLedger: `${runId}-refund-ledger`,
    snapshot: `${runId}-snapshot`, review: `${runId}-review`, incoming: `${runId}-incoming`,
    resolvedEvent: `${runId}-resolved`, settlement: `${runId}-settlement`,
    settlementLine: `${runId}-settlement-line`, payout: `${runId}-payout`,
    payoutLine: `${runId}-payout-line`,
    futureAllocation: `${runId}-future-allocation`, futureFulfillment: `${runId}-future-fulfillment`,
    futureSale: `${runId}-future-sale`, futureSettlement: `${runId}-future-settlement`,
    futureSettlementLine: `${runId}-future-settlement-line`,
  };
  const sourceShopifyOrderId = `gid://shopify/Order/${runId}`;
  const sourceShopifyRefundId = `gid://shopify/Refund/${runId}`;
  const paidAt = new Date('2026-09-01T12:00:00.000Z');
  let db: PrismaClient;
  let normalizeRefundEvidence: typeof import('../backend/src/modules/finance/refund-evidence-normalizer.service.js')['normalizeRefundEvidence'];
  let previewTerminalFinancialCorrection: typeof import('../backend/src/modules/finance/financial-correction-preview.service.js')['previewTerminalFinancialCorrection'];
  let applyPaidFinancialCorrectionDebt: typeof import('../backend/src/modules/finance/financial-correction-paid-debt.service.js')['applyPaidFinancialCorrectionDebt'];
  let getVendorBalanceSummary: typeof import('../backend/src/modules/finance/vendor-balance.service.js')['getVendorBalanceSummary'];
  let createVendorDebtForPaidRefund: typeof import('../backend/src/modules/finance/vendor-balance.service.js')['createVendorDebtForPaidRefund'];
  let preparePayoutBatch: typeof import('../backend/src/modules/finance/finance.service.js')['preparePayoutBatch'];
  let futurePayoutId: string | null = null;

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

  beforeAll(async () => {
    const target = new URL(testDatabaseUrl!);
    if (process.env.PHASE2C_TEST_DATABASE_ISOLATED !== '1' ||
        !['127.0.0.1', 'localhost'].includes(target.hostname) ||
        !['phase2c_bootstrap', 'vendor_dashboard_fresh_bootstrap'].includes(target.pathname.slice(1))) {
      throw new Error('Phase 2C PostgreSQL test requires an explicitly isolated local test database.');
    }
    process.env.DATABASE_URL = testDatabaseUrl;
    ({ normalizeRefundEvidence } = await import('../backend/src/modules/finance/refund-evidence-normalizer.service.js'));
    ({ previewTerminalFinancialCorrection } = await import('../backend/src/modules/finance/financial-correction-preview.service.js'));
    ({ applyPaidFinancialCorrectionDebt } = await import('../backend/src/modules/finance/financial-correction-paid-debt.service.js'));
    ({ getVendorBalanceSummary, createVendorDebtForPaidRefund } = await import('../backend/src/modules/finance/vendor-balance.service.js'));
    ({ preparePayoutBatch } = await import('../backend/src/modules/finance/finance.service.js'));
    db = new PrismaClient({ datasources: { db: { url: testDatabaseUrl } } });
    await db.$connect();
    const accepted = normalized('100.00');
    const incoming = normalized('120.00');
    await db.user.create({ data: { id: ids.admin, email: `${runId}@example.test`, name: 'Phase 2C Admin', role: 'ADMIN', passwordHash: 'test-only' } });
    await db.vendor.create({ data: { id: ids.vendor, name: 'Phase 2C Vendor' } });
    await db.shopifyOrder.create({ data: { id: ids.order, sourceShopifyOrderId, sourceShopifyOrderNumber: `#${runId}` } });
    await db.vendorAllocation.create({ data: {
      id: ids.allocation, sourceShopifyOrderId: ids.order, sourceShopifyOrderNumber: `#${runId}`,
      originalVendorId: ids.vendor, assignedVendorId: ids.vendor,
    } });
    await db.refundRecord.create({ data: {
      id: ids.refundRecord, vendorAllocationId: ids.allocation, sourceShopifyOrderId,
      sourceShopifyOrderNumber: `#${runId}`, sourceShopifyRefundId, amount: '100.00', status: 'processed',
    } });
    await db.financeLedgerEntry.create({ data: {
      id: ids.sale, vendorAllocationId: ids.allocation, vendorId: ids.vendor,
      entryType: 'sale', amount: '200.00', commissionPercentSnapshot: '10.00',
      commissionVatPercentSnapshot: '20.00', settlementStatus: 'SETTLED', payoutStatus: 'PAID',
    } });
    await db.financeLedgerEntry.create({ data: {
      id: ids.refundLedger, vendorAllocationId: ids.allocation, vendorId: ids.vendor,
      entryType: 'refund', amount: '100.00', commissionPercentSnapshot: '10.00',
      commissionVatPercentSnapshot: '20.00',
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
      normalizationVersion: accepted.normalizationVersion, evidenceSource: 'phase2c_postgres_test',
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
      id: ids.resolvedEvent, reviewId: ids.review, eventType: 'RESOLVED',
      resolutionOutcome: 'CORRECTION_REQUIRED', actorUserId: ids.admin,
    } });
    await db.settlementApproval.create({ data: {
      id: ids.settlement, vendorId: ids.vendor, status: 'APPROVED', currency: 'TRY',
      grossSalesMinor: 20000, refundTotalMinor: 0, commissionMinor: 2000,
      commissionVatMinor: 400, netPayableMinor: 17600, sourceSnapshotJson: {},
    } });
    await db.settlementApprovalLine.create({ data: {
      id: ids.settlementLine, settlementApprovalId: ids.settlement, financeLedgerEntryId: ids.sale,
      lineType: 'SALE', amountMinor: 20000, commissionMinor: 2000,
      commissionVatMinor: 400, payableImpactMinor: 17600, sourceSnapshotJson: {},
    } });
    await db.payoutBatch.create({ data: {
      id: ids.payout, vendorId: ids.vendor, status: 'PAID', paidAt, currency: 'TRY',
      grossAmount: '200.00', commissionAmount: '20.00', commissionVatAmount: '4.00', netAmount: '176.00',
    } });
    await db.payoutBatchLine.create({ data: {
      id: ids.payoutLine, payoutBatchId: ids.payout, financeLedgerEntryId: ids.sale,
      settlementApprovalLineId: ids.settlementLine, amountSnapshot: '176.00',
    } });
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
      entryType: 'sale', amount: '400.00', settlementDelayDaysSnapshot: 0,
      settlementStatus: 'PAYABLE', payoutStatus: 'APPROVED',
      commissionPercentSnapshot: '0.00', commissionVatPercentSnapshot: '0.00',
    } });
    await db.settlementApproval.create({ data: {
      id: ids.futureSettlement, vendorId: ids.vendor, status: 'APPROVED', currency: 'TRY',
      grossSalesMinor: 40000, refundTotalMinor: 0, commissionMinor: 0,
      commissionVatMinor: 0, netPayableMinor: 40000, sourceSnapshotJson: {},
    } });
    await db.settlementApprovalLine.create({ data: {
      id: ids.futureSettlementLine, settlementApprovalId: ids.futureSettlement,
      financeLedgerEntryId: ids.futureSale, lineType: 'SALE', amountMinor: 40000,
      commissionMinor: 0, commissionVatMinor: 0, payableImpactMinor: 40000, sourceSnapshotJson: {},
    } });
  });

  afterAll(async () => {
    if (!db) return;
    await db.vendorBalanceEvent.deleteMany({ where: { vendorId: ids.vendor } });
    await db.financialCorrectionAuthority.deleteMany({ where: { reviewId: ids.review } });
    await db.financialCorrectionBaselineClaim.deleteMany({ where: { acceptedEvidenceSnapshotId: ids.snapshot } });
    if (futurePayoutId) {
      await db.payoutBatchLine.deleteMany({ where: { payoutBatchId: futurePayoutId } });
      await db.payoutBatch.deleteMany({ where: { id: futurePayoutId } });
    }
    await db.payoutBatchLine.deleteMany({ where: { id: ids.payoutLine } });
    await db.payoutBatch.deleteMany({ where: { id: ids.payout } });
    await db.settlementApprovalLine.deleteMany({ where: { id: { in: [ids.settlementLine, ids.futureSettlementLine] } } });
    await db.settlementApproval.deleteMany({ where: { id: { in: [ids.settlement, ids.futureSettlement] } } });
    await db.refundTerminalEvidenceReviewEvent.deleteMany({ where: { id: ids.resolvedEvent } });
    await db.refundTerminalConflictEvidence.deleteMany({ where: { id: ids.incoming } });
    await db.refundTerminalEvidenceReview.deleteMany({ where: { id: ids.review } });
    await db.refundEvidenceSnapshot.deleteMany({ where: { id: ids.snapshot } });
    await db.financeLedgerEntry.deleteMany({ where: { id: { in: [ids.sale, ids.refundLedger, ids.futureSale] } } });
    await db.refundRecord.deleteMany({ where: { id: ids.refundRecord } });
    await db.fulfillment.deleteMany({ where: { id: ids.futureFulfillment } });
    await db.vendorAllocation.deleteMany({ where: { id: { in: [ids.allocation, ids.futureAllocation] } } });
    await db.shopifyOrder.deleteMany({ where: { id: ids.order } });
    await db.vendor.deleteMany({ where: { id: ids.vendor } });
    await db.user.deleteMany({ where: { id: ids.admin } });
    await db.$disconnect();
  });

  it('rolls back authority and claim when the correction debt write fails', async () => {
    const preview = await previewTerminalFinancialCorrection(ids.review, db as never);
    const triggerName = `phase2c_fail_debt_${process.pid}`;
    const functionName = `phase2c_fail_debt_fn_${process.pid}`;
    await db.$executeRawUnsafe(`
      CREATE FUNCTION "${functionName}"() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'phase2c forced correction debt failure'; END;
      $$ LANGUAGE plpgsql
    `);
    try {
      await db.$executeRawUnsafe(`
        CREATE TRIGGER "${triggerName}" BEFORE INSERT ON "VendorBalanceEvent"
        FOR EACH ROW WHEN (NEW."sourceType" = 'financial_correction' AND NEW."vendorId" = '${ids.vendor}')
        EXECUTE FUNCTION "${functionName}"()
      `);
      await expect(applyPaidFinancialCorrectionDebt({
        reviewId: ids.review, previewFingerprint: preview.previewFingerprint,
        actorUserId: ids.admin, reason: 'Verified rollback',
      }, db as never)).rejects.toMatchObject({ code: 'EFFECT_WRITE_FAILED' });
      expect(await db.financialCorrectionAuthority.count({ where: { reviewId: ids.review } })).toBe(0);
      expect(await db.financialCorrectionBaselineClaim.count({ where: { acceptedEvidenceSnapshotId: ids.snapshot } })).toBe(0);
      expect(await db.vendorBalanceEvent.count({ where: { vendorId: ids.vendor, sourceType: 'financial_correction' } })).toBe(0);
    } finally {
      await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${triggerName}" ON "VendorBalanceEvent"`);
      await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${functionName}"()`);
    }
  });

  it('commits one exact correction debt under two concurrent Apply attempts', async () => {
    const preview = await previewTerminalFinancialCorrection(ids.review, db as never);
    expect(preview.economicDirection).toBe('VENDOR_DEDUCTION');
    expect(preview.difference.vendorPayableReversalMinor).toBe(1760);
    const historical = {
      payout: await db.payoutBatch.findUnique({ where: { id: ids.payout } }),
      settlement: await db.settlementApproval.findUnique({ where: { id: ids.settlement } }),
      sale: await db.financeLedgerEntry.findUnique({ where: { id: ids.sale } }),
      refund: await db.financeLedgerEntry.findUnique({ where: { id: ids.refundLedger } }),
      accepted: await db.refundEvidenceSnapshot.findUnique({ where: { id: ids.snapshot } }),
      incoming: await db.refundTerminalConflictEvidence.findUnique({ where: { id: ids.incoming } }),
    };
    const input = { reviewId: ids.review, previewFingerprint: preview.previewFingerprint,
      actorUserId: ids.admin, reason: 'Verified Phase 2C race' };
    let signalLockAcquired!: () => void;
    let releaseReviewLock!: () => void;
    const lockAcquired = new Promise<void>((resolve) => { signalLockAcquired = resolve; });
    const releaseLock = new Promise<void>((resolve) => { releaseReviewLock = resolve; });
    const blocker = db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "RefundTerminalEvidenceReview" WHERE "id" = ${ids.review} FOR UPDATE`;
      signalLockAcquired();
      await releaseLock;
    }, { timeout: 10_000 });
    await lockAcquired;
    const attempts = [
      applyPaidFinancialCorrectionDebt(input, db as never),
      applyPaidFinancialCorrectionDebt(input, db as never),
    ];
    let observedBlocked = 0;
    try {
      const deadline = Date.now() + 2_000;
      while (Date.now() < deadline) {
        const [activity] = await db.$queryRaw<Array<{ blocked: bigint }>>`
          SELECT count(*)::bigint AS "blocked" FROM pg_stat_activity
          WHERE datname = current_database() AND pid <> pg_backend_pid()
            AND wait_event_type = 'Lock'
            AND query LIKE '%RefundTerminalEvidenceReview%FOR UPDATE%'
        `;
        observedBlocked = Number(activity.blocked);
        if (observedBlocked >= 2) break;
        await new Promise<void>((resolve) => setTimeout(resolve, 10));
      }
    } finally {
      releaseReviewLock();
      await blocker;
    }
    const [first, second] = await Promise.allSettled(attempts);
    expect(observedBlocked).toBeGreaterThanOrEqual(2);
    console.info('Phase 2C PostgreSQL race outcomes:', [first, second].map((result) =>
      result.status === 'fulfilled' ? 'applied-or-idempotent' : String(result.reason?.code ?? 'unexpected-error')).join(', '));
    expect([first, second].some((result) => result.status === 'fulfilled')).toBe(true);
    for (const result of [first, second]) {
      if (result.status === 'rejected') {
        expect(['ALREADY_APPLIED', 'CONCURRENT_APPLICATION', 'BASELINE_ALREADY_CONSUMED']).toContain(result.reason?.code);
      }
    }
    const authorities = await db.financialCorrectionAuthority.findMany({ where: { reviewId: ids.review }, include: { debtEvent: true } });
    const debts = await db.vendorBalanceEvent.findMany({ where: { vendorId: ids.vendor, sourceType: 'financial_correction' } });
    const claims = await db.financialCorrectionBaselineClaim.findMany({ where: { acceptedEvidenceSnapshotId: ids.snapshot } });
    expect(authorities).toHaveLength(1);
    expect(debts).toHaveLength(1);
    expect(claims).toHaveLength(1);
    for (const result of [first, second]) {
      if (result.status === 'fulfilled') {
        expect(result.value).toMatchObject({ id: authorities[0].id, vendorBalanceEventId: debts[0].id });
      }
    }
    expect(claims[0]).toMatchObject({ consumerType: 'paid_vendor_debt', consumerId: authorities[0].id });
    expect(authorities[0].vendorPayableDifferenceMinor).toBe(1760);
    expect(authorities[0].debtEvent?.id).toBe(debts[0].id);
    expect(debts[0]).toMatchObject({ amountMinor: -1760, financialCorrectionAuthorityId: authorities[0].id,
      sourceId: authorities[0].id, sourceType: 'financial_correction' });
    expect(await getVendorBalanceSummary(db as never, ids.vendor, 'TRY')).toMatchObject({ outstandingDebtMinor: 1760 });
    const futurePayout = await preparePayoutBatch({ vendorId: ids.vendor }, ids.admin);
    futurePayoutId = futurePayout.id;
    const futureBatch = await db.payoutBatch.findUnique({ where: { id: futurePayout.id }, include: { vendorBalanceEvents: true } });
    expect(futureBatch?.netAmount.toString()).toBe('382.4');
    expect(futureBatch?.vendorBalanceEvents).toEqual([expect.objectContaining({
      type: 'VENDOR_DEBT_OFFSET', amountMinor: 1760, sourceType: 'payout_batch', sourceId: futurePayout.id,
    })]);
    expect(await db.vendorBalanceEvent.findUnique({ where: { id: debts[0].id } })).toMatchObject({ amountMinor: -1760 });
    expect(await db.payoutBatch.findUnique({ where: { id: ids.payout } })).toEqual(historical.payout);
    expect(await db.settlementApproval.findUnique({ where: { id: ids.settlement } })).toEqual(historical.settlement);
    expect(await db.financeLedgerEntry.findUnique({ where: { id: ids.sale } })).toEqual(historical.sale);
    expect(await db.financeLedgerEntry.findUnique({ where: { id: ids.refundLedger } })).toEqual(historical.refund);
    expect(await db.refundEvidenceSnapshot.findUnique({ where: { id: ids.snapshot } })).toEqual(historical.accepted);
    expect(await db.refundTerminalConflictEvidence.findUnique({ where: { id: ids.incoming } })).toEqual(historical.incoming);

    const normalRefundDebt = await createVendorDebtForPaidRefund(db as never, {
      vendorId: ids.vendor, refundRecordId: ids.refundRecord,
      sourceShopifyRefundId, financeLedgerEntryId: ids.refundLedger,
      refundAmount: '100.00', commissionPercentSnapshot: '10.00',
      commissionVatPercentSnapshot: '20.00', currency: 'TRY',
    });
    expect(normalRefundDebt).toMatchObject({ sourceType: 'shopify_refund', amountMinor: -8800 });
    const grossDebts = await db.vendorBalanceEvent.findMany({
      where: { vendorId: ids.vendor, type: 'VENDOR_DEBT_CREATED' },
      orderBy: { sourceType: 'asc' },
    });
    expect(grossDebts).toHaveLength(2);
    expect(grossDebts.map((event) => event.sourceType)).toEqual(['financial_correction', 'shopify_refund']);
  });

  it('rejects an incompatible zero-net claim for the consumed accepted baseline', async () => {
    await expect(db.financialCorrectionBaselineClaim.create({ data: {
      acceptedEvidenceSnapshotId: ids.snapshot,
      consumerType: 'zero_net_acknowledgement',
      consumerId: `${runId}-incompatible-zero-net`,
    } })).rejects.toMatchObject({ code: 'P2002' });
    expect(await db.financialCorrectionBaselineClaim.count({ where: { acceptedEvidenceSnapshotId: ids.snapshot } })).toBe(1);
    expect(await db.financialCorrectionAuthority.count({ where: { acceptedEvidenceSnapshotId: ids.snapshot } })).toBe(1);
  });

  it('rejects a second correction debt linked to the same authority', async () => {
    const authority = await db.financialCorrectionAuthority.findUniqueOrThrow({ where: { reviewId: ids.review } });
    await expect(db.vendorBalanceEvent.create({ data: {
      vendorId: ids.vendor, type: 'VENDOR_DEBT_CREATED', amountMinor: -1760, currency: 'TRY',
      sourceType: 'financial_correction', sourceId: authority.id,
      financialCorrectionAuthorityId: authority.id,
      idempotencyKey: `${runId}-different-key-same-authority`,
    } })).rejects.toMatchObject({ code: 'P2002' });
    expect(await db.vendorBalanceEvent.count({ where: { financialCorrectionAuthorityId: authority.id } })).toBe(1);
  });
});
