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
  return input.carrierId === DUMMY_KARGO_CARRIER_ID || Boolean(env?.SHIPPING_SANDBOX_MODE);
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

function buildKargoCustomer(input: {
  order: unknown;
  customerName: string | null | undefined;
  customerEmail: string | null | undefined;
}) {
  const orderRecord = isRecord(input.order) ? input.order : {};
  const name = splitCustomerName(input.customerName);
  const customer = {
    name: name.name,
    surname: name.surname,
    phone: readString(orderRecord, ['customerPhone', 'phone', 'shippingPhone']),
    email: input.customerEmail ?? readString(orderRecord, ['customerEmail', 'email']),
    country: readString(orderRecord, ['shippingCountry', 'country']),
    postcode: readString(orderRecord, ['shippingPostcode', 'postcode', 'zip']),
    city: readString(orderRecord, ['shippingCity', 'city']),
    district: readString(orderRecord, ['shippingDistrict', 'district']),
    address: readString(orderRecord, ['shippingAddress', 'address']),
  };
  const missingFields = Object.entries(customer)
    .filter(([, value]) => !value)
    .map(([key]) => `customer.${key}`);

  return {
    customer,
    missingFields,
  };
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
  const provider = providerOverride ?? (env.SHIPPING_PROVIDER === 'kargo_entegrator' ? 'kargo_entegrator' : 'hepsijet');
  const isKargo = provider === 'kargo_entegrator';
  const providerSelected = env.SHIPPING_PROVIDER === provider;
  const providerEnabled = isKargo ? env.KARGO_ENTEGRATOR_ENABLED : false;
  const baseUrlConfigured = isKargo ? Boolean(env.KARGO_ENTEGRATOR_BASE_URL) : false;
  const apiKeyConfigured = isKargo ? Boolean(env.KARGO_ENTEGRATOR_API_KEY) : false;
  const cargoIntegrationIdConfigured = isKargo ? Boolean(env.KARGO_ENTEGRATOR_CARGO_INTEGRATION_ID) : false;
  const missing = [
    !env.SHIPPING_EXECUTION_ENABLED ? 'SHIPPING_EXECUTION_ENABLED' : null,
    isKargo && !env.KARGO_ENTEGRATOR_ENABLED ? 'KARGO_ENTEGRATOR_ENABLED' : null,
    isKargo && !env.KARGO_ENTEGRATOR_BASE_URL ? 'KARGO_ENTEGRATOR_BASE_URL' : null,
    isKargo && !env.KARGO_ENTEGRATOR_API_KEY ? 'KARGO_ENTEGRATOR_API_KEY' : null,
  ].filter((value): value is string => Boolean(value));

  return {
    provider,
    executionReady: env.SHIPPING_EXECUTION_ENABLED && providerEnabled && baseUrlConfigured && apiKeyConfigured,
    sandboxModeEnabled: env.SHIPPING_SANDBOX_MODE,
    shippingExecutionEnabled: env.SHIPPING_EXECUTION_ENABLED,
    providerSelected,
    providerEnabled,
    webhookIngestEnabled: env.SHIPPING_SANDBOX_MODE && env.KARGO_ENTEGRATOR_WEBHOOK_INGEST_ENABLED,
    baseUrlConfigured,
    apiKeyConfigured,
    cargoIntegrationIdConfigured,
    warehouseIdConfigured: false,
    defaultDesiConfigured: false,
    notificationUrlConfigured: false,
    webhookRouteImplemented: true,
    receiverAddressAvailability: 'unknown_required',
    dummyKargoSupport: env.SHIPPING_SANDBOX_MODE ? 'available' : 'not_implemented',
    statusSyncSupport: 'not_implemented',
    missing,
    deprecatedEnvFallbacks:
      isKargo && env.KARGO_ENTEGRATOR_CARGO_INTEGRATION_ID_SOURCE === 'deprecated'
        ? ['ARGO_ENTEGRATOR_CARGO_INTEGRATION_ID']
        : [],
    warnings: isKargo
      ? [
          'Kargo Entegratör create contract is not verified.',
          'Receiver address and phone requirements are unknown.',
          'Kargo Entegratör webhook/status sync is not implemented.',
          env.SHIPPING_SANDBOX_MODE ? 'Dummy Kargo sandbox shipment creation is enabled.' : 'Dummy Kargo creation is not enabled.',
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
  if (diagnostics.provider !== 'kargo_entegrator' || !vendorId) {
    return diagnostics;
  }

  const config = mapShippingConfig(await getStoredShippingConfig(vendorId), vendorId);
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
    executionReady:
      diagnostics.executionReady &&
      cargoIntegrationIdConfigured &&
      warehouseIdConfigured &&
      defaultDesiConfigured,
    cargoIntegrationIdConfigured,
    warehouseIdConfigured,
    defaultDesiConfigured,
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

function buildProviderFailureSnapshot(error: unknown, provider: ShippingProvider) {
  return error instanceof ShippingProviderExecutionError
    ? {
        ...error.responseSnapshot,
        error: error.message,
      }
    : {
        error: error instanceof Error ? error.message : 'Shipping provider execution failed.',
        provider,
      };
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
      order: true,
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
  if (provider !== ShippingProvider.HEPSIJET && provider !== ShippingProvider.KARGO_ENTEGRATOR) {
    throw new Error('Only Hepsijet and Kargo Entegratör shipment execution are implemented.');
  }
  const warehouseConfig =
    provider === ShippingProvider.KARGO_ENTEGRATOR ? requireWarehouseConfig(config, providerDto, options.env) : null;

  const lineItems = allocation.lineItems.map((lineItem) => ({
    title: lineItem.shopifyOrderLineItem.title ?? lineItem.shopifyOrderLineItem.sku ?? 'Shopify item',
    sku: lineItem.shopifyOrderLineItem.sku,
    quantity: lineItem.quantity,
    lineAmount: toNumber(lineItem.lineAmount),
  }));
  const desi = inferShipmentDesi(lineItems, Number(config.defaultDesi));
  const customer = splitCustomerName(allocation.order.customerName);
  const dummyKargoRequested = provider === ShippingProvider.KARGO_ENTEGRATOR && isDummyKargoRequested(input, options.env);
  if (input.carrierId === DUMMY_KARGO_CARRIER_ID && !options.env?.SHIPPING_SANDBOX_MODE) {
    throw new Error('Dummy Kargo shipment creation is available only when shipping sandbox mode is enabled.');
  }
  const kargoCustomer = buildKargoCustomer({
    order: allocation.order,
    customerName: allocation.order.customerName,
    customerEmail: allocation.order.customerEmail,
  });
  const missingCustomerFields = [
    ...(dummyKargoRequested ? kargoCustomer.missingFields : [
      customer.name ? null : 'customer.name',
      customer.surname ? null : 'customer.surname',
    ]),
  ].filter((field): field is string => Boolean(field));
  if (dummyKargoRequested && missingCustomerFields.length > 0) {
    throw new Error(`Dummy Kargo shipment requires customer/address fields: ${missingCustomerFields.join(', ')}.`);
  }
  const notificationUrl = buildNotificationUrl(input.notificationUrl);
  const cargoIntegrationId = warehouseConfig?.cargoIntegrationId ?? null;
  const warehouseId = warehouseConfig?.warehouseId ?? null;
  const numericCargoIntegrationId = Number(cargoIntegrationId);
  const numericWarehouseId = Number(warehouseId);
  const orderRecord = isRecord(allocation.order) ? allocation.order : {};
  const kg = readString(orderRecord, ['shippingKg', 'kg']);
  const note = readString(orderRecord, ['shippingNote', 'shipmentNote']) ?? '';

  const payload = {
    cargo_integration_id: Number.isFinite(numericCargoIntegrationId) ? numericCargoIntegrationId : cargoIntegrationId,
    warehouse_id: Number.isFinite(numericWarehouseId) ? numericWarehouseId : warehouseId,
    ...(dummyKargoRequested ? { cargo_company: { id: DUMMY_KARGO_CARRIER_ID } } : {}),
    platform_id: Number.isFinite(numericCargoIntegrationId) ? numericCargoIntegrationId : cargoIntegrationId,
    platform_d_id: Number.isFinite(numericWarehouseId) ? numericWarehouseId : warehouseId,
    notification_url: notificationUrl,
    customer: dummyKargoRequested
      ? kargoCustomer.customer
      : {
          name: customer.name,
          surname: customer.surname,
          email: allocation.order.customerEmail,
        },
    payment_type: 'cash_money',
    ...(dummyKargoRequested ? { package_type: 'package', payor_type: 'sender' } : {}),
    desi,
    ...(dummyKargoRequested && kg ? { kg: Number.isFinite(Number(kg)) ? Number(kg) : kg } : {}),
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

  return {
    allocationId: allocation.id,
    vendorId: allocation.assignedVendorId,
    provider: providerDto,
    cargoIntegrationId,
    warehouseId,
    desi: toAmountString(desi),
    notificationUrl,
    payload,
    customerFieldsValid: missingCustomerFields.length === 0,
    missingCustomerFields,
    warnings:
      provider === ShippingProvider.KARGO_ENTEGRATOR
        ? [
            'Kargo Entegratör create contract is not verified.',
            'Receiver address and phone requirements are unknown.',
            'Kargo Entegratör webhook/status sync is not implemented.',
            dummyKargoRequested ? 'Dummy Kargo sandbox shipment creation is enabled.' : 'Dummy Kargo creation is not enabled.',
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

  const desi = Number(preview.payload.desi);
  const requestSnapshot = preview.payload;
  const executionId = buildShipmentExecutionId({ allocationId: allocation.id, provider });

  await prisma.shipmentExecution.create({
    data: {
      id: executionId,
      allocationId: allocation.id,
      vendorId: allocation.assignedVendorId,
      sourceShopifyOrderId: allocation.sourceShopifyOrderId,
      sourceShopifyOrderNumber: allocation.sourceShopifyOrderNumber,
      sourceShopifyFulfillmentId: allocation.fulfillment?.shopifyFulfillmentId ?? null,
      provider,
      shipmentStatus: ShipmentExecutionStatus.PENDING,
      desi,
      cargoIntegrationId: preview.cargoIntegrationId,
      warehouseId: preview.warehouseId,
      requestSnapshot: requestSnapshot as Prisma.InputJsonValue,
    },
  });

  try {
    const adapter = options.adapter ?? createShippingProviderAdapter(options.env, providerDto);
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
    const failed = await prisma.shipmentExecution.update({
      where: {
        id: executionId,
      },
      data: {
        shipmentStatus: ShipmentExecutionStatus.FAILED,
        responseSnapshot: buildProviderFailureSnapshot(error, provider),
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
        responseSnapshot: buildProviderFailureSnapshot(error, provider),
      },
    });

    return mapShipmentExecution(failed);
  }
}
