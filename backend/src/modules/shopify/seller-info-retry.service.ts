import type { SellerInfoMap } from './shopify-admin.types.js';

type FetchSellerInfo = (orderId: string) => Promise<{
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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchSellerInfoWithRetry(input: {
  orderId: string;
  fetchSellerInfo: FetchSellerInfo;
  attempts?: number;
  delayMs: number;
}): Promise<FetchSellerInfoWithRetryResult> {
  const maxAttempts = input.attempts ?? 3;
  let lastSource: 'mock' | 'shopify_admin' | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await input.fetchSellerInfo(input.orderId);
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
      await sleep(input.delayMs);
    }
  }

  return {
    ok: false,
    error: 'Shopify seller_info metafield was missing or empty after retry attempts.',
    attempts: maxAttempts,
    source: lastSource,
  };
}
