import Fastify from 'fastify';
import { loadEnv } from './config/env.js';
import { prisma } from './db/prisma.js';
import { registerAuthRoutes } from './modules/auth/auth.routes.js';
import { createAuthService } from './modules/auth/auth.service.js';
import { createAuthMiddleware } from './modules/auth/auth.middleware.js';
import { requireVendorAccess } from './modules/vendor-access/vendor-access.middleware.js';
import { registerOrdersRoutes } from './modules/orders/orders.routes.js';

export function createApp() {
  const env = loadEnv();
  const app = Fastify({
    logger: env.NODE_ENV !== 'test',
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
  }

  return app;
}
