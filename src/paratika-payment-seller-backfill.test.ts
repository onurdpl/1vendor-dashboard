import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppEnv } from '../backend/src/config/env.js';

const seedVendorPaymentSellerMappingsMock = vi.hoisted(() => vi.fn());
const buildParatikaSessionTokenPayloadPreviewForOrderMock = vi.hoisted(() => vi.fn());

vi.mock('../backend/src/modules/payments/vendor-payment-seller.service.js', () => ({
  CONFIRMED_VENDOR_PAYMENT_SELLERS: [
    {
      vendorId: 'sporjinal',
      provider: 'PARATIKA',
      externalSellerId: 'Sporjinal',
    },
    {
      vendorId: 'yalispor',
      provider: 'PARATIKA',
      externalSellerId: 'Yalispor',
    },
  ],
  seedVendorPaymentSellerMappings: seedVendorPaymentSellerMappingsMock,
}));

vi.mock('../backend/src/modules/paratika/paratika-sessiontoken-payload.service.js', () => ({
  buildParatikaSessionTokenPayloadPreviewForOrder: buildParatikaSessionTokenPayloadPreviewForOrderMock,
}));

const { registerParatikaProbeRoutes } = await import('../backend/src/modules/paratika/paratika-probe.routes.js');

function buildAppEnv(overrides: Partial<AppEnv> = {}) {
  return {
    JWT_SECRET: 'test-secret',
    JWT_EXPIRES_IN: '1h',
    PARATIKA_MARKETPLACE_MODEL: 'SELLER_COMMISSION_RATE',
    ...overrides,
  } as AppEnv;
}

function buildReply() {
  const reply = {
    statusCode: 200,
    payload: undefined as unknown,
    code: vi.fn((status: number) => {
      reply.statusCode = status;
      return reply;
    }),
    send: vi.fn((payload: unknown) => {
      reply.payload = payload;
      return payload;
    }),
  };

  return reply;
}

function registerBackfillRoute(method: 'get' | 'post' = 'post') {
  let handler:
    | ((request: { authUser?: { role?: string } }, reply: ReturnType<typeof buildReply>) => Promise<unknown>)
    | null = null;
  const captureHandler = (path: string, ...args: unknown[]) => {
    if (path === '/admin/probes/paratika/payment-seller-mappings/backfill') {
      handler = args.at(-1) as typeof handler;
    }
  };
  const app = {
    get: vi.fn(method === 'get' ? captureHandler : undefined),
    post: vi.fn(method === 'post' ? captureHandler : undefined),
  };

  registerParatikaProbeRoutes(app as never, buildAppEnv());
  return handler;
}

function registerPreviewRoute(envOverrides: Partial<AppEnv> = {}) {
  let handler:
    | ((request: { authUser?: { role?: string }; params: { orderId: string } }, reply: ReturnType<typeof buildReply>) => Promise<unknown>)
    | null = null;
  const app = {
    get: vi.fn((path: string, ...args: unknown[]) => {
      if (path === '/admin/probes/paratika/orders/:orderId/sessiontoken-payload-preview') {
        handler = args.at(-1) as typeof handler;
      }
    }),
    post: vi.fn(),
  };

  registerParatikaProbeRoutes(app as never, buildAppEnv(envOverrides));
  return handler;
}

function registerLiveProbeRoute(envOverrides: Partial<AppEnv> = {}) {
  let handler:
    | ((request: { authUser?: { role?: string }; params: { orderId: string } }, reply: ReturnType<typeof buildReply>) => Promise<unknown>)
    | null = null;
  const app = {
    get: vi.fn(),
    post: vi.fn((path: string, ...args: unknown[]) => {
      if (path === '/admin/probes/paratika/orders/:orderId/sessiontoken-live-probe') {
        handler = args.at(-1) as typeof handler;
      }
    }),
  };

  registerParatikaProbeRoutes(app as never, buildAppEnv(envOverrides));
  return handler;
}

