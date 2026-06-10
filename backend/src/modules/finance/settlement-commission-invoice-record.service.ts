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

export const __settlementCommissionInvoiceRecordTesting = {
  mapRecord,
};
