import { useLayoutEffect } from 'react';
import { getCurrentVendorContext, setCurrentUser, setCurrentVendorId } from '../lib/auth';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { AdminSettlementApprovalsPage } from './AdminSettlementApprovalsPage';
import { SettlementAutoApprovalHistory } from './SettlementAutoApprovalHistory';
import { listAutoApprovalAttempts, listAutoApprovalAttemptEvents,
  listAutoApprovalOperationalErrors, type AutoApprovalAttemptSummary, type AutoApprovalOperationalError } from '../features/finance/settlementApprovalsApi';

vi.mock('../features/finance/settlementApprovalsApi', async () => ({
  ...await vi.importActual('../features/finance/settlementApprovalsApi'),
  getDatabaseHealth: vi.fn(async () => ({ ok: true })),
  listSettlementApprovals: vi.fn(async (vendorId: string) => ({ vendorId, approvals: [] })),
  listAutoApprovalAttempts: vi.fn(), listAutoApprovalAttemptEvents: vi.fn(),
  listAutoApprovalOperationalErrors: vi.fn(),
}));

const listMock = vi.mocked(listAutoApprovalAttempts);
const eventsMock = vi.mocked(listAutoApprovalAttemptEvents);
const operationalMock = vi.mocked(listAutoApprovalOperationalErrors);
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function vendorAttempt(vendorId: string, suffix = 'current'): AutoApprovalAttemptSummary {
  return { ...attempt, id: `${vendorId}-${suffix}`, settlementApprovalId: `${vendorId}-${suffix}-settlement`,
    vendorId, vendorName: vendorId === 'yalispor' ? 'Yalıspor' : 'Sporjinal',
    reasonCode: `${vendorId}-${suffix}-evidence` };
}
function attemptPage(rows: AutoApprovalAttemptSummary[], cursor: string | null = null) {
  return { ok: true as const, writesPerformed: false as const, attempts: rows, nextCursor: cursor };
}
function operationalRow(vendorId: string, suffix = 'current'): AutoApprovalOperationalError {
  return { id: `${vendorId}-${suffix}-operation`, category: 'WORKER_FAILED', phase: 'VENDOR_WORKER',
    errorCode: `${vendorId}-${suffix}-safe-code`, vendorId, settlementApprovalId: null, attemptId: null,
    firstOccurredAt: '2026-10-15T10:00:00.000Z', lastOccurredAt: '2026-10-15T10:01:00.000Z', occurrenceCount: 1 };
}
function operationalPage(rows: AutoApprovalOperationalError[], cursor: string | null = null) {
  return { ok: true as const, writesPerformed: false as const, operationalErrors: rows, nextCursor: cursor };
}
function eventPage(owner: AutoApprovalAttemptSummary, code = 'current-event', cursor: string | null = null) {
  return { ok: true as const, writesPerformed: false as const, attempt: owner,
    events: [{ id: `${owner.id}-${code}`, outcome: 'BLOCKED' as const, reasonCode: code, createdAt: owner.createdAt }],
    nextCursor: cursor };
}
async function openHistory() {
  await userEvent.setup().click(screen.getByRole('button', { name: 'Review automatic approval history' }));
}
function scopedHistory(initialVendor = 'yalispor') {
  setCurrentVendorId(initialVendor);
  const view = render(<MemoryRouter><SettlementAutoApprovalHistory vendorId={initialVendor} /></MemoryRouter>);
  return { ...view, switchVendor(id: string) {
    act(() => setCurrentVendorId(id));
    view.rerender(<MemoryRouter><SettlementAutoApprovalHistory vendorId={id} /></MemoryRouter>);
  } };
}

