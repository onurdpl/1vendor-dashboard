import { OdooClient, OdooClientError, type OdooFieldsGetResponse } from './odooClient.js';
import { prisma } from '../../db/prisma.js';

type SyncLogger = Pick<Console, 'log' | 'error'>;

type OdooAllocationSyncEnv = Record<string, string | undefined>;

type OdooAllocationSyncConfig =
  | {
      enabled: false;
      dryRun: boolean;
    }
  | {
      enabled: true;
      dryRun: true;
    }
  | {
      enabled: true;
      dryRun: false;
      url: string;
      db: string;
      username: string;
      apiKey: string;
      partnerId?: number;
      partnerName?: string;
      vendorPartnerMap: Record<string, number>;
    };

type LiveOdooAllocationSyncConfig = Extract<OdooAllocationSyncConfig, { enabled: true; dryRun: false }>;

type AllocationForOdooSync = NonNullable<Awaited<ReturnType<typeof loadAllocationForOdooSync>>>;

type OdooPartnerRef = {
  id: number;
  name: string | null;
};

type OdooCompanyRef = {
  id: number;
  name: string | null;
};

type SyncResult =
  | { status: 'disabled'; allocationId: string }
  | { status: 'dry_run'; allocationId: string }
  | { status: 'skipped_existing'; allocationId: string; odooSaleOrderId: string; odooSaleOrderName: string | null }
  | { status: 'synced'; allocationId: string; odooSaleOrderId: string; odooSaleOrderName: string | null }
  | { status: 'failed'; allocationId: string; error: string };

const REQUIRED_ODOO_ENV_KEYS = ['ODOO_URL', 'ODOO_DB', 'ODOO_USERNAME', 'ODOO_API_KEY'] as const;
const SALE_ORDER_READ_FIELDS = ['id', 'name', 'state'];
const SALE_ORDER_REFERENCE_PREFIX = 'sporgym-allocation:';
const ODOO_VENDOR_PORTAL_FIELD = 'x_vendor_id';
const ODOO_SALE_ORDER_PICKING_POLICY = 'direct';

export async function syncOdooSaleOrdersForAllocations(
  allocationIds: Iterable<string>,
  options: { env?: OdooAllocationSyncEnv; logger?: SyncLogger; fetchImpl?: typeof fetch } = {},
) {
  const results: SyncResult[] = [];
  for (const allocationId of allocationIds) {
    results.push(await syncOdooSaleOrderForAllocation(allocationId, options));
  }
  return results;
}

export async function syncOdooSaleOrderForAllocation(
  allocationId: string,
  options: { env?: OdooAllocationSyncEnv; logger?: SyncLogger; fetchImpl?: typeof fetch } = {},
): Promise<SyncResult> {
  const logger = options.logger ?? console;
  const env = options.env ?? process.env;
  let config: OdooAllocationSyncConfig;

  try {
    config = parseOdooAllocationSyncConfig(env);
  } catch (error) {
    const message = describeOdooAllocationSyncError(error);
    logger.error(`Odoo sale.order sync failed for allocation ${allocationId}: ${message}`);
    return { status: 'failed', allocationId, error: message };
  }

  if (!config.enabled) {
    return { status: 'disabled', allocationId };
  }

  if (config.dryRun) {
    return { status: 'dry_run', allocationId };
  }

  try {
    const allocation = await loadAllocationForOdooSync(allocationId);
    if (!allocation) {
      throw new Error(`Vendor allocation ${allocationId} was not found.`);
    }

    if (allocation.odooSaleOrderId) {
      logger.log(
        `Odoo sale.order sync skipped for allocation ${allocation.id}: existing sale.order ${allocation.odooSaleOrderId}.`,
      );
      return {
        status: 'skipped_existing',
        allocationId,
        odooSaleOrderId: allocation.odooSaleOrderId,
        odooSaleOrderName: allocation.odooSaleOrderName,
      };
    }

    const vendorPortalPartnerId = resolveOdooVendorPortalPartnerId(allocation.assignedVendorId, config.vendorPartnerMap);
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
    const partner = await resolveOdooSaleOrderPartner(client, uid, config);
    const company = await resolveOdooCompany(client, uid);
    const existing = await findExistingOdooSaleOrder(client, uid, buildClientOrderRef(allocation.id));

    if (existing?.id) {
      await markAllocationOdooSynced(allocation.id, String(existing.id), existing.display_name || existing.name || null);
      logger.log(`Odoo sale.order sync found existing order for allocation ${allocation.id}: ${existing.id}.`);
      return {
        status: 'synced',
        allocationId,
        odooSaleOrderId: String(existing.id),
        odooSaleOrderName: existing.display_name || existing.name || null,
      };
    }

    const saleOrderValues = buildOdooSaleOrderValues(allocation, partner, company, vendorPortalPartnerId);
    await validateOdooSaleOrderPayload(client, uid, saleOrderValues);

    const saleOrderId = await client.modelCall<number>(uid, 'sale.order', 'create', [saleOrderValues]);
    const saleOrders = await client.modelCall<Array<Record<string, unknown>>>(uid, 'sale.order', 'read', [[saleOrderId]], {
      fields: SALE_ORDER_READ_FIELDS,
    });
    const saleOrder = saleOrders[0];
    const saleOrderName = readStringOrNull(saleOrder?.name);

    await markAllocationOdooSynced(allocation.id, String(saleOrderId), saleOrderName);

    logger.log(`Odoo sale.order sync succeeded for allocation ${allocation.id}: ${saleOrderId}.`);
    return {
      status: 'synced',
      allocationId,
      odooSaleOrderId: String(saleOrderId),
      odooSaleOrderName: saleOrderName,
    };
  } catch (error) {
    const message = describeOdooAllocationSyncError(error);
    logger.error(`Odoo sale.order sync failed for allocation ${allocationId}: ${message}`);
    return { status: 'failed', allocationId, error: message };
  }
}

