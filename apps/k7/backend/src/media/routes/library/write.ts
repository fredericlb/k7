// write.ts — the library's WRITE routes: by path for the two callers that legitimately have one,
// and by TAGS for an upload, which does not — packages/mediatek/docs/songs.md.

import { wrap } from "@frediverse/http/route";
import { NotWritableError, PathEscapesError } from "@studio/mediatek/layout";
import {
  NotAudioError,
  SongExistsError,
  TagsRefusedError,
  VariantRefusedError,
} from "@studio/mediatek/song";
import { UntaggableError } from "@studio/mediatek/tags";
import type { MasterTags } from "@studio/mediatek/types";
import {
  addSong,
  addSongVariant,
  makeFolder,
  moveEntry,
  putFile,
  removeFile,
  removeSongVariant,
  removeTree,
  setSongTags,
} from "@studio/mediatek/write";
import express, { type Response, Router } from "express";
import { allowManage, moveNeedsManager } from "../../libraryGate.ts";
import { rawToDisk, uploadOf } from "../../upload.ts";

export const writeRoutes: Router = Router();

/** Refusals a caller can fix, told apart from the ones they cannot. */
export function writeError(e: unknown, res: Response): boolean {
  if (e instanceof PathEscapesError || e instanceof NotWritableError) {
    res.status(400).json({ error: (e as Error).message });
    return true;
  }
  return false;
}

/** Put one file in. Raw body rather than multipart, streamed to disk: a 400 MB video is never a field in a parse. */
writeRoutes.put(
  "/file",
  rawToDisk(),
  wrap((req, res) => {
    const rel = String(req.query.path ?? "");
    if (!rel) return res.status(400).json({ error: "path required" });
    try {
      putFile(rel, uploadOf(req));
    } catch (e) {
      if (writeError(e, res)) return;
      throw e;
    }
    res.json({ ok: true, path: rel });
  }),
);

/** One upload as a filed song: three tags in, the LIBRARY derives the path — mediatek's songs.md. */
writeRoutes.post(
  "/song",
  rawToDisk(),
  wrap(async (req, res) => {
    const q = req.query as Record<string, unknown>;
    const s = (k: string): string =>
      typeof q[k] === "string" ? (q[k] as string) : "";
    const filename = s("filename");
    if (!filename) return res.status(400).json({ error: "filename required" });
    const upload = uploadOf(req);
    if (!upload.size) return res.status(400).json({ error: "empty body" });
    const bytes = { file: upload.file };
    try {
      const r = await addSong({
        filename,
        bytes,
        tags: {
          artist: s("artist"),
          album: s("album"),
          title: s("title"),
          // Who filed it — k7 says so here, which is what marks a folder as not somebody's drop.
          source: s("source") || undefined,
        },
        replace: s("replace") === "1",
      });
      res.json({ ok: true, ...r });
    } catch (e) {
      // Already there is a 409, not a 400: the request is well formed and the fix is a decision.
      if (e instanceof SongExistsError)
        return res.status(409).json({ error: e.message, exists: true });
      if (e instanceof NotAudioError)
        return res.status(400).json({ error: e.message });
      if (writeError(e, res)) return;
      throw e;
    }
  }),
);

/** An upload as a VARIANT: the folder is named, the file never — mediatek's docs/variants.md. */
writeRoutes.post(
  "/variant",
  rawToDisk(),
  wrap((req, res) => {
    const q = req.query as Record<string, unknown>;
    const s = (k: string): string =>
      typeof q[k] === "string" ? (q[k] as string) : "";
    const path = s("path");
    const filename = s("filename");
    if (!path) return res.status(400).json({ error: "path required" });
    if (!filename) return res.status(400).json({ error: "filename required" });
    const upload = uploadOf(req);
    if (!upload.size) return res.status(400).json({ error: "empty body" });
    const bytes = { file: upload.file };
    try {
      res.json({
        ok: true,
        ...addSongVariant({
          folder: path,
          filename,
          bytes,
          // Absent, the file's own stem names it — which is what the médiathèque sends.
          name: s("name") || undefined,
        }),
      });
    } catch (e) {
      // Both refusals are the caller's to fix, and neither is a retry of the same request.
      if (e instanceof VariantRefusedError || e instanceof NotAudioError)
        return res.status(400).json({ error: e.message });
      if (writeError(e, res)) return;
      throw e;
    }
  }),
);

