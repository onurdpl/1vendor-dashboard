import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  EmptyStatePanel,
  MetadataGroup,
  MetadataRow,
  OperationalTable,
  OperationalTableRow,
  SectionErrorRetry,
  StatusBadge,
} from '../components/OperationalPrimitives';
import {
  createSettlementScheduleDrafts,
  getSettlementScheduleAutoDraftJobStatus,
  getSettlementScheduleDryRun,
  type SettlementScheduleAutoDraftJobStatusResponse,
  type SettlementScheduleCreateDraftsResponse,
  type SettlementScheduleDryRunResponse,
  type SettlementScheduleDryRunVendor,
  type SettlementScheduleState,
} from '../features/finance/api';
import { formatCurrency, formatDateTime, safeStatusLabel } from '../services/real/formatting';

const STATE_LABELS: Record<SettlementScheduleState, string> = {
  READY: 'Ready',
  NOT_DUE: 'Not Due',
  AUTO_DRAFT_DISABLED: 'Blocked',
  NO_ELIGIBLE_ROWS: 'Blocked',
  CONFIG_MISSING: 'Blocked',
  BLOCKED: 'Blocked',
  DRAFT_EXISTS: 'In Review',
  SETTLEMENT_EXISTS: 'In Review',
};

type WorkflowTab = 'all' | 'due_today' | 'ready_for_draft' | 'blocked' | 'already_drafted' | 'not_due';
type StatusFilter = 'all' | WorkflowTab;
type ScheduleIssue = 'Refund' | 'Hold' | 'Schedule mismatch' | 'Ready';
type ScheduleNextAction = 'Create Draft' | 'Investigate' | 'View';
type PanelScheduleAction = 'Create Scheduled Drafts' | 'Preview Schedule' | 'Investigate' | 'No action available';

const HIGH_VALUE_SCHEDULED_SETTLEMENT_MINOR = 100000;
const NO_RECENT_RUN_COPY = 'No recent run';
const WORKFLOW_TABS: Array<{ id: WorkflowTab; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'due_today', label: 'Due Today' },
  { id: 'ready_for_draft', label: 'Ready' },
  { id: 'blocked', label: 'Blocked' },
  { id: 'already_drafted', label: 'In Review' },
  { id: 'not_due', label: 'Not Due' },
];

const STATUS_FILTER_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: 'All statuses' },
  { value: 'due_today', label: 'Due Today' },
  { value: 'ready_for_draft', label: 'Ready' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'already_drafted', label: 'In Review' },
  { value: 'not_due', label: 'Not Due' },
];

const WEEKDAY_LABELS: Record<string, string> = {
  MONDAY: 'Monday',
  TUESDAY: 'Tuesday',
  WEDNESDAY: 'Wednesday',
  THURSDAY: 'Thursday',
  FRIDAY: 'Friday',
};

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function formatMinor(amountMinor: number | null | undefined, currency = 'TRY') {
  return formatCurrency((Number(amountMinor ?? 0) / 100).toFixed(2), currency);
}

function getVendorName(vendor: SettlementScheduleDryRunVendor) {
  return vendor.vendorName || vendor.vendorId;
}

function getStateTone(state: SettlementScheduleState): 'success' | 'attention' | 'warning' | 'danger' | 'neutral' | 'info' {
  if (state === 'READY') return 'success';
  if (state === 'DRAFT_EXISTS' || state === 'SETTLEMENT_EXISTS') return 'info';
  if (state === 'NOT_DUE' || state === 'AUTO_DRAFT_DISABLED' || state === 'NO_ELIGIBLE_ROWS') return 'attention';
  if (state === 'CONFIG_MISSING') return 'danger';
  return 'warning';
}

function isBlockedScheduleState(state: SettlementScheduleState) {
  return ['AUTO_DRAFT_DISABLED', 'NO_ELIGIBLE_ROWS', 'BLOCKED', 'CONFIG_MISSING'].includes(state);
}

function isAlreadyDraftedState(state: SettlementScheduleState) {
  return state === 'DRAFT_EXISTS' || state === 'SETTLEMENT_EXISTS';
}

