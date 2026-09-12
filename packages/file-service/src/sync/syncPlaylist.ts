// syncPlaylist.ts — copying a set list onto a target. The tracks arrive already resolved (pl8
// holds the catalogue), so this file knows nothing of songs: it fetches bytes from the hosted
// médiathèque and hands them to a writer. ADDITIVE — nothing on a target is ever deleted.
// See ../../docs/playlistSync.md.

import { randomUUID } from "node:crypto";
import { extname } from "node:path";
import { Readable } from "node:stream";
import {
  m3uName,
  m3uText,
  parseSyncTarget,
  type SyncTarget,
  safeUri,
  TARGET_PLAYLISTS_DIR,
  targetTrackPath,
} from "@studio/song-schema/syncTarget";
import type { SyncJob } from "@studio/web-protocol";
import { mediatekBase, mediatekToken } from "../mediatekLink.ts";
import { type TargetWriter, writerFor } from "./writers.ts";

/** One track to copy, as pl8 resolved it — `path` is médiathèque-relative, the rest is the layout. */
export interface SyncTrack {
  path: string;
  artist: string;
  album: string;
  title: string;
}

export class SyncError extends Error {}

const jobs = new Map<string, SyncJob>();
/** Long enough to read the result after a long copy, short enough not to be a leak. */
const KEEP_MS = 10 * 60 * 1000;

export function syncJob(id: string): SyncJob | null {
  return jobs.get(id) ?? null;
}

/** One track's bytes from the hosted médiathèque, as a stream — never landing on this disk. */
async function openSong(base: string, token: string | null, path: string) {
  const url = `${base.replace(/\/+$/, "")}/api/mediatek/file?path=${encodeURIComponent(path)}`;
  const res = await fetch(url, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok || !res.body)
    throw new SyncError(`${path}: médiathèque answered ${res.status}`);
  const size = Number(res.headers.get("content-length") ?? "0");
  return { body: Readable.fromWeb(res.body as never), size };
}

/** Copy every track that is not already there, then the m3u if the target has a folder for one. */
async function run(job: SyncJob, target: SyncTarget, tracks: SyncTrack[]) {
  const parsed = parseSyncTarget(target.uri);
  // Refused before the job starts, so this is a guard rather than a path a caller can reach.
  if (!parsed) throw new SyncError(`${target.name}: not a target URI`);
  const base = mediatekBase();
  if (!base)
    throw new SyncError(
      "this machine has no médiathèque configured — nothing to copy FROM",
    );
  const token = mediatekToken();

  let writer: TargetWriter | null = null;
  try {
    writer = writerFor(parsed);
    const written: string[] = [];

    for (const [i, t] of tracks.entries()) {
      job.phase = t.title;
      job.percent = Math.round((i / Math.max(1, tracks.length)) * 100);
      const rel = targetTrackPath({ ...t, ext: extname(t.path) });
      written.push(rel);
      try {
        const there = await writer.sizeOf(rel);
        const { body, size } = await openSong(base, token, t.path);
        // Same size is "already there": a byte-for-byte check would re-read the whole target.
        if (there !== null && (size === 0 || there === size)) {
          job.skipped += 1;
          body.destroy();
          continue;
        }
        await writer.put(rel, body);
        job.copied += 1;
      } catch (e) {
        // One track's failure is one line: a set list that stopped at its third song is not a sync.
        job.lines.push(`${t.title}: ${(e as Error).message}`);
      }
    }

    // The m3u goes in a folder the target ALREADY has — never created, see docs/playlistSync.md.
    job.phase = "playlist";
    if (await writer.hasDir(TARGET_PLAYLISTS_DIR)) {
      const name = m3uName(job.playlist);
      const rel = `${TARGET_PLAYLISTS_DIR}/${name}`;
      try {
        await writer.put(rel, Readable.from([m3uText(job.playlist, written)]));
        job.m3u = rel;
      } catch (e) {
        job.lines.push(`${name}: ${(e as Error).message}`);
      }
    }
  } finally {
    await writer?.close().catch(() => {});
  }
}

/** Start a sync and answer with the job to poll — a copy is minutes, and a person is waiting. */
export function startSync(opts: {
  target: SyncTarget;
  playlist: string;
  tracks: SyncTrack[];
}): SyncJob {
  const job: SyncJob = {
    id: randomUUID(),
    target: opts.target.name,
    uri: safeUri(opts.target.uri),
    playlist: opts.playlist,
    done: false,
    failed: false,
    error: null,
    phase: "connecting",
    percent: 0,
    total: opts.tracks.length,
    copied: 0,
    skipped: 0,
    lines: [],
    m3u: null,
  };
  jobs.set(job.id, job);

  void run(job, opts.target, opts.tracks)
    .catch((e) => {
      // The RUN failed — a target that does not answer at all, unlike a track that did not copy.
      job.failed = true;
      job.error = (e as Error).message;
    })
    .finally(() => {
      job.done = true;
      job.phase = job.failed ? "failed" : "done";
      job.percent = 100;
      setTimeout(() => jobs.delete(job.id), KEEP_MS).unref?.();
    });

  return job;
}
