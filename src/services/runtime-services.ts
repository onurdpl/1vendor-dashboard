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
import * as realFinance from './real/finance';
import * as realAutomation from './real/automation';
import * as realOperations from './real/operations';
import * as realDiagnostics from './real/diagnostics';
import * as realObservability from './real/observability';
import * as realSignals from './real/signals';
import * as realNotifications from './real/notifications';
import * as realSupport from './real/support';
import * as realRuntime from './real/runtime';
import type {
  CreateSupportTicketInput,
  SupportAnalytics,
  SupportTicket,
  SupportTicketCategory,
  SupportTicketContextSummary,
  SupportTicketStatus,
} from '../lib/api/contracts';
import type { SubmitFulfillmentTrackingPayload } from './real/orders';

function getCurrentVendorId() {
  return getCurrentVendorContext().vendorId;
}

const mockSupportTickets: SupportTicket[] = [];

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
    health: () =>
      runtimeConfig.apiMode === 'real'
        ? realRuntime.getBackendHealth()
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
    list: (vendorId = getCurrentVendorId()) =>
      runtimeConfig.apiMode === 'real' ? realOrders.listOrders({ vendorId }) : Promise.resolve(listMockOrders(vendorId)),
    async detail(orderId: string, vendorId = getCurrentVendorId()) {
      if (runtimeConfig.apiMode === 'real') {
        return realOrders.getOrder(orderId, { vendorId });
      }

      const order = getMockOrder(orderId, vendorId);
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
    async createShipmentExecution(allocationId: string) {
      if (runtimeConfig.apiMode === 'real') {
        return realOrders.createShipmentExecution(allocationId);
      }

      const submittedAt = new Date().toISOString();
      return {
        id: `mock-shipment-kargo-${allocationId}`,
        allocationId,
        vendorId: getCurrentVendorId(),
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
    async shippingProviderDiagnostics() {
      if (runtimeConfig.apiMode === 'real') {
        return realOrders.getShippingProviderDiagnostics('kargo_entegrator', { vendorId: getCurrentVendorId() });
      }

      return {
        provider: 'kargo_entegrator' as const,
        executionReady: false,
        shippingExecutionEnabled: false,
        providerSelected: false,
        providerEnabled: false,
        baseUrlConfigured: false,
        apiKeyConfigured: false,
        cargoIntegrationIdConfigured: false,
        warehouseIdConfigured: false,
        defaultDesiConfigured: false,
        notificationUrlConfigured: false,
        webhookRouteImplemented: false,
        receiverAddressAvailability: 'unknown_required' as const,
        dummyKargoSupport: 'not_implemented' as const,
        statusSyncSupport: 'not_implemented' as const,
        missing: ['SHIPPING_EXECUTION_ENABLED', 'KARGO_ENTEGRATOR_ENABLED'],
        deprecatedEnvFallbacks: [],
        warnings: [
          'Kargo Entegratör create contract is not verified.',
          'Receiver address and phone requirements are unknown.',
          'Kargo Entegratör webhook/status sync is not implemented.',
          'Dummy Kargo creation is not implemented.',
        ],
      };
    },
  },
  returns: {
    list: (vendorId = getCurrentVendorId()) =>
      runtimeConfig.apiMode === 'real' ? realReturns.listReturns({ vendorId }) : Promise.resolve(listMockReturns(vendorId)),
    async detail(returnId: string, vendorId = getCurrentVendorId()) {
      if (runtimeConfig.apiMode === 'real') {
        return realReturns.getReturn(returnId, { vendorId });
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
  },
  finance: {
    dashboard: (vendorId = getCurrentVendorId()) =>
      runtimeConfig.apiMode === 'real'
        ? realFinance.getFinanceDashboard({ vendorId })
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
    getInvoiceExecutionResponseSummary: (invoiceExecutionId: string) =>
      runtimeConfig.apiMode === 'real'
        ? realFinance.getInvoiceExecutionResponseSummary(invoiceExecutionId)
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
    dashboard: (vendorId = getCurrentVendorId()) =>
      runtimeConfig.apiMode === 'real'
        ? realAutomation.getAutomationDashboard(vendorId)
        : Promise.resolve(getMockAutomationDashboard(vendorId)),
  },
  operations: {
    list: () =>
      runtimeConfig.apiMode === 'real'
        ? realOperations.listAdminOperationsQueue()
        : Promise.resolve(listMockAdminOperationsQueue()),
    attention: () =>
      runtimeConfig.apiMode === 'real'
        ? realOperations.getAdminOperationsAttention()
        : Promise.resolve(getMockAdminOperationsAttention()),
  },
  signals: {
    list: (vendorId = getCurrentVendorId()) =>
      runtimeConfig.apiMode === 'real'
        ? realSignals.listOperationalSignals(vendorId)
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
    list: (vendorId: string | null = getCurrentVendorId()) =>
      runtimeConfig.apiMode === 'real'
        ? realNotifications.listNotifications(vendorId)
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
    listAdmin: () =>
      runtimeConfig.apiMode === 'real'
        ? realSupport.listAdminSupportTickets()
        : Promise.resolve(mockSupportTickets),
    analytics: () =>
      runtimeConfig.apiMode === 'real'
        ? realSupport.getAdminSupportAnalytics()
        : Promise.resolve(buildMockSupportAnalytics()),
    listVendor: () =>
      runtimeConfig.apiMode === 'real'
        ? realSupport.listVendorSupportTickets()
        : Promise.resolve(mockSupportTickets.filter((ticket) => ticket.vendorId === getCurrentVendorId()).map(toMockVendorSupportTicket)),
    async detailAdmin(ticketId: string) {
      if (runtimeConfig.apiMode === 'real') {
        return realSupport.getAdminSupportTicket(ticketId);
      }
      const ticket = mockSupportTickets.find((item) => item.id === ticketId);
      if (!ticket) {
        throw new ApiError('Support ticket not found.', 'server', { status: 404 });
      }
      ticket.adminUnreadCount = 0;
      return ticket;
    },
    async detailVendor(ticketId: string) {
      if (runtimeConfig.apiMode === 'real') {
        return realSupport.getVendorSupportTicket(ticketId);
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
