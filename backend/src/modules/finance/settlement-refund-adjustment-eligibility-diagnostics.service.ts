import { Prisma, SettlementRefundAdjustmentStatus, VendorBalanceEventType } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { calculateRefundOffsetAmounts } from './refund-offset.service.js';

const ACTIVE_COMMISSION_INVOICE_STATUSES = new Set(['PENDING', 'CREATED', 'FAILED', 'UNKNOWN']);

export type RefundAdjustmentRecommendedAction =
  | 'CREATE_PENDING_ADJUSTMENT'
  | 'ALREADY_HAS_ADJUSTMENT'
  | 'VENDOR_DEBT_REQUIRED'
  | 'NOT_AFTER_APPROVED_OR_INVOICED_SETTLEMENT'
  | 'MISSING_RELATED_SALE_LEDGER'
  | 'MISSING_APPROVED_SETTLEMENT_LINE'
  | 'MISSING_VENDOR_ALLOCATION'
  | 'ZERO_OR_INVALID_AMOUNT'
  | 'UNKNOWN';

export type RefundAdjustmentEligibilityEvidence = {
  relatedSaleFinanceLedgerEntryId: string | null;
  salePayoutStatus: string | null;
  saleSettlementStatus: string | null;
  settlementApprovalLineId: string | null;
  settlementApprovalId: string | null;
  settlementApprovalStatus: string | null;
  settlementCommissionInvoiceId: string | null;
  settlementCommissionInvoiceStatus: string | null;
  vendorDebtEventId: string | null;
};

export type RefundAdjustmentEligibilityRecord = {
  refundFinanceLedgerEntryId: string;
  refundRecordId: string | null;
  vendorId: string;
  orderId: string | null;
  originalOrderId: string | null;
  amountMinor: number;
  currencyCode: string;
  createdAt: string;
  existingAdjustmentId: string | null;
  recommendedAction: RefundAdjustmentRecommendedAction;
  blockerReason: string | null;
  evidence: RefundAdjustmentEligibilityEvidence;
};

export type RefundAdjustmentEligibilityPreview = {
  ok: true;
  writesPerformed: false;
  summary: {
    totalRefundLedgers: number;
    createPendingAdjustment: number;
    alreadyHasAdjustment: number;
    vendorDebtRequired: number;
    missingApprovedSettlementLine: number;
    missingRelatedSaleLedger: number;
    notAfterApprovedOrInvoicedSettlement: number;
    unknown: number;
  };
  records: RefundAdjustmentEligibilityRecord[];
};

type RefundAdjustmentEligibilityDbClient = Pick<Prisma.TransactionClient, 'financeLedgerEntry'>;

type RefundLedgerRow = Prisma.PromiseReturnType<typeof findRefundLedgerRows>[number];

function normalize(value: unknown) {
  return String(value ?? '').trim().toUpperCase();
}

function toNumber(value: unknown) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function toMinorUnits(value: unknown) {
  return Math.round(toNumber(value) * 100);
}

function normalizeOrderNumber(value: string) {
  return value.trim().replace(/^#/, '');
}

function chooseRefundRecord(row: RefundLedgerRow) {
  const suffixMatch = row.id.match(/refund-(.+)$/);
  const sourceRefundId = suffixMatch?.[1] ?? null;
  if (sourceRefundId) {
    const exact = row.vendorAllocation?.refundRecords.find((refund) => refund.sourceShopifyRefundId === sourceRefundId);
    if (exact) {
      return exact;
    }
  }

  return row.vendorAllocation?.refundRecords[0] ?? null;
}

function chooseSaleLedger(row: RefundLedgerRow) {
  return row.vendorAllocation?.financeEntries.find((entry) => normalize(entry.entryType) === 'SALE') ?? null;
}

function chooseApprovedSettlementLine(saleLedger: ReturnType<typeof chooseSaleLedger>) {
  return (saleLedger?.settlementApprovalLines ?? [])
    .filter((line) => normalize(line.settlementApproval.status) === 'APPROVED')
    .sort((left, right) => {
      const leftTime = left.settlementApproval.approvedAt?.getTime() ?? 0;
      const rightTime = right.settlementApproval.approvedAt?.getTime() ?? 0;
      return rightTime - leftTime;
    })[0] ?? null;
}

function chooseActiveCommissionInvoice(line: ReturnType<typeof chooseApprovedSettlementLine>) {
  return (line?.settlementApproval.commissionInvoices ?? [])
    .filter((invoice) => ACTIVE_COMMISSION_INVOICE_STATUSES.has(normalize(invoice.status)))
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0] ?? null;
}

function chooseVendorDebtEvent(row: RefundLedgerRow) {
  return row.vendorBalanceEvents
    .filter((event) => event.type === VendorBalanceEventType.VENDOR_DEBT_CREATED)
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0] ?? null;
}

