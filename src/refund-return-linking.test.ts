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
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    upsert: vi.fn(),
  },
  financeEvent: {
    createMany: vi.fn(),
  },
  vendorBalanceEvent: {
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
    currency: 'TRY',
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
  txMock.financeLedgerEntry.findUnique.mockResolvedValueOnce(null);
  txMock.financeLedgerEntry.findFirst.mockResolvedValueOnce({
    commissionPercentSnapshot: 10,
    commissionVatPercentSnapshot: 18,
  });
  txMock.financeEvent.createMany.mockResolvedValueOnce({ count: 3 });
  txMock.vendorBalanceEvent.upsert.mockResolvedValueOnce({
    id: 'vendor-debt-created',
    vendorId: 'sporjinal',
    type: 'VENDOR_DEBT_CREATED',
  });
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

  it('creates refund finance events once for a newly created refund ledger row', async () => {
    setupOrder();
    txMock.returnRecord.findFirst.mockResolvedValueOnce(null);

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

    expect(txMock.financeLedgerEntry.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          payoutStatus: 'PENDING',
          settlementStatus: 'PARTIALLY_REFUNDED',
          commissionPercentSnapshot: 10,
          commissionVatPercentSnapshot: 18,
        }),
        create: expect.objectContaining({
          payoutStatus: 'PENDING',
          settlementStatus: 'PARTIALLY_REFUNDED',
          commissionPercentSnapshot: 10,
          commissionVatPercentSnapshot: 18,
        }),
      }),
    );

    expect(txMock.financeEvent.createMany).toHaveBeenCalledWith({
      skipDuplicates: true,
      data: [
        expect.objectContaining({
          eventType: 'REFUND_RECORDED',
          amountMinor: 339900,
          idempotencyKey: 'fin-sporjinal-refund-1074533826897:REFUND_RECORDED',
        }),
        expect.objectContaining({
          eventType: 'COMMISSION_REVERSED',
          amountMinor: -33990,
          idempotencyKey: 'fin-sporjinal-refund-1074533826897:COMMISSION_REVERSED',
        }),
        expect.objectContaining({
          eventType: 'VENDOR_PAYABLE_REVERSED',
          amountMinor: -299792,
          idempotencyKey: 'fin-sporjinal-refund-1074533826897:VENDOR_PAYABLE_REVERSED',
          metadataJson: expect.objectContaining({
            commissionVatReversalMinor: 6118,
            vendorPayableReversalMinor: 299792,
          }),
        }),
      ],
    });
    expect(txMock.vendorBalanceEvent.upsert).not.toHaveBeenCalled();
  });

  it('does not create duplicate refund finance events when the refund ledger row already exists', async () => {
    setupOrder();
    txMock.financeLedgerEntry.findUnique.mockReset();
    txMock.financeLedgerEntry.findFirst.mockReset();
    txMock.financeEvent.createMany.mockReset();
    txMock.financeLedgerEntry.findUnique.mockResolvedValueOnce({
      id: 'fin-sporjinal-refund-1074533826897',
    });
    txMock.financeLedgerEntry.findFirst.mockResolvedValueOnce({
      commissionPercentSnapshot: 10,
      commissionVatPercentSnapshot: 18,
    });
    txMock.returnRecord.findFirst.mockResolvedValueOnce(null);

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

    expect(txMock.financeEvent.createMany).not.toHaveBeenCalled();
  });

  it('keeps refund ledger held when the related sale is already paid', async () => {
    setupOrder();
    txMock.financeLedgerEntry.findFirst.mockReset();
    txMock.financeLedgerEntry.findFirst.mockResolvedValueOnce({
      id: 'fin-sporjinal-sale-alloc-1029-sporjinal',
      entryType: 'sale',
      payoutStatus: 'PAID',
      settlementStatus: 'SETTLED',
      commissionPercentSnapshot: 10,
      commissionVatPercentSnapshot: 18,
      payoutBatchLines: [],
      settlementApprovalLines: [],
    });
    txMock.returnRecord.findFirst.mockResolvedValueOnce(null);

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

    expect(txMock.financeLedgerEntry.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          payoutStatus: 'HOLD',
          settlementHoldReason: 'Refund after settlement requires vendor debt handling.',
        }),
        create: expect.objectContaining({
          payoutStatus: 'HOLD',
          settlementHoldReason: 'Refund after settlement requires vendor debt handling.',
        }),
      }),
    );
    expect(txMock.vendorBalanceEvent.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          idempotencyKey: 'sporjinal:refund-sporjinal-1074533826897:VENDOR_DEBT_CREATED',
        },
        update: {},
        create: expect.objectContaining({
          vendorId: 'sporjinal',
          type: 'VENDOR_DEBT_CREATED',
          amountMinor: -299792,
          currency: 'TRY',
          sourceType: 'shopify_refund',
          sourceId: 'refund-sporjinal-1074533826897',
          financeLedgerEntryId: 'fin-sporjinal-refund-1074533826897',
          refundRecordId: 'refund-sporjinal-1074533826897',
          metadataJson: expect.objectContaining({
            formula: 'vendorDebtMinor = refundMinor - commissionReversalMinor - commissionVatReversalMinor',
            vendorDebtMinor: 299792,
          }),
        }),
      }),
    );
  });

  it('marks refund ledger as adjustment required when refund arrives after settlement approval before payment', async () => {
    setupOrder();
    txMock.financeLedgerEntry.findFirst.mockReset();
    txMock.financeLedgerEntry.findFirst.mockResolvedValueOnce({
      id: 'fin-sporjinal-sale-alloc-1029-sporjinal',
      entryType: 'sale',
      payoutStatus: 'PENDING',
      settlementStatus: 'PAYABLE',
      commissionPercentSnapshot: 10,
      commissionVatPercentSnapshot: 18,
      payoutBatchLines: [],
      settlementApprovalLines: [{
        settlementApproval: {
          id: 'settlement-approval-approved',
          status: 'APPROVED',
        },
      }],
    });
    txMock.returnRecord.findFirst.mockResolvedValueOnce(null);

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

    expect(txMock.financeLedgerEntry.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          payoutStatus: 'HOLD',
          settlementHoldReason: 'Refund after settlement approval requires adjustment before payout',
        }),
        create: expect.objectContaining({
          payoutStatus: 'HOLD',
          settlementHoldReason: 'Refund after settlement approval requires adjustment before payout',
        }),
      }),
    );
    expect(txMock.financeEvent.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            metadataJson: expect.objectContaining({
              postApprovalRefundRisk: 'approved_settlement_adjustment_required',
            }),
          }),
        ]),
      }),
    );
    expect(txMock.vendorBalanceEvent.upsert).not.toHaveBeenCalled();
  });
});
