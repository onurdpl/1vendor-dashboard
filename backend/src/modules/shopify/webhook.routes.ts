import type { FastifyInstance } from 'fastify';
import type { AppEnv } from '../../config/env.js';
import { getShopifyWebhookHeaders } from './webhook.types.js';
import { getOrCreateWebhookEvent } from './webhook-idempotency.service.js';
import { verifyShopifyWebhookHmac } from './webhook.service.js';

export function registerShopifyWebhookRoutes(app: FastifyInstance, env: AppEnv) {
  app.post('/webhooks/shopify/orders-create', async (request, reply) => {
    const rawBody = request.rawBody ?? '';
    const headers = getShopifyWebhookHeaders(request);
    const isValid = verifyShopifyWebhookHmac(rawBody, headers.hmac, env.SHOPIFY_WEBHOOK_SECRET);

    if (!isValid) {
      return reply.code(401).send({ message: 'Invalid Shopify webhook signature.' });
    }

    let duplicate = false;
    let action: 'accepted' | 'duplicate_ignored' = 'accepted';

    if (env.DATABASE_URL) {
      const result = await getOrCreateWebhookEvent({
        topic: headers.topic,
        shopDomain: headers.shopDomain,
        webhookId: headers.webhookId,
        rawBody,
      });

      duplicate = result.isDuplicate;
      action = result.action;
    }

    return reply.code(202).send({
      ok: true,
      duplicate,
      action,
    });
  });
}
