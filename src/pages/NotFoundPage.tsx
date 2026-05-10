import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <div className="auth-page">
      <section className="auth-panel">
        <p className="eyebrow">404</p>
        <h1>Page not found</h1>
        <p className="page-description">
          The route you requested does not exist in this dashboard shell.
        </p>
        <Link className="button button-primary button-link" to="/">
          Return to dashboard
        </Link>
      </section>
    </div>
  );
}
