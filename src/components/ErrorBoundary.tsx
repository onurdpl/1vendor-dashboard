import type { ReactNode } from 'react';
import React from 'react';
import { captureFrontendError } from '../lib/sentry';

type ErrorBoundaryProps = {
  children: ReactNode;
  routeName?: string;
  eyebrow?: string;
  title?: string;
  description?: string;
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
    const context = {
      routeName: this.props.routeName ?? 'unknown',
      componentStack: info.componentStack,
    };
    captureFrontendError(error, context);
    console.error('[client-render-error]', {
      routeName: context.routeName,
      message: error.message,
      componentStack: context.componentStack,
    });
  }

  componentDidUpdate(previousProps: ErrorBoundaryProps) {
    if (this.state.hasError && previousProps.routeName !== this.props.routeName) {
      this.setState({ hasError: false });
    }
  }

  handleRetry = () => {
    this.setState({ hasError: false });
  };

  render() {
    if (this.state.hasError) {
      return (
        <section className="dashboard state-workspace">
          <div className="hero-card operational-card state-card state-error">
            <div className="state-copy">
              <p className="eyebrow">{this.props.eyebrow ?? 'Section recovery'}</p>
              <div className="state-title-row">
                <h2>{this.props.title ?? 'This section could not load'}</h2>
              </div>
              <p className="page-description">
                {this.props.description ?? 'An unexpected rendering error stopped this section. Retry without reloading the whole workspace.'}
              </p>
            </div>
            <div className="state-actions">
              <button type="button" className="button button-primary" onClick={this.handleRetry}>
                Retry section
              </button>
            </div>
          </div>
        </section>
      );
    }

    return this.props.children;
  }
}
