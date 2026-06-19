import {
  Prisma,
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
  applySettlementCommissionInvoiceReconciliation,
  type SettlementCommissionInvoiceRecordDto,
} from './settlement-commission-invoice-record.service.js';

const MAX_PAGES = 5;
const PAGE_SIZE = 100;
const MAX_CANDIDATE_INVOICES = 20;
const SEARCH_START_OFFSET_DAYS = 7;
const SEARCH_END_OFFSET_DAYS = 1;
const INVOICE_NUMBER_FIELDS = ['invoiceNumber', 'invoiceNo', 'documentNumber', 'number'] as const;

type LogoOutgoingInvoiceClient = Pick<LogoIsbasiClient, 'login' | 'listSalesInvoices'>;

type ProviderInvoiceRecord = Record<string, unknown>;

export type LogoOutgoingInvoiceSyncPreviewResult = {
  ok: boolean;
  writesPerformed: false;
  blockers: string[];
  warnings: string[];
  record: {
    id: string;
    status: string;
    providerUuid: string | null;
    invoiceNo: string | null;
    providerInvoiceId: string | null;
    providerEttn: string | null;
    expectedInvoiceTotalMinor: number | null;
  } | null;
  search: {
    dateStart: string;
    dateEnd: string;
    pagesChecked: number;
    totalProviderCount: number;
    matched: boolean;
    ambiguity: boolean;
  };
  matchedInvoice: null | {
    id: string | null;
    uuid: string | null;
    uuId: string | null;
    invoiceId: string | null;
    salesInvoiceId: string | null;
    invoiceNumber: string | null;
    invoiceNo: string | null;
    documentNumber: string | null;
    number: string | null;
    date: string | null;
    issueDate: string | null;
    amount: number | null;
    total: number | null;
    currency: string | null;
    status: string | null;
    statusCode: number | null;
    eType: string | null;
    eGovermentType: string | null;
    eGovermentTypeDesc: string | null;
    connectStatusDescription: string | null;
    connectStatusCode: number | null;
    accountingStatusSummary: Record<string, unknown>;
    customerDisplayName: string | null;
  };
  candidateInvoices: Array<{
    id: string | null;
    uuid: string | null;
    uuId: string | null;
    invoiceId: string | null;
    salesInvoiceId: string | null;
    date: string | null;
    issueDate: string | null;
    amount: number | null;
    total: number | null;
    currency: string | null;
    status: string | null;
    statusCode: number | null;
    eType: string | null;
    eGovermentType: string | null;
    eGovermentTypeDesc: string | null;
    invoiceNumber?: string;
    invoiceNo?: string;
    documentNumber?: string;
    number?: string;
    type: string | null;
    customerDisplayName?: string;
    matchSignals: {
      providerInvoiceIdEqualsId: boolean;
      invoiceIdEqualsProviderInvoiceId: boolean;
      salesInvoiceIdEqualsProviderInvoiceId: boolean;
      providerUuidEqualsUuid: boolean;
      providerUuidEqualsUuId: boolean;
      invoiceNumberPresent: boolean;
      amountNearRecordTotal: boolean;
    };
  }>;
  providerFieldsObserved: string[];
  mappedFields: {
    providerUuid: string | null;
    providerInvoiceId: string | null;
    providerEttn: string | null;
    gibStatus: string | null;
    gibStatusCode: number | null;
    documentStatus: string | null;
    documentStatusCode: number | null;
    documentType: string | null;
    invoiceDate: string | null;
    invoiceTotalMinor: number | null;
    invoiceCurrency: string | null;
    invoiceNoCandidate: string | null;
    invoiceNumberAvailable: boolean;
    invoiceNumberSource: string;
    invoiceNumberRecoveryPossible: boolean;
  };
};

export type LogoOutgoingInvoiceSyncPreviewOptions = {
  env: AppEnv;
  client?: LogoOutgoingInvoiceClient;
  now?: Date;
};

export type PersistSettlementLogoSalesInvoiceSyncOptions = LogoOutgoingInvoiceSyncPreviewOptions & {
  syncedBy?: string | null;
};

