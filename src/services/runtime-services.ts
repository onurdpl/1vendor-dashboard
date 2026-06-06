import { runtimeConfig } from '../config/runtime';
import { createMockSession, createCurrentUserFromVendorAccess, type CurrentUser, getCurrentUser, getDemoUserByCredentials } from '../lib/auth';
import { getCurrentVendorContext } from '../lib/auth/vendorContext';
import { ApiError } from '../lib/api/errors';
import { getMockFinanceDashboard } from '../lib/api/mockFinance';
import { getMockAutomationDashboard } from '../lib/api/mockAutomation';
import { getMockOrder, getShopifyOrderBreakdown, listMockOrders } from '../lib/api/mockOrders';
import { getMockReturn, listMockReturns } from '../lib/api/mockReturns';
import {
  getMockAdminOperationsAttention,
  listAdminOperationsQueue as listMockAdminOperationsQueue,
} from '../lib/api/operations';
import * as backendAuth from './backend-auth';
import * as realOrders from './real/orders';
import * as realReturns from './real/returns';
import * as realDashboard from './real/dashboard';
import * as realFinance from './real/finance';
import * as realAutomation from './real/automation';
import * as realOperations from './real/operations';
import * as realDiagnostics from './real/diagnostics';
import * as realObservability from './real/observability';
import * as realSignals from './real/signals';
import * as realNotifications from './real/notifications';
import * as realSupport from './real/support';
import * as realRuntime from './real/runtime';
import * as realVendorIntegration from './real/vendorIntegration';
import * as realVendors from './real/vendors';
import type {
  CreateSupportTicketInput,
  DashboardOperationalSummary,
  OperationsQueueDashboard,
  OperationsQueueItem,
  SupportAnalytics,
  SupportTicket,
  SupportTicketCategory,
  SupportTicketContextSummary,
  SupportTicketStatus,
  ShipmentCustomerOverrides,
  ShippingProvider,
  VendorBillingProfileInput,
  VendorShippingConfigUpdate,
  VendorIntegrationProviderManagement,
  VendorIntegrationProviderRevokeResult,
} from '../lib/api/contracts';
import type { SubmitFulfillmentTrackingPayload, UpdateNavlungoShipmentPayload } from './real/orders';

function getCurrentVendorId() {
  return getCurrentVendorContext().vendorId;
}

type ReadRequestOptions = { signal?: AbortSignal; headers?: HeadersInit; limit?: number; offset?: number };

const mockSupportTickets: SupportTicket[] = [];

function buildOperationsQueueSummary(items: OperationsQueueItem[]): OperationsQueueDashboard['summary'] {
  return {
    total: items.length,
    critical: items.filter((item) => item.severity === 'critical').length,
    warning: items.filter((item) => item.severity === 'high').length,
    attention: items.filter((item) => item.severity === 'medium').length,
    normal: items.filter((item) => item.severity === 'low').length,
    pendingReassignment: items.filter((item) => item.type === 'pending_reassignment').length,
    vendorBlocked: items.filter((item) => item.type === 'vendor_blocked').length,
    awaitingShipment: items.filter((item) => item.type === 'awaiting_shipment').length,
    refundAttention: items.filter((item) => item.type === 'refund_attention').length,
    operationalSignals: items.filter((item) => item.type === 'operational_signal').length,
    automationActions: items.filter((item) => item.type === 'automation_action').length,
  };
}

function buildMockDashboardOperationalSummary(vendorId: string): DashboardOperationalSummary {
  const orders = listMockOrders(vendorId);
  const returns = listMockReturns(vendorId);
  const pendingReassignment = orders.filter((order) => order.allocationStatus === 'pending_reassignment').length;
  const vendorBlocked = orders.filter((order) => order.allocationStatus === 'vendor_blocked').length;

  return {
    vendorId,
    orders: {
      total: orders.length,
      awaitingShipment: orders.filter((order) => order.shippingStatus === 'Awaiting Shipment').length,
      blocked: pendingReassignment + vendorBlocked,
      pendingReassignment,
      vendorBlocked,
    },
    returns: {
      refundAttention: returns.filter((item) => item.status === 'Pending' || item.status === 'In Review').length,
    },
  };
}

function getMockVendorIntegrationProviderManagement(): VendorIntegrationProviderManagement {
  const now = new Date().toISOString();
  return {
    generatedAt: now,
    providers: [
      {
        clientId: 'mock-provider-sporjinal',
        providerName: 'Mock Provider',
        vendorIdentifier: 'sporjinal',
        scopes: ['orders:read', 'status:write', 'shipment:write', 'invoice:write'],
        enabled: true,
        revokedAt: null,
        createdAt: now,
        updatedAt: now,
        lastUsedAt: now,
        lastRequestAt: now,
        requestsLast24h: 12,
        rateLimitedLast24h: 0,
        authFailuresLast24h: null,
        recentAuditLogs: [
          {
            method: 'GET',
            path: '/api/vendor-integration/orders',
            statusCode: 200,
            requestId: 'mock-req-1',
            createdAt: now,
          },
        ],
      },
    ],
  };
}

function getMockVendorIntegrationProviderRevokeResult(clientId: string): VendorIntegrationProviderRevokeResult {
  return {
    clientId,
    vendorIdentifier: 'sporjinal',
    providerName: 'Mock Provider',
    enabled: false,
    revokedAt: new Date().toISOString(),
  };
}

function calculateMockSupportDueAt(priority: SupportTicket['priority'], baseDate = new Date()) {
  const hours = priority === 'high' ? 4 : priority === 'low' ? 48 : 24;
  return new Date(baseDate.getTime() + hours * 60 * 60 * 1000).toISOString();
}

function buildMockSupportContextSummary(snapshot: unknown): SupportTicketContextSummary | null {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    return null;
  }
  const source = snapshot as Record<string, unknown>;
  const summary: SupportTicketContextSummary = {};
  for (const key of ['route', 'path', 'orderNumber', 'returnNumber', 'status'] as const) {
    const value = source[key];
    if (typeof value === 'string' || typeof value === 'number') {
      summary[key] = String(value);
    }
  }
  const flags = ['trackingPresent', 'returnTrackingPresent', 'returnCarrierPresent', 'shipmentTrackingPresent', 'pdfAvailable', 'labelAvailable']
    .reduce<Record<string, boolean>>((accumulator, key) => {
      if (typeof source[key] === 'boolean') {
        accumulator[key] = source[key];
      }
      return accumulator;
    }, {});
  if (Object.keys(flags).length) {
    summary.flags = flags;
  }
  return Object.keys(summary).length ? summary : null;
}

function toMockVendorSupportTicket(ticket: SupportTicket): SupportTicket {
  const safeTicket: SupportTicket = {
    ...ticket,
    contextSnapshot: undefined,
    notes: undefined,
  };
  return {
    ...safeTicket,
    contextSummary: ticket.contextSummary ?? buildMockSupportContextSummary(ticket.contextSnapshot),
    firstResponseDueAt: null,
    nextResponseDueAt: null,
    escalatedAt: null,
    escalationReason: null,
    sla: null,
    notes: undefined,
  };
}

const supportCategories: SupportTicketCategory[] = ['ORDER', 'RETURN', 'REFUND', 'SHIPMENT', 'TRACKING', 'PAYOUT', 'INVOICE', 'OTHER'];

