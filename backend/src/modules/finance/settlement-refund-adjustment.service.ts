import { Prisma, SettlementRefundAdjustmentApplicationStatus, SettlementRefundAdjustmentStatus } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { calculateRefundOffsetAmounts } from './refund-offset.service.js';

const ACTIVE_COMMISSION_INVOICE_STATUSES = ['PENDING', 'CREATED', 'FAILED', 'UNKNOWN'] as const;

type SettlementRefundAdjustmentDbClient = Pick<
  Prisma.TransactionClient,
  'financeLedgerEntry' | 'settlementRefundAdjustment'
>;

type AdjustmentApplicationDto = {
  id: string;
  settlementApprovalId: string;
  settlementApprovalLineId: string;
  amountMinor: number;
  currencyCode: string;
  status: 'active' | 'cancelled';
  createdAt: string;
  updatedAt: string;
};

type LinkedAdjustmentRow = {
  id: string;
  status: SettlementRefundAdjustmentStatus;
  amountMinor: number;
  currencyCode: string;
  reason: string;
  originalSettlementApprovalId: string | null;
  originalSettlementApprovalLineId: string | null;
  originalSettlementCommissionInvoiceId: string | null;
  appliedSettlementApprovalId: string | null;
  appliedSettlementApprovalLineId: string | null;
  blockedReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  originalAmountMinor?: number;
  appliedAmountMinor?: number;
  remainingAmountMinor?: number;
  applications?: Array<{
    id: string;
    settlementApprovalId: string;
    settlementApprovalLineId: string;
    amountMinor: number;
    currencyCode: string;
    status: SettlementRefundAdjustmentApplicationStatus;
    createdAt: Date;
    updatedAt: Date;
  }>;
};

export type SettlementRefundAdjustmentDto = {
  id: string;
  refundRecordId: string;
  refundFinanceLedgerEntryId: string;
  vendorId: string;
  originalOrderId: string;
  originalSettlementApprovalId: string | null;
  originalSettlementApprovalLineId: string | null;
  originalSettlementCommissionInvoiceId: string | null;
  status: 'pending' | 'partially_applied' | 'applied' | 'blocked' | 'cancelled';
  amountMinor: number;
  originalAmountMinor: number;
  appliedAmountMinor: number;
  remainingAmountMinor: number;
  currencyCode: string;
  reason: string;
  createdAt: string;
  updatedAt: string;
  appliedSettlementApprovalId: string | null;
  appliedSettlementApprovalLineId: string | null;
  blockedReason: string | null;
  createdBy: string | null;
  applications: AdjustmentApplicationDto[];
};

function normalize(value: unknown) {
  return String(value ?? '').trim().toUpperCase();
}

function statusToDto(status: SettlementRefundAdjustmentStatus): SettlementRefundAdjustmentDto['status'] {
  return status.toLowerCase() as SettlementRefundAdjustmentDto['status'];
}

function applicationStatusToDto(status: SettlementRefundAdjustmentApplicationStatus): AdjustmentApplicationDto['status'] {
  return status.toLowerCase() as AdjustmentApplicationDto['status'];
}

function mapAdjustment(adjustment: {
  id: string;
  refundRecordId: string;
  refundFinanceLedgerEntryId: string;
  vendorId: string;
  originalOrderId: string;
  originalSettlementApprovalId: string | null;
  originalSettlementApprovalLineId: string | null;
  originalSettlementCommissionInvoiceId: string | null;
  status: SettlementRefundAdjustmentStatus;
  amountMinor: number;
  originalAmountMinor?: number;
  appliedAmountMinor?: number;
  remainingAmountMinor?: number;
  currencyCode: string;
  reason: string;
  createdAt: Date;
  updatedAt: Date;
  appliedSettlementApprovalId: string | null;
  appliedSettlementApprovalLineId: string | null;
  blockedReason: string | null;
  createdBy: string | null;
  applications?: Array<{
    id: string;
    settlementApprovalId: string;
    settlementApprovalLineId: string;
    amountMinor: number;
    currencyCode: string;
    status: SettlementRefundAdjustmentApplicationStatus;
    createdAt: Date;
    updatedAt: Date;
  }>;
}): SettlementRefundAdjustmentDto {
  const originalAmountMinor = adjustment.originalAmountMinor ?? adjustment.amountMinor;
  const appliedAmountMinor = adjustment.appliedAmountMinor ?? (
    adjustment.status === SettlementRefundAdjustmentStatus.APPLIED ? adjustment.amountMinor : 0
  );
  const remainingAmountMinor = adjustment.remainingAmountMinor ?? Math.max(originalAmountMinor - appliedAmountMinor, 0);
  return {
    id: adjustment.id,
    refundRecordId: adjustment.refundRecordId,
    refundFinanceLedgerEntryId: adjustment.refundFinanceLedgerEntryId,
    vendorId: adjustment.vendorId,
    originalOrderId: adjustment.originalOrderId,
    originalSettlementApprovalId: adjustment.originalSettlementApprovalId,
    originalSettlementApprovalLineId: adjustment.originalSettlementApprovalLineId,
    originalSettlementCommissionInvoiceId: adjustment.originalSettlementCommissionInvoiceId,
    status: statusToDto(adjustment.status),
    amountMinor: adjustment.amountMinor,
    originalAmountMinor,
    appliedAmountMinor,
    remainingAmountMinor,
    currencyCode: adjustment.currencyCode,
    reason: adjustment.reason,
    createdAt: adjustment.createdAt.toISOString(),
    updatedAt: adjustment.updatedAt.toISOString(),
    appliedSettlementApprovalId: adjustment.appliedSettlementApprovalId,
    appliedSettlementApprovalLineId: adjustment.appliedSettlementApprovalLineId,
    blockedReason: adjustment.blockedReason,
    createdBy: adjustment.createdBy,
    applications: (adjustment.applications ?? []).map((application) => ({
      id: application.id,
      settlementApprovalId: application.settlementApprovalId,
      settlementApprovalLineId: application.settlementApprovalLineId,
      amountMinor: application.amountMinor,
      currencyCode: application.currencyCode,
      status: applicationStatusToDto(application.status),
      createdAt: application.createdAt.toISOString(),
      updatedAt: application.updatedAt.toISOString(),
    })),
  };
}

