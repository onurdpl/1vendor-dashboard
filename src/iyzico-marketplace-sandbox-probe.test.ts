import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { AppEnv } from '../backend/src/config/env.js';
import {
  createIyzicoAuthorizationHeader,
  IYZICO_MARKETPLACE_ENDPOINTS,
  IYZICO_SANDBOX_BASE_URL,
  IyzicoMarketplaceClient,
  validateIyzicoSandboxConfig,
} from '../backend/src/modules/iyzico/iyzico-marketplace.client.js';
import { registerIyzicoMarketplaceDiagnosticsRoutes } from '../backend/src/modules/iyzico/iyzico-marketplace.routes.js';

const SECRET_VALUES = {
  apiKey: 'sandbox-api-key-secret',
  secretKey: 'sandbox-secret-key-value',
  authorizationFragment: 'IYZWSv2 secret-auth-fragment',
  cardNumber: '4111111111111111',
  cvc: '123',
  identityNumber: '11111111111',
};

function buildEnv(overrides: Partial<AppEnv> = {}): AppEnv {
  return {
    NODE_ENV: 'test',
    PORT: 4000,
    DATABASE_URL: undefined,
    CORS_ORIGIN: [],
    JWT_SECRET: 'unused',
    JWT_EXPIRES_IN: '12h',
    SHOPIFY_WEBHOOK_SECRET: 'unused',
    SHOPIFY_API_VERSION: '2026-01',
    SHOPIFY_SELLER_INFO_RETRY_DELAY_MS: 25,
    SCHEDULED_RECONCILIATION_ENABLED: false,
    SCHEDULED_RECONCILIATION_EXECUTE_DUE: false,
    SCHEDULED_RECONCILIATION_INTERVAL_MS: 1800000,
    SCHEDULED_RECONCILIATION_COOLDOWN_MS: 1800000,
    SCHEDULED_RECONCILIATION_CANDIDATE_LIMIT: 25,
    EMAIL_NOTIFICATIONS_ENABLED: false,
    EMAIL_PROVIDER: 'noop',
    EMAIL_ADMIN_RECIPIENTS: [],
    INVOICE_EXECUTION_ENABLED: false,
    INVOICE_PROVIDER: 'bizimhesap',
    BIZIMHESAP_ENABLED: false,
    SHIPPING_EXECUTION_ENABLED: false,
    SHIPPING_SANDBOX_MODE: false,
    SHIPPING_PROVIDER: 'hepsijet',
    KARGO_ENTEGRATOR_ENABLED: false,
    KARGO_ENTEGRATOR_WEBHOOK_INGEST_ENABLED: false,
    TRY_OTO_ENABLED: false,
    TRY_OTO_SANDBOX_MODE: false,
    TRY_OTO_WEBHOOK_INGEST_ENABLED: false,
    IYZICO_SANDBOX_API_KEY: SECRET_VALUES.apiKey,
    IYZICO_SANDBOX_SECRET_KEY: SECRET_VALUES.secretKey,
    IYZICO_SANDBOX_BASE_URL: IYZICO_SANDBOX_BASE_URL,
    ...overrides,
  };
}

function buildReply() {
  return {
    code: vi.fn((status: number) => ({
      send: vi.fn((body: unknown) => ({ status, body })),
    })),
  };
}

