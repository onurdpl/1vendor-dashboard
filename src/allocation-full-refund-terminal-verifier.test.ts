import { describe, expect, it, vi } from 'vitest';
import {
  createAllocationFullRefundTerminalVerifier,
  verifyAllocationFullRefundTerminal,
  type AllocationForFullRefundTerminalVerification,
  type VerifyAllocationFullRefundTerminalInput,
} from '../backend/src/modules/orders/allocation-full-refund-terminal-verifier.service.js';
import {
  ALLOCATION_ACTIONABILITY_REASONS,
  evaluateAllocationActionability,
} from '../backend/src/modules/orders/allocation-actionability-policy.service.js';
import type {
  CanonicalShopifyOrderSnapshot,
  CanonicalShopifyRefundSnapshot,
} from '../backend/src/modules/shopify/shopify-admin.types.js';

const localOrderId = 'cm1234567890localorder';
const shopifyOrderId = '8151983227217';
const orderGid = `gid://shopify/Order/${shopifyOrderId}`;

function allocationLine(id: string, sourceLineItemId: string, quantity = 1) {
  return {
    id,
    shopifyLineItemId: `local-${sourceLineItemId}`,
    quantity,
    shopifyOrderLineItem: {
      id: `local-${sourceLineItemId}`,
      sourceLineItemId,
    },
  };
}

function allocation(lines = [allocationLine('allocation-line-1', 'line-1')]): AllocationForFullRefundTerminalVerification {
  return {
    id: 'allocation-1',
    sourceShopifyOrderId: localOrderId,
    order: {
      id: localOrderId,
      sourceShopifyOrderId: shopifyOrderId,
    },
    lineItems: lines,
  };
}

function orderLine(sourceLineItemId: string, quantity = 1) {
  return {
    lineItemGid: `gid://shopify/LineItem/${sourceLineItemId}`,
    sourceLineItemId,
    shopifyProductId: null,
    sourceVariantId: null,
    sku: `SKU-${sourceLineItemId}`,
    title: `Product ${sourceLineItemId}`,
    imageUrl: null,
    quantity,
    currentQuantity: quantity,
    refundableQuantity: quantity,
    unitPrice: null,
    unitPriceVatIncluded: null,
    lineTotalVatIncluded: null,
    lineTaxAmount: null,
    vatRate: null,
  };
}

function orderSnapshot(input: {
  lines?: ReturnType<typeof orderLine>[];
  fulfillmentOrders?: CanonicalShopifyOrderSnapshot['fulfillmentOrders'];
} = {}): CanonicalShopifyOrderSnapshot {
  return {
    orderGid,
    sourceShopifyOrderId: shopifyOrderId,
    sourceShopifyOrderNumber: '#100',
    shopifyCreatedAt: null,
    currency: 'TRY',
    financialStatus: 'refunded',
    cancelledAt: null,
    cancelReason: null,
    paymentGatewayName: null,
    taxesIncluded: null,
    orderTaxAmount: null,
    shippingAmount: null,
    discountAmount: null,
    totalPrice: null,
    orderNote: 'must never be retained',
    orderTags: [],
    customerName: 'must never be retained',
    customerEmail: 'private@example.test',
    customerPhone: 'secret',
    billingFullName: null,
    billingCompany: null,
    billingPhone: null,
    billingCity: null,
    billingDistrict: null,
    billingAddress1: null,
    billingAddress2: null,
    billingPostcode: null,
    shippingCountry: null,
    shippingPostcode: null,
    shippingCity: null,
    shippingDistrict: null,
    shippingAddress: 'must never be retained',
    sellerInfo: null,
    lineItems: input.lines ?? [orderLine('line-1')],
    fulfillmentOrders: input.fulfillmentOrders ?? [{
      id: 'gid://shopify/FulfillmentOrder/1',
      status: 'OPEN',
      requestStatus: 'UNSUBMITTED',
      lineItems: [{
        id: 'gid://shopify/FulfillmentOrderLineItem/1',
        lineItemId: 'gid://shopify/LineItem/line-1',
        remainingQuantity: 0,
        totalQuantity: 1,
      }],
    }],
    source: 'shopify_admin',
  };
}

