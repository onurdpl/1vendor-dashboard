import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '../backend/node_modules/@prisma/client/index.js';

const databaseUrl = process.env.TEST_DATABASE_URL?.trim();
const suite = databaseUrl ? describe : describe.skip;
const databaseName = 'settlement_utc_boundary_validation';
const millisecondsPerDay = 86_400_000;

suite('scheduled settlement UTC day-end baseline (PostgreSQL 16 or 18)', () => {
  let db: PrismaClient;
  let schedule: typeof import('../backend/src/modules/finance/settlement-schedule.service.js');
  let job: typeof import('../backend/src/modules/finance/settlement-schedule-job.service.js');
  let approval: typeof import('../backend/src/modules/finance/settlement-approval.service.js');
  let recordDelivery: typeof import('../backend/src/modules/shipping/allocation-delivered-observation.service.js')['recordVerifiedDeliveredObservation'];
  let sequence = 0;
  const root = `utc-boundary-${process.pid}-${Date.now()}`;

  beforeAll(async () => {
    const target = new URL(databaseUrl!);
    if (process.env.SETTLEMENT_UTC_BOUNDARY_TEST_DATABASE_ISOLATED !== '1' ||
        target.protocol !== 'postgresql:' || target.hostname !== '127.0.0.1' ||
        target.pathname.slice(1) !== databaseName || !target.port) {
      throw new Error('UTC boundary verification requires the dedicated local settlement_utc_boundary_validation database.');
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
    [schedule, job, approval, { recordVerifiedDeliveredObservation: recordDelivery }] = await Promise.all([
      import('../backend/src/modules/finance/settlement-schedule.service.js'),
      import('../backend/src/modules/finance/settlement-schedule-job.service.js'),
      import('../backend/src/modules/finance/settlement-approval.service.js'),
      import('../backend/src/modules/shipping/allocation-delivered-observation.service.js'),
    ]);
  });

  afterEach(async () => {
    vi.useRealTimers();
    await db.vendorFinancialProfile.updateMany({
      where: { vendorId: { startsWith: root } }, data: { active: false },
    });
  });

  afterAll(async () => {
    await db?.$disconnect();
    const { prisma } = await import('../backend/src/db/prisma.js');
    await prisma.$disconnect();
  });

  async function fixture(labels: Array<'late' | 'ready'>) {
    const prefix = `${root}-${++sequence}`;
    const candidates: Array<{
      label: 'late' | 'ready'; vendorId: string; allocationId: string; ledgerId: string;
      observationId: string; observedAt: Date; delayDays: number; eligibleAt: Date;
    }> = [];
    for (const label of labels) {
      const vendorId = `${prefix}-${label}-vendor`;
      const orderId = `${prefix}-${label}-order`;
      const allocationId = `${prefix}-${label}-allocation`;
      const executionId = `${prefix}-${label}-execution`;
      const shipmentReference = `${prefix}-${label}-shipment`;
      await db.vendor.create({ data: { id: vendorId, name: vendorId } });
      await db.vendorFinancialProfile.create({ data: {
        vendorId, settlementDelayDays: label === 'late' ? 0 : 21,
        settlementFrequencyType: 'WEEKLY', weeklySettlementDay: 'WEDNESDAY',
        autoSettlementDraftEnabled: true,
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
        outboundIntegrationProvider: null, shipmentExecutionId: executionId,
        sourceReference: shipmentReference,
      });
      candidates.push({
        label, vendorId, allocationId, ledgerId: `${prefix}-${label}-sale`,
        observationId: observation.id, observedAt: observation.firstObservedDeliveredAt,
        delayDays: 0, eligibleAt: observation.firstObservedDeliveredAt,
      });
    }

    // Always select the next Wednesday, so the real database observation precedes the
    // scheduled day even when the fixture runs across a UTC midnight boundary.
    const latestObservation = new Date(Math.max(...candidates.map((item) => item.observedAt.getTime())));
    const runDate = new Date(Date.UTC(
      latestObservation.getUTCFullYear(), latestObservation.getUTCMonth(), latestObservation.getUTCDate(),
    ));
    runDate.setUTCDate(runDate.getUTCDate() + ((3 - runDate.getUTCDay() + 7) % 7 || 7));
    const runDateKey = runDate.toISOString().slice(0, 10);
    const periodEnd = new Date(runDate.getTime() + millisecondsPerDay - 1);

    for (const candidate of candidates) {
      const observationDay = Date.UTC(candidate.observedAt.getUTCFullYear(),
        candidate.observedAt.getUTCMonth(), candidate.observedAt.getUTCDate());
      candidate.delayDays = candidate.label === 'late'
        ? (runDate.getTime() - observationDay) / millisecondsPerDay : 0;
      candidate.eligibleAt = new Date(candidate.observedAt.getTime() + candidate.delayDays * millisecondsPerDay);
      await db.fulfillment.create({ data: {
        id: `${candidate.allocationId}-fulfillment`, vendorAllocationId: candidate.allocationId,
        fulfillmentStatus: 'Delivered', shipmentUpdatedAt: new Date(),
      } });
      await db.financeLedgerEntry.create({ data: {
        id: candidate.ledgerId, vendorAllocationId: candidate.allocationId,
        vendorId: candidate.vendorId, entryType: 'sale', amount: '200.00',
        payoutStatus: 'PENDING', settlementStatus: 'PENDING',
        commissionPercentSnapshot: '10.00', commissionVatPercentSnapshot: '20.00',
        settlementDelayDaysSnapshot: candidate.delayDays,
      } });
      expect(candidate.observedAt.getTime()).toBeLessThanOrEqual(periodEnd.getTime());
      expect(candidate.eligibleAt.getTime()).toBeLessThanOrEqual(periodEnd.getTime());
    }
    expect(Date.now()).toBeLessThan(runDate.getTime());
    return { runDate, runDateKey, periodEnd, candidates };
  }

  it('rejects early scheduled DRAFTs for both future-maturing and already-mature SALEs', async () => {
    const f = await fixture(['late', 'ready']);
    const [late, ready] = f.candidates;
    expect(late.eligibleAt.getTime()).toBeGreaterThan(Date.now());
    expect(ready.eligibleAt.getTime()).toBeLessThanOrEqual(Date.now());
    expect(await db.settlementApproval.count({ where: {
      vendorId: { in: f.candidates.map((candidate) => candidate.vendorId) },
    } })).toBe(0);
    const manualNow = await approval.previewApproval(late.vendorId);
    expect(manualNow.summary.eligibleRowCount).toBe(0);
    const dryRun = await schedule.getSettlementScheduleDryRun({ runDate: f.runDateKey });
    expect(dryRun.writesPerformed).toBe(false);
    expect(await db.settlementApproval.count({ where: {
      vendorId: { in: f.candidates.map((candidate) => candidate.vendorId) },
    } })).toBe(0);
    expect(dryRun.periodEnd).toBe(f.periodEnd.toISOString());
    expect(dryRun.scheduledDraftCreationAllowed).toBe(false);
    expect(dryRun.scheduledDraftAvailableAt).toBe(new Date(f.periodEnd.getTime() + 1).toISOString());
    for (const candidate of f.candidates) {
      const result = dryRun.vendors.find((vendor) => vendor.vendorId === candidate.vendorId);
      expect(result).toMatchObject({ state: 'READY', canCreateDraft: true });
      expect(result?.preview?.lines.map((line) => line.financeLedgerEntryId)).toEqual([candidate.ledgerId]);
      expect(result?.preview?.summary.netPayableMinor).toBe(17_600);
    }

    await expect(schedule.createSettlementScheduleDrafts({
      runDate: f.runDateKey, confirmAutoSettlementDrafts: true,
    })).rejects.toThrow(/cannot be created before .*UTC day end/);
    for (const candidate of f.candidates) {
      expect(await db.settlementApproval.count({ where: { vendorId: candidate.vendorId } })).toBe(0);
      const ledger = await db.financeLedgerEntry.findUniqueOrThrow({ where: { id: candidate.ledgerId } });
      const observation = await db.allocationDeliveredObservation.findUniqueOrThrow({
        where: { vendorAllocationId: candidate.allocationId },
      });
      expect(ledger.vendorId).toBe(candidate.vendorId);
      expect(ledger.settlementDelayDaysSnapshot).toBe(candidate.delayDays);
      expect(observation.id).toBe(candidate.observationId);
      expect(observation.firstObservedDeliveredAt).toEqual(candidate.observedAt);
      expect(ledger.settlementStatus).toBe('PENDING');
    }
    expect(await db.settlementApprovalLine.count({ where: { financeLedgerEntryId: { in: f.candidates.map((item) => item.ledgerId) } } })).toBe(0);
    expect(await db.payoutBatch.count()).toBe(0);
    expect(await db.financialCorrectionAuthority.count()).toBe(0);
  });

  it('keeps a read-only scheduled preview and an unscheduled manual DRAFT independent', async () => {
    const f = await fixture(['late', 'ready']);
    const [late, ready] = f.candidates;
    const before = await db.settlementApproval.count();
    const dryRun = await schedule.getSettlementScheduleDryRun({ runDate: f.runDateKey });
    expect(dryRun.writesPerformed).toBe(false);
    expect(await db.settlementApproval.count()).toBe(before);
    await expect(approval.createDraftApproval({ vendorId: late.vendorId }))
      .rejects.toThrow('No eligible settlement rows are available for approval.');
    const manualDraft = await approval.createDraftApproval({ vendorId: ready.vendorId });
    expect(manualDraft.status).toBe('draft');
    expect(manualDraft.lines.map((line) => line.financeLedgerEntryId)).toEqual([ready.ledgerId]);
    const persisted = await db.settlementApproval.findUniqueOrThrow({ where: { id: manualDraft.id } });
    expect(persisted.scheduledCycleKey).toBeNull();
    expect(persisted.scheduledRunDate).toBeNull();
  });

  it('does not consume JobRun identity before day end and accepts a later same-date run', async () => {
    const f = await fixture(['ready']);
    const [ready] = f.candidates;
    const input = {
      env: { SETTLEMENT_AUTO_DRAFT_JOB_ENABLED: true, SETTLEMENT_AUTO_DRAFT_JOB_DRY_RUN: false },
      runDate: f.runDateKey, confirmScheduledSettlementAutoDraftJob: true,
    };
    await expect(job.runSettlementScheduleAutoDraftJob(input)).rejects.toThrow(/UTC day end/);
    expect(await db.settlementScheduleJobRun.count({ where: { runDate: f.runDate } })).toBe(0);
    expect(await db.settlementApproval.count({ where: { vendorId: ready.vendorId } })).toBe(0);
    const afterMidnight = new Date(f.periodEnd.getTime() + 1);
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(afterMidnight);
      const first = await job.runSettlementScheduleAutoDraftJob(input);
      expect(first.writesPerformed).toBe(true);
      expect(first.jobRun?.status).toBe('COMPLETED');
      expect(first.summary.createdDrafts).toBe(1);
      expect(first.vendors.find((vendor) => vendor.vendorId === ready.vendorId)?.state).not.toBe('READY');
      const second = await job.runSettlementScheduleAutoDraftJob(input);
      expect(second.writesPerformed).toBe(false);
      expect(await db.settlementApproval.count({ where: { vendorId: ready.vendorId } })).toBe(1);
      expect(await db.settlementScheduleJobRun.count({ where: { runDate: f.runDate } })).toBe(1);
      vi.setSystemTime(f.periodEnd);
      const existingEvenBeforeMidnight = await job.runSettlementScheduleAutoDraftJob(input);
      expect(existingEvenBeforeMidnight.writesPerformed).toBe(false);
      expect(await db.settlementScheduleJobRun.count({ where: { runDate: f.runDate } })).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('persists autonomous origin with the exact DRAFT even when JobRun evidence is incomplete', async () => {
    const f = await fixture(['ready']);
    const vendorId = f.candidates[0].vendorId;
    const existingRunCount = await db.settlementScheduleJobRun.count({ where: { runDate: f.runDate } });
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(f.periodEnd.getTime() + 1));
    const created = await schedule.createAutonomousSettlementScheduleDrafts({
      runDate: f.runDateKey, vendorId, confirmAutoSettlementDrafts: true,
      createdBy: 'forged-admin-id',
    });
    expect(created.summary.created).toBe(1);
    const row = await db.settlementApproval.findUniqueOrThrow({
      where: { id: created.createdDrafts[0].settlementApprovalId }, include: { lines: true },
    });
    expect(row).toMatchObject({
      vendorId, status: 'DRAFT', creationOrigin: 'AUTONOMOUS_SCHEDULER',
      scheduledCycleKey: `scheduled-settlement:${vendorId}:${f.runDateKey}`,
      grossSalesMinor: 20_000, netPayableMinor: 17_600,
    });
    expect(row.lines.map((line) => line.financeLedgerEntryId)).toEqual([f.candidates[0].ledgerId]);
    await expect(db.$executeRaw`
      UPDATE "SettlementApproval" SET "creationOrigin" = NULL WHERE "id" = ${row.id}
    `).rejects.toThrow(/creation origin is immutable/);
    await expect(db.$executeRaw`
      UPDATE "SettlementApproval" SET "creationOrigin" = 'ADMIN_SCHEDULED'::"SettlementDraftCreationOrigin"
      WHERE "id" = ${row.id}
    `).rejects.toThrow(/creation origin is immutable/);
    expect(await db.settlementScheduleJobRun.count({ where: { runDate: f.runDate } })).toBe(existingRunCount);
    const replay = await schedule.createAutonomousSettlementScheduleDrafts({
      runDate: f.runDateKey, vendorId, confirmAutoSettlementDrafts: true,
    });
    expect(replay.summary.created).toBe(0);
    const afterReplay = await db.settlementApproval.findUniqueOrThrow({ where: { id: row.id }, include: { lines: true } });
    expect(afterReplay.creationOrigin).toBe('AUTONOMOUS_SCHEDULER');
    expect(afterReplay.sourceSnapshotJson).toEqual(row.sourceSnapshotJson);
    expect(afterReplay.lines).toEqual(row.lines);
    expect(await db.settlementCommissionInvoice.count({ where: { settlementApprovalId: row.id } })).toBe(0);
    expect(await db.payoutBatch.count({ where: { vendorId } })).toBe(0);
  });

  it('separates Admin scheduled, verified Admin manual, and unverified service origins', async () => {
    const scheduled = await fixture(['ready']);
    const manual = await fixture(['ready']);
    const unverified = await fixture(['ready']);
    const adminVendorId = scheduled.candidates[0].vendorId;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(scheduled.periodEnd.getTime() + 1));
    const admin = await schedule.createAdminSettlementScheduleDrafts({
      runDate: scheduled.runDateKey, vendorId: adminVendorId, confirmAutoSettlementDrafts: true,
      createdBy: 'system:settlement_auto_draft_scheduler',
    });
    expect(admin.summary.created).toBe(1);
    const adminRow = await db.settlementApproval.findUniqueOrThrow({
      where: { id: admin.createdDrafts[0].settlementApprovalId },
    });
    expect(adminRow.creationOrigin).toBe('ADMIN_SCHEDULED');
    await expect(db.$executeRaw`
      UPDATE "SettlementApproval" SET "creationOrigin" = 'AUTONOMOUS_SCHEDULER'::"SettlementDraftCreationOrigin"
      WHERE "id" = ${adminRow.id}
    `).rejects.toThrow(/creation origin is immutable/);

    const manualVendorId = manual.candidates[0].vendorId;
    const verified = await approval.createAdminManualDraftApproval({ vendorId: manualVendorId });
    expect((await db.settlementApproval.findUniqueOrThrow({ where: { id: verified.id } })).creationOrigin)
      .toBe('ADMIN_MANUAL');

    const unknown = await approval.createDraftApproval({ vendorId: unverified.candidates[0].vendorId });
    expect((await db.settlementApproval.findUniqueOrThrow({ where: { id: unknown.id } })).creationOrigin)
      .toBeNull();
  });

  it('does not trust forged job actor strings and keeps autonomous origin immutable in PostgreSQL', async () => {
    const f = await fixture(['ready']);
    const vendorId = f.candidates[0].vendorId;
    const latestJob = await db.settlementScheduleJobRun.aggregate({ _max: { runDate: true } });
    const uniqueRunDate = new Date(Math.max(f.runDate.getTime() + 140 * millisecondsPerDay,
      (latestJob._max.runDate?.getTime() ?? 0) + 7 * millisecondsPerDay));
    uniqueRunDate.setUTCDate(uniqueRunDate.getUTCDate() + ((3 - uniqueRunDate.getUTCDay() + 7) % 7));
    const uniqueRunDateKey = uniqueRunDate.toISOString().slice(0, 10);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(uniqueRunDate.getTime() + millisecondsPerDay));
    const forged = await job.runSettlementScheduleAutoDraftJob({
      env: { SETTLEMENT_AUTO_DRAFT_JOB_ENABLED: true, SETTLEMENT_AUTO_DRAFT_JOB_DRY_RUN: false },
      runDate: uniqueRunDateKey, confirmScheduledSettlementAutoDraftJob: true,
      triggeredBy: 'system:settlement_auto_draft_scheduler',
    });
    expect(forged.summary.createdDrafts).toBe(1);
    const id = forged.vendors.find((item) => item.vendorId === vendorId)?.createdSettlementApprovalId;
    expect(id).toBeTruthy();
    expect((await db.settlementApproval.findUniqueOrThrow({ where: { id: id! } })).creationOrigin).toBeNull();
    await expect(db.$executeRaw`
      UPDATE "SettlementApproval" SET "creationOrigin" = 'AUTONOMOUS_SCHEDULER'::"SettlementDraftCreationOrigin"
      WHERE "id" = ${id!}
    `).rejects.toThrow(/creation origin is immutable/);
    await db.settlementApproval.update({ where: { id: id! }, data: { notes: 'status-update-control' } });
    expect((await db.settlementApproval.findUniqueOrThrow({ where: { id: id! } })).creationOrigin).toBeNull();
  });

  it('keeps Admin-triggered job provenance distinct even with a forged scheduler-looking actor', async () => {
    const f = await fixture(['ready']);
    const vendorId = f.candidates[0].vendorId;
    const latestJob = await db.settlementScheduleJobRun.aggregate({ _max: { runDate: true } });
    const runDate = new Date(Math.max(f.runDate.getTime() + 210 * millisecondsPerDay,
      (latestJob._max.runDate?.getTime() ?? 0) + 7 * millisecondsPerDay));
    runDate.setUTCDate(runDate.getUTCDate() + ((3 - runDate.getUTCDay() + 7) % 7));
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(runDate.getTime() + millisecondsPerDay));
    const result = await job.runAdminSettlementScheduleAutoDraftJob({
      env: { SETTLEMENT_AUTO_DRAFT_JOB_ENABLED: true, SETTLEMENT_AUTO_DRAFT_JOB_DRY_RUN: false },
      runDate: runDate.toISOString().slice(0, 10), confirmScheduledSettlementAutoDraftJob: true,
      triggeredBy: 'system:settlement_auto_draft_scheduler',
    });
    expect(result.summary.createdDrafts).toBe(1);
    const id = result.vendors.find((item) => item.vendorId === vendorId)?.createdSettlementApprovalId;
    expect(id).toBeTruthy();
    expect(await db.settlementApproval.findUniqueOrThrow({ where: { id: id! } })).toMatchObject({
      vendorId, status: 'DRAFT', creationOrigin: 'ADMIN_SCHEDULED',
    });
  });

  it('runs the trusted scheduler path and retains provenance across manual approval', async () => {
    const f = await fixture(['ready']);
    const vendorId = f.candidates[0].vendorId;
    const latestJob = await db.settlementScheduleJobRun.aggregate({ _max: { runDate: true } });
    const runDate = new Date(Math.max(f.runDate.getTime() + 280 * millisecondsPerDay,
      (latestJob._max.runDate?.getTime() ?? 0) + 7 * millisecondsPerDay));
    runDate.setUTCDate(runDate.getUTCDate() + ((3 - runDate.getUTCDay() + 7) % 7));
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(runDate.getTime() + millisecondsPerDay));
    let onClose: ((instance: unknown, done: () => void) => void) | undefined;
    const app = { addHook: (_name: string, hook: typeof onClose) => { onClose = hook; } } as never;
    const { registerSettlementAutoDraftWriteScheduler } = await import(
      '../backend/src/modules/finance/settlement-auto-draft-write-scheduler.service.js');
    const scheduler = registerSettlementAutoDraftWriteScheduler(app, {
      SETTLEMENT_AUTO_DRAFT_WRITE_SCHEDULER_ENABLED: true,
      SETTLEMENT_AUTO_DRAFT_WRITE_SCHEDULER_UTC_TIME: '01:00',
      SETTLEMENT_AUTO_DRAFT_JOB_ENABLED: true,
      SETTLEMENT_AUTO_DRAFT_JOB_DRY_RUN: false,
    });
    expect(scheduler).not.toBeNull();
    try {
      const result = await scheduler!.runWriteTick(runDate.toISOString().slice(0, 10));
      expect(result?.summary.createdDrafts).toBe(1);
      const id = result?.vendors.find((item) => item.vendorId === vendorId)?.createdSettlementApprovalId;
      expect(id).toBeTruthy();
      const before = await db.settlementApproval.findUniqueOrThrow({ where: { id: id! }, include: { lines: true } });
      expect(before).toMatchObject({ status: 'DRAFT', creationOrigin: 'AUTONOMOUS_SCHEDULER', vendorId });
      expect(before.lines.map((line) => line.financeLedgerEntryId)).toEqual([f.candidates[0].ledgerId]);
      expect(await db.payoutBatch.count({ where: { vendorId } })).toBe(0);
      expect(await db.settlementCommissionInvoice.count({ where: { settlementApprovalId: id! } })).toBe(0);
      const approved = await approval.approveSettlementApproval(id!, 'test-admin');
      expect(approved.status).toBe('approved');
      expect(await db.settlementApproval.findUniqueOrThrow({ where: { id: id! } })).toMatchObject({
        status: 'APPROVED', creationOrigin: 'AUTONOMOUS_SCHEDULER', approvedBy: 'test-admin',
        grossSalesMinor: before.grossSalesMinor, netPayableMinor: before.netPayableMinor,
      });
    } finally {
      onClose?.(app, () => undefined);
    }
  });

  it('rolls back creation origin together with an uncommitted DRAFT', async () => {
    const f = await fixture(['ready']);
    const vendorId = f.candidates[0].vendorId;
    const id = `${vendorId}-rolled-back-approval`;
    await expect(db.$transaction(async (tx) => {
      await tx.settlementApproval.create({ data: {
        id, vendorId, status: 'DRAFT', creationOrigin: 'AUTONOMOUS_SCHEDULER',
        scheduledRunDate: f.runDate, scheduledPeriodEnd: f.periodEnd,
        scheduledCycleKey: `scheduled-settlement:${vendorId}:${f.runDateKey}`,
        periodEnd: f.periodEnd, currency: 'TRY', grossSalesMinor: 0, refundTotalMinor: 0,
        commissionMinor: 0, commissionVatMinor: 0, netPayableMinor: 0, sourceSnapshotJson: {},
      } });
      throw new Error('test rollback');
    })).rejects.toThrow('test rollback');
    expect(await db.settlementApproval.count({ where: { id } })).toBe(0);
    await expect(db.settlementApproval.create({ data: {
      id: `${id}-missing-schedule`, vendorId, status: 'DRAFT',
      creationOrigin: 'AUTONOMOUS_SCHEDULER', currency: 'TRY', grossSalesMinor: 0,
      refundTotalMinor: 0, commissionMinor: 0, commissionVatMinor: 0,
      netPayableMinor: 0, sourceSnapshotJson: {},
    } })).rejects.toThrow();
    expect(await db.settlementApproval.count({ where: { id: `${id}-missing-schedule` } })).toBe(0);
  });

  it('characterizes exact UTC midnight and later execution with a controlled application clock', async () => {
    const startOfDay = await fixture(['ready']);
    const beforeMidnight = await fixture(['ready']);
    const atMidnight = await fixture(['ready']);
    const afterMidnight = await fixture(['ready']);
    const fixtures = [startOfDay, beforeMidnight, atMidnight, afterMidnight];
    const latestObservation = new Date(Math.max(...fixtures.map((item) => item.candidates[0].observedAt.getTime())));
    const commonRunDate = new Date(Date.UTC(latestObservation.getUTCFullYear(),
      latestObservation.getUTCMonth(), latestObservation.getUTCDate()));
    commonRunDate.setUTCDate(commonRunDate.getUTCDate() + ((3 - commonRunDate.getUTCDay() + 7) % 7 || 7));
    const commonRunDateKey = commonRunDate.toISOString().slice(0, 10);
    const commonPeriodEnd = new Date(commonRunDate.getTime() + millisecondsPerDay - 1);
    expect(fixtures.every((item) => item.candidates[0].observedAt.getTime() < commonRunDate.getTime()))
      .toBe(true);
    const nextMidnight = new Date(commonPeriodEnd.getTime() + 1);
    expect(nextMidnight.toISOString()).toMatch(/T00:00:00\.000Z$/);
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(commonRunDate);
      await expect(schedule.createSettlementScheduleDrafts({
        runDate: commonRunDateKey, vendorId: startOfDay.candidates[0].vendorId,
        confirmAutoSettlementDrafts: true,
      })).rejects.toThrow(/UTC day end/);
      vi.setSystemTime(commonPeriodEnd);
      const oneMillisecondEarlyPreview = await schedule.getSettlementScheduleDryRun({
        runDate: commonRunDateKey, vendorId: beforeMidnight.candidates[0].vendorId,
      });
      expect(oneMillisecondEarlyPreview.scheduledDraftCreationAllowed).toBe(false);
      await expect(schedule.createSettlementScheduleDrafts({
        runDate: commonRunDateKey, vendorId: beforeMidnight.candidates[0].vendorId,
        confirmAutoSettlementDrafts: true,
      })).rejects.toThrow(/UTC day end/);
      vi.setSystemTime(nextMidnight);
      const atMidnightPreview = await schedule.getSettlementScheduleDryRun({
        runDate: commonRunDateKey, vendorId: atMidnight.candidates[0].vendorId,
      });
      expect(atMidnightPreview.scheduledDraftCreationAllowed).toBe(true);
      const atBoundary = await schedule.createSettlementScheduleDrafts({
        runDate: commonRunDateKey, vendorId: atMidnight.candidates[0].vendorId,
        confirmAutoSettlementDrafts: true,
      });
      expect(atBoundary.summary.created).toBe(1);
      vi.setSystemTime(new Date(nextMidnight.getTime() + 1));
      const afterBoundary = await schedule.createSettlementScheduleDrafts({
        runDate: commonRunDateKey, vendorId: afterMidnight.candidates[0].vendorId,
        confirmAutoSettlementDrafts: true,
      });
      expect(afterBoundary.summary.created).toBe(1);
      expect(await db.settlementApproval.count({ where: {
        vendorId: { in: [startOfDay, beforeMidnight, atMidnight, afterMidnight]
          .map((item) => item.candidates[0].vendorId) },
      } })).toBe(2);
      expect(await db.settlementApproval.count({ where: {
        vendorId: { in: [startOfDay, beforeMidnight].map((item) => item.candidates[0].vendorId) },
      } })).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('blocks direct scheduled approval metadata without affecting ordinary manual drafts', async () => {
    const f = await fixture(['ready']);
    const [ready] = f.candidates;
    const scheduled = {
      vendorId: ready.vendorId, periodEnd: f.periodEnd, asOfDate: f.periodEnd,
      scheduledRunDate: f.runDate, scheduledPeriodEnd: f.periodEnd,
      scheduledCycleKey: `scheduled-settlement:${ready.vendorId}:${f.runDateKey}`,
      candidateScope: 'date_range' as const,
    };
    await expect(approval.createDraftApproval(scheduled)).rejects.toThrow(/UTC day end/);
    await expect(approval.createDraftApproval({ vendorId: ready.vendorId,
      scheduledCycleKey: scheduled.scheduledCycleKey })).rejects.toThrow(/complete run date/);
    await expect(approval.createDraftApproval({ ...scheduled,
      periodEnd: new Date(f.periodEnd.getTime() + millisecondsPerDay),
    })).rejects.toThrow(/metadata does not match/);
    expect(await db.settlementApproval.count({ where: { vendorId: ready.vendorId } })).toBe(0);
    const manual = await approval.createDraftApproval({ vendorId: ready.vendorId });
    expect(manual.status).toBe('draft');
    expect(manual.lines.map((line) => line.financeLedgerEntryId)).toEqual([ready.ledgerId]);

    const later = await fixture(['ready']);
    const laterVendor = later.candidates[0];
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date(later.periodEnd.getTime() + 1));
      const direct = await approval.createDraftApproval({
        vendorId: laterVendor.vendorId, periodEnd: later.periodEnd, asOfDate: later.periodEnd,
        scheduledRunDate: later.runDate, scheduledPeriodEnd: later.periodEnd,
        scheduledCycleKey: `scheduled-settlement:${laterVendor.vendorId}:${later.runDateKey}`,
        candidateScope: 'date_range',
      });
      expect(direct.lines.map((line) => line.financeLedgerEntryId)).toEqual([laterVendor.ledgerId]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not turn an observation recorded today into historical run-date eligibility', async () => {
    const f = await fixture(['ready']);
    const historical = new Date(f.runDate.getTime() - 14 * millisecondsPerDay);
    expect(historical.getTime() + millisecondsPerDay - 1).toBeLessThan(f.candidates[0].observedAt.getTime());
    const historicalKey = historical.toISOString().slice(0, 10);
    const preview = await schedule.getSettlementScheduleDryRun({ runDate: historicalKey,
      vendorId: f.candidates[0].vendorId });
    expect(preview.writesPerformed).toBe(false);
    expect(preview.vendors[0]).toMatchObject({ due: true, canCreateDraft: false });
    const result = await schedule.createSettlementScheduleDrafts({
      runDate: historicalKey, vendorId: f.candidates[0].vendorId, confirmAutoSettlementDrafts: true,
    });
    expect(result.summary.created).toBe(0);
    expect(await db.settlementApproval.count({ where: { vendorId: f.candidates[0].vendorId } })).toBe(0);
  });
});
