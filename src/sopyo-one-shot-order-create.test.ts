import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '../backend/node_modules/@prisma/client/index.js';
import { runSopyoOneShotOrderCreateTest } from '../backend/src/modules/vendor-integration/sopyo-one-shot-order-create.service.js';
import type { SopyoCreateOrderInput } from '../backend/src/modules/vendor-integration/sopyo-delivery.client.js';

const ALLOCATION_ID = 'alloc-yalispor-8256823525713';
const SOURCE_ORDER_ID = '8256823525713';

function fixture(vendorId = 'yalispor') {
  return {
    id: ALLOCATION_ID, assignedVendorId: vendorId,
    outboundMethodSnapshot: 'VENDOR_INTEGRATION', outboundIntegrationProviderSnapshot: 'SOPYO',
    allocationStatus: 'ACTIVE', reassignmentRequired: false,
    order: {
      id: 'stored-order', sourceShopifyOrderId: SOURCE_ORDER_ID,
      sourceShopifyOrderNumber: '#1138', cancelledAt: null, currency: 'TRY',
      totalPrice: new Prisma.Decimal('4299.00'), discountAmount: new Prisma.Decimal('0.00'),
      shippingAmount: new Prisma.Decimal('0.00'), orderTaxAmount: new Prisma.Decimal('390.82'),
      taxesIncluded: true, customerName: 'Customer Person', customerEmail: 'customer@example.invalid',
      customerPhone: '05551112233', shippingAddress: 'Street 1, Apt 2',
      shippingCity: 'Istanbul', shippingDistrict: 'Apt 2',
      billingFullName: 'Billing Person', billingPhone: '05554445566',
      billingCity: 'Istanbul', billingDistrict: 'Suite 3',
    },
    lineItems: [{
      quantity: 1, lineAmount: new Prisma.Decimal('4299.00'),
      shopifyOrderLineItem: {
        shopifyOrderId: 'stored-order', sku: 'SELECTED-SKU', title: 'Selected Product',
        unitPriceVatIncluded: new Prisma.Decimal('4299.00'),
        lineTotalVatIncluded: new Prisma.Decimal('4299.00'),
      },
    }],
  };
}

function rawOrder() {
  return {
    id: SOURCE_ORDER_ID,
    customer: { first_name: 'Customer', last_name: 'Person', email: 'customer@example.invalid' },
    shipping_address: {
      name: 'Shipping Recipient', phone: '0555 111 22 33',
      address1: 'Street 1', address2: 'Apt 2', city: 'Istanbul', province: 'Istanbul', zip: '34000',
    },
    billing_address: {
      name: 'Billing Person', phone: '0555 444 55 66',
      address1: 'Billing Street', address2: 'Suite 3', city: 'Istanbul', province: 'Istanbul', zip: '34001',
    },
  };
}

