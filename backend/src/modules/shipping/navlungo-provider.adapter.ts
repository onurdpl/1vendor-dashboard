import type { AppEnv } from '../../config/env.js';
import type {
  ShippingProviderAdapter,
  ShippingProviderCreateInput,
  ShippingProviderCreateResult,
} from './shipping-provider.adapter.js';
import { ShippingProviderExecutionError as ProviderExecutionError } from './shipping-provider.adapter.js';

export const NAVLUNGO_PROVIDER_KEY = 'navlungo' as const;
export const NAVLUNGO_PROVIDER_DISPLAY_NAME = 'Navlungo';

export const NAVLUNGO_ENV_NAMES = {
  baseUrl: 'NAVLUNGO_BASE_URL',
  apiUsername: 'NAVLUNGO_API_USERNAME',
  apiPassword: 'NAVLUNGO_API_PASSWORD',
  defaultSenderAddressId: 'NAVLUNGO_DEFAULT_SENDER_ADDRESS_ID',
  defaultBarcodeFormat: 'NAVLUNGO_DEFAULT_BARCODE_FORMAT',
  defaultCarrierId: 'NAVLUNGO_DEFAULT_CARRIER_ID',
} as const;

const NAVLUNGO_DEFAULT_CARRIER_ID = 9;
const NAVLUNGO_DEFAULT_BARCODE_FORMAT = 'pdf-A6';
const NAVLUNGO_FORWARD_POST_TYPE = 2;

export type NavlungoAuthDiagnostics = {
  provider: typeof NAVLUNGO_PROVIDER_KEY;
  displayName: typeof NAVLUNGO_PROVIDER_DISPLAY_NAME;
  dormant: true;
  baseUrlHost: string | null;
  baseUrlPath: string | null;
  baseUrlParseError: string | null;
  usernamePresent: boolean;
  passwordPresent: boolean;
  authRequestUrl: string | null;
  authHttpStatus: number | null;
  authContentType: string | null;
  responseShapeSummary: {
    kind: string;
    topLevelKeys: string[];
  } | null;
  responseDataShapeSummary: {
    kind: string;
    topLevelKeys: string[];
  } | null;
  tokenKeyPresence: {
    rootAccessToken: boolean;
    dataAccessToken: boolean;
    dataToken: boolean;
    anyTokenLikeKey: boolean;
  };
  refreshTokenKeyPresence: {
    rootRefreshToken: boolean;
    dataRefreshToken: boolean;
  };
  expiresInPresent: boolean;
  tokenTypePresent: boolean;
  tokenReceived: boolean;
  refreshTokenReceived: boolean;
  expiresIn: number | string | null;
  fetchError: {
    name: string;
    message: string;
    cause: { name: string; message: string } | string | null;
  } | null;
};

export type NavlungoCarrierDiagnostics = {
  provider: typeof NAVLUNGO_PROVIDER_KEY;
  displayName: typeof NAVLUNGO_PROVIDER_DISPLAY_NAME;
  dormant: true;
  authHttpStatus: number | null;
  authContentType: string | null;
  authTokenReceived: boolean;
  carrierEndpointPathsKnown: boolean;
  skippedReason: string | null;
  myCarriersRequestUrl: string | null;
  myCarriersHttpStatus: number | null;
  myCarriersContentType: string | null;
  myCarriersResponseShape: {
    kind: string;
    topLevelKeys: string[];
  } | null;
  myCarriersDataShape: {
    kind: string;
    topLevelKeys: string[];
  } | null;
  myCarrierCount: number | null;
  myCarrierSamples: Array<{
    id: string | number | null;
    name: string | null;
    shortName: string | null;
    activeOrConfigured: boolean | null;
  }>;
  listCarriersRequestUrl: string | null;
  listCarriersHttpStatus: number | null;
  listCarriersContentType: string | null;
  listCarriersResponseShape: {
    kind: string;
    topLevelKeys: string[];
  } | null;
  listCarriersDataShape: {
    kind: string;
    topLevelKeys: string[];
  } | null;
  listCarrierCount: number | null;
  listCarrierSamples: Array<{
    id: string | number | null;
    name: string | null;
    shortName: string | null;
    activeOrConfigured: boolean | null;
  }>;
  anyConfiguredCarrier: boolean;
  providerMessages: string[];
  fetchError: {
    name: string;
    message: string;
    cause: { name: string; message: string } | string | null;
  } | null;
};

