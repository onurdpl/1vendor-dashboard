import { describe, expect, it } from 'vitest';
import { PrismaClient } from '../backend/node_modules/@prisma/client/index.js';

const databaseUrl = process.env.TEST_DATABASE_URL?.trim();
const describeWithPostgres = databaseUrl ? describe : describe.skip;
const reason = 'A pending Financial Correction deduction requires a vendor-wide settlement draft.';

describeWithPostgres('FIN-BUG-005 isolated scheduled preview with real PostgreSQL', () => {
  let sequence = 0;

  async function fixture() {
    const target = new URL(databaseUrl!);
    if (process.env.FIN_BUG_005_TEST_DATABASE_ISOLATED !== '1' ||
        !['127.0.0.1', 'localhost'].includes(target.hostname) ||
        target.pathname.slice(1) !== 'fin_bug_005_validation') {
      throw new Error('FIN-BUG-005 requires isolated local fin_bug_005_validation.');
    }
    process.env.DATABASE_URL = databaseUrl;
    const [{ normalizeRefundEvidence }, { previewTerminalFinancialCorrection },
      { applyBeforeSettlementFinancialCorrectionDeduction },
      { previewApproval }, { getSettlementScheduleDryRun, createSettlementScheduleDrafts },
      { recordVerifiedDeliveredObservation }] = await Promise.all([
      import('../backend/src/modules/finance/refund-evidence-normalizer.service.js'),
      import('../backend/src/modules/finance/financial-correction-preview.service.js'),
      import('../backend/src/modules/finance/financial-correction-before-settlement-deduction.service.js'),
      import('../backend/src/modules/finance/settlement-approval.service.js'),
      import('../backend/src/modules/finance/settlement-schedule.service.js'),
      import('../backend/src/modules/shipping/allocation-delivered-observation.service.js'),
    ]);
    const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await db.$connect();
    const prefix = `finbug005-${process.pid}-${Date.now()}-${++sequence}`;
    const vendor = (letter: string) => `${prefix}-${letter}-vendor`;
    const admin = `${prefix}-admin`;
    const observationTimes: Date[] = [];
    await db.user.create({ data: { id: admin, email: `${prefix}@example.test`, name: 'Test Admin', role: 'ADMIN', passwordHash: 'test-only' } });
    for (const letter of ['a', 'b', 'c']) {
      await db.vendor.create({ data: { id: vendor(letter), name: `Vendor ${letter}` } });
      await db.vendorFinancialProfile.create({ data: {
        vendorId: vendor(letter), settlementDelayDays: 0, settlementFrequencyType: 'WEEKLY',
        weeklySettlementDay: 'WEDNESDAY', autoSettlementDraftEnabled: true,
      } });
      const order = `${prefix}-${letter}-ordinary-order`;
      const allocation = `${prefix}-${letter}-ordinary-allocation`;
      const execution = `${prefix}-${letter}-execution`;
      await db.shopifyOrder.create({ data: {
        id: order, sourceShopifyOrderId: `gid://shopify/Order/${order}`, sourceShopifyOrderNumber: `#${order}`,
      } });
      await db.vendorAllocation.create({ data: {
        id: allocation, sourceShopifyOrderId: order, sourceShopifyOrderNumber: `#${order}`,
        originalVendorId: vendor(letter), assignedVendorId: vendor(letter),
        outboundMethodSnapshot: 'KARGONOMI', fulfillmentStatus: 'Fulfilled', shippingStatus: 'Delivered',
      } });
      await db.shipmentExecution.create({ data: {
        id: execution, allocationId: allocation, vendorId: vendor(letter), provider: 'KARGONOMI',
        providerShipmentId: `${prefix}-${letter}-shipment`, shipmentStatus: 'DELIVERED', requestSnapshot: {},
      } });
      const [{ observedBefore }] = await db.$queryRaw<Array<{ observedBefore: Date }>>`
        SELECT timezone('UTC', clock_timestamp()) AS "observedBefore"
      `;
      const observation = await recordVerifiedDeliveredObservation({
        allocationId: allocation,
        source: { method: 'KARGONOMI', shipmentExecutionId: execution, sourceReference: `${prefix}-${letter}-shipment` },
      }, db as never);
      const [{ observedAfter }] = await db.$queryRaw<Array<{ observedAfter: Date }>>`
        SELECT timezone('UTC', clock_timestamp()) AS "observedAfter"
      `;
      expect(observation).toMatchObject({
        vendorAllocationId: allocation, outboundMethod: 'KARGONOMI',
        outboundIntegrationProvider: null, sourceReference: `${prefix}-${letter}-shipment`,
        shipmentExecutionId: execution,
      });
      expect(observation.firstObservedDeliveredAt.getTime()).toBeGreaterThanOrEqual(observedBefore.getTime());
      expect(observation.firstObservedDeliveredAt.getTime()).toBeLessThanOrEqual(observedAfter.getTime());
      observationTimes.push(observation.firstObservedDeliveredAt);
      await db.fulfillment.create({ data: {
        id: `${prefix}-${letter}-fulfillment`, vendorAllocationId: allocation,
        fulfillmentStatus: 'Delivered', shipmentUpdatedAt: new Date('2026-09-01T00:00:00.000Z'),
      } });
      await db.financeLedgerEntry.create({ data: {
        id: `${prefix}-${letter}-ordinary-sale`, vendorAllocationId: allocation, vendorId: vendor(letter),
        entryType: 'sale', amount: letter === 'a' ? '100.00' : '200.00',
        payoutStatus: 'PENDING', settlementStatus: 'PENDING',
        commissionPercentSnapshot: '10.00', commissionVatPercentSnapshot: '20.00',
        settlementDelayDaysSnapshot: 0, createdAt: new Date('2026-09-01T00:00:00.000Z'),
      } });
    }

    // Use the next configured Wednesday after the latest real observation day.
    // This also keeps a fixture crossing a Wednesday UTC midnight in one cycle.
    const latestObservation = new Date(Math.max(...observationTimes.map((time) => time.getTime())));
    const scheduledRunDate = new Date(Date.UTC(
      latestObservation.getUTCFullYear(), latestObservation.getUTCMonth(), latestObservation.getUTCDate(),
    ));
    scheduledRunDate.setUTCDate(scheduledRunDate.getUTCDate() + ((3 - scheduledRunDate.getUTCDay() + 7) % 7 || 7));
    const runDate = scheduledRunDate.toISOString().slice(0, 10);
    const periodEnd = new Date(scheduledRunDate.getTime() + 24 * 60 * 60 * 1000 - 1);
    expect(observationTimes.every((time) => time.getTime() <= periodEnd.getTime())).toBe(true);

    const order = `${prefix}-correction-order`;
    const allocation = `${prefix}-correction-allocation`;
    const sale = `${prefix}-correction-sale`;
    const refundLedger = `${prefix}-correction-refund-ledger`;
    const refundRecord = `${prefix}-refund-record`;
    const snapshot = `${prefix}-snapshot`;
    const review = `${prefix}-review`;
    const sourceShopifyOrderId = `gid://shopify/Order/${order}`;
    const sourceShopifyRefundId = `gid://shopify/Refund/${prefix}`;
    const normalized = (lineAmount: string) => normalizeRefundEvidence({
      sourceShopifyRefundId, sourceShopifyOrderId, vendorAllocationId: allocation,
      monetaryClassification: 'MONETARY_REFUND', refundTotalAmount: '150.00', currency: 'TRY',
      transactions: [{ transactionGid: `gid://shopify/OrderTransaction/${prefix}`, kind: 'REFUND',
        status: 'SUCCESS', amount: '150.00', currency: 'TRY' }],
      refundLines: [{ sourceLineItemId: `gid://shopify/LineItem/${prefix}`, quantity: 2,
        subtotalAmount: lineAmount, currency: 'TRY' }],
      historicalEconomicVendorId: vendor('a'), historicalSaleFinanceLedgerEntryId: sale,
      supersededSaleLedgerIds: [],
    });
    const accepted = normalized('50.00');
    const incoming = normalized('150.00');
    await db.shopifyOrder.create({ data: { id: order, sourceShopifyOrderId, sourceShopifyOrderNumber: `#${order}` } });
    await db.vendorAllocation.create({ data: {
      id: allocation, sourceShopifyOrderId: order, sourceShopifyOrderNumber: `#${order}`,
      originalVendorId: vendor('a'), assignedVendorId: vendor('a'),
      fulfillmentStatus: 'Fulfilled', shippingStatus: 'Delivered',
    } });
    await db.fulfillment.create({ data: {
      id: `${prefix}-correction-fulfillment`, vendorAllocationId: allocation,
      fulfillmentStatus: 'Fulfilled', fulfilledAt: new Date('2026-09-01T00:00:00.000Z'),
      shipmentUpdatedAt: new Date('2026-09-01T00:00:00.000Z'),
    } });
    await db.refundRecord.create({ data: {
      id: refundRecord, vendorAllocationId: allocation, sourceShopifyOrderId,
      sourceShopifyOrderNumber: `#${order}`, sourceShopifyRefundId, amount: '50.00', status: 'processed',
    } });
    await db.financeLedgerEntry.create({ data: {
      id: sale, vendorAllocationId: allocation, vendorId: vendor('a'), entryType: 'sale', amount: '200.00',
      settlementDelayDaysSnapshot: 0, commissionPercentSnapshot: '0.00', commissionVatPercentSnapshot: '20.00',
      settlementStatus: 'PENDING', payoutStatus: 'PENDING',
    } });
    await db.financeLedgerEntry.create({ data: {
      id: refundLedger, vendorAllocationId: allocation, vendorId: vendor('a'), entryType: 'refund', amount: '50.00',
      commissionPercentSnapshot: '0.00', commissionVatPercentSnapshot: '20.00',
      settlementStatus: 'PENDING', payoutStatus: 'PENDING',
    } });
    await db.refundEvidenceSnapshot.create({ data: {
      id: snapshot, sourceShopifyRefundId, sourceShopifyOrderId, vendorAllocationId: allocation,
      refundRecordId: refundRecord, refundFinanceLedgerEntryId: refundLedger,
      historicalEconomicVendorId: vendor('a'), historicalSaleFinanceLedgerEntryId: sale,
      monetaryClassification: 'MONETARY_REFUND', refundTotalAmount: '150.00', currency: 'TRY',
      normalizedTransactionsJson: accepted.normalizedTransactionsJson,
      normalizedRefundLinesJson: accepted.normalizedRefundLinesJson,
      normalizedOwnershipJson: accepted.normalizedOwnershipJson,
      normalizedEvidenceJson: accepted.normalizedEvidenceJson,
      supersededSaleLedgerIdsJson: [], evidenceHash: accepted.evidenceHash,
      hashAlgorithm: accepted.hashAlgorithm, evidenceVersion: accepted.evidenceVersion,
      normalizationVersion: accepted.normalizationVersion, evidenceSource: 'fin_bug_005_postgres_test',
      capturedAt: new Date('2026-09-01T10:00:00.000Z'),
    } });
    await db.refundTerminalEvidenceReview.create({ data: {
      id: review, sourceShopifyRefundId, sourceShopifyOrderId, vendorAllocationId: allocation,
      terminalRefundFinanceLedgerEntryId: refundLedger, refundRecordId: refundRecord,
      economicVendorId: vendor('a'), storedEvidenceSnapshotId: snapshot,
      dedupeKey: `${prefix}-dedupe`, conflictCategory: 'financial_evidence_conflict',
      storedEvidenceHash: accepted.evidenceHash, incomingEvidenceHash: incoming.evidenceHash,
      conflictSummaryJson: {}, status: 'RESOLVED', resolutionOutcome: 'CORRECTION_REQUIRED',
    } });
    await db.refundTerminalConflictEvidence.create({ data: {
      id: `${prefix}-incoming`, reviewId: review, sourceShopifyRefundId, sourceShopifyOrderId,
      vendorAllocationId: allocation, economicVendorId: vendor('a'),
      historicalSaleFinanceLedgerEntryId: sale, supersededSaleLedgerIdsJson: [],
      refundTotalAmount: '150.00', currency: 'TRY', normalizedEvidenceJson: incoming.normalizedEvidenceJson,
      evidenceHash: incoming.evidenceHash, hashAlgorithm: incoming.hashAlgorithm,
      evidenceVersion: incoming.evidenceVersion, normalizationVersion: incoming.normalizationVersion,
    } });
    await db.refundTerminalEvidenceReviewEvent.create({ data: {
      id: `${prefix}-resolved`, reviewId: review, eventType: 'RESOLVED',
      resolutionOutcome: 'CORRECTION_REQUIRED', actorUserId: admin,
    } });

    const applyDeduction = async () => {
      const preview = await previewTerminalFinancialCorrection(review, db as never);
      return applyBeforeSettlementFinancialCorrectionDeduction({
        reviewId: review, previewFingerprint: preview.previewFingerprint,
        actorUserId: admin, reason: 'Verified isolated test deduction',
      }, db as never);
    };
    return { db, prefix, vendor, review, snapshot, applyDeduction, previewApproval,
      runDate, periodEnd, scheduledRunDate,
      getSettlementScheduleDryRun, createSettlementScheduleDrafts };
  }

  it('blocks A with unchanged correction authority while B/C keep their monetary previews and create owned drafts', async () => {
    const f = await fixture();
    try {
      const baselineB = await f.previewApproval(f.vendor('b'), null, f.periodEnd,
        { candidateScope: 'date_range', asOfDate: f.periodEnd });
      const baselineC = await f.previewApproval(f.vendor('c'), null, f.periodEnd,
        { candidateScope: 'date_range', asOfDate: f.periodEnd });
      expect(baselineB.summary.eligibleRowCount).toBeGreaterThan(0);
      expect(baselineC.summary.eligibleRowCount).toBeGreaterThan(0);
      const applied = await f.applyDeduction();
      const authorityBefore = await f.db.financialCorrectionAuthority.findUniqueOrThrow({ where: { id: applied.id } });
      const claimBefore = await f.db.financialCorrectionBaselineClaim.findUniqueOrThrow({
        where: { acceptedEvidenceSnapshotId: f.snapshot },
      });
      const deductionBefore = await f.db.financialCorrectionDeduction.findUniqueOrThrow({ where: { id: applied.deductionId } });
      const dryRun = await f.getSettlementScheduleDryRun({ runDate: f.runDate });
      const owned = dryRun.vendors.filter((item) => ['a', 'b', 'c'].some((letter) => item.vendorId === f.vendor(letter)));
      expect(owned.map((item) => item.vendorId)).toEqual(['a', 'b', 'c'].map(f.vendor));
      expect(owned[0]).toEqual(expect.objectContaining({ state: 'BLOCKED', preview: null,
        canCreateDraft: false, blockedReason: reason }));
      expect(owned[1].preview?.summary).toEqual(expect.objectContaining({ netPayableMinor: baselineB.summary.netPayableMinor }));
      expect(owned[2].preview?.summary).toEqual(expect.objectContaining({ netPayableMinor: baselineC.summary.netPayableMinor }));
      expect(dryRun.writesPerformed).toBe(false);
      const result = await f.createSettlementScheduleDrafts({ runDate: f.runDate, confirmAutoSettlementDrafts: true });
      expect(result.skipped).toContainEqual({ vendorId: f.vendor('a'), reason });
      expect(result.summary).toEqual(expect.objectContaining({ created: 2, skipped: 1, failed: 0 }));
      expect(result.writesPerformed).toBe(true);
      expect(result.createdDrafts.filter((item) => [f.vendor('b'), f.vendor('c')].includes(item.vendorId)))
        .toEqual(expect.arrayContaining([
          expect.objectContaining({ vendorId: f.vendor('b'), netPayableMinor: baselineB.summary.netPayableMinor }),
          expect.objectContaining({ vendorId: f.vendor('c'), netPayableMinor: baselineC.summary.netPayableMinor }),
        ]));
      expect(await f.db.settlementApproval.count({ where: { vendorId: f.vendor('a') } })).toBe(0);
      expect(await f.db.financialCorrectionDeductionSettlementLine.count({ where: { deductionId: applied.deductionId } })).toBe(0);
      expect(await f.db.financialCorrectionAuthority.findUniqueOrThrow({ where: { id: applied.id } })).toEqual(authorityBefore);
      expect(await f.db.financialCorrectionBaselineClaim.findUniqueOrThrow({
        where: { acceptedEvidenceSnapshotId: f.snapshot },
      })).toEqual(claimBefore);
      expect(await f.db.financialCorrectionDeduction.findUniqueOrThrow({ where: { id: applied.deductionId } })).toEqual(deductionBefore);
      expect(await f.db.settlementApproval.count({ where: { scheduledRunDate: f.scheduledRunDate,
        vendorId: { in: [f.vendor('b'), f.vendor('c')] } } })).toBe(2);
      for (const letter of ['b', 'c']) {
        const draft = await f.db.settlementApproval.findUniqueOrThrow({
          where: { scheduledCycleKey: `scheduled-settlement:${f.vendor(letter)}:${f.runDate}` },
          include: { lines: { include: { financeLedgerEntry: { include: { vendorAllocation: true } } } } },
        });
        expect(draft.vendorId).toBe(f.vendor(letter));
        expect(draft.lines).toHaveLength(1);
        expect(draft.lines[0].lineType).toBe('SALE');
        expect(draft.lines[0].financeLedgerEntryId).toBe(`${f.prefix}-${letter}-ordinary-sale`);
        expect(draft.lines[0].financeLedgerEntry.vendorId).toBe(f.vendor(letter));
        expect(draft.lines[0].financeLedgerEntry.vendorAllocation.outboundMethodSnapshot).toBe('KARGONOMI');
      }
      const replay = await f.createSettlementScheduleDrafts({ runDate: f.runDate, confirmAutoSettlementDrafts: true });
      expect(replay.summary.created).toBe(0);
      expect(replay.skipped).toContainEqual({ vendorId: f.vendor('a'), reason });
      expect(await f.db.settlementApproval.count({ where: { scheduledRunDate: f.scheduledRunDate,
        vendorId: { in: [f.vendor('b'), f.vendor('c')] } } })).toBe(2);
    } finally {
      await f.db.$disconnect();
    }
  });

  it('stages a valid correction between two real service passes without drafting A', async () => {
    const f = await fixture();
    try {
      const first = await f.getSettlementScheduleDryRun({ runDate: f.runDate });
      expect(first.vendors.find((item) => item.vendorId === f.vendor('a'))?.state).toBe('READY');
      const applied = await f.applyDeduction();
      const second = await f.createSettlementScheduleDrafts({ runDate: f.runDate, confirmAutoSettlementDrafts: true });
      expect(second.dryRun.vendors.find((item) => item.vendorId === f.vendor('a')))
        .toEqual(expect.objectContaining({ state: 'BLOCKED', preview: null, canCreateDraft: false, blockedReason: reason }));
      expect(second.skipped).toContainEqual({ vendorId: f.vendor('a'), reason });
      expect(second.createdDrafts.map((item) => item.vendorId)).toEqual([f.vendor('b'), f.vendor('c')]);
      expect(await f.db.settlementApproval.count({ where: { vendorId: f.vendor('a') } })).toBe(0);
      expect(await f.db.financialCorrectionDeductionSettlementLine.count({ where: { deductionId: applied.deductionId } })).toBe(0);
    } finally {
      await f.db.$disconnect();
    }
  });
});
