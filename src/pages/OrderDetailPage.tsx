import { Link, useLocation, useParams } from 'react-router-dom';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { DataStatePanel } from '../components/DataStatePanel';
import { ActionFeedback } from '../components/ActionFeedback';
import { queryKeys } from '../lib/api/queryKeys';
import { useQueryResource } from '../hooks/useQueryResource';
import {
  createReturnShipmentLabel,
  createShipmentExecution,
  getOrder,
  getShippingProviderDiagnostics,
  getVendorShippingConfig,
  probeShopifyReturnLabelUpload,
  probeTryOtoReturnAwbPrint,
  probeTryOtoReturnDetails,
  probeTryOtoReturnLink,
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
import { AdminCollaborationNotes } from '../components/AdminCollaborationNotes';
import { getApiErrorDiagnostics, type ApiErrorDiagnostics } from '../lib/api/errors';
import {
  sameOperationalOrderNumber,
  supportTicketMatchesOrder,
  type OperationalEventInput,
  type OperationalLinkInput,
} from '../lib/operationalCrossLinks';
import { sameShopifyIdentifier } from '../lib/shopifyIdentifiers';
import { formatShippingProviderName, formatTrackingCarrierLabel } from '../lib/shippingDisplay';

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

  if (
    !normalized ||
    normalized.toLowerCase().includes('outside the current') ||
    normalized.toLowerCase().includes('available in order') ||
    normalized.toLowerCase().includes('customer unavailable')
  ) {
    return 'Customer hidden for vendor scope';
  }

  return normalized;
}

function groupOrderDetailTimelineEvents(events: OperationalEventInput[]) {
  const grouped: OperationalEventInput[] = [];
  const seenGroupedEvents = new Set<string>();

  events.forEach((event) => {
    const normalizedTitle = event.title.toLowerCase();
    const isNoisyShipmentEvent =
      normalizedTitle.includes('order') ||
      normalizedTitle.includes('webhook') ||
      normalizedTitle.includes('tracking') ||
      normalizedTitle.includes('shipment') ||
      normalizedTitle.includes('delivered') ||
      normalizedTitle.includes('return') ||
      normalizedTitle.includes('status');
    const eventDay = event.at ? new Date(event.at).toISOString().slice(0, 10) : 'unknown';
    const eventKey = [normalizedTitle, event.status?.toLowerCase() ?? '', eventDay].join('|');

    if (isNoisyShipmentEvent && seenGroupedEvents.has(eventKey)) {
      return;
    }

    if (isNoisyShipmentEvent) {
      seenGroupedEvents.add(eventKey);
    }
    grouped.push(event);
  });

  return grouped;
}

function getStatusClass(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function getTrackingTitle(order: { trackingNumber?: string; carrier?: string; trackingUrl?: string }) {
  return order.trackingNumber || order.carrier || order.trackingUrl ? 'Tracking Synced' : 'Missing Tracking';
}

function getTrackingHelper(order: { trackingNumber?: string; carrier?: string; trackingUrl?: string }) {
  const carrier = formatTrackingCarrierLabel(order.carrier);
  if (order.trackingNumber || carrier) {
    return [carrier, order.trackingNumber].filter(Boolean).join(' / ');
  }

  if (order.trackingUrl) {
    return 'Tracking link available';
  }

  return 'No tracking information available.';
}

function getShipmentTrackingNumber(order: { trackingNumber?: string | null }, shipment?: ShipmentExecution | null) {
  return order.trackingNumber ?? shipment?.trackingNumber ?? null;
}

function getShipmentTrackingUrl(order: { trackingUrl?: string | null }, shipment?: ShipmentExecution | null) {
  return order.trackingUrl ?? shipment?.trackingUrl ?? null;
}

function getShipmentBarcodeDisplay(shipment?: ShipmentExecution | null, trackingNumber?: string | null) {
  if (shipment?.barcode) {
    return shipment.barcode;
  }
  if (trackingNumber) {
    return 'Same as tracking';
  }
  return 'Pending';
}

function getShipmentEvidenceSummary(shipment: ShipmentExecution) {
  return [
    `Provider id: ${shipment.providerShipmentId ? 'yes' : 'pending'}`,
    `Barcode: ${shipment.barcode ? 'yes' : shipment.trackingNumber ? 'same as tracking' : 'pending'}`,
    `Tracking: ${shipment.trackingNumber ? 'yes' : 'pending'}`,
    `Label: ${shipment.labelUrl ? 'yes' : 'pending'}`,
  ].join(' · ');
}

function getReturnShipmentEvidenceSummary(shipment: ShipmentExecution) {
  const returnShipment = shipment.returnShipment;
  if (!returnShipment) {
    return getShipmentEvidenceSummary(shipment);
  }

  return [
    `Return provider id: ${returnShipment.returnOrderId ? 'yes' : 'pending'}`,
    `Return barcode: ${returnShipment.barcode ? 'yes' : returnShipment.trackingNumber ? 'same as tracking' : 'pending'}`,
    `Return tracking: ${returnShipment.trackingNumber ? 'yes' : 'pending'}`,
    `Return label: ${returnShipment.labelUrl ? 'yes' : 'pending'}`,
  ].join(' · ');
}

function isReturnShipmentActionEndpoint(endpoint?: string | null) {
  return Boolean(
    endpoint &&
      (endpoint.includes('/create-return') ||
        endpoint.includes('/probe-try-oto-return-awb-print') ||
        endpoint.includes('/probe-try-oto-return-details') ||
        endpoint.includes('/probe-try-oto-return-link') ||
        endpoint.includes('/probe-shopify-return-label')),
  );
}

function getShipmentActionEvidenceSummary(actionState: ShipmentActionState) {
  if (!actionState.shipment) {
    return null;
  }

  return isReturnShipmentActionEndpoint(actionState.endpoint)
    ? getReturnShipmentEvidenceSummary(actionState.shipment)
    : getShipmentEvidenceSummary(actionState.shipment);
}

function getVendorShipmentActionMessage(actionState: ShipmentActionState) {
  if (actionState.tone === 'success') {
    return isReturnShipmentActionEndpoint(actionState.endpoint)
      ? 'Return shipment action completed.'
      : 'Shipment action completed.';
  }

  if (actionState.tone === 'error') {
    const missingFields = getMissingShipmentCustomerFields(actionState.message);
    if (missingFields.length) {
      return 'Complete the missing shipment fields to continue.';
    }

    return isReturnShipmentActionEndpoint(actionState.endpoint)
      ? 'Return shipment action needs attention.'
      : 'Shipment action needs attention.';
  }

  return actionState.message.toLowerCase().includes('refresh')
    ? 'Refreshing shipment status.'
    : 'Shipment action is in progress.';
}

function getTryOtoReturnStatusLabel(returnShipment: NonNullable<ShipmentExecution['returnShipment']>) {
  if (returnShipment.status === 'skipped') {
    return returnShipment.labelRetrievalNote ?? 'Try OTO return shipment was not created.';
  }

  const normalizedStatus = returnShipment.status?.trim().toLowerCase() ?? '';
  if (normalizedStatus === 'newreturn' || normalizedStatus === 'request_created') {
    return 'Return created';
  }

  if (normalizedStatus === 'reverseshipmentprocessing') {
    return 'Return shipment processing';
  }

  if (normalizedStatus === 'reversereturned') {
    return 'Returned';
  }

  if (!returnShipment.finalized && !returnShipment.labelRetrievable) {
    return 'Return created';
  }

  if (returnShipment.finalized && (!normalizedStatus || normalizedStatus === 'created' || normalizedStatus === 'finalized')) {
    return 'Return shipment finalized';
  }

  if (returnShipment.status) {
    return toTitleCaseLabel(returnShipment.status);
  }

  return 'Return shipment created';
}

function getOperationalShipmentStatusLabel(status?: string | null) {
  const normalizedStatus = status?.trim().toLowerCase() ?? '';

  if (!normalizedStatus) {
    return 'Shipment status pending';
  }
  if (normalizedStatus === 'searchingdriver' || normalizedStatus === 'carrier_processing' || normalizedStatus === 'processing') {
    return 'Shipment processing';
  }
  if (normalizedStatus === 'created' || normalizedStatus === 'pending') {
    return 'Shipment created';
  }
  if (normalizedStatus === 'delivered' || normalizedStatus === 'completed') {
    return 'Delivered';
  }
  if (normalizedStatus === 'failed') {
    return 'Needs review';
  }

  return toTitleCaseLabel(status ?? '');
}

function isRawProviderTimelineLabel(label: string) {
  const normalized = label.toLowerCase();
  return (
    normalized.includes('webhook') ||
    normalized.includes('provider') ||
    normalized.includes('payload') ||
    normalized.includes('reverse') ||
    normalized.includes('searchingdriver') ||
    normalized.includes('provider validation') ||
    normalized.includes('try oto') ||
    normalized.includes('malformed') ||
    normalized.includes('status updated')
  );
}

function getNativeTimelineVisibility(label: string) {
  const normalized = label.toLowerCase();

  if (isRawProviderTimelineLabel(label)) {
    return 'admin' as const;
  }

  const vendorOperationalEvent =
    normalized.includes('order created') ||
    normalized.includes('order received') ||
    normalized.includes('shipment created') ||
    normalized.includes('tracking synced') ||
    normalized.includes('tracking added') ||
    normalized.includes('delivered') ||
    normalized.includes('return requested') ||
    (normalized.includes('return') && normalized.includes('tracking')) ||
    (normalized.includes('support ticket') &&
      (normalized.includes('created') ||
        normalized.includes('opened') ||
        normalized.includes('resolved') ||
        normalized.includes('closed')));

  return vendorOperationalEvent ? undefined : ('admin' as const);
}

function getTryOtoReturnPendingLabel(returnShipment: NonNullable<ShipmentExecution['returnShipment']>) {
  if (
    returnShipment.labelRetrievalNote &&
    !returnShipment.labelRetrievalNote.toLowerCase().includes('waiting for try oto return shipment details')
  ) {
    return returnShipment.labelRetrievalNote;
  }

  if ((returnShipment.trackingNumber || returnShipment.barcode || returnShipment.trackingUrl) && !returnShipment.labelUrl) {
    return 'Use this return tracking code/link for return shipment. Printable return label unavailable.';
  }

  return (
    returnShipment.finalized
      ? 'Return shipment created. Printable return label unavailable.'
      : 'Return created. Return tracking code will appear here when available.'
  );
}

function TryOtoReturnAwbPrintProbeSummary({
  returnShipment,
}: {
  returnShipment: NonNullable<ShipmentExecution['returnShipment']>;
}) {
  const probe = returnShipment.awbPrintProbe;
  if (!probe) {
    return null;
  }

  return (
    <details className="provider-response-summary admin-diagnostics-panel" aria-label="Try OTO return AWB print probe">
      <summary className="provider-response-heading">
        <strong>Try OTO return AWB print probe</strong>
        <span>Return diagnostics</span>
      </summary>
      <div className="summary-row">
        <span>HTTP</span>
        <strong>{probe.httpStatus ?? '—'}</strong>
      </div>
      <div className="summary-row">
        <span>Label/PDF/URL</span>
        <strong>{probe.labelUrlPresent || probe.pdfLikeFieldsPresent || probe.urlLikeFieldsPresent ? 'present' : 'missing'}</strong>
      </div>
      <div className="summary-row">
        <span>Tracking/barcode</span>
        <strong>{probe.trackingPresent || probe.barcodePresent ? 'present' : 'missing'}</strong>
      </div>
      <div className="summary-row">
        <span>Provider message</span>
        <strong>{probe.providerMessage ?? probe.errorMessage ?? '—'}</strong>
      </div>
    </details>
  );
}

function isInternalShipmentReference(value?: string | null) {
  const normalized = value?.trim().toLowerCase() ?? '';
  return Boolean(normalized && normalized.startsWith('shopify-') && normalized.includes('-allocation-'));
}

function formatShipmentReference(value?: string | null) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return 'Pending';
  }
  if (!isInternalShipmentReference(trimmed) || trimmed.length <= 36) {
    return trimmed;
  }
  return `${trimmed.slice(0, 24)}...${trimmed.slice(-10)}`;
}

function getShipmentReferenceLabel(shipment?: ShipmentExecution | null) {
  return isInternalShipmentReference(shipment?.providerShipmentId) ? 'Internal reference' : 'Provider ID';
}

function getShopifyFulfillmentSyncSummary(order: OrderDetail, shipment?: ShipmentExecution | null) {
  const sync = order.shopifyFulfillmentSync;
  const trackingPresent = Boolean(
    order.trackingNumber ||
      order.carrier ||
      order.trackingUrl ||
      shipment?.trackingNumber ||
      shipment?.trackingUrl,
  );
  const status = sync?.status ?? (trackingPresent ? 'pending' : 'not_available');
  const fulfillmentIdPresent = sync?.fulfillmentIdPresent ?? false;
  const localTrackingWithoutShopifyFulfillment = trackingPresent && !fulfillmentIdPresent;

  if (status === 'synced' && fulfillmentIdPresent) {
    return {
      label: 'Synced',
      tone: 'success',
      message: 'Shopify fulfillment is confirmed.',
      localTrackingWithoutShopifyFulfillment: false,
    };
  }

  if (status === 'failed') {
    return {
      label: 'Failed',
      tone: 'error',
      message: 'Shopify fulfillment sync failed. Admin diagnostics include the safe error summary.',
      localTrackingWithoutShopifyFulfillment,
    };
  }

  if (localTrackingWithoutShopifyFulfillment) {
    return {
      label: 'Pending',
      tone: 'warning',
      message: 'Tracking is stored locally, but Shopify fulfillment has not been confirmed.',
      localTrackingWithoutShopifyFulfillment: true,
    };
  }

  return {
    label: 'Not available',
    tone: 'muted',
    message: 'Tracking is not ready for Shopify fulfillment sync yet.',
    localTrackingWithoutShopifyFulfillment: false,
  };
}

function ShopifyReturnSignalDiagnostics({ order, isAdmin }: { order: OrderDetail; isAdmin: boolean }) {
  const signal = order.shopifyReturnSignal;
  if (!isAdmin || !signal) {
    return null;
  }

  return (
    <details className="provider-response-summary admin-diagnostics-panel" aria-label="Shopify return signal diagnostics">
      <summary className="provider-response-heading">
        <strong>Shopify return signal discovery</strong>
        <span>Shopify sync diagnostics</span>
      </summary>
      <div className="summary-row">
        <span>Topic</span>
        <strong>{signal.topic}</strong>
      </div>
      <div className="summary-row">
        <span>Received</span>
        <strong>{formatOptionalDate(signal.receivedAt)}</strong>
      </div>
      <div className="summary-row">
        <span>Matched by</span>
        <strong>{signal.matchedByField || '—'}</strong>
      </div>
      <div className="summary-row">
        <span>Return id present</span>
        <strong>{signal.returnIdPresent ? 'yes' : 'no'}</strong>
      </div>
      <div className="summary-row">
        <span>Line item ids present</span>
        <strong>{signal.lineItemIdsPresent ? 'yes' : 'no'}</strong>
      </div>
      <div className="summary-row">
        <span>Payload keys</span>
        <strong>{signal.topLevelPayloadKeys.length ? signal.topLevelPayloadKeys.join(', ') : '—'}</strong>
      </div>
    </details>
  );
}

function formatShopifyCarrierForShipment(shipment?: ShipmentExecution | null, fallbackCarrier?: string | null) {
  const providerCarrierName = shipment?.providerCarrierName?.trim();
  if (shipment?.provider === 'try_oto') {
    if (providerCarrierName && /s[üu]rat/i.test(providerCarrierName)) {
      return 'Sürat Kargo';
    }
    const fallback = fallbackCarrier?.trim();
    return providerCarrierName || (fallback && fallback.toLowerCase() !== 'try_oto' ? formatShippingProviderName(fallback) : 'Try OTO');
  }

  return fallbackCarrier?.trim() || (shipment ? formatShippingProviderName(shipment.provider) : '');
}

type ShippingConfigDraft = {
  preferredProvider: ShippingProvider;
  cargoIntegrationId: string;
  defaultWarehouseId: string;
  defaultDesi: string;
  packageType: 'box' | 'document';
  tryOtoPickupLocationCode: string;
  tryOtoOriginCity: string;
};

const TRY_OTO_AUTO_REFRESH_DELAYS_MS = [30_000, 90_000, 180_000] as const;

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

function readTryOtoOriginCity(config?: VendorShippingConfig | null) {
  const metadata = isRecord(config?.providerMetadata) ? config.providerMetadata : {};
  const raw = metadata.tryOtoOriginCity ?? metadata.originCity ?? metadata.origin_city ?? metadata.pickupCity ?? metadata.pickup_city;
  return typeof raw === 'string' ? raw : '';
}

function buildSupportCorrelationId(orderId: string, shipmentId?: string | null) {
  return ['support', orderId, shipmentId].filter(Boolean).join(':');
}

function compactDiagnosticsValue(value: unknown) {
  if (value === null || value === undefined || value === '') {
    return '—';
  }
  if (typeof value === 'boolean') {
    return value ? 'yes' : 'no';
  }
  if (Array.isArray(value)) {
    return value.length ? value.join(', ') : '—';
  }
  return String(value);
}

function buildDiagnosticsCopyText(title: string, entries: Array<[string, unknown]>) {
  return [
    title,
    ...entries.map(([label, value]) => `${label}: ${compactDiagnosticsValue(value)}`),
  ].join('\n');
}

