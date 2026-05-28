import { OdooClient, OdooClientError, type OdooFieldsGetResponse, type OdooSearchReadRecord } from './odooClient.js';

type ProbeLogger = Pick<Console, 'log' | 'error'>;

export type OdooProbeEnv = Record<string, string | undefined>;

export type OdooOrderProbeOptions = {
  env: OdooProbeEnv;
  fetchImpl?: typeof fetch;
  logger?: ProbeLogger;
  now?: () => Date;
};

export type OdooDiscoveryModelResult = {
  model: string;
  exists: boolean;
  requiredFields: string[] | 'unknown';
  usefulFields: string[];
  samples: Array<{ id: number | undefined; name: string | null }>;
  unknowns: string[];
  error?: ReturnType<typeof describeOdooProbeError>;
};

export type OdooDiscoveryResult = {
  mode: 'DISCOVERY_ONLY';
  auth: {
    succeeded: boolean;
    uidPresent: boolean;
    error?: ReturnType<typeof describeOdooProbeError>;
  };
  versionInfo: unknown;
  models: OdooDiscoveryModelResult[];
  unknowns: string[];
};

type OdooProbeConfig = {
  enabled: boolean;
  dryRun: boolean;
  discoveryOnly: boolean;
  url: string;
  db: string;
  username: string;
  apiKey: string;
};

type AllocationFixture = {
  reference: string;
  shopifyOrderName: string;
  allocationId: string;
  vendorName: string;
  vendorTaxNumber: string;
  vendorEmail: string;
  sku: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  vatRate: number;
};

const REQUIRED_ENV_KEYS = ['ODOO_ENABLED', 'ODOO_URL', 'ODOO_DB', 'ODOO_USERNAME', 'ODOO_API_KEY', 'ODOO_DRY_RUN'] as const;
const SECRET_KEY_PATTERN = /api_key|password|token|secret|authorization/i;
const PII_KEY_PATTERN = /email|tax|vat/i;
const DISCOVERY_MODELS = ['sale.order', 'sale.order.line', 'res.partner', 'product.product', 'account.tax', 'res.company', 'res.currency'] as const;
const SAFE_SAMPLE_FIELDS = ['id', 'display_name', 'name'];
const USEFUL_FIELD_CANDIDATES = [
  'id',
  'name',
  'display_name',
  'partner_id',
  'order_line',
  'client_order_ref',
  'origin',
  'note',
  'product_id',
  'product_uom_qty',
  'price_unit',
  'tax_id',
  'currency_id',
  'company_id',
  'amount_total',
  'state',
  'vat',
  'email',
  'default_code',
  'list_price',
  'amount',
  'active',
];

export function parseOdooProbeConfig(env: OdooProbeEnv): OdooProbeConfig {
  const missing = REQUIRED_ENV_KEYS.filter((key) => env[key] === undefined);
  if (missing.length) {
    throw new Error(`Missing Odoo env vars in process.env or backend/.env: ${missing.join(', ')}`);
  }

  return {
    enabled: parseBoolean(env.ODOO_ENABLED, 'ODOO_ENABLED'),
    dryRun: parseBoolean(env.ODOO_DRY_RUN, 'ODOO_DRY_RUN'),
    discoveryOnly: parseBoolean(env.ODOO_DISCOVERY_ONLY, 'ODOO_DISCOVERY_ONLY', false),
    url: readRequired(env, 'ODOO_URL'),
    db: readRequired(env, 'ODOO_DB'),
    username: readRequired(env, 'ODOO_USERNAME'),
    apiKey: readRequired(env, 'ODOO_API_KEY'),
  };
}

export function buildDefaultOdooAllocationFixture(env: OdooProbeEnv, now: Date = new Date()): AllocationFixture {
  const reference = readOptional(env, 'ODOO_PROBE_REFERENCE') || 'SPORGYM-PARASUT-PROBE';
  return {
    reference,
    shopifyOrderName: readOptional(env, 'ODOO_PROBE_SHOPIFY_ORDER_NAME') || `#ODOO-PROBE-${now.getTime()}`,
    allocationId: readOptional(env, 'ODOO_PROBE_ALLOCATION_ID') || `allocation-${now.getTime()}`,
    vendorName: readOptional(env, 'ODOO_PROBE_VENDOR_NAME') || 'Test Vendor Ltd',
    vendorTaxNumber: readOptional(env, 'ODOO_PROBE_VENDOR_TAX_NUMBER') || '1111111111',
    vendorEmail: readOptional(env, 'ODOO_PROBE_VENDOR_EMAIL') || 'test-vendor@example.invalid',
    sku: readOptional(env, 'ODOO_PROBE_SKU') || 'SPORGYM-ODOO-PROBE',
    productName: readOptional(env, 'ODOO_PROBE_PRODUCT_NAME') || 'Sporgym Odoo Probe Test Item',
    quantity: readNumber(env, 'ODOO_PROBE_QUANTITY', 1),
    unitPrice: readNumber(env, 'ODOO_PROBE_UNIT_PRICE', readNumber(env, 'ODOO_PROBE_COMMISSION_AMOUNT', 1)),
    vatRate: readNumber(env, 'ODOO_PROBE_VAT_RATE', 20),
  };
}

