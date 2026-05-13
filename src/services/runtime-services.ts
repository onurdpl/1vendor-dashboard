import { runtimeConfig } from '../config/runtime';
import { createMockSession, createCurrentUserFromVendorAccess, type CurrentUser, getDemoUserByCredentials } from '../lib/auth';
import { getCurrentVendorContext } from '../lib/auth/vendorContext';
import { ApiError } from '../lib/api/errors';
import { getMockFinanceDashboard } from '../lib/api/mockFinance';
import { getMockAutomationDashboard } from '../lib/api/mockAutomation';
import { getMockOrder, getShopifyOrderBreakdown, listMockOrders } from '../lib/api/mockOrders';
import { getMockReturn, listMockReturns } from '../lib/api/mockReturns';
import { listAdminOperationsQueue as listMockAdminOperationsQueue } from '../lib/api/operations';
import * as backendAuth from './backend-auth';
import * as realOrders from './real/orders';
import * as realReturns from './real/returns';
import * as realFinance from './real/finance';
import * as realAutomation from './real/automation';
import * as realOperations from './real/operations';
import * as realDiagnostics from './real/diagnostics';
import * as realObservability from './real/observability';
import type { SubmitFulfillmentTrackingPayload } from './real/orders';

function getCurrentVendorId() {
  return getCurrentVendorContext().vendorId;
}

