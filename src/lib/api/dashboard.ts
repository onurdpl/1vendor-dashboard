import { getCurrentUser, getCurrentVendorContext, type VendorId } from '../auth';
import { runtimeConfig } from '../../config/runtime';
import { getMockAutomationDashboard } from './mockAutomation';
import { getMockFinanceDashboard } from './mockFinance';
import { listMockOrders } from './mockOrders';
import { listMockReturns } from './mockReturns';
import type {
  DashboardDiagnosticsSummary,
  DashboardFinanceSnapshot,
  DashboardNotificationSummary,
  DashboardOverview,
  DashboardObservabilitySummary,
  DashboardPriorityItem,
} from './contracts';
import { runtimeServices } from '../../services/runtime-services';
import { ApiError } from './errors';

function resolveVendorId(vendorId?: VendorId) {
  return vendorId ?? getCurrentVendorContext().vendorId;
}

function readErrorStatus(error: unknown) {
  if (!error || typeof error !== 'object') {
    return null;
  }

  const status = Reflect.get(error, 'status');
  if (typeof status === 'number') {
    return status;
  }

  const response = Reflect.get(error, 'response');
  if (response && typeof response === 'object') {
    const responseStatus = Reflect.get(response, 'status');
    return typeof responseStatus === 'number' ? responseStatus : null;
  }

  return null;
}

function isDashboardAuthError(error: unknown) {
  const status = readErrorStatus(error);
  return (error instanceof ApiError && error.kind === 'unauthorized') || status === 401 || status === 403;
}

function throwDashboardAuthError(results: Array<PromiseSettledResult<unknown>>) {
  const authFailure = results.find((result) => result.status === 'rejected' && isDashboardAuthError(result.reason));

  if (authFailure?.status === 'rejected') {
    throw authFailure.reason;
  }
}

function formatCount(value: number) {
  return value.toString();
}

function buildMockDashboardOverview(vendorId?: VendorId): DashboardOverview {
  const currentVendorId = resolveVendorId(vendorId);
  const currentVendor = getCurrentVendorContext();
  const orders = listMockOrders(currentVendorId);
  const returns = listMockReturns(currentVendorId);
  const finance = getMockFinanceDashboard(currentVendorId);
  const automation = getMockAutomationDashboard(currentVendorId);
  const activeOrders = orders.filter((order) =>
    ['Pending', 'Processing', 'Shipped', 'On Hold'].includes(order.status),
  ).length;
  const activeReturns = returns.filter((item) => ['Pending', 'In Review'].includes(item.status)).length;
  const pendingPayouts = finance.transactions.filter((transaction) => transaction.status === 'Pending').length;
  const unresolvedAlerts = automation.alerts.filter((alert) => alert.status !== 'Resolved').length;

  const recentActivity: string[] = [];

  if (orders[0]) {
    recentActivity.push(`${orders[0].id} is ${orders[0].status.toLowerCase()} for ${orders[0].customer}`);
  }

  if (returns[0]) {
    recentActivity.push(`${returns[0].id} is ${returns[0].status.toLowerCase()} against ${returns[0].relatedOrderId}`);
  }

  if (automation.alerts[0]) {
    recentActivity.push(`${automation.alerts[0].source} flagged ${automation.alerts[0].type.toLowerCase()} signals`);
  }

  return {
    vendorId: currentVendorId,
    vendorName: currentVendor.vendorName,
    title: `${currentVendor.vendorName} command center`,
    description: `Track ${currentVendor.vendorName} activity, support workload, and finance status from one place.`,
    stats: [
      { label: 'Open tickets', value: formatCount(activeReturns + unresolvedAlerts) },
      { label: 'Pending payouts', value: formatCount(pendingPayouts) },
      { label: 'Vendor checks', value: formatCount(activeOrders) },
    ],
    recentActivity: recentActivity.length > 0 ? recentActivity : [`No recent activity for ${currentVendor.vendorName}.`],
    workspaceStatus: `${currentVendor.vendorName} has ${activeOrders} active orders, ${activeReturns} active returns, and ${unresolvedAlerts} automation alerts in flight.`,
    priorityWork: [
      { label: 'Blocked allocations', value: formatCount(unresolvedAlerts), tone: 'severity-warning' },
      { label: 'Awaiting shipment', value: formatCount(activeOrders), tone: 'severity-attention' },
      { label: 'Refund attention', value: formatCount(activeReturns), tone: 'severity-normal' },
    ],
    financeSnapshot: {
      grossSales: finance.summary.grossSales,
      refunds: finance.summary.refunds,
      netRevenue: finance.summary.netRevenue,
      payoutEstimate: finance.summary.payoutEstimate,
    },
  };
}

function toMoneyValue(value: string) {
  const parsed = Number.parseFloat(value.replace(/[^0-9.-]/g, '') || '0');
  return Number.isFinite(parsed) ? parsed : 0;
}

