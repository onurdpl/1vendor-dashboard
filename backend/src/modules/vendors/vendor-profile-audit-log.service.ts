import { Prisma, VendorProfileSnapshotImpact } from '@prisma/client';
import { prisma } from '../../db/prisma.js';

export type VendorProfileAuditActor = {
  userId?: string | null;
  email?: string | null;
};

export type VendorProfileAuditSection =
  | 'vendor_status'
  | 'finance_policy'
  | 'billing_legal_profile'
  | 'logo_binding'
  | 'shipping_operations';

export type VendorProfileAuditSource =
  | 'admin_vendor_status_update'
  | 'admin_finance_policy_update'
  | 'admin_billing_profile_update'
  | 'logo_isbasi_firm_bind'
  | 'admin_shipping_config_update'
  | 'system';

export type VendorProfileAuditLogDto = {
  id: string;
  vendorId: string;
  section: VendorProfileAuditSection | string;
  fieldName: string;
  oldValue: unknown;
  newValue: unknown;
  changedByUserId: string | null;
  changedByEmail: string | null;
  changedAt: string;
  reason: string | null;
  snapshotImpact: VendorProfileSnapshotImpact;
  source: string;
};

export type AuditVendorProfileChangesInput = {
  vendorId: string;
  section: VendorProfileAuditSection;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  fields?: string[];
  actor?: VendorProfileAuditActor | null;
  reason?: string | null;
  source?: VendorProfileAuditSource | string;
};

const FINANCE_POLICY_FIELDS = new Set([
  'commissionPercent',
  'commissionVatPercent',
  'deductShippingEnabled',
  'shippingMode',
  'fixedShippingFee',
  'settlementDelayDays',
]);

const SETTLEMENT_SCHEDULE_FIELDS = new Set([
  'settlementFrequencyType',
  'weeklySettlementDay',
  'autoSettlementDraftEnabled',
  'autoSettlementApproveEnabled',
]);

const BILLING_LEGAL_FIELDS = new Set([
  'legalCompanyName',
  'taxNumber',
  'taxOffice',
  'billingAddress',
  'billingCity',
  'billingDistrict',
  'billingEmail',
  'billingPhone',
  'authorizedPerson',
  'legalEntityType',
]);

const LOGO_BINDING_FIELDS = new Set([
  'logoIsbasiCustomerCode',
  'logoIsbasiCustomerId',
  'logoIsbasiEinvoiceEligible',
  'logoIsbasiLastCheckedAt',
]);

const SAFE_PROVIDER_METADATA_PREFIXES = [
  'kargonomi',
  'navlungo',
  'tryOto',
  'try_oto',
  'packageType',
  'sender',
  'returnRecipient',
  'return_receiver',
  'returnReceiver',
  'barcodeFormat',
  'carrierId',
];

const SECRET_FIELD_PATTERN = /password|secret|token|api[_-]?key|authorization|cookie|credential/i;
const MASKED_FIELD_PATTERN = /taxnumber|tckn|vkn|iban|billingemail|email|billingphone|phone|billingaddress|address/i;

function hasAuditDelegate() {
  return Boolean((prisma as unknown as { vendorProfileAuditLog?: unknown }).vendorProfileAuditLog);
}

function stableJson(value: unknown): string {
  if (value === null || value === undefined) {
    return 'null';
  }
  if (typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (value instanceof Date) {
    return JSON.stringify(value.toISOString());
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`;
  }
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
    .join(',')}}`;
}

function normalizeComparableValue(value: unknown): unknown {
  if (value === undefined || value === null) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'string') {
    return value.trim() || null;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(normalizeComparableValue);
  }
  if (typeof value === 'object') {
    if ('toNumber' in value && typeof (value as { toNumber: () => number }).toNumber === 'function') {
      return normalizeComparableValue((value as { toNumber: () => number }).toNumber());
    }
    if ('toISOString' in value && typeof (value as { toISOString: () => string }).toISOString === 'function') {
      return (value as { toISOString: () => string }).toISOString();
    }
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, normalizeComparableValue(item)]),
    );
  }
  return String(value);
}

