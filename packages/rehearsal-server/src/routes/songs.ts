/* Songbook: each song carries free-text lyrics / tablature, plus a sheet made of
   uploaded PDF / image / score files (not text), all kept in its library folder. Every song is
   shared by everyone logged in and deleted by an admin; the star is each person's —
   ../../docs/ownership.md.
*/

import { sub, validate, wrap } from "@frediverse/http";
import { diskUpload } from "@frediverse/http/upload";
import { isAdmin, type SessionUser } from "@frediverse/oidc";
import { canonicalSheetMime } from "@studio/rehearsal-shared/sheetKind";
import { type Request, type Response, Router } from "express";
import { z } from "zod";
import { env } from "../env.ts";
import { searchLrclib } from "../lrclib.ts";
import { isAudioMime, streamSheet } from "../serve.ts";
import {
  LibraryPathError,
  linkLibraryInstrumental,
  linkLibraryTrack,
} from "../songFetch.ts";
import * as store from "../store.ts";
import { keepingUploads } from "../uploads.ts";

const MB = 1024 * 1024;
// On disk as they arrive, each bounded: a page of a score is never 50 MB, nor a sheet twenty files at once.
const sheetUpload = diskUpload(store.UPLOAD_DIR, 50 * MB);
const SHEET_FILES = 20;
// A reference track is one song: fifty minutes of CD-quality wav still fits — ../../docs/serving.md.
const trackUpload = diskUpload(store.UPLOAD_DIR, 500 * MB);

const required = "artist and title are required";
const createSchema = z.object({
  artist: z.string({ error: required }).trim().min(1, required),
  title: z.string({ error: required }).trim().min(1, required),
});

const patchSchema = z.object({
  artist: z.string().optional(),
  title: z.string().optional(),
  lyrics: z.string().optional(),
  tablature: z.string().optional(),
  // When each lyric line is sung, from an LRC file — ../../../ui-rehearsal/docs/lyricsTiming.md.
  lyricTimings: z
    .array(
      z.object({
        line: z.number().int().nonnegative(),
        text: z.string(),
        t: z.number().nonnegative(),
      }),
    )
    .optional(),
  // The auto-fetch pipeline's own state, written as it goes — fetchSong/run.ts's runPipeline.
  fetchStatus: z
    .object({
      phase: z
        .enum([
          "",
          "searching",
          "downloading",
          "stemming",
          "matching-lyrics",
          "failed",
        ])
        .optional(),
      progress: z.number().nullable().optional(),
      error: z.string().optional(),
      huntId: z.string().optional(),
      jobId: z.string().optional(),
    })
    .optional(),
  lyricsMatch: z.enum(["", "matched", "unmatched", "instrumental"]).optional(),
  fetchIgnored: z.boolean().optional(),
});

const favoriteSchema = z.object({ favorite: z.boolean() });

export const songsRouter = Router();

// Any logged-in user reaches any song; a missing one answers 404.
songsRouter.param("sid", (_req, res, next, sid) => {
  store
    .songVisibleTo(sid)
    .then((visible) =>
      visible ? next() : res.status(404).json({ error: "not found" }),
    )
    .catch(next);
});

// A copy of a server's song reads here and changes there; only its star and its removal are this machine's.
songsRouter.use("/:sid", (req, res, next) => {
  if (req.method === "GET" || req.method === "HEAD") return next();
  const own =
    (req.method === "DELETE" && req.path === "/") ||
    (req.method === "PUT" && req.path === "/favorite");
  if (own) return next();
  store
    .songOriginOf(req.params.sid)
    .then((origin) =>
      origin
        ? res
            .status(403)
            .json({ error: `a copy of ${origin}'s song: edit it there` })
        : next(),
    )
    .catch(next);
});

/** A copy is removed by whoever uses this machine; a song of its own by an admin. */
const mayDelete = (song: { origin: string }, req: Request): boolean =>
  song.origin
    ? true
    : isAdmin((req as { user?: SessionUser }).user, env.adminGroups);

