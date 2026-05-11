import type { FastifyInstance } from 'fastify';
import type { AppEnv } from '../../config/env.js';
import { getShopifyWebhookHeaders } from './webhook.types.js';
import { getOrCreateWebhookEvent } from './webhook-idempotency.service.js';
import { ingestShopifyOrderWebhook } from './order-ingestion.service.js';
import { ingestShopifyRefundWebhook } from './refund-ingestion.service.js';
import { fetchSellerInfoWithRetry } from './seller-info-retry.service.js';
import { createShopifyAdminService } from './shopify-admin.service.js';
import { verifyShopifyWebhookHmac } from './webhook.service.js';
import type { ShopifyOrdersCreateWebhookPayload } from './order-ingestion.types.js';
import type { ShopifyRefundsCreateWebhookPayload } from './refund-ingestion.types.js';
import { prisma } from '../../db/prisma.js';

export function registerShopifyWebhookRoutes(app: FastifyInstance, env: AppEnv) {
  const shopifyAdminService = createShopifyAdminService(env);

  app.post('/webhooks/shopify/orders-create', async (request, reply) => {
    const rawBody = request.rawBody ?? '';
    const headers = getShopifyWebhookHeaders(request);
    const isValid = verifyShopifyWebhookHmac(rawBody, headers.hmac, env.SHOPIFY_WEBHOOK_SECRET);

    if (!isValid) {
      return reply.code(401).send({ message: 'Invalid Shopify webhook signature.' });
    }

    const payload = (request.body ?? {}) as ShopifyOrdersCreateWebhookPayload;

    if (!env.DATABASE_URL) {
      return reply.code(202).send({
        ok: true,
        duplicate: false,
        action: 'accepted',
        processingStatus: 'deferred',
      });
    }

    const idempotencyResult = await getOrCreateWebhookEvent({
      topic: headers.topic,
      shopDomain: headers.shopDomain,
      webhookId: headers.webhookId,
      rawBody,
    });

    if (idempotencyResult.isDuplicate) {
      return reply.code(202).send({
        ok: true,
        duplicate: true,
        action: 'duplicate_ignored',
      });
    }

    const sourceShopifyOrderId =
      payload.id !== undefined && payload.id !== null ? String(payload.id) : null;

    if (!sourceShopifyOrderId) {
      await prisma.webhookEvent.update({
        where: { id: idempotencyResult.event.id },
        data: {
          status: 'FAILED',
          errorMessage: 'Shopify orders/create payload did not include an order id.',
        },
      });

      return reply.code(202).send({
        ok: true,
        duplicate: false,
        action: 'received_needs_attention',
        processingStatus: 'needs_attention',
        message: 'Shopify orders/create payload did not include an order id.',
      });
    }

    const sellerInfoResult = await fetchSellerInfoWithRetry({
      orderId: sourceShopifyOrderId,
      fetchSellerInfo: shopifyAdminService.fetchOrderSellerInfo,
      delayMs: env.SHOPIFY_SELLER_INFO_RETRY_DELAY_MS,
    });

    if (!sellerInfoResult.ok) {
      await prisma.webhookEvent.update({
        where: { id: idempotencyResult.event.id },
        data: {
          status: 'FAILED',
          errorMessage: sellerInfoResult.error,
        },
      });

      return reply.code(202).send({
        ok: true,
        duplicate: false,
        action: 'received_needs_attention',
        processingStatus: 'needs_attention',
        message: sellerInfoResult.error,
      });
    }

    const ingestionResult = await ingestShopifyOrderWebhook({
      event: idempotencyResult.event,
      payload,
      sellerInfo: sellerInfoResult.sellerInfo,
    });

    if (!ingestionResult.ok) {
      return reply.code(202).send({
        ok: true,
        duplicate: false,
        action: ingestionResult.action,
        processingStatus: ingestionResult.processingStatus,
        message: ingestionResult.error,
      });
    }

    return reply.code(202).send({
      ok: true,
      duplicate: false,
      action: ingestionResult.action,
      processingStatus: ingestionResult.processingStatus,
      shopifyOrderId: ingestionResult.shopifyOrderId,
      allocationCount: ingestionResult.allocationCount,
    });
  });

  app.post('/webhooks/shopify/refunds-create', async (request, reply) => {
    const rawBody = request.rawBody ?? '';
    const headers = getShopifyWebhookHeaders(request);
    const isValid = verifyShopifyWebhookHmac(rawBody, headers.hmac, env.SHOPIFY_WEBHOOK_SECRET);

    if (!isValid) {
      return reply.code(401).send({ message: 'Invalid Shopify webhook signature.' });
    }

    const payload = (request.body ?? {}) as ShopifyRefundsCreateWebhookPayload;

    if (!env.DATABASE_URL) {
      return reply.code(202).send({
        ok: true,
        duplicate: false,
        action: 'accepted',
        processingStatus: 'deferred',
      });
    }

    const idempotencyResult = await getOrCreateWebhookEvent({
      topic: headers.topic,
      shopDomain: headers.shopDomain,
      webhookId: headers.webhookId,
      rawBody,
    });

    if (idempotencyResult.isDuplicate) {
      return reply.code(202).send({
        ok: true,
        duplicate: true,
        action: 'duplicate_ignored',
      });
    }

    const ingestionResult = await ingestShopifyRefundWebhook({
      event: idempotencyResult.event,
      payload,
    });

    if (!ingestionResult.ok) {
      return reply.code(202).send({
        ok: true,
        duplicate: false,
        action: ingestionResult.action,
        processingStatus: ingestionResult.processingStatus,
        message: ingestionResult.error,
      });
    }

    return reply.code(202).send({
      ok: true,
      duplicate: false,
      action: ingestionResult.action,
      processingStatus: ingestionResult.processingStatus,
      shopifyOrderId: ingestionResult.shopifyOrderId,
      refundAllocationCount: ingestionResult.refundAllocationCount,
    });
  });
}