function matchesWorkflow(vendor: SettlementScheduleDryRunVendor, workflow: WorkflowTab) {
  if (workflow === 'all') return true;
  if (workflow === 'due_today') return vendor.due;
  if (workflow === 'ready_for_draft') return vendor.state === 'READY';
  if (workflow === 'blocked') return isBlockedScheduleState(vendor.state);
  if (workflow === 'already_drafted') return isAlreadyDraftedState(vendor.state);
  return vendor.state === 'NOT_DUE';
}

function matchesStatusFilter(vendor: SettlementScheduleDryRunVendor, statusFilter: StatusFilter) {
  return statusFilter === 'all' || matchesWorkflow(vendor, statusFilter);
}

function hasReadyForDraftVendor(vendors: SettlementScheduleDryRunVendor[]) {
  return vendors.some((vendor) => vendor.state === 'READY');
}

function hasDueActionVendor(vendors: SettlementScheduleDryRunVendor[]) {
  return vendors.some((vendor) => vendor.due && (vendor.state === 'READY' || isBlockedScheduleState(vendor.state)));
}

function getDefaultWorkflowTab(vendors: SettlementScheduleDryRunVendor[]): WorkflowTab {
  if (hasReadyForDraftVendor(vendors)) {
    return 'ready_for_draft';
  }
  if (hasDueActionVendor(vendors)) {
    return 'due_today';
  }
  return 'ready_for_draft';
}

function getScheduleSortRank(vendor: SettlementScheduleDryRunVendor) {
  if (vendor.state === 'READY') return 0;
  if (isBlockedScheduleState(vendor.state)) return 1;
  if (isAlreadyDraftedState(vendor.state)) return 2;
  if (vendor.state === 'NOT_DUE') return 3;
  return 4;
}

function sortScheduledVendors(vendors: SettlementScheduleDryRunVendor[]) {
  return [...vendors].sort((left, right) => {
    const rankDifference = getScheduleSortRank(left) - getScheduleSortRank(right);
    if (rankDifference !== 0) return rankDifference;
    return getVendorName(left).localeCompare(getVendorName(right));
  });
}

function getOpenSettlementHref(approvalId: string) {
  return `/admin/finance/settlement-approvals?approvalId=${encodeURIComponent(approvalId)}`;
}

function getScheduleSummary(vendor: SettlementScheduleDryRunVendor) {
  const frequency = safeStatusLabel(vendor.schedule.settlementFrequencyType);
  const weekday = WEEKDAY_LABELS[vendor.schedule.weeklySettlementDay] ?? safeStatusLabel(vendor.schedule.weeklySettlementDay);
  return {
    primary: `${vendor.schedule.settlementDelayDays} days delay`,
    secondary: `${frequency} · ${weekday}`,
    detail: `${vendor.schedule.settlementDelayDays} days delay · ${frequency} on ${weekday}`,
  };
}

function getVendorBlockers(vendor: SettlementScheduleDryRunVendor) {
  return [vendor.blockedReason, ...vendor.warnings].filter((item): item is string => Boolean(item));
}

function getScheduleIssue(vendor: SettlementScheduleDryRunVendor): ScheduleIssue {
  const blockers = getVendorBlockers(vendor);
  if (isBlockedScheduleState(vendor.state) && vendor.state !== 'NO_ELIGIBLE_ROWS') {
    return 'Hold';
  }
  if (blockers.length && vendor.state !== 'NOT_DUE' && vendor.state !== 'NO_ELIGIBLE_ROWS') {
    return 'Hold';
  }
  if (vendor.state === 'NOT_DUE') {
    return 'Schedule mismatch';
  }
  if (vendor.pendingRefundAdjustmentCount > 0) {
    return 'Refund';
  }
  if (vendor.state === 'NO_ELIGIBLE_ROWS' || vendor.eligibleLineCount === 0) {
    return 'Hold';
  }
  return 'Ready';
}

function getScheduleIssueTone(issue: ScheduleIssue) {
  if (issue === 'Ready') return 'success' as const;
  if (issue === 'Refund') return 'attention' as const;
  if (issue === 'Hold') return 'warning' as const;
  return 'neutral' as const;
}

function getScheduleNextAction(vendor: SettlementScheduleDryRunVendor): ScheduleNextAction {
  if (vendor.state === 'READY') return 'Create Draft';
  if (isAlreadyDraftedState(vendor.state)) return 'View';
  if (isBlockedScheduleState(vendor.state)) return 'Investigate';
  return 'View';
}

