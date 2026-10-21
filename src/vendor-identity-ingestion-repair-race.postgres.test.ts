import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppEnv } from '../backend/src/config/env.js';
import type { PrismaClient } from '../backend/node_modules/@prisma/client/index.js';

const testUrl = process.env.TEST_DATABASE_URL?.trim();
const describeWithPostgres = testUrl ? describe : describe.skip;
const databaseName = 'vendor_cutover_pkg2_race_pg16_20261021';

describeWithPostgres('orders/create and Current-State Repair same-order race on isolated PG16', () => {
  let db: PrismaClient;
  let ingest: typeof import('../backend/src/modules/shopify/order-ingestion.service.js')['ingestShopifyOrderWebhook'];
  let makeRepair: typeof import('../backend/src/modules/shopify/current-state-order-repair.service.js')['createCurrentStateOrderRepairService'];
  let acquireOrderLock: typeof import('../backend/src/modules/shopify/orders-create-ownership.service.js')['acquireShopifyOrderTransactionLock'];
  const orderId = '9012001';
  const createdAt = '2026-10-20T12:00:00.000Z';

  beforeAll(async () => {
    const target = new URL(testUrl!);
    if (process.env.VENDOR_CUTOVER_TEST_DATABASE_ISOLATED !== '1' ||
        target.protocol !== 'postgresql:' || target.hostname !== '127.0.0.1' || target.port !== '5433' ||
        target.pathname !== `/${databaseName}` || target.searchParams.get('schema') !== 'public') {
      throw new Error('Same-order race test refused an unapproved database target.');
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
      database: databaseName, owner: 'onur', port: 5433,
      version: '160015', dataDirectory: '/opt/homebrew/var/postgresql@16',
    });
    expect(String(identity.systemId)).toBe('7689856229225255193');
    expect(await db.vendor.count()).toBe(0);
    ({ ingestShopifyOrderWebhook: ingest } = await import('../backend/src/modules/shopify/order-ingestion.service.js'));
    ({ createCurrentStateOrderRepairService: makeRepair } = await import('../backend/src/modules/shopify/current-state-order-repair.service.js'));
    ({ acquireShopifyOrderTransactionLock: acquireOrderLock } = await import('../backend/src/modules/shopify/orders-create-ownership.service.js'));
    await db.vendor.createMany({ data: [
      { id: 'sporjinal', name: 'Historical test vendor' },
      { id: 'other-race-vendor', name: 'Conflicting test vendor' },
    ] });
    await db.vendorFinancialProfile.createMany({ data: [
      { vendorId: 'sporjinal' }, { vendorId: 'other-race-vendor' },
    ] });
  });

  afterAll(async () => {
    await db?.$disconnect();
  });

  function snapshot(seller = 'sporjinal', sourceOrderId = orderId) {
    return {
      orderGid: `gid://shopify/Order/${sourceOrderId}`, sourceShopifyOrderId: sourceOrderId,
      sourceShopifyOrderNumber: `#${sourceOrderId}`, shopifyCreatedAt: createdAt,
      currency: 'TRY', financialStatus: 'paid', cancelledAt: null, cancelReason: null,
      paymentGatewayName: 'shopify_payments', taxesIncluded: true,
      orderTaxAmount: '16.67', shippingAmount: '0.00', discountAmount: '0.00', totalPrice: '100.00',
      orderNote: null, orderTags: [], customerName: null, customerEmail: null, customerPhone: null,
      billingFullName: null, billingCompany: null, billingPhone: null, billingCity: null,
      billingDistrict: null, billingAddress1: null, billingAddress2: null, billingPostcode: null,
      shippingCountry: 'TR', shippingPostcode: null, shippingCity: null, shippingDistrict: null,
      shippingAddress: null, sellerInfo: { 'SKU-RACE': seller },
      lineItems: [{
        lineItemGid: `gid://shopify/LineItem/${sourceOrderId}01`, sourceLineItemId: `${sourceOrderId}01`,
        shopifyProductId: '2001', sourceVariantId: '3001', sku: 'SKU-RACE', title: 'Race fixture',
        imageUrl: null, quantity: 1, currentQuantity: 1, refundableQuantity: 1,
        unitPrice: '100.00', unitPriceVatIncluded: '100.00', lineTotalVatIncluded: '100.00',
        lineTaxAmount: '16.67', vatRate: '20.00',
      }], fulfillmentOrders: [], source: 'mock',
    };
  }

  function repair(seller = 'sporjinal', sourceOrderId = orderId) {
    const env = {
      NODE_ENV: 'test', SHOPIFY_API_VERSION: '2026-01',
      SHOPIFY_MOCK_CANONICAL_ORDER_SNAPSHOT: JSON.stringify({ [sourceOrderId]: snapshot(seller, sourceOrderId) }),
      SHOPIFY_MOCK_CANONICAL_REFUNDS: JSON.stringify({ [sourceOrderId]: {
        refunds: [], refundsListComplete: true, orderTotalRefundedAmount: '0.00',
        orderTotalRefundedCurrencyCode: 'TRY',
      } }),
      SHOPIFY_MOCK_CANONICAL_RETURNS: JSON.stringify({ [sourceOrderId]: [] }),
    } as unknown as AppEnv;
    return makeRepair(env).repair({
      orderIdentifier: sourceOrderId, execute: true,
      actor: { userId: 'race-admin', email: 'race-admin@example.test' },
    });
  }

  async function ingestOrder(eventId: string, sourceOrderId = orderId) {
    const event = await db.webhookEvent.create({ data: {
      sourceShopDomain: 'pkg2-race.test', topic: 'orders/create', webhookId: eventId,
      sourceShopifyOrderId: sourceOrderId, status: 'PROCESSED',
    } });
    return ingest({
      event, sellerInfo: { 'SKU-RACE': 'sporjinal' },
      payload: {
        id: sourceOrderId, name: `#${sourceOrderId}`, currency: 'TRY', total_price: '100.00', created_at: createdAt,
        line_items: [{ id: `${sourceOrderId}01`, sku: 'SKU-RACE', title: 'Race fixture', quantity: 1, price: '100.00' }],
      },
    });
  }

  it('serializes ingestion and repair; preserves one order, allocation and SALE', async () => {
    let releaseLock!: () => void;
    let lockHeld!: () => void;
    const held = new Promise<void>((resolve) => { lockHeld = resolve; });
    const released = new Promise<void>((resolve) => { releaseLock = resolve; });
    const blocker = db.$transaction(async (tx) => {
      await acquireOrderLock(tx, orderId);
      lockHeld();
      await released;
    }, { timeout: 10_000 });
    await held;
    const concurrent = Promise.allSettled([ingestOrder('same-order-ingestion'), repair()]);
    try {
      let blocked = false;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const [state] = await db.$queryRaw<Array<{ waiting: bigint }>>`
          SELECT count(*)::bigint AS waiting FROM pg_stat_activity
          WHERE datname = current_database() AND cardinality(pg_blocking_pids(pid)) > 0
        `;
        if (Number(state.waiting) >= 2) { blocked = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(blocked).toBe(true);
    } finally {
      releaseLock();
      await blocker;
    }
    const [ingestion, repairResult] = await concurrent;
    expect(ingestion).toMatchObject({ status: 'fulfilled', value: { ok: true } });
    if (repairResult.status === 'rejected') {
      expect(['repair_plan_stale', 'active_shopify_order_intake']).toContain(
        (repairResult.reason as { code?: string }).code,
      );
    } else {
      expect(repairResult.value).toMatchObject({ ok: true, executed: true });
    }
    const orders = await db.shopifyOrder.findMany({ where: { sourceShopifyOrderId: orderId }, include: {
      lineItems: true, allocations: { include: { financeEntries: { where: { entryType: 'sale' } } } },
    } });
    expect(orders).toHaveLength(1);
    expect(orders[0]!.lineItems).toHaveLength(1);
    expect(orders[0]!.lineItems[0]!.originalVendorId).toBe('sporjinal');
    expect(orders[0]!.allocations).toHaveLength(1);
    expect(orders[0]!.allocations[0]!.originalVendorId).toBe('sporjinal');
    expect(orders[0]!.allocations[0]!.financeEntries).toHaveLength(1);
    expect(await db.vendorAllocation.count({ where: { originalVendorId: 'other-race-vendor' } })).toBe(0);
    expect(await db.financeLedgerEntry.count({ where: { entryType: 'sale' } })).toBe(1);
  });

  it('rejects conflicting repair owner without partial allocation or financial writes', async () => {
    await expect(repair('other-race-vendor')).rejects.toMatchObject({ code: 'vendor_ownership_conflict' });
    const order = await db.shopifyOrder.findUniqueOrThrow({ where: { sourceShopifyOrderId: orderId }, include: {
      lineItems: true, allocations: { include: { financeEntries: { where: { entryType: 'sale' } } } },
    } });
    expect(order.lineItems).toHaveLength(1);
    expect(order.lineItems[0]!.originalVendorId).toBe('sporjinal');
    expect(order.allocations).toHaveLength(1);
    expect(order.allocations[0]!.originalVendorId).toBe('sporjinal');
    expect(order.allocations[0]!.financeEntries).toHaveLength(1);
    expect(await db.vendorAllocation.count({ where: { originalVendorId: 'other-race-vendor' } })).toBe(0);
  });

  it('rolls back both same-order writers when SALE ledger persistence fails', async () => {
    const failedOrderId = '9012002';
    await db.$executeRawUnsafe(`
      CREATE FUNCTION pkg2_reject_sale_ledger() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW."vendorAllocationId" = 'alloc-sporjinal-9012002' THEN
          RAISE EXCEPTION 'isolated Package 2 ledger fault';
        END IF;
        RETURN NEW;
      END $$
    `);
    await db.$executeRawUnsafe(`
      CREATE TRIGGER pkg2_reject_sale_ledger BEFORE INSERT ON "FinanceLedgerEntry"
      FOR EACH ROW EXECUTE FUNCTION pkg2_reject_sale_ledger()
    `);
    try {
      const [ingestion, repairResult] = await Promise.allSettled([
        ingestOrder('failed-ledger-ingestion', failedOrderId), repair('sporjinal', failedOrderId),
      ]);
      expect(ingestion).toMatchObject({ status: 'fulfilled', value: { ok: false } });
      expect(repairResult.status).toBe('rejected');
      expect(await db.shopifyOrder.count({ where: { sourceShopifyOrderId: failedOrderId } })).toBe(0);
      expect(await db.vendorAllocation.count({ where: { id: `alloc-sporjinal-${failedOrderId}` } })).toBe(0);
      expect(await db.financeLedgerEntry.count({ where: { vendorAllocationId: `alloc-sporjinal-${failedOrderId}` } })).toBe(0);
    } finally {
      await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS pkg2_reject_sale_ledger ON "FinanceLedgerEntry"');
      await db.$executeRawUnsafe('DROP FUNCTION IF EXISTS pkg2_reject_sale_ledger()');
    }
  });
});
