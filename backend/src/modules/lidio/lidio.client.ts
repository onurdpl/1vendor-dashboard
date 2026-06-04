import type { LidioReadOnlyConfig } from './lidio.config.js';

type JsonRecord = Record<string, unknown>;

type LidioRequestOptions = {
  path: string;
  body?: JsonRecord;
};

export type LidioHttpResponse = {
  ok: boolean;
  status: number;
  contentType: string | null;
  body: unknown;
  request: {
    method: 'POST';
    path: string;
    bodyKeys: string[];
  };
};

export type LidioHttpClientOptions = {
  config: Pick<LidioReadOnlyConfig, 'baseUrl' | 'merchantCode' | 'authorizationScheme' | 'authorizationToken'>;
  fetchImpl?: typeof fetch;
};

function normalizeBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, '');
}

function normalizePath(value: string) {
  const trimmed = value.trim();
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getBodyKeys(body: unknown) {
  return isRecord(body) ? Object.keys(body).sort() : [];
}

function parseBody(text: string, contentType: string | null): unknown {
  if (!text) {
    return null;
  }

  if (!contentType?.toLowerCase().includes('json')) {
    return text;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export class LidioHttpClient {
  private readonly baseUrl: string;
  private readonly merchantCode: string;
  private readonly authorizationScheme: string;
  private readonly authorizationToken: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: LidioHttpClientOptions) {
    this.baseUrl = normalizeBaseUrl(options.config.baseUrl);
    this.merchantCode = options.config.merchantCode;
    this.authorizationScheme = options.config.authorizationScheme;
    this.authorizationToken = options.config.authorizationToken;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async request(options: LidioRequestOptions): Promise<LidioHttpResponse> {
    const path = normalizePath(options.path);
    const body = options.body ?? {};
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        MerchantCode: this.merchantCode,
        Authorization: `${this.authorizationScheme} ${this.authorizationToken}`,
      },
      body: JSON.stringify(body),
    });
    const contentType = response.headers.get('content-type');
    const text = await response.text();

    return {
      ok: response.ok,
      status: response.status,
      contentType,
      body: parseBody(text, contentType),
      request: {
        method: 'POST',
        path,
        bodyKeys: getBodyKeys(body),
      },
    };
  }
}
