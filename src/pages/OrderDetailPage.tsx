import { Link, useLocation, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ActionFeedback } from '../components/ActionFeedback';
import { SectionErrorRetry, SkeletonText, WorkflowActionGuidance } from '../components/OperationalPrimitives';
import { ProductImagePreview } from '../components/ProductImagePreview';
import { queryKeys } from '../lib/api/queryKeys';
import { useQueryResource } from '../hooks/useQueryResource';
import {
  cancelShipmentExecution,
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
  updateNavlungoShipmentExecution,
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
import { runtimeServices } from '../services/runtime-services';
import { ApiError } from '../lib/api/errors';
import { formatShopifyOrderNumber } from '../lib/formatOrderDisplay';
import { formatCurrency, formatDateTime, getSafeTimestamp, parseSafeDate, safeArray, safeStatusLabel, toTitleCaseLabel } from '../services/real/formatting';
import { getFinanceWorkflowAction } from '../lib/workflowActionGuidance';
import { SupportTicketModal } from '../components/SupportTicketModal';
import { useAppReadiness } from '../lib/appReadiness';
import { listReturns } from '../features/returns/api';
import { getFinanceDashboard } from '../features/finance/api';
import { escalateVendorSupportTicket, listAdminSupportTickets, listVendorSupportTickets, type SupportTicket } from '../features/support/api';
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
import type {
  KargonomiLocationLookupDiagnostics,
  NavlungoAuthDiagnostics,
  NavlungoBarcodeProbeDiagnostics,
  NavlungoCarrierDiagnostics,
  NavlungoCheckPostProbeDiagnostics,
  NavlungoCreatePostProbeDiagnostics,
} from '../services/real/diagnostics';

function formatDate(value: string) {
  return formatDateTime(value, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function formatOptionalDate(value?: string, fallback = '—') {
  return value ? formatDate(value) : fallback;
}

function formatSupportTicketStatus(status: SupportTicket['status']) {
  return safeStatusLabel(status);
}

function formatSupportTicketPriority(priority: SupportTicket['priority']) {
  return `${safeStatusLabel(priority, 'Normal')} priority`;
}

function isEscalatedSupportTicket(ticket: SupportTicket) {
  return ticket.priority === 'high' || Boolean(ticket.escalatedAt);
}

function buildFinanceHref(record: { id: string }) {
  return `/finance?ledgerId=${encodeURIComponent(record.id)}`;
}

const ORDER_FINANCE_HELPER_COPY =
  'Values may change after refunds, shipping reconciliation, manual review, or settlement adjustments.';
const ORDER_FINANCE_TIMELINE_HELPER_COPY = 'Finance events are previews until settlement review is completed.';
const ORDER_FINANCE_UNKNOWN_VALUE = 'Unknown';

function isMeaningfulFinanceValue(value: string | null | undefined) {
  return Boolean(value && value.trim() && value.trim() !== '—');
}

function isKnownFinanceValue(value: string | null | undefined) {
  return isMeaningfulFinanceValue(value) && value !== ORDER_FINANCE_UNKNOWN_VALUE;
}

function formatFinancePreviewValue(
  value: string | null | undefined,
  currency: string,
  options: { unknown?: boolean } = {},
) {
  if (options.unknown || value === null || value === undefined) {
    return ORDER_FINANCE_UNKNOWN_VALUE;
  }

  return formatCurrency(value, currency);
}

function getSnapshotCurrency(order: OrderDetail) {
  return order.orderSnapshot?.currency || 'TRY';
}

function formatSnapshotAmount(value: string | null | undefined, currency: string) {
  return value === null || value === undefined || value === '' ? '—' : formatCurrency(value, currency);
}

function formatSnapshotValue(value: string | null | undefined) {
  return value?.trim() || '—';
}

function formatVatRate(value: string | null | undefined) {
  if (value === null || value === undefined || value === '') {
    return '—';
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? `${numeric.toLocaleString('en-US')}%` : value;
}

function formatBillingAddress(address: NonNullable<OrderDetail['orderSnapshot']>['billingAddress'] | null | undefined) {
  if (!address) {
    return '—';
  }

  return [
    address.fullName,
    address.company,
    address.phone,
    address.address1,
    address.address2,
    address.district,
    address.city,
    address.postcode,
  ].filter((part) => part?.trim()).join(' · ') || '—';
}

function isPositiveFinanceValue(value: string | null | undefined) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0;
}

function getCompactCustomerLabel(value?: string) {
  const normalized = value?.trim();

  if (
    !normalized ||
    normalized.toLowerCase().includes('outside the current') ||
    normalized.toLowerCase().includes('available in order') ||
    normalized.toLowerCase().includes('customer unavailable')
  ) {
    return 'Customer unavailable';
  }

  return normalized;
}

function getSafeProviderTimelineDescription(value: string | null | undefined, fallback: string) {
  const normalized = value
    ?.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]')
    .replace(/\+?\d[\d\s().-]{7,}\d/g, '[redacted-phone]')
    .replace(/\s+/g, ' ')
    .trim();

  return normalized ? normalized.slice(0, 140) : fallback;
}

function getSafeNavlungoLifecycleText(value: string | number | null | undefined) {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = String(value)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]')
    .replace(/\+?\d[\d\s().-]{7,}\d/g, '[redacted-phone]')
    .replace(/\s+/g, ' ')
    .trim();

  return normalized ? normalized.slice(0, 120) : null;
}

function getNavlungoLifecycleLabel(input: {
  statusCode?: string | number | null;
  action?: string | null;
  actionResult?: string | null;
  statusName?: string | null;
}) {
  const numericStatus = Number(input.statusCode);
  switch (numericStatus) {
    case 2:
      return 'Teslim Edildi';
    case 4:
      return 'Dağıtıma Çıktı';
    case 9:
    case 21:
      return 'İade Edildi';
    case 10:
      return 'İptal';
    case 16:
      return 'Teslim Alındı';
    case 17:
      return 'Transfer Aşamasında';
    case 18:
      return 'Şubede Beklemede';
    default:
      break;
  }

  const source = [input.statusName, input.actionResult, input.action].map(getSafeNavlungoLifecycleText).find(Boolean);
  const normalized = source?.toLocaleLowerCase('tr-TR') ?? '';
  if (/teslim edildi|delivered/.test(normalized)) return 'Teslim Edildi';
  if (/dağıt|dagit|out for delivery/.test(normalized)) return 'Dağıtıma Çıktı';
  if (/şube|sube|branch/.test(normalized)) return 'Şubede Beklemede';
  if (/iptal|cancel/.test(normalized)) return 'İptal';
  if (/iade|return/.test(normalized)) return 'İade Edildi';
  if (/transfer|transit|yolda/.test(normalized)) return 'Transfer Aşamasında';
  if (/teslim al|picked/.test(normalized)) return 'Teslim Alındı';
  return source || 'Navlungo durum güncellendi';
}

function getNavlungoStatusBadgeLabel(summary?: ShipmentExecution['providerResponseSummary']) {
  if (!summary) {
    return null;
  }

  return getSafeNavlungoLifecycleText(summary.navlungoProviderStatusName) ??
    getSafeNavlungoLifecycleText(summary.navlungoNormalizedStatus) ??
    (summary.navlungoProviderStatusCode === null || summary.navlungoProviderStatusCode === undefined
      ? null
      : `Status ${summary.navlungoProviderStatusCode}`);
}

function getNavlungoStatusTone(label: string | null | undefined): OperationalEventInput['tone'] {
  const normalized = label?.toLocaleLowerCase('tr-TR') ?? '';
  if (/delivered|teslim edildi/.test(normalized)) return 'success';
  if (/cancel|iptal|return|iade/.test(normalized)) return 'warning';
  return 'info';
}

function getNavlungoLifecycleLogEvents(summary?: ShipmentExecution['providerResponseSummary']) {
  const logs = summary?.navlungoStatusLogs ?? [];
  const seen = new Set<string>();

  return logs
    .map((log) => {
      const title = getNavlungoLifecycleLabel({
        statusCode: log.statusCode,
        action: log.action,
        actionResult: log.actionResult,
        statusName: summary?.navlungoProviderStatusName,
      });
      const description = getSafeProviderTimelineDescription(
        getSafeNavlungoLifecycleText(log.actionResult) ?? getSafeNavlungoLifecycleText(log.action),
        summary?.navlungoProviderStatusName ? `Provider status: ${summary.navlungoProviderStatusName}` : 'Provider lifecycle status updated.',
      );
      const at = log.createdAt ?? summary?.navlungoDeliveredDate ?? summary?.navlungoPickedUpDate ?? summary?.navlungoCancelDate ?? null;
      const fingerprint = [title, log.statusCode ?? '', log.action ?? '', log.actionResult ?? '', at ?? ''].join('|');
      return {
        title,
        description,
        at,
        status: getSafeNavlungoLifecycleText(log.actionResult) ?? getSafeNavlungoLifecycleText(summary?.navlungoProviderStatusName) ?? undefined,
        tone: getNavlungoStatusTone(title),
        fingerprint,
      };
    })
    .filter((event) => {
      if (seen.has(event.fingerprint)) {
        return false;
      }
      seen.add(event.fingerprint);
      return true;
    })
    .sort((left, right) => {
      const leftTime = getSafeTimestamp(left.at, Number.MAX_SAFE_INTEGER);
      const rightTime = getSafeTimestamp(right.at, Number.MAX_SAFE_INTEGER);
      return leftTime - rightTime;
    });
}

function groupOrderDetailTimelineEvents(events: OperationalEventInput[]) {
  const grouped: OperationalEventInput[] = [];
  const seenGroupedEvents = new Set<string>();

  events.forEach((event) => {
    const normalizedTitle = event.title?.toLowerCase() ?? '';
    const isNoisyShipmentEvent =
      normalizedTitle.includes('order') ||
      normalizedTitle.includes('webhook') ||
      normalizedTitle.includes('tracking') ||
      normalizedTitle.includes('shipment') ||
      normalizedTitle.includes('delivered') ||
      normalizedTitle.includes('return') ||
      normalizedTitle.includes('status');
    const eventDay = parseSafeDate(event.at)?.toISOString().slice(0, 10) ?? 'unknown';
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

function getStatusClass(value: string | null | undefined) {
  return (value ?? 'unknown').toLowerCase().replace(/[^a-z0-9]+/g, '-');
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

function hasShipmentProviderEvidence(shipment?: ShipmentExecution | null) {
  return Boolean(shipment?.providerShipmentId || shipment?.trackingNumber || shipment?.labelUrl || shipment?.barcode);
}

function isShipmentExecutionNeedsReview(shipment?: ShipmentExecution | null) {
  if (!shipment || hasShipmentProviderEvidence(shipment)) {
    return false;
  }

  return ['pending', 'failed'].includes(shipment.shipmentStatus);
}

function getShipmentActionResultState(
  shipment: ShipmentExecution,
  mode: 'create' | 'retry',
): Pick<ShipmentActionState, 'tone' | 'message'> {
  if (isShipmentExecutionNeedsReview(shipment)) {
    return {
      tone: 'error',
      message: 'Shipment needs review. Provider did not return a shipment id or tracking yet.',
    };
  }

  if (shipment.shipmentStatus === 'pending') {
    return {
      tone: 'info',
      message:
        mode === 'retry'
          ? 'Shipment retry recorded. Carrier execution is pending.'
          : 'Shipment request recorded. Carrier execution is pending.',
    };
  }

  return {
    tone: 'success',
    message: `Shipment ${shipment.providerShipmentId ?? shipment.id} recorded.`,
  };
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

type NavlungoRequestSummary = NonNullable<NonNullable<ShipmentExecution['providerResponseSummary']>['navlungoRequestSummary']>;

type NavlungoRequestDiffRow = {
  label: string;
  same: boolean;
  probe: string;
  real: string;
};

function formatNavlungoRequestSummaryValue(value: unknown) {
  if (Array.isArray(value)) {
    return value.length ? value.join(', ') : '—';
  }
  if (typeof value === 'boolean') {
    return value ? 'yes' : 'no';
  }
  if (value === null || value === undefined || value === '') {
    return '—';
  }
  return String(value);
}

function compareNavlungoRequestField(
  label: string,
  probeValue: unknown,
  realValue: unknown,
): NavlungoRequestDiffRow {
  const probe = formatNavlungoRequestSummaryValue(probeValue);
  const real = formatNavlungoRequestSummaryValue(realValue);
  return {
    label,
    probe,
    real,
    same: probe === real,
  };
}

function formatNavlungoFormatField(summary: NavlungoRequestSummary, presentKey: 'barcodeFormatPresent' | 'codPaymentTypePresent' | 'postPricePresent', typeKey: 'barcodeFormatType' | 'codPaymentType' | 'postPriceType') {
  return `${summary[presentKey] ? 'present' : 'missing'} · ${summary[typeKey] ?? '—'}`;
}

function buildNavlungoRequestDiff(
  probe?: NavlungoRequestSummary | null,
  real?: NavlungoRequestSummary | null,
): NavlungoRequestDiffRow[] {
  if (!probe || !real) {
    return [];
  }

  return [
    compareNavlungoRequestField('Base URL', probe.baseUrl, real.baseUrl),
    compareNavlungoRequestField('Endpoint', `${probe.method} ${probe.endpointPath}`, `${real.method} ${real.endpointPath}`),
    compareNavlungoRequestField('Header keys', probe.headerKeys, real.headerKeys),
    compareNavlungoRequestField('Body keys', probe.topLevelBodyKeys, real.topLevelBodyKeys),
    compareNavlungoRequestField('posts[0] keys', probe.postKeys, real.postKeys),
    compareNavlungoRequestField('sender keys', probe.senderKeys, real.senderKeys),
    compareNavlungoRequestField('recipient keys', probe.recipientKeys, real.recipientKeys),
    compareNavlungoRequestField('recipient district present', probe.recipientDistrictPresent, real.recipientDistrictPresent),
    compareNavlungoRequestField('recipient city present', probe.recipientCityPresent, real.recipientCityPresent),
    compareNavlungoRequestField('recipient country present', probe.recipientCountryPresent, real.recipientCountryPresent),
    compareNavlungoRequestField('recipient post_code present', probe.recipientPostCodePresent, real.recipientPostCodePresent),
    compareNavlungoRequestField('recipient phone present', probe.recipientPhonePresent, real.recipientPhonePresent),
    compareNavlungoRequestField('recipient phone format', probe.recipientPhoneFormatValid, real.recipientPhoneFormatValid),
    compareNavlungoRequestField('recipient email present', probe.recipientEmailPresent, real.recipientEmailPresent),
    compareNavlungoRequestField('recipient email format', probe.recipientEmailFormatValid, real.recipientEmailFormatValid),
    compareNavlungoRequestField('recipient address present', probe.recipientAddressPresent, real.recipientAddressPresent),
    compareNavlungoRequestField('recipient address length', probe.recipientAddressLength, real.recipientAddressLength),
    compareNavlungoRequestField('post keys', probe.postPayloadKeys, real.postPayloadKeys),
    compareNavlungoRequestField('desi', `${probe.desiPresent ? 'present' : 'missing'} · ${probe.desiType ?? '—'} · ${probe.requestedDesi ?? '—'}`, `${real.desiPresent ? 'present' : 'missing'} · ${real.desiType ?? '—'} · ${real.requestedDesi ?? '—'}`),
    compareNavlungoRequestField('package_count', `${probe.packageCountPresent ? 'present' : 'missing'} · ${probe.packageCountType ?? '—'} · ${probe.requestedPackageCount ?? '—'}`, `${real.packageCountPresent ? 'present' : 'missing'} · ${real.packageCountType ?? '—'} · ${real.requestedPackageCount ?? '—'}`),
    compareNavlungoRequestField('post.note', `${probe.postNotePresent ? 'present' : 'missing'} · ${probe.postNoteType ?? '—'} · length ${probe.postNoteLength}`, `${real.postNotePresent ? 'present' : 'missing'} · ${real.postNoteType ?? '—'} · length ${real.postNoteLength}`),
    compareNavlungoRequestField(
      'barcode_format',
      formatNavlungoFormatField(probe, 'barcodeFormatPresent', 'barcodeFormatType'),
      formatNavlungoFormatField(real, 'barcodeFormatPresent', 'barcodeFormatType'),
    ),
    compareNavlungoRequestField(
      'cod_payment_type',
      formatNavlungoFormatField(probe, 'codPaymentTypePresent', 'codPaymentType'),
      formatNavlungoFormatField(real, 'codPaymentTypePresent', 'codPaymentType'),
    ),
    compareNavlungoRequestField(
      'post.price',
      formatNavlungoFormatField(probe, 'postPricePresent', 'postPriceType'),
      formatNavlungoFormatField(real, 'postPricePresent', 'postPriceType'),
    ),
    compareNavlungoRequestField('carrier_id', probe.requestedCarrierId, real.requestedCarrierId),
    compareNavlungoRequestField('post_type', probe.requestedPostType, real.requestedPostType),
    compareNavlungoRequestField('sender uses addressId', probe.senderUsesAddressId, real.senderUsesAddressId),
    compareNavlungoRequestField('sender full object keys', probe.senderFullObjectKeysPresent, real.senderFullObjectKeysPresent),
    compareNavlungoRequestField('custom_data_1', probe.customData1Present, real.customData1Present),
    compareNavlungoRequestField('custom_data_2', probe.customData2Present, real.customData2Present),
    compareNavlungoRequestField('custom_data_3', probe.customData3Present, real.customData3Present),
    compareNavlungoRequestField('custom_data_4', probe.customData4Present, real.customData4Present),
  ];
}

function renderNavlungoRequestSummaryRows(summary: NavlungoRequestSummary, prefix: string) {
  return (
    <>
      <div className="summary-row">
        <span>{prefix} sender mode</span>
        <strong>
          addressId {formatDiagnosticPresence(summary.senderUsesAddressId)} · sender keys{' '}
          {formatNavlungoRequestSummaryValue(summary.senderKeys)}
        </strong>
      </div>
      <div className="summary-row">
        <span>{prefix} recipient presence</span>
        <strong>
          district {formatDiagnosticPresence(summary.recipientDistrictPresent)} · city{' '}
          {formatDiagnosticPresence(summary.recipientCityPresent)} · email{' '}
          {formatDiagnosticPresence(summary.recipientEmailPresent)} · address{' '}
          {formatDiagnosticPresence(summary.recipientAddressPresent)}
        </strong>
      </div>
      <div className="summary-row">
        <span>{prefix} recipient format</span>
        <strong>
          phone format {formatDiagnosticPresence(summary.recipientPhoneFormatValid)} · address length{' '}
          {summary.recipientAddressLength}
        </strong>
      </div>
      <div className="summary-row">
        <span>{prefix} package</span>
        <strong>
          desi {summary.requestedDesi ?? '—'} · package_count {summary.requestedPackageCount ?? '—'}
        </strong>
      </div>
      <div className="summary-row">
        <span>{prefix} provider choices</span>
        <strong>
          carrier {summary.requestedCarrierId ?? '—'} · post {summary.requestedPostType ?? '—'} · barcode{' '}
          {summary.barcodeFormatPresent ? summary.barcodeFormatType ?? 'present' : 'missing'}
        </strong>
      </div>
    </>
  );
}

function getVendorShipmentActionMessage(actionState: ShipmentActionState) {
  if (!isReturnShipmentActionEndpoint(actionState.endpoint) && isShipmentExecutionNeedsReview(actionState.shipment)) {
    return 'Shipment needs review. Provider did not return a shipment id or tracking yet.';
  }

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

    if (actionState.endpoint?.includes('/update-navlungo')) {
      return actionState.shipment?.providerResponseSummary?.providerError ||
        actionState.message ||
        'Navlungo shipment can only be updated before pickup.';
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

function formatDiagnosticPresence(value: boolean | null | undefined) {
  if (value === null || value === undefined) {
    return '—';
  }

  return value ? 'yes' : 'no';
}

function formatDiagnosticValue(value: unknown) {
  if (value === null || value === undefined || value === '') {
    return '—';
  }

  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function formatKargonomiProviderStage(value?: string | null) {
  switch (value) {
    case 'destination_resolution':
      return 'Destination resolution';
    case 'create_shipment':
      return 'Create shipment';
    case 'price_comparison':
      return 'Price comparison';
    case 'confirm_price':
      return 'Confirm price';
    case 'get_shipment':
      return 'Get shipment';
    case 'barcode_fetch':
      return 'Barcode fetch';
    case 'completed':
      return 'Completed';
    default:
      return value ? toTitleCaseLabel(value.replace(/_/g, ' ')) : '—';
  }
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

type ShippingConfigDraftProvider = ShippingProvider | 'navlungo';

type ShippingConfigDraft = {
  preferredProvider: ShippingConfigDraftProvider;
  cargoIntegrationId: string;
  defaultWarehouseId: string;
  defaultDesi: string;
  packageType: 'box' | 'document';
  tryOtoPickupLocationCode: string;
  tryOtoOriginCity: string;
  kargonomiBuyerStateId: string;
  kargonomiBuyerCityId: string;
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

function readKargonomiBuyerStateId(config?: VendorShippingConfig | null) {
  const metadata = isRecord(config?.providerMetadata) ? config.providerMetadata : {};
  const raw = metadata.kargonomiBuyerStateId ?? metadata.buyerStateId ?? metadata.buyer_state_id;
  return typeof raw === 'string' ? raw : '';
}

function readKargonomiBuyerCityId(config?: VendorShippingConfig | null) {
  const metadata = isRecord(config?.providerMetadata) ? config.providerMetadata : {};
  const raw = metadata.kargonomiBuyerCityId ?? metadata.buyerCityId ?? metadata.buyer_city_id;
  return typeof raw === 'string' ? raw : '';
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

function buildSupportCorrelationId(orderId: string, shipmentId?: string | null) {
  return ['support', orderId, shipmentId].filter(Boolean).join(':');
}

function getSupportTicketDedupeKey(ticket: SupportTicket) {
  return [
    ticket.contextType,
    ticket.contextId ?? '',
    ticket.contextSummary?.orderNumber ?? '',
    ticket.contextSummary?.returnNumber ?? '',
    ticket.subject?.trim().toLowerCase() ?? '',
    ticket.status,
    ticket.priority,
  ].join('|');
}

function dedupeSupportTickets(tickets: SupportTicket[]) {
  const seen = new Set<string>();
  return tickets.filter((ticket) => {
    const key = getSupportTicketDedupeKey(ticket);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function isOpenSupportTicket(ticket: SupportTicket) {
  return OPEN_SUPPORT_TICKET_STATUSES.has(ticket.status);
}

function getSupportLatestActivityAt(ticket: SupportTicket) {
  return ticket.lastReplyAt ?? ticket.updatedAt ?? ticket.createdAt;
}

function getLatestSupportTicket(tickets: SupportTicket[]) {
  return [...tickets].sort((left, right) => {
    const leftTime = getSafeTimestamp(getSupportLatestActivityAt(left), 0);
    const rightTime = getSafeTimestamp(getSupportLatestActivityAt(right), 0);
    return rightTime - leftTime;
  })[0] ?? null;
}

function getSupportActivitySummary(tickets: SupportTicket[]) {
  const latestTicket = getLatestSupportTicket(tickets);
  if (!latestTicket) {
    return null;
  }

  const ticketCount = tickets.length;
  const openCount = tickets.filter(isOpenSupportTicket).length;
  const latestStatus = formatSupportTicketStatus(latestTicket.status);
  const ticketLabel = `${ticketCount} linked ticket${ticketCount === 1 ? '' : 's'}`;
  const activeLabel = openCount > 0 ? ` · ${openCount} active` : '';

  return {
    latestTicket,
    latestStatus,
    latestAt: getSupportLatestActivityAt(latestTicket),
    ticketLabel,
    description: `${ticketLabel} · Latest status: ${latestStatus}${activeLabel}`,
    tone: 'neutral' as const,
  };
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
    kargonomiBuyerStateId: readKargonomiBuyerStateId(config),
    kargonomiBuyerCityId: readKargonomiBuyerCityId(config),
    navlungoSenderAddressId: readNavlungoSenderAddressId(config) || '55574',
    navlungoSenderName: readNavlungoSenderField(config, ['navlungoSenderName', 'senderName', 'sender_name'], config?.warehouses.find((warehouse) => warehouse.isDefault)?.name ?? config?.warehouses[0]?.name),
    navlungoSenderPhone: readNavlungoSenderField(config, ['navlungoSenderPhone', 'senderPhone', 'sender_phone']),
    navlungoSenderEmail: readNavlungoSenderField(config, ['navlungoSenderEmail', 'senderEmail', 'sender_email']),
    navlungoSenderAddress: readNavlungoSenderField(config, ['navlungoSenderAddress', 'senderAddress', 'sender_address'], config?.warehouses.find((warehouse) => warehouse.isDefault)?.address ?? config?.warehouses[0]?.address),
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
  if (draft.preferredProvider === 'kargonomi' && !/^\d+$/.test(draft.defaultWarehouseId.trim())) {
    errors.push('Kargonomi warehouse ID must be numeric.');
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
    const providerMetadata = { ...metadata };
    delete providerMetadata.kargonomiBuyerStateId;
    delete providerMetadata.kargonomiBuyerCityId;
    delete providerMetadata.buyerStateId;
    delete providerMetadata.buyerCityId;
    delete providerMetadata.buyer_state_id;
    delete providerMetadata.buyer_city_id;
    const fallbackBuyerStateId = draft.kargonomiBuyerStateId.trim();
    const fallbackBuyerCityId = draft.kargonomiBuyerCityId.trim();
    if (fallbackBuyerStateId) {
      providerMetadata.kargonomiBuyerStateId = fallbackBuyerStateId;
    }
    if (fallbackBuyerCityId) {
      providerMetadata.kargonomiBuyerCityId = fallbackBuyerCityId;
    }

    return {
      ...baseUpdate,
      cargoIntegrationId: null,
      defaultWarehouseId: draft.defaultWarehouseId.trim(),
      providerMetadata,
      warehouses: [
        {
          warehouseId: draft.defaultWarehouseId.trim(),
          name: existingDefaultWarehouse?.name ?? 'Default warehouse',
          address: existingDefaultWarehouse?.address ?? null,
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

const OPEN_SUPPORT_TICKET_STATUSES = new Set(['OPEN', 'IN_REVIEW', 'WAITING_FOR_VENDOR']);

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

const NAVLUNGO_UPDATE_RECIPIENT_FIELDS = [
  'name',
  'phone',
  'email',
  'address',
  'city',
  'district',
  'postcode',
  'country',
] as const;

type NavlungoUpdateRecipientField = typeof NAVLUNGO_UPDATE_RECIPIENT_FIELDS[number];
type NavlungoUpdateFormState = Partial<Record<NavlungoUpdateRecipientField | 'postNote' | 'barcodeFormat', string>>;

function readNavlungoUpdateFormState(summary?: ShipmentExecution['providerResponseSummary'] | null): NavlungoUpdateFormState {
  const recipientOverrides = isRecord(summary?.navlungoUpdateRecipientOverrides)
    ? summary.navlungoUpdateRecipientOverrides
    : {};

  const state: NavlungoUpdateFormState = {};
  for (const field of NAVLUNGO_UPDATE_RECIPIENT_FIELDS) {
    const value = recipientOverrides[field];
    if (typeof value === 'string' && value.trim()) {
      state[field] = value;
    }
  }

  if (summary?.navlungoUpdatePostNote?.trim()) {
    state.postNote = summary.navlungoUpdatePostNote.trim();
  }

  if (summary?.navlungoUpdateBarcodeFormat?.trim()) {
    state.barcodeFormat = summary.navlungoUpdateBarcodeFormat.trim();
  }

  return state;
}

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

function getMissingShipmentCustomerFields(message: string, provider?: string | null): ShipmentCustomerField[] {
  const allowedFields = new Set(Object.keys(SHIPMENT_CUSTOMER_FIELD_LABELS));
  const fields = Array.from(message.matchAll(/customer\.([a-zA-Z0-9_]+)/g))
    .map((match) => match[1])
    .filter((field): field is ShipmentCustomerField => Boolean(field && allowedFields.has(field)));
  for (const match of message.matchAll(/recipient\.([a-zA-Z0-9_]+)/g)) {
    const field = match[1];
    if (field && allowedFields.has(field)) {
      fields.push(field as ShipmentCustomerField);
    }
  }
  const normalizedMessage = message.toLocaleLowerCase('tr-TR');
  const isKargonomiLocationMessage =
    provider === 'kargonomi' ||
    normalizedMessage.includes('kargonomi') ||
    normalizedMessage.includes('buyer.buyer_state_id') ||
    normalizedMessage.includes('buyer.buyer_city_id');
  const isNavlungoRecipientDistrictMessage =
    provider === 'navlungo' &&
    (normalizedMessage.includes('recipient.district') ||
      normalizedMessage.includes('posts.0.recipient.district') ||
      normalizedMessage.includes('alıcı ilçe') ||
      normalizedMessage.includes('alici ilce'));
  const isLegacyKargoDistrictMessage = provider === 'kargo_entegrator' || provider === 'hepsijet';
  if (
    (isKargonomiLocationMessage || isLegacyKargoDistrictMessage || isNavlungoRecipientDistrictMessage) &&
    (/\bdistrict\b/.test(normalizedMessage) || normalizedMessage.includes('ilçe') || normalizedMessage.includes('ilce'))
  ) {
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
  const queryClient = useQueryClient();
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
  const [kargonomiLookupDiagnostics, setKargonomiLookupDiagnostics] = useState<KargonomiLocationLookupDiagnostics | null>(null);
  const [kargonomiLookupError, setKargonomiLookupError] = useState<string | null>(null);
  const [navlungoAuthDiagnostics, setNavlungoAuthDiagnostics] = useState<NavlungoAuthDiagnostics | null>(null);
  const [navlungoAuthError, setNavlungoAuthError] = useState<string | null>(null);
  const [navlungoCarrierDiagnostics, setNavlungoCarrierDiagnostics] = useState<NavlungoCarrierDiagnostics | null>(null);
  const [navlungoCarrierError, setNavlungoCarrierError] = useState<string | null>(null);
  const [navlungoCreatePostProbeConfirmed, setNavlungoCreatePostProbeConfirmed] = useState(false);
  const [navlungoCreatePostProbeDiagnostics, setNavlungoCreatePostProbeDiagnostics] = useState<NavlungoCreatePostProbeDiagnostics | null>(null);
  const [navlungoCreatePostProbeError, setNavlungoCreatePostProbeError] = useState<string | null>(null);
  const [navlungoCheckPostProbeDiagnostics, setNavlungoCheckPostProbeDiagnostics] = useState<NavlungoCheckPostProbeDiagnostics | null>(null);
  const [navlungoCheckPostProbeError, setNavlungoCheckPostProbeError] = useState<string | null>(null);
  const [navlungoBarcodeProbeDiagnostics, setNavlungoBarcodeProbeDiagnostics] = useState<NavlungoBarcodeProbeDiagnostics | null>(null);
  const [navlungoBarcodeProbeError, setNavlungoBarcodeProbeError] = useState<string | null>(null);
  const [useFullNavlungoSenderForRetry, setUseFullNavlungoSenderForRetry] = useState(false);
  const [navlungoUpdateConfirmed, setNavlungoUpdateConfirmed] = useState(false);
  const [navlungoUpdateForm, setNavlungoUpdateForm] = useState<NavlungoUpdateFormState>({});
  const [navlungoReturnPickupLiveConfirmed, setNavlungoReturnPickupLiveConfirmed] = useState(false);
  const settlementPreviewRef = useRef<HTMLElement | null>(null);
  const tryOtoAutoRefreshAttemptsRef = useRef<Record<string, number>>({});
  const tryOtoAutoRefreshTimerRef = useRef<number | null>(null);
  const tryOtoAutoRefreshInFlightRef = useRef(false);
  const refreshShipmentStatusMutationRef = useRef<((shipmentExecutionId: string) => Promise<ShipmentExecution>) | null>(null);
  const refetchOrderRef = useRef<(() => unknown) | null>(null);
  const { data: order, isLoading, isError, error, diagnostics, refetch } = useQueryResource(
    orderId ? queryKeys.orders.detail(orderId, currentVendor.vendorId) : queryKeys.orders.list(currentVendor.vendorId),
    ({ signal }) => {
      if (!orderId) {
        throw new Error('Order not found.');
      }

      return getOrder(orderId, { vendorId: currentVendor.vendorId, signal });
    },
    {
      enabled: authContextReady && Boolean(orderId),
    },
  );
  const { data: vendorShippingConfig } = useQueryResource(
    queryKeys.admin.shipments.vendorShippingConfig(currentVendor.vendorId),
    ({ signal }) => getVendorShippingConfig({ vendorId: currentVendor.vendorId, signal }),
    {
      enabled: authContextReady && isAdmin && Boolean(currentVendor.vendorId) && Boolean(order),
    },
  );
  const diagnosticsProvider =
    vendorShippingConfig?.preferredProvider === 'try_oto'
      ? 'try_oto'
      : vendorShippingConfig?.preferredProvider === 'kargonomi'
        ? 'kargonomi'
        : 'kargo_entegrator';
  const { data: shippingProviderDiagnostics, refetch: refetchShippingProviderDiagnostics } = useQueryResource(
    queryKeys.admin.shipments.providerConfig(diagnosticsProvider, currentVendor.vendorId),
    ({ signal }) => getShippingProviderDiagnostics({ vendorId: currentVendor.vendorId, provider: diagnosticsProvider, signal }),
    {
      enabled: authContextReady && isAdmin && Boolean(order),
    },
  );
  const { data: tryOtoOptionDiagnostics } = useQueryResource(
    queryKeys.admin.shipments.providerConfig('try_oto', currentVendor.vendorId),
    ({ signal }) => getShippingProviderDiagnostics({ vendorId: currentVendor.vendorId, provider: 'try_oto', signal }),
    {
      enabled: authContextReady && isAdmin && Boolean(order),
    },
  );
  const { data: kargonomiOptionDiagnostics } = useQueryResource(
    queryKeys.admin.shipments.providerConfig('kargonomi', currentVendor.vendorId),
    ({ signal }) => getShippingProviderDiagnostics({ vendorId: currentVendor.vendorId, provider: 'kargonomi', signal }),
    {
      enabled: authContextReady && isAdmin && Boolean(order),
    },
  );
  const { data: navlungoOptionDiagnostics } = useQueryResource(
    queryKeys.admin.shipments.providerConfig('navlungo', currentVendor.vendorId),
    ({ signal }) => getShippingProviderDiagnostics({ vendorId: currentVendor.vendorId, provider: 'navlungo', signal }),
    {
      enabled: authContextReady && isAdmin && Boolean(order),
    },
  );
  const { data: relatedReturnsData } = useQueryResource(
    queryKeys.returns.list(currentVendor.vendorId),
    ({ signal }) => listReturns({ vendorId: currentVendor.vendorId, signal }),
    {
      enabled: authContextReady && Boolean(order),
    },
  );
  const { data: relatedFinanceData } = useQueryResource(
    queryKeys.finance.summary(currentVendor.vendorId),
    ({ signal }) => getFinanceDashboard({ vendorId: currentVendor.vendorId, signal }),
    {
      enabled: authContextReady && Boolean(order),
    },
  );
  const { data: relatedSupportTicketsData } = useQueryResource(
    isAdmin ? queryKeys.admin.support.tickets() : queryKeys.support.tickets(currentVendor.vendorId),
    ({ signal }) => (isAdmin ? listAdminSupportTickets({ signal }) : listVendorSupportTickets({ signal })),
    {
      enabled: authContextReady && Boolean(order),
    },
  );
  const { mutateAsync: escalateSupportTicketMutation, isPending: isEscalatingSupportTicket } = useMutationAction(
    (ticketId: string) => escalateVendorSupportTicket(ticketId),
    {
      invalidateQueryKeys: [
        queryKeys.support.tickets(currentVendor.vendorId),
        queryKeys.admin.support.tickets(),
        orderId ? queryKeys.orders.detail(orderId, currentVendor.vendorId) : queryKeys.orders.list(currentVendor.vendorId),
      ],
      onSuccess: () => {
        showFeedback('Support ticket escalated.', 'success');
      },
      onError: (error) => {
        showFeedback(getTrackingMutationErrorMessage(error), 'error');
      },
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
    async (payload: {
      shipmentExecutionId: string;
      customerOverrides?: ShipmentCustomerOverrides;
      useFullSenderDetailsForThisRetry?: boolean;
    }) =>
      retryFailedShipmentExecution(payload.shipmentExecutionId, {
        vendorId: currentVendor.vendorId,
        customerOverrides: payload.customerOverrides,
        useFullSenderDetailsForThisRetry: payload.useFullSenderDetailsForThisRetry,
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
  const { mutateAsync: cancelShipmentMutation, isPending: isCancellingShipment } = useMutationAction(
    async (shipmentExecutionId: string) =>
      cancelShipmentExecution(shipmentExecutionId, {
        vendorId: currentVendor.vendorId,
      }),
    {
      invalidateQueryKeys: [queryKeys.orders.list(currentVendor.vendorId), orderId ? queryKeys.orders.detail(orderId, currentVendor.vendorId) : queryKeys.orders.list(currentVendor.vendorId)],
    },
  );
  const { mutateAsync: updateNavlungoShipmentMutation, isPending: isUpdatingNavlungoShipment } = useMutationAction(
    async (payload: {
      shipmentExecutionId: string;
      recipient: Partial<Record<ShipmentCustomerField, string>>;
      postNote?: string | null;
      barcodeFormat?: string | null;
    }) =>
      updateNavlungoShipmentExecution(
        payload.shipmentExecutionId,
        {
          recipient: payload.recipient,
          postNote: payload.postNote,
          barcodeFormat: payload.barcodeFormat,
        },
        {
          vendorId: currentVendor.vendorId,
        },
      ),
    {
      invalidateQueryKeys: [queryKeys.orders.list(currentVendor.vendorId), orderId ? queryKeys.orders.detail(orderId, currentVendor.vendorId) : queryKeys.orders.list(currentVendor.vendorId)],
    },
  );
  const { mutateAsync: createReturnShipmentLabelMutation, isPending: isCreatingReturnShipmentLabel } = useMutationAction(
    async (payload: { shipmentExecutionId: string; dryRun?: boolean }) =>
      createReturnShipmentLabel(payload.shipmentExecutionId, {
        vendorId: currentVendor.vendorId,
        dryRun: payload.dryRun === true,
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
      onSuccess: (savedConfig, submittedConfig) => {
        queryClient.setQueryData(
          queryKeys.admin.shipments.vendorShippingConfig(currentVendor.vendorId),
          savedConfig,
        );
        if (!submittedConfig.preferredProvider || savedConfig.preferredProvider === submittedConfig.preferredProvider) {
          setShippingConfigDraft(buildShippingConfigDraft(savedConfig));
        }
        setShippingConfigFeedback({ tone: 'success', message: 'Shipping provider configuration saved.' });
        void refetchShippingProviderDiagnostics();
      },
      onError: (error) => {
        const message = error instanceof Error ? error.message : 'Shipping provider configuration could not be saved.';
        setShippingConfigFeedback({ tone: 'error', message });
      },
    },
  );
  const { mutateAsync: runKargonomiLookupDiagnosticsMutation, isPending: isRunningKargonomiLookupDiagnostics } = useMutationAction(
    async () => runtimeServices.diagnostics.kargonomiLocationLookup(),
    {
      onSuccess: (result) => {
        setKargonomiLookupDiagnostics(result);
        setKargonomiLookupError(null);
      },
      onError: (error) => {
        setKargonomiLookupError(error instanceof Error ? error.message : 'Kargonomi lookup diagnostic could not be run.');
      },
    },
  );
  const { mutateAsync: runNavlungoAuthDiagnosticsMutation, isPending: isRunningNavlungoAuthDiagnostics } = useMutationAction(
    async () => runtimeServices.diagnostics.navlungoAuth(),
    {
      onSuccess: (result) => {
        setNavlungoAuthDiagnostics(result);
        setNavlungoAuthError(null);
      },
      onError: (error) => {
        setNavlungoAuthError(error instanceof Error ? error.message : 'Navlungo auth diagnostic could not be run.');
      },
    },
  );
  const { mutateAsync: runNavlungoCarrierDiagnosticsMutation, isPending: isRunningNavlungoCarrierDiagnostics } = useMutationAction(
    async () => runtimeServices.diagnostics.navlungoCarriers(),
    {
      onSuccess: (result) => {
        setNavlungoCarrierDiagnostics(result);
        setNavlungoCarrierError(null);
      },
      onError: (error) => {
        setNavlungoCarrierError(error instanceof Error ? error.message : 'Navlungo carrier diagnostic could not be run.');
      },
    },
  );
  const { mutateAsync: runNavlungoCreatePostProbeMutation, isPending: isRunningNavlungoCreatePostProbe } = useMutationAction(
    async () => runtimeServices.diagnostics.navlungoCreatePostProbe({ confirm: 'YES' }),
    {
      onSuccess: (result) => {
        setNavlungoCreatePostProbeDiagnostics(result);
        setNavlungoCreatePostProbeError(null);
        setNavlungoCheckPostProbeDiagnostics(null);
        setNavlungoCheckPostProbeError(null);
        setNavlungoBarcodeProbeDiagnostics(null);
        setNavlungoBarcodeProbeError(null);
      },
      onError: (error) => {
        setNavlungoCreatePostProbeError(error instanceof Error ? error.message : 'Navlungo Create Post probe could not be run.');
      },
    },
  );
  const { mutateAsync: runNavlungoCheckPostProbeMutation, isPending: isRunningNavlungoCheckPostProbe } = useMutationAction(
    async (postNumber: string) => runtimeServices.diagnostics.navlungoCheckPostProbe({ postNumber }),
    {
      onSuccess: (result) => {
        setNavlungoCheckPostProbeDiagnostics(result);
        setNavlungoCheckPostProbeError(null);
      },
      onError: (error) => {
        setNavlungoCheckPostProbeError(error instanceof Error ? error.message : 'Navlungo Check Post probe could not be run.');
      },
    },
  );
  const { mutateAsync: runNavlungoBarcodeProbeMutation, isPending: isRunningNavlungoBarcodeProbe } = useMutationAction(
    async (postNumber: string) => runtimeServices.diagnostics.navlungoBarcodeProbe({ postNumber }),
    {
      onSuccess: (result) => {
        setNavlungoBarcodeProbeDiagnostics(result);
        setNavlungoBarcodeProbeError(null);
      },
      onError: (error) => {
        setNavlungoBarcodeProbeError(error instanceof Error ? error.message : 'Navlungo Barcode probe could not be run.');
      },
    },
  );

  useEffect(() => {
    if (vendorShippingConfig) {
      setShippingConfigDraft(buildShippingConfigDraft(vendorShippingConfig));
    }
  }, [vendorShippingConfig]);

  function getLineItemImageAlt(item: OrderDetail['lineItems'][number]) {
    return item.name ? `${item.name} product image` : item.sku ? `${item.sku} product image` : 'Product image';
  }

  useEffect(() => {
    if (shippingConfigDraft.preferredProvider !== 'kargonomi') {
      setKargonomiLookupDiagnostics(null);
      setKargonomiLookupError(null);
    }
    if (shippingConfigDraft.preferredProvider !== 'navlungo') {
      setNavlungoAuthDiagnostics(null);
      setNavlungoAuthError(null);
      setNavlungoCarrierDiagnostics(null);
      setNavlungoCarrierError(null);
      setNavlungoCreatePostProbeConfirmed(false);
      setNavlungoCreatePostProbeDiagnostics(null);
      setNavlungoCreatePostProbeError(null);
      setNavlungoCheckPostProbeDiagnostics(null);
      setNavlungoCheckPostProbeError(null);
      setNavlungoBarcodeProbeDiagnostics(null);
      setNavlungoBarcodeProbeError(null);
    }
  }, [shippingConfigDraft.preferredProvider]);

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
  const shipmentExecution = order?.shipmentExecution ?? null;
  const visibleShipmentExecution = shipmentActionState?.shipment ?? shipmentExecution ?? null;
  const hasShipmentExecution = Boolean(visibleShipmentExecution);
  const shipmentProviderSummary = visibleShipmentExecution?.providerResponseSummary;

  useEffect(() => {
    setNavlungoUpdateForm(readNavlungoUpdateFormState(shipmentProviderSummary));
    setNavlungoUpdateConfirmed(false);
  }, [visibleShipmentExecution?.id]);

  const visibleShipmentStatus = (visibleShipmentExecution?.shipmentStatus ?? '').trim().toLowerCase();
  const failedLikeShipmentExecution =
    Boolean(visibleShipmentExecution) &&
    (['failed', 'validation_failed', 'provider_rejected', 'malformed_response'].includes(visibleShipmentStatus) ||
      shipmentProviderSummary?.ok === false ||
      Boolean(shipmentProviderSummary?.providerError || shipmentProviderSummary?.providerValidationErrors.length));
  const providerMissingShipmentCustomerFields =
    shipmentProviderSummary?.ok === false || ['failed', 'validation_failed', 'provider_rejected', 'malformed_response'].includes(visibleShipmentStatus)
      ? [
          ...(shipmentProviderSummary?.providerValidationErrors ?? []),
          shipmentProviderSummary?.providerError ?? '',
        ].flatMap((message) => getMissingShipmentCustomerFields(message, visibleShipmentExecution?.provider))
      : [];
  const actionMissingShipmentCustomerFields =
    shipmentActionState?.tone === 'error'
      ? getMissingShipmentCustomerFields(shipmentActionState.message, visibleShipmentExecution?.provider)
      : [];
  const missingShipmentCustomerFields = Array.from(
    new Set([...actionMissingShipmentCustomerFields, ...providerMissingShipmentCustomerFields]),
  );
  const shouldShowRealTrackingForm =
    isRealMode &&
    canUseFulfillmentActions &&
    !hasTrackingSync &&
    missingShipmentCustomerFields.length === 0 &&
    (!hasShipmentExecution || failedLikeShipmentExecution);
  const shouldShowShipmentProviderSummary =
    isAdmin &&
    Boolean(shipmentProviderSummary) &&
    Boolean(
      visibleShipmentExecution &&
        (['pending', 'failed', 'unknown'].includes(visibleShipmentStatus) ||
          shipmentProviderSummary?.navlungoCancelAttempted === true ||
          shipmentProviderSummary?.navlungoUpdateAttempted === true ||
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
  const canUseFullNavlungoSenderRetry =
    canRecoverFailedShipment && visibleShipmentExecution?.provider === 'navlungo';
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
  const canSyncNavlungoShipmentStatus =
    (isAdmin || canUseFulfillmentActions) &&
    visibleShipmentExecution?.provider === 'navlungo' &&
    Boolean(visibleShipmentExecution.providerShipmentId);
  const canCancelNavlungoShipment =
    (isAdmin || canUseFulfillmentActions) &&
    visibleShipmentExecution?.provider === 'navlungo' &&
    Boolean(visibleShipmentExecution.providerShipmentId) &&
    !['cancelled', 'delivered'].includes(visibleShipmentStatus);
  const canUpdateNavlungoShipment =
    isAdmin &&
    visibleShipmentExecution?.provider === 'navlungo' &&
    Boolean(visibleShipmentExecution.providerShipmentId) &&
    !['cancelled', 'delivered'].includes(visibleShipmentStatus);
  const canAutoRefreshTryOtoShipmentStatus =
    canRefreshTryOtoShipmentStatus &&
    Boolean(visibleShipmentExecution?.id) &&
    Boolean(visibleShipmentExecution?.providerShipmentId) &&
    ['created', 'pending'].includes(visibleShipmentStatus);
  const shipmentShopifyTrackingNumber = getShipmentTrackingNumber(order ?? {}, visibleShipmentExecution);
  const shipmentShopifyTrackingUrl = getShipmentTrackingUrl(order ?? {}, visibleShipmentExecution);
  const shipmentShopifyCarrier = formatShopifyCarrierForShipment(visibleShipmentExecution, order?.carrier);
  const navlungoProviderStatusBadge =
    visibleShipmentExecution?.provider === 'navlungo' ? getNavlungoStatusBadgeLabel(shipmentProviderSummary) : null;
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
  const canCreateNavlungoReturnPickup =
    false;
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
    setUseFullNavlungoSenderForRetry(false);
    setNavlungoUpdateConfirmed(false);
    setNavlungoReturnPickupLiveConfirmed(false);
    tryOtoAutoRefreshAttemptsRef.current = {};
    if (tryOtoAutoRefreshTimerRef.current !== null) {
      window.clearTimeout(tryOtoAutoRefreshTimerRef.current);
      tryOtoAutoRefreshTimerRef.current = null;
    }
  }, [orderId]);

  function buildShipmentCustomerOverrides(fields: ShipmentCustomerField[], form?: HTMLFormElement | null) {
    const formData = form ? new FormData(form) : null;
    const overrides = Object.fromEntries(
      fields
        .map((field) => {
          const formValue = formData?.get(field);
          return [
            field,
            (typeof formValue === 'string' ? formValue : shipmentCustomerOverrides[field] ?? '').trim(),
          ] as const;
        })
        .filter(([, value]) => Boolean(value)),
    ) as ShipmentCustomerOverrides;
    return Object.keys(overrides).length > 0 ? overrides : undefined;
  }

  function handleCreateShipment(fields: ShipmentCustomerField[] = [], completedOverrides?: ShipmentCustomerOverrides) {
    if (!order) {
      return;
    }

    const customerOverrides = completedOverrides ?? buildShipmentCustomerOverrides(fields);
    setShipmentActionState({
      tone: 'info',
      message: 'Creating shipment with the configured provider...',
      endpoint: 'POST /shipments/create',
    });

    void createShipmentMutation({ allocationId: order.id, customerOverrides })
      .then((shipment) => {
        const resultState = getShipmentActionResultState(shipment, 'create');
        setShipmentActionState({
          ...resultState,
          shipment,
          endpoint: 'POST /shipments/create',
        });
        setShipmentCustomerOverrides({});
        showFeedback(resultState.message, resultState.tone);
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

  function handleRetryFailedShipment(fields: ShipmentCustomerField[] = [], completedOverrides?: ShipmentCustomerOverrides) {
    if (!visibleShipmentExecution) {
      return;
    }

    const customerOverrides = completedOverrides ?? buildShipmentCustomerOverrides(fields);
    setShipmentActionState({
      tone: 'info',
      message: 'Retrying shipment provider request...',
      endpoint: `POST /shipments/${visibleShipmentExecution.id}/retry`,
    });

    const useFullSenderDetailsForThisRetry =
      visibleShipmentExecution.provider === 'navlungo' && useFullNavlungoSenderForRetry;

    void retryFailedShipmentMutation({
      shipmentExecutionId: visibleShipmentExecution.id,
      customerOverrides,
      ...(useFullSenderDetailsForThisRetry ? { useFullSenderDetailsForThisRetry: true } : {}),
    })
      .then((shipment) => {
        const resultState = getShipmentActionResultState(shipment, 'retry');
        setShipmentActionState({
          ...resultState,
          shipment,
          endpoint: `POST /shipments/${visibleShipmentExecution.id}/retry`,
        });
        setShipmentCustomerOverrides({});
        setUseFullNavlungoSenderForRetry(false);
        showFeedback(resultState.message, resultState.tone);
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
        const isNavlungoStatusSync = shipment.provider === 'navlungo';
        setShipmentActionState({
          tone: hasNewShipmentEvidence ? 'success' : 'info',
          message: hasNewShipmentEvidence
            ? isNavlungoStatusSync
              ? 'Navlungo status synced.'
              : 'Shipment status refreshed.'
            : 'Shipment was created. Tracking or label may still be processing.',
          shipment,
          endpoint: `POST /shipments/${visibleShipmentExecution.id}/refresh`,
        });
        showFeedback(
          hasNewShipmentEvidence
            ? isNavlungoStatusSync
              ? 'Navlungo status synced.'
              : 'Shipment status refreshed.'
            : 'Shipment was created. Tracking or label may still be processing.',
          hasNewShipmentEvidence ? 'success' : 'info',
        );
        void refetch();
      })
      .catch((mutationError) => {
        const diagnostics = getApiErrorDiagnostics(mutationError);
        const errorMessage = mutationError instanceof Error ? mutationError.message : 'Shipment status could not be refreshed.';
        setShipmentActionState({
          tone: 'error',
          message: errorMessage,
          diagnostics,
          endpoint: diagnostics?.endpoint ?? `POST /shipments/${visibleShipmentExecution.id}/refresh`,
        });
        showFeedback(errorMessage, 'error');
      });
  }

  function handleCancelNavlungoShipment() {
    if (!visibleShipmentExecution) {
      return;
    }

    const confirmed = window.confirm(
      'Cancel this Navlungo shipment? Shopify fulfillment will not be deleted in this phase.',
    );
    if (!confirmed) {
      return;
    }

    setShipmentActionState({
      tone: 'info',
      message: 'Cancelling Navlungo shipment...',
      endpoint: `POST /shipments/${visibleShipmentExecution.id}/cancel`,
    });

    void cancelShipmentMutation(visibleShipmentExecution.id)
      .then((shipment) => {
        const cancelled = shipment.shipmentStatus === 'cancelled';
        const needsReview = shipment.providerResponseSummary?.navlungoCancelAttempted === true && !shipment.providerResponseSummary.navlungoCancelSucceeded;
        const message = cancelled
          ? 'Navlungo shipment cancelled.'
          : needsReview
            ? 'Navlungo cancellation needs attention.'
            : 'Navlungo cancellation request completed.';
        const tone = cancelled ? 'success' : needsReview ? 'error' : 'info';
        setShipmentActionState({
          tone,
          message,
          shipment,
          endpoint: `POST /shipments/${visibleShipmentExecution.id}/cancel`,
        });
        showFeedback(message, tone);
        void refetch();
      })
      .catch((mutationError) => {
        const diagnostics = getApiErrorDiagnostics(mutationError);
        const errorMessage = mutationError instanceof Error ? mutationError.message : 'Navlungo shipment could not be cancelled.';
        setShipmentActionState({
          tone: 'error',
          message: errorMessage,
          diagnostics,
          endpoint: diagnostics?.endpoint ?? `POST /shipments/${visibleShipmentExecution.id}/cancel`,
        });
        showFeedback(errorMessage, 'error');
      });
  }

  function handleUpdateNavlungoShipment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!visibleShipmentExecution) {
      return;
    }

    if (!navlungoUpdateConfirmed) {
      showFeedback('Confirm the Navlungo update before saving.', 'error');
      return;
    }

    const recipient = Object.fromEntries(
      NAVLUNGO_UPDATE_RECIPIENT_FIELDS
        .map((field) => {
          const value = navlungoUpdateForm[field];
          return [field, typeof value === 'string' ? value.trim() : ''] as const;
        })
        .filter(([, value]) => value.length > 0),
    ) as Partial<Record<ShipmentCustomerField, string>>;
    const submittedFormState = {
      ...navlungoUpdateForm,
    };
    const postNoteValue = navlungoUpdateForm.postNote ?? '';
    const barcodeFormatValue = navlungoUpdateForm.barcodeFormat ?? '';

    setShipmentActionState({
      tone: 'info',
      message: 'Updating Navlungo shipment...',
      endpoint: `POST /shipments/${visibleShipmentExecution.id}/update-navlungo`,
    });

    void updateNavlungoShipmentMutation({
      shipmentExecutionId: visibleShipmentExecution.id,
      recipient,
      postNote: postNoteValue.trim(),
      barcodeFormat: barcodeFormatValue.trim(),
    })
      .then((shipment) => {
        const updatedSummary = shipment.providerResponseSummary as ShipmentExecution['providerResponseSummary'] | undefined;
        const succeeded = updatedSummary?.navlungoUpdateSucceeded === true;
        const providerMessage = updatedSummary?.navlungoUpdateProviderMessage ||
          updatedSummary?.providerError ||
          null;
        const message = succeeded
          ? 'Navlungo shipment updated'
          : providerMessage || 'Navlungo shipment can only be updated before pickup.';
        const tone = succeeded ? 'success' : 'error';
        setShipmentActionState({
          tone,
          message,
          shipment,
          endpoint: `POST /shipments/${visibleShipmentExecution.id}/update-navlungo`,
        });
        setNavlungoUpdateConfirmed(false);
        const nextFormState = readNavlungoUpdateFormState(updatedSummary);
        setNavlungoUpdateForm(Object.keys(nextFormState).length > 0 ? nextFormState : submittedFormState);
        showFeedback(message, tone);
        void refetch();
      })
      .catch((mutationError) => {
        const diagnostics = getApiErrorDiagnostics(mutationError);
        const errorMessage = mutationError instanceof Error
          ? mutationError.message
          : 'Navlungo shipment can only be updated before pickup.';
        setShipmentActionState({
          tone: 'error',
          message: errorMessage,
          diagnostics,
          endpoint: diagnostics?.endpoint ?? `POST /shipments/${visibleShipmentExecution.id}/update-navlungo`,
        });
        showFeedback(errorMessage, 'error');
      });
  }

  function handleCreateReturnShipmentLabel(options: { dryRun?: boolean } = {}) {
    if (!visibleShipmentExecution) {
      return;
    }
    const isNavlungo = visibleShipmentExecution.provider === 'navlungo';
    const dryRun = options.dryRun === true;

    setShipmentActionState({
      tone: 'info',
      message: dryRun
        ? 'Previewing Navlungo return pickup...'
        : isNavlungo
          ? 'Creating live Navlungo return pickup...'
          : 'Creating Try OTO return label...',
      endpoint: `POST /shipments/${visibleShipmentExecution.id}/create-return`,
    });

    void createReturnShipmentLabelMutation({ shipmentExecutionId: visibleShipmentExecution.id, dryRun })
      .then((shipment) => {
        if (dryRun) {
          setShipmentActionState({
            tone: 'info',
            message: 'Navlungo return pickup preview generated. No provider call was made.',
            shipment,
            endpoint: `POST /shipments/${visibleShipmentExecution.id}/create-return`,
          });
          showFeedback('Navlungo return pickup preview generated.', 'info');
          return;
        }
        const hasReturnLabel = Boolean(shipment.returnShipment?.labelUrl);
        const returnFinalized = Boolean(shipment.returnShipment?.finalized || shipment.returnShipment?.labelRetrievable);
        const providerLabel = isNavlungo ? 'Navlungo return pickup' : 'Try OTO return shipment';
        setShipmentActionState({
          tone: hasReturnLabel ? 'success' : 'info',
          message: hasReturnLabel
            ? `${providerLabel} label created.`
            : returnFinalized
              ? `${providerLabel} created. Printable return label unavailable.`
              : `${providerLabel} created. Return tracking code will appear here when available.`,
          shipment,
          endpoint: `POST /shipments/${visibleShipmentExecution.id}/create-return`,
        });
        showFeedback(
          hasReturnLabel
            ? `${providerLabel} label created.`
            : returnFinalized
              ? `${providerLabel} created. Printable return label unavailable.`
              : `${providerLabel} created. Return tracking code will appear here when available.`,
          hasReturnLabel ? 'success' : 'info',
        );
        void refetch();
      })
      .catch((mutationError) => {
        const diagnostics = getApiErrorDiagnostics(mutationError);
        const errorMessage = mutationError instanceof Error ? mutationError.message : 'Return shipment could not be created.';
        setShipmentActionState({
          tone: 'error',
          message: errorMessage,
          diagnostics,
          endpoint: diagnostics?.endpoint ?? `POST /shipments/${visibleShipmentExecution.id}/create-return`,
        });
        showFeedback(errorMessage, 'error');
      });
  }

  function renderNavlungoReturnPickupPreviewSummary(summary = visibleShipmentExecution?.providerResponseSummary) {
    const payloadSummary = summary?.navlungoReturnPickupPayloadSummary;
    if (!payloadSummary) {
      return null;
    }

    return (
      <div className="provider-response-summary" aria-label="Navlungo return pickup payload summary">
        <div className="summary-row">
          <span>Endpoint</span>
          <strong>{payloadSummary.endpointPath}</strong>
        </div>
        <div className="summary-row">
          <span>Post type / carrier</span>
          <strong>
            {payloadSummary.requestedPostType ?? '—'} · {payloadSummary.requestedCarrierId ?? '—'}
          </strong>
        </div>
        <div className="summary-row">
          <span>Sender keys</span>
          <strong>{payloadSummary.senderKeys.length ? payloadSummary.senderKeys.join(', ') : '—'}</strong>
        </div>
        <div className="summary-row">
          <span>Recipient addressId</span>
          <strong>
            {payloadSummary.recipientKeys.includes('addressId') ? 'present' : 'missing'} · valid{' '}
            {formatDiagnosticPresence(summary?.recipientAddressIdValid)}
          </strong>
        </div>
        <div className="summary-row">
          <span>Recipient addressId config</span>
          <strong>
            {summary?.navlungoReturnRecipientAddressIdSource ?? '—'} · present{' '}
            {formatDiagnosticPresence(summary?.navlungoReturnRecipientAddressIdPresent)} · numeric{' '}
            {formatDiagnosticPresence(summary?.navlungoReturnRecipientAddressIdNumeric)}
          </strong>
        </div>
        <div className="summary-row">
          <span>Return recipient metadata</span>
          <strong>
            {formatDiagnosticPresence(summary?.navlungoReturnRecipientMetadataConfigured)}
            {summary?.navlungoReturnRecipientCity ? ` · ${summary.navlungoReturnRecipientCity}` : ''}
            {summary?.navlungoReturnRecipientDistrict ? ` · ${summary.navlungoReturnRecipientDistrict}` : ''}
          </strong>
        </div>
        <div className="summary-row">
          <span>Package</span>
          <strong>
            desi {formatDiagnosticPresence(payloadSummary.desiPresent)} · package_count{' '}
            {formatDiagnosticPresence(payloadSummary.packageCountPresent)}
          </strong>
        </div>
        <div className="summary-row">
          <span>Reference format</span>
          <strong>{payloadSummary.postKeys.includes('reference_id') ? 'present' : 'missing'}</strong>
        </div>
        <div className="summary-row">
          <span>Custom data</span>
          <strong>
            {[payloadSummary.customData1Present, payloadSummary.customData2Present, payloadSummary.customData3Present, payloadSummary.customData4Present]
              .filter(Boolean).length}
            /4 present
          </strong>
        </div>
        {summary?.navlungoReturnPickupMissingFields?.length ? (
          <div className="summary-row">
            <span>Missing fields</span>
            <strong>{summary.navlungoReturnPickupMissingFields.join(', ')}</strong>
          </div>
        ) : null}
      </div>
    );
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
    if (location.hash !== '#settlement-preview' || !order) {
      return;
    }

    window.requestAnimationFrame(() => {
      const settlementPreview = settlementPreviewRef.current;
      if (!settlementPreview) {
        return;
      }

      settlementPreview.scrollIntoView?.({ block: 'start' });
      settlementPreview.focus({ preventScroll: true });
    });
  }, [location.hash, order]);

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
          const completedOverrides = buildShipmentCustomerOverrides(missingShipmentCustomerFields, event.currentTarget);
          if (canRecoverFailedShipment) {
            handleRetryFailedShipment(missingShipmentCustomerFields, completedOverrides);
          } else {
            handleCreateShipment(missingShipmentCustomerFields, completedOverrides);
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
                name={field}
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

  function renderNavlungoUpdateForm() {
    if (!canUpdateNavlungoShipment || !visibleShipmentExecution) {
      return null;
    }

    return (
      <details className="shipment-recovery-actions" aria-label="Navlungo shipment update">
        <summary>
          <strong>Update Navlungo shipment</strong>
          <span>Forward shipment only. Shopify fulfillment update sync is not implemented in this phase.</span>
        </summary>
        <form className="shipment-field-completion-form" onSubmit={handleUpdateNavlungoShipment}>
          <div>
            <span>Recipient update</span>
            <p>Leave fields empty to keep current shipment values.</p>
          </div>
          <div className="shipment-update-section">
            <span className="shipment-update-section-label">Recipient info</span>
            <div className="shipment-field-completion-grid">
              {(['name', 'phone', 'email', 'address', 'city', 'district', 'postcode'] as NavlungoUpdateRecipientField[]).map((field) => (
                <label className="field" key={`navlungo-${field}`}>
                  <span>{SHIPMENT_CUSTOMER_FIELD_LABELS[field]}{field === 'email' || field === 'postcode' ? '' : ' *'}</span>
                  <input
                    name={`navlungo-${field}`}
                    value={navlungoUpdateForm[field] ?? ''}
                    onChange={(event) =>
                      setNavlungoUpdateForm((current) => ({
                        ...current,
                        [field]: event.target.value,
                      }))
                    }
                  />
                </label>
              ))}
              <label className="field">
                <span>Country *</span>
                <input
                  name="navlungo-country"
                  placeholder="tr"
                  value={navlungoUpdateForm.country ?? ''}
                  onChange={(event) =>
                    setNavlungoUpdateForm((current) => ({
                      ...current,
                      country: event.target.value,
                    }))
                  }
                />
              </label>
            </div>
          </div>
          <div className="shipment-update-section">
            <span className="shipment-update-section-label">Shipment options</span>
            <div className="shipment-field-completion-grid">
              <label className="field">
                <span>Post note</span>
                <input
                  name="navlungo-post-note"
                  value={navlungoUpdateForm.postNote ?? ''}
                  onChange={(event) =>
                    setNavlungoUpdateForm((current) => ({
                      ...current,
                      postNote: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="field">
                <span>Barcode format</span>
                <input
                  name="navlungo-barcode-format"
                  placeholder="pdf-A6"
                  value={navlungoUpdateForm.barcodeFormat ?? ''}
                  onChange={(event) =>
                    setNavlungoUpdateForm((current) => ({
                      ...current,
                      barcodeFormat: event.target.value,
                    }))
                  }
                />
              </label>
            </div>
          </div>
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={navlungoUpdateConfirmed}
              onChange={(event) => setNavlungoUpdateConfirmed(event.target.checked)}
              disabled={isUpdatingNavlungoShipment}
            />
            <span>Update only the Navlungo shipment</span>
          </label>
          <p className="muted helper-text">Shopify fulfillment/tracking will not change in this phase.</p>
          <div className="order-inline-actions">
            <button
              type="submit"
              className="button button-primary"
              disabled={isUpdatingNavlungoShipment || !navlungoUpdateConfirmed}
            >
              {isUpdatingNavlungoShipment ? 'Updating...' : 'Update Navlungo shipment'}
            </button>
          </div>
        </form>
      </details>
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

  function renderKargonomiExecutionDiagnostics(summary: NonNullable<typeof shipmentProviderSummary>) {
    if (visibleShipmentExecution?.provider !== 'kargonomi') {
      return null;
    }

    return (
      <details className="provider-response-summary admin-diagnostics-panel diagnostics-nested-panel" aria-label="Kargonomi execution diagnostics">
        <summary className="provider-response-heading">
          <strong>Kargonomi execution diagnostics</strong>
          <span>Provider stage trace</span>
        </summary>
        <div className="summary-row">
          <span>Provider API call attempted</span>
          <strong>{formatDiagnosticPresence(summary.providerApiCallAttempted)}</strong>
        </div>
        <div className="summary-row">
          <span>Last provider stage</span>
          <strong>{formatKargonomiProviderStage(summary.lastProviderStage)}</strong>
        </div>
        <div className="summary-row">
          <span>Stage calls</span>
          <strong>
            create {formatDiagnosticPresence(summary.createShipmentCalled)} · price{' '}
            {formatDiagnosticPresence(summary.priceComparisonCalled)} · confirm{' '}
            {formatDiagnosticPresence(summary.confirmShippingPriceCalled)} · get{' '}
            {formatDiagnosticPresence(summary.getShipmentCalled)} · barcode{' '}
            {formatDiagnosticPresence(summary.barcodeFetchCalled)}
          </strong>
        </div>
        <div className="summary-row">
          <span>Confirm request ids</span>
          <strong>
            shipment {summary.confirmShipmentId || '—'} · shipping_provider_id {summary.confirmShippingProviderId || '—'}
          </strong>
        </div>
        {summary.providerErrorMessage || summary.providerErrorErrors || summary.providerErrorBodyPreview ? (
          <>
            <div className="summary-row">
              <span>Provider error message</span>
              <strong>{summary.providerErrorMessage || '—'}</strong>
            </div>
            <div className="summary-row">
              <span>Provider error errors</span>
              <strong>{formatDiagnosticValue(summary.providerErrorErrors)}</strong>
            </div>
            <div className="summary-row">
              <span>Provider error body preview</span>
              <strong>{formatDiagnosticValue(summary.providerErrorBodyPreview)}</strong>
            </div>
          </>
        ) : null}
      </details>
    );
  }

  function renderNavlungoRetryDiagnostics(summary: NonNullable<typeof shipmentProviderSummary>) {
    const hasNavlungoRequestDiagnostics = Boolean(
      summary.navlungoRequestSummary ||
        summary.lastSuccessfulNavlungoRequestSummary ||
        summary.responseKeys?.includes('navlungoRequestSummary') ||
        summary.responseKeys?.includes('lastSuccessfulNavlungoRequestSummary'),
    );
    if (visibleShipmentExecution?.provider !== 'navlungo' && !hasNavlungoRequestDiagnostics) {
      return null;
    }
    const hasValidationDiagnostics =
      summary.realPathCreatePostHttpStatus === 422 ||
      summary.providerCallHttpStatus === 422 ||
      Boolean(summary.providerErrorCode) ||
      Boolean(summary.failedFieldNames?.length) ||
      Boolean(summary.validationErrorMessages?.length);
    const requestDiffRows = buildNavlungoRequestDiff(
      navlungoCreatePostProbeDiagnostics?.requestSummary,
      summary.navlungoRequestSummary,
    );
    const successfulRequestDiffRows = buildNavlungoRequestDiff(
      summary.lastSuccessfulNavlungoRequestSummary,
      summary.navlungoRequestSummary,
    );
    const shouldOpenNavlungoRetryDiagnostics = Boolean(
      hasNavlungoRequestDiagnostics ||
        summary.providerTrackingId ||
        summary.providerError ||
        (summary.httpStatus !== null && summary.httpStatus !== undefined && summary.httpStatus >= 400) ||
        (summary.providerCallHttpStatus !== null &&
          summary.providerCallHttpStatus !== undefined &&
          summary.providerCallHttpStatus >= 400) ||
        (summary.realPathCreatePostHttpStatus !== null &&
          summary.realPathCreatePostHttpStatus !== undefined &&
          summary.realPathCreatePostHttpStatus >= 400) ||
        (summary.navlungoUpdateHttpStatus !== null &&
          summary.navlungoUpdateHttpStatus !== undefined &&
          summary.navlungoUpdateHttpStatus >= 400),
    );

    return (
      <details
        className="provider-response-summary admin-diagnostics-panel diagnostics-nested-panel"
        aria-label="Navlungo retry diagnostics"
        open={shouldOpenNavlungoRetryDiagnostics}
      >
        <summary className="provider-response-heading">
          <strong>Navlungo retry diagnostics</strong>
          <span>Safe vendor create/retry trace</span>
        </summary>
        <div className="summary-row">
          <span>Endpoint used</span>
          <strong>{summary.endpointUsed || '—'}</strong>
        </div>
        <div className="summary-row">
          <span>Existing execution</span>
          <strong>{summary.executionId || '—'}</strong>
        </div>
        <div className="summary-row">
          <span>Provider/status at retry</span>
          <strong>
            {summary.providerAtExecution || '—'} · {summary.existingStatus || '—'}
          </strong>
        </div>
        <div className="summary-row">
          <span>Before retry evidence</span>
          <strong>{formatDiagnosticPresence(summary.hasProviderEvidenceBefore)}</strong>
        </div>
        <div className="summary-row">
          <span>Stale recovery attempted</span>
          <strong>{formatDiagnosticPresence(summary.staleRecoveryAttempted)}</strong>
        </div>
        <div className="summary-row">
          <span>Provider call attempted</span>
          <strong>{formatDiagnosticPresence(summary.providerCallAttempted)}</strong>
        </div>
        <div className="summary-row">
          <span>Provider call HTTP</span>
          <strong>{summary.providerCallHttpStatus ?? summary.httpStatus ?? '—'}</strong>
        </div>
        <div className="summary-row">
          <span>Provider message</span>
          <strong>{summary.providerError || '—'}</strong>
        </div>
        <div className="summary-row">
          <span>Provider tracking ID</span>
          <strong>{summary.providerTrackingId || '—'}</strong>
        </div>
        <div className="summary-row">
          <span>Cancel Post</span>
          <strong>
            attempted {formatDiagnosticPresence(summary.navlungoCancelAttempted)} · HTTP {summary.navlungoCancelHttpStatus ?? '—'} · succeeded{' '}
            {formatDiagnosticPresence(summary.navlungoCancelSucceeded)}
          </strong>
        </div>
        <div className="summary-row">
          <span>Cancel provider message</span>
          <strong>{summary.navlungoCancelProviderMessage || '—'}</strong>
        </div>
        <div className="summary-row">
          <span>Cancel tracking ID</span>
          <strong>{summary.navlungoCancelProviderTrackingId || summary.providerTrackingId || '—'}</strong>
        </div>
        <div className="summary-row">
          <span>Cancel validation fields</span>
          <strong>{summary.navlungoCancelValidationFields?.length ? summary.navlungoCancelValidationFields.join(', ') : '—'}</strong>
        </div>
        <div className="summary-row">
          <span>Cancel validation messages</span>
          <strong>
            {summary.navlungoCancelValidationMessages?.length ? summary.navlungoCancelValidationMessages.join(' · ') : '—'}
          </strong>
        </div>
        <div className="summary-row">
          <span>Cancel Shopify sync</span>
          <strong>{summary.shopifyFulfillmentCancelSyncSkippedReason || '—'}</strong>
        </div>
        <div className="summary-row">
          <span>Cancelled at</span>
          <strong>{formatOptionalDate(summary.navlungoCancelledAt ?? undefined)}</strong>
        </div>
        <div className="summary-row">
          <span>Update Post</span>
          <strong>
            attempted {formatDiagnosticPresence(summary.navlungoUpdateAttempted)} · HTTP {summary.navlungoUpdateHttpStatus ?? '—'} · succeeded{' '}
            {formatDiagnosticPresence(summary.navlungoUpdateSucceeded)}
          </strong>
        </div>
        <div className="summary-row">
          <span>Update provider message</span>
          <strong>{summary.navlungoUpdateProviderMessage || '—'}</strong>
        </div>
        <div className="summary-row">
          <span>Update tracking ID</span>
          <strong>{summary.navlungoUpdateProviderTrackingId || summary.providerTrackingId || '—'}</strong>
        </div>
        <div className="summary-row">
          <span>Update response shape</span>
          <strong>
            {summary.navlungoUpdateResponseShape
              ? `${summary.navlungoUpdateResponseShape.kind} · ${
                  summary.navlungoUpdateResponseShape.topLevelKeys.length
                    ? summary.navlungoUpdateResponseShape.topLevelKeys.join(', ')
                    : 'no keys'
                }`
              : '—'}
          </strong>
        </div>
        <div className="summary-row">
          <span>Update sender mode</span>
          <strong>{summary.navlungoUpdateSenderMode || '—'}</strong>
        </div>
        <div className="summary-row">
          <span>Update sender fields</span>
          <strong>{summary.navlungoUpdateSenderFieldKeys?.length ? summary.navlungoUpdateSenderFieldKeys.join(', ') : '—'}</strong>
        </div>
        <div className="summary-row">
          <span>Missing update sender fields</span>
          <strong>{summary.navlungoUpdateMissingSenderFields?.length ? summary.navlungoUpdateMissingSenderFields.join(', ') : '—'}</strong>
        </div>
        <div className="summary-row">
          <span>Recipient override</span>
          <strong>
            {formatDiagnosticPresence(summary.navlungoUpdateRecipientOverridePresent)} · keys{' '}
            {summary.navlungoUpdateRecipientOverrideKeys?.length ? summary.navlungoUpdateRecipientOverrideKeys.join(', ') : '—'}
          </strong>
        </div>
        <div className="summary-row">
          <span>Submitted override keys</span>
          <strong>
            recipient{' '}
            {summary.navlungoUpdateSubmittedRecipientOverrideKeys?.length
              ? summary.navlungoUpdateSubmittedRecipientOverrideKeys.join(', ')
              : '—'} · options{' '}
            {summary.navlungoUpdateOptionOverrideKeys?.length ? summary.navlungoUpdateOptionOverrideKeys.join(', ') : '—'}
          </strong>
        </div>
        <div className="summary-row">
          <span>Update validation fields</span>
          <strong>{summary.navlungoUpdateValidationFields?.length ? summary.navlungoUpdateValidationFields.join(', ') : '—'}</strong>
        </div>
        <div className="summary-row">
          <span>Update validation messages</span>
          <strong>
            {summary.navlungoUpdateValidationMessages?.length ? summary.navlungoUpdateValidationMessages.join(' · ') : '—'}
          </strong>
        </div>
        <div className="summary-row">
          <span>Update Shopify sync</span>
          <strong>{summary.shopifyFulfillmentUpdateSyncSkippedReason || '—'}</strong>
        </div>
        <div className="summary-row">
          <span>Updated at</span>
          <strong>{formatOptionalDate(summary.navlungoUpdatedAt ?? undefined)}</strong>
        </div>
        <div className="summary-row">
          <span>Detailed status sync</span>
          <strong>
            attempted {formatDiagnosticPresence(summary.navlungoStatusSyncAttempted)} · HTTP {summary.navlungoStatusSyncHttpStatus ?? '—'} · status{' '}
            {summary.navlungoNormalizedStatus || '—'}
          </strong>
        </div>
        <div className="summary-row">
          <span>Status sync URL</span>
          <strong>{summary.navlungoStatusSyncResolvedProviderUrl || summary.navlungoStatusSyncResolvedProviderPath || '—'}</strong>
        </div>
        <div className="summary-row">
          <span>Status sync payload</span>
          <strong>
            body {summary.navlungoStatusSyncRequestPayloadKeys?.length ? summary.navlungoStatusSyncRequestPayloadKeys.join(', ') : '—'} · post{' '}
            {summary.navlungoStatusSyncPostPayloadKeys?.length ? summary.navlungoStatusSyncPostPayloadKeys.join(', ') : '—'} · limit{' '}
            {summary.navlungoStatusSyncLimit ?? '—'}
          </strong>
        </div>
        <div className="summary-row">
          <span>Status sync response shape</span>
          <strong>
            {summary.navlungoStatusSyncResponseShape
              ? `${summary.navlungoStatusSyncResponseShape.kind} · ${
                  summary.navlungoStatusSyncResponseShape.topLevelKeys.length
                    ? summary.navlungoStatusSyncResponseShape.topLevelKeys.join(', ')
                    : 'no keys'
                }`
              : '—'}
          </strong>
        </div>
        <div className="summary-row">
          <span>Provider status</span>
          <strong>
            {summary.navlungoProviderStatusCode ?? '—'}
            {summary.navlungoProviderStatusName ? ` · ${summary.navlungoProviderStatusName}` : ''}
          </strong>
        </div>
        <div className="summary-row">
          <span>Lifecycle dates</span>
          <strong>
            {[
              summary.navlungoPickedUpDate ? `picked up ${formatOptionalDate(summary.navlungoPickedUpDate)}` : null,
              summary.navlungoDeliveredDate ? `delivered ${formatOptionalDate(summary.navlungoDeliveredDate)}` : null,
              summary.navlungoCancelDate ? `cancelled ${formatOptionalDate(summary.navlungoCancelDate)}` : null,
            ].filter(Boolean).join(' · ') || '—'}
          </strong>
        </div>
        <div className="summary-row">
          <span>Tracking enrichment</span>
          <strong>
            enriched {formatDiagnosticPresence(summary.navlungoTrackingEnriched)} · carrier tracking{' '}
            {formatDiagnosticPresence(summary.navlungoCarrierTrackingPresent)}
          </strong>
        </div>
        <div className="summary-row">
          <span>Carrier tracking details</span>
          <strong>
            {summary.navlungoCarrierTrackingCode || '—'}
            {summary.navlungoCarrierTrackingUrl ? ` · ${summary.navlungoCarrierTrackingUrl}` : ''}
          </strong>
        </div>
        <div className="summary-row">
          <span>Barcode status</span>
          <strong>{summary.navlungoBarcodeStatus || '—'}</strong>
        </div>
        <div className="summary-row">
          <span>Address intelligence</span>
          <strong>
            geo {summary.navlungoGeoStatus || '—'} · bad address {formatDiagnosticPresence(summary.navlungoGeoBadAddress)}
          </strong>
        </div>
        {summary.navlungoGeoBadAddress ? (
          <div className="summary-row">
            <span>Address warning</span>
            <strong>Carrier reported address validation issue.</strong>
          </div>
        ) : null}
        <div className="summary-row">
          <span>Status logs</span>
          <strong>{summary.navlungoLogsCount ?? '—'}</strong>
        </div>
        {summary.navlungoStatusLogs?.length ? (
          <div className="shipment-mini-timeline" aria-label="Navlungo provider lifecycle logs">
            {getNavlungoLifecycleLogEvents(summary).map((event) => (
              <div className="summary-row" key={`navlungo-log-${event.fingerprint}`}>
                <span>{event.title}</span>
                <strong>
                  {[event.status, event.at ? formatOptionalDate(event.at) : null].filter(Boolean).join(' · ') || '—'}
                </strong>
              </div>
            ))}
          </div>
        ) : null}
        <div className="summary-row">
          <span>Status sync tracking ID</span>
          <strong>{summary.navlungoStatusSyncProviderTrackingId || summary.providerTrackingId || '—'}</strong>
        </div>
        <div className="summary-row">
          <span>Status sync validation fields</span>
          <strong>{summary.navlungoStatusSyncValidationFields?.length ? summary.navlungoStatusSyncValidationFields.join(', ') : '—'}</strong>
        </div>
        <div className="summary-row">
          <span>Status sync validation messages</span>
          <strong>
            {summary.navlungoStatusSyncValidationMessages?.length ? summary.navlungoStatusSyncValidationMessages.join(' · ') : '—'}
          </strong>
        </div>
        <div className="summary-row">
          <span>Shopify delivery sync</span>
          <strong>{summary.shopifyDeliveryStatusSyncSkippedReason || '—'}</strong>
        </div>
        <div className="summary-row">
          <span>Real path request</span>
          <strong>
            carrier {summary.realPathRequestedCarrierId ?? '—'} · post {summary.realPathRequestedPostType ?? '—'} · barcode{' '}
            {summary.realPathRequestedBarcodeFormat || '—'}
          </strong>
        </div>
        <div className="summary-row">
          <span>Real path flags</span>
          <strong>
            COD {formatDiagnosticPresence(summary.realPathCodPaymentIncluded)} · price{' '}
            {formatDiagnosticPresence(summary.realPathPriceIncluded)}
          </strong>
        </div>
        <div className="provider-response-summary diagnostics-nested-panel" aria-label="Navlungo request summary diagnostics">
          <div className="provider-response-heading">
            <strong>Navlungo request summary diagnostics</strong>
            <span>Sanitized persisted request comparison</span>
          </div>
          <div className="summary-row">
            <span>Request summary present</span>
            <strong>{formatDiagnosticPresence(Boolean(summary.navlungoRequestSummary))}</strong>
          </div>
          <div className="summary-row">
            <span>Last successful summary present</span>
            <strong>{formatDiagnosticPresence(Boolean(summary.lastSuccessfulNavlungoRequestSummary))}</strong>
          </div>
          <div className="summary-row">
            <span>Last successful summary source</span>
            <strong>{summary.lastSuccessfulNavlungoRequestSummarySource || '—'}</strong>
          </div>
          <div className="summary-row">
            <span>Last successful summary reason</span>
            <strong>{summary.lastSuccessfulNavlungoRequestSummaryReason || '—'}</strong>
          </div>
          <div className="summary-row">
            <span>Sender address ID</span>
            <strong>
              present {formatDiagnosticPresence(summary.senderAddressIdPresent)} · sender uses addressId{' '}
              {formatDiagnosticPresence(
                summary.senderUsesAddressId ?? summary.navlungoRequestSummary?.senderUsesAddressId ?? null,
              )}
            </strong>
          </div>
          <div className="summary-row">
            <span>Navlungo sender mode</span>
            <strong>
              {summary.senderMode ?? (summary.senderUsesAddressId ?? summary.navlungoRequestSummary?.senderUsesAddressId ? 'addressId' : '—')}
              {' · '}
              full sender retry {formatDiagnosticPresence(summary.fullSenderRetryRequested)}
            </strong>
          </div>
          {summary.navlungoRequestSummary ? (
            <>
              <div className="summary-row">
                <span>Current Navlungo request summary</span>
                <strong>available</strong>
              </div>
              {renderNavlungoRequestSummaryRows(summary.navlungoRequestSummary, 'current')}
            </>
          ) : null}
          {summary.lastSuccessfulNavlungoRequestSummary ? (
            <>
              <div className="summary-row">
                <span>Last successful Navlungo request summary</span>
                <strong>available</strong>
              </div>
              {renderNavlungoRequestSummaryRows(summary.lastSuccessfulNavlungoRequestSummary, 'last success')}
            </>
          ) : null}
          {successfulRequestDiffRows.length ? (
            <>
              <div className="summary-row">
                <span>Last successful vs current request diff</span>
                <strong>{successfulRequestDiffRows.length} safe fields compared</strong>
              </div>
              {successfulRequestDiffRows.map((row) => (
                <div className="summary-row" key={`visible-${row.label}`}>
                  <span>{row.label}</span>
                  <strong>
                    {row.same ? 'same' : 'different'} · success: {row.probe} · current: {row.real}
                  </strong>
                </div>
              ))}
            </>
          ) : null}
        </div>
        {summary.navlungoRequestSummary ? (
          <details className="provider-response-summary diagnostics-nested-panel" aria-label="Navlungo real retry request summary">
            <summary className="provider-response-heading">
              <strong>Real retry request shape</strong>
              <span>Field names, types, and booleans only</span>
            </summary>
            <div className="summary-row">
              <span>Base URL</span>
              <strong>{summary.navlungoRequestSummary.baseUrl ?? '—'}</strong>
            </div>
            <div className="summary-row">
              <span>Endpoint</span>
              <strong>{`${summary.navlungoRequestSummary.method} ${summary.navlungoRequestSummary.endpointPath}`}</strong>
            </div>
            <div className="summary-row">
              <span>Header keys</span>
              <strong>{formatNavlungoRequestSummaryValue(summary.navlungoRequestSummary.headerKeys)}</strong>
            </div>
            <div className="summary-row">
              <span>Body keys</span>
              <strong>{formatNavlungoRequestSummaryValue(summary.navlungoRequestSummary.topLevelBodyKeys)}</strong>
            </div>
            <div className="summary-row">
              <span>posts[0] keys</span>
              <strong>{formatNavlungoRequestSummaryValue(summary.navlungoRequestSummary.postKeys)}</strong>
            </div>
            <div className="summary-row">
              <span>sender keys</span>
              <strong>{formatNavlungoRequestSummaryValue(summary.navlungoRequestSummary.senderKeys)}</strong>
            </div>
            <div className="summary-row">
              <span>recipient keys</span>
              <strong>{formatNavlungoRequestSummaryValue(summary.navlungoRequestSummary.recipientKeys)}</strong>
            </div>
            <div className="summary-row">
              <span>recipient presence</span>
              <strong>
                district {formatDiagnosticPresence(summary.navlungoRequestSummary.recipientDistrictPresent)} · city{' '}
                {formatDiagnosticPresence(summary.navlungoRequestSummary.recipientCityPresent)} · country{' '}
                {formatDiagnosticPresence(summary.navlungoRequestSummary.recipientCountryPresent)} · post code{' '}
                {formatDiagnosticPresence(summary.navlungoRequestSummary.recipientPostCodePresent)}
              </strong>
            </div>
            <div className="summary-row">
              <span>recipient contact shape</span>
              <strong>
                phone {formatDiagnosticPresence(summary.navlungoRequestSummary.recipientPhonePresent)} · phone format{' '}
                {formatDiagnosticPresence(summary.navlungoRequestSummary.recipientPhoneFormatValid)} · email{' '}
                {formatDiagnosticPresence(summary.navlungoRequestSummary.recipientEmailPresent)} · email format{' '}
                {formatDiagnosticPresence(summary.navlungoRequestSummary.recipientEmailFormatValid)}
              </strong>
            </div>
            <div className="summary-row">
              <span>recipient address shape</span>
              <strong>
                present {formatDiagnosticPresence(summary.navlungoRequestSummary.recipientAddressPresent)} · length{' '}
                {summary.navlungoRequestSummary.recipientAddressLength}
              </strong>
            </div>
            <div className="summary-row">
              <span>post keys</span>
              <strong>{formatNavlungoRequestSummaryValue(summary.navlungoRequestSummary.postPayloadKeys)}</strong>
            </div>
            <div className="summary-row">
              <span>package shape</span>
              <strong>
                desi {summary.navlungoRequestSummary.desiPresent ? 'present' : 'missing'} ·{' '}
                {summary.navlungoRequestSummary.desiType ?? '—'} · {summary.navlungoRequestSummary.requestedDesi ?? '—'} · package{' '}
                {summary.navlungoRequestSummary.packageCountPresent ? 'present' : 'missing'} ·{' '}
                {summary.navlungoRequestSummary.packageCountType ?? '—'} · {summary.navlungoRequestSummary.requestedPackageCount ?? '—'}
              </strong>
            </div>
            <div className="summary-row">
              <span>custom data</span>
              <strong>
                1 {formatDiagnosticPresence(summary.navlungoRequestSummary.customData1Present)} · 2{' '}
                {formatDiagnosticPresence(summary.navlungoRequestSummary.customData2Present)} · 3{' '}
                {formatDiagnosticPresence(summary.navlungoRequestSummary.customData3Present)} · 4{' '}
                {formatDiagnosticPresence(summary.navlungoRequestSummary.customData4Present)}
              </strong>
            </div>
          </details>
        ) : null}
        {requestDiffRows.length ? (
          <details className="provider-response-summary diagnostics-nested-panel" aria-label="Navlungo probe retry request diff">
            <summary className="provider-response-heading">
              <strong>Probe vs real request diff</strong>
              <span>Sanitized shape comparison</span>
            </summary>
            <div className="summary-row">
              <span>Response summary</span>
              <strong>
                probe HTTP {navlungoCreatePostProbeDiagnostics?.createPostHttpStatus ?? '—'} · real HTTP{' '}
                {summary.realPathCreatePostHttpStatus ?? summary.providerCallHttpStatus ?? summary.httpStatus ?? '—'} · tracking ID{' '}
                {summary.providerTrackingId || '—'}
              </strong>
            </div>
            <div className="summary-row">
              <span>Real provider message</span>
              <strong>{summary.providerError || '—'}</strong>
            </div>
            {requestDiffRows.map((row) => (
              <div className="summary-row" key={row.label}>
                <span>{row.label}</span>
                <strong>
                  {row.same ? 'same' : 'different'} · probe: {row.probe} · real: {row.real}
                </strong>
              </div>
            ))}
          </details>
        ) : null}
        {summary.lastSuccessfulNavlungoRequestSummary || summary.navlungoRequestSummary ? (
          <details className="provider-response-summary diagnostics-nested-panel" aria-label="Navlungo successful failing request diff">
            <summary className="provider-response-heading">
              <strong>Last successful vs current request diff</strong>
              <span>Sanitized request summaries</span>
            </summary>
            <div className="summary-row">
              <span>Current provider result</span>
              <strong>
                HTTP {summary.realPathCreatePostHttpStatus ?? summary.providerCallHttpStatus ?? summary.httpStatus ?? '—'} · tracking ID{' '}
                {summary.providerTrackingId || '—'}
              </strong>
            </div>
            <div className="summary-row">
              <span>Current provider message</span>
              <strong>{summary.providerError || '—'}</strong>
            </div>
            {summary.lastSuccessfulNavlungoRequestSummary ? (
              renderNavlungoRequestSummaryRows(summary.lastSuccessfulNavlungoRequestSummary, 'last success')
            ) : (
              <div className="summary-row">
                <span>Last successful request</span>
                <strong>not available</strong>
              </div>
            )}
            {summary.navlungoRequestSummary ? (
              renderNavlungoRequestSummaryRows(summary.navlungoRequestSummary, 'current')
            ) : (
              <div className="summary-row">
                <span>Current request</span>
                <strong>not available</strong>
              </div>
            )}
            {successfulRequestDiffRows.map((row) => (
              <div className="summary-row" key={row.label}>
                <span>{row.label}</span>
                <strong>
                  {row.same ? 'same' : 'different'} · success: {row.probe} · current: {row.real}
                </strong>
              </div>
            ))}
          </details>
        ) : null}
        <div className="summary-row">
          <span>Sender address ID</span>
          <strong>
            present {formatDiagnosticPresence(summary.senderAddressIdPresent)} · valid{' '}
            {formatDiagnosticPresence(summary.senderAddressIdValid)} · addressId sender{' '}
            {formatDiagnosticPresence(summary.senderUsesAddressId)}
          </strong>
        </div>
        <div className="summary-row">
          <span>Navlungo sender mode</span>
          <strong>
            {summary.senderMode ?? (summary.senderUsesAddressId ? 'addressId' : '—')} · full sender retry{' '}
            {formatDiagnosticPresence(summary.fullSenderRetryRequested)}
          </strong>
        </div>
        <div className="summary-row">
          <span>Real path provider result</span>
          <strong>
            HTTP {summary.realPathCreatePostHttpStatus ?? '—'} · post{' '}
            {formatDiagnosticPresence(summary.realPathPostNumberPresent)} · tracking{' '}
            {formatDiagnosticPresence(summary.realPathTrackingUrlPresent)} · barcode{' '}
            {formatDiagnosticPresence(summary.realPathBarcodePresent)}
          </strong>
        </div>
        <div className="summary-row">
          <span>Shopify fulfillment sync</span>
          <strong>
            attempted {formatDiagnosticPresence(summary.shopifyFulfillmentSyncAttempted)} · synced{' '}
            {formatDiagnosticPresence(summary.shopifyFulfillmentSynced)} · tracking number{' '}
            {formatDiagnosticPresence(summary.fulfillmentTrackingNumberPresent)} · tracking URL{' '}
            {formatDiagnosticPresence(summary.fulfillmentTrackingUrlPresent)}
            {summary.shopifyFulfillmentSyncSkippedReason ? ` · ${summary.shopifyFulfillmentSyncSkippedReason}` : ''}
          </strong>
        </div>
        {hasValidationDiagnostics ? (
          <>
            <div className="summary-row">
              <span>Create Post HTTP</span>
              <strong>{summary.realPathCreatePostHttpStatus ?? summary.providerCallHttpStatus ?? summary.httpStatus ?? '—'}</strong>
            </div>
            <div className="summary-row">
              <span>Validation fields</span>
              <strong>{summary.failedFieldNames?.length ? summary.failedFieldNames.join(', ') : '—'}</strong>
            </div>
            <div className="summary-row">
              <span>Validation messages</span>
              <strong>{summary.validationErrorMessages?.length ? summary.validationErrorMessages.join(' · ') : '—'}</strong>
            </div>
            <div className="summary-row">
              <span>Validation counts</span>
              <strong>
                fields {summary.failedFieldNamesCount ?? summary.failedFieldNames?.length ?? 0} · messages{' '}
                {summary.validationErrorMessagesCount ?? summary.validationErrorMessages?.length ?? 0} · keys{' '}
                {summary.validationErrorKeysCount ?? summary.validationErrorKeys?.length ?? 0}
              </strong>
            </div>
            <div className="summary-row">
              <span>Validation shapes</span>
              <strong>
                top {summary.topLevelErrorShape ?? '—'} · nested {summary.nestedCreatePostErrorShape ?? '—'} · provider{' '}
                {summary.providerValidationErrorsShape ?? '—'}
              </strong>
            </div>
            {summary.providerErrorCode ? (
              <div className="summary-row">
                <span>Provider error code</span>
                <strong>{summary.providerErrorCode}</strong>
              </div>
            ) : null}
          </>
        ) : null}
        <div className="summary-row">
          <span>Normalized evidence</span>
          <strong>
            id {formatDiagnosticPresence(summary.normalizedProviderShipmentIdPresent)} · tracking{' '}
            {formatDiagnosticPresence(summary.normalizedTrackingUrlPresent)} · barcode{' '}
            {formatDiagnosticPresence(summary.normalizedBarcodePresent)}
          </strong>
        </div>
        <div className="summary-row">
          <span>Persisted evidence</span>
          <strong>
            id {formatDiagnosticPresence(summary.persistedProviderShipmentIdPresent)} · tracking{' '}
            {formatDiagnosticPresence(summary.persistedTrackingUrlPresent)} · barcode{' '}
            {formatDiagnosticPresence(summary.persistedBarcodePresent)}
          </strong>
        </div>
        <div className="summary-row">
          <span>Real path persisted evidence</span>
          <strong>
            id {formatDiagnosticPresence(summary.realPathPersistedProviderShipmentIdPresent)} · tracking{' '}
            {formatDiagnosticPresence(summary.realPathPersistedTrackingUrlPresent)} · barcode{' '}
            {formatDiagnosticPresence(summary.realPathPersistedBarcodePresent)}
          </strong>
        </div>
        <div className="summary-row">
          <span>DTO evidence</span>
          <strong>
            id {formatDiagnosticPresence(summary.dtoProviderShipmentIdPresent)} · tracking{' '}
            {formatDiagnosticPresence(summary.dtoTrackingUrlPresent)} · barcode{' '}
            {formatDiagnosticPresence(summary.dtoBarcodePresent)}
          </strong>
        </div>
        {summary.skipReason ? (
          <div className="summary-row">
            <span>Skip reason</span>
            <strong>{summary.skipReason}</strong>
          </div>
        ) : null}
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
      dedupeSupportTickets(
        safeArray(relatedSupportTicketsData).filter((ticket) =>
          supportTicketMatchesOrder(ticket, order?.id, order?.sourceShopifyOrderNumber, {
            audience: isAdmin ? 'admin' : 'vendor',
            currentVendorId: currentVendor.vendorId,
          }),
        ),
      ),
    [currentVendor.vendorId, isAdmin, order?.id, order?.sourceShopifyOrderNumber, relatedSupportTicketsData],
  );
  const supportActivitySummary = getSupportActivitySummary(relatedSupportTickets);

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
        const resultState = getShipmentActionResultState(shipment, 'retry');
        setShipmentActionState({
          ...resultState,
          shipment,
          endpoint: `POST /admin/shipments/${shipmentExecution.id}/retry`,
        });
        showFeedback(resultState.message, resultState.tone);
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

  const renderOrderDetailFrame = (body?: ReactNode) => (
    <section className="order-detail-workspace order-detail-cockpit order-detail-dense" aria-label="Order detail render frame">
      <header className="order-detail-topbar">
        <Link className="order-detail-back" to="/orders">
          Back to orders
        </Link>
        <div className="order-detail-title-row">
          <div className="order-detail-title-stack">
            <div className="order-detail-heading-line">
              <h1>Order detail</h1>
              <span className="order-source-pill">Loading</span>
            </div>
            <div className="order-detail-meta-strip" aria-label="Order summary skeleton">
              {['Created', 'Vendor', 'Customer', 'Shopify ID'].map((label) => (
                <div key={label}>
                  <span>{label}</span>
                  <strong>
                    <SkeletonText width={label === 'Shopify ID' ? '7rem' : '5rem'} />
                  </strong>
                </div>
              ))}
            </div>
            <div className="order-ship-to-note" aria-label="Shipping address summary">
              <span>Ship to</span>
              <strong>
                <SkeletonText width="14rem" />
              </strong>
            </div>
          </div>
        </div>
        <div className="order-detail-status-pills" aria-label="Order status skeleton">
          <span className="status-badge status-pending">Loading</span>
          <span className="status-badge status-pending">Fulfillment</span>
          <span className="status-badge status-pending">Shipping</span>
        </div>
      </header>

      <div className="order-status-summary-grid" aria-label="Order KPI skeleton">
        {['Lifecycle', 'Shipping', 'Tracking', 'Finance'].map((label) => (
          <article key={label} className="order-status-summary-card order-status-neutral">
            <span className="order-status-icon" aria-hidden="true">
              -
            </span>
            <div>
              <span>{label}</span>
              <strong>
                <SkeletonText width="5rem" />
              </strong>
              <p>
                <SkeletonText width="8rem" />
              </p>
            </div>
          </article>
        ))}
      </div>

      <div className="order-detail-main-grid">
        <main className="order-detail-main-column" aria-label="Order operations">
          <article className="order-detail-card-v2 order-line-items-card">
            <div className="order-card-heading">
              <h2>Line items</h2>
            </div>
            {body ?? (
              <div className="order-line-items-list" aria-label="Order line item skeleton">
                {Array.from({ length: 3 }, (_, index) => (
                  <div key={`order-detail-line-skeleton-${index}`} className="order-line-item-row op-skeleton-row">
                    <div>
                      <SkeletonText width="12rem" />
                      <SkeletonText width="7rem" />
                    </div>
                    <SkeletonText width="4rem" />
                  </div>
                ))}
              </div>
            )}
          </article>
        </main>
        <aside className="order-detail-rail" aria-label="Order operational rail">
          <div className="order-detail-sidebar-flow">
            <article className="operational-timeline-card order-detail-card-v2">
              <div className="order-card-heading">
                <h2>Timeline</h2>
              </div>
              <div className="order-timeline-list" aria-label="Order timeline skeleton">
                <SkeletonText width="70%" />
                <SkeletonText width="55%" />
              </div>
            </article>
            <article className="order-support-card order-detail-card-v2">
              <div className="order-card-heading">
                <h2>Support</h2>
              </div>
              <SkeletonText width="75%" />
            </article>
          </div>
        </aside>
      </div>
    </section>
  );

  if (!authContextReady || (isLoading && !order)) {
    return renderOrderDetailFrame();
  }

  if (isError || !order) {
    return renderOrderDetailFrame(
      <SectionErrorRetry
        title="Order unavailable"
        description={error ?? 'The selected order could not be loaded.'}
        onRetry={() => void refetch()}
      />,
    );
  }

  const orderItems = safeArray(order.lineItems).length ? safeArray(order.lineItems) : safeArray(order.items);
  const snapshotCurrency = getSnapshotCurrency(order);
  const customerLabel = getCompactCustomerLabel(order.customer);
  const trackingTitle = getTrackingTitle(order);
  const trackingHelper = getTrackingHelper(order);
  const financePreview = isAdmin ? order.financeLedgerPreview : null;
  const financeSummaryUnknowns = financePreview?.unknowns ?? [];
  const payoutFinanceRecord = relatedFinanceRecords.find((record) => record.category !== 'Refund');
  const refundFinanceRecord = relatedFinanceRecords.find((record) => record.category === 'Refund');
  const settlementFinanceRecord = relatedFinanceRecords.find((record) => record.category === 'Payout' || record.category === 'Invoice') ?? null;
  const payoutCalculation = payoutFinanceRecord?.payoutCalculation ?? null;
  const refundCalculation = refundFinanceRecord?.payoutCalculation ?? null;
  const shippingDeductionUnknown =
    Boolean(financePreview && (financePreview.unknowns.includes('shipping_cost') || financePreview.sourceFields.shippingCost === 'unknown')) ||
    payoutCalculation?.shippingCostStatus === 'pending_provider_cost';
  const currentRefundEvidencePresent =
    relatedReturns.length > 0 ||
    Boolean(refundFinanceRecord) ||
    Boolean(financePreview && (financePreview.sourceFields.returnCount > 0 || financePreview.sourceFields.refundCount > 0));
  const refundImpactValue = financePreview
    ? financePreview.unknowns.includes('refund_reversal_amount')
      ? ORDER_FINANCE_UNKNOWN_VALUE
      : isPositiveFinanceValue(financePreview.balance.vendorDebt)
        ? formatCurrency(financePreview.balance.vendorDebt, financePreview.currency)
        : financePreview.sourceFields.returnCount > 0 || financePreview.sourceFields.refundCount > 0
          ? refundCalculation?.refundImpact ?? refundFinanceRecord?.amount ?? ORDER_FINANCE_UNKNOWN_VALUE
          : formatCurrency('0.00', financePreview.currency)
    : refundCalculation?.refundImpact ?? refundFinanceRecord?.amount ?? (currentRefundEvidencePresent ? ORDER_FINANCE_UNKNOWN_VALUE : formatCurrency('0.00'));
  const financePreviewRows = [
    {
      label: 'Gross order amount',
      value:
        financePreview
          ? formatFinancePreviewValue(financePreview.balance.grossSales, financePreview.currency)
          : payoutCalculation?.grossAmount ?? (isMeaningfulFinanceValue(order.amount) ? order.amount : ORDER_FINANCE_UNKNOWN_VALUE),
      state: 'Estimated',
    },
    {
      label: 'Commission estimate',
      value: financePreview
        ? formatFinancePreviewValue(financePreview.balance.marketplaceCommission, financePreview.currency, {
            unknown: financePreview.unknowns.includes('commission_rate'),
          })
        : payoutCalculation?.commission ?? ORDER_FINANCE_UNKNOWN_VALUE,
      state: 'Estimated',
    },
    {
      label: 'Shipping deduction',
      value: financePreview
        ? formatFinancePreviewValue(financePreview.balance.shippingCostReserved, financePreview.currency, {
            unknown: shippingDeductionUnknown,
          })
        : shippingDeductionUnknown
          ? ORDER_FINANCE_UNKNOWN_VALUE
          : payoutCalculation?.shippingDeduction ?? ORDER_FINANCE_UNKNOWN_VALUE,
      state: 'Estimated',
    },
    {
      label: 'Refund impact',
      value: refundImpactValue,
      state: 'Estimated',
    },
    {
      label: 'Estimated settlement',
      value: financePreview
        ? formatFinancePreviewValue(financePreview.balance.netVendorPosition, financePreview.currency, {
            unknown: financePreview.unknowns.includes('vendor_payable'),
          })
        : payoutCalculation?.estimatedPayout ?? ORDER_FINANCE_UNKNOWN_VALUE,
      state: 'Estimated',
    },
  ].map((row) => ({
    ...row,
    state: row.value === ORDER_FINANCE_UNKNOWN_VALUE ? ORDER_FINANCE_UNKNOWN_VALUE : row.state,
  }));
  const financePreviewEntryTime = (eventType: string) =>
    financePreview?.entries.find((entry) => entry.eventType === eventType)?.occurredAt ?? null;
  const commissionEstimateValue = financePreviewRows.find((row) => row.label === 'Commission estimate')?.value ?? ORDER_FINANCE_UNKNOWN_VALUE;
  const shippingDeductionValue = financePreviewRows.find((row) => row.label === 'Shipping deduction')?.value ?? ORDER_FINANCE_UNKNOWN_VALUE;
  const estimatedSettlementValue = financePreviewRows.find((row) => row.label === 'Estimated settlement')?.value ?? ORDER_FINANCE_UNKNOWN_VALUE;
  const paymentEvidenceRecord = relatedFinanceRecords.find((record) => record.payoutBatch?.status === 'paid_placeholder');
  const manualAdjustmentRecords = relatedFinanceRecords.filter((record) => record.category === 'Adjustment');
  const settlementTimelineRecord = settlementFinanceRecord ?? (payoutCalculation ? payoutFinanceRecord : null);
  const orderSettlementGuidance = getFinanceWorkflowAction({
    status: settlementTimelineRecord?.status ?? financePreview?.status ?? null,
    settlementStatus: settlementTimelineRecord?.settlement?.status ?? null,
    payoutReady: settlementTimelineRecord?.settlement?.payoutReady ?? false,
    hasRefundImpact: currentRefundEvidencePresent,
    audience: isAdmin ? 'admin' : 'vendor',
  });
  const financeTimelineItems = [
    financePreview || payoutCalculation || settlementTimelineRecord
      ? {
          id: 'finance-settlement-preview-generated',
          title: 'Settlement preview generated',
          description: isKnownFinanceValue(estimatedSettlementValue)
            ? `${estimatedSettlementValue} · Estimated from available order finance data.`
            : 'Settlement preview is waiting for complete finance inputs.',
          at: settlementTimelineRecord?.date ?? financePreviewEntryTime('ORDER_CAPTURED') ?? order.date,
          status: 'Preview',
          tone: 'info' as const,
          href: settlementTimelineRecord ? buildFinanceHref(settlementTimelineRecord) : undefined,
        }
      : null,
    isKnownFinanceValue(commissionEstimateValue)
      ? {
          id: 'finance-commission-estimated',
          title: 'Commission estimated',
          description: `${commissionEstimateValue} · Estimated from available finance data.`,
          at: financePreviewEntryTime('MARKETPLACE_COMMISSION_RESERVED') ?? settlementTimelineRecord?.date ?? order.date,
          status: 'Estimated',
          tone: 'info' as const,
        }
      : null,
    financePreview || payoutCalculation
      ? shippingDeductionUnknown
        ? {
            id: 'finance-shipping-deduction-unknown',
            title: 'Shipping deduction unknown',
            description: 'Shipping cost evidence is not available yet.',
            at: financePreviewEntryTime('SHIPPING_COST_RESERVED') ?? settlementTimelineRecord?.date ?? order.date,
            status: ORDER_FINANCE_UNKNOWN_VALUE,
            tone: 'warning' as const,
          }
        : isKnownFinanceValue(shippingDeductionValue)
          ? {
              id: 'finance-shipping-deduction-estimated',
              title: 'Shipping deduction estimated',
              description: `${shippingDeductionValue} · Estimated from available shipping evidence.`,
              at: financePreviewEntryTime('SHIPPING_COST_RESERVED') ?? settlementTimelineRecord?.date ?? order.date,
              status: 'Estimated',
              tone: 'info' as const,
            }
          : null
      : null,
    currentRefundEvidencePresent
      ? {
          id: 'finance-refund-impact',
          title: isKnownFinanceValue(refundImpactValue) ? 'Refund impact estimated' : 'Refund impact pending',
          description: isKnownFinanceValue(refundImpactValue)
            ? `${refundImpactValue} · Estimated from linked return/refund evidence.`
            : 'Return or refund evidence exists, but finance impact is not available yet.',
          at: refundFinanceRecord?.date ?? relatedReturns[0]?.date ?? financePreviewEntryTime('RETURN_CREATED') ?? order.date,
          status: isKnownFinanceValue(refundImpactValue) ? 'Estimated' : 'Pending',
          tone: 'warning' as const,
          href: refundFinanceRecord ? buildFinanceHref(refundFinanceRecord) : relatedReturns[0] ? `/returns/${relatedReturns[0].id}` : undefined,
        }
      : null,
    financePreview || payoutCalculation || settlementTimelineRecord
      ? {
          id: 'finance-settlement-review',
          title: 'Settlement awaiting review',
          description: isKnownFinanceValue(estimatedSettlementValue)
            ? `${estimatedSettlementValue} · Not approved for settlement.`
            : 'Settlement estimate needs more finance evidence.',
          at: settlementTimelineRecord?.settlement?.payableAt ?? settlementTimelineRecord?.settlement?.eligibleAt ?? settlementTimelineRecord?.date ?? order.date,
          status: 'Review',
          tone: 'attention' as const,
          href: settlementTimelineRecord ? buildFinanceHref(settlementTimelineRecord) : undefined,
        }
      : null,
    paymentEvidenceRecord
      ? {
          id: `finance-payment-evidence-${paymentEvidenceRecord.id}`,
          title: 'Payment evidence pending',
          description: 'Existing finance review row is waiting for payment evidence.',
          at: paymentEvidenceRecord.payoutBatch?.createdAt ?? paymentEvidenceRecord.date,
          status: 'Evidence pending',
          tone: 'attention' as const,
          href: buildFinanceHref(paymentEvidenceRecord),
          visibility: 'admin' as const,
        }
      : null,
    ...manualAdjustmentRecords.map((record) => ({
      id: `finance-adjustment-${record.id}`,
      title: 'Manual adjustment recorded',
      description: `${record.amount} · ${record.status}`,
      at: record.date,
      status: record.status,
      tone: 'neutral' as const,
      href: buildFinanceHref(record),
      visibility: 'admin' as const,
    })),
  ].filter(Boolean) as OperationalEventInput[];
  const visibleFinanceTimelineItems = financeTimelineItems.filter((item) => item.visibility !== 'admin' || isAdmin);
  const financeUnknownIndicators = isAdmin
    ? [
        ...(financeSummaryUnknowns.length ? financeSummaryUnknowns : []),
        financePreview?.sourceFields.shippingCost === 'unknown' ? 'shipping_cost' : null,
        !financePreview ? 'ledger_preview_unavailable' : null,
      ].filter(Boolean) as string[]
    : [];
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
  if (visibleShipmentExecution?.provider === 'navlungo' && shipmentProviderSummary?.navlungoUpdateSucceeded === true) {
    orderTimelineEvents.push({
      id: `navlungo-shipment-updated-${visibleShipmentExecution.id}`,
      title: 'Shipment updated',
      description: getSafeProviderTimelineDescription(
        shipmentProviderSummary.navlungoUpdateProviderMessage,
        'Recipient/shipment details updated',
      ),
      at: shipmentProviderSummary.navlungoUpdatedAt ?? visibleShipmentExecution.updatedAt ?? visibleShipmentExecution.lastProviderResponseAt ?? order.date,
      status: 'Updated',
      tone: 'info',
    });
  }
  if (visibleShipmentExecution?.provider === 'navlungo' && shipmentProviderSummary?.navlungoCancelSucceeded === true) {
    orderTimelineEvents.push({
      id: `navlungo-shipment-cancelled-${visibleShipmentExecution.id}`,
      title: 'Shipment cancelled',
      description: getSafeProviderTimelineDescription(
        shipmentProviderSummary.navlungoCancelProviderMessage,
        'Provider shipment cancelled',
      ),
      at: shipmentProviderSummary.navlungoCancelledAt ?? visibleShipmentExecution.updatedAt ?? visibleShipmentExecution.lastProviderResponseAt ?? order.date,
      status: 'Cancelled',
      tone: 'warning',
    });
  }
  if (visibleShipmentExecution?.provider === 'navlungo') {
    getNavlungoLifecycleLogEvents(shipmentProviderSummary).forEach((event, index) => {
      orderTimelineEvents.push({
        id: `navlungo-status-${visibleShipmentExecution.id}-${event.fingerprint}-${index}`,
        title: event.title,
        description: event.description,
        at: event.at ?? visibleShipmentExecution.lastProviderResponseAt ?? visibleShipmentExecution.updatedAt ?? order.date,
        status: event.status,
        tone: event.tone,
      });
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
      status: formatSupportTicketStatus(ticket.status),
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
        status: formatSupportTicketStatus(ticket.status),
        tone: 'success' as const,
        href: `${supportBasePath}/${ticket.id}`,
      })),
  );
  const orderCrossLinks: OperationalLinkInput[] = [
    ...relatedReturns.map((returnRecord) => ({
      id: `return-${returnRecord.id}`,
      eyebrow: 'Return',
      title: `Return for ${formatShopifyOrderNumber(returnRecord.sourceShopifyOrderNumber)}`,
      description: [
        returnRecord.status,
        returnRecord.returnProviderShipmentId ? 'Navlungo pickup created' : null,
        returnRecord.displayTitle ?? returnRecord.itemTitle ?? 'Returned item',
      ].filter(Boolean).join(' · '),
      actionLabel: 'Open return detail',
      href: `/returns/${returnRecord.id}`,
      status: returnRecord.status === 'Closed' || returnRecord.status === 'Refunded' ? 'Return closed' : 'Return linked',
      tone: returnRecord.status === 'Refunded' || returnRecord.status === 'Closed' ? ('success' as const) : ('attention' as const),
    })),
    ...relatedFinanceRecords.map((record) => ({
      id: `finance-${record.id}`,
      eyebrow: 'Finance',
      title: record.category === 'Refund' ? 'Refund impact' : 'Settlement activity',
      description: `${record.amount} · ${record.status}`,
      actionLabel: 'Open finance detail',
      href: buildFinanceHref(record),
      status: record.status === 'Pending' ? 'Pending review' : record.category,
      tone: record.category === 'Refund' ? ('warning' as const) : ('success' as const),
    })),
    ...(supportActivitySummary
      ? [
          {
            id: `support-group-${order.id}`,
            eyebrow: 'Support',
            title: 'Support activity',
            description: supportActivitySummary.description,
            actionLabel: 'Open latest support ticket',
            href: `${supportBasePath}/${supportActivitySummary.latestTicket.id}`,
            status: supportActivitySummary.latestStatus,
            tone: supportActivitySummary.tone,
          },
        ]
      : []),
  ];
  const activeReturn = relatedReturns.find((returnRecord) => !['Closed', 'Processed', 'Refunded'].includes(returnRecord.status));
  const waitingSupportTicket = relatedSupportTickets.find((ticket) => ticket.status === 'WAITING_FOR_VENDOR');
  const openLinkedSupportTicket = relatedSupportTickets.find(isOpenSupportTicket) ?? null;
  const linkedSupportTicketHref = openLinkedSupportTicket ? `${supportBasePath}/${openLinkedSupportTicket.id}` : null;
  const linkedSupportTicketEscalated = openLinkedSupportTicket ? isEscalatedSupportTicket(openLinkedSupportTicket) : false;
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
            ? `Customer return ${(activeReturn.status ?? 'unknown').toLowerCase()}. Review return tracking and Shopify sync before closing the loop.`
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
  const isKargonomiConfigDraft = shippingConfigDraft.preferredProvider === 'kargonomi';
  const isNavlungoConfigDraft = shippingConfigDraft.preferredProvider === 'navlungo';
  const shouldShowTryOtoProviderOption =
    vendorShippingConfig?.preferredProvider === 'try_oto' ||
    shippingProviderDiagnostics?.provider === 'try_oto' ||
    Boolean(shippingProviderDiagnostics?.supportedProviders?.includes('try_oto')) ||
    Boolean(tryOtoOptionDiagnostics?.supportedProviders?.includes('try_oto')) ||
    Boolean(tryOtoOptionDiagnostics?.providerEnabled);
  const shouldShowKargonomiProviderOption =
    vendorShippingConfig?.preferredProvider === 'kargonomi' ||
    shippingProviderDiagnostics?.provider === 'kargonomi' ||
    Boolean(shippingProviderDiagnostics?.supportedProviders?.includes('kargonomi')) ||
    Boolean(kargonomiOptionDiagnostics?.supportedProviders?.includes('kargonomi')) ||
    Boolean(kargonomiOptionDiagnostics?.providerEnabled);
  const tryOtoPickupLocationCode = readTryOtoPickupLocationCode(vendorShippingConfig);
  const tryOtoOriginCity = readTryOtoOriginCity(vendorShippingConfig);
  const kargonomiBuyerStateId = readKargonomiBuyerStateId(vendorShippingConfig);
  const kargonomiBuyerCityId = readKargonomiBuyerCityId(vendorShippingConfig);

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
                preferredProvider: event.target.value as ShippingConfigDraftProvider,
              }))
            }
          >
            <option value="kargo_entegrator">Kargo Entegratör</option>
            {shouldShowTryOtoProviderOption ? <option value="try_oto">Try OTO</option> : null}
            {shouldShowKargonomiProviderOption ? <option value="kargonomi">Kargonomi</option> : null}
            <option value="navlungo">Navlungo</option>
            <option value="hepsijet">Hepsijet</option>
          </select>
        </label>
        {isKargoConfigDraft || isKargonomiConfigDraft ? (
          <>
            {isKargoConfigDraft ? (
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
            ) : null}
            <label className="field">
              <span>{isKargonomiConfigDraft ? 'Kargonomi warehouse ID' : 'Warehouse ID'}</span>
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
            {isKargonomiConfigDraft ? (
              <>
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
              </>
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
              <strong>{navlungoOptionDiagnostics?.baseUrlConfigured ? 'yes' : 'no'}</strong>
            </div>
            <div className="shipping-config-readonly">
              <span>Username configured</span>
              <strong>{navlungoOptionDiagnostics?.navlungo?.usernameConfigured ? 'yes' : 'no'}</strong>
            </div>
            <div className="shipping-config-readonly">
              <span>Password configured</span>
              <strong>{navlungoOptionDiagnostics?.navlungo?.passwordConfigured ? 'yes' : 'no'}</strong>
            </div>
            <div className="shipping-config-readonly">
              <span>Sender address configured</span>
              <strong>{navlungoOptionDiagnostics?.navlungo?.defaultSenderAddressIdConfigured ? 'yes' : 'no'}</strong>
            </div>
            <div className="shipping-config-readonly">
              <span>Auth diagnostics available</span>
              <strong>{navlungoOptionDiagnostics?.navlungo?.authDiagnosticsAvailable ? 'yes' : 'no'}</strong>
            </div>
            <div className="shipping-config-readonly">
              <span>Runtime shipment execution enabled</span>
              <strong>{navlungoOptionDiagnostics?.navlungo?.runtimeShipmentExecutionEnabled ? 'yes' : 'no'}</strong>
            </div>
            <div className="shipping-config-readonly">
              <span>Return/reverse implementation</span>
              <strong>NOT IMPLEMENTED</strong>
            </div>
            <div className="shipping-config-readonly">
              <span>Create Post execution</span>
              <strong>{navlungoOptionDiagnostics?.executionReady ? 'ready' : 'not ready'}</strong>
            </div>
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
                orderItems.map((item) => {
                  const imageAlt = getLineItemImageAlt(item);
                  return (
                    <div key={item.id} className="order-line-item-row-v2">
                      <ProductImagePreview
                        imageUrl={item.imageUrl}
                        fallbackLabel={getInitialsLabel(item.name || item.sku || 'Item')}
                        alt={imageAlt}
                        title={item.name || item.sku || 'Product image'}
                        subtitle={[item.sku, item.variantTitle].filter(Boolean).join(' · ')}
                      />
                      <div className="order-item-primary">
                        <strong>{item.name || 'Unknown item'}</strong>
                        <span>{[item.variantTitle, item.sku].filter(Boolean).join(' · ') || 'SKU pending'}</span>
                        <small>
                          {[
                            `VAT ${formatVatRate(item.vatRate)}`,
                            item.lineTaxAmount ? `VAT amount ${formatSnapshotAmount(item.lineTaxAmount, snapshotCurrency)}` : null,
                            `Unit price incl. VAT ${formatSnapshotAmount(item.unitPriceVatIncluded, snapshotCurrency)}`,
                            `Line total incl. VAT ${formatSnapshotAmount(item.lineTotalVatIncluded, snapshotCurrency)}`,
                            item.shopifyProductId ? `Shopify product ${item.shopifyProductId}` : null,
                          ].filter(Boolean).join(' · ')}
                        </small>
                      </div>
                      <div>
                        <span>Qty</span>
                        <strong>{item.quantity}</strong>
                      </div>
                      <div>
                        <span>Total</span>
                        <strong>{item.price}</strong>
                      </div>
                    </div>
                  );
                })
              ) : (
                <p className="order-empty-copy">No records available.</p>
              )}
            </div>
          </article>

          <article className="order-detail-card-v2 order-workspace-panel" aria-label="Integration snapshot">
            <div className="order-card-heading">
              <div>
                <h2>Integration Snapshot</h2>
                <p>Read-only Shopify order fields persisted for vendor integration providers.</p>
              </div>
            </div>
            <div className="order-financial-impact-grid order-finance-preview-grid">
              <div>
                <span>Financial status</span>
                <strong>{formatSnapshotValue(order.orderSnapshot?.financialStatus)}</strong>
              </div>
              <div>
                <span>Payment gateway</span>
                <strong>{formatSnapshotValue(order.orderSnapshot?.paymentGatewayName)}</strong>
              </div>
              <div>
                <span>Vendor integration</span>
                <strong>{formatSnapshotValue(order.orderSnapshot?.vendorIntegrationStatus)}</strong>
              </div>
              <div>
                <span>Tax total</span>
                <strong>{formatSnapshotAmount(order.orderSnapshot?.orderTaxAmount, snapshotCurrency)}</strong>
              </div>
              <div>
                <span>Currency</span>
                <strong>{formatSnapshotValue(order.orderSnapshot?.currency)}</strong>
              </div>
              <div>
                <span>Shipping amount</span>
                <strong>{formatSnapshotAmount(order.orderSnapshot?.shippingAmount, snapshotCurrency)}</strong>
              </div>
              <div>
                <span>Discount amount</span>
                <strong>{formatSnapshotAmount(order.orderSnapshot?.discountAmount, snapshotCurrency)}</strong>
              </div>
              <div>
                <span>Shopify created</span>
                <strong>{order.orderSnapshot?.shopifyCreatedAt ? formatOptionalDate(order.orderSnapshot.shopifyCreatedAt) : '—'}</strong>
              </div>
            </div>
            <div className="orders-rail-summary-list">
              <div>
                <span>Billing address</span>
                <strong>{formatBillingAddress(order.orderSnapshot?.billingAddress)}</strong>
              </div>
              {order.orderSnapshot?.orderNote ? (
                <div>
                  <span>Order note</span>
                  <strong>{order.orderSnapshot.orderNote}</strong>
                </div>
              ) : null}
              {order.orderSnapshot?.orderTags?.length ? (
                <div>
                  <span>Order tags</span>
                  <strong>{order.orderSnapshot.orderTags.join(', ')}</strong>
                </div>
              ) : null}
              {order.orderSnapshot?.vendorIntegrationStatusMessage ? (
                <div>
                  <span>Integration note</span>
                  <strong>{order.orderSnapshot.vendorIntegrationStatusMessage}</strong>
                </div>
              ) : null}
              {order.orderSnapshot?.vendorIntegrationProvider ? (
                <div>
                  <span>Integration provider</span>
                  <strong>{order.orderSnapshot.vendorIntegrationProvider}</strong>
                </div>
              ) : null}
              {order.orderSnapshot?.vendorIntegrationTrackingUrl ? (
                <div>
                  <span>External shipment</span>
                  <strong>
                    <a className="inline-link" href={order.orderSnapshot.vendorIntegrationTrackingUrl} target="_blank" rel="noreferrer">
                      Open external tracking
                    </a>
                  </strong>
                </div>
              ) : null}
              {order.orderSnapshot?.vendorIntegrationShippedAt ? (
                <div>
                  <span>External shipped at</span>
                  <strong>{formatOptionalDate(order.orderSnapshot.vendorIntegrationShippedAt)}</strong>
                </div>
              ) : null}
            </div>
          </article>

          {order.orderSnapshot?.vendorInvoiceNumber ? (
            <article className="order-detail-card-v2 order-workspace-panel" aria-label="Vendor invoice">
              <div className="order-card-heading">
                <div>
                  <h2>Vendor Invoice</h2>
                  <p>Provider-reported invoice reference. Informational only; no accounting posting is created here.</p>
                </div>
              </div>
              <div className="order-financial-impact-grid order-finance-preview-grid">
                <div>
                  <span>Invoice Number</span>
                  <strong>{order.orderSnapshot.vendorInvoiceNumber}</strong>
                </div>
                <div>
                  <span>Invoice Date</span>
                  <strong>{order.orderSnapshot.vendorInvoiceDate ?? '—'}</strong>
                </div>
                <div>
                  <span>Invoice Amount</span>
                  <strong>{formatSnapshotAmount(order.orderSnapshot.vendorInvoiceAmount, snapshotCurrency)}</strong>
                </div>
                <div>
                  <span>Received At</span>
                  <strong>{order.orderSnapshot.vendorInvoiceReceivedAt ? formatOptionalDate(order.orderSnapshot.vendorInvoiceReceivedAt) : '—'}</strong>
                </div>
              </div>
              {order.orderSnapshot.vendorInvoiceUrl ? (
                <div className="orders-rail-summary-list">
                  <div>
                    <span>Invoice URL</span>
                    <strong>
                      <a className="inline-link" href={order.orderSnapshot.vendorInvoiceUrl} target="_blank" rel="noreferrer">
                        Open invoice
                      </a>
                    </strong>
                  </div>
                </div>
              ) : null}
            </article>
          ) : null}

          <article
            id="settlement-preview"
            ref={settlementPreviewRef}
            className="order-detail-card-v2 order-financial-summary-card order-workspace-panel"
            aria-label="Order finance preview"
            tabIndex={-1}
          >
            <div className="order-card-heading">
              <div>
                <h2>Settlement preview</h2>
                <p>{ORDER_FINANCE_HELPER_COPY}</p>
              </div>
              <span className="order-preview-badge">Preview</span>
            </div>
            <WorkflowActionGuidance
              actionLabel={orderSettlementGuidance.actionLabel}
              description={orderSettlementGuidance.description}
              tone={orderSettlementGuidance.tone}
            />
            <div className="order-financial-impact-grid order-finance-preview-grid">
              {financePreviewRows.map((row) => (
                <div key={row.label}>
                  <span>{row.label}</span>
                  <strong>{row.value}</strong>
                  <em>{row.state}</em>
                </div>
              ))}
            </div>
            {financeUnknownIndicators.length ? (
              <div className="finance-inline-unknowns" aria-label="Finance unknown indicators">
                <span>Unknown inputs</span>
                {Array.from(new Set(financeUnknownIndicators)).map((unknown) => (
                  <strong key={unknown}>{toTitleCaseLabel(unknown.replace(/_/g, ' '))}</strong>
                ))}
              </div>
            ) : null}
          </article>

          <article className="order-detail-card-v2 order-finance-timeline-card order-workspace-panel" aria-label="Finance timeline">
            <div className="order-card-heading">
              <div>
                <h2>Finance timeline</h2>
                <p>{ORDER_FINANCE_TIMELINE_HELPER_COPY}</p>
              </div>
              <span className="order-preview-badge">Preview</span>
            </div>
            {visibleFinanceTimelineItems.length ? (
              <ol className="order-finance-timeline-list">
                {visibleFinanceTimelineItems.map((item) => (
                  <li key={item.id}>
                    <span className={`order-finance-timeline-dot op-tone-${item.tone ?? 'neutral'}`} aria-hidden="true" />
                    <div className="order-finance-timeline-content">
                      <div className="order-finance-timeline-title-row">
                        {item.href ? <Link to={item.href}>{item.title}</Link> : <strong>{item.title}</strong>}
                        {item.status ? (
                          <span className={`order-finance-timeline-status op-tone-${item.tone ?? 'neutral'}`}>{item.status}</span>
                        ) : null}
                      </div>
                      {item.description ? <p>{item.description}</p> : null}
                      <small>{formatOptionalDate(item.at ?? undefined)}</small>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="order-empty-copy">No finance events available yet.</p>
            )}
          </article>

          {isAdmin && order.financeLedgerPreview ? (
            <article className="order-detail-card-v2 order-finance-ledger-card order-workspace-panel" aria-label="Finance ledger preview">
              <div className="order-card-heading">
                <div>
                  <h2>Finance ledger preview</h2>
                  <p>Admin-only calculation trace for reconciliation. Not settlement, invoice, tax, or payout truth.</p>
                </div>
              </div>
              <div className="order-financial-impact-grid">
                <div>
                  <span>Vendor settlement estimate</span>
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
                  {safeArray(order.financeLedgerPreview.entries).slice(0, 12).map((entry) => (
                    <div className="summary-row" key={entry.id}>
                      <span>{toTitleCaseLabel(entry.eventType)}</span>
                      <strong>
                        {[
                          entry.impact.vendorPayable ? `settlement ${formatCurrency(entry.impact.vendorPayable, entry.currency)}` : null,
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
              subtitle="Returns, settlement activity, and grouped support context linked to this order."
              links={orderCrossLinks}
              audience={audience}
            />
            {relatedSupportTickets.length > 1 ? (
              <details className="finance-support-history">
                <summary>
                  <span>
                    <strong>Support history</strong>
                    {supportActivitySummary ? <small>Latest status: {supportActivitySummary.latestStatus}</small> : null}
                  </span>
                  <span className="op-badge op-tone-neutral">{supportActivitySummary?.ticketLabel ?? `${relatedSupportTickets.length} linked tickets`}</span>
                </summary>
                <div className="finance-support-history-list">
                  {relatedSupportTickets.map((ticket) => (
                    <Link key={ticket.id} to={`${supportBasePath}/${ticket.id}`}>
                      <span>
                        <strong>{ticket.subject}</strong>
                        <small>{formatSupportTicketStatus(ticket.status)} · {formatSupportTicketPriority(ticket.priority)}</small>
                      </span>
                      <small>{formatOptionalDate(getSupportLatestActivityAt(ticket))}</small>
                    </Link>
                  ))}
                </div>
              </details>
            ) : null}
          </div>
        </main>

        <aside className="order-detail-right-rail" aria-label="Order timeline and support">
          <div className="order-detail-sidebar-flow">
            <OperationalTimeline
              title="Timeline"
              subtitle="Order, shipment, return, and support activity."
              events={groupOrderDetailTimelineEvents([
                ...safeArray(order.timeline)
                  .filter((entry) => !isRawProviderTimelineLabel(entry.label))
                  .map((entry) => ({
                    id: `order-native-${entry.label}-${entry.at}`,
                    title: getVendorTimelineLabel(entry.label),
                    at: entry.at,
                    tone: 'neutral' as const,
                    visibility: getNativeTimelineVisibility(entry.label),
                  })),
                ...orderTimelineEvents,
              ]).sort(
                (left, right) =>
                  getSafeTimestamp(left.at ?? order.date, Number.POSITIVE_INFINITY) -
                  getSafeTimestamp(right.at ?? order.date, Number.POSITIVE_INFINITY),
              )}
              audience={audience}
              emptyMessage="No records available."
            />

            <article className="order-detail-card-v2 order-support-card" aria-label="Shipment and return support">
              <div className="order-card-heading">
                <div>
                  <h2>Support</h2>
                  <p>{isAdmin ? 'Support context and diagnostics.' : 'Shipment and return context attached.'}</p>
                </div>
              </div>
              <div className="order-support-compact-stack">
                {isVendorAssignedOwner ? (
                  <>
                    <div className="order-support-action-row">
                      {linkedSupportTicketHref ? (
                        <Link className="button button-secondary button-compact order-support-contact-button" to={linkedSupportTicketHref}>
                          Contact support
                        </Link>
                      ) : (
                        <button
                          type="button"
                          className="button button-secondary button-compact order-support-contact-button"
                          onClick={() => setSupportOpen(true)}
                          disabled={!canReportIssue}
                        >
                          Contact support
                        </button>
                      )}
                      <button
                        type="button"
                        className="button button-secondary button-compact"
                        onClick={() => {
                          if (openLinkedSupportTicket) {
                            void escalateSupportTicketMutation(openLinkedSupportTicket.id);
                          }
                        }}
                        disabled={!openLinkedSupportTicket || linkedSupportTicketEscalated || isEscalatingSupportTicket}
                      >
                        {isEscalatingSupportTicket ? 'Escalating…' : linkedSupportTicketEscalated ? 'Escalated' : 'Escalate'}
                      </button>
                    </div>
                    {!canReportIssue ? (
                      <span className="muted">Support is available for active or fulfilled assigned orders.</span>
                    ) : openLinkedSupportTicket ? (
                      <span className="muted">A linked support ticket is already open. Escalate only when the existing case needs attention.</span>
                    ) : (
                      <span className="muted">Order, shipment, return, and sync context attached. Create a support ticket before escalating.</span>
                    )}
                  </>
                ) : null}

                {relatedSupportTickets.length ? (
                  <div className="order-support-ticket-list" aria-label="Support ticket summary">
                    <strong>Tickets · {relatedSupportTickets.length}</strong>
                    {relatedSupportTickets.slice(0, 3).map((ticket) => (
                      <Link className="order-support-ticket-row" key={ticket.id} to={`${supportBasePath}/${ticket.id}`}>
                        <span className="order-support-ticket-status">{formatSupportTicketStatus(ticket.status)}</span>
                        <strong>{ticket.subject}</strong>
                        <span className="order-support-ticket-meta">
                          <span>{formatSupportTicketPriority(ticket.priority)}</span>
                          <span>Updated {formatOptionalDate(ticket.updatedAt)}</span>
                        </span>
                      </Link>
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
                          <strong>{formatSupportTicketStatus(relatedSupportTickets[0].status)}</strong>
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
          </div>

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
                          {navlungoProviderStatusBadge ? (
                            <div className="summary-row">
                              <span>Provider lifecycle</span>
                              <strong>{navlungoProviderStatusBadge}</strong>
                            </div>
                          ) : null}
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
                              {visibleShipmentExecution.provider === 'navlungo' ? (
                                <>
                                  <div className="summary-row">
                                    <span>Provider lifecycle</span>
                                    <strong>
                                      {[
                                        shipmentProviderSummary?.navlungoProviderStatusCode ?? null,
                                        shipmentProviderSummary?.navlungoProviderStatusName ?? shipmentProviderSummary?.navlungoNormalizedStatus ?? null,
                                      ].filter(Boolean).join(' · ') || '—'}
                                    </strong>
                                  </div>
                                  <div className="summary-row">
                                    <span>Carrier tracking</span>
                                    {shipmentProviderSummary?.navlungoCarrierTrackingUrl || getShipmentTrackingUrl(order, visibleShipmentExecution) ? (
                                      <a
                                        className="inline-link"
                                        href={shipmentProviderSummary?.navlungoCarrierTrackingUrl || getShipmentTrackingUrl(order, visibleShipmentExecution) || undefined}
                                        target="_blank"
                                        rel="noreferrer"
                                      >
                                        {shipmentProviderSummary?.navlungoCarrierTrackingCode ||
                                          getShipmentTrackingNumber(order, visibleShipmentExecution) ||
                                          'Open carrier tracking'}
                                      </a>
                                    ) : (
                                      <strong className={shipmentProviderSummary?.navlungoCarrierTrackingCode ? '' : 'muted'}>
                                        {shipmentProviderSummary?.navlungoCarrierTrackingCode ?? 'Not available'}
                                      </strong>
                                    )}
                                  </div>
                                  <div className="summary-row">
                                    <span>Barcode status</span>
                                    <strong>{shipmentProviderSummary?.navlungoBarcodeStatus || '—'}</strong>
                                  </div>
                                  <div className="summary-row">
                                    <span>Lifecycle dates</span>
                                    <strong>
                                      {[
                                        shipmentProviderSummary?.navlungoPickedUpDate
                                          ? `Picked up ${formatOptionalDate(shipmentProviderSummary.navlungoPickedUpDate)}`
                                          : null,
                                        shipmentProviderSummary?.navlungoDeliveredDate
                                          ? `Delivered ${formatOptionalDate(shipmentProviderSummary.navlungoDeliveredDate)}`
                                          : null,
                                        shipmentProviderSummary?.navlungoCancelDate
                                          ? `Cancelled ${formatOptionalDate(shipmentProviderSummary.navlungoCancelDate)}`
                                          : null,
                                      ].filter(Boolean).join(' · ') || '—'}
                                    </strong>
                                  </div>
                                  <div className="summary-row">
                                    <span>Address intelligence</span>
                                    <strong>
                                      geo {shipmentProviderSummary?.navlungoGeoStatus || '—'} · bad address{' '}
                                      {formatDiagnosticPresence(shipmentProviderSummary?.navlungoGeoBadAddress)}
                                    </strong>
                                  </div>
                                  {shipmentProviderSummary?.navlungoGeoBadAddress ? (
                                    <div className="summary-row">
                                      <span>Address warning</span>
                                      <strong>Carrier reported address validation issue.</strong>
                                    </div>
                                  ) : null}
                                </>
                              ) : null}
                              {visibleShipmentExecution.provider === 'kargonomi' ? (
                                <>
                                  <div className="summary-row">
                                    <span>Provider API call attempted</span>
                                    <strong>{formatDiagnosticPresence(shipmentProviderSummary?.providerApiCallAttempted)}</strong>
                                  </div>
                                  <div className="summary-row">
                                    <span>Last provider stage</span>
                                    <strong>{formatKargonomiProviderStage(shipmentProviderSummary?.lastProviderStage)}</strong>
                                  </div>
                                  <div className="summary-row">
                                    <span>Provider message</span>
                                    <strong>{shipmentProviderSummary?.providerError || '—'}</strong>
                                  </div>
                                </>
                              ) : null}
                            </div>
                          </details>
                        ) : null}
                        {visibleShipmentExecution?.provider === 'try_oto' ? (
                          <div className="shipment-recovery-actions shipment-return-compact" aria-label="Try OTO return shipment">
                            <strong>Try OTO return shipment</strong>
	                            {visibleShipmentExecution.returnShipment ? (
	                              <>
	                                <div className="return-shipment-compact-grid">
	                                  <div className="summary-row">
	                                    <span>Return status</span>
	                                    <strong>{getTryOtoReturnStatusLabel(visibleShipmentExecution.returnShipment)}</strong>
	                                    {visibleShipmentExecution.returnShipment.returnOrderId ? (
	                                      <small>{visibleShipmentExecution.returnShipment.returnOrderId}</small>
	                                    ) : null}
	                                    {visibleShipmentExecution.returnShipment.carrierName ? (
	                                      <small>{visibleShipmentExecution.returnShipment.carrierName}</small>
	                                    ) : null}
	                                  </div>
	                                  <div className="summary-row">
	                                    <span>Return tracking</span>
	                                    <strong className={visibleShipmentExecution.returnShipment.trackingNumber ? '' : 'muted'}>
	                                      {visibleShipmentExecution.returnShipment.trackingNumber ?? 'Not available'}
	                                    </strong>
	                                    {visibleShipmentExecution.returnShipment.barcode &&
	                                    visibleShipmentExecution.returnShipment.barcode !== visibleShipmentExecution.returnShipment.trackingNumber ? (
	                                      <small>Barcode: {visibleShipmentExecution.returnShipment.barcode}</small>
	                                    ) : null}
	                                  </div>
	                                  <div className="summary-row">
	                                    <span>Tracking link</span>
	                                    {visibleShipmentExecution.returnShipment.trackingUrl ? (
	                                      <a
	                                        className="inline-link"
	                                        href={visibleShipmentExecution.returnShipment.trackingUrl}
	                                        target="_blank"
	                                        rel="noreferrer"
	                                      >
	                                        Open return tracking
	                                      </a>
	                                    ) : (
	                                      <strong className="muted">Not available</strong>
	                                    )}
	                                  </div>
	                                  <div className="summary-row">
	                                    <span>Return label status</span>
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
	                                      <>
	                                        <strong className="muted">Not available</strong>
	                                        <small>Printable return label unavailable</small>
	                                      </>
	                                    )}
	                                  </div>
	                                </div>
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
                                  onClick={() => handleCreateReturnShipmentLabel()}
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
                        {renderNavlungoUpdateForm()}
                        {canCreateNavlungoReturnPickup ? (
                          <div className="shipment-recovery-actions" aria-label="Navlungo return pickup creation">
                            <strong>Navlungo return pickup</strong>
                            <span>Preview the return pickup payload before creating a live Navlungo return shipment.</span>
                            <div className="order-inline-actions">
                              <button
                                type="button"
                                className="button button-secondary"
                                disabled={isCreatingReturnShipmentLabel}
                                onClick={() => handleCreateReturnShipmentLabel({ dryRun: true })}
                              >
                                {isCreatingReturnShipmentLabel ? 'Previewing...' : 'Preview Navlungo return pickup'}
                              </button>
                            </div>
                            {renderNavlungoReturnPickupPreviewSummary()}
                            <label className="checkbox-row">
                              <input
                                type="checkbox"
                                checked={navlungoReturnPickupLiveConfirmed}
                                onChange={(event) => setNavlungoReturnPickupLiveConfirmed(event.target.checked)}
                              />
                              <span>I understand this creates a live Navlungo return pickup.</span>
                            </label>
                            <button
                              type="button"
                              className="button button-primary"
                              disabled={isCreatingReturnShipmentLabel || !navlungoReturnPickupLiveConfirmed}
                              onClick={() => handleCreateReturnShipmentLabel()}
                            >
                              {isCreatingReturnShipmentLabel ? 'Creating...' : 'Create live Navlungo return pickup'}
                            </button>
                          </div>
                        ) : null}
                        {canCancelNavlungoShipment ? (
                          <div className="shipment-recovery-actions" aria-label="Navlungo shipment cancellation">
                            <strong>Navlungo cancellation</strong>
                            <span>Cancel the provider post before delivery. Shopify fulfillment deletion is not implemented in this phase.</span>
                            <div className="order-inline-actions">
                              <button
                                type="button"
                                className="button button-secondary"
                                disabled={isCancellingShipment}
                                onClick={handleCancelNavlungoShipment}
                              >
                                {isCancellingShipment ? 'Cancelling...' : 'Cancel Navlungo shipment'}
                              </button>
                            </div>
                          </div>
                        ) : null}
                        <ShopifyReturnSignalDiagnostics order={order} isAdmin={isAdmin} />
                        {canSyncNavlungoShipmentStatus ? (
                          <div className="shipment-recovery-actions" aria-label="Navlungo shipment status sync">
                            <strong>Navlungo status sync</strong>
                            <span>Pull detailed provider lifecycle status from Navlungo. Shopify delivery-state sync is not implemented in this phase.</span>
                            {shipmentProviderSummary?.navlungoGeoBadAddress ? (
                              <span className="warning-copy">Carrier reported address validation issue.</span>
                            ) : null}
                            <div className="order-inline-actions">
                              <button
                                type="button"
                                className="button button-secondary"
                                disabled={isRefreshingShipmentStatus}
                                onClick={handleRefreshShipmentStatus}
                              >
                                {isRefreshingShipmentStatus ? 'Syncing...' : 'Sync Navlungo status'}
                              </button>
                            </div>
                          </div>
                        ) : null}
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
                            {renderKargonomiExecutionDiagnostics(shipmentProviderSummary)}
                            {renderNavlungoRetryDiagnostics(shipmentProviderSummary)}
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
                                {canUseFullNavlungoSenderRetry ? (
                                  <label className="checkbox-field">
                                    <input
                                      type="checkbox"
                                      checked={useFullNavlungoSenderForRetry}
                                      onChange={(event) => setUseFullNavlungoSenderForRetry(event.target.checked)}
                                      disabled={isRetryingFailedShipment}
                                    />
                                    <span>Use full Navlungo sender details for this retry</span>
                                  </label>
                                ) : null}
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
                              <>
                                {canUseFullNavlungoSenderRetry ? (
                                  <label className="checkbox-field">
                                    <input
                                      type="checkbox"
                                      checked={useFullNavlungoSenderForRetry}
                                      onChange={(event) => setUseFullNavlungoSenderForRetry(event.target.checked)}
                                      disabled={isRetryingFailedShipment}
                                    />
                                    <span>Use full Navlungo sender details for this retry</span>
                                  </label>
                                ) : null}
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
                              </>
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
                            {shipmentActionState.shipment?.providerResponseSummary?.navlungoReturnPickupPayloadSummary
                              ? renderNavlungoReturnPickupPreviewSummary(shipmentActionState.shipment.providerResponseSummary)
                              : null}
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
                        ) : shippingProviderDiagnostics.provider === 'kargonomi' ? (
                          <>
                            <div className="summary-row">
                              <span>Kargonomi warehouse configured</span>
                              <strong>{shippingProviderDiagnostics.warehouseIdConfigured ? 'yes' : 'no'}</strong>
                            </div>
                            <div className="summary-row">
                              <span>Kargonomi fallback buyer state ID</span>
                              <strong>{kargonomiBuyerStateId || '—'}</strong>
                            </div>
                            <div className="summary-row">
                              <span>Kargonomi fallback buyer city ID</span>
                              <strong>{kargonomiBuyerCityId || '—'}</strong>
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
                {(isAdmin || canUseFulfillmentActions) && (visibleShipmentExecution || hasTrackingSync || hasShopifyFulfillmentSyncAttempt) ? (
                  <div className="tracking-summary-card order-tracking-summary-card">
                    {visibleShipmentExecution ? (
                      <>
                        <div className="summary-row">
                          <span>Shipment provider</span>
                          <strong>{formatShippingProviderName(visibleShipmentExecution.provider)}</strong>
                        </div>
                        <div className="summary-row">
                          <span>Carrier status</span>
                          <strong>{getOperationalShipmentStatusLabel(visibleShipmentExecution.shipmentStatus)}</strong>
                        </div>
                        {navlungoProviderStatusBadge ? (
                          <div className="summary-row">
                            <span>Provider lifecycle</span>
                            <strong>{navlungoProviderStatusBadge}</strong>
                          </div>
                        ) : null}
                        {visibleShipmentExecution.warehouseId ? (
                          <div className="summary-row">
                            <span>Warehouse</span>
                            <strong>{visibleShipmentExecution.warehouseId}</strong>
                          </div>
                        ) : null}
                      </>
                    ) : null}
                    <div className="summary-row">
                      <span>Tracking</span>
                      <strong className={order.trackingNumber || visibleShipmentExecution?.trackingNumber ? '' : 'muted'}>
                        {getShipmentTrackingNumber(order, visibleShipmentExecution) ?? 'Not available'}
                      </strong>
                    </div>
                    <div className="summary-row">
                      <span>Carrier</span>
                      <strong className={order.carrier ? '' : 'muted'}>{formatShippingProviderName(order.carrier) || 'Not available'}</strong>
                    </div>
                    <div className="summary-row">
                      <span>Tracking link</span>
                      {getShipmentTrackingUrl(order, visibleShipmentExecution) ? (
                        <a className="inline-link" href={getShipmentTrackingUrl(order, visibleShipmentExecution) || undefined} target="_blank" rel="noreferrer">
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
                          Open label PDF
                        </a>
                      </div>
                    ) : null}
	                    {visibleShipmentExecution?.provider === 'try_oto' && visibleShipmentExecution.returnShipment ? (
	                      <div className="shipment-recovery-actions shipment-return-compact" aria-label="Try OTO return shipment">
	                        <strong>Try OTO return shipment</strong>
	                        <div className="return-shipment-compact-grid">
	                          <div className="summary-row">
	                            <span>Return status</span>
	                            <strong>{getTryOtoReturnStatusLabel(visibleShipmentExecution.returnShipment)}</strong>
	                            {visibleShipmentExecution.returnShipment.returnOrderId ? (
	                              <small>{visibleShipmentExecution.returnShipment.returnOrderId}</small>
	                            ) : null}
	                            {visibleShipmentExecution.returnShipment.carrierName ? (
	                              <small>{visibleShipmentExecution.returnShipment.carrierName}</small>
	                            ) : null}
	                          </div>
	                          <div className="summary-row">
	                            <span>Return tracking</span>
	                            <strong className={visibleShipmentExecution.returnShipment.trackingNumber ? '' : 'muted'}>
	                              {visibleShipmentExecution.returnShipment.trackingNumber ?? 'Not available'}
	                            </strong>
	                            {visibleShipmentExecution.returnShipment.barcode &&
	                            visibleShipmentExecution.returnShipment.barcode !== visibleShipmentExecution.returnShipment.trackingNumber ? (
	                              <small>Barcode: {visibleShipmentExecution.returnShipment.barcode}</small>
	                            ) : null}
	                          </div>
	                          <div className="summary-row">
	                            <span>Tracking link</span>
	                            {visibleShipmentExecution.returnShipment.trackingUrl ? (
	                              <a className="inline-link" href={visibleShipmentExecution.returnShipment.trackingUrl} target="_blank" rel="noreferrer">
	                                Open return tracking
	                              </a>
	                            ) : (
	                              <strong className="muted">Not available</strong>
	                            )}
	                          </div>
	                          <div className="summary-row">
	                            <span>Return label status</span>
	                            {visibleShipmentExecution.returnShipment.labelUrl ? (
	                              <a className="inline-link" href={visibleShipmentExecution.returnShipment.labelUrl} target="_blank" rel="noreferrer">
	                                Open return label PDF
	                              </a>
	                            ) : (
	                              <>
	                                <strong className="muted">Not available</strong>
	                                <small>Printable return label unavailable</small>
	                              </>
	                            )}
	                          </div>
	                        </div>
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
                    {renderNavlungoUpdateForm()}
                    {canCreateNavlungoReturnPickup ? (
                      <div className="shipment-recovery-actions" aria-label="Navlungo return pickup creation">
                        <strong>Navlungo return pickup</strong>
                        <span>Preview the return pickup payload before creating a live Navlungo return shipment.</span>
                        <div className="order-inline-actions">
                          <button
                            type="button"
                            className="button button-secondary"
                            disabled={isCreatingReturnShipmentLabel}
                            onClick={() => handleCreateReturnShipmentLabel({ dryRun: true })}
                          >
                            {isCreatingReturnShipmentLabel ? 'Previewing...' : 'Preview Navlungo return pickup'}
                          </button>
                        </div>
                        {renderNavlungoReturnPickupPreviewSummary()}
                        <label className="checkbox-row">
                          <input
                            type="checkbox"
                            checked={navlungoReturnPickupLiveConfirmed}
                            onChange={(event) => setNavlungoReturnPickupLiveConfirmed(event.target.checked)}
                          />
                          <span>I understand this creates a live Navlungo return pickup.</span>
                        </label>
                        <button
                          type="button"
                          className="button button-primary"
                          disabled={isCreatingReturnShipmentLabel || !navlungoReturnPickupLiveConfirmed}
                          onClick={() => handleCreateReturnShipmentLabel()}
                        >
                          {isCreatingReturnShipmentLabel ? 'Creating...' : 'Create live Navlungo return pickup'}
                        </button>
                      </div>
                    ) : null}
                    {canCancelNavlungoShipment ? (
                      <div className="shipment-recovery-actions" aria-label="Navlungo shipment cancellation">
                        <strong>Navlungo cancellation</strong>
                        <span>Cancel the provider post before delivery. Shopify fulfillment deletion is not implemented in this phase.</span>
                        <div className="order-inline-actions">
                          <button
                            type="button"
                            className="button button-secondary"
                            disabled={isCancellingShipment}
                            onClick={handleCancelNavlungoShipment}
                          >
                            {isCancellingShipment ? 'Cancelling...' : 'Cancel Navlungo shipment'}
                          </button>
                        </div>
                      </div>
                    ) : null}
                    <ShopifyReturnSignalDiagnostics order={order} isAdmin={isAdmin} />
                    {canSyncNavlungoShipmentStatus ? (
                      <div className="shipment-recovery-actions" aria-label="Navlungo shipment status sync">
                        <strong>Navlungo status sync</strong>
                        <span>Pull detailed provider lifecycle status from Navlungo. Shopify delivery-state sync is not implemented in this phase.</span>
                        {shipmentProviderSummary?.navlungoGeoBadAddress ? (
                          <span className="warning-copy">Carrier reported address validation issue.</span>
                        ) : null}
                        <div className="order-inline-actions">
                          <button
                            type="button"
                            className="button button-secondary"
                            disabled={isRefreshingShipmentStatus}
                            onClick={handleRefreshShipmentStatus}
                          >
                            {isRefreshingShipmentStatus ? 'Syncing...' : 'Sync Navlungo status'}
                          </button>
                        </div>
                      </div>
                    ) : null}
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
                        {renderKargonomiExecutionDiagnostics(shipmentProviderSummary)}
                        {renderNavlungoRetryDiagnostics(shipmentProviderSummary)}
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
                            {canUseFullNavlungoSenderRetry ? (
                              <label className="checkbox-field">
                                <input
                                  type="checkbox"
                                  checked={useFullNavlungoSenderForRetry}
                                  onChange={(event) => setUseFullNavlungoSenderForRetry(event.target.checked)}
                                  disabled={isRetryingFailedShipment}
                                />
                                <span>Use full Navlungo sender details for this retry</span>
                              </label>
                            ) : null}
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
                          <>
                            {canUseFullNavlungoSenderRetry ? (
                              <label className="checkbox-field">
                                <input
                                  type="checkbox"
                                  checked={useFullNavlungoSenderForRetry}
                                  onChange={(event) => setUseFullNavlungoSenderForRetry(event.target.checked)}
                                  disabled={isRetryingFailedShipment}
                                />
                                <span>Use full Navlungo sender details for this retry</span>
                              </label>
                            ) : null}
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
                          </>
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
                            {shipmentActionState.shipment?.providerResponseSummary?.navlungoReturnPickupPayloadSummary
                              ? renderNavlungoReturnPickupPreviewSummary(shipmentActionState.shipment.providerResponseSummary)
                              : null}
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
                    ) : isKargonomiConfigDraft ? (
                      <>
                        <div className="summary-row">
                          <span>Kargonomi warehouse configured</span>
                          <strong>{(kargonomiOptionDiagnostics ?? shippingProviderDiagnostics).warehouseIdConfigured ? 'yes' : 'no'}</strong>
                        </div>
                        <div className="summary-row">
                          <span>Kargonomi fallback buyer state ID</span>
                          <strong>{kargonomiBuyerStateId || '—'}</strong>
                        </div>
                        <div className="summary-row">
                          <span>Kargonomi fallback buyer city ID</span>
                          <strong>{kargonomiBuyerCityId || '—'}</strong>
                        </div>
                        <div className="shipment-recovery-actions">
                          <button
                            type="button"
                            className="button button-secondary"
                            onClick={() => void runKargonomiLookupDiagnosticsMutation(undefined)}
                            disabled={isRunningKargonomiLookupDiagnostics}
                          >
                            {isRunningKargonomiLookupDiagnostics ? 'Running lookup...' : 'Run Kargonomi lookup diagnostic'}
                          </button>
                          <span className="muted">Temporary admin-only check. Calls only states and city lookup endpoints.</span>
                        </div>
                        {kargonomiLookupError ? (
                          <p className="form-error" role="alert">{kargonomiLookupError}</p>
                        ) : null}
                        {kargonomiLookupDiagnostics ? (
                          <div className="provider-response-summary admin-diagnostics-panel" aria-label="Kargonomi lookup diagnostic result">
                            <div className="summary-row">
                              <span>Base URL</span>
                              <strong>
                                {kargonomiLookupDiagnostics.baseUrlHost ?? '—'}
                                {kargonomiLookupDiagnostics.baseUrlPath ? kargonomiLookupDiagnostics.baseUrlPath : ''}
                              </strong>
                            </div>
                            {kargonomiLookupDiagnostics.baseUrlParseError ? (
                              <div className="summary-row">
                                <span>Base URL parse error</span>
                                <strong>{kargonomiLookupDiagnostics.baseUrlParseError}</strong>
                              </div>
                            ) : null}
                            <div className="summary-row">
                              <span>Token present</span>
                              <strong>{kargonomiLookupDiagnostics.tokenPresent ? 'yes' : 'no'}</strong>
                            </div>
                            <div className="summary-row">
                              <span>States request</span>
                              <strong>{kargonomiLookupDiagnostics.statesRequestUrl}</strong>
                            </div>
                            <div className="summary-row">
                              <span>States result</span>
                              <strong>
                                {kargonomiLookupDiagnostics.statesFetchError
                                  ? `${kargonomiLookupDiagnostics.statesFetchError.name}: ${kargonomiLookupDiagnostics.statesFetchError.message}`
                                  : kargonomiLookupDiagnostics.statesHttpStatus ?? '—'}
                              </strong>
                            </div>
                            <div className="summary-row">
                              <span>States content type</span>
                              <strong>{kargonomiLookupDiagnostics.statesContentType ?? '—'}</strong>
                            </div>
                            <div className="summary-row">
                              <span>States response shape</span>
                              <strong>
                                {kargonomiLookupDiagnostics.statesShapeSummary
                                  ? `${kargonomiLookupDiagnostics.statesShapeSummary.kind}${
                                      kargonomiLookupDiagnostics.statesShapeSummary.topLevelKeys.length
                                        ? ` · ${kargonomiLookupDiagnostics.statesShapeSummary.topLevelKeys.join(', ')}`
                                        : ''
                                    }`
                                  : '—'}
                              </strong>
                            </div>
                            <div className="summary-row">
                              <span>First states</span>
                              <strong>{kargonomiLookupDiagnostics.firstStateNames.length ? kargonomiLookupDiagnostics.firstStateNames.join(', ') : '—'}</strong>
                            </div>
                            <div className="summary-row">
                              <span>İstanbul state ID</span>
                              <strong>{kargonomiLookupDiagnostics.istanbulStateId ?? '—'}</strong>
                            </div>
                            <div className="summary-row">
                              <span>Cities result</span>
                              <strong>
                                {kargonomiLookupDiagnostics.citiesFetchError
                                  ? `${kargonomiLookupDiagnostics.citiesFetchError.name}: ${kargonomiLookupDiagnostics.citiesFetchError.message}`
                                  : kargonomiLookupDiagnostics.citiesHttpStatus ?? '—'}
                              </strong>
                            </div>
                            <div className="summary-row">
                              <span>First İstanbul districts</span>
                              <strong>{kargonomiLookupDiagnostics.firstCityNames.length ? kargonomiLookupDiagnostics.firstCityNames.join(', ') : '—'}</strong>
                            </div>
                          </div>
                        ) : null}
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
                    {isNavlungoConfigDraft ? (
                      <>
                        <div className="shipment-recovery-actions">
                          <button
                            type="button"
                            className="button button-secondary"
                            onClick={() => void runNavlungoAuthDiagnosticsMutation(undefined)}
                            disabled={isRunningNavlungoAuthDiagnostics}
                          >
                            {isRunningNavlungoAuthDiagnostics ? 'Running auth...' : 'Run Navlungo auth diagnostic'}
                          </button>
                          <span className="muted">Dormant admin-only check. Calls only Navlungo auth and never creates shipments.</span>
                        </div>
                        <div className="shipment-recovery-actions">
                          <button
                            type="button"
                            className="button button-secondary"
                            onClick={() => void runNavlungoCarrierDiagnosticsMutation(undefined)}
                            disabled={isRunningNavlungoCarrierDiagnostics}
                          >
                            {isRunningNavlungoCarrierDiagnostics ? 'Running carrier diagnostic...' : 'Run Navlungo carrier diagnostic'}
                          </button>
                          <span className="muted">Authenticates, then checks configured and listed carriers. No posts are created.</span>
                        </div>
                        <div className="shipment-recovery-actions" aria-label="Navlungo Create Post probe controls">
                          <span className="muted">Creates one Navlungo test post. Does not sync Shopify or create a local shipment execution.</span>
                          <label className="field checkbox-field">
                            <span>I understand this creates one Navlungo test post</span>
                            <input
                              type="checkbox"
                              checked={navlungoCreatePostProbeConfirmed}
                              onChange={(event) => setNavlungoCreatePostProbeConfirmed(event.target.checked)}
                            />
                          </label>
                          <button
                            type="button"
                            className="button button-secondary"
                            onClick={() => void runNavlungoCreatePostProbeMutation(undefined)}
                            disabled={!navlungoCreatePostProbeConfirmed || isRunningNavlungoCreatePostProbe}
                          >
                            {isRunningNavlungoCreatePostProbe ? 'Running Create Post probe...' : 'Run Navlungo Create Post probe'}
                          </button>
                        </div>
                        {navlungoAuthError ? (
                          <p className="form-error" role="alert">{navlungoAuthError}</p>
                        ) : null}
                        {navlungoCarrierError ? (
                          <p className="form-error" role="alert">{navlungoCarrierError}</p>
                        ) : null}
                        {navlungoAuthDiagnostics ? (
                          <div className="provider-response-summary admin-diagnostics-panel" aria-label="Navlungo auth diagnostic result">
                        <div className="summary-row">
                          <span>Base URL</span>
                          <strong>
                            {navlungoAuthDiagnostics.baseUrlHost ?? '—'}
                            {navlungoAuthDiagnostics.baseUrlPath ? navlungoAuthDiagnostics.baseUrlPath : ''}
                          </strong>
                        </div>
                        {navlungoAuthDiagnostics.baseUrlParseError ? (
                          <div className="summary-row">
                            <span>Base URL parse error</span>
                            <strong>{navlungoAuthDiagnostics.baseUrlParseError}</strong>
                          </div>
                        ) : null}
                        <div className="summary-row">
                          <span>Username configured</span>
                          <strong>{navlungoAuthDiagnostics.usernamePresent ? 'yes' : 'no'}</strong>
                        </div>
                        <div className="summary-row">
                          <span>Password configured</span>
                          <strong>{navlungoAuthDiagnostics.passwordPresent ? 'yes' : 'no'}</strong>
                        </div>
                        <div className="summary-row">
                          <span>Auth result</span>
                          <strong>
                            {navlungoAuthDiagnostics.fetchError
                              ? `${navlungoAuthDiagnostics.fetchError.name}: ${navlungoAuthDiagnostics.fetchError.message}`
                              : navlungoAuthDiagnostics.authHttpStatus ?? '—'}
                          </strong>
                        </div>
                        <div className="summary-row">
                          <span>Auth validation fields</span>
                          <strong>{navlungoAuthDiagnostics.authFailedFieldNames.length ? navlungoAuthDiagnostics.authFailedFieldNames.join(', ') : '—'}</strong>
                        </div>
                        <div className="summary-row">
                          <span>Auth validation messages</span>
                          <strong>
                            {navlungoAuthDiagnostics.authValidationErrorMessages.length
                              ? navlungoAuthDiagnostics.authValidationErrorMessages.join(' · ')
                              : '—'}
                          </strong>
                        </div>
                        <div className="summary-row">
                          <span>Response shape</span>
                          <strong>
                            {navlungoAuthDiagnostics.responseShapeSummary
                              ? `${navlungoAuthDiagnostics.responseShapeSummary.kind}${
                                  navlungoAuthDiagnostics.responseShapeSummary.topLevelKeys.length
                                    ? ` · ${navlungoAuthDiagnostics.responseShapeSummary.topLevelKeys.join(', ')}`
                                    : ''
                                }`
                              : '—'}
                          </strong>
                        </div>
                        <div className="summary-row">
                          <span>Data shape</span>
                          <strong>
                            {navlungoAuthDiagnostics.responseDataShapeSummary
                              ? `${navlungoAuthDiagnostics.responseDataShapeSummary.kind}${
                                  navlungoAuthDiagnostics.responseDataShapeSummary.topLevelKeys.length
                                    ? ` · ${navlungoAuthDiagnostics.responseDataShapeSummary.topLevelKeys.join(', ')}`
                                    : ''
                                }`
                              : '—'}
                          </strong>
                        </div>
                        <div className="summary-row">
                          <span>Access token field</span>
                          <strong>
                            {navlungoAuthDiagnostics.tokenKeyPresence.rootAccessToken
                              ? 'root.access_token'
                              : navlungoAuthDiagnostics.tokenKeyPresence.dataAccessToken
                                ? 'data.access_token'
                                : navlungoAuthDiagnostics.tokenKeyPresence.dataToken
                                  ? 'data.token'
                                  : navlungoAuthDiagnostics.tokenKeyPresence.anyTokenLikeKey
                                    ? 'other token-like key'
                                    : 'not present'}
                          </strong>
                        </div>
                        <div className="summary-row">
                          <span>Refresh token field</span>
                          <strong>
                            {navlungoAuthDiagnostics.refreshTokenKeyPresence.rootRefreshToken
                              ? 'root.refresh_token'
                              : navlungoAuthDiagnostics.refreshTokenKeyPresence.dataRefreshToken
                                ? 'data.refresh_token'
                                : 'not present'}
                          </strong>
                        </div>
                        <div className="summary-row">
                          <span>token_type present</span>
                          <strong>{navlungoAuthDiagnostics.tokenTypePresent ? 'yes' : 'no'}</strong>
                        </div>
                        <div className="summary-row">
                          <span>expires_in present</span>
                          <strong>{navlungoAuthDiagnostics.expiresInPresent ? 'yes' : 'no'}</strong>
                        </div>
                        <div className="summary-row">
                          <span>Token received</span>
                          <strong>{navlungoAuthDiagnostics.tokenReceived ? 'yes' : 'no'}</strong>
                        </div>
                        <div className="summary-row">
                          <span>Expires in</span>
                          <strong>{navlungoAuthDiagnostics.expiresIn ?? '—'}</strong>
                        </div>
                          </div>
                        ) : null}
                        {navlungoCarrierDiagnostics ? (
                          <div className="provider-response-summary admin-diagnostics-panel" aria-label="Navlungo carrier diagnostic result">
                            <div className="summary-row">
                              <span>Auth HTTP</span>
                              <strong>{navlungoCarrierDiagnostics.authHttpStatus ?? '—'}</strong>
                            </div>
                            <div className="summary-row">
                              <span>Token received</span>
                              <strong>{navlungoCarrierDiagnostics.authTokenReceived ? 'yes' : 'no'}</strong>
                            </div>
                            <div className="summary-row">
                              <span>Carrier endpoint paths known</span>
                              <strong>{navlungoCarrierDiagnostics.carrierEndpointPathsKnown ? 'yes' : 'no'}</strong>
                            </div>
                            <div className="summary-row">
                              <span>Skipped reason</span>
                              <strong>{navlungoCarrierDiagnostics.skippedReason ?? '—'}</strong>
                            </div>
                            <div className="summary-row">
                              <span>My Carriers HTTP</span>
                              <strong>{navlungoCarrierDiagnostics.myCarriersHttpStatus ?? '—'}</strong>
                            </div>
                            <div className="summary-row">
                              <span>My Carriers shape</span>
                              <strong>
                                {navlungoCarrierDiagnostics.myCarriersResponseShape
                                  ? `${navlungoCarrierDiagnostics.myCarriersResponseShape.kind}${
                                      navlungoCarrierDiagnostics.myCarriersResponseShape.topLevelKeys.length
                                        ? ` · ${navlungoCarrierDiagnostics.myCarriersResponseShape.topLevelKeys.join(', ')}`
                                        : ''
                                    }`
                                  : '—'}
                              </strong>
                            </div>
                            <div className="summary-row">
                              <span>Configured carriers</span>
                              <strong>{navlungoCarrierDiagnostics.myCarrierCount ?? '—'}</strong>
                            </div>
                            <div className="summary-row">
                              <span>First configured carriers</span>
                              <strong>
                                {navlungoCarrierDiagnostics.myCarrierSamples.length
                                  ? navlungoCarrierDiagnostics.myCarrierSamples
                                      .map((carrier) => [carrier.id ?? 'unknown', carrier.name ?? carrier.shortName ?? 'unnamed'].join(' · '))
                                      .join(', ')
                                  : '—'}
                              </strong>
                            </div>
                            <div className="summary-row">
                              <span>List Carriers HTTP</span>
                              <strong>{navlungoCarrierDiagnostics.listCarriersHttpStatus ?? '—'}</strong>
                            </div>
                            <div className="summary-row">
                              <span>List Carriers shape</span>
                              <strong>
                                {navlungoCarrierDiagnostics.listCarriersResponseShape
                                  ? `${navlungoCarrierDiagnostics.listCarriersResponseShape.kind}${
                                      navlungoCarrierDiagnostics.listCarriersResponseShape.topLevelKeys.length
                                        ? ` · ${navlungoCarrierDiagnostics.listCarriersResponseShape.topLevelKeys.join(', ')}`
                                        : ''
                                    }`
                                  : '—'}
                              </strong>
                            </div>
                            <div className="summary-row">
                              <span>Listed carriers</span>
                              <strong>{navlungoCarrierDiagnostics.listCarrierCount ?? '—'}</strong>
                            </div>
                            <div className="summary-row">
                              <span>First listed carriers</span>
                              <strong>
                                {navlungoCarrierDiagnostics.listCarrierSamples.length
                                  ? navlungoCarrierDiagnostics.listCarrierSamples
                                      .map((carrier) => [carrier.id ?? 'unknown', carrier.name ?? carrier.shortName ?? 'unnamed'].join(' · '))
                                      .join(', ')
                                  : '—'}
                              </strong>
                            </div>
                            <div className="summary-row">
                              <span>Configured carrier available</span>
                              <strong>{navlungoCarrierDiagnostics.anyConfiguredCarrier ? 'yes' : 'no'}</strong>
                            </div>
                            <div className="summary-row">
                              <span>Provider messages</span>
                              <strong>{navlungoCarrierDiagnostics.providerMessages.length ? navlungoCarrierDiagnostics.providerMessages.join(' · ') : '—'}</strong>
                            </div>
                            {navlungoCarrierDiagnostics.fetchError ? (
                              <div className="summary-row">
                                <span>Fetch error</span>
                                <strong>{`${navlungoCarrierDiagnostics.fetchError.name}: ${navlungoCarrierDiagnostics.fetchError.message}`}</strong>
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                        {navlungoCreatePostProbeError ? (
                          <p className="form-error" role="alert">{navlungoCreatePostProbeError}</p>
                        ) : null}
                        {navlungoCreatePostProbeDiagnostics ? (
                          <div className="provider-response-summary admin-diagnostics-panel" aria-label="Navlungo Create Post probe result">
                            <div className="summary-row">
                              <span>Auth HTTP</span>
                              <strong>{navlungoCreatePostProbeDiagnostics.authHttpStatus ?? '—'}</strong>
                            </div>
                            <div className="summary-row">
                              <span>Create Post HTTP</span>
                              <strong>{navlungoCreatePostProbeDiagnostics.createPostHttpStatus ?? '—'}</strong>
                            </div>
                            <div className="summary-row">
                              <span>Requested carrier id</span>
                              <strong>{navlungoCreatePostProbeDiagnostics.requestedCarrierId}</strong>
                            </div>
                            <div className="summary-row">
                              <span>Requested post type</span>
                              <strong>{navlungoCreatePostProbeDiagnostics.requestedPostType}</strong>
                            </div>
                            <div className="summary-row">
                              <span>Requested barcode format</span>
                              <strong>{navlungoCreatePostProbeDiagnostics.requestedBarcodeFormat}</strong>
                            </div>
                            <div className="summary-row">
                              <span>COD payment included</span>
                              <strong>{navlungoCreatePostProbeDiagnostics.codPaymentIncluded ? 'yes' : 'no'}</strong>
                            </div>
                            <div className="summary-row">
                              <span>Price included</span>
                              <strong>{navlungoCreatePostProbeDiagnostics.priceIncluded ? 'yes' : 'no'}</strong>
                            </div>
                            <details className="provider-response-summary diagnostics-nested-panel" aria-label="Navlungo Create Post probe request summary">
                              <summary className="provider-response-heading">
                                <strong>Probe request shape</strong>
                                <span>Field names, types, and booleans only</span>
                              </summary>
                              <div className="summary-row">
                                <span>Base URL</span>
                                <strong>{navlungoCreatePostProbeDiagnostics.requestSummary.baseUrl ?? '—'}</strong>
                              </div>
                              <div className="summary-row">
                                <span>Endpoint</span>
                                <strong>
                                  {`${navlungoCreatePostProbeDiagnostics.requestSummary.method} ${navlungoCreatePostProbeDiagnostics.requestSummary.endpointPath}`}
                                </strong>
                              </div>
                              <div className="summary-row">
                                <span>Header keys</span>
                                <strong>{formatNavlungoRequestSummaryValue(navlungoCreatePostProbeDiagnostics.requestSummary.headerKeys)}</strong>
                              </div>
                              <div className="summary-row">
                                <span>Body keys</span>
                                <strong>{formatNavlungoRequestSummaryValue(navlungoCreatePostProbeDiagnostics.requestSummary.topLevelBodyKeys)}</strong>
                              </div>
                              <div className="summary-row">
                                <span>sender keys</span>
                                <strong>{formatNavlungoRequestSummaryValue(navlungoCreatePostProbeDiagnostics.requestSummary.senderKeys)}</strong>
                              </div>
                              <div className="summary-row">
                                <span>recipient keys</span>
                                <strong>{formatNavlungoRequestSummaryValue(navlungoCreatePostProbeDiagnostics.requestSummary.recipientKeys)}</strong>
                              </div>
                              <div className="summary-row">
                                <span>post keys</span>
                                <strong>{formatNavlungoRequestSummaryValue(navlungoCreatePostProbeDiagnostics.requestSummary.postPayloadKeys)}</strong>
                              </div>
                            </details>
                            <div className="summary-row">
                              <span>Response shape</span>
                              <strong>
                                {navlungoCreatePostProbeDiagnostics.responseShape
                                  ? `${navlungoCreatePostProbeDiagnostics.responseShape.kind}${
                                      navlungoCreatePostProbeDiagnostics.responseShape.topLevelKeys.length
                                        ? ` · ${navlungoCreatePostProbeDiagnostics.responseShape.topLevelKeys.join(', ')}`
                                        : ''
                                    }`
                                  : '—'}
                              </strong>
                            </div>
                            <div className="summary-row">
                              <span>Data keys</span>
                              <strong>{navlungoCreatePostProbeDiagnostics.dataKeys.length ? navlungoCreatePostProbeDiagnostics.dataKeys.join(', ') : '—'}</strong>
                            </div>
                            <div className="summary-row">
                              <span>Post number</span>
                              <strong>{navlungoCreatePostProbeDiagnostics.postNumber ?? (navlungoCreatePostProbeDiagnostics.postNumberPresent ? 'present' : 'missing')}</strong>
                            </div>
                            <div className="summary-row">
                              <span>Reference id</span>
                              <strong>{navlungoCreatePostProbeDiagnostics.referenceId ?? (navlungoCreatePostProbeDiagnostics.referenceIdPresent ? 'present' : 'missing')}</strong>
                            </div>
                            <div className="summary-row">
                              <span>Tracking URL</span>
                              <strong>{navlungoCreatePostProbeDiagnostics.trackingUrlPresent ? 'present' : 'missing'}</strong>
                            </div>
                            <div className="summary-row">
                              <span>Barcode URL</span>
                              <strong>{navlungoCreatePostProbeDiagnostics.barcodeUrlPresent ? 'present' : 'missing'}</strong>
                            </div>
                            <div className="summary-row">
                              <span>Barcode field</span>
                              <strong>
                                {navlungoCreatePostProbeDiagnostics.barcodePresent
                                  ? `present${navlungoCreatePostProbeDiagnostics.barcodeType ? ` · ${navlungoCreatePostProbeDiagnostics.barcodeType}` : ''}`
                                  : 'missing'}
                              </strong>
                            </div>
                            <div className="summary-row">
                              <span>Carrier fields</span>
                              <strong>
                                {navlungoCreatePostProbeDiagnostics.carrierIdPresent || navlungoCreatePostProbeDiagnostics.carrierNamePresent
                                  ? `present${navlungoCreatePostProbeDiagnostics.postCarrierKeys.length ? ` · ${navlungoCreatePostProbeDiagnostics.postCarrierKeys.join(', ')}` : ''}`
                                  : 'missing'}
                              </strong>
                            </div>
                            <div className="summary-row">
                              <span>Provider message</span>
                              <strong>{navlungoCreatePostProbeDiagnostics.providerMessage ?? navlungoCreatePostProbeDiagnostics.errorMessage ?? '—'}</strong>
                            </div>
                            {navlungoCreatePostProbeDiagnostics.postNumber ? (
                              <div className="shipment-recovery-actions">
                                <span className="muted">Last probe post_number: {navlungoCreatePostProbeDiagnostics.postNumber}</span>
                                <button
                                  type="button"
                                  className="button button-secondary"
                                  onClick={() => void runNavlungoCheckPostProbeMutation(navlungoCreatePostProbeDiagnostics.postNumber!)}
                                  disabled={isRunningNavlungoCheckPostProbe}
                                >
                                  {isRunningNavlungoCheckPostProbe ? 'Running Check Post...' : 'Run Navlungo Check Post probe'}
                                </button>
                                <button
                                  type="button"
                                  className="button button-secondary"
                                  onClick={() => void runNavlungoBarcodeProbeMutation(navlungoCreatePostProbeDiagnostics.postNumber!)}
                                  disabled={isRunningNavlungoBarcodeProbe}
                                >
                                  {isRunningNavlungoBarcodeProbe ? 'Running Barcode probe...' : 'Run Navlungo Barcode probe'}
                                </button>
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                        {navlungoCheckPostProbeError ? (
                          <p className="form-error" role="alert">{navlungoCheckPostProbeError}</p>
                        ) : null}
                        {navlungoCheckPostProbeDiagnostics ? (
                          <div className="provider-response-summary admin-diagnostics-panel" aria-label="Navlungo Check Post probe result">
                            <div className="summary-row">
                              <span>Post number</span>
                              <strong>{navlungoCheckPostProbeDiagnostics.postNumber}</strong>
                            </div>
                            <div className="summary-row">
                              <span>Check Post HTTP</span>
                              <strong>{navlungoCheckPostProbeDiagnostics.checkPostHttpStatus ?? '—'}</strong>
                            </div>
                            <div className="summary-row">
                              <span>Data keys</span>
                              <strong>{navlungoCheckPostProbeDiagnostics.dataKeys.length ? navlungoCheckPostProbeDiagnostics.dataKeys.join(', ') : '—'}</strong>
                            </div>
                            <div className="summary-row">
                              <span>Status</span>
                              <strong>{navlungoCheckPostProbeDiagnostics.statusName ?? navlungoCheckPostProbeDiagnostics.statusCode ?? '—'}</strong>
                            </div>
                            <div className="summary-row">
                              <span>Tracking fields</span>
                              <strong>
                                {[
                                  navlungoCheckPostProbeDiagnostics.trackingUrlPresent ? 'tracking_url' : null,
                                  navlungoCheckPostProbeDiagnostics.carrierTrackingUrlPresent ? 'carrier_tracking_url' : null,
                                ].filter(Boolean).join(', ') || '—'}
                              </strong>
                            </div>
                            <div className="summary-row">
                              <span>Barcode field</span>
                              <strong>
                                {navlungoCheckPostProbeDiagnostics.barcodePresent
                                  ? `present${navlungoCheckPostProbeDiagnostics.barcodeType ? ` · ${navlungoCheckPostProbeDiagnostics.barcodeType}` : ''}`
                                  : 'missing'}
                              </strong>
                            </div>
                            <div className="summary-row">
                              <span>Carrier fields</span>
                              <strong>
                                {navlungoCheckPostProbeDiagnostics.carrierIdPresent || navlungoCheckPostProbeDiagnostics.carrierNamePresent ? 'present' : 'missing'}
                              </strong>
                            </div>
                            <div className="summary-row">
                              <span>Provider message</span>
                              <strong>{navlungoCheckPostProbeDiagnostics.providerMessage ?? navlungoCheckPostProbeDiagnostics.errorMessage ?? '—'}</strong>
                            </div>
                          </div>
                        ) : null}
                        {navlungoBarcodeProbeError ? (
                          <p className="form-error" role="alert">{navlungoBarcodeProbeError}</p>
                        ) : null}
                        {navlungoBarcodeProbeDiagnostics ? (
                          <div className="provider-response-summary admin-diagnostics-panel" aria-label="Navlungo Barcode probe result">
                            <div className="summary-row">
                              <span>Post number</span>
                              <strong>{navlungoBarcodeProbeDiagnostics.postNumber}</strong>
                            </div>
                            <div className="summary-row">
                              <span>Barcode endpoint path known</span>
                              <strong>{navlungoBarcodeProbeDiagnostics.barcodeEndpointPathKnown ? 'yes' : 'no'}</strong>
                            </div>
                            <div className="summary-row">
                              <span>Skipped reason</span>
                              <strong>{navlungoBarcodeProbeDiagnostics.skippedReason}</strong>
                            </div>
                            <div className="summary-row">
                              <span>Barcode HTTP</span>
                              <strong>{navlungoBarcodeProbeDiagnostics.barcodeHttpStatus ?? '—'}</strong>
                            </div>
                            <div className="summary-row">
                              <span>Barcode field/url/base64</span>
                              <strong>
                                {[
                                  navlungoBarcodeProbeDiagnostics.barcodeFieldPresent ? 'field' : null,
                                  navlungoBarcodeProbeDiagnostics.barcodeUrlPresent ? 'url' : null,
                                  navlungoBarcodeProbeDiagnostics.barcodeBase64Present ? 'base64' : null,
                                ].filter(Boolean).join(', ') || '—'}
                              </strong>
                            </div>
                            <div className="summary-row">
                              <span>Provider message</span>
                              <strong>{navlungoBarcodeProbeDiagnostics.providerMessage ?? navlungoBarcodeProbeDiagnostics.errorMessage ?? '—'}</strong>
                            </div>
                          </div>
                        ) : null}
                      </>
                    ) : null}
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
