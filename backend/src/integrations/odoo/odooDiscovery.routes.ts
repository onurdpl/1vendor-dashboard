import { timingSafeEqual } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../../db/prisma.js';
import { OdooClient } from './odooClient.js';
import { syncOdooSaleOrderForAllocation } from './odooAllocationOrderSync.service.js';
import { describeOdooProbeError, runOdooDiscovery, runOdooDraftOrderCreateProbe, type OdooProbeEnv } from './odooOrderProbe.js';

const ODOO_SYNC_VERIFY_REFERENCE = 'SPORGYM-ODOO-SYNC-VERIFY';
const ODOO_SYNC_VERIFY_ORDER_ID = 'odoo-sync-verify-order';
const ODOO_SYNC_VERIFY_LINE_ITEM_ID = 'odoo-sync-verify-line-item';
const ODOO_SYNC_VERIFY_ALLOCATION_ID = 'alloc-odoo-sync-verify';
const ODOO_SYNC_VERIFY_VENDOR_ID = 'yalispor';
const ODOO_SYNC_VERIFY_COLUMNS = ['odooSaleOrderId', 'odooSaleOrderName', 'odooSaleOrderSyncedAt'] as const;

function readHeaderValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0] ?? '';
  }
  return value ?? '';
}

function safeTokenMatches(provided: string, expected: string) {
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }
  return timingSafeEqual(providedBuffer, expectedBuffer);
}

function buildForcedDiscoveryEnv(): OdooProbeEnv {
  return {
    ...(process.env as OdooProbeEnv),
    ODOO_ENABLED: 'true',
    ODOO_DRY_RUN: 'false',
    ODOO_DISCOVERY_ONLY: 'true',
  };
}

function buildForcedDraftOrderEnv(): OdooProbeEnv {
  const probeReference = process.env.ODOO_PROBE_REFERENCE || `SPORGYM-ODOO-DRAFT-ORDER-PROBE-${Date.now()}`;
  return {
    ...(process.env as OdooProbeEnv),
    ODOO_ENABLED: 'true',
    ODOO_DRY_RUN: 'false',
    ODOO_DISCOVERY_ONLY: 'false',
    ODOO_PROBE_REFERENCE: probeReference,
    ODOO_PROBE_SHOPIFY_ORDER_NAME: process.env.ODOO_PROBE_SHOPIFY_ORDER_NAME || `#${probeReference}`,
    ODOO_PROBE_ALLOCATION_ID: process.env.ODOO_PROBE_ALLOCATION_ID || probeReference,
    ODOO_PROBE_VENDOR_NAME: process.env.ODOO_PROBE_VENDOR_NAME || 'Sporgym',
    ODOO_PROBE_SKU: process.env.ODOO_PROBE_SKU || 'SPORGYM-ODOO-PROBE',
    ODOO_PROBE_PRODUCT_NAME: process.env.ODOO_PROBE_PRODUCT_NAME || 'Sporgym Vendor Allocation Probe Item',
    ODOO_PROBE_QUANTITY: process.env.ODOO_PROBE_QUANTITY || '1',
    ODOO_PROBE_UNIT_PRICE: process.env.ODOO_PROBE_UNIT_PRICE || '1',
  };
}

function assertAdminProbeAuthorized(headers: Record<string, string | string[] | undefined>) {
  const expectedToken = process.env.ADMIN_PROBE_TOKEN?.trim();
  if (!expectedToken) {
    return { ok: false as const, statusCode: 503, message: 'Admin probe token is not configured.' };
  }

  const providedToken = readHeaderValue(headers['x-admin-probe-token']).trim();
  if (!providedToken || !safeTokenMatches(providedToken, expectedToken)) {
    return { ok: false as const, statusCode: 403, message: 'Forbidden' };
  }

  return { ok: true as const };
}

export function registerOdooDiscoveryProbeRoutes(app: FastifyInstance) {
  app.post('/admin/probes/odoo-discovery', async (request, reply) => {
    const auth = assertAdminProbeAuthorized(request.headers);
    if (!auth.ok) {
      return reply.code(auth.statusCode).send({ ok: false, message: auth.message });
    }

    try {
      const discovery = await runOdooDiscovery({
        env: buildForcedDiscoveryEnv(),
      });

      return {
        ok: true,
        discovery,
      };
    } catch (error) {
      return reply.code(502).send({
        ok: false,
        error: describeOdooProbeError(error),
      });
    }
  });

  app.post('/admin/probes/odoo-draft-order', async (request, reply) => {
    const auth = assertAdminProbeAuthorized(request.headers);
    if (!auth.ok) {
      return reply.code(auth.statusCode).send({ ok: false, message: auth.message });
    }

    try {
      const result = await runOdooDraftOrderCreateProbe({
        env: buildForcedDraftOrderEnv(),
      });

      if (result.validationErrors.length) {
        return reply.code(422).send({
          ok: false,
          result,
        });
      }

      return {
        ok: true,
        result,
      };
    } catch (error) {
      return reply.code(502).send({
        ok: false,
        error: describeOdooProbeError(error),
      });
    }
  });

  app.post('/admin/probes/odoo-allocation-sync-verify', async (request, reply) => {
    const auth = assertAdminProbeAuthorized(request.headers);
    if (!auth.ok) {
      return reply.code(auth.statusCode).send({ ok: false, message: auth.message });
    }

    try {
      const result = await runOdooAllocationSyncVerification();
      return reply.code(result.ok ? 200 : 502).send(result);
    } catch (error) {
      return reply.code(502).send({
        ok: false,
        error: sanitizeProbeError(error),
      });
    }
  });
}

