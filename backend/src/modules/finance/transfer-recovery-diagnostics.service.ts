import type { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { isLedgerVoided } from './active-ledger-policy.service.js';
import {
  FINANCE_INTEGRITY_ALERT_BLOCKING_STATUSES,
  type FinanceIntegrityAlertCategory,
} from './finance-integrity-alert.service.js';
import {
  resolveEconomicOwnerForAllocation,
  type EconomicOwnerResolutionStatus,
} from './economic-owner-resolution.service.js';

export type TransferRecoveryClassification =
  | 'healthy'
  | 'retry_candidate'
  | 'force_complete_candidate'
  | 'manual_investigation_required';

export type TransferRecoveryLedgerState = {
  id: string | null;
  exists: boolean;
  active: boolean;
  voided: boolean;
  supersededByLedgerId?: string | null;
};

export type TransferRecoveryDiagnostics = {
  transferId: string;
  transferStatus: string;
  sourceVendorId: string;
  targetVendorId: string;
  sourceLedger: TransferRecoveryLedgerState;
  targetLedger: TransferRecoveryLedgerState;
  assignment: {
    assignedVendorId: string | null;
    expectedVendorId: string;
    consistent: boolean;
  };
  economicOwner: {
    ownerVendorId: string | null;
    activeSaleLedgerId: string | null;
    resolutionStatus: EconomicOwnerResolutionStatus;
  };
  financeIntegrityAlerts: Array<{
    id: string;
    severity: string;
    category: string;
    reason: string;
    status: string;
    detectedAt: string;
    vendorAllocationId: string | null;
    allocationEconomicTransferId: string | null;
  }>;
  recoveryClassification: TransferRecoveryClassification;
  recommendedAction: string;
};

export class TransferRecoveryDiagnosticsError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'TransferRecoveryDiagnosticsError';
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, TransferRecoveryDiagnosticsError.prototype);
  }
}

type TransferRecoveryDiagnosticsDb = Pick<
  Prisma.TransactionClient,
  'allocationEconomicTransfer' | 'vendorAllocation' | 'financeIntegrityAlert'
>;

type TransferSnapshot = {
  id: string;
  vendorAllocationId: string;
  fromVendorId: string;
  toVendorId: string;
  fromFinanceLedgerEntryId: string | null;
  toFinanceLedgerEntryId: string | null;
  status: string;
  createdAt: Date;
};

type SaleLedgerSnapshot = {
  id: string;
  vendorId: string;
  entryType: string;
  voidedAt: Date | null;
  supersededByLedgerId: string | null;
};

function normalizeStatus(value: unknown) {
  return String(value ?? '').trim().toUpperCase();
}

function buildLedgerState(
  ledger: SaleLedgerSnapshot | null,
  expectedId: string | null,
): TransferRecoveryLedgerState {
  const voided = Boolean(ledger && isLedgerVoided(ledger));
  return {
    id: ledger?.id ?? expectedId,
    exists: Boolean(ledger),
    active: Boolean(ledger && !voided),
    voided,
    ...(ledger ? { supersededByLedgerId: ledger.supersededByLedgerId } : {}),
  };
}

function findLedger(input: {
  ledgers: SaleLedgerSnapshot[];
  ledgerId: string | null;
  vendorId: string;
}) {
  if (input.ledgerId) {
    return input.ledgers.find((ledger) => ledger.id === input.ledgerId) ?? null;
  }

  const vendorSaleLedgers = input.ledgers.filter((ledger) => ledger.vendorId === input.vendorId);
  return vendorSaleLedgers.find((ledger) => !isLedgerVoided(ledger)) ?? vendorSaleLedgers[0] ?? null;
}

