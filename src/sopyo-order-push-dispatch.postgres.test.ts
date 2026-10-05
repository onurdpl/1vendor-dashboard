import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '../backend/node_modules/@prisma/client/index.js';
import { dispatchSopyoOrderPush } from '../backend/src/modules/vendor-integration/sopyo-order-push-dispatch.service.js';

const databaseUrl = process.env.TEST_DATABASE_URL?.trim();
const describeWithPostgres = databaseUrl ? describe : describe.skip;

describeWithPostgres('Sopyo order-push claim on isolated PostgreSQL', () => {
  let db: PrismaClient;
  const suffix = `${process.pid}-${Date.now()}`;
  const vendorId = `sopyo-dispatch-${suffix}`;
  const sourceId = `sopyo-dispatch-order-${suffix}`;
  const allocationId = `alloc-${sourceId}`;
  let pushId: string;

  beforeAll(async () => {
    const target = new URL(databaseUrl!);
    if (process.env.SOPYO_ORDER_PUSH_TEST_DATABASE_ISOLATED !== '1' ||
        !['localhost', '127.0.0.1'].includes(target.hostname) ||
        target.pathname.slice(1) !== 'sopyo_order_push_dispatch_validation') {
      throw new Error('Sopyo dispatcher test requires isolated local sopyo_order_push_dispatch_validation.');
    }
    db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await db.$connect();
    await db.vendor.create({ data: { id: vendorId, name: vendorId } });
    const order = await db.shopifyOrder.create({ data: {
      sourceShopifyOrderId: sourceId, sourceShopifyOrderNumber: '#dispatch-test',
      currency: 'TRY', totalPrice: '100.00', discountAmount: '0.00', shippingAmount: '0.00',
      taxesIncluded: true, customerName: 'Customer Person', customerEmail: 'private@example.invalid',
      customerPhone: '05551112233', shippingAddress: 'Street 1, Apt 2 \u2060Kartal',
      shippingCity: 'Istanbul', shippingDistrict: 'Apt 2 \u2060Kartal',
      billingFullName: 'Billing Person', billingPhone: '05554445566',
      billingCity: 'Istanbul', billingDistrict: 'Suite 3 \u2060Kadıköy',
    } });
    const line = await db.shopifyOrderLineItem.create({ data: {
      shopifyOrderId: order.id, sourceLineItemId: `${sourceId}-line`, sku: 'SKU', title: 'Product', quantity: 1,
      unitPrice: '100.00', unitPriceVatIncluded: '100.00', lineTotalVatIncluded: '100.00',
    } });
    await db.vendorAllocation.create({ data: {
      id: allocationId, sourceShopifyOrderId: order.id, sourceShopifyOrderNumber: '#dispatch-test',
      originalVendorId: vendorId, assignedVendorId: vendorId,
      outboundMethodSnapshot: 'VENDOR_INTEGRATION', outboundIntegrationProviderSnapshot: 'SOPYO',
    } });
    await db.vendorAllocationLineItem.create({ data: {
      vendorAllocationId: allocationId, shopifyLineItemId: line.id, quantity: 1, lineAmount: '100.00',
    } });
    await db.webhookEvent.create({ data: {
      sourceShopDomain: 'sopyo-dispatch.test', topic: 'orders/create', webhookId: suffix,
      shopifyOrderId: order.id, sourceShopifyOrderId: sourceId, status: 'PROCESSED',
      rawPayload: JSON.stringify({
        id: sourceId, customer: { first_name: 'Customer', last_name: 'Person', email: 'private@example.invalid' },
        shipping_address: { name: 'Shipping Recipient', phone: '0555 111 22 33', address1: 'Street 1',
          address2: 'Apt 2 \u2060Kartal', country_code: 'TR', city: 'Istanbul' },
        billing_address: { name: 'Billing Person', phone: '0555 444 55 66', address1: 'Billing Street',
          address2: 'Suite 3 \u2060Kadıköy', country_code: 'TR', city: 'Istanbul' },
      }),
    } });
    const push = await db.sopyoOrderPush.create({ data: {
      vendorAllocationId: allocationId, assignedVendorId: vendorId, orderCode: allocationId,
    } });
    pushId = push.id;
  });

  afterAll(async () => {
    if (!db) return;
    await db.sopyoOrderPush.deleteMany({ where: { vendorAllocationId: allocationId } });
    await db.webhookEvent.deleteMany({ where: { sourceShopifyOrderId: sourceId } });
    await db.vendorAllocationLineItem.deleteMany({ where: { vendorAllocationId: allocationId } });
    await db.vendorAllocation.deleteMany({ where: { id: allocationId } });
    await db.shopifyOrder.deleteMany({ where: { sourceShopifyOrderId: sourceId } });
    await db.vendor.deleteMany({ where: { id: vendorId } });
    await db.$disconnect();
  });

  it('lets only one real PostgreSQL claimant issue a Sopyo create POST', async () => {
    let releasePost!: () => void;
    const postGate = new Promise<void>((resolve) => { releasePost = resolve; });
    const calls = vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith('/auth/login')) return new Response(JSON.stringify({ access_token: { token: 'bearer', type: 'bearer' } }));
      if (init.method === 'GET') return new Response(JSON.stringify({ data: [], meta: { current_page: 1, last_page: 1 } }));
      await postGate;
      return new Response(JSON.stringify({ data: { id: 123, order_code: allocationId, order_type: 'SOPYOAPI' } }), { status: 201 });
    });
    const options = { pushId, db: db as never, fetcher: calls as never, loadCredential: async (id: string) => {
      expect(id).toBe(vendorId); return 'safe-test-token';
    } };
    const first = dispatchSopyoOrderPush(options);
    await vi.waitFor(() => expect(calls.mock.calls.filter(([url, init]) =>
      String(url).endsWith('/api/v2/orders') && (init as RequestInit).method === 'POST')).toHaveLength(1));
    const second = await dispatchSopyoOrderPush(options);
    expect(second).toMatchObject({ status: 'NOT_CLAIMED' });
    releasePost();
    expect(await first).toMatchObject({ status: 'SUCCEEDED', result: 'CREATED', sopyoOrderId: 123 });
    expect(await db.sopyoOrderPush.findUniqueOrThrow({ where: { id: pushId } })).toMatchObject({
      status: 'SUCCEEDED', sopyoOrderId: '123', claimToken: null,
    });
    expect(calls.mock.calls.filter(([url, init]) =>
      String(url).endsWith('/api/v2/orders') && (init as RequestInit).method === 'POST')).toHaveLength(1);
  });
});
