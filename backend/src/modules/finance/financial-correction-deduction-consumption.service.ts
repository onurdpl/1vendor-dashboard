import type { Prisma } from '@prisma/client';

export async function getAvailableFinancialCorrectionDeductions(db: Prisma.TransactionClient, vendorId: string) {
  const deductions = await db.financialCorrectionDeduction.findMany({
    where: { vendorId, currency: 'TRY', authority: { applicationRoute: 'BEFORE_SETTLEMENT_VENDOR_DEDUCTION' },
      settlementLines: { none: { status: 'ACTIVE' } } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true, vendorId: true, amountMinor: true, currency: true, authorityId: true,
      authority: { select: { vendorId: true, currency: true, economicDirection: true,
        applicationRoute: true, vendorPayableDifferenceMinor: true, appliedAt: true,
        historicalPayoutBatchId: true, historicalPayoutPaidAt: true } } },
  });
  for (const deduction of deductions) assertFinancialCorrectionDeductionSource(deduction);
  return deductions;
}

export function assertFinancialCorrectionDeductionSource(deduction: {
  vendorId: string;
  currency: string;
  amountMinor: number;
  authority: { vendorId: string; currency: string; economicDirection: string;
    applicationRoute: string; vendorPayableDifferenceMinor: number; appliedAt: Date;
    historicalPayoutBatchId: string | null; historicalPayoutPaidAt: Date | null };
}) {
  if (deduction.currency !== 'TRY' || deduction.amountMinor <= 0 ||
      deduction.authority.vendorId !== deduction.vendorId || deduction.authority.currency !== 'TRY' ||
      deduction.authority.economicDirection !== 'VENDOR_DEDUCTION' ||
      (deduction.authority.applicationRoute !== 'BEFORE_SETTLEMENT_VENDOR_DEDUCTION' ||
        !!deduction.authority.historicalPayoutBatchId || !!deduction.authority.historicalPayoutPaidAt) ||
      deduction.authority.vendorPayableDifferenceMinor !== deduction.amountMinor ||
      !deduction.authority.appliedAt) {
    throw new Error('Financial Correction Deduction authority is inconsistent.');
  }
}

export async function assertActiveFinancialCorrectionDeductionSettlement(
  db: Prisma.TransactionClient,
  lineId: string,
  settlementApprovalId: string,
  vendorId: string,
) {
  const line = await db.financialCorrectionDeductionSettlementLine.findUnique({
    where: { id: lineId },
    include: { deduction: { include: { authority: true } }, settlementApproval: true },
  });
  if (line) assertFinancialCorrectionDeductionSource(line.deduction);
  if (!line || line.status !== 'ACTIVE' || line.cancelledAt ||
      line.settlementApprovalId !== settlementApprovalId ||
      line.settlementApproval.status === 'CANCELLED' ||
      line.settlementApproval.vendorId !== vendorId || line.settlementApproval.currency !== 'TRY' ||
      line.deduction.vendorId !== vendorId || line.deduction.currency !== 'TRY' ||
      line.amountMinor !== line.deduction.amountMinor || line.amountMinor <= 0) {
    throw new Error('Financial Correction Deduction settlement source is no longer valid.');
  }
  return line;
}