function buildEvidence(input: {
  saleLedger: ReturnType<typeof chooseSaleLedger>;
  approvedLine: ReturnType<typeof chooseApprovedSettlementLine>;
  commissionInvoice: ReturnType<typeof chooseActiveCommissionInvoice>;
  vendorDebtEvent: ReturnType<typeof chooseVendorDebtEvent>;
}): RefundAdjustmentEligibilityEvidence {
  return {
    relatedSaleFinanceLedgerEntryId: input.saleLedger?.id ?? null,
    salePayoutStatus: input.saleLedger?.payoutStatus ?? null,
    saleSettlementStatus: input.saleLedger?.settlementStatus ?? null,
    settlementApprovalLineId: input.approvedLine?.id ?? null,
    settlementApprovalId: input.approvedLine?.settlementApproval.id ?? null,
    settlementApprovalStatus: input.approvedLine?.settlementApproval.status ?? null,
    settlementCommissionInvoiceId: input.commissionInvoice?.id ?? null,
    settlementCommissionInvoiceStatus: input.commissionInvoice?.status ?? null,
    vendorDebtEventId: input.vendorDebtEvent?.id ?? null,
  };
}

export function classifyRefundAdjustmentEligibility(row: RefundLedgerRow): RefundAdjustmentEligibilityRecord {
  const existingAdjustment = row.refundAdjustments[0] ?? null;
  const refundRecord = chooseRefundRecord(row);
  const saleLedger = chooseSaleLedger(row);
  const approvedLine = chooseApprovedSettlementLine(saleLedger);
  const commissionInvoice = chooseActiveCommissionInvoice(approvedLine);
  const vendorDebtEvent = chooseVendorDebtEvent(row);
  const evidence = buildEvidence({
    saleLedger,
    approvedLine,
    commissionInvoice,
    vendorDebtEvent,
  });
  const currencyCode = row.vendorAllocation?.order?.currency ?? 'TRY';
  const orderId = row.vendorAllocation?.order?.id ?? null;
  const amountMinor = toMinorUnits(row.amount);

  let recommendedAction: RefundAdjustmentRecommendedAction = 'UNKNOWN';
  let blockerReason: string | null = null;

  if (existingAdjustment) {
    recommendedAction = 'ALREADY_HAS_ADJUSTMENT';
  } else if (!row.vendorAllocation) {
    recommendedAction = 'MISSING_VENDOR_ALLOCATION';
    blockerReason = 'Refund ledger is not linked to a vendor allocation.';
  } else if (!saleLedger) {
    recommendedAction = 'MISSING_RELATED_SALE_LEDGER';
    blockerReason = 'Refund ledger allocation has no related sale ledger row.';
  } else if (normalize(saleLedger.payoutStatus) === 'PAID' || normalize(saleLedger.settlementStatus) === 'SETTLED') {
    recommendedAction = 'VENDOR_DEBT_REQUIRED';
    blockerReason = 'Related sale ledger is already paid or settled; vendor debt path applies.';
  } else if (!approvedLine) {
    recommendedAction = 'MISSING_APPROVED_SETTLEMENT_LINE';
    blockerReason = 'Related sale ledger has no approved settlement approval line.';
  } else {
    const offset = calculateRefundOffsetAmounts({
      refundAmount: row.amount,
      commissionPercentSnapshot: row.commissionPercentSnapshot ?? saleLedger.commissionPercentSnapshot,
      commissionVatPercentSnapshot: row.commissionVatPercentSnapshot ?? saleLedger.commissionVatPercentSnapshot,
    });
    if (offset.vendorPayableReversalMinor <= 0 || amountMinor <= 0 || !orderId || !refundRecord?.id) {
      recommendedAction = 'ZERO_OR_INVALID_AMOUNT';
      blockerReason = !orderId
        ? 'Original order id is unavailable.'
        : !refundRecord?.id
          ? 'Refund record id is unavailable.'
          : 'Refund payable reversal amount is zero or invalid.';
    } else {
      recommendedAction = 'CREATE_PENDING_ADJUSTMENT';
    }
  }

  return {
    refundFinanceLedgerEntryId: row.id,
    refundRecordId: refundRecord?.id ?? null,
    vendorId: row.vendorId,
    orderId,
    originalOrderId: orderId,
    amountMinor,
    currencyCode,
    createdAt: row.createdAt.toISOString(),
    existingAdjustmentId: existingAdjustment?.id ?? null,
    recommendedAction,
    blockerReason,
    evidence,
  };
}

