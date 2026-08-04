// HTTP surface of playlist mode. The backend only resolves playlist links and
// keeps scores — no audio is ever downloaded or stored, which is what Deezer's
// guidelines require. /playlists/preview/:id is the one moving part: it hands
// out a freshly-signed CDN URL by redirect, so the client never has to care
// that preview signatures expire after ~15 minutes.

import type { Request, Response } from "express";
import { currentUser, isAdmin } from "../auth/session.ts";
import { gameState } from "../gameState.ts";
import type { GristClient } from "../grist/client.ts";
import { asFloat, asInt, asString } from "../grist/values.ts";
import { previewUrl } from "./deezer.ts";
import {
  type PlaylistRef,
  parsePlaylistURL,
  resolvePlaylist,
} from "./resolve.ts";
import { SpotifyNotConfigured, spotifyConfigured } from "./spotify.ts";

const gristOr503 = (res: Response): GristClient | null => {
  if (!gameState.gristClient) {
    res.status(503).json({ error: "grist not configured" });
    return null;
  }
  return gameState.gristClient;
};

const idParam = (req: Request, res: Response): number => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "invalid id" });
    return 0;
  }
  return id;
};

/** Map a resolver/upstream failure to a status the SPA can act on. */
function failed(res: Response, err: unknown): void {
  if (err instanceof SpotifyNotConfigured) {
    res.status(501).json({ error: String(err.message) });
    return;
  }
  res.status(502).json({ error: String(err) });
}

interface PlaylistRow {
  id: number;
  provider: string;
  playlistId: string;
  url: string;
  name: string;
  cover: string;
  trackCount: number;
  addedBy: string;
}

const rowFrom = (id: number, f: Record<string, unknown>): PlaylistRow => ({
  id,
  provider: asString(f.provider),
  playlistId: asString(f.playlistId),
  url: asString(f.url),
  name: asString(f.name),
  cover: asString(f.cover),
  trackCount: asInt(f.trackCount),
  addedBy: asString(f.addedBy),
});

/** The saved row for a ref, or null — the dedup key is (provider, playlistId). */
async function findPlaylist(
  g: GristClient,
  ref: PlaylistRef,
): Promise<PlaylistRow | null> {
  const rows = await g.listRecords("Playlists", {
    provider: ref.provider,
    playlistId: ref.id,
  });
  return rows.length > 0 ? rowFrom(rows[0].id, rows[0].fields) : null;
}

// GET /playlists — every saved playlist plus the caller's score on each.
export async function handleListPlaylists(
  req: Request,
  res: Response,
): Promise<void> {
  const g = gristOr503(res);
  if (!g) return;
  let rows;
  try {
    rows = await g.listRecords("Playlists");
  } catch (err) {
    failed(res, err);
    return;
  }

  const scores = new Map<number, number>();
  const u = currentUser(req);
  if (u?.sub) {
    try {
      for (const r of await g.listRecords("PlaylistScores", { user: u.sub })) {
        const pid = asInt(r.fields.playlist);
        if (pid > 0) scores.set(pid, asFloat(r.fields.value));
      }
    } catch (err) {
      console.log(`[Playlist] list scores (${u.sub}): ${err}`);
    }
  }

  const playlists = rows
    .map((r) => {
      const row = rowFrom(r.id, r.fields) as PlaylistRow & { score?: number };
      if (scores.has(r.id)) row.score = scores.get(r.id);
      return row;
    })
    .sort((a, b) => a.id - b.id);
  res.json({ playlists, spotify: spotifyConfigured() });
}

// POST /playlists — resolve a pasted URL and save the link. Idempotent: an
// already-saved playlist is returned as-is rather than duplicated.
export async function handleAddPlaylist(
  req: Request,
  res: Response,
): Promise<void> {
  const g = gristOr503(res);
  if (!g) return;

  let ref: PlaylistRef;
  try {
    ref = parsePlaylistURL(String(req.body?.url ?? ""));
  } catch (err) {
    res.status(400).json({ error: String((err as Error).message) });
    return;
  }

  try {
    const existing = await findPlaylist(g, ref);
    // Resolve regardless: it validates the link and warms the memo, so the
    // first game start doesn't pay for a full Spotify bridge.
    const resolved = await resolvePlaylist(ref, true);
    if (resolved.tracks.length === 0) {
      res
        .status(422)
        .json({ error: "no playable track found in that playlist" });
      return;
    }

    const fields = {
      provider: ref.provider,
      playlistId: ref.id,
      url: ref.url,
      name: resolved.name,
      cover: resolved.cover,
      trackCount: resolved.tracks.length,
    };
    if (existing) {
      await g.updateRecords("Playlists", new Map([[existing.id, fields]]));
      res.json({ playlist: { ...existing, ...fields } });
      return;
    }
    const [id] = await g.addRecords("Playlists", [
      {
        ...fields,
        addedBy: currentUser(req)?.sub ?? "",
        addedAt: Math.floor(Date.now() / 1000),
      },
    ]);
    console.log(
      `[Playlist] Added ${ref.provider} playlist ${ref.id} "${resolved.name}" (${resolved.tracks.length} playable, ${resolved.unavailable} unavailable)`,
    );
    res.json({ playlist: { id, addedBy: "", ...fields } });
  } catch (err) {
    failed(res, err);
  }
}