export function buildDraftSalesOrderValues(fixture: AllocationFixture, partnerId: number) {
  return {
    partner_id: partnerId,
    client_order_ref: fixture.reference,
    origin: fixture.shopifyOrderName,
    note: [
      'TEST ONLY: Sporgym Odoo order probe.',
      'No invoice creation. No official accounting entry. Do not fulfill from this record.',
      `Vendor: ${fixture.vendorName}`,
      `Allocation: ${fixture.allocationId}`,
      `SKU: ${fixture.sku}`,
      `KDV probe rate: ${fixture.vatRate}`,
    ].join('\n'),
    order_line: [
      [
        0,
        0,
        {
          name: `${fixture.productName} (${fixture.sku}) - TEST ONLY`,
          product_uom_qty: fixture.quantity,
          price_unit: fixture.unitPrice,
        },
      ],
    ],
  };
}

export async function runOdooOrderProbe(options: OdooOrderProbeOptions) {
  const logger = options.logger ?? console;
  const now = options.now ?? (() => new Date());
  const config = parseOdooProbeConfig(options.env);
  const fixture = buildDefaultOdooAllocationFixture(options.env, now());

  logger.log('TEST ONLY: Odoo Shopify/vendor allocation order probe.');
  logger.log('Dry-run prints a planned payload. Live discovery reads metadata only; record creation is blocked.');

  const plannedPartnerValues = buildPartnerValues(fixture);
  const plannedSalesOrderValues = buildDraftSalesOrderValues(fixture, 0);

  if (config.dryRun) {
    logStep(logger, 'DRY RUN planned payload', {
      enabled: config.enabled,
      dryRun: config.dryRun,
      models: ['res.partner', 'sale.order', 'sale.order.line'],
      partnerLookupDomain: [['name', '=', fixture.vendorName]],
      partnerCreateValues: plannedPartnerValues,
      salesOrderValues: plannedSalesOrderValues,
      note: 'No Odoo network calls were made.',
    });
    return;
  }

  if (!config.enabled) {
    throw new Error('ODOO_ENABLED=true is required when ODOO_DRY_RUN=false.');
  }

  if (!config.discoveryOnly) {
    throw new Error('LIVE_CREATE_BLOCKED: set ODOO_DISCOVERY_ONLY=true for live-safe discovery. Record creation is blocked in this step.');
  }

  const discovery = await runOdooDiscovery({ env: options.env, fetchImpl: options.fetchImpl });
  logStep(logger, 'Odoo live discovery auth/info', {
    mode: discovery.mode,
    versionInfo: discovery.versionInfo,
    authSucceeded: discovery.auth.succeeded,
    uidPresent: discovery.auth.uidPresent,
    error: discovery.auth.error,
  });

  for (const model of discovery.models) {
    logStep(logger, `Odoo model discovery: ${model.model}`, model);
  }

  logger.log('DISCOVERY_ONLY complete. No Odoo records were created, updated, invoiced, posted, or confirmed.');
}

export async function runOdooDiscovery(options: Pick<OdooOrderProbeOptions, 'env' | 'fetchImpl'>): Promise<OdooDiscoveryResult> {
  const config = parseOdooProbeConfig(options.env);
  if (!config.enabled || config.dryRun || !config.discoveryOnly) {
    throw new Error('Odoo discovery requires ODOO_ENABLED=true, ODOO_DRY_RUN=false, and ODOO_DISCOVERY_ONLY=true.');
  }

  const client = new OdooClient(
    {
      url: config.url,
      db: config.db,
      username: config.username,
      apiKey: config.apiKey,
    },
    options.fetchImpl,
  );

  let versionInfo: unknown = null;
  try {
    versionInfo = await client.version();
  } catch (error) {
    versionInfo = {
      unavailable: true,
      error: describeOdooProbeError(error),
    };
  }

  let uid: number;
  try {
    uid = await client.authenticate();
  } catch (error) {
    const authError = describeOdooProbeError(error);
    return {
      mode: 'DISCOVERY_ONLY',
      auth: {
        succeeded: false,
        uidPresent: false,
        error: authError,
      },
      versionInfo,
      models: [],
      unknowns: ['Authentication failed; model discovery was not attempted.'],
    };
  }

  const models: OdooDiscoveryModelResult[] = [];
  for (const model of DISCOVERY_MODELS) {
    models.push(await inspectDiscoveryModel(client, uid, model));
  }

  return {
    mode: 'DISCOVERY_ONLY',
    auth: {
      succeeded: true,
      uidPresent: Number.isInteger(uid) && uid > 0,
    },
    versionInfo,
    models,
    unknowns: models.flatMap((model) => model.unknowns),
  };
}

