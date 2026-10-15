import React from 'react';
import { reportError } from './report';

type Props = { app: 'passenger' | 'driver' | 'admin' | 'unknown'; children: React.ReactNode };

/** Last line of defence: a screen crash shows a friendly page with a reload button instead of a blank screen. */
export default class ErrorBoundary extends React.Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    reportError(this.props.app, error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="min-h-screen bg-bg-deep text-white flex flex-col items-center justify-center p-6 text-center gap-4" role="alert">
        <h1 className="text-lg font-bold">Something went wrong</h1>
        <p className="text-sm text-text-muted max-w-xs">We have been told about the problem. Reload to carry on. If you are in the middle of a ride, it is still running.</p>
        <button className="btn-primary px-6 py-2.5 text-sm" onClick={() => window.location.reload()}>Reload</button>
      </div>
    );
  }
}
