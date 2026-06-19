import {
  Prisma,
  SettlementCommissionInvoiceProvider,
  SettlementCommissionInvoiceStatus,
  type SettlementCommissionInvoice,
} from '@prisma/client';
import type { AppEnv } from '../../config/env.js';
import { prisma } from '../../db/prisma.js';
import {
  validateLogoExecutionEnvironment,
  type LogoExecutionEnvironmentGuardResult,
} from '../logo-isbasi/logo-execution-environment-guard.service.js';
import {
  validateLogoExecutionContractRecord,
  type SettlementLogoExecutionContractDto,
} from './settlement-logo-execution-contract.service.js';
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
  invoiceDate: string | null;
  invoiceTotalMinor: number | null;
  invoiceCurrency: string | null;
  gibStatus: string | null;
  gibStatusCode: string | null;
  documentStatus: string | null;
  documentStatusCode: string | null;
  documentType: string | null;
  lastProviderSyncedAt: string | null;
  documentContentType: string | null;
  documentSize: number | null;
  documentFetchedAt: string | null;
  requestSnapshot: RequestSnapshotMetadata;
  responseSnapshot: SnapshotMetadata;
  documentSnapshot: SnapshotMetadata;
  failureCode: string | null;
  failureMessage: string | null;
  failedAt: string | null;
  unknownReason: string | null;
  unknownAt: string | null;
  reconciliationStatus: string | null;
  reconciliationEvidenceSnapshot: SnapshotMetadata;
  reconciliationEvidence: SettlementCommissionInvoiceReconciliationEvidenceDto | null;
  reconciledAt: string | null;
  reconciledBy: string | null;
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

export type MarkSettlementCommissionInvoiceUnknownInput = {
  settlementCommissionInvoiceId: string;
  unknownReason: string;
  responseSnapshotJson?: Prisma.InputJsonValue | null;
};

export type ApplySettlementCommissionInvoiceReconciliationInput = {
  settlementCommissionInvoiceId: string;
  reconciliationStatus: string;
  reconciliationEvidenceJson: Prisma.InputJsonValue;
  providerInvoiceId?: string | null;
  providerUuid?: string | null;
  providerEttn?: string | null;
  invoiceNo?: string | null;
  documentStatus?: string | null;
  invoiceDate?: string | Date | null;
  invoiceTotalMinor?: number | null;
  invoiceCurrency?: string | null;
  gibStatus?: string | null;
  gibStatusCode?: string | null;
  documentStatusCode?: string | null;
  documentType?: string | null;
  lastProviderSyncedAt?: Date | null;
  reconciledBy?: string | null;
};

export type ResolveSettlementCommissionInvoiceUnknownAsCreatedInput = MarkSettlementCommissionInvoiceCreatedInput & {
  reconciliationEvidenceJson: Prisma.InputJsonValue;
  reconciledBy?: string | null;
};

export type ResolveSettlementCommissionInvoiceUnknownAsFailedInput = MarkSettlementCommissionInvoiceFailedInput & {
  reconciliationEvidenceJson: Prisma.InputJsonValue;
  reconciledBy?: string | null;
};

export type IncrementSettlementCommissionInvoiceRetryInput = {
  settlementCommissionInvoiceId: string;
};

