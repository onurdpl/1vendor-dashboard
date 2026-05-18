import type { AppEnv } from '../../config/env.js';
import type { ShipmentExecutionStatusDto, ShippingProviderDto } from './shipping-execution.types.js';

export type ShippingProviderCreateInput = {
  allocationId: string;
  vendorId: string;
  provider: ShippingProviderDto;
  requestSnapshot: Record<string, unknown>;
};

export type ShippingProviderCreateResult = {
  providerShipmentId: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  labelUrl: string | null;
  shipmentStatus: ShipmentExecutionStatusDto;
  shippingCost: number | null;
  shippingVat: number | null;
  currency: string;
  responseSnapshot: Record<string, unknown>;
};

export class ShippingProviderExecutionError extends Error {
  constructor(
    message: string,
    readonly responseSnapshot: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ShippingProviderExecutionError';
  }
}

export interface ShippingProviderAdapter {
  provider: 'HEPSIJET' | 'KARGO_ENTEGRATOR';
  createShipment(input: ShippingProviderCreateInput): Promise<ShippingProviderCreateResult>;
  getShipmentStatus(providerShipmentId: string): Promise<ShippingProviderCreateResult>;
  getTrackingInfo(providerShipmentId: string): Promise<ShippingProviderCreateResult>;
  cancelShipment(providerShipmentId: string): Promise<ShippingProviderCreateResult>;
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
  }

  return null;
}

function readNumber(value: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const raw = value[key];
    const numeric = Number(raw);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }

  return null;
}

function readBoolean(value: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const raw = value[key];
    if (typeof raw === 'boolean') {
      return raw;
    }
  }

  return null;
}

function parseResponseBody(contentType: string, responseText: string): unknown {
  if (!contentType.includes('application/json') || !responseText) {
    return responseText;
  }

  try {
    return JSON.parse(responseText);
  } catch {
    return responseText;
  }
}

function sanitizeResponseSnippet(value: string) {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
}

function getDetectedResponseFormat(contentType: string, parsedBody: unknown) {
  if (!parsedBody) {
    return 'empty';
  }

  if (contentType.includes('text/html')) {
    return 'html';
  }

  if (isRecord(parsedBody)) {
    const data = parsedBody.data;
    if (isRecord(data)) {
      return 'json:data_object';
    }
    if (Array.isArray(data)) {
      return 'json:data_array';
    }
    return contentType.includes('application/json') ? 'json:object' : 'object';
  }

  if (Array.isArray(parsedBody)) {
    return contentType.includes('application/json') ? 'json:array' : 'array';
  }

  if (contentType.includes('application/json')) {
    return 'invalid_json';
  }

  return typeof parsedBody;
}

function getProviderResponseRecord(parsedBody: unknown) {
  if (!isRecord(parsedBody)) {
    return {};
  }

  const data = parsedBody.data;
  if (isRecord(data)) {
    return data;
  }

  if (Array.isArray(data)) {
    const first = data.find(isRecord);
    return first ?? {};
  }

  return parsedBody;
}

function mapShipmentStatus(value: string | null): ShipmentExecutionStatusDto {
  const normalized = value?.trim().toLowerCase() ?? '';
  if (normalized === 'in_transit' || normalized === 'in transit' || normalized === 'shipped') {
    return 'in_transit';
  }
  if (
    normalized === 'created' ||
    normalized === 'label_created' ||
    normalized === 'label created' ||
    normalized === 'ready'
  ) {
    return 'created';
  }
  if (normalized === 'delivered') {
    return 'delivered';
  }
  if (normalized === 'returned') {
    return 'returned';
  }
  if (normalized === 'cancelled' || normalized === 'canceled') {
    return 'cancelled';
  }
  if (normalized === 'failed' || normalized === 'error') {
    return 'failed';
  }
  return 'pending';
}

export class HepsijetAdapter implements ShippingProviderAdapter {
  provider = 'HEPSIJET' as const;

  constructor(private readonly env: AppEnv) {}

  async createShipment(input: ShippingProviderCreateInput): Promise<ShippingProviderCreateResult> {
    if (!this.env.SHIPPING_EXECUTION_ENABLED) {
      return {
        providerShipmentId: null,
        trackingNumber: null,
        trackingUrl: null,
        labelUrl: null,
        shipmentStatus: 'pending',
        shippingCost: null,
        shippingVat: null,
        currency: 'TRY',
        responseSnapshot: {
          ok: true,
          dryRun: true,
          provider: 'hepsijet',
          reason: 'Hepsijet shipment execution is disabled.',
        },
      };
    }

    throw new Error('Hepsijet live shipment execution is not configured in this deployment.');
  }

  async getShipmentStatus(): Promise<ShippingProviderCreateResult> {
    throw new Error('Hepsijet shipment status polling is not implemented in Phase 20B.');
  }

  async getTrackingInfo(): Promise<ShippingProviderCreateResult> {
    throw new Error('Hepsijet tracking polling is not implemented in Phase 20B.');
  }

  async cancelShipment(): Promise<ShippingProviderCreateResult> {
    throw new Error('Hepsijet shipment cancellation is not implemented in Phase 20B.');
  }
}

export class KargoEntegratorAdapter implements ShippingProviderAdapter {
  provider = 'KARGO_ENTEGRATOR' as const;

  constructor(private readonly env: AppEnv) {}

