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
  READY: 'Ready for draft creation',
  NOT_DUE: 'Settlement day not reached',
  AUTO_DRAFT_DISABLED: 'Auto draft disabled',
  NO_ELIGIBLE_ROWS: 'No eligible finance rows',
  CONFIG_MISSING: 'Schedule configuration missing',
  BLOCKED: 'Requires review',
  DRAFT_EXISTS: 'Draft already exists',
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

      <section className="scheduled-settlements-card scheduled-auto-draft-job" aria-label="Scheduled auto draft job">
        <div className="settlement-state-heading">
          <div>
            <p className="eyebrow">Automation</p>
            <h3>Scheduled Auto Draft Job</h3>
            <p className="page-description">
              Daily job trigger for draft creation only. It never approves settlements, creates Logo invoices, or executes payouts.
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
        {!jobEnabled ? (
          <p className="page-description">
            SETTLEMENT_AUTO_DRAFT_JOB_ENABLED is false. The job is blocked until this environment gate is enabled.
          </p>
        ) : null}
        {jobStatus?.notes?.length ? (
          <ul className="scheduled-notes">
            {jobStatus.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        ) : null}
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
            <KPIStatCard label="Auto draft eligible" value={dryRun.summary.autoDraftEligibleVendors} detail="READY vendors" tone="success" />
            <KPIStatCard label="Total eligible rows" value={dryRun.summary.totalEligibleLineCount} detail="Preview eligible rows" />
            <KPIStatCard label="Estimated net payable" value={formatMinor(dryRun.summary.totalNetPayableMinor)} detail="Before scheduled draft creation" tone="attention" />
          </div>

          <section className="scheduled-settlements-workspace">
            <div className="scheduled-settlements-main">
              <div className="scheduled-settlements-card">
                <div className="settlement-state-heading">
                  <div>
                    <h3>Vendor Schedule Table</h3>
                    <p className="page-description">Click a vendor row to inspect schedule timing, blockers, refund adjustments, and draft links.</p>
                  </div>
                  <StatusBadge tone={readyCount > 0 ? 'success' : 'attention'}>{readyCount} ready</StatusBadge>
                </div>
                {dryRun.vendors.length ? (
                  <OperationalTable
                    columns={[
                      'Vendor',
                      'Delay',
                      'Frequency',
                      'Settlement day',
                      'Auto draft',
                      'State',
                      'Eligible before',
                      'Rows',
                      'Refund adjustments',
                      'Estimated net',
                      'Blockers',
                      'Existing draft',
                    ]}
                    className="scheduled-settlements-table"
                  >
                    {dryRun.vendors.map((vendor) => {
                      const existingDraft = getDraftForVendor(approvalsByVendor, vendor.vendorId);
                      const state = getScheduleState(vendor, existingDraft);
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
                          <span>{vendor.schedule.settlementDelayDays} days</span>
                          <span>{safeStatusLabel(vendor.schedule.settlementFrequencyType)}</span>
                          <span>{WEEKDAY_LABELS[vendor.schedule.weeklySettlementDay] ?? safeStatusLabel(vendor.schedule.weeklySettlementDay)}</span>
                          <span>{vendor.schedule.autoSettlementDraftEnabled ? 'Enabled' : 'Disabled'}</span>
                          <span><StatusBadge tone={getStateTone(state)}>{STATE_LABELS[state]}</StatusBadge></span>
                          <span>{formatDateTime(dryRun.periodEnd, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                          <span>{vendor.eligibleLineCount}</span>
                          <span>
                            {vendor.pendingRefundAdjustmentCount > 0 ? (
                              <span className="scheduled-refund-badge" title={`Pending deduction amount: ${formatMinor(vendor.pendingRefundAdjustmentTotalMinor)}`}>
                                Refund Adjustments: {vendor.pendingRefundAdjustmentCount}
                              </span>
                            ) : (
                              'None'
                            )}
                          </span>
                          <span>{formatMinor(vendor.netPayableMinor)}</span>
                          <span>{vendor.blockedReason ?? vendor.warnings[0] ?? 'None'}</span>
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
                <h3>Dry Run Notes</h3>
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
                  <MetadataGroup title="Schedule configuration">
                    <MetadataRow label="Settlement delay" value={`${selectedVendor.schedule.settlementDelayDays} days`} />
                    <MetadataRow label="Frequency" value={safeStatusLabel(selectedVendor.schedule.settlementFrequencyType)} />
                    <MetadataRow label="Settlement day" value={WEEKDAY_LABELS[selectedVendor.schedule.weeklySettlementDay] ?? selectedVendor.schedule.weeklySettlementDay} />
                    <MetadataRow label="Auto draft" value={selectedVendor.schedule.autoSettlementDraftEnabled ? 'Enabled' : 'Disabled'} />
                  </MetadataGroup>
                  <MetadataGroup title="Settlement timing">
                    <MetadataRow label="Eligible before" value={formatDateTime(dryRun.periodEnd, { month: 'short', day: 'numeric', year: 'numeric' })} />
                    <MetadataRow label="Run date" value={dryRun.runDate} />
                    <MetadataRow label="Timing explanation" value={selectedVendor.dueReason} />
                  </MetadataGroup>
                  <MetadataGroup title="Preview facts">
                    <MetadataRow label="Eligible rows" value={selectedVendor.eligibleLineCount} />
                    <MetadataRow label="Estimated net payable" value={formatMinor(selectedVendor.netPayableMinor)} />
                    <MetadataRow label="Pending refund adjustments" value={`${selectedVendor.pendingRefundAdjustmentCount} (${formatMinor(selectedVendor.pendingRefundAdjustmentTotalMinor)})`} />
                    <MetadataRow label="Net after pending adjustments" value={formatMinor(selectedVendor.netAfterPendingRefundAdjustmentsMinor)} />
                  </MetadataGroup>
                  <MetadataGroup title="Current blockers">
                    <MetadataRow label="State" value={STATE_LABELS[getScheduleState(selectedVendor, getDraftForVendor(approvalsByVendor, selectedVendor.vendorId))]} />
                    <MetadataRow label="Blocker" value={selectedVendor.blockedReason ?? 'None'} />
                    <MetadataRow label="Warnings" value={selectedVendor.warnings.length ? selectedVendor.warnings.join(', ') : 'None'} />
                  </MetadataGroup>
                  <MetadataGroup title="Existing draft links">
                    {getDraftForVendor(approvalsByVendor, selectedVendor.vendorId) ? (
                      <MetadataRow
                        label="Settlement Approval ID"
                        value={<Link to={getOpenSettlementHref(getDraftForVendor(approvalsByVendor, selectedVendor.vendorId)!.id)}>{getDraftForVendor(approvalsByVendor, selectedVendor.vendorId)!.id}</Link>}
                      />
                    ) : (
                      <MetadataRow label="Settlement Approval ID" value="None" />
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
