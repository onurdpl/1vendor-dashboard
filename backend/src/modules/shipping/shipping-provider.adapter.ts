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

export interface ShippingProviderAdapter {
  provider: 'HEPSIJET';
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
    if (!this.env.SHIPPING_EXECUTION_ENABLED || !this.env.HEPSIJET_ENABLED) {
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

    if (!this.env.HEPSIJET_BASE_URL || !this.env.HEPSIJET_API_KEY) {
      throw new Error('Hepsijet shipment execution is not configured.');
    }

    const response = await fetch(`${this.env.HEPSIJET_BASE_URL.replace(/\/$/, '')}/shipments`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.env.HEPSIJET_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input.requestSnapshot),
    });
    const contentType = response.headers.get('content-type') ?? '';
    const responseText = await response.text();
    const parsedBody = parseResponseBody(contentType, responseText);
    const body = isRecord(parsedBody) ? parsedBody : {};

    if (!response.ok) {
      throw new Error(`Hepsijet shipment execution failed with HTTP ${response.status}.`);
    }

    return {
      providerShipmentId: readString(body, ['providerShipmentId', 'shipmentId', 'id', 'barcode']),
      trackingNumber: readString(body, ['trackingNumber', 'trackingNo', 'barcode']),
      trackingUrl: readString(body, ['trackingUrl', 'trackingLink']),
      labelUrl: readString(body, ['labelUrl', 'labelPdfUrl', 'pdfUrl']),
      shipmentStatus: mapShipmentStatus(readString(body, ['shipmentStatus', 'status'])),
      shippingCost: readNumber(body, ['shippingCost', 'cost', 'amount']),
      shippingVat: readNumber(body, ['shippingVat', 'shippingVatAmount', 'vat']),
      currency: readString(body, ['currency']) ?? 'TRY',
      responseSnapshot: {
        status: response.status,
        ok: response.ok,
        contentType,
        bodyKeys: Object.keys(body).sort(),
        provider: 'hepsijet',
      },
    };
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

export function createShippingProviderAdapter(env: AppEnv): ShippingProviderAdapter {
  return new HepsijetAdapter(env);
}
