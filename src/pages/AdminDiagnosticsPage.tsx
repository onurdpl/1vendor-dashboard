import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ActionFeedback } from '../components/ActionFeedback';
import { DataStatePanel } from '../components/DataStatePanel';
import {
  EmptyStatePanel,
  KPIStatCard,
  MetadataRow,
  OperationalActionGroup,
  OperationalSection,
  OperationalTable,
  OperationalTableRow,
  SideDetailPanel,
  StatusBadge,
  TimelineBlock,
} from '../components/OperationalPrimitives';
import { useMutationAction } from '../hooks/useMutationAction';
import { useQueryResource } from '../hooks/useQueryResource';
import { queryKeys } from '../lib/api/queryKeys';
import { useActionFeedback } from '../lib/ui';
import { runtimeConfig } from '../config/runtime';
import { runtimeServices } from '../services/runtime-services';
import { toTitleCaseLabel } from '../services/real/formatting';

function formatDate(value: string | null) {
  if (!value) {
    return 'Not recorded';
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function getSeverityTone(severity: 'critical' | 'warning' | 'attention' | 'normal') {
  if (severity === 'critical') {
    return 'danger' as const;
  }
  if (severity === 'warning') {
    return 'warning' as const;
  }
  if (severity === 'attention') {
    return 'attention' as const;
  }
  return 'neutral' as const;
}

function getStatusTone(status: string) {
  if (status === 'FAILED') {
    return 'danger' as const;
  }
  if (status === 'PROCESSED') {
    return 'success' as const;
  }
  if (status === 'PROCESSING') {
    return 'info' as const;
  }
  return 'attention' as const;
}

function formatWebhookTopic(topic: string) {
  return topic
    .split('/')
    .map((part) => toTitleCaseLabel(part))
    .join(' / ');
}

function formatRecoverability(payloadAvailable: boolean, status: string) {
  if (!payloadAvailable) {
    return 'Manual recovery required';
  }
  if (status === 'RECEIVED' || status === 'FAILED') {
    return 'Recover eligible';
  }
  if (status === 'PROCESSING') {
    return 'Monitor processing';
  }
  if (status === 'PROCESSED') {
    return 'Replay only with care';
  }
  return 'Review required';
}

function getPrimaryEntityLabel(entities: {
  shopifyOrderId: string | null;
  shopifyOrderNumber: string | null;
  shopifyReturnId: string | null;
  shopifyRefundId: string | null;
  shopifyFulfillmentId: string | null;
}) {
  if (entities.shopifyReturnId) {
    return `Return ${entities.shopifyReturnId}`;
  }

  if (entities.shopifyRefundId) {
    return `Refund ${entities.shopifyRefundId}`;
  }

  if (entities.shopifyFulfillmentId) {
    return `Fulfillment ${entities.shopifyFulfillmentId}`;
  }

  if (entities.shopifyOrderNumber) {
    return `Order #${String(entities.shopifyOrderNumber).replace(/^#/, '')}`;
  }

  if (entities.shopifyOrderId) {
    return `Order ${entities.shopifyOrderId}`;
  }

  return 'Not inferable';
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

  const invalidateDiagnostics = [
    queryKeys.admin.diagnostics.webhooks(),
    queryKeys.admin.diagnostics.syncEvents(),
    queryKeys.admin.diagnostics.reconciliation(),
    ...(latestWebhookEventId ? [queryKeys.admin.diagnostics.webhookDetail(latestWebhookEventId)] : []),
  ];

  const replayMutation = useMutationAction(
    async (webhookEventId: string) => runtimeServices.diagnostics.replay(webhookEventId),
    {
      invalidateQueryKeys: invalidateDiagnostics,
      onSuccess: (result) => {
        showFeedback(result.message ?? `Replay finished with ${result.processingStatus}.`, 'info');
      },
      onError: (error) => showFeedback(error instanceof Error ? error.message : 'Replay request failed.', 'error'),
    },
  );

  const recoverMutation = useMutationAction(
    async (webhookEventId: string) => runtimeServices.diagnostics.recover(webhookEventId),
    {
      invalidateQueryKeys: invalidateDiagnostics,
      onSuccess: (result) => {
        showFeedback(result.message ?? `Recover finished with ${result.recoveryStatus}.`, result.recoveryStatus === 'recovered' ? 'success' : 'info');
      },
      onError: (error) => showFeedback(error instanceof Error ? error.message : 'Recover request failed.', 'error'),
    },
  );

  const reconcileAllocationMutation = useMutationAction(
    async (allocationId: string) => runtimeServices.diagnostics.reconcileAllocation(allocationId),
    {
      invalidateQueryKeys: invalidateDiagnostics,
      onSuccess: (result) => {
        showFeedback(
          `Reconciliation ${result.reconciliationStatus}: repaired ${result.repairedFields.length} field(s).`,
          result.reconciliationStatus === 'needs_attention' ? 'info' : 'success',
        );
      },
      onError: (error) => showFeedback(error instanceof Error ? error.message : 'Reconciliation failed.', 'error'),
    },
  );

  const reconcileShopifyOrderMutation = useMutationAction(
    async (shopifyOrderId: string) => runtimeServices.diagnostics.reconcileShopifyOrder(shopifyOrderId),
    {
      invalidateQueryKeys: invalidateDiagnostics,
      onSuccess: (result) => {
        showFeedback(
          `Order reconciliation ${result.reconciliationStatus}: repaired ${result.repairedFields.length} field(s).`,
          result.reconciliationStatus === 'needs_attention' ? 'info' : 'success',
        );
      },
      onError: (error) => showFeedback(error instanceof Error ? error.message : 'Order reconciliation failed.', 'error'),
    },
  );

  const selectedWebhook = webhookDetailQuery.data;
  const visibleWebhooks = webhooksQuery.data?.events.slice(0, 12) ?? [];
  const visibleSyncEvents = syncEventsQuery.data?.items.slice(0, 8) ?? [];
  const visibleReconciliationItems = reconciliationQuery.data?.items.slice(0, 8) ?? [];

  const isLoading = webhooksQuery.isLoading || reconciliationQuery.isLoading || syncEventsQuery.isLoading;
  const pageError = webhooksQuery.error ?? reconciliationQuery.error ?? syncEventsQuery.error ?? webhookDetailQuery.error;

  const combinedCounts = useMemo(() => {
    return {
      stuck: reconciliationQuery.data?.summary.stuckReceived ?? 0,
      failed: webhooksQuery.data?.summary.failed ?? 0,
      fulfillmentFailures: reconciliationQuery.data?.summary.fulfillmentSyncFailures ?? 0,
      missingPayload: reconciliationQuery.data?.summary.missingPayload ?? 0,
      staleAllocations: reconciliationQuery.data?.summary.staleAllocations ?? 0,
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

  const canRecover = selectedWebhook?.recoverEligible === true;
  const canReplay = selectedWebhook?.replayEligible === true;

  return (
    <section className="op-page diagnostics-control-center">
      <div className="op-page-heading">
        <div>
          <p className="eyebrow">Admin diagnostics</p>
          <h2>Webhook recovery command center</h2>
          <p className="page-description">
            Monitor Shopify event ingestion, reconciliation backlog, payload availability, and operator-triggered recovery.
          </p>
        </div>
        <div className="op-heading-meta">
          <StatusBadge tone="danger">Failed {webhooksQuery.data.summary.failed}</StatusBadge>
          <StatusBadge tone="attention">Stuck {combinedCounts.stuck}</StatusBadge>
          <StatusBadge tone="success">Processed {webhooksQuery.data.summary.processed}</StatusBadge>
        </div>
      </div>

      <div className="op-kpi-row">
        <KPIStatCard label="Webhook events" value={webhooksQuery.data.summary.total} detail="Persisted envelopes" tone="info" />
        <KPIStatCard label="Needs attention" value={webhooksQuery.data.summary.needsAttention} detail="Failed or blocked" tone="danger" />
        <KPIStatCard label="Reconciliation" value={reconciliationQuery.data.summary.total} detail="Operator candidates" tone="attention" />
        <KPIStatCard label="Missing payload" value={combinedCounts.missingPayload} detail="Manual recovery required" tone="warning" />
        <KPIStatCard label="Fulfillment failures" value={combinedCounts.fulfillmentFailures} detail="Sync failure signals" tone="danger" />
        <KPIStatCard label="Stale allocations" value={combinedCounts.staleAllocations} detail="Reconcile against Shopify" tone="stale" />
      </div>

      <div className="op-control-layout diagnostics-layout-redesign">
        <div className="op-main-column">
          {visibleWebhooks.length === 0 ? (
            <EmptyStatePanel
              title="No webhook events recorded"
              description="Live backend diagnostics will appear here once Shopify deliveries reach the backend."
            />
          ) : (
            <OperationalTable
              columns={['Status', 'Topic', 'Payload', 'Operator guidance', 'Affected entity', 'Received', 'Actions']}
              className="diagnostics-op-table"
            >
              {visibleWebhooks.map((event) => (
                <OperationalTableRow
                  key={event.id}
                  selected={latestWebhookEventId === event.id}
                  onSelect={() => setSelectedWebhookEventId(event.id)}
                >
                  <StatusBadge tone={getStatusTone(event.status)}>{event.status}</StatusBadge>
                  <span>
                    <strong>{formatWebhookTopic(event.topic)}</strong>
                    <small>{event.shopDomain}</small>
                  </span>
                  <StatusBadge tone={event.payloadAvailable ? 'success' : 'warning'}>
                    {event.payloadAvailable ? 'Available' : 'Missing'}
                  </StatusBadge>
                  <span>
                    <strong>{event.recoverEligible ? 'Recover eligible' : event.replayEligible ? 'Replay available' : 'No action'}</strong>
                    <small>{event.lastErrorSummary ?? event.recommendedAction}</small>
                  </span>
                  <span>{getPrimaryEntityLabel(event.affectedEntities)}</span>
                  <span>{formatDate(event.receivedAt)}</span>
                  <OperationalActionGroup>
                    <button
                      type="button"
                      className="button button-secondary"
                      onClick={(clickEvent) => {
                        clickEvent.stopPropagation();
                        setSelectedWebhookEventId(event.id);
                      }}
                    >
                      View
                    </button>
                    <button
                      type="button"
                      className="button button-secondary"
                      disabled={!event.replayEligible || replayMutation.isPending}
                      onClick={(clickEvent) => {
                        clickEvent.stopPropagation();
                        replayMutation.mutate(event.id);
                      }}
                    >
                      Replay
                    </button>
                    <button
                      type="button"
                      className="button button-primary"
                      disabled={!event.recoverEligible || recoverMutation.isPending}
                      onClick={(clickEvent) => {
                        clickEvent.stopPropagation();
                        recoverMutation.mutate(event.id);
                      }}
                    >
                      Recover
                    </button>
                  </OperationalActionGroup>
                </OperationalTableRow>
              ))}
            </OperationalTable>
          )}

          <div className="op-secondary-grid">
            <OperationalSection
              title="Reconciliation queue"
              description="Stuck events, missing payloads, and suggested recovery actions."
            >
              {visibleReconciliationItems.length === 0 ? (
                <EmptyStatePanel title="No active reconciliation work" description="No stuck webhook events or sync failures are currently waiting for admin recovery." />
              ) : (
                <div className="op-event-list">
                  {visibleReconciliationItems.map((item) => (
                    <article key={item.id} className="op-event-row">
                      <StatusBadge tone={getSeverityTone(item.severity)}>{item.severity}</StatusBadge>
                      <div>
                        <strong>{item.title}</strong>
                        <p>{item.description}</p>
                        <small>{item.suggestedAction}</small>
                      </div>
                      <OperationalActionGroup>
                        <span>{item.payloadAvailable === null ? 'No payload needed' : item.payloadAvailable ? 'Payload available' : 'Payload missing'}</span>
                        {item.relatedAllocationId ? (
                          <button
                            type="button"
                            className="button button-secondary"
                            disabled={reconcileAllocationMutation.isPending}
                            onClick={() => reconcileAllocationMutation.mutate(item.relatedAllocationId as string)}
                          >
                            Reconcile allocation
                          </button>
                        ) : null}
                        {!item.relatedAllocationId && item.relatedShopifyOrderId ? (
                          <button
                            type="button"
                            className="button button-secondary"
                            disabled={reconcileShopifyOrderMutation.isPending}
                            onClick={() => reconcileShopifyOrderMutation.mutate(item.relatedShopifyOrderId as string)}
                          >
                            Reconcile order
                          </button>
                        ) : null}
                      </OperationalActionGroup>
                    </article>
                  ))}
                </div>
              )}
            </OperationalSection>

            <OperationalSection
              title="Sync event stream"
              description="Latest backend ingestion and fulfillment failure signals."
            >
              {visibleSyncEvents.length === 0 ? (
                <EmptyStatePanel title="No sync failures recorded" description="Webhook ingestion and fulfillment sync are currently clear." />
              ) : (
                <div className="op-event-list">
                  {visibleSyncEvents.map((item) => (
                    <article key={item.id} className="op-event-row">
                      <StatusBadge tone={getSeverityTone(item.severity)}>{item.severity}</StatusBadge>
                      <div>
                        <strong>{item.title}</strong>
                        <p>{item.description}</p>
                        <small>{item.type}</small>
                      </div>
                      <span>{formatDate(item.createdAt)}</span>
                    </article>
                  ))}
                </div>
              )}
            </OperationalSection>
          </div>
        </div>

        <SideDetailPanel
          eyebrow="Webhook detail"
          title={selectedWebhook ? formatWebhookTopic(selectedWebhook.topic) : 'No event selected'}
          action={
            selectedWebhook?.relatedShopifyOrderId ? (
              <Link className="button button-secondary" to={`/admin/orders/${selectedWebhook.relatedShopifyOrderId}`}>
                Shopify order
              </Link>
            ) : null
          }
        >
          {selectedWebhook ? (
            <>
              <div className="op-detail-status-row">
                <StatusBadge tone={getStatusTone(selectedWebhook.status)}>{selectedWebhook.status}</StatusBadge>
                <StatusBadge tone={selectedWebhook.payloadAvailable ? 'success' : 'warning'}>
                  {selectedWebhook.payloadAvailable ? 'Payload available' : 'Payload missing'}
                </StatusBadge>
              </div>
              <div className="op-meta-grid">
                <MetadataRow label="Recoverability" value={formatRecoverability(selectedWebhook.payloadAvailable, selectedWebhook.status)} />
                <MetadataRow label="Recommended action" value={selectedWebhook.recommendedAction} />
                <MetadataRow label="Shop domain" value={selectedWebhook.shopDomain} />
                <MetadataRow label="Webhook ID" value={selectedWebhook.shopifyWebhookId ?? 'Not provided'} />
                <MetadataRow label="Shopify order" value={selectedWebhook.affectedEntities.shopifyOrderNumber ?? selectedWebhook.affectedEntities.shopifyOrderId ?? selectedWebhook.relatedShopifyOrderId ?? 'Not inferable'} />
                <MetadataRow label="Shopify return" value={selectedWebhook.affectedEntities.shopifyReturnId ?? 'Not inferable'} />
                <MetadataRow label="Shopify refund" value={selectedWebhook.affectedEntities.shopifyRefundId ?? 'Not inferable'} />
                <MetadataRow label="Shopify fulfillment" value={selectedWebhook.affectedEntities.shopifyFulfillmentId ?? 'Not inferable'} />
                <MetadataRow label="Received At" value={formatDate(selectedWebhook.receivedAt)} />
                <MetadataRow label="Processed At" value={formatDate(selectedWebhook.processedAt)} />
              </div>
              <div className="op-panel-section">
                <h4>Recovery actions</h4>
                <OperationalActionGroup>
                  <button
                    type="button"
                    className="button button-primary"
                    disabled={!canRecover || recoverMutation.isPending}
                    onClick={() => recoverMutation.mutate(selectedWebhook.id)}
                  >
                    {recoverMutation.isPending ? 'Recovering...' : 'Recover'}
                  </button>
                  <button
                    type="button"
                    className="button button-secondary"
                    disabled={!canReplay || replayMutation.isPending}
                    onClick={() => replayMutation.mutate(selectedWebhook.id)}
                  >
                    {replayMutation.isPending ? 'Replaying...' : 'Replay'}
                  </button>
                </OperationalActionGroup>
                <p className="page-description">
                  Recover is intended for stuck or failed events with stored payloads. Replay is shown only when the backend considers the topic and payload safe for intentional idempotent reprocessing.
                </p>
                {!canRecover && selectedWebhook.recoverBlockedReason ? (
                  <p className="queue-muted-action">Recover blocked: {selectedWebhook.recoverBlockedReason}</p>
                ) : null}
                {!canReplay && selectedWebhook.replayBlockedReason ? (
                  <p className="queue-muted-action">Replay blocked: {selectedWebhook.replayBlockedReason}</p>
                ) : null}
              </div>
              <div className="op-panel-section">
                <h4>Timeline</h4>
                <TimelineBlock
                  items={[
                    { label: 'Received', at: formatDate(selectedWebhook.receivedAt) },
                    { label: 'Processing', detail: selectedWebhook.status === 'RECEIVED' ? 'Not started or stuck before processing.' : 'Processing boundary reached.' },
                    { label: selectedWebhook.status, at: formatDate(selectedWebhook.processedAt) },
                    { label: selectedWebhook.lastErrorSummary ? 'Error recorded' : 'No error recorded', detail: selectedWebhook.lastErrorSummary ?? 'Clear' },
                  ]}
                />
              </div>
              <div className="op-panel-section">
                <h4>Payload diagnostics</h4>
                <MetadataRow label="Payload hash" value={selectedWebhook.payloadHash ?? 'Not recorded'} />
                <MetadataRow label="Idempotency key" value={selectedWebhook.idempotencyKey ?? 'Not recorded'} />
                {selectedWebhook.payloadPreview ? (
                  <pre className="diagnostics-payload-preview">
                    {selectedWebhook.payloadPreview}
                    {selectedWebhook.payloadPreviewTruncated ? '\n...' : ''}
                  </pre>
                ) : (
                  <p className="page-description">No stored payload preview is available for this event.</p>
                )}
              </div>
            </>
          ) : (
            <EmptyStatePanel title="Select a webhook event" description="Choose an event from the stream to inspect payload and recovery readiness." />
          )}
        </SideDetailPanel>
      </div>

      {message ? <ActionFeedback tone={tone} message={message} /> : null}
    </section>
  );
}
