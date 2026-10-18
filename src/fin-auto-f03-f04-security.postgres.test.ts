import { randomUUID } from 'node:crypto';
import { fork, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '../backend/node_modules/@prisma/client/index.js';

const databaseUrl = process.env.TEST_DATABASE_URL?.trim();
const describeWithPostgres = databaseUrl ? describe : describe.skip;
type Sweep = Awaited<ReturnType<typeof import('../backend/src/modules/finance/settlement-auto-approval-scheduler.service.js')['runAutomaticSettlementApprovalSweep']>>;

describeWithPostgres('F-03/F-04 isolated automatic approval security', () => {
  let db: PrismaClient;
  let vendorId: string;
  let createDraft: typeof import('../backend/src/modules/finance/settlement-approval.service.js')['createAdminManualDraftApproval'];
  let sweep: typeof import('../backend/src/modules/finance/settlement-auto-approval-scheduler.service.js')['runAutomaticSettlementApprovalSweep'];
  let delivery: typeof import('../backend/src/modules/shipping/allocation-delivered-observation.service.js')['recordVerifiedDeliveredObservation'];
  const children = new Set<ChildProcess>();

  async function verifyTarget() {
    const target = new URL(databaseUrl!);
    const local = target.username === 'onur' && !target.password &&
      (target.port === '5433' && target.pathname === '/fin_auto_p4_pg16_8f2ab319' ||
        target.port === '5432' && target.pathname === '/fin_auto_p4_pg18_143fa61d' ||
        target.port === '5433' && target.pathname === '/fin_auto_f03f04_pg16_8be49807045e528f' ||
        target.port === '5432' && target.pathname === '/fin_auto_f03f04_pg18_cec3364d531b5fae');
    const ci = process.env.GITHUB_ACTIONS === 'true' && process.env.CI === 'true' &&
      process.env.FIN_AUTO_CI_DB_PROOF?.match(/^[a-f0-9]{64}$/) &&
      process.env.FIN_AUTO_CI_CLUSTER_ID?.match(/^\d+$/) &&
      target.username === 'postgres' && target.password === 'postgres' &&
      target.port === '5432' && target.pathname === '/fin_auto_f03f04_ci_validation';
    if (process.env.FIN_AUTO_P4_TEST_DATABASE_ISOLATED !== '1' ||
        target.protocol !== 'postgresql:' || target.hostname !== '127.0.0.1' ||
        target.searchParams.get('schema') !== 'public' || target.searchParams.size !== 1 ||
        target.hash || !(local || ci)) {
      throw new Error('F-03/F-04 requires an approved isolated local or CI database.');
    }
    if (process.env.DATABASE_URL && process.env.DATABASE_URL !== databaseUrl) {
      throw new Error('F-03/F-04 ambient canonical Prisma target differs from the test target.');
    }
    process.env.DATABASE_URL = databaseUrl;
    db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const [identity] = await db.$queryRaw<Array<{ name: string; port: number; version: string;
      systemId: bigint; owner: string; proof: string | null }>>`
      SELECT current_database() AS name, inet_server_port() AS port,
        current_setting('server_version_num') AS version,
        (SELECT system_identifier FROM pg_control_system()) AS "systemId",
        (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database()) AS owner,
        (SELECT shobj_description(oid, 'pg_database') FROM pg_database WHERE datname=current_database()) AS proof`;
    if (identity?.name !== target.pathname.slice(1) || identity.port !== Number(target.port) ||
        Math.floor(Number(identity.version) / 10000) !== (local ? (target.port === '5433' ? 16 : 18) : Number(process.env.FIN_AUTO_CI_PG_MAJOR)) ||
        String(identity.systemId) !== (local ? (target.port === '5433' ? '7689856229225255193' : '7637676237569338936') : process.env.FIN_AUTO_CI_CLUSTER_ID) ||
        (ci && identity.proof !== `fin-auto-ci:${process.env.FIN_AUTO_CI_DB_PROOF}`) ||
        identity.owner !== target.username) throw new Error('F-03/F-04 PostgreSQL cluster identity mismatch.');
    const { prisma } = await import('../backend/src/db/prisma.js');
    const [writeTarget] = await prisma.$queryRaw<Array<{ name: string; port: number; systemId: bigint }>>`
      SELECT current_database() AS name, inet_server_port() AS port,
        (SELECT system_identifier FROM pg_control_system()) AS "systemId"`;
    if (writeTarget?.name !== identity.name || writeTarget.port !== identity.port ||
        String(writeTarget.systemId) !== String(identity.systemId)) {
      throw new Error('F-03/F-04 canonical Prisma target mismatch.');
    }
  }

  async function draftFor(label: string) {
    const id = `f03-f04-${label}-${randomUUID()}`;
    const orderId = `${id}-order`;
    const allocationId = `${id}-allocation`;
    const saleId = `${id}-sale`;
    const executionId = `${id}-execution`;
    await db.shopifyOrder.create({ data: { id: orderId,
      sourceShopifyOrderId: `gid://shopify/Order/${orderId}`, sourceShopifyOrderNumber: `#${orderId}` } });
    await db.vendorAllocation.create({ data: { id: allocationId, sourceShopifyOrderId: orderId,
      sourceShopifyOrderNumber: `#${orderId}`, originalVendorId: vendorId, assignedVendorId: vendorId,
      outboundMethodSnapshot: 'KARGONOMI', fulfillmentStatus: 'Fulfilled', shippingStatus: 'Delivered' } });
    await db.shipmentExecution.create({ data: { id: executionId, allocationId, vendorId,
      provider: 'KARGONOMI', providerShipmentId: `${id}-shipment`, shipmentStatus: 'DELIVERED',
      requestSnapshot: {} } });
    const observation = await delivery({ allocationId,
      source: { method: 'KARGONOMI', shipmentExecutionId: executionId,
        sourceReference: `${id}-shipment` } }, db as never);
    await db.fulfillment.create({ data: { id: `${id}-fulfillment`, vendorAllocationId: allocationId,
      fulfillmentStatus: 'Delivered', shipmentUpdatedAt: observation.firstObservedDeliveredAt } });
    await db.financeLedgerEntry.create({ data: { id: saleId, vendorAllocationId: allocationId,
      vendorId, entryType: 'sale', amount: '100.00', payoutStatus: 'PENDING', settlementStatus: 'PENDING',
      commissionPercentSnapshot: '10.00', commissionVatPercentSnapshot: '20.00',
      settlementDelayDaysSnapshot: 0 } });
    const draft = await createDraft({ vendorId, candidateScope: 'selected_allocations',
      selectedAllocationIds: [allocationId] });
    expect(draft.status).toBe('draft');
    expect(draft.lines.map((line) => line.financeLedgerEntryId)).toEqual([saleId]);
    return { approvalId: draft.id, allocationId, saleId };
  }

  function startChild() {
    const child = fork(resolve(process.cwd(), 'src/fin-auto-f03-f04-scheduler-child.ts'), [], {
      execArgv: ['--import', 'tsx'],
      env: { ...process.env, TEST_DATABASE_URL: databaseUrl, DATABASE_URL: databaseUrl,
        FIN_AUTO_P4_TEST_DATABASE_ISOLATED: '1', FIN_AUTO_F03_VENDOR_ID: vendorId },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    children.add(child);
    child.stderr?.resume();
    const next = (kind: string) => new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`F-03 child ${kind} timed out.`)), 20_000);
      const onMessage = (message: Record<string, unknown>) => {
        if (message.kind !== kind) {
          if (message.kind === 'ERROR') { clearTimeout(timer); child.off('message', onMessage);
            reject(new Error(`F-03 child failed: ${String(message.errorType)}`)); }
          return;
        }
        clearTimeout(timer); child.off('message', onMessage); resolve(message);
      };
      child.on('message', onMessage);
      child.once('exit', (code) => {
        if (code !== 0) { clearTimeout(timer); child.off('message', onMessage);
          reject(new Error(`F-03 child exited ${code}.`)); }
      });
    });
    return { child, next };
  }

  async function persistUnknownAttempt(approvalId: string) {
    const attemptId = `${approvalId}-unknown`;
    await db.settlementAutoApprovalAttempt.create({ data: { id: attemptId,
      settlementApprovalId: approvalId, vendorId,
      events: { create: { outcome: 'STARTED', reasonCode: 'ATTEMPT_CREATED' } } } });
    await db.settlementAutoApprovalAttempt.update({ where: { id: attemptId },
      data: { outcome: 'UNKNOWN', reasonCode: 'UNCLASSIFIED_FAILURE',
        events: { create: { outcome: 'UNKNOWN', reasonCode: 'UNCLASSIFIED_FAILURE' } } } });
    return attemptId;
  }

  beforeEach(async () => {
    await verifyTarget();
    ({ createAdminManualDraftApproval: createDraft } = await import(
      '../backend/src/modules/finance/settlement-approval.service.js'));
    ({ runAutomaticSettlementApprovalSweep: sweep } = await import(
      '../backend/src/modules/finance/settlement-auto-approval-scheduler.service.js'));
    ({ recordVerifiedDeliveredObservation: delivery } = await import(
      '../backend/src/modules/shipping/allocation-delivered-observation.service.js'));
    vendorId = `f03-f04-vendor-${randomUUID()}`;
    await db.vendor.create({ data: { id: vendorId, name: 'Isolated Approval Security Test Vendor' } });
    await db.vendorFinancialProfile.create({ data: { vendorId, settlementDelayDays: 0,
      settlementFrequencyType: 'WEEKLY', weeklySettlementDay: 'WEDNESDAY',
      autoSettlementDraftEnabled: false } });
  });

  afterEach(async () => {
    for (const child of children) if (!child.killed) child.kill();
    children.clear();
    await db?.$disconnect();
    // Dedicated Package 4 databases retain only uniquely named, test-owned evidence.
  });

  it('F-03: two independent scheduler processes cannot approve one DRAFT twice', async () => {
    const draft = await draftFor('same-source');
    const first = startChild();
    const second = startChild();
    const [readyA, readyB] = await Promise.all([first.next('READY'), second.next('READY')]);
    expect(readyA.candidates).toContain(draft.approvalId);
    expect(readyB.candidates).toContain(draft.approvalId);
    const resultA = first.next('RESULT');
    const resultB = second.next('RESULT');
    first.child.send('GO');
    second.child.send('GO');
    const results = await Promise.all([resultA, resultB]);
    const after = await db.settlementApproval.findUniqueOrThrow({ where: { id: draft.approvalId },
      include: { lines: true, autoApprovalAttempts: true } });
    expect(after).toMatchObject({ status: 'APPROVED', approvedBy: 'system:settlement_auto_approval' });
    expect(after.lines).toHaveLength(1);
    expect(after.lines[0]?.financeLedgerEntryId).toBe(draft.saleId);
    expect(after.autoApprovalAttempts.filter((attempt) => attempt.outcome === 'APPROVED')).toHaveLength(1);
    expect(after.successfulAutoApprovalAttemptId).toBe(
      after.autoApprovalAttempts.find((attempt) => attempt.outcome === 'APPROVED')?.id);
    expect(await db.settlementRefundAdjustment.count({ where: { vendorId } })).toBe(0);
    expect(await db.payoutBatch.count({ where: { vendorId } })).toBe(0);
    const claimedSuccess = results.flatMap((message) => (message.result as Sweep).vendors)
      .flatMap((vendor) => vendor.outcomes).filter((outcome) => outcome.classification === 'VERIFIED_COMPLETED');
    expect(claimedSuccess.length).toBeLessThanOrEqual(1);
    expect(claimedSuccess.every((outcome) => outcome.attemptId === after.successfulAutoApprovalAttemptId)).toBe(true);
    const repeated = await sweep({ vendorIds: [vendorId] });
    expect(repeated.vendors).toEqual([]);
    expect(await db.settlementAutoApprovalAttempt.count({ where: { settlementApprovalId: draft.approvalId,
      outcome: 'APPROVED' } })).toBe(1);
  }, 60_000);

  it('F-03: loss of one ready backend does not corrupt the other backend’s approval', async () => {
    const draft = await draftFor('lost-instance');
    const failed = startChild();
    const healthy = startChild();
    expect((await failed.next('READY')).candidates).toContain(draft.approvalId);
    expect((await healthy.next('READY')).candidates).toContain(draft.approvalId);
    failed.child.kill();
    const result = healthy.next('RESULT');
    healthy.child.send('GO');
    expect((await result).result).toMatchObject({ vendors: [{ vendorId }] });
    const approval = await db.settlementApproval.findUniqueOrThrow({ where: { id: draft.approvalId } });
    expect(approval).toMatchObject({ status: 'APPROVED', approvedBy: 'system:settlement_auto_approval' });
    expect(await db.settlementAutoApprovalAttempt.count({ where: {
      settlementApprovalId: draft.approvalId, outcome: 'APPROVED' } })).toBe(1);
    expect(await db.payoutBatch.count({ where: { vendorId } })).toBe(0);
  }, 60_000);

  it('F-03: bounded duplicate scanning of three independent DRAFTs has one outcome per source', async () => {
    const drafts = [await draftFor('bounded-a'), await draftFor('bounded-b'), await draftFor('bounded-c')];
    const first = startChild();
    const second = startChild();
    const [readyA, readyB] = await Promise.all([first.next('READY'), second.next('READY')]);
    for (const draft of drafts) {
      expect(readyA.candidates).toContain(draft.approvalId);
      expect(readyB.candidates).toContain(draft.approvalId);
    }
    const resultA = first.next('RESULT');
    const resultB = second.next('RESULT');
    first.child.send('GO');
    second.child.send('GO');
    await Promise.all([resultA, resultB]);
    const approvals = await db.settlementApproval.findMany({
      where: { id: { in: drafts.map((draft) => draft.approvalId) } }, include: { autoApprovalAttempts: true },
    });
    expect(approvals).toHaveLength(3);
    for (const approval of approvals) {
      expect(approval).toMatchObject({ status: 'APPROVED', approvedBy: 'system:settlement_auto_approval' });
      expect(approval.autoApprovalAttempts.filter((attempt) => attempt.outcome === 'APPROVED')).toHaveLength(1);
      const successful = approval.autoApprovalAttempts.find((attempt) => attempt.outcome === 'APPROVED');
      expect(approval.successfulAutoApprovalAttemptId).toBe(successful?.id);
      const events = await db.settlementAutoApprovalAttemptEvent.findMany({
        where: { attemptId: successful!.id }, select: { outcome: true, reasonCode: true },
      });
      expect(events).toEqual(expect.arrayContaining([
        expect.objectContaining({ outcome: 'STARTED', reasonCode: 'ATTEMPT_CREATED' }),
        expect.objectContaining({ outcome: 'APPROVED', reasonCode: 'CANONICAL_APPROVAL_COMMITTED' }),
      ]));
      expect(events.every((event) => ['ATTEMPT_CREATED', 'SERIALIZABLE_TRANSACTION_ROLLED_BACK',
        'CANONICAL_APPROVAL_COMMITTED'].includes(event.reasonCode ?? ''))).toBe(true);
    }
    expect(await db.payoutBatch.count({ where: { vendorId } })).toBe(0);
  }, 60_000);

  it('F-04: unresolved UNKNOWN on independent A does not authorize or suppress B', async () => {
    const a = await draftFor('unknown-a');
    const b = await draftFor('independent-b');
    const attemptId = await persistUnknownAttempt(a.approvalId);
    const result = await sweep({ vendorIds: [vendorId] });
    expect(result.reconciliations).toEqual(expect.arrayContaining([
      expect.objectContaining({ attemptId, classification: 'UNKNOWN' })]));
    expect(result.reconciliationErrors).toEqual([]);
    expect(result.vendors[0]?.outcomes).toEqual(expect.arrayContaining([
      expect.objectContaining({ settlementApprovalId: a.approvalId, attemptId,
        classification: 'UNKNOWN' }),
      expect.objectContaining({ settlementApprovalId: b.approvalId,
        classification: 'VERIFIED_COMPLETED' })]));
    expect(await db.settlementApproval.findUniqueOrThrow({ where: { id: a.approvalId } }))
      .toMatchObject({ status: 'DRAFT', approvedBy: null });
    expect(await db.settlementApproval.findUniqueOrThrow({ where: { id: b.approvalId } }))
      .toMatchObject({ status: 'APPROVED', approvedBy: 'system:settlement_auto_approval' });
    expect(await db.settlementAutoApprovalAttempt.count({ where: { settlementApprovalId: a.approvalId } })).toBe(1);
    expect(await db.settlementAutoApprovalAttempt.count({ where: { settlementApprovalId: b.approvalId,
      outcome: 'APPROVED' } })).toBe(1);
    expect(await db.payoutBatch.count({ where: { vendorId } })).toBe(0);
    await sweep({ vendorIds: [vendorId] });
    expect(await db.settlementAutoApprovalAttempt.count({ where: { settlementApprovalId: a.approvalId } })).toBe(1);
    expect(await db.settlementAutoApprovalAttempt.count({ where: { settlementApprovalId: b.approvalId } })).toBe(1);
  }, 30_000);

  it('F-04: UNKNOWN on A cannot bypass an applicable integrity hold on independent B', async () => {
    const a = await draftFor('held-a');
    const b = await draftFor('held-b');
    const attemptId = await persistUnknownAttempt(a.approvalId);
    await db.financeIntegrityAlert.create({ data: {
      dedupeKey: `${b.allocationId}-integrity`, severity: 'warning',
      category: 'multiple_active_sale_ledgers', vendorAllocationId: b.allocationId,
      reason: 'Synthetic F-04 source hold', status: 'open',
    } });
    const result = await sweep({ vendorIds: [vendorId] });
    expect(result.reconciliations).toEqual(expect.arrayContaining([
      expect.objectContaining({ attemptId, classification: 'UNKNOWN' })]));
    expect(result.vendors[0]?.outcomes).toEqual(expect.arrayContaining([
      expect.objectContaining({ settlementApprovalId: b.approvalId, classification: 'BLOCKED',
        reasonCode: expect.stringContaining('finance_integrity_alert_open') })]));
    expect((await db.settlementApproval.findUniqueOrThrow({ where: { id: b.approvalId } })).status).toBe('DRAFT');
    expect(await db.settlementAutoApprovalAttempt.count({ where: { settlementApprovalId: a.approvalId } })).toBe(1);
    expect(await db.payoutBatch.count({ where: { vendorId } })).toBe(0);
  });

  it('F-04: a thrown reconciliation error stops the vendor sweep without retrying A or approving B', async () => {
    const a = await draftFor('reconcile-error-a');
    const b = await draftFor('reconcile-error-b');
    const attemptId = await persistUnknownAttempt(a.approvalId);
    const { prisma } = await import('../backend/src/db/prisma.js');
    const originalFindUnique = prisma.settlementAutoApprovalAttempt.findUnique.bind(
      prisma.settlementAutoApprovalAttempt);
    const failure = vi.spyOn(prisma.settlementAutoApprovalAttempt, 'findUnique')
      .mockImplementation((args: Parameters<typeof originalFindUnique>[0]) => {
        if (args.where.id === attemptId) throw new Error('Injected reconciliation read failure');
        return originalFindUnique(args);
      });
    let result: Sweep;
    try {
      result = await sweep({ vendorIds: [vendorId] });
    } finally {
      failure.mockRestore();
    }
    expect(result.reconciliations).toEqual([]);
    expect(result.reconciliationErrors).toEqual([{ vendorId,
      settlementApprovalId: a.approvalId, attemptId, errorType: 'Error' }]);
    expect(result.skippedVendors).toEqual([vendorId]);
    expect(result.vendors).toEqual([]);
    expect((await db.settlementApproval.findUniqueOrThrow({ where: { id: a.approvalId } })).status).toBe('DRAFT');
    expect((await db.settlementApproval.findUniqueOrThrow({ where: { id: b.approvalId } })).status).toBe('DRAFT');
    expect(await db.settlementAutoApprovalAttempt.count({ where: { settlementApprovalId: a.approvalId } })).toBe(1);
    expect(await db.settlementAutoApprovalAttempt.count({ where: { settlementApprovalId: b.approvalId } })).toBe(0);
    expect(await db.payoutBatch.count({ where: { vendorId } })).toBe(0);

    const recovered = await sweep({ vendorIds: [vendorId] });
    expect(recovered.reconciliationErrors).toEqual([]);
    expect(recovered.vendors[0]?.outcomes).toEqual(expect.arrayContaining([
      expect.objectContaining({ settlementApprovalId: a.approvalId, classification: 'UNKNOWN' }),
      expect.objectContaining({ settlementApprovalId: b.approvalId, classification: 'VERIFIED_COMPLETED' }),
    ]));
    expect((await db.settlementApproval.findUniqueOrThrow({ where: { id: a.approvalId } })).status).toBe('DRAFT');
    expect((await db.settlementApproval.findUniqueOrThrow({ where: { id: b.approvalId } })).status).toBe('APPROVED');
    expect(await db.settlementAutoApprovalAttempt.count({ where: { settlementApprovalId: a.approvalId } })).toBe(1);
    expect(await db.settlementAutoApprovalAttempt.count({ where: { settlementApprovalId: b.approvalId,
      outcome: 'APPROVED' } })).toBe(1);
  });

  it('F-04: a second DRAFT cannot legitimately claim A’s active SALE line', async () => {
    const a = await draftFor('overlap-a');
    await expect(createDraft({ vendorId, candidateScope: 'selected_allocations',
      selectedAllocationIds: [a.allocationId] })).rejects.toThrow();
    expect(await db.settlementApprovalLine.count({ where: { financeLedgerEntryId: a.saleId,
      settlementApproval: { status: 'DRAFT' } } })).toBe(1);
    expect(await db.settlementAutoApprovalAttempt.count({ where: { settlementApprovalId: a.approvalId } })).toBe(0);
  });
});
