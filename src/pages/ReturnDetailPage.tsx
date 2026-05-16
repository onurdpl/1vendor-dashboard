import { useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { DataStatePanel } from '../components/DataStatePanel';
import { EmptyStatePanel, StatusBadge } from '../components/OperationalPrimitives';
import { queryKeys } from '../lib/api/queryKeys';
import { useQueryResource } from '../hooks/useQueryResource';
import { useMutationAction } from '../hooks/useMutationAction';
import {
  getReturn,
  markReturnReceived,
  reviewReturn,
  type ReturnDetail,
  type ReturnLineItem,
} from '../features/returns/api';
import { getCurrentUser, getCurrentVendorContext } from '../lib/auth';
import { formatShopifyOrderNumber } from '../lib/formatOrderDisplay';
import { useActionFeedback } from '../lib/ui';
import { SupportTicketModal } from '../components/SupportTicketModal';

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

export function ReturnDetailPage() {
  const { returnId } = useParams();
  const location = useLocation();
  const currentVendor = getCurrentVendorContext();
  const currentUser = getCurrentUser();
  const { message, tone, showFeedback } = useActionFeedback();
  const [rejectReason, setRejectReason] = useState('');
  const [supportOpen, setSupportOpen] = useState(false);
  const { data: returnRequest, isLoading, isError, error, refetch } = useQueryResource(
    returnId ? queryKeys.returns.detail(returnId) : queryKeys.returns.list(),
    () => {
      if (!returnId) {
        throw new Error('Return not found.');
      }

      return getReturn(returnId);
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

  if (isLoading) {
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
    returnRequest.returnCarrierName || returnRequest.returnTrackingNumber || returnRequest.returnTrackingUrl,
  );
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
                    <span className="return-review-item-thumb" aria-hidden="true">↩</span>
                    <div className="return-review-item-main">
                      <strong>{item.name || 'Return item'}</strong>
                      <span>{getVariantText(item.variantTitle)}</span>
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
        </main>

        <aside className="return-review-side">
          <article className="return-review-card return-review-action-card">
            <p className="eyebrow">Next action</p>
            <h3>Vendor review</h3>
            <p>Internal vendor review only. This does not issue a Shopify refund.</p>
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
              </div>
            </article>
          ) : null}

          <article className="return-review-card">
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

          <article className="return-review-card">
            <div className="return-review-card-header">
              <div>
                <p className="eyebrow">Timeline</p>
                <h3>Progress</h3>
              </div>
            </div>
            <ol className="return-review-timeline">
              {timeline.map((entry, index) => (
                <li key={`${entry.label}-${entry.at}-${index}`}>
                  <span aria-hidden="true" />
                  <div>
                    <strong>{entry.label}</strong>
                    <small>{entry.at}</small>
                  </div>
                </li>
              ))}
            </ol>
          </article>
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
