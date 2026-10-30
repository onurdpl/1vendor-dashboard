// Settlement Approvals only: shared by presentation and exact server-side Search.
export function formatSettlementDateUtc(value: string | null | undefined) {
  if (!value) return 'Not set';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Not set';
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit' }).format(date);
}
export function settlementSummaryPeriodLabel(summary: {
  scheduledCycleKey?: string | null; scheduledPeriodEnd?: string | null;
  scheduledRunDate?: string | null; createdAt: string;
}) {
  if (summary.scheduledCycleKey) return (summary.scheduledCycleKey.trim() || 'Unknown').toLowerCase()
    .replace(/_/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
  if (summary.scheduledPeriodEnd) return `Through ${formatSettlementDateUtc(summary.scheduledPeriodEnd)}`;
  if (summary.scheduledRunDate) return `Run ${formatSettlementDateUtc(summary.scheduledRunDate)}`;
  return `Created ${formatSettlementDateUtc(summary.createdAt)}`;
}
export function matchesSettlementSearch(summary: { id: string; vendorId: string; status: string; lineCount: number;
  createdAt: string; scheduledCycleKey?: string | null; scheduledPeriodEnd?: string | null; scheduledRunDate?: string | null },
  normalizedSearch: string, workspaceVendorName: string) {
  return !normalizedSearch || [summary.id, summary.vendorId, workspaceVendorName, summary.status,
    settlementSummaryPeriodLabel(summary), String(summary.lineCount)]
    .some(value => value.toLowerCase().includes(normalizedSearch));
}
