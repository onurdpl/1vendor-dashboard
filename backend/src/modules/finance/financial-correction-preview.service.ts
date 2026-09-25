import { isDeepStrictEqual } from 'node:util';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import {
  normalizeRefundEvidence,
  REFUND_EVIDENCE_HASH_ALGORITHM,
  REFUND_EVIDENCE_NORMALIZATION_VERSION,
  REFUND_EVIDENCE_VERSION,
  verifyNormalizedRefundEvidenceHash,
  type ResolvedRefundEvidenceInput,
} from './refund-evidence-normalizer.service.js';
import { calculateRefundOffsetAmounts } from './refund-offset.service.js';

export class FinancialCorrectionPreviewError extends Error {
  constructor(readonly reasonCode: string) {
    super(`Financial correction preview unavailable: ${reasonCode}.`);
    this.name = 'FinancialCorrectionPreviewError';
  }
}

function fail(reasonCode: string): never {
  throw new FinancialCorrectionPreviewError(reasonCode);
}

function moneyMinor(value: unknown, reasonCode: string): number {
  try {
    const decimal = new Prisma.Decimal(String(value));
    const minor = decimal.times(100);
    if (!decimal.isFinite() || decimal.isNegative() || !minor.isInteger() ||
        !Number.isSafeInteger(minor.toNumber())) {
      return fail(reasonCode);
    }
    return minor.toNumber();
  } catch {
    return fail(reasonCode);
  }
}

function rate(value: unknown, reasonCode: string): string {
  if (value === null || value === undefined) return fail(reasonCode);
  try {
    const decimal = new Prisma.Decimal(String(value));
    if (!decimal.isFinite() || decimal.isNegative() || decimal.greaterThan(100)) return fail(reasonCode);
    return decimal.toString();
  } catch {
    return fail(reasonCode);
  }
}

function evidence(input: {
  sourceShopifyRefundId: string;
  sourceShopifyOrderId: string;
  vendorAllocationId: string;
  historicalEconomicVendorId: string;
  historicalSaleFinanceLedgerEntryId: string;
  supersededSaleLedgerIdsJson: unknown;
  refundTotalAmount: unknown;
  currency: string;
  normalizedEvidenceJson: unknown;
  evidenceHash: string;
  hashAlgorithm: string;
  evidenceVersion: number;
  normalizationVersion: number;
}, reasonCode: string) {
  if (input.evidenceVersion !== REFUND_EVIDENCE_VERSION ||
      input.normalizationVersion !== REFUND_EVIDENCE_NORMALIZATION_VERSION ||
      input.hashAlgorithm !== REFUND_EVIDENCE_HASH_ALGORITHM) return fail(`${reasonCode}_version`);
  try {
    if (!verifyNormalizedRefundEvidenceHash(input)) return fail(`${reasonCode}_hash`);
    const body = input.normalizedEvidenceJson as Record<string, unknown>;
    if (!body || typeof body !== 'object' || Array.isArray(body)) return fail(`${reasonCode}_malformed`);
    const ownership = body.ownership as Record<string, unknown>;
    if (!ownership || typeof ownership !== 'object' || Array.isArray(ownership)) return fail(`${reasonCode}_malformed`);
    const normalized = normalizeRefundEvidence({
      sourceShopifyRefundId: input.sourceShopifyRefundId,
      sourceShopifyOrderId: input.sourceShopifyOrderId,
      vendorAllocationId: input.vendorAllocationId,
      monetaryClassification: body.monetaryClassification as 'MONETARY_REFUND',
      refundTotalAmount: String(input.refundTotalAmount),
      currency: input.currency,
      transactions: body.transactions as ResolvedRefundEvidenceInput['transactions'],
      refundLines: body.refundLines as ResolvedRefundEvidenceInput['refundLines'],
      historicalEconomicVendorId: input.historicalEconomicVendorId,
      historicalSaleFinanceLedgerEntryId: input.historicalSaleFinanceLedgerEntryId,
      supersededSaleLedgerIds: input.supersededSaleLedgerIdsJson as string[],
    });
    if (normalized.evidenceHash !== input.evidenceHash ||
        !isDeepStrictEqual(normalized.normalizedEvidenceJson, body) ||
        !isDeepStrictEqual(normalized.normalizedOwnershipJson, ownership)) return fail(`${reasonCode}_mismatch`);
    return normalized;
  } catch (error) {
    if (error instanceof FinancialCorrectionPreviewError) throw error;
    return fail(`${reasonCode}_malformed`);
  }
}

function allocationAmount(lines: ResolvedRefundEvidenceInput['refundLines'], reasonCode: string): number {
  if (lines.length === 0) return fail(`${reasonCode}_empty_lines`);
  const total = lines.reduce((sum, line) => sum + moneyMinor(line.subtotalAmount, `${reasonCode}_line_amount`), 0);
  if (!Number.isSafeInteger(total)) return fail(`${reasonCode}_line_total`);
  return total;
}

