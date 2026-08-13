import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppEnv } from '../backend/src/config/env.js';
import type { CanonicalShopifyOrderSnapshot } from '../backend/src/modules/shopify/shopify-admin.types.js';

const prismaMock = vi.hoisted(() => ({
  shopifyOrder: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  shopifyOrderLineItem: {
    update: vi.fn(),
  },
  vendor: {
    findMany: vi.fn(),
  },
  vendorAllocation: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  fulfillment: {
    upsert: vi.fn(),
  },
  refundRecord: {
    update: vi.fn(),
  },
  returnRecord: {
    update: vi.fn(),
  },
  financeLedgerEntry: {
    create: vi.fn(),
  },
  vendorBalanceEvent: {
    upsert: vi.fn(),
  },
  operationalSignal: {
    upsert: vi.fn(),
    updateMany: vi.fn(),
  },
  $transaction: vi.fn((callback: (tx: typeof prismaMock) => unknown) => callback(prismaMock)),
}));

vi.mock('../backend/src/db/prisma.js', () => ({
  prisma: prismaMock,
}));

const { createReconciliationService, __reconciliationTesting } = await import(
  '../backend/src/modules/reconciliation/reconciliation.service.js'
);

function buildCanonicalSnapshot(overrides: Partial<CanonicalShopifyOrderSnapshot> = {}): CanonicalShopifyOrderSnapshot {
  return {
    orderGid: 'gid://shopify/Order/order-1',
    sourceShopifyOrderId: 'order-1',
    sourceShopifyOrderNumber: '#1001',
    shopifyCreatedAt: '2026-06-25T10:00:00.000Z',
    currency: 'TRY',
    financialStatus: 'paid',
    paymentGatewayName: 'shopify_payments',
    taxesIncluded: true,
    orderTaxAmount: '10.00',
    shippingAmount: '5.00',
    discountAmount: '0.00',
    totalPrice: '100.00',
    orderNote: null,
    orderTags: [],
    customerName: 'Demo Customer',
    customerEmail: 'demo@example.com',
    customerPhone: '+905551112233',
    billingFullName: 'Demo Customer',
    billingCompany: null,
    billingPhone: '+905551112233',
    billingCity: 'Istanbul',
    billingDistrict: 'Kadikoy',
    billingAddress1: 'Moda Cd. 1',
    billingAddress2: null,
    billingPostcode: '34710',
    shippingCountry: 'TR',
    shippingPostcode: '34710',
    shippingCity: 'Istanbul',
    shippingDistrict: 'Kadikoy',
    shippingAddress: 'Moda Cd. 1',
    sellerInfo: null,
    lineItems: [
      {
        lineItemGid: 'gid://shopify/LineItem/line-1',
        sourceLineItemId: 'line-1',
        shopifyProductId: 'product-1',
        sourceVariantId: 'variant-1',
        sku: 'SKU-1',
        title: 'Canonical Product',
        imageUrl: 'https://cdn.example/product.jpg',
        quantity: 1,
        unitPrice: '90.00',
        unitPriceVatIncluded: '100.00',
        lineTotalVatIncluded: '100.00',
        lineTaxAmount: '10.00',
        vatRate: '10.00',
      },
    ],
    fulfillmentOrders: [],
    source: 'mock',
    ...overrides,
  };
}

function buildEnv(snapshot: CanonicalShopifyOrderSnapshot): AppEnv {
  return {
    SHOPIFY_API_VERSION: '2026-01',
    SHOPIFY_MOCK_CANONICAL_ORDER_SNAPSHOT: JSON.stringify({
      'order-1': snapshot,
    }),
    SHOPIFY_MOCK_ORDER_FULFILLMENT_STATE: JSON.stringify({
      'order-1': {
        orderName: '#1001',
        displayFulfillmentStatus: 'UNFULFILLED',
        fulfillments: [],
      },
    }),
    SHOPIFY_MOCK_FULFILLMENT_ORDERS: JSON.stringify({}),
  } as AppEnv;
}

function saleLedger(allocationId = 'alloc-a') {
  return {
    id: `fin-vendor-a-sale-order-1-${allocationId}`,
    vendorId: 'vendor-a',
    entryType: 'sale',
    amount: '100.00',
    payoutStatus: 'PENDING',
    settlementStatus: 'PENDING',
    voidedAt: null,
    supersededByLedgerId: null,
    commissionPercentSnapshot: '20.00',
    commissionVatPercentSnapshot: '20.00',
    payoutBatchLines: [],
    settlementApprovalLines: [],
  };
}

function lineItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 'line-db-1',
    sourceLineItemId: 'line-1',
    shopifyProductId: 'product-old',
    sourceVariantId: 'variant-old',
    sku: 'SKU-OLD',
    title: 'Old Product',
    imageUrl: null,
    quantity: 1,
    unitPrice: '90.00',
    unitPriceVatIncluded: '100.00',
    lineTotalVatIncluded: '100.00',
    lineTaxAmount: '10.00',
    vatRate: '10.00',
    originalVendorId: 'vendor-a',
    allocationLineItems: [{ id: 'allocation-line-1' }],
    ...overrides,
  };
}