function maskMiddle(value: string, visibleEnd = 4) {
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }
  if (normalized.length <= visibleEnd) {
    return '*'.repeat(normalized.length);
  }
  return `${'*'.repeat(Math.max(4, normalized.length - visibleEnd))}${normalized.slice(-visibleEnd)}`;
}

function maskEmail(value: string) {
  const [local, domain] = value.trim().split('@');
  if (!local || !domain) {
    return maskMiddle(value);
  }
  return `${local.slice(0, 1)}***@${domain}`;
}

function sanitizeValueForAudit(fieldName: string, value: unknown): Prisma.InputJsonValue | null {
  const normalized = normalizeComparableValue(value);
  if (normalized === null) {
    return null;
  }

  if (SECRET_FIELD_PATTERN.test(fieldName)) {
    return '[redacted]';
  }

  const compactFieldName = fieldName.replace(/[^a-z0-9]/gi, '').toLowerCase();
  if (typeof normalized === 'string' && MASKED_FIELD_PATTERN.test(compactFieldName)) {
    if (compactFieldName.includes('email')) {
      return maskEmail(normalized);
    }
    if (compactFieldName.includes('address')) {
      return '[address value changed]';
    }
    return maskMiddle(normalized);
  }

  if (
    typeof normalized === 'string' ||
    typeof normalized === 'number' ||
    typeof normalized === 'boolean'
  ) {
    return normalized;
  }

  return JSON.parse(stableJson(normalized)) as Prisma.InputJsonValue;
}

function toPrismaJson(value: Prisma.InputJsonValue | null) {
  return value === null ? Prisma.JsonNull : value;
}

function fieldImpact(section: VendorProfileAuditSection, fieldName: string): VendorProfileSnapshotImpact {
  if (section === 'vendor_status') {
    return VendorProfileSnapshotImpact.UNKNOWN;
  }

  if (SETTLEMENT_SCHEDULE_FIELDS.has(fieldName)) {
    return VendorProfileSnapshotImpact.FUTURE_SETTLEMENT_APPROVALS_ONLY;
  }

  if (fieldName === 'autoSettlementInvoiceEnabled') {
    return VendorProfileSnapshotImpact.FUTURE_COMMISSION_INVOICES_ONLY;
  }

  if (FINANCE_POLICY_FIELDS.has(fieldName)) {
    return VendorProfileSnapshotImpact.FUTURE_LEDGER_ROWS_ONLY;
  }

  if (fieldName === 'active') {
    return VendorProfileSnapshotImpact.UNKNOWN;
  }

  if (BILLING_LEGAL_FIELDS.has(fieldName)) {
    return VendorProfileSnapshotImpact.FUTURE_SETTLEMENT_APPROVALS_ONLY;
  }

  if (fieldName === 'iban') {
    return VendorProfileSnapshotImpact.FUTURE_PAYOUT_RELEVANT;
  }

  if (fieldName === 'logoIsbasiCustomerCode' || fieldName === 'logoIsbasiCustomerId') {
    return VendorProfileSnapshotImpact.PROVIDER_REBIND_REQUIRED;
  }

  if (LOGO_BINDING_FIELDS.has(fieldName)) {
    return VendorProfileSnapshotImpact.FUTURE_COMMISSION_INVOICES_ONLY;
  }

  if (fieldName === 'shippingVatPercent') {
    return VendorProfileSnapshotImpact.UNKNOWN;
  }

  if (
    fieldName === 'cargoIntegrationId' ||
    fieldName.startsWith('providerMetadata.tryOto') ||
    fieldName.startsWith('providerMetadata.navlungoSender') ||
    fieldName.startsWith('providerMetadata.navlungoCarrier') ||
    fieldName.startsWith('providerMetadata.navlungoBarcode') ||
    fieldName.startsWith('providerMetadata.kargonomiBuyer') ||
    fieldName.startsWith('providerMetadata.kargonomiShipping')
  ) {
    return VendorProfileSnapshotImpact.FUTURE_SHIPMENTS_ONLY;
  }

  if (
    fieldName.startsWith('providerMetadata.kargonomiReturn') ||
    fieldName.startsWith('providerMetadata.navlungoReturn')
  ) {
    return VendorProfileSnapshotImpact.FUTURE_RETURNS_ONLY;
  }

  if (
    section === 'shipping_operations' ||
    fieldName === 'preferredProvider' ||
    fieldName === 'shippingEnabled' ||
    fieldName === 'defaultDesi' ||
    fieldName === 'defaultWarehouseId' ||
    fieldName.startsWith('warehouses.') ||
    fieldName.startsWith('providerMetadata.kargonomi') ||
    fieldName.startsWith('providerMetadata.navlungo') ||
    fieldName.startsWith('providerMetadata.packageType')
  ) {
    return VendorProfileSnapshotImpact.FUTURE_SHIPMENTS_AND_RETURNS_ONLY;
  }

  return VendorProfileSnapshotImpact.UNKNOWN;
}

