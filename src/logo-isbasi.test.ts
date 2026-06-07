import { beforeEach, describe, expect, it, vi } from 'vitest';

const getVendorBillingProfileMock = vi.hoisted(() => vi.fn());

vi.mock('../backend/src/modules/auth/auth.service.js', () => ({
  createAuthService: vi.fn(() => ({})),
}));

vi.mock('../backend/src/modules/auth/auth.middleware.js', () => ({
  createAuthMiddleware: vi.fn(() => ({
    authenticateRequest: vi.fn(),
  })),
}));

vi.mock('../backend/src/modules/vendors/vendor-billing-profile.service.js', async () => {
  const actual = await vi.importActual<typeof import('../backend/src/modules/vendors/vendor-billing-profile.service.js')>(
    '../backend/src/modules/vendors/vendor-billing-profile.service.js',
  );
  return {
    ...actual,
    getVendorBillingProfile: getVendorBillingProfileMock,
  };
});

const {
  LogoIsbasiClient,
  extractSessionFromLoginResponse,
  sanitizeLoginResponse,
} = await import('../backend/src/modules/logo-isbasi/logo-isbasi.client.js');
const {
  buildLogoIsbasiCommissionInvoicePreview,
  sanitizeLogoIsbasiInvoicePreviewPayload,
} = await import('../backend/src/modules/logo-isbasi/logo-isbasi-commission-preview.js');
const { registerLogoIsbasiRoutes } = await import('../backend/src/modules/logo-isbasi/logo-isbasi.routes.js');

const vendorBillingProfile = {
  id: 'billing-sporjinal',
  vendorId: 'sporjinal',
  legalCompanyName: 'Sporjinal Spor Malzemeleri A.S.',
  taxNumber: '6490512763',
  taxOffice: 'Kadikoy',
  billingAddress: 'Billing address 1',
  billingCity: 'Istanbul',
  billingDistrict: 'Atasehir',
  iban: null,
  authorizedPerson: 'Authorized User',
  billingEmail: 'billing@sporjinal.test',
  billingPhone: '+905551112233',
  legalEntityType: 'limited_company',
  logoIsbasiCustomerCode: 'LOGO-CUSTOMER-1',
  logoIsbasiCustomerId: 'LOGO-ID-1',
  logoIsbasiEinvoiceEligible: true,
  logoIsbasiLastCheckedAt: '2026-06-07T10:00:00.000Z',
  createdAt: '2026-06-07T10:00:00.000Z',
  updatedAt: '2026-06-07T10:00:00.000Z',
};

function createReply() {
  const reply = {
    statusCode: 200,
    payload: undefined as unknown,
    code: vi.fn((status: number) => {
      reply.statusCode = status;
      return {
        send: vi.fn((body: unknown) => {
          reply.payload = body;
          return body;
        }),
      };
    }),
  };
  return reply;
}

type RouteHandler = (
  request: {
    authUser?: { role?: string };
    params?: Record<string, string>;
    body?: unknown;
  },
  reply: ReturnType<typeof createReply>,
) => unknown;

function createRegisteredRoutes(envOverrides: Record<string, unknown> = {}) {
  const posts = new Map<string, RouteHandler>();
  const app = {
    post: vi.fn((path: string, _options: unknown, handler: RouteHandler) => {
      posts.set(path, handler);
    }),
  };

  registerLogoIsbasiRoutes(app as never, {
    LOGO_ISBASI_BASE_URL: 'https://soho-isbasi-mwv2-test.logo-paas.com',
    LOGO_ISBASI_API_KEY: 'api-key-secret',
    LOGO_ISBASI_USERNAME: 'integration-user@example.test',
    LOGO_ISBASI_PASSWORD: 'password-secret',
    ...envOverrides,
  } as never);

  return { posts };
}