function allocation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'alloc-a',
    assignedVendorId: 'vendor-a',
    originalVendorId: 'vendor-a',
    fulfillmentStatus: 'pending',
    shippingStatus: 'awaiting_shipment',
    trackingNumber: null,
    carrier: null,
    fulfillment: null,
    lineItems: [
      {
        id: 'allocation-line-1',
        shopifyOrderLineItem: {
          id: 'line-db-1',
          sourceLineItemId: 'line-1',
        },
      },
    ],
    refundRecords: [],
    returnRecords: [],
    economicTransfers: [],
    financeEntries: [saleLedger()],
    ...overrides,
  };
}

function shopifyOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 'shopify-order-db-1',
    sourceShopifyOrderId: 'order-1',
    sourceShopifyOrderNumber: '#1001',
    shopifyCreatedAt: new Date('2026-06-25T10:00:00.000Z'),
    currency: 'TRY',
    financialStatus: 'pending',
    paymentGatewayName: 'old_gateway',
    taxesIncluded: true,
    orderTaxAmount: '10.00',
    shippingAmount: '5.00',
    discountAmount: '0.00',
    orderNote: null,
    orderTags: [],
    customerName: 'Old Customer',
    customerEmail: 'old@example.com',
    customerPhone: '+900000000000',
    billingFullName: 'Old Customer',
    billingCompany: null,
    billingPhone: '+900000000000',
    billingCity: 'Old City',
    billingDistrict: 'Old District',
    billingAddress1: 'Old Address',
    billingAddress2: null,
    billingPostcode: '00000',
    shippingCountry: 'TR',
    shippingPostcode: '00000',
    shippingCity: 'Old City',
    shippingDistrict: 'Old District',
    shippingAddress: 'Old Address',
    totalPrice: '100.00',
    lineItems: [lineItem()],
    allocations: [allocation()],
    ...overrides,
  };
}

