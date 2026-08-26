import type { SellerInfoMap } from './shopify-admin.types.js';

type FetchSellerInfo = (orderId: string, options?: { signal?: AbortSignal }) => Promise<{
  sellerInfo: SellerInfoMap | null;
  source: 'mock' | 'shopify_admin';
}>;

export type FetchSellerInfoWithRetryResult =
  | {
      ok: true;
      sellerInfo: SellerInfoMap;
      attempts: number;
      source: 'mock' | 'shopify_admin';
    }
  | {
      ok: false;
      error: string;
      attempts: number;
      source: 'mock' | 'shopify_admin' | null;
    };

function abortError(signal: AbortSignal) {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException('The operation was aborted.', 'AbortError');
}

function throwIfAborted(signal: AbortSignal | undefined) {
  if (signal?.aborted) {
    throw abortError(signal);
  }
}

function sleep(ms: number, signal?: AbortSignal) {
  throwIfAborted(signal);

  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timeout);
      reject(abortError(signal!));
    };

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export async function fetchSellerInfoWithRetry(input: {
  orderId: string;
  fetchSellerInfo: FetchSellerInfo;
  attempts?: number;
  delayMs: number;
  signal?: AbortSignal;
}): Promise<FetchSellerInfoWithRetryResult> {
  const maxAttempts = input.attempts ?? 3;
  let lastSource: 'mock' | 'shopify_admin' | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    throwIfAborted(input.signal);
    const result = input.signal
      ? await input.fetchSellerInfo(input.orderId, { signal: input.signal })
      : await input.fetchSellerInfo(input.orderId);
    lastSource = result.source;

    if (result.sellerInfo) {
      return {
        ok: true,
        sellerInfo: result.sellerInfo,
        attempts: attempt,
        source: result.source,
      };
    }

    if (attempt < maxAttempts) {
      await sleep(input.delayMs, input.signal);
    }
  }

  return {
    ok: false,
    error: 'Shopify seller_info metafield was missing or empty after retry attempts.',
    attempts: maxAttempts,
    source: lastSource,
  };
}