function state(amountMinor: number, commissionPercent: string, commissionVatPercent: string) {
  const amounts = calculateRefundOffsetAmounts({
    refundAmount: (amountMinor / 100).toFixed(2),
    commissionPercentSnapshot: commissionPercent,
    commissionVatPercentSnapshot: commissionVatPercent,
  });
  if (amounts.refundMinor !== amountMinor) return fail('rounding_mismatch');
  return {
    refundAmountMinor: amounts.refundMinor,
    commissionReversalMinor: amounts.commissionReversalMinor,
    commissionVatReversalMinor: amounts.commissionVatReversalMinor,
    vendorPayableReversalMinor: amounts.vendorPayableReversalMinor,
  };
}

/** Reads only persisted terminal-review authority; it neither approves nor applies money. */
export async function previewTerminalFinancialCorrection(
  reviewId: string,
  db: Pick<typeof prisma, 'refundTerminalEvidenceReview'> = prisma,
) {
  const review = await db.refundTerminalEvidenceReview.findUnique({
    where: { id: reviewId },
    include: {
      storedEvidenceSnapshot: {
        include: { refundFinanceLedgerEntry: true, historicalSaleFinanceLedgerEntry: true },
      },
      incomingConflictEvidence: true,
      terminalRefundFinanceLedgerEntry: true,
    },
  });
  if (!review) return fail('terminal_review_missing');
  if (review.status !== 'RESOLVED' || review.resolutionOutcome !== 'CORRECTION_REQUIRED') {
    return fail('correction_required_outcome_missing');
  }
  const accepted = review.storedEvidenceSnapshot;
  const incoming = review.incomingConflictEvidence;
  if (!accepted) return fail('accepted_evidence_missing');
  if (!incoming) return fail('incoming_evidence_missing');
  if (accepted.monetaryClassification !== 'MONETARY_REFUND' ||
      !review.refundRecordId || review.refundRecordId !== accepted.refundRecordId) {
    return fail('accepted_refund_identity_mismatch');
  }

  if (review.sourceShopifyRefundId !== accepted.sourceShopifyRefundId ||
      review.sourceShopifyRefundId !== incoming.sourceShopifyRefundId) return fail('refund_identity_mismatch');
  if (review.sourceShopifyOrderId !== accepted.sourceShopifyOrderId ||
      review.sourceShopifyOrderId !== incoming.sourceShopifyOrderId) return fail('order_identity_mismatch');
  if (review.vendorAllocationId !== accepted.vendorAllocationId ||
      review.vendorAllocationId !== incoming.vendorAllocationId) return fail('allocation_identity_mismatch');
  if (review.economicVendorId !== accepted.historicalEconomicVendorId ||
      review.economicVendorId !== incoming.economicVendorId) return fail('economic_vendor_mismatch');
  if (accepted.historicalSaleFinanceLedgerEntryId !== incoming.historicalSaleFinanceLedgerEntryId ||
      !isDeepStrictEqual(accepted.supersededSaleLedgerIdsJson, incoming.supersededSaleLedgerIdsJson)) {
    return fail('sale_lineage_mismatch');
  }
  if (accepted.currency !== 'TRY' || incoming.currency !== 'TRY') return fail('currency_not_try');
  if (review.storedEvidenceHash !== accepted.evidenceHash ||
      review.incomingEvidenceHash !== incoming.evidenceHash) return fail('review_evidence_hash_mismatch');

  const acceptedEvidence = evidence(accepted, 'accepted_evidence');
  const incomingEvidence = evidence({
    ...incoming,
    historicalEconomicVendorId: incoming.economicVendorId,
  }, 'incoming_evidence');
  if (!isDeepStrictEqual(accepted.normalizedRefundLinesJson, acceptedEvidence.normalizedRefundLinesJson) ||
      !isDeepStrictEqual(accepted.normalizedTransactionsJson, acceptedEvidence.normalizedTransactionsJson) ||
      !isDeepStrictEqual(accepted.normalizedOwnershipJson, acceptedEvidence.normalizedOwnershipJson)) {
    return fail('accepted_evidence_columns_mismatch');
  }

  const sale = accepted.historicalSaleFinanceLedgerEntry;
  const refund = accepted.refundFinanceLedgerEntry;
  if (sale.id !== accepted.historicalSaleFinanceLedgerEntryId || sale.entryType !== 'sale' ||
      sale.vendorId !== review.economicVendorId || sale.vendorAllocationId !== review.vendorAllocationId) {
    return fail('historical_sale_authority_mismatch');
  }
  if (refund.id !== accepted.refundFinanceLedgerEntryId ||
      refund.id !== review.terminalRefundFinanceLedgerEntryId ||
      refund.id !== review.terminalRefundFinanceLedgerEntry.id ||
      refund.entryType !== 'refund' || refund.vendorId !== review.economicVendorId ||
      refund.vendorAllocationId !== review.vendorAllocationId ||
      refund.voidedAt || refund.supersededByLedgerId) return fail('accepted_refund_ledger_mismatch');
  const acceptedAmount = allocationAmount(acceptedEvidence.normalizedRefundLinesJson, 'accepted');
  const correctedAmount = allocationAmount(incomingEvidence.normalizedRefundLinesJson, 'incoming');
  if (moneyMinor(refund.amount, 'accepted_refund_ledger_amount') !== acceptedAmount ||
      moneyMinor(review.terminalRefundFinanceLedgerEntry.amount, 'terminal_refund_ledger_amount') !== acceptedAmount) {
    return fail('accepted_refund_ledger_amount_mismatch');
  }
  const commissionPercent = rate(sale.commissionPercentSnapshot, 'historical_commission_missing');
  const commissionVatPercent = rate(sale.commissionVatPercentSnapshot, 'historical_commission_vat_missing');
  if (refund.commissionPercentSnapshot === null || refund.commissionVatPercentSnapshot === null ||
      !new Prisma.Decimal(commissionPercent).equals(refund.commissionPercentSnapshot) ||
      !new Prisma.Decimal(commissionVatPercent).equals(refund.commissionVatPercentSnapshot)) {
    return fail('refund_commission_snapshot_mismatch');
  }

  const acceptedState = state(acceptedAmount, commissionPercent, commissionVatPercent);
  const correctedState = state(correctedAmount, commissionPercent, commissionVatPercent);
  const difference = {
    refundAmountMinor: correctedState.refundAmountMinor - acceptedState.refundAmountMinor,
    commissionReversalMinor: correctedState.commissionReversalMinor - acceptedState.commissionReversalMinor,
    commissionVatReversalMinor: correctedState.commissionVatReversalMinor - acceptedState.commissionVatReversalMinor,
    vendorPayableReversalMinor: correctedState.vendorPayableReversalMinor - acceptedState.vendorPayableReversalMinor,
  };
  const economicDirection = difference.vendorPayableReversalMinor > 0 ? 'VENDOR_DEDUCTION' as const
    : difference.vendorPayableReversalMinor < 0 ? 'VENDOR_CREDIT' as const : 'NONE' as const;
  // This identifies a displayed calculation for later revalidation; it is not authorization.
  const previewFingerprint = createHash('sha256').update(JSON.stringify({
    version: 1,
    review: {
      id: review.id,
      status: review.status,
      resolutionOutcome: review.resolutionOutcome,
      updatedAt: review.updatedAt,
      occurrenceCount: review.occurrenceCount,
    },
    identity: {
      sourceShopifyRefundId: review.sourceShopifyRefundId,
      sourceShopifyOrderId: review.sourceShopifyOrderId,
      vendorAllocationId: review.vendorAllocationId,
      vendorId: review.economicVendorId,
      historicalSaleFinanceLedgerEntryId: sale.id,
      acceptedRefundFinanceLedgerEntryId: refund.id,
      currency: 'TRY',
    },
    acceptedEvidence: {
      id: accepted.id, hash: accepted.evidenceHash,
      hashAlgorithm: accepted.hashAlgorithm,
      version: accepted.evidenceVersion,
      normalizationVersion: accepted.normalizationVersion,
    },
    incomingEvidence: {
      id: incoming.id, hash: incoming.evidenceHash,
      hashAlgorithm: incoming.hashAlgorithm,
      version: incoming.evidenceVersion,
      normalizationVersion: incoming.normalizationVersion,
    },
    historicalSale: {
      updatedAt: sale.updatedAt,
      amount: sale.amount.toString(),
      commissionPercent,
      commissionVatPercent,
    },
    acceptedRefundLedger: {
      updatedAt: refund.updatedAt,
      amount: refund.amount.toString(),
      payoutStatus: refund.payoutStatus,
      settlementStatus: refund.settlementStatus,
      voidedAt: refund.voidedAt,
      supersededByLedgerId: refund.supersededByLedgerId,
    },
    acceptedState,
    correctedState,
    difference,
    economicDirection,
  })).digest('hex');
  return {
    previewFingerprint: `financial-correction-preview-v1:${previewFingerprint}`,
    reviewId: review.id,
    sourceShopifyRefundId: review.sourceShopifyRefundId,
    sourceShopifyOrderId: review.sourceShopifyOrderId,
    vendorAllocationId: review.vendorAllocationId,
    vendorId: review.economicVendorId,
    historicalSaleFinanceLedgerEntryId: sale.id,
    acceptedRefundFinanceLedgerEntryId: refund.id,
    currency: 'TRY' as const,
    acceptedEvidence: { id: accepted.id, hash: accepted.evidenceHash, version: accepted.evidenceVersion, normalizationVersion: accepted.normalizationVersion },
    incomingEvidence: { id: incoming.id, hash: incoming.evidenceHash, version: incoming.evidenceVersion, normalizationVersion: incoming.normalizationVersion },
    commissionPercent,
    commissionVatPercent,
    accepted: acceptedState,
    corrected: correctedState,
    difference,
    economicDirection,
  };
}
