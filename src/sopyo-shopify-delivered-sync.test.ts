import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppEnv } from '../backend/src/config/env.js';
import { processSopyoShopifyDeliveredSync } from '../backend/src/modules/vendor-integration/sopyo-shopify-delivered-sync.service.js';
import { processSopyoShopifyDeliveredCandidates, createSopyoShopifyDeliveredWorker,
  registerSopyoShopifyDeliveredScheduler }
  from '../backend/src/modules/vendor-integration/sopyo-shopify-delivered-worker.service.js';
import { preserveVerifiedSopyoDelivered }
  from '../backend/src/modules/shopify/sopyo-delivered-projection.service.js';

const env = { SHOPIFY_API_VERSION: '2026-01', SHOPIFY_SHOP_DOMAIN: 'example.myshopify.com',
  SHOPIFY_ADMIN_ACCESS_TOKEN: 'test-token', SOPYO_DELIVERY_POLLING_ENABLED: true } as AppEnv;

function fixture(overrides: Record<string, unknown> = {}) {
  const allocation = {
    id: 'allocation-1', assignedVendorId: 'vendor-1', shippingStatus: 'delivered',
    outboundMethodSnapshot: 'VENDOR_INTEGRATION', outboundIntegrationProviderSnapshot: 'SOPYO',
    order: { sourceShopifyOrderId: '123' },
    deliveredObservation: { vendorAllocationId: 'allocation-1', outboundMethod: 'VENDOR_INTEGRATION',
      outboundIntegrationProvider: 'SOPYO', sourceReference: '456', sopyoOrderPushId: 'push-1',
      id: 'observation-1', firstObservedDeliveredAt: new Date('2026-10-05T12:00:00Z') },
    ...(overrides.allocation as object ?? {}),
  };
  return {
    id: 'intent-1', vendorAllocationId: 'allocation-1', sopyoOrderPushId: 'push-1',
    assignedVendorId: 'vendor-1', sopyoOrderId: '456', orderCode: 'allocation-1',
    status: 'CONFIRMED', shopifyFulfillmentId: 'gid://shopify/Fulfillment/789',
    deliveredSyncStatus: null as string | null, deliveredSubmissionStartedAt: null as Date | null,
    deliveredConfirmedAt: null as Date | null, deliveredRejectedAt: null as Date | null,
    deliveredRejectReasonCode: null as string | null,
    sopyoOrderPush: { id: 'push-1', vendorAllocationId: 'allocation-1', assignedVendorId: 'vendor-1',
      orderCode: 'allocation-1', status: 'SUCCEEDED', sopyoOrderId: '456' },
    vendorAllocation: allocation,
    ...overrides,
  };
}

function harness(overrides: Record<string, unknown> = {}) {
  const row = fixture(overrides);
  const findUnique = vi.fn(async () => row);
  const updateMany = vi.fn(async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
    if (args.where.status && args.where.status !== row.status) return { count: 0 };
    if (args.where.shopifyFulfillmentId && args.where.shopifyFulfillmentId !== row.shopifyFulfillmentId) {
      return { count: 0 };
    }
    const expected = args.where.deliveredSyncStatus;
    if (typeof expected === 'object' && expected !== null && 'in' in expected) {
      if (!(expected.in as string[]).includes(row.deliveredSyncStatus ?? '')) return { count: 0 };
    } else if (expected !== undefined && expected !== row.deliveredSyncStatus) return { count: 0 };
    Object.assign(row, args.data);
    return { count: 1 };
  });
  const db = { sopyoShipmentIntent: { findUnique, updateMany },
    $transaction: (callback: (tx: unknown) => Promise<unknown>) => callback(db) };
  const read = vi.fn().mockResolvedValue({ delivered: false });
  const create = vi.fn().mockResolvedValue({ outcome: 'success' });
  const run = () => processSopyoShopifyDeliveredSync({ intentId: row.id, env,
    shopifyAdminService: { readSopyoFulfillmentDelivered: read,
      createSopyoDeliveredEvent: create } }, db as never);
  return { row, db, read, create, run, updateMany };
}

afterEach(() => vi.useRealTimers());

