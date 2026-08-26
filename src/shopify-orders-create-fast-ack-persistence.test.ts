import { beforeEach, describe, expect, it, vi } from 'vitest';

const transactionClient = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  webhookEvent: { create: vi.fn() },
}));
const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn((operation: (client: typeof transactionClient) => unknown) => operation(transactionClient)),
  webhookEvent: {
    create: vi.fn(),
    findFirst: vi.fn(),
    updateMany: vi.fn(),
    findUnique: vi.fn(),
  },
}));

vi.mock('../backend/src/db/prisma.js', () => ({ prisma: prismaMock }));

const { getOrCreateWebhookEvent } = await import(
  '../backend/src/modules/shopify/webhook-idempotency.service.js'
);

function event(overrides: Record<string, unknown> = {}) {
  return {
    id: 'event-1',
    sourceShopDomain: 'store.myshopify.com',
    topic: 'orders/create',
    webhookId: 'delivery-1',
    idempotencyKey: 'store.myshopify.com:orders/create:webhook:delivery-1',
    payloadHash: 'hash',
    rawPayload: '{"id":2001}',
    status: 'RECEIVED',
    receivedAt: new Date('2026-08-27T10:00:00.000Z'),
    processedAt: null,
    errorMessage: null,
    shopifyOrderId: null,
    sourceShopifyOrderId: null,
    executionAvailableAt: null,
    executionAttemptCount: 0,
    executionMaxAttempts: 3,
    processingGeneration: 0,
    processingLeaseExpiresAt: null,
    ...overrides,
  };
}

describe('orders/create durable intake persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation(
      (operation: (client: typeof transactionClient) => unknown) => operation(transactionClient),
    );
  });

  it('atomically creates and immediately enrolls a new event using database current time', async () => {
    const created = event({ sourceShopifyOrderId: '2001' });
    const enrolled = event({
      sourceShopifyOrderId: '2001',
      executionAvailableAt: new Date('2026-08-27T10:00:01.000Z'),
    });
    transactionClient.webhookEvent.create.mockResolvedValue(created);
    transactionClient.$queryRaw.mockResolvedValue([enrolled]);

    const result = await getOrCreateWebhookEvent({
      topic: 'orders/create',
      shopDomain: 'store.myshopify.com',
      webhookId: 'delivery-1',
      rawBody: '{"id":2001}',
      executionEnrollment: { sourceShopifyOrderId: '2001' },
    });

    expect(prismaMock.$transaction).toHaveBeenCalledOnce();
    expect(transactionClient.webhookEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sourceShopDomain: 'store.myshopify.com',
        topic: 'orders/create',
        webhookId: 'delivery-1',
        idempotencyKey: 'store.myshopify.com:orders/create:webhook:delivery-1',
        payloadHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        rawPayload: '{"id":2001}',
        status: 'RECEIVED',
        sourceShopifyOrderId: '2001',
      }),
    });
    const enrollmentSql = transactionClient.$queryRaw.mock.calls[0][0] as { strings?: string[] };
    expect(enrollmentSql.strings?.join('?')).toContain('"executionAvailableAt" = CURRENT_TIMESTAMP');
    expect(result).toMatchObject({
      isDuplicate: false,
      event: {
        status: 'RECEIVED',
        sourceShopifyOrderId: '2001',
        executionAvailableAt: enrolled.executionAvailableAt,
        executionAttemptCount: 0,
        executionMaxAttempts: 3,
        processingGeneration: 0,
        processingLeaseExpiresAt: null,
      },
    });
  });

  it('keeps the default persistence path free of executor enrollment fields', async () => {
    prismaMock.webhookEvent.create.mockResolvedValue(event());

    await getOrCreateWebhookEvent({
      topic: 'orders/create',
      shopDomain: 'store.myshopify.com',
      webhookId: 'delivery-1',
      rawBody: '{"id":2001}',
    });

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.webhookEvent.create).toHaveBeenCalledWith({
      data: expect.not.objectContaining({ sourceShopifyOrderId: expect.anything() }),
    });
  });

  it('rejects the atomic operation when executor enrollment cannot be persisted', async () => {
    transactionClient.webhookEvent.create.mockResolvedValue(event({ sourceShopifyOrderId: '2001' }));
    transactionClient.$queryRaw.mockResolvedValue([]);

    await expect(getOrCreateWebhookEvent({
      topic: 'orders/create',
      shopDomain: 'store.myshopify.com',
      webhookId: 'delivery-1',
      rawBody: '{"id":2001}',
      executionEnrollment: { sourceShopifyOrderId: '2001' },
    })).rejects.toThrow('could not be enrolled atomically');
  });
});
