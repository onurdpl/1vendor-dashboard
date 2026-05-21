import {
  getNavlungoAccessTokenFromAuthBody,
  NavlungoHttpClient,
  type NavlungoCreatePostPayload,
} from './navlungo-provider.adapter.js';

type ProbeEnv = Record<string, string | undefined>;

type ProbeLogger = Pick<Console, 'log' | 'error'>;

type ProbeOptions = {
  env?: ProbeEnv;
  fetchImpl?: typeof fetch;
  logger?: ProbeLogger;
  now?: () => number;
};

export type NavlungoCreatePostProbeValidationResult =
  | { ok: true }
  | {
      ok: false;
      reason: string;
    };

const SENSITIVE_KEY_PATTERN = /token|secret|authorization|password|username/i;
const PII_KEY_PATTERN = /phone|email|address|name/i;

export function validateNavlungoCreatePostProbeEnv(env: ProbeEnv): NavlungoCreatePostProbeValidationResult {
  if (env.NAVLUNGO_CREATE_POST_PROBE_CONFIRM !== 'YES') {
    return {
      ok: false,
      reason: 'NAVLUNGO_CREATE_POST_PROBE_CONFIRM=YES is required for the manual Navlungo Create Post probe.',
    };
  }

  const required = [
    'NAVLUNGO_BASE_URL',
    'NAVLUNGO_API_USERNAME',
    'NAVLUNGO_API_PASSWORD',
    'NAVLUNGO_DEFAULT_SENDER_ADDRESS_ID',
    'NAVLUNGO_DEFAULT_BARCODE_FORMAT',
  ];
  const missing = required.filter((key) => !env[key]?.trim());
  if (missing.length) {
    return {
      ok: false,
      reason: `${missing.join(', ')} required for the manual Navlungo Create Post probe.`,
    };
  }

  return { ok: true };
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

  return {
    platform: 'shopify',
    posts: [
      {
        reference_id: referenceId,
        carrier_id: 1,
        post_type: 2,
        cod_payment_type: '',
        sender: {
          name: 'Navlungo Test Sender',
          phone: '+90 555 000 00 01',
          email: 'sender.test@example.invalid',
          address: 'Navlungo manual probe sender address',
          country: 'tr',
          city: 'Istanbul',
          district: 'Kadikoy',
          post_code: '',
        },
        recipient: {
          name: 'Navlungo Test Recipient',
          phone: '+90 555 000 00 02',
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
          price: '',
          note: 'Manual Navlungo Create Post probe. Do not fulfill Shopify.',
        },
        barcode_format: env.NAVLUNGO_DEFAULT_BARCODE_FORMAT?.trim() || 'pdf-A6',
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
    carrierIdPresent: post ? post.carrier_id !== null && post.carrier_id !== undefined : false,
    carrierNamePresent: Boolean(post ? readString(post, 'carrier_name') : null),
    postCarrierKeys: post ? responseKeys(post).filter((key) => key.toLowerCase().includes('carrier')) : [],
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

  const client = new NavlungoHttpClient(
    {
      NAVLUNGO_BASE_URL: env.NAVLUNGO_BASE_URL,
      NAVLUNGO_API_USERNAME: env.NAVLUNGO_API_USERNAME,
      NAVLUNGO_API_PASSWORD: env.NAVLUNGO_API_PASSWORD,
    },
    { fetchImpl: options.fetchImpl },
  );

  const authResponse = await client.createAuthToken();
  const accessToken = getNavlungoAccessTokenFromAuthBody(authResponse.body);
  logger.log(JSON.stringify({
    label: 'POST /auth/api',
    status: authResponse.status,
    contentType: authResponse.contentType,
    responseShape: summarizeShape(authResponse.body),
    tokenReceived: Boolean(accessToken),
  }, null, 2));

  if (!accessToken) {
    throw new Error('Navlungo auth response did not include a usable access token.');
  }

  const payload = buildNavlungoCreatePostProbePayload(env, options.now);
  logger.log(JSON.stringify({
    label: 'POST /post/create payload summary',
    ...buildPayloadSummary(payload, env.NAVLUNGO_DEFAULT_SENDER_ADDRESS_ID as string),
  }, null, 2));

  const createResponse = await client.createPost(accessToken, payload);
  logger.log(JSON.stringify({
    label: 'POST /post/create',
    status: createResponse.status,
    contentType: createResponse.contentType,
    ...summarizeNavlungoCreatePostResponse(createResponse.body),
  }, null, 2));
}
