import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../backend/node_modules/@prisma/client/index.js';
import {
  MISSING_DELIVERY_DATE_REASON,
  SETTLEMENT_DELAY_PENDING_REASON,
} from '../backend/src/modules/finance/settlement-delay-eligibility.service.js';

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

  async function pushFixture(input: { status?: 'SUCCEEDED' | 'PENDING' | 'PROCESSING' | 'BLOCKED' | 'RECONCILE_REQUIRED';
    withCredential?: boolean; keepTracking?: boolean } = {}) {
    const source = await fixture({ withCredential: input.withCredential });
    if (!input.keepTracking) {
      await db.vendorIntegrationShipmentEvent.deleteMany({ where: { vendorAllocationId: source.id } });
      await db.vendorIntegrationClient.delete({ where: { id: source.client.id } });
      await db.vendorAllocation.update({ where: { id: source.id }, data: { trackingNumber: null } });
    }
    const sopyoOrderId = String(40_000_000 + sequence);
    const push = await db.sopyoOrderPush.create({ data: {
      vendorAllocationId: source.id, assignedVendorId: source.vendorId,
      orderCode: source.id, status: input.status ?? 'SUCCEEDED',
      sopyoOrderId: (input.status ?? 'SUCCEEDED') === 'SUCCEEDED' ? sopyoOrderId : null,
    } });
    return { ...source, push, sopyoOrderId };
  }

  function fakePushSopyo(target: { sopyoOrderId: string; id: string },
    override: Partial<{ id: number; order_code: string; order_type: string; order_status: number }> = {}) {
    const detailReads: string[] = [];
    const logins: string[] = [];
    const fetcher = (async (request: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(request));
      if (url.pathname === '/api/v2/auth/login') {
        const token = (JSON.parse(String(init?.body)) as { api_token: string[] }).api_token[0]!;
        logins.push(token);
        return Response.json({ access_token: { token: `bearer-${token}`, type: 'bearer' } });
      }
      if (url.pathname.startsWith('/api/v2/orders/')) {
        detailReads.push(url.pathname);
        return Response.json({ data: { id: Number(target.sopyoOrderId), order_code: target.id,
          order_type: 'SOPYOAPI', order_status: 6, ...override } });
      }
      const tracking = url.searchParams.get('cargo_tracking_no[eq]');
      return Response.json({ data: tracking ? [{ id: Number(target.sopyoOrderId), order_status: 2,
        cargo_info: { tracking_no: tracking } }] : [],
      meta: { current_page: 1, last_page: 1 } });
    }) as typeof fetch;
    return { fetcher, detailReads, logins };
  }

  it('records a successful push by numeric detail without tracking, inbound client, or shipment event', async () => {
    const source = await pushFixture();
    const { evaluateSaleSettlementDelay } = await import('../backend/src/modules/finance/settlement-delay-eligibility.service.js');
    const before = await db.vendorAllocation.findUniqueOrThrow({ where: { id: source.id }, include: { deliveredObservation: true } });
    expect(evaluateSaleSettlementDelay({ entryType: 'SALE', settlementDelayDaysSnapshot: 0, vendorAllocation: before }).eligible).toBe(false);
    expect(before.trackingNumber).toBeNull();
    expect(await db.vendorIntegrationShipmentEvent.count({ where: { vendorAllocationId: source.id } })).toBe(0);
    const api = fakePushSopyo(source);
    const start = new Date();
    await Promise.all([poll({ db, fetcher: api.fetcher }), poll({ db, fetcher: api.fetcher })]);
    const end = new Date();
    const observation = await db.allocationDeliveredObservation.findUniqueOrThrow({ where: { vendorAllocationId: source.id } });
    expect(observation).toMatchObject({ sopyoOrderPushId: source.push.id,
      vendorIntegrationClientId: null, shipmentExecutionId: null, sourceReference: source.sopyoOrderId });
    expect(observation.firstObservedDeliveredAt.getTime()).toBeGreaterThanOrEqual(start.getTime());
    expect(observation.firstObservedDeliveredAt.getTime()).toBeLessThanOrEqual(end.getTime());
    expect(api.detailReads).toContain(`/api/v2/orders/${source.sopyoOrderId}`);
    expect(await db.allocationDeliveredObservation.count({ where: { vendorAllocationId: source.id } })).toBe(1);
    await poll({ db, fetcher: api.fetcher });
    expect((await db.allocationDeliveredObservation.findUniqueOrThrow({ where: { vendorAllocationId: source.id } })).firstObservedDeliveredAt)
      .toEqual(observation.firstObservedDeliveredAt);
    const after = await db.vendorAllocation.findUniqueOrThrow({ where: { id: source.id }, include: { deliveredObservation: true } });
    expect(evaluateSaleSettlementDelay({ entryType: 'SALE', settlementDelayDaysSnapshot: 0, vendorAllocation: after,
    }, observation.firstObservedDeliveredAt).eligible).toBe(true);
    expect(evaluateSaleSettlementDelay({ entryType: 'SALE', settlementDelayDaysSnapshot: 1, vendorAllocation: after,
    }, observation.firstObservedDeliveredAt).eligible).toBe(false);
  });

  it('keeps a positive frozen SALE cutoff stable from Sopyo delivery intake through settlement preview', async () => {
    const source = await pushFixture();
    const saleId = `${source.id}-sale`;
    const orderNumber = `#${source.id}`;
    const frozenDelayDays = 1;
    await db.vendorFinancialProfile.create({ data: { vendorId: source.vendorId, settlementDelayDays: 0 } });
    await db.financeLedgerEntry.create({ data: {
      id: saleId, vendorAllocationId: source.id, vendorId: source.vendorId,
      entryType: 'sale', amount: '100.00', payoutStatus: 'PENDING', settlementStatus: 'ACCRUING',
      commissionPercentSnapshot: '10.00', commissionVatPercentSnapshot: '20.00',
      settlementDelayDaysSnapshot: frozenDelayDays,
    } });
    await db.fulfillment.create({ data: {
      vendorAllocationId: source.id, fulfillmentStatus: 'fulfilled',
      shipmentUpdatedAt: new Date('2020-01-01T00:00:00.000Z'),
    } });
    const { previewApproval } = await import('../backend/src/modules/finance/settlement-approval.service.js');
    const previewAt = (asOfDate: Date) => previewApproval(source.vendorId, null, null, {
      candidateScope: 'selected_orders', selectedOrderIds: [orderNumber], asOfDate,
    });

    expect(await db.allocationDeliveredObservation.count({ where: { vendorAllocationId: source.id } })).toBe(0);
    const beforeDelivery = await previewAt(new Date());
    expect(beforeDelivery.lines).toHaveLength(0);
    expect(beforeDelivery.selectedOrderDiagnostics).toEqual([expect.objectContaining({
      financeLedgerEntryId: saleId, candidateIncluded: false,
      derivedSettlementStatus: 'accruing', excludedReason: MISSING_DELIVERY_DATE_REASON,
    })]);

    const api = fakePushSopyo(source);
    const pollStartedAt = new Date();
    await poll({ db, fetcher: api.fetcher });
    const pollFinishedAt = new Date();
    const observation = await db.allocationDeliveredObservation.findUniqueOrThrow({
      where: { vendorAllocationId: source.id },
    });
    expect(api.detailReads).toContain(`/api/v2/orders/${source.sopyoOrderId}`);
    expect(observation).toMatchObject({
      vendorAllocationId: source.id, sopyoOrderPushId: source.push.id,
      sourceReference: source.sopyoOrderId, outboundMethod: 'VENDOR_INTEGRATION',
      outboundIntegrationProvider: 'SOPYO',
    });
    expect(observation.firstObservedDeliveredAt.getTime()).toBeGreaterThanOrEqual(pollStartedAt.getTime());
    expect(observation.firstObservedDeliveredAt.getTime()).toBeLessThanOrEqual(pollFinishedAt.getTime());
    expect(await db.allocationDeliveredObservation.count({ where: { vendorAllocationId: source.id } })).toBe(1);

    const persistedSale = await db.financeLedgerEntry.findUniqueOrThrow({ where: { id: saleId } });
    expect(persistedSale.settlementDelayDaysSnapshot).toBe(frozenDelayDays);
    const cutoff = new Date(observation.firstObservedDeliveredAt.getTime() + frozenDelayDays * 24 * 60 * 60 * 1000);
    const beforeCutoff = await previewAt(new Date(cutoff.getTime() - 1));
    expect(beforeCutoff.lines).toHaveLength(0);
    expect(beforeCutoff.selectedOrderDiagnostics).toEqual([expect.objectContaining({
      financeLedgerEntryId: saleId, candidateIncluded: false,
      derivedSettlementStatus: 'accruing', excludedReason: SETTLEMENT_DELAY_PENDING_REASON,
    })]);

    const atCutoff = await previewAt(cutoff);
    expect(atCutoff.lines).toEqual([expect.objectContaining({
      financeLedgerEntryId: saleId, lineType: 'SALE', derivedSettlementStatus: 'payable',
      eligibilityDecision: 'included',
      eligibilityReason: 'Derived payable because delivery evidence satisfies settlement delay.',
      sourceSnapshotJson: expect.objectContaining({ settlementDelayDaysSnapshot: frozenDelayDays }),
    })]);
    expect(atCutoff.selectedOrderDiagnostics).toEqual([expect.objectContaining({
      financeLedgerEntryId: saleId, candidateIncluded: true, derivedSettlementStatus: 'payable',
      excludedReason: null,
    })]);

    await poll({ db, fetcher: api.fetcher });
    const replayed = await db.allocationDeliveredObservation.findUniqueOrThrow({ where: { vendorAllocationId: source.id } });
    expect(replayed.id).toBe(observation.id);
    expect(replayed.firstObservedDeliveredAt).toEqual(observation.firstObservedDeliveredAt);
    expect(await db.allocationDeliveredObservation.count({ where: { vendorAllocationId: source.id } })).toBe(1);

    const laterShipmentUpdate = new Date(cutoff.getTime() + 7 * 24 * 60 * 60 * 1000);
    await db.fulfillment.update({ where: { vendorAllocationId: source.id }, data: {
      shipmentUpdatedAt: laterShipmentUpdate,
    } });
    expect((await db.fulfillment.findUniqueOrThrow({ where: { vendorAllocationId: source.id } })).shipmentUpdatedAt)
      .toEqual(laterShipmentUpdate);
    const stillBeforeCutoff = await previewAt(new Date(cutoff.getTime() - 1));
    expect(stillBeforeCutoff.lines).toHaveLength(0);
    expect(stillBeforeCutoff.selectedOrderDiagnostics).toEqual([expect.objectContaining({
      financeLedgerEntryId: saleId, candidateIncluded: false,
      derivedSettlementStatus: 'accruing', excludedReason: SETTLEMENT_DELAY_PENDING_REASON,
    })]);
    const afterRefresh = await previewAt(cutoff);
    expect(afterRefresh.lines).toEqual([expect.objectContaining({
      financeLedgerEntryId: saleId, derivedSettlementStatus: 'payable', eligibilityDecision: 'included',
      eligibilityReason: 'Derived payable because delivery evidence satisfies settlement delay.',
    })]);
    expect((await db.allocationDeliveredObservation.findUniqueOrThrow({ where: { vendorAllocationId: source.id } }))
      .firstObservedDeliveredAt).toEqual(observation.firstObservedDeliveredAt);
  });

  it('rejects push detail identity mismatches and non-delivered status', async () => {
    for (const override of [{ id: 999 }, { order_code: 'other-allocation' },
      { order_type: 'OTHER' }, { order_status: 2 }]) {
      const source = await pushFixture();
      await poll({ db, fetcher: fakePushSopyo(source, override).fetcher });
      expect(await db.allocationDeliveredObservation.count({ where: { vendorAllocationId: source.id } })).toBe(0);
    }
  });

  it('keeps unresolved pushes and missing credentials from creating observations', async () => {
    for (const status of ['PENDING', 'PROCESSING', 'BLOCKED', 'RECONCILE_REQUIRED'] as const) {
      const source = await pushFixture({ status });
      const api = fakePushSopyo(source);
      await poll({ db, fetcher: api.fetcher });
      expect(api.detailReads).not.toContain(`/api/v2/orders/${source.sopyoOrderId}`);
      expect(await db.allocationDeliveredObservation.count({ where: { vendorAllocationId: source.id } })).toBe(0);
    }
    const missing = await pushFixture({ withCredential: false });
    const api = fakePushSopyo(missing);
    await poll({ db, fetcher: api.fetcher });
    expect(api.logins).not.toContain(`api-${missing.vendorId}`);
    expect(await db.allocationDeliveredObservation.count({ where: { vendorAllocationId: missing.id } })).toBe(0);
  });

  it('enforces push provenance, one FK branch, and immutable first time in PostgreSQL', async () => {
    const source = await pushFixture();
    const legacy = await fixture({ vendorId: source.vendorId, withCredential: false });
    const data = { vendorAllocationId: source.id, outboundMethod: 'VENDOR_INTEGRATION' as const,
      outboundIntegrationProvider: 'SOPYO' as const, sourceReference: source.sopyoOrderId };
    await expect(db.allocationDeliveredObservation.create({ data: { ...data, sopyoOrderPushId: 'nonexistent' } })).rejects.toThrow();
    await expect(db.allocationDeliveredObservation.create({ data: { ...data, sopyoOrderPushId: source.push.id,
      vendorIntegrationClientId: legacy.client.id } })).rejects.toThrow();
    await expect(db.allocationDeliveredObservation.create({ data: { ...data, sopyoOrderPushId: source.push.id,
      sourceReference: '999' } })).rejects.toThrow();
    const other = await pushFixture();
    await expect(db.allocationDeliveredObservation.create({ data: { ...data, sopyoOrderPushId: other.push.id } })).rejects.toThrow();
    const observation = await db.allocationDeliveredObservation.create({ data: { ...data, sopyoOrderPushId: source.push.id } });
    await expect(db.allocationDeliveredObservation.update({ where: { id: observation.id },
      data: { firstObservedDeliveredAt: new Date(0) } })).rejects.toThrow();
    await expect(db.allocationDeliveredObservation.delete({ where: { id: observation.id } })).rejects.toThrow();
  });

  it('blocks unresolved tracking and conflicting successful-push tracking at the write boundary', async () => {
    const { recordVerifiedDeliveredObservation } = await import('../backend/src/modules/shipping/allocation-delivered-observation.service.js');
    const unresolved = await pushFixture({ status: 'PENDING', keepTracking: true });
    await expect(recordVerifiedDeliveredObservation({ allocationId: unresolved.id, source: {
      method: 'VENDOR_INTEGRATION', providerCode: 'SOPYO', clientId: unresolved.client.id,
      sourceReference: unresolved.sopyoOrderId,
    } }, db)).rejects.toThrow('push identity');
    await expect(db.allocationDeliveredObservation.create({ data: {
      vendorAllocationId: unresolved.id, outboundMethod: 'VENDOR_INTEGRATION',
      outboundIntegrationProvider: 'SOPYO', vendorIntegrationClientId: unresolved.client.id,
      sourceReference: unresolved.sopyoOrderId,
    } })).rejects.toThrow();
    const successful = await pushFixture({ keepTracking: true });
    await expect(recordVerifiedDeliveredObservation({ allocationId: successful.id, source: {
      method: 'VENDOR_INTEGRATION', providerCode: 'SOPYO', clientId: successful.client.id,
      sourceReference: '999',
    } }, db)).rejects.toThrow('push identity');
    const first = await recordVerifiedDeliveredObservation({ allocationId: successful.id, source: {
      method: 'VENDOR_INTEGRATION', providerCode: 'SOPYO', clientId: successful.client.id,
      sourceReference: successful.sopyoOrderId,
    } }, db);
    const replay = await recordVerifiedDeliveredObservation({ allocationId: successful.id, source: {
      method: 'VENDOR_INTEGRATION', providerCode: 'SOPYO', pushId: successful.push.id,
      sourceReference: successful.sopyoOrderId,
    } }, db);
    expect(replay.id).toBe(first.id);
    expect(replay.firstObservedDeliveredAt).toEqual(first.firstObservedDeliveredAt);
    expect(replay.vendorIntegrationClientId).toBe(successful.client.id);
    expect(replay.sopyoOrderPushId).toBeNull();
  });

  it('requires push vendor and frozen source identity before numeric detail lookup', async () => {
    const foreignVendor = await pushFixture();
    await db.sopyoOrderPush.update({ where: { id: foreignVendor.push.id }, data: { assignedVendorId: 'other-vendor' } });
    const otherMethod = await pushFixture();
    await db.vendorAllocation.update({ where: { id: otherMethod.id }, data: {
      outboundMethodSnapshot: 'KARGONOMI', outboundIntegrationProviderSnapshot: null,
    } });
    const api = fakePushSopyo(foreignVendor);
    await poll({ db, fetcher: api.fetcher });
    expect(api.detailReads).not.toContain(`/api/v2/orders/${foreignVendor.sopyoOrderId}`);
    expect(api.detailReads).not.toContain(`/api/v2/orders/${otherMethod.sopyoOrderId}`);
    expect(await db.allocationDeliveredObservation.count({ where: {
      vendorAllocationId: { in: [foreignVendor.id, otherMethod.id] },
    } })).toBe(0);
  });

  it('uses only each push allocation’s assigned-vendor credential', async () => {
    const first = await pushFixture();
    const second = await pushFixture();
    const requests: Array<{ orderId: string; bearer: string }> = [];
    const fetcher = (async (request: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(request));
      if (url.pathname === '/api/v2/auth/login') {
        const token = (JSON.parse(String(init?.body)) as { api_token: string[] }).api_token[0]!;
        return Response.json({ access_token: { token, type: 'bearer' } });
      }
      if (url.pathname.startsWith('/api/v2/orders/')) {
        const orderId = url.pathname.split('/').at(-1)!;
        requests.push({ orderId, bearer: String((init?.headers as Record<string, string>).Authorization) });
        const source = orderId === first.sopyoOrderId ? first : second;
        return Response.json({ data: { id: Number(orderId), order_code: source.id,
          order_type: 'SOPYOAPI', order_status: 6 } });
      }
      return Response.json({ data: [], meta: { current_page: 1, last_page: 1 } });
    }) as typeof fetch;
    await poll({ db, fetcher });
    expect(requests).toContainEqual({ orderId: first.sopyoOrderId,
      bearer: `Bearer api-${first.vendorId}` });
    expect(requests).toContainEqual({ orderId: second.sopyoOrderId,
      bearer: `Bearer api-${second.vendorId}` });
    expect(await db.allocationDeliveredObservation.count({ where: {
      vendorAllocationId: { in: [first.id, second.id] },
    } })).toBe(2);
  });

  it('lets legacy tracking record the same successful push order but rejects a different one', async () => {
    const matching = await pushFixture({ keepTracking: true });
    const different = await pushFixture({ keepTracking: true });
    const fetcher = (async (request: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(request));
      if (url.pathname === '/api/v2/auth/login') return Response.json({ access_token: { token: 'bearer', type: 'bearer' } });
      if (url.pathname.startsWith('/api/v2/orders/')) return Response.json({ data: {
        id: Number(url.pathname.split('/').at(-1)),
        order_code: 'not-the-order-code', order_type: 'SOPYOAPI', order_status: 6 } });
      const number = url.searchParams.get('cargo_tracking_no[eq]');
      return Response.json({ data: [{ id: number === matching.tracking ? Number(matching.sopyoOrderId) : 999,
        order_status: 6, cargo_info: { tracking_no: number } }],
      meta: { current_page: 1, last_page: 1 } });
    }) as typeof fetch;
    await poll({ db, fetcher });
    const observation = await db.allocationDeliveredObservation.findUniqueOrThrow({ where: { vendorAllocationId: matching.id } });
    expect(observation).toMatchObject({ sourceReference: matching.sopyoOrderId,
      vendorIntegrationClientId: matching.client.id, sopyoOrderPushId: null });
    expect(await db.allocationDeliveredObservation.count({ where: { vendorAllocationId: different.id } })).toBe(0);
  });

  it('the canonical recorder resolves concurrent push and legacy claims for the same ID without overwrite', async () => {
    const source = await pushFixture({ keepTracking: true });
    const { recordVerifiedDeliveredObservation } = await import('../backend/src/modules/shipping/allocation-delivered-observation.service.js');
    const [one, two] = await Promise.all([
      recordVerifiedDeliveredObservation({ allocationId: source.id, source: {
        method: 'VENDOR_INTEGRATION', providerCode: 'SOPYO', pushId: source.push.id,
        sourceReference: source.sopyoOrderId,
      } }, db),
      recordVerifiedDeliveredObservation({ allocationId: source.id, source: {
        method: 'VENDOR_INTEGRATION', providerCode: 'SOPYO', clientId: source.client.id,
        sourceReference: source.sopyoOrderId,
      } }, db),
    ]);
    expect(one.id).toBe(two.id);
    expect(one.firstObservedDeliveredAt).toEqual(two.firstObservedDeliveredAt);
    expect(await db.allocationDeliveredObservation.count({ where: { vendorAllocationId: source.id } })).toBe(1);
    const persisted = await db.allocationDeliveredObservation.findUniqueOrThrow({ where: { vendorAllocationId: source.id } });
    expect([persisted.sopyoOrderPushId, persisted.vendorIntegrationClientId].filter(Boolean)).toHaveLength(1);
  });

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
