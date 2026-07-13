import { Prisma } from '@prisma/client';
import type {
  CanonicalShopifyRefundSnapshot,
  FetchCanonicalShopifyRefundsForOrderResult,
} from './shopify-admin.types.js';

export const REFUND_MONETARY_CLASSIFICATIONS = {
  monetaryRefund: 'MONETARY_REFUND',
  zeroValueVoid: 'ZERO_VALUE_VOID',
  nonFinalRefund: 'NON_FINAL_REFUND',
  unsupportedOrAmbiguous: 'UNSUPPORTED_OR_AMBIGUOUS',
} as const;

export type RefundMonetaryClassification =
  (typeof REFUND_MONETARY_CLASSIFICATIONS)[keyof typeof REFUND_MONETARY_CLASSIFICATIONS];

export type RefundMonetaryEvidenceReasonCode =
  | 'monetary_refund_verified'
  | 'zero_value_void_not_monetary_refund'
  | 'monetary_refund_transaction_missing'
  | 'non_final_refund_transaction'
  | 'refund_transaction_ambiguous'
  | 'canonical_refund_currency_mismatch'
  | 'canonical_refund_amount_mismatch'
  | 'canonical_refund_transactions_incomplete'
  | 'canonical_refund_line_items_incomplete'
  | 'canonical_refunds_list_incomplete'
  | 'duplicate_refund_transaction_conflict';

export type CanonicalRefundItemMonetaryEvidence = {
  sourceShopifyRefundId: string;
  classification: RefundMonetaryClassification;
  monetaryRefundAmount: string;
  currency: string | null;
  reasonCode: RefundMonetaryEvidenceReasonCode;
  sanitizedWarnings: string[];
};

export type CanonicalRefundMonetaryEvidence = {
  classification: RefundMonetaryClassification;
  monetaryRefundAmount: string;
  currency: string | null;
  totalTransactionCount: number;
  uniqueTransactionCount: number;
  successfulRefundTransactionCount: number;
  successfulVoidTransactionCount: number;
  nonFinalTransactionCount: number;
  duplicateTransactionCount: number;
  refundAggregateAmount: string | null;
  orderAggregateAmount: string | null;
  transactionPaginationComplete: boolean;
  lineItemPaginationComplete: boolean;
  refundsListComplete: boolean;
  aggregateMismatch: boolean;
  currencyMismatch: boolean;
  incompletePagination: boolean;
  reasonCode: RefundMonetaryEvidenceReasonCode;
  sanitizedWarnings: string[];
  refunds: CanonicalRefundItemMonetaryEvidence[];
};

type CanonicalRefundCollection = NonNullable<FetchCanonicalShopifyRefundsForOrderResult>;

type ParsedMoney = {
  decimal: Prisma.Decimal;
  amount: string;
  currency: string;
};

const EXACT_DECIMAL_PATTERN = /^[+-]?(?:0|[1-9]\d*)(?:\.\d+)?$/;
const FINAL_TRANSACTION_STATUS = 'SUCCESS';
const REFUND_TRANSACTION_KIND = 'REFUND';
const VOID_TRANSACTION_KIND = 'VOID';

function parseMoney(amount: string | null, currencyCode: string | null): ParsedMoney | null {
  const normalizedAmount = amount?.trim() ?? '';
  const currency = currencyCode?.trim().toUpperCase() ?? '';
  if (!EXACT_DECIMAL_PATTERN.test(normalizedAmount) || !currency) {
    return null;
  }

  try {
    const decimal = new Prisma.Decimal(normalizedAmount);
    return {
      decimal,
      amount: decimal.toString(),
      currency,
    };
  } catch {
    return null;
  }
}

function sumDecimals(values: Prisma.Decimal[]) {
  return values.reduce((sum, value) => sum.plus(value), new Prisma.Decimal(0));
}

