// ProcessesButton.tsx — the project bar's background processes, right of the project name: a spinner with
// the running count on it, and the list in a popover. Nothing at all while the list is empty. The list is
// ../processes.ts, the file service's processes and this page's own (docs/processes.md).

import { Button } from "@frediverse/ui/button";
import { Check, CircleAlert, Loader2 } from "@frediverse/ui/icons";
import { cn } from "@frediverse/ui/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@frediverse/ui/popover";
import { useEffect, useState, useSyncExternalStore } from "react";
import { m } from "../paraglide/messages.js";
import {
  processesSnapshot,
  runningCount,
  type ShownProcess,
  subscribeProcesses,
} from "../processes";

/** How long it has run, m:ss, the clock a transcription or a render is judged by. */
function elapsed(p: ShownProcess, now: number): string {
  const s = Math.max(0, Math.round(((p.endedAt ?? now) - p.startedAt) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function Row({ p, now }: { p: ShownProcess; now: number }) {
  const pct =
    p.state === "running" && p.progress !== undefined
      ? Math.floor(p.progress * 100)
      : null;
  const state =
    p.state === "failed"
      ? m["processes.failed"]()
      : p.state === "done"
        ? m["processes.done"]()
        : m["processes.running"]();
  const said = [
    pct === null ? state : `${pct} %`,
    p.detail,
    elapsed(p, now),
    p.local ? m["processes.here"]() : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <li className="flex items-center gap-2 rounded px-2 py-1.5">
      <span className="min-w-0 flex-1">
        <span className="block truncate font-mono text-xs" title={p.label}>
          {p.label}
        </span>
        <span
          className={cn(
            "block truncate text-[11px]",
            p.state === "failed" ? "text-destructive" : "text-muted-foreground",
          )}
          title={said}
        >
          {said}
        </span>
        {pct !== null && (
          <span className="mt-1 block h-1 overflow-hidden rounded bg-muted">
            <span
              className="block h-full bg-primary"
              style={{ width: `${pct}%` }}
            />
          </span>
        )}
      </span>
      {p.state === "running" ? (
        <Loader2 className="size-3.5 shrink-0 animate-spin" />
      ) : p.state === "done" ? (
        <Check className="size-3.5 shrink-0 text-emerald-500" />
      ) : (
        <CircleAlert className="size-3.5 shrink-0 text-destructive" />
      )}
    </li>
  );
}

/** The bar's button and its popover; `size` is the bar's tool size, smaller on a desktop. */
export function ProcessesButton({
  size = "icon-xs",
}: {
  size?: "icon" | "icon-xs";
}) {
  const all = useSyncExternalStore(subscribeProcesses, processesSnapshot);
  const running = runningCount(all);
  const failed = all.some((p) => p.state === "failed");
  // A second's tick while something runs, so the elapsed times move.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running, all]);
  if (all.length === 0) return null;
  const label = m["processes.title"]({ running });
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          size={size}
          variant="ghost"
          className="relative shrink-0"
          aria-label={label}
          title={label}
        >
          {running > 0 ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : failed ? (
            <CircleAlert className="size-3.5 text-destructive" />
          ) : (
            <Check className="size-3.5 text-emerald-500" />
          )}
          {running > 0 && (
            <span className="absolute -right-1 -top-1 rounded-full bg-primary px-1 font-semibold text-[10px] text-primary-foreground tabular-nums leading-4">
              {running}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[min(24rem,calc(100vw-1.5rem))] p-1"
      >
        <div className="px-2 py-1.5 font-medium text-sm">
          {m["processes.heading"]()}
        </div>
        <ul className="max-h-80 overflow-auto">
          {all.map((p) => (
            <Row key={p.id} p={p} now={now} />
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
