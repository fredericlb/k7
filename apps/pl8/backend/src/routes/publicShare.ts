// publicShare.ts — the ONE unauthenticated surface of this service: a frozen snapshot, read by
// whoever holds its link. Read-only by construction — there is no write verb here at all — and
// mounted ABOVE server.ts's `/api` guard, which is the whole of what makes it public.
// See ../../docs/shares.md.

import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { streamFile } from "@frediverse/http";
import { wrap } from "@frediverse/http/route";
import { mimeFor } from "@studio/mediatek/media";
import { Router, type Router as RouterT } from "express";
import { blobDir, isKey } from "../shares/store.ts";

/** The snapshot's manifest, as `@studio/commands/share-bundle` wrote it. */
interface Snapshot {
  name: string;
  media: {
    mix: { file: string };
    stems: { id: string; file: string }[];
  };
  docs: string[];
}

/** Read one snapshot, or null — an unknown key and a half-uploaded one are the same 404. */
function snapshotOf(key: string): Snapshot | null {
  if (!isKey(key)) return null;
  const dir = blobDir(key);
  try {
    // Its absence is what "live" means, so a crashed upload is never reachable and short.
    statSync(join(dir, "pending.json"));
    return null;
  } catch {
    /* not pending — the ordinary case */
  }
  try {
    return JSON.parse(readFileSync(join(dir, "snapshot.json"), "utf8"));
  } catch {
    return null;
  }
}

export function publicShareRouter(): RouterT {
  const router: RouterT = Router();

  // Nothing here is indexed: a link pasted into a public channel is not a search result.
  router.use((_req, res, next) => {
    res.set("X-Robots-Tag", "noindex, nofollow");
    res.set("Referrer-Policy", "no-referrer");
    next();
  });

  const gone = (res: import("express").Response) =>
    res.status(404).json({ error: "no such share" });

  /** What the viewer asks for first: the project's name and where its audio is. */
  router.get(
    "/:key/manifest",
    wrap((req, res) => {
      const snap = snapshotOf(req.params.key);
      if (!snap) return gone(res);
      res.set("Cache-Control", "no-store");
      res.json(snap);
    }),
  );

  /** One document, looked UP in the manifest and never joined — see ../../docs/shares.md. */
  router.get(
    "/:key/doc/:name",
    wrap((req, res) => {
      const want = req.params.name;
      const snap = snapshotOf(req.params.key);
      const file = snap?.docs.find((d) => d === want || d === `${want}.json`);
      if (!snap || !file) return gone(res);
      res.set("Cache-Control", "public, max-age=31536000, immutable");
      res.type("application/json");
      res.send(readFileSync(join(blobDir(req.params.key), file)));
    }),
  );

  /** The audio, with Range and no credential of any kind — an `<audio>` element sends none. */
  router.get(
    "/:key/audio/:file",
    wrap((req, res) => {
      const snap = snapshotOf(req.params.key);
      const want = `audio/${req.params.file}`;
      const known =
        snap &&
        (snap.media.mix.file === want ||
          snap.media.stems.some((s) => s.file === want));
      if (!snap || !known) return gone(res);
      const abs = join(blobDir(req.params.key), want);
      res.set("Cache-Control", "public, max-age=31536000, immutable");
      streamFile(req, res, abs, mimeFor(abs));
    }),
  );

  /** The mixdown as a download — its own route rather than a flag on the one above. */
  router.get(
    "/:key/download",
    wrap((req, res) => {
      const snap = snapshotOf(req.params.key);
      if (!snap) return gone(res);
      const abs = join(blobDir(req.params.key), snap.media.mix.file);
      const name = (snap.name || "mixdown").replace(/[\\/:*?"<>|]+/g, "_");
      res.set(
        "Content-Disposition",
        `attachment; filename="${name}${snap.media.mix.file.slice(snap.media.mix.file.lastIndexOf("."))}"`,
      );
      streamFile(req, res, abs, mimeFor(abs));
    }),
  );

  /** The terminal 404, so no miss falls through to the `/api` guard and comes back 401. */
  router.use((_req, res) => gone(res));

  return router;
}
