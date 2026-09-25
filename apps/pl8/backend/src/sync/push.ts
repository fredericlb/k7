// push.ts — copying a set list onto one of a machine's targets. pl8 resolves the playlist against
// its own catalogue and drives; the engine's machine holds the target and does the writing, asked
// over a jobs channel of its tunnel, the same division as a stem cut. The URI never comes here — a
// target is named. See ../../docs/sync.md.

import { readFileSync } from "node:fs";
import type { TunnelRoot } from "@studio/engine-tunnel/frames";
import { type JobSocket, requestJob } from "@studio/engine-tunnel/jobs-client";
import { listFamily } from "@studio/mediatek/catalogue";
import { safePath } from "@studio/mediatek/layout";
import { resolveItems } from "@studio/mediatek/playlistItems";
import { playlistPath } from "@studio/mediatek/playlists";
import { parsePlaylist } from "@studio/song-schema/playlist";
import type { SyncJob } from "@studio/web-protocol";

export class SyncError extends Error {}

/** One track as the machine needs it: where it is in the médiathèque, and the three words that lay it out. */
export interface SyncTrack {
  path: string;
  artist: string;
  album: string;
  title: string;
}

/** How a sync reaches the machine that holds the target, and where the songs it copies live here. */
export interface SyncDeps {
  jobsChannel(
    engineId: string,
    roots: TunnelRoot[],
  ): Promise<(JobSocket & { close(): void }) | null>;
  mediatekRoot: string;
}

/** A finished run is kept this long for its last poll. */
const KEEP_MS = 10 * 60 * 1000;
const runs = new Map<string, SyncJob>();

async function channel(
  deps: SyncDeps,
  engineId: string,
  roots: TunnelRoot[],
): Promise<JobSocket & { close(): void }> {
  const ch = await deps.jobsChannel(engineId, roots);
  if (!ch)
    throw new SyncError(
      "that engine is not connected to this server — its supervisor holds no tunnel here",
    );
  return ch;
}

/** What that machine can copy to, by name and folder URI. */
export async function targetsOn(
  deps: SyncDeps,
  engineId: string,
): Promise<{ targets: unknown[] }> {
  const ch = await channel(deps, engineId, []);
  try {
    const r = await requestJob(
      ch,
      { type: "sync-targets" },
      (x) => x.type === "sync-targets",
    );
    return { targets: (r.targets as unknown[]) ?? [] };
  } catch (e) {
    throw new SyncError((e as Error).message);
  } finally {
    ch.close();
  }
}

/** One run as it stands, from what the machine last reported. */
export function syncStatus(id: string): SyncJob | null {
  return runs.get(id) ?? null;
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

/** Hand the resolved set list to the machine and answer with its first report; the rest keeps arriving. */
export async function startSyncOn(opts: {
  deps: SyncDeps;
  engineId: string;
  target: string;
  playlist: string;
  tracks: SyncTrack[];
}): Promise<SyncJob> {
  const { deps } = opts;
  // Read-only: the machine fetches each song as it copies, and writes nothing back here.
  const ch = await channel(deps, opts.engineId, [
    { remote: deps.mediatekRoot, name: "mediatek", writable: false },
  ]);
  return new Promise((resolve, reject) => {
    let first = true;
    requestJob(
      ch,
      {
        type: "sync",
        target: opts.target,
        playlist: opts.playlist,
        root: deps.mediatekRoot,
        tracks: opts.tracks,
      },
      (r) => (r.job as SyncJob).done,
      (r) => {
        const job = r.job as SyncJob;
        runs.set(job.id, job);
        if (job.done) setTimeout(() => runs.delete(job.id), KEEP_MS).unref();
        if (first) resolve(job);
        first = false;
      },
    )
      .catch((e: Error) => {
        if (first) reject(new SyncError(e.message));
      })
      .finally(() => ch.close());
  });
}
