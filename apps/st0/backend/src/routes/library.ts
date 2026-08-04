// library.ts — the media library over HTTP: what exists, how stale a listing is, and the
// bytes themselves. The same vocabulary the LOCAL service serves, deliberately, so a cache
// can ask either side the same questions. Writing too — by path for the two callers that
// legitimately have one, and by TAGS for an upload, which does not. See docs/songs.md.

import { statSync } from "node:fs";
import { streamFile } from "@frediverse/http";
import { wrap } from "@frediverse/http/route";
import {
  listFamily,
  parseQuery,
  search,
  summary,
} from "@studio/mediatek/catalogue";
import {
  exists,
  NotWritableError,
  PathEscapesError,
  safePath,
} from "@studio/mediatek/layout";
import { manifest } from "@studio/mediatek/manifest";
import { mimeFor } from "@studio/mediatek/media";
import { addRecording, listRecordings } from "@studio/mediatek/recordings";
import { revisions } from "@studio/mediatek/revision";
import { NotAudioError, SongExistsError } from "@studio/mediatek/song";
import { asFamily, FAMILY_ERROR } from "@studio/mediatek/types";
import {
  addSong,
  makeFolder,
  moveEntry,
  putFile,
  removeFile,
  removeTree,
} from "@studio/mediatek/write";
import express, { Router } from "express";

export const libraryRouter: Router = Router();

// The family guard, the refusal and the content types come from @studio/mediatek: this shell and
// the file service's both used to carry their own, and the MIME tables drifted until each served
// as octet-stream what the other could play.
const badFamily = { error: FAMILY_ERROR };

/** Is there a library on this volume, and how much is in it. */
libraryRouter.get(
  "/",
  wrap((_req, res) => {
    // The root is a server path and stays one — a client has no use for it and every
    // reason not to be told where this service keeps its disk.
    const { present, counts } = summary();
    res.json({ present, counts });
  }),
);

/** Every family's change token. A cache polls this and only asks for what moved. */
libraryRouter.get(
  "/revision",
  wrap((_req, res) => {
    if (!exists()) return res.json({ present: false, revisions: {} });
    res.json({ present: true, revisions: revisions() });
  }),
);

libraryRouter.get(
  "/list",
  wrap((req, res) => {
    const family = asFamily(req.query.family);
    if (!family) return res.status(400).json(badFamily);
    res.json(listFamily(family));
  }),
);

/**
 * One family's files as (path, bytes, mtime) — what a cache diffs against.
 *
 * Distinct from `/list`, which describes ENTRIES: a song is one entry and several
 * files, and a cache has to fetch files.
 */
libraryRouter.get(
  "/manifest",
  wrap((req, res) => {
    const family = asFamily(req.query.family);
    if (!family) return res.status(400).json(badFamily);
    res.json({ family, rev: revisions()[family], files: manifest(family) });
  }),
);

/** Filter across families. What a query MEANS — including why `limit` is clamped — belongs to
 *  the catalogue, not to either shell over it: see parseQuery. */
libraryRouter.get(
  "/search",
  wrap((req, res) => {
    res.json({ entries: search(parseQuery(req.query)) });
  }),
);

/**
 * One file's bytes, with Range so a browser can seek in a take without pulling all of it.
 *
 * `safePath` is the only thing between the query string and the disk here — a hosted
 * service has no workspace wall to hide behind, unlike the local one.
 */
libraryRouter.get(
  "/file",
  wrap((req, res) => {
    const rel = String(req.query.path ?? "");
    if (!rel) return res.status(400).json({ error: "path required" });
    let abs: string;
    try {
      abs = safePath(rel);
    } catch (e) {
      if (e instanceof PathEscapesError)
        return res.status(400).json({ error: e.message });
      throw e;
    }
    try {
      if (!statSync(abs).isFile())
        return res.status(404).json({ error: "not a file" });
    } catch {
      return res.status(404).json({ error: "not found" });
    }
    streamFile(req, res, abs, mimeFor(abs));
  }),
);

/** Refusals a caller can fix, told apart from the ones they cannot. */
function writeError(e: unknown, res: import("express").Response): boolean {
  if (e instanceof PathEscapesError || e instanceof NotWritableError) {
    res.status(400).json({ error: (e as Error).message });
    return true;
  }
  return false;
}

/**
 * Put one file into the library.
 *
 * Raw body, one file per request, rather than multipart: the two callers are a module
 * editor saving YAML and a machine pushing a folder up file by file. Neither wants a form,
 * and a stream of one file each keeps a 400 MB video from ever being a field in a parse.
 */
libraryRouter.put(
  "/file",
  express.raw({ type: "*/*", limit: "512mb" }),
  wrap((req, res) => {
    const rel = String(req.query.path ?? "");
    if (!rel) return res.status(400).json({ error: "path required" });
    try {
      putFile(rel, req.body as Buffer);
    } catch (e) {
      if (writeError(e, res)) return;
      throw e;
    }
    res.json({ ok: true, path: rel });
  }),
);

/**
 * One uploaded audio file as a filed song.
 *
 * Its own route rather than a PUT /file, because the CALLER DOES NOT CHOOSE THE PATH here:
 * it sends three tags and the library derives `songs/<artiste>/<album>/<titre>/
 * original.<ext>` from them. That is the whole point — `songs/` has a shape, and a client
 * free to name the folder would be free to name any folder.
 *
 * There is no `kind` parameter any more. It used to carry the provenance folder and was
 * validated here, against a list this route could reach and the browser-safe naming module
 * could not; `songs/` no longer files by provenance, so both the parameter and the check
 * are gone. `source` still says who filed it, and it is a line in the sidecar.
 *
 * Raw body for the same reason PUT /file uses one: a 400 MB master should never be a field
 * in a form parse. The tags ride in the query string, where they are short and text.
 */
