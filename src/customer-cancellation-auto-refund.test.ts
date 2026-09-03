import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  customerCancellationRequestItem: {
    findUnique: vi.fn(),
  },
  operationalJob: {
    findMany: vi.fn(),
    updateMany: vi.fn(),
  },
}));

vi.mock('../backend/src/db/prisma.js', () => ({ prisma: prismaMock }));

import {
  buildCustomerCancellationRefundSubmission,
  classifyCustomerCancellationAutoRefundEligibility,
  processCustomerCancellationAutoRefundItem,
  type CustomerCancellationAutoRefundCleanContext,
} from '../backend/src/modules/orders/customer-cancellation-auto-refund.service.js';
import {
  createCustomerCancellationAutoRefundExecutor,
  registerCustomerCancellationAutoRefundExecutor,
} from '../backend/src/modules/orders/customer-cancellation-auto-refund-executor.service.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function cleanContext(quantity = 1): CustomerCancellationAutoRefundCleanContext {
  return {
    sourceShopifyOrderId: '9001',
    orderCurrency: 'TRY',
    allocationId: 'allocation-a',
    sourceLineItemId: 'line-a',
    requestedQuantity: quantity,
    preRefundCurrentQuantity: 2,
    preRefundRefundableQuantity: 2,
    locationId: 'gid://shopify/Location/10',
    fulfillmentOrders: { fulfillmentOrders: [], source: 'mock' },
    preview: {
      orderGid: 'gid://shopify/Order/9001',
      sourceShopifyOrderId: '9001',
      refundLineItemsPreview: [{ lineItemId: 'line-a', quantity, restockType: 'NO_RESTOCK' }],
      suggestedRefund: {
        totalRefundAmount: '25.00', currencyCode: 'TRY', subtotalAmount: '25.00', totalTaxAmount: '0.00',
        shippingAmount: null, shippingMaximumRefundableAmount: '10.00', shippingCurrencyCode: 'TRY', maximumRefundableAmount: '25.00',
        suggestedTransactions: [{ gateway: 'test', formattedGateway: 'Test', amount: '25.00', currencyCode: 'TRY', parentTransactionId: 'gid://shopify/OrderTransaction/1' }],
        refundLineItems: [{ lineItemId: 'line-a', quantity, restockType: 'NO_RESTOCK', subtotalAmount: '25.00', totalTaxAmount: '0.00', currencyCode: 'TRY' }],
      },
      graphqlErrors: [],
      source: 'shopify_admin',
    },
  };
}

function localItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cancel-item-1',
    requestId: 'cancel-request-1',
    status: 'PENDING',
    requestedQuantity: 1,
    shopifyOrderLineItemId: 'line-local-a',
    vendorAllocationId: 'allocation-a',
    request: {
      order: { id: 'order-local', sourceShopifyOrderId: '9001', currency: 'TRY', cancelledAt: null },
      items: [{ id: 'cancel-item-1', outboundShopifyRefundAttempt: null }],
    },
    shopifyOrderLineItem: { sourceLineItemId: 'line-a' },
    outboundShopifyRefundAttempt: null,
    vendorAllocation: {
      allocationStatus: 'ACTIVE', reassignmentRequired: false, cancellationReason: null, cancelRefundReviewStatus: null,
      trackingNumber: null, carrier: null, vendorIntegrationTrackingUrl: null, vendorIntegrationShippedAt: null,
      fulfillment: null, shipmentExecutions: [], vendorIntegrationShipmentEvents: [], returnRecords: [], refundRecords: [],
      lineItems: [{ shopifyLineItemId: 'line-local-a', quantity: 2 }],
      economicTransfers: [], financeIntegrityAlerts: [],
      financeEntries: [{ id: 'sale-1', payoutStatus: 'PENDING', payoutBatchLines: [], settlementApprovalLines: [] }],
      outboundShopifyRefundAttempts: [],
    },
    ...overrides,
  };
}

