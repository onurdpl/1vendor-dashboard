import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { getCurrentVendorContext } from '../lib/auth';
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
  const scope = typeof vendorId === 'string' ? vendorId.trim() : '';
  // The sole production parent supplies the canonical Vendor and keys by its generation.
  // A keyed child also discards all visible state during a prop change, before passive cleanup.
  if (!scope || getCurrentVendorContext().vendorId.trim() !== scope) {
    return <section aria-label="Automatic approval history">
      <h2>Automatic approval history</h2>
      <p>Select a Vendor in your workspace to review automatic approval history.</p>
    </section>;
  }
  return <VendorApprovalHistory key={scope} vendorId={scope} />;
}

function VendorApprovalHistory({ vendorId }: { vendorId: string }) {
  const [open, setOpen] = useState(false);
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
  const mounted = useRef(false);
  // Independent channels: pagination cannot invalidate concurrent operational/event reads.
  const versions = useRef({ attempts: 0, operational: 0, events: 0 });
  const pending = useRef({ attempts: false, operational: false, events: false });
  const selectedRef = useRef<string | null>(null);
  const viewKey = JSON.stringify([outcome, appliedSettlementId, appliedReasonFilter]);
  const [rowsViewKey, setRowsViewKey] = useState('');
  const visibleRows = rowsViewKey === viewKey ? rows : [];

  function authorized() {
    return mounted.current && getCurrentVendorContext().vendorId.trim() === vendorId;
  }

  function begin(channel: keyof typeof versions.current) {
    const version = ++versions.current[channel];
    pending.current[channel] = true;
    return () => authorized() && versions.current[channel] === version;
  }

  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      versions.current.attempts += 1;
      versions.current.operational += 1;
      versions.current.events += 1;
    };
  }, []);

  useEffect(() => {
    if (!open || !authorized()) return;
    const isCurrent = begin('attempts');
    versions.current.events += 1;
    pending.current.events = false;
    selectedRef.current = null;
    setSelected(null); setEvents([]); setEventCursor(null); setEventError(null); setEventLoading(false);
    setLoading(true); setError(null); setRows([]); setCursor(null); setRowsViewKey(viewKey);
    void listAutoApprovalAttempts({ vendorId, outcome,
      settlementApprovalId: appliedSettlementId || undefined, reasonCode: appliedReasonFilter || undefined })
      .then((result) => {
        if (!isCurrent()) return;
        if (!Array.isArray(result.attempts) || result.attempts.some((row) =>
          row.vendorId !== vendorId || !row.id || !row.settlementApprovalId)) {
          throw new Error('Vendor identity mismatch');
        }
        setRows(result.attempts); setCursor(result.nextCursor);
      })
      .catch(() => { if (isCurrent()) setError('Automatic approval attempts could not be loaded.'); })
      .finally(() => { if (isCurrent()) { pending.current.attempts = false; setLoading(false); } });
    return () => { versions.current.attempts += 1; pending.current.attempts = false;
      versions.current.events += 1; pending.current.events = false; };
  }, [open, outcome, appliedSettlementId, appliedReasonFilter]);

  useEffect(() => {
    if (!open || !authorized()) return;
    const isCurrent = begin('operational');
    setOperationalLoading(true); setOperationalError(null); setOperationalErrors([]); setOperationalCursor(null);
    void listAutoApprovalOperationalErrors({ vendorId })
      .then((result) => {
        if (!isCurrent()) return;
        if (!Array.isArray(result.operationalErrors) || result.operationalErrors.some((row) => row.vendorId !== vendorId)) {
          throw new Error('Vendor identity mismatch');
        }
        setOperationalErrors(result.operationalErrors); setOperationalCursor(result.nextCursor);
      })
      .catch(() => { if (isCurrent()) setOperationalError('Operational errors could not be loaded.'); })
      .finally(() => { if (isCurrent()) { pending.current.operational = false; setOperationalLoading(false); } });
    return () => { versions.current.operational += 1; pending.current.operational = false; };
  }, [open]);

  async function loadMoreOperationalErrors() {
    if (!authorized() || !open || !operationalCursor || pending.current.operational) return;
    const isCurrent = begin('operational');
    setOperationalLoading(true); setOperationalError(null);
    try {
      const result = await listAutoApprovalOperationalErrors({ vendorId, cursor: operationalCursor });
      if (!isCurrent()) return;
      if (!Array.isArray(result.operationalErrors) || result.operationalErrors.some((row) => row.vendorId !== vendorId)) {
        throw new Error('Vendor identity mismatch');
      }
      setOperationalErrors((current) => [...current, ...result.operationalErrors]);
      setOperationalCursor(result.nextCursor);
    } catch { if (isCurrent()) setOperationalError('Older operational errors could not be loaded.'); }
    finally { if (isCurrent()) { pending.current.operational = false; setOperationalLoading(false); } }
  }

  async function loadMore() {
    if (!authorized() || !open || rowsViewKey !== viewKey || !cursor || pending.current.attempts) return;
    const isCurrent = begin('attempts');
    setLoading(true); setError(null);
    try {
      const result = await listAutoApprovalAttempts({ vendorId, outcome,
        settlementApprovalId: appliedSettlementId || undefined, reasonCode: appliedReasonFilter || undefined, cursor });
      if (!isCurrent()) return;
      if (!Array.isArray(result.attempts) || result.attempts.some((row) =>
        row.vendorId !== vendorId || !row.id || !row.settlementApprovalId)) {
        throw new Error('Vendor identity mismatch');
      }
      setRows((current) => [...current, ...result.attempts]); setCursor(result.nextCursor);
    } catch { if (isCurrent()) setError('Older automatic approval attempts could not be loaded.'); }
    finally { if (isCurrent()) { pending.current.attempts = false; setLoading(false); } }
  }

  async function showEvents(id: string, next?: string) {
    const owner = visibleRows.find((row) => row.id === id && row.vendorId === vendorId);
    if (!authorized() || !open || !owner || pending.current.events ||
      (next && (selectedRef.current !== id || next !== eventCursor))) return;
    const isCurrent = begin('events');
    selectedRef.current = id;
    setSelected(id); setEventLoading(true); setEventError(null);
    if (!next) { setEvents([]); setEventCursor(null); }
    try {
      const result = await listAutoApprovalAttemptEvents(id, next);
      if (!isCurrent()) return;
      // Events have no Vendor field; their authoritative attempt envelope supplies ownership.
      if (result.attempt.id !== id || result.attempt.vendorId !== vendorId ||
        result.attempt.settlementApprovalId !== owner.settlementApprovalId) {
        throw new Error('Attempt identity mismatch');
      }
      setEvents((current) => next ? [...current, ...result.events] : result.events);
      setEventCursor(result.nextCursor);
    } catch { if (isCurrent()) setEventError('Attempt history could not be loaded.'); }
    finally { if (isCurrent()) { pending.current.events = false; setEventLoading(false); } }
  }

  // Child-local updates must also fail closed before the parent commits a context change.
  if (getCurrentVendorContext().vendorId.trim() !== vendorId) return null;

  return (
    <section className="settlement-decision-section" aria-label="Automatic approval history">
      <h2>Automatic approval history</h2>
      <p className="page-description">Read-only attempt evidence. An attempt outcome is not the current settlement status.</p>
      <button type="button" onClick={() => setOpen((value) => !value)}>
        {open ? 'Hide automatic approval history' : 'Review automatic approval history'}
      </button>
      {open ? <>
        <div className="op-toolbar">
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
        {!loading && !error && visibleRows.length === 0 ? <p>No automatic approval attempts match these filters.</p> : null}
        {visibleRows.length ? <div className="op-table-scroll"><table className="settlement-audit-table">
          <thead><tr><th>Attempt</th><th>Settlement</th><th>Vendor</th><th>Attempt outcome</th>
            <th>Reason</th><th>Attempt time</th><th>Last persisted event</th><th>Current settlement</th><th>History</th></tr></thead>
          <tbody>{visibleRows.map((row) => <tr key={row.id}>
            <td>{row.id}</td>
            <td><Link onClick={(event) => { if (!authorized()) event.preventDefault(); }}
              to={`/admin/finance/settlement-approvals?approvalId=${encodeURIComponent(row.settlementApprovalId)}`}>
              {row.settlementApprovalId}</Link></td>
            <td>{row.vendorName} ({row.vendorId})</td>
            <td>{row.outcome}{row.exactSuccessfulAttempt ? ' (exact approval evidence)' : ''}</td>
            <td>{reason(row.reasonCode)}</td>
            <td>{formatDateTime(row.createdAt)}</td>
            <td>{row.latestEvent ? `${row.latestEvent.outcome}: ${reason(row.latestEvent.reasonCode)}` : 'UNKNOWN — no event evidence'}</td>
            <td>{row.currentSettlementStatus}</td>
            <td><button type="button" disabled={eventLoading} onClick={() => void showEvents(row.id)}>
              View {row.eventCount} events</button></td>
          </tr>)}</tbody>
        </table></div> : null}
        {rowsViewKey === viewKey && cursor ? <button type="button" disabled={loading} onClick={() => void loadMore()}>Older attempts</button> : null}
        {selected && visibleRows.some((row) => row.id === selected) ? <section aria-label="Attempt event history">
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