describe('Sopyo Delivered downstream synchronization', () => {
  it('confirms an already-DELIVERED exact fulfillment without mutation', async () => {
    const h = harness();
    h.read.mockResolvedValue({ delivered: true });
    expect(await h.run()).toBe('confirmed');
    expect(h.row.deliveredSyncStatus).toBe('CONFIRMED');
    expect(h.create).not.toHaveBeenCalled();
    expect(h.read).toHaveBeenCalledWith({ fulfillmentId: 'gid://shopify/Fulfillment/789',
      orderGid: 'gid://shopify/Order/123' });
  });

  it('claims once before the exact mutation and confirms only after read-back', async () => {
    const h = harness();
    h.read.mockResolvedValueOnce({ delivered: false }).mockResolvedValueOnce({ delivered: true });
    h.create.mockImplementation(async (id: string) => {
      expect(h.row.deliveredSyncStatus).toBe('SUBMISSION_PENDING');
      expect(id).toBe(h.row.shopifyFulfillmentId);
      return { outcome: 'success' };
    });
    const originalObservation = h.row.vendorAllocation.deliveredObservation;
    expect(await h.run()).toBe('confirmed');
    expect(h.create).toHaveBeenCalledTimes(1);
    expect(h.row.vendorAllocation.shippingStatus).toBe('delivered');
    expect(h.row.vendorAllocation.deliveredObservation).toBe(originalObservation);
  });

  it.each([
    { status: 'CONFLICT' },
    { shopifyFulfillmentId: null },
    { vendorAllocation: { ...fixture().vendorAllocation,
      outboundIntegrationProviderSnapshot: null } },
    { vendorAllocation: { ...fixture().vendorAllocation,
      deliveredObservation: null } },
    { sopyoOrderPush: { ...fixture().sopyoOrderPush, assignedVendorId: 'another-vendor' } },
  ])('fails closed on wrong identity or missing authority', async (override) => {
    const h = harness(override);
    expect(await h.run()).toBe('skipped');
    expect(h.read).not.toHaveBeenCalled();
    expect(h.create).not.toHaveBeenCalled();
  });

  it('retains a definite user-error rejection without retry', async () => {
    const h = harness();
    h.create.mockResolvedValue({ outcome: 'rejected' });
    expect(await h.run()).toBe('rejected');
    expect(h.row.deliveredSyncStatus).toBe('REJECTED');
    expect(h.row.deliveredRejectReasonCode).toBe('SHOPIFY_USER_ERROR');
    expect(await h.run()).toBe('skipped');
    expect(h.create).toHaveBeenCalledTimes(1);
  });

  it('retains unknown outcome and later confirms only from positive exact read', async () => {
    const h = harness();
    h.create.mockResolvedValue({ outcome: 'unknown' });
    expect(await h.run()).toBe('outcome_unknown');
    expect(h.row.deliveredSyncStatus).toBe('OUTCOME_UNKNOWN');
    expect(await h.run()).toBe('outcome_unknown');
    h.read.mockResolvedValue({ delivered: true });
    expect(await h.run()).toBe('confirmed');
    expect(h.create).toHaveBeenCalledTimes(1);
  });

  it('treats an interrupted pending claim as unknown, never resubmitting', async () => {
    const h = harness({ deliveredSyncStatus: 'SUBMISSION_PENDING',
      deliveredSubmissionStartedAt: new Date() });
    expect(await h.run()).toBe('outcome_unknown');
    expect(h.row.deliveredSyncStatus).toBe('OUTCOME_UNKNOWN');
    expect(h.create).not.toHaveBeenCalled();
  });

  it('fences competing workers to one deliberate event mutation', async () => {
    const h = harness();
    h.create.mockResolvedValue({ outcome: 'unknown' });
    await Promise.all([h.run(), h.run()]);
    expect(h.create).toHaveBeenCalledTimes(1);
    expect(h.row.deliveredSyncStatus).toBe('OUTCOME_UNKNOWN');
  });
});

describe('Sopyo Delivered worker and local projection', () => {
  it('keeps the existing delivery-polling opt-in gate', () => {
    const addHook = vi.fn();
    const app = { addHook, log: { info: vi.fn(), error: vi.fn() } };
    expect(registerSopyoShopifyDeliveredScheduler(app as never,
      { ...env, SOPYO_DELIVERY_POLLING_ENABLED: false })).toBeNull();
    expect(addHook).not.toHaveBeenCalled();
    expect(registerSopyoShopifyDeliveredScheduler(app as never, env)).not.toBeNull();
    expect(addHook).toHaveBeenCalledTimes(2);
  });

  it('discovers pre-existing unset rows and excludes CONFLICT/other statuses', async () => {
    const findMany = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'old-intent' }]);
    const process = vi.fn().mockResolvedValue('confirmed');
    const report = await processSopyoShopifyDeliveredCandidates({ env,
      db: { sopyoShipmentIntent: { findMany } } as never, process });
    expect(report).toMatchObject({ candidates: 1, confirmed: 1 });
    expect(findMany.mock.calls[1]?.[0]?.where).toMatchObject({ status: 'CONFIRMED',
      deliveredSyncStatus: null });
  });

  it('starts on delayed first tick and prevents overlapping cycles', async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    const process = vi.fn().mockImplementation(() => new Promise((resolve) => { finish = () => resolve({}); }));
    const logger = { info: vi.fn(), error: vi.fn() };
    const worker = createSopyoShopifyDeliveredWorker({ env, logger: logger as never, process });
    worker.start();
    expect(process).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(process).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(process).toHaveBeenCalledTimes(1);
    finish();
    await worker.close();
  });

  it('protects only ordinary progression on source-aligned Sopyo Delivered', () => {
    const row = fixture().vendorAllocation;
    expect(preserveVerifiedSopyoDelivered(row as never, 'shipped')).toBe(true);
    expect(preserveVerifiedSopyoDelivered(row as never, 'in_transit')).toBe(true);
    expect(preserveVerifiedSopyoDelivered(row as never, 'partially_shipped')).toBe(true);
    expect(preserveVerifiedSopyoDelivered(row as never, 'delivered')).toBe(false);
    expect(preserveVerifiedSopyoDelivered(row as never, 'fulfillment_event_attention')).toBe(false);
    expect(preserveVerifiedSopyoDelivered({ ...row, deliveredObservation: null } as never, 'shipped')).toBe(false);
    expect(preserveVerifiedSopyoDelivered({ ...row, outboundMethodSnapshot: 'KARGONOMI' } as never,
      'shipped')).toBe(false);
  });
});
