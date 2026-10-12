import { Prisma, type PayoutOffsetSourceType } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { calculateRefundOffsetAmounts } from './refund-offset.service.js';
import { reconcilePayoutOffsetAuthorityInTransaction } from './payout-offset-authority-diagnostics.service.js';

type ReservationInput = {
  vendorId: string;
  currency: string;
  payoutBatchId: string;
  requestId: string;
  actorId: string;
};

const ACTIVE_BATCH_STATUSES = ['DRAFT', 'REVIEW', 'APPROVED', 'EXECUTION_PENDING', 'PAID', 'PAID_PLACEHOLDER'] as const;

function toMinor(value: Prisma.Decimal): number {
  const amount = value.mul(100);
  if (!amount.isInteger() || !Number.isSafeInteger(amount.toNumber())) {
    throw new Error('R1_PAYOUT_MONETARY_PRECISION_UNKNOWN');
  }
  return amount.toNumber();
}

function assertMinor(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('R1_PAYOUT_MONETARY_AUTHORITY_INVALID');
}

/**
 * Standalone Phase 2 reservation path. No route, worker or ordinary payout path
 * calls it; reservations alone never change payout or source money.
 */
export async function reserveVerifiedPayoutOffsets(input: ReservationInput) {
  return prisma.$transaction((tx) => reserveVerifiedPayoutOffsetsInTransaction(tx, input), {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  });
}

