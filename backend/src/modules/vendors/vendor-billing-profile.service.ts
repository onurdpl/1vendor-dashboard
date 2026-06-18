import type { VendorBillingProfile } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import {
  auditVendorProfileChanges,
  type VendorProfileAuditActor,
} from './vendor-profile-audit-log.service.js';

export type VendorBillingProfileDto = {
  id: string;
  vendorId: string;
  legalCompanyName: string | null;
  taxNumber: string | null;
  taxOffice: string | null;
  billingAddress: string | null;
  billingCity: string | null;
  billingDistrict: string | null;
  iban: string | null;
  authorizedPerson: string | null;
  billingEmail: string | null;
  billingPhone: string | null;
  legalEntityType: string | null;
  logoIsbasiCustomerCode: string | null;
  logoIsbasiCustomerId: string | null;
  logoIsbasiEinvoiceEligible: boolean | null;
  logoIsbasiLastCheckedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type VendorBillingProfileInputDto = {
  legalCompanyName?: unknown;
  taxNumber?: unknown;
  taxOffice?: unknown;
  billingAddress?: unknown;
  billingCity?: unknown;
  billingDistrict?: unknown;
  iban?: unknown;
  authorizedPerson?: unknown;
  billingEmail?: unknown;
  billingPhone?: unknown;
  legalEntityType?: unknown;
  logoIsbasiCustomerCode?: unknown;
  logoIsbasiCustomerId?: unknown;
  logoIsbasiEinvoiceEligible?: unknown;
  logoIsbasiLastCheckedAt?: unknown;
};

export type VendorLogoIsbasiBindingInput = {
  logoIsbasiCustomerCode: string;
  logoIsbasiCustomerId: string;
  logoIsbasiEinvoiceEligible: boolean | null;
  logoIsbasiLastCheckedAt: Date;
};

const REQUIRED_FIELDS = ['legalCompanyName', 'taxNumber', 'taxOffice', 'billingAddress'] as const;
const OPTIONAL_FIELDS = [
  'billingCity',
  'billingDistrict',
  'iban',
  'authorizedPerson',
  'billingEmail',
  'billingPhone',
  'legalEntityType',
  'logoIsbasiCustomerCode',
] as const;

function trimRequiredString(input: VendorBillingProfileInputDto, key: (typeof REQUIRED_FIELDS)[number]) {
  const value = input[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${key} is required.`);
  }
  return value.trim();
}

function trimOptionalString(input: VendorBillingProfileInputDto, key: (typeof OPTIONAL_FIELDS)[number]) {
  const value = input[key];
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new Error(`${key} must be a string or null.`);
  }
  return value.trim() || null;
}

function mapBillingProfile(profile: VendorBillingProfile): VendorBillingProfileDto {
  return {
    id: profile.id,
    vendorId: profile.vendorId,
    legalCompanyName: profile.legalCompanyName,
    taxNumber: profile.taxNumber,
    taxOffice: profile.taxOffice,
    billingAddress: profile.billingAddress,
    billingCity: profile.billingCity,
    billingDistrict: profile.billingDistrict,
    iban: profile.iban,
    authorizedPerson: profile.authorizedPerson,
    billingEmail: profile.billingEmail,
    billingPhone: profile.billingPhone,
    legalEntityType: profile.legalEntityType,
    logoIsbasiCustomerCode: profile.logoIsbasiCustomerCode,
    logoIsbasiCustomerId: profile.logoIsbasiCustomerId,
    logoIsbasiEinvoiceEligible: profile.logoIsbasiEinvoiceEligible,
    logoIsbasiLastCheckedAt: profile.logoIsbasiLastCheckedAt?.toISOString() ?? null,
    createdAt: profile.createdAt.toISOString(),
    updatedAt: profile.updatedAt.toISOString(),
  };
}

function normalizeBillingProfileInput(input: VendorBillingProfileInputDto) {
  return {
    legalCompanyName: trimRequiredString(input, 'legalCompanyName'),
    taxNumber: trimRequiredString(input, 'taxNumber'),
    taxOffice: trimRequiredString(input, 'taxOffice'),
    billingAddress: trimRequiredString(input, 'billingAddress'),
    billingCity: trimOptionalString(input, 'billingCity'),
    billingDistrict: trimOptionalString(input, 'billingDistrict'),
    iban: trimOptionalString(input, 'iban'),
    authorizedPerson: trimOptionalString(input, 'authorizedPerson'),
    billingEmail: trimOptionalString(input, 'billingEmail'),
    billingPhone: trimOptionalString(input, 'billingPhone'),
    legalEntityType: trimOptionalString(input, 'legalEntityType'),
    logoIsbasiCustomerCode: trimOptionalString(input, 'logoIsbasiCustomerCode'),
  };
}

function normalizeLogoCustomerCodeForCompare(value: string | null | undefined) {
  return (value ?? '').trim();
}

async function assertVendorExists(vendorId: string) {
  const vendor = await prisma.vendor.findUnique({
    where: {
      id: vendorId,
    },
    select: {
      id: true,
    },
  });
  if (!vendor) {
    throw new Error('Vendor could not be found.');
  }
}

export async function getVendorBillingProfile(vendorId: string): Promise<VendorBillingProfileDto | null> {
  await assertVendorExists(vendorId);
  const profile = await prisma.vendorBillingProfile.findUnique({
    where: {
      vendorId,
    },
  });

  return profile ? mapBillingProfile(profile) : null;
}

export async function upsertVendorBillingProfile(
  vendorId: string,
  input: VendorBillingProfileInputDto,
  auditContext: {
    actor?: VendorProfileAuditActor | null;
    reason?: string | null;
    source?: string;
  } = {},
): Promise<VendorBillingProfileDto> {
  await assertVendorExists(vendorId);
  const data = normalizeBillingProfileInput(input);
  const existing = await prisma.vendorBillingProfile.findUnique({
    where: {
      vendorId,
    },
  });
  const logoCustomerCodeChanged = existing
    ? normalizeLogoCustomerCodeForCompare(existing.logoIsbasiCustomerCode) !==
      normalizeLogoCustomerCodeForCompare(data.logoIsbasiCustomerCode)
    : false;
  const updateData = logoCustomerCodeChanged
    ? {
        ...data,
        logoIsbasiCustomerId: null,
        logoIsbasiEinvoiceEligible: null,
        logoIsbasiLastCheckedAt: null,
      }
    : data;
  const profile = await prisma.vendorBillingProfile.upsert({
    where: {
      vendorId,
    },
    update: updateData,
    create: {
      vendorId,
      ...data,
    },
  });

  const mappedProfile = mapBillingProfile(profile);
  await auditVendorProfileChanges({
    vendorId,
    section: 'billing_legal_profile',
    before: existing ? mapBillingProfile(existing) as unknown as Record<string, unknown> : null,
    after: mappedProfile as unknown as Record<string, unknown>,
    fields: [
      'legalCompanyName',
      'taxNumber',
      'taxOffice',
      'billingAddress',
      'billingCity',
      'billingDistrict',
      'iban',
      'authorizedPerson',
      'billingEmail',
      'billingPhone',
      'legalEntityType',
      'logoIsbasiCustomerCode',
      'logoIsbasiCustomerId',
      'logoIsbasiEinvoiceEligible',
      'logoIsbasiLastCheckedAt',
    ],
    actor: auditContext.actor,
    reason: auditContext.reason,
    source: auditContext.source ?? 'admin_billing_profile_update',
  });

  return mappedProfile;
}

export async function bindLogoIsbasiFirmToVendor(
  vendorId: string,
  input: VendorLogoIsbasiBindingInput,
  auditContext: {
    actor?: VendorProfileAuditActor | null;
    reason?: string | null;
    source?: string;
  } = {},
): Promise<VendorBillingProfileDto> {
  await assertVendorExists(vendorId);
  const existing = await prisma.vendorBillingProfile.findUnique({
    where: {
      vendorId,
    },
  });
  const profile = await prisma.vendorBillingProfile.update({
    where: {
      vendorId,
    },
    data: {
      logoIsbasiCustomerCode: input.logoIsbasiCustomerCode,
      logoIsbasiCustomerId: input.logoIsbasiCustomerId,
      logoIsbasiEinvoiceEligible: input.logoIsbasiEinvoiceEligible,
      logoIsbasiLastCheckedAt: input.logoIsbasiLastCheckedAt,
    },
  });

  const mappedProfile = mapBillingProfile(profile);
  await auditVendorProfileChanges({
    vendorId,
    section: 'logo_binding',
    before: existing ? mapBillingProfile(existing) as unknown as Record<string, unknown> : null,
    after: mappedProfile as unknown as Record<string, unknown>,
    fields: [
      'logoIsbasiCustomerCode',
      'logoIsbasiCustomerId',
      'logoIsbasiEinvoiceEligible',
      'logoIsbasiLastCheckedAt',
    ],
    actor: auditContext.actor,
    reason: auditContext.reason,
    source: auditContext.source ?? 'logo_isbasi_firm_bind',
  });

  return mappedProfile;
}

export const __vendorBillingProfileTesting = {
  normalizeBillingProfileInput,
};
