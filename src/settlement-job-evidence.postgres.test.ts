import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '../backend/node_modules/@prisma/client/index.js';

const databaseUrl = process.env.TEST_DATABASE_URL?.trim();
const describeWithPostgres = databaseUrl ? describe : describe.skip;

describeWithPostgres('scheduled job evidence with isolated PostgreSQL 16', () => {
  let db: PrismaClient;
  let getStatus: typeof import('../backend/src/modules/finance/settlement-schedule-job.service.js')['getSettlementScheduleAutoDraftJobStatus'];
  let runJob: typeof import('../backend/src/modules/finance/settlement-schedule-job.service.js')['runSettlementScheduleAutoDraftJob'];
  let sequence = 0;
  let firstRunDate: Date;
  let runDate: Date;
  let prefix: string;
  const env = { SETTLEMENT_AUTO_DRAFT_JOB_ENABLED: true, SETTLEMENT_AUTO_DRAFT_JOB_DRY_RUN: false };

  beforeAll(async () => {
    const target = new URL(databaseUrl!);
    if (process.env.SETTLEMENT_JOB_2C_TEST_DATABASE_ISOLATED !== '1' ||
        !['127.0.0.1', 'localhost'].includes(target.hostname) ||
        target.pathname.slice(1) !== 'settlement_job_2c_validation') {
      throw new Error('2C requires the isolated local settlement_job_2c_validation database.');
    }
    process.env.DATABASE_URL = databaseUrl;
    ({ getSettlementScheduleAutoDraftJobStatus: getStatus, runSettlementScheduleAutoDraftJob: runJob } =
      await import('../backend/src/modules/finance/settlement-schedule-job.service.js'));
    db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await db.$connect();
    const [{ version, name }] = await db.$queryRaw<Array<{ version: string; name: string }>>`
      SELECT current_setting('server_version_num') AS version, current_database() AS name
    `;
    expect(Number(version)).toBeGreaterThanOrEqual(160000);
    expect(Number(version)).toBeLessThan(170000);
    expect(name).toBe('settlement_job_2c_validation');
    const latest = await db.settlementApproval.aggregate({ _max: { scheduledRunDate: true } });
    firstRunDate = new Date((latest._max.scheduledRunDate?.getTime() ?? Date.UTC(2026, 11, 31)) + 24 * 60 * 60 * 1000);
  });

  afterAll(async () => { await db?.$disconnect(); });

  beforeEach(async () => {
    // JobRun has no finance FK; the dedicated suite database is discarded after validation.
    await db.settlementScheduleJobRun.deleteMany();
    sequence += 1;
    runDate = new Date(firstRunDate.getTime() + (sequence - 1) * 24 * 60 * 60 * 1000);
    prefix = `job2c-${process.pid}-${Date.now()}-${sequence}`;
  });

  function runDateKey() { return runDate.toISOString().slice(0, 10); }
  function cycleKey(vendorId: string) { return `scheduled-settlement:${vendorId}:${runDateKey()}`; }

  async function vendor(suffix: string) {
    const id = `${prefix}-${suffix}`;
    await db.vendor.create({ data: { id, name: `2C ${suffix}` } });
    return id;
  }

  async function job(status: 'COMPLETED' | 'FAILED' | 'PROCESSING', metadataJson: object | null,
    createdDraftCount = 0, skippedCount = 0, blockedCount = 0) {
    return db.settlementScheduleJobRun.create({ data: {
      id: `${prefix}-run`, runDate, status, writesPerformed: createdDraftCount > 0,
      createdDraftCount, skippedCount, blockedCount,
      finishedAt: status === 'PROCESSING' ? null : new Date(),
      metadataJson: metadataJson ?? undefined,
    } });
  }

  async function approval(vendorId: string, suffix: string, status: 'DRAFT' | 'APPROVED' | 'CANCELLED', lineCount = 0) {
    const id = `${prefix}-${suffix}-approval`;
    const ledgerIds: string[] = [];
    if (lineCount) {
      const order = `${prefix}-${suffix}-order`;
      const allocation = `${prefix}-${suffix}-allocation`;
      await db.shopifyOrder.create({ data: {
        id: order, sourceShopifyOrderId: `gid://shopify/Order/${order}`, sourceShopifyOrderNumber: `#${order}`,
      } });
      await db.vendorAllocation.create({ data: {
        id: allocation, sourceShopifyOrderId: order, sourceShopifyOrderNumber: `#${order}`,
        originalVendorId: vendorId, assignedVendorId: vendorId,
      } });
      for (let index = 0; index < lineCount; index += 1) {
        ledgerIds.push(`${prefix}-${suffix}-ledger-${index}`);
      }
      await db.financeLedgerEntry.createMany({ data: ledgerIds.map((ledgerId) => ({
        id: ledgerId, vendorAllocationId: allocation, vendorId, entryType: 'sale', amount: '100.00',
        settlementStatus: 'PENDING', payoutStatus: 'PENDING',
        commissionPercentSnapshot: '0.00', commissionVatPercentSnapshot: '0.00',
        settlementDelayDaysSnapshot: 0,
      })) });
    }
    await db.settlementApproval.create({ data: {
      id, vendorId, status, scheduledRunDate: runDate, scheduledCycleKey: cycleKey(vendorId),
      currency: 'TRY', grossSalesMinor: lineCount * 10000, refundTotalMinor: 0,
      commissionMinor: 0, commissionVatMinor: 0, netPayableMinor: lineCount * 10000,
      sourceSnapshotJson: {},
    } });
    if (lineCount) {
      await db.settlementApprovalLine.createMany({ data: ledgerIds.map((ledgerId, index) => ({
        id: `${prefix}-${suffix}-line-${index}`, settlementApprovalId: id,
        financeLedgerEntryId: ledgerId, lineType: 'SALE', amountMinor: 10000,
        commissionMinor: 0, commissionVatMinor: 0, payableImpactMinor: 10000,
        sourceSnapshotJson: {},
      })) });
    }
    return { id, ledgerIds };
  }

  it('reconciles a COMPLETED job and existing DRAFT without equating their statuses', async () => {
    const a = await vendor('a');
    const draft = await approval(a, 'a', 'DRAFT', 1);
    await job('COMPLETED', { summary: { failed: 0 }, createdDrafts: [
      { vendorId: a, settlementApprovalId: draft.id, netPayableMinor: 10000 },
    ], skipped: [], failed: [] }, 1);
    const result = await getStatus(env);
    expect(result.lastRun?.status).toBe('COMPLETED');
    expect(result.evidence?.settlements).toEqual([expect.objectContaining({
      id: draft.id, vendorId: a, status: 'DRAFT', cycleAligned: true,
      jobProvenance: 'MATCHED_METADATA', lineCount: 1,
      sourceLines: [expect.objectContaining({ financeLedgerEntryId: draft.ledgerIds[0] })],
    })]);
    const duplicate = await runJob({ env, runDate, confirmScheduledSettlementAutoDraftJob: true });
    expect(duplicate.jobRun?.status).toBe('COMPLETED');
    expect(duplicate.vendors).toEqual([expect.objectContaining({ vendorId: a, state: 'CREATED' })]);
    expect(await db.settlementScheduleJobRun.count()).toBe(1);
    expect(await db.settlementApproval.count({ where: { id: draft.id } })).toBe(1);
  });

  it('reports FAILED partial DRAFT evidence and the failed vendor without a retry', async () => {
    const a = await vendor('a');
    const b = await vendor('b');
    const draft = await approval(a, 'a', 'DRAFT');
    await job('FAILED', { summary: { failed: 1 }, createdDrafts: [
      { vendorId: a, settlementApprovalId: draft.id },
    ], skipped: [], failed: [{ vendorId: b, reason: 'Fixture write failure.' }] }, 1, 0, 1);
    const result = await getStatus(env);
    expect(result.lastRun?.status).toBe('FAILED');
    expect(result.evidence?.settlements[0]).toMatchObject({ id: draft.id, status: 'DRAFT', jobProvenance: 'MATCHED_METADATA' });
    expect(result.evidence?.jobVendorOutcomes).toEqual([{ vendorId: b, state: 'FAILED', reason: 'Fixture write failure.' }]);
    const duplicate = await runJob({ env, runDate, confirmScheduledSettlementAutoDraftJob: true });
    expect(duplicate.ok).toBe(false);
    expect(duplicate.jobRun?.status).toBe('FAILED');
    expect(await db.settlementScheduleJobRun.count()).toBe(1);
    expect(await db.settlementApproval.count({ where: { id: draft.id } })).toBe(1);
  });

  it('keeps PROCESSING uncertain even when a DRAFT was committed', async () => {
    const a = await vendor('a');
    const draft = await approval(a, 'a', 'DRAFT');
    await job('PROCESSING', { triggeredBy: 'fixture' });
    const result = await getStatus(env);
    expect(result.lastRun?.status).toBe('PROCESSING');
    expect(result.evidence?.settlements[0]).toMatchObject({ id: draft.id, jobProvenance: 'UNKNOWN', status: 'DRAFT' });
    expect(result.evidence?.notes.join(' ')).toContain('does not prove that a worker is still active');
    const duplicate = await runJob({ env, runDate, confirmScheduledSettlementAutoDraftJob: true });
    expect(duplicate.ok).toBe(false);
    expect(duplicate.summary.createdDrafts).toBeNull();
    expect(await db.settlementScheduleJobRun.count()).toBe(1);
  });

  it('does not infer an unattempted vendor from missing metadata or settlement', async () => {
    await job('FAILED', null);
    const result = await getStatus(env);
    expect(result.evidence).toMatchObject({
      settlements: [], jobCreatedClaims: [], createdClaimsAvailable: false,
    });
    expect(result.evidence?.notes.join(' ')).toContain('does not prove a vendor was never attempted');
    const duplicate = await runJob({ env, runDate, confirmScheduledSettlementAutoDraftJob: true });
    expect(duplicate.vendors).toEqual([]);
    expect(duplicate.summary.createdDrafts).toBeNull();
  });

  it.each(['DRAFT', 'CANCELLED', 'APPROVED'] as const)(
    'reports a manual-cycle %s settlement without attributing it to the job', async (status) => {
      const a = await vendor('manual');
      const row = await approval(a, 'manual', status);
      await job('COMPLETED', { summary: { failed: 0 }, createdDrafts: [], skipped: [], failed: [] });
      const result = await getStatus(env);
      expect(result.evidence?.settlements[0]).toMatchObject({
        id: row.id, status, cycleAligned: true, jobProvenance: 'UNKNOWN',
      });
      expect(result.evidence?.jobCreatedClaims).toEqual([]);
    },
  );

  it('keeps source-line IDs with their own vendors and leaves finance records unchanged', async () => {
    const a = await vendor('a');
    const b = await vendor('b');
    const first = await approval(a, 'a', 'DRAFT', 1);
    const second = await approval(b, 'b', 'APPROVED', 1);
    await job('COMPLETED', { summary: { failed: 0 }, createdDrafts: [], skipped: [], failed: [] });
    const before = {
      run: await db.settlementScheduleJobRun.findFirstOrThrow(),
      approvals: await db.settlementApproval.findMany({ where: { id: { in: [first.id, second.id] } }, orderBy: { id: 'asc' } }),
      lines: await db.settlementApprovalLine.findMany({ where: { settlementApprovalId: { in: [first.id, second.id] } }, orderBy: { id: 'asc' } }),
      ledgers: await db.financeLedgerEntry.findMany({ where: { id: { in: [...first.ledgerIds, ...second.ledgerIds] } }, orderBy: { id: 'asc' } }),
      payoutCount: await db.payoutBatch.count(),
      correctionCount: await db.financialCorrectionAuthority.count(),
      balanceEventCount: await db.vendorBalanceEvent.count(),
    };
    const result = await getStatus(env);
    expect(result.evidence?.settlements).toHaveLength(2);
    expect(result.evidence?.settlements.find((row) => row.vendorId === a)?.sourceLines[0].financeLedgerEntryId).toBe(first.ledgerIds[0]);
    expect(result.evidence?.settlements.find((row) => row.vendorId === b)?.sourceLines[0].financeLedgerEntryId).toBe(second.ledgerIds[0]);
    expect(result.evidence?.settlements.every((row) => row.jobProvenance === 'UNKNOWN')).toBe(true);
    expect(await db.settlementScheduleJobRun.findFirstOrThrow()).toEqual(before.run);
    expect(await db.settlementApproval.findMany({ where: { id: { in: [first.id, second.id] } }, orderBy: { id: 'asc' } })).toEqual(before.approvals);
    expect(await db.settlementApprovalLine.findMany({ where: { settlementApprovalId: { in: [first.id, second.id] } }, orderBy: { id: 'asc' } })).toEqual(before.lines);
    expect(await db.financeLedgerEntry.findMany({ where: { id: { in: [...first.ledgerIds, ...second.ledgerIds] } }, orderBy: { id: 'asc' } })).toEqual(before.ledgers);
    expect(await db.payoutBatch.count()).toBe(before.payoutCount);
    expect(await db.financialCorrectionAuthority.count()).toBe(before.correctionCount);
    expect(await db.vendorBalanceEvent.count()).toBe(before.balanceEventCount);
  });

  it('marks an absent metadata settlement as missing or unlisted, not successful', async () => {
    const a = await vendor('a');
    await job('COMPLETED', { createdDrafts: [{ vendorId: a, settlementApprovalId: `${prefix}-missing` }] }, 1);
    const result = await getStatus(env);
    expect(result.evidence?.jobCreatedClaims).toEqual([expect.objectContaining({
      settlementApprovalId: `${prefix}-missing`, evidence: 'MISSING_OR_UNLISTED',
    })]);
    expect(result.evidence?.settlements).toEqual([]);
  });

  it('reports contradictory metadata when its vendor does not own the referenced settlement', async () => {
    const actualVendor = await vendor('actual');
    const claimedVendor = await vendor('claimed');
    const row = await approval(actualVendor, 'actual', 'DRAFT');
    await job('COMPLETED', { createdDrafts: [{ vendorId: claimedVendor, settlementApprovalId: row.id }] }, 1);
    const result = await getStatus(env);
    expect(result.evidence?.settlements[0]).toMatchObject({
      id: row.id, vendorId: actualVendor, jobProvenance: 'UNKNOWN',
    });
    expect(result.evidence?.jobCreatedClaims).toEqual([expect.objectContaining({
      vendorId: claimedVendor, settlementApprovalId: row.id, evidence: 'CONTRADICTORY',
    })]);
  });

  it('marks settlement and source-line limits as truncated', async () => {
    const vendors = Array.from({ length: 101 }, (_, index) => `${prefix}-vendor-${index}`);
    await db.vendor.createMany({ data: vendors.map((id) => ({ id, name: id })) });
    await db.settlementApproval.createMany({ data: vendors.map((vendorId, index) => ({
      id: `${prefix}-approval-${index}`, vendorId, status: 'DRAFT',
      scheduledRunDate: runDate, scheduledCycleKey: cycleKey(vendorId),
      grossSalesMinor: 0, refundTotalMinor: 0, commissionMinor: 0, commissionVatMinor: 0,
      netPayableMinor: 0, sourceSnapshotJson: {},
    })) });
    await job('COMPLETED', { createdDrafts: [] });
    const result = await getStatus(env);
    expect(result.evidence?.recordsTruncated).toBe(true);
    expect(result.evidence?.settlements).toHaveLength(100);
    expect(result.evidence?.notes.join(' ')).toContain('omitted records remain unknown');
  });

  it('reports only the first 20 of 21 persisted settlement source lines', async () => {
    const a = await vendor('a');
    const row = await approval(a, 'a', 'DRAFT', 21);
    await job('COMPLETED', { createdDrafts: [] });
    const result = await getStatus(env);
    expect(result.evidence?.settlements[0]).toMatchObject({ id: row.id, lineCount: 21, sourceLinesTruncated: true });
    expect(result.evidence?.settlements[0].sourceLines).toHaveLength(20);
  });
});