function createPriorityWork(input: {
  blockedCount: number;
  awaitingShipmentCount: number;
  refundAttentionCount: number;
  automationSignalCount: number;
}): DashboardPriorityItem[] {
  return [
    {
      label: 'Blocked allocations',
      value: formatCount(input.blockedCount),
      tone: input.blockedCount > 0 ? 'severity-warning' : 'severity-normal',
      description: input.blockedCount > 0 ? 'Allocations waiting for reassignment or vendor recovery.' : 'No blocked allocations right now.',
    },
    {
      label: 'Awaiting shipment',
      value: formatCount(input.awaitingShipmentCount),
      tone: input.awaitingShipmentCount > 0 ? 'severity-attention' : 'severity-normal',
      description: input.awaitingShipmentCount > 0 ? 'Allocations still waiting for shipment progress.' : 'No allocations are awaiting shipment.',
    },
    {
      label: 'Refund attention',
      value: formatCount(input.refundAttentionCount),
      tone: input.refundAttentionCount > 0 ? 'severity-warning' : 'severity-normal',
      description: input.refundAttentionCount > 0 ? 'Refund records still need review or reconciliation.' : 'No active refund attention items.',
    },
    {
      label: 'Automation signals',
      value: formatCount(input.automationSignalCount),
      tone: input.automationSignalCount > 0 ? 'severity-attention' : 'severity-normal',
      description: input.automationSignalCount > 0 ? 'Backend automation signals are active for this vendor scope.' : 'No unresolved automation alerts.',
    },
  ];
}

