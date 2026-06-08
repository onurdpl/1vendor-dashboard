import { getCurrentUser, getCurrentVendorContext, type VendorId } from '../auth';
import { runtimeConfig } from '../../config/runtime';
import { getMockAutomationDashboard } from './mockAutomation';
import { getMockFinanceDashboard } from './mockFinance';
import { listMockOrders } from './mockOrders';
import { listMockReturns } from './mockReturns';
import type {
  AutomationAlert,
  DashboardDiagnosticsSummary,
  DashboardFinanceSnapshot,
  DashboardNormalizedOperationalCounts,
  DashboardOperationalSummary,
  DashboardOverview,
  DashboardObservabilitySummary,
  DashboardPriorityItem,
  FinanceTransaction,
  OperationalSignal,
  SupportTicket,
} from './contracts';
import { runtimeServices } from '../../services/runtime-services';
import { ApiError } from './errors';

export const DASHBOARD_INITIAL_LOAD_HEADER = 'X-Dashboard-Initial-Load';
export const DASHBOARD_DEFERRED_LOAD_HEADER = 'X-Dashboard-Deferred-Load';
const SLOW_DASHBOARD_OPERATION_MS = 300;
const SLOW_DASHBOARD_TOTAL_MS = 1000;
const DASHBOARD_DEFERRED_LIST_LIMIT = 10;
const DASHBOARD_DEFERRED_PHASE_2_DELAY_MS = 500;
const DASHBOARD_DEFERRED_PHASE_3_DELAY_MS = 1000;

type DashboardLoadPhase = 'initial' | 'deferred';
type DashboardRequestOptions = { signal?: AbortSignal; requestId?: string };

function resolveVendorId(vendorId?: VendorId) {
  return vendorId ?? getCurrentVendorContext().vendorId;
}

