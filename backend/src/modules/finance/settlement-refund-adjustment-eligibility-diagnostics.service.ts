import { Prisma, SettlementRefundAdjustmentStatus, VendorBalanceEventType } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { calculateRefundOffsetAmounts } from './refund-offset.service.js';
import { createSettlementRefundAdjustmentForRefundLedger } from './settlement-refund-adjustment.service.js';

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
type RefundAdjustmentBackfillTransaction = Pick<
  Prisma.TransactionClient,
  'financeLedgerEntry' | 'settlementRefundAdjustment'
>;
type RefundAdjustmentBackfillDbClient = RefundAdjustmentBackfillTransaction & {
  $transaction<T>(callback: (tx: RefundAdjustmentBackfillTransaction) => Promise<T>): Promise<T>;
};
type RefundAdjustmentApplicationPreviewDbClient = Pick<Prisma.TransactionClient, 'settlementRefundAdjustment'>;

export type RefundAdjustmentBackfillResult = {
  ok: true;
  writesPerformed: boolean;
  summary: {
    eligible: number;
    created: number;
    alreadyExisting: number;
    skipped: number;
    failed: number;
  };
  createdRecords: Array<{
    id: string;
    refundFinanceLedgerEntryId: string;
    refundRecordId: string;
    vendorId: string;
    status: string;
  }>;
  skippedRecords: Array<{
    refundFinanceLedgerEntryId: string;
    refundRecordId: string | null;
    recommendedAction: RefundAdjustmentRecommendedAction;
    reason: string;
  }>;
};

export type PendingRefundAdjustmentApplicationPreviewRecord = {
  adjustmentId: string;
  originalOrderId: string;
  refundRecordId: string;
  refundFinanceLedgerEntryId: string;
  originalSettlementApprovalId: string | null;
  originalSettlementCommissionInvoiceId: string | null;
  amountMinor: number;
  currencyCode: string;
  reason: string;
  previewImpactMinor: number;
};

export type PendingRefundAdjustmentApplicationPreview = {
  ok: true;
  writesPerformed: false;
  vendorId: string;
  pendingAdjustmentCount: number;
  pendingAdjustmentTotalMinor: number;
  currentCandidateNetPayableMinor: number | null;
  netAfterPendingRefundAdjustmentsMinor: number | null;
  currencyCode: string | null;
  records: PendingRefundAdjustmentApplicationPreviewRecord[];
  notes: string[];
};

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

export async function backfillPendingRefundAdjustments(input: {
  vendorId?: string | null;
  orderNumber?: string | null;
  limit?: number;
  createdBy?: string | null;
  db?: RefundAdjustmentBackfillDbClient;
} = {}): Promise<RefundAdjustmentBackfillResult> {
  const db = (input.db ?? prisma) as RefundAdjustmentBackfillDbClient;
  const preview = await previewRefundAdjustmentEligibility({
    vendorId: input.vendorId,
    orderNumber: input.orderNumber,
    limit: input.limit,
    db,
  });
  const eligibleRecords = preview.records.filter((record) =>
    record.recommendedAction === 'CREATE_PENDING_ADJUSTMENT'
  );
  const alreadyExistingRecords = preview.records.filter((record) =>
    record.recommendedAction === 'ALREADY_HAS_ADJUSTMENT'
  );
  const skippedRecords: RefundAdjustmentBackfillResult['skippedRecords'] = preview.records
    .filter((record) => record.recommendedAction !== 'CREATE_PENDING_ADJUSTMENT')
    .map((record) => ({
      refundFinanceLedgerEntryId: record.refundFinanceLedgerEntryId,
      refundRecordId: record.refundRecordId,
      recommendedAction: record.recommendedAction,
      reason: record.blockerReason
        ?? (record.recommendedAction === 'ALREADY_HAS_ADJUSTMENT'
          ? 'Settlement refund adjustment already exists.'
          : 'Refund ledger is not eligible for backfill.'),
    }));
  const createdRecords: RefundAdjustmentBackfillResult['createdRecords'] = [];
  let failed = 0;

  for (const record of eligibleRecords) {
    if (!record.refundRecordId) {
      failed += 1;
      skippedRecords.push({
        refundFinanceLedgerEntryId: record.refundFinanceLedgerEntryId,
        refundRecordId: record.refundRecordId,
        recommendedAction: record.recommendedAction,
        reason: 'Refund record id is unavailable.',
      });
      continue;
    }

    try {
      const adjustment = await db.$transaction((tx: RefundAdjustmentBackfillTransaction) =>
        createSettlementRefundAdjustmentForRefundLedger(tx, {
          refundFinanceLedgerEntryId: record.refundFinanceLedgerEntryId,
          refundRecordId: record.refundRecordId as string,
          createdBy: input.createdBy ?? 'system:refund_adjustment_backfill',
        })
      );

      if (adjustment) {
        createdRecords.push({
          id: adjustment.id,
          refundFinanceLedgerEntryId: adjustment.refundFinanceLedgerEntryId,
          refundRecordId: adjustment.refundRecordId,
          vendorId: adjustment.vendorId,
          status: adjustment.status,
        });
      } else {
        failed += 1;
        skippedRecords.push({
          refundFinanceLedgerEntryId: record.refundFinanceLedgerEntryId,
          refundRecordId: record.refundRecordId,
          recommendedAction: record.recommendedAction,
          reason: 'Eligibility changed before adjustment could be created.',
        });
      }
    } catch (error) {
      failed += 1;
      skippedRecords.push({
        refundFinanceLedgerEntryId: record.refundFinanceLedgerEntryId,
        refundRecordId: record.refundRecordId,
        recommendedAction: record.recommendedAction,
        reason: error instanceof Error ? error.message : 'Adjustment creation failed.',
      });
    }
  }

  const created = createdRecords.length;

  return {
    ok: true,
    writesPerformed: created > 0,
    summary: {
      eligible: eligibleRecords.length,
      created,
      alreadyExisting: alreadyExistingRecords.length,
      skipped: skippedRecords.length,
      failed,
    },
    createdRecords,
    skippedRecords,
  };
}

