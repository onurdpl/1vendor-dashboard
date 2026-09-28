// Retired-provider payload types/summaries retained for historical diagnostics only.
// No provider client or execution implementation remains in this module.

export type NavlungoCreatePostPayload = {
  platform: string;
  posts: Array<{
    reference_id: string;
    carrier_id: number;
    post_type: number;
    cod_payment_type?: number | string;
    sender:
      | {
          addressId: number;
        }
      | {
          name: string;
          phone: string;
          email: string;
          address: string;
          country: string;
          city: string;
          district: string;
          post_code: string;
        };
    recipient:
      | {
          addressId: number;
        }
      | {
          name: string;
          phone: string;
          email: string;
          address: string;
          country: string;
          city: string;
          district: string;
          post_code: string;
        };
    post: {
      desi: number;
      package_count: number;
      price?: number | string;
      note: string;
    };
    barcode_format: string;
    custom_data_1: string;
    custom_data_2: string;
    custom_data_3: string;
    custom_data_4: string;
  }>;
};

export type NavlungoCreatePostEndpointPath = '/post/create' | '/post/return';

export type NavlungoCreatePostRequestSummary = {
  baseUrl: string | null;
  baseUrlHost: string | null;
  baseUrlPath: string | null;
  endpointPath: NavlungoCreatePostEndpointPath;
  method: 'POST';
  headerKeys: string[];
  topLevelBodyKeys: string[];
  postKeys: string[];
  senderKeys: string[];
  recipientKeys: string[];
  postPayloadKeys: string[];
  barcodeFormatPresent: boolean;
  barcodeFormatType: string | null;
  codPaymentTypePresent: boolean;
  codPaymentType: string | null;
  postPricePresent: boolean;
  postPriceType: string | null;
  requestedCarrierId: number | string | null;
  requestedPostType: number | string | null;
  requestedBarcodeFormat: string | null;
  senderUsesAddressId: boolean;
  senderFullObjectKeysPresent: boolean;
  customData1Present: boolean;
  customData2Present: boolean;
  customData3Present: boolean;
  customData4Present: boolean;
  recipientDistrictPresent: boolean;
  recipientCityPresent: boolean;
  recipientCountryPresent: boolean;
  recipientPostCodePresent: boolean;
  recipientPhonePresent: boolean;
  recipientPhoneFormatValid: boolean;
  recipientEmailPresent: boolean;
  recipientEmailFormatValid: boolean;
  recipientAddressPresent: boolean;
  recipientAddressLength: number;
  packageCountPresent: boolean;
  packageCountType: string | null;
  requestedPackageCount: number | string | null;
  desiPresent: boolean;
  desiType: string | null;
  requestedDesi: number | string | null;
  postNotePresent: boolean;
  postNoteType: string | null;
  postNoteLength: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function safeValueType(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'string' && value.length === 0) {
    return 'string-empty';
  }
  return Array.isArray(value) ? 'array' : typeof value;
}

function hasTrimmedString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0;
}

function safeStringLength(value: unknown) {
  return typeof value === 'string' ? value.trim().length : 0;
}

function isSafeEmailFormat(value: unknown) {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function isSafeTurkishPhoneFormat(value: unknown) {
  if (typeof value !== 'string') {
    return false;
  }
  const normalized = value.trim();
  const digits = normalized.replace(/\D+/g, '');
  return /^\+90\s?\d/.test(normalized) && digits.length === 12;
}

function sortedRecordKeys(value: unknown) {
  return isRecord(value) ? Object.keys(value).sort() : [];
}

export function summarizeNavlungoCreatePostRequest(
  payload: NavlungoCreatePostPayload,
  _env: unknown = {},
  endpointPath: NavlungoCreatePostEndpointPath = '/post/create',
): NavlungoCreatePostRequestSummary {
  const baseUrl = { host: null as string | null, path: null as string | null };
  const post = payload.posts[0] as NavlungoCreatePostPayload['posts'][number] | undefined;
  const sender = post?.sender;
  const recipient = post?.recipient;
  const postPayload = post?.post;
  const senderKeys = sortedRecordKeys(sender);
  const recipientKeys = sortedRecordKeys(recipient);
  const recipientRecord: Record<string, unknown> = isRecord(recipient) ? recipient : {};
  const postPayloadKeys = sortedRecordKeys(postPayload);

  return {
    baseUrl: baseUrl.host ? `${baseUrl.host}${baseUrl.path ?? ''}` : null,
    baseUrlHost: baseUrl.host,
    baseUrlPath: baseUrl.path,
    endpointPath,
    method: 'POST',
    headerKeys: ['Accept', 'Authorization', 'Content-Type', 'X-localization'],
    topLevelBodyKeys: sortedRecordKeys(payload),
    postKeys: sortedRecordKeys(post),
    senderKeys,
    recipientKeys,
    postPayloadKeys,
    barcodeFormatPresent: post?.barcode_format !== undefined,
    barcodeFormatType: safeValueType(post?.barcode_format),
    codPaymentTypePresent: post?.cod_payment_type !== undefined,
    codPaymentType: safeValueType(post?.cod_payment_type),
    postPricePresent: postPayload?.price !== undefined,
    postPriceType: safeValueType(postPayload?.price),
    requestedCarrierId: post?.carrier_id ?? null,
    requestedPostType: post?.post_type ?? null,
    requestedBarcodeFormat: typeof post?.barcode_format === 'string' ? post.barcode_format : null,
    senderUsesAddressId: isRecord(sender) && 'addressId' in sender,
    senderFullObjectKeysPresent: senderKeys.some((key) => key !== 'addressId'),
    customData1Present: post?.custom_data_1 !== undefined,
    customData2Present: post?.custom_data_2 !== undefined,
    customData3Present: post?.custom_data_3 !== undefined,
    customData4Present: post?.custom_data_4 !== undefined,
    recipientDistrictPresent: hasTrimmedString(recipientRecord.district),
    recipientCityPresent: hasTrimmedString(recipientRecord.city),
    recipientCountryPresent: hasTrimmedString(recipientRecord.country),
    recipientPostCodePresent: hasTrimmedString(recipientRecord.post_code),
    recipientPhonePresent: hasTrimmedString(recipientRecord.phone),
    recipientPhoneFormatValid: isSafeTurkishPhoneFormat(recipientRecord.phone),
    recipientEmailPresent: hasTrimmedString(recipientRecord.email),
    recipientEmailFormatValid: isSafeEmailFormat(recipientRecord.email),
    recipientAddressPresent: hasTrimmedString(recipientRecord.address),
    recipientAddressLength: safeStringLength(recipientRecord.address),
    packageCountPresent: postPayload?.package_count !== undefined,
    packageCountType: safeValueType(postPayload?.package_count),
    requestedPackageCount: postPayload?.package_count ?? null,
    desiPresent: postPayload?.desi !== undefined,
    desiType: safeValueType(postPayload?.desi),
    requestedDesi: postPayload?.desi ?? null,
    postNotePresent: postPayload?.note !== undefined,
    postNoteType: safeValueType(postPayload?.note),
    postNoteLength: safeStringLength(postPayload?.note),
  };
}
