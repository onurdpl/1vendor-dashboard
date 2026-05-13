import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { DataStatePanel } from '../components/DataStatePanel';
import {
  EmptyStatePanel,
  KPIStatCard,
  MetadataRow,
  OperationalActionGroup,
  OperationalTable,
  OperationalTableRow,
  SideDetailPanel,
  StatusBadge,
  TimelineBlock,
} from '../components/OperationalPrimitives';
import { useQueryResource } from '../hooks/useQueryResource';
import { queryKeys } from '../lib/api/queryKeys';
import { runtimeServices } from '../services/runtime-services';
import { toTitleCaseLabel } from '../services/real/formatting';
import type { OperationsQueueItem } from '../lib/api/contracts';

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function classifyOperationalSource(item: OperationsQueueItem) {
  const haystack = `${item.type} ${item.title} ${item.description}`.toLowerCase();

  if (item.type === 'awaiting_shipment') {
    return 'Awaiting shipment';
  }
  if (item.type === 'vendor_blocked') {
    return 'Blocked allocation';
  }
  if (item.type === 'pending_reassignment') {
    return 'Pending reassignment';
  }
  if (item.type === 'refund_attention') {
    return haystack.includes('return request') || haystack.includes('returns/request')
      ? 'Pending return request'
      : 'Refund attention';
  }
  if (item.type === 'automation_action') {
    return 'Automation suggestion';
  }
  if (haystack.includes('webhook') || haystack.includes('reconciliation') || haystack.includes('sync failed')) {
    return 'Webhook/reconciliation issue';
  }

  return 'Operational issue';
}

function getLifecycleLabel(type: string) {
  if (type === 'awaiting_shipment') {
    return 'Fulfillment lifecycle';
  }
  if (type === 'refund_attention') {
    return 'Return/refund lifecycle';
  }
  if (type === 'pending_reassignment' || type === 'vendor_blocked') {
    return 'Allocation lifecycle';
  }
  if (type === 'automation_action') {
    return 'Operator assist';
  }
  return 'Operational lifecycle';
}

function getSeverityTone(severity: OperationsQueueItem['severity']) {
  if (severity === 'critical') {
    return 'danger' as const;
  }
  if (severity === 'high') {
    return 'warning' as const;
  }
  if (severity === 'medium') {
    return 'attention' as const;
  }
  return 'neutral' as const;
}

function getActionLabel(type: string, fallback?: string) {
  if (type === 'pending_reassignment' || type === 'vendor_blocked') {
    return 'Review allocation';
  }
  if (type === 'awaiting_shipment' || type === 'refund_attention') {
    return 'View Shopify order';
  }
  if (type === 'automation_action') {
    return 'Review suggestion';
  }
  return fallback ?? 'View details';
}