/** Un-declare a variant and remove the file it named — mediatek's docs/variants.md. */
writeRoutes.delete(
  "/variant",
  wrap((req, res) => {
    const path = String(req.query.path ?? "");
    const name = String(req.query.name ?? "");
    if (!path) return res.status(400).json({ error: "path required" });
    if (!name) return res.status(400).json({ error: "name required" });
    if (!allowManage(req, res)) return;
    try {
      removeSongVariant(path, name);
    } catch (e) {
      if (e instanceof VariantRefusedError)
        return res.status(400).json({ error: e.message });
      if (writeError(e, res)) return;
      throw e;
    }
    res.json({ ok: true });
  }),
);

/** A song's tags rewritten in its master, by the FOLDER; a field absent is kept, `""` clears it — mediatek's docs/songs.md. */
writeRoutes.put(
  "/tags",
  express.json(),
  wrap(async (req, res) => {
    const path = String(req.query.path ?? "");
    if (!path) return res.status(400).json({ error: "path required" });
    const body = (req.body ?? {}) as Record<string, unknown>;
    const patch: Partial<Record<keyof MasterTags, string | number>> = {};
    for (const f of ["title", "artist", "album", "key"] as const)
      if (f in body) patch[f] = String(body[f] ?? "");
    if ("bpm" in body) {
      const bpm = body.bpm === "" || body.bpm == null ? "" : Number(body.bpm);
      if (bpm !== "" && !(Number.isFinite(bpm) && bpm > 0))
        return res.status(400).json({ error: "bpm must be a positive number" });
      patch.bpm = bpm;
    }
    if ("track" in body) {
      const track =
        body.track === "" || body.track == null ? "" : Number(body.track);
      if (track !== "" && !(Number.isInteger(track) && track > 0))
        return res
          .status(400)
          .json({ error: "track must be a positive whole number" });
      patch.track = track;
    }
    try {
      res.json(await setSongTags(path, patch));
    } catch (e) {
      if (e instanceof TagsRefusedError)
        return res.status(400).json({ error: e.message });
      // The file is there and is not one TagLib can write: nothing about the request will fix it.
      if (e instanceof UntaggableError)
        return res.status(422).json({ error: e.message });
      if (writeError(e, res)) return;
      throw e;
    }
  }),
);

/** Move or rename in one syscall, folders included — see packages/mediatek/docs/index.md. */
writeRoutes.post(
  "/move",
  express.json(),
  wrap((req, res) => {
    const { from, to } = (req.body ?? {}) as { from?: string; to?: string };
    if (!from || !to)
      return res.status(400).json({ error: "from and to required" });
    try {
      // A file renamed to a free name is anyone's; a folder, or a file replaced, is not.
      if (moveNeedsManager(from, to) && !allowManage(req, res)) return;
      moveEntry(from, to);
    } catch (e) {
      if (writeError(e, res)) return;
      throw e;
    }
    res.json({ ok: true, path: to });
  }),
);

/** An empty folder — somewhere to drop into before the first file exists. */
writeRoutes.post(
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

/** A whole subtree — separate from DELETE /file, so it is never done while meaning one entry. Admin only. */
writeRoutes.delete(
  "/folder",
  wrap((req, res) => {
    const rel = String(req.query.path ?? "");
    if (!rel) return res.status(400).json({ error: "path required" });
    if (!allowManage(req, res)) return;
    try {
      removeTree(rel);
    } catch (e) {
      if (writeError(e, res)) return;
      throw e;
    }
    res.json({ ok: true });
  }),
);

/** Take one out, admin only: no file records which account filed it. Absent is success. */
writeRoutes.delete(
  "/file",
  wrap((req, res) => {
    const rel = String(req.query.path ?? "");
    if (!rel) return res.status(400).json({ error: "path required" });
    if (!allowManage(req, res)) return;
    try {
      removeFile(rel);
    } catch (e) {
      if (writeError(e, res)) return;
      throw e;
    }
    res.json({ ok: true });
  }),
);
