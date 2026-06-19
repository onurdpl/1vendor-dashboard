import { Prisma, VendorBalanceEventType } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { calculateRefundOffsetAmounts } from './refund-offset.service.js';
import { resolveFinanceCurrency } from './finance-currency-policy.service.js';
import type { VendorDebtHistoryDto, VendorDebtHistoryProductDto } from './finance.types.js';

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

function toNumber(value: unknown) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function readMetadataNumber(metadata: unknown, key: string) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return null;
  }
  const value = (metadata as Record<string, unknown>)[key];
  if (value === null || value === undefined) {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function readMetadataString(metadata: unknown, key: string) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return null;
  }
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function formatEventLabel(type: string) {
  if (type === VendorBalanceEventType.VENDOR_DEBT_CREATED) {
    return 'Debt Created';
  }
  if (type === VendorBalanceEventType.VENDOR_DEBT_OFFSET) {
    return 'Debt Offset Applied';
  }
  if (type === VendorBalanceEventType.DEBT_WAIVED) {
    return 'Debt Waived';
  }
  if (type === VendorBalanceEventType.MANUAL_ADJUSTMENT) {
    return 'Manual Adjustment';
  }
  return 'Payable Earned';
}

function normalizeProducts(
  lineItems: Array<{
    title?: string | null;
    sku?: string | null;
    quantity?: number | null;
  }>,
): VendorDebtHistoryProductDto[] {
  return lineItems.map((lineItem) => ({
    title: lineItem.title ?? null,
    sku: lineItem.sku ?? null,
    quantity: Math.max(Number(lineItem.quantity ?? 0), 0),
  }));
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

export async function getVendorDebtHistory(
  vendorId: string,
  inputCurrency: string | null | undefined = 'TRY',
): Promise<VendorDebtHistoryDto> {
  const currency = resolveSupportedCurrency(inputCurrency);
  const events = await prisma.vendorBalanceEvent.findMany({
    where: {
      vendorId,
      currency,
      type: {
        in: [
          VendorBalanceEventType.VENDOR_DEBT_CREATED,
          VendorBalanceEventType.VENDOR_DEBT_OFFSET,
          VendorBalanceEventType.MANUAL_ADJUSTMENT,
          VendorBalanceEventType.DEBT_WAIVED,
        ],
      },
    },
    include: {
      vendor: {
        select: {
          id: true,
          name: true,
        },
      },
      refundRecord: {
        select: {
          id: true,
          sourceShopifyRefundId: true,
          sourceShopifyOrderId: true,
          sourceShopifyOrderNumber: true,
          amount: true,
          createdAt: true,
          lineItems: {
            select: {
              title: true,
              sku: true,
              quantity: true,
            },
          },
          vendorAllocation: {
            select: {
              id: true,
              sourceShopifyOrderId: true,
              sourceShopifyOrderNumber: true,
              order: {
                select: {
                  createdAt: true,
                },
              },
              lineItems: {
                select: {
                  quantity: true,
                  shopifyOrderLineItem: {
                    select: {
                      title: true,
                      sku: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
      financeLedgerEntry: {
        select: {
          id: true,
          vendorAllocation: {
            select: {
              id: true,
              sourceShopifyOrderId: true,
              sourceShopifyOrderNumber: true,
              order: {
                select: {
                  createdAt: true,
                },
              },
              lineItems: {
                select: {
                  quantity: true,
                  shopifyOrderLineItem: {
                    select: {
                      title: true,
                      sku: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
      payoutBatch: {
        select: {
          id: true,
          status: true,
          createdAt: true,
          updatedAt: true,
        },
      },
    },
    orderBy: [
      { createdAt: 'asc' },
      { id: 'asc' },
    ],
  });

  let balanceMinor = 0;
  let totalDebtCreatedMinor = 0;
  let totalDebtOffsetMinor = 0;
  const computedRows = events.map((event) => {
    const cancelledOffset =
      event.type === VendorBalanceEventType.VENDOR_DEBT_OFFSET &&
      event.payoutBatch?.status === 'CANCELLED';
    const effectiveAmountMinor = cancelledOffset ? 0 : event.amountMinor;
    balanceMinor += effectiveAmountMinor;
    if (event.type === VendorBalanceEventType.VENDOR_DEBT_CREATED) {
      totalDebtCreatedMinor += Math.abs(event.amountMinor);
    }
    if (event.type === VendorBalanceEventType.VENDOR_DEBT_OFFSET && !cancelledOffset) {
      totalDebtOffsetMinor += Math.max(event.amountMinor, 0);
    }

    const refundProducts = normalizeProducts(event.refundRecord?.lineItems ?? []);
    const allocationProducts = normalizeProducts(
      (
        event.refundRecord?.vendorAllocation?.lineItems ??
        event.financeLedgerEntry?.vendorAllocation?.lineItems ??
        []
      ).map((lineItem) => ({
        title: lineItem.shopifyOrderLineItem?.title ?? null,
        sku: lineItem.shopifyOrderLineItem?.sku ?? null,
        quantity: lineItem.quantity,
      })),
    );
    const products = refundProducts.length ? refundProducts : allocationProducts;
    const metadata = event.metadataJson;
    const orderNumber =
      event.refundRecord?.sourceShopifyOrderNumber ??
      event.refundRecord?.vendorAllocation?.sourceShopifyOrderNumber ??
      event.financeLedgerEntry?.vendorAllocation?.sourceShopifyOrderNumber ??
      readMetadataString(metadata, 'sourceShopifyOrderNumber');
    const shopifyOrderId =
      event.refundRecord?.sourceShopifyOrderId ??
      event.refundRecord?.vendorAllocation?.sourceShopifyOrderId ??
      event.financeLedgerEntry?.vendorAllocation?.sourceShopifyOrderId ??
      readMetadataString(metadata, 'sourceShopifyOrderId');
    const refundReference =
      event.refundRecord?.sourceShopifyRefundId ??
      readMetadataString(metadata, 'sourceShopifyRefundId');
    const payoutBatchId = event.payoutBatch?.id ?? event.payoutBatchId;
    const sourceReference =
      refundReference ??
      payoutBatchId ??
      event.sourceId;
    const remainingDebtAfterEventMinor = balanceMinor < 0 ? Math.abs(balanceMinor) : 0;

    return {
      id: event.id,
      createdAt: event.createdAt.toISOString(),
      type: event.type,
      label: formatEventLabel(event.type),
      vendorId: event.vendorId,
      vendorName: event.vendor?.name ?? null,
      orderNumber,
      shopifyOrderId,
      orderCreatedAt: (
        event.refundRecord?.vendorAllocation?.order?.createdAt ??
        event.financeLedgerEntry?.vendorAllocation?.order?.createdAt ??
        null
      )?.toISOString() ?? null,
      refundReference,
      refundRecordId: event.refundRecordId,
      payoutBatchId,
      payoutBatchStatus: event.payoutBatch?.status ?? null,
      itemCount: products.reduce((sum, product) => sum + product.quantity, 0),
      productCount: products.length,
      products,
      amountMinor: event.amountMinor,
      debtAmountMinor: event.type === VendorBalanceEventType.VENDOR_DEBT_CREATED
        ? Math.abs(event.amountMinor)
        : event.type === VendorBalanceEventType.VENDOR_DEBT_OFFSET
          ? -Math.max(event.amountMinor, 0)
          : event.amountMinor,
      remainingDebtAfterEventMinor,
      sourceReference,
      financeLedgerEntryId: event.financeLedgerEntryId,
      calculation: {
        refundMinor:
          readMetadataNumber(metadata, 'refundMinor') ??
          (event.refundRecord?.amount === null || event.refundRecord?.amount === undefined
            ? null
            : Math.round(toNumber(event.refundRecord.amount) * 100)),
        commissionReversalMinor: readMetadataNumber(metadata, 'commissionReversalMinor'),
        commissionVatReversalMinor: readMetadataNumber(metadata, 'commissionVatReversalMinor'),
        vendorDebtMinor: readMetadataNumber(metadata, 'vendorDebtMinor'),
        debtOffsetMinor: readMetadataNumber(metadata, 'debtOffsetMinor'),
        formula: readMetadataString(metadata, 'formula'),
      },
      cancelledOffset,
    };
  });

  const offsetHistory = computedRows
    .filter((row) => row.type === VendorBalanceEventType.VENDOR_DEBT_OFFSET && !row.cancelledOffset)
    .map((row) => ({
      id: row.id,
      createdAt: row.createdAt,
      payoutBatchId: row.payoutBatchId,
      payoutBatchStatus: row.payoutBatchStatus,
      offsetAmountMinor: Math.max(row.amountMinor, 0),
      remainingDebtAfterEventMinor: row.remainingDebtAfterEventMinor,
    }));
  const rows = computedRows
    .slice()
    .reverse()
    .map(({ cancelledOffset, ...row }) => ({
      ...row,
      offsetHistory,
    }));
  const lastDebtActivityAt = rows[0]?.createdAt ?? null;
  const outstandingDebtMinor = balanceMinor < 0 ? Math.abs(balanceMinor) : 0;

  return {
    ok: true,
    writesPerformed: false,
    vendorId,
    currency,
    summary: {
      outstandingDebtMinor,
      totalDebtCreatedMinor,
      totalDebtOffsetMinor,
      remainingDebtMinor: outstandingDebtMinor,
      lastDebtActivityAt,
    },
    events: rows.slice(0, 100),
  };
}
