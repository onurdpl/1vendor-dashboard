import { fork, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '../backend/node_modules/@prisma/client/index.js';

const databaseUrl = process.env.TEST_DATABASE_URL?.trim();
const suite = databaseUrl ? describe : describe.skip;
const databaseName = 'settlement_job_failure_validation';
const workerPath = path.resolve(process.cwd(), 'src/test-support/settlement-job-race-worker.mjs');
const lockKey = 71842005;
const env = { SETTLEMENT_AUTO_DRAFT_JOB_ENABLED: true, SETTLEMENT_AUTO_DRAFT_JOB_DRY_RUN: false };
const realNow = Date.now.bind(Date);

type JobResult = Awaited<ReturnType<typeof import('../backend/src/modules/finance/settlement-schedule-job.service.js')['runSettlementScheduleAutoDraftJob']>>;
type Fixture = { runDate: Date; vendors: string[]; ledgerIds: string[] };

suite('scheduled settlement job failure and real process crash (PostgreSQL 16)', () => {
  let db: PrismaClient;
  let runJob: typeof import('../backend/src/modules/finance/settlement-schedule-job.service.js')['runSettlementScheduleAutoDraftJob'];
  let getStatus: typeof import('../backend/src/modules/finance/settlement-schedule-job.service.js')['getSettlementScheduleAutoDraftJobStatus'];
  let recordDelivery: typeof import('../backend/src/modules/shipping/allocation-delivered-observation.service.js')['recordVerifiedDeliveredObservation'];
  let sequence = 0;
  let firstRunDate: Date;
  let root: string;
  const children: ChildProcess[] = [];
  let testClockOffsetMs = 0;

  beforeAll(async () => {
    const target = new URL(databaseUrl!);
    if (process.env.SETTLEMENT_JOB_FAILURE_TEST_DATABASE_ISOLATED !== '1' ||
        target.protocol !== 'postgresql:' || target.hostname !== '127.0.0.1' ||
        target.pathname.slice(1) !== databaseName || !target.port) {
      throw new Error('Failure verification requires the dedicated local settlement_job_failure_validation database.');
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
    // PostgreSQL normally does not probe a disconnected client while it waits on an advisory lock.
    // Only this verified disposable database uses the bounded disconnect probe for real crash evidence.
    await db.$executeRawUnsafe(`ALTER DATABASE "${databaseName}" SET client_connection_check_interval = '100ms'`);
    ({ runSettlementScheduleAutoDraftJob: runJob, getSettlementScheduleAutoDraftJobStatus: getStatus } =
      await import('../backend/src/modules/finance/settlement-schedule-job.service.js'));
    ({ recordVerifiedDeliveredObservation: recordDelivery } =
      await import('../backend/src/modules/shipping/allocation-delivered-observation.service.js'));
    root = `job-failure-${process.pid}-${Date.now()}`;
    const latest = await db.settlementScheduleJobRun.aggregate({ _max: { runDate: true } });
    const start = new Date(Math.max(Date.now(), (latest._max.runDate?.getTime() ?? 0) + 86_400_000));
    firstRunDate = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
    firstRunDate.setUTCDate(firstRunDate.getUTCDate() + ((3 - firstRunDate.getUTCDay() + 7) % 7 || 7));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    // Test-only triggers are never migrations. Keep immutable observations until the disposable DB is dropped.
    await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS test_4b_approval_trigger ON "SettlementApproval"');
    await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS test_4b_line_trigger ON "SettlementApprovalLine"');
    await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS test_4b_job_trigger ON "SettlementScheduleJobRun"');
    await db.$executeRawUnsafe('DROP FUNCTION IF EXISTS test_4b_approval_fault()');
    await db.$executeRawUnsafe('DROP FUNCTION IF EXISTS test_4b_job_fault()');
    await db.vendorFinancialProfile.updateMany({ where: { vendorId: { startsWith: root } }, data: { active: false } });
  });

  afterAll(async () => {
    for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await db?.$disconnect();
    const { prisma } = await import('../backend/src/db/prisma.js');
    await prisma.$disconnect();
  });

  async function fixture(vendorCount: number): Promise<Fixture> {
    sequence += 1;
    const runDate = new Date(firstRunDate.getTime() + (sequence - 1) * 7 * 86_400_000);
    const vendors: string[] = [];
    const ledgerIds: string[] = [];
    for (let index = 0; index < vendorCount; index += 1) {
      const vendorId = `${root}-${sequence}-${index}`;
      const orderId = `${vendorId}-order`;
      const allocationId = `${vendorId}-allocation`;
      const executionId = `${vendorId}-execution`;
      const shipmentRef = `${vendorId}-shipment`;
      const ledgerId = `${vendorId}-sale`;
      vendors.push(vendorId);
      ledgerIds.push(ledgerId);
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
      const observation = await recordDelivery({
        allocationId,
        source: { method: 'KARGONOMI', shipmentExecutionId: executionId, sourceReference: shipmentRef },
      }, db as never);
      expect(observation).toMatchObject({
        vendorAllocationId: allocationId, outboundMethod: 'KARGONOMI',
        shipmentExecutionId: executionId, sourceReference: shipmentRef,
      });
      expect(observation.firstObservedDeliveredAt.getTime()).toBeLessThanOrEqual(runDate.getTime() + 86_399_999);
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
    }
    testClockOffsetMs = runDate.getTime() + 86_400_000 - realNow() + 1_000;
    vi.spyOn(Date, 'now').mockImplementation(() => realNow() + testClockOffsetMs);
    return { runDate, vendors, ledgerIds };
  }

  async function approvals(f: Fixture) {
    return db.settlementApproval.findMany({
      where: { scheduledRunDate: f.runDate }, include: { lines: true }, orderBy: { vendorId: 'asc' },
    });
  }

  async function assertNoSideEffects() {
    expect(await db.financialCorrectionAuthority.count()).toBe(0);
    expect(await db.payoutBatch.count()).toBe(0);
    expect(await db.vendorBalanceEvent.count()).toBe(0);
  }

  async function failApproval(vendorId: string) {
    // The identifier comes only from the synthetic fixture above, never from a connection or external input.
    expect(vendorId).toMatch(/^[a-z0-9-]+$/);
    await db.$executeRawUnsafe(`CREATE FUNCTION test_4b_approval_fault() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW."vendorId" = '${vendorId}' THEN RAISE EXCEPTION 'TEST_4B_VENDOR_INSERT_FAILURE'; END IF;
      RETURN NEW; END $$`);
    await db.$executeRawUnsafe('CREATE TRIGGER test_4b_approval_trigger BEFORE INSERT ON "SettlementApproval" FOR EACH ROW EXECUTE FUNCTION test_4b_approval_fault()');
  }

  async function lockInsertedLine(ledgerId: string) {
    expect(ledgerId).toMatch(/^[a-z0-9-]+$/);
    // AFTER INSERT means both the parent DRAFT and this line exist inside B's open transaction.
    await db.$executeRawUnsafe(`CREATE FUNCTION test_4b_approval_fault() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW."financeLedgerEntryId" = '${ledgerId}' THEN PERFORM pg_advisory_xact_lock(${lockKey}); END IF;
      RETURN NEW; END $$`);
    await db.$executeRawUnsafe('CREATE TRIGGER test_4b_line_trigger AFTER INSERT ON "SettlementApprovalLine" FOR EACH ROW EXECUTE FUNCTION test_4b_approval_fault()');
  }

  async function jobUpdateFault(mode: 'LOCK' | 'RAISE' | 'RAISE_ALL') {
    const action = mode === 'LOCK'
      ? `PERFORM pg_advisory_xact_lock(${lockKey});`
      : `RAISE EXCEPTION 'TEST_4B_FINAL_UPDATE_FAILURE';`;
    await db.$executeRawUnsafe(`CREATE FUNCTION test_4b_job_fault() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW."status" = 'COMPLETED' OR '${mode}' = 'RAISE_ALL' THEN ${action} END IF;
      RETURN NEW; END $$`);
    await db.$executeRawUnsafe('CREATE TRIGGER test_4b_job_trigger BEFORE UPDATE ON "SettlementScheduleJobRun" FOR EACH ROW EXECUTE FUNCTION test_4b_job_fault()');
  }

  function worker() {
    const child = fork(workerPath, [], {
      execArgv: ['--import', 'tsx'],
      env: { ...process.env, DATABASE_URL: databaseUrl, NODE_ENV: 'test' },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    children.push(child);
    let stderr = '';
    child.stderr?.on('data', (chunk) => { stderr += String(chunk); });
    const ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Worker READY timeout')), 10_000);
      child.on('message', function onMessage(message: unknown) {
        if ((message as { type?: string }).type !== 'READY') return;
        clearTimeout(timer);
        child.off('message', onMessage);
        resolve();
      });
      child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Worker exited before READY: ${code} ${stderr}`)); });
    });
    const result = () => new Promise<JobResult>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Worker RESULT timeout')), 30_000);
      child.on('message', function onMessage(message: unknown) {
        const row = message as { type?: string; result?: JobResult; message?: string };
        if (row.type !== 'RESULT' && row.type !== 'ERROR') return;
        clearTimeout(timer);
        child.off('message', onMessage);
        if (row.type === 'RESULT') resolve(row.result!);
        else reject(new Error(row.message));
      });
      child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Worker exited before RESULT: ${code} ${stderr}`)); });
    });
    return { child, ready, result };
  }

  async function waitForBlockedQuery(fragment: string, check: () => Promise<boolean>) {
    const deadline = Date.now() + 4_000;
    while (Date.now() < deadline) {
      const [row] = await db.$queryRaw<Array<{ count: bigint }>>`
        SELECT count(*) AS count FROM pg_stat_activity
        WHERE datname = ${databaseName} AND wait_event_type = 'Lock' AND query LIKE ${`%${fragment}%`}`;
      if (Number(row.count) > 0 && await check()) return Number(row.count);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`Verified PostgreSQL lock checkpoint not reached: ${fragment}`);
  }

  async function waitForWorkerSessionToClose(fragment: string) {
    const deadline = Date.now() + 4_000;
    while (Date.now() < deadline) {
      const [row] = await db.$queryRaw<Array<{ count: bigint }>>`
        SELECT count(*) AS count FROM pg_stat_activity
        WHERE datname = ${databaseName} AND wait_event_type = 'Lock' AND query LIKE ${`%${fragment}%`}`;
      if (Number(row.count) === 0) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`Killed worker's PostgreSQL lock waiter remained connected: ${fragment}`);
  }

  async function killTrackedWorker(child: ChildProcess) {
    expect(children).toContain(child);
    expect(child.pid).toBeGreaterThan(0);
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
      child.once('exit', (code, signal) => resolve({ code, signal }));
    });
    expect(child.kill('SIGKILL')).toBe(true);
    expect(await exited).toEqual({ code: null, signal: 'SIGKILL' });
  }

  it('rolls back a failed vendor DRAFT transaction and finalizes FAILED with no financial write', async () => {
    const f = await fixture(1);
    await failApproval(f.vendors[0]);
    const result = await runJob({ env, runDate: f.runDate, confirmScheduledSettlementAutoDraftJob: true });
    const job = await db.settlementScheduleJobRun.findUniqueOrThrow({ where: { runDate: f.runDate } });
    expect(result.jobRun?.status).toBe('FAILED');
    expect(result.summary.createdDrafts).toBe(0);
    expect(result.writesPerformed).toBe(false);
    expect(job).toMatchObject({ status: 'FAILED', createdDraftCount: 0, blockedCount: 1, writesPerformed: false });
    expect(job.finishedAt).not.toBeNull();
    expect((job.metadataJson as { failed: Array<{ vendorId: string; reason: string }> }).failed)
      .toEqual([{ vendorId: f.vendors[0], reason: expect.stringContaining('TEST_4B_VENDOR_INSERT_FAILURE') }]);
    expect(await approvals(f)).toHaveLength(0);
    expect(await db.settlementApprovalLine.count({ where: { financeLedgerEntryId: f.ledgerIds[0] } })).toBe(0);
    await assertNoSideEffects();
  }, 40_000);

  it('retains committed vendor A while vendor B fails and same-date FAILED rerun writes nothing', async () => {
    const f = await fixture(2);
    await failApproval(f.vendors[1]);
    const result = await runJob({ env, runDate: f.runDate, confirmScheduledSettlementAutoDraftJob: true });
    const job = await db.settlementScheduleJobRun.findUniqueOrThrow({ where: { runDate: f.runDate } });
    expect(result.jobRun?.status).toBe('FAILED');
    expect(result.summary.createdDrafts).toBe(1);
    expect(result.summary.blocked).toBe(1);
    expect(result.writesPerformed).toBe(true);
    expect(job).toMatchObject({ status: 'FAILED', createdDraftCount: 1, blockedCount: 1, writesPerformed: true });
    const rows = await approvals(f);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ vendorId: f.vendors[0], status: 'DRAFT', netPayableMinor: 17600 });
    expect(rows[0].lines.map((line) => line.financeLedgerEntryId)).toEqual([f.ledgerIds[0]]);
    expect(await db.settlementApprovalLine.count({ where: { financeLedgerEntryId: f.ledgerIds[1] } })).toBe(0);
    const duplicate = await runJob({ env, runDate: f.runDate, confirmScheduledSettlementAutoDraftJob: true });
    expect(duplicate).toMatchObject({ writesPerformed: false, jobRun: { id: job.id, status: 'FAILED' } });
    expect(await db.settlementScheduleJobRun.count({ where: { runDate: f.runDate } })).toBe(1);
    expect(await approvals(f)).toHaveLength(1);
    const status = await getStatus(env);
    expect(status.writesPerformed).toBe(false);
    expect(status.lastRun?.status).toBe('FAILED');
    expect(status.evidence?.settlements[0]).toMatchObject({
      vendorId: f.vendors[0], jobProvenance: 'MATCHED_METADATA',
      sourceLines: [{ financeLedgerEntryId: f.ledgerIds[0] }],
    });
    expect(status.evidence?.jobVendorOutcomes).toContainEqual({
      vendorId: f.vendors[1], state: 'FAILED', reason: expect.stringContaining('TEST_4B_VENDOR_INSERT_FAILURE'),
    });
    await assertNoSideEffects();
  }, 40_000);

  it('keeps committed A and PROCESSING JobRun but rolls back B when the real worker dies mid-transaction', async () => {
    const f = await fixture(2);
    await lockInsertedLine(f.ledgerIds[1]);
    const runDateKey = f.runDate.toISOString().slice(0, 10);
    const w = worker();
    await w.ready;
    let checkpoint = 0;
    await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`DO $$ BEGIN PERFORM pg_advisory_xact_lock(${lockKey}); END $$`);
      w.child.send({ type: 'START', runDate: runDateKey, testClockOffsetMs });
      checkpoint = await waitForBlockedQuery('SettlementApprovalLine', async () =>
        (await approvals(f)).length === 1 &&
        (await db.settlementScheduleJobRun.findUnique({ where: { runDate: f.runDate } }))?.status === 'PROCESSING');
      await killTrackedWorker(w.child);
      await waitForWorkerSessionToClose('SettlementApprovalLine');
    }, { timeout: 15_000 });
    expect(checkpoint).toBeGreaterThan(0);
    const rows = await approvals(f);
    expect(rows).toHaveLength(1);
    expect(rows[0].vendorId).toBe(f.vendors[0]);
    expect(rows[0].lines.map((line) => line.financeLedgerEntryId)).toEqual([f.ledgerIds[0]]);
    expect(await db.settlementApprovalLine.count({ where: { financeLedgerEntryId: f.ledgerIds[1] } })).toBe(0);
    const job = await db.settlementScheduleJobRun.findUniqueOrThrow({ where: { runDate: f.runDate } });
    expect(job).toMatchObject({ status: 'PROCESSING', createdDraftCount: 0, writesPerformed: false, finishedAt: null });
    const restarted = worker();
    await restarted.ready;
    const outcome = restarted.result();
    restarted.child.send({ type: 'START', runDate: runDateKey, testClockOffsetMs });
    expect(await outcome).toMatchObject({ writesPerformed: false, jobRun: { id: job.id, status: 'PROCESSING' } });
    expect(await approvals(f)).toHaveLength(1);
    const status = await getStatus(env);
    expect(status.lastRun?.status).toBe('PROCESSING');
    expect(status.evidence?.settlements[0]).toMatchObject({ vendorId: f.vendors[0], jobProvenance: 'UNKNOWN' });
    expect(status.evidence?.notes.some((note) => note.includes('PROCESSING does not prove'))).toBe(true);
    await assertNoSideEffects();
    console.info('SETTLEMENT_JOB_OPEN_TRANSACTION_CRASH_EVIDENCE', {
      workerPid: w.child.pid, signal: 'SIGKILL', blockedSessions: checkpoint,
      jobStatus: job.status, committedVendorCount: rows.length, rolledBackVendorId: f.vendors[1],
    });
  }, 40_000);

  it('retains a committed DRAFT with PROCESSING and unknown provenance after a real pre-finalization crash', async () => {
    const f = await fixture(1);
    await jobUpdateFault('LOCK');
    const runDateKey = f.runDate.toISOString().slice(0, 10);
    const w = worker();
    await w.ready;
    let checkpoint = 0;
    await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`DO $$ BEGIN PERFORM pg_advisory_xact_lock(${lockKey}); END $$`);
      w.child.send({ type: 'START', runDate: runDateKey, testClockOffsetMs });
      checkpoint = await waitForBlockedQuery('SettlementScheduleJobRun', async () =>
        (await approvals(f)).length === 1 &&
        (await db.settlementScheduleJobRun.findUnique({ where: { runDate: f.runDate } }))?.status === 'PROCESSING');
      await killTrackedWorker(w.child);
      await waitForWorkerSessionToClose('SettlementScheduleJobRun');
    }, { timeout: 15_000 });
    expect(checkpoint).toBeGreaterThan(0);
    const job = await db.settlementScheduleJobRun.findUniqueOrThrow({ where: { runDate: f.runDate } });
    const rows = await approvals(f);
    expect(job).toMatchObject({ status: 'PROCESSING', createdDraftCount: 0, writesPerformed: false, finishedAt: null });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'DRAFT', vendorId: f.vendors[0], netPayableMinor: 17600 });
    expect(rows[0].lines.map((line) => line.financeLedgerEntryId)).toEqual([f.ledgerIds[0]]);
    const restarted = worker();
    await restarted.ready;
    const outcome = restarted.result();
    restarted.child.send({ type: 'START', runDate: runDateKey, testClockOffsetMs });
    expect(await outcome).toMatchObject({ writesPerformed: false, jobRun: { id: job.id, status: 'PROCESSING' } });
    const status = await getStatus(env);
    expect(status.evidence?.settlements[0]).toMatchObject({ vendorId: f.vendors[0], jobProvenance: 'UNKNOWN' });
    expect(status.evidence?.createdClaimsAvailable).toBe(false);
    expect(status.evidence?.jobOutcomeMetadataComplete).toBe(false);
    expect(await approvals(f)).toHaveLength(1);
    await assertNoSideEffects();
    console.info('SETTLEMENT_JOB_FINALIZATION_CRASH_EVIDENCE', {
      workerPid: w.child.pid, signal: 'SIGKILL', blockedSessions: checkpoint,
      jobStatus: job.status, committedDraftCount: rows.length,
    });
  }, 40_000);

  it('records a caught finalization failure separately from the DRAFT that already committed', async () => {
    const f = await fixture(1);
    await jobUpdateFault('RAISE');
    const result = await runJob({ env, runDate: f.runDate, confirmScheduledSettlementAutoDraftJob: true });
    const job = await db.settlementScheduleJobRun.findUniqueOrThrow({ where: { runDate: f.runDate } });
    const rows = await approvals(f);
    expect(result.jobRun?.status).toBe('FAILED');
    expect(result.writesPerformed).toBe(true);
    expect(result.summary.createdDrafts).toBe(1);
    expect(result.vendors).toContainEqual(expect.objectContaining({
      vendorId: f.vendors[0], state: 'CREATED', createdSettlementApprovalId: rows[0].id,
    }));
    expect(job).toMatchObject({ status: 'FAILED', writesPerformed: true, createdDraftCount: 1 });
    expect(job.finishedAt).not.toBeNull();
    expect(job.metadataJson).toMatchObject({
      error: expect.stringContaining('TEST_4B_FINAL_UPDATE_FAILURE'),
      summary: { created: 1, failed: 0 },
      createdDrafts: [{ vendorId: f.vendors[0], settlementApprovalId: rows[0].id }],
      skipped: [], failed: [],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].lines.map((line) => line.financeLedgerEntryId)).toEqual([f.ledgerIds[0]]);
    const status = await getStatus(env);
    expect(status.evidence?.settlements[0]).toMatchObject({ vendorId: f.vendors[0], jobProvenance: 'MATCHED_METADATA' });
    expect(status.evidence?.jobError).toContain('TEST_4B_FINAL_UPDATE_FAILURE');
    expect(status.evidence?.createdClaimsAvailable).toBe(true);
    expect(status.evidence?.jobOutcomeMetadataComplete).toBe(true);
    const duplicate = await runJob({ env, runDate: f.runDate, confirmScheduledSettlementAutoDraftJob: true });
    expect(duplicate).toMatchObject({ writesPerformed: false, jobRun: {
      id: job.id, status: 'FAILED', recordedWritesPerformed: true,
    } });
    expect(duplicate.summary.createdDrafts).toBe(1);
    expect(await db.settlementScheduleJobRun.count({ where: { runDate: f.runDate } })).toBe(1);
    expect(await approvals(f)).toHaveLength(1);
    await assertNoSideEffects();
  }, 40_000);

  it('does not fabricate persisted success when both finalization and error reporting fail', async () => {
    const f = await fixture(1);
    await jobUpdateFault('RAISE_ALL');
    await expect(runJob({ env, runDate: f.runDate, confirmScheduledSettlementAutoDraftJob: true }))
      .rejects.toThrow('TEST_4B_FINAL_UPDATE_FAILURE');
    const job = await db.settlementScheduleJobRun.findUniqueOrThrow({ where: { runDate: f.runDate } });
    expect(job).toMatchObject({ status: 'PROCESSING', writesPerformed: false, finishedAt: null });
    const rows = await approvals(f);
    expect(rows).toHaveLength(1);
    expect(rows[0].lines.map((line) => line.financeLedgerEntryId)).toEqual([f.ledgerIds[0]]);
    const status = await getStatus(env);
    expect(status.evidence?.settlements[0]?.jobProvenance).toBe('UNKNOWN');
    expect(status.evidence?.notes.some((note) => note.includes('PROCESSING does not prove'))).toBe(true);
    await assertNoSideEffects();
  }, 40_000);

  it('returns confirmed writes and an unfinalized JobRun over real Admin HTTP if FAILED reporting cannot persist', async () => {
    const f = await fixture(1);
    await jobUpdateFault('RAISE_ALL');
    const variables = {
      SETTLEMENT_AUTO_DRAFT_JOB_ENABLED: 'true',
      SETTLEMENT_AUTO_DRAFT_JOB_DRY_RUN: 'false',
      SETTLEMENT_AUTO_DRAFT_SCHEDULER_ENABLED: 'false',
      SHOPIFY_ORDERS_CREATE_EXECUTOR_ENABLED: 'false',
      CUSTOMER_CANCELLATION_AUTO_REFUND_ENABLED: 'false',
      SCHEDULED_RECONCILIATION_ENABLED: 'false',
      CANONICAL_RECONCILIATION_ENABLED: 'false',
      SOPYO_DELIVERY_POLLING_ENABLED: 'false',
      SOPYO_ORDER_PUSH_WORKER_ENABLED: 'false',
      SHIPPING_EXECUTION_ENABLED: 'false',
      KARGONOMI_BASE_URL: 'http://127.0.0.1:1',
      KARGONOMI_API_TOKEN: 'disposable-http-test-only',
    };
    const previous = Object.fromEntries(Object.keys(variables).map((key) => [key, process.env[key]]));
    Object.assign(process.env, variables);
    let app: Awaited<ReturnType<typeof import('../backend/src/app.js')['createApp']>> | undefined;
    try {
      const { hashPasswordArgon2id } = await import('../backend/src/modules/auth/password-hashing.js');
      const password = `${root}-http-password`;
      const adminId = `${root}-http-admin`;
      const email = `${adminId}@example.test`;
      await db.user.create({ data: {
        id: adminId, email, name: 'Disposable Job Admin', role: 'ADMIN',
        passwordHash: await hashPasswordArgon2id(password),
      } });
      const { createApp } = await import('../backend/src/app.js');
      app = createApp();
      const origin = await app.listen({ host: '127.0.0.1', port: 0 });
      const login = await fetch(`${origin}/auth/login`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      expect(login.status).toBe(200);
      const loginBody = await login.json() as { csrfToken: string };
      const cookie = login.headers.get('set-cookie')?.split(';', 1)[0];
      expect(cookie).toBeTruthy();
      expect(loginBody.csrfToken).toBeTruthy();
      const response = await fetch(`${origin}/admin/finance/settlement-schedules/run-auto-draft-job`, {
        method: 'POST', headers: { cookie: cookie!, 'x-csrf-token': loginBody.csrfToken, 'content-type': 'application/json' },
        body: JSON.stringify({ runDate: f.runDate.toISOString().slice(0, 10), confirmScheduledSettlementAutoDraftJob: true }),
      });
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ writesPerformed: true, confirmedCreatedDraftCount: 1,
        jobRunFinalized: false, message: expect.stringContaining('persisted JobRun outcome is unknown') });
      const job = await db.settlementScheduleJobRun.findUniqueOrThrow({ where: { runDate: f.runDate } });
      expect(job.status).toBe('PROCESSING');
      const rows = await approvals(f);
      expect(rows).toHaveLength(1);
      expect(rows[0].lines.map((line) => line.financeLedgerEntryId)).toEqual([f.ledgerIds[0]]);
      const statusResponse = await fetch(`${origin}/admin/finance/settlement-schedules/auto-draft-job-status`, {
        headers: { cookie: cookie! },
      });
      expect(statusResponse.status).toBe(200);
      expect(await statusResponse.json()).toMatchObject({ lastRun: { status: 'PROCESSING' },
        evidence: { settlements: [{ jobProvenance: 'UNKNOWN' }] } });
      await assertNoSideEffects();
    } finally {
      await app?.close();
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  }, 40_000);

  it('finishes an uninstrumented normal job with exact source lineage', async () => {
    const f = await fixture(1);
    const result = await runJob({ env, runDate: f.runDate, confirmScheduledSettlementAutoDraftJob: true });
    const rows = await approvals(f);
    expect(result).toMatchObject({ ok: true, writesPerformed: true, summary: { createdDrafts: 1, blocked: 0 }, jobRun: { status: 'COMPLETED' } });
    expect(rows).toHaveLength(1);
    expect(rows[0].lines.map((line) => line.financeLedgerEntryId)).toEqual([f.ledgerIds[0]]);
    const job = await db.settlementScheduleJobRun.findUniqueOrThrow({ where: { runDate: f.runDate } });
    expect(job).toMatchObject({ status: 'COMPLETED', writesPerformed: true, createdDraftCount: 1 });
    const status = await getStatus(env);
    expect(status.evidence?.settlements[0]?.jobProvenance).toBe('MATCHED_METADATA');
    await assertNoSideEffects();
  }, 40_000);
});