function summarize(records: RefundAdjustmentEligibilityRecord[]): RefundAdjustmentEligibilityPreview['summary'] {
  return records.reduce<RefundAdjustmentEligibilityPreview['summary']>((summary, record) => {
    summary.totalRefundLedgers += 1;
    if (record.recommendedAction === 'CREATE_PENDING_ADJUSTMENT') {
      summary.createPendingAdjustment += 1;
    } else if (record.recommendedAction === 'ALREADY_HAS_ADJUSTMENT') {
      summary.alreadyHasAdjustment += 1;
    } else if (record.recommendedAction === 'VENDOR_DEBT_REQUIRED') {
      summary.vendorDebtRequired += 1;
    } else if (record.recommendedAction === 'MISSING_APPROVED_SETTLEMENT_LINE') {
      summary.missingApprovedSettlementLine += 1;
    } else if (record.recommendedAction === 'MISSING_RELATED_SALE_LEDGER') {
      summary.missingRelatedSaleLedger += 1;
    } else if (record.recommendedAction === 'NOT_AFTER_APPROVED_OR_INVOICED_SETTLEMENT') {
      summary.notAfterApprovedOrInvoicedSettlement += 1;
    } else if (record.recommendedAction === 'UNKNOWN' || record.recommendedAction === 'MISSING_VENDOR_ALLOCATION' || record.recommendedAction === 'ZERO_OR_INVALID_AMOUNT') {
      summary.unknown += 1;
    }
    return summary;
  }, {
    totalRefundLedgers: 0,
    createPendingAdjustment: 0,
    alreadyHasAdjustment: 0,
    vendorDebtRequired: 0,
    missingApprovedSettlementLine: 0,
    missingRelatedSaleLedger: 0,
    notAfterApprovedOrInvoicedSettlement: 0,
    unknown: 0,
  });
}

async function findRefundLedgerRows(
  db: RefundAdjustmentEligibilityDbClient,
  input: {
    vendorId?: string | null;
    orderNumber?: string | null;
    limit?: number;
  },
) {
  const orderNumber = input.orderNumber?.trim();
  const normalizedOrderNumber = orderNumber ? normalizeOrderNumber(orderNumber) : null;

  return db.financeLedgerEntry.findMany({
    where: {
      entryType: 'refund',
      ...(input.vendorId ? { vendorId: input.vendorId } : {}),
      ...(normalizedOrderNumber
        ? {
            vendorAllocation: {
              is: {
                OR: [
                  { sourceShopifyOrderNumber: orderNumber },
                  { sourceShopifyOrderNumber: `#${normalizedOrderNumber}` },
                  { sourceShopifyOrderId: orderNumber },
                  { sourceShopifyOrderId: normalizedOrderNumber },
                ],
              },
            },
          }
        : {}),
    },
    select: {
      id: true,
      vendorId: true,
      amount: true,
      createdAt: true,
      commissionPercentSnapshot: true,
      commissionVatPercentSnapshot: true,
      refundAdjustments: {
        select: {
          id: true,
          status: true,
        },
        take: 1,
      },
      vendorBalanceEvents: {
        where: {
          type: VendorBalanceEventType.VENDOR_DEBT_CREATED,
        },
        select: {
          id: true,
          type: true,
          createdAt: true,
        },
      },
      vendorAllocation: {
        select: {
          id: true,
          sourceShopifyOrderId: true,
          sourceShopifyOrderNumber: true,
          order: {
            select: {
              id: true,
              currency: true,
            },
          },
          refundRecords: {
            select: {
              id: true,
              sourceShopifyRefundId: true,
            },
            orderBy: {
              createdAt: 'asc',
            },
          },
          financeEntries: {
            where: {
              entryType: 'sale',
            },
            select: {
              id: true,
              entryType: true,
              payoutStatus: true,
              settlementStatus: true,
              commissionPercentSnapshot: true,
              commissionVatPercentSnapshot: true,
              settlementApprovalLines: {
                select: {
                  id: true,
                  settlementApproval: {
                    select: {
                      id: true,
                      status: true,
                      approvedAt: true,
                      commissionInvoices: {
                        select: {
                          id: true,
                          status: true,
                          createdAt: true,
                        },
                        orderBy: {
                          createdAt: 'desc',
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    orderBy: {
      createdAt: 'desc',
    },
    take: input.limit ?? 100,
  });
}

export async function previewRefundAdjustmentEligibility(input: {
  vendorId?: string | null;
  orderNumber?: string | null;
  recommendedAction?: RefundAdjustmentRecommendedAction | null;
  limit?: number;
  db?: RefundAdjustmentEligibilityDbClient;
} = {}): Promise<RefundAdjustmentEligibilityPreview> {
  const rows = await findRefundLedgerRows(input.db ?? prisma, input);
  const classified = rows
    .map(classifyRefundAdjustmentEligibility)
    .filter((record) => !input.recommendedAction || record.recommendedAction === input.recommendedAction);

  return {
    ok: true,
    writesPerformed: false,
    summary: summarize(classified),
    records: classified,
  };
}
