// analysePool.ts — waveform analyses handed to worker threads (analyseWorker.ts), so the request thread
// only waits. Two workers: each decode holds a mono copy of its file, ~57 MB for five minutes. A machine
// where a worker will not start analyses inline, as before. See docs/waveformCache.md.

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { analyseFile } from "@studio/audio-analysis/analyse";
import type { FileEnvelope } from "@studio/audio-probe/waveform";

/** Workers at most, and the jobs each may run at once. */
const WORKERS = 2;

interface Job {
  resolve: (env: FileEnvelope) => void;
  reject: (e: Error) => void;
  /** The same analysis inline, for when the worker itself is what failed. */
  inline: () => Promise<FileEnvelope>;
}

interface Slot {
  worker: Worker;
  jobs: Map<number, Job>;
}

const slots: Slot[] = [];
let nextId = 0;
let broken = false;

/** The worker's file: bundled, beside this bundle (the banner's own `__filename`); from source, the .ts beside this. */
function entry(): URL {
  const self = typeof __filename === "string" ? __filename : "";
  const bundled = join(dirname(self), "analyse-worker.mjs");
  if (self.endsWith(".mjs") && existsSync(bundled))
    return pathToFileURL(bundled);
  return new URL("./analyseWorker.ts", import.meta.url);
}

/** A started worker; its jobs fail together when it dies, and the next ask starts another. */
function spawn(): Slot {
  const worker = new Worker(entry());
  worker.unref();
  const slot: Slot = { worker, jobs: new Map() };
  worker.on(
    "message",
    (m: { id: number; env?: FileEnvelope; error?: string }) => {
      const job = slot.jobs.get(m.id);
      if (!job) return;
      slot.jobs.delete(m.id);
      if (m.env) job.resolve(m.env);
      else job.reject(new Error(m.error ?? "analysis failed"));
    },
  );
  // A worker that dies — or never loads, as under a test runner with no loader — is not the analysis failing: inline from now on.
  const fail = (e: Error) => {
    slots.splice(slots.indexOf(slot), 1);
    broken = true;
    console.warn(`waveform worker unavailable, analysing inline: ${e.message}`);
    for (const job of slot.jobs.values())
      job.inline().then(job.resolve, job.reject);
    slot.jobs.clear();
  };
  worker.on("error", fail);
  worker.on("exit", (code) => {
    if (slots.includes(slot))
      fail(new Error(`analysis worker exited (${code})`));
  });
  slots.push(slot);
  return slot;
}

/** The least busy worker, a new one while under the bound. */
function pick(): Slot {
  const idle = slots.find((s) => s.jobs.size === 0);
  if (idle) return idle;
  if (slots.length < WORKERS) return spawn();
  return slots.reduce((a, b) => (a.jobs.size <= b.jobs.size ? a : b));
}

/** `analyseFile`, off the request thread — same answer, same sidecar written. */
export function analyseOffThread(
  source: string,
  sensitivity: number,
  options: { engineBin: string | null; signal?: AbortSignal },
): Promise<FileEnvelope> {
  if (broken) return analyseFile(source, sensitivity, options);
  let slot: Slot;
  try {
    slot = pick();
  } catch {
    // No worker on this runtime: analyse inline, as before the pool.
    broken = true;
    return analyseFile(source, sensitivity, options);
  }
  const id = ++nextId;
  return new Promise<FileEnvelope>((resolve, reject) => {
    slot.jobs.set(id, {
      resolve,
      reject,
      inline: () => analyseFile(source, sensitivity, options),
    });
    options.signal?.addEventListener(
      "abort",
      () => slot.worker.postMessage({ type: "cancel", id }),
      { once: true },
    );
    slot.worker.postMessage({
      type: "analyse",
      id,
      source,
      sensitivity,
      engineBin: options.engineBin,
    });
  });
}
