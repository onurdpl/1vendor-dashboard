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
  let getVendorFinanceDashboard: typeof import('../backend/src/modules/finance/finance.service.js')['getVendorFinanceDashboard'];
  let preparePayoutBatch: typeof import('../backend/src/modules/finance/finance.service.js')['preparePayoutBatch'];
  let markPayoutBatchReview: typeof import('../backend/src/modules/finance/finance.service.js')['markPayoutBatchReview'];
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
    withObservation?: boolean;
    withRefund?: boolean;
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
      outboundMethodSnapshot: 'KARGONOMI',
      fulfillmentStatus: 'Fulfilled',
      shippingStatus: 'Delivered',
    } });
    if (input.withObservation !== false) {
      await db.shipmentExecution.create({ data: {
        id: `${allocationId}-execution`, allocationId, vendorId: ids.vendor,
        provider: 'KARGONOMI', providerShipmentId: `${allocationId}-shipment`,
        shipmentStatus: 'DELIVERED', requestSnapshot: {},
      } });
      await db.allocationDeliveredObservation.create({ data: {
        vendorAllocationId: allocationId, firstObservedDeliveredAt: input.shipmentUpdatedAt,
        outboundMethod: 'KARGONOMI', sourceReference: `${allocationId}-shipment`,
        shipmentExecutionId: `${allocationId}-execution`,
      } });
    }
    await db.fulfillment.create({ data: {
      id: fulfillmentId,
      vendorAllocationId: allocationId,
      fulfillmentStatus: 'Delivered',
      shipmentUpdatedAt: input.shipmentUpdatedAt,
    } });
    if (input.withRefund !== false) {
      await db.refundRecord.create({ data: {
        id: refundId,
        vendorAllocationId: allocationId,
        sourceShopifyOrderId: `gid://shopify/Order/${ids.run}-${suffix}`,
        sourceShopifyOrderNumber: `#${ids.run}-${suffix}`,
        sourceShopifyRefundId: `gid://shopify/Refund/${ids.run}-${suffix}`,
        amount: '10.00',
        status: 'processed',
      } });
    }
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
    ({ getVendorFinanceDashboard, preparePayoutBatch, markPayoutBatchReview } =
      await import('../backend/src/modules/finance/finance.service.js'));
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
      outboundMethodSnapshot: 'KARGONOMI',
      fulfillmentStatus: 'Fulfilled',
      shippingStatus: 'Delivered',
    } });
    await db.shipmentExecution.create({ data: {
      id: `${ids.allocation}-execution`, allocationId: ids.allocation, vendorId: ids.vendor,
      provider: 'KARGONOMI', providerShipmentId: `${ids.allocation}-shipment`,
      shipmentStatus: 'DELIVERED', requestSnapshot: {},
    } });
    // Historical observation time is explicit only in this isolated deterministic fixture.
    await db.allocationDeliveredObservation.create({ data: {
      vendorAllocationId: ids.allocation, firstObservedDeliveredAt: deliveredAt,
      outboundMethod: 'KARGONOMI', sourceReference: `${ids.allocation}-shipment`,
      shipmentExecutionId: `${ids.allocation}-execution`,
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
    if (!db) return;
    // The canonical observation is intentionally UPDATE/DELETE-protected. The
    // suite runs only on a dedicated disposable database, discarded by its runner.
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

  it('Phase 4: missing observation fails closed despite delivered projection and old shipment timestamp', async () => {
    const saleId = await createAdditionalRefundAwareSale('no-observation', {
      shipmentUpdatedAt: deliveredAt,
      settlementDelayDaysSnapshot: 21,
      withObservation: false,
    });
    const preview = await previewApproval(ids.vendor, null, exactCutoff, { asOfDate: exactCutoff });
    expect(preview.lines.some((line) => line.financeLedgerEntryId === saleId)).toBe(false);
    expect(await db.allocationDeliveredObservation.count({ where: { vendorAllocationId: `${ids.run}-no-observation-allocation` } })).toBe(0);
  });

  it('Phase 4: one immutable observation matures a multi-line allocation despite later operational changes', async () => {
    const lines = [
      { id: `${ids.run}-line-a`, quantity: 2, amount: '60.00' },
      { id: `${ids.run}-line-b`, quantity: 1, amount: '40.00' },
    ];
    for (const line of lines) {
      await db.shopifyOrderLineItem.create({ data: {
        id: line.id, shopifyOrderId: ids.order, sourceLineItemId: line.id, quantity: line.quantity,
      } });
      await db.vendorAllocationLineItem.create({ data: {
        vendorAllocationId: ids.allocation, shopifyLineItemId: line.id,
        quantity: line.quantity, lineAmount: line.amount,
      } });
    }
    const original = await db.allocationDeliveredObservation.findUniqueOrThrow({ where: { vendorAllocationId: ids.allocation } });
    await db.vendorAllocation.update({ where: { id: ids.allocation }, data: { shippingStatus: 'awaiting_shipment' } });
    await db.shipmentExecution.update({ where: { id: `${ids.allocation}-execution` }, data: { shipmentStatus: 'RETURNED' } });
    await db.fulfillment.update({ where: { vendorAllocationId: ids.allocation }, data: {
      shipmentUpdatedAt: new Date('2999-01-01T00:00:00.000Z'),
    } });
    const preview = await previewApproval(ids.vendor, null, exactCutoff, { asOfDate: exactCutoff });
    expect(preview.lines).toEqual([expect.objectContaining({ financeLedgerEntryId: ids.sale, lineType: 'SALE' })]);
    expect(await db.allocationDeliveredObservation.findUniqueOrThrow({ where: { vendorAllocationId: ids.allocation } }))
      .toMatchObject({ id: original.id, firstObservedDeliveredAt: original.firstObservedDeliveredAt });
  });

  it('Phase 4: a snapshot/observation mismatch is not financial delivery authority', async () => {
    await db.vendorAllocation.update({ where: { id: ids.allocation }, data: {
      outboundMethodSnapshot: 'VENDOR_INTEGRATION', outboundIntegrationProviderSnapshot: 'SOPYO',
    } });
    const preview = await previewApproval(ids.vendor, null, exactCutoff, { asOfDate: exactCutoff });
    expect(preview.lines).toHaveLength(0);
  });

  it('Phase 4: projection, approved settlement and payout transition use the same observation clock', async () => {
    await db.settlementRefundAdjustment.delete({ where: { id: ids.adjustment } });
    await db.financeLedgerEntry.update({ where: { id: ids.sale }, data: {
      payoutStatus: 'PAID', settlementStatus: 'SETTLED',
    } });
    const saleId = await createAdditionalRefundAwareSale('clean-payout', {
      shipmentUpdatedAt: deliveredAt, settlementDelayDaysSnapshot: 21,
      withRefund: false,
    });
    const allocationId = `${ids.run}-clean-payout-allocation`;
    await db.vendorAllocation.update({ where: { id: allocationId }, data: { shippingStatus: 'awaiting_shipment' } });
    await db.fulfillment.update({ where: { vendorAllocationId: allocationId }, data: {
      shipmentUpdatedAt: new Date('2999-01-01T00:00:00.000Z'),
    } });
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(exactCutoff);
    const dashboard = await getVendorFinanceDashboard(ids.vendor);
    expect(dashboard.records.find((row) => row.id === saleId)?.settlement).toMatchObject({
      status: 'payable', payoutReady: true, eligibleAt: exactCutoff.toISOString(),
    });
    const draft = await createDraftApproval({ vendorId: ids.vendor, asOfDate: exactCutoff });
    const approved = await approveSettlementApproval(draft.id, 'admin-fin-bug-003');
    expect(approved.status).toBe('approved');
    const batch = await preparePayoutBatch({ vendorId: ids.vendor }, 'admin-fin-bug-003');
    expect(batch.status).toBe('draft');
    const review = await markPayoutBatchReview(batch.id);
    expect(review.status).toBe('review');
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
