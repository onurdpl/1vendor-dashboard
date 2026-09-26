import type { Prisma } from '@prisma/client';

export function assertApprovedDeductionCoverage(coverage: {
  id: string; vendorId: string; currency: string; amountMinor: number; status: string;
  settlementApprovalId: string;
  deduction: { id: string; vendorId: string; currency: string; amountMinor: number;
    authority: { vendorId: string; currency: string; economicDirection: string;
      applicationRoute: string; vendorPayableDifferenceMinor: number; appliedAt: Date;
      historicalApprovedSettlementId: string | null; historicalPayoutBatchId: string | null } };
  settlementApproval: { id: string; vendorId: string; currency: string; status: string;
    approvedAt: Date | null; netPayableMinor: number };
}) {
  const source = coverage.deduction;
  const authority = source.authority;
  const origin = coverage.settlementApproval;
  if (coverage.status !== 'ACTIVE' || coverage.currency !== 'TRY' || coverage.amountMinor <= 0 ||
      coverage.vendorId !== source.vendorId || coverage.amountMinor !== source.amountMinor ||
      source.currency !== 'TRY' || authority.vendorId !== source.vendorId || authority.currency !== 'TRY' ||
      authority.economicDirection !== 'VENDOR_DEDUCTION' ||
      !['APPROVED_SETTLEMENT_VENDOR_DEDUCTION', 'DRAFT_PAYOUT_VENDOR_DEDUCTION'].includes(authority.applicationRoute) ||
      authority.vendorPayableDifferenceMinor !== source.amountMinor || !authority.appliedAt ||
      (authority.applicationRoute === 'APPROVED_SETTLEMENT_VENDOR_DEDUCTION' && authority.historicalPayoutBatchId) ||
      (authority.applicationRoute === 'DRAFT_PAYOUT_VENDOR_DEDUCTION' && !authority.historicalPayoutBatchId) ||
      authority.historicalApprovedSettlementId !== coverage.settlementApprovalId ||
      origin.id !== coverage.settlementApprovalId || origin.status !== 'APPROVED' || !origin.approvedAt ||
      origin.vendorId !== coverage.vendorId || origin.currency !== 'TRY') {
    throw new Error('APPROVED_DEDUCTION_COVERAGE_CHANGED');
  }
}

export async function getActiveApprovedDeductionCoverages(db: Prisma.TransactionClient, vendorId: string) {
  const coverages = await db.financialCorrectionApprovedDeductionCoverage.findMany({
    where: { vendorId, currency: 'TRY', status: 'ACTIVE' },
    include: { deduction: { include: { authority: true } }, settlementApproval: true,
      payoutLines: { where: { status: { in: ['ACTIVE', 'PAID'] } }, select: { id: true } } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  for (const coverage of coverages) assertApprovedDeductionCoverage(coverage);
  return coverages;
}
