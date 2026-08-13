import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppEnv } from '../backend/src/config/env.js';
import type { CanonicalShopifyRefundSnapshot } from '../backend/src/modules/shopify/shopify-admin.types.js';

const prismaMock = vi.hoisted(() => ({
  shopifyOrder: {
    findUnique: vi.fn(),
  },
  webhookEvent: {
    upsert: vi.fn(),
  },
  refundRecord: {
    count: vi.fn(),
    findMany: vi.fn(),
  },
  financeLedgerEntry: {
    count: vi.fn(),
  },
  financeEvent: {
    count: vi.fn(),
  },
  operationalSignal: {
    upsert: vi.fn(),
    updateMany: vi.fn(),
  },
}));

const ingestVerifiedShopifyRefundMock = vi.hoisted(() => vi.fn());

vi.mock('../backend/src/db/prisma.js', () => ({
  prisma: prismaMock,
}));

vi.mock('../backend/src/modules/shopify/refund-ingestion.service.js', () => ({
  ingestVerifiedShopifyRefund: ingestVerifiedShopifyRefundMock,
}));

const {
  createCanonicalRefundReconciliationService,
  __canonicalRefundReconciliationTesting,
} = await import('../backend/src/modules/reconciliation/canonical-refund-reconciliation.service.js');

function canonicalRefund(overrides: Partial<CanonicalShopifyRefundSnapshot> = {}): CanonicalShopifyRefundSnapshot {
  return {
    refundGid: 'gid://shopify/Refund/5001',
    sourceShopifyRefundId: '5001',
    createdAt: '2026-06-26T10:00:00.000Z',
    updatedAt: '2026-06-26T10:00:01.000Z',
    note: 'Customer refund',
    totalRefundedAmount: '100.00',
    totalRefundedCurrencyCode: 'TRY',
    transactionPaginationComplete: true,
    lineItemPaginationComplete: true,
    transactions: [
      {
        transactionGid: 'gid://shopify/OrderTransaction/5001',
        kind: 'REFUND',
        status: 'SUCCESS',
        amount: '100.00',
        currencyCode: 'TRY',
        parentTransactionGid: 'gid://shopify/OrderTransaction/parent-5001',
        createdAt: '2026-06-26T10:00:00.000Z',
        processedAt: '2026-06-26T10:00:01.000Z',
      },
    ],
    refundLineItems: [
      {
        refundLineItemGid: 'gid://shopify/RefundLineItem/9001',
        sourceRefundLineItemId: '9001',
        lineItemGid: 'gid://shopify/LineItem/1001',
        sourceLineItemId: '1001',
        sku: 'SKU-1',
        title: 'Product',
        name: 'Product / 42',
        variantTitle: '42',
        quantity: 2,
        subtotalAmount: '100.00',
        currencyCode: 'TRY',
      },
    ],
    ...overrides,
  };
}

function buildEnv(refunds: CanonicalShopifyRefundSnapshot[]): AppEnv {
  const totalRefundedAmount = refunds.reduce((total, refund) =>
    total + Number(refund.totalRefundedAmount ?? 0), 0).toFixed(2);
  return {
    NODE_ENV: 'test',
    SHOPIFY_API_VERSION: '2026-01',
    SHOPIFY_SHOP_DOMAIN: 'demo.myshopify.com',
    SHOPIFY_MOCK_CANONICAL_REFUNDS: JSON.stringify({
      'order-1': {
        orderTotalRefundedAmount: totalRefundedAmount,
        orderTotalRefundedCurrencyCode: 'TRY',
        refundsListComplete: true,
        refunds,
      },
    }),
  } as AppEnv;
}

function mockEvidenceCounts(input: Array<{ refundRecords: number; refundLedgers: number; financeEvents: number }>) {
  for (const counts of input) {
    prismaMock.refundRecord.count.mockResolvedValueOnce(counts.refundRecords);
    prismaMock.financeLedgerEntry.count.mockResolvedValueOnce(counts.refundLedgers);
    prismaMock.financeEvent.count.mockResolvedValueOnce(counts.financeEvents);
  }
}

function localRefundRecords() {
  return [
    {
      id: 'refund-vendor-a-5001-alloc-a',
      vendorAllocationId: 'alloc-a',
      vendorAllocation: {
        assignedVendorId: 'vendor-a',
      },
    },
  ];
}

