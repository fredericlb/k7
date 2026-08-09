// useRevision — ONE poll of the file service's change token for the whole app: the diagnostics
// and disk-sync hooks each ran their own 2s timer over /revision, which was the same request
// twice. A refcounted poller answers both, and consumers react to the token rather than to a
// timer. It takes its fetch as an argument so the refcount and de-duplication are testable.

import { useSyncExternalStore } from "react";
import { api } from "../api";

/** How often the token is asked for. Reading it is a ~2 ms file walk on the service's side. */
export const REVISION_POLL_MS = 2000;

export interface RevisionPoller {
  /** Register a listener; the returned function unregisters it. The timer runs only while ≥1 is registered. */
  subscribe: (listener: () => void) => () => void;
  /** The last token read, or null while none has been. */
  get: () => string | null;
}

export function createRevisionPoller(
  fetchRev: () => Promise<string>,
  intervalMs: number = REVISION_POLL_MS,
): RevisionPoller {
  let token: string | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let inFlight = false;
  const listeners = new Set<() => void>();

  const pull = async (): Promise<void> => {
    // Never stack a second ask on a slow answer. A profile of playback caught three polls
    // starting on the same millisecond, with a p90 of 2.4 s against a 190 ms median — piling
    // on is how a slow answer becomes a slower one.
    if (inFlight) return;
    inFlight = true;
    try {
      const rev = await fetchRev();
      if (rev === token) return;
      token = rev;
      for (const l of listeners) l();
    } catch {
      // The file service is unreachable. Keep the last token — whoever acted on it is not
      // wrong yet — and ask again on the next tick, exactly as the two separate polls did.
    } finally {
      inFlight = false;
    }
  };

  return {
    subscribe: (listener) => {
      listeners.add(listener);
      if (timer === null) {
        timer = setInterval(() => void pull(), intervalMs);
        void pull(); // the first consumer must not wait a whole period to learn anything
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && timer !== null) {
          clearInterval(timer);
          timer = null;
        }
      };
    },
    get: () => token,
  };
}

const poller = createRevisionPoller(() => api.revision().then((r) => r.rev));

/**
 * The project's current change token, or null while none has been read yet.
 *
 * It moves for OUR writes and for edits made outside the app (a git pull, another editor),
 * which is exactly the set of events worth reacting to. Depend on it in an effect and the
 * effect runs once per change instead of once per tick:
 *
 *     const rev = useRevision();
 *     useEffect(() => { if (rev === null) return; …expensive… }, [rev, reloadKey]);
 *
 * The `null` guard is what keeps a mount to ONE pass: with no token read yet there is nothing
 * to react to, and the first poll re-runs the effect the moment there is.
 */
export function useRevision(): string | null {
  return useSyncExternalStore(poller.subscribe, poller.get, poller.get);
}
