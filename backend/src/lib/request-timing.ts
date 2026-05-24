import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

const TIMED_ROUTE_NAMES = new Set([
  'GET /orders',
  'GET /orders/:orderId',
  'GET /returns',
  'GET /returns/:returnId',
  'GET /finance',
  'GET /automation',
  'GET /signals',
  'GET /notifications',
  'GET /admin/operations',
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

export function createSafeRequestTimingLog(input: {
  routeName: string;
  method: string;
  statusCode: number;
  elapsedMs: number;
  responseBytes?: number | null;
}): SafeRequestTimingLog {
  return {
    routeName: input.routeName,
    method: input.method.toUpperCase(),
    statusCode: input.statusCode,
    elapsedMs: Math.max(0, Math.round(input.elapsedMs)),
    responseBytes: typeof input.responseBytes === 'number' ? input.responseBytes : null,
  };
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
    });

    app.log.info(log, 'request timing');
  });
}
