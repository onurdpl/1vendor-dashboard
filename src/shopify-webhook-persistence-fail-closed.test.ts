import { beforeEach, describe, expect, it, vi } from 'vitest';

const getOrCreateWebhookEventMock = vi.hoisted(() => vi.fn());
const downstreamMocks = vi.hoisted(() => ({
  processOrdersCreate: vi.fn(),
  syncPaidSnapshot: vi.fn(),
  updateContactAddress: vi.fn(),
  ingestRefund: vi.fn(),
  ingestReturnRequest: vi.fn(),
  applyReturnLifecycle: vi.fn(),
  recordReturnSignal: vi.fn(),
  ingestFulfillment: vi.fn(),
  reconcileCancellation: vi.fn(),
  createJob: vi.fn(),
}));

vi.mock('../backend/src/db/prisma.js', () => ({
  prisma: {
    webhookEvent: { update: vi.fn() },
  },
}));

vi.mock('../backend/src/modules/shopify/webhook-idempotency.service.js', () => ({
  claimWebhookEvent: vi.fn(),
  getOrCreateWebhookEvent: getOrCreateWebhookEventMock,
}));

vi.mock('../backend/src/modules/shopify/order-ingestion.service.js', () => ({
  syncShopifyOrderPaidSnapshotFromWebhook: downstreamMocks.syncPaidSnapshot,
  updateShopifyOrderContactAddressSnapshotFromWebhook: downstreamMocks.updateContactAddress,
}));

vi.mock('../backend/src/modules/shopify/refund-ingestion.service.js', () => ({
  ingestVerifiedShopifyRefund: downstreamMocks.ingestRefund,
}));

vi.mock('../backend/src/modules/shopify/shopify-admin.service.js', () => ({
  createShopifyAdminService: vi.fn(() => ({})),
}));

vi.mock('../backend/src/modules/shopify/orders-create-processing.service.js', () => ({
  createOrdersCreateProcessingService: vi.fn(() => ({ process: downstreamMocks.processOrdersCreate })),
  prepareOrdersCreatePayload: vi.fn(),
}));

vi.mock('../backend/src/modules/shopify/webhook.service.js', () => ({
  verifyShopifyWebhookHmac: vi.fn(() => true),
  verifyShopifyWebhookShopDomain: vi.fn(() => ({ ok: true })),
}));

vi.mock('../backend/src/modules/shopify/return-lifecycle-ingestion.service.js', () => ({
  ingestReturnRequestWebhook: downstreamMocks.ingestReturnRequest,
  applyReturnLifecycleStatusWebhook: downstreamMocks.applyReturnLifecycle,
}));

vi.mock('../backend/src/modules/shopify/return-signal-discovery.service.js', () => ({
  recordShopifyReturnSignalDiscovery: downstreamMocks.recordReturnSignal,
}));

vi.mock('../backend/src/modules/shopify/fulfillment-ingestion.service.js', () => ({
  ingestFulfillmentWebhook: downstreamMocks.ingestFulfillment,
}));

vi.mock('../backend/src/modules/operational-jobs/operational-jobs.service.js', () => ({
  createWebhookOperationalJob: downstreamMocks.createJob,
  markOperationalJobCompleted: vi.fn(),
  markOperationalJobFailed: vi.fn(),
  markOperationalJobProcessing: vi.fn(),
  markOperationalJobRetrying: vi.fn(),
}));

vi.mock('../backend/src/modules/reconciliation/canonical-cancellation-reconciliation.service.js', () => ({
  createCanonicalCancellationReconciliationService: vi.fn(() => ({
    reconcileOrderCancellation: downstreamMocks.reconcileCancellation,
  })),
}));

const { registerShopifyWebhookRoutes } = await import('../backend/src/modules/shopify/webhook.routes.js');

type TestReply = ReturnType<typeof buildReply>;
type TestHandler = (request: ReturnType<typeof buildRequest>, reply: TestReply) => Promise<unknown>;

const persistenceRequiredRoutes = [
  ['/webhooks/shopify/orders-create', 'orders/create'],
  ['/webhooks/shopify/orders-paid', 'orders/paid'],
  ['/webhooks/shopify/orders-cancelled', 'orders/cancelled'],
  ['/webhooks/shopify/refunds-create', 'refunds/create'],
  ['/webhooks/shopify/returns-request', 'returns/request'],
  ['/webhooks/shopify/returns-create', 'returns/create'],
  ['/webhooks/shopify/returns-update', 'returns/update'],
  ['/webhooks/shopify/orders-updated', 'orders/updated'],
  ['/webhooks/shopify/fulfillment-orders-updated', 'fulfillment_orders/updated'],
  ['/webhooks/shopify/returns-approve', 'returns/approve'],
  ['/webhooks/shopify/returns-decline', 'returns/decline'],
  ['/webhooks/shopify/returns-close', 'returns/close'],
  ['/webhooks/shopify/returns-cancel', 'returns/cancel'],
  ['/webhooks/shopify/fulfillments-create', 'fulfillments/create'],
  ['/webhooks/shopify/fulfillments-update', 'fulfillments/update'],
  ['/webhooks/shopify/fulfillment-events-create', 'fulfillment_events/create'],
  ['/webhooks/shopify/fulfillment-orders-cancelled', 'fulfillment_orders/cancelled'],
] as const;

