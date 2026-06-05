import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ActionFeedback } from '../components/ActionFeedback';
import {
  MetadataGroup,
  MetadataRow,
  OperationalActionGroup,
  OperationalSection,
  SectionErrorRetry,
  SectionSkeleton,
  StatusBadge,
} from '../components/OperationalPrimitives';
import { useMutationAction } from '../hooks/useMutationAction';
import { useQueryResource } from '../hooks/useQueryResource';
import { getFinanceDashboard } from '../features/finance/api';
import { getVendorShippingConfig } from '../features/orders/api';
import { createSupportTicket, listAdminSupportTickets, listVendorSupportTickets } from '../features/support/api';
import { getVendorBillingProfile } from '../features/vendors/api';
import { queryClient } from '../lib/api/queryClient';
import { queryKeys } from '../lib/api/queryKeys';
import type { SupportTicket, VendorShippingConfig } from '../lib/api/contracts';
import { useAppReadiness } from '../lib/appReadiness';
import { formatShippingProviderName } from '../lib/shippingDisplay';
import { useActionFeedback } from '../lib/ui';
import { safeArray, safeStatusLabel } from '../services/real/formatting';

const VENDOR_PROFILE_CONTEXT_ROUTE = 'vendor_profile_settings';
const VENDOR_PROFILE_PATH = '/vendor/profile';
const OPEN_SUPPORT_STATUSES = new Set(['OPEN', 'IN_REVIEW', 'WAITING_FOR_VENDOR']);
type ReadinessStatus = 'ready' | 'review' | 'unknown' | 'not_modeled';
type ReadinessItem = {
  label: string;
  status: ReadinessStatus;
  detail: string;
};
type ReadinessSection = {
  title: string;
  status: ReadinessStatus;
  summary: string;
  actionLabel: string;
  actionPath: string;
  items: ReadinessItem[];
};

function formatValue(value: string | null | undefined, fallback = 'Not configured') {
  return value && value.trim() ? value.trim() : fallback;
}

function formatBoolean(value: boolean | null | undefined) {
  return value ? 'Yes' : 'No';
}

function formatSource(value: string | null | undefined) {
  return value === 'configured' ? 'Managed by marketplace operations' : 'Marketplace default fallback';
}

function formatShippingMode(value: string | null | undefined) {
  if (value === 'external_provider') {
    return 'External provider cost';
  }
  if (value === 'fixed') {
    return 'Fixed deduction';
  }
  return 'Disabled';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readMetadataString(config: VendorShippingConfig | null, keys: string[]) {
  const metadata = isRecord(config?.providerMetadata) ? config.providerMetadata : {};
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
  }
  return null;
}

function metadataConfigured(config: VendorShippingConfig | null) {
  return isRecord(config?.providerMetadata) && Object.keys(config.providerMetadata).length > 0;
}

function getNavlungoSenderAddressId(config: VendorShippingConfig | null) {
  return (
    readMetadataString(config, ['navlungoSenderAddressId', 'senderAddressId', 'sender_address_id']) ??
    config?.defaultWarehouseId ??
    null
  );
}

function getNavlungoReturnRecipientAddressId(config: VendorShippingConfig | null) {
  return readMetadataString(config, [
    'navlungoReturnRecipientAddressId',
    'returnRecipientAddressId',
    'return_recipient_address_id',
  ]);
}

function getNavlungoReturnLocation(config: VendorShippingConfig | null) {
  return [
    readMetadataString(config, ['navlungoReturnRecipientCity', 'returnRecipientCity', 'return_recipient_city']),
    readMetadataString(config, ['navlungoReturnRecipientDistrict', 'returnRecipientDistrict', 'return_recipient_district']),
  ]
    .filter(Boolean)
    .join(' / ');
}

function getNavlungoSenderLocation(config: VendorShippingConfig | null) {
  return [
    readMetadataString(config, ['navlungoSenderCity', 'senderCity', 'sender_city']),
    readMetadataString(config, ['navlungoSenderDistrict', 'senderDistrict', 'sender_district']),
  ]
    .filter(Boolean)
    .join(' / ');
}

