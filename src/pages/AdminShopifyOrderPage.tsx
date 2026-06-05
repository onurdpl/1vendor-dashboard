import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ActionFeedback } from '../components/ActionFeedback';
import { SectionErrorRetry, SectionSkeleton } from '../components/OperationalPrimitives';
import {
  createParatikaHostedPaymentLink,
  getAdminShopifyOrderBreakdown,
  type ParatikaSessionTokenLiveProbeResult,
} from '../features/orders/api';
import { useMutationAction } from '../hooks/useMutationAction';
import { useQueryResource } from '../hooks/useQueryResource';
import { useAppReadiness } from '../lib/appReadiness';
import { queryKeys } from '../lib/api/queryKeys';
import { useActionFeedback } from '../lib/ui';
import { formatShopifyOrderNumber } from '../lib/formatOrderDisplay';
import { formatDateTime } from '../services/real/formatting';

function formatDate(value: string) {
  return formatDateTime(value, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function getClassToken(value: string | null | undefined) {
  return (value ?? 'unknown').toLowerCase().replace(/\s+/g, '-');
}

function getSafeProbeText(value: string | null | undefined) {
  if (!value?.trim()) {
    return null;
  }

  return value
    .replace(/((?:access|refresh|session)[_-]?token|token|password|secret|merchantpassword|merchantuser)\s*[:=]\s*[^&\s,}]+/gi, '$1=[redacted]')
    .slice(0, 180);
}

function getProbeErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return getSafeProbeText(error.message) ?? 'Paratika probe failed.';
  }

  return 'Paratika probe failed.';
}

