import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runtimeConfig } from '../config/runtime';
import { useAppReadiness } from '../lib/appReadiness';
import { clearCurrentUser, setSession } from '../lib/auth/session';
import { getCurrentVendorContext, setCurrentVendorId, verifyAdminVendorSelection } from '../lib/auth/vendorContext';
import type { SupportTicket } from '../lib/api/contracts';
import { SupportTicketDetailPage } from './SupportTicketDetailPage';

const mocks = vi.hoisted(() => ({ detail: vi.fn(), status: vi.fn(), fallback: vi.fn() }));
vi.mock('../features/support/api', async () => {
  const actual = await vi.importActual<typeof import('../features/support/api')>('../features/support/api');
  return { ...actual, getAdminSupportTicket: (id: string) => mocks.detail(id) };
});
vi.mock('../services/runtime-services', () => ({ runtimeServices: {
  vendors: { status: mocks.status }, orders: { adminVendorShippingConfig: mocks.fallback },
} }));

const initialApiMode = runtimeConfig.apiMode;
const admin = { email: 'admin@example.test', name: 'Admin', role: 'admin' as const,
  vendorAccess: [], vendorDetails: [], canSwitchVendors: false, defaultVendorId: '' };
const vendorStatus = (id: string) => ({ vendorId: id, vendorName: id, status: 'active', restricted: false,
  restrictionReason: null, changedByUserId: null, changedByEmail: null, changedAt: null });

function ticket(overrides: Partial<SupportTicket> = {}): SupportTicket {
  return {
    id: 'ticket-b', createdAt: '2026-05-16T10:00:00.000Z', updatedAt: '2026-05-16T10:00:00.000Z',
    createdByUserId: 'vendor-b-user', createdByRole: 'vendor', vendorId: 'vendor-b', vendorName: 'Vendor B',
    subject: 'Vendor B ticket', message: 'Help', priority: 'normal', status: 'OPEN', category: 'ORDER',
    assigneeUserId: null, assigneeName: null, vendorUnreadCount: 0, adminUnreadCount: 0,
    lastReplyAt: null, lastReplyByRole: null, firstResponseDueAt: null, nextResponseDueAt: null,
    escalatedAt: null, escalationReason: null, sla: null, contextType: 'order', contextId: 'allocation-b',
    contextSummary: { orderNumber: '#B' }, contextSnapshot: { orderNumber: '#B' },
    resolvedAt: null, closedAt: null, notes: [], replies: [], ...overrides,
  };
}

function Destination({ kind }: { kind: string }) {
  const { id } = useParams();
  const location = useLocation();
  const readiness = useAppReadiness();
  return <main><h1>{kind} {id ?? new URLSearchParams(location.search).get('ledgerId')}</h1>
    <p>Verified Vendor: {readiness.currentVendor.vendorId || 'none'}</p></main>;
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/admin/support/ticket-b']}>
    <Routes>
      <Route path="/admin/support/:ticketId" element={<SupportTicketDetailPage />} />
      <Route path="/orders/:id" element={<Destination kind="Order" />} />
      <Route path="/returns/:id" element={<Destination kind="Return" />} />
      <Route path="/finance" element={<Destination kind="Finance" />} />
    </Routes>
  </MemoryRouter></QueryClientProvider>);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function open(href: string) {
  await screen.findByRole('heading', { name: 'Vendor B ticket' });
  const link = document.querySelector(`a[href="${href}"]`);
  expect(link).not.toBeNull();
  fireEvent.click(link!);
}