function registerEnvCheckRoute(envOverrides: Partial<AppEnv> = {}) {
  let handler:
    | ((request: { authUser?: { role?: string } }, reply: ReturnType<typeof buildReply>) => Promise<unknown>)
    | null = null;
  const app = {
    get: vi.fn((path: string, ...args: unknown[]) => {
      if (path === '/admin/probes/paratika/env-check') {
        handler = args.at(-1) as typeof handler;
      }
    }),
    post: vi.fn(),
  };

  registerParatikaProbeRoutes(app as never, buildAppEnv(envOverrides));
  return handler;
}

function buildLiveProbeEnv(overrides: Partial<AppEnv> = {}) {
  return {
    PARATIKA_API_URL: 'https://paratika.example/sessiontoken',
    PARATIKA_MERCHANT: 'merchant-secret',
    PARATIKA_MERCHANTUSER: 'merchant-user-secret',
    PARATIKA_MERCHANTPASSWORD: 'merchant-password-secret',
    PARATIKA_RETURN_URL: 'https://onevendor-dashboard.onrender.com/payments/paratika/return',
    PARATIKA_TEST_MODE: true,
    PARATIKA_PROBE_DRY_RUN: true,
    ...overrides,
  } satisfies Partial<AppEnv>;
}

function buildSessionTokenPreviewResult() {
  return {
    ok: true,
    writesPerformed: false,
    provider: 'PARATIKA',
    model: 'seller_commission_rate_based',
    marketplaceModel: 'SELLER_COMMISSION_RATE',
    shippingDeductionPolicy: 'deferred_not_applied',
    paymentReference: 'SPORGYM-SHOPIFY-order-100',
    sessionTokenPayloadPreview: {
      ACTION: 'SESSIONTOKEN',
      AMOUNT: '60.00',
      CURRENCY: 'TRY',
      MERCHANTPAYMENTID: 'SPORGYM-SHOPIFY-order-100',
      RETURNURL: 'https://onevendor-dashboard.onrender.com/payments/paratika/return',
      CUSTOMER: 'customer-100',
      CUSTOMERNAME: 'Test Customer',
      CUSTOMEREMAIL: 'customer@example.test',
      CUSTOMERIP: '127.0.0.1',
      CUSTOMERUSERAGENT: 'Vitest',
      CUSTOMERPHONE: '+905551112233',
      ORDERITEMS: JSON.stringify([
        {
          productCode: 'variant-sporjinal-1',
          name: 'Sporjinal Shoe',
          description: 'SPJ-SKU-1',
          quantity: 1,
          amount: '60.00',
          sellerID: 'Sporjinal',
          sellerCommission: '10',
        },
      ]),
      TOTALSELLERCOMMISSION: '10',
      SESSIONTYPE: 'PAYMENTSESSION',
    },
    itemBreakdown: [],
    validationErrors: [],
    omittedCredentialFields: ['MERCHANTUSER', 'MERCHANTPASSWORD', 'MERCHANT'],
    externalApiCallAttempted: false,
    cardDataIncluded: false,
  };
}

function buildSellerPaymentSessionTokenPreviewResult() {
  const basePreview = buildSessionTokenPreviewResult();
  const basePayload = Object.fromEntries(
    Object.entries(basePreview.sessionTokenPayloadPreview).filter(([key]) => key !== 'TOTALSELLERCOMMISSION'),
  );

  return {
    ...basePreview,
    model: 'seller_payment_amount_based',
    marketplaceModel: 'SELLER_PAYMENT_AMOUNT',
    sessionTokenPayloadPreview: {
      ...basePayload,
      ORDERITEMS: JSON.stringify([
        {
          productCode: 'variant-sporjinal-1',
          name: 'Sporjinal Shoe',
          description: 'SPJ-SKU-1',
          quantity: 1,
          amount: '60.00',
          sellerID: 'Sporjinal',
          sellerPaymentAmount: '54.00',
        },
      ]),
      TOTALSELLERPAYMENTAMOUNT: '54.00',
    },
  };
}

