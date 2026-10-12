import { Prisma } from '@prisma/client';
import { reconcilePayoutOffsetAuthorityInTransaction } from './payout-offset-authority-diagnostics.service.js';

function minor(value: Prisma.Decimal): number {
  const scaled = value.mul(100);
  if (!scaled.isInteger() || !Number.isSafeInteger(scaled.toNumber())) {
    throw new Error('R1_PAYOUT_MONETARY_PRECISION_UNKNOWN');
  }
  return scaled.toNumber();
}

/** The caller owns the Vendor row lock; this never creates or finalizes claims. */
export async function assertR1PayoutMonetaryAuthority(
  tx: Prisma.TransactionClient,
  payoutBatchId: string,
  options: { requireCurrentOwnRefundCoverage?: boolean } = {},
) {
  const batch = await tx.payoutBatch.findUnique({ where: { id: payoutBatchId }, include: {
    lines: { include: { settlementApprovalLine: { include: { settlementApproval: true } } } },
    correctionCreditLines: { include: { settlementCreditLine: { include: { settlementApproval: true } } } },
    correctionDeductionLines: { include: { settlementDeductionLine: { include: { settlementApproval: true } } } },
    approvedDeductionLines: { include: { coverage: { include: { settlementApproval: true } } } },
    payoutOffsetClaims: true,
    vendorBalanceEvents: { where: { type: 'VENDOR_DEBT_OFFSET' } },
  } });
  if (!batch || !['DRAFT', 'REVIEW'].includes(batch.status) || batch.paidAt ||
      !Number.isSafeInteger(batch.r1OffsetTotalMinor) || batch.r1OffsetTotalMinor <= 0 ||
      !batch.lines.length || !batch.payoutOffsetClaims.length || batch.vendorBalanceEvents.length) {
    throw new Error('R1_PAYOUT_MONETARY_BATCH_INVALID');
  }
  const capacity = new Map<string, number>();
  let approvedBaseMinor = 0;
  for (const payoutLine of batch.lines) {
    const source = payoutLine.settlementApprovalLine;
    const approval = source?.settlementApproval;
    if (!source || !approval || approval.status !== 'APPROVED' || !approval.approvedAt ||
        approval.vendorId !== batch.vendorId || approval.currency !== batch.currency ||
        payoutLine.financeLedgerEntryId !== source.financeLedgerEntryId ||
        minor(payoutLine.amountSnapshot) !== source.payableImpactMinor) {
      throw new Error('R1_PAYOUT_APPROVED_LINEAGE_CHANGED');
    }
    capacity.set(approval.id, (capacity.get(approval.id) ?? 0) + source.payableImpactMinor);
    approvedBaseMinor += source.payableImpactMinor;
  }
  for (const payoutLine of batch.correctionCreditLines) {
    const source = payoutLine.settlementCreditLine;
    if (payoutLine.status !== 'ACTIVE' || source.status !== 'ACTIVE' ||
        source.settlementApproval.status !== 'APPROVED' ||
        source.settlementApproval.vendorId !== batch.vendorId ||
        source.settlementApproval.currency !== batch.currency ||
        !capacity.has(source.settlementApprovalId) || payoutLine.amountMinor !== source.amountMinor) {
      throw new Error('R1_PAYOUT_CREDIT_LINEAGE_CHANGED');
    }
    capacity.set(source.settlementApprovalId, capacity.get(source.settlementApprovalId)! + payoutLine.amountMinor);
    approvedBaseMinor += payoutLine.amountMinor;
  }
  for (const payoutLine of batch.correctionDeductionLines) {
    const source = payoutLine.settlementDeductionLine;
    if (payoutLine.status !== 'ACTIVE' || source.status !== 'ACTIVE' ||
        source.settlementApproval.status !== 'APPROVED' ||
        source.settlementApproval.vendorId !== batch.vendorId ||
        source.settlementApproval.currency !== batch.currency ||
        !capacity.has(source.settlementApprovalId) || payoutLine.amountMinor !== source.amountMinor) {
      throw new Error('R1_PAYOUT_DEDUCTION_LINEAGE_CHANGED');
    }
    capacity.set(source.settlementApprovalId, capacity.get(source.settlementApprovalId)! - payoutLine.amountMinor);
    approvedBaseMinor -= payoutLine.amountMinor;
  }
  for (const payoutLine of batch.approvedDeductionLines) {
    const source = payoutLine.coverage;
    if (payoutLine.status !== 'ACTIVE' || source.status !== 'ACTIVE' ||
        source.settlementApproval.status !== 'APPROVED' ||
        source.settlementApproval.vendorId !== batch.vendorId ||
        source.settlementApproval.currency !== batch.currency ||
        !capacity.has(source.settlementApprovalId) || payoutLine.amountMinor !== source.amountMinor) {
      throw new Error('R1_PAYOUT_APPROVED_DEDUCTION_LINEAGE_CHANGED');
    }
    capacity.set(source.settlementApprovalId, capacity.get(source.settlementApprovalId)! - payoutLine.amountMinor);
    approvedBaseMinor -= payoutLine.amountMinor;
  }
  const claims = batch.payoutOffsetClaims;
  const offsetMinor = claims.reduce((sum, claim) => sum + claim.reservedAmountMinor, 0);
  if (!Number.isSafeInteger(approvedBaseMinor) || approvedBaseMinor <= 0 ||
      !Number.isSafeInteger(offsetMinor) || offsetMinor !== batch.r1OffsetTotalMinor ||
      offsetMinor > approvedBaseMinor || minor(batch.netAmount) !== approvedBaseMinor - offsetMinor ||
      claims.some((claim) => claim.status !== 'RESERVED' || claim.vendorId !== batch.vendorId ||
        claim.currency !== batch.currency || claim.reservedAmountMinor <= 0 ||
        !capacity.has(claim.settlementApprovalId))) {
    throw new Error('R1_PAYOUT_FROZEN_NET_OR_CLAIMS_CHANGED');
  }
  for (const [approvalId, available] of capacity) {
    const claimed = claims.filter((claim) => claim.settlementApprovalId === approvalId)
      .reduce((sum, claim) => sum + claim.reservedAmountMinor, 0);
    if (available < 0 || claimed > available) throw new Error('R1_PAYOUT_APPROVAL_CAPACITY_CHANGED');
  }
  // An original approval's own post-approval refund cannot be paid while any
  // portion of that exact outstanding adjustment remains outside this payout.
  const ownAdjustments = options.requireCurrentOwnRefundCoverage ? await tx.settlementRefundAdjustment.findMany({ where: {
    originalSettlementApprovalLineId: { in: batch.lines.map((line) => line.settlementApprovalLineId!) },
    status: { in: ['PENDING', 'PARTIALLY_APPLIED'] }, remainingAmountMinor: { gt: 0 },
  }, select: { id: true, remainingAmountMinor: true, vendorId: true, currencyCode: true } }) : [];
  for (const adjustment of ownAdjustments) {
    const coveredMinor = claims.filter((claim) => claim.settlementRefundAdjustmentId === adjustment.id)
      .reduce((sum, claim) => sum + claim.reservedAmountMinor, 0);
    if (adjustment.vendorId !== batch.vendorId || adjustment.currencyCode !== batch.currency ||
        coveredMinor !== adjustment.remainingAmountMinor) {
      throw new Error('R1_OWN_APPROVAL_REFUND_NOT_FULLY_RESERVED');
    }
  }
  const diagnostic = await reconcilePayoutOffsetAuthorityInTransaction(tx, {
    vendorId: batch.vendorId, currency: batch.currency,
  });
  if (diagnostic.status !== 'VERIFIED') {
    throw new Error(`R1_PAYOUT_SOURCE_AUTHORITY_CHANGED:${diagnostic.reasons.join(',')}`);
  }
  for (const claim of claims) {
    const sourceId = claim.settlementRefundAdjustmentId ?? claim.vendorDebtOriginEventId;
    const source = diagnostic.sources.find((item) => item.sourceType === claim.sourceType && item.sourceId === sourceId);
    if (!source || source.status !== 'VERIFIED' || source.activeReservationMinor < claim.reservedAmountMinor) {
      throw new Error('R1_PAYOUT_SOURCE_CLAIM_NOT_VERIFIED');
    }
  }
  return { batch, claims, approvedBaseMinor, offsetMinor, netCashMinor: approvedBaseMinor - offsetMinor };
}
