// zones.ts — the zones no family scan reaches, each with its own listing: the raw captures and
// the set lists — packages/mediatek/docs/recordings.md, ../../../../docs/media/playlists.md.

import { wrap } from "@frediverse/http/route";
import {
  createPlaylist,
  listPlaylists,
  PlaylistExistsError,
} from "@studio/mediatek/playlists";
import { addRecording, listRecordings } from "@studio/mediatek/recordings";
import { NotAudioError } from "@studio/mediatek/song";
import express, { Router } from "express";
import { rawToDisk, uploadOf } from "../../upload.ts";
import { writeError } from "./write.ts";

export const zoneRoutes: Router = Router();

/** The raw capture zone, day by day — its own listing, since no catalogue reaches it. */
zoneRoutes.get(
  "/recordings",
  wrap((_req, res) => {
    res.json({ days: listRecordings() });
  }),
);

/** The set lists — its own listing too, and for the same reason: no family scan reaches the zone. */
zoneRoutes.get(
  "/playlists",
  wrap(async (_req, res) => {
    res.json({ playlists: await listPlaylists() });
  }),
);

/** Create one, from the STUB — reading and writing it are `/file` and `PUT /file`; ../../../../docs/media/playlists.md. */
zoneRoutes.post(
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
zoneRoutes.post(
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