function getPanelNextAction(vendor: SettlementScheduleDryRunVendor): PanelScheduleAction {
  if (vendor.state === 'READY') return 'Create Scheduled Drafts';
  if (vendor.state === 'NOT_DUE') return 'Preview Schedule';
  if (isBlockedScheduleState(vendor.state)) return 'Investigate';
  return 'No action available';
}

function getWaitingReason(vendor: SettlementScheduleDryRunVendor) {
  if (vendor.state === 'NOT_DUE') {
    return 'This vendor is not scheduled for the selected settlement run.';
  }
  if (vendor.state === 'DRAFT_EXISTS') {
    return 'Existing draft already exists';
  }
  if (vendor.state === 'SETTLEMENT_EXISTS') {
    return 'Existing settlement already exists';
  }
  if (vendor.state === 'NO_ELIGIBLE_ROWS') {
    return 'No eligible rows';
  }
  if (vendor.pendingRefundAdjustmentCount > 0 && !vendor.canCreateDraft) {
    return 'Refund adjustment pending';
  }
  if (getVendorBlockers(vendor).length) {
    return getVendorBlockers(vendor)[0];
  }
  if (isBlockedScheduleState(vendor.state)) {
    return 'Schedule mismatch';
  }
  return null;
}

function CreateDraftsModal({
  onCancel,
  onConfirm,
  submitting,
}: {
  onCancel: () => void;
  onConfirm: () => void;
  submitting: boolean;
}) {
  const [confirmed, setConfirmed] = useState(false);

  return (
    <div className="scheduled-settlements-modal" role="dialog" aria-modal="true" aria-labelledby="scheduled-create-drafts-title">
      <div className="scheduled-settlements-modal-card">
        <p className="eyebrow">Scheduled settlements</p>
        <h3 id="scheduled-create-drafts-title">Create scheduled drafts for eligible vendors?</h3>
        <p className="page-description">
          This will create settlement drafts for all eligible vendors in the selected run date.
        </p>
        <label className="scheduled-settlements-confirm">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          <span>I understand this creates drafts for all eligible vendors in the selected run date.</span>
        </label>
        <div className="scheduled-settlements-modal-actions">
          <button type="button" className="button button-secondary" onClick={onCancel} disabled={submitting}>
            Cancel
          </button>
          <button type="button" className="button button-primary" onClick={onConfirm} disabled={!confirmed || submitting}>
            {submitting ? 'Creating drafts...' : 'Create drafts'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function AdminScheduledSettlementsPage() {
  const [runDate, setRunDate] = useState(todayKey);
  const [search, setSearch] = useState('');
  const [vendorFilter, setVendorFilter] = useState('');
  const [dryRun, setDryRun] = useState<SettlementScheduleDryRunResponse | null>(null);
  const [selectedVendorId, setSelectedVendorId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [createResult, setCreateResult] = useState<SettlementScheduleCreateDraftsResponse | null>(null);
  const [jobStatus, setJobStatus] = useState<SettlementScheduleAutoDraftJobStatusResponse | null>(null);
  const [jobStatusError, setJobStatusError] = useState<string | null>(null);
  const [workflowTab, setWorkflowTab] = useState<WorkflowTab>('ready_for_draft');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [highValueOnly, setHighValueOnly] = useState(false);
  const workflowTouchedRef = useRef(false);

  async function loadDryRun(
    nextRunDate = runDate,
    nextVendorFilter = vendorFilter,
    options: { successMessage?: string } = {},
  ) {
    setLoading(true);
    setError(null);
    try {
      const response = await getSettlementScheduleDryRun({
        runDate: nextRunDate,
        vendorId: nextVendorFilter.trim() || null,
      });
      setDryRun(response);
      const nextWorkflowTab = workflowTouchedRef.current ? workflowTab : getDefaultWorkflowTab(response.vendors);
      if (!workflowTouchedRef.current) {
        setWorkflowTab(nextWorkflowTab);
      }
      setSelectedVendorId((current) => {
        const nextWorkflowVendors = response.vendors.filter((vendor) => matchesWorkflow(vendor, nextWorkflowTab));
        if (current && nextWorkflowVendors.some((vendor) => vendor.vendorId === current)) {
          return current;
        }
        return nextWorkflowVendors[0]?.vendorId ?? response.vendors[0]?.vendorId ?? null;
      });
      if (options.successMessage) {
        setSuccessMessage(options.successMessage);
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Scheduled settlement dry run failed.');
      setSuccessMessage(null);
    } finally {
      setLoading(false);
    }
  }

  async function loadJobStatus() {
    setJobStatusError(null);
    try {
      const response = await getSettlementScheduleAutoDraftJobStatus();
      setJobStatus(response);
    } catch (requestError) {
      setJobStatusError(requestError instanceof Error ? requestError.message : 'Scheduled auto draft job status could not be loaded.');
    }
  }

  useEffect(() => {
    void loadDryRun(runDate, vendorFilter);
    void loadJobStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleWorkflowTabChange(tab: WorkflowTab) {
    workflowTouchedRef.current = true;
    setWorkflowTab(tab);
    setStatusFilter('all');
  }

  function handleShowAllSchedules() {
    workflowTouchedRef.current = true;
    setWorkflowTab('all');
    setStatusFilter('all');
    setHighValueOnly(false);
    setSearch('');
  }

  const filteredVendors = useMemo(() => {
    const vendors = dryRun?.vendors ?? [];
    const searchTerm = search.trim().toLowerCase();
    return sortScheduledVendors(vendors.filter((vendor) =>
      matchesWorkflow(vendor, workflowTab) &&
      matchesStatusFilter(vendor, statusFilter) &&
      (!searchTerm || [
        getVendorName(vendor),
        vendor.vendorId,
        STATE_LABELS[vendor.state],
        getScheduleSummary(vendor).detail,
        getScheduleIssue(vendor),
        getScheduleNextAction(vendor),
      ].some((value) => value.toLowerCase().includes(searchTerm))) &&
      (!highValueOnly || Math.abs(vendor.netPayableMinor ?? 0) >= HIGH_VALUE_SCHEDULED_SETTLEMENT_MINOR),
    ));
  }, [dryRun?.vendors, highValueOnly, search, statusFilter, workflowTab]);

  const selectedVendor = useMemo(
    () => filteredVendors.find((vendor) => vendor.vendorId === selectedVendorId) ?? filteredVendors[0] ?? null,
    [filteredVendors, selectedVendorId],
  );
  const readyCount = dryRun?.vendors.filter((vendor) => vendor.state === 'READY').length ?? 0;

  async function handleCreateDrafts() {
    setCreating(true);
    setCreateError(null);
    setSuccessMessage(null);
    try {
      const result = await createSettlementScheduleDrafts({
        runDate,
        vendorId: vendorFilter.trim() || null,
        confirmAutoSettlementDrafts: true,
      });
      setCreateResult(result);
      setCreateOpen(false);
      await loadDryRun(runDate, vendorFilter);
      setSuccessMessage('Scheduled settlement drafts created.');
    } catch (requestError) {
      setCreateError(requestError instanceof Error ? requestError.message : 'Scheduled draft creation failed.');
    } finally {
      setCreating(false);
    }
  }

  const allVendors = dryRun?.vendors ?? [];
  const readyVendorExists = hasReadyForDraftVendor(allVendors);
  const dueActionVendorExists = hasDueActionVendor(allVendors);
  const showOperationalEmpty = Boolean(dryRun && !readyVendorExists && !dueActionVendorExists && workflowTab !== 'all');
  const workflowCounts = useMemo(() => {
    const vendors = dryRun?.vendors ?? [];
    return WORKFLOW_TABS.reduce<Record<WorkflowTab, number>>((counts, tab) => {
      counts[tab.id] = vendors.filter((vendor) => matchesWorkflow(vendor, tab.id)).length;
      return counts;
    }, {
      all: vendors.length,
      due_today: 0,
      ready_for_draft: 0,
      blocked: 0,
      already_drafted: 0,
      not_due: 0,
    });
  }, [dryRun?.vendors]);
  const selectedState = selectedVendor?.state ?? null;
  const selectedBlockers = selectedVendor ? getVendorBlockers(selectedVendor) : [];
  const selectedWaitingReason = selectedVendor ? getWaitingReason(selectedVendor) : null;
  const selectedCreatedDraft = selectedVendor
    ? createResult?.createdDrafts.find((draft) => draft.vendorId === selectedVendor.vendorId) ?? null
    : null;
  const lastRunLabel = jobStatus?.lastRun
    ? `${formatDateTime(jobStatus.lastRun.finishedAt ?? jobStatus.lastRun.startedAt)} · ${safeStatusLabel(jobStatus.lastRun.status)}`
    : NO_RECENT_RUN_COPY;

  return (
    <section className="op-page scheduled-settlements-page">
      <div className="op-page-heading">
        <div>
          <p className="eyebrow">ADMIN FINANCE</p>
          <h1>Scheduled Settlements</h1>
          <p className="page-description">Review vendors due for scheduled settlement draft preparation.</p>
        </div>
      </div>

      {error ? <SectionErrorRetry title="Scheduled settlement dry run failed" description={error} onRetry={() => void loadDryRun()} /> : null}
      {createError ? <SectionErrorRetry title="Scheduled draft creation failed" description={createError} /> : null}
      {jobStatusError ? <SectionErrorRetry title="Scheduled auto draft job status failed" description={jobStatusError} onRetry={() => void loadJobStatus()} /> : null}
      {successMessage ? <p className="action-feedback action-success" role="status">{successMessage}</p> : null}

      <section className="settlement-review-queue scheduled-settlements-queue" aria-label="Scheduled settlement queue">
        <div className="orders-workflow-tabs settlement-review-tabs scheduled-settlements-tabs" aria-label="Scheduled settlement workflow tabs">
          {WORKFLOW_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={workflowTab === tab.id ? 'is-active' : undefined}
              onClick={() => handleWorkflowTabChange(tab.id)}
            >
              <span>{tab.label}</span>
              <strong>{workflowCounts[tab.id]}</strong>
            </button>
          ))}
        </div>

        <div className="op-toolbar settlement-review-filters scheduled-settlements-controls" aria-label="Scheduled settlement filters">
          <label className="op-search-input">
            <span>Search</span>
            <input type="text" placeholder="Vendor, status, issue" value={search} onChange={(event) => setSearch(event.target.value)} />
          </label>
          <label>
            <span>Vendor</span>
            <input
              type="text"
              placeholder="Optional vendor id"
              value={vendorFilter}
              onChange={(event) => setVendorFilter(event.target.value)}
            />
          </label>
          <label>
            <span>Status</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}>
              {STATUS_FILTER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Run date</span>
            <input type="date" value={runDate} onChange={(event) => setRunDate(event.target.value)} />
          </label>
          <label className="op-checkbox-row settlement-review-high-value">
            <input type="checkbox" checked={highValueOnly} onChange={(event) => setHighValueOnly(event.target.checked)} />
            <span>High Value only</span>
          </label>
          <div className="scheduled-header-actions" aria-label="Scheduled settlement actions">
            <button
              type="button"
              className="button button-secondary"
              onClick={() => void loadDryRun(runDate, vendorFilter, { successMessage: 'Schedule preview updated.' })}
              disabled={loading}
            >
              {loading ? 'Previewing...' : 'Preview Schedule'}
            </button>
            <button type="button" className="button button-primary" onClick={() => setCreateOpen(true)} disabled={loading || creating || readyCount === 0}>
              {creating ? 'Creating drafts...' : 'Create Scheduled Drafts'}
            </button>
          </div>
        </div>

        {dryRun ? (
          <>
            <div className="settlement-review-layout scheduled-settlements-workspace">
              {showOperationalEmpty ? (
                <div className="scheduled-operational-empty" role="status">
                  <strong>Nothing requires settlement preparation today.</strong>
                  <span>All vendors are either not due or already prepared.</span>
                  <button type="button" className="button button-secondary" onClick={handleShowAllSchedules}>
                    Show all schedules
                  </button>
                </div>
              ) : (
                <OperationalTable
                  columns={['Vendor', 'Schedule', 'Amount', 'Status', 'Issues', 'Next Action', 'Updated']}
                  className="settlement-review-table scheduled-settlements-table"
                >
                  {filteredVendors.length ? (
                    filteredVendors.map((vendor) => {
                      const schedule = getScheduleSummary(vendor);
                      const issue = getScheduleIssue(vendor);
                      return (
                        <OperationalTableRow
                          key={vendor.vendorId}
                          selected={vendor.vendorId === selectedVendor?.vendorId}
                          onSelect={() => setSelectedVendorId(vendor.vendorId)}
                        >
                          <span>
                            <strong>{getVendorName(vendor)}</strong>
                            <small>{vendor.due ? 'Due for this run date' : 'Not due for this run date'}</small>
                          </span>
                          <span>
                            <strong>{schedule.primary}</strong>
                            <small>{schedule.secondary}</small>
                          </span>
                          <span>
                            <strong>{formatMinor(vendor.netPayableMinor)}</strong>
                            <small>{vendor.eligibleLineCount} eligible row{vendor.eligibleLineCount === 1 ? '' : 's'}</small>
                          </span>
                          <StatusBadge tone={getStateTone(vendor.state)}>{STATE_LABELS[vendor.state]}</StatusBadge>
                          <span className="settlement-review-issue-list">
                            <StatusBadge tone={getScheduleIssueTone(issue)}>{issue}</StatusBadge>
                          </span>
                          <strong>{getScheduleNextAction(vendor)}</strong>
                          <span>
                            <strong>{dryRun.runDate}</strong>
                            <small>{jobStatus?.lastRun ? `Last run ${jobStatus.lastRun.runDate}` : NO_RECENT_RUN_COPY}</small>
                          </span>
                        </OperationalTableRow>
                      );
                    })
                  ) : (
                    <OperationalTableRow>
                      <span className="scheduled-table-empty">
                        <strong>No scheduled vendors match the current filters.</strong>
                        <small>Adjust the filters or show all schedules.</small>
                      </span>
                    </OperationalTableRow>
                  )}
                </OperationalTable>
              )}

              <aside className="op-side-panel settlement-review-panel scheduled-settlements-panel" aria-label="Scheduled settlement detail panel">
                {selectedVendor ? (
                  <>
                    <MetadataGroup title="Summary">
                      <MetadataRow label="Vendor" value={getVendorName(selectedVendor)} />
                      <MetadataRow label="Frequency" value={getScheduleSummary(selectedVendor).secondary} />
                      <MetadataRow label="Run Date" value={dryRun.runDate} />
                      <MetadataRow
                        label="Eligible Before"
                        value={formatDateTime(dryRun.periodEnd, { month: 'short', day: 'numeric', year: 'numeric' })}
                      />
                      <MetadataRow label="Estimated Net Payable" value={formatMinor(selectedVendor.netPayableMinor)} />
                      <MetadataRow label="Current Status" value={selectedState ? STATE_LABELS[selectedState] : 'Not Due'} />
                    </MetadataGroup>
                    {selectedWaitingReason ? (
                      <MetadataGroup title="Current Blocker">
                        <MetadataRow label="Reason" value={selectedWaitingReason} />
                      </MetadataGroup>
                    ) : null}
                    <MetadataGroup title="Next Action">
                      <MetadataRow label="Action" value={getPanelNextAction(selectedVendor)} />
                      {selectedVendor.state === 'READY' ? (
                        <div className="scheduled-panel-actions">
                          <button
                            type="button"
                            className="button button-primary"
                            onClick={() => setCreateOpen(true)}
                            disabled={loading || creating || readyCount === 0}
                          >
                            {creating ? 'Creating drafts...' : 'Create Scheduled Drafts'}
                          </button>
                        </div>
                      ) : null}
                      {selectedVendor.state === 'NOT_DUE' ? (
                        <div className="scheduled-panel-actions">
                          <button
                            type="button"
                            className="button button-secondary"
                            onClick={() => void loadDryRun(runDate, vendorFilter, { successMessage: 'Schedule preview updated.' })}
                            disabled={loading}
                          >
                            {loading ? 'Previewing...' : 'Preview Schedule'}
                          </button>
                        </div>
                      ) : null}
                    </MetadataGroup>
                    <MetadataGroup title="Payment Impact">
                      <MetadataRow
                        label="Refund adjustments"
                        value={
                          selectedVendor.pendingRefundAdjustmentCount > 0
                            ? `${selectedVendor.pendingRefundAdjustmentCount} · ${formatMinor(selectedVendor.pendingRefundAdjustmentTotalMinor)}`
                            : 'No refund adjustment'
                        }
                      />
                    </MetadataGroup>
                    <MetadataGroup title="Related Records">
                      <MetadataRow
                        label="Existing Settlement"
                        value={
                          selectedVendor.existingSettlementApprovalId ? (
                            <Link to={getOpenSettlementHref(selectedVendor.existingSettlementApprovalId)}>Open Settlement</Link>
                          ) : (
                            'No existing settlement'
                          )
                        }
                      />
                      <MetadataRow
                        label="Refund"
                        value={selectedVendor.pendingRefundAdjustmentCount > 0 ? 'Refund adjustment pending' : 'No refund adjustment'}
                      />
                    </MetadataGroup>
                    <section className="op-panel-section">
                      <h4>Timeline</h4>
                      <ul className="settlement-review-timeline">
                        {jobStatus?.lastRun ? <li><span>Last run</span><strong>{lastRunLabel}</strong></li> : null}
                        {selectedCreatedDraft ? (
                          <li>
                            <span>Draft created</span>
                            <strong>{formatMinor(selectedCreatedDraft.netPayableMinor)}</strong>
                          </li>
                        ) : null}
                        {!jobStatus?.lastRun && !selectedCreatedDraft ? <li><strong>No finance activity recorded yet.</strong></li> : null}
                      </ul>
                    </section>
                  </>
                ) : (
                  <EmptyStatePanel title="No scheduled vendor selected" description="Preview a schedule and select a vendor to review the schedule state." />
                )}
              </aside>
            </div>

            <details className="scheduled-settlements-card scheduled-advanced-details" aria-label="Advanced run details">
              <summary>Advanced run details</summary>
              <section className="scheduled-advanced-section">
                <h3>Run Notes</h3>
                <ul className="scheduled-notes">
                  {dryRun.notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                  <li>Preview Schedule does not create scheduled settlement drafts.</li>
                </ul>
              </section>

              {selectedVendor ? (
                <section className="scheduled-advanced-section">
                  <h3>Technical blockers</h3>
                  <MetadataGroup>
                    <MetadataRow label="Cycle key" value={selectedVendor.scheduledCycleKey} />
                    <MetadataRow label="Auto draft" value={selectedVendor.schedule.autoSettlementDraftEnabled ? 'Enabled' : 'Disabled'} />
                    <MetadataRow label="Excluded rows" value={selectedVendor.excludedActiveApprovalRowCount} />
                  </MetadataGroup>
                  {selectedBlockers.length ? (
                    <ul className="scheduled-detail-blockers">
                      {selectedBlockers.map((blocker) => (
                        <li key={blocker}>{blocker}</li>
                      ))}
                    </ul>
                  ) : null}
                </section>
              ) : null}

              {createResult ? (
                <section className="scheduled-advanced-section" aria-label="Scheduled draft creation result">
                  <h3>Draft Creation Result</h3>
                  <div className="scheduled-result-grid">
                    <MetadataRow label="Created" value={createResult.summary.created} />
                    <MetadataRow label="Skipped" value={createResult.summary.skipped} />
                    <MetadataRow label="Blocked" value={createResult.summary.failed} />
                    <MetadataRow label="Existing draft" value={createResult.skipped.filter((item) => /draft|approval/i.test(item.reason)).length} />
                  </div>
                  {createResult.createdDrafts.length ? (
                    <ul className="scheduled-result-list">
                      {createResult.createdDrafts.map((draft) => (
                        <li key={draft.settlementApprovalId}>
                          <span>{draft.vendorId}</span>
                          <Link to={getOpenSettlementHref(draft.settlementApprovalId)}>Open Settlement</Link>
                          <strong>{formatMinor(draft.netPayableMinor)}</strong>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {[...createResult.skipped, ...createResult.failed].length ? (
                    <ul className="scheduled-notes">
                      {[...createResult.skipped, ...createResult.failed].map((item) => (
                        <li key={`${item.vendorId}-${item.reason}`}>{item.vendorId}: {item.reason}</li>
                      ))}
                    </ul>
                  ) : null}
                </section>
              ) : null}

            </details>
          </>
        ) : !loading && !error ? (
          <EmptyStatePanel title="No schedule preview yet" description="Preview Schedule to review vendors due for scheduled draft preparation." />
        ) : null}
      </section>

      {createOpen ? (
        <CreateDraftsModal
          submitting={creating}
          onCancel={() => setCreateOpen(false)}
          onConfirm={() => void handleCreateDrafts()}
        />
      ) : null}
    </section>
  );
}
