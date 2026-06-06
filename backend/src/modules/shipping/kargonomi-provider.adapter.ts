import type { AppEnv } from '../../config/env.js';
import type { ShipmentExecutionStatusDto } from './shipping-execution.types.js';
import {
  ShippingProviderExecutionError,
  type ShippingProviderAdapter,
  type ShippingProviderCreateInput,
  type ShippingProviderCreateResult,
} from './shipping-provider.adapter.js';

export const KARGONOMI_PROVIDER_KEY = 'kargonomi' as const;
export const KARGONOMI_PROVIDER_DISPLAY_NAME = 'Kargonomi';

export const KARGONOMI_ENV_NAMES = {
  baseUrl: 'KARGONOMI_BASE_URL',
  apiToken: 'KARGONOMI_API_TOKEN',
  appKey: 'KARGONOMI_APP_KEY',
} as const;

const KARGONOMI_CANCELLATION_UNSUPPORTED_MESSAGE = 'Kargonomi shipment cancellation is not implemented.';

export type KargonomiShipmentPackageInput = {
  content?: string | null;
  barcode?: string | null;
  desi: string | number;
};

export type KargonomiShipmentCreatePayloadInput = {
  sender?: {
    sender_name?: string | null;
    sender_email?: string | null;
    sender_tax_number?: string | null;
    sender_tax_place?: string | null;
    sender_phone?: string | null;
    sender_address?: string | null;
    sender_state_id?: string | number | null;
    sender_city_id?: string | number | null;
  };
  warehouseId?: string | number | null;
  buyer: {
    buyer_name: string;
    buyer_email?: string | null;
    buyer_phone: string;
    buyer_address: string;
    buyer_state_id: string | number;
    buyer_city_id: string | number;
    buyer_tax_number?: string | null;
    buyer_tax_place?: string | null;
  };
  packages: KargonomiShipmentPackageInput[];
};

export type ParsedKargonomiShipment = {
  id: string | null;
  shippingWebserviceOrderId: string | null;
  shippingWebserviceBarcode: string | null;
  shippingWebserviceTrackingCode: string | null;
  shippingProviderName: string | null;
  shippingProviderSlug: string | null;
  barcodeOfOrderId: string | null;
  status: string | null;
  statusLabel: string | null;
  internalStatus: ShipmentExecutionStatusDto;
  pricing: {
    packageCount: string | null;
    estimatedPrice: string | null;
    realPrice: string | null;
    extraShippingPrice: string | null;
    priceDiff: string | null;
  };
  shipmentPackages: Array<{
    desi: string | null;
    barcode: string | null;
    content: string | null;
    realDesi: string | null;
  }>;
};

export type KargonomiRawHttpResponse<TBody = unknown> = {
  ok: boolean;
  status: number;
  contentType: string;
  body: TBody;
};

export type KargonomiHttpClientOptions = {
  fetchImpl?: typeof fetch;
};

export type KargonomiClient = Pick<
  KargonomiHttpClient,
  | 'createShipmentDraft'
  | 'getShipmentPriceComparison'
  | 'confirmShippingPrice'
  | 'getShipmentBarcodePdf'
  | 'getShipment'
>;

export type KargonomiDestinationLookupClient = Pick<KargonomiHttpClient, 'listStates' | 'listCities'>;

export type KargonomiConfirmShippingPriceInput = {
  shipmentId: string | number;
  shippingProviderId: string | number;
};

export type KargonomiDestinationAddressInput = {
  province?: string | null;
  city?: string | null;
  district?: string | null;
  countryId?: string | number | null;
};

export type KargonomiDestinationResolution =
  | {
      ok: true;
      buyerStateId: string;
      buyerCityId: string;
      stateName: string;
      cityName: string;
      stateSource: 'province' | 'city';
      citySource: 'district';
    }
  | {
      ok: false;
      reason:
        | 'missing_state_text'
        | 'missing_district_text'
        | 'state_lookup_failed'
        | 'city_lookup_failed'
        | 'state_unresolved'
        | 'state_ambiguous'
        | 'city_unresolved'
        | 'city_ambiguous';
      message: string;
    };

type KargonomiLocationItem = {
  id: string;
  name: string;
};

const stateLookupCache = new Map<string, Promise<KargonomiLocationItem[]>>();
const cityLookupCache = new Map<string, Promise<KargonomiLocationItem[]>>();

function compactRecord<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ''),
  ) as Partial<T>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readString(value: Record<string, unknown>, keys: string[]) {
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

function readNestedRecord(value: Record<string, unknown>, key: string) {
  const nested = value[key];
  return isRecord(nested) ? nested : {};
}

function readNumber(value: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const raw = value[key];
    const numeric = typeof raw === 'string' ? Number(raw.replace(',', '.')) : Number(raw);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }

  return null;
}

