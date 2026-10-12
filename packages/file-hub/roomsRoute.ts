// roomsRoute.ts — the workspaces an account syncs, by the rooms the relay holds for it: what a replica
// that never saw one of them creates and joins. A device token or a hub secret is the gate.
// See docs/syncRelay.md.

import { readdirSync } from "node:fs";
import { join } from "node:path";
import { HUB_SECRET_HEADER } from "@studio/web-protocol";
import { type Request, Router } from "express";

export interface RoomsOptions {
  /** The account folder an account's rooms are kept under. */
  accountDir: (slug: string) => string;
  /** The account a caller proves, by a device token or a secret; null when it proves none. */
  accountOf: (cred: {
    secret?: string;
    token?: string;
  }) => Promise<string | null>;
  /** Whether a room still holds files; a workspace removed everywhere is a room left empty, and is not offered. */
  holdsFiles?: (slug: string, workspace: string) => boolean;
}

/** What a sync caller presents: a device's bearer token, or a hub secret. */
export function syncCredential(req: Request): {
  secret?: string;
  token?: string;
} {
  const bearer = /^Bearer (.+)$/.exec(
    String(req.headers.authorization ?? ""),
  )?.[1];
  return bearer
    ? { token: bearer }
    : { secret: String(req.headers[HUB_SECRET_HEADER] ?? "") };
}

/** The workspace names an account has rooms for: each a folder under `.sync-relay`, named by encodeURIComponent. */
export function roomNames(accountDir: string): string[] {
  try {
    return readdirSync(join(accountDir, ".sync-relay"), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => decodeURIComponent(d.name))
      .sort();
  } catch {
    return [];
  }
}

export function roomsRouter(opts: RoomsOptions): Router {
  const r = Router();
  r.get("/", (req, res) => {
    void opts.accountOf(syncCredential(req)).then((slug) => {
      if (!slug)
        res
          .status(401)
          .json({ error: "no device token or hub secret this hub knows" });
      else
        res.json({
          workspaces: roomNames(opts.accountDir(slug)).filter(
            (w) => opts.holdsFiles?.(slug, w) ?? true,
          ),
        });
    });
  });
  return r;
}
