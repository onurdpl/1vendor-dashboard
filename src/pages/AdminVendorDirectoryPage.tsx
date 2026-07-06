import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  EmptyStatePanel,
  KPIStatCard,
  OperationalTable,
  OperationalTableRow,
  OperationalToolbar,
  SearchInput,
  SectionErrorRetry,
  SectionSkeleton,
  StatusBadge,
} from '../components/OperationalPrimitives';
import { useQueryResource } from '../hooks/useQueryResource';
import { useAppReadiness } from '../lib/appReadiness';
import { queryKeys } from '../lib/api/queryKeys';
import { getPageReadinessState } from '../lib/pageReadiness';
import type { VendorDirectoryItem, VendorDirectoryStatusFilter } from '../lib/api/contracts';
import { runtimeServices } from '../services/runtime-services';
import { formatDateTime, parseSafeDate, safeArray } from '../services/real/formatting';

const STATUS_OPTIONS: Array<{ value: VendorDirectoryStatusFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'restricted', label: 'Restricted' },
];

function formatDate(value: string | null | undefined) {
  return formatDateTime(value, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }, '—');
}

function getStatusTone(statusLabel: VendorDirectoryItem['statusLabel']) {
  return statusLabel === 'Active' ? 'success' as const : 'attention' as const;
}

function isRecentlyUpdated(value: string | null | undefined) {
  const date = parseSafeDate(value);
  if (!date) {
    return false;
  }

  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  const ageMs = Date.now() - date.getTime();
  return ageMs >= 0 && ageMs <= sevenDaysMs;
}

function getDirectorySummary(vendors: VendorDirectoryItem[]) {
  return {
    total: vendors.length,
    active: vendors.filter((vendor) => vendor.statusLabel === 'Active').length,
    restricted: vendors.filter((vendor) => vendor.statusLabel === 'Restricted').length,
    recentlyUpdated: vendors.filter((vendor) => isRecentlyUpdated(vendor.updatedAt)).length,
  };
}

export function AdminVendorDirectoryPage() {
  const navigate = useNavigate();
  const appReadiness = useAppReadiness();
  const pageReadiness = getPageReadinessState(appReadiness, {
    requiresVendorContext: false,
  });
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<VendorDirectoryStatusFilter>('all');
  const normalizedSearch = search.trim();
  const query = useQueryResource(
    queryKeys.admin.vendors.directory(normalizedSearch, statusFilter),
    ({ signal }) =>
      runtimeServices.vendors.directory({
        signal,
        search: normalizedSearch || null,
        status: statusFilter,
      }),
    {
      enabled: pageReadiness.ready,
      routeName: 'Admin vendor directory',
      endpoint: '/admin/vendors',
    },
  );
  const vendors = safeArray(query.data?.vendors);
  const summary = useMemo(() => getDirectorySummary(vendors), [vendors]);
  const hasActiveFilter = Boolean(normalizedSearch) || statusFilter !== 'all';
  const emptyTitle = hasActiveFilter ? 'No vendors match this search.' : 'No vendors found.';
  const emptyDescription = hasActiveFilter
    ? 'Clear search or status filters to view the full vendor directory.'
    : 'Create a vendor to begin onboarding a marketplace seller.';

  function clearFilters() {
    setSearch('');
    setStatusFilter('all');
  }

  return (
    <section className="op-page admin-vendor-directory-page">
      <div className="op-page-heading">
        <div>
          <p className="eyebrow">ADMIN WORKSPACE</p>
          <h1>Vendors</h1>
          <p className="page-description">
            Manage marketplace sellers, onboarding status, and vendor workspaces.
          </p>
        </div>
        <div className="op-heading-meta">
          <Link className="button button-primary" to="/admin/vendors/new">
            Create Vendor
          </Link>
        </div>
      </div>

      <div className="op-kpi-row">
        <KPIStatCard label="Total vendors" value={summary.total} detail="Directory results" tone="info" />
        <KPIStatCard label="Active" value={summary.active} detail="Operational accounts" tone={summary.active ? 'success' : 'neutral'} />
        <KPIStatCard label="Restricted" value={summary.restricted} detail="Onboarding or read-only" tone={summary.restricted ? 'attention' : 'neutral'} />
        <KPIStatCard label="Recently updated" value={summary.recentlyUpdated} detail="Last 7 days" tone={summary.recentlyUpdated ? 'info' : 'neutral'} />
      </div>

      <OperationalToolbar>
        <SearchInput
          aria-label="Search vendor ID or name"
          placeholder="Search vendor ID or name"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <label className="admin-vendor-directory-filter">
          <span>Status</span>
          <select
            aria-label="Vendor status filter"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as VendorDirectoryStatusFilter)}
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </OperationalToolbar>

      {pageReadiness.status === 'unauthorized' ? (
        <SectionErrorRetry
          title="Sign in required"
          description="An authenticated admin session is required to load vendors."
          onRetry={() => void query.refetch()}
        />
      ) : query.isError ? (
        <SectionErrorRetry
          title="Vendor directory unavailable"
          description={query.error ?? 'Vendor directory data could not be loaded.'}
          onRetry={() => void query.refetch()}
        />
      ) : query.isInitialLoading ? (
        <SectionSkeleton title="Loading vendors" description="Reading marketplace seller accounts." />
      ) : null}

      {!query.isInitialLoading && !query.isError && !vendors.length ? (
        <div className="admin-vendor-directory-empty">
          <EmptyStatePanel title={emptyTitle} description={emptyDescription} />
          <div className="op-action-group">
            {hasActiveFilter ? (
              <button type="button" className="button button-secondary" onClick={clearFilters}>
                Clear filters
              </button>
            ) : (
              <Link className="button button-primary" to="/admin/vendors/new">
                Create Vendor
              </Link>
            )}
          </div>
        </div>
      ) : null}

      {vendors.length ? (
        <OperationalTable
          columns={['Vendor', 'Status', 'Restriction reason', 'Updated', 'Action']}
          className="finance-op-table-v2 admin-vendor-directory-table"
          density="comfortable"
        >
          {vendors.map((vendor) => (
            <OperationalTableRow
              key={vendor.vendorId}
              onSelect={() => navigate(vendor.profileUrl)}
              className="admin-vendor-directory-row"
            >
              <span>
                <strong>{vendor.vendorName}</strong>
                <small>{vendor.vendorId}</small>
              </span>
              <span>
                <StatusBadge tone={getStatusTone(vendor.statusLabel)}>{vendor.statusLabel}</StatusBadge>
              </span>
              <span>
                <strong>{vendor.statusLabel === 'Restricted' ? vendor.restrictionReason ?? 'Unknown' : '—'}</strong>
              </span>
              <span>
                <strong>{formatDate(vendor.updatedAt)}</strong>
                <small>Created {formatDate(vendor.createdAt)}</small>
              </span>
              <span className="op-action-group">
                <span className="button button-secondary button-compact">Open Profile</span>
              </span>
            </OperationalTableRow>
          ))}
        </OperationalTable>
      ) : null}
    </section>
  );
}
