import { useEffect, useMemo, useState } from 'react';
import {
  EmptyStatePanel,
  KPIStatCard,
  MetadataGroup,
  MetadataRow,
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

  if (log.statusCode === 429) {
    return 'Rate limited';
  }

  if (log.statusCode === 401 || log.statusCode === 403) {
    return 'Access rejected';
  }

  if (log.method === 'GET' && path === '/api/vendor-integration/orders') {
    return 'Orders synced';
  }

  if (log.method === 'POST' && path.includes('/status')) {
    return 'Status updated';
  }

  if (log.method === 'POST' && path.includes('/shipment')) {
    return 'Shipment received';
  }

  if (log.method === 'POST' && path.includes('/invoice')) {
    return 'Invoice received';
  }

  return 'API request';
}

function getActivityStatus(statusCode: number) {
  if (statusCode === 429) {
    return {
      label: 'Rate limited',
      tone: 'warning' as const,
    };
  }

  if (statusCode === 401 || statusCode === 403) {
    return {
      label: 'Rejected',
      tone: 'danger' as const,
    };
  }

  if (statusCode >= 400) {
    return {
      label: 'Error',
      tone: 'warning' as const,
    };
  }

  return {
    label: 'Success',
    tone: 'success' as const,
  };
}

function getAllocationHint(path: string) {
  const match = path.match(/\/orders\/([^/?#]+)\/(?:status|shipment|invoice)(?:[/?#]|$)/i);
  return match?.[1] ? `Allocation ${match[1]}` : null;
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
  const [revokingClientId, setRevokingClientId] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  useEffect(() => {
    if (!providers.length) {
      setSelectedClientId(null);
      return;
    }

    if (!selectedClientId || !providers.some((provider) => provider.clientId === selectedClientId)) {
      setSelectedClientId(providers[0].clientId);
    }
  }, [providers, selectedClientId]);

  useEffect(() => {
    setRevokeError(null);
  }, [selectedClientId]);

  const selectedProvider = useMemo(
    () => providers.find((provider) => provider.clientId === selectedClientId) ?? providers[0] ?? null,
    [providers, selectedClientId],
  );
  const activeCount = providers.filter((provider) => provider.enabled && !provider.revokedAt).length;
  const revokedCount = providers.filter((provider) => !provider.enabled || provider.revokedAt).length;
  const requestsLast24h = providers.reduce((total, provider) => total + provider.requestsLast24h, 0);
  const rateLimitedLast24h = providers.reduce((total, provider) => total + provider.rateLimitedLast24h, 0);

  async function handleRevokeToken(provider: VendorIntegrationProviderSummary) {
    setRevokeError(null);

    const confirmed = window.confirm(
      'This will disable this provider token. Existing integrations using this token will stop working.',
    );
    if (!confirmed) {
      return;
    }

    setRevokingClientId(provider.clientId);
    try {
      await runtimeServices.vendorIntegration.revokeProviderToken(provider.clientId);
      await refetch();
    } catch {
      setRevokeError('Provider token could not be revoked. Please retry.');
    } finally {
      setRevokingClientId(null);
    }
  }

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
                  <div className="provider-detail-actions">
                    <StatusBadge tone={getProviderState(selectedProvider).tone}>{getProviderState(selectedProvider).label}</StatusBadge>
                    {selectedProvider.enabled && !selectedProvider.revokedAt ? (
                      <button
                        type="button"
                        className="button button-secondary button-compact provider-revoke-button"
                        disabled={revokingClientId === selectedProvider.clientId}
                        onClick={() => void handleRevokeToken(selectedProvider)}
                      >
                        {revokingClientId === selectedProvider.clientId ? 'Revoking...' : 'Revoke token'}
                      </button>
                    ) : null}
                  </div>
                </div>
                {revokeError ? (
                  <div className="provider-action-error" role="alert">
                    {revokeError}
                  </div>
                ) : null}

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
                        const result = getActivityStatus(log.statusCode);
                        const allocationHint = getAllocationHint(log.path);
                        return (
                          <div className="provider-activity-row" key={`${log.createdAt}-${log.requestId ?? log.path}-${log.statusCode}`}>
                            <div className="provider-activity-main">
                              <div>
                                <span>{formatDate(log.createdAt)}</span>
                                <strong>{getActivityAction(log)}</strong>
                                {allocationHint ? <small>{allocationHint}</small> : null}
                              </div>
                              <StatusBadge tone={result.tone}>{result.label}</StatusBadge>
                            </div>
                            <details className="provider-activity-technical">
                              <summary>Technical details</summary>
                              <dl>
                                <div>
                                  <dt>Method</dt>
                                  <dd>{log.method}</dd>
                                </div>
                                <div>
                                  <dt>Raw path</dt>
                                  <dd>{log.path}</dd>
                                </div>
                                <div>
                                  <dt>Status code</dt>
                                  <dd>{log.statusCode}</dd>
                                </div>
                                <div>
                                  <dt>Request id</dt>
                                  <dd>{log.requestId ?? '—'}</dd>
                                </div>
                              </dl>
                            </details>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <EmptyStatePanel title="No provider activity recorded yet." description="Provider API requests will appear here after they are recorded." />
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
