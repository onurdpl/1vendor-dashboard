import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  operationalJob: {
    upsert: vi.fn(),
  },
}));

vi.mock('../backend/src/db/prisma.js', () => ({ prisma: prismaMock }));

const {
  buildOrdersCreateExecutorJobId,
  mirrorOrdersCreateExecutorJob,
} = await import('../backend/src/modules/operational-jobs/operational-jobs.service.js');

describe('orders/create executor OperationalJob mirror', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.operationalJob.upsert.mockResolvedValue({ id: 'job' });
  });

  it('uses one deterministic metadata job identity per WebhookEvent', async () => {
    expect(buildOrdersCreateExecutorJobId('event-1')).toBe('shopify-orders-create-executor-event-1');

    await mirrorOrdersCreateExecutorJob({
      webhookEventId: 'event-1',
      sourceShopifyOrderId: '2001',
      state: 'processing',
      attemptCount: 1,
      maxAttempts: 3,
    });

    expect(prismaMock.operationalJob.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'shopify-orders-create-executor-event-1' },
      create: expect.objectContaining({
        id: 'shopify-orders-create-executor-event-1',
        webhookEventId: 'event-1',
        sourceShopifyOrderId: '2001',
        status: 'PROCESSING',
        retryCount: 1,
        maxRetries: 3,
      }),
    }));
  });

  it('mirrors durable retry availability without becoming retry authority', async () => {
    const nextRetryAt = new Date('2026-08-26T12:02:00.000Z');

    await mirrorOrdersCreateExecutorJob({
      webhookEventId: 'event-1',
      sourceShopifyOrderId: '2001',
      state: 'retry_scheduled',
      attemptCount: 1,
      maxAttempts: 3,
      nextRetryAt,
      error: 'temporary failure',
    });

    expect(prismaMock.operationalJob.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({
        status: 'RETRY_SCHEDULED',
        nextRetryAt,
        retryCount: 1,
      }),
    }));
  });

  it.each([
    ['completed', 'COMPLETED'],
    ['failed', 'FAILED'],
    ['permanently_failed', 'PERMANENTLY_FAILED'],
    ['dead_letter_ready', 'DEAD_LETTER_READY'],
  ] as const)('mirrors %s as %s', async (state, expectedStatus) => {
    await mirrorOrdersCreateExecutorJob({
      webhookEventId: 'event-1',
      sourceShopifyOrderId: '2001',
      state,
      attemptCount: 3,
      maxAttempts: 3,
      error: 'safe failure',
    });

    expect(prismaMock.operationalJob.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ status: expectedStatus }),
    }));
  });
});
