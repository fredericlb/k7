// analysisGate.ts — every decode this process runs goes through here: one per file at a time, and at
// most MAX_DECODES at once. A decode holds the file's whole mono signal (~1.4 GB for two hours at 48
// kHz), and a listener flipping through songs asks for one per song (../../docs/media/audit.md).
// The one thing a reader would get wrong: a FRESH sidecar never queues — only real decodes wait.
// A file a decode failed on, or hung on past the pool's deadline, is marked on the volume (analysisMarks.ts).
// Decodes run on @studio/audio-analysis's worker pool, so a stuck one is terminated rather than held.

import { freshSidecar } from "@studio/audio-analysis/analyse";
import { DEFAULT_TRANSIENT_SENSITIVITY } from "@studio/audio-analysis/envelope";
import { analyseOffThread } from "@studio/audio-analysis/pool";
import { NoFfmpegError } from "@studio/ffmpeg";
import {
  clearMark,
  markedFailed,
  markFailed,
  markRunning,
} from "./analysisMarks.ts";
import { boundedQueue } from "./boundedQueue.ts";

type FileEnvelope = Awaited<ReturnType<typeof analyseOffThread>>;

/** A file marked as one no decode should be spent on again — its bytes have to change first. */
export class MarkedFailedError extends Error {
  constructor(source: string, reason: string) {
    super(`${source} is not analysed again: ${reason}`);
    this.name = "MarkedFailedError";
  }
}

/** Decodes in flight at once, across the routes and the background sweep. */
export const MAX_DECODES = 2;

/** Decodes waiting for a slot: past it a request is answered 503 rather than held open. */
export const MAX_WAITING = 16;

/** Every slot taken and the queue full. */
export class AnalysisBusyError extends Error {
  constructor() {
    super("too many files are being analysed right now — try again shortly");
    this.name = "AnalysisBusyError";
  }
}

const queue = boundedQueue({
  max: MAX_DECODES,
  maxWaiting: MAX_WAITING,
  full: () => new AnalysisBusyError(),
});
const inflight = new Map<string, Promise<FileEnvelope>>();

/** Measure `source` now, sharing a decode of the same file already running or queued. */
export function analyseShared(source: string): Promise<FileEnvelope> {
  const running = inflight.get(source);
  if (running) return running;
  const reason = markedFailed(source);
  if (reason) return Promise.reject(new MarkedFailedError(source, reason));
  const p = queue
    .run(() => markedDecode(source))
    .finally(() => inflight.delete(source));
  inflight.set(source, p);
  return p;
}

/** One decode, marked on the volume while it runs and after it fails on the file itself. */
async function markedDecode(source: string): Promise<FileEnvelope> {
  markRunning(source);
  try {
    const env = await analyseOffThread(source, DEFAULT_TRANSIENT_SENSITIVITY, {
      engineBin: null,
    });
    clearMark(source);
    return env;
  } catch (e) {
    // A missing decoder is the deployment's fault, not the file's.
    if (e instanceof NoFfmpegError) clearMark(source);
    else markFailed(source, (e as Error).message.slice(0, 300));
    throw e;
  }
}

/** The sidecar when it still matches the file, else a shared, gated decode. */
export async function ensureAnalysedShared(
  source: string,
): Promise<FileEnvelope> {
  return freshSidecar(source) ?? analyseShared(source);
}

/** How many decodes run and wait — for the tests, and for `/analysis`. */
export const gateLoad = queue.load;
