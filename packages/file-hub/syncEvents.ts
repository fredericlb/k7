// syncEvents.ts — change notices for an account's browsers: every entry the relay orders is pushed to
// the account's open pages as a Server-Sent Event, so they refetch at once instead of polling.
// A notice names what moved, never what it became: the page reads the files the usual way. See docs/syncRelay.md.

import type { Sequenced } from "@studio/live-sync/ops";
import type { Request } from "express";
import { Router } from "express";

/** What one notice carries: the workspace, the entry's number, the files it touched and its conflicts. */
export interface SyncNotice {
  workspace: string;
  seq: number;
  files: string[];
  /** Ops this entry set aside as conflicts. */
  parked: number;
  /** Conflicts this entry settled. */
  settled: number;
}

/** A page's stream gets a comment this often, so a proxy never closes it for idleness. */
export const HEARTBEAT_MS = 20_000;
/** Open streams per account; one per tab, so this is many tabs on many machines. */
export const MAX_SUBSCRIBERS = 32;

type Send = (frame: string) => void;
const subscribers = new Map<string, Set<Send>>();

export function noticeOf(workspace: string, entry: Sequenced): SyncNotice {
  const files = new Set(entry.batch.ops.map((op) => op.file));
  for (const c of entry.parked) files.add(c.op.file);
  return {
    workspace,
    seq: entry.seq,
    files: [...files],
    parked: entry.parked.length,
    settled: entry.batch.resolves?.length ?? 0,
  };
}

/** Called by the relay for every entry it orders. */
export function publishSyncEvent(
  slug: string,
  workspace: string,
  entry: Sequenced,
): void {
  const set = subscribers.get(slug);
  if (!set?.size) return;
  const frame = `event: ordered\ndata: ${JSON.stringify(noticeOf(workspace, entry))}\n\n`;
  for (const send of set) send(frame);
}

/** How many pages of `slug` are listening — for tests and diagnostics. */
export function subscriberCount(slug: string): number {
  return subscribers.get(slug)?.size ?? 0;
}

export function eventsRouter(
  slugOf: (req: Request) => string | null,
  opts: { heartbeatMs?: number; max?: number } = {},
): Router {
  const heartbeat = opts.heartbeatMs ?? HEARTBEAT_MS;
  const max = opts.max ?? MAX_SUBSCRIBERS;
  const r = Router();
  r.get("/", (req, res) => {
    const slug = slugOf(req);
    if (!slug) {
      res.status(401).json({ error: "not signed in" });
      return;
    }
    const set = subscribers.get(slug) ?? new Set<Send>();
    if (set.size >= max) {
      res.status(429).json({ error: "too many open change streams" });
      return;
    }
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      // A buffering proxy (nginx) would hold every notice until its buffer fills.
      "x-accel-buffering": "no",
    });
    // The browser waits this long before reconnecting, and the comment lets it fire `open` at once.
    res.write("retry: 5000\n: open\n\n");
    const send: Send = (frame) => {
      res.write(frame);
    };
    set.add(send);
    subscribers.set(slug, set);
    const timer = setInterval(() => res.write(": hb\n\n"), heartbeat);
    timer.unref?.();
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      clearInterval(timer);
      set.delete(send);
      if (set.size === 0 && subscribers.get(slug) === set)
        subscribers.delete(slug);
    };
    req.on("close", close);
    res.on("close", close);
    res.on("error", close);
  });
  return r;
}
