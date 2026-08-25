import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminShell, VendorShell } from './AppShell';
import {
  clearAuthRestoreState,
  getAuthRestoreSnapshot,
  getCurrentUser,
  getToken,
  markAuthConfirmed,
  setCurrentVendorId,
  setSession,
  type CurrentUser,
} from '../lib/auth';
import { clearCsrfToken, setCsrfToken } from '../lib/api-client';
import { queryClient } from '../lib/api/queryClient';
import { runtimeServices } from '../services/runtime-services';

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
  },
}));

const logoutMock = vi.mocked(runtimeServices.auth.logout);
const clearCsrfTokenMock = vi.mocked(clearCsrfToken);
const logoutQueryKey = ['logout-ordering-test'] as const;

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
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  queryClient.clear();
  clearAuthRestoreState();
  clearCsrfToken();
  vi.clearAllMocks();
});

describe('AppShell workspace navigation', () => {
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
    expect(within(menu).getByText('Vendor context: Yalı Spor')).toBeInTheDocument();
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
    const vendorSelect = within(menu).getByLabelText('Select vendor');
    expect(vendorSelect).toHaveValue('yalispor');

    await user.selectOptions(vendorSelect, 'demo-vendor-b');

    expect(await screen.findByRole('button', { name: /Demo Vendor B/i })).toBeInTheDocument();
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
    expect(within(menu).getByText('Vendor context: Yalı Spor')).toBeInTheDocument();
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
    expect(within(menu).getByText('Vendor context: Yalı Spor')).toBeInTheDocument();

    const primaryNav = screen.getByRole('navigation', { name: 'Primary' });
    expect(within(primaryNav).getByRole('link', { name: /Dashboard/i })).toBeInTheDocument();
    expect(within(primaryNav).getByRole('link', { name: /Orders/i })).toBeInTheDocument();
    expect(within(primaryNav).getByRole('link', { name: /Returns/i })).toBeInTheDocument();
    expect(within(primaryNav).getByRole('link', { name: /Finance/i })).toBeInTheDocument();
    expect(within(primaryNav).getByRole('link', { name: /Inbox/i })).toBeInTheDocument();
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
    expect(logoutMock).toHaveBeenCalledTimes(1);

    await user.click(logoutButton);

    expect(await screen.findByText('Login screen')).toBeInTheDocument();
    expect(getCurrentUser()).toBeNull();
    expect(getToken()).toBeNull();
    expect(queryClient.getQueryData(logoutQueryKey)).toBeUndefined();
    expect(logoutMock).toHaveBeenCalledTimes(2);
  });
});
