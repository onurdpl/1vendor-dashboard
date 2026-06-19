import {
  Prisma,
  SettlementApprovalStatus,
  SettlementCommissionInvoiceProvider,
  SettlementCommissionInvoiceStatus,
} from '@prisma/client';
import type { AppEnv } from '../../config/env.js';
import { prisma } from '../../db/prisma.js';
import {
  extractSessionFromLoginResponse,
  LogoIsbasiClient,
  sanitizeLoginResponse,
  type LogoIsbasiAuthenticatedSession,
  type LogoIsbasiRawResult,
} from '../logo-isbasi/logo-isbasi.client.js';
import {
  validateLogoExecutionEnvironment,
  type LogoExecutionEnvironmentGuardResult,
} from '../logo-isbasi/logo-execution-environment-guard.service.js';
import { validateLogoExecutionContractRecord } from './settlement-logo-execution-contract.service.js';
import {
  applySettlementCommissionInvoiceReconciliation,
  incrementRetry,
  markCreated,
  markFailed,
  markUnknown,
  type SettlementCommissionInvoiceRecordDto,
} from './settlement-commission-invoice-record.service.js';
import {
  previewSettlementLogoOutgoingInvoiceSync,
  type LogoOutgoingInvoiceSyncPreviewResult,
} from './settlement-logo-outgoing-invoice-sync-preview.service.js';

type LogoCreateClient = Pick<LogoIsbasiClient, 'login' | 'createIntegrationInvoice' | 'listSalesInvoices'>;

type LogoCreateReconciliationResult = {
  attempted: boolean;
  status: string | null;
  matched: boolean;
  invoiceNo: string | null;
  invoiceDate: string | null;
  invoiceTotalMinor: number | null;
  invoiceCurrency: string | null;
  warnings: string[];
};

export type ExecuteSettlementLogoCommissionInvoiceCreateResult = {
  ok: boolean;
  writesPerformed: boolean;
  externalApiCallAttempted: boolean;
  settlementCommissionInvoiceId: string;
  status: 'blocked' | 'created' | 'failed' | 'unknown';
  blockers: string[];
  warnings: string[];
  environmentGuard: LogoExecutionEnvironmentGuardResult | null;
  record: SettlementCommissionInvoiceRecordDto | null;
  providerResult: {
    httpStatus: number | null;
    invoiceId: string | null;
    uuid: string | null;
    ettn: string | null;
    invoiceNo: string | null;
  } | null;
  reconciliation: LogoCreateReconciliationResult;
};

export type ExecuteSettlementLogoCommissionInvoiceCreateOptions = {
  env: AppEnv;
  client?: LogoCreateClient;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readRecordString(value: unknown, keys: string[]) {
  if (!isRecord(value)) {
    return null;
  }
  for (const key of keys) {
    const raw = value[key];
    if (typeof raw === 'string' && raw.trim()) {
      return raw.trim();
    }
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      return String(raw);
    }
  }
  return null;
}

function readLogoCreateInvoiceRecord(body: unknown): unknown {
  if (!isRecord(body)) {
    return body;
  }
  for (const key of ['data', 'invoice', 'result', 'item']) {
    if (isRecord(body[key])) {
      return body[key];
    }
  }
  return body;
}

function extractLogoCreateIdentifiers(body: unknown) {
  const invoiceRecord = readLogoCreateInvoiceRecord(body);
  return {
    invoiceId: readRecordString(invoiceRecord, ['invoiceId', 'id', 'invoice_id', 'salesInvoiceId']),
    uuid: readRecordString(invoiceRecord, ['uuid', 'uuId', 'UUID']),
    ettn: readRecordString(invoiceRecord, ['ettn', 'ETTN', 'eTtn']),
    invoiceNo: readRecordString(invoiceRecord, [
      'invoiceNumber',
      'invoiceNo',
      'invoice_number',
      'number',
      'documentNumber',
      'serialNumber',
    ]),
  };
}

function redactJsonValue(value: unknown, depth = 0): unknown {
  if (depth > 6) {
    return '[truncated]';
  }
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => redactJsonValue(item, depth + 1));
  }
  if (isRecord(value)) {
    const output: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(value)) {
      if (raw === undefined || typeof raw === 'function') {
        continue;
      }
      if (/(access|refresh)?token|password|secret|api[_-]?key|authorization/i.test(key)) {
        output[key] = '[redacted]';
      } else {
        output[key] = redactJsonValue(raw, depth + 1);
      }
    }
    return output;
  }
  return String(value);
}

