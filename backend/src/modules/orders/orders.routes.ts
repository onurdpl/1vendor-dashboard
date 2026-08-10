import type { FastifyInstance } from 'fastify';
import type { AppEnv } from '../../config/env.js';
import { createAuthService } from '../auth/auth.service.js';
import { createAuthMiddleware } from '../auth/auth.middleware.js';
import { requireVendorAccess } from '../vendor-access/vendor-access.middleware.js';
import { requireUnrestrictedVendorMutation } from '../vendor-access/restricted-vendor.js';
import {
  addBlockedAllocationResolutionNote,
  executeShopifyRefundForAdminOrder,
  getAdminShopifyOrderBreakdown,
  getVendorOrderByIdForUser,
  listVendorOrders,
  OrderRejectValidationError,
  planAllocationSplitForVendorOrder,
  previewShopifyRefundForAdminOrder,
  rejectVendorOrderAllocation,
  requestCancelRefundReviewForAdminOrder,
  returnBlockedAllocationToVendor,
  splitAllocationForVendorOrder,
  transferAllocationEconomicsForAdminOrder,
} from './orders.service.js';
import { EconomicTransferValidationError } from '../finance/economic-transfer.service.js';
import { AllocationSplitValidationError } from './allocation-split.service.js';
import { createShopifyAdminService } from '../shopify/shopify-admin.service.js';
import type { FetchCanonicalShopifyRefundsForOrderResult } from '../shopify/shopify-admin.types.js';
import {
  ProductPanelVariantDisableDryRunSendError,
  sendProductPanelVariantDisableDryRunEventsForOrder,
} from '../product-panel/product-panel-variant-disable-outbox.service.js';
import { resolvePagination } from '../../lib/pagination.js';
import { withSlowEndpointTiming } from '../../lib/performance.js';
import { withDashboardRouteTiming } from '../../lib/dashboard-timing.js';

function readRequiredRouteParam(value: string | undefined, message: string) {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) {
    throw new OrderRejectValidationError(message, 400);
  }
  return trimmed;
}

function readRequiredBodyText(value: string | null | undefined, message: string) {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) {
    throw new OrderRejectValidationError(message, 400);
  }
  return trimmed;
}

function readEconomicTransferReason(value: string | null | undefined) {
  const reason = readRequiredBodyText(value, 'Economic transfer reason is required.');
  if (reason.length > 500) {
    throw new OrderRejectValidationError('Economic transfer reason must be 500 characters or fewer.', 400);
  }
  return reason;
}

function readCancelRefundReviewNote(value: string | null | undefined) {
  const note = readRequiredBodyText(value, 'Cancel/refund review note is required.');
  if (note.length > 1000) {
    throw new OrderRejectValidationError('Cancel/refund review note must be 1000 characters or fewer.', 400);
  }
  return note;
}

function readStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => String(item ?? '').trim()).filter(Boolean)
    : [];
}

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
        }),
      );
      if (!order) {
        return reply.code(404).send({ message: 'Order not found.' });
      }

      return order;
    },
  );

  app.post<{
    Params: { orderId: string };
    Body: { reason?: string | null; note?: string | null };
  }>(
    '/orders/:orderId/reject',
    {
      preHandler: [authMiddleware.authenticateRequest, requireVendorAccess, requireUnrestrictedVendorMutation],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'vendor') {
        return reply.code(403).send({ message: 'Forbidden' });
      }

      const vendorId = request.vendorContext?.vendorId;
      if (!vendorId) {
        return reply.code(400).send({ message: 'Vendor context could not be resolved.' });
      }

      try {
        return await withSlowEndpointTiming('POST /orders/:orderId/reject', () =>
          rejectVendorOrderAllocation(vendorId, request.params.orderId, {
            reason: request.body?.reason,
            note: request.body?.note,
            actorUserId: request.authUser?.id ?? null,
          }, {
            productPanelEnv: env,
          }),
        );
      } catch (error) {
        if (error instanceof OrderRejectValidationError) {
          return reply.code(error.statusCode).send({ message: error.message });
        }
        throw error;
      }
    },
  );

  app.post<{
    Params: { allocationId: string };
    Body: { selectedVendorAllocationLineItemIds?: unknown; reason?: string | null; note?: string | null };
  }>(
    '/orders/:allocationId/split-plan',
    {
      preHandler: [authMiddleware.authenticateRequest, requireVendorAccess, requireUnrestrictedVendorMutation],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'vendor') {
        return reply.code(403).send({ message: 'Forbidden' });
      }

      const vendorId = request.vendorContext?.vendorId;
      if (!vendorId) {
        return reply.code(400).send({ message: 'Vendor context could not be resolved.' });
      }

      try {
        const allocationId = readRequiredRouteParam(request.params.allocationId, 'Allocation id is required.');
        return await withSlowEndpointTiming('POST /orders/:allocationId/split-plan', () =>
          planAllocationSplitForVendorOrder(vendorId, allocationId, {
            selectedVendorAllocationLineItemIds: readStringArray(request.body?.selectedVendorAllocationLineItemIds),
            reason: request.body?.reason,
            note: request.body?.note,
          }),
        );
      } catch (error) {
        if (error instanceof OrderRejectValidationError) {
          return reply.code(error.statusCode).send({ message: error.message });
        }
        throw error;
      }
    },
  );

  app.post<{
    Params: { allocationId: string };
    Body: {
      selectedVendorAllocationLineItemIds?: unknown;
      reason?: string | null;
      note?: string | null;
      confirmSplit?: boolean | null;
    };
  }>(
    '/orders/:allocationId/split',
    {
      preHandler: [authMiddleware.authenticateRequest, requireVendorAccess, requireUnrestrictedVendorMutation],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'vendor') {
        return reply.code(403).send({ message: 'Forbidden' });
      }

      const vendorId = request.vendorContext?.vendorId;
      if (!vendorId) {
        return reply.code(400).send({ message: 'Vendor context could not be resolved.' });
      }

      try {
        const allocationId = readRequiredRouteParam(request.params.allocationId, 'Allocation id is required.');
        if (request.body?.confirmSplit !== true) {
          throw new OrderRejectValidationError('Allocation split confirmation is required.', 400);
        }
        const reason = readRequiredBodyText(request.body?.reason, 'Allocation split reason is required.');

        return await withSlowEndpointTiming('POST /orders/:allocationId/split', () =>
          splitAllocationForVendorOrder(vendorId, allocationId, {
            selectedVendorAllocationLineItemIds: readStringArray(request.body?.selectedVendorAllocationLineItemIds),
            reason,
            note: request.body?.note,
            actorUserId: request.authUser?.id ?? null,
          }),
        );
      } catch (error) {
        if (error instanceof OrderRejectValidationError || error instanceof AllocationSplitValidationError) {
          return reply.code(error.statusCode).send({ message: error.message });
        }
        throw error;
      }
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

      let canonicalRefunds: FetchCanonicalShopifyRefundsForOrderResult = null;
      let canonicalRefundReadFailed = false;
      try {
        canonicalRefunds = await shopifyAdminService.fetchCanonicalRefundsForOrder(request.params.shopifyOrderId);
      } catch {
        canonicalRefundReadFailed = true;
      }
      const breakdown = await withSlowEndpointTiming('GET /admin/orders/:shopifyOrderId', () =>
        getAdminShopifyOrderBreakdown(request.params.shopifyOrderId, {
          canonicalRefunds,
          canonicalRefundReadFailed,
        }),
      );
      if (!breakdown) {
        return reply.code(404).send({ message: 'Shopify order not found.' });
      }

      return breakdown;
    },
  );

  app.post<{
    Params: { shopifyOrderId: string };
  }>(
    '/admin/orders/:shopifyOrderId/product-panel-variant-disable/send-dry-run',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Forbidden' });
      }

      try {
        const shopifyOrderId = readRequiredRouteParam(request.params.shopifyOrderId, 'Shopify order id is required.');
        return await withSlowEndpointTiming('POST /admin/orders/:shopifyOrderId/product-panel-variant-disable/send-dry-run', () =>
          sendProductPanelVariantDisableDryRunEventsForOrder(env, {
            shopifyOrderId,
          }),
        );
      } catch (error) {
        if (error instanceof ProductPanelVariantDisableDryRunSendError) {
          return reply.code(error.statusCode).send({ message: error.message });
        }
        throw error;
      }
    },
  );

  app.post<{
    Params: { shopifyOrderId: string; allocationId: string };
    Body: { confirmReturnToVendor?: boolean | null; note?: string | null };
  }>(
    '/admin/orders/:shopifyOrderId/allocations/:allocationId/return-to-vendor',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Forbidden' });
      }

      if (request.body?.confirmReturnToVendor !== true) {
        return reply.code(400).send({ message: 'Return-to-vendor confirmation is required.' });
      }

      try {
        return await withSlowEndpointTiming('POST /admin/orders/:shopifyOrderId/allocations/:allocationId/return-to-vendor', () =>
          returnBlockedAllocationToVendor(request.params.shopifyOrderId, request.params.allocationId, {
            note: request.body?.note,
            actorUserId: request.authUser?.id ?? null,
          }),
        );
      } catch (error) {
        if (error instanceof OrderRejectValidationError) {
          return reply.code(error.statusCode).send({ message: error.message });
        }
        throw error;
      }
    },
  );

  app.post<{
    Params: { shopifyOrderId: string; allocationId: string };
    Body: { note?: string | null };
  }>(
    '/admin/orders/:shopifyOrderId/allocations/:allocationId/resolution-note',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Forbidden' });
      }

      try {
        return await withSlowEndpointTiming('POST /admin/orders/:shopifyOrderId/allocations/:allocationId/resolution-note', () =>
          addBlockedAllocationResolutionNote(request.params.shopifyOrderId, request.params.allocationId, {
            note: request.body?.note,
            actorUserId: request.authUser?.id ?? null,
          }),
        );
      } catch (error) {
        if (error instanceof OrderRejectValidationError) {
          return reply.code(error.statusCode).send({ message: error.message });
        }
        throw error;
      }
    },
  );

  app.post<{
    Params: { shopifyOrderId: string; allocationId: string };
    Body: { reason?: string | null; note?: string | null; confirmReview?: boolean | null };
  }>(
    '/admin/orders/:shopifyOrderId/allocations/:allocationId/cancel-refund-review',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Forbidden' });
      }

      try {
        const shopifyOrderId = readRequiredRouteParam(request.params.shopifyOrderId, 'Shopify order id is required.');
        const allocationId = readRequiredRouteParam(request.params.allocationId, 'Allocation id is required.');
        if (request.body?.confirmReview !== true) {
          throw new OrderRejectValidationError('Cancel/refund review confirmation is required.', 400);
        }
        const reason = readRequiredBodyText(request.body?.reason, 'Cancel/refund review reason is required.');
        const note = readCancelRefundReviewNote(request.body?.note);

        return await withSlowEndpointTiming('POST /admin/orders/:shopifyOrderId/allocations/:allocationId/cancel-refund-review', () =>
          requestCancelRefundReviewForAdminOrder(shopifyOrderId, allocationId, {
            reason,
            note,
            actorUserId: request.authUser?.id ?? null,
          }),
        );
      } catch (error) {
        if (error instanceof OrderRejectValidationError) {
          return reply.code(error.statusCode).send({ message: error.message });
        }
        throw error;
      }
    },
  );

  app.post<{
    Params: { shopifyOrderId: string; allocationId: string };
    Body: { restockType?: string | null; refundShipping?: boolean | null };
  }>(
    '/admin/orders/:shopifyOrderId/allocations/:allocationId/shopify-refund-preview',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Forbidden' });
      }

      try {
        const shopifyOrderId = readRequiredRouteParam(request.params.shopifyOrderId, 'Shopify order id is required.');
        const allocationId = readRequiredRouteParam(request.params.allocationId, 'Allocation id is required.');
        if (request.body?.refundShipping !== false) {
          throw new OrderRejectValidationError('Refund shipping preview is not supported for allocation-scoped cancel/refund review.', 400);
        }

        return await withSlowEndpointTiming('POST /admin/orders/:shopifyOrderId/allocations/:allocationId/shopify-refund-preview', () =>
          previewShopifyRefundForAdminOrder(shopifyOrderId, allocationId, {
            restockType: request.body?.restockType,
            refundShipping: false,
            actorUserId: request.authUser?.id ?? null,
            shopifyAdminService,
          }),
        );
      } catch (error) {
        if (error instanceof OrderRejectValidationError) {
          return reply.code(error.statusCode).send({ message: error.message });
        }
        throw error;
      }
    },
  );

  app.post<{
    Params: { shopifyOrderId: string; allocationId: string };
      Body: {
        restockType?: string | null;
        refundShipping?: boolean | null;
        notifyCustomer?: boolean | null;
        note?: string | null;
        confirmRefund?: boolean | null;
        confirmPostRefundFulfillmentCheck?: boolean | null;
        confirmMixedFulfillmentOrderDirectRefundProbe?: boolean | null;
      };
    }>(
    '/admin/orders/:shopifyOrderId/allocations/:allocationId/shopify-refund',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Forbidden' });
      }

      try {
        const shopifyOrderId = readRequiredRouteParam(request.params.shopifyOrderId, 'Shopify order id is required.');
        const allocationId = readRequiredRouteParam(request.params.allocationId, 'Allocation id is required.');

        return await withSlowEndpointTiming('POST /admin/orders/:shopifyOrderId/allocations/:allocationId/shopify-refund', () =>
          executeShopifyRefundForAdminOrder(shopifyOrderId, allocationId, {
            restockType: request.body?.restockType,
            refundShipping: request.body?.refundShipping,
            notifyCustomer: request.body?.notifyCustomer,
            note: request.body?.note,
            confirmRefund: request.body?.confirmRefund,
            confirmPostRefundFulfillmentCheck: request.body?.confirmPostRefundFulfillmentCheck,
            confirmMixedFulfillmentOrderDirectRefundProbe: request.body?.confirmMixedFulfillmentOrderDirectRefundProbe,
            actorUserId: request.authUser?.id ?? null,
            shopifyAdminService,
          }),
        );
      } catch (error) {
        if (error instanceof OrderRejectValidationError) {
          return reply.code(error.statusCode).send({ message: error.message });
        }
        throw error;
      }
    },
  );

  app.post<{
    Params: { shopifyOrderId: string; allocationId: string };
    Body: { toVendorId?: string | null; reason?: string | null; confirmTransfer?: boolean | null };
  }>(
    '/admin/orders/:shopifyOrderId/allocations/:allocationId/economic-transfer',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Forbidden' });
      }

      try {
        const shopifyOrderId = readRequiredRouteParam(request.params.shopifyOrderId, 'Shopify order id is required.');
        const allocationId = readRequiredRouteParam(request.params.allocationId, 'Allocation id is required.');
        if (request.body?.confirmTransfer !== true) {
          throw new OrderRejectValidationError('Economic transfer confirmation is required.', 400);
        }
        const toVendorId = readRequiredBodyText(request.body?.toVendorId, 'Replacement vendor id is required.');
        const reason = readEconomicTransferReason(request.body?.reason);

        return await withSlowEndpointTiming('POST /admin/orders/:shopifyOrderId/allocations/:allocationId/economic-transfer', () =>
          transferAllocationEconomicsForAdminOrder(shopifyOrderId, allocationId, {
            toVendorId,
            reason,
            actorUserId: request.authUser?.id ?? null,
          }),
        );
      } catch (error) {
        if (error instanceof OrderRejectValidationError || error instanceof EconomicTransferValidationError) {
          return reply.code(error.statusCode).send({ message: error.message });
        }
        throw error;
      }
    },
  );
}