type NavlungoHttpResponse<TBody = unknown> = {
  ok: boolean;
  status: number;
  contentType: string;
  body: TBody;
};

export type NavlungoCreatePostPayload = {
  platform: string;
  posts: Array<{
    reference_id: string;
    carrier_id: number;
    post_type: number;
    cod_payment_type?: number | string;
    sender: {
      name: string;
      phone: string;
      email: string;
      address: string;
      country: string;
      city: string;
      district: string;
      post_code: string;
    };
    recipient: {
      name: string;
      phone: string;
      email: string;
      address: string;
      country: string;
      city: string;
      district: string;
      post_code: string;
    };
    post: {
      desi: number;
      package_count: number;
      price?: number | string;
      note: string;
    };
    barcode_format: string;
    custom_data_1: string;
    custom_data_2: string;
    custom_data_3: string;
    custom_data_4: string;
  }>;
};

export type NavlungoHttpClientOptions = {
  fetchImpl?: typeof fetch;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseNavlungoResponseBody(contentType: string, responseText: string): unknown {
  if (!responseText) {
    return null;
  }

  if (!contentType.includes('application/json')) {
    return responseText;
  }

  try {
    return JSON.parse(responseText);
  } catch {
    return responseText;
  }
}

function summarizeResponseShape(value: unknown): NavlungoAuthDiagnostics['responseShapeSummary'] {
  if (isRecord(value)) {
    return {
      kind: 'json:object',
      topLevelKeys: Object.keys(value),
    };
  }

  if (Array.isArray(value)) {
    return {
      kind: 'json:array',
      topLevelKeys: [],
    };
  }

  if (value === null || value === undefined || value === '') {
    return {
      kind: 'empty',
      topLevelKeys: [],
    };
  }

  return {
    kind: typeof value,
    topLevelKeys: [],
  };
}

function getTrimmedString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
  }
  return null;
}

function hasNonEmptyString(record: Record<string, unknown>, key: string) {
  return getTrimmedString(record, key) !== null;
}

function hasTokenLikeKey(record: Record<string, unknown>) {
  return Object.keys(record).some((key) => key.toLowerCase().includes('token'));
}

function getAuthExpiresIn(root: Record<string, unknown>, data: Record<string, unknown>) {
  const value = root.expires_in ?? data.expires_in;
  return typeof value === 'string' || typeof value === 'number' ? value : null;
}

function getProviderMessages(value: unknown) {
  if (!isRecord(value)) {
    return [];
  }

  const messages = [value.message, value.error]
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim());

  return [...new Set(messages)];
}

function readNumberOrString(value: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const raw = value[key];
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      return raw;
    }
    if (typeof raw === 'string' && raw.trim()) {
      return raw.trim();
    }
  }
  return null;
}

function getNavlungoResponseData(body: unknown) {
  if (!isRecord(body)) {
    return {};
  }
  if (Array.isArray(body.data)) {
    return body.data.find(isRecord) ?? {};
  }
  return isRecord(body.data) ? body.data : body;
}

function getNavlungoPostRecord(data: Record<string, unknown>) {
  return isRecord(data.post) ? data.post : {};
}

function readNavlungoBarcode(data: Record<string, unknown>) {
  const barcode = data.barcode;
  return typeof barcode === 'string' && barcode.trim() ? barcode.trim() : null;
}

function mapNavlungoShipmentStatus(value: unknown) {
  const statusRecord = isRecord(value) ? value : {};
  const raw = (
    readString(statusRecord, ['status_name', 'statusName', 'name']) ??
    readString(statusRecord, ['status_code', 'statusCode', 'code']) ??
    (typeof value === 'string' ? value : '')
  ).toLowerCase();

  if (/to be picked|to be picked up|pickup pending/.test(raw)) {
    return 'created' as const;
  }
  if (/deliver|teslim/.test(raw)) {
    return 'delivered' as const;
  }
  if (/cancel|iptal/.test(raw)) {
    return 'cancelled' as const;
  }
  if (/fail|error|hata|not delivered|missing/.test(raw)) {
    return 'failed' as const;
  }
  if (/transit|yolda|picked|pickup|courier|carrier|shipped/.test(raw)) {
    return 'in_transit' as const;
  }
  return 'created' as const;
}

