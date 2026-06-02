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
              <OperationalTable
                columns={['State', 'Provider', 'Vendor', 'Scopes', 'Last used', 'Requests 24h', '429 24h']}
                className="provider-management-table"
              >
                {providers.map((provider) => {
                  const state = getProviderState(provider);
                  return (
                    <OperationalTableRow
                      key={provider.clientId}
                      selected={provider.clientId === selectedProvider?.clientId}
                      onSelect={() => setSelectedClientId(provider.clientId)}
                    >
                      <StatusBadge tone={state.tone}>{state.label}</StatusBadge>
                      <span>
                        <strong>{provider.providerName}</strong>
                        <small>{provider.clientId}</small>
                      </span>
                      <strong>{provider.vendorIdentifier}</strong>
                      <span>{formatScopes(provider.scopes)}</span>
                      <span>{formatDate(provider.lastUsedAt)}</span>
                      <strong>{provider.requestsLast24h}</strong>
                      <strong>{provider.rateLimitedLast24h}</strong>
                    </OperationalTableRow>
                  );
                })}
              </OperationalTable>
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
                <MetadataGroup>
                  <MetadataRow label="Client id" value={selectedProvider.clientId} />
                  <MetadataRow label="Scopes" value={formatScopes(selectedProvider.scopes)} />
                  <MetadataRow label="Created" value={formatDate(selectedProvider.createdAt)} />
                  <MetadataRow label="Updated" value={formatDate(selectedProvider.updatedAt)} />
                  <MetadataRow label="Last used" value={formatDate(selectedProvider.lastUsedAt)} />
                  <MetadataRow label="Last request" value={formatDate(selectedProvider.lastRequestAt)} />
                  <MetadataRow label="Auth failures 24h" value={selectedProvider.authFailuresLast24h ?? 'Not derivable'} />
                  <MetadataRow label="Revoked at" value={formatDate(selectedProvider.revokedAt)} />
                </MetadataGroup>

                <div className="attention-card-heading">
                  <div>
                    <p className="eyebrow">Audit logs</p>
                    <h3>Recent requests</h3>
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
                  <EmptyStatePanel title="No audit logs" description="No recent provider API requests were recorded for this client." />
                )}
              </article>
            ) : null}
          </aside>
        </div>
      ) : null}
    </section>
  );
}
