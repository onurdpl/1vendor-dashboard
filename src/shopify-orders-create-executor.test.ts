import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createOrdersCreateExecutor,
  getOrdersCreateExecutorRequestTimeoutMs,
  registerOrdersCreateExecutor,
} from '../backend/src/modules/shopify/orders-create-executor.service.js';
import { OrdersCreateLostFenceError } from '../backend/src/modules/shopify/orders-create-ownership.service.js';

function event(overrides: Record<string, unknown> = {}) {
  return {
    id: 'event-1',
    sourceShopDomain: 'store.myshopify.com',
    topic: 'orders/create',
    webhookId: 'webhook-1',
    idempotencyKey: 'key-1',
    payloadHash: 'hash-1',
    rawPayload: JSON.stringify({ id: 2001, line_items: [{ id: 3001, sku: 'SKU-1' }] }),
    status: 'RECEIVED',
    receivedAt: new Date('2026-08-26T10:00:00.000Z'),
    processedAt: null,
    errorMessage: null,
    shopifyOrderId: null,
    sourceShopifyOrderId: '2001',
    executionAvailableAt: new Date('2026-08-26T10:00:01.000Z'),
    executionAttemptCount: 0,
    executionMaxAttempts: 3,
    processingGeneration: 0,
    processingLeaseExpiresAt: null,
    ...overrides,
  } as never;
}

function candidate(kind: 'RECEIVED' | 'FAILED' | 'EXPIRED_PROCESSING' | 'EXHAUSTED_PROCESSING' = 'RECEIVED') {
  const candidateEvent = event({
    status: kind === 'RECEIVED' ? 'RECEIVED' : kind === 'FAILED' ? 'FAILED' : 'PROCESSING',
    processingLeaseExpiresAt: kind.includes('PROCESSING')
      ? new Date('2026-08-26T10:00:01.000Z')
      : null,
  });
  return {
    kind,
    event: candidateEvent,
    dueAt: candidateEvent.executionAvailableAt ?? candidateEvent.processingLeaseExpiresAt!,
  } as never;
}

function ownership(overrides: Record<string, unknown> = {}) {
  return {
    id: 'event-1',
    sourceShopifyOrderId: '2001',
    processingGeneration: 1,
    executionAttemptCount: 1,
    executionMaxAttempts: 3,
    processingLeaseExpiresAt: new Date('2026-08-26T10:01:00.000Z'),
    ...overrides,
  };
}

function createHarness(overrides: Record<string, unknown> = {}) {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const processingService = {
    process: vi.fn().mockResolvedValue({
      ok: true,
      action: 'accepted',
      processingStatus: 'processed',
      shopifyOrderId: 'order-local-1',
      allocationCount: 1,
    }),
  };
  const dependencies = {
    discoverCandidates: vi.fn().mockResolvedValue([candidate()]),
    claimReceived: vi.fn().mockResolvedValue({ acquired: true, ownership: ownership() }),
    claimFailed: vi.fn().mockResolvedValue({ acquired: true, ownership: ownership({ executionAttemptCount: 2 }) }),
    claimExpired: vi.fn().mockResolvedValue({ acquired: true, ownership: ownership({ processingGeneration: 2 }) }),
    fenceExhausted: vi.fn(),
    heartbeat: vi.fn().mockResolvedValue(new Date()),
    finalizeRetryable: vi.fn().mockResolvedValue({
      id: 'event-1',
      executionAvailableAt: new Date('2026-08-26T10:02:00.000Z'),
      executionAttemptCount: 1,
      executionMaxAttempts: 3,
    }),
    finalizeTerminal: vi.fn().mockResolvedValue(undefined),
    mirrorJob: vi.fn().mockResolvedValue(undefined),
    processingService,
    ...overrides,
  };
  const executor = createOrdersCreateExecutor({
    env: {
      SHOPIFY_SELLER_INFO_RETRY_DELAY_MS: 2_000,
      SHOPIFY_ORDERS_CREATE_EXECUTOR_INTERVAL_MS: 2_000,
      SHOPIFY_ORDERS_CREATE_EXECUTOR_BATCH_SIZE: 5,
      SHOPIFY_ORDERS_CREATE_LEASE_MS: 60_000,
      SHOPIFY_ORDERS_CREATE_HEARTBEAT_MS: 10_000,
    } as never,
    logger: logger as never,
    dependencies: dependencies as never,
  });
  return { executor, dependencies, processingService, logger };
}

