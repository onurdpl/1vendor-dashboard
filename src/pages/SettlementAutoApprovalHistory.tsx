import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  listAutoApprovalAttemptEvents, listAutoApprovalAttempts,
  listAutoApprovalOperationalErrors,
  type AutoApprovalAttemptEvent, type AutoApprovalAttemptOutcome,
  type AutoApprovalAttemptSummary, type AutoApprovalOperationalError,
} from '../features/finance/settlementApprovalsApi';
import { formatDateTime } from '../services/real/formatting';

const OUTCOMES: Array<AutoApprovalAttemptOutcome | ''> = [
  '', 'STARTED', 'APPROVED', 'BLOCKED', 'TECHNICAL_FAILURE', 'UNKNOWN',
];

function reason(value: string | null) {
  return value || 'No persisted reason';
}

function operationalExplanation(category: string) {
  switch (category) {
    case 'DATABASE_READ_FAILED': return 'Required finance evidence could not be read.';
    case 'RECONCILIATION_FAILED': return 'An existing approval attempt could not be reconciled.';
    case 'WORKER_FAILED': return 'A vendor-scoped approval worker did not complete.';
    case 'UNEXPECTED_SWEEP_FAILURE': return 'The scheduler sweep ended unexpectedly.';
    default: return 'Operational failure requires Admin review.';
  }
}