function pickPath(source: Record<string, unknown> | null, path: string): unknown {
  if (!source) {
    return null;
  }
  return path.split('.').reduce<unknown>((current, segment) => {
    if (!current || typeof current !== 'object') {
      return null;
    }
    return (current as Record<string, unknown>)[segment] ?? null;
  }, source);
}

function flattenProviderMetadataFields(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
) {
  const beforeMetadata = normalizeComparableValue(before?.providerMetadata) as Record<string, unknown> | null;
  const afterMetadata = normalizeComparableValue(after?.providerMetadata) as Record<string, unknown> | null;
  const keys = new Set([
    ...Object.keys(beforeMetadata ?? {}),
    ...Object.keys(afterMetadata ?? {}),
  ]);
  return Array.from(keys)
    .filter((key) => SAFE_PROVIDER_METADATA_PREFIXES.some((prefix) => key.startsWith(prefix)))
    .map((key) => `providerMetadata.${key}`);
}

function warehouseKey(warehouse: Record<string, unknown>) {
  const provider = typeof warehouse.provider === 'string' ? warehouse.provider : 'provider';
  const warehouseId = typeof warehouse.warehouseId === 'string' || typeof warehouse.warehouseId === 'number'
    ? String(warehouse.warehouseId)
    : 'unknown';
  return `${provider}.${warehouseId}`;
}

function mapWarehouses(value: unknown) {
  if (!Array.isArray(value)) {
    return new Map<string, Record<string, unknown>>();
  }
  return new Map(
    value
      .filter((warehouse): warehouse is Record<string, unknown> => Boolean(warehouse) && typeof warehouse === 'object')
      .map((warehouse) => [warehouseKey(warehouse), normalizeComparableValue(warehouse) as Record<string, unknown>]),
  );
}

function flattenWarehouseFields(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
) {
  const beforeWarehouses = mapWarehouses(before?.warehouses);
  const afterWarehouses = mapWarehouses(after?.warehouses);
  const warehouseKeys = new Set([...beforeWarehouses.keys(), ...afterWarehouses.keys()]);
  const fields: string[] = [];

  for (const key of warehouseKeys) {
    const beforeWarehouse = beforeWarehouses.get(key) ?? {};
    const afterWarehouse = afterWarehouses.get(key) ?? {};
    for (const field of ['warehouseId', 'provider', 'name', 'address', 'isDefault']) {
      const beforeValue = beforeWarehouse[field] ?? null;
      const afterValue = afterWarehouse[field] ?? null;
      if (stableJson(beforeValue) !== stableJson(afterValue)) {
        fields.push(`warehouses.${key}.${field}`);
      }
    }
  }

  return fields;
}

