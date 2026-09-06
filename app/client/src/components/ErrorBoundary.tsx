import { Component, type JSX, type ReactNode } from 'react';

// Display-only crash fallback: a malformed record must never white-screen the
// whole journal. Entries are safe (all writes go through the API); the button
// reloads into a clean render.
interface BoundaryProps {
  children: ReactNode;
}

interface BoundaryState {
  failed: boolean;
  detail: string;
}

export class ErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { failed: false, detail: '' };

  static getDerivedStateFromError(err: unknown): BoundaryState {
    return { failed: true, detail: err instanceof Error ? err.message : String(err) };
  }

  render(): JSX.Element | ReactNode {
    if (this.state.failed) {
      return (
        <main className="page">
          <header className="masthead">
            <h1>Grounded Journal</h1>
            <hr className="rule" />
          </header>
          <p role="alert">
            Something went wrong showing this view ({this.state.detail}). Your entries are safe —
            try again.
          </p>
          <button type="button" onClick={() => window.location.reload()}>
            Try again
          </button>
        </main>
      );
    }
    return this.props.children;
  }
}
