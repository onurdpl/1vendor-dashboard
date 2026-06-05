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

export type KargonomiLookupProbeFetchError = {
  name: string;
  message: string;
  cause: { name: string; message: string } | string | null;
};

type ShapeSummary = {
  kind: string;
  itemCount?: number;
  topLevelKeys: string[];
};

type LocationSummary = {
  count: number;
  firstNames: string[];
};

export type KargonomiLocationLookupDiagnostics = {
  temporary: true;
  baseUrlHost: string | null;
  baseUrlPath: string | null;
  baseUrlParseError: string | null;
  tokenPresent: boolean;
  statesRequestUrl: string;
  statesHttpStatus: number | null;
  statesFetchError: KargonomiLookupProbeFetchError | null;
  statesContentType: string | null;
  statesShapeSummary: ShapeSummary | null;
  firstStateNames: string[];
  istanbulStateId: string | null;
  citiesRequestUrl: string | null;
  citiesHttpStatus: number | null;
  citiesFetchError: KargonomiLookupProbeFetchError | null;
  citiesContentType: string | null;
  citiesShapeSummary: ShapeSummary | null;
  firstCityNames: string[];
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
    LOGIN_RATE_LIMIT_MAX_ATTEMPTS: 10,
    LOGIN_RATE_LIMIT_WINDOW_SECONDS: 600,
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
    PARATIKA_MARKETPLACE_MODEL: 'SELLER_COMMISSION_RATE',
  };
}

function summarizeBaseUrl(baseUrl: string) {
  try {
    const parsed = new URL(baseUrl);
    return {
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      path: parsed.pathname || '/',
      parseError: null,
    };
  } catch (error) {
    return {
      protocol: null,
      hostname: null,
      path: null,
      parseError: error instanceof Error ? error.message : 'Invalid Kargonomi base URL.',
    };
  }
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

function summarizeResponseShape(body: unknown): ShapeSummary {
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
      topLevelKeys: Object.keys(body).slice(0, 20),
    };
  }
  return {
    kind: body === null ? 'null' : typeof body,
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

function summarizeLocations(body: unknown, limit: number): LocationSummary {
  const items = extractLocationItems(body);
  return {
    count: items.length,
    firstNames: items.slice(0, limit).map((item) => item.name),
  };
}

function summarizeFetchError(error: unknown): KargonomiLookupProbeFetchError {
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

function findIstanbulStateId(body: unknown) {
  return extractLocationItems(body).find((item) => normalizeLocationName(item.name) === 'istanbul')?.id ?? null;
}

export async function runKargonomiLocationLookupDiagnostics(
  env: AppEnv,
  options: { fetchImpl?: typeof fetch } = {},
): Promise<KargonomiLocationLookupDiagnostics> {
  const effectiveBaseUrl = env.KARGONOMI_BASE_URL?.trim() || DEFAULT_KARGONOMI_BASE_URL;
  const baseUrl = summarizeBaseUrl(effectiveBaseUrl);
  const diagnostics: KargonomiLocationLookupDiagnostics = {
    temporary: true,
    baseUrlHost: baseUrl.hostname,
    baseUrlPath: baseUrl.path,
    baseUrlParseError: baseUrl.parseError,
    tokenPresent: Boolean(env.KARGONOMI_API_TOKEN?.trim()),
    statesRequestUrl: '/states/1',
    statesHttpStatus: null,
    statesFetchError: null,
    statesContentType: null,
    statesShapeSummary: null,
    firstStateNames: [],
    istanbulStateId: null,
    citiesRequestUrl: null,
    citiesHttpStatus: null,
    citiesFetchError: null,
    citiesContentType: null,
    citiesShapeSummary: null,
    firstCityNames: [],
  };

  if (!env.KARGONOMI_API_TOKEN?.trim()) {
    diagnostics.statesFetchError = {
      name: 'ConfigError',
      message: 'KARGONOMI_API_TOKEN is not configured.',
      cause: null,
    };
    return diagnostics;
  }

  const client = new KargonomiHttpClient(
    {
      ...env,
      KARGONOMI_BASE_URL: effectiveBaseUrl,
    },
    {
      fetchImpl: options.fetchImpl,
    },
  );

  let statesResponse: KargonomiRawHttpResponse;
  try {
    statesResponse = await client.listStates(1);
  } catch (error) {
    diagnostics.statesFetchError = summarizeFetchError(error);
    return diagnostics;
  }

  diagnostics.statesHttpStatus = statesResponse.status;
  diagnostics.statesContentType = statesResponse.contentType;
  diagnostics.statesShapeSummary = summarizeResponseShape(statesResponse.body);
  diagnostics.firstStateNames = summarizeLocations(statesResponse.body, 5).firstNames;
  if (!statesResponse.ok) {
    return diagnostics;
  }

  const istanbulStateId = findIstanbulStateId(statesResponse.body);
  diagnostics.istanbulStateId = istanbulStateId;
  if (!istanbulStateId) {
    return diagnostics;
  }

  diagnostics.citiesRequestUrl = `/cities/${istanbulStateId}`;
  try {
    const citiesResponse = await client.listCities(istanbulStateId);
    diagnostics.citiesHttpStatus = citiesResponse.status;
    diagnostics.citiesContentType = citiesResponse.contentType;
    diagnostics.citiesShapeSummary = summarizeResponseShape(citiesResponse.body);
    diagnostics.firstCityNames = summarizeLocations(citiesResponse.body, 10).firstNames;
  } catch (error) {
    diagnostics.citiesFetchError = summarizeFetchError(error);
  }

  return diagnostics;
}

export async function runManualKargonomiLocationLookupProbe(options: LookupProbeOptions = {}) {
  const env = options.env ?? process.env;
  const logger = options.logger ?? console;
  const validation = validateKargonomiLookupProbeEnv(env);

  if (!validation.ok) {
    throw new Error(validation.reason);
  }

  const appEnv = buildLookupProbeAppEnv(env);

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

  const diagnostics = await runKargonomiLocationLookupDiagnostics(appEnv, {
    fetchImpl: options.fetchImpl,
  });
  logger.log(JSON.stringify(diagnostics, null, 2));
}
