// PaneBoundary.tsx — what keeps one pane's fault in that pane. Every pane stays mounted, so
// without it a throw in a HIDDEN one unmounts the whole app; with it, the pane draws a card and
// the rest keeps playing. It resets on `resetKey` (a reload brings new data, worth a new try).
// See docs/shell.md, "A fault stays in its pane".

import { Component, type ReactNode } from "react";

interface Props {
  /** What the card and the log call this pane. */
  name: string;
  /** A change here clears the fault and renders the children again. */
  resetKey?: unknown;
  /** Told once per fault, for the shell's log. */
  onError?: (name: string, error: Error) => void;
  children: ReactNode;
}

interface State {
  error: Error | null;
  key: unknown;
}

export class PaneBoundary extends Component<Props, State> {
  state: State = { error: null, key: this.props.resetKey };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    // A new reload key is a new chance: the data that broke the pane may be gone.
    return props.resetKey !== state.key
      ? { key: props.resetKey, error: null }
      : null;
  }

  // The console gets it from createRoot's onCaughtError, with the component stack (appMain.tsx).
  componentDidCatch(error: Error): void {
    this.props.onError?.(this.props.name, error);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="flex h-full min-h-0 w-full items-center justify-center p-4">
        <div className="max-w-md rounded border border-destructive/40 bg-destructive/10 p-3 text-sm">
          <div className="font-medium text-destructive">
            {this.props.name} failed
          </div>
          <div className="mt-1 break-words text-muted-foreground text-xs">
            {error.message}
          </div>
          <button
            type="button"
            className="mt-2 rounded border border-border px-2 py-0.5 text-xs hover:bg-accent"
            onClick={() => this.setState({ error: null })}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }
}