function safeErrorMessage(error: unknown) {
  return error instanceof Error && error.message.trim() ? error.message.trim().slice(0, 500) : 'Unknown error.';
}

function buildBlockedResult(input: {
  settlementCommissionInvoiceId: string;
  blockers: string[];
  environmentGuard?: LogoExecutionEnvironmentGuardResult | null;
  externalApiCallAttempted?: boolean;
  warnings?: string[];
}): ExecuteSettlementLogoCommissionInvoiceCreateResult {
  return {
    ok: false,
    writesPerformed: false,
    externalApiCallAttempted: input.externalApiCallAttempted ?? false,
    settlementCommissionInvoiceId: input.settlementCommissionInvoiceId,
    status: 'blocked',
    blockers: Array.from(new Set(input.blockers)),
    warnings: Array.from(new Set(input.warnings ?? [])),
    environmentGuard: input.environmentGuard ?? null,
    record: null,
    providerResult: null,
    reconciliation: buildSkippedReconciliation(),
  };
}

function buildSkippedReconciliation(): LogoCreateReconciliationResult {
  return {
    attempted: false,
    status: null,
    matched: false,
    invoiceNo: null,
    invoiceDate: null,
    invoiceTotalMinor: null,
    invoiceCurrency: null,
    warnings: [],
  };
}

function buildReconciliationFromPreview(input: {
  preview: LogoOutgoingInvoiceSyncPreviewResult;
  status: string;
  warnings?: string[];
}) {
  return {
    attempted: true,
    status: input.status,
    matched: input.preview.search.matched,
    invoiceNo: input.preview.mappedFields.invoiceNoCandidate,
    invoiceDate: input.preview.mappedFields.invoiceDate,
    invoiceTotalMinor: input.preview.mappedFields.invoiceTotalMinor,
    invoiceCurrency: input.preview.mappedFields.invoiceCurrency,
    warnings: Array.from(new Set(input.warnings ?? input.preview.warnings)),
  };
}

function buildReconciliationEvidence(input: {
  preview: LogoOutgoingInvoiceSyncPreviewResult;
  status: string;
  warnings: string[];
}): Prisma.InputJsonObject {
  return {
    provider: 'LOGO_ISBASI',
    action: 'salesInvoiceListReconciliation',
    sourceEndpoint: '/api/v1.0/invoices/invoices',
    reconciliationStatus: input.status,
    matched: input.preview.search.matched,
    ambiguity: input.preview.search.ambiguity,
    warnings: input.warnings,
    search: input.preview.search,
    record: input.preview.record,
    mappedFields: input.preview.mappedFields,
    matchedInvoice: input.preview.matchedInvoice,
    candidateCount: input.preview.candidateInvoices.length,
    candidateInvoices: input.preview.candidateInvoices.slice(0, 20),
    providerFieldsObserved: input.preview.providerFieldsObserved,
  } as Prisma.InputJsonObject;
}

function buildFailedReconciliationEvidence(input: {
  error: unknown;
  warnings: string[];
}): Prisma.InputJsonObject {
  return {
    provider: 'LOGO_ISBASI',
    action: 'salesInvoiceListReconciliation',
    sourceEndpoint: '/api/v1.0/invoices/invoices',
    reconciliationStatus: 'failed',
    matched: false,
    ambiguity: false,
    warnings: input.warnings,
    errorMessage: safeErrorMessage(input.error),
  } as Prisma.InputJsonObject;
}

