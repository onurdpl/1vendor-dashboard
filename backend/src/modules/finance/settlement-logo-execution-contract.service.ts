import {
  SettlementCommissionInvoiceProvider,
  SettlementCommissionInvoiceStatus,
  type SettlementCommissionInvoice,
} from '@prisma/client';
import { prisma } from '../../db/prisma.js';

export type SettlementLogoExecutionContractDto = {
  ok: boolean;
  writesPerformed: false;
  settlementCommissionInvoiceId: string;
  status: 'READY' | 'BLOCKED';
  recordStatus: string | null;
  requestSnapshotPresent: boolean;
  payloadPresent: boolean;
  snapshotSource: 'immutable_settlement_truth' | null;
  payloadBuilderVersion: string | null;
  requestBuiltAt: string | null;
  blockers: string[];
};

type SettlementCommissionInvoiceForContract = Pick<
  SettlementCommissionInvoice,
  'id' | 'status' | 'provider' | 'requestSnapshotJson'
>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
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

function buildBlockedMissingRecordResult(settlementCommissionInvoiceId: string): SettlementLogoExecutionContractDto {
  return {
    ok: false,
    writesPerformed: false,
    settlementCommissionInvoiceId,
    status: 'BLOCKED',
    recordStatus: null,
    requestSnapshotPresent: false,
    payloadPresent: false,
    snapshotSource: null,
    payloadBuilderVersion: null,
    requestBuiltAt: null,
    blockers: ['SettlementCommissionInvoice record could not be found.'],
  };
}

export function validateLogoExecutionContractRecord(
  record: SettlementCommissionInvoiceForContract,
): SettlementLogoExecutionContractDto {
  const snapshot = isRecord(record.requestSnapshotJson) ? record.requestSnapshotJson : null;
  const requestSnapshotPresent = Boolean(snapshot);
  const payloadPresent = Boolean(snapshot && isRecord(snapshot.logoPayload));
  const snapshotSource = hasImmutableSettlementTruthShape(snapshot) ? 'immutable_settlement_truth' : null;
  const blockers: string[] = [];

  if (record.provider !== SettlementCommissionInvoiceProvider.LOGO_ISBASI) {
    blockers.push('SettlementCommissionInvoice provider must be LOGO_ISBASI before Logo execution.');
  }

  if (
    record.status !== SettlementCommissionInvoiceStatus.PENDING &&
    record.status !== SettlementCommissionInvoiceStatus.FAILED
  ) {
    blockers.push(
      `SettlementCommissionInvoice status must be PENDING or FAILED before Logo execution. Current status: ${record.status}.`,
    );
  }

  if (!requestSnapshotPresent) {
    blockers.push('SettlementCommissionInvoice requestSnapshotJson is required before Logo execution.');
  }

  if (!payloadPresent) {
    blockers.push('SettlementCommissionInvoice requestSnapshotJson.logoPayload is required before Logo execution.');
  }

  if (snapshotSource !== 'immutable_settlement_truth') {
    blockers.push('SettlementCommissionInvoice request snapshot must come from immutable_settlement_truth before Logo execution.');
  }

  return {
    ok: blockers.length === 0,
    writesPerformed: false,
    settlementCommissionInvoiceId: record.id,
    status: blockers.length === 0 ? 'READY' : 'BLOCKED',
    recordStatus: record.status,
    requestSnapshotPresent,
    payloadPresent,
    snapshotSource,
    payloadBuilderVersion: readString(snapshot?.payloadBuilderVersion),
    requestBuiltAt: readString(snapshot?.requestBuiltAt),
    blockers: Array.from(new Set(blockers)),
  };
}

export async function validateLogoExecutionContract(
  settlementCommissionInvoiceId: string,
): Promise<SettlementLogoExecutionContractDto> {
  const record = await prisma.settlementCommissionInvoice.findUnique({
    where: {
      id: settlementCommissionInvoiceId,
    },
  });
  if (!record) {
    return buildBlockedMissingRecordResult(settlementCommissionInvoiceId);
  }

  return validateLogoExecutionContractRecord(record);
}
