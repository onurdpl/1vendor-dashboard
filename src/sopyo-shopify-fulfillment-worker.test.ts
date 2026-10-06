import { afterEach, describe, expect, it, vi } from 'vitest';
import { processSopyoShopifySync, createSopyoShopifySyncWorker,
  registerSopyoShopifySyncScheduler } from '../backend/src/modules/vendor-integration/sopyo-shopify-fulfillment-worker.service.js';
import { SOPYO_DELIVERY_POLL_INTERVAL_MS } from '../backend/src/modules/vendor-integration/sopyo-delivery-poll.service.js';

const env = { SHOPIFY_API_VERSION: '2026-01', SHOPIFY_SHOP_DOMAIN: 'example.myshopify.com',
  SHOPIFY_ADMIN_ACCESS_TOKEN: 'test-token', SOPYO_DELIVERY_POLLING_ENABLED: true } as never;

function candidate(status: string, id: string, overrides: Record<string, unknown> = {}) {
  const allocationId = `allocation-${id}`;
  return {
    id, status, vendorAllocationId: allocationId, assignedVendorId: 'vendor-a',
    sopyoOrderPushId: `push-${id}`, sopyoOrderId: '38154205', orderCode: allocationId,
    carrier: 'Carrier', trackingNumber: 'TRACK-123',
    shopifyLocationGid: 'gid://shopify/Location/1', shopifyFulfillmentId: null,
    executionPlan: status === 'CARGO_VERIFIED' ? null : { id: `plan-${id}` },
    sopyoOrderPush: { id: `push-${id}`, vendorAllocationId: allocationId,
      assignedVendorId: 'vendor-a', orderCode: allocationId, status: 'SUCCEEDED', sopyoOrderId: '38154205' },
    vendorAllocation: { id: allocationId, assignedVendorId: 'vendor-a', allocationStatus: 'ACTIVE',
      cancellationReason: null, reassignmentRequired: false,
      outboundMethodSnapshot: 'VENDOR_INTEGRATION', outboundIntegrationProviderSnapshot: 'SOPYO',
      shopifyLocationGidSnapshot: 'gid://shopify/Location/1', carrier: 'Carrier',
      trackingNumber: 'TRACK-123', shippingStatus: 'In Transit' },
    ...overrides,
  };
}

function harness(rows: ReturnType<typeof candidate>[]) {
  const findMany = vi.fn().mockResolvedValue(rows);
  const plan = vi.fn().mockResolvedValue({ id: 'plan' });
  const execute = vi.fn().mockResolvedValue({ status: 'CONFIRMED' });
  const logger = { info: vi.fn(), error: vi.fn() };
  return { findMany, plan, execute, logger,
    dependencies: { db: { sopyoShipmentIntent: { findMany } }, plan, execute } as never };
}

afterEach(() => { vi.useRealTimers(); });