export function AdminShopifyOrderPage() {
  const { shopifyOrderId } = useParams();
  const appReadiness = useAppReadiness();
  const { message, tone, showFeedback } = useActionFeedback();
  const [paratikaProbeResult, setParatikaProbeResult] = useState<ParatikaSessionTokenLiveProbeResult | null>(null);
  const reassignAllocation = useMutationAction(
    async (payload: { allocationOrderId: string; nextVendorId: string }) => payload,
    {
      onSuccess: (result) => {
        showFeedback(
          `Reassignment request prepared for ${result.allocationOrderId} -> ${result.nextVendorId} (mock only).`,
          'success',
        );
      },
      onError: () => {
        showFeedback('Unable to prepare reassignment request.', 'error');
      },
    },
  );
  const paratikaLiveProbe = useMutationAction(
    async () => {
      if (!shopifyOrderId) {
        throw new Error('Shopify order id is missing.');
      }

      return createParatikaHostedPaymentLink(shopifyOrderId);
    },
    {
      onSuccess: (result) => {
        setParatikaProbeResult(result);
        showFeedback(
          result.hostedPaymentUrl
            ? 'Paratika hosted payment link created for manual testing.'
            : 'Paratika SESSIONTOKEN probe completed without a hosted link.',
          result.hostedPaymentUrl ? 'success' : 'info',
        );
      },
      onError: (error) => {
        setParatikaProbeResult(null);
        showFeedback(getProbeErrorMessage(error), 'error');
      },
    },
  );
  const { data: breakdown, isLoading, isError, error, refetch } = useQueryResource(
    shopifyOrderId ? queryKeys.admin.orders.breakdown(shopifyOrderId) : queryKeys.orders.list(),
    ({ signal }) => {
      if (!shopifyOrderId) {
        throw new Error('Shopify order not found.');
      }

      return getAdminShopifyOrderBreakdown(shopifyOrderId, { signal });
    },
    {
      enabled: appReadiness.ready && Boolean(shopifyOrderId),
    },
  );

  if (!appReadiness.ready || (isLoading && !breakdown)) {
    return (
      <section className="dashboard order-detail">
        <div className="hero-card operational-card">
          <div>
            <p className="eyebrow">Admin orders</p>
            <h2>Shopify order breakdown</h2>
            <p className="page-description">Preparing cross-vendor order allocations for operations review.</p>
          </div>
        </div>
        <SectionSkeleton title="Loading Shopify breakdown" description="Fetching allocation data in the background." />
      </section>
    );
  }

  if (isError || !breakdown) {
    return (
      <section className="dashboard order-detail">
        <div className="hero-card operational-card">
          <div>
            <p className="eyebrow">Admin orders</p>
            <h2>Shopify order breakdown</h2>
            <p className="page-description">The requested Shopify order could not be loaded.</p>
          </div>
          <Link className="button button-secondary" to="/orders">
            Back to orders
          </Link>
        </div>
        <SectionErrorRetry
          title="Breakdown unavailable"
          description={error ?? 'The requested Shopify order could not be loaded.'}
          onRetry={() => void refetch()}
        />
      </section>
    );
  }

  return (
    <section className="dashboard order-detail">
      <div className="hero-card operational-card">
        <div>
          <p className="eyebrow">Admin orders</p>
          <h2>Shopify Order {formatShopifyOrderNumber(breakdown.sourceShopifyOrderNumber)}</h2>
          <p className="page-description">Operational allocation overview across assigned vendors.</p>
        </div>
        <div className="operational-meta-grid">
          <div className="meta-item">
            <span>Source order</span>
            <strong>{breakdown.sourceShopifyOrderId}</strong>
          </div>
          <div className="meta-item">
            <span>Customer</span>
            <strong>{breakdown.customer}</strong>
          </div>
          <div className="meta-item">
            <span>Created</span>
            <strong>{formatDate(breakdown.createdAt)}</strong>
          </div>
          <div className="meta-item">
            <span>Allocations</span>
            <strong>{breakdown.allocations.length}</strong>
          </div>
        </div>
      </div>

      <article className="panel operational-card paratika-probe-card">
        <header className="allocation-header">
          <div>
            <p className="eyebrow">Paratika diagnostics</p>
            <h3>Create hosted payment link</h3>
            <p className="page-description">
              Runs the guarded SESSIONTOKEN live probe for this Shopify order. It does not mark the order paid, call Shopify, or create accounting records.
            </p>
          </div>
          <button
            className="button button-primary"
            type="button"
            disabled={paratikaLiveProbe.isPending}
            onClick={() => paratikaLiveProbe.mutate(undefined)}
          >
            {paratikaLiveProbe.isPending ? 'Creating link...' : 'Create Paratika hosted payment link'}
          </button>
        </header>

        {paratikaProbeResult ? (
          <div className="paratika-probe-result">
            <div className="compact-meta-grid">
              <div className="meta-item">
                <span>Response</span>
                <strong>{getSafeProbeText(paratikaProbeResult.responseCode) ?? 'Unknown'}</strong>
              </div>
              <div className="meta-item">
                <span>Message</span>
                <strong>{getSafeProbeText(paratikaProbeResult.responseMsg) ?? 'No message'}</strong>
              </div>
              <div className="meta-item">
                <span>Payment reference</span>
                <strong>{getSafeProbeText(paratikaProbeResult.paymentReference) ?? 'Not returned'}</strong>
              </div>
              <div className="meta-item">
                <span>Mutation status</span>
                <strong>No payment state changed</strong>
              </div>
              {paratikaProbeResult.errorCode ? (
                <div className="meta-item">
                  <span>Error code</span>
                  <strong>{getSafeProbeText(paratikaProbeResult.errorCode)}</strong>
                </div>
              ) : null}
              {paratikaProbeResult.violatorParam ? (
                <div className="meta-item">
                  <span>Violator param</span>
                  <strong>{getSafeProbeText(paratikaProbeResult.violatorParam)}</strong>
                </div>
              ) : null}
            </div>

            {paratikaProbeResult.errorMsg ? (
              <ActionFeedback tone="error" message={getSafeProbeText(paratikaProbeResult.errorMsg) ?? 'Paratika returned an error.'} />
            ) : null}

            {paratikaProbeResult.hostedPaymentUrl ? (
              <a
                className="button button-secondary paratika-probe-link"
                href={paratikaProbeResult.hostedPaymentUrl}
                target="_blank"
                rel="noreferrer"
              >
                Open Paratika payment page
              </a>
            ) : null}
          </div>
        ) : null}
      </article>

      {breakdown.allocations.map((allocation) => (
        <article key={allocation.vendorId} className="panel allocation-card operational-card">
          <header className="allocation-header">
            <div>
              <p className="eyebrow">Vendor allocation</p>
              <h3>{allocation.vendorName}</h3>
            </div>
            <div className="chip-row">
              <span className={`status-badge status-${allocation.allocationStatus}`}>{allocation.allocationStatus}</span>
              <span
                className={`status-badge status-${getClassToken(allocation.fulfillmentActionState)}`}
              >
                {allocation.fulfillmentActionState}
              </span>
              <span className={`status-badge status-${getClassToken(allocation.shippingStatus)}`}>
                {allocation.shippingStatus}
              </span>
            </div>
          </header>

          <div className="allocation-summary-grid">
            <div className="summary-row">
              <span>Original vendor</span>
              <strong>{allocation.originalVendorId}</strong>
            </div>
            <div className="summary-row">
              <span>Assigned vendor</span>
              <strong>{allocation.assignedVendorId}</strong>
            </div>
            <div className="summary-row">
              <span>Allocation order</span>
              <strong>{allocation.allocationOrderId}</strong>
            </div>
            <div className="summary-row">
              <span>Total</span>
              <strong>{allocation.allocationTotal}</strong>
            </div>
            <div className="summary-row">
              <span>Refund impact</span>
              <strong>{allocation.refundTotal}</strong>
            </div>
            <div className="summary-row">
              <span>Fulfillment</span>
              <strong>{allocation.fulfillmentStatus}</strong>
            </div>
          </div>

          <section className="compact-meta-grid">
            <div className="meta-item">
              <span>Cancellation reason</span>
              <strong className={allocation.cancellationReason ? '' : 'muted'}>{allocation.cancellationReason ?? 'None'}</strong>
            </div>
            <div className="meta-item">
              <span>Reassignment required</span>
              <strong>{allocation.reassignmentRequired ? 'Yes' : 'No'}</strong>
            </div>
            <div className="meta-item">
              <span>Assignment blocked</span>
              <strong className={allocation.assignmentBlockedAt ? '' : 'muted'}>
                {allocation.assignmentBlockedAt ? formatDate(allocation.assignmentBlockedAt) : 'Not blocked'}
              </strong>
            </div>
            <div className="meta-item">
              <span>Reassigned by</span>
              <strong className={allocation.reassignedBy ? '' : 'muted'}>{allocation.reassignedBy ?? 'Not reassigned'}</strong>
            </div>
            <div className="meta-item">
              <span>Carrier</span>
              <strong className={allocation.carrier ? '' : 'muted'}>{allocation.carrier ?? 'Not assigned'}</strong>
            </div>
            <div className="meta-item">
              <span>Tracking</span>
              <strong className={allocation.trackingNumber ? '' : 'muted'}>
                {allocation.trackingNumber ?? 'Not assigned'}
              </strong>
            </div>
            <div className="meta-item">
              <span>Tracking URL</span>
              {allocation.trackingUrl ? (
                <a className="inline-link" href={allocation.trackingUrl} target="_blank" rel="noreferrer">
                  Open tracking
                </a>
              ) : (
                <strong className="muted">Not synced</strong>
              )}
            </div>
            <div className="meta-item">
              <span>Fulfilled at</span>
              <strong className={allocation.fulfilledAt ? '' : 'muted'}>
                {allocation.fulfilledAt ? formatDate(allocation.fulfilledAt) : 'Not fulfilled'}
              </strong>
            </div>
            <div className="meta-item">
              <span>Shipment created</span>
              <strong className={allocation.shipmentCreatedAt ? '' : 'muted'}>
                {allocation.shipmentCreatedAt ? formatDate(allocation.shipmentCreatedAt) : 'Not created'}
              </strong>
            </div>
            <div className="meta-item">
              <span>Shipment updated</span>
              <strong className={allocation.shipmentUpdatedAt ? '' : 'muted'}>
                {allocation.shipmentUpdatedAt ? formatDate(allocation.shipmentUpdatedAt) : 'Not updated'}
              </strong>
            </div>
          </section>

          {allocation.reassignmentRequired ? (
            <section className="action-row">
              <p className="page-description">{allocation.reassignmentNote ?? 'Reassignment review required.'}</p>
              <div className="detail-actions">
                {allocation.reassignmentCandidateVendorIds.map((candidateVendorId) => (
                  <button
                    key={candidateVendorId}
                    className="button button-primary"
                    type="button"
                    disabled={reassignAllocation.isPending}
                    onClick={() => {
                      reassignAllocation.mutate({
                        allocationOrderId: allocation.allocationOrderId,
                        nextVendorId: candidateVendorId,
                      });
                    }}
                  >
                    {reassignAllocation.isPending ? 'Preparing...' : `Reassign to ${candidateVendorId}`}
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          <h3 className="section-header">Allocated line items</h3>
          <div className="line-item-table">
            <div className="line-item-head">
              <span>SKU</span>
              <span>Variant</span>
              <span>Item</span>
              <span>Quantity</span>
              <span>Price</span>
              <span>Fulfillment</span>
            </div>
            {allocation.lineItems.map((item) => (
              <div key={item.id} className="line-item-row">
                <span>{item.sku}</span>
                <span>{item.variantTitle}</span>
                <span>{item.name}</span>
                <span>{item.quantity}</span>
                <span>{item.price}</span>
                <span className="order-state-stack">
                  <span className={`status-badge status-${getClassToken(item.fulfillmentStatus)}`}>
                    {item.fulfillmentStatus}
                  </span>
                  <span className={`status-badge status-${getClassToken(item.shippingStatus)}`}>
                    {item.shippingStatus}
                  </span>
                </span>
              </div>
            ))}
          </div>

          <h3 className="section-header">Allocated refunded items</h3>
          {allocation.refundedItems.length === 0 ? (
            <p className="page-description">No refunded items in this vendor allocation.</p>
          ) : (
            <div className="line-item-table">
              <div className="line-item-head">
                <span>SKU</span>
                <span>Variant</span>
                <span>Item</span>
                <span>Quantity</span>
                <span>Refund</span>
                <span>Condition</span>
              </div>
              {allocation.refundedItems.map((item) => (
                <div key={item.id} className="line-item-row">
                  <span>{item.sku}</span>
                  <span>{item.variantTitle}</span>
                  <span>{item.name}</span>
                  <span>{item.quantity}</span>
                  <span>{item.refundAmount}</span>
                  <span>{item.condition}</span>
                </div>
              ))}
            </div>
          )}

          <h3 className="section-header">Assignment timeline</h3>
          <div className="timeline-block">
            {allocation.assignmentHistory.map((entry, index) => (
              <div key={`${allocation.vendorId}-${entry.action}-${entry.createdAt}-${index}`} className="timeline-event">
                <div className="timeline-dot" aria-hidden="true" />
                <div>
                  <p className="timeline-title">
                    {entry.action.replace(/_/g, ' ')} · {entry.toVendorId}
                  </p>
                  <p className="timeline-meta">
                    {entry.fromVendorId ? `From ${entry.fromVendorId} · ` : ''}
                    {entry.reason ?? 'No reason provided'} · {entry.actorName} ({entry.actorRole}) ·{' '}
                    {formatDate(entry.createdAt)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </article>
      ))}

      <article className="panel">
        {message ? <ActionFeedback tone={tone} message={message} /> : null}
        <Link className="button button-secondary" to="/orders">
          Back to vendor orders
        </Link>
      </article>
    </section>
  );
}
