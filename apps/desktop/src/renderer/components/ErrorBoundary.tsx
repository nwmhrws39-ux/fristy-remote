import { Component, type ErrorInfo, type ReactNode } from 'react';

/** Keeps one broken page from blanking the whole window. */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('page crashed', error, info.componentStack);
  }

  componentDidUpdate(prev: { resetKey?: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="rounded-2xl border border-bad/40 bg-bad/10 p-5 text-sm">
        <div className="font-bold text-bad">Something went wrong on this page.</div>
        <div className="mt-1 font-mono text-xs text-muted" dir="ltr">
          {this.state.error.message}
        </div>
        <button className="mt-3 rounded-xl border border-line px-3 py-1.5 font-semibold hover:bg-elevated" onClick={() => this.setState({ error: null })}>
          Try again
        </button>
      </div>
    );
  }
}
