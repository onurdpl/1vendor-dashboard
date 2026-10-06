import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '../backend/node_modules/@prisma/client/index.js';
import { evaluateSaleSettlementDelay } from '../backend/src/modules/finance/settlement-delay-eligibility.service.js';

const databaseUrl = process.env.TEST_DATABASE_URL?.trim();
const describeWithPostgres = databaseUrl ? describe : describe.skip;

describeWithPostgres('Sopyo cargo polling and local projection on isolated PostgreSQL', () => {
  let db: PrismaClient;
  let poll: typeof import('../backend/src/modules/vendor-integration/sopyo-cargo-poll.service.js')['pollSopyoCargo'];
  let saveCredential: typeof import('../backend/src/modules/vendor-integration/sopyo-credential.service.js')['saveOrReplaceSopyoCredential'];
  let recordDelivery: typeof import('../backend/src/modules/shipping/allocation-delivered-observation.service.js')['recordVerifiedDeliveredObservation'];
  let sequence = 0;
  const owned: Array<{ vendorId: string; orderId: string; allocationId: string }> = [];

  beforeAll(async () => {
    const target = new URL(databaseUrl!);
    if (process.env.SOPYO_CARGO_TEST_DATABASE_ISOLATED !== '1' ||
        !['localhost', '127.0.0.1'].includes(target.hostname) ||
        target.pathname.slice(1) !== 'sopyo_cargo_validation') {
      throw new Error('Sopyo cargo tests require isolated local sopyo_cargo_validation.');
    }
    process.env.DATABASE_URL = databaseUrl;
    process.env.SOPYO_CREDENTIAL_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
    ({ pollSopyoCargo: poll } = await import('../backend/src/modules/vendor-integration/sopyo-cargo-poll.service.js'));
    ({ saveOrReplaceSopyoCredential: saveCredential } = await import('../backend/src/modules/vendor-integration/sopyo-credential.service.js'));
    ({ recordVerifiedDeliveredObservation: recordDelivery } = await import('../backend/src/modules/shipping/allocation-delivered-observation.service.js'));
    db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await db.$connect();
  });

  afterAll(async () => {
    if (!db) return;
    // This database is dedicated to this suite. TRUNCATE bypasses the
    // production observation DELETE trigger without weakening it.
    await db.$executeRawUnsafe('TRUNCATE TABLE "AllocationDeliveredObservation"');
    for (const row of owned.reverse()) {
      await db.sopyoShipmentIntent.deleteMany({ where: { vendorAllocationId: row.allocationId } });
      await db.financeLedgerEntry.deleteMany({ where: { vendorAllocationId: row.allocationId } });
      await db.sopyoOrderPush.deleteMany({ where: { vendorAllocationId: row.allocationId } });
      await db.vendorAllocation.deleteMany({ where: { id: row.allocationId } });
      await db.shopifyOrder.deleteMany({ where: { id: row.orderId } });
      await db.sopyoVendorCredential.deleteMany({ where: { vendorId: row.vendorId } });
      await db.vendor.deleteMany({ where: { id: row.vendorId } });
    }
    await db.$disconnect();
  });

  async function fixture(input: {
    method?: 'VENDOR_INTEGRATION' | 'KARGONOMI' | null;
    provider?: 'SOPYO' | null;
    location?: string | null;
    shippingStatus?: string;
    carrier?: string | null;
    trackingNumber?: string | null;
    withCredential?: boolean;
  } = {}) {
    const n = ++sequence;
    const vendorId = `cargo-vendor-${process.pid}-${Date.now()}-${n}`;
    const orderKey = `cargo-order-${process.pid}-${Date.now()}-${n}`;
    const vendor = await db.vendor.create({ data: { id: vendorId, name: 'Cargo fixture', status: 'inactive' } });
    const order = await db.shopifyOrder.create({ data: {
      sourceShopifyOrderId: orderKey, sourceShopifyOrderNumber: `#${n}`,
    } });
    const method = input.method === undefined ? 'VENDOR_INTEGRATION' : input.method;
    const allocation = await db.vendorAllocation.create({ data: {
      id: `alloc-${orderKey}`, sourceShopifyOrderId: order.id,
      sourceShopifyOrderNumber: order.sourceShopifyOrderNumber,
      originalVendorId: vendor.id, assignedVendorId: vendor.id,
      outboundMethodSnapshot: method,
      outboundIntegrationProviderSnapshot: input.provider === undefined
        ? (method === 'VENDOR_INTEGRATION' ? 'SOPYO' : null) : input.provider,
      shopifyLocationGidSnapshot: input.location === undefined ? 'gid://shopify/Location/123' : input.location,
      ...(input.shippingStatus ? { shippingStatus: input.shippingStatus } : {}),
      carrier: input.carrier ?? null, trackingNumber: input.trackingNumber ?? null,
    } });
    const push = await db.sopyoOrderPush.create({ data: {
      vendorAllocationId: allocation.id, assignedVendorId: vendor.id,
      orderCode: allocation.id, status: 'SUCCEEDED', sopyoOrderId: String(81_000_000 + n),
    } });
    if (input.withCredential !== false) await saveCredential(vendor.id, `api-${vendor.id}`, db as never);
    owned.push({ vendorId, orderId: order.id, allocationId: allocation.id });
    return { vendor, order, allocation, push };
  }

  function provider(rows: Map<string, { company?: string | null; tracking?: string | null;
    id?: number; code?: string; type?: string }>) {
    const calls: Array<{ host: string; path: string; method: string }> = [];
    const fetcher = vi.fn(async (request: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(request));
      calls.push({ host: url.hostname, path: url.pathname, method: init?.method ?? 'GET' });
      if (url.pathname === '/api/v2/auth/login') {
        return Response.json({ access_token: { token: 'mock-bearer', type: 'bearer' } });
      }
      const id = url.pathname.split('/').at(-1)!;
      const row = rows.get(id);
      if (!row) throw new Error('Unexpected provider request.');
      return Response.json({ data: {
        id: row.id ?? Number(id), order_code: row.code ?? `alloc-missing-${id}`,
        order_type: row.type ?? 'SOPYOAPI', order_status: 2,
        cargo_info: { company: row.company ?? null, tracking_no: row.tracking ?? null },
      } });
    });
    return { fetcher: fetcher as typeof fetch, calls };
  }

  function sourceMap(source: { allocation: { id: string }; push: { sopyoOrderId: string | null } },
    cargo: { company?: string | null; tracking?: string | null } = {}) {
    return new Map([[source.push.sopyoOrderId!, { code: source.allocation.id,
      company: cargo.company, tracking: cargo.tracking }]]);
  }

  it('leaves missing cargo untouched and later projects first verified cargo without Shopify/finance effects', async () => {
    const source = await fixture({ location: null });
    await db.financeLedgerEntry.create({ data: { id: `${source.allocation.id}-sale`,
      vendorAllocationId: source.allocation.id, vendorId: source.vendor.id,
      entryType: 'sale', amount: '100.00', payoutStatus: 'PENDING', settlementStatus: 'ACCRUING',
      commissionPercentSnapshot: '10', commissionVatPercentSnapshot: '20',
      settlementDelayDaysSnapshot: 1 } });
    const beforeSale = await db.financeLedgerEntry.findFirstOrThrow({ where: { vendorAllocationId: source.allocation.id } });
    const beforeAllocation = await db.vendorAllocation.findUniqueOrThrow({ where: { id: source.allocation.id },
      include: { deliveredObservation: true } });
    expect(evaluateSaleSettlementDelay({ entryType: 'SALE', settlementDelayDaysSnapshot: 1,
      vendorAllocation: beforeAllocation }).eligible).toBe(false);
    const missing = provider(sourceMap(source));
    const first = await poll({ db: db as never, fetcher: missing.fetcher });
    expect(first).toMatchObject({ candidateCount: 1, detailChecks: 1, noCargo: 1, projected: 0 });
    expect(await db.sopyoShipmentIntent.count({ where: { vendorAllocationId: source.allocation.id } })).toBe(0);
    expect(await db.vendorAllocation.findUniqueOrThrow({ where: { id: source.allocation.id } })).toMatchObject({
      carrier: null, trackingNumber: null, shippingStatus: 'Awaiting Shipment',
    });
    const valid = provider(sourceMap(source, { company: 'Sürat Kargo', tracking: 'TRACK123' }));
    const second = await poll({ db: db as never, fetcher: valid.fetcher });
    expect(second).toMatchObject({ candidateCount: 1, detailChecks: 1, projected: 1 });
    const intent = await db.sopyoShipmentIntent.findUniqueOrThrow({ where: { vendorAllocationId: source.allocation.id } });
    expect(intent).toMatchObject({ sopyoOrderPushId: source.push.id, carrier: 'Sürat Kargo',
      trackingNumber: 'TRACK123', status: 'CARGO_VERIFIED', shopifyLocationGid: null });
    expect(await db.vendorAllocation.findUniqueOrThrow({ where: { id: source.allocation.id } })).toMatchObject({
      carrier: 'Sürat Kargo', trackingNumber: 'TRACK123', shippingStatus: 'In Transit',
    });
    const replay = await poll({ db: db as never, fetcher: valid.fetcher });
    expect(replay.candidateCount).toBe(0);
    expect((await db.sopyoShipmentIntent.findUniqueOrThrow({ where: { id: intent.id } })).firstObservedCargoAt)
      .toEqual(intent.firstObservedCargoAt);
    expect(valid.calls.filter((call) => call.path.startsWith('/api/v2/orders/'))).toHaveLength(1);
    expect(valid.calls.every((call) => call.method === 'GET' || call.path === '/api/v2/auth/login')).toBe(true);
    expect(valid.calls.every((call) => call.host === 'api.sopyo.dev')).toBe(true);
    const afterAllocation = await db.vendorAllocation.findUniqueOrThrow({ where: { id: source.allocation.id },
      include: { deliveredObservation: true } });
    expect(evaluateSaleSettlementDelay({ entryType: 'SALE', settlementDelayDaysSnapshot: 1,
      vendorAllocation: afterAllocation }).eligible).toBe(false);
    expect(await db.financeLedgerEntry.findFirstOrThrow({ where: { vendorAllocationId: source.allocation.id } }))
      .toEqual(beforeSale);
    expect(await db.vendorIntegrationShipmentEvent.count({ where: { vendorAllocationId: source.allocation.id } })).toBe(0);
    expect(await db.allocationDeliveredObservation.count({ where: { vendorAllocationId: source.allocation.id } })).toBe(0);
    expect(await db.fulfillment.count({ where: { vendorAllocationId: source.allocation.id } })).toBe(0);
    expect(await db.shipmentExecution.count({ where: { allocationId: source.allocation.id } })).toBe(0);
  });

  it('serializes concurrent exact cargo and projects only one durable intent', async () => {
    const source = await fixture();
    const api = provider(sourceMap(source, { company: 'Carrier', tracking: 'TRACK' }));
    await Promise.all([poll({ db: db as never, fetcher: api.fetcher }), poll({ db: db as never, fetcher: api.fetcher })]);
    expect(await db.sopyoShipmentIntent.count({ where: { vendorAllocationId: source.allocation.id } })).toBe(1);
    expect(await db.vendorAllocation.findUniqueOrThrow({ where: { id: source.allocation.id } })).toMatchObject({
      carrier: 'Carrier', trackingNumber: 'TRACK', shippingStatus: 'In Transit',
    });
  });

  it('recovers an already verified intent without a second Sopyo read or a credential', async () => {
    const source = await fixture({ withCredential: false });
    const { recordVerifiedSopyoShipmentIntent } = await import('../backend/src/modules/vendor-integration/sopyo-shipment-intent.service.js');
    const intent = await recordVerifiedSopyoShipmentIntent({ allocationId: source.allocation.id,
      pushId: source.push.id, detail: { id: Number(source.push.sopyoOrderId),
        orderCode: source.allocation.id, orderType: 'SOPYOAPI',
        cargoCompany: 'Carrier', cargoTrackingNumber: 'TRACK' } }, db as never);
    const fetcher = vi.fn(async () => { throw new Error('No provider request expected.'); });
    const result = await poll({ db: db as never, fetcher: fetcher as typeof fetch });
    expect(result.projected).toBe(1);
    expect(fetcher).not.toHaveBeenCalled();
    expect(await db.sopyoShipmentIntent.findUniqueOrThrow({ where: { id: intent.id } }))
      .toMatchObject({ status: 'CARGO_VERIFIED', firstObservedCargoAt: intent.firstObservedCargoAt });
  });

  it('fails closed for identity, frozen provider and vendor mismatches', async () => {
    const badId = await fixture();
    const badCode = await fixture();
    const badVendor = await fixture();
    const wrongProvider = await fixture({ method: null });
    const wrongMethod = await fixture({ method: 'KARGONOMI' });
    await db.sopyoOrderPush.update({ where: { id: badVendor.push.id },
      data: { assignedVendorId: badCode.vendor.id } });
    const rows = new Map<string, { code: string; company: string; tracking: string; id?: number }>();
    for (const source of [badId, badCode, badVendor, wrongProvider, wrongMethod]) {
      rows.set(source.push.sopyoOrderId!, { code: source.allocation.id, company: 'Carrier', tracking: 'TRACK' });
    }
    rows.get(badId.push.sopyoOrderId!)!.id = 99;
    rows.get(badCode.push.sopyoOrderId!)!.code = 'wrong-code';
    const api = provider(rows);
    const report = await poll({ db: db as never, fetcher: api.fetcher });
    expect(report.projected).toBe(0);
    for (const source of [badId, badCode, badVendor, wrongProvider, wrongMethod]) {
      expect(await db.vendorAllocation.findUniqueOrThrow({ where: { id: source.allocation.id } }))
        .toMatchObject({ carrier: null, trackingNumber: null, shippingStatus: 'Awaiting Shipment' });
    }
  });

  it('preserves exact existing cargo, refuses changed local cargo and never downgrades Delivered', async () => {
    const exact = await fixture({ carrier: 'Carrier', trackingNumber: 'TRACK' });
    const alreadyInTransit = await fixture({ carrier: 'Carrier', trackingNumber: 'TRACK', shippingStatus: 'In Transit' });
    const conflict = await fixture({ location: null, carrier: 'Other', trackingNumber: 'DIFFERENT' });
    const delivered = await fixture({ location: null, carrier: 'Carrier', trackingNumber: 'TRACK', shippingStatus: 'Delivered' });
    const rows = new Map<string, { code: string; company: string; tracking: string }>();
    for (const source of [exact, alreadyInTransit, conflict, delivered]) {
      rows.set(source.push.sopyoOrderId!, { code: source.allocation.id, company: 'Carrier', tracking: 'TRACK' });
    }
    const report = await poll({ db: db as never, fetcher: provider(rows).fetcher });
    expect(report).toMatchObject({ projected: 1, conflicts: 1, unchanged: 2 });
    expect(await db.vendorAllocation.findUniqueOrThrow({ where: { id: exact.allocation.id } }))
      .toMatchObject({ carrier: 'Carrier', trackingNumber: 'TRACK', shippingStatus: 'In Transit' });
    expect(await db.vendorAllocation.findUniqueOrThrow({ where: { id: conflict.allocation.id } }))
      .toMatchObject({ carrier: 'Other', trackingNumber: 'DIFFERENT', shippingStatus: 'Awaiting Shipment' });
    expect(await db.sopyoShipmentIntent.findUniqueOrThrow({ where: { vendorAllocationId: conflict.allocation.id } }))
      .toMatchObject({ status: 'CONFLICT', conflictReasonCode: 'LOCAL_CARGO_MISMATCH' });
    expect(await db.vendorAllocation.findUniqueOrThrow({ where: { id: delivered.allocation.id } }))
      .toMatchObject({ carrier: 'Carrier', trackingNumber: 'TRACK', shippingStatus: 'Delivered' });
    expect(await db.vendorAllocation.findUniqueOrThrow({ where: { id: alreadyInTransit.allocation.id } }))
      .toMatchObject({ carrier: 'Carrier', trackingNumber: 'TRACK', shippingStatus: 'In Transit' });
  });

  it('polls cargo even after delivered observation and continues after another candidate fails', async () => {
    const failed = await fixture();
    const observed = await fixture();
    await recordDelivery({ allocationId: observed.allocation.id, source: {
      method: 'VENDOR_INTEGRATION', providerCode: 'SOPYO', pushId: observed.push.id,
      sourceReference: observed.push.sopyoOrderId!,
    } }, db as never);
    const rows = new Map<string, { code: string; company: string; tracking: string; id?: number }>([
      [failed.push.sopyoOrderId!, { code: failed.allocation.id, company: 'Carrier', tracking: 'TRACK', id: 1 }],
      [observed.push.sopyoOrderId!, { code: observed.allocation.id, company: 'Carrier', tracking: 'TRACK' }],
    ]);
    const report = await poll({ db: db as never, fetcher: provider(rows).fetcher });
    expect(report.projected).toBe(1);
    expect(report.failedCandidates).toBeGreaterThanOrEqual(1);
    expect(await db.vendorAllocation.findUniqueOrThrow({ where: { id: observed.allocation.id } }))
      .toMatchObject({ carrier: 'Carrier', trackingNumber: 'TRACK', shippingStatus: 'In Transit' });
    expect(await db.allocationDeliveredObservation.count({ where: { vendorAllocationId: observed.allocation.id } })).toBe(1);
  });
});