describe('Admin Support verified Vendor navigation', () => {
  beforeEach(() => {
    Object.assign(runtimeConfig, { apiMode: 'real' });
    window.localStorage.clear();
    setSession('admin-token', admin);
    mocks.detail.mockReset(); mocks.status.mockReset(); mocks.fallback.mockReset();
    mocks.status.mockImplementation(async (id: string) => vendorStatus(id));
  });
  afterEach(() => { cleanup(); clearCurrentUser(); Object.assign(runtimeConfig, { apiMode: initialApiMode }); });

  it('waits for B verification before opening B Order from selected A', async () => {
    setCurrentVendorId('vendor-a');
    await verifyAdminVendorSelection(async (id) => vendorStatus(id), async () => undefined);
    const pending = deferred<ReturnType<typeof vendorStatus>>();
    mocks.status.mockReturnValue(pending.promise);
    mocks.detail.mockResolvedValue(ticket());
    renderPage();
    await open('/orders/allocation-b');
    expect(screen.getByRole('heading', { name: 'Vendor B ticket' })).toBeInTheDocument();
    expect(getCurrentVendorContext().vendorId).toBe('');
    await act(async () => pending.resolve(vendorStatus('vendor-b')));
    expect(await screen.findByRole('heading', { name: 'Order allocation-b' })).toBeInTheDocument();
    expect(screen.getByText('Verified Vendor: vendor-b')).toBeInTheDocument();
  });

  it('opens B Return and B Finance ledger under verified B, preserving the ledger ID', async () => {
    mocks.detail.mockResolvedValue(ticket({ contextType: 'return', contextId: 'return-b', category: 'REFUND',
      contextSnapshot: { financeLedgerEntryId: 'ledger-b' } }));
    setCurrentVendorId('vendor-a');
    renderPage();
    await open('/returns/return-b');
    expect(await screen.findByRole('heading', { name: 'Return return-b' })).toBeInTheDocument();
    expect(screen.getByText('Verified Vendor: vendor-b')).toBeInTheDocument();
  });

  it('opens Finance ledger under B after switching from A', async () => {
    mocks.detail.mockResolvedValue(ticket({ category: 'REFUND', contextSnapshot: { financeLedgerEntryId: 'ledger-b' } }));
    setCurrentVendorId('vendor-a');
    renderPage();
    await open('/finance?ledgerId=ledger-b');
    expect(await screen.findByRole('heading', { name: 'Finance ledger-b' })).toBeInTheDocument();
    expect(screen.getByText('Verified Vendor: vendor-b')).toBeInTheDocument();
  });

  it('navigates directly when B is already verified', async () => {
    setCurrentVendorId('vendor-b');
    await verifyAdminVendorSelection(async (id) => vendorStatus(id), async () => undefined);
    mocks.detail.mockResolvedValue(ticket());
    renderPage();
    await open('/orders/allocation-b');
    expect(await screen.findByRole('heading', { name: 'Order allocation-b' })).toBeInTheDocument();
    expect(mocks.status).not.toHaveBeenCalled();
  });

  it('does not navigate when B verification is unavailable', async () => {
    mocks.detail.mockResolvedValue(ticket());
    mocks.status.mockRejectedValue(new Error('Unavailable'));
    renderPage();
    await open('/orders/allocation-b');
    expect(await screen.findByText('Vendor verification failed. Retry by opening the record again.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Vendor B ticket' })).toBeInTheDocument();
    expect(getCurrentVendorContext().vendorId).toBe('');
  });

  it('does not guess a Vendor when ticket ownership is missing', async () => {
    mocks.detail.mockResolvedValue(ticket({ vendorId: '' }));
    renderPage();
    await open('/orders/allocation-b');
    expect(screen.getByText('This record cannot be opened until its Vendor ownership and Admin session are available.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Vendor B ticket' })).toBeInTheDocument();
    expect(mocks.status).not.toHaveBeenCalled();
  });

  it('keeps the Support ticket open when Admin cannot authorize the target Vendor', async () => {
    mocks.detail.mockResolvedValue(ticket());
    mocks.status.mockRejectedValue({ status: 403 });
    renderPage();
    await open('/orders/allocation-b');
    expect(await screen.findByText('Vendor verification failed. Retry by opening the record again.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Vendor B ticket' })).toBeInTheDocument();
    expect(mocks.fallback).not.toHaveBeenCalled();
  });

  it('ignores an older Order click when Finance is clicked next', async () => {
    const pending = deferred<ReturnType<typeof vendorStatus>>();
    mocks.status.mockImplementationOnce(() => pending.promise).mockImplementation(async (id: string) => vendorStatus(id));
    mocks.detail.mockResolvedValue(ticket({ category: 'REFUND', contextSnapshot: { financeLedgerEntryId: 'ledger-b' } }));
    renderPage();
    await open('/orders/allocation-b');
    await open('/finance?ledgerId=ledger-b');
    expect(await screen.findByRole('heading', { name: 'Finance ledger-b' })).toBeInTheDocument();
    await act(async () => pending.resolve(vendorStatus('vendor-b')));
    expect(screen.getByRole('heading', { name: 'Finance ledger-b' })).toBeInTheDocument();
    expect(screen.getByText('Verified Vendor: vendor-b')).toBeInTheDocument();
  });

  it('stops pending navigation after session loss', async () => {
    const pending = deferred<ReturnType<typeof vendorStatus>>();
    mocks.status.mockReturnValue(pending.promise);
    mocks.detail.mockResolvedValue(ticket());
    renderPage();
    await open('/orders/allocation-b');
    act(() => clearCurrentUser());
    await act(async () => pending.resolve(vendorStatus('vendor-b')));
    expect(screen.queryByRole('heading', { name: 'Order allocation-b' })).not.toBeInTheDocument();
  });
});