describe('canonical Shopify order reconciliation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation((callback: (tx: typeof prismaMock) => unknown) => callback(prismaMock));
    prismaMock.vendor.findMany.mockResolvedValue([{ id: 'vendor-a' }, { id: 'vendor-b' }]);
  });

  it('repairs stale customer and address snapshot fields', async () => {
    const snapshot = buildCanonicalSnapshot();
    prismaMock.shopifyOrder.findUnique.mockResolvedValueOnce(shopifyOrder());

    const result = await createReconciliationService(buildEnv(snapshot)).reconcileShopifyOrder('order-1');

    expect(result?.reconciliationStatus).toBe('repaired');
    expect(prismaMock.shopifyOrder.update).toHaveBeenCalledWith({
      where: { id: 'shopify-order-db-1' },
      data: expect.objectContaining({
        customerName: 'Demo Customer',
        customerEmail: 'demo@example.com',
        customerPhone: '+905551112233',
        billingCity: 'Istanbul',
        billingDistrict: 'Kadikoy',
        shippingCity: 'Istanbul',
        shippingAddress: 'Moda Cd. 1',
      }),
    });
  });

  it('repairs stale discount and tax snapshot fields', async () => {
    const snapshot = buildCanonicalSnapshot({
      orderTaxAmount: '25.00',
      shippingAmount: '7.50',
      discountAmount: '12.00',
      totalPrice: '120.00',
    });
    prismaMock.shopifyOrder.findUnique.mockResolvedValueOnce(shopifyOrder({
      orderTaxAmount: '10.00',
      shippingAmount: '5.00',
      discountAmount: '0.00',
      totalPrice: '100.00',
    }));

    await createReconciliationService(buildEnv(snapshot)).reconcileShopifyOrder('order-1');

    expect(prismaMock.shopifyOrder.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        orderTaxAmount: '25.00',
        shippingAmount: '7.50',
        discountAmount: '12.00',
        totalPrice: '120.00',
      }),
    }));
  });

  it('repairs stale financial status using canonical Shopify normalization', async () => {
    const snapshot = buildCanonicalSnapshot({ financialStatus: 'REFUNDED' });
    prismaMock.shopifyOrder.findUnique.mockResolvedValueOnce(shopifyOrder({ financialStatus: 'paid' }));

    await createReconciliationService(buildEnv(snapshot)).reconcileShopifyOrder('order-1');

    expect(prismaMock.shopifyOrder.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ financialStatus: 'refunded' }),
    }));
  });

  it('repairs stale line item metadata', async () => {
    const snapshot = buildCanonicalSnapshot();
    prismaMock.shopifyOrder.findUnique.mockResolvedValueOnce(shopifyOrder());

    await createReconciliationService(buildEnv(snapshot)).reconcileShopifyOrder('order-1');

    expect(prismaMock.shopifyOrderLineItem.update).toHaveBeenCalledWith({
      where: { id: 'line-db-1' },
      data: expect.objectContaining({
        shopifyProductId: 'product-1',
        sourceVariantId: 'variant-1',
        sku: 'SKU-1',
        title: 'Canonical Product',
        imageUrl: 'https://cdn.example/product.jpg',
      }),
    });
  });

  it('repairs seller info ownership only when no allocation line already owns the item', async () => {
    const snapshot = buildCanonicalSnapshot({
      sellerInfo: {
        'SKU-1': 'vendor-a',
      },
    });
    prismaMock.shopifyOrder.findUnique.mockResolvedValueOnce(shopifyOrder({
      lineItems: [
        lineItem({
          sku: 'SKU-1',
          originalVendorId: null,
          allocationLineItems: [],
        }),
      ],
    }));

    await createReconciliationService(buildEnv(snapshot)).reconcileShopifyOrder('order-1');

    expect(prismaMock.shopifyOrderLineItem.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        originalVendorId: 'vendor-a',
      }),
    }));
  });

  it('raises an operational signal when Shopify has an order but local record is missing', async () => {
    const snapshot = buildCanonicalSnapshot();
    prismaMock.shopifyOrder.findUnique.mockResolvedValueOnce(null);

    const result = await createReconciliationService(buildEnv(snapshot)).reconcileShopifyOrder('order-1');

    expect(result?.reconciliationStatus).toBe('needs_attention');
    expect(prismaMock.operationalSignal.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: __reconciliationTesting.buildCanonicalOrderSignalId(
          __reconciliationTesting.CANONICAL_ORDER_SIGNAL_RULE_KEYS.missingLocalRecord,
          'order-1',
        ),
      },
      create: expect.objectContaining({
        ruleKey: 'canonical_order_missing_local_record',
        severity: 'CRITICAL',
      }),
    }));
    expect(prismaMock.shopifyOrder.update).not.toHaveBeenCalled();
    expect(prismaMock.vendorAllocation.update).not.toHaveBeenCalled();
  });

  it('does not downgrade fulfillment or mutate finance, allocations, or settlement-owned rows during snapshot repair', async () => {
    const snapshot = buildCanonicalSnapshot({
      customerName: 'Updated Customer',
    });
    prismaMock.shopifyOrder.findUnique.mockResolvedValueOnce(shopifyOrder({
      allocations: [
        allocation({
          fulfillmentStatus: 'fulfilled',
          shippingStatus: 'delivered',
          trackingNumber: 'TRACK-1',
          carrier: 'Carrier A',
        }),
      ],
    }));

    await createReconciliationService(buildEnv(snapshot)).reconcileShopifyOrder('order-1');

    expect(prismaMock.shopifyOrder.update).toHaveBeenCalled();
    expect(prismaMock.vendorAllocation.update).not.toHaveBeenCalled();
    expect(prismaMock.fulfillment.upsert).not.toHaveBeenCalled();
    expect(prismaMock.financeLedgerEntry.create).not.toHaveBeenCalled();
  });

  it('is idempotent for repeated missing local order reconciliation', async () => {
    const snapshot = buildCanonicalSnapshot();
    prismaMock.shopifyOrder.findUnique.mockResolvedValue(null);

    const service = createReconciliationService(buildEnv(snapshot));
    await service.reconcileShopifyOrder('order-1');
    await service.reconcileShopifyOrder('order-1');

    expect(prismaMock.operationalSignal.upsert).toHaveBeenCalledTimes(2);
    expect(prismaMock.operationalSignal.upsert.mock.calls[0]?.[0].where).toEqual(
      prismaMock.operationalSignal.upsert.mock.calls[1]?.[0].where,
    );
  });

  it('raises a conflict signal instead of changing seller ownership on allocated line items', async () => {
    const snapshot = buildCanonicalSnapshot({
      sellerInfo: {
        'SKU-1': 'vendor-b',
      },
    });
    prismaMock.shopifyOrder.findUnique.mockResolvedValueOnce(shopifyOrder({
      lineItems: [
        lineItem({
          sku: 'SKU-1',
          originalVendorId: 'vendor-a',
          allocationLineItems: [{ id: 'allocation-line-1' }],
        }),
      ],
    }));

    const result = await createReconciliationService(buildEnv(snapshot)).reconcileShopifyOrder('order-1');

    expect(result?.reconciliationStatus).toBe('needs_attention');
    expect(prismaMock.operationalSignal.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: __reconciliationTesting.buildCanonicalOrderSignalId(
          __reconciliationTesting.CANONICAL_ORDER_SIGNAL_RULE_KEYS.operationalConflict,
          'order-1',
        ),
      },
    }));
    expect(prismaMock.shopifyOrderLineItem.update).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        originalVendorId: 'vendor-b',
      }),
    }));
    expect(prismaMock.vendorAllocation.update).not.toHaveBeenCalled();
  });
});
