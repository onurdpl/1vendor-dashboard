import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '../backend/node_modules/@prisma/client/index.js';
import type { SettlementScheduleAutoDraftJobStatusResponse } from './lib/api/contracts.js';

const databaseUrl = process.env.TEST_DATABASE_URL?.trim();
const suite = databaseUrl ? describe : describe.skip;
const databaseName = 'settlement_job_http_validation';
const route = '/admin/finance/settlement-schedules/auto-draft-job-status';

suite('Admin scheduled settlement status over real HTTP and isolated PostgreSQL 16', () => {
  let db: PrismaClient;
  let app: Awaited<ReturnType<typeof import('../backend/src/app.js')['createApp']>>;
  let origin: string;
  let adminCookie: string;
  let vendorCookie: string;
  let runDate: Date;
  let firstRunDate: Date;
  let prefix: string;
  let sequence = 0;

  beforeAll(async () => {
    const target = new URL(databaseUrl!);
    if (process.env.SETTLEMENT_JOB_HTTP_TEST_DATABASE_ISOLATED !== '1' ||
        target.hostname !== '127.0.0.1' || target.pathname.slice(1) !== databaseName ||
        !target.port) {
      throw new Error('Real HTTP verification requires the isolated local settlement_job_http_validation database.');
    }
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = databaseUrl;
    process.env.SETTLEMENT_AUTO_DRAFT_JOB_ENABLED = 'false';
    process.env.SETTLEMENT_AUTO_DRAFT_JOB_DRY_RUN = 'true';
    process.env.SETTLEMENT_AUTO_DRAFT_SCHEDULER_ENABLED = 'false';
    process.env.SHOPIFY_ORDERS_CREATE_EXECUTOR_ENABLED = 'false';
    process.env.CUSTOMER_CANCELLATION_AUTO_REFUND_ENABLED = 'false';
    process.env.SCHEDULED_RECONCILIATION_ENABLED = 'false';
    process.env.CANONICAL_RECONCILIATION_ENABLED = 'false';
    process.env.SOPYO_DELIVERY_POLLING_ENABLED = 'false';
    process.env.SOPYO_ORDER_PUSH_WORKER_ENABLED = 'false';
    process.env.SHIPPING_EXECUTION_ENABLED = 'false';
    process.env.KARGONOMI_BASE_URL = 'http://127.0.0.1:1';
    process.env.KARGONOMI_API_TOKEN = 'disposable-http-test-only';

    db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await db.$connect();
    const [{ version, name, owner }] = await db.$queryRaw<Array<{ version: string; name: string; owner: string }>>`
      SELECT current_setting('server_version_num') AS version, current_database() AS name, current_user AS owner
    `;
    expect(Number(version)).toBeGreaterThanOrEqual(160000);
    expect(Number(version)).toBeLessThan(170000);
    expect(name).toBe(databaseName);
    expect(owner).toBe(target.username);
    const latestApproval = await db.settlementApproval.aggregate({ _max: { scheduledRunDate: true } });
    firstRunDate = new Date((latestApproval._max.scheduledRunDate?.getTime() ?? Date.UTC(2034, 11, 31)) + 24 * 60 * 60 * 1000);

    const { hashPasswordArgon2id } = await import('../backend/src/modules/auth/password-hashing.js');
    const password = `http-only-${process.pid}-${Date.now()}`;
    const passwordHash = await hashPasswordArgon2id(password);
    const identity = `job-http-${process.pid}-${Date.now()}`;
    await db.user.createMany({ data: [
      { id: `${identity}-admin`, email: `${identity}-admin@example.test`, name: 'HTTP Admin', role: 'ADMIN', passwordHash },
      { id: `${identity}-vendor`, email: `${identity}-vendor@example.test`, name: 'HTTP Vendor', role: 'VENDOR', passwordHash },
    ] });

    const { createApp } = await import('../backend/src/app.js');
    app = createApp();
    origin = await app.listen({ host: '127.0.0.1', port: 0 });
    async function login(email: string) {
      const response = await fetch(`${origin}/auth/login`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      expect(response.status).toBe(200);
      expect((await response.json()).user.email).toBe(email);
      const cookie = response.headers.get('set-cookie')?.split(';', 1)[0];
      expect(cookie).toBeTruthy();
      return cookie!;
    }
    adminCookie = await login(`${identity}-admin@example.test`);
    vendorCookie = await login(`${identity}-vendor@example.test`);
  });

  afterAll(async () => {
    await app?.close();
    await db?.$disconnect();
    const { prisma } = await import('../backend/src/db/prisma.js');
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await db.settlementScheduleJobRun.deleteMany();
    sequence += 1;
    runDate = new Date(firstRunDate.getTime() + (sequence - 1) * 24 * 60 * 60 * 1000);
    prefix = `job-http-${process.pid}-${Date.now()}-${sequence}`;
  });

  const runKey = () => runDate.toISOString().slice(0, 10);
  const cycleKey = (vendorId: string) => `scheduled-settlement:${vendorId}:${runKey()}`;
  async function vendor(suffix: string) {
    const id = `${prefix}-${suffix}`;
    await db.vendor.create({ data: { id, name: id } });
    return id;
  }
  async function job(status: 'COMPLETED' | 'FAILED' | 'PROCESSING', metadataJson?: object, createdDraftCount = 0) {
    return db.settlementScheduleJobRun.create({ data: {
      id: `${prefix}-job`, runDate, status, writesPerformed: createdDraftCount > 0,
      createdDraftCount, skippedCount: 0, blockedCount: status === 'FAILED' ? 1 : 0,
      finishedAt: status === 'PROCESSING' ? null : new Date(), metadataJson,
    } });
  }
  async function approval(vendorId: string, suffix: string, status: 'DRAFT' | 'APPROVED' | 'CANCELLED', lineCount = 0) {
    const id = `${prefix}-${suffix}-approval`;
    const ledgerIds: string[] = [];
    if (lineCount > 0) {
      const orderId = `${prefix}-${suffix}-order`;
      const allocationId = `${prefix}-${suffix}-allocation`;
      await db.shopifyOrder.create({ data: {
        id: orderId, sourceShopifyOrderId: `gid://shopify/Order/${orderId}`, sourceShopifyOrderNumber: `#${orderId}`,
      } });
      await db.vendorAllocation.create({ data: {
        id: allocationId, sourceShopifyOrderId: orderId, sourceShopifyOrderNumber: `#${orderId}`,
        originalVendorId: vendorId, assignedVendorId: vendorId,
      } });
      for (let index = 0; index < lineCount; index += 1) ledgerIds.push(`${prefix}-${suffix}-ledger-${index}`);
      await db.financeLedgerEntry.createMany({ data: ledgerIds.map((ledgerId) => ({
        id: ledgerId, vendorAllocationId: allocationId, vendorId, entryType: 'sale', amount: '100.00',
        settlementStatus: 'PENDING', payoutStatus: 'PENDING', commissionPercentSnapshot: '0.00',
        commissionVatPercentSnapshot: '0.00', settlementDelayDaysSnapshot: 0,
      })) });
    }
    await db.settlementApproval.create({ data: {
      id, vendorId, status, scheduledRunDate: runDate, scheduledCycleKey: cycleKey(vendorId),
      currency: 'TRY', grossSalesMinor: lineCount * 10000, refundTotalMinor: 0,
      commissionMinor: 0, commissionVatMinor: 0, netPayableMinor: lineCount * 10000, sourceSnapshotJson: {},
    } });
    if (lineCount > 0) await db.settlementApprovalLine.createMany({ data: ledgerIds.map((ledgerId, index) => ({
      id: `${prefix}-${suffix}-line-${index}`, settlementApprovalId: id, financeLedgerEntryId: ledgerId,
      lineType: 'SALE', amountMinor: 10000, commissionMinor: 0, commissionVatMinor: 0,
      payableImpactMinor: 10000, sourceSnapshotJson: {},
    })) });
    return { id, ledgerIds };
  }
  async function get(cookie = adminCookie) {
    const response = await fetch(`${origin}${route}`, { headers: { cookie } });
    return { status: response.status, body: await response.json() as SettlementScheduleAutoDraftJobStatusResponse };
  }

  it('enforces real session authentication and Admin authorization', async () => {
    const anonymous = await fetch(`${origin}${route}`);
    expect(anonymous.status).toBe(401);
    const nonAdmin = await get(vendorCookie);
    expect(nonAdmin.status).toBe(403);
    const admin = await get();
    expect(admin.status).toBe(200);
    expect(admin.body).toMatchObject({ ok: true, writesPerformed: false, enabled: false, dryRun: true, mode: 'DRY_RUN', lastRun: null, evidence: null });
  });

  it('returns COMPLETED JobRun, DRAFT and exact vendor-owned source over HTTP', async () => {
    const owner = await vendor('owner');
    const row = await approval(owner, 'owner', 'DRAFT', 1);
    await job('COMPLETED', { createdDrafts: [{ vendorId: owner, settlementApprovalId: row.id }], skipped: [], failed: [] }, 1);
    const { status, body } = await get();
    expect(status).toBe(200);
    expect(body.lastRun).toMatchObject({ status: 'COMPLETED', runDate: runKey(), createdDraftCount: 1 });
    expect(body.evidence?.settlements).toEqual([expect.objectContaining({
      id: row.id, vendorId: owner, status: 'DRAFT', cycleAligned: true,
      jobProvenance: 'MATCHED_METADATA', lineCount: 1,
      sourceLines: [expect.objectContaining({ financeLedgerEntryId: row.ledgerIds[0], lineType: 'SALE' })],
    })]);
    expect(body.evidence?.jobCreatedClaims).toEqual([expect.objectContaining({ evidence: 'MATCHED' })]);
  });

  it('preserves FAILED partial evidence and does not fabricate absent vendor work', async () => {
    const done = await vendor('done');
    const failed = await vendor('failed');
    const row = await approval(done, 'done', 'DRAFT');
    await job('FAILED', { createdDrafts: [{ vendorId: done, settlementApprovalId: row.id }],
      skipped: [], failed: [{ vendorId: failed, reason: 'Fixture failure.' }] }, 1);
    const { body } = await get();
    expect(body.lastRun?.status).toBe('FAILED');
    expect(body.evidence?.settlements).toEqual([expect.objectContaining({ id: row.id, vendorId: done })]);
    expect(body.evidence?.jobVendorOutcomes).toEqual([{ vendorId: failed, state: 'FAILED', reason: 'Fixture failure.' }]);
    expect(body.evidence?.settlements.some((settlement) => settlement.vendorId === failed)).toBe(false);
  });

  it('reports PROCESSING as unverified worker liveness', async () => {
    const owner = await vendor('processing');
    const row = await approval(owner, 'processing', 'DRAFT');
    await job('PROCESSING', { triggeredBy: 'fixture' });
    const { body } = await get();
    expect(body.lastRun).toMatchObject({ status: 'PROCESSING', finishedAt: null });
    expect(body.evidence?.settlements[0]).toMatchObject({ id: row.id, jobProvenance: 'UNKNOWN' });
    expect(body.evidence?.notes.join(' ')).toContain('does not prove that a worker is still active');
  });

  it('keeps incomplete metadata and absent settlement evidence explicitly unknown', async () => {
    await job('FAILED');
    const { body } = await get();
    expect(body.evidence).toMatchObject({ createdClaimsAvailable: false, jobOutcomeMetadataComplete: false, settlements: [], jobCreatedClaims: [] });
    expect(body.evidence?.notes.join(' ')).toContain('does not prove a vendor was never attempted');
  });

  it.each(['DRAFT', 'APPROVED', 'CANCELLED'] as const)(
    'does not invent automatic provenance for a manual-cycle %s', async (status) => {
      const owner = await vendor(status);
      const row = await approval(owner, status, status);
      await job('COMPLETED', { createdDrafts: [], skipped: [], failed: [] });
      const result = await get();
      expect(result.body.evidence?.settlements[0]).toMatchObject({ id: row.id, status, cycleAligned: true, jobProvenance: 'UNKNOWN' });
      expect(result.body.evidence?.jobCreatedClaims).toEqual([]);
    },
  );

  it('keeps two vendors and their source lines isolated in the response', async () => {
    const firstVendor = await vendor('first');
    const secondVendor = await vendor('second');
    const first = await approval(firstVendor, 'first', 'DRAFT', 1);
    const second = await approval(secondVendor, 'second', 'APPROVED', 1);
    await job('COMPLETED', { createdDrafts: [], skipped: [], failed: [] });
    const { body } = await get();
    expect(body.evidence?.settlements).toHaveLength(2);
    expect(body.evidence?.settlements.find((row) => row.vendorId === firstVendor)?.sourceLines.map((line) => line.financeLedgerEntryId)).toEqual(first.ledgerIds);
    expect(body.evidence?.settlements.find((row) => row.vendorId === secondVendor)?.sourceLines.map((line) => line.financeLedgerEntryId)).toEqual(second.ledgerIds);
  });

  it('exposes the 100-settlement evidence limit and truncation note over HTTP', async () => {
    const vendors = Array.from({ length: 101 }, (_, index) => `${prefix}-vendor-${index}`);
    await db.vendor.createMany({ data: vendors.map((id) => ({ id, name: id })) });
    await db.settlementApproval.createMany({ data: vendors.map((vendorId, index) => ({
      id: `${prefix}-approval-${index}`, vendorId, status: 'DRAFT', scheduledRunDate: runDate,
      scheduledCycleKey: cycleKey(vendorId), grossSalesMinor: 0, refundTotalMinor: 0,
      commissionMinor: 0, commissionVatMinor: 0, netPayableMinor: 0, sourceSnapshotJson: {},
    })) });
    await job('COMPLETED', { createdDrafts: [], skipped: [], failed: [] });
    const { body } = await get();
    expect(body.evidence?.recordsTruncated).toBe(true);
    expect(body.evidence?.settlements).toHaveLength(100);
    expect(body.evidence?.notes.join(' ')).toContain('omitted records remain unknown');
  });

  it('exposes the 20-line limit without presenting truncated sources as complete', async () => {
    const owner = await vendor('many-lines');
    const row = await approval(owner, 'many-lines', 'DRAFT', 21);
    await job('COMPLETED', { createdDrafts: [], skipped: [], failed: [] });
    const { body } = await get();
    expect(body.evidence?.settlements[0]).toMatchObject({ id: row.id, lineCount: 21, sourceLinesTruncated: true });
    expect(body.evidence?.settlements[0].sourceLines).toHaveLength(20);
  });

  it('does not mutate any financial record through the read route', async () => {
    const owner = await vendor('unchanged');
    const row = await approval(owner, 'unchanged', 'DRAFT', 1);
    await job('COMPLETED', { createdDrafts: [{ vendorId: owner, settlementApprovalId: row.id }], skipped: [], failed: [] }, 1);
    async function snapshot() {
      return {
        runs: await db.settlementScheduleJobRun.findMany({ orderBy: { id: 'asc' } }),
        approvals: await db.settlementApproval.findMany({ orderBy: { id: 'asc' } }),
        lines: await db.settlementApprovalLine.findMany({ orderBy: { id: 'asc' } }),
        ledgers: await db.financeLedgerEntry.findMany({ orderBy: { id: 'asc' } }),
        payouts: await db.payoutBatch.findMany({ orderBy: { id: 'asc' } }),
        payoutLines: await db.payoutBatchLine.findMany({ orderBy: { id: 'asc' } }),
        corrections: await db.financialCorrectionAuthority.findMany({ orderBy: { id: 'asc' } }),
        correctionCredits: await db.financialCorrectionCredit.findMany({ orderBy: { id: 'asc' } }),
        correctionDeductions: await db.financialCorrectionDeduction.findMany({ orderBy: { id: 'asc' } }),
        balances: await db.vendorBalanceEvent.findMany({ orderBy: { id: 'asc' } }),
      };
    }
    const before = await snapshot();
    expect((await get()).status).toBe(200);
    expect((await get()).status).toBe(200);
    expect(await snapshot()).toEqual(before);
  });
});