function parsePositiveInteger(value: unknown, fallback: number) {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : Number.NaN;
}

function readStringFromRecord(value: unknown, keys: string[]) {
  return isRecord(value) ? readString(value, keys) : null;
}

function buildCreatePostDiagnostics(response: NavlungoHttpResponse, bodyData: Record<string, unknown>) {
  const post = getNavlungoPostRecord(bodyData);
  return {
    ok: response.ok,
    status: response.status,
    contentType: response.contentType,
    topLevelKeys: isRecord(response.body) ? Object.keys(response.body) : [],
    dataKeys: Object.keys(bodyData),
    postNumberPresent: Boolean(readString(bodyData, ['post_number'])),
    trackingUrlPresent: Boolean(readString(bodyData, ['tracking_url'])),
    barcodePresent: Boolean(readNavlungoBarcode(bodyData)),
    carrierFieldsPresent: Boolean(readNumberOrString(post, ['carrier_id']) ?? readString(post, ['carrier_name'])),
    providerMessage: readStringFromRecord(response.body, ['message', 'error']),
  };
}

function buildCheckPostDiagnostics(response: NavlungoHttpResponse | null, bodyData: Record<string, unknown>, warning?: string | null) {
  const post = getNavlungoPostRecord(bodyData);
  const status = isRecord(bodyData.status) ? bodyData.status : {};
  return {
    called: Boolean(response),
    ok: response?.ok ?? false,
    status: response?.status ?? null,
    contentType: response?.contentType ?? null,
    topLevelKeys: response && isRecord(response.body) ? Object.keys(response.body) : [],
    dataKeys: Object.keys(bodyData),
    statusKeys: Object.keys(status),
    trackingPresent: Boolean(readString(bodyData, ['carrier_tracking_code', 'carrier_post_number', 'post_number'])),
    trackingUrlPresent: Boolean(readString(bodyData, ['carrier_tracking_url', 'tracking_url'])),
    barcodePresent: Boolean(readNavlungoBarcode(bodyData)),
    carrierFieldsPresent: Boolean(readNumberOrString(post, ['carrier_id']) ?? readString(post, ['carrier_name'])),
    providerMessage: response ? readStringFromRecord(response.body, ['message', 'error']) : null,
    warning: warning ?? null,
  };
}

export function getNavlungoAccessTokenFromAuthBody(value: unknown) {
  const body = isRecord(value) ? value : {};
  const data = isRecord(body.data) ? body.data : {};
  return getTrimmedString(body, 'access_token') ?? getTrimmedString(data, 'access_token') ?? getTrimmedString(data, 'token');
}

function summarizeFetchError(error: unknown): NavlungoAuthDiagnostics['fetchError'] {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      cause: error.cause instanceof Error
        ? { name: error.cause.name, message: error.cause.message }
        : typeof error.cause === 'string'
          ? error.cause
          : null,
    };
  }

  return {
    name: 'UnknownError',
    message: 'Unknown Navlungo auth probe error.',
    cause: null,
  };
}

function parseBaseUrl(value: string | undefined) {
  if (!value?.trim()) {
    return {
      url: null,
      host: null,
      path: null,
      error: null,
    };
  }

  try {
    const url = new URL(value.trim());
    return {
      url,
      host: url.host,
      path: url.pathname === '/' ? '' : url.pathname.replace(/\/$/, ''),
      error: null,
    };
  } catch (error) {
    return {
      url: null,
      host: null,
      path: null,
      error: error instanceof Error ? error.message : 'Invalid Navlungo base URL.',
    };
  }
}

