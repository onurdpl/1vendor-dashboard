import { describe, expect, it, vi } from 'vitest';
import { createSopyoDeliveryClient, SopyoDeliveryClientError } from '../backend/src/modules/vendor-integration/sopyo-delivery.client.js';
import { registerSopyoDeliveryPollScheduler, SOPYO_DELIVERY_POLL_INTERVAL_MS } from '../backend/src/modules/vendor-integration/sopyo-delivery-poll.service.js';
import type { AppEnv } from '../backend/src/config/env.js';
import type { FastifyInstance } from 'fastify';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function page(number: number, last: number, data: unknown[]) {
  return { data, meta: { current_page: number, last_page: last }, links: { next: number < last ? `/api/v2/orders?page=${number + 1}` : null } };
}

describe('Sopyo documented delivery-read client', () => {
  it('reads only numeric-ID detail authority and keeps sensitive fields out of the result', async () => {
    const fetcher = vi.fn(async () => json({ id: 38154205, order_code: 'alloc-1',
      order_type: 'SOPYOAPI', order_status: 6, customer_info: { email: 'private@example.com' } }));
    const result = await createSopyoDeliveryClient(fetcher as typeof fetch).orderById('secret', '38154205');
    expect(result).toEqual({ id: 38154205, orderCode: 'alloc-1', orderType: 'SOPYOAPI', orderStatus: 6 });
    expect(fetcher.mock.calls[0]![0]).toBe('https://api.sopyo.dev/api/v2/orders/38154205');
    expect((fetcher.mock.calls[0]![1] as RequestInit).method).toBe('GET');
  });

  it('rejects non-200, malformed JSON and invalid detail fields without leaking provider content', async () => {
    const invalid = [
      { id: 0, order_code: 'a', order_type: 'SOPYOAPI', order_status: 6 },
      { id: 1, order_type: 'SOPYOAPI', order_status: 6 },
      { id: 1, order_code: 'a', order_status: 6 },
      { id: 1, order_code: 'a', order_type: 'SOPYOAPI', order_status: '6' },
    ];
    for (const body of invalid) {
      const client = createSopyoDeliveryClient(vi.fn(async () => json(body)) as typeof fetch);
      await expect(client.orderById('secret', '1')).rejects.toThrow('Sopyo malformed failed.');
    }
    await expect(createSopyoDeliveryClient(vi.fn(async () => json({ message: 'private@example.com' }, 404)) as typeof fetch)
      .orderById('secret', '1')).rejects.toThrow('Sopyo orders failed.');
    await expect(createSopyoDeliveryClient(vi.fn(async () => new Response('private@example.com', { status: 200 })) as typeof fetch)
      .orderById('secret', '1')).rejects.toThrow('Sopyo orders failed.');
    const fetcher = vi.fn(async () => json({}));
    await expect(createSopyoDeliveryClient(fetcher as typeof fetch).orderById('secret', '01'))
      .rejects.toThrow('Sopyo malformed failed.');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('logs in with the documented token array and keeps the returned bearer in memory', async () => {
    const fetcher = vi.fn(async () => json({ access_token: { token: 'access-secret', type: 'bearer', expire_in: 1440 } }));
    const client = createSopyoDeliveryClient(fetcher as typeof fetch);
    expect(await client.authenticate('api-secret')).toBe('access-secret');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]![0]).toBe('https://api.sopyo.dev/api/v2/auth/login');
    expect(JSON.parse((fetcher.mock.calls[0]![1] as RequestInit).body as string)).toEqual({ api_token: ['api-secret'] });
  });

  it('uses only the tracking filter, retains it across documented pages, and compares tracking exactly', async () => {
    const fetcher = vi.fn(async (url: string) => {
      const request = new URL(url);
      const number = Number(request.searchParams.get('page'));
      return json(page(number, 2, number === 1
        ? [{ id: 1, order_status: 6, cargo_info: { tracking_no: 'OTHER' } }]
        : [{ id: 2, order_status: 6, cargo_info: { tracking_no: ' TEST ' } }]));
    });
    const orders = await createSopyoDeliveryClient(fetcher as typeof fetch).ordersByTracking('bearer', 'TEST');
    expect(orders).toEqual([{ id: 2, orderStatus: 6, trackingNumber: 'TEST' }]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    for (const [url] of fetcher.mock.calls) {
      const query = new URL(url).searchParams;
      expect(query.get('cargo_tracking_no[eq]')).toBe('TEST');
      expect(query.has('order_code[eq]')).toBe(false);
      expect(query.has('order_status[eq]')).toBe(false);
    }
  });

  it('fails closed on malformed pagination or order data without exposing provider bodies', async () => {
    const malformedPage = vi.fn(async () => json({ data: [], meta: { current_page: 1 } }));
    await expect(createSopyoDeliveryClient(malformedPage as typeof fetch).ordersByTracking('secret', 'T'))
      .rejects.toMatchObject({ category: 'MALFORMED' });
    const malformedOrder = vi.fn(async () => json(page(1, 1, [{ id: 1, order_status: 6, cargo_info: null, customer_info: { email: 'private@example.com' } }])));
    await expect(createSopyoDeliveryClient(malformedOrder as typeof fetch).ordersByTracking('secret', 'T'))
      .rejects.toBeInstanceOf(SopyoDeliveryClientError);
  });

  it('does not leak authentication failures or accept a missing bearer', async () => {
    const rejected = vi.fn(async () => json({ message: 'api-secret was rejected' }, 401));
    await expect(createSopyoDeliveryClient(rejected as typeof fetch).authenticate('api-secret'))
      .rejects.toThrow('Sopyo auth failed.');
    const malformed = vi.fn(async () => json({ access_token: { token: '', type: 'bearer' } }));
    await expect(createSopyoDeliveryClient(malformed as typeof fetch).authenticate('api-secret'))
      .rejects.toMatchObject({ category: 'MALFORMED' });
  });

  it('registers a dedicated default-gated 30-minute timer with close cleanup', () => {
    const timer = { unref: vi.fn() } as unknown as ReturnType<typeof setInterval>;
    const interval = vi.spyOn(globalThis, 'setInterval').mockReturnValue(timer);
    const clear = vi.spyOn(globalThis, 'clearInterval').mockImplementation(() => undefined);
    let close: ((instance: FastifyInstance, done: () => void) => void) | undefined;
    const app = { addHook: (_name: string, hook: typeof close) => { close = hook; } } as unknown as FastifyInstance;
    try {
      registerSopyoDeliveryPollScheduler(app, { SOPYO_DELIVERY_POLLING_ENABLED: false } as AppEnv);
      expect(interval).not.toHaveBeenCalled();
      registerSopyoDeliveryPollScheduler(app, { SOPYO_DELIVERY_POLLING_ENABLED: true } as AppEnv);
      expect(SOPYO_DELIVERY_POLL_INTERVAL_MS).toBe(30 * 60 * 1000);
      expect(interval).toHaveBeenCalledOnce();
      expect(interval.mock.calls[0]![1]).toBe(SOPYO_DELIVERY_POLL_INTERVAL_MS);
      close?.(app, () => undefined);
      expect(clear).toHaveBeenCalledWith(timer);
    } finally {
      interval.mockRestore();
      clear.mockRestore();
    }
  });
});
