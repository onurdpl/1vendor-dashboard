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
  vendorAllocation: {
    findUnique: vi.fn(),
  },
  financeLedgerEntry: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    upsert: vi.fn(),
  },
  financeEvent: {
    createMany: vi.fn(),
  },
  vendorBalanceEvent: {
    upsert: vi.fn(),
  },
  settlementRefundAdjustment: {
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
  txMock.vendorAllocation.findUnique.mockResolvedValueOnce({
    id: 'alloc-1029-sporjinal',
    financeEntries: [
      {
        id: 'fin-sporjinal-sale-alloc-1029-sporjinal',
        vendorId: 'sporjinal',
        entryType: 'sale',
        voidedAt: null,
        supersededByLedgerId: null,
        supersededBy: null,
      },
    ],
    economicTransfers: [],
  });
  txMock.shopifyRefund.upsert.mockResolvedValueOnce({ id: 'shopify-refund-db-1' });
  txMock.financeLedgerEntry.findMany.mockResolvedValueOnce([]);
  txMock.financeLedgerEntry.findUnique.mockResolvedValueOnce(null);
  txMock.financeLedgerEntry.findFirst.mockResolvedValueOnce({
    id: 'fin-sporjinal-sale-alloc-1029-sporjinal',
    entryType: 'sale',
    payoutStatus: 'PENDING',
    settlementStatus: 'PAYABLE',
    commissionPercentSnapshot: 10,
    commissionVatPercentSnapshot: 18,
    payoutBatchLines: [],
    settlementApprovalLines: [],
  });
  txMock.financeEvent.createMany.mockResolvedValueOnce({ count: 4 });
  txMock.vendorBalanceEvent.upsert.mockResolvedValueOnce({
    id: 'vendor-debt-created',
    vendorId: 'sporjinal',
    type: 'VENDOR_DEBT_CREATED',
  });
}

function setupTransferredOrder() {
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
        originalVendorId: 'yalispor',
      },
    ],
    allocations: [
      {
        id: 'alloc-1029-yalispor',
        originalVendorId: 'yalispor',
        assignedVendorId: 'sporjinal',
        sourceShopifyOrderNumber: '#1029',
      },
    ],
  });
  txMock.vendor.findMany.mockResolvedValueOnce([{ id: 'yalispor' }, { id: 'sporjinal' }]);
  txMock.vendorAllocation.findUnique.mockResolvedValueOnce({
    id: 'alloc-1029-yalispor',
    financeEntries: [
      {
        id: 'fin-yalispor-sale-7621834670417',
        vendorId: 'yalispor',
        entryType: 'sale',
        voidedAt: new Date('2026-06-21T10:00:00.000Z'),
        supersededByLedgerId: 'fin-sporjinal-sale-7621834670417',
        supersededBy: {
          id: 'fin-sporjinal-sale-7621834670417',
          vendorId: 'sporjinal',
          entryType: 'sale',
          voidedAt: null,
        },
      },
    ],
    economicTransfers: [{
      id: 'economic-transfer-1',
      status: 'completed',
      createdAt: new Date('2026-06-21T10:00:00.000Z'),
    }],
  });
  txMock.shopifyRefund.upsert.mockResolvedValueOnce({ id: 'shopify-refund-db-1' });
  txMock.financeLedgerEntry.findMany.mockResolvedValueOnce([]);
  txMock.financeLedgerEntry.findUnique.mockResolvedValueOnce(null);
  txMock.financeLedgerEntry.findFirst.mockResolvedValueOnce({
    id: 'fin-sporjinal-sale-7621834670417',
    entryType: 'sale',
    payoutStatus: 'PENDING',
    settlementStatus: 'PAYABLE',
    commissionPercentSnapshot: 10,
    commissionVatPercentSnapshot: 18,
    payoutBatchLines: [],
    settlementApprovalLines: [],
  });
  txMock.financeEvent.createMany.mockResolvedValueOnce({ count: 4 });
  txMock.vendorBalanceEvent.upsert.mockResolvedValueOnce({
    id: 'vendor-debt-created',
    vendorId: 'sporjinal',
    type: 'VENDOR_DEBT_CREATED',
  });
}

