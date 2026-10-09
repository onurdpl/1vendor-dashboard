import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '../backend/node_modules/@prisma/client/index.js';

const databaseUrl = process.env.TEST_DATABASE_URL?.trim();
const suite = databaseUrl ? describe : describe.skip;
const databaseName = 'settlement_utc_boundary_validation';
const millisecondsPerDay = 86_400_000;

suite('scheduled settlement UTC day-end baseline (PostgreSQL 16)', () => {
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

  it('characterizes the current pre-day-end DRAFT for both future-maturing and already-mature SALEs', async () => {
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
    for (const candidate of f.candidates) {
      const result = dryRun.vendors.find((vendor) => vendor.vendorId === candidate.vendorId);
      expect(result).toMatchObject({ state: 'READY', canCreateDraft: true });
      expect(result?.preview?.lines.map((line) => line.financeLedgerEntryId)).toEqual([candidate.ledgerId]);
      expect(result?.preview?.summary.netPayableMinor).toBe(17_600);
    }

    // Baseline characterization only: 3B2 must invert the premature-write assertion.
    const created = await schedule.createSettlementScheduleDrafts({
      runDate: f.runDateKey, confirmAutoSettlementDrafts: true,
    });
    expect(created.summary).toMatchObject({ created: 2, failed: 0 });
    expect(created.writesPerformed).toBe(true);
    for (const candidate of f.candidates) {
      const draft = await db.settlementApproval.findUniqueOrThrow({
        where: { scheduledCycleKey: `scheduled-settlement:${candidate.vendorId}:${f.runDateKey}` },
        include: { lines: true },
      });
      expect(draft.status).toBe('DRAFT');
      expect(draft.scheduledRunDate).toEqual(f.runDate);
      expect(draft.scheduledPeriodEnd).toEqual(f.periodEnd);
      expect(draft.netPayableMinor).toBe(17_600);
      expect(draft.lines.map((line) => line.financeLedgerEntryId)).toEqual([candidate.ledgerId]);
      expect(draft.createdAt.getTime()).toBeLessThan(f.periodEnd.getTime());
      const ledger = await db.financeLedgerEntry.findUniqueOrThrow({ where: { id: candidate.ledgerId } });
      const observation = await db.allocationDeliveredObservation.findUniqueOrThrow({
        where: { vendorAllocationId: candidate.allocationId },
      });
      expect(ledger.vendorId).toBe(candidate.vendorId);
      expect(ledger.settlementDelayDaysSnapshot).toBe(candidate.delayDays);
      expect(observation.id).toBe(candidate.observationId);
      expect(observation.firstObservedDeliveredAt).toEqual(candidate.observedAt);
      if (candidate.label === 'late') {
        expect(draft.createdAt.getTime()).toBeLessThan(candidate.eligibleAt.getTime());
      }
    }
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

  it('characterizes the direct job entry point and same-date idempotency before day end', async () => {
    const f = await fixture(['ready']);
    const [ready] = f.candidates;
    const input = {
      env: { SETTLEMENT_AUTO_DRAFT_JOB_ENABLED: true, SETTLEMENT_AUTO_DRAFT_JOB_DRY_RUN: false },
      runDate: f.runDateKey, confirmScheduledSettlementAutoDraftJob: true,
    };
    // Baseline characterization only: 3B2 must prohibit this early write.
    const first = await job.runSettlementScheduleAutoDraftJob(input);
    expect(first.writesPerformed).toBe(true);
    expect(first.jobRun?.status).toBe('COMPLETED');
    expect(first.summary.createdDrafts).toBe(1);
    expect(first.vendors.find((vendor) => vendor.vendorId === ready.vendorId)?.state).not.toBe('READY');
    const second = await job.runSettlementScheduleAutoDraftJob(input);
    expect(second.writesPerformed).toBe(false);
    expect(await db.settlementApproval.count({ where: { vendorId: ready.vendorId } })).toBe(1);
    expect(await db.settlementScheduleJobRun.count({ where: { runDate: f.runDate } })).toBe(1);
    const replay = await schedule.createSettlementScheduleDrafts({
      runDate: f.runDateKey, vendorId: ready.vendorId, confirmAutoSettlementDrafts: true,
    });
    expect(replay.summary.created).toBe(0);
    expect(replay.skipped).toHaveLength(1);
  });

  it('characterizes exact UTC midnight and later execution with a controlled application clock', async () => {
    const startOfDay = await fixture(['ready']);
    const beforeMidnight = await fixture(['ready']);
    const atMidnight = await fixture(['ready']);
    const afterMidnight = await fixture(['ready']);
    expect([beforeMidnight, atMidnight, afterMidnight].map((item) => item.runDateKey))
      .toEqual([startOfDay.runDateKey, startOfDay.runDateKey, startOfDay.runDateKey]);
    const nextMidnight = new Date(beforeMidnight.periodEnd.getTime() + 1);
    expect(nextMidnight.toISOString()).toMatch(/T00:00:00\.000Z$/);
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(startOfDay.runDate);
      const atStart = await schedule.createSettlementScheduleDrafts({
        runDate: startOfDay.runDateKey, vendorId: startOfDay.candidates[0].vendorId,
        confirmAutoSettlementDrafts: true,
      });
      expect(atStart.summary.created).toBe(1);
      vi.setSystemTime(beforeMidnight.periodEnd);
      // Existing service never reads the execution clock for this boundary.
      const early = await schedule.createSettlementScheduleDrafts({
        runDate: beforeMidnight.runDateKey, vendorId: beforeMidnight.candidates[0].vendorId,
        confirmAutoSettlementDrafts: true,
      });
      expect(early.summary.created).toBe(1);
      vi.setSystemTime(nextMidnight);
      const atBoundary = await schedule.createSettlementScheduleDrafts({
        runDate: atMidnight.runDateKey, vendorId: atMidnight.candidates[0].vendorId,
        confirmAutoSettlementDrafts: true,
      });
      expect(atBoundary.summary.created).toBe(1);
      vi.setSystemTime(new Date(nextMidnight.getTime() + 1));
      const afterBoundary = await schedule.createSettlementScheduleDrafts({
        runDate: afterMidnight.runDateKey, vendorId: afterMidnight.candidates[0].vendorId,
        confirmAutoSettlementDrafts: true,
      });
      expect(afterBoundary.summary.created).toBe(1);
      expect(await db.settlementApproval.count({ where: {
        vendorId: { in: [startOfDay, beforeMidnight, atMidnight, afterMidnight]
          .map((item) => item.candidates[0].vendorId) },
      } })).toBe(4);
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