export function SettlementAutoApprovalHistory({ vendorId }: { vendorId: string }) {
  const [open, setOpen] = useState(false);
  const [allVendors, setAllVendors] = useState(false);
  const [outcome, setOutcome] = useState<AutoApprovalAttemptOutcome | ''>('');
  const [settlementId, setSettlementId] = useState('');
  const [reasonFilter, setReasonFilter] = useState('');
  const [appliedSettlementId, setAppliedSettlementId] = useState('');
  const [appliedReasonFilter, setAppliedReasonFilter] = useState('');
  const [rows, setRows] = useState<AutoApprovalAttemptSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [events, setEvents] = useState<AutoApprovalAttemptEvent[]>([]);
  const [eventCursor, setEventCursor] = useState<string | null>(null);
  const [eventLoading, setEventLoading] = useState(false);
  const [eventError, setEventError] = useState<string | null>(null);
  const [operationalErrors, setOperationalErrors] = useState<AutoApprovalOperationalError[]>([]);
  const [operationalCursor, setOperationalCursor] = useState<string | null>(null);
  const [operationalLoading, setOperationalLoading] = useState(false);
  const [operationalError, setOperationalError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setRows([]);
    setCursor(null);
    setSelected(null);
    void listAutoApprovalAttempts({ vendorId: allVendors ? undefined : vendorId.trim() || undefined,
      outcome, settlementApprovalId: appliedSettlementId || undefined,
      reasonCode: appliedReasonFilter || undefined })
      .then((result) => { if (!cancelled) { setRows(result.attempts); setCursor(result.nextCursor); } })
      .catch(() => { if (!cancelled) setError('Automatic approval attempts could not be loaded.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, vendorId, allVendors, outcome, appliedSettlementId, appliedReasonFilter]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setOperationalLoading(true);
    setOperationalError(null);
    setOperationalErrors([]);
    setOperationalCursor(null);
    void listAutoApprovalOperationalErrors({ vendorId: allVendors ? undefined : vendorId.trim() || undefined })
      .then((result) => { if (!cancelled) {
        setOperationalErrors(result.operationalErrors); setOperationalCursor(result.nextCursor);
      } })
      .catch(() => { if (!cancelled) setOperationalError('Operational errors could not be loaded.'); })
      .finally(() => { if (!cancelled) setOperationalLoading(false); });
    return () => { cancelled = true; };
  }, [open, vendorId, allVendors]);

  async function loadMoreOperationalErrors() {
    if (!operationalCursor || operationalLoading) return;
    setOperationalLoading(true);
    setOperationalError(null);
    try {
      const result = await listAutoApprovalOperationalErrors({
        vendorId: allVendors ? undefined : vendorId.trim() || undefined, cursor: operationalCursor,
      });
      setOperationalErrors((current) => [...current, ...result.operationalErrors]);
      setOperationalCursor(result.nextCursor);
    } catch { setOperationalError('Older operational errors could not be loaded.'); }
    finally { setOperationalLoading(false); }
  }

  async function loadMore() {
    if (!cursor || loading) return;
    setLoading(true);
    setError(null);
    try {
      const result = await listAutoApprovalAttempts({ vendorId: allVendors ? undefined : vendorId.trim() || undefined,
        outcome, settlementApprovalId: appliedSettlementId || undefined,
        reasonCode: appliedReasonFilter || undefined, cursor });
      setRows((current) => [...current, ...result.attempts]);
      setCursor(result.nextCursor);
    } catch { setError('Older automatic approval attempts could not be loaded.'); }
    finally { setLoading(false); }
  }

  async function showEvents(id: string, next?: string) {
    if (eventLoading) return;
    setEventLoading(true);
    setEventError(null);
    try {
      const result = await listAutoApprovalAttemptEvents(id, next);
      setSelected(id);
      setEvents((current) => next ? [...current, ...result.events] : result.events);
      setEventCursor(result.nextCursor);
    } catch { setEventError('Attempt history could not be loaded.'); }
    finally { setEventLoading(false); }
  }

  return (
    <section className="settlement-decision-section" aria-label="Automatic approval history">
      <h2>Automatic approval history</h2>
      <p className="page-description">Read-only attempt evidence. An attempt outcome is not the current settlement status.</p>
      <button type="button" onClick={() => setOpen((value) => !value)}>
        {open ? 'Hide automatic approval history' : 'Review automatic approval history'}
      </button>
      {open ? <>
        <div className="op-toolbar">
          <label><input type="checkbox" checked={allVendors} onChange={(event) => setAllVendors(event.target.checked)} /> All vendors</label>
          <label>Outcome <select aria-label="Attempt outcome" value={outcome}
            onChange={(event) => setOutcome(event.target.value as AutoApprovalAttemptOutcome | '')}>
            {OUTCOMES.map((value) => <option key={value} value={value}>{value || 'All outcomes'}</option>)}
          </select></label>
          <label>Settlement ID <input value={settlementId} onChange={(event) => setSettlementId(event.target.value)} /></label>
          <label>Reason code <input value={reasonFilter} onChange={(event) => setReasonFilter(event.target.value)} /></label>
          <button type="button" onClick={() => {
            setAppliedSettlementId(settlementId.trim());
            setAppliedReasonFilter(reasonFilter.trim());
          }}>Apply text filters</button>
        </div>
        {loading ? <p role="status">Loading automatic approval attempts…</p> : null}
        {error ? <p role="alert">{error} <button type="button" onClick={() => setOpen(false)}>Close and retry</button></p> : null}
        {!loading && !error && rows.length === 0 ? <p>No automatic approval attempts match these filters.</p> : null}
        {rows.length ? <div className="op-table-scroll"><table className="settlement-audit-table">
          <thead><tr><th>Attempt</th><th>Settlement</th><th>Vendor</th><th>Attempt outcome</th>
            <th>Reason</th><th>Attempt time</th><th>Last persisted event</th><th>Current settlement</th><th>History</th></tr></thead>
          <tbody>{rows.map((row) => <tr key={row.id}>
            <td>{row.id}</td>
            <td><Link to={`/admin/finance/settlement-approvals?approvalId=${encodeURIComponent(row.settlementApprovalId)}`}>
              {row.settlementApprovalId}</Link></td>
            <td>{row.vendorName} ({row.vendorId})</td>
            <td>{row.outcome}{row.exactSuccessfulAttempt ? ' (exact approval evidence)' : ''}</td>
            <td>{reason(row.reasonCode)}</td>
            <td>{formatDateTime(row.createdAt)}</td>
            <td>{row.latestEvent ? `${row.latestEvent.outcome}: ${reason(row.latestEvent.reasonCode)}` : 'UNKNOWN — no event evidence'}</td>
            <td>{row.currentSettlementStatus}</td>
            <td><button type="button" onClick={() => void showEvents(row.id)}>
              View {row.eventCount} events</button></td>
          </tr>)}</tbody>
        </table></div> : null}
        {cursor ? <button type="button" disabled={loading} onClick={() => void loadMore()}>Older attempts</button> : null}
        {selected ? <section aria-label="Attempt event history">
          <h3>Persisted events for {selected}</h3>
          {eventLoading ? <p role="status">Loading attempt events…</p> : null}
          {eventError ? <p role="alert">{eventError}</p> : null}
          <ol>{events.map((event, index) => <li key={event.id}>
            {index === 0 ? 'Initial attempt' : index === 1 ? 'Initial persisted outcome' : 'Later persisted event'}:{' '}
            {formatDateTime(event.createdAt)} — {event.outcome} — {reason(event.reasonCode)}
          </li>)}</ol>
          {eventCursor ? <button type="button" disabled={eventLoading}
            onClick={() => void showEvents(selected, eventCursor)}>Older events</button> : null}
        </section> : null}
        <section aria-label="Scheduler and worker operational errors">
          <h3>Scheduler / worker operational errors</h3>
          <p className="page-description">These are technical failures, not financial approval attempts or settlement outcomes.</p>
          {operationalLoading ? <p role="status">Loading operational errors…</p> : null}
          {operationalError ? <p role="alert">{operationalError}</p> : null}
          {!operationalLoading && !operationalError && !operationalErrors.length ?
            <p>No persisted operational errors in this view.</p> : null}
          {operationalErrors.length ? <div className="op-table-scroll"><table className="settlement-audit-table">
            <thead><tr><th>Category</th><th>Phase</th><th>Explanation</th><th>Safe code</th><th>Vendor</th>
              <th>Related attempt</th><th>First observed</th><th>Last observed</th><th>Occurrences</th></tr></thead>
            <tbody>{operationalErrors.map((item) => <tr key={item.id}>
              <td>{item.category}</td><td>{item.phase}</td><td>{operationalExplanation(item.category)}</td>
              <td>{item.errorCode}</td>
              <td>{item.vendorId ?? 'Global scheduler'}</td><td>{item.attemptId ?? 'No attempt'}</td>
              <td>{formatDateTime(item.firstOccurredAt)}</td><td>{formatDateTime(item.lastOccurredAt)}</td>
              <td>{item.occurrenceCount}</td>
            </tr>)}</tbody>
          </table></div> : null}
          {operationalCursor ? <button type="button" disabled={operationalLoading}
            onClick={() => void loadMoreOperationalErrors()}>Older operational errors</button> : null}
        </section>
      </> : null}
    </section>
  );
}
