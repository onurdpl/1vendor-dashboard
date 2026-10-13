import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '../backend/node_modules/@prisma/client/index.js';

const databaseUrl = process.env.TEST_DATABASE_URL?.trim();
const describeWithPostgres = databaseUrl ? describe : describe.skip;

describeWithPostgres('settlement approval readiness on isolated PostgreSQL', () => {
  let db: PrismaClient;
  let assessment: typeof import('../backend/src/modules/finance/settlement-approval.service.js')['assessSettlementApprovalReadiness'];
  let approvalId: string;
  let allocationId: string;
  let saleId: string;
  let orderId: string;
  let sequence = 0;

  beforeEach(async () => {
    const target = new URL(databaseUrl!);
    if (process.env.SETTLEMENT_APPROVAL_READINESS_TEST_DATABASE_ISOLATED !== '1' ||
        target.hostname !== '127.0.0.1' || !['5432', '5433'].includes(target.port) ||
        target.pathname !== '/settlement_approval_readiness_validation') {
      throw new Error('Settlement approval readiness test requires its isolated local PostgreSQL database.');
    }
    process.env.DATABASE_URL = databaseUrl;
    const [{ createDraftApproval, assessSettlementApprovalReadiness },
      { recordVerifiedDeliveredObservation }] = await Promise.all([
      import('../backend/src/modules/finance/settlement-approval.service.js'),
      import('../backend/src/modules/shipping/allocation-delivered-observation.service.js'),
    ]);
    assessment = assessSettlementApprovalReadiness;
    db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await db.$connect();

    const prefix = `approval-readiness-${process.pid}-${Date.now()}-${++sequence}`;
    const vendorId = `${prefix}-vendor`;
    orderId = `${prefix}-order`;
    allocationId = `${prefix}-allocation`;
    saleId = `${prefix}-sale`;
    const executionId = `${prefix}-execution`;
    await db.vendor.create({ data: { id: vendorId, name: 'Readiness Test Vendor' } });
    await db.vendorFinancialProfile.create({ data: {
      vendorId, settlementDelayDays: 0, settlementFrequencyType: 'WEEKLY',
      weeklySettlementDay: 'WEDNESDAY', autoSettlementDraftEnabled: false,
    } });
    await db.shopifyOrder.create({ data: {
      id: orderId, sourceShopifyOrderId: `gid://shopify/Order/${orderId}`,
      sourceShopifyOrderNumber: `#${orderId}`,
    } });
    await db.vendorAllocation.create({ data: {
      id: allocationId, sourceShopifyOrderId: orderId, sourceShopifyOrderNumber: `#${orderId}`,
      originalVendorId: vendorId, assignedVendorId: vendorId,
      outboundMethodSnapshot: 'KARGONOMI', fulfillmentStatus: 'Fulfilled', shippingStatus: 'Delivered',
    } });
    await db.shipmentExecution.create({ data: {
      id: executionId, allocationId, vendorId, provider: 'KARGONOMI',
      providerShipmentId: `${prefix}-shipment`, shipmentStatus: 'DELIVERED', requestSnapshot: {},
    } });
    const observation = await recordVerifiedDeliveredObservation({
      allocationId,
      source: { method: 'KARGONOMI', shipmentExecutionId: executionId,
        sourceReference: `${prefix}-shipment` },
    }, db as never);
    await db.fulfillment.create({ data: {
      id: `${prefix}-fulfillment`, vendorAllocationId: allocationId,
      fulfillmentStatus: 'Delivered', shipmentUpdatedAt: observation.firstObservedDeliveredAt,
    } });
    await db.financeLedgerEntry.create({ data: {
      id: saleId, vendorAllocationId: allocationId, vendorId, entryType: 'sale',
      amount: '100.00', payoutStatus: 'PENDING', settlementStatus: 'PENDING',
      commissionPercentSnapshot: '10.00', commissionVatPercentSnapshot: '20.00',
      settlementDelayDaysSnapshot: 0,
    } });
    const draft = await createDraftApproval({ vendorId, candidateScope: 'vendor_wide' });
    approvalId = draft.id;
    expect(draft.status).toBe('draft');
    expect(draft.lines.map((line) => line.financeLedgerEntryId)).toEqual([saleId]);
  });

  afterEach(async () => {
    await db?.$disconnect();
    // Immutable observation and financial fixture rows are disposed with this dedicated database.
  });

  it('reports a clean DRAFT without changing financial state', async () => {
    const before = await db.settlementApproval.findUniqueOrThrow({
      where: { id: approvalId }, include: { lines: true },
    });
    const result = await assessment(approvalId);
    const after = await db.settlementApproval.findUniqueOrThrow({
      where: { id: approvalId }, include: { lines: true },
    });

    expect(result).toMatchObject({
      writesPerformed: false, settlementApprovalId: approvalId, vendorId: before.vendorId,
      currency: 'TRY', status: 'DRAFT', classification: 'VERIFIED_BY_EXISTING_CHECKS',
      sourceValidation: { evaluated: true, ok: true, reasons: [] }, adminReviewRequired: true,
    });
    expect(after).toEqual(before);
    expect(await db.payoutBatch.count({ where: { vendorId: before.vendorId } })).toBe(0);
  });

  it('reports a new allocation hold through the existing approval predicate', async () => {
    await db.vendorAllocation.update({ where: { id: allocationId }, data: { allocationStatus: 'VENDOR_BLOCKED' } });
    const result = await assessment(approvalId);

    expect(result).toMatchObject({
      classification: 'BLOCKED', sourceValidation: { evaluated: true, ok: false, reasons: expect.arrayContaining([
        expect.objectContaining({ code: 'vendor_blocked_finance_hold_active', financeLedgerEntryId: saleId }),
      ]) }, adminReviewRequired: true,
    });
    expect((await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId } })).status).toBe('DRAFT');
  });

  it('blocks a post-DRAFT unresolved refund record without changing the DRAFT', async () => {
    await db.refundRecord.create({ data: {
      id: `${orderId}-refund`, vendorAllocationId: allocationId,
      sourceShopifyOrderId: `gid://shopify/Order/${orderId}`,
      sourceShopifyOrderNumber: `#${orderId}`,
      sourceShopifyRefundId: `gid://shopify/Refund/${orderId}`,
      amount: '10.00', status: 'pending',
    } });
    const result = await assessment(approvalId);

    expect(result?.classification).toBe('BLOCKED');
    expect(result?.sourceValidation.reasons).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'refund_arrived_after_draft', financeLedgerEntryId: saleId }),
    ]));
    expect((await db.settlementApproval.findUniqueOrThrow({ where: { id: approvalId } })).status).toBe('DRAFT');
    expect(await db.payoutBatch.count({ where: { vendorId: result!.vendorId } })).toBe(0);
  });
});
