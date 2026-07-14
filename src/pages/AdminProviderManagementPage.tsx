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
import { getPageReadinessState } from '../lib/pageReadiness';
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
  { scope: 'orders:read', label: 'Read Orders' },
  { scope: 'status:write', label: 'Update Status' },
  { scope: 'shipment:write', label: 'Update Shipment' },
  { scope: 'invoice:write', label: 'Update Invoice' },
];

function getLastActivity(provider: VendorIntegrationProviderSummary) {
  return provider.lastRequestAt ?? provider.lastUsedAt;
}

function formatDateGroup(value: string) {
  return formatDateTime(value, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function getActivityDateKey(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toISOString().slice(0, 10);
}

function groupRecentActivity(logs: VendorIntegrationProviderSummary['recentAuditLogs']) {
  const groups: Array<{ key: string; label: string; logs: VendorIntegrationProviderSummary['recentAuditLogs'] }> = [];

  logs.forEach((log) => {
    const key = getActivityDateKey(log.createdAt);
    const existing = groups.find((group) => group.key === key);
    if (existing) {
      existing.logs.push(log);
      return;
    }

    groups.push({
      key,
      label: formatDateGroup(log.createdAt),
      logs: [log],
    });
  });

  return groups;
}

function groupConsecutiveActivityByTimestamp(logs: VendorIntegrationProviderSummary['recentAuditLogs']) {
  const groups: Array<{ key: string; timestamp: string; label: string; logs: VendorIntegrationProviderSummary['recentAuditLogs'] }> = [];

  logs.forEach((log, index) => {
    const previous = groups[groups.length - 1];
    if (previous?.timestamp === log.createdAt) {
      previous.logs.push(log);
      return;
    }

    groups.push({
      key: `${log.createdAt}-${index}`,
      timestamp: log.createdAt,
      label: formatDate(log.createdAt),
      logs: [log],
    });
  });

  return groups;
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

function getActivityIcon(log: VendorIntegrationProviderSummary['recentAuditLogs'][number]) {
  const path = log.path.toLowerCase();

  if (log.statusCode === 429) {
    return '!';
  }

  if (log.statusCode >= 400) {
    return '×';
  }

  if (log.method === 'GET' && path === '/api/vendor-integration/orders') {
    return '↧';
  }

  if (log.method === 'POST' && path.includes('/status')) {
    return '✓';
  }

  if (log.method === 'POST' && path.includes('/shipment')) {
    return '⇢';
  }

  if (log.method === 'POST' && path.includes('/invoice')) {
    return '#';
  }

  return '•';
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

function PermissionChips({ provider }: { provider: VendorIntegrationProviderSummary }) {
  return (
    <div className="provider-permission-chips" aria-label={`${provider.providerName} access permissions`}>
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
  const pageReadiness = getPageReadinessState(appReadiness, {
    requiresVendorContext: false,
  });
  const { data, isLoading, isError, error, refetch } = useQueryResource(
    queryKeys.admin.vendorIntegration.providers(),
    ({ signal }) => runtimeServices.vendorIntegration.providers({ signal }),
    { enabled: pageReadiness.ready },
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
      'This will disable this integration token. Existing integrations using this token will stop working. Historical activity remains visible, and continued access requires a newly issued token.',
    );
    if (!confirmed) {
      return;
    }

    setRevokingClientId(provider.clientId);
    try {
      await runtimeServices.vendorIntegration.revokeProviderToken(provider.clientId);
      await refetch();
    } catch {
      setRevokeError('Integration token could not be revoked. Please retry.');
    } finally {
      setRevokingClientId(null);
    }
  }

  return (
    <section className="op-page provider-management-page">
      <div className="op-page-heading provider-page-heading">
        <div>
          <p className="eyebrow">Vendor Integrations</p>
          <h1>Integration Clients</h1>
          <p className="page-description">
            Monitor vendor integration clients, permissions, activity and token status.
          </p>
        </div>
        <div className="op-heading-meta provider-generated-meta">
          <span>Last refreshed {formatDate(data?.generatedAt)}</span>
        </div>
      </div>

      <div className="provider-kpi-groups">
        <section className="provider-kpi-group" aria-label="Clients">
          <h2>Clients</h2>
          <div className="op-kpi-row provider-kpi-row">
            <KPIStatCard label="Total clients" value={providers.length} detail="Registered integration clients" tone="info" />
            <KPIStatCard label="Active" value={activeCount} detail="Enabled and not revoked" tone={activeCount ? 'success' : 'neutral'} />
            <KPIStatCard label="Revoked" value={revokedCount} detail="Disabled or revoked clients" tone={revokedCount ? 'warning' : 'neutral'} />
          </div>
        </section>
        <section className="provider-kpi-group" aria-label="API Activity">
          <h2>API Activity</h2>
          <div className="op-kpi-row provider-kpi-row">
            <KPIStatCard label="Audited requests (24h)" value={requestsLast24h} detail="Valid client audit logs" tone="info" />
            <KPIStatCard label="Rate limited (24h)" value={rateLimitedLast24h} detail="HTTP 429 responses" tone={rateLimitedLast24h ? 'warning' : 'neutral'} />
          </div>
        </section>
      </div>

      {isError && !data ? (
        <SectionErrorRetry
          title="Integration clients unavailable"
          description={error ?? 'Integration client data could not be loaded.'}
          onRetry={() => void refetch()}
        />
      ) : pageReadiness.status === 'unauthorized' ? (
        <SectionErrorRetry
          title="Sign in required"
          description="An authenticated admin session is required to load integration clients."
          onRetry={() => void refetch()}
        />
      ) : isLoading ? (
        <SectionSkeleton title="Loading integration clients" description="Reading integration client metadata and audit logs." />
      ) : null}

      {!isLoading && !isError && !providers.length ? (
        <EmptyStatePanel title="No integration clients" description="No vendor integration clients are registered yet." />
      ) : null}

      {providers.length ? (
        <div className="attention-layout provider-management-layout">
          <main className="attention-main-column">
            <article className="attention-card">
              <div className="attention-card-heading">
                <div>
                  <p className="eyebrow">Vendor Integrations</p>
                  <h3>Integration clients</h3>
                  <span>Token values are not recoverable and are never shown.</span>
                </div>
              </div>
              <div className="provider-card-list" aria-label="Integration client list">
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
                        <div className="provider-card-identity">
                          <h4>{provider.providerName}</h4>
                          <StatusBadge tone={state.tone}>{state.label}</StatusBadge>
                        </div>
                        <div className="provider-card-field">
                          <span>Vendor</span>
                          <strong>{provider.vendorIdentifier}</strong>
                        </div>
                      </div>
                      <div className="provider-card-body">
                        <PermissionChips provider={provider} />
                      </div>
                      <div className="provider-card-metrics">
                        <div>
                          <span>Last activity</span>
                          <strong>{formatDate(getLastActivity(provider))}</strong>
                        </div>
                        <div>
                          <span>Requests 24h</span>
                          <strong>{provider.requestsLast24h}</strong>
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
              <article className="attention-card provider-detail-card" aria-label="Integration Client">
                <div className="attention-card-heading provider-client-heading">
                  <div>
                    <p className="eyebrow">Integration Client</p>
                    <h3>Current Client</h3>
                  </div>
                  <div className="provider-detail-actions">
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

                <section className="provider-detail-section" aria-label="Current access">
                  <div className="provider-detail-section-heading">
                    <h4>Current Access</h4>
                  </div>
                  <PermissionChips provider={selectedProvider} />
                </section>

                <section className="provider-detail-section" aria-label="Activity summary">
                  <div className="provider-detail-section-heading">
                    <h4>Activity</h4>
                  </div>
                  <div className="provider-summary-grid provider-activity-summary-grid">
                    <div>
                      <span>Last activity</span>
                      <strong>{formatDate(getLastActivity(selectedProvider))}</strong>
                    </div>
                    <div>
                      <span>Requests 24h</span>
                      <strong>{selectedProvider.requestsLast24h}</strong>
                    </div>
                    <div>
                      <span>Rate limited 24h</span>
                      <strong>{selectedProvider.rateLimitedLast24h}</strong>
                    </div>
                  </div>
                </section>

                <section className="provider-detail-section" aria-label="Recent Activity">
                  <div className="provider-detail-section-heading">
                    <h4>Recent Activity</h4>
                  </div>
                  {selectedProvider.recentAuditLogs.length ? (
                    <div className="provider-activity-list">
                      {groupRecentActivity(selectedProvider.recentAuditLogs).map((group) => (
                        <section className="provider-activity-day" key={group.key} aria-label={group.label}>
                          <h5>{group.label}</h5>
                          {groupConsecutiveActivityByTimestamp(group.logs).map((timestampGroup) => (
                            <section className="provider-activity-time-group" key={timestampGroup.key} aria-label={timestampGroup.label}>
                              <div className="provider-activity-time-heading">
                                <span>{timestampGroup.label}</span>
                                <span aria-hidden="true">▾</span>
                              </div>
                              <div className="provider-activity-time-events">
                                {timestampGroup.logs.map((log, logIndex) => {
                                  const result = getActivityStatus(log.statusCode);
                                  return (
                                    <div className="provider-activity-row" key={`${log.createdAt}-${log.requestId ?? log.path}-${log.statusCode}-${logIndex}`}>
                                      <div className="provider-activity-main">
                                        <span className="provider-activity-icon" aria-hidden="true">{getActivityIcon(log)}</span>
                                        <div>
                                          <strong>{getActivityAction(log)}</strong>
                                        </div>
                                        <StatusBadge tone={result.tone}>{result.label}</StatusBadge>
                                        <details className="provider-activity-technical">
                                          <summary>Details</summary>
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
                                    </div>
                                  );
                                })}
                              </div>
                            </section>
                          ))}
                        </section>
                      ))}
                    </div>
                  ) : (
                    <EmptyStatePanel title="No client activity recorded yet." description="Provider API requests will appear here after they are recorded." />
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
              <EmptyStatePanel title="Select an integration client to view details." description="Client summary and activity appear after a client is selected." />
            )}
          </aside>
        </div>
      ) : null}
    </section>
  );
}
