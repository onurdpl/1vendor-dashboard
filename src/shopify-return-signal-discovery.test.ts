import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  shopifyOrder: {
    findFirst: vi.fn(),
  },
  webhookEvent: {
    update: vi.fn(),
  },
}));

vi.mock('../backend/src/db/prisma.js', () => ({
  prisma: prismaMock,
}));

const {
  mapWebhookEventToReturnSignalDiscovery,
  recordShopifyReturnSignalDiscovery,
  summarizeShopifyReturnSignalPayload,
} = await import('../backend/src/modules/shopify/return-signal-discovery.service.js');

function webhookEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'webhook-return-signal-1',
    topic: 'returns/update',
    sourceShopDomain: 'demo.myshopify.com',
    webhookId: 'webhook-1',
    idempotencyKey: 'demo:returns/update:webhook:webhook-1',
    payloadHash: 'hash',
    rawPayload: null,
    status: 'RECEIVED',
    receivedAt: new Date('2026-05-19T08:00:00.000Z'),
    processedAt: null,
    errorMessage: null,
    shopifyOrderId: null,
    ...overrides,
  };
}

describe('Shopify return signal discovery diagnostics', () => {
  beforeEach(() => {
    prismaMock.shopifyOrder.findFirst.mockReset();
    prismaMock.webhookEvent.update.mockReset();
  });

  it('summarizes return-related webhook payloads without exposing raw customer data', () => {
    const summary = summarizeShopifyReturnSignalPayload(
      'returns/create',
      {
        id: 23117529425,
        admin_graphql_api_id: 'gid://shopify/Return/23117529425',
        order_id: 7621834670417,
        customer: {
          email: 'customer@example.com',
          phone: '+905551112233',
        },
        return_line_items: [
          {
            line_item_id: 20346971095377,
          },
        ],
      },
      '2026-05-19T08:00:00.000Z',
    );

    expect(summary).toMatchObject({
      topic: 'returns/create',
      orderIdPresent: true,
      returnIdPresent: true,
      lineItemIdsPresent: true,
      refundIdPresent: false,
      topLevelPayloadKeys: expect.arrayContaining(['admin_graphql_api_id', 'customer', 'id', 'order_id', 'return_line_items']),
    });
    expect(JSON.stringify(summary)).not.toContain('customer@example.com');
    expect(JSON.stringify(summary)).not.toContain('905551112233');
  });

  it('links matched order diagnostics when an order id is present', async () => {
    prismaMock.shopifyOrder.findFirst.mockResolvedValue({
      id: 'shopify-order-db-1029',
      sourceShopifyOrderId: '7621834670417',
      sourceShopifyOrderNumber: '#1029',
    });

    const summary = await recordShopifyReturnSignalDiscovery({
      event: webhookEvent() as never,
      topic: 'returns/update',
      payload: {
        id: 23117529425,
        admin_graphql_api_id: 'gid://shopify/Return/23117529425',
        order_id: '7621834670417',
        return_line_items: [{ line_item_id: '20346971095377' }],
      },
      markProcessed: true,
    });

    expect(summary).toMatchObject({
      topic: 'returns/update',
      matchedOrderId: 'shopify-order-db-1029',
      matchedByField: 'order_id',
      returnIdPresent: true,
      lineItemIdsPresent: true,
    });
    expect(prismaMock.webhookEvent.update).toHaveBeenCalledWith({
      where: { id: 'webhook-return-signal-1' },
      data: expect.objectContaining({
        shopifyOrderId: 'shopify-order-db-1029',
        status: 'PROCESSED',
        errorMessage: null,
      }),
    });
  });

  it('records unmatched discovery safely without crashing', async () => {
    prismaMock.shopifyOrder.findFirst.mockResolvedValue(null);

    const summary = await recordShopifyReturnSignalDiscovery({
      event: webhookEvent() as never,
      topic: 'orders/updated',
      payload: {
        order_id: '999999',
        financial_status: 'paid',
        fulfillment_status: 'fulfilled',
      },
      markProcessed: true,
    });

    expect(summary).toMatchObject({
      topic: 'orders/updated',
      matchedOrderId: null,
      matchedByField: null,
      orderIdPresent: true,
      financialStatus: 'paid',
      fulfillmentStatus: 'fulfilled',
    });
    expect(prismaMock.webhookEvent.update).toHaveBeenCalledWith({
      where: { id: 'webhook-return-signal-1' },
      data: expect.not.objectContaining({
        shopifyOrderId: expect.any(String),
      }),
    });
  });

  it('maps stored webhook events to admin-safe order detail diagnostics', () => {
    const summary = mapWebhookEventToReturnSignalDiscovery({
      topic: 'refunds/create',
      receivedAt: new Date('2026-05-19T08:00:00.000Z'),
      shopifyOrderId: 'shopify-order-db-1029',
      rawPayload: JSON.stringify({
        id: '1074533826897',
        order_id: '7621834670417',
        refund_line_items: [{ line_item_id: '20346971095377' }],
      }),
    });

    expect(summary).toMatchObject({
      topic: 'refunds/create',
      refundIdPresent: true,
      lineItemIdsPresent: true,
      matchedOrderId: 'shopify-order-db-1029',
      matchedByField: 'stored_webhook_order_relation',
    });
  });
});