export const runtimeServices = {
  auth: {
    async login(email: string, password: string): Promise<{ token: string; user: CurrentUser }> {
      if (runtimeConfig.apiMode === 'real') {
        const response = await backendAuth.login(email, password);
        return {
          token: response.token,
          user: createCurrentUserFromVendorAccess({
            email: response.user.email,
            name: response.user.name,
            role: response.user.role,
            status: response.user.status,
            vendorAccess: response.user.vendorAccess,
          }),
        };
      }

      const demoUser = getDemoUserByCredentials(email, password);
      if (!demoUser) {
        throw new Error('Invalid credentials. Use one of the demo accounts listed below.');
      }

      return {
        token: createMockSession(),
        user: {
          email: demoUser.email,
          name: demoUser.name,
          role: demoUser.role,
          vendorAccess: demoUser.vendorAccess,
          vendorDetails: demoUser.vendorDetails,
          canSwitchVendors: demoUser.canSwitchVendors,
          defaultVendorId: demoUser.defaultVendorId,
        },
      };
    },
    async me(token: string) {
      if (runtimeConfig.apiMode === 'real') {
        const user = await backendAuth.me(token);
        return createCurrentUserFromVendorAccess({
          email: user.email,
          name: user.name,
          role: user.role,
          status: user.status,
          vendorAccess: user.vendorAccess,
        });
      }

      return null;
    },
  },
  orders: {
    list: () => (runtimeConfig.apiMode === 'real' ? realOrders.listOrders() : Promise.resolve(listMockOrders(getCurrentVendorId()))),
    async detail(orderId: string) {
      if (runtimeConfig.apiMode === 'real') {
        return realOrders.getOrder(orderId);
      }

      const order = getMockOrder(orderId, getCurrentVendorId());
      if (!order) {
        throw new ApiError('Order not found.', 'server', { status: 404 });
      }
      return order;
    },
    async adminBreakdown(shopifyOrderId: string) {
      if (runtimeConfig.apiMode === 'real') {
        return realOrders.getAdminShopifyOrderBreakdown(shopifyOrderId);
      }

      const breakdown = getShopifyOrderBreakdown(shopifyOrderId);
      if (!breakdown) {
        throw new ApiError('Shopify order not found.', 'server', { status: 404 });
      }
      return breakdown;
    },
    async submitFulfillmentTracking(allocationId: string, payload: SubmitFulfillmentTrackingPayload) {
      if (runtimeConfig.apiMode === 'real') {
        return realOrders.submitFulfillmentTracking(allocationId, payload);
      }

      await new Promise((resolve) => {
        globalThis.setTimeout(resolve, 300);
      });

      const submittedAt = new Date().toISOString();

      return {
        ok: true as const,
        allocationId,
        trackingNumber: payload.trackingNumber,
        carrier: payload.carrier,
        trackingUrl: payload.trackingUrl ?? null,
        notifyCustomer: payload.notifyCustomer ?? false,
        fulfillmentStatus: 'fulfillment_submitted',
        shippingStatus: 'shipped',
        shopifySyncSource: 'mock',
        shopifyFulfillmentId: `mock-fulfillment-${allocationId}`,
        fulfilledAt: submittedAt,
        shipmentCreatedAt: submittedAt,
        shipmentUpdatedAt: submittedAt,
      };
    },
  },
  returns: {
    list: () => (runtimeConfig.apiMode === 'real' ? realReturns.listReturns() : Promise.resolve(listMockReturns(getCurrentVendorId()))),
    async detail(returnId: string) {
      if (runtimeConfig.apiMode === 'real') {
        return realReturns.getReturn(returnId);
      }

      const returnRecord = getMockReturn(returnId, getCurrentVendorId());
      if (!returnRecord) {
        throw new ApiError('Return not found.', 'server', { status: 404 });
      }
      return returnRecord;
    },
  },
  finance: {
    dashboard: () =>
      runtimeConfig.apiMode === 'real'
        ? realFinance.getFinanceDashboard()
        : Promise.resolve(getMockFinanceDashboard(getCurrentVendorId())),
    updateProfile: (
      vendorId: string,
      input: Parameters<typeof realFinance.updateVendorFinancialProfile>[1],
    ) =>
      runtimeConfig.apiMode === 'real'
        ? realFinance.updateVendorFinancialProfile(vendorId, input)
        : Promise.resolve({
            vendorId,
            commissionPercent: input.commissionPercent.toFixed(2),
            commissionVatPercent: input.commissionVatPercent.toFixed(2),
            deductShippingEnabled: input.deductShippingEnabled,
            shippingMode: input.shippingMode,
            fixedShippingFee: input.fixedShippingFee === null ? null : input.fixedShippingFee.toFixed(2),
            active: true,
            source: 'configured' as const,
          }),
    preparePayoutBatch: (vendorId: string) =>
      runtimeConfig.apiMode === 'real'
        ? realFinance.preparePayoutBatch(vendorId)
        : Promise.resolve({
            id: `mock-payout-batch-${vendorId}`,
            vendorId,
            status: 'draft' as const,
            grossAmount: '$0.00',
            commissionAmount: '$0.00',
            commissionVatAmount: '$0.00',
            shippingDeductionAmount: '$0.00',
            refundAmount: '$0.00',
            netAmount: '$0.00',
            currency: 'TRY',
            createdByUserId: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            lineCount: 0,
            warning: null,
          }),
  },
  automation: {
    dashboard: () =>
      runtimeConfig.apiMode === 'real'
        ? realAutomation.getAutomationDashboard()
        : Promise.resolve(getMockAutomationDashboard(getCurrentVendorId())),
  },
  operations: {
    list: () =>
      runtimeConfig.apiMode === 'real'
        ? realOperations.listAdminOperationsQueue()
        : Promise.resolve(listMockAdminOperationsQueue()),
  },
  diagnostics: {
    webhooks: () =>
      runtimeConfig.apiMode === 'real'
        ? realDiagnostics.listWebhookDiagnostics()
        : Promise.resolve({
            summary: {
              total: 0,
              received: 0,
              processed: 0,
              failed: 0,
              duplicates: 0,
              needsAttention: 0,
            },
            events: [],
          }),
    webhookDetail: (webhookEventId: string) =>
      runtimeConfig.apiMode === 'real'
        ? realDiagnostics.getWebhookDiagnostic(webhookEventId)
        : Promise.resolve({
            id: webhookEventId,
            topic: 'mock',
            shopDomain: 'mock.local',
            shopifyWebhookId: null,
            eventId: null,
            idempotencyKey: null,
            payloadHash: null,
            payloadPreview: null,
            payloadPreviewTruncated: false,
            payloadAvailable: false,
            status: 'MOCK',
            processingStatus: 'MOCK',
            errorMessage: null,
            lastErrorSummary: null,
            replayEligible: false,
            replayBlockedReason: 'Diagnostics replay is available in real mode only.',
            recoverEligible: false,
            recoverBlockedReason: 'Diagnostics recovery is available in real mode only.',
            recommendedAction: 'Switch to real API mode to inspect webhook recovery state.',
            affectedEntities: {
              shopifyOrderId: null,
              shopifyOrderNumber: null,
              shopifyReturnId: null,
              shopifyRefundId: null,
              shopifyFulfillmentId: null,
              vendorId: null,
            },
            relatedJobs: [],
            receivedAt: new Date().toISOString(),
            processedAt: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            relatedShopifyOrderId: null,
          }),
    syncEvents: () =>
      runtimeConfig.apiMode === 'real'
        ? realDiagnostics.listSyncEvents()
        : Promise.resolve({
            items: [],
          }),
    reconciliation: () =>
      runtimeConfig.apiMode === 'real'
        ? realDiagnostics.getReconciliationDiagnostics()
        : Promise.resolve({
            summary: {
              stuckReceived: 0,
              failedWebhooks: 0,
              fulfillmentSyncFailures: 0,
              missingPayload: 0,
              staleAllocations: 0,
              scheduledReconciliationJobs: 0,
              total: 0,
            },
            items: [],
          }),
    replay: (webhookEventId: string) =>
      runtimeConfig.apiMode === 'real'
        ? realDiagnostics.replayWebhook(webhookEventId)
        : Promise.resolve({
            ok: true as const,
            topic: 'mock',
            action: 'mock_only',
            processingStatus: 'mock_only',
            message: `Replay is not available in mock mode for ${webhookEventId}.`,
          }),
    recover: (webhookEventId: string) =>
      runtimeConfig.apiMode === 'real'
        ? realDiagnostics.recoverWebhook(webhookEventId)
        : Promise.resolve({
            ok: true as const,
            topic: 'mock',
            action: 'mock_only',
            processingStatus: 'mock_only',
            recoveryStatus: 'not_recoverable' as const,
            message: `Recover is not available in mock mode for ${webhookEventId}.`,
          }),
    retryOperationalJob: (operationalJobId: string) =>
      runtimeConfig.apiMode === 'real'
        ? realDiagnostics.retryOperationalJob(operationalJobId)
        : Promise.resolve({
            ok: true as const,
            operationalJobId,
            jobStatus: 'mock_only',
            retryStatus: 'not_retryable' as const,
            processingStatus: 'mock_only',
            message: `Operational job retry is not available in mock mode for ${operationalJobId}.`,
          }),
    reconcileAllocation: (allocationId: string) =>
      runtimeConfig.apiMode === 'real'
        ? realDiagnostics.reconcileAllocation(allocationId)
        : Promise.resolve({
            reconciliationStatus: 'in_sync' as const,
            staleFields: [],
            repairedFields: [],
            skippedFields: [],
            canonicalShopifySummary: {
              source: 'mock' as const,
              shopifyOrderId: allocationId,
              orderName: null,
              displayFulfillmentStatus: null,
              fulfillmentCount: 0,
              fulfillmentOrderCount: 0,
              fulfilledLineItemIds: [],
              cancelledLineItemIds: [],
            },
            localStateSummary: {
              shopifyOrderId: allocationId,
              shopifyOrderNumber: allocationId,
              allocationCount: 0,
              refundRecordCount: 0,
              returnRecordCount: 0,
            },
            affectedAllocations: [],
            affectedVendorIds: [],
            warnings: [],
            requiresManualReview: false,
          }),
    reconcileShopifyOrder: (shopifyOrderId: string) =>
      runtimeConfig.apiMode === 'real'
        ? realDiagnostics.reconcileShopifyOrder(shopifyOrderId)
        : Promise.resolve({
            reconciliationStatus: 'in_sync' as const,
            staleFields: [],
            repairedFields: [],
            skippedFields: [],
            canonicalShopifySummary: {
              source: 'mock' as const,
              shopifyOrderId,
              orderName: null,
              displayFulfillmentStatus: null,
              fulfillmentCount: 0,
              fulfillmentOrderCount: 0,
              fulfilledLineItemIds: [],
              cancelledLineItemIds: [],
            },
            localStateSummary: {
              shopifyOrderId,
              shopifyOrderNumber: shopifyOrderId,
              allocationCount: 0,
              refundRecordCount: 0,
              returnRecordCount: 0,
            },
            affectedAllocations: [],
            affectedVendorIds: [],
            warnings: [],
            requiresManualReview: false,
          }),
  },
  observability: {
    summary: () =>
      runtimeConfig.apiMode === 'real'
        ? realObservability.getObservabilitySummary()
        : Promise.resolve({
            health: 'healthy' as const,
            generatedAt: new Date().toISOString(),
            windows: [
              {
                window: 'last24h' as const,
                since: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
                webhookThroughput: 0,
                processedWebhooks: 0,
                failedWebhooks: 0,
                successRate: 1,
                failureRate: 0,
                retryCount: 0,
                deadLetterReady: 0,
                permanentlyFailed: 0,
                reconciliationJobs: 0,
                replayJobs: 0,
                recoveryJobs: 0,
                staleStateCount: 0,
              },
            ],
            retryPressure: {
              retryScheduled: 0,
              retrying: 0,
              deadLetterReady: 0,
              permanentlyFailed: 0,
              pressureScore: 0,
            },
            reconciliation: {
              pending: 0,
              processing: 0,
              completed24h: 0,
              failed24h: 0,
              scheduled: 0,
              staleStateCount: 0,
            },
            webhookHealth: {
              received: 0,
              processing: 0,
              processed24h: 0,
              failed24h: 0,
              successRate24h: 1,
            },
            staleStates: {
              stuckReceived: 0,
              fulfillmentSyncFailures: 0,
              missingPayload: 0,
              staleAllocations: 0,
              scheduledReconciliationJobs: 0,
              total: 0,
            },
            notes: ['No active retry, dead-letter, or stale-state pressure detected.'],
          }),
    metrics: () =>
      runtimeConfig.apiMode === 'real'
        ? realObservability.getObservabilityMetrics()
        : Promise.resolve({
            generatedAt: new Date().toISOString(),
            windows: [],
          }),
  },
} as const;
