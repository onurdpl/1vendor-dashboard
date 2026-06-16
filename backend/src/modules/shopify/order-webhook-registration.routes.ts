import type { FastifyInstance } from 'fastify';
import type { AppEnv } from '../../config/env.js';
import { createAuthMiddleware } from '../auth/auth.middleware.js';
import { createAuthService } from '../auth/auth.service.js';
import { registerShopifyOrderWebhooksFromAdmin } from './order-webhook-registration.service.js';

export function registerShopifyOrderWebhookRegistrationRoutes(app: FastifyInstance, env: AppEnv) {
  const authService = createAuthService(env);
  const authMiddleware = createAuthMiddleware(authService);

  app.post(
    '/admin/shopify/order-webhooks/register',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Forbidden' });
      }

      const result = await registerShopifyOrderWebhooksFromAdmin(env);
      if (!result.ok) {
        return reply.code(502).send(result);
      }

      return result;
    },
  );
}
