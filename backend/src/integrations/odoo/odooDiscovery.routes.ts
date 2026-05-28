import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { describeOdooProbeError, runOdooDiscovery, type OdooProbeEnv } from './odooOrderProbe.js';

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
}