function normalizeKargonomiLocationText(value: string | null | undefined) {
  return (value ?? '')
    .trim()
    .toLocaleLowerCase('tr-TR')
    .replace(/[çÇ]/g, 'c')
    .replace(/[ğĞ]/g, 'g')
    .replace(/[ıİ]/g, 'i')
    .replace(/[öÖ]/g, 'o')
    .replace(/[şŞ]/g, 's')
    .replace(/[üÜ]/g, 'u')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function extractLocationItems(value: unknown, type: 'state' | 'city'): KargonomiLocationItem[] {
  const list = Array.isArray(value)
    ? value
    : isRecord(value)
      ? (['data', 'items', 'result', 'results', 'states', 'cities'] as const)
          .map((key) => value[key])
          .find(Array.isArray) ?? []
      : [];

  return list.filter(isRecord).flatMap((item) => {
    const id = readString(item, ['id', `${type}_id`, `${type}Id`, 'value']);
    const name = readString(item, ['name', 'title', `${type}_name`, `${type}Name`, 'label']);
    return id && name ? [{ id, name }] : [];
  });
}

async function cachedKargonomiStates(
  client: KargonomiDestinationLookupClient,
  countryId?: string | number | null,
) {
  const key = countryId === undefined || countryId === null || countryId === '' ? 'default' : String(countryId);
  let pending = stateLookupCache.get(key);
  if (!pending) {
    pending = client
      .listStates(countryId ?? undefined)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Kargonomi states lookup failed with HTTP ${response.status}.`);
        }
        return extractLocationItems(response.body, 'state');
      })
      .catch((error) => {
        stateLookupCache.delete(key);
        throw error;
      });
    stateLookupCache.set(key, pending);
  }
  return pending;
}

async function cachedKargonomiCities(client: KargonomiDestinationLookupClient, stateId: string | number) {
  const key = String(stateId);
  let pending = cityLookupCache.get(key);
  if (!pending) {
    pending = client
      .listCities(stateId)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Kargonomi cities lookup failed with HTTP ${response.status}.`);
        }
        return extractLocationItems(response.body, 'city');
      })
      .catch((error) => {
        cityLookupCache.delete(key);
        throw error;
      });
    cityLookupCache.set(key, pending);
  }
  return pending;
}

function findExactLocationMatch(items: KargonomiLocationItem[], text: string) {
  const normalizedText = normalizeKargonomiLocationText(text);
  const matches = items.filter((item) => normalizeKargonomiLocationText(item.name) === normalizedText);
  if (matches.length === 1) {
    return { status: 'matched' as const, item: matches[0] };
  }
  return { status: matches.length > 1 ? ('ambiguous' as const) : ('unresolved' as const) };
}

export function clearKargonomiLocationLookupCache() {
  stateLookupCache.clear();
  cityLookupCache.clear();
}

export async function resolveKargonomiDestinationAddress(
  input: KargonomiDestinationAddressInput,
  client: KargonomiDestinationLookupClient,
): Promise<KargonomiDestinationResolution> {
  const stateText = input.province?.trim() || input.city?.trim() || null;
  const stateSource = input.province?.trim() ? 'province' : 'city';
  const districtText = input.district?.trim() || null;

  if (!stateText) {
    return {
      ok: false,
      reason: 'missing_state_text',
      message: 'Kargonomi destination province/city is missing from the order shipping address.',
    };
  }

  if (!districtText) {
    return {
      ok: false,
      reason: 'missing_district_text',
      message: 'Kargonomi destination district is missing from the order shipping address.',
    };
  }

  let states: KargonomiLocationItem[];
  try {
    states = await cachedKargonomiStates(client, input.countryId);
  } catch (error) {
    return {
      ok: false,
      reason: 'state_lookup_failed',
      message: error instanceof Error
        ? `Kargonomi states lookup failed before shipment creation: ${error.message}. Check KARGONOMI_BASE_URL, KARGONOMI_API_TOKEN, Render/network access, and Kargonomi availability.`
        : 'Kargonomi states lookup failed before shipment creation. Check KARGONOMI_BASE_URL, KARGONOMI_API_TOKEN, Render/network access, and Kargonomi availability.',
    };
  }

  const stateMatch = findExactLocationMatch(states, stateText);
  if (stateMatch.status === 'ambiguous') {
    return {
      ok: false,
      reason: 'state_ambiguous',
      message: `Kargonomi destination state match is ambiguous for "${stateText}".`,
    };
  }
  if (stateMatch.status === 'unresolved' || !stateMatch.item) {
    return {
      ok: false,
      reason: 'state_unresolved',
      message: `Kargonomi destination state could not be resolved for "${stateText}".`,
    };
  }

  let cities: KargonomiLocationItem[];
  try {
    cities = await cachedKargonomiCities(client, stateMatch.item.id);
  } catch (error) {
    return {
      ok: false,
      reason: 'city_lookup_failed',
      message: error instanceof Error
        ? `Kargonomi cities lookup failed before shipment creation for resolved state ${stateMatch.item.id}: ${error.message}. Check KARGONOMI_BASE_URL, KARGONOMI_API_TOKEN, Render/network access, and Kargonomi availability.`
        : `Kargonomi cities lookup failed before shipment creation for resolved state ${stateMatch.item.id}. Check KARGONOMI_BASE_URL, KARGONOMI_API_TOKEN, Render/network access, and Kargonomi availability.`,
    };
  }

  const cityMatch = findExactLocationMatch(cities, districtText);
  if (cityMatch.status === 'ambiguous') {
    return {
      ok: false,
      reason: 'city_ambiguous',
      message: `Kargonomi destination city/district match is ambiguous for "${districtText}".`,
    };
  }
  if (cityMatch.status === 'unresolved' || !cityMatch.item) {
    const examples = cities
      .slice(0, 8)
      .map((city) => city.name)
      .join(', ');
    return {
      ok: false,
      reason: 'city_unresolved',
      message: examples
        ? `Kargonomi destination district could not be matched: ${districtText}. Available districts for selected state include: ${examples}.`
        : `Kargonomi destination district could not be matched: ${districtText}.`,
    };
  }

  return {
    ok: true,
    buyerStateId: stateMatch.item.id,
    buyerCityId: cityMatch.item.id,
    stateName: stateMatch.item.name,
    cityName: cityMatch.item.name,
    stateSource,
    citySource: 'district',
  };
}

