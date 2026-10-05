import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '../backend/node_modules/@prisma/client/index.js';
import { dispatchSopyoOrderPush } from '../backend/src/modules/vendor-integration/sopyo-order-push-dispatch.service.js';

const pushId = 'cm12345678901234567890123';
const allocationId = 'alloc-test-order';
const d = (value: string) => new Prisma.Decimal(value);

function setup() {
  const push = {
    id: pushId, vendorAllocationId: allocationId, assignedVendorId: 'vendor-a', orderCode: allocationId,
    status: 'PENDING', claimToken: null as string | null, processingStartedAt: null as Date | null,
    completedAt: null as Date | null, sopyoOrderId: null as string | null,
    reasonCode: null as string | null, httpStatus: null as number | null,
  };
  const allocation = {
    id: allocationId, assignedVendorId: 'vendor-a', outboundMethodSnapshot: 'VENDOR_INTEGRATION',
    outboundIntegrationProviderSnapshot: 'SOPYO', allocationStatus: 'ACTIVE', reassignmentRequired: false,
    order: {
      id: 'order-db', sourceShopifyOrderId: '123', sourceShopifyOrderNumber: '#1139',
      cancelledAt: null, currency: 'TRY', totalPrice: d('100'), discountAmount: d('0'),
      shippingAmount: d('0'), orderTaxAmount: d('9.09'), taxesIncluded: true,
      customerName: 'Customer Person', customerEmail: 'private@example.invalid', customerPhone: '05551112233',
      shippingAddress: 'Street 1, Apt 2 \u2060Kartal', shippingCity: 'Istanbul', shippingDistrict: 'Apt 2 \u2060Kartal',
      billingFullName: 'Billing Person', billingPhone: '05554445566', billingCity: 'Istanbul',
      billingDistrict: 'Suite 3 \u2060Kadıköy',
    },
    lineItems: [{
      quantity: 1, lineAmount: d('100'), shopifyOrderLineItem: {
        shopifyOrderId: 'order-db', sku: 'SKU', title: 'Product', quantity: 1,
        unitPrice: d('100'), unitPriceVatIncluded: d('100'), lineTotalVatIncluded: d('100'),
      },
    }],
  };
  const raw = {
    id: '123', customer: { first_name: 'Customer', last_name: 'Person', email: 'private@example.invalid' },
    shipping_address: { name: 'Shipping Recipient', phone: '0555 111 22 33', address1: 'Street 1',
      address2: 'Apt 2 \u2060Kartal', country_code: 'TR', city: 'Istanbul' },
    billing_address: { name: 'Billing Person', phone: '0555 444 55 66', address1: 'Billing Street',
      address2: 'Suite 3 \u2060Kadıköy', country_code: 'TR', city: 'Istanbul' },
  };
  let allocationCount = 1;
  let orderLineCount = 1;
  const db = {
    sopyoOrderPush: {
      findUnique: vi.fn(async () => ({ ...push })),
      updateMany: vi.fn(async ({ where, data }: { where: Record<string, any>; data: Record<string, any> }) => {
        const permitted = where.status === push.status || (Array.isArray(where.OR) && where.OR.some((part: any) =>
          part.status === push.status && (part.processingStartedAt === undefined ||
            (push.processingStartedAt && push.processingStartedAt <= part.processingStartedAt.lte))));
        if (!permitted || (where.claimToken !== undefined && where.claimToken !== push.claimToken)) return { count: 0 };
        Object.assign(push, data);
        return { count: 1 };
      }),
    },
    vendorAllocation: { findUnique: vi.fn(async () => allocation), count: vi.fn(async () => allocationCount) },
    shopifyOrderLineItem: { count: vi.fn(async () => orderLineCount) },
    webhookEvent: { findMany: vi.fn(async () => [{ rawPayload: JSON.stringify(raw) }]) },
  };
  const requests: Array<{ method: string; url: string; body?: unknown }> = [];
  let lookupResults: unknown[][] = [[]];
  let createStatus = 201;
  let createBody: unknown = { data: { id: 42, order_code: allocationId, order_type: 'SOPYOAPI' } };
  let releaseCreate: (() => void) | undefined;
  const fetcher = vi.fn(async (url: string, init: RequestInit) => {
    requests.push({ method: init.method!, url, ...(init.body ? { body: JSON.parse(init.body as string) } : {}) });
    if (url.endsWith('/auth/login')) return new Response(JSON.stringify({ access_token: { token: 'bearer', type: 'bearer' } }));
    if (init.method === 'GET') {
      const data = lookupResults.shift() ?? [];
      return new Response(JSON.stringify({ data, meta: { current_page: 1, last_page: 1 } }));
    }
    if (releaseCreate) await new Promise<void>((resolve) => { releaseCreate = resolve; });
    return new Response(JSON.stringify(createBody), { status: createStatus });
  });
  const credential = vi.fn(async () => 'secret-a');
  const run = (reconcileOnly = false) => dispatchSopyoOrderPush({
    pushId, reconcileOnly, db: db as never, fetcher: fetcher as never, loadCredential: credential,
  });
  return {
    push, allocation, db, requests, credential, run,
    setAllocationCount: (n: number) => { allocationCount = n; },
    setOrderLineCount: (n: number) => { orderLineCount = n; },
    setLookups: (...items: unknown[][]) => { lookupResults = [...items]; },
    setCreate: (status: number, body: unknown) => { createStatus = status; createBody = body; },
    holdCreate: () => { releaseCreate = () => undefined; },
    releaseCreate: () => { releaseCreate?.(); },
    posts: () => requests.filter((request) => request.url.endsWith('/api/v2/orders') && request.method === 'POST'),
    gets: () => requests.filter((request) => request.method === 'GET'),
  };
}

