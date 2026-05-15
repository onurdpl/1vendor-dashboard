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
  ShippingProviderDto,
  VendorShippingConfigDto,
  VendorShippingConfigUpdateDto,
} from './shipping-execution.types.js';

const SHIPPING_VAT_PERCENT = 18;
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
    createdAt: execution.createdAt.toISOString(),
    updatedAt: execution.updatedAt.toISOString(),
  };
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

function requireWarehouseConfig(config: VendorShippingConfigDto, provider: ShippingProviderDto) {
  const warehouse = selectDefaultWarehouse(config, provider);
  const warehouseId = warehouse?.warehouseId ?? config.defaultWarehouseId;
  if (!config.cargoIntegrationId || !warehouseId) {
    throw new Error('Vendor shipping warehouse is not configured.');
  }

  return {
    cargoIntegrationId: config.cargoIntegrationId,
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
    provider === ShippingProvider.KARGO_ENTEGRATOR ? requireWarehouseConfig(config, providerDto) : null;

  const lineItems = allocation.lineItems.map((lineItem) => ({
    title: lineItem.shopifyOrderLineItem.title ?? lineItem.shopifyOrderLineItem.sku ?? 'Shopify item',
    sku: lineItem.shopifyOrderLineItem.sku,
    quantity: lineItem.quantity,
    lineAmount: toNumber(lineItem.lineAmount),
  }));
  const desi = inferShipmentDesi(lineItems, Number(config.defaultDesi));
  const customer = splitCustomerName(allocation.order.customerName);
  const missingCustomerFields = [
    customer.name ? null : 'customer.name',
    customer.surname ? null : 'customer.surname',
  ].filter((field): field is string => Boolean(field));
  const notificationUrl = buildNotificationUrl(input.notificationUrl);
  const cargoIntegrationId = warehouseConfig?.cargoIntegrationId ?? null;
  const warehouseId = warehouseConfig?.warehouseId ?? null;
  const numericCargoIntegrationId = Number(cargoIntegrationId);
  const numericWarehouseId = Number(warehouseId);

  const payload = {
    cargo_integration_id: Number.isFinite(numericCargoIntegrationId) ? numericCargoIntegrationId : cargoIntegrationId,
    warehouse_id: Number.isFinite(numericWarehouseId) ? numericWarehouseId : warehouseId,
    platform_id: Number.isFinite(numericCargoIntegrationId) ? numericCargoIntegrationId : cargoIntegrationId,
    platform_d_id: Number.isFinite(numericWarehouseId) ? numericWarehouseId : warehouseId,
    notification_url: notificationUrl,
    customer: {
      name: customer.name,
      surname: customer.surname,
      email: allocation.order.customerEmail,
    },
    payment_type: 'cash_money',
    desi,
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
  };
}

export async function previewShipmentExecution(
  input: CreateShipmentExecutionDto,
  options: {
    vendorId: string;
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
    const providerCreated = Boolean(result.providerShipmentId || result.trackingNumber || result.labelUrl);
    const status = providerCreated ? mapProviderStatus(result.shipmentStatus === 'pending' ? 'created' : result.shipmentStatus) : ShipmentExecutionStatus.PENDING;
    const shippingVatPercent = SHIPPING_VAT_PERCENT;
    const shippingVat =
      result.shippingVat ??
      (result.shippingCost === null ? null : Number((result.shippingCost * (shippingVatPercent / 100)).toFixed(2)));

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
          responseSnapshot: result.responseSnapshot as Prisma.InputJsonValue,
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
  } catch (error) {
    const responseSnapshot =
      error instanceof ShippingProviderExecutionError
        ? {
            ...error.responseSnapshot,
            error: error.message,
          }
        : {
            error: error instanceof Error ? error.message : 'Shipping provider execution failed.',
            provider,
          };
    const failed = await prisma.shipmentExecution.update({
      where: {
        id: executionId,
      },
      data: {
        shipmentStatus: ShipmentExecutionStatus.FAILED,
        responseSnapshot,
      },
    });

    return mapShipmentExecution(failed);
  }
}
