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
  TimelineBlock,
} from '../components/OperationalPrimitives';
import { queryKeys } from '../lib/api/queryKeys';
import { useQueryResource } from '../hooks/useQueryResource';
import { useMutationAction } from '../hooks/useMutationAction';
import { useActionFeedback } from '../lib/ui';
import {
  attachShippingCost,
  createInvoiceExecution,
  getFinanceDashboard,
  preparePayoutBatch,
  retryInvoiceExecution,
  updateVendorFinancialProfile,
} from '../features/finance/api';
import { getAvailableVendors, getCurrentUser, getCurrentVendorContext, getToken } from '../lib/auth';
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

function getCalculationProfileSourceLabel(source?: string) {
  if (source === 'snapshot') {
    return 'Snapshot at sale creation';
  }
  if (source === 'current') {
    return 'Current vendor profile';
  }
  if (source === 'default') {
    return 'Default profile';
  }
  return 'Default profile';
}

function isZeroCurrencyValue(value: string) {
  return !/[1-9]/.test(value.replace(/[^\d]/g, ''));
}

function formatDeductionValue(value: string) {
  if (value.startsWith('-') || isZeroCurrencyValue(value)) {
    return value;
  }
  return `-${value}`;
}

function getPayoutBatchStatusLabel(status?: string) {
  if (!status) {
    return 'Not batched';
  }

  return status
    .split('_')
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function getInvoiceStatusLabel(status?: string) {
  if (!status) {
    return 'Not created';
  }

  return status
    .split('_')
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function getVendorTimelineItems(record: FinanceTransaction) {
  const settlement = record.settlement;
  return [
    {
      label: settlement?.status === 'accruing' ? 'Accruing' : 'Accrued',
      at: settlement?.accruedAt ?? record.date,
    },
    {
      label: settlement?.payoutReady ? 'Payable' : 'Waiting for payout readiness',
      at: settlement?.payableAt ?? settlement?.eligibleAt ?? null,
      detail: settlement?.payoutReady ? 'Ready' : 'Pending',
    },
    {
      label: record.payoutBatch ? 'Included in payout batch' : 'Not batched yet',
      at: record.payoutBatch?.createdAt ?? null,
      detail: record.payoutBatch ? getPayoutBatchStatusLabel(record.payoutBatch.status) : 'Upcoming payout not prepared',
    },
    {
      label: record.payoutBatch?.status === 'paid_placeholder' ? 'Paid placeholder' : 'Payout pending',
      at: null,
      detail: record.payoutBatch?.status === 'paid_placeholder' ? 'Marked placeholder only' : 'No payment execution yet',
    },
  ];
}

export function FinancePage() {
  const currentUser = getCurrentUser();
  const currentVendor = getCurrentVendorContext();
  const authContextReady = Boolean(getToken() && currentUser && currentVendor.vendorId);
  const { data: finance, isLoading, isError, error, refetch } = useQueryResource(
    queryKeys.finance.summary(currentVendor.vendorId),
    () => getFinanceDashboard({ vendorId: currentVendor.vendorId }),
    { enabled: authContextReady },
  );
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
  const [shippingCostProvider, setShippingCostProvider] = useState('Manual provider');
  const [shippingCostAmount, setShippingCostAmount] = useState('');
  const [shippingVatAmount, setShippingVatAmount] = useState('');
  const availableVendors = getAvailableVendors();
  const isAdmin = currentUser?.role === 'admin';
  const isVendorUser = currentUser?.role === 'vendor';
  const saveProfileMutation = useMutationAction(
    (input: VendorProfileFormInput) =>
      updateVendorFinancialProfile(currentVendor.vendorId, input),
    {
      invalidateQueryKeys: [queryKeys.finance.summary(currentVendor.vendorId)],
      onSuccess: async () => {
        await refetch();
        showFeedback('Vendor financial profile saved.', 'success');
      },
      onError: (mutationError) =>
        showFeedback(mutationError instanceof Error ? mutationError.message : 'Financial profile could not be saved.', 'error'),
    },
  );
  const preparePayoutBatchMutation = useMutationAction(
    () => preparePayoutBatch(currentVendor.vendorId),
    {
      invalidateQueryKeys: [queryKeys.finance.summary(currentVendor.vendorId)],
      onSuccess: async (batch) => {
        await refetch();
        showFeedback(`Draft payout batch ${batch.id} prepared for review.`, 'success');
      },
      onError: (mutationError) =>
        showFeedback(mutationError instanceof Error ? mutationError.message : 'Payout batch could not be prepared.', 'error'),
    },
  );
  const attachShippingCostMutation = useMutationAction(
    (input: {
      financeLedgerEntryId: string;
      providerName: string;
      providerReference: string | null;
      shippingCost: number;
      shippingVatAmount: number | null;
    }) =>
      attachShippingCost({
        vendorId: currentVendor.vendorId,
        financeLedgerEntryId: input.financeLedgerEntryId,
        providerName: input.providerName,
        providerReference: input.providerReference,
        shippingCost: input.shippingCost,
        shippingVatAmount: input.shippingVatAmount,
        status: 'confirmed',
        sourceType: 'manual',
      }),
    {
      invalidateQueryKeys: [queryKeys.finance.summary(currentVendor.vendorId)],
      onSuccess: async () => {
        await refetch();
        showFeedback('Shipping cost saved for future payout context.', 'success');
      },
      onError: (mutationError) =>
        showFeedback(mutationError instanceof Error ? mutationError.message : 'Shipping cost could not be saved.', 'error'),
    },
  );
  const createInvoiceMutation = useMutationAction(
    (financeLedgerEntryId: string) => createInvoiceExecution(financeLedgerEntryId),
    {
      invalidateQueryKeys: [queryKeys.finance.summary(currentVendor.vendorId)],
      onSuccess: async (execution) => {
        await refetch();
        showFeedback(
          execution.status === 'created'
            ? 'Invoice execution created for this ledger row.'
            : `Invoice execution recorded as ${getInvoiceStatusLabel(execution.status).toLowerCase()}.`,
          execution.status === 'failed' ? 'error' : 'success',
        );
      },
      onError: (mutationError) =>
        showFeedback(mutationError instanceof Error ? mutationError.message : 'Invoice execution could not be created.', 'error'),
    },
  );
  const retryInvoiceMutation = useMutationAction(
    (invoiceExecutionId: string) => retryInvoiceExecution(invoiceExecutionId),
    {
      invalidateQueryKeys: [queryKeys.finance.summary(currentVendor.vendorId)],
      onSuccess: async (execution) => {
        await refetch();
        showFeedback(
          execution.status === 'created'
            ? 'Invoice execution retry created the provider invoice.'
            : `Invoice execution retry recorded as ${getInvoiceStatusLabel(execution.status).toLowerCase()}.`,
          execution.status === 'failed' ? 'error' : 'success',
        );
      },
      onError: (mutationError) =>
        showFeedback(mutationError instanceof Error ? mutationError.message : 'Invoice execution could not be retried.', 'error'),
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

  async function handleAttachShippingCost(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedRecord) {
      return;
    }
    const formData = new FormData(event.currentTarget);

    try {
      await attachShippingCostMutation.mutateAsync({
        financeLedgerEntryId: selectedRecord.id,
        providerName: String(formData.get('providerName') ?? '').trim() || 'Manual provider',
        providerReference: String(formData.get('providerReference') ?? '').trim() || null,
        shippingCost: Number(formData.get('shippingCost') || 0),
        shippingVatAmount: String(formData.get('shippingVatAmount') ?? '').trim()
          ? Number(formData.get('shippingVatAmount'))
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

  if (!authContextReady || isLoading) {
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
    <section className={`op-page finance-control-center ${isVendorUser ? 'finance-vendor-workspace' : ''}`}>
      <div className="op-page-heading">
        <div>
          <p className="eyebrow">Finance</p>
          <h2>{currentVendor.vendorName} {isVendorUser ? 'balance workspace' : 'finance control center'}</h2>
          <p className="page-description">
            {isVendorUser
              ? 'Your sales, refunds, deductions, and upcoming payout status in one vendor-scoped view.'
              : 'Vendor-scoped ledger visibility for Shopify refunds, holds, failed records, and reporting-only payout estimates.'}
          </p>
        </div>
        <div className="op-heading-meta">
          <StatusBadge tone="info">Vendor {currentVendor.vendorName}</StatusBadge>
          <StatusBadge tone={currentUser?.role === 'admin' ? 'success' : 'neutral'}>{currentUser?.role ?? 'user'}</StatusBadge>
        </div>
      </div>

      {isVendorUser ? (
        <div className="op-kpi-row finance-kpi-row finance-vendor-balance-row">
          <KPIStatCard label="Payable balance" value={finance.summary.payableBalance ?? finance.summary.payoutEstimate} detail="Ready for payout preparation" tone="success" />
          <KPIStatCard label="Upcoming payout" value={finance.payoutBatchSummary?.eligibleNetAmount ?? finance.summary.payableBalance ?? finance.summary.payoutEstimate} detail={`${finance.payoutBatchSummary?.eligibleRowCount ?? 0} payable rows`} tone="info" />
          <KPIStatCard label="Accruing balance" value={finance.summary.accruedBalance ?? '$0.00'} detail="Waiting for fulfillment or payout readiness" tone="attention" />
          <KPIStatCard label="Refund impact" value={finance.summary.refunds} detail="Refunds reduce vendor payout" tone="danger" />
          <KPIStatCard label="Held / pending" value={finance.summary.heldBalance ?? finance.summary.pendingSettlement ?? '$0.00'} detail="Not currently payout-ready" tone="neutral" />
        </div>
      ) : (
        <div className="op-kpi-row finance-kpi-row">
          <KPIStatCard label="Recorded refunds" value={financeKpis.recordedRefunds} detail="Refund ledger rows" tone="success" />
          <KPIStatCard label="Total refund amount" value={finance.summary.refunds} detail="Summary refund impact" tone="danger" />
          <KPIStatCard label="Pending / hold" value={financeKpis.pendingOrHeld} detail="Recorded or pending items" tone="attention" />
          <KPIStatCard label="Failed / attention" value={financeKpis.failed} detail="Requires operator review" tone="danger" />
          <KPIStatCard label="Commission" value={finance.summary.platformFee} detail={`${finance.profile?.commissionPercent ?? '10.00'}% vendor profile`} tone="neutral" />
          <KPIStatCard label="Vendor payable" value={finance.summary.payableBalance ?? finance.summary.payoutEstimate} detail="Fulfilled settlement-ready balance" tone="success" />
          <KPIStatCard label="Accrued balance" value={finance.summary.accruedBalance ?? finance.summary.payoutEstimate} detail="Pending fulfillment or settlement readiness" tone="attention" />
        </div>
      )}

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

      <section className="operational-card finance-payout-prep-card">
        <div>
          <p className="eyebrow">Payout preparation</p>
          <h3>{currentVendor.vendorName} upcoming payout</h3>
          <p className="page-description">
            {isVendorUser
              ? 'Upcoming payout reflects payable rows and prepared draft batches. This view is read-only.'
              : 'Draft batches group payable ledger rows for admin review only. No payment execution is performed here.'}
          </p>
        </div>
        <div className="finance-profile-summary">
          <MetadataRow label="Eligible rows" value={finance.payoutBatchSummary?.eligibleRowCount ?? 0} />
          <MetadataRow label="Eligible net" value={finance.payoutBatchSummary?.eligibleNetAmount ?? finance.summary.payableBalance ?? finance.summary.payoutEstimate} />
          <MetadataRow label="Blocked rows" value={finance.payoutBatchSummary?.blockedRowCount ?? 0} />
          <MetadataRow
            label={isVendorUser ? 'Latest payout batch' : 'Latest draft'}
            value={
              finance.payoutBatchSummary?.latestBatch
                ? `${getPayoutBatchStatusLabel(finance.payoutBatchSummary.latestBatch.status)} · ${finance.payoutBatchSummary.latestBatch.netAmount}`
                : 'No draft prepared'
            }
          />
        </div>
        {isAdmin ? (
          <div className="finance-payout-prep-actions">
            <button
              type="button"
              className="button button-primary button-compact"
              disabled={preparePayoutBatchMutation.isPending || (finance.payoutBatchSummary?.eligibleRowCount ?? 0) === 0}
              onClick={() => preparePayoutBatchMutation.mutate(undefined)}
            >
              {preparePayoutBatchMutation.isPending ? 'Preparing...' : 'Prepare draft payout'}
            </button>
            <StatusBadge tone={(finance.payoutBatchSummary?.eligibleRowCount ?? 0) > 0 ? 'success' : 'neutral'}>
              {(finance.payoutBatchSummary?.eligibleRowCount ?? 0) > 0 ? 'Payable rows ready' : 'No payable rows'}
            </StatusBadge>
          </div>
        ) : (
          <StatusBadge tone="neutral">Read-only upcoming payout</StatusBadge>
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
              columns={['Status', 'Source', 'Vendor', 'Order', 'Refund', 'Amount', 'Life', 'Updated', 'Action']}
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
                  <ShopifyEntityDisplay label="Vendor" primary={currentVendor.vendorName} />
                  <ShopifyEntityDisplay
                    label="Shopify Order"
                    primary={record.shopifyOrderNumber ? `#${record.shopifyOrderNumber}` : 'Not synced'}
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
                    <button type="button" className="button button-secondary button-compact" onClick={() => setSelectedRecordId(record.id)}>
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
                {selectedRecord.invoiceExecution ? (
                  <StatusBadge tone={selectedRecord.invoiceExecution.status === 'created' ? 'success' : selectedRecord.invoiceExecution.status === 'failed' ? 'danger' : 'attention'}>
                    Invoice {getInvoiceStatusLabel(selectedRecord.invoiceExecution.status)}
                  </StatusBadge>
                ) : null}
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
              {isVendorUser ? null : (
                <MetadataGroup title="Ledger metadata">
                  <MetadataRow label="Ledger Record" value={selectedRecord.id} />
                  <MetadataRow label="Source / type" value={selectedRecord.category} />
                  <MetadataRow label="Lifecycle" value={getFinanceLifecycleLabel(selectedRecord)} />
                  <MetadataRow label="Counterparty" value={selectedRecord.counterparty} />
                  <MetadataRow label="Created At" value={formatDate(selectedRecord.date)} />
                </MetadataGroup>
              )}
              {selectedRecord.payoutCalculation ? (
                <MetadataGroup title={isVendorUser ? 'Payout breakdown' : 'Payout estimate'}>
                  <MetadataRow label="Gross amount" value={selectedRecord.payoutCalculation.grossAmount} />
                  <MetadataRow
                    label={`Commission (${selectedRecord.payoutCalculation.commissionPercent ?? finance.profile?.commissionPercent ?? '10.00'}%)`}
                    value={<span className="finance-deduction-value">{formatDeductionValue(selectedRecord.payoutCalculation.commission)}</span>}
                  />
                  <MetadataRow
                    label={`Commission VAT (${selectedRecord.payoutCalculation.commissionVatPercent ?? finance.profile?.commissionVatPercent ?? '0.00'}%)`}
                    value={<span className="finance-deduction-value">{formatDeductionValue(selectedRecord.payoutCalculation.commissionVat)}</span>}
                  />
                  <MetadataRow
                    label="Shipping deduction"
                    value={<span className="finance-deduction-value">{formatDeductionValue(selectedRecord.payoutCalculation.shippingDeduction)}</span>}
                  />
                  <MetadataRow label="Shipping source" value={selectedRecord.payoutCalculation.shippingDeductionSource ?? 'none'} />
                  <MetadataRow label="Shipping provider" value={selectedRecord.payoutCalculation.shippingCostProvider ?? 'Pending provider cost'} />
                  <MetadataRow label="Shipping cost snapshot" value={selectedRecord.payoutCalculation.shippingCostSnapshot ?? 'No shipping cost snapshot'} />
                  <MetadataRow label="Provider cost state" value={selectedRecord.payoutCalculation.shippingCostStatus ?? 'not_applicable'} />
                  <MetadataRow
                    label="Refund impact"
                    value={<span className="finance-deduction-value">{formatDeductionValue(selectedRecord.payoutCalculation.refundImpact)}</span>}
                  />
                  <MetadataRow
                    label="Estimated payout"
                    value={<span className="finance-payout-value">{selectedRecord.payoutCalculation.estimatedPayout}</span>}
                  />
                </MetadataGroup>
              ) : null}
              {selectedRecord.settlement ? (
                <MetadataGroup title={isVendorUser ? 'Payout status' : 'Settlement lifecycle'}>
                  <MetadataRow label={isVendorUser ? 'Current state' : 'Settlement status'} value={getPayoutBatchStatusLabel(selectedRecord.settlement.status)} />
                  <MetadataRow label="Payout readiness" value={selectedRecord.settlement.payoutReady ? 'Ready' : 'Not ready'} />
                  <MetadataRow label="Eligible at" value={selectedRecord.settlement.eligibleAt ? formatDate(selectedRecord.settlement.eligibleAt) : 'Not eligible'} />
                  <MetadataRow label="Payable at" value={selectedRecord.settlement.payableAt ? formatDate(selectedRecord.settlement.payableAt) : 'Not payable'} />
                  <MetadataRow label={isVendorUser ? 'What this means' : 'Settlement note'} value={selectedRecord.settlement.note} />
                </MetadataGroup>
              ) : null}
              {isVendorUser ? (
                <MetadataGroup title="Payout timeline">
                  <TimelineBlock items={getVendorTimelineItems(selectedRecord)} />
                </MetadataGroup>
              ) : null}
              <MetadataGroup title="Payout batch">
                <MetadataRow label="Batch status" value={selectedRecord.payoutBatch ? getPayoutBatchStatusLabel(selectedRecord.payoutBatch.status) : 'Unbatched'} />
                <MetadataRow label="Batch reference" value={selectedRecord.payoutBatch?.id ?? 'Not prepared'} />
                  <MetadataRow label="Batch net" value={selectedRecord.payoutBatch?.netAmount ?? 'Not prepared'} />
                </MetadataGroup>
              <MetadataGroup title="Customer invoice">
                <MetadataRow label="Provider" value={selectedRecord.invoiceExecution?.provider ?? 'BizimHesap'} />
                <MetadataRow label="Status" value={getInvoiceStatusLabel(selectedRecord.invoiceExecution?.status)} />
                <MetadataRow label="Invoice GUID" value={selectedRecord.invoiceExecution?.providerInvoiceGuid ?? 'Not created'} />
                <MetadataRow label="Invoice No" value={selectedRecord.invoiceExecution?.providerInvoiceNo ?? 'Not assigned'} />
                <MetadataRow
                  label="PDF"
                  value={
                    selectedRecord.invoiceExecution?.providerPdfUrl ? (
                      <a href={selectedRecord.invoiceExecution.providerPdfUrl} target="_blank" rel="noreferrer">Open invoice PDF</a>
                    ) : (
                      'Not available'
                    )
                  }
                />
                <MetadataRow
                  label="Executed at"
                  value={selectedRecord.invoiceExecution ? formatDate(selectedRecord.invoiceExecution.updatedAt) : 'Not executed'}
                />
              </MetadataGroup>
              {isAdmin && selectedRecord.category === 'Invoice' ? (
                <div className="op-panel-section">
                  <h4>Invoice execution</h4>
                  <p className="page-description">
                    Customer invoice execution is merchant-of-record accounting output. Ledger snapshots remain canonical.
                  </p>
                  <OperationalActionGroup>
                    <button
                      type="button"
                      className="button button-primary button-compact"
                      disabled={createInvoiceMutation.isPending || Boolean(selectedRecord.invoiceExecution)}
                      onClick={() => createInvoiceMutation.mutate(selectedRecord.id)}
                    >
                      {createInvoiceMutation.isPending ? 'Creating...' : 'Create invoice'}
                    </button>
                    <button
                      type="button"
                      className="button button-secondary button-compact"
                      disabled={
                        retryInvoiceMutation.isPending ||
                        !selectedRecord.invoiceExecution ||
                        !['failed', 'unknown'].includes(selectedRecord.invoiceExecution.status)
                      }
                      onClick={() => {
                        if (selectedRecord.invoiceExecution) {
                          retryInvoiceMutation.mutate(selectedRecord.invoiceExecution.id);
                        }
                      }}
                    >
                      {retryInvoiceMutation.isPending ? 'Retrying...' : 'Retry failed invoice'}
                    </button>
                  </OperationalActionGroup>
                </div>
              ) : null}
              {isVendorUser ? null : (
                <>
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
                  <MetadataGroup title="Calculation profile">
                    <MetadataRow label="Calculation profile" value={getCalculationProfileSourceLabel(selectedRecord.payoutCalculation?.profileSource)} />
                    <MetadataRow label="Applied commission" value={`${selectedRecord.payoutCalculation?.commissionPercent ?? finance.profile?.commissionPercent ?? '10.00'}%`} />
                    <MetadataRow label="Applied commission VAT" value={`${selectedRecord.payoutCalculation?.commissionVatPercent ?? finance.profile?.commissionVatPercent ?? '0.00'}%`} />
                    <MetadataRow label="Current vendor profile" value={`${finance.profile?.commissionPercent ?? '10.00'}% / ${finance.profile?.commissionVatPercent ?? '0.00'}% VAT`} />
                    <MetadataRow label="Shipping mode" value={selectedRecord.payoutCalculation?.shippingMode ?? finance.profile?.shippingMode ?? 'disabled'} />
                    <MetadataRow label="Shipping deductions" value={finance.summary.shippingDeductions ?? '$0.00'} />
                  </MetadataGroup>
                </>
              )}
              {isAdmin && selectedRecord.category === 'Invoice' ? (
                <form className="finance-shipping-cost-form" aria-label="Attach shipping cost" onSubmit={handleAttachShippingCost}>
                  <h4>Shipping cost</h4>
                  <div className="op-form-grid">
                    <label>
                      <span>Provider</span>
                      <input
                        name="providerName"
                        value={shippingCostProvider}
                        onChange={(event) => setShippingCostProvider(event.target.value)}
                      />
                    </label>
                    <label>
                      <span>Reference</span>
                      <input name="providerReference" placeholder="Optional" />
                    </label>
                    <label>
                      <span>Cost</span>
                      <input
                        name="shippingCost"
                        value={shippingCostAmount}
                        onChange={(event) => setShippingCostAmount(event.target.value)}
                        inputMode="decimal"
                      />
                    </label>
                    <label>
                      <span>VAT</span>
                      <input
                        name="shippingVatAmount"
                        value={shippingVatAmount}
                        onChange={(event) => setShippingVatAmount(event.target.value)}
                        inputMode="decimal"
                      />
                    </label>
                  </div>
                  <button type="submit" className="button button-secondary button-compact" disabled={attachShippingCostMutation.isPending}>
                    {attachShippingCostMutation.isPending ? 'Saving...' : 'Attach confirmed cost'}
                  </button>
                  <p className="page-description">
                    Confirmed costs are stored for provider readiness. Existing ledger snapshots are not rewritten.
                  </p>
                </form>
              ) : null}
              <div className="op-panel-section">
                <h4>{isVendorUser ? 'Payout note' : 'Related return / refund context'}</h4>
                <p className="page-description">
                  {isVendorUser
                    ? 'This is a read-only payout view. Actual payment execution is not enabled yet.'
                    : 'Finance rows are derived from immutable ledger snapshots and settlement readiness state. Payout execution is not enabled yet.'}
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
