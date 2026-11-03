import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VendorInboxPage } from './VendorInboxPage';
import { VendorShell } from '../components/AppShell';
import { getCurrentVendorContext, setCurrentVendorId, setSession } from '../lib/auth';
import { queryClient as sharedQueryClient } from '../lib/api/queryClient';
import type { FinanceDashboard, OrderSummary, ReturnSummary, SupportTicket } from '../lib/api/contracts';

const appReadinessOverride = vi.hoisted(() => ({
  useActual: false,
  value: {
	    status: 'ready',
	    ready: true,
	    authConfirmed: true,
	    authRestorePhase: 'confirmed',
	    sessionReady: true,
    vendorReady: true,
    unauthorized: false,
    token: 'test-token',
    currentUser: {
      email: 'vendor@demo.com',
      name: 'Vendor User',
      role: 'vendor',
      vendorAccess: ['demo-vendor-a'],
      vendorDetails: [{ vendorId: 'demo-vendor-a', vendorName: 'Demo Vendor A' }],
      canSwitchVendors: false,
      defaultVendorId: 'demo-vendor-a',
    },
    currentVendor: {
      vendorId: 'demo-vendor-a',
      vendorName: 'Demo Vendor A',
    },
  },
}));
const listVendorSupportTicketsMock = vi.fn();
const listOrdersMock = vi.fn();
const listReturnsMock = vi.fn();
const getFinanceDashboardMock = vi.fn();

vi.mock('../lib/appReadiness', async () => {
  const actual = await vi.importActual<typeof import('../lib/appReadiness')>('../lib/appReadiness');
  return { ...actual, useAppReadiness: () => appReadinessOverride.useActual
    ? actual.useAppReadiness() : appReadinessOverride.value };
});

vi.mock('../features/support/api', () => ({
  listVendorSupportTickets: (...args: unknown[]) => listVendorSupportTicketsMock(...args),
}));

vi.mock('../features/orders/api', () => ({
  listOrders: (...args: unknown[]) => listOrdersMock(...args),
}));

vi.mock('../features/returns/api', () => ({
  listReturns: (...args: unknown[]) => listReturnsMock(...args),
}));

vi.mock('../features/finance/api', () => ({
  getFinanceDashboard: (...args: unknown[]) => getFinanceDashboardMock(...args),
}));

function renderVendorInboxPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <VendorInboxPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('VendorInboxPage', () => {
  beforeEach(() => {
    appReadinessOverride.useActual = false;
    appReadinessOverride.value = {
	      status: 'ready',
	      ready: true,
	      authConfirmed: true,
	      authRestorePhase: 'confirmed',
	      sessionReady: true,
      vendorReady: true,
      unauthorized: false,
      token: 'test-token',
      currentUser: {
        email: 'vendor@demo.com',
        name: 'Vendor User',
        role: 'vendor',
        vendorAccess: ['demo-vendor-a'],
        vendorDetails: [{ vendorId: 'demo-vendor-a', vendorName: 'Demo Vendor A' }],
        canSwitchVendors: false,
        defaultVendorId: 'demo-vendor-a',
      },
      currentVendor: {
        vendorId: 'demo-vendor-a',
        vendorName: 'Demo Vendor A',
      },
    };
    listVendorSupportTicketsMock.mockResolvedValue([]);
    listOrdersMock.mockResolvedValue([]);
    listReturnsMock.mockResolvedValue([]);
    getFinanceDashboardMock.mockResolvedValue({
      summary: {},
      transactions: [],
    });
  });

  afterEach(() => {
    cleanup();
    sharedQueryClient.clear();
    vi.clearAllMocks();
  });

  it('renders communication metric scope metadata', async () => {
    renderVendorInboxPage();

    const actionLabel = await screen.findByText('Action needed');
    const actionCard = actionLabel.closest('.op-kpi');

    expect(actionCard).toHaveTextContent('Communication events requiring action');
    expect(actionCard).toHaveAttribute(
      'title',
      expect.stringContaining('Scope: Communication events. Time window: Current vendor feed.'),
    );
  });

  it('renders missing vendor context as a terminal state instead of loading forever', async () => {
    appReadinessOverride.value = {
      ...appReadinessOverride.value,
      status: 'missing_vendor_context',
      ready: false,
      vendorReady: false,
      currentVendor: {
        vendorId: '',
        vendorName: 'All vendors',
      },
    };

    renderVendorInboxPage();

    expect(await screen.findByText('Select vendor')).toBeInTheDocument();
    expect(screen.queryByText('Loading communication center')).not.toBeInTheDocument();
    expect(listVendorSupportTicketsMock).not.toHaveBeenCalled();
    expect(listOrdersMock).not.toHaveBeenCalled();
    expect(listReturnsMock).not.toHaveBeenCalled();
    expect(getFinanceDashboardMock).not.toHaveBeenCalled();
  });

  it('hides Vendor A support, order, return, finance and selected link while Vendor B loads', async () => {
    appReadinessOverride.useActual = true;
    sharedQueryClient.clear();
    setSession('fixture-session', { email: 'admin@example.test', name: 'Fixture Admin', role: 'admin',
      vendorAccess: ['demo-vendor-a', 'demo-vendor-b'],
      vendorDetails: [
        { vendorId: 'demo-vendor-a', vendorName: 'Demo Vendor A' },
        { vendorId: 'demo-vendor-b', vendorName: 'Demo Vendor B' },
      ], canSwitchVendors: true, defaultVendorId: 'demo-vendor-a' });
    setCurrentVendorId('demo-vendor-a');
    function held<T>() {
      let resolve!: (value: T) => void;
      return { promise: new Promise<T>((done) => { resolve = done; }), resolve: (value: T) => resolve(value) };
    }
    const pendingSupport = held<SupportTicket[]>();
    const pendingOrders = held<OrderSummary[]>();
    const pendingReturns = held<ReturnSummary[]>();
    const pendingFinance = held<FinanceDashboard>();
    function ticket(vendorId: string, id: string, subject: string): SupportTicket {
      return { id, vendorId, vendorName: vendorId, createdAt: '2026-06-11T08:00:00Z',
        updatedAt: '2026-06-11T09:00:00Z', createdByUserId: 'fixture-admin', createdByRole: 'admin',
        subject, message: subject, priority: 'normal', status: 'OPEN', category: 'OTHER',
        assigneeUserId: null, assigneeName: null, vendorUnreadCount: 0, adminUnreadCount: 0,
        lastReplyAt: null, lastReplyByRole: null, firstResponseDueAt: null, nextResponseDueAt: null,
        escalatedAt: null, escalationReason: null, sla: null, contextType: null, contextId: null,
        contextSummary: null, resolvedAt: null, closedAt: null, replies: [] } as SupportTicket;
    }
    function order(vendorId: string, id: string, number: string): OrderSummary {
      return { originalVendorId: vendorId, assignedVendorId: vendorId, vendorId, id,
        sourceShopifyOrderId: `gid://shopify/Order/${number}`, sourceShopifyOrderNumber: number,
        status: 'Processing', allocationStatus: 'active', operationalActionability: { actionable: true, reason: null },
        reassignmentRequired: false, assignmentHistory: [], fulfillmentActionState: 'awaiting_shipment',
        fulfillmentActionAvailable: true, fulfillmentStatus: 'Processing', shippingStatus: 'Awaiting Shipment',
        lineItemCount: 1, date: '2026-06-11T08:00:00Z', customer: 'Fixture',
        amount: 'TRY 100', channel: 'Web' };
    }
    function returnRecord(vendorId: string, id: string, number: string): ReturnSummary {
      return { originalVendorId: vendorId, assignedVendorId: vendorId, vendorId, id,
        sourceShopifyOrderId: `gid://shopify/Order/${number}`, sourceShopifyOrderNumber: number,
        sourceShopifyRefundId: '', sourceType: 'shopify_return_request', status: 'Requested',
        relatedOrderId: `order-${number}`, date: '2026-06-11T08:00:00Z', customer: 'Fixture',
        reason: 'Return requested', amount: 'TRY 30' };
    }
    function financeData(id: string, amount: string): FinanceDashboard {
      return { summary: {} as FinanceDashboard['summary'], transactions: [{ id, amount,
        date: '2026-06-11T08:00:00Z', description: 'Fixture refund', counterparty: 'Fixture',
        category: 'Refund', status: 'Pending' }] };
    }
    listVendorSupportTicketsMock.mockImplementation(() => getCurrentVendorContext().vendorId === 'demo-vendor-a'
      ? Promise.resolve([ticket('demo-vendor-a', 'support-a', 'A-only support')]) : pendingSupport.promise);
    listOrdersMock.mockImplementation(({ vendorId }: { vendorId: string }) => vendorId === 'demo-vendor-a'
      ? Promise.resolve([order(vendorId, 'order-a', 'A-101')]) : pendingOrders.promise);
    listReturnsMock.mockImplementation(({ vendorId }: { vendorId: string }) => vendorId === 'demo-vendor-a'
      ? Promise.resolve([returnRecord(vendorId, 'return-a', 'A-303')]) : pendingReturns.promise);
    getFinanceDashboardMock.mockImplementation(({ vendorId }: { vendorId: string }) => vendorId === 'demo-vendor-a'
      ? Promise.resolve(financeData('finance-a', 'TRY 444')) : pendingFinance.promise);
    render(<QueryClientProvider client={sharedQueryClient}><MemoryRouter initialEntries={['/support/inbox']}>
      <Routes><Route element={<VendorShell />}><Route path="/support/inbox" element={<VendorInboxPage />} /></Route></Routes>
    </MemoryRouter></QueryClientProvider>);
    expect(await screen.findByRole('heading', { name: 'A-only support' })).toBeInTheDocument();
    expect(screen.getByText(/#A-101 is awaiting shipment progress/)).toBeInTheDocument();
    expect(screen.getByText(/#A-303/)).toBeInTheDocument();
    expect(screen.getByText(/TRY 444/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open linked record' })).toHaveAttribute('href', '/support/support-a');
    fireEvent.click(screen.getByRole('button', { name: /Demo Vendor A.*Admin view/i }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Select vendor' }), { target: { value: 'demo-vendor-b' } });
    await waitFor(() => expect(getCurrentVendorContext().vendorId).toBe('demo-vendor-b'));
    expect(screen.queryByRole('heading', { name: 'A-only support' })).not.toBeInTheDocument();
    expect(screen.queryByText(/#A-101 is awaiting shipment progress/)).not.toBeInTheDocument();
    expect(screen.queryByText(/#A-303/)).not.toBeInTheDocument();
    expect(screen.queryByText(/TRY 444/)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open linked record' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'Select vendor' }), { target: { value: 'demo-vendor-a' } });
    expect(await screen.findByRole('heading', { name: 'A-only support' })).toBeInTheDocument();
    await act(async () => {
      pendingSupport.resolve([ticket('demo-vendor-b', 'support-b', 'B-only support')]);
      pendingOrders.resolve([order('demo-vendor-b', 'order-b', 'B-202')]);
      pendingReturns.resolve([returnRecord('demo-vendor-b', 'return-b', 'B-404')]);
      pendingFinance.resolve(financeData('finance-b', 'TRY 555'));
    });
    expect(screen.getByRole('heading', { name: 'A-only support' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'B-only support' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'Select vendor' }), { target: { value: 'demo-vendor-b' } });
    expect(await screen.findByRole('heading', { name: 'B-only support' })).toBeInTheDocument();
    expect(screen.getByText(/#B-202 is awaiting shipment progress/)).toBeInTheDocument();
    expect(screen.getByText(/#B-404/)).toBeInTheDocument();
    expect(screen.getByText(/TRY 555/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open linked record' })).toHaveAttribute('href', '/support/support-b');
    expect(screen.queryByRole('heading', { name: 'A-only support' })).not.toBeInTheDocument();
    expect(screen.queryByText(/TRY 444/)).not.toBeInTheDocument();
  });
});
