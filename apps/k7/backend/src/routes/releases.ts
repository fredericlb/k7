/* Releases: standalone finished songs, each with one or more audio versions. */

import { ownerGuard, streamFile, sub, validate, wrap } from "@frediverse/http";
import { upload } from "@frediverse/http/upload";
import { Router } from "express";
import { z } from "zod";
import * as store from "../store.ts";

const versionPatch = z.object({
  isDefault: z.boolean().optional(),
  name: z.string().optional(),
});

const AUDIO_MIME = /^audio\//;

export const releasesRouter = Router();

releasesRouter.param("rid", ownerGuard(store.getReleaseOwner));

releasesRouter.get(
  "/",
  wrap(async (req, res) => {
    res.json(await store.listReleases(sub(req)));
  }),
);

releasesRouter.post(
  "/",
  upload.single("audio"),
  wrap(async (req, res) => {
    const title = String(req.body.title || "").trim();
    const artist = String(req.body.artist || "").trim();
    if (!title || !artist)
      return res.status(400).json({ error: "title and artist are required" });
    if (!req.file?.buffer?.length)
      return res.status(400).json({ error: "missing audio file" });

    const release = await store.createRelease(
      sub(req),
      {
        title,
        artist,
        releaseDate: req.body.releaseDate || null,
        description: req.body.description || "",
        canDownload: req.body.canDownload === "true",
      },
      {
        name: String(req.body.versionName || "").trim() || "Version 1",
        mixdown: {
          buffer: req.file.buffer,
          mime: req.file.mimetype || "audio/mpeg",
        },
        tracks: [],
      },
    );
    res.status(201).json(release);
  }),
);

// --- CLI import (pistes export): create-or-version by song UUID -----------
// A multitrack upload: one mixdown (the playable) + N stems. If a release with
// this songUuid already exists (for this owner) a version is added; otherwise a
// new release is created — which requires title + artist.
releasesRouter.get(
  "/by-song/:uuid",
  wrap(async (req, res) => {
    const release = await store.getReleaseBySongUuid(sub(req), req.params.uuid);
    if (!release) return res.status(404).json({ error: "not found" });
    res.json(release);
  }),
);

releasesRouter.post(
  "/import",
  upload.fields([
    { name: "mixdown", maxCount: 1 },
    { name: "tracks", maxCount: 64 },
  ]),
  wrap(async (req, res) => {
    const owner = sub(req);
    const songUuid = String(req.body.songUuid || "").trim();
    if (!songUuid)
      return res.status(400).json({ error: "songUuid is required" });

    const files = req.files as
      | { mixdown?: Express.Multer.File[]; tracks?: Express.Multer.File[] }
      | undefined;
    const mix = files?.mixdown?.[0];
    if (!mix?.buffer?.length)
      return res.status(400).json({ error: "missing mixdown file" });
    const stems = files?.tracks || [];
    const bad = [mix, ...stems].find((f) => !AUDIO_MIME.test(f.mimetype));
    if (bad)
      return res
        .status(400)
        .json({ error: `unsupported file type: ${bad.mimetype}` });

    const mixdown = { buffer: mix.buffer, mime: mix.mimetype };
    const tracks = stems.map((f) => ({
      buffer: f.buffer,
      mime: f.mimetype,
      name: f.originalname,
    }));
    const versionName =
      String(req.body.versionName || "").trim() || new Date().toISOString();

    const existing = await store.getReleaseBySongUuid(owner, songUuid);
    if (existing) {
      await store.addVersion(
        existing.id,
        { name: versionName, isDefault: false },
        mixdown,
        tracks,
      );
      return res.status(200).json(await store.getRelease(existing.id));
    }

    const title = String(req.body.title || "").trim();
    const artist = String(req.body.artist || "").trim();
    if (!title || !artist)
      return res
        .status(400)
        .json({ error: "title and artist are required to create a release" });

    const release = await store.createRelease(
      owner,
      {
        title,
        artist,
        releaseDate: req.body.releaseDate || null,
        description: req.body.description || "",
        canDownload: req.body.canDownload === "true",
        songUuid,
      },
      { name: versionName, mixdown, tracks },
    );
    res.status(201).json(release);
  }),
);

releasesRouter.get(
  "/:rid",
  wrap(async (req, res) => {
    const release = await store.getRelease(req.params.rid);
    if (!release) return res.status(404).json({ error: "not found" });
    res.json(release);
  }),
);

releasesRouter.delete(
  "/:rid",
  wrap(async (req, res) => {
    const ok = await store.deleteRelease(req.params.rid);
    if (!ok) return res.status(404).json({ error: "not found" });
    res.status(204).end();
  }),
);

// --- Versions -------------------------------------------------------------

releasesRouter.post(
  "/:rid/versions",
  upload.single("audio"),
  wrap(async (req, res) => {
    if (!req.file?.buffer?.length)
      return res.status(400).json({ error: "missing audio file" });
    const version = await store.addVersion(
      req.params.rid,
      {
        name: String(req.body.name || "").trim() || "Version",
        isDefault: req.body.isDefault === "true",
      },
      { buffer: req.file.buffer, mime: req.file.mimetype || "audio/mpeg" },
      [],
    );
    res.status(201).json(version);
  }),
);

releasesRouter.patch(
  "/:rid/versions/:vid",
  validate(versionPatch),
  wrap(async (req, res) => {
    if (req.body.isDefault === true)
      await store.setDefaultVersion(req.params.rid, req.params.vid);
    if (typeof req.body.name === "string")
      await store.renameVersion(req.params.rid, req.params.vid, req.body.name);
    res.json(await store.getRelease(req.params.rid));
  }),
);

releasesRouter.delete(
  "/:rid/versions/:vid",
  wrap(async (req, res) => {
    const ok = await store.deleteVersion(req.params.rid, req.params.vid);
    if (!ok) return res.status(404).json({ error: "not found" });
    res.status(204).end();
  }),
);

releasesRouter.get(
  "/:rid/versions/:vid/audio",
  wrap(async (req, res) => {
    const info = await store.ensureVersionAudioCached(
      req.params.rid,
      req.params.vid,
    );
    if (!info) return res.status(404).json({ error: "no audio" });
    streamFile(req, res, info.filePath, info.mime);
  }),
);

// Stream/download one stem of a multitrack version.
releasesRouter.get(
  "/:rid/versions/:vid/tracks/:tid",
  wrap(async (req, res) => {
    const info = await store.ensureVersionTrackCached(
      req.params.rid,
      req.params.vid,
      req.params.tid,
    );
    if (!info) return res.status(404).json({ error: "not found" });
    streamFile(req, res, info.filePath, info.mime);
  }),
);
