import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../backend/node_modules/@prisma/client/index.js';
import { recordVerifiedSopyoShipmentIntent } from '../backend/src/modules/vendor-integration/sopyo-shipment-intent.service.js';

const databaseUrl = process.env.TEST_DATABASE_URL?.trim();
const describeWithPostgres = databaseUrl ? describe : describe.skip;

describeWithPostgres('Sopyo shipment intent on isolated PostgreSQL', () => {
  let db: PrismaClient;
  let sequence = 0;
  const owned: Array<{ vendorId: string; orderId: string; allocationId: string; pushId: string }> = [];

  beforeAll(async () => {
    const target = new URL(databaseUrl!);
    if (process.env.SOPYO_SHIPMENT_INTENT_TEST_DATABASE_ISOLATED !== '1' ||
        !['localhost', '127.0.0.1'].includes(target.hostname) ||
        target.pathname.slice(1) !== 'sopyo_shipment_intent_validation') {
      throw new Error('Sopyo shipment intent tests require isolated local sopyo_shipment_intent_validation.');
    }
    db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await db.$connect();
  });

  afterAll(async () => {
    if (!db) return;
    for (const row of owned.reverse()) {
      await db.sopyoShipmentIntent.deleteMany({ where: { vendorAllocationId: row.allocationId } });
      await db.sopyoOrderPush.deleteMany({ where: { id: row.pushId } });
      await db.vendorAllocation.deleteMany({ where: { id: row.allocationId } });
      await db.shopifyOrder.deleteMany({ where: { id: row.orderId } });
      await db.vendor.deleteMany({ where: { id: row.vendorId } });
    }
    await db.$disconnect();
  });

  async function fixture(input: {
    method?: 'VENDOR_INTEGRATION' | 'KARGONOMI';
    location?: string | null;
    cancelled?: boolean;
    pushStatus?: 'SUCCEEDED' | 'PENDING';
  } = {}) {
    const token = `sopyo-intent-${process.pid}-${Date.now()}-${++sequence}`;
    const vendor = await db.vendor.create({ data: { id: token, name: 'Intent test vendor' } });
    const order = await db.shopifyOrder.create({ data: {
      sourceShopifyOrderId: token, sourceShopifyOrderNumber: `#${sequence}`,
      ...(input.cancelled ? { cancelledAt: new Date('2026-01-01T00:00:00.000Z') } : {}),
    } });
    const allocation = await db.vendorAllocation.create({ data: {
      id: `alloc-${token}`, sourceShopifyOrderId: order.id,
      sourceShopifyOrderNumber: order.sourceShopifyOrderNumber,
      originalVendorId: vendor.id, assignedVendorId: vendor.id,
      outboundMethodSnapshot: input.method ?? 'VENDOR_INTEGRATION',
      outboundIntegrationProviderSnapshot: input.method === 'KARGONOMI' ? null : 'SOPYO',
      shopifyLocationGidSnapshot: input.location === undefined ? 'gid://shopify/Location/123' : input.location,
    } });
    const sopyoOrderId = String(80_000_000 + sequence);
    const push = await db.sopyoOrderPush.create({ data: {
      vendorAllocationId: allocation.id, assignedVendorId: vendor.id,
      orderCode: allocation.id, status: input.pushStatus ?? 'SUCCEEDED', sopyoOrderId,
    } });
    owned.push({ vendorId: vendor.id, orderId: order.id, allocationId: allocation.id, pushId: push.id });
    const request = {
      allocationId: allocation.id,
      pushId: push.id,
      detail: { id: Number(sopyoOrderId), orderCode: allocation.id,
        orderType: 'SOPYOAPI', cargoCompany: 'Sürat Kargo', cargoTrackingNumber: 'TRACK123' },
    };
    return { vendor, order, allocation, push, request };
  }

  it('persists one verified first cargo and exact replay preserves identity and timestamp', async () => {
    const { allocation, push, request } = await fixture();
    const before = await Promise.all([
      db.vendorIntegrationShipmentEvent.count(), db.allocationDeliveredObservation.count(),
      db.financeLedgerEntry.count(), db.shipmentExecution.count(), db.fulfillment.count(),
    ]);
    const originalAllocation = await db.vendorAllocation.findUniqueOrThrow({ where: { id: allocation.id } });
    const first = await recordVerifiedSopyoShipmentIntent(request, db as never);
    const replay = await recordVerifiedSopyoShipmentIntent(request, db as never);
    expect(first).toMatchObject({ vendorAllocationId: allocation.id, sopyoOrderPushId: push.id,
      assignedVendorId: allocation.assignedVendorId, carrier: 'Sürat Kargo',
      trackingNumber: 'TRACK123', shopifyLocationGid: 'gid://shopify/Location/123',
      status: 'CARGO_VERIFIED' });
    expect(replay.id).toBe(first.id);
    expect(replay.firstObservedCargoAt).toEqual(first.firstObservedCargoAt);
    expect(await db.sopyoShipmentIntent.count({ where: { vendorAllocationId: allocation.id } })).toBe(1);
    await expect(db.sopyoShipmentIntent.create({ data: {
      vendorAllocationId: allocation.id, sopyoOrderPushId: push.id,
      assignedVendorId: allocation.assignedVendorId, sopyoOrderId: first.sopyoOrderId,
      orderCode: allocation.id, carrier: 'Sürat Kargo', trackingNumber: 'TRACK123',
      shopifyLocationGid: first.shopifyLocationGid,
    } })).rejects.toThrow();
    expect(await Promise.all([
      db.vendorIntegrationShipmentEvent.count(), db.allocationDeliveredObservation.count(),
      db.financeLedgerEntry.count(), db.shipmentExecution.count(), db.fulfillment.count(),
    ])).toEqual(before);
    const currentAllocation = await db.vendorAllocation.findUniqueOrThrow({ where: { id: allocation.id } });
    expect(currentAllocation.trackingNumber).toBe(originalAllocation.trackingNumber);
    expect(currentAllocation.carrier).toBe(originalAllocation.carrier);
    expect(currentAllocation.shippingStatus).toBe(originalAllocation.shippingStatus);
  });

  it('keeps first cargo immutable and records a bounded conflict for different cargo', async () => {
    const { request } = await fixture();
    const first = await recordVerifiedSopyoShipmentIntent(request, db as never);
    const changed = await recordVerifiedSopyoShipmentIntent({
      ...request, detail: { ...request.detail, cargoTrackingNumber: 'OTHER' },
    }, db as never);
    expect(changed).toMatchObject({ id: first.id, carrier: first.carrier,
      trackingNumber: first.trackingNumber, status: 'CONFLICT', conflictReasonCode: 'CARGO_MISMATCH' });
    expect(changed.conflictObservedAt).toBeInstanceOf(Date);
    expect(changed.firstObservedCargoAt).toEqual(first.firstObservedCargoAt);
    const replay = await recordVerifiedSopyoShipmentIntent(request, db as never);
    expect(replay.status).toBe('CONFLICT');
    await expect(db.sopyoShipmentIntent.update({ where: { id: first.id },
      data: { trackingNumber: 'tampered' } })).rejects.toThrow();
  });

  it('serializes concurrent exact observations to the same durable intent', async () => {
    const { request } = await fixture();
    const [first, second] = await Promise.all([
      recordVerifiedSopyoShipmentIntent(request, db as never),
      recordVerifiedSopyoShipmentIntent(request, db as never),
    ]);
    expect(second.id).toBe(first.id);
    expect(second.firstObservedCargoAt).toEqual(first.firstObservedCargoAt);
    expect(await db.sopyoShipmentIntent.count({ where: { vendorAllocationId: request.allocationId } })).toBe(1);
  });

  it('rejects mismatched vendor, push identity, numeric ID, order code and order type', async () => {
    const source = await fixture();
    const other = await fixture();
    const cases = [
      { ...source.request, pushId: other.push.id },
      { ...source.request, detail: { ...source.request.detail, id: 12 } },
      { ...source.request, detail: { ...source.request.detail, orderCode: other.allocation.id } },
      { ...source.request, detail: { ...source.request.detail, orderType: 'OTHER' } },
    ];
    for (const request of cases) {
      await expect(recordVerifiedSopyoShipmentIntent(request, db as never)).rejects.toThrow();
    }
    await db.sopyoOrderPush.update({ where: { id: source.push.id }, data: { assignedVendorId: other.vendor.id } });
    await expect(recordVerifiedSopyoShipmentIntent(source.request, db as never)).rejects.toThrow();
    expect(await db.sopyoShipmentIntent.count({ where: { vendorAllocationId: source.allocation.id } })).toBe(0);
  });

  it('fails closed for missing location, cargo, successful push, or Sopyo snapshot', async () => {
    const missingLocation = await fixture({ location: null });
    const pending = await fixture({ pushStatus: 'PENDING' });
    const kargonomi = await fixture({ method: 'KARGONOMI' });
    for (const request of [missingLocation.request, pending.request, kargonomi.request,
      { ...pending.request, detail: { ...pending.request.detail, cargoCompany: null } },
      { ...pending.request, detail: { ...pending.request.detail, cargoTrackingNumber: ' ' } }]) {
      await expect(recordVerifiedSopyoShipmentIntent(request, db as never)).rejects.toThrow();
    }
    expect(await db.sopyoShipmentIntent.count({ where: { vendorAllocationId: {
      in: [missingLocation.allocation.id, pending.allocation.id, kargonomi.allocation.id],
    } } })).toBe(0);
  });

  it('rejects a cancelled order before creating an intent', async () => {
    const cancelled = await fixture({ cancelled: true });
    await expect(recordVerifiedSopyoShipmentIntent(cancelled.request, db as never)).rejects.toThrow();
    expect(await db.sopyoShipmentIntent.count({ where: { vendorAllocationId: cancelled.allocation.id } })).toBe(0);
  });
});
