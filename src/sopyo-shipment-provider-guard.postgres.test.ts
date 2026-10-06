import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient, type VendorIntegrationProviderCode } from '../backend/node_modules/@prisma/client/index.js';

const databaseUrl = process.env.TEST_DATABASE_URL?.trim();
const describeWithPostgres = databaseUrl ? describe : describe.skip;

describeWithPostgres('Sopyo inbound shipment provider guard on isolated PostgreSQL', () => {
  let db: PrismaClient;
  let updateShipment: typeof import('../backend/src/modules/vendor-integration/vendor-integration.shipment.service.js')['updateVendorIntegrationOrderShipment'];
  let sequence = 0;

  beforeAll(async () => {
    const target = new URL(databaseUrl!);
    if (process.env.SOPYO_SHIPMENT_GUARD_TEST_DATABASE_ISOLATED !== '1' ||
        !['127.0.0.1', 'localhost'].includes(target.hostname) ||
        target.pathname.slice(1) !== 'sopyo_shipment_guard_validation') {
      throw new Error('Shipment guard tests require isolated local sopyo_shipment_guard_validation.');
    }
    process.env.DATABASE_URL = databaseUrl;
    ({ updateVendorIntegrationOrderShipment: updateShipment } = await import(
      '../backend/src/modules/vendor-integration/vendor-integration.shipment.service.js'
    ));
    db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await db.$connect();
  });

  afterAll(async () => { await db?.$disconnect(); });

  async function fixture(input: {
    method: 'VENDOR_INTEGRATION' | 'KARGONOMI' | null;
    providerCode: VendorIntegrationProviderCode | null;
    clientVendorDifferent?: boolean;
  }) {
    const id = `shipment-guard-${process.pid}-${Date.now()}-${++sequence}`;
    const vendorId = `${id}-vendor`;
    const clientVendorId = input.clientVendorDifferent ? `${id}-other-vendor` : vendorId;
    const orderId = `${id}-order`;
    await db.vendor.create({ data: { id: vendorId, name: 'Shipment guard vendor' } });
    if (input.clientVendorDifferent) {
      await db.vendor.create({ data: { id: clientVendorId, name: 'Other shipment vendor' } });
    }
    await db.shopifyOrder.create({ data: { id: orderId,
      sourceShopifyOrderId: orderId, sourceShopifyOrderNumber: `#${id}` } });
    await db.vendorAllocation.create({ data: { id, sourceShopifyOrderId: orderId,
      sourceShopifyOrderNumber: `#${id}`, originalVendorId: vendorId,
      assignedVendorId: vendorId, outboundMethodSnapshot: input.method,
      outboundIntegrationProviderSnapshot: input.method === 'VENDOR_INTEGRATION' ? 'SOPYO' : null } });
    const client = await db.vendorIntegrationClient.create({ data: {
      vendorIdentifier: clientVendorId, providerName: 'Shipment test client',
      providerCode: input.providerCode, tokenHash: `${id}-hash`, scopes: ['shipment:write'],
    } });
    return { id, vendorId, client, context: {
      clientId: client.id, vendorIdentifier: client.vendorIdentifier,
      providerName: client.providerName, providerCode: client.providerCode, scopes: client.scopes,
    } };
  }

  function shipmentInput(source: Awaited<ReturnType<typeof fixture>>, idempotencyKey = 'shipment-1') {
    return { allocationId: source.id, context: source.context, idempotencyKey,
      carrier: 'Test carrier', trackingNumber: 'TRACK-1', trackingUrl: 'https://example.test/track',
      shippedAt: '2026-10-06T12:00:00.000Z' };
  }

  it('rejects a NULL-coded client on Sopyo without changing shipment or creating an event', async () => {
    const source = await fixture({ method: 'VENDOR_INTEGRATION', providerCode: null });
    const before = await db.vendorAllocation.findUniqueOrThrow({ where: { id: source.id } });
    await expect(updateShipment(shipmentInput(source), db as never))
      .rejects.toThrow('Integration client provider does not match the allocation outbound provider.');
    const after = await db.vendorAllocation.findUniqueOrThrow({ where: { id: source.id } });
    expect(after.carrier).toBe(before.carrier);
    expect(after.trackingNumber).toBe(before.trackingNumber);
    expect(after.vendorIntegrationTrackingUrl).toBe(before.vendorIntegrationTrackingUrl);
    expect(after.shippingStatus).toBe(before.shippingStatus);
    expect(await db.vendorIntegrationShipmentEvent.count({ where: { vendorAllocationId: source.id } })).toBe(0);
    expect(await db.allocationDeliveredObservation.count({ where: { vendorAllocationId: source.id } })).toBe(0);
  });

  it('allows a SOPYO-coded same-vendor client, preserves replay, and creates no delivered observation', async () => {
    const source = await fixture({ method: 'VENDOR_INTEGRATION', providerCode: 'SOPYO' });
    const first = await updateShipment(shipmentInput(source), db as never);
    expect(first).toMatchObject({ idempotent: false, allocation: {
      shippingStatus: 'In Transit', carrier: 'Test carrier', trackingNumber: 'TRACK-1',
    } });
    const replay = await updateShipment({ ...shipmentInput(source), carrier: 'Different carrier',
      trackingNumber: 'DIFFERENT' }, db as never);
    expect(replay).toMatchObject({ idempotent: true, allocation: {
      carrier: 'Test carrier', trackingNumber: 'TRACK-1',
    } });
    expect(await db.vendorIntegrationShipmentEvent.count({ where: { vendorAllocationId: source.id } })).toBe(1);
    expect(await db.allocationDeliveredObservation.count({ where: { vendorAllocationId: source.id } })).toBe(0);
  });

  it.each(['KARGONOMI', null] as const)('preserves existing %s allocation behavior for a NULL-coded client', async (method) => {
    const source = await fixture({ method, providerCode: null });
    const result = await updateShipment(shipmentInput(source), db as never);
    expect(result).toMatchObject({ idempotent: false, allocation: { shippingStatus: 'In Transit' } });
    expect(await db.vendorIntegrationShipmentEvent.count({ where: { vendorAllocationId: source.id } })).toBe(1);
  });

  it('still rejects a different-vendor client before shipment mutation', async () => {
    const source = await fixture({ method: 'VENDOR_INTEGRATION', providerCode: 'SOPYO', clientVendorDifferent: true });
    expect(await updateShipment(shipmentInput(source), db as never)).toBeNull();
    expect(await db.vendorIntegrationShipmentEvent.count({ where: { vendorAllocationId: source.id } })).toBe(0);
  });
});