function chooseOriginalApprovalLine(
  saleLedgerEntry: {
    settlementApprovalLines: Array<{
      id: string;
      settlementApproval: {
        id: string;
        status: string;
        approvedAt: Date | null;
        commissionInvoices: Array<{
          id: string;
          status: string;
          createdAt: Date;
        }>;
      };
    }>;
  } | null,
) {
  const approvedLines = (saleLedgerEntry?.settlementApprovalLines ?? [])
    .filter((line) => normalize(line.settlementApproval.status) === 'APPROVED')
    .sort((left, right) => {
      const leftTime = left.settlementApproval.approvedAt?.getTime() ?? 0;
      const rightTime = right.settlementApproval.approvedAt?.getTime() ?? 0;
      return rightTime - leftTime;
    });

  if (approvedLines.length > 0) {
    return approvedLines[0];
  }

  return (saleLedgerEntry?.settlementApprovalLines ?? [])
    .filter((line) => line.settlementApproval.commissionInvoices.length > 0)
    .sort((left, right) => {
      const leftTime = left.settlementApproval.commissionInvoices[0]?.createdAt.getTime() ?? 0;
      const rightTime = right.settlementApproval.commissionInvoices[0]?.createdAt.getTime() ?? 0;
      return rightTime - leftTime;
    })[0] ?? null;
}

function chooseOriginalInvoice(
  line: ReturnType<typeof chooseOriginalApprovalLine>,
) {
  return (line?.settlementApproval.commissionInvoices ?? [])
    .slice()
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0] ?? null;
}

