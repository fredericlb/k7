// GitBusy.tsx — every git operation the page starts runs through `runGit`, which locks the page
// behind one centred overlay: what is happening in words, and a bar (measured when git says how
// far, sliding otherwise). Mount <GitBusyOverlay/> once per root. See ../../docs/projects.md § Git is blocking.
// The trap: the background status poll is NOT a git operation in this sense and must not use it.

import { Loader2 } from "@frediverse/ui/icons";
import { useEffect, useSyncExternalStore } from "react";
import { m } from "../paraglide/messages.js";

export interface GitBusyState {
  message: string;
  detail: string;
  percent: number | null;
}

/** What `runGit`'s body may say as it goes; a field left out keeps its last value. */
export type GitReport = (p: {
  detail?: string;
  percent?: number | null;
}) => void;

let current: GitBusyState | null = null;
let depth = 0;
const listeners = new Set<() => void>();
const emit = () => {
  for (const l of listeners) l();
};

/** Run `fn` with the page locked; nested calls keep the outer message and only update the detail. */
export async function runGit<T>(
  message: string,
  fn: (report: GitReport) => Promise<T>,
): Promise<T> {
  depth += 1;
  if (depth === 1) current = { message, detail: "", percent: null };
  else if (current) current = { ...current, detail: message, percent: null };
  emit();
  const report: GitReport = (p) => {
    if (!current) return;
    current = { ...current, ...p };
    emit();
  };
  try {
    return await fn(report);
  } finally {
    depth -= 1;
    if (depth === 0) current = null;
    emit();
  }
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

export function useGitBusy(): GitBusyState | null {
  return useSyncExternalStore(subscribe, () => current);
}

/** Swallows every key while git runs, so no shortcut starts a second write under the first. */
function useKeyLock(on: boolean): void {
  useEffect(() => {
    if (!on) return;
    (document.activeElement as HTMLElement | null)?.blur?.();
    const stop = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", stop, true);
    return () => window.removeEventListener("keydown", stop, true);
  }, [on]);
}

export function GitBusyOverlay() {
  const busy = useGitBusy();
  useKeyLock(busy !== null);
  if (!busy) return null;
  const measured = busy.percent !== null;
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-busy="true"
      aria-label={busy.message}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-background/70 backdrop-blur-sm"
    >
      <style>{"@keyframes git-busy-slide{0%{left:-40%}100%{left:100%}}"}</style>
      <div className="w-[min(28rem,calc(100vw-2rem))] rounded-lg border border-border bg-card p-5 shadow-xl">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium text-foreground">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
          <span>{busy.message}</span>
        </div>
        <div className="relative h-1.5 overflow-hidden rounded-full bg-muted">
          {measured ? (
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
              style={{ width: `${Math.min(100, busy.percent ?? 0)}%` }}
            />
          ) : (
            <div
              className="absolute top-0 h-full w-2/5 rounded-full bg-primary"
              style={{ animation: "git-busy-slide 1.2s ease-in-out infinite" }}
            />
          )}
        </div>
        <div className="mt-2 flex justify-between gap-2 text-xs text-muted-foreground">
          <span className="truncate">{busy.detail || m["git.wait"]()}</span>
          {measured && (
            <span className="shrink-0 tabular-nums">{busy.percent}%</span>
          )}
        </div>
      </div>
    </div>
  );
}