function parseOdooAllocationSyncConfig(env: OdooAllocationSyncEnv): OdooAllocationSyncConfig {
  const enabled = parseBoolean(env.ODOO_ENABLED, false);
  const dryRun = parseBoolean(env.ODOO_DRY_RUN, true);

  if (!enabled) {
    return { enabled: false, dryRun };
  }

  if (dryRun) {
    return { enabled: true, dryRun: true };
  }

  const missing = REQUIRED_ODOO_ENV_KEYS.filter((key) => !env[key]?.trim());
  if (missing.length) {
    throw new Error(`Missing Odoo env vars: ${missing.join(', ')}`);
  }

  const partnerId = readNumber(env.ODOO_SALE_ORDER_PARTNER_ID);
  const partnerName = readOptional(env.ODOO_SALE_ORDER_PARTNER_NAME);
  if (!partnerId && !partnerName) {
    throw new Error('ODOO_SALE_ORDER_PARTNER_ID or ODOO_SALE_ORDER_PARTNER_NAME is required for allocation sale.order sync.');
  }
  const vendorPartnerMap = parseOdooVendorPartnerMap(env.ODOO_VENDOR_PARTNER_MAP);

  return {
    enabled: true,
    dryRun: false,
    url: readRequired(env, 'ODOO_URL'),
    db: readRequired(env, 'ODOO_DB'),
    username: readRequired(env, 'ODOO_USERNAME'),
    apiKey: readRequired(env, 'ODOO_API_KEY'),
    partnerId,
    partnerName,
    vendorPartnerMap,
  };
}

async function loadAllocationForOdooSync(allocationId: string) {
  return prisma.vendorAllocation.findUnique({
    where: { id: allocationId },
    include: {
      assignedVendor: true,
      order: true,
      lineItems: {
        include: {
          shopifyOrderLineItem: true,
        },
        orderBy: {
          createdAt: 'asc',
        },
      },
    },
  });
}

async function resolveOdooSaleOrderPartner(client: OdooClient, uid: number, config: LiveOdooAllocationSyncConfig) {
  if (config.partnerId) {
    const partners = await client.modelCall<Array<Record<string, unknown>>>(uid, 'res.partner', 'read', [[config.partnerId]], {
      fields: ['id', 'display_name', 'name'],
    });
    const partner = partners[0];
    if (!partner?.id) {
      throw new Error(`Configured Odoo partner id ${config.partnerId} was not found.`);
    }
    return {
      id: Number(partner.id),
      name: readStringOrNull(partner.display_name) ?? readStringOrNull(partner.name),
    };
  }

  const records = await client.searchRead(uid, 'res.partner', [['name', '=', config.partnerName]], ['id', 'display_name', 'name'], 1);
  const record = records[0];
  if (!record?.id) {
    throw new Error(`Configured Odoo partner name ${config.partnerName} was not found.`);
  }
  return {
    id: record.id,
    name: record.display_name || record.name || null,
  };
}