export type PersistSettlementLogoSalesInvoiceSyncResult = {
  ok: boolean;
  writesPerformed: boolean;
  settlementCommissionInvoiceId: string;
  status: 'synced' | 'blocked';
  blockers: string[];
  warnings: string[];
  record: SettlementCommissionInvoiceRecordDto | null;
  preview: LogoOutgoingInvoiceSyncPreviewResult | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readString(value: unknown) {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function readRecordString(value: unknown, keys: readonly string[]) {
  if (!isRecord(value)) {
    return null;
  }
  for (const key of keys) {
    const parsed = readString(value[key]);
    if (parsed) {
      return parsed;
    }
  }
  return null;
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

function readRecordNumber(value: unknown, keys: readonly string[]) {
  if (!isRecord(value)) {
    return null;
  }
  for (const key of keys) {
    const parsed = readNumber(value[key]);
    if (parsed !== null) {
      return parsed;
    }
  }
  return null;
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values));
}

function addDays(date: Date, days: number) {
  const result = new Date(date.getTime());
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function buildEmptyResult(input: {
  record?: LogoOutgoingInvoiceSyncPreviewResult['record'];
  dateStart?: string;
  dateEnd?: string;
  blockers?: string[];
  warnings?: string[];
}): LogoOutgoingInvoiceSyncPreviewResult {
  return {
    ok: false,
    writesPerformed: false,
    blockers: input.blockers ?? [],
    warnings: input.warnings ?? [],
    record: input.record ?? null,
    search: {
      dateStart: input.dateStart ?? '',
      dateEnd: input.dateEnd ?? '',
      pagesChecked: 0,
      totalProviderCount: 0,
      matched: false,
      ambiguity: false,
    },
    matchedInvoice: null,
    candidateInvoices: [],
    providerFieldsObserved: [],
    mappedFields: {
      providerUuid: null,
      providerInvoiceId: null,
      providerEttn: null,
      gibStatus: null,
      gibStatusCode: null,
      documentStatus: null,
      documentStatusCode: null,
      documentType: null,
      invoiceDate: null,
      invoiceTotalMinor: null,
      invoiceCurrency: null,
      invoiceNoCandidate: null,
      invoiceNumberAvailable: false,
      invoiceNumberSource: 'unknown',
      invoiceNumberRecoveryPossible: false,
    },
  };
}

function buildLogoClient(env: AppEnv): LogoOutgoingInvoiceClient {
  return new LogoIsbasiClient({
    baseUrl: env.LOGO_ISBASI_BASE_URL!,
    apiKey: env.LOGO_ISBASI_API_KEY!,
    username: env.LOGO_ISBASI_USERNAME!,
    password: env.LOGO_ISBASI_PASSWORD!,
  });
}

function getMissingEnv(env: AppEnv) {
  return [
    !readString(env.LOGO_ISBASI_BASE_URL) ? 'LOGO_ISBASI_BASE_URL' : null,
    !readString(env.LOGO_ISBASI_API_KEY) ? 'LOGO_ISBASI_API_KEY' : null,
    !readString(env.LOGO_ISBASI_USERNAME) ? 'LOGO_ISBASI_USERNAME' : null,
    !readString(env.LOGO_ISBASI_PASSWORD) ? 'LOGO_ISBASI_PASSWORD' : null,
  ].filter((value): value is string => Boolean(value));
}

async function loginForLogoRead(client: LogoOutgoingInvoiceClient) {
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
            ? 'Logo İşbaşı login request failed before sales invoice sync preview.'
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

function extractProviderRows(body: unknown): ProviderInvoiceRecord[] {
  const candidates = [
    isRecord(body) ? body.data : null,
    isRecord(body) && isRecord(body.data) ? body.data.data : null,
    isRecord(body) && isRecord(body.data) ? body.data.items : null,
    isRecord(body) && isRecord(body.data) ? body.data.list : null,
    isRecord(body) ? body.items : null,
    isRecord(body) ? body.result : null,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate.filter(isRecord);
    }
  }
  return [];
}

function extractProviderCount(body: unknown, fallback: number) {
  const candidates = [
    isRecord(body) ? body.count : null,
    isRecord(body) ? body.totalCount : null,
    isRecord(body) ? body.total : null,
    isRecord(body) && isRecord(body.data) ? body.data.count : null,
    isRecord(body) && isRecord(body.data) ? body.data.totalCount : null,
    isRecord(body) && isRecord(body.data) ? body.data.total : null,
  ];
  for (const candidate of candidates) {
    const parsed = readNumber(candidate);
    if (parsed !== null) {
      return parsed;
    }
  }
  return fallback;
}

function findInvoiceNumber(invoice: ProviderInvoiceRecord) {
  for (const key of INVOICE_NUMBER_FIELDS) {
    const value = readString(invoice[key]);
    if (value) {
      return {
        value,
        source: key,
      };
    }
  }
  return {
    value: null,
    source: 'unknown',
  };
}

function sanitizeAccountingStatus(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    return {};
  }
  const output: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (raw === null || typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') {
      output[key] = raw;
    }
  }
  return output;
}