export function AdminOperationsQueuePage() {
  const { data: queue, isLoading, isError, error } = useQueryResource(queryKeys.admin.operations.queue(), () =>
    runtimeServices.operations.list(),
  );
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);

  const selectedItem = useMemo(() => {
    if (!queue?.length) {
      return null;
    }
    return queue.find((item) => item.id === selectedItemId) ?? queue[0];
  }, [queue, selectedItemId]);

  if (isLoading) {
    return (
      <DataStatePanel
        tone="loading"
        eyebrow="Admin operations"
        title="Loading operations queue"
        description="Collecting allocation, fulfillment, and refund attention items."
      />
    );
  }

  if (isError || !queue) {
    return (
      <DataStatePanel
        tone="error"
        eyebrow="Admin operations"
        title="Queue unavailable"
        description={error ?? 'Operations queue could not be loaded.'}
      />
    );
  }

  const summary = queue.reduce<Record<string, number>>((acc, item) => {
    acc[item.type] = (acc[item.type] ?? 0) + 1;
    return acc;
  }, {});
  const criticalCount = queue.filter((item) => item.severity === 'critical').length;
  const warningCount = queue.filter((item) => item.severity === 'high').length;
  const attentionCount = queue.filter((item) => item.severity === 'medium').length;
  const severityOrder: Record<string, number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
  };
  const sortedQueue = [...queue].sort((a, b) => {
    const severityDiff = (severityOrder[a.severity] ?? 99) - (severityOrder[b.severity] ?? 99);
    if (severityDiff !== 0) {
      return severityDiff;
    }
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  return (
    <section className="op-page operations-control-center">
      <div className="op-page-heading">
        <div>
          <p className="eyebrow">Admin operations</p>
          <h2>Operations queue</h2>
          <p className="page-description">
            Prioritized control center for shipment progress, reassignment risk, blocked allocations, and return/refund attention.
          </p>
        </div>
        <div className="op-heading-meta">
          <StatusBadge tone="danger">Critical {criticalCount}</StatusBadge>
          <StatusBadge tone="warning">Warning {warningCount}</StatusBadge>
          <StatusBadge tone="attention">Attention {attentionCount}</StatusBadge>
        </div>
      </div>

      <div className="op-kpi-row">
        <KPIStatCard label="Pending reassignment" value={summary.pending_reassignment ?? 0} detail="Allocation lifecycle" tone="warning" />
        <KPIStatCard label="Awaiting shipment" value={summary.awaiting_shipment ?? 0} detail="Fulfillment lifecycle" tone="attention" />
        <KPIStatCard label="Vendor blocked" value={summary.vendor_blocked ?? 0} detail="Vendor action required" tone="danger" />
        <KPIStatCard label="Refund attention" value={summary.refund_attention ?? 0} detail="Return/refund lifecycle" tone="info" />
      </div>

      <div className="op-control-layout operations-layout">
        <div className="op-main-column">
          {sortedQueue.length === 0 ? (
            <EmptyStatePanel
              title="No active operational issues"
              description="Reassignment, blocked allocation, shipment, and refund queues are currently clear."
            />
          ) : (
            <OperationalTable
              columns={['Urgency', 'Source', 'Vendor', 'Lifecycle', 'Shopify order', 'Status', 'Created', 'Action']}
              className="operations-op-table"
            >
              {sortedQueue.map((item) => (
                <OperationalTableRow
                  key={item.id}
                  selected={selectedItem?.id === item.id}
                  onSelect={() => setSelectedItemId(item.id)}
                >
                  <StatusBadge tone={getSeverityTone(item.severity)}>{item.severity}</StatusBadge>
                  <span>
                    <strong>{classifyOperationalSource(item)}</strong>
                    <small>{item.title}</small>
                  </span>
                  <span>
                    <strong>{item.vendorName ?? item.vendorId}</strong>
                    <small>{item.vendorId}</small>
                  </span>
                  <span>
                    <strong>{getLifecycleLabel(item.type)}</strong>
                    <small>{toTitleCaseLabel(item.type)}</small>
                  </span>
                  <span>{item.relatedShopifyOrderId ?? 'Not synced'}</span>
                  <StatusBadge tone="info">{toTitleCaseLabel(item.status)}</StatusBadge>
                  <span>{formatDate(item.createdAt)}</span>
                  <OperationalActionGroup>
                    {item.actionTo ? (
                      <Link className="button button-secondary button-link" to={item.actionTo}>
                        {getActionLabel(item.type, item.actionLabel)}
                      </Link>
                    ) : (
                      <span className="queue-muted-action">No action</span>
                    )}
                  </OperationalActionGroup>
                </OperationalTableRow>
              ))}
            </OperationalTable>
          )}
        </div>

        <SideDetailPanel
          eyebrow="Selected task"
          title={selectedItem ? classifyOperationalSource(selectedItem) : 'No task selected'}
          action={
            selectedItem?.actionTo ? (
              <Link className="button button-primary button-link" to={selectedItem.actionTo}>
                Open
              </Link>
            ) : null
          }
        >
          {selectedItem ? (
            <>
              <div className="op-detail-status-row">
                <StatusBadge tone={getSeverityTone(selectedItem.severity)}>{selectedItem.severity}</StatusBadge>
                <StatusBadge tone="info">{toTitleCaseLabel(selectedItem.status)}</StatusBadge>
              </div>
              <p className="page-description">{selectedItem.description}</p>
              <div className="op-meta-grid">
                <MetadataRow label="Lifecycle" value={getLifecycleLabel(selectedItem.type)} />
                <MetadataRow label="Queue type" value={toTitleCaseLabel(selectedItem.type)} />
                <MetadataRow label="Vendor" value={selectedItem.vendorName ?? selectedItem.vendorId} />
                <MetadataRow label="Allocation ID" value={selectedItem.relatedOrderId ?? 'Not synced'} />
                <MetadataRow label="Shopify Order ID" value={selectedItem.relatedShopifyOrderId ?? 'Not synced'} />
                <MetadataRow label="Created At" value={formatDate(selectedItem.createdAt)} />
              </div>
              <div className="op-panel-section">
                <h4>Operational path</h4>
                <TimelineBlock
                  items={[
                    { label: 'Created', at: formatDate(selectedItem.createdAt) },
                    { label: classifyOperationalSource(selectedItem), detail: getLifecycleLabel(selectedItem.type) },
                    { label: selectedItem.actionLabel ?? 'Review', detail: selectedItem.actionTo ? 'Linked action available' : 'No direct action available' },
                  ]}
                />
              </div>
            </>
          ) : (
            <EmptyStatePanel title="Select a queue item" description="Choose a task to inspect source, severity, and recommended action." />
          )}
        </SideDetailPanel>
      </div>
    </section>
  );
}
