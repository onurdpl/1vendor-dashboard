import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useMutationAction } from '../hooks/useMutationAction';
import { useQueryResource } from '../hooks/useQueryResource';
import { queryKeys } from '../lib/api/queryKeys';
import { formatDateTime } from '../services/real/formatting';
import {
  getShippingProviderDiagnostics,
  syncKargonomiWarehouseDetails,
  updateVendorShippingConfig,
  type ShippingProvider,
  type ShippingProviderDiagnostics,
  type VendorShippingConfig,
  type VendorShippingConfigUpdate,
} from '../features/orders/api';

type ShippingConfigDraftProvider = ShippingProvider | 'navlungo';

type ShippingConfigDraft = {
  preferredProvider: ShippingConfigDraftProvider;
  cargoIntegrationId: string;
  defaultWarehouseId: string;
  defaultDesi: string;
  packageType: 'box' | 'document';
  tryOtoPickupLocationCode: string;
  tryOtoOriginCity: string;
  kargonomiShippingProviderId: string;
  kargonomiBuyerStateId: string;
  kargonomiBuyerCityId: string;
  kargonomiReturnReceiverName: string;
  kargonomiReturnReceiverPhone: string;
  kargonomiReturnReceiverAddress: string;
  navlungoSenderAddressId: string;
  navlungoSenderName: string;
  navlungoSenderPhone: string;
  navlungoSenderEmail: string;
  navlungoSenderAddress: string;
  navlungoSenderCountry: string;
  navlungoSenderCity: string;
  navlungoSenderDistrict: string;
  navlungoSenderPostCode: string;
  navlungoReturnRecipientAddressId: string;
  navlungoReturnRecipientName: string;
  navlungoReturnRecipientPhone: string;
  navlungoReturnRecipientEmail: string;
  navlungoReturnRecipientAddress: string;
  navlungoReturnRecipientCountry: string;
  navlungoReturnRecipientCity: string;
  navlungoReturnRecipientDistrict: string;
  navlungoReturnRecipientPostCode: string;
  navlungoBarcodeFormat: string;
  navlungoCarrierId: string;
};

type VendorShippingConfigEditorValues = {
  provider: ShippingConfigDraftProvider;
  tryOtoPickupLocationCode: string;
  tryOtoOriginCity: string;
  kargonomiShippingProviderId: string;
  kargonomiBuyerStateId: string;
  kargonomiBuyerCityId: string;
};

type VendorShippingConfigEditorRenderInput = {
  form: ReactNode;
  diagnostics: ShippingProviderDiagnostics;
  values: VendorShippingConfigEditorValues;
};