describe('orders/create executor runtime', () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('does not register polling or claims when disabled or when DATABASE_URL is absent', () => {
    const app = { addHook: vi.fn(), log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } };

    expect(registerOrdersCreateExecutor(app as never, {
      SHOPIFY_ORDERS_CREATE_EXECUTOR_ENABLED: false,
      DATABASE_URL: 'postgres://db',
    } as never)).toBeNull();
    expect(registerOrdersCreateExecutor(app as never, {
      SHOPIFY_ORDERS_CREATE_EXECUTOR_ENABLED: true,
      DATABASE_URL: undefined,
    } as never)).toBeNull();
    expect(app.addHook).not.toHaveBeenCalled();
  });

  it('registers startup and close lifecycle hooks only when explicitly enabled with a database', () => {
    const hooks = new Map<string, () => Promise<void>>();
    const app = {
      addHook: vi.fn((name: string, hook: () => Promise<void>) => hooks.set(name, hook)),
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    };

    const executor = registerOrdersCreateExecutor(app as never, {
      SHOPIFY_ORDERS_CREATE_EXECUTOR_ENABLED: true,
      DATABASE_URL: 'postgres://db',
      SHOPIFY_SELLER_INFO_RETRY_DELAY_MS: 2_000,
      SHOPIFY_ORDERS_CREATE_EXECUTOR_INTERVAL_MS: 2_000,
      SHOPIFY_ORDERS_CREATE_EXECUTOR_BATCH_SIZE: 5,
      SHOPIFY_ORDERS_CREATE_LEASE_MS: 60_000,
      SHOPIFY_ORDERS_CREATE_HEARTBEAT_MS: 10_000,
    } as never);

    expect(executor).not.toBeNull();
    expect([...hooks.keys()]).toEqual(['onReady', 'onClose']);
  });

  it('runs an immediate cycle, polls periodically, and stops polling on close', async () => {
    vi.useFakeTimers();
    const { executor, dependencies } = createHarness({
      discoverCandidates: vi.fn().mockResolvedValue([]),
    });

    executor.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(dependencies.discoverCandidates).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(dependencies.discoverCandidates).toHaveBeenCalledTimes(2);
    await executor.close();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(dependencies.discoverCandidates).toHaveBeenCalledTimes(2);
  });

  it('derives executor Shopify Admin request deadlines from half the lease', () => {
    expect(getOrdersCreateExecutorRequestTimeoutMs(60_000)).toBe(30_000);
    expect(getOrdersCreateExecutorRequestTimeoutMs(1)).toBe(1);
  });

  it('claims and processes retained payload in missing-order-only fenced mode', async () => {
    const { executor, dependencies, processingService } = createHarness();

    await expect(executor.runCycle()).resolves.toMatchObject({
      candidateCount: 1,
      claimWins: 1,
      processed: 1,
    });
    expect(dependencies.claimReceived).toHaveBeenCalledWith('event-1', 60_000);
    expect(processingService.process).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'missing_order_only',
      payload: expect.objectContaining({ id: 2001 }),
      executionContext: expect.objectContaining({
        webhookEventId: 'event-1',
        processingGeneration: 1,
        shopifyAdminRequestTimeoutMs: 30_000,
      }),
    }));
    expect(dependencies.mirrorJob).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'completed' }));
  });

  it('keeps WebhookEvent and commerce success valid when job metadata mirroring fails', async () => {
    const { executor, dependencies } = createHarness({
      mirrorJob: vi.fn().mockRejectedValue(new Error('job metadata unavailable')),
    });

    await expect(executor.runCycle()).resolves.toMatchObject({ processed: 1, errors: 0 });
    expect(dependencies.mirrorJob).toHaveBeenCalled();
  });

  it('never processes or finalizes after losing an atomic claim', async () => {
    const { executor, dependencies, processingService } = createHarness({
      claimReceived: vi.fn().mockResolvedValue({ acquired: false }),
    });

    await expect(executor.runCycle()).resolves.toMatchObject({ claimWins: 0, claimLosses: 1 });
    expect(processingService.process).not.toHaveBeenCalled();
    expect(dependencies.finalizeRetryable).not.toHaveBeenCalled();
    expect(dependencies.finalizeTerminal).not.toHaveBeenCalled();
  });

  it('persists and mirrors retry availability from WebhookEvent finalization', async () => {
    const { executor, dependencies, processingService } = createHarness();
    processingService.process.mockResolvedValueOnce({
      ok: false,
      action: 'received_needs_attention',
      processingStatus: 'needs_attention',
      failureCode: 'seller_info_unavailable',
      failureDisposition: 'RETRYABLE',
      failureCategory: 'transient',
      retryable: true,
      error: 'seller_info unavailable',
    });

    await expect(executor.runCycle()).resolves.toMatchObject({ retryScheduled: 1 });
    expect(dependencies.finalizeRetryable).toHaveBeenCalledTimes(1);
    expect(dependencies.mirrorJob).toHaveBeenLastCalledWith(expect.objectContaining({
      state: 'retry_scheduled',
      nextRetryAt: new Date('2026-08-26T10:02:00.000Z'),
    }));
  });

  it('does not convert a retry-finalization database failure into terminal state', async () => {
    const { executor, dependencies, processingService } = createHarness({
      finalizeRetryable: vi.fn().mockRejectedValue(new Error('database unavailable')),
    });
    processingService.process.mockResolvedValueOnce({
      ok: false,
      action: 'received_needs_attention',
      processingStatus: 'needs_attention',
      failureCode: 'seller_info_unavailable',
      failureDisposition: 'RETRYABLE',
      failureCategory: 'transient',
      retryable: true,
      error: 'seller_info unavailable',
    });

    await expect(executor.runCycle()).resolves.toMatchObject({ errors: 1, retryScheduled: 0 });
    expect(dependencies.finalizeTerminal).not.toHaveBeenCalled();
  });

  it('automatically consumes due FAILED retry candidates through the retry claim', async () => {
    const dueRetry = candidate('FAILED');
    const { executor, dependencies } = createHarness({
      discoverCandidates: vi.fn().mockResolvedValue([dueRetry]),
    });

    await expect(executor.runCycle()).resolves.toMatchObject({ processed: 1, claimWins: 1 });
    expect(dependencies.claimFailed).toHaveBeenCalledWith('event-1', 60_000);
    expect(dependencies.claimReceived).not.toHaveBeenCalled();
    expect(dependencies.mirrorJob).toHaveBeenCalledWith(expect.objectContaining({ state: 'retrying' }));
  });

  it('claims expired PROCESSING work with a new generation', async () => {
    const stale = candidate('EXPIRED_PROCESSING');
    const { executor, dependencies, processingService } = createHarness({
      discoverCandidates: vi.fn().mockResolvedValue([stale]),
    });

    await executor.runCycle();

    expect(dependencies.claimExpired).toHaveBeenCalledWith('event-1', 60_000);
    expect(processingService.process).toHaveBeenCalledWith(expect.objectContaining({
      executionContext: expect.objectContaining({ processingGeneration: 2 }),
    }));
  });

  it('fails unknown outcomes closed without scheduling retry', async () => {
    const { executor, dependencies, processingService } = createHarness();
    processingService.process.mockResolvedValueOnce({
      ok: false,
      action: 'received_needs_attention',
      processingStatus: 'needs_attention',
      failureCode: 'unknown_internal_error',
      failureDisposition: 'UNKNOWN',
      failureCategory: 'reconciliation_required',
      retryable: false,
      error: 'unknown failure',
    });

    await expect(executor.runCycle()).resolves.toMatchObject({ errors: 1, retryScheduled: 0 });
    expect(dependencies.finalizeTerminal).toHaveBeenCalledTimes(1);
    expect(dependencies.finalizeRetryable).not.toHaveBeenCalled();
    expect(dependencies.mirrorJob).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'failed' }));
  });

  it('heartbeats a claimed attempt and stops the heartbeat after success', async () => {
    vi.useFakeTimers();
    let resolveProcessing!: (value: unknown) => void;
    const processing = new Promise((resolve) => { resolveProcessing = resolve; });
    const processingService = { process: vi.fn(() => processing) };
    const { executor, dependencies } = createHarness({ processingService });
    const cycle = executor.runCycle();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(dependencies.heartbeat).toHaveBeenCalledTimes(1);
    resolveProcessing({
      ok: true,
      action: 'accepted',
      processingStatus: 'processed',
      shopifyOrderId: 'order-local-1',
      allocationCount: 1,
    });
    await cycle;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(dependencies.heartbeat).toHaveBeenCalledTimes(1);
  });

  it('aborts stale ownership after a heartbeat fence failure without finalization', async () => {
    vi.useFakeTimers();
    let executionSignal: AbortSignal | undefined;
    const processingService = {
      process: vi.fn((input: { executionContext: { signal: AbortSignal } }) => {
        executionSignal = input.executionContext.signal;
        return new Promise((_resolve, reject) => {
          executionSignal!.addEventListener('abort', () => reject(executionSignal!.reason), { once: true });
        });
      }),
    };
    const { executor, dependencies } = createHarness({
      processingService,
      heartbeat: vi.fn().mockRejectedValue(new OrdersCreateLostFenceError()),
    });
    const cycle = executor.runCycle();
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(cycle).resolves.toMatchObject({ processed: 0, retryScheduled: 0 });
    expect(executionSignal?.aborted).toBe(true);
    expect(dependencies.finalizeRetryable).not.toHaveBeenCalled();
    expect(dependencies.finalizeTerminal).not.toHaveBeenCalled();
  });

  it('fences exhausted stale PROCESSING ownership without commerce execution', async () => {
    const exhaustedCandidate = candidate('EXHAUSTED_PROCESSING');
    const { executor, dependencies, processingService } = createHarness({
      discoverCandidates: vi.fn().mockResolvedValue([exhaustedCandidate]),
      fenceExhausted: vi.fn().mockResolvedValue(ownership({
        processingGeneration: 4,
        executionAttemptCount: 3,
        processingLeaseExpiresAt: null,
      })),
    });

    await expect(executor.runCycle()).resolves.toMatchObject({ deadLetter: 1, claimWins: 1 });
    expect(processingService.process).not.toHaveBeenCalled();
    expect(dependencies.mirrorJob).toHaveBeenCalledWith(expect.objectContaining({
      state: 'dead_letter_ready',
      attemptCount: 3,
    }));
  });

  it('uses a bounded drain, aborts remaining work, and leaves the lease untouched', async () => {
    vi.useFakeTimers();
    let executionSignal: AbortSignal | undefined;
    const processingService = {
      process: vi.fn((input: { executionContext: { signal: AbortSignal } }) => {
        executionSignal = input.executionContext.signal;
        return new Promise((_resolve, reject) => {
          executionSignal!.addEventListener('abort', () => reject(executionSignal!.reason), { once: true });
        });
      }),
    };
    const { executor, dependencies } = createHarness({ processingService });
    const cycle = executor.runCycle();
    await vi.advanceTimersByTimeAsync(0);
    const close = executor.close();
    await vi.advanceTimersByTimeAsync(60_000);
    await close;
    await cycle;

    expect(executionSignal?.aborted).toBe(true);
    expect(executor.isStopping()).toBe(true);
    expect(dependencies.heartbeat).toHaveBeenCalled();
    expect(dependencies.finalizeRetryable).not.toHaveBeenCalled();
    expect(dependencies.finalizeTerminal).not.toHaveBeenCalled();
    expect(dependencies.fenceExhausted).not.toHaveBeenCalled();
    const heartbeatCount = dependencies.heartbeat.mock.calls.length;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(dependencies.heartbeat).toHaveBeenCalledTimes(heartbeatCount);
  });

  it('runs only one attempt at a time per instance and prevents overlapping cycles', async () => {
    let active = 0;
    let maxActive = 0;
    const processingService = {
      process: vi.fn(async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await Promise.resolve();
        active -= 1;
        return {
          ok: true as const,
          action: 'accepted' as const,
          processingStatus: 'processed' as const,
          shopifyOrderId: 'order-local-1',
          allocationCount: 1,
        };
      }),
    };
    const secondCandidate = {
      ...candidate(),
      event: event({ id: 'event-2', sourceShopifyOrderId: '2002', rawPayload: JSON.stringify({ id: 2002 }) }),
    };
    const { executor, dependencies } = createHarness({
      discoverCandidates: vi.fn().mockResolvedValue([candidate(), secondCandidate]),
      claimReceived: vi.fn()
        .mockResolvedValueOnce({ acquired: true, ownership: ownership() })
        .mockResolvedValueOnce({ acquired: true, ownership: ownership({ id: 'event-2', sourceShopifyOrderId: '2002' }) }),
      processingService,
    });

    const firstCycle = executor.runCycle();
    const overlappingCycle = executor.runCycle();
    await expect(overlappingCycle).resolves.toMatchObject({ candidateCount: 0 });
    await firstCycle;

    expect(maxActive).toBe(1);
    expect(processingService.process).toHaveBeenCalledTimes(2);
    expect(dependencies.discoverCandidates).toHaveBeenCalledTimes(1);
  });
});
