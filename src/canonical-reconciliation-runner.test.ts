import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppEnv } from '../backend/src/config/env.js';
import type { CanonicalShopifyOrderSnapshot } from '../backend/src/modules/shopify/shopify-admin.types.js';

const prismaMock = vi.hoisted(() => ({
  canonicalReconciliationRun: {
    create: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  shopifyOrder: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
  },
  refundRecord: {
    count: vi.fn(),
  },
  returnRecord: {
    count: vi.fn(),
  },
}));

const reconcileShopifyOrderMock = vi.hoisted(() => vi.fn());
const reconcileShopifyOrderRefundsMock = vi.hoisted(() => vi.fn());
const reconcileShopifyOrderReturnsMock = vi.hoisted(() => vi.fn());
const reconcileShopifyOrderCancellationMock = vi.hoisted(() => vi.fn());

vi.mock('../backend/src/db/prisma.js', () => ({
  prisma: prismaMock,
}));

vi.mock('../backend/src/modules/reconciliation/reconciliation.service.js', () => ({
  createReconciliationService: vi.fn(() => ({
    reconcileShopifyOrder: reconcileShopifyOrderMock,
  })),
}));

vi.mock('../backend/src/modules/reconciliation/canonical-refund-reconciliation.service.js', () => ({
  createCanonicalRefundReconciliationService: vi.fn(() => ({
    reconcileShopifyOrderRefunds: reconcileShopifyOrderRefundsMock,
  })),
}));

vi.mock('../backend/src/modules/reconciliation/canonical-return-reconciliation.service.js', () => ({
  createCanonicalReturnReconciliationService: vi.fn(() => ({
    reconcileShopifyOrderReturns: reconcileShopifyOrderReturnsMock,
  })),
}));

vi.mock('../backend/src/modules/reconciliation/canonical-cancellation-reconciliation.service.js', () => ({
  createCanonicalCancellationReconciliationService: vi.fn(() => ({
    reconcileShopifyOrderCancellation: reconcileShopifyOrderCancellationMock,
  })),
}));

const {
  getNextCanonicalReconciliationRunAt,
  runCanonicalReconciliation,
} = await import('../backend/src/modules/reconciliation/canonical-reconciliation-runner.service.js');

