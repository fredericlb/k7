// GateProgress.tsx — the thin bar along the bottom of the window that says which step of opening
// a project is under way, in place of a full-screen wait. Drawn over whatever is behind it, so the
// project shows the moment it can. See docs/launch.md, "Waits as a bar".

import { Loader2 } from "@frediverse/ui/icons";

export function GateProgress({
  label,
  pct = null,
  stuck = false,
}: {
  /** The step, said in words. */
  label: string;
  /** 0–100 when the step is measured, null for a wait with no measure. */
  pct?: number | null;
  /** A wait that is not moving — drawn amber, with no motion. */
  stuck?: boolean;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col border-t border-border bg-background/95 text-xs backdrop-blur"
    >
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct ?? undefined}
        className="h-0.5 w-full overflow-hidden bg-muted"
      >
        <div
          className={
            stuck
              ? "h-full w-full bg-amber-500"
              : pct === null
                ? "h-full w-1/3 animate-pulse bg-primary"
                : "h-full bg-primary transition-all"
          }
          style={pct === null || stuck ? undefined : { width: `${pct}%` }}
        />
      </div>
      <div
        className={`flex items-center gap-2 px-3 py-1 ${stuck ? "text-amber-500" : "text-muted-foreground"}`}
      >
        {!stuck && <Loader2 className="h-3 w-3 shrink-0 animate-spin" />}
        <span className="truncate">{label}</span>
        {pct !== null && !stuck && (
          <span className="ml-auto tabular-nums">{pct}%</span>
        )}
      </div>
    </div>
  );
}

/** A wait with nothing to show behind it yet: the page's own background, and the bar. */
export function GateWait(props: Parameters<typeof GateProgress>[0]) {
  return (
    <div className="h-full bg-background">
      <GateProgress {...props} />
    </div>
  );
}