/** A song as the asking user sees it, with whether they may delete it. */
const withRights = <T extends Parameters<typeof mayDelete>[0]>(
  song: T | null,
  req: Request,
) => song && { ...song, canDelete: mayDelete(song, req) };

/** The song again, as the asking user sees it — their star, whether they created it, whether they delete it. */
const sendSong = async (req: Request, res: Response, status = 200) => {
  const song = await store.getSong(req.params.sid, sub(req));
  if (!song) return res.status(404).json({ error: "not found" });
  res.status(status).json(withRights(song, req));
};

songsRouter.get(
  "/",
  wrap(async (req, res) => {
    const songs = await store.listSongs(sub(req));
    res.json(songs.map((s) => withRights(s, req)));
  }),
);

songsRouter.post(
  "/",
  validate(createSchema),
  wrap(async (req, res) => {
    const song = await store.createSong(sub(req), req.body);
    if (!song) return res.status(500).json({ error: "song was not created" });
    res
      .status(201)
      .json(withRights(await store.getSong(song.id, sub(req)), req));
  }),
);

songsRouter.get(
  "/:sid",
  wrap((req, res) => sendSong(req, res)),
);

songsRouter.patch(
  "/:sid",
  validate(patchSchema),
  wrap(async (req, res) => {
    if (!(await store.updateSong(req.params.sid, req.body)))
      return res.status(404).json({ error: "not found" });
    await sendSong(req, res);
  }),
);

songsRouter.put(
  "/:sid/favorite",
  validate(favoriteSchema),
  wrap(async (req, res) => {
    const song = await store.setSongFavorite(
      req.params.sid,
      sub(req),
      req.body.favorite,
    );
    if (!song) return res.status(404).json({ error: "not found" });
    res.json(withRights(song, req));
  }),
);

// Timed lyrics for this song on LRCLIB, nearest the track's length first; the pick is imported by the page.
songsRouter.get(
  "/:sid/lrclib",
  wrap(async (req, res) => {
    const song = await store.getSong(req.params.sid, sub(req));
    if (!song) return res.status(404).json({ error: "not found" });
    const duration = Number(req.query.duration) || undefined;
    try {
      res.json(await searchLrclib(song.artist, song.title, duration));
    } catch (err) {
      res.status(502).json({
        error: `LRCLIB could not be reached: ${(err as Error).message}`,
      });
    }
  }),
);

// --- Sheet files (PDF / images) -------------------------------------------

songsRouter.post(
  "/:sid/sheets",
  sheetUpload.array("files", SHEET_FILES),
  keepingUploads(async (req, res) => {
    const uploaded = (req.files as Express.Multer.File[] | undefined) || [];
    if (!uploaded.length)
      return res.status(400).json({ error: "no files uploaded" });
    const bad = uploaded.find(
      (f) => canonicalSheetMime(f.originalname, f.mimetype) === null,
    );
    if (bad)
      return res.status(400).json({
        error: `unsupported file type: ${bad.originalname} (${bad.mimetype})`,
      });

    const song = await store.addSheetFiles(
      req.params.sid,
      uploaded.map((f) => ({
        file: f.path,
        mime: canonicalSheetMime(f.originalname, f.mimetype) as string,
        name: f.originalname,
      })),
    );
    if (!song) return res.status(404).json({ error: "not found" });
    await sendSong(req, res, 201);
  }),
);

const sendSheet = wrap(async (req, res) => {
  const info = await store.ensureSheetFileCached(
    req.params.sid,
    req.params.fid,
  );
  if (!info) return res.status(404).json({ error: "not found" });
  streamSheet(req, res, info);
});

songsRouter.get("/:sid/sheets/:fid", sendSheet);
// The same bytes under a name-bearing address, which is what an EPUB reads a media type off — ../../../ui-rehearsal/docs/export.md.
songsRouter.get("/:sid/sheets/:fid/:name", sendSheet);

