import type { FastifyInstance } from 'fastify';
import { SettlementCommissionInvoiceProvider } from '@prisma/client';
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
  PayoutBatchTransitionRevalidationError,
  preparePayoutBatch,
  upsertShipmentShippingCost,
  upsertVendorFinancialProfile,
} from './finance.service.js';
import { getVendorDebtHistory } from './vendor-balance.service.js';
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
  SettlementApprovalRevalidationError,
} from './settlement-approval.service.js';
import { previewSettlementLogoCommissionInvoice } from './settlement-commission-invoice-preview.service.js';
import {
  createPendingRecordFromImmutableRequestSnapshot,
  findBySettlementApproval as findSettlementCommissionInvoiceRecords,
  getSettlementCommissionInvoiceDiagnostics,
} from './settlement-commission-invoice-record.service.js';
import { executeSettlementLogoCommissionInvoiceCreate } from './settlement-logo-commission-invoice-create.service.js';
import {
  persistSettlementLogoSalesInvoiceSync,
  previewSettlementLogoOutgoingInvoiceSync,
} from './settlement-logo-outgoing-invoice-sync-preview.service.js';
import {
  backfillPendingRefundAdjustments,
  previewPendingRefundAdjustmentApplication,
  previewRefundAdjustmentEligibility,
  type RefundAdjustmentRecommendedAction,
} from './settlement-refund-adjustment-eligibility-diagnostics.service.js';
import {
  getSettlementRefundAdjustmentDetail,
  listSettlementRefundAdjustments,
} from './settlement-refund-adjustment.service.js';
import {
  createSettlementScheduleDrafts,
  getSettlementScheduleDryRun,
} from './settlement-schedule.service.js';
import {
  getSettlementScheduleAutoDraftJobStatus,
  runSettlementScheduleAutoDraftJob,
} from './settlement-schedule-job.service.js';
import { resolvePagination } from '../../lib/pagination.js';
import { withSlowEndpointTiming } from '../../lib/performance.js';
import { withDashboardRouteTiming } from '../../lib/dashboard-timing.js';
import type { PreparePayoutBatchDto, ShippingCostInputDto, VendorFinancialProfileUpdateDto } from './finance.types.js';

const SUPPORTED_VENDOR_FINANCIAL_SHIPPING_MODES = new Set(['disabled', 'fixed', 'external_provider']);
const SUPPORTED_REFUND_ADJUSTMENT_RECOMMENDED_ACTIONS = new Set<RefundAdjustmentRecommendedAction>([
  'CREATE_PENDING_ADJUSTMENT',
  'ALREADY_HAS_ADJUSTMENT',
  'VENDOR_DEBT_REQUIRED',
  'NOT_AFTER_APPROVED_OR_INVOICED_SETTLEMENT',
  'MISSING_RELATED_SALE_LEDGER',
  'MISSING_APPROVED_SETTLEMENT_LINE',
  'MISSING_VENDOR_ALLOCATION',
  'ZERO_OR_INVALID_AMOUNT',
  'UNKNOWN',
]);

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

function readOptionalQueryNumber(query: unknown, key: string) {
  const value = readOptionalQueryString(query, key);
  if (!value) {
    return null;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw new Error(`${key} must be a valid number.`);
  }
  return numeric;
}

