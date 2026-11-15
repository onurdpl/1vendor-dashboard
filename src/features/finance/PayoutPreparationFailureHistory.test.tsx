import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/api/errors';
import { PayoutPreparationFailureHistory } from './PayoutPreparationFailureHistory';
import { listPayoutPreparationFailures, getPayoutPreparationFailure, resolvePayoutPreparationFailure, type PayoutPreparationFailureDetail } from './paymentPreparationApi';
vi.mock('./paymentPreparationApi', () => ({ listPayoutPreparationFailures: vi.fn(), getPayoutPreparationFailure: vi.fn(), resolvePayoutPreparationFailure: vi.fn() }));
const list = vi.mocked(listPayoutPreparationFailures);
const detail = vi.mocked(getPayoutPreparationFailure);
const resolve = vi.mocked(resolvePayoutPreparationFailure);
const row = (id: string, vendor = 'a'): PayoutPreparationFailureDetail => ({ id, historicalVendorId: vendor,
  occurredAt: '2026-11-14T12:00:00.000Z', classification: 'TRANSACTION_CONFLICT_RETRY_EXHAUSTED',
  status: 'OPEN', events: [], correlationReference: 'safe-correlation', recoveryGuidance: 'Refresh the Vendor current financial information before trying again.' });
afterEach(cleanup);
beforeEach(() => { vi.resetAllMocks(); list.mockResolvedValue({ items: [], nextCursor: null }); });
describe('independent preparation failure history', () => {
  it('loads Global history and safely opens details without changing payout actions', async () => {
    list.mockResolvedValue({ items: [row('first')], nextCursor: null }); detail.mockResolvedValue(row('first'));
    render(<PayoutPreparationFailureHistory />);
    fireEvent.click(await screen.findByRole('button', { name: 'Details for first' }));
    expect(await screen.findByLabelText('Preparation failure details')).toHaveTextContent('Refresh the Vendor');
    expect(list).toHaveBeenCalledWith({ vendorId: undefined, cursor: undefined, signal: expect.any(AbortSignal) });
    expect(detail).toHaveBeenCalledWith('first', undefined, expect.any(AbortSignal));
    expect(screen.queryByText(/^Open$|^Unresolved$|^Resolve$/)).not.toBeInTheDocument();
  });
  it('loads more in exact Vendor scope and Refresh reloads persisted history from page one', async () => {
    list.mockResolvedValueOnce({ items: [row('first')], nextCursor: 'next' }).mockResolvedValueOnce({ items: [row('second')], nextCursor: null })
      .mockResolvedValueOnce({ items: [row('first')], nextCursor: null });
    render(<PayoutPreparationFailureHistory vendorId="a" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Load more failures' }));
    expect(await screen.findByRole('button', { name: 'Details for second' })).toBeInTheDocument();
    expect(list.mock.calls[1][0]).toMatchObject({ vendorId: 'a', cursor: 'next' });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh failure history' }));
    expect(await screen.findByRole('button', { name: 'Details for first' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Details for second' })).not.toBeInTheDocument();
    expect(list.mock.calls[2][0]).toMatchObject({ vendorId: 'a', cursor: undefined });
  });
  it('keeps errors independent and Retry preserves exact Vendor scope', async () => {
    list.mockRejectedValueOnce(new Error('network'));
    render(<PayoutPreparationFailureHistory vendorId="a" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Retry failure history' }));
    expect(await screen.findByText('No recorded preparation failures in this scope.')).toBeInTheDocument();
    expect(list.mock.calls[1][0].vendorId).toBe('a');
  });
  it('discards delayed A list and detail after A to B to A context changes', async () => {
    let releaseList!: (value: { items: PayoutPreparationFailureDetail[]; nextCursor: null }) => void;
    let releaseDetail!: (value: PayoutPreparationFailureDetail) => void;
    list.mockResolvedValueOnce({ items: [row('first')], nextCursor: null });
    detail.mockImplementationOnce(() => new Promise((resolve) => { releaseDetail = resolve; }));
    const view = render(<PayoutPreparationFailureHistory key="a" vendorId="a" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Details for first' }));
    list.mockImplementationOnce(() => new Promise((resolve) => { releaseList = resolve; }));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh failure history' }));
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    list.mockResolvedValueOnce({ items: [row('b-only', 'b')], nextCursor: null });
    view.rerender(<PayoutPreparationFailureHistory key="b" vendorId="b" />);
    expect(await screen.findByRole('button', { name: 'Details for b-only' })).toBeInTheDocument();
    await act(async () => { releaseList({ items: [row('stale-a')], nextCursor: null }); releaseDetail(row('stale-detail')); });
    expect(screen.queryByText(/stale-a|stale-detail/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Preparation failure details')).not.toBeInTheDocument();
    list.mockResolvedValueOnce({ items: [row('fresh-a')], nextCursor: null });
    view.rerender(<PayoutPreparationFailureHistory key="a" vendorId="a" />);
    expect(await screen.findByRole('button', { name: 'Details for fresh-a' })).toBeInTheDocument();
    expect(screen.queryByText('b-only')).not.toBeInTheDocument();
  });
  it('fails closed on a foreign scoped list response', async () => {
    list.mockResolvedValue({ items: [row('foreign', 'b')], nextCursor: null });
    render(<PayoutPreparationFailureHistory vendorId="a" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be loaded');
    expect(screen.queryByRole('button', { name: 'Details for foreign' })).not.toBeInTheDocument();
  });
  it('shows a detail error and allows retry without dropping scope', async () => {
    list.mockResolvedValue({ items: [row('first')], nextCursor: null }); detail.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce(row('first'));
    render(<PayoutPreparationFailureHistory vendorId="a" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Details for first' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Select Details to retry');
    fireEvent.click(screen.getByRole('button', { name: 'Details for first' }));
    expect(await screen.findByLabelText('Preparation failure details')).toBeInTheDocument();
    expect(detail.mock.calls[1][1]).toBe('a');
  });

  const committed = (vendor = 'a'): PayoutPreparationFailureDetail => ({
    ...row('first', vendor), status: 'RESOLVED', events: [{ fromStatus: 'OPEN', toStatus: 'RESOLVED',
      actorId: 'committed-admin', reason: 'Committed investigation', resolvedAt: '2026-11-15T12:00:00.000Z' }],
  });

  async function startResolution() {
    fireEvent.click(await screen.findByRole('button', { name: 'Details for first' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Mark Resolved' }));
    expect(screen.getByRole('dialog', { name: 'Confirm failure resolution' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Resolution reason'), { target: { value: '   ' } });
    expect(screen.getByRole('button', { name: 'Confirm resolution' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Resolution reason'), { target: { value: '  Local investigation  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm resolution' }));
  }

  it('requires confirmation and a reason then displays immutable server evidence', async () => {
    list.mockResolvedValue({ items: [row('first')], nextCursor: null });
    detail.mockResolvedValue(row('first'));
    resolve.mockResolvedValue(committed());
    render(<PayoutPreparationFailureHistory vendorId="a" />);
    await startResolution();
    expect(await screen.findByText('Reason: Committed investigation')).toBeInTheDocument();
    expect(resolve).toHaveBeenCalledExactlyOnceWith('first', 'Local investigation', expect.any(AbortSignal));
    expect(screen.getByText('Resolving Admin: committed-admin')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark Resolved' })).not.toBeInTheDocument();
  });

  it('reloads the winning resolution on conflict without resubmitting', async () => {
    list.mockResolvedValue({ items: [row('first')], nextCursor: null });
    detail.mockResolvedValueOnce(row('first')).mockResolvedValueOnce(committed());
    resolve.mockRejectedValue(new ApiError('Already resolved', 'server', { status: 409 }));
    render(<PayoutPreparationFailureHistory vendorId="a" />);
    await startResolution();
    expect(await screen.findByText('Reason: Committed investigation')).toBeInTheDocument();
    expect(screen.getByText(/already resolved/)).toBeInTheDocument();
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(detail).toHaveBeenCalledTimes(2);
  });

  it('discards a delayed resolution after a Vendor switch', async () => {
    list.mockResolvedValueOnce({ items: [row('first')], nextCursor: null })
      .mockResolvedValueOnce({ items: [row('b-only', 'b')], nextCursor: null });
    detail.mockResolvedValue(row('first'));
    let finish!: (value: PayoutPreparationFailureDetail) => void;
    resolve.mockImplementation(() => new Promise((done) => { finish = done; }));
    const view = render(<PayoutPreparationFailureHistory vendorId="a" key="a" />);
    await startResolution();
    view.rerender(<PayoutPreparationFailureHistory vendorId="b" key="b" />);
    expect(await screen.findByRole('button', { name: 'Details for b-only' })).toBeInTheDocument();
    await act(async () => { finish(committed()); });
    expect(resolve.mock.calls[0][2]?.aborted).toBe(true);
    expect(screen.queryByText('Reason: Committed investigation')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
