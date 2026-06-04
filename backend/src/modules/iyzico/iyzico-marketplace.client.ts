import { createHmac, randomUUID } from 'node:crypto';
import type { AppEnv } from '../../config/env.js';

export const IYZICO_SANDBOX_BASE_URL = 'https://sandbox-api.iyzipay.com';

export const IYZICO_MARKETPLACE_ENDPOINTS = {
  createSubMerchant: '/onboarding/submerchant',
  retrieveSubMerchant: '/onboarding/submerchant/detail',
  initializeCheckoutForm: '/payment/iyzipos/checkoutform/initialize/auth/ecom',
  retrieveCheckoutFormResult: '/payment/iyzipos/checkoutform/auth/ecom/detail',
  retrievePaymentDetail: '/payment/detail',
  approvePaymentItem: '/payment/iyzipos/item/approve',
  disapprovePaymentItem: '/payment/iyzipos/item/disapprove',
  updatePaymentItem: '/payment/item',
  refundPaymentTransaction: '/payment/refund',
  cancelPayment: '/payment/cancel',
} as const;

type HttpMethod = 'POST' | 'PUT';
type JsonRecord = Record<string, unknown>;

export type IyzicoMarketplaceClientOptions = {
  apiKey: string;
  secretKey: string;
  baseUrl: string;
  fetchImpl?: typeof fetch;
  randomKeyGenerator?: () => string;
};

export type IyzicoRequestSummary = {
  method: HttpMethod;
  endpointPath: string;
  requestBodyKeys: string[];
  authorizationHeaderPresent: boolean;
};

export type IyzicoHttpResult = {
  ok: boolean;
  status: number;
  contentType: string | null;
  body: unknown;
  request: IyzicoRequestSummary;
};

export type IyzicoSandboxConfigDiagnostics = {
  apiKeyPresent: boolean;
  secretKeyPresent: boolean;
  baseUrlPresent: boolean;
  baseUrl: string | null;
  expectedBaseUrl: typeof IYZICO_SANDBOX_BASE_URL;
  sandboxBaseUrlValid: boolean;
};

function normalizeBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, '');
}

