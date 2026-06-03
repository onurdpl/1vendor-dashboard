import Fastify from 'fastify';
import cors from '@fastify/cors';
import type { OriginFunction } from '@fastify/cors';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
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
import { registerInvoiceExecutionRoutes } from './modules/invoices/invoice-execution.routes.js';
import { registerShippingExecutionRoutes } from './modules/shipping/shipping-execution.routes.js';
import { registerSupportRoutes } from './modules/support/support.routes.js';
import { registerVendorIntegrationRoutes } from './modules/vendor-integration/vendor-integration.routes.js';
import { registerParasutProbeRoutes } from './modules/parasut/parasut-probe.routes.js';
import { registerOdooDiscoveryProbeRoutes } from './integrations/odoo/odooDiscovery.routes.js';
import { registerRequestTimingHooks } from './lib/request-timing.js';

declare module 'fastify' {
  interface FastifyRequest {
    requestId?: string;
  }
}

function normalizeRequestId(value: unknown) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const sanitized = trimmed.slice(0, 128).replace(/[^a-zA-Z0-9._:-]/g, '');
  return sanitized || null;
}

function getBackendBuildInfo(env: ReturnType<typeof loadEnv>) {
  const rawCommit =
    process.env.RENDER_GIT_COMMIT ||
    process.env.GIT_COMMIT ||
    process.env.COMMIT_SHA ||
    process.env.SOURCE_VERSION ||
    null;
  const gitCommit = rawCommit?.trim() ? rawCommit.trim().slice(0, 12) : null;

  return {
    service: 'vendor-dashboard-backend',
    version: process.env.npm_package_version || '0.1.0',
    gitCommit,
    environment: env.NODE_ENV,
    timestamp: new Date().toISOString(),
  };
}

const REQUIRED_SCHEMA_COLUMNS = [
  {
    tableName: 'ShopifyOrder',
    columnName: 'customerPhone',
    migration: '20260518120000_add_shopify_order_shipping_address',
  },
  {
    tableName: 'ReturnRecord',
    columnName: 'returnProvider',
    migration: '20260522130000_add_return_provider_evidence',
  },
  {
    tableName: 'ReturnRecord',
    columnName: 'returnProviderShipmentId',
    migration: '20260522130000_add_return_provider_evidence',
  },
  {
    tableName: 'ReturnRecord',
    columnName: 'returnLabel',
    migration: '20260522130000_add_return_provider_evidence',
  },
  {
    tableName: 'ReturnRecord',
    columnName: 'returnReferenceId',
    migration: '20260522130000_add_return_provider_evidence',
  },
  {
    tableName: 'ReturnRecord',
    columnName: 'navlungoReturnCreatedAt',
    migration: '20260522130000_add_return_provider_evidence',
  },
  {
    tableName: 'ReturnRecord',
    columnName: 'returnProviderSnapshot',
    migration: '20260522130000_add_return_provider_evidence',
  },
] as const;

const processStartedAt = Date.now();

async function getSchemaReadiness() {
  const tableNames = Array.from(new Set(REQUIRED_SCHEMA_COLUMNS.map((column) => column.tableName)));
  const columnNames = Array.from(new Set(REQUIRED_SCHEMA_COLUMNS.map((column) => column.columnName)));

  try {
    const rows = await prisma.$queryRaw<Array<{ table_name: string; column_name: string }>>(Prisma.sql`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name IN (${Prisma.join(tableNames)})
        AND column_name IN (${Prisma.join(columnNames)})
    `);
    const present = new Set(rows.map((row) => `${row.table_name}.${row.column_name}`));
    const missingColumns = REQUIRED_SCHEMA_COLUMNS.filter(
      (column) => !present.has(`${column.tableName}.${column.columnName}`),
    ).map((column) => ({
      tableName: column.tableName,
      columnName: column.columnName,
      expectedMigration: column.migration,
    }));

    return {
      schemaReady: missingColumns.length === 0,
      requiredColumnCount: REQUIRED_SCHEMA_COLUMNS.length,
      missingColumns,
    };
  } catch {
    return {
      schemaReady: false,
      requiredColumnCount: REQUIRED_SCHEMA_COLUMNS.length,
      missingColumns: REQUIRED_SCHEMA_COLUMNS.map((column) => ({
        tableName: column.tableName,
        columnName: column.columnName,
        expectedMigration: column.migration,
      })),
      message: 'Schema readiness check failed.',
    };
  }
}

