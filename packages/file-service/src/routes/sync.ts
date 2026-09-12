// sync.ts (routes) — the set-list sync targets this MACHINE knows, and copying a playlist onto
// one. Mounted before resolveWorkspace, like separate.ts: a target is a property of the machine,
// not of a project. The tracks arrive resolved — pl8 holds the catalogue. See ../../docs/playlistSync.md.

import { wrap } from "@frediverse/http/route";
import { loadPreferences, setSyncTargets } from "@studio/song/preferences";
import { parseSyncTarget, safeUri } from "@studio/song-schema/syncTarget";
import { Router } from "express";
import { type SyncTrack, startSync, syncJob } from "../sync/syncPlaylist.ts";

export const syncRouter: Router = Router();

/** The targets, with every URI BLANKED of its password: a listing crosses to a browser. */
syncRouter.get(
  "/sync/targets",
  wrap((_req, res) => {
    const targets = loadPreferences().syncTargets ?? [];
    res.json({
      targets: targets.map((t) => ({
        name: t.name,
        uri: safeUri(t.uri),
        scheme: parseSyncTarget(t.uri)?.scheme ?? null,
      })),
    });
  }),
);

/** Declare them. The whole list at once, since that is how the preferences file holds it. */
syncRouter.put(
  "/sync/targets",
  wrap((req, res) => {
    const raw = req.body?.targets;
    if (!Array.isArray(raw))
      return res.status(400).json({ error: "targets must be a list" });
    const refused = raw
      .filter((t: { uri?: string }) => !parseSyncTarget(String(t?.uri ?? "")))
      .map((t: { uri?: string }) => String(t?.uri ?? ""));
    // Named rather than dropped in silence: a target typed `sftp://` is a mistake with a remedy.
    if (refused.length)
      return res.status(400).json({
        error: `not a target URI (file:// or ftp:// only): ${refused.join(", ")}`,
      });
    const prefs = setSyncTargets(raw);
    res.json({ targets: prefs.syncTargets ?? [] });
  }),
);

/** Start a copy onto one target, by NAME — the URI stays here, password included. */
syncRouter.post(
  "/sync",
  wrap((req, res) => {
    const name = String(req.body?.target ?? "");
    const playlist = String(req.body?.playlist ?? "");
    const tracks = req.body?.tracks;
    if (!name) return res.status(400).json({ error: "target required" });
    if (!playlist) return res.status(400).json({ error: "playlist required" });
    if (!Array.isArray(tracks) || !tracks.length)
      return res.status(400).json({ error: "tracks must be a non-empty list" });

    const target = (loadPreferences().syncTargets ?? []).find(
      (t) => t.name === name,
    );
    // 404 and not 400: the caller read this name off this machine's own listing a moment ago.
    if (!target)
      return res
        .status(404)
        .json({ error: `this machine has no sync target named '${name}'` });

    const clean: SyncTrack[] = tracks
      .map((t: Partial<SyncTrack>) => ({
        path: String(t?.path ?? ""),
        artist: String(t?.artist ?? ""),
        album: String(t?.album ?? ""),
        title: String(t?.title ?? ""),
      }))
      .filter((t: SyncTrack) => t.path && t.title);
    if (!clean.length)
      return res.status(400).json({ error: "no track carries a path" });

    res.json(startSync({ target, playlist, tracks: clean }));
  }),
);

syncRouter.get(
  "/sync/:id",
  wrap((req, res) => {
    const job = syncJob(req.params.id);
    // 404 rather than a synthetic "done", as separate.ts does: a forgotten job cannot be waited on.
    if (!job) return res.status(404).json({ error: "unknown sync job" });
    res.json(job);
  }),
);
