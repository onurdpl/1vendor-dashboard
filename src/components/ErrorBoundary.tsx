import type { ReactNode } from 'react';
import React from 'react';

type ErrorBoundaryProps = {
  children: ReactNode;
};

type ErrorBoundaryState = {
  hasError: boolean;
};

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    hasError: false,
  };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(error, info);
  }

  handleRetry = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="auth-page">
          <section className="auth-panel">
            <p className="eyebrow">Dashboard error</p>
            <h1>Something went wrong</h1>
            <p className="page-description">
              The dashboard could not render. Reload the page to try again.
            </p>
            <button type="button" className="button button-primary" onClick={this.handleRetry}>
              Retry
            </button>
          </section>
        </div>
      );
    }

    return this.props.children;
  }
}
