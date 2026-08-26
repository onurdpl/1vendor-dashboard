import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchSellerInfoWithRetry } from '../backend/src/modules/shopify/seller-info-retry.service.js';
import { createShopifyAdminService } from '../backend/src/modules/shopify/shopify-admin.service.js';

describe('orders/create seller_info retry and abort support', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('preserves first-attempt success', async () => {
    const fetchSellerInfo = vi.fn().mockResolvedValue({
      sellerInfo: { 'SKU-1': 'sporjinal' },
      source: 'shopify_admin',
    });

    await expect(fetchSellerInfoWithRetry({
      orderId: '2001',
      fetchSellerInfo,
      delayMs: 2_000,
    })).resolves.toMatchObject({ ok: true, attempts: 1 });
    expect(fetchSellerInfo).toHaveBeenCalledTimes(1);
  });

  it('preserves second-attempt success after the two-second delay', async () => {
    const fetchSellerInfo = vi.fn()
      .mockResolvedValueOnce({ sellerInfo: null, source: 'shopify_admin' })
      .mockResolvedValueOnce({ sellerInfo: { 'SKU-1': 'sporjinal' }, source: 'shopify_admin' });
    const result = fetchSellerInfoWithRetry({ orderId: '2001', fetchSellerInfo, delayMs: 2_000 });

    await vi.advanceTimersByTimeAsync(2_000);

    await expect(result).resolves.toMatchObject({ ok: true, attempts: 2 });
    expect(fetchSellerInfo).toHaveBeenCalledTimes(2);
  });

  it('preserves third-attempt success', async () => {
    const fetchSellerInfo = vi.fn()
      .mockResolvedValueOnce({ sellerInfo: null, source: 'shopify_admin' })
      .mockResolvedValueOnce({ sellerInfo: null, source: 'shopify_admin' })
      .mockResolvedValueOnce({ sellerInfo: { 'SKU-1': 'sporjinal' }, source: 'shopify_admin' });
    const result = fetchSellerInfoWithRetry({ orderId: '2001', fetchSellerInfo, delayMs: 2_000 });

    await vi.advanceTimersByTimeAsync(4_000);

    await expect(result).resolves.toMatchObject({ ok: true, attempts: 3 });
    expect(fetchSellerInfo).toHaveBeenCalledTimes(3);
  });

  it('preserves seller_info exhaustion classification after three attempts', async () => {
    const fetchSellerInfo = vi.fn().mockResolvedValue({ sellerInfo: null, source: 'shopify_admin' });
    const result = fetchSellerInfoWithRetry({ orderId: '2001', fetchSellerInfo, delayMs: 2_000 });

    await vi.advanceTimersByTimeAsync(4_000);

    await expect(result).resolves.toEqual({
      ok: false,
      error: 'Shopify seller_info metafield was missing or empty after retry attempts.',
      attempts: 3,
      source: 'shopify_admin',
    });
  });

  it('aborts retry sleep promptly and performs no further seller attempts', async () => {
    const controller = new AbortController();
    const fetchSellerInfo = vi.fn().mockResolvedValue({ sellerInfo: null, source: 'shopify_admin' });
    const result = fetchSellerInfoWithRetry({
      orderId: '2001',
      fetchSellerInfo,
      delayMs: 2_000,
      signal: controller.signal,
    });
    await Promise.resolve();

    controller.abort();

    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchSellerInfo).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('passes the optional signal to seller, image, and tax Shopify Admin requests', async () => {
    vi.useRealTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: { order: { metafield: { value: '{"SKU-1":"sporjinal"}' } } },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: { order: { id: 'gid://shopify/Order/2001', lineItems: { edges: [] } } },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: {
          order: {
            id: 'gid://shopify/Order/2001',
            taxesIncluded: true,
            currentTotalTaxSet: null,
            currentTaxLines: [],
            lineItems: { edges: [] },
          },
        },
      }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const service = createShopifyAdminService({
      SHOPIFY_SHOP_DOMAIN: 'sporgym.myshopify.com',
      SHOPIFY_ADMIN_ACCESS_TOKEN: 'test-token',
      SHOPIFY_API_VERSION: '2026-01',
    } as never);
    const controller = new AbortController();

    await service.fetchOrderSellerInfo('2001', { signal: controller.signal });
    await service.fetchOrderLineItemImages('2001', { signal: controller.signal });
    await service.fetchOrderTaxSnapshot('2001', { signal: controller.signal });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const call of fetchMock.mock.calls) {
      expect(call[1]).toMatchObject({ signal: controller.signal });
    }
  });
});