export function buildKargonomiShipmentCreatePayload(input: KargonomiShipmentCreatePayloadInput) {
  const senderOrWarehouse = input.warehouseId
    ? { warehouse_id: input.warehouseId }
    : compactRecord({
        sender_name: input.sender?.sender_name,
        sender_email: input.sender?.sender_email,
        sender_tax_number: input.sender?.sender_tax_number,
        sender_tax_place: input.sender?.sender_tax_place,
        sender_phone: input.sender?.sender_phone,
        sender_address: input.sender?.sender_address,
        sender_state_id: input.sender?.sender_state_id,
        sender_city_id: input.sender?.sender_city_id,
      });

  return {
    shipment: {
      ...senderOrWarehouse,
      ...compactRecord({
        buyer_name: input.buyer.buyer_name,
        buyer_email: input.buyer.buyer_email,
        buyer_tax_number: input.buyer.buyer_tax_number,
        buyer_tax_place: input.buyer.buyer_tax_place,
        buyer_phone: input.buyer.buyer_phone,
        buyer_address: input.buyer.buyer_address,
        buyer_state_id: input.buyer.buyer_state_id,
        buyer_city_id: input.buyer.buyer_city_id,
      }),
      packages: input.packages.map((shipmentPackage) =>
        compactRecord({
          content: shipmentPackage.content,
          barcode: shipmentPackage.barcode,
          desi: shipmentPackage.desi,
        }),
      ),
    },
  };
}

export function mapKargonomiStatusToInternalStatus(status: string | null | undefined): ShipmentExecutionStatusDto {
  const normalized = status?.trim().toLowerCase() ?? '';

  if (normalized === 'webservice_shipment_delivered') {
    return 'delivered';
  }

  if (normalized === 'webservice_shipment_started') {
    return 'in_transit';
  }

  if (normalized === 'ready' || normalized === 'webservice_order_created') {
    return 'created';
  }

  if (
    normalized === 'webservice_order_failed' ||
    normalized === 'webservice_shipment_not_delivered' ||
    normalized === 'webservice_shipment_missing'
  ) {
    return 'failed';
  }

  if (normalized === 'cancelled') {
    return 'cancelled';
  }

  if (
    normalized === 'draft' ||
    normalized === 'webservice_order_creating' ||
    normalized === 'webservice_checking_shipment' ||
    normalized === 'webservice_shipment_returning' ||
    normalized === 'request_for_cancellation'
  ) {
    return 'pending';
  }

  return 'pending';
}

export function parseKargonomiShipment(value: unknown): ParsedKargonomiShipment {
  const shipment = isRecord(value) ? value : {};
  const pricing = readNestedRecord(shipment, 'pricing');
  const shipmentPackages = Array.isArray(shipment.shipment_packages)
    ? shipment.shipment_packages.filter(isRecord)
    : [];
  const status = readString(shipment, ['status']);

  return {
    id: readString(shipment, ['id']),
    shippingWebserviceOrderId: readString(shipment, ['shipping_webservice_order_id']),
    shippingWebserviceBarcode: readString(shipment, ['shipping_webservice_barcode']),
    shippingWebserviceTrackingCode: readString(shipment, ['shipping_webservice_tracking_code']),
    shippingProviderName: readString(shipment, ['shipping_provider_name']),
    shippingProviderSlug: readString(shipment, ['shipping_provider_slug']),
    barcodeOfOrderId: readString(shipment, ['barcode_of_order_id']),
    status,
    statusLabel: readString(shipment, ['status_label']),
    internalStatus: mapKargonomiStatusToInternalStatus(status),
    pricing: {
      packageCount: readString(pricing, ['package_count']) ?? readString(shipment, ['package_count']),
      estimatedPrice: readString(pricing, ['estimated_price']) ?? readString(shipment, ['estimated_price']),
      realPrice: readString(pricing, ['real_price']) ?? readString(shipment, ['real_price']),
      extraShippingPrice: readString(pricing, ['extra_shipping_price']) ?? readString(shipment, ['extra_shipping_price']),
      priceDiff: readString(pricing, ['price_diff']),
    },
    shipmentPackages: shipmentPackages.map((shipmentPackage) => ({
      desi: readString(shipmentPackage, ['desi']),
      barcode: readString(shipmentPackage, ['barcode']),
      content: readString(shipmentPackage, ['content']),
      realDesi: readString(shipmentPackage, ['real_desi']),
    })),
  };
}

function parseKargonomiResponseBody(contentType: string, responseText: string): unknown {
  if (!responseText) {
    return null;
  }

  if (!contentType.includes('application/json')) {
    return responseText;
  }

  try {
    return JSON.parse(responseText);
  } catch {
    return responseText;
  }
}