function transaction(id: string, input: { kind?: string | null; status?: string | null; amount?: string } = {}) {
  return {
    transactionGid: `gid://shopify/OrderTransaction/${id}`,
    kind: input.kind === undefined ? 'REFUND' : input.kind,
    status: input.status === undefined ? 'SUCCESS' : input.status,
    amount: input.amount ?? '100.00',
    currencyCode: 'TRY',
    parentTransactionGid: null,
    createdAt: null,
    processedAt: null,
  };
}

function refund(input: {
  id?: string;
  lineItemId?: string;
  quantity?: number;
  total?: string;
  transactions?: ReturnType<typeof transaction>[];
  lineItemPaginationComplete?: boolean;
  transactionPaginationComplete?: boolean;
} = {}): CanonicalShopifyRefundSnapshot {
  const id = input.id ?? 'refund-1';
  const lineItemId = input.lineItemId ?? 'line-1';
  return {
    refundGid: `gid://shopify/Refund/${id}`,
    sourceShopifyRefundId: id,
    createdAt: null,
    updatedAt: null,
    note: 'must never be retained',
    totalRefundedAmount: input.total ?? '100.00',
    totalRefundedCurrencyCode: 'TRY',
    transactionPaginationComplete: input.transactionPaginationComplete ?? true,
    lineItemPaginationComplete: input.lineItemPaginationComplete ?? true,
    transactions: input.transactions ?? [transaction(`transaction-${id}`, { amount: input.total })],
    refundLineItems: [{
      refundLineItemGid: `gid://shopify/RefundLineItem/${id}`,
      sourceRefundLineItemId: `refund-line-${id}`,
      lineItemGid: `gid://shopify/LineItem/${lineItemId}`,
      sourceLineItemId: lineItemId,
      sku: `SKU-${lineItemId}`,
      title: 'Private product title',
      name: 'Private product name',
      variantTitle: null,
      quantity: input.quantity ?? 1,
      subtotalAmount: '9999.00',
      currencyCode: 'TRY',
    }],
  };
}

function verifierInput(input: {
  allocation?: AllocationForFullRefundTerminalVerification;
  order?: CanonicalShopifyOrderSnapshot;
  refunds?: CanonicalShopifyRefundSnapshot[];
  refundsListComplete?: boolean;
  completeness?: Partial<VerifyAllocationFullRefundTerminalInput['completeness']>;
} = {}): VerifyAllocationFullRefundTerminalInput {
  const refunds = input.refunds ?? [refund()];
  const total = refunds.reduce((sum, item) => sum + Number(item.totalRefundedAmount), 0).toFixed(2);
  return {
    allocation: input.allocation ?? allocation(),
    orderSnapshot: input.order ?? orderSnapshot(),
    refundCollection: {
      orderGid,
      sourceShopifyOrderId: shopifyOrderId,
      displayFinancialStatus: 'REFUNDED',
      orderTotalReceivedAmount: total,
      orderTotalReceivedCurrencyCode: 'TRY',
      orderTotalRefundedAmount: total,
      orderTotalRefundedCurrencyCode: 'TRY',
      orderNetPaymentAmount: '0.00',
      orderNetPaymentCurrencyCode: 'TRY',
      orderTotalOutstandingAmount: '0.00',
      orderTotalOutstandingCurrencyCode: 'TRY',
      orderTotalRefundedShippingAmount: '0.00',
      orderTotalRefundedShippingCurrencyCode: 'TRY',
      refundsListComplete: input.refundsListComplete ?? true,
      refunds,
      source: 'shopify_admin',
    },
    completeness: {
      orderLineItemsComplete: input.completeness?.orderLineItemsComplete ?? true,
      fulfillmentOrderPaginationComplete: input.completeness?.fulfillmentOrderPaginationComplete ?? true,
      fulfillmentOrderLineItemPaginationComplete:
        input.completeness?.fulfillmentOrderLineItemPaginationComplete ?? true,
    },
  };
}

