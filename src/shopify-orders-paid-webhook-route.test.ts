import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  webhookEvent: {
    update: vi.fn(),
  },
}));

const webhookIdempotencyMock = vi.hoisted(() => ({
  getOrCreateWebhookEvent: vi.fn(),
}));

const orderIngestionMock = vi.hoisted(() => ({
  ingestShopifyOrderWebhook: vi.fn(),
  syncShopifyOrderPaidSnapshotFromWebhook: vi.fn(),
  updateShopifyOrderContactAddressSnapshotFromWebhook: vi.fn(),
}));

const webhookServiceMock = vi.hoisted(() => ({
  verifyShopifyWebhookHmac: vi.fn(),
}));

const operationalJobsMock = vi.hoisted(() => ({
  createWebhookOperationalJob: vi.fn(),
  markOperationalJobCompleted: vi.fn(),
  markOperationalJobFailed: vi.fn(),
  markOperationalJobProcessing: vi.fn(),
}));

vi.mock('../backend/src/db/prisma.js', () => ({
  prisma: prismaMock,
}));

vi.mock('../backend/src/modules/shopify/webhook-idempotency.service.js', () => webhookIdempotencyMock);

vi.mock('../backend/src/modules/shopify/order-ingestion.service.js', () => orderIngestionMock);

vi.mock('../backend/src/modules/shopify/shopify-admin.service.js', () => ({
  createShopifyAdminService: vi.fn(() => ({
    fetchOrderSellerInfo: vi.fn(),
    fetchOrderLineItemImages: vi.fn(),
    fetchOrderTaxSnapshot: vi.fn(),
  })),
}));

vi.mock('../backend/src/modules/shopify/webhook.service.js', () => webhookServiceMock);

vi.mock('../backend/src/modules/operational-jobs/operational-jobs.service.js', () => operationalJobsMock);

const { registerShopifyWebhookRoutes } = await import('../backend/src/modules/shopify/webhook.routes.js');

function buildReply() {
  const reply = {
    statusCode: 200,
    code: vi.fn((status: number) => {
      reply.statusCode = status;
      return reply;
    }),
    send: vi.fn((body: unknown) => ({
      status: reply.statusCode,
      body,
    })),
  };

  return reply;
}

function registerRoutes() {
  const routes = new Map<string, (request: unknown, reply: ReturnType<typeof buildReply>) => Promise<unknown>>();
  const app = {
    post: vi.fn((path: string, handler: (request: unknown, reply: ReturnType<typeof buildReply>) => Promise<unknown>) => {
      routes.set(path, handler);
    }),
    log: {
      warn: vi.fn(),
      error: vi.fn(),
    },
  };

  registerShopifyWebhookRoutes(app as never, {
    DATABASE_URL: 'postgres://example',
    SHOPIFY_WEBHOOK_SECRET: 'webhook-secret',
  } as never);

  return {
    routes,
    app,
  };
}

