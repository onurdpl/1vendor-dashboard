import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  webhookEvent: {
    update: vi.fn(),
    updateMany: vi.fn(),
    findUnique: vi.fn(),
  },
  operationalJob: {
    findMany: vi.fn(),
  },
}));

const getOrCreateWebhookEventMock = vi.hoisted(() => vi.fn());
const orderIngestionMock = vi.hoisted(() => ({
  classifyOrderIngestionException: vi.fn(),
  ingestShopifyOrderWebhook: vi.fn(),
  syncShopifyOrderPaidSnapshotFromWebhook: vi.fn(),
  updateShopifyOrderContactAddressSnapshotFromWebhook: vi.fn(),
}));
const sellerInfoRetryMock = vi.hoisted(() => ({
  fetchSellerInfoWithRetry: vi.fn(),
}));
const shopifyAdminMock = vi.hoisted(() => ({
  fetchOrderSellerInfo: vi.fn(),
  fetchOrderLineItemImages: vi.fn(),
  fetchOrderTaxSnapshot: vi.fn(),
}));
const webhookServiceMock = vi.hoisted(() => ({
  verifyShopifyWebhookHmac: vi.fn(),
}));
const operationalJobsMock = vi.hoisted(() => ({
  createOperationalJob: vi.fn(),
  createWebhookOperationalJob: vi.fn(),
  markOperationalJobCompleted: vi.fn(),
  markOperationalJobFailed: vi.fn(),
  markOperationalJobProcessing: vi.fn(),
  markOperationalJobRetrying: vi.fn(),
  serializeOperationalJob: vi.fn(),
}));

vi.mock('../backend/src/db/prisma.js', () => ({ prisma: prismaMock }));

vi.mock('../backend/src/modules/shopify/webhook-idempotency.service.js', async () => {
  const actual = await vi.importActual<typeof import('../backend/src/modules/shopify/webhook-idempotency.service.js')>(
    '../backend/src/modules/shopify/webhook-idempotency.service.js',
  );
  return {
    ...actual,
    getOrCreateWebhookEvent: getOrCreateWebhookEventMock,
  };
});

vi.mock('../backend/src/modules/shopify/order-ingestion.service.js', () => orderIngestionMock);
vi.mock('../backend/src/modules/shopify/seller-info-retry.service.js', () => sellerInfoRetryMock);
vi.mock('../backend/src/modules/shopify/shopify-admin.service.js', () => ({
  createShopifyAdminService: vi.fn(() => shopifyAdminMock),
}));
vi.mock('../backend/src/modules/shopify/webhook.service.js', async () => {
  const actual = await vi.importActual<typeof import('../backend/src/modules/shopify/webhook.service.js')>(
    '../backend/src/modules/shopify/webhook.service.js',
  );
  return {
    ...actual,
    verifyShopifyWebhookHmac: webhookServiceMock.verifyShopifyWebhookHmac,
  };
});
vi.mock('../backend/src/modules/operational-jobs/operational-jobs.service.js', () => operationalJobsMock);

const { __webhookIdempotencyTesting, claimWebhookEvent } = await import(
  '../backend/src/modules/shopify/webhook-idempotency.service.js'
);
const { registerShopifyWebhookRoutes } = await import('../backend/src/modules/shopify/webhook.routes.js');
const { recoverWebhookEvent } = await import('../backend/src/modules/diagnostics/diagnostics.service.js');

function buildEvent(overrides: Record<string, unknown> = {}) {
  const retainedPayload = JSON.stringify({
    id: 2001,
    name: '#2001',
    line_items: [{ id: 3001, sku: 'SKU-1', quantity: 1, price: '100.00' }],
  });
  return {
    id: 'webhook-event-orders-create',
    sourceShopDomain: 'sporgym.myshopify.com',
    topic: 'orders/create',
    webhookId: 'orders-create-webhook-id',
    idempotencyKey: 'orders-create-key',
    payloadHash: 'payload-hash',
    rawPayload: retainedPayload,
    status: 'RECEIVED',
    receivedAt: new Date('2026-08-26T10:00:00.000Z'),
    processedAt: null,
    errorMessage: null,
    shopifyOrderId: null,
    ...overrides,
  };
}

