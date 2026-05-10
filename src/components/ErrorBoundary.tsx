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
        <section className="dashboard state-workspace">
          <div className="hero-card operational-card state-card state-error">
            <div className="state-copy">
              <p className="eyebrow">Dashboard recovery</p>
              <div className="state-title-row">
                <h2>Something went wrong</h2>
              </div>
              <p className="page-description">
                An unexpected rendering error stopped this dashboard section. Reload to recover.
              </p>
            </div>
            <div className="state-actions">
              <button type="button" className="button button-primary" onClick={this.handleRetry}>
                Reload dashboard
              </button>
            </div>
          </div>
        </section>
      );
    }

    return this.props.children;
  }
}