describe('allocation full-refund terminal verifier', () => {
  it('qualifies one fully refunded line with zero OPEN remaining quantity', () => {
    const result = verifyAllocationFullRefundTerminal(verifierInput());
    expect(result).toMatchObject({ state: 'QUALIFIES', reasonCode: 'allocation_full_refund_terminal_verified' });
    expect(result.evidence?.lines[0]).toMatchObject({
      vendorAllocationLineItemId: 'allocation-line-1',
      shopifyLineItemGid: 'gid://shopify/LineItem/line-1',
      ownedQuantity: 1,
      successfullyRefundedQuantity: 1,
      remainingFulfillableQuantity: 0,
    });
  });

  it('returns DOES_NOT_QUALIFY for partial refund coverage', () => {
    const result = verifyAllocationFullRefundTerminal(verifierInput({
      allocation: allocation([allocationLine('allocation-line-1', 'line-1', 2)]),
    }));
    expect(result).toMatchObject({ state: 'DOES_NOT_QUALIFY', reasonCode: 'refund_quantity_below_owned_quantity' });
  });

  it('qualifies a fully refunded multi-line allocation', () => {
    const lines = [allocationLine('allocation-line-1', 'line-1'), allocationLine('allocation-line-2', 'line-2')];
    const refunds = [refund({ id: 'r1', lineItemId: 'line-1', total: '40.00' }), refund({ id: 'r2', lineItemId: 'line-2', total: '60.00' })];
    const result = verifyAllocationFullRefundTerminal(verifierInput({
      allocation: allocation(lines),
      order: orderSnapshot({
        lines: [orderLine('line-1'), orderLine('line-2')],
        fulfillmentOrders: [],
      }),
      refunds,
    }));
    expect(result.state).toBe('QUALIFIES');
    expect(result.evidence?.lines).toHaveLength(2);
  });

  it('does not qualify a multi-line allocation when one line is partial', () => {
    const result = verifyAllocationFullRefundTerminal(verifierInput({
      allocation: allocation([
        allocationLine('allocation-line-1', 'line-1'),
        allocationLine('allocation-line-2', 'line-2', 2),
      ]),
      order: orderSnapshot({ lines: [orderLine('line-1'), orderLine('line-2', 2)], fulfillmentOrders: [] }),
      refunds: [refund({ id: 'r1', lineItemId: 'line-1', total: '40.00' }), refund({ id: 'r2', lineItemId: 'line-2', total: '60.00' })],
    }));
    expect(result.state).toBe('DOES_NOT_QUALIFY');
  });

  it('qualifies only the selected allocation in a multi-vendor order', () => {
    const result = verifyAllocationFullRefundTerminal(verifierInput({
      order: orderSnapshot({ lines: [orderLine('line-1'), orderLine('other-vendor')], fulfillmentOrders: [] }),
    }));
    expect(result.state).toBe('QUALIFIES');
    expect(result.evidence?.lines.map((line) => line.shopifyLineItemGid)).toEqual([
      'gid://shopify/LineItem/line-1',
    ]);
  });

  it('fails closed on missing or ambiguous exact Shopify line identity', () => {
    const missing = allocation();
    missing.lineItems[0].shopifyOrderLineItem = null;
    expect(verifyAllocationFullRefundTerminal(verifierInput({ allocation: missing })).state).toBe('INDETERMINATE');

    expect(verifyAllocationFullRefundTerminal(verifierInput({
      order: orderSnapshot({ lines: [orderLine('line-1'), orderLine('line-1')] }),
    })).state).toBe('INDETERMINATE');
  });

  it.each([
    { transactionInput: { status: 'PENDING' }, expected: 'INDETERMINATE' },
    { transactionInput: { status: null }, expected: 'INDETERMINATE' },
    { transactionInput: { kind: null }, expected: 'INDETERMINATE' },
    { transactionInput: { kind: 'UNRECOGNIZED' }, expected: 'INDETERMINATE' },
  ])('does not count unsupported transaction evidence: $transactionInput', ({ transactionInput, expected }) => {
    const result = verifyAllocationFullRefundTerminal(verifierInput({
      refunds: [refund({ total: '0.00', transactions: [transaction('unsupported', transactionInput)] })],
    }));
    expect(result.state).toBe(expected);
  });

  it('does not retain a non-REFUND transaction when valid REFUND/SUCCESS evidence remains', () => {
    const result = verifyAllocationFullRefundTerminal(verifierInput({
      refunds: [refund({
        transactions: [
          transaction('refund', { amount: '100.00' }),
          transaction('void', { kind: 'VOID', amount: '0.00' }),
        ],
      })],
    }));
    expect(result.state).toBe('QUALIFIES');
    expect(result.evidence?.lines[0].refunds[0].transactions).toEqual([{
      shopifyTransactionGid: 'gid://shopify/OrderTransaction/refund',
      kind: 'REFUND',
      status: 'SUCCESS',
    }]);
  });

  it('rejects unsupported monetary classification', () => {
    const result = verifyAllocationFullRefundTerminal(verifierInput({
      refunds: [refund({ total: '0.00', transactions: [transaction('void', { kind: 'VOID', amount: '0.00' })] })],
    }));
    expect(result.state).toBe('DOES_NOT_QUALIFY');
  });

  it('does not qualify while matching OPEN fulfillment quantity remains positive', () => {
    const result = verifyAllocationFullRefundTerminal(verifierInput({
      order: orderSnapshot({ fulfillmentOrders: [{
        id: 'gid://shopify/FulfillmentOrder/1',
        status: 'OPEN',
        requestStatus: null,
        lineItems: [{
          id: 'gid://shopify/FulfillmentOrderLineItem/1',
          lineItemId: 'gid://shopify/LineItem/line-1',
          remainingQuantity: 1,
          totalQuantity: 1,
        }],
      }] }),
    }));
    expect(result).toMatchObject({ state: 'DOES_NOT_QUALIFY', reasonCode: 'open_fulfillment_remaining_quantity_positive' });
  });

  it('fails closed on unknown OPEN remaining quantity', () => {
    const order = orderSnapshot();
    order.fulfillmentOrders[0].lineItems[0].remainingQuantity = null;
    expect(verifyAllocationFullRefundTerminal(verifierInput({ order })).state).toBe('INDETERMINATE');
  });

  it.each([
    { completeness: { fulfillmentOrderPaginationComplete: false } },
    { completeness: { fulfillmentOrderLineItemPaginationComplete: false } },
    { completeness: { orderLineItemsComplete: false } },
  ])('fails closed on incomplete canonical order pagination: $completeness', ({ completeness }) => {
    expect(verifyAllocationFullRefundTerminal(verifierInput({ completeness })).state).toBe('INDETERMINATE');
  });

  it('fails closed on incomplete refund-line, transaction, and refund-list pagination', () => {
    expect(verifyAllocationFullRefundTerminal(verifierInput({
      refunds: [refund({ lineItemPaginationComplete: false })],
    })).state).toBe('INDETERMINATE');
    expect(verifyAllocationFullRefundTerminal(verifierInput({
      refunds: [refund({ transactionPaginationComplete: false })],
    })).state).toBe('INDETERMINATE');
    expect(verifyAllocationFullRefundTerminal(verifierInput({ refundsListComplete: false })).state).toBe('INDETERMINATE');
  });

  it('supports multiple valid refunds that exactly cover owned quantity', () => {
    const result = verifyAllocationFullRefundTerminal(verifierInput({
      allocation: allocation([allocationLine('allocation-line-1', 'line-1', 2)]),
      refunds: [refund({ id: 'r1', total: '40.00' }), refund({ id: 'r2', total: '60.00' })],
    }));
    expect(result.state).toBe('QUALIFIES');
    expect(result.evidence?.lines[0]).toMatchObject({ successfullyRefundedQuantity: 2 });
    expect(result.evidence?.lines[0].refunds).toHaveLength(2);
  });

  it('fails closed on contradictory over-refund quantity evidence', () => {
    const result = verifyAllocationFullRefundTerminal(verifierInput({
      refunds: [refund({ quantity: 2 })],
    }));
    expect(result).toMatchObject({ state: 'INDETERMINATE', reasonCode: 'canonical_refund_quantity_exceeds_owned_quantity' });
  });

  it('may qualify despite historical shipment state when canonical remaining quantity is zero', () => {
    const historicallyShipped = {
      ...allocation(),
      fulfillmentStatus: 'Fulfilled',
      shippingStatus: 'Delivered',
      trackingNumber: 'historical-only',
    };
    expect(verifyAllocationFullRefundTerminal(verifierInput({ allocation: historicallyShipped })).state).toBe('QUALIFIES');
  });

  it('does not use currentQuantity or refundableQuantity as terminality requirements', () => {
    const order = orderSnapshot();
    order.lineItems[0].currentQuantity = 99;
    order.lineItems[0].refundableQuantity = null;
    expect(verifyAllocationFullRefundTerminal(verifierInput({ order })).state).toBe('QUALIFIES');
  });

  it('does not let another vendor line remaining quantity affect this allocation', () => {
    const order = orderSnapshot({
      lines: [orderLine('line-1'), orderLine('other-vendor')],
      fulfillmentOrders: [{
        id: 'gid://shopify/FulfillmentOrder/other',
        status: 'OPEN',
        requestStatus: null,
        lineItems: [{
          id: 'gid://shopify/FulfillmentOrderLineItem/other',
          lineItemId: 'gid://shopify/LineItem/other-vendor',
          remainingQuantity: 3,
          totalQuantity: 3,
        }],
      }],
    });
    expect(verifyAllocationFullRefundTerminal(verifierInput({ order })).state).toBe('QUALIFIES');
  });

  it('returns only the exact versioned, non-monetary, sanitized evidence shape', () => {
    const result = verifyAllocationFullRefundTerminal(verifierInput());
    expect(result.evidence).toMatchObject({
      schemaVersion: 1,
      orderLineItemsComplete: true,
      refundsListComplete: true,
      fulfillmentCollectionsComplete: true,
      refundEvidenceClassification: 'MONETARY_REFUND',
      refundEvidenceReasonCode: 'monetary_refund_verified',
    });
    const serialized = JSON.stringify(result.evidence);
    expect(serialized).not.toMatch(/amount|currency|customer|email|phone|address|note|token|header|payload/i);
    expect(result.evidence?.lines[0].refunds[0].transactions[0]).toEqual({
      shopifyTransactionGid: 'gid://shopify/OrderTransaction/transaction-refund-1',
      kind: 'REFUND',
      status: 'SUCCESS',
    });
  });

  it('uses the existing canonical readers without persisting state', async () => {
    const snapshot = orderSnapshot();
    const canonicalInput = verifierInput();
    const source = {
      fetchCanonicalOrderSnapshot: vi.fn(async () => snapshot),
      fetchCanonicalRefundsForOrder: vi.fn(async () => canonicalInput.refundCollection),
    };
    const result = await createAllocationFullRefundTerminalVerifier({ shopifyAdminService: source }).verify(allocation());
    expect(result.state).toBe('QUALIFIES');
    expect(source.fetchCanonicalOrderSnapshot).toHaveBeenCalledWith(shopifyOrderId);
    expect(source.fetchCanonicalRefundsForOrder).toHaveBeenCalledWith(shopifyOrderId);
    expect(source.fetchCanonicalOrderSnapshot).not.toHaveBeenCalledWith(localOrderId);
    expect(source.fetchCanonicalRefundsForOrder).not.toHaveBeenCalledWith(localOrderId);
  });

  it.each([
    { label: 'missing related ShopifyOrder', order: null },
    { label: 'blank related Shopify source id', order: { id: localOrderId, sourceShopifyOrderId: '  ' } },
  ])('fails closed on $label without calling canonical readers', async ({ order }) => {
    const source = {
      fetchCanonicalOrderSnapshot: vi.fn(),
      fetchCanonicalRefundsForOrder: vi.fn(),
    };
    const input = { ...allocation(), order };

    const result = await createAllocationFullRefundTerminalVerifier({ shopifyAdminService: source }).verify(input);

    expect(result).toEqual({
      state: 'INDETERMINATE',
      reasonCode: 'canonical_shopify_order_identity_missing',
      evidence: null,
    });
    expect(source.fetchCanonicalOrderSnapshot).not.toHaveBeenCalled();
    expect(source.fetchCanonicalRefundsForOrder).not.toHaveBeenCalled();
  });
});

describe('allocation actionability policy foundation', () => {
  it('provides the future shared terminal decision without runtime wiring', () => {
    expect(evaluateAllocationActionability({ fullRefundTerminalFactPresent: false })).toEqual({
      actionable: true,
      reason: null,
    });
    expect(evaluateAllocationActionability({ fullRefundTerminalFactPresent: true })).toEqual({
      actionable: false,
      reason: ALLOCATION_ACTIONABILITY_REASONS.refundTerminal,
    });
    expect(ALLOCATION_ACTIONABILITY_REASONS.refundTerminal).toBe('ALLOCATION_REFUND_TERMINAL');
  });
});
