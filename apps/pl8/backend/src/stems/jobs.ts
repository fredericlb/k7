// jobs.ts — a cut is minutes, so it is started and then POLLED. The shape is `SeparateJob`,
// the same one the file service answers with, so a browser reads a cut the same way wherever
// it ran. This registry is the QUEUE's view of a job; queue.ts owns the waiting.
// See ../../docs/stems.md.

import { createHash } from "node:crypto";
import type { SeparateJob } from "@studio/web-protocol";

const KEEP_MS = 5 * 60 * 1000;
const MAX_LINES = 50;

const jobs = new Map<string, SeparateJob & { at: number }>();

/** Keyed by the WORK — who, and which song — so a retry joins the run already in flight. */
export function jobIdFor(user: string, song: string): string {
  return createHash("sha256")
    .update(`${user}\0${song}`)
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

/** Register a run and hand back the callbacks that move it — a registry, ../../docs/stems.md. */
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
      // `lines` ACCUMULATE where everything else is replaced: the worker sends only its tail.
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

// A copy, so no caller holds a reference that keeps changing under it mid-response.
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