function classifyDiagnostics(input: {
  transfer: TransferSnapshot;
  sourceLedger: TransferRecoveryLedgerState;
  targetLedger: TransferRecoveryLedgerState;
  assignedVendorId: string | null;
  activeSaleLedgerIds: string[];
  economicOwnerStatus: EconomicOwnerResolutionStatus;
  blockingAlertCount: number;
}): {
  recoveryClassification: TransferRecoveryClassification;
  recommendedAction: string;
} {
  const transferStatus = normalizeStatus(input.transfer.status);
  const assignmentMatchesTarget = input.assignedVendorId === input.transfer.toVendorId;
  const assignmentMatchesSource = input.assignedVendorId === input.transfer.fromVendorId;
  const exactlyOneActiveTarget = input.activeSaleLedgerIds.length === 1 &&
    input.activeSaleLedgerIds[0] === input.targetLedger.id;

  if (
    transferStatus === 'COMPLETED' &&
    exactlyOneActiveTarget &&
    input.sourceLedger.voided &&
    input.targetLedger.active &&
    assignmentMatchesTarget &&
    input.economicOwnerStatus === 'resolved' &&
    input.blockingAlertCount === 0
  ) {
    return {
      recoveryClassification: 'healthy',
      recommendedAction: 'No recovery action is required.',
    };
  }

  if (input.blockingAlertCount > 0) {
    return {
      recoveryClassification: 'manual_investigation_required',
      recommendedAction: 'Investigate and resolve blocking finance integrity alerts before any recovery action.',
    };
  }

  if (input.activeSaleLedgerIds.length > 1) {
    return {
      recoveryClassification: 'manual_investigation_required',
      recommendedAction: 'Multiple active sale ledgers exist. Do not retry; investigate ledger ownership before recovery.',
    };
  }

  if (input.activeSaleLedgerIds.length === 0) {
    return {
      recoveryClassification: 'manual_investigation_required',
      recommendedAction: 'No active sale ledger exists. Reconstruct ledger state or rollback with audit before recovery.',
    };
  }

  if (
    transferStatus === 'FAILED' &&
    input.sourceLedger.active &&
    !input.targetLedger.exists &&
    assignmentMatchesSource
  ) {
    return {
      recoveryClassification: 'retry_candidate',
      recommendedAction: 'Retry may be safe after confirming no downstream fulfillment, refund, settlement, payout, invoice, or payment evidence exists.',
    };
  }

  if (
    transferStatus !== 'COMPLETED' &&
    input.targetLedger.active &&
    input.sourceLedger.voided &&
    assignmentMatchesTarget
  ) {
    return {
      recoveryClassification: 'force_complete_candidate',
      recommendedAction: 'State appears transferred. Force completion may be safe only after scanner validation confirms no active issue remains.',
    };
  }

  return {
    recoveryClassification: 'manual_investigation_required',
    recommendedAction: 'Transfer state is ambiguous. Review assignment, source ledger, target ledger, economic owner, and alerts before recovery.',
  };
}

async function resolveTransfer(input: {
  vendorAllocationId?: string | null;
  allocationEconomicTransferId?: string | null;
  db: TransferRecoveryDiagnosticsDb;
}) {
  const transferId = input.allocationEconomicTransferId?.trim() || null;
  const vendorAllocationId = input.vendorAllocationId?.trim() || null;

  if (transferId) {
    return input.db.allocationEconomicTransfer.findUnique({
      where: { id: transferId },
      select: {
        id: true,
        vendorAllocationId: true,
        fromVendorId: true,
        toVendorId: true,
        fromFinanceLedgerEntryId: true,
        toFinanceLedgerEntryId: true,
        status: true,
        createdAt: true,
      },
    });
  }

  if (vendorAllocationId) {
    return input.db.allocationEconomicTransfer.findFirst({
      where: { vendorAllocationId },
      orderBy: [
        { completedAt: 'desc' },
        { createdAt: 'desc' },
      ],
      select: {
        id: true,
        vendorAllocationId: true,
        fromVendorId: true,
        toVendorId: true,
        fromFinanceLedgerEntryId: true,
        toFinanceLedgerEntryId: true,
        status: true,
        createdAt: true,
      },
    });
  }

  throw new TransferRecoveryDiagnosticsError('vendorAllocationId or allocationEconomicTransferId is required.');
}