function expectNoSecrets(value: unknown) {
  const serialized = JSON.stringify(value).toLowerCase();

  expect(serialized).not.toContain('merchantpassword');
  expect(serialized).not.toContain('merchantuser');
  expect(serialized).not.toContain('client_secret');
  expect(serialized).not.toContain('password');
  expect(serialized).not.toContain('access_token');
  expect(serialized).not.toContain('refresh_token');
}

describe('Paratika payment seller mapping backfill probe', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
  });

  it('rejects non-admin users', async () => {
    process.env.ADMIN_PROBES_ENABLED = 'true';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const handler = registerBackfillRoute();
    const reply = buildReply();

    const result = await handler?.({ authUser: { role: 'vendor' } }, reply);

    expect(reply.statusCode).toBe(403);
    expect(result).toEqual({ message: 'Forbidden' });
    expect(seedVendorPaymentSellerMappingsMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects admin users when admin probes are disabled', async () => {
    process.env.ADMIN_PROBES_ENABLED = 'false';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const handler = registerBackfillRoute();
    const reply = buildReply();

    const result = await handler?.({ authUser: { role: 'admin' } }, reply);

    expect(reply.statusCode).toBe(403);
    expect(result).toEqual({ ok: false, message: 'Admin probe endpoints are disabled.' });
    expect(seedVendorPaymentSellerMappingsMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('upserts both confirmed mappings without calling Paratika', async () => {
    process.env.ADMIN_PROBES_ENABLED = 'true';
    seedVendorPaymentSellerMappingsMock.mockResolvedValue(undefined);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const handler = registerBackfillRoute();
    const reply = buildReply();

    const result = await handler?.({ authUser: { role: 'admin' } }, reply);

    expect(reply.statusCode).toBe(200);
    expect(result).toEqual({
      ok: true,
      writesPerformed: true,
      provider: 'PARATIKA',
      upserted: [
        { vendorId: 'sporjinal', externalSellerId: 'Sporjinal', enabled: true },
        { vendorId: 'yalispor', externalSellerId: 'Yalispor', enabled: true },
      ],
    });
    expect(seedVendorPaymentSellerMappingsMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(buildParatikaSessionTokenPayloadPreviewForOrderMock).not.toHaveBeenCalled();
    expectNoSecrets(result);
  });

  it('allows the temporary GET backfill path for manual diagnostics', async () => {
    process.env.ADMIN_PROBES_ENABLED = 'true';
    seedVendorPaymentSellerMappingsMock.mockResolvedValue(undefined);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const handler = registerBackfillRoute('get');
    const reply = buildReply();

    const result = await handler?.({ authUser: { role: 'admin' } }, reply);

    expect(reply.statusCode).toBe(200);
    expect(result).toEqual({
      ok: true,
      writesPerformed: true,
      provider: 'PARATIKA',
      upserted: [
        { vendorId: 'sporjinal', externalSellerId: 'Sporjinal', enabled: true },
        { vendorId: 'yalispor', externalSellerId: 'Yalispor', enabled: true },
      ],
    });
    expect(seedVendorPaymentSellerMappingsMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expectNoSecrets(result);
  });

  it('returns the same row status on an idempotent second run', async () => {
    process.env.ADMIN_PROBES_ENABLED = 'true';
    seedVendorPaymentSellerMappingsMock.mockResolvedValue(undefined);
    const handler = registerBackfillRoute();
    const firstReply = buildReply();
    const secondReply = buildReply();

    const firstResult = await handler?.({ authUser: { role: 'admin' } }, firstReply);
    const secondResult = await handler?.({ authUser: { role: 'admin' } }, secondReply);

    expect(firstReply.statusCode).toBe(200);
    expect(secondReply.statusCode).toBe(200);
    expect(secondResult).toEqual(firstResult);
    expect(seedVendorPaymentSellerMappingsMock).toHaveBeenCalledTimes(2);
    expectNoSecrets(secondResult);
  });

  it('passes configured PARATIKA_RETURN_URL to SESSIONTOKEN preview builder', async () => {
    process.env.ADMIN_PROBES_ENABLED = 'true';
    buildParatikaSessionTokenPayloadPreviewForOrderMock.mockResolvedValue({
      ok: true,
      writesPerformed: false,
      provider: 'PARATIKA',
      model: 'seller_commission_rate_based',
      marketplaceModel: 'SELLER_COMMISSION_RATE',
      shippingDeductionPolicy: 'deferred_not_applied',
      paymentReference: 'SPORGYM-SHOPIFY-order-100',
      sessionTokenPayloadPreview: {
        RETURNURL: 'https://onevendor-dashboard.onrender.com/payments/paratika/return',
      },
      itemBreakdown: [],
      validationErrors: [],
      omittedCredentialFields: ['MERCHANTUSER', 'MERCHANTPASSWORD', 'MERCHANT'],
      externalApiCallAttempted: false,
      cardDataIncluded: false,
    });
    const handler = registerPreviewRoute({
      PARATIKA_RETURN_URL: 'https://onevendor-dashboard.onrender.com/payments/paratika/return',
    });
    const reply = buildReply();

    const result = await handler?.({ authUser: { role: 'admin' }, params: { orderId: 'order-100' } }, reply);

    expect(reply.statusCode).toBe(200);
    expect(result).toEqual(
      expect.objectContaining({
        sessionTokenPayloadPreview: expect.objectContaining({
          RETURNURL: 'https://onevendor-dashboard.onrender.com/payments/paratika/return',
        }),
      }),
    );
    expect(buildParatikaSessionTokenPayloadPreviewForOrderMock).toHaveBeenCalledWith('order-100', {
      returnUrl: 'https://onevendor-dashboard.onrender.com/payments/paratika/return',
      marketplaceModel: 'SELLER_COMMISSION_RATE',
    });
    expect(seedVendorPaymentSellerMappingsMock).not.toHaveBeenCalled();
    expect(JSON.stringify(result).toLowerCase()).not.toContain('secret');
    expect(JSON.stringify(result).toLowerCase()).not.toContain('access_token');
    expect(JSON.stringify(result).toLowerCase()).not.toContain('refresh_token');
  });

  it('rejects non-admin users for the Paratika env diagnostic', async () => {
    process.env.ADMIN_PROBES_ENABLED = 'true';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const handler = registerEnvCheckRoute(buildLiveProbeEnv());
    const reply = buildReply();

    const result = await handler?.({ authUser: { role: 'vendor' } }, reply);

    expect(reply.statusCode).toBe(403);
    expect(result).toEqual({ message: 'Forbidden' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects the Paratika env diagnostic when admin probes are disabled', async () => {
    process.env.ADMIN_PROBES_ENABLED = 'false';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const handler = registerEnvCheckRoute(buildLiveProbeEnv());
    const reply = buildReply();

    const result = await handler?.({ authUser: { role: 'admin' } }, reply);

    expect(reply.statusCode).toBe(403);
    expect(result).toEqual({ ok: false, writesPerformed: false, message: 'Admin probe endpoints are disabled.' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns safe Paratika env shape without exposing password or calling Paratika', async () => {
    process.env.ADMIN_PROBES_ENABLED = 'true';
    process.env.RENDER_GIT_COMMIT = 'abcdef1234567890';
    process.env.PARATIKA_API_URL = 'https://vpos.paratika.example/payment/api';
    process.env.PARATIKA_MERCHANT = '100000123';
    process.env.PARATIKA_MERCHANTUSER = 'onur@example.com';
    process.env.PARATIKA_MERCHANTPASSWORD = 'merchant-password-secret';
    process.env.PARATIKA_TEST_MODE = 'true';
    process.env.PARATIKA_PROBE_DRY_RUN = 'false';
    process.env.PARATIKA_PROBE_CONFIRM = 'CREATE_SESSIONTOKEN_TEST';
    process.env.PARATIKA_MARKETPLACE_MODEL = 'SELLER_COMMISSION_RATE';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const handler = registerEnvCheckRoute(
      buildLiveProbeEnv({
        PARATIKA_API_URL: 'https://vpos.paratika.example/payment/api',
        PARATIKA_MERCHANT: '100000123',
        PARATIKA_MERCHANTUSER: 'onur@example.com',
        PARATIKA_MERCHANTPASSWORD: 'merchant-password-secret',
        PARATIKA_PROBE_DRY_RUN: false,
        PARATIKA_PROBE_CONFIRM: 'CREATE_SESSIONTOKEN_TEST',
      }),
    );
    const reply = buildReply();

    const result = await handler?.({ authUser: { role: 'admin' } }, reply);

    expect(reply.statusCode).toBe(200);
    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        writesPerformed: false,
        provider: 'PARATIKA',
        externalApiCallAttempted: false,
        envPresence: {
          PARATIKA_API_URL: true,
          PARATIKA_MERCHANT: true,
          PARATIKA_MERCHANTUSER: true,
          PARATIKA_MERCHANTPASSWORD: true,
          PARATIKA_TEST_MODE: true,
          PARATIKA_PROBE_DRY_RUN: true,
          PARATIKA_PROBE_CONFIRM: true,
          PARATIKA_MARKETPLACE_MODEL: true,
        },
        apiUrlHost: 'vpos.paratika.example',
        merchant: '100000123',
        maskedMerchantUser: 'o***@example.com',
        testMode: true,
        dryRun: false,
        confirmPresent: true,
        marketplaceModel: 'SELLER_COMMISSION_RATE',
        runtime: expect.objectContaining({
          gitCommit: 'abcdef123456',
          nodeEnv: undefined,
          uptimeSeconds: expect.any(Number),
        }),
      }),
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('merchant-password-secret');
    expect(JSON.stringify(result)).not.toContain('onur@example.com');
    expect(JSON.stringify(result)).not.toContain('MERCHANTPASSWORD=');
  });

  it('rejects non-admin users for the live SESSIONTOKEN probe', async () => {
    process.env.ADMIN_PROBES_ENABLED = 'true';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const handler = registerLiveProbeRoute(buildLiveProbeEnv());
    const reply = buildReply();

    const result = await handler?.({ authUser: { role: 'vendor' }, params: { orderId: 'order-100' } }, reply);

    expect(reply.statusCode).toBe(403);
    expect(result).toEqual({ message: 'Forbidden' });
    expect(buildParatikaSessionTokenPayloadPreviewForOrderMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects the live SESSIONTOKEN probe when admin probes are disabled', async () => {
    process.env.ADMIN_PROBES_ENABLED = 'false';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const handler = registerLiveProbeRoute(buildLiveProbeEnv());
    const reply = buildReply();

    const result = await handler?.({ authUser: { role: 'admin' }, params: { orderId: 'order-100' } }, reply);

    expect(reply.statusCode).toBe(403);
    expect(result).toEqual({ ok: false, writesPerformed: false, message: 'Admin probe endpoints are disabled.' });
    expect(buildParatikaSessionTokenPayloadPreviewForOrderMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects the live SESSIONTOKEN probe when required env values are missing', async () => {
    process.env.ADMIN_PROBES_ENABLED = 'true';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const handler = registerLiveProbeRoute({
      PARATIKA_TEST_MODE: true,
      PARATIKA_PROBE_DRY_RUN: true,
    });
    const reply = buildReply();

    const result = await handler?.({ authUser: { role: 'admin' }, params: { orderId: 'order-100' } }, reply);

    expect(reply.statusCode).toBe(422);
    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        writesPerformed: false,
        provider: 'PARATIKA',
        externalApiCallAttempted: false,
        missingEnv: expect.arrayContaining(['PARATIKA_API_URL', 'PARATIKA_MERCHANT', 'PARATIKA_RETURN_URL']),
      }),
    );
    expect(buildParatikaSessionTokenPayloadPreviewForOrderMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps the live SESSIONTOKEN probe dry-run from calling Paratika', async () => {
    process.env.ADMIN_PROBES_ENABLED = 'true';
    buildParatikaSessionTokenPayloadPreviewForOrderMock.mockResolvedValue(buildSessionTokenPreviewResult());
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const handler = registerLiveProbeRoute(buildLiveProbeEnv());
    const reply = buildReply();

    const result = await handler?.({ authUser: { role: 'admin' }, params: { orderId: 'order-100' } }, reply);

    expect(reply.statusCode).toBe(200);
    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        writesPerformed: false,
        provider: 'PARATIKA',
        mode: 'sessiontoken_live_probe_dry_run',
        action: 'SESSIONTOKEN',
        model: 'seller_commission_rate_based',
        marketplaceModel: 'SELLER_COMMISSION_RATE',
        externalApiCallAttempted: false,
        credentialValuesOmitted: true,
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        payloadKeys: expect.arrayContaining(['ACTION', 'ORDERITEMS', 'TOTALSELLERCOMMISSION', 'RETURNURL']),
        orderItemsPreview: [
          expect.objectContaining({
            productCode: 'variant-sporjinal-1',
            sellerID: 'Sporjinal',
            sellerCommission: '10',
          }),
        ],
      }),
    );
    expect(JSON.stringify(result)).not.toContain('MERCHANTUSER');
    expect(JSON.stringify(result)).not.toContain('MERCHANTPASSWORD');
    expect(JSON.stringify(result)).not.toContain('merchant-password-secret');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('passes explicit seller payment marketplace model to SESSIONTOKEN live probe preview', async () => {
    process.env.ADMIN_PROBES_ENABLED = 'true';
    buildParatikaSessionTokenPayloadPreviewForOrderMock.mockResolvedValue(buildSellerPaymentSessionTokenPreviewResult());
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const handler = registerLiveProbeRoute(
      buildLiveProbeEnv({
        PARATIKA_MARKETPLACE_MODEL: 'SELLER_PAYMENT_AMOUNT',
      }),
    );
    const reply = buildReply();

    const result = await handler?.({ authUser: { role: 'admin' }, params: { orderId: 'order-100' } }, reply);

    expect(reply.statusCode).toBe(200);
    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        writesPerformed: false,
        model: 'seller_payment_amount_based',
        marketplaceModel: 'SELLER_PAYMENT_AMOUNT',
      }),
    );
    expect(buildParatikaSessionTokenPayloadPreviewForOrderMock).toHaveBeenCalledWith('order-100', {
      returnUrl: 'https://onevendor-dashboard.onrender.com/payments/paratika/return',
      marketplaceModel: 'SELLER_PAYMENT_AMOUNT',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requires explicit confirmation before live SESSIONTOKEN requests', async () => {
    process.env.ADMIN_PROBES_ENABLED = 'true';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const handler = registerLiveProbeRoute(
      buildLiveProbeEnv({
        PARATIKA_PROBE_DRY_RUN: false,
        PARATIKA_PROBE_CONFIRM: undefined,
      }),
    );
    const reply = buildReply();

    const result = await handler?.({ authUser: { role: 'admin' }, params: { orderId: 'order-100' } }, reply);

    expect(reply.statusCode).toBe(422);
    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        writesPerformed: false,
        validationErrors: ['PARATIKA_PROBE_CONFIRM=CREATE_SESSIONTOKEN_TEST is required for a live SESSIONTOKEN probe.'],
        externalApiCallAttempted: false,
      }),
    );
    expect(buildParatikaSessionTokenPayloadPreviewForOrderMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts a form-encoded SESSIONTOKEN payload and sanitizes the response in live mode', async () => {
    process.env.ADMIN_PROBES_ENABLED = 'true';
    buildParatikaSessionTokenPayloadPreviewForOrderMock.mockResolvedValue(buildSessionTokenPreviewResult());
    const sessionToken = 'secret-session-token-value';
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          responseCode: '00',
          responseMsg: 'Approved',
          sessionToken,
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const handler = registerLiveProbeRoute(
      buildLiveProbeEnv({
        PARATIKA_PROBE_DRY_RUN: false,
        PARATIKA_PROBE_CONFIRM: 'CREATE_SESSIONTOKEN_TEST',
      }),
    );
    const reply = buildReply();

    const result = await handler?.({ authUser: { role: 'admin' }, params: { orderId: 'order-100' } }, reply);

    expect(reply.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://paratika.example/sessiontoken');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/x-www-form-urlencoded' });
    expect(init.body).toBeInstanceOf(URLSearchParams);

    const body = init.body as URLSearchParams;
    expect(body.get('ACTION')).toBe('SESSIONTOKEN');
    expect(body.get('MERCHANT')).toBe('merchant-secret');
    expect(body.get('MERCHANTUSER')).toBe('merchant-user-secret');
    expect(body.get('MERCHANTPASSWORD')).toBe('merchant-password-secret');
    expect(body.get('ORDERITEMS')).toContain('"sellerID":"Sporjinal"');
    expect(body.get('ORDERITEMS')).toContain('"sellerCommission":"10"');
    expect(body.get('ORDERITEMS')).not.toContain('sellerPaymentAmount');
    expect(body.has('CARDNUMBER')).toBe(false);
    expect(body.has('CVV')).toBe(false);
    expect(body.get('ACTION')).not.toBe('SALE');
    expect(body.get('ACTION')).not.toBe('PREAUTH');
    expect(body.get('ACTION')).not.toBe('REFUND');
    expect(body.get('ACTION')).not.toBe('VOID');

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        writesPerformed: true,
        provider: 'PARATIKA',
        action: 'SESSIONTOKEN',
        model: 'seller_commission_rate_based',
        marketplaceModel: 'SELLER_COMMISSION_RATE',
        httpStatus: 200,
        responseCode: '00',
        responseMsg: 'Approved',
        sessionTokenReceived: true,
        sessionTokenLength: sessionToken.length,
        rawBodyKeys: ['responseCode', 'responseMsg', 'sessionToken'],
        externalApiCallAttempted: true,
        cardDataIncluded: false,
      }),
    );
    const serializedResult = JSON.stringify(result);
    expect(serializedResult).not.toContain(sessionToken);
    expect(serializedResult).not.toContain('merchant-password-secret');
    expect(serializedResult).not.toContain('merchant-user-secret');
  });

  it('returns safe Paratika error details without exposing tokens or credentials', async () => {
    process.env.ADMIN_PROBES_ENABLED = 'true';
    buildParatikaSessionTokenPayloadPreviewForOrderMock.mockResolvedValue(buildSessionTokenPreviewResult());
    const sessionToken = 'secret-session-token-value';
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          responseCode: '99',
          responseMsg: 'Declined',
          errorCode: 'INVALID_REQUEST',
          errorMsg: `Invalid request. sessionToken=${sessionToken} merchantPassword=merchant-password-secret`,
          violatorParam: 'ORDERITEMS',
          sessionToken,
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const handler = registerLiveProbeRoute(
      buildLiveProbeEnv({
        PARATIKA_PROBE_DRY_RUN: false,
        PARATIKA_PROBE_CONFIRM: 'CREATE_SESSIONTOKEN_TEST',
      }),
    );
    const reply = buildReply();

    const result = await handler?.({ authUser: { role: 'admin' }, params: { orderId: 'order-100' } }, reply);

    expect(reply.statusCode).toBe(200);
    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        writesPerformed: true,
        responseCode: '99',
        responseMsg: 'Declined',
        errorCode: 'INVALID_REQUEST',
        errorMsg: 'Invalid request. sessionToken=[redacted] merchantPassword=[redacted]',
        violatorParam: 'ORDERITEMS',
        sessionTokenReceived: true,
        sessionTokenLength: sessionToken.length,
        rawBodyKeys: ['responseCode', 'responseMsg', 'errorCode', 'errorMsg', 'violatorParam', 'sessionToken'],
      }),
    );

    const serializedResult = JSON.stringify(result);
    expect(serializedResult).not.toContain(sessionToken);
    expect(serializedResult).not.toContain('merchant-password-secret');
    expect(serializedResult).not.toContain('merchant-user-secret');
    expect(serializedResult).not.toContain('MERCHANTPASSWORD');
    expect(serializedResult).not.toContain('MERCHANTUSER');
  });
});
