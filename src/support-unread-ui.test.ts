import { describe, expect, it } from 'vitest';
import { isAdminSupportEscalated, isAdminSupportNeedsResponse } from './pages/AdminSupportTicketsPage';
import { isVendorSupportUnread } from './pages/VendorSupportTicketsPage';
import type { SupportTicket } from './lib/api/contracts';

function ticket(overrides: Partial<SupportTicket> = {}): SupportTicket {
  return {
    id: 'ticket-1',
    createdAt: '2026-05-16T10:00:00.000Z',
    updatedAt: '2026-05-16T10:00:00.000Z',
    createdByUserId: 'user-1',
    createdByRole: 'vendor',
    vendorId: 'vendor-a',
    vendorName: 'Vendor A',
    subject: 'Support request',
    message: 'Need help.',
    priority: 'normal',
    status: 'OPEN',
    category: 'RETURN',
    assigneeUserId: null,
    assigneeName: null,
    vendorUnreadCount: 0,
    adminUnreadCount: 0,
    lastReplyAt: null,
    lastReplyByRole: null,
    firstResponseDueAt: null,
    nextResponseDueAt: null,
    escalatedAt: null,
    escalationReason: null,
    sla: null,
    contextType: 'return',
    contextId: 'return-1',
    contextSnapshot: null,
    resolvedAt: null,
    closedAt: null,
    ...overrides,
  };
}

describe('support unread UI filters', () => {
  it('treats admin unread tickets as needing response', () => {
    expect(isAdminSupportNeedsResponse(ticket({ status: 'WAITING_FOR_VENDOR', adminUnreadCount: 1 }))).toBe(true);
  });

  it('does not treat waiting-for-vendor status alone as admin needs response', () => {
    expect(isAdminSupportNeedsResponse(ticket({ status: 'WAITING_FOR_VENDOR', adminUnreadCount: 0 }))).toBe(false);
  });

  it('treats open unassigned tickets as admin needs response', () => {
    expect(isAdminSupportNeedsResponse(ticket({ status: 'OPEN', assigneeUserId: null, assigneeName: null }))).toBe(true);
  });

  it('does not treat assigned open tickets as admin needs response without unread replies', () => {
    expect(isAdminSupportNeedsResponse(ticket({ status: 'OPEN', assigneeUserId: 'admin-1', assigneeName: 'Admin User' }))).toBe(false);
  });

  it('filters vendor unread tickets by vendor unread count', () => {
    expect(isVendorSupportUnread(ticket({ vendorUnreadCount: 2 }))).toBe(true);
    expect(isVendorSupportUnread(ticket({ vendorUnreadCount: 0 }))).toBe(false);
  });

  it('treats overdue SLA tickets as escalated for admin filtering', () => {
    expect(isAdminSupportEscalated(ticket({
      sla: {
        isOverdue: true,
        dueLabel: 'Overdue by 2h',
        escalationLevel: 'overdue',
        dueAt: '2026-05-16T10:00:00.000Z',
        overdueByHours: 2,
      },
    }))).toBe(true);
  });
});