function readOptionalBodyString(body: unknown, key: string) {
  if (!isRecord(body)) {
    return null;
  }

  const value = body[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readOptionalBodyNumber(body: unknown, key: string) {
  if (!isRecord(body) || !Object.prototype.hasOwnProperty.call(body, key)) {
    return null;
  }
  const value = body[key];
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw new Error(`${key} must be a valid number.`);
  }
  return numeric;
}

function readOptionalBodyStringArray(body: unknown, key: string) {
  if (!isRecord(body)) {
    return [];
  }

  const value = body[key];
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(new Set(value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)));
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

function readOptionalCandidateScope(body: unknown) {
  const value = readOptionalBodyString(body, 'candidateScope');
  if (!value) {
    return null;
  }
  if (
    value !== 'vendor_wide' &&
    value !== 'date_range' &&
    value !== 'selected_orders' &&
    value !== 'selected_allocations'
  ) {
    throw new Error('candidateScope must be vendor_wide, date_range, selected_orders, or selected_allocations.');
  }
  return value;
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
    '/finance/vendor-debt-history',
    {
      preHandler: [authMiddleware.authenticateRequest, requireVendorAccess],
    },
    async (request, reply) => {
      const vendorId = request.vendorContext?.vendorId;
      if (!vendorId) {
        return reply.code(400).send({ message: 'Vendor context could not be resolved.' });
      }

      return withDashboardRouteTiming('GET /finance/vendor-debt-history', () =>
        withSlowEndpointTiming('GET /finance/vendor-debt-history', () => getVendorDebtHistory(vendorId, 'TRY')),
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

        return await upsertVendorFinancialProfile(vendorId, (request.body ?? {}) as VendorFinancialProfileUpdateDto, {
          actor: {
            userId: request.authUser?.id ?? null,
            email: request.authUser?.email ?? null,
          },
        });
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
      try {
        return await markPayoutBatchReview(id);
      } catch (error) {
        if (error instanceof PayoutBatchTransitionRevalidationError) {
          return reply.code(409).send({
            message: error.message,
            blockers: error.blockers,
          });
        }
        throw error;
      }
    },
  );

  app.get(
    '/admin/finance/settlement-schedules/dry-run',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Admin access required.' });
      }

      try {
        return await getSettlementScheduleDryRun({
          runDate: readOptionalQueryString(request.query, 'runDate'),
          vendorId: readOptionalQueryString(request.query, 'vendorId'),
          limit: readOptionalQueryNumber(request.query, 'limit'),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Settlement schedule dry run could not be created.';
        return reply.code(400).send({ message, writesPerformed: false });
      }
    },
  );

  app.post(
    '/admin/finance/settlement-schedules/create-drafts',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Admin access required.' });
      }

      try {
        if (!isRecord(request.body) || request.body.confirmAutoSettlementDrafts !== true) {
          return reply.code(400).send({
            message: 'confirmAutoSettlementDrafts must be true to create scheduled settlement drafts.',
            writesPerformed: false,
          });
        }

        return await createSettlementScheduleDrafts({
          runDate: readOptionalBodyString(request.body, 'runDate'),
          vendorId: readOptionalBodyString(request.body, 'vendorId'),
          limit: readOptionalBodyNumber(request.body, 'limit'),
          confirmAutoSettlementDrafts: true,
          createdBy: request.authUser?.id ?? null,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Scheduled settlement drafts could not be created.';
        return reply.code(400).send({ message, writesPerformed: false });
      }
    },
  );

  app.get(
    '/admin/finance/settlement-schedules/auto-draft-job-status',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Admin access required.' });
      }

      return getSettlementScheduleAutoDraftJobStatus(env);
    },
  );

  app.post(
    '/admin/finance/settlement-schedules/run-auto-draft-job',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Admin access required.' });
      }

      try {
        return await runSettlementScheduleAutoDraftJob({
          env,
          runDate: isRecord(request.body) ? readOptionalBodyString(request.body, 'runDate') : null,
          confirmScheduledSettlementAutoDraftJob:
            isRecord(request.body) && request.body.confirmScheduledSettlementAutoDraftJob === true,
          triggeredBy: request.authUser?.id ?? null,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Scheduled settlement auto-draft job failed.';
        return reply.code(400).send({ message, writesPerformed: false });
      }
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
          {
            candidateScope: readOptionalCandidateScope(request.body),
            selectedOrderIds: readOptionalBodyStringArray(request.body, 'selectedOrderIds'),
            selectedShopifyOrderIds: readOptionalBodyStringArray(request.body, 'selectedShopifyOrderIds'),
            selectedAllocationIds: readOptionalBodyStringArray(request.body, 'selectedAllocationIds'),
          },
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
          candidateScope: readOptionalCandidateScope(request.body),
          selectedOrderIds: readOptionalBodyStringArray(request.body, 'selectedOrderIds'),
          selectedShopifyOrderIds: readOptionalBodyStringArray(request.body, 'selectedShopifyOrderIds'),
          selectedAllocationIds: readOptionalBodyStringArray(request.body, 'selectedAllocationIds'),
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

  app.post(
    '/admin/finance/settlement-approvals/:id/logo-commission-invoice-request-snapshot',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Admin access required.' });
      }

      const { id } = request.params as { id: string };
      return createPendingRecordFromImmutableRequestSnapshot(
        id,
        SettlementCommissionInvoiceProvider.LOGO_ISBASI,
        { createdBy: request.authUser.id },
      );
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
    '/admin/finance/refund-adjustments/application-preview',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Admin access required.' });
      }

      const vendorId = readOptionalQueryString(request.query, 'vendorId');
      if (!vendorId) {
        return reply.code(400).send({
          ok: false,
          writesPerformed: false,
          message: 'vendorId is required.',
        });
      }
      const currencyCode = readOptionalQueryString(request.query, 'currencyCode');
      const pagination = resolvePagination(request.query, { limit: 100, offset: 0 });

      return previewPendingRefundAdjustmentApplication({
        vendorId,
        currencyCode,
        limit: pagination.limit,
      });
    },
  );

  app.get(
    '/admin/finance/refund-adjustments/eligibility-preview',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Admin access required.' });
      }

      const vendorId = readOptionalQueryString(request.query, 'vendorId');
      const orderNumber = readOptionalQueryString(request.query, 'orderNumber');
      const requestedAction = readOptionalQueryString(request.query, 'recommendedAction')
        ?? readOptionalQueryString(request.query, 'status');
      const normalizedAction = requestedAction?.toUpperCase() as RefundAdjustmentRecommendedAction | undefined;
      const recommendedAction = normalizedAction && SUPPORTED_REFUND_ADJUSTMENT_RECOMMENDED_ACTIONS.has(normalizedAction)
        ? normalizedAction
        : null;
      const pagination = resolvePagination(request.query, { limit: 100, offset: 0 });

      return previewRefundAdjustmentEligibility({
        vendorId,
        orderNumber,
        recommendedAction,
        limit: pagination.limit,
      });
    },
  );

  app.post(
    '/admin/finance/refund-adjustments/backfill',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Admin access required.' });
      }
      if (!isRecord(request.body) || request.body.confirmRefundAdjustmentBackfill !== true) {
        return reply.code(400).send({
          ok: false,
          writesPerformed: false,
          message: 'Refund adjustment backfill confirmation is required.',
        });
      }

      const vendorId = readOptionalBodyString(request.body, 'vendorId')
        ?? readOptionalQueryString(request.query, 'vendorId');
      const orderNumber = readOptionalBodyString(request.body, 'orderNumber')
        ?? readOptionalQueryString(request.query, 'orderNumber');
      const bodyLimit = isRecord(request.body) ? Number(request.body.limit) : NaN;
      const pagination = Number.isFinite(bodyLimit) && bodyLimit > 0
        ? { limit: Math.min(Math.floor(bodyLimit), 500), offset: 0 }
        : resolvePagination(request.query, { limit: 100, offset: 0 });

      return backfillPendingRefundAdjustments({
        vendorId,
        orderNumber,
        limit: pagination.limit,
        createdBy: request.authUser.id ?? request.authUser.email ?? 'admin',
      });
    },
  );

  app.get(
    '/admin/finance/refund-adjustments',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Admin access required.' });
      }

      const status = readOptionalQueryString(request.query, 'status')?.toUpperCase();
      const vendorId = readOptionalQueryString(request.query, 'vendorId');
      const pagination = resolvePagination(request.query, { limit: 100, offset: 0 });
      const supportedStatus = status && ['PENDING', 'PARTIALLY_APPLIED', 'APPLIED', 'BLOCKED', 'CANCELLED'].includes(status)
        ? status as 'PENDING' | 'PARTIALLY_APPLIED' | 'APPLIED' | 'BLOCKED' | 'CANCELLED'
        : null;

      return listSettlementRefundAdjustments({
        status: supportedStatus,
        vendorId,
        limit: pagination.limit,
      });
    },
  );

  app.get(
    '/admin/finance/refund-adjustments/:id',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Admin access required.' });
      }
      const { id } = request.params as { id: string };
      const detail = await getSettlementRefundAdjustmentDetail(id);
      if (!detail) {
        return reply.code(404).send({ message: 'Refund adjustment not found.' });
      }
      return detail;
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
      const diagnostics = await getSettlementCommissionInvoiceDiagnostics(id, { env });
      if (!diagnostics) {
        return reply.code(404).send({ message: 'Settlement commission invoice record not found.' });
      }
      return diagnostics;
    },
  );

  app.get(
    '/admin/finance/commission-invoices/:id/logo-isbasi/outgoing-invoice-sync-preview',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Admin access required.' });
      }

      const { id } = request.params as { id: string };
      const result = await previewSettlementLogoOutgoingInvoiceSync(id, { env });
      if (!result.ok && result.blockers.length) {
        return reply.code(400).send(result);
      }
      return result;
    },
  );

  app.post(
    '/admin/finance/commission-invoices/:id/logo-isbasi/sales-invoice-sync',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Admin access required.' });
      }

      const { id } = request.params as { id: string };
      const body = isRecord(request.body) ? request.body : {};
      if (body.confirmLogoSalesInvoiceSync !== true) {
        return reply.code(400).send({
          ok: false,
          writesPerformed: false,
          settlementCommissionInvoiceId: id,
          status: 'blocked',
          blockers: ['Logo sales invoice sync confirmation is required.'],
          warnings: [],
          record: null,
          preview: null,
        });
      }

      const syncedBy = request.authUser.email ?? request.authUser.id ?? 'admin';
      const result = await persistSettlementLogoSalesInvoiceSync(id, { env, syncedBy });
      if (!result.ok) {
        return reply.code(409).send(result);
      }
      return result;
    },
  );

  app.post(
    '/admin/finance/commission-invoices/:id/logo-isbasi/create',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Admin access required.' });
      }

      const { id } = request.params as { id: string };
      const body = isRecord(request.body) ? request.body : {};
      if (body.confirmLogoCreate !== true) {
        return reply.code(400).send({
          ok: false,
          writesPerformed: false,
          externalApiCallAttempted: false,
          settlementCommissionInvoiceId: id,
          status: 'blocked',
          blockers: ['Logo create confirmation is required.'],
          warnings: [],
          environmentGuard: null,
          record: null,
          providerResult: null,
        });
      }

      return executeSettlementLogoCommissionInvoiceCreate(id, { env });
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
        if (error instanceof SettlementApprovalRevalidationError) {
          return reply.code(400).send({
            ok: false,
            writesPerformed: false,
            message,
            revalidationReasons: error.reasons,
            blockers: error.reasons.map((reason) => reason.reason),
          });
        }
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