describe('Admin automatic approval history', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    window.localStorage.clear();
    setCurrentUser({ email: 'admin@demo.com', name: 'Admin', role: 'admin',
      vendorAccess: ['vendor-1', 'yalispor', 'sporjinal'],
      vendorDetails: [{ vendorId: 'vendor-1', vendorName: 'Vendor One' },
        { vendorId: 'yalispor', vendorName: 'Yalıspor' }, { vendorId: 'sporjinal', vendorName: 'Sporjinal' }],
      canSwitchVendors: true, defaultVendorId: 'vendor-1' });
    setCurrentVendorId('vendor-1');
    listMock.mockResolvedValue({ ok: true, writesPerformed: false, attempts: [attempt], nextCursor: null });
    eventsMock.mockResolvedValue({ ok: true, writesPerformed: false,
      attempt, events: [
        { id: 'event-1', outcome: 'STARTED', reasonCode: 'ATTEMPT_CREATED', createdAt: attempt.createdAt },
        attempt.latestEvent!,
      ], nextCursor: null });
    operationalMock.mockResolvedValue({ ok: true, writesPerformed: false,
      operationalErrors: [], nextCursor: null });
  });
  afterEach(() => { cleanup(); window.localStorage.clear(); });

  it('is opt-in read-only and separates UNKNOWN attempt from current DRAFT with persisted history', async () => {
    const user = userEvent.setup();
    renderHistory();
    expect(listMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Review automatic approval history' }));
    expect(await screen.findByRole('link', { name: 'settlement-1' }))
      .toHaveAttribute('href', '/admin/finance/settlement-approvals?approvalId=settlement-1');
    expect(listMock).toHaveBeenCalledWith(expect.objectContaining({ vendorId: 'vendor-1' }));
    expect(operationalMock).toHaveBeenCalledWith({ vendorId: 'vendor-1' });
    expect(screen.queryByLabelText('All vendors')).not.toBeInTheDocument();
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

  it('shows safe operational evidence separately without calling it an approval attempt', async () => {
    const user = userEvent.setup();
    operationalMock.mockResolvedValueOnce({ ok: true, writesPerformed: false,
      operationalErrors: [{ id: 'operational-1', category: 'DATABASE_READ_FAILED', phase: 'VENDOR_DISCOVERY',
        errorCode: 'P2024', vendorId: 'vendor-1', settlementApprovalId: null, attemptId: null,
        firstOccurredAt: '2026-10-15T10:00:00.000Z', lastOccurredAt: '2026-10-15T10:01:00.000Z',
        occurrenceCount: 2 }], nextCursor: null });
    renderHistory();
    await user.click(screen.getByRole('button', { name: 'Review automatic approval history' }));
    const section = await screen.findByRole('region', { name: 'Scheduler and worker operational errors' });
    expect(within(section).getByText('VENDOR_DISCOVERY')).toBeInTheDocument();
    expect(within(section).getByText('vendor-1')).toBeInTheDocument();
    expect(within(section).queryByText('Global scheduler')).not.toBeInTheDocument();
    expect(within(section).getByText('No attempt')).toBeInTheDocument();
    expect(within(section).getByText('2')).toBeInTheDocument();
    expect(within(section).getByText(/not financial approval attempts/)).toBeInTheDocument();
  });
  it.each(['', '   ', undefined, null, 42])('fails closed for invalid Vendor %s without any history query', async (id) => {
    setCurrentVendorId('yalispor');
    render(<MemoryRouter><SettlementAutoApprovalHistory vendorId={id as unknown as string} /></MemoryRouter>);
    expect(screen.getByText(/Select a Vendor in your workspace/)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    await act(async () => {});
    expect(listMock).not.toHaveBeenCalled(); expect(operationalMock).not.toHaveBeenCalled();
    expect(eventsMock).not.toHaveBeenCalled();
  });

  it('rejects a noncanonical prop instead of querying another Vendor or switching the workspace', async () => {
    setCurrentVendorId('yalispor');
    render(<MemoryRouter><SettlementAutoApprovalHistory vendorId="sporjinal" /></MemoryRouter>);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(listMock).not.toHaveBeenCalled(); expect(operationalMock).not.toHaveBeenCalled();
    expect(getCurrentVendorContext().vendorId).toBe('yalispor');
  });

  it.each([['yalispor', 'sporjinal'], ['sporjinal', 'yalispor']])(
    'removes %s records, events, cursors and links immediately before loading %s', async (a, b) => {
      const ownerA = vendorAttempt(a); const ownerB = vendorAttempt(b);
      const next = deferred<ReturnType<typeof attemptPage>>();
      listMock.mockResolvedValueOnce(attemptPage([ownerA], 'old-attempt-cursor')).mockReturnValueOnce(next.promise);
      operationalMock.mockImplementation(async ({ vendorId }) => operationalPage([operationalRow(vendorId!)]));
      eventsMock.mockResolvedValue(eventPage(ownerA, `${a}-private-event`, 'old-event-cursor'));
      const view = scopedHistory(a);
      await openHistory();
      await screen.findByRole('link', { name: ownerA.settlementApprovalId });
      await userEvent.setup().click(screen.getByRole('button', { name: 'View 2 events' }));
      expect(await screen.findByText(new RegExp(`${a}-private-event`))).toBeInTheDocument();
      view.switchVendor(b);
      expect(screen.queryByText(ownerA.id)).not.toBeInTheDocument();
      expect(screen.queryByText(new RegExp(`${a}-private-event`))).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: ownerA.settlementApprovalId })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Older/ })).not.toBeInTheDocument();
      expect(screen.queryByText(`${a}-current-safe-code`)).not.toBeInTheDocument();
      await openHistory();
      expect(screen.getByText('Loading automatic approval attempts…')).toBeInTheDocument();
      await act(async () => next.resolve(attemptPage([ownerB])));
      expect(screen.getByRole('link', { name: ownerB.settlementApprovalId })).toHaveAttribute('href',
        `/admin/finance/settlement-approvals?approvalId=${ownerB.settlementApprovalId}`);
      expect(screen.getByText(ownerB.reasonCode!)).toBeInTheDocument();
      expect(screen.queryByText(ownerA.reasonCode!)).not.toBeInTheDocument();
      expect(listMock.mock.calls.every(([filters]) => Boolean(filters.vendorId))).toBe(true);
      expect(operationalMock.mock.calls.every(([filters]) => Boolean(filters.vendorId))).toBe(true);
      expect(listMock).toHaveBeenLastCalledWith(expect.objectContaining({ vendorId: b }));
    });

  it('hides old content in the layout commit before passive cleanup', async () => {
    const old = vendorAttempt('yalispor');
    listMock.mockResolvedValue(attemptPage([old], 'old-cursor'));
    setCurrentVendorId('yalispor');
    let inspect = false;
    const commits: string[] = [];
    function Probe({ vendorId }: { vendorId: string }) {
      useLayoutEffect(() => { if (inspect) commits.push(screen.getByLabelText('Automatic approval history').textContent || ''); });
      return <SettlementAutoApprovalHistory vendorId={vendorId} />;
    }
    const view = render(<MemoryRouter><Probe vendorId="yalispor" /></MemoryRouter>);
    await openHistory(); await screen.findByText(old.id);
    inspect = true;
    act(() => setCurrentVendorId('sporjinal'));
    view.rerender(<MemoryRouter><Probe vendorId="sporjinal" /></MemoryRouter>);
    expect(commits.length).toBeGreaterThan(0);
    expect(commits.every((text) => !text.includes(old.id) && !text.includes(old.settlementApprovalId))).toBe(true);
  });

  it('rejects an original A response after A to B to A rather than restoring old records or cursors', async () => {
    const old = deferred<ReturnType<typeof attemptPage>>();
    const fresh = deferred<ReturnType<typeof attemptPage>>();
    listMock.mockReturnValueOnce(old.promise).mockResolvedValueOnce(attemptPage([vendorAttempt('sporjinal')]))
      .mockReturnValueOnce(fresh.promise);
    const view = scopedHistory(); await openHistory();
    view.switchVendor('sporjinal'); await openHistory(); await screen.findByText('sporjinal-current');
    view.switchVendor('yalispor'); await openHistory();
    await act(async () => old.resolve(attemptPage([vendorAttempt('yalispor', 'obsolete')], 'obsolete-cursor')));
    expect(screen.queryByText('yalispor-obsolete')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Older attempts' })).not.toBeInTheDocument();
    expect(screen.getByText('Loading automatic approval attempts…')).toBeInTheDocument();
    await act(async () => fresh.resolve(attemptPage([vendorAttempt('yalispor', 'fresh')])));
    expect(screen.getByText('yalispor-fresh-evidence')).toBeInTheDocument();
    expect(screen.queryByText('yalispor-obsolete-evidence')).not.toBeInTheDocument();
  });

  it.each(['attempts', 'operational', 'events'] as const)(
    'ignores stale %s pagination results and cursors after Vendor switch', async (channel) => {
      const a = vendorAttempt('yalispor'); const b = vendorAttempt('sporjinal');
      const oldAttempts = deferred<ReturnType<typeof attemptPage>>();
      const oldOperations = deferred<ReturnType<typeof operationalPage>>();
      const oldEvents = deferred<ReturnType<typeof eventPage>>();
      listMock.mockImplementation(({ vendorId, cursor }) => vendorId === 'sporjinal' ? Promise.resolve(attemptPage([b])) :
        cursor ? oldAttempts.promise : Promise.resolve(attemptPage([a], 'a-attempt-cursor')));
      operationalMock.mockImplementation(({ vendorId, cursor }) => vendorId === 'sporjinal' ?
        Promise.resolve(operationalPage([operationalRow('sporjinal')])) : cursor ? oldOperations.promise :
          Promise.resolve(operationalPage([operationalRow('yalispor')], 'a-operation-cursor')));
      eventsMock.mockImplementation((id, cursor) => cursor ? oldEvents.promise : Promise.resolve(eventPage(a, 'a-event', 'a-event-cursor')));
      const view = scopedHistory(); await openHistory(); await screen.findByText(a.id);
      if (channel === 'events') {
        await userEvent.setup().click(screen.getByRole('button', { name: 'View 2 events' }));
        await screen.findByText(/a-event/);
      }
      const label = channel === 'attempts' ? 'Older attempts' : channel === 'operational' ? 'Older operational errors' : 'Older events';
      await userEvent.setup().click(screen.getByRole('button', { name: label }));
      view.switchVendor('sporjinal'); await openHistory(); await screen.findByText(b.id);
      await act(async () => {
        if (channel === 'attempts') oldAttempts.resolve(attemptPage([vendorAttempt('yalispor', 'obsolete')], 'stale-cursor'));
        if (channel === 'operational') oldOperations.resolve(operationalPage([operationalRow('yalispor', 'obsolete')], 'stale-cursor'));
        if (channel === 'events') oldEvents.resolve(eventPage(a, 'obsolete-event', 'stale-cursor'));
      });
      expect(screen.getByText(b.id)).toBeInTheDocument();
      expect(screen.queryByText(/obsolete/)).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: a.settlementApprovalId })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: label })).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Attempt event history')).not.toBeInTheDocument();
    });

  it.each(['attempts', 'operational', 'events'] as const)(
    'does not let a stale %s rejection or finally overwrite B error/loading state', async (channel) => {
      const a = vendorAttempt('yalispor'); const b = vendorAttempt('sporjinal');
      const old = deferred<never>();
      const freshAttempts = deferred<ReturnType<typeof attemptPage>>();
      const freshOperations = deferred<ReturnType<typeof operationalPage>>();
      const freshEvents = deferred<ReturnType<typeof eventPage>>();
      listMock.mockImplementation(({ vendorId, cursor }) => vendorId === 'sporjinal' ? freshAttempts.promise :
        cursor ? old.promise : Promise.resolve(attemptPage([a], 'a-cursor')));
      operationalMock.mockImplementation(({ vendorId, cursor }) => vendorId === 'sporjinal' ? freshOperations.promise :
        cursor ? old.promise : Promise.resolve(operationalPage([operationalRow('yalispor')], 'a-operation-cursor')));
      eventsMock.mockImplementation((id) => id === a.id ? old.promise : freshEvents.promise);
      const view = scopedHistory(); await openHistory(); await screen.findByText(a.id);
      await userEvent.setup().click(screen.getByRole('button', { name: channel === 'attempts' ? 'Older attempts' :
        channel === 'operational' ? 'Older operational errors' : 'View 2 events' }));
      view.switchVendor('sporjinal'); await openHistory();
      if (channel === 'events') {
        await act(async () => freshAttempts.resolve(attemptPage([b])));
        await userEvent.setup().click(screen.getByRole('button', { name: 'View 2 events' }));
      }
      await act(async () => old.reject(new Error('old Vendor failure')));
      const loadingText = channel === 'attempts' ? 'Loading automatic approval attempts…' : channel === 'operational' ?
        'Loading operational errors…' : 'Loading attempt events…';
      expect(screen.getByText(loadingText)).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      await act(async () => {
        freshAttempts.resolve(attemptPage([b])); freshOperations.resolve(operationalPage([operationalRow('sporjinal')]));
        freshEvents.resolve(eventPage(b, 'b-current-event'));
      });
      expect(screen.getByText(b.id)).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.queryByText(loadingText)).not.toBeInTheDocument();
    });

  it.each(['attempts', 'operational', 'events'] as const)('rejects wrong ownership in %s responses', async (channel) => {
    const a = vendorAttempt('yalispor'); const foreign = vendorAttempt('sporjinal');
    listMock.mockResolvedValue(attemptPage(channel === 'attempts' ? [foreign] : [a]));
    operationalMock.mockResolvedValue(operationalPage(channel === 'operational' ? [operationalRow('sporjinal')] : []));
    eventsMock.mockResolvedValue(eventPage(foreign, 'foreign-private-event'));
    scopedHistory(); await openHistory();
    if (channel === 'events') {
      await screen.findByText(a.id);
      await userEvent.setup().click(screen.getByRole('button', { name: 'View 2 events' }));
    }
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be loaded');
    expect(screen.queryByText(foreign.id)).not.toBeInTheDocument();
    expect(screen.queryByText('sporjinal-current-safe-code')).not.toBeInTheDocument();
    expect(screen.queryByText(/foreign-private-event/)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: foreign.settlementApprovalId })).not.toBeInTheDocument();
    expect(getCurrentVendorContext().vendorId).toBe('yalispor');
  });

  it('rejects global operational records in a Vendor-scoped response', async () => {
    listMock.mockResolvedValue(attemptPage([]));
    operationalMock.mockResolvedValue(operationalPage([{ ...operationalRow('yalispor'), vendorId: null }]));
    scopedHistory(); await openHistory();
    expect(await screen.findByRole('alert')).toHaveTextContent('Operational errors could not be loaded');
    expect(screen.queryByText('Global scheduler')).not.toBeInTheDocument();
  });

  it.each(['attempt-id', 'settlement-id'] as const)('rejects event envelope %s mismatch', async (field) => {
    const a = vendorAttempt('yalispor');
    listMock.mockResolvedValue(attemptPage([a]));
    eventsMock.mockResolvedValue(eventPage({ ...a, ...(field === 'attempt-id' ? { id: 'wrong' } : { settlementApprovalId: 'wrong' }) }, 'wrong-private-event'));
    scopedHistory(); await openHistory(); await screen.findByText(a.id);
    await userEvent.setup().click(screen.getByRole('button', { name: 'View 2 events' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Attempt history could not be loaded');
    expect(screen.queryByText(/wrong-private-event/)).not.toBeInTheDocument();
  });

  it('preserves same-Vendor operational and event pagination independently of attempt pagination', async () => {
    const a = vendorAttempt('yalispor');
    const moreAttempts = deferred<ReturnType<typeof attemptPage>>();
    listMock.mockResolvedValueOnce(attemptPage([a], 'attempt-cursor')).mockReturnValueOnce(moreAttempts.promise);
    operationalMock.mockResolvedValueOnce(operationalPage([operationalRow('yalispor')], 'operation-cursor'))
      .mockResolvedValueOnce(operationalPage([operationalRow('yalispor', 'older')]));
    eventsMock.mockResolvedValueOnce(eventPage(a, 'first-event', 'event-cursor'))
      .mockResolvedValueOnce(eventPage(a, 'second-event'));
    scopedHistory(); await openHistory(); await screen.findByText(a.id);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Older attempts' }));
    await userEvent.setup().click(screen.getByRole('button', { name: 'Older operational errors' }));
    expect(await screen.findByText('yalispor-older-safe-code')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'View 2 events' }));
    await screen.findByText(/first-event/);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Older events' }));
    expect(await screen.findByText(/second-event/)).toBeInTheDocument();
    expect(screen.getByText(/first-event/)).toBeInTheDocument();
    expect(screen.getByText('Loading automatic approval attempts…')).toBeInTheDocument();
    expect(operationalMock).toHaveBeenLastCalledWith({ vendorId: 'yalispor', cursor: 'operation-cursor' });
    expect(eventsMock).toHaveBeenLastCalledWith(a.id, 'event-cursor');
    await act(async () => moreAttempts.resolve(attemptPage([vendorAttempt('yalispor', 'older')])));
    expect(screen.getByText('yalispor-older')).toBeInTheDocument();
  });

  it('prevents same-render duplicate pagination and event submissions without blocking independent reads', async () => {
    const a = vendorAttempt('yalispor');
    listMock.mockResolvedValueOnce(attemptPage([a], 'cursor')).mockReturnValue(new Promise(() => {}));
    operationalMock.mockResolvedValueOnce(operationalPage([operationalRow('yalispor')], 'operation-cursor'))
      .mockReturnValue(new Promise(() => {}));
    eventsMock.mockReturnValue(new Promise(() => {}));
    scopedHistory(); await openHistory(); await screen.findByText(a.id);
    const older = screen.getByRole('button', { name: 'Older attempts' });
    const event = screen.getByRole('button', { name: 'View 2 events' });
    const olderOperations = screen.getByRole('button', { name: 'Older operational errors' });
    act(() => { fireEvent.click(older); fireEvent.click(older); fireEvent.click(event); fireEvent.click(event);
      fireEvent.click(olderOperations); fireEvent.click(olderOperations); });
    expect(listMock).toHaveBeenCalledTimes(2);
    expect(operationalMock).toHaveBeenCalledTimes(2);
    expect(eventsMock).toHaveBeenCalledTimes(1);
  });

  it('rejects old DOM handlers when live workspace changes before the parent renders', async () => {
    const a = vendorAttempt('yalispor');
    listMock.mockResolvedValue(attemptPage([a], 'cursor'));
    operationalMock.mockResolvedValue(operationalPage([operationalRow('yalispor')], 'operation-cursor'));
    scopedHistory(); await openHistory(); await screen.findByText(a.id);
    act(() => {
      setCurrentVendorId('sporjinal');
      fireEvent.click(screen.getByRole('button', { name: 'Older attempts' }));
      fireEvent.click(screen.getByRole('button', { name: 'Older operational errors' }));
      fireEvent.click(screen.getByRole('button', { name: 'View 2 events' }));
    });
    expect(listMock).toHaveBeenCalledTimes(1); expect(operationalMock).toHaveBeenCalledTimes(1);
    expect(eventsMock).not.toHaveBeenCalled();
  });

  it('rejects an old same-Vendor pagination failure/finally after a filter starts a newer request', async () => {
    const a = vendorAttempt('yalispor');
    const old = deferred<ReturnType<typeof attemptPage>>();
    const fresh = deferred<ReturnType<typeof attemptPage>>();
    listMock.mockResolvedValueOnce(attemptPage([a], 'old-cursor')).mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(fresh.promise);
    scopedHistory(); await openHistory(); await screen.findByText(a.id);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Older attempts' }));
    await userEvent.setup().selectOptions(screen.getByLabelText('Attempt outcome'), 'BLOCKED');
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(3));
    expect(screen.queryByText(a.id)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Older attempts' })).not.toBeInTheDocument();
    await act(async () => old.reject(new Error('obsolete filter failure')));
    expect(screen.getByText('Loading automatic approval attempts…')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await act(async () => fresh.resolve(attemptPage([{ ...vendorAttempt('yalispor', 'fresh'), outcome: 'BLOCKED' }])));
    expect(screen.getByText('yalispor-fresh')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it.each(['attempts', 'operational', 'events'] as const)(
    'rejects foreign %s pagination without accepting its rows or cursor', async (channel) => {
      const a = vendorAttempt('yalispor'); const foreign = vendorAttempt('sporjinal');
      listMock.mockResolvedValueOnce(attemptPage([a], 'valid-cursor')).mockResolvedValueOnce(attemptPage([foreign], 'foreign-cursor'));
      operationalMock.mockResolvedValueOnce(operationalPage([operationalRow('yalispor')], 'valid-operation-cursor'))
        .mockResolvedValueOnce(operationalPage([operationalRow('sporjinal')], 'foreign-cursor'));
      eventsMock.mockResolvedValueOnce(eventPage(a, 'valid-event', 'valid-event-cursor'))
        .mockResolvedValueOnce(eventPage(foreign, 'foreign-event', 'foreign-cursor'));
      scopedHistory(); await openHistory(); await screen.findByText(a.id);
      if (channel === 'events') {
        await userEvent.setup().click(screen.getByRole('button', { name: 'View 2 events' }));
        await screen.findByText(/valid-event/);
      }
      await userEvent.setup().click(screen.getByRole('button', { name: channel === 'attempts' ? 'Older attempts' :
        channel === 'operational' ? 'Older operational errors' : 'Older events' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('could not be loaded');
      expect(screen.getByText(a.id)).toBeInTheDocument();
      expect(screen.queryByText(foreign.id)).not.toBeInTheDocument();
      expect(screen.queryByText('sporjinal-current-safe-code')).not.toBeInTheDocument();
      expect(screen.queryByText(/foreign-event/)).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: foreign.settlementApprovalId })).not.toBeInTheDocument();
      expect(listMock.mock.calls.some(([filters]) => filters.cursor === 'foreign-cursor')).toBe(false);
      expect(operationalMock.mock.calls.some(([filters]) => filters.cursor === 'foreign-cursor')).toBe(false);
    });

  it('uses the real Phase A/B parent generation key to reject batched A to B to A History responses', async () => {
    const old = deferred<ReturnType<typeof attemptPage>>();
    const fresh = deferred<ReturnType<typeof attemptPage>>();
    setCurrentVendorId('yalispor');
    listMock.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    render(<MemoryRouter><AdminSettlementApprovalsPage /></MemoryRouter>);
    await openHistory();
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(1));
    act(() => { setCurrentVendorId('sporjinal'); setCurrentVendorId('yalispor'); });
    expect(screen.getByRole('button', { name: 'Review automatic approval history' })).toBeInTheDocument();
    await openHistory();
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2));
    await act(async () => old.resolve(attemptPage([vendorAttempt('yalispor', 'obsolete')], 'obsolete-cursor')));
    expect(screen.queryByRole('link', { name: 'yalispor-obsolete-settlement' })).not.toBeInTheDocument();
    expect(screen.getByText('Loading automatic approval attempts…')).toBeInTheDocument();
    await act(async () => fresh.resolve(attemptPage([vendorAttempt('yalispor', 'fresh')])));
    expect(screen.getByRole('link', { name: 'yalispor-fresh-settlement' })).toHaveAttribute('href',
      '/admin/finance/settlement-approvals?approvalId=yalispor-fresh-settlement');
    expect(getCurrentVendorContext().vendorId).toBe('yalispor');
    expect(screen.getByLabelText('Vendor', { selector: 'input' })).toHaveValue('Yalıspor');
    act(() => setCurrentVendorId('sporjinal'));
    expect(screen.queryByRole('link', { name: 'yalispor-fresh-settlement' })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('blocks a stale settlement link using the live workspace before parent rendering', async () => {
    const a = vendorAttempt('yalispor');
    listMock.mockResolvedValue(attemptPage([a]));
    setCurrentVendorId('yalispor');
    function LocationProbe() { const location = useLocation(); return <output aria-label="Current path">{location.pathname}{location.search}</output>; }
    render(<MemoryRouter initialEntries={['/admin/finance/settlement-approvals']}>
      <LocationProbe /><SettlementAutoApprovalHistory vendorId="yalispor" />
    </MemoryRouter>);
    await openHistory();
    const link = await screen.findByRole('link', { name: a.settlementApprovalId });
    act(() => { setCurrentVendorId('sporjinal'); fireEvent.click(link); });
    expect(screen.getByLabelText('Current path')).toHaveTextContent(/^\/admin\/finance\/settlement-approvals$/);
    expect(eventsMock).not.toHaveBeenCalled();
  });

  it('discards loaded history, operational data, events and cursors when the workspace becomes empty', async () => {
    const a = vendorAttempt('yalispor');
    listMock.mockResolvedValue(attemptPage([a], 'attempt-cursor'));
    operationalMock.mockResolvedValue(operationalPage([operationalRow('yalispor')], 'operation-cursor'));
    eventsMock.mockResolvedValue(eventPage(a, 'private-event', 'event-cursor'));
    const view = scopedHistory(); await openHistory(); await screen.findByText(a.id);
    await userEvent.setup().click(screen.getByRole('button', { name: 'View 2 events' }));
    await screen.findByText(/private-event/);
    view.switchVendor('');
    expect(screen.getByText(/Select a Vendor in your workspace/)).toBeInTheDocument();
    expect(screen.queryByText(a.id)).not.toBeInTheDocument();
    expect(screen.queryByText('yalispor-current-safe-code')).not.toBeInTheDocument();
    expect(screen.queryByText(/private-event/)).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    await act(async () => {});
    expect(listMock).toHaveBeenCalledTimes(1); expect(operationalMock).toHaveBeenCalledTimes(1);
    expect(eventsMock).toHaveBeenCalledTimes(1);
  });

});
