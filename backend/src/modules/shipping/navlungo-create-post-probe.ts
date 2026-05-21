import {
  getNavlungoAccessTokenFromAuthBody,
  NavlungoHttpClient,
  type NavlungoCreatePostPayload,
} from './navlungo-provider.adapter.js';

type ProbeEnv = Record<string, unknown>;

type ProbeLogger = Pick<Console, 'log' | 'error'>;

type ProbeOptions = {
  env?: ProbeEnv;
  fetchImpl?: typeof fetch;
  logger?: ProbeLogger;
  now?: () => number;
};

export type NavlungoCreatePostProbeDiagnostics = {
  provider: 'navlungo';
  dormant: true;
  authHttpStatus: number | null;
  authContentType: string | null;
  authTokenReceived: boolean;
  requestedCarrierId: number;
  requestedPostType: number;
  requestedBarcodeFormat: string;
  codPaymentIncluded: boolean;
  priceIncluded: boolean;
  createPostHttpStatus: number | null;
  createPostContentType: string | null;
  responseShape: { kind: string; topLevelKeys: string[] } | null;
  dataShape: { kind: string; topLevelKeys: string[] } | null;
  topLevelKeys: string[];
  dataKeys: string[];
  postNumber: string | null;
  postNumberPresent: boolean;
  referenceId: string | null;
  referenceIdPresent: boolean;
  trackingUrlPresent: boolean;
  barcodeUrlPresent: boolean;
  barcodePresent: boolean;
  barcodeType: string | null;
  carrierIdPresent: boolean;
  carrierId: string | number | null;
  carrierNamePresent: boolean;
  carrierName: string | null;
  postCarrierKeys: string[];
  providerMessage: string | null;
  errorMessage: string | null;
};

export type NavlungoCheckPostProbeDiagnostics = {
  provider: 'navlungo';
  dormant: true;
  postNumber: string;
  authHttpStatus: number | null;
  authContentType: string | null;
  authTokenReceived: boolean;
  checkPostHttpStatus: number | null;
  checkPostContentType: string | null;
  responseShape: { kind: string; topLevelKeys: string[] } | null;
  dataShape: { kind: string; topLevelKeys: string[] } | null;
  dataKeys: string[];
  statusKeys: string[];
  postNumberPresent: boolean;
  trackingUrlPresent: boolean;
  carrierTrackingUrlPresent: boolean;
  barcodePresent: boolean;
  barcodeType: string | null;
  carrierIdPresent: boolean;
  carrierNamePresent: boolean;
  statusCode: string | number | null;
  statusName: string | null;
  providerMessage: string | null;
  errorMessage: string | null;
};

export type NavlungoBarcodeProbeDiagnostics = {
  provider: 'navlungo';
  dormant: true;
  postNumber: string;
  barcodeEndpointPathKnown: boolean;
  skippedReason: 'barcode_endpoint_path_unknown';
  barcodeHttpStatus: number | null;
  barcodeContentType: string | null;
  responseShape: { kind: string; topLevelKeys: string[] } | null;
  barcodeFieldPresent: boolean;
  barcodeUrlPresent: boolean;
  barcodeBase64Present: boolean;
  providerMessage: string | null;
  errorMessage: string | null;
};

export type NavlungoCreatePostProbeValidationResult =
  | { ok: true }
  | {
      ok: false;
      reason: string;
      diagnostics: NavlungoCreatePostProbeGuardDiagnostics;
    };

const SENSITIVE_KEY_PATTERN = /token|secret|authorization|password|username/i;
const PII_KEY_PATTERN = /phone|email|address|name/i;

export type NavlungoCreatePostProbeGuardDiagnostics = {
  createPostProbeEnvPresent: boolean;
  createPostProbeEnvValueIsYES: boolean;
};

export const NAVLUNGO_CREATE_POST_PROBE_DEFAULT_CARRIER_ID = 9;
export const NAVLUNGO_CREATE_POST_PROBE_POST_TYPE = 2;
export const NAVLUNGO_CREATE_POST_PROBE_DEFAULT_BARCODE_FORMAT = 'pdf-A6';

export function getNavlungoCreatePostProbeGuardDiagnostics(env: ProbeEnv): NavlungoCreatePostProbeGuardDiagnostics {
  const value = env.NAVLUNGO_CREATE_POST_PROBE_CONFIRM;
  const trimmedValue = typeof value === 'string' ? value.trim() : '';
  return {
    createPostProbeEnvPresent: Boolean(trimmedValue),
    createPostProbeEnvValueIsYES: trimmedValue === 'YES',
  };
}

