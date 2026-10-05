import { Component, type ErrorInfo, type ReactNode } from "react";

import { LoadErrorPanel, OfflineFallbackActions } from "./LoadStatusPanel";
import type { ViewState } from "../lib/viewState";

type Props = {
  children: ReactNode;
  resetKey: string;
  onNavigate: (view: ViewState["view"], patch?: Partial<ViewState>) => void;
};

type State = { error: Error | null };

export class RouteErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Control Atlas route render failed", error, info.componentStack);
  }

  componentDidUpdate(previous: Props) {
    if (this.state.error && previous.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <LoadErrorPanel
        renderFailed
        message="This workspace stopped unexpectedly. The rest of Control Atlas is still available."
        onRetry={() => window.location.reload()}
      >
        <OfflineFallbackActions onNavigate={(view) => this.props.onNavigate(view)} />
      </LoadErrorPanel>
    );
  }
}
