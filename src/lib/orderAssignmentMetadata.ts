import type { AllocationStatus, AssignmentHistoryEntry } from './api/contracts';

type TransportAssignmentHistoryEntry = {
  action: string;
  actorUserId?: string | null;
  createdAt: string;
};

const VENDOR_ACTIONS = new Set([
  'vendor_blocked',
  'allocation_split_source_updated',
]);

const ADMIN_ACTIONS = new Set([
  'admin_returned_to_vendor',
  'admin_note',
  'cancel_refund_review_requested',
  'economic_transfer_completed',
  'economic_transfer_retry_completed',
]);

function normalizeAction(value: string) {
  return value.trim().toLowerCase();
}

export function getLatestVendorBlockedAt(
  allocationStatus: AllocationStatus | string | null | undefined,
  history: Array<Pick<TransportAssignmentHistoryEntry, 'action' | 'createdAt'>>,
) {
  if (allocationStatus?.trim().toLowerCase() !== 'vendor_blocked') {
    return undefined;
  }

  return history.reduce<string | undefined>((latest, entry) => {
    if (normalizeAction(entry.action) !== 'vendor_blocked' || !Number.isFinite(Date.parse(entry.createdAt))) {
      return latest;
    }
    if (!latest || Date.parse(entry.createdAt) > Date.parse(latest)) {
      return entry.createdAt;
    }
    return latest;
  }, undefined);
}

export function getAssignmentActorPresentation(
  entry: Pick<TransportAssignmentHistoryEntry, 'action' | 'actorUserId'>,
): Pick<AssignmentHistoryEntry, 'actorName' | 'actorRole'> {
  const action = normalizeAction(entry.action);

  if (VENDOR_ACTIONS.has(action)) {
    return {
      actorName: entry.actorUserId ? 'Vendor user' : 'Vendor actor unavailable',
      actorRole: 'vendor',
    };
  }

  if (ADMIN_ACTIONS.has(action)) {
    return {
      actorName: entry.actorUserId ? 'Admin user' : 'Admin actor unavailable',
      actorRole: 'admin',
    };
  }

  if (action === 'assigned') {
    return {
      actorName: 'System',
      actorRole: 'system',
    };
  }

  return {
    actorName: 'Actor unavailable',
    actorRole: 'unknown',
  };
}
