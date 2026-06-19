import type { AppEnv } from '../../config/env.js';
import {
  KargonomiHttpClient,
  parseKargonomiShipment,
  type KargonomiRawHttpResponse,
  type KargonomiShipmentCreatePayloadInput,
} from './kargonomi-provider.adapter.js';

type ProbeEnv = Record<string, string | undefined>;

type ProbeLogger = Pick<Console, 'log' | 'error'>;

type ProbeOptions = {
  env?: ProbeEnv;
  fetchImpl?: typeof fetch;
  logger?: ProbeLogger;
};

export type KargonomiProbeValidationResult =
  | { ok: true }
  | {
      ok: false;
      reason: string;
    };

const DEFAULT_KARGONOMI_BASE_URL = 'https://app.kargonomi.com.tr/api/v1';

export function validateKargonomiProbeEnv(env: ProbeEnv): KargonomiProbeValidationResult {
  if (env.KARGONOMI_PROBE_CONFIRM !== 'YES') {
    return {
      ok: false,
      reason: 'KARGONOMI_PROBE_CONFIRM=YES is required for the manual/dev Kargonomi probe.',
    };
  }

  if (!env.KARGONOMI_API_TOKEN?.trim()) {
    return {
      ok: false,
      reason: 'KARGONOMI_API_TOKEN is required for the manual/dev Kargonomi probe.',
    };
  }

  if (env.KARGONOMI_PROBE_CONFIRM_PRICE === 'YES' && !env.KARGONOMI_PROBE_SHIPPING_PROVIDER_ID?.trim()) {
    return {
      ok: false,
      reason:
        'KARGONOMI_PROBE_SHIPPING_PROVIDER_ID is required when KARGONOMI_PROBE_CONFIRM_PRICE=YES.',
    };
  }

  return { ok: true };
}

export function sanitizeKargonomiProbeOutput(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeKargonomiProbeOutput(item));
  }

  if (!value || typeof value !== 'object') {
    if (typeof value === 'string' && value.length > 240) {
      return `${value.slice(0, 120)}...[truncated]`;
    }
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => {
      if (/token|secret|authorization|x-app-key|app[_-]?key|api[_-]?key|apikey|password/i.test(key)) {
        return [key, '[redacted]'];
      }
      if (/phone|email|address|name|tax/i.test(key)) {
        return [key, item ? '[redacted]' : item];
      }
      return [key, sanitizeKargonomiProbeOutput(item)];
    }),
  );
}

export function buildKargonomiProbeShipmentInput(): KargonomiShipmentCreatePayloadInput {
  return {
    sender: {
      sender_name: 'Kargonomi Test Sender',
      sender_email: 'sender.test@example.invalid',
      sender_tax_number: '11111111111',
      sender_tax_place: 'Test',
      sender_phone: '5555555555',
      sender_address: 'Test Sender Address No 1',
      sender_state_id: '34',
      sender_city_id: '828',
    },
    buyer: {
      buyer_name: 'Kargonomi Test Buyer',
      buyer_email: 'buyer.test@example.invalid',
      buyer_phone: '5551112233',
      buyer_address: 'Test Buyer Address No 1',
      buyer_state_id: '34',
      buyer_city_id: '828',
    },
    packages: [
      {
        content: 'Manual probe test package',
        barcode: 'KARGONOMI-PROBE-TEST-1',
        desi: '1',
      },
    ],
  };
}

function buildProbeAppEnv(env: ProbeEnv): AppEnv {
  return {
    NODE_ENV: 'test',
    PORT: 4000,
    DATABASE_URL: undefined,
    CORS_ORIGIN: [],
    JWT_SECRET: 'manual-probe-unused',
    JWT_EXPIRES_IN: '12h',
    LOGIN_RATE_LIMIT_MAX_ATTEMPTS: 10,
    LOGIN_RATE_LIMIT_WINDOW_SECONDS: 600,
    SHOPIFY_WEBHOOK_SECRET: 'manual-probe-unused',
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
    SHIPPING_EXECUTION_ENABLED: false,
    SHIPPING_SANDBOX_MODE: false,
    SHIPPING_PROVIDER: 'hepsijet',
    KARGO_ENTEGRATOR_ENABLED: false,
    KARGO_ENTEGRATOR_WEBHOOK_INGEST_ENABLED: false,
    TRY_OTO_ENABLED: false,
    TRY_OTO_SANDBOX_MODE: false,
    TRY_OTO_WEBHOOK_INGEST_ENABLED: false,
    KARGONOMI_BASE_URL: env.KARGONOMI_BASE_URL?.trim() || DEFAULT_KARGONOMI_BASE_URL,
    KARGONOMI_API_TOKEN: env.KARGONOMI_API_TOKEN,
    KARGONOMI_APP_KEY: env.KARGONOMI_APP_KEY,
    PARATIKA_MARKETPLACE_MODEL: 'SELLER_COMMISSION_RATE',
  };
}

function printSanitizedResponse(logger: ProbeLogger, label: string, response: KargonomiRawHttpResponse) {
  logger.log(
    JSON.stringify(
      {
        label,
        ok: response.ok,
        status: response.status,
        contentType: response.contentType,
        body: sanitizeKargonomiProbeOutput(response.body),
      },
      null,
      2,
    ),
  );
}

function readCreatedShipmentId(response: KargonomiRawHttpResponse) {
  const parsed = parseKargonomiShipment(response.body);
  return parsed.id;
}

export async function runManualKargonomiForwardProbe(options: ProbeOptions = {}) {
  const env = options.env ?? process.env;
  const logger = options.logger ?? console;
  const validation = validateKargonomiProbeEnv(env);

  if (!validation.ok) {
    throw new Error(validation.reason);
  }

  logger.log('MANUAL/DEV ONLY: Kargonomi forward shipment probe starting.');
  logger.log('This can create a provider draft shipment. No Shopify sync, DB write, or fulfillment action will run.');

  const client = new KargonomiHttpClient(buildProbeAppEnv(env), {
    fetchImpl: options.fetchImpl,
  });

  const draftResponse = await client.createShipmentDraft(buildKargonomiProbeShipmentInput());
  printSanitizedResponse(logger, 'POST /shipments', draftResponse);

  const shipmentId = readCreatedShipmentId(draftResponse);
  if (!shipmentId) {
    logger.log('Stopping: Kargonomi draft response did not include a shipment id.');
    return;
  }

  const priceResponse = await client.getShipmentPriceComparison(shipmentId);
  printSanitizedResponse(logger, `GET /shipment-price-comparison/${shipmentId}`, priceResponse);

  if (env.KARGONOMI_PROBE_CONFIRM_PRICE !== 'YES') {
    logger.log('Stopping before price confirmation. Set KARGONOMI_PROBE_CONFIRM_PRICE=YES to continue intentionally.');
    return;
  }

  const confirmResponse = await client.confirmShippingPrice({
    shipmentId,
    shippingProviderId: env.KARGONOMI_PROBE_SHIPPING_PROVIDER_ID as string,
  });
  printSanitizedResponse(logger, 'POST /confirm-shipping-price', confirmResponse);

  if (env.KARGONOMI_PROBE_FETCH_BARCODE !== 'YES') {
    logger.log('Stopping before barcode fetch. Set KARGONOMI_PROBE_FETCH_BARCODE=YES to fetch barcode intentionally.');
    return;
  }

  const barcodeResponse = await client.getShipmentBarcodePdf(shipmentId);
  printSanitizedResponse(logger, `GET /shipments/${shipmentId}/barcode?format=pdf`, barcodeResponse);
}
