import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../../lib/api/errors';
import {
  getPayoutPreparationFailure, listPayoutPreparationFailures, resolvePayoutPreparationFailure,
  type PayoutPreparationFailure, type PayoutPreparationFailureDetail,
} from './paymentPreparationApi';

export function PayoutPreparationFailureHistory({ vendorId }: { vendorId?: string }) {
  // The parent keys this independent history by exact Vendor scope. The effect
  // fence additionally rejects old refresh/detail requests after cleanup.
  const generation = useRef(0);
  const [revision, setRevision] = useState(0);
  const [rows, setRows] = useState<PayoutPreparationFailure[]>([]);
  const [cursor, setCursor] = useState<string>();
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<PayoutPreparationFailureDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const detailController = useRef<AbortController | null>(null);
  const resolutionController = useRef<AbortController | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [resolutionFeedback, setResolutionFeedback] = useState<string | null>(null);

  useEffect(() => {
    const version = ++generation.current;
    const controller = new AbortController();
    setReason(null); setResolutionFeedback(null);
    setLoading(true); setError(null); setDetail(null); setDetailError(null); setDetailLoading(false);
    void listPayoutPreparationFailures({ vendorId, cursor, signal: controller.signal }).then((page) => {
      if (controller.signal.aborted || version !== generation.current) return;
      if (vendorId && page.items.some((item) => item.historicalVendorId !== vendorId)) throw new Error('Unexpected history scope.');
      setRows((previous) => cursor ? [...previous, ...page.items] : page.items);
      setNextCursor(page.nextCursor);
    }).catch(() => {
      if (!controller.signal.aborted && version === generation.current) setError('Preparation failure history could not be loaded.');
    }).finally(() => {
      if (!controller.signal.aborted && version === generation.current) setLoading(false);
    });
    return () => { controller.abort(); detailController.current?.abort(); resolutionController.current?.abort(); };
  }, [vendorId, cursor, revision]);

  async function openDetail(id: string) {
    detailController.current?.abort();
    const controller = new AbortController(); detailController.current = controller;
    const version = generation.current;
    setReason(null); setResolutionFeedback(null);
    setDetail(null); setDetailError(null); setDetailLoading(true);
    try {
      const result = await getPayoutPreparationFailure(id, vendorId, controller.signal);
      if (controller.signal.aborted || version !== generation.current) return;
      if (result.id !== id || (vendorId && result.historicalVendorId !== vendorId)) throw new Error('Unexpected history scope.');
      setDetail(result);
      setRows((previous) => previous.map((row) => row.id === result.id ? { ...row, status: result.status } : row));
    } catch {
      if (!controller.signal.aborted && version === generation.current) setDetailError('Failure details could not be loaded. Select Details to retry.');
    } finally {
      if (!controller.signal.aborted && version === generation.current) setDetailLoading(false);
    }
  }

  async function confirmResolution() {
    const trimmedReason = reason?.trim();
    if (!detail || detail.status !== 'OPEN' || !trimmedReason || resolutionController.current) return;
    const id = detail.id;
    const controller = new AbortController();
    resolutionController.current = controller;
    const version = generation.current;
    const isCurrent = () => !controller.signal.aborted && version === generation.current;
    const applyDetail = (result: PayoutPreparationFailureDetail) => {
      if (result.id !== id || result.status !== 'RESOLVED' ||
          (vendorId && result.historicalVendorId !== vendorId)) throw new Error('Unexpected resolution scope.');
      setDetail(result);
      setRows((previous) => previous.map((row) => row.id === id ? { ...row, status: result.status } : row));
    };
    setResolving(true);
    setResolutionFeedback(null);
    try {
      const result = await resolvePayoutPreparationFailure(id, trimmedReason, controller.signal);
      if (isCurrent()) applyDetail(result);
    } catch (error) {
      if (!isCurrent()) return;
      if (error instanceof ApiError && error.status === 409) {
        try {
          const committed = await getPayoutPreparationFailure(id, vendorId, controller.signal);
          if (isCurrent()) {
            applyDetail(committed);
            setResolutionFeedback('This failure was already resolved. The recorded resolution is shown below.');
          }
        } catch {
          if (isCurrent()) {
            setDetail(null);
            setResolutionFeedback('This failure was already resolved. Select Details to reload its resolution.');
          }
        }
      } else {
        setDetail(null);
        setResolutionFeedback('Resolution could not be confirmed. Select Details to check the current status.');
      }
    } finally {
      resolutionController.current = null;
      if (isCurrent()) {
        setReason(null);
        setResolving(false);
      }
    }
  }

  return <section className="settlement-review-queue" style={{ minWidth: 0, overflowWrap: 'anywhere' }} aria-label="Preparation Failures">
    <h2>Preparation Failures</h2>
    <p>Historical failures {vendorId ? `for Vendor ${vendorId}` : 'across all Vendors'}.</p>
    <button className="button button-secondary" type="button" disabled={resolving} onClick={() => { setCursor(undefined); setRows([]); setDetail(null); setDetailError(null); setDetailLoading(false); setRevision((value) => value + 1); }}>Refresh failure history</button>
    {loading ? <p role="status">Loading preparation failures…</p> : null}
    {error ? <div role="alert">{error} <button className="button button-secondary" type="button" disabled={resolving} onClick={() => setRevision((value) => value + 1)}>Retry failure history</button></div> : null}
    {!loading && !error && rows.length === 0 ? <p>No recorded preparation failures in this scope.</p> : null}
    <ul>{rows.map((row) => <li key={row.id}>
      <strong>{row.historicalVendorId}</strong> · <time dateTime={row.occurredAt}>{row.occurredAt}</time>
      <p>{row.classification} · {row.status}</p>
      {row.correlationReference ? <p>Correlation: {row.correlationReference}</p> : null}
      <button className="button button-secondary" type="button" disabled={resolving || loading} onClick={() => void openDetail(row.id)}>Details for {row.id}</button>
    </li>)}</ul>
    {nextCursor ? <button className="button button-secondary" type="button" disabled={loading || resolving} onClick={() => setCursor(nextCursor)}>Load more failures</button> : null}
    {detailLoading ? <p role="status">Loading failure details…</p> : null}
    {detailError ? <p role="alert">{detailError}</p> : null}
    {resolutionFeedback ? <p role="status">{resolutionFeedback}</p> : null}
    {detail ? <div aria-label="Preparation failure details">
      <h3>Failure details</h3>
      <p>Vendor: {detail.historicalVendorId}</p><p>{detail.occurredAt}</p><p>{detail.classification}</p>
      {detail.correlationReference ? <p>Correlation: {detail.correlationReference}</p> : null}
      <p>{detail.status}</p>
      <p>{detail.recoveryGuidance}</p>
      {detail.status === 'OPEN' ? <button className="button button-secondary" type="button"
        disabled={resolving} onClick={() => setReason('')}>Mark Resolved</button> : null}
      {detail.events.length ? <div>
        <h4>Resolution history</h4>
        <ul>{detail.events.map((event) => <li key={event.resolvedAt}>
          <p>{event.fromStatus} → {event.toStatus}</p>
          <p>Resolving Admin: {event.actorId}</p>
          <p><time dateTime={event.resolvedAt}>{event.resolvedAt}</time></p>
          <p>Reason: {event.reason}</p>
        </li>)}</ul>
      </div> : null}
      <button className="button button-secondary" type="button" disabled={resolving} onClick={() => { setReason(null); setDetail(null); }}>Close failure details</button>
    </div> : null}
    {detail && reason !== null ? <div className="scheduled-settlements-modal" role="dialog" aria-modal="true"
      aria-labelledby="payout-failure-resolution-title">
      <form className="scheduled-settlements-modal-card" onSubmit={(event) => { event.preventDefault(); void confirmResolution(); }}>
        <h3 id="payout-failure-resolution-title">Confirm failure resolution</h3>
        <p>{detail.historicalVendorId} · {detail.id}</p>
        <p>This records your investigation outcome. Payment success requires separate evidence.</p>
        <label>Resolution reason
          <textarea autoFocus required maxLength={500} value={reason} disabled={resolving}
            onChange={(event) => setReason(event.currentTarget.value)} />
        </label>
        <button className="button button-secondary" type="button" disabled={resolving} onClick={() => setReason(null)}>Cancel</button>
        <button className="button button-primary" type="submit" disabled={resolving || !reason.trim()}>
          {resolving ? 'Recording…' : 'Confirm resolution'}
        </button>
      </form>
    </div> : null}
  </section>;
}