function readCustomerDisplayName(invoice: ProviderInvoiceRecord) {
  const direct = readRecordString(invoice, ['customerName', 'customerTitle', 'customerDisplayName', 'firmName', 'firmTitle']);
  if (direct) {
    return direct;
  }
  const customer = invoice.customer ?? invoice.firm ?? invoice.client;
  return readRecordString(customer, ['name', 'title', 'displayName', 'companyName']);
}

function readGibStatus(invoice: ProviderInvoiceRecord) {
  const status = readRecordString(invoice, [
    'gibStatus',
    'gibStatusDescription',
    'gibState',
    'gibStateDescription',
    'eInvoiceStatus',
    'eInvoiceStatusDescription',
    'eDocumentStatus',
    'eDocumentStatusDescription',
    'eFaturaStatus',
    'eFaturaStatusDescription',
    'eArchiveStatus',
    'eArchiveStatusDescription',
  ]);
  const code = readRecordNumber(invoice, [
    'gibStatusCode',
    'gibStateCode',
    'eInvoiceStatusCode',
    'eDocumentStatusCode',
    'eFaturaStatusCode',
    'eArchiveStatusCode',
  ]);
  return { status, code };
}

function readDocumentStatus(invoice: ProviderInvoiceRecord) {
  return {
    status: readRecordString(invoice, [
      'documentStatus',
      'documentStatusDescription',
      'statusDescription',
      'connectStatusDescription',
    ]),
    code: readRecordNumber(invoice, ['documentStatusCode', 'connectStatusCode']),
  };
}

function mapMatchedInvoice(invoice: ProviderInvoiceRecord): NonNullable<LogoOutgoingInvoiceSyncPreviewResult['matchedInvoice']> {
  return {
    id: readRecordString(invoice, ['id']),
    uuid: readRecordString(invoice, ['uuid', 'UUID']),
    uuId: readRecordString(invoice, ['uuId', 'UuId']),
    invoiceId: readRecordString(invoice, ['invoiceId']),
    salesInvoiceId: readRecordString(invoice, ['salesInvoiceId']),
    invoiceNumber: readRecordString(invoice, ['invoiceNumber']),
    invoiceNo: readRecordString(invoice, ['invoiceNo']),
    documentNumber: readRecordString(invoice, ['documentNumber']),
    number: readRecordString(invoice, ['number']),
    date: readRecordString(invoice, ['date', 'invoiceDate']),
    issueDate: readRecordString(invoice, ['issueDate']),
    amount: readRecordNumber(invoice, ['amount']),
    total: readRecordNumber(invoice, ['total', 'totalAmount', 'grandTotal', 'payableAmount', 'netTotal']),
    currency: readRecordString(invoice, ['currency']),
    status: readRecordString(invoice, ['status']),
    statusCode: readRecordNumber(invoice, ['statusCode']),
    eType: readRecordString(invoice, ['eType', 'eType/typeId', 'type']),
    eGovermentType: readRecordString(invoice, ['eGovermentType']),
    eGovermentTypeDesc: readRecordString(invoice, ['eGovermentTypeDesc']),
    connectStatusDescription: readRecordString(invoice, ['connectStatusDescription']),
    connectStatusCode: readRecordNumber(invoice, ['connectStatusCode']),
    accountingStatusSummary: sanitizeAccountingStatus(invoice.accountingStatus),
    customerDisplayName: readCustomerDisplayName(invoice),
  };
}

