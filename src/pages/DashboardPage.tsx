import { useEffect, useMemo, useState } from 'react';
import { ActionFeedback } from '../components/ActionFeedback';
import { useActionFeedback } from '../lib/ui';
import { buildDashboardOverview } from '../lib/api/dashboard';
import { getCurrentUser, getCurrentVendorContext, onVendorChange } from '../lib/auth';
import { useQueryResource } from '../hooks/useQueryResource';
import { listOrders } from '../features/orders/api';
import { listReturns } from '../features/returns/api';
import { getFinanceDashboard } from '../features/finance/api';
import { getAutomationDashboard } from '../features/automation/api';
import { queryKeys } from '../lib/api/queryKeys';

export function DashboardPage() {
  const [vendorId, setVendorId] = useState(() => getCurrentVendorContext().vendorId);
  const currentUser = getCurrentUser();
  const dashboard = useMemo(() => buildDashboardOverview(vendorId), [vendorId]);
  const { message, tone } = useActionFeedback();
  const { data: orders = [] } = useQueryResource(queryKeys.orders.list(), listOrders);
  const { data: returns = [] } = useQueryResource(queryKeys.returns.list(), listReturns);
  const { data: finance } = useQueryResource(queryKeys.finance.summary(), getFinanceDashboard);
  const { data: automation } = useQueryResource(queryKeys.automation.alerts(), getAutomationDashboard);

  useEffect(() => {
    return onVendorChange(() => {
      setVendorId(getCurrentVendorContext().vendorId);
    });
  }, []);

  const ordersList = orders ?? [];
  const returnsList = returns ?? [];

  const awaitingShipmentCount = ordersList.filter((order) => order.shippingStatus === 'Awaiting Shipment').length;
  const blockedCount = ordersList.filter(
    (order) => order.allocationStatus === 'pending_reassignment' || order.allocationStatus === 'vendor_blocked',
  ).length;
  const fulfilledCount = ordersList.filter((order) => order.fulfillmentStatus === 'Fulfilled').length;
  const activeRefundCount = returnsList.filter((item) => item.status === 'Pending' || item.status === 'In Review').length;
  const unresolvedAlerts = (automation?.alerts ?? []).filter((alert) => alert.status !== 'Resolved').length;

  const priorityWork = [
    { label: 'Blocked allocations', value: blockedCount, tone: 'severity-warning' },
    { label: 'Awaiting shipment', value: awaitingShipmentCount, tone: 'severity-attention' },
    { label: 'Refund attention', value: activeRefundCount, tone: 'severity-warning' },
    { label: 'Automation signals', value: unresolvedAlerts, tone: 'severity-normal' },
  ];

  return (
    <section className="dashboard dashboard-workspace">
      <div className="hero-card operational-card dashboard-header">
        <div className="queue-header-copy">
          <p className="eyebrow">Dashboard</p>
          <h2>{dashboard.vendorName} operational overview</h2>
          <p className="page-description">
            {currentUser?.role === 'admin'
              ? 'Vendor-scoped control view. Cross-vendor escalations are handled in Operations Queue.'
              : 'Your fulfillment workspace for current vendor operations.'}
          </p>
        </div>
        <div className="queue-health">
          <span className="severity-chip severity-normal">Vendor {dashboard.vendorName}</span>
          <span className="severity-chip severity-attention">Awaiting shipment {awaitingShipmentCount}</span>
          <span className="severity-chip severity-warning">Needs attention {blockedCount + activeRefundCount}</span>
        </div>
      </div>

      <div className="stats-grid queue-stats">
        <article className="stat-card operational-card">
          <span>Orders</span>
          <strong>{ordersList.length}</strong>
        </article>
        <article className="stat-card operational-card">
          <span>Awaiting shipment</span>
          <strong>{awaitingShipmentCount}</strong>
        </article>
        <article className="stat-card operational-card">
          <span>Blocked / needs attention</span>
          <strong>{blockedCount + activeRefundCount}</strong>
        </article>
        <article className="stat-card operational-card">
          <span>Payout estimate</span>
          <strong>{finance?.summary.payoutEstimate ?? '—'}</strong>
        </article>
      </div>

      <div className="content-grid dashboard-grid">
        <article className="panel operational-card">
          <h3>Priority work</h3>
          <div className="queue-list">
            {priorityWork.map((item) => (
              <article key={item.label} className="queue-item queue-medium">
                <header className="queue-item-top">
                  <h4>{item.label}</h4>
                  <span className={`severity-chip ${item.tone}`}>{item.value}</span>
                </header>
              </article>
            ))}
          </div>
        </article>

        <article className="panel operational-card">
          <h3>Finance snapshot</h3>
          <div className="allocation-summary-grid">
            <div className="summary-row">
              <span>Gross sales</span>
              <strong>{finance?.summary.grossSales ?? '—'}</strong>
            </div>
            <div className="summary-row">
              <span>Refunds</span>
              <strong>{finance?.summary.refunds ?? '—'}</strong>
            </div>
            <div className="summary-row">
              <span>Net revenue</span>
              <strong>{finance?.summary.netRevenue ?? '—'}</strong>
            </div>
            <div className="summary-row">
              <span>Payout estimate</span>
              <strong>{finance?.summary.payoutEstimate ?? '—'}</strong>
            </div>
          </div>
        </article>
      </div>

      <div className="content-grid dashboard-grid">
        <article className="panel operational-card">
          <h3>Recent activity</h3>
          {dashboard.recentActivity.length === 0 ? (
            <div className="queue-empty">
              <p className="page-description">No recent activity for the current vendor.</p>
            </div>
          ) : (
            <ul className="list">
              {dashboard.recentActivity.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
        </article>
        <article className="panel operational-card">
          <h3>Operational signals</h3>
          {(automation?.alerts ?? []).length === 0 ? (
            <div className="queue-empty">
              <p className="page-description">No active automation signals right now.</p>
            </div>
          ) : (
            <div className="queue-list">
              {(automation?.alerts ?? []).slice(0, 4).map((alert) => (
                <article key={alert.id} className="queue-item queue-low">
                  <header className="queue-item-top">
                    <h4>{alert.source}</h4>
                    <span className={`status-badge status-${alert.status.toLowerCase().replace(/\s+/g, '-')}`}>
                      {alert.status}
                    </span>
                  </header>
                  <p className="queue-description">{alert.message}</p>
                </article>
              ))}
            </div>
          )}
        </article>
      </div>

      <article className="panel operational-card">
        <h3>Workspace status</h3>
        <p>{dashboard.workspaceStatus}</p>
      </article>

      {message ? <ActionFeedback tone={tone} message={message} /> : null}
    </section>
  );
}