export async function getTransferRecoveryDiagnostics(input: {
  vendorAllocationId?: string | null;
  allocationEconomicTransferId?: string | null;
  db?: TransferRecoveryDiagnosticsDb;
}): Promise<TransferRecoveryDiagnostics> {
  const db = input.db ?? prisma;
  const transfer = await resolveTransfer({
    vendorAllocationId: input.vendorAllocationId,
    allocationEconomicTransferId: input.allocationEconomicTransferId,
    db,
  });

  if (!transfer) {
    throw new TransferRecoveryDiagnosticsError('Economic transfer was not found.', 404);
  }

  const allocation = await db.vendorAllocation.findUnique({
    where: { id: transfer.vendorAllocationId },
    select: {
      id: true,
      assignedVendorId: true,
      financeEntries: {
        where: { entryType: 'sale' },
        select: {
          id: true,
          vendorId: true,
          entryType: true,
          voidedAt: true,
          supersededByLedgerId: true,
        },
      },
    },
  });

  if (!allocation) {
    throw new TransferRecoveryDiagnosticsError('Vendor allocation was not found for economic transfer.', 404);
  }

  const alerts = await db.financeIntegrityAlert.findMany({
    where: {
      status: {
        in: [...FINANCE_INTEGRITY_ALERT_BLOCKING_STATUSES],
      },
      severity: {
        in: ['warning', 'critical'],
      },
      OR: [
        { vendorAllocationId: allocation.id },
        { allocationEconomicTransferId: transfer.id },
      ],
    },
    select: {
      id: true,
      severity: true,
      category: true,
      reason: true,
      status: true,
      detectedAt: true,
      vendorAllocationId: true,
      allocationEconomicTransferId: true,
    },
    orderBy: [
      { detectedAt: 'desc' },
      { createdAt: 'desc' },
    ],
  });

  const economicOwner = await resolveEconomicOwnerForAllocation({
    vendorAllocationId: allocation.id,
    db,
  });

  const sourceLedger = findLedger({
    ledgers: allocation.financeEntries,
    ledgerId: transfer.fromFinanceLedgerEntryId,
    vendorId: transfer.fromVendorId,
  });
  const targetLedger = findLedger({
    ledgers: allocation.financeEntries,
    ledgerId: transfer.toFinanceLedgerEntryId,
    vendorId: transfer.toVendorId,
  });
  const sourceLedgerState = buildLedgerState(sourceLedger, transfer.fromFinanceLedgerEntryId);
  const targetLedgerState = buildLedgerState(targetLedger, transfer.toFinanceLedgerEntryId);
  const activeSaleLedgerIds = allocation.financeEntries
    .filter((ledger) => !isLedgerVoided(ledger))
    .map((ledger) => ledger.id);

  const classification = classifyDiagnostics({
    transfer,
    sourceLedger: sourceLedgerState,
    targetLedger: targetLedgerState,
    assignedVendorId: allocation.assignedVendorId,
    activeSaleLedgerIds,
    economicOwnerStatus: economicOwner.resolutionStatus,
    blockingAlertCount: alerts.length,
  });

  return {
    transferId: transfer.id,
    transferStatus: transfer.status,
    sourceVendorId: transfer.fromVendorId,
    targetVendorId: transfer.toVendorId,
    sourceLedger: sourceLedgerState,
    targetLedger: targetLedgerState,
    assignment: {
      assignedVendorId: allocation.assignedVendorId,
      expectedVendorId: transfer.toVendorId,
      consistent: allocation.assignedVendorId === transfer.toVendorId,
    },
    economicOwner: {
      ownerVendorId: economicOwner.economicOwnerVendorId,
      activeSaleLedgerId: economicOwner.activeSaleLedgerId,
      resolutionStatus: economicOwner.resolutionStatus,
    },
    financeIntegrityAlerts: alerts.map((alert) => ({
      id: alert.id,
      severity: alert.severity,
      category: alert.category as FinanceIntegrityAlertCategory,
      reason: alert.reason,
      status: alert.status,
      detectedAt: alert.detectedAt.toISOString(),
      vendorAllocationId: alert.vendorAllocationId,
      allocationEconomicTransferId: alert.allocationEconomicTransferId,
    })),
    ...classification,
  };
}
