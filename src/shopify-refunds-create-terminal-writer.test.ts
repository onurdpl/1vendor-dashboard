import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  webhookEvent: { update: vi.fn() },
}));
const webhookIdempotencyMock = vi.hoisted(() => ({ getOrCreateWebhookEvent: vi.fn() }));
const shopifyAdminMock = vi.hoisted(() => ({ fetchCanonicalRefundsForOrder: vi.fn() }));
const refundIngestionMock = vi.hoisted(() => ({ ingestVerifiedShopifyRefund: vi.fn() }));
const terminalWriterMock = vi.hoisted(() => ({ createVerifiedFactsForShopifyOrder: vi.fn() }));
const returnSignalDiscoveryMock = vi.hoisted(() => ({ recordShopifyReturnSignalDiscovery: vi.fn() }));
const operationalJobsMock = vi.hoisted(() => ({
  createWebhookOperationalJob: vi.fn(),
  markOperationalJobCompleted: vi.fn(),
  markOperationalJobFailed: vi.fn(),
  markOperationalJobProcessing: vi.fn(),
  markOperationalJobRetrying: vi.fn(),
}));
const webhookServiceMock = vi.hoisted(() => ({ verifyShopifyWebhookHmac: vi.fn() }));

vi.mock('../backend/src/db/prisma.js', () => ({ prisma: prismaMock }));
vi.mock('../backend/src/modules/shopify/webhook-idempotency.service.js', () => webhookIdempotencyMock);
vi.mock('../backend/src/modules/shopify/refund-ingestion.service.js', () => refundIngestionMock);
vi.mock('../backend/src/modules/shopify/shopify-admin.service.js', () => ({
  createShopifyAdminService: vi.fn(() => shopifyAdminMock),
}));
vi.mock('../backend/src/modules/orders/allocation-full-refund-terminal-fact.service.js', async () => {
  const actual = await vi.importActual<typeof import('../backend/src/modules/orders/allocation-full-refund-terminal-fact.service.js')>(
    '../backend/src/modules/orders/allocation-full-refund-terminal-fact.service.js',
  );
  return {
    ...actual,
    createAllocationFullRefundTerminalFactService: vi.fn(() => terminalWriterMock),
  };
});
vi.mock('../backend/src/modules/shopify/return-signal-discovery.service.js', () => returnSignalDiscoveryMock);
vi.mock('../backend/src/modules/operational-jobs/operational-jobs.service.js', () => operationalJobsMock);
vi.mock('../backend/src/modules/shopify/webhook.service.js', async () => {
  const actual = await vi.importActual<typeof import('../backend/src/modules/shopify/webhook.service.js')>(
    '../backend/src/modules/shopify/webhook.service.js',
  );
  return { ...actual, verifyShopifyWebhookHmac: webhookServiceMock.verifyShopifyWebhookHmac };
});
vi.mock('../backend/src/modules/shopify/order-ingestion.service.js', () => ({
  syncShopifyOrderPaidSnapshotFromWebhook: vi.fn(),
  updateShopifyOrderContactAddressSnapshotFromWebhook: vi.fn(),
}));
vi.mock('../backend/src/modules/shopify/fulfillment-ingestion.service.js', () => ({
  ingestFulfillmentWebhook: vi.fn(),
}));
vi.mock('../backend/src/modules/reconciliation/canonical-cancellation-reconciliation.service.js', () => ({
  createCanonicalCancellationReconciliationService: vi.fn(() => ({
    reconcileShopifyOrderCancellation: vi.fn(),
  })),
}));

const { registerShopifyWebhookRoutes } = await import('../backend/src/modules/shopify/webhook.routes.js');

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