async function runOdooAllocationSyncVerification() {
  const warnings: string[] = [];
  const unknowns: string[] = [];
  const errors: string[] = [];
  const env = summarizeOdooAllocationSyncEnv();
  const schema = await verifyOdooAllocationSyncColumns();

  if (!schema.allPresent) {
    errors.push('VendorAllocation Odoo sync columns are missing; sync was not attempted.');
    return {
      ok: false,
      schema,
      env,
      testAllocationId: ODOO_SYNC_VERIFY_ALLOCATION_ID,
      warnings,
      unknowns,
      errors,
    };
  }

  await ensureOdooSyncVerificationFixture();

  const firstSync = await syncOdooSaleOrderForAllocation(ODOO_SYNC_VERIFY_ALLOCATION_ID, {
    logger: quietProbeLogger(),
  });
  const afterFirst = await readOdooSyncVerificationAllocation();
  const secondSync = await syncOdooSaleOrderForAllocation(ODOO_SYNC_VERIFY_ALLOCATION_ID, {
    logger: quietProbeLogger(),
  });
  const afterSecond = await readOdooSyncVerificationAllocation();

  if (firstSync.status === 'failed') {
    errors.push(firstSync.error);
  }
  if (secondSync.status === 'failed') {
    errors.push(secondSync.error);
  }
  if (firstSync.status === 'disabled' || firstSync.status === 'dry_run') {
    warnings.push(`First sync did not create/update Odoo because status was ${firstSync.status}.`);
  }
  if (secondSync.status === 'disabled' || secondSync.status === 'dry_run') {
    warnings.push(`Second sync did not verify idempotency because status was ${secondSync.status}.`);
  }

  let odooSaleOrder = null;
  let matchingOdooSaleOrderCount: number | null = null;
  if (afterSecond?.odooSaleOrderId) {
    try {
      const odoo = await readOdooSaleOrderVerificationState(afterSecond.odooSaleOrderId, buildOdooSyncVerificationClientOrderRef());
      odooSaleOrder = odoo.saleOrder;
      matchingOdooSaleOrderCount = odoo.matchingCount;
    } catch (error) {
      errors.push(sanitizeProbeError(error).message);
    }
  } else {
    unknowns.push('Local allocation does not have an Odoo sale.order id after sync attempts.');
  }

  const idempotencyPassed =
    Boolean(afterFirst?.odooSaleOrderId) &&
    Boolean(afterSecond?.odooSaleOrderId) &&
    afterFirst?.odooSaleOrderId === afterSecond?.odooSaleOrderId &&
    secondSync.status === 'skipped_existing' &&
    matchingOdooSaleOrderCount === 1;

  if (!idempotencyPassed) {
    warnings.push('Idempotency was not fully confirmed.');
  }

  return {
    ok: errors.length === 0,
    schema,
    env,
    testAllocationId: ODOO_SYNC_VERIFY_ALLOCATION_ID,
    firstSync: sanitizeSyncResult(firstSync),
    secondSync: sanitizeSyncResult(secondSync),
    localAllocation: afterSecond
      ? {
          id: afterSecond.id,
          odooSaleOrderId: afterSecond.odooSaleOrderId,
          odooSaleOrderName: afterSecond.odooSaleOrderName,
          odooSaleOrderSyncedAt: afterSecond.odooSaleOrderSyncedAt?.toISOString() ?? null,
        }
      : null,
    odooSaleOrder,
    matchingOdooSaleOrderCount,
    idempotencyPassed,
    warnings,
    unknowns,
    errors,
  };
}

