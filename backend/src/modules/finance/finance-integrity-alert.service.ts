import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';

export const FINANCE_INTEGRITY_ALERT_CATEGORIES = [
  'transfer_in_progress',
  'transfer_failed',
  'no_active_sale_ledger',
  'multiple_active_sale_ledgers',
  'active_refund_owner_conflict',
  'voided_sale_ledger_without_successor',
  'superseded_ledger_missing_target',
] as const;

export const FINANCE_INTEGRITY_ALERT_SEVERITIES = ['info', 'warning', 'critical'] as const;

export const FINANCE_INTEGRITY_ALERT_STATUSES = ['open', 'acknowledged', 'resolved'] as const;

export type FinanceIntegrityAlertCategory = typeof FINANCE_INTEGRITY_ALERT_CATEGORIES[number];
export type FinanceIntegrityAlertSeverity = typeof FINANCE_INTEGRITY_ALERT_SEVERITIES[number];
export type FinanceIntegrityAlertStatus = typeof FINANCE_INTEGRITY_ALERT_STATUSES[number];

type FinanceIntegrityAlertDbClient = Pick<Prisma.TransactionClient, 'financeIntegrityAlert'>;

export type CreateOrUpdateFinanceIntegrityAlertInput = {
  dedupeKey: string;
  severity: FinanceIntegrityAlertSeverity;
  category: FinanceIntegrityAlertCategory;
  vendorAllocationId?: string | null;
  allocationEconomicTransferId?: string | null;
  affectedLedgerIds?: Prisma.InputJsonValue | null;
  affectedFinanceEventIds?: Prisma.InputJsonValue | null;
  reason: string;
  status?: FinanceIntegrityAlertStatus;
  resolutionNote?: string | null;
  detectedAt?: Date;
  resolvedAt?: Date | null;
  resolvedByUserId?: string | null;
  metadataJson?: Prisma.InputJsonValue | null;
};

export type ResolveFinanceIntegrityAlertInput = {
  id?: string;
  dedupeKey?: string;
  resolutionNote?: string | null;
  resolvedByUserId?: string | null;
  resolvedAt?: Date;
};

function nullableJson(value: Prisma.InputJsonValue | null | undefined) {
  return value ?? Prisma.JsonNull;
}

function normalizeStatus(status: FinanceIntegrityAlertStatus | undefined): FinanceIntegrityAlertStatus {
  return status ?? 'open';
}

function buildAlertData(input: CreateOrUpdateFinanceIntegrityAlertInput) {
  const status = normalizeStatus(input.status);
  return {
    severity: input.severity,
    category: input.category,
    vendorAllocationId: input.vendorAllocationId ?? null,
    allocationEconomicTransferId: input.allocationEconomicTransferId ?? null,
    affectedLedgerIds: nullableJson(input.affectedLedgerIds),
    affectedFinanceEventIds: nullableJson(input.affectedFinanceEventIds),
    reason: input.reason,
    status,
    resolutionNote: input.resolutionNote ?? null,
    resolvedAt: status === 'resolved' ? input.resolvedAt ?? new Date() : null,
    resolvedByUserId: status === 'resolved' ? input.resolvedByUserId ?? null : null,
    metadataJson: nullableJson(input.metadataJson),
  };
}

export async function createOrUpdateAlert(
  input: CreateOrUpdateFinanceIntegrityAlertInput,
  db: FinanceIntegrityAlertDbClient = prisma,
) {
  const data = buildAlertData(input);
  return db.financeIntegrityAlert.upsert({
    where: {
      dedupeKey: input.dedupeKey,
    },
    create: {
      dedupeKey: input.dedupeKey,
      ...data,
      ...(input.detectedAt ? { detectedAt: input.detectedAt } : {}),
    },
    update: data,
  });
}

export async function resolveAlert(
  input: ResolveFinanceIntegrityAlertInput,
  db: FinanceIntegrityAlertDbClient = prisma,
) {
  if (!input.id && !input.dedupeKey) {
    throw new Error('Finance integrity alert id or dedupeKey is required.');
  }

  return db.financeIntegrityAlert.update({
    where: input.id
      ? { id: input.id }
      : { dedupeKey: input.dedupeKey as string },
    data: {
      status: 'resolved',
      resolvedAt: input.resolvedAt ?? new Date(),
      resolvedByUserId: input.resolvedByUserId ?? null,
      resolutionNote: input.resolutionNote ?? null,
    },
  });
}

export async function findOpenAlerts(db: FinanceIntegrityAlertDbClient = prisma) {
  return db.financeIntegrityAlert.findMany({
    where: {
      status: 'open',
    },
    orderBy: {
      detectedAt: 'desc',
    },
  });
}

export async function findAlertsForAllocation(
  vendorAllocationId: string,
  db: FinanceIntegrityAlertDbClient = prisma,
) {
  return db.financeIntegrityAlert.findMany({
    where: {
      vendorAllocationId,
    },
    orderBy: {
      detectedAt: 'desc',
    },
  });
}

export function financeIntegrityAlertDedupeKey(input: {
  category: FinanceIntegrityAlertCategory;
  vendorAllocationId?: string | null;
  allocationEconomicTransferId?: string | null;
  ledgerId?: string | null;
}) {
  if (input.ledgerId) {
    return `finance-integrity:${input.category}:ledger:${input.ledgerId}`;
  }

  if (input.allocationEconomicTransferId) {
    return `finance-integrity:${input.category}:transfer:${input.allocationEconomicTransferId}`;
  }

  return `finance-integrity:${input.category}:allocation:${input.vendorAllocationId ?? 'unknown'}`;
}
