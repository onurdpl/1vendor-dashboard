import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadEnv } from '../backend/src/config/env.js';
import {
  createSopyoOrderPushWorker, registerSopyoOrderPushWorker,
} from '../backend/src/modules/vendor-integration/sopyo-order-push-worker.service.js';

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function env(overrides: Record<string, string | undefined>) {
  process.env = {
    ...originalEnv,
    NODE_ENV: 'test',
    SHIPPING_PROVIDER: 'kargonomi',
    KARGONOMI_BASE_URL: 'https://example.invalid/kargonomi',
    KARGONOMI_API_TOKEN: 'test-token',
    SOPYO_ORDER_PUSH_WORKER_ENABLED: undefined,
    SOPYO_ORDER_PUSH_WORKER_INTERVAL_MS: undefined,
    SOPYO_ORDER_PUSH_WORKER_BATCH_SIZE: undefined,
    ...overrides,
  };
  return loadEnv();
}

function harness(rows: { id: string; status: string; createdAt: Date }[]) {
  const logger = { info: vi.fn(), error: vi.fn() };
  const findMany = vi.fn(async (query: {
    where: { status: string };
    orderBy: { createdAt?: string; id?: string }[];
    take: number;
    select: { id: boolean };
  }) => rows.filter((row) => row.status === query.where.status)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
    .slice(0, query.take).map(({ id }) => ({ id })));
  const dispatch = vi.fn(async ({ pushId }: { pushId: string }) => ({ pushId, status: 'SUCCEEDED' }));
  const worker = createSopyoOrderPushWorker({
    intervalMs: 1_000,
    batchSize: 2,
    logger: logger as never,
    dependencies: { db: { sopyoOrderPush: { findMany } } as never, dispatch: dispatch as never },
  });
  return { worker, logger, findMany, dispatch };
}

const at = (time: number) => new Date(`2026-10-05T10:00:${String(time).padStart(2, '0')}.000Z`);

