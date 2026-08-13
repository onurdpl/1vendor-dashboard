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

const shopifyAdminMock = vi.hoisted(() => ({
  fetchOrderSellerInfo: vi.fn(),
  fetchOrderLineItemImages: vi.fn(),
  fetchOrderTaxSnapshot: vi.fn(),
  fetchCanonicalOrderSnapshot: vi.fn(),
  fetchCanonicalRefundsForOrder: vi.fn(),
}));

const refundIngestionMock = vi.hoisted(() => ({
  ingestVerifiedShopifyRefund: vi.fn(),
}));

const cancellationReconciliationMock = vi.hoisted(() => ({
  reconcileShopifyOrderCancellation: vi.fn(),
}));

const returnSignalDiscoveryMock = vi.hoisted(() => ({
  recordShopifyReturnSignalDiscovery: vi.fn(),
}));

const fulfillmentIngestionMock = vi.hoisted(() => ({
  ingestFulfillmentWebhook: vi.fn(),
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

vi.mock('../backend/src/modules/shopify/refund-ingestion.service.js', () => refundIngestionMock);

vi.mock('../backend/src/modules/shopify/shopify-admin.service.js', () => ({
  createShopifyAdminService: vi.fn(() => shopifyAdminMock),
}));

vi.mock('../backend/src/modules/reconciliation/canonical-cancellation-reconciliation.service.js', () => ({
  createCanonicalCancellationReconciliationService: vi.fn(() => cancellationReconciliationMock),
}));

vi.mock('../backend/src/modules/shopify/return-signal-discovery.service.js', () => returnSignalDiscoveryMock);

vi.mock('../backend/src/modules/shopify/fulfillment-ingestion.service.js', () => fulfillmentIngestionMock);

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

function registerRoutes(envOverrides: Record<string, unknown> = {}) {
  const routes = new Map<string, (request: unknown, reply: ReturnType<typeof buildReply>) => Promise<unknown>>();
  const app = {
    post: vi.fn((path: string, handler: (request: unknown, reply: ReturnType<typeof buildReply>) => Promise<unknown>) => {
      routes.set(path, handler);
    }),
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  };

  registerShopifyWebhookRoutes(app as never, {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgres://example',
    SHOPIFY_WEBHOOK_SECRET: 'webhook-secret',
    SHOPIFY_SHOP_DOMAIN: 'sporgym.myshopify.com',
    ...envOverrides,
  } as never);

  return {
    routes,
    app,
  };
}

function buildWebhookRequest(input: {
  topic: string;
  webhookId?: string;
  payload: Record<string, unknown>;
  shopDomain?: string;
  hmac?: string;
}) {
  const rawBodyBuffer = Buffer.from(JSON.stringify(input.payload), 'utf8');
  return {
    rawBodyBuffer,
    rawBody: rawBodyBuffer.toString('utf8'),
    body: input.payload,
    headers: {
      'x-shopify-hmac-sha256': input.hmac ?? 'valid-hmac',
      'x-shopify-topic': input.topic,
      'x-shopify-shop-domain': input.shopDomain ?? 'sporgym.myshopify.com',
      'x-shopify-webhook-id': input.webhookId ?? `${input.topic}-webhook-id`,
      'content-type': 'application/json',
    },
  };
}

function canonicalOrder(overrides: Record<string, unknown> = {}) {
  return {
    sourceShopifyOrderId: '1104',
    financialStatus: 'voided',
    cancelledAt: '2026-07-08T10:00:00.000Z',
    cancelReason: 'customer',
    ...overrides,
  };
}

function canonicalRefunds(kind: 'REFUND' | 'VOID', amount: string) {
  return {
    orderGid: 'gid://shopify/Order/1105',
    sourceShopifyOrderId: '1105',
    orderTotalRefundedAmount: amount,
    orderTotalRefundedCurrencyCode: 'TRY',
    refundsListComplete: true,
    source: 'shopify_admin',
    refunds: [{
      refundGid: 'gid://shopify/Refund/5001',
      sourceShopifyRefundId: '5001',
      createdAt: '2026-07-11T18:00:00.000Z',
      updatedAt: '2026-07-11T18:00:01.000Z',
      note: null,
      totalRefundedAmount: amount,
      totalRefundedCurrencyCode: 'TRY',
      transactionPaginationComplete: true,
      lineItemPaginationComplete: true,
      transactions: [{
        transactionGid: 'gid://shopify/OrderTransaction/5001',
        kind,
        status: 'SUCCESS',
        amount,
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
        subtotalAmount: kind === 'VOID' ? '4799.00' : amount,
        currencyCode: 'TRY',
      }],
    }],
  };
}

describe('Shopify orders/cancelled webhook bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    webhookServiceMock.verifyShopifyWebhookHmac.mockReturnValue(true);
    webhookIdempotencyMock.getOrCreateWebhookEvent.mockResolvedValue({
      isDuplicate: false,
      event: {
        id: 'webhook-event-cancelled',
        payloadHash: 'payload-hash',
        topic: 'orders/cancelled',
        receivedAt: new Date('2026-07-08T10:00:00.000Z'),
      },
    });
    operationalJobsMock.createWebhookOperationalJob.mockResolvedValue({
      id: 'operational-job-cancelled',
    });
    shopifyAdminMock.fetchCanonicalOrderSnapshot.mockResolvedValue(canonicalOrder());
    shopifyAdminMock.fetchCanonicalRefundsForOrder.mockResolvedValue(canonicalRefunds('REFUND', '100.00'));
    refundIngestionMock.ingestVerifiedShopifyRefund.mockResolvedValue({
      ok: true,
      action: 'accepted',
      processingStatus: 'processed',
      shopifyOrderId: '1105',
      refundAllocationCount: 1,
    });
    cancellationReconciliationMock.reconcileShopifyOrderCancellation.mockResolvedValue({
      shopifyOrderId: '1104',
      cancellationState: 'full_order_cancelled',
      affectedAllocations: ['alloc-1104'],
      affectedLineItems: ['line-1104'],
      ledgersHeldOrVoided: ['ledger-1104'],
      signalsCreatedOrUpdated: 1,
    });
    orderIngestionMock.updateShopifyOrderContactAddressSnapshotFromWebhook.mockResolvedValue({
      matched: true,
      updated: true,
      orderId: 'shopify-order-db-1104',
      sourceShopifyOrderId: '1104',
      changedFields: ['shippingAddress'],
    });
    returnSignalDiscoveryMock.recordShopifyReturnSignalDiscovery.mockResolvedValue({
      topLevelPayloadKeys: ['cancelled_at', 'id'],
      orderIdPresent: true,
      returnIdPresent: false,
      lineItemIdsPresent: false,
      refundIdPresent: false,
      matchedOrderId: 'shopify-order-db-1104',
      matchedByField: 'order_id',
    });
    fulfillmentIngestionMock.ingestFulfillmentWebhook.mockResolvedValue({
      ok: true,
      action: 'fulfilled_synced',
      processingStatus: 'processed',
      shopifyOrderId: '1104',
      affectedAllocationCount: 1,
    });
    prismaMock.webhookEvent.update.mockResolvedValue({});
  });

  it('registers the orders-cancelled route and bridges canonical cancellations into reconciliation', async () => {
    const { routes } = registerRoutes();
    const handler = routes.get('/webhooks/shopify/orders-cancelled');
    const payload = {
      id: 1104,
      cancelled_at: '2026-07-08T10:00:00.000Z',
      financial_status: 'voided',
    };

    const result = await handler?.(buildWebhookRequest({
      topic: 'orders/cancelled',
      payload,
    }), buildReply());

    expect(handler).toBeDefined();
    expect(webhookIdempotencyMock.getOrCreateWebhookEvent).toHaveBeenCalledWith({
      topic: 'orders/cancelled',
      shopDomain: 'sporgym.myshopify.com',
      webhookId: 'orders/cancelled-webhook-id',
      rawBody: JSON.stringify(payload),
    });
    expect(operationalJobsMock.createWebhookOperationalJob).toHaveBeenCalledWith({
      topic: 'orders/cancelled',
      webhookEventId: 'webhook-event-cancelled',
      payloadRef: 'payload-hash',
      sourceShopifyOrderId: '1104',
    });
    expect(shopifyAdminMock.fetchCanonicalOrderSnapshot).toHaveBeenCalledWith('1104');
    expect(cancellationReconciliationMock.reconcileShopifyOrderCancellation).toHaveBeenCalledWith('1104');
    expect(result).toMatchObject({
      status: 202,
      body: {
        ok: true,
        duplicate: false,
        topic: 'orders/cancelled',
        action: 'canonical_cancellation_reconciled',
        processingStatus: 'processed',
        shopifyOrderId: '1104',
        cancellationProcessed: true,
        cancellationState: 'full_order_cancelled',
      },
    });
  });

  it('does not reconcile orders-cancelled when canonical cancelledAt is missing', async () => {
    shopifyAdminMock.fetchCanonicalOrderSnapshot.mockResolvedValueOnce(canonicalOrder({
      cancelledAt: null,
    }));
    const { routes, app } = registerRoutes();
    const handler = routes.get('/webhooks/shopify/orders-cancelled');

    const result = await handler?.(buildWebhookRequest({
      topic: 'orders/cancelled',
      payload: {
        id: 1104,
        cancelled_at: '2026-07-08T10:00:00.000Z',
        financial_status: 'voided',
      },
    }), buildReply());

    expect(cancellationReconciliationMock.reconcileShopifyOrderCancellation).not.toHaveBeenCalled();
    expect(app.log.info).toHaveBeenCalledWith(
      expect.objectContaining({
        topic: 'orders/cancelled',
        sourceShopifyOrderId: '1104',
        financialStatus: 'voided',
      }),
      'Shopify order cancellation bridge ignored a webhook because canonical cancelledAt was empty.',
    );
    expect(result).toMatchObject({
      status: 202,
      body: {
        action: 'canonical_cancellation_ignored',
        processingStatus: 'processed',
        cancellationProcessed: false,
        reason: 'canonical_cancelled_at_missing',
      },
    });
  });

  it('keeps repeated orders-cancelled webhook deliveries idempotent', async () => {
    webhookIdempotencyMock.getOrCreateWebhookEvent.mockResolvedValueOnce({
      isDuplicate: true,
      event: {
        id: 'webhook-event-duplicate',
        payloadHash: 'payload-hash',
      },
    });
    const { routes } = registerRoutes();
    const handler = routes.get('/webhooks/shopify/orders-cancelled');

    const result = await handler?.(buildWebhookRequest({
      topic: 'orders/cancelled',
      payload: {
        id: 1104,
        cancelled_at: '2026-07-08T10:00:00.000Z',
      },
    }), buildReply());

    expect(shopifyAdminMock.fetchCanonicalOrderSnapshot).not.toHaveBeenCalled();
    expect(cancellationReconciliationMock.reconcileShopifyOrderCancellation).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: 202,
      body: {
        ok: true,
        duplicate: true,
        action: 'duplicate_ignored',
        topic: 'orders/cancelled',
      },
    });
  });

  it('uses orders-updated as a cancellation fallback when cancelled_at is present and preserves address updates', async () => {
    webhookIdempotencyMock.getOrCreateWebhookEvent.mockResolvedValueOnce({
      isDuplicate: false,
      event: {
        id: 'webhook-event-updated-cancelled',
        payloadHash: 'updated-payload-hash',
        topic: 'orders/updated',
        receivedAt: new Date('2026-07-08T10:00:00.000Z'),
      },
    });
    const { routes } = registerRoutes();
    const handler = routes.get('/webhooks/shopify/orders-updated');
    const payload = {
      id: 1104,
      cancelled_at: '2026-07-08T10:00:00.000Z',
      shipping_address: {
        address1: 'Updated address',
      },
    };

    const result = await handler?.(buildWebhookRequest({
      topic: 'orders/updated',
      webhookId: 'orders-updated-cancelled-webhook-id',
      payload,
    }), buildReply());

    expect(orderIngestionMock.updateShopifyOrderContactAddressSnapshotFromWebhook).toHaveBeenCalledWith(payload);
    expect(returnSignalDiscoveryMock.recordShopifyReturnSignalDiscovery).toHaveBeenCalledWith(expect.objectContaining({
      topic: 'orders/updated',
      markProcessed: false,
    }));
    expect(shopifyAdminMock.fetchCanonicalOrderSnapshot).toHaveBeenCalledWith('1104');
    expect(cancellationReconciliationMock.reconcileShopifyOrderCancellation).toHaveBeenCalledWith('1104');
    expect(result).toMatchObject({
      status: 202,
      body: {
        topic: 'orders/updated',
        action: 'canonical_cancellation_reconciled',
        addressContactSnapshotUpdated: true,
        changedFields: ['shippingAddress'],
      },
    });
  });

  it('keeps orders-updated contact/address behavior when cancelled_at is absent', async () => {
    webhookIdempotencyMock.getOrCreateWebhookEvent.mockResolvedValueOnce({
      isDuplicate: false,
      event: {
        id: 'webhook-event-updated',
        payloadHash: 'updated-payload-hash',
        topic: 'orders/updated',
        receivedAt: new Date('2026-07-08T10:00:00.000Z'),
      },
    });
    const { routes } = registerRoutes();
    const handler = routes.get('/webhooks/shopify/orders-updated');

    const result = await handler?.(buildWebhookRequest({
      topic: 'orders/updated',
      payload: {
        id: 1104,
        shipping_address: {
          address1: 'Updated address',
        },
      },
    }), buildReply());

    expect(orderIngestionMock.updateShopifyOrderContactAddressSnapshotFromWebhook).toHaveBeenCalled();
    expect(returnSignalDiscoveryMock.recordShopifyReturnSignalDiscovery).toHaveBeenCalledWith(expect.objectContaining({
      topic: 'orders/updated',
      markProcessed: true,
    }));
    expect(shopifyAdminMock.fetchCanonicalOrderSnapshot).not.toHaveBeenCalled();
    expect(cancellationReconciliationMock.reconcileShopifyOrderCancellation).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: 202,
      body: {
        action: 'return_signal_discovery_recorded',
        processingStatus: 'processed',
      },
    });
  });

  it('does not treat financial_status voided without cancelled_at as a full cancellation', async () => {
    webhookIdempotencyMock.getOrCreateWebhookEvent.mockResolvedValueOnce({
      isDuplicate: false,
      event: {
        id: 'webhook-event-updated-voided',
        payloadHash: 'updated-payload-hash',
        topic: 'orders/updated',
        receivedAt: new Date('2026-07-08T10:00:00.000Z'),
      },
    });
    const { routes } = registerRoutes();
    const handler = routes.get('/webhooks/shopify/orders-updated');

    await handler?.(buildWebhookRequest({
      topic: 'orders/updated',
      payload: {
        id: 1104,
        financial_status: 'voided',
      },
    }), buildReply());

    expect(shopifyAdminMock.fetchCanonicalOrderSnapshot).not.toHaveBeenCalled();
    expect(cancellationReconciliationMock.reconcileShopifyOrderCancellation).not.toHaveBeenCalled();
  });

  it('leaves fulfillment-orders-cancelled behavior on the fulfillment ingestion path', async () => {
    webhookIdempotencyMock.getOrCreateWebhookEvent.mockResolvedValueOnce({
      isDuplicate: false,
      event: {
        id: 'webhook-event-fulfillment-cancelled',
        payloadHash: 'fulfillment-payload-hash',
        topic: 'fulfillment_orders/cancelled',
        receivedAt: new Date('2026-07-08T10:00:00.000Z'),
      },
    });
    const { routes } = registerRoutes();
    const handler = routes.get('/webhooks/shopify/fulfillment-orders-cancelled');

    const result = await handler?.(buildWebhookRequest({
      topic: 'fulfillment_orders/cancelled',
      payload: {
        id: 991,
        order_id: 1104,
      },
    }), buildReply());

    expect(fulfillmentIngestionMock.ingestFulfillmentWebhook).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      topic: 'fulfillment_orders/cancelled',
    }));
    expect(cancellationReconciliationMock.reconcileShopifyOrderCancellation).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: 202,
      body: {
        topic: 'fulfillment_orders/cancelled',
        action: 'fulfilled_synced',
      },
    });
  });

  it('verifies a positive refunds/create event against canonical transaction evidence', async () => {
    const { routes } = registerRoutes();
    const handler = routes.get('/webhooks/shopify/refunds-create');
    const payload = {
      id: 5001,
      order_id: 1105,
      refund_line_items: [{ id: 6001, quantity: 1, subtotal: '100.00' }],
    };

    const result = await handler?.(buildWebhookRequest({
      topic: 'refunds/create',
      payload,
    }), buildReply());

    expect(shopifyAdminMock.fetchCanonicalRefundsForOrder).toHaveBeenCalledWith('1105');
    expect(refundIngestionMock.ingestVerifiedShopifyRefund).toHaveBeenCalledWith(expect.objectContaining({
      payload,
      monetaryEvidence: expect.objectContaining({
        classification: 'MONETARY_REFUND',
        monetaryRefundAmount: '100',
      }),
    }));
    expect(result).toMatchObject({
      status: 202,
      body: { action: 'accepted', processingStatus: 'processed', refundAllocationCount: 1 },
    });
  });

  it('completes the REFUND_SYNC job when verified shipping-only ingestion succeeds', async () => {
    refundIngestionMock.ingestVerifiedShopifyRefund.mockResolvedValueOnce({
      ok: true,
      action: 'accepted',
      processingStatus: 'processed',
      shopifyOrderId: '1105',
      refundAllocationCount: 0,
    });
    const { routes } = registerRoutes();
    const handler = routes.get('/webhooks/shopify/refunds-create');
    const payload = { id: 5001, order_id: 1105, refund_line_items: [] };

    const result = await handler?.(buildWebhookRequest({
      topic: 'refunds/create',
      payload,
    }), buildReply());

    expect(refundIngestionMock.ingestVerifiedShopifyRefund).toHaveBeenCalledWith(expect.objectContaining({
      payload,
      monetaryEvidence: expect.objectContaining({ classification: 'MONETARY_REFUND' }),
    }));
    expect(operationalJobsMock.createWebhookOperationalJob).toHaveBeenCalledWith(expect.objectContaining({
      topic: 'refunds/create',
      sourceShopifyOrderId: '1105',
    }));
    expect(operationalJobsMock.markOperationalJobFailed).not.toHaveBeenCalled();
    expect(operationalJobsMock.markOperationalJobCompleted).toHaveBeenCalledWith('operational-job-cancelled');
    expect(result).toMatchObject({
      status: 202,
      body: {
        action: 'accepted',
        processingStatus: 'processed',
        refundAllocationCount: 0,
      },
    });
  });

  it('processes a zero-value void without invoking refund ingestion', async () => {
    shopifyAdminMock.fetchCanonicalRefundsForOrder.mockResolvedValueOnce(canonicalRefunds('VOID', '0.00'));
    const { routes } = registerRoutes();
    const handler = routes.get('/webhooks/shopify/refunds-create');

    const result = await handler?.(buildWebhookRequest({
      topic: 'refunds/create',
      payload: { id: 5001, order_id: 1105, refund_line_items: [] },
    }), buildReply());

    expect(refundIngestionMock.ingestVerifiedShopifyRefund).not.toHaveBeenCalled();
    expect(operationalJobsMock.markOperationalJobCompleted).toHaveBeenCalled();
    expect(result).toMatchObject({
      status: 202,
      body: {
        processingStatus: 'processed',
        refundAllocationCount: 0,
        refundClassification: 'ZERO_VALUE_VOID',
        reasonCode: 'zero_value_void_not_monetary_refund',
      },
    });
  });

  it('fails closed when canonical refund verification is unavailable', async () => {
    shopifyAdminMock.fetchCanonicalRefundsForOrder.mockRejectedValueOnce(new Error('upstream detail'));
    const { routes } = registerRoutes();
    const handler = routes.get('/webhooks/shopify/refunds-create');

    const result = await handler?.(buildWebhookRequest({
      topic: 'refunds/create',
      payload: { id: 5001, order_id: 1105, refund_line_items: [] },
    }), buildReply());

    expect(refundIngestionMock.ingestVerifiedShopifyRefund).not.toHaveBeenCalled();
    expect(operationalJobsMock.markOperationalJobFailed).toHaveBeenCalled();
    expect(result).toMatchObject({
      status: 202,
      body: {
        action: 'received_needs_attention',
        processingStatus: 'needs_attention',
        message: 'Canonical Shopify refund evidence is unavailable.',
      },
    });
  });
});