function db(allocation = fixture(), raw: unknown = rawOrder()) {
  const findUnique = vi.fn(async () => allocation);
  const findMany = vi.fn(async () => raw === null ? [] : [{ rawPayload: JSON.stringify(raw) }]);
  return { vendorAllocation: { findUnique }, webhookEvent: { findMany } };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function list(data: unknown[], page = 1, lastPage = 1) {
  return { data, meta: { current_page: page, last_page: lastPage } };
}

function mockSopyo(options: {
  pages?: unknown[][];
  createStatus?: number;
  createBody?: unknown;
  createThrows?: boolean;
} = {}) {
  const outbound: SopyoCreateOrderInput[] = [];
  const fetcher = vi.fn(async (url: string, init: RequestInit) => {
    if (url.endsWith('/auth/login')) return json({ access_token: { token: 'bearer-secret', type: 'bearer' } });
    if (init.method === 'GET') {
      const page = Number(new URL(url).searchParams.get('page'));
      const pages = options.pages ?? [[]];
      return json(list(pages[page - 1] ?? [], page, pages.length));
    }
    outbound.push(JSON.parse(init.body as string) as SopyoCreateOrderInput);
    if (options.createThrows) throw new Error('secret or customer@example.invalid');
    return json(options.createBody ?? {
      data: { id: 12345, order_code: ALLOCATION_ID, order_type: 'SOPYOAPI' },
    }, options.createStatus ?? 201);
  });
  return { fetcher: fetcher as unknown as typeof fetch, calls: fetcher, outbound };
}

async function run(input: {
  database?: ReturnType<typeof db>;
  fetcher?: typeof fetch;
  loadCredential?: (vendorId: string) => Promise<string>;
  onPreSend?: (safe: unknown) => void;
} = {}) {
  return runSopyoOneShotOrderCreateTest({
    allocationId: ALLOCATION_ID,
    db: (input.database ?? db()) as unknown as typeof import('../backend/src/db/prisma.js').prisma,
    fetcher: input.fetcher,
    loadCredential: input.loadCredential ?? (async () => 'api-secret'),
    onPreSend: input.onPreSend,
  });
}

describe('controlled Sopyo one-shot order create', () => {
  it('blocks wrong outbound authority, cancelled orders, missing SKU and changed money before external calls', async () => {
    const api = mockSopyo();
    const wrong = fixture();
    wrong.outboundIntegrationProviderSnapshot = 'KARGONOMI';
    await expect(run({ database: db(wrong), fetcher: api.fetcher })).rejects.toMatchObject({ code: 'ALLOCATION_NOT_ELIGIBLE' });
    const cancelled = fixture();
    cancelled.order.cancelledAt = new Date() as never;
    await expect(run({ database: db(cancelled), fetcher: api.fetcher })).rejects.toMatchObject({ code: 'ALLOCATION_NOT_ELIGIBLE' });
    const missingSku = fixture();
    missingSku.lineItems[0]!.shopifyOrderLineItem.sku = '';
    await expect(run({ database: db(missingSku), fetcher: api.fetcher })).rejects.toMatchObject({ code: 'TEST_LINE_EVIDENCE_CHANGED' });
    const changedAmount = fixture();
    changedAmount.lineItems[0]!.lineAmount = new Prisma.Decimal('4298.00');
    await expect(run({ database: db(changedAmount), fetcher: api.fetcher })).rejects.toMatchObject({ code: 'TEST_LINE_EVIDENCE_CHANGED' });
    expect(api.calls).not.toHaveBeenCalled();
  });

  it('blocks missing or mismatched retained processed webhook before authentication', async () => {
    const api = mockSopyo();
    await expect(run({ database: db(fixture(), null), fetcher: api.fetcher }))
      .rejects.toMatchObject({ code: 'RAW_WEBHOOK_NOT_UNIQUE' });
    const wrong = rawOrder();
    wrong.id = 'other-order';
    await expect(run({ database: db(fixture(), wrong), fetcher: api.fetcher }))
      .rejects.toMatchObject({ code: 'RAW_WEBHOOK_ORDER_MISMATCH' });
    expect(api.calls).not.toHaveBeenCalled();
  });

  it('uses only the assigned vendor credential; an unavailable credential cannot fall back to another vendor', async () => {
    const api = mockSopyo();
    const loadCredential = vi.fn(async (vendorId: string) => {
      expect(vendorId).toBe('yalispor');
      throw new Error('credential unavailable');
    });
    await expect(run({ fetcher: api.fetcher, loadCredential })).rejects.toThrow('credential unavailable');
    expect(loadCredential).toHaveBeenCalledExactlyOnceWith('yalispor');
    expect(api.calls).not.toHaveBeenCalled();
  });

  it('keeps two vendors on their own credentials when invoked separately', async () => {
    const tokens: string[] = [];
    const api = mockSopyo({ pages: [[{ id: 7, order_code: ALLOCATION_ID, order_type: 'SOPYOAPI' }]] });
    const capture = vi.fn(async (vendorId: string) => {
      tokens.push(vendorId);
      return `${vendorId}-secret`;
    });
    await run({ database: db(fixture('yalispor')), fetcher: api.fetcher, loadCredential: capture });
    await run({ database: db(fixture('vendor-b')), fetcher: api.fetcher, loadCredential: capture });
    expect(tokens).toEqual(['yalispor', 'vendor-b']);
    const loginBodies = api.calls.mock.calls.filter(([url]) => String(url).endsWith('/auth/login'))
      .map(([, init]) => JSON.parse((init as RequestInit).body as string));
    expect(loginBodies).toEqual([{ api_token: ['yalispor-secret'] }, { api_token: ['vendor-b-secret'] }]);
    expect(api.outbound).toHaveLength(0);
  });

  it('uses raw shipping recipient, only selected allocation line, fixed test amount/status, and no unsupported address inventions', async () => {
    const api = mockSopyo();
    const preSend = vi.fn();
    const result = await run({ fetcher: api.fetcher, onPreSend: preSend });
    expect(result).toMatchObject({ status: 'SUCCESS', sopyoOrderId: 12345 });
    expect(api.outbound).toHaveLength(1);
    expect(api.outbound[0]).toMatchObject({
      order_code: ALLOCATION_ID, order_status: 1, total_price: 4299,
      customer_info: { name: 'Customer Person', email: 'customer@example.invalid' },
      shipping_info: { full_name: 'Shipping Recipient', gsm: '05551112233', city: 'Istanbul', address: 'Street 1, Apt 2' },
      billing_info: { full_name: 'Billing Person', gsm: '05554445566', city: 'Istanbul' },
      order_items: [{ stock_code: 'SELECTED-SKU', product_name: 'Selected Product', quantity: 1, total_price: 4299 }],
    });
    expect(api.outbound[0]!.shipping_info.full_name).not.toBe(api.outbound[0]!.customer_info.name);
    expect(api.outbound[0]!.shipping_info).not.toHaveProperty('district');
    expect(api.outbound[0]!.shipping_info).not.toHaveProperty('neighborhood');
    expect(api.outbound[0]!.billing_info).not.toHaveProperty('address');
    expect(api.outbound[0]!.order_items).toHaveLength(1);
    expect(preSend).toHaveBeenCalledWith(expect.objectContaining({
      allocationId: ALLOCATION_ID, numericTotal: 4299, shippingNamePresent: true,
      billingSourceAddressPresent: true, billingPayloadAddressIncluded: false,
    }));
    expect(JSON.stringify(preSend.mock.calls)).not.toContain('Shipping Recipient');
    expect(JSON.stringify(preSend.mock.calls)).not.toContain('customer@example.invalid');
  });

  it('requires direct raw shipping name rather than substituting customer name', async () => {
    const raw = rawOrder();
    raw.shipping_address.name = '';
    const api = mockSopyo();
    await expect(run({ database: db(fixture(), raw), fetcher: api.fetcher }))
      .rejects.toMatchObject({ code: 'SHIPPING_NAME_MISSING' });
    expect(api.calls).not.toHaveBeenCalled();
  });

  it('checks every exact order-code page and does not POST when the compatible order exists', async () => {
    const api = mockSopyo({ pages: [[], [{ id: 777, order_code: ALLOCATION_ID, order_type: 'SOPYOAPI' }]] });
    expect(await run({ fetcher: api.fetcher })).toMatchObject({ status: 'ALREADY_EXISTS', sopyoOrderId: 777 });
    expect(api.outbound).toHaveLength(0);
    const gets = api.calls.mock.calls.filter(([, init]) => (init as RequestInit).method === 'GET');
    expect(gets).toHaveLength(2);
    for (const [url] of gets) expect(new URL(String(url)).searchParams.get('order_code[eq]')).toBe(ALLOCATION_ID);
  });

  it('blocks ambiguous or incompatible pre-existing Sopyo identities', async () => {
    const existing = { id: 3, order_code: ALLOCATION_ID, order_type: 'SOPYOAPI' };
    const duplicate = mockSopyo({ pages: [[existing, { ...existing, id: 4 }]] });
    expect(await run({ fetcher: duplicate.fetcher })).toEqual({ status: 'AMBIGUOUS' });
    expect(duplicate.outbound).toHaveLength(0);
    const incompatible = mockSopyo({ pages: [[{ ...existing, order_type: 'MARKETPLACE' }]] });
    expect(await run({ fetcher: incompatible.fetcher })).toEqual({ status: 'CONFLICT' });
    expect(incompatible.outbound).toHaveLength(0);
  });

  it('sanitizes provider rejection without logging returned PII or secrets', async () => {
    const api = mockSopyo({
      createStatus: 422,
      createBody: { message: 'customer@example.invalid was rejected with bearer-secret', errors: {
        'shipping_info.address': ['private home address'],
      } },
    });
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const result = await run({ fetcher: api.fetcher });
      expect(result).toEqual({ status: 'REJECTED', httpStatus: 422, message: 'Provider validation rejected: shipping_info.address.' });
      expect(JSON.stringify(result)).not.toContain('customer@example.invalid');
      expect(JSON.stringify(result)).not.toContain('bearer-secret');
      expect(log).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
      expect(api.outbound).toHaveLength(1);
    } finally {
      log.mockRestore();
      error.mockRestore();
    }
  });

  it('never resends after an ambiguous POST and performs one exact lookup', async () => {
    let lookupCount = 0;
    const outbound: unknown[] = [];
    const fetcher = vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith('/auth/login')) return json({ access_token: { token: 'bearer-secret', type: 'bearer' } });
      if (init.method === 'GET') {
        lookupCount += 1;
        return json(list(lookupCount === 1 ? [] : [{ id: 88, order_code: ALLOCATION_ID, order_type: 'SOPYOAPI' }]));
      }
      outbound.push(init.body);
      throw new Error('network timeout with private data');
    });
    const result = await run({ fetcher: fetcher as unknown as typeof fetch });
    expect(result).toMatchObject({ status: 'FOUND_AFTER_AMBIGUOUS_POST', sopyoOrderId: 88 });
    expect(outbound).toHaveLength(1);
    expect(lookupCount).toBe(2);
  });
});
