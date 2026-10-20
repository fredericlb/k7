// read.ts — the library's READ routes: what exists, how stale a listing is, and the bytes themselves.
// The same vocabulary the LOCAL service serves, so a cache can ask either side the same questions.

import { existsSync, statSync } from "node:fs";
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
  PathEscapesError,
  readablePath,
} from "@studio/mediatek/layout";
import { manifestAt } from "@studio/mediatek/manifest";
import { extOf, mimeFor } from "@studio/mediatek/media";
import { revisions } from "@studio/mediatek/revision";
import { asFamily, FAMILY_ERROR } from "@studio/mediatek/types";
import { type Response, Router } from "express";
import { mayManageLibrary } from "../../libraryGate.ts";
import {
  ensureStreamCopy,
  SourceChangedError,
  StreamCopyBusyError,
} from "../../streamCopy.ts";

export const readRoutes: Router = Router();

// Guard, refusal and content types come from @studio/mediatek — see its docs/mime.md.
const badFamily = { error: FAMILY_ERROR };

/** `rel` on disk, or null once the 400 or 404 is sent; `file` refuses a folder, `present` only an absence. */
export function resolveReadable(
  rel: string,
  res: Response,
  need: "file" | "present",
): string | null {
  if (!rel) {
    res.status(400).json({ error: "path required" });
    return null;
  }
  let abs: string;
  try {
    abs = readablePath(rel);
  } catch (e) {
    if (!(e instanceof PathEscapesError)) throw e;
    res.status(400).json({ error: e.message });
    return null;
  }
  if (need === "present") {
    if (existsSync(abs)) return abs;
    res.status(404).json({ error: `${rel} is not here` });
    return null;
  }
  try {
    if (statSync(abs).isFile()) return abs;
    res.status(404).json({ error: "not a file" });
  } catch {
    res.status(404).json({ error: "not found" });
  }
  return null;
}

/** Is there a library on this volume, and how much is in it. */
readRoutes.get(
  "/",
  wrap(async (req, res) => {
    // The root is a server path and stays one — a client is never told where the disk is.
    const { present, counts } = await summary();
    // `manage`: whether the removals and folder moves are this caller's — ../../libraryGate.ts.
    res.json({ present, counts, manage: mayManageLibrary(req) });
  }),
);

/** Every family's change token. A cache polls this and only asks for what moved. */
readRoutes.get(
  "/revision",
  wrap((_req, res) => {
    if (!exists()) return res.json({ present: false, revisions: {} });
    res.json({ present: true, revisions: revisions() });
  }),
);

readRoutes.get(
  "/list",
  wrap(async (req, res) => {
    const family = asFamily(req.query.family);
    if (!family) return res.status(400).json(badFamily);
    res.json(await listFamily(family));
  }),
);

/** One family's FILES as (path, bytes, mtime) — `/list` describes entries, and a song is many. */
readRoutes.get(
  "/manifest",
  wrap(async (req, res) => {
    const family = asFamily(req.query.family);
    if (!family) return res.status(400).json(badFamily);
    const { rev, files } = manifestAt(family);
    res.json({ family, rev, files: await files });
  }),
);

/** Filter across families. What a query MEANS belongs to the catalogue, not here: see parseQuery. */
readRoutes.get(
  "/search",
  wrap(async (req, res) => {
    res.json({ entries: await search(parseQuery(req.query)) });
  }),
);

/** One file's bytes, with Range; `readablePath` is the ONLY wall between the query string and disk. */
readRoutes.get(
  "/file",
  wrap((req, res) => {
    const abs = resolveReadable(String(req.query.path ?? ""), res, "file");
    if (!abs) return;
    streamFile(req, res, abs, mimeFor(abs));
  }),
);

/** Like `/file`, except a FLAC is served as the Opus copy beside it, made now if need be — ../../../../docs/media/streaming.md. */
readRoutes.get(
  "/stream",
  wrap(async (req, res) => {
    const abs = resolveReadable(String(req.query.path ?? ""), res, "file");
    if (!abs) return;
    if (extOf(abs) !== ".flac") return streamFile(req, res, abs, mimeFor(abs));

    let copy: string;
    try {
      // Replaced while it was being encoded: once more, from the new bytes.
      copy = await ensureStreamCopy(abs).catch((e) =>
        e instanceof SourceChangedError
          ? ensureStreamCopy(abs)
          : Promise.reject(e),
      );
    } catch (e) {
      if (e instanceof StreamCopyBusyError)
        return res.status(503).json({ error: e.message });
      throw e;
    }
    streamFile(req, res, copy, "audio/webm");
  }),
);
