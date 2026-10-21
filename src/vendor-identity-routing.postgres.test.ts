import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../backend/node_modules/@prisma/client/index.js';

const testUrl = process.env.TEST_DATABASE_URL?.trim();
const describeWithPostgres = testUrl ? describe : describe.skip;

describeWithPostgres('vendor identity order routing on isolated PostgreSQL', () => {
  let db: PrismaClient;
  let ingest: typeof import('../backend/src/modules/shopify/order-ingestion.service.js')['ingestShopifyOrderWebhook'];
  const oldVendor = 'sporjinal';
  const newVendor = 'demo-sporjinal-pkg2';

  beforeAll(async () => {
    const target = new URL(testUrl!);
    if (process.env.VENDOR_CUTOVER_TEST_DATABASE_ISOLATED !== '1' ||
        target.protocol !== 'postgresql:' || target.hostname !== '127.0.0.1' || target.port !== '5433' ||
        target.pathname !== '/vendor_cutover_pkg2_pg16_20261021_0849' ||
        target.searchParams.get('schema') !== 'public') {
      throw new Error('Vendor identity PostgreSQL test refused an unapproved database target.');
    }
    process.env.DATABASE_URL = testUrl;
    const { PrismaClient } = await import('../backend/node_modules/@prisma/client/index.js');
    db = new PrismaClient({ datasources: { db: { url: testUrl } } });
    await db.$connect();
    const [identity] = await db.$queryRaw<Array<{
      database: string; owner: string; port: number; version: string; dataDirectory: string; systemId: bigint;
    }>>`
      SELECT current_database() AS database, current_user AS owner, inet_server_port() AS port,
        current_setting('server_version_num') AS version, current_setting('data_directory') AS "dataDirectory",
        (pg_control_system()).system_identifier AS "systemId"
    `;
    expect(identity).toMatchObject({
      database: 'vendor_cutover_pkg2_pg16_20261021_0849', owner: 'onur', port: 5433,
      version: '160015', dataDirectory: '/opt/homebrew/var/postgresql@16',
    });
    expect(String(identity.systemId)).toBe('7689856229225255193');
    expect(await db.vendor.count()).toBe(0);
    ({ ingestShopifyOrderWebhook: ingest } = await import('../backend/src/modules/shopify/order-ingestion.service.js'));
    await db.user.create({ data: { id: 'pkg2-admin', email: 'pkg2-admin@example.test', name: 'Package 2 Admin', role: 'ADMIN', passwordHash: 'not-a-login' } });
    await db.vendor.createMany({ data: [
      { id: oldVendor, name: 'Old test Sporjinal' },
      { id: newVendor, name: 'New test Sporjinal' },
    ] });
    await db.vendorFinancialProfile.createMany({ data: [
      { vendorId: oldVendor }, { vendorId: newVendor },
    ] });
    await db.vendorIdentityCutover.create({ data: {
      externalSellerSlug: oldVendor, previousVendorId: oldVendor, replacementVendorId: newVendor,
      approvedCutoverAt: new Date('2026-11-01T12:00:00.000Z'), active: true,
      activatedAt: new Date('2026-10-31T12:00:00.000Z'),
      approvedAt: new Date('2026-10-30T12:00:00.000Z'),
      createdByUserId: 'pkg2-admin', approvedByUserId: 'pkg2-admin',
    } });
  });

  afterAll(async () => {
    await db?.$disconnect();
  });

  async function ingestOrder(orderId: string, createdAtUtc: string, eventId: string) {
    const event = await db.webhookEvent.create({ data: {
      sourceShopDomain: 'pkg2.test', topic: 'orders/create', webhookId: eventId,
      sourceShopifyOrderId: orderId,
    } });
    return ingest({
      event,
      sellerInfo: { 'SKU-1': oldVendor },
      canonicalOrder: { orderGid: `gid://shopify/Order/${orderId}`, createdAtUtc, source: 'SHOPIFY_ADMIN_GRAPHQL' },
      payload: {
        id: orderId, name: `#${orderId}`, currency: 'TRY', total_price: '100.00',
        created_at: createdAtUtc,
        line_items: [{ id: `${orderId}01`, sku: 'SKU-1', title: 'Local test', quantity: 1, price: '100.00' }],
      },
    });
  }

  it('keeps historical and new orders financially isolated and replay-idempotent', async () => {
    expect((await ingestOrder('9001001', '2026-10-31T12:00:00Z', 'old-1')).ok).toBe(true);
    expect((await ingestOrder('9001002', '2026-11-01T12:00:00.000Z', 'new-1')).ok).toBe(true);
    expect((await ingestOrder('9001002', '2026-11-01T12:00:00.000Z', 'new-2')).ok).toBe(true);
    const oldAllocation = await db.vendorAllocation.findUniqueOrThrow({ where: { id: 'alloc-sporjinal-9001001' } });
    const newAllocation = await db.vendorAllocation.findUniqueOrThrow({ where: { id: `alloc-${newVendor}-9001002` } });
    expect(oldAllocation.originalVendorId).toBe(oldVendor);
    expect(newAllocation.originalVendorId).toBe(newVendor);
    expect(await db.vendorAllocation.count({ where: { sourceShopifyOrderId: newAllocation.sourceShopifyOrderId } })).toBe(1);
    expect(await db.financeLedgerEntry.count({ where: { vendorAllocationId: newAllocation.id, entryType: 'sale' } })).toBe(1);
    const conflictingReplay = await ingestOrder('9001002', '2026-10-31T12:00:00Z', 'new-conflict');
    expect(conflictingReplay).toMatchObject({ ok: false, failureCode: 'vendor_ownership_conflict' });
    expect(await db.vendorAllocation.count({ where: { sourceShopifyOrderId: newAllocation.sourceShopifyOrderId } })).toBe(1);
  });

  it('serializes concurrent ingestion for the same Shopify order without duplicate economic claims', async () => {
    const outcomes = await Promise.all([
      ingestOrder('9001003', '2026-11-02T00:00:00Z', 'concurrent-1'),
      ingestOrder('9001003', '2026-11-02T00:00:00Z', 'concurrent-2'),
    ]);
    expect(outcomes.some((outcome) => outcome.ok)).toBe(true);
    const allocation = await db.vendorAllocation.findUniqueOrThrow({ where: { id: `alloc-${newVendor}-9001003` } });
    expect(await db.vendorAllocation.count({ where: { sourceShopifyOrderId: allocation.sourceShopifyOrderId } })).toBe(1);
    expect(await db.financeLedgerEntry.count({ where: { vendorAllocationId: allocation.id, entryType: 'sale' } })).toBe(1);
  });
});
