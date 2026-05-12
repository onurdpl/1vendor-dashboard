import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
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
import {
  applyReturnLifecycleStatusWebhook,
  ingestReturnRequestWebhook,
} from './return-lifecycle-ingestion.service.js';
import type {
  ReturnLifecycleTopic,
  ReturnLifecycleWebhookPayload,
} from './return-lifecycle-ingestion.types.js';
import { ingestFulfillmentWebhook } from './fulfillment-ingestion.service.js';
import type {
  FulfillmentWebhookPayload,
  FulfillmentWebhookTopic,
} from './fulfillment-ingestion.types.js';
import { prisma } from '../../db/prisma.js';

export function registerShopifyWebhookRoutes(app: FastifyInstance, env: AppEnv) {
  const shopifyAdminService = createShopifyAdminService(env);
  const resolveWebhookSecret = (topic: string) => {
    if (topic.startsWith('returns/')) {
      return env.SHOPIFY_RETURN_WEBHOOK_SECRET || env.SHOPIFY_WEBHOOK_SECRET;
    }

    return env.SHOPIFY_WEBHOOK_SECRET;
  };

  const getRawBodyBuffer = (rawBodyBuffer: Buffer | undefined, rawBody: string | undefined) => {
    if (rawBodyBuffer) {
      return rawBodyBuffer;
    }

    return Buffer.from(rawBody ?? '', 'utf8');
  };

  const logWebhookVerificationFailure = (input: {
    path: string;
    topic: string;
    contentType: string | undefined;
    rawBodyBuffer: Buffer;
    hasHmacHeader: boolean;
  }) => {
    app.log.warn(
      {
        webhookPath: input.path,
        webhookTopic: input.topic,
        contentType: input.contentType ?? null,
        hasRawBody: input.rawBodyBuffer.length > 0,
        rawBodyBytes: input.rawBodyBuffer.length,
        hasHmacHeader: input.hasHmacHeader,
        payloadHash: createHash('sha256').update(input.rawBodyBuffer).digest('hex'),
      },
      'Shopify webhook signature verification failed.',
    );
  };

  const markWebhookProcessing = async (eventId: string) => {
    await prisma.webhookEvent.update({
      where: { id: eventId },
      data: {
        status: 'PROCESSING',
        errorMessage: null,
      },
    });
  };

  const markWebhookFailed = async (eventId: string, message: string) => {
    await prisma.webhookEvent.update({
      where: { id: eventId },
      data: {
        status: 'FAILED',
        errorMessage: message,
      },
    });
  };

  const registerSkeletonReturnLifecycleRoute = (
    path: string,
    topic: ReturnLifecycleTopic,
  ) => {
    app.post(path, async (request, reply) => {
      const rawBodyBuffer = getRawBodyBuffer(request.rawBodyBuffer, request.rawBody);
      const rawBody = rawBodyBuffer.toString('utf8');
      const headers = getShopifyWebhookHeaders(request);
      const isValid = verifyShopifyWebhookHmac(
        rawBodyBuffer,
        headers.hmac,
        resolveWebhookSecret(topic),
      );

      if (!isValid) {
        logWebhookVerificationFailure({
          path,
          topic,
          contentType: request.headers['content-type'] as string | undefined,
          rawBodyBuffer,
          hasHmacHeader: !!headers.hmac,
        });

        return reply.code(401).send({ message: 'Invalid Shopify webhook signature.' });
      }

      if (!env.DATABASE_URL) {
        return reply.code(202).send({
          ok: true,
          duplicate: false,
          action: 'received_pending_implementation',
          topic,
        });
      }

      const idempotencyResult = await getOrCreateWebhookEvent({
        topic,
        shopDomain: headers.shopDomain,
        webhookId: headers.webhookId,
        rawBody,
      });

      if (idempotencyResult.isDuplicate) {
        return reply.code(202).send({
          ok: true,
          duplicate: true,
          action: 'duplicate_ignored',
          topic,
        });
      }

      const payload = (request.body ?? {}) as ReturnLifecycleWebhookPayload;
      let ingestionResult;
      try {
        await markWebhookProcessing(idempotencyResult.event.id);
        ingestionResult =
          topic === 'returns/request'
            ? await ingestReturnRequestWebhook(env, {
                event: idempotencyResult.event,
                payload,
              })
            : await applyReturnLifecycleStatusWebhook(topic, {
                event: idempotencyResult.event,
                payload,
              });
      } catch (error) {
        const message = error instanceof Error ? error.message : `Shopify ${topic} lifecycle ingestion failed.`;
        await markWebhookFailed(idempotencyResult.event.id, message);
        return reply.code(202).send({
          ok: true,
          duplicate: false,
          topic,
          action: 'received_needs_attention',
          processingStatus: 'needs_attention',
          message,
        });
      }

      if (!ingestionResult.ok) {
        return reply.code(202).send({
          ok: true,
          duplicate: false,
          topic,
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
        shopifyReturnGid: ingestionResult.shopifyReturnGid,
        affectedRecordCount: ingestionResult.affectedRecordCount,
        topic,
      });
    });
  };

  const registerFulfillmentLifecycleRoute = (
    path: string,
    topic: FulfillmentWebhookTopic,
  ) => {
    app.post(path, async (request, reply) => {
      const rawBodyBuffer = getRawBodyBuffer(request.rawBodyBuffer, request.rawBody);
      const rawBody = rawBodyBuffer.toString('utf8');
      const headers = getShopifyWebhookHeaders(request);
      const isValid = verifyShopifyWebhookHmac(
        rawBodyBuffer,
        headers.hmac,
        resolveWebhookSecret(topic),
      );

      if (!isValid) {
        logWebhookVerificationFailure({
          path,
          topic,
          contentType: request.headers['content-type'] as string | undefined,
          rawBodyBuffer,
          hasHmacHeader: !!headers.hmac,
        });

        return reply.code(401).send({ message: 'Invalid Shopify webhook signature.' });
      }

      if (!env.DATABASE_URL) {
        return reply.code(202).send({
          ok: true,
          duplicate: false,
          action: 'accepted',
          processingStatus: 'deferred',
          topic,
        });
      }

      const idempotencyResult = await getOrCreateWebhookEvent({
        topic,
        shopDomain: headers.shopDomain,
        webhookId: headers.webhookId,
        rawBody,
      });

      if (idempotencyResult.isDuplicate) {
        return reply.code(202).send({
          ok: true,
          duplicate: true,
          action: 'duplicate_ignored',
          topic,
        });
      }

      let ingestionResult;
      try {
        await markWebhookProcessing(idempotencyResult.event.id);
        ingestionResult = await ingestFulfillmentWebhook(env, {
          event: idempotencyResult.event,
          payload: (request.body ?? {}) as FulfillmentWebhookPayload,
          topic,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : `Shopify ${topic} fulfillment sync failed.`;
        await markWebhookFailed(idempotencyResult.event.id, message);
        return reply.code(202).send({
          ok: true,
          duplicate: false,
          topic,
          action: 'received_needs_attention',
          processingStatus: 'needs_attention',
          message,
        });
      }

      if (!ingestionResult.ok) {
        return reply.code(202).send({
          ok: true,
          duplicate: false,
          topic,
          action: ingestionResult.action,
          processingStatus: ingestionResult.processingStatus,
          message: ingestionResult.error,
        });
      }

      return reply.code(202).send({
        ok: true,
        duplicate: false,
        topic,
        action: ingestionResult.action,
        processingStatus: ingestionResult.processingStatus,
        shopifyOrderId: ingestionResult.shopifyOrderId,
        affectedAllocationCount: ingestionResult.affectedAllocationCount,
      });
    });
  };

  app.post('/webhooks/shopify/orders-create', async (request, reply) => {
    const rawBodyBuffer = getRawBodyBuffer(request.rawBodyBuffer, request.rawBody);
    const rawBody = rawBodyBuffer.toString('utf8');
    const headers = getShopifyWebhookHeaders(request);
    const isValid = verifyShopifyWebhookHmac(
      rawBodyBuffer,
      headers.hmac,
      resolveWebhookSecret(headers.topic),
    );

    if (!isValid) {
      logWebhookVerificationFailure({
        path: '/webhooks/shopify/orders-create',
        topic: headers.topic,
        contentType: request.headers['content-type'] as string | undefined,
        rawBodyBuffer,
        hasHmacHeader: !!headers.hmac,
      });

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

    let ingestionResult;
    try {
      await markWebhookProcessing(idempotencyResult.event.id);
      const sourceShopifyOrderId =
        payload.id !== undefined && payload.id !== null ? String(payload.id) : null;

      if (!sourceShopifyOrderId) {
        await markWebhookFailed(idempotencyResult.event.id, 'Shopify orders/create payload did not include an order id.');
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
        await markWebhookFailed(idempotencyResult.event.id, sellerInfoResult.error);
        return reply.code(202).send({
          ok: true,
          duplicate: false,
          action: 'received_needs_attention',
          processingStatus: 'needs_attention',
          message: sellerInfoResult.error,
        });
      }

      ingestionResult = await ingestShopifyOrderWebhook({
        event: idempotencyResult.event,
        payload,
        sellerInfo: sellerInfoResult.sellerInfo,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Shopify orders/create ingestion failed.';
      await markWebhookFailed(idempotencyResult.event.id, message);
      return reply.code(202).send({
        ok: true,
        duplicate: false,
        action: 'received_needs_attention',
        processingStatus: 'needs_attention',
        message,
      });
    }

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
    const rawBodyBuffer = getRawBodyBuffer(request.rawBodyBuffer, request.rawBody);
    const rawBody = rawBodyBuffer.toString('utf8');
    const headers = getShopifyWebhookHeaders(request);
    const isValid = verifyShopifyWebhookHmac(
      rawBodyBuffer,
      headers.hmac,
      resolveWebhookSecret(headers.topic),
    );

    if (!isValid) {
      logWebhookVerificationFailure({
        path: '/webhooks/shopify/refunds-create',
        topic: headers.topic,
        contentType: request.headers['content-type'] as string | undefined,
        rawBodyBuffer,
        hasHmacHeader: !!headers.hmac,
      });

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

    let ingestionResult;
    try {
      await markWebhookProcessing(idempotencyResult.event.id);
      ingestionResult = await ingestShopifyRefundWebhook({
        event: idempotencyResult.event,
        payload,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Shopify refunds/create ingestion failed.';
      await markWebhookFailed(idempotencyResult.event.id, message);
      return reply.code(202).send({
        ok: true,
        duplicate: false,
        action: 'received_needs_attention',
        processingStatus: 'needs_attention',
        message,
      });
    }

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

  registerSkeletonReturnLifecycleRoute('/webhooks/shopify/returns-request', 'returns/request');
  registerSkeletonReturnLifecycleRoute('/webhooks/shopify/returns-approve', 'returns/approve');
  registerSkeletonReturnLifecycleRoute('/webhooks/shopify/returns-decline', 'returns/decline');
  registerSkeletonReturnLifecycleRoute('/webhooks/shopify/returns-close', 'returns/close');
  registerSkeletonReturnLifecycleRoute('/webhooks/shopify/returns-cancel', 'returns/cancel');
  registerFulfillmentLifecycleRoute('/webhooks/shopify/fulfillments-create', 'fulfillments/create');
  registerFulfillmentLifecycleRoute('/webhooks/shopify/fulfillments-update', 'fulfillments/update');
  registerFulfillmentLifecycleRoute('/webhooks/shopify/fulfillment-events-create', 'fulfillment_events/create');
}
