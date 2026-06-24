import { describe, expect, it } from 'vitest';
import type { SupportTicket } from './api/contracts';
import { getSupportOperationalStory, ticketMatchesSupportActionBucket } from './supportOperationalStory';

function ticket(overrides: Partial<SupportTicket> = {}): SupportTicket {
  return {
    id: 'ticket-1',
    createdAt: '2026-06-24T08:00:00.000Z',
    updatedAt: '2026-06-24T09:00:00.000Z',
    createdByUserId: 'vendor-user',
    createdByRole: 'vendor',
    vendorId: 'vendor-a',
    vendorName: 'Vendor A',
    subject: 'Shipment support',
    message: 'Please help.',
    priority: 'normal',
    status: 'OPEN',
    category: 'SHIPMENT',
    assigneeUserId: null,
    assigneeName: null,
    vendorUnreadCount: 0,
    adminUnreadCount: 0,
    lastReplyAt: null,
    lastReplyByRole: null,
    firstResponseDueAt: '2026-06-25T08:00:00.000Z',
    nextResponseDueAt: null,
    escalatedAt: null,
    escalationReason: null,
    sla: {
      isOverdue: false,
      dueLabel: 'Due tomorrow',
      escalationLevel: 'none',
      dueAt: '2026-06-25T08:00:00.000Z',
      overdueByHours: null,
    },
    contextType: 'order',
    contextId: 'alloc-vendor-a-1097',
    contextSummary: { orderNumber: '#1097', status: 'Awaiting shipment' },
    contextSnapshot: null,
    resolvedAt: null,
    closedAt: null,
    ...overrides,
  };
}

describe('support operational story', () => {
  it('prefers business context labels over raw context ids', () => {
    const story = getSupportOperationalStory(ticket());

    expect(story.contextLabel).toBe('Order #1097');
    expect(story.contextDetail).toBe('Order alloc-vendor-a-1097');
  });

  it('marks unresolved unassigned tickets as needing assignment', () => {
    const story = getSupportOperationalStory(ticket());

    expect(story.assignmentLabel).toBe('Needs assignment');
    expect(story.nextActionLabel).toBe('Needs assignment');
    expect(ticketMatchesSupportActionBucket(ticket(), 'needs_assignment')).toBe(true);
  });

  it('marks vendor replies as needing an admin response', () => {
    const story = getSupportOperationalStory(ticket({
      assigneeUserId: 'admin-1',
      assigneeName: 'Admin User',
      adminUnreadCount: 1,
      lastReplyByRole: 'VENDOR',
      lastReplyAt: '2026-06-24T09:00:00.000Z',
    }));

    expect(story.nextActionLabel).toBe('Needs admin reply');
    expect(ticketMatchesSupportActionBucket(ticket({
      assigneeUserId: 'admin-1',
      assigneeName: 'Admin User',
      adminUnreadCount: 1,
      lastReplyByRole: 'VENDOR',
    }), 'needs_response')).toBe(true);
  });

  it('prioritizes escalated tickets with the escalation reason', () => {
    const story = getSupportOperationalStory(ticket({
      escalatedAt: '2026-06-24T09:30:00.000Z',
      escalationReason: 'Shipment not received',
    }));

    expect(story.slaLabel).toBe('Escalated');
    expect(story.nextActionLabel).toBe('Escalation review required');
    expect(story.escalationReason).toBe('Shipment not received');
  });

  it('separates waiting vendor, resolved, and closed next actions', () => {
    expect(getSupportOperationalStory(ticket({ status: 'WAITING_FOR_VENDOR' })).nextActionLabel).toBe('Waiting vendor response');
    expect(getSupportOperationalStory(ticket({ status: 'RESOLVED', resolvedAt: '2026-06-24T10:00:00.000Z' })).nextActionLabel).toBe('Resolved');
    expect(getSupportOperationalStory(ticket({ status: 'CLOSED', closedAt: '2026-06-24T10:00:00.000Z' })).nextActionLabel).toBe('Closed');
  });
});
