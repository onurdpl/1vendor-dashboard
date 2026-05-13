import Fastify from 'fastify';
import cors from '@fastify/cors';
import type { OriginFunction } from '@fastify/cors';
import { loadEnv } from './config/env.js';
import { prisma } from './db/prisma.js';
import { registerAuthRoutes } from './modules/auth/auth.routes.js';
import { createAuthService } from './modules/auth/auth.service.js';
import { createAuthMiddleware } from './modules/auth/auth.middleware.js';
import { requireVendorAccess } from './modules/vendor-access/vendor-access.middleware.js';
import { registerOrdersRoutes } from './modules/orders/orders.routes.js';
import { registerReturnsRoutes } from './modules/returns/returns.routes.js';
import { registerFinanceRoutes } from './modules/finance/finance.routes.js';
import { registerOperationsRoutes } from './modules/operations/operations.routes.js';
import { registerAutomationRoutes } from './modules/automation/automation.routes.js';
import { registerAutomationActionRoutes } from './modules/automation/automation-actions.routes.js';
import { registerFulfillmentRoutes } from './modules/fulfillments/fulfillment.routes.js';
import { resolveVendorFromMetafield } from './modules/shopify/vendor-mapping.service.js';
import { registerShopifyWebhookRoutes } from './modules/shopify/webhook.routes.js';
import { registerDiagnosticsRoutes } from './modules/diagnostics/diagnostics.routes.js';
import { registerReconciliationRoutes } from './modules/reconciliation/reconciliation.routes.js';
import { registerScheduledReconciliationScheduler } from './modules/reconciliation/scheduled-reconciliation.service.js';
import { registerObservabilityRoutes } from './modules/observability/observability.routes.js';
import { registerRulesRoutes } from './modules/rules/rules.routes.js';
import { registerNotificationRoutes } from './modules/notifications/notifications.routes.js';

export function createApp() {
  const env = loadEnv();
  const app = Fastify({
    logger: env.NODE_ENV !== 'test',
  });

  void app.register(cors, {
    origin: ((origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }

      callback(null, env.CORS_ORIGIN.includes(origin));
    }) satisfies OriginFunction,
    methods: ['GET', 'POST', 'PUT', 'OPTIONS'],
    allowedHeaders: [
      'Authorization',
      'Content-Type',
      'X-Vendor-Id',
      'X-Shopify-Hmac-Sha256',
      'X-Shopify-Shop-Domain',
      'X-Shopify-Webhook-Id',
      'X-Shopify-Topic',
    ],
  });

  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (request, body, done) => {
    const rawBodyBuffer = Buffer.isBuffer(body) ? body : Buffer.from(body);
    const rawBody = rawBodyBuffer.toString('utf8');
    request.rawBodyBuffer = rawBodyBuffer;
    request.rawBody = rawBody;

    try {
      done(null, rawBody ? JSON.parse(rawBody) : {});
    } catch (error) {
      done(error as Error, undefined);
    }
  });

  app.get('/health', async () => {
    return { ok: true };
  });

  app.get('/version', async () => {
    return {
      service: 'vendor-dashboard-backend',
      version: '0.1.0',
      nodeEnv: env.NODE_ENV,
    };
  });

  app.get('/health/db', async () => {
    if (!env.DATABASE_URL) {
      return {
        ok: false,
        status: 'not_configured',
      };
    }

    try {
      await prisma.$queryRaw`SELECT 1`;
      return {
        ok: true,
        status: 'connected',
      };
    } catch (error) {
      return {
        ok: false,
        status: 'unavailable',
        message: error instanceof Error ? error.message : 'Database check failed.',
      };
    }
  });

  registerAuthRoutes(app, env);
  registerOrdersRoutes(app, env);
  registerReturnsRoutes(app, env);
  registerFinanceRoutes(app, env);
  registerOperationsRoutes(app, env);
  registerAutomationRoutes(app, env);
  registerAutomationActionRoutes(app, env);
  registerFulfillmentRoutes(app, env);
  registerDiagnosticsRoutes(app, env);
  registerObservabilityRoutes(app, env);
  registerRulesRoutes(app, env);
  registerNotificationRoutes(app, env);
  registerReconciliationRoutes(app, env);
  registerShopifyWebhookRoutes(app, env);
  registerScheduledReconciliationScheduler(app, env);

  if (env.NODE_ENV !== 'production') {
    const authService = createAuthService(env);
    const authMiddleware = createAuthMiddleware(authService);

    app.get(
      '/debug/vendor-context',
      {
        preHandler: [authMiddleware.authenticateRequest, requireVendorAccess],
      },
      async (request) => {
        return {
          vendorContext: request.vendorContext,
        };
      },
    );

    app.get('/debug/shopify/vendor-mapping', async (request) => {
      const rawValue = typeof request.query === 'object' && request.query !== null
        ? Reflect.get(request.query, 'value')
        : undefined;
      const value = typeof rawValue === 'string' ? rawValue : null;

      return {
        value,
        vendorId: resolveVendorFromMetafield(value),
      };
    });
  }

  return app;
}
