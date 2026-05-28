type ProbeEnv = Record<string, unknown>;

type ProbeLogger = Pick<Console, 'log' | 'error'>;

type ProbeOptions = {
  env?: ProbeEnv;
  fetchImpl?: typeof fetch;
  logger?: ProbeLogger;
  now?: () => Date;
};

type HttpResult = {
  status: number;
  contentType: string | null;
  body: unknown;
};

type ProbeConfig = {
  nodeEnv: string;
  enabled: boolean;
  testMode: boolean;
  dryRun: boolean;
  allowCreate: boolean;
  allowLifecycle: boolean;
  confirm: string;
  baseUrl: string;
  companyId: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  username: string;
  password: string;
  accessToken: string;
  refreshToken: string;
  vendorName: string;
  vendorEmail: string;
  vendorTaxNumber: string;
  vendorTaxOffice: string;
  commissionProductName: string;
  commissionProductCode: string;
  commissionAmount: number;
  currency: string;
  vatRate: number;
  invoiceDescription: string;
};

const CREATE_CONFIRMATION = 'CREATE_COMMISSION_INVOICE_TEST';
const LIFECYCLE_CONFIRMATION = 'CREATE_COMMISSION_INVOICE_TEST_AND_RUN_LIFECYCLE';
const INVOICE_INCLUDE = 'contact,details,payments,payments.transaction,tags';
const SENSITIVE_KEY_PATTERN = /access_token|refresh_token|client_secret|password|authorization|token|secret/i;
const PII_KEY_PATTERN = /email|tax_number|tax_office/i;

function readString(env: ProbeEnv, key: string, fallback = '') {
  const value = env[key];
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function readBoolean(env: ProbeEnv, key: string, fallback: boolean) {
  const value = env[key];
  if (typeof value !== 'string' || !value.trim()) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
    return true;
  }
  if (normalized === 'false' || normalized === '0' || normalized === 'no') {
    return false;
  }

  throw new Error(`${key} must be true or false.`);
}