export function validateNavlungoCreatePostProbeEnv(env: ProbeEnv): NavlungoCreatePostProbeValidationResult {
  const diagnostics = getNavlungoCreatePostProbeGuardDiagnostics(env);
  if (!diagnostics.createPostProbeEnvValueIsYES) {
    return {
      ok: false,
      reason: 'NAVLUNGO_CREATE_POST_PROBE_CONFIRM=YES is required for the manual Navlungo Create Post probe.',
      diagnostics,
    };
  }

  const required = [
    'NAVLUNGO_BASE_URL',
    'NAVLUNGO_API_USERNAME',
    'NAVLUNGO_API_PASSWORD',
    'NAVLUNGO_DEFAULT_SENDER_ADDRESS_ID',
    'NAVLUNGO_DEFAULT_BARCODE_FORMAT',
  ];
  const missing = required.filter((key) => typeof env[key] !== 'string' || !(env[key] as string).trim());
  if (missing.length) {
    return {
      ok: false,
      reason: `${missing.join(', ')} required for the manual Navlungo Create Post probe.`,
      diagnostics,
    };
  }

  const carrierId = parseNavlungoCreatePostProbeCarrierId(env);
  if (!Number.isInteger(carrierId) || carrierId <= 0) {
    return {
      ok: false,
      reason: 'NAVLUNGO_DEFAULT_CARRIER_ID must be a positive numeric carrier id when provided.',
      diagnostics,
    };
  }

  return { ok: true };
}

export function parseNavlungoCreatePostProbeCarrierId(env: ProbeEnv) {
  const raw = env.NAVLUNGO_DEFAULT_CARRIER_ID;
  if (typeof raw !== 'string' || !raw.trim()) {
    return NAVLUNGO_CREATE_POST_PROBE_DEFAULT_CARRIER_ID;
  }

  const parsed = Number(raw.trim());
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function getNavlungoCreatePostProbeBarcodeFormat(env: ProbeEnv) {
  return typeof env.NAVLUNGO_DEFAULT_BARCODE_FORMAT === 'string' && env.NAVLUNGO_DEFAULT_BARCODE_FORMAT.trim()
    ? env.NAVLUNGO_DEFAULT_BARCODE_FORMAT.trim()
    : NAVLUNGO_CREATE_POST_PROBE_DEFAULT_BARCODE_FORMAT;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readRecord(value: unknown, key: string) {
  return isRecord(value) && isRecord(value[key]) ? value[key] : null;
}

function readString(value: unknown, key: string) {
  const field = isRecord(value) ? value[key] : null;
  return typeof field === 'string' && field.trim() ? field.trim() : null;
}

function readNumberOrString(value: unknown, key: string) {
  const field = isRecord(value) ? value[key] : null;
  return typeof field === 'string' || typeof field === 'number' ? field : null;
}

function responseKeys(value: unknown) {
  return isRecord(value) ? Object.keys(value) : [];
}

function summarizeShape(value: unknown) {
  if (Array.isArray(value)) {
    return { kind: 'json:array', topLevelKeys: [] };
  }
  if (isRecord(value)) {
    return { kind: 'json:object', topLevelKeys: Object.keys(value) };
  }
  if (value === null || value === undefined || value === '') {
    return { kind: 'empty', topLevelKeys: [] };
  }
  return { kind: typeof value, topLevelKeys: [] };
}

export function sanitizeNavlungoProbeOutput(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeNavlungoProbeOutput(item));
  }

  if (!isRecord(value)) {
    if (typeof value === 'string' && value.length > 240) {
      return `${value.slice(0, 120)}...[truncated]`;
    }
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        return [key, item ? '[redacted]' : item];
      }
      if (PII_KEY_PATTERN.test(key)) {
        return [key, item ? '[redacted]' : item];
      }
      return [key, sanitizeNavlungoProbeOutput(item)];
    }),
  );
}