// --- The reference track (one per song) ------------------------------------

// Whatever a browser can play, which is wider than what it can record.
songsRouter.post(
  "/:sid/audio",
  trackUpload.single("audio"),
  keepingUploads(async (req, res) => {
    const file = req.file as Express.Multer.File | undefined;
    if (!file?.size) return res.status(400).json({ error: "no audio file" });
    if (!isAudioMime(file.mimetype))
      return res
        .status(400)
        .json({ error: `not an audio file: ${file.mimetype}` });

    const song = await store.setSongAudio(req.params.sid, {
      file: file.path,
      mime: file.mimetype,
      name: file.originalname,
    });
    if (!song) return res.status(404).json({ error: "not found" });
    await sendSong(req, res, 201);
  }),
);

// Unlink the track and its instrumental — what a pipeline re-run starts from; no file is deleted.
songsRouter.delete(
  "/:sid/audio",
  wrap(async (req, res) => {
    if (!(await store.unlinkSongAudio(req.params.sid)))
      return res.status(404).json({ error: "not found" });
    await sendSong(req, res);
  }),
);

// --- Linked to pl8's library: the track, and the instrumental beside its stems; the page streams both from pl8 — ../../docs/audio.md.

const libraryFileBody = z.object({ path: z.string().min(1) });
const libraryFolderBody = z.object({ folder: z.string().min(1) });

/** A refused path is the caller's mistake; anything else is the library failing. */
const fetchFailure = (res: Response, err: Error) =>
  err instanceof LibraryPathError
    ? res.status(400).json({ error: err.message })
    : res.status(502).json({ error: err.message });

songsRouter.post(
  "/:sid/audio/from-library",
  validate(libraryFileBody),
  wrap(async (req, res) => {
    try {
      if (!(await linkLibraryTrack(req.params.sid, req.body.path)))
        return res.status(404).json({ error: "not found" });
    } catch (err) {
      return fetchFailure(res, err as Error);
    }
    await sendSong(req, res, 201);
  }),
);

songsRouter.post(
  "/:sid/instrumental/from-library",
  validate(libraryFolderBody),
  wrap(async (req, res) => {
    try {
      if (!(await linkLibraryInstrumental(req.params.sid, req.body.folder)))
        return res.status(404).json({ error: "not found" });
    } catch (err) {
      return fetchFailure(res, err as Error);
    }
    await sendSong(req, res, 201);
  }),
);

/** The track's shape, for the waveform that replaces the native transport — ../../docs/audio.md. */
songsRouter.get(
  "/:sid/envelope",
  wrap(async (req, res) => {
    const envelope = await store.songEnvelope(req.params.sid);
    if (!envelope) return res.status(404).json({ error: "no track" });
    res.json(envelope);
  }),
);

songsRouter.delete(
  "/:sid/instrumental",
  wrap(async (req, res) => {
    if (!(await store.deleteSongInstrumental(req.params.sid)))
      return res.status(404).json({ error: "not found" });
    await sendSong(req, res);
  }),
);

songsRouter.delete(
  "/:sid/sheets/:fid",
  wrap(async (req, res) => {
    const song = await store.deleteSheetFile(req.params.sid, req.params.fid);
    if (!song) return res.status(404).json({ error: "not found" });
    await sendSong(req, res);
  }),
);

songsRouter.delete(
  "/:sid",
  wrap(async (req, res) => {
    // Anyone edits a song; deleting it is an admin's, a copy this machine's.
    const song = await store.getSong(req.params.sid, sub(req));
    if (!song) return res.status(404).json({ error: "not found" });
    if (!mayDelete(song, req))
      return res.status(403).json({ error: "only an admin can delete a song" });
    const ok = await store.deleteSong(req.params.sid);
    if (!ok) return res.status(404).json({ error: "not found" });
    res.status(204).end();
  }),
);
