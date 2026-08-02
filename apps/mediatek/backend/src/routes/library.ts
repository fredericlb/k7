// library.ts — the media library over HTTP: what exists, how stale a listing is, and the
// bytes themselves. The same vocabulary the LOCAL service serves, deliberately, so a cache
// can ask either side the same questions. Read-only; writing arrives with the builder.

import { statSync } from "node:fs";
import { extname } from "node:path";
import { streamFile } from "@frediverse/http";
import { wrap } from "@frediverse/http/route";
import { listFamily, search, summary } from "@studio/mediatek/catalogue";
import {
  exists,
  NotWritableError,
  PathEscapesError,
  safePath,
} from "@studio/mediatek/layout";
import { manifest } from "@studio/mediatek/manifest";
import { revisions } from "@studio/mediatek/revision";
import { FAMILIES, type Family } from "@studio/mediatek/types";
import { putFile, removeFile } from "@studio/mediatek/write";
import express, { Router } from "express";

export const libraryRouter: Router = Router();

const asFamily = (v: unknown): Family | undefined =>
  FAMILIES.includes(v as Family) ? (v as Family) : undefined;

const badFamily = { error: `family must be one of: ${FAMILIES.join(", ")}` };

/** Enough of a content type for a browser to play or download. `<audio>`/`<video>` need the
 *  family right; the rest can be a stream, since nothing here is rendered as a document. */
const MIME: Record<string, string> = {
  ".wav": "audio/wav",
  ".flac": "audio/flac",
  ".aiff": "audio/aiff",
  ".aif": "audio/aiff",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".opus": "audio/ogg",
  ".m4a": "audio/mp4",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".mkv": "video/x-matroska",
  ".webm": "video/webm",
  ".yaml": "text/yaml; charset=utf-8",
  ".yml": "text/yaml; charset=utf-8",
  ".json": "application/json",
  ".nam": "application/json",
};

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
 * Distinct from `/list`, which describes ENTRIES: a morceau is one entry and several
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

libraryRouter.get(
  "/search",
  wrap((req, res) => {
    const rawLimit = Number(req.query.limit);
    const limit =
      Number.isFinite(rawLimit) && rawLimit > 0
        ? Math.min(Math.floor(rawLimit), 1000)
        : undefined;
    res.json({
      entries: search({
        family: asFamily(req.query.family),
        q: typeof req.query.q === "string" ? req.query.q : undefined,
        kind: typeof req.query.kind === "string" ? req.query.kind : undefined,
        limit,
      }),
    });
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
    streamFile(
      req,
      res,
      abs,
      MIME[extname(abs).toLowerCase()] ?? "application/octet-stream",
    );
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
