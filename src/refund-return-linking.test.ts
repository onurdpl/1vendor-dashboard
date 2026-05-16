import { beforeEach, describe, expect, it, vi } from 'vitest';

const txMock = vi.hoisted(() => ({
  webhookEvent: {
    update: vi.fn(),
  },
  shopifyOrder: {
    findUnique: vi.fn(),
  },
  vendor: {
    findMany: vi.fn(),
  },
  shopifyRefund: {
    upsert: vi.fn(),
  },
  returnRecord: {
    findFirst: vi.fn(),
    upsert: vi.fn(),
  },
  refundRecord: {
    upsert: vi.fn(),
  },
  shopifyRefundLineItem: {
    upsert: vi.fn(),
  },
  financeLedgerEntry: {
    upsert: vi.fn(),
  },
}));

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn((callback: (tx: typeof txMock) => unknown) => callback(txMock)),
  webhookEvent: {
    update: vi.fn(),
  },
}));

vi.mock('../backend/src/db/prisma.js', () => ({
  prisma: prismaMock,
}));

const { ingestShopifyRefundWebhook } = await import('../backend/src/modules/shopify/refund-ingestion.service.js');

function webhookEvent() {
  return {
    id: 'webhook-refund-1',
    topic: 'refunds/create',
    sourceShopDomain: 'demo.myshopify.com',
    webhookId: 'refund-webhook-1',
    idempotencyKey: 'refunds/create:refund-webhook-1',
    payloadHash: 'hash',
    rawPayload: null,
    status: 'RECEIVED',
    receivedAt: new Date('2026-05-16T14:37:38Z'),
    processedAt: null,
    errorMessage: null,
    shopifyOrderId: null,
  };
}

function setupOrder() {
  txMock.shopifyOrder.findUnique.mockResolvedValueOnce({
    id: 'shopify-order-db-1029',
    sourceShopifyOrderId: '7621834670417',
    sourceShopifyOrderNumber: '#1029',
    lineItems: [
      {
        id: 'order-line-db-1',
        sourceLineItemId: '20346971095377',
        sku: 'DJ1196-002-42',
        originalVendorId: 'sporjinal',
      },
    ],
    allocations: [
      {
        id: 'alloc-1029-sporjinal',
        originalVendorId: 'sporjinal',
        assignedVendorId: 'sporjinal',
        sourceShopifyOrderNumber: '#1029',
      },
    ],
  });
  txMock.vendor.findMany.mockResolvedValueOnce([{ id: 'sporjinal' }]);
  txMock.shopifyRefund.upsert.mockResolvedValueOnce({ id: 'shopify-refund-db-1' });
}

describe('Shopify refund return linking', () => {
  beforeEach(() => {
    prismaMock.$transaction.mockClear();
    prismaMock.webhookEvent.update.mockReset();
    Object.values(txMock).forEach((model) => {
      Object.values(model).forEach((fn) => {
        if (typeof fn === 'function' && 'mockReset' in fn) {
          fn.mockReset();
        }
      });
    });
  });

  it('attaches refund info to an existing Shopify return request row for the same vendor/order/line item', async () => {
    setupOrder();
    txMock.returnRecord.findFirst.mockResolvedValueOnce({
      id: 'return-request-23229399377-sporjinal-20346971095377',
      reason: 'UNWANTED',
    });

    await ingestShopifyRefundWebhook({
      event: webhookEvent() as never,
      payload: {
        id: '1074533826897',
        order_id: '7621834670417',
        created_at: '2026-05-16T14:37:38Z',
        note: null,
        refund_line_items: [
          {
            id: 'refund-line-1',
            line_item_id: '20346971095377',
            quantity: 1,
            subtotal: '3399.00',
            line_item: {
              id: '20346971095377',
              sku: 'DJ1196-002-42',
              title: 'Nike Defy All Day Erkek Siyah Antrenman Ayakkabısı',
              variant_title: 'Siyah / 42',
            },
          },
        ],
      },
    });

    expect(txMock.returnRecord.findFirst).toHaveBeenCalledWith({
      where: {
        vendorAllocationId: 'alloc-1029-sporjinal',
        sourceShopifyOrderId: '7621834670417',
        returnRequestSource: 'shopify_return_request',
        sourceShopifyLineItemId: {
          in: ['20346971095377'],
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
    expect(txMock.returnRecord.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'return-request-23229399377-sporjinal-20346971095377',
        },
        update: expect.objectContaining({
          sourceShopifyRefundId: '1074533826897',
          status: 'processed',
          reason: 'UNWANTED',
        }),
      }),
    );
    expect(txMock.returnRecord.upsert).not.toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'return-sporjinal-1074533826897',
        },
      }),
    );
  });
});