const KARGONOMI_DIAGNOSTIC_REDACTED = '[redacted]';
const KARGONOMI_DIAGNOSTIC_MAX_STRING_LENGTH = 500;
const KARGONOMI_DIAGNOSTIC_MAX_ARRAY_ITEMS = 10;
const KARGONOMI_DIAGNOSTIC_MAX_OBJECT_KEYS = 20;
const KARGONOMI_DIAGNOSTIC_MAX_DEPTH = 3;
const KARGONOMI_SENSITIVE_KEY_PATTERN = /token|authorization|api[_-]?key|password|secret|card|phone|email|address/i;

function truncateKargonomiDiagnosticString(value: string) {
  return value.length > KARGONOMI_DIAGNOSTIC_MAX_STRING_LENGTH
    ? `${value.slice(0, KARGONOMI_DIAGNOSTIC_MAX_STRING_LENGTH)}...`
    : value;
}

function sanitizeKargonomiDiagnosticValue(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'string') {
    return truncateKargonomiDiagnosticString(value);
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (Array.isArray(value)) {
    if (depth >= KARGONOMI_DIAGNOSTIC_MAX_DEPTH) {
      return '[array]';
    }
    return value
      .slice(0, KARGONOMI_DIAGNOSTIC_MAX_ARRAY_ITEMS)
      .map((item) => sanitizeKargonomiDiagnosticValue(item, depth + 1));
  }

  if (isRecord(value)) {
    if (depth >= KARGONOMI_DIAGNOSTIC_MAX_DEPTH) {
      return '[object]';
    }

    return Object.fromEntries(
      Object.entries(value)
        .slice(0, KARGONOMI_DIAGNOSTIC_MAX_OBJECT_KEYS)
        .map(([key, item]) => [
          key,
          KARGONOMI_SENSITIVE_KEY_PATTERN.test(key)
            ? KARGONOMI_DIAGNOSTIC_REDACTED
            : sanitizeKargonomiDiagnosticValue(item, depth + 1),
        ]),
    );
  }

  return String(value);
}

function readKargonomiErrorMessage(body: unknown) {
  if (!isRecord(body)) {
    return typeof body === 'string' ? truncateKargonomiDiagnosticString(body) : null;
  }

  return readString(body, ['message', 'error', 'error_message', 'errorMessage', 'reason']);
}

function summarizeKargonomiFailureBody(response: KargonomiRawHttpResponse) {
  if (response.ok) {
    return {};
  }

  const sanitizedBody = sanitizeKargonomiDiagnosticValue(response.body);
  const bodyRecord = isRecord(response.body) ? response.body : null;

  return {
    providerErrorMessage: readKargonomiErrorMessage(response.body),
    providerErrorErrors: bodyRecord && Object.hasOwn(bodyRecord, 'errors')
      ? sanitizeKargonomiDiagnosticValue(bodyRecord.errors)
      : null,
    providerErrorBodyPreview: sanitizedBody,
  };
}

function summarizeResponse(response: KargonomiRawHttpResponse) {
  return {
    ok: response.ok,
    httpStatus: response.status,
    contentType: response.contentType,
    bodyKeys: isRecord(response.body) ? Object.keys(response.body) : [],
    ...summarizeKargonomiFailureBody(response),
  };
}

function mergePrimaryResponseSummary(responseSnapshot: Record<string, unknown>, response: KargonomiRawHttpResponse) {
  const summary = summarizeResponse(response);
  responseSnapshot.ok = summary.ok;
  responseSnapshot.status = summary.httpStatus;
  responseSnapshot.contentType = summary.contentType;
  responseSnapshot.bodyKeys = summary.bodyKeys;
  responseSnapshot.providerErrorMessage = summary.providerErrorMessage;
  responseSnapshot.providerErrorErrors = summary.providerErrorErrors;
  responseSnapshot.providerErrorBodyPreview = summary.providerErrorBodyPreview;
}

function summarizeKargonomiError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      cause: error.cause instanceof Error ? `${error.cause.name}: ${error.cause.message}` : null,
    };
  }

  return {
    name: 'UnknownError',
    message: 'Unknown Kargonomi provider error.',
    cause: null,
  };
}

function throwKargonomiExecutionError(
  stage: string,
  responseSnapshot: Record<string, unknown>,
  message: string,
  error?: unknown,
): never {
  const safeError = error === undefined ? null : summarizeKargonomiError(error);
  throw new ShippingProviderExecutionError(message, {
    ...responseSnapshot,
    provider: KARGONOMI_PROVIDER_KEY,
    flow: 'forward',
    lastProviderStage: stage,
    providerError: message,
    ...(safeError ? { fetchError: safeError } : {}),
  });
}

function extractShipmentBody(body: unknown): unknown {
  if (!isRecord(body)) {
    return body;
  }

  const direct = body.shipment;
  if (isRecord(direct)) {
    return direct;
  }

  const data = body.data;
  if (isRecord(data)) {
    if (isRecord(data.shipment)) {
      return data.shipment;
    }
    return data;
  }

  return body;
}

function extractShipmentId(body: unknown) {
  const shipmentBody = extractShipmentBody(body);
  if (!isRecord(shipmentBody)) {
    return null;
  }

  return readString(shipmentBody, ['id', 'shipment_id', 'shipmentId']);
}

