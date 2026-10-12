// syncEvents.ts — change notices for an account's browsers: every entry the relay orders is pushed to
// the account's open pages, so they refetch at once instead of polling. See docs/syncRelay.md.

import type { Sequenced } from "@studio/live-sync/ops";
import type { Request } from "express";
import { Router } from "express";

/** Called by the relay for every entry it orders. */
export function publishSyncEvent(
  _slug: string,
  _workspace: string,
  _entry: Sequenced,
): void {}

export function eventsRouter(_slugOf: (req: Request) => string | null): Router {
  const r = Router();
  r.use((_req, res) =>
    res.status(501).json({ error: "sync events are not built yet" }),
  );
  return r;
}
