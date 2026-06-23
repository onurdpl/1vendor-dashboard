import type { ReturnOwnershipSummary } from './api/contracts';

export function formatOwnerLabel(id: string | null | undefined, name: string | null | undefined) {
  const cleanId = id?.trim() || '';
  const cleanName = name?.trim() || '';
  if (!cleanId && !cleanName) {
    return 'Unknown';
  }

  if (!cleanName || cleanName === cleanId) {
    return cleanId || cleanName;
  }

  return cleanId ? `${cleanName} (${cleanId})` : cleanName;
}

export function formatOwnershipSource(source: ReturnOwnershipSummary['ownershipSource'] | null | undefined) {
  switch (source) {
    case 'return_owner_snapshot':
      return 'Return owner snapshot';
    case 'active_sale_ledger':
      return 'Active sale ledger';
    case 'assigned_vendor':
      return 'Assigned vendor';
    default:
      return 'Unknown';
  }
}

export function hasOwnerLineageChange(summary: ReturnOwnershipSummary | null | undefined) {
  return Boolean(
    summary?.originalVendorId &&
      summary.assignedVendorId &&
      summary.originalVendorId !== summary.assignedVendorId,
  );
}
