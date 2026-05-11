type ApiMode = 'mock' | 'real';

type RuntimeEnv = ImportMeta['env'] & {
  VITE_API_MODE?: string;
  VITE_API_BASE_URL?: string;
};

const env = import.meta.env as RuntimeEnv;

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

export const runtimeConfig = {
  apiMode: resolveApiMode(),
  apiBaseUrl: resolveApiBaseUrl(resolveApiMode()),
} as const;

if (typeof console !== 'undefined') {
  console.info(`[runtime] API mode: ${runtimeConfig.apiMode}`);
}
