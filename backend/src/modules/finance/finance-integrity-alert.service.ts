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
export const FINANCE_INTEGRITY_ALERT_BLOCKING_STATUSES = ['open', 'acknowledged'] as const;
export const FINANCE_INTEGRITY_ALERT_NON_BLOCKING_STATUSES = ['resolved'] as const;

export type FinanceIntegrityAlertCategory = typeof FINANCE_INTEGRITY_ALERT_CATEGORIES[number];
export type FinanceIntegrityAlertSeverity = typeof FINANCE_INTEGRITY_ALERT_SEVERITIES[number];
export type FinanceIntegrityAlertStatus = typeof FINANCE_INTEGRITY_ALERT_STATUSES[number];
export type BlockingFinanceIntegrityAlertStatus = typeof FINANCE_INTEGRITY_ALERT_BLOCKING_STATUSES[number];

type FinanceIntegrityAlertDbClient = Pick<Prisma.TransactionClient, 'financeIntegrityAlert'>;
type FinanceIntegrityAlertRootDbClient = FinanceIntegrityAlertDbClient & {
  $transaction?: <T>(callback: (tx: FinanceIntegrityAlertDbClient) => Promise<T>) => Promise<T>;
};

const MAX_ACKNOWLEDGMENT_NOTE_LENGTH = 500;

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
  acknowledgedAt?: Date | null;
  acknowledgedByUserId?: string | null;
  acknowledgmentNote?: string | null;
  resolutionValidationJson?: Prisma.InputJsonValue | null;
  resolutionType?: string | null;
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

export type AcknowledgeFinanceIntegrityAlertInput = {
  alertId: string;
  note?: string | null;
  acknowledgedByUserId?: string | null;
  acknowledgedAt?: Date;
};

export type FinanceIntegrityAlertActionResult = {
  id: string;
  dedupeKey: string;
  severity: string;
  category: string;
  reason: string;
  status: string;
  vendorAllocationId: string | null;
  allocationEconomicTransferId: string | null;
  acknowledgedAt: Date | null;
  acknowledgedByUserId: string | null;
  acknowledgmentNote: string | null;
  resolvedAt: Date | null;
  resolvedByUserId: string | null;
  resolutionNote: string | null;
  detectedAt: Date;
  updatedAt: Date;
};

export type BlockingFinanceIntegrityAlert = {
  id: string;
  dedupeKey: string;
  severity: string;
  category: string;
  reason: string;
  vendorAllocationId: string | null;
  allocationEconomicTransferId: string | null;
  status: string;
};

export type FindBlockingFinanceIntegrityAlertsInput = {
  vendorAllocationId?: string | null;
  allocationEconomicTransferId?: string | null;
  categories?: readonly FinanceIntegrityAlertCategory[];
  severities?: readonly FinanceIntegrityAlertSeverity[];
};

export class FinanceIntegrityMoneyMovementBlockedError extends Error {
  alert: BlockingFinanceIntegrityAlert;

  constructor(alert: BlockingFinanceIntegrityAlert) {
    super(`Money movement blocked by blocking finance integrity alert: ${alert.category}.`);
    this.name = 'FinanceIntegrityMoneyMovementBlockedError';
    this.alert = alert;
    Object.setPrototypeOf(this, FinanceIntegrityMoneyMovementBlockedError.prototype);
  }
}

export class FinanceIntegrityAlertLifecycleError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'FinanceIntegrityAlertLifecycleError';
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, FinanceIntegrityAlertLifecycleError.prototype);
  }
}

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
    acknowledgedAt: status === 'acknowledged' ? input.acknowledgedAt ?? new Date() : null,
    acknowledgedByUserId: status === 'acknowledged' ? input.acknowledgedByUserId ?? null : null,
    acknowledgmentNote: status === 'acknowledged' ? input.acknowledgmentNote ?? null : null,
    resolutionNote: input.resolutionNote ?? null,
    resolutionValidationJson: nullableJson(input.resolutionValidationJson),
    resolutionType: input.resolutionType ?? null,
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

