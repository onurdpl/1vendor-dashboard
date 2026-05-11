import { runtimeConfig } from '../../config/runtime';

export const apiConfig = {
  mode: runtimeConfig.apiMode,
  baseUrl: runtimeConfig.apiBaseUrl,
  timeoutMs: 15000,
} as const;
