import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '../backend/node_modules/@prisma/client/index.js';

const databaseUrl = process.env.TEST_DATABASE_URL?.trim();
const describeWithPostgres = databaseUrl ? describe : describe.skip;
const deliveredAt = new Date('2026-09-09T23:59:59.999Z');
const beforeCutoff = new Date('2026-09-23T23:59:59.999Z');
const exactCutoff = new Date('2026-09-30T23:59:59.999Z');
const afterCutoff = new Date('2026-10-07T23:59:59.999Z');

describeWithPostgres('FIN-BUG-001 settlement delay parity with isolated PostgreSQL', () => {
  let db: PrismaClient;
  let previewApproval: typeof import('../backend/src/modules/finance/settlement-approval.service.js')['previewApproval'];
  let createDraftApproval: typeof import('../backend/src/modules/finance/settlement-approval.service.js')['createDraftApproval'];
  let approveSettlementApproval: typeof import('../backend/src/modules/finance/settlement-approval.service.js')['approveSettlementApproval'];
  let getSettlementScheduleDryRun: typeof import('../backend/src/modules/finance/settlement-schedule.service.js')['getSettlementScheduleDryRun'];
  let createSettlementScheduleDrafts: typeof import('../backend/src/modules/finance/settlement-schedule.service.js')['createSettlementScheduleDrafts'];
  let ids: Record<string, string>;
  let extraIds: {
    orders: string[];
    allocations: string[];
    fulfillments: string[];
    refunds: string[];
    ledgers: string[];
  };
  let sequence = 0;

  async function createAdditionalRefundAwareSale(suffix: string, input: {
    shipmentUpdatedAt: Date;
    settlementDelayDaysSnapshot: number;
    amount?: string;
  }) {
    const orderId = `${ids.run}-${suffix}-order`;
    const allocationId = `${ids.run}-${suffix}-allocation`;
    const fulfillmentId = `${ids.run}-${suffix}-fulfillment`;
    const refundId = `${ids.run}-${suffix}-refund`;
    const saleId = `${ids.run}-${suffix}-sale`;
    extraIds.orders.push(orderId);
    extraIds.allocations.push(allocationId);
    extraIds.fulfillments.push(fulfillmentId);
    extraIds.refunds.push(refundId);
    extraIds.ledgers.push(saleId);

    await db.shopifyOrder.create({ data: {
      id: orderId,
      sourceShopifyOrderId: `gid://shopify/Order/${ids.run}-${suffix}`,
      sourceShopifyOrderNumber: `#${ids.run}-${suffix}`,
    } });
    await db.vendorAllocation.create({ data: {
      id: allocationId,
      sourceShopifyOrderId: orderId,
      sourceShopifyOrderNumber: `#${ids.run}-${suffix}`,
      originalVendorId: ids.vendor,
      assignedVendorId: ids.vendor,
      fulfillmentStatus: 'Fulfilled',
      shippingStatus: 'Delivered',
    } });
    await db.fulfillment.create({ data: {
      id: fulfillmentId,
      vendorAllocationId: allocationId,
      fulfillmentStatus: 'Delivered',
      shipmentUpdatedAt: input.shipmentUpdatedAt,
    } });
    await db.refundRecord.create({ data: {
      id: refundId,
      vendorAllocationId: allocationId,
      sourceShopifyOrderId: `gid://shopify/Order/${ids.run}-${suffix}`,
      sourceShopifyOrderNumber: `#${ids.run}-${suffix}`,
      sourceShopifyRefundId: `gid://shopify/Refund/${ids.run}-${suffix}`,
      amount: '10.00',
      status: 'processed',
    } });
    await db.financeLedgerEntry.create({ data: {
      id: saleId,
      vendorAllocationId: allocationId,
      vendorId: ids.vendor,
      entryType: 'sale',
      amount: input.amount ?? '50.00',
      payoutStatus: 'PENDING',
      settlementStatus: 'PENDING',
      commissionPercentSnapshot: '10.00',
      commissionVatPercentSnapshot: '20.00',
      settlementDelayDaysSnapshot: input.settlementDelayDaysSnapshot,
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
    } });
    return saleId;
  }

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
    extraIds = { orders: [], allocations: [], fulfillments: [], refunds: [], ledgers: [] };

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
      shipmentUpdatedAt: deliveredAt,
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
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
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
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
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
    vi.useRealTimers();
    if (!db || !ids) return;
    await db.settlementApproval.deleteMany({ where: { vendorId: ids.vendor } });
    await db.settlementRefundAdjustment.deleteMany({ where: { id: ids.adjustment } });
    await db.financeLedgerEntry.deleteMany({ where: { id: { in: [ids.sale, ids.refundLedger, ...extraIds.ledgers] } } });
    await db.refundRecord.deleteMany({ where: { id: { in: [ids.refund, ...extraIds.refunds] } } });
    await db.fulfillment.deleteMany({ where: { id: { in: [ids.fulfillment, ...extraIds.fulfillments] } } });
    await db.vendorAllocation.deleteMany({ where: { id: { in: [ids.allocation, ...extraIds.allocations] } } });
    await db.shopifyOrder.deleteMany({ where: { id: { in: [ids.order, ...extraIds.orders] } } });
    await db.vendorFinancialProfile.deleteMany({ where: { vendorId: ids.vendor } });
    await db.vendor.deleteMany({ where: { id: ids.vendor } });
    await db.$disconnect();
  });

  it('excludes an immature refund-aware SALE from preview, manual DRAFT and scheduled DRAFT without applying its adjustment', async () => {
    const preview = await previewApproval(ids.vendor, null, beforeCutoff, { asOfDate: beforeCutoff });
    expect(preview.lines).toHaveLength(0);
    expect(preview.pendingRefundAdjustments).toMatchObject({ pendingAdjustmentCount: 1, pendingAdjustmentTotalMinor: 4000 });

    await expect(createDraftApproval({ vendorId: ids.vendor, asOfDate: beforeCutoff }))
      .rejects.toThrow('Adjustment-only settlement drafts are not supported yet.');
    expect(await db.settlementApproval.count({ where: { vendorId: ids.vendor } })).toBe(0);
    expect(await db.settlementRefundAdjustment.findUniqueOrThrow({ where: { id: ids.adjustment } }))
      .toMatchObject({ status: 'PENDING', appliedAmountMinor: 0, remainingAmountMinor: 4000 });

    const dryRun = await getSettlementScheduleDryRun({ vendorId: ids.vendor, runDate: '2026-09-23' });
    expect(dryRun.vendors).toEqual([
      expect.objectContaining({ state: 'BLOCKED', eligibleLineCount: 0, canCreateDraft: false }),
    ]);
    const createResult = await createSettlementScheduleDrafts({
      vendorId: ids.vendor,
      runDate: '2026-09-23',
      confirmAutoSettlementDrafts: true,
    });
    expect(createResult.summary).toMatchObject({ created: 0, skipped: 1, failed: 0 });
    expect(await db.settlementApproval.count({ where: { vendorId: ids.vendor } })).toBe(0);
    expect(await db.settlementRefundAdjustmentApplication.count({ where: { settlementRefundAdjustmentId: ids.adjustment } })).toBe(0);
  });

  it('uses a shorter frozen delay over a longer current profile and approves at the exact cutoff', async () => {
    await db.settlementRefundAdjustment.delete({ where: { id: ids.adjustment } });
    await db.vendorFinancialProfile.update({
      where: { vendorId: ids.vendor },
      data: { settlementDelayDays: 60 },
    });
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(exactCutoff);
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
      pendingRefundAdjustmentTotalMinor: 0,
      netAfterPendingRefundAdjustmentsMinor: 8800,
    });

    const draft = await createDraftApproval({ vendorId: ids.vendor, asOfDate: exactCutoff });
    expect(draft).toMatchObject({ status: 'draft', grossSalesMinor: 10000, netPayableMinor: 8800 });
    const approved = await approveSettlementApproval(draft.id, 'admin-fin-bug-001');
    expect(approved).toMatchObject({ status: 'approved', approvedBy: 'admin-fin-bug-001' });
    expect(await db.financeLedgerEntry.findUniqueOrThrow({ where: { id: ids.sale } }))
      .toMatchObject({ settlementDelayDaysSnapshot: 21 });
  });

  it('admits a refund-aware SALE after its frozen cutoff without changing money', async () => {
    const preview = await previewApproval(ids.vendor, null, afterCutoff, { asOfDate: afterCutoff });
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
    const draft = await createDraftApproval({ vendorId: ids.vendor, asOfDate: afterCutoff });
    expect(draft).toMatchObject({ status: 'draft', grossSalesMinor: 10000, netPayableMinor: 4800 });
  });

  it.each([
    { label: 'before', runDate: '2026-09-23', expectedState: 'BLOCKED', created: 0 },
    { label: 'at', runDate: '2026-09-30', expectedState: 'READY', created: 1 },
    { label: 'after', runDate: '2026-10-07', expectedState: 'READY', created: 1 },
  ])('keeps scheduled preview and DRAFT membership aligned $label the cutoff', async ({ runDate, expectedState, created }) => {
    const dryRun = await getSettlementScheduleDryRun({ vendorId: ids.vendor, runDate });
    expect(dryRun.vendors[0]).toMatchObject({
      state: expectedState,
      eligibleLineCount: created,
      canCreateDraft: created === 1,
    });
    const result = await createSettlementScheduleDrafts({
      vendorId: ids.vendor,
      runDate,
      confirmAutoSettlementDrafts: true,
    });
    expect(result.summary).toMatchObject({ created, skipped: created === 0 ? 1 : 0, failed: 0 });
    expect(await db.settlementApproval.count({ where: { vendorId: ids.vendor } })).toBe(created);
  });

  it('deterministically rejects a stale historical DRAFT without changing frozen evidence', async () => {
    const staleApproval = await db.settlementApproval.create({
      data: {
        vendorId: ids.vendor,
        status: 'DRAFT',
        currency: 'TRY',
        grossSalesMinor: 10000,
        refundTotalMinor: 0,
        commissionMinor: 1000,
        commissionVatMinor: 200,
        netPayableMinor: 8800,
        sourceSnapshotJson: { fixture: 'stale-refund-aware-sale' },
        lines: {
          create: {
            financeLedgerEntryId: ids.sale,
            lineType: 'SALE',
            amountMinor: 10000,
            commissionMinor: 1000,
            commissionVatMinor: 200,
            payableImpactMinor: 8800,
            sourceSnapshotJson: { financeLedgerEntryId: ids.sale, refundCount: 1 },
          },
        },
      },
    });
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(beforeCutoff);

    await expect(approveSettlementApproval(staleApproval.id, 'admin-fin-bug-001')).rejects.toMatchObject({
      reasons: expect.arrayContaining([
        expect.objectContaining({ financeLedgerEntryId: ids.sale, code: 'settlement_delay_not_satisfied' }),
      ]),
    });
    expect(await db.settlementApproval.findUniqueOrThrow({ where: { id: staleApproval.id } }))
      .toMatchObject({ status: 'DRAFT' });
    expect(await db.financeLedgerEntry.findUniqueOrThrow({ where: { id: ids.sale } }))
      .toMatchObject({ settlementDelayDaysSnapshot: 21 });
  });

  it('creates PARTIALLY_APPLIED through a legitimate DRAFT then denies its remainder immature capacity', async () => {
    await db.settlementRefundAdjustment.update({
      where: { id: ids.adjustment },
      data: { amountMinor: 12000, originalAmountMinor: 12000, remainingAmountMinor: 12000 },
    });
    const firstDraft = await createDraftApproval({ vendorId: ids.vendor, asOfDate: exactCutoff });
    expect(firstDraft).toMatchObject({ status: 'draft', netPayableMinor: 0 });
    expect(await db.settlementRefundAdjustment.findUniqueOrThrow({ where: { id: ids.adjustment } }))
      .toMatchObject({ status: 'PARTIALLY_APPLIED', appliedAmountMinor: 8800, remainingAmountMinor: 3200 });
    expect(await db.settlementRefundAdjustmentApplication.count({
      where: { settlementRefundAdjustmentId: ids.adjustment },
    })).toBe(1);

    await createAdditionalRefundAwareSale('immature-remainder', {
      shipmentUpdatedAt: exactCutoff,
      settlementDelayDaysSnapshot: 21,
    });
    await expect(createDraftApproval({ vendorId: ids.vendor, asOfDate: afterCutoff }))
      .rejects.toThrow('Adjustment-only settlement drafts are not supported yet.');
    expect(await db.settlementRefundAdjustment.findUniqueOrThrow({ where: { id: ids.adjustment } }))
      .toMatchObject({ status: 'PARTIALLY_APPLIED', appliedAmountMinor: 8800, remainingAmountMinor: 3200 });
    expect(await db.settlementRefundAdjustmentApplication.count({
      where: { settlementRefundAdjustmentId: ids.adjustment },
    })).toBe(1);
  });
});
