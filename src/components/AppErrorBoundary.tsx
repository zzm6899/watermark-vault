import { Component, type ErrorInfo, type ReactNode } from "react";

export default class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Uncaught application render error", error, info.componentStack);
  }

  render() {
    if (this.state.failed) {
      return (
        <main className="min-h-screen bg-background flex items-center justify-center p-4">
          <section role="alert" className="w-full max-w-lg rounded-xl border border-border bg-card p-6 text-center">
            <h1 className="font-display text-2xl text-foreground">We couldn’t load this page</h1>
            <p className="mt-2 text-sm text-muted-foreground">Something went wrong while opening PhotoFlow. Reload the page to try again.</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-5 inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground"
            >
              Reload page
            </button>
          </section>
        </main>
      );
    }
    return this.props.children;
  }
}
