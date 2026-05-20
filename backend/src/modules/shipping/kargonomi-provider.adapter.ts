import type { AppEnv } from '../../config/env.js';
import type { ShipmentExecutionStatusDto } from './shipping-execution.types.js';
import type {
  ShippingProviderAdapter,
  ShippingProviderCreateInput,
  ShippingProviderCreateResult,
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

export type KargonomiConfirmShippingPriceInput = {
  shipmentId: string | number;
  shippingProviderId: string | number;
};

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

function summarizeResponse(response: KargonomiRawHttpResponse) {
  return {
    ok: response.ok,
    httpStatus: response.status,
    contentType: response.contentType,
    bodyKeys: isRecord(response.body) ? Object.keys(response.body) : [],
  };
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
  const shippingCost =
    parseMoney(parsed.pricing.realPrice) ??
    parseMoney(parsed.pricing.estimatedPrice) ??
    readNumber(isRecord(responseBody) ? responseBody : {}, ['price', 'shipping_price', 'total_price']);

  return {
    providerShipmentId,
    trackingNumber,
    trackingUrl: null,
    labelUrl: null,
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
      barcodePresent: Boolean(parsed.shippingWebserviceBarcode ?? parsed.barcodeOfOrderId),
      labelUrlPresent: false,
      labelUnavailableReason: 'barcode_pdf_response_shape_unknown_or_unavailable',
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
    const payload = ensureKargonomiPayload(input.requestSnapshot);
    const shippingProviderId =
      readString(input.requestSnapshot, ['shippingProviderId', 'shipping_provider_id', 'preferredShippingProviderId']) ??
      '-1';
    const responseSnapshot: Record<string, unknown> = {
      provider: KARGONOMI_PROVIDER_KEY,
      flow: 'forward',
      createShipmentDraftCalled: false,
      priceComparisonCalled: false,
      confirmShippingPriceCalled: false,
      barcodeFetchCalled: false,
      shippingProviderId,
      automaticProviderSelection: shippingProviderId === '-1',
    };

    const createResponse = await this.client.createShipmentDraft(payload);
    responseSnapshot.createShipmentDraftCalled = true;
    responseSnapshot.createShipmentDraft = summarizeResponse(createResponse);
    if (!createResponse.ok) {
      throw new Error(`Kargonomi shipment draft creation failed with HTTP ${createResponse.status}.`);
    }

    const shipmentId = extractShipmentId(createResponse.body);
    if (!shipmentId) {
      throw new Error('Kargonomi shipment draft creation did not return a shipment id.');
    }
    responseSnapshot.shipmentId = shipmentId;

    const priceResponse = await this.client.getShipmentPriceComparison(shipmentId);
    responseSnapshot.priceComparisonCalled = true;
    responseSnapshot.priceComparison = summarizeResponse(priceResponse);
    if (!priceResponse.ok) {
      throw new Error(`Kargonomi price comparison failed with HTTP ${priceResponse.status}.`);
    }

    const confirmResponse = await this.client.confirmShippingPrice({
      shipmentId,
      shippingProviderId,
    });
    responseSnapshot.confirmShippingPriceCalled = true;
    responseSnapshot.confirmShippingPrice = summarizeResponse(confirmResponse);
    if (!confirmResponse.ok) {
      throw new Error(`Kargonomi shipping price confirmation failed with HTTP ${confirmResponse.status}.`);
    }

    try {
      const barcodeResponse = await this.client.getShipmentBarcodePdf(shipmentId);
      const barcodePdf = findPotentialBarcodePdf(barcodeResponse.body);
      responseSnapshot.barcodeFetchCalled = true;
      responseSnapshot.barcodeFetch = {
        ...summarizeResponse(barcodeResponse),
        pdfLikeValuePresent: Boolean(barcodePdf),
      };
    } catch (error) {
      responseSnapshot.barcodeFetchCalled = true;
      responseSnapshot.barcodeFetch = {
        ok: false,
        error: error instanceof Error ? error.message : 'Unknown barcode fetch error.',
      };
    }

    return buildKargonomiProviderResult(confirmResponse.body, shipmentId, responseSnapshot);
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
