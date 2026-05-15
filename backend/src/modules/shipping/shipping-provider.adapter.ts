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
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input.requestSnapshot),
    });
    const contentType = response.headers.get('content-type') ?? '';
    const responseText = await response.text();
    const parsedBody = parseResponseBody(contentType, responseText);
    const body = isRecord(parsedBody) ? parsedBody : {};

    const responseSnapshot = {
      status: response.status,
      ok: response.ok,
      contentType,
      bodyKeys: Object.keys(body).sort(),
      provider: 'kargo_entegrator',
      providerError: readString(body, ['error', 'message', 'errors', 'detail']),
    };

    if (!response.ok) {
      throw new ShippingProviderExecutionError(
        `Kargo Entegratör shipment execution failed with HTTP ${response.status}.`,
        responseSnapshot,
      );
    }

    return {
      providerShipmentId: readString(body, ['providerShipmentId', 'shipmentId', 'id', 'cargoId', 'barcode']),
      trackingNumber: readString(body, ['trackingNumber', 'trackingNo', 'cargoTrackingNo', 'barcode']),
      trackingUrl: readString(body, ['trackingUrl', 'trackingLink', 'cargoTrackingUrl']),
      labelUrl: readString(body, ['labelUrl', 'labelPdfUrl', 'pdfUrl', 'barcodeUrl']),
      shipmentStatus: mapShipmentStatus(readString(body, ['shipmentStatus', 'status', 'cargoStatus'])),
      shippingCost: readNumber(body, ['shippingCost', 'cost', 'amount', 'cargoPrice']),
      shippingVat: readNumber(body, ['shippingVat', 'shippingVatAmount', 'vat']),
      currency: readString(body, ['currency']) ?? 'TRY',
      responseSnapshot,
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
