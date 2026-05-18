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

function toSafeDiagnosticString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) {
    return value.trim().slice(0, 240);
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return null;
}

function collectSafeDiagnosticStrings(value: unknown, output: string[] = []): string[] {
  if (output.length >= 8) {
    return output;
  }

  const scalar = toSafeDiagnosticString(value);
  if (scalar) {
    output.push(scalar);
    return output;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectSafeDiagnosticStrings(item, output);
      if (output.length >= 8) {
        break;
      }
    }
    return output;
  }

  if (isRecord(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (/token|secret|authorization|bearer|password|api[_-]?key/i.test(key)) {
        continue;
      }
      collectSafeDiagnosticStrings(item, output);
      if (output.length >= 8) {
        break;
      }
    }
  }

  return output;
}

function readSafeValidationErrors(value: Record<string, unknown>) {
  const candidates = [value.errors, value.validation, value.validation_errors, value.error_details];
  return Array.from(new Set(candidates.flatMap((candidate) => collectSafeDiagnosticStrings(candidate)))).slice(0, 8);
}

function readSafeProviderError(value: Record<string, unknown>) {
  return (
    readString(value, ['message', 'error', 'detail', 'status']) ??
    readSafeValidationErrors(value)[0] ??
    null
  );
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
    .replace(/"((?:token|secret|authorization|bearer|password|api[_-]?key))"\s*:\s*"[^"]*"/gi, '"$1":"[redacted]"')
    .replace(/"((?:phone|email|address|name|surname|customer[_-]?name))"\s*:\s*"[^"]*"/gi, '"$1":"[redacted]"')
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

function readCargoCompanyId(snapshot: Record<string, unknown>) {
  const cargoCompany = snapshot.cargo_company;
  if (isRecord(cargoCompany)) {
    return readString(cargoCompany, ['id']);
  }

  return readString(snapshot, ['cargo_company_id', 'cargoCompanyId', 'carrier_id', 'carrierId']);
}

function getKargoRequestTarget(baseUrl: string | undefined) {
  if (!baseUrl) {
    return {
      selectedBaseUrl: null,
      requestTargetHostname: null,
      requestPath: null,
      productionEndpointSelected: false,
    };
  }

  const selectedBaseUrl = baseUrl.replace(/\/$/, '');
  try {
    const requestUrl = new URL(`${selectedBaseUrl}/shipments`);
    return {
      selectedBaseUrl,
      requestTargetHostname: requestUrl.hostname,
      requestPath: requestUrl.pathname,
      productionEndpointSelected: requestUrl.hostname === 'app.kargoentegrator.com',
    };
  } catch {
    return {
      selectedBaseUrl,
      requestTargetHostname: null,
      requestPath: null,
      productionEndpointSelected: false,
    };
  }
}

function logKargoProviderEnvironmentSelection(input: ShippingProviderCreateInput, env: AppEnv) {
  const target = getKargoRequestTarget(env.KARGO_ENTEGRATOR_BASE_URL);
  const dummyModeEnabled = readCargoCompanyId(input.requestSnapshot) === 'dummy';
  const executionEnabled = env.SHIPPING_EXECUTION_ENABLED && env.KARGO_ENTEGRATOR_ENABLED;

  console.info('[shipping:kargo:provider-environment]', {
    provider: 'kargo_entegrator',
    selectedEnvironment: env.SHIPPING_SANDBOX_MODE ? 'sandbox' : 'production',
    selectedBaseUrl: target.selectedBaseUrl,
    requestTargetHostname: target.requestTargetHostname,
    requestPath: target.requestPath,
    productionEndpointSelected: target.productionEndpointSelected,
    providerMode: !executionEnabled ? 'disabled' : dummyModeEnabled ? 'dummy' : 'live',
    dummyModeEnabled,
    shippingExecutionEnabled: env.SHIPPING_EXECUTION_ENABLED,
    providerEnabled: env.KARGO_ENTEGRATOR_ENABLED,
    sandboxModeEnabled: env.SHIPPING_SANDBOX_MODE,
  });
}

function getKargoProviderEnvironmentDiagnostics(input: ShippingProviderCreateInput, env: AppEnv) {
  const target = getKargoRequestTarget(env.KARGO_ENTEGRATOR_BASE_URL);
  const dummyModeEnabled = readCargoCompanyId(input.requestSnapshot) === 'dummy';
  const executionEnabled = env.SHIPPING_EXECUTION_ENABLED && env.KARGO_ENTEGRATOR_ENABLED;

  return {
    selectedEnvironment: env.SHIPPING_SANDBOX_MODE ? 'sandbox' : 'production',
    requestTargetHostname: target.requestTargetHostname,
    requestPath: target.requestPath,
    providerMode: !executionEnabled ? 'disabled' : dummyModeEnabled ? 'dummy' : 'live',
  };
}

function hasValue(value: unknown) {
  return value !== null && value !== undefined && value !== '';
}

function safeValueType(value: unknown) {
  if (!hasValue(value)) {
    return null;
  }
  if (Array.isArray(value)) {
    return 'array';
  }
  return typeof value;
}

function buildKargoPayloadDiagnostics(payload: Record<string, unknown>) {
  const customer = isRecord(payload.customer) ? payload.customer : {};
  const receiver = isRecord(payload.receiver) ? payload.receiver : null;
  const addressFieldPresence = {
    customerAddress: hasValue(customer.address),
    customerPostcode: hasValue(customer.postcode),
    customerCountry: hasValue(customer.country),
    customerCity: hasValue(customer.city),
    customerDistrict: hasValue(customer.district),
  };

  return {
    topLevelKeys: Object.keys(payload).sort(),
    customerKeys: Object.keys(customer).sort(),
    receiverKeys: receiver ? Object.keys(receiver).sort() : [],
    cargoIntegrationIdPresent: hasValue(payload.cargo_integration_id),
    warehouseIdPresent: hasValue(payload.warehouse_id),
    paymentType: typeof payload.payment_type === 'string' ? payload.payment_type : null,
    packageType: typeof payload.package_type === 'string' ? payload.package_type : null,
    payorType: typeof payload.payor_type === 'string' ? payload.payor_type : null,
    kgPresent: hasValue(payload.kg),
    kgType: safeValueType(payload.kg),
    desiPresent: hasValue(payload.desi),
    desiType: safeValueType(payload.desi),
    platformIdPresent: hasValue(payload.platform_id),
    platformDIdPresent: hasValue(payload.platform_d_id),
    customerPhonePresent: hasValue(customer.phone),
    customerDistrictPresent: hasValue(customer.district),
    customerCityPresent: hasValue(customer.city),
    addressFieldPresence,
  };
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
    logKargoProviderEnvironmentSelection(input, this.env);
    const providerEnvironment = getKargoProviderEnvironmentDiagnostics(input, this.env);
    const payloadDiagnostics = buildKargoPayloadDiagnostics(input.requestSnapshot);

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

    const requestUrl = `${this.env.KARGO_ENTEGRATOR_BASE_URL.replace(/\/$/, '')}/shipments`;
    const response = await fetch(requestUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.env.KARGO_ENTEGRATOR_API_KEY}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input.requestSnapshot),
    });
    const contentType = response.headers.get('content-type') ?? '';
    const providerRequestId =
      response.headers.get('x-request-id') ??
      response.headers.get('x-correlation-id') ??
      response.headers.get('request-id');
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
      providerError: readSafeProviderError(body),
      providerValidationErrors: readSafeValidationErrors(body),
      requestId: providerRequestId ?? readString(body, ['request_id', 'requestId', 'correlation_id', 'correlationId']),
      statusField: readString(body, ['shipmentStatus', 'status', 'cargoStatus']),
      detectedResponseFormat,
      responseSnippet,
      authHeaderMode: 'bearer',
      acceptHeader: 'application/json',
      notificationUrlIncluded: typeof input.requestSnapshot.notification_url === 'string' && input.requestSnapshot.notification_url.trim().length > 0,
      requestPath: providerEnvironment.requestPath,
      selectedEnvironment: providerEnvironment.selectedEnvironment,
      requestTargetHostname: providerEnvironment.requestTargetHostname,
      providerMode: providerEnvironment.providerMode,
      payloadDiagnostics,
    };

    console.info('[shipping:kargo:provider-create-diagnostics]', {
      provider: 'kargo_entegrator',
      httpStatus: response.status,
      providerMessage: responseSnapshot.providerError,
      requestPath: providerEnvironment.requestPath,
      selectedEnvironment: providerEnvironment.selectedEnvironment,
      requestTargetHostname: providerEnvironment.requestTargetHostname,
      providerMode: providerEnvironment.providerMode,
      payloadDiagnostics,
    });

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
