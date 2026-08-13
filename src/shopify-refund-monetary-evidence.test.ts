import { describe, expect, it } from 'vitest';
import type {
  CanonicalShopifyRefundSnapshot,
  FetchCanonicalShopifyRefundsForOrderResult,
} from '../backend/src/modules/shopify/shopify-admin.types.js';
import {
  classifyCanonicalRefundMonetaryEvidence,
  classifyCustomerRefundCompletion,
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
  financialStatus?: string;
  totalReceived?: string;
  netPayment?: string;
  totalOutstanding?: string;
  totalRefundedShipping?: string;
  refunds?: CanonicalShopifyRefundSnapshot[];
  refundsListComplete?: boolean;
} = {}): CanonicalCollection {
  return {
    orderGid: 'gid://shopify/Order/7856043819345',
    sourceShopifyOrderId: '7856043819345',
    displayFinancialStatus: input.financialStatus ?? 'PARTIALLY_REFUNDED',
    orderTotalReceivedAmount: input.totalReceived ?? '200.00',
    orderTotalReceivedCurrencyCode: input.orderCurrency ?? 'TRY',
    orderTotalRefundedAmount: input.orderTotal ?? '100.00',
    orderTotalRefundedCurrencyCode: input.orderCurrency ?? 'TRY',
    orderNetPaymentAmount: input.netPayment ?? '100.00',
    orderNetPaymentCurrencyCode: input.orderCurrency ?? 'TRY',
    orderTotalOutstandingAmount: input.totalOutstanding ?? '0.00',
    orderTotalOutstandingCurrencyCode: input.orderCurrency ?? 'TRY',
    orderTotalRefundedShippingAmount: input.totalRefundedShipping ?? '0.00',
    orderTotalRefundedShippingCurrencyCode: input.orderCurrency ?? 'TRY',
    refundsListComplete: input.refundsListComplete ?? true,
    refunds: input.refunds ?? [refund()],
    source: 'shopify_admin',
  };
}

describe('Shopify canonical refund monetary evidence', () => {
  it('classifies a complete empty canonical refund collection as no verified monetary refund', () => {
    const canonical = collection({
      financialStatus: 'PAID',
      totalReceived: '200.00',
      orderTotal: '0.00',
      netPayment: '200.00',
      refunds: [],
    });
    expect(classifyCustomerRefundCompletion(canonical)).toMatchObject({
      status: 'NO_VERIFIED_MONETARY_REFUND',
      reasonCode: 'no_verified_monetary_refund',
    });
  });

  it('separates successful refund money from partial customer completion', () => {
    const canonical = collection({
      financialStatus: 'PARTIALLY_REFUNDED',
      totalReceived: '2499.50',
      orderTotal: '2399.50',
      netPayment: '100.00',
      refunds: [refund({ total: '2399.50', transactions: [transaction({ amount: '2399.50' })] })],
    });

    expect(classifyCanonicalRefundMonetaryEvidence(canonical).classification).toBe('MONETARY_REFUND');
    expect(classifyCustomerRefundCompletion(canonical)).toMatchObject({
      status: 'VERIFIED_PARTIAL_CUSTOMER_REFUND',
      netPaymentAmount: '100.00',
      reasonCode: 'canonical_partial_customer_refund_verified',
    });
  });

  it('requires consistent canonical full-refund evidence', () => {
    const canonical = collection({
      financialStatus: 'REFUNDED',
      totalReceived: '2499.50',
      orderTotal: '2499.50',
      netPayment: '0.00',
      totalOutstanding: '0.00',
      totalRefundedShipping: '0.00',
      refunds: [refund({ total: '2499.50', transactions: [transaction({ amount: '2499.50' })] })],
    });

    expect(classifyCustomerRefundCompletion(canonical)).toMatchObject({
      status: 'VERIFIED_FULL_CUSTOMER_REFUND',
      totalRefundedShippingAmount: '0.00',
    });
  });

  it.each([
    { received: '2500.00', refunded: '2350.00', remaining: '150.00' },
    { received: '100.00', refunded: '75.00', remaining: '25.00' },
  ])('classifies canonical remaining money without shipping-policy assumptions: $remaining', ({ received, refunded, remaining }) => {
    const canonical = collection({
      financialStatus: 'PARTIALLY_REFUNDED',
      totalReceived: received,
      orderTotal: refunded,
      netPayment: remaining,
      refunds: [refund({ total: refunded, transactions: [transaction({ amount: refunded })] })],
    });
    expect(classifyCustomerRefundCompletion(canonical).status).toBe('VERIFIED_PARTIAL_CUSTOMER_REFUND');
  });

  it('fails closed when canonical customer money is missing or conflicts with financial status', () => {
    const missing = collection();
    delete missing.orderNetPaymentAmount;
    expect(classifyCustomerRefundCompletion(missing).status).toBe('UNRESOLVED');

    const conflict = collection({
      financialStatus: 'REFUNDED',
      totalReceived: '200.00',
      orderTotal: '100.00',
      netPayment: '100.00',
    });
    expect(classifyCustomerRefundCompletion(conflict)).toMatchObject({
      status: 'UNRESOLVED',
      reasonCode: 'canonical_customer_refund_state_conflict',
    });
  });

  it.each(['PENDING', 'FAILURE', 'ERROR', 'AWAITING_RESPONSE']) (
    'does not promote non-final transaction %s to customer refund completion',
    (status) => {
      const canonical = collection({
        orderTotal: '0.00',
        refunds: [refund({ total: '0.00', transactions: [transaction({ status })] })],
      });
      expect(classifyCustomerRefundCompletion(canonical).status).toBe('UNRESOLVED');
    },
  );

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
      canonicalFinancialStatus: 'REFUNDED',
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