export async function previewPendingRefundAdjustmentApplication(input: {
  vendorId: string;
  currencyCode?: string | null;
  currentCandidateNetPayableMinor?: number | null;
  limit?: number;
  db?: RefundAdjustmentApplicationPreviewDbClient;
}): Promise<PendingRefundAdjustmentApplicationPreview> {
  const db = input.db ?? prisma;
  const currencyCode = input.currencyCode?.trim() || null;
  const rows = await db.settlementRefundAdjustment.findMany({
    where: {
      vendorId: input.vendorId,
      status: SettlementRefundAdjustmentStatus.PENDING,
      appliedSettlementApprovalId: null,
      appliedSettlementApprovalLineId: null,
      amountMinor: {
        gt: 0,
      },
      ...(currencyCode ? { currencyCode } : {}),
    },
    orderBy: {
      createdAt: 'asc',
    },
    take: input.limit ?? 100,
    select: {
      id: true,
      originalOrderId: true,
      refundRecordId: true,
      refundFinanceLedgerEntryId: true,
      originalSettlementApprovalId: true,
      originalSettlementCommissionInvoiceId: true,
      amountMinor: true,
      currencyCode: true,
      reason: true,
    },
  });
  const records = rows.map((row) => ({
    adjustmentId: row.id,
    originalOrderId: row.originalOrderId,
    refundRecordId: row.refundRecordId,
    refundFinanceLedgerEntryId: row.refundFinanceLedgerEntryId,
    originalSettlementApprovalId: row.originalSettlementApprovalId,
    originalSettlementCommissionInvoiceId: row.originalSettlementCommissionInvoiceId,
    amountMinor: row.amountMinor,
    currencyCode: row.currencyCode,
    reason: row.reason,
    previewImpactMinor: row.amountMinor,
  }));
  const pendingAdjustmentTotalMinor = records.reduce((total, record) => total + record.previewImpactMinor, 0);
  const currentCandidateNetPayableMinor = Number.isFinite(input.currentCandidateNetPayableMinor)
    ? Number(input.currentCandidateNetPayableMinor)
    : null;

  return {
    ok: true,
    writesPerformed: false,
    vendorId: input.vendorId,
    pendingAdjustmentCount: records.length,
    pendingAdjustmentTotalMinor,
    currentCandidateNetPayableMinor,
    netAfterPendingRefundAdjustmentsMinor:
      currentCandidateNetPayableMinor === null ? null : currentCandidateNetPayableMinor - pendingAdjustmentTotalMinor,
    currencyCode: currencyCode ?? records[0]?.currencyCode ?? null,
    records,
    notes: [
      'Preview only — not applied until Phase 3.5C.',
      'Existing settlement totals are unchanged by this read-only preview.',
    ],
  };
}
