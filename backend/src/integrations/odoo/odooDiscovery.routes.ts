import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { describeOdooProbeError, runOdooDiscovery, runOdooDraftOrderCreateProbe, type OdooProbeEnv } from './odooOrderProbe.js';

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

export function registerOdooDiscoveryProbeRoutes(app: FastifyInstance) {
  app.post('/admin/probes/odoo-discovery', async (request, reply) => {
    const expectedToken = process.env.ADMIN_PROBE_TOKEN?.trim();
    if (!expectedToken) {
      return reply.code(503).send({
        ok: false,
        message: 'Admin probe token is not configured.',
      });
    }

    const providedToken = readHeaderValue(request.headers['x-admin-probe-token']).trim();
    if (!providedToken || !safeTokenMatches(providedToken, expectedToken)) {
      return reply.code(403).send({
        ok: false,
        message: 'Forbidden',
      });
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
    const expectedToken = process.env.ADMIN_PROBE_TOKEN?.trim();
    if (!expectedToken) {
      return reply.code(503).send({
        ok: false,
        message: 'Admin probe token is not configured.',
      });
    }

    const providedToken = readHeaderValue(request.headers['x-admin-probe-token']).trim();
    if (!providedToken || !safeTokenMatches(providedToken, expectedToken)) {
      return reply.code(403).send({
        ok: false,
        message: 'Forbidden',
      });
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
}
