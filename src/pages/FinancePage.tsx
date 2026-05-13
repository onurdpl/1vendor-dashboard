import { useMemo, useState } from 'react';
import { DataStatePanel } from '../components/DataStatePanel';
import { ActionFeedback } from '../components/ActionFeedback';
import {
  EmptyStatePanel,
  FilterBar,
  KPIStatCard,
  MetadataGroup,
  MetadataRow,
  OperationalActionGroup,
  OperationalTable,
  OperationalTableRow,
  OperationalToolbar,
  SearchInput,
  ShopifyEntityDisplay,
  SideDetailPanel,
  StatusBadge,
} from '../components/OperationalPrimitives';
import { queryKeys } from '../lib/api/queryKeys';
import { useQueryResource } from '../hooks/useQueryResource';
import { useActionFeedback } from '../lib/ui';
import { getFinanceDashboard } from '../features/finance/api';
import { getAvailableVendors, getCurrentUser, getCurrentVendorContext } from '../lib/auth';
import type { FinanceTransaction } from '../lib/api/contracts';

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
  if (status === 'Completed' || status === 'Reconciled' || status === 'Recorded') {
    return 'success' as const;
  }
  if (status === 'Failed') {
    return 'danger' as const;
  }
  return 'attention' as const;
}

function isRefundRecord(record: FinanceTransaction) {
  return record.category === 'Refund';
}

function isPendingOrHoldRecord(record: FinanceTransaction) {
  return record.status === 'Pending' || record.status === 'Recorded';
}

function getFinanceLifecycleLabel(record: FinanceTransaction) {
  if (record.status === 'Failed') {
    return 'Attention required';
  }
  if (record.status === 'Recorded') {
    return 'Ledger recorded';
  }
  if (record.status === 'Pending') {
    return 'Pending or held';
  }
  if (record.status === 'Reconciled') {
    return 'Reconciled';
  }
  return 'Completed';
}

