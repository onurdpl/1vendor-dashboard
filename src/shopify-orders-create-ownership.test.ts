import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
}));

vi.mock('../backend/src/db/prisma.js', () => ({ prisma: prismaMock }));

const {
  ORDERS_CREATE_HEARTBEAT_CADENCE_MS,
  ORDERS_CREATE_PROCESSING_LEASE_MS,
  OrdersCreateLostFenceError,
  claimDueFailedOrdersCreateEvent,
  claimDueReceivedOrdersCreateEvent,
  claimExpiredProcessingOrdersCreateEvent,
  createOrdersCreateFencedExecutionContext,
  discoverOrdersCreateExecutionCandidates,
  fenceExpiredExhaustedOrdersCreateEvent,
  finalizeRetryableOrdersCreateFailure,
  finalizeTerminalOrdersCreateFailure,
  heartbeatOrdersCreateOwnership,
  verifyOrdersCreateOwnership,
} = await import('../backend/src/modules/shopify/orders-create-ownership.service.js');

function ownership(overrides: Record<string, unknown> = {}) {
  return {
    id: 'event-1',
    sourceShopifyOrderId: '2001',
    processingGeneration: 4,
    executionAttemptCount: 2,
    executionMaxAttempts: 3,
    processingLeaseExpiresAt: new Date('2026-08-26T12:01:00.000Z'),
    ...overrides,
  };
}

function context(generation = 4) {
  return createOrdersCreateFencedExecutionContext(
    ownership({ processingGeneration: generation }),
    new AbortController().signal,
  );
}

function sqlText(callIndex = 0) {
  const sql = prismaMock.$queryRaw.mock.calls[callIndex]?.[0] as { strings?: string[] } | undefined;
  return sql?.strings?.join('?') ?? '';
}

function event(overrides: Record<string, unknown> = {}) {
  return {
    id: 'event-1',
    sourceShopDomain: 'store.myshopify.com',
    topic: 'orders/create',
    webhookId: 'webhook-1',
    idempotencyKey: 'key-1',
    payloadHash: 'hash-1',
    rawPayload: JSON.stringify({ id: 2001 }),
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
  };
}

