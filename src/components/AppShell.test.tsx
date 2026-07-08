import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminShell, VendorShell } from './AppShell';
import { getCurrentUser, getToken, setCurrentVendorId, setSession, type CurrentUser } from '../lib/auth';
import { runtimeServices } from '../services/runtime-services';

vi.mock('../services/runtime-services', () => ({
  runtimeServices: {
    auth: {
      logout: vi.fn(() => Promise.resolve()),
    },
  },
}));

const logoutMock = vi.mocked(runtimeServices.auth.logout);

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

beforeEach(() => {
  logoutMock.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
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
    expect(screen.getByText('Vendor context: Yalı Spor')).toBeInTheDocument();
    expect(screen.getByLabelText('Workspace')).toHaveValue('vendor');
    expect(screen.getByRole('link', { name: /Dashboard/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Orders/i })).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Workspace'), 'admin');

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
    expect(screen.getByLabelText('Workspace')).toHaveValue('vendor');
    expect(screen.getByText('Vendor context: Yalı Spor')).toBeInTheDocument();

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
    seedSession(vendorUser);

    renderShell('/orders');

    expect(screen.getByText('Orders workspace content')).toBeInTheDocument();
    expect(getCurrentUser()?.email).toBe('vendor@example.com');
    expect(getToken()).toBe('test-session');

    await user.click(screen.getByRole('button', { name: /Log out/i }));

    await waitFor(() => expect(screen.getByText('Login screen')).toBeInTheDocument());
    expect(getCurrentUser()).toBeNull();
    expect(getToken()).toBeNull();
    expect(screen.queryByText('Orders workspace content')).not.toBeInTheDocument();
    expect(logoutMock).toHaveBeenCalledTimes(1);
  });

  it('logs out vendor users immediately when backend logout never resolves', async () => {
    const user = userEvent.setup();
    logoutMock.mockImplementationOnce(() => new Promise<never>(() => {}));
    seedSession(vendorUser);

    renderShell('/orders');

    expect(screen.getByText('Orders workspace content')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Log out/i }));

    expect(await screen.findByText('Login screen')).toBeInTheDocument();
    expect(getCurrentUser()).toBeNull();
    expect(getToken()).toBeNull();
    expect(screen.queryByText('Orders workspace content')).not.toBeInTheDocument();
    expect(logoutMock).toHaveBeenCalledTimes(1);
  });

  it('logs out admin workspace users immediately when backend logout never resolves', async () => {
    const user = userEvent.setup();
    logoutMock.mockImplementationOnce(() => new Promise<never>(() => {}));
    seedSession(adminUser);

    renderShell('/admin/operations');

    expect(screen.getByText('Admin operations content')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Log out/i }));

    expect(await screen.findByText('Login screen')).toBeInTheDocument();
    expect(getCurrentUser()).toBeNull();
    expect(getToken()).toBeNull();
    expect(screen.queryByText('Admin operations content')).not.toBeInTheDocument();
    expect(logoutMock).toHaveBeenCalledTimes(1);
  });

  it('logs out admins viewing vendor workspace immediately', async () => {
    const user = userEvent.setup();
    logoutMock.mockImplementationOnce(() => new Promise<never>(() => {}));
    seedSession(adminUser);

    renderShell('/orders');

    expect(screen.getByText('Orders workspace content')).toBeInTheDocument();
    expect(screen.getByText('Admin view')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Log out/i }));

    expect(await screen.findByText('Login screen')).toBeInTheDocument();
    expect(getCurrentUser()).toBeNull();
    expect(getToken()).toBeNull();
    expect(screen.queryByText('Orders workspace content')).not.toBeInTheDocument();
    expect(logoutMock).toHaveBeenCalledTimes(1);
  });

  it('keeps local logout complete when backend logout rejects', async () => {
    const user = userEvent.setup();
    logoutMock.mockRejectedValueOnce(new Error('logout unavailable'));
    seedSession(vendorUser);

    renderShell('/finance');

    expect(screen.getByText('Finance workspace content')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Log out/i }));

    expect(await screen.findByText('Login screen')).toBeInTheDocument();
    expect(getCurrentUser()).toBeNull();
    expect(getToken()).toBeNull();
    expect(screen.queryByText('Finance workspace content')).not.toBeInTheDocument();
    expect(logoutMock).toHaveBeenCalledTimes(1);
  });
});
