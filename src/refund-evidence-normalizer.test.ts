import { describe, expect, it } from 'vitest';
import {
  normalizeRefundEvidence,
  type ResolvedRefundEvidenceInput,
} from '../backend/src/modules/finance/refund-evidence-normalizer.service.js';

function evidence(): ResolvedRefundEvidenceInput {
  return {
    sourceShopifyRefundId: 'refund-1',
    sourceShopifyOrderId: 'order-1',
    vendorAllocationId: 'allocation-1',
    monetaryClassification: 'MONETARY_REFUND',
    refundTotalAmount: '10.00',
    currency: 'TRY',
    transactions: [
      { transactionGid: 'transaction-2', kind: 'REFUND', status: 'SUCCESS', amount: '6.00', currency: 'TRY' },
      { transactionGid: 'transaction-1', kind: 'REFUND', status: 'SUCCESS', amount: '4.00', currency: 'TRY' },
    ],
    refundLines: [
      { sourceLineItemId: 'line-2', quantity: 2, subtotalAmount: '6.00', currency: 'TRY' },
      { sourceLineItemId: 'line-1', quantity: 1, subtotalAmount: '4.00', currency: 'TRY' },
    ],
    historicalEconomicVendorId: 'vendor-1',
    historicalSaleFinanceLedgerEntryId: 'sale-2',
    supersededSaleLedgerIds: ['sale-1b', 'sale-1a'],
  };
}

function hashWith(change: (input: ResolvedRefundEvidenceInput) => void): string {
  const input = evidence();
  change(input);
  return normalizeRefundEvidence(input).evidenceHash;
}

describe('deterministic refund evidence normalizer', () => {
  it('produces identical JSON and SHA-256 for identical evidence', () => {
    expect(normalizeRefundEvidence(evidence())).toEqual(normalizeRefundEvidence(evidence()));
    expect(normalizeRefundEvidence(evidence())).toMatchObject({
      evidenceVersion: 1,
      normalizationVersion: 1,
      hashAlgorithm: 'SHA-256',
      evidenceHash: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });

  it('normalizes transaction, line, and superseded SALE ordering without deduplication', () => {
    const original = normalizeRefundEvidence(evidence());
    const reordered = evidence();
    reordered.transactions.reverse();
    reordered.refundLines.reverse();
    reordered.supersededSaleLedgerIds.reverse();
    expect(normalizeRefundEvidence(reordered)).toEqual(original);

    const duplicate = evidence();
    duplicate.transactions.push({ ...duplicate.transactions[0] });
    duplicate.refundLines.push({ ...duplicate.refundLines[0] });
    duplicate.supersededSaleLedgerIds.push(duplicate.supersededSaleLedgerIds[0]);
    const result = normalizeRefundEvidence(duplicate);
    expect(result.normalizedTransactionsJson).toHaveLength(3);
    expect(result.normalizedRefundLinesJson).toHaveLength(3);
    expect(result.supersededSaleLedgerIdsJson).toHaveLength(3);
    expect(result.evidenceHash).not.toBe(original.evidenceHash);
  });

  it('canonicalizes equivalent exact decimal strings without floating-point arithmetic', () => {
    const first = normalizeRefundEvidence(evidence());
    const variant = evidence();
    variant.refundTotalAmount = '+10';
    variant.transactions[0].amount = '6.000';
    variant.refundLines[0].subtotalAmount = '6';
    expect(normalizeRefundEvidence(variant)).toEqual(first);
    expect(first.refundTotalAmount).toBe('10');
  });

  it.each([
    ['refund ID', (input: ResolvedRefundEvidenceInput) => { input.sourceShopifyRefundId = 'refund-2'; }],
    ['allocation ID', (input: ResolvedRefundEvidenceInput) => { input.vendorAllocationId = 'allocation-2'; }],
    ['refund total', (input: ResolvedRefundEvidenceInput) => { input.refundTotalAmount = '11'; }],
    ['currency', (input: ResolvedRefundEvidenceInput) => {
      input.currency = 'USD';
      input.transactions.forEach((transaction) => { transaction.currency = 'USD'; });
      input.refundLines.forEach((line) => { line.currency = 'USD'; });
    }],
    ['transaction ID', (input: ResolvedRefundEvidenceInput) => { input.transactions[0].transactionGid = 'transaction-3'; }],
    ['transaction amount', (input: ResolvedRefundEvidenceInput) => { input.transactions[0].amount = '7'; }],
    ['line ID', (input: ResolvedRefundEvidenceInput) => { input.refundLines[0].sourceLineItemId = 'line-3'; }],
    ['line quantity', (input: ResolvedRefundEvidenceInput) => { input.refundLines[0].quantity = 3; }],
    ['line subtotal', (input: ResolvedRefundEvidenceInput) => { input.refundLines[0].subtotalAmount = '7'; }],
    ['historical vendor', (input: ResolvedRefundEvidenceInput) => { input.historicalEconomicVendorId = 'vendor-2'; }],
    ['active SALE', (input: ResolvedRefundEvidenceInput) => { input.historicalSaleFinanceLedgerEntryId = 'sale-3'; }],
    ['superseded SALE', (input: ResolvedRefundEvidenceInput) => { input.supersededSaleLedgerIds[0] = 'sale-3'; }],
  ] as const)('changes the fingerprint when %s changes', (_name, change) => {
    expect(hashWith(change)).not.toBe(normalizeRefundEvidence(evidence()).evidenceHash);
  });

  it('does not fingerprint the Shopify order aggregate', () => {
    expect(hashWith((input) => { input.sourceShopifyOrderId = 'order-2'; }))
      .toBe(normalizeRefundEvidence(evidence()).evidenceHash);
  });

  it('rejects malformed money, missing identities, unknown classification, and unselected transactions', () => {
    expect(() => hashWith((input) => { input.refundTotalAmount = '1e1'; })).toThrow('refundTotalAmount');
    expect(() => hashWith((input) => { input.transactions[0].amount = 'NaN'; })).toThrow('amount');
    expect(() => hashWith((input) => { input.sourceShopifyRefundId = ''; })).toThrow('sourceShopifyRefundId');
    expect(() => hashWith((input) => { input.refundLines[0].sourceLineItemId = ''; })).toThrow('sourceLineItemId');
    expect(() => hashWith((input) => { input.refundLines[0].quantity = 1.5; })).toThrow('quantity');
    expect(() => hashWith((input) => { input.transactions = []; })).toThrow('transactions');
    expect(() => hashWith((input) => { input.transactions[0].status = 'PENDING' as 'SUCCESS'; })).toThrow('REFUND/SUCCESS');
    expect(() => hashWith((input) => { input.monetaryClassification = 'ZERO_VALUE_VOID' as 'MONETARY_REFUND'; }))
      .toThrow('monetaryClassification');
  });

  it('allows an empty allocation-scoped line list for a monetary refund without inventing line evidence', () => {
    const input = evidence();
    input.refundLines = [];
    expect(normalizeRefundEvidence(input).normalizedRefundLinesJson).toEqual([]);
  });
});
