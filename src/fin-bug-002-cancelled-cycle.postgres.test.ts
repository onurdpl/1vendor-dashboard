import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '../backend/node_modules/@prisma/client/index.js';

const databaseUrl = process.env.TEST_DATABASE_URL?.trim();
const suite = databaseUrl ? describe : describe.skip;
const databaseName = 'fin_bug_002_validation';
const dayMs = 86_400_000;
const jobEnv = { SETTLEMENT_AUTO_DRAFT_JOB_ENABLED: true, SETTLEMENT_AUTO_DRAFT_JOB_DRY_RUN: false };

suite('FIN-BUG-002 current cancelled scheduled cycle behavior (PostgreSQL 16 or 18)', () => {
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
    expect([16, 18]).toContain(Math.floor(Number(identity.version) / 10000));
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

  async function addEligiblePostCutoffSale(f: Awaited<ReturnType<typeof cancelledFixture>>, amount: string,
    suffix = 'later-sale') {
    const id = `${f.vendorId}-${suffix}`;
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
    const request = await replacementRequest(f, 'legacy-late-refund');
    await expect(replacementWriter.createControlledSettlementReplacementDraft(request))
      .rejects.toMatchObject({ assessment: { outcome: 'UNKNOWN' } });
    expect(await db.settlementApproval.count({ where: { replacesSettlementApprovalId: f.originalId } })).toBe(0);
  });

  it('2D: two verified late refunds retain exact independent evidence without entering T', async () => {
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
    expect(result.outcome).toBe('ELIGIBLE');
    expect(result.safeForAdminConsideration).toBe(true);
    expect(result.sourceComparison.current.map((item) => item.financeLedgerEntryId)).toEqual([f.ledgerId]);
    expect(result.refundEvidence.map((item) => item.refundFinanceLedgerEntryId).sort()).toEqual([
      first.refundFinanceLedgerEntryId, second.refundFinanceLedgerEntryId,
    ].sort());
    expect(result.unknowns).toEqual([]);
    expect(await db.settlementApproval.findUniqueOrThrow({ where: { id: f.originalId }, include: { lines: true } })).toEqual(before);
    expect(await db.refundEvidenceSnapshot.findMany({ where: {
      refundFinanceLedgerEntryId: { in: [first.refundFinanceLedgerEntryId, second.refundFinanceLedgerEntryId] },
    }, orderBy: { refundFinanceLedgerEntryId: 'asc' } })).toEqual(evidenceBefore);
    expect(await db.settlementApproval.count({ where: { vendorId: f.vendorId } })).toBe(1);
  });

  it('2C1-B: adjustment diagnostics keep each accepted sibling refund bound to its own record', async () => {
    const f = await cancelledFixture();
    vi.setSystemTime(new Date(f.periodEnd.getTime() + dayMs));
    const first = await ingestAcceptedTestRefund(f, 'identity-one', '10.00');
    const second = await ingestAcceptedTestRefund(f, 'identity-two', '15.00');
    const futurePreview = await approval.previewApproval(f.vendorId,
      new Date(f.periodEnd.getTime() + 1), new Date(f.periodEnd.getTime() + 2 * dayMs),
      { candidateScope: 'date_range', asOfDate: new Date(f.periodEnd.getTime() + 2 * dayMs) });
    expect(futurePreview.writesPerformed).toBe(false);
    expect(futurePreview.lines.map((line) => [line.financeLedgerEntryId, line.lineType, line.payableImpactMinor]))
      .toEqual(expect.arrayContaining([
        [first.refundFinanceLedgerEntryId, 'REFUND', -880],
        [second.refundFinanceLedgerEntryId, 'REFUND', -1320],
      ]));
    expect(futurePreview.lines).toHaveLength(2);
    const { previewRefundAdjustmentEligibility } = await import(
      '../backend/src/modules/finance/settlement-refund-adjustment-eligibility-diagnostics.service.js'
    );
    const preview = await previewRefundAdjustmentEligibility({ vendorId: f.vendorId });
    expect(preview.writesPerformed).toBe(false);
    expect(preview.records).toHaveLength(2);
    for (const evidence of [first, second]) {
      const record = preview.records.find((item) =>
        item.refundFinanceLedgerEntryId === evidence.refundFinanceLedgerEntryId);
      expect(record).toMatchObject({
        refundFinanceLedgerEntryId: evidence.refundFinanceLedgerEntryId,
        refundRecordId: evidence.refundRecordId,
        vendorId: f.vendorId,
      });
    }
    const { getVendorFinanceDashboard } = await import('../backend/src/modules/finance/finance.service.js');
    const dashboard = await getVendorFinanceDashboard(f.vendorId);
    for (const evidence of [first, second]) {
      expect(dashboard.records.find((record) => record.id === evidence.refundFinanceLedgerEntryId))
        .toMatchObject({ relatedRefundId: evidence.sourceShopifyRefundId });
    }
  });

  it('2C1-D2: settlement preview, draft and approval retain two exact accepted refund ledgers', async () => {
    const f = await cancelledFixture();
    vi.setSystemTime(new Date(f.periodEnd.getTime() + dayMs));
    const first = await ingestAcceptedTestRefund(f, 'settlement-one', '10.00');
    const second = await ingestAcceptedTestRefund(f, 'settlement-two', '15.00');
    const expectedRefundIds = [first.refundFinanceLedgerEntryId, second.refundFinanceLedgerEntryId];
    const frozenAssessment = await replacement.assessCancelledScheduledSettlementReplacement({
      originalSettlementApprovalId: f.originalId, vendorId: f.vendorId,
    });
    expect(frozenAssessment.outcome).toBe('ELIGIBLE');
    expect(frozenAssessment.sourceComparison.current.map((line) => line.financeLedgerEntryId)).toEqual([f.ledgerId]);
    for (const refundId of expectedRefundIds) {
      expect(frozenAssessment.refundEvidence).toContainEqual(expect.objectContaining({
        refundFinanceLedgerEntryId: refundId, afterCutoff: true,
      }));
      expect(await db.settlementRefundAdjustment.count({ where: { refundFinanceLedgerEntryId: refundId } })).toBe(0);
      expect(await db.vendorBalanceEvent.count({ where: {
        financeLedgerEntryId: refundId, type: 'VENDOR_DEBT_CREATED',
      } })).toBe(0);
    }
    const { previewRefundAdjustmentEligibility, backfillPendingRefundAdjustments } = await import(
      '../backend/src/modules/finance/settlement-refund-adjustment-eligibility-diagnostics.service.js'
    );
    const adjustmentPreview = await previewRefundAdjustmentEligibility({ vendorId: f.vendorId });
    for (const refundId of expectedRefundIds) {
      expect(adjustmentPreview.records.find((record) => record.refundFinanceLedgerEntryId === refundId))
        .toMatchObject({ recommendedAction: 'MISSING_APPROVED_SETTLEMENT_LINE' });
    }
    const backfill = await backfillPendingRefundAdjustments({ vendorId: f.vendorId });
    expect(backfill.writesPerformed).toBe(false);
    expect(backfill.createdRecords).toEqual([]);
    expect(await db.settlementApproval.count({ where: { replacesSettlementApprovalId: f.originalId } })).toBe(0);
    const preview = await approval.previewApproval(f.vendorId);
    expect(preview.lines.map((line) => line.financeLedgerEntryId)).toEqual(expect.arrayContaining([
      f.ledgerId, ...expectedRefundIds,
    ]));
    expect(preview.lines.filter((line) => expectedRefundIds.includes(line.financeLedgerEntryId))
      .map((line) => [line.financeLedgerEntryId, line.payableImpactMinor]))
      .toEqual(expect.arrayContaining([
        [first.refundFinanceLedgerEntryId, -880],
        [second.refundFinanceLedgerEntryId, -1320],
      ]));
    for (const evidence of [first, second]) {
      const snapshot = await db.refundEvidenceSnapshot.findUniqueOrThrow({
        where: { refundFinanceLedgerEntryId: evidence.refundFinanceLedgerEntryId },
      });
      expect(snapshot).toMatchObject({
        refundRecordId: evidence.refundRecordId,
        sourceShopifyRefundId: evidence.sourceShopifyRefundId,
        vendorAllocationId: f.allocationId,
        historicalEconomicVendorId: f.vendorId,
        historicalSaleFinanceLedgerEntryId: f.ledgerId,
      });
    }
    const draft = await approval.createDraftApproval({ vendorId: f.vendorId });
    expect(draft.lines.map((line) => line.financeLedgerEntryId)).toEqual(expect.arrayContaining([
      f.ledgerId, ...expectedRefundIds,
    ]));
    const approved = await approval.approveSettlementApproval(draft.id, `${f.vendorId}-approver`);
    expect(approved.status).toBe('approved');
    expect(approved.lines.map((line) => line.financeLedgerEntryId)).toEqual(expect.arrayContaining([
      f.ledgerId, ...expectedRefundIds,
    ]));
    for (const refundId of expectedRefundIds) {
      expect(approved.lines.filter((line) => line.financeLedgerEntryId === refundId)).toHaveLength(1);
      expect(await db.settlementRefundAdjustment.count({ where: { refundFinanceLedgerEntryId: refundId } })).toBe(0);
      expect(await db.vendorBalanceEvent.count({ where: {
        financeLedgerEntryId: refundId, type: 'VENDOR_DEBT_CREATED',
      } })).toBe(0);
    }
    expect(await db.settlementApproval.count({ where: { vendorId: f.vendorId, status: 'APPROVED' } })).toBe(1);
    expect(await db.payoutBatch.count({ where: { vendorId: f.vendorId, status: 'PAID' } })).toBe(0);
  });

  it.each(['admin', 'system'] as const)(
    '2D: a frozen replacement approved via %s carries two late refunds into distinct later adjustments', async (actor) => {
    const f = await cancelledFixture();
    vi.setSystemTime(new Date(f.periodEnd.getTime() + dayMs));
    const first = await ingestAcceptedTestRefund(f, 'bridge-one', '10.00');
    const second = await ingestAcceptedTestRefund(f, 'bridge-two', '15.00');
    const refundIds = [first.refundFinanceLedgerEntryId, second.refundFinanceLedgerEntryId];
    const request = await replacementRequest(f, 'late-refund-bridge');
    const created = await replacementWriter.createControlledSettlementReplacementDraft(request);
    expect(created).toMatchObject({ outcome: 'CREATED', status: 'DRAFT' });
    expect(await replacementWriter.createControlledSettlementReplacementDraft(request))
      .toMatchObject({ outcome: 'REPLAYED', replacementSettlementApprovalId: created.replacementSettlementApprovalId });
    const replacementRow = await db.settlementApproval.findUniqueOrThrow({
      where: { id: created.replacementSettlementApprovalId }, include: { lines: true },
    });
    expect(replacementRow).toMatchObject({ replacesSettlementApprovalId: f.originalId, periodEnd: f.periodEnd });
    expect(replacementRow.lines.map((line) => line.financeLedgerEntryId)).toEqual([f.ledgerId]);
    expect(replacementRow.lines.map((line) => line.financeLedgerEntryId))
      .not.toEqual(expect.arrayContaining(refundIds));
    expect((replacementRow.sourceSnapshotJson as { lateRefundLedgerIds: string[] }).lateRefundLedgerIds)
      .toEqual([...refundIds].sort());
    expect(await db.settlementApproval.findUniqueOrThrow({ where: { id: f.originalId } }))
      .toMatchObject({ status: 'CANCELLED' });

    const approved = actor === 'system'
      ? await (await import('../backend/src/modules/finance/settlement-auto-approval.service.js'))
        .approveSettlementDraftInternally({ settlementApprovalId: replacementRow.id, expectedVendorId: f.vendorId })
      : await approval.approveSettlementApproval(replacementRow.id, `${f.vendorId}-approver`);
    expect(approved.status).toBe('approved');
    expect(await db.settlementApproval.findUniqueOrThrow({ where: { id: replacementRow.id } })).toMatchObject({
      approvedBy: actor === 'system' ? 'system:settlement_auto_approval' : `${f.vendorId}-approver`,
    });
    if (actor === 'system') {
      const attempt = await db.settlementAutoApprovalAttempt.findFirstOrThrow({
        where: { settlementApprovalId: replacementRow.id },
      });
      expect(attempt).toMatchObject({ vendorId: f.vendorId, outcome: 'APPROVED' });
      expect((await db.settlementApproval.findUniqueOrThrow({ where: { id: replacementRow.id } }))
        .successfulAutoApprovalAttemptId).toBe(attempt.id);
      expect(await (await import('../backend/src/modules/finance/settlement-auto-approval.service.js'))
        .reconcileAutomaticApprovalAttempt({ attemptId: attempt.id,
          settlementApprovalId: replacementRow.id, expectedVendorId: f.vendorId }))
        .toMatchObject({ classification: 'VERIFIED_COMPLETED', reasonCode: 'EXACT_ATTEMPT_APPROVED' });
    }
    await expect(approval.approveSettlementApproval(replacementRow.id, `${f.vendorId}-approver`))
      .rejects.toThrow('Only draft settlement approvals can be approved.');
    for (const [evidence, amount] of [[first, 880], [second, 1320]] as const) {
      expect(await db.settlementRefundAdjustment.findUniqueOrThrow({ where: {
        refundFinanceLedgerEntryId: evidence.refundFinanceLedgerEntryId,
      } })).toMatchObject({ refundRecordId: evidence.refundRecordId, vendorId: f.vendorId,
        originalSettlementApprovalId: replacementRow.id, status: 'PENDING',
        originalAmountMinor: amount, appliedAmountMinor: 0, remainingAmountMinor: amount });
    }
    const { preparePayoutBatch } = await import('../backend/src/modules/finance/finance.service.js');
    await expect(preparePayoutBatch({ vendorId: f.vendorId }, `${f.vendorId}-admin`)).rejects.toThrow();
    expect(await db.payoutBatch.count({ where: { vendorId: f.vendorId } })).toBe(0);

    const laterSaleId = await addEligiblePostCutoffSale(f, '100.00');
    const laterDraft = await approval.createDraftApproval({ vendorId: f.vendorId });
    expect(laterDraft.lines.map((line) => [line.financeLedgerEntryId, line.lineType]))
      .toEqual(expect.arrayContaining([
        [laterSaleId, 'SALE'],
        [first.refundFinanceLedgerEntryId, 'REFUND_ADJUSTMENT'],
        [second.refundFinanceLedgerEntryId, 'REFUND_ADJUSTMENT'],
      ]));
    expect(laterDraft.lines.filter((line) => refundIds.includes(line.financeLedgerEntryId))
      .map((line) => [line.financeLedgerEntryId, line.lineType]).sort())
      .toEqual(refundIds.map((id) => [id, 'REFUND_ADJUSTMENT']).sort());
    await approval.approveSettlementApproval(laterDraft.id, `${f.vendorId}-approver`);
    for (const evidence of [first, second]) {
      const adjustment = await db.settlementRefundAdjustment.findUniqueOrThrow({ where: {
        refundFinanceLedgerEntryId: evidence.refundFinanceLedgerEntryId,
      } });
      expect(adjustment).toMatchObject({ status: 'APPLIED', remainingAmountMinor: 0 });
      expect(adjustment.appliedAmountMinor).toBe(adjustment.originalAmountMinor);
      expect(await db.settlementRefundAdjustmentApplication.count({ where: {
        settlementRefundAdjustmentId: adjustment.id, status: 'ACTIVE',
      } })).toBe(1);
    }
    expect(await db.vendorBalanceEvent.count({ where: {
      financeLedgerEntryId: { in: refundIds }, type: 'VENDOR_DEBT_CREATED',
    } })).toBe(0);
    const replay = await ingestAcceptedTestRefund(f, 'bridge-one', '10.00');
    expect(replay.id).toBe(first.id);
    expect(replay.refundFinanceLedgerEntryId).toBe(first.refundFinanceLedgerEntryId);
    expect(await db.refundEvidenceSnapshot.count({ where: {
      refundFinanceLedgerEntryId: first.refundFinanceLedgerEntryId,
    } })).toBe(1);
    expect(await db.settlementRefundAdjustment.count({ where: {
      refundFinanceLedgerEntryId: first.refundFinanceLedgerEntryId,
    } })).toBe(1);
    const payout = await preparePayoutBatch({ vendorId: f.vendorId }, `${f.vendorId}-admin`);
    expect(payout.lines.filter((line) => refundIds.includes(line.financeLedgerEntryId))
      .map((line) => [line.financeLedgerEntryId, line.amountSnapshot]))
      .toEqual(expect.arrayContaining([
        [first.refundFinanceLedgerEntryId, '-8.80'],
        [second.refundFinanceLedgerEntryId, '-13.20'],
      ]));
  });

  it.each([
    'grossSalesMinor', 'refundTotalMinor', 'commissionMinor', 'commissionVatMinor', 'netPayableMinor',
  ] as const)('rejects a %s mismatch before a late-refund replacement creates adjustments', async (field) => {
    const f = await cancelledFixture();
    vi.setSystemTime(new Date(f.periodEnd.getTime() + dayMs));
    const evidence = await ingestAcceptedTestRefund(f, 'monetary-bridge', '10.00');
    const request = await replacementRequest(f, 'monetary-bridge');
    const created = await replacementWriter.createControlledSettlementReplacementDraft(request);
    expect(created.outcome).toBe('CREATED');
    const before = await db.settlementApproval.findUniqueOrThrow({ where: {
      id: created.replacementSettlementApprovalId }, include: { lines: true },
    });
    expect(before.lines.map((line) => line.financeLedgerEntryId)).toEqual([f.ledgerId]);
    expect((before.sourceSnapshotJson as { lateRefundLedgerIds: string[] }).lateRefundLedgerIds)
      .toEqual([evidence.refundFinanceLedgerEntryId]);
    await db.settlementApproval.update({ where: { id: before.id }, data: { [field]: before[field] + 1 } });

    await expect(approval.approveSettlementApproval(before.id, `${f.vendorId}-approver`))
      .rejects.toThrow(`Settlement approval monetary totals are inconsistent: ${field}.`);
    const after = await db.settlementApproval.findUniqueOrThrow({ where: { id: before.id },
      include: { lines: true } });
    expect(after).toMatchObject({ status: 'DRAFT', approvedBy: null, approvedAt: null });
    expect(after[field]).toBe(before[field] + 1);
    expect(after.lines).toEqual(before.lines);
    expect(await db.settlementApproval.findUniqueOrThrow({ where: { id: f.originalId } }))
      .toMatchObject({ status: 'CANCELLED' });
    expect(await db.settlementRefundAdjustment.count({ where: {
      refundFinanceLedgerEntryId: evidence.refundFinanceLedgerEntryId,
    } })).toBe(0);
  });

  it.each([
    'grossSalesMinor', 'refundTotalMinor', 'commissionMinor', 'commissionVatMinor', 'netPayableMinor',
  ] as const)('rejects a %s mismatch without reapplying an exact refund adjustment', async (field) => {
    const f = await fixture();
    afterRunDate(f.runDate);
    const scheduled = await schedule.createSettlementScheduleDrafts({ runDate: f.runDateKey,
      vendorId: f.vendorId, confirmAutoSettlementDrafts: true });
    expect(scheduled.summary.created).toBe(1);
    const originalId = scheduled.createdDrafts[0].settlementApprovalId;
    await approval.approveSettlementApproval(originalId, `${f.vendorId}-approver`);
    const evidence = await ingestAcceptedTestRefund({ ...f, originalId }, 'monetary-adjustment', '10.00');
    const adjustment = await db.settlementRefundAdjustment.findUniqueOrThrow({ where: {
      refundFinanceLedgerEntryId: evidence.refundFinanceLedgerEntryId,
    } });
    expect(adjustment).toMatchObject({ status: 'PENDING', remainingAmountMinor: 880 });
    const saleId = await addEligiblePostCutoffSale(f, '100.00');
    const draft = await approval.createDraftApproval({ vendorId: f.vendorId });
    const before = await db.settlementApproval.findUniqueOrThrow({ where: { id: draft.id },
      include: { lines: true } });
    expect(before.lines.map((line) => [line.financeLedgerEntryId, line.lineType]))
      .toEqual(expect.arrayContaining([
        [saleId, 'SALE'], [evidence.refundFinanceLedgerEntryId, 'REFUND_ADJUSTMENT'],
      ]));
    expect(before.refundTotalMinor).toBe(0);
    expect(before.netPayableMinor).toBe(7920);
    const applicationBefore = await db.settlementRefundAdjustmentApplication.findMany({ where: {
      settlementRefundAdjustmentId: adjustment.id,
    } });
    const adjustmentBefore = await db.settlementRefundAdjustment.findUniqueOrThrow({ where: { id: adjustment.id } });
    await db.settlementApproval.update({ where: { id: draft.id }, data: { [field]: before[field] + 1 } });

    await expect(approval.approveSettlementApproval(draft.id, `${f.vendorId}-approver`))
      .rejects.toThrow(`Settlement approval monetary totals are inconsistent: ${field}.`);
    const after = await db.settlementApproval.findUniqueOrThrow({ where: { id: draft.id },
      include: { lines: true } });
    expect(after).toMatchObject({ status: 'DRAFT', approvedBy: null, approvedAt: null });
    expect(after[field]).toBe(before[field] + 1);
    expect(after.lines).toEqual(before.lines);
    expect(await db.settlementRefundAdjustment.findUniqueOrThrow({ where: { id: adjustment.id } }))
      .toEqual(adjustmentBefore);
    expect(await db.settlementRefundAdjustmentApplication.findMany({ where: {
      settlementRefundAdjustmentId: adjustment.id,
    } })).toEqual(applicationBefore);
  });

  async function ordinaryZeroNetDraft() {
    const f = await fixture();
    afterRunDate(f.runDate);
    const evidence = await ingestAcceptedTestRefund({ ...f, originalId: '' }, 'zero-net', '200.00', '200.00');
    const draft = await approval.createDraftApproval({ vendorId: f.vendorId });
    expect(new Set(draft.lines.map((line) => line.financeLedgerEntryId)))
      .toEqual(new Set([f.ledgerId, evidence.refundFinanceLedgerEntryId]));
    expect(draft.netPayableMinor).toBe(0);
    return { f, evidence, draft };
  }

  it.each(['admin', 'system'] as const)('approves an ordinary zero-net SALE and exact REFUND via %s', async (actor) => {
    const { f, draft } = await ordinaryZeroNetDraft();
    const approved = actor === 'system'
      ? await (await import('../backend/src/modules/finance/settlement-auto-approval.service.js'))
        .approveSettlementDraftInternally({ settlementApprovalId: draft.id, expectedVendorId: f.vendorId })
      : await approval.approveSettlementApproval(draft.id, 'zero-net-test-admin');
    expect(approved.status).toBe('approved');
    expect(await db.settlementApproval.findUniqueOrThrow({ where: { id: draft.id } })).toMatchObject({
      approvedBy: actor === 'system' ? 'system:settlement_auto_approval' : 'zero-net-test-admin',
      netPayableMinor: 0,
    });
  });

  it.each([
    'grossSalesMinor', 'refundTotalMinor', 'commissionMinor', 'commissionVatMinor', 'netPayableMinor',
  ] as const)('rejects a %s mismatch for ordinary zero-net SALE and REFUND', async (field) => {
    const { f, draft } = await ordinaryZeroNetDraft();
    const before = await db.settlementApproval.findUniqueOrThrow({ where: { id: draft.id },
      include: { lines: true } });
    await db.settlementApproval.update({ where: { id: draft.id }, data: { [field]: before[field] + 1 } });
    await expect(approval.approveSettlementApproval(draft.id, 'zero-net-test-admin'))
      .rejects.toThrow(`Settlement approval monetary totals are inconsistent: ${field}.`);
    const after = await db.settlementApproval.findUniqueOrThrow({ where: { id: draft.id },
      include: { lines: true } });
    expect(after).toMatchObject({ status: 'DRAFT', approvedBy: null, approvedAt: null });
    expect(after[field]).toBe(before[field] + 1);
    expect(after.lines).toEqual(before.lines);
    expect(await db.payoutBatch.count({ where: { vendorId: f.vendorId } })).toBe(0);
    expect(await db.settlementRefundAdjustment.count({ where: { vendorId: f.vendorId } })).toBe(0);
  });

  async function negativeNetDraft() {
    const f = await fixture();
    afterRunDate(f.runDate);
    const evidence = await ingestAcceptedTestRefund({ ...f, originalId: '' }, 'negative-net', '10.00');
    // Model an earlier SALE and a later accepted REFUND without changing delivery or accepted evidence clocks.
    const refundLedger = await db.financeLedgerEntry.findUniqueOrThrow({
      where: { id: evidence.refundFinanceLedgerEntryId }, select: { createdAt: true },
    });
    const periodStart = new Date(Date.UTC(refundLedger.createdAt.getUTCFullYear(),
      refundLedger.createdAt.getUTCMonth(), refundLedger.createdAt.getUTCDate()));
    await db.financeLedgerEntry.update({ where: { id: f.ledgerId },
      data: { createdAt: new Date(periodStart.getTime() - dayMs) } });
    const periodEnd = new Date(refundLedger.createdAt.getTime() + 1_000);
    const draft = await approval.createDraftApproval({ vendorId: f.vendorId,
      candidateScope: 'date_range', periodStart, periodEnd, asOfDate: periodEnd });
    expect(draft.lines.map((line) => [line.financeLedgerEntryId, line.lineType]))
      .toEqual([[evidence.refundFinanceLedgerEntryId, 'REFUND']]);
    // A 10.00 TRY gross refund reverses 8.80 TRY of frozen vendor payable.
    expect(draft.refundTotalMinor).toBe(1000);
    expect(draft.netPayableMinor).toBe(-880);
    return { f, evidence, draft };
  }

  it.each(['admin', 'system'] as const)(
    'approves a negative-net REFUND DRAFT via %s without executing a payment', async (actor) => {
    const { f, draft } = await negativeNetDraft();
    const approved = actor === 'system'
      ? await (await import('../backend/src/modules/finance/settlement-auto-approval.service.js'))
        .approveSettlementDraftInternally({ settlementApprovalId: draft.id, expectedVendorId: f.vendorId })
      : await approval.approveSettlementApproval(draft.id, 'negative-net-test-admin');
    expect(approved.status).toBe('approved');
    expect(await db.settlementApproval.findUniqueOrThrow({ where: { id: draft.id } })).toMatchObject({
      approvedBy: actor === 'system' ? 'system:settlement_auto_approval' : 'negative-net-test-admin',
      netPayableMinor: -880,
    });
    expect(await db.payoutBatch.count({ where: { vendorId: f.vendorId } })).toBe(0);
  });

  it.each([
    'grossSalesMinor', 'refundTotalMinor', 'commissionMinor', 'commissionVatMinor', 'netPayableMinor',
  ] as const)('rejects a %s mismatch for a negative-net REFUND DRAFT', async (field) => {
    const { f, draft } = await negativeNetDraft();
    const before = await db.settlementApproval.findUniqueOrThrow({ where: { id: draft.id },
      include: { lines: true } });
    await db.settlementApproval.update({ where: { id: draft.id }, data: { [field]: before[field] + 1 } });
    await expect(approval.approveSettlementApproval(draft.id, 'negative-net-test-admin'))
      .rejects.toThrow(`Settlement approval monetary totals are inconsistent: ${field}.`);
    const after = await db.settlementApproval.findUniqueOrThrow({ where: { id: draft.id },
      include: { lines: true } });
    expect(after).toMatchObject({ status: 'DRAFT', approvedBy: null, approvedAt: null });
    expect(after[field]).toBe(before[field] + 1);
    expect(after.lines).toEqual(before.lines);
    expect(await db.payoutBatch.count({ where: { vendorId: f.vendorId } })).toBe(0);
    expect(await db.settlementRefundAdjustment.count({ where: { vendorId: f.vendorId } })).toBe(0);
  });

  it('R-1: an approved SALE with a pending accepted-refund adjustment has no standalone payout', async () => {
    const f = await fixture();
    afterRunDate(f.runDate);
    const first = await schedule.createSettlementScheduleDrafts({ runDate: f.runDateKey, vendorId: f.vendorId,
      confirmAutoSettlementDrafts: true });
    expect(first.summary.created).toBe(1);
    const approvalAId = first.createdDrafts[0].settlementApprovalId;
    await approval.approveSettlementApproval(approvalAId, `${f.vendorId}-approver`);
    const accepted = await ingestAcceptedTestRefund({ ...f, originalId: approvalAId }, 'r1-hold', '10.00');
    const adjustment = await db.settlementRefundAdjustment.findUniqueOrThrow({ where: {
      refundFinanceLedgerEntryId: accepted.refundFinanceLedgerEntryId,
    } });
    expect(adjustment).toMatchObject({ originalSettlementApprovalId: approvalAId,
      refundRecordId: accepted.refundRecordId, vendorId: f.vendorId, status: 'PENDING',
      originalAmountMinor: 880, appliedAmountMinor: 0, remainingAmountMinor: 880 });
    expect(await db.settlementApprovalLine.findMany({ where: { settlementApprovalId: approvalAId },
      select: { financeLedgerEntryId: true } })).toEqual([{ financeLedgerEntryId: f.ledgerId }]);
    const { preparePayoutBatch } = await import('../backend/src/modules/finance/finance.service.js');
    await expect(preparePayoutBatch({ vendorId: f.vendorId }, `${f.vendorId}-admin`))
      .rejects.toThrow('Refund after settlement approval requires adjustment before payout');
    expect(await db.payoutBatch.count({ where: { vendorId: f.vendorId } })).toBe(0);
    expect(await db.settlementRefundAdjustment.findUniqueOrThrow({ where: { id: adjustment.id } }))
      .toMatchObject({ status: 'PENDING', appliedAmountMinor: 0, remainingAmountMinor: 880 });
    expect(await db.vendorBalanceEvent.count({ where: { financeLedgerEntryId: accepted.refundFinanceLedgerEntryId,
      type: 'VENDOR_DEBT_CREATED' } })).toBe(0);
  });

  it('R-1: unrelated approved B can progress to PAID while A refund remains pending, then C applies it once', async () => {
    const f = await fixture();
    afterRunDate(f.runDate);
    const first = await schedule.createSettlementScheduleDrafts({ runDate: f.runDateKey, vendorId: f.vendorId,
      confirmAutoSettlementDrafts: true });
    expect(first.summary.created).toBe(1);
    const approvalAId = first.createdDrafts[0].settlementApprovalId;
    await approval.approveSettlementApproval(approvalAId, `${f.vendorId}-approver`);
    const saleBId = await addEligiblePostCutoffSale(f, '100.00');
    const draftB = await approval.createDraftApproval({ vendorId: f.vendorId });
    expect(draftB.lines.map((line) => line.financeLedgerEntryId)).toEqual([saleBId]);
    await approval.approveSettlementApproval(draftB.id, `${f.vendorId}-approver`);

    const accepted = await ingestAcceptedTestRefund({ ...f, originalId: approvalAId }, 'r1-cross-approval', '10.00');
    const refundLedgerId = accepted.refundFinanceLedgerEntryId;
    const adjustment = await db.settlementRefundAdjustment.findUniqueOrThrow({ where: {
      refundFinanceLedgerEntryId: refundLedgerId,
    } });
    expect(adjustment).toMatchObject({ originalSettlementApprovalId: approvalAId,
      refundRecordId: accepted.refundRecordId, status: 'PENDING', originalAmountMinor: 880,
      appliedAmountMinor: 0, remainingAmountMinor: 880 });
    const { preparePayoutBatch, markPayoutBatchReview, markPayoutBatchPaid } =
      await import('../backend/src/modules/finance/finance.service.js');
    const payoutB = await preparePayoutBatch({ vendorId: f.vendorId }, `${f.vendorId}-admin`);
    expect(payoutB.status).toBe('draft');
    expect(payoutB.netAmount).toBe('88.00');
    expect(payoutB.lines.map((line) => [line.financeLedgerEntryId, line.amountSnapshot]))
      .toEqual([[saleBId, '88.00']]);
    expect(await db.payoutBatchLine.findMany({ where: { payoutBatchId: payoutB.id },
      select: { settlementApprovalLine: { select: { settlementApprovalId: true } } } }))
      .toEqual([{ settlementApprovalLine: { settlementApprovalId: draftB.id } }]);
    expect(await db.settlementRefundAdjustment.findUniqueOrThrow({ where: { id: adjustment.id } }))
      .toMatchObject({ status: 'PENDING', appliedAmountMinor: 0, remainingAmountMinor: 880 });
    expect(await db.vendorBalanceEvent.count({ where: { financeLedgerEntryId: refundLedgerId,
      type: 'VENDOR_DEBT_CREATED' } })).toBe(0);

    const reviewed = await markPayoutBatchReview(payoutB.id);
    expect(reviewed.status).toBe('review');
    const paid = await markPayoutBatchPaid(payoutB.id, {
      paidAt: new Date().toISOString(), paymentReference: `${f.vendorId}-synthetic-manual-eft`,
    }, `${f.vendorId}-admin`);
    expect(paid.status).toBe('paid');
    expect(paid.netAmount).toBe('88.00');
    expect(await db.settlementRefundAdjustment.findUniqueOrThrow({ where: { id: adjustment.id } }))
      .toMatchObject({ status: 'PENDING', appliedAmountMinor: 0, remainingAmountMinor: 880 });
    expect(await db.settlementRefundAdjustmentApplication.count({ where: {
      settlementRefundAdjustmentId: adjustment.id, status: 'ACTIVE',
    } })).toBe(0);
    expect(await db.vendorBalanceEvent.count({ where: { vendorId: f.vendorId } })).toBe(0);

    const saleCId = await addEligiblePostCutoffSale(f, '100.00', 'later-sale-c');
    const draftC = await approval.createDraftApproval({ vendorId: f.vendorId });
    expect(draftC.lines.map((line) => [line.financeLedgerEntryId, line.lineType]))
      .toEqual(expect.arrayContaining([[saleCId, 'SALE'], [refundLedgerId, 'REFUND_ADJUSTMENT']]));
    const adjustmentLines = draftC.lines.filter((line) => line.financeLedgerEntryId === refundLedgerId);
    expect(adjustmentLines).toHaveLength(1);
    expect(adjustmentLines[0].payableImpactMinor).toBe(-880);
    expect(draftC.netPayableMinor).toBe(7920);
    await approval.approveSettlementApproval(draftC.id, `${f.vendorId}-approver`);
    expect(await db.settlementRefundAdjustment.findUniqueOrThrow({ where: { id: adjustment.id } }))
      .toMatchObject({ status: 'APPLIED', originalAmountMinor: 880,
        appliedAmountMinor: 880, remainingAmountMinor: 0 });
    expect(await db.settlementRefundAdjustmentApplication.count({ where: {
      settlementRefundAdjustmentId: adjustment.id, status: 'ACTIVE',
    } })).toBe(1);
    expect((await approval.previewApproval(f.vendorId)).pendingRefundAdjustments.pendingAdjustmentCount).toBe(0);
    expect(await db.payoutBatch.findUniqueOrThrow({ where: { id: payoutB.id } }))
      .toMatchObject({ status: 'PAID', netAmount: expect.anything() });
  });

  it('R-1: payout B smaller than the outstanding refund does not consume its adjustment', async () => {
    const f = await fixture();
    afterRunDate(f.runDate);
    const first = await schedule.createSettlementScheduleDrafts({ runDate: f.runDateKey, vendorId: f.vendorId,
      confirmAutoSettlementDrafts: true });
    expect(first.summary.created).toBe(1);
    const approvalAId = first.createdDrafts[0].settlementApprovalId;
    await approval.approveSettlementApproval(approvalAId, `${f.vendorId}-approver`);
    const saleBId = await addEligiblePostCutoffSale(f, '5.00');
    const draftB = await approval.createDraftApproval({ vendorId: f.vendorId });
    expect(draftB.lines.map((line) => line.financeLedgerEntryId)).toEqual([saleBId]);
    await approval.approveSettlementApproval(draftB.id, `${f.vendorId}-approver`);
    const accepted = await ingestAcceptedTestRefund({ ...f, originalId: approvalAId }, 'r1-small-b', '10.00');
    const adjustment = await db.settlementRefundAdjustment.findUniqueOrThrow({ where: {
      refundFinanceLedgerEntryId: accepted.refundFinanceLedgerEntryId,
    } });
    const { preparePayoutBatch, markPayoutBatchReview } =
      await import('../backend/src/modules/finance/finance.service.js');
    const payoutB = await preparePayoutBatch({ vendorId: f.vendorId }, `${f.vendorId}-admin`);
    expect(payoutB.lines.map((line) => line.financeLedgerEntryId)).toEqual([saleBId]);
    expect(payoutB.netAmount).toBe('4.40');
    expect(await db.payoutBatchLine.count({ where: { payoutBatchId: payoutB.id,
      financeLedgerEntryId: accepted.refundFinanceLedgerEntryId } })).toBe(0);
    expect(await markPayoutBatchReview(payoutB.id)).toMatchObject({ status: 'review' });
    expect(await db.settlementRefundAdjustment.findUniqueOrThrow({ where: { id: adjustment.id } }))
      .toMatchObject({ status: 'PENDING', originalAmountMinor: 880,
        appliedAmountMinor: 0, remainingAmountMinor: 880 });
    expect(await db.vendorBalanceEvent.count({ where: { financeLedgerEntryId: accepted.refundFinanceLedgerEntryId,
      type: 'VENDOR_DEBT_CREATED' } })).toBe(0);
  });

  it('2D: refund accepted after replacement DRAFT blocks approval without losing its identity', async () => {
    const f = await cancelledFixture();
    const request = await replacementRequest(f, 'refund-after-replacement-draft');
    const created = await replacementWriter.createControlledSettlementReplacementDraft(request);
    vi.setSystemTime(new Date(f.periodEnd.getTime() + dayMs));
    const evidence = await ingestAcceptedTestRefund(f, 'after-replacement-draft', '10.00');
    await expect(approval.approveSettlementApproval(created.replacementSettlementApprovalId,
      `${f.vendorId}-approver`)).rejects.toThrow();
    expect(await db.settlementApproval.findUniqueOrThrow({
      where: { id: created.replacementSettlementApprovalId },
    })).toMatchObject({ status: 'DRAFT' });
    expect(await db.refundEvidenceSnapshot.findUniqueOrThrow({ where: {
      refundFinanceLedgerEntryId: evidence.refundFinanceLedgerEntryId,
    } })).toMatchObject({ refundRecordId: evidence.refundRecordId,
      historicalSaleFinanceLedgerEntryId: f.ledgerId, historicalEconomicVendorId: f.vendorId });
    expect(await db.settlementRefundAdjustment.count({ where: {
      refundFinanceLedgerEntryId: evidence.refundFinanceLedgerEntryId,
    } })).toBe(0);
    expect(await db.payoutBatch.count({ where: { vendorId: f.vendorId } })).toBe(0);
  });

  it.each(['admin', 'system'] as const)(
    '2D: adjustment write failure rolls back %s replacement approval and can be retried', async (actor) => {
    const f = await cancelledFixture();
    vi.setSystemTime(new Date(f.periodEnd.getTime() + dayMs));
    const evidence = await ingestAcceptedTestRefund(f, 'approval-rollback', '10.00');
    const request = await replacementRequest(f, 'approval-rollback');
    const created = await replacementWriter.createControlledSettlementReplacementDraft(request);
    await db.$executeRawUnsafe(`CREATE FUNCTION fin_bug_002_adjustment_failure() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'TEST_ADJUSTMENT_WRITE_FAILURE'; END $$`);
    await db.$executeRawUnsafe(`CREATE TRIGGER fin_bug_002_adjustment_failure
      BEFORE INSERT ON "SettlementRefundAdjustment" FOR EACH ROW
      EXECUTE FUNCTION fin_bug_002_adjustment_failure()`);
    const internal = await import('../backend/src/modules/finance/settlement-auto-approval.service.js');
    const failedAttemptId = `${created.replacementSettlementApprovalId}-failed-attempt`;
    try {
      const operation = actor === 'system' ? internal.approveSettlementDraftInternally({
        settlementApprovalId: created.replacementSettlementApprovalId,
        expectedVendorId: f.vendorId, attemptId: failedAttemptId,
      }) : approval.approveSettlementApproval(created.replacementSettlementApprovalId, `${f.vendorId}-approver`);
      await expect(operation).rejects.toThrow('TEST_ADJUSTMENT_WRITE_FAILURE');
    } finally {
      await db.$executeRawUnsafe('DROP TRIGGER fin_bug_002_adjustment_failure ON "SettlementRefundAdjustment"');
      await db.$executeRawUnsafe('DROP FUNCTION fin_bug_002_adjustment_failure()');
    }
    expect(await db.settlementApproval.findUniqueOrThrow({ where: {
      id: created.replacementSettlementApprovalId,
    } })).toMatchObject({ status: 'DRAFT', approvedAt: null });
    expect(await db.settlementRefundAdjustment.count({ where: {
      refundFinanceLedgerEntryId: evidence.refundFinanceLedgerEntryId,
    } })).toBe(0);
    if (actor === 'system') {
      expect(await db.settlementAutoApprovalAttempt.findUniqueOrThrow({ where: { id: failedAttemptId } }))
        .toMatchObject({ outcome: 'TECHNICAL_FAILURE' });
      expect(await db.settlementAutoApprovalAttemptEvent.count({ where: {
        attemptId: failedAttemptId, outcome: 'APPROVED',
      } })).toBe(0);
      await internal.approveSettlementDraftInternally({
        settlementApprovalId: created.replacementSettlementApprovalId, expectedVendorId: f.vendorId,
        attemptId: `${created.replacementSettlementApprovalId}-retry-attempt`,
      });
    } else {
      await approval.approveSettlementApproval(created.replacementSettlementApprovalId, `${f.vendorId}-approver`);
    }
    expect(await db.settlementApproval.findUniqueOrThrow({ where: {
      id: created.replacementSettlementApprovalId,
    } })).toMatchObject({ status: 'APPROVED' });
    expect(await db.settlementRefundAdjustment.count({ where: {
      refundFinanceLedgerEntryId: evidence.refundFinanceLedgerEntryId,
    } })).toBe(1);
  });

  it('2D: concurrent refund ingestion and replacement cannot approve an omitted liability', async () => {
    const f = await cancelledFixture();
    vi.setSystemTime(new Date(f.periodEnd.getTime() + dayMs));
    const request = await replacementRequest(f, 'concurrent-refund');
    const held = await holdVendorLock(f.vendorId);
    const ingestAttempt = ingestAcceptedTestRefund(f, 'concurrent-refund', '10.00');
    const replacementAttempt = replacementWriter.createControlledSettlementReplacementDraft(request);
    try {
      await waitForCancellationLockWaits(2);
    } finally {
      await held.release();
    }
    const [ingestResult, replacementResult] = await Promise.allSettled([ingestAttempt, replacementAttempt]);
    expect(ingestResult.status).toBe('fulfilled');
    if (ingestResult.status !== 'fulfilled') return;
    const evidence = ingestResult.value;
    expect(await db.refundEvidenceSnapshot.count({ where: {
      refundFinanceLedgerEntryId: evidence.refundFinanceLedgerEntryId,
    } })).toBe(1);
    if (replacementResult.status === 'fulfilled') {
      const row = await db.settlementApproval.findUniqueOrThrow({
        where: { id: replacementResult.value.replacementSettlementApprovalId },
      });
      const frozen = row.sourceSnapshotJson as { lateRefundLedgerIds?: string[] };
      if (frozen.lateRefundLedgerIds?.includes(evidence.refundFinanceLedgerEntryId)) {
        await approval.approveSettlementApproval(row.id, `${f.vendorId}-approver`);
        expect(await db.settlementRefundAdjustment.count({ where: {
          refundFinanceLedgerEntryId: evidence.refundFinanceLedgerEntryId,
        } })).toBe(1);
      } else {
        await expect(approval.approveSettlementApproval(row.id, `${f.vendorId}-approver`)).rejects.toThrow();
        expect(await db.settlementRefundAdjustment.count({ where: {
          refundFinanceLedgerEntryId: evidence.refundFinanceLedgerEntryId,
        } })).toBe(0);
      }
    } else {
      expect(await db.settlementApproval.count({ where: { replacesSettlementApprovalId: f.originalId } })).toBe(0);
    }
    expect(await db.payoutBatch.count({ where: { vendorId: f.vendorId } })).toBe(0);
  });

  it('2D: concurrent refund ingestion and replacement approval cannot omit an accepted refund', async () => {
    const f = await cancelledFixture();
    const request = await replacementRequest(f, 'concurrent-approval-refund');
    const created = await replacementWriter.createControlledSettlementReplacementDraft(request);
    vi.setSystemTime(new Date(f.periodEnd.getTime() + dayMs));
    const held = await holdVendorLock(f.vendorId);
    const ingestAttempt = ingestAcceptedTestRefund(f, 'concurrent-approval-refund', '10.00');
    const approvalAttempt = approval.approveSettlementApproval(created.replacementSettlementApprovalId,
      `${f.vendorId}-approver`);
    try {
      await waitForCancellationLockWaits(2);
    } finally {
      await held.release();
    }
    const [ingestResult, approvalResult] = await Promise.allSettled([ingestAttempt, approvalAttempt]);
    expect(ingestResult.status).toBe('fulfilled');
    if (ingestResult.status !== 'fulfilled') return;
    const evidence = ingestResult.value;
    const row = await db.settlementApproval.findUniqueOrThrow({ where: {
      id: created.replacementSettlementApprovalId,
    } });
    if (approvalResult.status === 'fulfilled') {
      expect(row.status).toBe('APPROVED');
      expect(await db.settlementRefundAdjustment.findUniqueOrThrow({ where: {
        refundFinanceLedgerEntryId: evidence.refundFinanceLedgerEntryId,
      } })).toMatchObject({ refundRecordId: evidence.refundRecordId,
        originalSettlementApprovalId: row.id, status: 'PENDING' });
    } else {
      expect(row.status).toBe('DRAFT');
      expect(await db.settlementRefundAdjustment.count({ where: {
        refundFinanceLedgerEntryId: evidence.refundFinanceLedgerEntryId,
      } })).toBe(0);
    }
    expect(await db.payoutBatch.count({ where: { vendorId: f.vendorId } })).toBe(0);
  });

  it('2C1-C: a refund ledger without accepted evidence cannot borrow a sibling identity', async () => {
    const f = await cancelledFixture();
    vi.setSystemTime(new Date(f.periodEnd.getTime() + dayMs));
    const accepted = await ingestAcceptedTestRefund(f, 'accepted-sibling', '10.00');
    const legacyLedgerId = `${f.vendorId}-legacy-refund-without-evidence`;
    await db.financeLedgerEntry.create({ data: {
      id: legacyLedgerId, vendorId: f.vendorId, vendorAllocationId: f.allocationId,
      entryType: 'refund', amount: '5.00', payoutStatus: 'PENDING', settlementStatus: 'PENDING',
      commissionPercentSnapshot: '10.00', commissionVatPercentSnapshot: '20.00',
    } });
    const settlementPreview = await approval.previewApproval(f.vendorId);
    expect(settlementPreview.lines.map((line) => line.financeLedgerEntryId)).toContain(accepted.refundFinanceLedgerEntryId);
    expect(settlementPreview.lines.map((line) => line.financeLedgerEntryId)).not.toContain(legacyLedgerId);
    const { previewRefundAdjustmentEligibility, backfillPendingRefundAdjustments } = await import(
      '../backend/src/modules/finance/settlement-refund-adjustment-eligibility-diagnostics.service.js'
    );
    const preview = await previewRefundAdjustmentEligibility({ vendorId: f.vendorId });
    const acceptedRecord = preview.records.find((item) => item.refundFinanceLedgerEntryId === accepted.refundFinanceLedgerEntryId);
    const missingRecord = preview.records.find((item) => item.refundFinanceLedgerEntryId === legacyLedgerId);
    expect(acceptedRecord?.refundRecordId).toBe(accepted.refundRecordId);
    expect(missingRecord).toMatchObject({ refundRecordId: null, vendorId: f.vendorId });
    expect(missingRecord?.recommendedAction).not.toBe('CREATE_PENDING_ADJUSTMENT');
    const backfill = await backfillPendingRefundAdjustments({ vendorId: f.vendorId });
    expect(backfill.writesPerformed).toBe(false);
    expect(backfill.createdRecords).toEqual([]);
    expect(await db.settlementRefundAdjustment.count({ where: { refundFinanceLedgerEntryId: legacyLedgerId } })).toBe(0);
    const { getVendorFinanceDashboard } = await import('../backend/src/modules/finance/finance.service.js');
    const dashboard = await getVendorFinanceDashboard(f.vendorId);
    expect(dashboard.records.find((record) => record.id === legacyLedgerId)).toMatchObject({
      relatedRefundId: null,
      settlement: { status: 'held', payoutReady: false },
    });
    expect(dashboard.records.find((record) => record.id === f.ledgerId)?.settlement.status).toBe('held');
  });

  it('2C1-D: a later accepted sibling cannot inherit an earlier approved REFUND representation', async () => {
    const f = await cancelledFixture();
    vi.setSystemTime(new Date(f.periodEnd.getTime() + dayMs));
    const first = await ingestAcceptedTestRefund(f, 'direct-before-approval', '10.00');
    const draft = await approval.createDraftApproval({ vendorId: f.vendorId });
    expect(draft.lines.map((line) => line.financeLedgerEntryId)).toEqual(expect.arrayContaining([
      f.ledgerId, first.refundFinanceLedgerEntryId,
    ]));
    await approval.approveSettlementApproval(draft.id, `${f.vendorId}-approver`);
    const second = await ingestAcceptedTestRefund(f, 'after-approval', '15.00');
    const secondAdjustment = await db.settlementRefundAdjustment.findUnique({ where: {
      refundFinanceLedgerEntryId: second.refundFinanceLedgerEntryId,
    } });
    expect(secondAdjustment).toMatchObject({ refundRecordId: second.refundRecordId, status: 'PENDING' });
    const { getVendorFinanceDashboard, preparePayoutBatch } = await import('../backend/src/modules/finance/finance.service.js');
    const dashboard = await getVendorFinanceDashboard(f.vendorId);
    const sale = dashboard.records.find((record) => record.id === f.ledgerId);
    expect(sale?.settlement.status).toBe('held');
    expect(sale?.settlement.payoutReady).toBe(false);
    expect(sale?.settlement.holdReason).toContain('Refund after settlement approval requires adjustment');
    await expect(preparePayoutBatch({ vendorId: f.vendorId }, `${f.vendorId}-admin`)).rejects.toThrow();
    expect(await db.payoutBatch.count({ where: { vendorId: f.vendorId } })).toBe(0);
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
    const { getVendorFinanceDashboard } = await import('../backend/src/modules/finance/finance.service.js');
    const dashboard = await getVendorFinanceDashboard(f.vendorId);
    expect(dashboard.records.find((record) => record.id === f.ledgerId)?.settlement).toMatchObject({
      status: 'held', payoutReady: false,
    });
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

  it('2C1-D: fully applied and approved exact adjustment has no pending remainder', async () => {
    const f = await cancelledFixture();
    const manual = await approval.createDraftApproval({ vendorId: f.vendorId });
    await approval.approveSettlementApproval(manual.id, `${f.vendorId}-approver`);
    vi.setSystemTime(new Date(f.periodEnd.getTime() + dayMs));
    const evidence = await ingestAcceptedTestRefund(f, 'fully-applied', '20.00');
    await addEligiblePostCutoffSale(f, '30.00');
    const laterDraft = await approval.createDraftApproval({ vendorId: f.vendorId });
    const adjustment = await db.settlementRefundAdjustment.findUniqueOrThrow({ where: {
      refundFinanceLedgerEntryId: evidence.refundFinanceLedgerEntryId,
    } });
    expect(adjustment).toMatchObject({ status: 'APPLIED', originalAmountMinor: 1760,
      appliedAmountMinor: 1760, remainingAmountMinor: 0 });
    await approval.approveSettlementApproval(laterDraft.id, `${f.vendorId}-approver`);
    const { getVendorFinanceDashboard } = await import('../backend/src/modules/finance/finance.service.js');
    const dashboard = await getVendorFinanceDashboard(f.vendorId);
    expect(dashboard.records.find((record) => record.id === f.ledgerId)?.settlement.status)
      .not.toBe('held');
    expect(await db.settlementRefundAdjustment.findUniqueOrThrow({ where: { id: adjustment.id } }))
      .toMatchObject({ status: 'APPLIED', remainingAmountMinor: 0 });
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
    const request = await replacementRequest(f, 'terminal-refund-conflict');
    await expect(replacementWriter.createControlledSettlementReplacementDraft(request))
      .rejects.toMatchObject({ assessment: { outcome: 'BLOCKED' } });
    expect(await db.settlementApproval.count({ where: { replacesSettlementApprovalId: f.originalId } })).toBe(0);
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

  it('2D: a verified post-cutoff refund is frozen outside the controlled replacement', async () => {
    const f = await cancelledFixture();
    const request = await replacementRequest(f, 'late-refund');
    vi.setSystemTime(new Date(f.periodEnd.getTime() + dayMs));
    const evidence = await ingestAcceptedTestRefund(f, 'writer-late', '10.00');
    const created = await replacementWriter.createControlledSettlementReplacementDraft(request);
    expect(created).toMatchObject({ outcome: 'CREATED', status: 'DRAFT' });
    const replacementRow = await db.settlementApproval.findUniqueOrThrow({
      where: { id: created.replacementSettlementApprovalId }, include: { lines: true },
    });
    expect(replacementRow.lines.map((line) => line.financeLedgerEntryId)).toEqual([f.ledgerId]);
    expect(replacementRow.periodEnd).toEqual(f.periodEnd);
    expect(await db.settlementRefundAdjustment.count({ where: {
      refundFinanceLedgerEntryId: evidence.refundFinanceLedgerEntryId,
    } })).toBe(0);
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

  it('2E: cancellation preserves S1 and sources while ordinary scheduling blocks the reserved key', async () => {
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
    expect(preview.vendors[0]).toMatchObject({ state: 'BLOCKED', canCreateDraft: false,
      scheduledCycleKey: f.cycleKey, eligibleLineCount: 1, netPayableMinor: 17600,
      existingSettlementApprovalId: s1Id, existingSettlementApprovalStatus: 'cancelled' });
    expect(preview.vendors[0].blockedReason).toContain('requires controlled replacement');
    expect(preview.vendors[0].preview?.lines.map((line) => line.financeLedgerEntryId)).toEqual([f.ledgerId]);
    expect(await db.settlementApprovalLine.count({ where: { financeLedgerEntryId: f.ledgerId,
      settlementApproval: { status: { in: ['DRAFT', 'APPROVED'] } } } })).toBe(0);

    const result = await schedule.createSettlementScheduleDrafts({ runDate: f.runDateKey, vendorId: f.vendorId,
      confirmAutoSettlementDrafts: true });
    expect(result).toMatchObject({ writesPerformed: false, summary: { created: 0, failed: 0, skipped: 1 } });
    expect(result.skipped).toEqual([{ vendorId: f.vendorId, reason: preview.vendors[0].blockedReason }]);
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

  it('2E: a linked controlled replacement remains visible without reopening ordinary scheduling', async () => {
    const f = await cancelledFixture();
    const request = await replacementRequest(f, 'schedule-lineage');
    const created = await replacementWriter.createControlledSettlementReplacementDraft(request);
    expect(created.outcome).toBe('CREATED');
    const replacementRow = await db.settlementApproval.findUniqueOrThrow({ where: {
      id: created.replacementSettlementApprovalId,
    } });
    expect(replacementRow).toMatchObject({ status: 'DRAFT', scheduledCycleKey: null,
      replacesSettlementApprovalId: f.originalId });

    const draftPreview = await schedule.getSettlementScheduleDryRun({ runDate: f.runDateKey, vendorId: f.vendorId });
    expect(draftPreview.vendors[0]).toMatchObject({ state: 'BLOCKED', canCreateDraft: false,
      existingSettlementApprovalId: f.originalId, existingSettlementApprovalStatus: 'cancelled' });
    expect(draftPreview.vendors[0].blockedReason)
      .toContain(`linked replacement DRAFT (${replacementRow.id})`);
    await approval.approveSettlementApproval(replacementRow.id, `${f.vendorId}-approver`);
    const approvedPreview = await schedule.getSettlementScheduleDryRun({ runDate: f.runDateKey, vendorId: f.vendorId });
    expect(approvedPreview.vendors[0]).toMatchObject({ state: 'BLOCKED', canCreateDraft: false,
      existingSettlementApprovalId: f.originalId, existingSettlementApprovalStatus: 'cancelled' });
    expect(approvedPreview.vendors[0].blockedReason)
      .toContain(`linked replacement APPROVED (${replacementRow.id})`);
    const ordinary = await schedule.createSettlementScheduleDrafts({ runDate: f.runDateKey,
      vendorId: f.vendorId, confirmAutoSettlementDrafts: true });
    expect(ordinary).toMatchObject({ writesPerformed: false,
      summary: { created: 0, skipped: 1, failed: 0 } });
    expect(await db.settlementApproval.count({ where: { replacesSettlementApprovalId: f.originalId } })).toBe(1);
    expect(await db.settlementApproval.findUniqueOrThrow({ where: { id: f.originalId } }))
      .toMatchObject({ status: 'CANCELLED', scheduledCycleKey: f.cycleKey });
  });

  it('2F: real Admin HTTP assessment and confirmed creation preserve history, ownership and replay', async () => {
    const f = await cancelledFixture();
    const concurrent = await cancelledFixture();
    const before = await financeWriteFootprint(f.vendorId);
    const { hashPasswordArgon2id } = await import('../backend/src/modules/auth/password-hashing.js');
    process.env.SETTLEMENT_AUTO_DRAFT_SCHEDULER_ENABLED = 'false';
    process.env.SHIPPING_PROVIDER = 'kargonomi';
    process.env.KARGONOMI_BASE_URL = 'http://127.0.0.1:1';
    process.env.KARGONOMI_API_TOKEN = 'disposable-http-test-only';
    const password = `${f.vendorId}-http-password`;
    const passwordHash = await hashPasswordArgon2id(password);
    const adminId = `${f.vendorId}-http-admin`;
    const vendorUserId = `${f.vendorId}-http-vendor`;
    await db.user.createMany({ data: [
      { id: adminId, email: `${adminId}@example.test`, name: 'Replacement HTTP Admin', role: 'ADMIN', passwordHash },
      { id: vendorUserId, email: `${vendorUserId}@example.test`, name: 'Replacement HTTP Vendor', role: 'VENDOR', passwordHash },
    ] });
    const { createApp } = await import('../backend/src/app.js');
    const app = createApp();
    const origin = await app.listen({ host: '127.0.0.1', port: 0 });
    async function login(email: string) {
      const response = await fetch(`${origin}/auth/login`, { method: 'POST',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
      expect(response.status).toBe(200);
      const body = await response.json() as { csrfToken: string };
      const cookie = response.headers.get('set-cookie')?.split(';', 1)[0];
      expect(cookie).toBeTruthy();
      return { cookie: cookie!, csrf: body.csrfToken };
    }
    const path = `/admin/finance/settlement-approvals/${encodeURIComponent(f.originalId)}`;
    try {
      const admin = await login(`${adminId}@example.test`);
      const vendor = await login(`${vendorUserId}@example.test`);
      const assessmentPath = `${origin}${path}/replacement-assessment?vendorId=${encodeURIComponent(f.vendorId)}`;
      const createPath = `${origin}${path}/replacement-draft`;
      expect((await fetch(assessmentPath)).status).toBe(401);
      expect((await fetch(createPath, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ vendorId: f.vendorId }) })).status).toBe(401);
      const vendorRead = await fetch(assessmentPath, { headers: { cookie: vendor.cookie } });
      expect(vendorRead.status).toBe(403);
      const vendorWrite = await fetch(createPath, { method: 'POST', headers: {
        cookie: vendor.cookie, 'x-csrf-token': vendor.csrf, 'content-type': 'application/json',
      }, body: JSON.stringify({ vendorId: f.vendorId, requestId: `${f.vendorId}-http-request`,
        reason: 'Verified test sources', confirmCreateReplacementDraft: true }) });
      expect(vendorWrite.status).toBe(403);
      const assessmentResponse = await fetch(assessmentPath, { headers: { cookie: admin.cookie } });
      expect(assessmentResponse.status).toBe(200);
      expect(await assessmentResponse.json()).toMatchObject({ outcome: 'ELIGIBLE', writesPerformed: false,
        vendorId: f.vendorId, originalCutoff: f.periodEnd.toISOString(), existingReplacement: null });
      expect(await financeWriteFootprint(f.vendorId)).toEqual(before);
      const headers = { cookie: admin.cookie, 'x-csrf-token': admin.csrf, 'content-type': 'application/json' };
      for (const input of [
        { vendorId: f.vendorId, requestId: `${f.vendorId}-missing-reason`, confirmCreateReplacementDraft: true },
        { vendorId: f.vendorId, requestId: `${f.vendorId}-missing-confirm`, reason: 'Verified test sources' },
      ]) {
        const invalid = await fetch(createPath, { method: 'POST', headers, body: JSON.stringify(input) });
        expect(invalid.status).toBe(400);
      }
      const wrongVendor = await fetch(`${origin}${path}/replacement-assessment?vendorId=another-vendor`,
        { headers: { cookie: admin.cookie } });
      expect(wrongVendor.status).toBe(404);
      expect((await fetch(createPath, { method: 'POST', headers,
        body: JSON.stringify({ vendorId: 'another-vendor', requestId: `${f.vendorId}-wrong-vendor`,
          reason: 'Wrong vendor must fail', confirmCreateReplacementDraft: true }) })).status).toBe(404);
      expect(await financeWriteFootprint(f.vendorId)).toEqual(before);
      const requestId = `${f.vendorId}-http-request`;
      const body = { vendorId: f.vendorId, requestId, reason: 'Verified test sources', confirmCreateReplacementDraft: true };
      const createdResponse = await fetch(createPath, { method: 'POST', headers, body: JSON.stringify(body) });
      expect(createdResponse.status).toBe(200);
      const created = await createdResponse.json() as { outcome: string; replacementSettlementApprovalId: string };
      expect(created.outcome).toBe('CREATED');
      const replacementRow = await db.settlementApproval.findUniqueOrThrow({ where: { id: created.replacementSettlementApprovalId } });
      expect(replacementRow).toMatchObject({ vendorId: f.vendorId, status: 'DRAFT',
        replacesSettlementApprovalId: f.originalId, replacementRequestId: requestId,
        replacementRequestedBy: adminId, replacementReason: body.reason, scheduledCycleKey: null,
        periodEnd: f.periodEnd });
      const originalRow = await db.settlementApproval.findUniqueOrThrow({ where: { id: f.originalId } });
      expect(replacementRow.netPayableMinor).toBe(originalRow.netPayableMinor);
      expect((await db.settlementApprovalLine.findMany({ where: { settlementApprovalId: replacementRow.id },
        select: { financeLedgerEntryId: true } })).map((line) => line.financeLedgerEntryId)).toEqual([f.ledgerId]);
      expect(originalRow)
        .toMatchObject({ status: 'CANCELLED', scheduledCycleKey: f.cycleKey });
      expect(await db.payoutBatch.count({ where: { vendorId: f.vendorId } })).toBe(0);
      const replay = await fetch(createPath, { method: 'POST', headers, body: JSON.stringify(body) });
      expect(replay.status).toBe(200);
      expect(await replay.json()).toMatchObject({ outcome: 'REPLAYED', writesPerformed: false,
        replacementSettlementApprovalId: replacementRow.id });
      expect(await db.settlementApproval.count({ where: { replacesSettlementApprovalId: f.originalId } })).toBe(1);
      const afterResponse = await fetch(assessmentPath, { headers: { cookie: admin.cookie } });
      expect(await afterResponse.json()).toMatchObject({ outcome: 'BLOCKED',
        existingReplacement: { id: replacementRow.id, status: 'DRAFT', replacementRequestId: requestId } });
      const anotherRequest = await fetch(createPath, { method: 'POST', headers, body: JSON.stringify({
        ...body, requestId: `${requestId}-different`,
      }) });
      expect(anotherRequest.status).toBe(409);
      const concurrentPath = `${origin}/admin/finance/settlement-approvals/${encodeURIComponent(concurrent.originalId)}/replacement-draft`;
      const concurrentResults = await Promise.all(['first', 'second'].map((suffix) => fetch(concurrentPath, {
        method: 'POST', headers, body: JSON.stringify({ vendorId: concurrent.vendorId,
          requestId: `${concurrent.vendorId}-${suffix}`, reason: 'Concurrent Admin test',
          confirmCreateReplacementDraft: true }),
      })));
      expect(concurrentResults.map((response) => response.status).sort()).toEqual([200, 409]);
      expect(await db.settlementApproval.count({ where: { replacesSettlementApprovalId: concurrent.originalId } })).toBe(1);
      expect(await db.settlementApproval.findUniqueOrThrow({ where: { id: concurrent.originalId } }))
        .toMatchObject({ status: 'CANCELLED', scheduledCycleKey: concurrent.cycleKey });
      expect(await db.payoutBatch.count({ where: { vendorId: concurrent.vendorId } })).toBe(0);
      await db.user.update({ where: { id: adminId }, data: { status: 'inactive' } });
      expect((await fetch(assessmentPath, { headers: { cookie: admin.cookie } })).status).toBe(401);
    } finally {
      await app.close();
    }
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

  it.each(['admin', 'system'] as const)(
    'rolls back cancellation audit when %s approval wins a Serializable race', async (actor) => {
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
      const approved = actor === 'system'
        ? await (await import('../backend/src/modules/finance/settlement-auto-approval.service.js'))
          .approveSettlementDraftInternally({ settlementApprovalId: id, expectedVendorId: f.vendorId })
        : await approval.approveSettlementApproval(id, `${f.vendorId}-approver`);
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
      cancelledBy: null, cancelledAt: null,
      approvedBy: actor === 'system' ? 'system:settlement_auto_approval' : `${f.vendorId}-approver`,
      scheduledCycleKey: f.cycleKey });
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
