import type {
  CreateShopifyRefundInput,
  CreateShopifyRefundResult,
  PreviewSuggestedRefundResult,
} from '../shopify/shopify-admin.types.js';

export type ShopifyRefundCoreService = {
  createShopifyRefund(input: CreateShopifyRefundInput): Promise<CreateShopifyRefundResult>;
};

export function validateSuggestedRefundForSubmission(input: {
  preview: PreviewSuggestedRefundResult;
  orderCurrency: string | null;
}) {
  const blockers = input.preview.graphqlErrors.map(
    (error) => `Shopify suggested refund returned GraphQL error: ${error}`,
  );
  const transactions = input.preview.suggestedRefund?.suggestedTransactions ?? [];
  if (transactions.length === 0) {
    blockers.push('Suggested refund has no refundable payment transaction. RefundCreate must not run.');
  }
  for (const transaction of transactions) {
    if (!transaction.parentTransactionId?.trim()) blockers.push('Suggested refund transaction is missing parentTransactionId. RefundCreate must not run.');
    if (!transaction.amount?.trim()) blockers.push('Suggested refund transaction is missing amount. RefundCreate must not run.');
    if (!transaction.gateway?.trim()) blockers.push('Suggested refund transaction is missing gateway. RefundCreate must not run.');
    if (
      transaction.currencyCode?.trim() &&
      input.orderCurrency?.trim() &&
      transaction.currencyCode.trim().toUpperCase() !== input.orderCurrency.trim().toUpperCase()
    ) {
      blockers.push('Suggested refund transaction currency conflicts with the order currency. RefundCreate must not run.');
    }
  }
  return {
    blockers,
    transactions: transactions.map((transaction) => ({
      gateway: transaction.gateway?.trim() ?? '',
      amount: transaction.amount?.trim() ?? '',
      currencyCode: transaction.currencyCode,
      parentTransactionId: transaction.parentTransactionId?.trim() ?? '',
    })),
  };
}

export function submitShopifyRefundCore(input: {
  service: ShopifyRefundCoreService;
  refund: CreateShopifyRefundInput;
}) {
  return input.service.createShopifyRefund(input.refund);
}
