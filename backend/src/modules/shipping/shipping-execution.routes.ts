import type { FastifyInstance } from 'fastify';
import type { AppEnv } from '../../config/env.js';
import { createAuthMiddleware } from '../auth/auth.middleware.js';
import { createAuthService } from '../auth/auth.service.js';
import { requireVendorAccess } from '../vendor-access/vendor-access.middleware.js';
import {
  createShipmentExecution,
  getShipmentExecutionById,
  getVendorShippingConfig,
  listShipmentExecutions,
  upsertVendorShippingConfig,
} from './shipping-execution.service.js';
import type { CreateShipmentExecutionDto, VendorShippingConfigUpdateDto } from './shipping-execution.types.js';

export function registerShippingExecutionRoutes(app: FastifyInstance, env: AppEnv) {
  const authService = createAuthService(env);
  const authMiddleware = createAuthMiddleware(authService);

  app.get(
    '/shipping/config',
    {
      preHandler: [authMiddleware.authenticateRequest, requireVendorAccess],
    },
    async (request, reply) => {
      const vendorId = request.vendorContext?.vendorId;
      if (!vendorId) {
        return reply.code(400).send({ message: 'Vendor context could not be resolved.' });
      }

      return getVendorShippingConfig(vendorId);
    },
  );

  app.post(
    '/shipments/create',
    {
      preHandler: [authMiddleware.authenticateRequest, requireVendorAccess],
    },
    async (request, reply) => {
      const vendorId = request.vendorContext?.vendorId;
      if (!vendorId) {
        return reply.code(400).send({ message: 'Vendor context could not be resolved.' });
      }

      try {
        return await createShipmentExecution((request.body ?? {}) as CreateShipmentExecutionDto, {
          env,
          vendorId,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Shipment execution could not be created.';
        return reply.code(400).send({ message });
      }
    },
  );

  app.get<{ Params: { id: string } }>(
    '/shipments/:id',
    {
      preHandler: [authMiddleware.authenticateRequest, requireVendorAccess],
    },
    async (request, reply) => {
      const vendorId = request.vendorContext?.vendorId;
      if (!vendorId) {
        return reply.code(400).send({ message: 'Vendor context could not be resolved.' });
      }

      const shipment = await getShipmentExecutionById(request.params.id, vendorId);
      if (!shipment) {
        return reply.code(404).send({ message: 'Shipment execution not found.' });
      }

      return shipment;
    },
  );

  app.get(
    '/admin/shipments',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Admin access required.' });
      }

      const query = request.query as { vendorId?: string; status?: string };
      return listShipmentExecutions({
        vendorId: query.vendorId,
        status: query.status as never,
      });
    },
  );

  app.put(
    '/admin/vendors/:vendorId/shipping-config',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Admin access required.' });
      }

      const { vendorId } = request.params as { vendorId: string };
      try {
        return await upsertVendorShippingConfig(vendorId, (request.body ?? {}) as VendorShippingConfigUpdateDto);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Vendor shipping configuration could not be saved.';
        return reply.code(400).send({ message });
      }
    },
  );
}
