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
  getVendorReturnFinanceRecords,
  listPayoutBatches,
  markPayoutBatchReview,
  preparePayoutBatch,
  upsertShipmentShippingCost,
  upsertVendorFinancialProfile,
} from './finance.service.js';
import { getFinanceEventBackfillPlan } from './finance-event-backfill-planner.service.js';
import { getFinanceEventRelinkPlan, relinkExistingFinanceEvents } from './finance-event-relink.service.js';
import {
  approveSettlementApproval,
  cancelSettlementApproval,
  createDraftApproval,
  getSettlementApproval,
  getSettlementApprovalAudit,
  listSettlementApprovalsForVendor,
  previewApproval,
} from './settlement-approval.service.js';
import { previewSettlementLogoCommissionInvoice } from './settlement-commission-invoice-preview.service.js';
import {
  findBySettlementApproval as findSettlementCommissionInvoiceRecords,
  getSettlementCommissionInvoiceDiagnostics,
} from './settlement-commission-invoice-record.service.js';
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

function readOptionalQueryString(query: unknown, key: string) {
  if (!isRecord(query)) {
    return null;
  }

  const value = query[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readOptionalBodyString(body: unknown, key: string) {
  if (!isRecord(body)) {
    return null;
  }

  const value = body[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readOptionalBodyDate(body: unknown, key: string) {
  const value = readOptionalBodyString(body, key);
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${key} must be a valid date.`);
  }
  return parsed;
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
    '/finance/return-records',
    {
      preHandler: [authMiddleware.authenticateRequest, requireVendorAccess],
    },
    async (request, reply) => {
      const vendorId = request.vendorContext?.vendorId;
      if (!vendorId) {
        return reply.code(400).send({ message: 'Vendor context could not be resolved.' });
      }

      const shopifyRefundId = readOptionalQueryString(request.query, 'shopifyRefundId');
      const shopifyOrderNumber = readOptionalQueryString(request.query, 'shopifyOrderNumber');

      return withDashboardRouteTiming('GET /finance/return-records', () =>
        withSlowEndpointTiming('GET /finance/return-records', () =>
          getVendorReturnFinanceRecords(vendorId, { shopifyRefundId, shopifyOrderNumber }),
        ),
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
    '/admin/finance/events/backfill-plan',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Admin access required.' });
      }

      return getFinanceEventBackfillPlan();
    },
  );

  app.get(
    '/admin/finance/events/relink-plan',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Admin access required.' });
      }

      return getFinanceEventRelinkPlan();
    },
  );

  app.post(
    '/admin/finance/events/relink-existing',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Admin access required.' });
      }

      if (!isRecord(request.body) || request.body.confirmRelink !== true) {
        return reply.code(400).send({
          message: 'confirmRelink must be true to relink existing FinanceEvent rows.',
          writesPerformed: false,
        });
      }

      return relinkExistingFinanceEvents();
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
    '/admin/finance/settlement-approvals/preview',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Admin access required.' });
      }

      try {
        const vendorId = readOptionalBodyString(request.body, 'vendorId');
        if (!vendorId) {
          return reply.code(400).send({ message: 'vendorId is required.' });
        }
        return await previewApproval(
          vendorId,
          readOptionalBodyDate(request.body, 'periodStart'),
          readOptionalBodyDate(request.body, 'periodEnd'),
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Settlement approval preview could not be created.';
        return reply.code(400).send({ message });
      }
    },
  );

  app.post(
    '/admin/finance/settlement-approvals',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Admin access required.' });
      }

      try {
        const vendorId = readOptionalBodyString(request.body, 'vendorId');
        if (!vendorId) {
          return reply.code(400).send({ message: 'vendorId is required.' });
        }
        return await createDraftApproval({
          vendorId,
          periodStart: readOptionalBodyDate(request.body, 'periodStart'),
          periodEnd: readOptionalBodyDate(request.body, 'periodEnd'),
          notes: readOptionalBodyString(request.body, 'notes'),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Settlement approval draft could not be created.';
        return reply.code(400).send({ message });
      }
    },
  );

  app.get(
    '/admin/finance/settlement-approvals',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Admin access required.' });
      }

      try {
        const vendorId = readOptionalQueryString(request.query, 'vendorId');
        if (!vendorId) {
          return reply.code(400).send({ message: 'vendorId is required.' });
        }
        return await listSettlementApprovalsForVendor(vendorId);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Settlement approvals could not be loaded.';
        return reply.code(400).send({ message });
      }
    },
  );

  app.get(
    '/admin/finance/settlement-approvals/:id',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Admin access required.' });
      }

      const { id } = request.params as { id: string };
      const approval = await getSettlementApproval(id);
      if (!approval) {
        return reply.code(404).send({ message: 'Settlement approval not found.' });
      }
      return approval;
    },
  );

  app.get(
    '/admin/finance/settlement-approvals/:id/audit',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Admin access required.' });
      }

      const { id } = request.params as { id: string };
      const audit = await getSettlementApprovalAudit(id);
      if (!audit) {
        return reply.code(404).send({ message: 'Settlement approval not found.' });
      }
      return audit;
    },
  );

  app.post(
    '/admin/finance/settlement-approvals/:id/logo-commission-invoice-preview',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Admin access required.' });
      }

      const { id } = request.params as { id: string };
      return previewSettlementLogoCommissionInvoice(id);
    },
  );

  app.get(
    '/admin/finance/settlement-approvals/:id/commission-invoice-records',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Admin access required.' });
      }

      const { id } = request.params as { id: string };
      return {
        ok: true,
        writesPerformed: false,
        settlementApprovalId: id,
        records: await findSettlementCommissionInvoiceRecords(id),
      };
    },
  );

  app.get(
    '/admin/finance/commission-invoices/:id',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Admin access required.' });
      }

      const { id } = request.params as { id: string };
      const diagnostics = await getSettlementCommissionInvoiceDiagnostics(id);
      if (!diagnostics) {
        return reply.code(404).send({ message: 'Settlement commission invoice record not found.' });
      }
      return diagnostics;
    },
  );

  app.post(
    '/admin/finance/settlement-approvals/:id/approve',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Admin access required.' });
      }

      const { id } = request.params as { id: string };
      try {
        return await approveSettlementApproval(id, request.authUser.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Settlement approval could not be approved.';
        return reply.code(400).send({ message });
      }
    },
  );

  app.post(
    '/admin/finance/settlement-approvals/:id/cancel',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Admin access required.' });
      }

      const { id } = request.params as { id: string };
      try {
        return await cancelSettlementApproval(id, request.authUser.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Settlement approval could not be cancelled.';
        return reply.code(400).send({ message });
      }
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
