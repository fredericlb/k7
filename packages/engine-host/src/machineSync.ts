// machineSync.ts — copying a set list onto one of THIS machine's targets (a stick plugged into it,
// an FTP box it reaches), asked over a jobs channel. The tracks arrive resolved — pl8 holds the
// catalogue — and each song is brought down through the tunnel just before it is written, so a
// long set list reports as it goes. ADDITIVE: nothing on a target is ever deleted.
// See ../docs/playlistSync.md.

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join } from "node:path";
import { Readable } from "node:stream";
import type { JobHandler } from "@studio/engine-tunnel/agent";
import { loadPreferences } from "@studio/song/preferences";
import {
  m3uName,
  m3uText,
  parseSyncTarget,
  safeUri,
  TARGET_PLAYLISTS_DIR,
  targetTrackPath,
} from "@studio/song-schema/syncTarget";
import type { SyncJob } from "@studio/web-protocol";
import { type TargetWriter, writerFor } from "./syncWriters.ts";

/** One track to copy, as pl8 resolved it — `path` is médiathèque-relative, the rest is the layout. */
export interface SyncTrack {
  path: string;
  artist: string;
  album: string;
  title: string;
}

/** The targets, every URI BLANKED of its password: the listing crosses to a browser. */
const syncTargets: JobHandler = (_req, emit) => {
  const targets = loadPreferences().syncTargets ?? [];
  emit({
    type: "sync-targets",
    targets: targets.map((t) => ({
      name: t.name,
      uri: safeUri(t.uri),
      scheme: parseSyncTarget(t.uri)?.scheme ?? null,
    })),
  });
};

/** Copy every track not already there, then the m3u if the target has a folder for one; one reply per change. */
const sync: JobHandler = async (req, emit, ctx) => {
  const name = String(req.target ?? "");
  const target = (loadPreferences().syncTargets ?? []).find(
    (t) => t.name === name,
  );
  if (!target)
    throw new Error(`this machine has no sync target named '${name}'`);
  const parsed = parseSyncTarget(target.uri);
  if (!parsed) throw new Error(`${target.name}: not a target URI`);
  // Already local: the médiathèque's root, mapped by the channel; each song under it comes down on demand.
  const root = String(req.root ?? "");
  const tracks = (Array.isArray(req.tracks) ? req.tracks : []) as SyncTrack[];
  const job: SyncJob = {
    id: String(req.id ?? ""),
    target: target.name,
    uri: safeUri(target.uri),
    playlist: String(req.playlist ?? ""),
    done: false,
    failed: false,
    error: null,
    phase: "connecting",
    percent: 0,
    total: tracks.length,
    copied: 0,
    skipped: 0,
    lines: [],
    m3u: null,
  };
  const report = (): void =>
    emit({ type: "sync-job", job: { ...job, lines: [...job.lines] } });
  report();
  let writer: TargetWriter | null = null;
  try {
    writer = writerFor(parsed);
    const written: string[] = [];
    for (const [i, t] of tracks.entries()) {
      job.phase = t.title;
      job.percent = Math.round((i / Math.max(1, tracks.length)) * 100);
      report();
      const rel = targetTrackPath({ ...t, ext: extname(t.path) });
      written.push(rel);
      try {
        const local = join(root, ...t.path.split("/"));
        if (!(await ctx.fetch(local)))
          throw new Error("not in the médiathèque");
        const size = (await stat(local)).size;
        const there = await writer.sizeOf(rel);
        // Same size is "already there": a byte-for-byte check would re-read the whole target.
        if (there !== null && there === size) {
          job.skipped += 1;
          continue;
        }
        await writer.put(rel, createReadStream(local));
        job.copied += 1;
      } catch (e) {
        // One track's failure is one line: a set list that stopped at its third song is not a sync.
        job.lines.push(`${t.title}: ${(e as Error).message}`);
      }
    }
    // The m3u goes in a folder the target ALREADY has — never created, see ../docs/playlistSync.md.
    job.phase = "playlist";
    report();
    if (await writer.hasDir(TARGET_PLAYLISTS_DIR)) {
      const file = m3uName(job.playlist);
      const rel = `${TARGET_PLAYLISTS_DIR}/${file}`;
      try {
        await writer.put(rel, Readable.from([m3uText(job.playlist, written)]));
        job.m3u = rel;
      } catch (e) {
        job.lines.push(`${file}: ${(e as Error).message}`);
      }
    }
  } catch (e) {
    // The RUN failed — a target that does not answer at all, unlike a track that did not copy.
    job.failed = true;
    job.error = (e as Error).message;
  } finally {
    await writer?.close().catch(() => {});
  }
  job.done = true;
  job.phase = job.failed ? "failed" : "done";
  job.percent = 100;
  report();
};

/** The two sync jobs this machine answers. */
export const syncJobs: Record<string, JobHandler> = {
  "sync-targets": syncTargets,
  sync,
};
