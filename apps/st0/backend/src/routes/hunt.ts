// hunt.ts — the HTTP surface of "trouver des morceaux": start a search, read the history the
// screen draws under the field, cancel or forget a row. The work itself runs in the background
// (../hunt/hunt.ts); nothing here waits on it. See ../../docs/hunt.md.

import { wrap } from "@frediverse/http/route";
import type { Request } from "express";
import { Router } from "express";
import { runningIds, startHunt, stopHunt } from "../hunt/hunt.ts";
import { sftpConfigured } from "../hunt/sftp.ts";
import { slskdConfigured } from "../hunt/slskd.ts";
import { reconcile, removeHunt } from "../hunt/store.ts";

/** Same shape as the projects router: st0 has no express type augmentation of its own. */
function subOf(req: Request): string | null {
  const u = (req as { user?: { sub?: string; email?: string } }).user;
  return u?.sub ?? u?.email ?? null;
}

/** Longer than a title, short enough that nobody is pasting a document into it. */
const MAX_QUERY = 200;

/** How many can be in flight at once for one person. A hunt holds a peer's queue slot for up
 *  to ten minutes, and forty of them at once would be a way to get the account banned. */
const MAX_RUNNING = 4;

/** What is missing, in the words of the thing to go and set. Said rather than 500ing on the
 *  first click: an unconfigured deployment is the ordinary state of a new one. */
function missing(): string | null {
  const gaps: string[] = [];
  if (!slskdConfigured()) gaps.push("SLSKD_URL et SLSKD_API_KEY");
  if (!sftpConfigured())
    gaps.push("SLSKD_SFTP_HOST, SLSKD_SFTP_USER et SLSKD_DOWNLOADS_DIR");
  return gaps.length ? `configuration absente : ${gaps.join(", ")}` : null;
}

export const huntRouter: Router = Router();

huntRouter.use((req, res, next) => {
  if (!subOf(req))
    return res.status(401).json({ error: "no user on the session" });
  next();
});

/**
 * The history, newest first, with the rows a restart orphaned already told the truth about.
 *
 * `configured` rides along so the screen can draw its own absence — a button that opened a
 * search field and then failed on every query would be worse than one that says why it is off.
 */
huntRouter.get(
  "/",
  wrap((req, res) => {
    res.json({
      configured: missing() === null,
      reason: missing(),
      hunts: reconcile(subOf(req) as string, runningIds()),
    });
  }),
);

huntRouter.post(
  "/",
  wrap((req, res) => {
    const gap = missing();
    if (gap) return res.status(503).json({ error: gap });
    const body = req.body as { query?: unknown };
    const query = typeof body?.query === "string" ? body.query.trim() : "";
    if (!query)
      return res.status(400).json({ error: "il faut un titre à chercher" });
    if (query.length > MAX_QUERY)
      return res.status(400).json({ error: "recherche trop longue" });
    const sub = subOf(req) as string;
    const mine = reconcile(sub, runningIds()).filter(
      (h) => h.status === "searching" || h.status === "downloading",
    );
    if (mine.length >= MAX_RUNNING)
      return res.status(429).json({
        error: `${MAX_RUNNING} recherches déjà en cours — attendez qu'une se termine`,
      });
    res.json(startHunt(sub, query));
  }),
);

/** Cancel it if it is running, and take the row off the list either way. */
huntRouter.delete(
  "/:id",
  wrap((req, res) => {
    const id = req.params.id;
    const stopped = stopHunt(id);
    const removed = removeHunt(subOf(req) as string, id);
    if (!stopped && !removed)
      return res.status(404).json({ error: "recherche inconnue" });
    res.json({ ok: true, stopped });
  }),
);
