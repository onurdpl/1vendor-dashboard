type ApiMode = 'mock' | 'real';

type ImportMetaEnvLike = ImportMeta['env'] & {
  VITE_API_MODE?: string;
  VITE_API_BASE_URL?: string;
  VITE_API_TIMEOUT_MS?: string;
};

const env = import.meta.env as ImportMetaEnvLike;

function resolveApiMode(): ApiMode {
  const rawMode = env.VITE_API_MODE?.trim().toLowerCase();

  if (rawMode === 'real') {
    return 'real';
  }

  return 'mock';
}

function resolveBaseUrl(mode: ApiMode) {
  if (mode === 'mock') {
    return env.VITE_API_BASE_URL?.trim() || '/api';
  }

  const baseUrl = env.VITE_API_BASE_URL?.trim();

  if (!baseUrl) {
    throw new Error('Missing VITE_API_BASE_URL. Set it when VITE_API_MODE=real.');
  }

  return baseUrl;
}

function resolveTimeoutMs() {
  const rawTimeout = env.VITE_API_TIMEOUT_MS?.trim();
  const timeoutMs = rawTimeout ? Number(rawTimeout) : 15000;

  return Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 15000;
}

const mode = resolveApiMode();

export const apiConfig = {
  mode,
  baseUrl: resolveBaseUrl(mode),
  timeoutMs: resolveTimeoutMs(),
} as const;