function getVendorInitials(name: string | null | undefined) {
  const normalized = name?.trim();
  if (!normalized) {
    return 'V';
  }

  const initials = normalized
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');

  return initials || normalized.slice(0, 1).toUpperCase();
}

function LocationValue({
  id,
  location,
  fallback = 'Location not configured',
}: {
  id: string | null | undefined;
  location: string | null | undefined;
  fallback?: string;
}) {
  const readableLocation = formatValue(location, fallback);
  const operationalId = formatValue(id, 'ID not configured');

  return (
    <span className="vendor-profile-location-value">
      <strong>{readableLocation}</strong>
      <small>{operationalId}</small>
    </span>
  );
}

function findOpenVendorProfileTicket(tickets: SupportTicket[] | null, vendorId: string) {
  return (tickets ?? []).find((ticket) => {
    if (ticket.vendorId !== vendorId || !OPEN_SUPPORT_STATUSES.has(ticket.status)) {
      return false;
    }
    const route = ticket.contextSummary?.route?.toLowerCase();
    const path = ticket.contextSummary?.path?.toLowerCase();
    const subject = ticket.subject?.toLowerCase() ?? '';
    return (
      route === VENDOR_PROFILE_CONTEXT_ROUTE ||
      path === VENDOR_PROFILE_PATH ||
      subject.includes('vendor profile') ||
      subject.includes('profile settings')
    );
  }) ?? null;
}

function getTicketHref(ticket: SupportTicket, isAdmin: boolean) {
  return isAdmin ? `/admin/support/${ticket.id}` : `/support/${ticket.id}`;
}

function getReadinessTone(status: ReadinessStatus) {
  if (status === 'ready') {
    return 'success';
  }
  if (status === 'review') {
    return 'warning';
  }
  if (status === 'unknown') {
    return 'attention';
  }
  return 'neutral';
}

function getReadinessLabel(status: ReadinessStatus) {
  if (status === 'ready') {
    return 'Ready';
  }
  if (status === 'review') {
    return 'Requires configuration review';
  }
  if (status === 'unknown') {
    return 'Unknown';
  }
  return 'Not modeled yet';
}

function combineReadinessStatus(items: ReadinessItem[]): ReadinessStatus {
  if (items.some((item) => item.status === 'unknown')) {
    return 'unknown';
  }
  if (items.some((item) => item.status === 'review')) {
    return 'review';
  }
  if (items.every((item) => item.status === 'not_modeled')) {
    return 'not_modeled';
  }
  if (items.some((item) => item.status === 'not_modeled')) {
    return 'review';
  }
  return 'ready';
}

function ReadinessChecklistCard({
  section,
  onOpen,
}: {
  section: ReadinessSection;
  onOpen: (path: string) => void;
}) {
  return (
    <article className={`vendor-readiness-card readiness-${section.status}`}>
      <div className="vendor-readiness-card-heading">
        <div>
          <h3>{section.title}</h3>
          <p>{section.summary}</p>
        </div>
        <StatusBadge tone={getReadinessTone(section.status)}>{getReadinessLabel(section.status)}</StatusBadge>
      </div>
      <ul className="vendor-readiness-checklist">
        {section.items.map((item) => (
          <li key={item.label}>
            <span>{item.label}</span>
            <StatusBadge tone={getReadinessTone(item.status)}>{getReadinessLabel(item.status)}</StatusBadge>
            <small>{item.detail}</small>
          </li>
        ))}
      </ul>
      <OperationalActionGroup>
        <button type="button" className="button button-secondary" onClick={() => onOpen(section.actionPath)}>
          {section.actionLabel}
        </button>
      </OperationalActionGroup>
    </article>
  );
}