function findPotentialBarcodePdf(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) {
    const trimmed = value.trim();
    if (trimmed.startsWith('JVBER') || trimmed.startsWith('data:application/pdf') || trimmed.endsWith('.pdf')) {
      return trimmed;
    }
    return null;
  }

  if (!isRecord(value)) {
    return null;
  }

  for (const key of ['barcode_pdf', 'barcodePdf', 'barcode_pdf_base64', 'pdf', 'pdf_base64', 'data', 'barcode']) {
    const match = findPotentialBarcodePdf(value[key]);
    if (match) {
      return match;
    }
  }

  for (const nested of Object.values(value)) {
    const match = findPotentialBarcodePdf(nested);
    if (match) {
      return match;
    }
  }

  return null;
}

function normalizeKargonomiPdfLabelArtifact(value: string | null) {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith('data:application/pdf')) {
    return trimmed;
  }

  if (/^https?:\/\//i.test(trimmed) || trimmed.endsWith('.pdf')) {
    return trimmed;
  }

  if (trimmed.startsWith('JVBER')) {
    return `data:application/pdf;base64,${trimmed}`;
  }

  return null;
}

function readTopLevelKeys(value: unknown) {
  return isRecord(value) ? Object.keys(value).sort() : [];
}

function summarizeKargonomiShipmentSafeFields(body: unknown) {
  const shipment = extractShipmentBody(body);
  const shipmentRecord = isRecord(shipment) ? shipment : {};
  const packages = Array.isArray(shipmentRecord.shipment_packages) ? shipmentRecord.shipment_packages.filter(isRecord) : [];

  return compactRecord({
    topLevelKeys: readTopLevelKeys(body),
    shipmentKeys: readTopLevelKeys(shipment),
    id: readString(shipmentRecord, ['id', 'shipment_id', 'shipmentId']),
    status: readString(shipmentRecord, ['status']),
    status_label: readString(shipmentRecord, ['status_label', 'statusLabel']),
    shipping_provider_name: readString(shipmentRecord, ['shipping_provider_name', 'shippingProviderName']),
    shipping_provider_slug: readString(shipmentRecord, ['shipping_provider_slug', 'shippingProviderSlug']),
    shipping_webservice_order_id: readString(shipmentRecord, [
      'shipping_webservice_order_id',
      'shippingWebserviceOrderId',
    ]),
    shipping_webservice_barcode: readString(shipmentRecord, [
      'shipping_webservice_barcode',
      'shippingWebserviceBarcode',
    ]),
    shipping_webservice_tracking_code: readString(shipmentRecord, [
      'shipping_webservice_tracking_code',
      'shippingWebserviceTrackingCode',
    ]),
    barcode_of_order_id: readString(shipmentRecord, ['barcode_of_order_id', 'barcodeOfOrderId']),
    shipment_packages: packages.map((shipmentPackage) =>
      compactRecord({
        barcode: readString(shipmentPackage, ['barcode']),
      }),
    ),
  });
}

function detectKargonomiBarcodeFetchFormat(body: unknown, contentType: string) {
  if (contentType.includes('application/pdf')) {
    return 'pdf';
  }
  if (typeof body === 'string') {
    const trimmed = body.trim();
    if (trimmed.startsWith('JVBER')) return 'base64_pdf';
    if (trimmed.startsWith('data:application/pdf')) return 'data_url_pdf';
    if (trimmed.endsWith('.pdf')) return 'pdf_url';
    return 'string';
  }
  if (findPotentialBarcodePdf(body)) {
    return 'pdf_like_value';
  }
  if (isRecord(body)) {
    return 'json';
  }
  if (Array.isArray(body)) {
    return 'array';
  }
  return body === null || body === undefined ? 'empty' : typeof body;
}

function summarizeKargonomiBarcodeFetchDiagnostics(
  response: KargonomiRawHttpResponse,
  pdfLikeValuePresent: boolean,
  labelUrlPresent: boolean,
) {
  return {
    ...summarizeResponse(response),
    topLevelKeys: readTopLevelKeys(response.body),
    detectedFormat: detectKargonomiBarcodeFetchFormat(response.body, response.contentType),
    pdfLikeValuePresent,
    labelUrlPresent,
  };
}

function parseMoney(value: string | null) {
  if (!value) {
    return null;
  }

  const match = value.replace(',', '.').match(/-?\d+(?:\.\d+)?/);
  if (!match) {
    return null;
  }

  const numeric = Number(match[0]);
  return Number.isFinite(numeric) ? numeric : null;
}

