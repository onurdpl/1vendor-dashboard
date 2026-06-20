import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  EmptyStatePanel,
  KPIStatCard,
  MetadataGroup,
  MetadataRow,
  OperationalTable,
  OperationalTableRow,
  SectionErrorRetry,
  SideDetailPanel,
  StatusBadge,
} from '../components/OperationalPrimitives';
import {
  createSettlementScheduleDrafts,
  getSettlementScheduleAutoDraftJobStatus,
  getSettlementScheduleDryRun,
  runSettlementScheduleAutoDraftJob,
  type SettlementScheduleAutoDraftJobResponse,
  type SettlementScheduleAutoDraftJobStatusResponse,
  type SettlementScheduleCreateDraftsResponse,
  type SettlementScheduleDryRunResponse,
  type SettlementScheduleDryRunVendor,
} from '../features/finance/api';
import { listSettlementApprovals, type SettlementApprovalSummary } from '../features/finance/settlementApprovalsApi';
import { formatCurrency, formatDateTime, safeStatusLabel } from '../services/real/formatting';

type ScheduleState =
  | 'READY'
  | 'NOT_DUE'
  | 'AUTO_DRAFT_DISABLED'
  | 'NO_ELIGIBLE_ROWS'
  | 'CONFIG_MISSING'
  | 'BLOCKED'
  | 'DRAFT_EXISTS';

const STATE_LABELS: Record<ScheduleState, string> = {
  READY: 'Ready',
  NOT_DUE: 'Not due',
  AUTO_DRAFT_DISABLED: 'Auto draft off',
  NO_ELIGIBLE_ROWS: 'No eligible rows',
  CONFIG_MISSING: 'Missing config',
  BLOCKED: 'Blocked',
  DRAFT_EXISTS: 'Draft exists',
};

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

function getScheduleState(vendor: SettlementScheduleDryRunVendor, existingDraft: SettlementApprovalSummary | null): ScheduleState {
  if (existingDraft) {
    return 'DRAFT_EXISTS';
  }
  if (!vendor.schedule?.weeklySettlementDay || !vendor.schedule?.settlementFrequencyType) {
    return 'CONFIG_MISSING';
  }
  if (!vendor.due) {
    return 'NOT_DUE';
  }
  if (!vendor.schedule.autoSettlementDraftEnabled) {
    return 'AUTO_DRAFT_DISABLED';
  }
  if (vendor.canCreateDraft) {
    return 'READY';
  }
  if (vendor.eligibleLineCount === 0 && !vendor.blockedReason) {
    return 'NO_ELIGIBLE_ROWS';
  }
  if (vendor.eligibleLineCount === 0 && /no eligible/i.test(vendor.blockedReason ?? '')) {
    return 'NO_ELIGIBLE_ROWS';
  }
  return 'BLOCKED';
}

function getStateTone(state: ScheduleState): 'success' | 'attention' | 'warning' | 'danger' | 'neutral' | 'info' {
  if (state === 'READY') return 'success';
  if (state === 'DRAFT_EXISTS') return 'info';
  if (state === 'NOT_DUE' || state === 'AUTO_DRAFT_DISABLED' || state === 'NO_ELIGIBLE_ROWS') return 'attention';
  if (state === 'CONFIG_MISSING') return 'danger';
  return 'warning';
}