function registerRoute(env: AppEnv, fetchImpl: typeof fetch) {
  const posts = new Map<
    string,
    (
      request: { authUser?: { role?: string }; body?: Record<string, unknown> },
      reply: ReturnType<typeof buildReply>,
    ) => unknown
  >();
  const app = {
    post: vi.fn((path: string, ...args: unknown[]) => {
      const handler = args.at(-1) as (
        request: { authUser?: { role?: string }; body?: Record<string, unknown> },
        reply: ReturnType<typeof buildReply>,
      ) => unknown;
      posts.set(path, handler);
    }),
  };

  registerIyzicoMarketplaceDiagnosticsRoutes(app as never, env, { fetchImpl });
  return posts;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function expectNoSecrets(value: unknown) {
  const text = JSON.stringify(value);
  for (const secret of Object.values(SECRET_VALUES)) {
    expect(text).not.toContain(secret);
  }
}

describe('iyzico marketplace sandbox probe', () => {
  it('builds the IYZWSv2 authorization header from raw body, path, and random key', () => {
    const rawBody = '{"locale":"en","paymentId":"payment-1"}';
    const randomKey = 'random-key-1';
    const header = createIyzicoAuthorizationHeader({
      apiKey: SECRET_VALUES.apiKey,
      secretKey: SECRET_VALUES.secretKey,
      randomKey,
      uriPath: IYZICO_MARKETPLACE_ENDPOINTS.retrievePaymentDetail,
      rawBody,
    });

    const expectedSignature = createHmac('sha256', SECRET_VALUES.secretKey)
      .update(`${randomKey}${IYZICO_MARKETPLACE_ENDPOINTS.retrievePaymentDetail}${rawBody}`)
      .digest('hex');
    const decoded = Buffer.from(header.replace('IYZWSv2 ', ''), 'base64').toString('utf8');

    expect(header).toMatch(/^IYZWSv2 /);
    expect(decoded).toBe(`apiKey:${SECRET_VALUES.apiKey}&randomKey:${randomKey}&signature:${expectedSignature}`);
  });

  it('dispatches all marketplace client methods to the documented sandbox paths', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return jsonResponse({ status: 'success' });
    }) as unknown as typeof fetch;
    const client = new IyzicoMarketplaceClient({
      apiKey: SECRET_VALUES.apiKey,
      secretKey: SECRET_VALUES.secretKey,
      baseUrl: IYZICO_SANDBOX_BASE_URL,
      fetchImpl,
      randomKeyGenerator: () => 'fixed-random-key',
    });

    await client.createSubMerchant({ locale: 'en', subMerchantExternalId: 'vendor-1' });
    await client.retrieveSubMerchant('vendor-1');
    await client.initializeMarketplaceCheckoutForm({
      locale: 'en',
      basketItems: [
        {
          id: 'item-1',
          price: '10',
          name: 'Test item',
          category1: 'Shoes',
          itemType: 'PHYSICAL',
          subMerchantKey: 'submerchant-key',
          subMerchantPrice: '8',
        },
      ],
    });
    await client.retrieveCheckoutFormResult('checkout-token', 'conversation-1');
    await client.retrievePaymentDetail('payment-1', 'payment-conversation-1');
    await client.approvePaymentItem('tx-1');
    await client.disapprovePaymentItem('tx-1');
    await client.updatePaymentItem('tx-1', 'submerchant-key', '8');
    await client.refundPaymentTransaction('tx-1', '2', 'TRY');
    await client.cancelPayment('payment-1');

    expect(calls.map((call) => [call.init.method, call.url])).toEqual([
      ['POST', `${IYZICO_SANDBOX_BASE_URL}${IYZICO_MARKETPLACE_ENDPOINTS.createSubMerchant}`],
      ['POST', `${IYZICO_SANDBOX_BASE_URL}${IYZICO_MARKETPLACE_ENDPOINTS.retrieveSubMerchant}`],
      ['POST', `${IYZICO_SANDBOX_BASE_URL}${IYZICO_MARKETPLACE_ENDPOINTS.initializeCheckoutForm}`],
      ['POST', `${IYZICO_SANDBOX_BASE_URL}${IYZICO_MARKETPLACE_ENDPOINTS.retrieveCheckoutFormResult}`],
      ['POST', `${IYZICO_SANDBOX_BASE_URL}${IYZICO_MARKETPLACE_ENDPOINTS.retrievePaymentDetail}`],
      ['POST', `${IYZICO_SANDBOX_BASE_URL}${IYZICO_MARKETPLACE_ENDPOINTS.approvePaymentItem}`],
      ['POST', `${IYZICO_SANDBOX_BASE_URL}${IYZICO_MARKETPLACE_ENDPOINTS.disapprovePaymentItem}`],
      ['PUT', `${IYZICO_SANDBOX_BASE_URL}${IYZICO_MARKETPLACE_ENDPOINTS.updatePaymentItem}`],
      ['POST', `${IYZICO_SANDBOX_BASE_URL}${IYZICO_MARKETPLACE_ENDPOINTS.refundPaymentTransaction}`],
      ['POST', `${IYZICO_SANDBOX_BASE_URL}${IYZICO_MARKETPLACE_ENDPOINTS.cancelPayment}`],
    ]);
    expect(calls.every((call) => typeof call.init.headers === 'object')).toBe(true);
    expect(calls.every((call) => String((call.init.headers as Record<string, string>).Authorization).startsWith('IYZWSv2 '))).toBe(true);
  });

  it('requires admin access before sandbox checkout-form diagnostics execute', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const routes = registerRoute(buildEnv(), fetchImpl);
    const handler = routes.get('/admin/diagnostics/iyzico-marketplace/checkout-form');

    const result = await handler?.(
      {
        authUser: { role: 'vendor' },
        body: { action: 'retrieve-result', token: 'token-1', conversationId: 'conversation-1' },
      },
      buildReply(),
    );

    expect(result).toMatchObject({ status: 403, body: { message: 'Forbidden' } });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects non-sandbox base URLs before any provider call', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const routes = registerRoute(buildEnv({ IYZICO_SANDBOX_BASE_URL: 'https://api.iyzipay.com' }), fetchImpl);
    const handler = routes.get('/admin/diagnostics/iyzico-marketplace/cancel');

    const result = await handler?.({ authUser: { role: 'admin' }, body: { paymentId: 'payment-1' } }, buildReply());

    expect(result).toMatchObject({
      status: 422,
      body: {
        ok: false,
        provider: 'iyzico',
        sandbox: true,
        diagnostics: {
          sandboxBaseUrlValid: false,
          expectedBaseUrl: IYZICO_SANDBOX_BASE_URL,
        },
      },
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('forwards marketplace basket item fields and returns sanitized diagnostics', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return jsonResponse({
        status: 'success',
        token: 'checkout-token',
        paymentPageUrl: 'https://sandbox-api.iyzipay.com/checkoutform/mock-token',
        checkoutFormContent: `<script>${SECRET_VALUES.identityNumber}${SECRET_VALUES.authorizationFragment}</script>`,
        identityNumber: SECRET_VALUES.identityNumber,
        cardNumber: SECRET_VALUES.cardNumber,
        cvc: SECRET_VALUES.cvc,
      });
    }) as unknown as typeof fetch;
    const routes = registerRoute(buildEnv(), fetchImpl);
    const handler = routes.get('/admin/diagnostics/iyzico-marketplace/checkout-form');

    const result = await handler?.(
      {
        authUser: { role: 'admin' },
        body: {
          action: 'initialize',
          payload: {
            locale: 'en',
            conversationId: 'conversation-1',
            price: '10',
            paidPrice: '10',
            currency: 'TRY',
            callbackUrl: 'https://example.invalid/iyzico-callback',
            buyer: {
              id: 'buyer-1',
              name: 'Buyer',
              surname: 'Sandbox',
              identityNumber: SECRET_VALUES.identityNumber,
              email: 'buyer@example.invalid',
              gsmNumber: '+905350000000',
              registrationAddress: 'Sandbox address',
              city: 'Istanbul',
              country: 'Turkey',
              ip: '127.0.0.1',
            },
            shippingAddress: {
              address: 'Sandbox shipping address',
              contactName: 'Buyer Sandbox',
              city: 'Istanbul',
              country: 'Turkey',
            },
            billingAddress: {
              address: 'Sandbox billing address',
              contactName: 'Buyer Sandbox',
              city: 'Istanbul',
              country: 'Turkey',
            },
            basketItems: [
              {
                id: 'line-1',
                price: '10',
                name: 'Sandbox product',
                category1: 'Shoes',
                category2: 'Sneakers',
                itemType: 'PHYSICAL',
                subMerchantKey: 'sandbox-submerchant-key',
                subMerchantPrice: '8',
              },
            ],
          },
        },
      },
      buildReply(),
    );

    expect(result).toMatchObject({
      status: 200,
      body: {
        ok: true,
        provider: 'iyzico',
        sandbox: true,
        productionPaymentFlowChanged: false,
        shopifyCheckoutIntegration: false,
        endpointPath: IYZICO_MARKETPLACE_ENDPOINTS.initializeCheckoutForm,
        body: {
          checkoutFormContent: '[omitted-checkout-form-content]',
          identityNumber: '[redacted]',
          cardNumber: '[redacted]',
          cvc: '[redacted]',
        },
      },
    });
    expect(calls).toHaveLength(1);
    expect(JSON.parse(String(calls[0]?.init.body))).toMatchObject({
      basketItems: [
        {
          id: 'line-1',
          category2: 'Sneakers',
          subMerchantKey: 'sandbox-submerchant-key',
          subMerchantPrice: '8',
        },
      ],
    });
    expectNoSecrets(result);
  });

  it('reports missing sandbox env vars by name only', () => {
    const validation = validateIyzicoSandboxConfig(
      buildEnv({
        IYZICO_SANDBOX_API_KEY: undefined,
        IYZICO_SANDBOX_SECRET_KEY: undefined,
        IYZICO_SANDBOX_BASE_URL: undefined,
      }),
    );

    expect(validation).toMatchObject({
      ok: false,
      statusCode: 422,
      diagnostics: {
        missing: ['IYZICO_SANDBOX_API_KEY', 'IYZICO_SANDBOX_SECRET_KEY', 'IYZICO_SANDBOX_BASE_URL'],
      },
    });
    expectNoSecrets(validation);
  });
});
