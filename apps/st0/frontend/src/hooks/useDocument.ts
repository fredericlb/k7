// useDocument.ts — one derived document from the file service, re-asked when the project moves
// AND again, on a backoff, while asking fails. The three panes that draw a compiled document
// (the timeline, the chains, the graph panel) share it. See docs/shell.md.

import { useEffect, useRef, useState } from "react";

/** How long to wait before retry number `attempt` — doubling from half a second, capped at five, and exported because it is what a test can reach. */
export function retryDelay(attempt: number): number {
  return Math.min(5000, 500 * 2 ** attempt);
}

/** Ask for a document, keep asking until it answers, and re-ask on `reloadKey` — the last error stays visible while the retries run. */
export function useDocument<T>(
  load: () => Promise<T>,
  reloadKey: number,
): { doc: T | null; error: string | null } {
  const [doc, setDoc] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Through a ref so the effect depends on `reloadKey` ALONE: a caller's `load` is a fresh function every render.
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
    // Both halves matter: `alive` drops a reply that lands after the project moved, and the timer must not retry for a dead document.
    return () => {
      alive = false;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [reloadKey]);

  return { doc, error };
}
