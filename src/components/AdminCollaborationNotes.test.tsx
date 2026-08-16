import { cleanup, render, screen, within } from '@testing-library/react';
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

    expect(screen.getByText('No internal notes yet.')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/add an internal note/i)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Add note' }));
    await userEvent.type(screen.getByPlaceholderText(/add an internal note/i), 'Follow up with @operator-one');
    await userEvent.click(screen.getByRole('button', { name: 'Add note' }));

    expect(screen.getByText('Follow up with')).toBeInTheDocument();
    expect(screen.getByText('@operator-one')).toHaveClass('mention-highlight');
  });

  it('does not render notes for vendor users', () => {
    render(<AdminCollaborationNotes contextType="order" contextId="ORD-A-1001" currentUser={vendorUser} />);

    expect(screen.queryByText('Internal notes')).not.toBeInTheDocument();
  });

  it('keeps an empty admin note surface as a normal card with a compact body', async () => {
    render(<AdminCollaborationNotes contextType="order" contextId="ORD-A-1001" currentUser={adminUser} />);

    const notesCard = screen.getByRole('heading', { name: 'Internal notes' }).closest('article');
    expect(notesCard).toHaveClass('admin-collab-card');
    expect(notesCard).not.toHaveClass('admin-collab-card-compact');
    expect(screen.getByText('No internal notes yet.')).toBeInTheDocument();

    await userEvent.click(within(notesCard as HTMLElement).getByRole('button', { name: 'Add note' }));

    expect(screen.getByPlaceholderText(/add an internal note/i)).toBeInTheDocument();
    expect(screen.getByText('No internal notes yet.')).toBeInTheDocument();
  });

  it('preserves the full notes surface when notes already exist', () => {
    window.localStorage.setItem(
      'vendor-dashboard.admin-collaboration-notes',
      JSON.stringify([
        {
          id: 'note-1',
          contextType: 'order',
          contextId: 'ORD-A-1001',
          authorName: 'Demo Admin',
          content: 'Existing operational note',
          createdAt: '2026-05-15T12:08:00.000Z',
        },
      ]),
    );

    render(
      <AdminCollaborationNotes
        contextType="order"
        contextId="ORD-A-1001"
        currentUser={adminUser}
      />,
    );

    expect(screen.queryByLabelText('Internal notes (0)')).not.toBeInTheDocument();
    expect(screen.getByText('Existing operational note')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/add an internal note/i)).toBeInTheDocument();
  });
});