async function reconcileCreatedSalesInvoice(input: {
  settlementCommissionInvoiceId: string;
  env: AppEnv;
  client: LogoCreateClient;
  createdRecord: SettlementCommissionInvoiceRecordDto;
}) {
  try {
    const preview = await previewSettlementLogoOutgoingInvoiceSync(input.settlementCommissionInvoiceId, {
      env: input.env,
      client: input.client,
    });
    const hasInvoiceNoConflict = Boolean(
      preview.search.matched &&
      preview.record?.invoiceNo &&
      preview.mappedFields.invoiceNoCandidate &&
      preview.record.invoiceNo !== preview.mappedFields.invoiceNoCandidate,
    );
    const status = hasInvoiceNoConflict
      ? 'conflict'
      : preview.search.matched
        ? 'matched'
        : preview.search.ambiguity
          ? 'ambiguous'
          : 'not_found';
    const warnings = hasInvoiceNoConflict
      ? ['Logo sales invoice reconciliation found a different invoice number; existing invoiceNo was not overwritten.']
      : preview.search.matched
        ? preview.warnings
        : preview.search.ambiguity
          ? ['Logo sales invoice reconciliation found multiple matching invoices; no invoice fields were persisted.']
          : ['Logo sales invoice reconciliation did not find a matching sales invoice yet.'];
    const evidence = buildReconciliationEvidence({ preview, status, warnings });
    const reconciledRecord = await applySettlementCommissionInvoiceReconciliation({
      settlementCommissionInvoiceId: input.settlementCommissionInvoiceId,
      reconciliationStatus: status,
      reconciliationEvidenceJson: evidence,
      providerInvoiceId: preview.search.matched ? preview.mappedFields.providerInvoiceId : null,
      providerUuid: preview.search.matched ? preview.mappedFields.providerUuid : null,
      providerEttn: preview.search.matched ? preview.mappedFields.providerEttn : null,
      invoiceNo: preview.search.matched ? preview.mappedFields.invoiceNoCandidate : null,
      documentStatus: preview.search.matched ? preview.mappedFields.documentStatus : null,
      reconciledBy: 'system',
    });
    return {
      record: reconciledRecord,
      reconciliation: buildReconciliationFromPreview({
        preview,
        status: reconciledRecord.reconciliationStatus ?? status,
        warnings,
      }),
    };
  } catch (error) {
    const warnings = [`Logo sales invoice reconciliation failed after create: ${safeErrorMessage(error)}`];
    try {
      const failedRecord = await applySettlementCommissionInvoiceReconciliation({
        settlementCommissionInvoiceId: input.settlementCommissionInvoiceId,
        reconciliationStatus: 'failed',
        reconciliationEvidenceJson: buildFailedReconciliationEvidence({ error, warnings }),
        reconciledBy: 'system',
      });
      return {
        record: failedRecord,
        reconciliation: {
          attempted: true,
          status: 'failed',
          matched: false,
          invoiceNo: null,
          invoiceDate: null,
          invoiceTotalMinor: null,
          invoiceCurrency: null,
          warnings,
        },
      };
    } catch {
      return {
        record: input.createdRecord,
        reconciliation: {
          attempted: true,
          status: 'failed',
          matched: false,
          invoiceNo: null,
          invoiceDate: null,
          invoiceTotalMinor: null,
          invoiceCurrency: null,
          warnings,
        },
      };
    }
  }
}

function getMissingCredentialEnv(env: AppEnv) {
  return [
    !readString(env.LOGO_ISBASI_API_KEY) ? 'LOGO_ISBASI_API_KEY' : null,
    !readString(env.LOGO_ISBASI_USERNAME) ? 'LOGO_ISBASI_USERNAME' : null,
    !readString(env.LOGO_ISBASI_PASSWORD) ? 'LOGO_ISBASI_PASSWORD' : null,
  ].filter((value): value is string => Boolean(value));
}

function buildLogoClient(env: AppEnv): LogoCreateClient {
  return new LogoIsbasiClient({
    baseUrl: env.LOGO_ISBASI_BASE_URL!,
    apiKey: env.LOGO_ISBASI_API_KEY!,
    username: env.LOGO_ISBASI_USERNAME!,
    password: env.LOGO_ISBASI_PASSWORD!,
  });
}

function getLogoPayload(snapshot: unknown) {
  const record = isRecord(snapshot) ? snapshot : null;
  return isRecord(record?.logoPayload) ? record.logoPayload : null;
}

function buildResponseSnapshot(input: {
  result: LogoIsbasiRawResult;
  capturedAt: Date;
  identifiers: ReturnType<typeof extractLogoCreateIdentifiers>;
}): Prisma.InputJsonObject {
  const snapshot: Record<string, unknown> = {
    provider: 'LOGO_ISBASI',
    action: 'createIntegrationInvoice',
    capturedAt: input.capturedAt.toISOString(),
    httpStatus: input.result.status,
    ok: input.result.ok,
    jsonParseFailed: input.result.jsonParseFailed,
    responseKeys: isRecord(input.result.body) ? Object.keys(input.result.body).sort() : [],
    identifiers: redactJsonValue(input.identifiers),
    request: {
      url: input.result.requestUrl ?? null,
      method: input.result.requestMethod ?? null,
      contentType: input.result.requestContentType ?? null,
      accept: input.result.requestAccept ?? null,
      queryParameters: input.result.queryParameters ?? [],
    },
    response: {
      status: input.result.status,
      contentType: input.result.responseContentType ?? null,
      bodySnippet: input.result.responseBodySnippet ?? null,
    },
    body: redactJsonValue(input.result.body),
  };
  return snapshot as Prisma.InputJsonObject;
}

