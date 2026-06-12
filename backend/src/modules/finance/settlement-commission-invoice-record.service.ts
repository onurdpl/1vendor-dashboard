import {
  Prisma,
  SettlementCommissionInvoiceProvider,
  SettlementCommissionInvoiceStatus,
  type SettlementCommissionInvoice,
} from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { buildSettlementLogoCommissionInvoiceRequestSnapshot } from './settlement-logo-request-snapshot-builder.service.js';

export type SettlementCommissionInvoiceRecordDto = {
  id: string;
  createdAt: string;
  updatedAt: string;
  settlementApprovalId: string;
  vendorId: string;
  provider: 'logo_isbasi';
  status: 'pending' | 'created' | 'failed' | 'cancelled' | 'unknown';
  providerInvoiceId: string | null;
  providerUuid: string | null;
  providerEttn: string | null;
  invoiceNo: string | null;
  documentStatus: string | null;
  documentContentType: string | null;
  documentSize: number | null;
  documentFetchedAt: string | null;
  requestSnapshot: RequestSnapshotMetadata;
  responseSnapshot: SnapshotMetadata;
  documentSnapshot: SnapshotMetadata;
  failureCode: string | null;
  failureMessage: string | null;
  failedAt: string | null;
  retryCount: number;
  lastRetriedAt: string | null;
  createdBy: string | null;
  cancelledBy: string | null;
  cancelledAt: string | null;
};

export type CreatePendingSettlementCommissionInvoiceRecordInput = {
  settlementApprovalId: string;
  vendorId: string;
  provider: SettlementCommissionInvoiceProvider;
  requestSnapshotJson?: Prisma.InputJsonValue | null;
  createdBy?: string | null;
};

export type MarkSettlementCommissionInvoiceCreatedInput = {
  settlementCommissionInvoiceId: string;
  providerInvoiceId?: string | null;
  providerUuid?: string | null;
  providerEttn?: string | null;
  invoiceNo?: string | null;
  responseSnapshotJson?: Prisma.InputJsonValue | null;
};

export type MarkSettlementCommissionInvoiceFailedInput = {
  settlementCommissionInvoiceId: string;
  failureCode?: string | null;
  failureMessage?: string | null;
  responseSnapshotJson?: Prisma.InputJsonValue | null;
};

export type IncrementSettlementCommissionInvoiceRetryInput = {
  settlementCommissionInvoiceId: string;
};

export type CreatePendingRecordFromImmutableRequestSnapshotInput = {
  createdBy?: string | null;
  invoiceDate?: string | Date | null;
};

export type CreatePendingRecordFromImmutableRequestSnapshotResult = {
  ok: boolean;
  writesPerformed: boolean;
  settlementApprovalId: string;
  provider: SettlementCommissionInvoiceRecordDto['provider'];
  status: 'pending' | 'blocked';
  blockers: string[];
  warnings: string[];
  record: SettlementCommissionInvoiceRecordDto | null;
  requestSnapshot: RequestSnapshotMetadata | null;
};

export type SettlementCommissionInvoiceDiagnosticsDto = {
  ok: true;
  writesPerformed: false;
  record: {
    id: string;
    settlementApprovalId: string;
    vendorId: string;
    provider: SettlementCommissionInvoiceRecordDto['provider'];
    status: SettlementCommissionInvoiceRecordDto['status'];
    retryCount: number;
    providerIdentifiers: {
      providerInvoiceId: string | null;
      providerUuid: string | null;
      providerEttn: string | null;
      invoiceNo: string | null;
    };
    timestamps: {
      createdAt: string;
      updatedAt: string;
      failedAt: string | null;
      lastRetriedAt: string | null;
      cancelledAt: string | null;
      documentFetchedAt: string | null;
    };
    snapshots: {
      request: RequestSnapshotMetadata;
      response: SnapshotMetadata;
      document: SnapshotMetadata;
    };
    failure: {
      failureCode: string | null;
      failureMessage: string | null;
    };
  };
};

type SnapshotMetadata = {
  present: boolean;
  type: 'null' | 'array' | 'object' | 'string' | 'number' | 'boolean' | 'unknown';
  topLevelKeys: string[];
  approximateSizeBytes: number;
};

type RequestSnapshotMetadata = SnapshotMetadata & {
  requestSnapshotPresent: boolean;
  payloadBuilderVersion: string | null;
  requestBuiltAt: string | null;
  snapshotSource: 'immutable_settlement_truth' | null;
};

