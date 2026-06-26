import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppEnv } from '../backend/src/config/env.js';
import type { CanonicalShopifyReturnSnapshot } from '../backend/src/modules/shopify/shopify-admin.types.js';

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(prismaMock)),
  shopifyOrder: {
    findUnique: vi.fn(),
  },
  returnRecord: {
    findFirst: vi.fn(),
    upsert: vi.fn(),
  },
  operationalSignal: {
    upsert: vi.fn(),
    updateMany: vi.fn(),
  },
}));

const resolveAllocationForShopifyOrderLineItemMock = vi.hoisted(() => vi.fn());
const assertResolvedEconomicOwnerForMoneyMovementMock = vi.hoisted(() => vi.fn());

vi.mock('../backend/src/db/prisma.js', () => ({
  prisma: prismaMock,
}));

vi.mock('../backend/src/modules/orders/allocation-ownership-resolution.service.js', () => ({
  resolveAllocationForShopifyOrderLineItem: resolveAllocationForShopifyOrderLineItemMock,
}));

vi.mock('../backend/src/modules/finance/economic-owner-resolution.service.js', () => ({
  assertResolvedEconomicOwnerForMoneyMovement: assertResolvedEconomicOwnerForMoneyMovementMock,
}));

const {
  createCanonicalReturnReconciliationService,
  __canonicalReturnReconciliationTesting,
} = await import('../backend/src/modules/reconciliation/canonical-return-reconciliation.service.js');

function canonicalReturn(overrides: Partial<CanonicalShopifyReturnSnapshot> = {}): CanonicalShopifyReturnSnapshot {
  return {
    returnGid: 'gid://shopify/Return/7001',
    sourceShopifyReturnId: '7001',
    status: 'REQUESTED',
    createdAt: '2026-06-26T10:00:00.000Z',
    requestApprovedAt: null,
    closedAt: null,
    returnLineItems: [
      {
        returnLineItemGid: 'gid://shopify/ReturnLineItem/8001',
        fulfillmentLineItemGid: 'gid://shopify/FulfillmentLineItem/6001',
        lineItemGid: 'gid://shopify/LineItem/1001',
        sourceLineItemId: '1001',
        sku: 'SKU-1',
        returnReason: 'SIZE_TOO_SMALL',
        returnReasonNote: 'Too small',
        customerNote: null,
      },
    ],
    ...overrides,
  };
}

function buildEnv(returns: CanonicalShopifyReturnSnapshot[]): AppEnv {
  return {
    NODE_ENV: 'test',
    SHOPIFY_API_VERSION: '2026-01',
    SHOPIFY_SHOP_DOMAIN: 'demo.myshopify.com',
    SHOPIFY_MOCK_CANONICAL_RETURNS: JSON.stringify({
      'order-1': returns,
    }),
  } as AppEnv;
}

function localOrder() {
  return {
    id: 'shopify-order-db-1',
    sourceShopifyOrderId: 'order-1',
    sourceShopifyOrderNumber: '1101',
    lineItems: [
      {
        id: 'line-db-1',
        sourceLineItemId: '1001',
        sku: 'SKU-1',
      },
    ],
  };
}

function localReturnRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'return-request-7001-vendor-a-1001',
    vendorAllocationId: 'alloc-a',
    ownerVendorId: 'vendor-a',
    sourceShopifyRefundId: null,
    sourceShopifyReturnId: '7001',
    sourceShopifyReturnGid: 'gid://shopify/Return/7001',
    sourceShopifyLineItemId: '1001',
    returnLifecycleStatus: 'requested',
    returnRequestSource: 'shopify_return_request',
    requestCreatedAt: new Date('2026-06-26T10:00:00.000Z'),
    requestUpdatedAt: new Date('2026-06-26T10:00:00.000Z'),
    status: 'requested',
    reason: 'SIZE_TOO_SMALL',
    returnReasonNote: 'Too small',
    returnProviderShipmentId: null,
    returnLabel: null,
    returnReferenceId: null,
    vendorReceivedAt: null,
    vendorDecision: null,
    ...overrides,
  };
}

