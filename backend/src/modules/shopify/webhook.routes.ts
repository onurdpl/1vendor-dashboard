import type { FastifyInstance } from 'fastify';
import type { AppEnv } from '../../config/env.js';
import { getShopifyWebhookHeaders } from './webhook.types.js';
import { recordVerifiedWebhook, verifyShopifyWebhookHmac } from './webhook.service.js';

export function registerShopifyWebhookRoutes(app: FastifyInstance, env: AppEnv) {
  app.post('/webhooks/shopify/orders-create', async (request, reply) => {
    const rawBody = request.rawBody ?? '';
    const headers = getShopifyWebhookHeaders(request);
    const isValid = verifyShopifyWebhookHmac(rawBody, headers.hmac, env.SHOPIFY_WEBHOOK_SECRET);

    if (!isValid) {
      return reply.code(401).send({ message: 'Invalid Shopify webhook signature.' });
    }

    if (env.DATABASE_URL) {
      await recordVerifiedWebhook({
        topic: headers.topic,
        shopDomain: headers.shopDomain,
        webhookId: headers.webhookId,
        rawBody,
      });
    }

    return reply.code(202).send({
      accepted: true,
      topic: headers.topic,
      processing: 'deferred',
    });
  });
}
