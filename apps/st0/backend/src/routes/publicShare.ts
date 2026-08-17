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
    // `pending.json` is present only while an upload is in flight. Its absence is what "live"
    // means, so a crashed upload is never reachable rather than being reachable and short.
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

  // Nothing here is indexed: a link pasted into a public channel must not become a search
  // result. And a snapshot cannot change, so its BYTES are immutable while the manifest is
  // not — that is what makes a revocation felt at the next load rather than at the next hour.
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

  /**
   * One of the three documents, by the name the snapshot itself lists.
   *
   * Looked UP rather than joined: `docs` is a closed list written when the snapshot was built,
   * so a name that is not in it names nothing, and no part of the request reaches a path.
   *
   * The extension is optional, and that is what lets the viewer be l8 unmodified: `fget` asks
   * for `/project-doc` because that is the file service's route, and the snapshot calls the same
   * bytes `project-doc.json` because a file needs a name. Matching both spellings here is one
   * `||`, where teaching either side about the other would have been a special case in the one
   * place — the transport — that has to stay ignorant of who is answering.
   */
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

  /**
   * The audio, with Range — which is what lets a browser seek in a song instead of pulling it.
   *
   * No credential of any kind, and that is the point rather than an oversight: an `<audio>`
   * element does not send them. z0's public `/audio` says the same sentence.
   *
   * The file is MATCHED against the manifest, never sanitised out of the request: the mixdown
   * and the stems are the only bytes a share has, and anything else is a 404 by construction.
   */
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

  /** The mixdown as a download — a route of its own, so "the mix, and only the mix" is one thing
   *  to reason about rather than a flag on the one above. */
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

  /**
   * The terminal 404, and it is not tidiness.
   *
   * Express falls through on an unmatched path, so without this a request for something this
   * router does not have would carry on to the `/api` guard below and come back **401** — "it
   * exists but not for you", about something that does not exist. Every miss here is a 404.
   */
  router.use((_req, res) => gone(res));

  return router;
}
