import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes, useParams } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runtimeConfig } from '../config/runtime';
import { useAppReadiness } from '../lib/appReadiness';
import { clearCurrentUser, setSession } from '../lib/auth/session';
import { getCurrentVendorContext, setCurrentVendorId, verifyAdminVendorSelection } from '../lib/auth/vendorContext';
import type { OperationsAttentionDashboard, OperationsAttentionItem } from '../lib/api/contracts';
import { AdminOperationsQueuePage } from './AdminOperationsQueuePage';

const mocks = vi.hoisted(() => ({
  attention: vi.fn(), dashboard: vi.fn(), support: vi.fn(), status: vi.fn(), fallback: vi.fn(),
}));
vi.mock('../services/runtime-services', () => ({ runtimeServices: {
  operations: { attention: mocks.attention, dashboard: mocks.dashboard },
  support: { listAdminAttention: mocks.support },
  vendors: { status: mocks.status },
  orders: { adminVendorShippingConfig: mocks.fallback },
} }));

const initialApiMode = runtimeConfig.apiMode;
const vendorStatus = (vendorId: string) => ({ vendorId, vendorName: vendorId, status: 'active', restricted: false,
  restrictionReason: null, changedByUserId: null, changedByEmail: null, changedAt: null });
const admin = { email: 'admin@example.test', name: 'Admin', role: 'admin' as const,
  vendorAccess: [], vendorDetails: [], canSwitchVendors: false, defaultVendorId: '' };
const summary = { total: 0, critical: 0, warning: 0, info: 0, overdueSupport: 0, shipmentIssues: 0,
  returnBacklog: 0, financeReview: 0, vendorBlocked: 0, vendorRisks: 0 };

function attentionItem(type: 'return' | 'shipment' | 'vendor_blocked', vendorId: string, id: string): OperationsAttentionItem {
  return {
    id: `${type}-${id}`, type, severity: 'warning', vendorId, vendorName: vendorId,
    objectType: type, objectReference: id, objectId: id, status: 'pending', ageHours: 2,
    title: `${type} ${id}`, description: 'Needs review', recommendedAction: 'Open',
    destinationPath: type === 'return' ? `/returns/${id}` : type === 'shipment' ? `/orders/${id}` : `/admin/orders/${id}`,
    ...(type === 'shipment' ? { destinationVendorId: vendorId } : {}),
    createdAt: '2026-05-17T10:00:00.000Z',
  };
}

function setItems(items: OperationsAttentionItem[]) {
  const sections = ['vendor_blocked', 'support', 'shipment', 'return', 'finance'] as const;
  mocks.attention.mockResolvedValue({
    generatedAt: '2026-05-17T10:00:00.000Z', summary: { ...summary, total: items.length }, queue: items,
    sections: sections.map((key) => ({ key, title: key, count: items.filter((item) => item.type === key).length,
      critical: 0, warning: 0, items: items.filter((item) => item.type === key) })),
    recommendations: items.filter((item) => item.type === 'shipment').map((item) => ({
      id: `recommendation-${item.id}`, type: 'shipment_tracking' as const, severity: item.severity,
      title: `Recommendation ${item.id}`, description: item.description,
      recommendedAction: item.recommendedAction, relatedObjectType: item.objectType,
      relatedObjectId: item.objectId, vendor: { id: item.vendorId, name: item.vendorName },
      createdFromSignal: item.id, deepLink: item.destinationPath,
      destinationVendorId: item.destinationVendorId, vendorVisible: false, createdAt: item.createdAt,
    })), vendorRisks: [], recentActivity: items.map((item) => ({
      id: `activity-${item.id}`, type: item.type, severity: item.severity, vendorId: item.vendorId,
      vendorName: item.vendorName, destinationVendorId: item.destinationVendorId,
      title: item.title, description: item.description, occurredAt: item.createdAt,
      destinationPath: item.destinationPath,
    })),
  } satisfies OperationsAttentionDashboard);
}

function Destination({ kind }: { kind: string }) {
  const { id } = useParams();
  const readiness = useAppReadiness();
  return <main><h1>{kind} {id}</h1><p>Verified Vendor: {readiness.currentVendor.vendorId || 'none'}</p>
    <Link to="/admin/operations">Back to operations</Link></main>;
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}><MemoryRouter initialEntries={['/admin/operations']}>
    <Routes>
      <Route path="/admin/operations" element={<AdminOperationsQueuePage />} />
      <Route path="/returns/:id" element={<Destination kind="Return" />} />
      <Route path="/orders/:id" element={<Destination kind="Order" />} />
      <Route path="/admin/orders/:id" element={<Destination kind="Global Order" />} />
    </Routes>
  </MemoryRouter></QueryClientProvider>);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