function buildIdempotencyResult(overrides: Record<string, unknown> = {}) {
  return {
    event: buildEvent(),
    isDuplicate: false,
    duplicateStrategy: 'webhook_id',
    action: 'accepted',
    incomingPayloadHash: 'payload-hash',
    payloadIdentity: 'matched',
    ...overrides,
  };
}

function buildRetryJob(overrides: Record<string, unknown> = {}) {
  return {
    id: 'orders-create-retry-job',
    status: 'RETRY_SCHEDULED',
    failureCategory: 'transient',
    retryCount: 1,
    maxRetries: 3,
    ...overrides,
  };
}

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

function registerRoutes() {
  const routes = new Map<string, (request: unknown, reply: ReturnType<typeof buildReply>) => Promise<unknown>>();
  const app = {
    post: vi.fn((path: string, handler: (request: unknown, reply: ReturnType<typeof buildReply>) => Promise<unknown>) => {
      routes.set(path, handler);
    }),
    log: {
      warn: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
    },
  };

  registerShopifyWebhookRoutes(app as never, {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgres://example',
    SHOPIFY_WEBHOOK_SECRET: 'webhook-secret',
    SHOPIFY_SHOP_DOMAIN: 'sporgym.myshopify.com',
    SHOPIFY_SELLER_INFO_RETRY_DELAY_MS: 0,
  } as never);

  return routes.get('/webhooks/shopify/orders-create')!;
}

function buildRequest(payload: Record<string, unknown>, webhookId: string | null = 'orders-create-webhook-id') {
  const rawBodyBuffer = Buffer.from(JSON.stringify(payload), 'utf8');
  return {
    rawBodyBuffer,
    rawBody: rawBodyBuffer.toString('utf8'),
    body: payload,
    headers: {
      'x-shopify-hmac-sha256': 'valid-hmac',
      'x-shopify-topic': 'orders/create',
      'x-shopify-shop-domain': 'sporgym.myshopify.com',
      ...(webhookId ? { 'x-shopify-webhook-id': webhookId } : {}),
      'content-type': 'application/json',
    },
  };
}

const payload = {
  id: 2001,
  name: '#2001',
  line_items: [{ id: 3001, sku: 'SKU-1', quantity: 1, price: '100.00' }],
};

