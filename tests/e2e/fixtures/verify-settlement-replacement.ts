import { PrismaClient } from '../../../backend/node_modules/@prisma/client/index.js';

const databaseUrl = process.env.DATABASE_URL?.trim();
const target = databaseUrl ? new URL(databaseUrl) : null;
if (process.env.BROWSER_SMOKE_ALLOW_LOCAL_DB !== '1' || !target ||
    !['localhost', '127.0.0.1'].includes(target.hostname) ||
    !/^\/vendor_dashboard_browser_smoke_[0-9]+_[0-9]+$/.test(target.pathname)) {
  throw new Error('Replacement post-check requires the dedicated local browser-smoke database.');
}

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const run = 'browser-smoke-settlement-replacement';
try {
  const admin = await db.user.findUniqueOrThrow({ where: { email: 'admin@demo.com' } });
  const approvals = await db.settlementApproval.findMany({ where: { vendorId: { in: [
    `${run}-eligible-vendor`, `${run}-uncertain-vendor`,
  ] } }, include: { lines: true }, orderBy: { createdAt: 'asc' } });
  if (approvals.length !== 4) throw new Error(`Expected two originals and two replacements, got ${approvals.length}.`);
  for (const suffix of ['eligible', 'uncertain']) {
    const vendorId = `${run}-${suffix}-vendor`;
    const original = approvals.find((row) => row.vendorId === vendorId && row.scheduledCycleKey);
    const replacements = approvals.filter((row) => row.vendorId === vendorId && row.replacesSettlementApprovalId);
    const replacement = replacements[0];
    if (!original || replacements.length !== 1 || !replacement ||
        original.status !== 'CANCELLED' || original.cancelledFromStatus !== 'DRAFT' ||
        original.approvedAt !== null || !original.cancelledAt || !original.cancelledBy ||
        replacement.status !== 'DRAFT' || replacement.approvedAt !== null ||
        replacement.id === original.id || replacement.replacesSettlementApprovalId !== original.id ||
        replacement.scheduledCycleKey !== null || replacement.scheduledRunDate !== null ||
        replacement.periodEnd?.getTime() !== original.scheduledPeriodEnd?.getTime() ||
        replacement.netPayableMinor !== original.netPayableMinor || replacement.netPayableMinor !== 17600 ||
        replacement.replacementRequestedBy !== admin.id || !replacement.replacementRequestId ||
        !replacement.replacementReason || !replacement.replacementRequestedAt ||
        original.lines.length !== 1 || replacement.lines.length !== 1 ||
        original.lines[0].financeLedgerEntryId !== replacement.lines[0].financeLedgerEntryId ||
        replacement.lines[0].financeLedgerEntryId !== `${run}-${suffix}-sale`) {
      throw new Error(`Replacement lineage, audit, frozen cutoff, money or source ownership failed for ${suffix}.`);
    }
  }
  const [payouts, invoices, paidApprovals, adjustmentApplications] = await Promise.all([
    db.payoutBatch.count(), db.settlementCommissionInvoice.count(),
    db.settlementApproval.count({ where: { status: 'APPROVED' } }),
    db.settlementRefundAdjustmentApplication.count(),
  ]);
  if (payouts || invoices || paidApprovals || adjustmentApplications) {
    throw new Error('Browser replacement flow unexpectedly approved, paid, invoiced or applied refund money.');
  }
  console.log(JSON.stringify({ originals: 2, replacementDrafts: 2, payouts, invoices,
    approvedSettlements: paidApprovals, adjustmentApplications, auditedAdminId: admin.id }));
} finally {
  await db.$disconnect();
}
