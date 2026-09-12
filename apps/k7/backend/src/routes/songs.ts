/* Songbook: each song carries free-text lyrics / tablature, plus a sheet made of
   uploaded PDF / image files (not text).
*/

import { ownerGuard, streamFile, sub, validate, wrap } from "@frediverse/http";
import { upload } from "@frediverse/http/upload";
import { Router } from "express";
import { z } from "zod";
import * as store from "../store.ts";

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
  favorite: z.boolean().optional(),
});

// Sheets accept PDFs and common raster/vector image types.
const SHEET_MIME =
  /^(application\/pdf|image\/(png|jpeg|jpg|gif|webp|svg\+xml))$/;

export const songsRouter = Router();

songsRouter.param("sid", ownerGuard(store.getSongOwner));

songsRouter.get(
  "/",
  wrap(async (req, res) => {
    res.json(await store.listSongs(sub(req)));
  }),
);

songsRouter.post(
  "/",
  validate(createSchema),
  wrap(async (req, res) => {
    const song = await store.createSong(sub(req), req.body);
    res.status(201).json(song);
  }),
);

songsRouter.get(
  "/:sid",
  wrap(async (req, res) => {
    const song = await store.getSong(req.params.sid);
    if (!song) return res.status(404).json({ error: "not found" });
    res.json(song);
  }),
);

songsRouter.patch(
  "/:sid",
  validate(patchSchema),
  wrap(async (req, res) => {
    const song = await store.updateSong(req.params.sid, req.body);
    if (!song) return res.status(404).json({ error: "not found" });
    res.json(song);
  }),
);

// --- Sheet files (PDF / images) -------------------------------------------

songsRouter.post(
  "/:sid/sheets",
  upload.array("files"),
  wrap(async (req, res) => {
    const uploaded = (req.files as Express.Multer.File[] | undefined) || [];
    if (!uploaded.length)
      return res.status(400).json({ error: "no files uploaded" });
    const bad = uploaded.find((f) => !SHEET_MIME.test(f.mimetype));
    if (bad)
      return res
        .status(400)
        .json({ error: `unsupported file type: ${bad.mimetype}` });

    const song = await store.addSheetFiles(
      req.params.sid,
      uploaded.map((f) => ({
        buffer: f.buffer,
        mime: f.mimetype,
        name: f.originalname,
      })),
    );
    if (!song) return res.status(404).json({ error: "not found" });
    res.status(201).json(song);
  }),
);

const sendSheet = wrap(async (req, res) => {
  const info = await store.ensureSheetFileCached(
    req.params.sid,
    req.params.fid,
  );
  if (!info) return res.status(404).json({ error: "not found" });
  streamFile(req, res, info.filePath, info.mime);
});

songsRouter.get("/:sid/sheets/:fid", sendSheet);
// The same bytes under a name-bearing address, which is what an EPUB reads a media type off — ../../../docs/export.md.
songsRouter.get("/:sid/sheets/:fid/:name", sendSheet);

// --- The reference track (one per song) ------------------------------------

// Whatever a browser can play, which is wider than what it can record.
const AUDIO_MIME = /^audio\//;

songsRouter.post(
  "/:sid/audio",
  upload.single("audio"),
  wrap(async (req, res) => {
    const file = req.file as Express.Multer.File | undefined;
    if (!file?.buffer?.length)
      return res.status(400).json({ error: "no audio file" });
    if (!AUDIO_MIME.test(file.mimetype))
      return res
        .status(400)
        .json({ error: `not an audio file: ${file.mimetype}` });

    const song = await store.setSongAudio(req.params.sid, {
      buffer: file.buffer,
      mime: file.mimetype,
      name: file.originalname,
    });
    if (!song) return res.status(404).json({ error: "not found" });
    res.status(201).json(song);
  }),
);

songsRouter.get(
  "/:sid/audio",
  wrap(async (req, res) => {
    const info = await store.ensureSongAudioCached(req.params.sid);
    if (!info) return res.status(404).json({ error: "no audio" });
    // streamFile answers Range, which is what lets the player's bar seek.
    streamFile(req, res, info.filePath, info.mime);
  }),
);

songsRouter.delete(
  "/:sid/audio",
  wrap(async (req, res) => {
    const song = await store.deleteSongAudio(req.params.sid);
    if (!song) return res.status(404).json({ error: "not found" });
    res.json(song);
  }),
);

songsRouter.delete(
  "/:sid/sheets/:fid",
  wrap(async (req, res) => {
    const song = await store.deleteSheetFile(req.params.sid, req.params.fid);
    if (!song) return res.status(404).json({ error: "not found" });
    res.json(song);
  }),
);

songsRouter.delete(
  "/:sid",
  wrap(async (req, res) => {
    const ok = await store.deleteSong(req.params.sid);
    if (!ok) return res.status(404).json({ error: "not found" });
    res.status(204).end();
  }),
);