async function verifyOdooAllocationSyncColumns() {
  const rows = await prisma.$queryRaw<Array<{ column_name: string }>>(Prisma.sql`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'VendorAllocation'
      AND column_name IN (${Prisma.join([...ODOO_SYNC_VERIFY_COLUMNS])})
  `);
  const present = new Set(rows.map((row) => row.column_name));
  const fields = Object.fromEntries(ODOO_SYNC_VERIFY_COLUMNS.map((column) => [column, present.has(column)]));

  return {
    allPresent: ODOO_SYNC_VERIFY_COLUMNS.every((column) => present.has(column)),
    fields,
  };
}

async function ensureOdooSyncVerificationFixture() {
  const vendor = await prisma.vendor.findUnique({
    where: { id: ODOO_SYNC_VERIFY_VENDOR_ID },
  });
  if (!vendor) {
    throw new Error(`Required test vendor ${ODOO_SYNC_VERIFY_VENDOR_ID} was not found.`);
  }

  await prisma.$transaction(async (tx) => {
    const order = await tx.shopifyOrder.upsert({
      where: { sourceShopifyOrderId: ODOO_SYNC_VERIFY_REFERENCE },
      update: {
        sourceShopifyOrderNumber: `#${ODOO_SYNC_VERIFY_REFERENCE}`,
        customerName: 'Sporgym Odoo Sync Verify Customer',
        customerEmail: null,
        totalPrice: '1.00',
      },
      create: {
        id: ODOO_SYNC_VERIFY_ORDER_ID,
        sourceShopifyOrderId: ODOO_SYNC_VERIFY_REFERENCE,
        sourceShopifyOrderNumber: `#${ODOO_SYNC_VERIFY_REFERENCE}`,
        customerName: 'Sporgym Odoo Sync Verify Customer',
        customerEmail: null,
        totalPrice: '1.00',
      },
    });

    await tx.shopifyOrderLineItem.upsert({
      where: { id: ODOO_SYNC_VERIFY_LINE_ITEM_ID },
      update: {
        sourceLineItemId: `${ODOO_SYNC_VERIFY_REFERENCE}-LINE-1`,
        sourceVariantId: null,
        sku: ODOO_SYNC_VERIFY_REFERENCE,
        title: 'Sporgym Odoo sync verification item',
        quantity: 1,
        unitPrice: '1.00',
        originalVendorId: ODOO_SYNC_VERIFY_VENDOR_ID,
      },
      create: {
        id: ODOO_SYNC_VERIFY_LINE_ITEM_ID,
        shopifyOrderId: order.id,
        sourceLineItemId: `${ODOO_SYNC_VERIFY_REFERENCE}-LINE-1`,
        sourceVariantId: null,
        sku: ODOO_SYNC_VERIFY_REFERENCE,
        title: 'Sporgym Odoo sync verification item',
        quantity: 1,
        unitPrice: '1.00',
        originalVendorId: ODOO_SYNC_VERIFY_VENDOR_ID,
      },
    });

    await tx.vendorAllocation.upsert({
      where: { id: ODOO_SYNC_VERIFY_ALLOCATION_ID },
      update: {
        sourceShopifyOrderId: order.id,
        sourceShopifyOrderNumber: `#${ODOO_SYNC_VERIFY_REFERENCE}`,
        originalVendorId: ODOO_SYNC_VERIFY_VENDOR_ID,
        assignedVendorId: ODOO_SYNC_VERIFY_VENDOR_ID,
        allocationStatus: 'ACTIVE',
        cancellationReason: null,
        reassignmentRequired: false,
        fulfillmentStatus: 'Pending',
        shippingStatus: 'Awaiting Shipment',
        carrier: null,
        trackingNumber: null,
      },
      create: {
        id: ODOO_SYNC_VERIFY_ALLOCATION_ID,
        sourceShopifyOrderId: order.id,
        sourceShopifyOrderNumber: `#${ODOO_SYNC_VERIFY_REFERENCE}`,
        originalVendorId: ODOO_SYNC_VERIFY_VENDOR_ID,
        assignedVendorId: ODOO_SYNC_VERIFY_VENDOR_ID,
        allocationStatus: 'ACTIVE',
        reassignmentRequired: false,
        fulfillmentStatus: 'Pending',
        shippingStatus: 'Awaiting Shipment',
      },
    });

    await tx.vendorAllocationLineItem.upsert({
      where: {
        vendorAllocationId_shopifyLineItemId: {
          vendorAllocationId: ODOO_SYNC_VERIFY_ALLOCATION_ID,
          shopifyLineItemId: ODOO_SYNC_VERIFY_LINE_ITEM_ID,
        },
      },
      update: {
        quantity: 1,
        lineAmount: '1.00',
      },
      create: {
        vendorAllocationId: ODOO_SYNC_VERIFY_ALLOCATION_ID,
        shopifyLineItemId: ODOO_SYNC_VERIFY_LINE_ITEM_ID,
        quantity: 1,
        lineAmount: '1.00',
      },
    });
  });
}

