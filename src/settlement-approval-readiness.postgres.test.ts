import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '../backend/node_modules/@prisma/client/index.js';

const databaseUrl = process.env.TEST_DATABASE_URL?.trim();
const describeWithPostgres = databaseUrl ? describe : describe.skip;

describeWithPostgres('settlement approval readiness on isolated PostgreSQL', () => {
  let db: PrismaClient;
  let assessment: typeof import('../backend/src/modules/finance/settlement-approval.service.js')['assessSettlementApprovalReadiness'];
  let candidateAssessment: typeof import('../backend/src/modules/finance/settlement-auto-approval-candidate.service.js')['assessAutomaticApprovalCandidate'];
  let approvalId: string;
  let allocationId: string;
  let saleId: string;
  let orderId: string;
  let sequence = 0;

  async function holdApprovalUpdate(id: string) {
    let acquired!: (pid: number) => void;
    let release!: () => void;
    const ready = new Promise<number>((resolve) => { acquired = resolve; });
    const released = new Promise<void>((resolve) => { release = resolve; });
    const blocker = db.$transaction(async (tx) => {
      const [{ pid }] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid()::integer AS "pid"`;
      // Unlike FOR UPDATE, NO KEY UPDATE does not stop the attempt FK's KEY SHARE read.
      await tx.$queryRaw`SELECT "id" FROM "SettlementApproval" WHERE "id" = ${id} FOR NO KEY UPDATE`;
      acquired(pid);
      await released;
    }, { timeout: 20_000 });
    const pid = await ready;
    let done = false;
    return {
      pid,
      release: async () => { if (!done) { done = true; release(); } await blocker; },
    };
  }

  async function waitForApprovalLockWait(holderPid: number, count: number) {
    const deadline = performance.now() + 2_000;
    let observed = 0;
    while (performance.now() < deadline) {
      const [{ waiting }] = await db.$queryRaw<Array<{ waiting: bigint }>>`
        SELECT count(*)::bigint AS "waiting" FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'
          AND query LIKE '%"SettlementApproval"%'
      `;
      observed = Number(waiting);
      if (observed >= count) break;
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
    const [{ directlyBlocked }] = await db.$queryRaw<Array<{ directlyBlocked: bigint }>>`
      SELECT count(*)::bigint AS "directlyBlocked" FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'
        AND ${holderPid} = ANY(pg_blocking_pids(pid))
    `;
    expect(Number(directlyBlocked)).toBeGreaterThanOrEqual(1);
    expect(observed).toBeGreaterThanOrEqual(count);
  }

  async function holdUncommittedAttempt(id: string, vendorId: string, attemptId: string) {
    let acquired!: (pid: number) => void;
    let release!: () => void;
    const ready = new Promise<number>((resolve) => { acquired = resolve; });
    const released = new Promise<void>((resolve) => { release = resolve; });
    const blocker = db.$transaction(async (tx) => {
      const [{ pid }] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid()::integer AS "pid"`;
      await tx.settlementAutoApprovalAttempt.create({ data: {
        id: attemptId, settlementApprovalId: id, vendorId,
      } });
      acquired(pid);
      await released;
      throw new Error('ROLL_BACK_TEST_ATTEMPT');
    }, { timeout: 20_000 }).catch((error: unknown) => {
      if (!(error instanceof Error) || error.message !== 'ROLL_BACK_TEST_ATTEMPT') throw error;
    });
    const pid = await ready;
    let done = false;
    return { pid, release: async () => { if (!done) { done = true; release(); } await blocker; } };
  }

  async function waitForAttemptInsertWait(holderPid: number, count: number) {
    const deadline = performance.now() + 2_000;
    let observed = 0;
    while (performance.now() < deadline) {
      const [{ waiting }] = await db.$queryRaw<Array<{ waiting: bigint }>>`
        SELECT count(*)::bigint AS "waiting" FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'
          AND query LIKE '%"SettlementAutoApprovalAttempt"%'
      `;
      observed = Number(waiting);
      if (observed >= count) break;
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
    const [{ directlyBlocked }] = await db.$queryRaw<Array<{ directlyBlocked: bigint }>>`
      SELECT count(*)::bigint AS "directlyBlocked" FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'
        AND ${holderPid} = ANY(pg_blocking_pids(pid))
    `;
    expect(Number(directlyBlocked)).toBeGreaterThanOrEqual(1);
    expect(observed).toBeGreaterThanOrEqual(count);
  }

  beforeEach(async () => {
    const target = new URL(databaseUrl!);
    const package4Target = target.protocol === 'postgresql:' && target.hostname === '127.0.0.1' &&
      target.username === 'onur' && target.searchParams.get('schema') === 'public' &&
      process.env.FIN_AUTO_P4_TEST_DATABASE_ISOLATED === '1' &&
      (target.port === '5433' && target.pathname === '/fin_auto_p4_pg16_8f2ab319' ||
        target.port === '5432' && target.pathname === '/fin_auto_p4_pg18_143fa61d' ||
        target.port === '5433' && target.pathname === '/fin_auto_f03f04_pg16_8be49807045e528f' ||
        target.port === '5432' && target.pathname === '/fin_auto_f03f04_pg18_cec3364d531b5fae' ||
        target.port === '5433' && target.pathname === '/fin_auto_f06_pg16_7d31e84c1a64' ||
        target.port === '5432' && target.pathname === '/fin_auto_f06_pg18_4f88ae2b0c39');
    if (!package4Target && (process.env.SETTLEMENT_APPROVAL_READINESS_TEST_DATABASE_ISOLATED !== '1' ||
        target.hostname !== '127.0.0.1' ||
        !['5432', '5433', process.env.SETTLEMENT_APPROVAL_READINESS_TEST_PORT].includes(target.port) ||
        target.pathname !== '/settlement_approval_readiness_validation')) {
      throw new Error('Settlement approval readiness test requires its isolated local PostgreSQL database.');
    }
    process.env.DATABASE_URL = databaseUrl;
    db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await db.$connect();
    if (package4Target) {
      const [identity] = await db.$queryRaw<Array<{ databaseName: string; port: number;
          version: string; systemId: bigint; owner: string }>>`
          SELECT current_database() AS "databaseName", inet_server_port() AS "port",
            current_setting('server_version_num') AS "version",
            (SELECT system_identifier FROM pg_control_system()) AS "systemId",
            (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = current_database()) AS "owner"`;
      if (identity?.databaseName !== target.pathname.slice(1) || identity.port !== Number(target.port) ||
          Math.floor(Number(identity.version) / 10000) !== (target.port === '5433' ? 16 : 18) ||
          String(identity.systemId) !== (target.port === '5433' ? '7689856229225255193' : '7637676237569338936') ||
          identity.owner !== target.username) {
        throw new Error('Package 4 PostgreSQL target identity does not match the approved local cluster.');
      }
      const { prisma: canonicalPrisma } = await import('../backend/src/db/prisma.js');
      const [writeTarget] = await canonicalPrisma.$queryRaw<Array<{ databaseName: string; port: number;
          systemId: bigint; owner: string }>>`
          SELECT current_database() AS "databaseName", inet_server_port() AS "port",
            (SELECT system_identifier FROM pg_control_system()) AS "systemId",
            (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = current_database()) AS "owner"`;
      if (writeTarget?.databaseName !== identity.databaseName || writeTarget.port !== identity.port ||
          String(writeTarget.systemId) !== String(identity.systemId) || writeTarget.owner !== identity.owner) {
        throw new Error('Canonical finance Prisma write target differs from the approved Package 4 database.');
      }
    }
    const [{ createAdminManualDraftApproval, assessSettlementApprovalReadiness },
      { assessAutomaticApprovalCandidate },
      { recordVerifiedDeliveredObservation }] = await Promise.all([
      import('../backend/src/modules/finance/settlement-approval.service.js'),
      import('../backend/src/modules/finance/settlement-auto-approval-candidate.service.js'),
      import('../backend/src/modules/shipping/allocation-delivered-observation.service.js'),
    ]);
    assessment = assessSettlementApprovalReadiness;
    candidateAssessment = assessAutomaticApprovalCandidate;

    const prefix = `approval-readiness-${process.pid}-${Date.now()}-${++sequence}`;
    const vendorId = `${prefix}-vendor`;
    orderId = `${prefix}-order`;
    allocationId = `${prefix}-allocation`;
    saleId = `${prefix}-sale`;
    const executionId = `${prefix}-execution`;
    await db.vendor.create({ data: { id: vendorId, name: 'Readiness Test Vendor' } });
    await db.vendorFinancialProfile.create({ data: {
      vendorId, settlementDelayDays: 0, settlementFrequencyType: 'WEEKLY',
      weeklySettlementDay: 'WEDNESDAY', autoSettlementDraftEnabled: false,
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
      providerShipmentId: `${prefix}-shipment`, shipmentStatus: 'DELIVERED', requestSnapshot: {},
    } });
    const observation = await recordVerifiedDeliveredObservation({
      allocationId,
      source: { method: 'KARGONOMI', shipmentExecutionId: executionId,
        sourceReference: `${prefix}-shipment` },
    }, db as never);
    await db.fulfillment.create({ data: {
      id: `${prefix}-fulfillment`, vendorAllocationId: allocationId,
      fulfillmentStatus: 'Delivered', shipmentUpdatedAt: observation.firstObservedDeliveredAt,
    } });
    await db.financeLedgerEntry.create({ data: {
      id: saleId, vendorAllocationId: allocationId, vendorId, entryType: 'sale',
      amount: '100.00', payoutStatus: 'PENDING', settlementStatus: 'PENDING',
      commissionPercentSnapshot: '10.00', commissionVatPercentSnapshot: '20.00',
      settlementDelayDaysSnapshot: 0,
    } });
    const draft = await createAdminManualDraftApproval({ vendorId, candidateScope: 'vendor_wide' });
    approvalId = draft.id;
    expect(draft.status).toBe('draft');
    expect(draft.lines.map((line) => line.financeLedgerEntryId)).toEqual([saleId]);
  });

  afterEach(async () => {
    await db?.$disconnect();
    // Immutable observation and financial fixture rows are disposed with this dedicated database.
  });

  it('reports a clean DRAFT without changing financial state', async () => {
    const before = await db.settlementApproval.findUniqueOrThrow({
      where: { id: approvalId }, include: { lines: true },
    });
    const result = await assessment(approvalId);
    const after = await db.settlementApproval.findUniqueOrThrow({
      where: { id: approvalId }, include: { lines: true },
    });

    expect(result).toMatchObject({
      writesPerformed: false, settlementApprovalId: approvalId, vendorId: before.vendorId,
      currency: 'TRY', status: 'DRAFT', classification: 'VERIFIED_BY_EXISTING_CHECKS',
      sourceValidation: { evaluated: true, ok: true, reasons: [] }, adminReviewRequired: true,
    });
    expect(after).toEqual(before);
    expect(await db.payoutBatch.count({ where: { vendorId: before.vendorId } })).toBe(0);
  });

  it('reports a new allocation hold through the existing approval predicate', async () => {
    await db.vendorAllocation.update({ where: { id: allocationId }, data: { allocationStatus: 'VENDOR_BLOCKED' } });
    const result = await assessment(approvalId);

    expect(result).toMatchObject({
      classification: 'BLOCKED', sourceValidation: { evaluated: true, ok: false, reasons: expect.arrayContaining([
        expect.objectContaining({ code: 'vendor_blocked_finance_hold_active', financeLedgerEntryId: saleId }),
      ]) }, adminReviewRequired: true,
    });
    expect((await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId } })).status).toBe('DRAFT');
  });

  it('blocks a post-DRAFT unresolved refund record without changing the DRAFT', async () => {
    await db.refundRecord.create({ data: {
      id: `${orderId}-refund`, vendorAllocationId: allocationId,
      sourceShopifyOrderId: `gid://shopify/Order/${orderId}`,
      sourceShopifyOrderNumber: `#${orderId}`,
      sourceShopifyRefundId: `gid://shopify/Refund/${orderId}`,
      amount: '10.00', status: 'pending',
    } });
    const result = await assessment(approvalId);

    expect(result?.classification).toBe('BLOCKED');
    expect(result?.sourceValidation.reasons).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'refund_arrived_after_draft', financeLedgerEntryId: saleId }),
    ]));
    expect((await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId } })).status).toBe('DRAFT');
    expect(await db.payoutBatch.count({ where: { vendorId: result!.vendorId } })).toBe(0);
    expect(await candidateAssessment({ settlementApprovalId: approvalId, vendorId: result!.vendorId })).toMatchObject({
      classification: 'BLOCKED', approvalAuthorized: false,
      reasonCodes: expect.arrayContaining(['refund_arrived_after_draft']),
    });
  });

  it('classifies an ordinary verified SALE as evidence-only without financial writes or approval authority', async () => {
    const before = await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId }, include: { lines: true } });
    const beforeCounts = await Promise.all([
      db.financeLedgerEntry.count({ where: { vendorId: before.vendorId } }),
      db.settlementRefundAdjustment.count({ where: { vendorId: before.vendorId } }),
      db.payoutBatch.count({ where: { vendorId: before.vendorId } }),
      db.vendorBalanceEvent.count({ where: { vendorId: before.vendorId } }),
      db.settlementCommissionInvoice.count({ where: { vendorId: before.vendorId } }),
    ]);

    const result = await candidateAssessment({ settlementApprovalId: approvalId, vendorId: before.vendorId });

    expect(result).toMatchObject({
      settlementApprovalId: approvalId, vendorId: before.vendorId,
      classification: 'ELIGIBLE_EVIDENCE_ONLY', writesPerformed: false, approvalAuthorized: false,
      requiresWriteTimeRevalidation: true, readinessClassification: 'VERIFIED_BY_EXISTING_CHECKS',
      adminReviewRequiredByExistingReadiness: true,
      vendorProfile: { active: true, autoSettlementApproveEnabled: false },
      reasonCodes: ['ORDINARY_SALE_SOURCE_CHECKS_VERIFIED'], blockers: [], unresolvedAuthority: [],
    });
    expect(await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId }, include: { lines: true } })).toEqual(before);
    expect(await Promise.all([
      db.financeLedgerEntry.count({ where: { vendorId: before.vendorId } }),
      db.settlementRefundAdjustment.count({ where: { vendorId: before.vendorId } }),
      db.payoutBatch.count({ where: { vendorId: before.vendorId } }),
      db.vendorBalanceEvent.count({ where: { vendorId: before.vendorId } }),
      db.settlementCommissionInvoice.count({ where: { vendorId: before.vendorId } }),
    ])).toEqual(beforeCounts);
  });

  it('does not reveal another vendor settlement through candidate assessment', async () => {
    const row = await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId }, select: { vendorId: true } });
    expect(await candidateAssessment({ settlementApprovalId: approvalId, vendorId: `${row.vendorId}-other` })).toBeNull();
    expect((await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId } })).status).toBe('DRAFT');
  });

  it('keeps an open integrity alert blocked in both readiness and candidate evidence', async () => {
    const row = await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId }, select: { vendorId: true } });
    await db.financeIntegrityAlert.create({ data: {
      dedupeKey: `candidate-alert-${allocationId}`, severity: 'warning', category: 'multiple_active_sale_ledgers',
      vendorAllocationId: allocationId, reason: 'Synthetic test integrity hold', status: 'open',
    } });

    const result = await candidateAssessment({ settlementApprovalId: approvalId, vendorId: row.vendorId });
    expect(result).toMatchObject({
      classification: 'BLOCKED', approvalAuthorized: false,
      reasonCodes: expect.arrayContaining(['finance_integrity_alert_open']),
    });
    expect((await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId } })).status).toBe('DRAFT');
  });

  it('returns UNKNOWN for correction and controlled replacement authority', async () => {
    const row = await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId }, select: { vendorId: true } });
    await db.settlementApproval.update({ where: { id: approvalId }, data: { correctionCreditMinor: 100 } });
    const correction = await candidateAssessment({ settlementApprovalId: approvalId, vendorId: row.vendorId });
    expect(correction).toMatchObject({
      classification: 'UNKNOWN', approvalAuthorized: false,
      reasonCodes: expect.arrayContaining(['CORRECTION_AUTHORITY_UNVERIFIED']),
      adminReviewRequiredByExistingReadiness: true,
    });

    const original = await db.settlementApproval.create({ data: {
      vendorId: row.vendorId, status: 'CANCELLED', currency: 'TRY', grossSalesMinor: 0,
      refundTotalMinor: 0, commissionMinor: 0, commissionVatMinor: 0, netPayableMinor: 0,
      sourceSnapshotJson: {},
    } });
    await db.settlementApproval.update({ where: { id: approvalId }, data: {
      correctionCreditMinor: 0, replacesSettlementApprovalId: original.id,
      replacementRequestId: `${approvalId}-request`, replacementRequestedBy: 'readiness-test-admin',
      replacementReason: 'Synthetic read-only candidate classification test', replacementRequestedAt: new Date(),
    } });
    const replacement = await candidateAssessment({ settlementApprovalId: approvalId, vendorId: row.vendorId });
    expect(replacement).toMatchObject({
      classification: 'UNKNOWN', approvalAuthorized: false,
      reasonCodes: expect.arrayContaining(['REPLACEMENT_AUTHORITY_UNVERIFIED']),
      adminReviewRequiredByExistingReadiness: true,
    });
    expect((await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId } })).status).toBe('DRAFT');
    expect(await db.settlementRefundAdjustment.count({ where: { vendorId: row.vendorId } })).toBe(0);
  });

  it('never treats a non-DRAFT settlement as an automatic candidate', async () => {
    const row = await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId }, select: { vendorId: true } });
    const { approveSettlementApproval } = await import('../backend/src/modules/finance/settlement-approval.service.js');
    await approveSettlementApproval(approvalId, 'readiness-test-admin');

    expect(await candidateAssessment({ settlementApprovalId: approvalId, vendorId: row.vendorId })).toMatchObject({
      classification: 'BLOCKED', approvalAuthorized: false, reasonCodes: ['NOT_DRAFT'],
      readinessClassification: 'BLOCKED', adminReviewRequiredByExistingReadiness: true,
    });
  });

  it('approves through the trusted internal adapter with exact vendor and frozen authority', async () => {
    const { approveSettlementDraftInternally } = await import('../backend/src/modules/finance/settlement-auto-approval.service.js');
    const before = await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId }, include: { lines: true } });
    expect((await db.vendorFinancialProfile.findUniqueOrThrow({ where: { vendorId: before.vendorId } }))
      .autoSettlementApproveEnabled).toBe(false);

    const forgedCaller = {
      settlementApprovalId: approvalId, expectedVendorId: before.vendorId, approvedBy: 'forged-admin',
    };
    const approved = await approveSettlementDraftInternally(forgedCaller);
    const after = await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId }, include: { lines: true } });
    expect(approved.status).toBe('approved');
    expect(after).toMatchObject({ status: 'APPROVED', approvedBy: 'system:settlement_auto_approval' });
    expect(after.approvedAt).toBeInstanceOf(Date);
    expect(after.lines).toEqual(before.lines);
    for (const field of ['grossSalesMinor', 'refundTotalMinor', 'commissionMinor', 'commissionVatMinor',
      'netPayableMinor', 'correctionCreditMinor', 'correctionDeductionMinor'] as const) {
      expect(after[field]).toBe(before[field]);
    }
    expect(after.lines.map((line) => line.financeLedgerEntryId)).toEqual([saleId]);
    const attempt = await db.settlementAutoApprovalAttempt.findFirstOrThrow({
      where: { settlementApprovalId: approvalId }, include: { events: true },
    });
    expect(attempt).toMatchObject({ vendorId: before.vendorId, actorId: 'system:settlement_auto_approval',
      outcome: 'APPROVED', completedAt: expect.any(Date) });
    expect(after.successfulAutoApprovalAttemptId).toBe(attempt.id);
    expect(attempt.events.map((event) => event.outcome)).toEqual(['STARTED', 'APPROVED']);
    expect(await db.payoutBatch.count({ where: { vendorId: before.vendorId } })).toBe(0);
    expect(await db.settlementCommissionInvoice.count({ where: { settlementApprovalId: approvalId } })).toBe(0);
    await expect(approveSettlementDraftInternally({ settlementApprovalId: approvalId, expectedVendorId: before.vendorId }))
      .rejects.toThrow('Only draft settlement approvals can be approved.');
    expect((await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId } })).approvedAt)
      .toEqual(after.approvedAt);
  });

  it('runs the local worker once for an Admin manual DRAFT and does not duplicate finance on replay', async () => {
    const { runAutomaticSettlementApprovalWorker } = await import(
      '../backend/src/modules/finance/settlement-auto-approval-worker.service.js');
    const row = await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId } });
    expect(await runAutomaticSettlementApprovalWorker({ vendorId: row.vendorId })).toMatchObject({
      candidatesChecked: 1, outcomes: [{ settlementApprovalId: approvalId, classification: 'VERIFIED_COMPLETED' }],
    });
    const approved = await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId } });
    expect(approved).toMatchObject({ status: 'APPROVED', approvedBy: 'system:settlement_auto_approval' });
    expect(await runAutomaticSettlementApprovalWorker({ vendorId: row.vendorId })).toMatchObject({
      candidatesChecked: 0, outcomes: [],
    });
    expect(await db.settlementAutoApprovalAttempt.count({ where: { settlementApprovalId: approvalId } })).toBe(1);
    expect(await db.payoutBatch.count({ where: { vendorId: row.vendorId } })).toBe(0);
    expect(await db.settlementCommissionInvoice.count({ where: { settlementApprovalId: approvalId } })).toBe(0);
  });

  it('runs a vendor-scoped approval sweep without reapproving a settled DRAFT', async () => {
    const { runAutomaticSettlementApprovalSweep } = await import(
      '../backend/src/modules/finance/settlement-auto-approval-scheduler.service.js');
    const row = await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId } });
    expect(await runAutomaticSettlementApprovalSweep({ vendorIds: [row.vendorId] })).toMatchObject({
      reconciliations: [], vendors: [{ vendorId: row.vendorId, outcomes: [
        { settlementApprovalId: approvalId, classification: 'VERIFIED_COMPLETED' },
      ] }],
    });
    expect(await runAutomaticSettlementApprovalSweep({ vendorIds: [row.vendorId] })).toMatchObject({
      reconciliations: [], vendors: [],
    });
    expect(await db.settlementAutoApprovalAttempt.count({ where: {
      settlementApprovalId: approvalId, outcome: 'APPROVED',
    } })).toBe(1);
    expect(await db.payoutBatch.count({ where: { vendorId: row.vendorId } })).toBe(0);
    expect(await db.settlementCommissionInvoice.count({ where: { vendorId: row.vendorId } })).toBe(0);
  });

  it('reconciles an unresolved attempt on an already Admin-approved settlement before DRAFT discovery', async () => {
    const { runAutomaticSettlementApprovalSweep } = await import(
      '../backend/src/modules/finance/settlement-auto-approval-scheduler.service.js');
    const { approveSettlementApproval } = await import(
      '../backend/src/modules/finance/settlement-approval.service.js');
    const row = await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId } });
    const attemptId = `${approvalId}-sweep-interrupted`;
    await db.settlementAutoApprovalAttempt.create({ data: {
      id: attemptId, settlementApprovalId: approvalId, vendorId: row.vendorId,
      events: { create: { outcome: 'STARTED', reasonCode: 'ATTEMPT_CREATED' } },
    } });
    await approveSettlementApproval(approvalId, 'admin-sweep-test');
    expect(await runAutomaticSettlementApprovalSweep({ vendorIds: [row.vendorId] })).toMatchObject({
      reconciliations: [{ attemptId, settlementApprovalId: approvalId,
        classification: 'BLOCKED', reasonCode: 'APPROVED_BY_OTHER_ACTOR' }],
      vendors: [],
    });
    expect(await db.settlementAutoApprovalAttempt.findUniqueOrThrow({ where: { id: attemptId } }))
      .toMatchObject({ outcome: 'BLOCKED' });
    expect(await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId } }))
      .toMatchObject({ status: 'APPROVED', approvedBy: 'admin-sweep-test' });
  });

  it('keeps one approved financial effect under two concurrent local worker calls', async () => {
    const { runAutomaticSettlementApprovalWorker } = await import(
      '../backend/src/modules/finance/settlement-auto-approval-worker.service.js');
    const before = await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId },
      include: { lines: true } });
    const results = await Promise.all([
      runAutomaticSettlementApprovalWorker({ vendorId: before.vendorId }),
      runAutomaticSettlementApprovalWorker({ vendorId: before.vendorId }),
    ]);
    expect(results.every((result) => result.vendorId === before.vendorId)).toBe(true);
    const after = await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId },
      include: { lines: true } });
    expect(after).toMatchObject({ status: 'APPROVED', approvedBy: 'system:settlement_auto_approval' });
    expect(after.lines).toEqual(before.lines);
    expect(await db.settlementAutoApprovalAttempt.count({ where: {
      settlementApprovalId: approvalId, outcome: 'APPROVED',
    } })).toBe(1);
    expect(await db.payoutBatch.count({ where: { vendorId: before.vendorId } })).toBe(0);
  });

  it('does not retry a persisted STARTED worker attempt with uncertain commit outcome', async () => {
    const { runAutomaticSettlementApprovalWorker } = await import(
      '../backend/src/modules/finance/settlement-auto-approval-worker.service.js');
    const row = await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId } });
    const attemptId = `${approvalId}-worker-started`;
    await db.settlementAutoApprovalAttempt.create({ data: {
      id: attemptId, settlementApprovalId: approvalId, vendorId: row.vendorId,
      events: { create: { outcome: 'STARTED', reasonCode: 'ATTEMPT_CREATED' } },
    } });
    for (let count = 0; count < 2; count++) {
      expect(await runAutomaticSettlementApprovalWorker({ vendorId: row.vendorId })).toMatchObject({
        candidatesChecked: 1, outcomes: [{ settlementApprovalId: approvalId, attemptId,
          classification: 'UNKNOWN', reasonCode: 'STARTED_OR_COMMIT_OUTCOME_UNCONFIRMED' }],
      });
    }
    expect(await db.settlementAutoApprovalAttempt.count({ where: { settlementApprovalId: approvalId } })).toBe(1);
    expect(await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId } }))
      .toMatchObject({ status: 'DRAFT', approvedBy: null });
  });

  it('reports a canonical financial blocker and leaves the DRAFT and payout untouched', async () => {
    const { runAutomaticSettlementApprovalWorker } = await import(
      '../backend/src/modules/finance/settlement-auto-approval-worker.service.js');
    const row = await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId } });
    await db.vendorAllocation.update({ where: { id: allocationId }, data: { allocationStatus: 'VENDOR_BLOCKED' } });
    expect(await runAutomaticSettlementApprovalWorker({ vendorId: row.vendorId })).toMatchObject({
      candidatesChecked: 1, outcomes: [{ settlementApprovalId: approvalId, classification: 'BLOCKED' }],
    });
    expect(await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId } }))
      .toMatchObject({ status: 'DRAFT', approvedBy: null });
    expect(await db.payoutBatch.count({ where: { vendorId: row.vendorId } })).toBe(0);
  });

  it('recovers an exact resolved vendor-blocked hold without replaying unchanged evidence', async () => {
    const { runAutomaticSettlementApprovalWorker } = await import(
      '../backend/src/modules/finance/settlement-auto-approval-worker.service.js');
    const row = await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId },
      include: { lines: true } });
    await db.vendorAllocation.update({ where: { id: allocationId }, data: { allocationStatus: 'VENDOR_BLOCKED' } });
    const first = await runAutomaticSettlementApprovalWorker({ vendorId: row.vendorId });
    expect(first.outcomes).toMatchObject([{ classification: 'BLOCKED', settlementApprovalId: approvalId }]);
    const blockedId = first.outcomes[0]!.attemptId!;
    const blocked = await db.settlementAutoApprovalAttempt.findUniqueOrThrow({ where: { id: blockedId } });
    expect(blocked).toMatchObject({ outcome: 'BLOCKED', reasonCode: expect.stringContaining(
      'vendor_blocked_finance_hold_active'), reasonDetail: expect.stringContaining('VENDOR_BLOCKED_ALLOCATION_V1') });
    expect(JSON.parse(blocked.reasonDetail!)).toMatchObject({ lines: [{
      lineId: row.lines[0]!.id, ledgerId: saleId, allocationId,
    }] });
    expect(await db.settlementAutoApprovalAttemptEvent.count({ where: {
      attemptId: blockedId, outcome: 'BLOCKED', reasonDetail: blocked.reasonDetail,
    } })).toBe(1);
    for (let tick = 0; tick < 2; tick++) {
      expect((await runAutomaticSettlementApprovalWorker({ vendorId: row.vendorId })).outcomes)
        .toMatchObject([{ attemptId: blockedId, classification: 'BLOCKED' }]);
    }
    await db.vendor.update({ where: { id: row.vendorId }, data: { name: 'Unrelated Vendor Display Change' } });
    expect((await runAutomaticSettlementApprovalWorker({ vendorId: row.vendorId })).outcomes)
      .toMatchObject([{ attemptId: blockedId, classification: 'BLOCKED' }]);
    expect(await db.settlementAutoApprovalAttempt.count({ where: { settlementApprovalId: approvalId } })).toBe(1);

    await db.vendorAllocation.update({ where: { id: allocationId }, data: { allocationStatus: 'ACTIVE' } });
    const recovered = await runAutomaticSettlementApprovalWorker({ vendorId: row.vendorId });
    expect(recovered.outcomes).toMatchObject([{ classification: 'VERIFIED_COMPLETED' }]);
    const recoveryId = recovered.outcomes[0]!.attemptId!;
    expect(recoveryId).not.toBe(blockedId);
    expect((await db.settlementAutoApprovalAttempt.findUniqueOrThrow({ where: { id: blockedId } })))
      .toEqual(blocked);
    expect(await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId } })).toMatchObject({
      status: 'APPROVED', approvedBy: 'system:settlement_auto_approval',
      successfulAutoApprovalAttemptId: recoveryId,
    });
    expect((await db.settlementApprovalLine.findMany({ where: { settlementApprovalId: approvalId } })))
      .toEqual(row.lines);
    expect(await db.settlementAutoApprovalAttempt.count({ where: {
      settlementApprovalId: approvalId, outcome: 'APPROVED',
    } })).toBe(1);
    expect(await db.payoutBatch.count({ where: { vendorId: row.vendorId } })).toBe(0);
  });

  it('does not retry a BLOCKED attempt without exact persisted recovery evidence', async () => {
    const { runAutomaticSettlementApprovalWorker } = await import(
      '../backend/src/modules/finance/settlement-auto-approval-worker.service.js');
    const row = await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId } });
    const attemptId = `${approvalId}-legacy-blocked`;
    await db.settlementAutoApprovalAttempt.create({ data: {
      id: attemptId, settlementApprovalId: approvalId, vendorId: row.vendorId,
      outcome: 'BLOCKED', reasonCode: 'vendor_blocked_finance_hold_active', completedAt: new Date(),
      events: { create: { outcome: 'BLOCKED', reasonCode: 'vendor_blocked_finance_hold_active' } },
    } });
    expect((await runAutomaticSettlementApprovalWorker({ vendorId: row.vendorId })).outcomes)
      .toMatchObject([{ attemptId, classification: 'BLOCKED' }]);
    expect(await db.settlementAutoApprovalAttempt.count({ where: { settlementApprovalId: approvalId } })).toBe(1);
    expect(await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId } }))
      .toMatchObject({ status: 'DRAFT', approvedBy: null });
  });

  it('keeps a resolved vendor hold blocked when a new refund makes the frozen SALE unverifiable', async () => {
    const { runAutomaticSettlementApprovalWorker } = await import(
      '../backend/src/modules/finance/settlement-auto-approval-worker.service.js');
    const row = await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId } });
    await db.vendorAllocation.update({ where: { id: allocationId }, data: { allocationStatus: 'VENDOR_BLOCKED' } });
    const first = await runAutomaticSettlementApprovalWorker({ vendorId: row.vendorId });
    const blockedId = first.outcomes[0]!.attemptId!;
    await db.vendorAllocation.update({ where: { id: allocationId }, data: { allocationStatus: 'ACTIVE' } });
    await db.refundRecord.create({ data: {
      id: `${orderId}-recovery-refund`, vendorAllocationId: allocationId,
      sourceShopifyOrderId: `gid://shopify/Order/${orderId}`,
      sourceShopifyOrderNumber: `#${orderId}`,
      sourceShopifyRefundId: `gid://shopify/Refund/${orderId}`,
      amount: '10.00', status: 'pending',
    } });
    expect((await runAutomaticSettlementApprovalWorker({ vendorId: row.vendorId })).outcomes)
      .toMatchObject([{ attemptId: blockedId, classification: 'BLOCKED' }]);
    expect(await db.settlementAutoApprovalAttempt.count({ where: { settlementApprovalId: approvalId } })).toBe(1);
    expect(await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId } }))
      .toMatchObject({ status: 'DRAFT', approvedBy: null });
  });

  it('permits only one financial approval under concurrent resolved-hold worker calls', async () => {
    const { runAutomaticSettlementApprovalWorker } = await import(
      '../backend/src/modules/finance/settlement-auto-approval-worker.service.js');
    const row = await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId } });
    await db.vendorAllocation.update({ where: { id: allocationId }, data: { allocationStatus: 'VENDOR_BLOCKED' } });
    const blocked = await runAutomaticSettlementApprovalWorker({ vendorId: row.vendorId });
    const blockedId = blocked.outcomes[0]!.attemptId!;
    await db.vendorAllocation.update({ where: { id: allocationId }, data: { allocationStatus: 'ACTIVE' } });
    await Promise.all([
      runAutomaticSettlementApprovalWorker({ vendorId: row.vendorId }),
      runAutomaticSettlementApprovalWorker({ vendorId: row.vendorId }),
    ]);
    const after = await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId } });
    expect(after).toMatchObject({ status: 'APPROVED', approvedBy: 'system:settlement_auto_approval' });
    expect(await db.settlementAutoApprovalAttempt.count({ where: {
      settlementApprovalId: approvalId, outcome: 'APPROVED',
    } })).toBe(1);
    expect(await db.settlementAutoApprovalAttempt.count({ where: { settlementApprovalId: approvalId } })).toBe(2);
    expect((await db.settlementAutoApprovalAttempt.findUniqueOrThrow({ where: { id: blockedId } })).outcome)
      .toBe('BLOCKED');
    expect(await db.payoutBatch.count({ where: { vendorId: row.vendorId } })).toBe(0);
  });

  it('characterizes an inactive profile after DRAFT creation without treating it as vendor consent', async () => {
    const { approveSettlementDraftInternally } = await import('../backend/src/modules/finance/settlement-auto-approval.service.js');
    const draft = await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId } });
    expect(draft.creationOrigin).toBe('ADMIN_MANUAL');
    await db.vendorFinancialProfile.update({ where: { vendorId: draft.vendorId }, data: { active: false } });
    const approved = await approveSettlementDraftInternally({ settlementApprovalId: approvalId,
      expectedVendorId: draft.vendorId });
    expect(approved.status).toBe('approved');
    expect(await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId } })).toMatchObject({
      status: 'APPROVED', approvedBy: 'system:settlement_auto_approval',
    });
  });

  it('replays the exact successful attempt without a second financial write', async () => {
    const { approveSettlementDraftInternally, reconcileAutomaticApprovalAttempt } = await import(
      '../backend/src/modules/finance/settlement-auto-approval.service.js');
    const row = await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId } });
    const input = { settlementApprovalId: approvalId, expectedVendorId: row.vendorId,
      attemptId: `${approvalId}-attempt` };
    const first = await approveSettlementDraftInternally(input);
    const second = await approveSettlementDraftInternally(input);
    expect(second.id).toBe(first.id);
    expect((await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId } })).approvedAt?.toISOString())
      .toBe(first.approvedAt);
    expect(await db.settlementAutoApprovalAttempt.count({ where: { settlementApprovalId: approvalId } })).toBe(1);
    expect(await db.settlementAutoApprovalAttemptEvent.count({ where: { attemptId: input.attemptId } })).toBe(2);
    expect(await reconcileAutomaticApprovalAttempt(input)).toMatchObject({
      classification: 'VERIFIED_COMPLETED', reasonCode: 'EXACT_ATTEMPT_APPROVED',
      attemptOutcome: 'APPROVED', settlementStatus: 'APPROVED',
    });
    expect(await db.payoutBatch.count({ where: { vendorId: row.vendorId } })).toBe(0);
  });

  it('reconciles a committed approval when its application-level transaction response is lost', async () => {
    const { prisma } = await import('../backend/src/db/prisma.js');
    const { approveSettlementDraftInternally, reconcileAutomaticApprovalAttempt } = await import(
      '../backend/src/modules/finance/settlement-auto-approval.service.js');
    const before = await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId }, include: { lines: true } });
    const input = { settlementApprovalId: approvalId, expectedVendorId: before.vendorId,
      attemptId: `${approvalId}-lost-application-response` };
    const originalTransaction = prisma.$transaction.bind(prisma);
    let injected = 0;
    let committedStateObserved = false;
    const transactionSpy = vi.spyOn(prisma, '$transaction').mockImplementation((async (...args: unknown[]) => {
      // Preserve the real PostgreSQL transaction. Drop only its resolved result before the service sees it.
      const result = await Reflect.apply(originalTransaction, prisma, args);
      const options = args[1] as { isolationLevel?: string } | undefined;
      if (options?.isolationLevel === 'Serializable' && injected === 0) {
        injected++;
        const independentlyPersisted = await db.settlementApproval.findUniqueOrThrow({
          where: { id: approvalId }, select: { status: true, successfulAutoApprovalAttemptId: true },
        });
        committedStateObserved = independentlyPersisted.status === 'APPROVED' &&
          independentlyPersisted.successfulAutoApprovalAttemptId === input.attemptId;
        throw new Error('TEST_APPLICATION_TRANSACTION_RESPONSE_LOST');
      }
      return result;
    }) as typeof prisma.$transaction);
    try {
      expect(await approveSettlementDraftInternally(input)).toMatchObject({ status: 'approved', id: approvalId });
    } finally {
      transactionSpy.mockRestore();
    }
    expect(injected).toBe(1);
    expect(committedStateObserved).toBe(true);
    const approved = await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId }, include: { lines: true } });
    expect(approved).toMatchObject({ status: 'APPROVED', approvedBy: 'system:settlement_auto_approval',
      successfulAutoApprovalAttemptId: input.attemptId });
    expect(approved.lines).toEqual(before.lines);
    for (const field of ['grossSalesMinor', 'refundTotalMinor', 'commissionMinor', 'commissionVatMinor',
      'netPayableMinor', 'correctionCreditMinor', 'correctionDeductionMinor'] as const) {
      expect(approved[field]).toBe(before[field]);
    }
    expect(await reconcileAutomaticApprovalAttempt(input)).toMatchObject({
      classification: 'VERIFIED_COMPLETED', attemptOutcome: 'APPROVED', settlementStatus: 'APPROVED',
    });
    expect(await reconcileAutomaticApprovalAttempt(input)).toMatchObject({
      classification: 'VERIFIED_COMPLETED', attemptOutcome: 'APPROVED', settlementStatus: 'APPROVED',
    });
    expect((await approveSettlementDraftInternally(input)).id).toBe(approvalId);
    expect(await db.settlementApproval.count({ where: { vendorId: before.vendorId, status: 'APPROVED' } })).toBe(1);
    expect(await db.settlementApprovalLine.count({ where: { settlementApprovalId: approvalId,
      financeLedgerEntryId: saleId } })).toBe(1);
    expect(await db.settlementAutoApprovalAttempt.count({ where: { settlementApprovalId: approvalId } })).toBe(1);
    expect((await db.settlementAutoApprovalAttempt.findUniqueOrThrow({ where: { id: input.attemptId } })).outcome)
      .toBe('APPROVED');
    expect(await db.settlementAutoApprovalAttemptEvent.count({ where: { attemptId: input.attemptId } })).toBe(2);
    expect(await db.financeLedgerEntry.count({ where: { id: saleId, vendorId: before.vendorId } })).toBe(1);
    expect(await db.payoutBatch.count({ where: { vendorId: before.vendorId } })).toBe(0);
    expect(await db.settlementCommissionInvoice.count({ where: { vendorId: before.vendorId } })).toBe(0);
  });

  it('does not report success or retry when the canonical transaction rolls back before commit', async () => {
    const { prisma } = await import('../backend/src/db/prisma.js');
    const { approveSettlementDraftInternally, reconcileAutomaticApprovalAttempt } = await import(
      '../backend/src/modules/finance/settlement-auto-approval.service.js');
    const before = await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId }, include: { lines: true } });
    const input = { settlementApprovalId: approvalId, expectedVendorId: before.vendorId,
      attemptId: `${approvalId}-pre-commit-rollback` };
    const originalTransaction = prisma.$transaction.bind(prisma);
    let injected = 0;
    const transactionSpy = vi.spyOn(prisma, '$transaction').mockImplementation(((...args: unknown[]) => {
      const options = args[1] as { isolationLevel?: string } | undefined;
      if (options?.isolationLevel === 'Serializable' && injected === 0) {
        injected++;
        const callback = args[0] as (tx: unknown) => Promise<unknown>;
        return Reflect.apply(originalTransaction, prisma, [async (tx: unknown) => {
          await callback(tx);
          throw new Error('TEST_AMBIGUOUS_FAILURE_BEFORE_COMMIT');
        }, options]);
      }
      return Reflect.apply(originalTransaction, prisma, args);
    }) as typeof prisma.$transaction);
    try {
      await expect(approveSettlementDraftInternally(input))
        .rejects.toThrow('TEST_AMBIGUOUS_FAILURE_BEFORE_COMMIT');
    } finally {
      transactionSpy.mockRestore();
    }
    expect(injected).toBe(1);
    const after = await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId }, include: { lines: true } });
    expect(after).toEqual(before);
    for (let count = 0; count < 2; count++) {
      expect(await reconcileAutomaticApprovalAttempt(input)).toMatchObject({
        classification: 'UNKNOWN', reasonCode: 'STARTED_OR_COMMIT_OUTCOME_UNCONFIRMED',
        attemptOutcome: 'UNKNOWN', settlementStatus: 'DRAFT',
      });
    }
    await expect(approveSettlementDraftInternally(input)).rejects.toThrow('already exists: UNKNOWN');
    expect(await db.settlementApproval.count({ where: { vendorId: before.vendorId, status: 'APPROVED' } })).toBe(0);
    expect(await db.settlementAutoApprovalAttempt.count({ where: { settlementApprovalId: approvalId } })).toBe(1);
    expect((await db.settlementAutoApprovalAttempt.findUniqueOrThrow({ where: { id: input.attemptId } })).outcome)
      .toBe('UNKNOWN');
    expect((await db.settlementAutoApprovalAttemptEvent.findMany({
      where: { attemptId: input.attemptId },
    })).map((event) => event.outcome).sort()).toEqual(['STARTED', 'UNKNOWN']);
    expect(await db.financeLedgerEntry.count({ where: { id: saleId, vendorId: before.vendorId } })).toBe(1);
    expect(await db.payoutBatch.count({ where: { vendorId: before.vendorId } })).toBe(0);
    expect(await db.settlementCommissionInvoice.count({ where: { vendorId: before.vendorId } })).toBe(0);
  });

  it('keeps a pre-commit STARTED attempt uncertain and refuses blind replay', async () => {
    const { approveSettlementDraftInternally, reconcileAutomaticApprovalAttempt } = await import(
      '../backend/src/modules/finance/settlement-auto-approval.service.js');
    const row = await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId } });
    const input = { settlementApprovalId: approvalId, expectedVendorId: row.vendorId,
      attemptId: `${approvalId}-interrupted` };
    await db.settlementAutoApprovalAttempt.create({ data: {
      id: input.attemptId, settlementApprovalId: approvalId, vendorId: row.vendorId,
      events: { create: { outcome: 'STARTED', reasonCode: 'ATTEMPT_CREATED' } },
    } });
    for (let count = 0; count < 2; count++) {
      expect(await reconcileAutomaticApprovalAttempt(input)).toMatchObject({
        classification: 'UNKNOWN', reasonCode: 'STARTED_OR_COMMIT_OUTCOME_UNCONFIRMED',
        attemptOutcome: 'STARTED', settlementStatus: 'DRAFT',
      });
    }
    await expect(approveSettlementDraftInternally(input)).rejects.toThrow('already exists: UNKNOWN');
    expect(await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId } }))
      .toMatchObject({ status: 'DRAFT', approvedBy: null, successfulAutoApprovalAttemptId: null });
    expect((await db.settlementAutoApprovalAttempt.findUniqueOrThrow({ where: { id: input.attemptId } })).outcome)
      .toBe('STARTED');
    expect(await db.settlementAutoApprovalAttemptEvent.count({ where: { attemptId: input.attemptId } })).toBe(1);
    expect(await db.settlementApproval.count({ where: { vendorId: row.vendorId, status: 'APPROVED' } })).toBe(0);
    expect(await db.payoutBatch.count({ where: { vendorId: row.vendorId } })).toBe(0);
  });

  it('reconciles a STARTED attempt after Admin approval without claiming system success', async () => {
    const { approveSettlementDraftInternally, reconcileAutomaticApprovalAttempt } = await import(
      '../backend/src/modules/finance/settlement-auto-approval.service.js');
    const { approveSettlementApproval } = await import(
      '../backend/src/modules/finance/settlement-approval.service.js');
    const row = await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId } });
    const input = { settlementApprovalId: approvalId, expectedVendorId: row.vendorId,
      attemptId: `${approvalId}-admin-before-reconcile` };
    await db.settlementAutoApprovalAttempt.create({ data: {
      id: input.attemptId, settlementApprovalId: approvalId, vendorId: row.vendorId,
      events: { create: { outcome: 'STARTED', reasonCode: 'ATTEMPT_CREATED' } },
    } });

    await approveSettlementApproval(approvalId, 'real-test-admin');
    expect(await reconcileAutomaticApprovalAttempt(input)).toMatchObject({
      classification: 'BLOCKED', reasonCode: 'APPROVED_BY_OTHER_ACTOR',
      attemptOutcome: 'BLOCKED', settlementStatus: 'APPROVED',
    });
    await expect(approveSettlementDraftInternally(input)).rejects.toThrow('already exists: BLOCKED');
    expect(await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId } })).toMatchObject({
      status: 'APPROVED', approvedBy: 'real-test-admin', successfulAutoApprovalAttemptId: null,
    });
    expect((await db.settlementAutoApprovalAttemptEvent.findMany({
      where: { attemptId: input.attemptId },
    })).map((event) => event.outcome).sort()).toEqual(['BLOCKED', 'STARTED']);
    expect(await db.settlementAutoApprovalAttempt.count({ where: { settlementApprovalId: approvalId } })).toBe(1);
    expect(await db.payoutBatch.count({ where: { vendorId: row.vendorId } })).toBe(0);
  });

  it('requires a new attempt after authoritative resolution of a blocked DRAFT', async () => {
    const { approveSettlementDraftInternally, reconcileAutomaticApprovalAttempt } = await import(
      '../backend/src/modules/finance/settlement-auto-approval.service.js');
    const row = await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId }, include: { lines: true } });
    const blocked = { settlementApprovalId: approvalId, expectedVendorId: row.vendorId,
      attemptId: `${approvalId}-blocked-before-resolution` };
    await db.vendorAllocation.update({ where: { id: allocationId }, data: { allocationStatus: 'VENDOR_BLOCKED' } });
    await expect(approveSettlementDraftInternally(blocked)).rejects.toMatchObject({
      name: 'SettlementApprovalRevalidationError',
    });
    expect(await reconcileAutomaticApprovalAttempt(blocked)).toMatchObject({
      classification: 'BLOCKED', attemptOutcome: 'BLOCKED', settlementStatus: 'DRAFT',
    });

    await db.vendorAllocation.update({ where: { id: allocationId }, data: { allocationStatus: 'ACTIVE' } });
    await expect(approveSettlementDraftInternally(blocked)).rejects.toThrow('already exists: BLOCKED');
    const fresh = { settlementApprovalId: approvalId, expectedVendorId: row.vendorId,
      attemptId: `${approvalId}-after-resolution` };
    await approveSettlementDraftInternally(fresh);
    expect(await reconcileAutomaticApprovalAttempt(fresh)).toMatchObject({
      classification: 'VERIFIED_COMPLETED', attemptOutcome: 'APPROVED', settlementStatus: 'APPROVED',
    });
    expect(await reconcileAutomaticApprovalAttempt(blocked)).toMatchObject({
      classification: 'BLOCKED', attemptOutcome: 'BLOCKED', settlementStatus: 'APPROVED',
    });
    const after = await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId }, include: { lines: true } });
    expect(after).toMatchObject({
      status: 'APPROVED', approvedBy: 'system:settlement_auto_approval',
      successfulAutoApprovalAttemptId: fresh.attemptId,
    });
    expect(after.lines).toEqual(row.lines);
    for (const field of ['grossSalesMinor', 'refundTotalMinor', 'commissionMinor', 'commissionVatMinor',
      'netPayableMinor', 'correctionCreditMinor', 'correctionDeductionMinor'] as const) {
      expect(after[field]).toBe(row[field]);
    }
    expect(after.lines.map((line) => line.financeLedgerEntryId)).toEqual([saleId]);
    expect(await db.settlementAutoApprovalAttempt.count({ where: { settlementApprovalId: approvalId } })).toBe(2);
    expect(await db.settlementAutoApprovalAttemptEvent.count({ where: { attemptId: blocked.attemptId,
      outcome: 'APPROVED' } })).toBe(0);
    expect(await db.settlementAutoApprovalAttemptEvent.count({ where: { attemptId: fresh.attemptId,
      outcome: 'APPROVED' } })).toBe(1);
    expect(await db.payoutBatch.count({ where: { vendorId: row.vendorId } })).toBe(0);
    expect(await db.settlementRefundAdjustment.count({ where: { vendorId: row.vendorId } })).toBe(0);
    expect(await db.financialCorrectionAuthority.count({ where: { vendorId: row.vendorId } })).toBe(0);
  });

  it('fails closed on forged success, changed ownership and immutable attempt events', async () => {
    const row = await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId } });
    const attemptId = `${approvalId}-guard`;
    await db.settlementAutoApprovalAttempt.create({ data: {
      id: attemptId, settlementApprovalId: approvalId, vendorId: row.vendorId,
    } });
    await expect(db.settlementAutoApprovalAttempt.update({ where: { id: attemptId }, data: {
      outcome: 'APPROVED', completedAt: new Date(),
    } })).rejects.toThrow();
    await expect(db.settlementAutoApprovalAttempt.update({ where: { id: attemptId }, data: {
      vendorId: `${row.vendorId}-other`,
    } })).rejects.toThrow();
    await expect(db.settlementAutoApprovalAttempt.create({ data: {
      id: `${attemptId}-wrong-vendor`, settlementApprovalId: approvalId,
      vendorId: `${row.vendorId}-other`,
    } })).rejects.toThrow();
    await expect(db.settlementAutoApprovalAttempt.create({ data: {
      id: `${attemptId}-forged-actor`, settlementApprovalId: approvalId,
      vendorId: row.vendorId, actorId: 'forged-admin',
    } })).rejects.toThrow();
    const event = await db.settlementAutoApprovalAttemptEvent.create({ data: {
      attemptId, outcome: 'STARTED', reasonCode: 'GUARD_TEST',
    } });
    await expect(db.settlementAutoApprovalAttemptEvent.delete({ where: { id: event.id } })).rejects.toThrow();
    expect((await db.settlementAutoApprovalAttempt.findUniqueOrThrow({ where: { id: attemptId } })).outcome)
      .toBe('STARTED');
  });

  it('records a canonical validation blocker without false success or financial side effects', async () => {
    const { approveSettlementDraftInternally, reconcileAutomaticApprovalAttempt } = await import(
      '../backend/src/modules/finance/settlement-auto-approval.service.js');
    const row = await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId } });
    await db.vendorAllocation.update({ where: { id: allocationId }, data: { allocationStatus: 'VENDOR_BLOCKED' } });
    const input = { settlementApprovalId: approvalId, expectedVendorId: row.vendorId,
      attemptId: `${approvalId}-blocked` };
    await expect(approveSettlementDraftInternally(input)).rejects.toMatchObject({
      name: 'SettlementApprovalRevalidationError',
    });
    expect(await reconcileAutomaticApprovalAttempt(input)).toMatchObject({
      classification: 'BLOCKED', attemptOutcome: 'BLOCKED', settlementStatus: 'DRAFT',
    });
    expect((await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId } })).approvedBy).toBeNull();
    expect(await db.settlementRefundAdjustment.count({ where: { vendorId: row.vendorId } })).toBe(0);
    expect(await db.payoutBatch.count({ where: { vendorId: row.vendorId } })).toBe(0);
  });

  it('rolls back a monetary-inconsistent approval while retaining only blocked attempt evidence', async () => {
    const { approveSettlementDraftInternally } = await import(
      '../backend/src/modules/finance/settlement-auto-approval.service.js');
    const row = await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId } });
    await db.settlementApproval.update({ where: { id: approvalId },
      data: { grossSalesMinor: row.grossSalesMinor + 1 } });
    await expect(approveSettlementDraftInternally({ settlementApprovalId: approvalId,
      expectedVendorId: row.vendorId, attemptId: `${approvalId}-invalid-money` }))
      .rejects.toThrow('Settlement approval monetary totals are inconsistent');
    expect(await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId } }))
      .toMatchObject({ status: 'DRAFT', approvedBy: null, successfulAutoApprovalAttemptId: null });
    expect(await db.settlementAutoApprovalAttempt.findFirstOrThrow({ where: { settlementApprovalId: approvalId } }))
      .toMatchObject({ outcome: 'BLOCKED' });
    expect(await db.settlementAutoApprovalAttemptEvent.count({ where: {
      attempt: { settlementApprovalId: approvalId }, outcome: 'APPROVED',
    } })).toBe(0);
  });

  it('keeps a completed attempt historically true after an authorized settlement cancellation', async () => {
    const { approveSettlementDraftInternally, reconcileAutomaticApprovalAttempt } = await import(
      '../backend/src/modules/finance/settlement-auto-approval.service.js');
    const { cancelSettlementApproval } = await import(
      '../backend/src/modules/finance/settlement-approval.service.js');
    const row = await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId } });
    const input = { settlementApprovalId: approvalId, expectedVendorId: row.vendorId,
      attemptId: `${approvalId}-historical` };
    await approveSettlementDraftInternally(input);
    await cancelSettlementApproval(approvalId, 'test-admin');
    expect(await reconcileAutomaticApprovalAttempt(input)).toMatchObject({
      classification: 'VERIFIED_COMPLETED', reasonCode: 'APPROVED_THEN_CANCELLED',
      settlementStatus: 'CANCELLED', attemptOutcome: 'APPROVED',
    });
    await expect(approveSettlementDraftInternally(input)).rejects.toThrow('already exists');
    expect(await db.settlementAutoApprovalAttempt.count({ where: { settlementApprovalId: approvalId } })).toBe(1);
  });

  it('prevents two calls blocked on the same uncommitted attempt identity from duplicating approval', async () => {
    const { approveSettlementDraftInternally, reconcileAutomaticApprovalAttempt } = await import(
      '../backend/src/modules/finance/settlement-auto-approval.service.js');
    const row = await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId } });
    const input = { settlementApprovalId: approvalId, expectedVendorId: row.vendorId,
      attemptId: `${approvalId}-shared` };
    const lock = await holdUncommittedAttempt(approvalId, row.vendorId, input.attemptId);
    let results!: PromiseSettledResult<Awaited<ReturnType<typeof approveSettlementDraftInternally>>>[];
    try {
      const first = approveSettlementDraftInternally(input);
      void first.catch(() => undefined);
      await waitForAttemptInsertWait(lock.pid, 1);
      const second = approveSettlementDraftInternally(input);
      void second.catch(() => undefined);
      await waitForAttemptInsertWait(lock.pid, 2);
      await lock.release();
      results = await Promise.allSettled([first, second]);
    } finally {
      await lock.release();
    }
    expect(results.some((result) => result.status === 'fulfilled')).toBe(true);
    expect(await reconcileAutomaticApprovalAttempt(input)).toMatchObject({ classification: 'VERIFIED_COMPLETED' });
    expect(await db.settlementAutoApprovalAttempt.count({ where: { settlementApprovalId: approvalId } })).toBe(1);
    expect(await db.settlementAutoApprovalAttemptEvent.count({ where: { attemptId: input.attemptId,
      outcome: 'APPROVED' } })).toBe(1);
  });

  it('rejects a wrong expected vendor before any approval write', async () => {
    const { approveSettlementDraftInternally } = await import('../backend/src/modules/finance/settlement-auto-approval.service.js');
    const before = await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId }, include: { lines: true } });
    await expect(approveSettlementDraftInternally({
      settlementApprovalId: approvalId, expectedVendorId: `${before.vendorId}-other`,
    })).rejects.toThrow('System settlement approval vendor identity does not match.');
    expect(await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId }, include: { lines: true } }))
      .toEqual(before);
  });

  it('keeps the Admin actor and canonical blockers on the same approval executor', async () => {
    const { approveSettlementDraftInternally } = await import('../backend/src/modules/finance/settlement-auto-approval.service.js');
    const { approveSettlementApproval } = await import('../backend/src/modules/finance/settlement-approval.service.js');
    const row = await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId } });
    await db.vendorAllocation.update({ where: { id: allocationId }, data: { allocationStatus: 'VENDOR_BLOCKED' } });
    await expect(approveSettlementDraftInternally({
      settlementApprovalId: approvalId, expectedVendorId: row.vendorId,
    })).rejects.toMatchObject({ name: 'SettlementApprovalRevalidationError' });
    await expect(approveSettlementApproval(approvalId, 'real-test-admin'))
      .rejects.toMatchObject({ name: 'SettlementApprovalRevalidationError' });
    expect((await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId } })).status).toBe('DRAFT');
    await db.vendorAllocation.update({ where: { id: allocationId }, data: { allocationStatus: 'ACTIVE' } });
    await approveSettlementApproval(approvalId, 'real-test-admin');
    expect(await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId } }))
      .toMatchObject({ status: 'APPROVED', approvedBy: 'real-test-admin' });
  });

  it.each([0, 1] as const)('allows only one system approval after observed overlapping updates, ordering %i', async (first) => {
    const { approveSettlementDraftInternally } = await import('../backend/src/modules/finance/settlement-auto-approval.service.js');
    const row = await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId }, include: { lines: true } });
    const attempts = [0, 1].map((index) => ({ settlementApprovalId: approvalId,
      expectedVendorId: row.vendorId, attemptId: `${approvalId}-system-${index}` }));
    const lock = await holdApprovalUpdate(approvalId);
    let results!: PromiseSettledResult<Awaited<ReturnType<typeof approveSettlementDraftInternally>>>[];
    try {
      const operations = [0, 1].map(() => Promise.resolve(null) as Promise<Awaited<ReturnType<typeof approveSettlementDraftInternally>>>);
      operations[first] = approveSettlementDraftInternally(attempts[first]);
      void operations[first].catch(() => undefined);
      await waitForApprovalLockWait(lock.pid, 1);
      operations[1 - first] = approveSettlementDraftInternally(attempts[1 - first]);
      void operations[1 - first].catch(() => undefined);
      await waitForApprovalLockWait(lock.pid, 2);
      await lock.release();
      results = await Promise.allSettled(operations);
    } finally {
      await lock.release();
    }
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const approved = await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId }, include: { lines: true } });
    expect(approved).toMatchObject({ status: 'APPROVED', approvedBy: 'system:settlement_auto_approval',
      successfulAutoApprovalAttemptId: attempts[first].attemptId });
    expect(approved.lines).toEqual(row.lines);
    for (const field of ['grossSalesMinor', 'refundTotalMinor', 'commissionMinor', 'commissionVatMinor',
      'netPayableMinor', 'correctionCreditMinor', 'correctionDeductionMinor'] as const) {
      expect(approved[field]).toBe(row[field]);
    }
    expect(await db.settlementApproval.count({ where: { vendorId: row.vendorId } })).toBe(1);
    expect(await db.settlementRefundAdjustment.count({ where: { vendorId: row.vendorId } })).toBe(0);
    expect(await db.settlementAutoApprovalAttempt.count({ where: { settlementApprovalId: approvalId,
      outcome: 'APPROVED' } })).toBe(1);
    expect(await db.settlementAutoApprovalAttempt.count({ where: { settlementApprovalId: approvalId } })).toBe(2);
    expect(await db.settlementAutoApprovalAttemptEvent.count({ where: { attemptId: attempts[first].attemptId,
      outcome: 'APPROVED' } })).toBe(1);
    expect(await db.settlementAutoApprovalAttemptEvent.count({ where: { attemptId: attempts[1 - first].attemptId,
      outcome: 'APPROVED' } })).toBe(0);
  });

  it.each(['system', 'admin'] as const)('keeps one exact actor when %s reaches the approval update first', async (firstActor) => {
    const { approveSettlementDraftInternally } = await import('../backend/src/modules/finance/settlement-auto-approval.service.js');
    const { approveSettlementApproval } = await import('../backend/src/modules/finance/settlement-approval.service.js');
    const row = await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId }, include: { lines: true } });
    const attemptId = `${approvalId}-actor-race`;
    const run = (actor: 'admin' | 'system') => actor === 'admin'
      ? approveSettlementApproval(approvalId, 'racing-admin')
      : approveSettlementDraftInternally({ settlementApprovalId: approvalId,
        expectedVendorId: row.vendorId, attemptId });
    const secondActor = firstActor === 'admin' ? 'system' : 'admin';
    const lock = await holdApprovalUpdate(approvalId);
    let results!: PromiseSettledResult<Awaited<ReturnType<typeof run>>>[];
    try {
      const firstOperation = run(firstActor);
      void firstOperation.catch(() => undefined);
      await waitForApprovalLockWait(lock.pid, 1);
      const secondOperation = run(secondActor);
      void secondOperation.catch(() => undefined);
      await waitForApprovalLockWait(lock.pid, 2);
      await lock.release();
      results = await Promise.allSettled([firstOperation, secondOperation]);
    } finally {
      await lock.release();
    }
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const persisted = await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId }, include: { lines: true } });
    expect(persisted).toMatchObject({ status: 'APPROVED',
      approvedBy: firstActor === 'admin' ? 'racing-admin' : 'system:settlement_auto_approval',
      successfulAutoApprovalAttemptId: firstActor === 'system' ? attemptId : null });
    expect(persisted.lines).toEqual(row.lines);
    for (const field of ['grossSalesMinor', 'refundTotalMinor', 'commissionMinor', 'commissionVatMinor',
      'netPayableMinor', 'correctionCreditMinor', 'correctionDeductionMinor'] as const) {
      expect(persisted[field]).toBe(row[field]);
    }
    expect(await db.settlementApproval.count({ where: { vendorId: row.vendorId } })).toBe(1);
    const attempts = await db.settlementAutoApprovalAttempt.findMany({ where: { settlementApprovalId: approvalId } });
    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.outcome).toBe(firstActor === 'system' ? 'APPROVED' : 'BLOCKED');
    expect(await db.settlementAutoApprovalAttemptEvent.count({ where: { attemptId, outcome: 'APPROVED' } }))
      .toBe(firstActor === 'system' ? 1 : 0);
  });

  it('does not reopen a cancelled DRAFT through the system adapter', async () => {
    const { approveSettlementDraftInternally } = await import('../backend/src/modules/finance/settlement-auto-approval.service.js');
    const { cancelSettlementApproval } = await import('../backend/src/modules/finance/settlement-approval.service.js');
    const row = await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId } });
    await cancelSettlementApproval(approvalId, 'cancelling-admin');
    await expect(approveSettlementDraftInternally({
      settlementApprovalId: approvalId, expectedVendorId: row.vendorId,
    })).rejects.toThrow('Only draft settlement approvals can be approved.');
    expect(await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId } }))
      .toMatchObject({ status: 'CANCELLED', cancelledBy: 'cancelling-admin', approvedBy: null });
    expect(await db.settlementAutoApprovalAttempt.findFirstOrThrow({ where: { settlementApprovalId: approvalId } }))
      .toMatchObject({ outcome: 'BLOCKED', reasonCode: 'SETTLEMENT_CANCELLED' });
  });

  it.each(['approval', 'cancellation'] as const)(
    'keeps approval and cancellation history consistent when %s reaches the locked row first', async (first) => {
    const { approveSettlementDraftInternally } = await import('../backend/src/modules/finance/settlement-auto-approval.service.js');
    const { cancelSettlementApproval } = await import('../backend/src/modules/finance/settlement-approval.service.js');
    const row = await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId }, include: { lines: true } });
    const attemptId = `${approvalId}-cancel-race`;
    const runApproval = () => approveSettlementDraftInternally({ settlementApprovalId: approvalId,
      expectedVendorId: row.vendorId, attemptId });
    const runCancellation = () => cancelSettlementApproval(approvalId, 'racing-canceller');
    const lock = await holdApprovalUpdate(approvalId);
    let firstResult!: PromiseSettledResult<unknown>;
    let secondResult!: PromiseSettledResult<unknown>;
    try {
      const firstOperation = first === 'approval' ? runApproval() : runCancellation();
      void firstOperation.catch(() => undefined);
      await waitForApprovalLockWait(lock.pid, 1);
      const secondOperation = first === 'approval' ? runCancellation() : runApproval();
      void secondOperation.catch(() => undefined);
      await waitForApprovalLockWait(lock.pid, 2);
      await lock.release();
      [firstResult, secondResult] = await Promise.allSettled([firstOperation, secondOperation]);
    } finally {
      await lock.release();
    }
    expect(firstResult.status).toBe('fulfilled');
    expect(secondResult.status).toBe('rejected');
    const persisted = await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId }, include: { lines: true } });
    expect(persisted.lines).toEqual(row.lines);
    if (first === 'approval') {
      expect(persisted).toMatchObject({ status: 'APPROVED', approvedBy: 'system:settlement_auto_approval',
        successfulAutoApprovalAttemptId: attemptId, cancelledBy: null });
      expect(await db.settlementAutoApprovalAttemptEvent.count({ where: { attemptId, outcome: 'APPROVED' } })).toBe(1);
    } else {
      expect(persisted).toMatchObject({ status: 'CANCELLED', cancelledFromStatus: 'DRAFT',
        approvedBy: null, successfulAutoApprovalAttemptId: null, cancelledBy: 'racing-canceller' });
      expect(await db.settlementAutoApprovalAttemptEvent.count({ where: { attemptId, outcome: 'APPROVED' } })).toBe(0);
    }
    expect(await db.settlementApproval.count({ where: { vendorId: row.vendorId } })).toBe(1);
    expect(await db.payoutBatch.count({ where: { vendorId: row.vendorId } })).toBe(0);
    expect(await db.settlementCommissionInvoice.count({ where: { vendorId: row.vendorId } })).toBe(0);
  });

  it.each([
    'grossSalesMinor', 'refundTotalMinor', 'commissionMinor', 'commissionVatMinor', 'netPayableMinor',
  ] as const)('rejects a one-minor-unit %s header mismatch before approving an ordinary SALE', async (field) => {
    const { approveSettlementApproval } = await import('../backend/src/modules/finance/settlement-approval.service.js');
    const before = await db.settlementApproval.findUniqueOrThrow({
      where: { id: approvalId }, include: { lines: true },
    });
    await db.settlementApproval.update({ where: { id: approvalId }, data: { [field]: before[field] + 1 } });

    await expect(approveSettlementApproval(approvalId, 'monetary-reconciliation-test'))
      .rejects.toThrow(`Settlement approval monetary totals are inconsistent: ${field}.`);
    const after = await db.settlementApproval.findUniqueOrThrow({
      where: { id: approvalId }, include: { lines: true },
    });
    expect(after).toMatchObject({ status: 'DRAFT', approvedBy: null, approvedAt: null });
    expect(after[field]).toBe(before[field] + 1);
    expect(after.lines).toEqual(before.lines);
    expect(await db.payoutBatch.count({ where: { vendorId: before.vendorId } })).toBe(0);
    expect(await db.settlementRefundAdjustment.count({ where: { vendorId: before.vendorId } })).toBe(0);
  });

  it('pages beyond 20 immutable attempts with exact vendor, outcome and settlement filters without writes', async () => {
    const { listAutoApprovalAttemptsForAdmin, listAutoApprovalAttemptEventsForAdmin } =
      await import('../backend/src/modules/finance/settlement-auto-approval-review.service.js');
    const approval = await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId } });
    const sameInstant = new Date('2026-10-15T10:00:00.000Z');
    for (let index = 0; index < 27; index++) {
      const id = `${approvalId}-review-${String(index).padStart(2, '0')}`;
      const outcome = index % 3 === 0 ? 'UNKNOWN' : index % 3 === 1 ? 'BLOCKED' : 'TECHNICAL_FAILURE';
      await db.settlementAutoApprovalAttempt.create({ data: {
        id, settlementApprovalId: approvalId, vendorId: approval.vendorId,
        outcome, reasonCode: `REASON_${index}`,
        completedAt: outcome === 'UNKNOWN' ? null : sameInstant,
        createdAt: sameInstant,
        events: { create: [
          { outcome: 'STARTED', reasonCode: 'ATTEMPT_CREATED', createdAt: sameInstant },
          { outcome, reasonCode: `REASON_${index}`, createdAt: new Date(sameInstant.getTime() + 1) },
        ] },
      } });
    }
    const before = await db.settlementAutoApprovalAttempt.count({ where: { settlementApprovalId: approvalId } });
    const first = await listAutoApprovalAttemptsForAdmin({ vendorId: approval.vendorId, limit: 20 });
    const second = await listAutoApprovalAttemptsForAdmin({ vendorId: approval.vendorId, limit: 20,
      cursor: first.nextCursor! });
    expect(first.attempts).toHaveLength(20);
    expect(second.attempts).toHaveLength(7);
    expect(second.nextCursor).toBeNull();
    expect(new Set([...first.attempts, ...second.attempts].map((row) => row.id)).size).toBe(27);
    expect([...first.attempts, ...second.attempts].every((row) =>
      row.vendorId === approval.vendorId && row.settlementApprovalId === approvalId &&
      row.currentSettlementStatus === 'DRAFT' && row.eventCount === 2)).toBe(true);
    const blocked = await listAutoApprovalAttemptsForAdmin({ settlementApprovalId: approvalId,
      outcome: 'BLOCKED', reasonCode: 'REASON_' });
    expect(blocked.attempts).toHaveLength(9);
    expect(blocked.attempts.every((row) => row.outcome === 'BLOCKED')).toBe(true);
    expect((await listAutoApprovalAttemptsForAdmin({ vendorId: 'another-vendor' })).attempts).toEqual([]);
    await expect(listAutoApprovalAttemptsForAdmin({ cursor: 'missing' })).rejects.toThrow('cursor');
    await expect(listAutoApprovalAttemptsForAdmin({ outcome: 'SUCCESS' })).rejects.toThrow('outcome');
    const history = await listAutoApprovalAttemptEventsForAdmin(first.attempts[0]!.id, undefined, 1);
    expect(history?.events).toHaveLength(1);
    expect(history?.events[0]?.outcome).toBe('STARTED');
    expect(history?.nextCursor).toBeTruthy();
    const more = await listAutoApprovalAttemptEventsForAdmin(first.attempts[0]!.id, history?.nextCursor!, 1);
    expect(more?.events).toHaveLength(1);
    expect(more?.events[0]?.reasonCode).toMatch(/^REASON_/);
    expect(more?.nextCursor).toBeNull();
    expect(await db.settlementAutoApprovalAttempt.count({ where: { settlementApprovalId: approvalId } })).toBe(before);
    expect((await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId } })).status).toBe('DRAFT');
    expect(await db.payoutBatch.count({ where: { vendorId: approval.vendorId } })).toBe(0);
    expect(await db.settlementRefundAdjustment.count({ where: { vendorId: approval.vendorId } })).toBe(0);
    expect(await db.financialCorrectionAuthority.count({ where: { vendorId: approval.vendorId } })).toBe(0);
  });

  it('persists bounded, concurrent operational error evidence independently from finance attempts', async () => {
    const { recordAutoApprovalOperationalError, operationalErrorIdentity } = await import(
      '../backend/src/modules/finance/settlement-auto-approval-operational-error.service.js');
    const { listAutoApprovalOperationalErrorsForAdmin } = await import(
      '../backend/src/modules/finance/settlement-auto-approval-review.service.js');
    const approval = await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId } });
    const before = {
      settlement: await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId }, include: { lines: true } }),
      ledgers: await db.financeLedgerEntry.findMany({ where: { vendorId: approval.vendorId } }),
      attempts: await db.settlementAutoApprovalAttempt.count({ where: { vendorId: approval.vendorId } }),
      payouts: await db.payoutBatch.count({ where: { vendorId: approval.vendorId } }),
    };
    const input = { phase: 'WORKER_PRE_ATTEMPT' as const, category: 'DATABASE_READ_FAILED' as const,
      error: new Error('secret-password=never-store'), vendorId: approval.vendorId,
      settlementApprovalId: approvalId };
    await Promise.all(Array.from({ length: 12 }, () => recordAutoApprovalOperationalError(input)));
    const key = operationalErrorIdentity(input).deduplicationKey;
    const rows = await db.settlementAutoApprovalOperationalError.findMany({ where: { deduplicationKey: key } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ phase: 'WORKER_PRE_ATTEMPT', category: 'DATABASE_READ_FAILED',
      errorCode: 'UNCLASSIFIED', vendorId: approval.vendorId, settlementApprovalId: approvalId,
      attemptId: null, occurrenceCount: 12 });
    expect(rows[0]!.lastOccurredAt.getTime()).toBeGreaterThanOrEqual(rows[0]!.firstOccurredAt.getTime());
    expect(JSON.stringify(rows[0])).not.toContain('secret-password');
    await recordAutoApprovalOperationalError({ ...input, vendorId: `${approval.vendorId}-other` });
    await recordAutoApprovalOperationalError({ ...input, category: 'WORKER_FAILED' });
    await recordAutoApprovalOperationalError({ ...input, error: new TypeError('private type detail') });
    expect(await db.settlementAutoApprovalOperationalError.count({ where: { vendorId: approval.vendorId } })).toBe(3);
    const first = await listAutoApprovalOperationalErrorsForAdmin({ vendorId: approval.vendorId, limit: 1 });
    const second = await listAutoApprovalOperationalErrorsForAdmin({ vendorId: approval.vendorId,
      cursor: first.nextCursor!, limit: 1 });
    const third = await listAutoApprovalOperationalErrorsForAdmin({ vendorId: approval.vendorId,
      cursor: second.nextCursor!, limit: 1 });
    expect(first.operationalErrors).toHaveLength(1);
    expect(second.operationalErrors).toHaveLength(1);
    expect(third.operationalErrors).toHaveLength(1);
    expect(third.nextCursor).toBeNull();
    expect(new Set([...first.operationalErrors, ...second.operationalErrors,
      ...third.operationalErrors].map((row) => row.id)).size).toBe(3);
    expect((await listAutoApprovalOperationalErrorsForAdmin({ vendorId: 'unrelated-vendor' })).operationalErrors)
      .toEqual([]);
    await expect(listAutoApprovalOperationalErrorsForAdmin({ cursor: 'missing' })).rejects.toThrow('cursor');
    expect(await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId }, include: { lines: true } }))
      .toEqual(before.settlement);
    expect(await db.financeLedgerEntry.findMany({ where: { vendorId: approval.vendorId } })).toEqual(before.ledgers);
    expect(await db.settlementAutoApprovalAttempt.count({ where: { vendorId: approval.vendorId } }))
      .toBe(before.attempts);
    expect(await db.payoutBatch.count({ where: { vendorId: approval.vendorId } })).toBe(before.payouts);
  });

  it('records a real scheduler discovery exception and preserves the original failure', async () => {
    const { prisma: canonicalPrisma } = await import('../backend/src/db/prisma.js');
    const { runAutomaticSettlementApprovalSweep } = await import(
      '../backend/src/modules/finance/settlement-auto-approval-scheduler.service.js');
    const originalFailure = new Error('private discovery detail');
    const previous = await db.settlementAutoApprovalOperationalError.findFirst({
      where: { phase: 'VENDOR_DISCOVERY', category: 'DATABASE_READ_FAILED' },
    });
    const spy = vi.spyOn(canonicalPrisma.settlementApproval, 'findMany').mockRejectedValueOnce(originalFailure);
    try {
      await expect(runAutomaticSettlementApprovalSweep({ vendorIds: [
        (await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId } })).vendorId,
      ] })).rejects.toBe(originalFailure);
    } finally { spy.mockRestore(); }
    const rows = await db.settlementAutoApprovalOperationalError.findMany({
      where: { phase: 'VENDOR_DISCOVERY', category: 'DATABASE_READ_FAILED' },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ vendorId: null, attemptId: null,
      occurrenceCount: (previous?.occurrenceCount ?? 0) + 1 });
    expect(JSON.stringify(rows)).not.toContain('private discovery detail');
    expect((await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId } })).status).toBe('DRAFT');
  });

  it('records worker pre-attempt lookup failures without creating a financial attempt', async () => {
    const { prisma: canonicalPrisma } = await import('../backend/src/db/prisma.js');
    const { runAutomaticSettlementApprovalWorker } = await import(
      '../backend/src/modules/finance/settlement-auto-approval-worker.service.js');
    const vendorId = (await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId } })).vendorId;
    const before = await db.settlementAutoApprovalAttempt.count({ where: { vendorId } });
    const failure = new Error('private worker detail');
    const spy = vi.spyOn(canonicalPrisma.settlementApproval, 'findMany').mockRejectedValueOnce(failure);
    try { await expect(runAutomaticSettlementApprovalWorker({ vendorId })).rejects.toBe(failure); }
    finally { spy.mockRestore(); }
    const rows = await db.settlementAutoApprovalOperationalError.findMany({
      where: { phase: 'WORKER_PRE_ATTEMPT', vendorId },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ category: 'DATABASE_READ_FAILED', settlementApprovalId: null,
      attemptId: null, occurrenceCount: 1 });
    expect(JSON.stringify(rows)).not.toContain('private worker detail');
    expect(await db.settlementAutoApprovalAttempt.count({ where: { vendorId } })).toBe(before);
    expect((await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId } })).status).toBe('DRAFT');
  });

  it('does not turn a failed operational evidence write into a successful sweep', async () => {
    const { prisma: canonicalPrisma } = await import('../backend/src/db/prisma.js');
    const { runAutomaticSettlementApprovalSweep } = await import(
      '../backend/src/modules/finance/settlement-auto-approval-scheduler.service.js');
    const before = await db.settlementAutoApprovalOperationalError.count({
      where: { phase: 'INITIAL_ATTEMPT_LOOKUP' },
    });
    const failure = new Error('private database failure');
    const lookup = vi.spyOn(canonicalPrisma.settlementAutoApprovalAttempt, 'findMany').mockRejectedValueOnce(failure);
    const evidence = vi.spyOn(canonicalPrisma, '$executeRaw').mockRejectedValueOnce(new Error('storage unavailable'));
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      await expect(runAutomaticSettlementApprovalSweep()).rejects.toBe(failure);
      expect(warning).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
        phase: 'INITIAL_ATTEMPT_LOOKUP', category: 'DATABASE_READ_FAILED',
      }));
      expect(JSON.stringify(warning.mock.calls)).not.toContain('private database failure');
    } finally { lookup.mockRestore(); evidence.mockRestore(); warning.mockRestore(); }
    expect(await db.settlementAutoApprovalOperationalError.count({
      where: { phase: 'INITIAL_ATTEMPT_LOOKUP' },
    })).toBe(before);
    expect((await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId } })).status).toBe('DRAFT');
  });

  it('persists initial attempt lookup failure without claiming a scheduler success', async () => {
    const { prisma: canonicalPrisma } = await import('../backend/src/db/prisma.js');
    const { runAutomaticSettlementApprovalSweep } = await import(
      '../backend/src/modules/finance/settlement-auto-approval-scheduler.service.js');
    const failure = new Error('private lookup detail');
    const before = await db.settlementAutoApprovalOperationalError.findFirst({
      where: { phase: 'INITIAL_ATTEMPT_LOOKUP', category: 'DATABASE_READ_FAILED' },
    });
    const spy = vi.spyOn(canonicalPrisma.settlementAutoApprovalAttempt, 'findMany').mockRejectedValueOnce(failure);
    try { await expect(runAutomaticSettlementApprovalSweep()).rejects.toBe(failure); }
    finally { spy.mockRestore(); }
    const rows = await db.settlementAutoApprovalOperationalError.findMany({
      where: { phase: 'INITIAL_ATTEMPT_LOOKUP', category: 'DATABASE_READ_FAILED' },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ occurrenceCount: (before?.occurrenceCount ?? 0) + 1,
      vendorId: null, attemptId: null });
    expect(JSON.stringify(rows)).not.toContain('private lookup detail');
    expect((await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId } })).status).toBe('DRAFT');
  });

  it('serves read-only attempt history through real authenticated Admin HTTP without leaking finance state', async () => {
    const { hashPasswordArgon2id } = await import('../backend/src/modules/auth/password-hashing.js');
    const { createApp } = await import('../backend/src/app.js');
    const approval = await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId }, include: { lines: true } });
    const password = `${approvalId}-http-password`;
    const passwordHash = await hashPasswordArgon2id(password);
    const adminId = `${approvalId}-http-admin`;
    const vendorUserId = `${approvalId}-http-vendor`;
    await db.user.createMany({ data: [
      { id: adminId, email: `${adminId}@example.test`, name: 'Readiness HTTP Admin', role: 'ADMIN', passwordHash },
      { id: vendorUserId, email: `${vendorUserId}@example.test`, name: 'Readiness HTTP Vendor', role: 'VENDOR', passwordHash },
    ] });
    const { approveSettlementDraftInternally } = await import('../backend/src/modules/finance/settlement-auto-approval.service.js');
    const attemptId = `${approvalId}-http-approved`;
    await approveSettlementDraftInternally({ settlementApprovalId: approvalId,
      expectedVendorId: approval.vendorId, attemptId });
    const { recordAutoApprovalOperationalError } = await import(
      '../backend/src/modules/finance/settlement-auto-approval-operational-error.service.js');
    await recordAutoApprovalOperationalError({ phase: 'VENDOR_WORKER', category: 'WORKER_FAILED',
      error: new Error('private customer payload'), vendorId: approval.vendorId,
      settlementApprovalId: approvalId, attemptId });
    const before = {
      approval: await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId }, include: { lines: true } }),
      attempts: await db.settlementAutoApprovalAttempt.findMany({ where: { settlementApprovalId: approvalId } }),
      events: await db.settlementAutoApprovalAttemptEvent.findMany({ where: { attemptId } }),
      ledgers: await db.financeLedgerEntry.findMany({ where: { vendorId: approval.vendorId } }),
      payouts: await db.payoutBatch.count({ where: { vendorId: approval.vendorId } }),
      invoices: await db.settlementCommissionInvoice.count({ where: { vendorId: approval.vendorId } }),
    };
    const environmentKeys = ['SETTLEMENT_AUTO_DRAFT_SCHEDULER_ENABLED', 'SHIPPING_PROVIDER',
      'KARGONOMI_BASE_URL', 'KARGONOMI_API_TOKEN'] as const;
    const originalEnvironment = environmentKeys.map((key) => process.env[key]);
    process.env.SETTLEMENT_AUTO_DRAFT_SCHEDULER_ENABLED = 'false';
    process.env.SHIPPING_PROVIDER = 'kargonomi';
    process.env.KARGONOMI_BASE_URL = 'http://127.0.0.1:1';
    process.env.KARGONOMI_API_TOKEN = 'disposable-http-test-only';
    const app = createApp();
    const origin = await app.listen({ host: '127.0.0.1', port: 0 });
    async function login(email: string) {
      const response = await fetch(`${origin}/auth/login`, { method: 'POST',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
      expect(response.status).toBe(200);
      return response.headers.get('set-cookie')?.split(';', 1)[0] ?? '';
    }
    const path = `/admin/finance/settlement-auto-approval-attempts`;
    const operationalPath = '/admin/finance/settlement-auto-approval-operational-errors';
    try {
      const adminCookie = await login(`${adminId}@example.test`);
      const vendorCookie = await login(`${vendorUserId}@example.test`);
      expect(adminCookie).toBeTruthy();
      expect(vendorCookie).toBeTruthy();
      expect((await fetch(`${origin}${path}`)).status).toBe(401);
      expect((await fetch(`${origin}${path}`, { headers: { cookie: vendorCookie } })).status).toBe(403);
      expect((await fetch(`${origin}${operationalPath}`)).status).toBe(401);
      expect((await fetch(`${origin}${operationalPath}`, { headers: { cookie: vendorCookie } })).status).toBe(403);
      const operationalResponse = await fetch(`${origin}${operationalPath}?vendorId=${encodeURIComponent(approval.vendorId)}`,
        { headers: { cookie: adminCookie } });
      expect(operationalResponse.status).toBe(200);
      const operationalText = await operationalResponse.text();
      expect(operationalText).not.toContain('private customer payload');
      expect(JSON.parse(operationalText)).toMatchObject({ writesPerformed: false,
        operationalErrors: [expect.objectContaining({ phase: 'VENDOR_WORKER', vendorId: approval.vendorId,
          attemptId, occurrenceCount: 1 })] });
      expect((await fetch(`${origin}${path}/${attemptId}/events`,
        { headers: { cookie: vendorCookie } })).status).toBe(403);
      const query = `${origin}${path}?vendorId=${encodeURIComponent(approval.vendorId)}` +
        `&settlementApprovalId=${encodeURIComponent(approvalId)}&outcome=APPROVED`;
      const listed = await fetch(query, { headers: { cookie: adminCookie } });
      expect(listed.status).toBe(200);
      expect(await listed.json()).toMatchObject({ writesPerformed: false,
        attempts: [expect.objectContaining({ id: attemptId, vendorId: approval.vendorId,
          outcome: 'APPROVED', currentSettlementStatus: 'APPROVED', exactSuccessfulAttempt: true })],
      });
      const history = await fetch(`${origin}${path}/${attemptId}/events`, { headers: { cookie: adminCookie } });
      expect(history.status).toBe(200);
      expect((await history.json() as { events: Array<{ outcome: string }> }).events.map((event) => event.outcome))
        .toEqual(['STARTED', 'APPROVED']);
      const empty = await fetch(`${origin}${path}?vendorId=another-vendor`, { headers: { cookie: adminCookie } });
      expect(empty.status).toBe(200);
      expect((await empty.json() as { attempts: unknown[] }).attempts).toEqual([]);
      expect((await fetch(`${origin}${path}?cursor=invalid`, { headers: { cookie: adminCookie } })).status).toBe(400);
      expect((await fetch(`${origin}${path}?outcome=SUCCESS`, { headers: { cookie: adminCookie } })).status).toBe(400);
      expect(await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId }, include: { lines: true } }))
        .toEqual(before.approval);
      expect(await db.settlementAutoApprovalAttempt.findMany({ where: { settlementApprovalId: approvalId } }))
        .toEqual(before.attempts);
      expect(await db.settlementAutoApprovalAttemptEvent.findMany({ where: { attemptId } }))
        .toEqual(before.events);
      expect(await db.financeLedgerEntry.findMany({ where: { vendorId: approval.vendorId } })).toEqual(before.ledgers);
      expect(await db.payoutBatch.count({ where: { vendorId: approval.vendorId } })).toBe(before.payouts);
      expect(await db.settlementCommissionInvoice.count({ where: { vendorId: approval.vendorId } })).toBe(before.invoices);
    } finally {
      await app.close();
      environmentKeys.forEach((key, index) => {
        const value = originalEnvironment[index];
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      });
    }
  });

  it('reads exact successful attempt evidence separately from a later cancelled settlement state', async () => {
    const { approveSettlementDraftInternally } = await import('../backend/src/modules/finance/settlement-auto-approval.service.js');
    const { cancelSettlementApproval } = await import('../backend/src/modules/finance/settlement-approval.service.js');
    const { listAutoApprovalAttemptsForAdmin, listAutoApprovalAttemptEventsForAdmin } =
      await import('../backend/src/modules/finance/settlement-auto-approval-review.service.js');
    const row = await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId } });
    const attemptId = `${approvalId}-review-approved`;
    await approveSettlementDraftInternally({ settlementApprovalId: approvalId,
      expectedVendorId: row.vendorId, attemptId });
    await cancelSettlementApproval(approvalId, 'review-test-admin');
    const page = await listAutoApprovalAttemptsForAdmin({ settlementApprovalId: approvalId,
      vendorId: row.vendorId, outcome: 'APPROVED' });
    expect(page.attempts).toHaveLength(1);
    expect(page.attempts[0]).toMatchObject({ id: attemptId, outcome: 'APPROVED',
      exactSuccessfulAttempt: true, currentSettlementStatus: 'CANCELLED' });
    const events = await listAutoApprovalAttemptEventsForAdmin(attemptId);
    expect(events?.events.map((event) => event.outcome)).toEqual(['STARTED', 'APPROVED']);
    expect((await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId } })).approvedBy)
      .toBe('system:settlement_auto_approval');
  });

  it('keeps an unreconcilable existing attempt distinct from a failed financial approval', async () => {
    const { runAutomaticSettlementApprovalSweep } = await import(
      '../backend/src/modules/finance/settlement-auto-approval-scheduler.service.js');
    const { prisma: canonicalPrisma } = await import('../backend/src/db/prisma.js');
    const approval = await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId } });
    const attemptId = `${approvalId}-reconciliation-unavailable`;
    await db.settlementAutoApprovalAttempt.create({ data: {
      id: attemptId, settlementApprovalId: approvalId, vendorId: approval.vendorId,
      outcome: 'UNKNOWN',
    } });
    const failure = new Error('private reconciliation detail');
    const spy = vi.spyOn(canonicalPrisma.settlementAutoApprovalAttempt, 'findUnique').mockRejectedValueOnce(failure);
    let result: Awaited<ReturnType<typeof runAutomaticSettlementApprovalSweep>>;
    try { result = await runAutomaticSettlementApprovalSweep({ vendorIds: [approval.vendorId] }); }
    finally { spy.mockRestore(); }
    expect(result.reconciliationErrors).toEqual([expect.objectContaining({
      vendorId: approval.vendorId, settlementApprovalId: approvalId, attemptId,
    })]);
    expect(result.skippedVendors).toContain(approval.vendorId);
    const error = await db.settlementAutoApprovalOperationalError.findFirstOrThrow({
      where: { phase: 'ATTEMPT_RECONCILIATION', attemptId },
    });
    expect(error).toMatchObject({ category: 'RECONCILIATION_FAILED', vendorId: approval.vendorId,
      settlementApprovalId: approvalId, occurrenceCount: 1 });
    expect(JSON.stringify(error)).not.toContain('private reconciliation detail');
    expect((await db.settlementAutoApprovalAttempt.findUniqueOrThrow({ where: { id: attemptId } })).outcome)
      .toBe('UNKNOWN');
    expect((await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId } })).status).toBe('DRAFT');
    expect(await db.payoutBatch.count({ where: { vendorId: approval.vendorId } })).toBe(0);
  });
});