export class NavlungoHttpClient {
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly env: Pick<AppEnv, 'NAVLUNGO_BASE_URL' | 'NAVLUNGO_API_USERNAME' | 'NAVLUNGO_API_PASSWORD'>,
    options: NavlungoHttpClientOptions = {},
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async createAuthToken(): Promise<NavlungoHttpResponse> {
    const username = this.env.NAVLUNGO_API_USERNAME?.trim();
    const password = this.env.NAVLUNGO_API_PASSWORD?.trim();
    if (!username) {
      throw new Error('NAVLUNGO_API_USERNAME is not configured.');
    }
    if (!password) {
      throw new Error('NAVLUNGO_API_PASSWORD is not configured.');
    }

    const response = await this.fetchImpl(this.requestUrl('/auth/api'), {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ username, password }),
    });
    const contentType = response.headers.get('content-type') ?? '';
    const responseText = await response.text();

    return {
      ok: response.ok,
      status: response.status,
      contentType,
      body: parseNavlungoResponseBody(contentType, responseText),
    };
  }

  async createPost(accessToken: string, payload: NavlungoCreatePostPayload): Promise<NavlungoHttpResponse> {
    const token = accessToken.trim();
    if (!token) {
      throw new Error('Navlungo access token is required for Create Post.');
    }

    const response = await this.fetchImpl(this.requestUrl('/post/create'), {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-localization': 'en',
      },
      body: JSON.stringify(payload),
    });
    const contentType = response.headers.get('content-type') ?? '';
    const responseText = await response.text();

    return {
      ok: response.ok,
      status: response.status,
      contentType,
      body: parseNavlungoResponseBody(contentType, responseText),
    };
  }

  async checkPost(accessToken: string, postNumber: string): Promise<NavlungoHttpResponse> {
    const token = accessToken.trim();
    const identifier = postNumber.trim();
    if (!token) {
      throw new Error('Navlungo access token is required for Check Post.');
    }
    if (!identifier) {
      throw new Error('Navlungo post number is required for Check Post.');
    }

    const response = await this.fetchImpl(this.requestUrl(`/post/check/${encodeURIComponent(identifier)}`), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-localization': 'en',
      },
    });
    const contentType = response.headers.get('content-type') ?? '';
    const responseText = await response.text();

    return {
      ok: response.ok,
      status: response.status,
      contentType,
      body: parseNavlungoResponseBody(contentType, responseText),
    };
  }

  requestUrl(path: string) {
    if (!this.env.NAVLUNGO_BASE_URL) {
      throw new Error('NAVLUNGO_BASE_URL is not configured.');
    }

    return `${this.env.NAVLUNGO_BASE_URL.replace(/\/$/, '')}${path}`;
  }
}

export async function runNavlungoCarrierDiagnostics(
  env: Pick<AppEnv, 'NAVLUNGO_BASE_URL' | 'NAVLUNGO_API_USERNAME' | 'NAVLUNGO_API_PASSWORD'>,
  options: NavlungoHttpClientOptions = {},
): Promise<NavlungoCarrierDiagnostics> {
  const base: NavlungoCarrierDiagnostics = {
    provider: NAVLUNGO_PROVIDER_KEY,
    displayName: NAVLUNGO_PROVIDER_DISPLAY_NAME,
    dormant: true,
    authHttpStatus: null,
    authContentType: null,
    authTokenReceived: false,
    carrierEndpointPathsKnown: false,
    skippedReason: 'carrier_endpoint_paths_unknown',
    myCarriersRequestUrl: null,
    myCarriersHttpStatus: null,
    myCarriersContentType: null,
    myCarriersResponseShape: null,
    myCarriersDataShape: null,
    myCarrierCount: null,
    myCarrierSamples: [],
    listCarriersRequestUrl: null,
    listCarriersHttpStatus: null,
    listCarriersContentType: null,
    listCarriersResponseShape: null,
    listCarriersDataShape: null,
    listCarrierCount: null,
    listCarrierSamples: [],
    anyConfiguredCarrier: false,
    providerMessages: [],
    fetchError: null,
  };

  try {
    const client = new NavlungoHttpClient(env, options);
    const authResponse = await client.createAuthToken();
    const accessToken = getNavlungoAccessTokenFromAuthBody(authResponse.body);
    if (!accessToken) {
      return {
        ...base,
        authHttpStatus: authResponse.status,
        authContentType: authResponse.contentType,
        authTokenReceived: false,
        providerMessages: getProviderMessages(authResponse.body),
      };
    }

    return {
      ...base,
      authHttpStatus: authResponse.status,
      authContentType: authResponse.contentType,
      authTokenReceived: true,
      providerMessages: [
        ...getProviderMessages(authResponse.body),
        'Navlungo carrier endpoint paths are unknown. Official carrier pages do not expose request paths.',
      ],
    };
  } catch (error) {
    return {
      ...base,
      fetchError: summarizeFetchError(error),
    };
  }
}

