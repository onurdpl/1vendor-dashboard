import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { SettlementAutoApprovalHistory } from './SettlementAutoApprovalHistory';
import { listAutoApprovalAttempts, listAutoApprovalAttemptEvents } from '../features/finance/settlementApprovalsApi';

vi.mock('../features/finance/settlementApprovalsApi', () => ({
  listAutoApprovalAttempts: vi.fn(), listAutoApprovalAttemptEvents: vi.fn(),
}));

const listMock = vi.mocked(listAutoApprovalAttempts);
const eventsMock = vi.mocked(listAutoApprovalAttemptEvents);
const attempt = {
  id: 'attempt-1', settlementApprovalId: 'settlement-1', vendorId: 'vendor-1', vendorName: 'Vendor One',
  actorId: 'system:settlement_auto_approval', outcome: 'UNKNOWN' as const,
  reasonCode: 'UNCLASSIFIED_FAILURE', createdAt: '2026-10-15T10:00:00.000Z', completedAt: null,
  currentSettlementStatus: 'DRAFT' as const, exactSuccessfulAttempt: false,
  latestEvent: { id: 'event-2', outcome: 'UNKNOWN' as const, reasonCode: 'UNCLASSIFIED_FAILURE',
    createdAt: '2026-10-15T10:00:01.000Z' }, eventCount: 2,
};

function renderHistory() {
  return render(<MemoryRouter><SettlementAutoApprovalHistory vendorId="vendor-1" /></MemoryRouter>);
}

describe('Admin automatic approval history', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    listMock.mockResolvedValue({ ok: true, writesPerformed: false, attempts: [attempt], nextCursor: null });
    eventsMock.mockResolvedValue({ ok: true, writesPerformed: false,
      attempt, events: [
        { id: 'event-1', outcome: 'STARTED', reasonCode: 'ATTEMPT_CREATED', createdAt: attempt.createdAt },
        attempt.latestEvent!,
      ], nextCursor: null });
  });
  afterEach(cleanup);

  it('is opt-in read-only and separates UNKNOWN attempt from current DRAFT with persisted history', async () => {
    const user = userEvent.setup();
    renderHistory();
    expect(listMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Review automatic approval history' }));
    expect(await screen.findByRole('link', { name: 'settlement-1' }))
      .toHaveAttribute('href', '/admin/finance/settlement-approvals?approvalId=settlement-1');
    const row = screen.getByRole('row', { name: /attempt-1 settlement-1 Vendor One/ });
    expect(within(row).getByText('UNKNOWN')).toBeInTheDocument();
    expect(within(row).getByText('DRAFT')).toBeInTheDocument();
    expect(within(row).getByText('UNCLASSIFIED_FAILURE')).toBeInTheDocument();
    await user.click(within(row).getByRole('button', { name: 'View 2 events' }));
    expect(await screen.findByText(/STARTED — ATTEMPT_CREATED/)).toBeInTheDocument();
    expect(screen.getByText(/UNKNOWN — UNCLASSIFIED_FAILURE/)).toBeInTheDocument();
    expect(eventsMock).toHaveBeenCalledWith('attempt-1', undefined);
  });

  it('filters by vendor/outcome and pages to older attempts', async () => {
    const user = userEvent.setup();
    listMock.mockResolvedValueOnce({ ok: true, writesPerformed: false, attempts: [attempt], nextCursor: 'attempt-1' })
      .mockResolvedValueOnce({ ok: true, writesPerformed: false,
        attempts: [{ ...attempt, id: 'attempt-older', outcome: 'BLOCKED', reasonCode: 'CANONICAL_APPROVAL_BLOCKED' }],
        nextCursor: null });
    renderHistory();
    await user.click(screen.getByRole('button', { name: 'Review automatic approval history' }));
    await user.click(await screen.findByRole('button', { name: 'Older attempts' }));
    expect(await screen.findByText('attempt-older')).toBeInTheDocument();
    expect(listMock).toHaveBeenCalledWith(expect.objectContaining({ vendorId: 'vendor-1', cursor: 'attempt-1' }));
    await user.selectOptions(screen.getByLabelText('Attempt outcome'), 'UNKNOWN');
    await waitFor(() => expect(listMock).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'UNKNOWN' })));
    await user.type(screen.getByLabelText('Settlement ID'), 'settlement-1');
    await user.click(screen.getByRole('button', { name: 'Apply text filters' }));
    await waitFor(() => expect(listMock).toHaveBeenCalledWith(expect.objectContaining({
      outcome: 'UNKNOWN', settlementApprovalId: 'settlement-1',
    })));
  });

  it('shows empty and error states without inventing financial certainty', async () => {
    const user = userEvent.setup();
    listMock.mockResolvedValueOnce({ ok: true, writesPerformed: false, attempts: [], nextCursor: null });
    renderHistory();
    await user.click(screen.getByRole('button', { name: 'Review automatic approval history' }));
    expect(await screen.findByText('No automatic approval attempts match these filters.')).toBeInTheDocument();
    listMock.mockRejectedValueOnce(new Error('network'));
    await user.selectOptions(screen.getByLabelText('Attempt outcome'), 'BLOCKED');
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be loaded');
  });
});
