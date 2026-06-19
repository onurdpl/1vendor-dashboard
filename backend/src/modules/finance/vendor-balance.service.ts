import { Prisma, VendorBalanceEventType } from '@prisma/client';
import { calculateRefundOffsetAmounts } from './refund-offset.service.js';
import { resolveFinanceCurrency } from './finance-currency-policy.service.js';

type VendorBalanceDbClient = Pick<Prisma.TransactionClient, 'vendorBalanceEvent'>;

export type VendorBalanceSummary = {
  vendorId: string;
  currency: 'TRY';
  balanceMinor: number;
  outstandingDebtMinor: number;
};

export type VendorDebtOffsetCalculation = {
  grossPayableMinor: number;
  outstandingDebtMinor: number;
  debtOffsetMinor: number;
  netPayableMinor: number;
  remainingDebtMinor: number;
};

function resolveSupportedCurrency(inputCurrency: string | null | undefined) {
  const resolution = resolveFinanceCurrency(inputCurrency);
  if (!resolution.ok) {
    throw new Error(`Unsupported non-TRY vendor balance currency ${resolution.unsupportedCurrency}.`);
  }
  return resolution.currency;
}

function safeMetadata(value: Record<string, unknown>): Prisma.InputJsonObject {
  return value as Prisma.InputJsonObject;
}

export function calculateVendorDebtMinorForRefund(input: {
  refundAmount: unknown;
  commissionPercentSnapshot?: unknown;
  commissionVatPercentSnapshot?: unknown;
}) {
  return calculateRefundOffsetAmounts(input).vendorPayableReversalMinor;
}

export function calculateVendorDebtOffset(input: {
  grossPayableMinor: number;
  outstandingDebtMinor: number;
}): VendorDebtOffsetCalculation {
  const grossPayableMinor = Math.max(Math.round(input.grossPayableMinor), 0);
  const outstandingDebtMinor = Math.max(Math.round(input.outstandingDebtMinor), 0);
  const debtOffsetMinor = Math.min(grossPayableMinor, outstandingDebtMinor);

  return {
    grossPayableMinor,
    outstandingDebtMinor,
    debtOffsetMinor,
    netPayableMinor: Math.max(grossPayableMinor - debtOffsetMinor, 0),
    remainingDebtMinor: Math.max(outstandingDebtMinor - debtOffsetMinor, 0),
  };
}

export async function getVendorBalanceSummary(
  db: VendorBalanceDbClient,
  vendorId: string,
  inputCurrency: string | null | undefined = 'TRY',
): Promise<VendorBalanceSummary> {
  const currency = resolveSupportedCurrency(inputCurrency);
  const events = await db.vendorBalanceEvent.findMany({
    where: {
      vendorId,
      currency,
    },
    select: {
      type: true,
      amountMinor: true,
      payoutBatch: {
        select: {
          status: true,
        },
      },
    },
  });
  const balanceMinor = events.reduce((sum, event) => {
    if (
      event.type === VendorBalanceEventType.VENDOR_DEBT_OFFSET &&
      event.payoutBatch?.status === 'CANCELLED'
    ) {
      return sum;
    }
    return sum + event.amountMinor;
  }, 0);

  return {
    vendorId,
    currency,
    balanceMinor,
    outstandingDebtMinor: balanceMinor < 0 ? Math.abs(balanceMinor) : 0,
  };
}

export async function createVendorDebtForPaidRefund(
  db: VendorBalanceDbClient,
  input: {
    vendorId: string;
    refundRecordId: string;
    sourceShopifyRefundId: string;
    financeLedgerEntryId: string;
    refundAmount: unknown;
    commissionPercentSnapshot?: unknown;
    commissionVatPercentSnapshot?: unknown;
    currency?: string | null;
    sourceShopifyOrderId?: string | null;
    sourceShopifyOrderNumber?: string | null;
    vendorAllocationId?: string | null;
  },
) {
  const currency = resolveSupportedCurrency(input.currency);
  const refundOffset = calculateRefundOffsetAmounts({
    refundAmount: input.refundAmount,
    commissionPercentSnapshot: input.commissionPercentSnapshot,
    commissionVatPercentSnapshot: input.commissionVatPercentSnapshot,
  });

  if (refundOffset.vendorPayableReversalMinor <= 0) {
    return null;
  }

  const idempotencyKey = `${input.vendorId}:${input.refundRecordId}:VENDOR_DEBT_CREATED`;

  return db.vendorBalanceEvent.upsert({
    where: {
      idempotencyKey,
    },
    update: {},
    create: {
      vendorId: input.vendorId,
      type: VendorBalanceEventType.VENDOR_DEBT_CREATED,
      amountMinor: -refundOffset.vendorPayableReversalMinor,
      currency,
      sourceType: 'shopify_refund',
      sourceId: input.refundRecordId,
      financeLedgerEntryId: input.financeLedgerEntryId,
      refundRecordId: input.refundRecordId,
      idempotencyKey,
      metadataJson: safeMetadata({
        sourceShopifyRefundId: input.sourceShopifyRefundId,
        sourceShopifyOrderId: input.sourceShopifyOrderId ?? null,
        sourceShopifyOrderNumber: input.sourceShopifyOrderNumber ?? null,
        vendorAllocationId: input.vendorAllocationId ?? null,
        refundMinor: refundOffset.refundMinor,
        commissionReversalMinor: refundOffset.commissionReversalMinor,
        commissionVatReversalMinor: refundOffset.commissionVatReversalMinor,
        vendorDebtMinor: refundOffset.vendorPayableReversalMinor,
        formula:
          'vendorDebtMinor = refundMinor - commissionReversalMinor - commissionVatReversalMinor',
      }),
    },
  });
}

export async function createVendorDebtOffsetForPayoutBatch(
  db: VendorBalanceDbClient,
  input: {
    vendorId: string;
    payoutBatchId: string;
    debtOffsetMinor: number;
    grossPayableMinor: number;
    outstandingDebtMinor: number;
    remainingDebtMinor: number;
    currency?: string | null;
    createdByUserId?: string | null;
  },
) {
  const debtOffsetMinor = Math.max(Math.round(input.debtOffsetMinor), 0);
  if (debtOffsetMinor <= 0) {
    return null;
  }

  const currency = resolveSupportedCurrency(input.currency);
  const idempotencyKey = `${input.payoutBatchId}:VENDOR_DEBT_OFFSET`;

  return db.vendorBalanceEvent.upsert({
    where: {
      idempotencyKey,
    },
    update: {},
    create: {
      vendorId: input.vendorId,
      type: VendorBalanceEventType.VENDOR_DEBT_OFFSET,
      amountMinor: debtOffsetMinor,
      currency,
      sourceType: 'payout_batch',
      sourceId: input.payoutBatchId,
      payoutBatchId: input.payoutBatchId,
      idempotencyKey,
      metadataJson: safeMetadata({
        grossPayableMinor: input.grossPayableMinor,
        outstandingDebtMinor: input.outstandingDebtMinor,
        debtOffsetMinor,
        remainingDebtMinor: input.remainingDebtMinor,
        createdByUserId: input.createdByUserId ?? null,
      }),
    },
  });
}
