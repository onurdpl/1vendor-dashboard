type ApiMode = 'development' | 'production' | 'test';

type ImportMetaEnvLike = ImportMeta['env'] & {
  VITE_API_BASE_URL?: string;
  VITE_API_TIMEOUT_MS?: string;
  VITE_API_ENV?: string;
};

const env = import.meta.env as ImportMetaEnvLike;

export const apiConfig = {
  mode: (env.VITE_API_ENV ?? env.MODE ?? 'development') as ApiMode | string,
  baseUrl: env.VITE_API_BASE_URL ?? '/api',
  timeoutMs: Number(env.VITE_API_TIMEOUT_MS ?? '15000'),
} as const;