export function VendorProfilePage() {
  const navigate = useNavigate();
  const appReadiness = useAppReadiness();
  const currentVendor = appReadiness.currentVendor;
  const currentUser = appReadiness.currentUser;
  const isAdmin = currentUser?.role === 'admin';
  const { message, tone, showFeedback } = useActionFeedback();

  const shippingQuery = useQueryResource(
    queryKeys.vendorProfile.shippingConfig(currentVendor.vendorId),
    ({ signal }) => getVendorShippingConfig({ vendorId: currentVendor.vendorId, signal }),
    { enabled: appReadiness.ready },
  );
  const financeQuery = useQueryResource(
    queryKeys.vendorProfile.financeProfile(currentVendor.vendorId),
    ({ signal }) => getFinanceDashboard({ vendorId: currentVendor.vendorId, signal }),
    { enabled: appReadiness.ready },
  );
  const billingQuery = useQueryResource(
    queryKeys.vendorProfile.billingProfile(currentVendor.vendorId),
    ({ signal }) => getVendorBillingProfile(currentVendor.vendorId, { signal }),
    { enabled: appReadiness.ready && isAdmin },
  );
  const supportQuery = useQueryResource(
    queryKeys.vendorProfile.supportTickets(currentVendor.vendorId),
    ({ signal }) => (isAdmin ? listAdminSupportTickets({ signal }) : listVendorSupportTickets({ signal })),
    { enabled: appReadiness.ready },
  );

  const shippingConfig = shippingQuery.data;
  const financeProfile = financeQuery.data?.profile ?? null;
  const billingProfile = billingQuery.data ?? null;
  const supportTickets = useMemo(
    () => safeArray(supportQuery.data).filter((ticket) => ticket.vendorId === currentVendor.vendorId),
    [currentVendor.vendorId, supportQuery.data],
  );
  const existingProfileTicket = useMemo(
    () => findOpenVendorProfileTicket(supportTickets, currentVendor.vendorId),
    [currentVendor.vendorId, supportTickets],
  );
  const warehouses = safeArray(shippingConfig?.warehouses);
  const defaultWarehouse = warehouses.find((warehouse) => warehouse.isDefault) ?? warehouses[0] ?? null;
  const navlungoSenderAddressId = getNavlungoSenderAddressId(shippingConfig);
  const navlungoReturnRecipientAddressId = getNavlungoReturnRecipientAddressId(shippingConfig);
  const navlungoReturnLocation = getNavlungoReturnLocation(shippingConfig);
  const navlungoSenderLocation = getNavlungoSenderLocation(shippingConfig);
  const forwardWarehouseLocation = navlungoSenderLocation || defaultWarehouse?.address || defaultWarehouse?.name || null;
  const returnDestinationLocation = navlungoReturnLocation || 'Return destination location not configured';
  const shippingDataLoaded = Boolean(!shippingQuery.isInitialLoading && shippingConfig);
  const financeDataLoaded = Boolean(!financeQuery.isInitialLoading && financeQuery.data);
  const supportDataLoaded = Boolean(!supportQuery.isInitialLoading && supportQuery.data);
  const providerConfigured = Boolean(shippingConfig?.preferredProvider && metadataConfigured(shippingConfig));
  const warehouseConfigured = Boolean(defaultWarehouse?.warehouseId || shippingConfig?.defaultWarehouseId || navlungoSenderAddressId);
  const shippingConfigured = Boolean(shippingConfig?.shippingEnabled && providerConfigured && warehouseConfigured);
  const returnsConfigured = Boolean(navlungoReturnRecipientAddressId);
  const supportWorkflowReady = Boolean(appReadiness.ready && supportDataLoaded && !supportQuery.isError);
  const marketplaceTermsActive = financeProfile?.active === true;
  const financePreviewAvailable = Boolean(financeDataLoaded && financeProfile);
  const readinessSections = useMemo<ReadinessSection[]>(() => {
    const shippingItems: ReadinessItem[] = [
      {
        label: 'Shipping enabled',
        status: !shippingDataLoaded ? 'unknown' : shippingConfig?.shippingEnabled ? 'ready' : 'review',
        detail: !shippingDataLoaded
          ? 'Shipping configuration could not be confirmed from the current profile data.'
          : shippingConfig?.shippingEnabled
            ? 'Shipment creation can use this vendor configuration.'
            : 'Enable shipping before shipment workflows can rely on this vendor setup.',
      },
      {
        label: 'Provider configured',
        status: !shippingDataLoaded ? 'unknown' : providerConfigured ? 'ready' : 'review',
        detail: !shippingDataLoaded
          ? 'Provider metadata is unavailable.'
          : providerConfigured
            ? `${formatShippingProviderName(shippingConfig?.preferredProvider)} metadata is present.`
            : 'Review the provider metadata before treating shipping as ready.',
      },
      {
        label: 'Warehouse configured',
        status: !shippingDataLoaded ? 'unknown' : warehouseConfigured ? 'ready' : 'review',
        detail: !shippingDataLoaded
          ? 'Warehouse data is unavailable.'
          : warehouseConfigured
            ? 'A default warehouse or sender address is available.'
            : 'Configure a warehouse or sender address for shipment work.',
      },
    ];
    const returnsItems: ReadinessItem[] = [
      {
        label: 'Return destination configured',
        status: !shippingDataLoaded ? 'unknown' : returnsConfigured ? 'ready' : 'review',
        detail: !shippingDataLoaded
          ? 'Return destination metadata is unavailable.'
          : returnsConfigured
            ? 'Return destination ID is present in provider metadata.'
            : 'Review the return recipient destination before return workflows rely on it.',
      },
      {
        label: 'Return workflow visible',
        status: appReadiness.ready ? 'ready' : 'unknown',
        detail: appReadiness.ready ? 'Return queues are available for this vendor context.' : 'Vendor route context is still loading.',
      },
    ];
    const financeItems: ReadinessItem[] = [
      {
        label: 'Finance preview available',
        status: financeQuery.isError ? 'unknown' : financePreviewAvailable ? 'ready' : 'unknown',
        detail: financeQuery.isError
          ? 'Finance profile data could not be loaded.'
          : financePreviewAvailable
            ? 'Settlement preview data is visible as estimates.'
            : 'Finance preview has not returned a profile yet.',
      },
      {
        label: 'Settlement visibility enabled',
        status: financeQuery.isError ? 'unknown' : financePreviewAvailable ? (marketplaceTermsActive ? 'ready' : 'review') : 'unknown',
        detail: financePreviewAvailable
          ? marketplaceTermsActive
            ? 'Marketplace terms are active for estimate visibility.'
            : 'Marketplace terms require verification before treating finance visibility as ready.'
          : 'Settlement visibility cannot be inferred without the finance profile.',
      },
    ];
    const supportItems: ReadinessItem[] = [
      {
        label: 'Support route accessible',
        status: appReadiness.ready ? 'ready' : 'unknown',
        detail: appReadiness.ready ? 'Support routes are available in this workspace.' : 'Vendor access context is still loading.',
      },
      {
        label: 'Support context available',
        status: supportQuery.isError ? 'unknown' : supportWorkflowReady ? 'ready' : 'unknown',
        detail: supportQuery.isError
          ? 'Support context could not be loaded.'
          : supportWorkflowReady
            ? 'Profile correction tickets can reuse the support workflow.'
            : 'Support tickets are still loading.',
      },
    ];
    const workflowItems: ReadinessItem[] = [
      {
        label: 'Vendor access state',
        status: appReadiness.ready && currentVendor.vendorId ? 'ready' : 'unknown',
        detail: appReadiness.ready ? 'This workspace is scoped to the selected vendor.' : 'Vendor access is not ready yet.',
      },
      {
        label: 'Workflow queues',
        status: appReadiness.ready ? 'ready' : 'unknown',
        detail: appReadiness.ready ? 'Orders, returns, finance, and support routes can open with this vendor scope.' : 'Workflow routes are waiting for vendor context.',
      },
    ];
    const automationItems: ReadinessItem[] = [
      {
        label: 'Automation queue accessible',
        status: appReadiness.ready ? 'review' : 'unknown',
        detail: appReadiness.ready
          ? 'Automation visibility exists, but this profile does not model vendor-specific automation readiness.'
          : 'Automation queue access cannot be checked until vendor context is ready.',
      },
      {
        label: 'Alerts visible',
        status: 'not_modeled',
        detail: 'Vendor-specific automation alert readiness is not modeled on the profile yet.',
      },
    ];

    const buildSection = (
      title: string,
      summary: string,
      actionLabel: string,
      actionPath: string,
      items: ReadinessItem[],
    ): ReadinessSection => ({
      title,
      summary,
      actionLabel,
      actionPath,
      items,
      status: combineReadinessStatus(items),
    });

    return [
      buildSection('Shipping ready', 'Shipment work can start only when shipping, provider, and warehouse truth are configured.', 'Open shipping workflow', '/orders?workflow=awaiting-shipment', shippingItems),
      buildSection('Returns ready', 'Return workflows need a configured destination plus visible return queues.', 'Open returns review', '/returns?workflow=pending-review', returnsItems),
      buildSection('Finance visibility ready', 'Finance readiness means estimate visibility only, not payout or accounting execution.', 'Open settlement preview', '/finance?workflow=settlement-review', financeItems),
      buildSection('Support channel active', 'Profile corrections should flow through existing support context without duplicate tickets.', 'Open support workspace', existingProfileTicket ? getTicketHref(existingProfileTicket, isAdmin) : '/support', supportItems),
      buildSection('Workflow access ready', 'The workspace must be safely scoped before operational queues are trusted.', 'Open orders queue', '/orders', workflowItems),
      buildSection('Automation visibility ready', 'Automation readiness stays conservative until vendor-specific alert coverage is modeled.', 'Open automation queue', '/automation?workflow=active-issue-groups', automationItems),
    ];
  }, [
    appReadiness.ready,
    currentVendor.vendorId,
    existingProfileTicket,
    financePreviewAvailable,
    financeQuery.isError,
    isAdmin,
    marketplaceTermsActive,
    providerConfigured,
    returnsConfigured,
    shippingConfig,
    shippingDataLoaded,
    supportQuery.isError,
    supportWorkflowReady,
    warehouseConfigured,
  ]);

  const supportMutation = useMutationAction(
    async () =>
      createSupportTicket({
        subject: 'Vendor profile settings correction',
        message: `Please review the vendor profile and operational settings for ${currentVendor.vendorName}.`,
        priority: 'normal',
        category: 'OTHER',
        contextType: 'general',
        contextId: currentVendor.vendorId,
        contextSnapshot: {
          route: VENDOR_PROFILE_CONTEXT_ROUTE,
          path: VENDOR_PROFILE_PATH,
          status: 'correction_requested',
          vendorId: currentVendor.vendorId,
          vendorName: currentVendor.vendorName,
          shippingProvider: shippingConfig?.preferredProvider ?? null,
          shippingEnabled: shippingConfig?.shippingEnabled ?? null,
          commissionProfileSource: financeProfile?.source ?? null,
          returnRecipientConfigured: Boolean(navlungoReturnRecipientAddressId),
        },
      }),
    {
      onSuccess: async (ticket) => {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: queryKeys.support.tickets(currentVendor.vendorId) }),
          queryClient.invalidateQueries({ queryKey: queryKeys.vendorProfile.supportTickets(currentVendor.vendorId) }),
          queryClient.invalidateQueries({ queryKey: queryKeys.admin.support.tickets() }),
        ]);
        showFeedback('Profile correction ticket created.', 'success');
        navigate(getTicketHref(ticket, isAdmin));
      },
      onError: (error) => {
        showFeedback(error instanceof Error ? error.message : 'Unable to contact support.', 'error');
      },
    },
  );

  function handleContactSupport() {
    if (existingProfileTicket) {
      showFeedback('Existing vendor profile support ticket opened.', 'info');
      navigate(getTicketHref(existingProfileTicket, isAdmin));
      return;
    }
    void supportMutation.mutateAsync(undefined);
  }

  function handleOpenReadinessAction(path: string) {
    navigate(path);
  }

  return (
    <section className="op-page vendor-profile-page">
      <div className="vendor-profile-hero operational-card">
        <div className="vendor-profile-identity">
          <div className="vendor-profile-avatar" aria-hidden="true">
            {getVendorInitials(currentVendor.vendorName)}
          </div>
          <div>
            <p className="eyebrow">Marketplace seller workspace</p>
            <h1>{currentVendor.vendorName || 'Vendor profile'}</h1>
            <p>
              Review the seller identity, marketplace terms, shipping operations, and return destination currently managed
              for this store. Marketplace-owned fields are read-only here.
            </p>
          </div>
        </div>
        <div className="vendor-profile-actions">
          <StatusBadge tone={isAdmin ? 'info' : 'neutral'}>{isAdmin ? 'Admin view' : 'Read-only vendor view'}</StatusBadge>
          <StatusBadge tone={appReadiness.ready ? 'success' : 'warning'}>{appReadiness.ready ? 'Active workspace' : 'Context loading'}</StatusBadge>
          {existingProfileTicket ? <StatusBadge tone="attention">Support ticket open</StatusBadge> : null}
          <button
            type="button"
            className="button"
            onClick={handleContactSupport}
            disabled={!appReadiness.ready || supportQuery.isInitialLoading || supportMutation.isPending}
          >
            {existingProfileTicket
              ? 'Open correction ticket'
              : supportMutation.isPending
                ? 'Requesting correction...'
                : 'Request profile correction'}
          </button>
        </div>
      </div>

      <OperationalSection
        title="Operational readiness"
        description="A checklist view of whether this vendor is operationally ready, based only on currently loaded configuration and workflow visibility."
      >
        <div className="vendor-profile-readiness-grid" aria-label="Vendor operational readiness">
          {readinessSections.map((section) => (
            <ReadinessChecklistCard key={section.title} section={section} onOpen={handleOpenReadinessAction} />
          ))}
        </div>
      </OperationalSection>

      <div className="vendor-profile-grid">
        <OperationalSection
          title="Store identity"
          description="Seller identity currently available to marketplace operations."
        >
          <MetadataGroup>
            <MetadataRow label="Display name" value={formatValue(currentVendor.vendorName, 'Vendor unavailable')} />
            <MetadataRow label="Vendor ID" value={formatValue(currentVendor.vendorId, 'Missing vendor context')} />
            <MetadataRow label="Legal name" value="Not modeled yet" />
            <MetadataRow label="Store contact" value="Not modeled yet" />
            <MetadataRow label="Signed-in user" value={currentUser?.email ?? 'Unknown'} />
            <MetadataRow label="Seller of record" value="Not configured" />
          </MetadataGroup>
        </OperationalSection>

        <OperationalSection
          title="Billing / Legal Profile"
          description="Seller legal billing identity used later as the Paraşüt contact source for Sporgym commission invoices."
        >
          {!isAdmin ? (
            <MetadataGroup>
              <MetadataRow label="Visibility" value="Admin-managed" />
              <MetadataRow label="Commission invoice readiness" value="Requires configuration review" />
              <MetadataRow label="Edit access" value="Not available in vendor view" />
            </MetadataGroup>
          ) : billingQuery.isError ? (
            <SectionErrorRetry
              title="Billing profile unavailable"
              description={billingQuery.error ?? 'Unable to load the vendor billing profile.'}
              onRetry={() => void billingQuery.refetch()}
            />
          ) : billingQuery.isInitialLoading ? (
            <SectionSkeleton title="Loading billing profile" description="Fetching seller legal billing identity." />
          ) : (
            <>
              <MetadataGroup>
                <MetadataRow label="Legal company name" value={formatValue(billingProfile?.legalCompanyName)} />
                <MetadataRow label="Tax number / TCKN" value={formatValue(billingProfile?.taxNumber)} />
                <MetadataRow label="Tax office" value={formatValue(billingProfile?.taxOffice)} />
                <MetadataRow label="Billing address" value={formatValue(billingProfile?.billingAddress)} />
                <MetadataRow label="Authorized person" value={formatValue(billingProfile?.authorizedPerson)} />
                <MetadataRow label="Billing email" value={formatValue(billingProfile?.billingEmail)} />
                <MetadataRow label="Billing phone" value={formatValue(billingProfile?.billingPhone)} />
                <MetadataRow label="IBAN" value={formatValue(billingProfile?.iban)} />
              </MetadataGroup>
              <div className="vendor-profile-integration-list">
                <div>
                  <span>Paraşüt contact source</span>
                  <StatusBadge tone={billingProfile ? 'success' : 'warning'}>
                    {billingProfile ? 'Configured' : 'Required for commission invoices'}
                  </StatusBadge>
                </div>
                <div>
                  <span>Admin edit UI</span>
                  <StatusBadge tone="neutral">Deferred</StatusBadge>
                </div>
              </div>
            </>
          )}
        </OperationalSection>

        <OperationalSection
          title="Marketplace terms"
          description="Read-only commercial profile used for operational visibility. This does not implement payout execution."
        >
          {financeQuery.isError && !financeProfile ? (
            <SectionErrorRetry
              title="Marketplace terms unavailable"
              description={financeQuery.error ?? 'Unable to load the vendor commercial profile.'}
              onRetry={() => void financeQuery.refetch()}
            />
          ) : financeQuery.isInitialLoading || !financeProfile ? (
            <SectionSkeleton title="Loading marketplace terms" description="Fetching the current vendor finance profile." />
          ) : (
            <MetadataGroup>
              <MetadataRow label="Commission" value={`${financeProfile.commissionPercent}%`} />
              <MetadataRow label="Commission VAT" value={`${financeProfile.commissionVatPercent}%`} />
              <MetadataRow label="Shipping deduction" value={formatShippingMode(financeProfile.shippingMode)} />
              <MetadataRow label="Fixed shipping fee" value={formatValue(financeProfile.fixedShippingFee)} />
              <MetadataRow label="Managed by" value={formatSource(financeProfile.source)} />
              <MetadataRow label="Terms active" value={formatBoolean(financeProfile.active)} />
            </MetadataGroup>
          )}
        </OperationalSection>

        <OperationalSection
          title="Shipping operations"
          description="Admin-owned shipping setup used by shipment creation and recovery workflows."
        >
          {shippingQuery.isError && !shippingConfig ? (
            <SectionErrorRetry
              title="Shipping setup unavailable"
              description={shippingQuery.error ?? 'Unable to load the vendor shipping configuration.'}
              onRetry={() => void shippingQuery.refetch()}
            />
          ) : shippingQuery.isInitialLoading || !shippingConfig ? (
            <SectionSkeleton title="Loading shipping setup" description="Fetching provider and warehouse configuration." />
          ) : (
            <MetadataGroup>
              <MetadataRow label="Preferred provider" value={formatValue(formatShippingProviderName(shippingConfig.preferredProvider))} />
              <MetadataRow label="Shipping enabled" value={formatBoolean(shippingConfig.shippingEnabled)} />
              <MetadataRow label="Managed by" value={formatSource(shippingConfig.source)} />
              <MetadataRow label="Default desi" value={shippingConfig.defaultDesi} />
              <MetadataRow label="Cargo integration ID" value={formatValue(shippingConfig.cargoIntegrationId)} />
              <MetadataRow label="Default warehouse ID" value={formatValue(shippingConfig.defaultWarehouseId)} />
              <MetadataRow label="Shipping VAT" value={`${shippingConfig.shippingVatPercent}%`} />
              <MetadataRow label="Provider configuration status" value={metadataConfigured(shippingConfig) ? 'Configured' : 'Not configured'} />
            </MetadataGroup>
          )}
        </OperationalSection>

        <OperationalSection
          title="Integration status"
          description="Marketplace systems connected to this seller workspace."
        >
          <div className="vendor-profile-integration-list">
            <div>
              <span>Shopify workspace</span>
              <StatusBadge tone={appReadiness.ready ? 'success' : 'warning'}>{appReadiness.ready ? 'Connected' : 'Loading'}</StatusBadge>
            </div>
            <div>
              <span>Shipping provider</span>
              <StatusBadge tone={shippingConfigured ? 'success' : 'warning'}>
                {shippingConfigured ? formatShippingProviderName(shippingConfig?.preferredProvider) : 'Not configured'}
              </StatusBadge>
            </div>
            <div>
              <span>Return workflow</span>
              <StatusBadge tone={returnsConfigured ? 'success' : 'warning'}>{returnsConfigured ? 'Configured' : 'Needs destination'}</StatusBadge>
            </div>
            <div>
              <span>Provider configuration status</span>
              <StatusBadge tone={metadataConfigured(shippingConfig) ? 'success' : 'neutral'}>
                {metadataConfigured(shippingConfig) ? 'Configured' : 'Not configured'}
              </StatusBadge>
            </div>
          </div>
        </OperationalSection>

        <OperationalSection
          title="Warehouse and returns"
          description="Address-book destinations visible to the seller as read-only operational truth."
        >
          {shippingQuery.isError && !shippingConfig ? (
            <SectionErrorRetry
              title="Warehouse setup unavailable"
              description={shippingQuery.error ?? 'Unable to load warehouse and return destination metadata.'}
              onRetry={() => void shippingQuery.refetch()}
            />
          ) : shippingQuery.isInitialLoading || !shippingConfig ? (
            <SectionSkeleton title="Loading warehouse setup" description="Fetching branch and return destination metadata." />
          ) : (
            <>
              <MetadataGroup title="Default warehouse">
                <MetadataRow label="Name" value={formatValue(defaultWarehouse?.name)} />
                <MetadataRow label="Provider" value={formatValue(formatShippingProviderName(defaultWarehouse?.provider))} />
                <MetadataRow label="Warehouse ID" value={formatValue(defaultWarehouse?.warehouseId)} />
                <MetadataRow label="Default" value={formatBoolean(defaultWarehouse?.isDefault)} />
                <MetadataRow label="Address summary" value={formatValue(defaultWarehouse?.address)} />
              </MetadataGroup>
              <MetadataGroup title="Marketplace warehouse destinations">
                <MetadataRow
                  label="Forward warehouse"
                  value={<LocationValue id={navlungoSenderAddressId} location={forwardWarehouseLocation} />}
                />
                <MetadataRow
                  label="Return destination"
                  value={<LocationValue id={navlungoReturnRecipientAddressId} location={returnDestinationLocation} />}
                />
              </MetadataGroup>
            </>
          )}
        </OperationalSection>
      </div>

      <OperationalSection
        title="Support and correction workflow"
        description="Vendors request corrections through support; admin-owned settings stay locked on this page."
      >
        <div className="vendor-profile-support-panel">
          <div>
            <strong>{existingProfileTicket ? 'A correction ticket is already open.' : 'Need a correction?'}</strong>
            <p>
              {existingProfileTicket
                ? `${existingProfileTicket.subject} is ${safeStatusLabel(existingProfileTicket.status).toLowerCase()}.`
                : 'Report a marketplace profile or configuration issue so operations can review the admin-owned data.'}
            </p>
          </div>
          <OperationalActionGroup>
            <button
              type="button"
              className="button button-secondary"
              onClick={handleContactSupport}
              disabled={!appReadiness.ready || supportQuery.isInitialLoading || supportMutation.isPending}
            >
              {existingProfileTicket ? 'Open correction ticket' : 'Report configuration issue'}
            </button>
          </OperationalActionGroup>
        </div>
      </OperationalSection>

      <OperationalSection
        title="Additional seller profile fields"
        description="Compact reference for profile data that is intentionally not inferred until the model is confirmed."
      >
        <details className="vendor-profile-disclosure">
          <summary>
            <span>Fields not modeled yet</span>
            <small>Open for data-model notes</small>
          </summary>
          <ul className="vendor-profile-missing-list">
            <li>Legal entity name, tax office, and tax identity</li>
            <li>Dedicated store operations contact email and phone</li>
            <li>Seller-of-record / commercial authority status</li>
            <li>Public marketplace storefront profile content</li>
            <li>Full provider address-book detail sync beyond configured IDs and safe metadata</li>
          </ul>
        </details>
      </OperationalSection>

      {isAdmin ? (
        <OperationalSection
          title="Admin note"
          description="This foundation intentionally avoids a broad editor. Use existing order/shipping or finance admin controls for supported configuration changes."
        >
          <StatusBadge tone="info">Admin-owned configuration</StatusBadge>
        </OperationalSection>
      ) : null}

      {message ? <ActionFeedback tone={tone} message={message} /> : null}
    </section>
  );
}
