import type { AppEnv } from '../../config/env.js';
import type { ShipmentExecutionStatusDto, ShippingProviderDto } from './shipping-execution.types.js';

export type ShippingProviderCreateInput = {
  allocationId: string;
  vendorId: string;
  provider: ShippingProviderDto;
  requestSnapshot: Record<string, unknown>;
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

export type ShippingProviderReturnCreateInput = {
  orderId: string;
  items: Array<{
    sku: string;
    quantity: string;
  }>;
  pickupLocationCode?: string | null;
  deliveryOptionId?: string | null;
  packageWeight?: number | null;
};

export type ShippingProviderReturnCreateResult = {
  returnOrderId: string | null;
  returnTrackingNumber: string | null;
  returnTrackingUrl: string | null;
  returnLabelUrl: string | null;
  returnBarcode: string | null;
  returnStatus: string | null;
  responseSnapshot: Record<string, unknown>;
};

export type ShippingProviderReturnFinalizeInput = {
  returnOrderId: string;
  packageWeight?: number | null;
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
  provider: 'HEPSIJET' | 'KARGO_ENTEGRATOR' | 'TRY_OTO';
  createShipment(input: ShippingProviderCreateInput): Promise<ShippingProviderCreateResult>;
  createReturnShipment?(input: ShippingProviderReturnCreateInput): Promise<ShippingProviderReturnCreateResult>;
  finalizeReturnShipment?(input: ShippingProviderReturnFinalizeInput): Promise<ShippingProviderReturnCreateResult>;
  probeReturnDetails?(orderId: string): Promise<ShippingProviderReturnDetailsProbeResult>;
  probeReturnLink?(orderId: string): Promise<ShippingProviderReturnDetailsProbeResult>;
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
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      return String(raw);
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
    readString(value, ['providerError', 'errorMsg', 'otoErrorMessage', 'message', 'error', 'detail', 'status', 'errorMessage']) ??
    readSafeValidationErrors(value)[0] ??
    null
  );
}

function readSafeProviderErrorCode(value: Record<string, unknown>) {
  return readString(value, ['providerErrorCode', 'errorCode', 'otoErrorCode', 'code']);
}

function isTryOtoOrderAlreadyExists(snapshot: Record<string, unknown>) {
  const code = readSafeProviderErrorCode(snapshot);
  if (code?.trim().toUpperCase() === 'OTO1063') {
    return true;
  }

  const message = readSafeProviderError(snapshot);
  return Boolean(message && /order id is already exist/i.test(message));
}

function isTryOtoShipmentAlreadyInProgress(snapshot: Record<string, unknown>) {
  const code = readSafeProviderErrorCode(snapshot);
  if (code?.trim().toUpperCase() === 'OTO1011') {
    return true;
  }

  const message = readSafeProviderError(snapshot);
  return Boolean(message && /(shipment.*(already exist|in progress)|there is a shipment in progress)/i.test(message));
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

function buildTryOtoPayloadDiagnostics(payload: Record<string, unknown>) {
  const customer = isRecord(payload.customer) ? payload.customer : {};
  return {
    topLevelKeys: Object.keys(payload).sort(),
    customerKeys: Object.keys(customer).sort(),
    itemCount: Array.isArray(payload.items) ? payload.items.length : 0,
    orderIdPresent: hasValue(payload.orderId),
    externalOrderReferencePresent: hasValue(payload.externalOrderReference),
    internalOrderReferencePresent: hasValue(payload.internalOrderReference),
    legacyInternalReferenceUsed: payload.legacyInternalReferenceUsed === true,
    pickupLocationCodePresent: hasValue(payload.pickupLocationCode),
    paymentMethod: typeof payload.payment_method === 'string' ? payload.payment_method : null,
    amountPresent: hasValue(payload.amount),
    amountDuePresent: hasValue(payload.amount_due),
    currency: typeof payload.currency === 'string' ? payload.currency : null,
    packageWeightPresent: hasValue(payload.packageWeight),
    packageWeightType: safeValueType(payload.packageWeight),
    customerNamePresent: hasValue(customer.name),
    customerMobilePresent: hasValue(customer.mobile),
    customerAddressPresent: hasValue(customer.address),
    customerCityPresent: hasValue(customer.city),
    customerCountryPresent: hasValue(customer.country),
    customerDistrictPresent: hasValue(customer.district),
    deliveryOptionIdPresent: hasValue(payload.deliveryOptionId),
  };
}

function readTryOtoLabelUrl(value: Record<string, unknown>) {
  return readString(value, [
    'printLabelURL',
    'printLabelUrl',
    'printAWBURL',
    'printAwbURL',
    'printAwBUrl',
    'labelUrl',
    'labelURL',
    'awbUrl',
    'awbURL',
  ]);
}

function readTryOtoTrackingNumber(value: Record<string, unknown>) {
  return readString(value, ['trackingNumber', 'dcTrackingNumber']);
}

function readTryOtoBarcode(value: Record<string, unknown>) {
  return readString(value, ['barcode', 'barcodeNumber', 'barCode', 'awbNumber']);
}

function readTryOtoReturnOrderId(value: Record<string, unknown>) {
  return readString(value, ['returnOrderId', 'return_order_id', 'reverseOrderId', 'reverseShipmentId', 'orderId']);
}

function readTryOtoDeliveryOptionId(value: Record<string, unknown>) {
  return readString(value, ['deliveryOptionId', 'delivery_option_id']);
}

function collectNestedKeys(value: unknown, maxDepth = 3, prefix = ''): string[] {
  if (maxDepth < 0 || !value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.slice(0, 3).flatMap((item, index) => collectNestedKeys(item, maxDepth - 1, `${prefix}[${index}]`));
  }
  if (!isRecord(value)) {
    return [];
  }

  return Object.keys(value)
    .sort()
    .flatMap((key) => {
      const path = prefix ? `${prefix}.${key}` : key;
      return [path, ...collectNestedKeys(value[key], maxDepth - 1, path)];
    })
    .slice(0, 80);
}

function findNestedStringByKeyPattern(value: unknown, pattern: RegExp): string | null {
  if (!value) {
    return null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findNestedStringByKeyPattern(item, pattern);
      if (found) {
        return found;
      }
    }
    return null;
  }
  if (!isRecord(value)) {
    return null;
  }

  for (const [key, item] of Object.entries(value)) {
    if (pattern.test(key) && (typeof item === 'string' || typeof item === 'number')) {
      const normalized = String(item).trim();
      if (normalized) {
        return normalized;
      }
    }
    const found = findNestedStringByKeyPattern(item, pattern);
    if (found) {
      return found;
    }
  }
  return null;
}

function hasNestedKeyPattern(value: unknown, pattern: RegExp) {
  return collectNestedKeys(value).some((key) => pattern.test(key));
}

function readTryOtoDeliveryCompanyName(value: Record<string, unknown>) {
  return readString(value, ['deliveryCompanyName', 'deliveryOptionName', 'companyName', 'name']);
}

function readTryOtoReturnPriceOptionId(value: Record<string, unknown>) {
  return readString(value, ['priceOptionId', 'price_option_id']);
}

function readTryOtoReturnDcSettingsId(value: Record<string, unknown>) {
  return readNumber(value, ['dcSettingsID', 'dcSettingsId', 'dc_settings_id']);
}

function getTryOtoReturnPriceOptions(value: Record<string, unknown>) {
  const candidates = [
    value.priceOptions,
    value.options,
    value.deliveryOptions,
    value.deliveryCompany,
    value.deliveryCompanies,
    value.items,
  ];
  const fromArrays = candidates.find((candidate): candidate is unknown[] => Array.isArray(candidate))?.filter(isRecord) ?? [];
  if (fromArrays.length > 0) {
    return fromArrays;
  }

  if (readTryOtoReturnPriceOptionId(value) || readTryOtoReturnDcSettingsId(value) !== null) {
    return [value];
  }

  return [];
}

function buildTryOtoReturnPriceLookupDiagnostics(
  snapshot: Record<string, unknown> | null,
  body: Record<string, unknown> | null,
) {
  const options = getTryOtoReturnPriceOptions(body ?? {});
  return {
    status: typeof snapshot?.status === 'number' ? snapshot.status : null,
    bodyKeys: Array.isArray(snapshot?.bodyKeys)
      ? snapshot.bodyKeys.filter((key): key is string => typeof key === 'string')
      : body
        ? Object.keys(body).sort()
        : [],
    optionCount: options.length,
    selectedPriceOptionIdPresent: options.some((option) => Boolean(readTryOtoReturnPriceOptionId(option))),
    selectedDcSettingsIdPresent: options.some((option) => readTryOtoReturnDcSettingsId(option) !== null),
    providerError: readSafeProviderError(snapshot ?? body ?? {}),
  };
}

