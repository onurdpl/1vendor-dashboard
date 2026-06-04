type ApiMode = 'mock' | 'real';

type RuntimeEnv = ImportMeta['env'] & {
  VITE_API_MODE?: string;
  VITE_API_BASE_URL?: string;
  VITE_APP_ENV?: string;
  VITE_APP_VERSION?: string;
  VITE_BUILD_TIMESTAMP?: string;
  VITE_GIT_COMMIT?: string;
  VITE_SENTRY_DSN?: string;
};

const env = import.meta.env as RuntimeEnv;

function isProductionFrontend() {
  return env.VITE_APP_ENV?.trim().toLowerCase() === 'production' || env.PROD === true;
}

function assertProductionApiMode() {
  const normalized = env.VITE_API_MODE?.trim().toLowerCase();
  if (isProductionFrontend() && normalized !== 'real') {
    throw new Error('Production frontend requires VITE_API_MODE=real.');
  }
}

function resolveApiMode(): ApiMode {
  const normalized = env.VITE_API_MODE?.trim().toLowerCase();
  return normalized === 'real' ? 'real' : 'mock';
}

function resolveApiBaseUrl(mode: ApiMode) {
  const configured = env.VITE_API_BASE_URL?.trim();

  if (configured) {
    return configured;
  }

  return mode === 'real' ? 'http://127.0.0.1:4000' : '/api';
}

function resolveApiBaseOrigin(apiBaseUrl: string) {
  try {
    const fallbackOrigin = typeof window === 'undefined' ? 'https://vendor-dashboard.local' : window.location.origin;
    return new URL(apiBaseUrl, fallbackOrigin).origin;
  } catch {
    return 'unavailable';
  }
}

function getFrontendOrigin() {
  if (typeof window === 'undefined') {
    return null;
  }

  return window.location.origin;
}

function getStartupIssues(mode: ApiMode, apiBaseUrl: string, apiBaseOrigin: string) {
  const issues: string[] = [];
  const frontendOrigin = getFrontendOrigin();

  if (mode === 'real' && !env.VITE_API_BASE_URL?.trim()) {
    issues.push('Real API mode requires VITE_API_BASE_URL.');
  }

  if (mode === 'real' && apiBaseUrl.includes('127.0.0.1')) {
    issues.push('Real API mode is pointing at a local backend URL.');
  }

  if (
    mode === 'real' &&
    isProductionFrontend() &&
    frontendOrigin &&
    apiBaseOrigin === frontendOrigin
  ) {
    issues.push('Production real API mode requires VITE_API_BASE_URL to point to the backend origin, not the frontend origin.');
  }

  return issues;
}

assertProductionApiMode();

const apiMode = resolveApiMode();
const apiBaseUrl = resolveApiBaseUrl(apiMode);
const apiBaseOrigin = resolveApiBaseOrigin(apiBaseUrl);
const gitCommit = env.VITE_GIT_COMMIT?.trim() ? env.VITE_GIT_COMMIT.trim().slice(0, 12) : null;

export const runtimeConfig = {
  apiMode,
  apiBaseUrl,
  apiBaseOrigin,
  appEnvironment: env.VITE_APP_ENV?.trim() || env.MODE || 'development',
  appVersion: env.VITE_APP_VERSION?.trim() || '0.1.0',
  buildTimestamp: env.VITE_BUILD_TIMESTAMP?.trim() || null,
  gitCommit,
  startupIssues: getStartupIssues(apiMode, apiBaseUrl, apiBaseOrigin),
} as const;

if (typeof console !== 'undefined') {
  console.info(`[runtime] API mode: ${runtimeConfig.apiMode}`);
}
