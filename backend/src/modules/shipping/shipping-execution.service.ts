import {
  Prisma,
  ShipmentExecutionStatus,
  ShippingProvider,
  type ShipmentExecution,
  type VendorShippingConfig,
  type VendorShippingWarehouse,
} from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import type { AppEnv } from '../../config/env.js';
import {
  createShippingProviderAdapter,
  ShippingProviderExecutionError,
  type ShippingProviderAdapter,
} from './shipping-provider.adapter.js';
import { mapShopifyShippingAddress } from '../shopify/order-ingestion.service.js';
import type { ShopifyOrdersCreateWebhookPayload } from '../shopify/order-ingestion.types.js';
import type {
  CreateShipmentExecutionDto,
  ShipmentExecutionPreviewDto,
  ShipmentExecutionDto,
  ShippingProviderGateDiagnosticsDto,
  ShippingProviderDto,
  VendorShippingConfigDto,
  VendorShippingConfigUpdateDto,
} from './shipping-execution.types.js';

const SHIPPING_VAT_PERCENT = 18;
const DUMMY_KARGO_CARRIER_ID = 'dummy';
const DEFAULT_KARGO_PACKAGE_TYPE = 'box';
const ALLOWED_KARGO_PACKAGE_TYPES = new Set(['box', 'document']);
const DEFAULT_TRY_OTO_PACKAGE_WEIGHT_KG = 1;
type StoredShippingConfig = VendorShippingConfig & {
  warehouses?: VendorShippingWarehouse[];
};

function toNumber(value: unknown) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function toAmountString(value: number) {
  return value.toFixed(2);
}

function toPositiveNumber(value: unknown, fallback: number) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function mapProvider(provider: ShippingProvider | string): ShippingProviderDto {
  return provider.trim().toLowerCase() as ShippingProviderDto;
}

function normalizeProvider(provider?: ShippingProviderDto): ShippingProvider {
  const normalized = (provider ?? 'hepsijet').trim().toLowerCase();
  if (normalized === 'hepsijet') {
    return ShippingProvider.HEPSIJET;
  }
  if (normalized === 'kargo_entegrator') {
    return ShippingProvider.KARGO_ENTEGRATOR;
  }
  if (normalized === 'try_oto') {
    return ShippingProvider.TRY_OTO;
  }
  if (normalized === 'mng') {
    return ShippingProvider.MNG;
  }
  if (normalized === 'yurtici') {
    return ShippingProvider.YURTICI;
  }
  if (normalized === 'aras') {
    return ShippingProvider.ARAS;
  }

  throw new Error('Unsupported shipping provider.');
}

function mapStatus(status: ShipmentExecutionStatus | string): ShipmentExecutionDto['shipmentStatus'] {
  return status.trim().toLowerCase() as ShipmentExecutionDto['shipmentStatus'];
}

function mapWarehouse(warehouse: VendorShippingWarehouse): VendorShippingConfigDto['warehouses'][number] {
  return {
    id: warehouse.id,
    vendorId: warehouse.vendorId,
    provider: mapProvider(warehouse.provider),
    warehouseId: warehouse.warehouseId,
    name: warehouse.name,
    address: warehouse.address,
    isDefault: warehouse.isDefault,
  };
}

function mapShippingConfig(config: StoredShippingConfig | null, vendorId: string): VendorShippingConfigDto {
  if (!config) {
    return {
      vendorId,
      preferredProvider: 'hepsijet',
      shippingEnabled: true,
      defaultDesi: '3.00',
      cargoIntegrationId: null,
      defaultWarehouseId: null,
      shippingVatPercent: '18.00',
      warehouses: [],
      providerMetadata: null,
      source: 'default',
      updatedAt: null,
    };
  }

  return {
    vendorId: config.vendorId,
    preferredProvider: mapProvider(config.preferredProvider),
    shippingEnabled: config.shippingEnabled,
    defaultDesi: toAmountString(toNumber(config.defaultDesi)),
    cargoIntegrationId: config.cargoIntegrationId,
    defaultWarehouseId: config.defaultWarehouseId,
    shippingVatPercent: toAmountString(toNumber(config.shippingVatPercent)),
    warehouses: (config.warehouses ?? []).map(mapWarehouse),
    providerMetadata: config.providerMetadata,
    source: 'configured',
    updatedAt: config.updatedAt ? config.updatedAt.toISOString() : null,
  };
}

