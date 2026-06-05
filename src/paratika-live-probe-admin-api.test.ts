import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiClientPostMock = vi.hoisted(() => vi.fn());

vi.mock('./lib/api-client', () => ({
  apiClient: {
    post: apiClientPostMock,
  },
}));

const { createParatikaHostedPaymentLink } = await import('./services/real/orders');

describe('Paratika hosted payment probe admin action API', () => {
  beforeEach(() => {
    apiClientPostMock.mockReset();
  });

  it('calls the existing admin SESSIONTOKEN live probe through the authenticated API client', async () => {
    apiClientPostMock.mockResolvedValueOnce({
      ok: true,
      writesPerformed: true,
      provider: 'PARATIKA',
      mode: 'sessiontoken_live_probe',
      action: 'SESSIONTOKEN',
      responseCode: '00',
      hostedPaymentUrl: 'https://entegrasyon.paratika.com.tr/payment/session-token-value',
      externalApiCallAttempted: true,
      cardDataIncluded: false,
    });

    const result = await createParatikaHostedPaymentLink('gid://shopify/Order/7693738639697');

    expect(apiClientPostMock).toHaveBeenCalledWith(
      '/admin/probes/paratika/orders/gid%3A%2F%2Fshopify%2FOrder%2F7693738639697/sessiontoken-live-probe',
      undefined,
      { skipVendorContext: true },
    );
    expect(result).toEqual(
      expect.objectContaining({
        action: 'SESSIONTOKEN',
        hostedPaymentUrl: 'https://entegrasyon.paratika.com.tr/payment/session-token-value',
      }),
    );
  });
});
