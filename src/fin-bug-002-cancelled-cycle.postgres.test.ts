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
    [schedule, job, approval, { recordVerifiedDeliveredObservation: recordDelivery }] = await Promise.all([
      import('../backend/src/modules/finance/settlement-schedule.service.js'),
      import('../backend/src/modules/finance/settlement-schedule-job.service.js'),
      import('../backend/src/modules/finance/settlement-approval.service.js'),
      import('../backend/src/modules/shipping/allocation-delivered-observation.service.js'),
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
    expect(runDate.getTime()).toBeGreaterThan(Date.now());
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
