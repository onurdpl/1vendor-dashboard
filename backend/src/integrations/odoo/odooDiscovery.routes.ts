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
const REAL_ALLOCATION_EXCLUDED_TERMS = ['test', 'probe', 'verify', 'synthetic', 'odoo-sync'] as const;

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

function adminProbesEnabled() {
  return process.env.ADMIN_PROBES_ENABLED?.trim().toLowerCase() === 'true';
}

function assertAdminProbeAuthorized(headers: Record<string, string | string[] | undefined>) {
  if (!adminProbesEnabled()) {
    return { ok: false as const, statusCode: 403, message: 'Admin probe endpoints are disabled.' };
  }

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

  app.post('/admin/probes/odoo-real-allocation-sync-once', async (request, reply) => {
    const auth = assertAdminProbeAuthorized(request.headers);
    if (!auth.ok) {
      return reply.code(auth.statusCode).send({ ok: false, message: auth.message });
    }

    try {
      const result = await runOdooRealAllocationSyncOnce();
      return reply.code(result.ok ? 200 : 502).send(result);
    } catch (error) {
      return reply.code(502).send({
        ok: false,
        error: sanitizeProbeError(error),
      });
    }
  });

  app.get<{ Querystring: { allocationId?: string } }>('/admin/probes/odoo-allocation-sync-status', async (request, reply) => {
    const auth = assertAdminProbeAuthorized(request.headers);
    if (!auth.ok) {
      return reply.code(auth.statusCode).send({ ok: false, message: auth.message });
    }

    const allocationId = request.query.allocationId?.trim();
    if (!allocationId) {
      return reply.code(400).send({ ok: false, message: 'allocationId query parameter is required.' });
    }

    try {
      const result = await runOdooAllocationSyncStatus(allocationId);
      return reply.code(result.ok ? 200 : 404).send(result);
    } catch (error) {
      return reply.code(502).send({
        ok: false,
        allocationId,
        error: sanitizeProbeError(error),
      });
    }
  });

  app.get<{ Querystring: { allocationId?: string } }>('/admin/probes/odoo-allocation-sync-diagnosis', async (request, reply) => {
    const auth = assertAdminProbeAuthorized(request.headers);
    if (!auth.ok) {
      return reply.code(auth.statusCode).send({ ok: false, message: auth.message });
    }

    const allocationId = request.query.allocationId?.trim();
    if (!allocationId) {
      return reply.code(400).send({ ok: false, message: 'allocationId query parameter is required.' });
    }

    try {
      const result = await runOdooAllocationSyncDiagnosis(allocationId);
      return reply.code(result.ok ? 200 : 404).send(result);
    } catch (error) {
      return reply.code(502).send({
        ok: false,
        allocationId,
        error: sanitizeProbeError(error),
      });
    }
  });
}

async function runOdooAllocationSyncDiagnosis(allocationId: string) {
  const warnings: string[] = [];
  const unknowns: string[] = [];
  const errors: string[] = [];
  const allocation = await readOdooAllocationDiagnosisAllocation(allocationId);

  if (!allocation) {
    return {
      ok: false,
      allocation: null,
      runtime: summarizeOdooAllocationSyncEnv(),
      odoo: null,
      codePath: summarizeOdooSyncCodePath(),
      diagnosis: {
        exactFailureReason: `VendorAllocation ${allocationId} was not found.`,
        canSafelyRetry: false,
        smallestFix: 'Confirm the allocation id before retrying.',
      },
      warnings,
      unknowns,
      errors: [`VendorAllocation ${allocationId} was not found.`],
    };
  }

  const runtime = {
    ...summarizeOdooAllocationSyncEnv(),
    vendorMapping: summarizeVendorPartnerMapping(allocation.assignedVendorId),
  };
  const clientOrderRef = buildOdooAllocationClientOrderRef(allocation.id);
  let odoo: Awaited<ReturnType<typeof inspectOdooAllocationSyncPrerequisites>> | null = null;

  try {
    odoo = await inspectOdooAllocationSyncPrerequisites(allocation, clientOrderRef);
  } catch (error) {
    errors.push(sanitizeProbeError(error).message);
  }

  if (allocation.lineItems.length === 0) {
    errors.push('Allocation has no line items.');
  }
  if (!runtime.vendorMapping.mapped) {
    errors.push(`No Odoo vendor portal partner mapping configured for vendor ${allocation.assignedVendorId}.`);
  }
  const vendorFieldName = readOdooVendorFieldName();
  if (odoo?.xVendorField.exists === false) {
    errors.push(`Odoo sale.order.${vendorFieldName} does not exist.`);
  }
  if (odoo?.xVendorField.exists && !odoo.xVendorField.writable) {
    errors.push(`Odoo sale.order.${vendorFieldName} is not writable.`);
  }
  if (odoo?.xVendorField.exists && (!odoo.xVendorField.isMany2one || !odoo.xVendorField.isResPartnerRelation)) {
    errors.push(`Odoo sale.order.${vendorFieldName} is not a many2one field to res.partner.`);
  }
  if (odoo?.matchingOdooSaleOrderCount === 0) {
    unknowns.push('No Odoo sale.order found by deterministic client_order_ref.');
  }

  const exactFailureReason = errors[0] ?? (unknowns.length ? unknowns[0] : null);
  const canSafelyRetry = errors.length === 0;
  const smallestFix = chooseOdooDiagnosisSmallestFix(errors, allocation.lineItems.length);

  return {
    ok: errors.length === 0,
    allocation: summarizeAllocationDiagnosis(allocation),
    clientOrderRef,
    runtime,
    odoo,
    codePath: summarizeOdooSyncCodePath(),
    diagnosis: {
      exactFailureReason,
      canSafelyRetry,
      smallestFix,
    },
    warnings,
    unknowns,
    errors,
  };
}