async function buildRealDashboardOverview(vendorId?: VendorId): Promise<DashboardOverview> {
  const currentVendorId = resolveVendorId(vendorId);
  const currentVendor = getCurrentVendorContext();
  const currentUser = getCurrentUser();

  const partialDataWarnings: string[] = [];
  const dashboardRequests = await Promise.allSettled([
    runtimeServices.orders.list(currentVendorId),
    runtimeServices.returns.list(currentVendorId),
    runtimeServices.finance.dashboard(currentVendorId),
    runtimeServices.automation.dashboard(currentVendorId),
    currentUser?.role === 'admin' ? runtimeServices.operations.list() : Promise.resolve(null),
    runtimeServices.signals.list(currentVendorId),
    runtimeServices.notifications.list(currentVendorId),
    currentUser?.role === 'admin' ? runtimeServices.diagnostics.reconciliation() : Promise.resolve(null),
    currentUser?.role === 'admin' ? runtimeServices.observability.summary() : Promise.resolve(null),
  ]);

  throwDashboardAuthError(dashboardRequests);

  const [
    ordersResult,
    returnsResult,
    financeResult,
    automationResult,
    operationsResult,
    signalsResult,
    notificationsResult,
    diagnosticsResult,
    observabilityResult,
  ] = dashboardRequests;

  const orders = ordersResult.status === 'fulfilled' ? ordersResult.value : [];
  if (ordersResult.status === 'rejected') {
    partialDataWarnings.push('Orders overview is temporarily unavailable.');
  }

  const returns = returnsResult.status === 'fulfilled' ? returnsResult.value : [];
  if (returnsResult.status === 'rejected') {
    partialDataWarnings.push('Returns overview is temporarily unavailable.');
  }

  const finance = financeResult.status === 'fulfilled' ? financeResult.value : null;
  if (financeResult.status === 'rejected') {
    partialDataWarnings.push('Finance snapshot is temporarily unavailable.');
  }

  const automation = automationResult.status === 'fulfilled' ? automationResult.value : null;
  if (automationResult.status === 'rejected') {
    partialDataWarnings.push('Automation signals are temporarily unavailable.');
  }

  const operations = operationsResult.status === 'fulfilled' ? operationsResult.value : null;
  if (operationsResult.status === 'rejected') {
    partialDataWarnings.push('Operations queue context is temporarily unavailable.');
  }

  const signals = signalsResult.status === 'fulfilled' ? signalsResult.value : null;
  if (signalsResult.status === 'rejected') {
    partialDataWarnings.push('Operational rules signals are temporarily unavailable.');
  }

  const notifications = notificationsResult.status === 'fulfilled' ? notificationsResult.value : null;
  if (notificationsResult.status === 'rejected') {
    partialDataWarnings.push('In-app notifications are temporarily unavailable.');
  }

  const diagnostics = diagnosticsResult.status === 'fulfilled' ? diagnosticsResult.value : null;
  if (diagnosticsResult.status === 'rejected') {
    partialDataWarnings.push('Diagnostics summary is temporarily unavailable.');
  }

  const observability = observabilityResult.status === 'fulfilled' ? observabilityResult.value : null;
  if (observabilityResult.status === 'rejected') {
    partialDataWarnings.push('Operational observability is temporarily unavailable.');
  }

  const awaitingShipmentCount = orders.filter((order) => order.shippingStatus === 'Awaiting Shipment').length;
  const blockedCount = orders.filter(
    (order) => order.allocationStatus === 'pending_reassignment' || order.allocationStatus === 'vendor_blocked',
  ).length;
  const activeRefundCount = returns.filter((item) => item.status === 'Pending' || item.status === 'In Review').length;
  const unresolvedAlerts = (automation?.alerts ?? []).filter((alert) => alert.status !== 'Resolved').length;
  const activeSignalCount = signals?.summary.total ?? 0;
  const payoutEstimate = finance?.summary.payoutEstimate ?? '—';
  const refundAmount = returns.reduce((total, item) => total + toMoneyValue(item.amount), 0);

  const priorityWork = createPriorityWork({
    blockedCount,
    awaitingShipmentCount,
    refundAttentionCount: activeRefundCount,
    automationSignalCount: unresolvedAlerts + activeSignalCount,
  });

  const recentActivity = [
    ...((signals?.signals ?? []).slice(0, 2).map((signal) => `${signal.title}: ${signal.description}`)),
    ...(orders[0]
      ? [`${orders[0].id} is ${orders[0].shippingStatus.toLowerCase()} for Shopify order #${orders[0].sourceShopifyOrderNumber}`]
      : []),
    ...(returns[0]
      ? [`${returns[0].id} is ${returns[0].status.toLowerCase()} against refund ${returns[0].sourceShopifyRefundId}`]
      : []),
    ...((automation?.alerts ?? []).slice(0, 1).map(
      (alert) => `${alert.source} flagged ${alert.status.toLowerCase()} automation work`,
    )),
  ];

  let workspaceStatus = `${currentVendor.vendorName} has ${orders.length} vendor-scoped orders, ${activeRefundCount} refunds needing attention, and ${unresolvedAlerts + activeSignalCount} active automation/rules signals.`;
  if (currentUser?.role === 'admin' && operations) {
    workspaceStatus = `${workspaceStatus} Admin queue currently tracks ${operations.length} operational items for the selected vendor scope.`;
  }

  const diagnosticsSummary: DashboardDiagnosticsSummary | undefined =
    currentUser?.role === 'admin' && diagnostics
      ? {
          failedWebhooks: diagnostics.summary.failedWebhooks,
          stuckReceived: diagnostics.summary.stuckReceived,
          fulfillmentSyncFailures: diagnostics.summary.fulfillmentSyncFailures,
        }
      : undefined;

  const financeSnapshot: DashboardFinanceSnapshot | undefined = finance
    ? {
        grossSales: finance.summary.grossSales,
        refunds: finance.summary.refunds,
        netRevenue: finance.summary.netRevenue,
        payoutEstimate: finance.summary.payoutEstimate,
      }
    : undefined;
  const observabilitySummary: DashboardObservabilitySummary | undefined =
    currentUser?.role === 'admin' && observability
      ? {
          health: observability.health,
          retryPressureScore: observability.retryPressure.pressureScore,
          deadLetterReady: observability.retryPressure.deadLetterReady + observability.retryPressure.permanentlyFailed,
          failedWebhooks24h: observability.webhookHealth.failed24h,
          successRate24h: observability.webhookHealth.successRate24h,
          reconciliationBacklog: observability.reconciliation.pending + observability.reconciliation.processing,
          staleStateCount: observability.staleStates.total,
          note: observability.notes[0] ?? 'No active observability note.',
        }
      : undefined;
  const notificationSummary: DashboardNotificationSummary | undefined = notifications
    ? {
        unread: notifications.summary.unread,
        highPriority: notifications.summary.critical + notifications.summary.high,
        latest: notifications.notifications.slice(0, 3).map((notification) => ({
          id: notification.id,
          title: notification.title,
          severity: notification.severity,
          status: notification.status,
        })),
      }
    : undefined;

  return {
    vendorId: currentVendorId,
    vendorName: currentVendor.vendorName,
    title: `${currentVendor.vendorName} command center`,
    description: `Monitor backend-derived operational state for ${currentVendor.vendorName} from one workspace.`,
    stats: [
      { label: 'Vendor orders', value: formatCount(orders.length) },
      { label: 'Awaiting shipment', value: formatCount(awaitingShipmentCount) },
      { label: 'Blocked / attention', value: formatCount(blockedCount + activeRefundCount) },
      { label: 'Payout estimate', value: payoutEstimate },
      { label: 'Refund amount', value: finance?.summary.refunds ?? `-$${refundAmount.toFixed(2)}` },
    ],
    recentActivity: recentActivity.length > 0 ? recentActivity : [`No recent backend activity for ${currentVendor.vendorName}.`],
    workspaceStatus,
    priorityWork,
    financeSnapshot,
    diagnosticsSummary,
    observabilitySummary,
    notificationSummary,
    partialDataWarnings,
  };
}

export function buildDashboardOverview(vendorId?: VendorId): DashboardOverview {
  return buildMockDashboardOverview(vendorId);
}

export async function getDashboardOverview(vendorId?: VendorId): Promise<DashboardOverview> {
  if (runtimeConfig.apiMode === 'real') {
    return buildRealDashboardOverview(vendorId);
  }

  return buildMockDashboardOverview(vendorId);
}
