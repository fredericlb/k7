// streamCopy.ts — a FLAC's Opus copy, written BESIDE it under the same name as a WebM, which is what a
// browser plays through `/stream`. Derived, never content: every walk of the library hides it, and the
// engine and a machine's mirror keep reading the FLAC. See ../../docs/media/derivedStream.md.
// Encoded by @studio/audio-analysis's WebAssembly build on a worker, so no host needs ffmpeg for it.

import { existsSync, rmSync, statSync } from "node:fs";
import { transcodeOffThread } from "@studio/audio-analysis/pool";
import { derivedOf } from "@studio/mediatek/media";
import { boundedQueue } from "./boundedQueue.ts";

/** An encode past this is stuck, not slow: a two-hour FLAC takes well under a minute. */
const ENCODE_MS = 10 * 60_000;

/** Opus at 128 kbit/s: transparent for listening, and a fifth of a FLAC. */
const BITRATE = 128_000;

/** One encode per FLAC: the sweep and the Range requests of an `<audio>` element all wait on the same one. */
const inflight = new Map<string, Promise<string>>();

/** Encodes at once across `/stream` and the sweep, and how many more may wait for one. */
export const MAX_ENCODES = 2;
export const MAX_WAITING = 8;

/** Every slot taken and the queue full: answered 503 rather than one more encode. */
export class StreamCopyBusyError extends Error {
  constructor() {
    super("too many FLACs are being converted right now — try again shortly");
    this.name = "StreamCopyBusyError";
  }
}

const queue = boundedQueue({
  max: MAX_ENCODES,
  maxWaiting: MAX_WAITING,
  full: () => new StreamCopyBusyError(),
});

/** How many encodes run and wait — for the tests. */
export const encodeLoad = queue.load;

/** The FLAC changed or went away while it was read: nothing is wrong with the file, so ask again. */
export class SourceChangedError extends Error {
  constructor(abs: string) {
    super(`${abs} changed during its encode`);
    this.name = "SourceChangedError";
  }
}

/** Is the copy beside this FLAC there, and at least as new as it? A replaced FLAC answers false. */
export function copyIsFresh(flac: string): boolean {
  const copy = derivedOf(flac);
  if (!copy) return false;
  try {
    return statSync(copy).mtimeMs >= statSync(flac).mtimeMs;
  } catch {
    return false;
  }
}

/** The copy beside the FLAC at `abs`, made if it is missing or older; returns its absolute path. */
export function ensureStreamCopy(abs: string): Promise<string> {
  const dest = derivedOf(abs);
  if (!dest) return Promise.reject(new Error(`${abs} is not a FLAC`));
  if (copyIsFresh(abs)) return Promise.resolve(dest);
  const running = inflight.get(abs);
  if (running) return running;
  const p = queue
    .run(() => encode(abs, dest))
    .finally(() => inflight.delete(abs));
  inflight.set(abs, p);
  return p;
}

async function encode(abs: string, dest: string): Promise<string> {
  const before = statSync(abs).mtimeMs;
  // The pool writes a dot-named part file and renames it over `dest`, so no walk counts a half-written copy.
  await transcodeOffThread(
    [{ source: abs }],
    dest,
    { kind: "opus", bitrate: BITRATE },
    { deadlineMs: ENCODE_MS },
  );
  // A FLAC replaced, moved or removed while it was read: the copy is of the old take, or would list as a file of its own.
  if (!existsSync(abs) || mtimeOf(abs) !== before) {
    rmSync(dest, { force: true });
    throw new SourceChangedError(abs);
  }
  return dest;
}

function mtimeOf(abs: string): number | null {
  try {
    return statSync(abs).mtimeMs;
  } catch {
    return null;
  }
}
