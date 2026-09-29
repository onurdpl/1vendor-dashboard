import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '../backend/node_modules/@prisma/client/index.js';

const databaseUrl = process.env.TEST_DATABASE_URL?.trim();
const describeWithPostgres = databaseUrl ? describe : describe.skip;

describeWithPostgres('FIN-BUG-001 settlement delay parity with isolated PostgreSQL', () => {
  let db: PrismaClient;
  let previewApproval: typeof import('../backend/src/modules/finance/settlement-approval.service.js')['previewApproval'];
  let createDraftApproval: typeof import('../backend/src/modules/finance/settlement-approval.service.js')['createDraftApproval'];
  let approveSettlementApproval: typeof import('../backend/src/modules/finance/settlement-approval.service.js')['approveSettlementApproval'];
  let getSettlementScheduleDryRun: typeof import('../backend/src/modules/finance/settlement-schedule.service.js')['getSettlementScheduleDryRun'];
  let createSettlementScheduleDrafts: typeof import('../backend/src/modules/finance/settlement-schedule.service.js')['createSettlementScheduleDrafts'];
  let ids: Record<string, string>;
  let sequence = 0;

  beforeEach(async () => {
    const target = new URL(databaseUrl!);
    if (process.env.FIN_BUG_001_TEST_DATABASE_ISOLATED !== '1' ||
        !['127.0.0.1', 'localhost'].includes(target.hostname) ||
        target.pathname.slice(1) !== 'fin_bug_001_validation') {
      throw new Error('FIN-BUG-001 PostgreSQL test requires isolated local fin_bug_001_validation.');
    }
    process.env.DATABASE_URL = databaseUrl;
    ({ previewApproval, createDraftApproval, approveSettlementApproval } =
      await import('../backend/src/modules/finance/settlement-approval.service.js'));
    ({ getSettlementScheduleDryRun, createSettlementScheduleDrafts } =
      await import('../backend/src/modules/finance/settlement-schedule.service.js'));
    db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await db.$connect();

    const run = `fin-bug-001-${process.pid}-${Date.now()}-${++sequence}`;
    ids = {
      run,
      vendor: `${run}-vendor`,
      order: `${run}-order`,
      allocation: `${run}-allocation`,
      fulfillment: `${run}-fulfillment`,
      refund: `${run}-refund`,
      sale: `${run}-sale`,
      refundLedger: `${run}-refund-ledger`,
      adjustment: `${run}-adjustment`,
    };

    await db.vendor.create({ data: { id: ids.vendor, name: 'FIN-BUG-001 Vendor' } });
    await db.vendorFinancialProfile.create({ data: {
      vendorId: ids.vendor,
      settlementDelayDays: 0,
      settlementFrequencyType: 'WEEKLY',
      weeklySettlementDay: 'WEDNESDAY',
      autoSettlementDraftEnabled: true,
    } });
    await db.shopifyOrder.create({ data: {
      id: ids.order,
      sourceShopifyOrderId: `gid://shopify/Order/${run}`,
      sourceShopifyOrderNumber: `#${run}`,
    } });
    await db.vendorAllocation.create({ data: {
      id: ids.allocation,
      sourceShopifyOrderId: ids.order,
      sourceShopifyOrderNumber: `#${run}`,
      originalVendorId: ids.vendor,
      assignedVendorId: ids.vendor,
      fulfillmentStatus: 'Fulfilled',
      shippingStatus: 'Delivered',
    } });
    await db.fulfillment.create({ data: {
      id: ids.fulfillment,
      vendorAllocationId: ids.allocation,
      fulfillmentStatus: 'Delivered',
      shipmentUpdatedAt: new Date('2026-09-10T12:00:00.000Z'),
    } });
    await db.refundRecord.create({ data: {
      id: ids.refund,
      vendorAllocationId: ids.allocation,
      sourceShopifyOrderId: `gid://shopify/Order/${run}`,
      sourceShopifyOrderNumber: `#${run}`,
      sourceShopifyRefundId: `gid://shopify/Refund/${run}`,
      amount: '40.00',
      status: 'processed',
    } });
    await db.financeLedgerEntry.create({ data: {
      id: ids.sale,
      vendorAllocationId: ids.allocation,
      vendorId: ids.vendor,
      entryType: 'sale',
      amount: '100.00',
      payoutStatus: 'PENDING',
      settlementStatus: 'PENDING',
      commissionPercentSnapshot: '10.00',
      commissionVatPercentSnapshot: '20.00',
      settlementDelayDaysSnapshot: 21,
    } });
    await db.financeLedgerEntry.create({ data: {
      id: ids.refundLedger,
      vendorAllocationId: ids.allocation,
      vendorId: ids.vendor,
      entryType: 'refund',
      amount: '40.00',
      payoutStatus: 'PAID',
      settlementStatus: 'SETTLED',
      commissionPercentSnapshot: '10.00',
      commissionVatPercentSnapshot: '20.00',
    } });
    await db.settlementRefundAdjustment.create({ data: {
      id: ids.adjustment,
      refundRecordId: ids.refund,
      refundFinanceLedgerEntryId: ids.refundLedger,
      vendorId: ids.vendor,
      originalOrderId: ids.order,
      status: 'PENDING',
      amountMinor: 4000,
      originalAmountMinor: 4000,
      appliedAmountMinor: 0,
      remainingAmountMinor: 4000,
      currencyCode: 'TRY',
      reason: 'FIN-BUG-001 refund adjustment fixture',
    } });
  });

  afterEach(async () => {
    if (!db || !ids) return;
    await db.settlementApproval.deleteMany({ where: { vendorId: ids.vendor } });
    await db.settlementRefundAdjustment.deleteMany({ where: { id: ids.adjustment } });
    await db.financeLedgerEntry.deleteMany({ where: { id: { in: [ids.sale, ids.refundLedger] } } });
    await db.refundRecord.deleteMany({ where: { id: ids.refund } });
    await db.fulfillment.deleteMany({ where: { id: ids.fulfillment } });
    await db.vendorAllocation.deleteMany({ where: { id: ids.allocation } });
    await db.shopifyOrder.deleteMany({ where: { id: ids.order } });
    await db.vendorFinancialProfile.deleteMany({ where: { vendorId: ids.vendor } });
    await db.vendor.deleteMany({ where: { id: ids.vendor } });
    await db.$disconnect();
  });

  it('excludes an immature refund-aware SALE from preview, manual DRAFT and scheduled DRAFT without applying its adjustment', async () => {
    const asOfDate = new Date('2026-09-30T23:59:59.999Z');
    const preview = await previewApproval(ids.vendor, null, asOfDate, { asOfDate });
    expect(preview.lines).toHaveLength(0);
    expect(preview.pendingRefundAdjustments).toMatchObject({ pendingAdjustmentCount: 1, pendingAdjustmentTotalMinor: 4000 });

    await expect(createDraftApproval({ vendorId: ids.vendor, asOfDate }))
      .rejects.toThrow('Adjustment-only settlement drafts are not supported yet.');
    expect(await db.settlementApproval.count({ where: { vendorId: ids.vendor } })).toBe(0);
    expect(await db.settlementRefundAdjustment.findUniqueOrThrow({ where: { id: ids.adjustment } }))
      .toMatchObject({ status: 'PENDING', appliedAmountMinor: 0, remainingAmountMinor: 4000 });

    const dryRun = await getSettlementScheduleDryRun({ vendorId: ids.vendor, runDate: '2026-09-30' });
    expect(dryRun.vendors).toEqual([
      expect.objectContaining({ state: 'BLOCKED', eligibleLineCount: 0, canCreateDraft: false }),
    ]);
    const createResult = await createSettlementScheduleDrafts({
      vendorId: ids.vendor,
      runDate: '2026-09-30',
      confirmAutoSettlementDrafts: true,
    });
    expect(createResult.summary).toMatchObject({ created: 0, skipped: 1, failed: 0 });
    expect(await db.settlementApproval.count({ where: { vendorId: ids.vendor } })).toBe(0);
    expect(await db.settlementRefundAdjustmentApplication.count({ where: { settlementRefundAdjustmentId: ids.adjustment } })).toBe(0);
  });

  it('includes the SALE at its frozen cutoff with unchanged money, then approval still rejects a newly stale delay', async () => {
    const exactCutoff = new Date('2026-10-01T12:00:00.000Z');
    const preview = await previewApproval(ids.vendor, null, exactCutoff, { asOfDate: exactCutoff });
    expect(preview.lines).toEqual([
      expect.objectContaining({
        financeLedgerEntryId: ids.sale,
        lineType: 'SALE',
        amountMinor: 10000,
        commissionMinor: 1000,
        commissionVatMinor: 200,
        payableImpactMinor: 8800,
      }),
    ]);
    expect(preview.summary).toMatchObject({
      grossSalesMinor: 10000,
      commissionMinor: 1000,
      commissionVatMinor: 200,
      netPayableMinor: 8800,
      pendingRefundAdjustmentTotalMinor: 4000,
      netAfterPendingRefundAdjustmentsMinor: 4800,
    });

    const draft = await createDraftApproval({ vendorId: ids.vendor, asOfDate: exactCutoff });
    expect(draft).toMatchObject({ status: 'draft', grossSalesMinor: 10000, netPayableMinor: 4800 });
    expect(await db.settlementRefundAdjustmentApplication.count({
      where: { settlementRefundAdjustmentId: ids.adjustment, settlementApprovalId: draft.id },
    })).toBe(1);

    await db.financeLedgerEntry.update({
      where: { id: ids.sale },
      data: { settlementDelayDaysSnapshot: 60 },
    });
    await expect(approveSettlementApproval(draft.id, null)).rejects.toMatchObject({
      reasons: expect.arrayContaining([
        expect.objectContaining({ financeLedgerEntryId: ids.sale, code: 'settlement_delay_not_satisfied' }),
      ]),
    });
    expect(await db.settlementApproval.findUniqueOrThrow({ where: { id: draft.id } }))
      .toMatchObject({ status: 'DRAFT', grossSalesMinor: 10000, netPayableMinor: 4800 });
  });
});
