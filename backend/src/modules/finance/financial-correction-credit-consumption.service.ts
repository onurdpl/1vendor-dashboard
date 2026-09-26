import type { Prisma } from '@prisma/client';

export async function getAvailableFinancialCorrectionCredits(db: Prisma.TransactionClient, vendorId: string) {
  const credits = await db.financialCorrectionCredit.findMany({
    where: { vendorId, currency: 'TRY', settlementLines: { none: { status: 'ACTIVE' } } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true, vendorId: true, amountMinor: true, currency: true, authorityId: true,
      authority: { select: { vendorId: true, currency: true, economicDirection: true,
        applicationRoute: true, vendorPayableDifferenceMinor: true, appliedAt: true,
        historicalPayoutBatchId: true, historicalPayoutPaidAt: true } } },
  });
  for (const credit of credits) assertFinancialCorrectionCreditSource(credit);
  return credits;
}

export function assertFinancialCorrectionCreditSource(credit: {
  vendorId: string;
  currency: string;
  amountMinor: number;
  authority: { vendorId: string; currency: string; economicDirection: string;
    applicationRoute: string; vendorPayableDifferenceMinor: number; appliedAt: Date;
    historicalPayoutBatchId: string | null; historicalPayoutPaidAt: Date | null };
}) {
  if (credit.currency !== 'TRY' || credit.amountMinor <= 0 ||
      credit.authority.vendorId !== credit.vendorId || credit.authority.currency !== 'TRY' ||
      credit.authority.economicDirection !== 'VENDOR_CREDIT' ||
      !((credit.authority.applicationRoute === 'PAID_VENDOR_CREDIT' &&
        credit.authority.historicalPayoutBatchId && credit.authority.historicalPayoutPaidAt) ||
        (credit.authority.applicationRoute === 'BEFORE_SETTLEMENT_VENDOR_CREDIT' &&
          !credit.authority.historicalPayoutBatchId && !credit.authority.historicalPayoutPaidAt) ||
        (credit.authority.applicationRoute === 'APPROVED_SETTLEMENT_VENDOR_CREDIT' &&
          !credit.authority.historicalPayoutBatchId && !credit.authority.historicalPayoutPaidAt) ||
        (credit.authority.applicationRoute === 'DRAFT_PAYOUT_VENDOR_CREDIT' &&
          !!credit.authority.historicalPayoutBatchId && !credit.authority.historicalPayoutPaidAt) ||
        (credit.authority.applicationRoute === 'REVIEW_PAYOUT_VENDOR_CREDIT' &&
          !!credit.authority.historicalPayoutBatchId && !credit.authority.historicalPayoutPaidAt)) ||
      credit.authority.vendorPayableDifferenceMinor !== -credit.amountMinor ||
      !credit.authority.appliedAt) {
    throw new Error('Financial Correction Credit authority is inconsistent.');
  }
}

export async function assertActiveFinancialCorrectionCreditSettlement(
  db: Prisma.TransactionClient,
  lineId: string,
  settlementApprovalId: string,
  vendorId: string,
) {
  const line = await db.financialCorrectionCreditSettlementLine.findUnique({
    where: { id: lineId },
    include: { credit: { include: { authority: true } }, settlementApproval: true },
  });
  if (line) assertFinancialCorrectionCreditSource(line.credit);
  if (!line || line.status !== 'ACTIVE' || line.cancelledAt ||
      line.settlementApprovalId !== settlementApprovalId ||
      line.settlementApproval.status === 'CANCELLED' ||
      line.settlementApproval.vendorId !== vendorId || line.settlementApproval.currency !== 'TRY' ||
      line.credit.vendorId !== vendorId || line.credit.currency !== 'TRY' ||
      line.amountMinor !== line.credit.amountMinor || line.amountMinor <= 0) {
    throw new Error('Financial Correction Credit settlement source is no longer valid.');
  }
  return line;
}