function normalizeComparable(value: string | null | undefined) {
  return value?.trim().toLowerCase() || null;
}

function safeOptionalInvoiceNumberFields(invoice: ProviderInvoiceRecord) {
  const output: {
    invoiceNumber?: string;
    invoiceNo?: string;
    documentNumber?: string;
    number?: string;
  } = {};
  for (const key of INVOICE_NUMBER_FIELDS) {
    const value = readString(invoice[key]);
    if (value) {
      output[key] = value;
    }
  }
  return output;
}

function mapCandidateInvoice(input: {
  invoice: ProviderInvoiceRecord;
  recordProviderUuid: string | null;
  recordProviderInvoiceId: string | null;
  recordExpectedInvoiceTotalMinor: number | null;
}) {
  const invoice = mapMatchedInvoice(input.invoice);
  const recordProviderUuid = normalizeComparable(input.recordProviderUuid);
  const recordProviderInvoiceId = normalizeComparable(input.recordProviderInvoiceId);
  const invoiceTotalMinor = getInvoiceTotalMinor(input.invoice);
  return {
    id: invoice.id,
    uuid: invoice.uuid,
    uuId: invoice.uuId,
    invoiceId: invoice.invoiceId,
    salesInvoiceId: invoice.salesInvoiceId,
    date: invoice.date,
    issueDate: invoice.issueDate,
    amount: invoice.amount,
    total: invoice.total,
    currency: invoice.currency,
    status: invoice.status,
    statusCode: invoice.statusCode,
    eType: invoice.eType,
    eGovermentType: invoice.eGovermentType,
    eGovermentTypeDesc: invoice.eGovermentTypeDesc,
    type: readRecordString(input.invoice, ['type']),
    customerDisplayName: invoice.customerDisplayName ?? undefined,
    ...safeOptionalInvoiceNumberFields(input.invoice),
    matchSignals: {
      providerInvoiceIdEqualsId: Boolean(recordProviderInvoiceId && normalizeComparable(invoice.id) === recordProviderInvoiceId),
      invoiceIdEqualsProviderInvoiceId: Boolean(
        recordProviderInvoiceId && normalizeComparable(invoice.invoiceId) === recordProviderInvoiceId,
      ),
      salesInvoiceIdEqualsProviderInvoiceId: Boolean(
        recordProviderInvoiceId && normalizeComparable(invoice.salesInvoiceId) === recordProviderInvoiceId,
      ),
      providerUuidEqualsUuid: Boolean(recordProviderUuid && normalizeComparable(invoice.uuid) === recordProviderUuid),
      providerUuidEqualsUuId: Boolean(recordProviderUuid && normalizeComparable(invoice.uuId) === recordProviderUuid),
      invoiceNumberPresent: Boolean(findInvoiceNumber(input.invoice).value),
      amountNearRecordTotal: Boolean(
        input.recordExpectedInvoiceTotalMinor !== null &&
        invoiceTotalMinor !== null &&
        Math.abs(invoiceTotalMinor - input.recordExpectedInvoiceTotalMinor) <= 1
      ),
    },
  };
}

function mapCandidateInvoices(input: {
  rows: ProviderInvoiceRecord[];
  recordProviderUuid: string | null;
  recordProviderInvoiceId: string | null;
  recordExpectedInvoiceTotalMinor: number | null;
}) {
  return input.rows.slice(0, MAX_CANDIDATE_INVOICES).map((invoice) => mapCandidateInvoice({
    invoice,
    recordProviderUuid: input.recordProviderUuid,
    recordProviderInvoiceId: input.recordProviderInvoiceId,
    recordExpectedInvoiceTotalMinor: input.recordExpectedInvoiceTotalMinor,
  }));
}

function getInvoiceTotalMinor(invoice: ProviderInvoiceRecord) {
  const amount = readRecordNumber(invoice, ['amount', 'total', 'totalAmount', 'grandTotal', 'payableAmount', 'netTotal']);
  return amount === null ? null : Math.round(amount * 100);
}