function mapShipmentExecution(execution: ShipmentExecution & { shippingCostLinked?: boolean }): ShipmentExecutionDto {
  const snapshot = readSnapshot(execution);
  const providerStatus = readString(snapshot, ['providerStatus', 'statusField', 'shipmentStatus', 'cargoStatus']);
  const barcode = readString(snapshot, ['barcode', 'barcodeNumber']);
  const lastProviderResponseAt = readString(snapshot, ['lastProviderResponseAt']);
  const timeline = readTimeline(snapshot);
  const dummyCarrierDetected = readBoolean(snapshot, ['dummyCarrierDetected']);
  const webhookReceived = readBoolean(snapshot, ['webhookReceived']);
  return {
    id: execution.id,
    allocationId: execution.allocationId,
    vendorId: execution.vendorId,
    sourceShopifyOrderId: execution.sourceShopifyOrderId,
    sourceShopifyOrderNumber: execution.sourceShopifyOrderNumber,
    sourceShopifyFulfillmentId: execution.sourceShopifyFulfillmentId,
    provider: mapProvider(execution.provider),
    providerShipmentId: execution.providerShipmentId,
    trackingNumber: execution.trackingNumber,
    trackingUrl: execution.trackingUrl,
    labelUrl: execution.labelUrl,
    shipmentStatus: mapStatus(execution.shipmentStatus),
    desi: toAmountString(toNumber(execution.desi)),
    cargoIntegrationId: execution.cargoIntegrationId,
    warehouseId: execution.warehouseId,
    shippingCost: execution.shippingCost === null ? null : toAmountString(toNumber(execution.shippingCost)),
    shippingVat: execution.shippingVat === null ? null : toAmountString(toNumber(execution.shippingVat)),
    currency: execution.currency,
    shippingCostLinked: Boolean(execution.shippingCostLinked),
    providerStatus,
    barcode,
    lastProviderResponseAt,
    dummyCarrierDetected,
    webhookReceived,
    barcodeAssigned: Boolean(barcode),
    trackingAssigned: Boolean(execution.trackingNumber),
    timeline,
    createdAt: execution.createdAt.toISOString(),
    updatedAt: execution.updatedAt.toISOString(),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readString(value: unknown, keys: string[]) {
  if (!isRecord(value)) {
    return null;
  }

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

function readBoolean(value: unknown, keys: string[]) {
  if (!isRecord(value)) {
    return false;
  }

  return keys.some((key) => value[key] === true);
}

function readSnapshot(execution: { responseSnapshot?: unknown }) {
  return isRecord(execution.responseSnapshot) ? execution.responseSnapshot : {};
}

function resolveKargoPackageType(providerMetadata: unknown) {
  return (readString(providerMetadata, ['packageType', 'package_type']) ?? DEFAULT_KARGO_PACKAGE_TYPE).trim().toLowerCase();
}

function assertValidKargoPackageType(value: string): asserts value is 'box' | 'document' {
  if (!ALLOWED_KARGO_PACKAGE_TYPES.has(value)) {
    throw new Error('Invalid Kargo package_type. Allowed values: box, document.');
  }
}

function readTimeline(snapshot: Record<string, unknown>) {
  const events = Array.isArray(snapshot.timeline) ? snapshot.timeline : [];
  return events
    .filter(isRecord)
    .map((event) => ({
      label: readString(event, ['label']) ?? 'Shipment update',
      at: readString(event, ['at']) ?? new Date().toISOString(),
      status: readString(event, ['status']),
    }));
}

function appendTimelineEvent(snapshot: unknown, event: { label: string; status?: string | null }) {
  const base = isRecord(snapshot) ? snapshot : {};
  const timeline = readTimeline(base);
  return {
    ...base,
    timeline: [
      ...timeline,
      {
        label: event.label,
        at: new Date().toISOString(),
        status: event.status ?? null,
      },
    ],
  };
}

function isDummyKargoRequested(input: CreateShipmentExecutionDto, env?: AppEnv) {
  void env;
  return input.carrierId === DUMMY_KARGO_CARRIER_ID;
}

function getKargoRequestTarget(baseUrl: string | undefined) {
  if (!baseUrl) {
    return {
      selectedBaseUrl: null,
      requestTargetHostname: null,
      productionEndpointSelected: false,
    };
  }

  const selectedBaseUrl = baseUrl.replace(/\/$/, '');
  try {
    const requestUrl = new URL(`${selectedBaseUrl}/shipments`);
    return {
      selectedBaseUrl,
      requestTargetHostname: requestUrl.hostname,
      productionEndpointSelected: requestUrl.hostname === 'app.kargoentegrator.com',
    };
  } catch {
    return {
      selectedBaseUrl,
      requestTargetHostname: null,
      productionEndpointSelected: false,
    };
  }
}

function logKargoExecutionModeSelection(input: CreateShipmentExecutionDto, preview: ShipmentExecutionPreviewDto, env?: AppEnv) {
  if (preview.provider !== 'kargo_entegrator') {
    return;
  }

  const target = getKargoRequestTarget(env?.KARGO_ENTEGRATOR_BASE_URL);
  const explicitDummyCarrierRequested = input.carrierId === DUMMY_KARGO_CARRIER_ID;
  const sandboxModeEnabled = Boolean(env?.SHIPPING_SANDBOX_MODE);
  const dummyModeEnabled = isDummyKargoRequested(input, env);

  console.info('[shipping:kargo:execution-mode]', {
    provider: 'kargo_entegrator',
    selectedEnvironment: sandboxModeEnabled ? 'sandbox' : 'production',
    selectedBaseUrl: target.selectedBaseUrl,
    requestTargetHostname: target.requestTargetHostname,
    productionEndpointSelected: target.productionEndpointSelected,
    providerMode: dummyModeEnabled ? 'dummy' : 'live',
    dummyModeEnabled,
    dummyModeSources: {
      explicitCarrierIdDummy: explicitDummyCarrierRequested,
      sandboxMode: sandboxModeEnabled,
    },
    shippingExecutionEnabled: Boolean(env?.SHIPPING_EXECUTION_ENABLED),
    providerEnabled: Boolean(env?.KARGO_ENTEGRATOR_ENABLED),
    packageType: isRecord(preview.payload) ? readString(preview.payload, ['package_type']) : null,
  });
}

export function inferShipmentDesi(
  lineItems: Array<{ title?: string | null; sku?: string | null }>,
  fallbackDesi = 3,
) {
  const haystack = lineItems
    .map((item) => `${item.title ?? ''} ${item.sku ?? ''}`)
    .join(' ')
    .toLowerCase();

  if (
    /\b(shoe|shoes|sneaker|trainer|boot|bag|backpack|handbag|apparel|shirt|t-shirt|tee|pants|jacket|hoodie|dress)\b/.test(
      haystack,
    )
  ) {
    return 3;
  }

  return fallbackDesi;
}

function resolveShipmentDesi(
  lineItems: Array<{ title?: string | null; sku?: string | null }>,
  configuredDefaultDesi: unknown,
) {
  const fallbackDesi = toPositiveNumber(configuredDefaultDesi, DEFAULT_TRY_OTO_PACKAGE_WEIGHT_KG);
  return toPositiveNumber(inferShipmentDesi(lineItems, fallbackDesi), fallbackDesi);
}

function resolvePersistedShipmentDesi(preview: ShipmentExecutionPreviewDto) {
  const payload = isRecord(preview.payload) ? preview.payload : {};
  const candidates = [
    preview.desi,
    payload.desi,
    payload.packageWeight,
  ];

  for (const candidate of candidates) {
    const parsed = Number(candidate);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return DEFAULT_TRY_OTO_PACKAGE_WEIGHT_KG;
}

function buildShipmentExecutionId(input: {
  allocationId: string;
  provider: ShippingProvider;
}) {
  return `shipment-${input.provider.toLowerCase()}-${input.allocationId}`;
}

function buildShippingCostId(input: {
  vendorId: string;
  allocationId: string;
  provider: ShippingProvider;
  providerReference: string;
}) {
  const provider = input.provider.toLowerCase();
  const reference = input.providerReference
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'shipment';

  return `shipcost-${input.vendorId}-${input.allocationId}-${provider}-${reference}`;
}

function mapProviderStatus(status: ShipmentExecutionDto['shipmentStatus']) {
  if (status === 'created') {
    return ShipmentExecutionStatus.CREATED;
  }
  if (status === 'failed') {
    return ShipmentExecutionStatus.FAILED;
  }
  if (status === 'in_transit') {
    return ShipmentExecutionStatus.IN_TRANSIT;
  }
  if (status === 'delivered') {
    return ShipmentExecutionStatus.DELIVERED;
  }
  if (status === 'returned') {
    return ShipmentExecutionStatus.RETURNED;
  }
  if (status === 'cancelled') {
    return ShipmentExecutionStatus.CANCELLED;
  }
  return ShipmentExecutionStatus.PENDING;
}

function allocationShippingStatus(status: ShipmentExecutionDto['shipmentStatus']) {
  if (status === 'delivered') {
    return 'delivered';
  }
  if (status === 'in_transit') {
    return 'in_transit';
  }
  if (status === 'created') {
    return 'label_created';
  }
  return 'awaiting_shipment';
}

function selectDefaultWarehouse(config: VendorShippingConfigDto, provider: ShippingProviderDto) {
  return (
    config.warehouses.find((warehouse) => warehouse.provider === provider && warehouse.warehouseId === config.defaultWarehouseId) ??
    config.warehouses.find((warehouse) => warehouse.provider === provider && warehouse.isDefault) ??
    config.warehouses.find((warehouse) => warehouse.provider === provider) ??
    null
  );
}

function resolveKargoCargoIntegrationId(config: VendorShippingConfigDto, env?: AppEnv) {
  return config.cargoIntegrationId ?? env?.KARGO_ENTEGRATOR_CARGO_INTEGRATION_ID ?? null;
}

function requireWarehouseConfig(config: VendorShippingConfigDto, provider: ShippingProviderDto, env?: AppEnv) {
  const warehouse = selectDefaultWarehouse(config, provider);
  const warehouseId = warehouse?.warehouseId ?? config.defaultWarehouseId;
  const cargoIntegrationId = resolveKargoCargoIntegrationId(config, env);
  if (!cargoIntegrationId || !warehouseId) {
    throw new Error('Vendor shipping warehouse is not configured.');
  }

  return {
    cargoIntegrationId,
    warehouseId,
  };
}

function resolveTryOtoPickupLocationCode(providerMetadata: unknown) {
  return readString(providerMetadata, [
    'tryOtoPickupLocationCode',
    'pickupLocationCode',
    'pickup_location_code',
    'try_oto_pickup_location_code',
  ]);
}

function resolveTryOtoDeliveryOptionId(providerMetadata: unknown) {
  return readString(providerMetadata, [
    'tryOtoDeliveryOptionId',
    'deliveryOptionId',
    'delivery_option_id',
    'try_oto_delivery_option_id',
  ]);
}

function resolveTryOtoOriginCity(providerMetadata: unknown) {
  return readString(providerMetadata, [
    'tryOtoOriginCity',
    'originCity',
    'origin_city',
    'pickupCity',
    'pickup_city',
  ]);
}

function resolveTryOtoPackageWeight(providerMetadata: unknown, fallback: number) {
  const raw = readString(providerMetadata, ['packageWeight', 'package_weight', 'tryOtoPackageWeight']);
  const parsed = raw === null ? Number.NaN : Number(raw);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return Math.max(DEFAULT_TRY_OTO_PACKAGE_WEIGHT_KG, fallback > 0 ? fallback : DEFAULT_TRY_OTO_PACKAGE_WEIGHT_KG);
}

function splitCustomerName(name: string | null | undefined) {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return {
      name: null,
      surname: null,
    };
  }

  if (parts.length === 1) {
    return {
      name: parts[0],
      surname: null,
    };
  }

  return {
    name: parts.slice(0, -1).join(' '),
    surname: parts.at(-1) ?? null,
  };
}

function buildNotificationUrl(input?: string | null) {
  return input?.trim() || null;
}

function normalizeShipmentPhone(value: string | null | undefined) {
  const digits = value?.replace(/\D+/g, '') ?? '';
  if (!digits) {
    return null;
  }
  if (digits.startsWith('90') && digits.length === 12) {
    return digits;
  }
  if (digits.startsWith('0') && digits.length === 11) {
    return `90${digits.slice(1)}`;
  }
  if (digits.startsWith('5') && digits.length === 10) {
    return `90${digits}`;
  }
  return digits;
}

function composeShipmentAddress(orderRecord: Record<string, unknown>) {
  const directAddress = readString(orderRecord, ['shippingAddress', 'address']);
  if (directAddress) {
    return directAddress;
  }

  const parts = [
    readString(orderRecord, ['shippingAddress1', 'address1']),
    readString(orderRecord, ['shippingAddress2', 'address2']),
  ].filter((part): part is string => Boolean(part));

  return parts.join(', ') || null;
}

function normalizeCustomerOverrides(input: CreateShipmentExecutionDto['customerOverrides']) {
  if (!isRecord(input)) {
    return {};
  }

  const allowedKeys = ['name', 'surname', 'phone', 'email', 'country', 'postcode', 'city', 'district', 'address'] as const;
  return Object.fromEntries(
    allowedKeys
      .map((key) => {
        const value = input[key];
        if (typeof value !== 'string') {
          return null;
        }
        const normalized = key === 'phone' ? normalizeShipmentPhone(value) : value.trim();
        return normalized ? [key, normalized] : null;
      })
      .filter((entry): entry is [string, string] => Boolean(entry)),
  );
}

function readStoredOrderWebhookAddress(orderRecord: Record<string, unknown>) {
  const events = Array.isArray(orderRecord.webhookEvents) ? orderRecord.webhookEvents : [];
  for (const event of events) {
    if (!isRecord(event)) {
      continue;
    }

    const rawPayload = readString(event, ['rawPayload']);
    if (!rawPayload) {
      continue;
    }

    try {
      return mapShopifyShippingAddress(JSON.parse(rawPayload) as ShopifyOrdersCreateWebhookPayload);
    } catch {
      continue;
    }
  }

  return null;
}

function readNestedRecord(value: Record<string, unknown>, key: string) {
  const nested = value[key];
  return isRecord(nested) ? nested : null;
}

function readStoredOrderWebhookPhone(orderRecord: Record<string, unknown>) {
  const events = Array.isArray(orderRecord.webhookEvents) ? orderRecord.webhookEvents : [];
  for (const event of events) {
    if (!isRecord(event)) {
      continue;
    }

    const rawPayload = readString(event, ['rawPayload']);
    if (!rawPayload) {
      continue;
    }

    try {
      const payload = JSON.parse(rawPayload) as Record<string, unknown>;
      const shippingAddress = readNestedRecord(payload, 'shipping_address');
      const billingAddress = readNestedRecord(payload, 'billing_address');
      const customer = readNestedRecord(payload, 'customer');
      const phone =
        readString(shippingAddress ?? {}, ['phone']) ??
        readString(billingAddress ?? {}, ['phone']) ??
        readString(payload, ['phone']) ??
        readString(customer ?? {}, ['phone']);
      const normalized = normalizeShipmentPhone(phone);
      if (normalized) {
        return normalized;
      }
    } catch {
      continue;
    }
  }

  return null;
}

function readAddressDistrict(value: Record<string, unknown> | null) {
  if (!value) {
    return null;
  }

  return readString(value, [
    'district',
    'district_name',
    'districtName',
    'city_area',
    'cityArea',
    'county',
    'county_name',
    'countyName',
    'province',
    'province_name',
    'provinceName',
  ]);
}

function readStoredOrderWebhookDistrict(orderRecord: Record<string, unknown>) {
  const events = Array.isArray(orderRecord.webhookEvents) ? orderRecord.webhookEvents : [];
  for (const event of events) {
    if (!isRecord(event)) {
      continue;
    }

    const rawPayload = readString(event, ['rawPayload']);
    if (!rawPayload) {
      continue;
    }

    try {
      const payload = JSON.parse(rawPayload) as Record<string, unknown>;
      const shippingAddress = readNestedRecord(payload, 'shipping_address');
      const billingAddress = readNestedRecord(payload, 'billing_address');
      const district = readAddressDistrict(shippingAddress) ?? readAddressDistrict(billingAddress);
      if (district) {
        return district;
      }
    } catch {
      continue;
    }
  }

  return null;
}

function buildKargoCustomer(input: {
  order: unknown;
  customerName: string | null | undefined;
  customerEmail: string | null | undefined;
  customerOverrides?: CreateShipmentExecutionDto['customerOverrides'];
}) {
  const orderRecord = isRecord(input.order) ? input.order : {};
  const webhookAddress = readStoredOrderWebhookAddress(orderRecord);
  const overrides = normalizeCustomerOverrides(input.customerOverrides);
  const name = splitCustomerName(input.customerName);
  const customer = {
    name: overrides.name ?? name.name,
    surname: overrides.surname ?? name.surname,
    phone: overrides.phone ?? normalizeShipmentPhone(
      readString(orderRecord, ['customerPhone', 'phone', 'shippingPhone', 'billingPhone']) ??
        webhookAddress?.customerPhone ??
        readStoredOrderWebhookPhone(orderRecord),
    ),
    email: overrides.email ?? input.customerEmail ?? readString(orderRecord, ['customerEmail', 'email']),
    country: overrides.country ?? readString(orderRecord, ['shippingCountry', 'country']) ?? webhookAddress?.shippingCountry ?? null,
    postcode:
      overrides.postcode ??
      readString(orderRecord, ['shippingPostcode', 'postcode', 'zip']) ??
      webhookAddress?.shippingPostcode ??
      null,
    city: overrides.city ?? readString(orderRecord, ['shippingCity', 'city']) ?? webhookAddress?.shippingCity ?? null,
    district:
      overrides.district ??
      readString(orderRecord, [
        'shippingDistrict',
        'district',
        'shippingCounty',
        'county',
        'shippingCityArea',
        'cityArea',
        'shippingProvince',
        'province',
        'billingDistrict',
        'billingCounty',
        'billingCityArea',
        'billingProvince',
      ]) ??
      webhookAddress?.shippingDistrict ??
      readStoredOrderWebhookDistrict(orderRecord) ??
      null,
    address: overrides.address ?? composeShipmentAddress(orderRecord) ?? webhookAddress?.shippingAddress ?? null,
  };
  const missingFields = Object.entries(customer)
    .filter(([, value]) => !value)
    .map(([key]) => `customer.${key}`);

  return {
    customer,
    missingFields,
  };
}

function buildTryOtoCustomer(input: {
  order: unknown;
  customerName: string | null | undefined;
  customerEmail: string | null | undefined;
  customerOverrides?: CreateShipmentExecutionDto['customerOverrides'];
}) {
  const orderRecord = isRecord(input.order) ? input.order : {};
  const webhookAddress = readStoredOrderWebhookAddress(orderRecord);
  const overrides = normalizeCustomerOverrides(input.customerOverrides);
  const customer = {
    name: overrides.name ?? input.customerName ?? readString(orderRecord, ['customerName', 'name']),
    email: overrides.email ?? input.customerEmail ?? readString(orderRecord, ['customerEmail', 'email']),
    mobile: overrides.phone ?? normalizeShipmentPhone(
      readString(orderRecord, ['customerPhone', 'phone', 'shippingPhone', 'billingPhone']) ??
        webhookAddress?.customerPhone ??
        readStoredOrderWebhookPhone(orderRecord),
    ),
    address: overrides.address ?? composeShipmentAddress(orderRecord) ?? webhookAddress?.shippingAddress ?? null,
    district:
      overrides.district ??
      readString(orderRecord, [
        'shippingDistrict',
        'district',
        'shippingCounty',
        'county',
        'shippingCityArea',
        'cityArea',
        'shippingProvince',
        'province',
        'billingDistrict',
        'billingCounty',
        'billingCityArea',
        'billingProvince',
      ]) ??
      webhookAddress?.shippingDistrict ??
      readStoredOrderWebhookDistrict(orderRecord) ??
      null,
    city: overrides.city ?? readString(orderRecord, ['shippingCity', 'city']) ?? webhookAddress?.shippingCity ?? null,
    country: overrides.country ?? readString(orderRecord, ['shippingCountry', 'country']) ?? webhookAddress?.shippingCountry ?? 'TR',
    postcode:
      overrides.postcode ??
      readString(orderRecord, ['shippingPostcode', 'postcode', 'zip']) ??
      webhookAddress?.shippingPostcode ??
      null,
  };
  const requiredFields = ['name', 'mobile', 'address', 'city', 'country'] as const;
  const missingFields = requiredFields
    .filter((key) => !customer[key])
    .map((key) => `customer.${key === 'mobile' ? 'mobile' : key}`);

  return {
    customer,
    missingFields,
  };
}

function resolveKargoPaymentType(orderRecord: Record<string, unknown>) {
  void orderRecord;
  return 'cash_money';
}

function resolveTryOtoPayment(orderRecord: Record<string, unknown>, amount: number) {
  const raw =
    readString(orderRecord, ['payment_method', 'paymentMethod', 'financialStatus', 'paymentStatus'])?.toLowerCase() ??
    '';
  const isCod = raw === 'cod' || raw.includes('cash_on_delivery') || raw.includes('cash on delivery');
  return {
    payment_method: isCod ? 'cod' : 'paid',
    amount_due: isCod ? amount : 0,
  };
}

function resolveKargoKg(orderRecord: Record<string, unknown>, desi: number) {
  const rawKg = readString(orderRecord, ['shippingKg', 'kg']);
  const parsedKg = rawKg === null ? Number.NaN : Number(rawKg);
  return Number.isFinite(parsedKg) && parsedKg > 0 ? parsedKg : desi;
}

function readPath(value: unknown, path: string) {
  return path.split('.').reduce<unknown>((current, key) => {
    if (!isRecord(current)) {
      return null;
    }
    return current[key] ?? null;
  }, value);
}

function logMissingKargoPayloadFields(payload: Record<string, unknown>, provider: ShippingProvider) {
  if (provider !== ShippingProvider.KARGO_ENTEGRATOR) {
    return;
  }

  const requiredFields = [
    'cargo_integration_id',
    'warehouse_id',
    'payment_type',
    'package_type',
    'payor_type',
    'desi',
    'kg',
    'platform_id',
    'platform_d_id',
    'customer.name',
    'customer.surname',
    'customer.phone',
    'customer.email',
    'customer.country',
    'customer.postcode',
    'customer.city',
    'customer.district',
    'customer.address',
  ];
  const missingFields = requiredFields.filter((field) => {
    const value = readPath(payload, field);
    return value === null || value === undefined || value === '';
  });

  if (missingFields.length) {
    console.warn('[shipping:kargo:missing-required-payload-fields]', {
      provider: 'kargo_entegrator',
      missingFields,
      requestBlocked: false,
    });
  }
}

async function getStoredShippingConfig(vendorId: string) {
  return prisma.vendorShippingConfig.findUnique({
    where: {
      vendorId,
    },
    include: {
      warehouses: {
        orderBy: [
          {
            isDefault: 'desc',
          },
          {
            createdAt: 'asc',
          },
        ],
      },
    },
  });
}

export async function getVendorShippingConfig(vendorId: string): Promise<VendorShippingConfigDto> {
  return mapShippingConfig(await getStoredShippingConfig(vendorId), vendorId);
}

export async function upsertVendorShippingConfig(
  vendorId: string,
  input: VendorShippingConfigUpdateDto,
): Promise<VendorShippingConfigDto> {
  const defaultConfig = mapShippingConfig(null, vendorId);
  const preferredProvider = normalizeProvider(input.preferredProvider ?? defaultConfig.preferredProvider);
  const defaultDesi = input.defaultDesi ?? Number(defaultConfig.defaultDesi);
  const shippingVatPercent = input.shippingVatPercent ?? Number(defaultConfig.shippingVatPercent);

  if (!Number.isFinite(defaultDesi) || defaultDesi <= 0) {
    throw new Error('defaultDesi must be greater than zero.');
  }
  if (!Number.isFinite(shippingVatPercent) || shippingVatPercent < 0) {
    throw new Error('shippingVatPercent must be zero or greater.');
  }
  if (input.cargoIntegrationId !== undefined && input.cargoIntegrationId !== null && !/^\d+$/.test(input.cargoIntegrationId)) {
    throw new Error('cargoIntegrationId must be numeric.');
  }
  if (input.defaultWarehouseId !== undefined && input.defaultWarehouseId !== null && !/^\d+$/.test(input.defaultWarehouseId)) {
    throw new Error('defaultWarehouseId must be numeric.');
  }
  if (input.providerMetadata !== undefined) {
    assertValidKargoPackageType(resolveKargoPackageType(input.providerMetadata));
  }

  const config = await prisma.$transaction(async (tx) => {
    const savedConfig = await tx.vendorShippingConfig.upsert({
      where: {
        vendorId,
      },
      update: {
        preferredProvider: input.preferredProvider === undefined ? undefined : preferredProvider,
        shippingEnabled: input.shippingEnabled,
        defaultDesi: input.defaultDesi === undefined ? undefined : defaultDesi,
        cargoIntegrationId: input.cargoIntegrationId === undefined ? undefined : input.cargoIntegrationId,
        defaultWarehouseId: input.defaultWarehouseId === undefined ? undefined : input.defaultWarehouseId,
        shippingVatPercent: input.shippingVatPercent === undefined ? undefined : shippingVatPercent,
        providerMetadata:
          input.providerMetadata === undefined
            ? undefined
            : (input.providerMetadata as Prisma.InputJsonValue),
      },
      create: {
        vendorId,
        preferredProvider,
        shippingEnabled: input.shippingEnabled ?? defaultConfig.shippingEnabled,
        defaultDesi,
        cargoIntegrationId: input.cargoIntegrationId ?? null,
        defaultWarehouseId: input.defaultWarehouseId ?? null,
        shippingVatPercent,
        providerMetadata:
          input.providerMetadata === undefined
            ? Prisma.JsonNull
            : (input.providerMetadata as Prisma.InputJsonValue),
      },
    });

    const warehouseInputs = input.warehouses ?? (
      input.defaultWarehouseId
        ? [
            {
              warehouseId: input.defaultWarehouseId,
              isDefault: true,
              provider: mapProvider(preferredProvider),
            },
          ]
        : []
    );

    for (const warehouseInput of warehouseInputs) {
      if (!/^\d+$/.test(warehouseInput.warehouseId)) {
        throw new Error('warehouseId must be numeric.');
      }
    }

    for (const warehouseInput of warehouseInputs) {
      const warehouseProvider = normalizeProvider(warehouseInput.provider ?? mapProvider(preferredProvider));
      await tx.vendorShippingWarehouse.upsert({
        where: {
          vendorId_provider_warehouseId: {
            vendorId,
            provider: warehouseProvider,
            warehouseId: warehouseInput.warehouseId,
          },
        },
        update: {
          configId: savedConfig.id,
          name: warehouseInput.name ?? null,
          address: warehouseInput.address ?? null,
          isDefault: Boolean(warehouseInput.isDefault) || warehouseInput.warehouseId === input.defaultWarehouseId,
        },
        create: {
          configId: savedConfig.id,
          vendorId,
          provider: warehouseProvider,
          warehouseId: warehouseInput.warehouseId,
          name: warehouseInput.name ?? null,
          address: warehouseInput.address ?? null,
          isDefault: Boolean(warehouseInput.isDefault) || warehouseInput.warehouseId === input.defaultWarehouseId,
        },
      });
    }

    return tx.vendorShippingConfig.findUniqueOrThrow({
      where: {
        vendorId,
      },
      include: {
        warehouses: {
          orderBy: [
            {
              isDefault: 'desc',
            },
            {
              createdAt: 'asc',
            },
          ],
        },
      },
    });
  });

  return mapShippingConfig(config, vendorId);
}

export function getShippingProviderGateDiagnostics(
  env: AppEnv,
  providerOverride?: ShippingProviderDto,
): ShippingProviderGateDiagnosticsDto {
  const provider = providerOverride ?? env.SHIPPING_PROVIDER;
  const isKargo = provider === 'kargo_entegrator';
  const isTryOto = provider === 'try_oto';
  const supportedProviders: ShippingProviderDto[] = [
    'kargo_entegrator',
    'hepsijet',
    ...(env.TRY_OTO_ENABLED ? (['try_oto'] as ShippingProviderDto[]) : []),
  ];
  const providerSelected = env.SHIPPING_PROVIDER === provider;
  const providerEnabled = isKargo ? env.KARGO_ENTEGRATOR_ENABLED : isTryOto ? env.TRY_OTO_ENABLED : false;
  const baseUrlConfigured = isKargo ? Boolean(env.KARGO_ENTEGRATOR_BASE_URL) : isTryOto ? Boolean(env.TRY_OTO_BASE_URL) : false;
  const apiKeyConfigured = isKargo ? Boolean(env.KARGO_ENTEGRATOR_API_KEY) : isTryOto ? Boolean(env.TRY_OTO_REFRESH_TOKEN) : false;
  const cargoIntegrationIdConfigured = isKargo ? Boolean(env.KARGO_ENTEGRATOR_CARGO_INTEGRATION_ID) : false;
  const packageTypeUsed = DEFAULT_KARGO_PACKAGE_TYPE;
  const missing = [
    !env.SHIPPING_EXECUTION_ENABLED ? 'SHIPPING_EXECUTION_ENABLED' : null,
    isKargo && !env.KARGO_ENTEGRATOR_ENABLED ? 'KARGO_ENTEGRATOR_ENABLED' : null,
    isKargo && !env.KARGO_ENTEGRATOR_BASE_URL ? 'KARGO_ENTEGRATOR_BASE_URL' : null,
    isKargo && !env.KARGO_ENTEGRATOR_API_KEY ? 'KARGO_ENTEGRATOR_API_KEY' : null,
    isTryOto && !env.TRY_OTO_ENABLED ? 'TRY_OTO_ENABLED' : null,
    isTryOto && !env.TRY_OTO_SANDBOX_MODE ? 'TRY_OTO_SANDBOX_MODE' : null,
    isTryOto && !env.TRY_OTO_BASE_URL ? 'TRY_OTO_BASE_URL' : null,
    isTryOto && !env.TRY_OTO_REFRESH_TOKEN ? 'TRY_OTO_REFRESH_TOKEN' : null,
  ].filter((value): value is string => Boolean(value));

  return {
    provider,
    supportedProviders,
    executionReady:
      env.SHIPPING_EXECUTION_ENABLED &&
      providerEnabled &&
      baseUrlConfigured &&
      apiKeyConfigured &&
      (!isTryOto || env.TRY_OTO_SANDBOX_MODE),
    sandboxModeEnabled: isTryOto ? env.TRY_OTO_SANDBOX_MODE : env.SHIPPING_SANDBOX_MODE,
    shippingExecutionEnabled: env.SHIPPING_EXECUTION_ENABLED,
    providerSelected,
    providerEnabled,
    webhookIngestEnabled: isKargo ? env.SHIPPING_SANDBOX_MODE && env.KARGO_ENTEGRATOR_WEBHOOK_INGEST_ENABLED : false,
    baseUrlConfigured,
    apiKeyConfigured,
    cargoIntegrationIdConfigured,
    warehouseIdConfigured: false,
    defaultDesiConfigured: false,
    packageTypeUsed,
    notificationUrlConfigured: false,
    webhookRouteImplemented: true,
    receiverAddressAvailability: 'confirmed_required',
    dummyKargoSupport: isKargo && env.SHIPPING_SANDBOX_MODE ? 'available' : 'not_implemented',
    statusSyncSupport: 'not_implemented',
    missing,
    deprecatedEnvFallbacks:
      isKargo && env.KARGO_ENTEGRATOR_CARGO_INTEGRATION_ID_SOURCE === 'deprecated'
        ? ['ARGO_ENTEGRATOR_CARGO_INTEGRATION_ID']
        : [],
    warnings: isKargo
      ? [
          'Kargo Entegratör webhook/status sync is not implemented.',
          env.SHIPPING_SANDBOX_MODE
            ? 'Dummy Kargo sandbox shipment creation is enabled.'
            : 'Live carrier execution is not enabled or verified.',
        ]
      : isTryOto
        ? [
            'Try OTO is sandbox-only in this phase.',
            'Try OTO webhooks, returns, and production rollout are not implemented.',
          ]
        : [],
  };
}

export async function getShippingProviderReadinessDiagnostics(
  env: AppEnv,
  providerOverride?: ShippingProviderDto,
  vendorId?: string | null,
): Promise<ShippingProviderGateDiagnosticsDto> {
  const diagnostics = getShippingProviderGateDiagnostics(env, providerOverride);
  if ((diagnostics.provider !== 'kargo_entegrator' && diagnostics.provider !== 'try_oto') || !vendorId) {
    return diagnostics;
  }

  const config = mapShippingConfig(await getStoredShippingConfig(vendorId), vendorId);
  const configProviderSelected = mapProvider(config.preferredProvider) === diagnostics.provider;
  if (diagnostics.provider === 'try_oto') {
    const pickupLocationCodeConfigured = Boolean(resolveTryOtoPickupLocationCode(config.providerMetadata));
    const originCityConfigured = Boolean(resolveTryOtoOriginCity(config.providerMetadata));
    const defaultDesiConfigured = Number(config.defaultDesi) > 0;
    const missing = [
      ...diagnostics.missing,
      !pickupLocationCodeConfigured ? 'VENDOR_TRY_OTO_PICKUP_LOCATION_CODE' : null,
      !originCityConfigured ? 'VENDOR_TRY_OTO_ORIGIN_CITY' : null,
      !defaultDesiConfigured ? 'VENDOR_DEFAULT_DESI' : null,
    ].filter((value): value is string => Boolean(value));

    return {
      ...diagnostics,
      providerSelected: configProviderSelected,
      executionReady: diagnostics.executionReady && pickupLocationCodeConfigured && originCityConfigured && defaultDesiConfigured,
      warehouseIdConfigured: pickupLocationCodeConfigured,
      defaultDesiConfigured,
      missing,
    };
  }

  const warehouse = selectDefaultWarehouse(config, diagnostics.provider);
  const cargoIntegrationIdConfigured = Boolean(config.cargoIntegrationId ?? env.KARGO_ENTEGRATOR_CARGO_INTEGRATION_ID);
  const warehouseIdConfigured = Boolean(warehouse?.warehouseId ?? config.defaultWarehouseId);
  const defaultDesiConfigured = Number(config.defaultDesi) > 0;
  const missing = [
    ...diagnostics.missing,
    !cargoIntegrationIdConfigured ? 'VENDOR_CARGO_INTEGRATION_ID' : null,
    !warehouseIdConfigured ? 'VENDOR_WAREHOUSE_ID' : null,
    !defaultDesiConfigured ? 'VENDOR_DEFAULT_DESI' : null,
  ].filter((value): value is string => Boolean(value));

  return {
    ...diagnostics,
    providerSelected: configProviderSelected,
    executionReady:
      diagnostics.executionReady &&
      cargoIntegrationIdConfigured &&
      warehouseIdConfigured &&
      defaultDesiConfigured,
    cargoIntegrationIdConfigured,
    warehouseIdConfigured,
    defaultDesiConfigured,
    packageTypeUsed: resolveKargoPackageType(config.providerMetadata),
    missing,
  };
}

function hasDryRunRetryMarker(snapshot: unknown) {
  if (!isRecord(snapshot)) {
    return false;
  }

  return snapshot.dryRun === true || (Array.isArray(snapshot.disabledGates) && snapshot.disabledGates.length > 0);
}

function assertDryRunRetryEligible(execution: ShipmentExecution) {
  if (execution.shipmentStatus !== ShipmentExecutionStatus.PENDING) {
    throw new Error('Only pending dry-run shipment executions can be retried.');
  }

  if (execution.providerShipmentId) {
    throw new Error('Shipment execution already has a provider shipment id and cannot be retried.');
  }

  if (execution.trackingNumber) {
    throw new Error('Shipment execution already has tracking and cannot be retried.');
  }

  if (!hasDryRunRetryMarker(execution.responseSnapshot)) {
    throw new Error('Only dry-run shipment executions can be retried.');
  }
}

function buildProviderFailureSnapshot(error: unknown, provider: ShippingProvider, baseSnapshot?: unknown) {
  const base = isRecord(baseSnapshot) ? baseSnapshot : {};
  const snapshot: Record<string, unknown> = error instanceof ShippingProviderExecutionError
    ? {
        ...base,
        ...error.responseSnapshot,
        error: error.message,
      }
    : {
        ...base,
        error: error instanceof Error ? error.message : 'Shipping provider execution failed.',
        provider,
      };
  const status = typeof snapshot.status === 'number' ? snapshot.status : null;
  const providerError = readString(snapshot, ['providerError', 'error', 'message', 'reason']) ?? '';
  const detectedFormat = readString(snapshot, ['detectedResponseFormat']) ?? '';
  const validationErrors = Array.isArray(snapshot.providerValidationErrors)
    ? snapshot.providerValidationErrors.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : [];
  const lowerError = providerError.toLowerCase();
  const label =
    validationErrors.length > 0 || status === 400 || status === 422
      ? 'Provider validation failed'
      : lowerError.includes('integration')
        ? 'Invalid integration'
        : detectedFormat === 'html' || detectedFormat === 'invalid_json'
          ? 'Malformed provider response'
          : status && status >= 400
            ? 'Provider rejected request'
            : 'Provider execution failed';

  return appendTimelineEvent(snapshot, {
    label,
    status: status ? String(status) : 'failed',
  });
}

function assertFailedRetryEligible(execution: ShipmentExecution) {
  if (execution.shipmentStatus !== ShipmentExecutionStatus.FAILED) {
    throw new Error('Only failed shipment executions can be retried.');
  }

  if (execution.providerShipmentId) {
    throw new Error('Shipment execution already has a provider shipment id and cannot be retried.');
  }

  if (execution.trackingNumber) {
    throw new Error('Shipment execution already has tracking and cannot be retried.');
  }

  if (execution.labelUrl) {
    throw new Error('Shipment execution already has a label and cannot be retried.');
  }
}

function getWebhookData(payload: unknown) {
  if (!isRecord(payload)) {
    return {};
  }

  if (isRecord(payload.data)) {
    return payload.data;
  }

  if (isRecord(payload.shipment)) {
    return payload.shipment;
  }

  return payload;
}

function normalizeProviderWebhookStatus(status: string | null) {
  const normalized = status?.trim().toLowerCase() ?? '';
  if (normalized === 'created') {
    return ShipmentExecutionStatus.CREATED;
  }
  if (normalized === 'non_processed' || normalized === 'non processed') {
    return ShipmentExecutionStatus.PENDING;
  }
  return null;
}

export async function ingestKargoEntegratorWebhook(
  payload: unknown,
  options: {
    env: AppEnv;
  },
): Promise<{ ok: true; shipmentExecutionId: string; shipmentStatus: ShipmentExecutionDto['shipmentStatus'] } | { ok: false; message: string }> {
  if (!options.env.SHIPPING_SANDBOX_MODE || !options.env.KARGO_ENTEGRATOR_WEBHOOK_INGEST_ENABLED) {
    return {
      ok: false,
      message: 'Kargo Entegratör webhook ingestion is not implemented yet.',
    };
  }

  const data = getWebhookData(payload);
  const providerShipmentId = readString(data, ['providerShipmentId', 'shipmentId', 'id', 'cargoId']);
  const allocationId = readString(data, ['allocationId', 'allocation_id']);
  const trackingNumber = readString(data, ['tracking_number', 'trackingNumber', 'trackingNo', 'cargoTrackingNo']);
  const trackingUrl = readString(data, ['tracking_url', 'trackingUrl', 'trackingLink', 'cargoTrackingUrl']);
  const barcode = readString(data, ['barcode', 'barcodeNumber', 'barcode_number']);
  const providerStatus = readString(data, ['status', 'shipmentStatus', 'cargoStatus']) ?? (trackingNumber ? 'tracking_assigned' : null);
  const normalizedStatus = normalizeProviderWebhookStatus(providerStatus);
  if (!providerShipmentId && !allocationId) {
    return {
      ok: false,
      message: 'Kargo Entegratör webhook did not include a shipment or allocation identifier.',
    };
  }

  const execution = await prisma.shipmentExecution.findFirst({
    where: {
      provider: ShippingProvider.KARGO_ENTEGRATOR,
      OR: [
        providerShipmentId ? { providerShipmentId } : undefined,
        allocationId ? { allocationId } : undefined,
      ].filter((entry): entry is NonNullable<typeof entry> => Boolean(entry)),
    },
  });

  if (!execution) {
    return {
      ok: false,
      message: 'Shipment execution could not be matched for the Kargo Entegratör webhook.',
    };
  }

  const snapshot = appendTimelineEvent(
    {
      ...readSnapshot(execution),
      webhookReceived: true,
      dummyCarrierDetected: true,
      providerStatus,
      barcode: barcode ?? readString(readSnapshot(execution), ['barcode', 'barcodeNumber']),
      lastProviderResponseAt: new Date().toISOString(),
      responseKeys: Object.keys(data).sort(),
    },
    {
      label: trackingNumber ? 'Tracking assigned' : barcode ? 'Barcode assigned' : 'Provider status update',
      status: providerStatus,
    },
  );

  const updated = await prisma.shipmentExecution.update({
    where: {
      id: execution.id,
    },
    data: {
      providerShipmentId: execution.providerShipmentId ?? providerShipmentId,
      trackingNumber: execution.trackingNumber ?? trackingNumber,
      trackingUrl: execution.trackingUrl ?? trackingUrl,
      shipmentStatus: normalizedStatus ?? execution.shipmentStatus,
      responseSnapshot: snapshot as Prisma.InputJsonValue,
    },
  });

  return {
    ok: true,
    shipmentExecutionId: updated.id,
    shipmentStatus: mapStatus(updated.shipmentStatus),
  };
}

async function persistProviderShipmentResult(input: {
  executionId: string;
  allocation: {
    id: string;
    assignedVendorId: string;
    sourceShopifyOrderId: string;
    fulfillmentStatus: string;
    fulfillment: {
      shopifyFulfillmentId: string | null;
      shipmentCreatedAt: Date | null;
    } | null;
  };
  provider: ShippingProvider;
  result: Awaited<ReturnType<ShippingProviderAdapter['createShipment']>>;
}) {
  const { allocation, executionId, provider, result } = input;
  const providerCreated = Boolean(result.providerShipmentId || result.trackingNumber || result.labelUrl);
  const status = providerCreated ? mapProviderStatus(result.shipmentStatus === 'pending' ? 'created' : result.shipmentStatus) : ShipmentExecutionStatus.PENDING;
  const shippingVatPercent = SHIPPING_VAT_PERCENT;
  const shippingVat =
    result.shippingVat ??
    (result.shippingCost === null ? null : Number((result.shippingCost * (shippingVatPercent / 100)).toFixed(2)));
  const responseSnapshot = appendTimelineEvent(
    {
      ...result.responseSnapshot,
      providerStatus: readString(result.responseSnapshot, ['statusField', 'shipmentStatus', 'cargoStatus']),
    },
    {
      label: 'Shipment created',
      status: result.shipmentStatus,
    },
  );

  const updated = await prisma.$transaction(async (tx) => {
    const execution = await tx.shipmentExecution.update({
      where: {
        id: executionId,
      },
      data: {
        providerShipmentId: result.providerShipmentId,
        trackingNumber: result.trackingNumber,
        trackingUrl: result.trackingUrl,
        labelUrl: result.labelUrl,
        shipmentStatus: status,
        shippingCost: result.shippingCost,
        shippingVat,
        currency: result.currency,
        responseSnapshot: responseSnapshot as Prisma.InputJsonValue,
      },
    });

    if (providerCreated) {
      const shipmentUpdatedAt = new Date();
      await tx.vendorAllocation.update({
        where: {
          id: allocation.id,
        },
        data: {
          shippingStatus: allocationShippingStatus(mapStatus(status)),
          fulfillmentStatus: allocation.fulfillmentStatus === 'Pending' ? 'Processing' : allocation.fulfillmentStatus,
          trackingNumber: result.trackingNumber,
          carrier: mapProvider(provider),
        },
      });
      await tx.fulfillment.upsert({
        where: {
          vendorAllocationId: allocation.id,
        },
        update: {
          fulfillmentStatus: 'shipment_created',
          trackingNumber: result.trackingNumber,
          carrier: mapProvider(provider),
          trackingUrl: result.trackingUrl,
          shipmentCreatedAt: allocation.fulfillment?.shipmentCreatedAt ?? shipmentUpdatedAt,
          shipmentUpdatedAt,
          syncStatus: 'carrier_created',
          errorMessage: null,
        },
        create: {
          vendorAllocationId: allocation.id,
          fulfillmentStatus: 'shipment_created',
          trackingNumber: result.trackingNumber,
          carrier: mapProvider(provider),
          trackingUrl: result.trackingUrl,
          shipmentCreatedAt: shipmentUpdatedAt,
          shipmentUpdatedAt,
          syncStatus: 'carrier_created',
        },
      });
    }

    if (result.shippingCost !== null) {
      const providerReference = result.providerShipmentId ?? result.trackingNumber ?? execution.id;
      await tx.shipmentShippingCost.upsert({
        where: {
          id: buildShippingCostId({
            vendorId: allocation.assignedVendorId,
            allocationId: allocation.id,
            provider,
            providerReference,
          }),
        },
        update: {
          providerName: mapProvider(provider),
          providerReference,
          shippingCost: result.shippingCost,
          shippingVatAmount: shippingVat,
          currency: result.currency,
          status: 'CONFIRMED',
          sourceType: 'EXTERNAL_PROVIDER',
        },
        create: {
          id: buildShippingCostId({
            vendorId: allocation.assignedVendorId,
            allocationId: allocation.id,
            provider,
            providerReference,
          }),
          vendorId: allocation.assignedVendorId,
          allocationId: allocation.id,
          sourceShopifyOrderId: allocation.sourceShopifyOrderId,
          sourceShopifyFulfillmentId: allocation.fulfillment?.shopifyFulfillmentId ?? null,
          providerName: mapProvider(provider),
          providerReference,
          shippingCost: result.shippingCost,
          shippingVatAmount: shippingVat,
          currency: result.currency,
          status: 'CONFIRMED',
          sourceType: 'EXTERNAL_PROVIDER',
        },
      });

      return { ...execution, shippingCostLinked: true };
    }

    return execution;
  });

  return mapShipmentExecution(updated);
}

function resolveTryOtoStatusOrderId(execution: ShipmentExecution) {
  const requestSnapshot = isRecord(execution.requestSnapshot) ? execution.requestSnapshot : {};
  const responseSnapshot = readSnapshot(execution);
  return (
    readString(requestSnapshot, ['orderId']) ??
    readString(responseSnapshot, ['orderId', 'providerOrderId']) ??
    execution.providerShipmentId ??
    null
  );
}

export async function refreshTryOtoShipmentStatus(
  shipmentExecutionId: string,
  options: {
    env: AppEnv;
    vendorId: string;
    adapter?: ShippingProviderAdapter;
  },
): Promise<ShipmentExecutionDto> {
  const existing = await prisma.shipmentExecution.findUnique({
    where: {
      id: shipmentExecutionId,
    },
  });

  if (!existing || existing.vendorId !== options.vendorId) {
    throw new Error('Shipment execution not found.');
  }

  if (existing.provider !== ShippingProvider.TRY_OTO) {
    throw new Error('Shipment status refresh is only available for Try OTO shipments.');
  }

  const orderId = resolveTryOtoStatusOrderId(existing);
  if (!orderId) {
    throw new Error('Try OTO status refresh requires a stored order id or provider id.');
  }

  const adapter = options.adapter ?? createShippingProviderAdapter(options.env, 'try_oto');
  const result = await adapter.getShipmentStatus(orderId);
  const mergedSnapshot = appendTimelineEvent(
    {
      ...readSnapshot(existing),
      ...result.responseSnapshot,
      statusField: readString(result.responseSnapshot, ['providerStatus', 'statusField', 'shipmentStatus', 'cargoStatus']),
      lastProviderResponseAt: new Date().toISOString(),
    },
    {
      label:
        result.trackingNumber || result.labelUrl || readString(result.responseSnapshot, ['barcode', 'barcodeNumber'])
          ? 'Try OTO status refreshed'
          : 'Try OTO status checked',
      status: result.shipmentStatus,
    },
  );
  const nextStatus =
    result.shipmentStatus === 'pending'
      ? existing.shipmentStatus
      : mapProviderStatus(result.shipmentStatus);

  const updated = await prisma.shipmentExecution.update({
    where: {
      id: existing.id,
    },
    data: {
      providerShipmentId: result.providerShipmentId ?? existing.providerShipmentId,
      trackingNumber: result.trackingNumber ?? existing.trackingNumber,
      trackingUrl: result.trackingUrl ?? existing.trackingUrl,
      labelUrl: result.labelUrl ?? existing.labelUrl,
      shipmentStatus: nextStatus,
      currency: result.currency ?? existing.currency,
      responseSnapshot: mergedSnapshot as Prisma.InputJsonValue,
    },
  });

  return mapShipmentExecution(updated);
}

export async function listShipmentExecutions(options: {
  vendorId?: string;
  status?: ShipmentExecutionDto['shipmentStatus'];
} = {}): Promise<ShipmentExecutionDto[]> {
  const executions = await prisma.shipmentExecution.findMany({
    where: {
      vendorId: options.vendorId,
      shipmentStatus: options.status ? mapProviderStatus(options.status) : undefined,
    },
    orderBy: {
      createdAt: 'desc',
    },
    take: 100,
  });

  return executions.map((execution) => mapShipmentExecution(execution));
}

export async function getShipmentExecutionById(
  shipmentExecutionId: string,
  vendorId?: string | null,
): Promise<ShipmentExecutionDto | null> {
  const execution = await prisma.shipmentExecution.findUnique({
    where: {
      id: shipmentExecutionId,
    },
  });
  if (!execution || (vendorId && execution.vendorId !== vendorId)) {
    return null;
  }

  const linkedCost = await prisma.shipmentShippingCost.findFirst({
    where: {
      allocationId: execution.allocationId,
      providerReference: execution.providerShipmentId ?? execution.trackingNumber ?? execution.id,
      sourceType: 'EXTERNAL_PROVIDER',
    },
    select: {
      id: true,
    },
  });

  return mapShipmentExecution({ ...execution, shippingCostLinked: Boolean(linkedCost) });
}

async function buildShipmentRequestPreview(
  input: CreateShipmentExecutionDto,
  options: {
    vendorId: string;
    env?: AppEnv;
  },
): Promise<ShipmentExecutionPreviewDto> {
  if (!input.allocationId) {
    throw new Error('allocationId is required.');
  }

  const allocation = await prisma.vendorAllocation.findUnique({
    where: {
      id: input.allocationId,
    },
    include: {
      order: {
        include: {
          webhookEvents: {
            where: {
              topic: 'orders/create',
              rawPayload: {
                not: null,
              },
            },
            orderBy: [
              {
                processedAt: 'desc',
              },
              {
                receivedAt: 'desc',
              },
            ],
            take: 1,
          },
        },
      },
      fulfillment: true,
      lineItems: {
        include: {
          shopifyOrderLineItem: true,
        },
      },
    },
  });

  if (!allocation || allocation.assignedVendorId !== options.vendorId) {
    throw new Error('Allocation could not be found for the selected vendor.');
  }

  if (allocation.cancellationReason || allocation.allocationStatus !== 'ACTIVE') {
    throw new Error('Allocation is not eligible for shipment execution.');
  }

  const config = mapShippingConfig(await getStoredShippingConfig(options.vendorId), options.vendorId);
  if (!config.shippingEnabled) {
    throw new Error('Shipping execution is disabled for this vendor.');
  }

  const provider = normalizeProvider(input.provider ?? config.preferredProvider);
  const providerDto = mapProvider(provider);
  if (provider !== ShippingProvider.HEPSIJET && provider !== ShippingProvider.KARGO_ENTEGRATOR && provider !== ShippingProvider.TRY_OTO) {
    throw new Error('Only Hepsijet, Kargo Entegratör, and Try OTO sandbox shipment execution are implemented.');
  }
  const warehouseConfig =
    provider === ShippingProvider.KARGO_ENTEGRATOR ? requireWarehouseConfig(config, providerDto, options.env) : null;
  const tryOtoPickupLocationCode = provider === ShippingProvider.TRY_OTO
    ? resolveTryOtoPickupLocationCode(config.providerMetadata)
    : null;
  if (provider === ShippingProvider.TRY_OTO && !tryOtoPickupLocationCode) {
    throw new Error('Try OTO pickupLocationCode is not configured for this vendor.');
  }
  const tryOtoOriginCity = provider === ShippingProvider.TRY_OTO
    ? resolveTryOtoOriginCity(config.providerMetadata)
    : null;
  if (provider === ShippingProvider.TRY_OTO && !tryOtoOriginCity) {
    throw new Error('Try OTO origin city is required for delivery option lookup.');
  }

  const lineItems = allocation.lineItems.map((lineItem) => ({
    title: lineItem.shopifyOrderLineItem.title ?? lineItem.shopifyOrderLineItem.sku ?? 'Shopify item',
    sku: lineItem.shopifyOrderLineItem.sku,
    quantity: lineItem.quantity,
    lineAmount: toNumber(lineItem.lineAmount),
  }));
  const desi = resolveShipmentDesi(lineItems, config.defaultDesi);
  const customer = splitCustomerName(allocation.order.customerName);
  const dummyKargoRequested = provider === ShippingProvider.KARGO_ENTEGRATOR && isDummyKargoRequested(input, options.env);
  if (input.carrierId === DUMMY_KARGO_CARRIER_ID && !options.env?.SHIPPING_SANDBOX_MODE) {
    throw new Error('Dummy Kargo shipment creation is available only when shipping sandbox mode is enabled.');
  }
  const kargoCustomer = buildKargoCustomer({
    order: allocation.order,
    customerName: allocation.order.customerName,
    customerEmail: allocation.order.customerEmail,
    customerOverrides: input.customerOverrides,
  });
  const tryOtoCustomer = buildTryOtoCustomer({
    order: allocation.order,
    customerName: allocation.order.customerName,
    customerEmail: allocation.order.customerEmail,
    customerOverrides: input.customerOverrides,
  });
  const missingCustomerFields = [
    ...(dummyKargoRequested
      ? kargoCustomer.missingFields
      : provider === ShippingProvider.TRY_OTO
        ? tryOtoCustomer.missingFields
        : [
            customer.name ? null : 'customer.name',
            customer.surname ? null : 'customer.surname',
          ]),
  ].filter((field): field is string => Boolean(field));
  if ((dummyKargoRequested || provider === ShippingProvider.TRY_OTO) && missingCustomerFields.length > 0) {
    throw new Error(
      [
        'Missing required shipment fields:',
        ...missingCustomerFields.map((field) => `- ${field}`),
        '',
        'Provider request blocked before create call.',
      ].join('\n'),
    );
  }
  const notificationUrl = buildNotificationUrl(input.notificationUrl);
  const cargoIntegrationId = warehouseConfig?.cargoIntegrationId ?? null;
  const warehouseId = warehouseConfig?.warehouseId ?? null;
  const numericCargoIntegrationId = Number(cargoIntegrationId);
  const numericWarehouseId = Number(warehouseId);
  const orderRecord = isRecord(allocation.order) ? allocation.order : {};
  const kg = resolveKargoKg(orderRecord, desi);
  const note = readString(orderRecord, ['shippingNote', 'shipmentNote']) ?? '';
  const packageType = provider === ShippingProvider.KARGO_ENTEGRATOR
    ? resolveKargoPackageType(config.providerMetadata)
    : DEFAULT_KARGO_PACKAGE_TYPE;
  if (provider === ShippingProvider.KARGO_ENTEGRATOR) {
    assertValidKargoPackageType(packageType);
  }
  const amount = lineItems.reduce((sum, lineItem) => sum + lineItem.lineAmount, 0);
  const tryOtoPayment = resolveTryOtoPayment(orderRecord, amount);
  const tryOtoPackageWeight = resolveTryOtoPackageWeight(config.providerMetadata, kg);
  const tryOtoDeliveryOptionId = provider === ShippingProvider.TRY_OTO
    ? resolveTryOtoDeliveryOptionId(config.providerMetadata)
    : null;
  const tryOtoOrderId = [
    'shopify',
    (allocation.sourceShopifyOrderId ?? allocation.sourceShopifyOrderNumber ?? allocation.id).replace(/[^a-zA-Z0-9]+/g, '-'),
    'allocation',
    allocation.id.replace(/[^a-zA-Z0-9]+/g, '-'),
  ].join('-');

  const payload = provider === ShippingProvider.TRY_OTO
    ? {
        orderId: tryOtoOrderId,
        pickupLocationCode: tryOtoPickupLocationCode,
        payment_method: tryOtoPayment.payment_method,
        amount,
        amount_due: tryOtoPayment.amount_due,
        currency: 'TRY',
        packageCount: 1,
        packageWeight: tryOtoPackageWeight,
        ...(tryOtoOriginCity ? { originCity: tryOtoOriginCity } : {}),
        ...(tryOtoDeliveryOptionId ? { deliveryOptionId: tryOtoDeliveryOptionId } : {}),
        customer: tryOtoCustomer.customer,
        items: lineItems.map((lineItem) => ({
          name: lineItem.title,
          sku: lineItem.sku,
          quantity: lineItem.quantity,
          price: lineItem.lineAmount,
          rowTotal: lineItem.lineAmount,
        })),
        reference: {
          allocation_id: allocation.id,
          shopify_order_id: allocation.sourceShopifyOrderId,
          shopify_order_number: allocation.sourceShopifyOrderNumber,
          vendor_id: allocation.assignedVendorId,
        },
      }
    : {
        cargo_integration_id: Number.isFinite(numericCargoIntegrationId) ? numericCargoIntegrationId : cargoIntegrationId,
        warehouse_id: Number.isFinite(numericWarehouseId) ? numericWarehouseId : warehouseId,
        ...(dummyKargoRequested ? { cargo_company: { id: DUMMY_KARGO_CARRIER_ID } } : {}),
        platform_id: allocation.sourceShopifyOrderId,
        platform_d_id: allocation.sourceShopifyOrderNumber,
        notification_url: notificationUrl,
        customer: provider === ShippingProvider.KARGO_ENTEGRATOR
          ? kargoCustomer.customer
          : {
              name: customer.name,
              surname: customer.surname,
              email: allocation.order.customerEmail,
            },
        payment_type: resolveKargoPaymentType(orderRecord),
        ...(provider === ShippingProvider.KARGO_ENTEGRATOR ? { package_type: packageType } : {}),
        ...(provider === ShippingProvider.KARGO_ENTEGRATOR ? { payor_type: 'sender' } : {}),
        desi,
        ...(provider === ShippingProvider.KARGO_ENTEGRATOR ? { kg } : {}),
        ...(dummyKargoRequested ? { note } : {}),
        lines: lineItems.map((lineItem) => ({
          title: lineItem.title,
          quantity: lineItem.quantity,
          sku: lineItem.sku,
        })),
        reference: {
          allocation_id: allocation.id,
          shopify_order_id: allocation.sourceShopifyOrderId,
          shopify_order_number: allocation.sourceShopifyOrderNumber,
          vendor_id: allocation.assignedVendorId,
        },
      };
  logMissingKargoPayloadFields(payload, provider);

  return {
    allocationId: allocation.id,
    vendorId: allocation.assignedVendorId,
    provider: providerDto,
    cargoIntegrationId,
    warehouseId: provider === ShippingProvider.TRY_OTO ? tryOtoPickupLocationCode : warehouseId,
    desi: toAmountString(desi),
    notificationUrl,
    payload,
    customerFieldsValid: missingCustomerFields.length === 0,
    missingCustomerFields,
    warnings:
      provider === ShippingProvider.KARGO_ENTEGRATOR
        ? [
            'Kargo Entegratör webhook/status sync is not implemented.',
            dummyKargoRequested
              ? 'Dummy Kargo sandbox shipment creation is enabled.'
              : 'Live carrier execution is not enabled or verified.',
          ]
        : provider === ShippingProvider.TRY_OTO
          ? [
              'Try OTO is sandbox-only in this phase.',
              'Try OTO webhooks, returns, and production rollout are not implemented.',
            ]
        : [],
  };
}

export async function previewShipmentExecution(
  input: CreateShipmentExecutionDto,
  options: {
    vendorId: string;
    env?: AppEnv;
  },
): Promise<ShipmentExecutionPreviewDto> {
  return buildShipmentRequestPreview(input, options);
}

export async function createShipmentExecution(
  input: CreateShipmentExecutionDto,
  options: {
    env: AppEnv;
    vendorId: string;
    adapter?: ShippingProviderAdapter;
  },
): Promise<ShipmentExecutionDto> {
  const preview = await buildShipmentRequestPreview(input, {
    vendorId: options.vendorId,
    env: options.env,
  });

  const allocation = await prisma.vendorAllocation.findUnique({
    where: {
      id: input.allocationId,
    },
    include: {
      order: true,
      fulfillment: true,
      lineItems: {
        include: {
          shopifyOrderLineItem: true,
        },
      },
    },
  });

  if (!allocation) {
    throw new Error('Allocation could not be found for the selected vendor.');
  }

  const provider = normalizeProvider(preview.provider);
  const providerDto = preview.provider;

  const existing = await prisma.shipmentExecution.findUnique({
    where: {
      allocationId_provider: {
        allocationId: allocation.id,
        provider,
      },
    },
  });
  if (existing) {
    return getShipmentExecutionById(existing.id, options.vendorId) as Promise<ShipmentExecutionDto>;
  }

  const desi = resolvePersistedShipmentDesi(preview);
  const requestSnapshot = preview.payload;
  const executionId = buildShipmentExecutionId({ allocationId: allocation.id, provider });

  await prisma.shipmentExecution.create({
    data: {
      id: executionId,
      sourceShopifyOrderId: allocation.sourceShopifyOrderId,
      sourceShopifyOrderNumber: allocation.sourceShopifyOrderNumber,
      sourceShopifyFulfillmentId: allocation.fulfillment?.shopifyFulfillmentId ?? null,
      provider,
      shipmentStatus: ShipmentExecutionStatus.PENDING,
      desi,
      cargoIntegrationId: preview.cargoIntegrationId,
      warehouseId: preview.warehouseId,
      requestSnapshot: requestSnapshot as Prisma.InputJsonValue,
      allocation: {
        connect: {
          id: allocation.id,
        },
      },
      vendor: {
        connect: {
          id: allocation.assignedVendorId,
        },
      },
    },
  });

  try {
    const adapter = options.adapter ?? createShippingProviderAdapter(options.env, providerDto);
    logKargoExecutionModeSelection(input, preview, options.env);
    const result = await adapter.createShipment({
      allocationId: allocation.id,
      vendorId: allocation.assignedVendorId,
      provider: providerDto,
      requestSnapshot,
    });
    return persistProviderShipmentResult({
      executionId,
      allocation,
      provider,
      result,
    });
  } catch (error) {
    const attemptSnapshot = appendTimelineEvent({}, {
      label: 'Create attempted',
      status: 'failed',
    });
    const failed = await prisma.shipmentExecution.update({
      where: {
        id: executionId,
      },
      data: {
        shipmentStatus: ShipmentExecutionStatus.FAILED,
        responseSnapshot: buildProviderFailureSnapshot(error, provider, attemptSnapshot),
      },
    });

    return mapShipmentExecution(failed);
  }
}

export async function retryDryRunShipmentExecution(
  shipmentExecutionId: string,
  options: {
    env: AppEnv;
    actorRole?: string;
    notificationUrl?: string | null;
    adapter?: ShippingProviderAdapter;
  },
): Promise<ShipmentExecutionDto> {
  if (options.actorRole !== 'admin') {
    throw new Error('Admin access required.');
  }

  const existing = await prisma.shipmentExecution.findUnique({
    where: {
      id: shipmentExecutionId,
    },
  });

  if (!existing) {
    throw new Error('Shipment execution not found.');
  }

  assertDryRunRetryEligible(existing);

  const providerDto = mapProvider(existing.provider);
  const diagnostics = getShippingProviderGateDiagnostics(options.env, providerDto);
  if (!diagnostics.executionReady) {
    const missing = diagnostics.missing.length ? diagnostics.missing.join(', ') : 'provider configuration';
    throw new Error(`Shipping provider execution is not ready. Missing: ${missing}.`);
  }

  const preview = await buildShipmentRequestPreview(
    {
      allocationId: existing.allocationId,
      provider: providerDto,
      notificationUrl: options.notificationUrl ?? undefined,
    },
    {
      vendorId: existing.vendorId,
      env: options.env,
    },
  );

  const provider = normalizeProvider(preview.provider);
  if (provider !== existing.provider) {
    throw new Error('Vendor shipping provider no longer matches the shipment execution provider.');
  }

  const allocation = await prisma.vendorAllocation.findUnique({
    where: {
      id: existing.allocationId,
    },
    include: {
      order: true,
      fulfillment: true,
      lineItems: {
        include: {
          shopifyOrderLineItem: true,
        },
      },
    },
  });

  if (!allocation || allocation.assignedVendorId !== existing.vendorId) {
    throw new Error('Allocation could not be found for the selected shipment execution.');
  }

  const requestSnapshot = preview.payload;
  await prisma.shipmentExecution.update({
    where: {
      id: existing.id,
    },
    data: {
      desi: Number(preview.desi),
      cargoIntegrationId: preview.cargoIntegrationId,
      warehouseId: preview.warehouseId,
      requestSnapshot: requestSnapshot as Prisma.InputJsonValue,
    },
  });

  try {
    const adapter = options.adapter ?? createShippingProviderAdapter(options.env, providerDto);
    logKargoExecutionModeSelection(
      {
        allocationId: existing.allocationId,
        provider: providerDto,
        notificationUrl: options.notificationUrl ?? undefined,
      },
      preview,
      options.env,
    );
    const result = await adapter.createShipment({
      allocationId: allocation.id,
      vendorId: allocation.assignedVendorId,
      provider: providerDto,
      requestSnapshot,
    });

    return persistProviderShipmentResult({
      executionId: existing.id,
      allocation,
      provider,
      result,
    });
  } catch (error) {
    const failed = await prisma.shipmentExecution.update({
      where: {
        id: existing.id,
      },
      data: {
        shipmentStatus: ShipmentExecutionStatus.FAILED,
        responseSnapshot: buildProviderFailureSnapshot(error, provider, existing.responseSnapshot),
      },
    });

    return mapShipmentExecution(failed);
  }
}

export async function retryFailedShipmentExecution(
  shipmentExecutionId: string,
  options: {
    env: AppEnv;
    vendorId: string;
    notificationUrl?: string | null;
    customerOverrides?: CreateShipmentExecutionDto['customerOverrides'];
    adapter?: ShippingProviderAdapter;
  },
): Promise<ShipmentExecutionDto> {
  const existing = await prisma.shipmentExecution.findUnique({
    where: {
      id: shipmentExecutionId,
    },
  });

  if (!existing || existing.vendorId !== options.vendorId) {
    throw new Error('Shipment execution not found.');
  }

  assertFailedRetryEligible(existing);

  const providerDto = mapProvider(existing.provider);
  const diagnostics = getShippingProviderGateDiagnostics(options.env, providerDto);
  if (!diagnostics.executionReady) {
    const missing = diagnostics.missing.length ? diagnostics.missing.join(', ') : 'provider configuration';
    throw new Error(`Shipping provider execution is not ready. Missing: ${missing}.`);
  }

  const preview = await buildShipmentRequestPreview(
    {
      allocationId: existing.allocationId,
      provider: providerDto,
      notificationUrl: options.notificationUrl ?? undefined,
      customerOverrides: options.customerOverrides,
    },
    {
      vendorId: existing.vendorId,
      env: options.env,
    },
  );

  const provider = normalizeProvider(preview.provider);
  if (provider !== existing.provider) {
    throw new Error('Vendor shipping provider no longer matches the shipment execution provider.');
  }

  const allocation = await prisma.vendorAllocation.findUnique({
    where: {
      id: existing.allocationId,
    },
    include: {
      order: true,
      fulfillment: true,
      lineItems: {
        include: {
          shopifyOrderLineItem: true,
        },
      },
    },
  });

  if (!allocation || allocation.assignedVendorId !== existing.vendorId) {
    throw new Error('Allocation could not be found for the selected shipment execution.');
  }

  const retrySnapshot = appendTimelineEvent(existing.responseSnapshot, {
    label: 'Retry attempted',
    status: 'pending',
  });
  const requestSnapshot = preview.payload;
  await prisma.shipmentExecution.update({
    where: {
      id: existing.id,
    },
    data: {
      shipmentStatus: ShipmentExecutionStatus.PENDING,
      desi: Number(preview.desi),
      cargoIntegrationId: preview.cargoIntegrationId,
      warehouseId: preview.warehouseId,
      requestSnapshot: requestSnapshot as Prisma.InputJsonValue,
      responseSnapshot: retrySnapshot as Prisma.InputJsonValue,
    },
  });

  try {
    const adapter = options.adapter ?? createShippingProviderAdapter(options.env, providerDto);
    logKargoExecutionModeSelection(
      {
        allocationId: existing.allocationId,
        provider: providerDto,
        notificationUrl: options.notificationUrl ?? undefined,
        customerOverrides: options.customerOverrides,
      },
      preview,
      options.env,
    );
    const result = await adapter.createShipment({
      allocationId: allocation.id,
      vendorId: allocation.assignedVendorId,
      provider: providerDto,
      requestSnapshot,
    });

    return persistProviderShipmentResult({
      executionId: existing.id,
      allocation,
      provider,
      result,
    });
  } catch (error) {
    const failed = await prisma.shipmentExecution.update({
      where: {
        id: existing.id,
      },
      data: {
        shipmentStatus: ShipmentExecutionStatus.FAILED,
        responseSnapshot: buildProviderFailureSnapshot(error, provider, retrySnapshot),
      },
    });

    return mapShipmentExecution(failed);
  }
}