function buildMockSupportAnalytics(): SupportAnalytics {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const tickets = mockSupportTickets;
  const openTickets = tickets.filter((ticket) => ['OPEN', 'IN_REVIEW', 'WAITING_FOR_VENDOR'].includes(ticket.status));
  const overdueTickets = tickets.filter((ticket) => ticket.sla?.isOverdue);
  const resolvedTickets = tickets.filter((ticket) => ticket.resolvedAt || ticket.closedAt);
  const vendorMap = new Map<string, {
    vendorId: string;
    vendorName: string | null;
    ticketCount: number;
    unresolvedCount: number;
    overdueCount: number;
  }>();
  const assigneeMap = new Map<string, {
    assigneeName: string;
    ticketCount: number;
    overdueCount: number;
    unassignedOpenTickets: number;
  }>();

  for (const ticket of tickets) {
    const vendorEntry = vendorMap.get(ticket.vendorId) ?? {
      vendorId: ticket.vendorId,
      vendorName: ticket.vendorName,
      ticketCount: 0,
      unresolvedCount: 0,
      overdueCount: 0,
    };
    vendorEntry.ticketCount += 1;
    vendorEntry.unresolvedCount += ['OPEN', 'IN_REVIEW', 'WAITING_FOR_VENDOR'].includes(ticket.status) ? 1 : 0;
    vendorEntry.overdueCount += ticket.sla?.isOverdue ? 1 : 0;
    vendorMap.set(ticket.vendorId, vendorEntry);

    const assigneeName = ticket.assigneeName ?? 'Unassigned';
    const assigneeEntry = assigneeMap.get(assigneeName) ?? {
      assigneeName,
      ticketCount: 0,
      overdueCount: 0,
      unassignedOpenTickets: 0,
    };
    assigneeEntry.ticketCount += 1;
    assigneeEntry.overdueCount += ticket.sla?.isOverdue ? 1 : 0;
    assigneeEntry.unassignedOpenTickets += assigneeName === 'Unassigned' && ticket.status === 'OPEN' ? 1 : 0;
    assigneeMap.set(assigneeName, assigneeEntry);
  }

  return {
    generatedAt: now.toISOString(),
    kpis: {
      openTickets: openTickets.length,
      overdueTickets: overdueTickets.length,
      avgFirstResponseHours: null,
      avgResolutionHours: null,
      waitingOnVendor: tickets.filter((ticket) => ticket.status === 'WAITING_FOR_VENDOR').length,
      resolvedToday: resolvedTickets.filter((ticket) => (ticket.resolvedAt ?? ticket.closedAt)?.slice(0, 10) === today).length,
    },
    categoryInsights: supportCategories.map((category) => {
      const categoryTickets = tickets.filter((ticket) => ticket.category === category);
      const categoryOverdue = categoryTickets.filter((ticket) => ticket.sla?.isOverdue).length;
      return {
        category,
        ticketCount: categoryTickets.length,
        overdueCount: categoryOverdue,
        overduePercent: categoryTickets.length ? Math.round((categoryOverdue / categoryTickets.length) * 1000) / 10 : 0,
        avgResolutionHours: null,
      };
    }),
    vendorInsights: [...vendorMap.values()].map((entry) => ({
      ...entry,
      overduePercent: entry.ticketCount ? Math.round((entry.overdueCount / entry.ticketCount) * 1000) / 10 : 0,
      avgResolutionHours: null,
      needsAttention: entry.overdueCount > 0 || entry.unresolvedCount >= 3,
    })),
    slaInsights: {
      overdueTickets: overdueTickets.length,
      overduePercent: tickets.length ? Math.round((overdueTickets.length / tickets.length) * 1000) / 10 : 0,
      avgResponseDelayHours: null,
      avgResolutionHours: null,
      breachesByCategory: supportCategories
        .map((category) => ({
          category,
          overdueCount: tickets.filter((ticket) => ticket.category === category && ticket.sla?.isOverdue).length,
        }))
        .filter((entry) => entry.overdueCount > 0),
    },
    assignmentInsights: [...assigneeMap.values()].map((entry) => ({
      ...entry,
      avgFirstResponseHours: null,
    })),
    trends: Array.from({ length: 7 }, (_, index) => {
      const date = new Date(now.getTime() - (6 - index) * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      return {
        date,
        created: tickets.filter((ticket) => ticket.createdAt.slice(0, 10) === date).length,
        resolved: resolvedTickets.filter((ticket) => (ticket.resolvedAt ?? ticket.closedAt)?.slice(0, 10) === date).length,
        overdue: 0,
      };
    }),
  };
}

export const runtimeServices = {
  runtime: {
    health: (options: ReadRequestOptions = {}) =>
      runtimeConfig.apiMode === 'real'
        ? realRuntime.getBackendHealth({ signal: options.signal })
        : Promise.resolve({
            ok: true,
            status: 'ok' as const,
            service: 'vendor-dashboard-backend',
            version: 'mock',
            gitCommit: null,
            environment: 'mock',
            timestamp: new Date().toISOString(),
            dbReachable: false,
            migrationsReachable: false,
          }),
  },
  vendors: {
    billingProfile: (vendorId = getCurrentVendorId(), options: ReadRequestOptions = {}) =>
      runtimeConfig.apiMode === 'real'
        ? realVendors.getVendorBillingProfile(vendorId, { signal: options.signal })
        : Promise.resolve(null),
    updateBillingProfile: (vendorId: string, input: VendorBillingProfileInput) =>
      runtimeConfig.apiMode === 'real'
        ? realVendors.updateVendorBillingProfile(vendorId, input)
        : Promise.resolve({
            id: `mock-billing-profile-${vendorId}`,
            vendorId,
            legalCompanyName: input.legalCompanyName,
            taxNumber: input.taxNumber,
            taxOffice: input.taxOffice,
            billingAddress: input.billingAddress,
            iban: input.iban ?? null,
            authorizedPerson: input.authorizedPerson ?? null,
            billingEmail: input.billingEmail ?? null,
            billingPhone: input.billingPhone ?? null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }),
  },
  auth: {
    async login(
      email: string,
      password: string,
      options: { authAttemptId?: string; signal?: AbortSignal } = {},
    ): Promise<{ token: string | null; user: CurrentUser }> {
      if (runtimeConfig.apiMode === 'real') {
        await backendAuth.login(email, password, {
          authAttemptId: options.authAttemptId,
          signal: options.signal,
        });
        const user = await backendAuth.me({ signal: options.signal });
        return {
          token: null,
          user: createCurrentUserFromVendorAccess({
            email: user.email,
            name: user.name,
            role: user.role,
            status: user.status,
            vendorAccess: user.vendorAccess,
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
    async me(options: { signal?: AbortSignal } = {}) {
      if (runtimeConfig.apiMode === 'real') {
        const user = await backendAuth.me({ signal: options.signal });
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
    async logout() {
      if (runtimeConfig.apiMode === 'real') {
        await backendAuth.logout();
      }
    },
  },
  dashboard: {
    summary: (vendorId = getCurrentVendorId(), options: ReadRequestOptions = {}) =>
      runtimeConfig.apiMode === 'real'
        ? realDashboard.getDashboardOperationalSummary({ vendorId, signal: options.signal, headers: options.headers })
        : Promise.resolve(buildMockDashboardOperationalSummary(vendorId)),
  },
  orders: {
    list: (vendorId = getCurrentVendorId(), options: ReadRequestOptions = {}) =>
      runtimeConfig.apiMode === 'real'
        ? realOrders.listOrders({ vendorId, signal: options.signal, headers: options.headers, limit: options.limit, offset: options.offset })
        : Promise.resolve(listMockOrders(vendorId)),
    async detail(orderId: string, vendorId = getCurrentVendorId(), options: ReadRequestOptions = {}) {
      if (runtimeConfig.apiMode === 'real') {
        return realOrders.getOrder(orderId, { vendorId, signal: options.signal });
      }

      const order = getMockOrder(orderId, vendorId);
      if (!order) {
        throw new ApiError('Order not found.', 'server', { status: 404 });
      }
      return order;
    },
    async adminBreakdown(shopifyOrderId: string, options: ReadRequestOptions = {}) {
      if (runtimeConfig.apiMode === 'real') {
        return realOrders.getAdminShopifyOrderBreakdown(shopifyOrderId, { signal: options.signal });
      }

      const breakdown = getShopifyOrderBreakdown(shopifyOrderId);
      if (!breakdown) {
        throw new ApiError('Shopify order not found.', 'server', { status: 404 });
      }
      return breakdown;
    },
    async createParatikaHostedPaymentLink(shopifyOrderId: string) {
      if (runtimeConfig.apiMode === 'real') {
        return realOrders.createParatikaHostedPaymentLink(shopifyOrderId);
      }

      throw new ApiError('Paratika live probe is available in real API mode only.', 'server', { status: 400 });
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
        shopifyFulfillmentCreated: true,
        shopifyFulfillmentSkippedReason: null,
        shopifyFulfillmentOrderIdPresent: true,
        shopifyFulfillmentIdPresent: true,
        shopifyFulfillmentOrderLookupAttempted: true,
        shopifyFulfillmentOrderLookupSuccess: true,
        shopifyFulfillmentOrderCount: 1,
        shopifySelectedFulfillmentOrderIdPresent: true,
        fulfilledAt: submittedAt,
        shipmentCreatedAt: submittedAt,
        shipmentUpdatedAt: submittedAt,
      };
    },
    async createShipmentExecution(allocationId: string, vendorId = getCurrentVendorId(), customerOverrides?: ShipmentCustomerOverrides) {
      if (runtimeConfig.apiMode === 'real') {
        return realOrders.createShipmentExecution(allocationId, { vendorId, customerOverrides });
      }

      const submittedAt = new Date().toISOString();
      return {
        id: `mock-shipment-kargo-${allocationId}`,
        allocationId,
        vendorId,
        sourceShopifyOrderId: null,
        sourceShopifyOrderNumber: null,
        sourceShopifyFulfillmentId: null,
        provider: 'kargo_entegrator' as const,
        providerShipmentId: `mock-kargo-${allocationId}`,
        trackingNumber: `KE-${allocationId.slice(-6).toUpperCase()}`,
        trackingUrl: null,
        labelUrl: null,
        shipmentStatus: 'created' as const,
        desi: '3.00',
        cargoIntegrationId: '2547',
        warehouseId: '1774',
        shippingCost: null,
        shippingVat: null,
        currency: 'TRY',
        shippingCostLinked: false,
        createdAt: submittedAt,
        updatedAt: submittedAt,
      };
    },
    async retryShipmentExecution(shipmentExecutionId: string) {
      if (runtimeConfig.apiMode === 'real') {
        return realOrders.retryShipmentExecution(shipmentExecutionId);
      }

      const submittedAt = new Date().toISOString();
      return {
        id: shipmentExecutionId,
        allocationId: shipmentExecutionId.replace(/^mock-shipment-kargo-/, ''),
        vendorId: getCurrentVendorId(),
        sourceShopifyOrderId: null,
        sourceShopifyOrderNumber: null,
        sourceShopifyFulfillmentId: null,
        provider: 'kargo_entegrator' as const,
        providerShipmentId: `mock-kargo-retry-${shipmentExecutionId.slice(-6).toUpperCase()}`,
        trackingNumber: `KE-${shipmentExecutionId.slice(-6).toUpperCase()}`,
        trackingUrl: null,
        labelUrl: null,
        shipmentStatus: 'created' as const,
        desi: '3.00',
        cargoIntegrationId: '2547',
        warehouseId: '1774',
        shippingCost: null,
        shippingVat: null,
        currency: 'TRY',
        shippingCostLinked: false,
        createdAt: submittedAt,
        updatedAt: submittedAt,
      };
    },
    async retryFailedShipmentExecution(
      shipmentExecutionId: string,
      vendorId = getCurrentVendorId(),
      customerOverrides?: ShipmentCustomerOverrides,
      useFullSenderDetailsForThisRetry?: boolean,
    ) {
      if (runtimeConfig.apiMode === 'real') {
        return realOrders.retryFailedShipmentExecution(shipmentExecutionId, {
          vendorId,
          customerOverrides,
          useFullSenderDetailsForThisRetry,
        });
      }

      const submittedAt = new Date().toISOString();
      return {
        id: shipmentExecutionId,
        allocationId: shipmentExecutionId.replace(/^mock-shipment-kargo-/, ''),
        vendorId,
        sourceShopifyOrderId: null,
        sourceShopifyOrderNumber: null,
        sourceShopifyFulfillmentId: null,
        provider: 'kargo_entegrator' as const,
        providerShipmentId: `mock-kargo-recovery-${shipmentExecutionId.slice(-6).toUpperCase()}`,
        trackingNumber: null,
        trackingUrl: null,
        labelUrl: null,
        shipmentStatus: 'created' as const,
        desi: '3.00',
        cargoIntegrationId: '2547',
        warehouseId: '1774',
        shippingCost: null,
        shippingVat: null,
        currency: 'TRY',
        shippingCostLinked: false,
        createdAt: submittedAt,
        updatedAt: submittedAt,
      };
    },
    async refreshShipmentExecutionStatus(shipmentExecutionId: string, vendorId = getCurrentVendorId()) {
      if (runtimeConfig.apiMode === 'real') {
        return realOrders.refreshShipmentExecutionStatus(shipmentExecutionId, { vendorId });
      }

      const submittedAt = new Date().toISOString();
      return {
        id: shipmentExecutionId,
        allocationId: shipmentExecutionId.replace(/^mock-shipment-kargo-/, ''),
        vendorId,
        sourceShopifyOrderId: null,
        sourceShopifyOrderNumber: null,
        sourceShopifyFulfillmentId: null,
        provider: 'try_oto' as const,
        providerShipmentId: `mock-oto-${shipmentExecutionId.slice(-6).toUpperCase()}`,
        trackingNumber: `OTO-${shipmentExecutionId.slice(-6).toUpperCase()}`,
        trackingUrl: null,
        labelUrl: 'https://example.test/try-oto-label.pdf',
        shipmentStatus: 'created' as const,
        desi: '1.00',
        cargoIntegrationId: null,
        warehouseId: 'pickup-location',
        shippingCost: null,
        shippingVat: null,
        currency: 'TRY',
        shippingCostLinked: false,
        barcode: `BAR-${shipmentExecutionId.slice(-6).toUpperCase()}`,
        createdAt: submittedAt,
        updatedAt: submittedAt,
      };
    },
    async refreshShipmentProviderData(shipmentExecutionId: string, vendorId = getCurrentVendorId()) {
      if (runtimeConfig.apiMode === 'real') {
        return realOrders.refreshShipmentProviderData(shipmentExecutionId, { vendorId });
      }

      const submittedAt = new Date().toISOString();
      return {
        id: shipmentExecutionId,
        allocationId: shipmentExecutionId.replace(/^mock-shipment-kargonomi-/, ''),
        vendorId,
        sourceShopifyOrderId: null,
        sourceShopifyOrderNumber: null,
        sourceShopifyFulfillmentId: null,
        provider: 'kargonomi' as const,
        providerShipmentId: `mock-kargonomi-${shipmentExecutionId.slice(-6).toUpperCase()}`,
        trackingNumber: `KAR-${shipmentExecutionId.slice(-6).toUpperCase()}`,
        trackingUrl: null,
        labelUrl: 'data:application/pdf;base64,JVBERi0xLjQ=',
        shipmentStatus: 'created' as const,
        desi: '1.00',
        cargoIntegrationId: null,
        warehouseId: '112668',
        shippingCost: null,
        shippingVat: null,
        currency: 'TRY',
        shippingCostLinked: false,
        providerCarrierName: 'Sürat Kargo',
        barcode: 'data:application/pdf;base64,JVBERi0xLjQ=',
        createdAt: submittedAt,
        updatedAt: submittedAt,
      };
    },
    async cancelShipmentExecution(shipmentExecutionId: string, vendorId = getCurrentVendorId()) {
      if (runtimeConfig.apiMode === 'real') {
        return realOrders.cancelShipmentExecution(shipmentExecutionId, { vendorId });
      }

      const submittedAt = new Date().toISOString();
      return {
        id: shipmentExecutionId,
        allocationId: shipmentExecutionId.replace(/^mock-shipment-navlungo-/, ''),
        vendorId,
        sourceShopifyOrderId: null,
        sourceShopifyOrderNumber: null,
        sourceShopifyFulfillmentId: null,
        provider: 'navlungo' as const,
        providerShipmentId: `mock-navlungo-${shipmentExecutionId.slice(-6).toUpperCase()}`,
        trackingNumber: `NV-${shipmentExecutionId.slice(-6).toUpperCase()}`,
        trackingUrl: null,
        labelUrl: null,
        shipmentStatus: 'cancelled' as const,
        desi: '3.00',
        cargoIntegrationId: null,
        warehouseId: '55574',
        shippingCost: null,
        shippingVat: null,
        currency: 'TRY',
        shippingCostLinked: false,
        providerResponseSummary: {
          httpStatus: 200,
          ok: true,
          contentType: 'application/json',
          parsedBodyType: 'json:object',
          responseKeys: ['navlungoCancelAttempted', 'navlungoCancelSucceeded'],
          providerError: null,
          dryRun: null,
          disabledGates: [],
          providerValidationErrors: [],
          providerShipmentIdPresent: true,
          trackingNumberPresent: true,
          trackingUrlPresent: false,
          labelPresent: false,
          barcodePresent: false,
          notificationUrlIncluded: null,
          statusField: 'cancelled',
          navlungoCancelAttempted: true,
          navlungoCancelSucceeded: true,
          navlungoCancelHttpStatus: 200,
          navlungoCancelledAt: submittedAt,
          shopifyFulfillmentCancelSyncSkippedReason: 'not_implemented',
        },
        createdAt: submittedAt,
        updatedAt: submittedAt,
      };
    },
    async updateNavlungoShipmentExecution(
      shipmentExecutionId: string,
      payload: UpdateNavlungoShipmentPayload,
      vendorId = getCurrentVendorId(),
    ) {
      if (runtimeConfig.apiMode === 'real') {
        return realOrders.updateNavlungoShipmentExecution(shipmentExecutionId, payload, { vendorId });
      }

      const submittedAt = new Date().toISOString();
      return {
        id: shipmentExecutionId,
        allocationId: shipmentExecutionId.replace(/^mock-shipment-navlungo-/, ''),
        vendorId,
        sourceShopifyOrderId: null,
        sourceShopifyOrderNumber: null,
        sourceShopifyFulfillmentId: null,
        provider: 'navlungo' as const,
        providerShipmentId: `mock-navlungo-${shipmentExecutionId.slice(-6).toUpperCase()}`,
        trackingNumber: `NV-${shipmentExecutionId.slice(-6).toUpperCase()}`,
        trackingUrl: null,
        labelUrl: null,
        shipmentStatus: 'created' as const,
        desi: '3.00',
        cargoIntegrationId: null,
        warehouseId: '55574',
        shippingCost: null,
        shippingVat: null,
        currency: 'TRY',
        shippingCostLinked: false,
        providerResponseSummary: {
          httpStatus: 200,
          ok: true,
          contentType: 'application/json',
          parsedBodyType: 'json:object',
          responseKeys: ['navlungoUpdateAttempted', 'navlungoUpdateSucceeded'],
          providerError: null,
          dryRun: null,
          disabledGates: [],
          providerValidationErrors: [],
          providerShipmentIdPresent: true,
          trackingNumberPresent: true,
          trackingUrlPresent: false,
          labelPresent: false,
          barcodePresent: false,
          notificationUrlIncluded: null,
          statusField: 'created',
          navlungoUpdateAttempted: true,
          navlungoUpdateSucceeded: true,
          navlungoUpdateHttpStatus: 200,
          navlungoUpdateRecipientOverridePresent: Boolean(Object.keys(payload.recipient ?? {}).length),
          navlungoUpdateRecipientOverrideKeys: Object.keys(payload.recipient ?? {}).sort(),
          navlungoUpdateSubmittedRecipientOverrideKeys: Object.keys(payload.recipient ?? {}).sort(),
          navlungoUpdateOptionOverrideKeys: [
            payload.postNote?.trim() ? 'postNote' : null,
            payload.barcodeFormat?.trim() ? 'barcodeFormat' : null,
          ].filter((key): key is string => Boolean(key)),
          navlungoUpdateRecipientOverrides: Object.fromEntries(
            Object.entries(payload.recipient ?? {}).filter(([, value]) => typeof value === 'string' && value.trim()),
          ),
          navlungoUpdatePostNote: payload.postNote?.trim() ?? '',
          navlungoUpdateBarcodeFormat: payload.barcodeFormat?.trim() ?? '',
          navlungoUpdatedAt: submittedAt,
          shopifyFulfillmentUpdateSyncSkippedReason: 'not_implemented',
        },
        createdAt: submittedAt,
        updatedAt: submittedAt,
      };
    },
    async createReturnShipmentLabel(
      shipmentExecutionId: string,
      vendorId = getCurrentVendorId(),
      dryRun = false,
      customerOverrides?: ShipmentCustomerOverrides,
    ) {
      if (runtimeConfig.apiMode === 'real') {
        return realOrders.createReturnShipmentLabel(shipmentExecutionId, { vendorId, dryRun, customerOverrides });
      }

      const submittedAt = new Date().toISOString();
      if (dryRun) {
        return {
          id: shipmentExecutionId,
          allocationId: shipmentExecutionId.replace(/^mock-shipment-navlungo-/, ''),
          vendorId,
          sourceShopifyOrderId: null,
          sourceShopifyOrderNumber: null,
          sourceShopifyFulfillmentId: null,
          provider: 'navlungo' as const,
          providerShipmentId: `mock-navlungo-${shipmentExecutionId.slice(-6).toUpperCase()}`,
          trackingNumber: null,
          trackingUrl: null,
          labelUrl: null,
          shipmentStatus: 'delivered' as const,
          desi: '1.00',
          cargoIntegrationId: null,
          warehouseId: '55574',
          shippingCost: null,
          shippingVat: null,
          currency: 'TRY',
          shippingCostLinked: false,
          providerResponseSummary: {
            httpStatus: null,
            ok: true,
            contentType: null,
            parsedBodyType: null,
            responseKeys: [],
            providerError: null,
            dryRun: true,
            disabledGates: [],
            providerValidationErrors: [],
            providerShipmentIdPresent: true,
            trackingNumberPresent: false,
            trackingUrlPresent: false,
            labelPresent: false,
            barcodePresent: false,
            notificationUrlIncluded: null,
            statusField: null,
            navlungoReturnPickupDryRun: true,
            navlungoReturnPickupAttempted: false,
            navlungoReturnPickupSucceeded: false,
            navlungoReturnPickupMissingFields: [],
            navlungoReturnPickupPayloadSummary: {
              baseUrl: null,
              baseUrlHost: null,
              baseUrlPath: null,
              endpointPath: '/post/create',
              method: 'POST',
              headerKeys: ['Accept', 'Authorization', 'Content-Type', 'X-localization'],
              topLevelBodyKeys: ['platform', 'posts'],
              postKeys: ['reference_id', 'carrier_id', 'post_type', 'sender', 'recipient', 'post', 'barcode_format'],
              senderKeys: ['name', 'phone', 'email', 'address', 'country', 'city', 'district', 'post_code'],
              recipientKeys: ['addressId'],
              postPayloadKeys: ['desi', 'package_count', 'price', 'note'],
              barcodeFormatPresent: true,
              barcodeFormatType: 'string',
              codPaymentTypePresent: true,
              codPaymentType: 'string-empty',
              postPricePresent: true,
              postPriceType: 'string-empty',
              requestedCarrierId: 9,
              requestedPostType: 3,
              senderUsesAddressId: false,
              senderFullObjectKeysPresent: true,
              customData1Present: true,
              customData2Present: true,
              customData3Present: true,
              customData4Present: true,
              recipientDistrictPresent: false,
              recipientCityPresent: false,
              recipientCountryPresent: false,
              recipientPostCodePresent: false,
              recipientPhonePresent: false,
              recipientPhoneFormatValid: false,
              recipientEmailPresent: false,
              recipientEmailFormatValid: false,
              recipientAddressPresent: false,
              recipientAddressLength: 0,
              packageCountPresent: true,
              packageCountType: 'number',
              requestedPackageCount: 1,
              desiPresent: true,
              desiType: 'number',
              requestedDesi: 1,
              postNotePresent: true,
              postNoteType: 'string-empty',
              postNoteLength: 0,
            },
          },
          createdAt: submittedAt,
          updatedAt: submittedAt,
        };
      }
      return {
        id: shipmentExecutionId,
        allocationId: shipmentExecutionId.replace(/^mock-shipment-try_oto-/, ''),
        vendorId,
        sourceShopifyOrderId: null,
        sourceShopifyOrderNumber: null,
        sourceShopifyFulfillmentId: null,
        provider: 'try_oto' as const,
        providerShipmentId: `mock-oto-${shipmentExecutionId.slice(-6).toUpperCase()}`,
        trackingNumber: `OTO-${shipmentExecutionId.slice(-6).toUpperCase()}`,
        trackingUrl: null,
        labelUrl: 'https://example.test/try-oto-label.pdf',
        shipmentStatus: 'delivered' as const,
        desi: '1.00',
        cargoIntegrationId: null,
        warehouseId: 'pickup-location',
        shippingCost: null,
        shippingVat: null,
        currency: 'TRY',
        shippingCostLinked: false,
        barcode: `BAR-${shipmentExecutionId.slice(-6).toUpperCase()}`,
        returnShipment: {
          provider: 'try_oto' as const,
          returnOrderId: `mock-return-${shipmentExecutionId.slice(-6).toUpperCase()}`,
          trackingNumber: `RET-${shipmentExecutionId.slice(-6).toUpperCase()}`,
          trackingUrl: null,
          labelUrl: 'https://example.test/try-oto-return-label.pdf',
          barcode: `RET-BAR-${shipmentExecutionId.slice(-6).toUpperCase()}`,
          carrierName: 'Sürat Kargo',
          status: 'created',
          createdAt: submittedAt,
          requestKeys: ['items', 'orderId'],
          responseKeys: ['printAWBURL', 'returnOrderId'],
          trackingPresent: true,
          labelPresent: true,
          labelRetrievalConfirmed: true,
          labelRetrievalNote: null,
          finalized: true,
          labelRetrievable: true,
          providerStatusSource: 'createReturnShipment',
          diagnostics: {
            endpoint: '/rest/v2/createReturnShipment',
            httpStatus: 200,
            requestKeys: ['items', 'orderId'],
            responseKeys: ['printAWBURL', 'returnOrderId'],
            returnProviderIdPresent: true,
            returnTrackingPresent: true,
            returnBarcodePresent: true,
            returnStatus: 'created',
            labelFieldPresent: true,
            providerMessage: null,
            returnDeliveryOptionIdPresent: false,
            returnDeliveryOptionLookupCalled: false,
            returnDeliveryOptionLookupImplemented: false,
            returnPriceLookupCalled: false,
            returnPriceLookupSuccess: false,
            returnPriceLookupOptionCount: 0,
            selectedReturnPriceOptionIdPresent: false,
            reverseCreateShipmentCalled: false,
            reverseCreateShipmentSuccess: false,
            reverseCreateShipmentResponseKeys: [],
            reverseCreateShipmentTrackingPresent: false,
            reverseCreateShipmentBarcodePresent: false,
            reverseCreateShipmentLabelPresent: false,
            returnFinalized: true,
            returnFinalizationEndpointConfirmed: false,
            returnFinalizeEndpointImplemented: false,
            returnLabelRetrievable: true,
            providerStatusSource: 'createReturnShipment',
          },
        },
        createdAt: submittedAt,
        updatedAt: submittedAt,
      };
    },
    async probeShopifyReturnLabelUpload(shipmentExecutionId: string) {
      if (runtimeConfig.apiMode === 'real') {
        return realOrders.probeShopifyReturnLabelUpload(shipmentExecutionId);
      }

      const submittedAt = new Date().toISOString();
      return {
        id: shipmentExecutionId,
        allocationId: shipmentExecutionId.replace(/^mock-shipment-try_oto-/, ''),
        vendorId: getCurrentVendorId(),
        sourceShopifyOrderId: null,
        sourceShopifyOrderNumber: null,
        sourceShopifyFulfillmentId: null,
        provider: 'try_oto' as const,
        providerShipmentId: `mock-oto-${shipmentExecutionId.slice(-6).toUpperCase()}`,
        trackingNumber: `OTO-${shipmentExecutionId.slice(-6).toUpperCase()}`,
        trackingUrl: null,
        labelUrl: 'https://example.test/try-oto-label.pdf',
        shipmentStatus: 'delivered' as const,
        desi: '1.00',
        cargoIntegrationId: null,
        warehouseId: 'pickup-location',
        shippingCost: null,
        shippingVat: null,
        currency: 'TRY',
        shippingCostLinked: false,
        barcode: `BAR-${shipmentExecutionId.slice(-6).toUpperCase()}`,
        returnShipment: {
          provider: 'try_oto' as const,
          returnOrderId: `mock-return-${shipmentExecutionId.slice(-6).toUpperCase()}`,
          trackingNumber: `RET-${shipmentExecutionId.slice(-6).toUpperCase()}`,
          trackingUrl: null,
          labelUrl: 'https://example.test/try-oto-return-label.pdf',
          barcode: `RET-BAR-${shipmentExecutionId.slice(-6).toUpperCase()}`,
          status: 'created',
          createdAt: submittedAt,
          requestKeys: ['items', 'orderId'],
          responseKeys: ['printAWBURL', 'returnOrderId'],
          trackingPresent: true,
          labelPresent: true,
          labelRetrievalConfirmed: true,
          labelRetrievalNote: null,
          finalized: true,
          labelRetrievable: true,
          providerStatusSource: 'createReturnShipment',
          diagnostics: {
            endpoint: '/rest/v2/createReturnShipment',
            httpStatus: 200,
            requestKeys: ['items', 'orderId'],
            responseKeys: ['printAWBURL', 'returnOrderId'],
            returnProviderIdPresent: true,
            returnTrackingPresent: true,
            returnBarcodePresent: true,
            returnStatus: 'created',
            labelFieldPresent: true,
            providerMessage: null,
            returnDeliveryOptionIdPresent: false,
            returnDeliveryOptionLookupCalled: false,
            returnDeliveryOptionLookupImplemented: false,
            returnPriceLookupCalled: false,
            returnPriceLookupSuccess: false,
            returnPriceLookupOptionCount: 0,
            selectedReturnPriceOptionIdPresent: false,
            reverseCreateShipmentCalled: false,
            reverseCreateShipmentSuccess: false,
            reverseCreateShipmentResponseKeys: [],
            reverseCreateShipmentTrackingPresent: false,
            reverseCreateShipmentBarcodePresent: false,
            reverseCreateShipmentLabelPresent: false,
            returnFinalized: true,
            returnFinalizationEndpointConfirmed: false,
            returnFinalizeEndpointImplemented: false,
            returnLabelRetrievable: true,
            providerStatusSource: 'createReturnShipment',
          },
          shopifyReturnLabelUploadProbe: {
            status: 'success',
            attemptedAt: submittedAt,
            reverseFulfillmentOrderIdPresent: true,
            reverseLineItemIdsPresent: true,
            mutationUsed: 'reverseDeliveryCreateWithShipping',
            shopifyUserErrors: [],
            reverseDeliveryIdPresent: true,
            shopifyReturnIdPresent: true,
            trackingAccepted: true,
            labelAccepted: true,
            returnedCarrierName: 'Sürat Kargo',
            carrierNamePresent: true,
            skippedReason: null,
            errorMessage: null,
          },
        },
        createdAt: submittedAt,
        updatedAt: submittedAt,
      };
    },
    async probeTryOtoReturnDetails(shipmentExecutionId: string) {
      if (runtimeConfig.apiMode === 'real') {
        return realOrders.probeTryOtoReturnDetails(shipmentExecutionId);
      }

      const submittedAt = new Date().toISOString();
      return {
        id: shipmentExecutionId,
        allocationId: shipmentExecutionId.replace(/^mock-shipment-try_oto-/, ''),
        vendorId: getCurrentVendorId(),
        sourceShopifyOrderId: null,
        sourceShopifyOrderNumber: null,
        sourceShopifyFulfillmentId: null,
        provider: 'try_oto' as const,
        providerShipmentId: `mock-oto-${shipmentExecutionId.slice(-6).toUpperCase()}`,
        trackingNumber: `OTO-${shipmentExecutionId.slice(-6).toUpperCase()}`,
        trackingUrl: null,
        labelUrl: 'https://example.test/try-oto-label.pdf',
        shipmentStatus: 'delivered' as const,
        desi: '1.00',
        cargoIntegrationId: null,
        warehouseId: 'pickup-location',
        shippingCost: null,
        shippingVat: null,
        currency: 'TRY',
        shippingCostLinked: false,
        barcode: `BAR-${shipmentExecutionId.slice(-6).toUpperCase()}`,
        returnShipment: {
          provider: 'try_oto' as const,
          returnOrderId: `mock-return-${shipmentExecutionId.slice(-6).toUpperCase()}`,
          trackingNumber: `RET-${shipmentExecutionId.slice(-6).toUpperCase()}`,
          trackingUrl: null,
          labelUrl: 'https://example.test/try-oto-return-label.pdf',
          barcode: `RET-BAR-${shipmentExecutionId.slice(-6).toUpperCase()}`,
          status: 'created',
          createdAt: submittedAt,
          requestKeys: ['items', 'orderId'],
          responseKeys: ['printAWBURL', 'returnOrderId'],
          trackingPresent: true,
          labelPresent: true,
          labelRetrievalConfirmed: true,
          labelRetrievalNote: null,
          finalized: true,
          labelRetrievable: true,
          providerStatusSource: 'getReturnDetails',
          diagnostics: null,
          detailsProbe: {
            status: 'success',
            attemptedAt: submittedAt,
            endpoint: '/rest/v2/getReturnDetails',
            httpStatus: 200,
            responseKeys: ['data'],
            nestedKeys: ['data.printAWBURL', 'data.trackingNumber'],
            labelLikeFieldsPresent: true,
            awbLikeFieldsPresent: true,
            pdfLikeFieldsPresent: false,
            urlLikeFieldsPresent: true,
            trackingPresent: true,
            barcodePresent: true,
            providerStatus: 'created',
            labelUrlPresent: true,
            errorMessage: null,
          },
        },
        createdAt: submittedAt,
        updatedAt: submittedAt,
      };
    },
    async probeTryOtoReturnLink(shipmentExecutionId: string) {
      if (runtimeConfig.apiMode === 'real') {
        return realOrders.probeTryOtoReturnLink(shipmentExecutionId);
      }

      const submittedAt = new Date().toISOString();
      return {
        id: shipmentExecutionId,
        allocationId: shipmentExecutionId.replace(/^mock-shipment-try_oto-/, ''),
        vendorId: getCurrentVendorId(),
        sourceShopifyOrderId: null,
        sourceShopifyOrderNumber: null,
        sourceShopifyFulfillmentId: null,
        provider: 'try_oto' as const,
        providerShipmentId: `mock-oto-${shipmentExecutionId.slice(-6).toUpperCase()}`,
        trackingNumber: `OTO-${shipmentExecutionId.slice(-6).toUpperCase()}`,
        trackingUrl: null,
        labelUrl: 'https://example.test/try-oto-label.pdf',
        shipmentStatus: 'delivered' as const,
        desi: '1.00',
        cargoIntegrationId: null,
        warehouseId: 'pickup-location',
        shippingCost: null,
        shippingVat: null,
        currency: 'TRY',
        shippingCostLinked: false,
        barcode: `BAR-${shipmentExecutionId.slice(-6).toUpperCase()}`,
        returnShipment: {
          provider: 'try_oto' as const,
          returnOrderId: `mock-return-${shipmentExecutionId.slice(-6).toUpperCase()}`,
          trackingNumber: `RET-${shipmentExecutionId.slice(-6).toUpperCase()}`,
          trackingUrl: null,
          labelUrl: 'https://example.test/try-oto-return-label.pdf',
          barcode: `RET-BAR-${shipmentExecutionId.slice(-6).toUpperCase()}`,
          status: 'created',
          createdAt: submittedAt,
          requestKeys: ['items', 'orderId'],
          responseKeys: ['returnOrderId'],
          trackingPresent: true,
          labelPresent: true,
          labelRetrievalConfirmed: true,
          labelRetrievalNote: null,
          finalized: true,
          labelRetrievable: true,
          providerStatusSource: 'getReturnLink',
          diagnostics: null,
          linkProbe: {
            status: 'success',
            attemptedAt: submittedAt,
            endpoint: '/rest/v2/getReturnLink',
            httpStatus: 200,
            responseKeys: ['data'],
            nestedKeys: ['data.printAWBURL'],
            labelLikeFieldsPresent: true,
            awbLikeFieldsPresent: true,
            pdfLikeFieldsPresent: false,
            urlLikeFieldsPresent: true,
            actionUrlPresent: false,
            trackingPresent: false,
            barcodePresent: false,
            providerStatus: null,
            labelUrlPresent: true,
            providerMessage: null,
            errorMessage: null,
          },
        },
        createdAt: submittedAt,
        updatedAt: submittedAt,
      };
    },
    async probeTryOtoReturnAwbPrint(shipmentExecutionId: string) {
      if (runtimeConfig.apiMode === 'real') {
        return realOrders.probeTryOtoReturnAwbPrint(shipmentExecutionId);
      }

      const submittedAt = new Date().toISOString();
      return {
        id: shipmentExecutionId,
        allocationId: shipmentExecutionId.replace(/^mock-shipment-try_oto-/, ''),
        vendorId: getCurrentVendorId(),
        sourceShopifyOrderId: null,
        sourceShopifyOrderNumber: null,
        sourceShopifyFulfillmentId: null,
        provider: 'try_oto' as const,
        providerShipmentId: `mock-oto-${shipmentExecutionId.slice(-6).toUpperCase()}`,
        trackingNumber: `OTO-${shipmentExecutionId.slice(-6).toUpperCase()}`,
        trackingUrl: null,
        labelUrl: 'https://example.test/try-oto-label.pdf',
        shipmentStatus: 'delivered' as const,
        desi: '1.00',
        cargoIntegrationId: null,
        warehouseId: 'pickup-location',
        shippingCost: null,
        shippingVat: null,
        currency: 'TRY',
        shippingCostLinked: false,
        barcode: `BAR-${shipmentExecutionId.slice(-6).toUpperCase()}`,
        returnShipment: {
          provider: 'try_oto' as const,
          returnOrderId: `mock-return-${shipmentExecutionId.slice(-6).toUpperCase()}`,
          trackingNumber: `RET-${shipmentExecutionId.slice(-6).toUpperCase()}`,
          trackingUrl: null,
          labelUrl: 'https://example.test/try-oto-return-label.pdf',
          barcode: `RET-BAR-${shipmentExecutionId.slice(-6).toUpperCase()}`,
          status: 'created',
          createdAt: submittedAt,
          requestKeys: ['returnOrderId', 'printReverseShipment'],
          responseKeys: ['printAWBURL', 'returnOrderId'],
          trackingPresent: true,
          labelPresent: true,
          labelRetrievalConfirmed: true,
          labelRetrievalNote: null,
          finalized: true,
          labelRetrievable: true,
          providerStatusSource: 'return AWB print',
          diagnostics: null,
          awbPrintProbe: {
            status: 'success',
            attemptedAt: submittedAt,
            endpoint: `/rest/v2/print/mock-return-${shipmentExecutionId.slice(-6).toUpperCase()}?printReverseShipment=true`,
            httpStatus: 200,
            responseKeys: ['printAWBURL', 'trackingNumber'],
            nestedKeys: ['printAWBURL', 'trackingNumber'],
            labelLikeFieldsPresent: true,
            awbLikeFieldsPresent: true,
            pdfLikeFieldsPresent: false,
            urlLikeFieldsPresent: true,
            trackingPresent: true,
            barcodePresent: true,
            providerStatus: 'created',
            labelUrlPresent: true,
            providerMessage: null,
            errorMessage: null,
          },
        },
        createdAt: submittedAt,
        updatedAt: submittedAt,
      };
    },
    async shippingProviderDiagnostics(
      vendorId = getCurrentVendorId(),
      provider: ShippingProvider | 'navlungo' = 'kargo_entegrator',
      options: ReadRequestOptions = {},
    ) {
      if (runtimeConfig.apiMode === 'real') {
        return realOrders.getShippingProviderDiagnostics(provider, { vendorId, signal: options.signal });
      }

      if (provider === 'navlungo') {
        return {
          provider: 'navlungo' as const,
          supportedProviders: ['navlungo' as const],
          executionReady: false,
          sandboxModeEnabled: false,
          shippingExecutionEnabled: false,
          providerSelected: false,
          providerEnabled: false,
          webhookIngestEnabled: false,
          baseUrlConfigured: false,
          apiKeyConfigured: false,
          cargoIntegrationIdConfigured: false,
          warehouseIdConfigured: false,
          defaultDesiConfigured: false,
          packageTypeUsed: '',
          notificationUrlConfigured: false,
          webhookRouteImplemented: false,
          receiverAddressAvailability: 'unknown_required' as const,
          dummyKargoSupport: 'not_implemented' as const,
          statusSyncSupport: 'not_implemented' as const,
          missing: ['NAVLUNGO_BASE_URL', 'NAVLUNGO_API_USERNAME', 'NAVLUNGO_API_PASSWORD'],
          deprecatedEnvFallbacks: [],
          warnings: ['Navlungo forward shipment execution is enabled only when explicitly selected.'],
          navlungo: {
            usernameConfigured: false,
            passwordConfigured: false,
            defaultSenderAddressIdConfigured: false,
            defaultBarcodeFormat: 'pdf-A6',
            defaultCarrierId: '9',
            authDiagnosticsAvailable: true,
            runtimeShipmentExecutionEnabled: true,
            returnReverseImplementation: 'not_implemented' as const,
          },
        };
      }

      return {
        provider,
        supportedProviders: ['kargo_entegrator' as const, 'hepsijet' as const, 'kargonomi' as const],
        executionReady: false,
        sandboxModeEnabled: false,
        shippingExecutionEnabled: false,
        providerSelected: false,
        providerEnabled: false,
        webhookIngestEnabled: false,
        baseUrlConfigured: false,
        apiKeyConfigured: false,
        cargoIntegrationIdConfigured: false,
        warehouseIdConfigured: false,
        defaultDesiConfigured: false,
        packageTypeUsed: 'box',
        notificationUrlConfigured: false,
        webhookRouteImplemented: true,
        receiverAddressAvailability: 'confirmed_required' as const,
        dummyKargoSupport: 'not_implemented' as const,
        statusSyncSupport: 'not_implemented' as const,
        missing: ['SHIPPING_EXECUTION_ENABLED', 'KARGO_ENTEGRATOR_ENABLED'],
        deprecatedEnvFallbacks: [],
        warnings: [
          'Kargo Entegratör webhook/status sync is not implemented.',
          'Live carrier execution is not enabled or verified.',
        ],
      };
    },
    async vendorShippingConfig(vendorId = getCurrentVendorId(), options: ReadRequestOptions = {}) {
      if (runtimeConfig.apiMode === 'real') {
        return realOrders.getVendorShippingConfig({ vendorId, signal: options.signal });
      }

      return {
        vendorId,
        preferredProvider: 'kargo_entegrator' as const,
        shippingEnabled: true,
        defaultDesi: '3.00',
        cargoIntegrationId: '2547',
        defaultWarehouseId: '1774',
        shippingVatPercent: '18.00',
        warehouses: [
          {
            id: `mock-warehouse-${vendorId}-1774`,
            vendorId,
            provider: 'kargo_entegrator' as const,
            warehouseId: '1774',
            name: 'Default warehouse',
            address: null,
            isDefault: true,
          },
        ],
        providerMetadata: {
          packageType: 'box',
        },
        source: 'configured' as const,
        updatedAt: new Date().toISOString(),
      };
    },
    async updateVendorShippingConfig(vendorId: string, input: VendorShippingConfigUpdate) {
      if (runtimeConfig.apiMode === 'real') {
        return realOrders.updateVendorShippingConfig(vendorId, input);
      }

      return {
        vendorId,
        preferredProvider: input.preferredProvider ?? 'kargo_entegrator',
        shippingEnabled: input.shippingEnabled ?? true,
        defaultDesi: (input.defaultDesi ?? 3).toFixed(2),
        cargoIntegrationId: input.cargoIntegrationId ?? '2547',
        defaultWarehouseId: input.defaultWarehouseId ?? '1774',
        shippingVatPercent: (input.shippingVatPercent ?? 18).toFixed(2),
        warehouses: (input.warehouses ?? []).map((warehouse, index) => ({
          id: `mock-warehouse-${vendorId}-${warehouse.warehouseId}-${index}`,
          vendorId,
          provider: warehouse.provider ?? input.preferredProvider ?? 'kargo_entegrator',
          warehouseId: warehouse.warehouseId,
          name: warehouse.name ?? null,
          address: warehouse.address ?? null,
          isDefault: Boolean(warehouse.isDefault),
        })),
        providerMetadata: input.providerMetadata ?? {
          packageType: 'box',
        },
        source: 'configured' as const,
        updatedAt: new Date().toISOString(),
      };
    },
  },
  returns: {
    list: (vendorId = getCurrentVendorId(), options: ReadRequestOptions = {}) =>
      runtimeConfig.apiMode === 'real'
        ? realReturns.listReturns({ vendorId, signal: options.signal, headers: options.headers, limit: options.limit, offset: options.offset })
        : Promise.resolve(listMockReturns(vendorId)),
    async detail(returnId: string, vendorId = getCurrentVendorId(), options: ReadRequestOptions = {}) {
      if (runtimeConfig.apiMode === 'real') {
        return realReturns.getReturn(returnId, { vendorId, signal: options.signal });
      }

      const returnRecord = getMockReturn(returnId, vendorId);
      if (!returnRecord) {
        throw new ApiError('Return not found.', 'server', { status: 404 });
      }
      return returnRecord;
    },
    async markReceived(returnId: string, vendorId = getCurrentVendorId()) {
      if (runtimeConfig.apiMode === 'real') {
        return realReturns.markReturnReceived(returnId, { vendorId });
      }

      const returnRecord = getMockReturn(returnId, vendorId);
      if (!returnRecord) {
        throw new ApiError('Return not found.', 'server', { status: 404 });
      }
      return {
        ...returnRecord,
        vendorReceivedAt: new Date().toISOString(),
      };
    },
    async review(returnId: string, input: { decision: 'approved' | 'rejected'; reason?: string }, vendorId = getCurrentVendorId()) {
      if (runtimeConfig.apiMode === 'real') {
        return realReturns.reviewReturn(returnId, input, { vendorId });
      }

      const returnRecord = getMockReturn(returnId, vendorId);
      if (!returnRecord) {
        throw new ApiError('Return not found.', 'server', { status: 404 });
      }
      return {
        ...returnRecord,
        vendorReceivedAt: returnRecord.vendorReceivedAt ?? new Date().toISOString(),
        vendorReviewedAt: new Date().toISOString(),
        vendorDecision: input.decision,
        vendorDecisionReason: input.decision === 'rejected' ? input.reason ?? null : null,
      };
    },
    async createNavlungoReturnPickup(
      returnId: string,
      input: {
        dryRun?: boolean;
        apiVersionOverride?: 'current' | 'v2' | 'v2.1';
        endpointVersionOverride?: 'current' | 'v2' | 'v2.1';
        carrierOverride?: 'current' | '9' | '10';
        carrierIdOverride?: 'current' | '9' | '10';
        endpointPathOverride?: '/post/create' | '/post/return';
        diagnosticConfirm?: 'YES';
        customerOverrides?: Record<string, string | undefined>;
      } = {},
      vendorId = getCurrentVendorId(),
    ) {
      if (runtimeConfig.apiMode === 'real') {
        return realReturns.createNavlungoReturnPickup(returnId, input, { vendorId });
      }

      const returnRecord = getMockReturn(returnId, vendorId);
      if (!returnRecord) {
        throw new ApiError('Return not found.', 'server', { status: 404 });
      }
      if (input.dryRun) {
        return {
          ...returnRecord,
          returnProviderSnapshot: {
            navlungoReturnPickupDryRun: true,
            navlungoReturnPickupAttempted: false,
            navlungoReturnPickupSucceeded: false,
            navlungoReturnPickupMissingFields: [],
            navlungoReturnPickupPayloadSummary: {
              endpointPath: input.endpointPathOverride ?? '/post/create',
              method: 'POST',
              senderKeys: ['address', 'city', 'country', 'district', 'email', 'name', 'phone', 'post_code'],
              recipientKeys: ['addressId'],
              requestedPostType: 3,
              customData1Present: true,
              customData2Present: true,
              customData3Present: true,
              customData4Present: true,
            },
          },
        };
      }
      return {
        ...returnRecord,
        returnProvider: 'navlungo',
        returnProviderShipmentId: 'MOCK-RETURN-POST',
        returnReferenceId: 'MO-RET-1023-ABC123',
        returnCarrierName: 'Navlungo',
        returnTrackingNumber: 'MOCK-RETURN-POST',
        returnTrackingUrl: 'https://example.test/track/MOCK-RETURN-POST',
        returnLabel: 'mock-barcode',
        navlungoReturnCreatedAt: new Date().toISOString(),
        returnProviderSnapshot: {
          navlungoReturnPickupDryRun: false,
          navlungoReturnPickupAttempted: true,
          navlungoReturnPickupSucceeded: true,
          shopifyReturnSyncSkippedReason: 'not_implemented',
        },
      };
    },
    async saveNavlungoReturnPickupAddressCompletion(
      returnId: string,
      input: { customerOverrides?: Record<string, string | undefined> } = {},
      vendorId = getCurrentVendorId(),
    ) {
      if (runtimeConfig.apiMode === 'real') {
        return realReturns.saveNavlungoReturnPickupAddressCompletion(returnId, input, { vendorId });
      }

      const returnRecord = getMockReturn(returnId, vendorId);
      if (!returnRecord) {
        throw new ApiError('Return not found.', 'server', { status: 404 });
      }
      const overrideKeys = Object.entries(input.customerOverrides ?? {})
        .filter(([, value]) => typeof value === 'string' && value.trim())
        .map(([key]) => key)
        .sort();
      const remainingMissing = (returnRecord.returnProviderSnapshot?.navlungoReturnPickupMissingFields as string[] | undefined ?? [])
        .filter((field) => !overrideKeys.includes(field.replace(/^sender\./, '').replace('post_code', 'postcode')));
      return {
        ...returnRecord,
        returnProviderSnapshot: {
          ...(returnRecord.returnProviderSnapshot ?? {}),
          navlungoReturnPickupCustomerOverrideKeys: overrideKeys,
          navlungoReturnPickupCustomerOverrideValuesRedacted: true,
          navlungoReturnPickupCompletionSavedAt: new Date().toISOString(),
          navlungoReturnPickupMissingFields: remainingMissing,
          navlungoReturnMissingFields: remainingMissing,
          navlungoReturnAutoCreateSkippedReason: remainingMissing.length ? 'missing_required_fields' : null,
          navlungoReturnPickupStatus: remainingMissing.length ? 'needs_attention' : 'ready',
        },
      };
    },
    async syncNavlungoReturnStatus(returnId: string, vendorId = getCurrentVendorId()) {
      if (runtimeConfig.apiMode === 'real') {
        return realReturns.syncNavlungoReturnStatus(returnId, { vendorId });
      }

      const returnRecord = getMockReturn(returnId, vendorId);
      if (!returnRecord) {
        throw new ApiError('Return not found.', 'server', { status: 404 });
      }
      if (!returnRecord.returnProviderShipmentId) {
        throw new ApiError('Navlungo return status sync requires a stored return post number.', 'server', { status: 400 });
      }
      return {
        ...returnRecord,
        returnTrackingNumber: returnRecord.returnTrackingNumber ?? returnRecord.returnProviderShipmentId,
        returnTrackingUrl: returnRecord.returnTrackingUrl ?? `https://example.test/track/${returnRecord.returnProviderShipmentId}`,
        returnProviderSnapshot: {
          ...(returnRecord.returnProviderSnapshot ?? {}),
          navlungoReturnStatusSyncAttempted: true,
          navlungoReturnStatusSyncHttpStatus: 200,
          navlungoReturnStatusSyncSucceeded: true,
          navlungoReturnProviderStatusCode: 17,
          navlungoReturnProviderStatusName: 'Transfer Aşamasında',
          navlungoReturnNormalizedStatus: 'in_transit',
          navlungoReturnLogsCount: 1,
          navlungoReturnStatusLogs: [
            {
              status_code: 17,
              action: 'Transfer Aşamasında',
              action_result: 'In transit',
              created_at: new Date().toISOString(),
            },
          ],
          shopifyReturnStatusSyncSkippedReason: 'not_implemented',
        },
      };
    },
  },
  finance: {
    dashboard: (vendorId = getCurrentVendorId(), options: ReadRequestOptions = {}) =>
      runtimeConfig.apiMode === 'real'
        ? realFinance.getFinanceDashboard({ vendorId, signal: options.signal, headers: options.headers, limit: options.limit, offset: options.offset })
        : Promise.resolve(getMockFinanceDashboard(vendorId)),
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
    attachShippingCost: (input: Parameters<typeof realFinance.attachShippingCost>[0]) =>
      runtimeConfig.apiMode === 'real'
        ? realFinance.attachShippingCost(input)
        : Promise.resolve({
            id: `mock-shipping-cost-${input.financeLedgerEntryId}`,
            ...input,
            allocationId: 'mock-allocation',
            sourceShopifyOrderId: 'mock-order',
            sourceShopifyFulfillmentId: null,
            currency: 'TRY',
            shippingCost: input.shippingCost.toFixed(2),
            shippingVatAmount: input.shippingVatAmount === null ? null : input.shippingVatAmount.toFixed(2),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }),
    createInvoiceExecution: (financeLedgerEntryId: string) =>
      runtimeConfig.apiMode === 'real'
        ? realFinance.createInvoiceExecution(financeLedgerEntryId)
        : Promise.resolve({
            id: `mock-invoice-bizimhesap-${financeLedgerEntryId}`,
            financeLedgerEntryId,
            provider: 'bizimhesap' as const,
            providerInvoiceGuid: `mock-guid-${financeLedgerEntryId}`,
            providerInvoiceNo: null,
            providerPdfUrl: null,
            status: 'created' as const,
            visibilityStatus: 'accounting_synced' as const,
            visibilityLabel: 'Accounting sync recorded',
            reconciliationState: 'invoice_visibility_incomplete' as const,
            finalInvoiceState: 'draft_or_synced' as const,
            syncSemantics: 'draft_accounting_sync' as const,
            providerCapabilities: {
              supportsDraftSubmission: true,
              supportsFinalInvoiceVisibility: false,
              supportsPdfLink: true,
              supportsStatusSync: false,
              note: 'BizimHesap AddInvoice is treated as accounting draft/sync visibility; finalized invoice authority is reconciled separately.',
            },
            requestSnapshot: {},
            responseSnapshot: {},
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }),
    retryInvoiceExecution: (invoiceExecutionId: string) =>
      runtimeConfig.apiMode === 'real'
        ? realFinance.retryInvoiceExecution(invoiceExecutionId)
        : Promise.resolve({
            id: invoiceExecutionId,
            financeLedgerEntryId: 'mock-ledger',
            provider: 'bizimhesap' as const,
            providerInvoiceGuid: `mock-guid-${invoiceExecutionId}`,
            providerInvoiceNo: null,
            providerPdfUrl: null,
            status: 'created' as const,
            visibilityStatus: 'accounting_synced' as const,
            visibilityLabel: 'Accounting sync recorded',
            reconciliationState: 'invoice_visibility_incomplete' as const,
            finalInvoiceState: 'draft_or_synced' as const,
            syncSemantics: 'draft_accounting_sync' as const,
            providerCapabilities: {
              supportsDraftSubmission: true,
              supportsFinalInvoiceVisibility: false,
              supportsPdfLink: true,
              supportsStatusSync: false,
              note: 'BizimHesap AddInvoice is treated as accounting draft/sync visibility; finalized invoice authority is reconciled separately.',
            },
            requestSnapshot: {},
            responseSnapshot: {},
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }),
    getInvoiceExecutionResponseSummary: (invoiceExecutionId: string, options: ReadRequestOptions = {}) =>
      runtimeConfig.apiMode === 'real'
        ? realFinance.getInvoiceExecutionResponseSummary(invoiceExecutionId, { signal: options.signal })
        : Promise.resolve({
            id: invoiceExecutionId,
            provider: 'bizimhesap' as const,
            status: 'unknown' as const,
            providerInvoiceGuidPresent: false,
            providerInvoiceNoPresent: false,
            providerPdfUrlPresent: false,
            response: {
              httpStatus: 200,
              ok: true,
              contentType: 'application/json',
              parsedBodyType: 'object',
              bodyKeys: ['error', 'guid', 'url'],
              nestedBodyKeys: ['error', 'guid', 'url'],
              providerError: null,
              parsedGuidPresent: false,
              parsedPdfUrlPresent: false,
            },
          }),
  },
  automation: {
    dashboard: (vendorId = getCurrentVendorId(), options: ReadRequestOptions = {}) =>
      runtimeConfig.apiMode === 'real'
        ? realAutomation.getAutomationDashboard(vendorId, { signal: options.signal, headers: options.headers })
        : Promise.resolve(getMockAutomationDashboard(vendorId)),
  },
  operations: {
    list: (options: ReadRequestOptions = {}) =>
      runtimeConfig.apiMode === 'real'
        ? realOperations.listAdminOperationsQueue({ signal: options.signal, headers: options.headers, limit: options.limit, offset: options.offset })
        : Promise.resolve(listMockAdminOperationsQueue()),
    dashboard: (options: ReadRequestOptions = {}) => {
      if (runtimeConfig.apiMode === 'real') {
        return realOperations.getAdminOperationsQueueDashboard({
          signal: options.signal,
          headers: options.headers,
          limit: options.limit,
          offset: options.offset,
        });
      }

      const items = listMockAdminOperationsQueue();
      return Promise.resolve({
        summary: buildOperationsQueueSummary(items),
        items,
      });
    },
    attention: (options: ReadRequestOptions = {}) =>
      runtimeConfig.apiMode === 'real'
        ? realOperations.getAdminOperationsAttention({ signal: options.signal })
        : Promise.resolve(getMockAdminOperationsAttention()),
  },
  vendorIntegration: {
    providers: (options: ReadRequestOptions = {}) =>
      runtimeConfig.apiMode === 'real'
        ? realVendorIntegration.getVendorIntegrationProviderManagement({ signal: options.signal })
        : Promise.resolve(getMockVendorIntegrationProviderManagement()),
    revokeProviderToken: (clientId: string) =>
      runtimeConfig.apiMode === 'real'
        ? realVendorIntegration.revokeVendorIntegrationProviderToken(clientId)
        : Promise.resolve(getMockVendorIntegrationProviderRevokeResult(clientId)),
  },
  signals: {
    list: (vendorId = getCurrentVendorId(), options: ReadRequestOptions = {}) =>
      runtimeConfig.apiMode === 'real'
        ? realSignals.listOperationalSignals(vendorId, { signal: options.signal, headers: options.headers })
        : Promise.resolve({
            summary: {
              total: 0,
              critical: 0,
              high: 0,
              warning: 0,
              info: 0,
            },
            signals: [],
          }),
  },
  notifications: {
    list: (vendorId: string | null = getCurrentVendorId(), options: ReadRequestOptions = {}) =>
      runtimeConfig.apiMode === 'real'
        ? realNotifications.listNotifications(vendorId, { signal: options.signal, headers: options.headers })
        : Promise.resolve({
            summary: {
              total: 0,
              unread: 0,
              critical: 0,
              high: 0,
              warning: 0,
            },
            notifications: [],
          }),
    markRead: (notificationId: string) =>
      runtimeConfig.apiMode === 'real'
        ? realNotifications.markNotificationRead(notificationId)
        : Promise.resolve({
            id: notificationId,
            signalId: null,
            vendorId: null,
            recipientRole: 'vendor' as const,
            channel: 'in_app' as const,
            status: 'read' as const,
            title: 'Notification',
            message: 'Mock notification read.',
            severity: 'info' as const,
            deliveredAt: new Date().toISOString(),
            readAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }),
    dismiss: (notificationId: string) =>
      runtimeConfig.apiMode === 'real'
        ? realNotifications.dismissNotification(notificationId)
        : Promise.resolve({
            id: notificationId,
            signalId: null,
            vendorId: null,
            recipientRole: 'vendor' as const,
            channel: 'in_app' as const,
            status: 'dismissed' as const,
            title: 'Notification',
            message: 'Mock notification dismissed.',
            severity: 'info' as const,
            deliveredAt: new Date().toISOString(),
            readAt: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }),
  },
  support: {
    async create(input: CreateSupportTicketInput) {
      if (runtimeConfig.apiMode === 'real') {
        return realSupport.createSupportTicket(input);
      }

      const now = new Date().toISOString();
      const ticket: SupportTicket = {
        id: `mock-support-${Date.now()}`,
        createdAt: now,
        updatedAt: now,
        createdByUserId: 'mock-user',
        createdByRole: 'vendor',
        vendorId: getCurrentVendorId(),
        vendorName: getCurrentVendorContext().vendorName,
        subject: input.subject,
        message: input.message,
        priority: input.priority,
        status: 'OPEN',
        category: input.category ?? (input.contextType === 'return' ? 'RETURN' : input.contextType === 'order' ? 'ORDER' : input.contextType === 'shipment' ? 'SHIPMENT' : 'OTHER'),
        contextType: input.contextType,
        contextId: input.contextId ?? null,
        contextSnapshot: input.contextSnapshot ?? null,
        contextSummary: buildMockSupportContextSummary(input.contextSnapshot),
        resolvedAt: null,
        closedAt: null,
        assigneeUserId: null,
        assigneeName: null,
        vendorUnreadCount: 0,
        adminUnreadCount: 0,
        lastReplyAt: null,
        lastReplyByRole: null,
        firstResponseDueAt: calculateMockSupportDueAt(input.priority),
        nextResponseDueAt: null,
        escalatedAt: null,
        escalationReason: null,
        sla: null,
        notes: [],
        replies: [],
      };
      mockSupportTickets.unshift(ticket);
      return toMockVendorSupportTicket(ticket);
    },
    listAdmin: (options: ReadRequestOptions = {}) =>
      runtimeConfig.apiMode === 'real'
        ? realSupport.listAdminSupportTickets({ signal: options.signal, headers: options.headers })
        : Promise.resolve(mockSupportTickets),
    analytics: (options: ReadRequestOptions = {}) =>
      runtimeConfig.apiMode === 'real'
        ? realSupport.getAdminSupportAnalytics({ signal: options.signal })
        : Promise.resolve(buildMockSupportAnalytics()),
    listVendor: (options: ReadRequestOptions = {}) =>
      runtimeConfig.apiMode === 'real'
        ? realSupport.listVendorSupportTickets({ signal: options.signal, headers: options.headers })
        : Promise.resolve(mockSupportTickets.filter((ticket) => ticket.vendorId === getCurrentVendorId()).map(toMockVendorSupportTicket)),
    async detailAdmin(ticketId: string, options: ReadRequestOptions = {}) {
      if (runtimeConfig.apiMode === 'real') {
        return realSupport.getAdminSupportTicket(ticketId, { signal: options.signal });
      }
      const ticket = mockSupportTickets.find((item) => item.id === ticketId);
      if (!ticket) {
        throw new ApiError('Support ticket not found.', 'server', { status: 404 });
      }
      ticket.adminUnreadCount = 0;
      return ticket;
    },
    async detailVendor(ticketId: string, options: ReadRequestOptions = {}) {
      if (runtimeConfig.apiMode === 'real') {
        return realSupport.getVendorSupportTicket(ticketId, { signal: options.signal });
      }
      const ticket = mockSupportTickets.find((item) => item.id === ticketId && item.vendorId === getCurrentVendorId());
      if (!ticket) {
        throw new ApiError('Support ticket not found.', 'server', { status: 404 });
      }
      ticket.vendorUnreadCount = 0;
      return toMockVendorSupportTicket(ticket);
    },
    async updateStatus(ticketId: string, status: SupportTicketStatus) {
      if (runtimeConfig.apiMode === 'real') {
        return realSupport.updateAdminSupportTicketStatus(ticketId, status);
      }
      const ticket = mockSupportTickets.find((item) => item.id === ticketId);
      if (!ticket) {
        throw new ApiError('Support ticket not found.', 'server', { status: 404 });
      }
      ticket.status = status;
      ticket.updatedAt = new Date().toISOString();
      ticket.resolvedAt = status === 'RESOLVED' ? ticket.updatedAt : ticket.resolvedAt;
      ticket.closedAt = status === 'CLOSED' ? ticket.updatedAt : ticket.closedAt;
      if (status === 'RESOLVED' || status === 'CLOSED') {
        ticket.firstResponseDueAt = null;
        ticket.nextResponseDueAt = null;
        ticket.escalatedAt = null;
        ticket.escalationReason = null;
      }
      return ticket;
    },
    async addNote(ticketId: string, content: string) {
      if (runtimeConfig.apiMode === 'real') {
        return realSupport.addAdminSupportTicketNote(ticketId, content);
      }
      const ticket = mockSupportTickets.find((item) => item.id === ticketId);
      if (!ticket) {
        throw new ApiError('Support ticket not found.', 'server', { status: 404 });
      }
      const note = {
        id: `mock-note-${Date.now()}`,
        supportTicketId: ticketId,
        authorUserId: 'mock-admin',
        authorName: 'Mock Admin',
        authorRole: 'admin',
        content,
        createdAt: new Date().toISOString(),
      };
      ticket.notes = [...(ticket.notes ?? []), note];
      ticket.updatedAt = note.createdAt;
      return note;
    },
    async addAdminReply(ticketId: string, message: string, status?: SupportTicketStatus) {
      if (runtimeConfig.apiMode === 'real') {
        return realSupport.addAdminSupportTicketReply(ticketId, message, status);
      }
      const ticket = mockSupportTickets.find((item) => item.id === ticketId);
      const currentUser = getCurrentUser();
      if (!ticket) {
        throw new ApiError('Support ticket not found.', 'server', { status: 404 });
      }
      if (ticket.status === 'CLOSED') {
        throw new ApiError('Closed support tickets cannot receive replies.', 'server', { status: 400 });
      }
      const now = new Date().toISOString();
      ticket.replies = [
        ...(ticket.replies ?? []),
        {
          id: `mock-reply-${Date.now()}`,
          supportTicketId: ticketId,
          authorUserId: currentUser?.email ?? 'mock-admin',
          authorName: currentUser?.name ?? 'Mock Admin',
          authorRole: 'ADMIN',
          message,
          createdAt: now,
        },
      ];
      ticket.status = status ?? ticket.status;
      ticket.firstResponseDueAt = null;
      ticket.nextResponseDueAt = null;
      ticket.vendorUnreadCount += 1;
      ticket.adminUnreadCount = 0;
      ticket.lastReplyAt = now;
      ticket.lastReplyByRole = 'ADMIN';
      ticket.updatedAt = now;
      return ticket;
    },
    async addVendorReply(ticketId: string, message: string) {
      if (runtimeConfig.apiMode === 'real') {
        return realSupport.addVendorSupportTicketReply(ticketId, message);
      }
      const ticket = mockSupportTickets.find((item) => item.id === ticketId && item.vendorId === getCurrentVendorId());
      const currentUser = getCurrentUser();
      if (!ticket) {
        throw new ApiError('Support ticket not found.', 'server', { status: 404 });
      }
      if (ticket.status === 'CLOSED') {
        throw new ApiError('Closed support tickets cannot receive replies.', 'server', { status: 400 });
      }
      const now = new Date().toISOString();
      ticket.replies = [
        ...(ticket.replies ?? []),
        {
          id: `mock-reply-${Date.now()}`,
          supportTicketId: ticketId,
          authorUserId: currentUser?.email ?? 'mock-vendor',
          authorName: currentUser?.name ?? 'Vendor User',
          authorRole: 'VENDOR',
          message,
          createdAt: now,
        },
      ];
      ticket.status = ticket.status === 'WAITING_FOR_VENDOR' ? 'IN_REVIEW' : ticket.status;
      ticket.nextResponseDueAt = calculateMockSupportDueAt(ticket.priority);
      ticket.escalatedAt = null;
      ticket.escalationReason = null;
      ticket.adminUnreadCount += 1;
      ticket.vendorUnreadCount = 0;
      ticket.lastReplyAt = now;
      ticket.lastReplyByRole = 'VENDOR';
      ticket.updatedAt = now;
      return { ...ticket, notes: undefined };
    },
    async escalateVendor(ticketId: string) {
      if (runtimeConfig.apiMode === 'real') {
        return realSupport.escalateVendorSupportTicket(ticketId);
      }
      const ticket = mockSupportTickets.find((item) => item.id === ticketId && item.vendorId === getCurrentVendorId());
      const currentUser = getCurrentUser();
      if (!ticket) {
        throw new ApiError('Support ticket not found.', 'server', { status: 404 });
      }
      if (ticket.status === 'RESOLVED' || ticket.status === 'CLOSED') {
        throw new ApiError('Resolved or closed support tickets cannot be escalated.', 'server', { status: 400 });
      }
      const now = new Date().toISOString();
      ticket.priority = 'high';
      ticket.status = ticket.status === 'OPEN' ? 'IN_REVIEW' : ticket.status;
      ticket.escalatedAt = now;
      ticket.escalationReason = `Vendor escalation requested by ${currentUser?.name ?? 'Vendor User'}.`;
      ticket.adminUnreadCount += 1;
      ticket.updatedAt = now;
      return { ...ticket, notes: undefined };
    },
    async assignToSelf(ticketId: string) {
      if (runtimeConfig.apiMode === 'real') {
        return realSupport.assignAdminSupportTicketToSelf(ticketId);
      }
      const ticket = mockSupportTickets.find((item) => item.id === ticketId);
      const currentUser = getCurrentUser();
      if (!ticket) {
        throw new ApiError('Support ticket not found.', 'server', { status: 404 });
      }
      ticket.assigneeUserId = currentUser?.email ?? 'mock-admin';
      ticket.assigneeName = currentUser?.name ?? 'Mock Admin';
      ticket.updatedAt = new Date().toISOString();
      return ticket;
    },
    async unassign(ticketId: string) {
      if (runtimeConfig.apiMode === 'real') {
        return realSupport.unassignAdminSupportTicket(ticketId);
      }
      const ticket = mockSupportTickets.find((item) => item.id === ticketId);
      if (!ticket) {
        throw new ApiError('Support ticket not found.', 'server', { status: 404 });
      }
      ticket.assigneeUserId = null;
      ticket.assigneeName = null;
      ticket.updatedAt = new Date().toISOString();
      return ticket;
    },
  },
  diagnostics: {
    webhooks: (options: ReadRequestOptions = {}) =>
      runtimeConfig.apiMode === 'real'
        ? realDiagnostics.listWebhookDiagnostics({ signal: options.signal })
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
    webhookDetail: (webhookEventId: string, options: ReadRequestOptions = {}) =>
      runtimeConfig.apiMode === 'real'
        ? realDiagnostics.getWebhookDiagnostic(webhookEventId, { signal: options.signal })
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
    syncEvents: (options: ReadRequestOptions = {}) =>
      runtimeConfig.apiMode === 'real'
        ? realDiagnostics.listSyncEvents({ signal: options.signal })
        : Promise.resolve({
            items: [],
          }),
    reconciliation: (options: ReadRequestOptions = {}) =>
      runtimeConfig.apiMode === 'real'
        ? realDiagnostics.getReconciliationDiagnostics({ signal: options.signal, headers: options.headers })
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
    kargonomiLocationLookup: () =>
      runtimeConfig.apiMode === 'real'
        ? realDiagnostics.runKargonomiLocationLookupDiagnostics()
        : Promise.resolve({
            temporary: true as const,
            baseUrlHost: 'app.kargonomi.com.tr',
            baseUrlPath: '/api/v1',
            baseUrlParseError: null,
            tokenPresent: false,
            statesRequestUrl: '/states/1',
            statesHttpStatus: null,
            statesFetchError: {
              name: 'MockMode',
              message: 'Kargonomi lookup diagnostics are available in real API mode only.',
              cause: null,
            },
            statesContentType: null,
            statesShapeSummary: null,
            firstStateNames: [],
            istanbulStateId: null,
            citiesRequestUrl: null,
            citiesHttpStatus: null,
            citiesFetchError: null,
            citiesContentType: null,
            citiesShapeSummary: null,
            firstCityNames: [],
          }),
    navlungoAuth: () =>
      runtimeConfig.apiMode === 'real'
        ? realDiagnostics.runNavlungoAuthDiagnostics()
        : Promise.resolve({
            provider: 'navlungo' as const,
            displayName: 'Navlungo' as const,
            dormant: true as const,
            baseUrlHost: 'domestic-api.navlungo.com',
            baseUrlPath: '/v2',
            baseUrlParseError: null,
            usernamePresent: false,
            passwordPresent: false,
            authRequestUrl: '/v2/auth/api',
            authHttpStatus: null,
            authContentType: null,
            responseShapeSummary: null,
            responseDataShapeSummary: null,
            tokenKeyPresence: {
              rootAccessToken: false,
              dataAccessToken: false,
              dataToken: false,
              anyTokenLikeKey: false,
            },
            refreshTokenKeyPresence: {
              rootRefreshToken: false,
              dataRefreshToken: false,
            },
            expiresInPresent: false,
            tokenTypePresent: false,
            tokenReceived: false,
            refreshTokenReceived: false,
            expiresIn: null,
            authValidationErrorKeys: [],
            authValidationErrorMessages: [],
            authFailedFieldNames: [],
            fetchError: {
              name: 'MockMode',
              message: 'Navlungo auth diagnostics are available in real API mode only.',
              cause: null,
            },
          }),
    navlungoCarriers: () =>
      runtimeConfig.apiMode === 'real'
        ? realDiagnostics.runNavlungoCarrierDiagnostics()
        : Promise.resolve({
            provider: 'navlungo' as const,
            displayName: 'Navlungo' as const,
            dormant: true as const,
            authHttpStatus: null,
            authContentType: null,
            authTokenReceived: false,
            carrierEndpointPathsKnown: false,
            skippedReason: 'carrier_endpoint_paths_unknown',
            myCarriersRequestUrl: null,
            myCarriersHttpStatus: null,
            myCarriersContentType: null,
            myCarriersResponseShape: null,
            myCarriersDataShape: null,
            myCarrierCount: null,
            myCarrierSamples: [],
            listCarriersRequestUrl: null,
            listCarriersHttpStatus: null,
            listCarriersContentType: null,
            listCarriersResponseShape: null,
            listCarriersDataShape: null,
            listCarrierCount: null,
            listCarrierSamples: [],
            anyConfiguredCarrier: false,
            providerMessages: ['Navlungo carrier diagnostics are available in real API mode only.'],
            fetchError: {
              name: 'MockMode',
              message: 'Navlungo carrier diagnostics are available in real API mode only.',
              cause: null,
            },
          }),
    navlungoCreatePostProbe: (payload: { confirm: 'YES' }) =>
      runtimeConfig.apiMode === 'real'
        ? realDiagnostics.runNavlungoCreatePostProbe(payload.confirm)
        : Promise.resolve({
            provider: 'navlungo' as const,
            dormant: true as const,
            authHttpStatus: null,
            authContentType: null,
            authTokenReceived: false,
            requestedCarrierId: 9,
            requestedPostType: 2,
            requestedBarcodeFormat: 'pdf-A6',
            codPaymentIncluded: false,
            priceIncluded: false,
            requestSummary: {
              baseUrl: 'domestic-api.navlungo.com/v2',
              baseUrlHost: 'domestic-api.navlungo.com',
              baseUrlPath: '/v2',
              endpointPath: '/post/create',
              method: 'POST',
              headerKeys: ['Accept', 'Authorization', 'Content-Type', 'X-localization'],
              topLevelBodyKeys: ['platform', 'posts'],
              postKeys: ['barcode_format', 'carrier_id', 'custom_data_1', 'custom_data_2', 'custom_data_3', 'custom_data_4', 'post', 'post_type', 'recipient', 'reference_id', 'sender'],
              senderKeys: ['addressId'],
              recipientKeys: ['address', 'city', 'country', 'district', 'email', 'name', 'phone', 'post_code'],
              postPayloadKeys: ['desi', 'note', 'package_count'],
              barcodeFormatPresent: true,
              barcodeFormatType: 'string',
              codPaymentTypePresent: false,
              codPaymentType: null,
              postPricePresent: false,
              postPriceType: null,
              requestedCarrierId: 9,
              requestedPostType: 2,
              senderUsesAddressId: true,
              senderFullObjectKeysPresent: false,
              customData1Present: true,
              customData2Present: true,
              customData3Present: true,
              customData4Present: true,
              recipientDistrictPresent: true,
              recipientCityPresent: true,
              recipientCountryPresent: true,
              recipientPostCodePresent: false,
              recipientPhonePresent: true,
              recipientPhoneFormatValid: true,
              recipientEmailPresent: true,
              recipientEmailFormatValid: true,
              recipientAddressPresent: true,
              recipientAddressLength: 0,
              packageCountPresent: true,
              packageCountType: 'number',
              requestedPackageCount: 1,
              desiPresent: true,
              desiType: 'number',
              requestedDesi: 3,
              postNotePresent: true,
              postNoteType: 'string',
              postNoteLength: 0,
            },
            createPostHttpStatus: null,
            createPostContentType: null,
            responseShape: null,
            dataShape: null,
            topLevelKeys: [],
            dataKeys: [],
            postNumber: null,
            postNumberPresent: false,
            referenceId: null,
            referenceIdPresent: false,
            trackingUrlPresent: false,
            barcodeUrlPresent: false,
            barcodePresent: false,
            barcodeType: null,
            carrierIdPresent: false,
            carrierId: null,
            carrierNamePresent: false,
            carrierName: null,
            postCarrierKeys: [],
            providerMessage: 'Navlungo Create Post probe is available in real API mode only.',
            errorMessage: null,
          }),
    navlungoCheckPostProbe: (payload: { postNumber: string }) =>
      runtimeConfig.apiMode === 'real'
        ? realDiagnostics.runNavlungoCheckPostProbe(payload.postNumber)
        : Promise.resolve({
            provider: 'navlungo' as const,
            dormant: true as const,
            postNumber: payload.postNumber,
            authHttpStatus: null,
            authContentType: null,
            authTokenReceived: false,
            checkPostHttpStatus: null,
            checkPostContentType: null,
            responseShape: null,
            dataShape: null,
            dataKeys: [],
            statusKeys: [],
            postNumberPresent: false,
            trackingUrlPresent: false,
            carrierTrackingUrlPresent: false,
            barcodePresent: false,
            barcodeType: null,
            carrierIdPresent: false,
            carrierNamePresent: false,
            statusCode: null,
            statusName: null,
            providerMessage: 'Navlungo Check Post probe is available in real API mode only.',
            errorMessage: null,
          }),
    navlungoBarcodeProbe: (payload: { postNumber: string }) =>
      runtimeConfig.apiMode === 'real'
        ? realDiagnostics.runNavlungoBarcodeProbe(payload.postNumber)
        : Promise.resolve({
            provider: 'navlungo' as const,
            dormant: true as const,
            postNumber: payload.postNumber,
            barcodeEndpointPathKnown: false,
            skippedReason: 'barcode_endpoint_path_unknown' as const,
            barcodeHttpStatus: null,
            barcodeContentType: null,
            responseShape: null,
            barcodeFieldPresent: false,
            barcodeUrlPresent: false,
            barcodeBase64Present: false,
            providerMessage: 'Navlungo Barcode probe is available in real API mode only.',
            errorMessage: null,
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
    summary: (options: ReadRequestOptions = {}) =>
      runtimeConfig.apiMode === 'real'
        ? realObservability.getObservabilitySummary({ signal: options.signal, headers: options.headers })
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
