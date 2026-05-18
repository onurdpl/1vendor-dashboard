import { Link, useLocation, useParams } from 'react-router-dom';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { DataStatePanel } from '../components/DataStatePanel';
import { ActionFeedback } from '../components/ActionFeedback';
import { queryKeys } from '../lib/api/queryKeys';
import { useQueryResource } from '../hooks/useQueryResource';
import {
  createShipmentExecution,
  getOrder,
  getShippingProviderDiagnostics,
  getVendorShippingConfig,
  refreshShipmentExecutionStatus,
  retryFailedShipmentExecution,
  retryShipmentExecution,
  submitFulfillmentTracking,
  updateVendorShippingConfig,
  type OrderDetail,
  type ShipmentCustomerField,
  type ShipmentCustomerOverrides,
  type ShipmentExecution,
  type ShippingProvider,
  type VendorShippingConfig,
  type VendorShippingConfigUpdate,
} from '../features/orders/api';
import { useActionFeedback } from '../lib/ui';
import { useMutationAction } from '../hooks/useMutationAction';
import { runtimeConfig } from '../config/runtime';
import { ApiError } from '../lib/api/errors';
import { formatShopifyOrderNumber } from '../lib/formatOrderDisplay';
import { formatCurrency, toTitleCaseLabel } from '../services/real/formatting';
import { SupportTicketModal } from '../components/SupportTicketModal';
import { useAppReadiness } from '../lib/appReadiness';
import { listReturns } from '../features/returns/api';
import { getFinanceDashboard } from '../features/finance/api';
import { listAdminSupportTickets, listVendorSupportTickets } from '../features/support/api';
import { OperationalLinkCards, OperationalTimeline } from '../components/OperationalTimeline';
import { OperationalRecommendations } from '../components/OperationalRecommendations';
import { AdminCollaborationNotes } from '../components/AdminCollaborationNotes';
import type { OperationsRecommendation } from '../lib/api/contracts';
import { getApiErrorDiagnostics, type ApiErrorDiagnostics } from '../lib/api/errors';
import {
  sameOperationalOrderNumber,
  supportTicketMatchesOrder,
  type OperationalEventInput,
  type OperationalLinkInput,
} from '../lib/operationalCrossLinks';
import { sameShopifyIdentifier } from '../lib/shopifyIdentifiers';

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function formatOptionalDate(value?: string, fallback = '—') {
  return value ? formatDate(value) : fallback;
}

function buildFinanceHref(record: { id: string }) {
  return `/finance?ledgerId=${encodeURIComponent(record.id)}`;
}

function getCompactCustomerLabel(value?: string) {
  const normalized = value?.trim();

  if (!normalized || normalized.toLowerCase().includes('outside the current') || normalized.toLowerCase().includes('available in order')) {
    return 'Customer unavailable';
  }

  return normalized;
}

