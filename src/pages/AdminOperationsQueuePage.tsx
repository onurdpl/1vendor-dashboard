import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  EmptyStatePanel,
  KPIStatCard,
  OperationalActionGroup,
  OperationalTable,
  OperationalTableRow,
  SectionErrorRetry,
  SectionSkeleton,
  StatusBadge,
} from '../components/OperationalPrimitives';
import { OperationalRecommendations } from '../components/OperationalRecommendations';
import { useQueryResource } from '../hooks/useQueryResource';
import { useAppReadiness } from '../lib/appReadiness';
import { getPageReadinessState } from '../lib/pageReadiness';
import { queryKeys } from '../lib/api/queryKeys';
import { runtimeServices } from '../services/runtime-services';
import type {
  OperationsActivity,
  OperationsAttentionItem,
  OperationsAttentionSeverity,
  OperationsAttentionType,
  OperationsQueueItem,
  OperationsVendorRisk,
  SupportAttentionTicket,
} from '../lib/api/contracts';
import { formatDateTime, safeArray, safeStatusLabel } from '../services/real/formatting';

const AUTHORITATIVE_OPERATIONS_TABLE_PAGE_SIZE = 10;
const VENDOR_BLOCKED_QUEUE_PAGE_SIZE = AUTHORITATIVE_OPERATIONS_TABLE_PAGE_SIZE;
const SHIPMENT_QUEUE_PAGE_SIZE = AUTHORITATIVE_OPERATIONS_TABLE_PAGE_SIZE;
const RETURN_REVIEW_QUEUE_PAGE_SIZE = AUTHORITATIVE_OPERATIONS_TABLE_PAGE_SIZE;
const FINANCE_REVIEW_QUEUE_PAGE_SIZE = AUTHORITATIVE_OPERATIONS_TABLE_PAGE_SIZE;
const FINANCE_INTEGRITY_QUEUE_PAGE_SIZE = AUTHORITATIVE_OPERATIONS_TABLE_PAGE_SIZE;
const SUPPORT_ATTENTION_PAGE_SIZE = AUTHORITATIVE_OPERATIONS_TABLE_PAGE_SIZE;

function formatDate(value: string) {
  return formatDateTime(value, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatAge(hours: number) {
  if (!Number.isFinite(hours)) {
    return '—';
  }
  if (hours < 1) {
    return '<1h';
  }
  if (hours < 24) {
    return `${Math.round(hours)}h`;
  }
  return `${Math.round(hours / 24)}d`;
}

function formatType(value: OperationsAttentionType) {
  if (value === 'vendor_blocked') {
    return 'Vendor blocked';
  }
  if (value === 'vendor_risk') {
    return 'Vendor risk';
  }
  if (value === 'operational_signal') {
    return 'Operational signal';
  }
  return safeStatusLabel(value);
}

function getSeverityTone(severity: OperationsAttentionSeverity) {
  if (severity === 'critical') {
    return 'danger' as const;
  }
  if (severity === 'warning') {
    return 'warning' as const;
  }
  return 'info' as const;
}

function getRiskTone(risk: OperationsVendorRisk) {
  return getSeverityTone(risk.riskLevel);
}

function getSectionTone(item: OperationsAttentionItem) {
  return getSeverityTone(item.severity);
}

function getActivityTone(item: OperationsActivity) {
  return getSeverityTone(item.severity);
}

function actionLink(destinationPath: string | null, label: string) {
  return destinationPath ? (
    <Link className="button button-secondary button-link button-compact" to={destinationPath}>
      {label}
    </Link>
  ) : (
    <span className="queue-muted-action">No link</span>
  );
}

function getAttentionDestinationPath(item: OperationsAttentionItem) {
  if (item.type === 'vendor_blocked' && item.sourceShopifyOrderId) {
    return `/admin/orders/${item.sourceShopifyOrderId}`;
  }

  return item.destinationPath;
}

function attentionLink(item: OperationsAttentionItem, label: string) {
  return actionLink(getAttentionDestinationPath(item), label);
}

function getActionLabel(item: OperationsAttentionItem) {
  const destinationPath = getAttentionDestinationPath(item);

  if (item.type === 'vendor_blocked' && destinationPath?.startsWith('/admin/orders/')) {
    return 'Open order';
  }
  if (item.type === 'support' && destinationPath?.startsWith('/admin/support/')) {
    return 'Open ticket';
  }
  if (item.type === 'finance') {
    return 'Review finance';
  }
  if (item.type === 'return') {
    return 'Open return';
  }
  if (item.type === 'shipment' && destinationPath?.includes('/orders/')) {
    return 'Open order';
  }
  if (item.type === 'operational_signal') {
    return destinationPath?.startsWith('/admin/orders/') ? 'Open order' : 'Review signal';
  }
  if (item.type === 'automation') {
    return 'Review action';
  }

  return 'Open';
}

function getPreviewLabel(visibleCount: number, activeCount: number, noun = 'active') {
  if (activeCount <= 0) {
    return `0 ${noun}`;
  }

  return `Showing ${Math.min(visibleCount, activeCount)} of ${activeCount} ${noun}`;
}

function formatQueueType(value: OperationsQueueItem['type']) {
  if (value === 'pending_reassignment') {
    return 'Pending reassignment';
  }
  if (value === 'vendor_blocked') {
    return 'Vendor blocked';
  }
  if (value === 'awaiting_shipment') {
    return 'Awaiting shipment';
  }
  if (value === 'refund_attention') {
    return 'Refund attention';
  }
  if (value === 'finance_review') {
    return 'Finance review';
  }
  if (value === 'finance_integrity_alert') {
    return 'Finance integrity';
  }
  if (value === 'operational_signal') {
    return 'Operational signal';
  }
  return 'Automation action';
}

function getQueueSeverityTone(severity: OperationsQueueItem['severity']) {
  if (severity === 'critical') {
    return 'danger' as const;
  }
  if (severity === 'high') {
    return 'warning' as const;
  }
  if (severity === 'medium') {
    return 'attention' as const;
  }
  return 'info' as const;
}

function getQueueItemReference(item: OperationsQueueItem) {
  const orderNumber = item.relatedShopifyOrderNumber?.trim();
  if (orderNumber) {
    return orderNumber.startsWith('#') ? `Order ${orderNumber}` : `Order #${orderNumber}`;
  }
  if (item.relatedShopifyOrderId) {
    return `Shopify order ${item.relatedShopifyOrderId}`;
  }
  if (item.relatedOrderId) {
    return `Allocation ${item.relatedOrderId}`;
  }
  return item.id;
}

function getQueueAdminOrderPath(item: OperationsQueueItem) {
  return item.relatedShopifyOrderId ? `/admin/orders/${item.relatedShopifyOrderId}` : null;
}

function getFinanceIntegrityAlertReference(item: OperationsQueueItem) {
  const alertId = item.financeIntegrityAlertId?.trim();
  return alertId || item.id;
}

function getFinanceIntegrityOrderReference(item: OperationsQueueItem) {
  const orderNumber = item.relatedShopifyOrderNumber?.trim();
  if (orderNumber) {
    return orderNumber.startsWith('#') ? `Order ${orderNumber}` : `Order #${orderNumber}`;
  }
  if (item.relatedShopifyOrderId) {
    return `Shopify order ${item.relatedShopifyOrderId}`;
  }
  return 'No order link';
}

function getFinanceReviewReason(item: OperationsQueueItem) {
  return item.financeReviewReason?.trim() || item.description || 'Finance row requires admin review.';
}

function getFinanceReviewAmount(item: OperationsQueueItem) {
  const amount = item.financeReviewAmount?.trim();
  if (!amount) {
    return '—';
  }

  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount)) {
    return amount;
  }

  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(numericAmount);
}

