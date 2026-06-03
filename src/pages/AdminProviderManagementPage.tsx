import { useEffect, useMemo, useState } from 'react';
import {
  EmptyStatePanel,
  KPIStatCard,
  MetadataGroup,
  MetadataRow,
  OperationalTable,
  OperationalTableRow,
  SectionErrorRetry,
  SectionSkeleton,
  StatusBadge,
} from '../components/OperationalPrimitives';
import { useQueryResource } from '../hooks/useQueryResource';
import { useAppReadiness } from '../lib/appReadiness';
import { queryKeys } from '../lib/api/queryKeys';
import type { VendorIntegrationProviderSummary } from '../lib/api/contracts';
import { runtimeServices } from '../services/runtime-services';
import { formatDateTime, safeArray } from '../services/real/formatting';

function formatDate(value: string | null | undefined) {
  if (!value) {
    return '—';
  }

  return formatDateTime(value, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatScopes(scopes: string[]) {
  return scopes.length ? scopes.join(', ') : 'No scopes';
}

function getProviderState(provider: VendorIntegrationProviderSummary) {
  if (provider.revokedAt || !provider.enabled) {
    return {
      label: 'Revoked',
      tone: 'danger' as const,
    };
  }

  return {
    label: 'Active',
    tone: 'success' as const,
  };
}

const PROVIDER_PERMISSION_CHIPS = [
  { scope: 'orders:read', label: 'Orders' },
  { scope: 'status:write', label: 'Status' },
  { scope: 'shipment:write', label: 'Shipment' },
  { scope: 'invoice:write', label: 'Invoice' },
];

function getLastActivity(provider: VendorIntegrationProviderSummary) {
  return provider.lastRequestAt ?? provider.lastUsedAt;
}

function getActivityAction(log: VendorIntegrationProviderSummary['recentAuditLogs'][number]) {
  const path = log.path.toLowerCase();

  if (log.method === 'GET' && path.includes('/orders')) {
    return 'Orders synced';
  }

  if (path.includes('/status')) {
    return 'Status updated';
  }

  if (path.includes('/shipment')) {
    return 'Shipment received';
  }

  if (path.includes('/invoice')) {
    return 'Invoice received';
  }

  return 'Provider request recorded';
}

function getHttpResult(statusCode: number) {
  if (statusCode === 429) {
    return {
      label: '429 Rate limited',
      tone: 'warning' as const,
    };
  }

  if (statusCode >= 500) {
    return {
      label: `${statusCode} Server error`,
      tone: 'danger' as const,
    };
  }

  if (statusCode >= 400) {
    return {
      label: `${statusCode} Error`,
      tone: 'warning' as const,
    };
  }

  return {
    label: `${statusCode} OK`,
    tone: 'success' as const,
  };
}

function PermissionChips({ provider }: { provider: VendorIntegrationProviderSummary }) {
  return (
    <div className="provider-permission-chips" aria-label={`${provider.providerName} permissions`}>
      {PROVIDER_PERMISSION_CHIPS.map((permission) => {
        const isGranted = provider.scopes.includes(permission.scope);
        return (
          <span
            key={permission.scope}
            className={`provider-permission-chip ${isGranted ? 'is-granted' : 'is-muted'}`}
            aria-label={`${permission.label} permission ${isGranted ? 'granted' : 'not granted'}`}
          >
            {permission.label}
          </span>
        );
      })}
    </div>
  );
}

export function AdminProviderManagementPage() {
  const appReadiness = useAppReadiness();
  const { data, isLoading, isError, error, refetch } = useQueryResource(
    queryKeys.admin.vendorIntegration.providers(),
    ({ signal }) => runtimeServices.vendorIntegration.providers({ signal }),
    { enabled: appReadiness.ready },
  );
  const providers = safeArray(data?.providers);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);

  useEffect(() => {
    if (!providers.length) {
      setSelectedClientId(null);
      return;
    }

    if (!selectedClientId || !providers.some((provider) => provider.clientId === selectedClientId)) {
      setSelectedClientId(providers[0].clientId);
    }
  }, [providers, selectedClientId]);

  const selectedProvider = useMemo(
    () => providers.find((provider) => provider.clientId === selectedClientId) ?? providers[0] ?? null,
    [providers, selectedClientId],
  );
  const activeCount = providers.filter((provider) => provider.enabled && !provider.revokedAt).length;
  const revokedCount = providers.filter((provider) => !provider.enabled || provider.revokedAt).length;
  const requestsLast24h = providers.reduce((total, provider) => total + provider.requestsLast24h, 0);
  const rateLimitedLast24h = providers.reduce((total, provider) => total + provider.rateLimitedLast24h, 0);

  return (
    <section className="op-page provider-management-page">
      <div className="op-page-heading">
        <div>
          <p className="eyebrow">Vendor integrations</p>
          <h1>Provider Management</h1>
          <p className="page-description">
            Read-only visibility for vendor integration clients, scopes, usage metadata, and recent audit logs.
          </p>
        </div>
        <div className="op-heading-meta">
          <StatusBadge tone="info">Generated {formatDate(data?.generatedAt)}</StatusBadge>
        </div>
      </div>

      <div className="op-kpi-row">
        <KPIStatCard label="Providers" value={providers.length} detail="Registered integration clients" tone="info" />
        <KPIStatCard label="Active" value={activeCount} detail="Enabled and not revoked" tone={activeCount ? 'success' : 'neutral'} />
        <KPIStatCard label="Revoked" value={revokedCount} detail="Disabled or revoked clients" tone={revokedCount ? 'warning' : 'neutral'} />
        <KPIStatCard label="Requests 24h" value={requestsLast24h} detail="Valid client audit logs" tone="info" />
        <KPIStatCard label="Rate limited 24h" value={rateLimitedLast24h} detail="HTTP 429 responses" tone={rateLimitedLast24h ? 'warning' : 'neutral'} />
      </div>

      {isError && !data ? (
        <SectionErrorRetry
          title="Provider management unavailable"
          description={error ?? 'Provider management data could not be loaded.'}
          onRetry={() => void refetch()}
        />
      ) : !appReadiness.ready || isLoading ? (
        <SectionSkeleton title="Loading provider management" description="Reading integration client metadata and audit logs." />
      ) : null}

      {!isLoading && !isError && !providers.length ? (
        <EmptyStatePanel title="No integration providers" description="No vendor integration clients are registered yet." />
      ) : null}

      {providers.length ? (
        <div className="attention-layout">
          <main className="attention-main-column">
            <article className="attention-card">
              <div className="attention-card-heading">
                <div>
                  <p className="eyebrow">Providers</p>
                  <h3>Integration clients</h3>
                  <span>Token values are not recoverable and are never shown.</span>
                </div>
              </div>
              <div className="provider-card-list" aria-label="Provider list">
                {providers.map((provider) => {
                  const state = getProviderState(provider);
                  const isSelected = provider.clientId === selectedProvider?.clientId;
                  return (
                    <button
                      key={provider.clientId}
                      type="button"
                      className={`provider-card ${isSelected ? 'is-selected' : ''}`}
                      aria-pressed={isSelected}
                      onClick={() => setSelectedClientId(provider.clientId)}
                    >
                      <div className="provider-card-header">
                        <h4>{provider.providerName}</h4>
                        <StatusBadge tone={state.tone}>{state.label}</StatusBadge>
                      </div>
                      <div className="provider-card-body">
                        <div className="provider-card-field">
                          <span>Vendor</span>
                          <strong>{provider.vendorIdentifier}</strong>
                        </div>
                        <PermissionChips provider={provider} />
                      </div>
                      <div className="provider-card-metrics">
                        <div>
                          <span>Requests 24h</span>
                          <strong>{provider.requestsLast24h}</strong>
                        </div>
                        <div>
                          <span>Last Activity</span>
                          <strong>{formatDate(getLastActivity(provider))}</strong>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </article>
          </main>

          <aside className="attention-side-column">
            {selectedProvider ? (
              <article className="attention-card" aria-label="Provider detail">
                <div className="attention-card-heading">
                  <div>
                    <p className="eyebrow">Provider detail</p>
                    <h3>{selectedProvider.providerName}</h3>
                    <span>{selectedProvider.vendorIdentifier}</span>
                  </div>
                  <StatusBadge tone={getProviderState(selectedProvider).tone}>{getProviderState(selectedProvider).label}</StatusBadge>
                </div>

                <section className="provider-detail-section" aria-label="Provider summary">
                  <div className="provider-detail-section-heading">
                    <p className="eyebrow">Summary</p>
                    <h4>Provider Summary</h4>
                  </div>
                  <div className="provider-summary-grid">
                    <div>
                      <span>Provider Name</span>
                      <strong>{selectedProvider.providerName}</strong>
                    </div>
                    <div>
                      <span>Vendor</span>
                      <strong>{selectedProvider.vendorIdentifier}</strong>
                    </div>
                    <div>
                      <span>Status</span>
                      <StatusBadge tone={getProviderState(selectedProvider).tone}>{getProviderState(selectedProvider).label}</StatusBadge>
                    </div>
                    <div>
                      <span>Last Activity</span>
                      <strong>{formatDate(getLastActivity(selectedProvider))}</strong>
                    </div>
                    <div>
                      <span>Requests 24h</span>
                      <strong>{selectedProvider.requestsLast24h}</strong>
                    </div>
                  </div>
                </section>

                <section className="provider-detail-section" aria-label="Provider permissions">
                  <div className="provider-detail-section-heading">
                    <p className="eyebrow">Access</p>
                    <h4>Permissions</h4>
                  </div>
                  <PermissionChips provider={selectedProvider} />
                </section>

                <section className="provider-detail-section" aria-label="Activity timeline">
                  <div className="provider-detail-section-heading">
                    <p className="eyebrow">Activity</p>
                    <h4>Activity Timeline</h4>
                  </div>
                  {selectedProvider.recentAuditLogs.length ? (
                    <div className="provider-activity-list">
                      {selectedProvider.recentAuditLogs.map((log) => {
                        const result = getHttpResult(log.statusCode);
                        return (
                          <div className="provider-activity-row" key={`${log.createdAt}-${log.requestId ?? log.path}-${log.statusCode}`}>
                            <div>
                              <strong>{getActivityAction(log)}</strong>
                              <span>{formatDate(log.createdAt)}</span>
                            </div>
                            <StatusBadge tone={result.tone}>{result.label}</StatusBadge>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <EmptyStatePanel title="No activity recorded yet." description="Provider API requests will appear here after they are recorded." />
                  )}
                </section>

                <details className="provider-technical-details">
                  <summary>Technical Details</summary>
                  <MetadataGroup>
                    <MetadataRow label="Client id" value={selectedProvider.clientId} />
                    <MetadataRow label="Raw scopes" value={formatScopes(selectedProvider.scopes)} />
                    <MetadataRow label="Created" value={formatDate(selectedProvider.createdAt)} />
                    <MetadataRow label="Updated" value={formatDate(selectedProvider.updatedAt)} />
                    <MetadataRow label="Last used" value={formatDate(selectedProvider.lastUsedAt)} />
                    <MetadataRow label="Last request" value={formatDate(selectedProvider.lastRequestAt)} />
                    <MetadataRow label="Auth failures 24h" value={selectedProvider.authFailuresLast24h ?? 'Not derivable'} />
                    <MetadataRow label="Revoked at" value={formatDate(selectedProvider.revokedAt)} />
                  </MetadataGroup>

                  <div className="attention-card-heading">
                    <div>
                      <p className="eyebrow">Technical audit</p>
                      <h3>Raw request metadata</h3>
                    </div>
                  </div>

                  {selectedProvider.recentAuditLogs.length ? (
                    <OperationalTable columns={['Method', 'Path', 'Status', 'Request', 'Created']} stickyHeader={false}>
                      {selectedProvider.recentAuditLogs.map((log) => (
                        <OperationalTableRow key={`${log.createdAt}-${log.requestId ?? log.path}-${log.statusCode}`}>
                          <strong>{log.method}</strong>
                          <span>{log.path}</span>
                          <StatusBadge tone={log.statusCode >= 400 ? 'warning' : 'success'}>{log.statusCode}</StatusBadge>
                          <span>{log.requestId ?? '—'}</span>
                          <span>{formatDate(log.createdAt)}</span>
                        </OperationalTableRow>
                      ))}
                    </OperationalTable>
                  ) : (
                    <EmptyStatePanel title="No technical audit logs" description="No raw request metadata is available for this client." />
                  )}
                </details>
              </article>
            ) : (
              <EmptyStatePanel title="Select a provider to view details." description="Provider summary and activity appear after a provider is selected." />
            )}
          </aside>
        </div>
      ) : null}
    </section>
  );
}
