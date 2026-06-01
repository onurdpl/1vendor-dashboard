import type { FastifyInstance } from 'fastify';
import {
  authenticateVendorIntegrationRequest,
  requireVendorIntegrationScope,
  writeVendorIntegrationAuditLog,
} from './vendor-integration.auth.js';
import { listVendorIntegrationOrders, type VendorIntegrationOrdersQuery } from './vendor-integration.orders.service.js';
import './vendor-integration.types.js';

export function registerVendorIntegrationRoutes(app: FastifyInstance) {
  app.addHook('onResponse', writeVendorIntegrationAuditLog);

  app.get<{ Querystring: VendorIntegrationOrdersQuery }>(
    '/api/vendor-integration/orders',
    {
      preHandler: [authenticateVendorIntegrationRequest, requireVendorIntegrationScope('orders:read')],
    },
    async (request, reply) => {
      const context = request.vendorIntegration;
      if (!context) {
        return reply.code(401).send({ message: 'Vendor integration token is required.' });
      }

      try {
        return await listVendorIntegrationOrders(context.vendorIdentifier, request.query);
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('Unsupported allocation status filter:')) {
          return reply.code(400).send({ message: error.message });
        }

        throw error;
      }
    },
  );
}