export async function runNavlungoAuthDiagnostics(
  env: Pick<AppEnv, 'NAVLUNGO_BASE_URL' | 'NAVLUNGO_API_USERNAME' | 'NAVLUNGO_API_PASSWORD'>,
  options: NavlungoHttpClientOptions = {},
): Promise<NavlungoAuthDiagnostics> {
  const baseUrl = parseBaseUrl(env.NAVLUNGO_BASE_URL);
  const base: NavlungoAuthDiagnostics = {
    provider: NAVLUNGO_PROVIDER_KEY,
    displayName: NAVLUNGO_PROVIDER_DISPLAY_NAME,
    dormant: true,
    baseUrlHost: baseUrl.host,
    baseUrlPath: baseUrl.path,
    baseUrlParseError: baseUrl.error,
    usernamePresent: Boolean(env.NAVLUNGO_API_USERNAME?.trim()),
    passwordPresent: Boolean(env.NAVLUNGO_API_PASSWORD?.trim()),
    authRequestUrl: baseUrl.path !== null ? `${baseUrl.path}/auth/api` : null,
    authHttpStatus: null,
    authContentType: null,
    responseShapeSummary: null,
    responseDataShapeSummary: null,
    tokenKeyPresence: {
      rootAccessToken: false,
      dataAccessToken: false,
      dataToken: false,
      anyTokenLikeKey: false,
    },
    refreshTokenKeyPresence: {
      rootRefreshToken: false,
      dataRefreshToken: false,
    },
    expiresInPresent: false,
    tokenTypePresent: false,
    tokenReceived: false,
    refreshTokenReceived: false,
    expiresIn: null,
    fetchError: null,
  };

  try {
    const client = new NavlungoHttpClient(env, options);
    const response = await client.createAuthToken();
    const body = isRecord(response.body) ? response.body : {};
    const data = isRecord(body.data) ? body.data : {};
    const rootAccessToken = hasNonEmptyString(body, 'access_token');
    const dataAccessToken = hasNonEmptyString(data, 'access_token');
    const dataToken = hasNonEmptyString(data, 'token');
    const rootRefreshToken = hasNonEmptyString(body, 'refresh_token');
    const dataRefreshToken = hasNonEmptyString(data, 'refresh_token');
    const expiresIn = getAuthExpiresIn(body, data);
    return {
      ...base,
      authHttpStatus: response.status,
      authContentType: response.contentType,
      responseShapeSummary: summarizeResponseShape(response.body),
      responseDataShapeSummary: isRecord(body.data) ? summarizeResponseShape(body.data) : null,
      tokenKeyPresence: {
        rootAccessToken,
        dataAccessToken,
        dataToken,
        anyTokenLikeKey: hasTokenLikeKey(body) || hasTokenLikeKey(data),
      },
      refreshTokenKeyPresence: {
        rootRefreshToken,
        dataRefreshToken,
      },
      expiresInPresent: expiresIn !== null,
      tokenTypePresent: hasNonEmptyString(body, 'token_type') || hasNonEmptyString(data, 'token_type'),
      tokenReceived: Boolean(getNavlungoAccessTokenFromAuthBody(response.body)),
      refreshTokenReceived: rootRefreshToken || dataRefreshToken,
      expiresIn,
    };
  } catch (error) {
    return {
      ...base,
      responseShapeSummary: null,
      responseDataShapeSummary: null,
      fetchError: summarizeFetchError(error),
    };
  }
}

export function getNavlungoConfigDiagnostics(env: AppEnv) {
  const missing = [
    !env.NAVLUNGO_BASE_URL ? NAVLUNGO_ENV_NAMES.baseUrl : null,
    !env.NAVLUNGO_API_USERNAME ? NAVLUNGO_ENV_NAMES.apiUsername : null,
    !env.NAVLUNGO_API_PASSWORD ? NAVLUNGO_ENV_NAMES.apiPassword : null,
  ].filter(Boolean) as string[];

  return {
    provider: NAVLUNGO_PROVIDER_KEY,
    displayName: NAVLUNGO_PROVIDER_DISPLAY_NAME,
    dormant: true,
    baseUrlConfigured: Boolean(env.NAVLUNGO_BASE_URL),
    usernameConfigured: Boolean(env.NAVLUNGO_API_USERNAME),
    passwordConfigured: Boolean(env.NAVLUNGO_API_PASSWORD),
    defaultSenderAddressIdConfigured: Boolean(env.NAVLUNGO_DEFAULT_SENDER_ADDRESS_ID),
    defaultBarcodeFormat: env.NAVLUNGO_DEFAULT_BARCODE_FORMAT ?? null,
    defaultCarrierId: env.NAVLUNGO_DEFAULT_CARRIER_ID ?? String(NAVLUNGO_DEFAULT_CARRIER_ID),
    runtimeShipmentExecutionEnabled: true,
    missing,
  };
}

