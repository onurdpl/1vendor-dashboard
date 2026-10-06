import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../backend/node_modules/@prisma/client/index.js';

const databaseUrl = process.env.TEST_DATABASE_URL?.trim();
const describeWithPostgres = databaseUrl ? describe : describe.skip;

describeWithPostgres('vendor-owned Sopyo SALE shipping authority on isolated PostgreSQL', () => {
  let db: PrismaClient;
  let upsertSaleLedgerForAllocation: typeof import('../backend/src/modules/finance/sale-ledger.service.js')['upsertSaleLedgerForAllocation'];
  let previewApproval: typeof import('../backend/src/modules/finance/settlement-approval.service.js')['previewApproval'];
  let sequence = 0;

  beforeAll(async () => {
    const target = new URL(databaseUrl!);
    if (process.env.SOPYO_SHIPPING_FINANCE_TEST_DATABASE_ISOLATED !== '1' ||
        !['127.0.0.1', 'localhost'].includes(target.hostname) ||
        target.pathname.slice(1) !== 'sopyo_shipping_finance_validation') {
      throw new Error('Shipping finance tests require isolated local sopyo_shipping_finance_validation.');
    }
    process.env.DATABASE_URL = databaseUrl;
    ({ upsertSaleLedgerForAllocation } = await import('../backend/src/modules/finance/sale-ledger.service.js'));
    ({ previewApproval } = await import('../backend/src/modules/finance/settlement-approval.service.js'));
    db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await db.$connect();
  });

  afterAll(async () => { await db?.$disconnect(); });

  async function createSale(input: {
    method: 'VENDOR_INTEGRATION' | 'KARGONOMI' | null;
    mode: 'FIXED' | 'EXTERNAL_PROVIDER';
    withCost?: boolean;
  }) {
    const id = `sopyo-finance-${process.pid}-${Date.now()}-${++sequence}`;
    const vendorId = `${id}-vendor`;
    const orderId = `${id}-order`;
    const lineId = `${id}-line`;
    const deliveredAt = new Date('2026-09-01T12:00:00.000Z');
    const provider = input.method === 'VENDOR_INTEGRATION' ? 'SOPYO' : null;
    await db.vendor.create({ data: { id: vendorId, name: 'Shipping finance test', status: 'inactive' } });
    await db.shopifyOrder.create({ data: { id: orderId, sourceShopifyOrderId: orderId,
      sourceShopifyOrderNumber: `#${id}`, currency: 'TRY' } });
    await db.shopifyOrderLineItem.create({ data: { id: lineId, shopifyOrderId: orderId,
      sourceLineItemId: lineId, quantity: 1, lineTotalVatIncluded: '100.00' } });
    await db.vendorAllocation.create({ data: { id, sourceShopifyOrderId: orderId,
      sourceShopifyOrderNumber: `#${id}`, originalVendorId: vendorId,
      assignedVendorId: vendorId, outboundMethodSnapshot: input.method,
      outboundIntegrationProviderSnapshot: provider,
      shippingStatus: input.method === 'KARGONOMI' ? 'In Transit' : 'Awaiting Shipment' } });
    await db.vendorAllocationLineItem.create({ data: { id: `${id}-allocation-line`,
      vendorAllocationId: id, shopifyLineItemId: lineId, lineAmount: '100.00' } });
    await db.vendorFinancialProfile.create({ data: { vendorId, commissionPercent: '10.00',
      commissionVatPercent: '20.00', deductShippingEnabled: true,
      shippingMode: input.mode, fixedShippingFee: '25.00', settlementDelayDays: 0 } });
    if (input.withCost) {
      await db.shipmentShippingCost.create({ data: { id: `${id}-cost`, vendorId,
        allocationId: id, sourceShopifyOrderId: orderId, providerName: 'Confirmed provider',
        shippingCost: '30.00', shippingVatAmount: '6.00', status: 'CONFIRMED' } });
    }
    if (input.method === 'VENDOR_INTEGRATION') {
      const push = await db.sopyoOrderPush.create({ data: { vendorAllocationId: id,
        assignedVendorId: vendorId, orderCode: id, status: 'SUCCEEDED', sopyoOrderId: `${sequence}` } });
      await db.allocationDeliveredObservation.create({ data: { vendorAllocationId: id,
        firstObservedDeliveredAt: deliveredAt, outboundMethod: 'VENDOR_INTEGRATION',
        outboundIntegrationProvider: 'SOPYO', sourceReference: `${sequence}`,
        sopyoOrderPushId: push.id } });
    } else if (input.method === 'KARGONOMI') {
      const execution = await db.shipmentExecution.create({ data: {
        id: `${id}-execution`, allocationId: id, vendorId, provider: 'KARGONOMI',
        providerShipmentId: `${id}-shipment`, shipmentStatus: 'DELIVERED', requestSnapshot: {},
      } });
      await db.allocationDeliveredObservation.create({ data: { vendorAllocationId: id,
        firstObservedDeliveredAt: deliveredAt, outboundMethod: 'KARGONOMI',
        sourceReference: `${id}-shipment`, shipmentExecutionId: execution.id } });
    }
    const sale = await db.$transaction((tx) => upsertSaleLedgerForAllocation(tx, id));
    return { id, vendorId, deliveredAt, saleId: sale.id };
  }

  it.each([
    { mode: 'FIXED' as const, withCost: false },
    { mode: 'EXTERNAL_PROVIDER' as const, withCost: true },
  ])('persists disabled Sopyo shipping under $mode and keeps In Transit finance-neutral', async ({ mode, withCost }) => {
    const source = await createSale({ method: 'VENDOR_INTEGRATION', mode, withCost });
    const persisted = await db.financeLedgerEntry.findUniqueOrThrow({ where: { id: source.saleId } });
    expect(persisted).toMatchObject({ deductShippingEnabledSnapshot: false,
      shippingModeSnapshot: 'DISABLED', shippingCostSnapshot: null, shippingVatAmountSnapshot: null,
      shippingCostIdSnapshot: null, settlementDelayDaysSnapshot: 0,
      settlementEligibleAt: source.deliveredAt });
    expect(persisted.fixedShippingFeeSnapshot?.toString()).toBe('0');

    const observation = await db.allocationDeliveredObservation.findUniqueOrThrow({ where: { vendorAllocationId: source.id } });
    expect(await db.shipmentShippingCost.count({ where: { allocationId: source.id } })).toBe(withCost ? 1 : 0);
    const before = await previewApproval(source.vendorId);
    expect(before.lines).toHaveLength(1);
    expect(before.lines[0]?.payableImpactMinor).toBe(8800);
    await db.vendorAllocation.update({ where: { id: source.id }, data: { shippingStatus: 'In Transit' } });
    const after = await previewApproval(source.vendorId);
    expect(after.lines).toHaveLength(1);
    expect(after.lines[0]?.payableImpactMinor).toBe(8800);
    expect(after.summary.netPayableMinor).toBe(before.summary.netPayableMinor);
    expect((await db.allocationDeliveredObservation.findUniqueOrThrow({ where: { vendorAllocationId: source.id } })).firstObservedDeliveredAt)
      .toEqual(observation.firstObservedDeliveredAt);
  });

  it.each([
    { method: null, mode: 'FIXED' as const, withCost: false, expectedMode: 'FIXED', expectedFee: '25' },
    { method: 'KARGONOMI' as const, mode: 'FIXED' as const, withCost: false,
      expectedMode: 'FIXED', expectedFee: '25' },
    { method: 'KARGONOMI' as const, mode: 'EXTERNAL_PROVIDER' as const, withCost: true,
      expectedMode: 'EXTERNAL_PROVIDER', expectedFee: '25' },
  ])('leaves $method non-Sopyo shipping snapshots unchanged', async (input) => {
    const source = await createSale(input);
    const persisted = await db.financeLedgerEntry.findUniqueOrThrow({ where: { id: source.saleId } });
    expect(persisted.deductShippingEnabledSnapshot).toBe(true);
    expect(persisted.shippingModeSnapshot).toBe(input.expectedMode);
    expect(persisted.fixedShippingFeeSnapshot?.toString()).toBe(input.expectedFee);
    expect(persisted.shippingCostSnapshot?.toString() ?? null).toBe(input.withCost ? '30' : null);
    if (input.method === 'KARGONOMI') {
      const preview = await previewApproval(source.vendorId);
      expect(preview.lines).toHaveLength(1);
      expect(preview.lines[0]?.payableImpactMinor).toBe(input.withCost ? 5200 : 6300);
    }
  });
});
