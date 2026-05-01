import { Component, type ReactNode } from 'react';

interface State {
  error: Error | null;
}

export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          padding: '2rem',
          color: '#ef4444',
          backgroundColor: '#1e293b',
          minHeight: '100vh',
          fontFamily: 'monospace',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          fontSize: '14px',
        }}>
          <h1 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>Application Error</h1>
          <p style={{ color: '#94a3b8' }}>{this.state.error.message}</p>
          <p style={{ color: '#64748b', marginTop: '1rem', fontSize: '12px' }}>{this.state.error.stack}</p>
        </div>
      );
    }
    return this.props.children;
  }
}
