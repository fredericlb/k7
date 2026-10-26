// processes.ts — every process the project bar's list shows: the file service's (commands past a second,
// a verb's background work), mirrored from the `/workspace` poll, and the ones this page runs itself (a
// video export). Framework-free; the button reads it with useSyncExternalStore. See ../docs/processes.md.

import type { ServiceProcess } from "@studio/web-protocol";

/** One row of the list; `local` is this page's own work, which no poll reports. */
export interface ShownProcess extends ServiceProcess {
  local?: true;
}

/** How long this page's ended work stays listed — the file service keeps its own as long. */
export const LINGER_MS = 8000;

let service: readonly ServiceProcess[] = [];
let local: readonly ShownProcess[] = [];
let merged: readonly ShownProcess[] = [];
let counter = 0;
const listeners = new Set<() => void>();

function commit(): void {
  merged = [...service, ...local].sort((a, b) => a.startedAt - b.startedAt);
  for (const l of listeners) l();
}

export function subscribeProcesses(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function processesSnapshot(): readonly ShownProcess[] {
  return merged;
}

/** The file service's list as its last answer gives it; the same list again changes nothing. */
export function setServiceProcesses(list: readonly ServiceProcess[]): void {
  if (JSON.stringify(list) === JSON.stringify(service)) return;
  service = list;
  commit();
}

function patch(id: string, change: Partial<ShownProcess>): void {
  local = local.map((p) => (p.id === id ? { ...p, ...change } : p));
  commit();
}

/** One piece of this page's work: listed at once, told how far it is, then ended and kept a moment. */
export function trackProcess(label: string): {
  progress: (fraction: number | null, detail?: string) => void;
  end: (error?: string) => void;
} {
  const id = `local-${++counter}`;
  local = [
    ...local,
    { id, label, state: "running", startedAt: Date.now(), local: true },
  ];
  commit();
  return {
    progress: (fraction, detail) =>
      patch(id, {
        ...(fraction === null
          ? {}
          : { progress: Math.min(1, Math.max(0, fraction)) }),
        ...(detail === undefined ? {} : { detail }),
      }),
    end: (error) => {
      patch(id, {
        state: error ? "failed" : "done",
        endedAt: Date.now(),
        progress: undefined,
        detail: error,
      });
      setTimeout(() => {
        local = local.filter((p) => p.id !== id);
        commit();
      }, LINGER_MS);
    },
  };
}

/** How many are running: the badge on the bar's button. */
export const runningCount = (all: readonly ShownProcess[]): number =>
  all.filter((p) => p.state === "running").length;