function buildTryOtoReverseShipmentRequestDiagnostics(payload: Record<string, unknown>) {
  const items = Array.isArray(payload.items) ? payload.items.filter(isRecord) : [];
  const firstItem = items[0] ?? {};
  return {
    endpoint: '/rest/v2/createShipment',
    topLevelKeys: Object.keys(payload).sort(),
    itemKeys: Object.keys(firstItem).sort(),
    reverseShipmentPresent: payload.reverseShipment === true,
    itemCount: items.length,
    priceOptionIdPresent: hasValue(firstItem.priceOptionId),
    dcSettingsIdPresent: hasValue(firstItem.dcSettingsID),
    packageWeightPresent: hasValue(firstItem.packageWeight),
    boxCount: Array.isArray(firstItem.boxes) ? firstItem.boxes.length : 0,
  };
}

type TryOtoReturnFinalizationResult = {
  returnTrackingNumber: string | null;
  returnTrackingUrl: string | null;
  returnLabelUrl: string | null;
  returnBarcode: string | null;
  returnStatus: string | null;
  returnFinalized: boolean;
  returnPriceLookupDiagnostics: Record<string, unknown>;
  selectedPriceOption: Record<string, unknown> | null;
  reverseCreateShipment: { snapshot: Record<string, unknown>; body: Record<string, unknown> } | null;
  reverseCreateShipmentRequestDiagnostics: Record<string, unknown> | null;
};

function createEmptyReturnFinalizationDiagnostics(): TryOtoReturnFinalizationResult {
  return {
    returnTrackingNumber: null,
    returnTrackingUrl: null,
    returnLabelUrl: null,
    returnBarcode: null,
    returnStatus: null,
    returnFinalized: false,
    returnPriceLookupDiagnostics: {
      called: false,
      success: false,
      optionCount: 0,
      selectedPriceOptionIdPresent: false,
      providerError: null,
    },
    selectedPriceOption: null,
    reverseCreateShipment: null,
    reverseCreateShipmentRequestDiagnostics: null,
  };
}

function getTryOtoDeliveryOptions(value: Record<string, unknown>) {
  const candidates = [value.deliveryCompany, value.deliveryCompanies, value.deliveryOptions, value.options];
  return candidates.find((candidate): candidate is unknown[] => Array.isArray(candidate))?.filter(isRecord) ?? [];
}

function buildTryOtoDeliveryLookupRequestDiagnostics(
  sourcePayload: Record<string, unknown>,
  lookupPayload: Record<string, unknown> | null,
  endpoint: string,
) {
  const sourceCustomer = isRecord(sourcePayload.customer) ? sourcePayload.customer : {};
  const lookupCustomer = isRecord(lookupPayload?.customer) ? lookupPayload.customer : {};
  const lookupWeightFieldNames = lookupPayload
    ? ['weight', 'packageWeight'].filter((fieldName) => hasValue(lookupPayload[fieldName]))
    : [];
  return {
    endpoint,
    topLevelKeys: lookupPayload ? Object.keys(lookupPayload).sort() : [],
    pickupLocationCodePresent: hasValue(lookupPayload?.pickupLocationCode),
    originCityPresent: hasValue(lookupPayload?.originCity),
    packageWeightPresent: hasValue(lookupPayload?.packageWeight),
    weightPresent: hasValue(lookupPayload?.weight),
    weightFieldNames: lookupWeightFieldNames,
    numericWeightPresent:
      typeof lookupPayload?.weight === 'number' ||
      typeof lookupPayload?.packageWeight === 'number',
    weightType: safeValueType(lookupPayload?.weight ?? lookupPayload?.packageWeight),
    customerCityPresent: hasValue(lookupCustomer.city),
    customerCountryPresent: hasValue(lookupCustomer.country),
    paymentMethodPresent: hasValue(lookupPayload?.payment_method),
    sourceFieldPresence: {
      pickupLocationCode: hasValue(sourcePayload.pickupLocationCode),
      originCity: hasValue(sourcePayload.originCity),
      packageWeight: hasValue(sourcePayload.packageWeight),
      customerCity: hasValue(sourceCustomer.city),
      customerCountry: hasValue(sourceCustomer.country),
      paymentMethod: hasValue(sourcePayload.payment_method),
    },
  };
}

function buildTryOtoDeliveryLookupResponseDiagnostics(
  snapshot: Record<string, unknown> | null,
  body: Record<string, unknown> | null,
) {
  const options = getTryOtoDeliveryOptions(body ?? {});
  const pricingKeys = Array.from(
    new Set(
      options.flatMap((option) =>
        Object.keys(option).filter((key) =>
          ['price', 'amount', 'currency', 'deliveryFee', 'shippingFee', 'total', 'totalPrice', 'netPrice'].includes(key),
        ),
      ),
    ),
  ).sort();

  return {
    status: typeof snapshot?.status === 'number' ? snapshot.status : null,
    topLevelKeys: Array.isArray(snapshot?.topLevelKeys)
      ? snapshot.topLevelKeys.filter((key): key is string => typeof key === 'string')
      : body
        ? Object.keys(body).sort()
        : [],
    bodyKeys: Array.isArray(snapshot?.bodyKeys)
      ? snapshot.bodyKeys.filter((key): key is string => typeof key === 'string')
      : body
        ? Object.keys(body).sort()
        : [],
    optionCount: options.length,
    deliveryOptionIdPresent: options.some((option) => Boolean(readTryOtoDeliveryOptionId(option))),
    deliveryCompanyNamePresent: options.some((option) => Boolean(readTryOtoDeliveryCompanyName(option))),
    pricingPresent: pricingKeys.length > 0,
    pricingKeys,
    providerError: readSafeProviderError(snapshot ?? body ?? {}),
    providerValidationErrors: Array.isArray(snapshot?.providerValidationErrors)
      ? snapshot.providerValidationErrors.filter((value): value is string => typeof value === 'string')
      : readSafeValidationErrors(body ?? {}),
  };
}

function buildTryOtoDeliveryFeePayload(payload: Record<string, unknown>) {
  const customer = isRecord(payload.customer) ? payload.customer : {};
  const pickupLocationCode = readString(payload, ['pickupLocationCode']);
  const originCity = readString(payload, ['originCity']);
  const customerCity = readString(customer, ['city']);
  const customerCountry = readString(customer, ['country']);
  const packageWeight = readNumber(payload, ['packageWeight']);
  const paymentMethod = readString(payload, ['payment_method']);
  if (!pickupLocationCode || !customerCity || !customerCountry || packageWeight === null || packageWeight <= 0 || !paymentMethod) {
    return {
      ok: false as const,
      missing: [
        !pickupLocationCode ? 'pickupLocationCode' : null,
        !customerCity ? 'customer.city' : null,
        !customerCountry ? 'customer.country' : null,
        packageWeight === null || packageWeight <= 0 ? 'packageWeight' : null,
        !paymentMethod ? 'payment_method' : null,
      ].filter((field): field is string => Boolean(field)),
    };
  }

  return {
    ok: true as const,
    payload: {
      pickupLocationCode,
      ...(originCity ? { originCity } : {}),
      destinationCity: customerCity,
      weight: packageWeight,
      packageWeight,
      customer: {
        city: customerCity,
        country: customerCountry,
      },
      payment_method: paymentMethod,
      currency: readString(payload, ['currency']) ?? 'TRY',
      ...(readNumber(payload, ['packageCount']) ? { packageCount: readNumber(payload, ['packageCount']) } : {}),
      ...(readNumber(payload, ['amount_due']) && Number(readNumber(payload, ['amount_due'])) > 0
        ? { totalDue: readNumber(payload, ['amount_due']) }
        : {}),
    },
  };
}

