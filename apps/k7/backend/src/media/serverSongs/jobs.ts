// jobs.ts — what this backend is doing for the songs it shares with its server, as a list a page mirrors: the update
// check, each song it brings down again, each song it uploads. A finished job lingers a few seconds so a page polling
// every few seconds sees it end. See ../../../docs/media/songUpdates.md.

import type { SongSyncJob } from "@studio/mediatek/types";

/** How long a finished job stays listed. */
const LINGER_MS = 6_000;

let jobs: { job: SongSyncJob; ended: number | null }[] = [];

/** What the backend is doing for the songs, and what it just finished. */
export function songSyncJobs(now = Date.now()): SongSyncJob[] {
  jobs = jobs.filter((j) => j.ended === null || now - j.ended < LINGER_MS);
  return jobs.map((j) => j.job);
}

/** List a job as running; the answer ends it, with what it says. */
export function beginJob(
  job: SongSyncJob,
): (end: Partial<SongSyncJob>) => void {
  const held = { job, ended: null as number | null };
  jobs.push(held);
  return (end) => {
    held.job = { ...held.job, phase: "done", ...end };
    held.ended = Date.now();
  };
}
