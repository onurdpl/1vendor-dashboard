import { describe, expect, it, vi } from 'vitest';
import type { AppEnv } from '../backend/src/config/env.js';
import type {
  CanonicalShopifyOrderSnapshot,
  CanonicalShopifyRefundSnapshot,
  CanonicalShopifyReturnSnapshot,
} from '../backend/src/modules/shopify/shopify-admin.types.js';
import {
  createCurrentStateOrderRepairService,
  CurrentStateOrderRepairError,
  __currentStateOrderRepairTesting,
  type CurrentStateOrderRepairDependencies,
  type CurrentStateOrderRepairSummary,
} from '../backend/src/modules/shopify/current-state-order-repair.service.js';

const actor = { userId: 'admin-1', email: 'admin@example.com' };

function canonicalOrder(overrides: Partial<CanonicalShopifyOrderSnapshot> = {}): CanonicalShopifyOrderSnapshot {
  return {
    orderGid: 'gid://shopify/Order/7856043819345',
    sourceShopifyOrderId: '7856043819345',
    sourceShopifyOrderNumber: '#1105',
    shopifyCreatedAt: '2026-07-11T16:00:00.000Z',
    currency: 'TRY',
    financialStatus: 'paid',
    cancelledAt: null,
    cancelReason: null,
    paymentGatewayName: 'shopify_payments',
    taxesIncluded: true,
    orderTaxAmount: '16.67',
    shippingAmount: '0.00',
    discountAmount: '0.00',
    totalPrice: '100.00',
    orderNote: null,
    orderTags: [],
    customerName: 'Test Customer',
    customerEmail: 'customer@example.com',
    customerPhone: '+905551112233',
    billingFullName: 'Test Customer',
    billingCompany: null,
    billingPhone: '+905551112233',
    billingCity: 'Istanbul',
    billingDistrict: 'Kadikoy',
    billingAddress1: 'Test street',
    billingAddress2: null,
    billingPostcode: '34000',
    shippingCountry: 'TR',
    shippingPostcode: '34000',
    shippingCity: 'Istanbul',
    shippingDistrict: 'Kadikoy',
    shippingAddress: 'Test street',
    sellerInfo: { 'SKU-1': 'yalispor' },
    lineItems: [
      {
        lineItemGid: 'gid://shopify/LineItem/1001',
        sourceLineItemId: '1001',
        shopifyProductId: '2001',
        sourceVariantId: '3001',
        sku: 'SKU-1',
        title: 'Test product',
        imageUrl: null,
        quantity: 1,
        currentQuantity: 1,
        refundableQuantity: 1,
        unitPrice: '100.00',
        unitPriceVatIncluded: '100.00',
        lineTotalVatIncluded: '100.00',
        lineTaxAmount: '16.67',
        vatRate: '20.00',
      },
    ],
    fulfillmentOrders: [
      {
        id: 'gid://shopify/FulfillmentOrder/4001',
        status: 'OPEN',
        requestStatus: 'UNSUBMITTED',
        lineItems: [
          {
            id: 'gid://shopify/FulfillmentOrderLineItem/5001',
            lineItemId: 'gid://shopify/LineItem/1001',
            remainingQuantity: 1,
            totalQuantity: 1,
          },
        ],
      },
    ],
    source: 'mock',
    ...overrides,
  };
}

function canonicalRefund(): CanonicalShopifyRefundSnapshot {
  return {
    refundGid: 'gid://shopify/Refund/6001',
    sourceShopifyRefundId: '6001',
    createdAt: '2026-07-11T17:00:00.000Z',
    note: 'Refunded',
    refundLineItems: [
      {
        refundLineItemGid: 'gid://shopify/RefundLineItem/7001',
        sourceRefundLineItemId: '7001',
        lineItemGid: 'gid://shopify/LineItem/1001',
        sourceLineItemId: '1001',
        sku: 'SKU-1',
        title: 'Test product',
        name: 'Test product',
        variantTitle: null,
        quantity: 1,
        subtotalAmount: '100.00',
        currencyCode: 'TRY',
      },
    ],
  };
}

