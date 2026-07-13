import { describe, expect, it } from 'vitest';
import type {
  CanonicalShopifyRefundSnapshot,
  FetchCanonicalShopifyRefundsForOrderResult,
} from '../backend/src/modules/shopify/shopify-admin.types.js';
import {
  classifyCanonicalRefundMonetaryEvidence,
  requiresRefundMonetaryEvidenceClassification,
} from '../backend/src/modules/shopify/shopify-refund-monetary-evidence.js';
import { ingestVerifiedShopifyRefund } from '../backend/src/modules/shopify/refund-ingestion.service.js';

type CanonicalCollection = NonNullable<FetchCanonicalShopifyRefundsForOrderResult>;

function transaction(input: {
  id?: string;
  kind?: string;
  status?: string;
  amount?: string;
  currency?: string;
} = {}) {
  return {
    transactionGid: input.id ?? 'gid://shopify/OrderTransaction/1',
    kind: input.kind ?? 'REFUND',
    status: input.status ?? 'SUCCESS',
    amount: input.amount ?? '100.00',
    currencyCode: input.currency ?? 'TRY',
    parentTransactionGid: 'gid://shopify/OrderTransaction/parent',
    createdAt: '2026-07-11T18:00:00.000Z',
    processedAt: '2026-07-11T18:00:01.000Z',
  };
}

function refund(input: {
  id?: string;
  total?: string;
  currency?: string;
  transactions?: ReturnType<typeof transaction>[];
  transactionPaginationComplete?: boolean;
  lineItemPaginationComplete?: boolean;
} = {}): CanonicalShopifyRefundSnapshot {
  const id = input.id ?? 'refund-1';
  return {
    refundGid: `gid://shopify/Refund/${id}`,
    sourceShopifyRefundId: id,
    createdAt: '2026-07-11T18:00:00.000Z',
    updatedAt: '2026-07-11T18:00:01.000Z',
    note: null,
    totalRefundedAmount: input.total ?? '100.00',
    totalRefundedCurrencyCode: input.currency ?? 'TRY',
    transactionPaginationComplete: input.transactionPaginationComplete ?? true,
    lineItemPaginationComplete: input.lineItemPaginationComplete ?? true,
    transactions: input.transactions ?? [transaction()],
    refundLineItems: [{
      refundLineItemGid: `gid://shopify/RefundLineItem/${id}`,
      sourceRefundLineItemId: `${id}-line`,
      lineItemGid: 'gid://shopify/LineItem/1',
      sourceLineItemId: '1',
      sku: 'SKU-1',
      title: 'Product',
      name: 'Product',
      variantTitle: null,
      quantity: 1,
      subtotalAmount: '4799.00',
      currencyCode: 'TRY',
    }],
  };
}

function collection(input: {
  orderTotal?: string;
  orderCurrency?: string;
  refunds?: CanonicalShopifyRefundSnapshot[];
  refundsListComplete?: boolean;
} = {}): CanonicalCollection {
  return {
    orderGid: 'gid://shopify/Order/7856043819345',
    sourceShopifyOrderId: '7856043819345',
    orderTotalRefundedAmount: input.orderTotal ?? '100.00',
    orderTotalRefundedCurrencyCode: input.orderCurrency ?? 'TRY',
    refundsListComplete: input.refundsListComplete ?? true,
    refunds: input.refunds ?? [refund()],
    source: 'shopify_admin',
  };
}

