import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { AdminShell, VendorShell } from './AppShell';
import { getCurrentUser, getToken, setCurrentVendorId, setSession, type CurrentUser } from '../lib/auth';

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
  vendorDetails: [{ vendorId: 'yalispor', vendorName: 'Yalı Spor', status: 'inactive' }],
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
        </Route>
        <Route path="/login" element={<div>Login screen</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('AppShell workspace navigation', () => {
  it('keeps vendor users on vendor navigation without a workspace switcher', () => {
    seedSession(vendorUser);

    renderShell('/orders');

    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Dashboard/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Orders/i })).toBeInTheDocument();
    expect(screen.queryByLabelText('Admin workspace switcher')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Workspace')).not.toBeInTheDocument();
    expect(screen.queryByText(/Admin Workspace/i)).not.toBeInTheDocument();
  });

  it('shows the restricted account banner for restricted vendors', () => {
    seedSession(restrictedVendorUser);

    renderShell('/orders');

    expect(screen.getByRole('alert')).toHaveTextContent('Account Restricted');
    expect(screen.getByRole('alert')).toHaveTextContent('Your account is temporarily restricted.');
    expect(screen.getByRole('alert')).toHaveTextContent(
      'You can continue viewing orders, returns, payments, and contact support.',
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Operational actions are temporarily unavailable.');
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
  });
});