function safeResult(input: {
  classification: RefundMonetaryClassification;
  reasonCode: RefundMonetaryEvidenceReasonCode;
  monetaryRefundAmount?: Prisma.Decimal;
  currency?: string | null;
  totalTransactionCount: number;
  uniqueTransactionCount: number;
  successfulRefundTransactionCount: number;
  successfulVoidTransactionCount: number;
  nonFinalTransactionCount: number;
  duplicateTransactionCount: number;
  refundAggregateAmount: Prisma.Decimal | null;
  orderAggregateAmount: Prisma.Decimal | null;
  transactionPaginationComplete: boolean;
  lineItemPaginationComplete: boolean;
  refundsListComplete: boolean;
  aggregateMismatch?: boolean;
  currencyMismatch?: boolean;
  warnings?: string[];
  refunds?: CanonicalRefundItemMonetaryEvidence[];
}): CanonicalRefundMonetaryEvidence {
  const incompletePagination =
    !input.transactionPaginationComplete ||
    !input.lineItemPaginationComplete ||
    !input.refundsListComplete;

  return {
    classification: input.classification,
    monetaryRefundAmount: (input.monetaryRefundAmount ?? new Prisma.Decimal(0)).toString(),
    currency: input.currency ?? null,
    totalTransactionCount: input.totalTransactionCount,
    uniqueTransactionCount: input.uniqueTransactionCount,
    successfulRefundTransactionCount: input.successfulRefundTransactionCount,
    successfulVoidTransactionCount: input.successfulVoidTransactionCount,
    nonFinalTransactionCount: input.nonFinalTransactionCount,
    duplicateTransactionCount: input.duplicateTransactionCount,
    refundAggregateAmount: input.refundAggregateAmount?.toString() ?? null,
    orderAggregateAmount: input.orderAggregateAmount?.toString() ?? null,
    transactionPaginationComplete: input.transactionPaginationComplete,
    lineItemPaginationComplete: input.lineItemPaginationComplete,
    refundsListComplete: input.refundsListComplete,
    aggregateMismatch: input.aggregateMismatch ?? false,
    currencyMismatch: input.currencyMismatch ?? false,
    incompletePagination,
    reasonCode: input.reasonCode,
    sanitizedWarnings: input.warnings ?? [],
    refunds: input.refunds ?? [],
  };
}

function itemResult(input: {
  refund: CanonicalShopifyRefundSnapshot;
  classification: RefundMonetaryClassification;
  amount?: Prisma.Decimal;
  currency?: string | null;
  reasonCode: RefundMonetaryEvidenceReasonCode;
  warning?: string;
}): CanonicalRefundItemMonetaryEvidence {
  return {
    sourceShopifyRefundId: input.refund.sourceShopifyRefundId,
    classification: input.classification,
    monetaryRefundAmount: (input.amount ?? new Prisma.Decimal(0)).toString(),
    currency: input.currency ?? null,
    reasonCode: input.reasonCode,
    sanitizedWarnings: input.warning ? [input.warning] : [],
  };
}

