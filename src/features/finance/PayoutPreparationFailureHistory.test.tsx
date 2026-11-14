import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PayoutPreparationFailureHistory } from './PayoutPreparationFailureHistory';
import { listPayoutPreparationFailures, getPayoutPreparationFailure, type PayoutPreparationFailure } from './paymentPreparationApi';
vi.mock('./paymentPreparationApi', () => ({ listPayoutPreparationFailures: vi.fn(), getPayoutPreparationFailure: vi.fn() }));
const list = vi.mocked(listPayoutPreparationFailures);
const detail = vi.mocked(getPayoutPreparationFailure);
const row = (id: string, vendor = 'a'): PayoutPreparationFailure => ({ id, historicalVendorId: vendor,
  occurredAt: '2026-11-14T12:00:00.000Z', classification: 'TRANSACTION_CONFLICT_RETRY_EXHAUSTED',
  correlationReference: 'safe-correlation', recoveryGuidance: 'Refresh the Vendor current financial information before trying again.' });
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
    let releaseList!: (value: { items: PayoutPreparationFailure[]; nextCursor: null }) => void;
    let releaseDetail!: (value: PayoutPreparationFailure) => void;
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
});
