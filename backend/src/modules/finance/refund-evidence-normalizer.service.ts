import { createHash } from 'node:crypto';

export const REFUND_EVIDENCE_VERSION = 1;
export const REFUND_EVIDENCE_NORMALIZATION_VERSION = 1;
export const REFUND_EVIDENCE_HASH_ALGORITHM = 'SHA-256';

export type ResolvedRefundEvidenceInput = {
  sourceShopifyRefundId: string;
  sourceShopifyOrderId: string;
  vendorAllocationId: string;
  monetaryClassification: 'MONETARY_REFUND';
  refundTotalAmount: string;
  currency: string;
  /** Already selected by the canonical monetary-refund gate. */
  transactions: Array<{
    transactionGid: string;
    kind: 'REFUND';
    status: 'SUCCESS';
    amount: string;
    currency: string;
  }>;
  /** Already scoped to this allocation by the caller. */
  refundLines: Array<{
    sourceLineItemId: string;
    quantity: number;
    subtotalAmount: string;
    currency: string | null;
  }>;
  historicalEconomicVendorId: string;
  historicalSaleFinanceLedgerEntryId: string;
  supersededSaleLedgerIds: string[];
};

const EXACT_DECIMAL_PATTERN = /^[+-]?(?:0|[1-9]\d*)(?:\.\d+)?$/;

function requiredIdentity(value: string, field: string): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) {
    throw new Error(`Invalid ${field}: expected a non-empty normalized identity.`);
  }
  return value;
}

function requiredCurrency(value: string, field: string): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value !== value.toUpperCase()) {
    throw new Error(`Invalid ${field}: expected a canonical currency.`);
  }
  return value;
}

function canonicalMoney(value: string, field: string, allowZero: boolean): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!EXACT_DECIMAL_PATTERN.test(raw)) {
    throw new Error(`Invalid ${field}: expected an exact decimal string.`);
  }
  const unsigned = raw.replace(/^\+/, '');
  const [integer, fraction = ''] = unsigned.replace(/^-/, '').split('.');
  const trimmedFraction = fraction.replace(/0+$/, '');
  const magnitude = trimmedFraction ? `${integer}.${trimmedFraction}` : integer;
  const normalized = magnitude === '0' ? '0' : unsigned.startsWith('-') ? `-${magnitude}` : magnitude;
  if (normalized.startsWith('-') || (!allowZero && normalized === '0')) {
    throw new Error(`Invalid ${field}: expected ${allowZero ? 'non-negative' : 'positive'} money.`);
  }
  return normalized;
}

function lexicalCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** All values passed here are constructed JSON primitives, arrays, or plain objects. */
function stableJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number' && Number.isSafeInteger(value)) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`;
  }
  if (typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.entries(value).sort(([a], [b]) => lexicalCompare(a, b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(',')}}`;
  }
  throw new Error('Invalid refund evidence: non-JSON value.');
}

/** Pure normalization only: no Shopify selection, ownership resolution, or persistence. */
export function normalizeRefundEvidence(input: ResolvedRefundEvidenceInput) {
  if (!input || typeof input !== 'object') {
    throw new Error('Invalid refund evidence: expected resolved input.');
  }
  const sourceShopifyRefundId = requiredIdentity(input.sourceShopifyRefundId, 'sourceShopifyRefundId');
  const sourceShopifyOrderId = requiredIdentity(input.sourceShopifyOrderId, 'sourceShopifyOrderId');
  const vendorAllocationId = requiredIdentity(input.vendorAllocationId, 'vendorAllocationId');
  const historicalEconomicVendorId = requiredIdentity(input.historicalEconomicVendorId, 'historicalEconomicVendorId');
  const historicalSaleFinanceLedgerEntryId = requiredIdentity(
    input.historicalSaleFinanceLedgerEntryId, 'historicalSaleFinanceLedgerEntryId',
  );
  if (input.monetaryClassification !== 'MONETARY_REFUND') {
    throw new Error('Invalid monetaryClassification: expected verified MONETARY_REFUND.');
  }
  const currency = requiredCurrency(input.currency, 'currency');
  const refundTotalAmount = canonicalMoney(input.refundTotalAmount, 'refundTotalAmount', false);
  if (!Array.isArray(input.transactions) || input.transactions.length === 0) {
    throw new Error('Invalid transactions: expected selected successful monetary REFUND evidence.');
  }
  if (!Array.isArray(input.refundLines) || !Array.isArray(input.supersededSaleLedgerIds)) {
    throw new Error('Invalid refund lines or SALE lineage: expected arrays.');
  }

  const normalizedTransactionsJson = input.transactions.map((transaction, index) => {
    if (!transaction || transaction.kind !== 'REFUND' || transaction.status !== 'SUCCESS') {
      throw new Error(`Invalid transactions[${index}]: expected selected REFUND/SUCCESS evidence.`);
    }
    const transactionCurrency = requiredCurrency(transaction.currency, `transactions[${index}].currency`);
    if (transactionCurrency !== currency) {
      throw new Error(`Invalid transactions[${index}].currency: currency mismatch.`);
    }
    return {
      transactionGid: requiredIdentity(transaction.transactionGid, `transactions[${index}].transactionGid`),
      kind: transaction.kind,
      status: transaction.status,
      amount: canonicalMoney(transaction.amount, `transactions[${index}].amount`, false),
      currency: transactionCurrency,
    };
  }).sort((a, b) => lexicalCompare(stableJson(a), stableJson(b)));

  const normalizedRefundLinesJson = input.refundLines.map((line, index) => {
    if (!line || !Number.isSafeInteger(line.quantity) || line.quantity <= 0) {
      throw new Error(`Invalid refundLines[${index}].quantity: expected a positive safe integer.`);
    }
    const lineCurrency = line.currency === null ? null : requiredCurrency(line.currency, `refundLines[${index}].currency`);
    if (lineCurrency !== null && lineCurrency !== currency) {
      throw new Error(`Invalid refundLines[${index}].currency: currency mismatch.`);
    }
    return {
      sourceLineItemId: requiredIdentity(line.sourceLineItemId, `refundLines[${index}].sourceLineItemId`),
      quantity: line.quantity,
      subtotalAmount: canonicalMoney(line.subtotalAmount, `refundLines[${index}].subtotalAmount`, true),
      currency: lineCurrency,
    };
  }).sort((a, b) => lexicalCompare(stableJson(a), stableJson(b)));

  const supersededSaleLedgerIdsJson = input.supersededSaleLedgerIds
    .map((id, index) => requiredIdentity(id, `supersededSaleLedgerIds[${index}]`))
    .sort(lexicalCompare);
  const normalizedOwnershipJson = {
    historicalEconomicVendorId,
    historicalSaleFinanceLedgerEntryId,
    supersededSaleLedgerIds: supersededSaleLedgerIdsJson,
  };
  // The order aggregate is retained as a snapshot field, never as fingerprint evidence.
  const normalizedEvidenceJson = {
    normalizationVersion: REFUND_EVIDENCE_NORMALIZATION_VERSION,
    sourceShopifyRefundId,
    vendorAllocationId,
    monetaryClassification: input.monetaryClassification,
    refundTotalAmount,
    currency,
    transactions: normalizedTransactionsJson,
    refundLines: normalizedRefundLinesJson,
    ownership: normalizedOwnershipJson,
  };
  const evidenceHash = createHash('sha256').update(stableJson(normalizedEvidenceJson), 'utf8').digest('hex');

  return {
    sourceShopifyRefundId,
    sourceShopifyOrderId,
    vendorAllocationId,
    monetaryClassification: input.monetaryClassification,
    refundTotalAmount,
    currency,
    historicalEconomicVendorId,
    historicalSaleFinanceLedgerEntryId,
    normalizedTransactionsJson,
    normalizedRefundLinesJson,
    normalizedOwnershipJson,
    normalizedEvidenceJson,
    supersededSaleLedgerIdsJson,
    evidenceHash,
    hashAlgorithm: REFUND_EVIDENCE_HASH_ALGORITHM,
    evidenceVersion: REFUND_EVIDENCE_VERSION,
    normalizationVersion: REFUND_EVIDENCE_NORMALIZATION_VERSION,
  };
}