export class NavlungoAdapter implements ShippingProviderAdapter {
  provider = 'NAVLUNGO' as const;

  constructor(
    private readonly env: AppEnv,
    private readonly options: NavlungoHttpClientOptions = {},
  ) {}

  async createShipment(input: ShippingProviderCreateInput): Promise<ShippingProviderCreateResult> {
    if (!this.env.SHIPPING_EXECUTION_ENABLED) {
      return {
        providerShipmentId: null,
        trackingNumber: null,
        trackingUrl: null,
        labelUrl: null,
        shipmentStatus: 'pending',
        shippingCost: null,
        shippingVat: null,
        currency: 'TRY',
        responseSnapshot: {
          ok: true,
          dryRun: true,
          provider: NAVLUNGO_PROVIDER_KEY,
          reason: 'Navlungo shipment execution is disabled.',
          disabledGates: ['SHIPPING_EXECUTION_ENABLED'],
        },
      };
    }

    const payload = input.requestSnapshot as NavlungoCreatePostPayload;
    const client = new NavlungoHttpClient(this.env, this.options);
    const responseSnapshot: Record<string, unknown> = {
      provider: NAVLUNGO_PROVIDER_KEY,
      flow: 'forward',
      authCalled: false,
      createPostCalled: false,
      checkPostCalled: false,
      requestedCarrierId: payload.posts?.[0]?.carrier_id ?? null,
      requestedPostType: payload.posts?.[0]?.post_type ?? null,
      requestedBarcodeFormat: payload.posts?.[0]?.barcode_format ?? null,
      codPaymentIncluded: Boolean(payload.posts?.[0]?.cod_payment_type),
      priceIncluded: payload.posts?.[0]?.post?.price !== undefined,
    };

    let accessToken: string | null = null;
    try {
      responseSnapshot.authCalled = true;
      const authResponse = await client.createAuthToken();
      responseSnapshot.authHttpStatus = authResponse.status;
      responseSnapshot.authContentType = authResponse.contentType;
      accessToken = getNavlungoAccessTokenFromAuthBody(authResponse.body);
      responseSnapshot.authTokenReceived = Boolean(accessToken);
      if (!authResponse.ok || !accessToken) {
        throw new ProviderExecutionError('Navlungo authentication failed before Create Post.', {
          ...responseSnapshot,
          providerError: readStringFromRecord(authResponse.body, ['message', 'error']) ?? 'Navlungo auth response did not include an access token.',
        });
      }
    } catch (error) {
      if (error instanceof ProviderExecutionError) {
        throw error;
      }
      throw new ProviderExecutionError('Navlungo authentication failed before Create Post.', {
        ...responseSnapshot,
        providerError: error instanceof Error ? error.message : 'Unknown Navlungo auth error.',
      });
    }

    let createResponse: NavlungoHttpResponse;
    try {
      responseSnapshot.createPostCalled = true;
      createResponse = await client.createPost(accessToken, payload);
    } catch (error) {
      throw new ProviderExecutionError('Navlungo Create Post request failed before provider response.', {
        ...responseSnapshot,
        lastProviderStage: 'create_post',
        providerError: error instanceof Error ? error.message : 'Unknown Navlungo Create Post error.',
      });
    }

    const createData = getNavlungoResponseData(createResponse.body);
    const createDiagnostics = buildCreatePostDiagnostics(createResponse, createData);
    Object.assign(responseSnapshot, {
      createPost: createDiagnostics,
      createPostHttpStatus: createResponse.status,
      createPostResponseKeys: createDiagnostics.topLevelKeys,
      createPostDataKeys: createDiagnostics.dataKeys,
      providerMessage: createDiagnostics.providerMessage,
    });

    if (!createResponse.ok) {
      throw new ProviderExecutionError(`Navlungo Create Post failed with HTTP ${createResponse.status}.`, {
        ...responseSnapshot,
        lastProviderStage: 'create_post',
        providerError: createDiagnostics.providerMessage ?? `Navlungo Create Post failed with HTTP ${createResponse.status}.`,
      });
    }

    const postNumber = readString(createData, ['post_number']);
    if (!postNumber) {
      throw new ProviderExecutionError('Navlungo Create Post succeeded but did not return post_number.', {
        ...responseSnapshot,
        lastProviderStage: 'create_post',
        providerError: 'Missing post_number in Navlungo Create Post response.',
      });
    }

    let checkData: Record<string, unknown> = {};
    let checkWarning: string | null = null;
    try {
      responseSnapshot.checkPostCalled = true;
      const checkResponse = await client.checkPost(accessToken, postNumber);
      checkData = checkResponse.ok ? getNavlungoResponseData(checkResponse.body) : {};
      checkWarning = checkResponse.ok ? null : `Navlungo Check Post failed with HTTP ${checkResponse.status}.`;
      Object.assign(responseSnapshot, {
        checkPost: buildCheckPostDiagnostics(checkResponse, checkData, checkWarning),
        checkPostHttpStatus: checkResponse.status,
      });
    } catch (error) {
      checkWarning = error instanceof Error ? error.message : 'Unknown Navlungo Check Post warning.';
      Object.assign(responseSnapshot, {
        checkPost: buildCheckPostDiagnostics(null, {}, checkWarning),
      });
    }

    const createPost = getNavlungoPostRecord(createData);
    const checkPost = getNavlungoPostRecord(checkData);
    const trackingNumber =
      readString(checkData, ['carrier_tracking_code', 'carrier_post_number']) ??
      readString(createData, ['carrier_tracking_code', 'carrier_post_number']) ??
      postNumber;
    const trackingUrl =
      readString(checkData, ['carrier_tracking_url', 'tracking_url']) ??
      readString(createData, ['carrier_tracking_url', 'tracking_url']);
    const barcode = readNavlungoBarcode(checkData) ?? readNavlungoBarcode(createData);
    const status = checkData.status ?? createData.status;
    const carrierName =
      readString(checkPost, ['carrier_name']) ??
      readString(createPost, ['carrier_name']) ??
      NAVLUNGO_PROVIDER_DISPLAY_NAME;
    const carrierId = readNumberOrString(checkPost, ['carrier_id']) ?? readNumberOrString(createPost, ['carrier_id']);

    return {
      providerShipmentId: postNumber,
      trackingNumber,
      trackingUrl,
      labelUrl: barcode,
      shipmentStatus: mapNavlungoShipmentStatus(status),
      shippingCost: null,
      shippingVat: null,
      currency: 'TRY',
      responseSnapshot: {
        ...responseSnapshot,
        ok: true,
        providerShipmentId: postNumber,
        trackingNumberPresent: Boolean(trackingNumber),
        trackingUrlPresent: Boolean(trackingUrl),
        labelUrlPresent: Boolean(barcode),
        barcodePresent: Boolean(barcode),
        barcode,
        carrierName,
        carrierId,
        statusField: isRecord(status)
          ? readString(status, ['status_name', 'statusName', 'name']) ?? readString(status, ['status_code', 'statusCode', 'code'])
          : typeof status === 'string'
            ? status
            : null,
        checkPostWarning: checkWarning,
        returnReverseImplemented: false,
        lastProviderResponseAt: new Date().toISOString(),
      },
    };
  }

  async getShipmentStatus(): Promise<ShippingProviderCreateResult> {
    throw new Error('Navlungo status polling is not implemented yet.');
  }

  async getTrackingInfo(): Promise<ShippingProviderCreateResult> {
    throw new Error('Navlungo tracking lookup is not implemented yet.');
  }

  async cancelShipment(): Promise<ShippingProviderCreateResult> {
    throw new Error('Navlungo shipment cancellation is not implemented yet.');
  }

  async createReturnShipment(): Promise<never> {
    throw new Error('Navlungo return shipment creation is not implemented yet.');
  }
}
