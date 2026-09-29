// library.ts — the media library over HTTP: what exists, how stale a listing is, and the
// bytes themselves. The same vocabulary the LOCAL service serves, deliberately, so a cache
// can ask either side the same questions. Writing too — by path for the two callers that
// legitimately have one, and by TAGS for an upload, which does not. See docs/songs.md.

import { existsSync, statSync } from "node:fs";
import { streamFile } from "@frediverse/http";
import { wrap } from "@frediverse/http/route";
import { NoFfmpegError } from "@studio/audio-analysis/decode";
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
import { extOf, mimeFor } from "@studio/mediatek/media";
import {
  createPlaylist,
  listPlaylists,
  PlaylistExistsError,
} from "@studio/mediatek/playlists";
import { addRecording, listRecordings } from "@studio/mediatek/recordings";
import { revisions } from "@studio/mediatek/revision";
import {
  NotAudioError,
  SongExistsError,
  VariantRefusedError,
} from "@studio/mediatek/song";
import { asFamily, FAMILY_ERROR } from "@studio/mediatek/types";
import {
  addSong,
  addSongVariant,
  makeFolder,
  moveEntry,
  putFile,
  removeFile,
  removeSongVariant,
  removeTree,
  setSongBpm,
  setSongKey,
} from "@studio/mediatek/write";
import express, { Router } from "express";
import { analyseShared, ensureAnalysedShared } from "../analysisGate.ts";
import { sweepState } from "../analysisSweep.ts";
import {
  ensureStreamable,
  NoFfmpegError as NoTranscoderError,
} from "../transcode.ts";
import { rawToDisk, uploadOf } from "../upload.ts";

export const libraryRouter: Router = Router();

// Guard, refusal and content types come from @studio/mediatek — see its docs/mime.md.
const badFamily = { error: FAMILY_ERROR };