function buildErrorSnapshot(input: {
  error: unknown;
  capturedAt: Date;
  stage: string;
  providerRequestMayHaveBeenSent: boolean;
}): Prisma.InputJsonObject {
  return {
    provider: 'LOGO_ISBASI',
    action: 'createIntegrationInvoice',
    capturedAt: input.capturedAt.toISOString(),
    stage: input.stage,
    providerRequestMayHaveBeenSent: input.providerRequestMayHaveBeenSent,
    errorMessage: safeErrorMessage(input.error),
  };
}

async function loginForLogoCreate(client: LogoCreateClient) {
  const result = await client.login();
  const login = sanitizeLoginResponse(result.body);
  const extracted = extractSessionFromLoginResponse(result.body);
  const missingSessionFields = extracted.missing.filter((field) => field !== 'tenantId');
  const ok = result.ok && !result.jsonParseFailed && missingSessionFields.length === 0;

  if (!ok) {
    return {
      ok: false as const,
      blockers: [
        result.jsonParseFailed
          ? 'Logo İşbaşı login returned a non-JSON response.'
          : !result.ok
            ? 'Logo İşbaşı login request failed before invoice create.'
            : 'Logo İşbaşı login response is missing required session fields.',
      ],
      login,
      session: null,
    };
  }

  return {
    ok: true as const,
    blockers: [],
    login,
    session: {
      accessToken: extracted.accessToken!,
      tenantId: extracted.tenantId,
      userId: extracted.userId,
      userEmail: extracted.userEmail,
      userName: extracted.userName,
    } satisfies LogoIsbasiAuthenticatedSession,
  };
}

