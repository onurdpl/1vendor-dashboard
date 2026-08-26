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
