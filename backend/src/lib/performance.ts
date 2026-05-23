const DEFAULT_SLOW_ENDPOINT_THRESHOLD_MS = 750;

export async function withSlowEndpointTiming<T>(
  endpoint: string,
  action: () => Promise<T> | T,
  thresholdMs = DEFAULT_SLOW_ENDPOINT_THRESHOLD_MS,
): Promise<T> {
  const startedAt = Date.now();
  try {
    return await action();
  } finally {
    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs >= thresholdMs) {
      console.warn('[slow-endpoint]', {
        endpoint,
        elapsedMs,
      });
    }
  }
}
