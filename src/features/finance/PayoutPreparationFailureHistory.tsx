import { useEffect, useRef, useState } from 'react';
import { getPayoutPreparationFailure, listPayoutPreparationFailures, type PayoutPreparationFailure } from './paymentPreparationApi';

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
  const [detail, setDetail] = useState<PayoutPreparationFailure | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const detailController = useRef<AbortController | null>(null);
  useEffect(() => {
    const version = ++generation.current;
    const controller = new AbortController();
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
    return () => { controller.abort(); detailController.current?.abort(); };
  }, [vendorId, cursor, revision]);

  async function openDetail(id: string) {
    detailController.current?.abort();
    const controller = new AbortController(); detailController.current = controller;
    const version = generation.current;
    setDetail(null); setDetailError(null); setDetailLoading(true);
    try {
      const result = await getPayoutPreparationFailure(id, vendorId, controller.signal);
      if (controller.signal.aborted || version !== generation.current) return;
      if (result.id !== id || (vendorId && result.historicalVendorId !== vendorId)) throw new Error('Unexpected history scope.');
      setDetail(result);
    } catch {
      if (!controller.signal.aborted && version === generation.current) setDetailError('Failure details could not be loaded. Select Details to retry.');
    } finally {
      if (!controller.signal.aborted && version === generation.current) setDetailLoading(false);
    }
  }

  return <section className="settlement-review-queue" style={{ minWidth: 0, overflowWrap: 'anywhere' }} aria-label="Preparation Failures">
    <h2>Preparation Failures</h2>
    <p>Historical failures {vendorId ? `for Vendor ${vendorId}` : 'across all Vendors'}. These records do not indicate a current resolution status.</p>
    <button className="button button-secondary" type="button" onClick={() => { setCursor(undefined); setRows([]); setDetail(null); setDetailError(null); setDetailLoading(false); setRevision((value) => value + 1); }}>Refresh failure history</button>
    {loading ? <p role="status">Loading preparation failures…</p> : null}
    {error ? <div role="alert">{error} <button className="button button-secondary" type="button" onClick={() => setRevision((value) => value + 1)}>Retry failure history</button></div> : null}
    {!loading && !error && rows.length === 0 ? <p>No recorded preparation failures in this scope.</p> : null}
    <ul>{rows.map((row) => <li key={row.id}>
      <strong>{row.historicalVendorId}</strong> · <time dateTime={row.occurredAt}>{row.occurredAt}</time>
      <p>{row.classification}</p>
      {row.correlationReference ? <p>Correlation: {row.correlationReference}</p> : null}
      <button className="button button-secondary" type="button" onClick={() => void openDetail(row.id)}>Details for {row.id}</button>
    </li>)}</ul>
    {nextCursor ? <button className="button button-secondary" type="button" disabled={loading} onClick={() => setCursor(nextCursor)}>Load more failures</button> : null}
    {detailLoading ? <p role="status">Loading failure details…</p> : null}
    {detailError ? <p role="alert">{detailError}</p> : null}
    {detail ? <div aria-label="Preparation failure details">
      <h3>Failure details</h3>
      <p>Vendor: {detail.historicalVendorId}</p><p>{detail.occurredAt}</p><p>{detail.classification}</p>
      {detail.correlationReference ? <p>Correlation: {detail.correlationReference}</p> : null}
      <p>{detail.recoveryGuidance}</p>
      <button className="button button-secondary" type="button" onClick={() => setDetail(null)}>Close failure details</button>
    </div> : null}
  </section>;
}