// DELETE /playlists/:id — the person who added it, or an admin.
export async function handleDeletePlaylist(
  req: Request,
  res: Response,
): Promise<void> {
  const g = gristOr503(res);
  if (!g) return;
  const id = idParam(req, res);
  if (id === 0) return;
  const u = currentUser(req);
  try {
    const rows = await g.listRecords("Playlists", { id });
    if (rows.length === 0) {
      res.status(404).json({ error: "unknown playlist" });
      return;
    }
    const addedBy = asString(rows[0].fields.addedBy);
    if (!isAdmin(u) && (!u?.sub || u.sub !== addedBy)) {
      res.status(403).json({ error: "not yours" });
      return;
    }
    // Cascade: a Ref to a deleted row would leave the leaderboard holding
    // scores nothing can ever display again.
    const scores = await g.listRecords("PlaylistScores", { playlist: id });
    if (scores.length > 0)
      await g.deleteRecords(
        "PlaylistScores",
        scores.map((r) => r.id),
      );
    await g.deleteRecords("Playlists", [id]);
    console.log(
      `[Playlist] Removed playlist ${id} (+${scores.length} score row(s))`,
    );
    res.json({ ok: true });
  } catch (err) {
    failed(res, err);
  }
}

// GET /playlists/:id/tracks — the playable list. Served from the resolver's
// memo, so repeat games on the same playlist don't re-hit the upstream APIs.
export async function handlePlaylistTracks(
  req: Request,
  res: Response,
): Promise<void> {
  const g = gristOr503(res);
  if (!g) return;
  const id = idParam(req, res);
  if (id === 0) return;
  try {
    const rows = await g.listRecords("Playlists", { id });
    if (rows.length === 0) {
      res.status(404).json({ error: "unknown playlist" });
      return;
    }
    const row = rowFrom(id, rows[0].fields);
    const resolved = await resolvePlaylist({
      provider: row.provider === "spotify" ? "spotify" : "deezer",
      id: row.playlistId,
      url: row.url,
    });
    res.json({
      id,
      name: resolved.name || row.name,
      cover: resolved.cover || row.cover,
      unavailable: resolved.unavailable,
      tracks: resolved.tracks,
    });
  } catch (err) {
    failed(res, err);
  }
}

// GET /playlists/preview/:deezerId — 302 to a currently-valid preview URL.
// Public (like /audio), because <audio> elements don't send credentials.
export async function handlePlaylistPreview(
  req: Request,
  res: Response,
): Promise<void> {
  const trackId = Number(req.params.deezerId);
  if (!Number.isInteger(trackId) || trackId <= 0) {
    res.status(400).json({ error: "invalid track id" });
    return;
  }
  let url: string | null;
  try {
    url = await previewUrl(trackId);
  } catch (err) {
    res.status(502).json({ error: String(err) });
    return;
  }
  if (!url) {
    res.status(404).json({ error: "no preview for that track" });
    return;
  }
  // Never cached downstream: the target is signed and short-lived.
  res.setHeader("Cache-Control", "no-store");
  res.redirect(302, url);
}

// ─── scores ─────────────────────────────────────────────────────────────────

// POST /playlists/:id/score — first completion wins, like the solo path.
export async function handlePlaylistScore(
  req: Request,
  res: Response,
): Promise<void> {
  const g = gristOr503(res);
  if (!g) return;
  const u = currentUser(req);
  if (!u?.sub) {
    res
      .status(403)
      .json({ error: "score saving requires a non-guest account" });
    return;
  }
  const playlistId = idParam(req, res);
  if (playlistId === 0) return;
  const score = Number(req.body?.score ?? NaN);
  if (Number.isNaN(score) || score < 0) {
    res.status(400).json({ error: "invalid score" });
    return;
  }

  try {
    const existing = await g.listRecords("PlaylistScores", {
      user: u.sub,
      playlist: playlistId,
    });
    if (existing.length > 0) {
      res.json({
        score: asFloat(existing[0].fields.value),
        persisted: false,
        playlistId,
      });
      return;
    }
    await g.addRecords("PlaylistScores", [
      {
        user: u.sub,
        playlist: playlistId,
        value: score,
        userName: u.name ?? "",
      },
    ]);
    res.json({ score, persisted: true, playlistId });
  } catch (err) {
    failed(res, err);
  }
}

// GET /playlists/:id/leaderboard — standard competition ranking (ties share a
// rank, the next one skips), mirroring the solo leaderboard.
export async function handlePlaylistLeaderboard(
  req: Request,
  res: Response,
): Promise<void> {
  const g = gristOr503(res);
  if (!g) return;
  const playlistId = idParam(req, res);
  if (playlistId === 0) return;
  let rows;
  try {
    rows = await g.listRecords("PlaylistScores", { playlist: playlistId });
  } catch (err) {
    failed(res, err);
    return;
  }

  const me = currentUser(req)?.sub ?? "";
  const entries = rows.map((r) => ({
    subject: asString(r.fields.user),
    name: asString(r.fields.userName) || "?",
    value: asFloat(r.fields.value),
  }));
  entries.sort((a, b) => {
    if (a.value !== b.value) return b.value - a.value;
    if (a.name !== b.name) return a.name < b.name ? -1 : 1;
    return a.subject < b.subject ? -1 : a.subject > b.subject ? 1 : 0;
  });

  let prevScore = -1;
  let rank = 0;
  const out = entries.map((e, i) => {
    if (i === 0 || e.value !== prevScore) rank = i + 1;
    prevScore = e.value;
    const entry: Record<string, unknown> = {
      rank,
      userName: e.name,
      score: e.value,
    };
    if (me !== "" && e.subject === me) entry.isMe = true;
    return entry;
  });
  res.json({ playlistId, entries: out });
}
