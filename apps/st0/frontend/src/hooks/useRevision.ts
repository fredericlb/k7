// useRevision — ONE poll of the file service's change token for the whole app: a 2s timer per
// consumer over /revision would be the same request several times over. A refcounted poller
// answers them all, and consumers react to the token rather than to a timer. It takes its fetch
// as an argument so the refcount and de-duplication are testable.

import { useSyncExternalStore } from "react";
import { api } from "../api";
import { pollWhileVisible } from "../visiblePoll";

/** How often the token is asked for. Reading it is a ~2 ms file walk on the service's side. */
export const REVISION_POLL_MS = 2000;

export interface RevisionPoller {
  /** Register a listener; the returned function unregisters it. The timer runs only while ≥1 is registered. */
  subscribe: (listener: () => void) => () => void;
  /** The last token read, or null while none has been. */
  get: () => string | null;
  /** Adopt a token the caller already holds, WITHOUT waking the listeners — only safe for a caller that has already reloaded the shell. */
  note: (rev: string) => void;
  /** A write nobody reloads for — a knob: silent only when it started from the token already seen, docs/shell.md. */
  noteQuiet: (rev: string, before?: string) => void;
  /** Counts quiet writes, for the few who must still see one (the open file, the history); its own listeners. */
  subscribeQuiet: (listener: () => void) => () => void;
  getQuiet: () => number;
}

export function createRevisionPoller(
  fetchRev: () => Promise<string>,
  intervalMs: number = REVISION_POLL_MS,
): RevisionPoller {
  let token: string | null = null;
  // What the tick compares against: the published token, or a quiet write's, which is never published.
  let seen: string | null = null;
  let quiet = 0;
  const quietListeners = new Set<() => void>();
  let timer: (() => void) | null = null;
  let inFlight = false;
  // Bumped by `note`, so an answer fetched BEFORE a command landed cannot overwrite the token that command produced.
  let generation = 0;
  const listeners = new Set<() => void>();

  const pull = async (): Promise<void> => {
    // Never stack a second ask on a slow answer: three polls were caught starting on one millisecond, p90 2.4 s against a 190 ms median.
    if (inFlight) return;
    inFlight = true;
    const at = generation;
    try {
      const rev = await fetchRev();
      if (at !== generation) return; // a note() landed while this was in the air
      if (rev === seen) return;
      token = rev;
      seen = rev;
      for (const l of listeners) l();
    } catch {
      // The file service is unreachable: keep the last token — whoever acted on it is not wrong yet — and ask again next tick.
    } finally {
      inFlight = false;
    }
  };

  return {
    subscribe: (listener) => {
      listeners.add(listener);
      if (timer === null) {
        // Paused while the tab is hidden, and asked once on its return (visiblePoll.ts).
        timer = pollWhileVisible(() => void pull(), intervalMs);
        void pull(); // the first consumer must not wait a whole period to learn anything
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && timer !== null) {
          timer();
          timer = null;
        }
      };
    },
    get: () => token,
    note: (rev) => {
      generation++;
      token = rev;
      seen = rev;
    },
    noteQuiet: (rev, before) => {
      generation++;
      quiet++;
      for (const l of quietListeners) l();
      // Started from somewhere else: something landed in between, and that has to be announced like any tick.
      if (before === undefined || before !== seen) {
        seen = rev;
        if (rev === token) return;
        token = rev;
        for (const l of listeners) l();
        return;
      }
      seen = rev;
    },
    subscribeQuiet: (listener) => {
      quietListeners.add(listener);
      return () => quietListeners.delete(listener);
    },
    getQuiet: () => quiet,
  };
}

const poller = createRevisionPoller(() => api.revision().then((r) => r.rev));

/** Tell the poller the token a writing command just answered with — only for a caller that has already reloaded the shell. */
export function noteRevision(rev: string): void {
  poller.note(rev);
}

/** A quiet command's token: adopted so the tick stays silent, and published to `useQuietWrites` alone. */
export function noteQuietRevision(rev: string, before?: string): void {
  poller.noteQuiet(rev, before);
}

/** A counter of this tab's quiet writes — a trigger beside `useRevision` for what must follow a knob onto disk. */
export function useQuietWrites(): number {
  return useSyncExternalStore(
    poller.subscribeQuiet,
    poller.getQuiet,
    poller.getQuiet,
  );
}

/** The project's current change token, or null while none has been read — depend on it and an effect runs once per change, not per tick. */
export function useRevision(): string | null {
  return useSyncExternalStore(poller.subscribe, poller.get, poller.get);
}