describe('canonical Shopify refund reconciliation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.shopifyOrder.findUnique.mockResolvedValue({ id: 'shopify-order-db-1' });
    prismaMock.webhookEvent.upsert.mockResolvedValue({
      id: 'webhook-canonical-refund-1',
      sourceShopDomain: 'demo.myshopify.com',
      topic: 'refunds/create',
      status: 'RECEIVED',
    });
    prismaMock.refundRecord.findMany.mockResolvedValue(localRefundRecords());
    prismaMock.operationalSignal.upsert.mockResolvedValue({});
    prismaMock.operationalSignal.updateMany.mockResolvedValue({ count: 0 });
    ingestVerifiedShopifyRefundMock.mockResolvedValue({
      ok: true,
      action: 'accepted',
      processingStatus: 'processed',
      shopifyOrderId: 'order-1',
      refundAllocationCount: 1,
    });
  });

  it('creates a missing local refund through the existing refund ingestion path', async () => {
    mockEvidenceCounts([
      { refundRecords: 0, refundLedgers: 0, financeEvents: 0 },
      { refundRecords: 1, refundLedgers: 1, financeEvents: 4 },
    ]);

    const result = await createCanonicalRefundReconciliationService(
      buildEnv([canonicalRefund()]),
    ).reconcileShopifyOrderRefunds('order-1');

    expect(result).toMatchObject({
      shopifyOrderId: 'order-1',
      refundsFetched: 1,
      refundsCreated: 1,
      ledgersRepaired: 1,
      eventsRepaired: 4,
      failedCount: 0,
      results: [
        expect.objectContaining({
          refundId: '5001',
          status: 'created',
          affectedAllocationIds: ['alloc-a'],
          affectedVendorIds: ['vendor-a'],
          affectedRefundRecordIds: ['refund-vendor-a-5001-alloc-a'],
        }),
      ],
    });
    expect(ingestVerifiedShopifyRefundMock).toHaveBeenCalledWith(expect.objectContaining({
      event: expect.objectContaining({ id: 'webhook-canonical-refund-1' }),
      monetaryEvidence: expect.objectContaining({
        classification: 'MONETARY_REFUND',
        monetaryRefundAmount: '100',
      }),
      payload: expect.objectContaining({
        id: '5001',
        order_id: 'order-1',
        refund_line_items: [
          expect.objectContaining({
            id: '9001',
            line_item_id: '1001',
            quantity: 2,
            subtotal: '50.00',
            line_item: expect.objectContaining({
              id: '1001',
              sku: 'SKU-1',
              title: 'Product',
              variant_title: '42',
            }),
          }),
        ],
      }),
    }));
    expect(prismaMock.webhookEvent.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        idempotencyKey: 'canonical_refund_reconciliation:demo.myshopify.com:order-1:5001',
      },
    }));
  });

  it('is idempotent when refund records, ledgers, and finance events are already present', async () => {
    mockEvidenceCounts([
      { refundRecords: 1, refundLedgers: 1, financeEvents: 4 },
      { refundRecords: 1, refundLedgers: 1, financeEvents: 4 },
    ]);

    const result = await createCanonicalRefundReconciliationService(
      buildEnv([canonicalRefund()]),
    ).reconcileShopifyOrderRefunds('order-1');

    expect(result).toMatchObject({
      refundsAlreadyPresent: 1,
      refundsCreated: 0,
      ledgersRepaired: 0,
      eventsRepaired: 0,
      results: [
        expect.objectContaining({
          status: 'already_present',
        }),
      ],
    });
  });

  it('routes a canonical shipping-only refund through verified ingestion without product finance deltas', async () => {
    mockEvidenceCounts([
      { refundRecords: 0, refundLedgers: 0, financeEvents: 0 },
      { refundRecords: 0, refundLedgers: 0, financeEvents: 0 },
    ]);
    prismaMock.refundRecord.findMany.mockResolvedValueOnce([]);
    ingestVerifiedShopifyRefundMock.mockResolvedValueOnce({
      ok: true,
      action: 'accepted',
      processingStatus: 'processed',
      shopifyOrderId: 'order-1',
      refundAllocationCount: 0,
      reconciliationMode: 'shipping_only',
      terminalStateChanged: true,
    });

    const result = await createCanonicalRefundReconciliationService(
      buildEnv([canonicalRefund({ refundLineItems: [] })]),
    ).reconcileShopifyOrderRefunds('order-1');

    expect(ingestVerifiedShopifyRefundMock).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({
        id: '5001',
        order_id: 'order-1',
        refund_line_items: [],
      }),
      monetaryEvidence: expect.objectContaining({
        classification: 'MONETARY_REFUND',
        monetaryRefundAmount: '100',
      }),
    }));
    expect(result).toMatchObject({
      refundsCreated: 0,
      ledgersRepaired: 0,
      eventsRepaired: 0,
      failedCount: 0,
      results: [expect.objectContaining({ status: 'repaired' })],
    });
    expect(prismaMock.operationalSignal.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        title: 'Canonical shipping refund reconciled',
        description: 'Canonical Shopify refund reconciliation terminalized the owned shipping-only refund without product finance records.',
      }),
    }));
  });

  it('reports repaired when an existing refund record gains missing ledger and event evidence', async () => {
    mockEvidenceCounts([
      { refundRecords: 1, refundLedgers: 0, financeEvents: 0 },
      { refundRecords: 1, refundLedgers: 1, financeEvents: 4 },
    ]);

    const result = await createCanonicalRefundReconciliationService(
      buildEnv([canonicalRefund()]),
    ).reconcileShopifyOrderRefunds('order-1');

    expect(result).toMatchObject({
      refundsCreated: 0,
      ledgersRepaired: 1,
      eventsRepaired: 4,
      results: [
        expect.objectContaining({
          status: 'repaired',
        }),
      ],
    });
  });

  it('creates a manual-review signal and does not ingest when the local order is missing', async () => {
    prismaMock.shopifyOrder.findUnique.mockResolvedValueOnce(null);

    const result = await createCanonicalRefundReconciliationService(
      buildEnv([canonicalRefund()]),
    ).reconcileShopifyOrderRefunds('order-1');

    expect(result).toMatchObject({
      skippedCount: 1,
      signalsCreatedOrUpdated: 1,
      results: [
        expect.objectContaining({
          status: 'skipped',
          reason: 'canonical_refund_missing_local_order',
        }),
      ],
    });
    expect(ingestVerifiedShopifyRefundMock).not.toHaveBeenCalled();
    expect(prismaMock.operationalSignal.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        ruleKey: 'canonical_refund_missing_local_order',
        severity: 'CRITICAL',
      }),
    }));
  });

  it('creates an unmatched-line signal when ingestion cannot map the canonical refund line', async () => {
    mockEvidenceCounts([
      { refundRecords: 0, refundLedgers: 0, financeEvents: 0 },
      { refundRecords: 0, refundLedgers: 0, financeEvents: 0 },
    ]);
    prismaMock.refundRecord.findMany.mockResolvedValueOnce([]);
    ingestVerifiedShopifyRefundMock.mockResolvedValueOnce({
      ok: false,
      action: 'received_needs_attention',
      processingStatus: 'needs_attention',
      error: 'No original order mapping found for refund SKU SKU-1.',
    });

    const result = await createCanonicalRefundReconciliationService(
      buildEnv([canonicalRefund()]),
    ).reconcileShopifyOrderRefunds('order-1');

    expect(result).toMatchObject({
      failedCount: 1,
      signalsCreatedOrUpdated: 1,
      results: [
        expect.objectContaining({
          status: 'failed',
          reason: 'No original order mapping found for refund SKU SKU-1.',
        }),
      ],
    });
    expect(prismaMock.operationalSignal.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        ruleKey: 'canonical_refund_line_item_unmatched',
        sourceArea: 'RECONCILIATION',
      }),
    }));
  });

  it('skips zero-value void evidence without creating synthetic refund finance', async () => {
    const zeroValueVoid = canonicalRefund({
      totalRefundedAmount: '0.00',
      transactions: [
        {
          transactionGid: 'gid://shopify/OrderTransaction/void-5001',
          kind: 'VOID',
          status: 'SUCCESS',
          amount: '0.00',
          currencyCode: 'TRY',
          parentTransactionGid: 'gid://shopify/OrderTransaction/parent-5001',
          createdAt: '2026-06-26T10:00:00.000Z',
          processedAt: '2026-06-26T10:00:01.000Z',
        },
      ],
    });

    const result = await createCanonicalRefundReconciliationService(
      buildEnv([zeroValueVoid]),
    ).reconcileShopifyOrderRefunds('order-1');

    expect(result).toMatchObject({
      refundsFetched: 1,
      refundsCreated: 0,
      failedCount: 0,
      skippedCount: 1,
      results: [expect.objectContaining({
        refundId: '5001',
        status: 'skipped',
        reason: 'zero_value_void_not_monetary_refund',
      })],
    });
    expect(ingestVerifiedShopifyRefundMock).not.toHaveBeenCalled();
    expect(prismaMock.webhookEvent.upsert).not.toHaveBeenCalled();
    expect(prismaMock.operationalSignal.updateMany).toHaveBeenCalled();
  });

  it('exposes canonical refund signal keys and webhook adapter for diagnostics', () => {
    const payload = __canonicalRefundReconciliationTesting.canonicalRefundToWebhookPayload({
      sourceShopifyOrderId: 'order-1',
      refund: canonicalRefund(),
    });

    expect(payload.refund_line_items?.[0]?.subtotal).toBe('50.00');
    expect(__canonicalRefundReconciliationTesting.CANONICAL_REFUND_SIGNAL_RULE_KEYS)
      .toHaveProperty('repaired', 'canonical_refund_repaired');
  });
});