export type SettlementCommissionInvoiceRetryDecisionDto = {
  ok: true;
  writesPerformed: false;
  settlementCommissionInvoiceId: string;
  status: SettlementCommissionInvoiceRecordDto['status'];
  canRetry: boolean;
  blockers: string[];
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
    environmentGuard: LogoExecutionEnvironmentGuardResult | null;
    executionContract: SettlementLogoExecutionContractDto;
    providerIdentifiers: {
      providerInvoiceId: string | null;
      providerUuid: string | null;
      providerEttn: string | null;
      invoiceNo: string | null;
    };
    invoiceMetadata: {
      invoiceDate: string | null;
      invoiceTotalMinor: number | null;
      invoiceCurrency: string | null;
      gibStatus: string | null;
      gibStatusCode: string | null;
      documentStatus: string | null;
      documentStatusCode: string | null;
      documentType: string | null;
      lastProviderSyncedAt: string | null;
    };
    timestamps: {
      createdAt: string;
      updatedAt: string;
      failedAt: string | null;
      unknownAt: string | null;
      lastRetriedAt: string | null;
      cancelledAt: string | null;
      reconciledAt: string | null;
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
    unknown: {
      reason: string | null;
      unknownAt: string | null;
      reconciliationState: string | null;
      reconciledAt: string | null;
      reconciledBy: string | null;
      reconciliationEvidence: SnapshotMetadata;
      reconciliationEvidenceSafe: SettlementCommissionInvoiceReconciliationEvidenceDto | null;
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

type SettlementCommissionInvoiceReconciliationEvidenceDto = {
  reconciliationStatus: string | null;
  matched: boolean | null;
  invoiceNo: string | null;
  invoiceDate: string | null;
  invoiceTotalMinor: number | null;
  invoiceCurrency: string | null;
  gibStatus: string | null;
  gibStatusCode: number | null;
  documentStatus: string | null;
  documentStatusCode: number | null;
  documentType: string | null;
  warnings: string[];
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

function readNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function readBoolean(value: unknown) {
  return typeof value === 'boolean' ? value : null;
}

function readStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map((item) => item.trim());
}

function getNestedRecord(value: unknown, keys: string[]) {
  let current: unknown = value;
  for (const key of keys) {
    if (!isRecord(current)) {
      return null;
    }
    current = current[key];
  }
  return isRecord(current) ? current : null;
}

function getReconciliationEvidenceDto(value: unknown): SettlementCommissionInvoiceReconciliationEvidenceDto | null {
  if (!isRecord(value)) {
    return null;
  }
  const mappedFields = getNestedRecord(value, ['mappedFields']) ?? {};
  return {
    reconciliationStatus: readString(value.reconciliationStatus),
    matched: readBoolean(value.matched),
    invoiceNo: readString(mappedFields.invoiceNoCandidate),
    invoiceDate: readString(mappedFields.invoiceDate),
    invoiceTotalMinor: readNumber(mappedFields.invoiceTotalMinor),
    invoiceCurrency: readString(mappedFields.invoiceCurrency),
    gibStatus: readString(mappedFields.gibStatus),
    gibStatusCode: readNumber(mappedFields.gibStatusCode),
    documentStatus: readString(mappedFields.documentStatus),
    documentStatusCode: readNumber(mappedFields.documentStatusCode),
    documentType: readString(mappedFields.documentType),
    warnings: readStringArray(value.warnings),
  };
}

function getPersistedReconciliationEvidenceDto(
  record: SettlementCommissionInvoice,
): SettlementCommissionInvoiceReconciliationEvidenceDto | null {
  const evidence = getReconciliationEvidenceDto(record.reconciliationEvidenceJson);
  if (
    !evidence &&
    !record.invoiceNo &&
    !record.invoiceDate &&
    record.invoiceTotalMinor == null &&
    !record.invoiceCurrency &&
    !record.gibStatus &&
    !record.gibStatusCode &&
    !record.documentStatus &&
    !record.documentStatusCode &&
    !record.documentType
  ) {
    return null;
  }

  return {
    reconciliationStatus: record.reconciliationStatus ?? evidence?.reconciliationStatus ?? null,
    matched: evidence?.matched ?? null,
    invoiceNo: record.invoiceNo ?? evidence?.invoiceNo ?? null,
    invoiceDate: toIso(record.invoiceDate) ?? evidence?.invoiceDate ?? null,
    invoiceTotalMinor: record.invoiceTotalMinor ?? evidence?.invoiceTotalMinor ?? null,
    invoiceCurrency: record.invoiceCurrency ?? evidence?.invoiceCurrency ?? null,
    gibStatus: record.gibStatus ?? evidence?.gibStatus ?? null,
    gibStatusCode: readNumber(record.gibStatusCode) ?? evidence?.gibStatusCode ?? null,
    documentStatus: record.documentStatus ?? evidence?.documentStatus ?? null,
    documentStatusCode: readNumber(record.documentStatusCode) ?? evidence?.documentStatusCode ?? null,
    documentType: record.documentType ?? evidence?.documentType ?? null,
    warnings: evidence?.warnings ?? [],
  };
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
    invoiceDate: toIso(record.invoiceDate),
    invoiceTotalMinor: record.invoiceTotalMinor ?? null,
    invoiceCurrency: record.invoiceCurrency ?? null,
    gibStatus: record.gibStatus ?? null,
    gibStatusCode: record.gibStatusCode ?? null,
    documentStatus: record.documentStatus,
    documentStatusCode: record.documentStatusCode ?? null,
    documentType: record.documentType ?? null,
    lastProviderSyncedAt: toIso(record.lastProviderSyncedAt),
    documentContentType: record.documentContentType,
    documentSize: record.documentSize,
    documentFetchedAt: toIso(record.documentFetchedAt),
    requestSnapshot: getRequestSnapshotMetadata(record.requestSnapshotJson),
    responseSnapshot: getSnapshotMetadata(record.responseSnapshotJson),
    documentSnapshot: getSnapshotMetadata(record.documentSnapshotJson),
    failureCode: record.failureCode,
    failureMessage: record.failureMessage,
    failedAt: toIso(record.failedAt),
    unknownReason: record.unknownReason,
    unknownAt: toIso(record.unknownAt),
    reconciliationStatus: record.reconciliationStatus,
    reconciliationEvidenceSnapshot: getSnapshotMetadata(record.reconciliationEvidenceJson),
    reconciliationEvidence: getPersistedReconciliationEvidenceDto(record),
    reconciledAt: toIso(record.reconciledAt),
    reconciledBy: record.reconciledBy,
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

function readRequiredText(value: string | null | undefined, fieldName: string) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${fieldName} is required.`);
  }
  return value.trim();
}

function parseOptionalDate(value: string | Date | null | undefined, fieldName: string) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${fieldName} must be a valid date.`);
  }
  return parsed;
}

function assertReconciliationEvidence(value: Prisma.InputJsonValue) {
  if (!isRecord(value) || Object.keys(value).length === 0) {
    throw new Error('Explicit reconciliation evidence is required before resolving UNKNOWN execution.');
  }
}

function buildRetryDecision(record: SettlementCommissionInvoice): SettlementCommissionInvoiceRetryDecisionDto {
  if (record.status === SettlementCommissionInvoiceStatus.FAILED) {
    return {
      ok: true,
      writesPerformed: false,
      settlementCommissionInvoiceId: record.id,
      status: mapStatus(record.status),
      canRetry: true,
      blockers: [],
    };
  }

  if (record.status === SettlementCommissionInvoiceStatus.UNKNOWN) {
    return {
      ok: true,
      writesPerformed: false,
      settlementCommissionInvoiceId: record.id,
      status: mapStatus(record.status),
      canRetry: false,
      blockers: ['UNKNOWN execution must be reconciled before retry.'],
    };
  }

  return {
    ok: true,
    writesPerformed: false,
    settlementCommissionInvoiceId: record.id,
    status: mapStatus(record.status),
    canRetry: false,
    blockers: [`SettlementCommissionInvoice status ${record.status} is not retryable.`],
  };
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
  assertRecordStatus(
    existing,
    [SettlementCommissionInvoiceStatus.PENDING, SettlementCommissionInvoiceStatus.FAILED],
    'markCreated',
  );
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

export async function markUnknown(
  input: MarkSettlementCommissionInvoiceUnknownInput,
): Promise<SettlementCommissionInvoiceRecordDto> {
  const existing = await getRequiredRecord(input.settlementCommissionInvoiceId);
  assertRecordStatus(
    existing,
    [SettlementCommissionInvoiceStatus.PENDING, SettlementCommissionInvoiceStatus.FAILED],
    'markUnknown',
  );
  const record = await prisma.settlementCommissionInvoice.update({
    where: {
      id: input.settlementCommissionInvoiceId,
    },
    data: {
      status: SettlementCommissionInvoiceStatus.UNKNOWN,
      unknownReason: readRequiredText(input.unknownReason, 'unknownReason'),
      unknownAt: new Date(),
      responseSnapshotJson: input.responseSnapshotJson ?? undefined,
    },
  });

  return mapRecord(record);
}

export async function applySettlementCommissionInvoiceReconciliation(
  input: ApplySettlementCommissionInvoiceReconciliationInput,
): Promise<SettlementCommissionInvoiceRecordDto> {
  assertReconciliationEvidence(input.reconciliationEvidenceJson);
  const existing = await getRequiredRecord(input.settlementCommissionInvoiceId);
  assertRecordStatus(existing, [SettlementCommissionInvoiceStatus.CREATED], 'applySettlementCommissionInvoiceReconciliation');
  const incomingInvoiceNo = readString(input.invoiceNo);
  const existingInvoiceNo = readString(existing.invoiceNo);
  const hasInvoiceNoConflict = Boolean(
    incomingInvoiceNo &&
    existingInvoiceNo &&
    incomingInvoiceNo !== existingInvoiceNo,
  );
  const invoiceDate = parseOptionalDate(input.invoiceDate, 'invoiceDate');
  const record = await prisma.settlementCommissionInvoice.update({
    where: {
      id: input.settlementCommissionInvoiceId,
    },
    data: {
      providerInvoiceId: input.providerInvoiceId ?? existing.providerInvoiceId,
      providerUuid: input.providerUuid ?? existing.providerUuid,
      providerEttn: input.providerEttn ?? existing.providerEttn,
      invoiceNo: hasInvoiceNoConflict ? existing.invoiceNo : incomingInvoiceNo ?? existing.invoiceNo,
      invoiceDate: invoiceDate ?? existing.invoiceDate,
      invoiceTotalMinor: input.invoiceTotalMinor ?? existing.invoiceTotalMinor,
      invoiceCurrency: input.invoiceCurrency ?? existing.invoiceCurrency,
      gibStatus: input.gibStatus ?? existing.gibStatus,
      gibStatusCode: input.gibStatusCode ?? existing.gibStatusCode,
      documentStatus: input.documentStatus ?? existing.documentStatus,
      documentStatusCode: input.documentStatusCode ?? existing.documentStatusCode,
      documentType: input.documentType ?? existing.documentType,
      lastProviderSyncedAt: input.lastProviderSyncedAt ?? existing.lastProviderSyncedAt,
      reconciliationStatus: hasInvoiceNoConflict ? 'conflict' : input.reconciliationStatus,
      reconciliationEvidenceJson: input.reconciliationEvidenceJson,
      reconciledAt: new Date(),
      reconciledBy: input.reconciledBy ?? 'system',
    },
  });

  return mapRecord(record);
}

export async function resolveUnknownAsCreated(
  input: ResolveSettlementCommissionInvoiceUnknownAsCreatedInput,
): Promise<SettlementCommissionInvoiceRecordDto> {
  assertReconciliationEvidence(input.reconciliationEvidenceJson);
  const existing = await getRequiredRecord(input.settlementCommissionInvoiceId);
  assertRecordStatus(existing, [SettlementCommissionInvoiceStatus.UNKNOWN], 'resolveUnknownAsCreated');
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
      reconciliationStatus: 'resolved_created',
      reconciliationEvidenceJson: input.reconciliationEvidenceJson,
      reconciledAt: new Date(),
      reconciledBy: input.reconciledBy ?? null,
    },
  });

  return mapRecord(record);
}

