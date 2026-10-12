// syncFeed.ts — ONE EventSource per page on st0's /api/sync/events, shared by every consumer and
// closed when the last leaves. A stream that cannot open (no hub, no session, a share) is given up
// for the page, so the /revision poll is all that runs and nothing reconnects in a loop. See docs/conflicts.md.

import { cfg } from "@studio/project-shell/fileApi";
import { serviceUrl } from "@studio/web-protocol/services";

/** One ordered entry, as packages/file-hub/syncEvents.ts announces it: what moved, never its contents. */
export interface SyncNotice {
  workspace: string;
  seq: number;
  files: string[];
  parked: number;
  settled: number;
}

export interface SyncConsumer {
  notice: (n: SyncNotice) => void;
  /** The stream opened (true: catch up, a notice may have been missed) or dropped (false: poll faster). */
  live?: (live: boolean) => void;
}

/** The slice of EventSource this module touches, so tests can hand in a fake. */
export interface EventSourceLike {
  readonly readyState: number;
  addEventListener: (type: string, fn: (e: MessageEvent) => void) => void;
  close: () => void;
}

const CLOSED = 2;
/** Failures before the stream ever opened that make it give up — a server that is down is retried by the browser itself. */
const GIVE_UP_AFTER = 3;

export interface SyncFeed {
  subscribe: (c: SyncConsumer) => () => void;
  isLive: () => boolean;
}

export function createSyncFeed(open: () => EventSourceLike | null): SyncFeed {
  const consumers = new Set<SyncConsumer>();
  let source: EventSourceLike | null = null;
  let live = false;
  let dead = false;
  let failures = 0;
  let everOpened = false;

  const setLive = (v: boolean) => {
    if (live === v) return;
    live = v;
    for (const c of consumers) c.live?.(v);
  };
  const stop = () => {
    source?.close();
    source = null;
    setLive(false);
  };
  const start = () => {
    if (source || dead) return;
    const s = open();
    // Nothing to open for now (a share, no project yet): the next first consumer asks again.
    if (!s) return;
    source = s;
    s.addEventListener("open", () => {
      everOpened = true;
      failures = 0;
      setLive(true);
    });
    s.addEventListener("ordered", (e) => {
      let n: SyncNotice;
      try {
        n = JSON.parse(e.data) as SyncNotice;
      } catch {
        return;
      }
      for (const c of consumers) c.notice(n);
    });
    s.addEventListener("error", () => {
      setLive(false);
      // CLOSED is an HTTP answer that was not a stream (401, 501…): it will not change by retrying.
      if (
        s.readyState === CLOSED ||
        (!everOpened && ++failures >= GIVE_UP_AFTER)
      ) {
        dead = true;
        stop();
      }
    });
  };

  return {
    subscribe: (c) => {
      consumers.add(c);
      if (consumers.size === 1) start();
      else if (live) c.live?.(true);
      return () => {
        consumers.delete(c);
        if (consumers.size === 0) stop();
      };
    },
    isLive: () => live,
  };
}

/** The workspace the page edits, or null for a share or a page with no project opened. */
export function currentWorkspace(): string | null {
  try {
    const c = cfg();
    return c.frozen || !c.workspace ? null : c.workspace;
  } catch {
    return null;
  }
}

const EVENTS = `${serviceUrl(globalThis.location?.origin ?? "", "st0")}/api/sync/events`;

/** The page's feed; it opens nothing where there is no EventSource or no live workspace. */
export const syncFeed = createSyncFeed(() =>
  typeof EventSource === "undefined" || currentWorkspace() === null
    ? null
    : new EventSource(EVENTS, { withCredentials: true }),
);

/** Consumers that care about the CURRENT workspace only. */
export function subscribeWorkspace(
  notice: (n: SyncNotice) => void,
  live?: (live: boolean) => void,
): () => void {
  return syncFeed.subscribe({
    notice: (n) => {
      if (n.workspace === currentWorkspace()) notice(n);
    },
    live,
  });
}
