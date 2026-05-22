import { useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { DataStatePanel } from '../components/DataStatePanel';
import { EmptyStatePanel, StatusBadge } from '../components/OperationalPrimitives';
import { queryKeys } from '../lib/api/queryKeys';
import { useQueryResource } from '../hooks/useQueryResource';
import { useMutationAction } from '../hooks/useMutationAction';
import {
  getReturn,
  createNavlungoReturnPickup,
  markReturnReceived,
  reviewReturn,
  syncNavlungoReturnStatus,
  type ReturnDetail,
  type ReturnLineItem,
} from '../features/returns/api';
import { useAppReadiness } from '../lib/appReadiness';
import { formatShopifyOrderNumber } from '../lib/formatOrderDisplay';
import { useActionFeedback } from '../lib/ui';
import { SupportTicketModal } from '../components/SupportTicketModal';
import { getFinanceDashboard } from '../features/finance/api';
import { listAdminSupportTickets, listVendorSupportTickets } from '../features/support/api';
import { OperationalLinkCards, OperationalTimeline } from '../components/OperationalTimeline';
import { OperationalRecommendations } from '../components/OperationalRecommendations';
import { AdminCollaborationNotes } from '../components/AdminCollaborationNotes';
import type { OperationsRecommendation } from '../lib/api/contracts';
import {
  sameOperationalOrderNumber,
  supportTicketMatchesReturn,
  type OperationalEventInput,
  type OperationalLinkInput,
} from '../lib/operationalCrossLinks';
import { sameOrderNumber, sameShopifyIdentifier } from '../lib/shopifyIdentifiers';

function formatDate(value: string | null | undefined) {
  if (!value) {
    return '—';
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function getStatusLabel(returnRequest: ReturnDetail) {
  const normalized = returnRequest.status.toLowerCase();
  if (returnRequest.sourceType === 'shopify_return_request' && normalized === 'requested') {
    return 'Awaiting review';
  }
  if (normalized === 'processed' || normalized === 'refunded') {
    return 'Refunded';
  }
  if (normalized === 'pending' || normalized === 'in review') {
    return 'Under review';
  }
  return returnRequest.status;
}

function getStatusTone(returnRequest: ReturnDetail) {
  const normalized = returnRequest.status.toLowerCase();
  if (returnRequest.sourceType === 'shopify_return_request' && normalized === 'requested') {
    return 'attention' as const;
  }
  if (normalized === 'approved' || normalized === 'processed' || normalized === 'closed' || normalized === 'refunded') {
    return 'success' as const;
  }
  if (normalized === 'declined' || normalized === 'cancelled' || normalized === 'rejected') {
    return 'danger' as const;
  }
  return 'info' as const;
}

function getRefundStatus(returnRequest: ReturnDetail) {
  return returnRequest.sourceType === 'shopify_return_request' && !returnRequest.sourceShopifyRefundId
    ? 'Refund pending'
    : 'Refunded';
}

function sanitizeText(value: string | null | undefined, fallback = 'Return requested') {
  const text = value?.trim();
  if (!text) {
    return fallback;
  }

  const normalized = text.toLowerCase();
  if (
    normalized.includes('backend') ||
    normalized.includes('webhook') ||
    normalized.includes('ingestion') ||
    normalized.includes('lifecycle') ||
    normalized.includes('allocation') ||
    normalized.includes('shopify return') ||
    normalized.includes('shopify refund') ||
    normalized.includes('gid://')
  ) {
    return fallback;
  }

  return text;
}

function getVariantText(value: string | null | undefined) {
  const text = value?.trim();
  if (!text || text === 'Default' || /^gid:\/\//i.test(text) || /^unknown-sku$/i.test(text)) {
    return '—';
  }
  return text;
}

function getSkuText(value: string | null | undefined) {
  const text = value?.trim();
  if (!text || /^unknown-sku$/i.test(text)) {
    return '—';
  }
  return text;
}

function getReturnedItems(returnRequest: ReturnDetail) {
  return (returnRequest.refundedItems?.length ? returnRequest.refundedItems : returnRequest.items) ?? [];
}

function getTimelineLabel(label: string) {
  const normalized = label.toLowerCase();
  if (normalized.includes('requested') || normalized.includes('return')) {
    return 'Return requested';
  }
  if (normalized.includes('approved') || normalized.includes('refund')) {
    return 'Refund approved';
  }
  if (normalized.includes('received') || normalized.includes('delivered')) {
    return 'Item received';
  }
  if (normalized.includes('review') || normalized.includes('pending')) {
    return 'Vendor reviewed';
  }
  return '';
}

function readSnapshotString(snapshot: Record<string, unknown>, key: string) {
  const value = snapshot[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readSnapshotNumber(snapshot: Record<string, unknown>, key: string) {
  const value = snapshot[key];
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function readNavlungoReturnLogs(snapshot: Record<string, unknown>) {
  const logs = Array.isArray(snapshot.navlungoReturnStatusLogs)
    ? snapshot.navlungoReturnStatusLogs.filter((log): log is Record<string, unknown> => Boolean(log) && typeof log === 'object' && !Array.isArray(log))
    : [];
  const seen = new Set<string>();
  return logs
    .map((log) => {
      const statusCode = readSnapshotNumber(log, 'status_code') ?? readSnapshotNumber(log, 'statusCode');
      const action = readSnapshotString(log, 'action');
      const actionResult = readSnapshotString(log, 'action_result') ?? readSnapshotString(log, 'actionResult');
      const createdAt = readSnapshotString(log, 'created_at') ?? readSnapshotString(log, 'createdAt');
      const title = (() => {
        switch (statusCode) {
          case 2:
            return 'Delivered';
          case 4:
            return 'Out for delivery';
          case 9:
          case 21:
            return 'Returned to warehouse';
          case 10:
            return 'Cancelled';
          case 16:
            return 'Picked up';
          case 17:
            return 'In transit';
          case 18:
            return 'Waiting at branch';
          default:
            break;
        }
        const normalizedAction = action?.toLowerCase() ?? '';
        if (/cancel|iptal/.test(normalizedAction)) return 'Cancelled';
        if (/return|iade/.test(normalizedAction)) return 'Returned to warehouse';
        if (/deliver|teslim/.test(normalizedAction)) return 'Delivered';
        if (/pickup|picked|teslim al/.test(normalizedAction)) return 'Picked up';
        if (/branch|şube|sube/.test(normalizedAction)) return 'Waiting at branch';
        if (/transit|yolda|transfer/.test(normalizedAction)) return 'In transit';
        return action || 'Return pickup status updated';
      })();
      return {
        title,
        description: actionResult ?? action ?? (statusCode === null ? 'Provider lifecycle update' : `Status ${statusCode}`),
        at: createdAt,
        status: actionResult ?? (statusCode === null ? null : String(statusCode)),
        fingerprint: `${action ?? ''}|${statusCode ?? ''}|${createdAt ?? ''}`,
      };
    })
    .filter((event) => {
      if (seen.has(event.fingerprint)) {
        return false;
      }
      seen.add(event.fingerprint);
      return true;
    });
}

function getTimeline(returnRequest: ReturnDetail) {
  const normalizedStatus = returnRequest.status.toLowerCase();
  const hasReturnTracking = Boolean(
    returnRequest.returnCarrierName || returnRequest.returnTrackingNumber || returnRequest.returnTrackingUrl,
  );
  const dataBackedTimeline = [
    {
      label: 'Return requested',
      at: formatDate(returnRequest.date),
      enabled: true,
    },
    {
      label: 'Return approved',
      at: formatDate(returnRequest.updatedAt ?? returnRequest.date),
      enabled: normalizedStatus === 'approved',
    },
    {
      label: 'Return shipment created',
      at: formatDate(returnRequest.updatedAt ?? returnRequest.date),
      enabled: hasReturnTracking,
    },
    {
      label: 'Refund processed',
      at: formatDate(returnRequest.updatedAt ?? returnRequest.date),
      enabled:
        returnRequest.sourceType !== 'shopify_return_request' ||
        normalizedStatus === 'processed' ||
        normalizedStatus === 'refunded',
    },
    {
      label: 'Received by vendor',
      at: formatDate(returnRequest.vendorReceivedAt),
      enabled: Boolean(returnRequest.vendorReceivedAt),
    },
    {
      label: returnRequest.vendorDecision === 'rejected' ? 'Rejected by vendor' : 'Approved by vendor',
      at: formatDate(returnRequest.vendorReviewedAt),
      enabled: Boolean(returnRequest.vendorReviewedAt && returnRequest.vendorDecision),
    },
  ].filter((entry) => entry.enabled);

  if (dataBackedTimeline.length > 1 || hasReturnTracking) {
    return dataBackedTimeline;
  }

  const seenLabels = new Set<string>();
  const timeline = returnRequest.timeline
    .map((entry) => ({
      label: getTimelineLabel(entry.label),
      at: formatDate(entry.at),
    }))
    .filter((entry) => {
      if (!entry.label || seenLabels.has(entry.label)) {
        return false;
      }
      seenLabels.add(entry.label);
      return true;
    });

  if (timeline.length > 0) {
    return timeline;
  }

  return [
    { label: 'Return requested', at: formatDate(returnRequest.date) },
    { label: returnRequest.sourceType === 'shopify_return_request' ? 'Vendor reviewed' : 'Refund approved', at: formatDate(returnRequest.updatedAt ?? returnRequest.date) },
  ];
}

function getItemKey(item: ReturnLineItem) {
  return `${item.id}-${item.sku}-${item.name}`;
}

function buildLinkedOrderHref(returnRequest: ReturnDetail) {
  const relatedOrderId = returnRequest.relatedOrderId?.trim();
  const relatedOrderLooksInternal =
    Boolean(relatedOrderId) &&
    !sameShopifyIdentifier(relatedOrderId, returnRequest.sourceShopifyOrderId) &&
    !sameOrderNumber(relatedOrderId, returnRequest.sourceShopifyOrderNumber);

  if (relatedOrderId && relatedOrderLooksInternal) {
    return `/orders/${encodeURIComponent(relatedOrderId)}`;
  }

  if (returnRequest.sourceShopifyOrderId) {
    return `/orders?shopifyOrderId=${encodeURIComponent(returnRequest.sourceShopifyOrderId)}`;
  }

  if (returnRequest.sourceShopifyOrderNumber) {
    return `/orders?order=${encodeURIComponent(String(returnRequest.sourceShopifyOrderNumber))}`;
  }

  return undefined;
}

function buildFinanceHref(record: { id: string }) {
  return `/finance?ledgerId=${encodeURIComponent(record.id)}`;
}

export function ReturnDetailPage() {
  const { returnId } = useParams();
  const location = useLocation();
  const appReadiness = useAppReadiness();
  const currentVendor = appReadiness.currentVendor;
  const currentUser = appReadiness.currentUser;
  const authContextReady = appReadiness.ready;
  const isAdmin = currentUser?.role === 'admin';
  const { message, tone, showFeedback } = useActionFeedback();
  const [rejectReason, setRejectReason] = useState('');
  const [supportOpen, setSupportOpen] = useState(false);
  const [navlungoReturnPickupLiveConfirmed, setNavlungoReturnPickupLiveConfirmed] = useState(false);
  const { data: returnRequest, isLoading, isError, error, diagnostics, refetch } = useQueryResource(
    returnId ? queryKeys.returns.detail(returnId, currentVendor.vendorId) : queryKeys.returns.list(currentVendor.vendorId),
    () => {
      if (!returnId) {
        throw new Error('Return not found.');
      }

      return getReturn(returnId, { vendorId: currentVendor.vendorId });
    },
    {
      enabled: authContextReady && Boolean(returnId),
    },
  );
  const { data: relatedFinanceData } = useQueryResource(
    queryKeys.finance.summary(currentVendor.vendorId),
    () => getFinanceDashboard({ vendorId: currentVendor.vendorId }),
    {
      enabled: authContextReady && Boolean(returnRequest),
    },
  );
  const { data: relatedSupportTicketsData } = useQueryResource(
    isAdmin ? queryKeys.admin.support.tickets() : queryKeys.support.tickets(currentVendor.vendorId),
    () => (isAdmin ? listAdminSupportTickets() : listVendorSupportTickets()),
    {
      enabled: authContextReady && Boolean(returnRequest),
    },
  );
  const markReceivedMutation = useMutationAction(
    () => {
      if (!returnId) {
        throw new Error('Return not found.');
      }

      return markReturnReceived(returnId, { vendorId: currentVendor.vendorId });
    },
    {
      onSuccess: async () => {
        await refetch();
        showFeedback('Return marked received.', 'success');
      },
      onError: (error) => {
        showFeedback(error instanceof Error ? error.message : 'Return could not be marked received.', 'error');
      },
    },
  );
  const reviewMutation = useMutationAction(
    (input: { decision: 'approved' | 'rejected'; reason?: string }) => {
      if (!returnId) {
        throw new Error('Return not found.');
      }

      return reviewReturn(returnId, input, { vendorId: currentVendor.vendorId });
    },
    {
      onSuccess: async (_data, variables) => {
        await refetch();
        setRejectReason('');
        showFeedback(
          variables.decision === 'approved' ? 'Return approved for admin review.' : 'Return rejected with vendor reason.',
          'success',
        );
      },
      onError: (error) => {
        showFeedback(error instanceof Error ? error.message : 'Return review could not be saved.', 'error');
      },
    },
  );
  const navlungoReturnPickupMutation = useMutationAction(
    (input: { dryRun?: boolean }) => {
      if (!returnId) {
        throw new Error('Return not found.');
      }

      return createNavlungoReturnPickup(returnId, input, { vendorId: currentVendor.vendorId });
    },
    {
      onSuccess: async (data, variables) => {
        await refetch();
        showFeedback(
          variables.dryRun
            ? 'Navlungo return pickup preview generated. No provider call was made.'
            : 'Navlungo return pickup created.',
          variables.dryRun ? 'info' : 'success',
        );
        if (!variables.dryRun && data.returnProviderShipmentId) {
          setNavlungoReturnPickupLiveConfirmed(false);
        }
      },
      onError: (error) => {
        showFeedback(error instanceof Error ? error.message : 'Navlungo return pickup could not be created.', 'error');
      },
    },
  );
  const navlungoReturnStatusSyncMutation = useMutationAction(
    () => {
      if (!returnId) {
        throw new Error('Return not found.');
      }

      return syncNavlungoReturnStatus(returnId, { vendorId: currentVendor.vendorId });
    },
    {
      onSuccess: async () => {
        await refetch();
        showFeedback('Navlungo return status synced.', 'success');
      },
      onError: (error) => {
        showFeedback(error instanceof Error ? error.message : 'Navlungo return status could not be synced.', 'error');
      },
    },
  );

  if (!authContextReady || isLoading) {
    return (
      <DataStatePanel
        tone="loading"
        eyebrow="Returns"
        title="Loading return request"
        description="Preparing the selected return for review."
      />
    );
  }

  if (isError || !returnRequest) {
    return (
      <DataStatePanel
        tone="error"
        eyebrow="Returns"
        title="Return unavailable"
        description={error ?? 'The selected return could not be loaded.'}
        diagnostics={diagnostics}
        onRetry={() => void refetch()}
        actionNode={
          <Link className="button button-secondary" to="/returns">
            Back to returns
          </Link>
        }
      />
    );
  }

  const returnedItems = getReturnedItems(returnRequest);
  const timeline = getTimeline(returnRequest);
  const hasReturnShipment = Boolean(
    returnRequest.returnCarrierName ||
      returnRequest.returnTrackingNumber ||
      returnRequest.returnTrackingUrl ||
      returnRequest.returnProviderShipmentId,
  );
  const returnProviderSnapshot = returnRequest.returnProviderSnapshot ?? {};
  const navlungoReturnPickupPayloadSummary = returnProviderSnapshot.navlungoReturnPickupPayloadSummary as
    | Record<string, unknown>
    | undefined;
  const navlungoReturnPickupMissingFields = Array.isArray(returnProviderSnapshot.navlungoReturnPickupMissingFields)
    ? returnProviderSnapshot.navlungoReturnPickupMissingFields.filter((field): field is string => typeof field === 'string')
    : [];
  const navlungoReturnAutoCreateAttempted = returnProviderSnapshot.navlungoReturnAutoCreateAttempted === true;
  const navlungoReturnAutoCreateSkippedReason =
    typeof returnProviderSnapshot.navlungoReturnAutoCreateSkippedReason === 'string'
      ? returnProviderSnapshot.navlungoReturnAutoCreateSkippedReason
      : null;
  const navlungoReturnStatusLogs = readNavlungoReturnLogs(returnProviderSnapshot);
  const navlungoReturnNormalizedStatus = readSnapshotString(returnProviderSnapshot, 'navlungoReturnNormalizedStatus');
  const navlungoReturnProviderStatusName = readSnapshotString(returnProviderSnapshot, 'navlungoReturnProviderStatusName');
  const navlungoReturnProviderStatusCode = readSnapshotNumber(returnProviderSnapshot, 'navlungoReturnProviderStatusCode');
  const navlungoReturnStatusSyncedAt = readSnapshotString(returnProviderSnapshot, 'navlungoReturnLastStatusSyncedAt');
  const navlungoReturnStatusHttpStatus = readSnapshotNumber(returnProviderSnapshot, 'navlungoReturnStatusSyncHttpStatus');
  const shopifyReturnStatusSyncSkippedReason = readSnapshotString(returnProviderSnapshot, 'shopifyReturnStatusSyncSkippedReason');
  const canReviewReturn =
    currentUser?.role === 'admin' ||
    (currentUser?.role === 'vendor' && returnRequest.assignedVendorId === currentVendor.vendorId);
  const hasReceivedReturn = Boolean(returnRequest.vendorReceivedAt);
  const hasReviewedReturn = Boolean(returnRequest.vendorReviewedAt && returnRequest.vendorDecision);
  const supportSnapshot = {
    route: location.pathname,
    orderNumber: formatShopifyOrderNumber(returnRequest.sourceShopifyOrderNumber),
    returnStatus: getStatusLabel(returnRequest),
    refundStatus: getRefundStatus(returnRequest),
    itemCount: returnedItems.length,
    itemTitle: returnedItems[0]?.name ?? null,
    returnCarrierPresent: Boolean(returnRequest.returnCarrierName),
    returnTrackingPresent: Boolean(returnRequest.returnTrackingNumber || returnRequest.returnTrackingUrl),
  };
  const relatedFinanceRecords = (relatedFinanceData?.transactions ?? []).filter(
    (record) =>
      (returnRequest.sourceShopifyRefundId && sameShopifyIdentifier(record.shopifyRefundId, returnRequest.sourceShopifyRefundId)) ||
      sameOperationalOrderNumber(record.shopifyOrderNumber, returnRequest.sourceShopifyOrderNumber),
  );
  const relatedSupportTickets = (relatedSupportTicketsData ?? []).filter((ticket) =>
    supportTicketMatchesReturn(ticket, returnRequest.id, {
      audience: isAdmin ? 'admin' : 'vendor',
      currentVendorId: currentVendor.vendorId,
    }),
  );
  const supportBasePath = isAdmin ? '/admin/support' : '/support';
  const audience = isAdmin ? 'admin' : 'vendor';
  const returnCrossLinks: OperationalLinkInput[] = [
    {
      id: `order-${returnRequest.relatedOrderId}`,
      eyebrow: 'Order',
      title: `Order ${formatShopifyOrderNumber(returnRequest.sourceShopifyOrderNumber)}`,
      description: 'Original order for this return.',
      href: buildLinkedOrderHref(returnRequest),
      status: 'Linked',
      tone: 'info',
    },
    ...relatedFinanceRecords.map((record) => ({
      id: `finance-${record.id}`,
      eyebrow: 'Finance',
      title: record.category === 'Refund' ? 'Refund impact' : 'Payout activity',
      description: `${record.amount} · ${record.status}`,
      href: buildFinanceHref(record),
      status: record.category,
      tone: record.category === 'Refund' ? ('warning' as const) : ('success' as const),
    })),
    ...relatedSupportTickets.map((ticket) => ({
      id: `support-${ticket.id}`,
      eyebrow: 'Support',
      title: ticket.subject,
      description: ticket.vendorName ?? ticket.vendorId,
      href: `${supportBasePath}/${ticket.id}`,
      status: ticket.status.replace(/_/g, ' '),
      tone: ticket.status === 'RESOLVED' || ticket.status === 'CLOSED' ? ('success' as const) : ('info' as const),
    })),
  ];
  const unifiedTimelineEvents: OperationalEventInput[] = [
    ...timeline.map((entry, index) => ({
      id: `return-${index}-${entry.label}-${entry.at}`,
      title: entry.label,
      at: returnRequest.timeline[index]?.at ?? returnRequest.date,
      description: entry.at,
      tone: 'neutral' as const,
    })),
    ...relatedFinanceRecords.map((record) => ({
      id: `finance-${record.id}`,
      title: record.category === 'Refund' ? 'Refund processed' : 'Finance entry created',
      description: `${record.category} · ${record.amount}`,
      at: record.date,
      status: record.status,
      tone: record.category === 'Refund' ? ('warning' as const) : ('success' as const),
      href: buildFinanceHref(record),
    })),
    ...relatedSupportTickets.map((ticket) => ({
      id: `support-${ticket.id}`,
      title: 'Support ticket opened',
      description: ticket.subject,
      at: ticket.createdAt,
      status: ticket.status.replace(/_/g, ' '),
      tone: ticket.status === 'RESOLVED' || ticket.status === 'CLOSED' ? ('success' as const) : ('info' as const),
      href: `${supportBasePath}/${ticket.id}`,
    })),
    ...(returnRequest.navlungoReturnCreatedAt
      ? [
          {
            id: `navlungo-return-${returnRequest.id}`,
            title: navlungoReturnAutoCreateAttempted ? 'Return pickup auto-created' : 'Navlungo return pickup created',
            description: returnRequest.returnCarrierName
              ? `Provider shipment created · ${returnRequest.returnCarrierName}`
              : 'Provider shipment created',
            at: returnRequest.navlungoReturnCreatedAt,
            status: 'Created',
            tone: 'success' as const,
          },
        ]
      : []),
    ...(!returnRequest.navlungoReturnCreatedAt && navlungoReturnAutoCreateSkippedReason
      ? [
          {
            id: `navlungo-return-attention-${returnRequest.id}`,
            title: 'Return pickup needs attention',
            description: navlungoReturnPickupMissingFields.length
              ? `Missing fields: ${navlungoReturnPickupMissingFields.join(', ')}`
              : navlungoReturnAutoCreateSkippedReason.replace(/_/g, ' '),
            at: returnRequest.updatedAt ?? returnRequest.date,
            status: 'Needs attention',
            tone: 'warning' as const,
          },
        ]
      : []),
    ...navlungoReturnStatusLogs.map((event) => ({
      id: `navlungo-return-log-${returnRequest.id}-${event.fingerprint}`,
      title: event.title,
      description: event.description,
      at: event.at ?? returnRequest.updatedAt ?? returnRequest.date,
      status: event.status ?? undefined,
      tone:
        event.title === 'Cancelled'
          ? ('danger' as const)
          : event.title === 'Delivered' || event.title === 'Returned to warehouse'
            ? ('success' as const)
            : ('info' as const),
    })),
  ];
  const returnRecommendations: OperationsRecommendation[] = [];
  if (!hasReceivedReturn) {
    returnRecommendations.push({
      id: `return-rec-receipt-${returnRequest.id}`,
      type: 'return_review',
      severity: hasReturnShipment ? 'warning' : 'info',
      title: 'Review returned item',
      description: hasReturnShipment
        ? 'Tracking is available. Confirm receipt when it arrives.'
        : 'Receipt has not been marked yet.',
      recommendedAction: 'Inspect item before vendor decision',
      relatedObjectType: 'Return',
      relatedObjectId: returnRequest.id,
      vendor: {
        id: returnRequest.assignedVendorId,
        name: currentVendor.vendorName ?? returnRequest.assignedVendorId,
      },
      createdFromSignal: `return:${returnRequest.id}:receipt`,
      deepLink: `/returns/${returnRequest.id}`,
      vendorVisible: true,
      createdAt: returnRequest.updatedAt ?? returnRequest.date,
    });
  } else if (!hasReviewedReturn) {
    returnRecommendations.push({
      id: `return-rec-review-${returnRequest.id}`,
      type: 'return_review',
      severity: 'warning',
      title: 'Complete vendor return review',
      description: 'Item received. Vendor decision is pending.',
      recommendedAction: 'Approve or reject after inspection',
      relatedObjectType: 'Return',
      relatedObjectId: returnRequest.id,
      vendor: {
        id: returnRequest.assignedVendorId,
        name: currentVendor.vendorName ?? returnRequest.assignedVendorId,
      },
      createdFromSignal: `return:${returnRequest.id}:vendor-review`,
      deepLink: `/returns/${returnRequest.id}`,
      vendorVisible: true,
      createdAt: returnRequest.vendorReceivedAt ?? returnRequest.updatedAt ?? returnRequest.date,
    });
  }
  if (getRefundStatus(returnRequest).toLowerCase().includes('pending')) {
    returnRecommendations.push({
      id: `return-rec-refund-${returnRequest.id}`,
      type: 'return_refund',
      severity: 'info',
      title: 'Monitor refund progress',
      description: 'Refund status is still pending.',
      recommendedAction: 'Keep review current for admin refund handling',
      relatedObjectType: 'Return',
      relatedObjectId: returnRequest.id,
      vendor: {
        id: returnRequest.assignedVendorId,
        name: currentVendor.vendorName ?? returnRequest.assignedVendorId,
      },
      createdFromSignal: `return:${returnRequest.id}:refund`,
      deepLink: `/returns/${returnRequest.id}`,
      vendorVisible: true,
      createdAt: returnRequest.updatedAt ?? returnRequest.date,
    });
  }
  const waitingReturnSupportTicket = relatedSupportTickets.find((ticket) => ticket.status === 'WAITING_FOR_VENDOR');
  if (waitingReturnSupportTicket) {
    returnRecommendations.push({
      id: `return-rec-support-${waitingReturnSupportTicket.id}`,
      type: 'support_assignment',
      severity: 'warning',
      title: 'Reply to support request',
      description: waitingReturnSupportTicket.subject,
      recommendedAction: 'Open support and reply',
      relatedObjectType: 'Support ticket',
      relatedObjectId: waitingReturnSupportTicket.id,
      vendor: {
        id: waitingReturnSupportTicket.vendorId,
        name: waitingReturnSupportTicket.vendorName ?? waitingReturnSupportTicket.vendorId,
      },
      createdFromSignal: `support:${waitingReturnSupportTicket.id}`,
      deepLink: `${supportBasePath}/${waitingReturnSupportTicket.id}`,
      vendorVisible: true,
      createdAt: waitingReturnSupportTicket.lastReplyAt ?? waitingReturnSupportTicket.updatedAt,
    });
  }

  return (
    <section className="return-review-page">
      <div className="return-review-header">
        <div>
          <Link to="/returns" className="return-review-back">← Back to returns</Link>
          <div className="return-review-title-row">
            <h2>Return request</h2>
            <span>Order {formatShopifyOrderNumber(returnRequest.sourceShopifyOrderNumber)}</span>
          </div>
          <p>Review the returned item and take the required action.</p>
        </div>
        <div className="return-review-header-actions">
          <StatusBadge tone={getStatusTone(returnRequest)}>{getStatusLabel(returnRequest)}</StatusBadge>
          <StatusBadge tone="info">Vendor {currentVendor.vendorName}</StatusBadge>
        </div>
      </div>

      <div className="return-review-grid">
        <main className="return-review-main">
          <article className="return-review-card">
            <div className="return-review-card-header">
              <div>
                <p className="eyebrow">Returned items</p>
                <h3>{returnedItems.length} item{returnedItems.length === 1 ? '' : 's'}</h3>
              </div>
            </div>
            {returnedItems.length > 0 ? (
              <div className="return-review-item-list">
                {returnedItems.map((item) => (
                  <article key={getItemKey(item)} className="return-review-item">
                    <div className="return-review-item-main">
                      <strong>{item.name || 'Return item'}</strong>
                      {getVariantText(item.variantTitle) !== '—' ? <span>{getVariantText(item.variantTitle)}</span> : null}
                    </div>
                    <div>
                      <span>SKU</span>
                      <strong>{getSkuText(item.sku)}</strong>
                    </div>
                    <div>
                      <span>Qty</span>
                      <strong>{item.quantity}</strong>
                    </div>
                    <div>
                      <span>Status</span>
                      <StatusBadge tone={getStatusTone(returnRequest)}>{getStatusLabel(returnRequest)}</StatusBadge>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <EmptyStatePanel title="No returned items" description="No item detail is available for this return yet." />
            )}
          </article>

          <article className="return-review-card">
            <div className="return-review-card-header">
              <div>
                <p className="eyebrow">Customer return reason</p>
                <h3>Return reason</h3>
              </div>
            </div>
            <div className="return-review-reason">
              <p>{sanitizeText(returnRequest.reason)}</p>
              {sanitizeText(returnRequest.resolution, '') ? (
                <div>
                  <span>Customer note</span>
                  <strong>{sanitizeText(returnRequest.resolution, '')}</strong>
                </div>
              ) : null}
            </div>
          </article>

          <OperationalLinkCards
            title="Related operational records"
            subtitle="Order, payout impact, and support linked to this return."
            links={returnCrossLinks}
            audience={audience}
          />
        </main>

        <aside className="return-review-side" aria-label="Return operational sidebar">
          <article className="return-review-card return-review-summary-card">
            <div className="return-review-card-header">
              <div>
                <p className="eyebrow">Summary</p>
                <h3>Return details</h3>
              </div>
            </div>
            <div className="return-review-summary-list">
              <div>
                <span>Order number</span>
                <strong>{formatShopifyOrderNumber(returnRequest.sourceShopifyOrderNumber)}</strong>
              </div>
              <div>
                <span>Requested</span>
                <strong>{formatDate(returnRequest.date)}</strong>
              </div>
              <div>
                <span>Return status</span>
                <strong>{getStatusLabel(returnRequest)}</strong>
              </div>
              <div>
                <span>Refund status</span>
                <strong>{getRefundStatus(returnRequest)}</strong>
              </div>
              <div>
                <span>Vendor</span>
                <strong>{currentVendor.vendorName}</strong>
              </div>
            </div>
          </article>

          <OperationalTimeline
            title="Timeline"
            events={unifiedTimelineEvents}
            audience={audience}
          />

          <OperationalRecommendations
            title="Operations"
            recommendations={returnRecommendations}
            audience={audience}
          />

          <AdminCollaborationNotes contextType="return" contextId={returnRequest.id} currentUser={currentUser} />

          <article className="return-review-card return-review-action-card">
            <p className="eyebrow">Next action</p>
            <h3>Vendor review</h3>
            <p>Vendor review only. Shopify refund is not issued here.</p>
            <div className="return-review-summary-list return-review-state-list">
              <div>
                <span>Receipt</span>
                <strong>{returnRequest.vendorReceivedAt ? `Received ${formatDate(returnRequest.vendorReceivedAt)}` : 'Not received yet'}</strong>
              </div>
              <div>
                <span>Decision</span>
                <strong>
                  {returnRequest.vendorDecision
                    ? `${returnRequest.vendorDecision === 'approved' ? 'Approved' : 'Rejected'}${returnRequest.vendorReviewedAt ? ` ${formatDate(returnRequest.vendorReviewedAt)}` : ''}`
                    : 'Pending vendor review'}
                </strong>
              </div>
              {returnRequest.vendorDecision === 'rejected' && returnRequest.vendorDecisionReason ? (
                <div>
                  <span>Reason</span>
                  <strong>{returnRequest.vendorDecisionReason}</strong>
                </div>
              ) : null}
            </div>
            {message ? <p className={`action-feedback action-${tone}`}>{message}</p> : null}
            <div className="return-review-actions">
              {canReviewReturn ? (
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={markReceivedMutation.isPending || hasReceivedReturn}
                  onClick={() => void markReceivedMutation.mutateAsync(undefined)}
                >
                  {markReceivedMutation.isPending ? 'Marking...' : hasReceivedReturn ? 'Received' : 'Mark received'}
                </button>
              ) : null}
              {canReviewReturn ? (
                <button
                  type="button"
                  className="button button-primary"
                  disabled={reviewMutation.isPending || !hasReceivedReturn || hasReviewedReturn}
                  onClick={() => void reviewMutation.mutateAsync({ decision: 'approved' })}
                >
                  Approve return
                </button>
              ) : null}
              <button type="button" className="button button-secondary" onClick={() => setSupportOpen(true)}>
                Contact support
              </button>
            </div>
            {canReviewReturn && hasReceivedReturn && !hasReviewedReturn ? (
              <div className="return-review-reject-box">
                <label htmlFor="return-reject-reason">Reject reason</label>
                <textarea
                  id="return-reject-reason"
                  value={rejectReason}
                  onChange={(event) => setRejectReason(event.target.value)}
                  placeholder="Required when rejecting this return"
                  rows={3}
                />
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={reviewMutation.isPending || !rejectReason.trim()}
                  onClick={() => void reviewMutation.mutateAsync({ decision: 'rejected', reason: rejectReason })}
                >
                  Reject return
                </button>
              </div>
            ) : null}
          </article>

          {hasReturnShipment ? (
            <article className="return-review-card">
              <div className="return-review-card-header">
                <div>
                  <p className="eyebrow">Return shipment</p>
                  <h3>Customer shipment</h3>
                </div>
              </div>
              <div className="return-review-summary-list">
                {returnRequest.returnProvider ? (
                  <div>
                    <span>Provider</span>
                    <strong>{returnRequest.returnProvider === 'navlungo' ? 'Navlungo' : returnRequest.returnProvider}</strong>
                  </div>
                ) : null}
                {returnRequest.returnProviderShipmentId ? (
                  <div>
                    <span>Provider ID</span>
                    <strong>{returnRequest.returnProviderShipmentId}</strong>
                  </div>
                ) : null}
                <div>
                  <span>Carrier</span>
                  <strong>{returnRequest.returnCarrierName ?? 'Not provided'}</strong>
                </div>
                <div>
                  <span>Tracking</span>
                  {returnRequest.returnTrackingUrl ? (
                    <a href={returnRequest.returnTrackingUrl} target="_blank" rel="noreferrer">
                      {returnRequest.returnTrackingNumber ?? 'Open tracking'}
                    </a>
                  ) : (
                    <strong>{returnRequest.returnTrackingNumber ?? 'Not provided'}</strong>
                  )}
                </div>
                {navlungoReturnProviderStatusName || navlungoReturnNormalizedStatus || navlungoReturnProviderStatusCode !== null ? (
                  <div>
                    <span>Provider status</span>
                    <strong>
                      {navlungoReturnProviderStatusName ?? navlungoReturnNormalizedStatus ?? `Status ${navlungoReturnProviderStatusCode}`}
                    </strong>
                  </div>
                ) : null}
                {navlungoReturnStatusSyncedAt ? (
                  <div>
                    <span>Last status sync</span>
                    <strong>{formatDate(navlungoReturnStatusSyncedAt)}</strong>
                  </div>
                ) : null}
                {typeof returnProviderSnapshot.navlungoReturnBarcodeStatus === 'string' ? (
                  <div>
                    <span>Barcode status</span>
                    <strong>{returnProviderSnapshot.navlungoReturnBarcodeStatus}</strong>
                  </div>
                ) : null}
                {returnRequest.returnReferenceId ? (
                  <div>
                    <span>Reference</span>
                    <strong>{returnRequest.returnReferenceId}</strong>
                  </div>
                ) : null}
                {returnRequest.returnLabel ? (
                  <div>
                    <span>Barcode / label</span>
                    <strong>Available</strong>
                  </div>
                ) : null}
                {shopifyReturnStatusSyncSkippedReason ? (
                  <div>
                    <span>Shopify return status sync</span>
                    <strong>{shopifyReturnStatusSyncSkippedReason}</strong>
                  </div>
                ) : null}
                {isAdmin && returnRequest.returnProvider === 'navlungo' && returnRequest.returnProviderShipmentId ? (
                  <div className="return-review-actions">
                    <button
                      type="button"
                      className="button button-secondary"
                      disabled={navlungoReturnStatusSyncMutation.isPending}
                      onClick={() => void navlungoReturnStatusSyncMutation.mutateAsync(undefined)}
                    >
                      {navlungoReturnStatusSyncMutation.isPending ? 'Syncing...' : 'Sync Navlungo return status'}
                    </button>
                  </div>
                ) : null}
              </div>
            </article>
          ) : null}

          {!hasReturnShipment && navlungoReturnAutoCreateSkippedReason ? (
            <article className="return-review-card">
              <div className="return-review-card-header">
                <div>
                  <p className="eyebrow">Return pickup</p>
                  <h3>Needs attention</h3>
                </div>
              </div>
              <div className="return-review-summary-list">
                <div>
                  <span>Status</span>
                  <strong>Pending provider create</strong>
                </div>
                <div>
                  <span>Reason</span>
                  <strong>{navlungoReturnAutoCreateSkippedReason.replace(/_/g, ' ')}</strong>
                </div>
                {navlungoReturnPickupMissingFields.length ? (
                  <div>
                    <span>Missing fields</span>
                    <strong>{navlungoReturnPickupMissingFields.join(', ')}</strong>
                  </div>
                ) : null}
              </div>
            </article>
          ) : null}

          {isAdmin && returnRequest.sourceType === 'shopify_return_request' ? (
            <article className="return-review-card return-review-navlungo-card">
              <div className="return-review-card-header">
                <div>
                  <p className="eyebrow">Navlungo return pickup</p>
                  <h3>Provider return shipment</h3>
                </div>
              </div>
              {returnRequest.returnProviderShipmentId ? (
                <div className="return-review-summary-list">
                  <div>
                    <span>Status</span>
                    <strong>Created</strong>
                  </div>
                  <div>
                    <span>Shopify return sync</span>
                    <strong>
                      {typeof returnProviderSnapshot.shopifyReturnSyncSkippedReason === 'string'
                        ? returnProviderSnapshot.shopifyReturnSyncSkippedReason
                        : 'not_implemented'}
                    </strong>
                  </div>
                  {navlungoReturnStatusHttpStatus !== null ? (
                    <div>
                      <span>Status sync HTTP</span>
                      <strong>{navlungoReturnStatusHttpStatus}</strong>
                    </div>
                  ) : null}
                  {navlungoReturnStatusLogs.length ? (
                    <div>
                      <span>Status logs</span>
                      <strong>{navlungoReturnStatusLogs.length}</strong>
                    </div>
                  ) : null}
                </div>
              ) : (
                <>
                  <p className="muted">Preview safely before live create.</p>
                  <div className="return-review-actions return-review-preview-actions">
                    <button
                      type="button"
                      className="button button-secondary"
                      disabled={navlungoReturnPickupMutation.isPending}
                      onClick={() => void navlungoReturnPickupMutation.mutateAsync({ dryRun: true })}
                    >
                      {navlungoReturnPickupMutation.isPending ? 'Previewing...' : 'Preview Navlungo return pickup'}
                    </button>
                  </div>
                  {navlungoReturnPickupPayloadSummary ? (
                    <div className="provider-response-summary" aria-label="Navlungo return pickup payload summary">
                      <div className="summary-row">
                        <span>Endpoint</span>
                        <strong>{String(navlungoReturnPickupPayloadSummary.endpointPath ?? '/post/create')}</strong>
                      </div>
                      <div className="summary-row">
                        <span>Post type</span>
                        <strong>{String(navlungoReturnPickupPayloadSummary.requestedPostType ?? '—')}</strong>
                      </div>
                      <div className="summary-row">
                        <span>Carrier</span>
                        <strong>{String(navlungoReturnPickupPayloadSummary.requestedCarrierId ?? '—')}</strong>
                      </div>
                      <div className="summary-row">
                        <span>Sender keys</span>
                        <strong>
                          {Array.isArray(navlungoReturnPickupPayloadSummary.senderKeys)
                            ? navlungoReturnPickupPayloadSummary.senderKeys.join(', ')
                            : '—'}
                        </strong>
                      </div>
                      <div className="summary-row">
                        <span>Recipient addressId</span>
                        <strong>{returnProviderSnapshot.recipientAddressIdValid === true ? 'valid' : 'missing'}</strong>
                      </div>
                      <div className="summary-row">
                        <span>Custom data</span>
                        <strong>
                          {[
                            navlungoReturnPickupPayloadSummary.customData1Present ? 'order' : null,
                            navlungoReturnPickupPayloadSummary.customData2Present ? 'return' : null,
                            navlungoReturnPickupPayloadSummary.customData3Present ? 'shopify return' : null,
                            navlungoReturnPickupPayloadSummary.customData4Present ? 'flow' : null,
                          ].filter(Boolean).join(', ') || '—'}
                        </strong>
                      </div>
                      {navlungoReturnPickupMissingFields.length ? (
                        <div className="summary-row">
                          <span>Missing fields</span>
                          <strong>{navlungoReturnPickupMissingFields.join(', ')}</strong>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="return-review-live-create">
                    <span>Live create</span>
                    <label className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={navlungoReturnPickupLiveConfirmed}
                        onChange={(event) => setNavlungoReturnPickupLiveConfirmed(event.target.checked)}
                      />
                      <span>Creates a live Navlungo return pickup.</span>
                    </label>
                    <button
                      type="button"
                      className="button button-primary"
                      disabled={navlungoReturnPickupMutation.isPending || !navlungoReturnPickupLiveConfirmed}
                      onClick={() => void navlungoReturnPickupMutation.mutateAsync({ dryRun: false })}
                    >
                      {navlungoReturnPickupMutation.isPending ? 'Creating...' : 'Create live Navlungo return pickup'}
                    </button>
                  </div>
                </>
              )}
            </article>
          ) : null}

        </aside>
      </div>
      <SupportTicketModal
        open={supportOpen}
        contextType="return"
        contextId={returnRequest.id}
        contextSnapshot={supportSnapshot}
        defaultSubject={`Help with return ${formatShopifyOrderNumber(returnRequest.sourceShopifyOrderNumber)}`}
        onClose={() => setSupportOpen(false)}
        onCreated={() => showFeedback('Support ticket created.', 'success')}
      />
    </section>
  );
}
