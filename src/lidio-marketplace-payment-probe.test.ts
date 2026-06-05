import { describe, expect, it, vi } from 'vitest';
import { runLidioMarketplacePaymentProbe } from '../backend/src/scripts/lidioMarketplacePaymentProbe.js';

function buildEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    LIDIO_ENABLED: 'true',
    LIDIO_BASE_URL: 'https://test.lidio.com/api',
    LIDIO_MERCHANT_CODE: 'SPORGYM',
    LIDIO_AUTHORIZATION_SCHEME: 'MxS2S',
    LIDIO_AUTHORIZATION_TOKEN: 'test-token',
    ...overrides,
  };
}

function buildLogger() {
  return {
    log: vi.fn(),
    error: vi.fn(),
  };
}

describe('Lidio marketplace payment sandbox probe', () => {
  it('exits before sending a request when the payment probe flag is not enabled', async () => {
    const fetchImpl = vi.fn();
    const logger = buildLogger();

    const result = await runLidioMarketplacePaymentProbe({
      env: buildEnv({ LIDIO_ALLOW_PAYMENT_PROBE: undefined }),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      logger,
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      endpoint: '/StartHostedPaymentProcess',
      writesPerformed: false,
    });
  });

  it('sends one hosted marketplace payment request with sandbox split data when explicitly enabled', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          result: 'Success',
          resultMessage: null,
          systemTransId: 'system-trans-id',
          orderId: 'SPGMP20260605123456',
          redirectURL: 'https://test.lidio.com/redirect/secret',
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json; charset=utf-8',
          },
        },
      ),
    );
    const logger = buildLogger();

    const result = await runLidioMarketplacePaymentProbe({
      env: buildEnv({ LIDIO_ALLOW_PAYMENT_PROBE: 'true' }),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      logger,
      now: () => new Date('2026-06-05T12:34:56.000Z'),
    });

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, request] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://test.lidio.com/api/StartHostedPaymentProcess');
    expect(request.method).toBe('POST');
    expect(request.headers).toMatchObject({
      MerchantCode: 'SPORGYM',
      Authorization: 'MxS2S test-token',
    });

    const body = JSON.parse(String(request.body));
    expect(body).toMatchObject({
      orderId: 'SPGMP20260605123456',
      totalAmount: 10,
      currency: 'TRY',
      customerInfo: {
        phone: '5555555555',
      },
      paymentInstruments: ['NewCard'],
      paymentInstrumentInfo: {
        card: {
          processType: 'sales',
          useInstallment: false,
          useLoyaltyPoints: false,
          newCard: {
            threeDSecureMode: 'Mandatory',
            useIVRForCardEntry: false,
          },
        },
      },
    });
    expect(body.paymentInstrumentInfo.card.cardInfo).toBeUndefined();
    expect(body.paymentInstrumentInfo.card.newCard.cardNumber).toBeUndefined();
    expect(body.paymentInstrumentInfo.card.newCard.cardHolderName).toBeUndefined();
    expect(body.paymentInstrumentInfo.card.newCard.lastMonth).toBeUndefined();
    expect(body.paymentInstrumentInfo.card.newCard.lastYear).toBeUndefined();
    expect(body.paymentInstrumentInfo.card.newCard.cvv).toBeUndefined();
    expect(body.basketItems).toHaveLength(1);
    expect(body.basketItems[0]).toMatchObject({
      quantity: 1,
      unitPrice: 10,
      marketplace: {
        subsellerId: 3,
        itemTotalPrice: 10,
        subsellerPayoutAmount: 8,
      },
    });

    expect(result).toMatchObject({
      endpoint: '/StartHostedPaymentProcess',
      status: 200,
      result: 'Success',
      resultMessage: null,
      orderId: 'SPGMP20260605123456',
      systemTransIdPresent: true,
      redirectURLPresent: true,
      writesPerformed: true,
      responseBody: {
        result: 'Success',
        resultMessage: null,
        systemTransId: 'system-trans-id',
        orderId: 'SPGMP20260605123456',
        redirectURL: '[redacted]',
      },
    });
  });
});