export async function createSettlementRefundAdjustmentForRefundLedger(
  db: SettlementRefundAdjustmentDbClient,
  input: {
    refundFinanceLedgerEntryId: string;
    refundRecordId: string;
    createdBy?: string | null;
  },
): Promise<SettlementRefundAdjustmentDto | null> {
  const refundLedgerEntry = await db.financeLedgerEntry.findUnique({
    where: { id: input.refundFinanceLedgerEntryId },
    select: {
      id: true,
      vendorId: true,
      vendorAllocationId: true,
      entryType: true,
      amount: true,
      payoutStatus: true,
      settlementStatus: true,
      commissionPercentSnapshot: true,
      commissionVatPercentSnapshot: true,
      vendorAllocation: {
        select: {
          sourceShopifyOrderId: true,
          sourceShopifyOrderNumber: true,
          order: {
            select: {
              id: true,
              currency: true,
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
                where: {
                  settlementApproval: {
                    status: {
                      in: ['APPROVED'],
                    },
                  },
                },
                select: {
                  id: true,
                  settlementApproval: {
                    select: {
                      id: true,
                      status: true,
                      approvedAt: true,
                      commissionInvoices: {
                        where: {
                          status: {
                            in: [...ACTIVE_COMMISSION_INVOICE_STATUSES],
                          },
                        },
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
  });

  if (!refundLedgerEntry || normalize(refundLedgerEntry.entryType) !== 'REFUND') {
    return null;
  }

  const relatedSaleLedgerEntry = refundLedgerEntry.vendorAllocation?.financeEntries[0] ?? null;
  if (
    !relatedSaleLedgerEntry ||
    normalize(relatedSaleLedgerEntry.payoutStatus) === 'PAID' ||
    normalize(relatedSaleLedgerEntry.settlementStatus) === 'SETTLED'
  ) {
    return null;
  }

  const originalLine = chooseOriginalApprovalLine(relatedSaleLedgerEntry);
  const originalInvoice = chooseOriginalInvoice(originalLine);
  if (!originalLine && !originalInvoice) {
    return null;
  }

  const amount = calculateRefundOffsetAmounts({
    refundAmount: refundLedgerEntry.amount,
    commissionPercentSnapshot:
      refundLedgerEntry.commissionPercentSnapshot ?? relatedSaleLedgerEntry.commissionPercentSnapshot,
    commissionVatPercentSnapshot:
      refundLedgerEntry.commissionVatPercentSnapshot ?? relatedSaleLedgerEntry.commissionVatPercentSnapshot,
  }).vendorPayableReversalMinor;

  if (amount <= 0 || !refundLedgerEntry.vendorAllocation?.order?.id) {
    return null;
  }

  const reason = originalInvoice
    ? 'Refund after invoiced settlement requires future settlement adjustment.'
    : 'Refund after approved settlement requires future settlement adjustment.';
  const currencyCode = refundLedgerEntry.vendorAllocation.order.currency ?? 'TRY';

  const adjustment = await db.settlementRefundAdjustment.upsert({
    where: {
      refundFinanceLedgerEntryId: refundLedgerEntry.id,
    },
    update: {},
    create: {
      refundRecordId: input.refundRecordId,
      refundFinanceLedgerEntryId: refundLedgerEntry.id,
      vendorId: refundLedgerEntry.vendorId,
      originalOrderId: refundLedgerEntry.vendorAllocation.order.id,
      originalSettlementApprovalId: originalLine?.settlementApproval.id ?? null,
      originalSettlementApprovalLineId: originalLine?.id ?? null,
      originalSettlementCommissionInvoiceId: originalInvoice?.id ?? null,
      status: SettlementRefundAdjustmentStatus.PENDING,
      amountMinor: amount,
      originalAmountMinor: amount,
      appliedAmountMinor: 0,
      remainingAmountMinor: amount,
      currencyCode,
      reason,
      createdBy: input.createdBy ?? 'system:shopify_refunds_create',
    },
  });

  return mapAdjustment(adjustment);
}

export async function listSettlementRefundAdjustments(input: {
  status?: SettlementRefundAdjustmentStatus | null;
  vendorId?: string | null;
  limit?: number;
} = {}) {
  const where: Prisma.SettlementRefundAdjustmentWhereInput = {
    ...(input.status ? { status: input.status } : {}),
    ...(input.vendorId ? { vendorId: input.vendorId } : {}),
  };
  const [rows, grouped] = await Promise.all([
    prisma.settlementRefundAdjustment.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: input.limit ?? 100,
      include: {
        applications: {
          orderBy: { createdAt: 'asc' },
        },
      },
    }),
    prisma.settlementRefundAdjustment.groupBy({
      by: ['status'],
      where,
      _count: { _all: true },
    }),
  ]);

  return {
    ok: true,
    writesPerformed: false,
    count: rows.length,
    statuses: grouped.reduce<Record<string, number>>((summary, row) => {
      summary[statusToDto(row.status)] = row._count._all;
      return summary;
    }, {}),
    records: rows.map(mapAdjustment),
  };
}

export function mapLinkedSettlementRefundAdjustments(rows: LinkedAdjustmentRow[] | undefined) {
  return (rows ?? []).map((row) => ({
    id: row.id,
    status: statusToDto(row.status),
    amountMinor: row.amountMinor,
    originalAmountMinor: row.originalAmountMinor ?? row.amountMinor,
    appliedAmountMinor: row.appliedAmountMinor ?? 0,
    remainingAmountMinor: row.remainingAmountMinor ?? row.amountMinor,
    currencyCode: row.currencyCode,
    reason: row.reason,
    originalSettlementApprovalId: row.originalSettlementApprovalId,
    originalSettlementApprovalLineId: row.originalSettlementApprovalLineId,
    originalSettlementCommissionInvoiceId: row.originalSettlementCommissionInvoiceId,
    appliedSettlementApprovalId: row.appliedSettlementApprovalId,
    appliedSettlementApprovalLineId: row.appliedSettlementApprovalLineId,
    blockedReason: row.blockedReason,
    applications: (row.applications ?? []).map((application) => ({
      id: application.id,
      settlementApprovalId: application.settlementApprovalId,
      settlementApprovalLineId: application.settlementApprovalLineId,
      amountMinor: application.amountMinor,
      currencyCode: application.currencyCode,
      status: applicationStatusToDto(application.status),
      createdAt: application.createdAt.toISOString(),
      updatedAt: application.updatedAt.toISOString(),
    })),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));
}
