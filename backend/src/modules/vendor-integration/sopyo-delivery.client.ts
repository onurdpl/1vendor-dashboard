/** Sopyo's documented login and tracking-filtered order-list contract only. */
const BASE_URL = 'https://api.sopyo.dev';
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_ORDER_PAGES = 20;

export class SopyoDeliveryClientError extends Error {
  constructor(readonly category: 'AUTH' | 'ORDERS' | 'MALFORMED' | 'PAGINATION') {
    super(`Sopyo ${category.toLowerCase()} failed.`);
    this.name = 'SopyoDeliveryClientError';
  }
}

export type SopyoOrder = { id: number; orderStatus: number; trackingNumber: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function requestJson(fetcher: typeof fetch, url: string, init: RequestInit, category: 'AUTH' | 'ORDERS'): Promise<unknown> {
  try {
    const response = await fetcher(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!response.ok) throw new SopyoDeliveryClientError(category);
    return await response.json() as unknown;
  } catch {
    // Fetch/JSON errors may contain URLs, request headers or provider payloads.
    throw new SopyoDeliveryClientError(category);
  }
}

export function createSopyoDeliveryClient(fetcher: typeof fetch = fetch) {
  return {
    async authenticate(apiToken: string): Promise<string> {
      const body = await requestJson(fetcher, `${BASE_URL}/api/v2/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ api_token: [apiToken] }),
      }, 'AUTH');
      if (!isRecord(body) || !isRecord(body.access_token) ||
          typeof body.access_token.token !== 'string' || !body.access_token.token.trim() ||
          body.access_token.type !== 'bearer') {
        throw new SopyoDeliveryClientError('MALFORMED');
      }
      return body.access_token.token;
    },

    async ordersByTracking(accessToken: string, trackingNumber: string): Promise<SopyoOrder[]> {
      const orders: SopyoOrder[] = [];
      for (let page = 1; page <= MAX_ORDER_PAGES; page += 1) {
        const url = new URL('/api/v2/orders', BASE_URL);
        url.searchParams.set('cargo_tracking_no[eq]', trackingNumber);
        url.searchParams.set('page', String(page));
        const body = await requestJson(fetcher, url.toString(), {
          method: 'GET',
          headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
        }, 'ORDERS');
        if (!isRecord(body) || !Array.isArray(body.data) || !isRecord(body.meta) ||
            !Number.isSafeInteger(body.meta.current_page) || body.meta.current_page !== page ||
            !Number.isSafeInteger(body.meta.last_page) ||
            (body.meta.last_page as number) < page) {
          throw new SopyoDeliveryClientError('MALFORMED');
        }
        for (const row of body.data) {
          if (!isRecord(row) || !Number.isSafeInteger(row.id) || (row.id as number) <= 0 ||
              !Number.isSafeInteger(row.order_status) || !isRecord(row.cargo_info) ||
              typeof row.cargo_info.tracking_no !== 'string') {
            throw new SopyoDeliveryClientError('MALFORMED');
          }
          const returnedTracking = row.cargo_info.tracking_no.trim();
          if (!returnedTracking || returnedTracking.length > 200) {
            throw new SopyoDeliveryClientError('MALFORMED');
          }
          if (returnedTracking === trackingNumber) {
            orders.push({ id: row.id as number, orderStatus: row.order_status as number, trackingNumber: returnedTracking });
          }
        }
        if (page === body.meta.last_page) return orders;
      }
      throw new SopyoDeliveryClientError('PAGINATION');
    },
  };
}
