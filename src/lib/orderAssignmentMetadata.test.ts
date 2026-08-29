import { describe, expect, it } from 'vitest';
import { getAssignmentActorPresentation, getLatestVendorBlockedAt } from './orderAssignmentMetadata';

describe('order assignment presentation metadata', () => {
  it('uses the latest valid vendor block only for a currently blocked allocation', () => {
    const history = [
      { action: 'vendor_blocked', createdAt: '2026-08-20T10:00:00.000Z' },
      { action: 'admin_returned_to_vendor', createdAt: '2026-08-20T11:00:00.000Z' },
      { action: 'vendor_blocked', createdAt: 'invalid' },
      { action: 'vendor_blocked', createdAt: '2026-08-20T15:00:00.000Z' },
    ];

    expect(getLatestVendorBlockedAt('vendor_blocked', history)).toBe('2026-08-20T15:00:00.000Z');
    expect(getLatestVendorBlockedAt('active', history)).toBeUndefined();
    expect(getLatestVendorBlockedAt('vendor_blocked', [])).toBeUndefined();
  });

  it.each([
    ['vendor_blocked', 'vendor-user', 'Vendor user', 'vendor'],
    ['allocation_split_source_updated', 'vendor-user', 'Vendor user', 'vendor'],
    ['admin_returned_to_vendor', 'admin-user', 'Admin user', 'admin'],
    ['economic_transfer_completed', 'admin-user', 'Admin user', 'admin'],
    ['assigned', null, 'System', 'system'],
    ['vendor_blocked', null, 'Vendor actor unavailable', 'vendor'],
    ['admin_note', null, 'Admin actor unavailable', 'admin'],
    ['legacy_action', 'user-1', 'Actor unavailable', 'unknown'],
    ['legacy_action', null, 'Actor unavailable', 'unknown'],
  ])('classifies %s without inferring authority from actor id %s', (action, actorUserId, actorName, actorRole) => {
    expect(getAssignmentActorPresentation({ action, actorUserId })).toEqual({ actorName, actorRole });
  });
});
