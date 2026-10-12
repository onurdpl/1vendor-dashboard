import { Prisma } from '@prisma/client';
import { reconcilePayoutOffsetAuthorityInTransaction } from './payout-offset-authority-diagnostics.service.js';

/** The caller owns the Vendor row lock and the Mark Paid transaction. */
export async function finalizeR1PayoutOffsetClaimsInTransaction(
  tx: Prisma.TransactionClient,
  input: { payoutBatchId: string; vendorId: string; currency: string; actorId: string; finalizedAt: Date },
) {
  if (!input.actorId.trim()) throw new Error('R1_FINALIZATION_ACTOR_REQUIRED');
  const batch = await tx.payoutBatch.findUnique({ where: { id: input.payoutBatchId },
    select: { vendorId: true, currency: true, status: true, paidAt: true } });
  if (!batch || batch.vendorId !== input.vendorId || batch.currency !== input.currency ||
      batch.status !== 'REVIEW' || batch.paidAt) throw new Error('R1_FINALIZATION_BATCH_STATE_INVALID');
  const claims = await tx.payoutOffsetClaim.findMany({
    where: { payoutBatchId: input.payoutBatchId }, orderBy: [{ reservedAt: 'asc' }, { id: 'asc' }],
  });
  if (!claims.length || claims.some((claim) => claim.status !== 'RESERVED' ||
      claim.vendorId !== input.vendorId || claim.currency !== input.currency ||
      !Number.isSafeInteger(claim.reservedAmountMinor) || claim.reservedAmountMinor <= 0)) {
    throw new Error('R1_FINALIZATION_CLAIM_STATE_INVALID');
  }
  const before = await reconcilePayoutOffsetAuthorityInTransaction(tx, {
    vendorId: input.vendorId, currency: input.currency,
  });
  if (before.status !== 'VERIFIED') throw new Error(`R1_FINALIZATION_AUTHORITY_NOT_VERIFIED:${before.reasons.join(',')}`);
  const refundGroups = new Map<string, number>();
  for (const claim of claims) {
    const sourceId = claim.settlementRefundAdjustmentId ?? claim.vendorDebtOriginEventId;
    const source = before.sources.find((item) => item.sourceType === claim.sourceType && item.sourceId === sourceId);
    if (!source || source.status !== 'VERIFIED' || source.remainingAmountMinor === null ||
        source.activeReservationMinor < claim.reservedAmountMinor) {
      throw new Error('R1_FINALIZATION_SOURCE_NOT_VERIFIED');
    }
    if (claim.sourceType === 'REFUND_ADJUSTMENT') {
      if (!claim.settlementRefundAdjustmentId || claim.vendorDebtOriginEventId) {
        throw new Error('R1_FINALIZATION_SOURCE_IDENTITY_INVALID');
      }
      refundGroups.set(claim.settlementRefundAdjustmentId,
        (refundGroups.get(claim.settlementRefundAdjustmentId) ?? 0) + claim.reservedAmountMinor);
    } else if (!claim.vendorDebtOriginEventId || claim.settlementRefundAdjustmentId) {
      throw new Error('R1_FINALIZATION_SOURCE_IDENTITY_INVALID');
    }
  }
  for (const [adjustmentId, amountMinor] of refundGroups) {
    const adjustment = await tx.settlementRefundAdjustment.findUnique({ where: { id: adjustmentId },
      select: { remainingAmountMinor: true, originalAmountMinor: true, appliedAmountMinor: true } });
    if (!adjustment || amountMinor <= 0 || amountMinor > adjustment.remainingAmountMinor ||
        adjustment.originalAmountMinor !== adjustment.appliedAmountMinor + adjustment.remainingAmountMinor) {
      throw new Error('R1_FINALIZATION_ADJUSTMENT_AMOUNT_INVALID');
    }
    const remaining = adjustment.remainingAmountMinor - amountMinor;
    const updated = await tx.settlementRefundAdjustment.updateMany({
      where: { id: adjustmentId, vendorId: input.vendorId, currencyCode: input.currency,
        status: { in: ['PENDING', 'PARTIALLY_APPLIED'] }, remainingAmountMinor: { gte: amountMinor } },
      data: { appliedAmountMinor: { increment: amountMinor }, remainingAmountMinor: { decrement: amountMinor },
        status: remaining === 0 ? 'APPLIED' : 'PARTIALLY_APPLIED' },
    });
    if (updated.count !== 1) throw new Error('R1_FINALIZATION_ADJUSTMENT_RACE');
    await tx.settlementRefundAdjustmentEvent.create({ data: {
      settlementRefundAdjustmentId: adjustmentId,
      eventType: remaining === 0 ? 'APPLIED' : 'PARTIALLY_APPLIED',
      metadataJson: { route: 'R1_PAYOUT_OFFSET', payoutBatchId: input.payoutBatchId,
        amountMinor, remainingAmountMinor: remaining, actorId: input.actorId },
    } });
  }
  for (const claim of claims) {
    if (claim.sourceType === 'VENDOR_DEBT') {
      await tx.vendorBalanceEvent.create({ data: {
        vendorId: input.vendorId, currency: input.currency, type: 'VENDOR_DEBT_OFFSET',
        amountMinor: claim.reservedAmountMinor, sourceType: 'r1_payout_offset_claim', sourceId: claim.id,
        payoutBatchId: input.payoutBatchId, idempotencyKey: `r1:${claim.id}:debt-offset`,
        metadataJson: { payoutOffsetClaimId: claim.id,
          vendorDebtOriginEventId: claim.vendorDebtOriginEventId,
          settlementApprovalId: claim.settlementApprovalId, actorId: input.actorId },
      } });
    }
    const updated = await tx.payoutOffsetClaim.updateMany({
      where: { id: claim.id, payoutBatchId: input.payoutBatchId, status: 'RESERVED' },
      data: { status: 'FINALIZED', finalizedBy: input.actorId, finalizedAt: input.finalizedAt },
    });
    if (updated.count !== 1) throw new Error('R1_FINALIZATION_CLAIM_RACE');
  }
  const after = await reconcilePayoutOffsetAuthorityInTransaction(tx, {
    vendorId: input.vendorId, currency: input.currency,
  });
  if (after.status !== 'VERIFIED') throw new Error(`R1_FINALIZATION_POSTCHECK_FAILED:${after.reasons.join(',')}`);
  return { claimIds: claims.map((claim) => claim.id), finalizedAmountMinor: claims.reduce(
    (sum, claim) => sum + claim.reservedAmountMinor, 0) };
}