function pickFlattenedValue(source: Record<string, unknown> | null, fieldName: string) {
  if (fieldName.startsWith('providerMetadata.')) {
    return pickPath(source, fieldName);
  }

  if (fieldName.startsWith('warehouses.')) {
    const [, provider, warehouseId, field] = fieldName.split('.');
    const warehouses = mapWarehouses(source?.warehouses);
    return warehouses.get(`${provider}.${warehouseId}`)?.[field] ?? null;
  }

  return source?.[fieldName] ?? null;
}

function resolveFields(input: AuditVendorProfileChangesInput) {
  if (input.fields?.length) {
    return input.fields;
  }

  const baseFields = new Set([
    ...Object.keys(input.before ?? {}),
    ...Object.keys(input.after ?? {}),
  ]);
  baseFields.delete('id');
  baseFields.delete('vendorId');
  baseFields.delete('createdAt');
  baseFields.delete('updatedAt');
  baseFields.delete('source');
  baseFields.delete('providerMetadata');
  baseFields.delete('warehouses');

  return [
    ...Array.from(baseFields),
    ...flattenProviderMetadataFields(input.before, input.after),
    ...flattenWarehouseFields(input.before, input.after),
  ];
}

function valuesChanged(beforeValue: unknown, afterValue: unknown) {
  return stableJson(normalizeComparableValue(beforeValue)) !== stableJson(normalizeComparableValue(afterValue));
}

export async function auditVendorProfileChanges(input: AuditVendorProfileChangesInput) {
  const delegate = (prisma as unknown as {
    vendorProfileAuditLog?: {
      createMany: (args: { data: Array<Record<string, unknown>> }) => Promise<unknown>;
    };
  }).vendorProfileAuditLog;

  if (!delegate || !hasAuditDelegate()) {
    return { created: 0 };
  }

  const fields = resolveFields(input);
  const rows = fields.flatMap((fieldName) => {
    const beforeValue = pickFlattenedValue(input.before, fieldName);
    const afterValue = pickFlattenedValue(input.after, fieldName);
    if (!valuesChanged(beforeValue, afterValue)) {
      return [];
    }

    return [{
      vendorId: input.vendorId,
      section: input.section,
      fieldName,
      oldValue: toPrismaJson(sanitizeValueForAudit(fieldName, beforeValue)),
      newValue: toPrismaJson(sanitizeValueForAudit(fieldName, afterValue)),
      changedByUserId: input.actor?.userId ?? null,
      changedByEmail: input.actor?.email ?? null,
      reason: input.reason ?? null,
      snapshotImpact: fieldImpact(input.section, fieldName),
      source: input.source ?? 'system',
    }];
  });

  if (!rows.length) {
    return { created: 0 };
  }

  await delegate.createMany({ data: rows });
  return { created: rows.length };
}

export async function listVendorProfileAuditLogs(
  vendorId: string,
  options: {
    section?: string | null;
    limit?: number | null;
  } = {},
): Promise<VendorProfileAuditLogDto[]> {
  const limit = Math.max(1, Math.min(100, Math.round(options.limit ?? 50)));
  const logs = await prisma.vendorProfileAuditLog.findMany({
    where: {
      vendorId,
      ...(options.section ? { section: options.section } : {}),
    },
    orderBy: {
      changedAt: 'desc',
    },
    take: limit,
  });

  return logs.map((log) => ({
    id: log.id,
    vendorId: log.vendorId,
    section: log.section,
    fieldName: log.fieldName,
    oldValue: log.oldValue,
    newValue: log.newValue,
    changedByUserId: log.changedByUserId,
    changedByEmail: log.changedByEmail,
    changedAt: log.changedAt.toISOString(),
    reason: log.reason,
    snapshotImpact: log.snapshotImpact,
    source: log.source,
  }));
}

export const __vendorProfileAuditLogTesting = {
  fieldImpact,
  normalizeComparableValue,
  sanitizeValueForAudit,
};
