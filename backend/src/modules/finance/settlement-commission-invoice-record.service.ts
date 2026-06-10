import {
  Prisma,
  SettlementCommissionInvoiceProvider,
  SettlementCommissionInvoiceStatus,
  type SettlementCommissionInvoice,
} from '@prisma/client';
import { prisma } from '../../db/prisma.js';

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
  documentSnapshotJson: unknown;
  requestSnapshotJson: unknown;
  responseSnapshotJson: unknown;
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
      request: SnapshotMetadata;
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

function toIso(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

function mapProvider(provider: SettlementCommissionInvoiceProvider) {
  return provider.toLowerCase() as SettlementCommissionInvoiceRecordDto['provider'];
}

function mapStatus(status: SettlementCommissionInvoiceStatus) {
  return status.toLowerCase() as SettlementCommissionInvoiceRecordDto['status'];
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
    documentSnapshotJson: record.documentSnapshotJson,
    requestSnapshotJson: record.requestSnapshotJson,
    responseSnapshotJson: record.responseSnapshotJson,
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
  const existing = await prisma.settlementCommissionInvoice.findFirst({
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

  if (existing) {
    throw new Error(
      `SettlementApproval already has an active ${provider} commission invoice record (${existing.id}, ${existing.status}).`,
    );
  }
}

export async function createPendingRecord(
  input: CreatePendingSettlementCommissionInvoiceRecordInput,
): Promise<SettlementCommissionInvoiceRecordDto> {
  await assertNoActiveInvoiceForSettlement(input.settlementApprovalId, input.provider);
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
        request: getSnapshotMetadata(record.requestSnapshotJson),
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
};