function buildKargonomiProviderResult(
  responseBody: unknown,
  fallbackShipmentId: string | null,
  responseSnapshot: Record<string, unknown>,
): ShippingProviderCreateResult {
  const parsed = parseKargonomiShipment(extractShipmentBody(responseBody));
  const providerShipmentId = parsed.id ?? fallbackShipmentId;
  const trackingNumber =
    parsed.shippingWebserviceTrackingCode ?? parsed.shippingWebserviceBarcode ?? parsed.barcodeOfOrderId ?? null;
  const labelUrl = readString(responseSnapshot, ['labelUrl', 'barcode']);
  const shippingCost =
    parseMoney(parsed.pricing.realPrice) ??
    parseMoney(parsed.pricing.estimatedPrice) ??
    readNumber(isRecord(responseBody) ? responseBody : {}, ['price', 'shipping_price', 'total_price']);

  return {
    providerShipmentId,
    trackingNumber,
    trackingUrl: null,
    labelUrl,
    shipmentStatus: parsed.internalStatus,
    shippingCost,
    shippingVat: null,
    currency: 'TRY',
    responseSnapshot: {
      ...responseSnapshot,
      provider: KARGONOMI_PROVIDER_KEY,
      parsedShipmentId: parsed.id,
      providerShipmentId,
      trackingNumberPresent: Boolean(trackingNumber),
      shippingProviderName: parsed.shippingProviderName,
      shippingProviderSlug: parsed.shippingProviderSlug,
      status: parsed.status,
      statusLabel: parsed.statusLabel,
      barcodePresent: Boolean(labelUrl ?? parsed.shippingWebserviceBarcode ?? parsed.barcodeOfOrderId),
      labelUrlPresent: Boolean(labelUrl),
      labelUnavailableReason: labelUrl ? null : 'barcode_pdf_response_shape_unknown_or_unavailable',
      shippingCostPresent: shippingCost !== null,
    },
  };
}

function ensureKargonomiPayload(value: Record<string, unknown>): KargonomiShipmentCreatePayloadInput {
  const buyer = isRecord(value.buyer) ? value.buyer : {};
  const packages = Array.isArray(value.packages) ? value.packages.filter(isRecord) : [];
  const missing = [
    !value.warehouseId ? 'warehouseId' : null,
    !readString(buyer, ['buyer_name']) ? 'buyer.buyer_name' : null,
    !readString(buyer, ['buyer_phone']) ? 'buyer.buyer_phone' : null,
    !readString(buyer, ['buyer_address']) ? 'buyer.buyer_address' : null,
    !readString(buyer, ['buyer_state_id']) ? 'buyer.buyer_state_id' : null,
    !readString(buyer, ['buyer_city_id']) ? 'buyer.buyer_city_id' : null,
    packages.length === 0 ? 'packages' : null,
  ].filter((field): field is string => Boolean(field));

  if (missing.length) {
    throw new Error(`Kargonomi shipment payload is incomplete. Missing: ${missing.join(', ')}.`);
  }

  return {
    warehouseId: value.warehouseId as string | number,
    buyer: {
      buyer_name: readString(buyer, ['buyer_name']) as string,
      buyer_email: readString(buyer, ['buyer_email']),
      buyer_phone: readString(buyer, ['buyer_phone']) as string,
      buyer_address: readString(buyer, ['buyer_address']) as string,
      buyer_state_id: readString(buyer, ['buyer_state_id']) as string,
      buyer_city_id: readString(buyer, ['buyer_city_id']) as string,
      buyer_tax_number: readString(buyer, ['buyer_tax_number']),
      buyer_tax_place: readString(buyer, ['buyer_tax_place']),
    },
    packages: packages.map((shipmentPackage) => ({
      content: readString(shipmentPackage, ['content']),
      barcode: readString(shipmentPackage, ['barcode']),
      desi: readString(shipmentPackage, ['desi']) ?? 1,
    })),
  };
}

export class KargonomiHttpClient {
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly env: AppEnv,
    options: KargonomiHttpClientOptions = {},
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async createShipmentDraft(input: KargonomiShipmentCreatePayloadInput): Promise<KargonomiRawHttpResponse> {
    return this.request('/shipments', {
      method: 'POST',
      contentType: 'application/json',
      body: JSON.stringify(buildKargonomiShipmentCreatePayload(input)),
    });
  }

  async getShipmentPriceComparison(shipmentId: string | number): Promise<KargonomiRawHttpResponse> {
    return this.request(`/shipment-price-comparison/${encodeURIComponent(String(shipmentId))}`, {
      method: 'GET',
    });
  }

  async confirmShippingPrice(input: KargonomiConfirmShippingPriceInput): Promise<KargonomiRawHttpResponse> {
    const body = new URLSearchParams({
      shipment_id: String(input.shipmentId),
      shipping_provider_id: String(input.shippingProviderId),
    });

    return this.request('/confirm-shipping-price', {
      method: 'POST',
      contentType: 'application/x-www-form-urlencoded',
      body,
    });
  }

  // Kargonomi docs say barcode PDF output is base64, but the exact response envelope is unknown.
  async getShipmentBarcodePdf(shipmentId: string | number): Promise<KargonomiRawHttpResponse<unknown>> {
    return this.request(`/shipments/${encodeURIComponent(String(shipmentId))}/barcode?format=pdf`, {
      method: 'GET',
    });
  }

  async getShipment(shipmentId: string | number): Promise<KargonomiRawHttpResponse> {
    return this.request(`/shipments/${encodeURIComponent(String(shipmentId))}`, {
      method: 'GET',
    });
  }

  async listStates(countryId?: string | number): Promise<KargonomiRawHttpResponse> {
    const suffix = countryId === undefined || countryId === null || String(countryId).trim() === ''
      ? ''
      : `/${encodeURIComponent(String(countryId))}`;
    return this.request(`/states${suffix}`, {
      method: 'GET',
    });
  }

  async listCities(stateId: string | number): Promise<KargonomiRawHttpResponse> {
    return this.request(`/cities/${encodeURIComponent(String(stateId))}`, {
      method: 'GET',
    });
  }