function canonicalReturn(): CanonicalShopifyReturnSnapshot {
  return {
    returnGid: 'gid://shopify/Return/8001',
    sourceShopifyReturnId: '8001',
    status: 'REQUESTED',
    createdAt: '2026-07-11T17:30:00.000Z',
    requestApprovedAt: null,
    closedAt: null,
    returnLineItems: [
      {
        returnLineItemGid: 'gid://shopify/ReturnLineItem/9001',
        fulfillmentLineItemGid: 'gid://shopify/FulfillmentLineItem/9101',
        lineItemGid: 'gid://shopify/LineItem/1001',
        sourceLineItemId: '1001',
        sku: 'SKU-1',
        returnReason: 'OTHER',
        returnReasonNote: null,
        customerNote: null,
      },
    ],
  };
}

function summary(overrides: Partial<CurrentStateOrderRepairSummary> = {}): CurrentStateOrderRepairSummary {
  return {
    shopifyOrder: 'Created',
    allocation: 'Created',
    finance: 'Created',
    cancellationApplied: false,
    refundApplied: false,
    returnApplied: false,
    warnings: [],
    skipped: false,
    ...overrides,
  };
}

function dependencies(input: {
  order?: CanonicalShopifyOrderSnapshot;
  refunds?: CanonicalShopifyRefundSnapshot[];
  returns?: CanonicalShopifyReturnSnapshot[];
  state?: Partial<Awaited<ReturnType<CurrentStateOrderRepairDependencies['inspectLocalState']>>>;
  executeResult?: CurrentStateOrderRepairSummary;
  executeError?: Error;
} = {}) {
  const state = {
    orderExists: false,
    allocationExists: false,
    financeExists: false,
    cancelledAt: null,
    existingRefundIds: [],
    existingReturnIds: [],
    duplicateOrderIdsForNumber: [],
    vendorIds: ['yalispor'],
    activeFinancialProfileVendorIds: ['yalispor'],
    ...input.state,
  };
  const executeRepair = vi.fn(async () => {
    if (input.executeError) {
      throw input.executeError;
    }
    return input.executeResult ?? summary({
      cancellationApplied: Boolean(input.order?.cancelledAt),
      refundApplied: Boolean(input.refunds?.length),
      returnApplied: Boolean(input.returns?.length),
    });
  });
  const recordFailure = vi.fn(async () => undefined);
  const deps: CurrentStateOrderRepairDependencies = {
    fetchCanonicalBundle: vi.fn(async () => ({
      order: input.order ?? canonicalOrder(),
      refunds: input.refunds ?? [],
      returns: input.returns ?? [],
    })),
    inspectLocalState: vi.fn(async () => state),
    executeRepair,
    recordFailure,
  };
  return { deps, executeRepair, recordFailure, state };
}

function service(deps: CurrentStateOrderRepairDependencies) {
  return createCurrentStateOrderRepairService({ NODE_ENV: 'test' } as AppEnv, deps);
}