export function FinancePage() {
  const { data: finance, isLoading, isError, error } = useQueryResource(queryKeys.finance.summary(), getFinanceDashboard);
  const { message, tone, showFeedback } = useActionFeedback();
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [vendorFilter, setVendorFilter] = useState('all');
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);
  const currentUser = getCurrentUser();
  const currentVendor = getCurrentVendorContext();
  const availableVendors = getAvailableVendors();

  const financeKpis = useMemo(() => {
    const transactions = finance?.transactions ?? [];
    const recordedRefunds = transactions.filter((record) => isRefundRecord(record) && record.status === 'Recorded').length;
    const pendingOrHeld = transactions.filter(isPendingOrHoldRecord).length;
    const failed = transactions.filter((record) => record.status === 'Failed').length;

    return {
      recordedRefunds,
      pendingOrHeld,
      failed,
    };
  }, [finance?.transactions]);

  const filteredRecords = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    return (finance?.transactions ?? []).filter((record) => {
      const recordVendorId = currentVendor.vendorId;
      const matchesStatus = statusFilter === 'all' || record.status === statusFilter;
      const matchesCategory = categoryFilter === 'all' || record.category === categoryFilter;
      const matchesVendor = vendorFilter === 'all' || recordVendorId === vendorFilter;
      const searchableText = [
        record.id,
        record.description,
        record.category,
        record.status,
        record.amount,
        record.counterparty,
        currentVendor.vendorName,
        currentVendor.vendorId,
        record.shopifyOrderNumber ?? '',
        record.shopifyOrderId ?? '',
        record.shopifyRefundId ?? '',
      ]
        .join(' ')
        .toLowerCase();

      return matchesStatus && matchesCategory && matchesVendor && (!query || searchableText.includes(query));
    });
  }, [categoryFilter, currentVendor.vendorId, currentVendor.vendorName, finance?.transactions, searchTerm, statusFilter, vendorFilter]);

  const selectedRecord = useMemo(() => {
    if (!filteredRecords.length) {
      return null;
    }
    return filteredRecords.find((record) => record.id === selectedRecordId) ?? filteredRecords[0];
  }, [filteredRecords, selectedRecordId]);

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
            Vendor-scoped ledger visibility for Shopify refunds, holds, failed records, and reporting-only payout estimates.
          </p>
        </div>
        <div className="op-heading-meta">
          <StatusBadge tone="info">Vendor {currentVendor.vendorName}</StatusBadge>
          <StatusBadge tone={currentUser?.role === 'admin' ? 'success' : 'neutral'}>{currentUser?.role ?? 'user'}</StatusBadge>
        </div>
      </div>

      <div className="op-kpi-row finance-kpi-row">
        <KPIStatCard label="Recorded refunds" value={financeKpis.recordedRefunds} detail="Refund ledger rows" tone="success" />
        <KPIStatCard label="Total refund amount" value={finance.summary.refunds} detail="Summary refund impact" tone="danger" />
        <KPIStatCard label="Pending / hold" value={financeKpis.pendingOrHeld} detail="Recorded or pending items" tone="attention" />
        <KPIStatCard label="Failed / attention" value={financeKpis.failed} detail="Requires operator review" tone="danger" />
        <KPIStatCard label="Vendor payable" value={finance.summary.payoutEstimate} detail="Placeholder; payout engine disabled" tone="neutral" />
      </div>

      <div className="op-control-layout finance-layout">
        <div className="op-main-column">
          <OperationalToolbar>
            <SearchInput
              placeholder="Search status, vendor, order, refund, amount..."
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
            />
            <FilterBar>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                <option value="all">All statuses</option>
                <option value="Recorded">Recorded</option>
                <option value="Pending">Pending</option>
                <option value="Completed">Completed</option>
                <option value="Reconciled">Reconciled</option>
                <option value="Failed">Failed</option>
              </select>
              <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
                <option value="all">All sources</option>
                <option value="Refund">Refund</option>
                <option value="Payout">Payout</option>
                <option value="Invoice">Invoice</option>
                <option value="Adjustment">Adjustment</option>
              </select>
              <select value={vendorFilter} onChange={(event) => setVendorFilter(event.target.value)}>
                <option value="all">Current vendor scope</option>
                {availableVendors.map((vendor) => (
                  <option key={vendor.vendorId} value={vendor.vendorId}>
                    {vendor.vendorName}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="button button-secondary"
                onClick={() => {
                  setSearchTerm('');
                  setStatusFilter('all');
                  setCategoryFilter('all');
                  setVendorFilter('all');
                }}
              >
                Reset
              </button>
            </FilterBar>
            <button
              type="button"
              className="button button-primary"
              onClick={() => showFeedback('Finance snapshot exported for review.', 'success')}
            >
              Export snapshot
            </button>
          </OperationalToolbar>

          {filteredRecords.length === 0 ? (
            <EmptyStatePanel
              title="No finance records in this view"
              description="Adjust the status, vendor, source, or text filters to inspect synced ledger rows."
            />
          ) : (
            <OperationalTable
              columns={['Status', 'Source', 'Vendor', 'Shopify order', 'Refund ID', 'Amount', 'Lifecycle', 'Updated', 'Actions']}
              className="finance-op-table finance-op-table-v2"
            >
              {filteredRecords.map((record) => (
                <OperationalTableRow
                  key={record.id}
                  selected={selectedRecord?.id === record.id}
                  onSelect={() => setSelectedRecordId(record.id)}
                >
                  <StatusBadge tone={getStatusTone(record.status)}>{record.status}</StatusBadge>
                  <ShopifyEntityDisplay label={record.category} primary={record.description} secondary={record.id} />
                  <ShopifyEntityDisplay label="Vendor" primary={currentVendor.vendorName} secondary={currentVendor.vendorId} />
                  <ShopifyEntityDisplay
                    label="Shopify Order"
                    primary={record.shopifyOrderNumber ? `#${record.shopifyOrderNumber}` : 'Not available'}
                    secondary={record.shopifyOrderId ? `ID ${record.shopifyOrderId}` : undefined}
                  />
                  <ShopifyEntityDisplay label="Shopify Refund" primary={record.shopifyRefundId ?? 'Not available'} />
                  <strong className={isRefundRecord(record) || record.category === 'Adjustment' ? 'finance-negative finance-amount-emphasis' : 'finance-positive finance-amount-emphasis'}>
                    {isRefundRecord(record) || record.category === 'Adjustment' ? '-' : ''}
                    {record.amount}
                  </strong>
                  <span>
                    <strong>{getFinanceLifecycleLabel(record)}</strong>
                    <small>{record.counterparty}</small>
                  </span>
                  <span>
                    <strong>{formatDate(record.date)}</strong>
                    <small>{record.category}</small>
                  </span>
                  <OperationalActionGroup>
                    <button type="button" className="button button-secondary" onClick={() => setSelectedRecordId(record.id)}>
                      View
                    </button>
                  </OperationalActionGroup>
                </OperationalTableRow>
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
                    isRefundRecord(selectedRecord) || selectedRecord.category === 'Adjustment'
                      ? 'finance-negative'
                      : 'finance-positive'
                  }
                >
                  {isRefundRecord(selectedRecord) || selectedRecord.category === 'Adjustment' ? '-' : ''}
                  {selectedRecord.amount}
                </strong>
              </div>
              <MetadataGroup title="Ledger metadata">
                <MetadataRow label="Ledger Record" value={selectedRecord.id} />
                <MetadataRow label="Source / type" value={selectedRecord.category} />
                <MetadataRow label="Lifecycle" value={getFinanceLifecycleLabel(selectedRecord)} />
                <MetadataRow label="Counterparty" value={selectedRecord.counterparty} />
                <MetadataRow label="Created At" value={formatDate(selectedRecord.date)} />
              </MetadataGroup>
              <MetadataGroup title="Shopify identifiers">
                <MetadataRow label="Shopify Order Number" value={selectedRecord.shopifyOrderNumber ? `#${selectedRecord.shopifyOrderNumber}` : 'Not available'} />
                <MetadataRow label="Shopify Order ID" value={selectedRecord.shopifyOrderId ?? 'Not available'} />
                <MetadataRow label="Shopify Refund ID" value={selectedRecord.shopifyRefundId ?? 'Not available'} />
              </MetadataGroup>
              <MetadataGroup title="Vendor scope">
                <MetadataRow label="Vendor" value={currentVendor.vendorName} />
                <MetadataRow label="Vendor ID" value={currentVendor.vendorId} />
                <MetadataRow label="Isolation" value="Current vendor-scoped finance query" />
              </MetadataGroup>
              <div className="op-panel-section">
                <h4>Related return / refund context</h4>
                <p className="page-description">
                  Finance rows are derived from backend ledger state and related Shopify order/refund identifiers where available. The payout engine is not enabled yet; payable values remain reporting placeholders.
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