libraryRouter.post(
  "/song",
  express.raw({ type: "*/*", limit: "512mb" }),
  wrap((req, res) => {
    const q = req.query as Record<string, unknown>;
    const s = (k: string): string =>
      typeof q[k] === "string" ? (q[k] as string) : "";
    const filename = s("filename");
    if (!filename) return res.status(400).json({ error: "filename required" });
    const bytes = req.body as Buffer;
    if (!bytes?.length) return res.status(400).json({ error: "empty body" });
    try {
      const r = addSong({
        filename,
        bytes,
        tags: {
          artist: s("artist"),
          album: s("album"),
          title: s("title"),
          // Who filed it. k7 pushes its published versions through here and says so,
          // which is what tells a human reading the folder that it is not somebody's drop.
          source: s("source") || undefined,
        },
        replace: s("replace") === "1",
      });
      res.json({ ok: true, ...r });
    } catch (e) {
      // Already there is a 409 and not a 400: the request is well formed, and the fix is a
      // decision — replace it or file it elsewhere — not a correction.
      if (e instanceof SongExistsError)
        return res.status(409).json({ error: e.message, exists: true });
      if (e instanceof NotAudioError)
        return res.status(400).json({ error: e.message });
      if (writeError(e, res)) return;
      throw e;
    }
  }),
);

/**
 * The raw capture zone, day by day. Its own listing because these files enter no
 * catalogue: `/list?family=songs` will never mention one. See docs/recordings.md.
 */
libraryRouter.get(
  "/recordings",
  wrap((_req, res) => {
    res.json({ days: listRecordings() });
  }),
);

/**
 * Push one capture in.
 *
 * The route the machines use, and the reason the zone exists. It is behind the same
 * `bearerOrSession` as everything else here, so a headless recorder authenticates with an
 * API token and needs no cookie jar — see server.ts.
 *
 * `at` is the moment it was CAPTURED, ISO, and optional: a recorder posting live has
 * nothing to say that the server clock does not already know, while a batch pushed the
 * morning after would otherwise land, whole, under the wrong day.
 */
libraryRouter.post(
  "/recording",
  express.raw({ type: "*/*", limit: "512mb" }),
  wrap((req, res) => {
    const q = req.query as Record<string, unknown>;
    const s = (k: string): string =>
      typeof q[k] === "string" ? (q[k] as string) : "";
    const filename = s("filename");
    if (!filename) return res.status(400).json({ error: "filename required" });
    const bytes = req.body as Buffer;
    if (!bytes?.length) return res.status(400).json({ error: "empty body" });
    let at: Date | undefined;
    if (s("at")) {
      at = new Date(s("at"));
      // Refused rather than silently falling back to now: a caller that bothered to send a
      // timestamp cares where the file lands, and today is the one answer it did not mean.
      if (Number.isNaN(at.getTime()))
        return res.status(400).json({ error: `at: not a date: ${s("at")}` });
    }
    // Present == the caller is pushing a MOMENT, a span cut out of a session, which the
    // zone names differently: moment-<HH-MM-SS>--<durée>--<nom>.
    const duration = s("duration") ? Number(s("duration")) : undefined;
    if (duration !== undefined && !Number.isFinite(duration))
      return res
        .status(400)
        .json({ error: `duration: not a number: ${s("duration")}` });
    try {
      res.json({
        ok: true,
        ...addRecording({
          filename,
          bytes,
          at,
          durationSec: duration,
          label: s("label") || undefined,
        }),
      });
    } catch (e) {
      if (e instanceof NotAudioError)
        return res.status(400).json({ error: e.message });
      if (writeError(e, res)) return;
      throw e;
    }
  }),
);

/**
 * Move or rename, in one syscall, folders included.
 *
 * A POST and not a PUT on /file: this carries no bytes, and a folder has none to carry.
 * The client used to compose it from read + write + delete, which could not touch a folder
 * at all and left a duplicate whenever the delete failed after the write.
 */
libraryRouter.post(
  "/move",
  express.json(),
  wrap((req, res) => {
    const { from, to } = (req.body ?? {}) as { from?: string; to?: string };
    if (!from || !to)
      return res.status(400).json({ error: "from and to required" });
    try {
      moveEntry(from, to);
    } catch (e) {
      if (writeError(e, res)) return;
      throw e;
    }
    res.json({ ok: true, path: to });
  }),
);

/** An empty folder — somewhere to drop into before the first file exists. */
libraryRouter.post(
  "/folder",
  express.json(),
  wrap((req, res) => {
    const rel = String((req.body as { path?: string })?.path ?? "");
    if (!rel) return res.status(400).json({ error: "path required" });
    try {
      makeFolder(rel);
    } catch (e) {
      if (writeError(e, res)) return;
      throw e;
    }
    res.json({ ok: true, path: rel });
  }),
);

/** A whole subtree. Separate from DELETE /file so removing a folder is never something a
 *  caller can do by accident while meaning to remove one entry. */
libraryRouter.delete(
  "/folder",
  wrap((req, res) => {
    const rel = String(req.query.path ?? "");
    if (!rel) return res.status(400).json({ error: "path required" });
    try {
      removeTree(rel);
    } catch (e) {
      if (writeError(e, res)) return;
      throw e;
    }
    res.json({ ok: true });
  }),
);

/** Take one out. Absent is success — the caller wanted it gone. */
libraryRouter.delete(
  "/file",
  wrap((req, res) => {
    const rel = String(req.query.path ?? "");
    if (!rel) return res.status(400).json({ error: "path required" });
    try {
      removeFile(rel);
    } catch (e) {
      if (writeError(e, res)) return;
      throw e;
    }
    res.json({ ok: true });
  }),
);
