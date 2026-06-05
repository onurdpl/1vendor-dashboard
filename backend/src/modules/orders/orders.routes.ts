import type { FastifyInstance } from 'fastify';
import type { AppEnv } from '../../config/env.js';
import { createAuthService } from '../auth/auth.service.js';
import { createAuthMiddleware } from '../auth/auth.middleware.js';
import { requireVendorAccess } from '../vendor-access/vendor-access.middleware.js';
import { getAdminShopifyOrderBreakdown, getVendorOrderByIdForUser, listVendorOrders } from './orders.service.js';
import { resolvePagination } from '../../lib/pagination.js';
import { withSlowEndpointTiming } from '../../lib/performance.js';
import { createShopifyAdminService } from '../shopify/shopify-admin.service.js';
import { withDashboardRouteTiming } from '../../lib/dashboard-timing.js';

export function registerOrdersRoutes(app: FastifyInstance, env: AppEnv) {
  const authService = createAuthService(env);
  const authMiddleware = createAuthMiddleware(authService);
  const shopifyAdminService = createShopifyAdminService(env);

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

      return withDashboardRouteTiming('GET /orders', () =>
        withSlowEndpointTiming('GET /orders', () => listVendorOrders(vendorId, resolvePagination(request.query))),
      );
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

      const order = await withSlowEndpointTiming(`GET /orders/:orderId`, () =>
        getVendorOrderByIdForUser(vendorId, request.params.orderId, {
          includeShipmentProviderResponseSummary: request.authUser?.role === 'admin',
          includeFinanceLedgerPreview: request.authUser?.role === 'admin',
          shopifyAdminService,
        }),
      );
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

      const breakdown = await withSlowEndpointTiming('GET /admin/orders/:shopifyOrderId', () =>
        getAdminShopifyOrderBreakdown(request.params.shopifyOrderId),
      );
      if (!breakdown) {
        return reply.code(404).send({ message: 'Shopify order not found.' });
      }

      return breakdown;
    },
  );
}
