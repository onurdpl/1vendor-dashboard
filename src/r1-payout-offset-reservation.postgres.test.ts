import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../backend/node_modules/@prisma/client/index.js';
import { POST_APPROVAL_REFUND_ADJUSTMENT_REQUIRED_REASON } from '../backend/src/modules/finance/refund-offset.service.js';

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
  let cancelSettlement: typeof import('../backend/src/modules/finance/settlement-approval.service.js')['cancelSettlementApproval'];
  let cancelPayout: typeof import('../backend/src/modules/finance/finance.service.js')['cancelPayoutBatch'];
  let markReview: typeof import('../backend/src/modules/finance/finance.service.js')['markPayoutBatchReview'];
  let markPaid: typeof import('../backend/src/modules/finance/finance.service.js')['markPayoutBatchPaid'];
  let approveSettlement: typeof import('../backend/src/modules/finance/settlement-approval.service.js')['approveSettlementApproval'];
  let preparePayout: typeof import('../backend/src/modules/finance/finance.service.js')['preparePayoutBatch'];
  let prepareR1Payout: typeof import('../backend/src/modules/finance/finance.service.js')['prepareR1PayoutBatch'];
  let markR1Review: typeof import('../backend/src/modules/finance/finance.service.js')['markR1PayoutBatchReview'];
  let markR1Paid: typeof import('../backend/src/modules/finance/finance.service.js')['markR1PayoutBatchPaid'];
  let completeR1Cashless: typeof import('../backend/src/modules/finance/finance.service.js')['completeR1CashlessPayout'];
  let getVendorDashboard: typeof import('../backend/src/modules/finance/finance.service.js')['getVendorFinanceDashboard'];
  let getAllocationSummary: typeof import('../backend/src/modules/finance/allocation-finance-summary.service.js')['getAllocationFinanceSummary'];
  let cancelR1Review: typeof import('../backend/src/modules/finance/finance.service.js')['cancelR1ReviewPayoutBeforeEft'];
  let classifyEftRefundTiming: typeof import('../backend/src/modules/finance/r1-eft-refund-timing.service.js')['classifyR1EftRefundTiming'];
  let cancelDraftWithClient: typeof import('../backend/src/modules/finance/finance.service.js')['cancelDraftPayoutBatchWithClient'];
  let cancelReviewWithClient: typeof import('../backend/src/modules/finance/finance.service.js')['cancelReviewPayoutBatchWithClient'];
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
    ({ approveSettlementApproval: approveSettlement } = await import('../backend/src/modules/finance/settlement-approval.service.js'));
    ({ preparePayoutBatch: preparePayout, prepareR1PayoutBatch: prepareR1Payout,
      markR1PayoutBatchReview: markR1Review, markR1PayoutBatchPaid: markR1Paid,
      completeR1CashlessPayout: completeR1Cashless,
      getVendorFinanceDashboard: getVendorDashboard,
      cancelR1ReviewPayoutBeforeEft: cancelR1Review } = await import('../backend/src/modules/finance/finance.service.js'));
    ({ classifyR1EftRefundTiming: classifyEftRefundTiming } = await import('../backend/src/modules/finance/r1-eft-refund-timing.service.js'));
    ({ getAllocationFinanceSummary: getAllocationSummary } = await import('../backend/src/modules/finance/allocation-finance-summary.service.js'));
    ({ createDraftApproval: createDraft, cancelSettlementApproval: cancelSettlement } =
      await import('../backend/src/modules/finance/settlement-approval.service.js'));
    ({ cancelPayoutBatch: cancelPayout, markPayoutBatchReview: markReview,
      markPayoutBatchPaid: markPaid, cancelDraftPayoutBatchWithClient: cancelDraftWithClient,
      cancelReviewPayoutBatchWithClient: cancelReviewWithClient } = await import('../backend/src/modules/finance/finance.service.js'));
  });

  afterAll(async () => {
    await db?.$disconnect();
    const { prisma } = await import('../backend/src/db/prisma.js');
    await prisma.$disconnect();
  });

  async function makeSale(vendorId: string, amountMinor: number, approvedAt: Date,
    commissionPercent = 10) {
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
      commissionPercentSnapshot: commissionPercent, commissionVatPercentSnapshot: 20,
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
    return { orderId, allocationId, saleId, approvalId, lineId, amountMinor, commissionPercent };
  }

  async function makeRefund(vendorId: string, sale: Awaited<ReturnType<typeof makeSale>>,
    refundMinor = 1000, kind: 'adjustment' | 'debt' = 'adjustment', client: typeof db = db) {
    const refundRecordId = next('refund-record');
    const refundLedgerId = next('refund-ledger');
    const sourceShopifyRefundId = `gid://shopify/Refund/${refundRecordId}`;
    const order = await client.shopifyOrder.findUniqueOrThrow({ where: { id: sale.orderId } });
    await client.refundRecord.create({ data: {
      id: refundRecordId, vendorAllocationId: sale.allocationId,
      sourceShopifyOrderId: order.sourceShopifyOrderId,
      sourceShopifyOrderNumber: order.sourceShopifyOrderNumber,
      sourceShopifyRefundId, amount: (refundMinor / 100).toFixed(2), status: 'processed',
    } });
    await client.financeLedgerEntry.create({ data: {
      id: refundLedgerId, vendorAllocationId: sale.allocationId, vendorId,
      entryType: 'refund', amount: (refundMinor / 100).toFixed(2),
      commissionPercentSnapshot: sale.commissionPercent, commissionVatPercentSnapshot: 20,
      payoutStatus: kind === 'adjustment' ? 'HOLD' : 'PENDING',
      settlementStatus: 'PARTIALLY_REFUNDED',
      settlementHoldReason: kind === 'adjustment'
        ? POST_APPROVAL_REFUND_ADJUSTMENT_REQUIRED_REASON : null,
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
    await client.refundEvidenceSnapshot.create({ data: {
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
      const adjustment = await createAdjustment(client, {
        refundFinanceLedgerEntryId: refundLedgerId, refundRecordId, createdBy: 'r1-phase2-test',
      });
      expect(adjustment).not.toBeNull();
      return { sourceType: 'REFUND_ADJUSTMENT' as const, sourceId: adjustment!.id,
      refundRecordId, refundLedgerId, amountMinor: adjustment!.originalAmountMinor };
    }
    await client.financeLedgerEntry.update({ where: { id: sale.saleId }, data: { payoutStatus: 'PAID' } });
    const paidBatchId = await makeBatch(vendorId, [sale]);
    await client.payoutBatch.update({ where: { id: paidBatchId }, data: {
      status: 'PAID', paidAt: new Date(), paymentReference: next('historical-payment'),
    } });
    const debtId = next('debt');
    await client.vendorBalanceEvent.create({ data: {
      id: debtId, vendorId, currency: 'TRY', type: 'VENDOR_DEBT_CREATED', amountMinor: -Math.round(refundMinor * (1 - sale.commissionPercent / 100 * 1.2)),
      sourceType: 'shopify_refund', sourceId: refundRecordId, financeLedgerEntryId: refundLedgerId,
      refundRecordId, idempotencyKey: next('debt-key'),
    } });
    return { sourceType: 'VENDOR_DEBT' as const, sourceId: debtId,
      refundRecordId, refundLedgerId, amountMinor: Math.round(refundMinor * (1 - sale.commissionPercent / 100 * 1.2)) };
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

  async function makeEligibleUnsettledSale(vendorId: string, amountMinor = 2000,
    commissionPercent = 10) {
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
      amount: (amountMinor / 100).toFixed(2), settlementDelayDaysSnapshot: 0,
      commissionPercentSnapshot: commissionPercent, commissionVatPercentSnapshot: 20,
      settlementStatus: 'PENDING', payoutStatus: 'PENDING',
    } });
    while (Date.now() <= observation.firstObservedDeliveredAt.getTime()) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    return { allocationId, saleId, observation, amountMinor };
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

  async function r1MonetaryFixture(capacityMinor = 100000, refundMinor = 20000,
    originalSaleMinor = 30000) {
    const vendorId = next('r1-monetary-vendor');
    await db.vendor.create({ data: { id: vendorId, name: vendorId } });
    const original = await makeSale(vendorId, originalSaleMinor, new Date('2026-01-01T00:00:00.000Z'), 0);
    const capacity = await makeEligibleUnsettledSale(vendorId, capacityMinor, 0);
    const draft = await createDraft({ vendorId, candidateScope: 'selected_allocations',
      selectedAllocationIds: [capacity.allocationId], asOfDate: new Date() });
    expect(draft.lines.map((line) => line.financeLedgerEntryId)).toEqual([capacity.saleId]);
    await approveSettlement(draft.id, 'r1-monetary-admin');
    const refund = await makeRefund(vendorId, original, refundMinor);
    const prepared = await prepareR1Payout({ vendorId }, 'r1-monetary-admin', next('request'));
    return { vendorId, original, capacity, refund, draft, prepared };
  }

  async function refundForEligibleSale(vendorId: string,
    sale: Awaited<ReturnType<typeof makeEligibleUnsettledSale>>, refundMinor: number) {
    const allocation = await db.vendorAllocation.findUniqueOrThrow({ where: { id: sale.allocationId } });
    return makeRefund(vendorId, {
      orderId: allocation.sourceShopifyOrderId, allocationId: sale.allocationId,
      saleId: sale.saleId, approvalId: '', lineId: '',
      amountMinor: sale.amountMinor, commissionPercent: 0,
    }, refundMinor);
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

  it('releases a DRAFT reservation atomically with exact actor and immutable audit, without changing money', async () => {
    const fixture = await baseFixture();
    const reserved = await reserve(fixture.input);
    const beforeAdjustment = await db.settlementRefundAdjustment.findUniqueOrThrow({ where: { id: fixture.source.sourceId } });
    const beforeBatch = await db.payoutBatch.findUniqueOrThrow({ where: { id: fixture.batchId } });
    await expect(markReview(fixture.batchId)).rejects.toThrow('R1_PAYOUT_RESERVED_CLAIMS_BLOCK_TRANSITION');
    expect((await db.payoutBatch.findUniqueOrThrow({ where: { id: fixture.batchId } })).status).toBe('DRAFT');

    const cancelled = await cancelPayout(fixture.batchId, 'r1-cancelling-admin');
    expect(cancelled.status).toBe('cancelled');
    const claim = await db.payoutOffsetClaim.findUniqueOrThrow({ where: { id: reserved.claims[0].id } });
    expect(claim).toMatchObject({ status: 'RELEASED', releasedBy: 'r1-cancelling-admin',
      reservedAmountMinor: 880, vendorId: fixture.vendorId, currency: 'TRY', payoutBatchId: fixture.batchId });
    expect(claim.releasedAt).toBeInstanceOf(Date);
    expect(await db.payoutOffsetClaimEvent.findMany({ where: { payoutOffsetClaimId: claim.id },
      orderBy: { occurredAt: 'asc' }, select: { eventType: true, actorId: true, occurredAt: true } }))
      .toEqual([{ eventType: 'RESERVED', actorId: fixture.input.actorId, occurredAt: claim.reservedAt },
        { eventType: 'RELEASED', actorId: 'r1-cancelling-admin', occurredAt: claim.releasedAt }]);
    expect(await db.settlementRefundAdjustment.findUniqueOrThrow({ where: { id: fixture.source.sourceId } }))
      .toEqual(beforeAdjustment);
    const afterBatch = await db.payoutBatch.findUniqueOrThrow({ where: { id: fixture.batchId } });
    expect(afterBatch.netAmount).toEqual(beforeBatch.netAmount);
    expect(afterBatch.paidAt).toBeNull();
    expect(afterBatch.paymentReference).toBeNull();
    expect((await reconcile({ vendorId: fixture.vendorId, currency: 'TRY' })).sources[0])
      .toMatchObject({ activeReservationMinor: 0, unreservedAmountMinor: 880 });
    await expect(cancelPayout(fixture.batchId, 'r1-cancelling-admin'))
      .rejects.toThrow('Payout batch could not be cancelled because its status changed.');
    expect(await db.payoutOffsetClaimEvent.count({ where: { payoutOffsetClaimId: claim.id } })).toBe(2);

    const replacementBatchId = await makeBatch(fixture.vendorId, [fixture.capacity]);
    const replacement = await reserve({ ...fixture.input, payoutBatchId: replacementBatchId,
      requestId: next('replacement-request') });
    expect(replacement.claims.map((item) => item.reservedAmountMinor)).toEqual([880]);
  });

  it('rolls back DRAFT cancellation if a reserved claim cannot be released', async () => {
    const fixture = await baseFixture();
    const reserved = await reserve(fixture.input);
    await expect(cancelPayout(fixture.batchId)).rejects.toThrow('R1_PAYOUT_CLAIM_RELEASE_NOT_AUTHORIZED');
    expect((await db.payoutBatch.findUniqueOrThrow({ where: { id: fixture.batchId } })).status).toBe('DRAFT');
    expect((await db.payoutOffsetClaim.findUniqueOrThrow({ where: { id: reserved.claims[0].id } })).status)
      .toBe('RESERVED');
    expect(await db.payoutOffsetClaimEvent.count({ where: { payoutOffsetClaimId: reserved.claims[0].id } })).toBe(1);
  });

  it('releases claims in the existing Financial Correction DRAFT cancellation transaction', async () => {
    const fixture = await baseFixture();
    const reserved = await reserve(fixture.input);
    const cancelledAt = new Date();
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Vendor" WHERE "id" = ${fixture.vendorId} FOR UPDATE`;
      await cancelDraftWithClient(tx, fixture.batchId, cancelledAt, 'r1-correction-admin');
    });
    expect((await db.payoutBatch.findUniqueOrThrow({ where: { id: fixture.batchId } })).status).toBe('CANCELLED');
    expect(await db.payoutOffsetClaim.findUniqueOrThrow({ where: { id: reserved.claims[0].id } }))
      .toMatchObject({ status: 'RELEASED', releasedBy: 'r1-correction-admin', releasedAt: cancelledAt });
  });

  it('never releases a FINALIZED claim or cancels its DRAFT payout', async () => {
    const fixture = await baseFixture();
    const reserved = await reserve(fixture.input);
    await db.payoutOffsetClaim.update({ where: { id: reserved.claims[0].id }, data: {
      status: 'FINALIZED', finalizedBy: 'r1-test-finalizer', finalizedAt: new Date(),
    } });
    await expect(cancelPayout(fixture.batchId, 'r1-cancelling-admin'))
      .rejects.toThrow('R1_PAYOUT_CLAIM_RELEASE_NOT_AUTHORIZED');
    expect((await db.payoutBatch.findUniqueOrThrow({ where: { id: fixture.batchId } })).status).toBe('DRAFT');
    expect((await db.payoutOffsetClaim.findUniqueOrThrow({ where: { id: reserved.claims[0].id } })).status)
      .toBe('FINALIZED');
  });

  it('rejects unsupported REVIEW payment with an active claim and preserves PAID protections', async () => {
    const fixture = await baseFixture();
    await reserve(fixture.input);
    // A legacy/manual status mutation is deliberately simulated; the live REVIEW service rejects it above.
    await db.payoutBatch.update({ where: { id: fixture.batchId }, data: { status: 'REVIEW' } });
    await expect(markPaid(fixture.batchId, { paidAt: new Date().toISOString() }, 'r1-paying-admin'))
      .rejects.toThrow('R1_PAYOUT_RESERVED_CLAIMS_BLOCK_TRANSITION');
    await expect(cancelPayout(fixture.batchId, 'r1-cancelling-admin'))
      .rejects.toThrow('REVIEW_GENERAL_CANCELLATION_FORBIDDEN');
    await expect(db.$transaction((tx) => cancelReviewWithClient(tx, fixture.batchId, new Date())))
      .rejects.toThrow('R1_PAYOUT_RESERVED_CLAIMS_BLOCK_TRANSITION');
    const batch = await db.payoutBatch.findUniqueOrThrow({ where: { id: fixture.batchId } });
    expect(batch.status).toBe('REVIEW');
    expect(batch.paidAt).toBeNull();
    expect((await db.payoutOffsetClaim.findMany({ where: { payoutBatchId: fixture.batchId } }))
      .map((claim) => claim.status)).toEqual(['RESERVED']);
  });

  it('serializes concurrent DRAFT cancellation and reservation without stranded active claims', async () => {
    const fixture = await baseFixture();
    const outcomes = await Promise.allSettled([
      reserve(fixture.input), cancelPayout(fixture.batchId, 'r1-cancelling-admin'),
    ]);
    expect(outcomes[1].status).toBe('fulfilled');
    expect((await db.payoutBatch.findUniqueOrThrow({ where: { id: fixture.batchId } })).status).toBe('CANCELLED');
    expect(await db.payoutOffsetClaim.count({ where: { payoutBatchId: fixture.batchId, status: 'RESERVED' } }))
      .toBe(0);
  });

  it('makes a released adjustment slice available to settlement only once', async () => {
    const fixture = await baseFixture();
    const reserved = await reserve(fixture.input);
    await cancelPayout(fixture.batchId, 'r1-cancelling-admin');
    const future = await makeEligibleUnsettledSale(fixture.vendorId);
    const draft = await createDraft({ vendorId: fixture.vendorId, candidateScope: 'selected_allocations',
      selectedAllocationIds: [future.allocationId], asOfDate: new Date() });
    expect(draft.lines.some((line) => line.financeLedgerEntryId === future.saleId)).toBe(true);
    const applications = await db.settlementRefundAdjustmentApplication.findMany({
      where: { settlementApprovalId: draft.id, settlementRefundAdjustmentId: fixture.source.sourceId,
        status: 'ACTIVE' },
    });
    expect(applications.map((application) => application.amountMinor)).toEqual([880]);
    expect((await db.payoutOffsetClaim.findUniqueOrThrow({ where: { id: reserved.claims[0].id } })).status)
      .toBe('RELEASED');
    expect((await reconcile({ vendorId: fixture.vendorId, currency: 'TRY' })).sources[0])
      .toMatchObject({ originalAmountMinor: 880, remainingAmountMinor: 0, activeReservationMinor: 0 });
  });

  it('persists the Admin-attested bank EFT instant separately from Mark Paid request time', async () => {
    const vendorId = next('eft-vendor');
    await db.vendor.create({ data: { id: vendorId, name: vendorId } });
    const sale = await makeEligibleUnsettledSale(vendorId);
    const draft = await createDraft({ vendorId, candidateScope: 'selected_allocations',
      selectedAllocationIds: [sale.allocationId], asOfDate: new Date() });
    expect(draft.lines.map((line) => line.financeLedgerEntryId)).toEqual([sale.saleId]);
    await approveSettlement(draft.id, 'r1-eft-admin');
    const payout = await preparePayout({ vendorId }, 'r1-eft-admin');
    await markReview(payout.id);
    const declared = new Date(Date.now() - 1_000).toISOString().replace('Z', '+00:00');
    const requestTime = new Date().toISOString();
    const paid = await markPaid(payout.id, { paidAt: requestTime,
      eftDeclaredAt: declared, paymentReference: 'TEST-BANK-REF' }, 'r1-eft-admin');
    const persisted = await db.payoutBatch.findUniqueOrThrow({ where: { id: payout.id } });
    expect(paid.status).toBe('paid');
    expect(persisted).toMatchObject({
      status: 'PAID', paidAt: new Date(requestTime), paidByUserId: 'r1-eft-admin',
      eftExecutedAt: new Date(declared), eftDeclaredAt: declared,
      eftAttestedByUserId: 'r1-eft-admin', paymentReference: 'TEST-BANK-REF',
    });
    expect(persisted.eftAttestedAt).toBeInstanceOf(Date);
    expect(persisted.eftAttestedAt!.getTime()).toBeGreaterThanOrEqual(persisted.eftExecutedAt!.getTime());
    expect(persisted.eftExecutedAt).not.toEqual(persisted.paidAt);
    expect(Number(persisted.netAmount)).toBe(Number(payout.netAmount));
    expect(await db.payoutOffsetClaim.count({ where: { payoutBatchId: payout.id } })).toBe(0);
    await expect(db.payoutBatch.update({ where: { id: payout.id }, data: {
      eftExecutedAt: new Date(persisted.eftExecutedAt!.getTime() - 1_000),
    } })).rejects.toThrow('Payout EFT attestation is immutable');
  });

  it('prepares 1000 approved payable with exact 200 refund offset and finalizes 800 actual EFT once', async () => {
    const { capacity, refund, prepared } = await r1MonetaryFixture();
    expect(refund.amountMinor).toBe(20000);
    expect(prepared).toMatchObject({ approvedBaseMinor: 100000, offsetMinor: 20000,
      netCashMinor: 80000 });
    expect(prepared.claims).toHaveLength(1);
    expect(prepared.claims[0]).toMatchObject({ sourceType: 'REFUND_ADJUSTMENT',
      settlementRefundAdjustmentId: refund.sourceId, reservedAmountMinor: 20000 });
    const review = await markR1Review(prepared.payoutBatchId);
    expect(review.status).toBe('review');
    const declared = new Date(Date.now() - 1_000).toISOString().replace('Z', '+00:00');
    const paid = await markR1Paid(prepared.payoutBatchId, {
      paidAt: new Date().toISOString(), eftDeclaredAt: declared,
      paymentReference: next('bank-reference'),
    }, 'r1-monetary-admin', 80000);
    expect(paid.status).toBe('paid');
    const [batch, claim, adjustment] = await Promise.all([
      db.payoutBatch.findUniqueOrThrow({ where: { id: prepared.payoutBatchId }, include: { lines: true } }),
      db.payoutOffsetClaim.findUniqueOrThrow({ where: { id: prepared.claims[0].id }, include: { events: true } }),
      db.settlementRefundAdjustment.findUniqueOrThrow({ where: { id: refund.sourceId } }),
    ]);
    expect(batch).toMatchObject({ status: 'PAID', r1OffsetTotalMinor: 20000,
      eftAmountMinor: 80000 });
    expect(Number(batch.netAmount)).toBe(800);
    expect(batch.lines.map((line) => line.financeLedgerEntryId)).toEqual([capacity.saleId]);
    expect(claim.status).toBe('FINALIZED');
    expect(claim.events.map((event) => event.eventType)).toEqual(['RESERVED', 'FINALIZED']);
    expect(adjustment).toMatchObject({ appliedAmountMinor: 20000, remainingAmountMinor: 0,
      status: 'APPLIED' });
    await expect(markR1Paid(prepared.payoutBatchId, {
      paidAt: new Date().toISOString(), eftDeclaredAt: declared,
    }, 'r1-monetary-admin', 80000)).rejects.toThrow();
  });

  it('finalizes separate exact refund adjustment and paid-sale debt without aggregate duplication', async () => {
    const vendorId = next('mixed-vendor');
    await db.vendor.create({ data: { id: vendorId, name: vendorId } });
    const historicalDebtSale = await makeSale(vendorId, 10000,
      new Date('2026-01-01T00:00:00.000Z'), 0);
    const historicalAdjustmentSale = await makeSale(vendorId, 10000,
      new Date('2026-01-02T00:00:00.000Z'), 0);
    const capacity = await makeEligibleUnsettledSale(vendorId, 30000, 0);
    const draft = await createDraft({ vendorId, candidateScope: 'selected_allocations',
      selectedAllocationIds: [capacity.allocationId], asOfDate: new Date() });
    expect(draft.lines.map((line) => line.financeLedgerEntryId)).toEqual([capacity.saleId]);
    await approveSettlement(draft.id, 'r1-mixed-admin');
    const debt = await makeRefund(vendorId, historicalDebtSale, 10000, 'debt');
    const adjustment = await makeRefund(vendorId, historicalAdjustmentSale, 5000);
    const prepared = await prepareR1Payout({ vendorId }, 'r1-mixed-admin', next('mixed-request'));
    expect(prepared).toMatchObject({ approvedBaseMinor: 30000, offsetMinor: 15000,
      netCashMinor: 15000 });
    expect(prepared.claims.map((claim) => [claim.sourceType, claim.reservedAmountMinor]).sort())
      .toEqual([['REFUND_ADJUSTMENT', 5000], ['VENDOR_DEBT', 10000]].sort());
    await markR1Review(prepared.payoutBatchId);
    const eftAt = new Date(Date.now() - 1000);
    await markR1Paid(prepared.payoutBatchId, {
      paidAt: new Date().toISOString(), eftDeclaredAt: eftAt.toISOString(),
      paymentReference: next('mixed-bank-reference'),
    }, 'r1-mixed-admin', 15000);
    const [batch, adjustmentAfter, debtOffset, debtClaim] = await Promise.all([
      db.payoutBatch.findUniqueOrThrow({ where: { id: prepared.payoutBatchId } }),
      db.settlementRefundAdjustment.findUniqueOrThrow({ where: { id: adjustment.sourceId } }),
      db.vendorBalanceEvent.findMany({ where: { payoutBatchId: prepared.payoutBatchId,
        type: 'VENDOR_DEBT_OFFSET' } }),
      db.payoutOffsetClaim.findFirstOrThrow({ where: { payoutBatchId: prepared.payoutBatchId,
        sourceType: 'VENDOR_DEBT' } }),
    ]);
    expect(batch).toMatchObject({ status: 'PAID', eftAmountMinor: 15000,
      r1OffsetTotalMinor: 15000 });
    expect(adjustmentAfter).toMatchObject({ appliedAmountMinor: 5000,
      remainingAmountMinor: 0, status: 'APPLIED' });
    expect(debtOffset).toHaveLength(1);
    expect(debtOffset[0]).toMatchObject({ amountMinor: 10000,
      sourceType: 'r1_payout_offset_claim', sourceId: debtClaim.id });
    expect(debtClaim).toMatchObject({ status: 'FINALIZED',
      vendorDebtOriginEventId: debt.sourceId });
  });

  it('rolls back adjustment consumption and Mark Paid when exact claim finalization fails', async () => {
    const { refund, prepared } = await r1MonetaryFixture();
    await markR1Review(prepared.payoutBatchId);
    await db.$executeRawUnsafe(`CREATE FUNCTION "r1_test_fail_finalization"() RETURNS trigger AS $$
      BEGIN IF NEW."status" = 'FINALIZED' THEN
        RAISE EXCEPTION 'TEST_R1_FINALIZATION_FAILURE';
      END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
    await db.$executeRawUnsafe(`CREATE TRIGGER "r1_test_fail_finalization_trigger"
      BEFORE UPDATE ON "PayoutOffsetClaim" FOR EACH ROW
      EXECUTE FUNCTION "r1_test_fail_finalization"()`);
    try {
      const eftAt = new Date(Date.now() - 1000);
      await expect(markR1Paid(prepared.payoutBatchId, {
        paidAt: new Date().toISOString(), eftDeclaredAt: eftAt.toISOString(),
        paymentReference: next('rollback-bank-reference'),
      }, 'r1-monetary-admin', 80000)).rejects.toThrow('TEST_R1_FINALIZATION_FAILURE');
      const [batch, claim, adjustment] = await Promise.all([
        db.payoutBatch.findUniqueOrThrow({ where: { id: prepared.payoutBatchId } }),
        db.payoutOffsetClaim.findUniqueOrThrow({ where: { id: prepared.claims[0].id } }),
        db.settlementRefundAdjustment.findUniqueOrThrow({ where: { id: refund.sourceId } }),
      ]);
      expect(batch).toMatchObject({ status: 'REVIEW', paidAt: null, eftAmountMinor: null });
      expect(claim.status).toBe('RESERVED');
      expect(adjustment).toMatchObject({ status: 'PENDING', appliedAmountMinor: 0,
        remainingAmountMinor: 20000 });
    } finally {
      await db.$executeRawUnsafe('DROP TRIGGER "r1_test_fail_finalization_trigger" ON "PayoutOffsetClaim"');
      await db.$executeRawUnsafe('DROP FUNCTION "r1_test_fail_finalization"()');
    }
  });

  it('finalizes an exact R1 claim once under two concurrent Mark Paid attempts', async () => {
    const { refund, prepared } = await r1MonetaryFixture();
    await markR1Review(prepared.payoutBatchId);
    const eftAt = new Date(Date.now() - 1000);
    const input = { paidAt: new Date().toISOString(), eftDeclaredAt: eftAt.toISOString(),
      paymentReference: next('concurrent-bank-reference') };
    const outcomes = await Promise.allSettled([
      markR1Paid(prepared.payoutBatchId, input, 'r1-monetary-admin', 80000),
      markR1Paid(prepared.payoutBatchId, input, 'r1-monetary-admin', 80000),
    ]);
    expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const [batch, claim, adjustment, events] = await Promise.all([
      db.payoutBatch.findUniqueOrThrow({ where: { id: prepared.payoutBatchId } }),
      db.payoutOffsetClaim.findUniqueOrThrow({ where: { id: prepared.claims[0].id } }),
      db.settlementRefundAdjustment.findUniqueOrThrow({ where: { id: refund.sourceId } }),
      db.settlementRefundAdjustmentEvent.findMany({ where: {
        settlementRefundAdjustmentId: refund.sourceId,
        eventType: 'APPLIED',
      } }),
    ]);
    expect(batch).toMatchObject({ status: 'PAID', eftAmountMinor: 80000 });
    expect(claim.status).toBe('FINALIZED');
    expect(adjustment).toMatchObject({ appliedAmountMinor: 20000,
      remainingAmountMinor: 0 });
    expect(events.filter((event) => (event.metadataJson as { route?: string })?.route ===
      'R1_PAYOUT_OFFSET')).toHaveLength(1);
  });

  it('records an already sent 800 EFT while retaining an exact later 100 refund obligation', async () => {
    const { vendorId, capacity, prepared } = await r1MonetaryFixture();
    await markR1Review(prepared.payoutBatchId);
    const eftExecutedAt = new Date();
    while (Date.now() <= eftExecutedAt.getTime()) await new Promise((resolve) => setTimeout(resolve, 1));
    const missed = await refundForEligibleSale(vendorId, capacity, 10000);
    expect(missed.amountMinor).toBe(10000);
    const paid = await markR1Paid(prepared.payoutBatchId, {
      paidAt: new Date().toISOString(), eftDeclaredAt: eftExecutedAt.toISOString(),
      paymentReference: next('sent-bank-reference'),
    }, 'r1-monetary-admin', 80000);
    expect(paid.status).toBe('paid');
    const [batch, lateAdjustment, evidence, missedAudit, claim] = await Promise.all([
      db.payoutBatch.findUniqueOrThrow({ where: { id: prepared.payoutBatchId } }),
      db.settlementRefundAdjustment.findUniqueOrThrow({ where: { id: missed.sourceId } }),
      db.refundEvidenceSnapshot.findUniqueOrThrow({ where: { refundFinanceLedgerEntryId: missed.refundLedgerId } }),
      db.payoutR1MissedRefundReconciliation.findUniqueOrThrow({ where: {
        payoutBatchId_refundFinanceLedgerEntryId: {
          payoutBatchId: prepared.payoutBatchId, refundFinanceLedgerEntryId: missed.refundLedgerId,
        },
      } }),
      db.payoutOffsetClaim.findUniqueOrThrow({ where: { id: prepared.claims[0].id } }),
    ]);
    expect(batch).toMatchObject({ status: 'PAID', eftAmountMinor: 80000, r1OffsetTotalMinor: 20000 });
    expect(Number(batch.netAmount)).toBe(800);
    expect(evidence.capturedAt.getTime()).toBeGreaterThan(eftExecutedAt.getTime());
    expect(lateAdjustment).toMatchObject({ status: 'PENDING', appliedAmountMinor: 0,
      remainingAmountMinor: 10000 });
    expect(missedAudit).toMatchObject({ vendorId, refundFinanceLedgerEntryId: missed.refundLedgerId,
      settlementRefundAdjustmentId: missed.sourceId, outstandingAmountMinor: 10000,
      eftExecutedAt });
    expect(claim.status).toBe('FINALIZED');
    expect(await db.vendorBalanceEvent.count({ where: { financeLedgerEntryId: missed.refundLedgerId,
      type: 'VENDOR_DEBT_OFFSET' } })).toBe(0);
  });

  it('records the actual sent EFT even when a later accepted refund preceded that EFT', async () => {
    const { vendorId, capacity, prepared } = await r1MonetaryFixture();
    await markR1Review(prepared.payoutBatchId);
    const missed = await refundForEligibleSale(vendorId, capacity, 10000);
    const evidence = await db.refundEvidenceSnapshot.findUniqueOrThrow({
      where: { refundFinanceLedgerEntryId: missed.refundLedgerId },
    });
    while (Date.now() <= evidence.capturedAt.getTime()) await new Promise((resolve) => setTimeout(resolve, 1));
    const eftExecutedAt = new Date();
    const paid = await markR1Paid(prepared.payoutBatchId, {
      paidAt: new Date().toISOString(), eftDeclaredAt: eftExecutedAt.toISOString(),
      paymentReference: next('already-sent-bank-reference'),
    }, 'r1-monetary-admin', 80000);
    expect(paid.status).toBe('paid');
    const [batch, adjustment, audit] = await Promise.all([
      db.payoutBatch.findUniqueOrThrow({ where: { id: prepared.payoutBatchId } }),
      db.settlementRefundAdjustment.findUniqueOrThrow({ where: { id: missed.sourceId } }),
      db.payoutR1MissedRefundReconciliation.findUniqueOrThrow({ where: {
        payoutBatchId_refundFinanceLedgerEntryId: {
          payoutBatchId: prepared.payoutBatchId, refundFinanceLedgerEntryId: missed.refundLedgerId,
        },
      } }),
    ]);
    expect(evidence.capturedAt.getTime()).toBeLessThan(eftExecutedAt.getTime());
    expect(batch.eftAmountMinor).toBe(80000);
    expect(Number(batch.netAmount)).toBe(800);
    expect(adjustment).toMatchObject({ status: 'PENDING', appliedAmountMinor: 0,
      remainingAmountMinor: 10000 });
    expect(audit).toMatchObject({ acceptedAt: evidence.capturedAt,
      eftExecutedAt, outstandingAmountMinor: 10000 });
  });

  it('requires active Admin unsent-EFT attestation before REVIEW cancellation and releases exact claims', async () => {
    const { vendorId, refund, prepared } = await r1MonetaryFixture();
    const adminId = next('admin');
    await db.user.create({ data: { id: adminId, email: `${adminId}@example.test`,
      name: 'R1 test admin', role: 'ADMIN', status: 'active', passwordHash: 'test-only' } });
    await markR1Review(prepared.payoutBatchId);
    await expect(cancelR1Review({ payoutBatchId: prepared.payoutBatchId, actorUserId: adminId,
      reason: 'Verified no bank transfer was sent', confirmEftNotSent: false,
    })).rejects.toThrow('R1_REVIEW_EFT_NOT_SENT_ATTESTATION_REQUIRED');
    expect(await db.payoutR1ReviewCancellationAttestation.count({ where: {
      payoutBatchId: prepared.payoutBatchId,
    } })).toBe(0);
    const cancelled = await cancelR1Review({ payoutBatchId: prepared.payoutBatchId,
      actorUserId: adminId, reason: 'Verified no bank transfer was sent', confirmEftNotSent: true });
    expect(cancelled.status).toBe('cancelled');
    const [batch, claim, adjustment, attestation] = await Promise.all([
      db.payoutBatch.findUniqueOrThrow({ where: { id: prepared.payoutBatchId } }),
      db.payoutOffsetClaim.findUniqueOrThrow({ where: { id: prepared.claims[0].id }, include: { events: true } }),
      db.settlementRefundAdjustment.findUniqueOrThrow({ where: { id: refund.sourceId } }),
      db.payoutR1ReviewCancellationAttestation.findUniqueOrThrow({ where: {
        payoutBatchId: prepared.payoutBatchId,
      } }),
    ]);
    expect(batch).toMatchObject({ status: 'CANCELLED', paidAt: null, eftExecutedAt: null });
    expect(claim.status).toBe('RELEASED');
    expect(claim.events.map((event) => event.eventType)).toEqual(['RESERVED', 'RELEASED']);
    expect(adjustment).toMatchObject({ status: 'PENDING', appliedAmountMinor: 0,
      remainingAmountMinor: 20000 });
    expect(attestation).toMatchObject({ actorUserId: adminId,
      frozenNetMinor: 80000, frozenOffsetMinor: 20000, confirmedEftNotSent: true });
    await expect(db.payoutR1ReviewCancellationAttestation.update({ where: { id: attestation.id },
      data: { reason: 'rewritten' } })).rejects.toThrow('immutable');
    await expect(cancelR1Review({ payoutBatchId: prepared.payoutBatchId, actorUserId: adminId,
      reason: 'retry', confirmEftNotSent: true })).rejects.toThrow();
    const reprepared = await prepareR1Payout({ vendorId }, adminId, next('reprepare-request'));
    expect(reprepared).toMatchObject({ approvedBaseMinor: 100000, offsetMinor: 20000,
      netCashMinor: 80000 });
    expect(reprepared.payoutBatchId).not.toBe(prepared.payoutBatchId);
  });

  it('reprepares an unsent REVIEW payout with a newly accepted exact refund', async () => {
    const { vendorId, capacity, prepared } = await r1MonetaryFixture();
    const adminId = next('reprepare-admin');
    await db.user.create({ data: { id: adminId, email: `${adminId}@example.test`,
      name: 'R1 reprepare admin', role: 'ADMIN', status: 'active', passwordHash: 'test-only' } });
    await markR1Review(prepared.payoutBatchId);
    const newRefund = await refundForEligibleSale(vendorId, capacity, 10000);
    const cancelled = await cancelR1Review({ payoutBatchId: prepared.payoutBatchId,
      actorUserId: adminId, reason: 'EFT not sent; exact new refund accepted',
      confirmEftNotSent: true });
    expect(cancelled.status).toBe('cancelled');
    const rebuilt = await prepareR1Payout({ vendorId }, adminId, next('reprepare-request'));
    expect(rebuilt).toMatchObject({ approvedBaseMinor: 100000, offsetMinor: 30000,
      netCashMinor: 70000 });
    expect(rebuilt.claims.map((claim) => claim.settlementRefundAdjustmentId).sort()).toEqual([
      prepared.claims[0].settlementRefundAdjustmentId, newRefund.sourceId,
    ].sort());
    await markR1Review(rebuilt.payoutBatchId);
    const newEvidence = await db.refundEvidenceSnapshot.findUniqueOrThrow({
      where: { refundFinanceLedgerEntryId: newRefund.refundLedgerId },
    });
    while (Date.now() <= newEvidence.capturedAt.getTime()) await new Promise((resolve) => setTimeout(resolve, 1));
    const actualEftAt = new Date();
    const paid = await markR1Paid(rebuilt.payoutBatchId, {
      paidAt: actualEftAt.toISOString(), eftDeclaredAt: actualEftAt.toISOString(),
      paymentReference: next('reprepared-bank-reference'),
    }, adminId, 70000);
    expect(paid.status).toBe('paid');
    const [newAdjustment, originalAdjustment, priorBatch, newBatch] = await Promise.all([
      db.settlementRefundAdjustment.findUniqueOrThrow({ where: { id: newRefund.sourceId } }),
      db.settlementRefundAdjustment.findUniqueOrThrow({ where: {
        id: prepared.claims[0].settlementRefundAdjustmentId!,
      } }),
      db.payoutBatch.findUniqueOrThrow({ where: { id: prepared.payoutBatchId } }),
      db.payoutBatch.findUniqueOrThrow({ where: { id: rebuilt.payoutBatchId } }),
    ]);
    expect(newAdjustment).toMatchObject({ appliedAmountMinor: 10000, remainingAmountMinor: 0 });
    expect(originalAdjustment).toMatchObject({ appliedAmountMinor: 20000, remainingAmountMinor: 0 });
    expect(priorBatch.status).toBe('CANCELLED');
    expect(newBatch).toMatchObject({ status: 'PAID', eftAmountMinor: 70000,
      r1OffsetTotalMinor: 30000 });
  });

  it('retains exact zero-net R1 claims without fabricating an EFT or Mark Paid', async () => {
    const { refund, prepared } = await r1MonetaryFixture(30000, 30000);
    expect(prepared).toMatchObject({ approvedBaseMinor: 30000,
      offsetMinor: 30000, netCashMinor: 0 });
    await markR1Review(prepared.payoutBatchId);
    const eftAt = new Date();
    await expect(markR1Paid(prepared.payoutBatchId, {
      paidAt: eftAt.toISOString(), eftDeclaredAt: eftAt.toISOString(),
      paymentReference: next('invalid-zero-eft'),
    }, 'r1-monetary-admin', 0)).rejects.toThrow();
    const [batch, adjustment, claim] = await Promise.all([
      db.payoutBatch.findUniqueOrThrow({ where: { id: prepared.payoutBatchId } }),
      db.settlementRefundAdjustment.findUniqueOrThrow({ where: { id: refund.sourceId } }),
      db.payoutOffsetClaim.findUniqueOrThrow({ where: { id: prepared.claims[0].id } }),
    ]);
    expect(batch).toMatchObject({ status: 'REVIEW', paidAt: null, eftExecutedAt: null,
      eftAmountMinor: null, r1OffsetTotalMinor: 30000 });
    expect(Number(batch.netAmount)).toBe(0);
    expect(adjustment).toMatchObject({ status: 'PENDING', appliedAmountMinor: 0,
      remainingAmountMinor: 30000 });
    expect(claim.status).toBe('RESERVED');
  });

  it('cashlessly completes 440 of an 880 refund, retains 440, and never fabricates EFT payment', async () => {
    const { vendorId, capacity, refund, draft, prepared } = await r1MonetaryFixture(440, 880, 1000);
    expect(prepared).toMatchObject({ approvedBaseMinor: 440, offsetMinor: 440, netCashMinor: 0 });
    const actorUserId = next('cashless-admin');
    await db.user.create({ data: { id: actorUserId, email: `${actorUserId}@example.test`,
      name: 'Cashless test admin', role: 'ADMIN', status: 'active', passwordHash: 'test-only' } });
    await markR1Review(prepared.payoutBatchId);
    const input = { payoutBatchId: prepared.payoutBatchId, actorUserId,
      reason: 'Verified exact zero-net offset; no EFT sent', confirmCashlessCompletion: true,
      confirmEftNotSent: true };
    const completed = await completeR1Cashless(input);
    expect(completed).toMatchObject({ status: 'cashless_completed', paidAt: null,
      paidByUserId: null, paymentReference: null, eftExecutedAt: null,
      netAmount: '0.00' });
    const [batch, audit, claim, adjustment, ledger, originalApproval] = await Promise.all([
      db.payoutBatch.findUniqueOrThrow({ where: { id: prepared.payoutBatchId } }),
      db.payoutR1CashlessCompletion.findUniqueOrThrow({ where: { payoutBatchId: prepared.payoutBatchId } }),
      db.payoutOffsetClaim.findUniqueOrThrow({ where: { id: prepared.claims[0].id }, include: { events: true } }),
      db.settlementRefundAdjustment.findUniqueOrThrow({ where: { id: refund.sourceId } }),
      db.financeLedgerEntry.findUniqueOrThrow({ where: { id: capacity.saleId } }),
      db.settlementApproval.findUniqueOrThrow({ where: { id: draft.id } }),
    ]);
    expect(audit).toMatchObject({ actorUserId, confirmedNoEft: true, confirmedNetMinor: 0,
      finalizedOffsetMinor: 440, claimIdsJson: [claim.id] });
    expect(batch).toMatchObject({ status: 'CASHLESS_COMPLETED', eftAmountMinor: null,
      eftExecutedAt: null, paidAt: null, paymentReference: null });
    expect(claim).toMatchObject({ status: 'FINALIZED', finalizedBy: actorUserId });
    expect(claim.events.map((event) => event.eventType)).toEqual(['RESERVED', 'FINALIZED']);
    expect(adjustment).toMatchObject({ status: 'PARTIALLY_APPLIED', appliedAmountMinor: 440,
      remainingAmountMinor: 440 });
    expect(ledger).toMatchObject({ payoutStatus: 'CASHLESS_COMPLETED',
      settlementStatus: 'CASHLESS_COMPLETED', settledAt: null });
    expect(originalApproval).toMatchObject({ status: 'APPROVED', netPayableMinor: 440 });
    const dashboard = await getVendorDashboard(vendorId);
    expect(dashboard.records.find((record) => record.id === capacity.saleId))
      .toMatchObject({ payoutStatus: 'cashless_completed',
        settlement: { status: 'cashless_completed', settledAt: null },
        payoutBatch: { id: prepared.payoutBatchId, status: 'cashless_completed', paidAt: null } });
    const allocationSummary = await getAllocationSummary({
      vendorAllocationId: capacity.allocationId, expectedVendorId: vendorId, db: db as never,
    });
    expect(allocationSummary).toMatchObject({ payoutStatus: 'cashless_completed',
      settlementStatus: 'cashless_completed', paidAt: null,
      primaryPayable: { type: 'cashless_offset_contribution', amount: '4.40' } });
    expect(await db.financeEvent.count({ where: { referenceId: prepared.payoutBatchId,
      eventType: 'PAYOUT_PAID' } })).toBe(0);
    await expect(cancelPayout(prepared.payoutBatchId, actorUserId))
      .rejects.toThrow('Cashless completed payout batches cannot be cancelled.');
    await expect(cancelSettlement(draft.id, actorUserId))
      .rejects.toThrow('linked to a cashless completed payout batch');
    await expect(completeR1Cashless(input)).rejects.toThrow();
    await expect(prepareR1Payout({ vendorId }, actorUserId, next('duplicate-cashless-source'))).rejects.toThrow();

    const nextCapacity = await makeEligibleUnsettledSale(vendorId, 440, 0);
    const nextDraft = await createDraft({ vendorId, candidateScope: 'selected_allocations',
      selectedAllocationIds: [nextCapacity.allocationId], asOfDate: new Date() });
    expect(nextDraft.lines).toHaveLength(2);
    expect(nextDraft.lines.map((line) => [line.lineType, line.financeLedgerEntryId, line.payableImpactMinor]))
      .toEqual(expect.arrayContaining([
        ['SALE', nextCapacity.saleId, 440], ['REFUND_ADJUSTMENT', refund.refundLedgerId, -440],
      ]));
    await approveSettlement(nextDraft.id, actorUserId);
    const [fullyApplied, applications, claims, sourceDiagnostic, approvedNext] = await Promise.all([
      db.settlementRefundAdjustment.findUniqueOrThrow({ where: { id: refund.sourceId } }),
      db.settlementRefundAdjustmentApplication.findMany({ where: { settlementRefundAdjustmentId: refund.sourceId } }),
      db.payoutOffsetClaim.findMany({ where: { settlementRefundAdjustmentId: refund.sourceId } }),
      reconcile({ vendorId, currency: 'TRY' }),
      db.settlementApproval.findUniqueOrThrow({ where: { id: nextDraft.id } }),
    ]);
    expect(approvedNext).toMatchObject({ status: 'APPROVED', netPayableMinor: 0 });
    expect(fullyApplied).toMatchObject({ status: 'APPLIED', originalAmountMinor: 880,
      appliedAmountMinor: 880, remainingAmountMinor: 0 });
    expect(applications.filter((application) => application.status === 'ACTIVE'))
      .toMatchObject([{ settlementApprovalId: nextDraft.id, amountMinor: 440 }]);
    expect(claims).toMatchObject([{ id: claim.id, status: 'FINALIZED', reservedAmountMinor: 440 }]);
    expect(sourceDiagnostic.sources.find((source) => source.sourceId === refund.sourceId))
      .toMatchObject({ status: 'VERIFIED', appliedAmountMinor: 880,
        remainingAmountMinor: 0, activeReservationMinor: 0, unreservedAmountMinor: 0 });
  });

  it('reconciles finalized, reserved and settlement-applied slices through cancellation and release', async () => {
    const { vendorId, refund, prepared } = await r1MonetaryFixture(440, 880, 1000);
    const actorUserId = next('cashless-admin');
    await db.user.create({ data: { id: actorUserId, email: `${actorUserId}@example.test`,
      name: 'Cashless test admin', role: 'ADMIN', status: 'active', passwordHash: 'test-only' } });
    await markR1Review(prepared.payoutBatchId);
    await completeR1Cashless({ payoutBatchId: prepared.payoutBatchId, actorUserId,
      reason: 'Verified zero-net payment without EFT', confirmCashlessCompletion: true,
      confirmEftNotSent: true });

    const reservedCapacity = await makeSale(vendorId, 200, new Date());
    const reservedBatchId = await makeBatch(vendorId, [reservedCapacity]);
    const reservation = await reserve({ vendorId, currency: 'TRY', payoutBatchId: reservedBatchId,
      requestId: next('partial-reservation'), actorId: actorUserId });
    expect(reservation.claims).toMatchObject([{ settlementRefundAdjustmentId: refund.sourceId,
      status: 'RESERVED', reservedAmountMinor: 200 }]);

    const future = await makeEligibleUnsettledSale(vendorId, 440, 0);
    const draft = await createDraft({ vendorId, candidateScope: 'selected_allocations',
      selectedAllocationIds: [future.allocationId], asOfDate: new Date() });
    expect(draft.lines).toHaveLength(2);
    expect(draft.lines.map((line) => [line.lineType, line.financeLedgerEntryId, line.payableImpactMinor]))
      .toEqual(expect.arrayContaining([
        ['SALE', future.saleId, 440], ['REFUND_ADJUSTMENT', refund.refundLedgerId, -240],
      ]));
    expect((await reconcile({ vendorId, currency: 'TRY' })).sources.find((source) => source.sourceId === refund.sourceId))
      .toMatchObject({ status: 'VERIFIED', originalAmountMinor: 880, appliedAmountMinor: 680,
        remainingAmountMinor: 200, activeReservationMinor: 200, unreservedAmountMinor: 0 });

    await cancelSettlement(draft.id, actorUserId);
    expect((await reconcile({ vendorId, currency: 'TRY' })).sources.find((source) => source.sourceId === refund.sourceId))
      .toMatchObject({ status: 'VERIFIED', appliedAmountMinor: 440,
        remainingAmountMinor: 440, activeReservationMinor: 200, unreservedAmountMinor: 240 });
    await cancelPayout(reservedBatchId, actorUserId);
    expect((await db.payoutOffsetClaim.findUniqueOrThrow({ where: { id: reservation.claims[0].id } })).status)
      .toBe('RELEASED');
    expect((await reconcile({ vendorId, currency: 'TRY' })).sources.find((source) => source.sourceId === refund.sourceId))
      .toMatchObject({ status: 'VERIFIED', appliedAmountMinor: 440,
        remainingAmountMinor: 440, activeReservationMinor: 0, unreservedAmountMinor: 440 });
  });

  it('carries the post-cashless 440 into the next already drafted settlement payout exactly once', async () => {
    const vendorId = next('cashless-carry-vendor');
    await db.vendor.create({ data: { id: vendorId, name: vendorId } });
    const original = await makeSale(vendorId, 1000, new Date('2026-01-01T00:00:00.000Z'), 0);
    const firstSale = await makeEligibleUnsettledSale(vendorId, 440, 0);
    const firstDraft = await createDraft({ vendorId, candidateScope: 'selected_allocations',
      selectedAllocationIds: [firstSale.allocationId], asOfDate: new Date() });
    await approveSettlement(firstDraft.id, 'r1-monetary-admin');
    const laterSale = await makeEligibleUnsettledSale(vendorId, 440, 0);
    const laterDraft = await createDraft({ vendorId, candidateScope: 'selected_allocations',
      selectedAllocationIds: [laterSale.allocationId], asOfDate: new Date() });
    expect(laterDraft.lines.map((line) => line.financeLedgerEntryId)).toEqual([laterSale.saleId]);
    const refund = await makeRefund(vendorId, original, 880);
    const actorUserId = next('cashless-admin');
    await db.user.create({ data: { id: actorUserId, email: `${actorUserId}@example.test`,
      name: 'Cashless test admin', role: 'ADMIN', status: 'active', passwordHash: 'test-only' } });

    const firstPayout = await prepareR1Payout({ vendorId }, actorUserId, next('first-cashless-request'));
    expect(firstPayout).toMatchObject({ approvedBaseMinor: 440, offsetMinor: 440, netCashMinor: 0 });
    expect(firstPayout.claims).toMatchObject([{ settlementRefundAdjustmentId: refund.sourceId,
      reservedAmountMinor: 440 }]);
    await markR1Review(firstPayout.payoutBatchId);
    await completeR1Cashless({ payoutBatchId: firstPayout.payoutBatchId, actorUserId,
      reason: 'First verified zero-net offset; no EFT sent', confirmCashlessCompletion: true,
      confirmEftNotSent: true });
    expect((await db.settlementRefundAdjustment.findUniqueOrThrow({ where: { id: refund.sourceId } }))
      .remainingAmountMinor).toBe(440);

    const approvedLater = await approveSettlement(laterDraft.id, actorUserId);
    expect(approvedLater).toMatchObject({ status: 'approved', netPayableMinor: 440 });
    const secondPayout = await prepareR1Payout({ vendorId }, actorUserId, next('second-cashless-request'));
    expect(secondPayout).toMatchObject({ approvedBaseMinor: 440, offsetMinor: 440, netCashMinor: 0 });
    expect(secondPayout.claims).toMatchObject([{ settlementRefundAdjustmentId: refund.sourceId,
      settlementApprovalId: laterDraft.id, reservedAmountMinor: 440 }]);
    expect((await db.payoutBatchLine.findMany({ where: { payoutBatchId: secondPayout.payoutBatchId },
      select: { financeLedgerEntryId: true } })).map((line) => line.financeLedgerEntryId))
      .toEqual([laterSale.saleId]);
    await markR1Review(secondPayout.payoutBatchId);
    await completeR1Cashless({ payoutBatchId: secondPayout.payoutBatchId, actorUserId,
      reason: 'Remaining verified zero-net offset; no EFT sent', confirmCashlessCompletion: true,
      confirmEftNotSent: true });
    const [adjustment, claims, applications] = await Promise.all([
      db.settlementRefundAdjustment.findUniqueOrThrow({ where: { id: refund.sourceId } }),
      db.payoutOffsetClaim.findMany({ where: { settlementRefundAdjustmentId: refund.sourceId } }),
      db.settlementRefundAdjustmentApplication.findMany({ where: { settlementRefundAdjustmentId: refund.sourceId } }),
    ]);
    expect(adjustment).toMatchObject({ status: 'APPLIED', originalAmountMinor: 880,
      appliedAmountMinor: 880, remainingAmountMinor: 0 });
    expect(claims.map((claim) => [claim.status, claim.reservedAmountMinor]).sort())
      .toEqual([['FINALIZED', 440], ['FINALIZED', 440]]);
    expect(applications).toHaveLength(0);
    expect((await reconcile({ vendorId, currency: 'TRY' })).sources.find((source) => source.sourceId === refund.sourceId))
      .toMatchObject({ status: 'VERIFIED', activeReservationMinor: 0, unreservedAmountMinor: 0 });
    expect(await db.payoutR1CashlessCompletion.count({ where: {
      payoutBatchId: { in: [firstPayout.payoutBatchId, secondPayout.payoutBatchId] },
    } })).toBe(2);
  });

  it('fails closed when finalized claim money no longer matches the adjustment source', async () => {
    const { vendorId, refund, prepared } = await r1MonetaryFixture(440, 880, 1000);
    const actorUserId = next('cashless-admin');
    await db.user.create({ data: { id: actorUserId, email: `${actorUserId}@example.test`,
      name: 'Cashless test admin', role: 'ADMIN', status: 'active', passwordHash: 'test-only' } });
    await markR1Review(prepared.payoutBatchId);
    await completeR1Cashless({ payoutBatchId: prepared.payoutBatchId, actorUserId,
      reason: 'Verified zero-net payment without EFT', confirmCashlessCompletion: true,
      confirmEftNotSent: true });
    // Corrupt only this disposable fixture to prove that a sibling source cannot fill a missing minor unit.
    await db.settlementRefundAdjustment.update({ where: { id: refund.sourceId },
      data: { appliedAmountMinor: 441, remainingAmountMinor: 439 } });
    const future = await makeEligibleUnsettledSale(vendorId, 440, 0);
    await expect(createDraft({ vendorId, candidateScope: 'selected_allocations',
      selectedAllocationIds: [future.allocationId], asOfDate: new Date() }))
      .rejects.toThrow('R1_PAYOUT_ADJUSTMENT_RECONCILIATION_FAILED');
    expect(await db.settlementRefundAdjustmentApplication.count({
      where: { settlementRefundAdjustmentId: refund.sourceId },
    })).toBe(0);
    expect(await db.payoutOffsetClaim.findUniqueOrThrow({ where: { id: prepared.claims[0].id } }))
      .toMatchObject({ status: 'FINALIZED', reservedAmountMinor: 440 });
  });

  it('serializes post-cashless settlement and payout claims without double-consuming the remaining source', async () => {
    const { vendorId, refund, prepared } = await r1MonetaryFixture(440, 880, 1000);
    const actorUserId = next('cashless-admin');
    await db.user.create({ data: { id: actorUserId, email: `${actorUserId}@example.test`,
      name: 'Cashless test admin', role: 'ADMIN', status: 'active', passwordHash: 'test-only' } });
    await markR1Review(prepared.payoutBatchId);
    await completeR1Cashless({ payoutBatchId: prepared.payoutBatchId, actorUserId,
      reason: 'Verified zero-net payment without EFT', confirmCashlessCompletion: true,
      confirmEftNotSent: true });
    const payoutCapacity = await makeSale(vendorId, 440, new Date());
    const payoutBatchId = await makeBatch(vendorId, [payoutCapacity]);
    const settlementCapacity = await makeEligibleUnsettledSale(vendorId, 440, 0);
    const results = await Promise.allSettled([
      reserve({ vendorId, currency: 'TRY', payoutBatchId, requestId: next('remaining-claim'), actorId: actorUserId }),
      createDraft({ vendorId, candidateScope: 'selected_allocations',
        selectedAllocationIds: [settlementCapacity.allocationId], asOfDate: new Date() }),
    ]);
    expect(results.some((result) => result.status === 'fulfilled')).toBe(true);
    const adjustment = await db.settlementRefundAdjustment.findUniqueOrThrow({ where: { id: refund.sourceId } });
    const claims = await db.payoutOffsetClaim.findMany({
      where: { settlementRefundAdjustmentId: refund.sourceId },
    });
    const reservedMinor = claims.filter((claim) => claim.status === 'RESERVED')
      .reduce((sum, claim) => sum + claim.reservedAmountMinor, 0);
    expect(claims.filter((claim) => claim.status === 'FINALIZED').map((claim) => claim.reservedAmountMinor))
      .toEqual([440]);
    expect(adjustment.originalAmountMinor).toBe(880);
    expect(adjustment.appliedAmountMinor + adjustment.remainingAmountMinor).toBe(880);
    expect(adjustment.appliedAmountMinor + reservedMinor).toBeLessThanOrEqual(880);
    expect((await reconcile({ vendorId, currency: 'TRY' })).sources.find((source) => source.sourceId === refund.sourceId))
      .toMatchObject({ status: 'VERIFIED' });
  });

  it('requires an active Admin and explicit no-EFT confirmation for zero-net completion', async () => {
    const { refund, prepared } = await r1MonetaryFixture(440, 880, 1000);
    const actorUserId = next('cashless-vendor');
    await db.user.create({ data: { id: actorUserId, email: `${actorUserId}@example.test`,
      name: 'Not an admin', role: 'VENDOR', status: 'active', passwordHash: 'test-only' } });
    await markR1Review(prepared.payoutBatchId);
    const input = { payoutBatchId: prepared.payoutBatchId, actorUserId,
      reason: 'No EFT sent', confirmCashlessCompletion: true, confirmEftNotSent: true };
    await expect(completeR1Cashless(input)).rejects.toThrow('R1_ACTIVE_ADMIN_REQUIRED');
    await db.user.update({ where: { id: actorUserId }, data: { role: 'ADMIN' } });
    await expect(completeR1Cashless({ ...input, confirmEftNotSent: false }))
      .rejects.toThrow('R1_CASHLESS_ADMIN_CONFIRMATION_REQUIRED');
    expect(await db.payoutR1CashlessCompletion.count({ where: { payoutBatchId: prepared.payoutBatchId } }))
      .toBe(0);
    expect((await db.settlementRefundAdjustment.findUniqueOrThrow({ where: { id: refund.sourceId } }))
      .remainingAmountMinor).toBe(880);
  });

  it('serializes concurrent cashless confirmations and finalizes exact money once', async () => {
    const { refund, prepared } = await r1MonetaryFixture(440, 880, 1000);
    const actorUserId = next('cashless-admin');
    await db.user.create({ data: { id: actorUserId, email: `${actorUserId}@example.test`,
      name: 'Cashless test admin', role: 'ADMIN', status: 'active', passwordHash: 'test-only' } });
    await markR1Review(prepared.payoutBatchId);
    const input = { payoutBatchId: prepared.payoutBatchId, actorUserId,
      reason: 'No EFT sent', confirmCashlessCompletion: true, confirmEftNotSent: true };
    const outcomes = await Promise.allSettled([completeR1Cashless(input), completeR1Cashless(input)]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1);
    expect(await db.payoutR1CashlessCompletion.count({ where: { payoutBatchId: prepared.payoutBatchId } }))
      .toBe(1);
    expect((await db.settlementRefundAdjustment.findUniqueOrThrow({ where: { id: refund.sourceId } })))
      .toMatchObject({ appliedAmountMinor: 440, remainingAmountMinor: 440 });
  });

  it('rejects a positive-net R1 REVIEW batch on the cashless path without altering its claim', async () => {
    const { refund, prepared } = await r1MonetaryFixture();
    const actorUserId = next('cashless-admin');
    await db.user.create({ data: { id: actorUserId, email: `${actorUserId}@example.test`,
      name: 'Cashless test admin', role: 'ADMIN', status: 'active', passwordHash: 'test-only' } });
    await markR1Review(prepared.payoutBatchId);
    await expect(completeR1Cashless({ payoutBatchId: prepared.payoutBatchId, actorUserId,
      reason: 'No EFT sent', confirmCashlessCompletion: true, confirmEftNotSent: true }))
      .rejects.toThrow('R1_CASHLESS_ZERO_NET_REVIEW_REQUIRED');
    expect((await db.payoutOffsetClaim.findUniqueOrThrow({ where: { id: prepared.claims[0].id } }))
      .status).toBe('RESERVED');
    expect((await db.settlementRefundAdjustment.findUniqueOrThrow({ where: { id: refund.sourceId } }))
      .remainingAmountMinor).toBe(20000);
    expect(await db.payoutR1CashlessCompletion.count({ where: { payoutBatchId: prepared.payoutBatchId } }))
      .toBe(0);
  });

  it('rolls back claim finalization and refund money if cashless audit insertion fails', async () => {
    const { refund, prepared } = await r1MonetaryFixture(440, 880, 1000);
    const actorUserId = next('cashless-admin');
    await db.user.create({ data: { id: actorUserId, email: `${actorUserId}@example.test`,
      name: 'Cashless test admin', role: 'ADMIN', status: 'active', passwordHash: 'test-only' } });
    await markR1Review(prepared.payoutBatchId);
    await db.$executeRawUnsafe(`CREATE FUNCTION "r1_cashless_test_fail_audit"() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'TEST_R1_CASHLESS_AUDIT_FAILURE'; END; $$ LANGUAGE plpgsql`);
    await db.$executeRawUnsafe(`CREATE TRIGGER "r1_cashless_test_fail_audit_trigger"
      BEFORE INSERT ON "PayoutR1CashlessCompletion" FOR EACH ROW
      EXECUTE FUNCTION "r1_cashless_test_fail_audit"()`);
    try {
      await expect(completeR1Cashless({ payoutBatchId: prepared.payoutBatchId, actorUserId,
        reason: 'No EFT sent', confirmCashlessCompletion: true, confirmEftNotSent: true }))
        .rejects.toThrow('TEST_R1_CASHLESS_AUDIT_FAILURE');
      expect((await db.payoutBatch.findUniqueOrThrow({ where: { id: prepared.payoutBatchId } }))
        .status).toBe('REVIEW');
      expect((await db.payoutOffsetClaim.findUniqueOrThrow({ where: { id: prepared.claims[0].id } }))
        .status).toBe('RESERVED');
      expect((await db.settlementRefundAdjustment.findUniqueOrThrow({ where: { id: refund.sourceId } })))
        .toMatchObject({ appliedAmountMinor: 0, remainingAmountMinor: 880 });
    } finally {
      await db.$executeRawUnsafe('DROP TRIGGER "r1_cashless_test_fail_audit_trigger" ON "PayoutR1CashlessCompletion"');
      await db.$executeRawUnsafe('DROP FUNCTION "r1_cashless_test_fail_audit"()');
    }
  });

  it('classifies exact accepted refunds on its SALE as pre- or post-EFT and fails closed on missing evidence', async () => {
    const fixture = await baseFixture();
    const eftBeforeAcceptance = new Date();
    while (Date.now() <= eftBeforeAcceptance.getTime()) await new Promise((resolve) => setTimeout(resolve, 1));
    const refund = await makeRefund(fixture.vendorId, fixture.capacity, 1000);
    const after = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Vendor" WHERE "id" = ${fixture.vendorId} FOR UPDATE`;
      return classifyEftRefundTiming(tx, fixture.batchId, eftBeforeAcceptance);
    });
    expect(after.afterEftRefundLedgerIds).toEqual([refund.refundLedgerId]);
    expect(after.beforeEftRefundLedgerIds).toEqual([]);
    expect(after.unknownRefundLedgerIds).toEqual([]);

    const eftAfterAcceptance = new Date();
    const before = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Vendor" WHERE "id" = ${fixture.vendorId} FOR UPDATE`;
      return classifyEftRefundTiming(tx, fixture.batchId, eftAfterAcceptance);
    });
    expect(before.beforeEftRefundLedgerIds).toEqual([refund.refundLedgerId]);

    const accepted = await db.refundEvidenceSnapshot.findUniqueOrThrow({
      where: { refundFinanceLedgerEntryId: refund.refundLedgerId },
    });
    const equal = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Vendor" WHERE "id" = ${fixture.vendorId} FOR UPDATE`;
      return classifyEftRefundTiming(tx, fixture.batchId, accepted.capturedAt);
    });
    expect(equal.unknownRefundLedgerIds).toContain(refund.refundLedgerId);

    const missingLedgerId = next('missing-snapshot-refund-ledger');
    await db.financeLedgerEntry.create({ data: {
      id: missingLedgerId, vendorAllocationId: fixture.capacity.allocationId,
      vendorId: fixture.vendorId, entryType: 'refund', amount: '1.00',
    } });
    const missing = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Vendor" WHERE "id" = ${fixture.vendorId} FOR UPDATE`;
      return classifyEftRefundTiming(tx, fixture.batchId, eftBeforeAcceptance);
    });
    expect(missing.unknownRefundLedgerIds).toContain(missingLedgerId);

    // Deliberately contradictory persisted test evidence must never resolve a sibling refund.
    const conflictingRecordId = next('conflicting-record');
    const conflictingLedgerId = next('conflicting-ledger');
    const sourceShopifyRefundId = `gid://shopify/Refund/${conflictingRecordId}`;
    await db.refundRecord.create({ data: {
      id: conflictingRecordId, vendorAllocationId: fixture.capacity.allocationId,
      sourceShopifyOrderId: accepted.sourceShopifyOrderId,
      sourceShopifyOrderNumber: `#${fixture.capacity.orderId}`,
      sourceShopifyRefundId, amount: '1.00', status: 'processed',
    } });
    await db.financeLedgerEntry.create({ data: {
      id: conflictingLedgerId, vendorAllocationId: fixture.capacity.allocationId,
      vendorId: fixture.vendorId, entryType: 'refund', amount: '1.00',
    } });
    await db.refundEvidenceSnapshot.create({ data: {
      ...accepted, id: next('conflicting-snapshot'), refundRecordId: conflictingRecordId,
      refundFinanceLedgerEntryId: conflictingLedgerId,
      sourceShopifyRefundId: `gid://shopify/Refund/${next('wrong-source')}`,
    } });
    const conflicting = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Vendor" WHERE "id" = ${fixture.vendorId} FOR UPDATE`;
      return classifyEftRefundTiming(tx, fixture.batchId, eftBeforeAcceptance);
    });
    expect(conflicting.unknownRefundLedgerIds).toContain(conflictingLedgerId);
  });

  it('keeps R1 Mark Paid closed while distinguishing pre-EFT refunds from post-EFT evidence', async () => {
    const fixture = await baseFixture();
    await reserve(fixture.input);
    // The real REVIEW transition remains blocked until R1 monetary finalization exists.
    await db.payoutBatch.update({ where: { id: fixture.batchId }, data: { status: 'REVIEW' } });
    const eftBeforeRefund = new Date();
    while (Date.now() <= eftBeforeRefund.getTime()) await new Promise((resolve) => setTimeout(resolve, 1));
    await makeRefund(fixture.vendorId, fixture.capacity, 1000);
    await expect(markPaid(fixture.batchId, {
      paidAt: new Date().toISOString(), eftDeclaredAt: eftBeforeRefund.toISOString(),
    }, 'r1-eft-admin')).rejects.toThrow('R1_PAYOUT_RESERVED_CLAIMS_BLOCK_TRANSITION');

    const eftAfterRefund = new Date();
    await expect(markPaid(fixture.batchId, {
      paidAt: new Date().toISOString(), eftDeclaredAt: eftAfterRefund.toISOString(),
    }, 'r1-eft-admin')).rejects.toThrow('R1_REFUND_ACCEPTED_BEFORE_EFT');
    const batch = await db.payoutBatch.findUniqueOrThrow({ where: { id: fixture.batchId } });
    expect(batch.status).toBe('REVIEW');
    expect(batch.paidAt).toBeNull();
    expect(batch.eftExecutedAt).toBeNull();
    expect(await db.payoutOffsetClaim.count({ where: {
      payoutBatchId: fixture.batchId, status: 'RESERVED',
    } })).toBe(1);

    const missingLedgerId = next('missing-accepted-evidence');
    await db.financeLedgerEntry.create({ data: {
      id: missingLedgerId, vendorAllocationId: fixture.capacity.allocationId,
      vendorId: fixture.vendorId, entryType: 'refund', amount: '1.00',
    } });
    await expect(markPaid(fixture.batchId, {
      paidAt: new Date().toISOString(), eftDeclaredAt: eftBeforeRefund.toISOString(),
    }, 'r1-eft-admin')).rejects.toThrow('R1_EFT_REFUND_TIMING_UNKNOWN');
  });

  it('serializes Mark Paid with accepted refund writes under the same vendor lock', async () => {
    const fixture = await baseFixture();
    await reserve(fixture.input);
    await db.payoutBatch.update({ where: { id: fixture.batchId }, data: { status: 'REVIEW' } });
    const declaredEft = new Date();
    let signalEntered: () => void = () => undefined;
    let allowRefund: () => void = () => undefined;
    const entered = new Promise<void>((resolve) => { signalEntered = resolve; });
    const gate = new Promise<void>((resolve) => { allowRefund = resolve; });
    const refundWriter = db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Vendor" WHERE "id" = ${fixture.vendorId} FOR UPDATE`;
      signalEntered();
      await gate;
      return makeRefund(fixture.vendorId, fixture.capacity, 1000, 'adjustment', tx as never);
    });
    await entered;
    let markResolved = false;
    const mark = markPaid(fixture.batchId, {
      paidAt: new Date().toISOString(), eftDeclaredAt: declaredEft.toISOString(),
    }, 'r1-eft-admin').finally(() => { markResolved = true; });
    try {
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(markResolved).toBe(false);
    } finally {
      allowRefund();
    }
    const refund = await refundWriter;
    await expect(mark).rejects.toThrow('R1_PAYOUT_RESERVED_CLAIMS_BLOCK_TRANSITION');
    const timing = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Vendor" WHERE "id" = ${fixture.vendorId} FOR UPDATE`;
      return classifyEftRefundTiming(tx, fixture.batchId, declaredEft);
    });
    expect(timing.afterEftRefundLedgerIds).toContain(refund.refundLedgerId);
    expect((await db.payoutBatch.findUniqueOrThrow({ where: { id: fixture.batchId } })).status).toBe('REVIEW');
  });
});
