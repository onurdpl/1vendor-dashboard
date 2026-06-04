import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadRuntimeConfig() {
  vi.resetModules();
  return import('./runtime');
}

describe('runtime configuration diagnostics', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('exposes safe frontend build diagnostics', async () => {
    vi.stubEnv('VITE_API_MODE', 'real');
    vi.stubEnv('VITE_API_BASE_URL', 'https://backend.example.com/api');
    vi.stubEnv('VITE_APP_ENV', 'production');
    vi.stubEnv('VITE_APP_VERSION', '1.2.3');
    vi.stubEnv('VITE_BUILD_TIMESTAMP', '2026-05-17T10:00:00.000Z');
    vi.stubEnv('VITE_GIT_COMMIT', 'abcdef1234567890');

    const { runtimeConfig } = await loadRuntimeConfig();

    expect(runtimeConfig).toMatchObject({
      apiMode: 'real',
      apiBaseUrl: 'https://backend.example.com/api',
      apiBaseOrigin: 'https://backend.example.com',
      appEnvironment: 'production',
      appVersion: '1.2.3',
      buildTimestamp: '2026-05-17T10:00:00.000Z',
      gitCommit: 'abcdef123456',
      startupIssues: [],
    });
    expect(JSON.stringify(runtimeConfig)).not.toContain('Bearer');
  });

  it('flags invalid real-mode startup configuration before operational pages boot', async () => {
    vi.stubEnv('VITE_API_MODE', 'real');
    vi.stubEnv('VITE_API_BASE_URL', '');

    const { runtimeConfig } = await loadRuntimeConfig();

    expect(runtimeConfig.startupIssues).toContain('Real API mode requires VITE_API_BASE_URL.');
    expect(runtimeConfig.startupIssues).toContain('Real API mode is pointing at a local backend URL.');
  });

  it('fails closed in production when VITE_API_MODE is missing', async () => {
    vi.stubEnv('VITE_APP_ENV', 'production');
    vi.stubEnv('VITE_API_MODE', undefined);

    await expect(loadRuntimeConfig()).rejects.toThrow('Production frontend requires VITE_API_MODE=real.');
  });

  it('fails closed in production when VITE_API_MODE is mock', async () => {
    vi.stubEnv('VITE_APP_ENV', 'production');
    vi.stubEnv('VITE_API_MODE', 'mock');

    await expect(loadRuntimeConfig()).rejects.toThrow('Production frontend requires VITE_API_MODE=real.');
  });

  it('allows production startup when VITE_API_MODE is real', async () => {
    vi.stubEnv('VITE_APP_ENV', 'production');
    vi.stubEnv('VITE_API_MODE', 'real');
    vi.stubEnv('VITE_API_BASE_URL', 'https://backend.example.com');

    const { runtimeConfig } = await loadRuntimeConfig();

    expect(runtimeConfig.apiMode).toBe('real');
    expect(runtimeConfig.startupIssues).toEqual([]);
  });

  it('flags production real-mode API configuration that points at the frontend origin', async () => {
    vi.stubEnv('VITE_APP_ENV', 'production');
    vi.stubEnv('VITE_API_MODE', 'real');
    vi.stubEnv('VITE_API_BASE_URL', window.location.origin);

    const { runtimeConfig } = await loadRuntimeConfig();

    expect(runtimeConfig.startupIssues).toContain(
      'Production real API mode requires VITE_API_BASE_URL to point to the backend origin, not the frontend origin.',
    );
  });

  it('preserves development mock fallback when VITE_API_MODE is missing', async () => {
    vi.stubEnv('VITE_APP_ENV', 'development');
    vi.stubEnv('VITE_API_MODE', undefined);

    const { runtimeConfig } = await loadRuntimeConfig();

    expect(runtimeConfig.apiMode).toBe('mock');
    expect(runtimeConfig.apiBaseUrl).toBe('/api');
  });
});
