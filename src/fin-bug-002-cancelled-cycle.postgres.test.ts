import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '../backend/node_modules/@prisma/client/index.js';

const databaseUrl = process.env.TEST_DATABASE_URL?.trim();
const suite = databaseUrl ? describe : describe.skip;
const databaseName = 'fin_bug_002_validation';
const dayMs = 86_400_000;
const jobEnv = { SETTLEMENT_AUTO_DRAFT_JOB_ENABLED: true, SETTLEMENT_AUTO_DRAFT_JOB_DRY_RUN: false };

suite('FIN-BUG-002 current cancelled scheduled cycle behavior (PostgreSQL 16)', () => {
  let db: PrismaClient;
  let schedule: typeof import('../backend/src/modules/finance/settlement-schedule.service.js');
  let job: typeof import('../backend/src/modules/finance/settlement-schedule-job.service.js');
  let approval: typeof import('../backend/src/modules/finance/settlement-approval.service.js');
  let replacement: typeof import('../backend/src/modules/finance/settlement-replacement-assessment.service.js');
  let replacementWriter: typeof import('../backend/src/modules/finance/settlement-replacement-writer.service.js');
  let ingestRefund: typeof import('../backend/src/modules/shopify/refund-ingestion.service.js')['ingestVerifiedShopifyRefund'];
  let normalizeRefundEvidence: typeof import('../backend/src/modules/finance/refund-evidence-normalizer.service.js')['normalizeRefundEvidence'];
  let previewCorrection: typeof import('../backend/src/modules/finance/financial-correction-preview.service.js')['previewTerminalFinancialCorrection'];
  let applyCredit: typeof import('../backend/src/modules/finance/financial-correction-before-settlement-credit.service.js')['applyBeforeSettlementFinancialCorrectionCredit'];
  let applyDeduction: typeof import('../backend/src/modules/finance/financial-correction-before-settlement-deduction.service.js')['applyBeforeSettlementFinancialCorrectionDeduction'];
  let recordDelivery: typeof import('../backend/src/modules/shipping/allocation-delivered-observation.service.js')['recordVerifiedDeliveredObservation'];
  const root = `finbug002-${process.pid}-${Date.now()}`;
  let sequence = 0;

  beforeAll(async () => {
    const target = new URL(databaseUrl!);
    if (process.env.FIN_BUG_002_TEST_DATABASE_ISOLATED !== '1' ||
        target.protocol !== 'postgresql:' || target.hostname !== '127.0.0.1' ||
        target.pathname.slice(1) !== databaseName || !target.port) {
      throw new Error('FIN-BUG-002 requires dedicated local fin_bug_002_validation PostgreSQL.');
    }
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = databaseUrl;
    db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await db.$connect();
    const [identity] = await db.$queryRaw<Array<{ version: string; name: string; owner: string; port: number }>>`
      SELECT current_setting('server_version_num') AS version, current_database() AS name,
        current_user AS owner, inet_server_port() AS port`;
    expect(Number(identity.version)).toBeGreaterThanOrEqual(160000);
    expect(Number(identity.version)).toBeLessThan(170000);
    expect(identity.name).toBe(databaseName);
    expect(identity.owner).toBe(target.username);
    expect(identity.port).toBe(Number(target.port));
    [schedule, job, approval, replacement, replacementWriter, { recordVerifiedDeliveredObservation: recordDelivery },
      { ingestVerifiedShopifyRefund: ingestRefund }, { normalizeRefundEvidence },
      { previewTerminalFinancialCorrection: previewCorrection },
      { applyBeforeSettlementFinancialCorrectionCredit: applyCredit },
      { applyBeforeSettlementFinancialCorrectionDeduction: applyDeduction }] = await Promise.all([
      import('../backend/src/modules/finance/settlement-schedule.service.js'),
      import('../backend/src/modules/finance/settlement-schedule-job.service.js'),
      import('../backend/src/modules/finance/settlement-approval.service.js'),
      import('../backend/src/modules/finance/settlement-replacement-assessment.service.js'),
      import('../backend/src/modules/finance/settlement-replacement-writer.service.js'),
      import('../backend/src/modules/shipping/allocation-delivered-observation.service.js'),
      import('../backend/src/modules/shopify/refund-ingestion.service.js'),
      import('../backend/src/modules/finance/refund-evidence-normalizer.service.js'),
      import('../backend/src/modules/finance/financial-correction-preview.service.js'),
      import('../backend/src/modules/finance/financial-correction-before-settlement-credit.service.js'),
      import('../backend/src/modules/finance/financial-correction-before-settlement-deduction.service.js'),
    ]);
  });

  afterEach(async () => {
    vi.useRealTimers();
    // Immutable delivery observations and their parents stay until this dedicated DB is disposed.
    await db.vendorFinancialProfile.updateMany({ where: { vendorId: { startsWith: root } }, data: { active: false } });
  });

  afterAll(async () => {
    await db?.$disconnect();
    const { prisma } = await import('../backend/src/db/prisma.js');
    await prisma.$disconnect();
  });

  async function fixture() {
    const id = `${root}-${++sequence}`;
    const vendorId = `${id}-vendor`;
    const orderId = `${id}-order`;
    const allocationId = `${id}-allocation`;
    const executionId = `${id}-execution`;
    const shipmentReference = `${id}-shipment`;
    const ledgerId = `${id}-sale`;
    await db.vendor.create({ data: { id: vendorId, name: vendorId } });
    await db.vendorFinancialProfile.create({ data: {
      vendorId, settlementDelayDays: 0, settlementFrequencyType: 'WEEKLY',
      weeklySettlementDay: 'WEDNESDAY', autoSettlementDraftEnabled: true,
    } });
    await db.shopifyOrder.create({ data: {
      id: orderId, sourceShopifyOrderId: `gid://shopify/Order/${orderId}`,
      sourceShopifyOrderNumber: `#${orderId}`,
    } });
    await db.vendorAllocation.create({ data: {
      id: allocationId, sourceShopifyOrderId: orderId, sourceShopifyOrderNumber: `#${orderId}`,
      originalVendorId: vendorId, assignedVendorId: vendorId,
      outboundMethodSnapshot: 'KARGONOMI', fulfillmentStatus: 'Fulfilled', shippingStatus: 'Delivered',
    } });
    await db.shipmentExecution.create({ data: {
      id: executionId, allocationId, vendorId, provider: 'KARGONOMI',
      providerShipmentId: shipmentReference, shipmentStatus: 'DELIVERED', requestSnapshot: {},
    } });
    const observation = await recordDelivery({
      allocationId,
      source: { method: 'KARGONOMI', shipmentExecutionId: executionId, sourceReference: shipmentReference },
    }, db as never);
    expect(observation).toMatchObject({
      vendorAllocationId: allocationId, outboundMethod: 'KARGONOMI',
      shipmentExecutionId: executionId, sourceReference: shipmentReference,
    });
    await db.fulfillment.create({ data: {
      id: `${id}-fulfillment`, vendorAllocationId: allocationId,
      fulfillmentStatus: 'Delivered', shipmentUpdatedAt: new Date(),
    } });
    await db.financeLedgerEntry.create({ data: {
      id: ledgerId, vendorAllocationId: allocationId, vendorId, entryType: 'sale', amount: '200.00',
      payoutStatus: 'PENDING', settlementStatus: 'PENDING',
      commissionPercentSnapshot: '10.00', commissionVatPercentSnapshot: '20.00',
      settlementDelayDaysSnapshot: 0,
    } });

    const observedAt = observation.firstObservedDeliveredAt;
    const runDate = new Date(Date.UTC(observedAt.getUTCFullYear(), observedAt.getUTCMonth(), observedAt.getUTCDate()));
    runDate.setUTCDate(runDate.getUTCDate() + ((3 - runDate.getUTCDay() + 7) % 7 || 7) + (sequence - 1) * 7);
    // JobRun.runDate is globally unique; keep reruns against this disposable DB independent.
    while (await db.settlementScheduleJobRun.findUnique({ where: { runDate } })) {
      runDate.setUTCDate(runDate.getUTCDate() + 7);
    }
    const runDateKey = runDate.toISOString().slice(0, 10);
    const periodEnd = new Date(runDate.getTime() + dayMs - 1);
    const cycleKey = `scheduled-settlement:${vendorId}:${runDateKey}`;
    expect(observedAt.getTime()).toBeLessThanOrEqual(periodEnd.getTime());
    // Another fixture may be created while this suite models a later run date.
    // The authoritative delivery observation, not that simulated clock, anchors eligibility.
    expect(runDate.getTime()).toBeGreaterThan(observedAt.getTime());
    return { vendorId, allocationId, ledgerId, observedAt, runDate, runDateKey, periodEnd, cycleKey };
  }

  function afterRunDate(runDate: Date) {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(runDate.getTime() + dayMs + 1_000));
  }

  async function holdVendorLock(vendorId: string) {
    let signalAcquired!: () => void;
    let release!: () => void;
    const acquired = new Promise<void>((resolve) => { signalAcquired = resolve; });
    const released = new Promise<void>((resolve) => { release = resolve; });
    const blocker = db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Vendor" WHERE "id" = ${vendorId} FOR UPDATE`;
      signalAcquired();
      await released;
    }, { timeout: 10_000 });
    await acquired;
    return { release: async () => { release(); await blocker; } };
  }

  async function waitForCancellationLockWaits(count: number) {
    let observed = 0;
    const deadline = performance.now() + 3_000;
    while (performance.now() < deadline) {
      const [activity] = await db.$queryRaw<Array<{ blocked: bigint }>>`
        SELECT count(*)::bigint AS "blocked" FROM pg_stat_activity
        WHERE datname = current_database() AND pid <> pg_backend_pid()
          AND wait_event_type = 'Lock' AND query LIKE '%"Vendor"%FOR UPDATE%'
      `;
      observed = Number(activity.blocked);
      if (observed >= count) break;
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
    expect(observed).toBeGreaterThanOrEqual(count);
  }

  async function cancelledFixture() {
    const f = await fixture();
    afterRunDate(f.runDate);
    const created = await schedule.createSettlementScheduleDrafts({ runDate: f.runDateKey, vendorId: f.vendorId,
      confirmAutoSettlementDrafts: true });
    expect(created.summary.created).toBe(1);
    const originalId = created.createdDrafts[0].settlementApprovalId;
    await approval.cancelSettlementApproval(originalId, `${f.vendorId}-admin`);
    return { ...f, originalId };
  }

  async function ingestAcceptedTestRefund(f: Awaited<ReturnType<typeof cancelledFixture>>, suffix: string,
    amount: string, lineAmount = amount) {
    const order = await db.shopifyOrder.findUniqueOrThrow({ where: { id: f.allocationId.replace(/-allocation$/, '-order') } });
    const lineId = `${f.allocationId}-line`;
    await db.shopifyOrderLineItem.upsert({ where: { shopifyOrderId_sourceLineItemId: {
      shopifyOrderId: order.id, sourceLineItemId: lineId,
    } }, update: {}, create: { id: lineId, shopifyOrderId: order.id, sourceLineItemId: lineId,
      sku: `${f.allocationId}-sku`, quantity: 2, unitPrice: '100.00' } });
    await db.vendorAllocationLineItem.upsert({ where: { vendorAllocationId_shopifyLineItemId: {
      vendorAllocationId: f.allocationId, shopifyLineItemId: lineId,
    } }, update: {}, create: { vendorAllocationId: f.allocationId, shopifyLineItemId: lineId,
      quantity: 2, lineAmount: '200.00' } });
    const refundId = `gid://shopify/Refund/${f.allocationId}-${suffix}`;
    const refundLineId = `${f.allocationId}-${suffix}-refund-line`;
    const transactionGid = `gid://shopify/OrderTransaction/${f.allocationId}-${suffix}`;
    const result = await db.$transaction((tx) => ingestRefund({
      transactionClient: tx,
      payload: { id: refundId, order_id: order.sourceShopifyOrderId,
        refund_line_items: [{ id: refundLineId, line_item_id: lineId, quantity: 1, subtotal: lineAmount,
          line_item: { id: lineId, sku: `${f.allocationId}-sku`, title: 'Synthetic test line' } }] },
      monetaryEvidence: { sourceShopifyRefundId: refundId, classification: 'MONETARY_REFUND',
        monetaryRefundAmount: amount, currency: 'TRY', reasonCode: 'monetary_refund_verified', sanitizedWarnings: [],
        selectedTransactions: [{ transactionGid, kind: 'REFUND', status: 'SUCCESS', amount, currency: 'TRY' }] },
      canonicalEvidence: { evidenceSource: 'mock', sourceShopifyRefundId: refundId,
        sourceShopifyOrderId: order.sourceShopifyOrderId, monetaryClassification: 'MONETARY_REFUND',
        refundTotalAmount: amount, refundCurrency: 'TRY',
        selectedTransactions: [{ transactionGid, kind: 'REFUND', status: 'SUCCESS', amount, currency: 'TRY' }],
        lines: [{ sourceRefundLineItemId: refundLineId, sourceLineItemId: lineId,
          sku: `${f.allocationId}-sku`, quantity: 1, quantityProvenance: 'OBSERVED_VALID',
          subtotalAmount: lineAmount, subtotalAmountProvenance: 'OBSERVED', subtotalCurrency: 'TRY' }] },
      canonicalFinancialStatus: 'PARTIALLY_REFUNDED', targetVendorAllocationId: f.allocationId,
    }));
    expect(result).toMatchObject({ ok: true, processingStatus: 'processed', refundAllocationCount: 1 });
    const evidence = await db.refundEvidenceSnapshot.findUniqueOrThrow({ where: {
      sourceShopifyRefundId_vendorAllocationId: { sourceShopifyRefundId: refundId, vendorAllocationId: f.allocationId },
    } });
    expect(evidence).toMatchObject({ historicalEconomicVendorId: f.vendorId,
      historicalSaleFinanceLedgerEntryId: f.ledgerId, evidenceSource: 'mock' });
    // PostgreSQL's default now() is not controlled by Vitest's simulated post-cutoff
    // application clock. Align this synthetic ledger creation time with the event
    // time persisted by the real ingestion service; do not edit accepted evidence.
    await db.financeLedgerEntry.update({ where: { id: evidence.refundFinanceLedgerEntryId },
      data: { createdAt: evidence.capturedAt } });
    expect(await db.financeLedgerEntry.findUniqueOrThrow({ where: { id: evidence.refundFinanceLedgerEntryId } }))
      .toMatchObject({ vendorId: f.vendorId, vendorAllocationId: f.allocationId,
        entryType: 'refund', createdAt: evidence.capturedAt });
    return evidence;
  }

  async function applyCorrectionFromAcceptedEvidence(f: Awaited<ReturnType<typeof cancelledFixture>>,
    evidence: Awaited<ReturnType<typeof ingestAcceptedTestRefund>>, acceptedAmount: string,
    incomingLineAmount: string, direction: 'credit' | 'deduction', suffix: string) {
    const id = `${f.vendorId}-${direction}-correction`;
    const actorUserId = `${id}-admin`;
    await db.user.create({ data: { id: actorUserId, email: `${id}@example.test`, name: 'Synthetic finance admin',
      role: 'ADMIN', passwordHash: 'test-only' } });
    const incoming = normalizeRefundEvidence({
      sourceShopifyRefundId: evidence.sourceShopifyRefundId,
      sourceShopifyOrderId: evidence.sourceShopifyOrderId,
      vendorAllocationId: f.allocationId, monetaryClassification: 'MONETARY_REFUND',
      refundTotalAmount: acceptedAmount, currency: 'TRY',
      transactions: [{ transactionGid: `gid://shopify/OrderTransaction/${f.allocationId}-${suffix}`,
        kind: 'REFUND', status: 'SUCCESS', amount: acceptedAmount, currency: 'TRY' }],
      refundLines: [{ sourceLineItemId: `${f.allocationId}-line`, quantity: 1,
        subtotalAmount: incomingLineAmount, currency: 'TRY' }],
      historicalEconomicVendorId: f.vendorId, historicalSaleFinanceLedgerEntryId: f.ledgerId,
      supersededSaleLedgerIds: [],
    });
    await db.refundTerminalEvidenceReview.create({ data: {
      id, sourceShopifyRefundId: evidence.sourceShopifyRefundId,
      sourceShopifyOrderId: evidence.sourceShopifyOrderId,
      vendorAllocationId: f.allocationId, terminalRefundFinanceLedgerEntryId: evidence.refundFinanceLedgerEntryId,
      refundRecordId: evidence.refundRecordId, economicVendorId: f.vendorId, storedEvidenceSnapshotId: evidence.id,
      dedupeKey: `${id}-dedupe`, conflictCategory: 'financial_evidence_conflict',
      storedEvidenceHash: evidence.evidenceHash, incomingEvidenceHash: incoming.evidenceHash,
      conflictSummaryJson: {}, status: 'RESOLVED', resolutionOutcome: 'CORRECTION_REQUIRED',
    } });
    await db.refundTerminalConflictEvidence.create({ data: {
      id: `${id}-incoming`, reviewId: id, sourceShopifyRefundId: evidence.sourceShopifyRefundId,
      sourceShopifyOrderId: evidence.sourceShopifyOrderId, vendorAllocationId: f.allocationId,
      economicVendorId: f.vendorId, historicalSaleFinanceLedgerEntryId: f.ledgerId,
      supersededSaleLedgerIdsJson: [], refundTotalAmount: acceptedAmount, currency: 'TRY',
      normalizedEvidenceJson: incoming.normalizedEvidenceJson, evidenceHash: incoming.evidenceHash,
      hashAlgorithm: incoming.hashAlgorithm, evidenceVersion: incoming.evidenceVersion,
      normalizationVersion: incoming.normalizationVersion,
    } });
    await db.refundTerminalEvidenceReviewEvent.create({ data: { id: `${id}-resolved`, reviewId: id,
      eventType: 'RESOLVED', resolutionOutcome: 'CORRECTION_REQUIRED', actorUserId } });
    const preview = await previewCorrection(id, db as never);
    const applied = direction === 'credit'
      ? await applyCredit({ reviewId: id, previewFingerprint: preview.previewFingerprint, actorUserId,
        reason: 'Synthetic corrected refund evidence' }, db as never)
      : await applyDeduction({ reviewId: id, previewFingerprint: preview.previewFingerprint, actorUserId,
        reason: 'Synthetic corrected refund evidence' }, db as never);
    return applied;
  }

  async function addEligiblePostCutoffSale(f: Awaited<ReturnType<typeof cancelledFixture>>, amount: string) {
    const id = `${f.vendorId}-later-sale`;
    const orderId = `${id}-order`;
    const allocationId = `${id}-allocation`;
    const executionId = `${id}-execution`;
    const sourceReference = `${id}-shipment`;
    await db.shopifyOrder.create({ data: { id: orderId,
      sourceShopifyOrderId: `gid://shopify/Order/${orderId}`, sourceShopifyOrderNumber: `#${orderId}` } });
    await db.vendorAllocation.create({ data: { id: allocationId, sourceShopifyOrderId: orderId,
      sourceShopifyOrderNumber: `#${orderId}`, originalVendorId: f.vendorId, assignedVendorId: f.vendorId,
      outboundMethodSnapshot: 'KARGONOMI', fulfillmentStatus: 'Fulfilled', shippingStatus: 'Delivered' } });
    await db.shipmentExecution.create({ data: { id: executionId, allocationId, vendorId: f.vendorId,
      provider: 'KARGONOMI', providerShipmentId: sourceReference, shipmentStatus: 'DELIVERED', requestSnapshot: {} } });
    const observation = await recordDelivery({ allocationId,
      source: { method: 'KARGONOMI', shipmentExecutionId: executionId, sourceReference } }, db as never);
    expect(observation).toMatchObject({ vendorAllocationId: allocationId, shipmentExecutionId: executionId,
      sourceReference });
    await db.fulfillment.create({ data: { id: `${id}-fulfillment`, vendorAllocationId: allocationId,
      fulfillmentStatus: 'Delivered', shipmentUpdatedAt: new Date() } });
    await db.financeLedgerEntry.create({ data: { id, vendorAllocationId: allocationId, vendorId: f.vendorId,
      entryType: 'sale', amount, payoutStatus: 'PENDING', settlementStatus: 'PENDING',
      commissionPercentSnapshot: '10.00', commissionVatPercentSnapshot: '20.00',
      settlementDelayDaysSnapshot: 0, createdAt: new Date() } });
    return id;
  }

  async function financeWriteFootprint(vendorId: string) {
    const [approvals, lines, ledgers, adjustments, applications, corrections, balanceEvents, payouts] = await Promise.all([
      db.settlementApproval.count({ where: { vendorId } }),
      db.settlementApprovalLine.count({ where: { settlementApproval: { vendorId } } }),
      db.financeLedgerEntry.count({ where: { vendorId } }),
      db.settlementRefundAdjustment.count({ where: { vendorId } }),
      db.settlementRefundAdjustmentApplication.count({ where: { settlementApproval: { vendorId } } }),
      db.financialCorrectionAuthority.count({ where: { vendorId } }),
      db.vendorBalanceEvent.count({ where: { vendorId } }),
      db.payoutBatch.count({ where: { vendorId } }),
    ]);
    return { approvals, lines, ledgers, adjustments, applications, corrections, balanceEvents, payouts };
  }

  async function replacementRequest(f: Awaited<ReturnType<typeof cancelledFixture>>, suffix: string) {
    const adminUserId = `${f.vendorId}-replacement-admin`;
    await db.user.upsert({ where: { id: adminUserId }, update: {}, create: {
      id: adminUserId, email: `${adminUserId}@example.test`, name: 'Replacement test Admin',
      role: 'ADMIN', passwordHash: 'test-only',
    } });
    return { originalSettlementApprovalId: f.originalId, vendorId: f.vendorId,
      requestId: `${f.vendorId}-${suffix}`, adminUserId, reason: 'Rebuild cancelled draft with verified sources' };
  }

  it('2A: assesses a cancelled originally-DRAFT cycle at its frozen cutoff without writes', async () => {
    const f = await cancelledFixture();
    const before = await db.settlementApproval.findUniqueOrThrow({ where: { id: f.originalId }, include: { lines: true } });
    const footprintBefore = await financeWriteFootprint(f.vendorId);
    const result = await replacement.assessCancelledScheduledSettlementReplacement({
      originalSettlementApprovalId: f.originalId, vendorId: f.vendorId,
    });
    expect(result).toMatchObject({ outcome: 'ELIGIBLE', writesPerformed: false, safeForAdminConsideration: true,
      originalCutoff: f.periodEnd.toISOString(), cancellationProvenance: 'VERIFIED_DRAFT', replacementLineage: 'CLEAR',
      blockers: [], unknowns: [] });
    expect(result.sourceComparison).toMatchObject({ sharedIds: [f.ledgerId], originalOnlyIds: [], currentOnlyIds: [] });
    expect(await db.settlementApproval.findUniqueOrThrow({ where: { id: f.originalId }, include: { lines: true } })).toEqual(before);
    expect(await financeWriteFootprint(f.vendorId)).toEqual(footprintBefore);
    expect(await db.settlementApproval.count({ where: { vendorId: f.vendorId } })).toBe(1);
    expect(await db.payoutBatch.count({ where: { vendorId: f.vendorId } })).toBe(0);
  });

  it('2A: rejects non-cancelled, approved-cancelled, legacy and wrong-vendor provenance', async () => {
    const f = await fixture();
    afterRunDate(f.runDate);
    const created = await schedule.createSettlementScheduleDrafts({ runDate: f.runDateKey, vendorId: f.vendorId,
      confirmAutoSettlementDrafts: true });
    const id = created.createdDrafts[0].settlementApprovalId;
    const assess = (vendorId = f.vendorId) => replacement.assessCancelledScheduledSettlementReplacement({
      originalSettlementApprovalId: id, vendorId,
    });
    expect((await assess()).blockers.map((item) => item.code)).toContain('NOT_CANCELLED');
    expect((await assess(`${f.vendorId}-other`)).blockers.map((item) => item.code)).toContain('VENDOR_MISMATCH');
    await approval.cancelSettlementApproval(id, `${f.vendorId}-admin`);
    await db.settlementApproval.update({ where: { id }, data: { cancelledFromStatus: null } });
    expect((await assess()).unknowns.map((item) => item.code)).toContain('CANCELLATION_PROVENANCE_MISSING');
    await db.settlementApproval.update({ where: { id }, data: { cancelledFromStatus: 'APPROVED' } });
    expect((await assess()).blockers.map((item) => item.code)).toContain('NOT_ORIGINALLY_DRAFT');
  });

  it('2A: fails closed on missing scheduled evidence and conflicting active source ownership', async () => {
    const f = await cancelledFixture();
    await db.settlementApproval.update({ where: { id: f.originalId }, data: { scheduledPeriodEnd: null } });
    const missing = await replacement.assessCancelledScheduledSettlementReplacement({
      originalSettlementApprovalId: f.originalId, vendorId: f.vendorId,
    });
    expect(missing.outcome).toBe('UNKNOWN');
    expect(missing.unknowns.map((item) => item.code)).toContain('SCHEDULED_PROVENANCE_MISSING');
    await db.settlementApproval.update({ where: { id: f.originalId }, data: { scheduledPeriodEnd: f.periodEnd } });
    const manual = await approval.createDraftApproval({ vendorId: f.vendorId });
    expect(manual.lines.map((line) => line.financeLedgerEntryId)).toEqual([f.ledgerId]);
    const conflict = await replacement.assessCancelledScheduledSettlementReplacement({
      originalSettlementApprovalId: f.originalId, vendorId: f.vendorId,
    });
    expect(conflict.outcome).toBe('BLOCKED');
    expect(conflict.blockers).toContainEqual(expect.objectContaining({ code: 'ACTIVE_SOURCE_CLAIM', sourceId: f.ledgerId }));
  });

  it('2A: an existing replacement claim prevents another assessment from being eligible', async () => {
    const f = await cancelledFixture();
    const replacementRow = await db.settlementApproval.create({ data: {
      vendorId: f.vendorId, grossSalesMinor: 0, refundTotalMinor: 0, commissionMinor: 0,
      commissionVatMinor: 0, netPayableMinor: 0, sourceSnapshotJson: { testOnlyReplacementAudit: true },
      replacesSettlementApprovalId: f.originalId, replacementRequestId: `${f.vendorId}-request`,
      replacementRequestedBy: `${f.vendorId}-admin`, replacementReason: 'Test-only lineage', replacementRequestedAt: new Date(),
    } });
    const result = await replacement.assessCancelledScheduledSettlementReplacement({
      originalSettlementApprovalId: f.originalId, vendorId: f.vendorId,
    });
    expect(result.outcome).toBe('BLOCKED');
    expect(result.replacementLineage).toBe('CLAIMED');
    expect(result.blockers).toContainEqual(expect.objectContaining({ code: 'REPLACEMENT_EXISTS', sourceId: replacementRow.id }));
  });

  it('2A: post-cutoff refund never joins the original period and incomplete later authority fails closed', async () => {
    const f = await cancelledFixture();
    const refundId = `${f.vendorId}-late-refund`;
    await db.financeLedgerEntry.create({ data: {
      id: refundId, vendorAllocationId: f.allocationId, vendorId: f.vendorId,
      entryType: 'refund', amount: '20.00', payoutStatus: 'PENDING', settlementStatus: 'PENDING',
      commissionPercentSnapshot: '10.00', commissionVatPercentSnapshot: '20.00',
      createdAt: new Date(f.periodEnd.getTime() + 1_000),
    } });
    const siblingRefundId = `${f.vendorId}-second-late-refund`;
    await db.financeLedgerEntry.create({ data: {
      id: siblingRefundId, vendorAllocationId: f.allocationId, vendorId: f.vendorId,
      entryType: 'refund', amount: '5.00', payoutStatus: 'PENDING', settlementStatus: 'PENDING',
      commissionPercentSnapshot: '10.00', commissionVatPercentSnapshot: '20.00',
      createdAt: new Date(f.periodEnd.getTime() + 2_000),
    } });
    const result = await replacement.assessCancelledScheduledSettlementReplacement({
      originalSettlementApprovalId: f.originalId, vendorId: f.vendorId,
    });
    expect(result.outcome).toBe('UNKNOWN');
    expect(result.sourceComparison.current.map((item) => item.financeLedgerEntryId)).toEqual([f.ledgerId]);
    expect(result.sourceComparison.current.map((item) => item.financeLedgerEntryId)).not.toContain(refundId);
    expect(result.unknowns).toContainEqual(expect.objectContaining({ code: 'LATE_REFUND_EVIDENCE_MISSING', sourceId: refundId }));
    expect(result.unknowns).toContainEqual(expect.objectContaining({ code: 'LATE_REFUND_EVIDENCE_MISSING', sourceId: siblingRefundId }));
    expect(await db.settlementApproval.count({ where: { vendorId: f.vendorId } })).toBe(1);
  });

  it('2A: two accepted refund ingestions retain exact independent late evidence without entering T', async () => {
    const f = await cancelledFixture();
    // The scheduled test cutoff is synthetic and in the future relative to PostgreSQL wall time.
    // The application clock models the later accepted-refund event; ingestion itself persists the evidence.
    vi.setSystemTime(new Date(f.periodEnd.getTime() + dayMs));
    const first = await ingestAcceptedTestRefund(f, 'one', '10.00');
    const second = await ingestAcceptedTestRefund(f, 'two', '15.00');
    expect(first.refundFinanceLedgerEntryId).not.toBe(second.refundFinanceLedgerEntryId);
    expect(first.capturedAt.getTime()).toBeGreaterThan(f.periodEnd.getTime());
    expect(second.capturedAt.getTime()).toBeGreaterThan(f.periodEnd.getTime());
    const before = await db.settlementApproval.findUniqueOrThrow({ where: { id: f.originalId }, include: { lines: true } });
    const evidenceBefore = await db.refundEvidenceSnapshot.findMany({ where: {
      refundFinanceLedgerEntryId: { in: [first.refundFinanceLedgerEntryId, second.refundFinanceLedgerEntryId] },
    }, orderBy: { refundFinanceLedgerEntryId: 'asc' } });
    const result = await replacement.assessCancelledScheduledSettlementReplacement({
      originalSettlementApprovalId: f.originalId, vendorId: f.vendorId,
    });
    expect(result.outcome).not.toBe('ELIGIBLE');
    expect(result.safeForAdminConsideration).toBe(false);
    expect(result.sourceComparison.current.map((item) => item.financeLedgerEntryId)).toEqual([f.ledgerId]);
    expect(result.refundEvidence.map((item) => item.refundFinanceLedgerEntryId).sort()).toEqual([
      first.refundFinanceLedgerEntryId, second.refundFinanceLedgerEntryId,
    ].sort());
    for (const id of [first.refundFinanceLedgerEntryId, second.refundFinanceLedgerEntryId]) {
      expect(result.unknowns).toContainEqual(expect.objectContaining({ code: 'LATE_REFUND_ROUTE_UNVERIFIED', sourceId: id }));
    }
    expect(await db.settlementApproval.findUniqueOrThrow({ where: { id: f.originalId }, include: { lines: true } })).toEqual(before);
    expect(await db.refundEvidenceSnapshot.findMany({ where: {
      refundFinanceLedgerEntryId: { in: [first.refundFinanceLedgerEntryId, second.refundFinanceLedgerEntryId] },
    }, orderBy: { refundFinanceLedgerEntryId: 'asc' } })).toEqual(evidenceBefore);
    expect(await db.settlementApproval.count({ where: { vendorId: f.vendorId } })).toBe(1);
  });

  it.each([
    { direction: 'credit' as const, acceptedLine: '15.00', incomingLine: '10.00', expectedCode: 'VENDOR_WIDE_CREDIT_SCOPE' },
    { direction: 'deduction' as const, acceptedLine: '10.00', incomingLine: '15.00', expectedCode: 'VENDOR_WIDE_DEDUCTION_SCOPE' },
  ])('2A: applied $direction remains a separate vendor-wide correction scope blocker', async ({ direction, acceptedLine, incomingLine, expectedCode }) => {
    const f = await cancelledFixture();
    vi.setSystemTime(new Date(f.periodEnd.getTime() + dayMs));
    const evidence = await ingestAcceptedTestRefund(f, direction, '15.00', acceptedLine);
    const applied = await applyCorrectionFromAcceptedEvidence(f, evidence, '15.00', incomingLine, direction, direction);
    expect(applied).toMatchObject({ route: direction === 'credit'
      ? 'BEFORE_SETTLEMENT_VENDOR_CREDIT' : 'BEFORE_SETTLEMENT_VENDOR_DEDUCTION' });
    const authorityBefore = await db.financialCorrectionAuthority.findFirstOrThrow({ where: {
      acceptedEvidenceSnapshotId: evidence.id,
    } });
    const result = await replacement.assessCancelledScheduledSettlementReplacement({
      originalSettlementApprovalId: f.originalId, vendorId: f.vendorId,
    });
    expect(result.outcome).toBe('BLOCKED');
    expect(result.blockers.map((item) => item.code)).toContain(expectedCode);
    expect(result.safeForAdminConsideration).toBe(false);
    expect(await db.financialCorrectionAuthority.findUniqueOrThrow({ where: { id: authorityBefore.id } }))
      .toEqual(authorityBefore);
    const request = await replacementRequest(f, `${direction}-blocked`);
    await expect(replacementWriter.createControlledSettlementReplacementDraft(request))
      .rejects.toMatchObject({ assessment: { outcome: 'BLOCKED', blockers: expect.arrayContaining([
        expect.objectContaining({ code: expectedCode }),
      ]) } });
    expect(await db.settlementApproval.count({ where: { vendorId: f.vendorId } })).toBe(1);
  });

  it('2A: a partially outstanding vendor-wide adjustment cannot silently enter the old cutoff', async () => {
    const f = await cancelledFixture();
    const manual = await approval.createDraftApproval({ vendorId: f.vendorId });
    await approval.approveSettlementApproval(manual.id, `${f.vendorId}-approver`);
    vi.setSystemTime(new Date(f.periodEnd.getTime() + dayMs));
    const evidence = await ingestAcceptedTestRefund(f, 'partial', '20.00');
    const laterSaleId = await addEligiblePostCutoffSale(f, '10.00');
    const laterDraft = await approval.createDraftApproval({ vendorId: f.vendorId });
    expect(laterDraft.lines.map((line) => line.financeLedgerEntryId)).toContain(laterSaleId);
    const adjustment = await db.settlementRefundAdjustment.findUniqueOrThrow({ where: {
      refundFinanceLedgerEntryId: evidence.refundFinanceLedgerEntryId,
    } });
    expect(adjustment).toMatchObject({ status: 'PARTIALLY_APPLIED', originalAmountMinor: 1760,
      appliedAmountMinor: 880, remainingAmountMinor: 880 });
    expect(await db.settlementRefundAdjustmentApplication.count({ where: { settlementRefundAdjustmentId: adjustment.id } })).toBe(1);
    const before = await db.settlementRefundAdjustment.findUniqueOrThrow({ where: { id: adjustment.id } });
    const result = await replacement.assessCancelledScheduledSettlementReplacement({
      originalSettlementApprovalId: f.originalId, vendorId: f.vendorId,
    });
    expect(result.outcome).toBe('BLOCKED');
    expect(result.pendingAdjustments).toContainEqual(expect.objectContaining({ id: adjustment.id,
      refundFinanceLedgerEntryId: evidence.refundFinanceLedgerEntryId, remainingAmountMinor: 880,
      status: 'PARTIALLY_APPLIED' }));
    expect(result.blockers).toContainEqual(expect.objectContaining({ code: 'PENDING_REFUND_ADJUSTMENT', sourceId: adjustment.id }));
    expect(result.sourceComparison.current.map((item) => item.financeLedgerEntryId)).not.toContain(evidence.refundFinanceLedgerEntryId);
    expect(await db.settlementRefundAdjustment.findUniqueOrThrow({ where: { id: adjustment.id } })).toEqual(before);
    const request = await replacementRequest(f, 'partial-adjustment-blocked');
    await expect(replacementWriter.createControlledSettlementReplacementDraft(request))
      .rejects.toMatchObject({ assessment: { outcome: 'BLOCKED', blockers: expect.arrayContaining([
        expect.objectContaining({ code: 'PENDING_REFUND_ADJUSTMENT', sourceId: adjustment.id }),
      ]) } });
    expect(await db.settlementRefundAdjustment.findUniqueOrThrow({ where: { id: adjustment.id } })).toEqual(before);
  });

  it('2A: a real post-approval refund creates a PENDING obligation that the old T cannot absorb', async () => {
    const f = await cancelledFixture();
    const manual = await approval.createDraftApproval({ vendorId: f.vendorId });
    expect(manual.lines.map((line) => line.financeLedgerEntryId)).toEqual([f.ledgerId]);
    await approval.approveSettlementApproval(manual.id, `${f.vendorId}-approver`);
    vi.setSystemTime(new Date(f.periodEnd.getTime() + dayMs));
    const evidence = await ingestAcceptedTestRefund(f, 'pending', '20.00');
    const pending = await db.settlementRefundAdjustment.findUniqueOrThrow({ where: {
      refundFinanceLedgerEntryId: evidence.refundFinanceLedgerEntryId,
    } });
    expect(pending).toMatchObject({ vendorId: f.vendorId, status: 'PENDING', remainingAmountMinor: 1760 });
    const before = await db.settlementRefundAdjustment.findUniqueOrThrow({ where: { id: pending.id } });
    const result = await replacement.assessCancelledScheduledSettlementReplacement({
      originalSettlementApprovalId: f.originalId, vendorId: f.vendorId,
    });
    expect(result.outcome).toBe('BLOCKED');
    expect(result.sourceComparison.current.map((item) => item.financeLedgerEntryId)).not.toContain(evidence.refundFinanceLedgerEntryId);
    expect(result.blockers).toContainEqual(expect.objectContaining({ code: 'PENDING_REFUND_ADJUSTMENT', sourceId: pending.id }));
    expect(result.pendingAdjustments).toContainEqual(expect.objectContaining({ id: pending.id,
      refundFinanceLedgerEntryId: evidence.refundFinanceLedgerEntryId, status: 'PENDING', remainingAmountMinor: 1760 }));
    expect(await db.settlementRefundAdjustment.findUniqueOrThrow({ where: { id: pending.id } })).toEqual(before);
    const request = await replacementRequest(f, 'pending-adjustment-blocked');
    await expect(replacementWriter.createControlledSettlementReplacementDraft(request))
      .rejects.toMatchObject({ assessment: { outcome: 'BLOCKED', blockers: expect.arrayContaining([
        expect.objectContaining({ code: 'PENDING_REFUND_ADJUSTMENT', sourceId: pending.id }),
      ]) } });
    expect(await db.settlementRefundAdjustment.findUniqueOrThrow({ where: { id: pending.id } })).toEqual(before);
  });

  it('2A: unresolved terminal refund evidence on an original allocation blocks consideration', async () => {
    const f = await cancelledFixture();
    vi.setSystemTime(new Date(f.periodEnd.getTime() + dayMs));
    const evidence = await ingestAcceptedTestRefund(f, 'conflict', '10.00');
    const order = await db.shopifyOrder.findUniqueOrThrow({ where: {
      id: f.allocationId.replace(/-allocation$/, '-order'),
    } });
    const refundId = evidence.sourceShopifyRefundId;
    const lineId = `${f.allocationId}-line`;
    const refundLineId = `${f.allocationId}-conflict-refund-line`;
    const transactionGid = `gid://shopify/OrderTransaction/${f.allocationId}-conflict`;
    const replay = await db.$transaction((tx) => ingestRefund({
      transactionClient: tx,
      payload: { id: refundId, order_id: order.sourceShopifyOrderId,
        refund_line_items: [{ id: refundLineId, line_item_id: lineId, quantity: 1, subtotal: '9.00',
          line_item: { id: lineId, sku: `${f.allocationId}-sku`, title: 'Synthetic test line' } }] },
      monetaryEvidence: { sourceShopifyRefundId: refundId, classification: 'MONETARY_REFUND',
        monetaryRefundAmount: '10.00', currency: 'TRY', reasonCode: 'monetary_refund_verified',
        sanitizedWarnings: [], selectedTransactions: [{ transactionGid, kind: 'REFUND', status: 'SUCCESS',
          amount: '10.00', currency: 'TRY' }] },
      canonicalEvidence: { evidenceSource: 'mock', sourceShopifyRefundId: refundId,
        sourceShopifyOrderId: order.sourceShopifyOrderId, monetaryClassification: 'MONETARY_REFUND',
        refundTotalAmount: '10.00', refundCurrency: 'TRY',
        selectedTransactions: [{ transactionGid, kind: 'REFUND', status: 'SUCCESS', amount: '10.00', currency: 'TRY' }],
        lines: [{ sourceRefundLineItemId: refundLineId, sourceLineItemId: lineId,
          sku: `${f.allocationId}-sku`, quantity: 1, quantityProvenance: 'OBSERVED_VALID',
          subtotalAmount: '9.00', subtotalAmountProvenance: 'OBSERVED', subtotalCurrency: 'TRY' }] },
      canonicalFinancialStatus: 'PARTIALLY_REFUNDED', targetVendorAllocationId: f.allocationId,
    }));
    expect(replay).toMatchObject({ ok: false, reasonCode: 'refund_terminal_evidence_conflict' });
    const review = await db.refundTerminalEvidenceReview.findFirstOrThrow({ where: {
      terminalRefundFinanceLedgerEntryId: evidence.refundFinanceLedgerEntryId,
    } });
    expect(review).toMatchObject({ status: 'ACTIVE', storedEvidenceSnapshotId: evidence.id,
      economicVendorId: f.vendorId });
    const result = await replacement.assessCancelledScheduledSettlementReplacement({
      originalSettlementApprovalId: f.originalId, vendorId: f.vendorId,
    });
    expect(result.outcome).toBe('BLOCKED');
    expect(result.blockers).toContainEqual(expect.objectContaining({ code: 'UNRESOLVED_REFUND_EVIDENCE',
      sourceId: evidence.refundFinanceLedgerEntryId }));
    expect(await db.refundEvidenceSnapshot.findUniqueOrThrow({ where: { id: evidence.id } })).toEqual(evidence);
  });

  it('2A: missing original frozen source evidence is UNKNOWN, not a matching-total approval', async () => {
    const f = await cancelledFixture();
    await db.settlementApprovalLine.updateMany({ where: { settlementApprovalId: f.originalId },
      data: { sourceSnapshotJson: {} } });
    const result = await replacement.assessCancelledScheduledSettlementReplacement({
      originalSettlementApprovalId: f.originalId, vendorId: f.vendorId,
    });
    expect(result.outcome).toBe('UNKNOWN');
    expect(result.unknowns.map((item) => item.code)).toContain('ORIGINAL_SOURCE_EVIDENCE_MISSING');
  });

  it('2B: creates one internally guarded DRAFT with B1 lineage and preserves the original history', async () => {
    const f = await cancelledFixture();
    const request = await replacementRequest(f, 'create');
    const originalBefore = await db.settlementApproval.findUniqueOrThrow({ where: { id: f.originalId },
      include: { lines: true } });
    const jobBefore = await db.settlementScheduleJobRun.create({ data: { runDate: f.runDate,
      status: 'COMPLETED', writesPerformed: true, createdDraftCount: 1,
      metadataJson: { syntheticOriginalCycle: f.cycleKey },
    } });
    const assessed = await replacement.assessCancelledScheduledSettlementReplacement({
      originalSettlementApprovalId: f.originalId, vendorId: f.vendorId,
    });
    expect(assessed.outcome).toBe('ELIGIBLE');
    const result = await replacementWriter.createControlledSettlementReplacementDraft(request);
    expect(result).toMatchObject({ outcome: 'CREATED', writesPerformed: true, status: 'DRAFT',
      originalSettlementApprovalId: f.originalId, vendorId: f.vendorId, requestId: request.requestId });
    const persisted = await db.settlementApproval.findUniqueOrThrow({
      where: { id: result.replacementSettlementApprovalId }, include: { lines: true },
    });
    expect(persisted).toMatchObject({ status: 'DRAFT', vendorId: f.vendorId,
      replacesSettlementApprovalId: f.originalId, replacementRequestId: request.requestId,
      replacementRequestedBy: request.adminUserId, replacementReason: request.reason,
      scheduledCycleKey: null, scheduledRunDate: null, scheduledPeriodEnd: null,
      periodEnd: f.periodEnd, grossSalesMinor: originalBefore.grossSalesMinor,
      netPayableMinor: originalBefore.netPayableMinor });
    expect(persisted.replacementRequestedAt).toBeInstanceOf(Date);
    expect(persisted.id).not.toBe(f.originalId);
    expect(persisted.lines.map((line) => line.financeLedgerEntryId)).toEqual([f.ledgerId]);
    expect(persisted.lines.map((line) => line.payableImpactMinor))
      .toEqual(originalBefore.lines.map((line) => line.payableImpactMinor));
    expect((persisted.sourceSnapshotJson as Record<string, unknown>).asOfDate).toBe(f.periodEnd.toISOString());
    expect(await db.settlementApproval.findUniqueOrThrow({ where: { id: f.originalId },
      include: { lines: true } })).toEqual(originalBefore);
    expect(await db.settlementScheduleJobRun.findUniqueOrThrow({ where: { id: jobBefore.id } })).toEqual(jobBefore);
    expect(await db.settlementApproval.count({ where: { replacesSettlementApprovalId: f.originalId } })).toBe(1);
  });

  it('2B: exact request replay is idempotent, while changed identity or audit evidence is rejected', async () => {
    const f = await cancelledFixture();
    const request = await replacementRequest(f, 'replay');
    const created = await replacementWriter.createControlledSettlementReplacementDraft(request);
    const replayed = await replacementWriter.createControlledSettlementReplacementDraft(request);
    expect(replayed).toMatchObject({ outcome: 'REPLAYED', writesPerformed: false,
      replacementSettlementApprovalId: created.replacementSettlementApprovalId, status: 'DRAFT' });
    await expect(replacementWriter.createControlledSettlementReplacementDraft({ ...request,
      requestId: `${request.requestId}-other` })).rejects.toThrow('already has a replacement claim');
    await expect(replacementWriter.createControlledSettlementReplacementDraft({ ...request,
      adminUserId: `${request.adminUserId}-other` })).rejects.toThrow('active Admin actor');
    const otherAdminId = `${request.adminUserId}-other`;
    await db.user.create({ data: { id: otherAdminId, email: `${otherAdminId}@example.test`,
      name: 'Other Admin', role: 'ADMIN', passwordHash: 'test-only' } });
    const vendorActorId = `${request.adminUserId}-vendor`;
    await db.user.create({ data: { id: vendorActorId, email: `${vendorActorId}@example.test`,
      name: 'Vendor actor', role: 'VENDOR', passwordHash: 'test-only' } });
    await expect(replacementWriter.createControlledSettlementReplacementDraft({ ...request,
      requestId: `${request.requestId}-vendor`, adminUserId: vendorActorId }))
      .rejects.toThrow('active Admin actor');
    await expect(replacementWriter.createControlledSettlementReplacementDraft({ ...request,
      adminUserId: otherAdminId })).rejects.toThrow('already bound to different authority');
    await expect(replacementWriter.createControlledSettlementReplacementDraft({ ...request,
      reason: 'Different reason' })).rejects.toThrow('already bound to different authority');
    const another = await cancelledFixture();
    await expect(replacementWriter.createControlledSettlementReplacementDraft({ ...request,
      originalSettlementApprovalId: another.originalId })).rejects.toThrow('already bound to different authority');
    await expect(replacementWriter.createControlledSettlementReplacementDraft({ ...request,
      vendorId: another.vendorId })).rejects.toThrow('already bound to different authority');
    expect(await db.settlementApproval.count({ where: { replacesSettlementApprovalId: f.originalId } })).toBe(1);
    expect(await db.settlementApproval.count({ where: { replacesSettlementApprovalId: another.originalId } })).toBe(0);
  });

  it('2B: concurrent different requests cannot create two replacements or double-claim a source', async () => {
    const f = await cancelledFixture();
    const first = await replacementRequest(f, 'race-one');
    const second = { ...first, requestId: `${f.vendorId}-race-two` };
    const outcomes = await Promise.allSettled([
      replacementWriter.createControlledSettlementReplacementDraft(first),
      replacementWriter.createControlledSettlementReplacementDraft(second),
    ]);
    expect(outcomes.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((item) => item.status === 'rejected')).toHaveLength(1);
    const replacements = await db.settlementApproval.findMany({ where: { replacesSettlementApprovalId: f.originalId },
      include: { lines: true } });
    expect(replacements).toHaveLength(1);
    expect(replacements[0].lines.map((line) => line.financeLedgerEntryId)).toEqual([f.ledgerId]);
    expect(await db.settlementApprovalLine.count({ where: { financeLedgerEntryId: f.ledgerId,
      settlementApproval: { status: 'DRAFT' } } })).toBe(1);
  });

  it('2B: rejects stale eligibility after another DRAFT claims the released source', async () => {
    const f = await cancelledFixture();
    const request = await replacementRequest(f, 'stale-source');
    const earlier = await replacement.assessCancelledScheduledSettlementReplacement({
      originalSettlementApprovalId: f.originalId, vendorId: f.vendorId,
    });
    expect(earlier.outcome).toBe('ELIGIBLE');
    const manual = await approval.createDraftApproval({ vendorId: f.vendorId });
    expect(manual.lines.map((line) => line.financeLedgerEntryId)).toEqual([f.ledgerId]);
    await expect(replacementWriter.createControlledSettlementReplacementDraft(request))
      .rejects.toMatchObject({ name: 'SettlementReplacementNotEligibleError',
        assessment: { outcome: 'BLOCKED', blockers: expect.arrayContaining([
          expect.objectContaining({ code: 'ACTIVE_SOURCE_CLAIM', sourceId: f.ledgerId }),
        ]) } });
    expect(await db.settlementApproval.count({ where: { replacesSettlementApprovalId: f.originalId } })).toBe(0);
    expect(await db.settlementApprovalLine.count({ where: { financeLedgerEntryId: f.ledgerId,
      settlementApproval: { status: 'DRAFT' } } })).toBe(1);
  });

  it('2B: invoice and payout-linked original history remains a hard blocker', async () => {
    const f = await cancelledFixture();
    const request = await replacementRequest(f, 'linked-history');
    const original = await db.settlementApproval.findUniqueOrThrow({ where: { id: f.originalId },
      include: { lines: true } });
    const invoice = await db.settlementCommissionInvoice.create({ data: {
      settlementApprovalId: f.originalId, vendorId: f.vendorId, provider: 'LOGO_ISBASI', status: 'PENDING',
    } });
    const payout = await db.payoutBatch.create({ data: { vendorId: f.vendorId } });
    const payoutLine = await db.payoutBatchLine.create({ data: {
      payoutBatchId: payout.id, financeLedgerEntryId: f.ledgerId,
      settlementApprovalLineId: original.lines[0].id, amountSnapshot: '176.00',
    } });
    await expect(replacementWriter.createControlledSettlementReplacementDraft(request))
      .rejects.toMatchObject({ assessment: { outcome: 'BLOCKED', blockers: expect.arrayContaining([
        expect.objectContaining({ code: 'ORIGINAL_FINANCIAL_LINKS' }),
        expect.objectContaining({ code: 'ORIGINAL_PAYOUT_LINK' }),
      ]) } });
    expect(await db.settlementCommissionInvoice.findUniqueOrThrow({ where: { id: invoice.id } })).toMatchObject({
      settlementApprovalId: f.originalId, status: 'PENDING',
    });
    expect(await db.payoutBatchLine.findUniqueOrThrow({ where: { id: payoutLine.id } })).toMatchObject({
      settlementApprovalLineId: original.lines[0].id,
    });
    expect(await db.settlementApproval.count({ where: { replacesSettlementApprovalId: f.originalId } })).toBe(0);
  });

  it('2B: rejects approved-origin and legacy unknown cancellation provenance', async () => {
    const approvedOrigin = await cancelledFixture();
    const approvedRequest = await replacementRequest(approvedOrigin, 'approved-origin');
    await db.settlementApproval.update({ where: { id: approvedOrigin.originalId },
      data: { cancelledFromStatus: 'APPROVED' } });
    await expect(replacementWriter.createControlledSettlementReplacementDraft(approvedRequest))
      .rejects.toMatchObject({ assessment: { outcome: 'BLOCKED', blockers: expect.arrayContaining([
        expect.objectContaining({ code: 'NOT_ORIGINALLY_DRAFT' }),
      ]) } });
    const legacy = await cancelledFixture();
    const legacyRequest = await replacementRequest(legacy, 'legacy-origin');
    await db.settlementApproval.update({ where: { id: legacy.originalId },
      data: { cancelledFromStatus: null } });
    await expect(replacementWriter.createControlledSettlementReplacementDraft(legacyRequest))
      .rejects.toMatchObject({ assessment: { outcome: 'UNKNOWN', unknowns: expect.arrayContaining([
        expect.objectContaining({ code: 'CANCELLATION_PROVENANCE_MISSING' }),
      ]) } });
    expect(await db.settlementApproval.count({ where: { replacesSettlementApprovalId: {
      in: [approvedOrigin.originalId, legacy.originalId],
    } } })).toBe(0);
  });

  it('2B: post-cutoff accepted refund with unknown later route cannot create a replacement', async () => {
    const f = await cancelledFixture();
    const request = await replacementRequest(f, 'late-refund');
    vi.setSystemTime(new Date(f.periodEnd.getTime() + dayMs));
    const evidence = await ingestAcceptedTestRefund(f, 'writer-late', '10.00');
    await expect(replacementWriter.createControlledSettlementReplacementDraft(request))
      .rejects.toMatchObject({ assessment: { outcome: 'UNKNOWN', unknowns: expect.arrayContaining([
        expect.objectContaining({ code: 'LATE_REFUND_ROUTE_UNVERIFIED', sourceId: evidence.refundFinanceLedgerEntryId }),
      ]) } });
    expect(await db.settlementApproval.count({ where: { replacesSettlementApprovalId: f.originalId } })).toBe(0);
    expect(await db.refundEvidenceSnapshot.findUniqueOrThrow({ where: { id: evidence.id } })).toEqual(evidence);
  });

  it('2B: a line-write failure rolls back the replacement header, audit and source claim', async () => {
    const f = await cancelledFixture();
    const request = await replacementRequest(f, 'rollback');
    const originalBefore = await db.settlementApproval.findUniqueOrThrow({ where: { id: f.originalId },
      include: { lines: true } });
    await db.$executeRawUnsafe(`CREATE FUNCTION fin_bug_002_replacement_line_failure() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN
        IF EXISTS (SELECT 1 FROM "SettlementApproval" WHERE "id" = NEW."settlementApprovalId"
          AND "replacesSettlementApprovalId" IS NOT NULL) THEN
          RAISE EXCEPTION 'TEST_REPLACEMENT_LINE_FAILURE';
        END IF;
        RETURN NEW;
      END $$`);
    await db.$executeRawUnsafe(`CREATE TRIGGER fin_bug_002_replacement_line_failure
      BEFORE INSERT ON "SettlementApprovalLine" FOR EACH ROW
      EXECUTE FUNCTION fin_bug_002_replacement_line_failure()`);
    try {
      await expect(replacementWriter.createControlledSettlementReplacementDraft(request))
        .rejects.toThrow('TEST_REPLACEMENT_LINE_FAILURE');
    } finally {
      await db.$executeRawUnsafe('DROP TRIGGER fin_bug_002_replacement_line_failure ON "SettlementApprovalLine"');
      await db.$executeRawUnsafe('DROP FUNCTION fin_bug_002_replacement_line_failure()');
    }
    expect(await db.settlementApproval.count({ where: { replacesSettlementApprovalId: f.originalId } })).toBe(0);
    expect(await db.settlementApproval.findUnique({ where: { replacementRequestId: request.requestId } })).toBeNull();
    expect(await db.settlementApproval.findUniqueOrThrow({ where: { id: f.originalId },
      include: { lines: true } })).toEqual(originalBefore);
    expect(await db.settlementApprovalLine.count({ where: { financeLedgerEntryId: f.ledgerId,
      settlementApproval: { status: 'DRAFT' } } })).toBe(0);
  });

  it('CHARACTERIZATION: cancellation preserves S1 and source history, but READY cannot reuse its key', async () => {
    const f = await fixture();
    const initial = await schedule.getSettlementScheduleDryRun({ runDate: f.runDateKey, vendorId: f.vendorId });
    expect(initial.vendors[0]).toMatchObject({ state: 'READY', canCreateDraft: true, scheduledCycleKey: f.cycleKey });
    expect(initial.vendors[0].preview?.lines.map((line) => line.financeLedgerEntryId)).toEqual([f.ledgerId]);
    expect(initial.vendors[0].netPayableMinor).toBe(17600);
    expect(initial.scheduledDraftCreationAllowed).toBe(false);
    await expect(schedule.createSettlementScheduleDrafts({ runDate: f.runDateKey, vendorId: f.vendorId,
      confirmAutoSettlementDrafts: true })).rejects.toThrow(/UTC day end/);

    afterRunDate(f.runDate);
    const first = await schedule.createSettlementScheduleDrafts({ runDate: f.runDateKey, vendorId: f.vendorId,
      confirmAutoSettlementDrafts: true });
    expect(first).toMatchObject({ writesPerformed: true, summary: { created: 1, failed: 0 } });
    const s1Id = first.createdDrafts[0].settlementApprovalId;
    const before = await db.settlementApproval.findUniqueOrThrow({ where: { id: s1Id }, include: { lines: true } });
    expect(before).toMatchObject({ vendorId: f.vendorId, status: 'DRAFT', scheduledCycleKey: f.cycleKey,
      scheduledRunDate: f.runDate, scheduledPeriodEnd: f.periodEnd, netPayableMinor: 17600 });
    expect(before.lines.map((line) => line.financeLedgerEntryId)).toEqual([f.ledgerId]);

    const cancelled = await approval.cancelSettlementApproval(s1Id, `${f.vendorId}-admin`);
    expect(cancelled).toMatchObject({ id: s1Id, status: 'cancelled', cancelledBy: `${f.vendorId}-admin` });
    const persisted = await db.settlementApproval.findUniqueOrThrow({ where: { id: s1Id }, include: { lines: true } });
    expect(persisted).toMatchObject({ status: 'CANCELLED', scheduledCycleKey: f.cycleKey,
      netPayableMinor: before.netPayableMinor });
    expect(persisted.cancelledAt).toBeInstanceOf(Date);
    expect(persisted.lines).toEqual(before.lines);
    expect(await db.financeLedgerEntry.count({ where: { id: f.ledgerId, vendorId: f.vendorId } })).toBe(1);

    const preview = await schedule.getSettlementScheduleDryRun({ runDate: f.runDateKey, vendorId: f.vendorId });
    expect(preview.vendors[0]).toMatchObject({ state: 'READY', canCreateDraft: true,
      scheduledCycleKey: f.cycleKey, eligibleLineCount: 1, netPayableMinor: 17600,
      existingSettlementApprovalId: null, blockedReason: null });
    expect(preview.vendors[0].preview?.lines.map((line) => line.financeLedgerEntryId)).toEqual([f.ledgerId]);
    expect(await db.settlementApprovalLine.count({ where: { financeLedgerEntryId: f.ledgerId,
      settlementApproval: { status: { in: ['DRAFT', 'APPROVED'] } } } })).toBe(0);

    const result = await schedule.createSettlementScheduleDrafts({ runDate: f.runDateKey, vendorId: f.vendorId,
      confirmAutoSettlementDrafts: true });
    expect(result).toMatchObject({ writesPerformed: false, summary: { created: 0, failed: 1, skipped: 0 } });
    expect(result.failed[0].vendorId).toBe(f.vendorId);
    expect(result.failed[0].reason).toContain('Unique constraint failed on the fields: (`scheduledCycleKey`)');
    await expect(approval.createDraftApproval({ vendorId: f.vendorId, periodEnd: f.periodEnd,
      asOfDate: f.periodEnd, scheduledRunDate: f.runDate, scheduledPeriodEnd: f.periodEnd,
      scheduledCycleKey: f.cycleKey, candidateScope: 'date_range' })).rejects.toMatchObject({ code: 'P2002' });
    expect(await db.settlementApproval.count({ where: { vendorId: f.vendorId } })).toBe(1);
    expect(await db.settlementApprovalLine.count({ where: { financeLedgerEntryId: f.ledgerId } })).toBe(1);
    expect(await db.payoutBatch.count({ where: { vendorId: f.vendorId } })).toBe(0);

    const later = new Date(f.runDate.getTime() + 7 * dayMs);
    const laterPreview = await schedule.getSettlementScheduleDryRun({ runDate: later, vendorId: f.vendorId });
    expect(laterPreview.vendors[0].preview?.lines.map((line) => line.financeLedgerEntryId)).toEqual([f.ledgerId]);
    expect(laterPreview.vendors[0]).toMatchObject({ state: 'READY', canCreateDraft: true,
      eligibleLineCount: 1, netPayableMinor: 17600 });
  });

  it('CHARACTERIZATION: a completed JobRun remains historical after its DRAFT is cancelled', async () => {
    const f = await fixture();
    afterRunDate(f.runDate);
    const first = await job.runSettlementScheduleAutoDraftJob({ env: jobEnv, runDate: f.runDate,
      confirmScheduledSettlementAutoDraftJob: true, triggeredBy: `${f.vendorId}-admin` });
    expect(first).toMatchObject({ writesPerformed: true, summary: { createdDrafts: 1 },
      jobRun: { status: 'COMPLETED' } });
    const s1Id = first.vendors.find((vendor) => vendor.vendorId === f.vendorId)?.createdSettlementApprovalId;
    expect(s1Id).toBeTruthy();
    const originalJob = await db.settlementScheduleJobRun.findUniqueOrThrow({ where: { runDate: f.runDate } });
    await approval.cancelSettlementApproval(s1Id!, `${f.vendorId}-admin`);
    const repeat = await job.runSettlementScheduleAutoDraftJob({ env: jobEnv, runDate: f.runDate,
      confirmScheduledSettlementAutoDraftJob: true });
    expect(repeat).toMatchObject({ writesPerformed: false,
      summary: { createdDrafts: 1 }, jobRun: { id: originalJob.id, status: 'COMPLETED' } });
    expect(await db.settlementScheduleJobRun.findUniqueOrThrow({ where: { runDate: f.runDate } })).toEqual(originalJob);
    expect(await db.settlementApproval.count({ where: { vendorId: f.vendorId } })).toBe(1);
    const status = await job.getSettlementScheduleAutoDraftJobStatus(jobEnv);
    expect(status.evidence?.settlements).toContainEqual(expect.objectContaining({
      id: s1Id, status: 'CANCELLED', jobProvenance: 'MATCHED_METADATA',
    }));
  });

  it('CHARACTERIZATION: two same-key attempts do not create a replacement', async () => {
    const f = await fixture();
    afterRunDate(f.runDate);
    const first = await schedule.createSettlementScheduleDrafts({ runDate: f.runDateKey, vendorId: f.vendorId,
      confirmAutoSettlementDrafts: true });
    await approval.cancelSettlementApproval(first.createdDrafts[0].settlementApprovalId, `${f.vendorId}-admin`);
    const attempts = await Promise.all([1, 2].map(() => schedule.createSettlementScheduleDrafts({
      runDate: f.runDateKey, vendorId: f.vendorId, confirmAutoSettlementDrafts: true,
    })));
    expect(attempts.every((result) => result.summary.created === 0 && result.writesPerformed === false)).toBe(true);
    expect(await db.settlementApproval.count({ where: { vendorId: f.vendorId } })).toBe(1);
    expect(await db.settlementApprovalLine.count({ where: { financeLedgerEntryId: f.ledgerId } })).toBe(1);
  });

  it('CHARACTERIZATION: manual and scheduled attempts cannot both claim the released SALE', async () => {
    const f = await fixture();
    afterRunDate(f.runDate);
    const first = await schedule.createSettlementScheduleDrafts({ runDate: f.runDateKey, vendorId: f.vendorId,
      confirmAutoSettlementDrafts: true });
    await approval.cancelSettlementApproval(first.createdDrafts[0].settlementApprovalId, `${f.vendorId}-admin`);
    const [manual, scheduled] = await Promise.all([
      approval.createDraftApproval({ vendorId: f.vendorId }),
      schedule.createSettlementScheduleDrafts({ runDate: f.runDateKey, vendorId: f.vendorId,
        confirmAutoSettlementDrafts: true }),
    ]);
    expect(manual.lines.map((line) => line.financeLedgerEntryId)).toEqual([f.ledgerId]);
    expect(manual.scheduledCycleKey).toBeNull();
    expect(scheduled.summary.created).toBe(0);
    const approvals = await db.settlementApproval.findMany({ where: { vendorId: f.vendorId }, include: { lines: true } });
    expect(approvals).toHaveLength(2);
    expect(approvals.filter((item) => item.status === 'CANCELLED')).toHaveLength(1);
    expect(approvals.filter((item) => item.status === 'DRAFT')).toHaveLength(1);
    expect(approvals.flatMap((item) => item.lines.map((line) => line.financeLedgerEntryId)))
      .toEqual([f.ledgerId, f.ledgerId]);
    expect(await db.settlementApprovalLine.count({ where: { financeLedgerEntryId: f.ledgerId,
      settlementApproval: { status: { in: ['DRAFT', 'APPROVED'] } } } })).toBe(1);
  });

  it('persists cancellation provenance and enforces replacement audit identity without enabling replacement', async () => {
    const f = await fixture();
    afterRunDate(f.runDate);
    const first = await schedule.createSettlementScheduleDrafts({ runDate: f.runDateKey, vendorId: f.vendorId,
      confirmAutoSettlementDrafts: true });
    const originalId = first.createdDrafts[0].settlementApprovalId;
    const before = await db.settlementApproval.findUniqueOrThrow({ where: { id: originalId } });
    expect(before.cancelledFromStatus).toBeNull();
    expect(before.replacesSettlementApprovalId).toBeNull();
    expect(before.replacementRequestId).toBeNull();

    await approval.cancelSettlementApproval(originalId, `${f.vendorId}-admin`);
    const cancelled = await db.settlementApproval.findUniqueOrThrow({ where: { id: originalId }, include: { lines: true } });
    expect(cancelled).toMatchObject({ status: 'CANCELLED', cancelledFromStatus: 'DRAFT',
      cancelledBy: `${f.vendorId}-admin`, scheduledCycleKey: f.cycleKey });
    expect(cancelled.cancelledAt).toBeInstanceOf(Date);
    expect(cancelled.lines.map((line) => line.financeLedgerEntryId)).toEqual([f.ledgerId]);

    // Synthetic rows exercise only the additive database contract. No service creates a replacement.
    const auditData = (predecessorId: string, requestId: string, vendorId = f.vendorId) => ({
      vendorId,
      status: 'DRAFT' as const,
      grossSalesMinor: 0,
      refundTotalMinor: 0,
      commissionMinor: 0,
      commissionVatMinor: 0,
      netPayableMinor: 0,
      sourceSnapshotJson: { testOnlyReplacementAudit: true },
      replacesSettlementApprovalId: predecessorId,
      replacementRequestId: requestId,
      replacementRequestedBy: `${vendorId}-admin`,
      replacementReason: 'PostgreSQL audit constraint fixture',
      replacementRequestedAt: new Date(),
    });
    const auditRow = await db.settlementApproval.create({ data: auditData(originalId, `${f.vendorId}-request`) });
    expect(auditRow.replacesSettlementApprovalId).toBe(originalId);
    expect((await db.settlementApproval.findUniqueOrThrow({ where: { id: originalId },
      include: { replacementSettlementApproval: true } })).replacementSettlementApproval?.id).toBe(auditRow.id);
    await expect(db.settlementApproval.create({ data: auditData(originalId, `${f.vendorId}-other-request`) }))
      .rejects.toMatchObject({ code: 'P2002' });
    await expect(db.settlementApproval.create({ data: auditData(`${f.vendorId}-missing`, `${f.vendorId}-missing-request`) }))
      .rejects.toMatchObject({ code: 'P2003' });
    await expect(db.settlementApproval.create({ data: {
      ...auditData(originalId, `${f.vendorId}-incomplete-request`), replacementReason: null,
    } })).rejects.toThrow();

    const other = await fixture();
    await expect(db.settlementApproval.create({ data: auditData(originalId, `${f.vendorId}-cross-vendor`, other.vendorId) }))
      .rejects.toMatchObject({ code: 'P2003' });
    const otherPredecessor = await db.settlementApproval.create({ data: {
      vendorId: other.vendorId, grossSalesMinor: 0, refundTotalMinor: 0,
      commissionMinor: 0, commissionVatMinor: 0, netPayableMinor: 0, sourceSnapshotJson: {},
    } });
    await expect(db.settlementApproval.create({ data: auditData(otherPredecessor.id, `${f.vendorId}-request`, other.vendorId) }))
      .rejects.toMatchObject({ code: 'P2002' });

    const persistedOriginal = await db.settlementApproval.findUniqueOrThrow({ where: { id: originalId } });
    expect(persistedOriginal.scheduledCycleKey).toBe(f.cycleKey);
    expect(persistedOriginal.netPayableMinor).toBe(before.netPayableMinor);
    expect(await db.settlementApprovalLine.count({ where: { financeLedgerEntryId: f.ledgerId,
      settlementApproval: { status: { in: ['DRAFT', 'APPROVED'] } } } })).toBe(0);
  });

  it('records APPROVED as the pre-cancellation status without changing the original cycle', async () => {
    const f = await fixture();
    afterRunDate(f.runDate);
    const created = await schedule.createSettlementScheduleDrafts({ runDate: f.runDateKey, vendorId: f.vendorId,
      confirmAutoSettlementDrafts: true });
    const originalId = created.createdDrafts[0].settlementApprovalId;
    await approval.approveSettlementApproval(originalId, `${f.vendorId}-approver`);
    await approval.cancelSettlementApproval(originalId, `${f.vendorId}-admin`);
    const cancelled = await db.settlementApproval.findUniqueOrThrow({ where: { id: originalId } });
    expect(cancelled).toMatchObject({ status: 'CANCELLED', cancelledFromStatus: 'APPROVED',
      approvedBy: `${f.vendorId}-approver`, cancelledBy: `${f.vendorId}-admin`, scheduledCycleKey: f.cycleKey });
    expect(cancelled.approvedAt).toBeInstanceOf(Date);
    expect(cancelled.cancelledAt).toBeInstanceOf(Date);
    const assessment = await replacement.assessCancelledScheduledSettlementReplacement({
      originalSettlementApprovalId: originalId, vendorId: f.vendorId,
    });
    expect(assessment.outcome).toBe('BLOCKED');
    expect(assessment.blockers.map((item) => item.code)).toContain('NOT_ORIGINALLY_DRAFT');
    const request = await replacementRequest({ ...f, originalId }, 'approved-history');
    await expect(replacementWriter.createControlledSettlementReplacementDraft(request))
      .rejects.toMatchObject({ assessment: { outcome: 'BLOCKED', blockers: expect.arrayContaining([
        expect.objectContaining({ code: 'NOT_ORIGINALLY_DRAFT' }),
        expect.objectContaining({ code: 'ORIGINAL_APPROVAL_HISTORY' }),
      ]) } });
    expect(await db.settlementApproval.count({ where: { replacesSettlementApprovalId: originalId } })).toBe(0);
  });

  it('rolls back cancellation audit when approval wins a Serializable race', async () => {
    const f = await fixture();
    afterRunDate(f.runDate);
    const created = await schedule.createSettlementScheduleDrafts({ runDate: f.runDateKey, vendorId: f.vendorId,
      confirmAutoSettlementDrafts: true });
    const id = created.createdDrafts[0].settlementApprovalId;
    const held = await holdVendorLock(f.vendorId);
    let outcome!: PromiseSettledResult<Awaited<ReturnType<typeof approval.cancelSettlementApproval>>>;
    try {
      const attempt = approval.cancelSettlementApproval(id, `${f.vendorId}-canceller`);
      const settled = Promise.allSettled([attempt]);
      await waitForCancellationLockWaits(1);
      const approved = await approval.approveSettlementApproval(id, `${f.vendorId}-approver`);
      expect(approved.status).toBe('approved');
      await held.release();
      outcome = (await settled)[0];
    } finally {
      // Releasing twice is harmless if an assertion fails before the normal release.
      await held.release();
    }
    const persisted = await db.settlementApproval.findUniqueOrThrow({ where: { id }, include: { lines: true } });
    expect(outcome.status).toBe('rejected');
    if (outcome.status === 'rejected') expect(outcome.reason).toMatchObject({
      code: 'P2010', meta: { code: '40001' },
    });
    expect(persisted).toMatchObject({ status: 'APPROVED', cancelledFromStatus: null,
      cancelledBy: null, cancelledAt: null, approvedBy: `${f.vendorId}-approver`, scheduledCycleKey: f.cycleKey });
    expect(persisted.lines.map((line) => line.financeLedgerEntryId)).toEqual([f.ledgerId]);
    expect(await db.settlementApproval.count({ where: { vendorId: f.vendorId } })).toBe(1);
    expect(await db.payoutBatch.count({ where: { vendorId: f.vendorId } })).toBe(0);
  });

  it('does not create conflicting cancellation history under two concurrent requests', async () => {
    const f = await fixture();
    afterRunDate(f.runDate);
    const created = await schedule.createSettlementScheduleDrafts({ runDate: f.runDateKey, vendorId: f.vendorId,
      confirmAutoSettlementDrafts: true });
    const id = created.createdDrafts[0].settlementApprovalId;
    const held = await holdVendorLock(f.vendorId);
    let outcomes!: PromiseSettledResult<Awaited<ReturnType<typeof approval.cancelSettlementApproval>>>[];
    try {
      const attempts = Promise.allSettled([
        approval.cancelSettlementApproval(id, `${f.vendorId}-admin-1`),
        approval.cancelSettlementApproval(id, `${f.vendorId}-admin-2`),
      ]);
      await waitForCancellationLockWaits(2);
      await held.release();
      outcomes = await attempts;
    } finally {
      await held.release();
    }
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1);
    const persisted = await db.settlementApproval.findUniqueOrThrow({ where: { id }, include: { lines: true } });
    expect(persisted).toMatchObject({ status: 'CANCELLED', cancelledFromStatus: 'DRAFT',
      scheduledCycleKey: f.cycleKey });
    expect([`${f.vendorId}-admin-1`, `${f.vendorId}-admin-2`]).toContain(persisted.cancelledBy);
    expect(persisted.cancelledAt).toBeInstanceOf(Date);
    expect(persisted.lines.map((line) => line.financeLedgerEntryId)).toEqual([f.ledgerId]);
    expect(await db.settlementApproval.count({ where: { vendorId: f.vendorId } })).toBe(1);
    expect(await db.payoutBatch.count({ where: { vendorId: f.vendorId } })).toBe(0);
  });
});
