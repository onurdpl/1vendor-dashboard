import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '../backend/node_modules/@prisma/client/index.js';

const databaseUrl = process.env.TEST_DATABASE_URL?.trim();
const describeWithPostgres = databaseUrl ? describe : describe.skip;

vi.mock('../backend/src/modules/finance/sale-ledger.service.js', () => ({
  upsertSaleLedgerForAllocation: vi.fn(async () => undefined),
}));

describeWithPostgres('Sopyo order push intent on isolated PostgreSQL', () => {
  let db: PrismaClient;
  let ingest: typeof import('../backend/src/modules/shopify/order-ingestion.service.js')['ingestShopifyOrderWebhook'];
  const suffix = `${process.pid}-${Date.now()}`;
  const vendorIds = [`sopyo-push-a-${suffix}`, `sopyo-push-b-${suffix}`];
  const sourceOrderId = `sopyo-push-order-${suffix}`;
  const allocationIds = vendorIds.map((vendorId) => `alloc-${vendorId}-${sourceOrderId}`);

  beforeAll(async () => {
    const target = new URL(databaseUrl!);
    if (process.env.SOPYO_ORDER_PUSH_TEST_DATABASE_ISOLATED !== '1' ||
        !['127.0.0.1', 'localhost'].includes(target.hostname) ||
        !['sopyo_order_push_validation', 'sopyo_order_push_dispatch_validation'].includes(target.pathname.slice(1))) {
      throw new Error('Sopyo order push test requires an explicitly isolated local Sopyo push validation database.');
    }
    process.env.DATABASE_URL = databaseUrl;
    ({ ingestShopifyOrderWebhook: ingest } = await import('../backend/src/modules/shopify/order-ingestion.service.js'));
    db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await db.$connect();
    await db.vendor.createMany({ data: vendorIds.map((id) => ({ id, name: id })) });
    await db.vendorShippingConfig.createMany({ data: vendorIds.map((vendorId) => ({
      vendorId,
      outboundMethod: 'VENDOR_INTEGRATION',
      selectedIntegrationProvider: 'SOPYO',
    })) });
    expect((await processOrder(`sopyo-push-first-${suffix}`)).ok).toBe(true);
  });

  afterAll(async () => {
    if (!db) return;
    await db.sopyoOrderPush.deleteMany({ where: { vendorAllocationId: { in: allocationIds } } });
    await db.shopifyOrder.deleteMany({ where: { sourceShopifyOrderId: sourceOrderId } });
    await db.webhookEvent.deleteMany({ where: { sourceShopifyOrderId: sourceOrderId } });
    await db.vendorShippingConfig.deleteMany({ where: { vendorId: { in: vendorIds } } });
    await db.vendor.deleteMany({ where: { id: { in: vendorIds } } });
    await db.$disconnect();
  });

  async function processOrder(webhookId: string) {
    const event = await db.webhookEvent.create({ data: {
      sourceShopDomain: 'sopyo-push.test',
      topic: 'orders/create',
      webhookId,
      sourceShopifyOrderId: sourceOrderId,
    } });
    return ingest({
      event,
      sellerInfo: { 'SKU-A': vendorIds[0], 'SKU-B': vendorIds[1] },
      payload: {
        id: sourceOrderId,
        name: `#${sourceOrderId}`,
        currency: 'TRY',
        total_price: '200.00',
        customer: { first_name: 'Private', last_name: 'Customer', email: 'private@example.test' },
        line_items: [
          { id: `${sourceOrderId}-a`, sku: 'SKU-A', title: 'A', quantity: 1, price: '100.00' },
          { id: `${sourceOrderId}-b`, sku: 'SKU-B', title: 'B', quantity: 1, price: '100.00' },
        ],
      },
    });
  }

  it('commits one PENDING intent per eligible allocation after both allocation lines, preserving vendor identity without PII', async () => {
    const rows = await db.sopyoOrderPush.findMany({
      where: { vendorAllocationId: { in: allocationIds } }, orderBy: { vendorAllocationId: 'asc' },
    });
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      const allocation = await db.vendorAllocation.findUniqueOrThrow({
        where: { id: row.vendorAllocationId }, include: { lineItems: true },
      });
      expect(allocation.lineItems).toHaveLength(1);
      expect(row).toMatchObject({
        assignedVendorId: allocation.assignedVendorId,
        orderCode: allocation.id,
        status: 'PENDING',
      });
      expect(Object.keys(row).sort()).toEqual([
        'assignedVendorId', 'claimToken', 'completedAt', 'createdAt', 'httpStatus', 'id', 'orderCode',
        'processingStartedAt', 'reasonCode', 'sopyoOrderId', 'status', 'updatedAt', 'vendorAllocationId',
      ]);
      expect(row.claimToken).toBeNull();
      expect(row.sopyoOrderId).toBeNull();
      expect(JSON.stringify(row)).not.toContain('Private');
      expect(JSON.stringify(row)).not.toContain('private@example.test');
    }
  });

  it('preserves original intents on ingestion replay and enforces unique allocation ownership in PostgreSQL', async () => {
    const before = await db.sopyoOrderPush.findMany({ where: { vendorAllocationId: { in: allocationIds } } });
    expect((await processOrder(`sopyo-push-replay-${suffix}`)).ok).toBe(true);
    expect(await db.sopyoOrderPush.findMany({ where: { vendorAllocationId: { in: allocationIds } } })).toEqual(before);
    await expect(db.sopyoOrderPush.create({ data: {
      vendorAllocationId: allocationIds[0], assignedVendorId: vendorIds[0], orderCode: allocationIds[0],
    } })).rejects.toMatchObject({ code: 'P2002' });
    expect(await db.sopyoOrderPush.count({ where: { vendorAllocationId: { in: allocationIds } } })).toBe(2);
  });
});
