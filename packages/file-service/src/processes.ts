// processes.ts — what this account's file service is busy with, listed on the `/workspace` poll for the
// project bar's process list: a command still running past a second, and the work a verb started in the
// background. The running one rides an AsyncLocalStorage, so code deep inside it (a separation poll, a
// render's frames) reports its progress without being handed anything. See docs/background.md.

import { AsyncLocalStorage } from "node:async_hooks";
import type { ServiceProcess } from "@studio/web-protocol";

/** How long a command runs before it is listed: shorter ones would only blink the bar's button. */
export const SHOW_AFTER_MS = 1000;
/** How long an ended process stays listed, so a two-second poll sees how it ended. */
export const LINGER_MS = 8000;

/** What code running inside a process may say about it. */
export interface ProcessHandle {
  /** How far it is, 0..1 (null leaves it unknown), and a word on where it stands. */
  progress(fraction: number | null, detail?: string): void;
}

interface Entry extends ServiceProcess {
  shownAt: number;
}

const entries = new Map<string, Entry>();
const current = new AsyncLocalStorage<ProcessHandle>();
let counter = 0;

/** The process the calling code runs inside, if any. */
export const currentProcess = (): ProcessHandle | undefined =>
  current.getStore();

function end(e: Entry, error?: string): void {
  e.state = error ? "failed" : "done";
  e.endedAt = Date.now();
  if (error) e.detail = error;
  else delete e.detail;
  delete e.progress;
  // Over before it was ever shown: nothing to tell.
  if (e.endedAt < e.shownAt) entries.delete(e.id);
}

/** Run `work` as a listed process; `failed` reads a refusal out of a result that did not throw. */
export async function runAsProcess<T>(
  label: string,
  work: () => Promise<T>,
  opts: { showAfterMs?: number; failed?: (v: T) => string | undefined } = {},
): Promise<T> {
  const startedAt = Date.now();
  const e: Entry = {
    id: `p${++counter}`,
    label,
    state: "running",
    startedAt,
    shownAt: startedAt + (opts.showAfterMs ?? 0),
  };
  entries.set(e.id, e);
  const handle: ProcessHandle = {
    progress: (fraction, detail) => {
      if (fraction !== null) e.progress = Math.min(1, Math.max(0, fraction));
      if (detail !== undefined) e.detail = detail;
    },
  };
  try {
    const v = await current.run(handle, work);
    end(e, opts.failed?.(v));
    return v;
  } catch (err) {
    end(e, err instanceof Error ? err.message : String(err));
    throw err;
  }
}

/** The processes to show now, oldest first; the ones ended longer ago than LINGER_MS are forgotten. */
export function listProcesses(now = Date.now()): ServiceProcess[] {
  const out: ServiceProcess[] = [];
  for (const [id, e] of entries) {
    if (e.endedAt !== undefined && now - e.endedAt > LINGER_MS) {
      entries.delete(id);
      continue;
    }
    if (e.shownAt > now) continue;
    const { shownAt: _, ...shown } = e;
    out.push(shown);
  }
  return out;
}

/** A background tag as a person reads it: the absolute path ending it shortened to its file name. */
export const tagLabel = (tag: string): string =>
  tag.replace(/\s(?:[A-Za-z]:)?[\\/].*[\\/]/, " ");
