import { Prisma } from '@prisma/client';
import type { CanonicalRefundLineEvidence } from '../shopify/shopify-refund-monetary-evidence.js';

export const CANONICAL_REFUND_LINE_AUTHORITY_REASON_CODES = {
  missingCanonicalRefundLine: 'missing_canonical_refund_line',
  ambiguousCanonicalRefundLine: 'ambiguous_canonical_refund_line',
  missingOriginalLineItemId: 'missing_original_line_item_id',
  missingObservedQuantity: 'missing_observed_quantity',
  invalidObservedQuantity: 'invalid_observed_quantity',
  missingObservedSubtotal: 'missing_observed_subtotal',
  invalidObservedSubtotal: 'invalid_observed_subtotal',
} as const;

export type CanonicalRefundLineAuthorityReasonCode =
  (typeof CANONICAL_REFUND_LINE_AUTHORITY_REASON_CODES)[keyof typeof CANONICAL_REFUND_LINE_AUTHORITY_REASON_CODES];

export type CanonicalRefundLineAuthorityFailure = Readonly<{
  sourceRefundLineItemId: string;
  reasonCode: CanonicalRefundLineAuthorityReasonCode;
}>;

const EXACT_DECIMAL_PATTERN = /^[+-]?(?:0|[1-9]\d*)(?:\.\d+)?$/;

function isCanonicalNonNegativeAmount(value: string | null) {
  const normalized = value?.trim() ?? '';
  if (!EXACT_DECIMAL_PATTERN.test(normalized)) {
    return false;
  }

  try {
    return new Prisma.Decimal(normalized).greaterThanOrEqualTo(0);
  } catch {
    return false;
  }
}

function inspectLine(line: CanonicalRefundLineEvidence) {
  const failures: CanonicalRefundLineAuthorityReasonCode[] = [];
  if (!line.sourceLineItemId?.trim()) {
    failures.push(CANONICAL_REFUND_LINE_AUTHORITY_REASON_CODES.missingOriginalLineItemId);
  }

  if (line.quantityProvenance === 'ABSENT') {
    failures.push(CANONICAL_REFUND_LINE_AUTHORITY_REASON_CODES.missingObservedQuantity);
  } else if (
    line.quantityProvenance !== 'OBSERVED_VALID' ||
    !Number.isSafeInteger(line.quantity) ||
    !(line.quantity! > 0)
  ) {
    failures.push(CANONICAL_REFUND_LINE_AUTHORITY_REASON_CODES.invalidObservedQuantity);
  }

  if (line.subtotalAmountProvenance === 'ABSENT') {
    failures.push(CANONICAL_REFUND_LINE_AUTHORITY_REASON_CODES.missingObservedSubtotal);
  } else if (
    line.subtotalAmountProvenance !== 'OBSERVED' ||
    !isCanonicalNonNegativeAmount(line.subtotalAmount)
  ) {
    failures.push(CANONICAL_REFUND_LINE_AUTHORITY_REASON_CODES.invalidObservedSubtotal);
  }

  return failures;
}

export function evaluateCanonicalRefundLineAuthority(input: {
  sourceRefundLineItemIds: readonly string[];
  canonicalLines: readonly CanonicalRefundLineEvidence[];
}) {
  const linesByRefundLineId = new Map<string, CanonicalRefundLineEvidence[]>();
  for (const line of input.canonicalLines) {
    const existing = linesByRefundLineId.get(line.sourceRefundLineItemId) ?? [];
    existing.push(line);
    linesByRefundLineId.set(line.sourceRefundLineItemId, existing);
  }

  const failures: CanonicalRefundLineAuthorityFailure[] = [];
  for (const sourceRefundLineItemId of [...input.sourceRefundLineItemIds].sort()) {
    const matches = linesByRefundLineId.get(sourceRefundLineItemId) ?? [];
    if (matches.length === 0) {
      failures.push({
        sourceRefundLineItemId,
        reasonCode: CANONICAL_REFUND_LINE_AUTHORITY_REASON_CODES.missingCanonicalRefundLine,
      });
      continue;
    }
    if (matches.length > 1) {
      failures.push({
        sourceRefundLineItemId,
        reasonCode: CANONICAL_REFUND_LINE_AUTHORITY_REASON_CODES.ambiguousCanonicalRefundLine,
      });
      continue;
    }

    for (const reasonCode of inspectLine(matches[0]!)) {
      failures.push({ sourceRefundLineItemId, reasonCode });
    }
  }

  return failures.length === 0
    ? { authoritative: true as const, failures: [] as const }
    : { authoritative: false as const, failures };
}
