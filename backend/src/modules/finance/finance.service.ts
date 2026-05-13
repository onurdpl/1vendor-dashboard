import { prisma } from '../../db/prisma.js';
import type { FinanceDashboardDto, FinanceRecordDto } from './finance.types.js';

function toAmountString(value: number) {
  return value.toFixed(2);
}

function toNumber(value: unknown) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function normalizeType(entryType: string) {
  return entryType.trim().toLowerCase();
}

function mapStatus(status: string) {
  return status.trim().toLowerCase();
}

function mapRelatedReferences(record: {
  entryType: string;
  vendorAllocation: {
    sourceShopifyOrderId: string;
    returnRecords: Array<{ id: string }>;
    refundRecords: Array<{ id: string; sourceShopifyRefundId: string }>;
  } | null;
}) {
  const relatedOrderId = record.vendorAllocation?.sourceShopifyOrderId ?? null;
  const relatedReturnId = record.vendorAllocation?.returnRecords[0]?.id ?? null;
  const relatedRefundId =
    record.vendorAllocation?.refundRecords[0]?.sourceShopifyRefundId ??
    record.vendorAllocation?.refundRecords[0]?.id ??
    null;

  return {
    relatedOrderId,
    relatedReturnId,
    relatedRefundId,
  };
}

export async function getVendorFinanceDashboard(
  vendorId: string,
  options: { limit?: number; offset?: number } = {},
): Promise<FinanceDashboardDto> {
  const [summaryEntries, entries] = await Promise.all([
    prisma.financeLedgerEntry.findMany({
      where: {
        vendorId,
      },
      select: {
        entryType: true,
        amount: true,
        payoutStatus: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    }),
    prisma.financeLedgerEntry.findMany({
      where: {
        vendorId,
      },
      include: {
        vendorAllocation: {
          include: {
            returnRecords: {
              orderBy: {
                createdAt: 'asc',
              },
              take: 1,
            },
            refundRecords: {
              orderBy: {
                createdAt: 'asc',
              },
              take: 1,
            },
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: options.limit ?? 100,
      skip: options.offset ?? 0,
    }),
  ]);

  const grossSales = summaryEntries
    .filter((entry) => normalizeType(entry.entryType) === 'sale')
    .reduce((sum, entry) => sum + toNumber(entry.amount), 0);
  const refunds = summaryEntries
    .filter((entry) => normalizeType(entry.entryType) === 'refund')
    .reduce((sum, entry) => sum + toNumber(entry.amount), 0);
  const netRevenue = grossSales - refunds;
  const platformFee = netRevenue * 0.1;
  const payoutEstimate = netRevenue - platformFee;
  const payoutStatus = summaryEntries[0]?.payoutStatus?.toLowerCase() ?? 'pending';

  const records: FinanceRecordDto[] = entries.map((entry) => {
    const references = mapRelatedReferences(entry);
    return {
      id: entry.id,
      type: normalizeType(entry.entryType),
      amount: toAmountString(toNumber(entry.amount)),
      status: mapStatus(entry.payoutStatus),
      description: entry.description,
      relatedOrderId: references.relatedOrderId,
      relatedReturnId: references.relatedReturnId,
      relatedRefundId: references.relatedRefundId,
      createdAt: entry.createdAt.toISOString(),
    };
  });

  return {
    summary: {
      grossSales: toAmountString(grossSales),
      refunds: toAmountString(refunds),
      netRevenue: toAmountString(netRevenue),
      platformFee: toAmountString(platformFee),
      payoutEstimate: toAmountString(payoutEstimate),
      payoutStatus,
    },
    records,
  };
}
