import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../backend/node_modules/@prisma/client/index.js';

const url = process.env.TEST_DATABASE_URL?.trim();
const suite = url ? describe : describe.skip;

suite('R1 Phase 2 guarded payout offset reservations (isolated PostgreSQL)', () => {
  let db: PrismaClient;
  let reserve: typeof import('../backend/src/modules/finance/payout-offset-reservation.service.js')['reserveVerifiedPayoutOffsets'];
  let reconcile: typeof import('../backend/src/modules/finance/payout-offset-authority-diagnostics.service.js')['reconcilePayoutOffsetAuthority'];
  let createAdjustment: typeof import('../backend/src/modules/finance/settlement-refund-adjustment.service.js')['createSettlementRefundAdjustmentForRefundLedger'];
  let normalize: typeof import('../backend/src/modules/finance/refund-evidence-normalizer.service.js')['normalizeRefundEvidence'];
  let recordDelivery: typeof import('../backend/src/modules/shipping/allocation-delivered-observation.service.js')['recordVerifiedDeliveredObservation'];
  let createDraft: typeof import('../backend/src/modules/finance/settlement-approval.service.js')['createDraftApproval'];
  const prefix = `r1-phase2-${process.pid}-${Date.now()}`;
  let sequence = 0;
  const next = (name: string) => `${prefix}-${++sequence}-${name}`;

  beforeAll(async () => {
    const target = new URL(url!);
    if (process.env.R1_PHASE2_TEST_DATABASE_ISOLATED !== '1' || target.protocol !== 'postgresql:' ||
        target.hostname !== '127.0.0.1' || target.pathname.slice(1) !== 'r1_phase2_validation' || !target.port) {
      throw new Error('R1 Phase 2 requires dedicated local r1_phase2_validation PostgreSQL.');
    }
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = url;
    db = new PrismaClient({ datasources: { db: { url } } });
    await db.$connect();
    const [identity] = await db.$queryRaw<Array<{ version: string; name: string; owner: string; port: number }>>`
      SELECT current_setting('server_version_num') AS version, current_database() AS name,
        current_user AS owner, inet_server_port() AS port`;
    expect([16, 18]).toContain(Math.floor(Number(identity.version) / 10000));
    expect(identity.name).toBe('r1_phase2_validation');
    expect(identity.owner).toBe(target.username);
    expect(identity.port).toBe(Number(target.port));
    ({ reserveVerifiedPayoutOffsets: reserve } = await import('../backend/src/modules/finance/payout-offset-reservation.service.js'));
    ({ reconcilePayoutOffsetAuthority: reconcile } = await import('../backend/src/modules/finance/payout-offset-authority-diagnostics.service.js'));
    ({ createSettlementRefundAdjustmentForRefundLedger: createAdjustment } = await import('../backend/src/modules/finance/settlement-refund-adjustment.service.js'));
    ({ normalizeRefundEvidence: normalize } = await import('../backend/src/modules/finance/refund-evidence-normalizer.service.js'));
    ({ recordVerifiedDeliveredObservation: recordDelivery } = await import('../backend/src/modules/shipping/allocation-delivered-observation.service.js'));
    ({ createDraftApproval: createDraft } = await import('../backend/src/modules/finance/settlement-approval.service.js'));
  });

  afterAll(async () => {
    await db?.$disconnect();
    const { prisma } = await import('../backend/src/db/prisma.js');
    await prisma.$disconnect();
  });

  async function makeSale(vendorId: string, amountMinor: number, approvedAt: Date) {
    const orderId = next('order');
    const allocationId = next('allocation');
    const saleId = next('sale');
    const approvalId = next('approval');
    const lineId = next('line');
    await db.shopifyOrder.create({ data: {
      id: orderId, sourceShopifyOrderId: `gid://shopify/Order/${orderId}`,
      sourceShopifyOrderNumber: `#${orderId}`, currency: 'TRY',
    } });
    await db.vendorAllocation.create({ data: {
      id: allocationId, sourceShopifyOrderId: orderId, sourceShopifyOrderNumber: `#${orderId}`,
      originalVendorId: vendorId, assignedVendorId: vendorId,
    } });
    await db.financeLedgerEntry.create({ data: {
      id: saleId, vendorAllocationId: allocationId, vendorId,
      entryType: 'sale', amount: (amountMinor / 100).toFixed(2),
      commissionPercentSnapshot: 10, commissionVatPercentSnapshot: 20,
    } });
    await db.settlementApproval.create({ data: {
      id: approvalId, vendorId, currency: 'TRY', status: 'APPROVED', approvedAt,
      grossSalesMinor: amountMinor, refundTotalMinor: 0, commissionMinor: 0,
      commissionVatMinor: 0, netPayableMinor: amountMinor, sourceSnapshotJson: {},
    } });
    await db.settlementApprovalLine.create({ data: {
      id: lineId, settlementApprovalId: approvalId, financeLedgerEntryId: saleId,
      lineType: 'SALE', amountMinor, commissionMinor: 0, commissionVatMinor: 0,
      payableImpactMinor: amountMinor, sourceSnapshotJson: {},
    } });
    return { orderId, allocationId, saleId, approvalId, lineId, amountMinor };
  }

  async function makeRefund(vendorId: string, sale: Awaited<ReturnType<typeof makeSale>>,
    refundMinor = 1000, kind: 'adjustment' | 'debt' = 'adjustment') {
    const refundRecordId = next('refund-record');
    const refundLedgerId = next('refund-ledger');
    const sourceShopifyRefundId = `gid://shopify/Refund/${refundRecordId}`;
    const order = await db.shopifyOrder.findUniqueOrThrow({ where: { id: sale.orderId } });
    await db.refundRecord.create({ data: {
      id: refundRecordId, vendorAllocationId: sale.allocationId,
      sourceShopifyOrderId: order.sourceShopifyOrderId,
      sourceShopifyOrderNumber: order.sourceShopifyOrderNumber,
      sourceShopifyRefundId, amount: (refundMinor / 100).toFixed(2), status: 'processed',
    } });
    await db.financeLedgerEntry.create({ data: {
      id: refundLedgerId, vendorAllocationId: sale.allocationId, vendorId,
      entryType: 'refund', amount: (refundMinor / 100).toFixed(2),
      commissionPercentSnapshot: 10, commissionVatPercentSnapshot: 20,
    } });
    const accepted = normalize({
      sourceShopifyRefundId, sourceShopifyOrderId: order.sourceShopifyOrderId,
      vendorAllocationId: sale.allocationId, monetaryClassification: 'MONETARY_REFUND',
      refundTotalAmount: (refundMinor / 100).toFixed(2), currency: 'TRY',
      transactions: [{ transactionGid: `gid://shopify/OrderTransaction/${refundRecordId}`,
        kind: 'REFUND', status: 'SUCCESS', amount: (refundMinor / 100).toFixed(2), currency: 'TRY' }],
      refundLines: [{ sourceLineItemId: `gid://shopify/LineItem/${refundRecordId}`, quantity: 1,
        subtotalAmount: (refundMinor / 100).toFixed(2), currency: 'TRY' }],
      historicalEconomicVendorId: vendorId, historicalSaleFinanceLedgerEntryId: sale.saleId,
      supersededSaleLedgerIds: [],
    });
    await db.refundEvidenceSnapshot.create({ data: {
      id: next('snapshot'), sourceShopifyRefundId,
      sourceShopifyOrderId: order.sourceShopifyOrderId,
      vendorAllocationId: sale.allocationId, refundRecordId,
      refundFinanceLedgerEntryId: refundLedgerId, historicalEconomicVendorId: vendorId,
      historicalSaleFinanceLedgerEntryId: sale.saleId,
      monetaryClassification: 'MONETARY_REFUND', refundTotalAmount: (refundMinor / 100).toFixed(2),
      currency: 'TRY', normalizedTransactionsJson: accepted.normalizedTransactionsJson,
      normalizedRefundLinesJson: accepted.normalizedRefundLinesJson,
      normalizedOwnershipJson: accepted.normalizedOwnershipJson,
      normalizedEvidenceJson: accepted.normalizedEvidenceJson,
      supersededSaleLedgerIdsJson: [], evidenceHash: accepted.evidenceHash,
      hashAlgorithm: accepted.hashAlgorithm, evidenceVersion: accepted.evidenceVersion,
      normalizationVersion: accepted.normalizationVersion,
      evidenceSource: 'r1_phase2_isolated_test', capturedAt: new Date(),
    } });
    if (kind === 'adjustment') {
      const adjustment = await createAdjustment(db, {
        refundFinanceLedgerEntryId: refundLedgerId, refundRecordId, createdBy: 'r1-phase2-test',
      });
      expect(adjustment).not.toBeNull();
      return { sourceType: 'REFUND_ADJUSTMENT' as const, sourceId: adjustment!.id,
        refundRecordId, refundLedgerId, amountMinor: adjustment!.originalAmountMinor };
    }
    await db.financeLedgerEntry.update({ where: { id: sale.saleId }, data: { payoutStatus: 'PAID' } });
    const paidBatchId = await makeBatch(vendorId, [sale]);
    await db.payoutBatch.update({ where: { id: paidBatchId }, data: {
      status: 'PAID', paidAt: new Date(), paymentReference: next('historical-payment'),
    } });
    const debtId = next('debt');
    await db.vendorBalanceEvent.create({ data: {
      id: debtId, vendorId, currency: 'TRY', type: 'VENDOR_DEBT_CREATED', amountMinor: -Math.round(refundMinor * 0.88),
      sourceType: 'shopify_refund', sourceId: refundRecordId, financeLedgerEntryId: refundLedgerId,
      refundRecordId, idempotencyKey: next('debt-key'),
    } });
    return { sourceType: 'VENDOR_DEBT' as const, sourceId: debtId,
      refundRecordId, refundLedgerId, amountMinor: Math.round(refundMinor * 0.88) };
  }

  async function makeBatch(vendorId: string, approvals: Awaited<ReturnType<typeof makeSale>>[]) {
    const batchId = next('batch');
    const totalMinor = approvals.reduce((sum, approval) => sum + approval.amountMinor, 0);
    await db.payoutBatch.create({ data: {
      id: batchId, vendorId, currency: 'TRY', status: 'DRAFT', netAmount: (totalMinor / 100).toFixed(2),
      lines: { create: approvals.map((approval) => ({
        financeLedgerEntryId: approval.saleId, settlementApprovalLineId: approval.lineId,
        amountSnapshot: (approval.amountMinor / 100).toFixed(2),
      })) },
    } });
    return batchId;
  }

  async function makeEligibleUnsettledSale(vendorId: string) {
    const orderId = next('eligible-order');
    const allocationId = next('eligible-allocation');
    const saleId = next('eligible-sale');
    const executionId = next('execution');
    const sourceReference = next('shipment-reference');
    await db.shopifyOrder.create({ data: {
      id: orderId, sourceShopifyOrderId: `gid://shopify/Order/${orderId}`,
      sourceShopifyOrderNumber: `#${orderId}`, currency: 'TRY',
    } });
    await db.vendorAllocation.create({ data: {
      id: allocationId, sourceShopifyOrderId: orderId, sourceShopifyOrderNumber: `#${orderId}`,
      originalVendorId: vendorId, assignedVendorId: vendorId,
      outboundMethodSnapshot: 'KARGONOMI', fulfillmentStatus: 'Fulfilled', shippingStatus: 'Delivered',
    } });
    await db.shipmentExecution.create({ data: {
      id: executionId, allocationId, vendorId, provider: 'KARGONOMI',
      providerShipmentId: sourceReference, shipmentStatus: 'DELIVERED', requestSnapshot: {},
    } });
    const observation = await recordDelivery({ allocationId,
      source: { method: 'KARGONOMI', shipmentExecutionId: executionId, sourceReference },
    }, db as never);
    await db.fulfillment.create({ data: {
      id: next('fulfillment'), vendorAllocationId: allocationId,
      fulfillmentStatus: 'Fulfilled', fulfilledAt: new Date(), shipmentUpdatedAt: new Date(),
    } });
    await db.financeLedgerEntry.create({ data: {
      id: saleId, vendorAllocationId: allocationId, vendorId, entryType: 'sale',
      amount: '20.00', settlementDelayDaysSnapshot: 0,
      commissionPercentSnapshot: 10, commissionVatPercentSnapshot: 20,
      settlementStatus: 'PENDING', payoutStatus: 'PENDING',
    } });
    while (Date.now() <= observation.firstObservedDeliveredAt.getTime()) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    return { allocationId, saleId, observation };
  }

  async function baseFixture(capacityMinor = 8800, obligationMinor = 1000,
    kind: 'adjustment' | 'debt' = 'adjustment') {
    const vendorId = next('vendor');
    await db.vendor.create({ data: { id: vendorId, name: vendorId } });
    const original = await makeSale(vendorId, 10000, new Date('2026-01-01T00:00:00.000Z'));
    const source = await makeRefund(vendorId, original, obligationMinor, kind);
    const capacity = await makeSale(vendorId, capacityMinor, new Date('2026-01-02T00:00:00.000Z'));
    const batchId = await makeBatch(vendorId, [capacity]);
    const requestId = next('request');
    const input = { vendorId, currency: 'TRY', payoutBatchId: batchId, requestId, actorId: 'r1-test-actor' };
    return { vendorId, original, source, capacity, batchId, input };
  }

  it('reserves exact 880 from 8800 without changing payout or adjustment money; retry is idempotent', async () => {
    const fixture = await baseFixture();
    const beforeBatch = await db.payoutBatch.findUniqueOrThrow({ where: { id: fixture.batchId } });
    const beforeAdjustment = await db.settlementRefundAdjustment.findUniqueOrThrow({ where: { id: fixture.source.sourceId } });
    const first = await reserve(fixture.input);
    expect(first.writesPerformed).toBe(true);
    expect(first.claims).toMatchObject([{ sourceType: 'REFUND_ADJUSTMENT',
      settlementApprovalId: fixture.capacity.approvalId, reservedAmountMinor: 880, status: 'RESERVED' }]);
    const second = await reserve(fixture.input);
    expect(second.writesPerformed).toBe(false);
    expect(second.claims.map((claim) => claim.id)).toEqual(first.claims.map((claim) => claim.id));
    expect(await db.payoutOffsetClaimEvent.count({ where: { payoutOffsetClaimId: first.claims[0].id } })).toBe(1);
    expect(await db.payoutBatch.findUniqueOrThrow({ where: { id: fixture.batchId } })).toEqual(beforeBatch);
    expect(await db.settlementRefundAdjustment.findUniqueOrThrow({ where: { id: fixture.source.sourceId } })).toEqual(beforeAdjustment);
    expect((await reconcile({ vendorId: fixture.vendorId, currency: 'TRY' })).sources[0].unreservedAmountMinor).toBe(0);
  });

  it('limits a verified 880 obligation to 440 capacity, retaining 440 unreserved', async () => {
    const fixture = await baseFixture(440);
    const result = await reserve(fixture.input);
    expect(result.claims.map((claim) => claim.reservedAmountMinor)).toEqual([440]);
    const diagnostic = await reconcile({ vendorId: fixture.vendorId, currency: 'TRY' });
    expect(diagnostic.sources[0]).toMatchObject({ originalAmountMinor: 880,
      remainingAmountMinor: 880, activeReservationMinor: 440, unreservedAmountMinor: 440 });
    expect((await db.payoutBatch.findUniqueOrThrow({ where: { id: fixture.batchId } })).netAmount.toString()).toBe('4.4');
  });

  it('uses oldest approved capacity before a newer approval and preserves exact source lineage', async () => {
    const fixture = await baseFixture(440);
    const later = await makeSale(fixture.vendorId, 880, new Date('2026-01-03T00:00:00.000Z'));
    await db.payoutBatchLine.create({ data: {
      payoutBatchId: fixture.batchId, financeLedgerEntryId: later.saleId,
      settlementApprovalLineId: later.lineId, amountSnapshot: '8.80',
    } });
    await db.payoutBatch.update({ where: { id: fixture.batchId }, data: { netAmount: '13.20' } });
    const result = await reserve(fixture.input);
    expect(result.claims.map((claim) => [claim.settlementApprovalId, claim.reservedAmountMinor]))
      .toEqual([[fixture.capacity.approvalId, 440], [later.approvalId, 440]]);
  });

  it('serializes competing requests so one source cannot be oversubscribed', async () => {
    const fixture = await baseFixture();
    const results = await Promise.allSettled([
      reserve(fixture.input), reserve({ ...fixture.input, requestId: next('other-request') }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await db.payoutOffsetClaim.aggregate({ where: { settlementRefundAdjustmentId: fixture.source.sourceId },
      _sum: { reservedAmountMinor: true } })).toMatchObject({ _sum: { reservedAmountMinor: 880 } });
  });

  it('rejects direct REFUND and exact VendorDebt conflict without persisting a claim', async () => {
    const fixture = await baseFixture();
    await db.settlementApprovalLine.create({ data: {
      settlementApprovalId: fixture.original.approvalId,
      financeLedgerEntryId: fixture.source.refundLedgerId,
      lineType: 'REFUND', amountMinor: 1000, commissionMinor: 100,
      commissionVatMinor: 20, payableImpactMinor: -880, sourceSnapshotJson: {},
    } });
    await expect(reserve(fixture.input)).rejects.toThrow('R1_OFFSET_AUTHORITY_NOT_VERIFIED');
    expect(await db.payoutOffsetClaim.count({ where: { vendorId: fixture.vendorId } })).toBe(0);
  });

  it('rejects a refund-linked debt competing with the same exact adjustment ledger', async () => {
    const fixture = await baseFixture();
    await db.vendorBalanceEvent.create({ data: {
      vendorId: fixture.vendorId, currency: 'TRY', type: 'VENDOR_DEBT_CREATED',
      amountMinor: -880, sourceType: 'shopify_refund', sourceId: fixture.source.refundRecordId,
      refundRecordId: fixture.source.refundRecordId,
      financeLedgerEntryId: fixture.source.refundLedgerId,
      idempotencyKey: next('conflicting-debt'),
    } });
    await expect(reserve(fixture.input)).rejects.toThrow('R1_OFFSET_AUTHORITY_NOT_VERIFIED');
    expect(await db.payoutOffsetClaim.count({ where: { vendorId: fixture.vendorId } })).toBe(0);
  });

  it('fails closed for aggregate historical debt and unchanged normal payout amount', async () => {
    const fixture = await baseFixture(8800, 1000, 'debt');
    await db.vendorBalanceEvent.create({ data: {
      vendorId: fixture.vendorId, currency: 'TRY', type: 'VENDOR_DEBT_OFFSET', amountMinor: 100,
      sourceType: 'payout_batch', sourceId: fixture.batchId, payoutBatchId: fixture.batchId,
      idempotencyKey: next('legacy-offset'),
    } });
    await expect(reserve(fixture.input)).rejects.toThrow('R1_AGGREGATE_DEBT_OFFSET_CONFLICT');
    expect(await db.payoutOffsetClaim.count({ where: { vendorId: fixture.vendorId } })).toBe(0);
    expect((await db.payoutBatch.findUniqueOrThrow({ where: { id: fixture.batchId } })).netAmount.toString()).toBe('88');
  });

  it('reserves an exact unconsumed refund debt but leaves its balance event untouched', async () => {
    const fixture = await baseFixture(8800, 1000, 'debt');
    const debt = await db.vendorBalanceEvent.findUniqueOrThrow({ where: { id: fixture.source.sourceId } });
    const result = await reserve(fixture.input);
    expect(result.claims).toMatchObject([{ sourceType: 'VENDOR_DEBT', vendorDebtOriginEventId: debt.id,
      reservedAmountMinor: 880 }]);
    expect(await db.vendorBalanceEvent.findUniqueOrThrow({ where: { id: debt.id } })).toEqual(debt);
  });

  it('rolls back a failed request with inconsistent approved payout capacity', async () => {
    const fixture = await baseFixture();
    await db.payoutBatch.update({ where: { id: fixture.batchId }, data: { netAmount: '99.00' } });
    await expect(reserve(fixture.input)).rejects.toThrow('R1_PAYOUT_BASE_DOES_NOT_MATCH_APPROVED_AUTHORITY');
    expect(await db.payoutOffsetClaim.count({ where: { vendorId: fixture.vendorId } })).toBe(0);
  });

  it('carries the exact unreserved 440 to a later distinct payout without exceeding 880 total', async () => {
    const fixture = await baseFixture(440);
    await reserve(fixture.input);
    const later = await makeSale(fixture.vendorId, 440, new Date('2026-01-03T00:00:00.000Z'));
    const laterBatchId = await makeBatch(fixture.vendorId, [later]);
    const result = await reserve({ ...fixture.input, payoutBatchId: laterBatchId, requestId: next('request') });
    expect(result.claims).toMatchObject([{ settlementApprovalId: later.approvalId, reservedAmountMinor: 440 }]);
    const claims = await db.payoutOffsetClaim.findMany({ where: {
      settlementRefundAdjustmentId: fixture.source.sourceId, status: 'RESERVED',
    } });
    expect(claims.map((claim) => claim.reservedAmountMinor).sort()).toEqual([440, 440]);
    expect((await reconcile({ vendorId: fixture.vendorId, currency: 'TRY' })).sources[0].unreservedAmountMinor).toBe(0);
  });

  it('orders two distinct verified refund sources by accepted evidence time', async () => {
    const fixture = await baseFixture(1000);
    await new Promise((resolve) => setTimeout(resolve, 3));
    const second = await makeRefund(fixture.vendorId, fixture.original);
    const firstTime = (await db.refundEvidenceSnapshot.findUniqueOrThrow({
      where: { refundFinanceLedgerEntryId: fixture.source.refundLedgerId },
    })).capturedAt;
    const secondTime = (await db.refundEvidenceSnapshot.findUniqueOrThrow({
      where: { refundFinanceLedgerEntryId: second.refundLedgerId },
    })).capturedAt;
    expect(secondTime.getTime()).toBeGreaterThan(firstTime.getTime());
    const result = await reserve(fixture.input);
    expect(result.claims.map((claim) => [claim.settlementRefundAdjustmentId, claim.reservedAmountMinor]))
      .toEqual([[fixture.source.sourceId, 880], [second.sourceId, 120]]);
    expect((await reconcile({ vendorId: fixture.vendorId, currency: 'TRY' })).sources
      .map((source) => [source.sourceId, source.unreservedAmountMinor]))
      .toEqual([[fixture.source.sourceId, 0], [second.sourceId, 760]]);
  });

  it('orders a verified refund debt and later adjustment without merging their authorities', async () => {
    const fixture = await baseFixture(1000, 1000, 'debt');
    await new Promise((resolve) => setTimeout(resolve, 3));
    const secondOriginal = await makeSale(fixture.vendorId, 10000, new Date('2026-01-01T01:00:00.000Z'));
    const second = await makeRefund(fixture.vendorId, secondOriginal);
    const result = await reserve(fixture.input);
    expect(result.claims.map((claim) => [claim.sourceType, claim.reservedAmountMinor]))
      .toEqual([['VENDOR_DEBT', 880], ['REFUND_ADJUSTMENT', 120]]);
    expect(result.claims[0].vendorDebtOriginEventId).toBe(fixture.source.sourceId);
    expect(result.claims[1].settlementRefundAdjustmentId).toBe(second.sourceId);
  });

  it('rejects foreign vendor, currency and a reused request identity', async () => {
    const fixture = await baseFixture();
    const otherVendor = next('vendor');
    await db.vendor.create({ data: { id: otherVendor, name: otherVendor } });
    await expect(reserve({ ...fixture.input, vendorId: otherVendor })).rejects.toThrow('R1_PAYOUT_BATCH_NOT_ELIGIBLE');
    await expect(reserve({ ...fixture.input, currency: 'USD' })).rejects.toThrow('R1_PAYOUT_BATCH_NOT_ELIGIBLE');
    await reserve(fixture.input);
    const later = await makeSale(fixture.vendorId, 880, new Date('2026-01-03T00:00:00.000Z'));
    const laterBatch = await makeBatch(fixture.vendorId, [later]);
    await expect(reserve({ ...fixture.input, payoutBatchId: laterBatch })).rejects
      .toThrow('R1_RESERVATION_IDEMPOTENCY_CONFLICT');
  });

  it('fails closed for missing accepted refund evidence and a contradictory amount', async () => {
    const fixture = await baseFixture();
    await db.refundEvidenceSnapshot.delete({ where: { refundFinanceLedgerEntryId: fixture.source.refundLedgerId } });
    await expect(reserve(fixture.input)).rejects.toThrow('R1_OFFSET_AUTHORITY_NOT_VERIFIED');
    expect(await db.payoutOffsetClaim.count({ where: { vendorId: fixture.vendorId } })).toBe(0);
    const other = await baseFixture();
    await db.settlementRefundAdjustment.update({ where: { id: other.source.sourceId }, data: {
      amountMinor: 900, originalAmountMinor: 900, remainingAmountMinor: 900,
    } });
    await expect(reserve(other.input)).rejects.toThrow('R1_SOURCE_AMOUNT_DIFFERS_FROM_FROZEN_REFUND_EVIDENCE');
    expect(await db.payoutOffsetClaim.count({ where: { vendorId: other.vendorId } })).toBe(0);
  });

  it('does not reserve or modify money when no approved payout capacity remains', async () => {
    const fixture = await baseFixture(0);
    const result = await reserve(fixture.input);
    expect(result).toMatchObject({ writesPerformed: false, claims: [] });
    expect(await db.payoutOffsetClaim.count({ where: { vendorId: fixture.vendorId } })).toBe(0);
    expect((await reconcile({ vendorId: fixture.vendorId, currency: 'TRY' })).sources[0].unreservedAmountMinor).toBe(880);
  });

  it('rejects PAID payout history and never rewrites its approved source', async () => {
    const fixture = await baseFixture();
    await db.payoutBatch.update({ where: { id: fixture.batchId }, data: {
      status: 'PAID', paidAt: new Date(), paymentReference: next('eft-reference'),
    } });
    const beforeBatch = await db.payoutBatch.findUniqueOrThrow({ where: { id: fixture.batchId } });
    const beforeApproval = await db.settlementApproval.findUniqueOrThrow({ where: { id: fixture.capacity.approvalId } });
    await expect(reserve(fixture.input)).rejects.toThrow('R1_PAYOUT_BATCH_NOT_ELIGIBLE');
    expect(await db.payoutBatch.findUniqueOrThrow({ where: { id: fixture.batchId } })).toEqual(beforeBatch);
    expect(await db.settlementApproval.findUniqueOrThrow({ where: { id: fixture.capacity.approvalId } })).toEqual(beforeApproval);
  });

  it('does not reserve against the adjustment origin approval itself', async () => {
    const fixture = await baseFixture();
    const originBatch = await makeBatch(fixture.vendorId, [fixture.original]);
    await expect(reserve({ ...fixture.input, payoutBatchId: originBatch, requestId: next('request') }))
      .rejects.toThrow('R1_REFUND_ADJUSTMENT_ORIGIN_NOT_ELIGIBLE_FOR_THIS_PAYOUT');
    expect(await db.payoutOffsetClaim.count({ where: { vendorId: fixture.vendorId } })).toBe(0);
  });

  it('fails closed when an older unblocked approved settlement was omitted from payout capacity', async () => {
    const fixture = await baseFixture();
    await makeSale(fixture.vendorId, 440, new Date('2026-01-01T12:00:00.000Z'));
    await expect(reserve(fixture.input)).rejects
      .toThrow('R1_OLDER_APPROVED_SETTLEMENT_ELIGIBILITY_UNKNOWN');
    expect(await db.payoutOffsetClaim.count({ where: { vendorId: fixture.vendorId } })).toBe(0);
  });

  it('does not treat a PAID ledger flag alone as proof of a historical PAID payout', async () => {
    const fixture = await baseFixture();
    const older = await makeSale(fixture.vendorId, 440, new Date('2026-01-01T12:00:00.000Z'));
    await db.financeLedgerEntry.update({ where: { id: older.saleId }, data: { payoutStatus: 'PAID' } });
    await expect(reserve(fixture.input)).rejects
      .toThrow('R1_OLDER_APPROVED_SETTLEMENT_ELIGIBILITY_UNKNOWN');
    expect(await db.payoutOffsetClaim.count({ where: { vendorId: fixture.vendorId } })).toBe(0);
  });

  it('does not silently skip an older approved settlement with no ledger lines', async () => {
    const fixture = await baseFixture();
    await db.settlementApproval.create({ data: {
      vendorId: fixture.vendorId, currency: 'TRY', status: 'APPROVED',
      approvedAt: new Date('2026-01-01T12:00:00.000Z'),
      grossSalesMinor: 0, refundTotalMinor: 0, commissionMinor: 0,
      commissionVatMinor: 0, netPayableMinor: 100, sourceSnapshotJson: {},
    } });
    await expect(reserve(fixture.input)).rejects
      .toThrow('R1_OLDER_APPROVED_SETTLEMENT_ELIGIBILITY_UNKNOWN');
    expect(await db.payoutOffsetClaim.count({ where: { vendorId: fixture.vendorId } })).toBe(0);
  });

  it('settlement consumes only the 440 unreserved adjustment slice after a 440 payout reservation', async () => {
    const fixture = await baseFixture(440);
    await reserve(fixture.input);
    const newSale = await makeEligibleUnsettledSale(fixture.vendorId);
    const draft = await createDraft({ vendorId: fixture.vendorId, candidateScope: 'selected_allocations',
      selectedAllocationIds: [newSale.allocationId], asOfDate: new Date() });
    expect(draft.lines.some((line) => line.financeLedgerEntryId === newSale.saleId)).toBe(true);
    const applications = await db.settlementRefundAdjustmentApplication.findMany({
      where: { settlementApprovalId: draft.id, settlementRefundAdjustmentId: fixture.source.sourceId,
        status: 'ACTIVE' },
    });
    expect(applications.map((application) => application.amountMinor)).toEqual([440]);
    const adjustment = await db.settlementRefundAdjustment.findUniqueOrThrow({ where: { id: fixture.source.sourceId } });
    expect(adjustment).toMatchObject({ originalAmountMinor: 880, appliedAmountMinor: 440, remainingAmountMinor: 440 });
    expect((await reconcile({ vendorId: fixture.vendorId, currency: 'TRY' })).sources[0])
      .toMatchObject({ activeReservationMinor: 440, unreservedAmountMinor: 0 });
  });

  it('concurrent settlement and payout reservation never consume more than one 880 adjustment', async () => {
    const fixture = await baseFixture(440);
    const newSale = await makeEligibleUnsettledSale(fixture.vendorId);
    const results = await Promise.allSettled([
      reserve(fixture.input),
      createDraft({ vendorId: fixture.vendorId, candidateScope: 'selected_allocations',
        selectedAllocationIds: [newSale.allocationId], asOfDate: new Date() }),
    ]);
    expect(results.some((result) => result.status === 'fulfilled')).toBe(true);
    for (const [index, result] of results.entries()) {
      if (result.status !== 'rejected') continue;
      expect(String(result.reason)).toMatch(/P2034|write conflict or a deadlock/);
      // Serializable conflicts are retried by the caller, never treated as
      // proof that both routes consumed the same adjustment.
      if (index === 0) {
        try {
          await reserve(fixture.input);
        } catch (retryError) {
          expect(String(retryError)).toMatch(
            /R1_OLDER_APPROVED_SETTLEMENT_ELIGIBILITY_UNKNOWN|R1_OFFSET_AUTHORITY_NOT_VERIFIED/,
          );
        }
      } else await createDraft({ vendorId: fixture.vendorId, candidateScope: 'selected_allocations',
        selectedAllocationIds: [newSale.allocationId], asOfDate: new Date() });
    }
    const adjustment = await db.settlementRefundAdjustment.findUniqueOrThrow({ where: { id: fixture.source.sourceId } });
    const reserved = await db.payoutOffsetClaim.aggregate({
      where: { settlementRefundAdjustmentId: fixture.source.sourceId, status: 'RESERVED' },
      _sum: { reservedAmountMinor: true },
    });
    expect(adjustment.appliedAmountMinor + (reserved._sum.reservedAmountMinor ?? 0)).toBeLessThanOrEqual(880);
    expect(adjustment.originalAmountMinor).toBe(880);
  });
});
