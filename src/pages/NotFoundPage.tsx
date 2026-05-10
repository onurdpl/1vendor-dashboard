import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <section className="dashboard state-workspace">
      <div className="hero-card operational-card state-card state-empty">
        <div className="state-copy">
          <p className="eyebrow">Not Found</p>
          <div className="state-title-row">
            <h2>Page not found</h2>
          </div>
          <p className="page-description">This route is not available in the current operational workspace.</p>
        </div>
        <div className="state-actions">
          <Link className="button button-primary button-link" to="/">
            Return to dashboard
          </Link>
          <Link className="button button-secondary button-link" to="/login">
            Go to login
          </Link>
        </div>
      </div>
    </section>
  );
}