  private requestUrl(path: string) {
    if (!this.env.KARGONOMI_BASE_URL) {
      throw new Error('Kargonomi base URL is not configured.');
    }

    return `${this.env.KARGONOMI_BASE_URL.replace(/\/$/, '')}${path}`;
  }

  private requestHeaders(contentType?: string) {
    if (!this.env.KARGONOMI_API_TOKEN) {
      throw new Error('Kargonomi API token is not configured.');
    }

    const headers: Record<string, string> = {
      Accept: 'application/json',
      Authorization: `Bearer ${this.env.KARGONOMI_API_TOKEN}`,
    };

    if (contentType) {
      headers['Content-Type'] = contentType;
    }

    if (this.env.KARGONOMI_APP_KEY) {
      headers['X-App-Key'] = this.env.KARGONOMI_APP_KEY;
    }

    return headers;
  }

  private async request(
    path: string,
    init: {
      method: 'GET' | 'POST';
      contentType?: string;
      body?: BodyInit;
    },
  ): Promise<KargonomiRawHttpResponse> {
    const response = await this.fetchImpl(this.requestUrl(path), {
      method: init.method,
      headers: this.requestHeaders(init.contentType),
      body: init.body,
    });
    const contentType = response.headers.get('content-type') ?? '';
    const responseText = await response.text();

    return {
      ok: response.ok,
      status: response.status,
      contentType,
      body: parseKargonomiResponseBody(contentType, responseText),
    };
  }
}

export function getKargonomiConfigDiagnostics(env: AppEnv) {
  const missing = [
    !env.KARGONOMI_BASE_URL ? KARGONOMI_ENV_NAMES.baseUrl : null,
    !env.KARGONOMI_API_TOKEN ? KARGONOMI_ENV_NAMES.apiToken : null,
  ].filter(Boolean) as string[];

  return {
    provider: KARGONOMI_PROVIDER_KEY,
    displayName: KARGONOMI_PROVIDER_DISPLAY_NAME,
    baseUrlConfigured: Boolean(env.KARGONOMI_BASE_URL),
    apiTokenConfigured: Boolean(env.KARGONOMI_API_TOKEN),
    appKeyConfigured: Boolean(env.KARGONOMI_APP_KEY),
    appKeyRequirement: 'not_required_for_account',
    defaultWarehouseIdConfigured: Boolean(env.KARGONOMI_DEFAULT_WAREHOUSE_ID),
    missing,
  };
}

export class KargonomiAdapter implements ShippingProviderAdapter {
  provider = 'KARGONOMI' as const;

  private readonly client: KargonomiClient;

  constructor(
    private readonly env: AppEnv,
    client?: KargonomiClient,
  ) {
    this.client = client ?? new KargonomiHttpClient(env);
  }

