import type { FastifyInstance } from 'fastify';
import type { AppEnv } from '../../config/env.js';
import { createAuthMiddleware } from '../auth/auth.middleware.js';
import { createAuthService } from '../auth/auth.service.js';
import { requireVendorAccess } from '../vendor-access/vendor-access.middleware.js';
import {
  cancelPayoutBatch,
  getPayoutBatch,
  getVendorFinanceDashboard,
  getVendorFinanceSummary,
  getVendorFinancialProfile,
  listPayoutBatches,
  markPayoutBatchReview,
  preparePayoutBatch,
  upsertShipmentShippingCost,
  upsertVendorFinancialProfile,
} from './finance.service.js';
import { resolvePagination } from '../../lib/pagination.js';
import { withSlowEndpointTiming } from '../../lib/performance.js';
import { withDashboardRouteTiming } from '../../lib/dashboard-timing.js';
import type { PreparePayoutBatchDto, ShippingCostInputDto, VendorFinancialProfileUpdateDto } from './finance.types.js';

const SUPPORTED_VENDOR_FINANCIAL_SHIPPING_MODES = new Set(['disabled', 'fixed', 'external_provider']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validateVendorFinancialShippingMode(body: unknown) {
  if (!isRecord(body) || !Object.prototype.hasOwnProperty.call(body, 'shippingMode')) {
    return { ok: true as const };
  }

  if (
    typeof body.shippingMode !== 'string' ||
    !SUPPORTED_VENDOR_FINANCIAL_SHIPPING_MODES.has(body.shippingMode)
  ) {
    return {
      ok: false as const,
      message: 'shippingMode must be disabled, fixed, or external_provider.',
    };
  }

  return { ok: true as const };
}

export function registerFinanceRoutes(app: FastifyInstance, env: AppEnv) {
  const authService = createAuthService(env);
  const authMiddleware = createAuthMiddleware(authService);

  app.get(
    '/finance/summary',
    {
      preHandler: [authMiddleware.authenticateRequest, requireVendorAccess],
    },
    async (request, reply) => {
      const vendorId = request.vendorContext?.vendorId;
      if (!vendorId) {
        return reply.code(400).send({ message: 'Vendor context could not be resolved.' });
      }

      return withDashboardRouteTiming('GET /finance/summary', () =>
        withSlowEndpointTiming('GET /finance/summary', () => getVendorFinanceSummary(vendorId)),
      );
    },
  );

  app.get(
    '/finance/profile',
    {
      preHandler: [authMiddleware.authenticateRequest, requireVendorAccess],
    },
    async (request, reply) => {
      const vendorId = request.vendorContext?.vendorId;
      if (!vendorId) {
        return reply.code(400).send({ message: 'Vendor context could not be resolved.' });
      }

      return withDashboardRouteTiming('GET /finance/profile', () =>
        withSlowEndpointTiming('GET /finance/profile', () => getVendorFinancialProfile(vendorId)),
      );
    },
  );

  app.get(
    '/finance',
    {
      preHandler: [authMiddleware.authenticateRequest, requireVendorAccess],
    },
    async (request, reply) => {
      const vendorId = request.vendorContext?.vendorId;
      if (!vendorId) {
        return reply.code(400).send({ message: 'Vendor context could not be resolved.' });
      }

      return withDashboardRouteTiming('GET /finance', () =>
        withSlowEndpointTiming('GET /finance', () => getVendorFinanceDashboard(vendorId, resolvePagination(request.query))),
      );
    },
  );

  app.get(
    '/admin/vendors/:vendorId/financial-profile',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Admin access required.' });
      }

      const { vendorId } = request.params as { vendorId: string };
      return getVendorFinancialProfile(vendorId);
    },
  );

  app.put(
    '/admin/vendors/:vendorId/financial-profile',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Admin access required.' });
      }

      const { vendorId } = request.params as { vendorId: string };
      try {
        const shippingModeValidation = validateVendorFinancialShippingMode(request.body);
        if (!shippingModeValidation.ok) {
          return reply.code(400).send({ message: shippingModeValidation.message });
        }

        return await upsertVendorFinancialProfile(vendorId, (request.body ?? {}) as VendorFinancialProfileUpdateDto);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Vendor financial profile could not be saved.';
        return reply.code(400).send({ message });
      }
    },
  );

  app.get(
    '/admin/payout-batches',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Admin access required.' });
      }

      const vendorId = typeof (request.query as { vendorId?: unknown }).vendorId === 'string'
        ? (request.query as { vendorId: string }).vendorId
        : undefined;
      return listPayoutBatches(vendorId);
    },
  );

  app.post(
    '/admin/payout-batches/prepare',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Admin access required.' });
      }

      try {
        return await preparePayoutBatch((request.body ?? {}) as PreparePayoutBatchDto, request.authUser.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Payout batch could not be prepared.';
        return reply.code(400).send({ message });
      }
    },
  );

  app.get(
    '/admin/payout-batches/:id',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Admin access required.' });
      }

      const { id } = request.params as { id: string };
      const batch = await getPayoutBatch(id);
      if (!batch) {
        return reply.code(404).send({ message: 'Payout batch not found.' });
      }
      return batch;
    },
  );

  app.post(
    '/admin/payout-batches/:id/cancel',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Admin access required.' });
      }

      const { id } = request.params as { id: string };
      return cancelPayoutBatch(id);
    },
  );

  app.post(
    '/admin/payout-batches/:id/mark-review',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Admin access required.' });
      }

      const { id } = request.params as { id: string };
      return markPayoutBatchReview(id);
    },
  );

  app.post(
    '/admin/shipping-costs',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Admin access required.' });
      }

      try {
        return await upsertShipmentShippingCost((request.body ?? {}) as ShippingCostInputDto);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Shipping cost could not be saved.';
        return reply.code(400).send({ message });
      }
    },
  );
}
