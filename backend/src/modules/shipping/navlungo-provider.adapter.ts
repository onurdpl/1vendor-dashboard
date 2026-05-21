import type { AppEnv } from '../../config/env.js';
import type {
  ShippingProviderAdapter,
  ShippingProviderCreateInput,
  ShippingProviderCreateResult,
} from './shipping-provider.adapter.js';

export const NAVLUNGO_PROVIDER_KEY = 'navlungo' as const;
export const NAVLUNGO_PROVIDER_DISPLAY_NAME = 'Navlungo';

export const NAVLUNGO_ENV_NAMES = {
  baseUrl: 'NAVLUNGO_BASE_URL',
  apiUsername: 'NAVLUNGO_API_USERNAME',
  apiPassword: 'NAVLUNGO_API_PASSWORD',
  defaultSenderAddressId: 'NAVLUNGO_DEFAULT_SENDER_ADDRESS_ID',
  defaultBarcodeFormat: 'NAVLUNGO_DEFAULT_BARCODE_FORMAT',
} as const;

const NAVLUNGO_UNIMPLEMENTED_MESSAGE = 'Navlungo adapter is dormant. Runtime shipment execution is not implemented yet.';

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

type NavlungoHttpResponse<TBody = unknown> = {
  ok: boolean;
  status: number;
  contentType: string;
  body: TBody;
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

  requestUrl(path: string) {
    if (!this.env.NAVLUNGO_BASE_URL) {
      throw new Error('NAVLUNGO_BASE_URL is not configured.');
    }

    return `${this.env.NAVLUNGO_BASE_URL.replace(/\/$/, '')}${path}`;
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
      tokenReceived: rootAccessToken || dataAccessToken || dataToken,
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
    runtimeShipmentExecutionEnabled: false,
    missing,
  };
}

export class NavlungoAdapter implements ShippingProviderAdapter {
  provider = 'NAVLUNGO' as const;

  async createShipment(_input: ShippingProviderCreateInput): Promise<ShippingProviderCreateResult> {
    throw new Error(NAVLUNGO_UNIMPLEMENTED_MESSAGE);
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