function buildShippingConfigDraft(config?: VendorShippingConfig | null): ShippingConfigDraft {
  return {
    preferredProvider: config?.preferredProvider ?? 'kargo_entegrator',
    cargoIntegrationId: config?.cargoIntegrationId ?? '',
    defaultWarehouseId: config?.defaultWarehouseId ?? config?.warehouses.find((warehouse) => warehouse.isDefault)?.warehouseId ?? '',
    defaultDesi: config?.defaultDesi ?? '3.00',
    packageType: readPackageType(config),
    tryOtoPickupLocationCode: readTryOtoPickupLocationCode(config),
    tryOtoOriginCity: readTryOtoOriginCity(config),
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
  if (draft.preferredProvider === 'try_oto' && !draft.tryOtoOriginCity.trim()) {
    errors.push('Try OTO origin city is required.');
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

  if (normalized.includes('shopify') && normalized.includes('return') && normalized.includes('tracking')) {
    return 'Shopify return tracking synced';
  }
  if (normalized.includes('return') && normalized.includes('tracking')) {
    return 'Return tracking attached';
  }
  if (normalized.includes('support ticket') && (normalized.includes('opened') || normalized.includes('created'))) {
    return 'Support ticket created';
  }
  if (normalized.includes('support ticket') && (normalized.includes('resolved') || normalized.includes('closed'))) {
    return 'Support ticket resolved';
  }
  if (normalized.includes('webhook') || normalized.includes('provider status')) {
    return 'Shipment status updated';
  }
  if (normalized.includes('order')) {
    return 'Order created';
  }
  if (normalized.includes('shipment created')) {
    return 'Shipment created';
  }
  if (normalized.includes('tracking added') || normalized.includes('tracking synced')) {
    return 'Tracking synced';
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
  const [copiedDiagnostics, setCopiedDiagnostics] = useState<string | null>(null);
  const [shipmentActionState, setShipmentActionState] = useState<ShipmentActionState | null>(null);
  const [shipmentCustomerOverrides, setShipmentCustomerOverrides] = useState<ShipmentCustomerOverrides>({});
  const [shippingConfigDraft, setShippingConfigDraft] = useState<ShippingConfigDraft>(() => buildShippingConfigDraft(null));
  const [shippingConfigFeedback, setShippingConfigFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const tryOtoAutoRefreshAttemptsRef = useRef<Record<string, number>>({});
  const tryOtoAutoRefreshTimerRef = useRef<number | null>(null);
  const tryOtoAutoRefreshInFlightRef = useRef(false);
  const refreshShipmentStatusMutationRef = useRef<((shipmentExecutionId: string) => Promise<ShipmentExecution>) | null>(null);
  const refetchOrderRef = useRef<(() => unknown) | null>(null);
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
  const { mutateAsync: createReturnShipmentLabelMutation, isPending: isCreatingReturnShipmentLabel } = useMutationAction(
    async (shipmentExecutionId: string) =>
      createReturnShipmentLabel(shipmentExecutionId, {
        vendorId: currentVendor.vendorId,
      }),
    {
      invalidateQueryKeys: [queryKeys.orders.list(currentVendor.vendorId), orderId ? queryKeys.orders.detail(orderId, currentVendor.vendorId) : queryKeys.orders.list(currentVendor.vendorId)],
    },
  );
  const { mutateAsync: probeShopifyReturnLabelUploadMutation, isPending: isProbingShopifyReturnLabelUpload } = useMutationAction(
    async (shipmentExecutionId: string) => probeShopifyReturnLabelUpload(shipmentExecutionId),
    {
      invalidateQueryKeys: [queryKeys.orders.list(currentVendor.vendorId), orderId ? queryKeys.orders.detail(orderId, currentVendor.vendorId) : queryKeys.orders.list(currentVendor.vendorId)],
    },
  );
  const { mutateAsync: probeTryOtoReturnDetailsMutation, isPending: isProbingTryOtoReturnDetails } = useMutationAction(
    async (shipmentExecutionId: string) => probeTryOtoReturnDetails(shipmentExecutionId),
    {
      invalidateQueryKeys: [queryKeys.orders.list(currentVendor.vendorId), orderId ? queryKeys.orders.detail(orderId, currentVendor.vendorId) : queryKeys.orders.list(currentVendor.vendorId)],
    },
  );
  const { mutateAsync: probeTryOtoReturnLinkMutation, isPending: isProbingTryOtoReturnLink } = useMutationAction(
    async (shipmentExecutionId: string) => probeTryOtoReturnLink(shipmentExecutionId),
    {
      invalidateQueryKeys: [queryKeys.orders.list(currentVendor.vendorId), orderId ? queryKeys.orders.detail(orderId, currentVendor.vendorId) : queryKeys.orders.list(currentVendor.vendorId)],
    },
  );
  const { mutateAsync: probeTryOtoReturnAwbPrintMutation, isPending: isProbingTryOtoReturnAwbPrint } = useMutationAction(
    async (shipmentExecutionId: string) => probeTryOtoReturnAwbPrint(shipmentExecutionId),
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
  const hasShopifyFulfillmentSyncAttempt = Boolean(
    order?.shopifyFulfillmentSync?.lastAttemptedAt ||
      order?.shopifyFulfillmentSync?.syncStatus ||
      order?.shopifyFulfillmentSync?.errorMessage,
  );
  const shouldShowRealTrackingForm = isRealMode && canUseFulfillmentActions && !hasTrackingSync;
  const shipmentExecution = order?.shipmentExecution ?? null;
  const visibleShipmentExecution = shipmentActionState?.shipment ?? shipmentExecution ?? null;
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
    (!getShipmentTrackingNumber(order ?? {}, visibleShipmentExecution) || !visibleShipmentExecution.labelUrl);
  const canAutoRefreshTryOtoShipmentStatus =
    canRefreshTryOtoShipmentStatus &&
    Boolean(visibleShipmentExecution?.id) &&
    Boolean(visibleShipmentExecution?.providerShipmentId) &&
    ['created', 'pending'].includes(visibleShipmentStatus);
  const shipmentShopifyTrackingNumber = getShipmentTrackingNumber(order ?? {}, visibleShipmentExecution);
  const shipmentShopifyTrackingUrl = getShipmentTrackingUrl(order ?? {}, visibleShipmentExecution);
  const shipmentShopifyCarrier = formatShopifyCarrierForShipment(visibleShipmentExecution, order?.carrier);
  const shopifyFulfillmentSyncSummary =
    order && (visibleShipmentExecution || hasTrackingSync || hasShopifyFulfillmentSyncAttempt)
      ? getShopifyFulfillmentSyncSummary(order, visibleShipmentExecution)
      : null;
  const canSyncShipmentTrackingToShopify =
    (isAdmin || canUseFulfillmentActions) &&
    visibleShipmentExecution?.provider === 'try_oto' &&
    Boolean(shipmentShopifyTrackingNumber) &&
    Boolean(shipmentShopifyCarrier) &&
    !order?.fulfilledAt;
  const canCreateTryOtoReturnLabel =
    (isAdmin || canUseFulfillmentActions) &&
    visibleShipmentExecution?.provider === 'try_oto' &&
    ['delivered'].includes(visibleShipmentStatus) &&
    Boolean(visibleShipmentExecution.providerShipmentId || visibleShipmentExecution.trackingNumber) &&
    !visibleShipmentExecution.returnShipment;
  const hasShopifyReturnIdForLabelProbe = Boolean(order?.shopifyReturnSignal?.returnIdPresent);
  const hasReturnTrackingForLabelProbe = Boolean(
    visibleShipmentExecution?.returnShipment?.trackingNumber || visibleShipmentExecution?.returnShipment?.barcode,
  );
  const hasReturnLabelUrlForLabelProbe = Boolean(visibleShipmentExecution?.returnShipment?.labelUrl);
  const canProbeShopifyReturnLabelUpload =
    isAdmin &&
    visibleShipmentExecution?.provider === 'try_oto' &&
    hasShopifyReturnIdForLabelProbe &&
    hasReturnTrackingForLabelProbe;
  const tryOtoReturnOrderId = visibleShipmentExecution?.returnShipment?.returnOrderId?.trim() ?? '';
  const canProbeTryOtoReturnDetails =
    isAdmin &&
    visibleShipmentExecution?.provider === 'try_oto' &&
    Boolean(tryOtoReturnOrderId);
  const canProbeTryOtoReturnAwbPrint =
    isAdmin &&
    visibleShipmentExecution?.provider === 'try_oto' &&
    Boolean(tryOtoReturnOrderId);
  const tryOtoReturnProbeBlockedReason = visibleShipmentExecution?.returnShipment && !tryOtoReturnOrderId
    ? visibleShipmentExecution.returnShipment.diagnostics?.returnSkippedReason === 'missing_delivery_option_id'
      ? 'Return probes require returnOrderId. Return shipment was not created because deliveryOptionId is missing.'
      : 'Return probes require returnOrderId.'
    : null;

  useEffect(() => {
    setShipmentCustomerOverrides({});
    setShipmentActionState(null);
    tryOtoAutoRefreshAttemptsRef.current = {};
    if (tryOtoAutoRefreshTimerRef.current !== null) {
      window.clearTimeout(tryOtoAutoRefreshTimerRef.current);
      tryOtoAutoRefreshTimerRef.current = null;
    }
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
      message: 'Refreshing shipment status...',
      endpoint: `POST /shipments/${visibleShipmentExecution.id}/refresh`,
    });

    void refreshShipmentStatusMutation(visibleShipmentExecution.id)
      .then((shipment) => {
        const hasNewShipmentEvidence = Boolean(shipment.trackingNumber || shipment.labelUrl);
        setShipmentActionState({
          tone: hasNewShipmentEvidence ? 'success' : 'info',
          message: hasNewShipmentEvidence
            ? 'Shipment status refreshed.'
            : 'Shipment was created. Tracking or label may still be processing.',
          shipment,
          endpoint: `POST /shipments/${visibleShipmentExecution.id}/refresh`,
        });
        showFeedback(
          hasNewShipmentEvidence
            ? 'Shipment status refreshed.'
            : 'Shipment was created. Tracking or label may still be processing.',
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

  function handleCreateReturnShipmentLabel() {
    if (!visibleShipmentExecution) {
      return;
    }

    setShipmentActionState({
      tone: 'info',
      message: 'Creating Try OTO return label...',
      endpoint: `POST /shipments/${visibleShipmentExecution.id}/create-return`,
    });

    void createReturnShipmentLabelMutation(visibleShipmentExecution.id)
      .then((shipment) => {
        const hasReturnLabel = Boolean(shipment.returnShipment?.labelUrl);
        const returnFinalized = Boolean(shipment.returnShipment?.finalized || shipment.returnShipment?.labelRetrievable);
        setShipmentActionState({
          tone: hasReturnLabel ? 'success' : 'info',
          message: hasReturnLabel
            ? 'Try OTO return label created.'
            : returnFinalized
              ? 'Try OTO return shipment created. Printable return label unavailable.'
              : 'Try OTO return created. Return tracking code will appear here when available.',
          shipment,
          endpoint: `POST /shipments/${visibleShipmentExecution.id}/create-return`,
        });
        showFeedback(
          hasReturnLabel
            ? 'Try OTO return label created.'
            : returnFinalized
              ? 'Try OTO return shipment created. Printable return label unavailable.'
              : 'Try OTO return created. Return tracking code will appear here when available.',
          hasReturnLabel ? 'success' : 'info',
        );
        void refetch();
      })
      .catch((mutationError) => {
        const diagnostics = getApiErrorDiagnostics(mutationError);
        const errorMessage = mutationError instanceof Error ? mutationError.message : 'Try OTO return label could not be created.';
        setShipmentActionState({
          tone: 'error',
          message: errorMessage,
          diagnostics,
          endpoint: diagnostics?.endpoint ?? `POST /shipments/${visibleShipmentExecution.id}/create-return`,
        });
        showFeedback(errorMessage, 'error');
      });
  }

  function handleProbeShopifyReturnLabelUpload() {
    if (!visibleShipmentExecution) {
      return;
    }

    setShipmentActionState({
      tone: 'info',
      message: 'Probing Shopify return label upload...',
      endpoint: `POST /admin/shipments/${visibleShipmentExecution.id}/probe-shopify-return-label`,
    });

    void probeShopifyReturnLabelUploadMutation(visibleShipmentExecution.id)
      .then((shipment) => {
        const probe = shipment.returnShipment?.shopifyReturnLabelUploadProbe;
        const accepted = Boolean(probe?.trackingAccepted || probe?.labelAccepted);
        const message = probe?.labelAccepted
          ? 'Shopify accepted the return label PDF URL.'
          : probe?.trackingAccepted
            ? 'Shopify return tracking attached.'
          : probe?.errorMessage || 'Shopify return label upload probe completed with diagnostics.';
        setShipmentActionState({
          tone: accepted ? 'success' : 'info',
          message,
          shipment,
          endpoint: `POST /admin/shipments/${visibleShipmentExecution.id}/probe-shopify-return-label`,
        });
        showFeedback(message, accepted ? 'success' : 'info');
        void refetch();
      })
      .catch((mutationError) => {
        const diagnostics = getApiErrorDiagnostics(mutationError);
        const errorMessage = mutationError instanceof Error ? mutationError.message : 'Shopify return label upload probe could not be run.';
        setShipmentActionState({
          tone: 'error',
          message: errorMessage,
          diagnostics,
          endpoint: diagnostics?.endpoint ?? `POST /admin/shipments/${visibleShipmentExecution.id}/probe-shopify-return-label`,
        });
        showFeedback(errorMessage, 'error');
      });
  }

  function handleProbeTryOtoReturnDetails() {
    if (!visibleShipmentExecution) {
      return;
    }

    setShipmentActionState({
      tone: 'info',
      message: 'Probing Try OTO return details...',
      endpoint: `POST /admin/shipments/${visibleShipmentExecution.id}/probe-try-oto-return-details`,
    });

    void probeTryOtoReturnDetailsMutation(visibleShipmentExecution.id)
      .then((shipment) => {
        const probe = shipment.returnShipment?.detailsProbe;
        const foundLabel = Boolean(shipment.returnShipment?.labelUrl || probe?.labelUrlPresent);
        const message = foundLabel
          ? 'Try OTO return label found in return details.'
          : probe?.errorMessage || 'Return label is not available from getReturnDetails yet.';
        setShipmentActionState({
          tone: foundLabel ? 'success' : 'info',
          message,
          shipment,
          endpoint: `POST /admin/shipments/${visibleShipmentExecution.id}/probe-try-oto-return-details`,
        });
        showFeedback(message, foundLabel ? 'success' : 'info');
        void refetch();
      })
      .catch((mutationError) => {
        const diagnostics = getApiErrorDiagnostics(mutationError);
        const errorMessage = mutationError instanceof Error ? mutationError.message : 'Try OTO return details probe could not be run.';
        setShipmentActionState({
          tone: 'error',
          message: errorMessage,
          diagnostics,
          endpoint: diagnostics?.endpoint ?? `POST /admin/shipments/${visibleShipmentExecution.id}/probe-try-oto-return-details`,
        });
        showFeedback(errorMessage, 'error');
      });
  }

  function handleProbeTryOtoReturnLink() {
    if (!visibleShipmentExecution) {
      return;
    }

    setShipmentActionState({
      tone: 'info',
      message: 'Probing Try OTO return link...',
      endpoint: `POST /admin/shipments/${visibleShipmentExecution.id}/probe-try-oto-return-link`,
    });

    void probeTryOtoReturnLinkMutation(visibleShipmentExecution.id)
      .then((shipment) => {
        const probe = shipment.returnShipment?.linkProbe;
        const foundLabel = Boolean(shipment.returnShipment?.labelUrl || probe?.labelUrlPresent);
        const message = foundLabel
          ? 'Try OTO return label found in return link response.'
          : probe?.errorMessage || 'Return label is not available from getReturnLink yet.';
        setShipmentActionState({
          tone: foundLabel ? 'success' : 'info',
          message,
          shipment,
          endpoint: `POST /admin/shipments/${visibleShipmentExecution.id}/probe-try-oto-return-link`,
        });
        showFeedback(message, foundLabel ? 'success' : 'info');
        void refetch();
      })
      .catch((mutationError) => {
        const diagnostics = getApiErrorDiagnostics(mutationError);
        const errorMessage = mutationError instanceof Error ? mutationError.message : 'Try OTO return link probe could not be run.';
        setShipmentActionState({
          tone: 'error',
          message: errorMessage,
          diagnostics,
          endpoint: diagnostics?.endpoint ?? `POST /admin/shipments/${visibleShipmentExecution.id}/probe-try-oto-return-link`,
        });
        showFeedback(errorMessage, 'error');
      });
  }

  function handleProbeTryOtoReturnAwbPrint() {
    if (!visibleShipmentExecution) {
      return;
    }

    setShipmentActionState({
      tone: 'info',
      message: 'Probing Try OTO return AWB print...',
      endpoint: `POST /admin/shipments/${visibleShipmentExecution.id}/probe-try-oto-return-awb-print`,
    });

    void probeTryOtoReturnAwbPrintMutation(visibleShipmentExecution.id)
      .then((shipment) => {
        const probe = shipment.returnShipment?.awbPrintProbe;
        const foundLabel = Boolean(shipment.returnShipment?.labelUrl || probe?.labelUrlPresent);
        const message = foundLabel
          ? 'Try OTO return label found in AWB print response.'
          : probe?.errorMessage || 'Return AWB print did not return a label URL yet.';
        setShipmentActionState({
          tone: foundLabel ? 'success' : 'info',
          message,
          shipment,
          endpoint: `POST /admin/shipments/${visibleShipmentExecution.id}/probe-try-oto-return-awb-print`,
        });
        showFeedback(message, foundLabel ? 'success' : 'info');
        void refetch();
      })
      .catch((mutationError) => {
        const diagnostics = getApiErrorDiagnostics(mutationError);
        const errorMessage = mutationError instanceof Error ? mutationError.message : 'Try OTO return AWB print probe could not be run.';
        setShipmentActionState({
          tone: 'error',
          message: errorMessage,
          diagnostics,
          endpoint: diagnostics?.endpoint ?? `POST /admin/shipments/${visibleShipmentExecution.id}/probe-try-oto-return-awb-print`,
        });
        showFeedback(errorMessage, 'error');
      });
  }

  function handleSyncShipmentTrackingToShopify() {
    if (!order || !shipmentShopifyTrackingNumber || !shipmentShopifyCarrier) {
      showFeedback('Shipment tracking and carrier are required before syncing to Shopify.', 'error');
      return;
    }

    void submitTrackingMutation({
      allocationId: order.id,
      trackingNumber: shipmentShopifyTrackingNumber,
      carrier: shipmentShopifyCarrier,
      trackingUrl: shipmentShopifyTrackingUrl ?? undefined,
      notifyCustomer: false,
    })
      .then((result) => {
        showFeedback(`Tracking ${result.trackingNumber} synced to Shopify.`, 'success');
        void refetch();
      })
      .catch((mutationError) => {
        showFeedback(getTrackingMutationErrorMessage(mutationError), 'error');
      });
  }

  useEffect(() => {
    refreshShipmentStatusMutationRef.current = refreshShipmentStatusMutation;
    refetchOrderRef.current = refetch;
  }, [refreshShipmentStatusMutation, refetch]);

  useEffect(() => {
    if (tryOtoAutoRefreshTimerRef.current !== null) {
      window.clearTimeout(tryOtoAutoRefreshTimerRef.current);
      tryOtoAutoRefreshTimerRef.current = null;
    }

    if (!canAutoRefreshTryOtoShipmentStatus || !visibleShipmentExecution?.id) {
      return undefined;
    }

    const shipmentExecutionId = visibleShipmentExecution.id;
    const attempt = tryOtoAutoRefreshAttemptsRef.current[shipmentExecutionId] ?? 0;
    if (attempt >= TRY_OTO_AUTO_REFRESH_DELAYS_MS.length) {
      return undefined;
    }

    let cancelled = false;

    const scheduleAttempt = (nextAttempt: number) => {
      tryOtoAutoRefreshTimerRef.current = window.setTimeout(() => {
        if (cancelled || tryOtoAutoRefreshInFlightRef.current || !refreshShipmentStatusMutationRef.current) {
          return;
        }

        tryOtoAutoRefreshAttemptsRef.current[shipmentExecutionId] = nextAttempt + 1;
        tryOtoAutoRefreshInFlightRef.current = true;
        void refreshShipmentStatusMutationRef.current(shipmentExecutionId)
          .then((shipment) => {
            void refetchOrderRef.current?.();
            const hasTrackingAndLabel = Boolean(shipment.trackingNumber && shipment.labelUrl);
            const followingAttempt = nextAttempt + 1;
            if (!cancelled && !hasTrackingAndLabel && followingAttempt < TRY_OTO_AUTO_REFRESH_DELAYS_MS.length) {
              scheduleAttempt(followingAttempt);
            }
          })
          .catch(() => {
            // Manual refresh remains available; avoid noisy background errors.
          })
          .finally(() => {
            tryOtoAutoRefreshInFlightRef.current = false;
          });
      }, TRY_OTO_AUTO_REFRESH_DELAYS_MS[nextAttempt]);
    };

    scheduleAttempt(attempt);

    return () => {
      cancelled = true;
      if (tryOtoAutoRefreshTimerRef.current !== null) {
        window.clearTimeout(tryOtoAutoRefreshTimerRef.current);
        tryOtoAutoRefreshTimerRef.current = null;
      }
    };
  }, [
    canAutoRefreshTryOtoShipmentStatus,
    visibleShipmentExecution?.id,
    visibleShipmentExecution?.providerShipmentId,
    visibleShipmentExecution?.trackingNumber,
    visibleShipmentExecution?.labelUrl,
    order?.trackingNumber,
    visibleShipmentStatus,
  ]);

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
      <details className="provider-response-summary admin-diagnostics-panel diagnostics-nested-panel" aria-label="Provider payload diagnostics">
        <summary className="provider-response-heading">
          <strong>Provider payload diagnostics</strong>
          <span>Provider diagnostics</span>
        </summary>
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
      </details>
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
            `lookup.weight ${formatPresence(presence.weight)}`,
            `customer.city ${formatPresence(presence.customerCity)}`,
            `customer.country ${formatPresence(presence.customerCountry)}`,
            `payment ${formatPresence(presence.paymentMethod)}`,
          ].join(' · ')
        : '—';

    return (
      <details className="provider-response-summary admin-diagnostics-panel diagnostics-nested-panel" aria-label="Try OTO shipment finalization diagnostics">
        <summary className="provider-response-heading">
          <strong>Try OTO shipment finalization</strong>
          <span>Provider diagnostics</span>
        </summary>
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
          <span>Delivery lookup weight fields</span>
          <strong>
            {diagnostics.deliveryOptionLookupWeightFieldNames?.length
              ? diagnostics.deliveryOptionLookupWeightFieldNames.join(', ')
              : '—'}{' '}
            · numeric {formatPresence(diagnostics.deliveryOptionLookupNumericWeightPresent)}
            {diagnostics.deliveryOptionLookupWeightType ? ` (${diagnostics.deliveryOptionLookupWeightType})` : ''}
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
          <span>createShipment endpoint</span>
          <strong>{diagnostics.createShipmentEndpoint || '—'}</strong>
        </div>
        <div className="summary-row">
          <span>createShipment response keys</span>
          <strong>{diagnostics.createShipmentResponseKeys.length ? diagnostics.createShipmentResponseKeys.join(', ') : '—'}</strong>
        </div>
        <div className="summary-row">
          <span>createShipment response status</span>
          <strong>{diagnostics.createShipmentResponseStatus ?? '—'}</strong>
        </div>
        <div className="summary-row">
          <span>createShipment message</span>
          <strong>
            {diagnostics.createShipmentProviderErrorCode ? `${diagnostics.createShipmentProviderErrorCode}: ` : ''}
            {diagnostics.createShipmentProviderMessage || '—'}
          </strong>
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
      </details>
    );
  }

  const supportCorrelationId = order ? buildSupportCorrelationId(order.id, visibleShipmentExecution?.id) : null;
  const supportContextType = visibleShipmentExecution ? 'shipment' : 'order';
  const supportContextId = visibleShipmentExecution?.id ?? order?.id ?? null;
  const supportDefaultCategory = visibleShipmentExecution?.returnShipment ? 'RETURN' : visibleShipmentExecution ? 'SHIPMENT' : 'OTHER';
  const supportSnapshot = order
    ? {
        route: location.pathname,
        orderNumber: formatShopifyOrderNumber(order.sourceShopifyOrderNumber),
        allocationStatus: order.allocationStatus,
        fulfillmentStatus: order.fulfillmentStatus,
        shippingStatus: order.shippingStatus,
        shipmentProvider: visibleShipmentExecution?.provider ? formatShippingProviderName(visibleShipmentExecution.provider) : null,
        carrier: visibleShipmentExecution?.providerCarrierName ?? visibleShipmentExecution?.returnShipment?.carrierName ?? order.carrier ?? null,
        trackingNumber: getShipmentTrackingNumber(order, visibleShipmentExecution),
        returnOrderId: visibleShipmentExecution?.returnShipment?.returnOrderId ?? null,
        shipmentStatus: visibleShipmentExecution?.shipmentStatus ?? null,
        returnStatus: visibleShipmentExecution?.returnShipment ? getTryOtoReturnStatusLabel(visibleShipmentExecution.returnShipment) : null,
        shopifyFulfillmentSyncState: shopifyFulfillmentSyncSummary?.label ?? null,
        timestamp: new Date().toISOString(),
        vendorId: order.assignedVendorId,
        vendorStore: currentVendor.vendorName ?? order.assignedVendorId,
        supportCorrelationId,
        flags: {
          trackingPresent: Boolean(getShipmentTrackingNumber(order, visibleShipmentExecution) || getShipmentTrackingUrl(order, visibleShipmentExecution)),
          returnTrackingPresent: Boolean(visibleShipmentExecution?.returnShipment?.trackingNumber || visibleShipmentExecution?.returnShipment?.barcode),
          returnLabelPresent: Boolean(visibleShipmentExecution?.returnShipment?.labelUrl),
          shopifyFulfillmentIdPresent: Boolean(order.shopifyFulfillmentSync?.fulfillmentIdPresent),
          shopifyReverseDeliveryIdPresent: Boolean(visibleShipmentExecution?.returnShipment?.shopifyReturnLabelUploadProbe?.reverseDeliveryIdPresent),
        },
        ...(isAdmin
          ? {
              adminDiagnostics: {
                providerHttpStatus: shipmentProviderSummary?.httpStatus ?? null,
                providerMessage: shipmentProviderSummary?.providerError ?? null,
                providerResponseKeys: shipmentProviderSummary?.responseKeys ?? [],
                webhookReceived: visibleShipmentExecution?.webhookReceived ?? false,
                providerStatus: visibleShipmentExecution?.providerStatus ?? null,
                tryOtoReturnDiagnostics: visibleShipmentExecution?.returnShipment?.diagnostics
                  ? {
                      httpStatus: visibleShipmentExecution.returnShipment.diagnostics.httpStatus,
                      responseKeys: visibleShipmentExecution.returnShipment.diagnostics.responseKeys,
                      returnFinalized: visibleShipmentExecution.returnShipment.diagnostics.returnFinalized,
                      providerMessage: visibleShipmentExecution.returnShipment.diagnostics.providerMessage,
                    }
                  : null,
                shopifyReverseDeliveryDiagnostics: visibleShipmentExecution?.returnShipment?.shopifyReturnLabelUploadProbe
                  ? {
                      status: visibleShipmentExecution.returnShipment.shopifyReturnLabelUploadProbe.status,
                      trackingAccepted: visibleShipmentExecution.returnShipment.shopifyReturnLabelUploadProbe.trackingAccepted,
                      labelAccepted: visibleShipmentExecution.returnShipment.shopifyReturnLabelUploadProbe.labelAccepted,
                      reverseDeliveryIdPresent: visibleShipmentExecution.returnShipment.shopifyReturnLabelUploadProbe.reverseDeliveryIdPresent,
                      skippedReason: visibleShipmentExecution.returnShipment.shopifyReturnLabelUploadProbe.skippedReason,
                    }
                  : null,
              },
            }
          : {}),
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

  const handleCopyDiagnostics = (kind: 'diagnostics' | 'shipment-summary' | 'return-summary' | 'shipment' | 'return' | 'shopify') => {
    if (!order) {
      return;
    }

    const shipmentDiagnosticsText = buildDiagnosticsCopyText('Shipment diagnostics', [
            ['Order', formatShopifyOrderNumber(order.sourceShopifyOrderNumber)],
            ['Support correlation id', supportCorrelationId],
            ['Shipment provider', visibleShipmentExecution?.provider ? formatShippingProviderName(visibleShipmentExecution.provider) : null],
            ['Carrier', visibleShipmentExecution?.providerCarrierName ?? order.carrier ?? null],
            ['Shipment status', visibleShipmentExecution?.shipmentStatus ?? order.shippingStatus],
            ['Tracking present', Boolean(getShipmentTrackingNumber(order, visibleShipmentExecution))],
            ['Tracking link present', Boolean(getShipmentTrackingUrl(order, visibleShipmentExecution))],
            ['Provider HTTP', shipmentProviderSummary?.httpStatus ?? null],
            ['Provider message', shipmentProviderSummary?.providerError ?? null],
            ['Webhook received', visibleShipmentExecution?.webhookReceived ?? false],
            ['Provider status', visibleShipmentExecution?.providerStatus ?? null],
          ]);
    const returnDiagnosticsText = buildDiagnosticsCopyText('Return diagnostics', [
              ['Order', formatShopifyOrderNumber(order.sourceShopifyOrderNumber)],
              ['Support correlation id', supportCorrelationId],
              ['Return order id present', Boolean(visibleShipmentExecution?.returnShipment?.returnOrderId)],
              ['Return status', visibleShipmentExecution?.returnShipment ? getTryOtoReturnStatusLabel(visibleShipmentExecution.returnShipment) : null],
              ['Return tracking present', Boolean(visibleShipmentExecution?.returnShipment?.trackingNumber || visibleShipmentExecution?.returnShipment?.barcode)],
              ['Return tracking link present', Boolean(visibleShipmentExecution?.returnShipment?.trackingUrl)],
              ['Return label present', Boolean(visibleShipmentExecution?.returnShipment?.labelUrl)],
              ['Return finalized', visibleShipmentExecution?.returnShipment?.finalized ?? null],
              ['Provider message', visibleShipmentExecution?.returnShipment?.diagnostics?.providerMessage ?? null],
              ['Shopify return tracking accepted', visibleShipmentExecution?.returnShipment?.shopifyReturnLabelUploadProbe?.trackingAccepted ?? null],
            ]);
    const shopifyDiagnosticsText = buildDiagnosticsCopyText('Shopify diagnostics', [
              ['Order', formatShopifyOrderNumber(order.sourceShopifyOrderNumber)],
              ['Support correlation id', supportCorrelationId],
              ['Fulfillment sync status', shopifyFulfillmentSyncSummary?.label ?? null],
              ['Fulfillment order id present', order.shopifyFulfillmentSync?.fulfillmentOrderIdPresent ?? null],
              ['Fulfillment id present', order.shopifyFulfillmentSync?.fulfillmentIdPresent ?? null],
              ['Sync skipped reason', order.shopifyFulfillmentSync?.skippedReason ?? null],
              ['Sync error', order.shopifyFulfillmentSync?.errorMessage ?? null],
              ['Last sync attempted', order.shopifyFulfillmentSync?.lastAttemptedAt ?? null],
              ['Shopify return id present', hasShopifyReturnIdForLabelProbe],
              ['Reverse delivery id present', visibleShipmentExecution?.returnShipment?.shopifyReturnLabelUploadProbe?.reverseDeliveryIdPresent ?? null],
            ]);
    const shipmentSummaryText = buildDiagnosticsCopyText('Shipment summary', [
      ['Order', formatShopifyOrderNumber(order.sourceShopifyOrderNumber)],
      ['Shipment provider', visibleShipmentExecution?.provider ? formatShippingProviderName(visibleShipmentExecution.provider) : null],
      ['Carrier', shipmentShopifyCarrier],
      ['Shipment status', visibleShipmentExecution ? getOperationalShipmentStatusLabel(visibleShipmentExecution.shipmentStatus) : order.shippingStatus],
      ['Tracking number', getShipmentTrackingNumber(order, visibleShipmentExecution)],
      ['Tracking link present', Boolean(getShipmentTrackingUrl(order, visibleShipmentExecution))],
      ['Label present', Boolean(visibleShipmentExecution?.labelUrl)],
    ]);
    const returnSummaryText = buildDiagnosticsCopyText('Return summary', [
      ['Order', formatShopifyOrderNumber(order.sourceShopifyOrderNumber)],
      ['Return status', visibleShipmentExecution?.returnShipment ? getTryOtoReturnStatusLabel(visibleShipmentExecution.returnShipment) : null],
      ['Return carrier', visibleShipmentExecution?.returnShipment?.carrierName ?? null],
      ['Return tracking code', visibleShipmentExecution?.returnShipment?.trackingNumber ?? visibleShipmentExecution?.returnShipment?.barcode ?? null],
      ['Return tracking link present', Boolean(visibleShipmentExecution?.returnShipment?.trackingUrl)],
      ['Printable return label available', Boolean(visibleShipmentExecution?.returnShipment?.labelUrl)],
      ['Shopify return tracking accepted', visibleShipmentExecution?.returnShipment?.shopifyReturnLabelUploadProbe?.trackingAccepted ?? null],
    ]);
    const text =
      kind === 'diagnostics'
        ? [shipmentDiagnosticsText, returnDiagnosticsText, shopifyDiagnosticsText].join('\n\n')
        : kind === 'shipment-summary'
          ? shipmentSummaryText
          : kind === 'return-summary'
            ? returnSummaryText
            : kind === 'shipment'
              ? shipmentDiagnosticsText
              : kind === 'return'
                ? returnDiagnosticsText
                : shopifyDiagnosticsText;

    void navigator.clipboard?.writeText(text);
    setCopiedDiagnostics(
      kind === 'diagnostics'
        ? 'diagnostics'
        : kind === 'shipment-summary'
          ? 'shipment summary'
          : kind === 'return-summary'
            ? 'return summary'
            : `${kind} diagnostics`,
    );
    window.setTimeout(() => setCopiedDiagnostics(null), 2500);
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
  const financePreview = order.financeLedgerPreview;
  const financeSummaryUnknowns = financePreview?.unknowns ?? [];
  const payoutFinanceRecord = relatedFinanceRecords.find((record) => record.category !== 'Refund');
  const refundFinanceRecord = relatedFinanceRecords.find((record) => record.category === 'Refund');
  const payoutStatus = payoutFinanceRecord?.status ?? 'Unknown';
  const hasRefundImpact =
    Boolean(refundFinanceRecord) ||
    relatedReturns.length > 0 ||
    Boolean(financePreview && (financePreview.sourceFields.returnCount > 0 || financePreview.sourceFields.refundCount > 0));
  const refundImpact =
    isAdmin && financePreview
      ? financePreview.balance.vendorDebt !== '0.00'
        ? `Debt ${formatCurrency(financePreview.balance.vendorDebt, financePreview.currency)}`
        : financePreview.sourceFields.returnCount > 0 || financePreview.sourceFields.refundCount > 0
          ? 'Reflected in preview'
          : 'No return/refund impact'
      : refundFinanceRecord
        ? `${refundFinanceRecord.amount} · ${refundFinanceRecord.status}`
        : relatedReturns.length > 0
          ? 'Return linked'
          : 'No return/refund impact';
  const financeSummaryCards = [
    { label: 'Order total', value: order.amount },
    { label: 'Payout status', value: payoutStatus },
    hasRefundImpact ? { label: 'Refund impact', value: refundImpact } : null,
  ].filter(Boolean) as Array<{ label: string; value: string }>;
  const financeUnknownIndicators = isAdmin
    ? [
        ...(financeSummaryUnknowns.length ? financeSummaryUnknowns : []),
        financePreview?.sourceFields.shippingCost === 'unknown' ? 'shipping_cost' : null,
        !financePreview ? 'ledger_preview_unavailable' : null,
      ].filter(Boolean) as string[]
    : ['finance_preview_admin_only'];
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
    tone: 'info',
  });
  if (order.shipmentCreatedAt) {
    orderTimelineEvents.push({
      id: 'shipment-created',
      title: 'Shipment created',
      description: order.carrier ? `Carrier: ${formatShippingProviderName(order.carrier)}` : 'Shipment record is available.',
      at: order.shipmentCreatedAt,
      status: order.shippingStatus,
      tone: 'success',
    });
  }
  if (order.trackingNumber || order.trackingUrl) {
    orderTimelineEvents.push({
      id: 'tracking-added',
      title: 'Tracking synced',
      description: [formatTrackingCarrierLabel(order.carrier), order.trackingNumber].filter(Boolean).join(' / ') || 'Tracking link available.',
      at: order.shipmentUpdatedAt ?? order.fulfilledAt ?? order.date,
      tone: 'success',
    });
  }
  if (order.shippingStatus === 'Delivered' || visibleShipmentExecution?.shipmentStatus === 'delivered') {
    orderTimelineEvents.push({
      id: 'shipment-delivered',
      title: 'Delivered',
      description: 'Carrier delivery is confirmed.',
      at: visibleShipmentExecution?.lastProviderResponseAt ?? order.fulfilledAt ?? order.shipmentUpdatedAt ?? order.date,
      tone: 'success',
    });
  }
  if (visibleShipmentExecution?.returnShipment?.trackingNumber || visibleShipmentExecution?.returnShipment?.barcode || visibleShipmentExecution?.returnShipment?.trackingUrl) {
    orderTimelineEvents.push({
      id: 'return-tracking-attached',
      title: 'Return tracking attached',
      description: visibleShipmentExecution.returnShipment.trackingUrl
        ? 'Customer can track return shipment.'
        : 'Return tracking code is available.',
      at: visibleShipmentExecution.returnShipment.createdAt ?? visibleShipmentExecution.lastProviderResponseAt ?? order.date,
      tone: 'success',
    });
  }
  if (visibleShipmentExecution?.returnShipment?.shopifyReturnLabelUploadProbe?.trackingAccepted) {
    orderTimelineEvents.push({
      id: 'shopify-return-tracking-synced',
      title: 'Shopify return tracking synced',
      description: 'Customer can track return shipment in Shopify.',
      at:
        visibleShipmentExecution.returnShipment.shopifyReturnLabelUploadProbe.attemptedAt ??
        visibleShipmentExecution.returnShipment.createdAt ??
        order.date,
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
      visibility: 'admin' as const,
    })),
    ...relatedSupportTickets.map((ticket) => ({
      id: `support-${ticket.id}`,
      title: 'Support ticket created',
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
        visibility: 'admin' as const,
      })),
    ...relatedSupportTickets
      .filter((ticket) => ticket.status === 'RESOLVED' || ticket.status === 'CLOSED')
      .map((ticket) => ({
        id: `support-status-${ticket.id}`,
        title: 'Support ticket resolved',
        description: ticket.subject,
        at: ticket.resolvedAt ?? ticket.closedAt ?? ticket.updatedAt,
        status: ticket.status.replace(/_/g, ' '),
        tone: 'success' as const,
        href: `${supportBasePath}/${ticket.id}`,
      })),
  );
  const orderCrossLinks: OperationalLinkInput[] = [
    ...relatedReturns.map((returnRecord) => ({
      id: `return-${returnRecord.id}`,
      eyebrow: 'Return',
      title: `Return for ${formatShopifyOrderNumber(returnRecord.sourceShopifyOrderNumber)}`,
      description: [returnRecord.status, returnRecord.displayTitle ?? returnRecord.itemTitle ?? 'Returned item'].filter(Boolean).join(' · '),
      actionLabel: 'Open return detail',
      href: `/returns/${returnRecord.id}`,
      status: returnRecord.status === 'Closed' || returnRecord.status === 'Refunded' ? 'Return closed' : 'Return linked',
      tone: returnRecord.status === 'Refunded' || returnRecord.status === 'Closed' ? ('success' as const) : ('attention' as const),
    })),
    ...relatedFinanceRecords.map((record) => ({
      id: `finance-${record.id}`,
      eyebrow: 'Finance',
      title: record.category === 'Refund' ? 'Refund impact' : 'Payout activity',
      description: `${record.amount} · ${record.status}`,
      actionLabel: 'Open finance detail',
      href: buildFinanceHref(record),
      status: record.status === 'Pending' ? 'Payout pending' : record.category,
      tone: record.category === 'Refund' ? ('warning' as const) : ('success' as const),
    })),
    ...relatedSupportTickets.map((ticket) => ({
      id: `support-${ticket.id}`,
      eyebrow: 'Support',
      title: ticket.subject,
      description: [ticket.status.replace(/_/g, ' '), ticket.vendorName ?? ticket.vendorId].filter(Boolean).join(' · '),
      actionLabel: 'Open support ticket',
      href: `${supportBasePath}/${ticket.id}`,
      status: ticket.status === 'RESOLVED' || ticket.status === 'CLOSED' ? 'Support resolved' : 'Support active',
      tone: ticket.status === 'RESOLVED' || ticket.status === 'CLOSED' ? ('success' as const) : ('info' as const),
    })),
  ];
  const activeReturn = relatedReturns.find((returnRecord) => !['Closed', 'Processed', 'Refunded'].includes(returnRecord.status));
  const waitingSupportTicket = relatedSupportTickets.find((ticket) => ticket.status === 'WAITING_FOR_VENDOR');
  const hasOperationalReturn = Boolean(activeReturn || visibleShipmentExecution?.returnShipment);
  const needsOperationalAttention = Boolean(waitingSupportTicket) || (!hasTrackingSync && order.shippingStatus !== 'Delivered');
  const orderHealth = needsOperationalAttention
    ? {
        label: 'Needs attention',
        helper: waitingSupportTicket
          ? 'Support is waiting for a vendor update.'
          : 'Shipment tracking is not fully visible yet.',
        tone: 'attention',
      }
    : {
        label: 'Healthy',
        helper: 'Shipment and order state are progressing normally.',
        tone: 'healthy',
      };
  const operationalAlerts = [
    hasOperationalReturn
      ? {
          id: 'return-active',
          label: 'Return active',
          detail: activeReturn
            ? `Customer return ${activeReturn.status.toLowerCase()}. Review return tracking and Shopify sync before closing the loop.`
            : 'Customer return is linked. Review return tracking and Shopify sync before closing the loop.',
          tone: 'return',
          href: activeReturn ? `/returns/${activeReturn.id}` : null,
          action: activeReturn ? 'Open return details' : null,
        }
      : null,
    !hasOperationalReturn && !hasTrackingSync
      ? {
          id: 'tracking-missing',
          label: 'Tracking missing',
          detail: 'Tracking is not visible to the operational workspace yet.',
          tone: 'attention',
          href: null,
          action: null,
        }
      : null,
    !hasOperationalReturn && order.shippingStatus === 'Awaiting Shipment'
      ? {
          id: 'awaiting-shipment',
          label: 'Awaiting shipment',
          detail: 'Create shipment or add tracking when the package is ready.',
          tone: 'warning',
          href: null,
          action: null,
        }
      : null,
    waitingSupportTicket
      ? {
          id: 'support-needed',
          label: 'Support action needed',
          detail: waitingSupportTicket.subject,
          tone: 'support',
          href: `${supportBasePath}/${waitingSupportTicket.id}`,
          action: 'Open support',
        }
      : null,
  ].filter(Boolean) as Array<{ id: string; label: string; detail: string; tone: string; href: string | null; action: string | null }>;

  const isKargoConfigDraft = shippingConfigDraft.preferredProvider === 'kargo_entegrator';
  const isTryOtoConfigDraft = shippingConfigDraft.preferredProvider === 'try_oto';
  const shouldShowTryOtoProviderOption =
    vendorShippingConfig?.preferredProvider === 'try_oto' ||
    shippingProviderDiagnostics?.provider === 'try_oto' ||
    Boolean(shippingProviderDiagnostics?.supportedProviders?.includes('try_oto')) ||
    Boolean(tryOtoOptionDiagnostics?.supportedProviders?.includes('try_oto')) ||
    Boolean(tryOtoOptionDiagnostics?.providerEnabled);
  const tryOtoPickupLocationCode = readTryOtoPickupLocationCode(vendorShippingConfig);
  const tryOtoOriginCity = readTryOtoOriginCity(vendorShippingConfig);

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
    <section className="order-detail-workspace order-detail-cockpit order-detail-dense">
      <header className="order-detail-topbar">
        <Link className="order-detail-back" to="/orders">
          Back to orders
        </Link>
        <div className="order-detail-title-row">
          <div className="order-detail-title-stack">
            <div className="order-detail-heading-line">
              <h1>Order {formatShopifyOrderNumber(order.sourceShopifyOrderNumber)}</h1>
              <span className="order-source-pill">{order.channel || 'Unknown'}</span>
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
              <div>
                <span>Shopify ID</span>
                <strong>{order.sourceShopifyOrderId || '—'}</strong>
              </div>
            </div>
            <div className="order-ship-to-note" aria-label="Shipping address summary">
              <span>Ship to</span>
              <strong>{order.shippingAddress && order.shippingAddress !== 'Unknown' ? order.shippingAddress : 'Shopify shipping address available in future detail sync.'}</strong>
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
        {!hasOperationalReturn ? (
          <div className={`order-health-banner order-health-${orderHealth.tone}`} aria-label="Primary operational status">
            <strong>{orderHealth.label}</strong>
            <span>{orderHealth.helper}</span>
          </div>
        ) : null}
        {operationalAlerts.length ? (
          <div className="order-operational-alerts" aria-label="Operational alerts">
            {operationalAlerts.map((alert) => (
              <div key={alert.id} className={`order-operational-alert order-alert-${alert.tone}`}>
                <span className="order-alert-icon" aria-hidden="true">
                  !
                </span>
                <strong>{alert.label}</strong>
                <span>{alert.detail}</span>
                {alert.href && alert.action ? (
                  <Link className="order-alert-link" to={alert.href}>
                    {alert.action}
                  </Link>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
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
        <main className="order-detail-main-column" aria-label="Order operations">
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

          <article className="order-detail-card-v2 order-financial-summary-card order-workspace-panel">
            <div className="order-card-heading">
              <h2>Financial summary</h2>
              <p>Read-only operational estimate. Unknowns are flagged inline, not treated as balances.</p>
            </div>
            <div className="order-financial-impact-grid">
              {financeSummaryCards.map((card) => (
                <div key={card.label}>
                  <span>{card.label}</span>
                  <strong>{card.value}</strong>
                </div>
              ))}
            </div>
            {financeUnknownIndicators.length ? (
              <div className="finance-inline-unknowns" aria-label="Finance unknown indicators">
                <span>Unknown</span>
                {Array.from(new Set(financeUnknownIndicators)).map((unknown) => (
                  <strong key={unknown}>{toTitleCaseLabel(unknown.replace(/_/g, ' '))}</strong>
                ))}
              </div>
            ) : null}
          </article>

          {isAdmin && order.financeLedgerPreview ? (
            <article className="order-detail-card-v2 order-finance-ledger-card order-workspace-panel" aria-label="Finance ledger preview">
              <div className="order-card-heading">
                <div>
                  <h2>Finance ledger preview</h2>
                  <p>Read-only simulation. Not payout, refund, invoice, or tax truth.</p>
                </div>
              </div>
              <div className="order-financial-impact-grid">
                <div>
                  <span>Vendor payable estimate</span>
                  <strong>{formatCurrency(order.financeLedgerPreview.balance.vendorPayable, order.financeLedgerPreview.currency)}</strong>
                </div>
                <div>
                  <span>Marketplace commission estimate</span>
                  <strong>{formatCurrency(order.financeLedgerPreview.balance.marketplaceCommission, order.financeLedgerPreview.currency)}</strong>
                </div>
                <div>
                  <span>Refund impact</span>
                  <strong>
                    {order.financeLedgerPreview.balance.vendorDebt !== '0.00'
                      ? `Debt ${formatCurrency(order.financeLedgerPreview.balance.vendorDebt, order.financeLedgerPreview.currency)}`
                      : formatCurrency(
                          String(
                            Math.max(
                              Number(order.financeLedgerPreview.balance.grossSales) -
                                Number(order.financeLedgerPreview.balance.marketplaceCommission) -
                                Number(order.financeLedgerPreview.balance.vendorPayable),
                              0,
                            ).toFixed(2),
                          ),
                          order.financeLedgerPreview.currency,
                        )}
                  </strong>
                </div>
              </div>
              <details className="provider-response-summary admin-diagnostics-panel" aria-label="Finance preview diagnostics">
                <summary className="provider-response-heading">
                  <strong>Finance preview diagnostics</strong>
                  <span>Admin diagnostics</span>
                </summary>
                <div className="summary-row">
                  <span>Status</span>
                  <strong>{order.financeLedgerPreview.status === 'ready' ? 'Ready' : 'Partial · unknowns present'}</strong>
                </div>
                <div className="summary-row">
                  <span>Unknown fields</span>
                  <strong>{order.financeLedgerPreview.unknowns.length ? order.financeLedgerPreview.unknowns.join(', ') : '—'}</strong>
                </div>
                <div className="summary-row">
                  <span>Source fields</span>
                  <strong>
                    {order.financeLedgerPreview.sourceFields.lineItemCount} line items · {order.financeLedgerPreview.sourceFields.returnCount} returns ·{' '}
                    {order.financeLedgerPreview.sourceFields.refundCount} refunds
                  </strong>
                </div>
                <div className="summary-row">
                  <span>Assumptions</span>
                  <strong>{order.financeLedgerPreview.assumptions.join(' · ')}</strong>
                </div>
                <div className="shipment-mini-timeline" aria-label="Simulated ledger entries">
                  {order.financeLedgerPreview.entries.slice(0, 12).map((entry) => (
                    <div className="summary-row" key={entry.id}>
                      <span>{toTitleCaseLabel(entry.eventType)}</span>
                      <strong>
                        {[
                          entry.impact.vendorPayable ? `payable ${formatCurrency(entry.impact.vendorPayable, entry.currency)}` : null,
                          entry.impact.marketplaceCommission ? `commission ${formatCurrency(entry.impact.marketplaceCommission, entry.currency)}` : null,
                          entry.impact.shippingCostReserved ? `shipping ${formatCurrency(entry.impact.shippingCostReserved, entry.currency)}` : null,
                          entry.impact.vendorDebt ? `debt ${formatCurrency(entry.impact.vendorDebt, entry.currency)}` : null,
                        ].filter(Boolean).join(' · ') || formatCurrency(entry.amount, entry.currency)}
                      </strong>
                    </div>
                  ))}
                </div>
              </details>
            </article>
          ) : null}

          <div className="order-linked-records-panel">
            <OperationalLinkCards
              title="Linked records"
              subtitle="Returns, payout activity, and support linked to this order."
              links={orderCrossLinks}
              audience={audience}
            />
          </div>
        </main>

        <aside className="order-detail-right-rail" aria-label="Order timeline and support">
          <OperationalTimeline
            title="Timeline"
            subtitle="Human order, shipment, return, and support events. Provider diagnostics stay collapsed for admins."
            events={groupOrderDetailTimelineEvents([
              ...order.timeline
                .filter((entry) => !isRawProviderTimelineLabel(entry.label))
                .map((entry) => ({
                  id: `order-native-${entry.label}-${entry.at}`,
                  title: getVendorTimelineLabel(entry.label),
                  at: entry.at,
                  tone: 'neutral' as const,
                  visibility: getNativeTimelineVisibility(entry.label),
                })),
              ...orderTimelineEvents,
            ])}
            audience={audience}
            emptyMessage="No records available."
          />

          <article className="order-detail-card-v2 order-support-card" aria-label="Shipment and return support">
            <div className="order-card-heading">
              <div>
                <h2>Support</h2>
                <p>
                  {isAdmin
                    ? 'Operational support context and safe diagnostics for this order.'
                    : 'Contact support with the shipment and return context already attached.'}
                </p>
              </div>
            </div>
            <div className="shipment-recovery-actions">
              {isVendorAssignedOwner ? (
                <>
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={() => setSupportOpen(true)}
                    disabled={!canReportIssue}
                  >
                    Contact support
                  </button>
                  {!canReportIssue ? (
                    <span className="muted">Support is available for active or fulfilled assigned orders.</span>
                  ) : (
                    <span className="muted">Order, shipment, return, tracking, and Shopify sync context will be attached.</span>
                  )}
                </>
              ) : null}

              {relatedSupportTickets.length ? (
                <div className="provider-response-summary" aria-label="Support ticket summary">
                  <div className="provider-response-heading">
                    <strong>Support tickets</strong>
                    <span>{relatedSupportTickets.length}</span>
                  </div>
                  {relatedSupportTickets.slice(0, 3).map((ticket) => (
                    <div className="summary-row" key={ticket.id}>
                      <span>{ticket.status.replace(/_/g, ' ')}</span>
                      <Link className="inline-link" to={`${supportBasePath}/${ticket.id}`}>
                        {ticket.subject}
                      </Link>
                    </div>
                  ))}
                </div>
              ) : (
                <span className="muted">No support tickets linked to this order yet.</span>
              )}

              {isAdmin ? (
                <details className="provider-response-summary admin-diagnostics-panel" aria-label="Admin support diagnostics">
                  <summary className="provider-response-heading">
                    <strong>Admin support context</strong>
                    <span>Copy utilities</span>
                  </summary>
                  {relatedSupportTickets[0] ? (
                    <>
                      <div className="summary-row">
                        <span>Latest vendor note</span>
                        <strong>{relatedSupportTickets[0].message || '—'}</strong>
                      </div>
                      <div className="summary-row">
                        <span>Latest status</span>
                        <strong>{relatedSupportTickets[0].status.replace(/_/g, ' ')}</strong>
                      </div>
                    </>
                  ) : null}
                  <div className="order-inline-actions">
                    <button type="button" className="button button-secondary button-compact" onClick={() => handleCopyDiagnostics('diagnostics')}>
                      Copy diagnostics
                    </button>
                    <button type="button" className="button button-secondary button-compact" onClick={() => handleCopyDiagnostics('shipment-summary')}>
                      Copy shipment summary
                    </button>
                    <button type="button" className="button button-secondary button-compact" onClick={() => handleCopyDiagnostics('return-summary')}>
                      Copy return summary
                    </button>
                  </div>
                  {copiedDiagnostics ? <span className="muted">Copied {copiedDiagnostics}.</span> : null}
                </details>
              ) : null}
            </div>
          </article>

          {order ? (
            <AdminCollaborationNotes contextType="order" contextId={order.id} currentUser={currentUser} />
          ) : null}

          <article className="order-detail-card-v2 order-primary-action-card order-workspace-panel">
            <div className="order-card-heading">
              <div>
                <h2>Shipment & delivery</h2>
                <p>{hasTrackingSync ? 'Carrier, tracking, label, and Shopify sync controls.' : 'Add shipment details when the package is ready.'}</p>
              </div>
            </div>
            {canUseFulfillmentActions ? (
              <div className="action-row vendor-action-panel">
                <div className="vendor-actions-heading">
                  <h3>Vendor actions</h3>
                  <span>Shipment, tracking, and return controls for this order.</span>
                </div>
                {isRealMode ? (
                  <>
                    {hasTrackingSync || hasShipmentExecution || hasShopifyFulfillmentSyncAttempt ? (
                      <>
                        <div className="tracking-summary-card order-tracking-summary-card order-shipment-compact-grid">
                          <div className="summary-row">
                            <span>Carrier</span>
                            <strong className={shipmentShopifyCarrier ? '' : 'muted'}>{shipmentShopifyCarrier || 'Not available'}</strong>
                          </div>
                          <div className="summary-row">
                            <span>Status</span>
                            <strong>
                              {visibleShipmentExecution
                                ? getOperationalShipmentStatusLabel(visibleShipmentExecution.shipmentStatus)
                                : order.shippingStatus}
                            </strong>
                          </div>
                          <div className="summary-row">
                            <span>Tracking number</span>
                            <strong className={order.trackingNumber || visibleShipmentExecution?.trackingNumber ? '' : 'muted'}>
                              {getShipmentTrackingNumber(order, visibleShipmentExecution) ?? 'Not available'}
                            </strong>
                          </div>
                          <div className="summary-row">
                            <span>Tracking link</span>
                            {getShipmentTrackingUrl(order, visibleShipmentExecution) ? (
                              <a
                                className="inline-link"
                                href={getShipmentTrackingUrl(order, visibleShipmentExecution) || undefined}
                                target="_blank"
                                rel="noreferrer"
                              >
                                Open tracking
                              </a>
                            ) : (
                              <strong className="muted">Not available</strong>
                            )}
                          </div>
                          <div className="summary-row">
                            <span>Label</span>
                            {visibleShipmentExecution?.labelUrl ? (
                              <a className="inline-link" href={visibleShipmentExecution.labelUrl} target="_blank" rel="noreferrer">
                                Open label PDF
                              </a>
                            ) : (
                              <strong className="muted">Not available</strong>
                            )}
                          </div>
                        </div>
                        {visibleShipmentExecution ? (
                          <details className="shipment-provider-details">
                            <summary>Additional provider details</summary>
                            <div className="order-shipping-state-grid">
                              <div className="summary-row">
                                <span>Shipment provider</span>
                                <strong>{formatShippingProviderName(visibleShipmentExecution.provider)}</strong>
                              </div>
                              {visibleShipmentExecution.warehouseId ? (
                                <div className="summary-row">
                                  <span>Warehouse</span>
                                  <strong>{visibleShipmentExecution.warehouseId}</strong>
                                </div>
                              ) : null}
                              <div className="summary-row">
                                <span>{getShipmentReferenceLabel(visibleShipmentExecution)}</span>
                                <strong className={visibleShipmentExecution.providerShipmentId ? '' : 'muted'}>
                                  {formatShipmentReference(visibleShipmentExecution.providerShipmentId)}
                                </strong>
                              </div>
                              <div className="summary-row">
                                <span>Barcode</span>
                                <strong
                                  className={
                                    visibleShipmentExecution.barcode || getShipmentTrackingNumber(order, visibleShipmentExecution) ? '' : 'muted'
                                  }
                                >
                                  {getShipmentBarcodeDisplay(visibleShipmentExecution, getShipmentTrackingNumber(order, visibleShipmentExecution))}
                                </strong>
                              </div>
                            </div>
                          </details>
                        ) : null}
                        {visibleShipmentExecution?.provider === 'try_oto' ? (
                          <div className="shipment-recovery-actions shipment-return-compact" aria-label="Try OTO return shipment">
                            <strong>Try OTO return shipment</strong>
                            {visibleShipmentExecution.returnShipment ? (
                              <>
                                <span>
                                  {getTryOtoReturnStatusLabel(visibleShipmentExecution.returnShipment)}
                                  {visibleShipmentExecution.returnShipment.returnOrderId
                                    ? ` · ${visibleShipmentExecution.returnShipment.returnOrderId}`
                                    : ''}
                                </span>
                                {visibleShipmentExecution.returnShipment.trackingNumber ? (
                                  <div className="summary-row">
                                    <span>Return tracking</span>
                                    <strong>{visibleShipmentExecution.returnShipment.trackingNumber}</strong>
                                    {visibleShipmentExecution.returnShipment.trackingUrl ? (
                                      <a
                                        className="inline-link"
                                        href={visibleShipmentExecution.returnShipment.trackingUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                      >
                                        Open return tracking
                                      </a>
                                    ) : null}
                                  </div>
                                ) : null}
                                {visibleShipmentExecution.returnShipment.carrierName ? (
                                  <div className="summary-row">
                                    <span>Return carrier</span>
                                    <strong>{visibleShipmentExecution.returnShipment.carrierName}</strong>
                                  </div>
                                ) : null}
                                {visibleShipmentExecution.returnShipment.barcode ? (
                                  <div className="summary-row">
                                    <span>Return barcode</span>
                                    <strong>{visibleShipmentExecution.returnShipment.barcode}</strong>
                                  </div>
                                ) : null}
                                {visibleShipmentExecution.returnShipment.labelUrl ? (
                                  <a
                                    className="inline-link"
                                    href={visibleShipmentExecution.returnShipment.labelUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    Open return label PDF
                                  </a>
                                ) : (
                                  <span className="muted">{getTryOtoReturnPendingLabel(visibleShipmentExecution.returnShipment)}</span>
                                )}
                                {isAdmin ? (
                                  <div className="shipment-recovery-actions" aria-label="Try OTO return details action">
                                    <strong>Return label discovery</strong>
                                    <span>Probe Try OTO getReturnDetails for label, AWB, PDF, tracking, and status metadata.</span>
                                    <div className="order-inline-actions">
                                      <button
                                        type="button"
                                        className="button button-secondary"
                                        onClick={handleProbeTryOtoReturnDetails}
                                        disabled={!canProbeTryOtoReturnDetails || isProbingTryOtoReturnDetails}
                                      >
                                        {isProbingTryOtoReturnDetails ? 'Probing...' : 'Probe Try OTO return details'}
                                      </button>
                                      <button
                                        type="button"
                                        className="button button-secondary"
                                        onClick={handleProbeTryOtoReturnLink}
                                        disabled={!canProbeTryOtoReturnDetails || isProbingTryOtoReturnLink}
                                      >
                                        {isProbingTryOtoReturnLink ? 'Probing...' : 'Probe Try OTO return link'}
                                      </button>
                                      <button
                                        type="button"
                                        className="button button-secondary"
                                        onClick={handleProbeTryOtoReturnAwbPrint}
                                        disabled={!canProbeTryOtoReturnAwbPrint || isProbingTryOtoReturnAwbPrint}
                                      >
                                        {isProbingTryOtoReturnAwbPrint ? 'Probing...' : 'Probe Try OTO return AWB print'}
                                      </button>
                                    </div>
                                    {tryOtoReturnProbeBlockedReason ? (
                                      <span className="muted">{tryOtoReturnProbeBlockedReason}</span>
                                    ) : null}
                                    {!canProbeTryOtoReturnAwbPrint && !tryOtoReturnProbeBlockedReason ? (
                                      <span className="muted">Return AWB print probe requires Try OTO return order id.</span>
                                    ) : null}
                                    {visibleShipmentExecution.returnShipment.detailsProbe ? (
                                      <span>
                                        Last probe: {formatOptionalDate(visibleShipmentExecution.returnShipment.detailsProbe.attemptedAt ?? undefined)}
                                        {' · '}
                                        status {visibleShipmentExecution.returnShipment.detailsProbe.providerStatus ?? '—'}
                                        {' · '}
                                        label/pdf/url{' '}
                                        {visibleShipmentExecution.returnShipment.detailsProbe.labelUrlPresent ||
                                        visibleShipmentExecution.returnShipment.detailsProbe.pdfLikeFieldsPresent ||
                                        visibleShipmentExecution.returnShipment.detailsProbe.urlLikeFieldsPresent
                                          ? 'present'
                                          : 'missing'}
                                        {' · '}
                                        tracking/barcode{' '}
                                        {visibleShipmentExecution.returnShipment.detailsProbe.trackingPresent ||
                                        visibleShipmentExecution.returnShipment.detailsProbe.barcodePresent
                                          ? 'present'
                                          : 'missing'}
                                      </span>
                                    ) : null}
                                    {visibleShipmentExecution.returnShipment.linkProbe ? (
                                      <span>
                                        Last link probe: {formatOptionalDate(visibleShipmentExecution.returnShipment.linkProbe.attemptedAt ?? undefined)}
                                        {' · '}
                                        status {visibleShipmentExecution.returnShipment.linkProbe.providerStatus ?? '—'}
                                        {' · '}
                                        label/pdf/url{' '}
                                        {visibleShipmentExecution.returnShipment.linkProbe.labelUrlPresent ||
                                        visibleShipmentExecution.returnShipment.linkProbe.pdfLikeFieldsPresent ||
                                        visibleShipmentExecution.returnShipment.linkProbe.urlLikeFieldsPresent
                                          ? 'present'
                                          : 'missing'}
                                        {' · '}
                                        action URL {visibleShipmentExecution.returnShipment.linkProbe.actionUrlPresent ? 'present' : 'missing'}
                                      </span>
                                    ) : null}
                                    <TryOtoReturnAwbPrintProbeSummary returnShipment={visibleShipmentExecution.returnShipment} />
                                  </div>
                                ) : null}
                                {isAdmin && visibleShipmentExecution.returnShipment.diagnostics ? (
                                  <details className="provider-response-summary admin-diagnostics-panel" aria-label="Try OTO return diagnostics">
                                    <summary className="provider-response-heading">
                                      <strong>Try OTO return diagnostics</strong>
                                      <span>Return diagnostics</span>
                                    </summary>
                                    <div className="summary-row">
                                      <span>Endpoint</span>
                                      <strong>{visibleShipmentExecution.returnShipment.diagnostics.endpoint ?? '—'}</strong>
                                    </div>
                                    <div className="summary-row">
                                      <span>HTTP</span>
                                      <strong>{visibleShipmentExecution.returnShipment.diagnostics.httpStatus ?? '—'}</strong>
                                    </div>
                                    <div className="summary-row">
                                      <span>Response keys</span>
                                      <strong>
                                        {visibleShipmentExecution.returnShipment.diagnostics.responseKeys.length
                                          ? visibleShipmentExecution.returnShipment.diagnostics.responseKeys.join(', ')
                                          : '—'}
                                      </strong>
                                    </div>
                                    <div className="summary-row">
                                      <span>Return provider id</span>
                                      <strong>{visibleShipmentExecution.returnShipment.diagnostics.returnProviderIdPresent ? 'present' : 'missing'}</strong>
                                    </div>
                                    <div className="summary-row">
                                      <span>Return tracking/barcode</span>
                                      <strong>
                                        {visibleShipmentExecution.returnShipment.diagnostics.returnTrackingPresent ||
                                        visibleShipmentExecution.returnShipment.diagnostics.returnBarcodePresent
                                          ? 'present'
                                          : 'missing'}
                                      </strong>
                                    </div>
                                    <div className="summary-row">
                                      <span>Return finalized</span>
                                      <strong>{visibleShipmentExecution.returnShipment.diagnostics.returnFinalized ? 'yes' : 'no'}</strong>
                                    </div>
                                    <div className="summary-row">
                                      <span>deliveryOptionId</span>
                                      <strong>
                                        {visibleShipmentExecution.returnShipment.diagnostics.returnDeliveryOptionIdPresent ? 'present' : 'missing'}
                                        {visibleShipmentExecution.returnShipment.diagnostics.returnDeliveryOptionIdSource
                                          ? ` · ${visibleShipmentExecution.returnShipment.diagnostics.returnDeliveryOptionIdSource}`
                                          : ''}
                                      </strong>
                                    </div>
                                    <div className="summary-row">
                                      <span>Forward delivery option</span>
                                      <strong>
                                        {visibleShipmentExecution.returnShipment.diagnostics.forwardDeliveryOptionIdPresent ? 'present' : 'missing'}
                                        {visibleShipmentExecution.returnShipment.diagnostics.forwardDeliveryOptionIdSource
                                          ? ` · ${visibleShipmentExecution.returnShipment.diagnostics.forwardDeliveryOptionIdSource}`
                                          : ''}
                                      </strong>
                                    </div>
                                    <div className="summary-row">
                                      <span>Forward option lifecycle</span>
                                      <strong>
                                        {visibleShipmentExecution.returnShipment.diagnostics.forwardDeliveryOptionPersistedAt ?? '—'}
                                        {' · webhook '}
                                        {visibleShipmentExecution.returnShipment.diagnostics.forwardDeliveryOptionRetainedAfterWebhook ? 'retained' : 'not seen'}
                                        {' · refresh '}
                                        {visibleShipmentExecution.returnShipment.diagnostics.forwardDeliveryOptionRetainedAfterStatusRefresh
                                          ? 'retained'
                                          : 'not seen'}
                                      </strong>
                                    </div>
                                    <div className="summary-row">
                                      <span>Return request fields</span>
                                      <strong>
                                        pickup {visibleShipmentExecution.returnShipment.diagnostics.pickupLocationCodePresent ? 'yes' : 'no'} · sku{' '}
                                        {visibleShipmentExecution.returnShipment.diagnostics.returnItemSkuPresent ? 'yes' : 'no'} · quantity{' '}
                                        {visibleShipmentExecution.returnShipment.diagnostics.returnItemQuantityPresent ? 'yes' : 'no'}
                                      </strong>
                                    </div>
                                    {visibleShipmentExecution.returnShipment.diagnostics.returnSkippedReason ? (
                                      <div className="summary-row">
                                        <span>Skipped reason</span>
                                        <strong>{visibleShipmentExecution.returnShipment.diagnostics.returnSkippedReason}</strong>
                                      </div>
                                    ) : null}
                                    <div className="summary-row">
                                      <span>Label retrievable</span>
                                      <strong>{visibleShipmentExecution.returnShipment.diagnostics.returnLabelRetrievable ? 'yes' : 'no'}</strong>
                                    </div>
                                    <div className="summary-row">
                                      <span>Label source</span>
                                      <strong>{visibleShipmentExecution.returnShipment.diagnostics.returnLabelSourceChecked ?? '—'}</strong>
                                    </div>
                                    <div className="summary-row">
                                      <span>Tracking source</span>
                                      <strong>{visibleShipmentExecution.returnShipment.diagnostics.returnTrackingSourceChecked ?? '—'}</strong>
                                    </div>
                                    <div className="summary-row">
                                      <span>Raw return label field</span>
                                      <strong>
                                        {visibleShipmentExecution.returnShipment.diagnostics.rawPrintReturnAwbUrlPresent ? 'present' : 'missing'}
                                      </strong>
                                    </div>
                                    <div className="summary-row">
                                      <span>Normalized label URL</span>
                                      <strong>
                                        {visibleShipmentExecution.returnShipment.diagnostics.normalizedReturnLabelUrlPresent ? 'present' : 'missing'}
                                      </strong>
                                    </div>
                                    <div className="summary-row">
                                      <span>Label persistence</span>
                                      <strong>
                                        {visibleShipmentExecution.returnShipment.diagnostics.returnLabelPersistenceStage ?? '—'}
                                        {' · stale overwrite '}
                                        {visibleShipmentExecution.returnShipment.diagnostics.returnLabelOverwrittenByStaleSnapshot ? 'yes' : 'no'}
                                      </strong>
                                    </div>
                                    <div className="summary-row">
                                      <span>Status source</span>
                                      <strong>{visibleShipmentExecution.returnShipment.diagnostics.providerStatusSource ?? '—'}</strong>
                                    </div>
                                    <div className="summary-row">
                                      <span>Provider message</span>
                                      <strong>{visibleShipmentExecution.returnShipment.diagnostics.providerMessage ?? '—'}</strong>
                                    </div>
                                  </details>
                                ) : null}
                                {isAdmin ? (
                                  <details className="provider-response-summary admin-diagnostics-panel" aria-label="Try OTO return details probe">
                                    <summary className="provider-response-heading">
                                      <strong>Try OTO return details probe</strong>
                                      <span>Return diagnostics</span>
                                    </summary>
                                    {visibleShipmentExecution.returnShipment.detailsProbe ? (
                                      <>
                                        <div className="summary-row">
                                          <span>Status</span>
                                          <strong>{toTitleCaseLabel(visibleShipmentExecution.returnShipment.detailsProbe.status)}</strong>
                                        </div>
                                        <div className="summary-row">
                                          <span>HTTP</span>
                                          <strong>{visibleShipmentExecution.returnShipment.detailsProbe.httpStatus ?? '—'}</strong>
                                        </div>
                                        <div className="summary-row">
                                          <span>Response keys</span>
                                          <strong>
                                            {visibleShipmentExecution.returnShipment.detailsProbe.responseKeys.length
                                              ? visibleShipmentExecution.returnShipment.detailsProbe.responseKeys.join(', ')
                                              : '—'}
                                          </strong>
                                        </div>
                                        <div className="summary-row">
                                          <span>Nested keys</span>
                                          <strong>
                                            {visibleShipmentExecution.returnShipment.detailsProbe.nestedKeys.length
                                              ? visibleShipmentExecution.returnShipment.detailsProbe.nestedKeys.slice(0, 12).join(', ')
                                              : '—'}
                                          </strong>
                                        </div>
                                        <div className="summary-row">
                                          <span>Label/AWB/PDF/URL fields</span>
                                          <strong>
                                            {[
                                              visibleShipmentExecution.returnShipment.detailsProbe.labelLikeFieldsPresent ? 'label' : null,
                                              visibleShipmentExecution.returnShipment.detailsProbe.awbLikeFieldsPresent ? 'awb' : null,
                                              visibleShipmentExecution.returnShipment.detailsProbe.pdfLikeFieldsPresent ? 'pdf' : null,
                                              visibleShipmentExecution.returnShipment.detailsProbe.urlLikeFieldsPresent ? 'url' : null,
                                            ].filter(Boolean).join(', ') || 'missing'}
                                          </strong>
                                        </div>
                                        <div className="summary-row">
                                          <span>Tracking/barcode</span>
                                          <strong>
                                            {[
                                              visibleShipmentExecution.returnShipment.detailsProbe.trackingPresent ? 'tracking' : null,
                                              visibleShipmentExecution.returnShipment.detailsProbe.barcodePresent ? 'barcode' : null,
                                            ].filter(Boolean).join(', ') || 'missing'}
                                          </strong>
                                        </div>
                                        <div className="summary-row">
                                          <span>Label URL</span>
                                          <strong>{visibleShipmentExecution.returnShipment.detailsProbe.labelUrlPresent ? 'present' : 'missing'}</strong>
                                        </div>
                                        {visibleShipmentExecution.returnShipment.detailsProbe.errorMessage ? (
                                          <div className="summary-row">
                                            <span>Message</span>
                                            <strong>{visibleShipmentExecution.returnShipment.detailsProbe.errorMessage}</strong>
                                          </div>
                                        ) : null}
                                      </>
                                    ) : null}
                                  </details>
                                ) : null}
                                {isAdmin ? (
                                  <details className="provider-response-summary admin-diagnostics-panel" aria-label="Shopify return label upload probe">
                                    <summary className="provider-response-heading">
                                      <strong>Shopify return label upload probe</strong>
                                      <span>Shopify sync diagnostics</span>
                                    </summary>
                                    <button
                                      type="button"
                                      className="secondary-action-button"
                                      onClick={handleProbeShopifyReturnLabelUpload}
                                      disabled={!canProbeShopifyReturnLabelUpload || isProbingShopifyReturnLabelUpload}
                                    >
                                      {isProbingShopifyReturnLabelUpload ? 'Probing Shopify...' : 'Probe Shopify return label upload'}
                                    </button>
                                    {!canProbeShopifyReturnLabelUpload ? (
                                      <span className="muted">
                                        Requires Shopify return id and Try OTO return tracking or barcode. PDF label upload is skipped until the provider returns a label URL.
                                      </span>
                                    ) : null}
                                    <div className="summary-row">
                                      <span>Shopify return id</span>
                                      <strong>{hasShopifyReturnIdForLabelProbe ? 'present' : 'missing'}</strong>
                                    </div>
                                    <div className="summary-row">
                                      <span>Return tracking/barcode</span>
                                      <strong>{hasReturnTrackingForLabelProbe ? 'present' : 'missing'}</strong>
                                    </div>
                                    <div className="summary-row">
                                      <span>Return label URL</span>
                                      <strong>{hasReturnLabelUrlForLabelProbe ? 'present' : 'missing'}</strong>
                                    </div>
                                    {visibleShipmentExecution.returnShipment.shopifyReturnLabelUploadProbe ? (
                                      <>
                                        {visibleShipmentExecution.returnShipment.shopifyReturnLabelUploadProbe.labelAccepted ? (
                                          <span>Shopify return label attached</span>
                                        ) : visibleShipmentExecution.returnShipment.shopifyReturnLabelUploadProbe.trackingAccepted ? (
                                          <span>Shopify return tracking attached. Customer can track return shipment in Shopify.</span>
                                        ) : null}
                                        <div className="summary-row">
                                          <span>Status</span>
                                          <strong>{toTitleCaseLabel(visibleShipmentExecution.returnShipment.shopifyReturnLabelUploadProbe.status)}</strong>
                                        </div>
                                        <div className="summary-row">
                                          <span>Shopify return id</span>
                                          <strong>
                                            {visibleShipmentExecution.returnShipment.shopifyReturnLabelUploadProbe.shopifyReturnIdPresent ? 'present' : 'missing'}
                                          </strong>
                                        </div>
                                        <div className="summary-row">
                                          <span>Mutation</span>
                                          <strong>{visibleShipmentExecution.returnShipment.shopifyReturnLabelUploadProbe.mutationUsed ?? '—'}</strong>
                                        </div>
                                        <div className="summary-row">
                                          <span>Reverse fulfillment order</span>
                                          <strong>
                                            {visibleShipmentExecution.returnShipment.shopifyReturnLabelUploadProbe.reverseFulfillmentOrderIdPresent ? 'present' : 'missing'}
                                          </strong>
                                        </div>
                                        <div className="summary-row">
                                          <span>Reverse line items</span>
                                          <strong>
                                            {visibleShipmentExecution.returnShipment.shopifyReturnLabelUploadProbe.reverseLineItemIdsPresent ? 'present' : 'missing'}
                                          </strong>
                                        </div>
                                        <div className="summary-row">
                                          <span>Reverse delivery id</span>
                                          <strong>
                                            {visibleShipmentExecution.returnShipment.shopifyReturnLabelUploadProbe.reverseDeliveryIdPresent ? 'present' : 'missing'}
                                          </strong>
                                        </div>
                                        <div className="summary-row">
                                          <span>Tracking accepted</span>
                                          <strong>{visibleShipmentExecution.returnShipment.shopifyReturnLabelUploadProbe.trackingAccepted ? 'yes' : 'no'}</strong>
                                        </div>
                                        <div className="summary-row">
                                          <span>Tracking-only mode</span>
                                          <strong>{visibleShipmentExecution.returnShipment.shopifyReturnLabelUploadProbe.trackingOnlyMode ? 'yes' : 'no'}</strong>
                                        </div>
                                        <div className="summary-row">
                                          <span>Label input sent</span>
                                          <strong>{visibleShipmentExecution.returnShipment.shopifyReturnLabelUploadProbe.labelInputSent ? 'yes' : 'no'}</strong>
                                        </div>
                                        <div className="summary-row">
                                          <span>Shopify call attempted</span>
                                          <strong>{visibleShipmentExecution.returnShipment.shopifyReturnLabelUploadProbe.shopifyCallAttempted ? 'yes' : 'no'}</strong>
                                        </div>
                                        <div className="summary-row">
                                          <span>Label accepted</span>
                                          <strong>{visibleShipmentExecution.returnShipment.shopifyReturnLabelUploadProbe.labelAccepted ? 'yes' : 'no'}</strong>
                                        </div>
                                        {visibleShipmentExecution.returnShipment.shopifyReturnLabelUploadProbe.returnedCarrierName ? (
                                          <div className="summary-row">
                                            <span>Shopify carrier</span>
                                            <strong>{visibleShipmentExecution.returnShipment.shopifyReturnLabelUploadProbe.returnedCarrierName}</strong>
                                          </div>
                                        ) : null}
                                        {visibleShipmentExecution.returnShipment.shopifyReturnLabelUploadProbe.skippedReason ? (
                                          <div className="summary-row">
                                            <span>Skipped reason</span>
                                            <strong>{visibleShipmentExecution.returnShipment.shopifyReturnLabelUploadProbe.skippedReason}</strong>
                                          </div>
                                        ) : null}
                                        {visibleShipmentExecution.returnShipment.shopifyReturnLabelUploadProbe.errorMessage ? (
                                          <div className="summary-row">
                                            <span>Message</span>
                                            <strong>{visibleShipmentExecution.returnShipment.shopifyReturnLabelUploadProbe.errorMessage}</strong>
                                          </div>
                                        ) : null}
                                        {visibleShipmentExecution.returnShipment.shopifyReturnLabelUploadProbe.shopifyUserErrors.length ? (
                                          <div className="summary-row">
                                            <span>Shopify user errors</span>
                                            <strong>
                                              {visibleShipmentExecution.returnShipment.shopifyReturnLabelUploadProbe.shopifyUserErrors
                                                .map((error) => [error.field.join('.'), error.message].filter(Boolean).join(': '))
                                                .join('; ')}
                                            </strong>
                                          </div>
                                        ) : null}
                                      </>
                                    ) : null}
                                  </details>
                                ) : null}
                              </>
                            ) : (
                              <>
                                <span>Create a sandbox Try OTO reverse shipment label for this delivered shipment.</span>
                                <button
                                  type="button"
                                  className="secondary-action-button"
                                  onClick={handleCreateReturnShipmentLabel}
                                  disabled={!canCreateTryOtoReturnLabel || isCreatingReturnShipmentLabel}
                                >
                                  {isCreatingReturnShipmentLabel ? 'Creating return label...' : 'Create return label'}
                                </button>
                                {!canCreateTryOtoReturnLabel ? (
                                  <span className="muted">Available after a Try OTO shipment is delivered and has a provider reference.</span>
                                ) : null}
                              </>
                            )}
                          </div>
                        ) : null}
                      </>
                    ) : null}
                        {visibleShipmentExecution?.shippingCost ? (
                          <div className="summary-row">
                            <span>Shipping cost</span>
                            <strong>{formatCurrency(visibleShipmentExecution.shippingCost, visibleShipmentExecution.currency)}</strong>
                          </div>
                        ) : null}
                        {isAdmin && visibleShipmentExecution?.timeline?.length ? (
                          <div className="shipment-mini-timeline" aria-label="Shipment timeline">
                            {visibleShipmentExecution.timeline.map((event) => (
                              <div className="summary-row" key={`${event.label}-${event.at}`}>
                                <span>{event.label}</span>
                                <strong>{event.status ? `${toTitleCaseLabel(event.status)} · ` : ''}{formatOptionalDate(event.at)}</strong>
                              </div>
                            ))}
                          </div>
                        ) : null}
                        {shopifyFulfillmentSyncSummary ? (
                          <div className="shipment-recovery-actions" aria-label="Shopify fulfillment status">
                            <strong>Shopify fulfillment</strong>
                            <span>
                              {shopifyFulfillmentSyncSummary.label}
                              {' · '}
                              {shopifyFulfillmentSyncSummary.message}
                            </span>
                            {isAdmin && order.shopifyFulfillmentSync ? (
                              <details className="provider-response-summary admin-diagnostics-panel" aria-label="Shopify fulfillment diagnostics">
                                <summary className="provider-response-heading">
                                  <strong>Shopify fulfillment diagnostics</strong>
                                  <span>Shopify sync diagnostics</span>
                                </summary>
                                <div className="summary-row">
                                  <span>Fulfillment order id present</span>
                                  <strong>{order.shopifyFulfillmentSync.fulfillmentOrderIdPresent ? 'yes' : 'no'}</strong>
                                </div>
                                <div className="summary-row">
                                  <span>Shopify fulfillment id present</span>
                                  <strong>{order.shopifyFulfillmentSync.fulfillmentIdPresent ? 'yes' : 'no'}</strong>
                                </div>
                                <div className="summary-row">
                                  <span>Sync status</span>
                                  <strong>{order.shopifyFulfillmentSync.syncStatus || order.shopifyFulfillmentSync.status}</strong>
                                </div>
                                <div className="summary-row">
                                  <span>Skipped reason</span>
                                  <strong>{order.shopifyFulfillmentSync.skippedReason || '—'}</strong>
                                </div>
                                <div className="summary-row">
                                  <span>Sync error</span>
                                  <strong>{order.shopifyFulfillmentSync.errorMessage || '—'}</strong>
                                </div>
                                <div className="summary-row">
                                  <span>Last attempted</span>
                                  <strong>{formatOptionalDate(order.shopifyFulfillmentSync.lastAttemptedAt ?? undefined)}</strong>
                                </div>
                              </details>
                            ) : null}
                          </div>
                        ) : null}
                        <ShopifyReturnSignalDiagnostics order={order} isAdmin={isAdmin} />
                        {canRefreshTryOtoShipmentStatus ? (
                          <div className="shipment-recovery-actions" aria-label="Try OTO shipment status refresh">
                            <strong>Try OTO status refresh</strong>
                            <span>Shipment was created. Tracking or label may still be processing.</span>
                            <span>Status will refresh automatically while OTO finishes label generation.</span>
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
                        {canSyncShipmentTrackingToShopify ? (
                          <div className="shipment-recovery-actions" aria-label="Shopify tracking sync">
                            <strong>Shopify fulfillment sync</strong>
                            <span>Tracking is available locally. Sync it to Shopify fulfillment when ready.</span>
                            <div className="order-inline-actions">
                              <button
                                type="button"
                                className="button button-primary"
                                disabled={isSubmittingTracking}
                                onClick={handleSyncShipmentTrackingToShopify}
                              >
                                {isSubmittingTracking ? 'Syncing...' : 'Sync tracking to Shopify'}
                              </button>
                            </div>
                          </div>
                        ) : null}
                        {shouldShowShipmentProviderSummary && shipmentProviderSummary ? (
                          <details
                            id="provider-response-summary"
                            className="provider-response-summary admin-diagnostics-panel"
                            aria-label="Provider response summary"
                            open={canRetryDryRunShipment || canRecoverFailedShipment || shouldShowRecoveryShipmentFieldCompletionForm}
                          >
                            <summary className="provider-response-heading">
                              <strong>Provider response summary</strong>
                              <span>Provider diagnostics</span>
                            </summary>
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
                          </details>
                        ) : null}
                        {shouldShowFailedShipmentRetryDiagnostics && (!shipmentProviderSummary || !isAdmin) ? (
                          <div id="shipment-retry-diagnostics" className="shipment-recovery-actions" aria-label="Shipment retry eligibility">
                            <strong>{isAdmin ? 'Shipment recovery' : 'Shipment needs attention'}</strong>
                            <span>
                              {isAdmin
                                ? `Retry eligible: ${canRecoverFailedShipment ? 'yes' : 'no'}${
                                    failedShipmentRetryBlockedReason ? ` · ${failedShipmentRetryBlockedReason}` : ''
                                  }`
                                : canRecoverFailedShipment
                                  ? 'Retry shipment after reviewing any required shipment-only fields.'
                                  : 'Shipment recovery is not available for this shipment.'}
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
                                {isAdmin ? (
                                  <a className="button button-secondary button-link" href="#shipment-retry-diagnostics">
                                    View diagnostics
                                  </a>
                                ) : null}
                              </div>
                            ) : null}
                            {shouldShowRecoveryShipmentFieldCompletionForm ? renderShipmentFieldCompletionForm() : null}
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
                        <strong>{isAdmin ? shipmentActionState.message : getVendorShipmentActionMessage(shipmentActionState)}</strong>
                        {isAdmin ? (
                          <>
                            <span>Endpoint: {shipmentActionState.endpoint ?? shipmentActionState.diagnostics?.endpoint ?? 'POST /shipments/create'}</span>
                            {shipmentActionState.diagnostics ? (
                              <span>
                                HTTP: {shipmentActionState.diagnostics.status ?? '—'}
                                {shipmentActionState.diagnostics.requestId ? ` · Request: ${shipmentActionState.diagnostics.requestId}` : ''}
                              </span>
                            ) : null}
                            {shipmentActionState.shipment ? (
                              <span>{getShipmentActionEvidenceSummary(shipmentActionState)}</span>
                            ) : null}
                          </>
                        ) : null}
                        {renderShipmentFieldCompletionForm()}
                      </div>
                    ) : null}
                    {shippingProviderDiagnostics && shippingConfigEditorForm ? (
                      <details className="shipping-provider-diagnostics admin-diagnostics-panel" aria-label="Shipping provider diagnostics">
                        <summary className="provider-response-heading">
                          <strong>Shipping provider diagnostics</strong>
                          <span>Provider diagnostics</span>
                        </summary>
                        {shippingConfigEditorForm}
                        {shippingProviderDiagnostics.provider === 'try_oto' ? (
                          <>
                            <div className="summary-row">
                              <span>Try OTO pickup location</span>
                              <strong>{tryOtoPickupLocationCode || '—'}</strong>
                            </div>
                            <div className="summary-row">
                              <span>Try OTO origin city configured</span>
                              <strong>{tryOtoOriginCity ? 'yes' : 'no'}</strong>
                            </div>
                          </>
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
                      </details>
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
                {(isAdmin || canUseFulfillmentActions) && (shipmentExecution || hasTrackingSync || hasShopifyFulfillmentSyncAttempt) ? (
                  <div className="tracking-summary-card order-tracking-summary-card">
                    {shipmentExecution ? (
                      <>
                        <div className="summary-row">
                          <span>Shipment provider</span>
                          <strong>{formatShippingProviderName(shipmentExecution.provider)}</strong>
                        </div>
                        <div className="summary-row">
                          <span>Carrier status</span>
                          <strong>{getOperationalShipmentStatusLabel(shipmentExecution.shipmentStatus)}</strong>
                        </div>
                        {shipmentExecution.warehouseId ? (
                          <div className="summary-row">
                            <span>Warehouse</span>
                            <strong>{shipmentExecution.warehouseId}</strong>
                          </div>
                        ) : null}
                      </>
                    ) : null}
                    <div className="summary-row">
                      <span>Tracking</span>
                      <strong className={order.trackingNumber || shipmentExecution?.trackingNumber ? '' : 'muted'}>
                        {getShipmentTrackingNumber(order, shipmentExecution) ?? 'Not available'}
                      </strong>
                    </div>
                    <div className="summary-row">
                      <span>Carrier</span>
                      <strong className={order.carrier ? '' : 'muted'}>{formatShippingProviderName(order.carrier) || 'Not available'}</strong>
                    </div>
                    <div className="summary-row">
                      <span>Tracking link</span>
                      {getShipmentTrackingUrl(order, shipmentExecution) ? (
                        <a className="inline-link" href={getShipmentTrackingUrl(order, shipmentExecution) || undefined} target="_blank" rel="noreferrer">
                          Open tracking
                        </a>
                      ) : (
                        <strong className="muted">Not available</strong>
                      )}
                    </div>
                    {shipmentExecution?.labelUrl ? (
                      <div className="summary-row">
                        <span>Label</span>
                        <a className="inline-link" href={shipmentExecution.labelUrl} target="_blank" rel="noreferrer">
                          Open label PDF
                        </a>
                      </div>
                    ) : null}
                    {visibleShipmentExecution?.provider === 'try_oto' && visibleShipmentExecution.returnShipment ? (
                      <div className="shipment-recovery-actions" aria-label="Try OTO return shipment">
                        <strong>Try OTO return shipment</strong>
                        <span>
                          {getTryOtoReturnStatusLabel(visibleShipmentExecution.returnShipment)}
                          {visibleShipmentExecution.returnShipment.returnOrderId ? ` · ${visibleShipmentExecution.returnShipment.returnOrderId}` : ''}
                        </span>
                        {visibleShipmentExecution.returnShipment.trackingNumber ? (
                          <div className="summary-row">
                            <span>Return tracking</span>
                            <strong>{visibleShipmentExecution.returnShipment.trackingNumber}</strong>
                            {visibleShipmentExecution.returnShipment.trackingUrl ? (
                              <a className="inline-link" href={visibleShipmentExecution.returnShipment.trackingUrl} target="_blank" rel="noreferrer">
                                Open return tracking
                              </a>
                            ) : null}
                          </div>
                        ) : null}
                        {visibleShipmentExecution.returnShipment.carrierName ? (
                          <div className="summary-row">
                            <span>Return carrier</span>
                            <strong>{visibleShipmentExecution.returnShipment.carrierName}</strong>
                          </div>
                        ) : null}
                        {visibleShipmentExecution.returnShipment.barcode ? (
                          <div className="summary-row">
                            <span>Return barcode</span>
                            <strong>{visibleShipmentExecution.returnShipment.barcode}</strong>
                          </div>
                        ) : null}
                        {visibleShipmentExecution.returnShipment.labelUrl ? (
                          <a className="inline-link" href={visibleShipmentExecution.returnShipment.labelUrl} target="_blank" rel="noreferrer">
                            Open return label PDF
                          </a>
                        ) : (
                          <span className="muted">{getTryOtoReturnPendingLabel(visibleShipmentExecution.returnShipment)}</span>
                        )}
                        {isAdmin ? (
                          <div className="shipment-recovery-actions" aria-label="Try OTO return details action">
                            <strong>Return label discovery</strong>
                            <span>Probe Try OTO getReturnDetails for label, AWB, PDF, tracking, and status metadata.</span>
                            <div className="order-inline-actions">
                              <button
                                type="button"
                                className="button button-secondary"
                                onClick={handleProbeTryOtoReturnDetails}
                                disabled={!canProbeTryOtoReturnDetails || isProbingTryOtoReturnDetails}
                              >
                                {isProbingTryOtoReturnDetails ? 'Probing...' : 'Probe Try OTO return details'}
                              </button>
                              <button
                                type="button"
                                className="button button-secondary"
                                onClick={handleProbeTryOtoReturnLink}
                                disabled={!canProbeTryOtoReturnDetails || isProbingTryOtoReturnLink}
                              >
                                {isProbingTryOtoReturnLink ? 'Probing...' : 'Probe Try OTO return link'}
                              </button>
                              <button
                                type="button"
                                className="button button-secondary"
                                onClick={handleProbeTryOtoReturnAwbPrint}
                                disabled={!canProbeTryOtoReturnAwbPrint || isProbingTryOtoReturnAwbPrint}
                              >
                                {isProbingTryOtoReturnAwbPrint ? 'Probing...' : 'Probe Try OTO return AWB print'}
                              </button>
                            </div>
                            {tryOtoReturnProbeBlockedReason ? (
                              <span className="muted">{tryOtoReturnProbeBlockedReason}</span>
                            ) : null}
                            {!canProbeTryOtoReturnAwbPrint && !tryOtoReturnProbeBlockedReason ? (
                              <span className="muted">Return AWB print probe requires Try OTO return order id.</span>
                            ) : null}
                            {visibleShipmentExecution.returnShipment.detailsProbe ? (
                              <span>
                                Last probe: {formatOptionalDate(visibleShipmentExecution.returnShipment.detailsProbe.attemptedAt ?? undefined)}
                                {' · '}
                                status {visibleShipmentExecution.returnShipment.detailsProbe.providerStatus ?? '—'}
                                {' · '}
                                label/pdf/url{' '}
                                {visibleShipmentExecution.returnShipment.detailsProbe.labelUrlPresent ||
                                visibleShipmentExecution.returnShipment.detailsProbe.pdfLikeFieldsPresent ||
                                visibleShipmentExecution.returnShipment.detailsProbe.urlLikeFieldsPresent
                                  ? 'present'
                                  : 'missing'}
                                {' · '}
                                tracking/barcode{' '}
                                {visibleShipmentExecution.returnShipment.detailsProbe.trackingPresent ||
                                visibleShipmentExecution.returnShipment.detailsProbe.barcodePresent
                                  ? 'present'
                                  : 'missing'}
                              </span>
                            ) : null}
                            {visibleShipmentExecution.returnShipment.linkProbe ? (
                              <span>
                                Last link probe: {formatOptionalDate(visibleShipmentExecution.returnShipment.linkProbe.attemptedAt ?? undefined)}
                                {' · '}
                                status {visibleShipmentExecution.returnShipment.linkProbe.providerStatus ?? '—'}
                                {' · '}
                                label/pdf/url{' '}
                                {visibleShipmentExecution.returnShipment.linkProbe.labelUrlPresent ||
                                visibleShipmentExecution.returnShipment.linkProbe.pdfLikeFieldsPresent ||
                                visibleShipmentExecution.returnShipment.linkProbe.urlLikeFieldsPresent
                                  ? 'present'
                                  : 'missing'}
                                {' · '}
                                action URL {visibleShipmentExecution.returnShipment.linkProbe.actionUrlPresent ? 'present' : 'missing'}
                              </span>
                            ) : null}
                            <TryOtoReturnAwbPrintProbeSummary returnShipment={visibleShipmentExecution.returnShipment} />
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    {isAdmin && visibleShipmentExecution?.provider === 'try_oto' && visibleShipmentExecution.returnShipment?.diagnostics ? (
                      <details className="provider-response-summary admin-diagnostics-panel" aria-label="Try OTO return diagnostics">
                        <summary className="provider-response-heading">
                          <strong>Try OTO return diagnostics</strong>
                          <span>Return diagnostics</span>
                        </summary>
                        <div className="summary-row">
                          <span>Endpoint</span>
                          <strong>{visibleShipmentExecution.returnShipment.diagnostics.endpoint ?? '—'}</strong>
                        </div>
                        <div className="summary-row">
                          <span>HTTP</span>
                          <strong>{visibleShipmentExecution.returnShipment.diagnostics.httpStatus ?? '—'}</strong>
                        </div>
                        <div className="summary-row">
                          <span>Response keys</span>
                          <strong>
                            {visibleShipmentExecution.returnShipment.diagnostics.responseKeys.length
                              ? visibleShipmentExecution.returnShipment.diagnostics.responseKeys.join(', ')
                              : '—'}
                          </strong>
                        </div>
                        <div className="summary-row">
                          <span>Return provider id</span>
                          <strong>{visibleShipmentExecution.returnShipment.diagnostics.returnProviderIdPresent ? 'present' : 'missing'}</strong>
                        </div>
                        <div className="summary-row">
                          <span>Return finalized</span>
                          <strong>{visibleShipmentExecution.returnShipment.diagnostics.returnFinalized ? 'yes' : 'no'}</strong>
                        </div>
                        <div className="summary-row">
                          <span>deliveryOptionId</span>
                          <strong>
                            {visibleShipmentExecution.returnShipment.diagnostics.returnDeliveryOptionIdPresent ? 'present' : 'missing'}
                            {visibleShipmentExecution.returnShipment.diagnostics.returnDeliveryOptionIdSource
                              ? ` · ${visibleShipmentExecution.returnShipment.diagnostics.returnDeliveryOptionIdSource}`
                              : ''}
                          </strong>
                        </div>
                        <div className="summary-row">
                          <span>Forward delivery option</span>
                          <strong>
                            {visibleShipmentExecution.returnShipment.diagnostics.forwardDeliveryOptionIdPresent ? 'present' : 'missing'}
                            {visibleShipmentExecution.returnShipment.diagnostics.forwardDeliveryOptionIdSource
                              ? ` · ${visibleShipmentExecution.returnShipment.diagnostics.forwardDeliveryOptionIdSource}`
                              : ''}
                          </strong>
                        </div>
                        <div className="summary-row">
                          <span>Forward option lifecycle</span>
                          <strong>
                            {visibleShipmentExecution.returnShipment.diagnostics.forwardDeliveryOptionPersistedAt ?? '—'}
                            {' · webhook '}
                            {visibleShipmentExecution.returnShipment.diagnostics.forwardDeliveryOptionRetainedAfterWebhook ? 'retained' : 'not seen'}
                            {' · refresh '}
                            {visibleShipmentExecution.returnShipment.diagnostics.forwardDeliveryOptionRetainedAfterStatusRefresh
                              ? 'retained'
                              : 'not seen'}
                          </strong>
                        </div>
                        <div className="summary-row">
                          <span>Return request fields</span>
                          <strong>
                            pickup {visibleShipmentExecution.returnShipment.diagnostics.pickupLocationCodePresent ? 'yes' : 'no'} · sku{' '}
                            {visibleShipmentExecution.returnShipment.diagnostics.returnItemSkuPresent ? 'yes' : 'no'} · quantity{' '}
                            {visibleShipmentExecution.returnShipment.diagnostics.returnItemQuantityPresent ? 'yes' : 'no'}
                          </strong>
                        </div>
                        {visibleShipmentExecution.returnShipment.diagnostics.returnSkippedReason ? (
                          <div className="summary-row">
                            <span>Skipped reason</span>
                            <strong>{visibleShipmentExecution.returnShipment.diagnostics.returnSkippedReason}</strong>
                          </div>
                        ) : null}
                        <div className="summary-row">
                          <span>Label retrievable</span>
                          <strong>{visibleShipmentExecution.returnShipment.diagnostics.returnLabelRetrievable ? 'yes' : 'no'}</strong>
                        </div>
                        <div className="summary-row">
                          <span>Label source</span>
                          <strong>{visibleShipmentExecution.returnShipment.diagnostics.returnLabelSourceChecked ?? '—'}</strong>
                        </div>
                        <div className="summary-row">
                          <span>Tracking source</span>
                          <strong>{visibleShipmentExecution.returnShipment.diagnostics.returnTrackingSourceChecked ?? '—'}</strong>
                        </div>
                        <div className="summary-row">
                          <span>Raw return label field</span>
                          <strong>{visibleShipmentExecution.returnShipment.diagnostics.rawPrintReturnAwbUrlPresent ? 'present' : 'missing'}</strong>
                        </div>
                        <div className="summary-row">
                          <span>Normalized label URL</span>
                          <strong>{visibleShipmentExecution.returnShipment.diagnostics.normalizedReturnLabelUrlPresent ? 'present' : 'missing'}</strong>
                        </div>
                        <div className="summary-row">
                          <span>Label persistence</span>
                          <strong>
                            {visibleShipmentExecution.returnShipment.diagnostics.returnLabelPersistenceStage ?? '—'}
                            {' · stale overwrite '}
                            {visibleShipmentExecution.returnShipment.diagnostics.returnLabelOverwrittenByStaleSnapshot ? 'yes' : 'no'}
                          </strong>
                        </div>
                        <div className="summary-row">
                          <span>Status source</span>
                          <strong>{visibleShipmentExecution.returnShipment.diagnostics.providerStatusSource ?? '—'}</strong>
                        </div>
                        <div className="summary-row">
                          <span>Provider message</span>
                          <strong>{visibleShipmentExecution.returnShipment.diagnostics.providerMessage ?? '—'}</strong>
                        </div>
                      </details>
                    ) : null}
                    {isAdmin && visibleShipmentExecution?.provider === 'try_oto' && visibleShipmentExecution.returnShipment ? (
                      <details className="provider-response-summary admin-diagnostics-panel" aria-label="Try OTO return details probe">
                        <summary className="provider-response-heading">
                          <strong>Try OTO return details probe</strong>
                          <span>Return diagnostics</span>
                        </summary>
                        {visibleShipmentExecution.returnShipment.detailsProbe ? (
                          <>
                            <div className="summary-row">
                              <span>Status</span>
                              <strong>{toTitleCaseLabel(visibleShipmentExecution.returnShipment.detailsProbe.status)}</strong>
                            </div>
                            <div className="summary-row">
                              <span>HTTP</span>
                              <strong>{visibleShipmentExecution.returnShipment.detailsProbe.httpStatus ?? '—'}</strong>
                            </div>
                            <div className="summary-row">
                              <span>Response keys</span>
                              <strong>
                                {visibleShipmentExecution.returnShipment.detailsProbe.responseKeys.length
                                  ? visibleShipmentExecution.returnShipment.detailsProbe.responseKeys.join(', ')
                                  : '—'}
                              </strong>
                            </div>
                            <div className="summary-row">
                              <span>Nested keys</span>
                              <strong>
                                {visibleShipmentExecution.returnShipment.detailsProbe.nestedKeys.length
                                  ? visibleShipmentExecution.returnShipment.detailsProbe.nestedKeys.slice(0, 12).join(', ')
                                  : '—'}
                              </strong>
                            </div>
                            <div className="summary-row">
                              <span>Label/AWB/PDF/URL fields</span>
                              <strong>
                                {[
                                  visibleShipmentExecution.returnShipment.detailsProbe.labelLikeFieldsPresent ? 'label' : null,
                                  visibleShipmentExecution.returnShipment.detailsProbe.awbLikeFieldsPresent ? 'awb' : null,
                                  visibleShipmentExecution.returnShipment.detailsProbe.pdfLikeFieldsPresent ? 'pdf' : null,
                                  visibleShipmentExecution.returnShipment.detailsProbe.urlLikeFieldsPresent ? 'url' : null,
                                ].filter(Boolean).join(', ') || 'missing'}
                              </strong>
                            </div>
                            <div className="summary-row">
                              <span>Label URL</span>
                              <strong>{visibleShipmentExecution.returnShipment.detailsProbe.labelUrlPresent ? 'present' : 'missing'}</strong>
                            </div>
                            {visibleShipmentExecution.returnShipment.detailsProbe.errorMessage ? (
                              <div className="summary-row">
                                <span>Message</span>
                                <strong>{visibleShipmentExecution.returnShipment.detailsProbe.errorMessage}</strong>
                              </div>
                            ) : null}
                          </>
                        ) : null}
                      </details>
                    ) : null}
                    {isAdmin && visibleShipmentExecution?.provider === 'try_oto' && visibleShipmentExecution.returnShipment ? (
                      <details className="provider-response-summary admin-diagnostics-panel" aria-label="Shopify return label upload probe">
                        <summary className="provider-response-heading">
                          <strong>Shopify return label upload probe</strong>
                          <span>Shopify sync diagnostics</span>
                        </summary>
                        <button
                          type="button"
                          className="secondary-action-button"
                          onClick={handleProbeShopifyReturnLabelUpload}
                          disabled={!canProbeShopifyReturnLabelUpload || isProbingShopifyReturnLabelUpload}
                        >
                          {isProbingShopifyReturnLabelUpload ? 'Probing Shopify...' : 'Probe Shopify return label upload'}
                        </button>
                        {!canProbeShopifyReturnLabelUpload ? (
                          <span className="muted">
                            Requires Shopify return id and Try OTO return tracking or barcode. PDF label upload is skipped until the provider returns a label URL.
                          </span>
                        ) : null}
                        <div className="summary-row">
                          <span>Shopify return id</span>
                          <strong>{hasShopifyReturnIdForLabelProbe ? 'present' : 'missing'}</strong>
                        </div>
                        <div className="summary-row">
                          <span>Return tracking/barcode</span>
                          <strong>{hasReturnTrackingForLabelProbe ? 'present' : 'missing'}</strong>
                        </div>
                        <div className="summary-row">
                          <span>Return label URL</span>
                          <strong>{hasReturnLabelUrlForLabelProbe ? 'present' : 'missing'}</strong>
                        </div>
                        {visibleShipmentExecution.returnShipment.shopifyReturnLabelUploadProbe ? (
                          <>
                            {visibleShipmentExecution.returnShipment.shopifyReturnLabelUploadProbe.labelAccepted ? (
                              <span>Shopify return label attached</span>
                            ) : visibleShipmentExecution.returnShipment.shopifyReturnLabelUploadProbe.trackingAccepted ? (
                              <span>Shopify return tracking attached. Customer can track return shipment in Shopify.</span>
                            ) : null}
                            <div className="summary-row">
                              <span>Status</span>
                              <strong>{toTitleCaseLabel(visibleShipmentExecution.returnShipment.shopifyReturnLabelUploadProbe.status)}</strong>
                            </div>
                            <div className="summary-row">
                              <span>Shopify return id</span>
                              <strong>
                                {visibleShipmentExecution.returnShipment.shopifyReturnLabelUploadProbe.shopifyReturnIdPresent ? 'present' : 'missing'}
                              </strong>
                            </div>
                            <div className="summary-row">
                              <span>Mutation</span>
                              <strong>{visibleShipmentExecution.returnShipment.shopifyReturnLabelUploadProbe.mutationUsed ?? '—'}</strong>
                            </div>
                            <div className="summary-row">
                              <span>Reverse fulfillment order</span>
                              <strong>
                                {visibleShipmentExecution.returnShipment.shopifyReturnLabelUploadProbe.reverseFulfillmentOrderIdPresent ? 'present' : 'missing'}
                              </strong>
                            </div>
                            <div className="summary-row">
                              <span>Reverse line items</span>
                              <strong>
                                {visibleShipmentExecution.returnShipment.shopifyReturnLabelUploadProbe.reverseLineItemIdsPresent ? 'present' : 'missing'}
                              </strong>
                            </div>
                            <div className="summary-row">
                              <span>Reverse delivery id</span>
                              <strong>
                                {visibleShipmentExecution.returnShipment.shopifyReturnLabelUploadProbe.reverseDeliveryIdPresent ? 'present' : 'missing'}
                              </strong>
                            </div>
                            <div className="summary-row">
                              <span>Tracking accepted</span>
                              <strong>{visibleShipmentExecution.returnShipment.shopifyReturnLabelUploadProbe.trackingAccepted ? 'yes' : 'no'}</strong>
                            </div>
                            <div className="summary-row">
                              <span>Tracking-only mode</span>
                              <strong>{visibleShipmentExecution.returnShipment.shopifyReturnLabelUploadProbe.trackingOnlyMode ? 'yes' : 'no'}</strong>
                            </div>
                            <div className="summary-row">
                              <span>Label input sent</span>
                              <strong>{visibleShipmentExecution.returnShipment.shopifyReturnLabelUploadProbe.labelInputSent ? 'yes' : 'no'}</strong>
                            </div>
                            <div className="summary-row">
                              <span>Shopify call attempted</span>
                              <strong>{visibleShipmentExecution.returnShipment.shopifyReturnLabelUploadProbe.shopifyCallAttempted ? 'yes' : 'no'}</strong>
                            </div>
                            <div className="summary-row">
                              <span>Label accepted</span>
                              <strong>{visibleShipmentExecution.returnShipment.shopifyReturnLabelUploadProbe.labelAccepted ? 'yes' : 'no'}</strong>
                            </div>
                            {visibleShipmentExecution.returnShipment.shopifyReturnLabelUploadProbe.returnedCarrierName ? (
                              <div className="summary-row">
                                <span>Shopify carrier</span>
                                <strong>{visibleShipmentExecution.returnShipment.shopifyReturnLabelUploadProbe.returnedCarrierName}</strong>
                              </div>
                            ) : null}
                            {visibleShipmentExecution.returnShipment.shopifyReturnLabelUploadProbe.skippedReason ? (
                              <div className="summary-row">
                                <span>Skipped reason</span>
                                <strong>{visibleShipmentExecution.returnShipment.shopifyReturnLabelUploadProbe.skippedReason}</strong>
                              </div>
                            ) : null}
                            {visibleShipmentExecution.returnShipment.shopifyReturnLabelUploadProbe.errorMessage ? (
                              <div className="summary-row">
                                <span>Message</span>
                                <strong>{visibleShipmentExecution.returnShipment.shopifyReturnLabelUploadProbe.errorMessage}</strong>
                              </div>
                            ) : null}
                            {visibleShipmentExecution.returnShipment.shopifyReturnLabelUploadProbe.shopifyUserErrors.length ? (
                              <div className="summary-row">
                                <span>Shopify user errors</span>
                                <strong>
                                  {visibleShipmentExecution.returnShipment.shopifyReturnLabelUploadProbe.shopifyUserErrors
                                    .map((error) => [error.field.join('.'), error.message].filter(Boolean).join(': '))
                                    .join('; ')}
                                </strong>
                              </div>
                            ) : null}
                          </>
                        ) : null}
                      </details>
                    ) : null}
                    {shopifyFulfillmentSyncSummary ? (
                      <div className="shipment-recovery-actions" aria-label="Shopify fulfillment status">
                        <strong>Shopify fulfillment</strong>
                        <span>
                          {shopifyFulfillmentSyncSummary.label}
                          {' · '}
                          {shopifyFulfillmentSyncSummary.message}
                        </span>
                        {isAdmin && order.shopifyFulfillmentSync ? (
                          <details className="provider-response-summary admin-diagnostics-panel" aria-label="Shopify fulfillment diagnostics">
                            <summary className="provider-response-heading">
                              <strong>Shopify fulfillment diagnostics</strong>
                              <span>Shopify sync diagnostics</span>
                            </summary>
                            <div className="summary-row">
                              <span>Fulfillment order id present</span>
                              <strong>{order.shopifyFulfillmentSync.fulfillmentOrderIdPresent ? 'yes' : 'no'}</strong>
                            </div>
                            <div className="summary-row">
                              <span>Shopify fulfillment id present</span>
                              <strong>{order.shopifyFulfillmentSync.fulfillmentIdPresent ? 'yes' : 'no'}</strong>
                            </div>
                            <div className="summary-row">
                              <span>Sync status</span>
                              <strong>{order.shopifyFulfillmentSync.syncStatus || order.shopifyFulfillmentSync.status}</strong>
                            </div>
                            <div className="summary-row">
                              <span>Skipped reason</span>
                              <strong>{order.shopifyFulfillmentSync.skippedReason || '—'}</strong>
                            </div>
                            <div className="summary-row">
                              <span>Sync error</span>
                              <strong>{order.shopifyFulfillmentSync.errorMessage || '—'}</strong>
                            </div>
                            <div className="summary-row">
                              <span>Last attempted</span>
                              <strong>{formatOptionalDate(order.shopifyFulfillmentSync.lastAttemptedAt ?? undefined)}</strong>
                            </div>
                          </details>
                        ) : null}
                      </div>
                    ) : null}
                    <ShopifyReturnSignalDiagnostics order={order} isAdmin={isAdmin} />
                    {canRefreshTryOtoShipmentStatus ? (
                      <div className="shipment-recovery-actions" aria-label="Try OTO shipment status refresh">
                        <strong>Try OTO status refresh</strong>
                        <span>Shipment was created. Tracking or label may still be processing.</span>
                        <span>Status will refresh automatically while OTO finishes label generation.</span>
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
                    {canSyncShipmentTrackingToShopify ? (
                      <div className="shipment-recovery-actions" aria-label="Shopify tracking sync">
                        <strong>Shopify fulfillment sync</strong>
                        <span>Tracking is available locally. Sync it to Shopify fulfillment when ready.</span>
                        <div className="order-inline-actions">
                          <button
                            type="button"
                            className="button button-primary"
                            disabled={isSubmittingTracking}
                            onClick={handleSyncShipmentTrackingToShopify}
                          >
                            {isSubmittingTracking ? 'Syncing...' : 'Sync tracking to Shopify'}
                          </button>
                        </div>
                      </div>
                    ) : null}
                    {shouldShowShipmentProviderSummary && shipmentProviderSummary ? (
                      <details
                        id="provider-response-summary"
                        className="provider-response-summary admin-diagnostics-panel"
                        aria-label="Provider response summary"
                        open={canRetryDryRunShipment || canRecoverFailedShipment || shouldShowRecoveryShipmentFieldCompletionForm}
                      >
                        <summary className="provider-response-heading">
                          <strong>Provider response summary</strong>
                          <span>Provider diagnostics</span>
                        </summary>
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
                        {shipmentProviderSummary.tryOtoFinalization?.lastWebhookReceivedAt ||
                        shipmentProviderSummary.tryOtoFinalization?.lastWebhookMatchStatus ||
                        shipmentProviderSummary.tryOtoFinalization?.webhookWarning ? (
                          <>
                            <div className="summary-row">
                              <span>Try OTO webhook received</span>
                              <strong>{formatOptionalDate(shipmentProviderSummary.tryOtoFinalization.lastWebhookReceivedAt ?? undefined)}</strong>
                            </div>
                            <div className="summary-row">
                              <span>Try OTO webhook match</span>
                              <strong>{shipmentProviderSummary.tryOtoFinalization.lastWebhookMatchStatus || '—'}</strong>
                            </div>
                            <div className="summary-row">
                              <span>Try OTO webhook matched by</span>
                              <strong>{shipmentProviderSummary.tryOtoFinalization.lastWebhookMatchedByField || '—'}</strong>
                            </div>
                            <div className="summary-row">
                              <span>Try OTO webhook content type</span>
                              <strong>{shipmentProviderSummary.tryOtoFinalization.lastWebhookContentType || '—'}</strong>
                            </div>
                            <div className="summary-row">
                              <span>Try OTO webhook status</span>
                              <strong>{shipmentProviderSummary.tryOtoFinalization.lastWebhookStatusField || '—'}</strong>
                            </div>
                            <div className="summary-row">
                              <span>Try OTO webhook status mapped</span>
                              <strong>
                                {shipmentProviderSummary.tryOtoFinalization.lastWebhookStatusMapped === null ||
                                shipmentProviderSummary.tryOtoFinalization.lastWebhookStatusMapped === undefined
                                  ? '—'
                                  : shipmentProviderSummary.tryOtoFinalization.lastWebhookStatusMapped
                                    ? 'yes'
                                    : 'no'}
                              </strong>
                            </div>
                            <div className="summary-row">
                              <span>Try OTO local status</span>
                              <strong>{shipmentProviderSummary.tryOtoFinalization.lastWebhookMappedShipmentStatus || '—'}</strong>
                            </div>
                            <div className="summary-row">
                              <span>Latest provider status source</span>
                              <strong>{shipmentProviderSummary.tryOtoFinalization.latestProviderStatusSource || '—'}</strong>
                            </div>
                            <div className="summary-row">
                              <span>Try OTO webhook parse error</span>
                              <strong>{shipmentProviderSummary.tryOtoFinalization.lastWebhookParseError || '—'}</strong>
                            </div>
                            <div className="summary-row">
                              <span>Try OTO signature verification</span>
                              <strong>
                                {shipmentProviderSummary.tryOtoFinalization.webhookSignatureVerificationImplemented === null ||
                                shipmentProviderSummary.tryOtoFinalization.webhookSignatureVerificationImplemented === undefined
                                  ? '—'
                                  : shipmentProviderSummary.tryOtoFinalization.webhookSignatureVerificationImplemented
                                    ? 'implemented'
                                    : 'not implemented'}
                              </strong>
                            </div>
                            <div className="summary-row">
                              <span>Try OTO webhook warning</span>
                              <strong>{shipmentProviderSummary.tryOtoFinalization.webhookWarning || '—'}</strong>
                            </div>
                          </>
                        ) : null}
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
                      </details>
                    ) : null}
                    {shouldShowFailedShipmentRetryDiagnostics && (!shipmentProviderSummary || !isAdmin) ? (
                      <div id="shipment-retry-diagnostics" className="shipment-recovery-actions" aria-label="Shipment retry eligibility">
                        <strong>{isAdmin ? 'Shipment recovery' : 'Shipment needs attention'}</strong>
                        <span>
                          {isAdmin
                            ? `Retry eligible: ${canRecoverFailedShipment ? 'yes' : 'no'}${
                                failedShipmentRetryBlockedReason ? ` · ${failedShipmentRetryBlockedReason}` : ''
                              }`
                            : canRecoverFailedShipment
                              ? 'Retry shipment after reviewing any required shipment-only fields.'
                              : 'Shipment recovery is not available for this shipment.'}
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
                            {isAdmin ? (
                              <a className="button button-secondary button-link" href="#shipment-retry-diagnostics">
                                View diagnostics
                              </a>
                            ) : null}
                          </div>
                        ) : null}
                        {shouldShowRecoveryShipmentFieldCompletionForm ? renderShipmentFieldCompletionForm() : null}
                      </div>
                    ) : null}
                    {shipmentActionState ? (
                      <div className={`shipment-action-feedback action-feedback action-${shipmentActionState.tone}`} aria-live="polite">
                        <strong>{isAdmin ? shipmentActionState.message : getVendorShipmentActionMessage(shipmentActionState)}</strong>
                        {isAdmin ? (
                          <>
                            <span>Endpoint: {shipmentActionState.endpoint ?? shipmentActionState.diagnostics?.endpoint ?? 'POST /shipments/create'}</span>
                            {shipmentActionState.diagnostics ? (
                              <span>
                                HTTP: {shipmentActionState.diagnostics.status ?? '—'}
                                {shipmentActionState.diagnostics.requestId ? ` · Request: ${shipmentActionState.diagnostics.requestId}` : ''}
                              </span>
                            ) : null}
                            {shipmentActionState.shipment ? (
                              <span>{getShipmentActionEvidenceSummary(shipmentActionState)}</span>
                            ) : null}
                          </>
                        ) : null}
                        {renderShipmentFieldCompletionForm()}
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {isAdmin && shippingProviderDiagnostics ? (
                  <details className="shipping-provider-diagnostics admin-diagnostics-panel" aria-label="Shipping provider diagnostics">
                    <summary className="provider-response-heading">
                      <strong>Shipping provider diagnostics</strong>
                      <span>Provider diagnostics</span>
                    </summary>
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
                    {shippingProviderDiagnostics.provider === 'try_oto' ? (
                      <>
                        <div className="summary-row">
                          <span>Last webhook received</span>
                          <strong>
                            {shippingProviderDiagnostics.lastWebhookReceived
                              ? formatOptionalDate(shippingProviderDiagnostics.lastWebhookReceivedAt ?? undefined)
                              : 'no'}
                          </strong>
                        </div>
                        <div className="summary-row">
                          <span>Last webhook payload keys</span>
                          <strong>
                            {shippingProviderDiagnostics.lastWebhookPayloadKeys?.length
                              ? shippingProviderDiagnostics.lastWebhookPayloadKeys.join(', ')
                              : '—'}
                          </strong>
                        </div>
                        <div className="summary-row">
                          <span>Last webhook match</span>
                          <strong>{shippingProviderDiagnostics.lastWebhookMatchStatus || '—'}</strong>
                        </div>
                        <div className="summary-row">
                          <span>Last webhook matched by</span>
                          <strong>{shippingProviderDiagnostics.lastWebhookMatchedByField || '—'}</strong>
                        </div>
                        <div className="summary-row">
                          <span>Last webhook status value</span>
                          <strong>{shippingProviderDiagnostics.lastWebhookStatusValue || '—'}</strong>
                        </div>
                        <div className="summary-row">
                          <span>Last webhook status mapped</span>
                          <strong>
                            {shippingProviderDiagnostics.lastWebhookStatusMapped === null ||
                            shippingProviderDiagnostics.lastWebhookStatusMapped === undefined
                              ? '—'
                              : shippingProviderDiagnostics.lastWebhookStatusMapped
                                ? 'yes'
                                : 'no'}
                          </strong>
                        </div>
                        <div className="summary-row">
                          <span>Last webhook local status</span>
                          <strong>{shippingProviderDiagnostics.lastWebhookMappedLocalStatus || '—'}</strong>
                        </div>
                        <div className="summary-row">
                          <span>Last webhook parse error</span>
                          <strong>{shippingProviderDiagnostics.lastWebhookParseError || '—'}</strong>
                        </div>
                        <div className="summary-row">
                          <span>Webhook signature verification</span>
                          <strong>{shippingProviderDiagnostics.webhookSignatureVerificationImplemented ? 'implemented' : 'not implemented'}</strong>
                        </div>
                      </>
                    ) : null}
                    <div className="summary-row">
                      <span>Base URL configured</span>
                      <strong>{shippingProviderDiagnostics.baseUrlConfigured ? 'yes' : 'no'}</strong>
                    </div>
                    <div className="summary-row">
                      <span>API key configured</span>
                      <strong>{shippingProviderDiagnostics.apiKeyConfigured ? 'yes' : 'no'}</strong>
                    </div>
                        {shippingProviderDiagnostics.provider === 'try_oto' ? (
                          <>
                            <div className="summary-row">
                              <span>Last webhook received</span>
                              <strong>
                                {shippingProviderDiagnostics.lastWebhookReceived
                                  ? formatOptionalDate(shippingProviderDiagnostics.lastWebhookReceivedAt ?? undefined)
                                  : 'no'}
                              </strong>
                            </div>
                            <div className="summary-row">
                              <span>Last webhook payload keys</span>
                              <strong>
                                {shippingProviderDiagnostics.lastWebhookPayloadKeys?.length
                                  ? shippingProviderDiagnostics.lastWebhookPayloadKeys.join(', ')
                                  : '—'}
                              </strong>
                            </div>
                            <div className="summary-row">
                              <span>Last webhook match</span>
                              <strong>{shippingProviderDiagnostics.lastWebhookMatchStatus || '—'}</strong>
                            </div>
                            <div className="summary-row">
                              <span>Last webhook matched by</span>
                              <strong>{shippingProviderDiagnostics.lastWebhookMatchedByField || '—'}</strong>
                            </div>
                            <div className="summary-row">
                              <span>Last webhook status value</span>
                              <strong>{shippingProviderDiagnostics.lastWebhookStatusValue || '—'}</strong>
                            </div>
                            <div className="summary-row">
                              <span>Last webhook status mapped</span>
                              <strong>
                                {shippingProviderDiagnostics.lastWebhookStatusMapped === null ||
                                shippingProviderDiagnostics.lastWebhookStatusMapped === undefined
                                  ? '—'
                                  : shippingProviderDiagnostics.lastWebhookStatusMapped
                                    ? 'yes'
                                    : 'no'}
                              </strong>
                            </div>
                            <div className="summary-row">
                              <span>Last webhook local status</span>
                              <strong>{shippingProviderDiagnostics.lastWebhookMappedLocalStatus || '—'}</strong>
                            </div>
                            <div className="summary-row">
                              <span>Last webhook parse error</span>
                              <strong>{shippingProviderDiagnostics.lastWebhookParseError || '—'}</strong>
                            </div>
                            <div className="summary-row">
                              <span>Webhook signature verification</span>
                              <strong>{shippingProviderDiagnostics.webhookSignatureVerificationImplemented ? 'implemented' : 'not implemented'}</strong>
                            </div>
                            <div className="summary-row">
                              <span>Try OTO pickup location</span>
                          <strong>{tryOtoPickupLocationCode || '—'}</strong>
                        </div>
                        <div className="summary-row">
                          <span>Try OTO origin city configured</span>
                          <strong>{tryOtoOriginCity ? 'yes' : 'no'}</strong>
                        </div>
                      </>
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
                      <strong>
                        {shippingProviderDiagnostics.statusSyncSupport === 'webhook_ingest'
                          ? 'webhook ingest'
                          : 'not implemented'}
                      </strong>
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
                  </details>
                ) : null}
                <p className="page-description">
                  Shipping actions are currently unavailable.
                  {order.cancellationReason ? ` Reason: ${order.cancellationReason.replace(/_/g, ' ')}.` : ''}
                </p>
              </div>
            )}
          </article>
        </aside>
      </div>

      {message ? <ActionFeedback tone={tone} message={message} /> : null}
      {order ? (
        <SupportTicketModal
          open={supportOpen}
          contextType={supportContextType}
          contextId={supportContextId}
          contextSnapshot={supportSnapshot}
          defaultCategory={supportDefaultCategory}
          defaultSubject={`Help with order ${formatShopifyOrderNumber(order.sourceShopifyOrderNumber)}`}
          onClose={() => setSupportOpen(false)}
          onCreated={() => showFeedback('Support ticket created.', 'success')}
        />
      ) : null}
    </section>
  );
}
