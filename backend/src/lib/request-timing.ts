import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

const TIMED_ROUTE_NAMES = new Set([
  'POST /auth/login',
  'GET /auth/diagnostics/public-login-readiness',
  'GET /orders',
  'GET /orders/:orderId',
  'GET /returns',
  'GET /returns/dashboard',
  'GET /returns/:returnId',
  'GET /finance',
  'GET /finance/summary',
  'GET /finance/profile',
  'GET /finance/return-records',
  'GET /automation',
  'GET /signals',
  'GET /signals/dashboard',
  'GET /notifications',
  'GET /notifications/dashboard',
  'GET /admin/operations',
  'GET /admin/operations/summary',
  'GET /admin/operations/attention',
  'GET /admin/diagnostics/reconciliation',
  'GET /admin/observability/summary',
  'GET /admin/observability/metrics',
]);

const requestStartedAt = new WeakMap<FastifyRequest, bigint>();
const responseSizes = new WeakMap<FastifyRequest, number>();

export type SafeRequestTimingLog = {
  routeName: string;
  method: string;
  statusCode: number;
  elapsedMs: number;
  responseBytes: number | null;
  authAttemptId?: string;
};

export function getSafeRouteName(request: Pick<FastifyRequest, 'method' | 'routeOptions'>) {
  const method = request.method.toUpperCase();
  const routePath = typeof request.routeOptions?.url === 'string' ? request.routeOptions.url : 'unknown';
  return `${method} ${routePath}`;
}

export function shouldLogRequestTiming(routeName: string) {
  return TIMED_ROUTE_NAMES.has(routeName);
}

export function getPayloadSize(payload: unknown) {
  if (typeof payload === 'string') {
    return Buffer.byteLength(payload);
  }
  if (Buffer.isBuffer(payload)) {
    return payload.length;
  }
  return null;
}

export function normalizeAuthAttemptId(value: unknown) {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (typeof candidate !== 'string') {
    return null;
  }

  const trimmed = candidate.trim();
  return /^[A-Za-z0-9_-]{4,64}$/.test(trimmed) ? trimmed : null;
}

export function createSafeRequestTimingLog(input: {
  routeName: string;
  method: string;
  statusCode: number;
  elapsedMs: number;
  responseBytes?: number | null;
  authAttemptId?: unknown;
}): SafeRequestTimingLog {
  const log: SafeRequestTimingLog = {
    routeName: input.routeName,
    method: input.method.toUpperCase(),
    statusCode: input.statusCode,
    elapsedMs: Math.max(0, Math.round(input.elapsedMs)),
    responseBytes: typeof input.responseBytes === 'number' ? input.responseBytes : null,
  };

  const authAttemptId = normalizeAuthAttemptId(input.authAttemptId);
  if (authAttemptId) {
    log.authAttemptId = authAttemptId;
  }

  return log;
}

export function registerRequestTimingHooks(app: FastifyInstance) {
  app.addHook('onRequest', async (request) => {
    requestStartedAt.set(request, process.hrtime.bigint());
  });

  app.addHook('onSend', async (request, _reply, payload) => {
    const size = getPayloadSize(payload);
    if (size !== null) {
      responseSizes.set(request, size);
    }
    return payload;
  });

  app.addHook('onResponse', async (request, reply: FastifyReply) => {
    const routeName = getSafeRouteName(request);
    if (!shouldLogRequestTiming(routeName)) {
      return;
    }

    const startedAt = requestStartedAt.get(request);
    const elapsedMs = startedAt ? Number(process.hrtime.bigint() - startedAt) / 1_000_000 : 0;
    const log = createSafeRequestTimingLog({
      routeName,
      method: request.method,
      statusCode: reply.statusCode,
      elapsedMs,
      responseBytes: responseSizes.get(request) ?? null,
      authAttemptId: request.headers['x-auth-attempt-id'],
    });

    app.log.info(log, 'request timing');
  });
}
