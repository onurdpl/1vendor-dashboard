import type { AppEnv } from '../../config/env.js';
import { KargonomiHttpClient, type KargonomiRawHttpResponse } from './kargonomi-provider.adapter.js';

type LookupProbeEnv = Record<string, string | undefined>;

type LookupProbeLogger = Pick<Console, 'log' | 'error'>;

type LookupProbeOptions = {
  env?: LookupProbeEnv;
  fetchImpl?: typeof fetch;
  logger?: LookupProbeLogger;
};

export type KargonomiLookupProbeValidationResult =
  | { ok: true }
  | {
      ok: false;
      reason: string;
    };

type LocationSummary = {
  count: number;
  firstNames: string[];
};

const DEFAULT_KARGONOMI_BASE_URL = 'https://app.kargonomi.com.tr/api/v1';

export function validateKargonomiLookupProbeEnv(env: LookupProbeEnv): KargonomiLookupProbeValidationResult {
  if (env.KARGONOMI_LOOKUP_PROBE_CONFIRM !== 'YES') {
    return {
      ok: false,
      reason: 'KARGONOMI_LOOKUP_PROBE_CONFIRM=YES is required for the manual Kargonomi location lookup probe.',
    };
  }

  if (!env.KARGONOMI_API_TOKEN?.trim()) {
    return {
      ok: false,
      reason: 'KARGONOMI_API_TOKEN is required for the manual Kargonomi location lookup probe.',
    };
  }

  return { ok: true };
}

function buildLookupProbeAppEnv(env: LookupProbeEnv): AppEnv {
  return {
    NODE_ENV: 'test',
    PORT: 4000,
    DATABASE_URL: undefined,
    CORS_ORIGIN: [],
    JWT_SECRET: 'manual-lookup-probe-unused',
    JWT_EXPIRES_IN: '12h',
    SHOPIFY_WEBHOOK_SECRET: 'manual-lookup-probe-unused',
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
    INVOICE_EXECUTION_ENABLED: false,
    INVOICE_PROVIDER: 'bizimhesap',
    BIZIMHESAP_ENABLED: false,
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
    KARGONOMI_DEFAULT_WAREHOUSE_ID: env.KARGONOMI_DEFAULT_WAREHOUSE_ID,
  };
}

function summarizeBaseUrl(baseUrl: string) {
  const parsed = new URL(baseUrl);
  return {
    protocol: parsed.protocol,
    hostname: parsed.hostname,
    path: parsed.pathname || '/',
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readString(value: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const raw = value[key];
    if (typeof raw === 'string' && raw.trim()) {
      return raw.trim();
    }
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      return String(raw);
    }
  }
  return null;
}

function extractLocationItems(value: unknown) {
  const list = Array.isArray(value)
    ? value
    : isRecord(value)
      ? (['data', 'items', 'result', 'results', 'states', 'cities'] as const)
          .map((key) => value[key])
          .find(Array.isArray) ?? []
      : [];

  return list.filter(isRecord).flatMap((item) => {
    const id = readString(item, ['id', 'state_id', 'stateId', 'city_id', 'cityId', 'value']);
    const name = readString(item, ['name', 'title', 'state_name', 'stateName', 'city_name', 'cityName', 'label']);
    return id && name ? [{ id, name }] : [];
  });
}

function summarizeResponseShape(body: unknown) {
  if (Array.isArray(body)) {
    return {
      kind: 'array',
      itemCount: body.length,
      topLevelKeys: [],
    };
  }
  if (isRecord(body)) {
    return {
      kind: 'object',
      itemCount: undefined,
      topLevelKeys: Object.keys(body).slice(0, 20),
    };
  }
  return {
    kind: body === null ? 'null' : typeof body,
    itemCount: undefined,
    topLevelKeys: [],
  };
}

function normalizeLocationName(value: string | null | undefined) {
  return (value ?? '')
    .trim()
    .toLocaleLowerCase('tr-TR')
    .replace(/[çÇ]/g, 'c')
    .replace(/[ğĞ]/g, 'g')
    .replace(/[ıİ]/g, 'i')
    .replace(/[öÖ]/g, 'o')
    .replace(/[şŞ]/g, 's')
    .replace(/[üÜ]/g, 'u')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function summarizeLocations(body: unknown): LocationSummary {
  const items = extractLocationItems(body);
  return {
    count: items.length,
    firstNames: items.slice(0, 5).map((item) => item.name),
  };
}

function summarizeFetchError(error: unknown) {
  if (error instanceof Error) {
    const cause = error.cause;
    return {
      name: error.name,
      message: error.message,
      cause: cause instanceof Error ? { name: cause.name, message: cause.message } : cause ? String(cause) : null,
    };
  }

  return {
    name: typeof error,
    message: String(error),
    cause: null,
  };
}

function logResponse(logger: LookupProbeLogger, label: string, response: KargonomiRawHttpResponse) {
  const locations = summarizeLocations(response.body);
  logger.log(
    JSON.stringify(
      {
        label,
        ok: response.ok,
        httpStatus: response.status,
        contentType: response.contentType,
        responseShape: summarizeResponseShape(response.body),
        locationCount: locations.count,
        firstLocationNames: locations.firstNames,
      },
      null,
      2,
    ),
  );
}

function findIstanbulStateId(body: unknown) {
  return extractLocationItems(body).find((item) => normalizeLocationName(item.name) === 'istanbul')?.id ?? null;
}

export async function runManualKargonomiLocationLookupProbe(options: LookupProbeOptions = {}) {
  const env = options.env ?? process.env;
  const logger = options.logger ?? console;
  const validation = validateKargonomiLookupProbeEnv(env);

  if (!validation.ok) {
    throw new Error(validation.reason);
  }

  const appEnv = buildLookupProbeAppEnv(env);
  const client = new KargonomiHttpClient(appEnv, {
    fetchImpl: options.fetchImpl,
  });

  logger.log('MANUAL/DEV ONLY: Kargonomi location lookup probe starting.');
  logger.log(
    JSON.stringify(
      {
        baseUrl: summarizeBaseUrl(appEnv.KARGONOMI_BASE_URL ?? DEFAULT_KARGONOMI_BASE_URL),
        tokenPresent: Boolean(appEnv.KARGONOMI_API_TOKEN),
        appKeyPresent: Boolean(appEnv.KARGONOMI_APP_KEY),
        calls: ['GET /states/1', 'GET /cities/{istanbulStateId} when İstanbul is present'],
      },
      null,
      2,
    ),
  );

  let statesResponse: KargonomiRawHttpResponse;
  try {
    statesResponse = await client.listStates(1);
  } catch (error) {
    logger.log(
      JSON.stringify(
        {
          label: 'GET /states/1',
          fetchFailed: true,
          error: summarizeFetchError(error),
        },
        null,
        2,
      ),
    );
    return;
  }

  logResponse(logger, 'GET /states/1', statesResponse);
  if (!statesResponse.ok) {
    logger.log('Stopping: states lookup returned a non-2xx response.');
    return;
  }

  const istanbulStateId = findIstanbulStateId(statesResponse.body);
  if (!istanbulStateId) {
    logger.log('Stopping: İstanbul was not found in the states response.');
    return;
  }

  try {
    const citiesResponse = await client.listCities(istanbulStateId);
    logResponse(logger, `GET /cities/${istanbulStateId}`, citiesResponse);
  } catch (error) {
    logger.log(
      JSON.stringify(
        {
          label: `GET /cities/${istanbulStateId}`,
          fetchFailed: true,
          error: summarizeFetchError(error),
        },
        null,
        2,
      ),
    );
  }
}
