import React from 'react';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sentryReactMock = vi.hoisted(() => ({
  init: vi.fn(),
  captureException: vi.fn(),
}));

const sentryNodeMock = vi.hoisted(() => ({
  init: vi.fn(),
  captureException: vi.fn(),
}));

vi.mock('@sentry/react', () => sentryReactMock);
vi.mock('@sentry/node', () => sentryNodeMock);

const originalEnv = { ...process.env };

function setFrontendProductionEnv(overrides: Record<string, string | undefined> = {}) {
  vi.stubEnv('VITE_API_MODE', 'real');
  vi.stubEnv('VITE_API_BASE_URL', 'https://backend.example.com');
  vi.stubEnv('VITE_APP_ENV', 'production');
  for (const [key, value] of Object.entries(overrides)) {
    vi.stubEnv(key, value);
  }
}

function resetBackendEnv(overrides: Record<string, string | undefined>) {
  process.env = {
    ...originalEnv,
    NODE_ENV: 'test',
    JWT_SECRET: 'test-jwt-secret',
    SHOPIFY_WEBHOOK_SECRET: 'test-shopify-webhook-secret',
    ...overrides,
  };
}

describe('Sentry error tracking foundation', () => {
  beforeEach(() => {
    sentryReactMock.init.mockReset();
    sentryReactMock.captureException.mockReset();
    sentryNodeMock.init.mockReset();
    sentryNodeMock.captureException.mockReset();
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('keeps frontend Sentry disabled when DSN is missing', async () => {
    setFrontendProductionEnv({ VITE_SENTRY_DSN: undefined });

    const { initFrontendSentry } = await import('./lib/sentry');

    expect(initFrontendSentry()).toEqual({ enabled: false });
    expect(sentryReactMock.init).not.toHaveBeenCalled();
  });

  it('enables frontend Sentry only with DSN and production or staging environment', async () => {
    setFrontendProductionEnv({ VITE_SENTRY_DSN: 'https://frontend-dsn.example/1' });

    const { initFrontendSentry, shouldEnableFrontendSentry } = await import('./lib/sentry');

    expect(shouldEnableFrontendSentry({ dsn: 'https://dsn.example/1', appEnvironment: 'development' })).toBe(false);
    expect(shouldEnableFrontendSentry({ dsn: 'https://dsn.example/1', appEnvironment: 'staging' })).toBe(true);
    expect(initFrontendSentry()).toEqual({ enabled: true });
    expect(sentryReactMock.init).toHaveBeenCalledWith(expect.objectContaining({
      dsn: 'https://frontend-dsn.example/1',
      environment: 'production',
      sendDefaultPii: false,
    }));
  });

  it('redacts sensitive frontend Sentry event data before sending', async () => {
    setFrontendProductionEnv({ VITE_SENTRY_DSN: 'https://frontend-dsn.example/1' });

    const { beforeSendFrontendSentryEvent } = await import('./lib/sentry');
    const event = beforeSendFrontendSentryEvent({
      request: {
        headers: {
          authorization: 'Bearer secret-token',
          cookie: 'sporgym_session=secret',
          'x-csrf-token': 'csrf-secret',
        },
      },
      extra: {
        password: 'plain',
        access_token: 'token',
        client_secret: 'secret',
        customerEmail: 'customer@example.com',
        customerPhone: '+90 555 111 22 33',
        shippingAddress: 'Customer address',
      },
    });

    const serialized = JSON.stringify(event);
    expect(serialized).not.toContain('secret-token');
    expect(serialized).not.toContain('sporgym_session');
    expect(serialized).not.toContain('csrf-secret');
    expect(serialized).not.toContain('plain');
    expect(serialized).not.toContain('customer@example.com');
    expect(serialized).not.toContain('+90 555');
    expect(serialized).toContain('[redacted]');
  });

  it('captures ErrorBoundary render errors through the frontend helper', async () => {
    setFrontendProductionEnv({ VITE_SENTRY_DSN: 'https://frontend-dsn.example/1' });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { initFrontendSentry } = await import('./lib/sentry');
    const { ErrorBoundary } = await import('./components/ErrorBoundary');
    initFrontendSentry();

    function ThrowingSection() {
      throw new Error('render failed');
    }

    render(
      <ErrorBoundary routeName="Orders">
        <ThrowingSection />
      </ErrorBoundary>,
    );

    expect(screen.getByText('This section could not load')).toBeInTheDocument();
    expect(sentryReactMock.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        extra: expect.objectContaining({
          routeName: 'Orders',
        }),
      }),
    );
    consoleError.mockRestore();
  });

  it('keeps backend Sentry disabled without DSN and enables it only for production or staging', async () => {
    const { initBackendSentry, shouldEnableBackendSentry } = await import('../backend/src/lib/sentry');

    expect(shouldEnableBackendSentry({ NODE_ENV: 'production' })).toBe(false);
    expect(shouldEnableBackendSentry({ NODE_ENV: 'development', SENTRY_DSN: 'https://backend-dsn.example/1' })).toBe(false);
    expect(shouldEnableBackendSentry({ NODE_ENV: 'staging', SENTRY_DSN: 'https://backend-dsn.example/1' })).toBe(true);
    expect(initBackendSentry({ NODE_ENV: 'test', SENTRY_DSN: 'https://backend-dsn.example/1' })).toEqual({ enabled: false });
    expect(sentryNodeMock.init).not.toHaveBeenCalled();
  });

  it('redacts sensitive backend Sentry event data before sending', async () => {
    const { beforeSendBackendSentryEvent } = await import('../backend/src/lib/sentry');
    const event = beforeSendBackendSentryEvent({
      request: {
        headers: {
          Authorization: 'Bearer backend-token',
          Cookie: 'sporgym_session=secret',
        },
        data: {
          password: 'plain',
          api_key: 'provider-key',
          refresh_token: 'rotated-secret-value',
          customerEmail: 'customer@example.com',
          phone: '+90 555 111 22 33',
          billingAddress: 'Customer address',
        },
      },
    });

    const serialized = JSON.stringify(event);
    expect(serialized).not.toContain('backend-token');
    expect(serialized).not.toContain('sporgym_session');
    expect(serialized).not.toContain('provider-key');
    expect(serialized).not.toContain('rotated-secret-value');
    expect(serialized).not.toContain('customer@example.com');
    expect(serialized).toContain('[redacted]');
  });

  it('captures Fastify errors without changing the existing error response shape', async () => {
    resetBackendEnv({});
    const { createApp } = await import('../backend/src/app');
    const app = createApp();
    app.get('/sentry-test-error', async () => {
      throw new Error('backend route failed');
    });

    const response = await app.inject({
      method: 'GET',
      url: '/sentry-test-error',
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({
      statusCode: 500,
      error: 'Internal Server Error',
      message: 'backend route failed',
    });
    await app.close();
  });
});
