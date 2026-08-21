// useDocument.ts — one derived document from the file service, re-asked when the project moves
// AND again, on a backoff, while asking fails. The three panes that draw a compiled document
// (the timeline, the chains, the graph panel) share it. See docs/shell.md.

import { useEffect, useRef, useState } from "react";

/**
 * How long to wait before retry number `attempt` (0-based), in milliseconds.
 *
 * Doubling from half a second, capped at five. The failure this exists for is the file service
 * restarting under `tsx` while somebody edits it — back within a second or two — so the first
 * retry has to be quick or the pane is dead for longer than the outage. The cap is what stops a
 * genuinely stuck state ("no active project") from becoming a request loop; a pane erroring at
 * one request per five seconds is quieter than the revision poll every tab already runs.
 *
 * Exported because it is the only part of this file a test can reach: nothing in this app mounts
 * a component (see AGENTS.md), so the policy is separated from the plumbing on purpose.
 */
export function retryDelay(attempt: number): number {
  return Math.min(5000, 500 * 2 ** attempt);
}

/**
 * Ask for a document, keep asking until it answers, and re-ask whenever `reloadKey` moves.
 *
 * The three panes each had the same six lines — fetch, set, clear the error, catch — and the
 * same hole: a single failed request pinned `error` on screen with nothing to lift it. One blip
 * of the file service and the pane stayed dead until a command happened to move `reloadKey`,
 * which on a pane you are only READING never comes. Measured in the wild as half an hour of
 * "timeline unavailable" over a service that had been healthy the whole time.
 *
 * The last error stays visible while the retries run. A pane that cleared it would show "loading"
 * while holding nothing, and the failure is exactly what somebody needs to be able to read.
 */
export function useDocument<T>(
  load: () => Promise<T>,
  reloadKey: number,
): { doc: T | null; error: string | null } {
  const [doc, setDoc] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Through a ref so the effect depends on `reloadKey` ALONE. A caller's `load` closes over its
  // own props and is a fresh function every render, so depending on it would re-ask on each one
  // — the opposite of the point. Same arrangement the seeded graph already used in ChainsTab.
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    const ask = (): void => {
      void loadRef.current().then(
        (value) => {
          if (!alive) return;
          setDoc(value);
          setError(null);
        },
        (e: unknown) => {
          if (!alive) return;
          setError((e as Error).message);
          timer = setTimeout(ask, retryDelay(attempt++));
        },
      );
    };
    ask();
    // Both halves matter: `alive` drops a reply that lands after the project moved, and clearing
    // the timer stops a retry scheduled for a document nobody is waiting for any more.
    return () => {
      alive = false;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [reloadKey]);

  return { doc, error };
}
