import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { PrismaClient } from '../backend/node_modules/@prisma/client/index.js';

const url = process.env.TEST_DATABASE_URL?.trim();
const databaseName = 'fin_paid_cancel_005b_validation';
const suite = url || process.env.FIN_PAID_CANCEL_005B_TEST_DATABASE_ISOLATED === '1' ? describe : describe.skip;
const expectedDirectory = process.env.FIN_PAID_CANCEL_005B_PG_DATA_DIRECTORY;
const expectedSystemId = process.env.FIN_PAID_CANCEL_005B_PG_SYSTEM_ID;

suite('FIN-PAID-CANCEL-005B isolated PostgreSQL cancellation authority', () => {
  let db: PrismaClient;
  let maintenance: PrismaClient;
  let assess: typeof import('../backend/src/modules/finance/settlement-approval.service.js')['assessSettlementCancellationEligibility'];
  let cancel: typeof import('../backend/src/modules/finance/settlement-approval.service.js')['cancelSettlementApproval'];
  let markReview: typeof import('../backend/src/modules/finance/finance.service.js')['markPayoutBatchReview'];
  let markPaid: typeof import('../backend/src/modules/finance/finance.service.js')['markPayoutBatchPaid'];
  let recordDelivery: typeof import('../backend/src/modules/shipping/allocation-delivered-observation.service.js')['recordVerifiedDeliveredObservation'];
  let app: Awaited<ReturnType<typeof import('../backend/src/app.js')['createApp']>>;
  let adminToken: string;
  let vendorToken: string;
  let sequence = 0;
  const prefix = `fin-paid-cancel-005b-${process.pid}-${Date.now()}`;

  beforeAll(async () => {
    if (!url) throw new Error('005B requires TEST_DATABASE_URL when isolated test mode is enabled.');
    const target = new URL(url!);
    if (process.env.FIN_PAID_CANCEL_005B_TEST_DATABASE_ISOLATED !== '1' ||
        target.protocol !== 'postgresql:' || target.hostname !== '127.0.0.1' ||
        !target.port || target.username !== 'onur' || target.password ||
        target.pathname !== `/${databaseName}` || target.search !== '?schema=public' ||
        !expectedDirectory?.startsWith('/private/tmp/fin-paid-cancel-005b-pg18.') ||
        !/^\d{15,25}$/.test(expectedSystemId ?? '')) {
      throw new Error('005B refuses an unverified disposable local PostgreSQL target.');
    }
    const serverPid = Number(readFileSync(`${expectedDirectory}/postmaster.pid`, 'utf8').split('\n')[0]);
    const processCommand = execFileSync('ps', ['-p', String(serverPid), '-o', 'command='], { encoding: 'utf8' }).trim();
    const listenerPids = execFileSync('lsof', ['-nP', '-t', `-iTCP:${target.port}`, '-sTCP:LISTEN'],
      { encoding: 'utf8' }).trim().split('\n');
    if (!Number.isInteger(serverPid) || !processCommand.includes('postgres -D ' + expectedDirectory) ||
        !processCommand.includes(`-p ${target.port}`) || !processCommand.includes('-h 127.0.0.1') ||
        !listenerPids.includes(String(serverPid))) {
      throw new Error('005B refuses a localhost target without a matching local PostgreSQL server process.');
    }
    const maintenanceUrl = new URL(url!);
    maintenanceUrl.pathname = '/postgres';
    maintenance = new PrismaClient({ datasources: { db: { url: maintenanceUrl.toString() } } });
    db = new PrismaClient({ datasources: { db: { url } } });
    await maintenance.$connect();
    await db.$connect();
    const identitySql = `SELECT current_database() AS database, current_user AS username,
      host(inet_server_addr()) AS address, inet_server_port() AS port,
      current_setting('data_directory') AS directory,
      current_setting('server_version_num') AS version,
      (pg_control_system()).system_identifier AS "systemId"`;
    const [local] = await db.$queryRawUnsafe<Array<{ database: string; username: string; address: string;
      port: number; directory: string; version: string; systemId: bigint }>>(identitySql);
    const [independent] = await maintenance.$queryRawUnsafe<Array<typeof local>>(identitySql);
    expect({ ...local, systemId: String(local.systemId) }).toEqual({
      database: databaseName, username: 'onur', address: '127.0.0.1',
      port: Number(target.port), directory: expectedDirectory,
      version: '180003', systemId: expectedSystemId,
    });
    expect({ ...independent, systemId: String(independent.systemId) }).toEqual({
      ...local, database: 'postgres', systemId: String(local.systemId),
    });
    expect(await db.vendor.count({ where: { id: { not: { startsWith: 'fin-paid-cancel-005b-' } } } })).toBe(0);
    expect(await db.settlementApproval.count({ where: { id: { not: { startsWith: 'fin-paid-cancel-005b-' } } } })).toBe(0);
    expect(await db.payoutBatch.count({ where: { id: { not: { startsWith: 'fin-paid-cancel-005b-' } } } })).toBe(0);
    process.env.DATABASE_URL = url;
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'fin-paid-cancel-005b-disposable-test-jwt-secret';
    process.env.SETTLEMENT_AUTO_DRAFT_JOB_ENABLED = 'false';
    process.env.SETTLEMENT_AUTO_DRAFT_SCHEDULER_ENABLED = 'false';
    process.env.SETTLEMENT_AUTO_DRAFT_WRITE_SCHEDULER_ENABLED = 'false';
    process.env.SETTLEMENT_AUTO_APPROVAL_SCHEDULER_ENABLED = 'false';
    process.env.SHOPIFY_ORDERS_CREATE_EXECUTOR_ENABLED = 'false';
    process.env.CUSTOMER_CANCELLATION_AUTO_REFUND_ENABLED = 'false';
    process.env.SCHEDULED_RECONCILIATION_ENABLED = 'false';
    process.env.CANONICAL_RECONCILIATION_ENABLED = 'false';
    process.env.SOPYO_DELIVERY_POLLING_ENABLED = 'false';
    process.env.SOPYO_ORDER_PUSH_WORKER_ENABLED = 'false';
    process.env.SHIPPING_EXECUTION_ENABLED = 'false';
    process.env.KARGONOMI_BASE_URL = 'http://127.0.0.1:1';
    process.env.KARGONOMI_API_TOKEN = 'disposable-005b-only';
    ({ assessSettlementCancellationEligibility: assess, cancelSettlementApproval: cancel } =
      await import('../backend/src/modules/finance/settlement-approval.service.js'));
    ({ markPayoutBatchReview: markReview, markPayoutBatchPaid: markPaid } =
      await import('../backend/src/modules/finance/finance.service.js'));
    ({ recordVerifiedDeliveredObservation: recordDelivery } =
      await import('../backend/src/modules/shipping/allocation-delivered-observation.service.js'));
    const { hashPasswordArgon2id } = await import('../backend/src/modules/auth/password-hashing.js');
    const password = 'fin-paid-cancel-005b-only-password';
    const passwordHash = await hashPasswordArgon2id(password);
    const identities = { admin: `${prefix}-admin`, vendor: `${prefix}-vendor-user` };
    await db.user.createMany({ data: [
      { id: identities.admin, email: `${identities.admin}@example.test`, name: '005B Admin', role: 'ADMIN', passwordHash },
      { id: identities.vendor, email: `${identities.vendor}@example.test`, name: '005B Vendor', role: 'VENDOR', passwordHash },
    ] });
    const { createApp } = await import('../backend/src/app.js');
    app = createApp();
    await app.ready();
    async function login(email: string) {
      const response = await app.inject({ method: 'POST', url: '/auth/login',
        payload: { email, password } });
      expect(response.statusCode).toBe(200);
      const cookie = response.headers['set-cookie'];
      expect(cookie).toBeTruthy();
      const { createAuthService } = await import('../backend/src/modules/auth/auth.service.js');
      const { loadEnv } = await import('../backend/src/config/env.js');
      const result = await createAuthService(loadEnv()).login({ email, password });
      expect(result?.token).toBeTruthy();
      return result!.token;
    }
    adminToken = await login(`${identities.admin}@example.test`);
    vendorToken = await login(`${identities.vendor}@example.test`);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await db?.$disconnect();
    await maintenance?.$disconnect();
    const { prisma } = await import('../backend/src/db/prisma.js');
    await prisma.$disconnect();
  });

  async function seed(status: 'DRAFT' | 'APPROVED' | 'CANCELLED' = 'APPROVED') {
    const id = `${prefix}-${++sequence}`;
    const vendorId = `${id}-vendor`;
    const approvalId = `${id}-approval`;
    await db.vendor.create({ data: { id: vendorId, name: 'Disposable 005B vendor' } });
    await db.shopifyOrder.create({ data: { id: `${id}-order`, sourceShopifyOrderId: `gid://shopify/Order/${id}`,
      sourceShopifyOrderNumber: `#${id}` } });
    await db.vendorAllocation.create({ data: { id: `${id}-allocation`, sourceShopifyOrderId: `${id}-order`,
      sourceShopifyOrderNumber: `#${id}`, originalVendorId: vendorId, assignedVendorId: vendorId,
      outboundMethodSnapshot: 'KARGONOMI', fulfillmentStatus: 'Fulfilled', shippingStatus: 'Delivered' } });
    await db.shipmentExecution.create({ data: { id: `${id}-shipment-execution`, allocationId: `${id}-allocation`,
      vendorId, provider: 'KARGONOMI', providerShipmentId: `${id}-shipment`,
      shipmentStatus: 'DELIVERED', requestSnapshot: {} } });
    const delivery = await recordDelivery({ allocationId: `${id}-allocation`,
      source: { method: 'KARGONOMI', shipmentExecutionId: `${id}-shipment-execution`,
        sourceReference: `${id}-shipment` } }, db as never);
    await db.fulfillment.create({ data: { id: `${id}-fulfillment`, vendorAllocationId: `${id}-allocation`,
      fulfillmentStatus: 'Fulfilled', fulfilledAt: new Date('2026-08-01T00:00:00Z'),
      shipmentUpdatedAt: new Date('2026-08-01T00:00:00Z') } });
    await db.financeLedgerEntry.create({ data: { id: `${id}-ledger`, vendorAllocationId: `${id}-allocation`,
      vendorId, entryType: 'sale', amount: '100.00', payoutStatus: 'APPROVED', settlementStatus: 'PAYABLE',
      settlementEligibleAt: delivery.firstObservedDeliveredAt,
      commissionPercentSnapshot: '0.00', commissionVatPercentSnapshot: '0.00', settlementDelayDaysSnapshot: 0 } });
    await db.settlementApproval.create({ data: { id: approvalId, vendorId, status, currency: 'TRY',
      grossSalesMinor: 10000, refundTotalMinor: 0, commissionMinor: 0, commissionVatMinor: 0,
      netPayableMinor: 10000, sourceSnapshotJson: {},
      ...(status === 'APPROVED' ? { approvedAt: new Date(), approvedBy: `${id}-admin` } : {}),
      lines: { create: { id: `${id}-approval-line`, financeLedgerEntryId: `${id}-ledger`,
        lineType: 'SALE', amountMinor: 10000, commissionMinor: 0, commissionVatMinor: 0,
        payableImpactMinor: 10000, sourceSnapshotJson: {} } } } });
    return { id, vendorId, approvalId, actor: `${id}-admin` };
  }

  async function addPayout(fixture: Awaited<ReturnType<typeof seed>>, status: 'DRAFT' | 'REVIEW' |
    'PAID' | 'PAID_PLACEHOLDER' | 'CASHLESS_COMPLETED', direct = true, paidAt: Date | null = null) {
    const { id, vendorId } = fixture;
    await db.payoutBatch.create({ data: { id: `${id}-batch`, vendorId, status, currency: 'TRY',
      grossAmount: '100.00', netAmount: status === 'CASHLESS_COMPLETED' ? '0.00' : '100.00',
      r1OffsetTotalMinor: status === 'CASHLESS_COMPLETED' ? 10000 : 0, paidAt,
      lines: { create: { id: `${id}-batch-line`, financeLedgerEntryId: `${id}-ledger`,
        settlementApprovalLineId: direct ? `${id}-approval-line` : null, amountSnapshot: '100.00' } } } });
  }

  async function seedCorrection(fixture: Awaited<ReturnType<typeof seed>>, kind: 'credit' | 'deduction',
    approvedOrigin = false) {
    const { id, vendorId } = fixture;
    const sourceId = `${id}-correction-${kind}`;
    const sourceShopifyOrderId = `${sourceId}-order`;
    const sourceShopifyRefundId = `${sourceId}-refund`;
    const vendorAllocationId = `${sourceId}-allocation`;
    const common = { sourceShopifyOrderId, sourceShopifyRefundId, vendorAllocationId };
    await db.shopifyOrder.create({ data: { id: sourceShopifyOrderId, sourceShopifyOrderId,
      sourceShopifyOrderNumber: `#${sourceId}` } });
    await db.vendorAllocation.create({ data: { id: vendorAllocationId,
      sourceShopifyOrderId, sourceShopifyOrderNumber: `#${sourceId}`,
      originalVendorId: vendorId, assignedVendorId: vendorId } });
    await db.financeLedgerEntry.createMany({ data: ['sale', 'refund'].map((entryType) => ({
      id: `${sourceId}-${entryType}-ledger`, vendorId, vendorAllocationId, entryType, amount: '1.00',
    })) });
    await db.refundRecord.create({ data: { id: `${sourceId}-record`, ...common,
      sourceShopifyOrderNumber: `#${sourceId}`, status: 'COMPLETED', amount: '1.00' } });
    const evidence = { ...common, historicalSaleFinanceLedgerEntryId: `${sourceId}-sale-ledger`,
      currency: 'TRY', refundTotalAmount: '1.00', evidenceHash: `${sourceId}-accepted`,
      hashAlgorithm: 'SHA-256', evidenceVersion: 1, normalizationVersion: 1 };
    await db.refundEvidenceSnapshot.create({ data: { id: `${sourceId}-snapshot`, ...evidence,
      refundRecordId: `${sourceId}-record`, refundFinanceLedgerEntryId: `${sourceId}-refund-ledger`,
      historicalEconomicVendorId: vendorId, monetaryClassification: 'MONETARY_REFUND',
      normalizedTransactionsJson: [], normalizedRefundLinesJson: [], normalizedOwnershipJson: {},
      normalizedEvidenceJson: {}, supersededSaleLedgerIdsJson: [], evidenceSource: '005b-disposable-fixture',
      capturedAt: new Date('2025-01-01T00:00:00Z') } });
    await db.refundTerminalEvidenceReview.create({ data: { id: `${sourceId}-review`, ...common,
      terminalRefundFinanceLedgerEntryId: `${sourceId}-refund-ledger`, refundRecordId: `${sourceId}-record`,
      economicVendorId: vendorId, storedEvidenceSnapshotId: `${sourceId}-snapshot`, dedupeKey: sourceId,
      conflictCategory: 'AMOUNT_MISMATCH', conflictSummaryJson: {}, status: 'RESOLVED',
      resolutionOutcome: 'CORRECTION_REQUIRED' } });
    await db.refundTerminalConflictEvidence.create({ data: { id: `${sourceId}-incoming`, ...evidence,
      evidenceHash: `${sourceId}-incoming`, reviewId: `${sourceId}-review`, economicVendorId: vendorId,
      supersededSaleLedgerIdsJson: [], normalizedEvidenceJson: {} } });
    await db.refundTerminalEvidenceReviewEvent.create({ data: { id: `${sourceId}-event`,
      reviewId: `${sourceId}-review`, eventType: 'RESOLVED', actorUserId: `${prefix}-admin`,
      resolutionOutcome: 'CORRECTION_REQUIRED' } });
    const delta = kind === 'credit' ? -100 : 100;
    await db.financialCorrectionAuthority.create({ data: { id: `${sourceId}-authority`, ...common,
      vendorId, reviewId: `${sourceId}-review`, resolvedReviewEventId: `${sourceId}-event`,
      acceptedEvidenceSnapshotId: `${sourceId}-snapshot`, incomingConflictEvidenceId: `${sourceId}-incoming`,
      historicalSaleFinanceLedgerEntryId: `${sourceId}-sale-ledger`,
      acceptedRefundFinanceLedgerEntryId: `${sourceId}-refund-ledger`,
      acceptedEvidenceHash: evidence.evidenceHash, incomingEvidenceHash: `${sourceId}-incoming`,
      acceptedEvidenceVersion: 1, acceptedNormalizationVersion: 1,
      incomingEvidenceVersion: 1, incomingNormalizationVersion: 1,
      commissionPercent: '0', commissionVatPercent: '0', currency: 'TRY',
      acceptedRefundAmountMinor: 200, acceptedCommissionReversalMinor: 0,
      acceptedCommissionVatReversalMinor: 0, acceptedVendorPayableReversalMinor: 200,
      correctedRefundAmountMinor: 200 + delta, correctedCommissionReversalMinor: 0,
      correctedCommissionVatReversalMinor: 0, correctedVendorPayableReversalMinor: 200 + delta,
      refundDifferenceMinor: delta, commissionDifferenceMinor: 0, commissionVatDifferenceMinor: 0,
      vendorPayableDifferenceMinor: delta, economicDirection: kind === 'credit' ? 'VENDOR_CREDIT' : 'VENDOR_DEDUCTION',
      previewFingerprint: sourceId,
      applicationRoute: approvedOrigin ? 'APPROVED_SETTLEMENT_VENDOR_DEDUCTION' :
        kind === 'credit' ? 'BEFORE_SETTLEMENT_VENDOR_CREDIT' : 'BEFORE_SETTLEMENT_VENDOR_DEDUCTION',
      ...(approvedOrigin ? { historicalApprovedSettlementId: fixture.approvalId,
        historicalApprovedSettlementAt: new Date(), historicalApprovedSettlementNetMinor: 10000 } : {}),
      authorizedByUserId: `${prefix}-admin`, reason: 'Disposable 005B relational fixture' } });
    if (kind === 'credit') {
      await db.financialCorrectionCredit.create({ data: { id: `${sourceId}-source`,
        authorityId: `${sourceId}-authority`, vendorId, amountMinor: 100 } });
    } else {
      await db.financialCorrectionDeduction.create({ data: { id: `${sourceId}-source`,
        authorityId: `${sourceId}-authority`, vendorId, amountMinor: 100 } });
    }
    return sourceId;
  }

  async function financialSnapshot() {
    const tables = ['SettlementApproval', 'SettlementApprovalLine', 'PayoutBatch', 'PayoutBatchLine',
      'FinanceLedgerEntry', 'SettlementCommissionInvoice', 'FinancialCorrectionApprovedDeductionCoverage',
      'FinancialCorrectionAuthority', 'FinancialCorrectionCredit', 'FinancialCorrectionDeduction',
      'FinancialCorrectionCreditSettlementLine', 'FinancialCorrectionCreditPayoutLine',
      'FinancialCorrectionDeductionSettlementLine', 'FinancialCorrectionDeductionPayoutLine',
      'SettlementRefundAdjustment', 'SettlementRefundAdjustmentApplication', 'FinanceEvent',
      'VendorBalanceEvent', 'RefundRecord', 'RefundEvidenceSnapshot',
      'RefundTerminalEvidenceReview', 'RefundTerminalEvidenceReviewEvent'] as const;
    const entries = await Promise.all(tables.map(async (table) => [table,
      await db.$queryRawUnsafe<Array<{ row: unknown }>>(
        `SELECT row_to_json(t) AS row FROM "${table}" t ORDER BY t."id"`),
    ] as const));
    return Object.fromEntries(entries);
  }

  async function http(method: 'GET' | 'POST', approvalId: string, vendorId?: string,
    token?: string, requestId = '005b-safe-request') {
    const query = vendorId === undefined ? '' : `?vendorId=${encodeURIComponent(vendorId)}`;
    const response = await app.inject({ method,
      url: `/admin/finance/settlement-approvals/${encodeURIComponent(approvalId)}/${method === 'GET' ? 'cancellation-eligibility' : 'cancel'}${method === 'GET' ? query : ''}`,
      headers: { 'x-request-id': requestId, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    });
    return { status: response.statusCode, body: response.json() as Record<string, unknown>,
      requestId: response.headers['x-request-id'] };
  }

  it.each([
    ['DRAFT', 'eligible', null], ['APPROVED', 'eligible', null],
    ['CANCELLED', 'blocked', 'ALREADY_CANCELLED'],
  ] as const)('%s settlement assessment is read-only and %s', async (status, state, reason) => {
    const fixture = await seed(status);
    const before = await financialSnapshot();
    expect(await assess(fixture.approvalId, fixture.vendorId)).toMatchObject({
      ok: true, writesPerformed: false, settlementApprovalId: fixture.approvalId,
      vendorId: fixture.vendorId, state, reason,
    });
    expect(await financialSnapshot()).toEqual(before);
  });

  it.each([
    ['PAID', null, 'blocked', 'PAID_PAYOUT'],
    ['REVIEW', new Date('2026-01-01T00:00:00Z'), 'blocked', 'PAID_PAYOUT'],
    ['CASHLESS_COMPLETED', null, 'blocked', 'CASHLESS_COMPLETED'],
    ['REVIEW', null, 'eligible', null],
    ['DRAFT', null, 'eligible', null],
    ['PAID_PLACEHOLDER', null, 'eligible', null],
  ] as const)('%s payout with paidAt=%s assesses %s without writes', async (status, paidAt, state, reason) => {
    const fixture = await seed();
    await addPayout(fixture, status, true, paidAt);
    const before = await financialSnapshot();
    expect(await assess(fixture.approvalId, fixture.vendorId)).toMatchObject({ state, reason });
    expect(await financialSnapshot()).toEqual(before);
    if (state === 'blocked') {
      await expect(cancel(fixture.approvalId, fixture.actor)).rejects.toThrow();
      expect(await financialSnapshot()).toEqual(before);
    }
  });

  it('the first authoritative blocker wins and multiple payouts cannot hide PAID', async () => {
    const fixture = await seed();
    await addPayout(fixture, 'REVIEW');
    await db.payoutBatch.create({ data: { id: `${fixture.id}-second-batch`, vendorId: fixture.vendorId,
      status: 'PAID', grossAmount: '100.00', netAmount: '100.00', currency: 'TRY',
      lines: { create: { financeLedgerEntryId: `${fixture.id}-ledger`,
        settlementApprovalLineId: `${fixture.id}-approval-line`, amountSnapshot: '100.00' } } } });
    const before = await financialSnapshot();
    expect(await assess(fixture.approvalId, fixture.vendorId)).toMatchObject({ state: 'blocked', reason: 'PAID_PAYOUT' });
    expect(await financialSnapshot()).toEqual(before);
    await db.settlementCommissionInvoice.create({ data: { settlementApprovalId: fixture.approvalId,
      vendorId: fixture.vendorId, provider: 'LOGO_ISBASI', status: 'PENDING' } });
    const withInvoice = await financialSnapshot();
    expect(await assess(fixture.approvalId, fixture.vendorId)).toMatchObject({
      state: 'blocked', reason: 'ACTIVE_COMMISSION_INVOICE',
    });
    expect(await financialSnapshot()).toEqual(withInvoice);
    await expect(cancel(fixture.approvalId, fixture.actor)).rejects.toThrow('active commission invoice');
    expect(await financialSnapshot()).toEqual(withInvoice);
  });

  it('unique legacy NULL-linked PAID lineage blocks without writes', async () => {
    const fixture = await seed();
    await addPayout(fixture, 'PAID', false);
    const before = await financialSnapshot();
    expect(await assess(fixture.approvalId, fixture.vendorId)).toMatchObject({ state: 'blocked', reason: 'PAID_PAYOUT' });
    expect(await financialSnapshot()).toEqual(before);
    await expect(cancel(fixture.approvalId, fixture.actor)).rejects.toThrow('paid payout batch');
    expect(await financialSnapshot()).toEqual(before);
  });

  it('ambiguous legacy NULL-linked PAID lineage remains unknown and the writer rejects', async () => {
    const fixture = await seed();
    await addPayout(fixture, 'PAID', false);
    await db.settlementApproval.create({ data: { id: `${fixture.id}-competing-approval`,
      vendorId: fixture.vendorId, status: 'CANCELLED', grossSalesMinor: 10000,
      refundTotalMinor: 0, commissionMinor: 0, commissionVatMinor: 0, netPayableMinor: 10000,
      sourceSnapshotJson: {}, lines: { create: { financeLedgerEntryId: `${fixture.id}-ledger`,
        lineType: 'SALE', amountMinor: 10000, commissionMinor: 0, commissionVatMinor: 0,
        payableImpactMinor: 10000, sourceSnapshotJson: {} } } } });
    const before = await financialSnapshot();
    expect(await assess(fixture.approvalId, fixture.vendorId)).toMatchObject({
      state: 'unknown', reason: 'LEGACY_LINEAGE_AMBIGUOUS',
    });
    expect(await financialSnapshot()).toEqual(before);
    await expect(cancel(fixture.approvalId, fixture.actor)).rejects.toThrow('lineage is ambiguous');
    expect(await financialSnapshot()).toEqual(before);
  });

  it('contradictory historical amount is unknown and cannot cancel', async () => {
    const fixture = await seed();
    await addPayout(fixture, 'PAID', false);
    await db.payoutBatchLine.update({ where: { id: `${fixture.id}-batch-line` },
      data: { amountSnapshot: '99.00' } });
    const before = await financialSnapshot();
    expect(await assess(fixture.approvalId, fixture.vendorId)).toMatchObject({
      state: 'unknown', reason: 'LEGACY_LINEAGE_INCONSISTENT',
    });
    expect(await financialSnapshot()).toEqual(before);
    await expect(cancel(fixture.approvalId, fixture.actor)).rejects.toThrow('lineage is inconsistent');
    expect(await financialSnapshot()).toEqual(before);
  });

  it('wrong Vendor and absent settlement reveal no financial identity', async () => {
    const fixture = await seed();
    const before = await financialSnapshot();
    expect(await assess(fixture.approvalId, `${fixture.id}-other-vendor`)).toBeNull();
    expect(await assess(`${fixture.id}-missing`, fixture.vendorId)).toBeNull();
    expect(await financialSnapshot()).toEqual(before);
  });

  it('authenticated HTTP enforces Admin role, Vendor identity and safe diagnostics', async () => {
    const fixture = await seed();
    const before = await financialSnapshot();
    const pathId = fixture.approvalId;
    expect((await http('GET', pathId, fixture.vendorId)).status).toBe(401);
    expect((await http('GET', pathId, fixture.vendorId, vendorToken)).status).toBe(403);
    expect((await http('GET', pathId, undefined, adminToken)).status).toBe(400);
    expect((await http('GET', pathId, '', adminToken)).status).toBe(400);
    const wrongVendor = await http('GET', pathId, `${fixture.id}-other-vendor`, adminToken);
    expect(wrongVendor).toMatchObject({ status: 404, body: { message: 'Settlement approval not found.' } });
    expect(JSON.stringify(wrongVendor.body)).not.toContain(fixture.vendorId);
    expect((await http('GET', `${fixture.id}-missing`, fixture.vendorId, adminToken)).status).toBe(404);
    const good = await http('GET', pathId, fixture.vendorId, adminToken, '005b-correlation');
    expect(good).toMatchObject({ status: 200, requestId: '005b-correlation',
      body: { ok: true, writesPerformed: false, settlementApprovalId: pathId,
        vendorId: fixture.vendorId, state: 'eligible', reason: null } });
    expect(await financialSnapshot()).toEqual(before);
  });

  it('authenticated HTTP reports PAID and rejects Cancel POST without financial mutation', async () => {
    const fixture = await seed();
    await addPayout(fixture, 'PAID');
    const before = await financialSnapshot();
    expect(await http('GET', fixture.approvalId, fixture.vendorId, adminToken)).toMatchObject({
      status: 200, body: { state: 'blocked', reason: 'PAID_PAYOUT' },
    });
    expect(await financialSnapshot()).toEqual(before);
    const rejected = await http('POST', fixture.approvalId, undefined, adminToken);
    expect(rejected).toMatchObject({ status: 400,
      body: { message: expect.stringContaining('paid payout batch') } });
    expect(await financialSnapshot()).toEqual(before);
  });

  it('authenticated HTTP preserves legacy unknown and historical PAID rejection', async () => {
    const fixture = await seed();
    await addPayout(fixture, 'PAID', false);
    const before = await financialSnapshot();
    expect(await http('GET', fixture.approvalId, fixture.vendorId, adminToken)).toMatchObject({
      status: 200, body: { state: 'blocked', reason: 'PAID_PAYOUT' },
    });
    expect(await http('POST', fixture.approvalId, undefined, adminToken)).toMatchObject({
      status: 400, body: { message: expect.stringContaining('paid payout batch') },
    });
    expect(await financialSnapshot()).toEqual(before);
    await db.payoutBatchLine.update({ where: { id: `${fixture.id}-batch-line` },
      data: { amountSnapshot: '99.00' } });
    const inconsistent = await financialSnapshot();
    expect(await http('GET', fixture.approvalId, fixture.vendorId, adminToken)).toMatchObject({
      status: 200, body: { state: 'unknown', reason: 'LEGACY_LINEAGE_INCONSISTENT' },
    });
    expect(await financialSnapshot()).toEqual(inconsistent);
  });

  it('authenticated HTTP masks a service failure without leaking SQL or changing finance', async () => {
    const fixture = await seed();
    const before = await financialSnapshot();
    const { prisma } = await import('../backend/src/db/prisma.js');
    const failure = vi.spyOn(prisma, '$transaction').mockRejectedValueOnce(new Error('synthetic SQL detail secret'));
    try {
      const response = await http('GET', fixture.approvalId, fixture.vendorId, adminToken, '005b-service-failure');
      expect(response).toMatchObject({ status: 503, requestId: '005b-service-failure',
        body: { message: 'Settlement cancellation eligibility could not be verified.' } });
      expect(JSON.stringify(response.body)).not.toContain('synthetic SQL detail secret');
    } finally {
      failure.mockRestore();
    }
    expect(await financialSnapshot()).toEqual(before);
  });

  it('an unchanged eligible settlement can be cancelled by the existing writer', async () => {
    const fixture = await seed('DRAFT');
    expect(await assess(fixture.approvalId, fixture.vendorId)).toMatchObject({ state: 'eligible', reason: null });
    expect((await cancel(fixture.approvalId, fixture.actor)).status).toBe('cancelled');
    expect((await db.settlementApproval.findUniqueOrThrow({ where: { id: fixture.approvalId } })).status)
      .toBe('CANCELLED');
  });

  it('assessment is stale after Mark Paid and the writer rechecks current payment evidence', async () => {
    const fixture = await seed();
    await addPayout(fixture, 'DRAFT');
    expect(await assess(fixture.approvalId, fixture.vendorId)).toMatchObject({ state: 'eligible' });
    expect((await markReview(`${fixture.id}-batch`)).status).toBe('review');
    expect((await markPaid(`${fixture.id}-batch`, { paidAt: new Date().toISOString() }, fixture.actor)).status)
      .toBe('paid');
    const before = await financialSnapshot();
    expect(await assess(fixture.approvalId, fixture.vendorId)).toMatchObject({ state: 'blocked', reason: 'PAID_PAYOUT' });
    await expect(cancel(fixture.approvalId, fixture.actor)).rejects.toThrow('paid payout batch');
    expect(await financialSnapshot()).toEqual(before);
  });

  it('active approved deduction coverage blocks and takes first precedence', async () => {
    const fixture = await seed();
    const sourceId = await seedCorrection(fixture, 'deduction', true);
    await db.financialCorrectionApprovedDeductionCoverage.create({ data: {
      id: `${sourceId}-coverage`, deductionId: `${sourceId}-source`,
      settlementApprovalId: fixture.approvalId, vendorId: fixture.vendorId,
      amountMinor: 100, currency: 'TRY', status: 'ACTIVE',
    } });
    await db.settlementCommissionInvoice.create({ data: { settlementApprovalId: fixture.approvalId,
      vendorId: fixture.vendorId, provider: 'LOGO_ISBASI', status: 'PENDING' } });
    const before = await financialSnapshot();
    expect(await assess(fixture.approvalId, fixture.vendorId)).toMatchObject({
      state: 'blocked', reason: 'ACTIVE_DEDUCTION_COVERAGE',
    });
    expect(await financialSnapshot()).toEqual(before);
    await expect(cancel(fixture.approvalId, fixture.actor)).rejects.toThrow('ORIGIN_SETTLEMENT_CANCELLATION_BLOCKED');
    expect(await financialSnapshot()).toEqual(before);
  });

  it.each([
    ['credit', 'ACTIVE_CORRECTION_CREDIT_PAYOUT'],
    ['deduction', 'ACTIVE_CORRECTION_DEDUCTION_PAYOUT'],
  ] as const)('active %s correction payout blocks cancellation', async (kind, reason) => {
    const fixture = await seed();
    const sourceId = await seedCorrection(fixture, kind);
    await db.payoutBatch.create({ data: { id: `${sourceId}-payout`, vendorId: fixture.vendorId,
      status: 'DRAFT', grossAmount: '1.00', netAmount: '1.00', currency: 'TRY' } });
    if (kind === 'credit') {
      const line = await db.financialCorrectionCreditSettlementLine.create({ data: {
        creditId: `${sourceId}-source`, settlementApprovalId: fixture.approvalId,
        amountMinor: 100, status: 'ACTIVE',
      } });
      await db.financialCorrectionCreditPayoutLine.create({ data: {
        settlementCreditLineId: line.id, payoutBatchId: `${sourceId}-payout`,
        amountMinor: 100, status: 'ACTIVE',
      } });
    } else {
      const line = await db.financialCorrectionDeductionSettlementLine.create({ data: {
        deductionId: `${sourceId}-source`, settlementApprovalId: fixture.approvalId,
        amountMinor: 100, status: 'ACTIVE',
      } });
      await db.financialCorrectionDeductionPayoutLine.create({ data: {
        settlementDeductionLineId: line.id, payoutBatchId: `${sourceId}-payout`,
        amountMinor: 100, status: 'ACTIVE',
      } });
    }
    const before = await financialSnapshot();
    expect(await assess(fixture.approvalId, fixture.vendorId)).toMatchObject({ state: 'blocked', reason });
    expect(await financialSnapshot()).toEqual(before);
    await expect(cancel(fixture.approvalId, fixture.actor)).rejects.toThrow();
    expect(await financialSnapshot()).toEqual(before);
  });

  it.each(['paid-first', 'cancel-first'] as const)(
    '%s concurrent transition cannot commit PAID and CANCELLED together', async (ordering) => {
      const fixture = await seed();
      await addPayout(fixture, 'DRAFT');
      expect((await markReview(`${fixture.id}-batch`)).status).toBe('review');
      const pay = () => markPaid(`${fixture.id}-batch`, { paidAt: new Date().toISOString() }, fixture.actor);
      const revoke = () => cancel(fixture.approvalId, fixture.actor);
      const results = await Promise.allSettled(ordering === 'paid-first' ? [pay(), revoke()] : [revoke(), pay()]);
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      const payout = await db.payoutBatch.findUniqueOrThrow({ where: { id: `${fixture.id}-batch` } });
      const approval = await db.settlementApproval.findUniqueOrThrow({ where: { id: fixture.approvalId } });
      expect(payout.status === 'PAID' && approval.status === 'CANCELLED').toBe(false);
      if (payout.status === 'PAID') expect(approval.status).toBe('APPROVED');
      if (approval.status === 'CANCELLED') expect(payout.status).toBe('REVIEW');
    },
  );
});