describe('Shopify canonical refund monetary evidence', () => {
  it('classifies the verified #1105 shape as a zero-value void', () => {
    const result = classifyCanonicalRefundMonetaryEvidence(collection({
      orderTotal: '0.00',
      refunds: [refund({
        total: '0.00',
        transactions: [transaction({ kind: 'VOID', amount: '0.00' })],
      })],
    }));

    expect(result).toMatchObject({
      classification: 'ZERO_VALUE_VOID',
      monetaryRefundAmount: '0',
      successfulRefundTransactionCount: 0,
      successfulVoidTransactionCount: 1,
      reasonCode: 'zero_value_void_not_monetary_refund',
    });
  });

  it('classifies full and partial positive monetary refunds from transaction evidence', () => {
    expect(classifyCanonicalRefundMonetaryEvidence(collection())).toMatchObject({
      classification: 'MONETARY_REFUND',
      monetaryRefundAmount: '100',
    });
    expect(classifyCanonicalRefundMonetaryEvidence(collection({
      orderTotal: '25.50',
      refunds: [refund({ total: '25.50', transactions: [transaction({ amount: '25.50' })] })],
    }))).toMatchObject({ classification: 'MONETARY_REFUND', monetaryRefundAmount: '25.5' });
  });

  it('preserves exact decimal precision without floating-point summation', () => {
    expect(classifyCanonicalRefundMonetaryEvidence(collection({
      orderTotal: '0.300000000000000003',
      refunds: [refund({
        total: '0.300000000000000003',
        transactions: [
          transaction({ id: 'precision-1', amount: '0.100000000000000001' }),
          transaction({ id: 'precision-2', amount: '0.200000000000000002' }),
        ],
      })],
    }))).toMatchObject({
      classification: 'MONETARY_REFUND',
      monetaryRefundAmount: '0.300000000000000003',
    });
  });

  it('ignores a zero void while preserving a positive refund', () => {
    const result = classifyCanonicalRefundMonetaryEvidence(collection({
      orderTotal: '40.00',
      refunds: [
        refund({ id: 'void', total: '0.00', transactions: [transaction({ id: 'void-tx', kind: 'VOID', amount: '0.00' })] }),
        refund({ id: 'money', total: '40.00', transactions: [transaction({ id: 'refund-tx', amount: '40.00' })] }),
      ],
    }));

    expect(result).toMatchObject({
      classification: 'MONETARY_REFUND',
      monetaryRefundAmount: '40',
      successfulRefundTransactionCount: 1,
      successfulVoidTransactionCount: 1,
    });
    expect(result.refunds.map((item) => item.classification)).toEqual(['ZERO_VALUE_VOID', 'MONETARY_REFUND']);
  });

  it.each(['PENDING', 'FAILURE', 'ERROR', 'AWAITING_RESPONSE', 'UNKNOWN'])(
    'blocks non-final refund transaction status %s',
    (status) => {
      expect(classifyCanonicalRefundMonetaryEvidence(collection({
        orderTotal: '0.00',
        refunds: [refund({ total: '0.00', transactions: [transaction({ status })] })],
      }))).toMatchObject({
        classification: 'NON_FINAL_REFUND',
        nonFinalTransactionCount: 1,
        reasonCode: 'non_final_refund_transaction',
      });
    },
  );

  it('does not treat a zero-value successful REFUND as monetary evidence', () => {
    expect(classifyCanonicalRefundMonetaryEvidence(collection({
      orderTotal: '0.00',
      refunds: [refund({ total: '0.00', transactions: [transaction({ amount: '0.00' })] })],
    }))).toMatchObject({
      classification: 'UNSUPPORTED_OR_AMBIGUOUS',
      reasonCode: 'monetary_refund_transaction_missing',
    });
  });

  it('deduplicates identical transaction IDs and blocks contradictory duplicates', () => {
    const identical = transaction();
    expect(classifyCanonicalRefundMonetaryEvidence(collection({
      refunds: [refund({ transactions: [identical, { ...identical }] })],
    }))).toMatchObject({
      classification: 'MONETARY_REFUND',
      uniqueTransactionCount: 1,
      duplicateTransactionCount: 1,
      monetaryRefundAmount: '100',
    });

    expect(classifyCanonicalRefundMonetaryEvidence(collection({
      refunds: [refund({ transactions: [identical, { ...identical, amount: '90.00' }] })],
    }))).toMatchObject({
      classification: 'UNSUPPORTED_OR_AMBIGUOUS',
      reasonCode: 'duplicate_refund_transaction_conflict',
    });
  });

  it('validates multiple refunds at refund and order scope', () => {
    const result = classifyCanonicalRefundMonetaryEvidence(collection({
      orderTotal: '100.00',
      refunds: [
        refund({ id: 'r1', total: '40.00', transactions: [transaction({ id: 't1', amount: '40.00' })] }),
        refund({ id: 'r2', total: '60.00', transactions: [transaction({ id: 't2', amount: '60.00' })] }),
      ],
    }));
    expect(result).toMatchObject({ classification: 'MONETARY_REFUND', monetaryRefundAmount: '100' });
  });

  it('fails closed on currency and aggregate mismatches', () => {
    expect(classifyCanonicalRefundMonetaryEvidence(collection({
      refunds: [refund({ transactions: [transaction({ currency: 'USD' })] })],
    }))).toMatchObject({
      classification: 'UNSUPPORTED_OR_AMBIGUOUS',
      reasonCode: 'canonical_refund_currency_mismatch',
    });
    expect(classifyCanonicalRefundMonetaryEvidence(collection({
      orderTotal: '90.00',
    }))).toMatchObject({
      classification: 'UNSUPPORTED_OR_AMBIGUOUS',
      reasonCode: 'canonical_refund_amount_mismatch',
    });
    expect(classifyCanonicalRefundMonetaryEvidence(collection({
      orderTotal: '100.00',
      refunds: [refund({ total: '90.00' })],
    }))).toMatchObject({
      classification: 'UNSUPPORTED_OR_AMBIGUOUS',
      reasonCode: 'canonical_refund_amount_mismatch',
    });
  });

  it('fails closed on malformed money and positive void evidence', () => {
    expect(classifyCanonicalRefundMonetaryEvidence(collection({
      refunds: [refund({ transactions: [transaction({ amount: 'not-money' })] })],
    }))).toMatchObject({
      classification: 'UNSUPPORTED_OR_AMBIGUOUS',
      reasonCode: 'refund_transaction_ambiguous',
    });
    expect(classifyCanonicalRefundMonetaryEvidence(collection({
      orderTotal: '0.00',
      refunds: [refund({
        total: '0.00',
        transactions: [transaction({ kind: 'VOID', amount: '1.00' })],
      })],
    }))).toMatchObject({
      classification: 'UNSUPPORTED_OR_AMBIGUOUS',
      reasonCode: 'refund_transaction_ambiguous',
    });
  });

  it('fails closed on transaction, line-item, and refund-list incompleteness', () => {
    expect(classifyCanonicalRefundMonetaryEvidence(collection({
      refunds: [refund({ transactionPaginationComplete: false })],
    })).reasonCode).toBe('canonical_refund_transactions_incomplete');
    expect(classifyCanonicalRefundMonetaryEvidence(collection({
      refunds: [refund({ lineItemPaginationComplete: false })],
    })).reasonCode).toBe('canonical_refund_line_items_incomplete');
    expect(classifyCanonicalRefundMonetaryEvidence(collection({
      refundsListComplete: false,
    })).reasonCode).toBe('canonical_refunds_list_incomplete');
  });

  it('prevents zero-value evidence from reaching refund ingestion', async () => {
    const evidence = classifyCanonicalRefundMonetaryEvidence(collection({
      orderTotal: '0.00',
      refunds: [refund({
        total: '0.00',
        transactions: [transaction({ kind: 'VOID', amount: '0.00' })],
      })],
    }));

    await expect(ingestVerifiedShopifyRefund({
      payload: { id: 'refund-1', order_id: '7856043819345', refund_line_items: [] },
      monetaryEvidence: evidence.refunds[0],
    })).rejects.toThrow(/verified positive Shopify monetary refund evidence is required/i);
  });

  it('requires classification when an empty refund list contradicts the order aggregate', () => {
    expect(requiresRefundMonetaryEvidenceClassification(collection({
      orderTotal: '0.00',
      refunds: [],
    }))).toBe(false);
    const incomplete = collection({ orderTotal: '100.00', refunds: [] });
    expect(requiresRefundMonetaryEvidenceClassification(incomplete)).toBe(true);
    expect(classifyCanonicalRefundMonetaryEvidence(incomplete)).toMatchObject({
      classification: 'UNSUPPORTED_OR_AMBIGUOUS',
      reasonCode: 'monetary_refund_transaction_missing',
    });
  });
});
