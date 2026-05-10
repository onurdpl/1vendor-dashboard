import { useEffect, useMemo, useState } from 'react';
import { ActionFeedback } from '../components/ActionFeedback';
import { useActionFeedback } from '../lib/ui';
import { buildDashboardOverview } from '../lib/api/dashboard';
import { getCurrentVendorContext, onVendorChange } from '../lib/auth';

export function DashboardPage() {
  const [vendorId, setVendorId] = useState(() => getCurrentVendorContext().vendorId);
  const dashboard = useMemo(() => buildDashboardOverview(vendorId), [vendorId]);
  const { message, tone, showFeedback } = useActionFeedback();

  useEffect(() => {
    return onVendorChange(() => {
      setVendorId(getCurrentVendorContext().vendorId);
    });
  }, []);

  return (
    <section className="dashboard">
      <div className="hero-card">
        <div>
          <p className="eyebrow">Dashboard</p>
          <h2>{dashboard.title}</h2>
          <p className="page-description">{dashboard.description}</p>
        </div>
        <button
          className="button button-secondary"
          type="button"
          onClick={() => showFeedback(`Task drafted for ${dashboard.vendorName} review.`, 'success')}
        >
          Create task
        </button>
      </div>

      <div className="stats-grid">
        {dashboard.stats.map((stat) => (
          <article key={stat.label} className="stat-card">
            <span>{stat.label}</span>
            <strong>{stat.value}</strong>
          </article>
        ))}
      </div>

      <div className="content-grid">
        <article className="panel">
          <h3>Recent activity</h3>
          <ul className="list">
            {dashboard.recentActivity.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>

        <article className="panel">
          <h3>Workspace status</h3>
          <p>{dashboard.workspaceStatus}</p>
        </article>
      </div>

      {message ? <ActionFeedback tone={tone} message={message} /> : null}
    </section>
  );
}
