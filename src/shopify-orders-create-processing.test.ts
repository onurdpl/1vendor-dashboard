import { beforeEach, describe, expect, it, vi } from 'vitest';

const ingestionMock = vi.hoisted(() => ({
  classifyOrderIngestionException: vi.fn(),
  ingestShopifyOrderWebhook: vi.fn(),
}));
const sellerRetryMock = vi.hoisted(() => ({
  fetchSellerInfoWithRetry: vi.fn(),
}));

vi.mock('../backend/src/modules/shopify/order-ingestion.service.js', () => ingestionMock);
vi.mock('../backend/src/modules/shopify/seller-info-retry.service.js', () => sellerRetryMock);

const {
  __ordersCreateProcessingTesting,
  createOrdersCreateProcessingService,
  prepareOrdersCreatePayload,
} = await import('../backend/src/modules/shopify/orders-create-processing.service.js');

function event(overrides: Record<string, unknown> = {}) {
  return {
    id: 'event-1',
    rawPayload: JSON.stringify({ id: 2001, line_items: [{ id: 3001, sku: 'SKU-1' }] }),
    payloadHash: 'payload-hash',
    ...overrides,
  } as never;
}

function createService(
  overrides: Record<string, unknown> = {},
  options: { propagateProcessingExceptions?: boolean } = {},
) {
  const admin = {
    fetchOrderSellerInfo: vi.fn(),
    fetchOrderLineItemImages: vi.fn().mockResolvedValue({ lineItems: [] }),
    fetchOrderTaxSnapshot: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
  const logger = { warn: vi.fn() };
  return {
    admin,
    logger,
    service: createOrdersCreateProcessingService({
      env: { SHOPIFY_SELLER_INFO_RETRY_DELAY_MS: 2_000 } as never,
      shopifyAdminService: admin as never,
      logger,
      propagateProcessingExceptions: options.propagateProcessingExceptions,
    }),
  };
}

describe('orders/create reusable processing service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sellerRetryMock.fetchSellerInfoWithRetry.mockResolvedValue({
      ok: true,
      sellerInfo: { 'SKU-1': 'sporjinal' },
      attempts: 1,
      source: 'shopify_admin',
    });
    ingestionMock.ingestShopifyOrderWebhook.mockResolvedValue({
      ok: true,
      action: 'accepted',
      processingStatus: 'processed',
      shopifyOrderId: '2001',
      allocationCount: 1,
    });
  });

  it('owns retained-payload parsing without changing missing-order-only mode', () => {
    expect(prepareOrdersCreatePayload({
      event: event(),
      incomingPayload: { id: 9999 },
      retainedSnapshotMode: true,
    })).toMatchObject({
      ok: true,
      payload: { id: 2001 },
      sourceShopifyOrderId: '2001',
      mode: 'missing_order_only',
    });
  });

  it('returns the existing retained evidence failures without processing', () => {
    expect(prepareOrdersCreatePayload({
      event: event({ rawPayload: null }),
      incomingPayload: { id: 2001 },
      retainedSnapshotMode: true,
    })).toEqual({
      ok: false,
      message: 'Retained webhook payload evidence is unavailable for automatic retry.',
    });
    expect(prepareOrdersCreatePayload({
      event: event({ rawPayload: '{invalid' }),
      incomingPayload: { id: 2001 },
      retainedSnapshotMode: true,
    })).toEqual({
      ok: false,
      message: 'Retained webhook payload is not valid JSON.',
    });
  });

  it('performs seller mapping, enrichment, and ingestion through one service', async () => {
    const { admin, service } = createService();
    const payload = { id: 2001, line_items: [{ id: 3001, sku: 'SKU-1' }] };

    await expect(service.process({ event: event(), payload, mode: 'upsert' })).resolves.toMatchObject({ ok: true });

    expect(sellerRetryMock.fetchSellerInfoWithRetry).toHaveBeenCalledWith(expect.objectContaining({
      orderId: '2001',
      delayMs: 2_000,
      fetchSellerInfo: admin.fetchOrderSellerInfo,
    }));
    expect(ingestionMock.ingestShopifyOrderWebhook).toHaveBeenCalledWith({
      event: event(),
      payload,
      sellerInfo: { 'SKU-1': 'sporjinal' },
      lineItemImages: [],
      taxSnapshot: null,
      mode: 'upsert',
      executionContext: undefined,
    });
    expect(admin.fetchOrderLineItemImages).toHaveBeenCalledWith('2001');
    expect(admin.fetchOrderTaxSnapshot).toHaveBeenCalledWith('2001');
  });

  it('bounds only executor-owned seller, image, and tax Admin requests', async () => {
    const { admin, service } = createService();
    sellerRetryMock.fetchSellerInfoWithRetry.mockImplementationOnce(async (input: {
      fetchSellerInfo: (orderId: string) => Promise<unknown>;
    }) => {
      await input.fetchSellerInfo('2001');
      return {
        ok: true,
        sellerInfo: { 'SKU-1': 'sporjinal' },
        attempts: 1,
        source: 'shopify_admin',
      };
    });
    admin.fetchOrderSellerInfo.mockResolvedValue({ sellerInfo: { 'SKU-1': 'sporjinal' }, source: 'shopify_admin' });
    const controller = new AbortController();

    await service.process({
      event: event(),
      payload: { id: 2001 },
      mode: 'missing_order_only',
      executionContext: {
        webhookEventId: 'event-1',
        processingGeneration: 1,
        sourceShopifyOrderId: '2001',
        signal: controller.signal,
        shopifyAdminRequestTimeoutMs: 30_000,
      },
    });

    for (const request of [
      admin.fetchOrderSellerInfo,
      admin.fetchOrderLineItemImages,
      admin.fetchOrderTaxSnapshot,
    ]) {
      expect(request).toHaveBeenCalledWith('2001', { signal: expect.any(AbortSignal) });
      expect(request.mock.calls[0]?.[1]?.signal).not.toBe(controller.signal);
    }
  });

  it('aborts an executor Admin request at its ownership-derived deadline', async () => {
    vi.useFakeTimers();
    let requestSignal: AbortSignal | undefined;
    const request = __ordersCreateProcessingTesting.withShopifyAdminRequestDeadline({
      parentSignal: new AbortController().signal,
      timeoutMs: 30_000,
      request: (signal) => {
        requestSignal = signal;
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
      },
    });
    const rejection = expect(request).rejects.toMatchObject({ code: 'ETIMEDOUT' });

    await vi.advanceTimersByTimeAsync(30_000);
    await rejection;
    expect(requestSignal?.aborted).toBe(true);
    vi.useRealTimers();
  });

  it('preserves image and tax enrichment fallback behavior', async () => {
    const { logger, service } = createService({
      fetchOrderLineItemImages: vi.fn().mockRejectedValue(new Error('image unavailable')),
      fetchOrderTaxSnapshot: vi.fn().mockRejectedValue(new Error('tax unavailable')),
    });

    await service.process({ event: event(), payload: { id: 2001 }, mode: 'upsert' });

    expect(ingestionMock.ingestShopifyOrderWebhook).toHaveBeenCalledWith(expect.objectContaining({
      lineItemImages: [],
      taxSnapshot: null,
    }));
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });

  it('preserves seller_info exhaustion as a retryable structured failure', async () => {
    sellerRetryMock.fetchSellerInfoWithRetry.mockResolvedValueOnce({
      ok: false,
      error: 'Shopify seller_info metafield was missing or empty after retry attempts.',
      attempts: 3,
      source: 'shopify_admin',
    });
    const { service } = createService();

    await expect(service.process({ event: event(), payload: { id: 2001 }, mode: 'upsert' })).resolves.toMatchObject({
      ok: false,
      failureCode: 'seller_info_unavailable',
      failureDisposition: 'RETRYABLE',
      retryable: true,
    });
    expect(ingestionMock.ingestShopifyOrderWebhook).not.toHaveBeenCalled();
  });

  it('can preserve explicit admin recovery exception propagation', async () => {
    sellerRetryMock.fetchSellerInfoWithRetry.mockRejectedValueOnce(new Error('Shopify Admin unavailable'));
    const { service } = createService({}, { propagateProcessingExceptions: true });

    await expect(
      service.process({ event: event(), payload: { id: 2001 }, mode: 'missing_order_only' }),
    ).rejects.toThrow('Shopify Admin unavailable');
    expect(ingestionMock.ingestShopifyOrderWebhook).not.toHaveBeenCalled();
  });
});
