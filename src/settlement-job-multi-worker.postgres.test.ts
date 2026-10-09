import { fork, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../backend/node_modules/@prisma/client/index.js';

const databaseUrl = process.env.TEST_DATABASE_URL?.trim();
const suite = databaseUrl ? describe : describe.skip;
const databaseName = 'settlement_job_concurrency_validation';
const workerPath = path.resolve(process.cwd(), 'src/test-support/settlement-job-race-worker.mjs');

type WorkerResult = {
  startedAt: number;
  endedAt: number;
  result: Awaited<ReturnType<typeof import('../backend/src/modules/finance/settlement-schedule-job.service.js')['runSettlementScheduleAutoDraftJob']>>;
};

suite('scheduled settlement job with two independent PostgreSQL workers', () => {
  let db: PrismaClient;
  let getStatus: typeof import('../backend/src/modules/finance/settlement-schedule-job.service.js')['getSettlementScheduleAutoDraftJobStatus'];
  let runJob: typeof import('../backend/src/modules/finance/settlement-schedule-job.service.js')['runSettlementScheduleAutoDraftJob'];
  let runDate: Date;
  let vendors: string[];
  let sourceByVendor: Map<string, string>;
  const children: ChildProcess[] = [];

  beforeAll(async () => {
    const target = new URL(databaseUrl!);
    if (process.env.SETTLEMENT_JOB_CONCURRENCY_TEST_DATABASE_ISOLATED !== '1' ||
        target.hostname !== '127.0.0.1' || target.pathname.slice(1) !== databaseName || !target.port) {
      throw new Error('Multi-worker verification requires isolated local settlement_job_concurrency_validation.');
    }
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = databaseUrl;
    db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await db.$connect();
    const [{ version, name, owner, port }] = await db.$queryRaw<Array<{
      version: string; name: string; owner: string; port: number;
    }>>`SELECT current_setting('server_version_num') AS version, current_database() AS name,
      current_user AS owner, inet_server_port() AS port`;
    expect(Number(version)).toBeGreaterThanOrEqual(160000);
    expect(Number(version)).toBeLessThan(170000);
    expect(name).toBe(databaseName);
    expect(owner).toBe(target.username);
    expect(port).toBe(Number(target.port));
    ({ getSettlementScheduleAutoDraftJobStatus: getStatus, runSettlementScheduleAutoDraftJob: runJob } =
      await import('../backend/src/modules/finance/settlement-schedule-job.service.js'));

    const { recordVerifiedDeliveredObservation } = await import(
      '../backend/src/modules/shipping/allocation-delivered-observation.service.js');
    const prefix = `job-race-${process.pid}-${Date.now()}`;
    vendors = [`${prefix}-a`, `${prefix}-b`];
    sourceByVendor = new Map();
    const observed: Date[] = [];
    for (const vendorId of vendors) {
      const orderId = `${vendorId}-order`;
      const allocationId = `${vendorId}-allocation`;
      const executionId = `${vendorId}-execution`;
      const shipmentRef = `${vendorId}-shipment`;
      const ledgerId = `${vendorId}-sale`;
      await db.vendor.create({ data: { id: vendorId, name: vendorId } });
      await db.vendorFinancialProfile.create({ data: {
        vendorId, settlementDelayDays: 0, settlementFrequencyType: 'WEEKLY',
        weeklySettlementDay: 'WEDNESDAY', autoSettlementDraftEnabled: true,
      } });
      await db.shopifyOrder.create({ data: {
        id: orderId, sourceShopifyOrderId: `gid://shopify/Order/${orderId}`, sourceShopifyOrderNumber: `#${orderId}`,
      } });
      await db.vendorAllocation.create({ data: {
        id: allocationId, sourceShopifyOrderId: orderId, sourceShopifyOrderNumber: `#${orderId}`,
        originalVendorId: vendorId, assignedVendorId: vendorId, outboundMethodSnapshot: 'KARGONOMI',
        fulfillmentStatus: 'Fulfilled', shippingStatus: 'Delivered',
      } });
      await db.shipmentExecution.create({ data: {
        id: executionId, allocationId, vendorId, provider: 'KARGONOMI',
        providerShipmentId: shipmentRef, shipmentStatus: 'DELIVERED', requestSnapshot: {},
      } });
      const observation = await recordVerifiedDeliveredObservation({
        allocationId,
        source: { method: 'KARGONOMI', shipmentExecutionId: executionId, sourceReference: shipmentRef },
      }, db as never);
      expect(observation).toMatchObject({
        vendorAllocationId: allocationId, outboundMethod: 'KARGONOMI',
        shipmentExecutionId: executionId, sourceReference: shipmentRef,
      });
      observed.push(observation.firstObservedDeliveredAt);
      await db.fulfillment.create({ data: {
        id: `${vendorId}-fulfillment`, vendorAllocationId: allocationId,
        fulfillmentStatus: 'Delivered', shipmentUpdatedAt: new Date(),
      } });
      await db.financeLedgerEntry.create({ data: {
        id: ledgerId, vendorAllocationId: allocationId, vendorId, entryType: 'sale', amount: '200.00',
        payoutStatus: 'PENDING', settlementStatus: 'PENDING',
        commissionPercentSnapshot: '10.00', commissionVatPercentSnapshot: '20.00',
        settlementDelayDaysSnapshot: 0,
      } });
      sourceByVendor.set(vendorId, ledgerId);
    }
    const latestExisting = await db.settlementApproval.aggregate({ _max: { scheduledRunDate: true } });
    const latest = new Date(Math.max(
      ...observed.map((value) => value.getTime()),
      (latestExisting._max.scheduledRunDate?.getTime() ?? 0) + 86_400_000,
    ));
    runDate = new Date(Date.UTC(latest.getUTCFullYear(), latest.getUTCMonth(), latest.getUTCDate()));
    runDate.setUTCDate(runDate.getUTCDate() + ((3 - runDate.getUTCDay() + 7) % 7 || 7));
    const periodEnd = runDate.getTime() + 86_399_999;
    expect(observed.every((value) => value.getTime() <= periodEnd)).toBe(true);
  });

  afterAll(async () => {
    for (const child of children) if (child.exitCode === null) child.kill();
    await db?.$disconnect();
    const { prisma } = await import('../backend/src/db/prisma.js');
    await prisma.$disconnect();
  });

  function worker() {
    const child = fork(workerPath, [], {
      execArgv: ['--import', 'tsx'],
      env: { ...process.env, DATABASE_URL: databaseUrl, NODE_ENV: 'test' },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    children.push(child);
    let stderr = '';
    child.stderr?.on('data', (chunk) => { stderr += String(chunk); });
    let ready!: () => void;
    let resolve!: (value: WorkerResult) => void;
    let reject!: (error: Error) => void;
    const readyPromise = new Promise<void>((done) => { ready = done; });
    const resultPromise = new Promise<WorkerResult>((done, fail) => { resolve = done; reject = fail; });
    child.on('message', (message: unknown) => {
      const row = message as Record<string, unknown>;
      if (row.type === 'READY') ready();
      if (row.type === 'RESULT') resolve(row as WorkerResult);
      if (row.type === 'ERROR') reject(new Error(String(row.message)));
    });
    child.on('exit', (code) => {
      if (code !== 0) reject(new Error(`Independent job worker exited ${code}: ${stderr}`));
    });
    return { child, readyPromise, resultPromise };
  }

  it('serializes same-date claims while keeping two vendor DRAFTs and their sources exclusive', async () => {
    const runDateKey = runDate.toISOString().slice(0, 10);
    const first = worker();
    const second = worker();
    await Promise.all([first.readyPromise, second.readyPromise]);
    expect(first.child.pid).not.toBe(second.child.pid);

    // Hold both independent processes at their first JobRun read, then release together.
    let blockedWorkerCount = 0;
    await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('LOCK TABLE "SettlementScheduleJobRun" IN ACCESS EXCLUSIVE MODE');
      first.child.send({ type: 'START', runDate: runDateKey });
      second.child.send({ type: 'START', runDate: runDateKey });
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        const [{ count }] = await db.$queryRaw<Array<{ count: bigint }>>`
          SELECT count(*) AS count FROM pg_stat_activity
          WHERE datname = ${databaseName} AND wait_event_type = 'Lock'
            AND query LIKE '%SettlementScheduleJobRun%'
        `;
        blockedWorkerCount = Number(count);
        if (blockedWorkerCount >= 2) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(blockedWorkerCount).toBeGreaterThanOrEqual(2);
    }, { timeout: 20_000 });

    const [one, two] = await Promise.all([first.resultPromise, second.resultPromise]);
    expect(Math.max(one.startedAt, two.startedAt)).toBeLessThan(Math.min(one.endedAt, two.endedAt));
    expect([one.result.writesPerformed, two.result.writesPerformed].sort()).toEqual([false, true]);
    const duplicateStarter = one.result.writesPerformed ? two : one;
    expect(['PROCESSING', 'COMPLETED']).toContain(duplicateStarter.result.jobRun?.status);
    console.info('SETTLEMENT_JOB_TWO_WORKER_EVIDENCE', {
      workerPids: [first.child.pid, second.child.pid], blockedWorkerCount,
      intervals: [[one.startedAt, one.endedAt], [two.startedAt, two.endedAt]],
      resultStatuses: [one.result.jobRun?.status, two.result.jobRun?.status],
      writesPerformed: [one.result.writesPerformed, two.result.writesPerformed],
    });

    const jobs = await db.settlementScheduleJobRun.findMany({ where: { runDate } });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ status: 'COMPLETED', createdDraftCount: 2, writesPerformed: true });
    expect(one.result.jobRun?.id).toBe(jobs[0].id);
    expect(two.result.jobRun?.id).toBe(jobs[0].id);
    const approvals = await db.settlementApproval.findMany({ where: { scheduledRunDate: runDate }, include: { lines: true } });
    expect(approvals).toHaveLength(2);
    expect(new Set(approvals.map((row) => row.vendorId))).toEqual(new Set(vendors));
    expect(approvals.every((row) => row.status === 'DRAFT' && row.lines.length === 1)).toBe(true);
    for (const approval of approvals) {
      expect(approval.scheduledCycleKey).toBe(`scheduled-settlement:${approval.vendorId}:${runDateKey}`);
      expect(approval.lines[0].financeLedgerEntryId).toBe(sourceByVendor.get(approval.vendorId));
      expect(approval.netPayableMinor).toBe(17600);
    }
    const lineIds = approvals.flatMap((row) => row.lines.map((line) => line.financeLedgerEntryId));
    expect(new Set(lineIds).size).toBe(2);
    expect(await db.settlementApprovalLine.count({ where: { financeLedgerEntryId: { in: lineIds } } })).toBe(2);
    const metadata = jobs[0].metadataJson as { createdDrafts?: Array<{ vendorId: string; settlementApprovalId: string }> };
    expect(new Set(metadata.createdDrafts?.map((row) => row.settlementApprovalId))).toEqual(new Set(approvals.map((row) => row.id)));

    const duplicate = await runJob({
      env: { SETTLEMENT_AUTO_DRAFT_JOB_ENABLED: true, SETTLEMENT_AUTO_DRAFT_JOB_DRY_RUN: false },
      runDate, confirmScheduledSettlementAutoDraftJob: true,
    });
    expect(duplicate.writesPerformed).toBe(false);
    expect(duplicate.jobRun?.id).toBe(jobs[0].id);
    expect(duplicate.jobRun?.status).toBe('COMPLETED');
    expect(duplicate.jobRun?.recordedWritesPerformed).toBe(true);
    expect(duplicate.summary.createdDrafts).toBe(2);
    expect(duplicate.vendors.filter((row) => row.state === 'CREATED')).toHaveLength(2);
    expect(await db.settlementApproval.count({ where: { scheduledRunDate: runDate } })).toBe(2);

    const before = {
      job: await db.settlementScheduleJobRun.findUniqueOrThrow({ where: { runDate } }),
      approvals: await db.settlementApproval.findMany({ where: { scheduledRunDate: runDate }, orderBy: { id: 'asc' } }),
      lines: await db.settlementApprovalLine.findMany({ where: { settlementApprovalId: { in: approvals.map((row) => row.id) } }, orderBy: { id: 'asc' } }),
      ledgers: await db.financeLedgerEntry.findMany({ where: { id: { in: lineIds } }, orderBy: { id: 'asc' } }),
    };
    const status = await getStatus({ SETTLEMENT_AUTO_DRAFT_JOB_ENABLED: true, SETTLEMENT_AUTO_DRAFT_JOB_DRY_RUN: false });
    expect(status.writesPerformed).toBe(false);
    expect(status.lastRun?.status).toBe('COMPLETED');
    expect(status.evidence?.settlements).toHaveLength(2);
    expect(status.evidence?.settlements.every((row) => row.jobProvenance === 'MATCHED_METADATA')).toBe(true);
    for (const row of status.evidence!.settlements) {
      expect(row.sourceLines.map((line) => line.financeLedgerEntryId)).toEqual([sourceByVendor.get(row.vendorId)]);
    }
    expect(await db.settlementScheduleJobRun.findUniqueOrThrow({ where: { runDate } })).toEqual(before.job);
    expect(await db.settlementApproval.findMany({ where: { scheduledRunDate: runDate }, orderBy: { id: 'asc' } })).toEqual(before.approvals);
    expect(await db.settlementApprovalLine.findMany({ where: { settlementApprovalId: { in: approvals.map((row) => row.id) } }, orderBy: { id: 'asc' } })).toEqual(before.lines);
    expect(await db.financeLedgerEntry.findMany({ where: { id: { in: lineIds } }, orderBy: { id: 'asc' } })).toEqual(before.ledgers);
    expect(await db.financialCorrectionAuthority.count()).toBe(0);
    expect(await db.payoutBatch.count()).toBe(0);
  }, 40_000);
});
