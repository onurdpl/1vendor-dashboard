import { useActionFeedback } from '../lib/ui';
import { ActionFeedback } from '../components/ActionFeedback';

const stats = [
  { label: 'Open tickets', value: '18' },
  { label: 'Pending payouts', value: '7' },
  { label: 'Vendor checks', value: '24' },
];

export function DashboardPage() {
  const { message, tone, showFeedback } = useActionFeedback();

  return (
    <section className="dashboard">
      <div className="hero-card">
        <div>
          <p className="eyebrow">Dashboard</p>
          <h2>Command center for daily operations</h2>
          <p className="page-description">
            Track vendor activity, support workload, and finance status from one place.
          </p>
        </div>
        <button
          className="button button-secondary"
          type="button"
          onClick={() => showFeedback('Task drafted for operations review.', 'success')}
        >
          Create task
        </button>
      </div>

      <div className="stats-grid">
        {stats.map((stat) => (
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
            <li>Vendor onboarding queue updated</li>
            <li>Support escalation acknowledged</li>
            <li>Finance review scheduled</li>
          </ul>
        </article>

        <article className="panel">
          <h3>Workspace status</h3>
          <p>
            This foundation is ready for authenticated sessions, role-specific modules, and live
            data integration in later phases.
          </p>
        </article>
      </div>

      {message ? <ActionFeedback tone={tone} message={message} /> : null}
    </section>
  );
}
