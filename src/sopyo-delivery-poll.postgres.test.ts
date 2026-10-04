import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../backend/node_modules/@prisma/client/index.js';

const databaseUrl = process.env.TEST_DATABASE_URL?.trim();
const describeWithPostgres = databaseUrl ? describe : describe.skip;

describeWithPostgres('FIN-BUG-003 isolated Sopyo delivery adapter on PostgreSQL', () => {
  let db: PrismaClient;
  let poll: typeof import('../backend/src/modules/vendor-integration/sopyo-delivery-poll.service.js')['pollSopyoDeliveredOrders'];
  let saveCredential: typeof import('../backend/src/modules/vendor-integration/sopyo-credential.service.js')['saveOrReplaceSopyoCredential'];
  let sequence = 0;

  beforeAll(async () => {
    const target = new URL(databaseUrl!);
    if (process.env.SOPYO_DELIVERY_TEST_DATABASE_ISOLATED !== '1' ||
        !['127.0.0.1', 'localhost'].includes(target.hostname) ||
        target.pathname.slice(1) !== 'sopyo_delivery_validation') {
      throw new Error('Sopyo delivery tests require isolated local sopyo_delivery_validation.');
    }
    process.env.DATABASE_URL = databaseUrl;
    process.env.SOPYO_CREDENTIAL_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
    ({ pollSopyoDeliveredOrders: poll } = await import('../backend/src/modules/vendor-integration/sopyo-delivery-poll.service.js'));
    ({ saveOrReplaceSopyoCredential: saveCredential } = await import('../backend/src/modules/vendor-integration/sopyo-credential.service.js'));
    db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await db.$connect();
  });

  afterAll(async () => { await db?.$disconnect(); });

  async function fixture(input: {
    tracking?: string;
    method?: 'VENDOR_INTEGRATION' | 'KARGONOMI' | null;
    clientCode?: 'SOPYO' | null;
    withCredential?: boolean;
    vendorId?: string;
  } = {}) {
    const id = `sopyo-poll-${process.pid}-${Date.now()}-${++sequence}`;
    const vendorId = input.vendorId ?? id;
    if (!input.vendorId) await db.vendor.create({ data: { id: vendorId, name: 'Sopyo Poll Fixture', status: 'inactive' } });
    const order = await db.shopifyOrder.create({ data: { sourceShopifyOrderId: id, sourceShopifyOrderNumber: `#${id}` } });
    const method = input.method === undefined ? 'VENDOR_INTEGRATION' : input.method;
    const tracking = input.tracking === undefined ? `${id}-TRACK` : input.tracking;
    const allocation = await db.vendorAllocation.create({ data: {
      id, sourceShopifyOrderId: order.id, sourceShopifyOrderNumber: `#${id}`,
      originalVendorId: vendorId, assignedVendorId: vendorId,
      outboundMethodSnapshot: method,
      outboundIntegrationProviderSnapshot: method === 'VENDOR_INTEGRATION' ? 'SOPYO' : null,
      trackingNumber: tracking,
    } });
    const client = await db.vendorIntegrationClient.create({ data: {
      vendorIdentifier: vendorId, providerName: 'Display only',
      providerCode: input.clientCode === undefined ? 'SOPYO' : input.clientCode,
      tokenHash: `${id}-hash`, scopes: ['shipment:write'],
    } });
    await db.vendorIntegrationShipmentEvent.create({ data: {
      clientId: client.id, vendorAllocationId: id, vendorIdentifier: vendorId,
      carrier: 'Test', trackingNumber: tracking, idempotencyKey: `${id}-event`,
    } });
    if (input.withCredential !== false && !input.vendorId) {
      await saveCredential(vendorId, `api-${vendorId}`, db);
    }
    return { id, vendorId, allocation, client, tracking };
  }

  function fakeSopyo(options: {
    status?: number;
    rows?: (tracking: string) => unknown[];
    pages?: number;
    failToken?: string;
  } = {}) {
    const logins: string[] = [];
    const queries: { token: string; tracking: string; page: number }[] = [];
    const fetcher = (async (request: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(request));
      if (url.pathname === '/api/v2/auth/login') {
        const apiToken = (JSON.parse(String(init?.body)) as { api_token: string[] }).api_token[0]!;
        logins.push(apiToken);
        if (apiToken === options.failToken) return new Response('{}', { status: 401 });
        return Response.json({ access_token: { token: `bearer-${apiToken}`, type: 'bearer', expire_in: 1440 } });
      }
      expect(url.pathname).toBe('/api/v2/orders');
      expect(url.searchParams.has('order_code[eq]')).toBe(false);
      expect(url.searchParams.has('order_status[eq]')).toBe(false);
      const tracking = url.searchParams.get('cargo_tracking_no[eq]')!;
      const page = Number(url.searchParams.get('page'));
      const token = String((init?.headers as Record<string, string>).Authorization);
      queries.push({ token, tracking, page });
      const rows = options.rows?.(tracking) ?? [{ id: 37505089, order_status: options.status ?? 6, cargo_info: { tracking_no: tracking } }];
      return Response.json({ data: page === (options.pages ?? 1) ? rows : [],
        links: { next: page < (options.pages ?? 1) ? `/api/v2/orders?page=${page + 1}` : null },
        meta: { current_page: page, last_page: options.pages ?? 1 } });
    }) as typeof fetch;
    return { fetcher, logins, queries };
  }

  it('records exact status 6 once, preserves database observation time, and leaves finance delay unchanged', async () => {
    const source = await fixture();
    const { evaluateSaleSettlementDelay } = await import('../backend/src/modules/finance/settlement-delay-eligibility.service.js');
    const financeInput = { entryType: 'SALE' as const, settlementDelayDaysSnapshot: 0,
      vendorAllocation: { shippingStatus: source.allocation.shippingStatus, fulfillment: null } };
    const beforeEligibility = evaluateSaleSettlementDelay(financeInput);
    const before = new Date();
    const api = fakeSopyo();
    const firstReport = await poll({ db, fetcher: api.fetcher });
    const after = new Date();
    expect(firstReport.observationsRecorded).toBeGreaterThanOrEqual(1);
    const observation = await db.allocationDeliveredObservation.findUniqueOrThrow({ where: { vendorAllocationId: source.id } });
    expect(observation).toMatchObject({ outboundMethod: 'VENDOR_INTEGRATION', outboundIntegrationProvider: 'SOPYO',
      vendorIntegrationClientId: source.client.id, sourceReference: '37505089' });
    expect(observation.firstObservedDeliveredAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(observation.firstObservedDeliveredAt.getTime()).toBeLessThanOrEqual(after.getTime());
    await poll({ db, fetcher: api.fetcher });
    expect((await db.allocationDeliveredObservation.findUniqueOrThrow({ where: { vendorAllocationId: source.id } })).firstObservedDeliveredAt)
      .toEqual(observation.firstObservedDeliveredAt);
    expect(evaluateSaleSettlementDelay(financeInput)).toEqual(beforeEligibility);
    expect(beforeEligibility.eligible).toBe(false);
  });

  it('isolates vendor credentials and uses a replaced token on the next run', async () => {
    const first = await fixture();
    const second = await fixture();
    const api = fakeSopyo({ status: 2 });
    await poll({ db, fetcher: api.fetcher });
    expect(api.logins).toContain(`api-${first.vendorId}`);
    expect(api.logins).toContain(`api-${second.vendorId}`);
    expect(api.logins.filter((token) => token === `api-${first.vendorId}`)).toHaveLength(1);
    expect(api.queries.find((query) => query.tracking === first.tracking)?.token).toBe(`Bearer bearer-api-${first.vendorId}`);
    expect(api.queries.find((query) => query.tracking === second.tracking)?.token).toBe(`Bearer bearer-api-${second.vendorId}`);
    expect(await db.allocationDeliveredObservation.count({ where: { vendorAllocationId: { in: [first.id, second.id] } } })).toBe(0);
    await saveCredential(first.vendorId, 'replacement-token', db);
    const next = fakeSopyo({ status: 2 });
    await poll({ db, fetcher: next.fetcher });
    expect(next.logins).toContain('replacement-token');
  });

  it('ignores null-code clients, Kargonomi/null snapshots, blank and overlong tracking, and superseded tracking', async () => {
    const legacy = await fixture({ clientCode: null });
    const kargonomi = await fixture({ method: 'KARGONOMI' });
    const unknown = await fixture({ method: null });
    const blank = await fixture({ tracking: '  ' });
    const long = await fixture({ tracking: 'X'.repeat(201) });
    const superseded = await fixture();
    await db.vendorAllocation.update({ where: { id: superseded.id }, data: { trackingNumber: 'NEW-NUMBER' } });
    const api = fakeSopyo();
    await poll({ db, fetcher: api.fetcher });
    for (const source of [legacy, kargonomi, unknown, blank, long, superseded]) {
      expect(await db.allocationDeliveredObservation.count({ where: { vendorAllocationId: source.id } })).toBe(0);
      expect(api.queries.some((query) => query.tracking === source.tracking)).toBe(false);
    }
  });

  it('fails closed for duplicate local tracking, duplicate provider orders, and malformed provider data', async () => {
    const first = await fixture();
    const duplicate = await fixture({ vendorId: first.vendorId, tracking: first.tracking, withCredential: false });
    const providerDuplicate = await fixture();
    const malformed = await fixture();
    const api = fakeSopyo({ rows: (number) => number === providerDuplicate.tracking
      ? [1, 2].map((id) => ({ id, order_status: 6, cargo_info: { tracking_no: number } }))
      : number === malformed.tracking ? [{ id: 3, order_status: 6, cargo_info: null }]
        : [] });
    const report = await poll({ db, fetcher: api.fetcher });
    expect(report.ambiguousLocal).toBeGreaterThanOrEqual(1);
    expect(report.ambiguousProvider).toBeGreaterThanOrEqual(1);
    expect(report.failedLookups).toBeGreaterThanOrEqual(1);
    for (const source of [first, duplicate, providerDuplicate, malformed]) {
      expect(await db.allocationDeliveredObservation.count({ where: { vendorAllocationId: source.id } })).toBe(0);
    }
  });

  it('retains frozen Sopyo authority after current config changes and handles documented pagination', async () => {
    const source = await fixture();
    await db.vendorShippingConfig.create({ data: { vendorId: source.vendorId, outboundMethod: 'KARGONOMI' } });
    const api = fakeSopyo({ pages: 2 });
    await poll({ db, fetcher: api.fetcher });
    expect(api.queries.filter((query) => query.tracking === source.tracking).map((query) => query.page)).toEqual([1, 2]);
    expect(await db.allocationDeliveredObservation.count({ where: { vendorAllocationId: source.id } })).toBe(1);
  });

  it('isolates authentication failure and concurrent duplicate workers leave one immutable claim', async () => {
    const bad = await fixture();
    const good = await fixture();
    const api = fakeSopyo({ failToken: `api-${bad.vendorId}` });
    await Promise.all([poll({ db, fetcher: api.fetcher }), poll({ db, fetcher: api.fetcher })]);
    expect(await db.allocationDeliveredObservation.count({ where: { vendorAllocationId: bad.id } })).toBe(0);
    expect(await db.allocationDeliveredObservation.count({ where: { vendorAllocationId: good.id } })).toBe(1);
  });

  it('isolates an undecryptable vendor credential and an exact zero-provider result', async () => {
    const undecryptable = await fixture();
    const noProviderOrder = await fixture();
    const healthy = await fixture();
    await db.sopyoVendorCredential.update({
      where: { vendorId: undecryptable.vendorId }, data: { authTag: Buffer.alloc(16, 0) },
    });
    const api = fakeSopyo({ rows: (number) => number === noProviderOrder.tracking ? []
      : [{ id: 37505089, order_status: 6, cargo_info: { tracking_no: number } }] });
    const report = await poll({ db, fetcher: api.fetcher });
    expect(report.failedVendors).toBeGreaterThanOrEqual(1);
    expect(api.logins).not.toContain(`api-${undecryptable.vendorId}`);
    expect(await db.allocationDeliveredObservation.count({ where: { vendorAllocationId: undecryptable.id } })).toBe(0);
    expect(await db.allocationDeliveredObservation.count({ where: { vendorAllocationId: noProviderOrder.id } })).toBe(0);
    expect(await db.allocationDeliveredObservation.count({ where: { vendorAllocationId: healthy.id } })).toBe(1);
  });

  it('rejects foreign-client and ambiguous current-event provenance without inferring providerName', async () => {
    const foreign = await fixture();
    const otherVendor = await fixture();
    await db.vendorIntegrationShipmentEvent.updateMany({
      where: { vendorAllocationId: foreign.id }, data: { clientId: otherVendor.client.id },
    });
    const ambiguous = await fixture();
    await db.vendorIntegrationShipmentEvent.create({ data: {
      clientId: ambiguous.client.id, vendorAllocationId: ambiguous.id,
      vendorIdentifier: ambiguous.vendorId, carrier: 'Test',
      trackingNumber: ambiguous.tracking, idempotencyKey: `${ambiguous.id}-second`,
    } });
    const api = fakeSopyo({ status: 2 });
    await poll({ db, fetcher: api.fetcher });
    for (const source of [foreign, ambiguous]) {
      expect(await db.allocationDeliveredObservation.count({ where: { vendorAllocationId: source.id } })).toBe(0);
      expect(api.queries.some((query) => query.tracking === source.tracking)).toBe(false);
    }
  });

  it('does not treat a valid allocation as unique when another same-tracking allocation has ambiguous provenance', async () => {
    const valid = await fixture();
    const ambiguous = await fixture({ vendorId: valid.vendorId, tracking: valid.tracking, withCredential: false });
    await db.vendorIntegrationShipmentEvent.create({ data: {
      clientId: ambiguous.client.id, vendorAllocationId: ambiguous.id,
      vendorIdentifier: ambiguous.vendorId, carrier: 'Test',
      trackingNumber: ambiguous.tracking, idempotencyKey: `${ambiguous.id}-second`,
    } });
    const api = fakeSopyo();
    const report = await poll({ db, fetcher: api.fetcher });
    expect(report.ambiguousLocal).toBeGreaterThanOrEqual(1);
    expect(api.queries.some((query) => query.tracking === valid.tracking)).toBe(false);
    expect(await db.allocationDeliveredObservation.count({ where: { vendorAllocationId: { in: [valid.id, ambiguous.id] } } })).toBe(0);
  });

  it('trims outer whitespace but never folds case or trusts mismatched provider tracking', async () => {
    const spaced = await fixture({ tracking: '  UNIQUE-TRIM-TRACKING  ' });
    const caseOnly = await fixture({ tracking: 'UNIQUE-CASE-TRACKING' });
    const api = fakeSopyo({ rows: (number) => [{ id: 927, order_status: 6,
      cargo_info: { tracking_no: number === 'UNIQUE-CASE-TRACKING' ? 'unique-case-tracking' : ` ${number} ` } }] });
    await poll({ db, fetcher: api.fetcher });
    expect(api.queries.some((query) => query.tracking === 'UNIQUE-TRIM-TRACKING')).toBe(true);
    expect(await db.allocationDeliveredObservation.count({ where: { vendorAllocationId: spaced.id } })).toBe(1);
    expect(await db.allocationDeliveredObservation.count({ where: { vendorAllocationId: caseOnly.id } })).toBe(0);
  });

  it('skips missing credentials and rechecks local correlation after the provider read', async () => {
    const absentCredential = await fixture({ withCredential: false });
    const changedDuringRead = await fixture();
    const api = fakeSopyo();
    const fetcher = (async (request: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(request));
      if (url.pathname === '/api/v2/orders' &&
          url.searchParams.get('cargo_tracking_no[eq]') === changedDuringRead.tracking) {
        await db.vendorAllocation.update({ where: { id: changedDuringRead.id }, data: { trackingNumber: 'REPLACED-DURING-POLL' } });
      }
      return api.fetcher(request, init);
    }) as typeof fetch;
    await poll({ db, fetcher });
    expect(api.logins).not.toContain(`api-${absentCredential.vendorId}`);
    expect(await db.allocationDeliveredObservation.count({ where: { vendorAllocationId: absentCredential.id } })).toBe(0);
    expect(await db.allocationDeliveredObservation.count({ where: { vendorAllocationId: changedDuringRead.id } })).toBe(0);
  });

  it('isolates one tracking API failure while another vendor remains eligible', async () => {
    const failing = await fixture();
    const healthy = await fixture();
    const api = fakeSopyo();
    const fetcher = (async (request: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(request));
      if (url.pathname === '/api/v2/orders' &&
          url.searchParams.get('cargo_tracking_no[eq]') === failing.tracking) {
        return new Response('{}', { status: 503 });
      }
      return api.fetcher(request, init);
    }) as typeof fetch;
    const report = await poll({ db, fetcher });
    expect(report.failedLookups).toBeGreaterThanOrEqual(1);
    expect(await db.allocationDeliveredObservation.count({ where: { vendorAllocationId: failing.id } })).toBe(0);
    expect(await db.allocationDeliveredObservation.count({ where: { vendorAllocationId: healthy.id } })).toBe(1);
  });
});