  async createShipment(input: ShippingProviderCreateInput): Promise<ShippingProviderCreateResult> {
    if (!this.env.SHIPPING_EXECUTION_ENABLED || !this.env.KARGO_ENTEGRATOR_ENABLED) {
      const disabledGates = [
        !this.env.SHIPPING_EXECUTION_ENABLED ? 'SHIPPING_EXECUTION_ENABLED' : null,
        !this.env.KARGO_ENTEGRATOR_ENABLED ? 'KARGO_ENTEGRATOR_ENABLED' : null,
      ].filter((gate): gate is string => Boolean(gate));

      return {
        providerShipmentId: null,
        trackingNumber: null,
        trackingUrl: null,
        labelUrl: null,
        shipmentStatus: 'pending',
        shippingCost: null,
        shippingVat: null,
        currency: 'TRY',
        responseSnapshot: {
          ok: true,
          dryRun: true,
          provider: 'kargo_entegrator',
          reason: 'Kargo Entegratör shipment execution is disabled.',
          disabledGates,
        },
      };
    }

    if (!this.env.KARGO_ENTEGRATOR_BASE_URL || !this.env.KARGO_ENTEGRATOR_API_KEY) {
      throw new Error('Kargo Entegratör shipment execution is not configured.');
    }

    const response = await fetch(`${this.env.KARGO_ENTEGRATOR_BASE_URL.replace(/\/$/, '')}/shipments`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.env.KARGO_ENTEGRATOR_API_KEY}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input.requestSnapshot),
    });
    const contentType = response.headers.get('content-type') ?? '';
    const responseText = await response.text();
    const parsedBody = parseResponseBody(contentType, responseText);
    const body = getProviderResponseRecord(parsedBody);
    const parsedBodyType = Array.isArray(parsedBody) ? 'array' : typeof parsedBody;
    const detectedResponseFormat = getDetectedResponseFormat(contentType, parsedBody);
    const responseSnippet = sanitizeResponseSnippet(responseText);

    const responseSnapshot = {
      status: response.status,
      ok: response.ok,
      contentType,
      parsedBodyType,
      bodyKeys: Object.keys(body).sort(),
      topLevelKeys: isRecord(parsedBody) ? Object.keys(parsedBody).sort() : [],
      provider: 'kargo_entegrator',
      providerError: readString(body, ['error', 'message', 'errors', 'detail']),
      statusField: readString(body, ['shipmentStatus', 'status', 'cargoStatus']),
      detectedResponseFormat,
      responseSnippet,
      authHeaderMode: 'bearer',
      acceptHeader: 'application/json',
    };

    if (!response.ok) {
      throw new ShippingProviderExecutionError(
        `Kargo Entegratör shipment execution failed with HTTP ${response.status}.`,
        responseSnapshot,
      );
    }

    if (!contentType.includes('application/json') || !isRecord(parsedBody)) {
      throw new ShippingProviderExecutionError(
        'Kargo Entegratör returned an invalid provider response format.',
        {
          ...responseSnapshot,
          providerError:
            detectedResponseFormat === 'html'
              ? 'Provider returned HTML instead of JSON. Check endpoint and Bearer authentication.'
              : 'Provider returned a non-JSON response.',
        },
      );
    }

    return {
      providerShipmentId: readString(body, ['providerShipmentId', 'shipmentId', 'id', 'cargoId', 'barcode']),
      trackingNumber: readString(body, ['tracking_number', 'trackingNumber', 'trackingNo', 'cargoTrackingNo', 'barcode']),
      trackingUrl: readString(body, ['tracking_url', 'trackingUrl', 'trackingLink', 'cargoTrackingUrl']),
      labelUrl: readString(body, ['label_url', 'labelUrl', 'labelPdfUrl', 'pdfUrl', 'barcodeUrl']),
      shipmentStatus: mapShipmentStatus(readString(body, ['shipmentStatus', 'status', 'cargoStatus'])),
      shippingCost: readNumber(body, ['shipping_cost', 'shippingCost', 'cost', 'amount', 'cargoPrice']),
      shippingVat: readNumber(body, ['shipping_vat', 'shippingVat', 'shippingVatAmount', 'vat']),
      currency: readString(body, ['currency']) ?? 'TRY',
      responseSnapshot: {
        ...responseSnapshot,
        barcode: readString(body, ['barcode', 'barcode_number', 'barcodeNumber']),
        dummyCarrierDetected:
          readString(body, ['cargo_company_id', 'cargoCompanyId', 'carrier_id', 'carrierId']) === 'dummy' ||
          readString(body, ['cargo_company', 'cargoCompany', 'carrier']) === 'dummy' ||
          readBoolean(body, ['dummyCarrierDetected']) === true,
        lastProviderResponseAt: new Date().toISOString(),
      },
    };
  }

  async getShipmentStatus(): Promise<ShippingProviderCreateResult> {
    throw new Error('Kargo Entegratör shipment status polling is not implemented in this phase.');
  }

  async getTrackingInfo(): Promise<ShippingProviderCreateResult> {
    throw new Error('Kargo Entegratör tracking polling is not implemented in this phase.');
  }

  async cancelShipment(): Promise<ShippingProviderCreateResult> {
    throw new Error('Kargo Entegratör shipment cancellation is not implemented in this phase.');
  }
}

export function createShippingProviderAdapter(
  env: AppEnv,
  provider: ShippingProviderDto = 'hepsijet',
): ShippingProviderAdapter {
  if (provider === 'kargo_entegrator') {
    return new KargoEntegratorAdapter(env);
  }

  return new HepsijetAdapter(env);
}
