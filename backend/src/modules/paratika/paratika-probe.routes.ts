import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppEnv } from '../../config/env.js';
import { createAuthMiddleware } from '../auth/auth.middleware.js';
import { createAuthService } from '../auth/auth.service.js';
import { CONFIRMED_VENDOR_PAYMENT_SELLERS, seedVendorPaymentSellerMappings } from '../payments/vendor-payment-seller.service.js';
import { buildParatikaSessionTokenPayloadPreviewForOrder } from './paratika-sessiontoken-payload.service.js';

function adminProbesEnabled() {
  return process.env.ADMIN_PROBES_ENABLED?.trim().toLowerCase() === 'true';
}

async function runPaymentSellerMappingBackfill(request: FastifyRequest, reply: FastifyReply) {
  if (request.authUser?.role !== 'admin') {
    return reply.code(403).send({ message: 'Forbidden' });
  }

  if (!adminProbesEnabled()) {
    return reply.code(403).send({ ok: false, message: 'Admin probe endpoints are disabled.' });
  }

  await seedVendorPaymentSellerMappings();

  return reply.code(200).send({
    ok: true,
    writesPerformed: true,
    provider: 'PARATIKA',
    upserted: CONFIRMED_VENDOR_PAYMENT_SELLERS.map((mapping) => ({
      vendorId: mapping.vendorId,
      externalSellerId: mapping.externalSellerId,
      enabled: true,
    })),
  });
}

export function registerParatikaProbeRoutes(app: FastifyInstance, env: AppEnv) {
  const authService = createAuthService(env);
  const authMiddleware = createAuthMiddleware(authService);

  app.get<{ Params: { orderId: string } }>(
    '/admin/probes/paratika/orders/:orderId/sessiontoken-payload-preview',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Forbidden' });
      }

      if (!adminProbesEnabled()) {
        return reply.code(403).send({ ok: false, message: 'Admin probe endpoints are disabled.' });
      }

      const result = await buildParatikaSessionTokenPayloadPreviewForOrder(request.params.orderId, {
        returnUrl: process.env.PARATIKA_RETURN_URL,
      });

      return reply.code(result.ok ? 200 : 422).send(result);
    },
  );

  app.get(
    '/admin/probes/paratika/payment-seller-mappings/backfill',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    runPaymentSellerMappingBackfill,
  );

  app.post(
    '/admin/probes/paratika/payment-seller-mappings/backfill',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    runPaymentSellerMappingBackfill,
  );
}