async function open(label: string, index = 0) {
  fireEvent.click((await screen.findAllByRole('link', { name: label }))[index]!);
}

describe('Admin Operations verified Vendor navigation', () => {
  beforeEach(() => {
    Object.assign(runtimeConfig, { apiMode: 'real' });
    window.localStorage.clear();
    setSession('admin-token', admin);
    mocks.attention.mockReset(); mocks.dashboard.mockReset(); mocks.support.mockReset();
    mocks.status.mockReset(); mocks.fallback.mockReset();
    mocks.status.mockImplementation(async (id: string) => vendorStatus(id));
    mocks.dashboard.mockResolvedValue({ summary: { total: 0, critical: 0, warning: 0, attention: 0, normal: 0,
      pendingReassignment: 0, vendorBlocked: 0, awaitingShipment: 0, refundAttention: 0, financeReview: 0,
      financeIntegrityAlerts: 0, operationalSignals: 0, automationActions: 0 }, items: [] });
    mocks.support.mockResolvedValue({ items: [], total: 0 });
  });
  afterEach(() => { cleanup(); clearCurrentUser(); Object.assign(runtimeConfig, { apiMode: initialApiMode }); });

  it('switches from verified A to B before opening B Return, then back to A', async () => {
    setItems([attentionItem('return', 'vendor-b', 'return-b'), attentionItem('return', 'vendor-a', 'return-a')]);
    setCurrentVendorId('vendor-a');
    await verifyAdminVendorSelection((id) => Promise.resolve(vendorStatus(id)), async () => undefined);
    const pendingB = deferred<ReturnType<typeof vendorStatus>>();
    mocks.status.mockImplementation((id: string) => id === 'vendor-b' ? pendingB.promise : Promise.resolve(vendorStatus(id)));
    renderPage();
    await open('return return-b');
    expect(screen.getByRole('heading', { name: 'Operational attention center' })).toBeInTheDocument();
    expect(getCurrentVendorContext().vendorId).toBe('');
    await act(async () => pendingB.resolve(vendorStatus('vendor-b')));
    expect(await screen.findByRole('heading', { name: 'Return return-b' })).toBeInTheDocument();
    expect(screen.getByText('Verified Vendor: vendor-b')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: 'Back to operations' }));
    await open('return return-a');
    expect(await screen.findByRole('heading', { name: 'Return return-a' })).toBeInTheDocument();
    expect(screen.getByText('Verified Vendor: vendor-a')).toBeInTheDocument();
  });

  it('uses current allocation B for a historical Vendor A shipment Order', async () => {
    setItems([{ ...attentionItem('shipment', 'vendor-a', 'allocation-b'), destinationVendorId: 'vendor-b' }]);
    setCurrentVendorId('vendor-a');
    await verifyAdminVendorSelection((id) => Promise.resolve(vendorStatus(id)), async () => undefined);
    renderPage();
    await open('shipment allocation-b');
    expect(await screen.findByRole('heading', { name: 'Order allocation-b' })).toBeInTheDocument();
    expect(screen.getByText('Verified Vendor: vendor-b')).toBeInTheDocument();
  });

  it('uses current allocation ownership from the recommendation link as well', async () => {
    setItems([{ ...attentionItem('shipment', 'vendor-a', 'allocation-b'), destinationVendorId: 'vendor-b' }]);
    renderPage();
    fireEvent.click((await screen.findByText('Recommendation shipment-allocation-b')).closest('a')!);
    expect(await screen.findByRole('heading', { name: 'Order allocation-b' })).toBeInTheDocument();
    expect(screen.getByText('Verified Vendor: vendor-b')).toBeInTheDocument();
  });

  it('uses the current Return owner from the dedicated review queue', async () => {
    setItems([]);
    mocks.dashboard.mockImplementation(async (options: { type?: string }) => ({
      summary: { total: options?.type === 'return_review' ? 1 : 0, critical: 0, warning: 0, attention: 0,
        normal: 0, pendingReassignment: 0, vendorBlocked: 0, awaitingShipment: 0, refundAttention: 0,
        financeReview: 0, financeIntegrityAlerts: 0, operationalSignals: 0, automationActions: 0 },
      items: options?.type === 'return_review' ? [{
        id: 'return-b', type: 'refund_attention', severity: 'medium', title: 'Review Return',
        description: 'Needs review', vendorId: 'vendor-b', vendorName: 'Vendor B',
        relatedOrderId: 'allocation-b', relatedShopifyOrderNumber: '#1002', status: 'pending',
        createdAt: '2026-05-17T10:00:00.000Z', actionTo: '/returns/return-b',
      }] : [],
    }));
    renderPage();
    await open('Open return');
    expect(await screen.findByRole('heading', { name: 'Return return-b' })).toBeInTheDocument();
    expect(screen.getByText('Verified Vendor: vendor-b')).toBeInTheDocument();
  });

  it('navigates normally for the already verified destination Vendor', async () => {
    setItems([attentionItem('shipment', 'vendor-b', 'allocation-b')]);
    setCurrentVendorId('vendor-b');
    await verifyAdminVendorSelection((id) => Promise.resolve(vendorStatus(id)), async () => undefined);
    renderPage();
    await open('shipment allocation-b');
    expect(await screen.findByRole('heading', { name: 'Order allocation-b' })).toBeInTheDocument();
    expect(mocks.status).not.toHaveBeenCalled();
  });

  it('selects B when no Vendor was selected', async () => {
    setItems([attentionItem('return', 'vendor-b', 'return-b')]);
    renderPage();
    await open('return return-b');
    expect(await screen.findByRole('heading', { name: 'Return return-b' })).toBeInTheDocument();
    expect(screen.getByText('Verified Vendor: vendor-b')).toBeInTheDocument();
  });

  it('fails closed on missing destination ownership or verification failure', async () => {
    setItems([{ ...attentionItem('shipment', 'vendor-a', 'allocation-b'), destinationVendorId: null }]);
    renderPage();
    await open('shipment allocation-b');
    expect(screen.getByRole('alert')).toHaveTextContent('Vendor ownership');
    expect(mocks.status).not.toHaveBeenCalled();
    expect(getCurrentVendorContext().vendorId).toBe('');
  });

  it('keeps the safe screen when Vendor verification fails', async () => {
    setItems([attentionItem('return', 'vendor-b', 'return-b')]);
    mocks.status.mockRejectedValue(new Error('Unavailable'));
    renderPage();
    await open('return return-b');
    expect(await screen.findByRole('alert')).toHaveTextContent('Vendor verification failed');
    expect(screen.getByRole('heading', { name: 'Operational attention center' })).toBeInTheDocument();
    expect(getCurrentVendorContext().vendorId).toBe('');
  });

  it('ignores an older B verification after a newer A click', async () => {
    setItems([attentionItem('return', 'vendor-b', 'return-b'), attentionItem('return', 'vendor-a', 'return-a')]);
    const pendingB = deferred<ReturnType<typeof vendorStatus>>();
    mocks.status.mockImplementation((id: string) => id === 'vendor-b' ? pendingB.promise : Promise.resolve(vendorStatus(id)));
    renderPage();
    await open('return return-b');
    await open('return return-a');
    expect(await screen.findByRole('heading', { name: 'Return return-a' })).toBeInTheDocument();
    await act(async () => pendingB.resolve(vendorStatus('vendor-b')));
    expect(screen.getByRole('heading', { name: 'Return return-a' })).toBeInTheDocument();
    expect(screen.getByText('Verified Vendor: vendor-a')).toBeInTheDocument();
  });

  it('does not navigate after session loss during verification', async () => {
    setItems([attentionItem('return', 'vendor-b', 'return-b')]);
    const pendingB = deferred<ReturnType<typeof vendorStatus>>();
    mocks.status.mockReturnValue(pendingB.promise);
    renderPage();
    await open('return return-b');
    act(() => clearCurrentUser());
    await act(async () => pendingB.resolve(vendorStatus('vendor-b')));
    expect(screen.getByRole('heading', { name: 'Operational attention center' })).toBeInTheDocument();
  });

  it('leaves global Admin Shopify Order links global', async () => {
    setItems([attentionItem('vendor_blocked', 'vendor-b', 'shopify-1')]);
    renderPage();
    await open('vendor_blocked shopify-1');
    expect(await screen.findByRole('heading', { name: 'Global Order shopify-1' })).toBeInTheDocument();
    expect(mocks.status).not.toHaveBeenCalled();
    expect(getCurrentVendorContext().vendorId).toBe('');
  });

  it.each(['vendor', 'support', 'finance'] as const)('does not grant %s Admin switching authority', async (role) => {
    setSession(`${role}-token`, { ...admin, role, vendorAccess: ['vendor-a'],
      vendorDetails: [{ vendorId: 'vendor-a', vendorName: 'Vendor A' }], defaultVendorId: 'vendor-a' });
    setItems([attentionItem('return', 'vendor-b', 'return-b')]);
    renderPage();
    await open('return return-b');
    expect(screen.getByRole('alert')).toHaveTextContent('Admin session');
    expect(screen.getByRole('heading', { name: 'Operational attention center' })).toBeInTheDocument();
    expect(mocks.status).not.toHaveBeenCalled();
  });
});