function canonicalOrder(overrides: Partial<CanonicalShopifyOrderSnapshot> = {}): CanonicalShopifyOrderSnapshot {
  return {
    orderGid: 'gid://shopify/Order/order-1',
    sourceShopifyOrderId: 'order-1',
    sourceShopifyOrderNumber: '#1001',
    shopifyCreatedAt: '2026-06-25T10:00:00.000Z',
    currency: 'TRY',
    financialStatus: 'paid',
    cancelledAt: null,
    cancelReason: null,
    paymentGatewayName: 'shopify_payments',
    taxesIncluded: true,
    orderTaxAmount: '10.00',
    shippingAmount: '5.00',
    discountAmount: '0.00',
    totalPrice: '100.00',
    orderNote: null,
    orderTags: [],
    customerName: 'Canonical Customer',
    customerEmail: 'canonical@example.test',
    customerPhone: '+905551112233',
    billingFullName: 'Canonical Customer',
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
        currentQuantity: 1,
        refundableQuantity: 1,
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

function localOrder(overrides: Record<string, unknown> = {}) {
  return {
    sourceShopifyOrderNumber: '#9999',
    financialStatus: 'pending',
    customerName: 'Stale Customer',
    customerEmail: 'stale@example.test',
    customerPhone: null,
    orderTaxAmount: '9.00',
    shippingAmount: '5.00',
    discountAmount: '0.00',
    totalPrice: '100.00',
    lineItems: [
      {
        sourceLineItemId: 'line-1',
        sku: 'SKU-OLD',
        title: 'Stale Product',
        quantity: 1,
        imageUrl: null,
      },
    ],
    allocations: [
      {
        fulfillmentStatus: 'PENDING',
        shippingStatus: 'AWAITING_SHIPMENT',
        trackingNumber: null,
        fulfillment: null,
        refundRecords: [],
        returnRecords: [],
        financeEntries: [],
      },
    ],
    ...overrides,
  };
}

function buildEnv(input: {
  mode?: 'dry-run' | 'repair';
  order?: CanonicalShopifyOrderSnapshot;
  refunds?: unknown[];
  returns?: unknown[];
} = {}): AppEnv {
  return {
    NODE_ENV: 'test',
    SHOPIFY_API_VERSION: '2026-01',
    SHOPIFY_MOCK_CANONICAL_ORDER_SNAPSHOT: JSON.stringify({
      'order-1': input.order ?? canonicalOrder(),
    }),
    SHOPIFY_MOCK_ORDER_FULFILLMENT_STATE: JSON.stringify({
      'order-1': {
        orderName: '#1001',
        displayFulfillmentStatus: 'FULFILLED',
        fulfillments: [
          {
            id: 'fulfillment-1',
            trackingInfo: [{ number: 'TRACK-1' }],
          },
        ],
      },
    }),
    SHOPIFY_MOCK_CANONICAL_REFUNDS: JSON.stringify({
      'order-1': {
        orderTotalRefundedAmount: input.refunds?.length ? '100.00' : '0.00',
        orderTotalRefundedCurrencyCode: 'TRY',
        refundsListComplete: true,
        refunds: input.refunds ?? [],
      },
    }),
    SHOPIFY_MOCK_CANONICAL_RETURNS: JSON.stringify({
      'order-1': input.returns ?? [],
    }),
    CANONICAL_RECONCILIATION_MODE: input.mode ?? 'dry-run',
    CANONICAL_RECONCILIATION_LOOKBACK_DAYS: 3,
    CANONICAL_RECONCILIATION_ORDER_LIMIT: 500,
    CANONICAL_RECONCILIATION_SCHEDULE_HOUR: 3,
    CANONICAL_RECONCILIATION_ENABLED: false,
  } as AppEnv;
}

function runRow(overrides: Record<string, unknown> = {}) {
  const now = new Date('2026-06-26T03:00:00.000Z');
  return {
    id: 'canonical-run-1',
    mode: 'dry-run',
    status: 'RUNNING',
    startedAt: now,
    finishedAt: null,
    durationMs: null,
    lookbackDays: 3,
    orderLimit: 500,
    ordersScanned: 0,
    repairOpportunities: 0,
    wouldRepairOrders: 0,
    wouldRepairFulfillment: 0,
    wouldRepairRefunds: 0,
    wouldRepairReturns: 0,
    wouldRepairCancellations: 0,
    wouldCreateSignals: 0,
    wouldRepairLedgers: 0,
    wouldRepairFinanceEvents: 0,
    errorsJson: [],
    perOrderDetailsJson: [],
    ...overrides,
  };
}

describe('canonical reconciliation runner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.canonicalReconciliationRun.findFirst.mockResolvedValue(null);
    prismaMock.canonicalReconciliationRun.create.mockImplementation(async ({ data }) => runRow(data));
    prismaMock.canonicalReconciliationRun.update.mockImplementation(async ({ data }) => runRow(data));
    prismaMock.shopifyOrder.findMany.mockResolvedValue([{ sourceShopifyOrderId: 'order-1' }]);
    prismaMock.shopifyOrder.findUnique.mockResolvedValue(localOrder());
    prismaMock.refundRecord.count.mockResolvedValue(0);
    prismaMock.returnRecord.count.mockResolvedValue(0);
    reconcileShopifyOrderMock.mockResolvedValue({ reconciliationStatus: 'repaired', repairedFields: [{ field: 'customerName' }] });
    reconcileShopifyOrderRefundsMock.mockResolvedValue({
      refundsCreated: 1,
      ledgersRepaired: 1,
      eventsRepaired: 2,
    });
    reconcileShopifyOrderReturnsMock.mockResolvedValue({
      returnsCreated: 1,
      returnRecordsRepaired: 0,
    });
    reconcileShopifyOrderCancellationMock.mockResolvedValue({
      ledgersHeldOrVoided: ['ledger-1'],
    });
  });

  it('schedules the next daily run at the configured hour', () => {
    const sameDay = getNextCanonicalReconciliationRunAt({
      now: new Date(2026, 5, 26, 2, 0, 0),
      scheduleHour: 3,
    });
    expect(sameDay.getFullYear()).toBe(2026);
    expect(sameDay.getMonth()).toBe(5);
    expect(sameDay.getDate()).toBe(26);
    expect(sameDay.getHours()).toBe(3);

    const nextDay = getNextCanonicalReconciliationRunAt({
      now: new Date(2026, 5, 26, 4, 0, 0),
      scheduleHour: 3,
    });
    expect(nextDay.getFullYear()).toBe(2026);
    expect(nextDay.getMonth()).toBe(5);
    expect(nextDay.getDate()).toBe(27);
    expect(nextDay.getHours()).toBe(3);
  });

  it('persists dry-run report without invoking repair services', async () => {
    const report = await runCanonicalReconciliation(buildEnv({
      refunds: [
        {
          refundGid: 'gid://shopify/Refund/5001',
          sourceShopifyRefundId: '5001',
          createdAt: '2026-06-26T10:00:00.000Z',
          updatedAt: '2026-06-26T10:00:01.000Z',
          note: null,
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
          refundLineItems: [],
        },
      ],
      returns: [
        {
          returnGid: 'gid://shopify/Return/7001',
          sourceShopifyReturnId: '7001',
          status: 'REQUESTED',
          createdAt: '2026-06-26T10:00:00.000Z',
          requestApprovedAt: null,
          closedAt: null,
          returnLineItems: [],
        },
      ],
    }), { mode: 'dry-run' });

    expect(report.status).toBe('COMPLETED');
    expect(report.ordersScanned).toBe(1);
    expect(report.repairOpportunities).toBeGreaterThan(0);
    expect(prismaMock.canonicalReconciliationRun.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'RUNNING', mode: 'dry-run' }),
    }));
    expect(prismaMock.canonicalReconciliationRun.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'COMPLETED',
        wouldRepairRefunds: 1,
        wouldRepairReturns: 1,
      }),
    }));
    expect(reconcileShopifyOrderMock).not.toHaveBeenCalled();
    expect(reconcileShopifyOrderRefundsMock).not.toHaveBeenCalled();
    expect(reconcileShopifyOrderReturnsMock).not.toHaveBeenCalled();
    expect(reconcileShopifyOrderCancellationMock).not.toHaveBeenCalled();
  });

  it('prevents overlapping runs', async () => {
    prismaMock.canonicalReconciliationRun.findFirst.mockResolvedValueOnce(runRow({ id: 'active-run', status: 'RUNNING' }));

    const report = await runCanonicalReconciliation(buildEnv(), { mode: 'dry-run' });

    expect(report.status).toBe('BLOCKED');
    expect(report.errors[0]?.message).toContain('already in progress');
    expect(prismaMock.shopifyOrder.findMany).not.toHaveBeenCalled();
  });

  it('continues when one order fails and records the per-order error', async () => {
    prismaMock.shopifyOrder.findMany.mockResolvedValue([
      { sourceShopifyOrderId: 'order-1' },
      { sourceShopifyOrderId: 'order-2' },
    ]);
    prismaMock.shopifyOrder.findUnique
      .mockResolvedValueOnce(localOrder())
      .mockRejectedValueOnce(new Error('Local lookup failed'));

    const report = await runCanonicalReconciliation(buildEnv(), { mode: 'dry-run' });

    expect(report.status).toBe('FAILED');
    expect(report.errors).toEqual([{ shopifyOrderId: 'order-2', message: 'Local lookup failed' }]);
    expect(report.perOrderDetails).toHaveLength(2);
    expect(report.perOrderDetails[1]).toMatchObject({
      shopifyOrderId: 'order-2',
      status: 'failed',
    });
  });

  it('reuses lifecycle reconciliation services in repair mode', async () => {
    const report = await runCanonicalReconciliation(buildEnv({ mode: 'repair' }), { mode: 'repair' });

    expect(report.status).toBe('COMPLETED');
    expect(reconcileShopifyOrderMock).toHaveBeenCalledWith('order-1');
    expect(reconcileShopifyOrderRefundsMock).toHaveBeenCalledWith('order-1');
    expect(reconcileShopifyOrderReturnsMock).toHaveBeenCalledWith('order-1');
    expect(reconcileShopifyOrderCancellationMock).toHaveBeenCalledWith('order-1');
  });
});