function joinPresentParts(...parts: Array<string | null | undefined>) {
  const presentParts: string[] = [];
  parts.forEach((part) => {
    if (part) {
      presentParts.push(part);
    }
  });
  return presentParts.join(' · ');
}

function getSupportOrderReference(ticket: SupportAttentionTicket) {
  return ticket.relatedOrderReference ?? (ticket.contextType === 'order' ? ticket.contextId : null);
}

function getSupportSlaLabel(ticket: SupportAttentionTicket) {
  if (ticket.sla.dueLabel) {
    return ticket.sla.dueLabel;
  }
  return `Waiting since ${formatDate(ticket.waitingSince)}`;
}

export function AdminOperationsQueuePage() {
  const [vendorBlockedQueueOffset, setVendorBlockedQueueOffset] = useState(0);
  const [shipmentQueueOffset, setShipmentQueueOffset] = useState(0);
  const [returnReviewQueueOffset, setReturnReviewQueueOffset] = useState(0);
  const [financeReviewQueueOffset, setFinanceReviewQueueOffset] = useState(0);
  const [financeIntegrityQueueOffset, setFinanceIntegrityQueueOffset] = useState(0);
  const [supportAttentionOffset, setSupportAttentionOffset] = useState(0);
  const appReadiness = useAppReadiness();
  const pageReadiness = getPageReadinessState(appReadiness, {
    requiresVendorContext: false,
  });
  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
    hasBackgroundError,
    isFetching,
  } = useQueryResource(
    queryKeys.admin.operations.attention(),
    ({ signal }) => runtimeServices.operations.attention({ signal }),
    {
      enabled: pageReadiness.ready,
      routeName: 'AdminOperationsQueuePage',
      endpoint: '/admin/operations/attention',
    },
  );
  const {
    data: shipmentQueueDashboard,
    isLoading: isShipmentQueueLoading,
    isFetching: isShipmentQueueFetching,
    isError: isShipmentQueueError,
    error: shipmentQueueError,
    refetch: refetchShipmentQueue,
  } = useQueryResource(
    queryKeys.admin.operations.queuePage(SHIPMENT_QUEUE_PAGE_SIZE, shipmentQueueOffset, 'awaiting_shipment'),
    ({ signal }) =>
      runtimeServices.operations.dashboard({
        signal,
        limit: SHIPMENT_QUEUE_PAGE_SIZE,
        offset: shipmentQueueOffset,
        type: 'awaiting_shipment',
      }),
    {
      enabled: pageReadiness.ready,
      routeName: 'AdminOperationsQueuePage',
      endpoint: '/admin/operations',
    },
  );
  const {
    data: vendorBlockedQueueDashboard,
    isLoading: isVendorBlockedQueueLoading,
    isFetching: isVendorBlockedQueueFetching,
    isError: isVendorBlockedQueueError,
    error: vendorBlockedQueueError,
    refetch: refetchVendorBlockedQueue,
  } = useQueryResource(
    queryKeys.admin.operations.queuePage(VENDOR_BLOCKED_QUEUE_PAGE_SIZE, vendorBlockedQueueOffset, 'vendor_blocked'),
    ({ signal }) =>
      runtimeServices.operations.dashboard({
        signal,
        limit: VENDOR_BLOCKED_QUEUE_PAGE_SIZE,
        offset: vendorBlockedQueueOffset,
        type: 'vendor_blocked',
      }),
    {
      enabled: pageReadiness.ready,
      routeName: 'AdminOperationsQueuePage',
      endpoint: '/admin/operations',
    },
  );
  const {
    data: returnReviewQueueDashboard,
    isLoading: isReturnReviewQueueLoading,
    isFetching: isReturnReviewQueueFetching,
    isError: isReturnReviewQueueError,
    error: returnReviewQueueError,
    refetch: refetchReturnReviewQueue,
  } = useQueryResource(
    queryKeys.admin.operations.queuePage(RETURN_REVIEW_QUEUE_PAGE_SIZE, returnReviewQueueOffset, 'return_review'),
    ({ signal }) =>
      runtimeServices.operations.dashboard({
        signal,
        limit: RETURN_REVIEW_QUEUE_PAGE_SIZE,
        offset: returnReviewQueueOffset,
        type: 'return_review',
      }),
    {
      enabled: pageReadiness.ready,
      routeName: 'AdminOperationsQueuePage',
      endpoint: '/admin/operations',
    },
  );
  const {
    data: financeReviewQueueDashboard,
    isLoading: isFinanceReviewQueueLoading,
    isFetching: isFinanceReviewQueueFetching,
    isError: isFinanceReviewQueueError,
    error: financeReviewQueueError,
    refetch: refetchFinanceReviewQueue,
  } = useQueryResource(
    queryKeys.admin.operations.queuePage(FINANCE_REVIEW_QUEUE_PAGE_SIZE, financeReviewQueueOffset, 'finance_review'),
    ({ signal }) =>
      runtimeServices.operations.dashboard({
        signal,
        limit: FINANCE_REVIEW_QUEUE_PAGE_SIZE,
        offset: financeReviewQueueOffset,
        type: 'finance_review',
      }),
    {
      enabled: pageReadiness.ready,
      routeName: 'AdminOperationsQueuePage',
      endpoint: '/admin/operations',
    },
  );
  const {
    data: financeIntegrityQueueDashboard,
    isLoading: isFinanceIntegrityQueueLoading,
    isFetching: isFinanceIntegrityQueueFetching,
    isError: isFinanceIntegrityQueueError,
    error: financeIntegrityQueueError,
    refetch: refetchFinanceIntegrityQueue,
  } = useQueryResource(
    queryKeys.admin.operations.queuePage(FINANCE_INTEGRITY_QUEUE_PAGE_SIZE, financeIntegrityQueueOffset, 'finance_integrity_alert'),
    ({ signal }) =>
      runtimeServices.operations.dashboard({
        signal,
        limit: FINANCE_INTEGRITY_QUEUE_PAGE_SIZE,
        offset: financeIntegrityQueueOffset,
        type: 'finance_integrity_alert',
      }),
    {
      enabled: pageReadiness.ready,
      routeName: 'AdminOperationsQueuePage',
      endpoint: '/admin/operations',
    },
  );
  const {
    data: supportAttentionPage,
    isLoading: isSupportAttentionLoading,
    isFetching: isSupportAttentionFetching,
    isError: isSupportAttentionError,
    error: supportAttentionError,
    refetch: refetchSupportAttention,
  } = useQueryResource(
    queryKeys.admin.support.attentionTickets(SUPPORT_ATTENTION_PAGE_SIZE, supportAttentionOffset),
    ({ signal }) =>
      runtimeServices.support.listAdminAttention({
        signal,
        limit: SUPPORT_ATTENTION_PAGE_SIZE,
        offset: supportAttentionOffset,
      }),
    {
      enabled: pageReadiness.ready,
      routeName: 'AdminOperationsQueuePage',
      endpoint: '/admin/support/tickets?attention=true',
    },
  );

  const dataView = data ?? {
    generatedAt: new Date().toISOString(),
    summary: {
      total: 0,
      critical: 0,
      warning: 0,
      overdueSupport: 0,
      shipmentIssues: 0,
      returnBacklog: 0,
      financeReview: 0,
      vendorBlocked: 0,
    },
    recommendations: [],
    queue: [],
    sections: [],
    vendorRisks: [],
    recentActivity: [],
  };
  const recommendations = safeArray(dataView.recommendations);
  const queue = safeArray(dataView.queue);
  const sections = safeArray(dataView.sections);
  const displaySections = sections.filter(
    (section) =>
      section.key !== 'support' &&
      section.key !== 'vendor_blocked' &&
      section.key !== 'shipment' &&
      section.key !== 'return' &&
      section.key !== 'finance',
  );
  const vendorRisks = safeArray(dataView.vendorRisks);
  const recentActivity = safeArray(dataView.recentActivity);
  const supportAttentionItems = safeArray(supportAttentionPage?.items);
  const totalSupportAttentionRows = supportAttentionPage?.total ?? 0;
  const supportPageStart = totalSupportAttentionRows > 0 ? supportAttentionOffset + 1 : 0;
  const supportPageEnd = Math.min(supportAttentionOffset + SUPPORT_ATTENTION_PAGE_SIZE, totalSupportAttentionRows);
  const canPageSupportBack = supportAttentionOffset > 0;
  const canPageSupportForward = supportAttentionOffset + SUPPORT_ATTENTION_PAGE_SIZE < totalSupportAttentionRows;
  const paginatedQueueItems = safeArray(vendorBlockedQueueDashboard?.items);
  const totalPaginatedQueueRows = vendorBlockedQueueDashboard?.summary.total ?? 0;
  const queuePageStart = totalPaginatedQueueRows > 0 ? vendorBlockedQueueOffset + 1 : 0;
  const queuePageEnd = Math.min(vendorBlockedQueueOffset + VENDOR_BLOCKED_QUEUE_PAGE_SIZE, totalPaginatedQueueRows);
  const canPageVendorBlockedBack = vendorBlockedQueueOffset > 0;
  const canPageVendorBlockedForward = vendorBlockedQueueOffset + VENDOR_BLOCKED_QUEUE_PAGE_SIZE < totalPaginatedQueueRows;
  const shipmentQueueItems = safeArray(shipmentQueueDashboard?.items);
  const totalShipmentQueueRows = shipmentQueueDashboard?.summary.total ?? 0;
  const shipmentPageStart = totalShipmentQueueRows > 0 ? shipmentQueueOffset + 1 : 0;
  const shipmentPageEnd = Math.min(shipmentQueueOffset + SHIPMENT_QUEUE_PAGE_SIZE, totalShipmentQueueRows);
  const canPageShipmentBack = shipmentQueueOffset > 0;
  const canPageShipmentForward = shipmentQueueOffset + SHIPMENT_QUEUE_PAGE_SIZE < totalShipmentQueueRows;
  const returnReviewQueueItems = safeArray(returnReviewQueueDashboard?.items);
  const totalReturnReviewQueueRows = returnReviewQueueDashboard?.summary.total ?? 0;
  const returnReviewPageStart = totalReturnReviewQueueRows > 0 ? returnReviewQueueOffset + 1 : 0;
  const returnReviewPageEnd = Math.min(returnReviewQueueOffset + RETURN_REVIEW_QUEUE_PAGE_SIZE, totalReturnReviewQueueRows);
  const canPageReturnReviewBack = returnReviewQueueOffset > 0;
  const canPageReturnReviewForward = returnReviewQueueOffset + RETURN_REVIEW_QUEUE_PAGE_SIZE < totalReturnReviewQueueRows;
  const financeReviewQueueItems = safeArray(financeReviewQueueDashboard?.items);
  const totalFinanceReviewQueueRows = financeReviewQueueDashboard?.summary.total ?? 0;
  const financeReviewPageStart = totalFinanceReviewQueueRows > 0 ? financeReviewQueueOffset + 1 : 0;
  const financeReviewPageEnd = Math.min(financeReviewQueueOffset + FINANCE_REVIEW_QUEUE_PAGE_SIZE, totalFinanceReviewQueueRows);
  const canPageFinanceReviewBack = financeReviewQueueOffset > 0;
  const canPageFinanceReviewForward = financeReviewQueueOffset + FINANCE_REVIEW_QUEUE_PAGE_SIZE < totalFinanceReviewQueueRows;
  const financeIntegrityQueueItems = safeArray(financeIntegrityQueueDashboard?.items);
  const totalFinanceIntegrityQueueRows = financeIntegrityQueueDashboard?.summary.total ?? 0;
  const financeIntegrityPageStart = totalFinanceIntegrityQueueRows > 0 ? financeIntegrityQueueOffset + 1 : 0;
  const financeIntegrityPageEnd = Math.min(
    financeIntegrityQueueOffset + FINANCE_INTEGRITY_QUEUE_PAGE_SIZE,
    totalFinanceIntegrityQueueRows,
  );
  const canPageFinanceIntegrityBack = financeIntegrityQueueOffset > 0;
  const canPageFinanceIntegrityForward =
    financeIntegrityQueueOffset + FINANCE_INTEGRITY_QUEUE_PAGE_SIZE < totalFinanceIntegrityQueueRows;

  useEffect(() => {
    if (!shipmentQueueDashboard || shipmentQueueOffset === 0 || shipmentQueueOffset < totalShipmentQueueRows) {
      return;
    }

    const lastPageOffset = Math.max(
      0,
      Math.floor((Math.max(totalShipmentQueueRows, 1) - 1) / SHIPMENT_QUEUE_PAGE_SIZE) * SHIPMENT_QUEUE_PAGE_SIZE,
    );
    setShipmentQueueOffset(lastPageOffset);
  }, [shipmentQueueDashboard, shipmentQueueOffset, totalShipmentQueueRows]);

  useEffect(() => {
    if (!returnReviewQueueDashboard || returnReviewQueueOffset === 0 || returnReviewQueueOffset < totalReturnReviewQueueRows) {
      return;
    }

    const lastPageOffset = Math.max(
      0,
      Math.floor((Math.max(totalReturnReviewQueueRows, 1) - 1) / RETURN_REVIEW_QUEUE_PAGE_SIZE) * RETURN_REVIEW_QUEUE_PAGE_SIZE,
    );
    setReturnReviewQueueOffset(lastPageOffset);
  }, [returnReviewQueueDashboard, returnReviewQueueOffset, totalReturnReviewQueueRows]);

  useEffect(() => {
    if (!financeReviewQueueDashboard || financeReviewQueueOffset === 0 || financeReviewQueueOffset < totalFinanceReviewQueueRows) {
      return;
    }

    const lastPageOffset = Math.max(
      0,
      Math.floor((Math.max(totalFinanceReviewQueueRows, 1) - 1) / FINANCE_REVIEW_QUEUE_PAGE_SIZE) * FINANCE_REVIEW_QUEUE_PAGE_SIZE,
    );
    setFinanceReviewQueueOffset(lastPageOffset);
  }, [financeReviewQueueDashboard, financeReviewQueueOffset, totalFinanceReviewQueueRows]);

  useEffect(() => {
    if (
      !financeIntegrityQueueDashboard ||
      financeIntegrityQueueOffset === 0 ||
      financeIntegrityQueueOffset < totalFinanceIntegrityQueueRows
    ) {
      return;
    }

    const lastPageOffset = Math.max(
      0,
      Math.floor((Math.max(totalFinanceIntegrityQueueRows, 1) - 1) / FINANCE_INTEGRITY_QUEUE_PAGE_SIZE) *
        FINANCE_INTEGRITY_QUEUE_PAGE_SIZE,
    );
    setFinanceIntegrityQueueOffset(lastPageOffset);
  }, [financeIntegrityQueueDashboard, financeIntegrityQueueOffset, totalFinanceIntegrityQueueRows]);

  return (
    <section className="op-page operations-control-center attention-center-page">
      <div className="op-page-heading">
        <div>
          <p className="eyebrow">Admin operations</p>
          <h2>Operational attention center</h2>
          <p className="page-description">
            Unified cockpit for generated shipment, support, return, finance, and vendor attention rows.
          </p>
        </div>
        <div className="op-heading-meta">
          <StatusBadge tone="danger">Critical {dataView.summary.critical}</StatusBadge>
          <StatusBadge tone="warning">Warning {dataView.summary.warning}</StatusBadge>
          <StatusBadge tone="info">Generated {formatDate(dataView.generatedAt)}</StatusBadge>
          <button
            type="button"
            className="button button-secondary button-link button-compact"
            onClick={() => void refetch()}
            disabled={isFetching}
          >
            {isFetching ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      <div className="op-kpi-row attention-kpi-row">
        <KPIStatCard label="Total attention" value={dataView.summary.total} detail="Generated rows" tone="info" />
        <KPIStatCard label="Critical" value={dataView.summary.critical} detail="Highest priority" tone="danger" />
        <KPIStatCard label="Critical support" value={dataView.summary.overdueSupport} detail="SLA or priority" tone="warning" />
        <KPIStatCard label="Shipment issues" value={dataView.summary.shipmentIssues} detail="Tracking or carrier state" tone="attention" />
        <KPIStatCard label="Vendor blocked" value={dataView.summary.vendorBlocked} detail="Rejected allocations" tone="warning" />
        <KPIStatCard label="Return backlog" value={dataView.summary.returnBacklog} detail="Waiting review" tone="info" />
        <KPIStatCard label="Finance review" value={dataView.summary.financeReview} detail="Payout or invoice attention" tone="warning" />
      </div>
      {hasBackgroundError && data ? (
        <div className="attention-stale-warning" role="status">
          <span>Could not refresh. Showing latest available data generated {formatDate(dataView.generatedAt)}.</span>
          <button type="button" className="button button-secondary button-link button-compact" onClick={() => void refetch()}>
            Retry
          </button>
        </div>
      ) : null}
      {isError && !data ? (
        <SectionErrorRetry
          title="Attention center unavailable"
          description={error ?? 'Operational attention signals could not be loaded.'}
          onRetry={() => void refetch()}
        />
      ) : pageReadiness.status === 'unauthorized' ? (
        <SectionErrorRetry
          title="Sign in required"
          description="An authenticated admin session is required to load the attention center."
          onRetry={() => void refetch()}
        />
      ) : isLoading ? (
        <SectionSkeleton
          title="Loading attention center"
          description="Deriving operational signals from orders, returns, finance, shipments, and support."
        />
      ) : null}

      <div className="attention-layout">
        <main className="attention-main-column">
          <OperationalRecommendations
            title="Recommended actions"
            subtitle={`Preview of ${recommendations.length} generated recommendations.`}
            recommendations={recommendations}
            audience="admin"
            emptyMessage="No operational recommendations right now."
          />

          <article className="attention-card" id="operations-unified-queue">
            <div className="attention-card-heading">
              <div>
                <p className="eyebrow">Critical queue</p>
                <h3>Unified attention queue</h3>
                <span>Preview of generated attention rows sorted by severity and unresolved age.</span>
              </div>
            </div>
            {queue.length ? (
              <OperationalTable
                columns={['Severity', 'Type', 'Vendor', 'Reference', 'Age', 'Recommended action', 'Action']}
                className="attention-op-table"
              >
	                {queue.map((item) => (
	                  <OperationalTableRow key={item.id}>
	                    <span className="attention-queue-severity">
	                      <StatusBadge tone={getSeverityTone(item.severity)}>{item.severity}</StatusBadge>
	                    </span>
	                    <span className="attention-queue-type" title={`${formatType(item.type)} · ${item.title}`}>
	                      <strong>{formatType(item.type)}</strong>
	                      <small>{item.title}</small>
	                      <small>{item.description}</small>
	                    </span>
	                    <span className="attention-queue-vendor" title={`${item.vendorName} · ${item.vendorId}`}>
	                      <strong>{item.vendorName}</strong>
	                      <small>{item.vendorId}</small>
	                    </span>
	                    <span className="attention-queue-reference" title={`${item.objectReference} · ${item.status}`}>
	                      <strong>{item.objectReference}</strong>
	                      <small>{item.status}</small>
	                    </span>
	                    <strong className="attention-queue-age">{formatAge(item.ageHours)}</strong>
	                    <span className="attention-queue-action-copy" title={item.recommendedAction}>{item.recommendedAction}</span>
	                    <OperationalActionGroup>
	                      {attentionLink(item, getActionLabel(item))}
	                    </OperationalActionGroup>
	                  </OperationalTableRow>
                ))}
              </OperationalTable>
            ) : (
              <EmptyStatePanel title="No active attention items" description="Current operational queues are clear." />
            )}
          </article>

          <div className="attention-sections-stack">
            <article className="attention-card support-attention-full-list" id="support-attention-full-list">
              <div className="attention-card-heading">
                <div>
                  <p className="eyebrow">Support</p>
                  <h3>Support attention</h3>
                  <span>
                    Authoritative unresolved support tickets · {supportPageStart}-{supportPageEnd} of {totalSupportAttentionRows}
                  </span>
                </div>
              </div>

              <div className="vendor-blocked-page-controls support-attention-page-controls">
                <span>
                  Support rows {supportPageStart}-{supportPageEnd} of {totalSupportAttentionRows}
                </span>
                <button
                  type="button"
                  className="button button-secondary button-link button-compact"
                  onClick={() => setSupportAttentionOffset(Math.max(0, supportAttentionOffset - SUPPORT_ATTENTION_PAGE_SIZE))}
                  disabled={!canPageSupportBack}
                >
                  Previous
                </button>
                <button
                  type="button"
                  className="button button-secondary button-link button-compact"
                  onClick={() => setSupportAttentionOffset(supportAttentionOffset + SUPPORT_ATTENTION_PAGE_SIZE)}
                  disabled={!canPageSupportForward}
                >
                  Next
                </button>
              </div>

              {isSupportAttentionError ? (
                <SectionErrorRetry
                  title="Support attention unavailable"
                  description={supportAttentionError ?? 'The paginated support attention table could not be loaded.'}
                  onRetry={() => void refetchSupportAttention()}
                />
              ) : isSupportAttentionLoading || isSupportAttentionFetching ? (
                <SectionSkeleton
                  title="Loading support attention"
                  description="Fetching unresolved support tickets with server-side pagination."
                />
              ) : supportAttentionItems.length ? (
                <OperationalTable
                  columns={['Severity', 'Ticket', 'Vendor', 'Order', 'Status', 'SLA / Waiting', 'Age', 'Action']}
                  className="support-attention-table"
                >
                  {supportAttentionItems.map((ticket) => (
                    <OperationalTableRow key={ticket.id}>
                      <span>
                        <StatusBadge tone={getSeverityTone(ticket.severity)}>{ticket.severity}</StatusBadge>
                      </span>
                      <span title={`${ticket.ticketReference} · ${ticket.subject}`}>
                        <strong>{ticket.subject}</strong>
                        <small>{ticket.ticketReference}</small>
                      </span>
                      <span title={`${ticket.vendorName ?? ticket.vendorId} · ${ticket.vendorId}`}>
                        <strong>{ticket.vendorName ?? ticket.vendorId}</strong>
                        <small>{ticket.vendorId}</small>
                      </span>
                      <span>
                        <strong>{getSupportOrderReference(ticket) ?? 'No order link'}</strong>
                        <small>{safeStatusLabel(ticket.contextType)}</small>
                      </span>
                      <span>
                        <strong>{safeStatusLabel(ticket.status)}</strong>
                        <small>{safeStatusLabel(ticket.priority)} · {safeStatusLabel(ticket.category)}</small>
                      </span>
                      <span title={getSupportSlaLabel(ticket)}>
                        <strong>{ticket.sla.escalationLevel === 'none' ? 'SLA active' : safeStatusLabel(ticket.sla.escalationLevel)}</strong>
                        <small>{getSupportSlaLabel(ticket)}</small>
                      </span>
                      <strong>{formatAge(ticket.ageHours)}</strong>
                      <OperationalActionGroup>
                        {actionLink(ticket.destinationPath, 'Open ticket')}
                      </OperationalActionGroup>
                    </OperationalTableRow>
                  ))}
                </OperationalTable>
              ) : (
                <EmptyStatePanel title="No support attention tickets" description="No unresolved support tickets need operator attention." />
              )}
            </article>

            <article className="attention-card vendor-blocked-attention-list" id="vendor-blocked-attention-list">
              <div className="attention-card-heading">
                <div>
                  <p className="eyebrow">Vendor blocked</p>
                  <h3>Vendor Blocked Allocations</h3>
                  <span>
                    Authoritative vendor-blocked allocations · {queuePageStart}-{queuePageEnd} of {totalPaginatedQueueRows}
                  </span>
                </div>
              </div>

              <div className="vendor-blocked-page-controls">
                <span>
                  Vendor Blocked rows {queuePageStart}-{queuePageEnd} of {totalPaginatedQueueRows}
                </span>
                <button
                  type="button"
                  className="button button-secondary button-link button-compact"
                  onClick={() => setVendorBlockedQueueOffset(Math.max(0, vendorBlockedQueueOffset - VENDOR_BLOCKED_QUEUE_PAGE_SIZE))}
                  disabled={!canPageVendorBlockedBack}
                >
                  Previous
                </button>
                <button
                  type="button"
                  className="button button-secondary button-link button-compact"
                  onClick={() => setVendorBlockedQueueOffset(vendorBlockedQueueOffset + VENDOR_BLOCKED_QUEUE_PAGE_SIZE)}
                  disabled={!canPageVendorBlockedForward}
                >
                  Next
                </button>
              </div>

              {isVendorBlockedQueueError ? (
                <SectionErrorRetry
                  title="Vendor-blocked allocations unavailable"
                  description={vendorBlockedQueueError ?? 'The paginated vendor-blocked allocation table could not be loaded.'}
                  onRetry={() => void refetchVendorBlockedQueue()}
                />
              ) : isVendorBlockedQueueLoading || isVendorBlockedQueueFetching ? (
                <SectionSkeleton
                  title="Loading vendor-blocked allocations"
                  description="Fetching vendor-blocked allocations with server-side pagination."
                />
              ) : paginatedQueueItems.length ? (
                <OperationalTable
                  columns={['Severity', 'Reference', 'Vendor', 'Status', 'Age', 'Action']}
                  className="vendor-blocked-attention-table"
                >
                  {paginatedQueueItems.map((item) => {
                    const adminOrderPath = getQueueAdminOrderPath(item);

                    return (
                      <OperationalTableRow key={item.id}>
                        <span>
                          <StatusBadge tone={getQueueSeverityTone(item.severity)}>{item.severity}</StatusBadge>
                        </span>
                        <span title={`${getQueueItemReference(item)} · ${item.title}`}>
                          <strong>{getQueueItemReference(item)}</strong>
                          <small>{item.title}</small>
                        </span>
                        <span title={`${item.vendorName ?? item.vendorId} · ${item.vendorId}`}>
                          <strong>{item.vendorName ?? item.vendorId}</strong>
                          <small>{item.vendorId}</small>
                        </span>
                        <span>
                          <strong>{safeStatusLabel(item.status)}</strong>
                          <small>{formatQueueType(item.type)}</small>
                        </span>
                        <strong>{formatAge((Date.now() - new Date(item.createdAt).getTime()) / 36e5)}</strong>
                        <OperationalActionGroup>
                          {adminOrderPath ? actionLink(adminOrderPath, 'Open order') : <span className="queue-muted-action">No admin order</span>}
                        </OperationalActionGroup>
                      </OperationalTableRow>
                    );
                  })}
                </OperationalTable>
              ) : (
                <EmptyStatePanel
                  title="No vendor-blocked allocations"
                  description="No active vendor-blocked allocation rows need operator attention."
                />
              )}
            </article>

            <article className="attention-card shipment-attention-list" id="shipment-attention-list">
              <div className="attention-card-heading">
                <div>
                  <p className="eyebrow">Shipment</p>
                  <h3>Shipment attention</h3>
                  <span>
                    Authoritative shipment items
                    {totalShipmentQueueRows > 0
                      ? ` · ${shipmentPageStart}-${shipmentPageEnd} of ${totalShipmentQueueRows}`
                      : ''}
                  </span>
                </div>
              </div>

              {totalShipmentQueueRows > 0 ? (
                <div className="vendor-blocked-page-controls shipment-attention-page-controls">
                  <span>
                    Shipment rows {shipmentPageStart}-{shipmentPageEnd} of {totalShipmentQueueRows}
                  </span>
                  <button
                    type="button"
                    className="button button-secondary button-link button-compact"
                    onClick={() => setShipmentQueueOffset(Math.max(0, shipmentQueueOffset - SHIPMENT_QUEUE_PAGE_SIZE))}
                    disabled={!canPageShipmentBack}
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    className="button button-secondary button-link button-compact"
                    onClick={() => setShipmentQueueOffset(shipmentQueueOffset + SHIPMENT_QUEUE_PAGE_SIZE)}
                    disabled={!canPageShipmentForward}
                  >
                    Next
                  </button>
                </div>
              ) : null}

              {isShipmentQueueError ? (
                <SectionErrorRetry
                  title="Shipment attention unavailable"
                  description={shipmentQueueError ?? 'The paginated shipment attention table could not be loaded.'}
                  onRetry={() => void refetchShipmentQueue()}
                />
              ) : isShipmentQueueLoading || isShipmentQueueFetching ? (
                <SectionSkeleton
                  title="Loading shipment attention"
                  description="Fetching shipment attention with server-side pagination."
                />
              ) : shipmentQueueItems.length ? (
                <OperationalTable
                  columns={['Severity', 'Order', 'Vendor', 'Status', 'Waiting', 'Age', 'Action']}
                  className="shipment-attention-table"
                >
                  {shipmentQueueItems.map((item) => {
                    const adminOrderPath = getQueueAdminOrderPath(item);

                    return (
                      <OperationalTableRow key={item.id}>
                        <span>
                          <StatusBadge tone={getQueueSeverityTone(item.severity)}>{item.severity}</StatusBadge>
                        </span>
                        <span title={`${getQueueItemReference(item)} · ${item.title}`}>
                          <strong>{getQueueItemReference(item)}</strong>
                          <small>{item.relatedOrderId ?? item.id}</small>
                        </span>
                        <span title={`${item.vendorName ?? item.vendorId} · ${item.vendorId}`}>
                          <strong>{item.vendorName ?? item.vendorId}</strong>
                          <small>{item.vendorId}</small>
                        </span>
                        <span>
                          <strong>{safeStatusLabel(item.status)}</strong>
                          <small>{formatQueueType(item.type)}</small>
                        </span>
                        <span title={`${item.title} · ${item.description}`}>
                          <strong>{item.title}</strong>
                          <small>{item.description}</small>
                        </span>
                        <strong>{formatAge((Date.now() - new Date(item.createdAt).getTime()) / 36e5)}</strong>
                        <OperationalActionGroup>
                          {adminOrderPath ? actionLink(adminOrderPath, 'Open order') : <span className="queue-muted-action">No admin order</span>}
                        </OperationalActionGroup>
                      </OperationalTableRow>
                    );
                  })}
                </OperationalTable>
              ) : (
                <EmptyStatePanel
                  title="No shipment attention items"
                  description="No active shipment rows need operator attention."
                />
              )}
            </article>

            <article className="attention-card return-review-attention-list" id="return-review-attention-list">
              <div className="attention-card-heading">
                <div>
                  <p className="eyebrow">Return</p>
                  <h3>Return review</h3>
                  <span>
                    Authoritative return review items
                    {totalReturnReviewQueueRows > 0
                      ? ` · ${returnReviewPageStart}-${returnReviewPageEnd} of ${totalReturnReviewQueueRows}`
                      : ''}
                  </span>
                </div>
              </div>

              {totalReturnReviewQueueRows > 0 ? (
                <div className="vendor-blocked-page-controls return-review-page-controls">
                  <span>
                    Return rows {returnReviewPageStart}-{returnReviewPageEnd} of {totalReturnReviewQueueRows}
                  </span>
                  <button
                    type="button"
                    className="button button-secondary button-link button-compact"
                    onClick={() => setReturnReviewQueueOffset(Math.max(0, returnReviewQueueOffset - RETURN_REVIEW_QUEUE_PAGE_SIZE))}
                    disabled={!canPageReturnReviewBack}
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    className="button button-secondary button-link button-compact"
                    onClick={() => setReturnReviewQueueOffset(returnReviewQueueOffset + RETURN_REVIEW_QUEUE_PAGE_SIZE)}
                    disabled={!canPageReturnReviewForward}
                  >
                    Next
                  </button>
                </div>
              ) : null}

              {isReturnReviewQueueError ? (
                <SectionErrorRetry
                  title="Return review unavailable"
                  description={returnReviewQueueError ?? 'The paginated return review table could not be loaded.'}
                  onRetry={() => void refetchReturnReviewQueue()}
                />
              ) : isReturnReviewQueueLoading || isReturnReviewQueueFetching ? (
                <SectionSkeleton
                  title="Loading return review"
                  description="Fetching return review items with server-side pagination."
                />
              ) : returnReviewQueueItems.length ? (
                <OperationalTable
                  columns={['Severity', 'Return', 'Order', 'Vendor', 'Status', 'Waiting', 'Age', 'Action']}
                  className="return-review-attention-table"
                >
                  {returnReviewQueueItems.map((item) => (
                    <OperationalTableRow key={item.id}>
                      <span>
                        <StatusBadge tone={getQueueSeverityTone(item.severity)}>{item.severity}</StatusBadge>
                      </span>
                      <span title={`${item.id} · ${item.title}`}>
                        <strong>{item.id}</strong>
                        <small>{item.title}</small>
                      </span>
                      <span>
                        <strong>{getQueueItemReference(item)}</strong>
                        <small>{item.relatedOrderId ?? 'No allocation link'}</small>
                      </span>
                      <span title={`${item.vendorName ?? item.vendorId} · ${item.vendorId}`}>
                        <strong>{item.vendorName ?? item.vendorId}</strong>
                        <small>{item.vendorId}</small>
                      </span>
                      <span>
                        <strong>{safeStatusLabel(item.status)}</strong>
                        <small>{formatQueueType(item.type)}</small>
                      </span>
                      <span title={`${item.title} · ${item.description}`}>
                        <strong>{item.title}</strong>
                        <small>{item.description}</small>
                      </span>
                      <strong>{formatAge((Date.now() - new Date(item.createdAt).getTime()) / 36e5)}</strong>
                      <OperationalActionGroup>
                        {item.actionTo ? actionLink(item.actionTo, 'Open return') : <span className="queue-muted-action">No return link</span>}
                      </OperationalActionGroup>
                    </OperationalTableRow>
                  ))}
                </OperationalTable>
              ) : (
                <EmptyStatePanel
                  title="No return review items"
                  description="No active return review rows need operator attention."
                />
              )}
            </article>

            <article className="attention-card finance-review-attention-list" id="finance-review-attention-list">
              <div className="attention-card-heading">
                <div>
                  <p className="eyebrow">Finance</p>
                  <h3>Finance Review</h3>
                  <span>Held and disputed finance entries requiring operator review</span>
                </div>
              </div>

              {totalFinanceReviewQueueRows > 0 ? (
                <div className="vendor-blocked-page-controls finance-review-page-controls">
                  <span>
                    Finance Review rows {financeReviewPageStart}-{financeReviewPageEnd} of {totalFinanceReviewQueueRows}
                  </span>
                  <button
                    type="button"
                    className="button button-secondary button-link button-compact"
                    onClick={() => setFinanceReviewQueueOffset(Math.max(0, financeReviewQueueOffset - FINANCE_REVIEW_QUEUE_PAGE_SIZE))}
                    disabled={!canPageFinanceReviewBack}
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    className="button button-secondary button-link button-compact"
                    onClick={() => setFinanceReviewQueueOffset(financeReviewQueueOffset + FINANCE_REVIEW_QUEUE_PAGE_SIZE)}
                    disabled={!canPageFinanceReviewForward}
                  >
                    Next
                  </button>
                </div>
              ) : null}

              {isFinanceReviewQueueError ? (
                <SectionErrorRetry
                  title="Finance review unavailable"
                  description={financeReviewQueueError ?? 'The paginated finance review table could not be loaded.'}
                  onRetry={() => void refetchFinanceReviewQueue()}
                />
              ) : isFinanceReviewQueueLoading || isFinanceReviewQueueFetching ? (
                <SectionSkeleton
                  title="Loading finance review"
                  description="Fetching held and disputed finance entries with server-side pagination."
                />
              ) : financeReviewQueueItems.length ? (
                <OperationalTable
                  columns={['Payout', 'Settlement', 'Order', 'Vendor', 'Reason', 'Amount', 'Age']}
                  className="finance-review-attention-table"
                >
                  {financeReviewQueueItems.map((item) => {
                    const reason = getFinanceReviewReason(item);

                    return (
                      <OperationalTableRow key={item.id}>
                        <strong title={`Payout ${safeStatusLabel(item.payoutStatus ?? item.status)}`}>
                          {safeStatusLabel(item.payoutStatus ?? item.status)}
                        </strong>
                        <strong title={`Settlement ${safeStatusLabel(item.settlementStatus ?? item.status)}`}>
                          {safeStatusLabel(item.settlementStatus ?? item.status)}
                        </strong>
                        <strong>{getQueueItemReference(item)}</strong>
                        <strong title={item.vendorName ?? item.vendorId}>{item.vendorName ?? item.vendorId}</strong>
                        <span className="finance-review-reason-cell" title={reason}>
                          <strong>{reason}</strong>
                        </span>
                        <strong>{getFinanceReviewAmount(item)}</strong>
                        <strong title={formatDate(item.createdAt)}>{formatAge((Date.now() - new Date(item.createdAt).getTime()) / 36e5)}</strong>
                      </OperationalTableRow>
                    );
                  })}
                </OperationalTable>
              ) : (
                <EmptyStatePanel
                  title="No finance review items"
                  description="No held or disputed finance ledger rows need operator attention."
                />
              )}
            </article>

            <article className="attention-card finance-integrity-attention-list" id="finance-integrity-attention-list">
              <div className="attention-card-heading">
                <div>
                  <p className="eyebrow">Finance</p>
                  <h3>Finance Integrity</h3>
                  <span>
                    Authoritative finance integrity alerts
                    {totalFinanceIntegrityQueueRows > 0
                      ? ` · ${financeIntegrityPageStart}-${financeIntegrityPageEnd} of ${totalFinanceIntegrityQueueRows}`
                      : ''}
                  </span>
                </div>
              </div>

              {totalFinanceIntegrityQueueRows > 0 ? (
                <div className="vendor-blocked-page-controls finance-integrity-page-controls">
                  <span>
                    Finance rows {financeIntegrityPageStart}-{financeIntegrityPageEnd} of {totalFinanceIntegrityQueueRows}
                  </span>
                  <button
                    type="button"
                    className="button button-secondary button-link button-compact"
                    onClick={() =>
                      setFinanceIntegrityQueueOffset(Math.max(0, financeIntegrityQueueOffset - FINANCE_INTEGRITY_QUEUE_PAGE_SIZE))
                    }
                    disabled={!canPageFinanceIntegrityBack}
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    className="button button-secondary button-link button-compact"
                    onClick={() => setFinanceIntegrityQueueOffset(financeIntegrityQueueOffset + FINANCE_INTEGRITY_QUEUE_PAGE_SIZE)}
                    disabled={!canPageFinanceIntegrityForward}
                  >
                    Next
                  </button>
                </div>
              ) : null}

              {isFinanceIntegrityQueueError ? (
                <SectionErrorRetry
                  title="Finance integrity unavailable"
                  description={financeIntegrityQueueError ?? 'The paginated finance integrity table could not be loaded.'}
                  onRetry={() => void refetchFinanceIntegrityQueue()}
                />
              ) : isFinanceIntegrityQueueLoading || isFinanceIntegrityQueueFetching ? (
                <SectionSkeleton
                  title="Loading finance integrity"
                  description="Fetching finance integrity alerts with server-side pagination."
                />
              ) : financeIntegrityQueueItems.length ? (
                <OperationalTable
                  columns={['Severity', 'Alert', 'Category', 'Order', 'Vendor', 'Status', 'Detected', 'Action']}
                  className="finance-integrity-attention-table"
                >
                  {financeIntegrityQueueItems.map((item) => {
                    const alertReference = getFinanceIntegrityAlertReference(item);
                    const categoryLabel = item.financeIntegrityCategory
                      ? safeStatusLabel(item.financeIntegrityCategory)
                      : 'No category';
                    const reason = item.financeIntegrityReason?.trim() || 'No reason recorded';
                    const allocationReference = item.vendorAllocationId?.trim() || item.relatedOrderId;
                    const transferReference = item.allocationEconomicTransferId?.trim();

                    return (
                      <OperationalTableRow key={item.id}>
                        <span>
                          <StatusBadge tone={getQueueSeverityTone(item.severity)}>{item.severity}</StatusBadge>
                        </span>
                        <span title={`${alertReference} · ${reason}`}>
                          <strong>{alertReference}</strong>
                          <small>{reason}</small>
                        </span>
                        <span title={item.financeIntegrityCategory ?? categoryLabel}>
                          <strong>{categoryLabel}</strong>
                          <small>{item.financeIntegrityCategory ?? 'Structured category unavailable'}</small>
                        </span>
                        <span
                          title={joinPresentParts(
                            getFinanceIntegrityOrderReference(item),
                            allocationReference ? `Allocation ${allocationReference}` : null,
                            transferReference ? `Transfer ${transferReference}` : null,
                          )}
                        >
                          <strong>{getFinanceIntegrityOrderReference(item)}</strong>
                          <small>{allocationReference ? `Allocation ${allocationReference}` : 'No allocation link'}</small>
                          {transferReference ? <small>Transfer {transferReference}</small> : null}
                        </span>
                        <span title={`${item.vendorName ?? item.vendorId} · ${item.vendorId}`}>
                          <strong>{item.vendorName ?? item.vendorId}</strong>
                          <small>{item.vendorId}</small>
                        </span>
                        <span>
                          <strong>{safeStatusLabel(item.status)}</strong>
                          <small>{formatQueueType(item.type)}</small>
                        </span>
                        <span title={formatDate(item.createdAt)}>
                          <strong>{formatAge((Date.now() - new Date(item.createdAt).getTime()) / 36e5)}</strong>
                          <small>{formatDate(item.createdAt)}</small>
                        </span>
                        <OperationalActionGroup>
                          {item.actionTo ? actionLink(item.actionTo, 'Review') : <span className="queue-muted-action">No review link</span>}
                        </OperationalActionGroup>
                      </OperationalTableRow>
                    );
                  })}
                </OperationalTable>
              ) : (
                <EmptyStatePanel
                  title="No finance integrity alerts"
                  description="No active finance integrity alert rows need operator attention."
                />
              )}
            </article>

            {displaySections.map((section) => {
              const sectionItems = safeArray(section.items);
              const visibleCount = sectionItems.length;
              const hasHiddenPreviewItems = visibleCount < section.count;

              return (
                <article key={section.key} className="attention-card">
                  <div className="attention-card-heading">
                    <div>
                      <p className="eyebrow">{formatType(section.key)}</p>
                      <h3>{section.title}</h3>
                      <span>
                        {getPreviewLabel(visibleCount, section.count)} · {section.critical} critical · {section.warning} warning
                      </span>
                    </div>
                  </div>
                  {hasHiddenPreviewItems ? (
                    <div className="attention-preview-note">
                      <span>
                        Showing {visibleCount} of {section.count}. This section is a preview.
                      </span>
                    </div>
                  ) : null}
                  <div
                    className="attention-mini-list"
                  >
                    {sectionItems.length ? (
                      sectionItems.map((item) => (
                        <div
                          key={item.id}
                          className={`attention-mini-row${item.type === 'vendor_blocked' ? ' vendor-blocked-mini-row' : ''}`}
                        >
                          <span className={`attention-dot attention-${item.severity}`} aria-hidden="true" />
                          <div>
                            <strong>{item.title}</strong>
                            <small>
                              {item.objectReference} · {item.vendorName} · {formatAge(item.ageHours)}
                            </small>
                            <span>Status: {safeStatusLabel(item.status)}</span>
                            {attentionLink(item, getActionLabel(item))}
                          </div>
                          <StatusBadge tone={getSectionTone(item)}>{item.severity}</StatusBadge>
                        </div>
                      ))
                    ) : (
                      <p className="page-description">No current items.</p>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </main>

        <aside className="attention-side-column">
          <article className="attention-card">
            <div className="attention-card-heading">
              <div>
                <p className="eyebrow">Vendor risk</p>
                <h3>Operational health</h3>
                <span>Showing {vendorRisks.length} vendor risk preview rows.</span>
              </div>
            </div>
            <div className="attention-risk-list">
              {vendorRisks.length ? (
                vendorRisks.map((vendor) => (
                  <div key={vendor.vendorId} className="attention-risk-row">
                    <div>
                      <strong>{vendor.vendorName}</strong>
                      <span>{vendor.drivers.length ? vendor.drivers.join(' · ') : 'No dominant driver'}</span>
                    </div>
                    <StatusBadge tone={getRiskTone(vendor)}>{vendor.riskLevel}</StatusBadge>
                  </div>
                ))
              ) : (
                <p className="page-description">No vendor risk signals.</p>
              )}
            </div>
          </article>

          <article className="attention-card">
            <div className="attention-card-heading">
              <div>
                <p className="eyebrow">Activity</p>
                <h3>Recent projected activity</h3>
                <span>Latest projected activity rows, not a full audit history.</span>
              </div>
            </div>
            <div className="attention-activity-feed">
              {recentActivity.length ? (
                recentActivity.map((item) => (
                  <div key={item.id} className="attention-activity-row">
                    <span className={`attention-dot attention-${item.severity}`} aria-hidden="true" />
                    <div>
                      {item.destinationPath ? <Link to={item.destinationPath}>{item.title}</Link> : <strong>{item.title}</strong>}
                      <small>{item.vendorName} · {item.description} · {formatDate(item.occurredAt)}</small>
                      <span>{item.description}</span>
                    </div>
                    <StatusBadge tone={getActivityTone(item)}>{item.severity}</StatusBadge>
                  </div>
                ))
              ) : (
                <p className="page-description">No recent operational activity.</p>
              )}
            </div>
          </article>
        </aside>
      </div>
    </section>
  );
}
