import { useMemo, useState } from 'react';
import { DataStatePanel } from '../components/DataStatePanel';
import { ActionFeedback } from '../components/ActionFeedback';
import {
  EmptyStatePanel,
  KPISummaryCard,
  MetadataRow,
  OperationalActionGroup,
  OperationalTable,
  ShopifyEntityDisplay,
  SideDetailPanel,
  StatusBadge,
} from '../components/OperationalPrimitives';
import { queryKeys } from '../lib/api/queryKeys';
import { useQueryResource } from '../hooks/useQueryResource';
import { useActionFeedback } from '../lib/ui';
import { getFinanceDashboard } from '../features/finance/api';
import { getCurrentUser, getCurrentVendorContext } from '../lib/auth';

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function getStatusTone(status: string) {
  if (status === 'Completed' || status === 'Reconciled') {
    return 'success' as const;
  }
  if (status === 'Failed') {
    return 'danger' as const;
  }
  return 'attention' as const;
}

export function FinancePage() {
  const { data: finance, isLoading, isError, error } = useQueryResource(queryKeys.finance.summary(), getFinanceDashboard);
  const { message, tone, showFeedback } = useActionFeedback();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);
  const currentUser = getCurrentUser();
  const currentVendor = getCurrentVendorContext();

  const filteredRecords = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    return (finance?.transactions ?? []).filter((record) => {
      if (!query) {
        return true;
      }
      return [
        record.id,
        record.description,
        record.category,
        record.status,
        record.shopifyOrderNumber ?? '',
        record.shopifyOrderId ?? '',
        record.shopifyRefundId ?? '',
      ]
        .join(' ')
        .toLowerCase()
        .includes(query);
    });
  }, [finance, searchTerm]);

  const selectedRecord = useMemo(() => {
    if (!finance?.transactions.length) {
      return null;
    }
    return finance.transactions.find((record) => record.id === selectedRecordId) ?? finance.transactions[0];
  }, [finance, selectedRecordId]);

  if (isLoading) {
    return (
      <DataStatePanel
        tone="loading"
        eyebrow="Finance"
        title="Loading finance overview"
        description="Fetching summary data and financial records from the central data layer."
      />
    );
  }

  if (isError || !finance) {
    return (
      <DataStatePanel
        tone="error"
        eyebrow="Finance"
        title="Finance unavailable"
        description={error ?? 'The financial overview could not be loaded.'}
      />
    );
  }

  return (
    <section className="op-page finance-control-center">
      <div className="op-page-heading">
        <div>
          <p className="eyebrow">Finance</p>
          <h2>{currentVendor.vendorName} finance control center</h2>
          <p className="page-description">
            Vendor-scoped ledger visibility for sales, refund deductions, platform fees, and payout estimates.
          </p>
        </div>
        <div className="op-heading-meta">
          <StatusBadge tone="info">Vendor {currentVendor.vendorName}</StatusBadge>
          <StatusBadge tone={currentUser?.role === 'admin' ? 'success' : 'neutral'}>{currentUser?.role ?? 'user'}</StatusBadge>
        </div>
      </div>

      <div className="op-kpi-row">
        <KPISummaryCard label="Gross sales" value={finance.summary.grossSales} detail="Vendor allocation sales" tone="success" />
        <KPISummaryCard label="Refunds" value={`-${finance.summary.refunds}`} detail="Processed refunds only" tone="danger" />
        <KPISummaryCard label="Net revenue" value={finance.summary.netRevenue} detail="After refund impact" tone="info" />
        <KPISummaryCard label="Platform fee" value={`-${finance.summary.platformFee}`} detail="Reporting model" tone="warning" />
        <KPISummaryCard label="Payout estimate" value={finance.summary.payoutEstimate} detail="No payout execution yet" tone="neutral" />
      </div>

      <div className="op-control-layout finance-layout">
        <div className="op-main-column">
          <div className="op-toolbar">
            <input
              type="search"
              placeholder="Search record, order, refund..."
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
            />
            <button type="button" className="button button-secondary" onClick={() => setSearchTerm('')}>
              Reset
            </button>
            <button
              type="button"
              className="button button-primary"
              onClick={() => showFeedback('Finance snapshot exported for review.', 'success')}
            >
              Export snapshot
            </button>
          </div>

          {filteredRecords.length === 0 ? (
            <EmptyStatePanel
              title="No finance records in this view"
              description="Ledger activity for sales, refunds, fees, and payout estimates will appear here when synced."
            />
          ) : (
            <OperationalTable
              columns={['Type', 'Record', 'Shopify order', 'Refund', 'Amount', 'Status', 'Date']}
              className="finance-op-table"
            >
              {filteredRecords.map((record) => (
                <div
                  key={record.id}
                  role="button"
                  tabIndex={0}
                  className={`op-table-row ${selectedRecord?.id === record.id ? 'op-row-selected' : ''}`}
                  onClick={() => setSelectedRecordId(record.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      setSelectedRecordId(record.id);
                    }
                  }}
                >
                  <span>
                    <strong>{record.category}</strong>
                    <small>{record.description}</small>
                  </span>
                  <ShopifyEntityDisplay label="Ledger" primary={record.id} secondary={record.counterparty} />
                  <ShopifyEntityDisplay
                    label="Shopify Order"
                    primary={record.shopifyOrderNumber ? `#${record.shopifyOrderNumber}` : 'Not available'}
                    secondary={record.shopifyOrderId ? `ID ${record.shopifyOrderId}` : undefined}
                  />
                  <ShopifyEntityDisplay label="Shopify Refund" primary={record.shopifyRefundId ?? 'Not available'} />
                  <strong className={record.category === 'Refund' || record.category === 'Adjustment' ? 'finance-negative' : 'finance-positive'}>
                    {record.category === 'Refund' || record.category === 'Adjustment' ? '-' : ''}
                    {record.amount}
                  </strong>
                  <StatusBadge tone={getStatusTone(record.status)}>{record.status}</StatusBadge>
                  <span>
                    <strong>{formatDate(record.date)}</strong>
                    <small>Created</small>
                  </span>
                </div>
              ))}
            </OperationalTable>
          )}
        </div>

        <SideDetailPanel eyebrow="Ledger detail" title={selectedRecord?.category ?? 'No record selected'}>
          {selectedRecord ? (
            <>
              <div className="op-detail-status-row">
                <StatusBadge tone={getStatusTone(selectedRecord.status)}>{selectedRecord.status}</StatusBadge>
                <strong
                  className={
                    selectedRecord.category === 'Refund' || selectedRecord.category === 'Adjustment'
                      ? 'finance-negative'
                      : 'finance-positive'
                  }
                >
                  {selectedRecord.category === 'Refund' || selectedRecord.category === 'Adjustment' ? '-' : ''}
                  {selectedRecord.amount}
                </strong>
              </div>
              <div className="op-meta-grid">
                <MetadataRow label="Ledger Record" value={selectedRecord.id} />
                <MetadataRow label="Shopify Order Number" value={selectedRecord.shopifyOrderNumber ? `#${selectedRecord.shopifyOrderNumber}` : 'Not available'} />
                <MetadataRow label="Shopify Order ID" value={selectedRecord.shopifyOrderId ?? 'Not available'} />
                <MetadataRow label="Shopify Refund ID" value={selectedRecord.shopifyRefundId ?? 'Not available'} />
                <MetadataRow label="Counterparty" value={selectedRecord.counterparty} />
                <MetadataRow label="Created At" value={formatDate(selectedRecord.date)} />
              </div>
              <div className="op-panel-section">
                <h4>Operational source</h4>
                <p className="page-description">
                  Finance remains reporting-only in this phase. Records are derived from backend ledger state and related Shopify order/refund metadata where available.
                </p>
              </div>
            </>
          ) : (
            <EmptyStatePanel title="Select a finance record" description="Choose a ledger record to inspect Shopify metadata and payout context." />
          )}
        </SideDetailPanel>
      </div>

      {message ? <ActionFeedback tone={tone} message={message} /> : null}
    </section>
  );
}
