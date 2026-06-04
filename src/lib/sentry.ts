import * as Sentry from '@sentry/react';
import { runtimeConfig } from '../config/runtime';
import { sanitizeSentryData } from './sentry-sanitize';

type FrontendSentryEnvironment = {
  dsn?: string;
  appEnvironment?: string;
  prod?: boolean;
};

let initialized = false;
let globalHandlersRegistered = false;

function normalizeEnvironment(value: string | undefined) {
  return value?.trim().toLowerCase() || 'development';
}

export function shouldEnableFrontendSentry(env: FrontendSentryEnvironment) {
  if (!env.dsn?.trim()) {
    return false;
  }

  const appEnvironment = normalizeEnvironment(env.appEnvironment);
  return appEnvironment === 'production' || appEnvironment === 'staging' || env.prod === true;
}

export function beforeSendFrontendSentryEvent<T>(event: T): T {
  return sanitizeSentryData(event);
}

export function captureFrontendError(error: unknown, context: Record<string, unknown> = {}) {
  if (!initialized) {
    return;
  }

  Sentry.captureException(error, {
    extra: sanitizeSentryData(context),
  });
}

function registerGlobalHandlers() {
  if (globalHandlersRegistered || typeof window === 'undefined') {
    return;
  }

  window.addEventListener('error', (event) => {
    captureFrontendError(event.error ?? new Error(event.message), {
      source: 'window.error',
      filename: event.filename,
      lineNumber: event.lineno,
      columnNumber: event.colno,
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    captureFrontendError(event.reason instanceof Error ? event.reason : new Error('Unhandled promise rejection'), {
      source: 'window.unhandledrejection',
      reasonType: typeof event.reason,
    });
  });

  globalHandlersRegistered = true;
}

export function initFrontendSentry() {
  const dsn = import.meta.env.VITE_SENTRY_DSN?.trim();
  const enabled = shouldEnableFrontendSentry({
    dsn,
    appEnvironment: runtimeConfig.appEnvironment,
    prod: import.meta.env.PROD === true,
  });

  if (!enabled || initialized) {
    return { enabled: false };
  }

  Sentry.init({
    dsn,
    environment: runtimeConfig.appEnvironment,
    release: runtimeConfig.gitCommit ?? runtimeConfig.appVersion,
    sendDefaultPii: false,
    beforeSend: (event) => beforeSendFrontendSentryEvent(event),
  });
  initialized = true;
  registerGlobalHandlers();

  return { enabled: true };
}