function readOdooSyncVerificationAllocation() {
  return prisma.vendorAllocation.findUnique({
    where: { id: ODOO_SYNC_VERIFY_ALLOCATION_ID },
    select: {
      id: true,
      odooSaleOrderId: true,
      odooSaleOrderName: true,
      odooSaleOrderSyncedAt: true,
    },
  });
}

async function readOdooSaleOrderVerificationState(odooSaleOrderId: string, clientOrderRef: string) {
  const client = buildOdooClientFromEnv();
  const uid = await client.authenticate();
  const saleOrderId = Number(odooSaleOrderId);
  if (!Number.isInteger(saleOrderId) || saleOrderId <= 0) {
    throw new Error('Stored Odoo sale.order id is not numeric.');
  }

  const [saleOrders, matchingCount] = await Promise.all([
    client.modelCall<Array<Record<string, unknown>>>(uid, 'sale.order', 'read', [[saleOrderId]], {
      fields: ['id', 'name', 'state', 'client_order_ref'],
    }),
    client.modelCall<number>(uid, 'sale.order', 'search_count', [[[ 'client_order_ref', '=', clientOrderRef ]]]),
  ]);
  const saleOrder = saleOrders[0];

  return {
    saleOrder: saleOrder
      ? {
          id: Number(saleOrder.id),
          name: readStringOrNull(saleOrder.name),
          state: readStringOrNull(saleOrder.state),
          clientOrderRef: readStringOrNull(saleOrder.client_order_ref),
        }
      : null,
    matchingCount,
  };
}

function buildOdooClientFromEnv() {
  const missing = ['ODOO_URL', 'ODOO_DB', 'ODOO_USERNAME', 'ODOO_API_KEY'].filter((key) => !process.env[key]?.trim());
  if (missing.length) {
    throw new Error(`Missing Odoo env vars: ${missing.join(', ')}`);
  }

  return new OdooClient({
    url: process.env.ODOO_URL?.trim() ?? '',
    db: process.env.ODOO_DB?.trim() ?? '',
    username: process.env.ODOO_USERNAME?.trim() ?? '',
    apiKey: process.env.ODOO_API_KEY?.trim() ?? '',
  });
}

function summarizeOdooAllocationSyncEnv() {
  return {
    ODOO_ENABLED: maskEnvBoolean('ODOO_ENABLED'),
    ODOO_DRY_RUN: maskEnvBoolean('ODOO_DRY_RUN'),
    ODOO_DISCOVERY_ONLY: maskEnvBoolean('ODOO_DISCOVERY_ONLY'),
    ODOO_URL: exists(process.env.ODOO_URL),
    ODOO_DB: exists(process.env.ODOO_DB),
    ODOO_USERNAME: exists(process.env.ODOO_USERNAME),
    ODOO_API_KEY: exists(process.env.ODOO_API_KEY),
    ODOO_SALE_ORDER_PARTNER_ID: exists(process.env.ODOO_SALE_ORDER_PARTNER_ID),
    ODOO_SALE_ORDER_PARTNER_NAME: exists(process.env.ODOO_SALE_ORDER_PARTNER_NAME),
    saleOrderPartnerConfigured: exists(process.env.ODOO_SALE_ORDER_PARTNER_ID) || exists(process.env.ODOO_SALE_ORDER_PARTNER_NAME),
  };
}

function maskEnvBoolean(key: string) {
  const value = process.env[key]?.trim();
  if (!value) {
    return { exists: false };
  }
  return { exists: true, value: value.toLowerCase() === 'true' ? 'true' : value.toLowerCase() === 'false' ? 'false' : 'set' };
}

function exists(value: string | undefined) {
  return Boolean(value?.trim());
}

function buildOdooSyncVerificationClientOrderRef() {
  return `sporgym-allocation:${ODOO_SYNC_VERIFY_ALLOCATION_ID}`;
}

function quietProbeLogger() {
  return {
    log: () => undefined,
    error: () => undefined,
  };
}

function sanitizeSyncResult(result: Awaited<ReturnType<typeof syncOdooSaleOrderForAllocation>>) {
  return result.status === 'failed'
    ? { ...result, error: sanitizeText(result.error) }
    : result;
}

function sanitizeProbeError(error: unknown) {
  return {
    message: sanitizeText(error instanceof Error ? error.message : 'Unknown Odoo allocation sync verification error.'),
  };
}

function sanitizeText(value: string) {
  return value
    .replace(/api[_-]?key[^\s,;)]*/gi, 'api_key=[redacted]')
    .replace(/password[^\s,;)]*/gi, 'password=[redacted]')
    .replace(/token[^\s,;)]*/gi, 'token=[redacted]');
}

function readStringOrNull(value: unknown) {
  return typeof value === 'string' ? value : null;
}
