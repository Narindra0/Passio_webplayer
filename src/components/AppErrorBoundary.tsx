import React, { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = { children: ReactNode };
type State = { hasError: boolean };

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('AppErrorBoundary', error.message, info.componentStack);
  }

  private handleRetry = () => {
    this.setState({ hasError: false });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 32,
          backgroundColor: '#000',
          color: '#fff',
          minHeight: '100vh',
          flexDirection: 'column',
          gap: 16,
          textAlign: 'center',
        }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Une erreur est survenue</h2>
          <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 15, lineHeight: '22px', maxWidth: 400 }}>
            L'application a rencontré un problème inattendu.
          </p>
          <button
            onClick={this.handleRetry}
            style={{
              backgroundColor: 'var(--color-primary-light)',
              color: '#fff',
              padding: '14px 28px',
              borderRadius: 24,
              border: 'none',
              fontSize: 16,
              fontWeight: 600,
              cursor: 'pointer',
              marginTop: 12,
            }}
          >
            Réessayer
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