function getExpectedInvoiceTotalMinor(requestSnapshotJson: unknown) {
  if (!isRecord(requestSnapshotJson) || !isRecord(requestSnapshotJson.logoPayload)) {
    return null;
  }
  const details = requestSnapshotJson.logoPayload.salesInvoiceDetails;
  if (!Array.isArray(details)) {
    return null;
  }
  const total = details.reduce((sum, raw) => {
    if (!isRecord(raw)) {
      return null;
    }
    if (sum === null) {
      return null;
    }
    const price = readNumber(raw.price);
    const quantity = readNumber(raw.quantity) ?? 1;
    const taxRate = readNumber(raw.taxRate) ?? 0;
    if (price === null || quantity === null) {
      return null;
    }
    return sum + (price * quantity * (1 + taxRate / 100));
  }, 0 as number | null);
  return total === null ? null : Math.round(total * 100);
}

function mapFields(
  invoice: ProviderInvoiceRecord | null,
  record: { providerUuid: string | null; providerInvoiceId: string | null; providerEttn: string | null },
): LogoOutgoingInvoiceSyncPreviewResult['mappedFields'] {
  if (!invoice) {
    return buildEmptyResult({}).mappedFields;
  }
  const matchedInvoice = mapMatchedInvoice(invoice);
  const invoiceNumber = findInvoiceNumber(invoice);
  const gibStatus = readGibStatus(invoice);
  const documentStatus = readDocumentStatus(invoice);
  return {
    providerUuid: matchedInvoice.uuid ?? matchedInvoice.uuId ?? record.providerUuid,
    providerInvoiceId: matchedInvoice.id ?? matchedInvoice.invoiceId ?? matchedInvoice.salesInvoiceId ?? record.providerInvoiceId,
    providerEttn: readRecordString(invoice, ['ettn', 'ETTN', 'eTtn']) ?? matchedInvoice.uuid ?? matchedInvoice.uuId ?? record.providerEttn,
    gibStatus: gibStatus.status,
    gibStatusCode: gibStatus.code,
    documentStatus: documentStatus.status,
    documentStatusCode: documentStatus.code,
    documentType: matchedInvoice.eGovermentType ?? matchedInvoice.eType,
    invoiceDate: matchedInvoice.date ?? matchedInvoice.issueDate,
    invoiceTotalMinor: getInvoiceTotalMinor(invoice),
    invoiceCurrency: matchedInvoice.currency,
    invoiceNoCandidate: invoiceNumber.value,
    invoiceNumberAvailable: Boolean(invoiceNumber.value),
    invoiceNumberSource: invoiceNumber.source,
    invoiceNumberRecoveryPossible: Boolean(matchedInvoice.id ?? matchedInvoice.invoiceId ?? matchedInvoice.salesInvoiceId),
  };
}

function safeProviderFields(rows: ProviderInvoiceRecord[]) {
  return uniqueStrings(rows.flatMap((row) => Object.keys(row)))
    .filter((key) => !/(access|refresh)?token|password|secret|api[_-]?key|authorization|raw(payload|body|response)?/i.test(key))
    .sort();
}

async function fetchSalesInvoicePages(input: {
  client: LogoOutgoingInvoiceClient;
  session: LogoIsbasiAuthenticatedSession;
  dateStart: string;
  dateEnd: string;
}) {
  const rows: ProviderInvoiceRecord[] = [];
  let totalProviderCount = 0;
  let pagesChecked = 0;

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const result: LogoIsbasiRawResult = await input.client.listSalesInvoices(input.session, {
      dateStart: input.dateStart,
      dateEnd: input.dateEnd,
      page,
      pageSize: PAGE_SIZE,
    });
    pagesChecked = page;

    if (!result.ok || result.jsonParseFailed) {
      throw new Error(
        result.jsonParseFailed
          ? 'Logo İşbaşı sales invoice list returned a non-JSON response.'
          : `Logo İşbaşı sales invoice list failed with HTTP ${result.status}.`,
      );
    }

    const pageRows = extractProviderRows(result.body);
    rows.push(...pageRows);
    totalProviderCount = Math.max(totalProviderCount, extractProviderCount(result.body, rows.length));

    if (pageRows.length < PAGE_SIZE || rows.length >= totalProviderCount) {
      break;
    }
  }

  return {
    rows,
    totalProviderCount: totalProviderCount || rows.length,
    pagesChecked,
  };
}