function toIso(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

function mapProvider(provider: SettlementCommissionInvoiceProvider) {
  return provider.toLowerCase() as SettlementCommissionInvoiceRecordDto['provider'];
}

function mapStatus(status: SettlementCommissionInvoiceStatus) {
  return status.toLowerCase() as SettlementCommissionInvoiceRecordDto['status'];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function mapRecord(record: SettlementCommissionInvoice): SettlementCommissionInvoiceRecordDto {
  return {
    id: record.id,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    settlementApprovalId: record.settlementApprovalId,
    vendorId: record.vendorId,
    provider: mapProvider(record.provider),
    status: mapStatus(record.status),
    providerInvoiceId: record.providerInvoiceId,
    providerUuid: record.providerUuid,
    providerEttn: record.providerEttn,
    invoiceNo: record.invoiceNo,
    documentStatus: record.documentStatus,
    documentContentType: record.documentContentType,
    documentSize: record.documentSize,
    documentFetchedAt: toIso(record.documentFetchedAt),
    requestSnapshot: getRequestSnapshotMetadata(record.requestSnapshotJson),
    responseSnapshot: getSnapshotMetadata(record.responseSnapshotJson),
    documentSnapshot: getSnapshotMetadata(record.documentSnapshotJson),
    failureCode: record.failureCode,
    failureMessage: record.failureMessage,
    failedAt: toIso(record.failedAt),
    retryCount: record.retryCount,
    lastRetriedAt: toIso(record.lastRetriedAt),
    createdBy: record.createdBy,
    cancelledBy: record.cancelledBy,
    cancelledAt: toIso(record.cancelledAt),
  };
}

function hasImmutableSettlementTruthShape(value: unknown) {
  if (!isRecord(value)) {
    return false;
  }
  return (
    value.provider === SettlementCommissionInvoiceProvider.LOGO_ISBASI &&
    isRecord(value.settlementApprovalSnapshot) &&
    isRecord(value.settlementBillingSnapshot) &&
    isRecord(value.settlementLineSnapshotSummary) &&
    isRecord(value.executionSnapshotGuard) &&
    isRecord(value.logoPayload)
  );
}

function getSnapshotMetadata(value: unknown): SnapshotMetadata {
  if (value === null || value === undefined) {
    return {
      present: false,
      type: 'null',
      topLevelKeys: [],
      approximateSizeBytes: 0,
    };
  }

  const type = Array.isArray(value)
    ? 'array'
    : typeof value === 'object'
      ? 'object'
      : ['string', 'number', 'boolean'].includes(typeof value)
        ? (typeof value as 'string' | 'number' | 'boolean')
        : 'unknown';
  const serialized = JSON.stringify(value);
  return {
    present: true,
    type,
    topLevelKeys:
      Boolean(value) && typeof value === 'object' && !Array.isArray(value)
        ? Object.keys(value as Record<string, unknown>).sort()
        : [],
    approximateSizeBytes: Buffer.byteLength(serialized ?? String(value), 'utf8'),
  };
}

function getRequestSnapshotMetadata(value: unknown): RequestSnapshotMetadata {
  const metadata = getSnapshotMetadata(value);
  const record = isRecord(value) ? value : {};
  return {
    ...metadata,
    requestSnapshotPresent: metadata.present,
    payloadBuilderVersion: readString(record.payloadBuilderVersion),
    requestBuiltAt: readString(record.requestBuiltAt),
    snapshotSource: hasImmutableSettlementTruthShape(value) ? 'immutable_settlement_truth' : null,
  };
}

function assertRecordStatus(
  record: Pick<SettlementCommissionInvoice, 'id' | 'status'>,
  allowed: SettlementCommissionInvoiceStatus[],
  transitionName: string,
) {
  if (!allowed.includes(record.status)) {
    throw new Error(
      `${transitionName} is not allowed for SettlementCommissionInvoice ${record.id} while status is ${record.status}.`,
    );
  }
}

async function getRequiredRecord(id: string) {
  const record = await prisma.settlementCommissionInvoice.findUnique({
    where: {
      id,
    },
  });
  if (!record) {
    throw new Error('SettlementCommissionInvoice record could not be found.');
  }
  return record;
}

async function findActiveInvoiceForSettlement(
  settlementApprovalId: string,
  provider: SettlementCommissionInvoiceProvider,
) {
  return prisma.settlementCommissionInvoice.findFirst({
    where: {
      settlementApprovalId,
      provider,
      status: {
        not: SettlementCommissionInvoiceStatus.CANCELLED,
      },
    },
    select: {
      id: true,
      status: true,
    },
  });
}

export async function findBySettlementApproval(
  settlementApprovalId: string,
): Promise<SettlementCommissionInvoiceRecordDto[]> {
  const records = await prisma.settlementCommissionInvoice.findMany({
    where: {
      settlementApprovalId,
    },
    orderBy: {
      createdAt: 'desc',
    },
  });

  return records.map(mapRecord);
}

export async function assertNoActiveInvoiceForSettlement(
  settlementApprovalId: string,
  provider: SettlementCommissionInvoiceProvider,
): Promise<void> {
  const existing = await findActiveInvoiceForSettlement(settlementApprovalId, provider);

  if (existing) {
    throw new Error(
      `SettlementApproval already has an active ${provider} commission invoice record (${existing.id}, ${existing.status}).`,
    );
  }
}

async function insertPendingRecord(
  input: CreatePendingSettlementCommissionInvoiceRecordInput,
): Promise<SettlementCommissionInvoiceRecordDto> {
  const record = await prisma.settlementCommissionInvoice.create({
    data: {
      settlementApprovalId: input.settlementApprovalId,
      vendorId: input.vendorId,
      provider: input.provider,
      status: SettlementCommissionInvoiceStatus.PENDING,
      requestSnapshotJson: input.requestSnapshotJson ?? undefined,
      createdBy: input.createdBy ?? null,
    },
  });

  return mapRecord(record);
}

export async function createPendingRecord(
  input: CreatePendingSettlementCommissionInvoiceRecordInput,
): Promise<SettlementCommissionInvoiceRecordDto> {
  await assertNoActiveInvoiceForSettlement(input.settlementApprovalId, input.provider);
  return insertPendingRecord(input);
}

function buildBlockedPendingSnapshotResult(input: {
  settlementApprovalId: string;
  provider: SettlementCommissionInvoiceProvider;
  blockers: string[];
  warnings?: string[];
}): CreatePendingRecordFromImmutableRequestSnapshotResult {
  return {
    ok: false,
    writesPerformed: false,
    settlementApprovalId: input.settlementApprovalId,
    provider: mapProvider(input.provider),
    status: 'blocked',
    blockers: Array.from(new Set(input.blockers)),
    warnings: Array.from(new Set(input.warnings ?? [])),
    record: null,
    requestSnapshot: null,
  };
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

export async function createPendingRecordFromImmutableRequestSnapshot(
  settlementApprovalId: string,
  provider: SettlementCommissionInvoiceProvider,
  input: CreatePendingRecordFromImmutableRequestSnapshotInput = {},
): Promise<CreatePendingRecordFromImmutableRequestSnapshotResult> {
  if (provider !== SettlementCommissionInvoiceProvider.LOGO_ISBASI) {
    return buildBlockedPendingSnapshotResult({
      settlementApprovalId,
      provider,
      blockers: [`Provider ${provider} is not supported for immutable settlement request snapshots.`],
    });
  }

  const built = await buildSettlementLogoCommissionInvoiceRequestSnapshot(
    settlementApprovalId,
    input.invoiceDate ?? new Date(),
  );

  if (!built.ok || !built.requestSnapshotJson) {
    return buildBlockedPendingSnapshotResult({
      settlementApprovalId,
      provider,
      blockers: built.blockers.length ? built.blockers : ['Immutable Logo request snapshot could not be built.'],
      warnings: built.warnings,
    });
  }

  const requestSnapshotRecord = isRecord(built.requestSnapshotJson) ? built.requestSnapshotJson : {};
  const vendorId = readString(requestSnapshotRecord.vendorId);
  if (!vendorId) {
    return buildBlockedPendingSnapshotResult({
      settlementApprovalId,
      provider,
      blockers: ['Immutable Logo request snapshot is missing vendorId.'],
      warnings: built.warnings,
    });
  }

  const existing = await findActiveInvoiceForSettlement(settlementApprovalId, provider);
  if (existing) {
    return buildBlockedPendingSnapshotResult({
      settlementApprovalId,
      provider,
      blockers: [
        `SettlementApproval already has an active ${provider} commission invoice record (${existing.id}, ${existing.status}).`,
      ],
      warnings: built.warnings,
    });
  }

  try {
    const record = await insertPendingRecord({
      settlementApprovalId,
      vendorId,
      provider,
      requestSnapshotJson: built.requestSnapshotJson,
      createdBy: input.createdBy ?? null,
    });

    return {
      ok: true,
      writesPerformed: true,
      settlementApprovalId,
      provider: mapProvider(provider),
      status: 'pending',
      blockers: [],
      warnings: built.warnings,
      record,
      requestSnapshot: record.requestSnapshot,
    };
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return buildBlockedPendingSnapshotResult({
        settlementApprovalId,
        provider,
        blockers: [`SettlementApproval already has an active ${provider} commission invoice record.`],
        warnings: built.warnings,
      });
    }
    throw error;
  }
}

export async function markCreated(
  input: MarkSettlementCommissionInvoiceCreatedInput,
): Promise<SettlementCommissionInvoiceRecordDto> {
  const existing = await getRequiredRecord(input.settlementCommissionInvoiceId);
  assertRecordStatus(existing, [SettlementCommissionInvoiceStatus.PENDING], 'markCreated');
  const record = await prisma.settlementCommissionInvoice.update({
    where: {
      id: input.settlementCommissionInvoiceId,
    },
    data: {
      status: SettlementCommissionInvoiceStatus.CREATED,
      providerInvoiceId: input.providerInvoiceId ?? null,
      providerUuid: input.providerUuid ?? null,
      providerEttn: input.providerEttn ?? null,
      invoiceNo: input.invoiceNo ?? null,
      responseSnapshotJson: input.responseSnapshotJson ?? undefined,
    },
  });

  return mapRecord(record);
}

export async function markFailed(
  input: MarkSettlementCommissionInvoiceFailedInput,
): Promise<SettlementCommissionInvoiceRecordDto> {
  const existing = await getRequiredRecord(input.settlementCommissionInvoiceId);
  assertRecordStatus(
    existing,
    [SettlementCommissionInvoiceStatus.PENDING, SettlementCommissionInvoiceStatus.FAILED],
    'markFailed',
  );
  const record = await prisma.settlementCommissionInvoice.update({
    where: {
      id: input.settlementCommissionInvoiceId,
    },
    data: {
      status: SettlementCommissionInvoiceStatus.FAILED,
      failureCode: input.failureCode ?? null,
      failureMessage: input.failureMessage ?? null,
      failedAt: new Date(),
      responseSnapshotJson: input.responseSnapshotJson ?? undefined,
    },
  });

  return mapRecord(record);
}

export async function incrementRetry(
  input: IncrementSettlementCommissionInvoiceRetryInput,
): Promise<SettlementCommissionInvoiceRecordDto> {
  const existing = await getRequiredRecord(input.settlementCommissionInvoiceId);
  assertRecordStatus(existing, [SettlementCommissionInvoiceStatus.FAILED], 'incrementRetry');
  const record = await prisma.settlementCommissionInvoice.update({
    where: {
      id: input.settlementCommissionInvoiceId,
    },
    data: {
      retryCount: {
        increment: 1,
      },
      lastRetriedAt: new Date(),
    },
  });

  return mapRecord(record);
}

export async function getSettlementCommissionInvoiceDiagnostics(
  settlementCommissionInvoiceId: string,
): Promise<SettlementCommissionInvoiceDiagnosticsDto | null> {
  const record = await prisma.settlementCommissionInvoice.findUnique({
    where: {
      id: settlementCommissionInvoiceId,
    },
  });
  if (!record) {
    return null;
  }

  return {
    ok: true,
    writesPerformed: false,
    record: {
      id: record.id,
      settlementApprovalId: record.settlementApprovalId,
      vendorId: record.vendorId,
      provider: mapProvider(record.provider),
      status: mapStatus(record.status),
      retryCount: record.retryCount,
      providerIdentifiers: {
        providerInvoiceId: record.providerInvoiceId,
        providerUuid: record.providerUuid,
        providerEttn: record.providerEttn,
        invoiceNo: record.invoiceNo,
      },
      timestamps: {
        createdAt: record.createdAt.toISOString(),
        updatedAt: record.updatedAt.toISOString(),
        failedAt: toIso(record.failedAt),
        lastRetriedAt: toIso(record.lastRetriedAt),
        cancelledAt: toIso(record.cancelledAt),
        documentFetchedAt: toIso(record.documentFetchedAt),
      },
      snapshots: {
        request: getRequestSnapshotMetadata(record.requestSnapshotJson),
        response: getSnapshotMetadata(record.responseSnapshotJson),
        document: getSnapshotMetadata(record.documentSnapshotJson),
      },
      failure: {
        failureCode: record.failureCode,
        failureMessage: record.failureMessage,
      },
    },
  };
}

export const __settlementCommissionInvoiceRecordTesting = {
  mapRecord,
  getSnapshotMetadata,
  getRequestSnapshotMetadata,
};
