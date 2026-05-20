import type { AppEnv } from '../../config/env.js';
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