/** Is there a library on this volume, and how much is in it. */
libraryRouter.get(
  "/",
  wrap((_req, res) => {
    // The root is a server path and stays one — a client is never told where the disk is.
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

/** One family's FILES as (path, bytes, mtime) — `/list` describes entries, and a song is many. */
libraryRouter.get(
  "/manifest",
  wrap((req, res) => {
    const family = asFamily(req.query.family);
    if (!family) return res.status(400).json(badFamily);
    res.json({ family, rev: revisions()[family], files: manifest(family) });
  }),
);

/** Filter across families. What a query MEANS belongs to the catalogue, not here: see parseQuery. */
libraryRouter.get(
  "/search",
  wrap((req, res) => {
    res.json({ entries: search(parseQuery(req.query)) });
  }),
);

/** One file's bytes, with Range; `safePath` is the ONLY wall between the query string and disk. */
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

/**
 * Like `/file`, except a FLAC is served as its transcoded MP3 — made once, cached under
 * `.cache/stream/`, and reused after. Any other format passes straight through. See
 * docs/streaming.md.
 */
libraryRouter.get(
  "/stream",
  wrap(async (req, res) => {
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
    if (extOf(abs) !== ".flac") return streamFile(req, res, abs, mimeFor(abs));

    let mp3: string;
    try {
      mp3 = await ensureStreamable(rel, abs);
    } catch (e) {
      if (e instanceof NoTranscoderError)
        return res.status(503).json({ error: e.message });
      throw e;
    }
    streamFile(req, res, mp3, "audio/mpeg");
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

/** Put one file in. Raw body rather than multipart, streamed to disk: a 400 MB video is never a field in a parse. */
libraryRouter.put(
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
libraryRouter.post(
  "/song",
  rawToDisk(),
  wrap((req, res) => {
    const q = req.query as Record<string, unknown>;
    const s = (k: string): string =>
      typeof q[k] === "string" ? (q[k] as string) : "";
    const filename = s("filename");
    if (!filename) return res.status(400).json({ error: "filename required" });
    const upload = uploadOf(req);
    if (!upload.size) return res.status(400).json({ error: "empty body" });
    const bytes = { file: upload.file };
    try {
      const r = addSong({
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
libraryRouter.post(
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
libraryRouter.delete(
  "/variant",
  wrap((req, res) => {
    const path = String(req.query.path ?? "");
    const name = String(req.query.name ?? "");
    if (!path) return res.status(400).json({ error: "path required" });
    if (!name) return res.status(400).json({ error: "name required" });
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

/** What the background sweep is doing — the backlog it found, and whether it has a decoder at all. */
libraryRouter.get(
  "/analysis",
  wrap((_req, res) => {
    res.json(sweepState());
  }),
);

/**
 * Measure one file HERE and write its `.cache` sidecar beside it. This service holds the bytes
 * and has ffmpeg, so nothing is asked of an engine — see packages/audio-analysis/docs/analysis.md.
 */
libraryRouter.post(
  "/analyse",
  express.json(),
  wrap(async (req, res) => {
    const path = String(req.body?.path ?? "");
    if (!path) return res.status(400).json({ error: "path required" });

    let source: string;
    try {
      source = safePath(path);
    } catch (e) {
      if (e instanceof PathEscapesError)
        return res.status(400).json({ error: e.message });
      throw e;
    }
    if (!existsSync(source))
      return res.status(404).json({ error: `${path} is not here` });

    let env: Awaited<ReturnType<typeof analyseShared>>;
    try {
      env = await analyseShared(source);
    } catch (e) {
      // A missing decoder is this deployment's to fix, and it is not the caller's request that is wrong.
      if (e instanceof NoFfmpegError)
        return res.status(503).json({ error: e.message });
      return res.status(422).json({ error: (e as Error).message });
    }

    // …and the tempo, best effort and reported: `set: false` is not a failure.
    let bpmSet = false;
    const folder = path.split("/").slice(0, -1).join("/");
    if (env.bpm > 0 && folder)
      try {
        bpmSet = setSongBpm(folder, env.bpm);
      } catch {
        /* reported as `bpmSet: false` — the analysis itself stands */
      }
    res.json({
      bpm: env.bpm,
      bpmSet,
      transients: env.transients.length,
      seconds: env.seconds,
    });
  }),
);

/**
 * A file's measured shape for a caller drawing a waveform — the cached sidecar when the file
 * has not moved, a fresh analysis otherwise, never both work twice. See docs/analysis.md.
 */
libraryRouter.get(
  "/envelope",
  wrap(async (req, res) => {
    const path = String(req.query.path ?? "");
    if (!path) return res.status(400).json({ error: "path required" });

    let source: string;
    try {
      source = safePath(path);
    } catch (e) {
      if (e instanceof PathEscapesError)
        return res.status(400).json({ error: e.message });
      throw e;
    }
    if (!existsSync(source))
      return res.status(404).json({ error: `${path} is not here` });

    try {
      const env = await ensureAnalysedShared(source);
      res.json({
        sampleRate: env.sampleRate,
        seconds: env.seconds,
        rms: env.rms,
        transients: env.transients,
      });
    } catch (e) {
      if (e instanceof NoFfmpegError)
        return res.status(503).json({ error: e.message });
      res.status(422).json({ error: (e as Error).message });
    }
  }),
);

/** Seed a detected tempo, from a caller that measured it elsewhere — mediatek's docs/songs.md. */
libraryRouter.post(
  "/bpm",
  express.json(),
  wrap((req, res) => {
    const path = String(req.body?.path ?? "");
    const bpm = Number(req.body?.bpm);
    if (!path) return res.status(400).json({ error: "path required" });
    if (!Number.isFinite(bpm) || bpm <= 0)
      return res.status(400).json({ error: "bpm must be a positive number" });
    try {
      res.json({ set: setSongBpm(path, bpm, req.body?.force === true) });
    } catch (e) {
      if (writeError(e, res)) return;
      throw e;
    }
  }),
);

/** A song's KEY — a fact about the RECORDING, so it lives here and not in one set's mix.yaml.
 *
 * Typed rather than detected: a key entered by hand is right, and the detector measured 53 %
 * (docs/key-detection-plan.md). `force` is the same door the tempo has, for the same reason. */
libraryRouter.post(
  "/key",
  express.json(),
  wrap((req, res) => {
    const path = String(req.body?.path ?? "");
    const key = String(req.body?.key ?? "");
    if (!path) return res.status(400).json({ error: "path required" });
    // A refused SHAPE and a refused overwrite are different answers; only the first is a 400.
    if (!/^[A-G]#?\s+(major|minor)$/.test(key.trim()))
      return res
        .status(400)
        .json({ error: "key must read like `C# minor` or `A major`" });
    try {
      res.json({ set: setSongKey(path, key, req.body?.force === true) });
    } catch (e) {
      if (writeError(e, res)) return;
      throw e;
    }
  }),
);

/** The raw capture zone, day by day — its own listing, since no catalogue reaches it. */
libraryRouter.get(
  "/recordings",
  wrap((_req, res) => {
    res.json({ days: listRecordings() });
  }),
);

/** The set lists — its own listing too, and for the same reason: no family scan reaches the zone. */
libraryRouter.get(
  "/playlists",
  wrap((_req, res) => {
    res.json({ playlists: listPlaylists() });
  }),
);

/** Create one, from the STUB — reading and writing it are `/file` and `PUT /file`; ../docs/playlists.md. */
libraryRouter.post(
  "/playlists",
  express.json(),
  wrap((req, res) => {
    const name = String(req.body?.name ?? "");
    if (!name) return res.status(400).json({ error: "name required" });
    try {
      res.json({ ok: true, playlist: createPlaylist(name) });
    } catch (e) {
      // A taken name is a 409: the caller asked for a NEW one, and this is not a retry.
      if (e instanceof PlaylistExistsError)
        return res.status(409).json({ error: e.message });
      if (e instanceof RangeError)
        return res.status(400).json({ error: e.message });
      if (writeError(e, res)) return;
      throw e;
    }
  }),
);

/** Push one capture in — the route the machines use; see packages/mediatek/docs/recordings.md. */
libraryRouter.post(
  "/recording",
  rawToDisk(),
  wrap((req, res) => {
    const q = req.query as Record<string, unknown>;
    const s = (k: string): string =>
      typeof q[k] === "string" ? (q[k] as string) : "";
    const filename = s("filename");
    if (!filename) return res.status(400).json({ error: "filename required" });
    const upload = uploadOf(req);
    if (!upload.size) return res.status(400).json({ error: "empty body" });
    const bytes = { file: upload.file };
    let at: Date | undefined;
    if (s("at")) {
      at = new Date(s("at"));
      // Refused rather than falling back to now: today is the one answer the caller did not mean.
      if (Number.isNaN(at.getTime()))
        return res.status(400).json({ error: `at: not a date: ${s("at")}` });
    }
    // Present == a MOMENT cut out of a session, which the zone names differently.
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

/** Move or rename in one syscall, folders included — see packages/mediatek/docs/index.md. */
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

/** A whole subtree — separate from DELETE /file, so it is never done while meaning one entry. */
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