describe('Sopyo Shopify sync state routing', () => {
  it('plans verified cargo and delegates executable state to the existing executor', async () => {
    const h = harness([candidate('CARGO_VERIFIED', 'a')]);
    const report = await processSopyoShopifySync({ env, dependencies: h.dependencies, logger: h.logger as never });
    expect(h.plan).toHaveBeenCalledExactlyOnceWith({ intentId: 'a', env });
    expect(h.execute).toHaveBeenCalledExactlyOnceWith({ intentId: 'a', env });
    expect(report).toMatchObject({ planned: 1, executed: 1, confirmed: 1, failed: 0 });
    expect(h.findMany.mock.calls[0]?.[0]?.where.status.in).not.toContain('CONFIRMED');
    expect(h.findMany.mock.calls[0]?.[0]?.where.status.in).not.toContain('CONFLICT');
  });

  it('executes a ready plan without planning again', async () => {
    const h = harness([candidate('PLAN_READY', 'a')]);
    await processSopyoShopifySync({ env, dependencies: h.dependencies });
    expect(h.plan).not.toHaveBeenCalled();
    expect(h.execute).toHaveBeenCalledTimes(1);
  });

  it.each(['SUBMISSION_PENDING', 'OUTCOME_UNKNOWN', 'RECONCILIATION_PENDING'])(
    '%s delegates only to executor replay/reconciliation, never planner', async (status) => {
      const h = harness([candidate(status, 'a')]);
      h.execute.mockResolvedValueOnce({ status: 'OUTCOME_UNKNOWN' });
      const first = await processSopyoShopifySync({ env, dependencies: h.dependencies });
      h.execute.mockResolvedValueOnce({ status: 'CONFIRMED' });
      const second = await processSopyoShopifySync({ env, dependencies: h.dependencies });
      expect(h.plan).not.toHaveBeenCalled();
      expect(h.execute).toHaveBeenCalledTimes(2);
      expect(first).toMatchObject({ reconciled: 1, confirmed: 0 });
      expect(second).toMatchObject({ reconciled: 1, confirmed: 1 });
    });

  it('fails closed for invalid projection, frozen authority, or plan/state disagreement', async () => {
    const h = harness([
      candidate('CARGO_VERIFIED', 'a', { vendorAllocation: {
        ...candidate('CARGO_VERIFIED', 'a').vendorAllocation, trackingNumber: 'OTHER',
      } }),
      candidate('PLAN_READY', 'b', { executionPlan: null }),
      candidate('CARGO_VERIFIED', 'c', { vendorAllocation: {
        ...candidate('CARGO_VERIFIED', 'c').vendorAllocation, shopifyLocationGidSnapshot: null,
      } }),
    ]);
    const report = await processSopyoShopifySync({ env, dependencies: h.dependencies, logger: h.logger as never });
    expect(report.skipped).toBe(3);
    expect(h.plan).not.toHaveBeenCalled();
    expect(h.execute).not.toHaveBeenCalled();
  });

  it('skips a NULL-location cargo intent without interrupting another candidate', async () => {
    const missing = candidate('CARGO_VERIFIED', 'missing', {
      shopifyLocationGid: null,
      vendorAllocation: { ...candidate('CARGO_VERIFIED', 'missing').vendorAllocation,
        shopifyLocationGidSnapshot: null },
    });
    const h = harness([missing as never, candidate('CARGO_VERIFIED', 'ready')]);
    const report = await processSopyoShopifySync({ env, dependencies: h.dependencies, logger: h.logger as never });
    expect(report).toMatchObject({ candidateCount: 2, skipped: 1, planned: 1, executed: 1, failed: 0 });
    expect(h.plan).toHaveBeenCalledExactlyOnceWith({ intentId: 'ready', env });
    expect(h.execute).toHaveBeenCalledExactlyOnceWith({ intentId: 'ready', env });
  });

  it('never starts Shopify work under a different API version', async () => {
    const h = harness([candidate('CARGO_VERIFIED', 'a')]);
    const report = await processSopyoShopifySync({ env: { ...env, SHOPIFY_API_VERSION: '2024-01' },
      dependencies: h.dependencies, logger: h.logger as never });
    expect(report.candidateCount).toBe(0);
    expect(h.findMany).not.toHaveBeenCalled();
    expect(h.plan).not.toHaveBeenCalled();
    expect(h.execute).not.toHaveBeenCalled();
    expect(h.logger.error).toHaveBeenCalledWith({ event: 'SOPYO_SHOPIFY_SYNC_CONFIG_UNAVAILABLE' },
      'Sopyo Shopify sync requires Shopify Admin API 2026-01.');
  });

  it('isolates candidate errors and never logs exception text', async () => {
    const h = harness([candidate('PLAN_READY', 'a'), candidate('PLAN_READY', 'b')]);
    h.execute.mockRejectedValueOnce(new Error('secret customer address'));
    const report = await processSopyoShopifySync({ env, dependencies: h.dependencies,
      logger: h.logger as never });
    expect(h.execute).toHaveBeenCalledTimes(2);
    expect(report).toMatchObject({ failed: 1, confirmed: 1 });
    expect(JSON.stringify(h.logger.error.mock.calls)).not.toContain('secret customer address');
  });
});

describe('Sopyo Shopify sync scheduler', () => {
  it('reuses the opted-in 30-minute cadence, prevents overlap and drains on shutdown', async () => {
    vi.useFakeTimers();
    let finish!: (value: never) => void;
    const first = new Promise<never>((resolve) => { finish = resolve; });
    const process = vi.fn().mockReturnValueOnce(first).mockResolvedValue({ candidateCount: 0 });
    const logger = { info: vi.fn(), error: vi.fn() };
    const worker = createSopyoShopifySyncWorker({ env, logger: logger as never, process });
    worker.start();
    worker.start();
    await vi.advanceTimersByTimeAsync(SOPYO_DELIVERY_POLL_INTERVAL_MS);
    await vi.advanceTimersByTimeAsync(SOPYO_DELIVERY_POLL_INTERVAL_MS);
    expect(process).toHaveBeenCalledTimes(1);
    const closing = worker.close();
    finish({ candidateCount: 0 } as never);
    await closing;
    await vi.advanceTimersByTimeAsync(SOPYO_DELIVERY_POLL_INTERVAL_MS);
    expect(process).toHaveBeenCalledTimes(1);
  });

  it('registers only when the existing Sopyo polling switch is enabled', () => {
    const hooks: string[] = [];
    const app = { log: { info: vi.fn(), error: vi.fn() },
      addHook: (name: string) => { hooks.push(name); } };
    expect(registerSopyoShopifySyncScheduler(app as never,
      { ...env, SOPYO_DELIVERY_POLLING_ENABLED: false })).toBeNull();
    expect(hooks).toHaveLength(0);
    expect(registerSopyoShopifySyncScheduler(app as never, env)).not.toBeNull();
    expect(hooks).toEqual(['onReady', 'onClose']);
  });
});