function readAcknowledgmentNote(note: string | null | undefined) {
  const trimmed = note?.trim() ?? '';
  if (!trimmed) {
    throw new FinanceIntegrityAlertLifecycleError('Acknowledgment note is required.', 400);
  }
  if (trimmed.length > MAX_ACKNOWLEDGMENT_NOTE_LENGTH) {
    throw new FinanceIntegrityAlertLifecycleError('Acknowledgment note must be 500 characters or fewer.', 400);
  }
  return trimmed;
}

export async function acknowledgeFinanceIntegrityAlert(
  input: AcknowledgeFinanceIntegrityAlertInput,
  db: FinanceIntegrityAlertRootDbClient = prisma,
): Promise<FinanceIntegrityAlertActionResult> {
  const note = readAcknowledgmentNote(input.note);

  const run = async (tx: FinanceIntegrityAlertDbClient) => {
    const alert = await tx.financeIntegrityAlert.findUnique({
      where: {
        id: input.alertId,
      },
    });

    if (!alert) {
      throw new FinanceIntegrityAlertLifecycleError('Finance integrity alert was not found.', 404);
    }

    if (alert.status === 'acknowledged') {
      return alert;
    }

    if (alert.status === 'resolved') {
      throw new FinanceIntegrityAlertLifecycleError('Resolved finance integrity alerts cannot be acknowledged.', 409);
    }

    if (alert.status !== 'open') {
      throw new FinanceIntegrityAlertLifecycleError(`Finance integrity alert status ${alert.status} cannot be acknowledged.`, 409);
    }

    return tx.financeIntegrityAlert.update({
      where: {
        id: input.alertId,
      },
      data: {
        status: 'acknowledged',
        acknowledgedAt: input.acknowledgedAt ?? new Date(),
        acknowledgedByUserId: input.acknowledgedByUserId ?? null,
        acknowledgmentNote: note,
        resolvedAt: null,
        resolvedByUserId: null,
        resolutionNote: null,
        resolutionValidationJson: Prisma.JsonNull,
        resolutionType: null,
      },
    });
  };

  if (typeof db.$transaction === 'function') {
    return db.$transaction(run);
  }

  return run(db);
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

export async function findBlockingFinanceIntegrityAlerts(
  input: FindBlockingFinanceIntegrityAlertsInput,
  db: FinanceIntegrityAlertDbClient = prisma,
): Promise<BlockingFinanceIntegrityAlert[]> {
  if (!input.vendorAllocationId && !input.allocationEconomicTransferId) {
    throw new Error('vendorAllocationId or allocationEconomicTransferId is required.');
  }

  const relationFilters = [
    input.vendorAllocationId ? { vendorAllocationId: input.vendorAllocationId } : null,
    input.allocationEconomicTransferId ? { allocationEconomicTransferId: input.allocationEconomicTransferId } : null,
  ].filter((filter): filter is NonNullable<typeof filter> => Boolean(filter));

  return db.financeIntegrityAlert.findMany({
    where: {
      status: {
        in: [...FINANCE_INTEGRITY_ALERT_BLOCKING_STATUSES],
      },
      severity: {
        in: [...(input.severities ?? ['warning', 'critical'])],
      },
      ...(input.categories?.length
        ? {
            category: {
              in: [...input.categories],
            },
          }
        : {}),
      OR: relationFilters,
    },
    select: {
      id: true,
      dedupeKey: true,
      severity: true,
      category: true,
      reason: true,
      vendorAllocationId: true,
      allocationEconomicTransferId: true,
      status: true,
    },
    orderBy: [
      {
        detectedAt: 'asc',
      },
      {
        createdAt: 'asc',
      },
    ],
  });
}

export async function assertNoOpenFinanceIntegrityAlertForMoneyMovement(
  input: FindBlockingFinanceIntegrityAlertsInput,
  db: FinanceIntegrityAlertDbClient = prisma,
) {
  const alerts = await findBlockingFinanceIntegrityAlerts(input, db);
  if (alerts.length > 0) {
    throw new FinanceIntegrityMoneyMovementBlockedError(alerts[0]);
  }
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
