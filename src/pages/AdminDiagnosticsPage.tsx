import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ActionFeedback } from '../components/ActionFeedback';
import { DataStatePanel } from '../components/DataStatePanel';
import { useMutationAction } from '../hooks/useMutationAction';
import { useQueryResource } from '../hooks/useQueryResource';
import { queryKeys } from '../lib/api/queryKeys';
import { useActionFeedback } from '../lib/ui';
import { runtimeConfig } from '../config/runtime';
import { runtimeServices } from '../services/runtime-services';

function formatDate(value: string | null) {
  if (!value) {
    return 'Not recorded';
  }

  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function getSeverityClass(severity: 'critical' | 'warning' | 'attention' | 'normal') {
  if (severity === 'critical') {
    return 'severity-critical';
  }
  if (severity === 'warning') {
    return 'severity-warning';
  }
  if (severity === 'attention') {
    return 'severity-attention';
  }
  return 'severity-normal';
}

export function AdminDiagnosticsPage() {
  const { message, tone, showFeedback } = useActionFeedback();
  const [selectedWebhookEventId, setSelectedWebhookEventId] = useState<string | null>(null);
  const isRealMode = runtimeConfig.apiMode === 'real';

  const webhooksQuery = useQueryResource(queryKeys.admin.diagnostics.webhooks(), () =>
    runtimeServices.diagnostics.webhooks(),
  );
  const reconciliationQuery = useQueryResource(queryKeys.admin.diagnostics.reconciliation(), () =>
    runtimeServices.diagnostics.reconciliation(),
  );
  const syncEventsQuery = useQueryResource(queryKeys.admin.diagnostics.syncEvents(), () =>
    runtimeServices.diagnostics.syncEvents(),
  );

  const latestWebhookEventId = selectedWebhookEventId ?? webhooksQuery.data?.events[0]?.id ?? null;

  const webhookDetailQuery = useQueryResource(
    latestWebhookEventId
      ? queryKeys.admin.diagnostics.webhookDetail(latestWebhookEventId)
      : queryKeys.admin.diagnostics.webhooks(),
    () => {
      if (!latestWebhookEventId) {
        throw new Error('Webhook event not found.');
      }

      return runtimeServices.diagnostics.webhookDetail(latestWebhookEventId);
    },
    {
      enabled: Boolean(latestWebhookEventId) && isRealMode,
    },
  );

  const replayMutation = useMutationAction(
    async (webhookEventId: string) => runtimeServices.diagnostics.replay(webhookEventId),
    {
      invalidateQueryKeys: [
        queryKeys.admin.diagnostics.webhooks(),
        queryKeys.admin.diagnostics.syncEvents(),
        queryKeys.admin.diagnostics.reconciliation(),
        ...(latestWebhookEventId ? [queryKeys.admin.diagnostics.webhookDetail(latestWebhookEventId)] : []),
      ],
      onSuccess: (result) => {
        const messageText =
          result.processingStatus === 'processed'
            ? `Replay completed for ${result.topic}.`
            : result.message ?? `Replay finished with ${result.processingStatus}.`;
        showFeedback(messageText, result.processingStatus === 'processed' ? 'success' : 'info');
      },
      onError: (error) => {
        const messageText = error instanceof Error ? error.message : 'Replay request failed.';
        showFeedback(messageText, 'error');
      },
    },
  );

  const selectedWebhook = webhookDetailQuery.data;
  const visibleWebhooks = webhooksQuery.data?.events.slice(0, 8) ?? [];
  const visibleSyncEvents = syncEventsQuery.data?.items.slice(0, 8) ?? [];
  const visibleReconciliationItems = reconciliationQuery.data?.items.slice(0, 8) ?? [];

  const isLoading = webhooksQuery.isLoading || reconciliationQuery.isLoading || syncEventsQuery.isLoading;
  const pageError = webhooksQuery.error ?? reconciliationQuery.error ?? syncEventsQuery.error ?? webhookDetailQuery.error;

  const replayAvailable = selectedWebhook?.payloadAvailable === true;

  const combinedCounts = useMemo(() => {
    return {
      stuck: reconciliationQuery.data?.summary.stuckReceived ?? 0,
      failed: webhooksQuery.data?.summary.failed ?? 0,
      fulfillmentFailures: reconciliationQuery.data?.summary.fulfillmentSyncFailures ?? 0,
      missingPayload: reconciliationQuery.data?.summary.missingPayload ?? 0,
    };
  }, [reconciliationQuery.data, webhooksQuery.data]);

  if (!isRealMode) {
    return (
      <DataStatePanel
        tone="info"
        eyebrow="Admin diagnostics"
        title="Diagnostics are available in real mode"
        description="This workspace reads live backend webhook, reconciliation, and sync visibility. Switch to real API mode to inspect operational recovery state."
      />
    );
  }

  if (isLoading) {
    return (
      <DataStatePanel
        tone="loading"
        eyebrow="Admin diagnostics"
        title="Loading diagnostics workspace"
        description="Collecting live webhook, reconciliation, and sync recovery signals."
      />
    );
  }

  if (pageError || !webhooksQuery.data || !reconciliationQuery.data || !syncEventsQuery.data) {
    return (
      <DataStatePanel
        tone="error"
        eyebrow="Admin diagnostics"
        title="Diagnostics unavailable"
        description={pageError ?? 'Diagnostics workspace could not be loaded.'}
      />
    );
  }

  return (
    <section className="dashboard diagnostics-workspace">
      <div className="hero-card operational-card">
        <div>
          <p className="eyebrow">Admin diagnostics</p>
          <h2>Webhook & reconciliation workspace</h2>
          <p className="page-description">
            Live operational visibility for Shopify webhook ingestion, replay readiness, and backend recovery actions.
          </p>
        </div>
        <div className="queue-health">
          <span className="severity-chip severity-critical">Failed {webhooksQuery.data.summary.failed}</span>
          <span className="severity-chip severity-warning">Stuck {combinedCounts.stuck}</span>
          <span className="severity-chip severity-attention">Missing payload {combinedCounts.missingPayload}</span>
          <span className="severity-chip severity-normal">Processed {webhooksQuery.data.summary.processed}</span>
        </div>
      </div>

      <div className="stats-grid queue-stats">
        <article className="stat-card operational-card">
          <span className="stat-label">Webhook events</span>
          <strong>{webhooksQuery.data.summary.total}</strong>
        </article>
        <article className="stat-card operational-card">
          <span className="stat-label">Needs attention</span>
          <strong>{webhooksQuery.data.summary.needsAttention}</strong>
        </article>
        <article className="stat-card operational-card">
          <span className="stat-label">Reconciliation items</span>
          <strong>{reconciliationQuery.data.summary.total}</strong>
        </article>
        <article className="stat-card operational-card">
          <span className="stat-label">Fulfillment sync failures</span>
          <strong>{combinedCounts.fulfillmentFailures}</strong>
        </article>
      </div>

      <div className="diagnostics-layout">
        <article className="panel operational-card diagnostics-panel">
          <div className="queue-list-header">
            <h3>Webhook summary</h3>
            <p className="page-description">Recent Shopify webhook envelopes with payload replay visibility.</p>
          </div>
          {visibleWebhooks.length === 0 ? (
            <div className="queue-empty">
              <p className="eyebrow">Diagnostics state</p>
              <h3>No webhook events recorded</h3>
              <p className="page-description">Live backend diagnostics will appear here once Shopify deliveries reach the backend.</p>
            </div>
          ) : (
            <div className="diagnostics-list">
              {visibleWebhooks.map((event) => (
                <button
                  key={event.id}
                  type="button"
                  className={`diagnostics-item ${latestWebhookEventId === event.id ? 'diagnostics-item-selected' : ''}`}
                  onClick={() => setSelectedWebhookEventId(event.id)}
                >
                  <div className="diagnostics-item-top">
                    <div className="queue-title-block">
                      <span className={`severity-chip ${event.status === 'FAILED' ? 'severity-critical' : event.status === 'RECEIVED' ? 'severity-attention' : 'severity-normal'}`}>
                        {event.status}
                      </span>
                      <h4>{event.topic}</h4>
                    </div>
                    <span className={`status-badge status-${event.payloadAvailable ? 'processed' : 'pending'}`}>
                      {event.payloadAvailable ? 'Replayable' : 'No payload'}
                    </span>
                  </div>
                  <p className="queue-description">{event.errorMessage ?? 'Webhook stored successfully.'}</p>
                  <div className="queue-meta">
                    <span>
                      <strong>Shop:</strong> {event.shopDomain}
                    </span>
                    <span>
                      <strong>Received:</strong> {formatDate(event.receivedAt)}
                    </span>
                    <span>
                      <strong>Webhook ID:</strong> {event.shopifyWebhookId ?? 'Not provided'}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </article>

        <article className="panel operational-card diagnostics-panel">
          <div className="queue-list-header">
            <h3>Webhook detail</h3>
            <p className="page-description">Inspect payload availability, related order context, and explicit replay controls.</p>
          </div>
          {!selectedWebhook ? (
            <div className="queue-empty">
              <p className="eyebrow">Selection</p>
              <h3>Select a webhook event</h3>
              <p className="page-description">Choose a recent webhook to inspect replay readiness and error detail.</p>
            </div>
          ) : (
            <div className="diagnostics-detail">
              <div className="compact-meta-grid">
                <div className="meta-item">
                  <span>Topic</span>
                  <strong>{selectedWebhook.topic}</strong>
                </div>
                <div className="meta-item">
                  <span>Payload available</span>
                  <strong>{selectedWebhook.payloadAvailable ? 'Yes' : 'No'}</strong>
                </div>
                <div className="meta-item">
                  <span>Related Shopify order</span>
                  <strong className={selectedWebhook.relatedShopifyOrderId ? '' : 'muted'}>
                    {selectedWebhook.relatedShopifyOrderId ?? 'Not inferable'}
                  </strong>
                </div>
                <div className="meta-item">
                  <span>Processed</span>
                  <strong>{formatDate(selectedWebhook.processedAt)}</strong>
                </div>
              </div>
              <div className="diagnostics-detail-stack">
                <div className="summary-row">
                  <span>Idempotency key</span>
                  <strong className="diagnostics-wrap">{selectedWebhook.idempotencyKey ?? 'Not recorded'}</strong>
                </div>
                <div className="summary-row">
                  <span>Payload hash</span>
                  <strong className="diagnostics-wrap">{selectedWebhook.payloadHash ?? 'Not recorded'}</strong>
                </div>
                <div className="summary-row">
                  <span>Error</span>
                  <strong className={selectedWebhook.errorMessage ? '' : 'muted'}>
                    {selectedWebhook.errorMessage ?? 'No error recorded'}
                  </strong>
                </div>
              </div>
              <div className="diagnostics-actions">
                {replayAvailable ? (
                  <button
                    type="button"
                    className="button button-primary"
                    disabled={replayMutation.isPending}
                    onClick={() => replayMutation.mutate(selectedWebhook.id)}
                  >
                    {replayMutation.isPending ? 'Replaying...' : 'Replay webhook'}
                  </button>
                ) : (
                  <span className="queue-muted-action">Replay unavailable: payload not stored for this event.</span>
                )}
                {selectedWebhook.relatedShopifyOrderId ? (
                  <Link className="button button-secondary" to={`/admin/orders/${selectedWebhook.relatedShopifyOrderId}`}>
                    View Shopify order
                  </Link>
                ) : null}
              </div>
              {selectedWebhook.rawPayload ? (
                <pre className="diagnostics-payload-preview">{selectedWebhook.rawPayload}</pre>
              ) : null}
            </div>
          )}
        </article>
      </div>

      <div className="diagnostics-layout">
        <article className="panel operational-card diagnostics-panel">
          <div className="queue-list-header">
            <h3>Reconciliation summary</h3>
            <p className="page-description">Recovery candidates that still need operator attention.</p>
          </div>
          {visibleReconciliationItems.length === 0 ? (
            <div className="queue-empty">
              <p className="eyebrow">Reconciliation</p>
              <h3>No active reconciliation work</h3>
              <p className="page-description">No stuck webhook events or sync failures are currently waiting for admin recovery.</p>
            </div>
          ) : (
            <div className="diagnostics-list">
              {visibleReconciliationItems.map((item) => (
                <article key={item.id} className="diagnostics-entry">
                  <div className="diagnostics-item-top">
                    <div className="queue-title-block">
                      <span className={`severity-chip ${getSeverityClass(item.severity)}`}>{item.severity}</span>
                      <h4>{item.title}</h4>
                    </div>
                    <span className={`status-badge status-${item.status.toLowerCase().replace(/\s+/g, '-')}`}>{item.status}</span>
                  </div>
                  <p className="queue-description">{item.description}</p>
                  <div className="queue-meta">
                    <span>
                      <strong>Suggested action:</strong> {item.suggestedAction}
                    </span>
                    <span>
                      <strong>Order:</strong> {item.relatedShopifyOrderId ?? 'N/A'}
                    </span>
                    <span>
                      <strong>Payload:</strong> {item.payloadAvailable === null ? 'N/A' : item.payloadAvailable ? 'Available' : 'Missing'}
                    </span>
                  </div>
                </article>
              ))}
            </div>
          )}
        </article>

        <article className="panel operational-card diagnostics-panel">
          <div className="queue-list-header">
            <h3>Sync failures</h3>
            <p className="page-description">Latest consolidated backend failure feed across ingestion and fulfillment sync.</p>
          </div>
          {visibleSyncEvents.length === 0 ? (
            <div className="queue-empty">
              <p className="eyebrow">Sync health</p>
              <h3>No sync failures recorded</h3>
              <p className="page-description">Webhook ingestion and fulfillment sync are currently clear.</p>
            </div>
          ) : (
            <div className="diagnostics-list">
              {visibleSyncEvents.map((item) => (
                <article key={item.id} className="diagnostics-entry">
                  <div className="diagnostics-item-top">
                    <div className="queue-title-block">
                      <span className={`severity-chip ${getSeverityClass(item.severity)}`}>{item.severity}</span>
                      <h4>{item.title}</h4>
                    </div>
                    <span className={`status-badge status-${item.status.toLowerCase().replace(/\s+/g, '-')}`}>{item.status}</span>
                  </div>
                  <p className="queue-description">{item.description}</p>
                  <div className="queue-meta">
                    <span>
                      <strong>Type:</strong> {item.type}
                    </span>
                    <span>
                      <strong>Shopify order:</strong> {item.relatedShopifyOrderId ?? 'N/A'}
                    </span>
                    <span>
                      <strong>Created:</strong> {formatDate(item.createdAt)}
                    </span>
                  </div>
                </article>
              ))}
            </div>
          )}
        </article>
      </div>

      {message ? <ActionFeedback tone={tone} message={message} /> : null}
    </section>
  );
}
