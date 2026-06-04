import * as Sentry from '@sentry/node';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppEnv } from '../config/env.js';
import { sanitizeSentryData } from './sentry-sanitize.js';

type BackendSentryEnvironment = {
  SENTRY_DSN?: string;
  NODE_ENV?: string;
  SENTRY_ENVIRONMENT?: string;
  RENDER_GIT_COMMIT?: string;
  GIT_COMMIT?: string;
};

let initialized = false;
let processHandlersRegistered = false;

function normalizeEnvironment(value: string | undefined) {
  return value?.trim().toLowerCase() || 'development';
}

function getSentryRuntimeEnvironment(env: BackendSentryEnvironment) {
  return normalizeEnvironment(env.SENTRY_ENVIRONMENT ?? env.NODE_ENV);
}

export function shouldEnableBackendSentry(env: BackendSentryEnvironment) {
  if (!env.SENTRY_DSN?.trim()) {
    return false;
  }

  const runtimeEnvironment = getSentryRuntimeEnvironment(env);
  return runtimeEnvironment === 'production' || runtimeEnvironment === 'staging';
}

export function beforeSendBackendSentryEvent<T>(event: T): T {
  return sanitizeSentryData(event);
}

function buildRelease(env: BackendSentryEnvironment) {
  const commit = env.RENDER_GIT_COMMIT ?? env.GIT_COMMIT;
  return commit?.trim() ? commit.trim().slice(0, 12) : undefined;
}

export function captureBackendError(error: unknown, context: Record<string, unknown> = {}) {
  if (!initialized) {
    return;
  }

  Sentry.captureException(error, {
    extra: sanitizeSentryData(context),
  });
}

function registerProcessErrorHandlers() {
  if (processHandlersRegistered) {
    return;
  }

  process.on('unhandledRejection', (reason) => {
    captureBackendError(reason instanceof Error ? reason : new Error('Unhandled promise rejection'), {
      source: 'process.unhandledRejection',
      reasonType: typeof reason,
    });
  });

  process.on('uncaughtExceptionMonitor', (error) => {
    captureBackendError(error, {
      source: 'process.uncaughtExceptionMonitor',
    });
  });

  processHandlersRegistered = true;
}

export function initBackendSentry(env: BackendSentryEnvironment = process.env) {
  if (!shouldEnableBackendSentry(env) || initialized) {
    return { enabled: false };
  }

  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: getSentryRuntimeEnvironment(env),
    release: buildRelease(env),
    sendDefaultPii: false,
    beforeSend: (event) => beforeSendBackendSentryEvent(event),
  });
  initialized = true;
  registerProcessErrorHandlers();

  return { enabled: true };
}

function buildSafeFastifyErrorContext(request: FastifyRequest, reply: FastifyReply) {
  return {
    source: 'fastify.onError',
    requestId: request.requestId ?? null,
    method: request.method,
    route: typeof request.routeOptions?.url === 'string' ? request.routeOptions.url : 'unknown',
    statusCode: reply.statusCode,
    headers: sanitizeSentryData({
      'x-request-id': request.headers['x-request-id'],
      'x-auth-attempt-id': request.headers['x-auth-attempt-id'],
      'x-vendor-id': request.headers['x-vendor-id'],
    }),
  };
}

export function registerBackendSentryFastifyHooks(app: FastifyInstance, env: AppEnv) {
  initBackendSentry({
    SENTRY_DSN: process.env.SENTRY_DSN,
    SENTRY_ENVIRONMENT: process.env.SENTRY_ENVIRONMENT,
    NODE_ENV: process.env.NODE_ENV ?? env.NODE_ENV,
    RENDER_GIT_COMMIT: process.env.RENDER_GIT_COMMIT,
    GIT_COMMIT: process.env.GIT_COMMIT,
  });

  app.addHook('onError', async (request, reply, error) => {
    captureBackendError(error, buildSafeFastifyErrorContext(request, reply));
  });
}
