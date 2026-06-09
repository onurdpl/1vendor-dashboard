import type { VendorBillingProfileDto } from '../vendors/vendor-billing-profile.service.js';

export type LogoIsbasiCommissionInvoicePreviewInput = {
  vendorBillingProfile: VendorBillingProfileDto;
  commissionAmount: string;
  vatRate: string;
  currency: string;
  description: string;
  invoiceDate?: string | Date | null;
  sourceOrderIds?: string[];
  sourcePeriod?: string | null;
};

export type LogoIsbasiCommissionInvoicePreview = {
  payload: Record<string, unknown>;
  warnings: string[];
};

function resolveLegalEntityIsPerson(value: string | null | undefined) {
  const normalized = value?.trim().toLocaleLowerCase('tr-TR').replace(/\s+/g, ' ');
  if (!normalized) {
    throw new Error('legalEntityType is required for Logo İşbaşı invoice payload.');
  }
  if ([
    'person',
    'personal',
    'individual',
    'bireysel',
    'şahıs',
    'sahis',
    'şahıs şirketi',
    'sahis sirketi',
    'sole_proprietorship',
    'personal_company',
    'sahis_sirketi',
  ].includes(normalized)) {
    return true;
  }
  if ([
    'company',
    'corporate',
    'kurumsal',
    'limited',
    'limited şirket',
    'limited sirket',
    'limited_company',
    'limited_sirket',
    'ltd',
    'ltd. şti.',
    'ltd. sti.',
    'joint_stock_company',
    'corporation',
    'anonim',
    'anonym',
    'anonim şirket',
    'anonim sirket',
    'anonim_sirket',
    'a.ş.',
    'a.s.',
  ].includes(normalized)) {
    return false;
  }
  throw new Error(`Unsupported legalEntityType for Logo İşbaşı invoice payload: ${value}.`);
}

function buildCustomerNameFields(profile: VendorBillingProfileDto, isPerson: boolean) {
  const name = profile.legalCompanyName?.trim() || undefined;
  if (!name) {
    return {};
  }

  if (isPerson) {
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return {
        firstName: parts.slice(0, -1).join(' '),
        lastName: parts.at(-1),
      };
    }
  }

  return {
    name,
  };
}

function parseLogoDecimalNumber(value: string, field: string, options: { allowZero?: boolean; max?: number } = {}) {
  const trimmed = value.trim();
  if (!trimmed || !/^\d+(?:\.\d{1,4})?$/.test(trimmed)) {
    throw new Error(`${field} must be a decimal number.`);
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || (options.allowZero ? parsed < 0 : parsed <= 0)) {
    throw new Error(`${field} must be ${options.allowZero ? 'a non-negative' : 'a positive'} decimal number.`);
  }
  if (typeof options.max === 'number' && parsed > options.max) {
    throw new Error(`${field} must be at most ${options.max}.`);
  }
  return parsed;
}

function formatDateObjectForLogoInvoiceDate(value: Date, useTime: boolean) {
  if (Number.isNaN(value.getTime())) {
    throw new Error('invoiceDate must be a valid date.');
  }
  const date = value.toISOString();
  return useTime ? `${date.slice(0, 10)} ${date.slice(11, 19)}` : `${date.slice(0, 10)} 00:00:00`;
}

function formatLogoInvoiceDate(value: string | Date | null | undefined) {
  if (value instanceof Date) {
    return formatDateObjectForLogoInvoiceDate(value, true);
  }

  if (typeof value !== 'string' || !value.trim()) {
    return formatDateObjectForLogoInvoiceDate(new Date(), false);
  }

  const trimmed = value.trim();
  const dateOnly = trimmed.match(/^(\d{4}-\d{2}-\d{2})$/);
  if (dateOnly) {
    return `${dateOnly[1]} 00:00:00`;
  }

  const dateTime = trimmed.match(
    /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/,
  );
  if (dateTime) {
    return `${dateTime[1]} ${dateTime[2]}:${dateTime[3]}:${dateTime[4] ?? '00'}`;
  }

  throw new Error('invoiceDate must use yyyy-MM-dd or yyyy-MM-dd HH:mm:ss format.');
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
  const warnings: string[] = [];
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

  const isPerson = resolveLegalEntityIsPerson(profile.legalEntityType);
  const customerNameFields = buildCustomerNameFields(profile, isPerson);
  const commissionAmount = parseLogoDecimalNumber(input.commissionAmount, 'commissionAmount');
  const vatRate = parseLogoDecimalNumber(input.vatRate, 'vatRate', { allowZero: true, max: 100 });
  const invoiceDate = formatLogoInvoiceDate(input.invoiceDate);
  const customer = compactRecord({
    code: profile.logoIsbasiCustomerCode || undefined,
    ...customerNameFields,
    tcknVkn: profile.taxNumber,
    taxOffice: profile.taxOffice,
    address: profile.billingAddress,
    city: profile.billingCity,
    district: profile.billingDistrict,
    emailAddress: profile.billingEmail,
    phone: profile.billingPhone || undefined,
    isPerson,
  });
  const shippingAddress = compactRecord({
    title: profile.legalCompanyName || undefined,
    name: profile.legalCompanyName || undefined,
    address: profile.billingAddress,
    city: profile.billingCity,
    district: profile.billingDistrict,
    emailAddress: profile.billingEmail,
    phone: profile.billingPhone || undefined,
  });

  const description = input.description.trim();
  const payload = {
    invoiceId: 0,
    customer,
    shippingAddress,
    invoiceDate,
    currency: input.currency.trim(),
    exchangeRate: 1,
    description,
    vatIncluded: false,
    eGovernmentInvoice: {
      eGovernmentType: 0,
      invoiceTypeForEinvoice: 2,
      eInvoiceProfile: 1,
    },
    eArchivePortalInvoice: {
      eGovernmentType: 0,
      dispatchIncluded: false,
    },
    salesInvoiceDetails: [
      {
        quantity: 1,
        taxRate: vatRate,
        price: commissionAmount,
        description,
        productDetail: {
          itemCode: 'SPORGYM-COMMISSION',
          itemType: 2,
          name: 'Sporgym Pazaryeri Komisyon Hizmeti',
          vat: vatRate,
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