function getStatusClass(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function getTrackingTitle(order: { trackingNumber?: string; carrier?: string; trackingUrl?: string }) {
  return order.trackingNumber || order.carrier || order.trackingUrl ? 'Tracking Synced' : 'Missing Tracking';
}

function getTrackingHelper(order: { trackingNumber?: string; carrier?: string; trackingUrl?: string }) {
  if (order.trackingNumber || order.carrier) {
    return [order.carrier, order.trackingNumber].filter(Boolean).join(' / ');
  }

  if (order.trackingUrl) {
    return 'Tracking link available';
  }

  return 'No tracking information available.';
}

type ShippingConfigDraft = {
  preferredProvider: ShippingProvider;
  cargoIntegrationId: string;
  defaultWarehouseId: string;
  defaultDesi: string;
  packageType: 'box' | 'document';
  tryOtoPickupLocationCode: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
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

function buildShippingConfigDraft(config?: VendorShippingConfig | null): ShippingConfigDraft {
  return {
    preferredProvider: config?.preferredProvider ?? 'kargo_entegrator',
    cargoIntegrationId: config?.cargoIntegrationId ?? '',
    defaultWarehouseId: config?.defaultWarehouseId ?? config?.warehouses.find((warehouse) => warehouse.isDefault)?.warehouseId ?? '',
    defaultDesi: config?.defaultDesi ?? '3.00',
    packageType: readPackageType(config),
    tryOtoPickupLocationCode: readTryOtoPickupLocationCode(config),
  };
}

function validateShippingConfigDraft(draft: ShippingConfigDraft) {
  const errors: string[] = [];

  if (!draft.preferredProvider) {
    errors.push('Provider is required.');
  }
  if (draft.preferredProvider === 'kargo_entegrator') {
    if (!/^\d+$/.test(draft.cargoIntegrationId.trim())) {
      errors.push('Cargo integration ID must be numeric.');
    }
    if (!/^\d+$/.test(draft.defaultWarehouseId.trim())) {
      errors.push('Warehouse ID must be numeric.');
    }
    if (draft.packageType !== 'box' && draft.packageType !== 'document') {
      errors.push('Package type must be box or document.');
    }
  }
  if (draft.preferredProvider === 'try_oto' && !draft.tryOtoPickupLocationCode.trim()) {
    errors.push('Try OTO pickup location code is required.');
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
      },
      warehouses: [],
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

function getInitialsLabel(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || '—';
}

function getVendorTimelineLabel(label: string) {
  const normalized = label.toLowerCase();

  if (normalized.includes('order')) {
    return 'Order received';
  }
  if (normalized.includes('fulfillment')) {
    return 'Fulfillment pending';
  }
  if (normalized.includes('shipping') || normalized.includes('shipment')) {
    return 'Awaiting shipment';
  }
  if (normalized.includes('tracking')) {
    return 'Tracking pending';
  }
  if (normalized.includes('delivered')) {
    return 'Delivered';
  }

  return toTitleCaseLabel(label);
}

function getTrackingMutationErrorMessage(error: unknown) {
  if (error instanceof ApiError) {
    switch (error.status) {
      case 400:
      case 403:
      case 404:
      case 409:
      case 502:
        return error.message;
      default:
        return error.message;
    }
  }

  if (error instanceof Error) {
    return error.message;
  }

  return 'Unable to submit tracking right now.';
}

type ShipmentActionState = {
  tone: 'success' | 'error' | 'info';
  message: string;
  shipment?: ShipmentExecution | null;
  diagnostics?: ApiErrorDiagnostics | null;
  endpoint?: string;
};

const SHIPMENT_CUSTOMER_FIELD_LABELS: Record<ShipmentCustomerField, string> = {
  name: 'Name',
  surname: 'Surname',
  phone: 'Phone',
  email: 'Email',
  country: 'Country',
  postcode: 'Postcode',
  city: 'City',
  district: 'District',
  address: 'Address',
};

function hasShipmentSuccessEvidence(value: unknown) {
  if (value === null || value === undefined) {
    return false;
  }
  const normalized = String(value).trim().toLowerCase();
  return Boolean(normalized && normalized !== 'pending' && normalized !== 'not available' && normalized !== '—');
}

function getShipmentRetryBlockedReason(
  shipment: OrderDetail['shipmentExecution'] | null,
  status: string,
  summary: NonNullable<OrderDetail['shipmentExecution']>['providerResponseSummary'] | null | undefined,
) {
  if (!shipment) {
    return 'No shipment execution is available.';
  }

  const failedLike =
    ['failed', 'validation_failed', 'provider_rejected', 'malformed_response'].includes(status) ||
    summary?.ok === false ||
    Boolean(summary?.providerError || summary?.providerValidationErrors.length);

  if (!failedLike) {
    return 'Shipment execution is not in a failed recovery state.';
  }

  if (hasShipmentSuccessEvidence(shipment.providerShipmentId)) {
    return 'Provider shipment id already exists.';
  }

  if (hasShipmentSuccessEvidence(shipment.trackingNumber)) {
    return 'Tracking number already exists.';
  }

  if (hasShipmentSuccessEvidence(shipment.labelUrl)) {
    return 'Label already exists.';
  }

  if (hasShipmentSuccessEvidence(shipment.barcode)) {
    return 'Barcode already exists.';
  }

  return null;
}

function getMissingShipmentCustomerFields(message: string): ShipmentCustomerField[] {
  const allowedFields = new Set(Object.keys(SHIPMENT_CUSTOMER_FIELD_LABELS));
  const fields = Array.from(message.matchAll(/customer\.([a-zA-Z0-9_]+)/g))
    .map((match) => match[1])
    .filter((field): field is ShipmentCustomerField => Boolean(field && allowedFields.has(field)));
  const normalizedMessage = message.toLocaleLowerCase('tr-TR');
  if (/\bdistrict\b/.test(normalizedMessage) || normalizedMessage.includes('ilçe') || normalizedMessage.includes('ilce')) {
    fields.push('district');
  }
  return Array.from(new Set(fields));
}

function getCreateShipmentErrorMessage(error: unknown) {
  if (error instanceof ApiError) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return 'Unable to create shipment right now.';
}

export function OrderDetailPage() {
  const { orderId } = useParams();
  const location = useLocation();
  const appReadiness = useAppReadiness();
  const currentUser = appReadiness.currentUser;
  const currentVendor = appReadiness.currentVendor;
  const authContextReady = appReadiness.ready;
  const isAdmin = currentUser?.role === 'admin';
  const isRealMode = runtimeConfig.apiMode === 'real';
  const { message, tone, showFeedback } = useActionFeedback();
  const [carrier, setCarrier] = useState('');
  const [trackingNumber, setTrackingNumber] = useState('');
  const [trackingUrl, setTrackingUrl] = useState('');
  const [notifyCustomer, setNotifyCustomer] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);
  const [shipmentActionState, setShipmentActionState] = useState<ShipmentActionState | null>(null);
  const [shipmentCustomerOverrides, setShipmentCustomerOverrides] = useState<ShipmentCustomerOverrides>({});
  const [shippingConfigDraft, setShippingConfigDraft] = useState<ShippingConfigDraft>(() => buildShippingConfigDraft(null));
  const [shippingConfigFeedback, setShippingConfigFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const { data: order, isLoading, isError, error, diagnostics, refetch } = useQueryResource(
    orderId ? queryKeys.orders.detail(orderId, currentVendor.vendorId) : queryKeys.orders.list(currentVendor.vendorId),
    () => {
      if (!orderId) {
        throw new Error('Order not found.');
      }

      return getOrder(orderId, { vendorId: currentVendor.vendorId });
    },
    {
      enabled: authContextReady && Boolean(orderId),
    },
  );
  const { data: vendorShippingConfig, refetch: refetchVendorShippingConfig } = useQueryResource(
    queryKeys.admin.shipments.vendorShippingConfig(currentVendor.vendorId),
    () => getVendorShippingConfig({ vendorId: currentVendor.vendorId }),
    {
      enabled: authContextReady && isAdmin && Boolean(currentVendor.vendorId),
    },
  );
  const diagnosticsProvider = vendorShippingConfig?.preferredProvider === 'try_oto' ? 'try_oto' : 'kargo_entegrator';
  const { data: shippingProviderDiagnostics, refetch: refetchShippingProviderDiagnostics } = useQueryResource(
    queryKeys.admin.shipments.providerConfig(diagnosticsProvider, currentVendor.vendorId),
    () => getShippingProviderDiagnostics({ vendorId: currentVendor.vendorId, provider: diagnosticsProvider }),
    {
      enabled: authContextReady && isAdmin,
    },
  );
  const { data: tryOtoOptionDiagnostics } = useQueryResource(
    queryKeys.admin.shipments.providerConfig('try_oto', currentVendor.vendorId),
    () => getShippingProviderDiagnostics({ vendorId: currentVendor.vendorId, provider: 'try_oto' }),
    {
      enabled: authContextReady && isAdmin,
    },
  );
  const { data: relatedReturnsData } = useQueryResource(
    queryKeys.returns.list(currentVendor.vendorId),
    () => listReturns({ vendorId: currentVendor.vendorId }),
    {
      enabled: authContextReady && Boolean(order),
    },
  );
  const { data: relatedFinanceData } = useQueryResource(
    queryKeys.finance.summary(currentVendor.vendorId),
    () => getFinanceDashboard({ vendorId: currentVendor.vendorId }),
    {
      enabled: authContextReady && Boolean(order),
    },
  );
  const { data: relatedSupportTicketsData } = useQueryResource(
    isAdmin ? queryKeys.admin.support.tickets() : queryKeys.support.tickets(currentVendor.vendorId),
    () => (isAdmin ? listAdminSupportTickets() : listVendorSupportTickets()),
    {
      enabled: authContextReady && Boolean(order),
    },
  );
  const { mutateAsync: runFulfillmentAction, isPending: isRunningFulfillmentAction } = useMutationAction(
    async (payload: { orderId: string; action: 'label' | 'ship' | 'tracking' }) => {
      await new Promise((resolve) => {
        globalThis.setTimeout(resolve, 300);
      });
      return payload;
    },
    {
      invalidateQueryKeys: [queryKeys.orders.list(currentVendor.vendorId), orderId ? queryKeys.orders.detail(orderId, currentVendor.vendorId) : queryKeys.orders.list(currentVendor.vendorId)],
    },
  );
  const { mutateAsync: createShipmentMutation, isPending: isCreatingShipment } = useMutationAction(
    async (payload: { allocationId: string; customerOverrides?: ShipmentCustomerOverrides }) =>
      createShipmentExecution(payload.allocationId, {
        vendorId: currentVendor.vendorId,
        customerOverrides: payload.customerOverrides,
      }),
    {
      invalidateQueryKeys: [queryKeys.orders.list(currentVendor.vendorId), orderId ? queryKeys.orders.detail(orderId, currentVendor.vendorId) : queryKeys.orders.list(currentVendor.vendorId)],
    },
  );
  const { mutateAsync: retryShipmentMutation, isPending: isRetryingShipment } = useMutationAction(
    async (shipmentExecutionId: string) => retryShipmentExecution(shipmentExecutionId),
    {
      invalidateQueryKeys: [queryKeys.orders.list(currentVendor.vendorId), orderId ? queryKeys.orders.detail(orderId, currentVendor.vendorId) : queryKeys.orders.list(currentVendor.vendorId)],
    },
  );
  const { mutateAsync: retryFailedShipmentMutation, isPending: isRetryingFailedShipment } = useMutationAction(
    async (payload: { shipmentExecutionId: string; customerOverrides?: ShipmentCustomerOverrides }) =>
      retryFailedShipmentExecution(payload.shipmentExecutionId, {
        vendorId: currentVendor.vendorId,
        customerOverrides: payload.customerOverrides,
      }),
    {
      invalidateQueryKeys: [queryKeys.orders.list(currentVendor.vendorId), orderId ? queryKeys.orders.detail(orderId, currentVendor.vendorId) : queryKeys.orders.list(currentVendor.vendorId)],
    },
  );
  const { mutateAsync: refreshShipmentStatusMutation, isPending: isRefreshingShipmentStatus } = useMutationAction(
    async (shipmentExecutionId: string) =>
      refreshShipmentExecutionStatus(shipmentExecutionId, {
        vendorId: currentVendor.vendorId,
      }),
    {
      invalidateQueryKeys: [queryKeys.orders.list(currentVendor.vendorId), orderId ? queryKeys.orders.detail(orderId, currentVendor.vendorId) : queryKeys.orders.list(currentVendor.vendorId)],
    },
  );
  const { mutateAsync: submitTrackingMutation, isPending: isSubmittingTracking } = useMutationAction(
    async (payload: { allocationId: string; trackingNumber: string; carrier: string; trackingUrl?: string; notifyCustomer: boolean }) => {
      return submitFulfillmentTracking(payload.allocationId, {
        trackingNumber: payload.trackingNumber,
        carrier: payload.carrier,
        trackingUrl: payload.trackingUrl,
        notifyCustomer: payload.notifyCustomer,
      });
    },
    {
      invalidateQueryKeys: [queryKeys.orders.list(currentVendor.vendorId), orderId ? queryKeys.orders.detail(orderId, currentVendor.vendorId) : queryKeys.orders.list(currentVendor.vendorId)],
    },
  );
  const { mutateAsync: updateShippingConfigMutation, isPending: isSavingShippingConfig } = useMutationAction(
    async (payload: VendorShippingConfigUpdate) => updateVendorShippingConfig(currentVendor.vendorId, payload),
    {
      invalidateQueryKeys: [
        queryKeys.admin.shipments.vendorShippingConfig(currentVendor.vendorId),
        queryKeys.admin.shipments.providerConfig(diagnosticsProvider, currentVendor.vendorId),
      ],
      onSuccess: async () => {
        setShippingConfigFeedback({ tone: 'success', message: 'Shipping provider configuration saved.' });
        await Promise.all([refetchVendorShippingConfig(), refetchShippingProviderDiagnostics()]);
      },
      onError: (error) => {
        const message = error instanceof Error ? error.message : 'Shipping provider configuration could not be saved.';
        setShippingConfigFeedback({ tone: 'error', message });
      },
    },
  );

  useEffect(() => {
    if (vendorShippingConfig) {
      setShippingConfigDraft(buildShippingConfigDraft(vendorShippingConfig));
      setShippingConfigFeedback(null);
    }
  }, [vendorShippingConfig]);

  const isVendorAssignedOwner =
    currentUser?.role === 'vendor' && !!order && currentUser.vendorAccess.includes(order.assignedVendorId);
  const canReportIssue =
    isVendorAssignedOwner && !!order && (order.allocationStatus === 'active' || order.allocationStatus === 'fulfilled');
  const canUseFulfillmentActions =
    isVendorAssignedOwner &&
    !!order &&
    order.fulfillmentActionAvailable &&
    order.allocationStatus !== 'pending_reassignment' &&
    order.allocationStatus !== 'vendor_blocked';
  const hasTrackingSync =
    !!order?.trackingNumber ||
    !!order?.carrier ||
    !!order?.trackingUrl ||
    order?.shippingStatus === 'In Transit' ||
    order?.shippingStatus === 'Delivered' ||
    order?.fulfillmentStatus === 'Fulfilled';
  const shouldShowRealTrackingForm = isRealMode && canUseFulfillmentActions && !hasTrackingSync;
  const shipmentExecution = order?.shipmentExecution ?? null;
  const visibleShipmentExecution = shipmentExecution ?? shipmentActionState?.shipment ?? null;
  const hasShipmentExecution = Boolean(visibleShipmentExecution);
  const shipmentProviderSummary = visibleShipmentExecution?.providerResponseSummary;
  const visibleShipmentStatus = (visibleShipmentExecution?.shipmentStatus ?? '').trim().toLowerCase();
  const providerMissingShipmentCustomerFields =
    shipmentProviderSummary?.ok === false || ['failed', 'validation_failed', 'provider_rejected', 'malformed_response'].includes(visibleShipmentStatus)
      ? [
          ...(shipmentProviderSummary?.providerValidationErrors ?? []),
          shipmentProviderSummary?.providerError ?? '',
        ].flatMap((message) => getMissingShipmentCustomerFields(message))
      : [];
  const actionMissingShipmentCustomerFields =
    shipmentActionState?.tone === 'error' ? getMissingShipmentCustomerFields(shipmentActionState.message) : [];
  const missingShipmentCustomerFields = Array.from(
    new Set([...actionMissingShipmentCustomerFields, ...providerMissingShipmentCustomerFields]),
  );
  const shouldShowShipmentProviderSummary =
    isAdmin &&
    Boolean(shipmentProviderSummary) &&
    Boolean(
      visibleShipmentExecution &&
        (['pending', 'failed', 'unknown'].includes(visibleShipmentStatus) ||
          !visibleShipmentExecution.providerShipmentId ||
          !visibleShipmentExecution.trackingNumber ||
          !visibleShipmentExecution.labelUrl),
    );
  const canRetryDryRunShipment =
    isAdmin &&
    Boolean(shipmentExecution) &&
    shipmentExecution?.shipmentStatus === 'pending' &&
    !shipmentExecution.providerShipmentId &&
    !shipmentExecution.trackingNumber &&
    Boolean(shipmentProviderSummary?.dryRun === true || (shipmentProviderSummary?.disabledGates.length ?? 0) > 0);
  const failedShipmentRetryBlockedReason = getShipmentRetryBlockedReason(
    visibleShipmentExecution,
    visibleShipmentStatus,
    shipmentProviderSummary,
  );
  const canRecoverFailedShipment = Boolean(visibleShipmentExecution) && failedShipmentRetryBlockedReason === null;
  const shouldShowFailedShipmentRetryDiagnostics =
    (isAdmin || canUseFulfillmentActions) &&
    Boolean(visibleShipmentExecution) &&
    (canRecoverFailedShipment ||
      ['failed', 'validation_failed', 'provider_rejected', 'malformed_response'].includes(visibleShipmentStatus) ||
      shipmentProviderSummary?.ok === false ||
      Boolean(shipmentProviderSummary?.providerError || shipmentProviderSummary?.providerValidationErrors.length));
  const shouldShowRecoveryShipmentFieldCompletionForm =
    missingShipmentCustomerFields.length > 0 && canRecoverFailedShipment && shipmentActionState?.tone !== 'error';
  const canRefreshTryOtoShipmentStatus =
    (isAdmin || canUseFulfillmentActions) &&
    visibleShipmentExecution?.provider === 'try_oto' &&
    Boolean(visibleShipmentExecution.providerShipmentId || visibleShipmentExecution.shipmentStatus === 'created') &&
    (!visibleShipmentExecution.trackingNumber || !visibleShipmentExecution.barcode || !visibleShipmentExecution.labelUrl);

  useEffect(() => {
    setShipmentCustomerOverrides({});
    setShipmentActionState(null);
  }, [orderId]);

  function buildShipmentCustomerOverrides(fields: ShipmentCustomerField[]) {
    const overrides = Object.fromEntries(
      fields
        .map((field) => [field, shipmentCustomerOverrides[field]?.trim() ?? ''] as const)
        .filter(([, value]) => Boolean(value)),
    ) as ShipmentCustomerOverrides;
    return Object.keys(overrides).length > 0 ? overrides : undefined;
  }

  function handleCreateShipment(fields: ShipmentCustomerField[] = []) {
    if (!order) {
      return;
    }

    const customerOverrides = buildShipmentCustomerOverrides(fields);
    setShipmentActionState({
      tone: 'info',
      message: 'Creating shipment with the configured provider...',
      endpoint: 'POST /shipments/create',
    });

    void createShipmentMutation({ allocationId: order.id, customerOverrides })
      .then((shipment) => {
        setShipmentActionState({
          tone: 'success',
          message:
            shipment.shipmentStatus === 'pending'
              ? 'Shipment request recorded. Carrier execution is pending.'
              : `Shipment ${shipment.providerShipmentId ?? shipment.id} recorded.`,
          shipment,
          endpoint: 'POST /shipments/create',
        });
        setShipmentCustomerOverrides({});
        showFeedback(
          shipment.shipmentStatus === 'pending'
            ? 'Shipment request recorded. Carrier execution is pending.'
            : `Shipment ${shipment.providerShipmentId ?? shipment.id} recorded.`,
          'success',
        );
        void refetch();
      })
      .catch((mutationError) => {
        const diagnostics = getApiErrorDiagnostics(mutationError);
        const errorMessage = getCreateShipmentErrorMessage(mutationError);
        setShipmentActionState({
          tone: 'error',
          message: errorMessage,
          diagnostics,
          endpoint: diagnostics?.endpoint ?? 'POST /shipments/create',
        });
        showFeedback(errorMessage, 'error');
      });
  }

  function handleRetryFailedShipment(fields: ShipmentCustomerField[] = []) {
    if (!visibleShipmentExecution) {
      return;
    }

    const customerOverrides = buildShipmentCustomerOverrides(fields);
    setShipmentActionState({
      tone: 'info',
      message: 'Retrying shipment provider request...',
      endpoint: `POST /shipments/${visibleShipmentExecution.id}/retry`,
    });

    void retryFailedShipmentMutation({ shipmentExecutionId: visibleShipmentExecution.id, customerOverrides })
      .then((shipment) => {
        setShipmentActionState({
          tone: 'success',
          message:
            shipment.shipmentStatus === 'pending'
              ? 'Shipment retry recorded. Carrier execution is pending.'
              : `Shipment ${shipment.providerShipmentId ?? shipment.id} recorded.`,
          shipment,
          endpoint: `POST /shipments/${visibleShipmentExecution.id}/retry`,
        });
        setShipmentCustomerOverrides({});
        showFeedback(
          shipment.shipmentStatus === 'pending'
            ? 'Shipment retry recorded. Carrier execution is pending.'
            : `Shipment ${shipment.providerShipmentId ?? shipment.id} recorded.`,
          'success',
        );
        void refetch();
      })
      .catch((mutationError) => {
        const diagnostics = getApiErrorDiagnostics(mutationError);
        const errorMessage = getCreateShipmentErrorMessage(mutationError);
        setShipmentActionState({
          tone: 'error',
          message: errorMessage,
          diagnostics,
          endpoint: diagnostics?.endpoint ?? `POST /shipments/${visibleShipmentExecution.id}/retry`,
        });
        showFeedback(errorMessage, 'error');
      });
  }

  function handleRefreshShipmentStatus() {
    if (!visibleShipmentExecution) {
      return;
    }

    setShipmentActionState({
      tone: 'info',
      message: 'Refreshing Try OTO shipment status...',
      endpoint: `POST /shipments/${visibleShipmentExecution.id}/refresh`,
    });

    void refreshShipmentStatusMutation(visibleShipmentExecution.id)
      .then((shipment) => {
        const hasNewShipmentEvidence = Boolean(shipment.trackingNumber || shipment.barcode || shipment.labelUrl);
        setShipmentActionState({
          tone: hasNewShipmentEvidence ? 'success' : 'info',
          message: hasNewShipmentEvidence
            ? 'Try OTO shipment status refreshed.'
            : 'Try OTO status checked. Tracking, barcode, or label are still pending.',
          shipment,
          endpoint: `POST /shipments/${visibleShipmentExecution.id}/refresh`,
        });
        showFeedback(
          hasNewShipmentEvidence
            ? 'Try OTO shipment status refreshed.'
            : 'Try OTO status checked. Tracking, barcode, or label are still pending.',
          hasNewShipmentEvidence ? 'success' : 'info',
        );
        void refetch();
      })
      .catch((mutationError) => {
        const diagnostics = getApiErrorDiagnostics(mutationError);
        const errorMessage = mutationError instanceof Error ? mutationError.message : 'Try OTO shipment status could not be refreshed.';
        setShipmentActionState({
          tone: 'error',
          message: errorMessage,
          diagnostics,
          endpoint: diagnostics?.endpoint ?? `POST /shipments/${visibleShipmentExecution.id}/refresh`,
        });
        showFeedback(errorMessage, 'error');
      });
  }

  function renderShipmentFieldCompletionForm() {
    if (missingShipmentCustomerFields.length === 0) {
      return null;
    }

    return (
      <form
        className="shipment-field-completion-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (canRecoverFailedShipment) {
            handleRetryFailedShipment(missingShipmentCustomerFields);
          } else {
            handleCreateShipment(missingShipmentCustomerFields);
          }
        }}
      >
        <div>
          <span>Complete shipment-only fields</span>
          <p>These values are used only for this shipment request.</p>
        </div>
        <div className="shipment-field-completion-grid">
          {missingShipmentCustomerFields.map((field) => (
            <label className="field" key={field}>
              <span>{SHIPMENT_CUSTOMER_FIELD_LABELS[field]} *</span>
              <input
                required
                value={shipmentCustomerOverrides[field] ?? ''}
                onChange={(event) =>
                  setShipmentCustomerOverrides((current) => ({
                    ...current,
                    [field]: event.target.value,
                  }))
                }
              />
            </label>
          ))}
        </div>
        <button
          type="submit"
          className="button button-primary"
          disabled={isCreatingShipment || isRetryingFailedShipment}
        >
          {isRetryingFailedShipment
            ? 'Retrying...'
            : isCreatingShipment
              ? 'Creating...'
              : canRecoverFailedShipment
                ? 'Retry shipment with completed fields'
                : 'Create shipment with completed fields'}
        </button>
      </form>
    );
  }

  function renderShipmentPayloadDiagnostics(summary: NonNullable<typeof shipmentProviderSummary>) {
    const diagnostics = summary.payloadDiagnostics;
    if (!diagnostics) {
      return null;
    }

    return (
      <>
        <div className="summary-row">
          <span>Request endpoint</span>
          <strong>{summary.requestPath || '—'}</strong>
        </div>
        <div className="summary-row">
          <span>Provider mode</span>
          <strong>{summary.providerMode || '—'}</strong>
        </div>
        <div className="summary-row">
          <span>Environment</span>
          <strong>{summary.selectedEnvironment || '—'}</strong>
        </div>
        <div className="summary-row">
          <span>Target host</span>
          <strong>{summary.requestTargetHostname || '—'}</strong>
        </div>
        <div className="summary-row">
          <span>Payload keys</span>
          <strong>{diagnostics.topLevelKeys.length ? diagnostics.topLevelKeys.join(', ') : '—'}</strong>
        </div>
        {'deliveryOptionIdPresent' in diagnostics ? (
          <div className="summary-row">
            <span>Delivery option</span>
            <strong>{diagnostics.deliveryOptionIdPresent ? 'present' : 'missing'}</strong>
          </div>
        ) : null}
        <div className="summary-row">
          <span>Customer keys</span>
          <strong>{diagnostics.customerKeys.length ? diagnostics.customerKeys.join(', ') : '—'}</strong>
        </div>
        <div className="summary-row">
          <span>Receiver keys</span>
          <strong>{diagnostics.receiverKeys.length ? diagnostics.receiverKeys.join(', ') : '—'}</strong>
        </div>
        <div className="summary-row">
          <span>Provider config fields</span>
          <strong>
            cargo integration {diagnostics.cargoIntegrationIdPresent ? 'yes' : 'no'} · warehouse{' '}
            {diagnostics.warehouseIdPresent ? 'yes' : 'no'}
          </strong>
        </div>
        <div className="summary-row">
          <span>Shipment enums</span>
          <strong>
            payment {diagnostics.paymentType || '—'} · package {diagnostics.packageType || '—'} · payor {diagnostics.payorType || '—'}
          </strong>
        </div>
        <div className="summary-row">
          <span>Weight fields</span>
          <strong>
            kg {diagnostics.kgPresent ? `yes (${diagnostics.kgType || 'unknown'})` : 'no'} · desi{' '}
            {diagnostics.desiPresent ? `yes (${diagnostics.desiType || 'unknown'})` : 'no'}
          </strong>
        </div>
        <div className="summary-row">
          <span>Platform identifiers</span>
          <strong>
            platform_id {diagnostics.platformIdPresent ? 'yes' : 'no'} · platform_d_id{' '}
            {diagnostics.platformDIdPresent ? 'yes' : 'no'}
          </strong>
        </div>
        <div className="summary-row">
          <span>Customer required fields</span>
          <strong>
            phone {diagnostics.customerPhonePresent ? 'yes' : 'no'} · district{' '}
            {diagnostics.customerDistrictPresent ? 'yes' : 'no'} · city {diagnostics.customerCityPresent ? 'yes' : 'no'}
          </strong>
        </div>
        <div className="summary-row">
          <span>Address fields</span>
          <strong>
            address {diagnostics.addressFieldPresence.customerAddress ? 'yes' : 'no'} · postcode{' '}
            {diagnostics.addressFieldPresence.customerPostcode ? 'yes' : 'no'} · country{' '}
            {diagnostics.addressFieldPresence.customerCountry ? 'yes' : 'no'}
          </strong>
        </div>
      </>
    );
  }

  function renderTryOtoFinalizationDiagnostics(summary: NonNullable<typeof shipmentProviderSummary>) {
    const diagnostics = summary.tryOtoFinalization;
    if (!diagnostics) {
      return null;
    }
    const formatPresence = (value: boolean | null | undefined) => (value === null || value === undefined ? '—' : value ? 'yes' : 'no');
    const formatLookupPresence = (presence: typeof diagnostics.deliveryOptionLookupRequestPresence) =>
      presence
        ? [
            `pickup ${formatPresence(presence.pickupLocationCode)}`,
            `origin ${formatPresence(presence.originCity)}`,
            `weight ${formatPresence(presence.packageWeight)}`,
            `customer.city ${formatPresence(presence.customerCity)}`,
            `customer.country ${formatPresence(presence.customerCountry)}`,
            `payment ${formatPresence(presence.paymentMethod)}`,
          ].join(' · ')
        : '—';

    return (
      <>
        <div className="summary-row">
          <span>Try OTO createOrder</span>
          <strong>{diagnostics.createOrderSuccess === null ? '—' : diagnostics.createOrderSuccess ? 'success' : 'failed'}</strong>
        </div>
        <div className="summary-row">
          <span>Try OTO createShipment</span>
          <strong>
            called {diagnostics.createShipmentCalled ? 'yes' : 'no'} · success{' '}
            {diagnostics.createShipmentSuccess === null ? '—' : diagnostics.createShipmentSuccess ? 'yes' : 'no'}
          </strong>
        </div>
        <div className="summary-row">
          <span>Delivery option lookup</span>
          <strong>
            called {diagnostics.deliveryOptionLookupCalled ? 'yes' : 'no'} · success{' '}
            {diagnostics.deliveryOptionLookupSuccess === null ? '—' : diagnostics.deliveryOptionLookupSuccess ? 'yes' : 'no'} · options{' '}
            {diagnostics.deliveryOptionLookupOptionCount ?? '—'}
          </strong>
        </div>
        <div className="summary-row">
          <span>Delivery lookup endpoint</span>
          <strong>{diagnostics.deliveryOptionLookupEndpoint || '—'}</strong>
        </div>
        <div className="summary-row">
          <span>Delivery lookup request keys</span>
          <strong>
            {diagnostics.deliveryOptionLookupRequestKeys?.length ? diagnostics.deliveryOptionLookupRequestKeys.join(', ') : '—'}
          </strong>
        </div>
        <div className="summary-row">
          <span>Delivery lookup payload fields</span>
          <strong>{formatLookupPresence(diagnostics.deliveryOptionLookupRequestPresence)}</strong>
        </div>
        <div className="summary-row">
          <span>Delivery lookup source fields</span>
          <strong>{formatLookupPresence(diagnostics.deliveryOptionLookupSourcePresence)}</strong>
        </div>
        <div className="summary-row">
          <span>Delivery lookup response</span>
          <strong>
            HTTP {diagnostics.deliveryOptionLookupResponseStatus ?? '—'} · keys{' '}
            {diagnostics.deliveryOptionLookupResponseKeys?.length ? diagnostics.deliveryOptionLookupResponseKeys.join(', ') : '—'}
          </strong>
        </div>
        <div className="summary-row">
          <span>Delivery lookup response options</span>
          <strong>
            deliveryOptionId {formatPresence(diagnostics.deliveryOptionLookupResponseHasDeliveryOptionId)} · company{' '}
            {formatPresence(diagnostics.deliveryOptionLookupResponseHasDeliveryCompanyName)} · pricing{' '}
            {formatPresence(diagnostics.deliveryOptionLookupResponseHasPricing)}
            {diagnostics.deliveryOptionLookupResponsePricingKeys?.length
              ? ` (${diagnostics.deliveryOptionLookupResponsePricingKeys.join(', ')})`
              : ''}
          </strong>
        </div>
        <div className="summary-row">
          <span>Selected delivery option</span>
          <strong>
            {diagnostics.selectedDeliveryOptionIdPresent ? 'present' : 'missing'}
            {diagnostics.selectedDeliveryCompanyName ? ` · ${diagnostics.selectedDeliveryCompanyName}` : ''}
          </strong>
        </div>
        {diagnostics.deliveryOptionLookupErrorMessage ? (
          <div className="summary-row">
            <span>Delivery option error</span>
            <strong>{diagnostics.deliveryOptionLookupErrorMessage}</strong>
          </div>
        ) : null}
        <div className="summary-row">
          <span>createShipment request keys</span>
          <strong>{diagnostics.createShipmentRequestKeys.length ? diagnostics.createShipmentRequestKeys.join(', ') : '—'}</strong>
        </div>
        <div className="summary-row">
          <span>createShipment response keys</span>
          <strong>{diagnostics.createShipmentResponseKeys.length ? diagnostics.createShipmentResponseKeys.join(', ') : '—'}</strong>
        </div>
        <div className="summary-row">
          <span>createShipment message</span>
          <strong>{diagnostics.createShipmentProviderMessage || '—'}</strong>
        </div>
        <div className="summary-row">
          <span>deliveryOptionId</span>
          <strong>
            createOrder {diagnostics.deliveryOptionIdPresent === null ? '—' : diagnostics.deliveryOptionIdPresent ? 'present' : 'missing'} ·
            createShipment{' '}
            {diagnostics.createShipmentDeliveryOptionIdPresent === null
              ? '—'
              : diagnostics.createShipmentDeliveryOptionIdPresent
                ? 'present'
                : 'missing'}
          </strong>
        </div>
        <div className="summary-row">
          <span>orderStatus value</span>
          <strong>{diagnostics.orderStatusValue || '—'}</strong>
        </div>
      </>
    );
  }

  const supportSnapshot = order
    ? {
        route: location.pathname,
        orderNumber: formatShopifyOrderNumber(order.sourceShopifyOrderNumber),
        allocationStatus: order.allocationStatus,
        fulfillmentStatus: order.fulfillmentStatus,
        shippingStatus: order.shippingStatus,
        trackingPresent: Boolean(order.trackingNumber || order.trackingUrl),
        shipmentExecutionId: shipmentExecution?.id ?? null,
        shipmentStatus: shipmentExecution?.shipmentStatus ?? null,
      }
    : null;
  const relatedReturns = useMemo(
    () =>
      (relatedReturnsData ?? []).filter(
        (returnRecord) =>
          returnRecord.relatedOrderId === order?.id ||
          sameOperationalOrderNumber(returnRecord.sourceShopifyOrderNumber, order?.sourceShopifyOrderNumber) ||
          sameShopifyIdentifier(returnRecord.sourceShopifyOrderId, order?.sourceShopifyOrderId),
      ),
    [order?.id, order?.sourceShopifyOrderId, order?.sourceShopifyOrderNumber, relatedReturnsData],
  );
  const relatedFinanceRecords = useMemo(
    () =>
      (relatedFinanceData?.transactions ?? []).filter(
        (record) =>
          sameOperationalOrderNumber(record.shopifyOrderNumber, order?.sourceShopifyOrderNumber) ||
          sameShopifyIdentifier(record.shopifyOrderId, order?.sourceShopifyOrderId),
      ),
    [order?.sourceShopifyOrderId, order?.sourceShopifyOrderNumber, relatedFinanceData?.transactions],
  );
  const relatedSupportTickets = useMemo(
    () =>
      (relatedSupportTicketsData ?? []).filter((ticket) =>
        supportTicketMatchesOrder(ticket, order?.id, order?.sourceShopifyOrderNumber, {
          audience: isAdmin ? 'admin' : 'vendor',
          currentVendorId: currentVendor.vendorId,
        }),
      ),
    [currentVendor.vendorId, isAdmin, order?.id, order?.sourceShopifyOrderNumber, relatedSupportTicketsData],
  );

  const handleSaveShippingConfig = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const validationErrors = validateShippingConfigDraft(shippingConfigDraft);
    if (validationErrors.length) {
      setShippingConfigFeedback({ tone: 'error', message: validationErrors.join(' ') });
      return;
    }

    void updateShippingConfigMutation(buildShippingConfigUpdate(shippingConfigDraft, vendorShippingConfig));
  };

  const handleRetryShipment = () => {
    if (!shipmentExecution || !canRetryDryRunShipment) {
      return;
    }

    void retryShipmentMutation(shipmentExecution.id)
      .then((shipment) => {
        showFeedback(
          shipment.shipmentStatus === 'pending'
            ? 'Shipment retry recorded. Carrier execution is pending.'
            : `Shipment ${shipment.providerShipmentId ?? shipment.id} refreshed.`,
          'success',
        );
        void refetch();
      })
      .catch((mutationError) => {
        showFeedback(getTrackingMutationErrorMessage(mutationError), 'error');
      });
  };

  useEffect(() => {
    if (!order) {
      return;
    }

    setCarrier(order.carrier ?? '');
    setTrackingNumber(order.trackingNumber ?? '');
    setTrackingUrl('');
    setNotifyCustomer(false);
  }, [order]);

  useEffect(() => {
    setShipmentActionState(null);
  }, [order?.id]);

  if (!authContextReady || isLoading) {
    return (
      <DataStatePanel
        tone="loading"
        eyebrow="Orders"
        title="Loading order"
        description="Fetching the selected order from the central data layer."
      />
    );
  }

  if (isError || !order) {
    return (
      <DataStatePanel
        tone="error"
        eyebrow="Orders"
        title="Order unavailable"
        description={error ?? 'The selected order could not be loaded.'}
        diagnostics={diagnostics}
        actionLabel="Back to orders"
        actionTo="/orders"
      />
    );
  }

  const orderItems = order.lineItems ?? order.items;
  const customerLabel = getCompactCustomerLabel(order.customer);
  const trackingTitle = getTrackingTitle(order);
  const trackingHelper = getTrackingHelper(order);
  const summaryCards = [
    {
      label: 'Allocation status',
      value: toTitleCaseLabel(order.allocationStatus),
      helper: order.cancellationReason
        ? `Reason: ${order.cancellationReason.replace(/_/g, ' ')}`
        : 'Vendor allocation state.',
      tone: 'danger',
      icon: 'A',
    },
    {
      label: 'Fulfillment status',
      value: order.fulfillmentStatus,
      helper: order.fulfilledAt ? `Fulfilled ${formatDate(order.fulfilledAt)}` : 'Fulfillment is being processed.',
      tone: 'info',
      icon: 'F',
    },
    {
      label: 'Shipping status',
      value: order.shippingStatus,
      helper: order.shipmentCreatedAt ? `Shipment created ${formatDate(order.shipmentCreatedAt)}` : 'Waiting for shipment progression.',
      tone: 'warning',
      icon: 'S',
    },
    {
      label: 'Tracking status',
      value: trackingTitle,
      helper: trackingHelper,
      tone: hasTrackingSync ? 'success' : 'muted',
      icon: 'T',
    },
  ];
  const audience = isAdmin ? 'admin' : 'vendor';
  const supportBasePath = isAdmin ? '/admin/support' : '/support';
  const orderTimelineEvents: OperationalEventInput[] = [];
  orderTimelineEvents.push({
    id: 'order-created',
    title: 'Order created',
    description: `Order ${formatShopifyOrderNumber(order.sourceShopifyOrderNumber)} entered the vendor workspace.`,
    at: order.date,
    status: order.status,
    tone: 'info',
  });
  if (order.shipmentCreatedAt) {
    orderTimelineEvents.push({
      id: 'shipment-created',
      title: 'Shipment created',
      description: order.carrier ? `Carrier: ${order.carrier}` : 'Shipment record is available.',
      at: order.shipmentCreatedAt,
      status: order.shippingStatus,
      tone: 'success',
    });
  }
  if (order.trackingNumber || order.trackingUrl) {
    orderTimelineEvents.push({
      id: 'tracking-added',
      title: 'Tracking added',
      description: [order.carrier, order.trackingNumber].filter(Boolean).join(' / ') || 'Tracking link available.',
      at: order.shipmentUpdatedAt ?? order.fulfilledAt ?? order.date,
      status: 'Tracking added',
      tone: 'success',
    });
  }
  orderTimelineEvents.push(
    ...relatedReturns.map((returnRecord) => ({
      id: `return-${returnRecord.id}`,
      title: 'Return requested',
      description: `${returnRecord.displayTitle ?? returnRecord.itemTitle ?? 'Returned item'} · ${getStatusClass(returnRecord.status).replace(/-/g, ' ')}`,
      at: returnRecord.date,
      status: returnRecord.status,
      tone: 'attention' as const,
      href: `/returns/${returnRecord.id}`,
    })),
    ...relatedFinanceRecords.map((record) => ({
      id: `finance-${record.id}`,
      title: record.category === 'Refund' ? 'Refund processed' : 'Finance entry created',
      description: `${record.category} · ${record.amount}`,
      at: record.date,
      status: record.status,
      tone: record.category === 'Refund' ? ('warning' as const) : ('success' as const),
      href: buildFinanceHref(record),
    })),
    ...relatedSupportTickets.map((ticket) => ({
      id: `support-${ticket.id}`,
      title: 'Support ticket opened',
      description: ticket.subject,
      at: ticket.createdAt,
      status: ticket.status.replace(/_/g, ' '),
      tone: ticket.status === 'RESOLVED' || ticket.status === 'CLOSED' ? ('success' as const) : ('info' as const),
      href: `${supportBasePath}/${ticket.id}`,
    })),
    ...relatedSupportTickets
      .filter((ticket) => Boolean(ticket.lastReplyAt))
      .map((ticket) => ({
        id: `support-reply-${ticket.id}`,
        title: 'Support reply added',
        description: ticket.subject,
        at: ticket.lastReplyAt,
        status: ticket.lastReplyByRole ?? 'Reply',
        tone: 'neutral' as const,
        href: `${supportBasePath}/${ticket.id}`,
      })),
  );
  const orderCrossLinks: OperationalLinkInput[] = [
    ...relatedReturns.map((returnRecord) => ({
      id: `return-${returnRecord.id}`,
      eyebrow: 'Return',
      title: `Return for ${formatShopifyOrderNumber(returnRecord.sourceShopifyOrderNumber)}`,
      description: returnRecord.displayTitle ?? returnRecord.itemTitle ?? 'Returned item',
      href: `/returns/${returnRecord.id}`,
      status: returnRecord.status,
      tone: returnRecord.status === 'Refunded' || returnRecord.status === 'Closed' ? ('success' as const) : ('attention' as const),
    })),
    ...relatedFinanceRecords.map((record) => ({
      id: `finance-${record.id}`,
      eyebrow: 'Finance',
      title: record.category === 'Refund' ? 'Refund impact' : 'Payout activity',
      description: `${record.amount} · ${record.status}`,
      href: buildFinanceHref(record),
      status: record.category,
      tone: record.category === 'Refund' ? ('warning' as const) : ('success' as const),
    })),
    ...relatedSupportTickets.map((ticket) => ({
      id: `support-${ticket.id}`,
      eyebrow: 'Support',
      title: ticket.subject,
      description: ticket.vendorName ?? ticket.vendorId,
      href: `${supportBasePath}/${ticket.id}`,
      status: ticket.status.replace(/_/g, ' '),
      tone: ticket.status === 'RESOLVED' || ticket.status === 'CLOSED' ? ('success' as const) : ('info' as const),
    })),
  ];
  const orderRecommendations: OperationsRecommendation[] = [];
  if (!hasTrackingSync && order.shippingStatus !== 'Delivered') {
    orderRecommendations.push({
      id: `order-rec-tracking-${order.id}`,
      type: 'shipment_tracking',
      severity: order.shipmentCreatedAt ? 'warning' : 'info',
      title: 'Review shipment tracking',
      description: `Order ${formatShopifyOrderNumber(order.sourceShopifyOrderNumber)} does not have tracking visible yet.`,
      recommendedAction: 'Confirm shipment progress and add tracking when available',
      relatedObjectType: 'Order',
      relatedObjectId: order.id,
      vendor: {
        id: order.assignedVendorId,
        name: currentVendor.vendorName ?? order.assignedVendorId,
      },
      createdFromSignal: `order:${order.id}:tracking`,
      deepLink: `/orders/${order.id}`,
      vendorVisible: true,
      createdAt: order.shipmentUpdatedAt ?? order.date,
    });
  }
  const activeReturn = relatedReturns.find((returnRecord) => !['Closed', 'Processed', 'Refunded'].includes(returnRecord.status));
  if (activeReturn) {
    orderRecommendations.push({
      id: `order-rec-return-${activeReturn.id}`,
      type: 'return_review',
      severity: activeReturn.status === 'Requested' || activeReturn.status === 'In Review' ? 'warning' : 'info',
      title: 'Review unresolved return',
      description: `A related return for ${formatShopifyOrderNumber(activeReturn.sourceShopifyOrderNumber)} is still active.`,
      recommendedAction: 'Open the return and review the next vendor action',
      relatedObjectType: 'Return',
      relatedObjectId: activeReturn.id,
      vendor: {
        id: activeReturn.assignedVendorId,
        name: currentVendor.vendorName ?? activeReturn.assignedVendorId,
      },
      createdFromSignal: `return:${activeReturn.id}`,
      deepLink: `/returns/${activeReturn.id}`,
      vendorVisible: true,
      createdAt: activeReturn.updatedAt ?? activeReturn.date,
    });
  }
  const waitingSupportTicket = relatedSupportTickets.find((ticket) => ticket.status === 'WAITING_FOR_VENDOR');
  if (waitingSupportTicket) {
    orderRecommendations.push({
      id: `order-rec-support-${waitingSupportTicket.id}`,
      type: 'support_assignment',
      severity: 'warning',
      title: 'Reply to support request',
      description: waitingSupportTicket.subject,
      recommendedAction: 'Open support and provide the requested update',
      relatedObjectType: 'Support ticket',
      relatedObjectId: waitingSupportTicket.id,
      vendor: {
        id: waitingSupportTicket.vendorId,
        name: waitingSupportTicket.vendorName ?? waitingSupportTicket.vendorId,
      },
      createdFromSignal: `support:${waitingSupportTicket.id}`,
      deepLink: `${supportBasePath}/${waitingSupportTicket.id}`,
      vendorVisible: true,
      createdAt: waitingSupportTicket.lastReplyAt ?? waitingSupportTicket.updatedAt,
    });
  }

  const isKargoConfigDraft = shippingConfigDraft.preferredProvider === 'kargo_entegrator';
  const isTryOtoConfigDraft = shippingConfigDraft.preferredProvider === 'try_oto';
  const shouldShowTryOtoProviderOption =
    vendorShippingConfig?.preferredProvider === 'try_oto' ||
    shippingProviderDiagnostics?.provider === 'try_oto' ||
    Boolean(shippingProviderDiagnostics?.supportedProviders?.includes('try_oto')) ||
    Boolean(tryOtoOptionDiagnostics?.supportedProviders?.includes('try_oto')) ||
    Boolean(tryOtoOptionDiagnostics?.providerEnabled);
  const tryOtoPickupLocationCode = readTryOtoPickupLocationCode(vendorShippingConfig);

  const shippingConfigEditorForm = isAdmin && shippingProviderDiagnostics ? (
    <form
      className="shipping-config-editor"
      aria-label="Shipping provider configuration editor"
      noValidate
      onSubmit={handleSaveShippingConfig}
    >
      <div className="shipping-config-editor-heading">
        <div>
          <strong>Provider configuration</strong>
          <span>Shipment settings for {currentVendor.vendorName ?? currentVendor.vendorId}</span>
        </div>
        <span>
          Last updated: {vendorShippingConfig?.updatedAt ? formatOptionalDate(vendorShippingConfig.updatedAt) : 'not configured'}
        </span>
      </div>
      <div className="shipping-config-editor-grid">
        <label className="field">
          <span>Provider</span>
          <select
            value={shippingConfigDraft.preferredProvider}
            onChange={(event) =>
              setShippingConfigDraft((current) => ({
                ...current,
                preferredProvider: event.target.value as ShippingProvider,
              }))
            }
          >
            <option value="kargo_entegrator">Kargo Entegratör</option>
            {shouldShowTryOtoProviderOption ? <option value="try_oto">Try OTO</option> : null}
            <option value="hepsijet">Hepsijet</option>
          </select>
        </label>
        {isKargoConfigDraft ? (
          <>
            <label className="field">
              <span>Cargo integration ID</span>
              <input
                inputMode="numeric"
                pattern="[0-9]*"
                value={shippingConfigDraft.cargoIntegrationId}
                onChange={(event) =>
                  setShippingConfigDraft((current) => ({
                    ...current,
                    cargoIntegrationId: event.target.value,
                  }))
                }
              />
            </label>
            <label className="field">
              <span>Warehouse ID</span>
              <input
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
          </>
        ) : null}
        {isTryOtoConfigDraft ? (
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
        ) : null}
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
        {isKargoConfigDraft ? (
          <label className="field">
            <span>Package type</span>
            <select
              value={shippingConfigDraft.packageType}
              onChange={(event) =>
                setShippingConfigDraft((current) => ({
                  ...current,
                  packageType: event.target.value as ShippingConfigDraft['packageType'],
                }))
              }
            >
              <option value="box">box</option>
              <option value="document">document</option>
            </select>
          </label>
        ) : null}
        <div className="shipping-config-readonly">
          <span>Sandbox</span>
          <strong>{shippingProviderDiagnostics.sandboxModeEnabled ? 'enabled' : 'disabled'}</strong>
        </div>
        <div className="shipping-config-readonly">
          <span>Webhook ingest</span>
          <strong>{shippingProviderDiagnostics.webhookIngestEnabled ? 'enabled' : 'disabled'}</strong>
        </div>
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
  ) : null;

  return (
    <section className="order-detail-workspace">
      <header className="order-detail-topbar">
        <Link className="order-detail-back" to="/orders">
          Back to orders
        </Link>
        <div className="order-detail-title-row">
          <div className="order-detail-title-stack">
            <div className="order-detail-heading-line">
              <h1>Order {formatShopifyOrderNumber(order.sourceShopifyOrderNumber)}</h1>
              <span className="order-source-pill">{order.channel || 'Unknown'}</span>
              <span className={`status-badge status-${getStatusClass(order.status)}`}>{order.status}</span>
            </div>
            <div className="order-detail-meta-strip">
              <div>
                <span>Created</span>
                <strong>{formatDate(order.date)}</strong>
              </div>
              <div>
                <span>Vendor</span>
                <strong>{order.assignedVendorId || 'Unknown'}</strong>
              </div>
              <div>
                <span>Customer</span>
                <strong>{customerLabel}</strong>
              </div>
            </div>
          </div>
        </div>
        <div className="order-detail-status-pills">
          <span className={`status-badge status-${getStatusClass(order.allocationStatus)}`}>
            {toTitleCaseLabel(order.allocationStatus)}
          </span>
          <span className={`status-badge status-${getStatusClass(order.fulfillmentStatus)}`}>
            {order.fulfillmentStatus}
          </span>
          <span className={`status-badge status-${getStatusClass(order.shippingStatus)}`}>
            {order.shippingStatus}
          </span>
        </div>
      </header>

      <div className="order-status-summary-grid">
        {summaryCards.map((card) => (
          <article key={card.label} className={`order-status-summary-card order-status-${card.tone}`}>
            <span className="order-status-icon" aria-hidden="true">
              {card.icon}
            </span>
            <div>
              <span>{card.label}</span>
              <strong>{card.value}</strong>
              <p>{card.helper}</p>
            </div>
          </article>
        ))}
      </div>

      <div className="order-detail-main-grid">
        <div className="order-detail-left-column">
          <article className="order-detail-card-v2 order-line-items-card">
            <div className="order-card-heading">
              <h2>Line items ({orderItems.length})</h2>
            </div>
            <div className="order-line-items-compact">
              {orderItems.length > 0 ? (
                orderItems.map((item) => (
                  <div key={item.id} className="order-line-item-row-v2">
                    <span className="order-item-thumb" aria-hidden="true">
                      {getInitialsLabel(item.name || item.sku || 'Item')}
                    </span>
                    <div className="order-item-primary">
                      <strong>{item.name || 'Unknown item'}</strong>
                      <span>{item.sku || '—'}</span>
                    </div>
                    <div>
                      <span>Variant / SKU</span>
                      <strong>{item.variantTitle || item.sku || '—'}</strong>
                    </div>
                    <div>
                      <span>Qty</span>
                      <strong>{item.quantity}</strong>
                    </div>
                    <div>
                      <span>Unit price</span>
                      <strong>{item.price}</strong>
                    </div>
                    <div>
                      <span>Total</span>
                      <strong>{item.price}</strong>
                    </div>
                  </div>
                ))
              ) : (
                <p className="order-empty-copy">No records available.</p>
              )}
            </div>
          </article>

          <article className="order-detail-card-v2">
            <div className="order-card-heading">
              <h2>Financial summary</h2>
            </div>
            <div className="order-financial-impact-grid">
              <div>
                <span>Order total</span>
                <strong>{order.amount}</strong>
              </div>
              <div>
                <span>Vendor payout impact</span>
                <strong>Included in payout calculations</strong>
              </div>
              <div>
                <span>Refund status</span>
                <strong>—</strong>
              </div>
            </div>
          </article>

          <article className="order-detail-card-v2">
            <div className="order-card-heading">
              <h2>Additional details</h2>
            </div>
            <div className="order-secondary-detail-grid">
              <div>
                <span>Shopify order ID</span>
                <strong>{order.sourceShopifyOrderId || '—'}</strong>
              </div>
              <div>
                <span>Shipment status</span>
                <strong>{order.shipmentCreatedAt ? formatOptionalDate(order.shipmentCreatedAt) : order.shippingStatus}</strong>
              </div>
              <div>
                <span>Shipping address</span>
                <strong>{order.shippingAddress || 'Unknown'}</strong>
              </div>
            </div>
          </article>

          <OperationalLinkCards
            title="Related operational records"
            subtitle="Returns, payout activity, and support linked to this order."
            links={orderCrossLinks}
            audience={audience}
          />
        </div>

        <aside className="order-detail-right-column">
          <OperationalRecommendations
            title="Suggested next steps"
            subtitle="Contextual, read-only guidance for this order."
            recommendations={orderRecommendations}
            audience={audience}
          />

          {order ? (
            <AdminCollaborationNotes contextType="order" contextId={order.id} currentUser={currentUser} />
          ) : null}

          <OperationalTimeline
            title="Unified activity"
            subtitle="Order, return, finance, and support events."
            events={[
              ...order.timeline.map((entry) => ({
                id: `order-native-${entry.label}-${entry.at}`,
                title: getVendorTimelineLabel(entry.label),
                at: entry.at,
                tone: 'neutral' as const,
              })),
              ...orderTimelineEvents,
            ]}
            audience={audience}
            emptyMessage="No records available."
          />

          <article className="order-detail-card-v2 order-primary-action-card">
            <div className="order-card-heading">
              <div>
                <h2>Vendor actions</h2>
                <p>{hasTrackingSync ? 'Shipment information is available for this order.' : 'Add shipment details when the package is ready.'}</p>
              </div>
            </div>
            {canUseFulfillmentActions ? (
              <div className="action-row vendor-action-panel">
                {isRealMode ? (
                  <>
                    {hasTrackingSync || hasShipmentExecution ? (
                      <div className="tracking-summary-card order-tracking-summary-card">
                        {visibleShipmentExecution ? (
                          <>
                            <div className="summary-row">
                              <span>Shipment provider</span>
                              <strong>{toTitleCaseLabel(visibleShipmentExecution.provider)}</strong>
                            </div>
                            <div className="summary-row">
                              <span>Carrier status</span>
                              <strong>{toTitleCaseLabel(visibleShipmentExecution.shipmentStatus)}</strong>
                            </div>
                            {visibleShipmentExecution.warehouseId ? (
                              <div className="summary-row">
                                <span>Warehouse</span>
                                <strong>{visibleShipmentExecution.warehouseId}</strong>
                              </div>
                            ) : null}
                            <div className="summary-row">
                              <span>Provider id</span>
                              <strong className={visibleShipmentExecution.providerShipmentId ? '' : 'muted'}>
                                {visibleShipmentExecution.providerShipmentId ?? 'Pending'}
                              </strong>
                            </div>
                            <div className="summary-row">
                              <span>Barcode</span>
                              <strong className={visibleShipmentExecution.barcode ? '' : 'muted'}>
                                {visibleShipmentExecution.barcode ?? 'Pending'}
                              </strong>
                            </div>
                          </>
                        ) : null}
                        <div className="summary-row">
                          <span>Tracking</span>
                          <strong className={order.trackingNumber || visibleShipmentExecution?.trackingNumber ? '' : 'muted'}>
                            {order.trackingNumber ?? visibleShipmentExecution?.trackingNumber ?? 'Not available'}
                          </strong>
                        </div>
                        <div className="summary-row">
                          <span>Carrier</span>
                          <strong className={order.carrier ? '' : 'muted'}>{order.carrier ?? 'Not available'}</strong>
                        </div>
                        <div className="summary-row">
                          <span>Tracking link</span>
                          {order.trackingUrl || visibleShipmentExecution?.trackingUrl ? (
                            <a
                              className="inline-link"
                              href={(order.trackingUrl ?? visibleShipmentExecution?.trackingUrl) || undefined}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Open tracking
                            </a>
                          ) : (
                            <strong className="muted">Not available</strong>
                          )}
                        </div>
                        {visibleShipmentExecution?.labelUrl ? (
                          <div className="summary-row">
                            <span>Label</span>
                            <a className="inline-link" href={visibleShipmentExecution.labelUrl} target="_blank" rel="noreferrer">
                              Open label
                            </a>
                          </div>
                        ) : null}
                        {visibleShipmentExecution?.shippingCost ? (
                          <div className="summary-row">
                            <span>Shipping cost</span>
                            <strong>{formatCurrency(visibleShipmentExecution.shippingCost, visibleShipmentExecution.currency)}</strong>
                          </div>
                        ) : null}
                        {visibleShipmentExecution?.timeline?.length ? (
                          <div className="shipment-mini-timeline" aria-label="Shipment timeline">
                            {visibleShipmentExecution.timeline.map((event) => (
                              <div className="summary-row" key={`${event.label}-${event.at}`}>
                                <span>{event.label}</span>
                                <strong>{event.status ? `${toTitleCaseLabel(event.status)} · ` : ''}{formatOptionalDate(event.at)}</strong>
                              </div>
                            ))}
                          </div>
                        ) : null}
                        {canRefreshTryOtoShipmentStatus ? (
                          <div className="shipment-recovery-actions" aria-label="Try OTO shipment status refresh">
                            <strong>Try OTO status refresh</strong>
                            <span>Shipment was created, but tracking, barcode, or label details may still be processing.</span>
                            <div className="order-inline-actions">
                              <button
                                type="button"
                                className="button button-secondary"
                                disabled={isRefreshingShipmentStatus}
                                onClick={handleRefreshShipmentStatus}
                              >
                                {isRefreshingShipmentStatus ? 'Refreshing...' : 'Refresh shipment status'}
                              </button>
                            </div>
                          </div>
                        ) : null}
                        {shouldShowShipmentProviderSummary && shipmentProviderSummary ? (
                          <div id="provider-response-summary" className="provider-response-summary" aria-label="Provider response summary">
                            <div className="provider-response-heading">
                              <strong>Provider response summary</strong>
                              <span>Admin only</span>
                            </div>
                            <div className="summary-row">
                              <span>HTTP</span>
                              <strong>{shipmentProviderSummary.httpStatus ?? '—'}</strong>
                            </div>
                            <div className="summary-row">
                              <span>Provider request</span>
                              <strong>{shipmentProviderSummary.requestId || '—'}</strong>
                            </div>
                            <div className="summary-row">
                              <span>Content type</span>
                              <strong>{shipmentProviderSummary.contentType || '—'}</strong>
                            </div>
                            <div className="summary-row">
                              <span>Body type</span>
                              <strong>{shipmentProviderSummary.parsedBodyType || '—'}</strong>
                            </div>
                            <div className="summary-row">
                              <span>Detected format</span>
                              <strong>{shipmentProviderSummary.detectedResponseFormat || '—'}</strong>
                            </div>
                            <div className="summary-row">
                              <span>Auth/header mode</span>
                              <strong>{shipmentProviderSummary.authHeaderMode || '—'}</strong>
                            </div>
                            <div className="summary-row">
                              <span>Response keys</span>
                              <strong>{shipmentProviderSummary.responseKeys.length ? shipmentProviderSummary.responseKeys.join(', ') : '—'}</strong>
                            </div>
                            {renderShipmentPayloadDiagnostics(shipmentProviderSummary)}
                            {renderTryOtoFinalizationDiagnostics(shipmentProviderSummary)}
                            <div className="summary-row">
                              <span>Status field</span>
                              <strong>{shipmentProviderSummary.statusField || '—'}</strong>
                            </div>
                            <div className="summary-row">
                              <span>Provider message</span>
                              <strong>{shipmentProviderSummary.providerError || '—'}</strong>
                            </div>
                            {shipmentProviderSummary.providerValidationErrors.length ? (
                              <div className="summary-row">
                                <span>Validation errors</span>
                                <strong>{shipmentProviderSummary.providerValidationErrors.join(' · ')}</strong>
                              </div>
                            ) : null}
                            <div className="summary-row">
                              <span>Stored dry-run response</span>
                              <strong>{shipmentProviderSummary.dryRun === null ? '—' : shipmentProviderSummary.dryRun ? 'yes' : 'no'}</strong>
                            </div>
                            <div className="summary-row">
                              <span>Disabled gates at response time</span>
                              <strong>{shipmentProviderSummary.disabledGates.length ? shipmentProviderSummary.disabledGates.join(', ') : '—'}</strong>
                            </div>
                            <div className="summary-row">
                              <span>Provider id present</span>
                              <strong>{shipmentProviderSummary.providerShipmentIdPresent ? 'yes' : 'no'}</strong>
                            </div>
                            <div className="summary-row">
                              <span>Tracking present</span>
                              <strong>{shipmentProviderSummary.trackingNumberPresent ? 'yes' : 'no'}</strong>
                            </div>
                            <div className="summary-row">
                              <span>Label present</span>
                              <strong>{shipmentProviderSummary.labelPresent ? 'yes' : 'no'}</strong>
                            </div>
                            <div className="summary-row">
                              <span>Barcode present</span>
                              <strong>{shipmentProviderSummary.barcodePresent ? 'yes' : 'no'}</strong>
                            </div>
                            <div className="summary-row">
                              <span>Webhook URL included</span>
                              <strong>
                                {shipmentProviderSummary.notificationUrlIncluded === null
                                  ? '—'
                                  : shipmentProviderSummary.notificationUrlIncluded
                                    ? 'yes'
                                    : 'no'}
                              </strong>
                            </div>
                            {shipmentProviderSummary.responseSnippet ? (
                              <div className="summary-row">
                                <span>Safe response snippet</span>
                                <strong>{shipmentProviderSummary.responseSnippet}</strong>
                              </div>
                            ) : null}
                            {canRetryDryRunShipment ? (
                              <button
                                type="button"
                                className="button button-secondary"
                                disabled={isRetryingShipment}
                                onClick={handleRetryShipment}
                              >
                                {isRetryingShipment ? 'Retrying...' : 'Retry live shipment'}
                              </button>
                            ) : null}
                            {canRecoverFailedShipment ? (
                              <div className="shipment-recovery-actions">
                                <strong>Shipment recovery</strong>
                                <span>Provider execution failed before a shipment id or tracking was created.</span>
                                <div className="order-inline-actions">
                                  <button
                                    type="button"
                                    className="button button-primary"
                                    disabled={isRetryingFailedShipment}
                                    onClick={() => handleRetryFailedShipment()}
                                  >
                                    {isRetryingFailedShipment ? 'Retrying...' : 'Retry shipment'}
                                  </button>
                                  <button
                                    type="button"
                                    className="button button-secondary"
                                    disabled={isRetryingFailedShipment}
                                    onClick={() => handleRetryFailedShipment()}
                                  >
                                    Retry provider request
                                  </button>
                                  <button
                                    type="button"
                                    className="button button-secondary"
                                    disabled
                                    title="Reset is not available after a provider attempt; retry preserves duplicate shipment protections."
                                  >
                                    Reset failed execution
                                  </button>
                                  <a className="button button-secondary button-link" href="#provider-response-summary">
                                    View diagnostics
                                  </a>
                                </div>
                                {shouldShowRecoveryShipmentFieldCompletionForm ? renderShipmentFieldCompletionForm() : null}
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                        {shouldShowFailedShipmentRetryDiagnostics && (!shipmentProviderSummary || !isAdmin) ? (
                          <div id="shipment-retry-diagnostics" className="shipment-recovery-actions" aria-label="Shipment retry eligibility">
                            <strong>Shipment recovery</strong>
                            <span>
                              Retry eligible: {canRecoverFailedShipment ? 'yes' : 'no'}
                              {failedShipmentRetryBlockedReason ? ` · ${failedShipmentRetryBlockedReason}` : ''}
                            </span>
                            {canRecoverFailedShipment ? (
                              <div className="order-inline-actions">
                                <button
                                  type="button"
                                  className="button button-primary"
                                  disabled={isRetryingFailedShipment}
                                  onClick={() => handleRetryFailedShipment()}
                                >
                                  {isRetryingFailedShipment ? 'Retrying...' : 'Retry shipment'}
                                </button>
                                <a className="button button-secondary button-link" href="#shipment-retry-diagnostics">
                                  View diagnostics
                                </a>
                              </div>
                            ) : null}
                            {shouldShowRecoveryShipmentFieldCompletionForm ? renderShipmentFieldCompletionForm() : null}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    {!hasTrackingSync && !hasShipmentExecution ? (
                      <div className="detail-actions">
                        <button
                          type="button"
                          className="button button-primary"
                          disabled={isCreatingShipment}
                          onClick={() => handleCreateShipment()}
                        >
                          {isCreatingShipment ? 'Creating...' : 'Create shipment'}
                        </button>
                      </div>
                    ) : null}
                    {shipmentActionState ? (
                      <div className={`shipment-action-feedback action-feedback action-${shipmentActionState.tone}`} aria-live="polite">
                        <strong>{shipmentActionState.message}</strong>
                        <span>Endpoint: {shipmentActionState.endpoint ?? shipmentActionState.diagnostics?.endpoint ?? 'POST /shipments/create'}</span>
                        {shipmentActionState.diagnostics ? (
                          <span>
                            HTTP: {shipmentActionState.diagnostics.status ?? '—'}
                            {shipmentActionState.diagnostics.requestId ? ` · Request: ${shipmentActionState.diagnostics.requestId}` : ''}
                          </span>
                        ) : null}
                        {shipmentActionState.shipment ? (
                          <span>
                            Provider id: {shipmentActionState.shipment.providerShipmentId ? 'yes' : 'pending'} · Barcode:{' '}
                            {shipmentActionState.shipment.barcode ? 'yes' : 'pending'} · Tracking:{' '}
                            {shipmentActionState.shipment.trackingNumber ? 'yes' : 'pending'} · Label:{' '}
                            {shipmentActionState.shipment.labelUrl ? 'yes' : 'pending'}
                          </span>
                        ) : null}
                        {renderShipmentFieldCompletionForm()}
                      </div>
                    ) : null}
                    {shippingProviderDiagnostics && shippingConfigEditorForm ? (
                      <div className="shipping-provider-diagnostics" aria-label="Shipping provider diagnostics">
                        <div className="provider-response-heading">
                          <strong>Shipping provider diagnostics</strong>
                          <span>Admin only</span>
                        </div>
                        {shippingConfigEditorForm}
                        {shippingProviderDiagnostics.provider === 'try_oto' ? (
                          <div className="summary-row">
                            <span>Try OTO pickup location</span>
                            <strong>{tryOtoPickupLocationCode || '—'}</strong>
                          </div>
                        ) : (
                          <>
                            <div className="summary-row">
                              <span>Cargo integration configured</span>
                              <strong>{shippingProviderDiagnostics.cargoIntegrationIdConfigured ? 'yes' : 'no'}</strong>
                            </div>
                            <div className="summary-row">
                              <span>Warehouse configured</span>
                              <strong>{shippingProviderDiagnostics.warehouseIdConfigured ? 'yes' : 'no'}</strong>
                            </div>
                          </>
                        )}
                        <div className="summary-row">
                          <span>Default desi configured</span>
                          <strong>{shippingProviderDiagnostics.defaultDesiConfigured ? 'yes' : 'no'}</strong>
                        </div>
                        {shippingProviderDiagnostics.provider === 'kargo_entegrator' ? (
                          <div className="summary-row">
                            <span>Package type</span>
                            <strong>{shippingProviderDiagnostics.packageTypeUsed || '—'}</strong>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    {shouldShowRealTrackingForm ? (
                      <form
                        className="detail-actions tracking-form order-tracking-form"
                        onSubmit={(event) => {
                          event.preventDefault();

                          if (!order) {
                            return;
                          }

                          const normalizedTrackingNumber = trackingNumber.trim();
                          const normalizedCarrier = carrier.trim();
                          const normalizedTrackingUrl = trackingUrl.trim();

                          if (!normalizedCarrier) {
                            showFeedback('Carrier is required before submitting tracking.', 'error');
                            return;
                          }

                          if (!normalizedTrackingNumber) {
                            showFeedback('Tracking number is required before submitting tracking.', 'error');
                            return;
                          }

                          void submitTrackingMutation({
                            allocationId: order.id,
                            trackingNumber: normalizedTrackingNumber,
                            carrier: normalizedCarrier,
                            trackingUrl: normalizedTrackingUrl || undefined,
                            notifyCustomer,
                          })
                            .then((result) => {
                              showFeedback(
                                `Tracking ${result.trackingNumber} submitted. Shipping status: ${result.shippingStatus}.`,
                                'success',
                              );
                            })
                            .catch((mutationError) => {
                              showFeedback(getTrackingMutationErrorMessage(mutationError), 'error');
                            });
                        }}
                      >
                        <label className="field">
                          <span>Carrier</span>
                          <input
                            value={carrier}
                            onChange={(event) => setCarrier(event.target.value)}
                            placeholder="Yurtiçi Kargo"
                            disabled={isSubmittingTracking}
                          />
                        </label>
                        <label className="field">
                          <span>Tracking number</span>
                          <input
                            value={trackingNumber}
                            onChange={(event) => setTrackingNumber(event.target.value)}
                            placeholder="TRACK123"
                            disabled={isSubmittingTracking}
                          />
                        </label>
                        <label className="field">
                          <span>Tracking URL (optional)</span>
                          <input
                            value={trackingUrl}
                            onChange={(event) => setTrackingUrl(event.target.value)}
                            placeholder="https://tracking.example/TRACK123"
                            disabled={isSubmittingTracking}
                          />
                        </label>
                        <label className="checkbox-field">
                          <input
                            type="checkbox"
                            checked={notifyCustomer}
                            onChange={(event) => setNotifyCustomer(event.target.checked)}
                            disabled={isSubmittingTracking}
                          />
                          <span>Notify customer</span>
                        </label>
                        <button type="submit" className="button button-primary" disabled={isSubmittingTracking}>
                          {isSubmittingTracking ? 'Submitting...' : 'Add tracking information'}
                        </button>
                      </form>
                    ) : null}
                  </>
                ) : (
                  <div className="detail-actions order-inline-actions">
                    <button
                      type="button"
                      className="button button-primary"
                      disabled={isRunningFulfillmentAction}
                      onClick={() => {
                        if (!order) {
                          return;
                        }

                        void runFulfillmentAction({ orderId: order.id, action: 'label' })
                          .then(() => showFeedback('Shipping label creation requested (mock).', 'success'))
                          .catch(() => showFeedback('Unable to create shipping label right now.', 'error'));
                      }}
                    >
                      Create shipment
                    </button>
                    <button
                      type="button"
                      className="button button-secondary"
                      disabled={isRunningFulfillmentAction}
                      onClick={() => {
                        if (!order) {
                          return;
                        }

                        void runFulfillmentAction({ orderId: order.id, action: 'tracking' })
                          .then(() => showFeedback('Tracking update submitted (mock).', 'success'))
                          .catch(() => showFeedback('Unable to update tracking right now.', 'error'));
                      }}
                    >
                      Add tracking information
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="action-row vendor-blocked-panel">
                {isAdmin && shipmentExecution ? (
                  <div className="tracking-summary-card order-tracking-summary-card">
                    <div className="summary-row">
                      <span>Shipment provider</span>
                      <strong>{toTitleCaseLabel(shipmentExecution.provider)}</strong>
                    </div>
                    <div className="summary-row">
                      <span>Carrier status</span>
                      <strong>{toTitleCaseLabel(shipmentExecution.shipmentStatus)}</strong>
                    </div>
                    {shipmentExecution.warehouseId ? (
                      <div className="summary-row">
                        <span>Warehouse</span>
                        <strong>{shipmentExecution.warehouseId}</strong>
                      </div>
                    ) : null}
                    <div className="summary-row">
                      <span>Tracking</span>
                      <strong className={order.trackingNumber || shipmentExecution.trackingNumber ? '' : 'muted'}>
                        {order.trackingNumber ?? shipmentExecution.trackingNumber ?? 'Not available'}
                      </strong>
                    </div>
                    <div className="summary-row">
                      <span>Carrier</span>
                      <strong className={order.carrier ? '' : 'muted'}>{order.carrier ?? 'Not available'}</strong>
                    </div>
                    {canRefreshTryOtoShipmentStatus ? (
                      <div className="shipment-recovery-actions" aria-label="Try OTO shipment status refresh">
                        <strong>Try OTO status refresh</strong>
                        <span>Shipment was created, but tracking, barcode, or label details may still be processing.</span>
                        <div className="order-inline-actions">
                          <button
                            type="button"
                            className="button button-secondary"
                            disabled={isRefreshingShipmentStatus}
                            onClick={handleRefreshShipmentStatus}
                          >
                            {isRefreshingShipmentStatus ? 'Refreshing...' : 'Refresh shipment status'}
                          </button>
                        </div>
                      </div>
                    ) : null}
                    {shouldShowShipmentProviderSummary && shipmentProviderSummary ? (
                      <div id="provider-response-summary" className="provider-response-summary" aria-label="Provider response summary">
                        <div className="provider-response-heading">
                          <strong>Provider response summary</strong>
                          <span>Admin only</span>
                        </div>
                        <div className="summary-row">
                          <span>HTTP</span>
                          <strong>{shipmentProviderSummary.httpStatus ?? '—'}</strong>
                        </div>
                        <div className="summary-row">
                          <span>Content type</span>
                          <strong>{shipmentProviderSummary.contentType || '—'}</strong>
                        </div>
                        <div className="summary-row">
                          <span>Body type</span>
                          <strong>{shipmentProviderSummary.parsedBodyType || '—'}</strong>
                        </div>
                        <div className="summary-row">
                          <span>Detected format</span>
                          <strong>{shipmentProviderSummary.detectedResponseFormat || '—'}</strong>
                        </div>
                        <div className="summary-row">
                          <span>Auth/header mode</span>
                          <strong>{shipmentProviderSummary.authHeaderMode || '—'}</strong>
                        </div>
                        <div className="summary-row">
                          <span>Response keys</span>
                          <strong>{shipmentProviderSummary.responseKeys.length ? shipmentProviderSummary.responseKeys.join(', ') : '—'}</strong>
                        </div>
                        {renderShipmentPayloadDiagnostics(shipmentProviderSummary)}
                        {renderTryOtoFinalizationDiagnostics(shipmentProviderSummary)}
                        <div className="summary-row">
                          <span>Status field</span>
                          <strong>{shipmentProviderSummary.statusField || '—'}</strong>
                        </div>
                        <div className="summary-row">
                          <span>Provider message</span>
                          <strong>{shipmentProviderSummary.providerError || '—'}</strong>
                        </div>
                        <div className="summary-row">
                          <span>Stored dry-run response</span>
                          <strong>{shipmentProviderSummary.dryRun === null ? '—' : shipmentProviderSummary.dryRun ? 'yes' : 'no'}</strong>
                        </div>
                        <div className="summary-row">
                          <span>Disabled gates at response time</span>
                          <strong>{shipmentProviderSummary.disabledGates.length ? shipmentProviderSummary.disabledGates.join(', ') : '—'}</strong>
                        </div>
                        <div className="summary-row">
                          <span>Provider id present</span>
                          <strong>{shipmentProviderSummary.providerShipmentIdPresent ? 'yes' : 'no'}</strong>
                        </div>
                        <div className="summary-row">
                          <span>Tracking present</span>
                          <strong>{shipmentProviderSummary.trackingNumberPresent ? 'yes' : 'no'}</strong>
                        </div>
                        <div className="summary-row">
                          <span>Label present</span>
                          <strong>{shipmentProviderSummary.labelPresent ? 'yes' : 'no'}</strong>
                        </div>
                        {shipmentProviderSummary.responseSnippet ? (
                          <div className="summary-row">
                            <span>Safe response snippet</span>
                            <strong>{shipmentProviderSummary.responseSnippet}</strong>
                          </div>
                        ) : null}
                        {canRetryDryRunShipment ? (
                          <button
                            type="button"
                            className="button button-secondary"
                            disabled={isRetryingShipment}
                            onClick={handleRetryShipment}
                          >
                            {isRetryingShipment ? 'Retrying...' : 'Retry live shipment'}
                          </button>
                        ) : null}
                        {canRecoverFailedShipment ? (
                          <div className="shipment-recovery-actions">
                            <strong>Shipment recovery</strong>
                            <span>Provider execution failed before a shipment id or tracking was created.</span>
                            <div className="order-inline-actions">
                              <button
                                type="button"
                                className="button button-primary"
                                disabled={isRetryingFailedShipment}
                                onClick={() => handleRetryFailedShipment()}
                              >
                                {isRetryingFailedShipment ? 'Retrying...' : 'Retry shipment'}
                              </button>
                              <button
                                type="button"
                                className="button button-secondary"
                                disabled={isRetryingFailedShipment}
                                onClick={() => handleRetryFailedShipment()}
                              >
                                Retry provider request
                              </button>
                              <button
                                type="button"
                                className="button button-secondary"
                                disabled
                                title="Reset is not available after a provider attempt; retry preserves duplicate shipment protections."
                              >
                                Reset failed execution
                              </button>
                              <a className="button button-secondary button-link" href="#provider-response-summary">
                                View diagnostics
                              </a>
                            </div>
                            {shouldShowRecoveryShipmentFieldCompletionForm ? renderShipmentFieldCompletionForm() : null}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    {shouldShowFailedShipmentRetryDiagnostics && (!shipmentProviderSummary || !isAdmin) ? (
                      <div id="shipment-retry-diagnostics" className="shipment-recovery-actions" aria-label="Shipment retry eligibility">
                        <strong>Shipment recovery</strong>
                        <span>
                          Retry eligible: {canRecoverFailedShipment ? 'yes' : 'no'}
                          {failedShipmentRetryBlockedReason ? ` · ${failedShipmentRetryBlockedReason}` : ''}
                        </span>
                        {canRecoverFailedShipment ? (
                          <div className="order-inline-actions">
                            <button
                              type="button"
                              className="button button-primary"
                              disabled={isRetryingFailedShipment}
                              onClick={() => handleRetryFailedShipment()}
                            >
                              {isRetryingFailedShipment ? 'Retrying...' : 'Retry shipment'}
                            </button>
                            <a className="button button-secondary button-link" href="#shipment-retry-diagnostics">
                              View diagnostics
                            </a>
                          </div>
                        ) : null}
                        {shouldShowRecoveryShipmentFieldCompletionForm ? renderShipmentFieldCompletionForm() : null}
                      </div>
                    ) : null}
                    {shipmentActionState ? (
                      <div className={`shipment-action-feedback action-feedback action-${shipmentActionState.tone}`} aria-live="polite">
                        <strong>{shipmentActionState.message}</strong>
                        <span>Endpoint: {shipmentActionState.endpoint ?? shipmentActionState.diagnostics?.endpoint ?? 'POST /shipments/create'}</span>
                        {shipmentActionState.diagnostics ? (
                          <span>
                            HTTP: {shipmentActionState.diagnostics.status ?? '—'}
                            {shipmentActionState.diagnostics.requestId ? ` · Request: ${shipmentActionState.diagnostics.requestId}` : ''}
                          </span>
                        ) : null}
                        {shipmentActionState.shipment ? (
                          <span>
                            Provider id: {shipmentActionState.shipment.providerShipmentId ? 'yes' : 'pending'} · Barcode:{' '}
                            {shipmentActionState.shipment.barcode ? 'yes' : 'pending'} · Tracking:{' '}
                            {shipmentActionState.shipment.trackingNumber ? 'yes' : 'pending'} · Label:{' '}
                            {shipmentActionState.shipment.labelUrl ? 'yes' : 'pending'}
                          </span>
                        ) : null}
                        {renderShipmentFieldCompletionForm()}
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {isAdmin && shippingProviderDiagnostics ? (
                  <div className="shipping-provider-diagnostics" aria-label="Shipping provider diagnostics">
                    <div className="provider-response-heading">
                      <strong>Shipping provider diagnostics</strong>
                      <span>Admin only</span>
                    </div>
                    {shippingConfigEditorForm}
                    <div className="summary-row">
                      <span>Sandbox mode</span>
                      <strong>{shippingProviderDiagnostics.sandboxModeEnabled ? 'yes' : 'no'}</strong>
                    </div>
                    <div className="summary-row">
                      <span>Shipping execution enabled</span>
                      <strong>{shippingProviderDiagnostics.shippingExecutionEnabled ? 'yes' : 'no'}</strong>
                    </div>
                    <div className="summary-row">
                      <span>Provider selected</span>
                      <strong>{shippingProviderDiagnostics.providerSelected ? 'yes' : 'no'}</strong>
                    </div>
                    <div className="summary-row">
                      <span>Provider enabled</span>
                      <strong>{shippingProviderDiagnostics.providerEnabled ? 'yes' : 'no'}</strong>
                    </div>
                    <div className="summary-row">
                      <span>Webhook ingest enabled</span>
                      <strong>{shippingProviderDiagnostics.webhookIngestEnabled ? 'yes' : 'no'}</strong>
                    </div>
                    <div className="summary-row">
                      <span>Base URL configured</span>
                      <strong>{shippingProviderDiagnostics.baseUrlConfigured ? 'yes' : 'no'}</strong>
                    </div>
                    <div className="summary-row">
                      <span>API key configured</span>
                      <strong>{shippingProviderDiagnostics.apiKeyConfigured ? 'yes' : 'no'}</strong>
                    </div>
                    {shippingProviderDiagnostics.provider === 'try_oto' ? (
                      <div className="summary-row">
                        <span>Try OTO pickup location</span>
                        <strong>{tryOtoPickupLocationCode || '—'}</strong>
                      </div>
                    ) : (
                      <>
                        <div className="summary-row">
                          <span>Cargo integration configured</span>
                          <strong>{shippingProviderDiagnostics.cargoIntegrationIdConfigured ? 'yes' : 'no'}</strong>
                        </div>
                        <div className="summary-row">
                          <span>Warehouse configured</span>
                          <strong>{shippingProviderDiagnostics.warehouseIdConfigured ? 'yes' : 'no'}</strong>
                        </div>
                      </>
                    )}
                    <div className="summary-row">
                      <span>Default desi configured</span>
                      <strong>{shippingProviderDiagnostics.defaultDesiConfigured ? 'yes' : 'no'}</strong>
                    </div>
                    {shippingProviderDiagnostics.provider === 'kargo_entegrator' ? (
                      <div className="summary-row">
                        <span>Package type</span>
                        <strong>{shippingProviderDiagnostics.packageTypeUsed || '—'}</strong>
                      </div>
                    ) : null}
                    <div className="summary-row">
                      <span>Notification URL configured</span>
                      <strong>{shippingProviderDiagnostics.notificationUrlConfigured ? 'yes' : 'no'}</strong>
                    </div>
                    <div className="summary-row">
                      <span>Webhook route implemented</span>
                      <strong>{shippingProviderDiagnostics.webhookRouteImplemented ? 'yes' : 'no'}</strong>
                    </div>
                    <div className="summary-row">
                      <span>Receiver address availability</span>
                      <strong>
                        {shippingProviderDiagnostics.receiverAddressAvailability === 'confirmed_required'
                          ? 'confirmed required'
                          : 'unknown / required'}
                      </strong>
                    </div>
                    {shippingProviderDiagnostics.provider === 'kargo_entegrator' ? (
                      <div className="summary-row">
                        <span>Dummy Kargo support</span>
                        <strong>{shippingProviderDiagnostics.dummyKargoSupport === 'available' ? 'available' : 'not enabled'}</strong>
                      </div>
                    ) : null}
                    <div className="summary-row">
                      <span>Status sync support</span>
                      <strong>{shippingProviderDiagnostics.statusSyncSupport === 'not_implemented' ? 'not implemented' : '—'}</strong>
                    </div>
                    <div className="summary-row">
                      <span>Missing env names</span>
                      <strong>{shippingProviderDiagnostics.missing.length ? shippingProviderDiagnostics.missing.join(', ') : '—'}</strong>
                    </div>
                    <div className="summary-row">
                      <span>Deprecated env fallback</span>
                      <strong>
                        {shippingProviderDiagnostics.deprecatedEnvFallbacks?.length
                          ? shippingProviderDiagnostics.deprecatedEnvFallbacks.join(', ')
                          : '—'}
                      </strong>
                    </div>
                    {shippingProviderDiagnostics.warnings?.length ? (
                      <div className="summary-row">
                        <span>Readiness warnings</span>
                        <strong>{shippingProviderDiagnostics.warnings.join(' · ')}</strong>
                      </div>
                    ) : null}
                  </div>
                ) : null}
                <p className="page-description">
                  Shipping actions are currently unavailable.
                  {order.cancellationReason ? ` Reason: ${order.cancellationReason.replace(/_/g, ' ')}.` : ''}
                </p>
                {isVendorAssignedOwner ? (
                  <div className="detail-actions">
                    <button
                      type="button"
                      className="button button-secondary"
                      onClick={() => setSupportOpen(true)}
                      disabled={!canReportIssue}
                    >
                      Contact support
                    </button>
                  </div>
                ) : null}
              </div>
            )}
          </article>
        </aside>
      </div>

      {message ? <ActionFeedback tone={tone} message={message} /> : null}
      {order ? (
        <SupportTicketModal
          open={supportOpen}
          contextType="order"
          contextId={order.id}
          contextSnapshot={supportSnapshot}
          defaultSubject={`Help with order ${formatShopifyOrderNumber(order.sourceShopifyOrderNumber)}`}
          onClose={() => setSupportOpen(false)}
          onCreated={() => showFeedback('Support ticket created.', 'success')}
        />
      ) : null}
    </section>
  );
}