export function classifyCanonicalRefundMonetaryEvidence(
  collection: CanonicalRefundCollection,
): CanonicalRefundMonetaryEvidence {
  const transactionPaginationComplete = collection.refunds.every((refund) => refund.transactionPaginationComplete);
  const lineItemPaginationComplete = collection.refunds.every((refund) => refund.lineItemPaginationComplete);
  const common = {
    totalTransactionCount: collection.refunds.reduce((sum, refund) => sum + refund.transactions.length, 0),
    uniqueTransactionCount: 0,
    successfulRefundTransactionCount: 0,
    successfulVoidTransactionCount: 0,
    nonFinalTransactionCount: 0,
    duplicateTransactionCount: 0,
    refundAggregateAmount: null as Prisma.Decimal | null,
    orderAggregateAmount: null as Prisma.Decimal | null,
    transactionPaginationComplete,
    lineItemPaginationComplete,
    refundsListComplete: collection.refundsListComplete,
  };

  if (!collection.refundsListComplete) {
    return safeResult({
      ...common,
      classification: REFUND_MONETARY_CLASSIFICATIONS.unsupportedOrAmbiguous,
      reasonCode: 'canonical_refunds_list_incomplete',
      warnings: ['Canonical Shopify refund-list evidence is incomplete.'],
    });
  }
  if (!transactionPaginationComplete) {
    return safeResult({
      ...common,
      classification: REFUND_MONETARY_CLASSIFICATIONS.unsupportedOrAmbiguous,
      reasonCode: 'canonical_refund_transactions_incomplete',
      warnings: ['Canonical Shopify refund transaction evidence is incomplete.'],
    });
  }
  if (!lineItemPaginationComplete) {
    return safeResult({
      ...common,
      classification: REFUND_MONETARY_CLASSIFICATIONS.unsupportedOrAmbiguous,
      reasonCode: 'canonical_refund_line_items_incomplete',
      warnings: ['Canonical Shopify refund line-item evidence is incomplete.'],
    });
  }

  const orderTotal = parseMoney(
    collection.orderTotalRefundedAmount,
    collection.orderTotalRefundedCurrencyCode,
  );
  if (!orderTotal) {
    return safeResult({
      ...common,
      classification: REFUND_MONETARY_CLASSIFICATIONS.unsupportedOrAmbiguous,
      reasonCode: 'refund_transaction_ambiguous',
      warnings: ['Canonical Shopify order refund total is missing or malformed.'],
    });
  }
  common.orderAggregateAmount = orderTotal.decimal;

  const uniqueTransactions = new Map<string, {
    fingerprint: string;
    kind: string;
    status: string;
    money: ParsedMoney;
  }>();
  let duplicateTransactionCount = 0;
  let duplicateConflict = false;
  let malformedTransaction = false;
  let currencyMismatch = false;
  let positiveVoid = false;
  let nonFinalTransactionCount = 0;

  for (const refund of collection.refunds) {
    for (const transaction of refund.transactions) {
      const transactionId = transaction.transactionGid?.trim();
      const kind = transaction.kind?.trim().toUpperCase() ?? '';
      const status = transaction.status?.trim().toUpperCase() ?? '';
      const money = parseMoney(transaction.amount, transaction.currencyCode);
      if (!transactionId || !kind || !status || !money) {
        malformedTransaction = true;
        continue;
      }
      const fingerprint = [kind, status, money.amount, money.currency, transaction.parentTransactionGid ?? ''].join('|');
      const existing = uniqueTransactions.get(transactionId);
      if (existing) {
        duplicateTransactionCount += 1;
        if (existing.fingerprint !== fingerprint) {
          duplicateConflict = true;
        }
        continue;
      }
      uniqueTransactions.set(transactionId, { fingerprint, kind, status, money });
      if (kind === REFUND_TRANSACTION_KIND && status !== FINAL_TRANSACTION_STATUS) {
        nonFinalTransactionCount += 1;
      }
      if (kind === VOID_TRANSACTION_KIND && money.decimal.greaterThan(0)) {
        positiveVoid = true;
      }
      if (money.currency !== orderTotal.currency) {
        currencyMismatch = true;
      }
    }
  }

  common.uniqueTransactionCount = uniqueTransactions.size;
  common.duplicateTransactionCount = duplicateTransactionCount;
  common.nonFinalTransactionCount = nonFinalTransactionCount;

  if (duplicateConflict) {
    return safeResult({
      ...common,
      classification: REFUND_MONETARY_CLASSIFICATIONS.unsupportedOrAmbiguous,
      reasonCode: 'duplicate_refund_transaction_conflict',
      warnings: ['Duplicate Shopify refund transaction evidence is contradictory.'],
    });
  }
  if (malformedTransaction || positiveVoid) {
    return safeResult({
      ...common,
      classification: REFUND_MONETARY_CLASSIFICATIONS.unsupportedOrAmbiguous,
      reasonCode: 'refund_transaction_ambiguous',
      warnings: ['Canonical Shopify refund transaction evidence is missing, malformed, or contradictory.'],
    });
  }
  if (currencyMismatch) {
    return safeResult({
      ...common,
      classification: REFUND_MONETARY_CLASSIFICATIONS.unsupportedOrAmbiguous,
      reasonCode: 'canonical_refund_currency_mismatch',
      currencyMismatch: true,
      warnings: ['Canonical Shopify refund currencies do not agree.'],
    });
  }
  if (nonFinalTransactionCount > 0) {
    return safeResult({
      ...common,
      classification: REFUND_MONETARY_CLASSIFICATIONS.nonFinalRefund,
      reasonCode: 'non_final_refund_transaction',
      warnings: ['Canonical Shopify refund contains non-final transaction evidence.'],
    });
  }
  if (uniqueTransactions.size === 0) {
    return safeResult({
      ...common,
      classification: REFUND_MONETARY_CLASSIFICATIONS.unsupportedOrAmbiguous,
      reasonCode: 'monetary_refund_transaction_missing',
      warnings: ['Canonical Shopify refund has no transaction evidence.'],
    });
  }

  const perRefundResults: CanonicalRefundItemMonetaryEvidence[] = [];
  const globalSuccessfulRefunds = new Map<string, Prisma.Decimal>();
  let successfulRefundTransactionCount = 0;
  let successfulVoidTransactionCount = 0;
  let aggregateMismatch = false;

  for (const refund of collection.refunds) {
    const refundTotal = parseMoney(refund.totalRefundedAmount, refund.totalRefundedCurrencyCode);
    if (!refundTotal || refundTotal.currency !== orderTotal.currency) {
      currencyMismatch = true;
      continue;
    }

    const localIds = new Set<string>();
    const localPositiveRefunds: Prisma.Decimal[] = [];
    let localSuccessfulVoidCount = 0;
    for (const transaction of refund.transactions) {
      const transactionId = transaction.transactionGid.trim();
      if (localIds.has(transactionId)) {
        continue;
      }
      localIds.add(transactionId);
      const unique = uniqueTransactions.get(transactionId);
      if (!unique) {
        continue;
      }
      if (
        unique.kind === REFUND_TRANSACTION_KIND &&
        unique.status === FINAL_TRANSACTION_STATUS &&
        unique.money.decimal.greaterThan(0)
      ) {
        localPositiveRefunds.push(unique.money.decimal);
        globalSuccessfulRefunds.set(transactionId, unique.money.decimal);
      }
      if (
        unique.kind === VOID_TRANSACTION_KIND &&
        unique.status === FINAL_TRANSACTION_STATUS &&
        unique.money.decimal.equals(0)
      ) {
        localSuccessfulVoidCount += 1;
      }
    }

    const localRefundAmount = sumDecimals(localPositiveRefunds);
    successfulVoidTransactionCount += localSuccessfulVoidCount;
    if (!localRefundAmount.equals(refundTotal.decimal)) {
      aggregateMismatch = true;
      continue;
    }
    if (localRefundAmount.greaterThan(0)) {
      perRefundResults.push(itemResult({
        refund,
        classification: REFUND_MONETARY_CLASSIFICATIONS.monetaryRefund,
        amount: localRefundAmount,
        currency: refundTotal.currency,
        reasonCode: 'monetary_refund_verified',
      }));
    } else if (localSuccessfulVoidCount > 0) {
      perRefundResults.push(itemResult({
        refund,
        classification: REFUND_MONETARY_CLASSIFICATIONS.zeroValueVoid,
        currency: refundTotal.currency,
        reasonCode: 'zero_value_void_not_monetary_refund',
      }));
    } else {
      perRefundResults.push(itemResult({
        refund,
        classification: REFUND_MONETARY_CLASSIFICATIONS.unsupportedOrAmbiguous,
        currency: refundTotal.currency,
        reasonCode: 'monetary_refund_transaction_missing',
        warning: 'Canonical Shopify refund has no successful positive monetary transaction.',
      }));
    }
  }

  common.successfulRefundTransactionCount = globalSuccessfulRefunds.size;
  common.successfulVoidTransactionCount = successfulVoidTransactionCount;
  const refundAggregate = collection.refunds.reduce<Prisma.Decimal | null>((sum, refund) => {
    const total = parseMoney(refund.totalRefundedAmount, refund.totalRefundedCurrencyCode);
    return total ? (sum ?? new Prisma.Decimal(0)).plus(total.decimal) : null;
  }, new Prisma.Decimal(0));
  const monetaryRefundAmount = sumDecimals([...globalSuccessfulRefunds.values()]);
  common.refundAggregateAmount = refundAggregate;

  if (currencyMismatch) {
    return safeResult({
      ...common,
      classification: REFUND_MONETARY_CLASSIFICATIONS.unsupportedOrAmbiguous,
      reasonCode: 'canonical_refund_currency_mismatch',
      currencyMismatch: true,
      warnings: ['Canonical Shopify refund currencies do not agree.'],
      refunds: perRefundResults,
    });
  }
  if (
    aggregateMismatch ||
    !refundAggregate ||
    !refundAggregate.equals(orderTotal.decimal) ||
    !monetaryRefundAmount.equals(orderTotal.decimal)
  ) {
    return safeResult({
      ...common,
      classification: REFUND_MONETARY_CLASSIFICATIONS.unsupportedOrAmbiguous,
      reasonCode: 'canonical_refund_amount_mismatch',
      aggregateMismatch: true,
      warnings: ['Canonical Shopify refund transaction totals do not agree with refund aggregates.'],
      refunds: perRefundResults,
    });
  }

  const unsupportedItem = perRefundResults.find((result) =>
    result.classification === REFUND_MONETARY_CLASSIFICATIONS.unsupportedOrAmbiguous
  );
  if (unsupportedItem) {
    return safeResult({
      ...common,
      classification: REFUND_MONETARY_CLASSIFICATIONS.unsupportedOrAmbiguous,
      reasonCode: unsupportedItem.reasonCode,
      warnings: unsupportedItem.sanitizedWarnings,
      refunds: perRefundResults,
    });
  }

  const hasMonetaryRefund = monetaryRefundAmount.greaterThan(0);
  return safeResult({
    ...common,
    classification: hasMonetaryRefund
      ? REFUND_MONETARY_CLASSIFICATIONS.monetaryRefund
      : REFUND_MONETARY_CLASSIFICATIONS.zeroValueVoid,
    reasonCode: hasMonetaryRefund
      ? 'monetary_refund_verified'
      : 'zero_value_void_not_monetary_refund',
    monetaryRefundAmount,
    currency: orderTotal.currency,
    refunds: perRefundResults,
  });
}

export function requiresRefundMonetaryEvidenceClassification(
  collection: CanonicalRefundCollection,
) {
  if (collection.refunds.length > 0) {
    return true;
  }

  const orderTotal = parseMoney(
    collection.orderTotalRefundedAmount,
    collection.orderTotalRefundedCurrencyCode,
  );
  return !orderTotal || !orderTotal.decimal.equals(0);
}

export function isRefundEvidenceBlocked(evidence: CanonicalRefundMonetaryEvidence) {
  return evidence.classification === REFUND_MONETARY_CLASSIFICATIONS.nonFinalRefund ||
    evidence.classification === REFUND_MONETARY_CLASSIFICATIONS.unsupportedOrAmbiguous;
}

export function findCanonicalRefundItemEvidence(
  evidence: CanonicalRefundMonetaryEvidence,
  sourceShopifyRefundId: string,
) {
  return evidence.refunds.find((refund) => refund.sourceShopifyRefundId === sourceShopifyRefundId) ?? null;
}

export function toSafeRefundMonetaryEvidence(
  evidence: CanonicalRefundMonetaryEvidence,
): Omit<CanonicalRefundMonetaryEvidence, 'refunds'> {
  const { refunds: _refunds, ...safe } = evidence;
  return safe;
}
