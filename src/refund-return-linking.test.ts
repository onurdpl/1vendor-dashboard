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
  shopifyOrderLineItem: {
    findMany: vi.fn(),
  },
  vendorAllocationLineItem: {
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
    findFirst: vi.fn(),
    upsert: vi.fn(),
  },
  shopifyRefundLineItem: {
    upsert: vi.fn(),
  },
  vendorAllocation: {
    findUnique: vi.fn(),
    updateMany: vi.fn(),
  },
  outboundShopifyRefundAttempt: {
    findFirst: vi.fn(),
    updateMany: vi.fn(),
  },
  orderShippingRefundClaim: {
    updateMany: vi.fn(),
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
  financeIntegrityAlert: {
    findMany: vi.fn(),
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

const NORMAL_REFUND_RECORD_ID = 'refund-sporjinal-1074533826897-alloc-1029-sporjinal';
const NORMAL_REFUND_LEDGER_ID = 'fin-sporjinal-refund-1074533826897-alloc-1029-sporjinal';
const NORMAL_REFUND_RETURN_RECORD_ID = 'return-sporjinal-1074533826897-alloc-1029-sporjinal';
const TRANSFERRED_REFUND_RECORD_ID = 'refund-sporjinal-1074533826897-alloc-1029-yalispor';
const TRANSFERRED_REFUND_LEDGER_ID = 'fin-sporjinal-refund-1074533826897-alloc-1029-yalispor';
const TRANSFERRED_REFUND_RETURN_RECORD_ID = 'return-yalispor-1074533826897-alloc-1029-yalispor';

function queueOwnershipResolution(input: {
  lineItem: {
    id: string;
    sourceLineItemId: string;
    sku?: string | null;
    originalVendorId?: string | null;
  };
  allocation: {
    id: string;
    originalVendorId: string;
    assignedVendorId: string;
    sourceShopifyOrderNumber: string;
    cancelRefundReviewStatus?: string | null;
  };
  allocationLineItemId?: string;
}) {
  txMock.shopifyOrderLineItem.findMany.mockResolvedValueOnce([input.lineItem]);
  txMock.vendorAllocationLineItem.findMany.mockResolvedValueOnce([
    {
      id: input.allocationLineItemId ?? `allocation-line-${input.lineItem.sourceLineItemId}`,
      vendorAllocationId: input.allocation.id,
      shopifyLineItemId: input.lineItem.id,
      quantity: 1,
      lineAmount: '0.00',
      vendorAllocation: input.allocation,
      shopifyOrderLineItem: input.lineItem,
    },
  ]);
}

function setupOrder(options: { cancelRefundReviewStatus?: string | null } = {}) {
  const orderLineItem = {
    id: 'order-line-db-1',
    sourceLineItemId: '20346971095377',
    sku: 'DJ1196-002-42',
    originalVendorId: 'sporjinal',
  };
  const allocation = {
    id: 'alloc-1029-sporjinal',
    originalVendorId: 'sporjinal',
    assignedVendorId: 'sporjinal',
    sourceShopifyOrderNumber: '#1029',
    cancelRefundReviewStatus: options.cancelRefundReviewStatus ?? null,
  };
  txMock.shopifyOrder.findUnique.mockResolvedValueOnce({
    id: 'shopify-order-db-1029',
    sourceShopifyOrderId: '7621834670417',
    sourceShopifyOrderNumber: '#1029',
    currency: 'TRY',
    lineItems: [orderLineItem],
    allocations: [allocation],
  });
  queueOwnershipResolution({
    lineItem: orderLineItem,
    allocation,
  });
  txMock.vendor.findMany.mockResolvedValueOnce([{ id: 'sporjinal' }]);
  txMock.refundRecord.findFirst.mockResolvedValueOnce(null);
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
  txMock.vendorAllocation.updateMany.mockResolvedValue({ count: 1 });
  txMock.outboundShopifyRefundAttempt.updateMany.mockResolvedValue({ count: 1 });
  txMock.shopifyRefund.upsert.mockResolvedValueOnce({ id: 'shopify-refund-db-1' });
  txMock.financeLedgerEntry.findMany.mockResolvedValueOnce([]);
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
  txMock.financeIntegrityAlert.findMany.mockResolvedValue([]);
}

function setupTransferredOrder() {
  const orderLineItem = {
    id: 'order-line-db-1',
    sourceLineItemId: '20346971095377',
    sku: 'DJ1196-002-42',
    originalVendorId: 'yalispor',
  };
  const allocation = {
    id: 'alloc-1029-yalispor',
    originalVendorId: 'yalispor',
    assignedVendorId: 'sporjinal',
    sourceShopifyOrderNumber: '#1029',
    cancelRefundReviewStatus: null,
  };
  txMock.shopifyOrder.findUnique.mockResolvedValueOnce({
    id: 'shopify-order-db-1029',
    sourceShopifyOrderId: '7621834670417',
    sourceShopifyOrderNumber: '#1029',
    currency: 'TRY',
    lineItems: [orderLineItem],
    allocations: [allocation],
  });
  queueOwnershipResolution({
    lineItem: orderLineItem,
    allocation,
  });
  txMock.vendor.findMany.mockResolvedValueOnce([{ id: 'yalispor' }, { id: 'sporjinal' }]);
  txMock.refundRecord.findFirst.mockResolvedValueOnce(null);
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
  txMock.vendorAllocation.updateMany.mockResolvedValue({ count: 1 });
  txMock.outboundShopifyRefundAttempt.updateMany.mockResolvedValue({ count: 1 });
  txMock.shopifyRefund.upsert.mockResolvedValueOnce({ id: 'shopify-refund-db-1' });
  txMock.financeLedgerEntry.findMany.mockResolvedValueOnce([]);
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
  txMock.financeIntegrityAlert.findMany.mockResolvedValue([]);
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

function setupSplitOrderRefund(input: {
  refundSourceLine?: boolean;
  refundChildLine?: boolean;
  sourceCancelRefundReviewStatus?: string | null;
  childCancelRefundReviewStatus?: string | null;
}) {
  const sourceLineItem = {
    id: 'order-line-db-source',
    sourceLineItemId: 'line-source',
    sku: 'SKU-SOURCE',
    originalVendorId: 'sporjinal',
  };
  const childLineItem = {
    id: 'order-line-db-child',
    sourceLineItemId: 'line-child',
    sku: 'SKU-CHILD',
    originalVendorId: 'sporjinal',
  };
  const sourceAllocation = {
    id: 'alloc-source',
    originalVendorId: 'sporjinal',
    assignedVendorId: 'sporjinal',
    sourceShopifyOrderNumber: '#1096',
    cancelRefundReviewStatus: input.sourceCancelRefundReviewStatus ?? null,
  };
  const childAllocation = {
    id: 'alloc-child',
    originalVendorId: 'sporjinal',
    assignedVendorId: 'sporjinal',
    sourceShopifyOrderNumber: '#1096',
    cancelRefundReviewStatus: input.childCancelRefundReviewStatus ?? 'PENDING_REVIEW',
  };

  txMock.shopifyOrder.findUnique.mockResolvedValueOnce({
    id: 'shopify-order-db-split',
    sourceShopifyOrderId: 'split-order',
    sourceShopifyOrderNumber: '#1096',
    currency: 'TRY',
    lineItems: [sourceLineItem, childLineItem],
    allocations: [sourceAllocation, childAllocation],
  });

  if (input.refundSourceLine) {
    queueOwnershipResolution({
      lineItem: sourceLineItem,
      allocation: sourceAllocation,
      allocationLineItemId: 'allocation-line-source',
    });
    txMock.vendorAllocation.findUnique.mockResolvedValueOnce({
      id: sourceAllocation.id,
      financeEntries: [
        {
          id: 'fin-sporjinal-sale-split-order-alloc-source',
          vendorId: 'sporjinal',
          entryType: 'sale',
          voidedAt: null,
          supersededByLedgerId: null,
          supersededBy: null,
        },
      ],
      economicTransfers: [],
    });
  }

  if (input.refundChildLine) {
    queueOwnershipResolution({
      lineItem: childLineItem,
      allocation: childAllocation,
      allocationLineItemId: 'allocation-line-child',
    });
    txMock.vendorAllocation.findUnique.mockResolvedValueOnce({
      id: childAllocation.id,
      financeEntries: [
        {
          id: 'fin-sporjinal-sale-split-order-alloc-child',
          vendorId: 'sporjinal',
          entryType: 'sale',
          voidedAt: null,
          supersededByLedgerId: null,
          supersededBy: null,
        },
      ],
      economicTransfers: [],
    });
  }

  txMock.refundRecord.findFirst.mockResolvedValue(null);
  txMock.shopifyRefund.upsert.mockResolvedValueOnce({ id: 'shopify-refund-db-split' });
  txMock.financeLedgerEntry.findMany.mockResolvedValue([]);
  txMock.financeLedgerEntry.findFirst.mockImplementation(async (query: { where?: { id?: string } }) => ({
    id: query.where?.id ?? 'fin-sporjinal-sale-split-order-unknown',
    entryType: 'sale',
    payoutStatus: 'PENDING',
    settlementStatus: 'PAYABLE',
    commissionPercentSnapshot: 10,
    commissionVatPercentSnapshot: 18,
    payoutBatchLines: [],
    settlementApprovalLines: [],
  }));
}

function splitRefundPayload(input: {
  source?: boolean;
  child?: boolean;
}) {
  const refundLineItems = [];
  if (input.source) {
    refundLineItems.push({
      id: 'refund-line-source',
      line_item_id: 'line-source',
      quantity: 1,
      subtotal: '100.00',
      line_item: {
        id: 'line-source',
        sku: 'SKU-SOURCE',
        title: 'Source item',
      },
    });
  }
  if (input.child) {
    refundLineItems.push({
      id: 'refund-line-child',
      line_item_id: 'line-child',
      quantity: 1,
      subtotal: '50.00',
      line_item: {
        id: 'line-child',
        sku: 'SKU-CHILD',
        title: 'Child item',
      },
    });
  }

  return {
    id: 'refund-split',
    order_id: 'split-order',
    created_at: '2026-06-23T10:00:00.000Z',
    note: null,
    refund_line_items: refundLineItems,
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
    txMock.financeIntegrityAlert.findMany.mockResolvedValue([]);
    txMock.vendorAllocation.updateMany.mockResolvedValue({ count: 0 });
    txMock.outboundShopifyRefundAttempt.findFirst.mockResolvedValue(null);
    txMock.outboundShopifyRefundAttempt.updateMany.mockResolvedValue({ count: 0 });
    txMock.orderShippingRefundClaim.updateMany.mockResolvedValue({ count: 0 });
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
          id: NORMAL_REFUND_RETURN_RECORD_ID,
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
          idempotencyKey: `${NORMAL_REFUND_LEDGER_ID}:REFUND_RECORDED`,
        }),
        expect.objectContaining({
          eventType: 'COMMISSION_REVERSED',
          amountMinor: -33990,
          idempotencyKey: `${NORMAL_REFUND_LEDGER_ID}:COMMISSION_REVERSED`,
        }),
        expect.objectContaining({
          eventType: 'COMMISSION_VAT_REVERSED',
          amountMinor: -6118,
          idempotencyKey: `${NORMAL_REFUND_LEDGER_ID}:COMMISSION_VAT_REVERSED`,
          metadataJson: expect.objectContaining({
            commissionVatReversalMinor: 6118,
            commissionVatPercentSnapshot: 18,
          }),
        }),
        expect.objectContaining({
          eventType: 'VENDOR_PAYABLE_REVERSED',
          amountMinor: -299792,
          idempotencyKey: `${NORMAL_REFUND_LEDGER_ID}:VENDOR_PAYABLE_REVERSED`,
          metadataJson: expect.objectContaining({
            commissionVatReversalMinor: 6118,
            vendorPayableReversalMinor: 299792,
          }),
        }),
      ],
    });
    expect(txMock.vendorBalanceEvent.upsert).not.toHaveBeenCalled();
  });

  it.each([
    'PENDING_REVIEW',
    'CUSTOMER_CONTACTED',
    'SHOPIFY_ACTION_PENDING',
  ])('resolves cancel/refund review status %s after successful refund ingestion', async (cancelRefundReviewStatus) => {
    setupOrder({ cancelRefundReviewStatus });
    txMock.returnRecord.findFirst.mockResolvedValueOnce(null);

    await ingestShopifyRefundWebhook({
      event: webhookEvent() as never,
      payload: refundPayload() as never,
    });

    expect(txMock.vendorAllocation.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'alloc-1029-sporjinal',
        cancelRefundReviewStatus: {
          in: ['PENDING_REVIEW', 'CUSTOMER_CONTACTED', 'SHOPIFY_ACTION_PENDING'],
        },
      },
      data: {
        cancelRefundReviewStatus: 'RESOLVED',
      },
    });
  });

  it('leaves allocations without cancel/refund review state unchanged after refund ingestion', async () => {
    setupOrder({ cancelRefundReviewStatus: null });
    txMock.returnRecord.findFirst.mockResolvedValueOnce(null);

    await ingestShopifyRefundWebhook({
      event: webhookEvent() as never,
      payload: refundPayload() as never,
    });

    expect(txMock.vendorAllocation.updateMany).not.toHaveBeenCalled();
  });

  it('marks matching outbound refund attempt audit records resolved after refund ingestion', async () => {
    setupOrder({ cancelRefundReviewStatus: 'SHOPIFY_ACTION_PENDING' });
    txMock.returnRecord.findFirst.mockResolvedValueOnce(null);

    await ingestShopifyRefundWebhook({
      event: webhookEvent() as never,
      payload: refundPayload() as never,
    });

    expect(txMock.outboundShopifyRefundAttempt.updateMany).toHaveBeenCalledWith({
      where: {
        vendorAllocationId: 'alloc-1029-sporjinal',
        status: {
          in: ['PREVIEWED', 'SHOPIFY_ACTION_PENDING'],
        },
      },
      data: {
        status: 'RESOLVED',
        shopifyRefundId: '1074533826897',
        resolvedAt: expect.any(Date),
      },
    });
    expect(txMock.orderShippingRefundClaim.updateMany).toHaveBeenCalledWith({
      where: {
        status: 'ACTIVE',
        activeOrderKey: { not: null },
        ownerAttempt: {
          vendorAllocationId: 'alloc-1029-sporjinal',
          status: 'RESOLVED',
        },
      },
      data: {
        status: 'RELEASED',
        activeOrderKey: null,
        releasedAt: expect.any(Date),
        releaseReason: 'OWNER_ATTEMPT_RESOLVED',
      },
    });
  });

  it('keeps cancel/refund review open when the matching outbound attempt has a blocking post-check warning', async () => {
    setupOrder({ cancelRefundReviewStatus: 'SHOPIFY_ACTION_PENDING' });
    txMock.outboundShopifyRefundAttempt.findFirst.mockResolvedValueOnce({
      mutationResponseJson: {
        postRefundFulfillmentCheck: {
          status: 'warning',
          message: 'Refund was submitted, but Shopify still shows fulfillable quantity. Manual attention required.',
        },
      },
    });
    txMock.returnRecord.findFirst.mockResolvedValueOnce(null);

    await ingestShopifyRefundWebhook({
      event: webhookEvent() as never,
      payload: refundPayload() as never,
    });

    expect(txMock.vendorAllocation.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({
      data: {
        cancelRefundReviewStatus: 'RESOLVED',
      },
    }));
    expect(txMock.outboundShopifyRefundAttempt.updateMany).toHaveBeenCalledWith({
      where: {
        vendorAllocationId: 'alloc-1029-sporjinal',
        status: 'SHOPIFY_ACTION_PENDING',
      },
      data: {
        shopifyRefundId: '1074533826897',
      },
    });
  });

  it('resolves cancel/refund review even when no outbound refund attempt exists', async () => {
    setupOrder({ cancelRefundReviewStatus: 'PENDING_REVIEW' });
    txMock.outboundShopifyRefundAttempt.updateMany.mockResolvedValueOnce({ count: 0 });
    txMock.returnRecord.findFirst.mockResolvedValueOnce(null);

    await ingestShopifyRefundWebhook({
      event: webhookEvent() as never,
      payload: refundPayload() as never,
    });

    expect(txMock.vendorAllocation.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: {
        cancelRefundReviewStatus: 'RESOLVED',
      },
    }));
    expect(txMock.outboundShopifyRefundAttempt.updateMany).toHaveBeenCalled();
  });

  it('does not resolve cancel/refund review or outbound attempts when refund ingestion cannot match the allocation', async () => {
    setupOrder({ cancelRefundReviewStatus: 'PENDING_REVIEW' });

    const result = await ingestShopifyRefundWebhook({
      event: webhookEvent() as never,
      payload: {
        ...refundPayload(),
        refund_line_items: [
          {
            id: 'refund-line-1',
            line_item_id: 'missing-line',
            quantity: 1,
            subtotal: '3399.00',
            line_item: {
              id: 'missing-line',
              sku: 'UNKNOWN-SKU',
            },
          },
        ],
      } as never,
    });

    expect(result.ok).toBe(false);
    expect(txMock.vendorAllocation.updateMany).not.toHaveBeenCalled();
    expect(txMock.outboundShopifyRefundAttempt.updateMany).not.toHaveBeenCalled();
    expect(txMock.refundRecord.upsert).not.toHaveBeenCalled();
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
          id: NORMAL_REFUND_RECORD_ID,
        },
      }),
    );
    expect(txMock.returnRecord.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          ownerVendorId: 'sporjinal',
        }),
      }),
    );
    expect(txMock.financeLedgerEntry.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: NORMAL_REFUND_LEDGER_ID,
        },
        create: expect.objectContaining({
          vendorId: 'sporjinal',
        }),
      }),
    );
  });

  it('attaches a split child refund to the child allocation and resolves only the child review', async () => {
    setupSplitOrderRefund({
      refundChildLine: true,
      childCancelRefundReviewStatus: 'PENDING_REVIEW',
    });

    const result = await ingestShopifyRefundWebhook({
      event: webhookEvent() as never,
      payload: splitRefundPayload({ child: true }) as never,
    });

    expect(result).toMatchObject({
      ok: true,
      refundAllocationCount: 1,
    });
    expect(txMock.refundRecord.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'refund-sporjinal-refund-split-alloc-child',
        },
        create: expect.objectContaining({
          vendorAllocationId: 'alloc-child',
          amount: '50.00',
        }),
      }),
    );
    expect(txMock.financeLedgerEntry.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'fin-sporjinal-refund-refund-split-alloc-child',
        },
        create: expect.objectContaining({
          vendorAllocationId: 'alloc-child',
          amount: '50.00',
        }),
      }),
    );
    expect(txMock.vendorAllocation.updateMany).toHaveBeenCalledTimes(1);
    expect(txMock.vendorAllocation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'alloc-child',
        }),
        data: {
          cancelRefundReviewStatus: 'RESOLVED',
        },
      }),
    );
  });

  it('keeps same-vendor split allocation refunds in separate refund groups', async () => {
    setupSplitOrderRefund({
      refundSourceLine: true,
      refundChildLine: true,
      sourceCancelRefundReviewStatus: null,
      childCancelRefundReviewStatus: 'PENDING_REVIEW',
    });

    const result = await ingestShopifyRefundWebhook({
      event: webhookEvent() as never,
      payload: splitRefundPayload({ source: true, child: true }) as never,
    });

    expect(result).toMatchObject({
      ok: true,
      refundAllocationCount: 2,
    });
    expect(txMock.refundRecord.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'refund-sporjinal-refund-split-alloc-source',
        },
        create: expect.objectContaining({
          vendorAllocationId: 'alloc-source',
          amount: '100.00',
        }),
      }),
    );
    expect(txMock.refundRecord.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'refund-sporjinal-refund-split-alloc-child',
        },
        create: expect.objectContaining({
          vendorAllocationId: 'alloc-child',
          amount: '50.00',
        }),
      }),
    );
    expect(txMock.financeLedgerEntry.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'fin-sporjinal-refund-refund-split-alloc-source',
        },
      }),
    );
    expect(txMock.financeLedgerEntry.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'fin-sporjinal-refund-refund-split-alloc-child',
        },
      }),
    );
    const financeEventCalls = txMock.financeEvent.createMany.mock.calls.map((call) => call[0]);
    expect(financeEventCalls).toEqual([
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            idempotencyKey: 'fin-sporjinal-refund-refund-split-alloc-source:REFUND_RECORDED',
          }),
        ]),
      }),
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            idempotencyKey: 'fin-sporjinal-refund-refund-split-alloc-child:REFUND_RECORDED',
          }),
        ]),
      }),
    ]);
    expect(txMock.vendorAllocation.updateMany).toHaveBeenCalledTimes(1);
    expect(txMock.vendorAllocation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'alloc-child',
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
          id: TRANSFERRED_REFUND_RECORD_ID,
        },
        create: expect.objectContaining({
          vendorAllocationId: 'alloc-1029-yalispor',
        }),
      }),
    );
    expect(txMock.returnRecord.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: TRANSFERRED_REFUND_RETURN_RECORD_ID,
        },
        create: expect.objectContaining({
          ownerVendorId: 'sporjinal',
        }),
      }),
    );
    expect(txMock.financeLedgerEntry.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: TRANSFERRED_REFUND_LEDGER_ID,
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
            idempotencyKey: `${TRANSFERRED_REFUND_LEDGER_ID}:COMMISSION_VAT_REVERSED`,
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
          idempotencyKey: `sporjinal:${TRANSFERRED_REFUND_RECORD_ID}:VENDOR_DEBT_CREATED`,
        },
        create: expect.objectContaining({
          vendorId: 'sporjinal',
          financeLedgerEntryId: TRANSFERRED_REFUND_LEDGER_ID,
          refundRecordId: TRANSFERRED_REFUND_RECORD_ID,
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

  it('blocks refund finance writes when an open finance integrity alert exists for the allocation', async () => {
    setupOrder();
    txMock.financeIntegrityAlert.findMany.mockResolvedValueOnce([
      {
        id: 'alert-1',
        dedupeKey: 'finance-integrity:multiple_active_sale_ledgers:allocation:alloc-1029-sporjinal',
        severity: 'critical',
        category: 'multiple_active_sale_ledgers',
        reason: 'Multiple active sale ledgers exist for allocation.',
        vendorAllocationId: 'alloc-1029-sporjinal',
        allocationEconomicTransferId: null,
      },
    ]);

    const result = await ingestShopifyRefundWebhook({
      event: webhookEvent() as never,
      payload: refundPayload() as never,
    });

    expect(result).toMatchObject({
      ok: false,
      action: 'received_needs_attention',
      processingStatus: 'needs_attention',
      error: 'Money movement blocked by blocking finance integrity alert: multiple_active_sale_ledgers.',
    });
    expect(txMock.refundRecord.upsert).not.toHaveBeenCalled();
    expect(txMock.financeLedgerEntry.upsert).not.toHaveBeenCalled();
    expect(txMock.financeEvent.createMany).not.toHaveBeenCalled();
    expect(txMock.vendorBalanceEvent.upsert).not.toHaveBeenCalled();
    expect(txMock.settlementRefundAdjustment.upsert).not.toHaveBeenCalled();
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

  it('repairs missing refund finance events idempotently when the refund ledger row already exists', async () => {
    setupOrder();
    txMock.financeLedgerEntry.findMany.mockReset();
    txMock.financeLedgerEntry.findFirst.mockReset();
    txMock.financeEvent.createMany.mockReset();
    txMock.financeLedgerEntry.findMany.mockResolvedValueOnce([{
      id: 'fin-sporjinal-refund-1074533826897',
      vendorId: 'sporjinal',
      payoutStatus: 'PENDING',
    }]);
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

    expect(txMock.financeEvent.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          eventType: 'REFUND_RECORDED',
          idempotencyKey: 'fin-sporjinal-refund-1074533826897:REFUND_RECORDED',
        }),
        expect.objectContaining({
          eventType: 'COMMISSION_VAT_REVERSED',
          idempotencyKey: 'fin-sporjinal-refund-1074533826897:COMMISSION_VAT_REVERSED',
        }),
      ]),
      skipDuplicates: true,
    });
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
          idempotencyKey: `sporjinal:${NORMAL_REFUND_RECORD_ID}:VENDOR_DEBT_CREATED`,
        },
        update: {},
        create: expect.objectContaining({
          vendorId: 'sporjinal',
          type: 'VENDOR_DEBT_CREATED',
          amountMinor: -299792,
          currency: 'TRY',
          sourceType: 'shopify_refund',
          sourceId: NORMAL_REFUND_RECORD_ID,
          financeLedgerEntryId: NORMAL_REFUND_LEDGER_ID,
          refundRecordId: NORMAL_REFUND_RECORD_ID,
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
      .mockResolvedValueOnce({
        id: NORMAL_REFUND_LEDGER_ID,
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
              vendorId: 'sporjinal',
              entryType: 'sale',
              voidedAt: null,
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
      refundRecordId: NORMAL_REFUND_RECORD_ID,
      refundFinanceLedgerEntryId: NORMAL_REFUND_LEDGER_ID,
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
          refundFinanceLedgerEntryId: NORMAL_REFUND_LEDGER_ID,
        },
        update: {},
        create: expect.objectContaining({
          refundRecordId: NORMAL_REFUND_RECORD_ID,
          refundFinanceLedgerEntryId: NORMAL_REFUND_LEDGER_ID,
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
                refundFinanceLedgerEntryId: NORMAL_REFUND_LEDGER_ID,
                refundRecordId: NORMAL_REFUND_RECORD_ID,
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
