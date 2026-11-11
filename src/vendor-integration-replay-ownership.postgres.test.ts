import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../backend/node_modules/@prisma/client/index.js';

const databaseUrl = process.env.TEST_DATABASE_URL?.trim();
const databaseName = 'p5_05a_replay_validation';

describe.skipIf(!databaseUrl)('Vendor Integration replay ownership on isolated PostgreSQL', () => {
  let db: PrismaClient;
  let app: import('../backend/node_modules/fastify/types/instance.js').FastifyInstance;
  let rejectAllocation: typeof import('../backend/src/modules/orders/orders.service.js')['rejectVendorOrderAllocation'];
  let transferEconomics: typeof import('../backend/src/modules/finance/economic-transfer.service.js')['transferAllocationEconomics'];
  let hashToken: typeof import('../backend/src/modules/vendor-integration/vendor-integration.tokens.js')['hashVendorIntegrationToken'];
  let sequence = 0;

  beforeAll(async () => {
    const target = new URL(databaseUrl!);
    if (process.env.P5_05A_TEST_DATABASE_ISOLATED !== '1' ||
        target.protocol !== 'postgresql:' || target.hostname !== '127.0.0.1' ||
        target.port !== '5432' || target.pathname !== `/${databaseName}` ||
        target.search !== '?schema=public') {
      throw new Error('Replay ownership tests require the exact isolated local PostgreSQL database.');
    }
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = databaseUrl;
    db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await db.$connect();
    const [identity] = await db.$queryRaw<Array<{ database: string; version: string }>>`
      SELECT current_database() AS database, current_setting('server_version_num') AS version
    `;
    expect(identity.database).toBe(databaseName);
    expect(Math.floor(Number(identity.version) / 10000)).toBe(18);
    expect(await db.vendor.count()).toBe(0);
    expect(await db.vendorAllocation.count()).toBe(0);

    ({ rejectVendorOrderAllocation: rejectAllocation } = await import('../backend/src/modules/orders/orders.service.js'));
    ({ transferAllocationEconomics: transferEconomics } = await import('../backend/src/modules/finance/economic-transfer.service.js'));
    ({ hashVendorIntegrationToken: hashToken } = await import('../backend/src/modules/vendor-integration/vendor-integration.tokens.js'));
    const { default: Fastify } = await import('../backend/node_modules/fastify/fastify.js');
    const { registerVendorIntegrationRoutes } = await import('../backend/src/modules/vendor-integration/vendor-integration.routes.js');
    app = Fastify();
    registerVendorIntegrationRoutes(app);
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    await db?.$disconnect();
  });

  async function fixture(scope: 'status:write' | 'invoice:write' | 'shipment:write') {
    const id = `p5-05a-${process.pid}-${++sequence}`;
    const vendorA = `${id}-a`;
    const vendorB = `${id}-b`;
    const orderId = `${id}-order`;
    const token = `spg_vi_isolated_${id}`;
    await db.vendor.createMany({ data: [
      { id: vendorA, name: 'Replay Vendor A' },
      { id: vendorB, name: 'Replay Vendor B' },
    ] });
    await db.shopifyOrder.create({ data: {
      id: orderId, sourceShopifyOrderId: `gid://shopify/Order/${id}`,
      sourceShopifyOrderNumber: `#${id}`,
    } });
    await db.vendorAllocation.create({ data: {
      id, sourceShopifyOrderId: orderId, sourceShopifyOrderNumber: `#${id}`,
      originalVendorId: vendorA, assignedVendorId: vendorA,
    } });
    await db.financeLedgerEntry.create({ data: {
      id: `${id}-sale`, vendorAllocationId: id, vendorId: vendorA,
      entryType: 'sale', amount: '100.00',
    } });
    await db.vendorIntegrationClient.create({ data: {
      vendorIdentifier: vendorA, providerName: 'Isolated provider', providerCode: null,
      tokenHash: hashToken(token), scopes: [scope],
    } });
    return { id, vendorA, vendorB, token };
  }

  function post(source: Awaited<ReturnType<typeof fixture>>, kind: 'status' | 'invoice' | 'shipment', key: string) {
    return app.inject({
      method: 'POST',
      url: `/api/vendor-integration/orders/${source.id}/${kind}`,
      headers: { authorization: `Bearer ${source.token}`, 'idempotency-key': key },
      payload: kind === 'status'
        ? { status: 'acknowledged', message: 'Vendor A status' }
        : kind === 'invoice'
          ? { invoiceNumber: 'A-INV-1', invoiceDate: '2026-11-11', invoiceAmount: '100.00' }
          : { carrier: 'Test carrier', trackingNumber: 'TRACK-A-1' },
    });
  }

  async function transfer(source: Awaited<ReturnType<typeof fixture>>) {
    await rejectAllocation(source.vendorA, source.id, {
      reason: 'VENDOR_CANCELLED', note: 'Isolated ownership transfer test',
    });
    const result = await transferEconomics({
      vendorAllocationId: source.id, toVendorId: source.vendorB,
      reason: 'Isolated ownership transfer test', confirmTransfer: true,
    });
    expect(result.status).toBe('COMPLETED');
    expect((await db.vendorAllocation.findUniqueOrThrow({ where: { id: source.id } })).assignedVendorId)
      .toBe(source.vendorB);
  }

  it.each(['status', 'invoice'] as const)(
    'denies former Vendor replay of a %s event after supported economic transfer', async (kind) => {
      const source = await fixture(kind === 'status' ? 'status:write' : 'invoice:write');
      const key = `${source.id}-key`;
      const first = await post(source, kind, key);
      expect(first.statusCode).toBe(200);
      expect(first.json().idempotent).toBe(false);
      const authorizedReplay = await post(source, kind, key);
      expect(authorizedReplay.statusCode).toBe(200);
      expect(authorizedReplay.json()).toMatchObject({ idempotent: true, allocation: {
        vendorIdentifier: source.vendorA,
      } });

      await transfer(source);
      const before = await db.vendorAllocation.findUniqueOrThrow({ where: { id: source.id } });
      const count = kind === 'status'
        ? await db.vendorIntegrationStatusEvent.count({ where: { vendorAllocationId: source.id } })
        : await db.vendorIntegrationInvoiceEvent.count({ where: { vendorAllocationId: source.id } });
      const denied = await post(source, kind, key);
      expect(denied.statusCode).toBe(404);
      expect(denied.json()).toEqual({ message: 'Vendor allocation not found.' });
      expect(denied.body).not.toContain(source.vendorB);
      expect(await db.vendorAllocation.findUniqueOrThrow({ where: { id: source.id } })).toEqual(before);
      expect(kind === 'status'
        ? await db.vendorIntegrationStatusEvent.count({ where: { vendorAllocationId: source.id } })
        : await db.vendorIntegrationInvoiceEvent.count({ where: { vendorAllocationId: source.id } }))
        .toBe(count);
    },
  );

  it('preserves shipment replay because shipment evidence blocks the supported transfer path', async () => {
    const source = await fixture('shipment:write');
    const key = `${source.id}-key`;
    const first = await post(source, 'shipment', key);
    expect(first.statusCode).toBe(200);
    const replay = await post(source, 'shipment', key);
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toMatchObject({ idempotent: true, allocation: {
      vendorIdentifier: source.vendorA, trackingNumber: 'TRACK-A-1',
    } });
    await expect(rejectAllocation(source.vendorA, source.id, {
      reason: 'VENDOR_CANCELLED', note: 'Shipment blocks reassignment',
    })).rejects.toThrow('Order cannot be rejected after fulfillment, shipment, carrier, or tracking evidence exists.');
    expect((await db.vendorAllocation.findUniqueOrThrow({ where: { id: source.id } })).assignedVendorId)
      .toBe(source.vendorA);
  });
});