describe('manual Sopyo order-push dispatcher', () => {
  it('claims atomically, sends one POST for the zero-shipping V1 shape, and stores only safe durable outcome', async () => {
    const s = setup();
    const result = await s.run();
    expect(result).toMatchObject({ status: 'SUCCEEDED', result: 'CREATED', sopyoOrderId: 42 });
    expect(s.push).toMatchObject({ status: 'SUCCEEDED', sopyoOrderId: '42', claimToken: null, httpStatus: 201 });
    expect(s.posts()).toHaveLength(1);
    expect(s.gets()).toHaveLength(1);
    expect(s.posts()[0]?.body).toMatchObject({ order_code: allocationId, order_status: 1,
      total_price: 100, order_items: [{ quantity: 1, total_price: 100 }],
      shipping_info: { district: 'Kartal', neighborhood: 'Kartal' },
      billing_info: { district: 'Kadıköy', neighborhood: 'Kadıköy', address: 'Billing Street, Suite 3 \u2060Kadıköy' },
    });
    expect(JSON.stringify(s.push)).not.toContain('private@example.invalid');
    expect(JSON.stringify(s.push)).not.toContain('secret-a');
    expect(JSON.stringify(s.push)).not.toContain('Billing Street');
    expect(await s.run()).toMatchObject({ status: 'NOT_CLAIMED' });
    expect(s.posts()).toHaveLength(1);
  });

  it('maps #1139-shaped positive checkout shipping outside Sopyo merchandise totals', async () => {
    const s = setup();
    const line = s.allocation.lineItems[0]!;
    s.allocation.order.totalPrice = d('2099.95');
    s.allocation.order.shippingAmount = d('100.00');
    line.lineAmount = d('1999.95');
    line.shopifyOrderLineItem.unitPrice = d('1999.95');
    line.shopifyOrderLineItem.lineTotalVatIncluded = d('1999.95');

    expect(await s.run()).toMatchObject({ status: 'SUCCEEDED', result: 'CREATED' });
    expect(s.posts()).toHaveLength(1);
    expect(s.posts()[0]?.body).toMatchObject({
      total_price: 1999.95,
      order_items: [{ quantity: 1, total_price: 1999.95 }],
    });
    expect(s.posts()[0]?.body).not.toHaveProperty('shipping_price');
    expect(s.posts()[0]?.body).not.toHaveProperty('cargo_price');
    expect(s.posts()[0]?.body).not.toHaveProperty('shipping_info.price');
    expect(s.allocation.order.totalPrice.toString()).toBe('2099.95');
  });

  it('blocks mismatched vendor, outbound provider and order code before credential or Sopyo access', async () => {
    for (const mutate of [
      (s: ReturnType<typeof setup>) => { s.push.assignedVendorId = 'vendor-b'; },
      (s: ReturnType<typeof setup>) => { s.push.orderCode = 'wrong'; },
      (s: ReturnType<typeof setup>) => { s.allocation.outboundIntegrationProviderSnapshot = null as never; },
      (s: ReturnType<typeof setup>) => { s.allocation.outboundMethodSnapshot = 'KARGONOMI'; },
    ]) {
      const s = setup(); mutate(s);
      expect(await s.run()).toMatchObject({ status: 'BLOCKED', reasonCode: 'ALLOCATION_AUTHORITY_MISMATCH' });
      expect(s.credential).not.toHaveBeenCalled();
      expect(s.requests).toHaveLength(0);
    }
  });

  it('uses only the assigned vendor credential', async () => {
    const s = setup(); await s.run();
    expect(s.credential).toHaveBeenCalledExactlyOnceWith('vendor-a');
    expect(s.requests[0]?.body).toEqual({ api_token: ['secret-a'] });
  });

  it('stores a confirmed external ID without a 32-bit integer limit', async () => {
    const s = setup();
    s.setCreate(201, { data: { id: 3_000_000_000, order_code: allocationId, order_type: 'SOPYOAPI' } });
    expect(await s.run()).toMatchObject({ status: 'SUCCEEDED', sopyoOrderId: 3_000_000_000 });
    expect(s.push.sopyoOrderId).toBe('3000000000');
    expect(s.posts()).toHaveLength(1);
  });

  it.each([
    ['discount', (s: ReturnType<typeof setup>) => { s.allocation.order.discountAmount = d('1'); }],
    ['unexplained grand-total residual', (s: ReturnType<typeof setup>) => {
      s.allocation.lineItems[0]!.lineAmount = d('1999.95');
      s.allocation.lineItems[0]!.shopifyOrderLineItem.unitPrice = d('1999.95');
      s.allocation.lineItems[0]!.shopifyOrderLineItem.lineTotalVatIncluded = d('1999.95');
      s.allocation.order.shippingAmount = d('100'); s.allocation.order.totalPrice = d('2199.95');
    }],
    ['negative shipping', (s: ReturnType<typeof setup>) => {
      s.allocation.order.shippingAmount = d('-1'); s.allocation.order.totalPrice = d('99');
    }],
    ['missing shipping evidence', (s: ReturnType<typeof setup>) => {
      s.allocation.order.shippingAmount = null as never;
    }],
    ['multi-allocation', (s: ReturnType<typeof setup>) => { s.setAllocationCount(2); }],
    ['another order line', (s: ReturnType<typeof setup>) => { s.setOrderLineCount(2); }],
    ['missing line total', (s: ReturnType<typeof setup>) => { s.allocation.lineItems[0]!.shopifyOrderLineItem.lineTotalVatIncluded = null as never; }],
    ['unit-price mismatch', (s: ReturnType<typeof setup>) => { s.allocation.lineItems[0]!.shopifyOrderLineItem.unitPrice = d('99'); }],
  ])('blocks unsupported monetary shape: %s', async (_, mutate) => {
    const s = setup(); mutate(s);
    expect(await s.run()).toMatchObject({ status: 'BLOCKED', reasonCode: 'MONETARY_MAPPING_UNSUPPORTED' });
    expect(s.requests).toHaveLength(0);
  });

  it('reconciles one compatible pre-existing order without POST', async () => {
    const s = setup(); s.setLookups([{ id: 88, order_code: allocationId, order_type: 'SOPYOAPI' }]);
    expect(await s.run()).toMatchObject({ status: 'SUCCEEDED', result: 'RECONCILED_EXISTING', sopyoOrderId: 88 });
    expect(s.posts()).toHaveLength(0);
  });

  it.each([
    [[{ id: 88, order_code: allocationId, order_type: 'OTHER' }]],
    [[{ id: 88, order_code: allocationId, order_type: 'SOPYOAPI' },
      { id: 89, order_code: allocationId, order_type: 'SOPYOAPI' }]],
  ])('requires reconciliation for conflicting or multiple exact matches', async (matches) => {
    const s = setup(); s.setLookups(matches);
    expect(await s.run()).toMatchObject({ status: 'RECONCILE_REQUIRED', reasonCode: 'EXISTING_ORDER_CONFLICT' });
    expect(s.posts()).toHaveLength(0);
  });

  it('persists definite rejection without a retry or provider body', async () => {
    const s = setup(); s.setCreate(422, { errors: { 'shipping_info.address': 'Private Street' } });
    expect(await s.run()).toMatchObject({ status: 'BLOCKED', reasonCode: 'PROVIDER_REJECTED' });
    expect(s.push.httpStatus).toBe(422);
    expect(s.posts()).toHaveLength(1);
    expect(JSON.stringify(s.push)).not.toContain('Private Street');
  });

  it('reconciles an ambiguous create after one follow-up lookup, never reposting', async () => {
    const s = setup(); s.setCreate(500, {});
    s.setLookups([], [{ id: 91, order_code: allocationId, order_type: 'SOPYOAPI' }]);
    expect(await s.run()).toMatchObject({ status: 'SUCCEEDED', result: 'RECONCILED_AFTER_AMBIGUOUS', sopyoOrderId: 91 });
    expect(s.posts()).toHaveLength(1);
    expect(s.gets()).toHaveLength(2);
  });

  it('retains ambiguous zero-match as reconcile-required and lookup-only recovery never POSTs', async () => {
    const s = setup(); s.setCreate(500, {}); s.setLookups([], [], []);
    expect(await s.run()).toMatchObject({ status: 'RECONCILE_REQUIRED', reasonCode: 'NOT_FOUND_AFTER_AMBIGUOUS_CREATE' });
    expect(await s.run()).toMatchObject({ status: 'NOT_CLAIMED' });
    expect(await s.run(true)).toMatchObject({ status: 'RECONCILE_REQUIRED', reasonCode: 'ORDER_NOT_FOUND' });
    expect(s.posts()).toHaveLength(1);
    expect(s.gets()).toHaveLength(3);
  });

  it('lookup-only recovery fences stale PROCESSING and never retries a possible prior POST', async () => {
    const s = setup();
    s.push.status = 'PROCESSING';
    s.push.claimToken = 'old-claim';
    s.push.processingStartedAt = new Date(Date.now() - 31 * 60 * 1000);
    s.setLookups([{ id: 77, order_code: allocationId, order_type: 'SOPYOAPI' }]);
    expect(await s.run(true)).toMatchObject({ status: 'SUCCEEDED', sopyoOrderId: 77 });
    expect(s.posts()).toHaveLength(0);
    expect(s.push.claimToken).toBeNull();
  });

  it('does not take over recent PROCESSING or terminal success', async () => {
    const s = setup();
    s.push.status = 'PROCESSING';
    s.push.processingStartedAt = new Date();
    expect(await s.run(true)).toMatchObject({ status: 'NOT_CLAIMED' });
    s.push.status = 'SUCCEEDED';
    expect(await s.run()).toMatchObject({ status: 'NOT_CLAIMED' });
    expect(s.requests).toHaveLength(0);
  });

  it('keeps uncertain recovery in reconciliation if allocation identity changed', async () => {
    const s = setup();
    s.push.status = 'RECONCILE_REQUIRED';
    s.allocation.assignedVendorId = 'vendor-b';
    expect(await s.run(true)).toMatchObject({
      status: 'RECONCILE_REQUIRED', reasonCode: 'ALLOCATION_AUTHORITY_MISMATCH',
    });
    expect(s.requests).toHaveLength(0);
  });

  it('a pre-create credential failure is blocked without misclassifying an external create', async () => {
    const s = setup();
    s.credential.mockRejectedValueOnce(new Error('secret or customer data'));
    expect(await s.run()).toMatchObject({ status: 'BLOCKED', reasonCode: 'AUTH_UNAVAILABLE' });
    expect(s.posts()).toHaveLength(0);
    expect(JSON.stringify(s.push)).not.toContain('secret or customer data');
  });

  it('an atomic competing invocation cannot post after the first claim', async () => {
    const s = setup();
    s.holdCreate();
    const first = s.run();
    await vi.waitFor(() => expect(s.posts()).toHaveLength(1));
    expect(s.push.status).toBe('PROCESSING');
    expect(await s.run()).toMatchObject({ status: 'NOT_CLAIMED' });
    s.releaseCreate();
    expect(await first).toMatchObject({ status: 'SUCCEEDED' });
    expect(s.posts()).toHaveLength(1);
  });
});