function refundPayload() {
  return {
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
  };
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
          eventType: 'COMMISSION_VAT_REVERSED',
          amountMinor: -6118,
          idempotencyKey: 'fin-sporjinal-refund-1074533826897:COMMISSION_VAT_REVERSED',
          metadataJson: expect.objectContaining({
            commissionVatReversalMinor: 6118,
            commissionVatPercentSnapshot: 18,
          }),
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

  it('targets the original active sale ledger owner for a normal non-reassigned refund', async () => {
    setupOrder();
    txMock.returnRecord.findFirst.mockResolvedValueOnce(null);

    await ingestShopifyRefundWebhook({
      event: webhookEvent() as never,
      payload: refundPayload() as never,
    });

    expect(txMock.refundRecord.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'refund-sporjinal-1074533826897',
        },
      }),
    );
    expect(txMock.financeLedgerEntry.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'fin-sporjinal-refund-1074533826897',
        },
        create: expect.objectContaining({
          vendorId: 'sporjinal',
        }),
      }),
    );
  });

  it('targets the replacement owner when original sale ledger is voided and superseded by an active sale ledger', async () => {
    setupTransferredOrder();
    txMock.returnRecord.findFirst.mockResolvedValueOnce(null);

    await ingestShopifyRefundWebhook({
      event: webhookEvent() as never,
      payload: refundPayload() as never,
    });

    expect(txMock.refundRecord.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'refund-sporjinal-1074533826897',
        },
        create: expect.objectContaining({
          vendorAllocationId: 'alloc-1029-yalispor',
        }),
      }),
    );
    expect(txMock.returnRecord.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'return-yalispor-1074533826897',
        },
      }),
    );
    expect(txMock.financeLedgerEntry.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'fin-sporjinal-refund-1074533826897',
        },
        create: expect.objectContaining({
          vendorId: 'sporjinal',
          commissionPercentSnapshot: 10,
          commissionVatPercentSnapshot: 18,
        }),
      }),
    );
    expect(txMock.financeEvent.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            vendorId: 'sporjinal',
            eventType: 'COMMISSION_VAT_REVERSED',
            idempotencyKey: 'fin-sporjinal-refund-1074533826897:COMMISSION_VAT_REVERSED',
            metadataJson: expect.objectContaining({
              originalVendorIds: ['yalispor'],
              activeSaleLedgerId: 'fin-sporjinal-sale-7621834670417',
              supersededFromLedgerIds: ['fin-yalispor-sale-7621834670417'],
            }),
          }),
        ]),
      }),
    );
  });

  it('creates vendor debt for the resolved replacement owner when the active sale ledger is already paid', async () => {
    setupTransferredOrder();
    txMock.financeLedgerEntry.findFirst.mockReset();
    txMock.financeLedgerEntry.findFirst.mockResolvedValueOnce({
      id: 'fin-sporjinal-sale-7621834670417',
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
      payload: refundPayload() as never,
    });

    expect(txMock.vendorBalanceEvent.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          idempotencyKey: 'sporjinal:refund-sporjinal-1074533826897:VENDOR_DEBT_CREATED',
        },
        create: expect.objectContaining({
          vendorId: 'sporjinal',
          financeLedgerEntryId: 'fin-sporjinal-refund-1074533826897',
          refundRecordId: 'refund-sporjinal-1074533826897',
        }),
      }),
    );
  });

  it('blocks refund finance writes when no active sale ledger can resolve economic owner', async () => {
    setupOrder();
    txMock.vendorAllocation.findUnique.mockReset();
    txMock.vendorAllocation.findUnique.mockResolvedValueOnce({
      id: 'alloc-1029-sporjinal',
      financeEntries: [],
      economicTransfers: [],
    });

    const result = await ingestShopifyRefundWebhook({
      event: webhookEvent() as never,
      payload: refundPayload() as never,
    });

    expect(result).toMatchObject({
      ok: false,
      action: 'received_needs_attention',
      processingStatus: 'needs_attention',
      error: 'No active sale ledger found for allocation.',
    });
    expect(txMock.refundRecord.upsert).not.toHaveBeenCalled();
    expect(txMock.financeLedgerEntry.upsert).not.toHaveBeenCalled();
    expect(txMock.financeEvent.createMany).not.toHaveBeenCalled();
    expect(txMock.vendorBalanceEvent.upsert).not.toHaveBeenCalled();
    expect(txMock.settlementRefundAdjustment.upsert).not.toHaveBeenCalled();
  });

  it('blocks refund finance writes when multiple active sale ledgers exist', async () => {
    setupOrder();
    txMock.vendorAllocation.findUnique.mockReset();
    txMock.vendorAllocation.findUnique.mockResolvedValueOnce({
      id: 'alloc-1029-sporjinal',
      financeEntries: [
        {
          id: 'fin-sporjinal-sale-7621834670417',
          vendorId: 'sporjinal',
          entryType: 'sale',
          voidedAt: null,
        },
        {
          id: 'fin-yalispor-sale-7621834670417',
          vendorId: 'yalispor',
          entryType: 'sale',
          voidedAt: null,
        },
      ],
      economicTransfers: [],
    });

    const result = await ingestShopifyRefundWebhook({
      event: webhookEvent() as never,
      payload: refundPayload() as never,
    });

    expect(result.error).toBe('Multiple active sale ledgers found for allocation.');
    expect(txMock.financeLedgerEntry.upsert).not.toHaveBeenCalled();
    expect(txMock.financeEvent.createMany).not.toHaveBeenCalled();
  });

  it('blocks refund finance writes while economic transfer is in progress', async () => {
    setupOrder();
    txMock.vendorAllocation.findUnique.mockReset();
    txMock.vendorAllocation.findUnique.mockResolvedValueOnce({
      id: 'alloc-1029-sporjinal',
      financeEntries: [],
      economicTransfers: [{
        id: 'economic-transfer-1',
        status: 'in_progress',
        createdAt: new Date('2026-06-21T10:00:00.000Z'),
      }],
    });

    const result = await ingestShopifyRefundWebhook({
      event: webhookEvent() as never,
      payload: refundPayload() as never,
    });

    expect(result.error).toBe('Economic transfer is in progress for allocation.');
    expect(txMock.financeLedgerEntry.upsert).not.toHaveBeenCalled();
    expect(txMock.financeEvent.createMany).not.toHaveBeenCalled();
  });

  it('blocks refund finance writes when an active refund ledger already exists for another vendor', async () => {
    setupTransferredOrder();
    txMock.financeLedgerEntry.findMany.mockReset();
    txMock.financeLedgerEntry.findMany.mockResolvedValueOnce([
      {
        id: 'fin-yalispor-refund-1074533826897',
        vendorId: 'yalispor',
      },
    ]);
    txMock.returnRecord.findFirst.mockResolvedValueOnce(null);

    const result = await ingestShopifyRefundWebhook({
      event: webhookEvent() as never,
      payload: refundPayload() as never,
    });

    expect(result).toMatchObject({
      ok: false,
      action: 'received_needs_attention',
      processingStatus: 'needs_attention',
      error: 'Active refund ledger fin-yalispor-refund-1074533826897 already exists for allocation alloc-1029-yalispor and Shopify refund 1074533826897.',
    });
    expect(txMock.financeLedgerEntry.upsert).not.toHaveBeenCalled();
    expect(txMock.financeEvent.createMany).not.toHaveBeenCalled();
  });

  it('does not emit a noisy commission VAT reversal event when refund VAT reversal is zero', async () => {
    setupOrder();
    txMock.financeLedgerEntry.findFirst.mockReset();
    txMock.financeLedgerEntry.findFirst.mockResolvedValueOnce({
      commissionPercentSnapshot: 10,
      commissionVatPercentSnapshot: 0,
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

    const createManyCall = txMock.financeEvent.createMany.mock.calls[0]?.[0];
    expect(createManyCall.data).toHaveLength(3);
    expect(createManyCall.data.map((event: { eventType: string }) => event.eventType)).toEqual([
      'REFUND_RECORDED',
      'COMMISSION_REVERSED',
      'VENDOR_PAYABLE_REVERSED',
    ]);
    expect(createManyCall.data).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: 'COMMISSION_VAT_REVERSED',
        }),
      ]),
    );
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
    expect(txMock.settlementRefundAdjustment.upsert).not.toHaveBeenCalled();
  });

  it('marks refund ledger as adjustment required when refund arrives after settlement approval before payment', async () => {
    setupOrder();
    txMock.financeLedgerEntry.findUnique.mockReset();
    txMock.financeLedgerEntry.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'fin-sporjinal-refund-1074533826897',
        vendorId: 'sporjinal',
        vendorAllocationId: 'alloc-1029-sporjinal',
        entryType: 'refund',
        amount: 3399,
        payoutStatus: 'HOLD',
        settlementStatus: 'PARTIALLY_REFUNDED',
        commissionPercentSnapshot: 10,
        commissionVatPercentSnapshot: 18,
        vendorAllocation: {
          sourceShopifyOrderId: '7621834670417',
          sourceShopifyOrderNumber: '#1029',
          order: {
            id: 'shopify-order-db-1029',
            currency: 'TRY',
          },
          financeEntries: [
            {
              id: 'fin-sporjinal-sale-alloc-1029-sporjinal',
              entryType: 'sale',
              payoutStatus: 'PENDING',
              settlementStatus: 'PAYABLE',
              commissionPercentSnapshot: 10,
              commissionVatPercentSnapshot: 18,
              settlementApprovalLines: [
                {
                  id: 'settlement-line-sale-1',
                  settlementApproval: {
                    id: 'settlement-approval-approved',
                    status: 'APPROVED',
                    approvedAt: new Date('2026-06-18T10:00:00.000Z'),
                    commissionInvoices: [
                      {
                        id: 'settlement-commission-invoice-1',
                        status: 'CREATED',
                        createdAt: new Date('2026-06-18T11:00:00.000Z'),
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      });
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
        id: 'settlement-line-sale-1',
        settlementApproval: {
          id: 'settlement-approval-approved',
          status: 'APPROVED',
        },
      }],
    });
    txMock.settlementRefundAdjustment.upsert.mockResolvedValueOnce({
      id: 'refund-adjustment-1',
      refundRecordId: 'refund-sporjinal-1074533826897',
      refundFinanceLedgerEntryId: 'fin-sporjinal-refund-1074533826897',
      vendorId: 'sporjinal',
      originalOrderId: 'shopify-order-db-1029',
      originalSettlementApprovalId: 'settlement-approval-approved',
      originalSettlementApprovalLineId: 'settlement-line-sale-1',
      originalSettlementCommissionInvoiceId: 'settlement-commission-invoice-1',
      status: 'PENDING',
      amountMinor: 299792,
      currencyCode: 'TRY',
      reason: 'Refund after invoiced settlement requires future settlement adjustment.',
      createdAt: new Date('2026-06-19T10:00:00.000Z'),
      updatedAt: new Date('2026-06-19T10:00:00.000Z'),
      appliedSettlementApprovalId: null,
      appliedSettlementApprovalLineId: null,
      blockedReason: null,
      createdBy: 'system:shopify_refunds_create',
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
    expect(txMock.settlementRefundAdjustment.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          refundFinanceLedgerEntryId: 'fin-sporjinal-refund-1074533826897',
        },
        update: {},
        create: expect.objectContaining({
          refundRecordId: 'refund-sporjinal-1074533826897',
          refundFinanceLedgerEntryId: 'fin-sporjinal-refund-1074533826897',
          vendorId: 'sporjinal',
          originalOrderId: 'shopify-order-db-1029',
          originalSettlementApprovalId: 'settlement-approval-approved',
          originalSettlementApprovalLineId: 'settlement-line-sale-1',
          originalSettlementCommissionInvoiceId: 'settlement-commission-invoice-1',
          status: 'PENDING',
          amountMinor: 299792,
          currencyCode: 'TRY',
          reason: 'Refund after invoiced settlement requires future settlement adjustment.',
          events: {
            create: expect.objectContaining({
              eventType: 'CREATED',
              metadataJson: expect.objectContaining({
                refundFinanceLedgerEntryId: 'fin-sporjinal-refund-1074533826897',
                refundRecordId: 'refund-sporjinal-1074533826897',
                amountMinor: 299792,
                currencyCode: 'TRY',
              }),
            }),
          },
        }),
      }),
    );
  });
});
