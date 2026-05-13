import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ActionFeedback } from '../components/ActionFeedback';
import { DataStatePanel } from '../components/DataStatePanel';
import {
  EmptyStatePanel,
  FilterBar,
  KPIStatCard,
  MetadataGroup,
  MetadataRow,
  OperationalActionGroup,
  OperationalSection,
  OperationalTable,
  OperationalTableRow,
  OperationalToolbar,
  SearchInput,
  SeverityBadge,
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
    return 'Not synced';
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
  const normalized = status.toLowerCase();
  if (normalized === 'failed' || normalized === 'dead_letter_ready' || normalized === 'permanently_failed') {
    return 'danger' as const;
  }
  if (normalized === 'processed' || normalized === 'completed') {
    return 'success' as const;
  }
  if (normalized === 'processing' || normalized === 'retrying' || normalized === 'retry_scheduled') {
    return 'info' as const;
  }
  return 'attention' as const;
}

function canRetryOperationalJob(status: string) {
  return ['failed', 'retry_scheduled', 'dead_letter_ready'].includes(status.toLowerCase());
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
  const [searchTerm, setSearchTerm] = useState('');
  const [topicFilter, setTopicFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [payloadFilter, setPayloadFilter] = useState('all');
  const [eligibilityFilter, setEligibilityFilter] = useState('all');
  const [showPayloadPreview, setShowPayloadPreview] = useState(false);
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

  useEffect(() => {
    setShowPayloadPreview(false);
  }, [latestWebhookEventId]);

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

  const retryOperationalJobMutation = useMutationAction(
    async (operationalJobId: string) => runtimeServices.diagnostics.retryOperationalJob(operationalJobId),
    {
      invalidateQueryKeys: invalidateDiagnostics,
      onSuccess: (result) => {
        showFeedback(result.message ?? `Retry finished with ${result.retryStatus}.`, result.retryStatus === 'retried' ? 'success' : 'info');
      },
      onError: (error) => showFeedback(error instanceof Error ? error.message : 'Operational job retry failed.', 'error'),
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

  const filteredWebhooks = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    return (webhooksQuery.data?.events ?? []).filter((event) => {
      const matchesTopic = topicFilter === 'all' || event.topic === topicFilter;
      const matchesStatus = statusFilter === 'all' || event.status === statusFilter;
      const matchesPayload =
        payloadFilter === 'all' ||
        (payloadFilter === 'available' && event.payloadAvailable) ||
        (payloadFilter === 'missing' && !event.payloadAvailable);
      const matchesEligibility =
        eligibilityFilter === 'all' ||
        (eligibilityFilter === 'replayable' && event.replayEligible) ||
        (eligibilityFilter === 'recoverable' && event.recoverEligible) ||
        (eligibilityFilter === 'blocked' && !event.replayEligible && !event.recoverEligible);
      const searchableText = [
        event.id,
        event.topic,
        event.status,
        event.processingStatus ?? '',
        event.shopDomain,
        event.shopifyWebhookId ?? '',
        event.eventId ?? '',
        event.payloadHash ?? '',
        event.lastErrorSummary ?? '',
        event.recommendedAction,
        event.affectedEntities.shopifyOrderId ?? '',
        event.affectedEntities.shopifyOrderNumber ?? '',
        event.affectedEntities.shopifyReturnId ?? '',
        event.affectedEntities.shopifyRefundId ?? '',
        event.affectedEntities.shopifyFulfillmentId ?? '',
      ]
        .join(' ')
        .toLowerCase();

      return matchesTopic && matchesStatus && matchesPayload && matchesEligibility && (!query || searchableText.includes(query));
    });
  }, [eligibilityFilter, payloadFilter, searchTerm, statusFilter, topicFilter, webhooksQuery.data?.events]);

  const topicOptions = useMemo(() => {
    return Array.from(new Set((webhooksQuery.data?.events ?? []).map((event) => event.topic))).sort();
  }, [webhooksQuery.data?.events]);

  const selectedWebhook = webhookDetailQuery.data;
  const visibleWebhooks = filteredWebhooks.slice(0, 20);
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
      scheduledReconciliationJobs: reconciliationQuery.data?.summary.scheduledReconciliationJobs ?? 0,
      replayable: webhooksQuery.data?.events.filter((event) => event.replayEligible).length ?? 0,
      recoverable: webhooksQuery.data?.events.filter((event) => event.recoverEligible).length ?? 0,
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
          <StatusBadge tone="info">Scheduled {combinedCounts.scheduledReconciliationJobs}</StatusBadge>
          <StatusBadge tone="success">Processed {webhooksQuery.data.summary.processed}</StatusBadge>
        </div>
      </div>

      <div className="op-kpi-row">
        <KPIStatCard label="Processed" value={webhooksQuery.data.summary.processed} detail="Completed envelopes" tone="success" />
        <KPIStatCard label="Failed" value={webhooksQuery.data.summary.failed} detail="Backend processing failed" tone="danger" />
        <KPIStatCard label="Received / stuck" value={combinedCounts.stuck} detail="Not yet processed" tone="attention" />
        <KPIStatCard label="Missing payload" value={combinedCounts.missingPayload} detail="Recovery blocked" tone="warning" />
        <KPIStatCard label="Replayable" value={combinedCounts.replayable} detail="Safe idempotent retry" tone="info" />
        <KPIStatCard label="Recoverable" value={combinedCounts.recoverable} detail="Operator action enabled" tone="success" />
      </div>

      <div className="op-control-layout diagnostics-layout-redesign">
        <div className="op-main-column">
          <OperationalToolbar>
            <SearchInput
              placeholder="Search topic, payload hash, entity, error..."
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
            />
            <FilterBar>
              <select value={topicFilter} onChange={(event) => setTopicFilter(event.target.value)}>
                <option value="all">All topics</option>
                {topicOptions.map((topic) => (
                  <option key={topic} value={topic}>
                    {formatWebhookTopic(topic)}
                  </option>
                ))}
              </select>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                <option value="all">All statuses</option>
                <option value="RECEIVED">Received</option>
                <option value="PROCESSING">Processing</option>
                <option value="PROCESSED">Processed</option>
                <option value="FAILED">Failed</option>
              </select>
              <select value={payloadFilter} onChange={(event) => setPayloadFilter(event.target.value)}>
                <option value="all">All payloads</option>
                <option value="available">Payload available</option>
                <option value="missing">Payload missing</option>
              </select>
              <select value={eligibilityFilter} onChange={(event) => setEligibilityFilter(event.target.value)}>
                <option value="all">All action states</option>
                <option value="replayable">Replayable</option>
                <option value="recoverable">Recoverable</option>
                <option value="blocked">Blocked / no-op</option>
              </select>
              <button
                type="button"
                className="button button-secondary button-compact"
                onClick={() => {
                  setSearchTerm('');
                  setTopicFilter('all');
                  setStatusFilter('all');
                  setPayloadFilter('all');
                  setEligibilityFilter('all');
                }}
              >
                Reset
              </button>
            </FilterBar>
          </OperationalToolbar>

          <div className="diagnostics-filter-summary">
            <span>{filteredWebhooks.length} events</span>
            <span>{topicFilter === 'all' ? 'All webhook topics' : formatWebhookTopic(topicFilter)}</span>
            <span>{statusFilter === 'all' ? 'All processing statuses' : statusFilter}</span>
            <span>{payloadFilter === 'all' ? 'All payload states' : payloadFilter}</span>
          </div>

          {visibleWebhooks.length === 0 ? (
            <EmptyStatePanel
              title="No webhook events recorded"
              description="Live backend diagnostics will appear here once Shopify deliveries reach the backend, or when filters match recorded events."
            />
          ) : (
            <OperationalTable
              columns={['Status', 'Topic', 'Event ID', 'Payload', 'Eligibility', 'Affected entity', 'Received', 'Actions']}
              className="diagnostics-op-table diagnostics-op-table-v2"
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
                  <span>
                    <strong>{event.eventId ?? event.id}</strong>
                    <small>{event.shopifyWebhookId ?? 'Shopify webhook ID not provided'}</small>
                  </span>
                  <StatusBadge tone={event.payloadAvailable ? 'success' : 'warning'}>
                    {event.payloadAvailable ? 'Available' : 'Missing'}
                  </StatusBadge>
                  <span>
                    <strong>{event.recoverEligible ? 'Recover eligible' : event.replayEligible ? 'Replay available' : 'No action'}</strong>
                    <small>{event.recoverBlockedReason ?? event.replayBlockedReason ?? event.lastErrorSummary ?? event.recommendedAction}</small>
                  </span>
                  <span>{getPrimaryEntityLabel(event.affectedEntities)}</span>
                  <span>{formatDate(event.receivedAt)}</span>
                  <OperationalActionGroup>
                    <button
                      type="button"
                      className="button button-secondary button-compact"
                      onClick={(clickEvent) => {
                        clickEvent.stopPropagation();
                        setSelectedWebhookEventId(event.id);
                      }}
                    >
                      View
                    </button>
                    <button
                      type="button"
                      className="button button-secondary button-compact"
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
                      className="button button-primary button-compact"
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
                <EmptyStatePanel title="No active reconciliation work" description="No stuck webhook events, stale allocations, or sync failures are currently waiting for admin recovery." />
              ) : (
                <div className="op-event-list reconciliation-event-list">
                  {visibleReconciliationItems.map((item) => (
                    <article key={item.id} className="op-event-row reconciliation-event-row">
                      <SeverityBadge tone={getSeverityTone(item.severity)}>{item.severity}</SeverityBadge>
                      <div>
                        <strong>{item.title}</strong>
                        <p>{item.description}</p>
                        <small>Recommended action: {item.suggestedAction}</small>
                        <div className="reconciliation-meta">
                          <span>{toTitleCaseLabel(item.type)}</span>
                          <span>{item.status === 'processed' ? 'No-op / processed' : item.status}</span>
                          {item.operationalJobId ? <span>Job {item.operationalJobId}</span> : null}
                          {item.reconciliationReason ? <span>{toTitleCaseLabel(item.reconciliationReason)}</span> : null}
                          {item.relatedAllocationId ? <span>Allocation {item.relatedAllocationId}</span> : null}
                          {item.relatedShopifyOrderId ? <span>Order {item.relatedShopifyOrderId}</span> : null}
                          {item.nextAttemptAt ? <span>Next {formatDate(item.nextAttemptAt)}</span> : null}
                        </div>
                      </div>
                      <OperationalActionGroup>
                        <StatusBadge tone={item.payloadAvailable === false ? 'warning' : 'neutral'}>
                          {item.payloadAvailable === null ? 'No payload needed' : item.payloadAvailable ? 'Payload available' : 'Payload missing'}
                        </StatusBadge>
                        {item.relatedAllocationId ? (
                          <button
                            type="button"
                            className="button button-secondary button-compact"
                            disabled={reconcileAllocationMutation.isPending}
                            onClick={() => reconcileAllocationMutation.mutate(item.relatedAllocationId as string)}
                          >
                            Reconcile allocation
                          </button>
                        ) : null}
                        {!item.relatedAllocationId && item.relatedShopifyOrderId ? (
                          <button
                            type="button"
                            className="button button-secondary button-compact"
                            disabled={reconcileShopifyOrderMutation.isPending}
                            onClick={() => reconcileShopifyOrderMutation.mutate(item.relatedShopifyOrderId as string)}
                          >
                            Reconcile order
                          </button>
                        ) : null}
                        {!item.relatedAllocationId && !item.relatedShopifyOrderId ? (
                          <span className="queue-muted-action">No backend reconcile action exposed</span>
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
              <Link className="button button-secondary button-compact" to={`/admin/orders/${selectedWebhook.relatedShopifyOrderId}`}>
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
              <MetadataGroup title="Event identity">
                <MetadataRow label="Topic" value={formatWebhookTopic(selectedWebhook.topic)} />
                <MetadataRow label="Webhook event ID" value={selectedWebhook.id} />
                <MetadataRow label="Shopify webhook ID" value={selectedWebhook.shopifyWebhookId ?? 'Not provided'} />
                <MetadataRow label="Event ID" value={selectedWebhook.eventId ?? 'Not provided'} />
                <MetadataRow label="Shop domain" value={selectedWebhook.shopDomain} />
              </MetadataGroup>
              <MetadataGroup title="Recovery readiness">
                <MetadataRow label="Recoverability" value={formatRecoverability(selectedWebhook.payloadAvailable, selectedWebhook.status)} />
                <MetadataRow label="Recommended action" value={selectedWebhook.recommendedAction} />
                <MetadataRow label="Replay eligibility" value={selectedWebhook.replayEligible ? 'Replay allowed' : selectedWebhook.replayBlockedReason ?? 'Replay blocked'} />
                <MetadataRow label="Recover eligibility" value={selectedWebhook.recoverEligible ? 'Recover allowed' : selectedWebhook.recoverBlockedReason ?? 'Recover blocked'} />
                <MetadataRow label="Processing status" value={selectedWebhook.processingStatus ?? selectedWebhook.status} />
                <MetadataRow label="Last safe error" value={selectedWebhook.lastErrorSummary ?? selectedWebhook.errorMessage ?? 'No error recorded'} />
              </MetadataGroup>
              {(selectedWebhook.relatedJobs ?? []).length > 0 ? (
                <MetadataGroup title="Operational jobs">
                  {(selectedWebhook.relatedJobs ?? []).slice(0, 4).map((job) => (
                    <div key={job.id} className="diagnostics-job-row">
                      <div>
                        <strong>{toTitleCaseLabel(job.jobType)}</strong>
                        <small>
                          Retry {job.retryCount}/{job.maxRetries} · Next {formatDate(job.nextRetryAt ?? job.scheduledAt)}
                        </small>
                        {job.failureCategory ? <small>{toTitleCaseLabel(job.failureCategory)}</small> : null}
                        {job.escalationReason ? <small>{job.escalationReason}</small> : null}
                        {job.errorSummary ? <small>{job.errorSummary}</small> : null}
                      </div>
                      <div className="diagnostics-job-actions">
                        <StatusBadge tone={getStatusTone(job.status)}>{toTitleCaseLabel(job.status)}</StatusBadge>
                        {canRetryOperationalJob(job.status) ? (
                          <button
                            type="button"
                            className="button button-secondary button-compact"
                            disabled={retryOperationalJobMutation.isPending}
                            onClick={() => retryOperationalJobMutation.mutate(job.id)}
                          >
                            Retry
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </MetadataGroup>
              ) : null}
              <MetadataGroup title="Affected entities">
                <MetadataRow label="Shopify order" value={selectedWebhook.affectedEntities.shopifyOrderNumber ?? selectedWebhook.affectedEntities.shopifyOrderId ?? selectedWebhook.relatedShopifyOrderId ?? 'Not synced'} />
                <MetadataRow label="Shopify return" value={selectedWebhook.affectedEntities.shopifyReturnId ?? 'Not synced'} />
                <MetadataRow label="Shopify refund" value={selectedWebhook.affectedEntities.shopifyRefundId ?? 'Not synced'} />
                <MetadataRow label="Shopify fulfillment" value={selectedWebhook.affectedEntities.shopifyFulfillmentId ?? 'Not synced'} />
                <MetadataRow label="Received At" value={formatDate(selectedWebhook.receivedAt)} />
                <MetadataRow label="Processed At" value={formatDate(selectedWebhook.processedAt)} />
              </MetadataGroup>
              <div className="op-panel-section">
                <div className="diagnostics-compact-section-heading">
                  <h4>Recovery actions</h4>
                  <span>{selectedWebhook.recommendedAction}</span>
                </div>
                <OperationalActionGroup>
                  <button
                    type="button"
                    className="button button-primary button-compact"
                    disabled={!canRecover || recoverMutation.isPending}
                    onClick={() => recoverMutation.mutate(selectedWebhook.id)}
                  >
                    {recoverMutation.isPending ? 'Recovering...' : 'Recover'}
                  </button>
                  <button
                    type="button"
                    className="button button-secondary button-compact"
                    disabled={!canReplay || replayMutation.isPending}
                    onClick={() => replayMutation.mutate(selectedWebhook.id)}
                  >
                    {replayMutation.isPending ? 'Replaying...' : 'Replay'}
                  </button>
                </OperationalActionGroup>
                {!canRecover && selectedWebhook.recoverBlockedReason ? (
                  <p className="queue-muted-action diagnostics-inline-note">Recover blocked: {selectedWebhook.recoverBlockedReason}</p>
                ) : null}
                {!canReplay && selectedWebhook.replayBlockedReason ? (
                  <p className="queue-muted-action diagnostics-inline-note">Replay blocked: {selectedWebhook.replayBlockedReason}</p>
                ) : null}
                {!canRecover && !selectedWebhook.recoverBlockedReason && !canReplay && !selectedWebhook.replayBlockedReason ? (
                  <p className="queue-muted-action diagnostics-inline-note">No action recommended.</p>
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
                <div className="diagnostics-compact-section-heading">
                  <h4>Payload diagnostics</h4>
                  {selectedWebhook.payloadPreview ? (
                    <button
                      type="button"
                      className="button button-secondary button-compact"
                      onClick={() => setShowPayloadPreview((current) => !current)}
                    >
                      {showPayloadPreview ? 'Hide payload preview' : 'Show payload preview'}
                    </button>
                  ) : null}
                </div>
                <MetadataRow label="Payload hash" value={<code className="diagnostics-id-block">{selectedWebhook.payloadHash ?? 'Not synced'}</code>} />
                <MetadataRow label="Idempotency key" value={<code className="diagnostics-id-block">{selectedWebhook.idempotencyKey ?? 'Not synced'}</code>} />
                {selectedWebhook.payloadPreview && showPayloadPreview ? (
                  <pre className="diagnostics-payload-preview" aria-label="Payload preview">
                    {selectedWebhook.payloadPreview}
                    {selectedWebhook.payloadPreviewTruncated ? '\n...' : ''}
                  </pre>
                ) : selectedWebhook.payloadPreview ? (
                  <p className="page-description diagnostics-inline-note">Safe preview available. It remains collapsed by default.</p>
                ) : (
                  <p className="page-description diagnostics-inline-note">No payload preview.</p>
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