function getDraftForVendor(
  approvalsByVendor: Record<string, SettlementApprovalSummary[]>,
  vendorId: string,
) {
  return approvalsByVendor[vendorId]?.find((approval) => approval.status === 'draft') ?? null;
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

function getAutomationStatusCopy(jobStatus: SettlementScheduleAutoDraftJobStatusResponse | null) {
  if (!jobStatus) {
    return 'Loading automation status.';
  }
  if (!jobStatus.enabled) {
    return 'Auto draft job is disabled in this environment. Drafts will not be created automatically until the environment gate is enabled.';
  }
  if (jobStatus.dryRun) {
    return 'Auto draft job is running in dry-run mode. It will preview results but will not create drafts.';
  }
  return 'Auto draft job is in write mode. It can create drafts after explicit confirmation.';
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
        <h3 id="scheduled-create-drafts-title">Create settlement drafts for all READY vendors?</h3>
        <p className="page-description">
          This uses the existing scheduled draft endpoint. It does not approve settlements, create invoices, call Logo, or execute payouts.
        </p>
        <label className="scheduled-settlements-confirm">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          <span>I understand this will create settlement drafts.</span>
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

function AutoDraftJobModal({
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
    <div className="scheduled-settlements-modal" role="dialog" aria-modal="true" aria-labelledby="scheduled-auto-draft-job-title">
      <div className="scheduled-settlements-modal-card">
        <p className="eyebrow">Scheduled auto draft job</p>
        <h3 id="scheduled-auto-draft-job-title">Create settlement drafts for all READY vendors?</h3>
        <p className="page-description">
          This job creates draft settlement approvals only. It does not approve settlements, create invoices, call Logo, or execute payouts.
        </p>
        <label className="scheduled-settlements-confirm">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          <span>I understand this will create settlement drafts for all READY vendors.</span>
        </label>
        <div className="scheduled-settlements-modal-actions">
          <button type="button" className="button button-secondary" onClick={onCancel} disabled={submitting}>
            Cancel
          </button>
          <button type="button" className="button button-primary" onClick={onConfirm} disabled={!confirmed || submitting}>
            {submitting ? 'Running job...' : 'Run Auto Draft Job'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function AdminScheduledSettlementsPage() {
  const [runDate, setRunDate] = useState(todayKey);
  const [vendorFilter, setVendorFilter] = useState('');
  const [dryRun, setDryRun] = useState<SettlementScheduleDryRunResponse | null>(null);
  const [approvalsByVendor, setApprovalsByVendor] = useState<Record<string, SettlementApprovalSummary[]>>({});
  const [selectedVendorId, setSelectedVendorId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createResult, setCreateResult] = useState<SettlementScheduleCreateDraftsResponse | null>(null);
  const [jobStatus, setJobStatus] = useState<SettlementScheduleAutoDraftJobStatusResponse | null>(null);
  const [jobStatusError, setJobStatusError] = useState<string | null>(null);
  const [jobRunning, setJobRunning] = useState(false);
  const [jobRunOpen, setJobRunOpen] = useState(false);
  const [jobRunError, setJobRunError] = useState<string | null>(null);
  const [jobResult, setJobResult] = useState<SettlementScheduleAutoDraftJobResponse | null>(null);

  async function loadDryRun(nextRunDate = runDate, nextVendorFilter = vendorFilter) {
    setLoading(true);
    setError(null);
    try {
      const response = await getSettlementScheduleDryRun({
        runDate: nextRunDate,
        vendorId: nextVendorFilter.trim() || null,
      });
      setDryRun(response);
      setSelectedVendorId((current) => {
        if (current && response.vendors.some((vendor) => vendor.vendorId === current)) {
          return current;
        }
        return response.vendors[0]?.vendorId ?? null;
      });
      const approvalEntries = await Promise.all(
        response.vendors.map(async (vendor) => {
          try {
            const approvals = await listSettlementApprovals(vendor.vendorId);
            return [vendor.vendorId, approvals.approvals] as const;
          } catch {
            return [vendor.vendorId, []] as const;
          }
        }),
      );
      setApprovalsByVendor(Object.fromEntries(approvalEntries));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Scheduled settlement dry run failed.');
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

  const selectedVendor = useMemo(
    () => dryRun?.vendors.find((vendor) => vendor.vendorId === selectedVendorId) ?? null,
    [dryRun?.vendors, selectedVendorId],
  );
  const readyCount = dryRun?.vendors.filter((vendor) => getScheduleState(vendor, getDraftForVendor(approvalsByVendor, vendor.vendorId)) === 'READY').length ?? 0;

  async function handleCreateDrafts() {
    setCreating(true);
    setCreateError(null);
    try {
      const result = await createSettlementScheduleDrafts({
        runDate,
        vendorId: vendorFilter.trim() || null,
        confirmAutoSettlementDrafts: true,
      });
      setCreateResult(result);
      setCreateOpen(false);
      await loadDryRun(runDate, vendorFilter);
    } catch (requestError) {
      setCreateError(requestError instanceof Error ? requestError.message : 'Scheduled draft creation failed.');
    } finally {
      setCreating(false);
    }
  }

  async function handleRunAutoDraftJob() {
    setJobRunning(true);
    setJobRunError(null);
    try {
      const result = await runSettlementScheduleAutoDraftJob({
        runDate,
        confirmScheduledSettlementAutoDraftJob: true,
      });
      setJobResult(result);
      setJobRunOpen(false);
      await loadJobStatus();
      if (result.writesPerformed) {
        await loadDryRun(runDate, vendorFilter);
      }
    } catch (requestError) {
      setJobRunError(requestError instanceof Error ? requestError.message : 'Scheduled auto draft job failed.');
    } finally {
      setJobRunning(false);
    }
  }

  function handleAutoDraftJobClick() {
    if (jobStatus?.dryRun) {
      void handleRunAutoDraftJob();
      return;
    }
    setJobRunOpen(true);
  }

  const jobModeLabel = jobStatus?.mode === 'WRITE' ? 'Write mode' : 'Dry-run mode';
  const jobEnabled = jobStatus?.enabled === true;
  const selectedDraft = selectedVendor ? getDraftForVendor(approvalsByVendor, selectedVendor.vendorId) : null;
  const selectedState = selectedVendor ? getScheduleState(selectedVendor, selectedDraft) : null;
  const selectedBlockers = selectedVendor ? getVendorBlockers(selectedVendor) : [];

  return (
    <section className="op-page scheduled-settlements-page">
      <div className="op-page-heading">
        <div>
          <p className="eyebrow">Finance operations</p>
          <h2>Scheduled Settlements</h2>
          <p className="page-description">
            Review due vendors, blockers, refund adjustment visibility, and create scheduled draft settlements from the existing schedule engine.
          </p>
        </div>
        <button type="button" className="button button-primary" onClick={() => setCreateOpen(true)} disabled={loading || readyCount === 0}>
          Create Scheduled Drafts
        </button>
      </div>

      <section className="scheduled-settlements-controls" aria-label="Scheduled settlement filters">
        <label>
          <span>Run date</span>
          <input type="date" value={runDate} onChange={(event) => setRunDate(event.target.value)} />
        </label>
        <label>
          <span>Vendor filter</span>
          <input
            type="text"
            placeholder="Optional vendor id"
            value={vendorFilter}
            onChange={(event) => setVendorFilter(event.target.value)}
          />
        </label>
        <button type="button" className="button button-secondary" onClick={() => void loadDryRun()} disabled={loading}>
          {loading ? 'Running dry run...' : 'Run Dry Run'}
        </button>
      </section>

      {error ? <SectionErrorRetry title="Scheduled settlement dry run failed" description={error} onRetry={() => void loadDryRun()} /> : null}
      {createError ? <SectionErrorRetry title="Scheduled draft creation failed" description={createError} /> : null}
      {jobStatusError ? <SectionErrorRetry title="Scheduled auto draft job status failed" description={jobStatusError} onRetry={() => void loadJobStatus()} /> : null}
      {jobRunError ? <SectionErrorRetry title="Scheduled auto draft job failed" description={jobRunError} /> : null}

      <section className="scheduled-settlements-card scheduled-auto-draft-job scheduled-command-card" aria-label="Scheduled auto draft job">
        <div className="settlement-state-heading">
          <div>
            <p className="eyebrow">Automation</p>
            <h3>Scheduled Auto Draft Job</h3>
            <p className="page-description">
              Daily draft creation guardrail for vendors that are due and ready.
            </p>
          </div>
          <div className="scheduled-job-badges">
            <StatusBadge tone={jobEnabled ? 'success' : 'attention'}>{jobEnabled ? 'Enabled' : 'Disabled'}</StatusBadge>
            <StatusBadge tone={jobStatus?.mode === 'WRITE' ? 'warning' : 'info'}>{jobModeLabel}</StatusBadge>
          </div>
        </div>
        <div className="scheduled-job-grid">
          <MetadataRow label="Run date" value={runDate} />
          <MetadataRow label="Writes" value={jobStatus?.dryRun === false ? 'Allowed after confirmation' : 'Disabled by dry-run mode'} />
          <MetadataRow
            label="Last run"
            value={jobStatus?.lastRun ? `${jobStatus.lastRun.runDate} · ${safeStatusLabel(jobStatus.lastRun.status)}` : 'No run recorded'}
          />
          <MetadataRow label="Last created" value={jobStatus?.lastRun ? jobStatus.lastRun.createdDraftCount : 0} />
        </div>
        <p className="scheduled-job-copy">{getAutomationStatusCopy(jobStatus)}</p>
        <div className="scheduled-job-actions">
          <button type="button" className="button button-primary" onClick={handleAutoDraftJobClick} disabled={!jobEnabled || jobRunning}>
            {jobRunning ? 'Running job...' : 'Run Auto Draft Job'}
          </button>
        </div>
      </section>

      {dryRun ? (
        <>
          <div className="op-kpi-row scheduled-settlements-summary" aria-label="Scheduled settlement summary">
            <KPIStatCard label="Vendors checked" value={dryRun.summary.vendorsChecked} detail="Schedule profiles inspected" />
            <KPIStatCard label="Due vendors" value={dryRun.summary.dueVendors} detail="Run date matches schedule" tone="info" />
            <KPIStatCard label="Ready for draft" value={dryRun.summary.autoDraftEligibleVendors} detail="Can create draft" tone="success" />
            <KPIStatCard label="Eligible rows" value={dryRun.summary.totalEligibleLineCount} detail="Preview eligible rows" />
            <KPIStatCard label="Estimated net payable" value={formatMinor(dryRun.summary.totalNetPayableMinor)} detail="Before scheduled draft creation" tone="attention" />
          </div>

          <section className="scheduled-settlements-workspace">
            <div className="scheduled-settlements-main">
              <div className="scheduled-settlements-card">
                <div className="settlement-state-heading">
                  <div>
                    <h3>Vendor Schedule</h3>
                    <p className="page-description">Scan due vendors and open a row for full blocker details.</p>
                  </div>
                  <StatusBadge tone={readyCount > 0 ? 'success' : 'attention'}>{readyCount} ready</StatusBadge>
                </div>
                {readyCount === 0 ? (
                  <div className="scheduled-ready-empty" role="status">
                    <strong>No scheduled drafts ready for this run date.</strong>
                    <span>Try the next settlement day or review vendor schedule settings.</span>
                  </div>
                ) : null}
                {dryRun.vendors.length ? (
                  <OperationalTable
                    columns={[
                      'Vendor',
                      'Schedule',
                      'Auto draft',
                      'State',
                      'Rows',
                      'Refund adjustments',
                      'Net payable',
                      'Blockers',
                      'Draft',
                    ]}
                    className="scheduled-settlements-table"
                  >
                    {dryRun.vendors.map((vendor) => {
                      const existingDraft = getDraftForVendor(approvalsByVendor, vendor.vendorId);
                      const state = getScheduleState(vendor, existingDraft);
                      const schedule = getScheduleSummary(vendor);
                      const blockers = getVendorBlockers(vendor);
                      return (
                        <OperationalTableRow
                          key={vendor.vendorId}
                          selected={selectedVendorId === vendor.vendorId}
                          onSelect={() => setSelectedVendorId(vendor.vendorId)}
                        >
                          <span>
                            <strong>{getVendorName(vendor)}</strong>
                            <small>{vendor.vendorId}</small>
                          </span>
                          <span className="scheduled-table-schedule">
                            <strong>{schedule.primary}</strong>
                            <small>{schedule.secondary}</small>
                          </span>
                          <span>{vendor.schedule.autoSettlementDraftEnabled ? 'Enabled' : 'Disabled'}</span>
                          <span><StatusBadge tone={getStateTone(state)}>{STATE_LABELS[state]}</StatusBadge></span>
                          <span>{vendor.eligibleLineCount}</span>
                          <span>
                            {vendor.pendingRefundAdjustmentCount > 0 ? (
                              <span className="scheduled-refund-badge" title={`Pending deduction amount: ${formatMinor(vendor.pendingRefundAdjustmentTotalMinor)}`}>
                                {vendor.pendingRefundAdjustmentCount} pending
                              </span>
                            ) : (
                              'None'
                            )}
                          </span>
                          <span>{formatMinor(vendor.netPayableMinor)}</span>
                          <span>
                            {blockers.length ? (
                              <span className="scheduled-blocker-chip" title={blockers.join(' ')}>
                                {blockers.length} blocker{blockers.length === 1 ? '' : 's'}
                              </span>
                            ) : (
                              'Clear'
                            )}
                          </span>
                          <span>
                            {existingDraft ? (
                              <Link to={getOpenSettlementHref(existingDraft.id)}>Open Settlement</Link>
                            ) : (
                              'None'
                            )}
                          </span>
                        </OperationalTableRow>
                      );
                    })}
                  </OperationalTable>
                ) : (
                  <EmptyStatePanel title="No vendors returned" description="The dry run did not return any vendor schedule profiles for this filter." />
                )}
              </div>

              <div className="scheduled-settlements-card">
                    <h3>Run Notes</h3>
                <ul className="scheduled-notes">
                  {dryRun.notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                  <li>Dry run is read-only: no drafts are created from this view until confirmation.</li>
                  <li>No approvals, provider invoices, payout execution, or external provider writes are performed by dry run.</li>
                </ul>
              </div>

              {createResult ? (
                <div className="scheduled-settlements-card" aria-label="Scheduled draft creation result">
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
                </div>
              ) : null}

              {jobResult ? (
                <div className="scheduled-settlements-card" aria-label="Scheduled auto draft job result">
                  <h3>Auto Draft Job Result</h3>
                  <div className="scheduled-result-grid">
                    <MetadataRow label="Mode" value={jobResult.mode === 'WRITE' ? 'Write' : 'Dry run'} />
                    <MetadataRow label="Writes performed" value={jobResult.writesPerformed ? 'Yes' : 'No'} />
                    <MetadataRow label="Created drafts" value={jobResult.summary.createdDrafts} />
                    <MetadataRow label="Existing drafts" value={jobResult.summary.existingDrafts} />
                    <MetadataRow label="Skipped" value={jobResult.summary.skipped} />
                    <MetadataRow label="Blocked" value={jobResult.summary.blocked} />
                  </div>
                  {jobResult.notes.length ? (
                    <ul className="scheduled-notes">
                      {jobResult.notes.map((note) => (
                        <li key={note}>{note}</li>
                      ))}
                    </ul>
                  ) : null}
                  {jobResult.vendors.length ? (
                    <ul className="scheduled-result-list">
                      {jobResult.vendors.map((vendor) => (
                        <li key={vendor.vendorId}>
                          <span>{vendor.vendorId}</span>
                          <span>{STATE_LABELS[vendor.state as ScheduleState] ?? safeStatusLabel(vendor.state)}</span>
                          {vendor.createdSettlementApprovalId ? (
                            <Link to={getOpenSettlementHref(vendor.createdSettlementApprovalId)}>Open Settlement</Link>
                          ) : (
                            <strong>{vendor.skippedReason ?? vendor.blockers[0] ?? 'No action'}</strong>
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
            </div>

            <SideDetailPanel title={selectedVendor ? getVendorName(selectedVendor) : 'Vendor detail'} eyebrow="Schedule detail">
              {selectedVendor ? (
                <>
                  <div className="scheduled-detail-hero">
                    <StatusBadge tone={selectedState ? getStateTone(selectedState) : 'neutral'}>
                      {selectedState ? STATE_LABELS[selectedState] : 'Not selected'}
                    </StatusBadge>
                    <strong>{getScheduleSummary(selectedVendor).detail}</strong>
                    <span>{selectedVendor.schedule.autoSettlementDraftEnabled ? 'Auto draft enabled' : 'Auto draft off'}</span>
                  </div>
                  <MetadataGroup title="Eligibility">
                    <MetadataRow label="Eligible before" value={formatDateTime(dryRun.periodEnd, { month: 'short', day: 'numeric', year: 'numeric' })} />
                    <MetadataRow label="Eligible rows" value={selectedVendor.eligibleLineCount} />
                    <MetadataRow label="Estimated net payable" value={formatMinor(selectedVendor.netPayableMinor)} />
                    <MetadataRow label="Run status" value={selectedState ? STATE_LABELS[selectedState] : 'Unknown'} />
                  </MetadataGroup>
                  <MetadataGroup title="Timing">
                    <MetadataRow label="Run date" value={dryRun.runDate} />
                    <MetadataRow label="Explanation" value={selectedVendor.dueReason} />
                  </MetadataGroup>
                  <MetadataGroup title="Refund adjustments">
                    <MetadataRow label="Count" value={selectedVendor.pendingRefundAdjustmentCount} />
                    <MetadataRow label="Amount" value={formatMinor(selectedVendor.pendingRefundAdjustmentTotalMinor)} />
                    <MetadataRow label="Net after pending adjustments" value={formatMinor(selectedVendor.netAfterPendingRefundAdjustmentsMinor)} />
                  </MetadataGroup>
                  <MetadataGroup title="Blockers">
                    {selectedBlockers.length ? (
                      <ul className="scheduled-detail-blockers">
                        {selectedBlockers.map((blocker) => (
                          <li key={blocker}>{blocker}</li>
                        ))}
                      </ul>
                    ) : (
                      <MetadataRow label="Status" value="No blockers" />
                    )}
                  </MetadataGroup>
                  <MetadataGroup title="Existing draft">
                    {selectedDraft ? (
                      <MetadataRow
                        label="Settlement"
                        value={<Link to={getOpenSettlementHref(selectedDraft.id)}>Open Settlement</Link>}
                      />
                    ) : (
                      <MetadataRow label="Settlement" value="None" />
                    )}
                  </MetadataGroup>
                </>
              ) : (
                <EmptyStatePanel title="No vendor selected" description="Run a dry run and select a vendor to inspect schedule details." />
              )}
            </SideDetailPanel>
          </section>
        </>
      ) : !loading && !error ? (
        <EmptyStatePanel title="Dry run not loaded" description="Run a dry run to inspect scheduled settlement candidates." />
      ) : null}

      {createOpen ? (
        <CreateDraftsModal
          submitting={creating}
          onCancel={() => setCreateOpen(false)}
          onConfirm={() => void handleCreateDrafts()}
        />
      ) : null}
      {jobRunOpen ? (
        <AutoDraftJobModal
          submitting={jobRunning}
          onCancel={() => setJobRunOpen(false)}
          onConfirm={() => void handleRunAutoDraftJob()}
        />
      ) : null}
    </section>
  );
}