describe('canonical Shopify return reconciliation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.shopifyOrder.findUnique.mockResolvedValue(localOrder());
    prismaMock.returnRecord.findFirst.mockResolvedValue(null);
    prismaMock.returnRecord.upsert.mockResolvedValue({});
    prismaMock.operationalSignal.upsert.mockResolvedValue({});
    prismaMock.operationalSignal.updateMany.mockResolvedValue({ count: 0 });
    resolveAllocationForShopifyOrderLineItemMock.mockResolvedValue({
      allocation: {
        id: 'alloc-a',
        originalVendorId: 'vendor-a',
        assignedVendorId: 'vendor-a',
        sourceShopifyOrderId: 'order-1',
        sourceShopifyOrderNumber: '1101',
      },
      shopifyOrderLineItem: {
        id: 'line-db-1',
      },
    });
    assertResolvedEconomicOwnerForMoneyMovementMock.mockResolvedValue({
      economicOwnerVendorId: 'vendor-a',
      activeSaleLedgerId: 'fin-vendor-a-sale-order-1-alloc-a',
      supersededFromLedgerIds: [],
    });
  });

  it('creates missing local return records from canonical Shopify returns', async () => {
    const result = await createCanonicalReturnReconciliationService(
      buildEnv([canonicalReturn()]),
    ).reconcileShopifyOrderReturns('order-1');

    expect(result).toMatchObject({
      shopifyOrderId: 'order-1',
      returnsFetched: 1,
      returnsCreated: 1,
      failedCount: 0,
      results: [
        expect.objectContaining({
          returnId: '7001',
          status: 'created',
          affectedAllocationIds: ['alloc-a'],
          affectedVendorIds: ['vendor-a'],
          affectedReturnRecordIds: ['return-request-7001-vendor-a-1001'],
        }),
      ],
    });
    expect(prismaMock.returnRecord.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: 'return-request-7001-vendor-a-1001',
      },
      create: expect.objectContaining({
        vendorAllocationId: 'alloc-a',
        ownerVendorId: 'vendor-a',
        sourceShopifyReturnId: '7001',
        sourceShopifyReturnGid: 'gid://shopify/Return/7001',
        sourceShopifyLineItemId: '1001',
        returnLifecycleStatus: 'requested',
        returnRequestSource: 'shopify_return_request',
        status: 'requested',
      }),
    }));
  });

  it('is idempotent when the canonical return record is already present', async () => {
    prismaMock.returnRecord.findFirst.mockResolvedValue(localReturnRecord());

    const result = await createCanonicalReturnReconciliationService(
      buildEnv([canonicalReturn()]),
    ).reconcileShopifyOrderReturns('order-1');

    expect(result).toMatchObject({
      returnsAlreadyPresent: 1,
      returnsCreated: 0,
      returnRecordsRepaired: 0,
      results: [
        expect.objectContaining({
          status: 'already_present',
          reason: 'local_return_already_present',
        }),
      ],
    });
  });

  it('updates existing records forward when Shopify has approved the return', async () => {
    prismaMock.returnRecord.findFirst.mockResolvedValue(localReturnRecord());

    const result = await createCanonicalReturnReconciliationService(
      buildEnv([canonicalReturn({
        status: 'OPEN',
        requestApprovedAt: '2026-06-26T11:00:00.000Z',
      })]),
    ).reconcileShopifyOrderReturns('order-1');

    expect(result).toMatchObject({
      returnRecordsRepaired: 1,
      results: [
        expect.objectContaining({
          status: 'repaired',
        }),
      ],
    });
    expect(prismaMock.returnRecord.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({
        returnLifecycleStatus: 'approved',
        status: 'approved',
      }),
    }));
  });

  it('creates a manual-review signal and does not write when local order is missing', async () => {
    prismaMock.shopifyOrder.findUnique.mockResolvedValueOnce(null);

    const result = await createCanonicalReturnReconciliationService(
      buildEnv([canonicalReturn()]),
    ).reconcileShopifyOrderReturns('order-1');

    expect(result).toMatchObject({
      skippedCount: 1,
      signalsCreatedOrUpdated: 1,
      results: [
        expect.objectContaining({
          status: 'skipped',
          reason: 'canonical_return_missing_local_order',
        }),
      ],
    });
    expect(prismaMock.returnRecord.upsert).not.toHaveBeenCalled();
    expect(prismaMock.operationalSignal.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        ruleKey: 'canonical_return_missing_local_order',
        severity: 'CRITICAL',
      }),
    }));
  });

  it('creates an unmatched-line signal and preserves local state when ownership cannot be resolved', async () => {
    const result = await createCanonicalReturnReconciliationService(
      buildEnv([canonicalReturn({
        returnLineItems: [
          {
            ...canonicalReturn().returnLineItems[0],
            sourceLineItemId: 'missing-line',
            sku: 'MISSING-SKU',
          },
        ],
      })]),
    ).reconcileShopifyOrderReturns('order-1');

    expect(result).toMatchObject({
      failedCount: 1,
      signalsCreatedOrUpdated: 1,
      results: [
        expect.objectContaining({
          status: 'failed',
        }),
      ],
    });
    expect(prismaMock.returnRecord.upsert).not.toHaveBeenCalled();
    expect(prismaMock.operationalSignal.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        ruleKey: 'canonical_return_line_item_unmatched',
      }),
    }));
  });

  it('fails closed instead of downgrading local terminal return records', async () => {
    prismaMock.returnRecord.findFirst.mockResolvedValue(localReturnRecord({
      returnLifecycleStatus: 'closed',
      status: 'closed',
    }));

    const result = await createCanonicalReturnReconciliationService(
      buildEnv([canonicalReturn({ status: 'REQUESTED' })]),
    ).reconcileShopifyOrderReturns('order-1');

    expect(result).toMatchObject({
      failedCount: 1,
      results: [
        expect.objectContaining({
          status: 'failed',
          reason: expect.stringContaining('downgrade'),
        }),
      ],
    });
    expect(prismaMock.operationalSignal.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        ruleKey: 'canonical_return_conflicts_with_operational_state',
      }),
    }));
  });

  it('exposes canonical return signal keys and status mapper for diagnostics', () => {
    expect(__canonicalReturnReconciliationTesting.CANONICAL_RETURN_SIGNAL_RULE_KEYS)
      .toHaveProperty('repaired', 'canonical_return_repaired');
    expect(__canonicalReturnReconciliationTesting.mapCanonicalReturnStatus('OPEN')).toBe('approved');
    expect(__canonicalReturnReconciliationTesting.mapCanonicalReturnStatus('CANCELLED')).toBe('cancelled');
  });
});