// Shares only the already CI-registered disposable database, not readiness fixtures or mutations.
describeWithPostgres('Vendor settlement history cursor pagination on disposable PostgreSQL', () => {
  let db: PrismaClient;
  let list: typeof import('../backend/src/modules/finance/settlement-approval.service.js')['listSettlementApprovalsForVendor'];
  const prefix = `history-b1-${process.pid}-${Date.now()}`;
  const vendorA = `${prefix}-a`, vendorB = `${prefix}-b`, emptyVendor = `${prefix}-empty`;
  const fixtures = Array.from({ length: 503 }, (_, index) => ({
    id: `${prefix}-record-${String(index).padStart(4, '0')}`,
    vendorId: vendorA, createdAt: new Date(Date.UTC(2026, 9, 1, 0, 0, Math.floor(index / 7))),
    status: (['DRAFT', 'APPROVED', 'CANCELLED'] as const)[index % 3], currency: 'TRY',
    grossSalesMinor: 100_000 + index, refundTotalMinor: index, commissionMinor: 10_000,
    commissionVatMinor: 2_000, netPayableMinor: 88_000,
    sourceSnapshotJson: { fixture: 'history-b1', index },
  }));
  const filterVendor = `${prefix}-filters`, filterForeignVendor = `${prefix}-filters-foreign`;
  const filterFixtures = Array.from({ length: 132 }, (_, index) => {
    const kind = index % 6;
    return { ...fixtures[index], id: `${prefix}-filter-${String(index).padStart(4, '0')}`, vendorId: filterVendor,
      createdAt: new Date(Date.UTC(2026, kind === 3 || kind === 5 ? 8 : 9, 1, 0, 0, Math.floor(index / 12))),
      scheduledCycleKey: kind === 0 ? `${prefix}-cycle-${index}` : null,
      scheduledPeriodEnd: kind === 0 || kind === 1 || kind === 4 ? new Date('2026-08-31T23:59:59.999Z') : null,
      scheduledRunDate: kind <= 2 ? new Date('2026-07-01T00:00:00.000Z') : null,
      netPayableMinor: [99999, 100000, 100001, -99999, -100000, -100001, 0, -2147483648][index % 8],
      currency: index % 2 ? 'USD' : 'TRY',
    };
  });
  // Literal cycle keys override even date-like/month-like values. Empty string alone falls back.
  filterFixtures.push(...['', 'all', ' ', '2026-02-30', '2026-08-31', '2026-09'].map((key, index) => ({
    ...filterFixtures[0], id: `${prefix}-literal-${index}`, scheduledCycleKey: key,
    scheduledPeriodEnd: new Date('2026-08-31T00:00:00.000Z'),
  })));
  filterFixtures.push(...[
    { scheduledPeriodEnd: new Date('2026-08-30T23:59:59.999Z') },
    { scheduledPeriodEnd: new Date('2026-09-01T00:00:00.000Z') },
    { createdAt: new Date('2026-09-30T23:59:59.999Z') },
    { createdAt: new Date('2026-10-01T00:00:00.000Z') },
    { scheduledRunDate: new Date('2026-06-30T23:59:59.999Z') },
    { scheduledRunDate: new Date('2026-07-02T00:00:00.000Z') },
    { scheduledPeriodEnd: new Date('2024-02-29T23:59:59.999Z') },
  ].map((dates, index) => ({ ...filterFixtures[0], id: `${prefix}-boundary-${index}`,
    scheduledCycleKey: null, scheduledPeriodEnd: null, scheduledRunDate: null, ...dates })));
  const filterOrdered = [...filterFixtures].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() ||
    (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  const rawPeriod = (row: typeof filterFixtures[number]) => row.scheduledCycleKey ||
    row.scheduledPeriodEnd?.toISOString().slice(0, 10) || row.scheduledRunDate?.toISOString().slice(0, 10) ||
    row.createdAt.toISOString().slice(0, 7);
  const workflowVendor = `${prefix}-workflow`, workflowForeign = `${prefix}-workflow-foreign`;
  const workflowFixtures = Array.from({ length: 603 }, (_, index) => ({
    ...fixtures[index % fixtures.length], id: `${prefix}-workflow-${String(index).padStart(4, '0')}`,
    vendorId: workflowVendor, createdAt: new Date(Date.UTC(2025, 0, 1, 0, 0, Math.floor(index / 7))),
    status: (['DRAFT', 'APPROVED', 'CANCELLED'] as const)[index % 3],
    netPayableMinor: [0, -100000, 100000, 100001, -1, 1][Math.floor(index / 3) % 6],
    hasLine: index % 4 !== 0,
  }));
  const correctionWorkflowFixtures = ['credit', 'deduction'].map(kind => ({
    ...fixtures[0], id: `${prefix}-workflow-${kind}`, vendorId: workflowVendor, netPayableMinor: 0, hasLine: true,
  }));
  const workflowOrdered = [...workflowFixtures, ...correctionWorkflowFixtures].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() ||
    (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  // Independent oracle follows the existing frontend summary-level matcher.
  const matchesWorkflow = (row: typeof workflowFixtures[number], workflow: string) => {
    const hold = row.status === 'CANCELLED' || (row.netPayableMinor <= 0 && row.hasLine);
    const ready = row.status === 'DRAFT' && !hold;
    if (workflow === 'all') return true;
    if (workflow === 'ready_for_approval') return ready;
    if (workflow === 'needs_review') return row.status === 'DRAFT' && !ready;
    if (workflow === 'vendor_hold') return hold;
    if (workflow === 'approved') return row.status === 'APPROVED';
    return false; // Summary never generates Refund and has no PAID status.
  };
  const ordered = [...fixtures].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() ||
    (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));

  beforeAll(async () => {
    const target = new URL(databaseUrl!);
    const local = process.env.CI !== 'true' && process.env.GITHUB_ACTIONS !== 'true' &&
      target.username === 'onur' && !target.password && target.port === '5432' &&
      /^[a-f0-9]{64}$/.test(process.env.FIN03_B1_TEST_DB_PROOF ?? '');
    const ci = process.env.CI === 'true' && process.env.GITHUB_ACTIONS === 'true' &&
      target.username === 'postgres' && target.password === 'postgres' && target.port === '5432';
    if (process.env.SETTLEMENT_APPROVAL_READINESS_TEST_DATABASE_ISOLATED !== '1' ||
      target.protocol !== 'postgresql:' || target.hostname !== '127.0.0.1' ||
      target.pathname !== '/settlement_approval_readiness_validation' || target.search !== '?schema=public' ||
      !(local || ci)) throw new Error('History pagination refuses any unverified database target.');
    const identitySql = `SELECT current_database() AS database, current_user AS owner,
      pg_get_userbyid(d.datdba) AS "databaseOwner", inet_server_port() AS port,
      current_schema() AS schema, current_setting('server_version_num') AS version,
      current_setting('data_directory') AS directory, (pg_control_system()).system_identifier::text AS "systemId",
      shobj_description(d.oid, 'pg_database') AS comment
      FROM pg_database d WHERE d.datname = current_database()`;
    process.env.DATABASE_URL = databaseUrl;
    db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const maintenanceUrl = new URL(target); maintenanceUrl.pathname = '/postgres';
    const maintenance = new PrismaClient({ datasources: { db: { url: maintenanceUrl.toString() } } });
    type Identity = { database: string; owner: string; databaseOwner: string; port: number; schema: string;
      version: string; directory: string; systemId: string; comment: string | null };
    const [identity] = await db.$queryRawUnsafe<Identity[]>(identitySql);
    try {
      const [cluster] = await maintenance.$queryRawUnsafe<Identity[]>(identitySql);
      expect(identity.systemId).toBe(cluster.systemId);
      expect(identity.directory).toBe(cluster.directory);
      expect(identity.version).toBe(cluster.version);
    } finally { await maintenance.$disconnect(); }
    expect(identity).toMatchObject({ database: 'settlement_approval_readiness_validation', owner: target.username,
      databaseOwner: target.username, port: 5432, schema: 'public' });
    if (local) {
      expect(identity).toMatchObject({ version: '180003', directory: '/opt/homebrew/var/postgresql@18',
        systemId: '7637676237569338936', comment: `fin03-b1-local:${process.env.FIN03_B1_TEST_DB_PROOF}` });
    } else {
      // The existing finance suite runs on both isolated CI services (16 and 18).
      expect([16, 18]).toContain(Math.floor(Number(identity.version) / 10000));
    }
    const service = await import('../backend/src/modules/finance/settlement-approval.service.js');
    const { prisma } = await import('../backend/src/db/prisma.js');
    const [serviceIdentity] = await prisma.$queryRawUnsafe<Identity[]>(identitySql);
    expect(serviceIdentity).toEqual(identity);
    list = service.listSettlementApprovalsForVendor;
    expect(await db.vendor.count({ where: { id: { in: [vendorA, vendorB, emptyVendor] } } })).toBe(0);
    await db.vendor.createMany({ data: [vendorA, vendorB, emptyVendor, filterVendor, filterForeignVendor, workflowVendor, workflowForeign].map(id => ({ id, name: id })) });
    await db.settlementApproval.createMany({ data: [
      ...fixtures,
      ...fixtures.slice(0, 27).map(row => ({ ...row, id: `${row.id}-foreign`, vendorId: vendorB })),
      ...filterFixtures,
      ...workflowFixtures.map(({ hasLine: _hasLine, ...row }) => row),
      ...workflowFixtures.slice(0, 27).map(({ hasLine: _hasLine, ...row }) => ({
        ...row, id: `${row.id}-foreign`, vendorId: workflowForeign,
      })),
      ...filterFixtures.slice(0, 24).map(row => ({ ...row, id: `${row.id}-foreign`, vendorId: filterForeignVendor,
        scheduledCycleKey: null })),
    ] });
    await db.financeLedgerEntry.createMany({ data: [workflowVendor, workflowForeign].map(vendorId => ({
      id: `${vendorId}-ledger`, vendorId, entryType: 'sale', amount: '1.00',
    })) });
    await db.settlementApprovalLine.createMany({ data: [
      ...workflowFixtures.filter(row => row.hasLine).map(row => ({
        id: `${row.id}-line`, settlementApprovalId: row.id, financeLedgerEntryId: `${workflowVendor}-ledger`,
        lineType: 'SALE' as const, amountMinor: 100, commissionMinor: 0, commissionVatMinor: 0,
        payableImpactMinor: 100, sourceSnapshotJson: { fixture: 'workflow-summary-only' },
      })),
      ...workflowFixtures.slice(0, 27).filter(row => row.hasLine).map(row => ({
        id: `${row.id}-foreign-line`, settlementApprovalId: `${row.id}-foreign`, financeLedgerEntryId: `${workflowForeign}-ledger`,
        lineType: 'SALE' as const, amountMinor: 100, commissionMinor: 0, commissionVatMinor: 0,
        payableImpactMinor: 100, sourceSnapshotJson: { fixture: 'workflow-summary-only' },
      })),
    ] });
    const payoutActor = await seedCorrectionOnlyWorkflowRows();
    const eftExecutedAt = new Date('2025-01-01T00:00:00Z');
    const payoutCompletedAt = new Date();
    await db.payoutBatch.createMany({ data: (['DRAFT', 'REVIEW', 'PAID'] as const).map(status => ({
      id: `${prefix}-workflow-payout-${status}`, vendorId: workflowVendor, status,
      grossAmount: '123.45', netAmount: '123.45',
      ...(status === 'PAID' ? { paidAt: payoutCompletedAt, paidByUserId: payoutActor, eftAmountMinor: null,
        eftExecutedAt, eftDeclaredAt: eftExecutedAt.toISOString(),
        eftAttestedAt: payoutCompletedAt, eftAttestedByUserId: payoutActor, paymentReference: 'disposable-fixture' } : {}),
    })) });
  });
  afterAll(async () => { await db?.$disconnect(); });

  async function seedCorrectionOnlyWorkflowRows() {
    // Relational fixtures exercise all Summary.lineCount sources, not financial mutation services.
    const actor = `${prefix}-workflow-actor`;
    await db.user.create({ data: { id: actor, name: 'Workflow Fixture', email: `${actor}@example.test`,
      role: 'ADMIN', passwordHash: 'non-login-test-fixture' } });
    for (const kind of ['credit', 'deduction'] as const) {
      const id = `${prefix}-workflow-${kind}`, vendorId = workflowVendor;
      const common = { sourceShopifyRefundId: `${id}-refund`, sourceShopifyOrderId: `${id}-order`, vendorAllocationId: `${id}-allocation` };
      await db.shopifyOrder.create({ data: { id: common.sourceShopifyOrderId,
        sourceShopifyOrderId: common.sourceShopifyOrderId, sourceShopifyOrderNumber: `#${id}` } });
      await db.vendorAllocation.create({ data: { id: common.vendorAllocationId,
        sourceShopifyOrderId: common.sourceShopifyOrderId, sourceShopifyOrderNumber: `#${id}`,
        originalVendorId: vendorId, assignedVendorId: vendorId } });
      await db.financeLedgerEntry.createMany({ data: ['sale', 'refund'].map(entryType => ({
        id: `${id}-${entryType}-ledger`, vendorId, vendorAllocationId: common.vendorAllocationId, entryType, amount: '1.00',
      })) });
      await db.refundRecord.create({ data: { id: `${id}-record`, ...common, sourceShopifyOrderNumber: `#${id}`, status: 'COMPLETED', amount: '1.00' } });
      const evidence = { ...common, historicalSaleFinanceLedgerEntryId: `${id}-sale-ledger`, currency: 'TRY',
        refundTotalAmount: '1.00', evidenceHash: `${id}-accepted`, hashAlgorithm: 'SHA-256', evidenceVersion: 1, normalizationVersion: 1 };
      await db.refundEvidenceSnapshot.create({ data: { id: `${id}-snapshot`, ...evidence,
        refundRecordId: `${id}-record`, refundFinanceLedgerEntryId: `${id}-refund-ledger`, historicalEconomicVendorId: vendorId,
        monetaryClassification: 'MONETARY_REFUND', normalizedTransactionsJson: [], normalizedRefundLinesJson: [],
        normalizedOwnershipJson: {}, normalizedEvidenceJson: {}, supersededSaleLedgerIdsJson: [],
        evidenceSource: 'workflow-relational-fixture', capturedAt: new Date('2025-01-01T00:00:00Z') } });
      await db.refundTerminalEvidenceReview.create({ data: { id: `${id}-review`, ...common,
        terminalRefundFinanceLedgerEntryId: `${id}-refund-ledger`, refundRecordId: `${id}-record`, economicVendorId: vendorId,
        storedEvidenceSnapshotId: `${id}-snapshot`, dedupeKey: id, conflictCategory: 'AMOUNT_MISMATCH', conflictSummaryJson: {},
        status: 'RESOLVED', resolutionOutcome: 'CORRECTION_REQUIRED' } });
      await db.refundTerminalConflictEvidence.create({ data: { id: `${id}-incoming`, ...evidence,
        evidenceHash: `${id}-incoming`, reviewId: `${id}-review`, economicVendorId: vendorId,
        supersededSaleLedgerIdsJson: [], normalizedEvidenceJson: {} } });
      await db.refundTerminalEvidenceReviewEvent.create({ data: { id: `${id}-event`, reviewId: `${id}-review`,
        eventType: 'RESOLVED', actorUserId: actor, resolutionOutcome: 'CORRECTION_REQUIRED' } });
      const delta = kind === 'credit' ? -100 : 100;
      await db.financialCorrectionAuthority.create({ data: { id: `${id}-authority`, ...common, vendorId,
        reviewId: `${id}-review`, resolvedReviewEventId: `${id}-event`, acceptedEvidenceSnapshotId: `${id}-snapshot`,
        incomingConflictEvidenceId: `${id}-incoming`, historicalSaleFinanceLedgerEntryId: `${id}-sale-ledger`,
        acceptedRefundFinanceLedgerEntryId: `${id}-refund-ledger`, acceptedEvidenceHash: evidence.evidenceHash,
        incomingEvidenceHash: `${id}-incoming`, acceptedEvidenceVersion: 1, acceptedNormalizationVersion: 1,
        incomingEvidenceVersion: 1, incomingNormalizationVersion: 1, commissionPercent: '0', commissionVatPercent: '0', currency: 'TRY',
        acceptedRefundAmountMinor: 200, acceptedCommissionReversalMinor: 0, acceptedCommissionVatReversalMinor: 0,
        acceptedVendorPayableReversalMinor: 200, correctedRefundAmountMinor: 200 + delta, correctedCommissionReversalMinor: 0,
        correctedCommissionVatReversalMinor: 0, correctedVendorPayableReversalMinor: 200 + delta,
        refundDifferenceMinor: delta, commissionDifferenceMinor: 0, commissionVatDifferenceMinor: 0, vendorPayableDifferenceMinor: delta,
        economicDirection: kind === 'credit' ? 'VENDOR_CREDIT' : 'VENDOR_DEDUCTION', previewFingerprint: id,
        applicationRoute: kind === 'credit' ? 'BEFORE_SETTLEMENT_VENDOR_CREDIT' : 'BEFORE_SETTLEMENT_VENDOR_DEDUCTION',
        authorizedByUserId: actor, reason: 'Disposable workflow relation fixture' } });
      await db.settlementApproval.create({ data: { ...fixtures[0], id, vendorId, netPayableMinor: 0 } });
      if (kind === 'credit') {
        await db.financialCorrectionCredit.create({ data: { id: `${id}-source`, authorityId: `${id}-authority`, vendorId, amountMinor: 100 } });
        // Cancelled lines are still counted by the existing Summary DTO.
        await db.financialCorrectionCreditSettlementLine.create({ data: { creditId: `${id}-source`, settlementApprovalId: id,
          amountMinor: 100, status: 'CANCELLED', cancelledAt: new Date('2025-01-01T00:00:00Z') } });
      } else {
        await db.financialCorrectionDeduction.create({ data: { id: `${id}-source`, authorityId: `${id}-authority`, vendorId, amountMinor: 100 } });
        await db.financialCorrectionDeductionSettlementLine.create({ data: { deductionId: `${id}-source`, settlementApprovalId: id, amountMinor: 100 } });
      }
    }
    return actor;
  }

  async function page(vendorId: string, query: Record<string, unknown> = {}) {
    const result = await list(vendorId, { pagination: 'cursor', ...query });
    if (!('nextCursor' in result)) throw new Error('Cursor mode response required');
    return result;
  }

  it('preserves the legacy recent response and summary schema without pagination metadata', async () => {
    const result = await list(vendorA);
    expect(Object.keys(result).sort()).toEqual(['approvals', 'ok', 'vendorId', 'writesPerformed']);
    expect(result.approvals).toHaveLength(20);
    expect(result.approvals.every(row => row.vendorId === vendorA)).toBe(true);
    const raw = fixtures.find(row => row.id === result.approvals[0].id)!;
    expect(result.approvals[0]).toEqual({ id: raw.id, vendorId: vendorA, createdAt: raw.createdAt.toISOString(),
      status: raw.status.toLowerCase(), currency: raw.currency, grossSalesMinor: raw.grossSalesMinor,
      netPayableMinor: raw.netPayableMinor, approvedAt: null,
      scheduledRunDate: null, scheduledPeriodEnd: null, scheduledCycleKey: null, lineCount: 0 });
  });

  it('traverses all 503 settlements in bounded default pages with equal-timestamp boundaries', async () => {
    const ids: string[] = []; let cursor: string | null = null;
    do {
      const result = await page(vendorA, cursor ? { cursor } : {});
      expect(result.approvals.length).toBeLessThanOrEqual(20);
      expect(result.approvals.every(row => row.vendorId === vendorA)).toBe(true);
      ids.push(...result.approvals.map(row => row.id));
      expect(result.hasMore).toBe(result.nextCursor !== null);
      cursor = result.nextCursor;
      if (ids.length > 503) throw new Error('Duplicate/unbounded pagination');
    } while (cursor);
    expect(ids).toEqual(ordered.map(row => row.id));
    expect(new Set(ids).size).toBe(503);
    for (const position of [19, 20, 21, 25, 100, 500, 503]) expect(ids[position - 1]).toBe(ordered[position - 1].id);
  });

  it('returns the bounded maximum page and the correct final/empty envelopes', async () => {
    const first = await page(vendorA, { limit: 100 });
    expect(first.approvals).toHaveLength(100); expect(first.hasMore).toBe(true);
    expect(await page(emptyVendor)).toEqual({ ok: true, writesPerformed: false,
      vendorId: emptyVendor, approvals: [], hasMore: false, nextCursor: null });
    const foreign = await page(vendorB, { limit: 100 });
    expect(foreign.approvals).toHaveLength(27); expect(foreign.hasMore).toBe(false); expect(foreign.nextCursor).toBeNull();
  });

  it('rejects cross-Vendor cursors, limit changes, malformed/version boundaries and unsupported filters', async () => {
    const first = await page(vendorA);
    await expect(page(vendorB, { cursor: first.nextCursor })).rejects.toThrow('cursor');
    await expect(page(vendorA, { cursor: first.nextCursor, limit: 21 })).rejects.toThrow('cursor');
    for (const cursor of ['bad!', Buffer.from(JSON.stringify({ v: 99 })).toString('base64url')])
      await expect(page(vendorA, { cursor })).rejects.toThrow('cursor');
    for (const limit of [0, -1, 1.5, 101]) await expect(page(vendorA, { limit })).rejects.toThrow('limit');
    for (const key of ['period', 'searchTimeZone'])
      await expect(page(vendorA, { [key]: 'value' })).rejects.toThrow('Unsupported');
    await expect(page('')).rejects.toThrow('vendorId');
  });

  it('continues by tuple after deletion of a disposable cursor anchor', async () => {
    const vendor = `${prefix}-deleted-anchor`;
    await db.vendor.create({ data: { id: vendor, name: vendor } });
    const rows = fixtures.slice(0, 6).map(row => ({ ...row, id: `${row.id}-anchor`, vendorId: vendor }));
    await db.settlementApproval.createMany({ data: rows });
    const first = await page(vendor, { limit: 2 });
    await db.settlementApproval.delete({ where: { id: first.approvals[1].id } });
    const second = await page(vendor, { limit: 2, cursor: first.nextCursor });
    expect(second.approvals.map(row => row.id)).toEqual([...rows].reverse().slice(2, 4).map(row => row.id));
    expect(second.approvals.some(row => first.approvals.some(old => old.id === row.id))).toBe(false);
  });

  it('keeps a newer concurrent insert above the continuation boundary without promising a snapshot', async () => {
    const first = await page(vendorA);
    const inserted = { ...fixtures[0], id: `${prefix}-newer`, createdAt: new Date('2027-01-01T00:00:00Z') };
    await db.settlementApproval.create({ data: inserted });
    const next = await page(vendorA, { cursor: first.nextCursor });
    expect(next.approvals.map(row => row.id)).toEqual(ordered.slice(20, 40).map(row => row.id));
    expect((await page(vendorA)).approvals[0].id).toBe(inserted.id);
  });

  it('does not change stored financial fields, status, ledger or payout data during list traversal', async () => {
    const where = { vendorId: vendorB };
    const before = await db.settlementApproval.findMany({ where, orderBy: { id: 'asc' } });
    const ledgerCount = await db.financeLedgerEntry.count({ where });
    const payoutCount = await db.payoutBatch.count({ where });
    await page(vendorB, { limit: 7 }); await list(vendorB);
    expect(await db.settlementApproval.findMany({ where, orderBy: { id: 'asc' } })).toEqual(before);
    expect(await db.financeLedgerEntry.count({ where })).toBe(ledgerCount);
    expect(await db.payoutBatch.count({ where })).toBe(payoutCount);
  });
  async function traverseFilters(query: Record<string, unknown>, expected = filterOrdered) {
    const ids: string[] = []; let cursor: string | null = null;
    do {
      const result = await page(filterVendor, { limit: 7, ...query, ...(cursor ? { cursor } : {}) });
      expect(result.approvals.length).toBeLessThanOrEqual(7);
      expect(result.approvals.every(row => row.vendorId === filterVendor)).toBe(true);
      ids.push(...result.approvals.map(row => row.id));
      expect(result.hasMore).toBe(result.nextCursor !== null);
      cursor = result.nextCursor;
      if (ids.length > filterFixtures.length) throw new Error('Unbounded or duplicate filtered traversal');
    } while (cursor);
    expect(ids).toEqual(expected.map(row => row.id));
    expect(new Set(ids).size).toBe(ids.length);
    return ids;
  }

  it.each(['DRAFT', 'APPROVED', 'CANCELLED'])('traverses every %s row across pages and equal timestamps', async (status) => {
    const expected = filterOrdered.filter(row => row.status === status);
    expect(expected.length).toBeGreaterThan(20);
    await traverseFilters({ status: status.toLowerCase() }, expected);
  });

  it.each(['2026-08-31', '2026-07-01', '2026-09', '2024-02-29', 'all', ' ', '2026-02-30']) (
    'matches literal period %j with every precedence/fallback across complete history', async (periodKey) => {
      const expected = filterOrdered.filter(row => rawPeriod(row) === periodKey);
      expect(expected.length).toBeGreaterThan(0);
      await traverseFilters({ periodKey }, expected);
    });

  it('filters an old unique cycle outside the first 20 and does not substitute its lower-priority dates', async () => {
    const target = filterOrdered.filter(row => row.scheduledCycleKey?.startsWith(`${prefix}-cycle`)).at(-1)!;
    expect(filterOrdered.indexOf(target)).toBeGreaterThan(20);
    await traverseFilters({ periodKey: target.scheduledCycleKey }, [target]);
    expect(rawPeriod(target)).not.toBe(target.scheduledPeriodEnd?.toISOString().slice(0, 10));
  });

  it('applies inclusive absolute high-value filtering including negative Int minimum, zero and currency independence', async () => {
    const expected = filterOrdered.filter(row => Math.abs(row.netPayableMinor) >= 100000);
    for (const amount of [100000, 100001, -100000, -100001, -2147483648])
      expect(expected.some(row => row.netPayableMinor === amount)).toBe(true);
    for (const amount of [99999, -99999, 0]) expect(expected.some(row => row.netPayableMinor === amount)).toBe(false);
    expect(new Set(expected.map(row => row.currency))).toEqual(new Set(['TRY', 'USD']));
    await traverseFilters({ highValueOnly: true }, expected);
    await traverseFilters({ status: 'all', highValueOnly: 'false' });
  });

  it.each([
    { status: 'draft', periodKey: '2026-09' },
    { status: 'approved', highValueOnly: true },
    { periodKey: '2026-08-31', highValueOnly: true },
    { status: 'draft', periodKey: '2026-09', highValueOnly: true },
  ])('ANDs all filters before bounded pagination: %j', async (query) => {
    const expected = filterOrdered.filter(row => (!query.status || row.status.toLowerCase() === query.status) &&
      (!query.periodKey || rawPeriod(row) === query.periodKey) &&
      (!query.highValueOnly || Math.abs(row.netPayableMinor) >= 100000));
    expect(expected.length).toBeGreaterThan(7);
    await traverseFilters(query, expected);
  });

  it('binds filtered cursors to Vendor, status, raw period and value, preserving unfiltered v1 continuation', async () => {
    const query = { status: 'draft', periodKey: '2026-09', highValueOnly: true, limit: 2 };
    const first = await page(filterVendor, query);
    expect(first.nextCursor).not.toBeNull();
    const cursor = first.nextCursor!;
    await expect(page(filterVendor, { ...query, status: 'DRAFT', highValueOnly: 'true', cursor }))
      .resolves.toMatchObject({ vendorId: filterVendor });
    for (const override of [{ status: 'approved' }, { status: 'all' }, { periodKey: '2026-08-31' },
      { periodKey: undefined }, { highValueOnly: false }, { limit: 3 }])
      await expect(page(filterVendor, { ...query, ...override, cursor })).rejects.toThrow('cursor');
    await expect(page(filterForeignVendor, { ...query, cursor })).rejects.toThrow('cursor');
    const old = await page(filterVendor, { limit: 2 });
    expect(JSON.parse(Buffer.from(old.nextCursor!, 'base64url').toString()).v).toBe(1);
    await expect(page(filterVendor, { limit: 2, status: 'all', highValueOnly: false, cursor: old.nextCursor })).resolves.toBeDefined();
    await expect(page(filterVendor, { ...query, cursor: old.nextCursor })).rejects.toThrow('cursor');
    expect(await page(filterVendor, { periodKey: 'no-such-cycle' })).toEqual({
      ok: true, writesPerformed: false, vendorId: filterVendor, approvals: [], hasMore: false, nextCursor: null,
    });
  });

  it('preserves every stored settlement field, ledger and payout while applying filters', async () => {
    const where = { vendorId: { in: [filterVendor, filterForeignVendor] } };
    const before = await db.settlementApproval.findMany({ where, orderBy: { id: 'asc' } });
    const ledgers = await db.financeLedgerEntry.findMany({ where, orderBy: { id: 'asc' } });
    const payouts = await db.payoutBatch.findMany({ where, orderBy: { id: 'asc' } });
    await traverseFilters({ status: 'draft', periodKey: '2026-09', highValueOnly: true },
      filterOrdered.filter(row => row.status === 'DRAFT' && rawPeriod(row) === '2026-09' && Math.abs(row.netPayableMinor) >= 100000));
    await page(filterForeignVendor, { highValueOnly: true, periodKey: '2026-08-31' });
    expect(await db.settlementApproval.findMany({ where, orderBy: { id: 'asc' } })).toEqual(before);
    expect(await db.financeLedgerEntry.findMany({ where, orderBy: { id: 'asc' } })).toEqual(ledgers);
    expect(await db.payoutBatch.findMany({ where, orderBy: { id: 'asc' } })).toEqual(payouts);
  });

  async function traverseWorkflow(query: Record<string, unknown>) {
    const expected = workflowOrdered.filter(row => matchesWorkflow(row, String(query.workflow ?? 'all')) &&
      (!query.status || query.status === 'all' || row.status.toLowerCase() === String(query.status).toLowerCase()) &&
      (!query.periodKey || row.createdAt.toISOString().slice(0, 7) === query.periodKey) &&
      (!query.highValueOnly || Math.abs(row.netPayableMinor) >= 100000));
    const ids: string[] = []; let cursor: string | null = null;
    do {
      const result = await page(workflowVendor, { limit: 7, ...query, ...(cursor ? { cursor } : {}) });
      expect(result.approvals).toHaveLength(Math.min(7, expected.length - ids.length));
      for (const summary of result.approvals) {
        const raw = expected.find(row => row.id === summary.id)!;
        expect(raw).toBeDefined();
        expect(summary).toMatchObject({ vendorId: workflowVendor, status: raw.status.toLowerCase(),
          netPayableMinor: raw.netPayableMinor, lineCount: raw.hasLine ? 1 : 0 });
      }
      ids.push(...result.approvals.map(row => row.id));
      expect(result.hasMore).toBe(result.nextCursor !== null);
      cursor = result.nextCursor;
      if (ids.length > workflowOrdered.length) throw new Error('Unbounded/duplicate workflow traversal');
    } while (cursor);
    expect(ids).toEqual(expected.map(row => row.id));
    expect(new Set(ids).size).toBe(ids.length);
    return expected;
  }

  it.each(['all', 'ready_for_approval', 'needs_review', 'vendor_hold', 'approved', 'refund_review', 'paid'])(
    'matches existing summary workflow %s over complete history before paging', async (workflow) => {
      const matching = await traverseWorkflow({ workflow });
      if (workflow === 'refund_review' || workflow === 'paid') expect(matching).toEqual([]);
      else {
        expect(matching.length).toBeGreaterThan(20);
        for (const position of [20, 100, 500]) {
          expect(matching.some(row => workflowOrdered.indexOf(row) > position)).toBe(true);
        }
      }
    });

  it('includes credit-only and deduction-only lines in Hold, even cancelled credit lines counted by Summary', async () => {
    for (const row of correctionWorkflowFixtures) {
      const held = await page(workflowVendor, { workflow: 'needs_review', limit: 2 });
      expect(held.approvals).toContainEqual(expect.objectContaining({ id: row.id, lineCount: 1, netPayableMinor: 0 }));
      const ready = await page(workflowVendor, { workflow: 'ready_for_approval', limit: 100 });
      expect(ready.approvals.some(summary => summary.id === row.id)).toBe(false);
    }
    // Zero/negative empty summaries remain Ready; positive rows remain Ready even with lines.
    const ready = await traverseWorkflow({ workflow: 'ready_for_approval' });
    expect(ready.some(row => row.netPayableMinor <= 0 && !row.hasLine)).toBe(true);
    expect(ready.some(row => row.netPayableMinor > 0 && row.hasLine)).toBe(true);
    const held = await traverseWorkflow({ workflow: 'vendor_hold' });
    expect(held.some(row => row.status === 'APPROVED' && row.netPayableMinor <= 0 && row.hasLine)).toBe(true);
    expect(held.some(row => row.status === 'CANCELLED' && row.netPayableMinor > 0 && !row.hasLine)).toBe(true);
  });

  it.each([
    { workflow: 'ready_for_approval', status: 'draft' },
    { workflow: 'approved', status: 'cancelled' },
    { workflow: 'vendor_hold', highValueOnly: true },
    { workflow: 'needs_review', periodKey: '2025-01' },
    { workflow: 'ready_for_approval', status: 'draft', periodKey: '2025-01', highValueOnly: true },
  ])('combines workflow with all existing filters before pagination: %j', async (query) => {
    const rows = await traverseWorkflow(query);
    if (query.workflow === 'approved') expect(rows).toEqual([]);
    else expect(rows.length).toBeGreaterThan(7);
  });

  it('preserves v1/v2 cursors for all workflow while binding active workflow to a new v3 sequence', async () => {
    for (const filters of [{}, { status: 'draft', periodKey: '2025-01', highValueOnly: true }]) {
      const query = { ...filters, limit: 2 };
      const old = await page(workflowVendor, query);
      expect(JSON.parse(Buffer.from(old.nextCursor!, 'base64url').toString()).v).toBe(filters.status ? 2 : 1);
      const compatible = await page(workflowVendor, { ...query, workflow: 'all', cursor: old.nextCursor });
      expect(compatible.approvals.map(row => row.id)).toEqual((await page(workflowVendor, { ...query, cursor: old.nextCursor })).approvals.map(row => row.id));
      const active = { ...query, workflow: 'ready_for_approval' };
      await expect(page(workflowVendor, { ...active, cursor: old.nextCursor })).rejects.toThrow('cursor');
      const first = await page(workflowVendor, active);
      const decoded = JSON.parse(Buffer.from(first.nextCursor!, 'base64url').toString());
      expect(decoded).toMatchObject({ v: 3, workflow: 'ready_for_approval' });
      await expect(page(workflowVendor, { ...active, cursor: first.nextCursor })).resolves.toBeDefined();
      for (const changes of [{ workflow: 'needs_review' }, { workflow: 'all' }, { workflow: undefined },
        { status: 'cancelled' }, { periodKey: '2026-10' }, { highValueOnly: !filters.highValueOnly }, { limit: 3 }])
        await expect(page(workflowVendor, { ...active, ...changes, cursor: first.nextCursor })).rejects.toThrow('cursor');
      await expect(page(workflowForeign, { ...active, cursor: first.nextCursor })).rejects.toThrow('cursor');
    }
    const foreign = await page(workflowForeign, { workflow: 'approved', limit: 2 });
    expect(foreign.approvals.every(row => row.vendorId === workflowForeign)).toBe(true);
    await expect(page(workflowVendor, { workflow: 'approved', limit: 2, cursor: foreign.nextCursor })).rejects.toThrow('cursor');
    for (const workflow of ['', 'PAID', null, ['approved'], 'unknown'])
      await expect(page(workflowVendor, { workflow })).rejects.toThrow('workflow');
  });

  it('does not modify any settlement, line, ledger or payout fields while filtering workflows', async () => {
    const where = { vendorId: { in: [workflowVendor, workflowForeign] } };
    const snapshot = async () => ({
      settlements: await db.settlementApproval.findMany({ where, orderBy: { id: 'asc' }, include: {
        lines: { orderBy: { id: 'asc' } }, correctionCreditLines: { orderBy: { id: 'asc' } }, correctionDeductionLines: { orderBy: { id: 'asc' } },
      } }),
      ledger: await db.financeLedgerEntry.findMany({ where, orderBy: { id: 'asc' } }),
      payouts: await db.payoutBatch.findMany({ where, orderBy: { id: 'asc' } }),
    });
    const before = await snapshot();
    for (const workflow of ['all', 'ready_for_approval', 'needs_review', 'vendor_hold', 'approved', 'refund_review', 'paid'])
      await page(workflowVendor, { workflow, highValueOnly: true });
    expect(await snapshot()).toEqual(before);
  });

  it('searches complete historical IDs case-insensitively before paging, with all filters and unchanged financial rows', async () => {
    const before = await db.settlementApproval.findMany({ where: { vendorId: workflowVendor }, orderBy: { id: 'asc' } });
    const collect = async (query: Record<string, unknown>) => {
      const ids: string[] = []; let cursor: string | null = null;
      do {
        const result = await page(workflowVendor, { limit: 7, ...query, ...(cursor ? { cursor } : {}) });
        expect(result.approvals.every(row => row.vendorId === workflowVendor)).toBe(true);
        ids.push(...result.approvals.map(row => row.id)); cursor = result.nextCursor;
        if (ids.length > workflowOrdered.length) throw new Error('Unbounded search');
      } while (cursor);
      return ids;
    };
    const term = `${prefix}-workflow-`;
    expect(await collect({ searchId: `  ${term.toUpperCase()}  ` })).toEqual(workflowOrdered.map(row => row.id));
    for (const position of [20, 100, 500])
      expect((await collect({ searchId: workflowOrdered[position].id })).includes(workflowOrdered[position].id)).toBe(true);
    for (const filters of [{ status: 'draft' }, { periodKey: '2025-01' }, { highValueOnly: true },
      { workflow: 'ready_for_approval' }, { status: 'draft', periodKey: '2025-01', highValueOnly: true, workflow: 'ready_for_approval' }]) {
      const expected = workflowOrdered.filter(row => (!filters.status || row.status === 'DRAFT') &&
        (!filters.periodKey || row.createdAt.toISOString().slice(0, 7) === filters.periodKey) &&
        (!filters.highValueOnly || Math.abs(row.netPayableMinor) >= 100000) &&
        (!filters.workflow || matchesWorkflow(row, filters.workflow)));
      expect(await collect({ searchId: term, ...filters })).toEqual(expected.map(row => row.id));
    }
    expect(await collect({ searchId: 'no-such-id' })).toEqual([]);
    expect(await collect({ searchId: term, workflow: 'approved', status: 'cancelled' })).toEqual([]);
    const query = { searchId: term, limit: 2 };
    const first = await page(workflowVendor, query);
    await expect(page(workflowVendor, { ...query, searchId: 'other', cursor: first.nextCursor })).rejects.toThrow('cursor');
    await expect(page(workflowForeign, { ...query, cursor: first.nextCursor })).rejects.toThrow('cursor');
    for (const base of [{}, { status: 'draft' }, { workflow: 'ready_for_approval' }]) {
      const old = await page(workflowVendor, { ...base, limit: 2 });
      await expect(page(workflowVendor, { ...base, limit: 2, searchId: '   ', cursor: old.nextCursor })).resolves.toBeDefined();
      await expect(page(workflowVendor, { ...base, limit: 2, searchId: term, cursor: old.nextCursor })).rejects.toThrow('cursor');
    }
    expect(await db.settlementApproval.findMany({ where: { vendorId: workflowVendor }, orderBy: { id: 'asc' } })).toEqual(before);
  });

  it('treats SQL percent, underscore and backslash literally in real PostgreSQL ID search', async () => {
    const vendorId = `${prefix}-wildcards`;
    await db.vendor.create({ data: { id: vendorId, name: vendorId } });
    const ids = [`${prefix}-A%B`, `${prefix}-A_B`, `${prefix}-A\\B`, `${prefix}-AxB`];
    await db.settlementApproval.createMany({ data: ids.map(id => ({ ...fixtures[0], id, vendorId })) });
    for (const [searchId, expected] of [['%', ids[0]], ['_', ids[1]], ['\\', ids[2]]] as const) {
      const result = await page(vendorId, { searchId });
      expect(result.approvals.map(row => row.id)).toEqual([expected]);
    }
  });

  it('scans full Search in bounded batches with exact JS semantics, sparse continuation and query binding', async () => {
    const searchPage = async (query: Record<string, unknown>) => {
      const result = await list(workflowVendor, { pagination: 'cursor', ...query });
      if (!('searchState' in result)) throw new Error('Full Search response required');
      expect(result.candidatesScanned).toBeLessThanOrEqual(200);
      expect(result.candidateBatchCount).toBe(1);
      return result;
    };
    const collect = async (query: Record<string, unknown>) => {
      const ids: string[] = []; let cursor: string | null = null; let batches = 0, scanned = 0;
      do {
        const result = await searchPage({ ...query, ...(cursor ? { cursor } : {}) });
        ids.push(...result.approvals.map(row => row.id)); batches++; scanned += result.candidatesScanned;
        expect(result.approvals.every(row => row.vendorId === workflowVendor)).toBe(true);
        if (result.searchState === 'MORE_CANDIDATES') expect(result.hasMore).toBeNull();
        if (result.searchState === 'EXHAUSTED') expect(result.nextCursor).toBeNull();
        cursor = result.nextCursor;
        if (batches > 100) throw new Error('Unbounded continuation');
      } while (cursor);
      expect(new Set(ids).size).toBe(ids.length);
      return { ids, batches, scanned };
    };
    const before = await db.settlementApproval.findMany({ where: { vendorId: workflowVendor }, orderBy: { id: 'asc' } });
    const all = await collect({ search: '', limit: 100 });
    expect(all.ids).toEqual(workflowOrdered.map(row => row.id));
    const sparse = await collect({ search: workflowOrdered.at(-1)!.id, limit: 20 });
    expect(sparse.ids).toEqual([workflowOrdered.at(-1)!.id]);
    expect(sparse.batches).toBe(4); expect(sparse.scanned).toBe(605);
    console.info('Full Search measured sparse scan', sparse.batches, sparse.scanned);
    expect((await collect({ search: 'No Such Match' })).ids).toEqual([]);
    expect((await collect({ search: '  WORKSPACE İ_ΟΣ  ', searchVendorName: 'Workspace İ_ΟΣ', limit: 100 })).ids).toEqual(workflowOrdered.map(row => row.id));
    expect((await collect({ search: workflowVendor.toUpperCase(), limit: 100 })).ids).toEqual(workflowOrdered.map(row => row.id));
    const drafts = workflowOrdered.filter(row => row.status === 'APPROVED');
    expect((await collect({ search: 'app', limit: 100 })).ids).toEqual(drafts.map(row => row.id));
    expect((await collect({ search: 'app', status: 'draft' })).ids).toEqual([]);
    expect((await collect({ search: '1', status: 'draft', periodKey: '2025-01', highValueOnly: true, workflow: 'ready_for_approval', limit: 100 })).ids)
      .toEqual(workflowOrdered.filter(row => row.status === 'DRAFT' && row.createdAt.getUTCFullYear() === 2025 && Math.abs(row.netPayableMinor) >= 100000 && matchesWorkflow(row, 'ready_for_approval')).map(row => row.id));
    const initial = await searchPage({ search: '', limit: 2 });
    for (const change of [{ search: 'x' }, { searchVendorName: 'different' }, { status: 'draft' }, { periodKey: '2025-01' },
      { highValueOnly: true }, { workflow: 'approved' }, { limit: 3 }])
      await expect(searchPage({ search: '', limit: 2, ...change, cursor: initial.nextCursor })).rejects.toThrow('cursor');
    await expect(list(workflowForeign, { pagination: 'cursor', search: '', limit: 2, cursor: initial.nextCursor })).rejects.toThrow('cursor');
    for (const query of [{ search: null }, { search: ['x'] }, { search: 'x'.repeat(513) }, { search: 'x', searchVendorName: 1 }])
      await expect(list(workflowVendor, { pagination: 'cursor', ...query })).rejects.toThrow();
    expect(await db.settlementApproval.findMany({ where: { vendorId: workflowVendor }, orderBy: { id: 'asc' } })).toEqual(before);
  });

  it('matches Unicode, literal patterns, actual UTC labels and decimal line-count substrings on PostgreSQL', async () => {
    const { settlementSummaryPeriodLabel } = await import('../backend/src/modules/finance/settlement-search-presentation.js');
    const literalPrefix = prefix.replace(/[0-9]/g, 'x');
    const vendorId = `${literalPrefix}-full-exact`;
    await db.vendor.create({ data: { id: vendorId, name: vendorId } });
    const rows = [
      { ...fixtures[0], id: `${literalPrefix}-İ_ΟΣ%\\`, vendorId, scheduledCycleKey: 'İ_ΟΣ%\\', createdAt: new Date('2026-12-31T23:59:00Z') },
      { ...fixtures[0], id: `${literalPrefix}-utc-end`, vendorId, scheduledPeriodEnd: new Date('2027-01-01T00:00:00Z') },
      { ...fixtures[0], id: `${literalPrefix}-utc-run`, vendorId, scheduledRunDate: new Date('2024-02-29T00:00:00Z') },
    ];
    await db.settlementApproval.createMany({ data: rows });
    await db.financeLedgerEntry.createMany({ data: Array.from({ length: 101 }, (_, i) => ({ id: `${vendorId}-ledger-${i}`, vendorId, entryType: 'sale', amount: '1' })) });
    await db.settlementApprovalLine.createMany({ data: Array.from({ length: 101 }, (_, i) => ({
      settlementApprovalId: rows[0].id, financeLedgerEntryId: `${vendorId}-ledger-${i}`, lineType: 'SALE' as const,
      amountMinor: 100, commissionMinor: 0, commissionVatMinor: 0, payableImpactMinor: 100, sourceSnapshotJson: {},
    })) });
    for (const search of ['i̇', 'ος', '%', '\\', '01']) {
      const result = await list(vendorId, { pagination: 'cursor', search });
      expect(result.approvals.some(row => row.id === rows[0].id)).toBe(true);
    }
    for (const row of rows.slice(1)) {
      const label = settlementSummaryPeriodLabel({ createdAt: row.createdAt.toISOString(),
        scheduledPeriodEnd: row.scheduledPeriodEnd?.toISOString(), scheduledRunDate: row.scheduledRunDate?.toISOString() });
      expect((await list(vendorId, { pagination: 'cursor', search: label })).approvals.map(item => item.id)).toEqual([row.id]);
    }
  });

});
