import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../backend/node_modules/@prisma/client/index.js';

const databaseUrl = process.env.TEST_DATABASE_URL?.trim();
const describeWithPostgres = databaseUrl ? describe : describe.skip;

describeWithPostgres('FIN-BUG-003 Phase 3 delivered observation on isolated PostgreSQL', () => {
  let db: PrismaClient;
  let record: typeof import('../backend/src/modules/shipping/allocation-delivered-observation.service.js')['recordVerifiedDeliveredObservation'];
  let refreshKargonomi: typeof import('../backend/src/modules/shipping/shipping-execution.service.js')['refreshKargonomiShipmentProviderData'];
  let sequence = 0;

  beforeAll(async () => {
    const target = new URL(databaseUrl!);
    if (process.env.FIN_BUG_003_PHASE3_TEST_DATABASE_ISOLATED !== '1' ||
        !['127.0.0.1', 'localhost'].includes(target.hostname) ||
        target.pathname.slice(1) !== 'fin_bug_003_phase3_validation') {
      throw new Error('FIN-BUG-003 Phase 3 test requires isolated local fin_bug_003_phase3_validation.');
    }
    process.env.DATABASE_URL = databaseUrl;
    ({ recordVerifiedDeliveredObservation: record } = await import('../backend/src/modules/shipping/allocation-delivered-observation.service.js'));
    ({ refreshKargonomiShipmentProviderData: refreshKargonomi } = await import('../backend/src/modules/shipping/shipping-execution.service.js'));
    db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await db.$connect();
  });

  afterAll(async () => {
    await db?.$disconnect();
  });

  async function fixture(method: 'KARGONOMI' | 'VENDOR_INTEGRATION' | null) {
    const id = `delivery-${process.pid}-${Date.now()}-${++sequence}`;
    const vendor = await db.vendor.create({ data: { id, name: 'Delivery Test Vendor', status: 'inactive' } });
    const order = await db.shopifyOrder.create({ data: {
      sourceShopifyOrderId: id, sourceShopifyOrderNumber: `#${id}`,
    } });
    const allocation = await db.vendorAllocation.create({ data: {
      id, sourceShopifyOrderId: order.id, sourceShopifyOrderNumber: `#${id}`,
      originalVendorId: vendor.id, assignedVendorId: vendor.id,
      outboundMethodSnapshot: method,
      outboundIntegrationProviderSnapshot: method === 'VENDOR_INTEGRATION' ? 'SOPYO' : null,
    } });
    const execution = await db.shipmentExecution.create({ data: {
      id: `${id}-execution`, allocationId: id, vendorId: vendor.id, provider: 'KARGONOMI',
      providerShipmentId: `${id}-shipment`, shipmentStatus: 'DELIVERED', requestSnapshot: {},
    } });
    const client = await db.vendorIntegrationClient.create({ data: {
      vendorIdentifier: id, providerName: 'Sopyo-looking display name', providerCode: 'SOPYO',
      tokenHash: `${id}-coded`, scopes: ['shipment:write'],
    } });
    return { id, allocation, execution, client };
  }

  it('claims the first Kargonomi observation once and never advances it on replay', async () => {
    const { allocation, execution } = await fixture('KARGONOMI');
    const source = { method: 'KARGONOMI' as const, shipmentExecutionId: execution.id, sourceReference: execution.providerShipmentId! };
    const before = new Date();
    const first = await record({ allocationId: allocation.id, source }, db);
    const after = new Date();
    expect(first.firstObservedDeliveredAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(first.firstObservedDeliveredAt.getTime()).toBeLessThanOrEqual(after.getTime());
    await new Promise((resolve) => setTimeout(resolve, 10));
    for (let index = 0; index < 3; index++) {
      const replay = await record({ allocationId: allocation.id, source }, db);
      expect(replay.id).toBe(first.id);
      expect(replay.firstObservedDeliveredAt).toEqual(first.firstObservedDeliveredAt);
    }
    expect(await db.allocationDeliveredObservation.count({ where: { vendorAllocationId: allocation.id } })).toBe(1);
  });

  it('allows only the allocation snapshot source; null historical source stays unclaimed', async () => {
    const kargonomi = await fixture('KARGONOMI');
    const sopyo = await fixture('VENDOR_INTEGRATION');
    const historical = await fixture(null);
    await expect(record({ allocationId: kargonomi.id, source: {
      method: 'VENDOR_INTEGRATION', providerCode: 'SOPYO', clientId: kargonomi.client.id, sourceReference: 'order-1',
    } }, db)).rejects.toThrow('snapshot');
    await expect(record({ allocationId: sopyo.id, source: {
      method: 'KARGONOMI', shipmentExecutionId: sopyo.execution.id, sourceReference: sopyo.execution.providerShipmentId!,
    } }, db)).rejects.toThrow('snapshot');
    await expect(record({ allocationId: historical.id, source: {
      method: 'KARGONOMI', shipmentExecutionId: historical.execution.id, sourceReference: historical.execution.providerShipmentId!,
    } }, db)).rejects.toThrow('snapshot');
    expect(await db.allocationDeliveredObservation.count({ where: { vendorAllocationId: { in: [kargonomi.id, sopyo.id, historical.id] } } })).toBe(0);
  });

  it('requires an active explicitly coded same-vendor integration client, never providerName', async () => {
    const { id, allocation, client } = await fixture('VENDOR_INTEGRATION');
    await db.vendorShippingConfig.create({ data: { vendorId: id, outboundMethod: 'KARGONOMI' } });
    const legacy = await db.vendorIntegrationClient.create({ data: {
      vendorIdentifier: id, providerName: 'SOPYO', tokenHash: `${id}-legacy`, scopes: ['shipment:write'],
    } });
    const source = { method: 'VENDOR_INTEGRATION' as const, providerCode: 'SOPYO' as const, sourceReference: `${id}-provider-order` };
    await expect(record({ allocationId: allocation.id, source: { ...source, clientId: legacy.id } }, db)).rejects.toThrow('coded');
    const otherVendor = await fixture('VENDOR_INTEGRATION');
    await expect(record({ allocationId: allocation.id, source: { ...source, clientId: otherVendor.client.id } }, db)).rejects.toThrow('coded');
    const first = await record({ allocationId: allocation.id, source: { ...source, clientId: client.id } }, db);
    await expect(record({ allocationId: allocation.id, source: {
      ...source, clientId: client.id, sourceReference: 'different-provider-order',
    } }, db)).rejects.toThrow('Conflicting');
    await db.vendorIntegrationClient.update({ where: { id: client.id }, data: { revokedAt: new Date() } });
    const replacement = await db.vendorIntegrationClient.create({ data: {
      vendorIdentifier: id, providerName: 'Replacement', providerCode: 'SOPYO',
      tokenHash: `${id}-replacement`, scopes: ['shipment:write'],
    } });
    const replay = await record({ allocationId: allocation.id, source: { ...source, clientId: replacement.id } }, db);
    expect(replay.id).toBe(first.id);
    expect(replay.firstObservedDeliveredAt).toEqual(first.firstObservedDeliveredAt);
    expect(replay.vendorIntegrationClientId).toBe(client.id);
  });

  it('fails closed on competing reference and protects the row from direct update/delete', async () => {
    const { id, execution } = await fixture('KARGONOMI');
    const source = { method: 'KARGONOMI' as const, shipmentExecutionId: execution.id, sourceReference: execution.providerShipmentId! };
    const first = await record({ allocationId: id, source }, db);
    await expect(record({ allocationId: id, source: { ...source, sourceReference: 'other-shipment' } }, db)).rejects.toThrow();
    await expect(db.allocationDeliveredObservation.update({ where: { id: first.id }, data: { sourceReference: 'changed' } })).rejects.toThrow();
    await expect(db.allocationDeliveredObservation.delete({ where: { id: first.id } })).rejects.toThrow();
    expect(await db.allocationDeliveredObservation.findUniqueOrThrow({ where: { id: first.id } })).toMatchObject({ sourceReference: source.sourceReference });
  });

  it('concurrent duplicate workers leave exactly one durable observation', async () => {
    const { id, execution } = await fixture('KARGONOMI');
    const source = { method: 'KARGONOMI' as const, shipmentExecutionId: execution.id, sourceReference: execution.providerShipmentId! };
    const results = await Promise.all(Array.from({ length: 4 }, () => record({ allocationId: id, source }, db)));
    expect(new Set(results.map((result) => result.id)).size).toBe(1);
    expect(new Set(results.map((result) => result.firstObservedDeliveredAt.toISOString())).size).toBe(1);
    expect(await db.allocationDeliveredObservation.count({ where: { vendorAllocationId: id } })).toBe(1);
  });

  it('the database rejects direct insertion with provenance that contradicts the snapshot', async () => {
    const { id, client } = await fixture('KARGONOMI');
    await expect(db.allocationDeliveredObservation.create({ data: {
      vendorAllocationId: id, outboundMethod: 'VENDOR_INTEGRATION', outboundIntegrationProvider: 'SOPYO',
      vendorIntegrationClientId: client.id, sourceReference: 'provider-order',
    } })).rejects.toThrow();
    expect(await db.allocationDeliveredObservation.count({ where: { vendorAllocationId: id } })).toBe(0);
  });

  it('the exact Kargonomi delivered refresh records once; an unconfigured historical allocation does not', async () => {
    const selected = await fixture('KARGONOMI');
    const historical = await fixture(null);
    const adapter = {
      refreshProviderData: async (providerShipmentId: string) => ({
        providerShipmentId,
        trackingNumber: 'TEST-TRACK', trackingUrl: null, labelUrl: null,
        shipmentStatus: 'delivered' as const, shippingCost: null, shippingVat: null, currency: 'TRY',
        responseSnapshot: { providerStatus: 'webservice_shipment_delivered', shippingProviderName: 'Test Carrier' },
      }),
    } as Parameters<typeof refreshKargonomi>[1]['adapter'];
    const options = (vendorId: string) => ({
      vendorId,
      env: {} as Parameters<typeof refreshKargonomi>[1]['env'],
      adapter,
    });
    await refreshKargonomi(selected.execution.id, options(selected.id));
    const first = await db.allocationDeliveredObservation.findUniqueOrThrow({ where: { vendorAllocationId: selected.id } });
    expect(first).toMatchObject({ outboundMethod: 'KARGONOMI', sourceReference: selected.execution.providerShipmentId });
    await refreshKargonomi(selected.execution.id, options(selected.id));
    expect(await db.allocationDeliveredObservation.findUniqueOrThrow({ where: { vendorAllocationId: selected.id } })).toMatchObject({
      id: first.id, firstObservedDeliveredAt: first.firstObservedDeliveredAt,
    });
    await refreshKargonomi(historical.execution.id, options(historical.id));
    expect(await db.allocationDeliveredObservation.count({ where: { vendorAllocationId: historical.id } })).toBe(0);
  });

  it('the existing finance evaluator uses the canonical observation at a zero-day cutoff', async () => {
    const { id, execution } = await fixture('KARGONOMI');
    const { evaluateSaleSettlementDelay } = await import('../backend/src/modules/finance/settlement-delay-eligibility.service.js');
    const before = await db.vendorAllocation.findUniqueOrThrow({
      where: { id }, include: { fulfillment: true, deliveredObservation: true },
    });
    expect(evaluateSaleSettlementDelay({ entryType: 'SALE', settlementDelayDaysSnapshot: 0,
      vendorAllocation: before,
    }).eligible).toBe(false);
    await record({ allocationId: id, source: {
      method: 'KARGONOMI', shipmentExecutionId: execution.id, sourceReference: execution.providerShipmentId!,
    } }, db);
    const allocation = await db.vendorAllocation.findUniqueOrThrow({
      where: { id }, include: { fulfillment: true, deliveredObservation: true },
    });
    expect(allocation.deliveredObservation).not.toBeNull();
    expect(evaluateSaleSettlementDelay({ entryType: 'SALE', settlementDelayDaysSnapshot: 0,
      vendorAllocation: allocation,
    }, allocation.deliveredObservation!.firstObservedDeliveredAt).eligible).toBe(true);
  });

  it('projection-only delivered/tracking updates cannot create the authority', async () => {
    const { id } = await fixture('VENDOR_INTEGRATION');
    await db.vendorAllocation.update({ where: { id }, data: {
      shippingStatus: 'delivered', trackingNumber: 'TEST-TRACK', vendorIntegrationStatus: 'delivered',
    } });
    await db.fulfillment.create({ data: {
      vendorAllocationId: id, fulfillmentStatus: 'fulfilled',
      shipmentUpdatedAt: new Date('2020-01-01T00:00:00.000Z'),
    } });
    expect(await db.allocationDeliveredObservation.count({ where: { vendorAllocationId: id } })).toBe(0);
  });

  it('a generic delivered projection without the exact Kargonomi status cannot create an observation', async () => {
    const { id, execution } = await fixture('KARGONOMI');
    const adapter = { refreshProviderData: async (providerShipmentId: string) => ({
      providerShipmentId, trackingNumber: null, trackingUrl: null, labelUrl: null,
      shipmentStatus: 'delivered' as const, shippingCost: null, shippingVat: null, currency: 'TRY',
      responseSnapshot: { status: 'generic-delivered' },
    }) } as Parameters<typeof refreshKargonomi>[1]['adapter'];
    await refreshKargonomi(execution.id, {
      vendorId: id, env: {} as Parameters<typeof refreshKargonomi>[1]['env'], adapter,
    });
    expect(await db.allocationDeliveredObservation.count({ where: { vendorAllocationId: id } })).toBe(0);
  });
});
