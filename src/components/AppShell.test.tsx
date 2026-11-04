import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminShell, VendorShell } from './AppShell';
import {
  clearAuthRestoreState,
  getAuthRestoreSnapshot,
  getCurrentUser,
  getCurrentVendorContext,
  getToken,
  markAuthConfirmed,
  setCurrentVendorId,
  setSession,
  type CurrentUser,
} from '../lib/auth';
import { clearCsrfToken, setCsrfToken } from '../lib/api-client';
import { queryClient } from '../lib/api/queryClient';
import { runtimeServices } from '../services/runtime-services';
import { runtimeConfig } from '../config/runtime';
import { readSessionTransition } from '../lib/auth/sessionTransition';

vi.mock('../lib/api-client', async () => {
  const actual = await vi.importActual<typeof import('../lib/api-client')>('../lib/api-client');
  return {
    ...actual,
    clearCsrfToken: vi.fn(actual.clearCsrfToken),
  };
});

vi.mock('../services/runtime-services', () => ({
  runtimeServices: {
    auth: {
      logout: vi.fn(() => Promise.resolve()),
    },
    vendors: {
      status: vi.fn(),
      directory: vi.fn(),
    },
    orders: {
      adminVendorShippingConfig: vi.fn(),
    },
  },
}));

const logoutMock = vi.mocked(runtimeServices.auth.logout);
const vendorStatusMock = vi.mocked(runtimeServices.vendors.status);
const vendorDirectoryMock = vi.mocked(runtimeServices.vendors.directory);
const shippingConfigMock = vi.mocked(runtimeServices.orders.adminVendorShippingConfig);
const clearCsrfTokenMock = vi.mocked(clearCsrfToken);
const logoutQueryKey = ['logout-ordering-test'] as const;
const initialApiMode = runtimeConfig.apiMode;

function directoryVendor(vendorId: string, vendorName: string) {
  return { vendorId, vendorName, status: 'active', statusLabel: 'Active' as const, restrictionReason: null,
    restrictedAt: null, updatedAt: '', createdAt: '', profileUrl: `/admin/vendors/${vendorId}` };
}

function directoryPage(vendors: ReturnType<typeof directoryVendor>[], nextCursor: string | null = null) {
  return { vendors, hasMore: Boolean(nextCursor), nextCursor, generatedAt: '',
    filters: { search: null, status: 'all' as const, limit: 100 } };
}

const adminUser: CurrentUser = {
  email: 'admin@example.com',
  name: 'Admin User',
  role: 'admin',
  status: 'active',
  vendorAccess: ['yalispor'],
  vendorDetails: [{ vendorId: 'yalispor', vendorName: 'Yalı Spor' }],
  canSwitchVendors: false,
  defaultVendorId: 'yalispor',
};

const multiVendorAdminUser: CurrentUser = {
  ...adminUser,
  vendorAccess: ['yalispor', 'demo-vendor-b'],
  vendorDetails: [
    { vendorId: 'yalispor', vendorName: 'Yalı Spor' },
    { vendorId: 'demo-vendor-b', vendorName: 'Demo Vendor B' },
  ],
  canSwitchVendors: true,
};

const vendorUser: CurrentUser = {
  email: 'vendor@example.com',
  name: 'Vendor User',
  role: 'vendor',
  status: 'active',
  vendorAccess: ['yalispor'],
  vendorDetails: [{ vendorId: 'yalispor', vendorName: 'Yalı Spor' }],
  canSwitchVendors: false,
  defaultVendorId: 'yalispor',
};

const restrictedVendorUser: CurrentUser = {
  ...vendorUser,
  vendorDetails: [
    {
      vendorId: 'yalispor',
      vendorName: 'Yalı Spor',
      status: 'inactive',
      restrictionReason: 'Operational review',
    },
  ],
};

const sharedWorkspaceRoles: CurrentUser['role'][] = ['admin', 'vendor', 'support', 'finance'];

function seedSession(user: CurrentUser) {
  setSession('test-session', user);
  setCurrentVendorId(user.defaultVendorId);
  markAuthConfirmed({ restoreAttemptId: 'restore-test' });
}

function seedLogoutState(user: CurrentUser) {
  seedSession(user);
  setCsrfToken('logout-csrf-token');
  queryClient.setQueryData(logoutQueryKey, { preserved: true });
}

function createDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function renderShell(initialEntry: string) {
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route element={<VendorShell />}>
          <Route path="/" element={<div>Vendor dashboard content</div>} />
          <Route path="/orders" element={<div>Orders workspace content</div>} />
          <Route path="/returns" element={<div>Returns workspace content</div>} />
          <Route path="/finance" element={<div>Finance workspace content</div>} />
          <Route path="/support" element={<div>Support workspace content</div>} />
          <Route path="/support/:ticketId" element={<div>Support ticket content</div>} />
          <Route path="/support/inbox" element={<div>Inbox workspace content</div>} />
          <Route path="/vendor/profile" element={<div>Settings workspace content</div>} />
        </Route>
        <Route element={<AdminShell />}>
          <Route path="/admin/operations" element={<div>Admin operations content</div>} />
          <Route path="/admin/finance/settlement-schedules" element={<div>Scheduled settlements queue content</div>} />
          <Route path="/admin/vendors" element={<div>Vendor directory content</div>} />
          <Route path="/admin/vendors/new" element={<div>Create vendor content</div>} />
          <Route path="/admin/vendors/:vendorId" element={<div>Admin vendor profile content</div>} />
        </Route>
        <Route path="/login" element={<div>Login screen</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

async function openAccountMenu(user: ReturnType<typeof userEvent.setup>) {
  const trigger = screen.getByRole('button', { name: /Yalı Spor/i });
  await user.click(trigger);
  return screen.getByRole('menu', { name: 'Account menu' });
}

beforeEach(() => {
  logoutMock.mockResolvedValue(undefined);
  vendorDirectoryMock.mockReset();
  vendorStatusMock.mockReset();
  vendorDirectoryMock.mockResolvedValue(directoryPage([
    directoryVendor('yalispor', 'Yalı Spor'), directoryVendor('sporjinal', 'Sporjinal'),
  ]));
  vendorStatusMock.mockImplementation(async (vendorId) => ({
    vendorId, vendorName: vendorId === 'yalispor' ? 'Yalı Spor' : vendorId === 'sporjinal' ? 'Sporjinal' : vendorId,
    status: 'active', restricted: false, restrictionReason: null,
    changedByUserId: null, changedByEmail: null, changedAt: null,
  }));
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  queryClient.clear();
  clearAuthRestoreState();
  clearCsrfToken();
  vi.clearAllMocks();
  Object.assign(runtimeConfig, { apiMode: initialApiMode });
});

describe('AppShell workspace navigation', () => {
  it('keeps Vendor Workspace pages unmounted until the Admin target is verified', async () => {
    Object.assign(runtimeConfig, { apiMode: 'real' });
    const pending = createDeferred();
    vendorStatusMock.mockImplementationOnce(async (vendorId) => {
      await pending.promise;
      return { vendorId, vendorName: 'Sporjinal', status: 'active', restricted: false,
        restrictionReason: null, changedByUserId: null, changedByEmail: null, changedAt: null };
    });
    seedSession({ ...adminUser, vendorAccess: [], vendorDetails: [], canSwitchVendors: false, defaultVendorId: '' });
    setCurrentVendorId('sporjinal');
    renderShell('/orders');
    expect(screen.getByText('Select and verify a Vendor to open the Vendor workspace.')).toBeInTheDocument();
    expect(screen.queryByText('Orders workspace content')).not.toBeInTheDocument();
    pending.resolve();
    expect(await screen.findByText('Orders workspace content')).toBeInTheDocument();
  });

  it('keeps a zero-membership Admin selection pending until exact-ID verification, then shows its identity', async () => {
    Object.assign(runtimeConfig, { apiMode: 'real' });
    const pending = createDeferred();
    vendorStatusMock.mockImplementationOnce(async (vendorId) => {
      await pending.promise;
      return { vendorId, vendorName: 'Sporjinal', status: 'active', restricted: false,
        restrictionReason: null, changedByUserId: null, changedByEmail: null, changedAt: null };
    });
    seedSession({ ...adminUser, vendorAccess: [], vendorDetails: [], canSwitchVendors: false, defaultVendorId: '' });
    setCurrentVendorId('sporjinal');
    renderShell('/admin/operations');

    expect(vendorStatusMock).toHaveBeenCalledWith('sporjinal');
    expect(getCurrentVendorContext().vendorId).toBe('');
    expect(screen.getByText('Admin operations content')).toBeInTheDocument();
    expect(screen.queryByText('Vendor Yalı Spor')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Select vendor: sporjinal' })).toBeDisabled();
    pending.resolve();
    await waitFor(() => expect(getCurrentVendorContext().vendorId).toBe('sporjinal'));
    expect(screen.getByText('Vendor Sporjinal')).toBeInTheDocument();
    expect(shippingConfigMock).not.toHaveBeenCalled();
  });

  it('does not issue an unfiltered Admin selection request when no Vendor is selected', () => {
    Object.assign(runtimeConfig, { apiMode: 'real' });
    seedSession({ ...adminUser, vendorAccess: [], vendorDetails: [], canSwitchVendors: false, defaultVendorId: '' });
    renderShell('/admin/operations');
    expect(screen.getByText('Admin operations content')).toBeInTheDocument();
    expect(getCurrentVendorContext().vendorId).toBe('');
    expect(vendorStatusMock).not.toHaveBeenCalled();
    expect(shippingConfigMock).not.toHaveBeenCalled();
  });

  it('lets a zero-membership Admin select an unassigned Vendor while verification stays fail-closed', async () => {
    Object.assign(runtimeConfig, { apiMode: 'real' });
    const pending = createDeferred();
    vendorStatusMock.mockImplementationOnce(async (vendorId) => {
      await pending.promise;
      return { vendorId, vendorName: 'Sporjinal', status: 'active', restricted: false,
        restrictionReason: null, changedByUserId: null, changedByEmail: null, changedAt: null };
    });
    seedSession({ ...adminUser, vendorAccess: [], vendorDetails: [], canSwitchVendors: false, defaultVendorId: '' });
    renderShell('/orders');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /No vendor selected/i }));
    await user.click(within(screen.getByRole('menu', { name: 'Account menu' })).getByRole('button', { name: 'Choose Vendor' }));
    await user.click(await screen.findByRole('option', { name: /Sporjinal.*sporjinal/ }));
    expect(getCurrentVendorContext().vendorId).toBe('');
    expect(screen.queryByText('Orders workspace content')).not.toBeInTheDocument();
    expect(vendorStatusMock).toHaveBeenCalledWith('sporjinal');
    await user.click(screen.getByRole('button', { name: /Admin view/ }));
    expect(within(screen.getByRole('menu', { name: 'Account menu' })).getByRole('status')).toHaveTextContent('Verifying selected Vendor');
    pending.resolve();
    expect(await screen.findByText('Orders workspace content')).toBeInTheDocument();
    expect(getCurrentVendorContext().vendorId).toBe('sporjinal');
  });

  it('reaches an unassigned Vendor on a later directory page without changing the current selection', async () => {
    Object.assign(runtimeConfig, { apiMode: 'real' });
    vendorDirectoryMock.mockImplementation(async (options) => options.cursor === 'page-two'
      ? directoryPage([directoryVendor('sporjinal', 'Sporjinal')])
      : directoryPage([directoryVendor('yalispor', 'Yalı Spor')], 'page-two'));
    seedSession(adminUser);
    renderShell('/admin/operations');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Select vendor: Yalı Spor/ }));
    expect(await screen.findByRole('button', { name: 'Next Vendors' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Next Vendors' }));
    expect(screen.getByRole('button', { name: /Select vendor: Yalı Spor/ })).toBeInTheDocument();
    const option = await screen.findByRole('option', { name: /Sporjinal.*sporjinal/ });
    expect(vendorDirectoryMock).toHaveBeenCalledWith(expect.objectContaining({ cursor: 'page-two' }));
    await user.click(option);
    expect(await screen.findByText('Vendor Sporjinal')).toBeInTheDocument();
    expect(vendorStatusMock).toHaveBeenCalledWith('sporjinal');
  });

  it('switches Admin Vendor A to unassigned B and back to A through one directory selector', async () => {
    Object.assign(runtimeConfig, { apiMode: 'real' });
    seedSession(adminUser);
    renderShell('/admin/operations');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Select vendor: Yalı Spor/ }));
    await user.click(await screen.findByRole('option', { name: /Sporjinal.*sporjinal/ }));
    await waitFor(() => expect(getCurrentVendorContext().vendorId).toBe('sporjinal'));
    await user.click(screen.getByRole('button', { name: /Select vendor: Sporjinal/ }));
    await user.click(await screen.findByRole('option', { name: /Yalı Spor.*yalispor/ }));
    await waitFor(() => expect(getCurrentVendorContext().vendorId).toBe('yalispor'));
    expect(vendorStatusMock).toHaveBeenCalledWith('sporjinal');
    expect(vendorStatusMock).toHaveBeenCalledWith('yalispor');
    expect(vendorStatusMock).toHaveBeenCalledTimes(3);
    expect(vendorDirectoryMock).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole('button', { name: /Select vendor:/ })).toHaveLength(1);
  });

  it('searches the backend beyond the first directory page and keeps the selected Vendor on an empty result', async () => {
    Object.assign(runtimeConfig, { apiMode: 'real' });
    vendorDirectoryMock.mockImplementation(async (options) => options.search === 'Spor'
      ? directoryPage([directoryVendor('sporjinal', 'Sporjinal')])
      : options.search === 'none' ? directoryPage([])
        : directoryPage([directoryVendor('yalispor', 'Yalı Spor')], 'page-two'));
    seedSession(adminUser);
    renderShell('/admin/operations');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Select vendor: Yalı Spor/ }));
    await user.type(screen.getByLabelText('Search vendors'), 'Spor');
    await screen.findByRole('option', { name: /Sporjinal.*sporjinal/ });
    expect(vendorDirectoryMock).toHaveBeenCalledWith(expect.objectContaining({ search: 'Spor', cursor: null }));
    await user.clear(screen.getByLabelText('Search vendors'));
    await user.type(screen.getByLabelText('Search vendors'), 'none');
    expect(await screen.findByText('No Vendors found.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Select vendor: Yalı Spor/ })).toBeInTheDocument();
    expect(getCurrentVendorContext().vendorId).toBe('yalispor');
  });

  it('rejects an obsolete directory response after a search A to B to A cycle', async () => {
    Object.assign(runtimeConfig, { apiMode: 'real' });
    let resolveFirst!: (value: ReturnType<typeof directoryPage>) => void;
    let emptySearchCalls = 0;
    vendorDirectoryMock.mockImplementation((options) => {
      if (options.search === 'Spor') return Promise.resolve(directoryPage([directoryVendor('sporjinal', 'Sporjinal')]));
      emptySearchCalls += 1;
      if (emptySearchCalls === 1) return new Promise((resolve) => { resolveFirst = resolve; });
      return Promise.resolve(directoryPage([directoryVendor('yalispor', 'Yalı Spor')]));
    });
    seedSession({ ...adminUser, vendorAccess: [], vendorDetails: [], defaultVendorId: '' });
    renderShell('/admin/operations');
    await userEvent.setup().click(screen.getByRole('button', { name: /Select vendor: Select a Vendor/ }));
    const search = screen.getByLabelText('Search vendors');
    fireEvent.change(search, { target: { value: 'Spor' } });
    await screen.findByRole('option', { name: /Sporjinal.*sporjinal/ });
    fireEvent.change(search, { target: { value: '' } });
    await screen.findByRole('option', { name: /Yalı Spor.*yalispor/ });
    await act(async () => resolveFirst(directoryPage([directoryVendor('old-sporjinal', 'Old Sporjinal')])));
    expect(screen.queryByRole('option', { name: /Old Sporjinal/ })).not.toBeInTheDocument();
    expect(emptySearchCalls).toBe(2);
  });

  it('keeps directory failures distinct from empty results and retries without a Vendor fallback', async () => {
    Object.assign(runtimeConfig, { apiMode: 'real' });
    vendorDirectoryMock.mockRejectedValueOnce(new Error('temporary directory failure'));
    seedSession({ ...adminUser, vendorAccess: [], vendorDetails: [], defaultVendorId: '' });
    renderShell('/admin/operations');
    await userEvent.setup().click(screen.getByRole('button', { name: /Select vendor: Select a Vendor/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Vendor directory failed.');
    expect(screen.queryByText('No Vendors found.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Select vendor: Select a Vendor/ })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByRole('option', { name: /Sporjinal.*sporjinal/ });
    expect(vendorDirectoryMock).toHaveBeenCalledTimes(2);
  });

  it('does not request the Admin directory for Vendor accounts', () => {
    Object.assign(runtimeConfig, { apiMode: 'real' });
    seedSession(vendorUser);
    renderShell('/orders');
    expect(vendorDirectoryMock).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Search vendors')).not.toBeInTheDocument();
  });

  it('retains the Admin selection on a temporary error and retries without a fallback Vendor', async () => {
    Object.assign(runtimeConfig, { apiMode: 'real' });
    vendorStatusMock.mockRejectedValueOnce({ status: 503 });
    seedSession(adminUser);
    setCurrentVendorId('sporjinal');
    renderShell('/admin/operations');
    const retry = await screen.findByRole('button', { name: 'Vendor verification failed. Retry' });
    expect(getCurrentVendorContext().vendorId).toBe('');
    expect(window.localStorage.getItem('vendor-dashboard.current-vendor-id')).toBe('sporjinal');
    expect(screen.queryByText('Vendor Yalı Spor')).not.toBeInTheDocument();
    await userEvent.setup().click(retry);
    await waitFor(() => expect(getCurrentVendorContext().vendorId).toBe('sporjinal'));
    expect(vendorStatusMock).toHaveBeenCalledTimes(2);
    expect(shippingConfigMock).not.toHaveBeenCalled();
  });
  it('keeps Admin identity and full-width vendor controls after navigation in the intended order', async () => {
    Object.assign(runtimeConfig, { apiMode: 'real' });
    const user = userEvent.setup();
    const longName = 'A long selected Vendor name that must remain within the Admin sidebar';
    vendorDirectoryMock.mockResolvedValue(directoryPage([
      directoryVendor('yalispor', longName), directoryVendor('demo-vendor-b', 'Demo Vendor B'),
    ]));
    vendorStatusMock.mockImplementation(async (vendorId) => ({
      vendorId, vendorName: vendorId === 'demo-vendor-b' ? 'Demo Vendor B' : longName,
      status: 'active', restricted: false, restrictionReason: null,
      changedByUserId: null, changedByEmail: null, changedAt: null,
    }));
    seedSession({ ...multiVendorAdminUser, vendorDetails: [
      { vendorId: 'yalispor', vendorName: longName },
      { vendorId: 'demo-vendor-b', vendorName: 'Demo Vendor B' },
    ] });
    renderShell('/admin/operations');
    const sidebar = screen.getByRole('navigation', { name: 'Admin tools' }).closest('aside')!;
    const card = within(sidebar).getByText('Admin User').closest('.vendor-account-card')!;
    expect(card.previousElementSibling).toBe(sidebar.querySelector('.nav-group'));
    const vendor = within(sidebar).getByRole('button', { name: `Select vendor: ${longName}` });
    expect(vendor.closest('.vendor-selector')).toHaveClass('vendor-selector--dark');
    expect(within(vendor).getByText('yalispor')).toBeInTheDocument();
    expect(within(sidebar).queryByRole('combobox', { name: 'Search vendors' })).not.toBeInTheDocument();
    const workspace = within(sidebar).getByLabelText('Workspace');
    const logout = within(sidebar).getByRole('button', { name: /Log out/i });
    expect(vendor.compareDocumentPosition(workspace) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(workspace.compareDocumentPosition(logout) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(sidebar).getAllByRole('button', { name: /Select vendor:/ })).toHaveLength(1);
    expect(within(sidebar).getAllByLabelText('Workspace')).toHaveLength(1);
    expect(card.querySelector('.vendor-account-avatar')).toBeNull();
    await user.click(vendor);
    await user.click(await screen.findByRole('option', { name: /Demo Vendor B.*demo-vendor-b/ }));
    expect(getCurrentVendorContext().vendorId).toBe('demo-vendor-b');
    expect(within(sidebar).getByRole('button', { name: 'Select vendor: Demo Vendor B' })).toBeInTheDocument();
  });
  it.each(sharedWorkspaceRoles)('shows the canonical Support navigation for %s workspace users', (role) => {
    seedSession({
      ...vendorUser,
      email: `${role}@example.com`,
      name: `${role} User`,
      role,
    });

    renderShell('/support');

    const primaryNav = screen.getByRole('navigation', { name: 'Primary' });
    const supportLink = within(primaryNav).getByRole('link', { name: 'Support' });
    expect(supportLink).toHaveAttribute('href', '/support');
    expect(supportLink).toHaveAttribute('aria-current', 'page');
    expect(within(primaryNav).queryByRole('link', { name: 'Inbox' })).not.toBeInTheDocument();
  });

  it('keeps Support navigation active on ticket detail routes', () => {
    seedSession(vendorUser);

    renderShell('/support/ticket-1');

    const primaryNav = screen.getByRole('navigation', { name: 'Primary' });
    expect(within(primaryNav).getByRole('link', { name: 'Support' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('Support ticket content')).toBeInTheDocument();
  });

  it('keeps vendor users on vendor navigation without a workspace switcher', () => {
    seedSession(vendorUser);

    renderShell('/orders');

    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Dashboard/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Orders/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^Vendors$/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Admin workspace switcher')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Workspace')).not.toBeInTheDocument();
    expect(screen.queryByText(/Admin Workspace/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Log out/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Yalı Spor/i })).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens and closes the compact vendor account menu with accessible state', async () => {
    const user = userEvent.setup();
    seedSession(adminUser);

    renderShell('/orders');

    const trigger = screen.getByRole('button', { name: /Yalı Spor/i });
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByLabelText('Workspace')).not.toBeInTheDocument();
    expect(screen.queryByText('Vendor context: Yalı Spor')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Log out/i })).not.toBeInTheDocument();

    await user.click(trigger);

    const menu = screen.getByRole('menu', { name: 'Account menu' });
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(trigger).toHaveAttribute('aria-controls', menu.id);
    expect(within(menu).getByLabelText('Workspace')).toHaveValue('vendor');
    expect(within(menu).getByText('Selected Vendor: Yalı Spor')).toBeInTheDocument();
    expect(within(menu).getByRole('button', { name: /Log out/i })).toBeInTheDocument();

    await user.keyboard('{Escape}');

    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('menu', { name: 'Account menu' })).not.toBeInTheDocument();

    await user.click(trigger);
    expect(screen.getByRole('menu', { name: 'Account menu' })).toBeInTheDocument();

    await user.click(trigger);
    expect(screen.queryByRole('menu', { name: 'Account menu' })).not.toBeInTheDocument();
  });

  it('preserves vendor selection inside the compact account menu', async () => {
    const user = userEvent.setup();
    seedSession(multiVendorAdminUser);

    renderShell('/finance');

    const menu = await openAccountMenu(user);
    expect(within(menu).getByText('Selected Vendor: Yalı Spor')).toBeInTheDocument();
    await user.click(within(menu).getByRole('button', { name: 'Choose Vendor' }));
    await user.click(screen.getByRole('option', { name: /Demo Vendor B.*demo-vendor-b/ }));

    expect(await screen.findByRole('button', { name: /Demo Vendor B/i })).toBeInTheDocument();
  });

  it('opens an embedded selector, returns with focus, and resets its temporary view when closed', async () => {
    const user = userEvent.setup();
    seedSession(multiVendorAdminUser);
    renderShell('/orders');
    const menu = await openAccountMenu(user);
    expect(within(menu).getByText('Admin User')).toBeInTheDocument();
    expect(within(menu).getByText('Selected Vendor: Yalı Spor')).toBeInTheDocument();
    expect(within(menu).queryByRole('listbox')).not.toBeInTheDocument();
    await user.click(within(menu).getByRole('button', { name: 'Choose Vendor' }));
    expect(within(menu).getByRole('listbox', { name: 'Vendors' })).toBeInTheDocument();
    expect(within(menu).queryByRole('button', { name: 'Log out' })).not.toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(within(menu).getByRole('button', { name: 'Choose Vendor' })).toHaveFocus();
    await user.click(within(menu).getByRole('button', { name: 'Choose Vendor' }));
    await user.click(within(menu).getByRole('button', { name: 'Back to account' }));
    expect(within(menu).getByRole('button', { name: 'Choose Vendor' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: /Yalı Spor.*Admin view/ }));
    expect(screen.queryByRole('menu', { name: 'Account menu' })).not.toBeInTheDocument();
    await openAccountMenu(user);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    await user.click(document.body);
    expect(screen.queryByRole('menu', { name: 'Account menu' })).not.toBeInTheDocument();
  });

  it('uses the existing Admin directory search, cursor and exact-ID verification in the menu', async () => {
    Object.assign(runtimeConfig, { apiMode: 'real' });
    vendorDirectoryMock.mockImplementation(async (options) => options.search === 'Spor'
      ? directoryPage([directoryVendor('sporjinal', 'Sporjinal')])
      : options.cursor === 'page-two'
        ? directoryPage([directoryVendor('sporjinal', 'Sporjinal')])
        : directoryPage([directoryVendor('yalispor', 'Yalı Spor')], 'page-two'));
    seedSession(adminUser);
    renderShell('/orders');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Admin view/ }));
    const menu = screen.getByRole('menu', { name: 'Account menu' });
    await user.click(within(menu).getByRole('button', { name: 'Choose Vendor' }));
    expect(await screen.findByRole('button', { name: 'Next Vendors' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Next Vendors' }));
    expect(vendorDirectoryMock).toHaveBeenCalledWith(expect.objectContaining({ cursor: 'page-two' }));
    await screen.findByRole('option', { name: /Sporjinal.*sporjinal/ });
    await user.type(screen.getByRole('combobox', { name: 'Search vendors' }), 'Spor');
    expect(vendorDirectoryMock).toHaveBeenCalledWith(expect.objectContaining({ search: 'Spor', cursor: null }));
    await user.click(await screen.findByRole('option', { name: /Sporjinal.*sporjinal/ }));
    await waitFor(() => expect(getCurrentVendorContext().vendorId).toBe('sporjinal'));
    expect(vendorStatusMock).toHaveBeenCalledWith('sporjinal');
    expect(screen.queryByRole('menu', { name: 'Account menu' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Sporjinal.*Admin view/ }));
    const returnMenu = screen.getByRole('menu', { name: 'Account menu' });
    await user.click(within(returnMenu).getByRole('button', { name: 'Choose Vendor' }));
    await user.click(await screen.findByRole('option', { name: /Yalı Spor.*yalispor/ }));
    await waitFor(() => expect(getCurrentVendorContext().vendorId).toBe('yalispor'));
  });

  it('keeps Vendor-role choices within membership and never calls the Admin directory', async () => {
    const user = userEvent.setup();
    seedSession({ ...vendorUser, vendorDetails: [
      { vendorId: 'yalispor', vendorName: 'Shared Name' },
      { vendorId: 'other-member', vendorName: 'Shared Name' },
    ], vendorAccess: ['yalispor', 'other-member'], canSwitchVendors: true });
    renderShell('/orders');
    await user.click(screen.getByRole('button', { name: /Shared Name.*Vendor/ }));
    const menu = screen.getByRole('menu', { name: 'Account menu' });
    await user.click(within(menu).getByRole('button', { name: 'Choose Vendor' }));
    expect(screen.getAllByRole('option')).toHaveLength(2);
    expect(screen.queryByText('Sporjinal')).not.toBeInTheDocument();
    await user.click(screen.getByRole('option', { name: /Shared Name.*other-member/ }));
    expect(getCurrentVendorContext().vendorId).toBe('other-member');
    expect(vendorDirectoryMock).not.toHaveBeenCalled();
  });

  it('keeps Admin directory failure separate from an empty page and retries in the selection view', async () => {
    Object.assign(runtimeConfig, { apiMode: 'real' });
    vendorDirectoryMock.mockRejectedValueOnce(new Error('temporary directory failure'));
    seedSession(adminUser);
    renderShell('/orders');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Admin view/ }));
    await user.click(screen.getByRole('button', { name: 'Choose Vendor' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Vendor directory failed.');
    expect(screen.queryByText('No Vendors found.')).not.toBeInTheDocument();
    expect(getCurrentVendorContext().vendorId).toBe('yalispor');
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('option', { name: /Sporjinal.*sporjinal/ })).toBeInTheDocument();
    expect(vendorDirectoryMock).toHaveBeenCalledTimes(2);
  });

  it('shows the restricted account banner for restricted vendors', () => {
    seedSession(restrictedVendorUser);

    renderShell('/orders');

    const banner = screen.getByRole('alert');
    expect(banner).toHaveTextContent('Account Restricted');
    expect(banner).toHaveTextContent('Reason');
    expect(banner).toHaveTextContent('Operational review');
    expect(banner).toHaveTextContent('Your account is currently in read-only mode.');
    expect(within(banner).getByText('Orders')).toBeInTheDocument();
    expect(within(banner).getByText('Returns')).toBeInTheDocument();
    expect(within(banner).getByText('Finance')).toBeInTheDocument();
    expect(within(banner).getByText('Support')).toBeInTheDocument();
    expect(banner).toHaveTextContent('Operational actions are temporarily unavailable.');
    expect(within(banner).getByRole('link', { name: 'Open correction ticket' })).toHaveAttribute('href', '/vendor/profile');
    expect(banner).not.toHaveTextContent('Your account is temporarily restricted.');
    expect(screen.getByText('Orders workspace content')).toBeInTheDocument();
  });

  it('shows vendor workspace context for admins on vendor-scoped routes and switches to admin workspace', async () => {
    const user = userEvent.setup();
    seedSession(adminUser);

    renderShell('/orders');

    expect(screen.getByText('Admin view')).toBeInTheDocument();
    expect(screen.queryByText('Vendor context: Yalı Spor')).not.toBeInTheDocument();
    const menu = await openAccountMenu(user);
    expect(within(menu).getByText('Selected Vendor: Yalı Spor')).toBeInTheDocument();
    expect(within(menu).getByLabelText('Workspace')).toHaveValue('vendor');
    expect(screen.getByRole('link', { name: /Dashboard/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Orders/i })).toBeInTheDocument();

    await user.selectOptions(within(menu).getByLabelText('Workspace'), 'admin');

    expect(await screen.findByText('Admin operations content')).toBeInTheDocument();
    expect(screen.getByLabelText('Workspace')).toHaveValue('admin');
    expect(screen.getByRole('navigation', { name: 'Admin tools' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Operations Queue/i })).toBeInTheDocument();
  });

  it('shows admin workspace context on admin routes and switches back to vendor workspace', async () => {
    const user = userEvent.setup();
    seedSession(adminUser);

    renderShell('/admin/operations');

    expect(screen.getByLabelText('Workspace')).toHaveValue('admin');
    expect(screen.getByRole('navigation', { name: 'Admin tools' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Settlement Approvals/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Refund Adjustments/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Payment Preparation/i })).toBeInTheDocument();
    const vendorsLink = screen.getByRole('link', { name: /^Vendors$/i });
    expect(vendorsLink).toBeInTheDocument();
    expect(vendorsLink).toHaveAttribute('href', '/admin/vendors');
    expect(screen.queryByRole('link', { name: /Create Vendor/i })).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Workspace'), 'vendor');

    expect(await screen.findByText('Vendor dashboard content')).toBeInTheDocument();
    const menu = await openAccountMenu(user);
    expect(within(menu).getByLabelText('Workspace')).toHaveValue('vendor');
    expect(within(menu).getByText('Selected Vendor: Yalı Spor')).toBeInTheDocument();

    const primaryNav = screen.getByRole('navigation', { name: 'Primary' });
    expect(within(primaryNav).getByRole('link', { name: /Dashboard/i })).toBeInTheDocument();
    expect(within(primaryNav).getByRole('link', { name: /Orders/i })).toBeInTheDocument();
    expect(within(primaryNav).getByRole('link', { name: /Returns/i })).toBeInTheDocument();
    expect(within(primaryNav).getByRole('link', { name: /Finance/i })).toBeInTheDocument();
    expect(within(primaryNav).getByRole('link', { name: /Support/i })).toHaveAttribute('href', '/support');
    expect(within(primaryNav).queryByRole('link', { name: /Inbox/i })).not.toBeInTheDocument();
    expect(within(primaryNav).getByRole('link', { name: /Settings/i })).toBeInTheDocument();
  });

  it('does not present the selected workspace vendor as the managed vendor on admin vendor profile routes', () => {
    seedSession(multiVendorAdminUser);
    setCurrentVendorId('yalispor');

    renderShell('/admin/vendors/sporborsa');

    expect(screen.getByText('Admin vendor profile content')).toBeInTheDocument();
    expect(screen.getByLabelText('Workspace')).toHaveValue('admin');
    expect(screen.getByText('Route-scoped vendor profile')).toBeInTheDocument();
    expect(screen.queryByText('Vendor Yalı Spor')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Select vendor')).not.toBeInTheDocument();
  });

  it('does not render the generic admin page heading on finance queue routes', () => {
    seedSession(adminUser);

    renderShell('/admin/finance/settlement-schedules');

    expect(screen.getByText('Scheduled settlements queue content')).toBeInTheDocument();
    expect(screen.queryByText('Operational control center')).not.toBeInTheDocument();
    expect(screen.queryByText('Shopify operations, finance, diagnostics, and recovery.')).not.toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Admin tools' })).toBeInTheDocument();
  });

  it('clears the cached user and replaces the route with login on logout', async () => {
    const user = userEvent.setup();
    seedLogoutState(vendorUser);

    renderShell('/orders');

    expect(screen.getByText('Orders workspace content')).toBeInTheDocument();
    expect(getCurrentUser()?.email).toBe('vendor@example.com');
    expect(getToken()).toBe('test-session');

    const menu = await openAccountMenu(user);
    await user.click(within(menu).getByRole('button', { name: /Log out/i }));

    await waitFor(() => expect(screen.getByText('Login screen')).toBeInTheDocument());
    expect(getCurrentUser()).toBeNull();
    expect(getToken()).toBeNull();
    expect(clearCsrfTokenMock).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryData(logoutQueryKey)).toBeUndefined();
    expect(getAuthRestoreSnapshot()).toMatchObject({
      phase: 'unconfirmed',
      authConfirmed: false,
      restoreAttemptId: null,
    });
    expect(screen.queryByText('Orders workspace content')).not.toBeInTheDocument();
    expect(logoutMock).toHaveBeenCalledTimes(1);
  });

  it('publishes one real-logout transition only after successful cleanup', async () => {
    Object.assign(runtimeConfig, { apiMode: 'real' });
    const user = userEvent.setup();
    const storageWrites = vi.spyOn(window.localStorage, 'setItem');
    seedLogoutState(vendorUser);
    renderShell('/orders');

    const menu = await openAccountMenu(user);
    const button = within(menu).getByRole('button', { name: /Log out/i });
    await user.click(button);
    await user.click(button);

    await waitFor(() => expect(screen.getByText('Login screen')).toBeInTheDocument());
    expect(readSessionTransition()).toMatchObject({ version: 1, kind: 'logout', id: expect.any(String) });
    expect(storageWrites.mock.calls.filter(([key]) => key === 'vendor-dashboard.session-transition')).toHaveLength(1);
    expect(logoutMock).toHaveBeenCalledTimes(1);
    expect(getCurrentUser()).toBeNull();
    expect(queryClient.getQueryData(logoutQueryKey)).toBeUndefined();
    storageWrites.mockRestore();
  });

  it('keeps local auth and query state intact until backend logout resolves', async () => {
    const user = userEvent.setup();
    const deferredLogout = createDeferred();
    logoutMock.mockReturnValueOnce(deferredLogout.promise);
    seedLogoutState(vendorUser);

    renderShell('/orders');

    expect(screen.getByText('Orders workspace content')).toBeInTheDocument();

    const menu = await openAccountMenu(user);
    const logoutButton = within(menu).getByRole('button', { name: /Log out/i });
    await user.click(logoutButton);

    expect(logoutButton).toBeDisabled();
    expect(screen.queryByText('Login screen')).not.toBeInTheDocument();
    expect(screen.getByText('Orders workspace content')).toBeInTheDocument();
    expect(getCurrentUser()?.email).toBe('vendor@example.com');
    expect(getToken()).toBe('test-session');
    expect(clearCsrfTokenMock).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(logoutQueryKey)).toEqual({ preserved: true });
    expect(getAuthRestoreSnapshot()).toMatchObject({ phase: 'confirmed', authConfirmed: true });
    expect(logoutMock).toHaveBeenCalledTimes(1);

    deferredLogout.resolve();

    expect(await screen.findByText('Login screen')).toBeInTheDocument();
    expect(getCurrentUser()).toBeNull();
    expect(getToken()).toBeNull();
    expect(clearCsrfTokenMock).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryData(logoutQueryKey)).toBeUndefined();
  });

  it('waits for backend logout before leaving the admin workspace', async () => {
    const user = userEvent.setup();
    const deferredLogout = createDeferred();
    logoutMock.mockReturnValueOnce(deferredLogout.promise);
    seedSession(adminUser);

    renderShell('/admin/operations');

    expect(screen.getByText('Admin operations content')).toBeInTheDocument();

    const logoutButton = screen.getByRole('button', { name: /Log out/i });
    await user.click(logoutButton);

    expect(logoutButton).toBeDisabled();
    expect(screen.getByText('Admin operations content')).toBeInTheDocument();
    expect(screen.queryByText('Login screen')).not.toBeInTheDocument();
    expect(logoutMock).toHaveBeenCalledTimes(1);

    deferredLogout.resolve();
    expect(await screen.findByText('Login screen')).toBeInTheDocument();
  });

  it('waits for backend logout when an admin is viewing the vendor workspace', async () => {
    const user = userEvent.setup();
    const deferredLogout = createDeferred();
    logoutMock.mockReturnValueOnce(deferredLogout.promise);
    seedSession(adminUser);

    renderShell('/orders');

    expect(screen.getByText('Orders workspace content')).toBeInTheDocument();
    expect(screen.getByText('Admin view')).toBeInTheDocument();

    const menu = await openAccountMenu(user);
    const logoutButton = within(menu).getByRole('button', { name: /Log out/i });
    await user.click(logoutButton);

    expect(logoutButton).toBeDisabled();
    expect(screen.getByText('Orders workspace content')).toBeInTheDocument();
    expect(screen.queryByText('Login screen')).not.toBeInTheDocument();
    expect(logoutMock).toHaveBeenCalledTimes(1);

    deferredLogout.resolve();
    expect(await screen.findByText('Login screen')).toBeInTheDocument();
  });

  it('preserves local auth and query state after logout rejection and allows retry', async () => {
    Object.assign(runtimeConfig, { apiMode: 'real' });
    const user = userEvent.setup();
    logoutMock.mockRejectedValueOnce(new Error('logout unavailable'));
    seedLogoutState(vendorUser);

    renderShell('/finance');

    expect(screen.getByText('Finance workspace content')).toBeInTheDocument();

    const menu = await openAccountMenu(user);
    const logoutButton = within(menu).getByRole('button', { name: /Log out/i });
    await user.click(logoutButton);

    expect(await screen.findByText('Unable to sign out. Please try again.')).toBeInTheDocument();
    expect(logoutButton).toBeEnabled();
    expect(screen.queryByText('Login screen')).not.toBeInTheDocument();
    expect(screen.getByText('Finance workspace content')).toBeInTheDocument();
    expect(getCurrentUser()?.email).toBe('vendor@example.com');
    expect(getToken()).toBe('test-session');
    expect(clearCsrfTokenMock).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(logoutQueryKey)).toEqual({ preserved: true });
    expect(getAuthRestoreSnapshot()).toMatchObject({ phase: 'confirmed', authConfirmed: true });
    expect(readSessionTransition()).toBeNull();
    expect(logoutMock).toHaveBeenCalledTimes(1);

    await user.click(logoutButton);

    expect(await screen.findByText('Login screen')).toBeInTheDocument();
    expect(getCurrentUser()).toBeNull();
    expect(getToken()).toBeNull();
    expect(queryClient.getQueryData(logoutQueryKey)).toBeUndefined();
    expect(logoutMock).toHaveBeenCalledTimes(2);
  });
});