describe('Shopify current-state order repair', () => {
  it('repairs one open order from its canonical current state', async () => {
    const fixture = dependencies();
    const result = await service(fixture.deps).repair({ orderIdentifier: '#1105', execute: true, actor });

    expect(result).toMatchObject({ dryRun: false, executed: true, shopifyOrderId: '7856043819345' });
    expect(fixture.executeRepair).toHaveBeenCalledOnce();
  });

  it('repairs a cancelled order without using voided financial status as the signal', async () => {
    const order = canonicalOrder({
      financialStatus: 'voided',
      cancelledAt: '2026-07-11T18:00:00.000Z',
      cancelReason: 'customer',
    });
    const fixture = dependencies({ order, executeResult: summary({ cancellationApplied: true }) });
    const result = await service(fixture.deps).repair({ orderIdentifier: '7856043819345', execute: true, actor });

    expect(result.summary.cancellationApplied).toBe(true);
    expect(fixture.executeRepair.mock.calls[0][0].bundle.order.cancelledAt).toBe(order.cancelledAt);
  });

  it('fails closed for a missing cancelled order with historical fulfillment progress', async () => {
    const order = canonicalOrder({
      cancelledAt: '2026-07-11T18:00:00.000Z',
      fulfillmentOrders: [
        {
          id: 'gid://shopify/FulfillmentOrder/4001',
          status: 'CLOSED',
          requestStatus: 'SUBMITTED',
          lineItems: [
            {
              id: 'gid://shopify/FulfillmentOrderLineItem/5001',
              lineItemId: 'gid://shopify/LineItem/1001',
              remainingQuantity: 0,
              totalQuantity: 1,
            },
          ],
        },
      ],
    });
    const fixture = dependencies({ order });

    await expect(service(fixture.deps).repair({ orderIdentifier: '#1105', execute: true, actor }))
      .rejects.toThrow(/fulfillment progress requires manual review/i);
    expect(fixture.executeRepair).not.toHaveBeenCalled();
  });

  it('applies canonical refund state through the repair transaction', async () => {
    const fixture = dependencies({ refunds: [canonicalRefund()], executeResult: summary({ refundApplied: true }) });
    const result = await service(fixture.deps).repair({ orderIdentifier: '#1105', execute: true, actor });
    expect(result.summary.refundApplied).toBe(true);
  });

  it('applies canonical return state through the repair transaction', async () => {
    const fixture = dependencies({ returns: [canonicalReturn()], executeResult: summary({ returnApplied: true }) });
    const result = await service(fixture.deps).repair({ orderIdentifier: '#1105', execute: true, actor });
    expect(result.summary.returnApplied).toBe(true);
  });

  it('reports already repaired records as existing and skipped', async () => {
    const existing = summary({ shopifyOrder: 'Existing', allocation: 'Existing', finance: 'Existing', skipped: true });
    const fixture = dependencies({
      state: { orderExists: true, allocationExists: true, financeExists: true },
      executeResult: existing,
    });
    const result = await service(fixture.deps).repair({ orderIdentifier: '#1105', execute: true, actor });
    expect(result.summary).toEqual(existing);
  });

  it('remains idempotent across duplicate executions', async () => {
    let executed = false;
    const fixture = dependencies();
    fixture.deps.inspectLocalState = vi.fn(async () => ({
      ...fixture.state,
      orderExists: executed,
      allocationExists: executed,
      financeExists: executed,
    }));
    fixture.deps.executeRepair = vi.fn(async ({ inspectedState }) => {
      executed = true;
      return summary({
        shopifyOrder: inspectedState.orderExists ? 'Existing' : 'Created',
        allocation: inspectedState.allocationExists ? 'Existing' : 'Created',
        finance: inspectedState.financeExists ? 'Existing' : 'Created',
        skipped: inspectedState.orderExists,
      });
    });
    const repairService = service(fixture.deps);
    const first = await repairService.repair({ orderIdentifier: '#1105', execute: true, actor });
    const second = await repairService.repair({ orderIdentifier: '#1105', execute: true, actor });

    expect(first.summary.shopifyOrder).toBe('Created');
    expect(second.summary).toMatchObject({ shopifyOrder: 'Existing', allocation: 'Existing', finance: 'Existing', skipped: true });
  });

  it('preserves an existing voided sale ledger instead of reopening it on repeat repair', async () => {
    const order = canonicalOrder({
      cancelledAt: '2026-07-11T18:00:00.000Z',
      financialStatus: 'voided',
    });
    const tx = {
      shopifyOrder: {
        findUnique: vi.fn(async () => ({
          id: 'order-db-1',
          allocations: [
            {
              id: 'alloc-yalispor-7856043819345',
              financeEntries: [{ id: 'sale-ledger-voided' }],
            },
          ],
        })),
        update: vi.fn(async () => ({ id: 'order-db-1' })),
      },
    };

    const result = await __currentStateOrderRepairTesting.applyBaseOrderInTransaction(
      tx as never,
      { order, refunds: [], returns: [] },
    );

    expect(result.summary).toEqual({
      shopifyOrder: 'Existing',
      allocation: 'Existing',
      finance: 'Existing',
    });
    expect(tx.shopifyOrder.update).toHaveBeenCalledOnce();
  });

  it('defaults to dry-run and performs no mutation or audit write', async () => {
    const fixture = dependencies();
    const result = await service(fixture.deps).repair({ orderIdentifier: '#1105', actor });

    expect(result).toMatchObject({ dryRun: true, executed: false });
    expect(fixture.executeRepair).not.toHaveBeenCalled();
    expect(fixture.recordFailure).not.toHaveBeenCalled();
  });

  it('returns a safe upstream error when canonical Shopify state cannot be fetched', async () => {
    const fixture = dependencies();
    fixture.deps.fetchCanonicalBundle = vi.fn(async () => {
      throw new Error('network details must not escape');
    });

    await expect(service(fixture.deps).repair({ orderIdentifier: '#1105', actor }))
      .rejects.toMatchObject({
        code: 'canonical_snapshot_fetch_failed',
        message: 'Shopify canonical current state could not be fetched.',
        statusCode: 502,
      });
  });

  it('records a failed attempt after the repair transaction rolls back', async () => {
    const fixture = dependencies({ executeError: new Error('transaction rolled back') });

    await expect(service(fixture.deps).repair({ orderIdentifier: '#1105', execute: true, actor }))
      .rejects.toMatchObject({ code: 'repair_transaction_failed', statusCode: 409 });
    expect(fixture.recordFailure).toHaveBeenCalledWith(expect.objectContaining({
      errorMessage: 'transaction rolled back',
    }));
  });

  it('rejects seller_info mappings to an unknown vendor before mutation', async () => {
    const fixture = dependencies({ state: { vendorIds: ['another-vendor'] } });
    await expect(service(fixture.deps).repair({ orderIdentifier: '#1105', execute: true, actor }))
      .rejects.toThrow(/unknown vendor yalispor/i);
    expect(fixture.executeRepair).not.toHaveBeenCalled();
  });

  it('rejects missing seller_info before mutation', async () => {
    const fixture = dependencies({ order: canonicalOrder({ sellerInfo: null }) });
    await expect(service(fixture.deps).repair({ orderIdentifier: '#1105', execute: true, actor }))
      .rejects.toThrow(/seller_info is missing/i);
    expect(fixture.executeRepair).not.toHaveBeenCalled();
  });

  it('rejects an unknown SKU mapping before mutation', async () => {
    const fixture = dependencies({ order: canonicalOrder({ sellerInfo: { 'OTHER-SKU': 'yalispor' } }) });
    await expect(service(fixture.deps).repair({ orderIdentifier: '#1105', execute: true, actor }))
      .rejects.toThrow(/No seller_info mapping exists for SKU SKU-1/i);
    expect(fixture.executeRepair).not.toHaveBeenCalled();
  });

  it('fails closed on a partial lifecycle application', async () => {
    const fixture = dependencies({
      refunds: [canonicalRefund()],
      returns: [canonicalReturn()],
      executeError: new Error('return mapping failed after refund stage'),
    });
    await expect(service(fixture.deps).repair({ orderIdentifier: '#1105', execute: true, actor }))
      .rejects.toBeInstanceOf(CurrentStateOrderRepairError);
    expect(fixture.recordFailure).toHaveBeenCalledOnce();
  });

  it('preserves rollback semantics when transaction execution throws', async () => {
    const persisted: string[] = [];
    const fixture = dependencies();
    fixture.deps.executeRepair = vi.fn(async () => {
      const staged = ['order', 'allocation', 'ledger'];
      persisted.push(...staged);
      try {
        throw new Error('forced failure');
      } catch (error) {
        persisted.splice(0, staged.length);
        throw error;
      }
    });

    await expect(service(fixture.deps).repair({ orderIdentifier: '#1105', execute: true, actor }))
      .rejects.toMatchObject({ code: 'repair_transaction_failed' });
    expect(persisted).toEqual([]);
  });

  it('rejects ranges and bulk-like identifiers', async () => {
    const fixture = dependencies();
    await expect(service(fixture.deps).repair({ orderIdentifier: '#1105-#1106', actor }))
      .rejects.toMatchObject({ code: 'invalid_order_identifier' });
  });
});