async function resolveOdooCompany(client: OdooClient, uid: number): Promise<OdooCompanyRef> {
  const records = await client.searchRead(uid, 'res.company', [], ['id', 'display_name', 'name'], 1);
  const record = records[0];
  if (!record?.id) {
    throw new Error('res.company not found; company_id is required for sale.order sync.');
  }
  return {
    id: record.id,
    name: record.display_name || record.name || null,
  };
}

async function findExistingOdooSaleOrder(client: OdooClient, uid: number, clientOrderRef: string) {
  const records = await client.searchRead(uid, 'sale.order', [['client_order_ref', '=', clientOrderRef]], ['id', 'display_name', 'name'], 1);
  return records[0];
}

function resolveOdooVendorPortalPartnerId(vendorIdentifier: string, vendorPartnerMap: Record<string, number>) {
  const partnerId = vendorPartnerMap[vendorIdentifier];
  if (!partnerId) {
    throw new Error(`No Odoo vendor portal partner mapping configured for vendor ${vendorIdentifier}.`);
  }
  return partnerId;
}

function buildOdooSaleOrderValues(
  allocation: AllocationForOdooSync,
  partner: OdooPartnerRef,
  company: OdooCompanyRef,
  vendorPortalPartnerId: number,
) {
  if (allocation.lineItems.length === 0) {
    throw new Error(`Vendor allocation ${allocation.id} has no line items for Odoo sale.order sync.`);
  }

  const now = new Date();
  return {
    name: buildOdooOrderName(allocation),
    company_id: company.id,
    date_order: now.toISOString().slice(0, 19).replace('T', ' '),
    partner_id: partner.id,
    partner_invoice_id: partner.id,
    partner_shipping_id: partner.id,
    [ODOO_VENDOR_PORTAL_FIELD]: vendorPortalPartnerId,
    picking_policy: ODOO_SALE_ORDER_PICKING_POLICY,
    client_order_ref: buildClientOrderRef(allocation.id),
    origin: allocation.sourceShopifyOrderNumber,
    note: [
      'Sporgym Shopify vendor allocation sync.',
      `Shopify order number: ${allocation.sourceShopifyOrderNumber}`,
      `Shopify order id: ${allocation.order.sourceShopifyOrderId}`,
      `Vendor allocation id: ${allocation.id}`,
      `Vendor identifier: ${allocation.assignedVendorId}`,
      `Vendor name: ${allocation.assignedVendor.name}`,
      `Customer display name: ${allocation.order.customerName ?? 'Unknown'}`,
    ].join('\n'),
    order_line: allocation.lineItems.map((lineItem) => [
      0,
      0,
      {
        name: buildOdooLineName(allocation, lineItem),
        customer_lead: 0,
        product_uom_qty: lineItem.quantity,
        price_unit: Number(lineItem.shopifyOrderLineItem.unitPrice ?? 0),
      },
    ]),
  };
}

async function validateOdooSaleOrderPayload(client: OdooClient, uid: number, values: ReturnType<typeof buildOdooSaleOrderValues>) {
  const [saleOrderFields, saleOrderLineFields] = await Promise.all([
    client.fieldsGet(uid, 'sale.order'),
    client.fieldsGet(uid, 'sale.order.line'),
  ]);
  const errors = [
    ...missingOdooVendorPortalField(saleOrderFields),
    ...missingRequiredFields('sale.order', requiredWritableFields(saleOrderFields), values),
    ...missingRequiredFields('sale.order.line', requiredWritableFields(saleOrderLineFields), extractFirstOrderLineValues(values), new Set(['order_id'])),
  ];

  if (errors.length) {
    throw new Error(errors.join(' '));
  }
}

function missingOdooVendorPortalField(fields: OdooFieldsGetResponse) {
  const definition = fields[ODOO_VENDOR_PORTAL_FIELD];
  if (!definition) {
    return [`sale.order.${ODOO_VENDOR_PORTAL_FIELD} does not exist in Odoo; vendor portal mapping was not written.`];
  }
  if (definition.type && definition.type !== 'many2one') {
    return [`sale.order.${ODOO_VENDOR_PORTAL_FIELD} must be a writable many2one field in Odoo; vendor portal mapping was not written.`];
  }
  if (definition.readonly) {
    return [`sale.order.${ODOO_VENDOR_PORTAL_FIELD} is readonly in Odoo; vendor portal mapping was not written.`];
  }
  return [];
}

async function markAllocationOdooSynced(allocationId: string, odooSaleOrderId: string, odooSaleOrderName: string | null) {
  await prisma.vendorAllocation.update({
    where: { id: allocationId },
    data: {
      odooSaleOrderId,
      odooSaleOrderName,
      odooSaleOrderSyncedAt: new Date(),
    },
  });
}