function shopifyService(overrides: Record<string, unknown> = {}) {
  return {
    fetchCustomerCancellationOrderSnapshot: vi.fn().mockResolvedValue({
      orderGid: 'gid://shopify/Order/9001', sourceShopifyOrderId: '9001', sourceShopifyOrderNumber: '#test', customerGid: 'gid://shopify/Customer/1', cancelledAt: null,
      lineItems: [{ lineItemGid: 'gid://shopify/LineItem/line-a', sourceLineItemId: 'line-a', title: 'A', variantTitle: null, imageUrl: null, quantity: 2, currentQuantity: 2, refundableQuantity: 2 }],
      fulfillmentOrders: [], source: 'mock',
    }),
    fetchCanonicalRefundsForOrder: vi.fn().mockResolvedValue({
      orderGid: 'gid://shopify/Order/9001', sourceShopifyOrderId: '9001', orderTotalRefundedAmount: '0', orderTotalRefundedCurrencyCode: 'TRY', refundsListComplete: true, refunds: [], source: 'mock',
    }),
    fetchCanonicalReturnsForOrder: vi.fn().mockResolvedValue({ orderGid: 'gid://shopify/Order/9001', sourceShopifyOrderId: '9001', returns: [], source: 'mock' }),
    fetchFulfillmentOrdersForCancellationClassification: vi.fn().mockResolvedValue({
      fulfillmentOrders: [{ id: 'fo-1', status: 'OPEN', requestStatus: 'UNSUBMITTED', supportedActions: [], assignedLocationId: 'location-1', lineItems: [{ id: 'foli-1', lineItemId: 'line-a', remainingQuantity: 2, totalQuantity: 2 }] }],
      source: 'mock',
    }),
    previewSuggestedRefund: vi.fn().mockResolvedValue(cleanContext().preview),
    ...overrides,
  };
}

