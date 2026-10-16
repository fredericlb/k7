/* Releases: standalone finished songs, each with one or more audio versions. */

import { ownerGuard, sub, validate, wrap } from "@frediverse/http";
import { diskUpload } from "@frediverse/http/upload";
import { type Request, type Response, Router } from "express";
import { z } from "zod";
import { isAudioMime, streamAudio } from "../serve.ts";
import * as store from "../store.ts";
import { keepingUploads } from "../uploads.ts";

// Mixdowns and stems arrive on DISK — sixty-four stems of a gigabyte must not sit in RAM (../../docs/audit.md).
const upload = diskUpload(store.UPLOAD_DIR);

const versionPatch = z.object({
  isDefault: z.boolean().optional(),
  name: z.string().optional(),
  hidden: z.boolean().optional(),
});

const releasePatch = z.object({
  title: z.string().trim().min(1).optional(),
  artist: z.string().trim().min(1).optional(),
  releaseDate: z.string().nullable().optional(),
  description: z.string().optional(),
  canDownload: z.boolean().optional(),
});

/** The one uploaded audio file, or null once a 400 has answered — the type is served back, so only audio passes. */
function audioPart(
  req: Request,
  res: Response,
): { file: string; mime: string } | null {
  if (!req.file?.size) {
    res.status(400).json({ error: "missing audio file" });
    return null;
  }
  if (!isAudioMime(req.file.mimetype)) {
    res.status(400).json({ error: `not an audio file: ${req.file.mimetype}` });
    return null;
  }
  return { file: req.file.path, mime: req.file.mimetype };
}

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
  keepingUploads(async (req, res) => {
    const title = String(req.body.title || "").trim();
    const artist = String(req.body.artist || "").trim();
    if (!title || !artist)
      return res.status(400).json({ error: "title and artist are required" });
    const mixdown = audioPart(req, res);
    if (!mixdown) return;

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
        mixdown,
        tracks: [],
      },
    );
    res.status(201).json(release);
  }),
);

// --- CLI import (k7 export): create-or-version by song UUID -----------

// A known songUuid adds a version; an unknown one creates a release, needing title + artist.
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
  keepingUploads(async (req, res) => {
    const owner = sub(req);
    const songUuid = String(req.body.songUuid || "").trim();
    if (!songUuid)
      return res.status(400).json({ error: "songUuid is required" });

    const files = req.files as
      | { mixdown?: Express.Multer.File[]; tracks?: Express.Multer.File[] }
      | undefined;
    const mix = files?.mixdown?.[0];
    if (!mix?.size)
      return res.status(400).json({ error: "missing mixdown file" });
    const stems = files?.tracks || [];
    const bad = [mix, ...stems].find((f) => !isAudioMime(f.mimetype));
    if (bad)
      return res
        .status(400)
        .json({ error: `unsupported file type: ${bad.mimetype}` });

    const mixdown = { file: mix.path, mime: mix.mimetype };
    const tracks = stems.map((f) => ({
      file: f.path,
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

releasesRouter.patch(
  "/:rid",
  validate(releasePatch),
  wrap(async (req, res) => {
    const release = await store.updateRelease(req.params.rid, req.body);
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
  keepingUploads(async (req, res) => {
    const mixdown = audioPart(req, res);
    if (!mixdown) return;
    const version = await store.addVersion(
      req.params.rid,
      {
        name: String(req.body.name || "").trim() || "Version",
        isDefault: req.body.isDefault === "true",
      },
      mixdown,
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
    if (typeof req.body.hidden === "boolean")
      await store.setVersionHidden(
        req.params.rid,
        req.params.vid,
        req.body.hidden,
      );
    res.json(await store.getRelease(req.params.rid));
  }),
);

/** A version's shape, for the waveform that replaced the native transport — ../../docs/audio.md. */
releasesRouter.get(
  "/:rid/versions/:vid/envelope",
  wrap(async (req, res) => {
    const envelope = await store.versionEnvelope(
      req.params.rid,
      req.params.vid,
    );
    if (!envelope) return res.status(404).json({ error: "no audio" });
    res.json(envelope);
  }),
);

/** The file itself, swapped: PUT beside the GET that serves it — ../../docs/audio.md. */
releasesRouter.put(
  "/:rid/versions/:vid/audio",
  upload.single("audio"),
  keepingUploads(async (req, res) => {
    const mixdown = audioPart(req, res);
    if (!mixdown) return;
    const release = await store.replaceVersionAudio(
      req.params.rid,
      req.params.vid,
      mixdown,
    );
    if (!release) return res.status(404).json({ error: "not found" });
    res.json(release);
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
    streamAudio(req, res, info.filePath, info.mime);
  }),
);

// The same bytes as /audio, saved under the release's own name rather than played.
releasesRouter.get(
  "/:rid/versions/:vid/download",
  wrap(async (req, res) => {
    const release = await store.getRelease(req.params.rid);
    const version = release?.versions?.find((v) => v.id === req.params.vid);
    const info = await store.ensureVersionAudioCached(
      req.params.rid,
      req.params.vid,
    );
    if (!release || !version || !info)
      return res.status(404).json({ error: "no audio" });
    res.attachment(store.versionFileName(release, version, info.mime));
    streamAudio(req, res, info.filePath, info.mime);
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
    streamAudio(req, res, info.filePath, info.mime);
  }),
);