describe('Logo İşbaşı client and commission invoice preview', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    process.env.ADMIN_PROBES_ENABLED = 'true';
    getVendorBillingProfileMock.mockResolvedValue(vendorBillingProfile);
  });

  it('sends the documented integration login request shape', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: { accessToken: 'abcdef123456', tenantId: 'tenant-1' } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    const client = new LogoIsbasiClient({
      baseUrl: 'https://soho-isbasi-mwv2-test.logo-paas.com/',
      apiKey: 'api-key-secret',
      username: 'integration-user@example.test',
      password: 'password-secret',
      fetchImpl: fetchMock as never,
    });

    await client.login();

    expect(fetchMock).toHaveBeenCalledWith(
      'https://soho-isbasi-mwv2-test.logo-paas.com/api/v1.0/user/integrationLogin',
      expect.objectContaining({
        method: 'POST',
        headers: {
          apiKey: 'api-key-secret',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: 'integration-user@example.test',
          password: 'password-secret',
        }),
      }),
    );
  });

  it('returns a controlled missing env response from the login probe', async () => {
    const { posts } = createRegisteredRoutes({ LOGO_ISBASI_API_KEY: undefined });
    const reply = createReply();

    const result = await posts.get('/admin/probes/logo-isbasi/login')?.(
      { authUser: { role: 'admin' } },
      reply,
    );

    expect(reply.statusCode).toBe(422);
    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        missingEnv: ['LOGO_ISBASI_API_KEY'],
        writesPerformed: false,
        externalApiCallAttempted: false,
      }),
    );
    expect(JSON.stringify(result)).not.toContain('password-secret');
    expect(JSON.stringify(result)).not.toContain('api-key-secret');
  });

  it('returns a controlled invalid base URL response from the login probe', async () => {
    const { posts } = createRegisteredRoutes({ LOGO_ISBASI_BASE_URL: 'not a url' });
    const reply = createReply();

    const result = await posts.get('/admin/probes/logo-isbasi/login')?.(
      { authUser: { role: 'admin' } },
      reply,
    );

    expect(reply.statusCode).toBe(422);
    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        errorCode: 'LOGO_ISBASI_BASE_URL_INVALID',
        message: 'LOGO_ISBASI_BASE_URL must be a valid URL.',
        missingEnv: ['LOGO_ISBASI_BASE_URL'],
      }),
    );
  });

  it('returns sanitized Logo API non-2xx response details', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ code: '401', message: 'Invalid credentials password=secret-password' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const { posts } = createRegisteredRoutes();
    const reply = createReply();

    const result = await posts.get('/admin/probes/logo-isbasi/login')?.(
      { authUser: { role: 'admin' } },
      reply,
    );

    expect(reply.statusCode).toBe(502);
    expect(fetchMock).toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        errorCode: 'LOGO_ISBASI_UPSTREAM_NON_2XX',
        message: 'Logo İşbaşı login request failed.',
        httpStatus: 401,
        login: expect.objectContaining({
          code: '401',
          message: 'Invalid credentials password=[redacted]',
          accessTokenPresent: false,
          tenantIdPresent: false,
        }),
      }),
    );
    expect(JSON.stringify(result)).not.toContain('secret-password');
  });

  it('returns controlled JSON parse failure diagnostics', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('not json', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      }),
    );
    const { posts } = createRegisteredRoutes();
    const reply = createReply();

    const result = await posts.get('/admin/probes/logo-isbasi/login')?.(
      { authUser: { role: 'admin' } },
      reply,
    );

    expect(reply.statusCode).toBe(422);
    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        errorCode: 'LOGO_ISBASI_JSON_PARSE_FAILED',
        message: 'Logo İşbaşı login returned a non-JSON response.',
        httpStatus: 200,
      }),
    );
  });

  it('returns controlled missing session field diagnostics', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { accessToken: 'abcdef1234567890' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const { posts } = createRegisteredRoutes();
    const reply = createReply();

    const result = await posts.get('/admin/probes/logo-isbasi/login')?.(
      { authUser: { role: 'admin' } },
      reply,
    );

    expect(reply.statusCode).toBe(422);
    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        errorCode: 'LOGO_ISBASI_SESSION_FIELDS_MISSING',
        message: 'Logo İşbaşı login response is missing required session fields.',
        missingSessionFields: ['tenantId'],
        login: expect.objectContaining({
          accessTokenPresent: true,
          tenantIdPresent: false,
          tokenPreview: 'abcdef...7890',
        }),
      }),
    );
    expect(JSON.stringify(result)).not.toContain('abcdef1234567890');
  });

  it('sanitizes login responses without exposing credentials or full token', () => {
    const sanitized = sanitizeLoginResponse({
      ok: true,
      code: 200,
      message: 'token=secret-token password=secret-password',
      data: {
        accessToken: 'abcdef1234567890',
        tenantId: 'tenant-1',
        userEmail: 'user@example.test',
      },
    });

    expect(sanitized).toEqual(
      expect.objectContaining({
        accessTokenPresent: true,
        tenantIdPresent: true,
        userEmailPresent: true,
        tokenPreview: 'abcdef...7890',
      }),
    );
    const serialized = JSON.stringify(sanitized);
    expect(serialized).not.toContain('abcdef1234567890');
    expect(serialized).not.toContain('secret-password');
    expect(serialized).not.toContain('secret-token');
  });

  it('extracts Logo session values from common response shapes without guessing missing fields', () => {
    expect(extractSessionFromLoginResponse({ data: { access_token: 'token-1', tenantId: 'tenant-1' } })).toEqual(
      expect.objectContaining({
        accessToken: 'token-1',
        tenantId: 'tenant-1',
        accessTokenPresent: true,
        tenantIdPresent: true,
        missing: [],
      }),
    );
    expect(extractSessionFromLoginResponse({ accessToken: 'token-2' })).toEqual(
      expect.objectContaining({
        accessToken: 'token-2',
        tenantId: null,
        missing: ['tenantId'],
      }),
    );
  });

  it('builds a commission service invoice preview without e-archive internet fields', () => {
    const preview = buildLogoIsbasiCommissionInvoicePreview({
      vendorBillingProfile,
      commissionAmount: '100',
      vatRate: '20',
      currency: 'TL',
      description: 'Pazaryeri komisyon hizmet bedeli',
      sourcePeriod: '2026-06',
    });

    expect(preview.payload).toEqual(
      expect.objectContaining({
        invoiceId: 0,
        currency: 'TL',
        exchangeRate: 1,
        vatIncluded: false,
      }),
    );
    expect(preview.payload.salesInvoiceDetails).toEqual([
      expect.objectContaining({
        quantity: 1,
        taxRate: '20',
        price: '100',
        productDetail: expect.objectContaining({
          itemCode: 'SPORGYM-COMMISSION',
          itemType: 2,
          name: 'Sporgym Pazaryeri Komisyon Hizmeti',
        }),
      }),
    ]);
    expect(preview.warnings).toContain('eGovernmentInvoice enum/required fields unknown; omitted in dry-run.');
    const serialized = JSON.stringify(preview.payload);
    expect(serialized).not.toMatch(/shipmentAgentItem|website|eArchivePaymentType|eArchivePaymentDate/);
  });

  it('masks tax number in sanitized API preview responses', () => {
    const preview = buildLogoIsbasiCommissionInvoicePreview({
      vendorBillingProfile,
      commissionAmount: '100',
      vatRate: '20',
      currency: 'TL',
      description: 'Pazaryeri komisyon hizmet bedeli',
    });

    const sanitized = sanitizeLogoIsbasiInvoicePreviewPayload(preview.payload);

    expect((sanitized.customer as Record<string, unknown>).tcknVkn).toBe('64******63');
    expect(JSON.stringify(sanitized)).not.toContain('6490512763');
  });

  it('validates required vendor billing fields and does not call network in the preview endpoint', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    getVendorBillingProfileMock.mockResolvedValue({ ...vendorBillingProfile, billingCity: null });
    const { posts } = createRegisteredRoutes();
    const reply = createReply();

    const result = await posts.get('/admin/vendors/:vendorId/logo-isbasi/commission-invoice-preview')?.(
      {
        authUser: { role: 'admin' },
        params: { vendorId: 'sporjinal' },
        body: {
          commissionAmount: '100',
          vatRate: '20',
          currency: 'TL',
          description: 'Pazaryeri komisyon hizmet bedeli',
        },
      },
      reply,
    );

    expect(reply.statusCode).toBe(400);
    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        externalApiCallAttempted: false,
        message: expect.stringContaining('billingCity'),
      }),
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
