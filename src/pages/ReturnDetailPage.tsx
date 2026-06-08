import { useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useParams } from 'react-router-dom';
import { EmptyStatePanel, SectionErrorRetry, SkeletonText, StatusBadge, WorkflowActionGuidance } from '../components/OperationalPrimitives';
import { ProductImagePreview } from '../components/ProductImagePreview';
import { queryKeys } from '../lib/api/queryKeys';
import { useQueryResource } from '../hooks/useQueryResource';
import { useMutationAction } from '../hooks/useMutationAction';
import {
  getReturn,
  createKargonomiReturnShipment,
  createNavlungoReturnPickup,
  getKargonomiReturnPreview,
  markReturnReceived,
  reviewReturn,
  saveNavlungoReturnPickupAddressCompletion,
  syncNavlungoReturnStatus,
  type KargonomiReturnPreview,
  type ReturnDetail,
  type ReturnLineItem,
} from '../features/returns/api';
import { useAppReadiness } from '../lib/appReadiness';
import { formatShopifyOrderNumber } from '../lib/formatOrderDisplay';
import { useActionFeedback } from '../lib/ui';
import { SupportTicketModal } from '../components/SupportTicketModal';
import { getReturnFinanceRecords } from '../features/finance/api';
import { listAdminSupportTickets, listVendorSupportTickets } from '../features/support/api';
import { OperationalLinkCards, OperationalTimeline } from '../components/OperationalTimeline';
import { OperationalRecommendations } from '../components/OperationalRecommendations';
import { AdminCollaborationNotes } from '../components/AdminCollaborationNotes';
import type { OperationsRecommendation } from '../lib/api/contracts';
import {
  supportTicketMatchesReturn,
  type OperationalEventInput,
  type OperationalLinkInput,
} from '../lib/operationalCrossLinks';
import { sameOrderNumber, sameShopifyIdentifier } from '../lib/shopifyIdentifiers';
import { formatDateTime, safeArray, safeStatusLabel } from '../services/real/formatting';
import { getReturnWorkflowAction } from '../lib/workflowActionGuidance';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function formatDate(value: string | null | undefined) {
  return formatDateTime(value, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getStatusLabel(returnRequest: ReturnDetail) {
  const normalized = returnRequest.status?.toLowerCase() ?? '';
  if (returnRequest.sourceType === 'shopify_return_request' && normalized === 'requested') {
    return 'Awaiting review';
  }
  if (normalized === 'processed' || normalized === 'refunded') {
    return 'Refunded';
  }
  if (normalized === 'pending' || normalized === 'in review') {
    return 'Under review';
  }
  return returnRequest.status || 'Unknown';
}

function getStatusTone(returnRequest: ReturnDetail) {
  const normalized = returnRequest.status?.toLowerCase() ?? '';
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

function formatDiagnosticToken(value: string | null | undefined, fallback = '—') {
  return value?.trim() ? value.trim().replace(/_/g, ' ') : fallback;
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

function getItemInitials(value: string | null | undefined) {
  const [first = '', second = ''] = (value ?? 'Item').trim().split(/\s+/);
  return `${first[0] ?? 'I'}${second[0] ?? ''}`.toUpperCase();
}

function getReturnItemImageAlt(item: ReturnLineItem) {
  return item.name ? `${item.name} product image` : item.sku ? `${item.sku} product image` : 'Returned item product image';
}

function getReturnedItems(returnRequest: ReturnDetail) {
  const refundedItems = safeArray(returnRequest.refundedItems);
  return refundedItems.length ? refundedItems : safeArray(returnRequest.items);
}

function getTimelineLabel(label: string | null | undefined) {
  const normalized = label?.toLowerCase() ?? '';
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

function readSnapshotBoolean(snapshot: Record<string, unknown>, key: string) {
  const value = snapshot[key];
  return typeof value === 'boolean' ? value : null;
}

function readSnapshotStringArrays(snapshot: Record<string, unknown>, keys: string[]) {
  return Array.from(new Set(keys.flatMap((key) => readSnapshotStringArray(snapshot[key]))));
}

function formatDiagnosticBoolean(value: boolean | null) {
  if (value === null) {
    return '—';
  }
  return value ? 'yes' : 'no';
}

function formatDiagnosticList(values: string[]) {
  return values.length ? values.join(', ') : '—';
}

function formatDiagnosticJson(value: unknown) {
  if (!isRecord(value) && !Array.isArray(value)) {
    return null;
  }
  return JSON.stringify(value, null, 2);
}

function readKargonomiPreviewShipment(preview: KargonomiReturnPreview | null) {
  const shipment = isRecord(preview?.previewPayload.shipment) ? preview.previewPayload.shipment : null;
  return {
    sender: isRecord(shipment?.sender) ? shipment.sender : {},
    receiver: isRecord(shipment?.receiver) ? shipment.receiver : {},
    package: isRecord(shipment?.package) ? shipment.package : {},
    reference: isRecord(shipment?.reference) ? shipment.reference : {},
  };
}

function isRenderableReturnDetail(value: unknown): value is ReturnDetail {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Partial<ReturnDetail>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.status === 'string' &&
    Array.isArray(candidate.refundedItems) &&
    Array.isArray(candidate.items) &&
    Array.isArray(candidate.timeline)
  );
}

function ReturnDetailRouteDiagnostics({
  returnId,
  vendorId,
  vendorName,
  queryEnabled,
  queryStatus,
  fetchStatus,
  endpoint,
  httpStatus,
  error,
}: {
  returnId: string | undefined;
  vendorId: string | null | undefined;
  vendorName: string | null | undefined;
  queryEnabled: boolean;
  queryStatus: string;
  fetchStatus: string;
  endpoint: string;
  httpStatus?: number | null;
  error?: string | null;
}) {
  return (
    <details className="api-error-diagnostics">
      <summary>Route diagnostics</summary>
      <dl>
        <div>
          <dt>Return ID</dt>
          <dd>{returnId ?? 'missing'}</dd>
        </div>
        <div>
          <dt>Selected vendor</dt>
          <dd>{vendorId ? `${vendorName ?? vendorId} (${vendorId})` : 'missing'}</dd>
        </div>
        <div>
          <dt>Query enabled</dt>
          <dd>{queryEnabled ? 'yes' : 'no'}</dd>
        </div>
        <div>
          <dt>Query status</dt>
          <dd>{queryStatus}</dd>
        </div>
        <div>
          <dt>Fetch status</dt>
          <dd>{fetchStatus}</dd>
        </div>
        <div>
          <dt>Endpoint</dt>
          <dd>{endpoint}</dd>
        </div>
        <div>
          <dt>HTTP status</dt>
          <dd>{httpStatus ?? 'unavailable'}</dd>
        </div>
        <div>
          <dt>Error</dt>
          <dd>{error ?? 'none'}</dd>
        </div>
      </dl>
    </details>
  );
}

function readNavlungoReturnLogs(snapshot: Record<string, unknown>) {
  const logs = safeArray(snapshot.navlungoReturnStatusLogs).filter(
    (log): log is Record<string, unknown> => Boolean(log) && typeof log === 'object' && !Array.isArray(log),
  );
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
  const normalizedStatus = returnRequest.status?.toLowerCase() ?? '';
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

const RETURN_PICKUP_COMPLETION_FIELDS = [
  { field: 'sender.name', key: 'name', label: 'Customer name', required: true },
  { field: 'sender.phone', key: 'phone', label: 'Phone', required: true },
  { field: 'sender.address', key: 'address', label: 'Pickup address', required: true },
  { field: 'sender.country', key: 'country', label: 'Country', required: true },
  { field: 'sender.city', key: 'city', label: 'City', required: true },
  { field: 'sender.district', key: 'district', label: 'District', required: true },
  { field: 'sender.post_code', key: 'postcode', label: 'Post code', required: false },
] as const;

const RETURN_DETAIL_LOADING_TIMEOUT_MS = 8000;

function normalizeReturnPickupMissingField(value: string) {
  return value.trim().replace(/^-\s*/, '');
}

function readSnapshotStringArray(value: unknown) {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        .map(normalizeReturnPickupMissingField)
    : [];
}

function parseReturnPickupMissingFieldsFromMessage(value: string | null | undefined) {
  if (!value?.includes('Missing required Navlungo return pickup fields')) {
    return [];
  }
  return value
    .split('\n')
    .map(normalizeReturnPickupMissingField)
    .filter((line) => line.startsWith('sender.') || line.startsWith('recipient.') || line === 'carrier_id' || line.startsWith('post.'));
}

function collectReturnPickupMissingFields(snapshot: Record<string, unknown>, message?: string | null) {
  return Array.from(new Set([
    ...readSnapshotStringArray(snapshot.navlungoReturnPickupMissingFields),
    ...readSnapshotStringArray(snapshot.navlungoReturnMissingFields),
    ...parseReturnPickupMissingFieldsFromMessage(message),
  ]));
}

export function ReturnDetailPage() {
  const { returnId } = useParams();
  const location = useLocation();
  const appReadiness = useAppReadiness();
  const currentVendor = appReadiness.currentVendor;
  const currentUser = appReadiness.currentUser;
  const authContextReady = appReadiness.ready;
  const isAdmin = currentUser?.role === 'admin';
  const queryClient = useQueryClient();
  const { message, tone, showFeedback } = useActionFeedback();
  const [rejectReason, setRejectReason] = useState('');
  const [supportOpen, setSupportOpen] = useState(false);
  const [navlungoReturnPickupLiveConfirmed, setNavlungoReturnPickupLiveConfirmed] = useState(false);
  const [navlungoReturnPickupCarrierOverride, setNavlungoReturnPickupCarrierOverride] = useState<'current' | '9' | '10'>('current');
  const [navlungoReturnPickupEndpointPathOverride, setNavlungoReturnPickupEndpointPathOverride] =
    useState<'/post/create' | '/post/return'>('/post/return');
  const [returnPickupCompletion, setReturnPickupCompletion] = useState<Record<string, string>>({});
  const [retainedReturnPickupMissingFields, setRetainedReturnPickupMissingFields] = useState<string[]>([]);
  const [kargonomiReturnPreview, setKargonomiReturnPreview] = useState<KargonomiReturnPreview | null>(null);
  const returnDetailQueryEnabled = authContextReady && Boolean(returnId);
  const returnDetailEndpoint = returnId ? `/returns/${returnId}` : '/returns/:returnId';
  const returnDetailQueryKey = returnId
    ? queryKeys.returns.detail(returnId, currentVendor.vendorId)
    : queryKeys.returns.list(currentVendor.vendorId);
  const {
    data: returnRequest,
    isLoading,
    isError,
    error,
    diagnostics,
    status: returnQueryStatus,
    fetchStatus: returnFetchStatus,
    refetch,
  } = useQueryResource(
    returnDetailQueryKey,
    ({ signal }) => {
      if (!returnId) {
        throw new Error('Return not found.');
      }

      return getReturn(returnId, { vendorId: currentVendor.vendorId, signal });
    },
    {
      enabled: returnDetailQueryEnabled,
      routeName: 'ReturnDetailPage',
      endpoint: returnDetailEndpoint,
    },
  );
  const {
    data: relatedFinanceData,
    isError: relatedFinanceError,
    error: relatedFinanceErrorMessage,
    refetch: refetchRelatedFinance,
  } = useQueryResource(
    queryKeys.finance.returnRecords(
      currentVendor.vendorId,
      returnRequest?.sourceShopifyRefundId,
      returnRequest?.sourceShopifyOrderNumber,
    ),
    ({ signal }) =>
      getReturnFinanceRecords({
        vendorId: currentVendor.vendorId,
        shopifyRefundId: returnRequest?.sourceShopifyRefundId,
        shopifyOrderNumber: returnRequest?.sourceShopifyOrderNumber,
        signal,
      }),
    {
      enabled: authContextReady && Boolean(returnRequest),
      routeName: 'ReturnDetailPage.relatedFinance',
      endpoint: '/finance/return-records',
    },
  );
  const {
    data: relatedSupportTicketsData,
    isError: relatedSupportTicketsError,
    error: relatedSupportTicketsErrorMessage,
    refetch: refetchRelatedSupportTickets,
  } = useQueryResource(
    isAdmin ? queryKeys.admin.support.tickets() : queryKeys.support.tickets(currentVendor.vendorId),
    ({ signal }) => (isAdmin ? listAdminSupportTickets({ signal }) : listVendorSupportTickets({ signal })),
    {
      enabled: authContextReady && Boolean(returnRequest),
      routeName: 'ReturnDetailPage.relatedSupportTickets',
      endpoint: isAdmin ? '/admin/support/tickets' : '/support/tickets',
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
    (input: {
      dryRun?: boolean;
      apiVersionOverride?: 'current' | 'v2' | 'v2.1';
      endpointVersionOverride?: 'current' | 'v2' | 'v2.1';
      carrierOverride?: 'current' | '9' | '10';
      carrierIdOverride?: 'current' | '9' | '10';
      endpointPathOverride?: '/post/create' | '/post/return';
      diagnosticConfirm?: 'YES';
    }) => {
      if (!returnId) {
        throw new Error('Return not found.');
      }

      return createNavlungoReturnPickup(returnId, input, { vendorId: currentVendor.vendorId });
    },
    {
      onSuccess: async (data, variables) => {
        queryClient.setQueryData(returnDetailQueryKey, data);
        const nextMissingFields = collectReturnPickupMissingFields(data.returnProviderSnapshot ?? {});
        setRetainedReturnPickupMissingFields(nextMissingFields);
        showFeedback(
          variables.dryRun
            ? 'Navlungo return pickup preview generated. No provider call was made.'
            : 'Navlungo return pickup created.',
          variables.dryRun ? 'info' : 'success',
        );
        if (!variables.dryRun && data.returnProviderShipmentId) {
          setRetainedReturnPickupMissingFields([]);
          setNavlungoReturnPickupLiveConfirmed(false);
          setNavlungoReturnPickupCarrierOverride('current');
          setNavlungoReturnPickupEndpointPathOverride('/post/return');
        }
      },
      onError: async (error) => {
        await refetch();
        showFeedback(error instanceof Error ? error.message : 'Navlungo return pickup could not be created.', 'error');
      },
    },
  );
  const returnPickupAddressMutation = useMutationAction(
    () => {
      if (!returnId) {
        throw new Error('Return not found.');
      }

      return saveNavlungoReturnPickupAddressCompletion(
        returnId,
        {
          customerOverrides: returnPickupCompletion,
        },
        { vendorId: currentVendor.vendorId },
      );
    },
    {
      onSuccess: async (data) => {
        queryClient.setQueryData(returnDetailQueryKey, data);
        const nextMissingFields = collectReturnPickupMissingFields(data.returnProviderSnapshot ?? {});
        setRetainedReturnPickupMissingFields(nextMissingFields);
        if (nextMissingFields.length === 0 || data.returnProviderShipmentId) {
          setReturnPickupCompletion({});
        }
        showFeedback('Return pickup address saved.', 'success');
      },
      onError: (error) => {
        showFeedback(error instanceof Error ? error.message : 'Return pickup address could not be saved.', 'error');
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
  const kargonomiReturnPreviewMutation = useMutationAction(
    () => {
      if (!returnId) {
        throw new Error('Return not found.');
      }

      return getKargonomiReturnPreview(returnId, { vendorId: currentVendor.vendorId });
    },
    {
      onSuccess: (data) => {
        setKargonomiReturnPreview(data);
        showFeedback(data.ready ? 'Kargonomi return preview is ready.' : 'Kargonomi return preview needs configuration.', data.ready ? 'success' : 'info');
      },
      onError: (error) => {
        showFeedback(error instanceof Error ? error.message : 'Kargonomi return preview could not be generated.', 'error');
      },
    },
  );
  const kargonomiReturnCreateMutation = useMutationAction(
    () => {
      if (!returnId) {
        throw new Error('Return not found.');
      }

      return createKargonomiReturnShipment(returnId, { vendorId: currentVendor.vendorId });
    },
    {
      onSuccess: (data) => {
        queryClient.setQueryData(returnDetailQueryKey, data);
        setKargonomiReturnPreview(null);
        showFeedback('Kargonomi return shipment created.', 'success');
      },
      onError: async (error) => {
        await refetch();
        showFeedback(error instanceof Error ? error.message : 'Kargonomi return shipment could not be created.', 'error');
      },
    },
  );
  const currentReturnProviderSnapshot = returnRequest?.returnProviderSnapshot ?? {};
  const kargonomiPreviewShipment = readKargonomiPreviewShipment(kargonomiReturnPreview);
  const currentReturnPickupMissingFields = collectReturnPickupMissingFields(currentReturnProviderSnapshot, message);
  const currentReturnPickupMissingFieldsKey = currentReturnPickupMissingFields.join('|');
  const retainedReturnPickupMissingFieldsKey = retainedReturnPickupMissingFields.join('|');
  const [loadingTimedOut, setLoadingTimedOut] = useState(false);

  useEffect(() => {
    setRetainedReturnPickupMissingFields([]);
    setReturnPickupCompletion({});
    setKargonomiReturnPreview(null);
    setLoadingTimedOut(false);
  }, [returnId]);

  useEffect(() => {
    if (returnRequest || isError || isRenderableReturnDetail(returnRequest)) {
      setLoadingTimedOut(false);
      return;
    }
    if (authContextReady && !isLoading) {
      setLoadingTimedOut(false);
      return;
    }
    const timeout = globalThis.setTimeout(() => {
      setLoadingTimedOut(true);
    }, RETURN_DETAIL_LOADING_TIMEOUT_MS);

    return () => {
      globalThis.clearTimeout(timeout);
    };
  }, [authContextReady, isError, isLoading, returnRequest]);

  useEffect(() => {
    if (returnRequest?.returnProviderShipmentId) {
      if (retainedReturnPickupMissingFieldsKey) {
        setRetainedReturnPickupMissingFields([]);
      }
      return;
    }
    if (currentReturnPickupMissingFields.length === 0) {
      return;
    }
    setRetainedReturnPickupMissingFields((current) =>
      Array.from(new Set([...current, ...currentReturnPickupMissingFields])),
    );
  }, [
    currentReturnPickupMissingFieldsKey,
    retainedReturnPickupMissingFieldsKey,
    returnRequest?.returnProviderShipmentId,
  ]);

  const routeDiagnosticsNode = (
    <ReturnDetailRouteDiagnostics
      returnId={returnId}
      vendorId={currentVendor.vendorId}
      vendorName={currentVendor.vendorName}
      queryEnabled={returnDetailQueryEnabled}
      queryStatus={returnQueryStatus}
      fetchStatus={returnFetchStatus}
      endpoint={diagnostics?.endpoint ?? returnDetailEndpoint}
      httpStatus={diagnostics?.status ?? null}
      error={error}
    />
  );
  const renderReturnRouteFrame = (title: string, description: string, body: ReactNode) => (
    <section className="return-detail-page return-detail-loading-frame" aria-label="Return detail render frame">
      <div className="return-detail-header compact">
        <div>
          <p className="eyebrow">Returns</p>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
        <Link className="button button-secondary" to="/returns">
          Back to returns
        </Link>
      </div>
      <div className="return-review-layout">
        <main className="return-review-main" aria-label="Return primary content">
          <article className="return-review-card">
            <div className="return-review-card-header">
              <div>
                <p className="eyebrow">Returned items</p>
                <h3>Items</h3>
              </div>
            </div>
            {body}
          </article>
        </main>
        <aside className="return-review-side" aria-label="Return operational sidebar">
          <article className="return-review-card return-review-summary-card">
            <div className="return-review-card-header">
              <div>
                <p className="eyebrow">Summary</p>
                <h3>Return details</h3>
              </div>
            </div>
            <div className="return-review-summary-list" aria-label="Return summary skeleton">
              {['Order number', 'Requested', 'Return status', 'Refund status'].map((label) => (
                <div key={label}>
                  <span>{label}</span>
                  <strong>
                    <SkeletonText width={label === 'Order number' ? '6rem' : '5rem'} />
                  </strong>
                </div>
              ))}
            </div>
          </article>
          <article className="return-review-card operational-timeline-card">
            <div className="return-review-card-header">
              <div>
                <p className="eyebrow">Timeline</p>
                <h3>Timeline</h3>
              </div>
            </div>
            <div className="return-review-summary-list" aria-label="Return timeline skeleton">
              <div>
                <span>Event</span>
                <strong>
                  <SkeletonText width="8rem" />
                </strong>
              </div>
              <div>
                <span>Updated</span>
                <strong>
                  <SkeletonText width="6rem" />
                </strong>
              </div>
            </div>
          </article>
        </aside>
      </div>
    </section>
  );

  if (!returnId) {
    return renderReturnRouteFrame(
      'Return request not found',
      'The route is missing a return request id.',
      <>
        <SectionErrorRetry title="Route is missing a return id" description="The route is missing a return request id." />
        {routeDiagnosticsNode}
      </>,
    );
  }

  if (appReadiness.unauthorized) {
    return renderReturnRouteFrame(
      'Session required',
      'Sign in again to load this return request.',
      <>
        <SectionErrorRetry title="Authentication required" description="Sign in again to load this return request." />
        {routeDiagnosticsNode}
        <Link className="button button-secondary" to="/login">
          Go to login
        </Link>
      </>,
    );
  }

  if (appReadiness.sessionReady && !appReadiness.vendorReady) {
    return renderReturnRouteFrame(
      'Waiting for vendor context',
      'The return request cannot load until a vendor context is selected.',
      <>
        <EmptyStatePanel title="Vendor context unavailable" description="Select or restore vendor context to continue." />
        {routeDiagnosticsNode}
        <button type="button" className="button button-secondary" onClick={() => void refetch()}>
          Retry
        </button>
      </>,
    );
  }

  if (!authContextReady || (isLoading && !returnRequest)) {
    return renderReturnRouteFrame(
      'Return request',
      'Preparing the selected return for review.',
      <>
        {loadingTimedOut ? (
          <SectionErrorRetry
            title="Request timed out"
            description="The detail request did not finish in time."
            onRetry={() => void refetch()}
          />
        ) : (
          <div className="return-review-items" aria-label="Return item skeleton">
            {Array.from({ length: 2 }, (_, index) => (
              <div key={`return-detail-item-skeleton-${index}`} className="return-review-item-row op-skeleton-row">
                <div>
                  <SkeletonText width="12rem" />
                  <SkeletonText width="7rem" />
                </div>
                <SkeletonText width="4rem" />
              </div>
            ))}
          </div>
        )}
        {routeDiagnosticsNode}
      </>,
    );
  }

  if (isError || !returnRequest) {
    const errorStatus = diagnostics?.status ?? null;
    const title =
      errorStatus === 404
        ? 'Return request not found'
        : errorStatus === 403
          ? 'Return access denied'
          : 'Return unavailable';
    return renderReturnRouteFrame(
      title,
      error ?? 'The selected return could not be loaded.',
      <>
        <SectionErrorRetry
          title="Return detail request failed"
          description={error ?? 'The selected return could not be loaded.'}
          onRetry={() => void refetch()}
        />
        {routeDiagnosticsNode}
      </>,
    );
  }

  if (!isRenderableReturnDetail(returnRequest)) {
    return renderReturnRouteFrame(
      'Return response unavailable',
      'The return detail response was empty or malformed. Retry the request.',
      <>
        <SectionErrorRetry
          title="Malformed return response"
          description="The return detail response was empty or malformed. Retry the request."
          onRetry={() => void refetch()}
        />
        {routeDiagnosticsNode}
      </>,
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
  const returnProviderSnapshot = currentReturnProviderSnapshot;
  const navlungoReturnRequestSummary = (
    returnProviderSnapshot.navlungoReturnRequestSummary ??
    returnProviderSnapshot.navlungoReturnPickupPayloadSummary
  ) as
    | Record<string, unknown>
    | undefined;
  const navlungoReturnPickupPayloadSummary = returnProviderSnapshot.navlungoReturnPickupPayloadSummary as
    | Record<string, unknown>
    | undefined;
  const navlungoReturnPickupMissingFields = returnRequest.returnProviderShipmentId
    ? []
    : Array.from(new Set([...currentReturnPickupMissingFields, ...retainedReturnPickupMissingFields]));
  const returnPickupCompletionFields = RETURN_PICKUP_COMPLETION_FIELDS.filter(
    (field) => navlungoReturnPickupMissingFields.includes(field.field) || (!field.required && navlungoReturnPickupMissingFields.length > 0),
  );
  const shouldRenderReturnPickupCompletion = isAdmin && returnPickupCompletionFields.length > 0 && !returnRequest.returnProviderShipmentId;
  const navlungoReturnAutoCreateAttempted = returnProviderSnapshot.navlungoReturnAutoCreateAttempted === true;
  const navlungoReturnAutoCreateSkippedReason =
    typeof returnProviderSnapshot.navlungoReturnAutoCreateSkippedReason === 'string'
      ? returnProviderSnapshot.navlungoReturnAutoCreateSkippedReason
      : null;
  const navlungoReturnCreateHttpStatus =
    readSnapshotNumber(returnProviderSnapshot, 'navlungoReturnCreateHttpStatus') ??
    readSnapshotNumber(returnProviderSnapshot, 'httpStatus');
  const navlungoReturnCreateSucceeded = readSnapshotBoolean(returnProviderSnapshot, 'navlungoReturnCreateSucceeded');
  const navlungoReturnRequestedBarcodeFormat =
    readSnapshotString(returnProviderSnapshot, 'navlungoReturnRequestedBarcodeFormat') ??
    (typeof navlungoReturnRequestSummary?.requestedBarcodeFormat === 'string'
      ? navlungoReturnRequestSummary.requestedBarcodeFormat
      : null);
  const navlungoReturnRequestedCarrierId =
    returnProviderSnapshot.navlungoReturnRequestedCarrierId ?? navlungoReturnRequestSummary?.requestedCarrierId ?? null;
  const navlungoReturnRequestedPostType =
    returnProviderSnapshot.navlungoReturnRequestedPostType ?? navlungoReturnRequestSummary?.requestedPostType ?? null;
  const navlungoReturnEndpointVersionTried = readSnapshotString(returnProviderSnapshot, 'navlungoReturnEndpointVersionTried');
  const navlungoReturnEndpointPathTried = readSnapshotString(returnProviderSnapshot, 'navlungoReturnEndpointPathTried');
  const navlungoReturnResolvedProviderPath = readSnapshotString(returnProviderSnapshot, 'navlungoReturnResolvedProviderPath');
  const navlungoReturnResolvedProviderUrl = readSnapshotString(returnProviderSnapshot, 'navlungoReturnResolvedProviderUrl');
  const returnPickupMissingSenderFields = navlungoReturnPickupMissingFields.some((field) => field.startsWith('sender.'));
  const returnPickupEndpointIsValid = navlungoReturnPickupEndpointPathOverride === '/post/return';
  const returnPickupRecipientAddressIdReady =
    returnProviderSnapshot.recipientAddressIdValid === true ||
    (returnProviderSnapshot.navlungoReturnRecipientAddressIdPresent === true &&
      returnProviderSnapshot.navlungoReturnRecipientAddressIdNumeric === true);
  const returnPickupReadyForLiveCreate =
    !returnPickupMissingSenderFields &&
    returnPickupRecipientAddressIdReady &&
    returnPickupEndpointIsValid;
  const returnPickupPreviewDisabled =
    navlungoReturnPickupMutation.isPending ||
    returnPickupMissingSenderFields ||
    !returnPickupEndpointIsValid;
  const returnPickupBlockedReason = returnPickupMissingSenderFields
    ? 'Complete pickup address before preview or live create.'
    : !returnPickupEndpointIsValid
      ? 'Return pickup must use /post/return, not /post/create.'
      : !returnPickupRecipientAddressIdReady
        ? 'Preview return pickup after configuring a numeric return recipient addressId.'
        : null;
  const navlungoReturnProviderMessage =
    readSnapshotString(returnProviderSnapshot, 'navlungoReturnProviderMessage') ??
    readSnapshotString(returnProviderSnapshot, 'providerMessage');
  const navlungoReturnProviderTrackingId =
    readSnapshotString(returnProviderSnapshot, 'navlungoReturnProviderTrackingId') ??
    readSnapshotString(returnProviderSnapshot, 'providerTrackingId');
  const navlungoReturnValidationFields = readSnapshotStringArrays(returnProviderSnapshot, [
    'navlungoReturnValidationFields',
    'navlungoReturnCreateValidationFields',
    'failedFieldNames',
    'validationErrorKeys',
  ]);
  const navlungoReturnValidationMessages = readSnapshotStringArrays(returnProviderSnapshot, [
    'navlungoReturnValidationMessages',
    'providerValidationErrors',
    'validationErrorMessages',
  ]);
  const navlungoReturnValidationResponseShape = returnProviderSnapshot.navlungoReturnValidationResponseShape;
  const navlungoReturnCreateRequestJson = formatDiagnosticJson(returnProviderSnapshot.navlungoReturnCreateRequest);
  const navlungoReturnCreateResponseBodyJson = formatDiagnosticJson(returnProviderSnapshot.navlungoReturnCreateResponseBody);
  const returnProviderSnapshotResponseKeys = Object.keys(returnProviderSnapshot).sort();
  const shouldRenderNavlungoAutoCreateDiagnostics =
    isAdmin &&
    returnRequest.sourceType === 'shopify_return_request' &&
    (returnProviderSnapshotResponseKeys.length > 0 ||
      navlungoReturnAutoCreateAttempted ||
      Boolean(navlungoReturnAutoCreateSkippedReason) ||
      Boolean(returnRequest.returnProviderShipmentId));
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
  const returnWorkflowGuidance = getReturnWorkflowAction({
    status: returnRequest.status,
    sourceType: returnRequest.sourceType,
    vendorReceivedAt: returnRequest.vendorReceivedAt,
    vendorDecision: returnRequest.vendorDecision,
    refundStatus: getRefundStatus(returnRequest),
  });
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
  const relatedFinanceRecords = safeArray(relatedFinanceData?.records);
  const relatedSupportTickets = safeArray(relatedSupportTicketsData).filter((ticket) =>
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
      title: ticket.subject ?? 'Support ticket',
      description: ticket.vendorName ?? ticket.vendorId,
      href: `${supportBasePath}/${ticket.id}`,
      status: safeStatusLabel(ticket.status),
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
      description: ticket.subject ?? 'Support ticket',
      at: ticket.createdAt,
      status: safeStatusLabel(ticket.status),
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
              : formatDiagnosticToken(navlungoReturnAutoCreateSkippedReason),
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
                    <ProductImagePreview
                      imageUrl={item.imageUrl}
                      fallbackLabel={getItemInitials(item.name || item.sku)}
                      alt={getReturnItemImageAlt(item)}
                      title={item.name || item.sku || 'Returned item'}
                      subtitle={[item.sku, getVariantText(item.variantTitle)].filter((value) => value && value !== '—').join(' · ')}
                      size="sidebar"
                    />
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
          {relatedFinanceError ? (
            <SectionErrorRetry
              title="Finance records could not load"
              description={relatedFinanceErrorMessage ?? 'Retry the finance section.'}
              onRetry={() => void refetchRelatedFinance()}
            />
          ) : null}
          {relatedSupportTicketsError ? (
            <SectionErrorRetry
              title="Support tickets could not load"
              description={relatedSupportTicketsErrorMessage ?? 'Retry the support section.'}
              onRetry={() => void refetchRelatedSupportTickets()}
            />
          ) : null}
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
            <WorkflowActionGuidance
              actionLabel={returnWorkflowGuidance.actionLabel}
              description={returnWorkflowGuidance.description}
              tone={returnWorkflowGuidance.tone}
            />
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
                  <strong>{formatDiagnosticToken(navlungoReturnAutoCreateSkippedReason)}</strong>
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

          {shouldRenderNavlungoAutoCreateDiagnostics ? (
            <details className="return-review-card provider-response-summary admin-diagnostics-panel" aria-label="Navlungo return auto-create diagnostics">
              <summary className="return-review-card-header">
                <div>
                  <p className="eyebrow">Navlungo diagnostics</p>
                  <h3>Return pickup auto-create</h3>
                </div>
              </summary>
              <div className="return-review-summary-list">
                <div>
                  <span>Auto-create attempted</span>
                  <strong>{formatDiagnosticBoolean(navlungoReturnAutoCreateAttempted)}</strong>
                </div>
                <div>
                  <span>Skipped reason</span>
                  <strong>{formatDiagnosticToken(navlungoReturnAutoCreateSkippedReason)}</strong>
                </div>
                <div>
                  <span>Missing fields</span>
                  <strong>{formatDiagnosticList(navlungoReturnPickupMissingFields)}</strong>
                </div>
                <div>
                  <span>Create HTTP</span>
                  <strong>{navlungoReturnCreateHttpStatus ?? '—'}</strong>
                </div>
                <div>
                  <span>Create succeeded</span>
                  <strong>{formatDiagnosticBoolean(navlungoReturnCreateSucceeded)}</strong>
                </div>
                <div>
                  <span>Requested post type</span>
                  <strong>{navlungoReturnRequestedPostType !== null ? String(navlungoReturnRequestedPostType) : '—'}</strong>
                </div>
                <div>
                  <span>Requested carrier</span>
                  <strong>{navlungoReturnRequestedCarrierId !== null ? String(navlungoReturnRequestedCarrierId) : '—'}</strong>
                </div>
                <div>
                  <span>Endpoint version tried</span>
                  <strong>{navlungoReturnEndpointVersionTried ?? '—'}</strong>
                </div>
                <div>
                  <span>Endpoint path tried</span>
                  <strong>{navlungoReturnEndpointPathTried ?? '—'}</strong>
                </div>
                <div>
                  <span>Resolved provider path</span>
                  <strong>{navlungoReturnResolvedProviderPath ?? '—'}</strong>
                </div>
                <div>
                  <span>Resolved provider URL</span>
                  <strong>{navlungoReturnResolvedProviderUrl ?? '—'}</strong>
                </div>
                <div>
                  <span>Requested barcode format</span>
                  <strong>{navlungoReturnRequestedBarcodeFormat ?? '—'}</strong>
                </div>
                <div>
                  <span>Provider message</span>
                  <strong>{navlungoReturnProviderMessage ?? '—'}</strong>
                </div>
                <div>
                  <span>Provider tracking ID</span>
                  <strong>{navlungoReturnProviderTrackingId ?? '—'}</strong>
                </div>
                <div>
                  <span>Validation fields</span>
                  <strong>{formatDiagnosticList(navlungoReturnValidationFields)}</strong>
                </div>
                <div>
                  <span>Validation messages</span>
                  <strong>{formatDiagnosticList(navlungoReturnValidationMessages)}</strong>
                </div>
                <div>
                  <span>Validation response shape</span>
                  <strong>
                    {isRecord(navlungoReturnValidationResponseShape)
                      ? [
                          typeof navlungoReturnValidationResponseShape.kind === 'string'
                            ? navlungoReturnValidationResponseShape.kind
                            : null,
                          Array.isArray(navlungoReturnValidationResponseShape.topLevelKeys)
                            ? navlungoReturnValidationResponseShape.topLevelKeys.join(', ')
                            : null,
                        ].filter(Boolean).join(' · ') || '—'
                      : '—'}
                  </strong>
                </div>
                <div>
                  <span>Provider post number</span>
                  <strong>{returnRequest.returnProviderShipmentId ?? '—'}</strong>
                </div>
                <div>
                  <span>Tracking URL</span>
                  {returnRequest.returnTrackingUrl ? (
                    <a href={returnRequest.returnTrackingUrl} target="_blank" rel="noreferrer">
                      Open tracking
                    </a>
                  ) : (
                    <strong>—</strong>
                  )}
                </div>
                <div>
                  <span>Barcode / label</span>
                  <strong>{returnRequest.returnLabel ? 'available' : '—'}</strong>
                </div>
                <div>
                  <span>Snapshot response keys</span>
                  <strong>{formatDiagnosticList(returnProviderSnapshotResponseKeys)}</strong>
                </div>
                {navlungoReturnCreateRequestJson ? (
                  <div className="return-diagnostics-json">
                    <span>Redacted create request</span>
                    <pre>{navlungoReturnCreateRequestJson}</pre>
                  </div>
                ) : null}
                {navlungoReturnCreateResponseBodyJson ? (
                  <div className="return-diagnostics-json">
                    <span>Redacted provider response body</span>
                    <pre>{navlungoReturnCreateResponseBodyJson}</pre>
                  </div>
                ) : null}
                {navlungoReturnRequestSummary ? (
                  <>
                    <div>
                      <span>Request base URL</span>
                      <strong>{String(navlungoReturnRequestSummary.baseUrl ?? '—')}</strong>
                    </div>
                    <div>
                      <span>Request endpoint</span>
                      <strong>{String(navlungoReturnRequestSummary.endpointPath ?? '/post/return')}</strong>
                    </div>
                    <div>
                      <span>Top-level body keys</span>
                      <strong>
                        {Array.isArray(navlungoReturnRequestSummary.topLevelBodyKeys)
                          ? navlungoReturnRequestSummary.topLevelBodyKeys.join(', ')
                          : '—'}
                      </strong>
                    </div>
                    <div>
                      <span>Post keys</span>
                      <strong>
                        {Array.isArray(navlungoReturnRequestSummary.postKeys)
                          ? navlungoReturnRequestSummary.postKeys.join(', ')
                          : '—'}
                      </strong>
                    </div>
                    <div>
                      <span>Sender keys</span>
                      <strong>
                        {Array.isArray(navlungoReturnRequestSummary.senderKeys)
                          ? navlungoReturnRequestSummary.senderKeys.join(', ')
                          : '—'}
                      </strong>
                    </div>
                    <div>
                      <span>Recipient keys</span>
                      <strong>
                        {Array.isArray(navlungoReturnRequestSummary.recipientKeys)
                          ? navlungoReturnRequestSummary.recipientKeys.join(', ')
                          : '—'}
                      </strong>
                    </div>
                    <div>
                      <span>Recipient addressId</span>
                      <strong>{returnProviderSnapshot.recipientAddressIdValid === true ? 'valid' : 'missing'}</strong>
                    </div>
                    <div>
                      <span>Recipient addressId source</span>
                      <strong>
                        {typeof returnProviderSnapshot.navlungoReturnResolvedRecipientAddressIdSource === 'string'
                          ? returnProviderSnapshot.navlungoReturnResolvedRecipientAddressIdSource
                          : typeof returnProviderSnapshot.navlungoReturnRecipientAddressIdSource === 'string'
                            ? returnProviderSnapshot.navlungoReturnRecipientAddressIdSource
                            : '—'}
                      </strong>
                    </div>
                    <div>
                      <span>Recipient addressId resolved</span>
                      <strong>
                        {returnProviderSnapshot.navlungoReturnRecipientAddressIdPresent === true ? 'yes' : 'no'}
                        {' · numeric '}
                        {returnProviderSnapshot.navlungoReturnResolvedRecipientAddressIdNumeric === true ||
                        returnProviderSnapshot.navlungoReturnRecipientAddressIdNumeric === true
                          ? 'yes'
                          : 'no'}
                      </strong>
                    </div>
                    <div>
                      <span>Original sender mode</span>
                      <strong>
                        {typeof returnProviderSnapshot.navlungoReturnOriginalSenderMode === 'string'
                          ? returnProviderSnapshot.navlungoReturnOriginalSenderMode
                          : 'unknown'}
                      </strong>
                    </div>
                    <div>
                      <span>Original sender addressId</span>
                      <strong>
                        {returnProviderSnapshot.navlungoReturnOriginalPayloadSenderAddressIdPresent === true
                          ? 'present'
                          : 'absent'}
                      </strong>
                    </div>
                    <div>
                      <span>Original warehouse addressId</span>
                      <strong>
                        {returnProviderSnapshot.navlungoReturnOriginalWarehouseAddressIdPresent === true
                          ? 'present'
                          : 'absent'}
                      </strong>
                    </div>
                    <div>
                      <span>Fallback used</span>
                      <strong>{returnProviderSnapshot.navlungoReturnRecipientFallbackUsed === true ? 'yes' : 'no'}</strong>
                    </div>
                    <p className="muted">
                      Navlungo returns should go back to the original shipment warehouse addressId.
                    </p>
                    <div>
                      <span>Return recipient metadata</span>
                      <strong>
                        {returnProviderSnapshot.navlungoReturnRecipientMetadataConfigured === true ? 'configured' : 'optional'}
                      </strong>
                    </div>
                    <div>
                      <span>Return recipient</span>
                      <strong>
                        {[
                          returnProviderSnapshot.navlungoReturnRecipientName,
                          returnProviderSnapshot.navlungoReturnRecipientCity,
                          returnProviderSnapshot.navlungoReturnRecipientDistrict,
                        ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0).join(' · ') || '—'}
                      </strong>
                    </div>
                    <div>
                      <span>Post payload keys</span>
                      <strong>
                        {Array.isArray(navlungoReturnRequestSummary.postPayloadKeys)
                          ? navlungoReturnRequestSummary.postPayloadKeys.join(', ')
                          : '—'}
                      </strong>
                    </div>
                    <div>
                      <span>Desi</span>
                      <strong>
                        {navlungoReturnRequestSummary.desiPresent === true
                          ? `${String(navlungoReturnRequestSummary.requestedDesi ?? 'present')} (${String(navlungoReturnRequestSummary.desiType ?? 'unknown')})`
                          : 'missing'}
                      </strong>
                    </div>
                    <div>
                      <span>Package count</span>
                      <strong>
                        {navlungoReturnRequestSummary.packageCountPresent === true
                          ? `${String(navlungoReturnRequestSummary.requestedPackageCount ?? 'present')} (${String(navlungoReturnRequestSummary.packageCountType ?? 'unknown')})`
                          : 'missing'}
                      </strong>
                    </div>
                    <div>
                      <span>Price field</span>
                      <strong>
                        {navlungoReturnRequestSummary.postPricePresent === true
                          ? String(navlungoReturnRequestSummary.postPriceType ?? 'present')
                          : 'missing'}
                      </strong>
                    </div>
                    <div>
                      <span>Custom data</span>
                      <strong>
                        {[
                          navlungoReturnRequestSummary.customData1Present ? 'custom_data_1' : null,
                          navlungoReturnRequestSummary.customData2Present ? 'custom_data_2' : null,
                          navlungoReturnRequestSummary.customData3Present ? 'custom_data_3' : null,
                          navlungoReturnRequestSummary.customData4Present ? 'custom_data_4' : null,
                        ].filter(Boolean).join(', ') || '—'}
                      </strong>
                    </div>
                  </>
                ) : null}
              </div>
            </details>
          ) : null}

          {returnRequest.sourceType === 'shopify_return_request' ? (
            <article className="return-review-card">
              <div className="return-review-card-header">
                <div>
                  <p className="eyebrow">Kargonomi return preview</p>
                  <h3>Customer to warehouse readiness</h3>
                </div>
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={kargonomiReturnPreviewMutation.isPending}
                  onClick={() => void kargonomiReturnPreviewMutation.mutateAsync(undefined)}
                >
                  {kargonomiReturnPreviewMutation.isPending ? 'Previewing...' : 'Kargonomi return preview'}
                </button>
                {isAdmin && !returnRequest.returnProviderShipmentId ? (
                  <button
                    type="button"
                    className="button button-primary"
                    disabled={kargonomiReturnCreateMutation.isPending}
                    onClick={() => void kargonomiReturnCreateMutation.mutateAsync(undefined)}
                  >
                    {kargonomiReturnCreateMutation.isPending ? 'Creating...' : 'Create Kargonomi Return Shipment'}
                  </button>
                ) : null}
              </div>
              <div className="return-review-summary-list">
                <div>
                  <span>Status</span>
                  <strong>
                    {kargonomiReturnPreview ? (kargonomiReturnPreview.ready ? 'Ready' : 'Not ready') : 'Not checked'}
                  </strong>
                </div>
                <div>
                  <span>Direction</span>
                  <strong>{kargonomiReturnPreview?.direction.replace(/_/g, ' ') ?? 'Customer to vendor'}</strong>
                </div>
                <div>
                  <span>City / state IDs</span>
                  <strong>
                    {kargonomiReturnPreview
                      ? [
                          kargonomiPreviewShipment.sender.cityId ? `city ${String(kargonomiPreviewShipment.sender.cityId)}` : 'city missing',
                          kargonomiPreviewShipment.sender.stateId ? `state ${String(kargonomiPreviewShipment.sender.stateId)}` : 'state missing',
                        ].join(', ')
                      : 'Not checked'}
                  </strong>
                </div>
                <div>
                  <span>Warehouse</span>
                  <strong>
                    {kargonomiReturnPreview
                      ? [
                          kargonomiPreviewShipment.receiver.warehouseId
                            ? `warehouse ${String(kargonomiPreviewShipment.receiver.warehouseId)}`
                            : 'warehouse missing',
                          kargonomiPreviewShipment.receiver.namePresent === true ? 'name ready' : 'name missing',
                          kargonomiPreviewShipment.receiver.phonePresent === true ? 'phone ready' : 'phone missing',
                          kargonomiPreviewShipment.receiver.addressPresent === true ? 'address ready' : 'address missing',
                        ].join(', ')
                      : 'Not checked'}
                  </strong>
                </div>
                {returnRequest.returnProvider?.toLowerCase() === 'kargonomi' && returnRequest.returnProviderShipmentId ? (
                  <>
                    <div>
                      <span>Return shipment id</span>
                      <strong>{returnRequest.returnProviderShipmentId}</strong>
                    </div>
                    <div>
                      <span>Carrier</span>
                      <strong>{returnRequest.returnCarrierName ?? 'Kargonomi'}</strong>
                    </div>
                    <div>
                      <span>Tracking</span>
                      <strong>{returnRequest.returnTrackingNumber ?? 'pending'}</strong>
                    </div>
                    <div>
                      <span>Label</span>
                      <strong>{returnRequest.returnLabel ? 'available' : 'pending'}</strong>
                    </div>
                  </>
                ) : null}
                <div>
                  <span>Missing fields</span>
                  <strong>{kargonomiReturnPreview ? formatDiagnosticList(kargonomiReturnPreview.missingFields) : 'Not checked'}</strong>
                </div>
                {kargonomiReturnPreview?.notes.length ? (
                  <div>
                    <span>Notes</span>
                    <strong>{kargonomiReturnPreview.notes.join(' ')}</strong>
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
                  <p className="muted">Complete pickup address, preview the return payload, then create the live pickup.</p>
                  {shouldRenderReturnPickupCompletion ? (
                    <div className="return-pickup-completion-form" aria-label="Return pickup address completion">
                      <strong>1. Complete pickup address</strong>
                      <span>Only fill fields missing for this return pickup.</span>
                      {returnPickupCompletionFields.map((field) => (
                        <label key={field.field}>
                          <span>{field.label}{field.required ? '' : ' (optional)'}</span>
                          <input
                            value={returnPickupCompletion[field.key] ?? ''}
                            onChange={(event) =>
                              setReturnPickupCompletion((current) => ({
                                ...current,
                                [field.key]: event.target.value,
                              }))
                            }
                            placeholder={field.field}
                          />
                        </label>
                      ))}
                      <button
                        type="button"
                        className="button button-secondary"
                        disabled={returnPickupAddressMutation.isPending}
                        onClick={() => void returnPickupAddressMutation.mutateAsync(undefined)}
                      >
                        {returnPickupAddressMutation.isPending ? 'Saving...' : 'Save return pickup address'}
                      </button>
                    </div>
                  ) : null}
                  <div className="return-review-actions return-review-preview-actions">
                    <button
                      type="button"
                      className="button button-secondary"
                      disabled={returnPickupPreviewDisabled}
                      onClick={() =>
                        void navlungoReturnPickupMutation
                          .mutateAsync({
                            dryRun: true,
                            endpointVersionOverride: 'v2.1',
                            carrierIdOverride: navlungoReturnPickupCarrierOverride,
                            endpointPathOverride: navlungoReturnPickupEndpointPathOverride,
                          })
                          .catch(() => undefined)
                      }
                    >
                      {navlungoReturnPickupMutation.isPending ? 'Previewing...' : '2. Preview Navlungo return pickup'}
                    </button>
                  </div>
                  {returnPickupBlockedReason ? <p className="muted">{returnPickupBlockedReason}</p> : null}
                  {navlungoReturnPickupPayloadSummary ? (
                    <div className="provider-response-summary" aria-label="Navlungo return pickup payload summary">
                      <div className="summary-row">
                        <span>Endpoint</span>
                        <strong>{String(navlungoReturnPickupPayloadSummary.endpointPath ?? '/post/return')}</strong>
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
                        <span>Recipient addressId source</span>
                        <strong>
                          {typeof returnProviderSnapshot.navlungoReturnResolvedRecipientAddressIdSource === 'string'
                            ? returnProviderSnapshot.navlungoReturnResolvedRecipientAddressIdSource
                            : typeof returnProviderSnapshot.navlungoReturnRecipientAddressIdSource === 'string'
                              ? returnProviderSnapshot.navlungoReturnRecipientAddressIdSource
                              : '—'}
                        </strong>
                      </div>
                      <div className="summary-row">
                        <span>Recipient addressId resolved</span>
                        <strong>
                          {returnProviderSnapshot.navlungoReturnRecipientAddressIdPresent === true ? 'yes' : 'no'}
                          {' · numeric '}
                          {returnProviderSnapshot.navlungoReturnResolvedRecipientAddressIdNumeric === true ||
                          returnProviderSnapshot.navlungoReturnRecipientAddressIdNumeric === true
                            ? 'yes'
                            : 'no'}
                        </strong>
                      </div>
                      <div className="summary-row">
                        <span>Original sender mode</span>
                        <strong>
                          {typeof returnProviderSnapshot.navlungoReturnOriginalSenderMode === 'string'
                            ? returnProviderSnapshot.navlungoReturnOriginalSenderMode
                            : 'unknown'}
                        </strong>
                      </div>
                      <div className="summary-row">
                        <span>Original sender addressId</span>
                        <strong>
                          {returnProviderSnapshot.navlungoReturnOriginalPayloadSenderAddressIdPresent === true
                            ? 'present'
                            : 'absent'}
                        </strong>
                      </div>
                      <div className="summary-row">
                        <span>Original warehouse addressId</span>
                        <strong>
                          {returnProviderSnapshot.navlungoReturnOriginalWarehouseAddressIdPresent === true
                            ? 'present'
                            : 'absent'}
                        </strong>
                      </div>
                      <div className="summary-row">
                        <span>Fallback used</span>
                        <strong>{returnProviderSnapshot.navlungoReturnRecipientFallbackUsed === true ? 'yes' : 'no'}</strong>
                      </div>
                      <p className="muted">
                        Navlungo returns should go back to the original shipment warehouse addressId.
                      </p>
                      <div className="summary-row">
                        <span>Return recipient metadata</span>
                        <strong>
                          {returnProviderSnapshot.navlungoReturnRecipientMetadataConfigured === true ? 'configured' : 'optional'}
                        </strong>
                      </div>
                      <div className="summary-row">
                        <span>Return recipient</span>
                        <strong>
                          {[
                            returnProviderSnapshot.navlungoReturnRecipientName,
                            returnProviderSnapshot.navlungoReturnRecipientCity,
                            returnProviderSnapshot.navlungoReturnRecipientDistrict,
                          ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0).join(' · ') || '—'}
                        </strong>
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
                    <span>3. Live create</span>
                    {isAdmin ? (
                      <div className="return-review-compact-grid" aria-label="Navlungo return pickup diagnostics options">
                        <div>
                          <span>API version</span>
                          <strong>v2.1</strong>
                          <small>Navlungo return pickup uses v2.1 /post/return.</small>
                        </div>
                        <label>
                          <span>Carrier</span>
                          <select
                            value={navlungoReturnPickupCarrierOverride}
                            onChange={(event) =>
                              setNavlungoReturnPickupCarrierOverride(event.target.value as 'current' | '9' | '10')
                            }
                          >
                            <option value="current">Current carrier</option>
                            <option value="9">9 - Surat Kargo</option>
                            <option value="10">10 - HepsiJet</option>
                          </select>
                        </label>
                        <div>
                          <span>Endpoint path</span>
                          <strong>/post/return</strong>
                        </div>
                      </div>
                    ) : null}
                    {returnPickupReadyForLiveCreate ? (
                      <>
                        <label className="checkbox-row">
                          <input
                            type="checkbox"
                            checked={navlungoReturnPickupLiveConfirmed}
                            onChange={(event) => setNavlungoReturnPickupLiveConfirmed(event.target.checked)}
                          />
                          <span>I understand this may create a live Navlungo return pickup.</span>
                        </label>
                        <button
                          type="button"
                          className="button button-primary"
                          disabled={navlungoReturnPickupMutation.isPending || !navlungoReturnPickupLiveConfirmed}
                          onClick={() =>
                            void navlungoReturnPickupMutation
                              .mutateAsync({
                                dryRun: false,
                                endpointVersionOverride: 'v2.1',
                                carrierIdOverride: navlungoReturnPickupCarrierOverride,
                                endpointPathOverride: navlungoReturnPickupEndpointPathOverride,
                                diagnosticConfirm: navlungoReturnPickupLiveConfirmed ? 'YES' : undefined,
                              })
                              .catch(() => undefined)
                          }
                        >
                          {navlungoReturnPickupMutation.isPending ? 'Creating...' : 'Create live Navlungo return pickup'}
                        </button>
                      </>
                    ) : (
                      <p className="muted">{returnPickupBlockedReason ?? 'Preview return pickup before live create.'}</p>
                    )}
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