  async createShipment(input: ShippingProviderCreateInput): Promise<ShippingProviderCreateResult> {
    const shippingProviderId =
      readString(input.requestSnapshot, ['shippingProviderId', 'shipping_provider_id', 'preferredShippingProviderId']) ??
      '-1';
    const responseSnapshot: Record<string, unknown> = {
      provider: KARGONOMI_PROVIDER_KEY,
      flow: 'forward',
      providerApiCallAttempted: false,
      lastProviderStage: 'destination_resolution',
      createShipmentDraftCalled: false,
      createShipmentCalled: false,
      priceComparisonCalled: false,
      confirmShippingPriceCalled: false,
      getShipmentAfterConfirmCalled: false,
      getShipmentCalled: false,
      barcodeFetchCalled: false,
      shippingProviderId,
      automaticProviderSelection: shippingProviderId === '-1',
    };

    let payload: KargonomiShipmentCreatePayloadInput;
    try {
      payload = ensureKargonomiPayload(input.requestSnapshot);
    } catch (error) {
      throwKargonomiExecutionError(
        'destination_resolution',
        responseSnapshot,
        error instanceof Error ? error.message : 'Kargonomi shipment payload is incomplete.',
        error,
      );
    }

    responseSnapshot.lastProviderStage = 'create_shipment';
    responseSnapshot.providerApiCallAttempted = true;
    responseSnapshot.createShipmentDraftCalled = true;
    responseSnapshot.createShipmentCalled = true;
    let createResponse: KargonomiRawHttpResponse;
    try {
      createResponse = await this.client.createShipmentDraft(payload);
    } catch (error) {
      throwKargonomiExecutionError(
        'create_shipment',
        responseSnapshot,
        error instanceof Error
          ? `Kargonomi shipment draft creation failed before provider response: ${error.message}.`
          : 'Kargonomi shipment draft creation failed before provider response.',
        error,
      );
    }
    responseSnapshot.createShipmentDraftCalled = true;
    responseSnapshot.createShipmentDraft = summarizeResponse(createResponse);
    if (!createResponse.ok) {
      mergePrimaryResponseSummary(responseSnapshot, createResponse);
      throwKargonomiExecutionError(
        'create_shipment',
        responseSnapshot,
        `Kargonomi shipment draft creation failed with HTTP ${createResponse.status}.`,
      );
    }

    const shipmentId = extractShipmentId(createResponse.body);
    if (!shipmentId) {
      throwKargonomiExecutionError(
        'create_shipment',
        responseSnapshot,
        'Kargonomi shipment draft creation did not return a shipment id.',
      );
    }
    responseSnapshot.shipmentId = shipmentId;

    responseSnapshot.priceComparisonCalled = true;
    responseSnapshot.lastProviderStage = 'price_comparison';
    let priceResponse: KargonomiRawHttpResponse;
    try {
      priceResponse = await this.client.getShipmentPriceComparison(shipmentId);
    } catch (error) {
      throwKargonomiExecutionError(
        'price_comparison',
        responseSnapshot,
        error instanceof Error
          ? `Kargonomi price comparison failed before provider response: ${error.message}.`
          : 'Kargonomi price comparison failed before provider response.',
        error,
      );
    }
    responseSnapshot.priceComparison = summarizeResponse(priceResponse);
    if (!priceResponse.ok) {
      mergePrimaryResponseSummary(responseSnapshot, priceResponse);
      throwKargonomiExecutionError(
        'price_comparison',
        responseSnapshot,
        `Kargonomi price comparison failed with HTTP ${priceResponse.status}.`,
      );
    }

    responseSnapshot.confirmShippingPriceCalled = true;
    responseSnapshot.lastProviderStage = 'confirm_price';
    let confirmResponse: KargonomiRawHttpResponse;
    try {
      confirmResponse = await this.client.confirmShippingPrice({
        shipmentId,
        shippingProviderId,
      });
    } catch (error) {
      throwKargonomiExecutionError(
        'confirm_price',
        responseSnapshot,
        error instanceof Error
          ? `Kargonomi shipping price confirmation failed before provider response: ${error.message}.`
          : 'Kargonomi shipping price confirmation failed before provider response.',
        error,
      );
    }
    responseSnapshot.confirmShippingPrice = {
      ...summarizeResponse(confirmResponse),
      shipmentId,
      shippingProviderId,
    };
    if (!confirmResponse.ok) {
      mergePrimaryResponseSummary(responseSnapshot, confirmResponse);
      throwKargonomiExecutionError(
        'confirm_price',
        responseSnapshot,
        `Kargonomi shipping price confirmation failed with HTTP ${confirmResponse.status}.`,
      );
    }

    let responseBodyForNormalization = confirmResponse.body;
    try {
      responseSnapshot.lastProviderStage = 'get_shipment';
      responseSnapshot.getShipmentCalled = true;
      const shipmentResponse = await this.client.getShipment(shipmentId);
      responseSnapshot.getShipmentAfterConfirmCalled = true;
      responseSnapshot.getShipmentAfterConfirm = {
        ...summarizeResponse(shipmentResponse),
        safeFields: summarizeKargonomiShipmentSafeFields(shipmentResponse.body),
      };
      if (shipmentResponse.ok) {
        responseBodyForNormalization = shipmentResponse.body;
      }
    } catch (error) {
      responseSnapshot.getShipmentAfterConfirmCalled = true;
      responseSnapshot.getShipmentAfterConfirm = {
        ok: false,
        error: error instanceof Error ? error.message : 'Unknown shipment detail lookup error.',
      };
    }

    try {
      responseSnapshot.lastProviderStage = 'barcode_fetch';
      const barcodeResponse = await this.client.getShipmentBarcodePdf(shipmentId);
      const barcodePdf = findPotentialBarcodePdf(barcodeResponse.body);
      const barcodeLabelUrl = normalizeKargonomiPdfLabelArtifact(barcodePdf);
      responseSnapshot.barcodeFetchCalled = true;
      responseSnapshot.barcodeFetch = summarizeKargonomiBarcodeFetchDiagnostics(
        barcodeResponse,
        Boolean(barcodePdf),
        Boolean(barcodeLabelUrl),
      );
      if (barcodeLabelUrl) {
        responseSnapshot.labelUrl = barcodeLabelUrl;
        responseSnapshot.barcode = barcodeLabelUrl;
      }
    } catch (error) {
      responseSnapshot.barcodeFetchCalled = true;
      responseSnapshot.barcodeFetch = {
        ok: false,
        error: error instanceof Error ? error.message : 'Unknown barcode fetch error.',
      };
    }

    responseSnapshot.lastProviderStage = 'completed';
    return buildKargonomiProviderResult(responseBodyForNormalization, shipmentId, responseSnapshot);
  }

  async getShipmentStatus(providerShipmentId: string): Promise<ShippingProviderCreateResult> {
    const response = await this.client.getShipment(providerShipmentId);
    if (!response.ok) {
      throw new Error(`Kargonomi shipment status lookup failed with HTTP ${response.status}.`);
    }

    return buildKargonomiProviderResult(response.body, providerShipmentId, {
      provider: KARGONOMI_PROVIDER_KEY,
      flow: 'status_lookup',
      getShipment: summarizeResponse(response),
    });
  }

  async getTrackingInfo(providerShipmentId: string): Promise<ShippingProviderCreateResult> {
    return this.getShipmentStatus(providerShipmentId);
  }

  async cancelShipment(): Promise<ShippingProviderCreateResult> {
    throw new Error(KARGONOMI_CANCELLATION_UNSUPPORTED_MESSAGE);
  }

  getConfigDiagnostics() {
    return getKargonomiConfigDiagnostics(this.env);
  }
}