async function inspectDiscoveryModel(client: OdooClient, uid: number, model: (typeof DISCOVERY_MODELS)[number]) {
  try {
    const fields = await client.fieldsGet(uid, model);
    const usefulFields = usefulFieldsFound(fields);
    const sampleFields = SAFE_SAMPLE_FIELDS.filter((field) => fields[field]);
    let samples: OdooSearchReadRecord[] = [];

    try {
      samples = await client.searchRead(uid, model, [], sampleFields.length ? sampleFields : ['id'], 3);
    } catch {
      samples = [];
    }

    return {
      model,
      exists: true,
      requiredFields: requiredWritableFields(fields),
      usefulFields,
      samples: summarizeSamples(samples),
      unknowns: [],
    };
  } catch (error) {
    return {
      model,
      exists: false,
      requiredFields: 'unknown' as const,
      usefulFields: [],
      samples: [],
      unknowns: [`${model} availability/fields are unknown until Odoo access confirms this model.`],
      error: describeOdooProbeError(error),
    };
  }
}

function buildPartnerValues(fixture: AllocationFixture) {
  return {
    name: fixture.vendorName,
    email: fixture.vendorEmail,
    vat: fixture.vendorTaxNumber,
    comment: `TEST ONLY partner for Sporgym Odoo order probe. Reference ${fixture.reference}.`,
  };
}

function requiredWritableFields(fields: OdooFieldsGetResponse) {
  return Object.entries(fields)
    .filter(([, definition]) => definition.required && !definition.readonly)
    .map(([field]) => field)
    .sort();
}

function usefulFieldsFound(fields: OdooFieldsGetResponse) {
  return USEFUL_FIELD_CANDIDATES.filter((field) => fields[field]);
}

function summarizeSamples(samples: OdooSearchReadRecord[]) {
  return samples.slice(0, 3).map((sample) => ({
    id: sample.id,
    name: sample.display_name || sample.name || null,
  }));
}

function readRequired(env: OdooProbeEnv, key: keyof OdooProbeEnv & string) {
  const value = env[key];
  if (!value?.trim()) {
    throw new Error(`${key} is required in process.env or backend/.env.`);
  }
  return value.trim();
}

function readOptional(env: OdooProbeEnv, key: string) {
  const value = env[key];
  return value?.trim() || undefined;
}

function readNumber(env: OdooProbeEnv, key: string, fallback: number) {
  const value = readOptional(env, key);
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${key} must be numeric.`);
  }
  return parsed;
}

function parseBoolean(value: string | undefined, key: string, fallback?: boolean) {
  const normalized = value?.trim().toLowerCase();
  if (!normalized && fallback !== undefined) {
    return fallback;
  }
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
    return true;
  }
  if (normalized === 'false' || normalized === '0' || normalized === 'no') {
    return false;
  }
  throw new Error(`${key} must be explicitly true or false in backend/.env.`);
}

function logStep(logger: ProbeLogger, label: string, details: Record<string, unknown>) {
  const sanitizedDetails = sanitize(details);
  logger.log(JSON.stringify({ label, ...(isRecord(sanitizedDetails) ? sanitizedDetails : {}) }, null, 2));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitize(item));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => {
      if (SECRET_KEY_PATTERN.test(key)) {
        return [key, item ? '[redacted]' : item];
      }
      if (PII_KEY_PATTERN.test(key)) {
        return [key, item ? '[redacted]' : item];
      }
      return [key, sanitize(item)];
    }),
  );
}

export function describeOdooProbeError(error: unknown) {
  if (error instanceof OdooClientError) {
    return {
      message: error.message,
      details: error.details,
    };
  }

  return {
    message: error instanceof Error ? sanitizeText(error.message) : 'Unknown Odoo probe error.',
  };
}

function sanitizeText(value: string) {
  return value
    .replace(/api[_-]?key[^\s,;)]*/gi, 'api_key=[redacted]')
    .replace(/password[^\s,;)]*/gi, 'password=[redacted]')
    .replace(/token[^\s,;)]*/gi, 'token=[redacted]');
}