function readEnvValue(env: AppEnv, key: keyof Pick<AppEnv, 'IYZICO_SANDBOX_API_KEY' | 'IYZICO_SANDBOX_SECRET_KEY' | 'IYZICO_SANDBOX_BASE_URL'>) {
  return env[key]?.trim() ?? '';
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getBodyKeys(payload: unknown) {
  return isRecord(payload) ? Object.keys(payload).sort() : [];
}

function parseJsonBody(text: string, contentType: string | null): unknown {
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

export function createIyzicoAuthorizationHeader(input: {
  apiKey: string;
  secretKey: string;
  randomKey: string;
  uriPath: string;
  rawBody: string;
}) {
  const signature = createHmac('sha256', input.secretKey)
    .update(`${input.randomKey}${input.uriPath}${input.rawBody}`)
    .digest('hex');
  const authorizationPayload = `apiKey:${input.apiKey}&randomKey:${input.randomKey}&signature:${signature}`;

  return `IYZWSv2 ${Buffer.from(authorizationPayload, 'utf8').toString('base64')}`;
}

export function getIyzicoSandboxConfigDiagnostics(env: AppEnv): IyzicoSandboxConfigDiagnostics {
  const baseUrl = readEnvValue(env, 'IYZICO_SANDBOX_BASE_URL');
  const normalizedBaseUrl = baseUrl ? normalizeBaseUrl(baseUrl) : '';

  return {
    apiKeyPresent: Boolean(readEnvValue(env, 'IYZICO_SANDBOX_API_KEY')),
    secretKeyPresent: Boolean(readEnvValue(env, 'IYZICO_SANDBOX_SECRET_KEY')),
    baseUrlPresent: Boolean(baseUrl),
    baseUrl: normalizedBaseUrl || null,
    expectedBaseUrl: IYZICO_SANDBOX_BASE_URL,
    sandboxBaseUrlValid: normalizedBaseUrl === IYZICO_SANDBOX_BASE_URL,
  };
}

export function validateIyzicoSandboxConfig(env: AppEnv) {
  const diagnostics = getIyzicoSandboxConfigDiagnostics(env);
  const missing = [
    diagnostics.apiKeyPresent ? null : 'IYZICO_SANDBOX_API_KEY',
    diagnostics.secretKeyPresent ? null : 'IYZICO_SANDBOX_SECRET_KEY',
    diagnostics.baseUrlPresent ? null : 'IYZICO_SANDBOX_BASE_URL',
  ].filter((key): key is string => Boolean(key));

  if (missing.length) {
    return {
      ok: false as const,
      statusCode: 422,
      message: 'Required iyzico sandbox env vars are missing.',
      diagnostics: {
        ...diagnostics,
        missing,
      },
    };
  }

  if (!diagnostics.sandboxBaseUrlValid) {
    return {
      ok: false as const,
      statusCode: 422,
      message: 'IYZICO_SANDBOX_BASE_URL must be the iyzico sandbox API URL.',
      diagnostics,
    };
  }

  return {
    ok: true as const,
    config: {
      apiKey: readEnvValue(env, 'IYZICO_SANDBOX_API_KEY'),
      secretKey: readEnvValue(env, 'IYZICO_SANDBOX_SECRET_KEY'),
      baseUrl: normalizeBaseUrl(readEnvValue(env, 'IYZICO_SANDBOX_BASE_URL')),
    },
    diagnostics,
  };
}

export class IyzicoMarketplaceClient {
  private readonly apiKey: string;
  private readonly secretKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly randomKeyGenerator: () => string;

  constructor(options: IyzicoMarketplaceClientOptions) {
    this.apiKey = options.apiKey;
    this.secretKey = options.secretKey;
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.randomKeyGenerator = options.randomKeyGenerator ?? (() => `${Date.now()}-${randomUUID()}`);
  }

  async createSubMerchant(payload: JsonRecord) {
    return this.request('POST', IYZICO_MARKETPLACE_ENDPOINTS.createSubMerchant, payload);
  }

  async retrieveSubMerchant(subMerchantExternalId: string) {
    return this.request('POST', IYZICO_MARKETPLACE_ENDPOINTS.retrieveSubMerchant, {
      locale: 'en',
      subMerchantExternalId,
    });
  }

  async initializeMarketplaceCheckoutForm(payload: JsonRecord) {
    return this.request('POST', IYZICO_MARKETPLACE_ENDPOINTS.initializeCheckoutForm, payload);
  }

  async retrieveCheckoutFormResult(token: string, conversationId: string) {
    return this.request('POST', IYZICO_MARKETPLACE_ENDPOINTS.retrieveCheckoutFormResult, {
      locale: 'en',
      conversationId,
      token,
    });
  }

  async retrievePaymentDetail(paymentId: string, paymentConversationId?: string) {
    return this.request('POST', IYZICO_MARKETPLACE_ENDPOINTS.retrievePaymentDetail, {
      locale: 'en',
      paymentId,
      ...(paymentConversationId ? { paymentConversationId } : {}),
    });
  }

  async approvePaymentItem(paymentTransactionId: string) {
    return this.request('POST', IYZICO_MARKETPLACE_ENDPOINTS.approvePaymentItem, {
      locale: 'en',
      paymentTransactionId,
    });
  }

  async disapprovePaymentItem(paymentTransactionId: string) {
    return this.request('POST', IYZICO_MARKETPLACE_ENDPOINTS.disapprovePaymentItem, {
      locale: 'en',
      paymentTransactionId,
    });
  }

  async updatePaymentItem(paymentTransactionId: string, subMerchantKey: string, subMerchantPrice: string | number) {
    return this.request('PUT', IYZICO_MARKETPLACE_ENDPOINTS.updatePaymentItem, {
      locale: 'en',
      paymentTransactionId,
      subMerchantKey,
      subMerchantPrice,
    });
  }

  async refundPaymentTransaction(paymentTransactionId: string, price: string | number, currency: string) {
    return this.request('POST', IYZICO_MARKETPLACE_ENDPOINTS.refundPaymentTransaction, {
      locale: 'en',
      paymentTransactionId,
      price,
      currency,
    });
  }

  async cancelPayment(paymentId: string) {
    return this.request('POST', IYZICO_MARKETPLACE_ENDPOINTS.cancelPayment, {
      locale: 'en',
      paymentId,
    });
  }

  private async request(method: HttpMethod, endpointPath: string, payload: JsonRecord): Promise<IyzicoHttpResult> {
    const rawBody = JSON.stringify(payload);
    const authorization = createIyzicoAuthorizationHeader({
      apiKey: this.apiKey,
      secretKey: this.secretKey,
      randomKey: this.randomKeyGenerator(),
      uriPath: endpointPath,
      rawBody,
    });

    const response = await this.fetchImpl(`${this.baseUrl}${endpointPath}`, {
      method,
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/json',
      },
      body: rawBody,
    });
    const contentType = response.headers.get('content-type');
    const text = await response.text();

    return {
      ok: response.ok,
      status: response.status,
      contentType,
      body: parseJsonBody(text, contentType),
      request: {
        method,
        endpointPath,
        requestBodyKeys: getBodyKeys(payload),
        authorizationHeaderPresent: true,
      },
    };
  }
}

export function createIyzicoMarketplaceClientFromEnv(env: AppEnv, options: Pick<IyzicoMarketplaceClientOptions, 'fetchImpl' | 'randomKeyGenerator'> = {}) {
  const validation = validateIyzicoSandboxConfig(env);
  if (!validation.ok) {
    throw new Error(validation.message);
  }

  return new IyzicoMarketplaceClient({
    ...validation.config,
    ...options,
  });
}
