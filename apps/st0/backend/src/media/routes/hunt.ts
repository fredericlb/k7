// hunt.ts — the HTTP surface of "trouver des morceaux": start a search, read the history the
// screen draws under the field, cancel or forget a row. The work itself runs in the background
// (../hunt/hunt.ts); nothing here waits on it. See ../../../docs/media/hunt.md.

import { wrap } from "@frediverse/http/route";
import {
  canFallBackToYoutube,
  type HuntIdentity,
  type HuntTags,
} from "@studio/web-protocol/hunt";
import type { Request } from "express";
import { Router } from "express";
import {
  identify,
  runningIds,
  startHunt,
  startYoutube,
  stopHunt,
} from "../hunt/hunt.ts";
import { reconcile, removeHunt } from "../hunt/store.ts";
import { youtubeAvailable } from "../hunt/youtube.ts";
import { missing } from "../settings/store.ts";

/** Whose hunt: the subject, falling back to the email for a session without one. */
function subOf(req: Request): string | null {
  const u = (req as { user?: { sub?: string; email?: string } }).user;
  return u?.sub ?? u?.email ?? null;
}

/** Longer than a title, short enough that nobody is pasting a document into it. */
const MAX_QUERY = 200;

/** In flight at once, per person: forty queue slots held for ten minutes gets an account banned. */
const MAX_RUNNING = 4;

export const huntRouter: Router = Router();

huntRouter.use((req, res, next) => {
  if (!subOf(req))
    return res.status(401).json({ error: "no user on the session" });
  next();
});

/** The history, newest first; `configured` rides along so the screen can draw its own absence. */
huntRouter.get(
  "/",
  wrap(async (req, res) => {
    // The instance's settings — a new one is normally unconfigured, and the screen says so.
    const reason = missing();
    res.json({
      configured: reason === null,
      reason,
      // Whether the fallback is even possible, so a failed row can grey its button and say why.
      youtube: await youtubeAvailable(),
      hunts: reconcile(subOf(req) as string, runningIds()),
    });
  }),
);

/** The fallback, deliberately NOT automatic: a button and never a retreat — ../../../docs/media/hunt.md. */
huntRouter.post(
  "/:id/youtube",
  wrap(async (req, res) => {
    if (!(await youtubeAvailable()))
      return res
        .status(503)
        .json({ error: "yt-dlp n'est pas installé sur ce serveur" });
    const sub = subOf(req) as string;
    const row = reconcile(sub, runningIds()).find(
      (h) => h.id === req.params.id,
    );
    if (!row) return res.status(404).json({ error: "recherche inconnue" });
    // The SAME rule that shows the button: a visible one the route refuses is a dead end.
    if (!canFallBackToYoutube(row))
      return res.status(409).json({
        error:
          row.status === "failed"
            ? "cet échec ne vient pas du réseau Soulseek — YouTube n'y répondrait pas"
            : "ce secours n'a de sens qu'après un échec",
      });
    const rec = startYoutube(sub, row.id);
    // One row, one download: a second writer of the same folder would win by luck.
    if (!rec) return res.status(409).json({ error: "déjà en cours" });
    res.json(rec);
  }),
);

/** What a query WOULD hunt, downloading nothing: a caller checks it before starting — ../../../docs/media/hunt.md. */
huntRouter.get(
  "/identify",
  wrap(async (req, res) => {
    const query = typeof req.query.q === "string" ? req.query.q.trim() : "";
    if (!query)
      return res.status(400).json({ error: "il faut un titre à chercher" });
    if (query.length > MAX_QUERY)
      return res.status(400).json({ error: "recherche trop longue" });
    const answer: HuntIdentity = { tags: await identify(query) };
    res.json(answer);
  }),
);

/** Tags a caller identified and checked, or undefined when absent or not well formed. */
function givenTags(raw: unknown): HuntTags | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const t = raw as Record<string, unknown>;
  const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const artist = text(t.artist);
  const title = text(t.title);
  if (!artist || !title) return undefined;
  return {
    artist,
    title,
    album: text(t.album) || null,
    date: text(t.date) || null,
  };
}

huntRouter.post(
  "/",
  wrap((req, res) => {
    const gap = missing();
    if (gap) return res.status(503).json({ error: gap });
    const body = req.body as { query?: unknown; tags?: unknown };
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
    res.json(startHunt(sub, query, givenTags(body.tags)));
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
