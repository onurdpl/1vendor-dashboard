import { useEffect, useMemo, useState, type FormEvent } from 'react';
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
import { useMutationAction } from '../hooks/useMutationAction';
import { useActionFeedback } from '../lib/ui';
import { getFinanceDashboard, updateVendorFinancialProfile } from '../features/finance/api';
import { getAvailableVendors, getCurrentUser, getCurrentVendorContext } from '../lib/auth';
import type { FinanceTransaction } from '../lib/api/contracts';

type VendorProfileFormInput = {
  commissionPercent: number;
  commissionVatPercent: number;
  deductShippingEnabled: boolean;
  shippingMode: 'disabled' | 'fixed' | 'external_provider';
  fixedShippingFee: number | null;
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function normalizeFinanceStatus(status: string) {
  const normalized = status.trim().toLowerCase();
  if (normalized === 'hold' || normalized === 'recorded' || normalized === 'synced' || normalized === 'posted') {
    return 'Recorded';
  }
  if (normalized === 'failed' || normalized === 'error') {
    return 'Failed';
  }
  if (normalized === 'reconciled') {
    return 'Reconciled';
  }
  if (normalized === 'completed' || normalized === 'processed') {
    return 'Completed';
  }
  if (normalized === 'pending') {
    return 'Pending';
  }
  return status;
}

function getStatusTone(status: string) {
  const displayStatus = normalizeFinanceStatus(status);
  if (displayStatus === 'Completed' || displayStatus === 'Reconciled' || displayStatus === 'Recorded') {
    return 'success' as const;
  }
  if (displayStatus === 'Failed') {
    return 'danger' as const;
  }
  return 'attention' as const;
}

function isRefundRecord(record: FinanceTransaction) {
  return record.category === 'Refund';
}

function isPendingOrHoldRecord(record: FinanceTransaction) {
  const status = normalizeFinanceStatus(record.status);
  return status === 'Pending' || status === 'Recorded';
}

function getFinanceLifecycleLabel(record: FinanceTransaction) {
  const status = normalizeFinanceStatus(record.status);
  if (status === 'Failed') {
    return 'Attention required';
  }
  if (status === 'Recorded') {
    return 'Ledger recorded';
  }
  if (status === 'Pending') {
    return 'Pending or held';
  }
  if (status === 'Reconciled') {
    return 'Reconciled';
  }
  return 'Completed';
}

export function FinancePage() {
  const { data: finance, isLoading, isError, error, refetch } = useQueryResource(queryKeys.finance.summary(), getFinanceDashboard);
  const { message, tone, showFeedback } = useActionFeedback();
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [vendorFilter, setVendorFilter] = useState('all');
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);
  const [commissionPercent, setCommissionPercent] = useState('10.00');
  const [commissionVatPercent, setCommissionVatPercent] = useState('0.00');
  const [deductShippingEnabled, setDeductShippingEnabled] = useState(false);
  const [shippingMode, setShippingMode] = useState<'disabled' | 'fixed' | 'external_provider'>('disabled');
  const [fixedShippingFee, setFixedShippingFee] = useState('');
  const currentUser = getCurrentUser();
  const currentVendor = getCurrentVendorContext();
  const availableVendors = getAvailableVendors();
  const isAdmin = currentUser?.role === 'admin';
  const saveProfileMutation = useMutationAction(
    (input: VendorProfileFormInput) =>
      updateVendorFinancialProfile(currentVendor.vendorId, input),
    {
      invalidateQueryKeys: [queryKeys.finance.summary()],
      onSuccess: async () => {
        await refetch();
        showFeedback('Vendor financial profile saved.', 'success');
      },
      onError: (mutationError) =>
        showFeedback(mutationError instanceof Error ? mutationError.message : 'Financial profile could not be saved.', 'error'),
    },
  );

  useEffect(() => {
    if (!finance?.profile) {
      return;
    }

    setCommissionPercent(finance.profile.commissionPercent);
    setCommissionVatPercent(finance.profile.commissionVatPercent);
    setDeductShippingEnabled(finance.profile.deductShippingEnabled);
    setShippingMode(finance.profile.shippingMode);
    setFixedShippingFee(finance.profile.fixedShippingFee ?? '');
  }, [finance?.profile]);

  async function handleSaveVendorProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const nextShippingMode = String(formData.get('shippingMode') ?? 'disabled') as VendorProfileFormInput['shippingMode'];

    try {
      await saveProfileMutation.mutateAsync({
        commissionPercent: Number(formData.get('commissionPercent') || 0),
        commissionVatPercent: Number(formData.get('commissionVatPercent') || 0),
        deductShippingEnabled: formData.has('deductShippingEnabled'),
        shippingMode: nextShippingMode,
        fixedShippingFee: String(formData.get('fixedShippingFee') ?? '').trim()
          ? Number(formData.get('fixedShippingFee'))
          : null,
      });
    } catch {
      // The mutation onError handler renders the compact save failure message.
    }
  }

  const financeKpis = useMemo(() => {
    const transactions = finance?.transactions ?? [];
    const recordedRefunds = transactions.filter((record) => isRefundRecord(record) && normalizeFinanceStatus(record.status) === 'Recorded').length;
    const pendingOrHeld = transactions.filter(isPendingOrHoldRecord).length;
    const failed = transactions.filter((record) => normalizeFinanceStatus(record.status) === 'Failed').length;

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
      const displayStatus = normalizeFinanceStatus(record.status);
      const matchesStatus = statusFilter === 'all' || displayStatus === statusFilter;
      const matchesCategory = categoryFilter === 'all' || record.category === categoryFilter;
      const matchesVendor = vendorFilter === 'all' || recordVendorId === vendorFilter;
      const searchableText = [
        record.id,
        record.description,
        record.category,
        displayStatus,
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
        <KPIStatCard label="Commission" value={finance.summary.platformFee} detail={`${finance.profile?.commissionPercent ?? '10.00'}% vendor profile`} tone="neutral" />
        <KPIStatCard label="Vendor payable" value={finance.summary.payoutEstimate} detail="Estimated before settlement engine" tone="neutral" />
      </div>

      <section className="operational-card finance-profile-card">
        <div>
          <p className="eyebrow">Vendor finance profile</p>
          <h3>{currentVendor.vendorName} payout settings</h3>
          <p className="page-description">
            Applies to new vendor payout estimates from now on. Existing ledger rows keep their original profile snapshot.
          </p>
        </div>
        <div className="finance-profile-summary">
          <MetadataRow label="Commission" value={`${finance.profile?.commissionPercent ?? '10.00'}%`} />
          <MetadataRow label="Commission VAT" value={`${finance.profile?.commissionVatPercent ?? '0.00'}%`} />
          <MetadataRow label="Shipping mode" value={finance.profile?.shippingMode ?? 'disabled'} />
          <MetadataRow label="Shipping deduction" value={finance.profile?.deductShippingEnabled ? 'After fulfillment' : 'Disabled'} />
        </div>
        {isAdmin ? (
          <form className="finance-profile-form" aria-label="Vendor finance profile settings" onSubmit={handleSaveVendorProfile}>
            <div className="op-form-grid">
              <label>
                <span>Commission %</span>
                <input
                  name="commissionPercent"
                  value={commissionPercent}
                  onChange={(event) => setCommissionPercent(event.target.value)}
                  inputMode="decimal"
                />
              </label>
              <label>
                <span>Commission VAT %</span>
                <input
                  name="commissionVatPercent"
                  value={commissionVatPercent}
                  onChange={(event) => setCommissionVatPercent(event.target.value)}
                  inputMode="decimal"
                />
              </label>
              <label>
                <span>Shipping mode</span>
                <select name="shippingMode" value={shippingMode} onChange={(event) => setShippingMode(event.target.value as typeof shippingMode)}>
                  <option value="disabled">Disabled</option>
                  <option value="fixed">Fixed</option>
                  <option value="external_provider">External provider</option>
                </select>
              </label>
              <label>
                <span>Fixed shipping fee</span>
                <input
                  name="fixedShippingFee"
                  value={fixedShippingFee}
                  onChange={(event) => setFixedShippingFee(event.target.value)}
                  inputMode="decimal"
                />
              </label>
            </div>
            <label className="op-checkbox-row">
              <input
                name="deductShippingEnabled"
                type="checkbox"
                checked={deductShippingEnabled}
                onChange={(event) => setDeductShippingEnabled(event.target.checked)}
              />
              <span>Deduct shipping after fulfillment</span>
            </label>
            <button
              type="submit"
              className="button button-primary"
              disabled={saveProfileMutation.isPending}
            >
              {saveProfileMutation.isPending ? 'Saving...' : 'Save vendor profile'}
            </button>
          </form>
        ) : (
          <StatusBadge tone="neutral">Read-only vendor profile</StatusBadge>
        )}
      </section>

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
                  <StatusBadge tone={getStatusTone(record.status)}>{normalizeFinanceStatus(record.status)}</StatusBadge>
                  <ShopifyEntityDisplay label={record.category} primary={record.description} secondary={record.id} />
                  <ShopifyEntityDisplay label="Vendor" primary={currentVendor.vendorName} secondary={currentVendor.vendorId} />
                  <ShopifyEntityDisplay
                    label="Shopify Order"
                    primary={record.shopifyOrderNumber ? `#${record.shopifyOrderNumber}` : 'Not synced'}
                    secondary={record.shopifyOrderId ? `ID ${record.shopifyOrderId}` : undefined}
                  />
                  <ShopifyEntityDisplay label="Shopify Refund" primary={record.shopifyRefundId ?? 'Not synced'} />
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
                <StatusBadge tone={getStatusTone(selectedRecord.status)}>{normalizeFinanceStatus(selectedRecord.status)}</StatusBadge>
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
              {selectedRecord.payoutCalculation ? (
                <MetadataGroup title="Payout estimate">
                  <MetadataRow label="Gross amount" value={selectedRecord.payoutCalculation.grossAmount} />
                  <MetadataRow label="Commission" value={selectedRecord.payoutCalculation.commission} />
                  <MetadataRow label="Commission VAT" value={selectedRecord.payoutCalculation.commissionVat} />
                  <MetadataRow label="Shipping deduction" value={selectedRecord.payoutCalculation.shippingDeduction} />
                  <MetadataRow label="Refund impact" value={selectedRecord.payoutCalculation.refundImpact} />
                  <MetadataRow label="Estimated payout" value={selectedRecord.payoutCalculation.estimatedPayout} />
                </MetadataGroup>
              ) : null}
              <MetadataGroup title="Shopify identifiers">
                <MetadataRow label="Shopify Order Number" value={selectedRecord.shopifyOrderNumber ? `#${selectedRecord.shopifyOrderNumber}` : 'Not synced'} />
                <MetadataRow label="Shopify Order ID" value={selectedRecord.shopifyOrderId ?? 'Not synced'} />
                <MetadataRow label="Shopify Refund ID" value={selectedRecord.shopifyRefundId ?? 'Not synced'} />
              </MetadataGroup>
              <MetadataGroup title="Vendor scope">
                <MetadataRow label="Vendor" value={currentVendor.vendorName} />
                <MetadataRow label="Vendor ID" value={currentVendor.vendorId} />
                <MetadataRow label="Isolation" value="Current vendor-scoped finance query" />
              </MetadataGroup>
              <MetadataGroup title="Vendor financial profile">
                <MetadataRow label="Profile used" value={selectedRecord.payoutCalculation?.profileSource ?? finance.profile?.source ?? 'default'} />
                <MetadataRow label="Commission used" value={`${selectedRecord.payoutCalculation?.commissionPercent ?? finance.profile?.commissionPercent ?? '10.00'}%`} />
                <MetadataRow label="Commission VAT used" value={`${selectedRecord.payoutCalculation?.commissionVatPercent ?? finance.profile?.commissionVatPercent ?? '0.00'}%`} />
                <MetadataRow label="Current profile" value={`${finance.profile?.commissionPercent ?? '10.00'}% / ${finance.profile?.commissionVatPercent ?? '0.00'}% VAT`} />
                <MetadataRow label="Shipping mode" value={selectedRecord.payoutCalculation?.shippingMode ?? finance.profile?.shippingMode ?? 'disabled'} />
                <MetadataRow label="Shipping deductions" value={finance.summary.shippingDeductions ?? '$0.00'} />
              </MetadataGroup>
              <div className="op-panel-section">
                <h4>Related return / refund context</h4>
                <p className="page-description">
                  Finance rows are derived from backend ledger state and vendor profile settings. The settlement engine is not enabled yet.
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