function invoiceMatchesRecord(input: {
  invoice: ProviderInvoiceRecord;
  recordProviderInvoiceId: string | null;
  recordProviderUuid: string | null;
}) {
  const invoice = mapMatchedInvoice(input.invoice);
  const providerInvoiceId = normalizeComparable(input.recordProviderInvoiceId);
  const providerUuid = normalizeComparable(input.recordProviderUuid);
  const idMatches = Boolean(
    providerInvoiceId &&
    [
      invoice.id,
      invoice.invoiceId,
      invoice.salesInvoiceId,
    ].some((value) => normalizeComparable(value) === providerInvoiceId),
  );
  const uuidMatches = Boolean(
    providerUuid &&
    [
      invoice.uuid,
      invoice.uuId,
    ].some((value) => normalizeComparable(value) === providerUuid),
  );
  return idMatches || uuidMatches;
}

export async function previewSettlementLogoOutgoingInvoiceSync(
  settlementCommissionInvoiceId: string,
  options: LogoOutgoingInvoiceSyncPreviewOptions,
): Promise<LogoOutgoingInvoiceSyncPreviewResult> {
  const record = await prisma.settlementCommissionInvoice.findUnique({
    where: { id: settlementCommissionInvoiceId },
    select: {
      id: true,
      createdAt: true,
      provider: true,
      status: true,
      providerInvoiceId: true,
      providerUuid: true,
      providerEttn: true,
      invoiceNo: true,
      requestSnapshotJson: true,
    },
  });

  const now = options.now ?? new Date();
  const dateStart = addDays(record?.createdAt ?? now, -SEARCH_START_OFFSET_DAYS).toISOString();
  const dateEnd = addDays(now, SEARCH_END_OFFSET_DAYS).toISOString();
  const expectedInvoiceTotalMinor = getExpectedInvoiceTotalMinor(record?.requestSnapshotJson);
  const recordDto = record
    ? {
        id: record.id,
        status: record.status,
        providerUuid: record.providerUuid,
        invoiceNo: record.invoiceNo,
        providerInvoiceId: record.providerInvoiceId,
        providerEttn: record.providerEttn,
        expectedInvoiceTotalMinor,
      }
    : null;

  if (!record) {
    return buildEmptyResult({
      dateStart,
      dateEnd,
      blockers: ['SettlementCommissionInvoice record could not be found.'],
    });
  }

  if (record.provider !== SettlementCommissionInvoiceProvider.LOGO_ISBASI) {
    return buildEmptyResult({
      record: recordDto,
      dateStart,
      dateEnd,
      blockers: ['SettlementCommissionInvoice provider must be LOGO_ISBASI before Logo sales invoice sync preview.'],
    });
  }

  if (record.status !== SettlementCommissionInvoiceStatus.CREATED) {
    return buildEmptyResult({
      record: recordDto,
      dateStart,
      dateEnd,
      blockers: ['SettlementCommissionInvoice status must be CREATED before Logo sales invoice sync preview.'],
    });
  }

  if (!record.providerInvoiceId && !record.providerUuid) {
    return buildEmptyResult({
      record: recordDto,
      dateStart,
      dateEnd,
      blockers: ['SettlementCommissionInvoice providerInvoiceId or providerUuid is required before Logo sales invoice sync preview.'],
    });
  }

  const missingEnv = getMissingEnv(options.env);
  if (missingEnv.length) {
    return buildEmptyResult({
      record: recordDto,
      dateStart,
      dateEnd,
      blockers: [`Missing Logo İşbaşı env for sales invoice sync preview: ${missingEnv.join(', ')}.`],
    });
  }

  const client = options.client ?? buildLogoClient(options.env);
  const login = await loginForLogoRead(client);
  if (!login.ok) {
    return buildEmptyResult({
      record: recordDto,
      dateStart,
      dateEnd,
      blockers: login.blockers,
    });
  }

  const pageResult = await fetchSalesInvoicePages({
    client,
    session: login.session,
    dateStart,
    dateEnd,
  });
  const matches = pageResult.rows.filter((row) => {
    return invoiceMatchesRecord({
      invoice: row,
      recordProviderInvoiceId: record.providerInvoiceId,
      recordProviderUuid: record.providerUuid,
    });
  });
  const ambiguity = matches.length > 1;
  const matched = matches.length === 1;
  const matchedRecord = matched ? matches[0] : null;

  return {
	    ok: true,
	    writesPerformed: false,
    blockers: [],
    warnings: ambiguity
      ? ['Multiple Logo sales invoice rows matched the same provider invoice id or UUID; no mapped invoice was selected.']
      : [],
    record: recordDto,
    search: {
      dateStart,
      dateEnd,
      pagesChecked: pageResult.pagesChecked,
      totalProviderCount: pageResult.totalProviderCount,
      matched,
      ambiguity,
    },
    matchedInvoice: matchedRecord ? mapMatchedInvoice(matchedRecord) : null,
    candidateInvoices: mapCandidateInvoices({
      rows: pageResult.rows,
      recordProviderUuid: record.providerUuid,
      recordProviderInvoiceId: record.providerInvoiceId,
      recordExpectedInvoiceTotalMinor: expectedInvoiceTotalMinor,
    }),
    providerFieldsObserved: safeProviderFields(matched ? [matchedRecord!] : pageResult.rows),
    mappedFields: mapFields(matchedRecord, recordDto!),
  };
}