function canonicalRefunds() {
  return {
    orderGid: 'gid://shopify/Order/1105',
    sourceShopifyOrderId: '1105',
    displayFinancialStatus: 'PARTIALLY_REFUNDED',
    orderTotalRefundedAmount: '100.00',
    orderTotalRefundedCurrencyCode: 'TRY',
    refundsListComplete: true,
    source: 'shopify_admin',
    refunds: [{
      refundGid: 'gid://shopify/Refund/5001',
      sourceShopifyRefundId: '5001',
      createdAt: '2026-07-11T18:00:00.000Z',
      updatedAt: '2026-07-11T18:00:01.000Z',
      note: null,
      totalRefundedAmount: '100.00',
      totalRefundedCurrencyCode: 'TRY',
      transactionPaginationComplete: true,
      lineItemPaginationComplete: true,
      transactions: [{
        transactionGid: 'gid://shopify/OrderTransaction/5001',
        kind: 'REFUND',
        status: 'SUCCESS',
        amount: '100.00',
        currencyCode: 'TRY',
        parentTransactionGid: 'gid://shopify/OrderTransaction/parent-5001',
        createdAt: '2026-07-11T18:00:00.000Z',
        processedAt: '2026-07-11T18:00:01.000Z',
      }],
      refundLineItems: [{
        refundLineItemGid: 'gid://shopify/RefundLineItem/6001',
        sourceRefundLineItemId: '6001',
        lineItemGid: 'gid://shopify/LineItem/7001',
        sourceLineItemId: '7001',
        sku: 'SKU-1',
        title: 'Product',
        name: 'Product',
        variantTitle: null,
        quantity: 1,
        subtotalAmount: '100.00',
        currencyCode: 'TRY',
      }],
    }],
  };
}