describe('customer cancellation auto-refund safety contract', () => {
  beforeEach(() => vi.clearAllMocks());

  it('classifies exact partial quantity as clean using canonical order, refund, return, fulfillment-order and suggested-refund evidence', async () => {
    prismaMock.customerCancellationRequestItem.findUnique.mockResolvedValue(localItem());
    const service = shopifyService();
    const result = await classifyCustomerCancellationAutoRefundEligibility({ itemId: 'cancel-item-1', shopifyAdminService: service as never });
    expect(result.classification).toBe('CLEAN');
    expect(service.previewSuggestedRefund).toHaveBeenCalledWith({
      shopifyOrderId: '9001',
      refundLineItems: [{ sourceLineItemId: 'line-a', quantity: 1, restockType: 'NO_RESTOCK' }],
      refundShipping: false,
    });
  });

  it('fails closed before Shopify access when shipment authority appears', async () => {
    prismaMock.customerCancellationRequestItem.findUnique.mockResolvedValue(localItem({
      vendorAllocation: { ...localItem().vendorAllocation, trackingNumber: 'TRACK-1' },
    }));
    const service = shopifyService();
    const result = await classifyCustomerCancellationAutoRefundEligibility({ itemId: 'cancel-item-1', shopifyAdminService: service as never });
    expect(result.classification).toBe('TOO_LATE');
    expect(service.fetchCustomerCancellationOrderSnapshot).not.toHaveBeenCalled();
  });

  it('holds finance conflicts and active overlapping attempts without submitting a refund', async () => {
    const service = shopifyService();
    prismaMock.customerCancellationRequestItem.findUnique.mockResolvedValueOnce(localItem({
      vendorAllocation: { ...localItem().vendorAllocation, financeIntegrityAlerts: [{ id: 'alert-1' }] },
    }));
    await expect(classifyCustomerCancellationAutoRefundEligibility({ itemId: 'cancel-item-1', shopifyAdminService: service as never }))
      .resolves.toMatchObject({ classification: 'FINANCE_CONFLICT' });
    prismaMock.customerCancellationRequestItem.findUnique.mockResolvedValueOnce(localItem({
      vendorAllocation: { ...localItem().vendorAllocation, outboundShopifyRefundAttempts: [{ id: 'other-attempt', customerCancellationRequestItemId: null }] },
    }));
    await expect(classifyCustomerCancellationAutoRefundEligibility({ itemId: 'cancel-item-1', shopifyAdminService: service as never }))
      .resolves.toMatchObject({ classification: 'REFUND_CONFLICT' });
  });

  it('defers an active sibling request attempt instead of terminally conflicting', async () => {
    const siblingItem = localItem({
      request: {
        order: { id: 'order-local', sourceShopifyOrderId: '9001', currency: 'TRY', cancelledAt: null },
        items: [
          { id: 'cancel-item-1', outboundShopifyRefundAttempt: null },
          { id: 'cancel-item-2', outboundShopifyRefundAttempt: { id: 'attempt-2', status: 'SHOPIFY_ACTION_PENDING' } },
        ],
      },
    });
    prismaMock.customerCancellationRequestItem.findUnique.mockResolvedValue(siblingItem);
    const service = shopifyService();

    await expect(processCustomerCancellationAutoRefundItem({
      itemId: 'cancel-item-1',
      shopifyAdminService: service as never,
    })).resolves.toBe('RETRYABLE');
    expect(service.previewSuggestedRefund).not.toHaveBeenCalled();
  });

  it('builds an exact partial product-only refund with stable authority, no shipping and no notification', () => {
    const result = buildCustomerCancellationRefundSubmission({ itemId: 'cancel-item-1', attemptId: 'attempt-1', context: cleanContext(1) });
    expect(result.blockers).toEqual([]);
    expect(result.refund.refundLineItems).toEqual([{
      lineItemId: 'line-a', quantity: 1, restockType: 'NO_RESTOCK', locationId: 'gid://shopify/Location/10',
    }]);
    expect(result.refund.shipping).toBeNull();
    expect(result.refund.notify).toBe(false);
    expect(result.refund.idempotencyKey).toBe('shopify-refund:allocation-a:attempt-1');
  });

  it('builds customer-cancellation refunds without intentionally requesting Shopify inventory restock', () => {
    const context = cleanContext(2);
    context.shippingRefundAmount = '10.00';
    context.preview.suggestedRefund = {
      ...context.preview.suggestedRefund!,
      shippingAmount: '10.00',
      totalRefundAmount: '35.00',
      suggestedTransactions: [{ gateway: 'test', formattedGateway: 'Test', amount: '35.00', currencyCode: 'TRY', parentTransactionId: 'gid://shopify/OrderTransaction/1' }],
    };

    const result = buildCustomerCancellationRefundSubmission({ itemId: 'cancel-item-1', attemptId: 'attempt-1', context });

    expect(result.blockers).toEqual([]);
    expect(result.refund.refundLineItems).toEqual([{
      lineItemId: 'line-a', quantity: 2, restockType: 'NO_RESTOCK', locationId: 'gid://shopify/Location/10',
    }]);
    expect(result.refund.refundLineItems).not.toContainEqual(expect.objectContaining({ restockType: 'CANCEL' }));
    expect(result.refund.shipping).toEqual({ amount: '10.00' });
    expect(result.refund.transactions).toEqual([{ parentTransactionId: 'gid://shopify/OrderTransaction/1', amount: '35.00', gateway: 'test' }]);
  });

  it('does not register an executor when the default-off feature flag is disabled', () => {
    const app = { addHook: vi.fn(), log: logger };
    const result = registerCustomerCancellationAutoRefundExecutor(app as never, {
      CUSTOMER_CANCELLATION_AUTO_REFUND_ENABLED: false,
      DATABASE_URL: 'postgresql://disposable',
    } as never);
    expect(result).toBeNull();
    expect(app.addHook).not.toHaveBeenCalled();
  });

  it('claims with a generation fence and schedules canonical reconciliation after refund submission', async () => {
    prismaMock.operationalJob.findMany.mockResolvedValue([{
      id: 'job-1', status: 'PENDING', processingGeneration: 0, retryCount: 0, maxRetries: 8,
      customerCancellationRequestItemId: 'cancel-item-1',
    }]);
    prismaMock.operationalJob.updateMany.mockResolvedValue({ count: 1 });
    const processItem = vi.fn().mockResolvedValue('AWAITING_RECONCILIATION');
    const executor = createCustomerCancellationAutoRefundExecutor({
      env: { CUSTOMER_CANCELLATION_AUTO_REFUND_BATCH_SIZE: 1, CUSTOMER_CANCELLATION_AUTO_REFUND_LEASE_MS: 60_000 } as never,
      logger,
      processItem,
    });
    const summary = await executor.runCycle();
    expect(summary).toEqual({ candidates: 1, claimed: 1 });
    expect(processItem).toHaveBeenCalledWith('cancel-item-1');
    expect(prismaMock.operationalJob.updateMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: expect.objectContaining({ id: 'job-1', processingGeneration: 0 }),
      data: expect.objectContaining({ status: 'PROCESSING', processingGeneration: 1 }),
    }));
    expect(prismaMock.operationalJob.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'job-1', processingGeneration: 1 }),
      data: expect.objectContaining({ status: 'RETRY_SCHEDULED' }),
    }));
  });
});
