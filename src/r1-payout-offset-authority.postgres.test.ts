import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../backend/node_modules/@prisma/client/index.js';

const url = process.env.TEST_DATABASE_URL?.trim();
const suite = url ? describe : describe.skip;

suite('R1 Phase 1 payout offset authority (PostgreSQL 16)', () => {
  let db: PrismaClient;
  let reconcile: typeof import('../backend/src/modules/finance/payout-offset-authority-diagnostics.service.js')['reconcilePayoutOffsetAuthority'];
  const prefix = `r1-phase1-${process.pid}-${Date.now()}`;
  const vendorA = `${prefix}-vendor-a`;
  const vendorB = `${prefix}-vendor-b`;
  const approvalA = `${prefix}-approval-a`;
  const approvalB = `${prefix}-approval-b`;
  const payoutA = `${prefix}-payout-a`;
  const debtA = `${prefix}-debt-a`;
  const debtB = `${prefix}-debt-b`;

  beforeAll(async () => {
    const target = new URL(url!);
    if (process.env.R1_PHASE1_TEST_DATABASE_ISOLATED !== '1' || target.protocol !== 'postgresql:' ||
      target.hostname !== '127.0.0.1' || target.pathname.slice(1) !== 'r1_phase1_validation' || !target.port) {
      throw new Error('R1 Phase 1 requires dedicated local r1_phase1_validation PostgreSQL.');
    }
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = url;
    db = new PrismaClient({ datasources: { db: { url } } });
    await db.$connect();
    const [identity] = await db.$queryRaw<Array<{ version: string; name: string; owner: string; port: number }>>`
      SELECT current_setting('server_version_num') AS version, current_database() AS name,
        current_user AS owner, inet_server_port() AS port`;
    expect(Number(identity.version)).toBeGreaterThanOrEqual(160000);
    expect(Number(identity.version)).toBeLessThan(170000);
    expect(identity.name).toBe('r1_phase1_validation');
    expect(identity.owner).toBe(target.username);
    expect(identity.port).toBe(Number(target.port));
    ({ reconcilePayoutOffsetAuthority: reconcile } = await import('../backend/src/modules/finance/payout-offset-authority-diagnostics.service.js'));
    for (const vendorId of [vendorA, vendorB]) {
      await db.vendor.create({ data: { id: vendorId, name: vendorId } });
    }
    for (const [id, vendorId] of [[approvalA, vendorA], [approvalB, vendorB]]) {
      await db.settlementApproval.create({ data: {
        id, vendorId, status: 'APPROVED', currency: 'TRY', approvedAt: new Date(),
        grossSalesMinor: 1000, refundTotalMinor: 0, commissionMinor: 0,
        commissionVatMinor: 0, netPayableMinor: 1000, sourceSnapshotJson: {},
      } });
    }
    await db.payoutBatch.create({ data: { id: payoutA, vendorId: vendorA, currency: 'TRY' } });
    await db.vendorBalanceEvent.create({ data: {
      id: debtA, vendorId: vendorA, type: 'VENDOR_DEBT_CREATED', amountMinor: -880,
      currency: 'TRY', sourceType: 'test', sourceId: debtA, idempotencyKey: debtA,
    } });
    await db.vendorBalanceEvent.create({ data: {
      id: debtB, vendorId: vendorB, type: 'VENDOR_DEBT_CREATED', amountMinor: -100,
      currency: 'TRY', sourceType: 'test', sourceId: debtB, idempotencyKey: debtB,
    } });
  });

  afterAll(async () => {
    await db?.$disconnect();
    const { prisma } = await import('../backend/src/db/prisma.js');
    await prisma.$disconnect();
  });

  it('fails closed for debt without verified economic source or source-level remaining balance', async () => {
    const before = await db.vendorBalanceEvent.findUniqueOrThrow({ where: { id: debtA } });
    const result = await reconcile({ vendorId: vendorA, currency: 'TRY' });
    expect(result.writesPerformed).toBe(false);
    expect(result.status).toBe('UNKNOWN');
    expect(result.sources).toMatchObject([{
      sourceType: 'VENDOR_DEBT', sourceId: debtA, originalAmountMinor: 880,
      verifiedAt: null, appliedAmountMinor: null, remainingAmountMinor: null,
      unreservedAmountMinor: null, status: 'UNKNOWN',
    }]);
    expect(result.sources[0].reasons).toContain('DEBT_SOURCE_AUTHORITY_AMBIGUOUS');
    expect(await db.vendorBalanceEvent.findUniqueOrThrow({ where: { id: debtA } })).toEqual(before);
    expect(await db.payoutOffsetClaim.count({ where: { vendorId: vendorA } })).toBe(0);
    expect(await db.payoutOffsetClaimEvent.count({ where: { payoutOffsetClaim: { vendorId: vendorA } } })).toBe(0);
    expect((await db.payoutBatch.findUniqueOrThrow({ where: { id: payoutA } })).netAmount.toString()).toBe('0');
  });

  it('enforces exact vendor, currency, debt type, positive amount and duplicate identity', async () => {
    const base = {
      vendorId: vendorA, currency: 'TRY', payoutBatchId: payoutA,
      settlementApprovalId: approvalA, sourceType: 'VENDOR_DEBT' as const,
      vendorDebtOriginEventId: debtA, vendorDebtOriginEventType: 'VENDOR_DEBT_CREATED' as const,
      reservedAmountMinor: 440, reservedBy: 'r1-test-actor',
    };
    await expect(db.payoutOffsetClaim.create({ data: { ...base, idempotencyKey: `${prefix}-wrong-vendor`, vendorId: vendorB } })).rejects.toThrow();
    await expect(db.payoutOffsetClaim.create({ data: { ...base, idempotencyKey: `${prefix}-wrong-currency`, currency: 'USD' } })).rejects.toThrow();
    await expect(db.payoutOffsetClaim.create({ data: { ...base, idempotencyKey: `${prefix}-wrong-type`, vendorDebtOriginEventType: 'VENDOR_DEBT_OFFSET' } })).rejects.toThrow();
    await expect(db.payoutOffsetClaim.create({ data: { ...base, idempotencyKey: `${prefix}-negative`, reservedAmountMinor: -1 } })).rejects.toThrow();
    const claim = await db.payoutOffsetClaim.create({ data: { ...base, idempotencyKey: `${prefix}-valid` } });
    expect(claim.status).toBe('RESERVED');
    expect(await db.payoutOffsetClaimEvent.findMany({ where: { payoutOffsetClaimId: claim.id } })).toMatchObject([
      { eventType: 'RESERVED', actorId: 'r1-test-actor' },
    ]);
    await expect(db.payoutOffsetClaim.create({ data: { ...base, idempotencyKey: `${prefix}-duplicate` } })).rejects.toThrow();
    await expect(db.payoutOffsetClaim.update({ where: { id: claim.id }, data: { reservedAmountMinor: 1 } })).rejects.toThrow();
    await expect(db.payoutOffsetClaim.delete({ where: { id: claim.id } })).rejects.toThrow();
    const diagnostic = await reconcile({ vendorId: vendorA, currency: 'TRY' });
    expect(diagnostic.claims).toMatchObject([{ id: claim.id, sourceId: debtA, reservedAmountMinor: 440, status: 'RESERVED' }]);
    expect(diagnostic.sources[0].activeReservationMinor).toBe(440);
    expect(diagnostic.sources[0].unreservedAmountMinor).toBeNull();
    await db.payoutOffsetClaim.update({ where: { id: claim.id }, data: {
      status: 'RELEASED', releasedBy: 'r1-test-actor', releasedAt: new Date(),
    } });
    const audit = await db.payoutOffsetClaimEvent.findMany({
      where: { payoutOffsetClaimId: claim.id }, orderBy: { occurredAt: 'asc' },
    });
    expect(audit).toHaveLength(2);
    expect(audit.map((event) => event.eventType).sort()).toEqual(['RELEASED', 'RESERVED']);
    await expect(db.payoutOffsetClaimEvent.delete({ where: { id: audit[0].id } })).rejects.toThrow();
    await expect(db.payoutOffsetClaim.update({ where: { id: claim.id }, data: { status: 'FINALIZED', finalizedBy: 'r1-test-actor', finalizedAt: new Date() } })).rejects.toThrow();
    expect(await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalA } })).toMatchObject({ status: 'APPROVED', netPayableMinor: 1000 });
  });

  it('uses exact accepted refund evidence time and fails closed when that evidence is missing', async () => {
    const orderId = `${prefix}-order`;
    const sourceShopifyOrderId = `gid://shopify/Order/${orderId}`;
    const allocationId = `${prefix}-allocation`;
    const refundRecordId = `${prefix}-refund-record`;
    const sourceShopifyRefundId = `gid://shopify/Refund/${refundRecordId}`;
    const saleId = `${prefix}-sale`;
    const refundLedgerId = `${prefix}-refund-ledger`;
    const adjustmentId = `${prefix}-adjustment`;
    await db.shopifyOrder.create({ data: {
      id: orderId, sourceShopifyOrderId, sourceShopifyOrderNumber: `#${prefix}`, currency: 'TRY',
    } });
    await db.vendorAllocation.create({ data: {
      id: allocationId, sourceShopifyOrderId: orderId, sourceShopifyOrderNumber: `#${prefix}`,
      originalVendorId: vendorA, assignedVendorId: vendorA,
    } });
    await db.refundRecord.create({ data: {
      id: refundRecordId, vendorAllocationId: allocationId, sourceShopifyOrderId,
      sourceShopifyOrderNumber: `#${prefix}`, sourceShopifyRefundId, amount: '10.00', status: 'processed',
    } });
    await db.financeLedgerEntry.create({ data: {
      id: saleId, vendorAllocationId: allocationId, vendorId: vendorA,
      entryType: 'sale', amount: '100.00',
    } });
    await db.financeLedgerEntry.create({ data: {
      id: refundLedgerId, vendorAllocationId: allocationId, vendorId: vendorA,
      entryType: 'refund', amount: '10.00',
    } });
    await db.settlementRefundAdjustment.create({ data: {
      id: adjustmentId, refundRecordId, refundFinanceLedgerEntryId: refundLedgerId,
      vendorId: vendorA, originalOrderId: orderId, status: 'PENDING', currencyCode: 'TRY',
      amountMinor: 880, originalAmountMinor: 880, appliedAmountMinor: 0,
      remainingAmountMinor: 880, reason: 'R1 read-only evidence fixture',
    } });
    const missing = await reconcile({ vendorId: vendorA, currency: 'TRY' });
    expect(missing.sources.find((source) => source.sourceId === adjustmentId)).toMatchObject({
      status: 'UNKNOWN', verifiedAt: null, unreservedAmountMinor: null,
    });
    expect(missing.sources.find((source) => source.sourceId === adjustmentId)?.reasons)
      .toContain('ACCEPTED_REFUND_SNAPSHOT_MISSING');

    const { normalizeRefundEvidence } = await import('../backend/src/modules/finance/refund-evidence-normalizer.service.js');
    const accepted = normalizeRefundEvidence({
      sourceShopifyRefundId, sourceShopifyOrderId, vendorAllocationId: allocationId,
      monetaryClassification: 'MONETARY_REFUND', refundTotalAmount: '10.00', currency: 'TRY',
      transactions: [{ transactionGid: `gid://shopify/OrderTransaction/${prefix}`, kind: 'REFUND',
        status: 'SUCCESS', amount: '10.00', currency: 'TRY' }],
      refundLines: [{ sourceLineItemId: `gid://shopify/LineItem/${prefix}`, quantity: 1,
        subtotalAmount: '10.00', currency: 'TRY' }],
      historicalEconomicVendorId: vendorA, historicalSaleFinanceLedgerEntryId: saleId,
      supersededSaleLedgerIds: [],
    });
    const capturedAt = new Date();
    await db.refundEvidenceSnapshot.create({ data: {
      id: `${prefix}-snapshot`, sourceShopifyRefundId, sourceShopifyOrderId,
      vendorAllocationId: allocationId, refundRecordId,
      refundFinanceLedgerEntryId: refundLedgerId, historicalEconomicVendorId: vendorA,
      historicalSaleFinanceLedgerEntryId: saleId, monetaryClassification: 'MONETARY_REFUND',
      refundTotalAmount: '10.00', currency: 'TRY',
      normalizedTransactionsJson: accepted.normalizedTransactionsJson,
      normalizedRefundLinesJson: accepted.normalizedRefundLinesJson,
      normalizedOwnershipJson: accepted.normalizedOwnershipJson,
      normalizedEvidenceJson: accepted.normalizedEvidenceJson,
      supersededSaleLedgerIdsJson: [], evidenceHash: accepted.evidenceHash,
      hashAlgorithm: accepted.hashAlgorithm, evidenceVersion: accepted.evidenceVersion,
      normalizationVersion: accepted.normalizationVersion, evidenceSource: 'r1_phase1_test', capturedAt,
    } });
    const verified = await reconcile({ vendorId: vendorA, currency: 'TRY' });
    expect(verified.sources.find((source) => source.sourceId === adjustmentId)).toMatchObject({
      sourceType: 'REFUND_ADJUSTMENT', refundFinanceLedgerEntryId: refundLedgerId,
      verifiedAt: capturedAt.toISOString(), originalAmountMinor: 880, appliedAmountMinor: 0,
      remainingAmountMinor: 880, activeReservationMinor: 0, unreservedAmountMinor: 880,
      status: 'VERIFIED', reasons: [],
    });
    const secondRefundRecordId = `${prefix}-second-refund-record`;
    const secondRefundLedgerId = `${prefix}-second-refund-ledger`;
    const secondAdjustmentId = `${prefix}-second-adjustment`;
    const secondSourceRefundId = `gid://shopify/Refund/${secondRefundRecordId}`;
    await db.refundRecord.create({ data: {
      id: secondRefundRecordId, vendorAllocationId: allocationId, sourceShopifyOrderId,
      sourceShopifyOrderNumber: `#${prefix}`, sourceShopifyRefundId: secondSourceRefundId,
      amount: '5.00', status: 'processed',
    } });
    await db.financeLedgerEntry.create({ data: {
      id: secondRefundLedgerId, vendorAllocationId: allocationId, vendorId: vendorA,
      entryType: 'refund', amount: '5.00',
    } });
    await db.settlementRefundAdjustment.create({ data: {
      id: secondAdjustmentId, refundRecordId: secondRefundRecordId,
      refundFinanceLedgerEntryId: secondRefundLedgerId, vendorId: vendorA,
      originalOrderId: orderId, status: 'PENDING', currencyCode: 'TRY', amountMinor: 440,
      originalAmountMinor: 440, appliedAmountMinor: 0, remainingAmountMinor: 440,
      reason: 'R1 second exact refund evidence fixture',
    } });
    const secondAccepted = normalizeRefundEvidence({
      sourceShopifyRefundId: secondSourceRefundId, sourceShopifyOrderId, vendorAllocationId: allocationId,
      monetaryClassification: 'MONETARY_REFUND', refundTotalAmount: '5.00', currency: 'TRY',
      transactions: [{ transactionGid: `gid://shopify/OrderTransaction/${prefix}-second`, kind: 'REFUND',
        status: 'SUCCESS', amount: '5.00', currency: 'TRY' }],
      refundLines: [{ sourceLineItemId: `gid://shopify/LineItem/${prefix}`, quantity: 1,
        subtotalAmount: '5.00', currency: 'TRY' }],
      historicalEconomicVendorId: vendorA, historicalSaleFinanceLedgerEntryId: saleId,
      supersededSaleLedgerIds: [],
    });
    while (Date.now() <= capturedAt.getTime()) await new Promise((resolve) => setTimeout(resolve, 1));
    const secondCapturedAt = new Date();
    await db.refundEvidenceSnapshot.create({ data: {
      id: `${prefix}-second-snapshot`, sourceShopifyRefundId: secondSourceRefundId,
      sourceShopifyOrderId, vendorAllocationId: allocationId,
      refundRecordId: secondRefundRecordId, refundFinanceLedgerEntryId: secondRefundLedgerId,
      historicalEconomicVendorId: vendorA, historicalSaleFinanceLedgerEntryId: saleId,
      monetaryClassification: 'MONETARY_REFUND', refundTotalAmount: '5.00', currency: 'TRY',
      normalizedTransactionsJson: secondAccepted.normalizedTransactionsJson,
      normalizedRefundLinesJson: secondAccepted.normalizedRefundLinesJson,
      normalizedOwnershipJson: secondAccepted.normalizedOwnershipJson,
      normalizedEvidenceJson: secondAccepted.normalizedEvidenceJson,
      supersededSaleLedgerIdsJson: [], evidenceHash: secondAccepted.evidenceHash,
      hashAlgorithm: secondAccepted.hashAlgorithm, evidenceVersion: secondAccepted.evidenceVersion,
      normalizationVersion: secondAccepted.normalizationVersion,
      evidenceSource: 'r1_phase1_test', capturedAt: secondCapturedAt,
    } });
    const ordered = await reconcile({ vendorId: vendorA, currency: 'TRY' });
    expect(ordered.sources.filter((source) => source.sourceType === 'REFUND_ADJUSTMENT')
      .map((source) => source.sourceId)).toEqual([adjustmentId, secondAdjustmentId]);
    expect(ordered.sources.find((source) => source.sourceId === secondAdjustmentId)?.verifiedAt)
      .toBe(secondCapturedAt.toISOString());
    await expect(db.payoutOffsetClaim.create({ data: {
      vendorId: vendorB, currency: 'TRY', payoutBatchId: payoutA,
      settlementApprovalId: approvalB, sourceType: 'REFUND_ADJUSTMENT',
      settlementRefundAdjustmentId: adjustmentId, reservedAmountMinor: 1,
      idempotencyKey: `${prefix}-cross-vendor-adjustment`, reservedBy: 'r1-test-actor',
    } })).rejects.toThrow();
    expect(await db.payoutOffsetClaim.count({ where: { settlementRefundAdjustmentId: adjustmentId } })).toBe(0);
  });
});