describe('orders/create fenced ownership primitives', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('claims a due RECEIVED event while incrementing generation and attempt count', async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([ownership()]);

    const result = await claimDueReceivedOrdersCreateEvent('event-1');

    expect(result).toMatchObject({
      acquired: true,
      ownership: {
        processingGeneration: 4,
        executionAttemptCount: 2,
      },
    });
    expect(sqlText()).toContain('"status" = \'RECEIVED\'');
    expect(sqlText()).toContain('"processingGeneration" = "processingGeneration" + 1');
    expect(sqlText()).toContain('"executionAttemptCount" = "executionAttemptCount" + 1');
    expect(sqlText()).toContain('"executionAttemptCount" < "executionMaxAttempts"');
  });

  it('allows exactly one concurrent claimant to own a due event', async () => {
    prismaMock.$queryRaw
      .mockResolvedValueOnce([ownership()])
      .mockResolvedValueOnce([]);

    const [first, second] = await Promise.all([
      claimDueReceivedOrdersCreateEvent('event-1'),
      claimDueReceivedOrdersCreateEvent('event-1'),
    ]);

    expect([first.acquired, second.acquired].filter(Boolean)).toHaveLength(1);
    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it('serializes a due FAILED claim with the same conditional mutation', async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([ownership({ processingGeneration: 2 })]);

    await expect(claimDueFailedOrdersCreateEvent('event-1')).resolves.toMatchObject({ acquired: true });
    expect(sqlText()).toContain('"status" = \'FAILED\'');
    expect(sqlText()).toContain('"executionAvailableAt" <= CURRENT_TIMESTAMP');
  });

  it.each([
    ['FAILED', claimDueFailedOrdersCreateEvent],
    ['expired PROCESSING', claimExpiredProcessingOrdersCreateEvent],
  ])('allows exactly one concurrent claimant for %s work', async (_label, claim) => {
    prismaMock.$queryRaw
      .mockResolvedValueOnce([ownership()])
      .mockResolvedValueOnce([]);

    const results = await Promise.all([claim('event-1'), claim('event-1')]);

    expect(results.filter((result) => result.acquired)).toHaveLength(1);
  });

  it('claims only expired PROCESSING ownership and increments its fence', async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([ownership({ processingGeneration: 5 })]);

    const result = await claimExpiredProcessingOrdersCreateEvent('event-1');

    expect(result).toMatchObject({ acquired: true, ownership: { processingGeneration: 5 } });
    expect(sqlText()).toContain('"status" = \'PROCESSING\'');
    expect(sqlText()).toContain('"processingLeaseExpiresAt" <= CURRENT_TIMESTAMP');
  });

  it('does not take over unexpired PROCESSING ownership', async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([]);

    await expect(claimExpiredProcessingOrdersCreateEvent('event-1')).resolves.toEqual({ acquired: false });
    expect(sqlText()).toContain('"processingLeaseExpiresAt" <= CURRENT_TIMESTAMP');
  });

  it('does not claim when the durable attempt budget is exhausted', async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([]);

    await expect(claimDueFailedOrdersCreateEvent('event-1')).resolves.toEqual({ acquired: false });
    expect(sqlText()).toContain('"executionAttemptCount" < "executionMaxAttempts"');
  });

  it('discovers only explicitly enrolled due work with bounded indexed ordering', async () => {
    prismaMock.$queryRaw
      .mockResolvedValueOnce([event({ id: 'received-later', receivedAt: new Date('2026-08-26T10:01:00.000Z') })])
      .mockResolvedValueOnce([event({ id: 'failed-first', status: 'FAILED', executionAvailableAt: new Date('2026-08-26T09:59:00.000Z') })])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const candidates = await discoverOrdersCreateExecutionCandidates(2);

    expect(candidates.map((candidate) => candidate.event.id)).toEqual(['failed-first', 'received-later']);
    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(4);
    expect(sqlText(0)).toContain('"status" = \'RECEIVED\'');
    expect(sqlText(0)).toContain('"executionAvailableAt" IS NOT NULL');
    expect(sqlText(0)).toContain('"executionAvailableAt" <= CURRENT_TIMESTAMP');
    expect(sqlText(0)).toContain('"executionAttemptCount" < "executionMaxAttempts"');
    expect(sqlText(0)).toContain('ORDER BY "executionAvailableAt" ASC, "receivedAt" ASC, "id" ASC');
    expect(sqlText(0)).toContain('LIMIT ?');
    expect(sqlText(1)).toContain('"status" = \'FAILED\'');
    expect(sqlText(2)).toContain('"processingLeaseExpiresAt" IS NOT NULL');
    expect(sqlText(2)).toContain('"processingLeaseExpiresAt" <= CURRENT_TIMESTAMP');
    expect(sqlText(3)).toContain('"executionAttemptCount" >= "executionMaxAttempts"');
  });

  it('globally bounds discovery after deterministic due-time ordering', async () => {
    prismaMock.$queryRaw
      .mockResolvedValueOnce([event({ id: 'second', executionAvailableAt: new Date('2026-08-26T10:00:02.000Z') })])
      .mockResolvedValueOnce([event({ id: 'first', status: 'FAILED', executionAvailableAt: new Date('2026-08-26T10:00:01.000Z') })])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const candidates = await discoverOrdersCreateExecutionCandidates(1);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.event.id).toBe('first');
  });

  it('fences an exhausted expired owner before terminalization without incrementing attempts', async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([ownership({
      processingGeneration: 5,
      executionAttemptCount: 3,
      processingLeaseExpiresAt: null,
    })]);

    await expect(fenceExpiredExhaustedOrdersCreateEvent('event-1')).resolves.toMatchObject({
      processingGeneration: 5,
      executionAttemptCount: 3,
    });
    expect(sqlText()).toContain('"processingGeneration" = "processingGeneration" + 1');
    expect(sqlText()).toContain('"executionAttemptCount" >= "executionMaxAttempts"');
    expect(sqlText()).not.toContain('"executionAttemptCount" = "executionAttemptCount" + 1');
    expect(sqlText()).toContain('"executionAvailableAt" = NULL');
    expect(sqlText()).toContain('"processingLeaseExpiresAt" = NULL');
  });

  it('heartbeats current ownership using the 60-second lease design', async () => {
    const lease = new Date('2026-08-26T12:02:00.000Z');
    prismaMock.$queryRaw.mockResolvedValueOnce([{ processingLeaseExpiresAt: lease }]);

    await expect(heartbeatOrdersCreateOwnership(context())).resolves.toEqual(lease);
    expect(ORDERS_CREATE_PROCESSING_LEASE_MS).toBe(60_000);
    expect(ORDERS_CREATE_HEARTBEAT_CADENCE_MS).toBe(10_000);
    expect(sqlText()).toContain('"processingLeaseExpiresAt" > clock_timestamp()');
  });

  it.each([
    ['stale generation'],
    ['expired lease'],
  ])('rejects a heartbeat for %s', async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([]);

    await expect(heartbeatOrdersCreateOwnership(context(3))).rejects.toBeInstanceOf(
      OrdersCreateLostFenceError,
    );
  });

  it('verifies ownership without mutating the event', async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([{ owned: true }]);

    await expect(verifyOrdersCreateOwnership(context())).resolves.toBe(true);
    expect(sqlText()).toContain('SELECT EXISTS');
  });

  it('prevents a stale generation from recording retryable failure', async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([]);

    await expect(
      finalizeRetryableOrdersCreateFailure(context(3), new Error('temporary failure')),
    ).rejects.toBeInstanceOf(OrdersCreateLostFenceError);
  });

  it('prevents a stale generation from recording terminal failure', async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([]);

    await expect(
      finalizeTerminalOrdersCreateFailure(context(3), new Error('validation failure')),
    ).rejects.toBeInstanceOf(OrdersCreateLostFenceError);
  });

  it('lets the current generation finalize retryable failure with bounded availability', async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([{ id: 'event-1' }]);

    await expect(
      finalizeRetryableOrdersCreateFailure(context(), new Error('temporary failure')),
    ).resolves.toBeUndefined();
    expect(sqlText()).toContain('"executionAttemptCount" < "executionMaxAttempts"');
    expect(sqlText()).toContain('POWER(2');
    expect(sqlText()).toContain('"processingLeaseExpiresAt" = NULL');
  });

  it('lets the current generation finalize terminal failure without retry availability', async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([{ id: 'event-1' }]);

    await expect(
      finalizeTerminalOrdersCreateFailure(context(), new Error('terminal failure')),
    ).resolves.toBeUndefined();
    expect(sqlText()).toContain('"executionAvailableAt" = NULL');
    expect(sqlText()).toContain('"processingGeneration" =');
  });
});
