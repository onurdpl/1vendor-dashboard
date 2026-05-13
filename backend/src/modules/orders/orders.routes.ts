import type { FastifyInstance } from 'fastify';
import type { AppEnv } from '../../config/env.js';
import { createAuthService } from '../auth/auth.service.js';
import { createAuthMiddleware } from '../auth/auth.middleware.js';
import { requireVendorAccess } from '../vendor-access/vendor-access.middleware.js';
import { getAdminShopifyOrderBreakdown, getVendorOrderById, listVendorOrders } from './orders.service.js';
import { resolvePagination } from '../../lib/pagination.js';

export function registerOrdersRoutes(app: FastifyInstance, env: AppEnv) {
  const authService = createAuthService(env);
  const authMiddleware = createAuthMiddleware(authService);

  app.get(
    '/orders',
    {
      preHandler: [authMiddleware.authenticateRequest, requireVendorAccess],
    },
    async (request) => {
      const vendorId = request.vendorContext?.vendorId;
      if (!vendorId) {
        return [];
      }

      return listVendorOrders(vendorId, resolvePagination(request.query));
    },
  );

  app.get<{ Params: { orderId: string } }>(
    '/orders/:orderId',
    {
      preHandler: [authMiddleware.authenticateRequest, requireVendorAccess],
    },
    async (request, reply) => {
      const vendorId = request.vendorContext?.vendorId;
      if (!vendorId) {
        return reply.code(400).send({ message: 'Vendor context could not be resolved.' });
      }

      const order = await getVendorOrderById(vendorId, request.params.orderId);
      if (!order) {
        return reply.code(404).send({ message: 'Order not found.' });
      }

      return order;
    },
  );

  app.get<{ Params: { shopifyOrderId: string } }>(
    '/admin/orders/:shopifyOrderId',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Forbidden' });
      }

      const breakdown = await getAdminShopifyOrderBreakdown(request.params.shopifyOrderId);
      if (!breakdown) {
        return reply.code(404).send({ message: 'Shopify order not found.' });
      }

      return breakdown;
    },
  );
}