type VendorShippingConfigEditorProps = {
  vendorId: string;
  vendorName?: string | null;
  shippingConfig?: VendorShippingConfig | null;
  enabled?: boolean;
  onSaved?: (config: VendorShippingConfig) => void;
  onSynced?: (config: VendorShippingConfig) => void;
  renderContainer?: (input: VendorShippingConfigEditorRenderInput) => ReactNode;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function formatOptionalDate(value?: string | null, fallback = '—') {
  return value
    ? formatDateTime(value, {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : fallback;
}

function readPackageType(config?: VendorShippingConfig | null): 'box' | 'document' {
  const metadata = isRecord(config?.providerMetadata) ? config.providerMetadata : {};
  const raw = metadata.packageType ?? metadata.package_type;
  return raw === 'document' ? 'document' : 'box';
}

function readTryOtoPickupLocationCode(config?: VendorShippingConfig | null) {
  const metadata = isRecord(config?.providerMetadata) ? config.providerMetadata : {};
  const raw = metadata.tryOtoPickupLocationCode ?? metadata.pickupLocationCode ?? metadata.pickup_location_code;
  return typeof raw === 'string' ? raw : '';
}

function readTryOtoOriginCity(config?: VendorShippingConfig | null) {
  const metadata = isRecord(config?.providerMetadata) ? config.providerMetadata : {};
  const raw = metadata.tryOtoOriginCity ?? metadata.originCity ?? metadata.origin_city ?? metadata.pickupCity ?? metadata.pickup_city;
  return typeof raw === 'string' ? raw : '';
}

function readKargonomiBuyerStateId(config?: VendorShippingConfig | null) {
  const metadata = isRecord(config?.providerMetadata) ? config.providerMetadata : {};
  const raw = metadata.kargonomiBuyerStateId ?? metadata.buyerStateId ?? metadata.buyer_state_id;
  return typeof raw === 'string' ? raw : '';
}

function readKargonomiShippingProviderId(config?: VendorShippingConfig | null) {
  const metadata = isRecord(config?.providerMetadata) ? config.providerMetadata : {};
  const raw =
    metadata.kargonomiShippingProviderId ??
    metadata.kargonomi_shipping_provider_id ??
    metadata.shippingProviderId ??
    metadata.shipping_provider_id;
  return typeof raw === 'string' ? raw : typeof raw === 'number' && Number.isFinite(raw) ? String(raw) : '';
}

function readKargonomiBuyerCityId(config?: VendorShippingConfig | null) {
  const metadata = isRecord(config?.providerMetadata) ? config.providerMetadata : {};
  const raw = metadata.kargonomiBuyerCityId ?? metadata.buyerCityId ?? metadata.buyer_city_id;
  return typeof raw === 'string' ? raw : '';
}

function getKargonomiDefaultWarehouse(config?: VendorShippingConfig | null) {
  const warehouses = config?.warehouses ?? [];
  return (
    warehouses.find((warehouse) => warehouse.provider === 'kargonomi' && warehouse.warehouseId === config?.defaultWarehouseId) ??
    warehouses.find((warehouse) => warehouse.provider === 'kargonomi' && warehouse.isDefault) ??
    warehouses.find((warehouse) => warehouse.provider === 'kargonomi') ??
    null
  );
}

function readKargonomiReturnReceiverField(config: VendorShippingConfig | null | undefined, keys: string[], fallback?: string | null) {
  const metadata = isRecord(config?.providerMetadata) ? config.providerMetadata : {};
  for (const key of keys) {
    const raw = metadata[key];
    if (typeof raw === 'string' && raw.trim()) {
      return raw;
    }
  }
  return fallback ?? '';
}

function readNavlungoSenderAddressId(config?: VendorShippingConfig | null) {
  const metadata = isRecord(config?.providerMetadata) ? config.providerMetadata : {};
  const raw =
    metadata.navlungoSenderAddressId ??
    metadata.senderAddressId ??
    metadata.sender_address_id ??
    (config?.preferredProvider === 'navlungo' ? config.defaultWarehouseId : null);
  return typeof raw === 'string' ? raw : '';
}

function readNavlungoReturnRecipientAddressId(config?: VendorShippingConfig | null) {
  const metadata = isRecord(config?.providerMetadata) ? config.providerMetadata : {};
  const raw =
    metadata.navlungoReturnRecipientAddressId ??
    metadata.returnRecipientAddressId ??
    metadata.return_recipient_address_id ??
    metadata.navlungoReturnAddressId ??
    metadata.returnAddressId;
  return typeof raw === 'string' ? raw : '';
}

function readNavlungoBarcodeFormat(config?: VendorShippingConfig | null) {
  const metadata = isRecord(config?.providerMetadata) ? config.providerMetadata : {};
  const raw = metadata.navlungoBarcodeFormat ?? metadata.barcodeFormat ?? metadata.barcode_format;
  return typeof raw === 'string' && raw.trim() ? raw : 'pdf-A6';
}

function readNavlungoCarrierId(config?: VendorShippingConfig | null) {
  const metadata = isRecord(config?.providerMetadata) ? config.providerMetadata : {};
  const raw = metadata.navlungoCarrierId ?? metadata.carrierId ?? metadata.carrier_id;
  return typeof raw === 'string' ? raw : '9';
}

function readNavlungoSenderField(config: VendorShippingConfig | null | undefined, keys: string[], fallback?: string | null) {
  const metadata = isRecord(config?.providerMetadata) ? config.providerMetadata : {};
  for (const key of keys) {
    const raw = metadata[key];
    if (typeof raw === 'string') {
      return raw;
    }
  }
  return fallback ?? '';
}

function readNavlungoReturnRecipientField(config: VendorShippingConfig | null | undefined, keys: string[], fallback?: string | null) {
  const metadata = isRecord(config?.providerMetadata) ? config.providerMetadata : {};
  for (const key of keys) {
    const raw = metadata[key];
    if (typeof raw === 'string') {
      return raw;
    }
  }
  return fallback ?? '';
}

function buildShippingConfigDraft(config?: VendorShippingConfig | null): ShippingConfigDraft {
  const preferredProvider: ShippingConfigDraftProvider = 'kargonomi';

  return {
    preferredProvider,
    cargoIntegrationId: config?.cargoIntegrationId ?? '',
    defaultWarehouseId: config?.defaultWarehouseId ?? config?.warehouses.find((warehouse) => warehouse.isDefault)?.warehouseId ?? '',
    defaultDesi: config?.defaultDesi ?? '3.00',
    packageType: readPackageType(config),
    tryOtoPickupLocationCode: readTryOtoPickupLocationCode(config),
    tryOtoOriginCity: readTryOtoOriginCity(config),
    kargonomiShippingProviderId: readKargonomiShippingProviderId(config),
    kargonomiBuyerStateId: readKargonomiBuyerStateId(config),
    kargonomiBuyerCityId: readKargonomiBuyerCityId(config),
    kargonomiReturnReceiverName: readKargonomiReturnReceiverField(
      config,
      ['kargonomiReturnReceiverName', 'returnReceiverName'],
      config?.warehouses.find((warehouse) => warehouse.isDefault)?.name ?? config?.warehouses[0]?.name,
    ),
    kargonomiReturnReceiverPhone: readKargonomiReturnReceiverField(config, [
      'kargonomiReturnReceiverPhone',
      'returnReceiverPhone',
      'receiverPhone',
      'warehousePhone',
      'phone',
    ]),
    kargonomiReturnReceiverAddress: readKargonomiReturnReceiverField(
      config,
      ['kargonomiReturnReceiverAddress', 'returnReceiverAddress', 'warehouseAddress'],
      config?.warehouses.find((warehouse) => warehouse.isDefault)?.address ?? config?.warehouses[0]?.address,
    ),
    navlungoSenderAddressId: readNavlungoSenderAddressId(config) || '55574',
    navlungoSenderName: readNavlungoSenderField(
      config,
      ['navlungoSenderName', 'senderName', 'sender_name'],
      config?.warehouses.find((warehouse) => warehouse.isDefault)?.name ?? config?.warehouses[0]?.name,
    ),
    navlungoSenderPhone: readNavlungoSenderField(config, ['navlungoSenderPhone', 'senderPhone', 'sender_phone']),
    navlungoSenderEmail: readNavlungoSenderField(config, ['navlungoSenderEmail', 'senderEmail', 'sender_email']),
    navlungoSenderAddress: readNavlungoSenderField(
      config,
      ['navlungoSenderAddress', 'senderAddress', 'sender_address'],
      config?.warehouses.find((warehouse) => warehouse.isDefault)?.address ?? config?.warehouses[0]?.address,
    ),
    navlungoSenderCountry: readNavlungoSenderField(config, ['navlungoSenderCountry', 'senderCountry', 'sender_country'], 'tr'),
    navlungoSenderCity: readNavlungoSenderField(config, ['navlungoSenderCity', 'senderCity', 'sender_city']),
    navlungoSenderDistrict: readNavlungoSenderField(config, ['navlungoSenderDistrict', 'senderDistrict', 'sender_district']),
    navlungoSenderPostCode: readNavlungoSenderField(config, ['navlungoSenderPostCode', 'senderPostCode', 'sender_post_code']),
    navlungoReturnRecipientAddressId: readNavlungoReturnRecipientAddressId(config),
    navlungoReturnRecipientName: readNavlungoReturnRecipientField(config, ['navlungoReturnRecipientName', 'returnRecipientName', 'return_recipient_name']),
    navlungoReturnRecipientPhone: readNavlungoReturnRecipientField(config, ['navlungoReturnRecipientPhone', 'returnRecipientPhone', 'return_recipient_phone']),
    navlungoReturnRecipientEmail: readNavlungoReturnRecipientField(config, ['navlungoReturnRecipientEmail', 'returnRecipientEmail', 'return_recipient_email']),
    navlungoReturnRecipientAddress: readNavlungoReturnRecipientField(config, ['navlungoReturnRecipientAddress', 'returnRecipientAddress', 'return_recipient_address']),
    navlungoReturnRecipientCountry: readNavlungoReturnRecipientField(config, ['navlungoReturnRecipientCountry', 'returnRecipientCountry', 'return_recipient_country'], 'tr'),
    navlungoReturnRecipientCity: readNavlungoReturnRecipientField(config, ['navlungoReturnRecipientCity', 'returnRecipientCity', 'return_recipient_city']),
    navlungoReturnRecipientDistrict: readNavlungoReturnRecipientField(config, ['navlungoReturnRecipientDistrict', 'returnRecipientDistrict', 'return_recipient_district']),
    navlungoReturnRecipientPostCode: readNavlungoReturnRecipientField(config, ['navlungoReturnRecipientPostCode', 'returnRecipientPostCode', 'return_recipient_post_code']),
    navlungoBarcodeFormat: readNavlungoBarcodeFormat(config),
    navlungoCarrierId: readNavlungoCarrierId(config),
  };
}

function validateShippingConfigDraft(draft: ShippingConfigDraft) {
  const errors: string[] = [];

  if (!draft.preferredProvider) {
    errors.push('Provider is required.');
  }
  if (
    draft.preferredProvider === 'navlungo' &&
    draft.navlungoSenderAddressId.trim() &&
    !/^\d+$/.test(draft.navlungoSenderAddressId.trim())
  ) {
    errors.push('Navlungo sender address ID must be numeric.');
  }
  if (
    draft.preferredProvider === 'navlungo' &&
    draft.navlungoReturnRecipientAddressId.trim() &&
    !/^\d+$/.test(draft.navlungoReturnRecipientAddressId.trim())
  ) {
    errors.push('Navlungo return recipient address ID must be numeric.');
  }
  if (draft.preferredProvider === 'navlungo' && !/^\d+$/.test(draft.navlungoCarrierId.trim())) {
    errors.push('Navlungo carrier ID must be numeric.');
  }
  if (draft.preferredProvider === 'navlungo') {
    [
      ['sender address ID', draft.navlungoSenderAddressId],
    ].forEach(([label, value]) => {
      if (!String(value).trim()) {
        errors.push(`Navlungo ${label} is required.`);
      }
    });
  }
  if (draft.preferredProvider === 'try_oto' && !draft.tryOtoPickupLocationCode.trim()) {
    errors.push('Try OTO pickup location code is required.');
  }
  if (draft.preferredProvider === 'try_oto' && !draft.tryOtoOriginCity.trim()) {
    errors.push('Try OTO origin city is required.');
  }
  if (draft.preferredProvider === 'kargonomi' && !/^\d+$/.test(draft.defaultWarehouseId.trim())) {
    errors.push('Kargonomi warehouse ID must be numeric.');
  }
  if (
    draft.preferredProvider === 'kargonomi' &&
    draft.kargonomiShippingProviderId.trim() &&
    !/^-?\d+$/.test(draft.kargonomiShippingProviderId.trim())
  ) {
    errors.push('Kargonomi carrier/provider ID must be numeric, or -1 for automatic selection.');
  }
  if (
    draft.preferredProvider === 'kargonomi' &&
    draft.kargonomiBuyerStateId.trim() &&
    !/^\d+$/.test(draft.kargonomiBuyerStateId.trim())
  ) {
    errors.push('Fallback Kargonomi buyer state ID must be numeric.');
  }
  if (
    draft.preferredProvider === 'kargonomi' &&
    draft.kargonomiBuyerCityId.trim() &&
    !/^\d+$/.test(draft.kargonomiBuyerCityId.trim())
  ) {
    errors.push('Fallback Kargonomi buyer city ID must be numeric.');
  }
  const defaultDesi = Number(draft.defaultDesi);
  if (!Number.isFinite(defaultDesi) || defaultDesi <= 0) {
    errors.push('Default desi must be greater than zero.');
  }

  return errors;
}

function buildShippingConfigUpdate(
  draft: ShippingConfigDraft,
  currentConfig?: VendorShippingConfig | null,
): VendorShippingConfigUpdate {
  const metadata = isRecord(currentConfig?.providerMetadata) ? currentConfig.providerMetadata : {};
  const existingDefaultWarehouse = currentConfig?.warehouses.find((warehouse) => warehouse.isDefault)
    ?? currentConfig?.warehouses[0];
  const baseUpdate = {
    preferredProvider: draft.preferredProvider,
    shippingEnabled: currentConfig?.shippingEnabled ?? true,
    defaultDesi: Number(draft.defaultDesi),
    shippingVatPercent: Number(currentConfig?.shippingVatPercent ?? 18),
  };

  if (draft.preferredProvider === 'try_oto') {
    return {
      ...baseUpdate,
      cargoIntegrationId: null,
      defaultWarehouseId: null,
      providerMetadata: {
        ...metadata,
        tryOtoPickupLocationCode: draft.tryOtoPickupLocationCode.trim(),
        tryOtoOriginCity: draft.tryOtoOriginCity.trim(),
      },
      warehouses: [],
    };
  }

  if (draft.preferredProvider === 'kargonomi') {
    const selectedWarehouseId = draft.defaultWarehouseId.trim();
    const selectedWarehouse =
      currentConfig?.warehouses.find(
        (warehouse) => warehouse.provider === 'kargonomi' && warehouse.warehouseId === selectedWarehouseId,
      ) ?? existingDefaultWarehouse;
    const providerMetadata = { ...metadata };
    delete providerMetadata.kargonomiBuyerStateId;
    delete providerMetadata.kargonomiBuyerCityId;
    delete providerMetadata.buyerStateId;
    delete providerMetadata.buyerCityId;
    delete providerMetadata.buyer_state_id;
    delete providerMetadata.buyer_city_id;
    delete providerMetadata.kargonomiShippingProviderId;
    delete providerMetadata.kargonomi_shipping_provider_id;
    delete providerMetadata.shippingProviderId;
    delete providerMetadata.shipping_provider_id;
    delete providerMetadata.kargonomiReturnReceiverName;
    delete providerMetadata.kargonomiReturnReceiverPhone;
    delete providerMetadata.kargonomiReturnReceiverAddress;
    const kargonomiShippingProviderId = draft.kargonomiShippingProviderId.trim();
    const fallbackBuyerStateId = draft.kargonomiBuyerStateId.trim();
    const fallbackBuyerCityId = draft.kargonomiBuyerCityId.trim();
    const returnReceiverName = draft.kargonomiReturnReceiverName.trim();
    const returnReceiverPhone = draft.kargonomiReturnReceiverPhone.trim();
    const returnReceiverAddress = draft.kargonomiReturnReceiverAddress.trim();
    if (kargonomiShippingProviderId) {
      providerMetadata.kargonomiShippingProviderId = kargonomiShippingProviderId;
    }
    if (fallbackBuyerStateId) {
      providerMetadata.kargonomiBuyerStateId = fallbackBuyerStateId;
    }
    if (fallbackBuyerCityId) {
      providerMetadata.kargonomiBuyerCityId = fallbackBuyerCityId;
    }
    if (returnReceiverName) {
      providerMetadata.kargonomiReturnReceiverName = returnReceiverName;
    }
    if (returnReceiverPhone) {
      providerMetadata.kargonomiReturnReceiverPhone = returnReceiverPhone;
    }
    if (returnReceiverAddress) {
      providerMetadata.kargonomiReturnReceiverAddress = returnReceiverAddress;
    }

    return {
      ...baseUpdate,
      cargoIntegrationId: null,
      defaultWarehouseId: selectedWarehouseId,
      providerMetadata,
      warehouses: [
        {
          warehouseId: selectedWarehouseId,
          name: selectedWarehouse?.name ?? 'Default warehouse',
          address: selectedWarehouse?.address ?? null,
          isDefault: true,
          provider: 'kargonomi',
        },
      ],
    };
  }

  if (draft.preferredProvider === 'navlungo') {
    const providerMetadata = { ...metadata };
    const senderAddressId = draft.navlungoSenderAddressId.trim();
    const returnRecipientAddressId = draft.navlungoReturnRecipientAddressId.trim();
    providerMetadata.navlungoSenderAddressId = senderAddressId;
    providerMetadata.navlungoReturnRecipientAddressId = returnRecipientAddressId;
    providerMetadata.navlungoSenderName = draft.navlungoSenderName.trim();
    providerMetadata.navlungoSenderPhone = draft.navlungoSenderPhone.trim();
    providerMetadata.navlungoSenderEmail = draft.navlungoSenderEmail.trim();
    providerMetadata.navlungoSenderAddress = draft.navlungoSenderAddress.trim();
    providerMetadata.navlungoSenderCountry = draft.navlungoSenderCountry.trim();
    providerMetadata.navlungoSenderCity = draft.navlungoSenderCity.trim();
    providerMetadata.navlungoSenderDistrict = draft.navlungoSenderDistrict.trim();
    providerMetadata.navlungoSenderPostCode = draft.navlungoSenderPostCode.trim();
    providerMetadata.navlungoReturnRecipientName = draft.navlungoReturnRecipientName.trim();
    providerMetadata.navlungoReturnRecipientPhone = draft.navlungoReturnRecipientPhone.trim();
    providerMetadata.navlungoReturnRecipientEmail = draft.navlungoReturnRecipientEmail.trim();
    providerMetadata.navlungoReturnRecipientAddress = draft.navlungoReturnRecipientAddress.trim();
    providerMetadata.navlungoReturnRecipientCountry = draft.navlungoReturnRecipientCountry.trim();
    providerMetadata.navlungoReturnRecipientCity = draft.navlungoReturnRecipientCity.trim();
    providerMetadata.navlungoReturnRecipientDistrict = draft.navlungoReturnRecipientDistrict.trim();
    providerMetadata.navlungoReturnRecipientPostCode = draft.navlungoReturnRecipientPostCode.trim();
    providerMetadata.navlungoBarcodeFormat = draft.navlungoBarcodeFormat.trim() || 'pdf-A6';
    providerMetadata.navlungoCarrierId = draft.navlungoCarrierId.trim() || '9';

    return {
      ...baseUpdate,
      cargoIntegrationId: null,
      defaultWarehouseId: senderAddressId || null,
      providerMetadata,
      warehouses: senderAddressId
        ? [
            {
              warehouseId: senderAddressId,
              name: existingDefaultWarehouse?.name || 'Navlungo sender address',
              address: existingDefaultWarehouse?.address || null,
              isDefault: true,
              provider: 'navlungo',
            },
          ]
        : [],
    };
  }

  return {
    ...baseUpdate,
    cargoIntegrationId: draft.cargoIntegrationId.trim(),
    defaultWarehouseId: draft.defaultWarehouseId.trim(),
    providerMetadata: {
      ...metadata,
      packageType: draft.packageType,
    },
    warehouses: [
      {
        warehouseId: draft.defaultWarehouseId.trim(),
        name: existingDefaultWarehouse?.name ?? 'Default warehouse',
        address: existingDefaultWarehouse?.address ?? null,
        isDefault: true,
        provider: draft.preferredProvider,
      },
    ],
  };
}

export function VendorShippingConfigEditor({
  vendorId,
  vendorName,
  shippingConfig,
  enabled = true,
  onSaved,
  onSynced,
  renderContainer,
}: VendorShippingConfigEditorProps) {
  const queryClient = useQueryClient();
  const [shippingConfigDraft, setShippingConfigDraft] = useState<ShippingConfigDraft>(() => buildShippingConfigDraft(null));
  const [shippingConfigDraftReady, setShippingConfigDraftReady] = useState(false);
  const [shippingConfigFeedback, setShippingConfigFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    setShippingConfigDraftReady(false);
  }, [vendorId]);

  useEffect(() => {
    if (shippingConfig) {
      setShippingConfigDraft(buildShippingConfigDraft(shippingConfig));
      setShippingConfigDraftReady(true);
    }
  }, [shippingConfig]);

  const diagnosticsProvider = shippingConfigDraft.preferredProvider;
  const { data: shippingProviderDiagnostics, refetch: refetchShippingProviderDiagnostics } = useQueryResource(
    queryKeys.admin.shipments.providerConfig(diagnosticsProvider, vendorId),
    ({ signal }) => getShippingProviderDiagnostics({ vendorId, provider: diagnosticsProvider, signal }),
    {
      enabled: enabled && Boolean(vendorId) && shippingConfigDraftReady,
    },
  );

  const { mutateAsync: updateShippingConfigMutation, isPending: isSavingShippingConfig } = useMutationAction(
    async (payload: VendorShippingConfigUpdate) => updateVendorShippingConfig(vendorId, payload),
    {
      invalidateQueryKeys: [
        queryKeys.admin.shipments.vendorShippingConfig(vendorId),
        queryKeys.vendorProfile.shippingConfig(vendorId),
        queryKeys.admin.shipments.providerConfig(diagnosticsProvider, vendorId),
      ],
      onSuccess: (savedConfig, submittedConfig) => {
        queryClient.setQueryData(queryKeys.admin.shipments.vendorShippingConfig(vendorId), savedConfig);
        queryClient.setQueryData(queryKeys.vendorProfile.shippingConfig(vendorId), savedConfig);
        if (!submittedConfig.preferredProvider || savedConfig.preferredProvider === submittedConfig.preferredProvider) {
          setShippingConfigDraft(buildShippingConfigDraft(savedConfig));
        }
        setShippingConfigFeedback({ tone: 'success', message: 'Shipping provider configuration saved.' });
        onSaved?.(savedConfig);
        void refetchShippingProviderDiagnostics();
      },
      onError: (error) => {
        const message = error instanceof Error ? error.message : 'Shipping provider configuration could not be saved.';
        setShippingConfigFeedback({ tone: 'error', message });
      },
    },
  );

  const { mutateAsync: syncKargonomiWarehouseMutation, isPending: isSyncingKargonomiWarehouse } = useMutationAction(
    async (warehouseId: string) => syncKargonomiWarehouseDetails(vendorId, warehouseId),
    {
      invalidateQueryKeys: [
        queryKeys.admin.shipments.vendorShippingConfig(vendorId),
        queryKeys.vendorProfile.shippingConfig(vendorId),
        queryKeys.admin.shipments.providerConfig(diagnosticsProvider, vendorId),
      ],
      onSuccess: (result) => {
        queryClient.setQueryData(queryKeys.admin.shipments.vendorShippingConfig(vendorId), result.syncedConfig);
        queryClient.setQueryData(queryKeys.vendorProfile.shippingConfig(vendorId), result.syncedConfig);
        setShippingConfigDraft(buildShippingConfigDraft(result.syncedConfig));
        setShippingConfigFeedback({ tone: 'success', message: 'Kargonomi warehouse details synced.' });
        onSynced?.(result.syncedConfig);
      },
      onError: (error) => {
        const message = error instanceof Error ? error.message : 'Kargonomi warehouse details could not be synced.';
        setShippingConfigFeedback({ tone: 'error', message });
      },
    },
  );

  if (!enabled || !shippingProviderDiagnostics) {
    return null;
  }

  const handleSaveShippingConfig = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const validationErrors = validateShippingConfigDraft(shippingConfigDraft);
    if (validationErrors.length) {
      setShippingConfigFeedback({ tone: 'error', message: validationErrors.join(' ') });
      return;
    }

    void updateShippingConfigMutation(buildShippingConfigUpdate(shippingConfigDraft, shippingConfig)).catch(() => undefined);
  };

  const isTryOtoConfigDraft = shippingConfigDraft.preferredProvider === 'try_oto';
  const isKargonomiConfigDraft = shippingConfigDraft.preferredProvider === 'kargonomi';
  const isNavlungoConfigDraft = shippingConfigDraft.preferredProvider === 'navlungo';
  const kargonomiDefaultWarehouse = getKargonomiDefaultWarehouse(shippingConfig);
  const kargonomiWarehouseSyncStatus = kargonomiDefaultWarehouse?.syncStatus;
  const kargonomiWarehouseIdForSync = kargonomiDefaultWarehouse?.warehouseId ?? '';
  const canSyncKargonomiWarehouse = isKargonomiConfigDraft && /^\d+$/.test(kargonomiWarehouseIdForSync);
  const kargonomiWarehouseReadinessItems = [
    { label: 'Contact name', present: kargonomiWarehouseSyncStatus?.contactNamePresent },
    { label: 'Phone', present: kargonomiWarehouseSyncStatus?.phonePresent },
    { label: 'Address', present: kargonomiWarehouseSyncStatus?.addressPresent },
    { label: 'State ID', present: kargonomiWarehouseSyncStatus?.stateIdPresent },
    { label: 'City ID', present: kargonomiWarehouseSyncStatus?.cityIdPresent },
  ];
  const missingKargonomiWarehouseItems = kargonomiWarehouseReadinessItems.filter((item) => !item.present);
  const kargonomiWarehouseSyncLabel = !kargonomiWarehouseSyncStatus
    ? 'Unknown'
    : kargonomiWarehouseSyncStatus.lookupError || missingKargonomiWarehouseItems.length > 0
      ? 'Needs review'
      : 'Ready';
  const kargonomiWarehouseSyncDescription =
    kargonomiWarehouseSyncLabel === 'Ready'
      ? 'Warehouse synchronization is ready.'
      : kargonomiWarehouseSyncLabel === 'Needs review'
        ? 'Warehouse synchronization needs review before return receiver data is trusted.'
        : 'Warehouse synchronization has not been confirmed.';
  const shippingProviderSelectField = (
    <label className="field">
      <span>Provider</span>
      <select
        value={shippingConfigDraft.preferredProvider}
        onChange={(event) => {
          const preferredProvider = event.target.value as ShippingConfigDraftProvider;
          setShippingConfigDraft((current) => ({
            ...current,
            preferredProvider,
          }));
          setShippingConfigDraftReady(true);
        }}
      >
        <option value="kargonomi">Kargonomi</option>
      </select>
    </label>
  );
  const shippingDefaultDesiField = (
    <label className="field">
      <span>Default desi</span>
      <input
        type="number"
        min="0.1"
        step="0.1"
        value={shippingConfigDraft.defaultDesi}
        onChange={(event) =>
          setShippingConfigDraft((current) => ({
            ...current,
            defaultDesi: event.target.value,
          }))
        }
      />
    </label>
  );

  const form = (
    <form
      className="shipping-config-editor"
      aria-label="Shipping provider configuration editor"
      noValidate
      onSubmit={handleSaveShippingConfig}
    >
      <div className="shipping-config-editor-heading">
        <div>
          <strong>Edit Shipping Configuration</strong>
          <span>Update provider, warehouse, carrier, and fallback return receiver settings.</span>
        </div>
        <span>
          Last updated: {shippingConfig?.updatedAt ? formatOptionalDate(shippingConfig.updatedAt) : 'not configured'}
        </span>
      </div>
      <div className="shipping-config-editor-grid">
        {!isKargonomiConfigDraft ? shippingProviderSelectField : null}
        {isKargonomiConfigDraft ? (
          <>
            {isKargonomiConfigDraft ? (
              <div className="shipping-config-kargonomi-layout field-full" aria-label="Kargonomi shipping configuration">
                <section className="shipping-config-section-card" aria-label="Provider basics">
                  <div className="shipping-config-section-heading">
                    <strong>Provider basics</strong>
                    <span>Core provider, warehouse, carrier, and package defaults.</span>
                  </div>
                  <div className="shipping-config-section-grid">
                    {shippingProviderSelectField}
                    <label className="field">
                      <span>Warehouse ID</span>
                      <input
                        aria-label="Warehouse ID"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={shippingConfigDraft.defaultWarehouseId}
                        onChange={(event) =>
                          setShippingConfigDraft((current) => ({
                            ...current,
                            defaultWarehouseId: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <label className="field">
                      <span>Kargonomi carrier/provider ID</span>
                      <input
                        inputMode="numeric"
                        pattern="-?[0-9]*"
                        value={shippingConfigDraft.kargonomiShippingProviderId}
                        onChange={(event) =>
                          setShippingConfigDraft((current) => ({
                            ...current,
                            kargonomiShippingProviderId: event.target.value,
                          }))
                        }
                      />
                      <small>
                        -1 means automatic cheapest provider selection. Use a specific Kargonomi carrier ID from price comparison to force a carrier.
                      </small>
                    </label>
                    {shippingDefaultDesiField}
                    <label className="field">
                      <span>Fallback Kargonomi buyer state ID (PoC override)</span>
                      <input
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={shippingConfigDraft.kargonomiBuyerStateId}
                        onChange={(event) =>
                          setShippingConfigDraft((current) => ({
                            ...current,
                            kargonomiBuyerStateId: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <label className="field">
                      <span>Fallback Kargonomi buyer city ID (PoC override)</span>
                      <input
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={shippingConfigDraft.kargonomiBuyerCityId}
                        onChange={(event) =>
                          setShippingConfigDraft((current) => ({
                            ...current,
                            kargonomiBuyerCityId: event.target.value,
                          }))
                        }
                      />
                    </label>
                  </div>
                </section>

                <section className="shipping-config-section-card shipping-config-sync-panel" aria-label="Warehouse synchronization">
                  <div className="shipping-config-sync-heading">
                    <div>
                      <strong>Warehouse synchronization</strong>
                      <span>{kargonomiWarehouseSyncDescription}</span>
                    </div>
                    <span
                      className={`shipping-config-state-pill ${
                        kargonomiWarehouseSyncLabel === 'Ready'
                          ? 'ready'
                          : kargonomiWarehouseSyncLabel === 'Needs review'
                            ? 'review'
                            : 'unknown'
                      }`}
                    >
                      {kargonomiWarehouseSyncLabel}
                    </span>
                  </div>
                  {missingKargonomiWarehouseItems.length > 0 ? (
                    <div className="shipping-config-sync-grid" aria-label="Missing Kargonomi warehouse fields">
                      {missingKargonomiWarehouseItems.map((item) => (
                        <span key={item.label} className={`shipping-config-status-chip ${item.present ? 'present' : 'missing'}`}>
                          {item.label} {item.present ? 'present' : 'missing'}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {kargonomiWarehouseSyncStatus?.lookupError ? (
                    <small className="shipping-config-note">{kargonomiWarehouseSyncStatus.lookupError}</small>
                  ) : null}
                  <div className="shipping-config-sync-actions">
                    <button
                      type="button"
                      className="button button-secondary"
                      disabled={!canSyncKargonomiWarehouse || isSyncingKargonomiWarehouse}
                      onClick={() => void syncKargonomiWarehouseMutation(kargonomiWarehouseIdForSync).catch(() => undefined)}
                    >
                      {isSyncingKargonomiWarehouse ? 'Syncing...' : 'Sync Kargonomi warehouse details'}
                    </button>
                  </div>
                  <details className="shipping-config-advanced">
                    <summary>Warehouse sync details</summary>
                    {kargonomiWarehouseSyncLabel === 'Ready' ? (
                      <div className="shipping-config-sync-grid" aria-label="Kargonomi warehouse readiness">
                        {kargonomiWarehouseReadinessItems.map((item) => (
                          <span key={item.label} className={`shipping-config-status-chip ${item.present ? 'present' : 'missing'}`}>
                            {item.label} {item.present ? 'present' : 'missing'}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    <div className="shipping-config-section-grid">
                      <div className="shipping-config-readonly">
                        <span>Last sync</span>
                        <strong>
                          {kargonomiWarehouseSyncStatus?.syncedAt
                            ? formatOptionalDate(kargonomiWarehouseSyncStatus.syncedAt)
                            : kargonomiWarehouseSyncStatus?.lookupStatus ?? 'not synced'}
                        </strong>
                      </div>
                      <div className="shipping-config-readonly">
                        <span>Resolved location</span>
                        <strong>
                          {[kargonomiWarehouseSyncStatus?.stateName, kargonomiWarehouseSyncStatus?.cityName]
                            .filter(Boolean)
                            .join(' / ') || '—'}
                        </strong>
                      </div>
                    </div>
                  </details>
                </section>

                <section className="shipping-config-section-card" aria-label="Return receiver override fallback">
                  <div className="shipping-config-section-heading">
                    <strong>Return receiver override / fallback</strong>
                    <span>Only used when synced warehouse data is missing or intentionally overridden.</span>
                  </div>
                  <div className="shipping-config-section-grid">
                    <label className="field">
                      <span>Return receiver fallback name</span>
                      <input
                        aria-label="Return receiver fallback name"
                        value={shippingConfigDraft.kargonomiReturnReceiverName}
                        onChange={(event) =>
                          setShippingConfigDraft((current) => ({
                            ...current,
                            kargonomiReturnReceiverName: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <label className="field">
                      <span>Return receiver fallback phone</span>
                      <input
                        aria-label="Return receiver fallback phone"
                        value={shippingConfigDraft.kargonomiReturnReceiverPhone}
                        onChange={(event) =>
                          setShippingConfigDraft((current) => ({
                            ...current,
                            kargonomiReturnReceiverPhone: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <label className="field field-full">
                      <span>Return receiver fallback address</span>
                      <textarea
                        aria-label="Return receiver fallback address"
                        rows={3}
                        value={shippingConfigDraft.kargonomiReturnReceiverAddress}
                        onChange={(event) =>
                          setShippingConfigDraft((current) => ({
                            ...current,
                            kargonomiReturnReceiverAddress: event.target.value,
                          }))
                        }
                      />
                    </label>
                  </div>
                  {kargonomiWarehouseSyncStatus?.stateName || kargonomiWarehouseSyncStatus?.cityName ? (
                    <p className="shipping-config-note">
                      Synced warehouse location is available; fallback receiver fields are optional.
                    </p>
                  ) : null}
                </section>
                <details className="shipping-config-advanced shipping-config-diagnostics" aria-label="Shipping diagnostics">
                  <summary>Diagnostics</summary>
                  <p>Provider probes and technical flags for investigation.</p>
                  <div className="shipping-config-section-grid">
                    <div className="shipping-config-readonly">
                      <span>Sandbox</span>
                      <strong>{shippingProviderDiagnostics.sandboxModeEnabled ? 'enabled' : 'disabled'}</strong>
                    </div>
                    <div className="shipping-config-readonly">
                      <span>Webhook ingest</span>
                      <strong>{shippingProviderDiagnostics.webhookIngestEnabled ? 'enabled' : 'disabled'}</strong>
                    </div>
                  </div>
                </details>
              </div>
            ) : null}
          </>
        ) : null}
        {isTryOtoConfigDraft ? (
          <>
            <label className="field">
              <span>Try OTO pickup location code</span>
              <input
                value={shippingConfigDraft.tryOtoPickupLocationCode}
                onChange={(event) =>
                  setShippingConfigDraft((current) => ({
                    ...current,
                    tryOtoPickupLocationCode: event.target.value,
                  }))
                }
              />
            </label>
            <label className="field">
              <span>Try OTO origin city</span>
              <input
                value={shippingConfigDraft.tryOtoOriginCity}
                onChange={(event) =>
                  setShippingConfigDraft((current) => ({
                    ...current,
                    tryOtoOriginCity: event.target.value,
                  }))
                }
              />
            </label>
          </>
        ) : null}
        {isNavlungoConfigDraft ? (
          <>
            <label className="field">
              <span>Navlungo sender address ID</span>
              <input
                inputMode="numeric"
                value={shippingConfigDraft.navlungoSenderAddressId}
                onChange={(event) =>
                  setShippingConfigDraft((current) => ({
                    ...current,
                    navlungoSenderAddressId: event.target.value,
                  }))
                }
              />
            </label>
            <label className="field">
              <span>Navlungo return recipient address ID</span>
              <input
                inputMode="numeric"
                value={shippingConfigDraft.navlungoReturnRecipientAddressId}
                onChange={(event) =>
                  setShippingConfigDraft((current) => ({
                    ...current,
                    navlungoReturnRecipientAddressId: event.target.value,
                  }))
                }
              />
            </label>
            <details className="shipping-config-advanced">
              <summary>Return recipient address book details</summary>
              <p>Optional metadata for the return warehouse/address book entry. Return pickup still sends only recipient.addressId.</p>
              <label className="field">
                <span>Return recipient name</span>
                <input
                  value={shippingConfigDraft.navlungoReturnRecipientName}
                  onChange={(event) =>
                    setShippingConfigDraft((current) => ({
                      ...current,
                      navlungoReturnRecipientName: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="field">
                <span>Return recipient phone</span>
                <input
                  value={shippingConfigDraft.navlungoReturnRecipientPhone}
                  onChange={(event) =>
                    setShippingConfigDraft((current) => ({
                      ...current,
                      navlungoReturnRecipientPhone: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="field">
                <span>Return recipient email</span>
                <input
                  value={shippingConfigDraft.navlungoReturnRecipientEmail}
                  onChange={(event) =>
                    setShippingConfigDraft((current) => ({
                      ...current,
                      navlungoReturnRecipientEmail: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="field">
                <span>Return recipient address</span>
                <input
                  value={shippingConfigDraft.navlungoReturnRecipientAddress}
                  onChange={(event) =>
                    setShippingConfigDraft((current) => ({
                      ...current,
                      navlungoReturnRecipientAddress: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="field">
                <span>Return recipient country</span>
                <input
                  value={shippingConfigDraft.navlungoReturnRecipientCountry}
                  onChange={(event) =>
                    setShippingConfigDraft((current) => ({
                      ...current,
                      navlungoReturnRecipientCountry: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="field">
                <span>Return recipient city</span>
                <input
                  value={shippingConfigDraft.navlungoReturnRecipientCity}
                  onChange={(event) =>
                    setShippingConfigDraft((current) => ({
                      ...current,
                      navlungoReturnRecipientCity: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="field">
                <span>Return recipient district</span>
                <input
                  value={shippingConfigDraft.navlungoReturnRecipientDistrict}
                  onChange={(event) =>
                    setShippingConfigDraft((current) => ({
                      ...current,
                      navlungoReturnRecipientDistrict: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="field">
                <span>Return recipient post code</span>
                <input
                  value={shippingConfigDraft.navlungoReturnRecipientPostCode}
                  onChange={(event) =>
                    setShippingConfigDraft((current) => ({
                      ...current,
                      navlungoReturnRecipientPostCode: event.target.value,
                    }))
                  }
                />
              </label>
            </details>
            <label className="field">
              <span>Default carrier ID</span>
              <input
                inputMode="numeric"
                pattern="[0-9]*"
                value={shippingConfigDraft.navlungoCarrierId}
                onChange={(event) =>
                  setShippingConfigDraft((current) => ({
                    ...current,
                    navlungoCarrierId: event.target.value,
                  }))
                }
              />
            </label>
            <label className="field">
              <span>Default barcode format</span>
              <select
                value={shippingConfigDraft.navlungoBarcodeFormat}
                onChange={(event) =>
                  setShippingConfigDraft((current) => ({
                    ...current,
                    navlungoBarcodeFormat: event.target.value,
                  }))
                }
              >
                <option value="pdf-A6">pdf-A6</option>
                <option value="pdf-A5">pdf-A5</option>
                <option value="pdf-A6Y">pdf-A6Y</option>
                <option value="pdf-A7">pdf-A7</option>
                <option value="html">html</option>
              </select>
            </label>
            <details className="shipping-config-advanced">
              <summary>Full sender details for diagnostics</summary>
              <p>Optional. Used only when an admin explicitly retries Navlungo with full sender details.</p>
              <label className="field">
                <span>Sender name</span>
                <input
                  value={shippingConfigDraft.navlungoSenderName}
                  onChange={(event) =>
                    setShippingConfigDraft((current) => ({
                      ...current,
                      navlungoSenderName: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="field">
                <span>Sender phone</span>
                <input
                  value={shippingConfigDraft.navlungoSenderPhone}
                  onChange={(event) =>
                    setShippingConfigDraft((current) => ({
                      ...current,
                      navlungoSenderPhone: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="field">
                <span>Sender email</span>
                <input
                  value={shippingConfigDraft.navlungoSenderEmail}
                  onChange={(event) =>
                    setShippingConfigDraft((current) => ({
                      ...current,
                      navlungoSenderEmail: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="field">
                <span>Sender address</span>
                <input
                  value={shippingConfigDraft.navlungoSenderAddress}
                  onChange={(event) =>
                    setShippingConfigDraft((current) => ({
                      ...current,
                      navlungoSenderAddress: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="field">
                <span>Sender country</span>
                <input
                  value={shippingConfigDraft.navlungoSenderCountry}
                  onChange={(event) =>
                    setShippingConfigDraft((current) => ({
                      ...current,
                      navlungoSenderCountry: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="field">
                <span>Sender city</span>
                <input
                  value={shippingConfigDraft.navlungoSenderCity}
                  onChange={(event) =>
                    setShippingConfigDraft((current) => ({
                      ...current,
                      navlungoSenderCity: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="field">
                <span>Sender district</span>
                <input
                  value={shippingConfigDraft.navlungoSenderDistrict}
                  onChange={(event) =>
                    setShippingConfigDraft((current) => ({
                      ...current,
                      navlungoSenderDistrict: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="field">
                <span>Sender post code</span>
                <input
                  value={shippingConfigDraft.navlungoSenderPostCode}
                  onChange={(event) =>
                    setShippingConfigDraft((current) => ({
                      ...current,
                      navlungoSenderPostCode: event.target.value,
                    }))
                  }
                />
              </label>
            </details>
            <div className="shipping-config-readonly">
              <span>Base URL configured</span>
              <strong>{shippingProviderDiagnostics?.baseUrlConfigured ? 'yes' : 'no'}</strong>
            </div>
            <div className="shipping-config-readonly">
              <span>Username configured</span>
              <strong>{shippingProviderDiagnostics?.navlungo?.usernameConfigured ? 'yes' : 'no'}</strong>
            </div>
            <div className="shipping-config-readonly">
              <span>Password configured</span>
              <strong>{shippingProviderDiagnostics?.navlungo?.passwordConfigured ? 'yes' : 'no'}</strong>
            </div>
            <div className="shipping-config-readonly">
              <span>Sender address configured</span>
              <strong>{shippingProviderDiagnostics?.navlungo?.defaultSenderAddressIdConfigured ? 'yes' : 'no'}</strong>
            </div>
            <div className="shipping-config-readonly">
              <span>Auth diagnostics available</span>
              <strong>{shippingProviderDiagnostics?.navlungo?.authDiagnosticsAvailable ? 'yes' : 'no'}</strong>
            </div>
            <div className="shipping-config-readonly">
              <span>Runtime shipment execution enabled</span>
              <strong>{shippingProviderDiagnostics?.navlungo?.runtimeShipmentExecutionEnabled ? 'yes' : 'no'}</strong>
            </div>
            <div className="shipping-config-readonly">
              <span>Return/reverse implementation</span>
              <strong>NOT IMPLEMENTED</strong>
            </div>
            <div className="shipping-config-readonly">
              <span>Create Post execution</span>
              <strong>{shippingProviderDiagnostics?.executionReady ? 'ready' : 'not ready'}</strong>
            </div>
          </>
        ) : null}
        {!isKargonomiConfigDraft ? shippingDefaultDesiField : null}
        {!isKargonomiConfigDraft ? (
          <>
            <div className="shipping-config-readonly">
              <span>Sandbox</span>
              <strong>{shippingProviderDiagnostics.sandboxModeEnabled ? 'enabled' : 'disabled'}</strong>
            </div>
            <div className="shipping-config-readonly">
              <span>Webhook ingest</span>
              <strong>{shippingProviderDiagnostics.webhookIngestEnabled ? 'enabled' : 'disabled'}</strong>
            </div>
          </>
        ) : null}
      </div>
      {shippingConfigFeedback ? (
        <div className={`shipping-config-feedback ${shippingConfigFeedback.tone}`}>
          {shippingConfigFeedback.message}
        </div>
      ) : null}
      <div className="shipping-config-actions">
        <button type="submit" className="button button-secondary" disabled={isSavingShippingConfig}>
          {isSavingShippingConfig ? 'Saving...' : 'Save shipping config'}
        </button>
      </div>
    </form>
  );

  const values: VendorShippingConfigEditorValues = {
    provider: shippingConfigDraft.preferredProvider,
    tryOtoPickupLocationCode: readTryOtoPickupLocationCode(shippingConfig),
    tryOtoOriginCity: readTryOtoOriginCity(shippingConfig),
    kargonomiShippingProviderId: readKargonomiShippingProviderId(shippingConfig),
    kargonomiBuyerStateId: readKargonomiBuyerStateId(shippingConfig),
    kargonomiBuyerCityId: readKargonomiBuyerCityId(shippingConfig),
  };

  return renderContainer ? renderContainer({ form, diagnostics: shippingProviderDiagnostics, values }) : form;
}