function buildBlockedSyncResult(input: {
  settlementCommissionInvoiceId: string;
  blockers: string[];
  warnings?: string[];
  preview?: LogoOutgoingInvoiceSyncPreviewResult | null;
}): PersistSettlementLogoSalesInvoiceSyncResult {
  return {
    ok: false,
    writesPerformed: false,
    settlementCommissionInvoiceId: input.settlementCommissionInvoiceId,
    status: 'blocked',
    blockers: Array.from(new Set(input.blockers)),
    warnings: Array.from(new Set(input.warnings ?? [])),
    record: null,
    preview: input.preview ?? null,
  };
}

function codeToString(value: number | null | undefined) {
  return value === null || value === undefined ? null : String(value);
}

function findMatchedBy(preview: LogoOutgoingInvoiceSyncPreviewResult) {
  const providerInvoiceId = normalizeComparable(preview.record?.providerInvoiceId);
  const providerUuid = normalizeComparable(preview.record?.providerUuid);
  const invoice = preview.matchedInvoice;
  if (
    providerInvoiceId &&
    [
      invoice?.id,
      invoice?.invoiceId,
      invoice?.salesInvoiceId,
    ].some((value) => normalizeComparable(value) === providerInvoiceId)
  ) {
    return 'providerInvoiceId';
  }
  if (
    providerUuid &&
    [
      invoice?.uuid,
      invoice?.uuId,
    ].some((value) => normalizeComparable(value) === providerUuid)
  ) {
    return 'providerUuid';
  }
  return preview.mappedFields.providerInvoiceId ? 'providerInvoiceId' : 'providerUuid';
}

function buildSyncEvidence(input: {
  preview: LogoOutgoingInvoiceSyncPreviewResult;
  syncedAt: Date;
}): Prisma.InputJsonObject {
  const mapped = input.preview.mappedFields;
  return {
    source: 'LOGO_SALES_INVOICE_LIST',
    sourceEndpoint: '/api/v1.0/invoices/invoices',
    reconciliationStatus: 'MATCHED_FROM_LOGO_SALES_INVOICE',
    matched: input.preview.search.matched,
    ambiguity: input.preview.search.ambiguity,
    matchedBy: findMatchedBy(input.preview),
    matchedInvoiceId: mapped.providerInvoiceId,
    matchedInvoiceNumber: mapped.invoiceNoCandidate,
    matchedInvoiceDate: mapped.invoiceDate,
    matchedInvoiceTotalMinor: mapped.invoiceTotalMinor,
    matchedInvoiceCurrency: mapped.invoiceCurrency,
    providerUuid: mapped.providerUuid,
    providerEttn: mapped.providerEttn,
    gibStatus: mapped.gibStatus,
    gibStatusCode: codeToString(mapped.gibStatusCode),
    documentStatus: mapped.documentStatus,
    documentStatusCode: codeToString(mapped.documentStatusCode),
    documentType: mapped.documentType,
    invoiceNumberSource: mapped.invoiceNumberSource,
    search: {
      dateStart: input.preview.search.dateStart,
      dateEnd: input.preview.search.dateEnd,
      pagesChecked: input.preview.search.pagesChecked,
      totalProviderCount: input.preview.search.totalProviderCount,
    },
    syncedAt: input.syncedAt.toISOString(),
  };
}

