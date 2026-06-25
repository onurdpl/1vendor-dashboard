import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';

const prismaMock = vi.hoisted(() => ({
  vendorAllocation: {
    findUnique: vi.fn(),
  },
  productPanelVariantDisableOutboxEvent: {
    findMany: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
  },
  operationalSignal: {
    updateMany: vi.fn(),
    upsert: vi.fn(),
  },
}));

vi.mock('../backend/src/db/prisma.js', () => ({
  prisma: prismaMock,
}));

const {
  enqueueProductPanelVariantDisableEventsForRejectedAllocation,
  sendProductPanelVariantDisableDryRunEvents,
  sendProductPanelVariantDisableDryRunEventsForOrder,
  shouldQueueProductPanelVariantDisableEvent,
} = await import('../backend/src/modules/product-panel/product-panel-variant-disable-outbox.service.js');

function buildAllocation() {
  return {
    id: 'alloc-1099',
    assignedVendorId: 'yalispor',
    assignedVendor: {
      id: 'yalispor',
      name: 'Yalı Spor',
    },
    order: {
      sourceShopifyOrderId: 'gid://shopify/Order/1099',
      sourceShopifyOrderNumber: '#1099',
    },
    lineItems: [
      {
        id: 'alloc-line-1',
        quantity: 2,
        shopifyOrderLineItem: {
          sourceLineItemId: 'shopify-line-1',
          sourceVariantId: 'gid://shopify/ProductVariant/111',
          sku: 'SKU-42',
        },
      },
    ],
  };
}

function buildOutboxEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'event-1',
    allocationId: 'alloc-1099',
    vendorAllocationLineItemId: 'alloc-line-1',
    shopifyVariantId: 'gid://shopify/ProductVariant/111',
    shopifyLineItemId: 'shopify-line-1',
    variantSku: 'SKU-42',
    vendorId: 'yalispor',
    vendorName: 'Yalı Spor',
    shopifyOrderId: 'gid://shopify/Order/1099',
    shopifyOrderName: '#1099',
    reasonCode: 'OUT_OF_STOCK',
    reasonText: 'Out of stock',
    quantity: 2,
    requestedAt: new Date('2026-06-25T10:00:00.000Z'),
    environment: 'test',
    dryRun: true,
    attemptCount: 0,
    status: 'CREATED',
    error: null,
    idempotencyKey: 'product-panel-variant-disable:alloc-1099:alloc-line-1:OUT_OF_STOCK',
    requestPayloadJson: null,
    responseJson: null,
    resolvedAt: null,
    failedAt: null,
    createdAt: new Date('2026-06-25T10:00:00.000Z'),
    updatedAt: new Date('2026-06-25T10:00:00.000Z'),
    ...overrides,
  };
}

function buildEnv(overrides: Record<string, unknown> = {}) {
  return {
    NODE_ENV: 'test',
    PRODUCT_PANEL_BASE_URL: 'https://product-panel.example',
    PRODUCT_PANEL_VARIANT_DISABLE_ENABLED: true,
    PRODUCT_PANEL_VARIANT_DISABLE_DRY_RUN: true,
    PRODUCT_PANEL_HMAC_SECRET: 'test-product-panel-secret',
    ...overrides,
  };
}

