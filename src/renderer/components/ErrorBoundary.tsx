import { Component, type ErrorInfo, type ReactNode } from "react";

import { recordRendererError } from "../lib/errorDiagnostics";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = {
    hasError: false
  };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    recordRendererError(
      "reactErrorBoundary",
      error,
      info.componentStack
    );
    console.error("Renderer view failed", {
      message: error.message,
      componentStack: info.componentStack
    });
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div
          className="m-6 rounded-lg border border-app-danger/40 bg-app-danger/10 p-5"
          role="alert"
        >
          <h1 className="text-lg font-semibold text-app-danger">
            This view could not load
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-app-muted">
            CMM caught an interface error. Restart the app or check Diagnostics
            for the latest service state.
          </p>
        </div>
      );
    }

    return this.props.children;
  }
}