export async function persistSettlementLogoSalesInvoiceSync(
  settlementCommissionInvoiceId: string,
  options: PersistSettlementLogoSalesInvoiceSyncOptions,
): Promise<PersistSettlementLogoSalesInvoiceSyncResult> {
  const preview = await previewSettlementLogoOutgoingInvoiceSync(settlementCommissionInvoiceId, options);

  if (!preview.ok || preview.blockers.length) {
    return buildBlockedSyncResult({
      settlementCommissionInvoiceId,
      blockers: preview.blockers.length ? preview.blockers : ['Logo sales invoice sync preview did not pass.'],
      warnings: preview.warnings,
      preview,
    });
  }

  if (preview.search.ambiguity) {
    return buildBlockedSyncResult({
      settlementCommissionInvoiceId,
      blockers: ['Logo sales invoice sync cannot be persisted because multiple Logo sales invoices matched this record.'],
      warnings: preview.warnings,
      preview,
    });
  }

  if (!preview.search.matched) {
    return buildBlockedSyncResult({
      settlementCommissionInvoiceId,
      blockers: ['Logo sales invoice sync cannot be persisted because no matching Logo sales invoice was found.'],
      warnings: preview.warnings,
      preview,
    });
  }

  const existingInvoiceNo = readString(preview.record?.invoiceNo);
  const incomingInvoiceNo = readString(preview.mappedFields.invoiceNoCandidate);
  if (existingInvoiceNo && incomingInvoiceNo && existingInvoiceNo !== incomingInvoiceNo) {
    return buildBlockedSyncResult({
      settlementCommissionInvoiceId,
      blockers: ['Existing invoiceNo differs from the Logo sales invoice match; sync is blocked to prevent overwrite.'],
      warnings: preview.warnings,
      preview,
    });
  }

  const existingProviderInvoiceId = normalizeComparable(preview.record?.providerInvoiceId);
  const incomingProviderInvoiceId = normalizeComparable(preview.mappedFields.providerInvoiceId);
  if (existingProviderInvoiceId && incomingProviderInvoiceId && existingProviderInvoiceId !== incomingProviderInvoiceId) {
    return buildBlockedSyncResult({
      settlementCommissionInvoiceId,
      blockers: ['Existing providerInvoiceId differs from the Logo sales invoice match; sync is blocked to prevent wrong invoice linkage.'],
      warnings: preview.warnings,
      preview,
    });
  }

  const syncedAt = options.now ?? new Date();
  const record = await applySettlementCommissionInvoiceReconciliation({
    settlementCommissionInvoiceId,
    reconciliationStatus: 'MATCHED_FROM_LOGO_SALES_INVOICE',
    reconciliationEvidenceJson: buildSyncEvidence({ preview, syncedAt }),
    providerInvoiceId: preview.mappedFields.providerInvoiceId,
    providerUuid: preview.mappedFields.providerUuid ?? preview.record?.providerUuid ?? null,
    providerEttn: preview.mappedFields.providerEttn,
    invoiceNo: preview.mappedFields.invoiceNoCandidate,
    invoiceDate: preview.mappedFields.invoiceDate,
    invoiceTotalMinor: preview.mappedFields.invoiceTotalMinor,
    invoiceCurrency: preview.mappedFields.invoiceCurrency,
    gibStatus: preview.mappedFields.gibStatus,
    gibStatusCode: codeToString(preview.mappedFields.gibStatusCode),
    documentStatus: preview.mappedFields.documentStatus,
    documentStatusCode: codeToString(preview.mappedFields.documentStatusCode),
    documentType: preview.mappedFields.documentType,
    lastProviderSyncedAt: syncedAt,
    reconciledBy: options.syncedBy ?? 'system',
  });

  return {
    ok: true,
    writesPerformed: true,
    settlementCommissionInvoiceId,
    status: 'synced',
    blockers: [],
    warnings: preview.warnings,
    record,
    preview,
  };
}
