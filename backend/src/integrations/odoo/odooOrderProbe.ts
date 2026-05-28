import { OdooClient, OdooClientError, type OdooFieldsGetResponse } from './odooClient.js';

type ProbeLogger = Pick<Console, 'log' | 'error'>;

export type OdooProbeEnv = Record<string, string | undefined>;

export type OdooOrderProbeOptions = {
  env: OdooProbeEnv;
  fetchImpl?: typeof fetch;
  logger?: ProbeLogger;
  now?: () => Date;
};

type OdooProbeConfig = {
  enabled: boolean;
  dryRun: boolean;
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

export function parseOdooProbeConfig(env: OdooProbeEnv): OdooProbeConfig {
  const missing = REQUIRED_ENV_KEYS.filter((key) => env[key] === undefined);
  if (missing.length) {
    throw new Error(`Missing Odoo env vars in backend/.env: ${missing.join(', ')}`);
  }

  return {
    enabled: parseBoolean(env.ODOO_ENABLED, 'ODOO_ENABLED'),
    dryRun: parseBoolean(env.ODOO_DRY_RUN, 'ODOO_DRY_RUN'),
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
  logger.log('This probe creates at most one draft/test Sales Order and never creates invoices or accounting entries.');

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

  const client = new OdooClient(
    {
      url: config.url,
      db: config.db,
      username: config.username,
      apiKey: config.apiKey,
    },
    options.fetchImpl,
  );

  const uid = await client.authenticate();
  logStep(logger, 'Odoo auth', { succeeded: true, uidPresent: Number.isInteger(uid) && uid > 0 });

  const saleOrderFields = await client.fieldsGet(uid, 'sale.order');
  const saleOrderLineFields = await client.fieldsGet(uid, 'sale.order.line');
  logStep(logger, 'Odoo models inspected', {
    models: ['sale.order', 'sale.order.line', 'res.partner'],
    saleOrderRequiredFields: requiredWritableFields(saleOrderFields),
    saleOrderLineRequiredFields: requiredWritableFields(saleOrderLineFields),
  });

  const missing = findMissingRequiredFields(buildDraftSalesOrderValues(fixture, 1), saleOrderFields, saleOrderLineFields);
  if (missing.length) {
    throw new Error(`Missing required Odoo fields for safe Sales Order creation: ${missing.join(', ')}`);
  }

  const partnerId = await findOrCreateTestPartner(client, uid, fixture, logger);
  const orderValues = buildDraftSalesOrderValues(fixture, partnerId);
  logStep(logger, 'Draft Sales Order create payload summary', {
    salesOrderValues: orderValues,
  });

  const orderId = await client.modelCall<number>(uid, 'sale.order', 'create', [orderValues]);
  logStep(logger, 'Draft Sales Order create result', {
    succeeded: Number.isInteger(orderId) && orderId > 0,
    orderId,
    reference: fixture.reference,
  });
}

async function findOrCreateTestPartner(client: OdooClient, uid: number, fixture: AllocationFixture, logger: ProbeLogger) {
  const domain = [['name', '=', fixture.vendorName]];
  const existingIds = await client.modelCall<number[]>(uid, 'res.partner', 'search', [domain], { limit: 1 });
  if (existingIds.length) {
    logStep(logger, 'Test partner lookup', { found: true, partnerId: existingIds[0] });
    return existingIds[0];
  }

  const partnerValues = buildPartnerValues(fixture);
  const partnerId = await client.modelCall<number>(uid, 'res.partner', 'create', [partnerValues]);
  logStep(logger, 'Test partner create', {
    created: Number.isInteger(partnerId) && partnerId > 0,
    partnerId,
    partnerValues,
  });
  return partnerId;
}

function buildPartnerValues(fixture: AllocationFixture) {
  return {
    name: fixture.vendorName,
    email: fixture.vendorEmail,
    vat: fixture.vendorTaxNumber,
    comment: `TEST ONLY partner for Sporgym Odoo order probe. Reference ${fixture.reference}.`,
  };
}

function findMissingRequiredFields(orderValues: Record<string, unknown>, orderFields: OdooFieldsGetResponse, lineFields: OdooFieldsGetResponse) {
  const missing = requiredWritableFields(orderFields).filter((field) => orderValues[field] === undefined || orderValues[field] === null || orderValues[field] === '');
  const orderLines = Array.isArray(orderValues.order_line) ? orderValues.order_line : [];
  const firstLineCommand = orderLines[0];
  const firstLineValues = Array.isArray(firstLineCommand) && typeof firstLineCommand[2] === 'object' && firstLineCommand[2] !== null
    ? (firstLineCommand[2] as Record<string, unknown>)
    : {};

  for (const field of requiredWritableFields(lineFields)) {
    if (firstLineValues[field] === undefined || firstLineValues[field] === null || firstLineValues[field] === '') {
      missing.push(`order_line.${field}`);
    }
  }

  return missing.filter((field) => !isKnownServerComputedField(field));
}

function requiredWritableFields(fields: OdooFieldsGetResponse) {
  return Object.entries(fields)
    .filter(([, definition]) => definition.required && !definition.readonly)
    .map(([field]) => field)
    .sort();
}

function isKnownServerComputedField(field: string) {
  return [
    'company_id',
    'currency_id',
    'date_order',
    'display_name',
    'name',
    'order_line.sequence',
    'order_line.company_id',
    'order_line.currency_id',
    'order_line.order_id',
  ].includes(field);
}

function readRequired(env: OdooProbeEnv, key: keyof OdooProbeEnv & string) {
  const value = env[key];
  if (!value?.trim()) {
    throw new Error(`${key} is required in backend/.env.`);
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

function parseBoolean(value: string | undefined, key: string) {
  const normalized = value?.trim().toLowerCase();
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
    message: error instanceof Error ? error.message : 'Unknown Odoo probe error.',
  };
}
