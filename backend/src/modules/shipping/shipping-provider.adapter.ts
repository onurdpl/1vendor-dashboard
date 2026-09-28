import type { AppEnv } from '../../config/env.js';
import type { ShipmentExecutionStatusDto, ShippingProviderDto } from './shipping-execution.types.js';
import { KargonomiAdapter } from './kargonomi-provider.adapter.js';

export type ShippingProviderCreateInput = {
  allocationId: string;
  vendorId: string;
  provider: ShippingProviderDto;
  requestSnapshot: Record<string, unknown>;
  endpointPath?: string | null;
  retryContext?: {
    isRetry?: boolean;
    existingOrderId?: string | null;
    existingProviderOrderId?: string | null;
    existingOrderAlreadyExists?: boolean;
  };
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

export type ShippingProviderUpdateInput = {
  providerShipmentId: string;
  requestSnapshot: Record<string, unknown>;
};

export type ShippingProviderReturnCreateInput = {
  orderId: string;
  items: Array<{
    sku: string;
    quantity: string;
  }>;
  pickupLocationCode?: string | null;
  deliveryOptionId?: string | null;
  packageWeight?: number | null;
  requestSnapshot?: Record<string, unknown>;
  endpointPath?: string | null;
};

export type ShippingProviderReturnCreateResult = {
  returnOrderId: string | null;
  returnTrackingNumber: string | null;
  returnTrackingUrl: string | null;
  returnLabelUrl: string | null;
  returnBarcode: string | null;
  returnCarrierName?: string | null;
  returnStatus: string | null;
  responseSnapshot: Record<string, unknown>;
};

export type ShippingProviderReturnDetailsProbeResult = {
  returnLabelUrl: string | null;
  returnTrackingNumber: string | null;
  returnBarcode: string | null;
  returnStatus: string | null;
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
  provider: 'HEPSIJET' | 'TRY_OTO' | 'KARGONOMI' | 'NAVLUNGO';
  createShipment(input: ShippingProviderCreateInput): Promise<ShippingProviderCreateResult>;
  refreshProviderData?(providerShipmentId: string): Promise<ShippingProviderCreateResult>;
  createReturnShipment?(input: ShippingProviderReturnCreateInput): Promise<ShippingProviderReturnCreateResult>;
  probeReturnDetails?(orderId: string): Promise<ShippingProviderReturnDetailsProbeResult>;
  probeReturnLink?(orderId: string): Promise<ShippingProviderReturnDetailsProbeResult>;
  probeReturnAwbPrint?(returnOrderId: string): Promise<ShippingProviderReturnDetailsProbeResult>;
  getShipmentStatus(providerShipmentId: string): Promise<ShippingProviderCreateResult>;
  getTrackingInfo(providerShipmentId: string): Promise<ShippingProviderCreateResult>;
  cancelShipment(providerShipmentId: string): Promise<ShippingProviderCreateResult>;
  updateShipment?(input: ShippingProviderUpdateInput): Promise<ShippingProviderCreateResult>;
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


export function createShippingProviderAdapter(
  env: AppEnv,
  provider: ShippingProviderDto = 'hepsijet',
): ShippingProviderAdapter {
  if (provider === 'try_oto') {
    throw new Error('Try OTO is retired. Kargonomi is the only active shipping provider.');
  }
  if (provider === 'kargonomi') {
    return new KargonomiAdapter(env);
  }
  if (provider === 'navlungo') {
    throw new Error('Navlungo is retired. Kargonomi is the only active shipping provider.');
  }

  return new HepsijetAdapter(env);
}