function readNumber(env: ProbeEnv, key: string, fallback: number) {
  const value = env[key];
  if (typeof value !== 'string' || !value.trim()) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${key} must be numeric.`);
  }

  return parsed;
}

function normalizeBaseUrl(value: string) {
  return value.replace(/\/+$/, '');
}

function parseProbeConfig(env: ProbeEnv): ProbeConfig {
  return {
    nodeEnv: readString(env, 'NODE_ENV', 'development'),
    enabled: readBoolean(env, 'PARASUT_ENABLED', false),
    testMode: readBoolean(env, 'PARASUT_TEST_MODE', true),
    dryRun: readBoolean(env, 'PARASUT_PROBE_DRY_RUN', true),
    allowCreate: readBoolean(env, 'PARASUT_PROBE_ALLOW_CREATE', false),
    allowLifecycle: readBoolean(env, 'PARASUT_PROBE_ALLOW_LIFECYCLE', false),
    confirm: readString(env, 'PARASUT_PROBE_CONFIRM'),
    baseUrl: normalizeBaseUrl(readString(env, 'PARASUT_BASE_URL', 'https://api.parasut.com')),
    companyId: readString(env, 'PARASUT_COMPANY_ID'),
    clientId: readString(env, 'PARASUT_CLIENT_ID'),
    clientSecret: readString(env, 'PARASUT_CLIENT_SECRET'),
    redirectUri: readString(env, 'PARASUT_REDIRECT_URI'),
    username: readString(env, 'PARASUT_USERNAME'),
    password: readString(env, 'PARASUT_PASSWORD'),
    accessToken: readString(env, 'PARASUT_ACCESS_TOKEN'),
    refreshToken: readString(env, 'PARASUT_REFRESH_TOKEN'),
    vendorName: readString(env, 'PARASUT_PROBE_VENDOR_NAME', 'Sporgym Commission Test Vendor'),
    vendorEmail: readString(env, 'PARASUT_PROBE_VENDOR_EMAIL'),
    vendorTaxNumber: readString(env, 'PARASUT_PROBE_VENDOR_TAX_NUMBER'),
    vendorTaxOffice: readString(env, 'PARASUT_PROBE_VENDOR_TAX_OFFICE'),
    commissionProductName: readString(env, 'PARASUT_PROBE_COMMISSION_PRODUCT_NAME', 'Sporgym Marketplace Commission Test'),
    commissionProductCode: readString(env, 'PARASUT_PROBE_COMMISSION_PRODUCT_CODE', 'SPORGYM-COMMISSION-TEST'),
    commissionAmount: readNumber(env, 'PARASUT_PROBE_COMMISSION_AMOUNT', 1),
    currency: readString(env, 'PARASUT_PROBE_CURRENCY', 'TRL'),
    vatRate: readNumber(env, 'PARASUT_PROBE_VAT_RATE', 20),
    invoiceDescription: readString(
      env,
      'PARASUT_PROBE_INVOICE_DESCRIPTION',
      'Sporgym marketplace commission test probe. No customer invoice.',
    ),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getDataId(value: unknown) {
  return isRecord(value) && typeof value.id === 'string' && value.id.trim() ? value.id.trim() : null;
}

function getAttributeString(value: unknown, key: string) {
  if (!isRecord(value) || !isRecord(value.attributes)) {
    return null;
  }
  const field = value.attributes[key];
  return typeof field === 'string' && field.trim() ? field.trim() : null;
}

function summarizeBody(value: unknown) {
  if (Array.isArray(value)) {
    return { kind: 'array', keys: [] };
  }
  if (isRecord(value)) {
    return { kind: 'object', keys: Object.keys(value) };
  }
  return { kind: value === null ? 'null' : typeof value, keys: [] };
}

function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitize(item));
  }
  if (!isRecord(value)) {
    return typeof value === 'string' && value.length > 180 ? `${value.slice(0, 120)}...[truncated]` : value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => {
      if (SENSITIVE_KEY_PATTERN.test(key) || PII_KEY_PATTERN.test(key)) {
        return [key, item ? '[redacted]' : item];
      }
      return [key, sanitize(item)];
    }),
  );
}

function requireBaseSafety(config: ProbeConfig) {
  if (config.nodeEnv === 'production') {
    throw new Error('This test probe is blocked when NODE_ENV=production.');
  }
  if (!config.enabled) {
    throw new Error('PARASUT_ENABLED=true is required for live Paraşüt probe requests.');
  }
  if (!config.testMode) {
    throw new Error('PARASUT_TEST_MODE=true is required. This probe must not run against production mode.');
  }
  if (!config.companyId) {
    throw new Error('PARASUT_COMPANY_ID is required.');
  }
}

function requireCreateSafety(config: ProbeConfig) {
  if (!config.allowCreate) {
    throw new Error('PARASUT_PROBE_ALLOW_CREATE=true is required before creating contacts, products, or commission invoices.');
  }
  if (config.confirm !== CREATE_CONFIRMATION && config.confirm !== LIFECYCLE_CONFIRMATION) {
    throw new Error(`PARASUT_PROBE_CONFIRM=${CREATE_CONFIRMATION} is required before creating a commission invoice.`);
  }
}

function requireLifecycleSafety(config: ProbeConfig) {
  if (!config.allowLifecycle) {
    throw new Error('PARASUT_PROBE_ALLOW_LIFECYCLE=true is required before cancel/recover/archive probe calls.');
  }
  if (config.confirm !== LIFECYCLE_CONFIRMATION) {
    throw new Error(`PARASUT_PROBE_CONFIRM=${LIFECYCLE_CONFIRMATION} is required before cancel/recover/archive probe calls.`);
  }
}

async function readJsonResponse(response: Response): Promise<HttpResult> {
  const contentType = response.headers.get('content-type');
  const text = await response.text();
  let body: unknown = text;
  if (text && contentType?.toLowerCase().includes('json')) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  return { status: response.status, contentType, body };
}

class ParasutProbeClient {
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly companyId: string;

  constructor(config: Pick<ProbeConfig, 'baseUrl' | 'companyId'>, fetchImpl: typeof fetch = fetch) {
    this.fetchImpl = fetchImpl;
    this.baseUrl = config.baseUrl;
    this.companyId = config.companyId;
  }

  async token(params: URLSearchParams) {
    return this.request('/oauth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
  }

  async getMe(accessToken: string) {
    return this.request('/v4/me', { method: 'GET' }, accessToken);
  }

  async listContacts(accessToken: string) {
    return this.companyRequest('/contacts?page[size]=25', { method: 'GET' }, accessToken);
  }

  async createContact(accessToken: string, config: ProbeConfig) {
    return this.companyRequest(
      '/contacts',
      {
        method: 'POST',
        body: JSON.stringify(buildContactPayload(config)),
      },
      accessToken,
    );
  }

  async listProducts(accessToken: string) {
    return this.companyRequest('/products?page[size]=25', { method: 'GET' }, accessToken);
  }

  async createProduct(accessToken: string, config: ProbeConfig) {
    return this.companyRequest(
      '/products',
      {
        method: 'POST',
        body: JSON.stringify(buildProductPayload(config)),
      },
      accessToken,
    );
  }

  async createCommissionInvoice(accessToken: string, config: ProbeConfig, contactId: string, productId: string, now: Date) {
    return this.companyRequest(
      '/sales_invoices',
      {
        method: 'POST',
        body: JSON.stringify(buildCommissionInvoicePayload(config, contactId, productId, now)),
      },
      accessToken,
    );
  }

  async showInvoice(accessToken: string, invoiceId: string) {
    return this.companyRequest(`/sales_invoices/${encodeURIComponent(invoiceId)}?include=${encodeURIComponent(INVOICE_INCLUDE)}`, { method: 'GET' }, accessToken);
  }

  async invoiceLifecycleAction(accessToken: string, invoiceId: string, action: 'cancel' | 'recover' | 'archive') {
    return this.companyRequest(`/sales_invoices/${encodeURIComponent(invoiceId)}/${action}`, { method: 'POST' }, accessToken);
  }

  private companyRequest(path: string, init: RequestInit, accessToken: string) {
    return this.request(`/v4/${encodeURIComponent(this.companyId)}${path}`, init, accessToken);
  }

  private async request(path: string, init: RequestInit, accessToken?: string) {
    const headers = new Headers(init.headers);
    if (!headers.has('content-type') && init.body) {
      headers.set('content-type', 'application/vnd.api+json');
    }
    if (!headers.has('accept')) {
      headers.set('accept', 'application/vnd.api+json, application/json');
    }
    if (accessToken) {
      headers.set('authorization', `Bearer ${accessToken}`);
    }

    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers,
    });
    return readJsonResponse(response);
  }
}

function buildTokenParams(config: ProbeConfig) {
  if (config.refreshToken) {
    return new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: config.refreshToken,
    });
  }

  if (config.username && config.password) {
    return new URLSearchParams({
      grant_type: 'password',
      client_id: config.clientId,
      client_secret: config.clientSecret,
      username: config.username,
      password: config.password,
      ...(config.redirectUri ? { redirect_uri: config.redirectUri } : {}),
    });
  }

  return null;
}

function buildContactPayload(config: ProbeConfig) {
  return {
    data: {
      type: 'contacts',
      attributes: {
        name: config.vendorName,
        email: config.vendorEmail || undefined,
        tax_number: config.vendorTaxNumber || undefined,
        tax_office: config.vendorTaxOffice || undefined,
        account_type: 'customer',
      },
    },
  };
}

function buildProductPayload(config: ProbeConfig) {
  return {
    data: {
      type: 'products',
      attributes: {
        name: config.commissionProductName,
        code: config.commissionProductCode,
        vat_rate: config.vatRate,
      },
    },
  };
}

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function buildCommissionInvoicePayload(config: ProbeConfig, contactId: string, productId: string, now: Date) {
  const date = formatDate(now);
  return {
    data: {
      type: 'sales_invoices',
      attributes: {
        item_type: 'invoice',
        description: config.invoiceDescription,
        issue_date: date,
        due_date: date,
        currency: config.currency,
        order_no: `SPORGYM-COMMISSION-PROBE-${now.getTime()}`,
        order_date: date,
      },
      relationships: {
        contact: {
          data: { id: contactId, type: 'contacts' },
        },
        details: {
          data: [
            {
              type: 'sales_invoice_details',
              attributes: {
                quantity: 1,
                unit_price: config.commissionAmount,
                vat_rate: config.vatRate,
                description: config.invoiceDescription,
              },
              relationships: {
                product: {
                  data: { id: productId, type: 'products' },
                },
              },
            },
          ],
        },
      },
    },
  };
}

function findContactId(body: unknown, vendorName: string) {
  if (!isRecord(body) || !Array.isArray(body.data)) {
    return null;
  }

  const expected = vendorName.trim().toLowerCase();
  const match = body.data.find((item) => getAttributeString(item, 'name')?.toLowerCase() === expected);
  return getDataId(match);
}

function findProductId(body: unknown, productCode: string, productName: string) {
  if (!isRecord(body) || !Array.isArray(body.data)) {
    return null;
  }

  const expectedCode = productCode.trim().toLowerCase();
  const expectedName = productName.trim().toLowerCase();
  const match = body.data.find((item) => {
    const code = getAttributeString(item, 'code')?.toLowerCase();
    const name = getAttributeString(item, 'name')?.toLowerCase();
    return code === expectedCode || name === expectedName;
  });
  return getDataId(match);
}

function getAccessToken(body: unknown) {
  return isRecord(body) && typeof body.access_token === 'string' ? body.access_token : null;
}

function getRefreshTokenRotated(body: unknown) {
  return isRecord(body) && typeof body.refresh_token === 'string' && body.refresh_token.trim() ? true : false;
}

function logStep(logger: ProbeLogger, label: string, details: Record<string, unknown>) {
  const sanitizedDetails = sanitize(details);
  logger.log(JSON.stringify({ label, ...(isRecord(sanitizedDetails) ? sanitizedDetails : {}) }, null, 2));
}

function logDryRun(logger: ProbeLogger, config: ProbeConfig) {
  logger.log('DRY RUN: Paraşüt commission invoice probe.');
  logger.log('No network calls will be made. No contact, product, invoice, payment, or e-document will be created.');
  logStep(logger, 'Safety gates', {
    enabled: config.enabled,
    testMode: config.testMode,
    dryRun: config.dryRun,
    allowCreate: config.allowCreate,
    allowLifecycle: config.allowLifecycle,
    confirmationPresent: Boolean(config.confirm),
  });
  logStep(logger, 'Planned API sequence', {
    sequence: [
      'OAuth token refresh/password grant or provided access token',
      'GET /v4/me',
      'GET /v4/{company_id}/contacts',
      'POST /v4/{company_id}/contacts only if missing and create is confirmed',
      'GET /v4/{company_id}/products',
      'POST /v4/{company_id}/products only if missing and create is confirmed',
      'POST /v4/{company_id}/sales_invoices for Sporgym -> vendor commission only if create is confirmed',
      `GET /v4/{company_id}/sales_invoices/{invoice_id}?include=${INVOICE_INCLUDE}`,
      'cancel/recover/archive only if lifecycle probe is explicitly confirmed',
    ],
  });
}

async function resolveAccessToken(config: ProbeConfig, client: ParasutProbeClient, logger: ProbeLogger) {
  const tokenParams = buildTokenParams(config);
  if (!tokenParams) {
    if (!config.accessToken) {
      throw new Error('Provide PARASUT_ACCESS_TOKEN, PARASUT_REFRESH_TOKEN, or PARASUT_USERNAME/PARASUT_PASSWORD for OAuth probing.');
    }
    logStep(logger, 'OAuth/token lifecycle', {
      mode: 'provided_access_token',
      tokenRequestSkipped: true,
    });
    return config.accessToken;
  }
  if (!config.clientId || !config.clientSecret) {
    throw new Error('PARASUT_CLIENT_ID and PARASUT_CLIENT_SECRET are required for OAuth token requests.');
  }

  const tokenResponse = await client.token(tokenParams);
  const accessToken = getAccessToken(tokenResponse.body);
  logStep(logger, 'OAuth/token lifecycle', {
    status: tokenResponse.status,
    contentType: tokenResponse.contentType,
    tokenReceived: Boolean(accessToken),
    refreshTokenRotated: getRefreshTokenRotated(tokenResponse.body),
    note: getRefreshTokenRotated(tokenResponse.body)
      ? 'Persist the newest refresh_token from the response in secret storage before future probes.'
      : undefined,
    responseShape: summarizeBody(tokenResponse.body),
  });

  if (!accessToken) {
    throw new Error('Paraşüt OAuth response did not include access_token.');
  }

  return accessToken;
}

export async function runParasutCommissionInvoiceProbe(options: ProbeOptions = {}) {
  const env = options.env ?? process.env;
  const logger = options.logger ?? console;
  const now = options.now ?? (() => new Date());
  const config = parseProbeConfig(env);

  logger.log('TEST ONLY: Paraşüt Sporgym -> Vendor commission invoice probe.');
  logger.log('This probe never calls e-Fatura/e-Arşiv formalization endpoints and never creates customer invoices.');

  if (config.dryRun) {
    logDryRun(logger, config);
    return;
  }

  requireBaseSafety(config);

  const client = new ParasutProbeClient(config, options.fetchImpl);
  const accessToken = await resolveAccessToken(config, client, logger);

  const meResponse = await client.getMe(accessToken);
  logStep(logger, 'GET /v4/me', {
    status: meResponse.status,
    contentType: meResponse.contentType,
    responseShape: summarizeBody(meResponse.body),
  });

  const contactListResponse = await client.listContacts(accessToken);
  let contactId = findContactId(contactListResponse.body, config.vendorName);
  logStep(logger, 'Vendor contact lookup', {
    status: contactListResponse.status,
    contentType: contactListResponse.contentType,
    matched: Boolean(contactId),
    contactId,
    responseShape: summarizeBody(contactListResponse.body),
  });

  if (!contactId) {
    requireCreateSafety(config);
    const createContactResponse = await client.createContact(accessToken, config);
    contactId = getDataId(isRecord(createContactResponse.body) ? createContactResponse.body.data : null);
    logStep(logger, 'Vendor contact create', {
      status: createContactResponse.status,
      contentType: createContactResponse.contentType,
      contactId,
      responseShape: summarizeBody(createContactResponse.body),
    });
  }
  if (!contactId) {
    throw new Error('Vendor contact id was not resolved.');
  }

  const productListResponse = await client.listProducts(accessToken);
  let productId = findProductId(productListResponse.body, config.commissionProductCode, config.commissionProductName);
  logStep(logger, 'Commission product/service lookup', {
    status: productListResponse.status,
    contentType: productListResponse.contentType,
    matched: Boolean(productId),
    productId,
    responseShape: summarizeBody(productListResponse.body),
  });

  if (!productId) {
    requireCreateSafety(config);
    const createProductResponse = await client.createProduct(accessToken, config);
    productId = getDataId(isRecord(createProductResponse.body) ? createProductResponse.body.data : null);
    logStep(logger, 'Commission product/service create', {
      status: createProductResponse.status,
      contentType: createProductResponse.contentType,
      productId,
      responseShape: summarizeBody(createProductResponse.body),
    });
  }
  if (!productId) {
    throw new Error('Commission product/service id was not resolved.');
  }

  requireCreateSafety(config);
  const invoiceResponse = await client.createCommissionInvoice(accessToken, config, contactId, productId, now());
  const invoiceId = getDataId(isRecord(invoiceResponse.body) ? invoiceResponse.body.data : null);
  logStep(logger, 'Commission sales invoice create', {
    status: invoiceResponse.status,
    contentType: invoiceResponse.contentType,
    invoiceId,
    responseShape: summarizeBody(invoiceResponse.body),
    safety: 'Sporgym -> vendor commission invoice only; no customer invoice; no e-document formalization.',
  });

  if (!invoiceId) {
    throw new Error('Commission invoice id was not resolved.');
  }

  const invoiceShowResponse = await client.showInvoice(accessToken, invoiceId);
  logStep(logger, 'Commission invoice show with includes', {
    status: invoiceShowResponse.status,
    contentType: invoiceShowResponse.contentType,
    include: INVOICE_INCLUDE,
    responseShape: summarizeBody(invoiceShowResponse.body),
  });

  if (!config.allowLifecycle) {
    logger.log('Lifecycle probe skipped. Set PARASUT_PROBE_ALLOW_LIFECYCLE=true and PARASUT_PROBE_CONFIRM=CREATE_COMMISSION_INVOICE_TEST_AND_RUN_LIFECYCLE to probe cancel/recover/archive.');
    return;
  }

  requireLifecycleSafety(config);
  for (const action of ['cancel', 'recover', 'archive'] as const) {
    const response = await client.invoiceLifecycleAction(accessToken, invoiceId, action);
    logStep(logger, `Commission invoice ${action}`, {
      status: response.status,
      contentType: response.contentType,
      responseShape: summarizeBody(response.body),
    });
  }
}