function getTryOtoRequestTarget(baseUrl: string | undefined, path: string) {
  if (!baseUrl) {
    return {
      selectedBaseUrl: null,
      requestTargetHostname: null,
      requestPath: path,
    };
  }

  const selectedBaseUrl = baseUrl.replace(/\/$/, '');
  try {
    const requestUrl = new URL(`${selectedBaseUrl}${path}`);
    return {
      selectedBaseUrl,
      requestTargetHostname: requestUrl.hostname,
      requestPath: requestUrl.pathname,
    };
  } catch {
    return {
      selectedBaseUrl,
      requestTargetHostname: null,
      requestPath: path,
    };
  }
}

function mapShipmentStatus(value: string | null): ShipmentExecutionStatusDto {
  const normalized = value?.trim().toLowerCase() ?? '';
  if (normalized === 'in_transit' || normalized === 'in transit' || normalized === 'shipped') {
    return 'in_transit';
  }
  if (
    normalized === 'created' ||
    normalized === 'shipmentcreated' ||
    normalized === 'shipment_created' ||
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

export class TryOtoAdapter implements ShippingProviderAdapter {
  provider = 'TRY_OTO' as const;
  private cachedAccessToken: { token: string; expiresAt: number } | null = null;

  constructor(private readonly env: AppEnv) {}

  private requireReady(input: ShippingProviderCreateInput) {
    if (!this.env.SHIPPING_EXECUTION_ENABLED || !this.env.TRY_OTO_ENABLED || !this.env.TRY_OTO_SANDBOX_MODE) {
      const disabledGates = [
        !this.env.SHIPPING_EXECUTION_ENABLED ? 'SHIPPING_EXECUTION_ENABLED' : null,
        !this.env.TRY_OTO_ENABLED ? 'TRY_OTO_ENABLED' : null,
        !this.env.TRY_OTO_SANDBOX_MODE ? 'TRY_OTO_SANDBOX_MODE' : null,
      ].filter((gate): gate is string => Boolean(gate));

      return {
        providerShipmentId: null,
        trackingNumber: null,
        trackingUrl: null,
        labelUrl: null,
        shipmentStatus: 'pending' as const,
        shippingCost: null,
        shippingVat: null,
        currency: 'TRY',
        responseSnapshot: {
          ok: true,
          dryRun: true,
          provider: 'try_oto',
          reason: 'Try OTO sandbox shipment execution is disabled.',
          disabledGates,
          payloadDiagnostics: buildTryOtoPayloadDiagnostics(input.requestSnapshot),
        },
      };
    }

    if (!this.env.TRY_OTO_BASE_URL) {
      throw new Error('Try OTO sandbox shipment execution is not configured. Missing TRY_OTO_BASE_URL.');
    }

    if (!this.env.TRY_OTO_REFRESH_TOKEN) {
      throw new Error('Try OTO sandbox shipment execution is not configured. Missing TRY_OTO_REFRESH_TOKEN.');
    }

    return null;
  }

  private requestUrl(path: string) {
    return `${this.env.TRY_OTO_BASE_URL?.replace(/\/$/, '')}${path}`;
  }

  private async refreshAccessToken() {
    const now = Date.now();
    if (this.cachedAccessToken && this.cachedAccessToken.expiresAt > now + 60_000) {
      return this.cachedAccessToken.token;
    }

    const path = '/rest/v2/refreshToken';
    const target = getTryOtoRequestTarget(this.env.TRY_OTO_BASE_URL, path);
    const response = await fetch(this.requestUrl(path), {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        refresh_token: this.env.TRY_OTO_REFRESH_TOKEN,
      }),
    });
    const contentType = response.headers.get('content-type') ?? '';
    const responseText = await response.text();
    const parsedBody = parseResponseBody(contentType, responseText);
    const body = getProviderResponseRecord(parsedBody);

    if (!response.ok || !isRecord(parsedBody)) {
      throw new ShippingProviderExecutionError(`Try OTO token refresh failed with HTTP ${response.status}.`, {
        status: response.status,
        ok: response.ok,
        contentType,
        provider: 'try_oto',
        operation: 'refreshToken',
        requestPath: target.requestPath,
        requestTargetHostname: target.requestTargetHostname,
        detectedResponseFormat: getDetectedResponseFormat(contentType, parsedBody),
        responseSnippet: sanitizeResponseSnippet(responseText),
        providerError: readSafeProviderError(body),
      });
    }

    const accessToken = readString(body, ['access_token']);
    if (!accessToken) {
      throw new ShippingProviderExecutionError('Try OTO token refresh did not return an access token.', {
        status: response.status,
        ok: response.ok,
        contentType,
        provider: 'try_oto',
        operation: 'refreshToken',
        requestPath: target.requestPath,
        requestTargetHostname: target.requestTargetHostname,
        bodyKeys: Object.keys(body).sort(),
      });
    }

    const expiresInSeconds = readNumber(body, ['expires_in']) ?? 3600;
    this.cachedAccessToken = {
      token: accessToken,
      expiresAt: now + Math.max(60, expiresInSeconds - 120) * 1000,
    };
    return accessToken;
  }

  private async postJson(path: string, body: Record<string, unknown>, accessToken: string, operation: string) {
    const target = getTryOtoRequestTarget(this.env.TRY_OTO_BASE_URL, path);
    const response = await fetch(this.requestUrl(path), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const contentType = response.headers.get('content-type') ?? '';
    const providerRequestId =
      response.headers.get('x-request-id') ??
      response.headers.get('x-correlation-id') ??
      response.headers.get('request-id');
    const responseText = await response.text();
    const parsedBody = parseResponseBody(contentType, responseText);
    const record = getProviderResponseRecord(parsedBody);
    const snapshot = {
      status: response.status,
      ok: response.ok,
      contentType,
      parsedBodyType: Array.isArray(parsedBody) ? 'array' : typeof parsedBody,
      bodyKeys: Object.keys(record).sort(),
      topLevelKeys: isRecord(parsedBody) ? Object.keys(parsedBody).sort() : [],
      provider: 'try_oto',
      operation,
      requestId: providerRequestId ?? readString(record, ['request_id', 'requestId', 'traceId', 'trace_id']),
      requestPath: target.requestPath,
      requestTargetHostname: target.requestTargetHostname,
      selectedEnvironment: 'sandbox',
      detectedResponseFormat: getDetectedResponseFormat(contentType, parsedBody),
      responseSnippet: sanitizeResponseSnippet(responseText),
      providerError: readSafeProviderError(record),
      providerErrorCode: readSafeProviderErrorCode(record),
      providerValidationErrors: readSafeValidationErrors(record),
    };

    if (!response.ok) {
      throw new ShippingProviderExecutionError(`Try OTO ${operation} failed with HTTP ${response.status}.`, snapshot);
    }

    return {
      snapshot,
      body: record,
    };
  }

  async createShipment(input: ShippingProviderCreateInput): Promise<ShippingProviderCreateResult> {
    const disabled = this.requireReady(input);
    if (disabled) {
      return disabled;
    }

    const configuredDeliveryOptionId = readTryOtoDeliveryOptionId(input.requestSnapshot);
    console.info('[shipping:try-oto:sandbox-create]', {
      provider: 'try_oto',
      selectedEnvironment: 'sandbox',
      requestTargetHostname: getTryOtoRequestTarget(this.env.TRY_OTO_BASE_URL, '/rest/v2/createOrder').requestTargetHostname,
      payloadDiagnostics: buildTryOtoPayloadDiagnostics(input.requestSnapshot),
    });

    const accessToken = await this.refreshAccessToken();
    let deliveryOptionLookup: { snapshot: Record<string, unknown>; body: Record<string, unknown> } | null = null;
    let selectedDeliveryOptionId = configuredDeliveryOptionId;
    let selectedDeliveryCompanyName: string | null = null;
    let deliveryOptionLookupRequestDiagnostics: Record<string, unknown> | null = null;
    let deliveryOptionLookupResponseDiagnostics: Record<string, unknown> | null = null;

    if (!selectedDeliveryOptionId) {
      const lookupPayload = buildTryOtoDeliveryFeePayload(input.requestSnapshot);
      if (!lookupPayload.ok) {
        deliveryOptionLookupRequestDiagnostics = buildTryOtoDeliveryLookupRequestDiagnostics(
          input.requestSnapshot,
          null,
          '/rest/v2/checkOTODeliveryFee',
        );
        console.info('[shipping:try-oto:delivery-option-lookup]', {
          provider: 'try_oto',
          operation: 'checkOTODeliveryFee',
          request: deliveryOptionLookupRequestDiagnostics,
          missingFields: lookupPayload.missing,
        });
        throw new ShippingProviderExecutionError('Try OTO delivery option could not be resolved. Check pickup location, destination, package weight, and sandbox credit.', {
          ok: false,
          provider: 'try_oto',
          operation: 'checkOTODeliveryFee',
          deliveryOptionLookup: {
            called: false,
            success: false,
            missingFields: lookupPayload.missing,
            optionCount: 0,
            request: deliveryOptionLookupRequestDiagnostics,
          },
          payloadDiagnostics: buildTryOtoPayloadDiagnostics(input.requestSnapshot),
        });
      }

      deliveryOptionLookupRequestDiagnostics = buildTryOtoDeliveryLookupRequestDiagnostics(
        input.requestSnapshot,
        lookupPayload.payload,
        '/rest/v2/checkOTODeliveryFee',
      );
      console.info('[shipping:try-oto:delivery-option-lookup]', {
        provider: 'try_oto',
        operation: 'checkOTODeliveryFee',
        request: deliveryOptionLookupRequestDiagnostics,
      });
      try {
        deliveryOptionLookup = await this.postJson('/rest/v2/checkOTODeliveryFee', lookupPayload.payload, accessToken, 'checkOTODeliveryFee');
      } catch (error) {
        if (error instanceof ShippingProviderExecutionError) {
          deliveryOptionLookupResponseDiagnostics = buildTryOtoDeliveryLookupResponseDiagnostics(error.responseSnapshot, null);
          console.info('[shipping:try-oto:delivery-option-lookup-result]', {
            provider: 'try_oto',
            operation: 'checkOTODeliveryFee',
            request: deliveryOptionLookupRequestDiagnostics,
            response: deliveryOptionLookupResponseDiagnostics,
          });
          throw new ShippingProviderExecutionError('Try OTO delivery option could not be resolved. Check pickup location, destination, package weight, and sandbox credit.', {
            ...error.responseSnapshot,
            deliveryOptionLookup: {
              called: true,
              success: false,
              optionCount: 0,
              providerError: readSafeProviderError(error.responseSnapshot),
              request: deliveryOptionLookupRequestDiagnostics,
              response: deliveryOptionLookupResponseDiagnostics,
            },
            payloadDiagnostics: buildTryOtoPayloadDiagnostics(input.requestSnapshot),
          });
        }
        throw error;
      }

      const options = getTryOtoDeliveryOptions(deliveryOptionLookup.body);
      deliveryOptionLookupResponseDiagnostics = buildTryOtoDeliveryLookupResponseDiagnostics(
        deliveryOptionLookup.snapshot,
        deliveryOptionLookup.body,
      );
      console.info('[shipping:try-oto:delivery-option-lookup-result]', {
        provider: 'try_oto',
        operation: 'checkOTODeliveryFee',
        request: deliveryOptionLookupRequestDiagnostics,
        response: deliveryOptionLookupResponseDiagnostics,
      });
      const selectedOption = options.find((option) => readTryOtoDeliveryOptionId(option));
      selectedDeliveryOptionId = selectedOption ? readTryOtoDeliveryOptionId(selectedOption) : null;
      selectedDeliveryCompanyName = selectedOption ? readTryOtoDeliveryCompanyName(selectedOption) : null;
      if (!selectedDeliveryOptionId) {
        throw new ShippingProviderExecutionError('Try OTO delivery option could not be resolved. Check pickup location, destination, package weight, and sandbox credit.', {
          ok: false,
          provider: 'try_oto',
          operation: 'checkOTODeliveryFee',
          deliveryOptionLookup: {
            called: true,
            success: true,
            optionCount: options.length,
            selectedDeliveryCompanyName: null,
            selectedDeliveryOptionIdPresent: false,
            request: deliveryOptionLookupRequestDiagnostics,
            response: deliveryOptionLookupResponseDiagnostics,
          },
          lookup: deliveryOptionLookup.snapshot,
          payloadDiagnostics: buildTryOtoPayloadDiagnostics(input.requestSnapshot),
        });
      }
    }

    const {
      externalOrderReference: _externalOrderReference,
      internalOrderReference: _internalOrderReference,
      legacyInternalReferenceUsed: _legacyInternalReferenceUsed,
      ...tryOtoProviderRequestSnapshot
    } = input.requestSnapshot;
    const orderPayload = {
      ...tryOtoProviderRequestSnapshot,
      ...(selectedDeliveryOptionId ? { deliveryOptionId: selectedDeliveryOptionId } : {}),
    };
    const payloadDiagnostics = buildTryOtoPayloadDiagnostics({
      ...input.requestSnapshot,
      ...(selectedDeliveryOptionId ? { deliveryOptionId: selectedDeliveryOptionId } : {}),
    });
    const orderId = readString(input.requestSnapshot, ['orderId']);
    if (!orderId) {
      throw new ShippingProviderExecutionError('Try OTO createOrder payload is missing orderId.', {
        provider: 'try_oto',
        operation: 'createOrder',
        payloadDiagnostics,
      });
    }
    const retrySource = input.retryContext?.isRetry
      ? input.retryContext.existingOrderId
        ? 'existing execution'
        : 'unknown'
      : 'fresh create';
    const canReuseExistingOrder = Boolean(
      input.retryContext?.isRetry &&
      input.retryContext.existingOrderId &&
      input.retryContext.existingOrderId === orderId,
    );
    let createOrderSkipped = false;
    let createOrderSkipReason: 'existing order' | 'OTO1063 recovered' | 'none' = 'none';
    let createOrder: { snapshot: Record<string, unknown>; body: Record<string, unknown> };

    if (canReuseExistingOrder) {
      createOrderSkipped = true;
      createOrderSkipReason = input.retryContext?.existingOrderAlreadyExists ? 'OTO1063 recovered' : 'existing order';
      createOrder = {
        snapshot: {
          ok: true,
          provider: 'try_oto',
          operation: 'createOrder',
          skipped: true,
          skipReason: createOrderSkipReason,
          retrySource,
          orderId,
          providerOrderId: input.retryContext?.existingProviderOrderId ?? null,
          requestPath: '/rest/v2/createOrder',
          selectedEnvironment: 'sandbox',
        },
        body: input.retryContext?.existingProviderOrderId
          ? { otoId: input.retryContext.existingProviderOrderId }
          : {},
      };
    } else {
      try {
        createOrder = await this.postJson('/rest/v2/createOrder', orderPayload, accessToken, 'createOrder');
      } catch (error) {
        if (
          error instanceof ShippingProviderExecutionError &&
          isTryOtoOrderAlreadyExists(error.responseSnapshot) &&
          canReuseExistingOrder
        ) {
          createOrderSkipped = true;
          createOrderSkipReason = 'OTO1063 recovered';
          createOrder = {
            snapshot: {
              ...error.responseSnapshot,
              ok: true,
              recovered: true,
              skipReason: createOrderSkipReason,
              retrySource,
              orderId,
              providerOrderId: input.retryContext?.existingProviderOrderId ?? null,
            },
            body: input.retryContext?.existingProviderOrderId
              ? { otoId: input.retryContext.existingProviderOrderId }
              : {},
          };
        } else {
          throw error;
        }
      }
    }

    const deliveryOptionLookupDiagnostics = {
      called: !configuredDeliveryOptionId,
      success: configuredDeliveryOptionId ? null : Boolean(deliveryOptionLookup?.snapshot.ok),
      optionCount: configuredDeliveryOptionId ? null : getTryOtoDeliveryOptions(deliveryOptionLookup?.body ?? {}).length,
      selectedDeliveryCompanyName,
      selectedDeliveryOptionIdPresent: Boolean(selectedDeliveryOptionId),
      configuredDeliveryOptionIdPresent: Boolean(configuredDeliveryOptionId),
      request: deliveryOptionLookupRequestDiagnostics,
      response: deliveryOptionLookupResponseDiagnostics,
      lookupErrorMessage: null,
    };
    if (!selectedDeliveryOptionId) {
      throw new ShippingProviderExecutionError('Try OTO delivery option could not be resolved. Check pickup location, destination, package weight, and sandbox credit.', {
        ok: false,
        provider: 'try_oto',
        operation: 'createShipment',
        deliveryOptionLookup: deliveryOptionLookupDiagnostics,
        createOrder: createOrder.snapshot,
        createShipment: null,
        createShipmentRequestDiagnostics: {
          endpoint: '/rest/v2/createShipment',
          topLevelKeys: [],
          orderIdPresent: false,
          deliveryOptionIdPresent: false,
          blockedReason: 'missing_delivery_option',
        },
        payloadDiagnostics,
      });
    }
    const createShipmentRequest = {
      orderId,
      deliveryOptionId: selectedDeliveryOptionId,
    };
    const createShipmentRequestDiagnostics = {
      endpoint: '/rest/v2/createShipment',
      topLevelKeys: Object.keys(createShipmentRequest).sort(),
      orderIdPresent: hasValue(createShipmentRequest.orderId),
      deliveryOptionIdPresent: hasValue(createShipmentRequest.deliveryOptionId),
    };
    let createShipment!: { snapshot: Record<string, unknown>; body: Record<string, unknown> };
    let createShipmentRecovered = false;
    let createShipmentRecoveryReason: string | null = null;
    try {
      createShipment = await this.postJson('/rest/v2/createShipment', createShipmentRequest, accessToken, 'createShipment');
    } catch (error) {
      if (error instanceof ShippingProviderExecutionError) {
        console.info('[shipping:try-oto:create-shipment-result]', {
          provider: 'try_oto',
          operation: 'createShipment',
          request: createShipmentRequestDiagnostics,
          response: {
            status: error.responseSnapshot.status,
            bodyKeys: error.responseSnapshot.bodyKeys,
            providerError: readSafeProviderError(error.responseSnapshot),
            providerErrorCode: readSafeProviderErrorCode(error.responseSnapshot),
          },
        });
        if (isTryOtoShipmentAlreadyInProgress(error.responseSnapshot)) {
          createShipmentRecovered = true;
          createShipmentRecoveryReason = 'existing shipment in progress';
          createShipment = {
            snapshot: {
              ...error.responseSnapshot,
              ok: true,
              recovered: true,
              recoveryReason: createShipmentRecoveryReason,
              orderId,
              providerMessage: 'Try OTO shipment is already in progress; tracking/label pending.',
            },
            body: {
              message: 'Try OTO shipment is already in progress; tracking/label pending.',
            },
          };
        } else {
          throw new ShippingProviderExecutionError(`Try OTO createShipment failed with HTTP ${error.responseSnapshot.status ?? 'unknown'}.`, {
            ...error.responseSnapshot,
            provider: 'try_oto',
            operation: 'createShipment',
            deliveryOptionLookup: deliveryOptionLookupDiagnostics,
            createOrder: createOrder.snapshot,
            createShipment: error.responseSnapshot,
            createShipmentRequestDiagnostics,
            payloadDiagnostics,
          });
        }
      }
      if (!createShipmentRecovered) {
        throw error;
      }
    }
    let orderStatus: { snapshot: Record<string, unknown>; body: Record<string, unknown> } | null = null;
    try {
      orderStatus = await this.postJson('/rest/v2/orderStatus', { orderId }, accessToken, 'orderStatus');
    } catch (error) {
      if (error instanceof ShippingProviderExecutionError) {
        orderStatus = {
          snapshot: {
            ...error.responseSnapshot,
            nonBlocking: true,
          },
          body: {},
        };
      } else {
        throw error;
      }
    }

    const statusBody = orderStatus?.body ?? {};
    const shipmentBody = createShipment.body;
    const orderBody = createOrder.body;
    const trackingNumber = readTryOtoTrackingNumber(statusBody);
    const labelUrl = readTryOtoLabelUrl(statusBody);
    const barcode = readTryOtoBarcode(statusBody);
    const providerShipmentId =
      readString(statusBody, ['shipmentId']) ??
      readString(shipmentBody, ['shipmentId']) ??
      readString(orderBody, ['otoId']) ??
      orderId;

    return {
      providerShipmentId,
      trackingNumber,
      trackingUrl: readString(statusBody, ['trackingUrl', 'trackingURL']),
      labelUrl,
      shipmentStatus: mapShipmentStatus(readString(statusBody, ['status']) ?? (providerShipmentId ? 'created' : null)),
      shippingCost: null,
      shippingVat: null,
      currency: readString(statusBody, ['currency']) ?? readString(input.requestSnapshot, ['currency']) ?? 'TRY',
      responseSnapshot: {
        ok: true,
        provider: 'try_oto',
        providerOrderId: readString(orderBody, ['otoId']),
        orderId,
        shipmentId: readString(statusBody, ['shipmentId']) ?? readString(shipmentBody, ['shipmentId']),
        trackingNumber,
        dcTrackingNumber: readString(statusBody, ['dcTrackingNumber']),
        barcode,
        labelUrl,
        deliveryCompany: readString(statusBody, ['deliveryCompany']),
        providerStatus: readString(statusBody, ['status']),
        deliveryOptionLookup: {
          ...deliveryOptionLookupDiagnostics,
          lookup: deliveryOptionLookup?.snapshot,
        },
        selectedDeliveryCompanyName,
        selectedDeliveryOptionIdPresent: Boolean(selectedDeliveryOptionId),
        createOrder: createOrder.snapshot,
        createOrderSkipped,
        createOrderSkipReason,
        retrySource,
        createShipment: createShipment.snapshot,
        createShipmentRecovered,
        createShipmentRecoveryReason,
        orderStatusCalledAfterRecovery: createShipmentRecovered ? Boolean(orderStatus) : false,
        createShipmentRequestDiagnostics,
        orderStatus: orderStatus?.snapshot,
        providerMessage: createShipmentRecovered && !trackingNumber && !labelUrl && !barcode
          ? 'Try OTO shipment is already in progress; tracking/label pending.'
          : readString(createShipment.body, ['message']),
        payloadDiagnostics,
        lastProviderResponseAt: new Date().toISOString(),
        timeline: [
          {
            label: 'Try OTO order created',
            at: new Date().toISOString(),
            status: readString(orderBody, ['otoId']) ? 'created' : null,
          },
          {
            label: 'Try OTO shipment create requested',
            at: new Date().toISOString(),
            status: readString(createShipment.body, ['message']) ?? null,
          },
        ],
      },
    };
  }

  async getShipmentStatus(orderId: string): Promise<ShippingProviderCreateResult> {
    if (!this.env.SHIPPING_EXECUTION_ENABLED || !this.env.TRY_OTO_ENABLED || !this.env.TRY_OTO_SANDBOX_MODE) {
      const disabledGates = [
        !this.env.SHIPPING_EXECUTION_ENABLED ? 'SHIPPING_EXECUTION_ENABLED' : null,
        !this.env.TRY_OTO_ENABLED ? 'TRY_OTO_ENABLED' : null,
        !this.env.TRY_OTO_SANDBOX_MODE ? 'TRY_OTO_SANDBOX_MODE' : null,
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
          provider: 'try_oto',
          reason: 'Try OTO sandbox shipment status refresh is disabled.',
          disabledGates,
          orderIdPresent: Boolean(orderId?.trim()),
        },
      };
    }

    if (!this.env.TRY_OTO_BASE_URL) {
      throw new Error('Try OTO sandbox shipment status refresh is not configured. Missing TRY_OTO_BASE_URL.');
    }

    if (!this.env.TRY_OTO_REFRESH_TOKEN) {
      throw new Error('Try OTO sandbox shipment status refresh is not configured. Missing TRY_OTO_REFRESH_TOKEN.');
    }

    const trimmedOrderId = orderId?.trim();
    if (!trimmedOrderId) {
      throw new ShippingProviderExecutionError('Try OTO shipment status refresh is missing orderId.', {
        provider: 'try_oto',
        operation: 'orderStatus',
        orderIdPresent: false,
      });
    }

    const accessToken = await this.refreshAccessToken();
    const orderStatus = await this.postJson('/rest/v2/orderStatus', { orderId: trimmedOrderId }, accessToken, 'orderStatus');
    const statusBody = orderStatus.body;
    const trackingNumber = readTryOtoTrackingNumber(statusBody);
    const labelUrl = readTryOtoLabelUrl(statusBody);
    const barcode = readTryOtoBarcode(statusBody);
    const providerShipmentId = readString(statusBody, ['shipmentId', 'otoId']) ?? trimmedOrderId;
    const providerStatus = readString(statusBody, ['status', 'shipmentStatus']);

    return {
      providerShipmentId,
      trackingNumber,
      trackingUrl: readString(statusBody, ['trackingUrl', 'trackingURL']),
      labelUrl,
      shipmentStatus: mapShipmentStatus(providerStatus ?? (providerShipmentId ? 'created' : null)),
      shippingCost: null,
      shippingVat: null,
      currency: readString(statusBody, ['currency']) ?? 'TRY',
      responseSnapshot: {
        ok: true,
        provider: 'try_oto',
        orderId: trimmedOrderId,
        shipmentId: readString(statusBody, ['shipmentId']),
        trackingNumber,
        dcTrackingNumber: readString(statusBody, ['dcTrackingNumber']),
        barcode,
        labelUrl,
        trackingUrl: readString(statusBody, ['trackingUrl', 'trackingURL']),
        deliveryCompany: readString(statusBody, ['deliveryCompany']),
        providerStatus,
        orderStatus: orderStatus.snapshot,
        lastProviderResponseAt: new Date().toISOString(),
      },
    };
  }

  async createReturnShipment(input: ShippingProviderReturnCreateInput): Promise<ShippingProviderReturnCreateResult> {
    const disabled = this.requireReady({
      allocationId: '',
      vendorId: '',
      provider: 'try_oto',
      requestSnapshot: {
        orderId: input.orderId,
        items: input.items,
        ...(input.pickupLocationCode ? { pickupLocationCode: input.pickupLocationCode } : {}),
        ...(input.deliveryOptionId ? { deliveryOptionId: input.deliveryOptionId } : {}),
      },
    });
    if (disabled) {
      return {
        returnOrderId: null,
        returnTrackingNumber: null,
        returnTrackingUrl: null,
        returnLabelUrl: null,
        returnBarcode: null,
        returnStatus: null,
        responseSnapshot: {
          ...disabled.responseSnapshot,
          operation: 'createReturnShipment',
          endpoint: '/rest/v2/createReturnShipment',
          returnLabelRetrievalConfirmed: false,
        },
      };
    }

    const orderId = input.orderId.trim();
    const items = input.items
      .map((item) => ({
        sku: item.sku.trim(),
        quantity: String(item.quantity).trim(),
      }))
      .filter((item) => item.sku && Number(item.quantity) > 0);
    if (!orderId) {
      throw new ShippingProviderExecutionError('Try OTO return shipment requires an orderId.', {
        provider: 'try_oto',
        operation: 'createReturnShipment',
        endpoint: '/rest/v2/createReturnShipment',
        orderIdPresent: false,
      });
    }
    if (items.length === 0) {
      throw new ShippingProviderExecutionError('Try OTO return shipment requires returned item SKU and quantity.', {
        provider: 'try_oto',
        operation: 'createReturnShipment',
        endpoint: '/rest/v2/createReturnShipment',
        orderIdPresent: true,
        itemCount: 0,
      });
    }

    const payload = {
      orderId,
      ...(input.pickupLocationCode ? { pickupLocationCode: input.pickupLocationCode } : {}),
      ...(input.deliveryOptionId ? { deliveryOptionId: input.deliveryOptionId } : {}),
      items,
    };
    const accessToken = await this.refreshAccessToken();
    const result = await this.postJson('/rest/v2/createReturnShipment', payload, accessToken, 'createReturnShipment');
    const body = result.body;
    let returnLabelUrl = readTryOtoLabelUrl(body);
    let returnTrackingNumber = readTryOtoTrackingNumber(body);
    let returnBarcode = readTryOtoBarcode(body);
    const returnOrderId = readTryOtoReturnOrderId(body);
    const returnOtoId = readNumber(body, ['otoId', 'returnOtoId', 'returnOrderId', 'orderId']);
    let returnStatus = readString(body, ['status', 'shipmentStatus', 'dcStatus']);
    let returnFinalized = Boolean(returnLabelUrl);
    const packageWeight = Number.isFinite(input.packageWeight) && Number(input.packageWeight) > 0 ? Number(input.packageWeight) : 1;
    const finalization = returnOtoId !== null
      ? await this.finalizeReverseReturnShipment(returnOtoId, accessToken, packageWeight)
      : createEmptyReturnFinalizationDiagnostics();

    returnTrackingNumber = finalization.returnTrackingNumber ?? returnTrackingNumber;
    returnBarcode = finalization.returnBarcode ?? returnBarcode;
    returnLabelUrl = finalization.returnLabelUrl ?? returnLabelUrl;
    returnStatus = finalization.returnStatus ?? returnStatus;
    returnFinalized = finalization.returnFinalized || returnFinalized;
    const returnLabelRetrievable = Boolean(returnLabelUrl);

    return {
      returnOrderId,
      returnTrackingNumber,
      returnTrackingUrl: readString(body, ['trackingUrl', 'trackingURL', 'brandedTrackingURL']),
      returnLabelUrl,
      returnBarcode,
      returnStatus,
      responseSnapshot: {
        ...result.snapshot,
        provider: 'try_oto',
        operation: 'createReturnShipment',
        endpoint: '/rest/v2/createReturnShipment',
        requestKeys: Object.keys(payload).sort(),
        itemCount: items.length,
        orderIdPresent: true,
        pickupLocationCodePresent: Boolean(input.pickupLocationCode),
        returnDeliveryOptionIdPresent: Boolean(input.deliveryOptionId),
        returnDeliveryOptionLookupCalled: Boolean(finalization.returnPriceLookupDiagnostics.called),
        returnDeliveryOptionLookupImplemented: true,
        returnPriceLookupCalled: Boolean(finalization.returnPriceLookupDiagnostics.called),
        returnPriceLookupSuccess: Boolean(finalization.returnPriceLookupDiagnostics.success),
        returnPriceLookupOptionCount:
          typeof finalization.returnPriceLookupDiagnostics.optionCount === 'number' ? finalization.returnPriceLookupDiagnostics.optionCount : 0,
        returnPriceLookupResponseKeys: Array.isArray(finalization.returnPriceLookupDiagnostics.bodyKeys)
          ? finalization.returnPriceLookupDiagnostics.bodyKeys
          : [],
        selectedReturnPriceOptionIdPresent: Boolean(finalization.selectedPriceOption && readTryOtoReturnPriceOptionId(finalization.selectedPriceOption)),
        selectedReturnDcSettingsIdPresent: Boolean(finalization.selectedPriceOption && readTryOtoReturnDcSettingsId(finalization.selectedPriceOption) !== null),
        returnProviderIdPresent: Boolean(returnOrderId),
        returnOrderIdPresent: Boolean(returnOrderId),
        returnTrackingPresent: Boolean(returnTrackingNumber),
        returnBarcodePresent: Boolean(returnBarcode),
        returnLabelPresent: Boolean(returnLabelUrl),
        returnStatus,
        returnFinalized,
        returnFinalizationEndpointConfirmed: true,
        returnFinalizeEndpointImplemented: true,
        reverseCreateShipmentCalled: Boolean(finalization.reverseCreateShipmentRequestDiagnostics),
        reverseCreateShipmentSuccess: Boolean(finalization.reverseCreateShipment?.snapshot.ok),
        reverseCreateShipmentResponseKeys: Array.isArray(finalization.reverseCreateShipment?.snapshot.bodyKeys)
          ? finalization.reverseCreateShipment.snapshot.bodyKeys
          : [],
        reverseCreateShipmentRequestKeys: Array.isArray(finalization.reverseCreateShipmentRequestDiagnostics?.topLevelKeys)
          ? finalization.reverseCreateShipmentRequestDiagnostics.topLevelKeys
          : [],
        reverseCreateShipmentTrackingPresent: Boolean(returnTrackingNumber),
        reverseCreateShipmentBarcodePresent: Boolean(returnBarcode),
        reverseCreateShipmentLabelPresent: Boolean(returnLabelUrl),
        reverseCreateShipmentHttpStatus:
          typeof finalization.reverseCreateShipment?.snapshot.status === 'number' ? finalization.reverseCreateShipment.snapshot.status : null,
        reverseCreateShipmentProviderMessage: readSafeProviderError(finalization.reverseCreateShipment?.snapshot ?? finalization.reverseCreateShipment?.body ?? {}),
        returnLabelRetrievable,
        returnProviderStatusSource: finalization.reverseCreateShipment?.snapshot.ok ? 'reverseCreateShipment' : 'createReturnShipment',
        returnLabelRetrievalConfirmed: returnLabelRetrievable,
        returnLabelSourceChecked: finalization.reverseCreateShipment?.snapshot.ok ? 'reverseCreateShipment' : 'createReturnShipment',
        createReturnShipmentLabelFieldPresent: Boolean(returnLabelUrl),
        webhookReverseShipmentPrintAwbUrlPresent: false,
        printEndpointImplemented: false,
        returnLabelRetrievalNote: returnLabelUrl
          ? null
          : returnFinalized
            ? 'Return shipment finalized. Label PDF is not available yet.'
            : 'Return request created. Provider shipment and label finalization are pending or unconfirmed.',
      },
    };
  }

  private async finalizeReverseReturnShipment(
    returnOtoId: number,
    accessToken: string,
    packageWeight: number,
  ): Promise<TryOtoReturnFinalizationResult> {
    const empty = createEmptyReturnFinalizationDiagnostics();
    const box = {
      width: 10,
      height: 10,
      length: 10,
      weight: packageWeight,
    };
    const priceLookupPayload = {
      otoId: returnOtoId,
      isReverseShipment: true,
      calculationData: {
        boxes: [box],
        skipSlaCalculation: true,
        skipNearestBranchCalculation: true,
        skipSuccessInstructionList: true,
        skipLockerList: true,
      },
      includeEstimationDates: true,
    };

    let returnPriceLookup: { snapshot: Record<string, unknown>; body: Record<string, unknown> } | null = null;
    let returnPriceLookupDiagnostics = empty.returnPriceLookupDiagnostics;
    let selectedPriceOption: Record<string, unknown> | null = null;
    try {
      returnPriceLookup = await this.postJson('/rest/v2/getPriceList', priceLookupPayload, accessToken, 'getPriceList');
      const options = getTryOtoReturnPriceOptions(returnPriceLookup.body);
      selectedPriceOption =
        options.find((option) => readTryOtoReturnPriceOptionId(option) && readTryOtoReturnDcSettingsId(option) !== null) ??
        null;
      returnPriceLookupDiagnostics = {
        called: true,
        success: Boolean(returnPriceLookup.snapshot.ok),
        ...buildTryOtoReturnPriceLookupDiagnostics(returnPriceLookup.snapshot, returnPriceLookup.body),
      };
    } catch (error) {
      if (error instanceof ShippingProviderExecutionError) {
        return {
          ...empty,
          returnPriceLookupDiagnostics: {
            called: true,
            success: false,
            ...buildTryOtoReturnPriceLookupDiagnostics(error.responseSnapshot, null),
          },
        };
      }
      throw error;
    }

    if (!selectedPriceOption) {
      return {
        ...empty,
        returnPriceLookupDiagnostics,
      };
    }

    const reverseShipmentPayload = {
      items: [
        {
          ID: returnOtoId,
          orderID: returnOtoId,
          manualShipment: true,
          dcSettingsID: readTryOtoReturnDcSettingsId(selectedPriceOption),
          packageWeight,
          totalDue: 0,
          boxes: [
            {
              otoID: returnOtoId,
              width: 10,
              length: 10,
              weight: packageWeight,
              height: 10,
            },
          ],
          price: readNumber(selectedPriceOption, ['price']),
          pickingType: readString(selectedPriceOption, ['pickingType']) ?? 'PICKUP_BY_DC',
          deliveryType: readString(selectedPriceOption, ['deliveryType']) ?? 'TO_CUSTOMER_DOORSTEP_OR_PICKUP_BY_CUSTOMER',
          zeroDcReason: null,
          priceOptionId: Number(readTryOtoReturnPriceOptionId(selectedPriceOption)) || readTryOtoReturnPriceOptionId(selectedPriceOption),
          notice: null,
          needToVerifyCrDocStatus: null,
          priceLoading: false,
          pickupDropoff: readString(selectedPriceOption, ['pickupDropoff']) ?? 'PICKUP_BY_DC',
        },
      ],
      reverseShipment: true,
    };
    const reverseCreateShipmentRequestDiagnostics = buildTryOtoReverseShipmentRequestDiagnostics(reverseShipmentPayload);

    try {
      const reverseCreateShipment = await this.postJson('/rest/v2/createShipment', reverseShipmentPayload, accessToken, 'createShipment');
      const reverseBody = reverseCreateShipment.body;
      return {
        returnTrackingNumber: readTryOtoTrackingNumber(reverseBody),
        returnTrackingUrl: readString(reverseBody, ['trackingUrl', 'trackingURL', 'brandedTrackingURL']),
        returnLabelUrl: readTryOtoLabelUrl(reverseBody),
        returnBarcode: readTryOtoBarcode(reverseBody),
        returnStatus: readString(reverseBody, ['status', 'shipmentStatus', 'dcStatus']) ?? 'finalized',
        returnFinalized: true,
        returnPriceLookupDiagnostics,
        selectedPriceOption,
        reverseCreateShipment,
        reverseCreateShipmentRequestDiagnostics,
      };
    } catch (error) {
      if (error instanceof ShippingProviderExecutionError) {
        return {
          ...empty,
          returnPriceLookupDiagnostics,
          selectedPriceOption,
          reverseCreateShipment: {
            snapshot: error.responseSnapshot,
            body: {},
          },
          reverseCreateShipmentRequestDiagnostics,
        };
      }
      throw error;
    }
  }

  async finalizeReturnShipment(input: ShippingProviderReturnFinalizeInput): Promise<ShippingProviderReturnCreateResult> {
    const trimmedReturnOrderId = input.returnOrderId.trim();
    const returnOtoId = Number(trimmedReturnOrderId);
    if (!trimmedReturnOrderId || !Number.isFinite(returnOtoId) || returnOtoId <= 0) {
      throw new ShippingProviderExecutionError('Try OTO return finalization requires a numeric return provider id.', {
        provider: 'try_oto',
        operation: 'createShipment',
        endpoint: '/rest/v2/createShipment',
        returnOrderIdPresent: Boolean(trimmedReturnOrderId),
        numericReturnOtoIdPresent: false,
      });
    }

    const accessToken = await this.refreshAccessToken();
    const packageWeight = Number.isFinite(input.packageWeight) && Number(input.packageWeight) > 0 ? Number(input.packageWeight) : 1;
    const finalization = await this.finalizeReverseReturnShipment(returnOtoId, accessToken, packageWeight);
    const returnLabelRetrievable = Boolean(finalization.returnLabelUrl);
    return {
      returnOrderId: trimmedReturnOrderId,
      returnTrackingNumber: finalization.returnTrackingNumber,
      returnTrackingUrl: finalization.returnTrackingUrl,
      returnLabelUrl: finalization.returnLabelUrl,
      returnBarcode: finalization.returnBarcode,
      returnStatus: finalization.returnStatus,
      responseSnapshot: {
        provider: 'try_oto',
        operation: 'finalizeReturnShipment',
        endpoint: '/rest/v2/createShipment',
        requestKeys: [],
        bodyKeys: Array.isArray(finalization.reverseCreateShipment?.snapshot.bodyKeys)
          ? finalization.reverseCreateShipment.snapshot.bodyKeys
          : [],
        returnProviderIdPresent: true,
        returnOrderIdPresent: true,
        returnTrackingPresent: Boolean(finalization.returnTrackingNumber),
        returnBarcodePresent: Boolean(finalization.returnBarcode),
        returnLabelPresent: Boolean(finalization.returnLabelUrl),
        returnStatus: finalization.returnStatus,
        returnFinalized: finalization.returnFinalized,
        returnDeliveryOptionIdPresent: false,
        returnDeliveryOptionLookupCalled: Boolean(finalization.returnPriceLookupDiagnostics.called),
        returnDeliveryOptionLookupImplemented: true,
        returnPriceLookupCalled: Boolean(finalization.returnPriceLookupDiagnostics.called),
        returnPriceLookupSuccess: Boolean(finalization.returnPriceLookupDiagnostics.success),
        returnPriceLookupOptionCount:
          typeof finalization.returnPriceLookupDiagnostics.optionCount === 'number'
            ? finalization.returnPriceLookupDiagnostics.optionCount
            : 0,
        returnPriceLookupResponseKeys: Array.isArray(finalization.returnPriceLookupDiagnostics.bodyKeys)
          ? finalization.returnPriceLookupDiagnostics.bodyKeys
          : [],
        selectedReturnPriceOptionIdPresent: Boolean(finalization.selectedPriceOption && readTryOtoReturnPriceOptionId(finalization.selectedPriceOption)),
        selectedReturnDcSettingsIdPresent: Boolean(finalization.selectedPriceOption && readTryOtoReturnDcSettingsId(finalization.selectedPriceOption) !== null),
        returnFinalizationEndpointConfirmed: true,
        returnFinalizeEndpointImplemented: true,
        reverseCreateShipmentCalled: Boolean(finalization.reverseCreateShipmentRequestDiagnostics),
        reverseCreateShipmentSuccess: Boolean(finalization.reverseCreateShipment?.snapshot.ok),
        reverseCreateShipmentResponseKeys: Array.isArray(finalization.reverseCreateShipment?.snapshot.bodyKeys)
          ? finalization.reverseCreateShipment.snapshot.bodyKeys
          : [],
        reverseCreateShipmentRequestKeys: Array.isArray(finalization.reverseCreateShipmentRequestDiagnostics?.topLevelKeys)
          ? finalization.reverseCreateShipmentRequestDiagnostics.topLevelKeys
          : [],
        reverseCreateShipmentTrackingPresent: Boolean(finalization.returnTrackingNumber),
        reverseCreateShipmentBarcodePresent: Boolean(finalization.returnBarcode),
        reverseCreateShipmentLabelPresent: Boolean(finalization.returnLabelUrl),
        reverseCreateShipmentHttpStatus:
          typeof finalization.reverseCreateShipment?.snapshot.status === 'number' ? finalization.reverseCreateShipment.snapshot.status : null,
        reverseCreateShipmentProviderMessage: readSafeProviderError(finalization.reverseCreateShipment?.snapshot ?? finalization.reverseCreateShipment?.body ?? {}),
        returnLabelRetrievable,
        returnProviderStatusSource: finalization.reverseCreateShipment?.snapshot.ok ? 'reverseCreateShipment' : 'createReturnShipment',
        returnLabelRetrievalConfirmed: returnLabelRetrievable,
        returnLabelSourceChecked: finalization.reverseCreateShipment?.snapshot.ok ? 'reverseCreateShipment' : 'createReturnShipment',
        createReturnShipmentLabelFieldPresent: Boolean(finalization.returnLabelUrl),
        webhookReverseShipmentPrintAwbUrlPresent: false,
        printEndpointImplemented: false,
        returnLabelRetrievalNote: finalization.returnLabelUrl
          ? null
          : finalization.returnFinalized
            ? 'Return shipment finalized. Label PDF is not available yet.'
            : 'Return request created. Provider shipment and label finalization are pending or unconfirmed.',
      },
    };
  }

  async probeReturnDetails(orderId: string): Promise<ShippingProviderReturnDetailsProbeResult> {
    const trimmedOrderId = orderId.trim();
    if (!trimmedOrderId) {
      throw new ShippingProviderExecutionError('Try OTO getReturnDetails requires a return order id.', {
        provider: 'try_oto',
        operation: 'getReturnDetails',
        endpoint: '/rest/v2/getReturnDetails',
        orderIdPresent: false,
      });
    }

    const accessToken = await this.refreshAccessToken();
    const result = await this.postJson('/rest/v2/getReturnDetails', { orderId: trimmedOrderId }, accessToken, 'getReturnDetails');
    const body = result.body;
    const nestedKeys = collectNestedKeys(body);
    const labelUrl =
      findNestedStringByKeyPattern(body, /(?:print.*(?:awb|label)|(?:awb|label).*url|pdf|fileUrl|file_url)/i) ??
      readTryOtoLabelUrl(body);
    const trackingNumber = findNestedStringByKeyPattern(body, /^(?:trackingNumber|dcTrackingNumber|tracking_number|dc_tracking_number)$/i);
    const barcode = findNestedStringByKeyPattern(body, /(?:barcode|barCode|awbNumber|awb_number)/i);
    const providerStatus = findNestedStringByKeyPattern(body, /^(?:status|shipmentStatus|dcStatus|returnStatus)$/i);

    return {
      returnLabelUrl: labelUrl,
      returnTrackingNumber: trackingNumber,
      returnBarcode: barcode,
      returnStatus: providerStatus,
      responseSnapshot: {
        ...result.snapshot,
        provider: 'try_oto',
        operation: 'getReturnDetails',
        endpoint: '/rest/v2/getReturnDetails',
        requestKeys: ['orderId'],
        nestedKeys,
        labelLikeFieldsPresent: hasNestedKeyPattern(body, /(?:label|printLabel|printAWB|fileUrl|file_url)/i),
        awbLikeFieldsPresent: hasNestedKeyPattern(body, /awb/i),
        pdfLikeFieldsPresent: hasNestedKeyPattern(body, /pdf/i),
        urlLikeFieldsPresent: hasNestedKeyPattern(body, /url/i),
        trackingPresent: Boolean(trackingNumber),
        barcodePresent: Boolean(barcode),
        labelUrlPresent: Boolean(labelUrl),
        providerStatus,
      },
    };
  }

  async probeReturnLink(orderId: string): Promise<ShippingProviderReturnDetailsProbeResult> {
    const trimmedOrderId = orderId.trim();
    if (!trimmedOrderId) {
      throw new ShippingProviderExecutionError('Try OTO getReturnLink requires a return order id.', {
        provider: 'try_oto',
        operation: 'getReturnLink',
        endpoint: '/rest/v2/getReturnLink',
        orderIdPresent: false,
      });
    }

    const accessToken = await this.refreshAccessToken();
    const result = await this.postJson('/rest/v2/getReturnLink', { orderId: trimmedOrderId }, accessToken, 'getReturnLink');
    const body = result.body;
    const nestedKeys = collectNestedKeys(body);
    const labelUrl =
      findNestedStringByKeyPattern(body, /(?:print.*(?:awb|label)|(?:awb|label).*url|pdf|fileUrl|file_url)/i) ??
      readTryOtoLabelUrl(body);
    const trackingNumber = findNestedStringByKeyPattern(body, /^(?:trackingNumber|dcTrackingNumber|tracking_number|dc_tracking_number)$/i);
    const barcode = findNestedStringByKeyPattern(body, /(?:barcode|barCode|awbNumber|awb_number)/i);
    const providerStatus = findNestedStringByKeyPattern(body, /^(?:status|shipmentStatus|dcStatus|returnStatus)$/i);

    return {
      returnLabelUrl: labelUrl,
      returnTrackingNumber: trackingNumber,
      returnBarcode: barcode,
      returnStatus: providerStatus,
      responseSnapshot: {
        ...result.snapshot,
        provider: 'try_oto',
        operation: 'getReturnLink',
        endpoint: '/rest/v2/getReturnLink',
        requestKeys: ['orderId'],
        nestedKeys,
        labelLikeFieldsPresent: hasNestedKeyPattern(body, /(?:label|printLabel|printAWB|fileUrl|file_url)/i),
        awbLikeFieldsPresent: hasNestedKeyPattern(body, /awb/i),
        pdfLikeFieldsPresent: hasNestedKeyPattern(body, /pdf/i),
        urlLikeFieldsPresent: hasNestedKeyPattern(body, /url|link/i),
        actionUrlPresent: hasNestedKeyPattern(body, /url|link/i) && !Boolean(labelUrl),
        trackingPresent: Boolean(trackingNumber),
        barcodePresent: Boolean(barcode),
        labelUrlPresent: Boolean(labelUrl),
        providerStatus,
        providerMessage: readSafeProviderError(body),
      },
    };
  }

  async getTrackingInfo(): Promise<ShippingProviderCreateResult> {
    throw new Error('Try OTO tracking polling is not implemented in this phase.');
  }

  async cancelShipment(): Promise<ShippingProviderCreateResult> {
    throw new Error('Try OTO shipment cancellation is not implemented in this phase.');
  }
}

export function createShippingProviderAdapter(
  env: AppEnv,
  provider: ShippingProviderDto = 'hepsijet',
): ShippingProviderAdapter {
  if (provider === 'kargo_entegrator') {
    return new KargoEntegratorAdapter(env);
  }
  if (provider === 'try_oto') {
    return new TryOtoAdapter(env);
  }

  return new HepsijetAdapter(env);
}
