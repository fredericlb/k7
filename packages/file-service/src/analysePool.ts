// analysePool.ts — a waveform's file work handed to worker threads (analyseWorker.ts), so the request thread
// only waits: a sidecar checked (one worker), a source analysed (two: each decode holds a mono copy of its file,
// ~57 MB for five minutes). A machine where a worker will not start does it inline, as before. See docs/waveformCache.md.

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { analyseFile } from "@studio/audio-analysis/analyse";
import type { FileEnvelope } from "@studio/audio-probe/waveform";
import { checkSidecar, type SidecarCheck } from "./sidecarCheck.ts";

/** Workers at most, per kind of job: a sidecar check must never wait behind a decode. */
const WORKERS = { analyse: 2, check: 1 } as const;
type Kind = keyof typeof WORKERS;

interface Job {
  resolve: (value: unknown) => void;
  reject: (e: Error) => void;
  /** The same work inline, for when the worker itself is what failed. */
  inline: () => Promise<unknown>;
}

interface Slot {
  worker: Worker;
  jobs: Map<number, Job>;
}

const pools: Record<Kind, Slot[]> = { analyse: [], check: [] };
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

/** A started worker; its jobs go inline together when it dies, and the pool stays inline from then on. */
function spawn(kind: Kind): Slot {
  const slots = pools[kind];
  const worker = new Worker(entry());
  worker.unref();
  const slot: Slot = { worker, jobs: new Map() };
  worker.on("message", (m: { id: number; value?: unknown; error?: string }) => {
    const job = slot.jobs.get(m.id);
    if (!job) return;
    slot.jobs.delete(m.id);
    if (m.error === undefined) job.resolve(m.value);
    else job.reject(new Error(m.error));
  });
  // A worker that dies — or never loads, as under a test runner with no loader — is not the work failing: inline from now on.
  const fail = (e: Error) => {
    slots.splice(slots.indexOf(slot), 1);
    broken = true;
    console.warn(`waveform worker unavailable, working inline: ${e.message}`);
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

/** The least busy worker of a kind, a new one while under its bound. */
function pick(kind: Kind): Slot {
  const slots = pools[kind];
  const idle = slots.find((s) => s.jobs.size === 0);
  if (idle) return idle;
  if (slots.length < WORKERS[kind]) return spawn(kind);
  return slots.reduce((a, b) => (a.jobs.size <= b.jobs.size ? a : b));
}

/** One job on a worker, or `inline` here when there is none. */
function run<T>(
  kind: Kind,
  message: Record<string, unknown>,
  inline: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (broken) return inline();
  let slot: Slot;
  try {
    slot = pick(kind);
  } catch {
    // No worker on this runtime: inline, as before the pool.
    broken = true;
    return inline();
  }
  const id = ++nextId;
  return new Promise<T>((resolve, reject) => {
    slot.jobs.set(id, {
      resolve: resolve as (v: unknown) => void,
      reject,
      inline,
    });
    signal?.addEventListener(
      "abort",
      () => slot.worker.postMessage({ type: "cancel", id }),
      { once: true },
    );
    slot.worker.postMessage({ ...message, id });
  });
}

/** `analyseFile`, off the request thread — same answer, same sidecar written. */
export function analyseOffThread(
  source: string,
  sensitivity: number,
  options: { engineBin: string | null; signal?: AbortSignal },
): Promise<FileEnvelope> {
  return run(
    "analyse",
    { type: "analyse", source, sensitivity, engineBin: options.engineBin },
    () => analyseFile(source, sensitivity, options),
    options.signal,
  );
}

/** `checkSidecar`, off the request thread: the sidecar parsed and the file fingerprinted there. */
export function checkSidecarOffThread(
  source: string,
  sensitivity?: number,
): Promise<SidecarCheck> {
  return run("check", { type: "check", source, sensitivity }, async () =>
    checkSidecar(source, sensitivity),
  );
}
