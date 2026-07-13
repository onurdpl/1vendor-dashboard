import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppEnv } from '../backend/src/config/env.js';

const prismaMock = vi.hoisted(() => ({
  webhookEvent: { update: vi.fn() },
}));

const shopifyAdminMock = vi.hoisted(() => ({
  fetchCanonicalRefundsForOrder: vi.fn(),
}));

const refundIngestionMock = vi.hoisted(() => ({
  ingestVerifiedShopifyRefund: vi.fn(),
}));

vi.mock('../backend/src/db/prisma.js', () => ({ prisma: prismaMock }));
vi.mock('../backend/src/modules/shopify/shopify-admin.service.js', () => ({
  createShopifyAdminService: vi.fn(() => shopifyAdminMock),
}));
vi.mock('../backend/src/modules/shopify/refund-ingestion.service.js', () => refundIngestionMock);

const { __diagnosticsWebhookProcessingTesting } = await import(
  '../backend/src/modules/diagnostics/diagnostics.service.js'
);

const env = { NODE_ENV: 'test' } as AppEnv;
const event = { id: 'webhook-refund-1', topic: 'refunds/create' };
const payload = { id: 5001, order_id: 1105, refund_line_items: [] };

function canonicalRefunds(kind: 'REFUND' | 'VOID', amount: string) {
  return {
    orderGid: 'gid://shopify/Order/1105',
    sourceShopifyOrderId: '1105',
    orderTotalRefundedAmount: amount,
    orderTotalRefundedCurrencyCode: 'TRY',
    refundsListComplete: true,
    source: 'shopify_admin' as const,
    refunds: [{
      refundGid: 'gid://shopify/Refund/5001',
      sourceShopifyRefundId: '5001',
      createdAt: '2026-07-11T18:00:00.000Z',
      updatedAt: '2026-07-11T18:00:01.000Z',
      note: null,
      totalRefundedAmount: amount,
      totalRefundedCurrencyCode: 'TRY',
      transactionPaginationComplete: true,
      lineItemPaginationComplete: true,
      transactions: [{
        transactionGid: 'gid://shopify/OrderTransaction/5001',
        kind,
        status: 'SUCCESS',
        amount,
        currencyCode: 'TRY',
        parentTransactionGid: null,
        createdAt: '2026-07-11T18:00:00.000Z',
        processedAt: '2026-07-11T18:00:01.000Z',
      }],
      refundLineItems: [{
        refundLineItemGid: 'gid://shopify/RefundLineItem/6001',
        sourceRefundLineItemId: '6001',
        lineItemGid: 'gid://shopify/LineItem/7001',
        sourceLineItemId: '7001',
        sku: 'SKU-1',
        title: 'Product',
        name: 'Product',
        variantTitle: null,
        quantity: 1,
        subtotalAmount: kind === 'VOID' ? '4799.00' : amount,
        currencyCode: 'TRY',
      }],
    }],
  };
}

describe('stored refund replay/recovery monetary gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.webhookEvent.update.mockResolvedValue({});
    refundIngestionMock.ingestVerifiedShopifyRefund.mockResolvedValue({
      ok: true,
      action: 'accepted',
      processingStatus: 'processed',
      shopifyOrderId: '1105',
      refundAllocationCount: 1,
    });
  });

  it('allows a canonically verified positive refund through the shared stored-event processor', async () => {
    shopifyAdminMock.fetchCanonicalRefundsForOrder.mockResolvedValueOnce(canonicalRefunds('REFUND', '100.00'));

    const result = await __diagnosticsWebhookProcessingTesting.processWebhookEvent(env, event as never, payload);

    expect(refundIngestionMock.ingestVerifiedShopifyRefund).toHaveBeenCalledWith(expect.objectContaining({
      monetaryEvidence: expect.objectContaining({ classification: 'MONETARY_REFUND' }),
    }));
    expect(result).toMatchObject({ processingStatus: 'processed', refundAllocationCount: 1 });
  });

  it('skips zero-value void evidence for both replay and recovery processing', async () => {
    shopifyAdminMock.fetchCanonicalRefundsForOrder.mockResolvedValueOnce(canonicalRefunds('VOID', '0.00'));

    const result = await __diagnosticsWebhookProcessingTesting.processWebhookEvent(env, event as never, payload);

    expect(refundIngestionMock.ingestVerifiedShopifyRefund).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      processingStatus: 'processed',
      refundAllocationCount: 0,
      refundClassification: 'ZERO_VALUE_VOID',
      reasonCode: 'zero_value_void_not_monetary_refund',
    });
  });

  it('marks the stored event for review when canonical verification fails', async () => {
    shopifyAdminMock.fetchCanonicalRefundsForOrder.mockRejectedValueOnce(new Error('upstream detail'));

    const result = await __diagnosticsWebhookProcessingTesting.processWebhookEvent(env, event as never, payload);

    expect(refundIngestionMock.ingestVerifiedShopifyRefund).not.toHaveBeenCalled();
    expect(prismaMock.webhookEvent.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'FAILED' }),
    }));
    expect(result).toMatchObject({
      action: 'received_needs_attention',
      processingStatus: 'needs_attention',
      message: 'Canonical Shopify refund verification is unavailable.',
    });
  });
});
