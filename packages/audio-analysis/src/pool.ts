// pool.ts — a waveform's file work handed to worker threads (poolWorker.ts), so the request thread
// only waits: a sidecar checked (one worker), a source analysed (two: each decode holds a mono copy of its file,
// ~57 MB for five minutes). A machine where a worker will not start does it inline. See docs/analysis.md.
// The one thing a reader would get wrong: a deadline TERMINATES the worker, since a decode stuck inside
// the WebAssembly module never comes back to read its abort signal.

import { existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import type { FileEnvelope } from "@studio/audio-probe/waveform";
import { analyseFile } from "./analyse.ts";
import { checkSidecar, type SidecarCheck } from "./check.ts";
import {
  type Loudness,
  type Piece,
  partFor,
  type Target,
  type Transcoded,
  transcode,
} from "./transcode.ts";

/** Workers at most, per kind of job: a sidecar check must never wait behind a decode, nor a waveform behind a transcode. */
const WORKERS = { analyse: 2, check: 1, transcode: 2 } as const;
type Kind = keyof typeof WORKERS;

/** How long one analysis may run before its worker is killed: a two-hour file decodes in a fraction of it. */
export const ANALYSE_DEADLINE_MS = 10 * 60_000;

/** An analysis that ran past its deadline, its worker terminated. */
export class DeadlineError extends Error {
  constructor(source: string, ms: number) {
    super(`analysing ${source} took longer than ${Math.round(ms / 1000)} s`);
    this.name = "DeadlineError";
  }
}

interface Job {
  resolve: (value: unknown) => void;
  reject: (e: Error) => void;
  /** The same work inline, for when the worker itself is what failed. */
  inline: () => Promise<unknown>;
  /** The same work on another worker, for when a neighbour's deadline killed this one. */
  again: () => Promise<unknown>;
  /** Run once its worker is gone, after a deadline: what the killed work left on disk. */
  after?: () => void;
  timer?: ReturnType<typeof setTimeout>;
}

interface Slot {
  worker: Worker;
  jobs: Map<number, Job>;
}

const pools: Record<Kind, Slot[]> = { analyse: [], check: [], transcode: [] };
let nextId = 0;
let broken = false;

/** The worker's file: bundled, beside this bundle (the banner's own `__filename`); from source, the .ts beside this. */
function entry(): URL {
  const self = typeof __filename === "string" ? __filename : "";
  const bundled = join(dirname(self), "analyse-worker.mjs");
  if (self.endsWith(".mjs") && existsSync(bundled))
    return pathToFileURL(bundled);
  return new URL("./poolWorker.ts", import.meta.url);
}

/** A job leaving its slot, its deadline with it. */
function take(slot: Slot, id: number): Job | undefined {
  const job = slot.jobs.get(id);
  slot.jobs.delete(id);
  if (job?.timer) clearTimeout(job.timer);
  return job;
}

/** A started worker; its jobs go inline together when it dies, and the pool stays inline from then on. */
function spawn(kind: Kind): Slot {
  const slots = pools[kind];
  const url = entry();
  // From source the worker is TypeScript with extensionless imports: it loads under tsx whatever started this process.
  const fromSource = url.pathname.endsWith(".ts");
  const worker = new Worker(
    url,
    fromSource
      ? { execArgv: [...process.execArgv, "--import", "tsx"] }
      : undefined,
  );
  worker.unref();
  const slot: Slot = { worker, jobs: new Map() };
  worker.on("message", (m: { id: number; value?: unknown; error?: string }) => {
    const job = take(slot, m.id);
    if (!job) return;
    if (m.error === undefined) job.resolve(m.value);
    else job.reject(new Error(m.error));
  });
  // A worker that dies — or never loads, as under a test runner with no loader — is not the work failing: inline from now on.
  const fail = (e: Error) => {
    slots.splice(slots.indexOf(slot), 1);
    broken = true;
    console.warn(`waveform worker unavailable, working inline: ${e.message}`);
    for (const id of [...slot.jobs.keys()]) {
      const job = take(slot, id);
      job?.inline().then(job.resolve, job.reject);
    }
  };
  worker.on("error", fail);
  worker.on("exit", (code) => {
    if (slots.includes(slot))
      fail(new Error(`analysis worker exited (${code})`));
  });
  slots.push(slot);
  return slot;
}

/** A job past its deadline: its worker is terminated, and the other jobs it held start again on another. */
function expire(kind: Kind, slot: Slot, id: number, why: Error): void {
  const slots = pools[kind];
  if (slots.includes(slot)) slots.splice(slots.indexOf(slot), 1);
  const job = take(slot, id);
  const rest = [...slot.jobs.keys()].map((other) => take(slot, other));
  void slot.worker.terminate().finally(() => {
    try {
      job?.after?.();
    } catch (e) {
      console.warn(`after a deadline: ${(e as Error).message}`);
    }
  });
  job?.reject(why);
  for (const other of rest) other?.again().then(other.resolve, other.reject);
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
  limits: {
    signal?: AbortSignal;
    deadline?: () => Error;
    ms?: number;
    after?: () => void;
  } = {},
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
    const job: Job = {
      resolve: resolve as (v: unknown) => void,
      reject,
      inline,
      again: () => run(kind, message, inline, limits),
      after: limits.after,
    };
    const { deadline, ms } = limits;
    if (deadline && ms)
      job.timer = setTimeout(() => expire(kind, slot, id, deadline()), ms);
    slot.jobs.set(id, job);
    limits.signal?.addEventListener(
      "abort",
      () => slot.worker.postMessage({ type: "cancel", id }),
      { once: true },
    );
    slot.worker.postMessage({ ...message, id });
  });
}

/** `analyseFile`, off the request thread — same answer, same sidecar written, or a DeadlineError past `deadlineMs`. */
export function analyseOffThread(
  source: string,
  sensitivity: number,
  options: {
    engineBin: string | null;
    signal?: AbortSignal;
    deadlineMs?: number;
  },
): Promise<FileEnvelope> {
  const { deadlineMs = ANALYSE_DEADLINE_MS, ...decode } = options;
  return run(
    "analyse",
    { type: "analyse", source, sensitivity, engineBin: decode.engineBin },
    () => analyseFile(source, sensitivity, decode),
    {
      signal: decode.signal,
      ms: deadlineMs,
      deadline: () => new DeadlineError(source, deadlineMs),
    },
  );
}

/** A transcode that ran past its deadline, its worker terminated and its half-written file removed. */
export class TranscodeDeadlineError extends Error {
  constructor(dest: string, ms: number) {
    super(`writing ${dest} took longer than ${Math.round(ms / 1000)} s`);
    this.name = "TranscodeDeadlineError";
  }
}

/** `transcode`, off the request thread, killed past `deadlineMs` — which the caller sets, since a join of hours is minutes of work. */
export function transcodeOffThread(
  pieces: Piece[],
  dest: string,
  target: Target,
  options: { loudness?: Loudness; signal?: AbortSignal; deadlineMs: number },
): Promise<Transcoded> {
  const { loudness, signal, deadlineMs } = options;
  const part = partFor(dest);
  return run(
    "transcode",
    { type: "transcode", pieces, dest, target, loudness, part },
    () => transcode(pieces, dest, target, { loudness, signal, part }),
    {
      signal,
      ms: deadlineMs,
      deadline: () => new TranscodeDeadlineError(dest, deadlineMs),
      // A terminated worker runs no `finally`: its part file is removed once it is gone.
      after: () => rmSync(part, { force: true }),
    },
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
