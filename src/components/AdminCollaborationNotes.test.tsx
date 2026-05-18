import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, beforeEach } from 'vitest';
import { AdminCollaborationNotes } from './AdminCollaborationNotes';
import type { CurrentUser } from '../lib/auth';

const adminUser: CurrentUser = {
  email: 'admin@demo.com',
  name: 'Demo Admin',
  role: 'admin',
  vendorAccess: ['demo-vendor-a'],
  canSwitchVendors: true,
  defaultVendorId: 'demo-vendor-a',
};

const vendorUser: CurrentUser = {
  email: 'vendor-a@demo.com',
  name: 'Vendor A',
  role: 'vendor',
  vendorAccess: ['demo-vendor-a'],
  canSwitchVendors: false,
  defaultVendorId: 'demo-vendor-a',
};

describe('AdminCollaborationNotes', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders and highlights admin-only collaboration notes', async () => {
    render(<AdminCollaborationNotes contextType="order" contextId="ORD-A-1001" currentUser={adminUser} />);

    await userEvent.type(screen.getByPlaceholderText(/add an internal note/i), 'Follow up with @operator-one');
    await userEvent.click(screen.getByRole('button', { name: 'Add note' }));

    expect(screen.getByText('Follow up with')).toBeInTheDocument();
    expect(screen.getByText('@operator-one')).toHaveClass('mention-highlight');
  });

  it('does not render notes for vendor users', () => {
    render(<AdminCollaborationNotes contextType="order" contextId="ORD-A-1001" currentUser={vendorUser} />);

    expect(screen.queryByText('Internal notes')).not.toBeInTheDocument();
  });
});