async function runOdooAllocationSyncStatus(allocationId: string) {
  const warnings: string[] = [];
  const unknowns: string[] = [];
  const errors: string[] = [];
  const allocation = await readOdooAllocationStatusAllocation(allocationId);

  if (!allocation) {
    return {
      ok: false,
      allocation: null,
      odooSaleOrder: null,
      matchingOdooSaleOrderCount: null,
      warnings,
      unknowns,
      errors: [`VendorAllocation ${allocationId} was not found.`],
    };
  }

  const clientOrderRef = buildOdooAllocationClientOrderRef(allocation.id);
  let odooSaleOrder = null;
  let matchingOdooSaleOrderCount: number | null = null;

  try {
    const odooState = allocation.odooSaleOrderId
      ? await readOdooSaleOrderVerificationState(allocation.odooSaleOrderId, clientOrderRef)
      : await searchOdooSaleOrderByClientOrderRef(clientOrderRef);
    odooSaleOrder = odooState.saleOrder;
    matchingOdooSaleOrderCount = odooState.matchingCount;
  } catch (error) {
    errors.push(sanitizeProbeError(error).message);
  }

  if (!allocation.odooSaleOrderId) {
    unknowns.push('Local allocation does not have odooSaleOrderId.');
  }
  if (!allocation.odooSaleOrderName) {
    unknowns.push('Local allocation does not have odooSaleOrderName.');
  }
  if (!allocation.odooSaleOrderSyncedAt) {
    unknowns.push('Local allocation does not have odooSaleOrderSyncedAt.');
  }
  if (matchingOdooSaleOrderCount === 0) {
    unknowns.push('No Odoo sale.order found by deterministic client_order_ref.');
  }
  if (matchingOdooSaleOrderCount !== null && matchingOdooSaleOrderCount > 1) {
    warnings.push('Multiple Odoo sale.orders were found for the deterministic client_order_ref.');
  }

  return {
    ok: errors.length === 0,
    allocation: summarizeAllocationSyncStatus(allocation),
    clientOrderRef,
    odooSaleOrder,
    matchingOdooSaleOrderCount,
    warnings,
    unknowns,
    errors,
  };
}

