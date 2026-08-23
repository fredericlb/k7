// jobs.ts — a cut is minutes, so it is started and then POLLED, and the shape it is polled in is
// the ENGINE's `SeparateJob`. This service drives the work; the browser watching it should not be
// able to tell that it moved here. See ../../docs/stems.md.

import { createHash } from "node:crypto";
import type { SeparateJob } from "@studio/web-protocol";

const KEEP_MS = 5 * 60 * 1000;
const MAX_LINES = 50;

const jobs = new Map<string, SeparateJob & { at: number }>();

/**
 * Keyed by the WORK — who, which song, which chain — exactly as the engine keys its own.
 *
 * The thing worth not doing twice is the separation, so a second deck, a retry or a remount
 * joins the run in flight instead of starting another quarter of an hour of arithmetic. It is
 * the property `service.prepareStems` already promises its callers.
 */
export function jobIdFor(user: string, song: string, chain: string): string {
  return createHash("sha256")
    .update(`${user}\0${song}\0${chain}`)
    .digest("hex")
    .slice(0, 16);
}

function sweep(): void {
  const cutoff = Date.now() - KEEP_MS;
  for (const [id, j] of jobs) if (j.done && j.at < cutoff) jobs.delete(id);
}

export function stemsJob(id: string): SeparateJob | null {
  const j = jobs.get(id);
  return j ? snapshot(j) : null;
}

/** The run already going for exactly this work, or null. */
export function runningJob(id: string): SeparateJob | null {
  const j = jobs.get(id);
  return j && !j.done ? snapshot(j) : null;
}

/**
 * Register a run and hand back the callbacks that move it.
 *
 * A registry rather than a promise the route awaits, and that is a correction: the desk plays the
 * record immediately and watches the separation catch up (`ui-turntables`'s docs/stems.md), so a
 * route that only answered when the work finished would give it nothing to draw for a quarter of
 * an hour. The engine's `/process` is start-then-poll for the same reason, and this mirrors it so
 * the browser cannot tell which service is doing the work.
 */
export function startJob(
  id: string,
  source: string,
): {
  progress: (patch: Partial<SeparateJob>) => void;
  finish: (patch: Partial<SeparateJob>) => void;
} {
  sweep();
  const job: SeparateJob & { at: number } = {
    id,
    source,
    done: false,
    failed: false,
    error: null,
    phase: "starting",
    percent: null,
    lines: [],
    files: [],
    at: Date.now(),
  };
  jobs.set(id, job);
  return {
    progress: (patch) => {
      // `lines` ACCUMULATE where everything else is replaced: they are a log, and the engine
      // sends the tail it holds rather than the whole of it.
      const { lines, ...rest } = patch;
      Object.assign(job, rest);
      if (lines?.length) {
        job.lines = [...job.lines, ...lines].slice(-MAX_LINES);
      }
    },
    finish: (patch) => {
      Object.assign(job, patch);
      job.done = true;
      job.at = Date.now();
    },
  };
}

// A copy, so a caller cannot hold a reference that keeps changing under it mid-response — the
// same reason `separateJobs.ts` snapshots.
function snapshot(j: SeparateJob): SeparateJob {
  return {
    id: j.id,
    source: j.source,
    done: j.done,
    failed: j.failed,
    error: j.error,
    phase: j.phase,
    percent: j.percent,
    lines: [...j.lines],
    files: [...j.files],
  };
}
