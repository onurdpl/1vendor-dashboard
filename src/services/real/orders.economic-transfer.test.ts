import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  executeAdminShopifyRefund,
  previewAdminShopifyRefund,
  requestAdminCancelRefundReview,
  transferAdminAllocationEconomics,
} from './orders';

const apiClientPost = vi.hoisted(() => vi.fn());

vi.mock('../../lib/api-client', () => ({
  apiClient: {
    post: apiClientPost,
  },
}));

describe('real orders economic transfer service', () => {
  beforeEach(() => {
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
});