export async function resolveUnknownAsFailed(
  input: ResolveSettlementCommissionInvoiceUnknownAsFailedInput,
): Promise<SettlementCommissionInvoiceRecordDto> {
  assertReconciliationEvidence(input.reconciliationEvidenceJson);
  const existing = await getRequiredRecord(input.settlementCommissionInvoiceId);
  assertRecordStatus(existing, [SettlementCommissionInvoiceStatus.UNKNOWN], 'resolveUnknownAsFailed');
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
      reconciliationStatus: 'resolved_failed',
      reconciliationEvidenceJson: input.reconciliationEvidenceJson,
      reconciledAt: new Date(),
      reconciledBy: input.reconciledBy ?? null,
    },
  });

  return mapRecord(record);
}

export async function canRetry(
  input: IncrementSettlementCommissionInvoiceRetryInput,
): Promise<SettlementCommissionInvoiceRetryDecisionDto> {
  const existing = await getRequiredRecord(input.settlementCommissionInvoiceId);
  return buildRetryDecision(existing);
}

export async function incrementRetry(
  input: IncrementSettlementCommissionInvoiceRetryInput,
): Promise<SettlementCommissionInvoiceRecordDto> {
  const existing = await getRequiredRecord(input.settlementCommissionInvoiceId);
  if (existing.status === SettlementCommissionInvoiceStatus.UNKNOWN) {
    throw new Error('UNKNOWN execution must be reconciled before retry.');
  }
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
  options: { env?: AppEnv } = {},
): Promise<SettlementCommissionInvoiceDiagnosticsDto | null> {
  const record = await prisma.settlementCommissionInvoice.findUnique({
    where: {
      id: settlementCommissionInvoiceId,
    },
  });
  if (!record) {
    return null;
  }
  const environmentGuard = options.env
    ? validateLogoExecutionEnvironment({
        env: options.env,
      })
    : null;
  const executionContract = validateLogoExecutionContractRecord(record);

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
      environmentGuard,
      executionContract,
      providerIdentifiers: {
        providerInvoiceId: record.providerInvoiceId,
        providerUuid: record.providerUuid,
        providerEttn: record.providerEttn,
        invoiceNo: record.invoiceNo,
      },
      invoiceMetadata: {
        invoiceDate: toIso(record.invoiceDate),
        invoiceTotalMinor: record.invoiceTotalMinor ?? null,
        invoiceCurrency: record.invoiceCurrency ?? null,
        gibStatus: record.gibStatus ?? null,
        gibStatusCode: record.gibStatusCode ?? null,
        documentStatus: record.documentStatus,
        documentStatusCode: record.documentStatusCode ?? null,
        documentType: record.documentType ?? null,
        lastProviderSyncedAt: toIso(record.lastProviderSyncedAt),
      },
      timestamps: {
        createdAt: record.createdAt.toISOString(),
        updatedAt: record.updatedAt.toISOString(),
        failedAt: toIso(record.failedAt),
        unknownAt: toIso(record.unknownAt),
        lastRetriedAt: toIso(record.lastRetriedAt),
        cancelledAt: toIso(record.cancelledAt),
        reconciledAt: toIso(record.reconciledAt),
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
      unknown: {
        reason: record.unknownReason,
        unknownAt: toIso(record.unknownAt),
        reconciliationState: record.reconciliationStatus,
        reconciledAt: toIso(record.reconciledAt),
        reconciledBy: record.reconciledBy,
        reconciliationEvidence: getSnapshotMetadata(record.reconciliationEvidenceJson),
        reconciliationEvidenceSafe: getPersistedReconciliationEvidenceDto(record),
      },
    },
  };
}

export const __settlementCommissionInvoiceRecordTesting = {
  mapRecord,
  getSnapshotMetadata,
  getRequestSnapshotMetadata,
};