export function createDashboardRequestId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `dashboard-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function getDashboardNow() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
}

export function createDashboardRequestHeaders(requestId: string, phase: DashboardLoadPhase): HeadersInit {
  const headers: Record<string, string> = {
    'X-Request-Id': requestId,
  };

  if (phase === 'initial') {
    headers[DASHBOARD_INITIAL_LOAD_HEADER] = 'true';
  } else {
    headers[DASHBOARD_DEFERRED_LOAD_HEADER] = 'true';
  }

  return headers;
}

function logDashboardClientTiming(input: {
  requestId: string;
  step: string;
  durationMs: number;
  loadPhase?: DashboardLoadPhase;
  failed?: boolean;
  thresholdMs?: number;
}) {
  const payload = {
    event: 'ADMIN_DASHBOARD_TIMING',
    requestId: input.requestId,
    step: input.step,
    ...(input.loadPhase ? { loadPhase: input.loadPhase } : {}),
    durationMs: Math.max(0, Math.round(input.durationMs)),
    failed: Boolean(input.failed),
  };
  console.info(payload);

  const thresholdMs = input.thresholdMs ?? SLOW_DASHBOARD_OPERATION_MS;
  if (payload.durationMs > thresholdMs) {
    console.warn({
      event: input.step === 'dashboard.route.end' || input.step === 'dashboard.deferred.route.end' ? 'ADMIN_DASHBOARD_SLOW_TOTAL' : 'ADMIN_DASHBOARD_SLOW_OPERATION',
      requestId: input.requestId,
      step: input.step,
      ...(input.loadPhase ? { loadPhase: input.loadPhase } : {}),
      durationMs: payload.durationMs,
      thresholdMs,
      failed: payload.failed,
    });
  }
}

async function withDashboardClientTiming<T>(
  requestId: string,
  step: string,
  action: () => Promise<T>,
  loadPhase?: DashboardLoadPhase,
): Promise<T> {
  const startedAt = getDashboardNow();
  let failed = false;
  try {
    return await action();
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    logDashboardClientTiming({
      requestId,
      step,
      loadPhase,
      durationMs: getDashboardNow() - startedAt,
      failed,
    });
  }
}

function createDashboardAbortError() {
  if (typeof DOMException !== 'undefined') {
    return new DOMException('Dashboard deferred loading was aborted.', 'AbortError');
  }

  const error = new Error('Dashboard deferred loading was aborted.');
  error.name = 'AbortError';
  return error;
}

function waitForDashboardDeferredPhase(signal: AbortSignal | undefined, delayMs: number) {
  if (delayMs <= 0) {
    return Promise.resolve();
  }

  if (signal?.aborted) {
    return Promise.reject(createDashboardAbortError());
  }

  return new Promise<void>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      signal?.removeEventListener('abort', handleAbort);
      resolve();
    }, delayMs);

    function handleAbort() {
      clearTimeout(timeoutId);
      reject(createDashboardAbortError());
    }

    signal?.addEventListener('abort', handleAbort, { once: true });
  });
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

function throwDashboardAuthError(results: ReadonlyArray<PromiseSettledResult<unknown>>) {
  const authFailure = results.find((result) => result.status === 'rejected' && isDashboardAuthError(result.reason));

  if (authFailure?.status === 'rejected') {
    throw authFailure.reason;
  }
}

function formatCount(value: number) {
  return value.toString();
}

function formatOptionalCount(value: number | null) {
  return typeof value === 'number' ? formatCount(value) : 'Unknown';
}

function hasPositiveCount(value: number | null) {
  return typeof value === 'number' && value > 0;
}

function formatRecentListDescription(count: number, label: string) {
  return `Latest ${count} ${label}${count === 1 ? '' : 's'} are loaded for recent activity and detail.`;
}

function normalizeIssueKeyPart(value: string | null | undefined) {
  return value?.trim().toLowerCase().replace(/\s+/g, ' ') || 'unknown';
}

function getOperationalSignalEntityKey(signal: OperationalSignal) {
  return signal.allocationId ?? signal.financeLedgerEntryId ?? signal.payoutBatchId ?? signal.operationalJobId ?? signal.id;
}

function buildOperationalCountMetadata(input: {
  label: string;
  source: string;
  rawCount: number | null;
  groupedCount: number | null;
}) {
  return input;
}

function countAutomationIssueGroups(alerts: AutomationAlert[], signals: OperationalSignal[]) {
  const groups = new Set<string>();
  let rawCount = 0;

  alerts
    .filter((alert) => alert.status !== 'Resolved')
    .forEach((alert) => {
      rawCount += 1;
      groups.add(
        [
          'automation-alert',
          normalizeIssueKeyPart(alert.source),
          normalizeIssueKeyPart(alert.type),
          normalizeIssueKeyPart(alert.message),
        ].join('|'),
      );
    });

  signals
    .filter((signal) => signal.status === 'active' || signal.status === 'acknowledged')
    .forEach((signal) => {
      rawCount += 1;
      groups.add(
        [
          'operational-signal',
          normalizeIssueKeyPart(signal.sourceArea),
          normalizeIssueKeyPart(signal.ruleKey),
          normalizeIssueKeyPart(getOperationalSignalEntityKey(signal)),
        ].join('|'),
      );
    });

  return {
    rawCount,
    groupedCount: groups.size,
  };
}

function getSupportIssueGroupKey(ticket: SupportTicket) {
  const contextId = ticket.contextId?.trim() || ticket.id;
  return [ticket.vendorId, ticket.contextType, contextId, ticket.category].map(normalizeIssueKeyPart).join('|');
}

function countOpenSupportIssues(tickets: SupportTicket[], vendorId: string) {
  const openTickets = tickets.filter(
    (ticket) => ticket.vendorId === vendorId && ['OPEN', 'IN_REVIEW', 'WAITING_FOR_VENDOR'].includes(ticket.status),
  );
  return {
    rawCount: openTickets.length,
    groupedCount: new Set(openTickets.map(getSupportIssueGroupKey)).size,
  };
}

function isFinanceReviewItem(transaction: FinanceTransaction) {
  if (transaction.status === 'Pending' || transaction.status === 'Failed') {
    return true;
  }
  if (transaction.settlement?.payoutReady) {
    return true;
  }
  return transaction.settlement?.status === 'held' || transaction.settlement?.status === 'disputed';
}

function countFinanceReviewItems(finance: { transactions?: FinanceTransaction[] } | null) {
  if (!finance) {
    return {
      rawCount: null,
      groupedCount: null,
    };
  }

  const reviewItems = (finance.transactions ?? []).filter(isFinanceReviewItem);
  return {
    rawCount: reviewItems.length,
    groupedCount: new Set(reviewItems.map((transaction) => transaction.id)).size,
  };
}

function countStaleFulfillmentGroups(signals: OperationalSignal[] | null | undefined) {
  const staleSignals = (signals ?? []).filter((signal) => {
    const normalized = `${signal.sourceArea} ${signal.ruleKey} ${signal.title}`.toLowerCase();
    return signal.status !== 'resolved' && normalized.includes('fulfillment') && normalized.includes('stale');
  });

  return {
    rawCount: staleSignals.length,
    groupedCount: new Set(staleSignals.map((signal) => signal.allocationId ?? signal.id)).size,
  };
}

function buildNormalizedOperationalCounts(input: {
  support: { rawCount: number | null; groupedCount: number | null };
  automation: { rawCount: number | null; groupedCount: number | null };
  finance: { rawCount: number | null; groupedCount: number | null };
  staleFulfillment: { rawCount: number | null; groupedCount: number | null };
}): DashboardNormalizedOperationalCounts {
  return {
    openSupportIssueCount: input.support.groupedCount,
    groupedAutomationIssueCount: input.automation.groupedCount,
    financeReviewItemCount: input.finance.groupedCount,
    staleFulfillmentGroupCount: input.staleFulfillment.groupedCount,
    metadata: {
      openSupportIssueCount: buildOperationalCountMetadata({
        label: 'Open support issues',
        source: 'support.tickets.open_grouped_by_context',
        rawCount: input.support.rawCount,
        groupedCount: input.support.groupedCount,
      }),
      groupedAutomationIssueCount: buildOperationalCountMetadata({
        label: 'Automation issue groups',
        source: 'automation.alerts_and_operational_signals.grouped',
        rawCount: input.automation.rawCount,
        groupedCount: input.automation.groupedCount,
      }),
      financeReviewItemCount: buildOperationalCountMetadata({
        label: 'Finance review items',
        source: 'finance.records.pending_failed_or_held',
        rawCount: input.finance.rawCount,
        groupedCount: input.finance.groupedCount,
      }),
      staleFulfillmentGroupCount: buildOperationalCountMetadata({
        label: 'Stale fulfillment groups',
        source: 'operational_signals.fulfillment_stale_grouped_by_allocation',
        rawCount: input.staleFulfillment.rawCount,
        groupedCount: input.staleFulfillment.groupedCount,
      }),
    },
  };
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
  const automationIssueGroups = countAutomationIssueGroups(automation.alerts, []);
  const normalizedOperationalCounts = buildNormalizedOperationalCounts({
    support: { rawCount: 0, groupedCount: 0 },
    automation: automationIssueGroups,
    finance: countFinanceReviewItems(finance),
    staleFulfillment: countStaleFulfillmentGroups([]),
  });
  const automationIssueGroupCount = normalizedOperationalCounts.groupedAutomationIssueCount ?? 0;

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
      { label: 'Open tickets', value: formatCount(activeReturns + automationIssueGroupCount) },
      { label: 'Pending payouts', value: formatCount(pendingPayouts) },
      { label: 'Vendor checks', value: formatCount(activeOrders) },
    ],
    recentActivity: recentActivity.length > 0 ? recentActivity : [`No recent activity for ${currentVendor.vendorName}.`],
    workspaceStatus: `${currentVendor.vendorName} has ${activeOrders} active orders, ${activeReturns} active returns, and ${automationIssueGroupCount} automation issue groups in flight.`,
    priorityWork: [
      { label: 'Blocked allocations', value: formatCount(automationIssueGroupCount), tone: 'severity-warning' },
      { label: 'Awaiting shipment', value: formatCount(activeOrders), tone: 'severity-attention' },
      { label: 'Refund attention', value: formatCount(activeReturns), tone: 'severity-normal' },
    ],
    normalizedOperationalCounts,
    financeSnapshot: {
      grossSales: finance.summary.grossSales,
      refunds: finance.summary.refunds,
      netRevenue: finance.summary.netRevenue,
      payoutEstimate: finance.summary.payoutEstimate,
    },
  };
}

function buildRealDashboardShellOverview(vendorId?: VendorId): DashboardOverview {
  const currentVendorId = resolveVendorId(vendorId);
  const currentVendor = getCurrentVendorContext();

  return {
    vendorId: currentVendorId,
    vendorName: currentVendor.vendorName,
    title: `${currentVendor.vendorName} command center`,
    description: 'Operational overview is loading.',
    loadPhase: 'initial',
    stats: [],
    recentActivity: [],
    workspaceStatus: 'Dashboard data is loading.',
    priorityWork: [],
  };
}

function createPriorityWork(input: {
  blockedCount: number | null;
  awaitingShipmentCount: number | null;
  refundAttentionCount: number | null;
  automationIssueGroupCount: number;
  blockedValue?: string;
  awaitingShipmentValue?: string;
  refundAttentionValue?: string;
  blockedDescription?: string;
  awaitingShipmentDescription?: string;
  refundAttentionDescription?: string;
}): DashboardPriorityItem[] {
  return [
    {
      label: 'Blocked allocations',
      value: input.blockedValue ?? formatOptionalCount(input.blockedCount),
      tone: hasPositiveCount(input.blockedCount) ? 'severity-warning' : 'severity-normal',
      description: input.blockedDescription ?? (input.blockedCount === null ? 'Blocked allocation count is unavailable.' : input.blockedCount > 0 ? 'Allocations waiting for reassignment or vendor recovery.' : 'No blocked allocations right now.'),
    },
    {
      label: 'Awaiting shipment',
      value: input.awaitingShipmentValue ?? formatOptionalCount(input.awaitingShipmentCount),
      tone: hasPositiveCount(input.awaitingShipmentCount) ? 'severity-attention' : 'severity-normal',
      description: input.awaitingShipmentDescription ?? (input.awaitingShipmentCount === null ? 'Awaiting shipment count is unavailable.' : input.awaitingShipmentCount > 0 ? 'Allocations still waiting for shipment progress.' : 'No allocations are awaiting shipment.'),
    },
    {
      label: 'Refund attention',
      value: input.refundAttentionValue ?? formatOptionalCount(input.refundAttentionCount),
      tone: hasPositiveCount(input.refundAttentionCount) ? 'severity-warning' : 'severity-normal',
      description: input.refundAttentionDescription ?? (input.refundAttentionCount === null ? 'Refund attention count is unavailable.' : input.refundAttentionCount > 0 ? 'Refund records still need review or reconciliation.' : 'No active refund attention items.'),
    },
    {
      label: 'Automation issue groups',
      value: formatCount(input.automationIssueGroupCount),
      tone: input.automationIssueGroupCount > 0 ? 'severity-attention' : 'severity-normal',
      description: input.automationIssueGroupCount > 0 ? 'Grouped automation and rules issues are active for this vendor scope.' : 'No grouped automation issues.',
    },
  ];
}

async function buildRealDashboardInitialOverview(vendorId?: VendorId, options: DashboardRequestOptions = {}): Promise<DashboardOverview> {
  const requestId = options.requestId ?? createDashboardRequestId();
  const totalStartedAt = getDashboardNow();
  let failed = false;
  logDashboardClientTiming({ requestId, step: 'dashboard.route.start', loadPhase: 'initial', durationMs: 0 });

  try {
    const aggregationStartedAt = getDashboardNow();
    const overview = buildRealDashboardShellOverview(vendorId);
    logDashboardClientTiming({
      requestId,
      step: 'dashboard.metrics_aggregation',
      loadPhase: 'initial',
      durationMs: getDashboardNow() - aggregationStartedAt,
    });
    return overview;
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    logDashboardClientTiming({
      requestId,
      step: 'dashboard.route.end',
      loadPhase: 'initial',
      durationMs: getDashboardNow() - totalStartedAt,
      failed,
      thresholdMs: SLOW_DASHBOARD_TOTAL_MS,
    });
  }
}

async function buildRealDashboardDeferredOverview(vendorId?: VendorId, options: DashboardRequestOptions = {}): Promise<DashboardOverview> {
  const requestId = options.requestId ?? createDashboardRequestId();
  const totalStartedAt = getDashboardNow();
  let failed = false;
  logDashboardClientTiming({ requestId, step: 'dashboard.deferred.route.start', loadPhase: 'deferred', durationMs: 0 });

  try {
    const currentVendorId = resolveVendorId(vendorId);
    const currentVendor = getCurrentVendorContext();
    const currentUser = getCurrentUser();
    const dashboardSummaryReadOptions = {
      signal: options.signal,
      headers: createDashboardRequestHeaders(requestId, 'deferred'),
    };
    const dashboardReadOptions = {
      signal: options.signal,
      headers: createDashboardRequestHeaders(requestId, 'deferred'),
      limit: DASHBOARD_DEFERRED_LIST_LIMIT,
      offset: 0,
    };

    const partialDataWarnings: string[] = [];
    const phase1Requests = Promise.allSettled([
      withDashboardClientTiming(requestId, 'client.dashboard.summary', () => runtimeServices.dashboard.summary(currentVendorId, dashboardSummaryReadOptions), 'deferred'),
      withDashboardClientTiming(requestId, 'client.orders.list', () => runtimeServices.orders.list(currentVendorId, dashboardReadOptions), 'deferred'),
      withDashboardClientTiming(requestId, 'client.returns.list', () => runtimeServices.returns.list(currentVendorId, dashboardReadOptions), 'deferred'),
    ] as const);
    const phase2Requests = waitForDashboardDeferredPhase(options.signal, DASHBOARD_DEFERRED_PHASE_2_DELAY_MS)
      .then(() => Promise.allSettled([
        withDashboardClientTiming(requestId, 'client.finance.summary', () => runtimeServices.finance.summary(currentVendorId, dashboardSummaryReadOptions), 'deferred'),
        withDashboardClientTiming(requestId, 'client.automation.dashboard', () => runtimeServices.automation.dashboard(currentVendorId, dashboardReadOptions), 'deferred'),
      ] as const));
    const phase3Requests = waitForDashboardDeferredPhase(options.signal, DASHBOARD_DEFERRED_PHASE_3_DELAY_MS)
      .then(() => Promise.allSettled([
        currentUser?.role === 'admin'
          ? withDashboardClientTiming(requestId, 'client.operations.summary', () => runtimeServices.operations.summary(dashboardSummaryReadOptions), 'deferred')
          : Promise.resolve(null),
        withDashboardClientTiming(requestId, 'client.signals.list', () => runtimeServices.signals.list(currentVendorId, dashboardReadOptions), 'deferred'),
        currentUser?.role === 'admin'
          ? withDashboardClientTiming(requestId, 'client.support.list_admin', () => runtimeServices.support.listAdmin(dashboardReadOptions), 'deferred')
          : withDashboardClientTiming(requestId, 'client.support.list_vendor', () => runtimeServices.support.listVendor(dashboardReadOptions), 'deferred'),
        currentUser?.role === 'admin'
          ? withDashboardClientTiming(requestId, 'client.diagnostics.reconciliation', () =>
              runtimeServices.diagnostics.reconciliation(dashboardReadOptions),
              'deferred',
            )
          : Promise.resolve(null),
        currentUser?.role === 'admin'
          ? withDashboardClientTiming(requestId, 'client.observability.summary', () => runtimeServices.observability.summary(dashboardReadOptions), 'deferred')
          : Promise.resolve(null),
      ] as const));
    const [phase1Results, phase2Results, phase3Results] = await Promise.all([
      phase1Requests,
      phase2Requests,
      phase3Requests,
    ]);
    const dashboardRequests = [...phase1Results, ...phase2Results, ...phase3Results] as const;

    throwDashboardAuthError(dashboardRequests);

    const [
      summaryResult,
      ordersResult,
      returnsResult,
      financeResult,
      automationResult,
      operationsResult,
      signalsResult,
      supportResult,
      diagnosticsResult,
      observabilityResult,
    ] = dashboardRequests;

    const dashboardSummary: DashboardOperationalSummary | null = summaryResult.status === 'fulfilled' ? summaryResult.value : null;
    if (summaryResult.status === 'rejected') {
      partialDataWarnings.push('Dashboard summary counts are temporarily unavailable.');
    }

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
    partialDataWarnings.push('Automation issue groups are temporarily unavailable.');
  }

  const operationsSummary = operationsResult.status === 'fulfilled' ? operationsResult.value : null;
  if (operationsResult.status === 'rejected') {
    partialDataWarnings.push('Operations queue context is temporarily unavailable.');
  }

  const signals = signalsResult.status === 'fulfilled' ? signalsResult.value : null;
  if (signalsResult.status === 'rejected') {
    partialDataWarnings.push('Operational rules signals are temporarily unavailable.');
  }

  const supportTickets = supportResult.status === 'fulfilled' ? supportResult.value : null;
  if (supportResult.status === 'rejected') {
    partialDataWarnings.push('Support issue counts are temporarily unavailable.');
  }

  const diagnostics = diagnosticsResult.status === 'fulfilled' ? diagnosticsResult.value : null;
  if (diagnosticsResult.status === 'rejected') {
    partialDataWarnings.push('Diagnostics summary is temporarily unavailable.');
  }

  const observability = observabilityResult.status === 'fulfilled' ? observabilityResult.value : null;
  if (observabilityResult.status === 'rejected') {
    partialDataWarnings.push('Operational observability is temporarily unavailable.');
  }

  const aggregationStartedAt = getDashboardNow();
  const totalOrderCount = dashboardSummary?.orders.total ?? null;
  const awaitingShipmentCount = dashboardSummary?.orders.awaitingShipment ?? null;
  const blockedCount = dashboardSummary?.orders.blocked ?? null;
  const activeRefundCount = dashboardSummary?.returns.refundAttention ?? null;
  const blockedAndAttentionCount =
    blockedCount === null || activeRefundCount === null
      ? null
      : blockedCount + activeRefundCount;
  const automationIssueGroups = countAutomationIssueGroups(automation?.alerts ?? [], signals?.signals ?? []);
  const normalizedOperationalCounts = buildNormalizedOperationalCounts({
    support: supportTickets ? countOpenSupportIssues(supportTickets, currentVendorId) : { rawCount: null, groupedCount: null },
    automation: automationIssueGroups,
    finance: { rawCount: null, groupedCount: null },
    staleFulfillment: countStaleFulfillmentGroups(signals?.signals),
  });
  const automationIssueGroupCount = normalizedOperationalCounts.groupedAutomationIssueCount ?? 0;
  const payoutEstimate = finance?.summary.payoutEstimate ?? '—';
  const operationsTotal = operationsSummary?.total ?? null;
  const blockedSummaryDescription = dashboardSummary
    ? 'Full blocked count comes from dashboard summary.'
    : 'Full blocked count is temporarily unavailable.';
  const awaitingShipmentSummaryDescription = dashboardSummary
    ? 'Full shipment queue count comes from dashboard summary.'
    : 'Full shipment queue count is temporarily unavailable.';
  const refundAttentionSummaryDescription = dashboardSummary
    ? 'Full return/refund attention count comes from dashboard summary.'
    : 'Full return/refund attention count is temporarily unavailable.';

  const priorityWork = createPriorityWork({
    blockedCount,
    awaitingShipmentCount,
    refundAttentionCount: activeRefundCount,
    automationIssueGroupCount,
    blockedDescription: `${formatRecentListDescription(orders.length, 'order allocation')} ${blockedSummaryDescription}`,
    awaitingShipmentDescription: `${formatRecentListDescription(orders.length, 'order allocation')} ${awaitingShipmentSummaryDescription}`,
    refundAttentionDescription: `${formatRecentListDescription(returns.length, 'return record')} ${refundAttentionSummaryDescription}`,
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

  let workspaceStatus = dashboardSummary
    ? `${currentVendor.vendorName} has ${totalOrderCount} vendor allocation${totalOrderCount === 1 ? '' : 's'}, ${awaitingShipmentCount} awaiting shipment, ${blockedCount} blocked, ${activeRefundCount} return/refund attention item${activeRefundCount === 1 ? '' : 's'}, and ${automationIssueGroupCount} grouped automation/rules issues. ${formatRecentListDescription(orders.length, 'order allocation')} ${formatRecentListDescription(returns.length, 'return record')}`
    : `${currentVendor.vendorName} dashboard summary counts are unavailable; ${formatRecentListDescription(orders.length, 'order allocation')} ${formatRecentListDescription(returns.length, 'return record')}`;
  if (currentUser?.role === 'admin' && operationsSummary) {
    workspaceStatus = `${workspaceStatus} Admin queue currently tracks ${operationsTotal} operational item${operationsTotal === 1 ? '' : 's'} for the selected vendor scope.`;
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
  logDashboardClientTiming({
    requestId,
    step: 'dashboard.metrics_aggregation',
    loadPhase: 'deferred',
    durationMs: getDashboardNow() - aggregationStartedAt,
  });

  return {
    vendorId: currentVendorId,
    vendorName: currentVendor.vendorName,
    title: `${currentVendor.vendorName} command center`,
    description: `Monitor backend-derived operational state for ${currentVendor.vendorName} from one workspace.`,
    loadPhase: 'deferred',
    stats: [
      { label: 'Vendor orders', value: formatOptionalCount(totalOrderCount) },
      { label: 'Awaiting shipment', value: formatOptionalCount(awaitingShipmentCount) },
      { label: 'Blocked / attention', value: formatOptionalCount(blockedAndAttentionCount) },
      { label: 'Payout estimate', value: payoutEstimate },
      { label: 'Refund amount', value: finance?.summary.refunds ?? '—' },
    ],
    recentActivity: recentActivity.length > 0 ? recentActivity : [`No recent backend activity for ${currentVendor.vendorName}.`],
    workspaceStatus,
    priorityWork,
    normalizedOperationalCounts,
    financeSnapshot,
    diagnosticsSummary,
    observabilitySummary,
    partialDataWarnings,
  };
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    logDashboardClientTiming({
      requestId,
      step: 'dashboard.deferred.route.end',
      loadPhase: 'deferred',
      durationMs: getDashboardNow() - totalStartedAt,
      failed,
      thresholdMs: SLOW_DASHBOARD_TOTAL_MS,
    });
  }
}

export function buildDashboardOverview(vendorId?: VendorId): DashboardOverview {
  return buildMockDashboardOverview(vendorId);
}

export async function getDashboardOverview(vendorId?: VendorId, options: DashboardRequestOptions = {}): Promise<DashboardOverview> {
  if (runtimeConfig.apiMode === 'real') {
    return buildRealDashboardInitialOverview(vendorId, options);
  }

  return buildMockDashboardOverview(vendorId);
}

export async function getDashboardDeferredOverview(vendorId?: VendorId, options: DashboardRequestOptions = {}): Promise<DashboardOverview> {
  if (runtimeConfig.apiMode === 'real') {
    return buildRealDashboardDeferredOverview(vendorId, options);
  }

  return buildMockDashboardOverview(vendorId);
}