describe('orders/create state-aware retry ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    webhookServiceMock.verifyShopifyWebhookHmac.mockReturnValue(true);
    getOrCreateWebhookEventMock.mockResolvedValue(buildIdempotencyResult());
    prismaMock.webhookEvent.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.webhookEvent.findUnique.mockResolvedValue(buildEvent({ status: 'PROCESSING' }));
    prismaMock.webhookEvent.update.mockResolvedValue({});
    prismaMock.operationalJob.findMany.mockResolvedValue([]);
    sellerInfoRetryMock.fetchSellerInfoWithRetry.mockResolvedValue({
      ok: true,
      sellerInfo: { 'SKU-1': 'sporjinal' },
      attempts: 1,
      source: 'shopify_admin',
    });
    shopifyAdminMock.fetchOrderLineItemImages.mockResolvedValue({ lineItems: [] });
    shopifyAdminMock.fetchOrderTaxSnapshot.mockResolvedValue(null);
    operationalJobsMock.createWebhookOperationalJob.mockResolvedValue({ id: 'initial-job' });
    operationalJobsMock.createOperationalJob.mockResolvedValue({ id: 'recovery-job' });
    operationalJobsMock.markOperationalJobRetrying.mockResolvedValue(buildRetryJob({ status: 'RETRYING' }));
    operationalJobsMock.markOperationalJobFailed.mockResolvedValue({ status: 'FAILED' });
    orderIngestionMock.ingestShopifyOrderWebhook.mockResolvedValue({
      ok: true,
      action: 'accepted',
      processingStatus: 'processed',
      shopifyOrderId: '2001',
      allocationCount: 1,
    });
    orderIngestionMock.classifyOrderIngestionException.mockReturnValue({
      failureCode: 'unknown_internal_error',
      failureDisposition: 'UNKNOWN',
      failureCategory: 'reconciliation_required',
      retryable: false,
      error: 'Unknown failure.',
    });
  });

  it('allows exactly one concurrent RECEIVED claim winner', async () => {
    prismaMock.webhookEvent.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    prismaMock.webhookEvent.findUnique.mockResolvedValueOnce(buildEvent({ status: 'PROCESSING' }));

    const [first, second] = await Promise.all([
      claimWebhookEvent({ eventId: 'event-1', expectedStatus: 'RECEIVED' }),
      claimWebhookEvent({ eventId: 'event-1', expectedStatus: 'RECEIVED' }),
    ]);

    expect([first.acquired, second.acquired].filter(Boolean)).toHaveLength(1);
    expect(prismaMock.webhookEvent.updateMany).toHaveBeenCalledTimes(2);
    expect(second).toMatchObject({ acquired: false, event: { status: 'PROCESSING' } });
  });

  it('serializes two concurrent FAILED claimants with the same primitive', async () => {
    prismaMock.webhookEvent.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    prismaMock.webhookEvent.findUnique.mockResolvedValueOnce(buildEvent({ status: 'PROCESSING' }));

    const [shopifyRetry, adminRecovery] = await Promise.all([
      claimWebhookEvent({ eventId: 'failed-event', expectedStatus: 'FAILED' }),
      claimWebhookEvent({ eventId: 'failed-event', expectedStatus: 'FAILED' }),
    ]);

    expect([shopifyRetry.acquired, adminRecovery.acquired].filter(Boolean)).toHaveLength(1);
    expect(adminRecovery).toMatchObject({ acquired: false, event: { status: 'PROCESSING' } });
  });

  it('preserves webhook-id fallback identity when the Shopify webhook id is absent', async () => {
    const handler = registerRoutes();
    await handler(buildRequest(payload, null), buildReply());

    expect(getOrCreateWebhookEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ webhookId: null }),
    );
    expect(__webhookIdempotencyTesting.getDuplicateStrategy(null)).toBe('payload_hash');
    expect(__webhookIdempotencyTesting.computeIdempotencyKey({
      topic: 'orders/create',
      shopDomain: 'sporgym.myshopify.com',
      webhookId: null,
      payloadHash: 'hash-1',
    })).toBe('sporgym.myshopify.com:orders/create:payload:hash-1');
    expect(__webhookIdempotencyTesting.comparePayloadIdentity('hash-1', 'hash-1')).toBe('matched');
    expect(__webhookIdempotencyTesting.comparePayloadIdentity('hash-1', 'hash-2')).toBe('mismatched');
  });

  it('keeps a PROCESSED same-id delivery as a 202 no-op', async () => {
    getOrCreateWebhookEventMock.mockResolvedValueOnce(buildIdempotencyResult({
      isDuplicate: true,
      event: buildEvent({ status: 'PROCESSED' }),
    }));

    const result = await registerRoutes()(buildRequest(payload), buildReply());

    expect(result).toMatchObject({ status: 202, body: { action: 'duplicate_ignored' } });
    expect(prismaMock.webhookEvent.updateMany).not.toHaveBeenCalled();
    expect(orderIngestionMock.ingestShopifyOrderWebhook).not.toHaveBeenCalled();
  });

  it('keeps a PROCESSING same-id delivery non-reprocessable', async () => {
    getOrCreateWebhookEventMock.mockResolvedValueOnce(buildIdempotencyResult({
      isDuplicate: true,
      event: buildEvent({ status: 'PROCESSING' }),
    }));

    const result = await registerRoutes()(buildRequest(payload), buildReply());

    expect(result).toMatchObject({ status: 202, body: { action: 'duplicate_in_progress' } });
    expect(orderIngestionMock.ingestShopifyOrderWebhook).not.toHaveBeenCalled();
  });

  it('blocks mismatching same-id payload evidence without changing the event', async () => {
    getOrCreateWebhookEventMock.mockResolvedValueOnce(buildIdempotencyResult({
      isDuplicate: true,
      payloadIdentity: 'mismatched',
      incomingPayloadHash: 'different-hash',
    }));

    const result = await registerRoutes()(buildRequest(payload), buildReply());

    expect(result).toMatchObject({ status: 202, body: { action: 'identity_conflict_needs_attention' } });
    expect(prismaMock.webhookEvent.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.webhookEvent.update).not.toHaveBeenCalled();
    expect(orderIngestionMock.ingestShopifyOrderWebhook).not.toHaveBeenCalled();
  });

  it('claims an initial RECEIVED event before normal ingestion', async () => {
    const result = await registerRoutes()(buildRequest(payload), buildReply());

    expect(prismaMock.webhookEvent.updateMany).toHaveBeenCalledWith({
      where: { id: 'webhook-event-orders-create', status: 'RECEIVED' },
      data: { status: 'PROCESSING', errorMessage: null },
    });
    expect(orderIngestionMock.ingestShopifyOrderWebhook).toHaveBeenCalledWith(
      expect.objectContaining({ payload, mode: 'upsert' }),
    );
    expect(result).toMatchObject({ status: 202, body: { processingStatus: 'processed' } });
  });

  it('continues awaiting full processing before sending the synchronous response', async () => {
    let resolveIngestion!: (value: unknown) => void;
    orderIngestionMock.ingestShopifyOrderWebhook.mockImplementationOnce(
      () => new Promise((resolve) => {
        resolveIngestion = resolve;
      }),
    );
    const reply = buildReply();
    const response = registerRoutes()(buildRequest(payload), reply);
    await vi.waitFor(() => expect(orderIngestionMock.ingestShopifyOrderWebhook).toHaveBeenCalledOnce());

    expect(reply.send).not.toHaveBeenCalled();

    resolveIngestion({
      ok: true,
      action: 'accepted',
      processingStatus: 'processed',
      shopifyOrderId: '2001',
      allocationCount: 1,
    });

    await expect(response).resolves.toMatchObject({
      status: 202,
      body: { processingStatus: 'processed' },
    });
  });

  it('uses retained payload and missing-order-only mode for duplicate RECEIVED recovery', async () => {
    const retainedPayload = { ...payload, id: 2012, name: '#2012' };
    getOrCreateWebhookEventMock.mockResolvedValueOnce(buildIdempotencyResult({
      isDuplicate: true,
      event: buildEvent({ status: 'RECEIVED', rawPayload: JSON.stringify(retainedPayload) }),
    }));

    await registerRoutes()(buildRequest({ ...payload, id: 9999 }), buildReply());

    expect(orderIngestionMock.ingestShopifyOrderWebhook).toHaveBeenCalledWith(
      expect.objectContaining({ payload: retainedPayload, mode: 'missing_order_only' }),
    );
  });

  it('reuses one qualified retry job for an eligible FAILED delivery', async () => {
    const retryJob = buildRetryJob();
    getOrCreateWebhookEventMock.mockResolvedValueOnce(buildIdempotencyResult({
      isDuplicate: true,
      event: buildEvent({ status: 'FAILED', errorMessage: 'seller_info unavailable' }),
    }));
    prismaMock.operationalJob.findMany.mockResolvedValue([retryJob]);

    const result = await registerRoutes()(buildRequest(payload), buildReply());

    expect(prismaMock.webhookEvent.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'webhook-event-orders-create', status: 'FAILED' } }),
    );
    expect(operationalJobsMock.markOperationalJobRetrying).toHaveBeenCalledWith(retryJob.id);
    expect(operationalJobsMock.createWebhookOperationalJob).not.toHaveBeenCalled();
    expect(orderIngestionMock.ingestShopifyOrderWebhook).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'missing_order_only' }),
    );
    expect(result).toMatchObject({ status: 202, body: { processingStatus: 'processed' } });
  });

  it('fails closed when FAILED retry-job evidence is missing or ambiguous', async () => {
    getOrCreateWebhookEventMock.mockResolvedValueOnce(buildIdempotencyResult({
      isDuplicate: true,
      event: buildEvent({ status: 'FAILED' }),
    }));
    prismaMock.operationalJob.findMany.mockResolvedValue([buildRetryJob(), buildRetryJob({ id: 'job-2' })]);

    const result = await registerRoutes()(buildRequest(payload), buildReply());

    expect(result).toMatchObject({ status: 202, body: { retryable: false } });
    expect(prismaMock.webhookEvent.updateMany).not.toHaveBeenCalled();
    expect(orderIngestionMock.ingestShopifyOrderWebhook).not.toHaveBeenCalled();
  });

  it('does not automatically claim an exhausted FAILED retry', async () => {
    getOrCreateWebhookEventMock.mockResolvedValueOnce(buildIdempotencyResult({
      isDuplicate: true,
      event: buildEvent({ status: 'FAILED' }),
    }));
    prismaMock.operationalJob.findMany.mockResolvedValue([
      buildRetryJob({ status: 'DEAD_LETTER_READY', retryCount: 3, maxRetries: 3 }),
    ]);

    const result = await registerRoutes()(buildRequest(payload), buildReply());

    expect(result).toMatchObject({ status: 202, body: { retryable: false } });
    expect(prismaMock.webhookEvent.updateMany).not.toHaveBeenCalled();
  });

  it('returns 503 only when a retryable failure is recorded as RETRY_SCHEDULED', async () => {
    sellerInfoRetryMock.fetchSellerInfoWithRetry.mockResolvedValueOnce({
      ok: false,
      error: 'Shopify seller_info metafield was missing or empty after retry attempts.',
      attempts: 3,
      source: 'shopify_admin',
    });
    operationalJobsMock.markOperationalJobFailed.mockResolvedValueOnce({ status: 'RETRY_SCHEDULED' });

    const result = await registerRoutes()(buildRequest(payload), buildReply());

    expect(operationalJobsMock.markOperationalJobFailed).toHaveBeenCalledWith(
      'initial-job',
      expect.any(String),
      { category: 'transient', retryable: true },
    );
    expect(result).toMatchObject({
      status: 503,
      body: { action: 'retryable_failure', failureCode: 'seller_info_unavailable', retryable: true },
    });
  });

  it('returns 202 and FAILED needs-attention semantics for non-retryable ingestion', async () => {
    orderIngestionMock.ingestShopifyOrderWebhook.mockResolvedValueOnce({
      ok: false,
      action: 'received_needs_attention',
      processingStatus: 'needs_attention',
      failureCode: 'missing_sku',
      failureDisposition: 'NON_RETRYABLE',
      failureCategory: 'validation',
      retryable: false,
      error: 'Line item is missing SKU.',
    });

    const result = await registerRoutes()(buildRequest(payload), buildReply());

    expect(result).toMatchObject({
      status: 202,
      body: { action: 'received_needs_attention', failureCode: 'missing_sku', retryable: false },
    });
    expect(prismaMock.webhookEvent.update).toHaveBeenCalledWith({
      where: { id: 'webhook-event-orders-create' },
      data: { status: 'FAILED', errorMessage: 'Line item is missing SKU.' },
    });
  });

  it('does not ingest when a claim loser observes PROCESSING', async () => {
    prismaMock.webhookEvent.updateMany.mockResolvedValueOnce({ count: 0 });
    prismaMock.webhookEvent.findUnique.mockResolvedValueOnce(buildEvent({ status: 'PROCESSING' }));

    const result = await registerRoutes()(buildRequest(payload), buildReply());

    expect(result).toMatchObject({ status: 202, body: { action: 'duplicate_in_progress' } });
    expect(orderIngestionMock.ingestShopifyOrderWebhook).not.toHaveBeenCalled();
  });

  it('returns duplicate success when a claim loser re-reads PROCESSED', async () => {
    prismaMock.webhookEvent.updateMany.mockResolvedValueOnce({ count: 0 });
    prismaMock.webhookEvent.findUnique.mockResolvedValueOnce(buildEvent({ status: 'PROCESSED' }));

    const result = await registerRoutes()(buildRequest(payload), buildReply());

    expect(result).toMatchObject({ status: 202, body: { action: 'duplicate_ignored' } });
    expect(orderIngestionMock.ingestShopifyOrderWebhook).not.toHaveBeenCalled();
  });

  it('returns 503 when a claim loser re-reads FAILED with proven retry evidence', async () => {
    prismaMock.webhookEvent.updateMany.mockResolvedValueOnce({ count: 0 });
    prismaMock.webhookEvent.findUnique.mockResolvedValueOnce(buildEvent({
      status: 'FAILED',
      errorMessage: 'Transient failure.',
    }));
    prismaMock.operationalJob.findMany.mockResolvedValueOnce([buildRetryJob()]);

    const result = await registerRoutes()(buildRequest(payload), buildReply());

    expect(result).toMatchObject({ status: 503, body: { action: 'retryable_failure', retryable: true } });
    expect(orderIngestionMock.ingestShopifyOrderWebhook).not.toHaveBeenCalled();
  });

  it('returns 202 when a claim loser re-reads FAILED without retry evidence', async () => {
    prismaMock.webhookEvent.updateMany.mockResolvedValueOnce({ count: 0 });
    prismaMock.webhookEvent.findUnique.mockResolvedValueOnce(buildEvent({
      status: 'FAILED',
      errorMessage: 'Validation failure.',
    }));
    prismaMock.operationalJob.findMany.mockResolvedValueOnce([]);

    const result = await registerRoutes()(buildRequest(payload), buildReply());

    expect(result).toMatchObject({ status: 202, body: { action: 'received_needs_attention', retryable: false } });
    expect(orderIngestionMock.ingestShopifyOrderWebhook).not.toHaveBeenCalled();
  });

  it('admin recovery claims before creating its audit job and uses missing-order-only ingestion', async () => {
    const failedEvent = buildEvent({ status: 'FAILED' });
    prismaMock.webhookEvent.findUnique
      .mockResolvedValueOnce(failedEvent)
      .mockResolvedValueOnce(buildEvent({ status: 'PROCESSED' }));
    prismaMock.webhookEvent.updateMany.mockResolvedValueOnce({ count: 1 });

    const result = await recoverWebhookEvent({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgres://example',
      SHOPIFY_SELLER_INFO_RETRY_DELAY_MS: 0,
    } as never, failedEvent.id);

    expect(prismaMock.webhookEvent.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: failedEvent.id, status: 'FAILED' } }),
    );
    expect(operationalJobsMock.createOperationalJob).toHaveBeenCalledAfter(prismaMock.webhookEvent.updateMany);
    expect(orderIngestionMock.ingestShopifyOrderWebhook).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'missing_order_only' }),
    );
    expect(result).toMatchObject({ ok: true, response: { recoveryStatus: 'recovered' } });
  });

  it('admin recovery claim loser creates no recovery job and performs no ingestion', async () => {
    const failedEvent = buildEvent({ status: 'FAILED' });
    prismaMock.webhookEvent.findUnique
      .mockResolvedValueOnce(failedEvent)
      .mockResolvedValueOnce(buildEvent({ status: 'PROCESSING' }));
    prismaMock.webhookEvent.updateMany.mockResolvedValueOnce({ count: 0 });

    const result = await recoverWebhookEvent({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgres://example',
      SHOPIFY_SELLER_INFO_RETRY_DELAY_MS: 0,
    } as never, failedEvent.id);

    expect(result).toMatchObject({
      ok: false,
      statusCode: 409,
      response: { recoveryStatus: 'not_recoverable', afterStatus: 'PROCESSING' },
    });
    expect(operationalJobsMock.createOperationalJob).not.toHaveBeenCalled();
    expect(orderIngestionMock.ingestShopifyOrderWebhook).not.toHaveBeenCalled();
  });
});
