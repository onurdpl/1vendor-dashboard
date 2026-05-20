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

const KARGONOMI_NOT_IMPLEMENTED_MESSAGE = 'Kargonomi adapter is not implemented yet.';

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
    appKeyRequirement: 'unknown',
    missing,
  };
}

export class KargonomiAdapter implements ShippingProviderAdapter {
  provider = 'KARGONOMI' as const;

  constructor(private readonly env: AppEnv) {}

  async createShipment(_input: ShippingProviderCreateInput): Promise<ShippingProviderCreateResult> {
    throw new Error(KARGONOMI_NOT_IMPLEMENTED_MESSAGE);
  }

  async getShipmentStatus(): Promise<ShippingProviderCreateResult> {
    throw new Error(KARGONOMI_NOT_IMPLEMENTED_MESSAGE);
  }

  async getTrackingInfo(): Promise<ShippingProviderCreateResult> {
    throw new Error(KARGONOMI_NOT_IMPLEMENTED_MESSAGE);
  }

  async cancelShipment(): Promise<ShippingProviderCreateResult> {
    throw new Error(KARGONOMI_NOT_IMPLEMENTED_MESSAGE);
  }

  getConfigDiagnostics() {
    return getKargonomiConfigDiagnostics(this.env);
  }
}