function buildClientOrderRef(allocationId: string) {
  return `${SALE_ORDER_REFERENCE_PREFIX}${allocationId}`;
}

function buildOdooOrderName(allocation: AllocationForOdooSync) {
  return `SPORGYM-${allocation.sourceShopifyOrderNumber.replace(/[^a-zA-Z0-9]+/g, '')}-${allocation.id.replace(/[^a-zA-Z0-9]+/g, '-')}`;
}

function buildOdooLineName(allocation: AllocationForOdooSync, lineItem: AllocationForOdooSync['lineItems'][number]) {
  const source = lineItem.shopifyOrderLineItem;
  return [
    source.title || 'Shopify allocation line item',
    `SKU: ${source.sku ?? 'Unknown'}`,
    `Qty: ${lineItem.quantity}`,
    `Shopify line item id: ${source.sourceLineItemId}`,
    `Vendor allocation id: ${allocation.id}`,
  ].join(' | ');
}

function requiredWritableFields(fields: OdooFieldsGetResponse) {
  return Object.entries(fields)
    .filter(([, definition]) => definition.required && !definition.readonly)
    .map(([field]) => field)
    .sort();
}

function missingRequiredFields(model: string, requiredFields: string[], values: Record<string, unknown>, satisfiedByContext = new Set<string>()) {
  return requiredFields
    .filter((field) => !satisfiedByContext.has(field) && !hasCreateValue(values[field]))
    .map((field) => `${model}.${field} is required by Odoo but missing from the allocation sale.order payload.`);
}

function extractFirstOrderLineValues(values: ReturnType<typeof buildOdooSaleOrderValues>) {
  const lineCommand = values.order_line[0];
  const lineValues = Array.isArray(lineCommand) ? lineCommand[2] : undefined;
  return isRecord(lineValues) ? lineValues : {};
}

function hasCreateValue(value: unknown) {
  if (value === null || value === undefined) {
    return false;
  }
  if (typeof value === 'string') {
    return value.trim().length > 0;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  return true;
}

function parseBoolean(value: string | undefined, fallback: boolean) {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
    return true;
  }
  if (normalized === 'false' || normalized === '0' || normalized === 'no') {
    return false;
  }
  throw new Error('Odoo boolean env values must be explicitly true or false.');
}

function readRequired(env: OdooAllocationSyncEnv, key: string) {
  const value = env[key];
  if (!value?.trim()) {
    throw new Error(`${key} is required for Odoo allocation sale.order sync.`);
  }
  return value.trim();
}

function readOptional(value: string | undefined) {
  return value?.trim() || undefined;
}

function readNumber(value: string | undefined) {
  const normalized = readOptional(value);
  if (!normalized) {
    return undefined;
  }
  const parsed = Number(normalized);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error('ODOO_SALE_ORDER_PARTNER_ID must be a positive integer.');
  }
  return parsed;
}

function parseOdooVendorPartnerMap(value: string | undefined) {
  const normalized = readOptional(value);
  if (!normalized) {
    throw new Error('ODOO_VENDOR_PARTNER_MAP is required for allocation sale.order sync.');
  }

  return normalized.split(',').reduce<Record<string, number>>((map, entry) => {
    const [rawVendorId, rawPartnerId, ...extra] = entry.split(':');
    const vendorId = rawVendorId?.trim();
    const partnerId = Number(rawPartnerId?.trim());
    if (!vendorId || extra.length > 0 || !Number.isInteger(partnerId) || partnerId <= 0) {
      throw new Error('ODOO_VENDOR_PARTNER_MAP must use vendor_id:positive_partner_id pairs separated by commas.');
    }
    map[vendorId] = partnerId;
    return map;
  }, {});
}

function readStringOrNull(value: unknown) {
  return typeof value === 'string' ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function describeOdooAllocationSyncError(error: unknown) {
  if (error instanceof OdooClientError) {
    return [error.message, error.details?.model, error.details?.method, error.details?.odooMessage].filter(Boolean).join(' ');
  }

  return error instanceof Error ? sanitizeErrorText(error.message) : 'Unknown Odoo allocation sale.order sync error.';
}

function sanitizeErrorText(value: string) {
  return value
    .replace(/api[_-]?key[^\s,;)]*/gi, 'api_key=[redacted]')
    .replace(/password[^\s,;)]*/gi, 'password=[redacted]')
    .replace(/token[^\s,;)]*/gi, 'token=[redacted]');
}
