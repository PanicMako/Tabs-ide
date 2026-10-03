import { Component, type ErrorInfo, type ReactNode } from "react";
import { CircleAlertIcon, RefreshCwIcon } from "lucide-react";

import { Button } from "./ui/button";

interface ToolErrorBoundaryProps {
  readonly children: ReactNode;
  readonly resetKey: string;
}

interface ToolErrorBoundaryState {
  readonly error: Error | null;
}

export class ToolErrorBoundary extends Component<ToolErrorBoundaryProps, ToolErrorBoundaryState> {
  override state: ToolErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): ToolErrorBoundaryState {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[workspace-tool] render failed", error, info.componentStack);
  }

  override componentDidUpdate(previousProps: ToolErrorBoundaryProps): void {
    if (this.state.error && previousProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  private readonly retry = () => this.setState({ error: null });

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex h-full min-h-0 items-center justify-center overflow-auto p-6">
        <section
          className="w-full max-w-lg rounded-xl border border-destructive/35 bg-card p-5 shadow-sm"
          role="alert"
        >
          <div className="flex items-start gap-3">
            <CircleAlertIcon className="mt-0.5 size-5 shrink-0 text-destructive" />
            <div className="min-w-0 flex-1">
              <h2 className="font-semibold">This workspace tool stopped unexpectedly</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                The rest of Tabs is still running. Retry this panel or switch to another tool.
              </p>
              <pre className="mt-3 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
                {this.state.error.message}
              </pre>
              <Button className="mt-4" size="sm" onClick={this.retry}>
                <RefreshCwIcon className="size-3.5" />
                Retry panel
              </Button>
            </div>
          </div>
        </section>
      </div>
    );
  }
}
