/** Sopyo's documented login, order-list, and controlled order-create contracts. */
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

export type SopyoOrderByCode = { id: number; orderCode: string; orderType: string | null };

export type SopyoCreateAmbiguousReason =
  | 'TRANSPORT_ERROR'
  | 'REQUEST_TIMEOUT'
  | 'HTTP_RETRYABLE_STATUS'
  | 'RESPONSE_PARSE_ERROR'
  | 'MALFORMED_SUCCESS_RESPONSE'
  | 'UNEXPECTED_HTTP_STATUS';

export type SopyoCreateOrderInput = {
  order_code: string;
  order_status: 1;
  total_price: number;
  customer_info: { email: string; name: string };
  shipping_info: { full_name: string; gsm: string; city: string; address: string; district?: string };
  billing_info: { full_name: string; gsm: string; city: string; district?: string };
  order_items: Array<{ stock_code: string; product_name: string; quantity: 1; total_price: number }>;
};

export type SopyoCreateOrderResult =
  | { kind: 'CREATED'; id: number; orderCode: string; orderType: string }
  | { kind: 'REJECTED'; httpStatus: number; message: string }
  | { kind: 'AMBIGUOUS'; ambiguousReason: 'TRANSPORT_ERROR' | 'REQUEST_TIMEOUT' }
  | { kind: 'AMBIGUOUS'; ambiguousReason: Exclude<SopyoCreateAmbiguousReason, 'TRANSPORT_ERROR' | 'REQUEST_TIMEOUT'>; httpStatus: number };

const CREATE_FIELDS = [
  'order_code', 'order_status', 'total_price', 'customer_info', 'customer_info.email',
  'customer_info.name', 'shipping_info', 'shipping_info.full_name', 'shipping_info.gsm',
  'shipping_info.city', 'shipping_info.district', 'shipping_info.address', 'shipping_info.identification_no',
  'shipping_info.neighborhood', 'billing_info', 'billing_info.full_name', 'billing_info.gsm',
  'billing_info.city', 'billing_info.district', 'billing_info.address', 'billing_info.neighborhood',
  'order_items', 'order_items.stock_code', 'order_items.product_name', 'order_items.quantity',
  'order_items.total_price',
];

function sanitizedCreateMessage(body: unknown): string {
  // A provider message may echo customer data. Retain only fixed schema field names.
  if (!isRecord(body) || !isRecord(body.errors)) return 'Provider rejected order create request; response body suppressed.';
  const fields = Object.keys(body.errors).filter((key) => CREATE_FIELDS.includes(key)).sort();
  return fields.length > 0
    ? `Provider validation rejected: ${fields.join(', ')}.`
    : 'Provider rejected order create request; response body suppressed.';
}

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

    async ordersByCode(accessToken: string, orderCode: string): Promise<SopyoOrderByCode[]> {
      const orders: SopyoOrderByCode[] = [];
      for (let page = 1; page <= MAX_ORDER_PAGES; page += 1) {
        const url = new URL('/api/v2/orders', BASE_URL);
        url.searchParams.set('order_code[eq]', orderCode);
        url.searchParams.set('page', String(page));
        const body = await requestJson(fetcher, url.toString(), {
          method: 'GET',
          headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
        }, 'ORDERS');
        if (!isRecord(body) || !Array.isArray(body.data) || !isRecord(body.meta) ||
            !Number.isSafeInteger(body.meta.current_page) || body.meta.current_page !== page ||
            !Number.isSafeInteger(body.meta.last_page) || (body.meta.last_page as number) < page) {
          throw new SopyoDeliveryClientError('MALFORMED');
        }
        for (const row of body.data) {
          if (!isRecord(row) || !Number.isSafeInteger(row.id) || (row.id as number) <= 0 ||
              typeof row.order_code !== 'string' || row.order_code !== orderCode ||
              (row.order_type !== null && row.order_type !== undefined && typeof row.order_type !== 'string')) {
            throw new SopyoDeliveryClientError('MALFORMED');
          }
          orders.push({ id: row.id as number, orderCode: row.order_code, orderType: row.order_type ?? null });
        }
        if (page === body.meta.last_page) return orders;
      }
      throw new SopyoDeliveryClientError('PAGINATION');
    },

    async createOrderOnce(accessToken: string, input: SopyoCreateOrderInput): Promise<SopyoCreateOrderResult> {
      let response: Response;
      const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
      try {
        response = await fetcher(`${BASE_URL}/api/v2/orders`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
          signal,
        });
      } catch {
        // The provider may have accepted a request before the connection failed.
        return { kind: 'AMBIGUOUS', ambiguousReason: signal.aborted ? 'REQUEST_TIMEOUT' : 'TRANSPORT_ERROR' };
      }
      if (response.status >= 500 || [408, 409, 425, 429].includes(response.status)) {
        return { kind: 'AMBIGUOUS', ambiguousReason: 'HTTP_RETRYABLE_STATUS', httpStatus: response.status };
      }
      let body: unknown;
      try {
        body = await response.json() as unknown;
      } catch {
        return { kind: 'AMBIGUOUS', ambiguousReason: 'RESPONSE_PARSE_ERROR', httpStatus: response.status };
      }
      if (response.status >= 400 && response.status < 500) {
        return { kind: 'REJECTED', httpStatus: response.status, message: sanitizedCreateMessage(body) };
      }
      if (response.status !== 201) {
        return { kind: 'AMBIGUOUS', ambiguousReason: 'UNEXPECTED_HTTP_STATUS', httpStatus: response.status };
      }
      if (!isRecord(body) || !isRecord(body.data) || !Number.isSafeInteger(body.data.id) ||
          (body.data.id as number) <= 0 || typeof body.data.order_code !== 'string' ||
          typeof body.data.order_type !== 'string') {
        return { kind: 'AMBIGUOUS', ambiguousReason: 'MALFORMED_SUCCESS_RESPONSE', httpStatus: 201 };
      }
      return {
        kind: 'CREATED', id: body.data.id as number,
        orderCode: body.data.order_code, orderType: body.data.order_type,
      };
    },
  };
}