async function runOdooRealAllocationSyncOnce() {
  const warnings: string[] = [];
  const unknowns: string[] = [];
  const errors: string[] = [];
  const env = summarizeOdooAllocationSyncEnv();
  const selectedAllocation = await selectNewestRealUnsyncedAllocationForOdooSync();

  if (!selectedAllocation) {
    return {
      ok: false,
      env,
      selectedAllocation: null,
      warnings,
      unknowns,
      errors: ['No eligible real VendorAllocation found for Odoo sync.'],
    };
  }

  const clientOrderRef = buildOdooAllocationClientOrderRef(selectedAllocation.id);
  const beforeOdooState = await readOdooSaleOrderVerificationStateIfPossible(null, clientOrderRef);
  const firstSync = await syncOdooSaleOrderForAllocation(selectedAllocation.id, {
    logger: quietProbeLogger(),
  });
  const afterFirst = await readOdooRealAllocationSyncState(selectedAllocation.id);

  if (firstSync.status === 'failed') {
    errors.push(firstSync.error);
  }
  if (firstSync.status === 'disabled' || firstSync.status === 'dry_run') {
    errors.push(`First sync did not create/update Odoo because status was ${firstSync.status}.`);
  }

  let secondSync: Awaited<ReturnType<typeof syncOdooSaleOrderForAllocation>> | null = null;
  let afterSecond = afterFirst;
  if (errors.length === 0) {
    secondSync = await syncOdooSaleOrderForAllocation(selectedAllocation.id, {
      logger: quietProbeLogger(),
    });
    afterSecond = await readOdooRealAllocationSyncState(selectedAllocation.id);

    if (secondSync.status === 'failed') {
      errors.push(secondSync.error);
    }
    if (secondSync.status !== 'skipped_existing') {
      warnings.push(`Second sync returned ${secondSync.status}; expected skipped_existing for idempotency.`);
    }
  }

  let odooSaleOrder = null;
  let matchingOdooSaleOrderCount: number | null = null;
  if (afterSecond?.odooSaleOrderId) {
    try {
      const odoo = await readOdooSaleOrderVerificationState(afterSecond.odooSaleOrderId, clientOrderRef);
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
    secondSync?.status === 'skipped_existing' &&
    matchingOdooSaleOrderCount === 1;

  if (!idempotencyPassed) {
    warnings.push('Idempotency was not fully confirmed.');
  }

  const createdExactlyOne =
    beforeOdooState.matchingCount === 0 &&
    firstSync.status === 'synced' &&
    matchingOdooSaleOrderCount === 1 &&
    idempotencyPassed;

  if (!createdExactlyOne) {
    unknowns.push('Exactly-one new Odoo draft sale.order creation was not confirmed from before/after counts.');
  }

  return {
    ok: errors.length === 0,
    env,
    selection: {
      rule: 'newest non-test VendorAllocation with null odooSaleOrderId, at least one line item, and assigned vendor identifier present',
      excludedTerms: [...REAL_ALLOCATION_EXCLUDED_TERMS],
      reason: 'Selected by createdAt desc, then id desc, after eligibility filters.',
    },
    selectedAllocation: summarizeSelectedAllocation(selectedAllocation),
    beforeOdooState,
    firstSync: sanitizeSyncResult(firstSync),
    secondSync: secondSync ? sanitizeSyncResult(secondSync) : null,
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
    createdExactlyOne,
    idempotencyPassed,
    warnings,
    unknowns,
    errors: errors.map(sanitizeText),
  };
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

async function selectNewestRealUnsyncedAllocationForOdooSync() {
  return prisma.vendorAllocation.findFirst({
    where: {
      odooSaleOrderId: null,
      assignedVendorId: { not: '' },
      lineItems: { some: {} },
      NOT: [
        { id: ODOO_SYNC_VERIFY_ALLOCATION_ID },
        ...REAL_ALLOCATION_EXCLUDED_TERMS.flatMap((term) => [
          { id: { contains: term, mode: 'insensitive' as const } },
          { sourceShopifyOrderNumber: { contains: term, mode: 'insensitive' as const } },
        ]),
      ],
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    include: {
      assignedVendor: {
        select: {
          id: true,
          name: true,
        },
      },
      order: {
        select: {
          id: true,
          sourceShopifyOrderId: true,
          sourceShopifyOrderNumber: true,
          customerName: true,
        },
      },
      lineItems: {
        select: {
          id: true,
          quantity: true,
          shopifyOrderLineItem: {
            select: {
              sourceLineItemId: true,
              sku: true,
              title: true,
              unitPrice: true,
            },
          },
        },
        orderBy: {
          createdAt: 'asc',
        },
      },
    },
  });
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

function readOdooRealAllocationSyncState(allocationId: string) {
  return prisma.vendorAllocation.findUnique({
    where: { id: allocationId },
    select: {
      id: true,
      odooSaleOrderId: true,
      odooSaleOrderName: true,
      odooSaleOrderSyncedAt: true,
    },
  });
}

function readOdooAllocationStatusAllocation(allocationId: string) {
  return prisma.vendorAllocation.findUnique({
    where: { id: allocationId },
    include: {
      order: {
        select: {
          id: true,
          sourceShopifyOrderId: true,
          sourceShopifyOrderNumber: true,
        },
      },
      lineItems: {
        select: {
          id: true,
        },
      },
    },
  });
}

function readOdooAllocationDiagnosisAllocation(allocationId: string) {
  return prisma.vendorAllocation.findUnique({
    where: { id: allocationId },
    include: {
      order: {
        select: {
          id: true,
          sourceShopifyOrderId: true,
          sourceShopifyOrderNumber: true,
        },
      },
      lineItems: {
        select: {
          id: true,
          quantity: true,
          shopifyOrderLineItem: {
            select: {
              sourceLineItemId: true,
              sourceVariantId: true,
              sku: true,
              title: true,
              unitPrice: true,
            },
          },
        },
        orderBy: {
          createdAt: 'asc',
        },
      },
    },
  });
}

async function inspectOdooAllocationSyncPrerequisites(
  allocation: NonNullable<Awaited<ReturnType<typeof readOdooAllocationDiagnosisAllocation>>>,
  clientOrderRef: string,
) {
  const client = buildOdooClientFromEnv();
  const uid = await client.authenticate();
  const skus = allocation.lineItems
    .map((lineItem) => lineItem.shopifyOrderLineItem.sku?.trim())
    .filter((sku): sku is string => Boolean(sku));
  const [saleOrderFields, saleOrderLineFields, matchingCount, products] = await Promise.all([
    client.fieldsGet(uid, 'sale.order'),
    client.fieldsGet(uid, 'sale.order.line'),
    client.modelCall<number>(uid, 'sale.order', 'search_count', [[[ 'client_order_ref', '=', clientOrderRef ]]]),
    Promise.all(skus.map((sku) => searchOdooProductByDefaultCode(client, uid, sku))),
  ]);

  return {
    authSucceeded: true,
    xVendorField: summarizeOdooField(saleOrderFields[readOdooVendorFieldName()]),
    saleOrderRequiredWritableFields: requiredWritableFieldNames(saleOrderFields),
    saleOrderLineRequiredWritableFields: requiredWritableFieldNames(saleOrderLineFields),
    products,
    matchingOdooSaleOrderCount: matchingCount,
  };
}

async function searchOdooProductByDefaultCode(client: OdooClient, uid: number, sku: string) {
  const records = await client.modelCall<Array<Record<string, unknown>>>(uid, 'product.product', 'search_read', [[[ 'default_code', '=', sku ]]], {
    fields: ['id', 'display_name', 'name', 'default_code'],
    limit: 5,
  });

  return {
    sku,
    exists: records.length > 0,
    count: records.length,
    matches: records.map((record) => ({
      id: Number(record.id),
      name: readStringOrNull(record.display_name) ?? readStringOrNull(record.name),
      defaultCode: readStringOrNull(record.default_code),
    })),
  };
}

function requiredWritableFieldNames(fields: Record<string, { required?: boolean; readonly?: boolean }>) {
  return Object.entries(fields)
    .filter(([, definition]) => definition.required && !definition.readonly)
    .map(([field]) => field)
    .sort();
}

function summarizeOdooField(definition: { type?: string; readonly?: boolean; required?: boolean; string?: string; relation?: string } | undefined) {
  if (!definition) {
    return {
      exists: false,
      writable: false,
      isMany2one: false,
      isResPartnerRelation: false,
      type: null,
      relation: null,
      required: null,
      label: null,
    };
  }

  return {
    exists: true,
    writable: definition.readonly !== true,
    isMany2one: definition.type === 'many2one',
    isResPartnerRelation: definition.relation === 'res.partner',
    type: definition.type ?? null,
    relation: definition.relation ?? null,
    required: definition.required === true,
    label: definition.string ?? null,
  };
}

function readOdooVendorFieldName() {
  return process.env.ODOO_VENDOR_FIELD_NAME?.trim() || 'ODOO_VENDOR_FIELD_NAME';
}

async function searchOdooSaleOrderByClientOrderRef(clientOrderRef: string) {
  const client = buildOdooClientFromEnv();
  const uid = await client.authenticate();
  const vendorFieldName = readOdooVendorFieldName();
  const [saleOrders, matchingCount] = await Promise.all([
    client.modelCall<Array<Record<string, unknown>>>(uid, 'sale.order', 'search_read', [[[ 'client_order_ref', '=', clientOrderRef ]]], {
      fields: ['id', 'name', 'state', 'client_order_ref', vendorFieldName],
      limit: 1,
    }),
    client.modelCall<number>(uid, 'sale.order', 'search_count', [[[ 'client_order_ref', '=', clientOrderRef ]]]),
  ]);
  const saleOrder = saleOrders[0];

  return {
    saleOrder: saleOrder ? summarizeOdooSaleOrder(saleOrder, vendorFieldName) : null,
    matchingCount,
  };
}

async function readOdooSaleOrderVerificationStateIfPossible(odooSaleOrderId: string | null, clientOrderRef: string) {
  const client = buildOdooClientFromEnv();
  const uid = await client.authenticate();
  const matchingCount = await client.modelCall<number>(uid, 'sale.order', 'search_count', [[[ 'client_order_ref', '=', clientOrderRef ]]]);

  if (!odooSaleOrderId) {
    return {
      saleOrder: null,
      matchingCount,
    };
  }

  const saleOrderId = Number(odooSaleOrderId);
  if (!Number.isInteger(saleOrderId) || saleOrderId <= 0) {
    throw new Error('Stored Odoo sale.order id is not numeric.');
  }

  const vendorFieldName = readOdooVendorFieldName();
  const saleOrders = await client.modelCall<Array<Record<string, unknown>>>(uid, 'sale.order', 'read', [[saleOrderId]], {
    fields: ['id', 'name', 'state', 'client_order_ref', vendorFieldName],
  });
  const saleOrder = saleOrders[0];

  return {
    saleOrder: saleOrder ? summarizeOdooSaleOrder(saleOrder, vendorFieldName) : null,
    matchingCount,
  };
}

async function readOdooSaleOrderVerificationState(odooSaleOrderId: string, clientOrderRef: string) {
  return readOdooSaleOrderVerificationStateIfPossible(odooSaleOrderId, clientOrderRef);
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
    ODOO_VENDOR_FIELD_NAME: exists(process.env.ODOO_VENDOR_FIELD_NAME),
    ODOO_VENDOR_PARTNER_MAP: exists(process.env.ODOO_VENDOR_PARTNER_MAP),
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
  return buildOdooAllocationClientOrderRef(ODOO_SYNC_VERIFY_ALLOCATION_ID);
}

function buildOdooAllocationClientOrderRef(allocationId: string) {
  return `sporgym-allocation:${allocationId}`;
}

function summarizeSelectedAllocation(allocation: NonNullable<Awaited<ReturnType<typeof selectNewestRealUnsyncedAllocationForOdooSync>>>) {
  return {
    id: allocation.id,
    createdAt: allocation.createdAt.toISOString(),
    shopifyOrderNumber: allocation.sourceShopifyOrderNumber,
    shopifyOrderId: allocation.order.sourceShopifyOrderId,
    localOrderId: allocation.order.id,
    vendorIdentifier: allocation.assignedVendorId,
    vendorName: allocation.assignedVendor.name,
    lineItemCount: allocation.lineItems.length,
    lineItems: allocation.lineItems.map((lineItem) => ({
      id: lineItem.id,
      sourceLineItemId: lineItem.shopifyOrderLineItem.sourceLineItemId,
      sku: lineItem.shopifyOrderLineItem.sku,
      title: lineItem.shopifyOrderLineItem.title,
      quantity: lineItem.quantity,
      unitPrice: lineItem.shopifyOrderLineItem.unitPrice?.toString() ?? null,
    })),
  };
}

function summarizeAllocationSyncStatus(allocation: NonNullable<Awaited<ReturnType<typeof readOdooAllocationStatusAllocation>>>) {
  return {
    id: allocation.id,
    shopifyOrderNumber: allocation.sourceShopifyOrderNumber,
    shopifyOrderId: allocation.order.sourceShopifyOrderId,
    localOrderId: allocation.order.id,
    vendorIdentifier: allocation.assignedVendorId,
    lineItemCount: allocation.lineItems.length,
    odooSaleOrderId: allocation.odooSaleOrderId,
    odooSaleOrderName: allocation.odooSaleOrderName,
    odooSaleOrderSyncedAt: allocation.odooSaleOrderSyncedAt?.toISOString() ?? null,
  };
}

function summarizeAllocationDiagnosis(allocation: NonNullable<Awaited<ReturnType<typeof readOdooAllocationDiagnosisAllocation>>>) {
  return {
    id: allocation.id,
    shopifyOrderNumber: allocation.sourceShopifyOrderNumber,
    shopifyOrderId: allocation.order.sourceShopifyOrderId,
    localOrderId: allocation.order.id,
    vendorIdentifier: allocation.assignedVendorId,
    lineItemCount: allocation.lineItems.length,
    odooSaleOrderId: allocation.odooSaleOrderId,
    odooSaleOrderName: allocation.odooSaleOrderName,
    odooSaleOrderSyncedAt: allocation.odooSaleOrderSyncedAt?.toISOString() ?? null,
    lineItems: allocation.lineItems.map((lineItem) => ({
      id: lineItem.id,
      sourceLineItemId: lineItem.shopifyOrderLineItem.sourceLineItemId,
      sourceVariantId: lineItem.shopifyOrderLineItem.sourceVariantId,
      sku: lineItem.shopifyOrderLineItem.sku,
      title: lineItem.shopifyOrderLineItem.title,
      quantity: lineItem.quantity,
      unitPrice: lineItem.shopifyOrderLineItem.unitPrice?.toString() ?? null,
    })),
  };
}

function summarizeOdooSaleOrder(saleOrder: Record<string, unknown>, vendorFieldName = readOdooVendorFieldName()) {
  return {
    id: typeof saleOrder.id === 'number' ? saleOrder.id : Number(saleOrder.id),
    name: readStringOrNull(saleOrder.name),
    state: readStringOrNull(saleOrder.state),
    clientOrderRef: readStringOrNull(saleOrder.client_order_ref),
    vendorFieldName,
    vendorFieldValue: readOdooManyToOneRef(saleOrder[vendorFieldName]),
    xVendorId: readOdooManyToOneRef(saleOrder[vendorFieldName]),
  };
}

function summarizeVendorPartnerMapping(vendorIdentifier: string) {
  const map = parseVendorPartnerMap(process.env.ODOO_VENDOR_PARTNER_MAP);
  return {
    vendorIdentifier,
    configured: Boolean(process.env.ODOO_VENDOR_PARTNER_MAP?.trim()),
    mapped: map[vendorIdentifier] !== undefined,
    mappedPartnerId: map[vendorIdentifier] ?? null,
  };
}

function parseVendorPartnerMap(value: string | undefined) {
  const normalized = value?.trim();
  if (!normalized) {
    return {} as Record<string, number>;
  }

  return normalized.split(',').reduce<Record<string, number>>((map, entry) => {
    const [rawVendorId, rawPartnerId] = entry.split(':');
    const vendorId = rawVendorId?.trim();
    const partnerId = Number(rawPartnerId?.trim());
    if (vendorId && Number.isInteger(partnerId) && partnerId > 0) {
      map[vendorId] = partnerId;
    }
    return map;
  }, {});
}

function summarizeOdooSyncCodePath() {
  return {
    syncCalledAfterAllocationPersistence: true,
    syncResultPersistedOnFailure: false,
    syncFailureHandling: 'syncOdooSaleOrdersForAllocations returns failed results and logs errors, but order ingestion does not persist those results.',
    createsOdooRecordsInThisDiagnosis: false,
    currentLineStrategy: 'product_backed_sale_order_lines',
    requiresProductIdInCode: true,
  };
}

function chooseOdooDiagnosisSmallestFix(errors: string[], lineItemCount: number) {
  if (lineItemCount === 0) {
    return 'Allocation must have line items before retry.';
  }
  if (errors.some((error) => error.includes('product_id'))) {
    return 'Fix the reported Odoo product lookup or product_id prerequisite before retry.';
  }
  if (errors.some((error) => error.includes('vendor portal partner mapping'))) {
    return 'Configure ODOO_VENDOR_PARTNER_MAP for the allocation vendor before retry.';
  }
  if (errors.some((error) => error.includes(readOdooVendorFieldName()) || error.includes('vendor field'))) {
    return `Create/fix writable sale.order.${readOdooVendorFieldName()} as a many2one to res.partner before retry.`;
  }
  if (errors.length) {
    return 'Fix the reported Odoo/runtime prerequisite, then retry the allocation sync.';
  }
  return 'No current prerequisite failure detected; safe to retry with the guarded sync endpoint if operationally approved.';
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

function readOdooManyToOneRef(value: unknown) {
  if (Array.isArray(value) && typeof value[0] === 'number') {
    return {
      id: value[0],
      name: readStringOrNull(value[1]),
    };
  }
  if (typeof value === 'number') {
    return {
      id: value,
      name: null,
    };
  }
  return null;
}
