// updates.ts — the songs that follow their server, kept in step by this backend alone: at start and every half
// hour, the server's songs revision against the sidecars', then one manifest diffed against each. A song the
// server lost is kept here and stops following. Its runs are a job list a page mirrors. See ../../../docs/media/songUpdates.md.

import { listFamilyFresh } from "@studio/mediatek/catalogue";
import { safePath } from "@studio/mediatek/layout";
import {
  dropSynced,
  readSynced,
  type SyncedSong,
  songsToRefresh,
  writeSynced,
} from "@studio/mediatek/synced";
import type { SongSyncJob } from "@studio/mediatek/types";
import { downloadEntries } from "./download.ts";
import { noteReach } from "./reach.ts";
import { deviceGet, type PairedServer, serverManifest } from "./server.ts";

/** How often the followed songs are checked once the first check is done. */
export const CHECK_EVERY_MS = 30 * 60_000;
/** After a start, so the first pages and the library's own boot go first. */
const FIRST_CHECK_MS = 15_000;
/** How long a finished job stays listed, so a page polling every few seconds sees it end. */
const LINGER_MS = 6_000;

let jobs: { job: SongSyncJob; ended: number | null }[] = [];
let runs = 0;

/** What the backend is doing for the followed songs, and what it just finished. */
export function songSyncJobs(now = Date.now()): SongSyncJob[] {
  jobs = jobs.filter((j) => j.ended === null || now - j.ended < LINGER_MS);
  return jobs.map((j) => j.job);
}

function begin(job: SongSyncJob): (end: Partial<SongSyncJob>) => void {
  const held = { job, ended: null as number | null };
  jobs.push(held);
  return (end) => {
    held.job = { ...held.job, phase: "done", ...end };
    held.ended = Date.now();
  };
}

interface Followed {
  path: string;
  synced: SyncedSong;
}

/** Every local song carrying a sidecar, by the server it follows. */
async function followedSongs(): Promise<Map<string, Followed[]>> {
  const by = new Map<string, Followed[]>();
  for (const e of (await listFamilyFresh("songs")).entries) {
    const synced = readSynced(safePath(e.path));
    if (!synced) continue;
    by.set(synced.server, [
      ...(by.get(synced.server) ?? []),
      { path: e.path, synced },
    ]);
  }
  return by;
}

/** One server's followed songs brought in step; how many came down again and how many it no longer has. */
async function checkServer(
  server: PairedServer,
  songs: Followed[],
  run: number,
): Promise<{ updated: number; gone: number }> {
  const { revisions } = await deviceGet<{ revisions: Record<string, string> }>(
    server,
    "/revision",
    30_000,
  );
  noteReach(server.base, true);
  // Every sidecar read at the server's current token: nothing moved there since.
  if (songs.every((s) => s.synced.rev === revisions.songs))
    return { updated: 0, gone: 0 };
  const manifest = await serverManifest(server, "songs");
  const { changed, gone } = songsToRefresh(manifest.files, songs);
  for (const path of gone) dropSynced(safePath(path));
  const moved = new Set([...changed, ...gone]);
  // The unchanged ones are stamped with the new token, so the next check stops at the revision.
  for (const s of songs)
    if (!moved.has(s.path))
      writeSynced(safePath(s.path), { ...s.synced, rev: manifest.rev });
  let updated = 0;
  for (const path of changed) {
    const end = begin({
      key: `song:${run}:${path}`,
      kind: "song",
      path,
      phase: "running",
    });
    try {
      await downloadEntries(server, "songs", [path], {
        follow: true,
        manifest,
      });
      updated++;
      end({});
    } catch (e) {
      end({ phase: "failed", error: (e as Error).message });
    }
  }
  return { updated, gone: gone.length };
}

let checking: Promise<void> | null = null;

/** One check of every followed song, listed as a job; a second call while one runs joins it. */
export function checkSongUpdates(servers: () => PairedServer[]): Promise<void> {
  checking ??= (async () => {
    const by = await followedSongs();
    // Nothing follows a server: nothing to check, and nothing to show.
    if (!by.size) return;
    const run = ++runs;
    const end = begin({ key: `check:${run}`, kind: "check", phase: "running" });
    let updated = 0;
    let gone = 0;
    const errors: string[] = [];
    const known = servers();
    for (const [base, songs] of by) {
      // A server no longer paired keeps its songs here as they are.
      const server = known.find((s) => s.base === base);
      if (!server) continue;
      try {
        const got = await checkServer(server, songs, run);
        updated += got.updated;
        gone += got.gone;
      } catch (e) {
        noteReach(base, false);
        errors.push(`${new URL(base).host}: ${(e as Error).message}`);
      }
    }
    end(
      errors.length
        ? { phase: "failed", error: errors.join(" · "), updated, gone }
        : { updated, gone },
    );
  })().finally(() => {
    checking = null;
  });
  return checking;
}

/** At start (shortly after) and every CHECK_EVERY_MS, for as long as the process runs. */
export function startSongUpdates(servers: () => PairedServer[]): () => void {
  const check = () =>
    void checkSongUpdates(servers).catch((e: Error) =>
      console.error(`song updates: ${e.message}`),
    );
  const first = setTimeout(check, FIRST_CHECK_MS);
  const every = setInterval(check, CHECK_EVERY_MS);
  first.unref();
  every.unref();
  return () => {
    clearTimeout(first);
    clearInterval(every);
  };
}
