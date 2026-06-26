import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppEnv } from '../backend/src/config/env.js';
import type { CanonicalShopifyOrderSnapshot } from '../backend/src/modules/shopify/shopify-admin.types.js';

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(prismaMock)),
  shopifyOrder: {
    findUnique: vi.fn(),
  },
  vendorAllocation: {
    updateMany: vi.fn(),
  },
  financeLedgerEntry: {
    update: vi.fn(),
  },
  operationalSignal: {
    upsert: vi.fn(),
    updateMany: vi.fn(),
  },
}));

vi.mock('../backend/src/db/prisma.js', () => ({
  prisma: prismaMock,
}));

const {
  createCanonicalCancellationReconciliationService,
  __canonicalCancellationReconciliationTesting,
} = await import('../backend/src/modules/reconciliation/canonical-cancellation-reconciliation.service.js');

function canonicalOrder(overrides: Partial<CanonicalShopifyOrderSnapshot> = {}): CanonicalShopifyOrderSnapshot {
  return {
    orderGid: 'gid://shopify/Order/order-1',
    sourceShopifyOrderId: 'order-1',
    sourceShopifyOrderNumber: '#1102',
    shopifyCreatedAt: '2026-06-26T09:00:00.000Z',
    currency: 'TRY',
    financialStatus: 'paid',
    cancelledAt: '2026-06-26T10:00:00.000Z',
    cancelReason: 'customer',
    paymentGatewayName: 'test',
    taxesIncluded: true,
    orderTaxAmount: '0.00',
    shippingAmount: '0.00',
    discountAmount: '0.00',
    totalPrice: '100.00',
    orderNote: null,
    orderTags: [],
    customerName: null,
    customerEmail: null,
    customerPhone: null,
    billingFullName: null,
    billingCompany: null,
    billingPhone: null,
    billingCity: null,
    billingDistrict: null,
    billingAddress1: null,
    billingAddress2: null,
    billingPostcode: null,
    shippingCountry: null,
    shippingPostcode: null,
    shippingCity: null,
    shippingDistrict: null,
    shippingAddress: null,
    sellerInfo: null,
    lineItems: [
      {
        lineItemGid: 'gid://shopify/LineItem/1001',
        sourceLineItemId: '1001',
        shopifyProductId: 'product-1',
        sourceVariantId: 'variant-1',
        sku: 'SKU-1',
        title: 'Product',
        imageUrl: null,
        quantity: 1,
        currentQuantity: 1,
        refundableQuantity: 1,
        unitPrice: '100.00',
        unitPriceVatIncluded: '100.00',
        lineTotalVatIncluded: '100.00',
        lineTaxAmount: '0.00',
        vatRate: '0.00',
      },
    ],
    fulfillmentOrders: [],
    source: 'mock',
    ...overrides,
  };
}

function buildEnv(order: CanonicalShopifyOrderSnapshot): AppEnv {
  return {
    NODE_ENV: 'test',
    SHOPIFY_API_VERSION: '2026-01',
    SHOPIFY_SHOP_DOMAIN: 'demo.myshopify.com',
    SHOPIFY_MOCK_CANONICAL_ORDER_SNAPSHOT: JSON.stringify({
      'order-1': order,
    }),
  } as AppEnv;
}

function saleLedger(overrides: Record<string, unknown> = {}) {
  return {
    id: 'fin-vendor-a-sale-order-1-alloc-a',
    vendorAllocationId: 'alloc-a',
    vendorId: 'vendor-a',
    entryType: 'sale',
    payoutStatus: 'PENDING',
    settlementStatus: 'PENDING',
    voidedAt: null,
    voidReason: null,
    settlementApprovalLines: [],
    payoutBatchLines: [],
    ...overrides,
  };
}

function localAllocation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'alloc-a',
    assignedVendorId: 'vendor-a',
    fulfillmentStatus: 'Pending',
    shippingStatus: 'Awaiting Shipment',
    trackingNumber: null,
    carrier: null,
    refundRecords: [],
    returnRecords: [],
    financeEntries: [saleLedger()],
    ...overrides,
  };
}

function localOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 'shopify-order-db-1',
    sourceShopifyOrderId: 'order-1',
    allocations: [localAllocation()],
    lineItems: [{ sourceLineItemId: '1001' }],
    ...overrides,
  };
}

describe('canonical Shopify cancellation reconciliation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.shopifyOrder.findUnique.mockResolvedValue(localOrder());
    prismaMock.vendorAllocation.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.financeLedgerEntry.update.mockResolvedValue({});
    prismaMock.operationalSignal.upsert.mockResolvedValue({});
    prismaMock.operationalSignal.updateMany.mockResolvedValue({ count: 0 });
  });

  it('voids and holds unpaid sale ledgers for full Shopify order cancellation', async () => {
    const result = await createCanonicalCancellationReconciliationService(
      buildEnv(canonicalOrder()),
    ).reconcileShopifyOrderCancellation('order-1');

    expect(result).toMatchObject({
      shopifyOrderId: 'order-1',
      cancellationState: 'full_order_cancelled',
      affectedAllocations: ['alloc-a'],
      affectedLineItems: ['1001'],
      ledgersHeldOrVoided: ['fin-vendor-a-sale-order-1-alloc-a'],
      failedCount: 0,
      results: [
        expect.objectContaining({
          status: 'reconciled',
          allocationId: 'alloc-a',
          financeLedgerEntryId: 'fin-vendor-a-sale-order-1-alloc-a',
        }),
      ],
    });
    expect(prismaMock.vendorAllocation.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        cancellationReason: 'VENDOR_CANCELLED',
        reassignmentRequired: false,
      }),
    }));
    expect(prismaMock.financeLedgerEntry.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'fin-vendor-a-sale-order-1-alloc-a' },
      data: expect.objectContaining({
        payoutStatus: 'HOLD',
        settlementStatus: 'HELD',
        settlementHoldReason: 'Canonical Shopify order cancellation.',
        voidReason: 'canonical_order_cancelled:customer',
      }),
    }));
  });

  it('is idempotent when there are no active sale ledgers left to void', async () => {
    prismaMock.shopifyOrder.findUnique.mockResolvedValueOnce(localOrder({
      allocations: [
        localAllocation({
          financeEntries: [
            saleLedger({
              voidedAt: new Date('2026-06-26T10:00:00.000Z'),
              voidReason: 'canonical_order_cancelled:customer',
            }),
          ],
        }),
      ],
    }));

    const result = await createCanonicalCancellationReconciliationService(
      buildEnv(canonicalOrder()),
    ).reconcileShopifyOrderCancellation('order-1');

    expect(result).toMatchObject({
      ledgersHeldOrVoided: [],
      results: [
        expect.objectContaining({
          status: 'already_current',
          reason: 'no_active_sale_ledgers',
        }),
      ],
    });
    expect(prismaMock.financeLedgerEntry.update).not.toHaveBeenCalled();
  });

  it('creates finance-review signal and preserves state when sale is settlement approved', async () => {
    prismaMock.shopifyOrder.findUnique.mockResolvedValueOnce(localOrder({
      allocations: [
        localAllocation({
          financeEntries: [
            saleLedger({
              settlementApprovalLines: [
                {
                  settlementApproval: {
                    status: 'APPROVED',
                  },
                },
              ],
            }),
          ],
        }),
      ],
    }));

    const result = await createCanonicalCancellationReconciliationService(
      buildEnv(canonicalOrder()),
    ).reconcileShopifyOrderCancellation('order-1');

    expect(result).toMatchObject({
      failedCount: 1,
      results: [
        expect.objectContaining({
          status: 'failed',
          reason: 'canonical_order_cancellation_requires_finance_review',
        }),
      ],
    });
    expect(prismaMock.financeLedgerEntry.update).not.toHaveBeenCalled();
    expect(prismaMock.operationalSignal.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        ruleKey: 'canonical_order_cancellation_requires_finance_review',
        severity: 'CRITICAL',
      }),
    }));
  });

  it('creates finance-review signal for active payout batch or paid vendor status', async () => {
    prismaMock.shopifyOrder.findUnique.mockResolvedValueOnce(localOrder({
      allocations: [
        localAllocation({
          financeEntries: [
            saleLedger({
              payoutBatchLines: [
                {
                  payoutBatch: {
                    status: 'REVIEW',
                  },
                },
              ],
            }),
          ],
        }),
      ],
    }));

    const payoutResult = await createCanonicalCancellationReconciliationService(
      buildEnv(canonicalOrder()),
    ).reconcileShopifyOrderCancellation('order-1');
    expect(payoutResult?.failedCount).toBe(1);

    prismaMock.shopifyOrder.findUnique.mockResolvedValueOnce(localOrder({
      allocations: [
        localAllocation({
          financeEntries: [saleLedger({ payoutStatus: 'PAID' })],
        }),
      ],
    }));
    const paidResult = await createCanonicalCancellationReconciliationService(
      buildEnv(canonicalOrder()),
    ).reconcileShopifyOrderCancellation('order-1');
    expect(paidResult?.failedCount).toBe(1);
    expect(prismaMock.financeLedgerEntry.update).not.toHaveBeenCalled();
  });

  it('preserves fulfilled or refund/return state and signals operational conflict', async () => {
    prismaMock.shopifyOrder.findUnique.mockResolvedValueOnce(localOrder({
      allocations: [
        localAllocation({
          fulfillmentStatus: 'Fulfilled',
          shippingStatus: 'Delivered',
        }),
      ],
    }));

    const result = await createCanonicalCancellationReconciliationService(
      buildEnv(canonicalOrder()),
    ).reconcileShopifyOrderCancellation('order-1');

    expect(result).toMatchObject({
      failedCount: 1,
      results: [
        expect.objectContaining({
          reason: 'canonical_order_cancellation_conflicts_with_operational_state',
        }),
      ],
    });
    expect(prismaMock.vendorAllocation.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.financeLedgerEntry.update).not.toHaveBeenCalled();
  });

  it('does not mutate partial line quantity changes and creates manual-review signal', async () => {
    const result = await createCanonicalCancellationReconciliationService(
      buildEnv(canonicalOrder({
        cancelledAt: null,
        cancelReason: null,
        lineItems: [
          {
            ...canonicalOrder().lineItems[0],
            quantity: 2,
            currentQuantity: 1,
          },
        ],
      })),
    ).reconcileShopifyOrderCancellation('order-1');

    expect(result).toMatchObject({
      cancellationState: 'unknown_requires_manual_review',
      affectedLineItems: ['1001'],
      skippedCount: 1,
    });
    expect(prismaMock.vendorAllocation.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.financeLedgerEntry.update).not.toHaveBeenCalled();
    expect(prismaMock.operationalSignal.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        ruleKey: 'canonical_order_partial_cancellation_requires_manual_review',
      }),
    }));
  });

  it('resolves stale cancellation signals when Shopify has no cancellation evidence', async () => {
    const result = await createCanonicalCancellationReconciliationService(
      buildEnv(canonicalOrder({
        cancelledAt: null,
        cancelReason: null,
      })),
    ).reconcileShopifyOrderCancellation('order-1');

    expect(result).toMatchObject({
      cancellationState: 'none',
      affectedLineItems: [],
      results: [],
    });
    expect(prismaMock.operationalSignal.updateMany).toHaveBeenCalled();
  });

  it('exposes classification helpers for diagnostics', () => {
    expect(__canonicalCancellationReconciliationTesting.CANONICAL_CANCELLATION_SIGNAL_RULE_KEYS)
      .toHaveProperty('reconciled', 'canonical_order_cancelled_reconciled');
    expect(__canonicalCancellationReconciliationTesting.classifyCanonicalCancellation(canonicalOrder()).state)
      .toBe('full_order_cancelled');
  });
});
