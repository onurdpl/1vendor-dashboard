import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  executeAdminShopifyRefund,
  getAdminShopifyOrderBreakdown,
  previewAdminShopifyRefund,
  requestAdminCancelRefundReview,
  sendAdminProductPanelVariantDisableDryRun,
  transferAdminAllocationEconomics,
} from './orders';

const apiClientPost = vi.hoisted(() => vi.fn());
const apiClientGet = vi.hoisted(() => vi.fn());

vi.mock('../../lib/api-client', () => ({
  apiClient: {
    get: apiClientGet,
    post: apiClientPost,
  },
}));

describe('real orders economic transfer service', () => {
  beforeEach(() => {
    apiClientGet.mockReset();
    apiClientPost.mockReset();
    apiClientPost.mockResolvedValue({
      ok: true,
      transfer: {
        transferId: 'transfer-1',
        fromVendorId: 'vendor-a',
        toVendorId: 'vendor-b',
        sourceLedgerId: 'fin-vendor-a-sale-1001',
        targetLedgerId: 'fin-vendor-b-sale-1001',
        allocationId: 'alloc-1',
        status: 'COMPLETED',
      },
      order: {
        order: {
          sourceShopifyOrderId: 'shopify-1',
          sourceShopifyOrderNumber: '#1001',
          customerName: 'Customer',
          customerEmail: null,
          totalAmount: '1000.00',
          createdAt: '2026-06-22T08:00:00.000Z',
          updatedAt: '2026-06-22T08:00:00.000Z',
        },
        allocations: [
          {
            id: 'alloc-1',
            vendorId: 'vendor-b',
            vendorName: 'Vendor B',
            originalVendorId: 'vendor-a',
            assignedVendorId: 'vendor-b',
            allocationStatus: 'ACTIVE',
            cancellationReason: null,
            reassignmentRequired: false,
            fulfillmentStatus: 'PENDING',
            shippingStatus: 'AWAITING_SHIPMENT',
            trackingNumber: null,
            carrier: null,
            trackingUrl: null,
            fulfilledAt: null,
            shipmentCreatedAt: null,
            shipmentUpdatedAt: null,
            totalAmount: '1000.00',
            lineItems: [],
            assignmentHistory: [],
            returnRecords: [{ id: 'return-1', status: 'REQUESTED', reason: null, createdAt: '2026-06-22T08:00:00.000Z' }],
            refundRecords: [],
            financeIntegrityAlerts: [],
            cancelRefundReview: null,
            transferSummary: {
              id: 'transfer-1',
              status: 'COMPLETED',
              fromVendorId: 'vendor-a',
              toVendorId: 'vendor-b',
              reason: 'Vendor B accepted captured economics.',
              completedAt: '2026-06-22T08:05:00.000Z',
              adminActorUserId: 'admin-1',
            },
          },
        ],
      },
    });
  });

  it('maps product refund records separately from real order-linked webhook evidence', async () => {
    apiClientGet.mockResolvedValueOnce({
      order: {
        sourceShopifyOrderId: 'shopify-1',
        sourceShopifyOrderNumber: '#1001',
        customerName: 'Customer',
        customerEmail: null,
        financialStatus: 'refunded',
        totalAmount: '1249.00',
        createdAt: '2026-06-22T08:00:00.000Z',
        updatedAt: '2026-06-22T08:10:00.000Z',
        customerRefundCompletion: {
          status: 'VERIFIED_FULL_CUSTOMER_REFUND',
          reasonCode: 'canonical_full_customer_refund_verified',
          displayFinancialStatus: 'REFUNDED',
          currency: 'TRY',
          totalReceivedAmount: '1249.00',
          totalRefundedAmount: '1249.00',
          netPaymentAmount: '0.00',
          totalOutstandingAmount: '0.00',
          totalRefundedShippingAmount: '0.00',
        },
        refundWebhookStatus: 'PROCESSED',
      },
      allocations: [{
        id: 'alloc-1',
        vendorId: 'vendor-a',
        vendorName: 'Vendor A',
        originalVendorId: 'vendor-a',
        assignedVendorId: 'vendor-a',
        allocationStatus: 'VENDOR_BLOCKED',
        cancellationReason: 'OUT_OF_STOCK',
        reassignmentRequired: true,
        fulfillmentStatus: 'PENDING',
        shippingStatus: 'AWAITING_SHIPMENT',
        trackingNumber: null,
        carrier: null,
        trackingUrl: null,
        fulfilledAt: null,
        shipmentCreatedAt: null,
        shipmentUpdatedAt: null,
        totalAmount: '1249.00',
        lineItems: [],
        assignmentHistory: [
          {
            id: 'history-block-1',
            action: 'vendor_blocked',
            fromVendorId: 'vendor-a',
            toVendorId: 'vendor-a',
            reason: 'OUT_OF_STOCK',
            actorUserId: 'vendor-user-1',
            createdAt: '2026-06-22T08:01:00.000Z',
          },
          {
            id: 'history-block-2',
            action: 'vendor_blocked',
            fromVendorId: 'vendor-a',
            toVendorId: 'vendor-a',
            reason: 'OUT_OF_STOCK',
            actorUserId: null,
            createdAt: '2026-06-22T08:02:00.000Z',
          },
        ],
        returnRecords: [],
        refundRecords: [{
          id: 'refund-1',
          sourceShopifyRefundId: 'shopify-refund-1',
          amount: '1249.00',
          status: 'processed',
          createdAt: '2026-06-22T08:05:00.000Z',
          lineItems: [],
        }],
        financeIntegrityAlerts: [],
        transferSummary: null,
        cancelRefundReview: null,
        outboundRefundAttemptSummary: null,
        productPanelVariantDisableEvents: [],
      }],
    });

    const result = await getAdminShopifyOrderBreakdown('gid://shopify/Order/1001');

    expect(apiClientGet).toHaveBeenCalledWith('/admin/orders/gid://shopify/Order/1001', { signal: undefined });
    expect(result.refundWebhookStatus).toBe('PROCESSED');
    expect(result.allocations[0]?.refundTotal).toBe('TRY\u00a01,249.00');
    expect(result.allocations[0]).toMatchObject({
      assignmentBlockedAt: '2026-06-22T08:02:00.000Z',
      assignmentHistory: [
        { actorName: 'Vendor user', actorRole: 'vendor' },
        { actorName: 'Vendor actor unavailable', actorRole: 'vendor' },
      ],
    });
  });

  it('posts admin economic transfer payload without vendor context and maps refreshed order', async () => {
    const result = await transferAdminAllocationEconomics('gid://shopify/Order/1001', 'alloc/1', {
      toVendorId: 'vendor-b',
      reason: 'Vendor B accepted captured economics.',
      confirmTransfer: true,
    });

    expect(apiClientPost).toHaveBeenCalledWith(
      '/admin/orders/gid%3A%2F%2Fshopify%2FOrder%2F1001/allocations/alloc%2F1/economic-transfer',
      {
        toVendorId: 'vendor-b',
        reason: 'Vendor B accepted captured economics.',
        confirmTransfer: true,
      },
      { skipVendorContext: true },
    );
    expect(result.transfer).toMatchObject({
      transferId: 'transfer-1',
      fromVendorId: 'vendor-a',
      toVendorId: 'vendor-b',
      status: 'COMPLETED',
    });
    expect(result.order?.allocations[0]).toMatchObject({
      assignedVendorId: 'vendor-b',
      allocationStatus: 'active',
      reassignmentRequired: false,
      returnRecordCount: 1,
      transferSummary: {
        id: 'transfer-1',
        status: 'COMPLETED',
        fromVendorId: 'vendor-a',
        toVendorId: 'vendor-b',
        reason: 'Vendor B accepted captured economics.',
        completedAt: '2026-06-22T08:05:00.000Z',
        adminActorUserId: 'admin-1',
      },
    });
  });

  it('posts admin cancel/refund review payload without vendor context and maps review state', async () => {
    apiClientPost.mockResolvedValueOnce({
      order: {
        sourceShopifyOrderId: 'shopify-1',
        sourceShopifyOrderNumber: '#1001',
        customerName: 'Customer',
        customerEmail: null,
        totalAmount: '1000.00',
        createdAt: '2026-06-22T08:00:00.000Z',
        updatedAt: '2026-06-22T08:00:00.000Z',
      },
      allocations: [
        {
          id: 'alloc-1',
          vendorId: 'vendor-a',
          vendorName: 'Vendor A',
          originalVendorId: 'vendor-a',
          assignedVendorId: 'vendor-a',
          allocationStatus: 'VENDOR_BLOCKED',
          cancellationReason: 'OUT_OF_STOCK',
          reassignmentRequired: true,
          cancelRefundReview: {
            status: 'PENDING_REVIEW',
            reason: 'OUT_OF_STOCK',
            note: 'Customer will be contacted.',
            requestedAt: '2026-06-22T08:10:00.000Z',
            requestedByUserId: 'admin-1',
          },
          fulfillmentStatus: 'PENDING',
          shippingStatus: 'AWAITING_SHIPMENT',
          trackingNumber: null,
          carrier: null,
          trackingUrl: null,
          fulfilledAt: null,
          shipmentCreatedAt: null,
          shipmentUpdatedAt: null,
          totalAmount: '1000.00',
          lineItems: [],
          assignmentHistory: [],
          returnRecords: [],
          refundRecords: [],
          financeIntegrityAlerts: [],
          transferSummary: null,
        },
      ],
    });

    const result = await requestAdminCancelRefundReview('gid://shopify/Order/1001', 'alloc/1', {
      reason: 'OUT_OF_STOCK',
      note: 'Customer will be contacted.',
      confirmReview: true,
    });

    expect(apiClientPost).toHaveBeenCalledWith(
      '/admin/orders/gid%3A%2F%2Fshopify%2FOrder%2F1001/allocations/alloc%2F1/cancel-refund-review',
      {
        reason: 'OUT_OF_STOCK',
        note: 'Customer will be contacted.',
        confirmReview: true,
      },
      { skipVendorContext: true },
    );
    expect(result.allocations[0]).toMatchObject({
      allocationStatus: 'vendor_blocked',
      reassignmentRequired: true,
      cancelRefundReview: {
        status: 'PENDING_REVIEW',
        reason: 'OUT_OF_STOCK',
        note: 'Customer will be contacted.',
        requestedAt: '2026-06-22T08:10:00.000Z',
        requestedByUserId: 'admin-1',
      },
    });
  });

  it('posts admin Shopify refund preview payload without vendor context', async () => {
    apiClientPost.mockResolvedValueOnce({
      ok: true,
      writesPerformed: false,
      allocationId: 'alloc/1',
      shopifyOrderId: 'gid://shopify/Order/1001',
      refundLineItemsPreview: [
        {
          lineItemId: 'gid://shopify/LineItem/1',
          quantity: 1,
          restockType: 'CANCEL',
        },
      ],
      suggestedRefund: {
        totalRefundAmount: '1000.00',
        currencyCode: 'TRY',
        totalTaxAmount: '100.00',
        shippingAmount: null,
        suggestedTransactions: [
          {
            gateway: 'bogus',
            amount: '1000.00',
            currencyCode: 'TRY',
            parentTransactionId: 'gid://shopify/OrderTransaction/1',
          },
        ],
      },
      warnings: [],
      blockers: [],
      missingData: [],
    });

    const result = await previewAdminShopifyRefund('gid://shopify/Order/1001', 'alloc/1', {
      restockType: 'CANCEL',
      refundShipping: false,
    });

    expect(apiClientPost).toHaveBeenCalledWith(
      '/admin/orders/gid%3A%2F%2Fshopify%2FOrder%2F1001/allocations/alloc%2F1/shopify-refund-preview',
      {
        restockType: 'CANCEL',
        refundShipping: false,
      },
      { skipVendorContext: true },
    );
    expect(result).toMatchObject({
      ok: true,
      writesPerformed: false,
      allocationId: 'alloc/1',
      suggestedRefund: {
        totalRefundAmount: '1000.00',
        currencyCode: 'TRY',
      },
    });
  });

  it('posts admin Shopify refund execution payload without vendor context', async () => {
    apiClientPost.mockResolvedValueOnce({
      ok: true,
      writesPerformed: true,
      status: 'SHOPIFY_ACTION_PENDING',
      shopifyRefundId: 'gid://shopify/Refund/1',
      attemptId: 'attempt-1',
      message: 'Shopify refund submitted. Waiting for refunds/create webhook.',
    });

    const result = await executeAdminShopifyRefund('gid://shopify/Order/1001', 'alloc/1', {
      restockType: 'CANCEL',
      refundShipping: false,
      notifyCustomer: true,
      note: 'Customer approved refund.',
      confirmRefund: true,
    });

    expect(apiClientPost).toHaveBeenCalledWith(
      '/admin/orders/gid%3A%2F%2Fshopify%2FOrder%2F1001/allocations/alloc%2F1/shopify-refund',
      {
        restockType: 'CANCEL',
        refundShipping: false,
        notifyCustomer: true,
        note: 'Customer approved refund.',
        confirmRefund: true,
      },
      { skipVendorContext: true },
    );
    expect(result).toMatchObject({
      ok: true,
      writesPerformed: true,
      status: 'SHOPIFY_ACTION_PENDING',
      attemptId: 'attempt-1',
    });
  });

  it('posts admin Product Panel variant-disable dry-run send without vendor context', async () => {
    apiClientPost.mockResolvedValueOnce({
      ok: true,
      attempted: 1,
      resolved: 1,
      failed: 0,
      skipped: 0,
      latestEventStatuses: [
        {
          id: 'product-panel-event-1',
          status: 'RESOLVED_DRY_RUN',
          shopifyVariantId: 'gid://shopify/ProductVariant/111',
          shopifyLineItemId: 'gid://shopify/LineItem/1',
          variantSku: 'SKU-1088',
          reasonCode: 'OUT_OF_STOCK',
          reasonText: 'Out of stock',
          quantity: 1,
          requestedAt: '2026-06-21T12:46:00.000Z',
          environment: 'test',
          dryRun: true,
          attemptCount: 1,
          error: null,
          resolvedAt: '2026-06-21T12:47:00.000Z',
          failedAt: null,
          response: {
            accepted: true,
            dryRun: true,
            writesPerformed: false,
          },
        },
      ],
    });

    const result = await sendAdminProductPanelVariantDisableDryRun('gid://shopify/Order/1001');

    expect(apiClientPost).toHaveBeenCalledWith(
      '/admin/orders/gid%3A%2F%2Fshopify%2FOrder%2F1001/product-panel-variant-disable/send-dry-run',
      {},
      { skipVendorContext: true },
    );
    expect(result).toMatchObject({
      ok: true,
      attempted: 1,
      resolved: 1,
      failed: 0,
      latestEventStatuses: [
        expect.objectContaining({
          id: 'product-panel-event-1',
          status: 'RESOLVED_DRY_RUN',
        }),
      ],
    });
  });
});
