import type { Prisma, VendorBillingProfile } from '@prisma/client';
import type { VendorBillingProfileDto } from '../vendors/vendor-billing-profile.service.js';

export const SETTLEMENT_BILLING_SNAPSHOT_MISSING_BLOCKER =
  'Settlement billing snapshot is missing. Historical invoice execution cannot be guaranteed.';

export const SETTLEMENT_BILLING_SNAPSHOT_READINESS_SOURCE = 'settlement_approval' as const;

export type SettlementBillingSnapshot = {
  version: 1;
  source: 'vendor_billing_profile';
  capturedAt: string;
  vendorId: string;
  vendorBillingProfileId: string;
  legalCompanyName: string | null;
  taxNumber: string | null;
  taxOffice: string | null;
  billingAddress: string | null;
  billingCity: string | null;
  billingDistrict: string | null;
  authorizedPerson: string | null;
  billingEmail: string | null;
  billingPhone: string | null;
  legalEntityType: string | null;
  logoIsbasiCustomerCode: string | null;
  logoIsbasiCustomerId: string | null;
  logoIsbasiEinvoiceEligible: boolean | null;
  logoIsbasiLastCheckedAt: string | null;
};

function nullableString(value: string | null | undefined) {
  return typeof value === 'string' ? value : null;
}

function dateToIso(value: Date | null | undefined) {
  return value instanceof Date ? value.toISOString() : null;
}

function readSnapshotRecord(value: unknown): Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readSnapshotString(value: unknown) {
  return typeof value === 'string' ? value : null;
}

function readSnapshotBoolean(value: unknown) {
  return typeof value === 'boolean' ? value : null;
}

export function buildSettlementBillingSnapshot(
  profile: VendorBillingProfile | null | undefined,
  capturedAt: Date = new Date(),
): Prisma.InputJsonObject | null {
  if (!profile) {
    return null;
  }

  return {
    version: 1,
    source: 'vendor_billing_profile',
    capturedAt: capturedAt.toISOString(),
    vendorId: profile.vendorId,
    vendorBillingProfileId: profile.id,
    legalCompanyName: nullableString(profile.legalCompanyName),
    taxNumber: nullableString(profile.taxNumber),
    taxOffice: nullableString(profile.taxOffice),
    billingAddress: nullableString(profile.billingAddress),
    billingCity: nullableString(profile.billingCity),
    billingDistrict: nullableString(profile.billingDistrict),
    authorizedPerson: nullableString(profile.authorizedPerson),
    billingEmail: nullableString(profile.billingEmail),
    billingPhone: nullableString(profile.billingPhone),
    legalEntityType: nullableString(profile.legalEntityType),
    logoIsbasiCustomerCode: nullableString(profile.logoIsbasiCustomerCode),
    logoIsbasiCustomerId: nullableString(profile.logoIsbasiCustomerId),
    logoIsbasiEinvoiceEligible: typeof profile.logoIsbasiEinvoiceEligible === 'boolean' ? profile.logoIsbasiEinvoiceEligible : null,
    logoIsbasiLastCheckedAt: dateToIso(profile.logoIsbasiLastCheckedAt),
  };
}

export function readSettlementBillingSnapshot(sourceSnapshotJson: unknown): SettlementBillingSnapshot | null {
  const sourceSnapshot = readSnapshotRecord(sourceSnapshotJson);
  const snapshot = readSnapshotRecord(sourceSnapshot.settlementBillingSnapshot);
  if (
    snapshot.version !== 1 ||
    snapshot.source !== 'vendor_billing_profile' ||
    typeof snapshot.capturedAt !== 'string' ||
    typeof snapshot.vendorId !== 'string' ||
    typeof snapshot.vendorBillingProfileId !== 'string'
  ) {
    return null;
  }

  return {
    version: 1,
    source: 'vendor_billing_profile',
    capturedAt: snapshot.capturedAt,
    vendorId: snapshot.vendorId,
    vendorBillingProfileId: snapshot.vendorBillingProfileId,
    legalCompanyName: readSnapshotString(snapshot.legalCompanyName),
    taxNumber: readSnapshotString(snapshot.taxNumber),
    taxOffice: readSnapshotString(snapshot.taxOffice),
    billingAddress: readSnapshotString(snapshot.billingAddress),
    billingCity: readSnapshotString(snapshot.billingCity),
    billingDistrict: readSnapshotString(snapshot.billingDistrict),
    authorizedPerson: readSnapshotString(snapshot.authorizedPerson),
    billingEmail: readSnapshotString(snapshot.billingEmail),
    billingPhone: readSnapshotString(snapshot.billingPhone),
    legalEntityType: readSnapshotString(snapshot.legalEntityType),
    logoIsbasiCustomerCode: readSnapshotString(snapshot.logoIsbasiCustomerCode),
    logoIsbasiCustomerId: readSnapshotString(snapshot.logoIsbasiCustomerId),
    logoIsbasiEinvoiceEligible: readSnapshotBoolean(snapshot.logoIsbasiEinvoiceEligible),
    logoIsbasiLastCheckedAt: readSnapshotString(snapshot.logoIsbasiLastCheckedAt),
  };
}

export function mapSettlementBillingSnapshotToVendorBillingProfileDto(
  snapshot: SettlementBillingSnapshot,
): VendorBillingProfileDto {
  return {
    id: snapshot.vendorBillingProfileId,
    vendorId: snapshot.vendorId,
    legalCompanyName: snapshot.legalCompanyName,
    taxNumber: snapshot.taxNumber,
    taxOffice: snapshot.taxOffice,
    billingAddress: snapshot.billingAddress,
    billingCity: snapshot.billingCity,
    billingDistrict: snapshot.billingDistrict,
    iban: null,
    authorizedPerson: snapshot.authorizedPerson,
    billingEmail: snapshot.billingEmail,
    billingPhone: snapshot.billingPhone,
    legalEntityType: snapshot.legalEntityType,
    logoIsbasiCustomerCode: snapshot.logoIsbasiCustomerCode,
    logoIsbasiCustomerId: snapshot.logoIsbasiCustomerId,
    logoIsbasiEinvoiceEligible: snapshot.logoIsbasiEinvoiceEligible,
    logoIsbasiLastCheckedAt: snapshot.logoIsbasiLastCheckedAt,
    createdAt: snapshot.capturedAt,
    updatedAt: snapshot.capturedAt,
  };
}
