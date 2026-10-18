import { randomUUID } from 'node:crypto';
import { fork, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '../backend/node_modules/@prisma/client/index.js';

const targetUrl = process.env.TEST_DATABASE_URL?.trim();
const suite = targetUrl ? describe : describe.skip;

suite('F-06 real process crash and recovery on isolated PostgreSQL', () => {
  let db: PrismaClient;
  let vendorId: string;
  let approvalId: string;
  let saleId: string;
  let frozenTotals: { grossSalesMinor: number; refundTotalMinor: number; commissionMinor: number;
    commissionVatMinor: number; netPayableMinor: number };
  let createDraft: typeof import('../backend/src/modules/finance/settlement-approval.service.js')['createAdminManualDraftApproval'];
  let recordDelivery: typeof import('../backend/src/modules/shipping/allocation-delivered-observation.service.js')['recordVerifiedDeliveredObservation'];
  const children = new Set<ChildProcess>();

  async function waitUntil<T>(probe: () => Promise<T | null>, label: string, timeoutMs = 10_000): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const observed = await probe();
      if (observed !== null) return observed;
      await new Promise((done) => setTimeout(done, 40));
    }
    throw new Error(`F-06 did not observe ${label}; no crash-window result is claimed.`);
  }

  function child(mode: 'APPROVE' | 'RECOVER' | 'RECONCILE', attemptId: string) {
    const process = fork(resolve(globalThis.process.cwd(), 'src/fin-auto-f06-crash-child.ts'), [], {
      execArgv: ['--import', 'tsx'],
      env: { ...globalThis.process.env, DATABASE_URL: targetUrl, TEST_DATABASE_URL: targetUrl,
        FIN_AUTO_F06_TEST_DATABASE_ISOLATED: '1', FIN_AUTO_F06_VENDOR_ID: vendorId,
        FIN_AUTO_F06_APPROVAL_ID: approvalId, FIN_AUTO_F06_ATTEMPT_ID: attemptId,
        FIN_AUTO_F06_MODE: mode },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    children.add(process);
    process.stderr?.resume();
    const message = (kind: string) => new Promise<Record<string, unknown>>((done, reject) => {
      const timer = setTimeout(() => reject(new Error(`F-06 child ${kind} timed out.`)), 15_000);
      const onMessage = (value: Record<string, unknown>) => {
        if (value.kind === 'ERROR') {
          clearTimeout(timer); process.off('message', onMessage);
          reject(new Error(`F-06 child error: ${String(value.errorType)}`));
        } else if (value.kind === kind) {
          clearTimeout(timer); process.off('message', onMessage); done(value);
        }
      };
      process.on('message', onMessage);
      process.once('exit', (code, signal) => {
        if (code !== 0) {
          clearTimeout(timer); process.off('message', onMessage);
          reject(new Error(`F-06 child exited before ${kind}: ${code}/${signal}`));
        }
      });
    });
    return { process, message };
  }

  async function stopOwned(process: ChildProcess) {
    if (process.exitCode !== null || process.signalCode !== null) return;
    const exited = new Promise<void>((done) => process.once('exit', () => done()));
    process.kill('SIGKILL');
    await exited;
  }

  async function recover(attemptId: string) {
    const running = child('RECOVER', attemptId);
    await running.message('READY');
    const result = running.message('RESULT');
    running.process.send('GO');
    return (await result).result as Awaited<ReturnType<typeof import(
      '../backend/src/modules/finance/settlement-auto-approval-scheduler.service.js')['runAutomaticSettlementApprovalSweep']>>;
  }

  async function reconcile(attemptId: string) {
    const running = child('RECONCILE', attemptId);
    await running.message('READY');
    const result = running.message('RESULT');
    running.process.send('GO');
    return (await result).result as Awaited<ReturnType<typeof import(
      '../backend/src/modules/finance/settlement-auto-approval.service.js')['reconcileAutomaticApprovalAttempt']>>;
  }

  async function financialState(attemptId: string) {
    const [approval, attempt, events, activeLines, payouts] = await Promise.all([
      db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId }, include: { lines: true } }),
      db.settlementAutoApprovalAttempt.findUnique({ where: { id: attemptId } }),
      db.settlementAutoApprovalAttemptEvent.findMany({ where: { attemptId }, orderBy: { createdAt: 'asc' } }),
      db.settlementApprovalLine.count({ where: { financeLedgerEntryId: saleId,
        settlementApproval: { status: 'APPROVED' } } }),
      db.payoutBatch.count({ where: { vendorId } }),
    ]);
    return { approval, attempt, events, activeLines, payouts };
  }

  beforeEach(async () => {
    const target = new URL(targetUrl!);
    const pg16 = target.port === '5433' && target.pathname === '/fin_auto_f06_pg16_7d31e84c1a64';
    const pg18 = target.port === '5432' && target.pathname === '/fin_auto_f06_pg18_4f88ae2b0c39';
    const local = target.username === 'onur' && !target.password && (pg16 || pg18);
    const ci = globalThis.process.env.GITHUB_ACTIONS === 'true' && globalThis.process.env.CI === 'true' &&
      globalThis.process.env.FIN_AUTO_CI_DB_PROOF?.match(/^[a-f0-9]{64}$/) &&
      globalThis.process.env.FIN_AUTO_CI_CLUSTER_ID?.match(/^\d+$/) &&
      target.username === 'postgres' && target.password === 'postgres' &&
      target.port === '5432' && target.pathname === '/fin_auto_f06_ci_validation';
    if (globalThis.process.env.FIN_AUTO_F06_TEST_DATABASE_ISOLATED !== '1' ||
        target.protocol !== 'postgresql:' || target.hostname !== '127.0.0.1' ||
        target.searchParams.get('schema') !== 'public' || target.searchParams.size !== 1 ||
        target.hash || !(local || ci)) throw new Error('F-06 requires an approved isolated local or CI database.');
    if (globalThis.process.env.DATABASE_URL && globalThis.process.env.DATABASE_URL !== targetUrl) {
      throw new Error('F-06 ambient canonical Prisma target differs from the test target.');
    }
    globalThis.process.env.DATABASE_URL = targetUrl;
    db = new PrismaClient({ datasources: { db: { url: targetUrl } } });
    const [identity] = await db.$queryRaw<Array<{ name: string; port: number; version: string;
      systemId: bigint; owner: string; proof: string | null }>>`
      SELECT current_database() AS name, inet_server_port() AS port,
        current_setting('server_version_num') AS version,
        (SELECT system_identifier FROM pg_control_system()) AS "systemId",
        (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database()) AS owner,
        (SELECT shobj_description(oid, 'pg_database') FROM pg_database WHERE datname=current_database()) AS proof`;
    if (identity?.name !== target.pathname.slice(1) || identity.port !== Number(target.port) ||
        Math.floor(Number(identity.version) / 10000) !== (local ? (pg16 ? 16 : 18) : Number(globalThis.process.env.FIN_AUTO_CI_PG_MAJOR)) ||
        String(identity.systemId) !== (local ? (pg16 ? '7689856229225255193' : '7637676237569338936') : globalThis.process.env.FIN_AUTO_CI_CLUSTER_ID) ||
        (ci && identity.proof !== `fin-auto-ci:${globalThis.process.env.FIN_AUTO_CI_DB_PROOF}`) ||
        identity.owner !== target.username) throw new Error('F-06 PostgreSQL identity mismatch.');
    const { prisma } = await import('../backend/src/db/prisma.js');
    const [canonical] = await prisma.$queryRaw<Array<{ name: string; port: number; systemId: bigint }>>`
      SELECT current_database() AS name, inet_server_port() AS port,
        (SELECT system_identifier FROM pg_control_system()) AS "systemId"`;
    if (canonical?.name !== identity.name || canonical.port !== identity.port ||
        String(canonical.systemId) !== String(identity.systemId)) throw new Error('F-06 canonical target mismatch.');
    ({ createAdminManualDraftApproval: createDraft } = await import(
      '../backend/src/modules/finance/settlement-approval.service.js'));
    ({ recordVerifiedDeliveredObservation: recordDelivery } = await import(
      '../backend/src/modules/shipping/allocation-delivered-observation.service.js'));
    const prefix = `f06-${randomUUID()}`;
    vendorId = `${prefix}-vendor`;
    const orderId = `${prefix}-order`;
    const allocationId = `${prefix}-allocation`;
    saleId = `${prefix}-sale`;
    const executionId = `${prefix}-execution`;
    await db.vendor.create({ data: { id: vendorId, name: 'F-06 isolated process-crash vendor' } });
    await db.vendorFinancialProfile.create({ data: { vendorId, settlementDelayDays: 0,
      settlementFrequencyType: 'WEEKLY', weeklySettlementDay: 'WEDNESDAY',
      autoSettlementDraftEnabled: false } });
    await db.shopifyOrder.create({ data: { id: orderId,
      sourceShopifyOrderId: `gid://shopify/Order/${orderId}`,
      sourceShopifyOrderNumber: `#${orderId}` } });
    await db.vendorAllocation.create({ data: { id: allocationId, sourceShopifyOrderId: orderId,
      sourceShopifyOrderNumber: `#${orderId}`, originalVendorId: vendorId, assignedVendorId: vendorId,
      outboundMethodSnapshot: 'KARGONOMI', fulfillmentStatus: 'Fulfilled', shippingStatus: 'Delivered' } });
    await db.shipmentExecution.create({ data: { id: executionId, allocationId, vendorId,
      provider: 'KARGONOMI', providerShipmentId: `${prefix}-shipment`, shipmentStatus: 'DELIVERED',
      requestSnapshot: {} } });
    const observation = await recordDelivery({ allocationId,
      source: { method: 'KARGONOMI', shipmentExecutionId: executionId,
        sourceReference: `${prefix}-shipment` } }, db as never);
    await db.fulfillment.create({ data: { id: `${prefix}-fulfillment`, vendorAllocationId: allocationId,
      fulfillmentStatus: 'Delivered', shipmentUpdatedAt: observation.firstObservedDeliveredAt } });
    await db.financeLedgerEntry.create({ data: { id: saleId, vendorAllocationId: allocationId,
      vendorId, entryType: 'sale', amount: '100.00', payoutStatus: 'PENDING', settlementStatus: 'PENDING',
      commissionPercentSnapshot: '10.00', commissionVatPercentSnapshot: '20.00',
      settlementDelayDaysSnapshot: 0 } });
    const draft = await createDraft({ vendorId, candidateScope: 'selected_allocations',
      selectedAllocationIds: [allocationId] });
    expect(draft).toMatchObject({ status: 'draft', vendorId });
    const persisted = await db.settlementApproval.findUniqueOrThrow({ where: { id: draft.id } });
    expect(persisted).toMatchObject({ status: 'DRAFT', creationOrigin: 'ADMIN_MANUAL' });
    frozenTotals = { grossSalesMinor: persisted.grossSalesMinor, refundTotalMinor: persisted.refundTotalMinor,
      commissionMinor: persisted.commissionMinor, commissionVatMinor: persisted.commissionVatMinor,
      netPayableMinor: persisted.netPayableMinor };
    expect(draft.lines.map((line) => line.financeLedgerEntryId)).toEqual([saleId]);
    approvalId = draft.id;
  });

  afterEach(async () => {
    for (const running of children) await stopOwned(running);
    children.clear();
    await db?.$disconnect();
    // No cleanup of financial records: the two dedicated F-06 databases retain crash evidence.
  });

  it('kills a real child before it begins approval; a new process makes one canonical attempt', async () => {
    const attemptId = `f06-prestart-${randomUUID()}`;
    const running = child('APPROVE', attemptId);
    await running.message('READY');
    await stopOwned(running.process);
    const before = await financialState(attemptId);
    expect(before.approval).toMatchObject({ status: 'DRAFT', approvedBy: null });
    expect(before.attempt).toBeNull();
    expect(before.events).toEqual([]);
    expect(before.activeLines).toBe(0);
    expect(before.payouts).toBe(0);
    const recovered = await recover(attemptId);
    expect(recovered.vendors[0]?.outcomes).toEqual(expect.arrayContaining([
      expect.objectContaining({ settlementApprovalId: approvalId, classification: 'VERIFIED_COMPLETED' })]));
    await recover(attemptId);
    const approval = await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId } });
    expect(approval).toMatchObject({ status: 'APPROVED',
      approvedBy: 'system:settlement_auto_approval', ...frozenTotals });
    const attempts = await db.settlementAutoApprovalAttempt.findMany({ where: { settlementApprovalId: approvalId },
      include: { events: true } });
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({ outcome: 'APPROVED', vendorId });
    expect(attempts[0]?.events).toHaveLength(2);
    expect(attempts[0]?.events.map((event) => event.outcome)).toEqual(
      expect.arrayContaining(['STARTED', 'APPROVED']));
    expect(await db.settlementApprovalLine.count({ where: { financeLedgerEntryId: saleId,
      settlementApproval: { status: 'APPROVED' } } })).toBe(1);
    expect(await db.payoutBatch.count({ where: { vendorId } })).toBe(0);
  }, 60_000);

  it('kills a real child blocked inside canonical approval before commit; restart never blindly retries STARTED', async () => {
    const attemptId = `f06-inflight-${randomUUID()}`;
    let unlock!: () => void;
    let locked!: () => void;
    const hold = new Promise<void>((done) => { unlock = done; });
    const ready = new Promise<void>((done) => { locked = done; });
    const lock = db.$transaction(async (tx) => {
      // Do not block the attempt's FK KEY SHARE while holding the later monetary UPDATE.
      await tx.$queryRaw`SELECT id FROM "SettlementApproval" WHERE id=${approvalId} FOR NO KEY UPDATE`;
      locked();
      await hold;
    }, { timeout: 20_000 });
    await ready;
    try {
      const running = child('APPROVE', attemptId);
      await running.message('READY');
      running.process.send('GO');
      const wait = await waitUntil(async () => {
        const attempt = await db.settlementAutoApprovalAttempt.findUnique({ where: { id: attemptId } });
        if (attempt?.outcome !== 'STARTED') return null;
        const blocked = await db.$queryRaw<Array<{ pid: number; query: string }>>`
          SELECT pid, query FROM pg_stat_activity
          WHERE datname=current_database() AND wait_event_type='Lock'
            AND query LIKE '%SettlementApproval%' AND pid <> pg_backend_pid()`;
        return blocked.length === 1 ? blocked[0] : null;
      }, 'a STARTED attempt and a canonical SettlementApproval SQL lock wait');
      expect(wait.query).toContain('SettlementApproval');
      await stopOwned(running.process);
    } finally {
      unlock();
      await lock;
    }
    const before = await financialState(attemptId);
    expect(before.approval).toMatchObject({ status: 'DRAFT', approvedBy: null, ...frozenTotals,
      successfulAutoApprovalAttemptId: null });
    expect(before.attempt).toMatchObject({ outcome: 'STARTED' });
    expect(before.events.map((event) => event.outcome)).toEqual(['STARTED']);
    expect(before.activeLines).toBe(0);
    expect(before.payouts).toBe(0);
    const first = await recover(attemptId);
    expect(first.reconciliations).toEqual(expect.arrayContaining([
      expect.objectContaining({ attemptId, classification: 'UNKNOWN' })]));
    expect(first.vendors[0]?.outcomes).toEqual(expect.arrayContaining([
      expect.objectContaining({ settlementApprovalId: approvalId, attemptId, classification: 'UNKNOWN' })]));
    await recover(attemptId);
    const after = await financialState(attemptId);
    expect(after.approval).toMatchObject({ status: 'DRAFT', ...frozenTotals });
    expect(after.attempt?.outcome).toBe('STARTED');
    expect(after.events.map((event) => event.outcome)).toEqual(['STARTED']);
    expect(after.activeLines).toBe(0);
    expect(after.payouts).toBe(0);
  }, 60_000);

  it('kills a real child after canonical commit but before caller ACK; restart reconciles without duplicate approval', async () => {
    const attemptId = `f06-postcommit-${randomUUID()}`;
    const running = child('APPROVE', attemptId);
    await running.message('READY');
    const returned = running.message('RETURNED');
    running.process.send('GO');
    expect((await returned).status).toBe('approved');
    const before = await financialState(attemptId);
    expect(before.approval).toMatchObject({ status: 'APPROVED',
      approvedBy: 'system:settlement_auto_approval', successfulAutoApprovalAttemptId: attemptId,
      ...frozenTotals });
    expect(before.attempt?.outcome).toBe('APPROVED');
    expect(before.events.map((event) => event.outcome)).toEqual(['STARTED', 'APPROVED']);
    expect(before.activeLines).toBe(1);
    await stopOwned(running.process);
    expect(await reconcile(attemptId)).toMatchObject({
      attemptId, classification: 'VERIFIED_COMPLETED', reasonCode: 'EXACT_ATTEMPT_APPROVED',
      settlementStatus: 'APPROVED',
    });
    const first = await recover(attemptId);
    const second = await recover(attemptId);
    expect(first.vendors).toEqual([]);
    expect(second.vendors).toEqual([]);
    const after = await financialState(attemptId);
    expect(after.approval).toMatchObject({ status: 'APPROVED',
      approvedBy: 'system:settlement_auto_approval', successfulAutoApprovalAttemptId: attemptId,
      ...frozenTotals });
    expect(after.attempt?.outcome).toBe('APPROVED');
    expect(after.events.map((event) => event.outcome)).toEqual(['STARTED', 'APPROVED']);
    expect(after.activeLines).toBe(1);
    expect(await db.settlementAutoApprovalAttempt.count({ where: { settlementApprovalId: approvalId } })).toBe(1);
    expect(after.payouts).toBe(0);
  }, 60_000);
});