async function getDatabaseHealth(env: ReturnType<typeof loadEnv>) {
  if (!env.DATABASE_URL) {
    return {
      dbReachable: false,
      migrationsReachable: false,
      schemaReady: false,
      dbPingMs: null,
      requiredColumnCount: REQUIRED_SCHEMA_COLUMNS.length,
      missingColumns: [],
    };
  }

  const dbPingStartedAt = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    return {
      dbReachable: false,
      migrationsReachable: false,
      schemaReady: false,
      dbPingMs: Date.now() - dbPingStartedAt,
      requiredColumnCount: REQUIRED_SCHEMA_COLUMNS.length,
      missingColumns: [],
    };
  }
  const dbPingMs = Date.now() - dbPingStartedAt;

  const schema = await getSchemaReadiness();

  try {
    await prisma.$queryRaw`SELECT COUNT(*) FROM "_prisma_migrations"`;
    return {
      dbReachable: true,
      migrationsReachable: true,
      dbPingMs,
      ...schema,
    };
  } catch {
    return {
      dbReachable: true,
      migrationsReachable: false,
      dbPingMs,
      ...schema,
    };
  }
}

function getRuntimeTimingSnapshot() {
  const coldStartAgeSeconds = Math.max(0, Math.round((Date.now() - processStartedAt) / 1000));
  return {
    uptimeSeconds: Math.max(0, Math.round(process.uptime())),
    coldStartAgeSeconds,
  };
}

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
    credentials: true,
    allowedHeaders: [
      'Authorization',
      'Content-Type',
      'X-CSRF-Token',
      'X-Request-Id',
      'X-Auth-Attempt-Id',
      'X-Vendor-Id',
      'X-Shopify-Hmac-Sha256',
      'X-Shopify-Shop-Domain',
      'X-Shopify-Webhook-Id',
      'X-Shopify-Topic',
      'X-Admin-Probe-Token',
    ],
    exposedHeaders: ['X-Request-Id', 'X-Auth-Attempt-Id'],
  });

  app.addHook('onRequest', async (request, reply) => {
    const requestId = normalizeRequestId(request.headers['x-request-id']) ?? randomUUID();
    request.requestId = requestId;
    reply.header('X-Request-Id', requestId);
  });

  app.addHook('onSend', async (request, reply, payload) => {
    if (request.requestId) {
      reply.header('X-Request-Id', request.requestId);
    }

    if (reply.statusCode < 400 || !request.requestId || typeof payload !== 'string') {
      return payload;
    }

    const contentType = String(reply.getHeader('content-type') ?? '');
    if (!contentType.includes('application/json')) {
      return payload;
    }

    try {
      const parsed = JSON.parse(payload) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || 'requestId' in parsed) {
        return payload;
      }

      return JSON.stringify({
        ...parsed,
        requestId: request.requestId,
      });
    } catch {
      return payload;
    }
  });

  registerRequestTimingHooks(app);

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
    const database = await getDatabaseHealth(env);
    const status = database.dbReachable && database.schemaReady ? 'ok' : 'degraded';

    return {
      ok: true,
      status,
      ...getBackendBuildInfo(env),
      ...getRuntimeTimingSnapshot(),
      dbReachable: database.dbReachable,
      dbPingMs: database.dbPingMs,
      migrationsReachable: database.migrationsReachable,
      schemaReady: database.schemaReady,
      requiredColumnCount: database.requiredColumnCount,
      missingColumns: database.missingColumns,
      schemaReadinessMessage: 'message' in database ? database.message : undefined,
    };
  });

  app.get('/version', async () => {
    return {
      ...getBackendBuildInfo(env),
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
      const dbPingStartedAt = Date.now();
      await prisma.$queryRaw`SELECT 1`;
      return {
        ok: true,
        status: 'connected',
        dbPingMs: Date.now() - dbPingStartedAt,
      };
    } catch (error) {
      return {
        ok: false,
        status: 'unavailable',
        message: 'Database check failed.',
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
  registerInvoiceExecutionRoutes(app, env);
  registerShippingExecutionRoutes(app, env);
  registerSupportRoutes(app, env);
  registerVendorIntegrationRoutes(app, env);
  registerParasutProbeRoutes(app, env);
  registerReconciliationRoutes(app, env);
  registerOdooDiscoveryProbeRoutes(app);
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