/** Caller must hold the Vendor row lock in a Serializable transaction. */
export async function reserveVerifiedPayoutOffsetsInTransaction(
  tx: Prisma.TransactionClient,
  input: ReservationInput,
  options: { allowExactOwnOriginRefund?: boolean } = {},
) {
  if (![input.vendorId, input.currency, input.payoutBatchId, input.requestId, input.actorId]
    .every((value) => value.trim()) || input.requestId.includes(':')) {
    throw new Error('R1_RESERVATION_IDENTITY_INVALID');
  }
    // This is the same first lock taken by settlement draft and ordinary payout preparation.
    const vendors = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id" FROM "Vendor" WHERE "id" = ${input.vendorId} FOR UPDATE
    `);
    if (vendors.length !== 1) throw new Error('R1_VENDOR_NOT_FOUND');

    const batch = await tx.payoutBatch.findUnique({
      where: { id: input.payoutBatchId },
      include: {
        lines: { include: { settlementApprovalLine: { include: { settlementApproval: true } } } },
        correctionCreditLines: { include: { settlementCreditLine: { include: { settlementApproval: true } } } },
        correctionDeductionLines: { include: { settlementDeductionLine: { include: { settlementApproval: true } } } },
        approvedDeductionLines: { include: { coverage: { include: { settlementApproval: true } } } },
      },
    });
    if (!batch || batch.vendorId !== input.vendorId || batch.currency !== input.currency ||
        batch.status !== 'DRAFT' || batch.paidAt || batch.lines.length === 0) {
      throw new Error('R1_PAYOUT_BATCH_NOT_ELIGIBLE');
    }
    // The current live path can already create an aggregate VendorDebt offset. Never
    // layer an exact-source R1 reservation over an unattributed aggregate offset.
    if (await tx.vendorBalanceEvent.count({
      where: { payoutBatchId: batch.id, type: 'VENDOR_DEBT_OFFSET' },
    })) throw new Error('R1_AGGREGATE_DEBT_OFFSET_CONFLICT');

    const requestPrefix = `r1:${input.requestId}:`;
    const priorRequest = await tx.payoutOffsetClaim.findMany({
      where: { idempotencyKey: { startsWith: requestPrefix } },
      orderBy: [{ settlementApprovalId: 'asc' }, { id: 'asc' }],
    });
    const batchClaims = await tx.payoutOffsetClaim.findMany({ where: { payoutBatchId: batch.id } });
    if (priorRequest.length || batchClaims.length) {
      if (priorRequest.length === 0 || priorRequest.length !== batchClaims.length ||
          priorRequest.some((claim) => claim.payoutBatchId !== batch.id || claim.vendorId !== input.vendorId ||
            claim.currency !== input.currency || claim.status !== 'RESERVED' || claim.reservedBy !== input.actorId) ||
          batchClaims.some((claim) => !claim.idempotencyKey.startsWith(requestPrefix))) {
        throw new Error('R1_RESERVATION_IDEMPOTENCY_CONFLICT');
      }
      return { writesPerformed: false as const, claims: priorRequest };
    }

    const capacity = new Map<string, { approvedAt: Date; remainingMinor: number }>();
    let totalBaseMinor = 0;
    for (const payoutLine of batch.lines) {
      const line = payoutLine.settlementApprovalLine;
      const approval = line?.settlementApproval;
      if (!line || !approval || approval.status !== 'APPROVED' || !approval.approvedAt ||
          approval.vendorId !== input.vendorId || approval.currency !== input.currency ||
          payoutLine.financeLedgerEntryId !== line.financeLedgerEntryId ||
          toMinor(payoutLine.amountSnapshot) !== line.payableImpactMinor) {
        throw new Error('R1_APPROVED_SETTLEMENT_LINEAGE_INVALID');
      }
      const existing = capacity.get(approval.id);
      if (existing && existing.approvedAt.getTime() !== approval.approvedAt.getTime()) {
        throw new Error('R1_APPROVED_SETTLEMENT_LINEAGE_INVALID');
      }
      capacity.set(approval.id, {
        approvedAt: approval.approvedAt,
        remainingMinor: (existing?.remainingMinor ?? 0) + line.payableImpactMinor,
      });
      totalBaseMinor += line.payableImpactMinor;
    }
    const selectedLineIds = batch.lines.map((line) => line.settlementApprovalLineId!);
    const duplicateMembership = await tx.payoutBatchLine.count({
      where: { settlementApprovalLineId: { in: selectedLineIds }, payoutBatchId: { not: batch.id },
        payoutBatch: { status: { in: [...ACTIVE_BATCH_STATUSES] } } },
    });
    if (duplicateMembership) throw new Error('R1_APPROVED_LINE_ALREADY_IN_ACTIVE_PAYOUT');

    for (const payoutLine of batch.correctionCreditLines) {
      const source = payoutLine.settlementCreditLine;
      const approval = source.settlementApproval;
      if (payoutLine.status !== 'ACTIVE' || source.status !== 'ACTIVE' ||
          approval.status !== 'APPROVED' || approval.vendorId !== input.vendorId ||
          approval.currency !== input.currency || !capacity.has(approval.id) ||
          payoutLine.amountMinor !== source.amountMinor || payoutLine.amountMinor <= 0) {
        throw new Error('R1_CORRECTION_CREDIT_LINEAGE_INVALID');
      }
      capacity.get(approval.id)!.remainingMinor += payoutLine.amountMinor;
      totalBaseMinor += payoutLine.amountMinor;
    }
    for (const payoutLine of batch.correctionDeductionLines) {
      const source = payoutLine.settlementDeductionLine;
      const approval = source.settlementApproval;
      if (payoutLine.status !== 'ACTIVE' || source.status !== 'ACTIVE' ||
          approval.status !== 'APPROVED' || approval.vendorId !== input.vendorId ||
          approval.currency !== input.currency || !capacity.has(approval.id) ||
          payoutLine.amountMinor !== source.amountMinor || payoutLine.amountMinor <= 0) {
        throw new Error('R1_CORRECTION_DEDUCTION_LINEAGE_INVALID');
      }
      capacity.get(approval.id)!.remainingMinor -= payoutLine.amountMinor;
      totalBaseMinor -= payoutLine.amountMinor;
    }
    for (const payoutLine of batch.approvedDeductionLines) {
      const coverage = payoutLine.coverage;
      const approval = coverage.settlementApproval;
      if (payoutLine.status !== 'ACTIVE' || coverage.status !== 'ACTIVE' ||
          approval.status !== 'APPROVED' || approval.vendorId !== input.vendorId ||
          approval.currency !== input.currency || !capacity.has(approval.id) ||
          payoutLine.amountMinor !== coverage.amountMinor || payoutLine.amountMinor <= 0) {
        throw new Error('R1_APPROVED_DEDUCTION_LINEAGE_INVALID');
      }
      capacity.get(approval.id)!.remainingMinor -= payoutLine.amountMinor;
      totalBaseMinor -= payoutLine.amountMinor;
    }
    for (const value of capacity.values()) assertMinor(value.remainingMinor);
    assertMinor(totalBaseMinor);
    if (toMinor(batch.netAmount) !== totalBaseMinor) {
      throw new Error('R1_PAYOUT_BASE_DOES_NOT_MATCH_APPROVED_AUTHORITY');
    }
    const oldestSelectedAt = [...capacity.values()]
      .reduce((oldest, item) => item.approvedAt < oldest ? item.approvedAt : oldest,
        new Date(8640000000000000));
    const earlierApprovals = await tx.settlementApproval.findMany({
      where: { vendorId: input.vendorId, currency: input.currency, status: 'APPROVED',
        approvedAt: { lt: oldestSelectedAt }, id: { notIn: [...capacity.keys()] } },
      select: {
        id: true, netPayableMinor: true, correctionCreditMinor: true, correctionDeductionMinor: true,
        lines: { select: { financeLedgerEntry: { select: { payoutStatus: true } },
          payableImpactMinor: true,
          payoutBatchLines: { where: { payoutBatch: { status: { in: [...ACTIVE_BATCH_STATUSES] } } },
            select: { id: true, payoutBatch: { select: { status: true, paidAt: true } } } } } },
        payoutOffsetClaims: { where: { status: 'RESERVED' }, select: { reservedAmountMinor: true } },
        originalRefundAdjustments: { where: { status: { in: ['PENDING', 'PARTIALLY_APPLIED'] },
          remainingAmountMinor: { gt: 0 } }, select: { id: true } },
      },
    });
    for (const approval of earlierApprovals) {
      if (approval.lines.length > 0 && approval.lines.every((line) =>
        line.financeLedgerEntry.payoutStatus === 'PAID' &&
        line.payoutBatchLines.some((membership) => membership.payoutBatch.status === 'PAID' &&
          membership.payoutBatch.paidAt !== null))) continue;
      // The existing payout selector may skip an approval held by its own
      // unresolved post-approval refund. Any other omission needs a fresh
      // eligibility proof, which this isolated Phase 2 writer does not have.
      if (approval.originalRefundAdjustments.length > 0 &&
          approval.lines.every((line) => line.payoutBatchLines.length === 0)) continue;
      const reservedCapacity = approval.payoutOffsetClaims
        .reduce((sum, claim) => sum + claim.reservedAmountMinor, 0);
      if (approval.correctionCreditMinor === 0 && approval.correctionDeductionMinor === 0 &&
          approval.lines.reduce((sum, line) => sum + line.payableImpactMinor, 0) === approval.netPayableMinor &&
          approval.netPayableMinor > 0 && reservedCapacity >= approval.netPayableMinor) continue;
      throw new Error('R1_OLDER_APPROVED_SETTLEMENT_ELIGIBILITY_UNKNOWN');
    }

    const diagnostic = await reconcilePayoutOffsetAuthorityInTransaction(tx, {
      vendorId: input.vendorId, currency: input.currency,
    });
    if (diagnostic.status !== 'VERIFIED' || diagnostic.sources.some((source) => source.status !== 'VERIFIED')) {
      throw new Error(`R1_OFFSET_AUTHORITY_NOT_VERIFIED:${diagnostic.reasons.join(',')}`);
    }
    for (const source of diagnostic.sources) {
      if (!source.verifiedAt || source.unreservedAmountMinor === null) {
        throw new Error('R1_SOURCE_VERIFICATION_TIME_OR_BALANCE_UNKNOWN');
      }
      if (source.sourceType === 'REFUND_ADJUSTMENT') {
        const adjustment = await tx.settlementRefundAdjustment.findUnique({
          where: { id: source.sourceId },
          select: { originalSettlementApprovalId: true, originalSettlementApprovalLineId: true,
            originalSettlementCommissionInvoiceId: true,
            refundFinanceLedgerEntryId: true,
            originalSettlementApproval: { select: { status: true, vendorId: true, currency: true } } },
        });
        const ownOrigin = !!adjustment?.originalSettlementApprovalId &&
          capacity.has(adjustment.originalSettlementApprovalId) &&
          options.allowExactOwnOriginRefund === true;
        const accepted = ownOrigin ? await tx.refundEvidenceSnapshot.findUnique({
          where: { refundFinanceLedgerEntryId: adjustment.refundFinanceLedgerEntryId },
          select: { historicalSaleFinanceLedgerEntryId: true, refundFinanceLedgerEntryId: true },
        }) : null;
        const exactOwnOrigin = ownOrigin && !!accepted &&
          accepted.refundFinanceLedgerEntryId === source.refundFinanceLedgerEntryId &&
          batch.lines.some((line) => line.settlementApprovalLineId === adjustment.originalSettlementApprovalLineId &&
            line.financeLedgerEntryId === accepted.historicalSaleFinanceLedgerEntryId &&
            line.settlementApprovalLine?.settlementApprovalId === adjustment.originalSettlementApprovalId);
        // An unpaid original approval has a separate refund hold. It cannot
        // supply the capacity that discharges its own post-approval refund.
        if (!adjustment || !adjustment.originalSettlementApprovalId ||
            !adjustment.originalSettlementApprovalLineId ||
            !adjustment.originalSettlementApproval ||
            adjustment.originalSettlementApproval.status !== 'APPROVED' ||
            adjustment.originalSettlementApproval.vendorId !== input.vendorId ||
            adjustment.originalSettlementApproval.currency !== input.currency ||
            (capacity.has(adjustment.originalSettlementApprovalId) && !exactOwnOrigin)) {
          throw new Error('R1_REFUND_ADJUSTMENT_ORIGIN_NOT_ELIGIBLE_FOR_THIS_PAYOUT');
        }
      }
      if (!source.refundFinanceLedgerEntryId) continue;
      const ledger = await tx.financeLedgerEntry.findUnique({
        where: { id: source.refundFinanceLedgerEntryId },
        select: {
          id: true, amount: true, entryType: true, vendorId: true, vendorAllocationId: true,
          commissionPercentSnapshot: true, commissionVatPercentSnapshot: true,
          refundEvidenceSnapshot: { select: {
            monetaryClassification: true, refundTotalAmount: true, evidenceHash: true,
            historicalSaleFinanceLedgerEntry: { select: {
              commissionPercentSnapshot: true, commissionVatPercentSnapshot: true, payoutStatus: true,
            } },
          } },
        },
      });
      if (!ledger || ledger.entryType.toLowerCase() !== 'refund' || ledger.vendorId !== input.vendorId ||
          !ledger.refundEvidenceSnapshot || ledger.refundEvidenceSnapshot.monetaryClassification !== 'MONETARY_REFUND' ||
          !ledger.refundEvidenceSnapshot.evidenceHash ||
          ledger.refundEvidenceSnapshot.refundTotalAmount.lessThan(ledger.amount)) {
        throw new Error('R1_ACCEPTED_REFUND_MONETARY_EVIDENCE_INVALID');
      }
      if (source.sourceType === 'VENDOR_DEBT' &&
          ledger.refundEvidenceSnapshot.historicalSaleFinanceLedgerEntry.payoutStatus !== 'PAID') {
        throw new Error('R1_REFUND_DEBT_REQUIRES_PAID_HISTORICAL_SALE');
      }
      const amount = calculateRefundOffsetAmounts({
        refundAmount: ledger.amount,
        commissionPercentSnapshot: ledger.commissionPercentSnapshot ??
          ledger.refundEvidenceSnapshot.historicalSaleFinanceLedgerEntry.commissionPercentSnapshot,
        commissionVatPercentSnapshot: ledger.commissionVatPercentSnapshot ??
          ledger.refundEvidenceSnapshot.historicalSaleFinanceLedgerEntry.commissionVatPercentSnapshot,
      }).vendorPayableReversalMinor;
      if (amount !== source.originalAmountMinor) {
        throw new Error('R1_SOURCE_AMOUNT_DIFFERS_FROM_FROZEN_REFUND_EVIDENCE');
      }
    }

    const orderedApprovals = [...capacity.entries()].sort((a, b) =>
      a[1].approvedAt.getTime() - b[1].approvedAt.getTime() || a[0].localeCompare(b[0]));
    const sources = diagnostic.sources.filter((source) => (source.unreservedAmountMinor ?? 0) > 0)
      .sort((a, b) => a.verifiedAt!.localeCompare(b.verifiedAt!) ||
        a.sourceType.localeCompare(b.sourceType) || a.sourceId.localeCompare(b.sourceId));
    const sourceKey = (source: { sourceType: string; sourceId: string }) => `${source.sourceType}:${source.sourceId}`;
    const remainingBySource = new Map(sources.map((source) => [sourceKey(source), source.unreservedAmountMinor!]));
    const claims = [];
    for (const [approvalId, approvalCapacity] of orderedApprovals) {
      let availableMinor = approvalCapacity.remainingMinor;
      for (const source of sources) {
        if (availableMinor === 0) break;
        const sourceRemainingMinor = remainingBySource.get(sourceKey(source))!;
        const reservedAmountMinor = Math.min(availableMinor, sourceRemainingMinor);
        if (reservedAmountMinor === 0) continue;
        assertMinor(reservedAmountMinor);
        const claim = await tx.payoutOffsetClaim.create({ data: {
          vendorId: input.vendorId, currency: input.currency, payoutBatchId: batch.id,
          settlementApprovalId: approvalId,
          sourceType: source.sourceType as PayoutOffsetSourceType,
          settlementRefundAdjustmentId: source.sourceType === 'REFUND_ADJUSTMENT' ? source.sourceId : null,
          vendorDebtOriginEventId: source.sourceType === 'VENDOR_DEBT' ? source.sourceId : null,
          vendorDebtOriginEventType: source.sourceType === 'VENDOR_DEBT' ? 'VENDOR_DEBT_CREATED' : null,
          reservedAmountMinor, reservedBy: input.actorId,
          idempotencyKey: `${requestPrefix}${batch.id}:${approvalId}:${source.sourceType}:${source.sourceId}`,
        } });
        claims.push(claim);
        remainingBySource.set(sourceKey(source), sourceRemainingMinor - reservedAmountMinor);
        availableMinor -= reservedAmountMinor;
      }
    }
    return { writesPerformed: claims.length > 0, claims };
}