export function buildNavlungoCreatePostProbePayload(env: ProbeEnv, now: () => number = Date.now): NavlungoCreatePostPayload {
  const referenceId = `NAVLUNGO-PROBE-${now()}`;
  const carrierId = parseNavlungoCreatePostProbeCarrierId(env);
  if (!Number.isInteger(carrierId) || carrierId <= 0) {
    throw new Error('NAVLUNGO_DEFAULT_CARRIER_ID must be a positive numeric carrier id when provided.');
  }

  return {
    platform: 'shopify',
    posts: [
      {
        reference_id: referenceId,
        carrier_id: carrierId,
        post_type: NAVLUNGO_CREATE_POST_PROBE_POST_TYPE,
        sender: {
          name: 'Navlungo Test Sender',
          phone: '+90 532 123 45 67',
          email: 'sender.test@example.invalid',
          address: 'Navlungo manual probe sender address',
          country: 'tr',
          city: 'Istanbul',
          district: 'Kadikoy',
          post_code: '',
        },
        recipient: {
          name: 'Navlungo Test Recipient',
          phone: '+90 532 123 45 68',
          email: 'recipient.test@example.invalid',
          address: 'Navlungo manual probe recipient address',
          country: 'tr',
          city: 'Istanbul',
          district: 'Kartal',
          post_code: '',
        },
        post: {
          desi: 1,
          package_count: 1,
          note: 'Manual Navlungo Create Post probe. Do not fulfill Shopify.',
        },
        barcode_format: getNavlungoCreatePostProbeBarcodeFormat(env),
        custom_data_1: 'manual_probe',
        custom_data_2: 'no_shopify_sync',
        custom_data_3: 'no_db_write',
        custom_data_4: '',
      },
    ],
  };
}

export function summarizeNavlungoCreatePostResponse(body: unknown) {
  const data = isRecord(body) && Array.isArray(body.data) ? body.data[0] : readRecord(body, 'data');
  const responseRoot = isRecord(data) ? data : body;
  const responseRecord = isRecord(responseRoot) ? responseRoot : {};
  const post = readRecord(responseRoot, 'post');

  return {
    responseShape: summarizeShape(body),
    dataShape: data ? summarizeShape(data) : null,
    topLevelKeys: responseKeys(body),
    dataKeys: data ? responseKeys(data) : [],
    postNumber: readString(responseRoot, 'post_number'),
    postNumberPresent: Boolean(readString(responseRoot, 'post_number')),
    referenceId: readString(responseRoot, 'reference_id'),
    referenceIdPresent: Boolean(readString(responseRoot, 'reference_id')),
    trackingUrlPresent: Boolean(readString(responseRoot, 'tracking_url')),
    barcodeUrlPresent: Boolean(readString(responseRoot, 'barcode_url')),
    barcodePresent: responseRecord.barcode !== null && responseRecord.barcode !== undefined,
    barcodeType: responseRecord.barcode === null || responseRecord.barcode === undefined ? null : Array.isArray(responseRecord.barcode) ? 'array' : typeof responseRecord.barcode,
    carrierIdPresent: post ? post.carrier_id !== null && post.carrier_id !== undefined : false,
    carrierId: post ? readNumberOrString(post, 'carrier_id') : null,
    carrierNamePresent: Boolean(post ? readString(post, 'carrier_name') : null),
    carrierName: post ? readString(post, 'carrier_name') : null,
    postCarrierKeys: post ? responseKeys(post).filter((key) => key.toLowerCase().includes('carrier')) : [],
    providerMessage: readString(body, 'message') ?? readString(body, 'error'),
  };
}

export function summarizeNavlungoCheckPostResponse(body: unknown) {
  const data = readRecord(body, 'data');
  const post = readRecord(data, 'post');
  const status = readRecord(data, 'status');

  return {
    responseShape: summarizeShape(body),
    dataShape: data ? summarizeShape(data) : null,
    dataKeys: data ? responseKeys(data) : [],
    statusKeys: status ? responseKeys(status) : [],
    postNumberPresent: Boolean(data ? readString(data, 'post_number') : null),
    trackingUrlPresent: Boolean(data ? readString(data, 'tracking_url') : null),
    carrierTrackingUrlPresent: Boolean(data ? readString(data, 'carrier_tracking_url') : null),
    barcodePresent: data ? data.barcode !== null && data.barcode !== undefined : false,
    barcodeType: data && data.barcode !== null && data.barcode !== undefined ? (Array.isArray(data.barcode) ? 'array' : typeof data.barcode) : null,
    carrierIdPresent: post ? post.carrier_id !== null && post.carrier_id !== undefined : false,
    carrierNamePresent: Boolean(post ? readString(post, 'carrier_name') : null),
    statusCode: status ? readNumberOrString(status, 'status_code') : null,
    statusName: status ? readString(status, 'status_name') : null,
    providerMessage: readString(body, 'message') ?? readString(body, 'error'),
  };
}