describe('Sopyo automatic order-push worker', () => {
  it('is disabled by default and does not register hooks or dispatch', () => {
    const parsed = env({});
    expect(parsed.SOPYO_ORDER_PUSH_WORKER_ENABLED).toBe(false);
    expect(parsed.SOPYO_ORDER_PUSH_WORKER_INTERVAL_MS).toBeUndefined();
    expect(parsed.SOPYO_ORDER_PUSH_WORKER_BATCH_SIZE).toBeUndefined();
    const app = { addHook: vi.fn(), log: { info: vi.fn(), error: vi.fn() } };
    expect(registerSopyoOrderPushWorker(app as never, parsed)).toBeNull();
    expect(app.addHook).not.toHaveBeenCalled();
  });

  it('requires explicit valid interval and batch size only when enabled', () => {
    expect(() => env({ SOPYO_ORDER_PUSH_WORKER_ENABLED: 'true' })).toThrow('SOPYO_ORDER_PUSH_WORKER_INTERVAL_MS');
    expect(() => env({ SOPYO_ORDER_PUSH_WORKER_ENABLED: 'true', SOPYO_ORDER_PUSH_WORKER_INTERVAL_MS: '1000' }))
      .toThrow('SOPYO_ORDER_PUSH_WORKER_BATCH_SIZE');
    for (const bad of ['0', '-1', '2.5', '2x', '9007199254740992']) {
      expect(() => env({ SOPYO_ORDER_PUSH_WORKER_ENABLED: 'true', SOPYO_ORDER_PUSH_WORKER_INTERVAL_MS: bad,
        SOPYO_ORDER_PUSH_WORKER_BATCH_SIZE: '2' })).toThrow('SOPYO_ORDER_PUSH_WORKER_INTERVAL_MS');
      expect(() => env({ SOPYO_ORDER_PUSH_WORKER_ENABLED: 'true', SOPYO_ORDER_PUSH_WORKER_INTERVAL_MS: '1000',
        SOPYO_ORDER_PUSH_WORKER_BATCH_SIZE: bad })).toThrow('SOPYO_ORDER_PUSH_WORKER_BATCH_SIZE');
    }
    expect(env({ SOPYO_ORDER_PUSH_WORKER_ENABLED: 'true', SOPYO_ORDER_PUSH_WORKER_INTERVAL_MS: '1000',
      SOPYO_ORDER_PUSH_WORKER_BATCH_SIZE: '2' })).toMatchObject({
      SOPYO_ORDER_PUSH_WORKER_ENABLED: true,
      SOPYO_ORDER_PUSH_WORKER_INTERVAL_MS: 1000,
      SOPYO_ORDER_PUSH_WORKER_BATCH_SIZE: 2,
    });
  });

  it('selects only the two oldest PENDING IDs, then delegates sequentially to Phase B', async () => {
    const rows = [
      { id: 'succeeded', status: 'SUCCEEDED', createdAt: at(0) },
      { id: 'blocked', status: 'BLOCKED', createdAt: at(0) },
      { id: 'reconcile', status: 'RECONCILE_REQUIRED', createdAt: at(0) },
      { id: 'processing', status: 'PROCESSING', createdAt: at(0) },
      { id: 'third', status: 'PENDING', createdAt: at(3) },
      { id: 'second', status: 'PENDING', createdAt: at(2) },
      { id: 'first', status: 'PENDING', createdAt: at(1) },
    ];
    const { worker, findMany, dispatch } = harness(rows);
    const fetcher = vi.spyOn(globalThis, 'fetch');
    await worker.runCycle();
    expect(findMany).toHaveBeenCalledWith({
      where: { status: 'PENDING' }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 2, select: { id: true },
    });
    expect(dispatch.mock.calls.map(([arg]) => arg)).toEqual([{ pushId: 'first' }, { pushId: 'second' }]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('isolates a failed push, continues the batch, and never logs error bodies or PII', async () => {
    const { worker, dispatch, logger } = harness([
      { id: 'first', status: 'PENDING', createdAt: at(1) },
      { id: 'second', status: 'PENDING', createdAt: at(2) },
    ]);
    dispatch.mockRejectedValueOnce(new Error('private@example.com bearer-secret 05551112233'));
    await worker.runCycle();
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledWith(
      { event: 'SOPYO_ORDER_PUSH_WORKER_DISPATCH_FAILED', pushId: 'first' },
      'Sopyo order-push worker dispatch failed.',
    );
    expect(JSON.stringify(logger.error.mock.calls)).not.toMatch(/private@example|bearer-secret|05551112233/);
  });

  it('continues after a BLOCKED result and confines scan exceptions to a safe category', async () => {
    const { worker, dispatch, findMany, logger } = harness([
      { id: 'first', status: 'PENDING', createdAt: at(1) },
      { id: 'second', status: 'PENDING', createdAt: at(2) },
    ]);
    findMany.mockRejectedValueOnce(new Error('private@example.com secret-token'));
    await worker.runCycle();
    expect(dispatch).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      { event: 'SOPYO_ORDER_PUSH_WORKER_SCAN_FAILED' }, 'Sopyo order-push worker scan failed.',
    );
    dispatch.mockResolvedValueOnce({ pushId: 'first', status: 'BLOCKED' });
    await worker.runCycle();
    expect(dispatch.mock.calls.map(([arg]) => arg.pushId)).toEqual(['first', 'second']);
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('private@example.com');
  });

  it('does not overlap cycles in one process and clears its timer on shutdown', async () => {
    vi.useFakeTimers();
    let release: (() => void) | undefined;
    const { worker, dispatch, findMany } = harness([{ id: 'first', status: 'PENDING', createdAt: at(1) }]);
    dispatch.mockImplementationOnce(async ({ pushId }) => {
      await new Promise<void>((resolve) => { release = resolve; });
      return { pushId, status: 'SUCCEEDED' };
    });
    worker.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(dispatch).toHaveBeenCalledOnce();
    void worker.runCycle();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(findMany).toHaveBeenCalledOnce();
    const closing = worker.close();
    release?.();
    await closing;
    await vi.advanceTimersByTimeAsync(3_000);
    expect(findMany).toHaveBeenCalledOnce();
  });

  it('rediscovers durable PENDING IDs after a worker restart and relies on Phase B claim fencing', async () => {
    const rows = [{ id: 'same', status: 'PENDING', createdAt: at(1) }];
    let createClaims = 0;
    const dispatch = vi.fn(async ({ pushId }: { pushId: string }) => {
      const row = rows.find((item) => item.id === pushId);
      if (row?.status !== 'PENDING') return { pushId, status: 'NOT_CLAIMED' };
      row.status = 'PROCESSING';
      createClaims += 1;
      return { pushId, status: 'SUCCEEDED' };
    });
    const first = harness(rows);
    const second = harness(rows);
    const firstWorker = createSopyoOrderPushWorker({ intervalMs: 1_000, batchSize: 2,
      logger: first.logger as never, dependencies: { db: { sopyoOrderPush: { findMany: first.findMany } } as never,
        dispatch: dispatch as never } });
    const secondWorker = createSopyoOrderPushWorker({ intervalMs: 1_000, batchSize: 2,
      logger: second.logger as never, dependencies: { db: { sopyoOrderPush: { findMany: second.findMany } } as never,
        dispatch: dispatch as never } });
    await Promise.all([firstWorker.runCycle(), secondWorker.runCycle()]);
    expect(createClaims).toBe(1);
    expect(dispatch).toHaveBeenCalledTimes(2);
    // A newly durable pending row is visible to a later process; the scan has no in-memory ownership.
    rows.push({ id: 'later', status: 'PENDING', createdAt: at(2) });
    await secondWorker.runCycle();
    expect(createClaims).toBe(2);
  });

  it('registers startup and shutdown hooks only with an enabled database-backed configuration', async () => {
    const hooks = new Map<string, () => Promise<void>>();
    const app = { addHook: vi.fn((name: string, hook: () => Promise<void>) => hooks.set(name, hook)),
      log: { info: vi.fn(), error: vi.fn() } };
    expect(() => registerSopyoOrderPushWorker(app as never, {
      SOPYO_ORDER_PUSH_WORKER_ENABLED: true, SOPYO_ORDER_PUSH_WORKER_INTERVAL_MS: 1000,
      SOPYO_ORDER_PUSH_WORKER_BATCH_SIZE: 2,
    } as never)).toThrow('DATABASE_URL');
    const worker = registerSopyoOrderPushWorker(app as never, {
      DATABASE_URL: 'postgres://local/test', SOPYO_ORDER_PUSH_WORKER_ENABLED: true,
      SOPYO_ORDER_PUSH_WORKER_INTERVAL_MS: 1000, SOPYO_ORDER_PUSH_WORKER_BATCH_SIZE: 2,
    } as never);
    expect(worker).not.toBeNull();
    expect([...hooks.keys()]).toEqual(['onReady', 'onClose']);
    // Do not start this registered worker: this test has no database connection.
    await hooks.get('onClose')?.();
  });
});
