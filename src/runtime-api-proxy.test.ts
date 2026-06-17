import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadRuntimeConfig() {
  vi.resetModules();
  return import('./config/runtime');
}

describe('same-origin API proxy runtime mode', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('accepts /api in production real mode', async () => {
    vi.stubEnv('VITE_APP_ENV', 'production');
    vi.stubEnv('VITE_API_MODE', 'real');
    vi.stubEnv('VITE_API_BASE_URL', '/api');

    const { runtimeConfig } = await loadRuntimeConfig();

    expect(runtimeConfig.apiMode).toBe('real');
    expect(runtimeConfig.apiBaseUrl).toBe('/api');
    expect(runtimeConfig.apiBaseOrigin).toBe(window.location.origin);
    expect(runtimeConfig.startupIssues).toEqual([]);
  });

  it('resolves same-origin /api auth, admin, and returns URLs without double slashes', async () => {
    vi.stubEnv('VITE_API_MODE', 'real');
    vi.stubEnv('VITE_API_BASE_URL', '/api/');

    const { buildApiUrl } = await import('./lib/api-client');

    expect(buildApiUrl('/auth/me')).toBe('/api/auth/me');
    expect(buildApiUrl('auth/login')).toBe('/api/auth/login');
    expect(buildApiUrl('/auth/csrf')).toBe('/api/auth/csrf');
    expect(buildApiUrl('/admin/operations/summary')).toBe('/api/admin/operations/summary');
    expect(buildApiUrl('/returns?workflow=pending-review')).toBe('/api/returns?workflow=pending-review');
  });

  it('keeps absolute backend URL mode working', async () => {
    vi.stubEnv('VITE_API_MODE', 'real');
    vi.stubEnv('VITE_API_BASE_URL', 'https://backend.example.com/');

    const { buildApiUrl } = await import('./lib/api-client');

    expect(buildApiUrl('/auth/me')).toBe('https://backend.example.com/auth/me');
    expect(buildApiUrl('auth/login')).toBe('https://backend.example.com/auth/login');
  });

  it('keeps mock/dev fallback unchanged', async () => {
    vi.stubEnv('VITE_APP_ENV', 'development');
    vi.stubEnv('VITE_API_MODE', undefined);
    vi.stubEnv('VITE_API_BASE_URL', undefined);

    const { runtimeConfig } = await loadRuntimeConfig();

    expect(runtimeConfig.apiMode).toBe('mock');
    expect(runtimeConfig.apiBaseUrl).toBe('/api');
  });
});
