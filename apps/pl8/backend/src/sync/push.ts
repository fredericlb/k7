// push.ts — copying a set list onto one of a machine's targets. pl8 resolves the playlist against
// its own catalogue and drives; the engine's machine holds the target and does the writing, the
// same division as a stem cut. The URI never comes here — a target is named. See ../../docs/sync.md.

import { readFileSync } from "node:fs";
import type { EngineEntry } from "@studio/engine-registry";
import { listFamily } from "@studio/mediatek/catalogue";
import { safePath } from "@studio/mediatek/layout";
import { resolveItems } from "@studio/mediatek/playlistItems";
import { playlistPath } from "@studio/mediatek/playlists";
import { parsePlaylist } from "@studio/song-schema/playlist";
import { ENGINE_TOKEN_HEADER, USER_HEADER } from "@studio/web-protocol";

export class SyncError extends Error {}

/** One track as the machine needs it: where to fetch it, and the three words that lay it out. */
export interface SyncTrack {
  path: string;
  artist: string;
  album: string;
  title: string;
}

/** Where an engine's file service answers — loopback first, then each LAN address, as `cut.ts` does. */
function fileServiceBases(engine: EngineEntry): string[] {
  const { loopback, lanIps, filePort } = engine.addresses;
  return [loopback, ...lanIps]
    .filter(Boolean)
    .map((host) => `http://${host}:${filePort}`);
}

function headersFor(
  engine: EngineEntry,
  userEmail: string,
): Record<string, string> {
  return {
    [ENGINE_TOKEN_HEADER]: engine.token,
    [USER_HEADER]: userEmail,
    "content-type": "application/json",
  };
}

/** Try each address in turn; a REFUSAL is the engine answering and is reported rather than retried. */
async function reach(
  engine: EngineEntry,
  userEmail: string,
  path: string,
  init?: { method?: string; body?: string },
): Promise<unknown> {
  const bases = fileServiceBases(engine);
  if (!bases.length)
    throw new SyncError("that engine advertises no address to reach it on");
  let lastError = "";
  for (const base of bases) {
    let res: Response;
    try {
      res = await fetch(`${base}${path}`, {
        method: init?.method ?? "GET",
        headers: headersFor(engine, userEmail),
        ...(init?.body ? { body: init.body } : {}),
      });
    } catch (e) {
      lastError = (e as Error).message;
      continue;
    }
    if (!res.ok) {
      const said = ((await res.json().catch(() => ({}))) as { error?: string })
        .error;
      throw new SyncError(said ?? `the machine refused (${res.status})`);
    }
    return await res.json();
  }
  throw new SyncError(`no engine address answered: ${lastError}`);
}

/** What this machine can copy to. The URIs come back with their passwords already blanked. */
export function targetsOn(
  engine: EngineEntry,
  userEmail: string,
): Promise<unknown> {
  return reach(engine, userEmail, "/sync/targets");
}

/** Poll one run. Forwarded VERBATIM: this service is a pipe for the machine's progress. */
export function syncStatus(
  engine: EngineEntry,
  userEmail: string,
  id: string,
): Promise<unknown> {
  return reach(engine, userEmail, `/sync/${encodeURIComponent(id)}`);
}

/**
 * The playlist's lines as tracks a target can hold. A line naming no song this volume has is
 * DROPPED with a note — a sync that refused the whole set list over one typo would be unusable.
 */
export function tracksOf(playlist: string): {
  tracks: SyncTrack[];
  skipped: string[];
} {
  const rel = playlistPath(playlist);
  if (!rel) throw new SyncError(`not a playlist name: ${playlist}`);
  let text: string;
  try {
    text = readFileSync(safePath(rel), "utf8");
  } catch {
    throw new SyncError(`no playlist '${playlist}' on this volume`);
  }
  const doc = parsePlaylist(text);
  if (!doc) throw new SyncError(`${playlist} does not read as a playlist`);

  const songs = listFamily("songs").entries;
  const tracks: SyncTrack[] = [];
  const skipped: string[] = [];
  // VARIANTS ARE IGNORED: a target holds one file per song, and it is the original — docs/sync.md.
  for (const r of resolveItems(
    doc.items.map((i) => ({ song: i.song })),
    songs,
  )) {
    if (!r.song || !r.take?.file) {
      skipped.push(r.item.song);
      continue;
    }
    // `songs/<artiste>/<album>/<titre>` is the shape, and the LAST segments are the reliable ones.
    const segs = r.song.path.replace(/^songs\//, "").split("/");
    const title = r.song.name || (segs.at(-1) ?? r.item.song);
    tracks.push({
      path: `${r.song.path}/${r.take.file}`,
      artist: String(r.song.meta?.artist ?? segs.at(-3) ?? "Unknown Artist"),
      album: segs.at(-2) ?? "Unknown Album",
      title,
    });
  }
  return { tracks, skipped };
}

/** Hand the resolved set list to the machine and answer with the job it started. */
export async function startSyncOn(opts: {
  engine: EngineEntry;
  userEmail: string;
  target: string;
  playlist: string;
  tracks: SyncTrack[];
}): Promise<unknown> {
  return reach(opts.engine, opts.userEmail, "/sync", {
    method: "POST",
    body: JSON.stringify({
      target: opts.target,
      playlist: opts.playlist,
      tracks: opts.tracks,
    }),
  });
}