export async function executeSettlementLogoCommissionInvoiceCreate(
  settlementCommissionInvoiceId: string,
  options: ExecuteSettlementLogoCommissionInvoiceCreateOptions,
): Promise<ExecuteSettlementLogoCommissionInvoiceCreateResult> {
  const record = await prisma.settlementCommissionInvoice.findUnique({
    where: {
      id: settlementCommissionInvoiceId,
    },
    include: {
      settlementApproval: {
        select: {
          id: true,
          status: true,
        },
      },
    },
  });

  if (!record) {
    return buildBlockedResult({
      settlementCommissionInvoiceId,
      blockers: ['SettlementCommissionInvoice record could not be found.'],
    });
  }

  if (record.provider !== SettlementCommissionInvoiceProvider.LOGO_ISBASI) {
    return buildBlockedResult({
      settlementCommissionInvoiceId,
      blockers: ['SettlementCommissionInvoice provider must be LOGO_ISBASI before Logo execution.'],
    });
  }

  if (record.status === SettlementCommissionInvoiceStatus.UNKNOWN) {
    return buildBlockedResult({
      settlementCommissionInvoiceId,
      blockers: ['UNKNOWN execution must be reconciled before retry.'],
    });
  }

  if (
    record.status !== SettlementCommissionInvoiceStatus.PENDING &&
    record.status !== SettlementCommissionInvoiceStatus.FAILED
  ) {
    return buildBlockedResult({
      settlementCommissionInvoiceId,
      blockers: [`SettlementCommissionInvoice status ${record.status} is not executable.`],
    });
  }

  if (record.settlementApproval.status !== SettlementApprovalStatus.APPROVED) {
    return buildBlockedResult({
      settlementCommissionInvoiceId,
      blockers: ['SettlementApproval must be APPROVED before Logo invoice execution.'],
    });
  }

  const activeRecord = await prisma.settlementCommissionInvoice.findFirst({
    where: {
      settlementApprovalId: record.settlementApprovalId,
      provider: record.provider,
      status: {
        not: SettlementCommissionInvoiceStatus.CANCELLED,
      },
    },
    select: {
      id: true,
      status: true,
    },
  });
  if (activeRecord && activeRecord.id !== record.id) {
    return buildBlockedResult({
      settlementCommissionInvoiceId,
      blockers: [
        `SettlementApproval already has a different active LOGO_ISBASI commission invoice record (${activeRecord.id}, ${activeRecord.status}).`,
      ],
    });
  }

  const executionContract = validateLogoExecutionContractRecord(record);
  if (!executionContract.ok) {
    return buildBlockedResult({
      settlementCommissionInvoiceId,
      blockers: executionContract.blockers,
    });
  }

  const logoPayload = getLogoPayload(record.requestSnapshotJson);
  if (!logoPayload) {
    return buildBlockedResult({
      settlementCommissionInvoiceId,
      blockers: ['SettlementCommissionInvoice requestSnapshotJson.logoPayload is required before Logo execution.'],
    });
  }

  const initialGuard = validateLogoExecutionEnvironment({
    env: options.env,
    deferTenantValidationUntilLogin: true,
  });
  if (!initialGuard.allowed) {
    return buildBlockedResult({
      settlementCommissionInvoiceId,
      blockers: initialGuard.blockers,
      warnings: initialGuard.warnings,
      environmentGuard: initialGuard,
    });
  }

  const missingCredentials = getMissingCredentialEnv(options.env);
  if (missingCredentials.length) {
    return buildBlockedResult({
      settlementCommissionInvoiceId,
      blockers: ['Logo İşbaşı credentials are required before invoice execution.'],
      warnings: [...initialGuard.warnings, `Missing env: ${missingCredentials.join(', ')}`],
      environmentGuard: initialGuard,
    });
  }

  const client = options.client ?? buildLogoClient(options.env);
  let login;
  try {
    login = await loginForLogoCreate(client);
  } catch (error) {
    return buildBlockedResult({
      settlementCommissionInvoiceId,
      blockers: [`Logo İşbaşı login failed before invoice create: ${safeErrorMessage(error)}`],
      warnings: initialGuard.warnings,
      environmentGuard: initialGuard,
      externalApiCallAttempted: true,
    });
  }

  if (!login.ok || !login.session) {
    return buildBlockedResult({
      settlementCommissionInvoiceId,
      blockers: login.blockers,
      warnings: initialGuard.warnings,
      environmentGuard: initialGuard,
      externalApiCallAttempted: true,
    });
  }

  const tenantGuard = validateLogoExecutionEnvironment({
    env: options.env,
    actualTenantId: login.session.tenantId,
  });
  if (!tenantGuard.allowed) {
    return buildBlockedResult({
      settlementCommissionInvoiceId,
      blockers: tenantGuard.blockers,
      warnings: tenantGuard.warnings,
      environmentGuard: tenantGuard,
      externalApiCallAttempted: true,
    });
  }

  if (record.status === SettlementCommissionInvoiceStatus.FAILED) {
    await incrementRetry({ settlementCommissionInvoiceId });
  }

  let result: LogoIsbasiRawResult;
  try {
    result = await client.createIntegrationInvoice(login.session, logoPayload);
  } catch (error) {
    const responseSnapshotJson = buildErrorSnapshot({
      error,
      capturedAt: new Date(),
      stage: 'provider_create_exception',
      providerRequestMayHaveBeenSent: true,
    });
    const unknown = await markUnknown({
      settlementCommissionInvoiceId,
      unknownReason: 'Logo create returned an ambiguous network/timeout result. Reconciliation is required before retry.',
      responseSnapshotJson,
    });
    return {
      ok: false,
      writesPerformed: true,
      externalApiCallAttempted: true,
      settlementCommissionInvoiceId,
      status: 'unknown',
      blockers: ['Logo create outcome is UNKNOWN. Reconciliation is required before retry.'],
      warnings: tenantGuard.warnings,
      environmentGuard: tenantGuard,
      record: unknown,
      providerResult: null,
      reconciliation: buildSkippedReconciliation(),
    };
  }

  const identifiers = extractLogoCreateIdentifiers(result.body);
  const responseSnapshotJson = buildResponseSnapshot({
    result,
    capturedAt: new Date(),
    identifiers,
  });

  if (!result.ok) {
    const failed = await markFailed({
      settlementCommissionInvoiceId,
      failureCode: result.jsonParseFailed ? 'LOGO_ISBASI_JSON_PARSE_FAILED' : 'LOGO_ISBASI_UPSTREAM_NON_2XX',
      failureMessage: result.jsonParseFailed
        ? 'Logo İşbaşı returned a non-JSON error response.'
        : readRecordString(result.body, ['message', 'error', 'errorMessage']) ?? 'Logo İşbaşı invoice create request failed.',
      responseSnapshotJson,
    });
    return {
      ok: false,
      writesPerformed: true,
      externalApiCallAttempted: true,
      settlementCommissionInvoiceId,
      status: 'failed',
      blockers: [],
      warnings: tenantGuard.warnings,
      environmentGuard: tenantGuard,
      record: failed,
      providerResult: {
        httpStatus: result.status,
        invoiceId: identifiers.invoiceId,
        uuid: identifiers.uuid,
        ettn: identifiers.ettn,
        invoiceNo: identifiers.invoiceNo,
      },
      reconciliation: buildSkippedReconciliation(),
    };
  }

  if (result.jsonParseFailed) {
    const unknown = await markUnknown({
      settlementCommissionInvoiceId,
      unknownReason: 'Logo create returned a successful but non-JSON response. Reconciliation is required before retry.',
      responseSnapshotJson,
    });
    return {
      ok: false,
      writesPerformed: true,
      externalApiCallAttempted: true,
      settlementCommissionInvoiceId,
      status: 'unknown',
      blockers: ['Logo create outcome is UNKNOWN. Reconciliation is required before retry.'],
      warnings: tenantGuard.warnings,
      environmentGuard: tenantGuard,
      record: unknown,
      providerResult: {
        httpStatus: result.status,
        invoiceId: identifiers.invoiceId,
        uuid: identifiers.uuid,
        ettn: identifiers.ettn,
        invoiceNo: identifiers.invoiceNo,
      },
      reconciliation: buildSkippedReconciliation(),
    };
  }

  try {
    const created = await markCreated({
      settlementCommissionInvoiceId,
      providerInvoiceId: identifiers.invoiceId,
      providerUuid: identifiers.uuid,
      providerEttn: identifiers.ettn,
      invoiceNo: identifiers.invoiceNo,
      responseSnapshotJson,
    });
    const reconciliationResult = await reconcileCreatedSalesInvoice({
      settlementCommissionInvoiceId,
      env: options.env,
      client,
      createdRecord: created,
    });
    return {
      ok: true,
      writesPerformed: true,
      externalApiCallAttempted: true,
      settlementCommissionInvoiceId,
      status: 'created',
      blockers: [],
      warnings: Array.from(new Set([...tenantGuard.warnings, ...reconciliationResult.reconciliation.warnings])),
      environmentGuard: tenantGuard,
      record: reconciliationResult.record,
      providerResult: {
        httpStatus: result.status,
        invoiceId: identifiers.invoiceId,
        uuid: identifiers.uuid,
        ettn: identifiers.ettn,
        invoiceNo: identifiers.invoiceNo,
      },
      reconciliation: reconciliationResult.reconciliation,
    };
  } catch (error) {
    try {
      const unknown = await markUnknown({
        settlementCommissionInvoiceId,
        unknownReason: 'Local persistence ambiguity after Logo create provider success. Reconciliation is required before retry.',
        responseSnapshotJson: {
          ...responseSnapshotJson,
          localPersistenceErrorMessage: safeErrorMessage(error),
        },
      });
      return {
        ok: false,
        writesPerformed: true,
        externalApiCallAttempted: true,
        settlementCommissionInvoiceId,
        status: 'unknown',
        blockers: ['Logo create may have succeeded, but local CREATED persistence failed. Reconciliation is required.'],
        warnings: tenantGuard.warnings,
        environmentGuard: tenantGuard,
        record: unknown,
        providerResult: {
          httpStatus: result.status,
          invoiceId: identifiers.invoiceId,
          uuid: identifiers.uuid,
          ettn: identifiers.ettn,
          invoiceNo: identifiers.invoiceNo,
        },
        reconciliation: buildSkippedReconciliation(),
      };
    } catch (unknownError) {
      return {
        ok: false,
        writesPerformed: true,
        externalApiCallAttempted: true,
        settlementCommissionInvoiceId,
        status: 'unknown',
        blockers: [
          'Logo create may have succeeded, but local status persistence failed. Manual reconciliation is required before retry.',
        ],
        warnings: [safeErrorMessage(unknownError)],
        environmentGuard: tenantGuard,
        record: null,
        providerResult: {
          httpStatus: result.status,
          invoiceId: identifiers.invoiceId,
          uuid: identifiers.uuid,
          ettn: identifiers.ettn,
          invoiceNo: identifiers.invoiceNo,
        },
        reconciliation: buildSkippedReconciliation(),
      };
    }
  }
}
