import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { DataStatePanel } from '../components/DataStatePanel';
import { ActionFeedback } from '../components/ActionFeedback';
import {
  EmptyStatePanel,
  FilterBar,
  KPIStatCard,
  MetadataRow,
  OperationalActionGroup,
  OperationalTable,
  OperationalTableRow,
  OperationalToolbar,
  SearchInput,
  SideDetailPanel,
  StatusBadge,
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
import { getCurrentUser, getCurrentVendorContext, getToken } from '../lib/auth';
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

function getPayoutActivityType(record: FinanceTransaction) {
  if (record.category === 'Invoice') {
    return 'Sale';
  }
  return record.category;
}

function getPayoutActivityStatusLabel(record: FinanceTransaction) {
  const status = normalizeFinanceStatus(record.status);
  if (status === 'Failed') {
    return 'Needs review';
  }
  if (isRefundRecord(record) && ['Recorded', 'Completed', 'Reconciled'].includes(status)) {
    return 'Refunded';
  }
  if (record.payoutBatch) {
    return 'Included in payout';
  }
  if (record.settlement?.payoutReady || status === 'Pending' || status === 'Recorded') {
    return 'Awaiting payout';
  }
  return status;
}

function getPayoutActivityTone(record: FinanceTransaction) {
  const label = getPayoutActivityStatusLabel(record);
  if (label === 'Needs review') {
    return 'danger' as const;
  }
  if (label === 'Refunded' || label === 'Included in payout') {
    return 'success' as const;
  }
  return 'attention' as const;
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

function getInvoiceStatusDisplay(status?: string) {
  if (status === 'created') {
    return 'Invoice created';
  }
  if (status === 'failed') {
    return 'Invoice failed';
  }
  return 'Invoice pending';
}

function getPayoutImpact(record: FinanceTransaction) {
  if (isRefundRecord(record)) {
    return formatDeductionValue(record.payoutCalculation?.refundImpact ?? record.amount);
  }
  return record.payoutCalculation?.estimatedPayout ?? record.amount;
}

function getTotalDeductions(record: FinanceTransaction) {
  const values = [
    record.payoutCalculation?.commission,
    record.payoutCalculation?.commissionVat,
    record.payoutCalculation?.shippingDeduction,
    record.payoutCalculation?.refundImpact,
  ].filter((value): value is string => Boolean(value));

  if (!values.length) {
    return '$0.00';
  }

  const total = values.reduce((sum, value) => {
    const numeric = Number(value.replace(/[^0-9.-]/g, ''));
    return Number.isFinite(numeric) ? sum + Math.abs(numeric) : sum;
  }, 0);
  const currency = values[0].match(/^[^\d-]+/)?.[0] ?? '$';
  return `${currency}${total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function getFinanceTimelineItems(record: FinanceTransaction) {
  return [
    {
      label: isRefundRecord(record) ? 'Refund recorded' : 'Order recorded',
      at: record.date,
      status: normalizeFinanceStatus(record.status),
    },
    {
      label: record.settlement?.payoutReady ? 'Awaiting payout' : 'Payout pending',
      at: record.settlement?.payableAt ?? record.settlement?.eligibleAt ?? null,
      status: record.settlement?.payoutReady ? 'Ready' : 'Pending',
    },
    record.payoutBatch
      ? {
          label: record.payoutBatch.status === 'paid_placeholder' ? 'Paid out' : 'Included in payout',
          at: record.payoutBatch.createdAt,
          status: getPayoutBatchStatusLabel(record.payoutBatch.status),
        }
      : null,
  ].filter((item): item is { label: string; at: string | null; status: string } => Boolean(item));
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
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);
  const [commissionPercent, setCommissionPercent] = useState('10.00');
  const [commissionVatPercent, setCommissionVatPercent] = useState('0.00');
  const [deductShippingEnabled, setDeductShippingEnabled] = useState(false);
  const [shippingMode, setShippingMode] = useState<'disabled' | 'fixed' | 'external_provider'>('disabled');
  const [fixedShippingFee, setFixedShippingFee] = useState('');
  const [shippingCostProvider, setShippingCostProvider] = useState('Manual provider');
  const [shippingCostAmount, setShippingCostAmount] = useState('');
  const [shippingVatAmount, setShippingVatAmount] = useState('');
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
            ? 'Invoice created for this finance row.'
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
            ? 'Invoice retry created the invoice.'
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
      const displayStatus = getPayoutActivityStatusLabel(record);
      const matchesStatus = statusFilter === 'all' || displayStatus === statusFilter;
      const matchesCategory = categoryFilter === 'all' || record.category === categoryFilter;
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

      return matchesStatus && matchesCategory && (!query || searchableText.includes(query));
    });
  }, [categoryFilter, currentVendor.vendorId, currentVendor.vendorName, finance?.transactions, searchTerm, statusFilter]);

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
    <section className={`op-page finance-control-center finance-payout-workspace ${isVendorUser ? 'finance-vendor-workspace' : ''}`}>
      <div className="op-page-heading finance-page-header">
        <div>
          <p className="eyebrow">Finance</p>
          <h2>{currentVendor.vendorName} payout workspace</h2>
          <p className="page-description">
            Track available balance, payout activity, deductions, refunds, and invoice state from one focused finance view.
          </p>
        </div>
        <div className="op-heading-meta">
          <StatusBadge tone="info">{currentVendor.vendorName}</StatusBadge>
          <StatusBadge tone={currentUser?.role === 'admin' ? 'success' : 'neutral'}>{currentUser?.role ?? 'user'}</StatusBadge>
          <button
            type="button"
            className="button button-secondary button-compact"
            onClick={() => showFeedback('Finance export prepared for review.', 'success')}
          >
            Export
          </button>
        </div>
      </div>

      <div className="op-kpi-row finance-kpi-row">
        <KPIStatCard label="Available balance" value={finance.summary.availableBalance ?? finance.summary.payableBalance ?? finance.summary.payoutEstimate} detail="Ready balance" tone="success" />
        <KPIStatCard label="Pending payout" value={finance.summary.pendingPayouts ?? finance.summary.heldBalance ?? '$0.00'} detail="Waiting to be paid" tone="attention" />
        <KPIStatCard label="Refund deductions" value={finance.summary.refundsThisMonth ?? finance.summary.refunds} detail="Refunds reduce payout" tone="danger" />
        <KPIStatCard label="Upcoming payout" value={finance.payoutBatchSummary?.eligibleNetAmount ?? finance.summary.payableBalance ?? finance.summary.payoutEstimate} detail={`${finance.payoutBatchSummary?.eligibleRowCount ?? 0} payable rows`} tone="info" />
        <KPIStatCard label="Needs review" value={financeKpis.failed + (finance.payoutBatchSummary?.blockedRowCount ?? 0)} detail="Action may be needed" tone="warning" />
      </div>

      <div className="op-control-layout finance-layout">
        <div className="op-main-column finance-activity-column">
          <OperationalToolbar>
            <SearchInput
              placeholder="Search payout activity by order, status, amount..."
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
            />
            <FilterBar>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                <option value="all">All statuses</option>
                <option value="Awaiting payout">Awaiting payout</option>
                <option value="Included in payout">Included in payout</option>
                <option value="Refunded">Refunded</option>
                <option value="Needs review">Needs review</option>
              </select>
              <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
                <option value="all">All types</option>
                <option value="Invoice">Sale</option>
                <option value="Refund">Refund</option>
                <option value="Payout">Payout</option>
                <option value="Adjustment">Adjustment</option>
              </select>
              <button
                type="button"
                className="button button-secondary"
                onClick={() => {
                  setSearchTerm('');
                  setStatusFilter('all');
                  setCategoryFilter('all');
                }}
              >
                Reset
              </button>
            </FilterBar>
          </OperationalToolbar>

          {filteredRecords.length === 0 ? (
            <EmptyStatePanel
              title="No payout activity in this view"
              description="Adjust the status, type, or search filters to review payout activity."
            />
          ) : (
            <OperationalTable
              columns={['Date', 'Type', 'Order', 'Status', 'Amount', 'Payout impact', 'Updated', 'Action']}
              className="finance-op-table finance-op-table-v2"
            >
              {filteredRecords.map((record) => (
                <OperationalTableRow
                  key={record.id}
                  selected={selectedRecord?.id === record.id}
                  onSelect={() => setSelectedRecordId(record.id)}
                >
                  <span className="finance-date-cell">
                    <strong>{formatDate(record.date)}</strong>
                  </span>
                  <span className="finance-type-cell">
                    <span className={`finance-type-icon ${isRefundRecord(record) ? 'is-refund' : 'is-sale'}`}>
                      {isRefundRecord(record) ? 'R' : 'S'}
                    </span>
                    <span>
                      <strong>{getPayoutActivityType(record)}</strong>
                      <small>{record.description}</small>
                    </span>
                  </span>
                  <span>
                    <strong>{record.shopifyOrderNumber ? `#${record.shopifyOrderNumber}` : '—'}</strong>
                    <small>{currentVendor.vendorName}</small>
                  </span>
                  <StatusBadge tone={getPayoutActivityTone(record)}>{getPayoutActivityStatusLabel(record)}</StatusBadge>
                  <strong className={isRefundRecord(record) || record.category === 'Adjustment' ? 'finance-negative finance-amount-emphasis' : 'finance-positive finance-amount-emphasis'}>
                    {isRefundRecord(record) || record.category === 'Adjustment' ? '-' : ''}
                    {record.amount}
                  </strong>
                  <strong className={isRefundRecord(record) ? 'finance-negative finance-amount-emphasis' : 'finance-positive finance-amount-emphasis'}>
                    {getPayoutImpact(record)}
                  </strong>
                  <span>
                    <strong>{formatDate(record.date)}</strong>
                    <small>{getPayoutActivityType(record)}</small>
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

          <div className="finance-info-footer">
            <section className="finance-footer-card">
              <div>
                <p className="eyebrow">Vendor profile</p>
                <h3>{currentVendor.vendorName} payout settings</h3>
                <p className="page-description">Applies to new payout estimates from now on. Past activity keeps its original rates.</p>
              </div>
              <div className="finance-profile-summary">
                <MetadataRow label="Commission" value={`${finance.profile?.commissionPercent ?? '10.00'}%`} />
                <MetadataRow label="Tax" value={`${finance.profile?.commissionVatPercent ?? '0.00'}%`} />
                <MetadataRow label="Shipping" value={finance.profile?.deductShippingEnabled ? 'After fulfillment' : 'Disabled'} />
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
                    className="button button-primary button-compact"
                    disabled={saveProfileMutation.isPending}
                  >
                    {saveProfileMutation.isPending ? 'Saving...' : 'Save vendor profile'}
                  </button>
                </form>
              ) : (
                <StatusBadge tone="neutral">Read-only vendor profile</StatusBadge>
              )}
            </section>

            <section className="finance-footer-card">
              <div>
                <p className="eyebrow">Payout preparation</p>
                <h3>Upcoming payout</h3>
                <p className="page-description">
                  {isVendorUser
                    ? 'A read-only view of rows currently eligible for upcoming payout.'
                    : 'Prepare payable rows for review. No payment is executed here.'}
                </p>
              </div>
              <div className="finance-profile-summary">
                <MetadataRow label="Eligible rows" value={finance.payoutBatchSummary?.eligibleRowCount ?? 0} />
                <MetadataRow label="Eligible net" value={finance.payoutBatchSummary?.eligibleNetAmount ?? finance.summary.payableBalance ?? finance.summary.payoutEstimate} />
                <MetadataRow label="Needs review" value={finance.payoutBatchSummary?.blockedRowCount ?? 0} />
                <MetadataRow
                  label={isVendorUser ? 'Latest payout' : 'Latest draft'}
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
                    {(finance.payoutBatchSummary?.eligibleRowCount ?? 0) > 0 ? 'Rows ready' : 'No payable rows'}
                  </StatusBadge>
                </div>
              ) : (
                <StatusBadge tone="neutral">Read-only upcoming payout</StatusBadge>
              )}
            </section>
          </div>
        </div>

        <SideDetailPanel eyebrow={selectedRecord ? getPayoutActivityType(selectedRecord) : 'Payout activity'} title="Payout summary">
          {selectedRecord ? (
            <>
              <div className="op-detail-status-row">
                <StatusBadge tone={getPayoutActivityTone(selectedRecord)}>{getPayoutActivityStatusLabel(selectedRecord)}</StatusBadge>
                {selectedRecord.invoiceExecution ? (
                  <StatusBadge tone={selectedRecord.invoiceExecution.status === 'created' ? 'success' : selectedRecord.invoiceExecution.status === 'failed' ? 'danger' : 'attention'}>
                    {getInvoiceStatusDisplay(selectedRecord.invoiceExecution.status)}
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
              <div className="finance-detail-card">
                <div className="finance-detail-card-heading">
                  <h4>Summary</h4>
                  <StatusBadge tone={selectedRecord.settlement?.payoutReady ? 'success' : 'attention'}>
                    {selectedRecord.settlement?.payoutReady ? 'Payable' : 'Pending'}
                  </StatusBadge>
                </div>
                <div className="finance-detail-rows">
                  <MetadataRow label="Order" value={selectedRecord.shopifyOrderNumber ? `#${selectedRecord.shopifyOrderNumber}` : '—'} />
                  <MetadataRow label="Payout status" value={getPayoutActivityStatusLabel(selectedRecord)} />
                  <MetadataRow
                    label="Expected payout"
                    value={<span className="finance-payout-value">{selectedRecord.payoutCalculation?.estimatedPayout ?? selectedRecord.amount}</span>}
                  />
                  <MetadataRow
                    label="Refund impact"
                    value={<span className="finance-deduction-value">{formatDeductionValue(selectedRecord.payoutCalculation?.refundImpact ?? '$0.00')}</span>}
                  />
                  <MetadataRow
                    label="Payout impact"
                    value={<span className={isRefundRecord(selectedRecord) ? 'finance-deduction-value' : 'finance-payout-value'}>{getPayoutImpact(selectedRecord)}</span>}
                  />
                  <MetadataRow label="Payment method" value="—" />
                </div>
              </div>

              <div className="finance-detail-card">
                <div className="finance-detail-card-heading">
                  <h4>Deductions</h4>
                </div>
                <div className="finance-detail-rows">
                  <MetadataRow label="Commission" value={`${selectedRecord.payoutCalculation?.commissionPercent ?? finance.profile?.commissionPercent ?? '10.00'}%`} />
                  <MetadataRow
                    label="Commission amount"
                    value={<span className="finance-deduction-value">{formatDeductionValue(selectedRecord.payoutCalculation?.commission ?? '$0.00')}</span>}
                  />
                  <MetadataRow label="Tax deduction" value={`${selectedRecord.payoutCalculation?.commissionVatPercent ?? finance.profile?.commissionVatPercent ?? '0.00'}%`} />
                  <MetadataRow
                    label="Tax"
                    value={<span className="finance-deduction-value">{formatDeductionValue(selectedRecord.payoutCalculation?.commissionVat ?? '$0.00')}</span>}
                  />
                  <MetadataRow
                    label="Shipping fee"
                    value={<span className="finance-deduction-value">{formatDeductionValue(selectedRecord.payoutCalculation?.shippingDeduction ?? '$0.00')}</span>}
                  />
                  <MetadataRow
                    label="Total deductions"
                    value={<span className="finance-deduction-value">{formatDeductionValue(getTotalDeductions(selectedRecord))}</span>}
                  />
                  <MetadataRow
                    label="Final payout impact"
                    value={<span className={isRefundRecord(selectedRecord) ? 'finance-deduction-value' : 'finance-payout-value'}>{getPayoutImpact(selectedRecord)}</span>}
                  />
                </div>
              </div>

              <div className="finance-detail-card finance-timeline-card">
                <div className="finance-detail-card-heading">
                  <h4>Timeline</h4>
                </div>
                <ol className="finance-payout-timeline">
                  {getFinanceTimelineItems(selectedRecord).map((item) => (
                    <li key={`${item.label}-${item.at ?? 'pending'}`}>
                      <span className="op-timeline-dot" />
                      <div>
                        <strong>{item.label}</strong>
                        <small>{item.at ? formatDate(item.at) : '—'}</small>
                      </div>
                      <StatusBadge tone="neutral">{item.status}</StatusBadge>
                    </li>
                  ))}
                </ol>
              </div>

              <div className="finance-detail-card finance-invoice-card">
                <div className="finance-detail-card-heading">
                  <h4>Invoice</h4>
                  <StatusBadge
                    tone={
                      selectedRecord.invoiceExecution?.status === 'created'
                        ? 'success'
                        : selectedRecord.invoiceExecution?.status === 'failed'
                          ? 'danger'
                          : 'attention'
                    }
                  >
                    {getInvoiceStatusDisplay(selectedRecord.invoiceExecution?.status)}
                  </StatusBadge>
                </div>
                <div className="finance-detail-rows">
                  <MetadataRow label="Invoice number" value={selectedRecord.invoiceExecution?.providerInvoiceNo ?? 'Not assigned'} />
                  <MetadataRow
                    label="PDF"
                    value={
                      selectedRecord.invoiceExecution?.providerPdfUrl ? (
                        <a href={selectedRecord.invoiceExecution.providerPdfUrl} target="_blank" rel="noreferrer">PDF available</a>
                      ) : (
                        'Not available'
                      )
                    }
                  />
                  {selectedRecord.invoiceExecution?.status === 'failed' || selectedRecord.invoiceExecution?.status === 'unknown' ? (
                    <MetadataRow label="Reason" value="Invoice could not be generated. Try again or contact support." />
                  ) : null}
                </div>
              </div>

              <div className="finance-detail-card finance-actions-card">
                <div className="finance-detail-card-heading">
                  <h4>Actions</h4>
                </div>
                <OperationalActionGroup>
                  {selectedRecord.invoiceExecution?.providerPdfUrl ? (
                    <a className="button button-secondary button-compact" href={selectedRecord.invoiceExecution.providerPdfUrl} target="_blank" rel="noreferrer">
                      Download PDF
                    </a>
                  ) : null}
                  {isAdmin && selectedRecord.category === 'Invoice' ? (
                    <>
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
                        {retryInvoiceMutation.isPending ? 'Retrying...' : 'Retry invoice'}
                      </button>
                    </>
                  ) : null}
                  {!selectedRecord.invoiceExecution?.providerPdfUrl && !(isAdmin && selectedRecord.category === 'Invoice') ? (
                    <StatusBadge tone="neutral">No actions available</StatusBadge>
                  ) : null}
                </OperationalActionGroup>
              </div>

              {isAdmin && selectedRecord.category === 'Invoice' ? (
                <form className="finance-shipping-cost-form" aria-label="Attach shipping cost" onSubmit={handleAttachShippingCost}>
                  <h4>Shipping cost</h4>
                  <div className="op-form-grid">
                    <label>
                      <span>Source</span>
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
                      <span>Tax</span>
                      <input
                        name="shippingVatAmount"
                        value={shippingVatAmount}
                        onChange={(event) => setShippingVatAmount(event.target.value)}
                        inputMode="decimal"
                      />
                    </label>
                  </div>
                  <button type="submit" className="button button-secondary button-compact" disabled={attachShippingCostMutation.isPending}>
                    {attachShippingCostMutation.isPending ? 'Saving...' : 'Save shipping cost'}
                  </button>
                  <p className="page-description">
                    Shipping cost can affect payout calculations.
                  </p>
                </form>
              ) : null}
            </>
          ) : (
            <EmptyStatePanel title="Select a finance record" description="Choose a finance row to review payout and invoice details." />
          )}
        </SideDetailPanel>
      </div>

      {message ? <ActionFeedback tone={tone} message={message} /> : null}
    </section>
  );
}
