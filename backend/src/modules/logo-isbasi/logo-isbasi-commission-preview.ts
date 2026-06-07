import type { VendorBillingProfileDto } from '../vendors/vendor-billing-profile.service.js';

export type LogoIsbasiCommissionInvoicePreviewInput = {
  vendorBillingProfile: VendorBillingProfileDto;
  commissionAmount: string;
  vatRate: string;
  currency: string;
  description: string;
  invoiceDate?: string | null;
  sourceOrderIds?: string[];
  sourcePeriod?: string | null;
};

export type LogoIsbasiCommissionInvoicePreview = {
  payload: Record<string, unknown>;
  warnings: string[];
};

const OMITTED_E_GOVERNMENT_WARNING = 'eGovernmentInvoice enum/required fields unknown; omitted in dry-run.';

function isPersonalLegalEntity(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (['person', 'personal', 'individual', 'sole_proprietorship', 'personal_company', 'sahis', 'sahis_sirketi'].includes(normalized)) {
    return true;
  }
  if (['company', 'limited_company', 'joint_stock_company', 'corporation', 'anonim_sirket', 'limited_sirket'].includes(normalized)) {
    return false;
  }
  return null;
}

function buildCustomerNameFields(profile: VendorBillingProfileDto) {
  const isPerson = isPersonalLegalEntity(profile.legalEntityType);
  const name = profile.legalCompanyName?.trim() || undefined;
  if (!name) {
    return { isPerson, fields: {} };
  }

  if (isPerson === true) {
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return {
        isPerson,
        fields: {
          firstName: parts.slice(0, -1).join(' '),
          lastName: parts.at(-1),
        },
      };
    }
  }

  return {
    isPerson,
    fields: {
      name,
    },
  };
}

function compactRecord(record: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
}

export function maskTaxNumberOrTckn(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) {
    return value;
  }
  const trimmed = value.trim();
  if (trimmed.length <= 4) {
    return '*'.repeat(trimmed.length);
  }
  return `${trimmed.slice(0, 2)}${'*'.repeat(Math.max(0, trimmed.length - 4))}${trimmed.slice(-2)}`;
}

export function sanitizeLogoIsbasiInvoicePreviewPayload(payload: Record<string, unknown>) {
  const customer = payload.customer && typeof payload.customer === 'object' && !Array.isArray(payload.customer)
    ? { ...(payload.customer as Record<string, unknown>) }
    : null;

  if (customer && 'tcknVkn' in customer) {
    customer.tcknVkn = maskTaxNumberOrTckn(customer.tcknVkn);
  }

  return {
    ...payload,
    ...(customer ? { customer } : {}),
  };
}

export function buildLogoIsbasiCommissionInvoicePreview(
  input: LogoIsbasiCommissionInvoicePreviewInput,
): LogoIsbasiCommissionInvoicePreview {
  const profile = input.vendorBillingProfile;
  const warnings = [OMITTED_E_GOVERNMENT_WARNING];
  const recommendedFields: Array<[keyof VendorBillingProfileDto, string]> = [
    ['authorizedPerson', 'authorizedPerson is missing.'],
    ['billingPhone', 'billingPhone is missing.'],
  ];

  for (const [field, warning] of recommendedFields) {
    const value = profile[field];
    if (typeof value !== 'string' || !value.trim()) {
      warnings.push(warning);
    }
  }

  const customerName = buildCustomerNameFields(profile);
  const customer = compactRecord({
    code: profile.logoIsbasiCustomerCode || undefined,
    ...customerName.fields,
    tcknVkn: profile.taxNumber,
    taxOffice: profile.taxOffice,
    address: profile.billingAddress,
    city: profile.billingCity,
    district: profile.billingDistrict,
    emailAddress: profile.billingEmail,
    phone: profile.billingPhone || undefined,
    isPerson: customerName.isPerson,
  });

  const description = input.description.trim();
  const payload = {
    invoiceId: 0,
    customer,
    invoiceDate: input.invoiceDate?.trim() || new Date().toISOString().slice(0, 10),
    currency: input.currency.trim(),
    exchangeRate: 1,
    description,
    vatIncluded: false,
    salesInvoiceDetails: [
      {
        quantity: 1,
        taxRate: input.vatRate,
        price: input.commissionAmount,
        description,
        productDetail: {
          itemCode: 'SPORGYM-COMMISSION',
          itemType: 2,
          name: 'Sporgym Pazaryeri Komisyon Hizmeti',
          vat: input.vatRate,
          unit: 'Adet',
        },
      },
    ],
    ...(input.sourceOrderIds?.length ? { sourceOrderIds: input.sourceOrderIds } : {}),
    ...(input.sourcePeriod?.trim() ? { sourcePeriod: input.sourcePeriod.trim() } : {}),
  };

  return {
    payload,
    warnings,
  };
}