describe('Product Panel variant disable outbox', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.productPanelVariantDisableOutboxEvent.upsert.mockImplementation(async ({ create }) => ({
      id: 'event-1',
      ...create,
    }));
    prismaMock.productPanelVariantDisableOutboxEvent.update.mockImplementation(async ({ data }) => ({
      ...buildOutboxEvent(),
      ...data,
    }));
    prismaMock.operationalSignal.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.operationalSignal.upsert.mockResolvedValue({});
  });

  it('queues outbox events only for OUT_OF_STOCK', () => {
    expect(shouldQueueProductPanelVariantDisableEvent('OUT_OF_STOCK')).toBe(true);
    expect(shouldQueueProductPanelVariantDisableEvent('FULFILLMENT_ISSUE')).toBe(false);
    expect(shouldQueueProductPanelVariantDisableEvent('VENDOR_CANCELLED')).toBe(false);
    expect(shouldQueueProductPanelVariantDisableEvent('DAMAGED_INVENTORY')).toBe(false);
  });

  it('creates an allocation line scoped outbox event for OUT_OF_STOCK', async () => {
    prismaMock.vendorAllocation.findUnique.mockResolvedValueOnce(buildAllocation());

    const events = await enqueueProductPanelVariantDisableEventsForRejectedAllocation({
      allocationId: 'alloc-1099',
      reasonCode: 'OUT_OF_STOCK',
      reasonText: 'Out of stock',
      requestedAt: new Date('2026-06-25T10:00:00.000Z'),
      environment: 'test',
    });

    expect(events).toHaveLength(1);
    expect(prismaMock.productPanelVariantDisableOutboxEvent.upsert).toHaveBeenCalledWith({
      where: {
        idempotencyKey: 'product-panel-variant-disable:alloc-1099:alloc-line-1:OUT_OF_STOCK',
      },
      create: expect.objectContaining({
        allocationId: 'alloc-1099',
        vendorAllocationLineItemId: 'alloc-line-1',
        shopifyVariantId: 'gid://shopify/ProductVariant/111',
        shopifyLineItemId: 'shopify-line-1',
        variantSku: 'SKU-42',
        vendorId: 'yalispor',
        vendorName: 'Yalı Spor',
        shopifyOrderId: 'gid://shopify/Order/1099',
        shopifyOrderName: '#1099',
        reasonCode: 'OUT_OF_STOCK',
        reasonText: 'Out of stock',
        quantity: 2,
        environment: 'test',
        dryRun: true,
        status: 'CREATED',
      }),
      update: expect.objectContaining({
        shopifyVariantId: 'gid://shopify/ProductVariant/111',
        reasonText: 'Out of stock',
        quantity: 2,
      }),
    });
  });

  it('does not enqueue for non-stock reasons', async () => {
    const events = await enqueueProductPanelVariantDisableEventsForRejectedAllocation({
      allocationId: 'alloc-1099',
      reasonCode: 'VENDOR_CANCELLED',
      reasonText: 'Vendor cancelled',
    });

    expect(events).toEqual([]);
    expect(prismaMock.vendorAllocation.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.productPanelVariantDisableOutboxEvent.upsert).not.toHaveBeenCalled();
  });

  it('does not send HTTP when the feature flag is disabled', async () => {
    const fetchImpl = vi.fn();

    const result = await sendProductPanelVariantDisableDryRunEvents(
      buildEnv({ PRODUCT_PANEL_VARIANT_DISABLE_ENABLED: false }),
      { fetchImpl },
    );

    expect(result.disabled).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(prismaMock.productPanelVariantDisableOutboxEvent.findMany).not.toHaveBeenCalled();
  });

  it('sends the dry-run payload and signed headers when enabled', async () => {
    const event = buildOutboxEvent();
    prismaMock.productPanelVariantDisableOutboxEvent.findMany.mockResolvedValueOnce([event]);
    const fetchImpl = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 202,
      text: async () =>
        JSON.stringify({
          accepted: true,
          dryRun: true,
          canResolve: true,
          parentSku: 'PARENT-1',
          normalizedSize: '42',
          sizeKey: '42',
          resolutionMethod: 'shopify_variant_metafield',
          confidence: 'high',
          writesPerformed: false,
        }),
    });

    const result = await sendProductPanelVariantDisableDryRunEvents(buildEnv(), { fetchImpl });

    expect(result).toMatchObject({ processed: 1, resolved: 1, failed: 0 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, request] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe('https://product-panel.example/internal/availability/disable-variant');
    expect(request.headers).toEqual(
      expect.objectContaining({
        'Content-Type': 'application/json',
        'Idempotency-Key': event.idempotencyKey,
        'X-Sporgym-Timestamp': expect.stringMatching(/^\d+$/),
        'X-Sporgym-Nonce': expect.any(String),
        'X-Sporgym-Signature': expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(request.headers).not.toHaveProperty('X-Product-Panel-Timestamp');
    expect(request.headers).not.toHaveProperty('X-Product-Panel-Nonce');
    expect(request.headers).not.toHaveProperty('X-Product-Panel-Signature');
    const timestamp = request.headers['X-Sporgym-Timestamp'];
    expect(Number(timestamp)).toBeLessThanOrEqual(Math.floor(Date.now() / 1000));
    expect(Number(timestamp)).toBeGreaterThan(Math.floor(Date.now() / 1000) - 10);
    const expectedBody = JSON.stringify({
      shopifyVariantId: 'gid://shopify/ProductVariant/111',
      variantSku: 'SKU-42',
      shopifyLineItemId: 'shopify-line-1',
      allocationId: 'alloc-1099',
      vendorId: 'yalispor',
      vendorName: 'Yalı Spor',
      sourceOrderId: 'gid://shopify/Order/1099',
      sourceOrderName: '#1099',
      reasonCode: 'OUT_OF_STOCK',
      reasonText: 'Out of stock',
      quantity: 2,
      requestedAt: '2026-06-25T10:00:00.000Z',
      environment: 'test',
      sourceSystem: 'vendor_allocation_panel',
      sourceEventType: 'vendor_allocation_rejected',
      sourceStatus: 'vendor_reported',
      dryRun: true,
    });
    expect(request.body).toBe(expectedBody);
    const expectedSignature = createHmac('sha256', 'test-product-panel-secret')
      .update(`${timestamp}\n${request.headers['X-Sporgym-Nonce']}\n${event.idempotencyKey}\n${expectedBody}`)
      .digest('hex');
    expect(request.headers['X-Sporgym-Signature']).toBe(expectedSignature);
    expect(JSON.parse(request.body)).toEqual({
      shopifyVariantId: 'gid://shopify/ProductVariant/111',
      variantSku: 'SKU-42',
      shopifyLineItemId: 'shopify-line-1',
      allocationId: 'alloc-1099',
      vendorId: 'yalispor',
      vendorName: 'Yalı Spor',
      sourceOrderId: 'gid://shopify/Order/1099',
      sourceOrderName: '#1099',
      reasonCode: 'OUT_OF_STOCK',
      reasonText: 'Out of stock',
      quantity: 2,
      requestedAt: '2026-06-25T10:00:00.000Z',
      environment: 'test',
      sourceSystem: 'vendor_allocation_panel',
      sourceEventType: 'vendor_allocation_rejected',
      sourceStatus: 'vendor_reported',
      dryRun: true,
    });
    expect(prismaMock.productPanelVariantDisableOutboxEvent.update).toHaveBeenCalledWith({
      where: { id: 'event-1' },
      data: expect.objectContaining({
        status: 'RESOLVED_DRY_RUN',
        dryRun: true,
        attemptCount: 1,
        error: null,
        responseJson: expect.objectContaining({
          accepted: true,
          dryRun: true,
          parentSku: 'PARENT-1',
          writesPerformed: false,
        }),
      }),
    });
  });

  it('stores Product Panel 401 auth response details', async () => {
    const event = buildOutboxEvent();
    prismaMock.productPanelVariantDisableOutboxEvent.findMany.mockResolvedValueOnce([event]);
    const fetchImpl = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () =>
        JSON.stringify({
          error: 'unauthorized',
          message: 'Invalid HMAC signature.',
          missingHeaders: ['X-Sporgym-Signature'],
        }),
    });

    const result = await sendProductPanelVariantDisableDryRunEvents(buildEnv(), { fetchImpl });

    expect(result).toMatchObject({ processed: 1, resolved: 0, failed: 1 });
    expect(prismaMock.productPanelVariantDisableOutboxEvent.update).toHaveBeenCalledWith({
      where: { id: 'event-1' },
      data: expect.objectContaining({
        status: 'FAILED',
        dryRun: true,
        error: 'Product Panel variant disable dry-run failed with status 401.',
        responseJson: expect.objectContaining({
          error: 'unauthorized',
          message: 'Invalid HMAC signature.',
          missingHeaders: ['X-Sporgym-Signature'],
        }),
      }),
    });
  });

  it('stores dry-run failures and raises an admin integration warning', async () => {
    const event = buildOutboxEvent();
    prismaMock.productPanelVariantDisableOutboxEvent.findMany.mockResolvedValueOnce([event]);
    const fetchImpl = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 422,
      text: async () =>
        JSON.stringify({
          accepted: false,
          dryRun: true,
          canResolve: false,
          error: 'Missing custom.main_sku',
          writesPerformed: false,
        }),
    });

    const result = await sendProductPanelVariantDisableDryRunEvents(buildEnv(), { fetchImpl });

    expect(result).toMatchObject({ processed: 1, resolved: 0, failed: 1 });
    expect(prismaMock.productPanelVariantDisableOutboxEvent.update).toHaveBeenCalledWith({
      where: { id: 'event-1' },
      data: expect.objectContaining({
        status: 'FAILED',
        dryRun: true,
        attemptCount: 1,
        error: 'Product Panel variant disable dry-run failed with status 422.',
        responseJson: expect.objectContaining({
          canResolve: false,
          error: 'Missing custom.main_sku',
        }),
      }),
    });
    expect(prismaMock.operationalSignal.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          title: 'Product Panel variant disable failed',
          sourceArea: 'DIAGNOSTICS',
          vendorId: 'yalispor',
          allocationId: 'alloc-1099',
        }),
      }),
    );
  });

  it('manually sends queued and failed retryable OUT_OF_STOCK dry-run events for one order', async () => {
    const failedEvent = buildOutboxEvent({
      id: 'event-failed',
      status: 'FAILED',
      attemptCount: 1,
      error: 'Previous Product Panel timeout.',
    });
    const resolvedEvent = buildOutboxEvent({
      id: 'event-failed',
      status: 'RESOLVED_DRY_RUN',
      attemptCount: 2,
      error: null,
      resolvedAt: new Date('2026-06-25T10:01:00.000Z'),
        responseJson: {
          accepted: true,
          dryRun: true,
          canResolve: true,
          writesPerformed: false,
        },
    });
    prismaMock.productPanelVariantDisableOutboxEvent.findMany
      .mockResolvedValueOnce([failedEvent])
      .mockResolvedValueOnce([failedEvent])
      .mockResolvedValueOnce([resolvedEvent]);
    const fetchImpl = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 202,
      text: async () =>
        JSON.stringify({
          accepted: true,
          dryRun: true,
          canResolve: true,
          writesPerformed: false,
        }),
    });

    const result = await sendProductPanelVariantDisableDryRunEventsForOrder(buildEnv(), {
      shopifyOrderId: 'gid://shopify/Order/1099',
      fetchImpl,
    });

    expect(result).toMatchObject({
      ok: true,
      attempted: 1,
      resolved: 1,
      failed: 0,
      skipped: 0,
      latestEventStatuses: [
        expect.objectContaining({
          id: 'event-failed',
          status: 'RESOLVED_DRY_RUN',
        response: expect.objectContaining({
          accepted: true,
          dryRun: true,
          writesPerformed: false,
        }),
        }),
      ],
    });
    expect(prismaMock.productPanelVariantDisableOutboxEvent.findMany).toHaveBeenNthCalledWith(1, {
      where: {
        shopifyOrderId: 'gid://shopify/Order/1099',
        reasonCode: 'OUT_OF_STOCK',
        status: {
          in: ['CREATED', 'FAILED'],
        },
      },
      orderBy: {
        requestedAt: 'asc',
      },
      take: 25,
    });
    expect(prismaMock.productPanelVariantDisableOutboxEvent.findMany).toHaveBeenNthCalledWith(2, {
      where: {
        status: {
          in: ['CREATED', 'FAILED'],
        },
        id: {
          in: ['event-failed'],
        },
      },
      orderBy: {
        requestedAt: 'asc',
      },
      take: 1,
    });
    expect(prismaMock.productPanelVariantDisableOutboxEvent.upsert).not.toHaveBeenCalled();
  });

  it('does not send non-OUT_OF_STOCK events from the manual order action', async () => {
    prismaMock.productPanelVariantDisableOutboxEvent.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const fetchImpl = vi.fn();

    const result = await sendProductPanelVariantDisableDryRunEventsForOrder(buildEnv(), {
      shopifyOrderId: 'gid://shopify/Order/1099',
      fetchImpl,
    });

    expect(result).toMatchObject({ attempted: 0, resolved: 0, failed: 0, skipped: 0 });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(prismaMock.productPanelVariantDisableOutboxEvent.findMany).toHaveBeenNthCalledWith(1, {
      where: expect.objectContaining({
        shopifyOrderId: 'gid://shopify/Order/1099',
        reasonCode: 'OUT_OF_STOCK',
      }),
      orderBy: {
        requestedAt: 'asc',
      },
      take: 25,
    });
  });

  it('sends real variant-disable payload when dry-run mode is explicitly disabled', async () => {
    const event = buildOutboxEvent({ dryRun: true });
    prismaMock.productPanelVariantDisableOutboxEvent.findMany.mockResolvedValueOnce([event]);
    const fetchImpl = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 201,
      text: async () =>
        JSON.stringify({
          accepted: true,
          dryRun: false,
          canResolve: true,
          created: true,
          duplicate: false,
          ruleId: 'rule-123',
          parentSku: 'PARENT-1',
          normalizedSize: '42',
          writesPerformed: true,
        }),
    });

    const result = await sendProductPanelVariantDisableDryRunEvents(
      buildEnv({ PRODUCT_PANEL_VARIANT_DISABLE_DRY_RUN: false }),
      { fetchImpl },
    );

    expect(result).toMatchObject({ processed: 1, resolved: 1, failed: 0 });
    const [, request] = fetchImpl.mock.calls[0];
    expect(JSON.parse(request.body)).toEqual(
      expect.objectContaining({
        dryRun: false,
        shopifyVariantId: 'gid://shopify/ProductVariant/111',
      }),
    );
    expect(prismaMock.productPanelVariantDisableOutboxEvent.update).toHaveBeenCalledWith({
      where: { id: 'event-1' },
      data: expect.objectContaining({
        status: 'RESOLVED',
        dryRun: false,
        error: null,
        responseJson: expect.objectContaining({
          accepted: true,
          canResolve: true,
          created: true,
          duplicate: false,
          ruleId: 'rule-123',
          parentSku: 'PARENT-1',
          normalizedSize: '42',
          writesPerformed: true,
        }),
      }),
    });
  });

  it('accepts duplicate active rules in real variant-disable mode', async () => {
    const event = buildOutboxEvent({ dryRun: true });
    prismaMock.productPanelVariantDisableOutboxEvent.findMany.mockResolvedValueOnce([event]);
    const fetchImpl = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          accepted: true,
          dryRun: false,
          canResolve: true,
          created: false,
          duplicate: true,
          ruleId: 'rule-existing',
          parentSku: 'PARENT-1',
          normalizedSize: '42',
          writesPerformed: false,
        }),
    });

    const result = await sendProductPanelVariantDisableDryRunEvents(
      buildEnv({ PRODUCT_PANEL_VARIANT_DISABLE_DRY_RUN: false }),
      { fetchImpl },
    );

    expect(result).toMatchObject({ processed: 1, resolved: 1, failed: 0 });
    expect(prismaMock.productPanelVariantDisableOutboxEvent.update).toHaveBeenCalledWith({
      where: { id: 'event-1' },
      data: expect.objectContaining({
        status: 'RESOLVED',
        dryRun: false,
        error: null,
        responseJson: expect.objectContaining({
          accepted: true,
          canResolve: true,
          created: false,
          duplicate: true,
          ruleId: 'rule-existing',
          writesPerformed: false,
        }),
      }),
    });
  });

  it('treats accepted writable real responses as resolved even when created is false', async () => {
    const event = buildOutboxEvent({ dryRun: true, status: 'FAILED', error: 'Product Panel variant disable failed with status 200.' });
    prismaMock.productPanelVariantDisableOutboxEvent.findMany.mockResolvedValueOnce([event]);
    const fetchImpl = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          accepted: true,
          dryRun: false,
          canResolve: true,
          writesPerformed: true,
          created: false,
          duplicate: true,
          ruleId: 'rule-accepted',
          parentSku: 'PARENT-1',
          normalizedSize: '42',
        }),
    });

    const result = await sendProductPanelVariantDisableDryRunEvents(
      buildEnv({ PRODUCT_PANEL_VARIANT_DISABLE_DRY_RUN: false }),
      {
        statuses: ['CREATED', 'FAILED'] as never,
        fetchImpl,
      },
    );

    expect(result).toMatchObject({ processed: 1, resolved: 1, failed: 0 });
    expect(prismaMock.productPanelVariantDisableOutboxEvent.update).toHaveBeenCalledWith({
      where: { id: 'event-1' },
      data: expect.objectContaining({
        status: 'RESOLVED',
        dryRun: false,
        error: null,
        failedAt: null,
        responseJson: expect.objectContaining({
          accepted: true,
          canResolve: true,
          writesPerformed: true,
          created: false,
          duplicate: true,
          ruleId: 'rule-accepted',
        }),
      }),
    });
  });

  it('keeps HTTP 200 accepted=false real responses failed and retryable', async () => {
    const event = buildOutboxEvent({ dryRun: true });
    prismaMock.productPanelVariantDisableOutboxEvent.findMany.mockResolvedValueOnce([event]);
    const fetchImpl = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          accepted: false,
          dryRun: false,
          canResolve: false,
          writesPerformed: false,
          created: false,
          duplicate: false,
          error: 'not_resolved',
        }),
    });

    const result = await sendProductPanelVariantDisableDryRunEvents(
      buildEnv({ PRODUCT_PANEL_VARIANT_DISABLE_DRY_RUN: false }),
      { fetchImpl },
    );

    expect(result).toMatchObject({ processed: 1, resolved: 0, failed: 1 });
    expect(prismaMock.productPanelVariantDisableOutboxEvent.update).toHaveBeenCalledWith({
      where: { id: 'event-1' },
      data: expect.objectContaining({
        status: 'FAILED',
        dryRun: false,
        error: 'Product Panel variant disable failed with status 200.',
        responseJson: expect.objectContaining({
          accepted: false,
          canResolve: false,
          error: 'not_resolved',
        }),
      }),
    });
  });

  it('keeps failed real variant-disable responses failed and retryable', async () => {
    const event = buildOutboxEvent({ status: 'FAILED', attemptCount: 1, dryRun: true });
    prismaMock.productPanelVariantDisableOutboxEvent.findMany.mockResolvedValueOnce([event]);
    const fetchImpl = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 422,
      text: async () =>
        JSON.stringify({
          error: 'resolver_failed',
          message: 'Variant resolver could not find parent SKU.',
          writesPerformed: false,
        }),
    });

    const result = await sendProductPanelVariantDisableDryRunEvents(
      buildEnv({ PRODUCT_PANEL_VARIANT_DISABLE_DRY_RUN: false }),
      {
        statuses: ['CREATED', 'FAILED'] as never,
        fetchImpl,
      },
    );

    expect(result).toMatchObject({ processed: 1, resolved: 0, failed: 1 });
    expect(prismaMock.productPanelVariantDisableOutboxEvent.update).toHaveBeenCalledWith({
      where: { id: 'event-1' },
      data: expect.objectContaining({
        status: 'FAILED',
        dryRun: false,
        attemptCount: 2,
        error: 'Product Panel variant disable failed with status 422.',
        responseJson: expect.objectContaining({
          error: 'resolver_failed',
          message: 'Variant resolver could not find parent SKU.',
          writesPerformed: false,
        }),
      }),
    });
  });
});
