import { beforeEach, describe, expect, it, vi } from 'vitest';

const txMock = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  webhookEvent: {
    update: vi.fn(),
  },
  shopifyOrder: {
    findUnique: vi.fn(),
    update: vi.fn(),
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
  customerCancellationRequestItem: {
    findMany: vi.fn(),
    update: vi.fn(),
  },
  customerCancellationRequest: {
    update: vi.fn(),
  },
  operationalJob: {
    updateMany: vi.fn(),
  },
  orderShippingRefundClaim: {
    findMany: vi.fn(),
    updateMany: vi.fn(),
  },
  financeLedgerEntry: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    upsert: vi.fn(),
  },
  financeEvent: {
    findMany: vi.fn(),
    createMany: vi.fn(),
  },
  vendorBalanceEvent: {
    findFirst: vi.fn(),
    upsert: vi.fn(),
  },
  financeIntegrityAlert: {
    findMany: vi.fn(),
  },
  settlementRefundAdjustment: {
    findFirst: vi.fn(),
    upsert: vi.fn(),
  },
  refundEvidenceSnapshot: {
    findUnique: vi.fn(),
    create: vi.fn(),
  },
  refundTerminalEvidenceReview: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  refundTerminalEvidenceReviewEvent: {
    create: vi.fn(),
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

const {
  ingestShopifyRefundWebhook: ingestRawShopifyRefundWebhook,
  ingestVerifiedShopifyRefund,
} = await import('../backend/src/modules/shopify/refund-ingestion.service.js');

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

function canonicalReconciliationEvent() {
  return {
    ...webhookEvent(),
    id: 'webhook-canonical-shipping-refund-1',
    webhookId: 'canonical-refund-reconciliation-shipping-refund-1',
    idempotencyKey: 'canonical_refund_reconciliation:demo.myshopify.com:7621834670417:shipping-refund-1',
  };
}

const positiveMonetaryEvidence = {
  sourceShopifyRefundId: 'shipping-refund-1',
  classification: 'MONETARY_REFUND',
  monetaryRefundAmount: '100.00',
  currency: 'TRY',
  reasonCode: 'monetary_refund_verified',
  sanitizedWarnings: [],
} as const;

const CANONICAL_REFUNDED_STATUS = 'REFUNDED';

function monetaryEvidence(sourceShopifyRefundId: string, monetaryRefundAmount: string) {
  return {
    ...positiveMonetaryEvidence,
    sourceShopifyRefundId,
    monetaryRefundAmount,
  };
}

function shippingOnlyOwner(overrides: Record<string, unknown> = {}) {
  return {
    id: 'shipping-claim-1',
    status: 'ACTIVE',
    activeOrderKey: '7621834670417',
    ownerAttempt: {
      id: 'shipping-attempt-1',
      status: 'SHOPIFY_ACTION_PENDING',
      shopifyOrderId: '7621834670417',
      shopifyRefundId: 'gid://shopify/Refund/shipping-refund-1',
      refundShipping: true,
      refundLineItemsJson: [],
      vendorAllocationId: 'alloc-1029-sporjinal',
      vendorAllocation: {
        cancelRefundReviewStatus: 'SHOPIFY_ACTION_PENDING',
        order: {
          sourceShopifyOrderId: '7621834670417',
        },
      },
    },
    ...overrides,
  };
}

function setupShippingOnlyOrder() {
  txMock.shopifyOrder.findUnique.mockResolvedValue({
    id: 'shopify-order-db-1029',
    sourceShopifyOrderId: '7621834670417',
    sourceShopifyOrderNumber: '#1029',
    currency: 'TRY',
    financialStatus: 'partially_refunded',
    lineItems: [],
    allocations: [],
  });
  txMock.orderShippingRefundClaim.findMany.mockResolvedValue([shippingOnlyOwner()]);
  txMock.outboundShopifyRefundAttempt.updateMany.mockResolvedValue({ count: 1 });
  txMock.vendorAllocation.updateMany.mockResolvedValue({ count: 1 });
  txMock.orderShippingRefundClaim.updateMany.mockResolvedValue({ count: 1 });
}

function shippingOnlyPayload() {
  return {
    id: 'shipping-refund-1',
    order_id: '7621834670417',
    created_at: '2026-08-12T10:00:00.000Z',
    note: 'Checkout shipping refund',
    refund_line_items: [],
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
    financialStatus: 'paid',
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
    financialStatus: 'paid',
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
        supersededByLedgerId: 'fin-intermediate-sale-7621834670417',
        supersededBy: {
          id: 'fin-intermediate-sale-7621834670417',
          vendorId: 'intermediate-vendor',
          entryType: 'sale',
          voidedAt: new Date('2026-06-21T10:30:00.000Z'),
        },
      },
      {
        id: 'fin-intermediate-sale-7621834670417',
        vendorId: 'intermediate-vendor',
        entryType: 'sale',
        voidedAt: new Date('2026-06-21T10:30:00.000Z'),
        supersededByLedgerId: 'fin-sporjinal-sale-7621834670417',
        supersededBy: {
          id: 'fin-sporjinal-sale-7621834670417',
          vendorId: 'sporjinal',
          entryType: 'sale',
          voidedAt: null,
        },
      },
      {
        id: 'fin-sporjinal-sale-7621834670417',
        vendorId: 'sporjinal',
        entryType: 'sale',
        voidedAt: null,
        supersededByLedgerId: null,
        supersededBy: null,
      },
    ],
    economicTransfers: [{
      id: 'economic-transfer-1',
      status: 'completed',
      createdAt: new Date('2026-06-21T10:00:00.000Z'),
    }],
  });
  txMock.financeLedgerEntry.findUnique.mockResolvedValueOnce({
    id: 'fin-sporjinal-sale-7621834670417',
    entryType: 'sale',
    voidedAt: null,
    supersededByLedgerId: null,
    supersedes: [{
      id: 'fin-intermediate-sale-7621834670417',
      entryType: 'sale',
      voidedAt: new Date('2026-06-21T10:30:00.000Z'),
      supersededByLedgerId: 'fin-sporjinal-sale-7621834670417',
    }],
    economicTransfersTo: [],
    remainingAllocationSplitEvents: [],
    childAllocationSplitEvents: [],
  }).mockResolvedValueOnce({
    id: 'fin-intermediate-sale-7621834670417',
    entryType: 'sale',
    voidedAt: new Date('2026-06-21T10:30:00.000Z'),
    supersededByLedgerId: 'fin-sporjinal-sale-7621834670417',
    supersedes: [{
      id: 'fin-yalispor-sale-7621834670417',
      entryType: 'sale',
      voidedAt: new Date('2026-06-21T10:00:00.000Z'),
      supersededByLedgerId: 'fin-intermediate-sale-7621834670417',
    }],
    economicTransfersTo: [],
    remainingAllocationSplitEvents: [],
    childAllocationSplitEvents: [],
  }).mockResolvedValueOnce({
    id: 'fin-yalispor-sale-7621834670417',
    entryType: 'sale',
    voidedAt: new Date('2026-06-21T10:00:00.000Z'),
    supersededByLedgerId: 'fin-intermediate-sale-7621834670417',
    supersedes: [],
    economicTransfersTo: [],
    remainingAllocationSplitEvents: [],
    childAllocationSplitEvents: [],
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
    financialStatus: 'paid',
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

function canonicalEvidenceForPayload(payload: ReturnType<typeof refundPayload> | ReturnType<typeof splitRefundPayload>) {
  const total = payload.refund_line_items.reduce((sum, line) => sum + Number(line.subtotal), 0).toFixed(2);
  return {
    evidenceSource: 'mock' as const,
    sourceShopifyRefundId: String(payload.id),
    sourceShopifyOrderId: String(payload.order_id),
    monetaryClassification: 'MONETARY_REFUND' as const,
    refundTotalAmount: total,
    refundCurrency: 'TRY',
    selectedTransactions: [{
      transactionGid: `gid://shopify/OrderTransaction/${String(payload.id)}`,
      kind: 'REFUND',
      status: 'SUCCESS',
      amount: total,
      currency: 'TRY',
    }],
    lines: payload.refund_line_items.map((line) => ({
      sourceRefundLineItemId: String(line.id),
      sourceLineItemId: line.line_item_id,
      sku: line.line_item.sku,
      quantity: line.quantity,
      quantityProvenance: 'OBSERVED_VALID' as const,
      subtotalAmount: line.subtotal,
      subtotalAmountProvenance: 'OBSERVED' as const,
      subtotalCurrency: null,
    })),
  };
}

async function ingestShopifyRefundWebhook(input: {
  event: ReturnType<typeof webhookEvent>;
  payload: ReturnType<typeof refundPayload> | ReturnType<typeof splitRefundPayload>;
}) {
  const total = input.payload.refund_line_items.reduce((sum, line) => sum + Number(line.subtotal), 0).toFixed(2);
  return ingestVerifiedShopifyRefund({
    ...input,
    monetaryEvidence: monetaryEvidence(String(input.payload.id), total),
    canonicalEvidence: canonicalEvidenceForPayload(input.payload),
    canonicalFinancialStatus: null,
  });
}

describe('Shopify refund return linking', () => {
  beforeEach(() => {
    prismaMock.$transaction.mockClear();
    prismaMock.webhookEvent.update.mockReset();
    txMock.$queryRaw.mockReset();
    Object.values(txMock).forEach((model) => {
      Object.values(model).forEach((fn) => {
        if (typeof fn === 'function' && 'mockReset' in fn) {
          fn.mockReset();
        }
      });
    });
    txMock.financeIntegrityAlert.findMany.mockResolvedValue([]);
    txMock.$queryRaw.mockResolvedValue([{ advisoryLock: '' }]);
    txMock.refundEvidenceSnapshot.findUnique.mockResolvedValue(null);
    txMock.refundTerminalEvidenceReview.findUnique.mockResolvedValue(null);
    txMock.refundTerminalEvidenceReview.create.mockImplementation(async (input: { data: Record<string, unknown> }) => ({
      id: `terminal-review-${String(input.data.dedupeKey)}`,
      ...input.data,
    }));
    txMock.refundTerminalEvidenceReview.update.mockImplementation(async (input: { data: Record<string, unknown> }) => input.data);
    txMock.refundTerminalEvidenceReviewEvent.create.mockImplementation(async (input: { data: Record<string, unknown> }) => input.data);
    txMock.financeEvent.findMany.mockResolvedValue([]);
    txMock.settlementRefundAdjustment.findFirst.mockResolvedValue(null);
    txMock.vendorBalanceEvent.findFirst.mockResolvedValue(null);
    txMock.financeLedgerEntry.create.mockImplementation(async (input: { data: Record<string, unknown> }) => {
      await txMock.financeLedgerEntry.upsert({
        where: { id: input.data.id },
        update: input.data,
        create: input.data,
      });
      return input.data;
    });
    txMock.financeLedgerEntry.findUnique.mockImplementation(async (query: { where?: { id?: string } }) => ({
      id: query.where?.id ?? 'sale-active',
      entryType: 'sale',
      voidedAt: null,
      supersededByLedgerId: null,
      supersedes: [],
      economicTransfersTo: [],
      remainingAllocationSplitEvents: [],
      childAllocationSplitEvents: [],
    }));
    txMock.vendorAllocation.updateMany.mockResolvedValue({ count: 0 });
    txMock.outboundShopifyRefundAttempt.findFirst.mockResolvedValue(null);
    txMock.outboundShopifyRefundAttempt.updateMany.mockResolvedValue({ count: 0 });
    txMock.customerCancellationRequestItem.findMany.mockResolvedValue([]);
    txMock.orderShippingRefundClaim.findMany.mockResolvedValue([]);
    txMock.orderShippingRefundClaim.updateMany.mockResolvedValue({ count: 0 });
    txMock.shopifyOrder.update.mockResolvedValue({ id: 'shopify-order-db-1029' });
  });

  it('terminalizes an exactly owned verified shipping-only refund without product or vendor-finance writes', async () => {
    setupShippingOnlyOrder();

    const result = await ingestVerifiedShopifyRefund({
      event: webhookEvent() as never,
      payload: shippingOnlyPayload(),
      monetaryEvidence: positiveMonetaryEvidence,
      canonicalFinancialStatus: CANONICAL_REFUNDED_STATUS,
    });

    expect(result).toMatchObject({
      ok: true,
      processingStatus: 'processed',
      shopifyOrderId: '7621834670417',
      refundAllocationCount: 0,
      reconciliationMode: 'shipping_only',
      terminalStateChanged: true,
    });
    expect(txMock.orderShippingRefundClaim.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        shopifyOrderId: '7621834670417',
        ownerAttempt: {
          shopifyOrderId: '7621834670417',
          refundShipping: true,
          OR: [
            { shopifyRefundId: 'shipping-refund-1' },
            { shopifyRefundId: { endsWith: '/shipping-refund-1' } },
          ],
        },
      },
      take: 2,
    }));
    expect(txMock.outboundShopifyRefundAttempt.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'shipping-attempt-1',
        status: 'SHOPIFY_ACTION_PENDING',
        shopifyOrderId: '7621834670417',
        refundShipping: true,
        OR: [
          { shopifyRefundId: 'shipping-refund-1' },
          { shopifyRefundId: { endsWith: '/shipping-refund-1' } },
        ],
      },
      data: {
        status: 'RESOLVED',
        resolvedAt: expect.any(Date),
      },
    });
    expect(txMock.vendorAllocation.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'alloc-1029-sporjinal' }),
      data: { cancelRefundReviewStatus: 'RESOLVED' },
    }));
    expect(txMock.orderShippingRefundClaim.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'RELEASED',
        activeOrderKey: null,
        releaseReason: 'OWNER_ATTEMPT_RESOLVED',
      }),
    }));
    expect(txMock.webhookEvent.update).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'PROCESSED' }),
    }));
    expect(txMock.shopifyOrder.update).toHaveBeenCalledWith({
      where: {
        id: 'shopify-order-db-1029',
      },
      data: {
        financialStatus: 'refunded',
      },
    });
    expect(txMock.refundRecord.upsert).not.toHaveBeenCalled();
    expect(txMock.shopifyRefund.upsert).not.toHaveBeenCalled();
    expect(txMock.shopifyRefundLineItem.upsert).not.toHaveBeenCalled();
    expect(txMock.returnRecord.upsert).not.toHaveBeenCalled();
    expect(txMock.financeLedgerEntry.upsert).not.toHaveBeenCalled();
    expect(txMock.financeEvent.createMany).not.toHaveBeenCalled();
    expect(txMock.vendorBalanceEvent.upsert).not.toHaveBeenCalled();
    expect(txMock.settlementRefundAdjustment.upsert).not.toHaveBeenCalled();
  });

  it('does not terminalize a shipping-only refund owned by another allocation', async () => {
    setupShippingOnlyOrder();

    const result = await ingestVerifiedShopifyRefund({
      event: webhookEvent() as never,
      payload: shippingOnlyPayload(),
      monetaryEvidence: positiveMonetaryEvidence,
      canonicalFinancialStatus: CANONICAL_REFUNDED_STATUS,
      targetVendorAllocationId: 'alloc-other-vendor',
    });

    expect(result).toMatchObject({
      ok: true,
      refundAllocationCount: 0,
      reconciliationMode: 'shipping_only',
      terminalStateChanged: false,
    });
    expect(txMock.outboundShopifyRefundAttempt.updateMany).not.toHaveBeenCalled();
    expect(txMock.vendorAllocation.updateMany).not.toHaveBeenCalled();
    expect(txMock.orderShippingRefundClaim.updateMany).not.toHaveBeenCalled();
    expect(txMock.refundRecord.upsert).not.toHaveBeenCalled();
    expect(txMock.financeLedgerEntry.upsert).not.toHaveBeenCalled();
  });

  it('keeps webhook then canonical shipping-only reconciliation idempotent', async () => {
    setupShippingOnlyOrder();
    txMock.orderShippingRefundClaim.findMany
      .mockResolvedValueOnce([shippingOnlyOwner()])
      .mockResolvedValueOnce([shippingOnlyOwner({
        status: 'RELEASED',
        activeOrderKey: null,
        ownerAttempt: {
          ...shippingOnlyOwner().ownerAttempt,
          status: 'RESOLVED',
        },
      })]);

    await ingestVerifiedShopifyRefund({
      event: webhookEvent() as never,
      payload: shippingOnlyPayload(),
      monetaryEvidence: positiveMonetaryEvidence,
      canonicalFinancialStatus: CANONICAL_REFUNDED_STATUS,
    });
    await ingestVerifiedShopifyRefund({
      event: canonicalReconciliationEvent() as never,
      payload: shippingOnlyPayload(),
      monetaryEvidence: positiveMonetaryEvidence,
      canonicalFinancialStatus: CANONICAL_REFUNDED_STATUS,
    });

    expect(txMock.outboundShopifyRefundAttempt.updateMany).toHaveBeenCalledTimes(1);
    expect(txMock.orderShippingRefundClaim.updateMany).toHaveBeenCalledTimes(1);
    expect(txMock.refundRecord.upsert).not.toHaveBeenCalled();
    expect(txMock.financeLedgerEntry.upsert).not.toHaveBeenCalled();
    expect(txMock.financeEvent.createMany).not.toHaveBeenCalled();
    expect(txMock.refundTerminalEvidenceReview.create).not.toHaveBeenCalled();
    expect(txMock.refundTerminalEvidenceReview.update).not.toHaveBeenCalled();
    expect(txMock.refundTerminalEvidenceReviewEvent.create).not.toHaveBeenCalled();
  });

  it('keeps a duplicate live shipping-only webhook free of repeated side effects', async () => {
    setupShippingOnlyOrder();
    txMock.orderShippingRefundClaim.findMany
      .mockResolvedValueOnce([shippingOnlyOwner()])
      .mockResolvedValueOnce([shippingOnlyOwner({
        status: 'RELEASED',
        activeOrderKey: null,
        ownerAttempt: {
          ...shippingOnlyOwner().ownerAttempt,
          status: 'RESOLVED',
        },
      })]);

    await ingestVerifiedShopifyRefund({
      event: webhookEvent() as never,
      payload: shippingOnlyPayload(),
      monetaryEvidence: positiveMonetaryEvidence,
      canonicalFinancialStatus: CANONICAL_REFUNDED_STATUS,
    });
    await ingestVerifiedShopifyRefund({
      event: { ...webhookEvent(), id: 'webhook-refund-duplicate' } as never,
      payload: shippingOnlyPayload(),
      monetaryEvidence: positiveMonetaryEvidence,
      canonicalFinancialStatus: CANONICAL_REFUNDED_STATUS,
    });

    expect(txMock.outboundShopifyRefundAttempt.updateMany).toHaveBeenCalledTimes(1);
    expect(txMock.orderShippingRefundClaim.updateMany).toHaveBeenCalledTimes(1);
    expect(txMock.refundRecord.upsert).not.toHaveBeenCalled();
    expect(txMock.financeLedgerEntry.upsert).not.toHaveBeenCalled();
    expect(txMock.financeEvent.createMany).not.toHaveBeenCalled();
  });

  it('keeps canonical reconciliation then a later live webhook idempotent', async () => {
    setupShippingOnlyOrder();
    txMock.orderShippingRefundClaim.findMany
      .mockResolvedValueOnce([shippingOnlyOwner()])
      .mockResolvedValueOnce([shippingOnlyOwner({
        status: 'RELEASED',
        activeOrderKey: null,
        ownerAttempt: {
          ...shippingOnlyOwner().ownerAttempt,
          status: 'RESOLVED',
        },
      })]);

    await ingestVerifiedShopifyRefund({
      event: canonicalReconciliationEvent() as never,
      payload: shippingOnlyPayload(),
      monetaryEvidence: positiveMonetaryEvidence,
      canonicalFinancialStatus: CANONICAL_REFUNDED_STATUS,
    });
    await ingestVerifiedShopifyRefund({
      event: webhookEvent() as never,
      payload: shippingOnlyPayload(),
      monetaryEvidence: positiveMonetaryEvidence,
      canonicalFinancialStatus: CANONICAL_REFUNDED_STATUS,
    });

    expect(txMock.outboundShopifyRefundAttempt.updateMany).toHaveBeenCalledTimes(1);
    expect(txMock.orderShippingRefundClaim.updateMany).toHaveBeenCalledTimes(1);
    expect(txMock.refundRecord.upsert).not.toHaveBeenCalled();
    expect(txMock.shopifyRefundLineItem.upsert).not.toHaveBeenCalled();
    expect(txMock.financeLedgerEntry.upsert).not.toHaveBeenCalled();
    expect(txMock.financeEvent.createMany).not.toHaveBeenCalled();
    expect(txMock.vendorBalanceEvent.upsert).not.toHaveBeenCalled();
    expect(txMock.settlementRefundAdjustment.upsert).not.toHaveBeenCalled();
  });

  it('fails closed for a verified zero-line refund without one exact shipping owner', async () => {
    txMock.shopifyOrder.findUnique.mockResolvedValue({
      id: 'shopify-order-db-1029',
      sourceShopifyOrderId: '7621834670417',
      sourceShopifyOrderNumber: '#1029',
      currency: 'TRY',
      lineItems: [],
      allocations: [],
    });

    const result = await ingestVerifiedShopifyRefund({
      event: webhookEvent() as never,
      payload: shippingOnlyPayload(),
      monetaryEvidence: positiveMonetaryEvidence,
      canonicalFinancialStatus: CANONICAL_REFUNDED_STATUS,
    });

    expect(result).toMatchObject({
      ok: false,
      processingStatus: 'needs_attention',
      error: 'Shipping-only refund could not be matched to one exact order shipping refund owner.',
    });
    expect(txMock.outboundShopifyRefundAttempt.updateMany).not.toHaveBeenCalled();
    expect(txMock.orderShippingRefundClaim.updateMany).not.toHaveBeenCalled();
    expect(txMock.refundRecord.upsert).not.toHaveBeenCalled();
    expect(txMock.financeEvent.createMany).not.toHaveBeenCalled();
  });

  it('rejects a wrong-owner claim even when the database mock returns it', async () => {
    setupShippingOnlyOrder();
    txMock.orderShippingRefundClaim.findMany.mockResolvedValueOnce([shippingOnlyOwner({
      ownerAttempt: {
        ...shippingOnlyOwner().ownerAttempt,
        id: 'wrong-attempt',
        shopifyRefundId: 'different-refund',
      },
    })]);

    const result = await ingestVerifiedShopifyRefund({
      event: webhookEvent() as never,
      payload: shippingOnlyPayload(),
      monetaryEvidence: positiveMonetaryEvidence,
      canonicalFinancialStatus: CANONICAL_REFUNDED_STATUS,
    });

    expect(result).toMatchObject({
      ok: false,
      error: 'Shipping-only refund ownership evidence does not match the submitted refund attempt.',
    });
    expect(txMock.outboundShopifyRefundAttempt.updateMany).not.toHaveBeenCalled();
    expect(txMock.orderShippingRefundClaim.updateMany).not.toHaveBeenCalled();
  });

  it('does not allow unverified zero-line payloads into shipping-only reconciliation', async () => {
    setupShippingOnlyOrder();

    const result = await ingestRawShopifyRefundWebhook({
      event: webhookEvent() as never,
      payload: shippingOnlyPayload(),
    });

    expect(result).toMatchObject({
      ok: false,
      error: 'Shopify refunds/create payload did not include refund line items.',
    });
    expect(txMock.orderShippingRefundClaim.findMany).not.toHaveBeenCalled();
    expect(txMock.outboundShopifyRefundAttempt.updateMany).not.toHaveBeenCalled();
    expect(txMock.shopifyOrder.update).not.toHaveBeenCalled();
  });

  it('does not allow an unverified merchandise refund to create its first finance effect', async () => {
    setupOrder();

    const result = await ingestRawShopifyRefundWebhook({
      event: webhookEvent() as never,
      payload: refundPayload(),
    });

    expect(result).toMatchObject({
      ok: false,
      processingStatus: 'needs_attention',
      reasonCode: 'refund_finance_review_required',
      error: expect.stringContaining('verified canonical refund evidence is absent'),
    });
    expect(txMock.financeLedgerEntry.create).not.toHaveBeenCalled();
    expect(txMock.refundEvidenceSnapshot.create).not.toHaveBeenCalled();
  });

  it('keeps product plus checkout-shipping money on the existing product accounting path', async () => {
    setupOrder({ cancelRefundReviewStatus: 'SHOPIFY_ACTION_PENDING' });
    txMock.returnRecord.findFirst.mockResolvedValueOnce(null);
    const payload = refundPayload();

    const result = await ingestVerifiedShopifyRefund({
      event: webhookEvent() as never,
      payload,
      monetaryEvidence: monetaryEvidence('1074533826897', '3499.00'),
      canonicalEvidence: canonicalEvidenceForPayload(payload),
      canonicalFinancialStatus: CANONICAL_REFUNDED_STATUS,
    });

    expect(result).toMatchObject({ ok: true, refundAllocationCount: 1 });
    expect(txMock.refundRecord.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ amount: '3399.00' }),
    }));
    expect(txMock.shopifyRefundLineItem.upsert).toHaveBeenCalled();
    expect(txMock.financeLedgerEntry.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ amount: '3399.00' }),
    }));
    expect(txMock.financeEvent.createMany).toHaveBeenCalled();
    expect(txMock.orderShippingRefundClaim.findMany).not.toHaveBeenCalled();
    expect(txMock.shopifyOrder.update).toHaveBeenCalledWith({
      where: { id: 'shopify-order-db-1029' },
      data: { financialStatus: 'refunded' },
    });
  });

  it('keeps product-only refunds out of shipping-only owner matching', async () => {
    setupOrder();
    txMock.returnRecord.findFirst.mockResolvedValueOnce(null);
    const payload = refundPayload();

    const result = await ingestVerifiedShopifyRefund({
      event: webhookEvent() as never,
      payload,
      monetaryEvidence: monetaryEvidence('1074533826897', '3399.00'),
      canonicalEvidence: canonicalEvidenceForPayload(payload),
      canonicalFinancialStatus: 'PARTIALLY_REFUNDED',
    });

    expect(result).toMatchObject({ ok: true, refundAllocationCount: 1 });
    expect(txMock.refundRecord.upsert).toHaveBeenCalled();
    expect(txMock.financeLedgerEntry.upsert).toHaveBeenCalled();
    expect(txMock.orderShippingRefundClaim.findMany).not.toHaveBeenCalled();
    expect(txMock.shopifyOrder.update).toHaveBeenCalledWith({
      where: { id: 'shopify-order-db-1029' },
      data: { financialStatus: 'partially_refunded' },
    });
  });

  it('fails closed before first merchandise finance when canonical line evidence is incomplete', async () => {
    setupOrder();
    const payload = refundPayload();
    const canonicalEvidence = canonicalEvidenceForPayload(payload);
    canonicalEvidence.lines[0] = {
      ...canonicalEvidence.lines[0],
      quantity: null as never,
      quantityProvenance: 'ABSENT',
    };

    const result = await ingestVerifiedShopifyRefund({
      event: webhookEvent() as never,
      payload,
      monetaryEvidence: monetaryEvidence('1074533826897', '3399.00'),
      canonicalEvidence,
      canonicalFinancialStatus: 'PARTIALLY_REFUNDED',
    });

    expect(result).toMatchObject({
      ok: false,
      action: 'received_needs_attention',
      processingStatus: 'needs_attention',
      reasonCode: 'canonical_refund_line_evidence_incomplete',
      error: expect.stringContaining('refund-line-1:missing_observed_quantity'),
    });
    expect(txMock.webhookEvent.update).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'FAILED' }),
    }));
    expect(txMock.refundRecord.upsert).not.toHaveBeenCalled();
    expect(txMock.returnRecord.upsert).not.toHaveBeenCalled();
    expect(txMock.shopifyRefundLineItem.upsert).not.toHaveBeenCalled();
    expect(txMock.financeLedgerEntry.upsert).not.toHaveBeenCalled();
    expect(txMock.settlementRefundAdjustment.upsert).not.toHaveBeenCalled();
    expect(txMock.vendorBalanceEvent.upsert).not.toHaveBeenCalled();
    expect(txMock.financeEvent.createMany).not.toHaveBeenCalled();
  });

  it('does not let SKU fallback authorize first finance without canonical original line identity', async () => {
    setupOrder();
    const payload = refundPayload();
    payload.refund_line_items[0].line_item_id = null as never;
    payload.refund_line_items[0].line_item.id = null as never;
    const canonicalEvidence = canonicalEvidenceForPayload(payload);

    const result = await ingestVerifiedShopifyRefund({
      event: webhookEvent() as never,
      payload,
      monetaryEvidence: monetaryEvidence('1074533826897', '3399.00'),
      canonicalEvidence,
      canonicalFinancialStatus: 'PARTIALLY_REFUNDED',
    });

    expect(result).toMatchObject({
      ok: false,
      reasonCode: 'canonical_refund_line_evidence_incomplete',
      error: expect.stringContaining('missing_original_line_item_id'),
    });
    expect(txMock.financeLedgerEntry.upsert).not.toHaveBeenCalled();
    expect(txMock.refundRecord.upsert).not.toHaveBeenCalled();
  });

  it('treats a voided historical refund ledger as prior finance and does not backfill a snapshot', async () => {
    setupOrder();
    txMock.financeLedgerEntry.findMany.mockReset().mockResolvedValueOnce([{
      id: NORMAL_REFUND_LEDGER_ID,
      vendorId: 'sporjinal',
      vendorAllocationId: 'alloc-1029-sporjinal',
      payoutStatus: 'PENDING',
      voidedAt: new Date('2026-01-02T00:00:00.000Z'),
    }]);
    const payload = refundPayload();
    const canonicalEvidence = canonicalEvidenceForPayload(payload);
    canonicalEvidence.lines = [];

    const result = await ingestVerifiedShopifyRefund({
      event: webhookEvent() as never,
      payload,
      monetaryEvidence: monetaryEvidence('1074533826897', '3399.00'),
      canonicalEvidence,
      canonicalFinancialStatus: 'PARTIALLY_REFUNDED',
    });

    expect(result).toMatchObject({
      ok: false,
      processingStatus: 'needs_attention',
      error: expect.stringContaining('historical refund finance has no accepted evidence snapshot'),
    });
    expect(txMock.financeLedgerEntry.create).not.toHaveBeenCalled();
    expect(txMock.refundEvidenceSnapshot.create).not.toHaveBeenCalled();
  });

  it('fails closed when a deterministic refund ledger identity belongs to another allocation', async () => {
    setupOrder();
    txMock.financeLedgerEntry.findMany.mockReset().mockResolvedValueOnce([{
      id: NORMAL_REFUND_LEDGER_ID,
      vendorAllocationId: 'alloc-other',
    }]);
    const payload = refundPayload();

    const result = await ingestVerifiedShopifyRefund({
      event: webhookEvent() as never,
      payload,
      monetaryEvidence: monetaryEvidence('1074533826897', '3399.00'),
      canonicalEvidence: canonicalEvidenceForPayload(payload),
      canonicalFinancialStatus: 'PARTIALLY_REFUNDED',
    });

    expect(result).toMatchObject({
      ok: false,
      processingStatus: 'needs_attention',
      error: expect.stringContaining('legacy refund finance cannot be attributed to one allocation'),
    });
    expect(txMock.financeLedgerEntry.create).not.toHaveBeenCalled();
    expect(txMock.refundEvidenceSnapshot.create).not.toHaveBeenCalled();
  });

  it('processes a complete allocation while routing an incomplete sibling allocation to review', async () => {
    setupSplitOrderRefund({ refundSourceLine: true, refundChildLine: true });
    const payload = splitRefundPayload({ source: true, child: true });
    const canonicalEvidence = canonicalEvidenceForPayload(payload);
    canonicalEvidence.lines[1] = {
      ...canonicalEvidence.lines[1],
      subtotalAmount: null as never,
      subtotalAmountProvenance: 'ABSENT',
    };

    const result = await ingestVerifiedShopifyRefund({
      event: webhookEvent() as never,
      payload,
      monetaryEvidence: monetaryEvidence('refund-split', '150.00'),
      canonicalEvidence,
      canonicalFinancialStatus: 'PARTIALLY_REFUNDED',
    });

    expect(result).toMatchObject({
      ok: false,
      reasonCode: 'canonical_refund_line_evidence_incomplete',
      error: expect.stringContaining('alloc-child[refund-line-child:missing_observed_subtotal]'),
    });
    expect(txMock.financeLedgerEntry.upsert).toHaveBeenCalledTimes(1);
    expect(txMock.financeLedgerEntry.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ vendorAllocationId: 'alloc-source' }),
    }));
    expect(txMock.financeLedgerEntry.upsert).not.toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ vendorAllocationId: 'alloc-child' }),
    }));
  });

  it('does not let incomplete sibling evidence block a complete targeted allocation', async () => {
    setupSplitOrderRefund({ refundSourceLine: true, refundChildLine: true });
    txMock.vendorAllocation.findUnique.mockReset().mockResolvedValue({
      id: 'alloc-source',
      financeEntries: [{
        id: 'fin-sporjinal-sale-split-order-alloc-source',
        vendorId: 'sporjinal',
        entryType: 'sale',
        voidedAt: null,
        supersededByLedgerId: null,
        supersededBy: null,
      }],
      economicTransfers: [],
    });
    const payload = splitRefundPayload({ source: true, child: true });
    const canonicalEvidence = canonicalEvidenceForPayload(payload);
    canonicalEvidence.lines[1] = {
      ...canonicalEvidence.lines[1],
      quantity: null as never,
      quantityProvenance: 'ABSENT',
    };

    const result = await ingestVerifiedShopifyRefund({
      event: webhookEvent() as never,
      payload,
      monetaryEvidence: monetaryEvidence('refund-split', '150.00'),
      canonicalEvidence,
      canonicalFinancialStatus: 'PARTIALLY_REFUNDED',
      targetVendorAllocationId: 'alloc-source',
    });

    expect(result).toMatchObject({ ok: true, refundAllocationCount: 1 });
    expect(txMock.financeLedgerEntry.upsert).toHaveBeenCalledTimes(1);
    expect(txMock.financeLedgerEntry.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ vendorAllocationId: 'alloc-source' }),
    }));
  });

  it('reconciles only the linked exact customer cancellation item after verified monetary quantity evidence', async () => {
    setupOrder();
    txMock.returnRecord.findFirst.mockResolvedValueOnce(null);
    txMock.customerCancellationRequestItem.findMany.mockResolvedValueOnce([{
      id: 'cancel-item-1',
      requestId: 'cancel-request-1',
      requestedQuantity: 1,
      shopifyOrderLineItem: { sourceLineItemId: '20346971095377' },
      request: { items: [{ id: 'cancel-item-1', status: 'APPROVED_FOR_REFUND' }] },
    }]);
    const payload = refundPayload();

    const result = await ingestVerifiedShopifyRefund({
      event: webhookEvent() as never,
      payload,
      monetaryEvidence: monetaryEvidence('1074533826897', '3399.00'),
      canonicalEvidence: canonicalEvidenceForPayload(payload),
      canonicalFinancialStatus: 'PARTIALLY_REFUNDED',
    });

    expect(result).toMatchObject({ ok: true, refundAllocationCount: 1 });
    expect(txMock.customerCancellationRequestItem.update).toHaveBeenCalledWith({
      where: { id: 'cancel-item-1' },
      data: { status: 'REFUNDED_AWAITING_ORDER_CANCEL', resolvedQuantity: 1 },
    });
    expect(txMock.outboundShopifyRefundAttempt.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { customerCancellationRequestItemId: 'cancel-item-1' },
      data: expect.objectContaining({ status: 'RESOLVED', shopifyRefundId: '1074533826897' }),
    }));
    expect(txMock.operationalJob.updateMany).not.toHaveBeenCalled();
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
    expect(txMock.refundEvidenceSnapshot.create).toHaveBeenCalledTimes(2);
    expect(txMock.refundEvidenceSnapshot.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sourceShopifyRefundId: 'refund-split',
        vendorAllocationId: 'alloc-source',
      }),
    });
    expect(txMock.refundEvidenceSnapshot.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sourceShopifyRefundId: 'refund-split',
        vendorAllocationId: 'alloc-child',
      }),
    });
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

  it('keeps verified canonical refund ingestion scoped to the requested allocation', async () => {
    setupSplitOrderRefund({
      refundSourceLine: true,
      refundChildLine: true,
      sourceCancelRefundReviewStatus: 'PENDING_REVIEW',
      childCancelRefundReviewStatus: 'PENDING_REVIEW',
    });
    txMock.vendorAllocation.findUnique.mockReset().mockResolvedValue({
      id: 'alloc-source',
      financeEntries: [{
        id: 'fin-sporjinal-sale-split-order-alloc-source',
        vendorId: 'sporjinal',
        entryType: 'sale',
        voidedAt: null,
        supersededByLedgerId: null,
        supersededBy: null,
      }],
      economicTransfers: [],
    });
    const payload = splitRefundPayload({ source: true, child: true });

    const result = await ingestVerifiedShopifyRefund({
      event: webhookEvent() as never,
      payload,
      monetaryEvidence: monetaryEvidence('refund-split', '150.00'),
      canonicalEvidence: canonicalEvidenceForPayload(payload),
      canonicalFinancialStatus: 'PARTIALLY_REFUNDED',
      targetVendorAllocationId: 'alloc-source',
    });

    expect(result).toMatchObject({ ok: true, refundAllocationCount: 1 });
    expect(txMock.refundRecord.upsert).toHaveBeenCalledTimes(1);
    expect(txMock.refundRecord.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ vendorAllocationId: 'alloc-source', amount: '100.00' }),
    }));
    expect(txMock.refundRecord.upsert).not.toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ vendorAllocationId: 'alloc-child' }),
    }));
    expect(txMock.returnRecord.upsert).not.toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ vendorAllocationId: 'alloc-child' }),
    }));
    expect(txMock.financeLedgerEntry.upsert).not.toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ vendorAllocationId: 'alloc-child' }),
    }));
    expect(JSON.stringify(txMock.settlementRefundAdjustment.upsert.mock.calls)).not.toContain('alloc-child');
    expect(JSON.stringify(txMock.vendorBalanceEvent.upsert.mock.calls)).not.toContain('alloc-child');
    expect(JSON.stringify(txMock.financeEvent.createMany.mock.calls)).not.toContain('alloc-child');
    expect(txMock.vendorAllocation.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'alloc-child' }),
    }));
    expect(txMock.customerCancellationRequestItem.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ vendorAllocationId: 'alloc-source' }),
    }));
  });

  it('can scope the same canonical refund to the other allocation', async () => {
    setupSplitOrderRefund({
      refundSourceLine: true,
      refundChildLine: true,
      sourceCancelRefundReviewStatus: 'PENDING_REVIEW',
      childCancelRefundReviewStatus: 'PENDING_REVIEW',
    });
    txMock.vendorAllocation.findUnique.mockReset().mockResolvedValue({
      id: 'alloc-child',
      financeEntries: [{
        id: 'fin-sporjinal-sale-split-order-alloc-child',
        vendorId: 'sporjinal',
        entryType: 'sale',
        voidedAt: null,
        supersededByLedgerId: null,
        supersededBy: null,
      }],
      economicTransfers: [],
    });
    const payload = splitRefundPayload({ source: true, child: true });

    const result = await ingestVerifiedShopifyRefund({
      event: webhookEvent() as never,
      payload,
      monetaryEvidence: monetaryEvidence('refund-split', '150.00'),
      canonicalEvidence: canonicalEvidenceForPayload(payload),
      canonicalFinancialStatus: 'PARTIALLY_REFUNDED',
      targetVendorAllocationId: 'alloc-child',
    });

    expect(result).toMatchObject({ ok: true, refundAllocationCount: 1 });
    expect(txMock.refundRecord.upsert).toHaveBeenCalledTimes(1);
    expect(txMock.refundRecord.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ vendorAllocationId: 'alloc-child', amount: '50.00' }),
    }));
    expect(txMock.refundRecord.upsert).not.toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ vendorAllocationId: 'alloc-source' }),
    }));
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
    expect(txMock.refundEvidenceSnapshot.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        historicalEconomicVendorId: 'sporjinal',
        historicalSaleFinanceLedgerEntryId: 'fin-sporjinal-sale-7621834670417',
        supersededSaleLedgerIdsJson: [
          'fin-intermediate-sale-7621834670417',
          'fin-yalispor-sale-7621834670417',
        ],
      }),
    });
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
              supersededFromLedgerIds: [
                'fin-yalispor-sale-7621834670417',
                'fin-intermediate-sale-7621834670417',
              ],
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
        vendorAllocationId: 'alloc-1029-yalispor',
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
      error: expect.stringContaining('historical refund finance has no accepted evidence snapshot'),
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

  it('does not repair or mutate historical refund finance when its evidence snapshot is absent', async () => {
    setupOrder();
    txMock.financeLedgerEntry.findMany.mockReset();
    txMock.financeLedgerEntry.findFirst.mockReset();
    txMock.financeEvent.createMany.mockReset();
    txMock.financeLedgerEntry.findMany.mockResolvedValueOnce([{
      id: 'fin-sporjinal-refund-1074533826897',
      vendorId: 'sporjinal',
      vendorAllocationId: 'alloc-1029-sporjinal',
      payoutStatus: 'PENDING',
    }]);
    txMock.financeLedgerEntry.findFirst.mockResolvedValueOnce({
      commissionPercentSnapshot: 10,
      commissionVatPercentSnapshot: 18,
    });
    txMock.returnRecord.findFirst.mockResolvedValueOnce(null);

    const result = await ingestShopifyRefundWebhook({
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

    expect(result).toMatchObject({
      ok: false,
      processingStatus: 'needs_attention',
      error: expect.stringContaining('historical refund finance has no accepted evidence snapshot'),
    });
    expect(txMock.financeEvent.createMany).not.toHaveBeenCalled();
    expect(txMock.financeLedgerEntry.create).not.toHaveBeenCalled();
    expect(txMock.refundEvidenceSnapshot.create).not.toHaveBeenCalled();
    expect(txMock.refundTerminalEvidenceReview.create).not.toHaveBeenCalled();
    expect(txMock.refundTerminalEvidenceReview.update).not.toHaveBeenCalled();
    expect(txMock.refundTerminalEvidenceReviewEvent.create).not.toHaveBeenCalled();
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
    expect(txMock.financeLedgerEntry.create.mock.invocationCallOrder[0]).toBeLessThan(
      txMock.refundEvidenceSnapshot.create.mock.invocationCallOrder[0],
    );
    expect(txMock.refundEvidenceSnapshot.create.mock.invocationCallOrder[0]).toBeLessThan(
      txMock.vendorBalanceEvent.upsert.mock.invocationCallOrder[0],
    );
  });

  it('marks refund ledger as adjustment required when refund arrives after settlement approval before payment', async () => {
    setupOrder();
    txMock.financeLedgerEntry.findUnique.mockReset();
    txMock.financeLedgerEntry.findUnique
      .mockResolvedValueOnce({
        id: 'fin-sporjinal-sale-alloc-1029-sporjinal',
        entryType: 'sale',
        voidedAt: null,
        supersededByLedgerId: null,
        supersedes: [],
        economicTransfersTo: [],
        remainingAllocationSplitEvents: [],
        childAllocationSplitEvents: [],
      })
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
    expect(txMock.financeLedgerEntry.create.mock.invocationCallOrder[0]).toBeLessThan(
      txMock.refundEvidenceSnapshot.create.mock.invocationCallOrder[0],
    );
    expect(txMock.refundEvidenceSnapshot.create.mock.invocationCallOrder[0]).toBeLessThan(
      txMock.settlementRefundAdjustment.upsert.mock.invocationCallOrder[0],
    );
  });

  it('creates the first refund ledger and immutable normalized evidence snapshot in the same transaction', async () => {
    setupOrder();
    txMock.returnRecord.findFirst.mockResolvedValueOnce(null);
    const payload = refundPayload();
    const acceptanceStartedAt = Date.now();

    const result = await ingestVerifiedShopifyRefund({
      event: webhookEvent() as never,
      payload,
      monetaryEvidence: monetaryEvidence('1074533826897', '3399.00'),
      canonicalEvidence: canonicalEvidenceForPayload(payload),
      canonicalFinancialStatus: 'PARTIALLY_REFUNDED',
    });
    const acceptanceFinishedAt = Date.now();

    expect(result).toMatchObject({ ok: true, refundAllocationCount: 1 });
    expect(txMock.$queryRaw).toHaveBeenCalledTimes(1);
    expect(txMock.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      txMock.refundEvidenceSnapshot.findUnique.mock.invocationCallOrder[0],
    );
    expect(txMock.financeLedgerEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: NORMAL_REFUND_LEDGER_ID,
        vendorAllocationId: 'alloc-1029-sporjinal',
        vendorId: 'sporjinal',
        entryType: 'refund',
        amount: '3399.00',
      }),
    });
    expect(txMock.refundEvidenceSnapshot.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sourceShopifyRefundId: '1074533826897',
        sourceShopifyOrderId: '7621834670417',
        vendorAllocationId: 'alloc-1029-sporjinal',
        refundRecordId: NORMAL_REFUND_RECORD_ID,
        refundFinanceLedgerEntryId: NORMAL_REFUND_LEDGER_ID,
        historicalEconomicVendorId: 'sporjinal',
        historicalSaleFinanceLedgerEntryId: 'fin-sporjinal-sale-alloc-1029-sporjinal',
        monetaryClassification: 'MONETARY_REFUND',
        refundTotalAmount: '3399',
        currency: 'TRY',
        evidenceHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        hashAlgorithm: 'SHA-256',
        evidenceVersion: 1,
        normalizationVersion: 1,
        evidenceSource: 'mock',
        capturedAt: expect.any(Date),
        supersededSaleLedgerIdsJson: [],
      }),
    });
    const capturedAt = txMock.refundEvidenceSnapshot.create.mock.calls[0]![0].data.capturedAt as Date;
    expect(capturedAt.getTime()).toBeGreaterThanOrEqual(acceptanceStartedAt);
    expect(capturedAt.getTime()).toBeLessThanOrEqual(acceptanceFinishedAt);
    expect(txMock.financeLedgerEntry.create.mock.invocationCallOrder[0]).toBeLessThan(
      txMock.refundEvidenceSnapshot.create.mock.invocationCallOrder[0],
    );
  });

  it('treats the same accepted evidence hash as an already-processed finance no-op', async () => {
    setupOrder();
    txMock.returnRecord.findFirst.mockResolvedValueOnce(null);
    const payload = refundPayload();
    const canonicalEvidence = canonicalEvidenceForPayload(payload);
    await ingestVerifiedShopifyRefund({
      event: webhookEvent() as never,
      payload,
      monetaryEvidence: monetaryEvidence('1074533826897', '3399.00'),
      canonicalEvidence,
      canonicalFinancialStatus: 'PARTIALLY_REFUNDED',
    });
    const accepted = txMock.refundEvidenceSnapshot.create.mock.calls[0]![0].data;

    txMock.financeLedgerEntry.create.mockClear();
    txMock.refundEvidenceSnapshot.create.mockClear();
    txMock.settlementRefundAdjustment.upsert.mockClear();
    txMock.vendorBalanceEvent.upsert.mockClear();
    txMock.financeEvent.createMany.mockClear();
    setupOrder();
    txMock.refundEvidenceSnapshot.findUnique.mockResolvedValueOnce({ id: 'snapshot-1', ...accepted });

    const replay = await ingestVerifiedShopifyRefund({
      event: webhookEvent() as never,
      payload,
      monetaryEvidence: monetaryEvidence('1074533826897', '3399.00'),
      canonicalEvidence,
      canonicalFinancialStatus: 'PARTIALLY_REFUNDED',
    });

    expect(replay).toMatchObject({ ok: true, processingStatus: 'processed', refundAllocationCount: 1 });
    expect(txMock.financeLedgerEntry.create).not.toHaveBeenCalled();
    expect(txMock.refundEvidenceSnapshot.create).not.toHaveBeenCalled();
    expect(txMock.settlementRefundAdjustment.upsert).not.toHaveBeenCalled();
    expect(txMock.vendorBalanceEvent.upsert).not.toHaveBeenCalled();
    expect(txMock.financeEvent.createMany).not.toHaveBeenCalled();
    expect(txMock.refundTerminalEvidenceReview.create).not.toHaveBeenCalled();
    expect(txMock.refundTerminalEvidenceReview.update).not.toHaveBeenCalled();
    expect(txMock.refundTerminalEvidenceReviewEvent.create).not.toHaveBeenCalled();
  });

  it.each([
    [
      'different hash',
      { evidenceHash: '0'.repeat(64) },
      'refund_evidence_hash_mismatch',
      { evidenceHashMismatch: true, evidenceVersionMismatch: false, normalizationVersionMismatch: false },
    ],
    [
      'evidence version mismatch',
      { evidenceVersion: 2 },
      'refund_evidence_version_mismatch',
      { evidenceHashMismatch: false, evidenceVersionMismatch: true, normalizationVersionMismatch: false },
    ],
    [
      'normalization version mismatch',
      { normalizationVersion: 2 },
      'refund_normalization_version_mismatch',
      { evidenceHashMismatch: false, evidenceVersionMismatch: false, normalizationVersionMismatch: true },
    ],
    [
      'multiple mismatches',
      { evidenceHash: '0'.repeat(64), evidenceVersion: 2 },
      'refund_evidence_multiple_mismatch',
      { evidenceHashMismatch: true, evidenceVersionMismatch: true, normalizationVersionMismatch: false },
    ],
  ])('routes %s to durable review without mutating accepted finance', async (
    _label,
    mismatch,
    conflictCategory,
    mismatchSummary,
  ) => {
    setupOrder();
    txMock.returnRecord.findFirst.mockResolvedValueOnce(null);
    const payload = refundPayload();
    const canonicalEvidence = canonicalEvidenceForPayload(payload);
    await ingestVerifiedShopifyRefund({
      event: webhookEvent() as never,
      payload,
      monetaryEvidence: monetaryEvidence('1074533826897', '3399.00'),
      canonicalEvidence,
      canonicalFinancialStatus: 'PARTIALLY_REFUNDED',
    });
    const accepted = txMock.refundEvidenceSnapshot.create.mock.calls[0]![0].data;

    txMock.financeLedgerEntry.create.mockClear();
    txMock.refundEvidenceSnapshot.create.mockClear();
    txMock.settlementRefundAdjustment.upsert.mockClear();
    txMock.vendorBalanceEvent.upsert.mockClear();
    txMock.financeEvent.createMany.mockClear();
    setupOrder();
    txMock.refundEvidenceSnapshot.findUnique.mockResolvedValueOnce({ id: 'snapshot-1', ...accepted, ...mismatch });

    const replay = await ingestVerifiedShopifyRefund({
      event: webhookEvent() as never,
      payload,
      monetaryEvidence: monetaryEvidence('1074533826897', '3399.00'),
      canonicalEvidence,
      canonicalFinancialStatus: 'PARTIALLY_REFUNDED',
    });

    expect(replay).toMatchObject({
      ok: false,
      processingStatus: 'needs_attention',
      reasonCode: 'refund_terminal_evidence_conflict',
      error: expect.stringContaining('terminal refund evidence conflicts with accepted snapshot'),
    });
    expect(txMock.refundTerminalEvidenceReview.create).toHaveBeenCalledWith({
      data: {
        sourceShopifyRefundId: '1074533826897',
        sourceShopifyOrderId: '7621834670417',
        vendorAllocationId: 'alloc-1029-sporjinal',
        terminalRefundFinanceLedgerEntryId: NORMAL_REFUND_LEDGER_ID,
        refundRecordId: NORMAL_REFUND_RECORD_ID,
        economicVendorId: 'sporjinal',
        storedEvidenceSnapshotId: 'snapshot-1',
        dedupeKey: expect.stringMatching(/^[a-f0-9]{64}$/),
        conflictCategory,
        storedEvidenceHash: 'evidenceHash' in mismatch
          ? mismatch.evidenceHash
          : accepted.evidenceHash,
        incomingEvidenceHash: accepted.evidenceHash,
        conflictSummaryJson: {
          storedEvidenceVersion: 'evidenceVersion' in mismatch
            ? mismatch.evidenceVersion
            : accepted.evidenceVersion,
          incomingEvidenceVersion: accepted.evidenceVersion,
          storedNormalizationVersion: 'normalizationVersion' in mismatch
            ? mismatch.normalizationVersion
            : accepted.normalizationVersion,
          incomingNormalizationVersion: accepted.normalizationVersion,
          ...mismatchSummary,
        },
        status: 'ACTIVE',
        firstObservedAt: expect.any(Date),
        lastObservedAt: expect.any(Date),
        occurrenceCount: 1,
      },
    });
    const review = txMock.refundTerminalEvidenceReview.create.mock.calls[0]![0].data;
    expect(review.firstObservedAt).toEqual(review.lastObservedAt);
    expect(txMock.refundTerminalEvidenceReviewEvent.create).toHaveBeenCalledWith({
      data: {
        reviewId: `terminal-review-${String(review.dedupeKey)}`,
        eventType: 'DETECTED',
      },
    });
    expect(txMock.refundTerminalEvidenceReview.update).not.toHaveBeenCalled();
    expect(txMock.financeLedgerEntry.create).not.toHaveBeenCalled();
    expect(txMock.refundEvidenceSnapshot.create).not.toHaveBeenCalled();
    expect(txMock.settlementRefundAdjustment.upsert).not.toHaveBeenCalled();
    expect(txMock.vendorBalanceEvent.upsert).not.toHaveBeenCalled();
    expect(txMock.financeEvent.createMany).not.toHaveBeenCalled();
  });

  it('deduplicates a repeated identical terminal evidence conflict and increments only observation metadata', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-09-17T10:00:00.000Z'));
      setupOrder();
      txMock.returnRecord.findFirst.mockResolvedValueOnce(null);
      const payload = refundPayload();
      const canonicalEvidence = canonicalEvidenceForPayload(payload);
      await ingestVerifiedShopifyRefund({
        event: webhookEvent() as never,
        payload,
        monetaryEvidence: monetaryEvidence('1074533826897', '3399.00'),
        canonicalEvidence,
        canonicalFinancialStatus: 'PARTIALLY_REFUNDED',
      });
      const accepted = txMock.refundEvidenceSnapshot.create.mock.calls[0]![0].data;
      const stored = { id: 'snapshot-1', ...accepted, evidenceHash: '0'.repeat(64) };

      txMock.financeLedgerEntry.create.mockClear();
      txMock.refundEvidenceSnapshot.create.mockClear();
      txMock.settlementRefundAdjustment.upsert.mockClear();
      txMock.vendorBalanceEvent.upsert.mockClear();
      txMock.financeEvent.createMany.mockClear();
      txMock.refundEvidenceSnapshot.findUnique.mockResolvedValue(stored);
      txMock.refundTerminalEvidenceReview.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'terminal-review-existing', status: 'ACTIVE', occurrenceCount: 1 });

      setupOrder();
      const first = await ingestVerifiedShopifyRefund({
        event: webhookEvent() as never,
        payload,
        monetaryEvidence: monetaryEvidence('1074533826897', '3399.00'),
        canonicalEvidence,
        canonicalFinancialStatus: 'PARTIALLY_REFUNDED',
      });
      const created = txMock.refundTerminalEvidenceReview.create.mock.calls[0]![0].data;
      vi.setSystemTime(new Date('2026-09-17T10:05:00.000Z'));
      setupOrder();
      const second = await ingestVerifiedShopifyRefund({
        event: webhookEvent() as never,
        payload,
        monetaryEvidence: monetaryEvidence('1074533826897', '3399.00'),
        canonicalEvidence,
        canonicalFinancialStatus: 'PARTIALLY_REFUNDED',
      });

      expect(first).toMatchObject({ ok: false, reasonCode: 'refund_terminal_evidence_conflict' });
      expect(second).toMatchObject({ ok: false, reasonCode: 'refund_terminal_evidence_conflict' });
      expect(txMock.refundTerminalEvidenceReview.create).toHaveBeenCalledTimes(1);
      expect(txMock.refundTerminalEvidenceReview.update).toHaveBeenCalledTimes(1);
      expect(txMock.refundTerminalEvidenceReview.update).toHaveBeenCalledWith({
        where: { dedupeKey: created.dedupeKey },
        data: {
          occurrenceCount: { increment: 1 },
          lastObservedAt: new Date('2026-09-17T10:05:00.000Z'),
        },
      });
      expect(txMock.refundTerminalEvidenceReview.update.mock.calls[0]![0].data).not.toHaveProperty('firstObservedAt');
      expect(txMock.refundTerminalEvidenceReview.update.mock.calls[0]![0].data).not.toHaveProperty('status');
      expect(txMock.refundTerminalEvidenceReviewEvent.create).toHaveBeenCalledTimes(1);
      expect(txMock.financeLedgerEntry.create).not.toHaveBeenCalled();
      expect(txMock.refundEvidenceSnapshot.create).not.toHaveBeenCalled();
      expect(txMock.settlementRefundAdjustment.upsert).not.toHaveBeenCalled();
      expect(txMock.vendorBalanceEvent.upsert).not.toHaveBeenCalled();
      expect(txMock.financeEvent.createMany).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('creates separate reviews for distinct incoming terminal evidence conflicts', async () => {
    setupOrder();
    txMock.returnRecord.findFirst.mockResolvedValueOnce(null);
    const payload = refundPayload();
    const canonicalEvidence = canonicalEvidenceForPayload(payload);
    await ingestVerifiedShopifyRefund({
      event: webhookEvent() as never,
      payload,
      monetaryEvidence: monetaryEvidence('1074533826897', '3399.00'),
      canonicalEvidence,
      canonicalFinancialStatus: 'PARTIALLY_REFUNDED',
    });
    const accepted = txMock.refundEvidenceSnapshot.create.mock.calls[0]![0].data;
    const stored = { id: 'snapshot-1', ...accepted, evidenceHash: '0'.repeat(64) };
    const secondCanonicalEvidence = {
      ...canonicalEvidence,
      selectedTransactions: [{
        ...canonicalEvidence.selectedTransactions[0],
        transactionGid: 'gid://shopify/OrderTransaction/different-conflict',
      }],
    };

    txMock.financeLedgerEntry.create.mockClear();
    txMock.refundEvidenceSnapshot.create.mockClear();
    txMock.settlementRefundAdjustment.upsert.mockClear();
    txMock.vendorBalanceEvent.upsert.mockClear();
    txMock.financeEvent.createMany.mockClear();
    txMock.refundEvidenceSnapshot.findUnique.mockResolvedValue(stored);

    setupOrder();
    await ingestVerifiedShopifyRefund({
      event: webhookEvent() as never,
      payload,
      monetaryEvidence: monetaryEvidence('1074533826897', '3399.00'),
      canonicalEvidence,
      canonicalFinancialStatus: 'PARTIALLY_REFUNDED',
    });
    setupOrder();
    await ingestVerifiedShopifyRefund({
      event: webhookEvent() as never,
      payload,
      monetaryEvidence: monetaryEvidence('1074533826897', '3399.00'),
      canonicalEvidence: secondCanonicalEvidence,
      canonicalFinancialStatus: 'PARTIALLY_REFUNDED',
    });

    expect(txMock.refundTerminalEvidenceReview.create).toHaveBeenCalledTimes(2);
    const firstReview = txMock.refundTerminalEvidenceReview.create.mock.calls[0]![0].data;
    const secondReview = txMock.refundTerminalEvidenceReview.create.mock.calls[1]![0].data;
    expect(firstReview.dedupeKey).not.toBe(secondReview.dedupeKey);
    expect(firstReview.incomingEvidenceHash).not.toBe(secondReview.incomingEvidenceHash);
    expect(firstReview.occurrenceCount).toBe(1);
    expect(secondReview.occurrenceCount).toBe(1);
    expect(txMock.refundTerminalEvidenceReviewEvent.create).toHaveBeenCalledTimes(2);
    expect(txMock.financeLedgerEntry.create).not.toHaveBeenCalled();
    expect(txMock.refundEvidenceSnapshot.create).not.toHaveBeenCalled();
    expect(txMock.settlementRefundAdjustment.upsert).not.toHaveBeenCalled();
    expect(txMock.vendorBalanceEvent.upsert).not.toHaveBeenCalled();
    expect(txMock.financeEvent.createMany).not.toHaveBeenCalled();
  });

  it.each(['ACKNOWLEDGED', 'RESOLVED'])('preserves a non-active %s review while recording a repeat', async (status) => {
    setupOrder();
    txMock.returnRecord.findFirst.mockResolvedValueOnce(null);
    const payload = refundPayload();
    const canonicalEvidence = canonicalEvidenceForPayload(payload);
    await ingestVerifiedShopifyRefund({
      event: webhookEvent() as never,
      payload,
      monetaryEvidence: monetaryEvidence('1074533826897', '3399.00'),
      canonicalEvidence,
      canonicalFinancialStatus: 'PARTIALLY_REFUNDED',
    });
    const accepted = txMock.refundEvidenceSnapshot.create.mock.calls[0]![0].data;

    txMock.financeLedgerEntry.create.mockClear();
    txMock.refundEvidenceSnapshot.create.mockClear();
    txMock.settlementRefundAdjustment.upsert.mockClear();
    txMock.vendorBalanceEvent.upsert.mockClear();
    txMock.financeEvent.createMany.mockClear();
    setupOrder();
    txMock.refundEvidenceSnapshot.findUnique.mockResolvedValueOnce({
      id: 'snapshot-1',
      ...accepted,
      evidenceHash: '0'.repeat(64),
    });
    txMock.refundTerminalEvidenceReview.findUnique.mockResolvedValueOnce({
      id: 'terminal-review-existing',
      status,
      occurrenceCount: 4,
    });

    const replay = await ingestVerifiedShopifyRefund({
      event: webhookEvent() as never,
      payload,
      monetaryEvidence: monetaryEvidence('1074533826897', '3399.00'),
      canonicalEvidence,
      canonicalFinancialStatus: 'PARTIALLY_REFUNDED',
    });

    expect(replay).toMatchObject({
      ok: false,
      processingStatus: 'needs_attention',
      reasonCode: 'refund_terminal_evidence_conflict',
    });
    expect(txMock.refundTerminalEvidenceReview.create).not.toHaveBeenCalled();
    expect(txMock.refundTerminalEvidenceReview.update).toHaveBeenCalledWith({
      where: { dedupeKey: expect.stringMatching(/^[a-f0-9]{64}$/) },
      data: {
        occurrenceCount: { increment: 1 },
        lastObservedAt: expect.any(Date),
      },
    });
    expect(txMock.refundTerminalEvidenceReview.update.mock.calls[0]![0].data).not.toHaveProperty('status');
    expect(txMock.refundTerminalEvidenceReviewEvent.create).not.toHaveBeenCalled();
    expect(txMock.financeLedgerEntry.create).not.toHaveBeenCalled();
    expect(txMock.refundEvidenceSnapshot.create).not.toHaveBeenCalled();
    expect(txMock.settlementRefundAdjustment.upsert).not.toHaveBeenCalled();
    expect(txMock.vendorBalanceEvent.upsert).not.toHaveBeenCalled();
    expect(txMock.financeEvent.createMany).not.toHaveBeenCalled();
  });

  it('allows a RefundRecord-only state to receive its first canonical finance effect', async () => {
    setupOrder();
    txMock.refundRecord.findFirst.mockReset().mockResolvedValue({ id: NORMAL_REFUND_RECORD_ID });
    txMock.returnRecord.findFirst.mockResolvedValueOnce(null);
    const payload = refundPayload();

    const result = await ingestVerifiedShopifyRefund({
      event: webhookEvent() as never,
      payload,
      monetaryEvidence: monetaryEvidence('1074533826897', '3399.00'),
      canonicalEvidence: canonicalEvidenceForPayload(payload),
      canonicalFinancialStatus: 'PARTIALLY_REFUNDED',
    });

    expect(result).toMatchObject({ ok: true, refundAllocationCount: 1 });
    expect(txMock.financeLedgerEntry.create).toHaveBeenCalledTimes(1);
    expect(txMock.refundEvidenceSnapshot.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ refundRecordId: NORMAL_REFUND_RECORD_ID }),
    });
  });

  it('does not attempt a snapshot when first refund ledger creation fails', async () => {
    setupOrder();
    txMock.returnRecord.findFirst.mockResolvedValueOnce(null);
    txMock.financeLedgerEntry.create.mockRejectedValueOnce(new Error('ledger create failed'));
    const payload = refundPayload();

    const result = await ingestVerifiedShopifyRefund({
      event: webhookEvent() as never,
      payload,
      monetaryEvidence: monetaryEvidence('1074533826897', '3399.00'),
      canonicalEvidence: canonicalEvidenceForPayload(payload),
      canonicalFinancialStatus: 'PARTIALLY_REFUNDED',
    });

    expect(result).toMatchObject({ ok: false, error: 'ledger create failed' });
    expect(txMock.refundEvidenceSnapshot.create).not.toHaveBeenCalled();
    expect(txMock.settlementRefundAdjustment.upsert).not.toHaveBeenCalled();
    expect(txMock.vendorBalanceEvent.upsert).not.toHaveBeenCalled();
  });

  it('fails the shared transaction when snapshot creation fails before adjustment or debt', async () => {
    setupOrder();
    txMock.returnRecord.findFirst.mockResolvedValueOnce(null);
    txMock.refundEvidenceSnapshot.create.mockRejectedValueOnce(new Error('snapshot create failed'));
    const payload = refundPayload();

    const result = await ingestVerifiedShopifyRefund({
      event: webhookEvent() as never,
      payload,
      monetaryEvidence: monetaryEvidence('1074533826897', '3399.00'),
      canonicalEvidence: canonicalEvidenceForPayload(payload),
      canonicalFinancialStatus: 'PARTIALLY_REFUNDED',
    });

    expect(result).toMatchObject({ ok: false, error: 'snapshot create failed' });
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(txMock.financeLedgerEntry.create).toHaveBeenCalledTimes(1);
    expect(txMock.settlementRefundAdjustment.upsert).not.toHaveBeenCalled();
    expect(txMock.vendorBalanceEvent.upsert).not.toHaveBeenCalled();
    expect(txMock.financeEvent.createMany).not.toHaveBeenCalled();
  });
});