function buildPayloadSummary(payload: NavlungoCreatePostPayload, senderAddressId: string) {
  const post = payload.posts[0];
  return {
    platform: payload.platform,
    referenceId: post.reference_id,
    carrierId: post.carrier_id,
    postType: post.post_type,
    barcodeFormat: post.barcode_format,
    codPaymentIncluded: post.cod_payment_type !== undefined,
    priceIncluded: post.post.price !== undefined,
    senderAddressIdConfigured: Boolean(senderAddressId.trim()),
    senderCity: post.sender.city,
    senderDistrict: post.sender.district,
    recipientCity: post.recipient.city,
    recipientDistrict: post.recipient.district,
    packageCount: post.post.package_count,
    desi: post.post.desi,
  };
}

export async function runManualNavlungoCreatePostProbe(options: ProbeOptions = {}) {
  const env = options.env ?? process.env;
  const logger = options.logger ?? console;
  const validation = validateNavlungoCreatePostProbeEnv(env);

  if (!validation.ok) {
    throw new Error(validation.reason);
  }

  logger.log('MANUAL ONLY: Navlungo Create Post probe starting.');
  logger.log('This can create one Navlungo test post. No DB write, Shopify sync, fulfillment, retry, or webhook behavior will run.');

  const diagnostics = await runNavlungoCreatePostProbeDiagnostics(options);

  logger.log(JSON.stringify({
    label: 'POST /auth/api',
    status: diagnostics.authHttpStatus,
    contentType: diagnostics.authContentType,
    tokenReceived: diagnostics.authTokenReceived,
  }, null, 2));

  const payload = buildNavlungoCreatePostProbePayload(env, options.now);
  logger.log(JSON.stringify({
    label: 'POST /post/create payload summary',
    ...buildPayloadSummary(payload, typeof env.NAVLUNGO_DEFAULT_SENDER_ADDRESS_ID === 'string' ? env.NAVLUNGO_DEFAULT_SENDER_ADDRESS_ID : ''),
  }, null, 2));

  logger.log(JSON.stringify({
    label: 'POST /post/create',
    requestedCarrierId: diagnostics.requestedCarrierId,
    requestedPostType: diagnostics.requestedPostType,
    requestedBarcodeFormat: diagnostics.requestedBarcodeFormat,
    codPaymentIncluded: diagnostics.codPaymentIncluded,
    priceIncluded: diagnostics.priceIncluded,
    status: diagnostics.createPostHttpStatus,
    contentType: diagnostics.createPostContentType,
    responseShape: diagnostics.responseShape,
    dataShape: diagnostics.dataShape,
    topLevelKeys: diagnostics.topLevelKeys,
    dataKeys: diagnostics.dataKeys,
    postNumber: diagnostics.postNumber,
    postNumberPresent: diagnostics.postNumberPresent,
    referenceId: diagnostics.referenceId,
    referenceIdPresent: diagnostics.referenceIdPresent,
    trackingUrlPresent: diagnostics.trackingUrlPresent,
    barcodeUrlPresent: diagnostics.barcodeUrlPresent,
    barcodePresent: diagnostics.barcodePresent,
    barcodeType: diagnostics.barcodeType,
    carrierIdPresent: diagnostics.carrierIdPresent,
    carrierId: diagnostics.carrierId,
    carrierNamePresent: diagnostics.carrierNamePresent,
    carrierName: diagnostics.carrierName,
    postCarrierKeys: diagnostics.postCarrierKeys,
    providerMessage: diagnostics.providerMessage,
    errorMessage: diagnostics.errorMessage,
  }, null, 2));
}