describe('Shopify orders/paid webhook route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    webhookServiceMock.verifyShopifyWebhookHmac.mockReturnValue(true);
    webhookIdempotencyMock.getOrCreateWebhookEvent.mockResolvedValue({
      isDuplicate: false,
      event: {
        id: 'webhook-event-orders-paid',
        payloadHash: 'payload-hash',
      },
    });
    orderIngestionMock.syncShopifyOrderPaidSnapshotFromWebhook.mockResolvedValue({
      matched: true,
      updated: true,
      orderId: 'shopify-order-db-2005',
      sourceShopifyOrderId: '2005',
      changedFields: ['financialStatus'],
    });
    operationalJobsMock.createWebhookOperationalJob.mockResolvedValue({
      id: 'operational-job-orders-paid',
    });
    prismaMock.webhookEvent.update.mockResolvedValue({});
  });

  it('registers the orders-paid route and syncs only the paid snapshot service', async () => {
    const { routes } = registerRoutes();
    const handler = routes.get('/webhooks/shopify/orders-paid');
    const payload = {
      id: 2005,
      name: '#2005',
      financial_status: 'paid',
    };
    const rawBodyBuffer = Buffer.from(JSON.stringify(payload), 'utf8');

    const result = await handler?.({
      rawBodyBuffer,
      rawBody: rawBodyBuffer.toString('utf8'),
      body: payload,
      headers: {
        'x-shopify-hmac-sha256': 'valid-hmac',
        'x-shopify-topic': 'orders/paid',
        'x-shopify-shop-domain': 'sporgym.myshopify.com',
        'x-shopify-webhook-id': 'orders-paid-webhook-id',
        'content-type': 'application/json',
      },
    }, buildReply());

    expect(webhookServiceMock.verifyShopifyWebhookHmac).toHaveBeenCalledWith(
      rawBodyBuffer,
      'valid-hmac',
      'webhook-secret',
    );
    expect(webhookIdempotencyMock.getOrCreateWebhookEvent).toHaveBeenCalledWith({
      topic: 'orders/paid',
      shopDomain: 'sporgym.myshopify.com',
      webhookId: 'orders-paid-webhook-id',
      rawBody: rawBodyBuffer.toString('utf8'),
    });
    expect(operationalJobsMock.createWebhookOperationalJob).toHaveBeenCalledWith({
      topic: 'orders/paid',
      webhookEventId: 'webhook-event-orders-paid',
      payloadRef: 'payload-hash',
      sourceShopifyOrderId: '2005',
    });
    expect(orderIngestionMock.syncShopifyOrderPaidSnapshotFromWebhook).toHaveBeenCalledWith(payload);
    expect(orderIngestionMock.ingestShopifyOrderWebhook).not.toHaveBeenCalled();
    expect(orderIngestionMock.updateShopifyOrderContactAddressSnapshotFromWebhook).not.toHaveBeenCalled();
    expect(prismaMock.webhookEvent.update).toHaveBeenCalledWith({
      where: {
        id: 'webhook-event-orders-paid',
      },
      data: {
        shopifyOrderId: 'shopify-order-db-2005',
        status: 'PROCESSED',
        processedAt: expect.any(Date),
        errorMessage: null,
      },
    });
    expect(operationalJobsMock.markOperationalJobCompleted).toHaveBeenCalledWith('operational-job-orders-paid');
    expect(result).toEqual({
      status: 202,
      body: {
        ok: true,
        duplicate: false,
        action: 'paid_snapshot_synced',
        processingStatus: 'processed',
        shopifyOrderId: '2005',
        orderMatched: true,
        snapshotUpdated: true,
        changedFields: ['financialStatus'],
      },
    });
  });

  it('keeps repeated orders-paid webhook deliveries idempotent', async () => {
    webhookIdempotencyMock.getOrCreateWebhookEvent.mockResolvedValueOnce({
      isDuplicate: true,
      event: {
        id: 'webhook-event-duplicate',
        payloadHash: 'payload-hash',
      },
    });
    const { routes } = registerRoutes();
    const handler = routes.get('/webhooks/shopify/orders-paid');
    const payload = {
      id: 2005,
      name: '#2005',
      financial_status: 'paid',
    };
    const rawBodyBuffer = Buffer.from(JSON.stringify(payload), 'utf8');

    const result = await handler?.({
      rawBodyBuffer,
      rawBody: rawBodyBuffer.toString('utf8'),
      body: payload,
      headers: {
        'x-shopify-hmac-sha256': 'valid-hmac',
        'x-shopify-topic': 'orders/paid',
        'x-shopify-shop-domain': 'sporgym.myshopify.com',
        'x-shopify-webhook-id': 'orders-paid-webhook-id',
      },
    }, buildReply());

    expect(orderIngestionMock.syncShopifyOrderPaidSnapshotFromWebhook).not.toHaveBeenCalled();
    expect(prismaMock.webhookEvent.update).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: 202,
      body: {
        ok: true,
        duplicate: true,
        action: 'duplicate_ignored',
      },
    });
  });
});
