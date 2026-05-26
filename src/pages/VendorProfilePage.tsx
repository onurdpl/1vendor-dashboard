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
import { queryClient } from '../lib/api/queryClient';
import { queryKeys } from '../lib/api/queryKeys';
import type { SupportTicket, VendorShippingConfig } from '../lib/api/contracts';
import { useAppReadiness } from '../lib/appReadiness';
import { formatShippingProviderName } from '../lib/shippingDisplay';
import { useActionFeedback } from '../lib/ui';

const VENDOR_PROFILE_CONTEXT_ROUTE = 'vendor_profile_settings';
const VENDOR_PROFILE_PATH = '/vendor/profile';
const OPEN_SUPPORT_STATUSES = new Set(['OPEN', 'IN_REVIEW', 'WAITING_FOR_VENDOR']);

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
    const subject = ticket.subject.toLowerCase();
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
  const supportQuery = useQueryResource(
    queryKeys.vendorProfile.supportTickets(currentVendor.vendorId),
    ({ signal }) => (isAdmin ? listAdminSupportTickets({ signal }) : listVendorSupportTickets({ signal })),
    { enabled: appReadiness.ready },
  );

  const shippingConfig = shippingQuery.data;
  const financeProfile = financeQuery.data?.profile ?? null;
  const supportTickets = useMemo(
    () => (supportQuery.data ?? []).filter((ticket) => ticket.vendorId === currentVendor.vendorId),
    [currentVendor.vendorId, supportQuery.data],
  );
  const existingProfileTicket = useMemo(
    () => findOpenVendorProfileTicket(supportTickets, currentVendor.vendorId),
    [currentVendor.vendorId, supportTickets],
  );
  const defaultWarehouse = shippingConfig?.warehouses.find((warehouse) => warehouse.isDefault) ?? shippingConfig?.warehouses[0] ?? null;
  const navlungoSenderAddressId = getNavlungoSenderAddressId(shippingConfig);
  const navlungoReturnRecipientAddressId = getNavlungoReturnRecipientAddressId(shippingConfig);
  const navlungoReturnLocation = getNavlungoReturnLocation(shippingConfig);
  const navlungoSenderLocation = getNavlungoSenderLocation(shippingConfig);
  const forwardWarehouseLocation = navlungoSenderLocation || defaultWarehouse?.address || defaultWarehouse?.name || null;
  const returnDestinationLocation = navlungoReturnLocation || 'Return destination location not configured';
  const shippingConfigured = Boolean(shippingConfig?.shippingEnabled && shippingConfig.preferredProvider);
  const returnsConfigured = Boolean(navlungoReturnRecipientAddressId);
  const supportWorkflowReady = appReadiness.ready && !supportQuery.isError;
  const marketplaceTermsActive = financeProfile?.active === true;

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

      <div className="vendor-profile-readiness-strip operational-card" aria-label="Vendor operational readiness">
        <div>
          <span>Shipping configured</span>
          <StatusBadge tone={shippingConfigured ? 'success' : 'warning'}>{shippingConfigured ? 'Ready' : 'Needs setup'}</StatusBadge>
        </div>
        <div>
          <span>Returns configured</span>
          <StatusBadge tone={returnsConfigured ? 'success' : 'warning'}>{returnsConfigured ? 'Ready' : 'Needs destination'}</StatusBadge>
        </div>
        <div>
          <span>Tracking data source</span>
          <StatusBadge tone={shippingConfigured ? 'success' : 'neutral'}>{shippingConfigured ? 'Provider configured' : 'Not configured'}</StatusBadge>
        </div>
        <div>
          <span>Support workflow</span>
          <StatusBadge tone={supportWorkflowReady ? 'success' : 'warning'}>{supportWorkflowReady ? 'Active' : 'Loading'}</StatusBadge>
        </div>
        <div>
          <span>Marketplace terms</span>
          <StatusBadge tone={marketplaceTermsActive ? 'success' : 'attention'}>
            {marketplaceTermsActive ? 'Active' : 'Awaiting verification'}
          </StatusBadge>
        </div>
      </div>

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
                ? `${existingProfileTicket.subject} is ${existingProfileTicket.status.toLowerCase().replace(/_/g, ' ')}.`
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