export async function runNavlungoCreatePostProbeDiagnostics(options: ProbeOptions = {}): Promise<NavlungoCreatePostProbeDiagnostics> {
  const env = options.env ?? process.env;
  const validation = validateNavlungoCreatePostProbeEnv(env);

  if (!validation.ok) {
    throw new Error(validation.reason);
  }

  const client = new NavlungoHttpClient(
    {
      NAVLUNGO_BASE_URL: typeof env.NAVLUNGO_BASE_URL === 'string' ? env.NAVLUNGO_BASE_URL : undefined,
      NAVLUNGO_API_USERNAME: typeof env.NAVLUNGO_API_USERNAME === 'string' ? env.NAVLUNGO_API_USERNAME : undefined,
      NAVLUNGO_API_PASSWORD: typeof env.NAVLUNGO_API_PASSWORD === 'string' ? env.NAVLUNGO_API_PASSWORD : undefined,
    },
    { fetchImpl: options.fetchImpl },
  );

  const authResponse = await client.createAuthToken();
  const accessToken = getNavlungoAccessTokenFromAuthBody(authResponse.body);
  if (!accessToken) {
    throw new Error('Navlungo auth response did not include a usable access token.');
  }

  const payload = buildNavlungoCreatePostProbePayload(env, options.now);
  const createResponse = await client.createPost(accessToken, payload);
  const summary = summarizeNavlungoCreatePostResponse(createResponse.body);

  return {
    provider: 'navlungo',
    dormant: true,
    authHttpStatus: authResponse.status,
    authContentType: authResponse.contentType,
    authTokenReceived: Boolean(accessToken),
    requestedCarrierId: payload.posts[0].carrier_id,
    requestedPostType: payload.posts[0].post_type,
    requestedBarcodeFormat: payload.posts[0].barcode_format,
    codPaymentIncluded: payload.posts[0].cod_payment_type !== undefined,
    priceIncluded: payload.posts[0].post.price !== undefined,
    createPostHttpStatus: createResponse.status,
    createPostContentType: createResponse.contentType,
    ...summary,
    errorMessage: null,
  };
}

export async function runNavlungoCheckPostProbeDiagnostics(options: ProbeOptions & { postNumber: string }): Promise<NavlungoCheckPostProbeDiagnostics> {
  const env = options.env ?? process.env;
  const postNumber = options.postNumber.trim();
  if (!postNumber) {
    throw new Error('postNumber is required for the Navlungo Check Post probe.');
  }

  const client = new NavlungoHttpClient(
    {
      NAVLUNGO_BASE_URL: typeof env.NAVLUNGO_BASE_URL === 'string' ? env.NAVLUNGO_BASE_URL : undefined,
      NAVLUNGO_API_USERNAME: typeof env.NAVLUNGO_API_USERNAME === 'string' ? env.NAVLUNGO_API_USERNAME : undefined,
      NAVLUNGO_API_PASSWORD: typeof env.NAVLUNGO_API_PASSWORD === 'string' ? env.NAVLUNGO_API_PASSWORD : undefined,
    },
    { fetchImpl: options.fetchImpl },
  );

  const authResponse = await client.createAuthToken();
  const accessToken = getNavlungoAccessTokenFromAuthBody(authResponse.body);
  if (!accessToken) {
    throw new Error('Navlungo auth response did not include a usable access token.');
  }

  const checkResponse = await client.checkPost(accessToken, postNumber);
  const summary = summarizeNavlungoCheckPostResponse(checkResponse.body);

  return {
    provider: 'navlungo',
    dormant: true,
    postNumber,
    authHttpStatus: authResponse.status,
    authContentType: authResponse.contentType,
    authTokenReceived: Boolean(accessToken),
    checkPostHttpStatus: checkResponse.status,
    checkPostContentType: checkResponse.contentType,
    ...summary,
    errorMessage: null,
  };
}

export function runNavlungoBarcodeProbeDiagnostics(postNumber: string): NavlungoBarcodeProbeDiagnostics {
  const normalizedPostNumber = postNumber.trim();
  if (!normalizedPostNumber) {
    throw new Error('postNumber is required for the Navlungo Barcode probe.');
  }

  return {
    provider: 'navlungo',
    dormant: true,
    postNumber: normalizedPostNumber,
    barcodeEndpointPathKnown: false,
    skippedReason: 'barcode_endpoint_path_unknown',
    barcodeHttpStatus: null,
    barcodeContentType: null,
    responseShape: null,
    barcodeFieldPresent: false,
    barcodeUrlPresent: false,
    barcodeBase64Present: false,
    providerMessage: 'Official Navlungo Barcode > Get Barcode page does not expose an endpoint path in the reviewed HTML.',
    errorMessage: null,
  };
}
