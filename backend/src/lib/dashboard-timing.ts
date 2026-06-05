import { AsyncLocalStorage } from 'node:async_hooks';
import type { FastifyBaseLogger, FastifyInstance, FastifyRequest } from 'fastify';

export const DASHBOARD_INITIAL_LOAD_HEADER = 'x-dashboard-initial-load';
export const DASHBOARD_DEFERRED_LOAD_HEADER = 'x-dashboard-deferred-load';

const SLOW_OPERATION_THRESHOLD_MS = 300;
const SLOW_TOTAL_THRESHOLD_MS = 1000;

type DashboardLoadPhase = 'initial' | 'deferred';

type DashboardTimingContext = {
  requestId: string;
  loadPhase: DashboardLoadPhase | null;
  logger: FastifyBaseLogger;
};

type DashboardTimingOptions = {
  thresholdMs?: number;
  warnEvent?: string;
};

const timingContext = new AsyncLocalStorage<DashboardTimingContext>();
let fetchInstrumentationInstalled = false;

function readHeaderValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

function roundDuration(durationMs: number) {
  return Math.max(0, Math.round(durationMs));
}

function getElapsedMs(startedAt: bigint) {
  return Number(process.hrtime.bigint() - startedAt) / 1_000_000;
}

function getActiveContext() {
  const context = timingContext.getStore();
  return context?.loadPhase ? context : null;
}

function logInfo(context: DashboardTimingContext, payload: Record<string, unknown>, message = 'admin dashboard timing') {
  context.logger.info(payload, message);
}

function logWarn(context: DashboardTimingContext, payload: Record<string, unknown>, message = 'slow admin dashboard operation') {
  context.logger.warn(payload, message);
}

function isHeaderTrue(value: string | string[] | undefined) {
  return readHeaderValue(value).trim().toLowerCase() === 'true';
}

function getDashboardLoadPhase(request: FastifyRequest): DashboardLoadPhase | null {
  if (isHeaderTrue(request.headers[DASHBOARD_INITIAL_LOAD_HEADER])) {
    return 'initial';
  }

  if (isHeaderTrue(request.headers[DASHBOARD_DEFERRED_LOAD_HEADER])) {
    return 'deferred';
  }

  return null;
}

function classifyExternalProvider(url: URL) {
  const host = url.hostname.toLowerCase();
  const path = url.pathname.toLowerCase();

  if (host.includes('myshopify.com') || path.includes('/admin/api/')) return 'shopify';
  if (host.includes('paratika')) return 'paratika';
  if (host.includes('parasut')) return 'parasut';
  if (host.includes('navlungo')) return 'navlungo';
  if (host.includes('kargonomi') || host.includes('kargoentegrator') || host.includes('kargo-entegrator')) return 'kargonomi';
  if (host.includes('lidio')) return 'lidio';
  if (host.includes('paytr')) return 'paytr';
  if (host.includes('iyzico')) return 'iyzico';

  return 'external';
}

function resolveFetchUrl(input: Parameters<typeof fetch>[0]) {
  try {
    if (typeof input === 'string' || input instanceof URL) {
      return new URL(input);
    }

    return new URL(input.url);
  } catch {
    return null;
  }
}

function shouldReportExternalCall(url: URL) {
  const host = url.hostname.toLowerCase();
  return host !== 'localhost' && host !== '127.0.0.1' && host !== '::1';
}

function installFetchExternalCallInstrumentation() {
  if (fetchInstrumentationInstalled || typeof globalThis.fetch !== 'function') {
    return;
  }

  const originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const context = getActiveContext();
    const url = context?.loadPhase === 'initial' ? resolveFetchUrl(input) : null;

    if (!context || !url || !shouldReportExternalCall(url)) {
      return originalFetch(input, init);
    }

    const startedAt = process.hrtime.bigint();
    let failed = false;
    try {
      return await originalFetch(input, init);
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      const durationMs = roundDuration(getElapsedMs(startedAt));
      const provider = classifyExternalProvider(url);
      const payload = {
        event: 'DASHBOARD_EXTERNAL_CALL_DURING_INITIAL_LOAD',
        requestId: context.requestId,
        step: `external.${provider}`,
        loadPhase: context.loadPhase,
        provider,
        host: url.hostname,
        durationMs,
        failed,
      };
      logWarn(context, payload, 'external dependency called during admin dashboard initial load');
    }
  }) as typeof fetch;

  fetchInstrumentationInstalled = true;
}

export function registerDashboardTimingHooks(app: FastifyInstance) {
  installFetchExternalCallInstrumentation();

  app.addHook('onRequest', async (request) => {
    timingContext.enterWith({
      requestId: request.requestId ?? 'unknown',
      loadPhase: getDashboardLoadPhase(request),
      logger: request.log,
    });
  });
}

export function logDashboardRouteStart(step: string) {
  const context = getActiveContext();
  if (!context) {
    return;
  }

  logInfo(context, {
    event: 'ADMIN_DASHBOARD_TIMING',
    requestId: context.requestId,
    step,
    loadPhase: context.loadPhase,
    durationMs: 0,
  });
}

export async function withDashboardTiming<T>(
  step: string,
  action: () => Promise<T> | T,
  options: DashboardTimingOptions = {},
): Promise<T> {
  const context = getActiveContext();
  if (!context) {
    return action();
  }

  const startedAt = process.hrtime.bigint();
  let failed = false;
  try {
    return await action();
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    const durationMs = roundDuration(getElapsedMs(startedAt));
    const thresholdMs = options.thresholdMs ?? SLOW_OPERATION_THRESHOLD_MS;
    const timingPayload = {
      event: 'ADMIN_DASHBOARD_TIMING',
      requestId: context.requestId,
      step,
      loadPhase: context.loadPhase,
      durationMs,
      failed,
    };

    logInfo(context, timingPayload);

    if (durationMs > thresholdMs) {
      logWarn(context, {
        event: options.warnEvent ?? 'ADMIN_DASHBOARD_SLOW_OPERATION',
        requestId: context.requestId,
        step,
        loadPhase: context.loadPhase,
        durationMs,
        thresholdMs,
        failed,
      });
    }
  }
}

export function startDashboardTimer() {
  return getActiveContext() ? process.hrtime.bigint() : null;
}

export function logDashboardTiming(step: string, startedAt: bigint | null, options: DashboardTimingOptions = {}) {
  const context = getActiveContext();
  if (!context || !startedAt) {
    return;
  }

  const durationMs = roundDuration(getElapsedMs(startedAt));
  const thresholdMs = options.thresholdMs ?? SLOW_OPERATION_THRESHOLD_MS;
  logInfo(context, {
    event: 'ADMIN_DASHBOARD_TIMING',
    requestId: context.requestId,
    step,
    loadPhase: context.loadPhase,
    durationMs,
    failed: false,
  });

  if (durationMs > thresholdMs) {
    logWarn(context, {
      event: options.warnEvent ?? 'ADMIN_DASHBOARD_SLOW_OPERATION',
      requestId: context.requestId,
      step,
      loadPhase: context.loadPhase,
      durationMs,
      thresholdMs,
      failed: false,
    });
  }
}

export function withDashboardRouteTiming<T>(routeName: string, action: () => Promise<T> | T): Promise<T> {
  logDashboardRouteStart(`${routeName}.start`);
  return withDashboardTiming(`${routeName}.end`, action, {
    thresholdMs: SLOW_TOTAL_THRESHOLD_MS,
    warnEvent: 'ADMIN_DASHBOARD_SLOW_TOTAL',
  });
}