function registerRoutes() {
  const routes = new Map<string, (request: unknown, reply: ReturnType<typeof buildReply>) => Promise<unknown>>();
  const app = {
    post: vi.fn((path: string, handler: (request: unknown, reply: ReturnType<typeof buildReply>) => Promise<unknown>) => {
      routes.set(path, handler);
    }),
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
  registerShopifyWebhookRoutes(app as never, {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgres://example',
    SHOPIFY_WEBHOOK_SECRET: 'webhook-secret',
    SHOPIFY_SHOP_DOMAIN: 'sporgym.myshopify.com',
    SHOPIFY_API_VERSION: '2026-01',
    FULL_REFUND_TERMINAL_WRITER_ENABLED: false,
  } as never);
  return { routes, app };
}

function request(webhookId = 'refund-webhook-1') {
  const payload = { id: 5001, order_id: 1105, refund_line_items: [{ id: 6001, quantity: 1 }] };
  const rawBodyBuffer = Buffer.from(JSON.stringify(payload));
  return {
    rawBodyBuffer,
    rawBody: rawBodyBuffer.toString('utf8'),
    body: payload,
    headers: {
      'x-shopify-hmac-sha256': 'valid-hmac',
      'x-shopify-topic': 'refunds/create',
      'x-shopify-shop-domain': 'sporgym.myshopify.com',
      'x-shopify-webhook-id': webhookId,
      'content-type': 'application/json',
    },
  };
}

describe('refunds/create full-refund terminal writer wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    webhookServiceMock.verifyShopifyWebhookHmac.mockReturnValue(true);
    webhookIdempotencyMock.getOrCreateWebhookEvent.mockResolvedValue({
      isDuplicate: false,
      event: { id: 'event-1', payloadHash: 'hash-1', topic: 'refunds/create' },
    });
    operationalJobsMock.createWebhookOperationalJob.mockResolvedValue({ id: 'job-1' });
    returnSignalDiscoveryMock.recordShopifyReturnSignalDiscovery.mockResolvedValue({});
    shopifyAdminMock.fetchCanonicalRefundsForOrder.mockResolvedValue(canonicalRefunds());
    refundIngestionMock.ingestVerifiedShopifyRefund.mockResolvedValue({
      ok: true,
      action: 'accepted',
      processingStatus: 'processed',
      shopifyOrderId: '1105',
      refundAllocationCount: 1,
    });
    terminalWriterMock.createVerifiedFactsForShopifyOrder.mockResolvedValue({
      sourceShopifyOrderId: '1105',
      verificationSource: 'refund_webhook',
      outcome: 'DISABLED',
      reasonCode: 'writer_disabled',
      allocations: [],
    });
    prismaMock.webhookEvent.update.mockResolvedValue({});
  });

  it('invokes the order writer only after successful committed ingestion and preserves 202 while disabled', async () => {
    const { routes } = registerRoutes();
    const result = await routes.get('/webhooks/shopify/refunds-create')?.(request(), buildReply());

    expect(terminalWriterMock.createVerifiedFactsForShopifyOrder).toHaveBeenCalledWith({
      sourceShopifyOrderId: '1105',
      verificationSource: 'refund_webhook',
    });
    expect(refundIngestionMock.ingestVerifiedShopifyRefund.mock.invocationCallOrder[0]).toBeLessThan(
      terminalWriterMock.createVerifiedFactsForShopifyOrder.mock.invocationCallOrder[0]!,
    );
    expect(result).toMatchObject({ status: 202, body: { action: 'accepted', processingStatus: 'processed' } });
    expect(operationalJobsMock.markOperationalJobFailed).not.toHaveBeenCalled();
  });

  it.each([
    'DOES_NOT_QUALIFY',
    'INDETERMINATE',
    'CONFLICT_WITH_OUTBOUND_DURABLE_CLAIM',
  ] as const)('acknowledges a controlled %s writer outcome without finance rollback', async (outcome) => {
    terminalWriterMock.createVerifiedFactsForShopifyOrder.mockResolvedValueOnce({
      sourceShopifyOrderId: '1105',
      verificationSource: 'refund_webhook',
      outcome: 'COMPLETED',
      reasonCode: null,
      allocations: [{ allocationId: 'alloc-1', verificationSource: 'refund_webhook', outcome, reasonCode: 'safe_reason' }],
    });
    const { routes } = registerRoutes();
    const result = await routes.get('/webhooks/shopify/refunds-create')?.(request(), buildReply());

    expect(result).toMatchObject({ status: 202, body: { action: 'accepted' } });
    expect(operationalJobsMock.markOperationalJobCompleted).toHaveBeenCalledWith('job-1');
    expect(operationalJobsMock.markOperationalJobFailed).not.toHaveBeenCalled();
  });

  it('isolates an unexpected writer error and does not expose it or roll back ingestion', async () => {
    terminalWriterMock.createVerifiedFactsForShopifyOrder.mockRejectedValueOnce(
      new Error('secret canonical payload'),
    );
    const { routes, app } = registerRoutes();
    const result = await routes.get('/webhooks/shopify/refunds-create')?.(request(), buildReply());

    expect(result).toMatchObject({ status: 202, body: { action: 'accepted' } });
    expect(operationalJobsMock.markOperationalJobCompleted).toHaveBeenCalledWith('job-1');
    expect(operationalJobsMock.markOperationalJobFailed).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('secret canonical payload');
    expect(JSON.stringify(app.log.error.mock.calls)).not.toContain('secret canonical payload');
  });

  it('does not replay the writer for a duplicate webhook', async () => {
    webhookIdempotencyMock.getOrCreateWebhookEvent.mockResolvedValueOnce({
      isDuplicate: true,
      event: { id: 'event-1', payloadHash: 'hash-1', topic: 'refunds/create' },
    });
    const { routes } = registerRoutes();
    const result = await routes.get('/webhooks/shopify/refunds-create')?.(request(), buildReply());

    expect(result).toMatchObject({ status: 202, body: { action: 'duplicate_ignored' } });
    expect(refundIngestionMock.ingestVerifiedShopifyRefund).not.toHaveBeenCalled();
    expect(terminalWriterMock.createVerifiedFactsForShopifyOrder).not.toHaveBeenCalled();
  });

  it('does not invoke the writer when refund ingestion fails', async () => {
    refundIngestionMock.ingestVerifiedShopifyRefund.mockResolvedValueOnce({
      ok: false,
      action: 'received_needs_attention',
      processingStatus: 'needs_attention',
      error: 'refund ingestion failed',
    });
    const { routes } = registerRoutes();
    const result = await routes.get('/webhooks/shopify/refunds-create')?.(request(), buildReply());

    expect(result).toMatchObject({ status: 202, body: { action: 'received_needs_attention' } });
    expect(terminalWriterMock.createVerifiedFactsForShopifyOrder).not.toHaveBeenCalled();
  });
});