function buildReply() {
  const reply = {
    statusCode: 200,
    code: vi.fn((status: number) => {
      reply.statusCode = status;
      return reply;
    }),
    send: vi.fn((body: unknown) => ({ status: reply.statusCode, body })),
  };
  return reply;
}

function buildRequest(topic: string) {
  const payload = topic === 'refunds/create'
    ? { id: 9001, order_id: 8001 }
    : { id: 8001, name: '#8001', line_items: [] };
  const rawBodyBuffer = Buffer.from(JSON.stringify(payload), 'utf8');
  return {
    rawBodyBuffer,
    rawBody: rawBodyBuffer.toString('utf8'),
    body: payload,
    headers: {
      'x-shopify-hmac-sha256': 'valid-hmac',
      'x-shopify-topic': topic,
      'x-shopify-shop-domain': 'shop.example.com',
      'x-shopify-webhook-id': `webhook-${topic}`,
      'content-type': 'application/json',
    },
  };
}

function registerRoutes(databaseUrl: string | undefined, asyncAckEnabled = false) {
  const routes = new Map<string, TestHandler>();
  const app = {
    post: vi.fn((path: string, handler: TestHandler) => routes.set(path, handler)),
    log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
  };

  registerShopifyWebhookRoutes(app as never, {
    NODE_ENV: 'test',
    DATABASE_URL: databaseUrl,
    SHOPIFY_WEBHOOK_SECRET: 'webhook-secret',
    SHOPIFY_SHOP_DOMAIN: 'shop.example.com',
    SHOPIFY_SELLER_INFO_RETRY_DELAY_MS: 0,
    SHOPIFY_ORDERS_CREATE_EXECUTOR_ENABLED: asyncAckEnabled,
    SHOPIFY_ORDERS_CREATE_ASYNC_ACK_ENABLED: asyncAckEnabled,
  } as never);

  return routes;
}

describe('Shopify webhook persistence fail-closed boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(persistenceRequiredRoutes)('%s returns retryable 503 when DATABASE_URL is absent', async (path, topic) => {
    const handler = registerRoutes(undefined).get(path)!;
    const result = await handler(buildRequest(topic), buildReply());

    expect(result).toEqual({
      status: 503,
      body: {
        ok: false,
        duplicate: false,
        action: 'persistence_unavailable',
        processingStatus: 'not_persisted',
        retryable: true,
        topic,
        message: 'Shopify webhook could not be durably persisted.',
      },
    });
    expect(getOrCreateWebhookEventMock).not.toHaveBeenCalled();
    expect(Object.values(downstreamMocks).every((mock) => mock.mock.calls.length === 0)).toBe(true);
  });

  it('returns 503 rather than 202 for synchronous orders/create when DATABASE_URL is empty', async () => {
    const handler = registerRoutes('').get('/webhooks/shopify/orders-create')!;

    await expect(handler(buildRequest('orders/create'), buildReply())).resolves.toMatchObject({
      status: 503,
      body: { action: 'persistence_unavailable', processingStatus: 'not_persisted', retryable: true },
    });
  });

  it('preserves the existing Fast ACK missing-persistence response', async () => {
    const handler = registerRoutes(undefined, true).get('/webhooks/shopify/orders-create')!;

    await expect(handler(buildRequest('orders/create'), buildReply())).resolves.toMatchObject({
      status: 503,
      body: { action: 'intake_persistence_failed', processingStatus: 'not_persisted', retryable: true },
    });
  });

  it('does not send a 2xx response when configured persistence is unreachable', async () => {
    getOrCreateWebhookEventMock.mockRejectedValueOnce(new Error('database unavailable'));
    const handler = registerRoutes('postgresql://configured-but-unreachable').get('/webhooks/shopify/orders-paid')!;
    const reply = buildReply();

    await expect(handler(buildRequest('orders/paid'), reply)).rejects.toThrow('database unavailable');
    expect(reply.send).not.toHaveBeenCalled();
    expect(downstreamMocks.syncPaidSnapshot).not.toHaveBeenCalled();
    expect(downstreamMocks.createJob).not.toHaveBeenCalled();
  });
});
