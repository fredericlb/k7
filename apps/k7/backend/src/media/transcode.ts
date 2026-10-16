// transcode.ts — a FLAC's MP3, written BESIDE it under the same name, which is what a browser
// plays through `/stream`. Derived, never content: every walk of the library hides it, and the
// engine and a machine's mirror keep reading the FLAC. See ../../docs/media/derivedMp3.md.

import { randomUUID } from "node:crypto";
import { existsSync, renameSync, rmSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { ffmpegBin, input, run } from "@studio/ffmpeg";
import { derivedMp3Of } from "@studio/mediatek/media";
import { boundedQueue } from "./boundedQueue.ts";

/** A transcode past this is stuck, not slow: a two-hour FLAC takes well under a minute. */
const TRANSCODE_MS = 10 * 60_000;

/** One ffmpeg per FLAC: the sweep and the Range requests of an `<audio>` element all wait on the same one. */
const inflight = new Map<string, Promise<string>>();

/** ffmpegs at once across `/stream` and the sweep, and how many more may wait for one. */
export const MAX_TRANSCODES = 2;
export const MAX_WAITING = 8;

/** Every slot taken and the queue full: answered 503 rather than one more process. */
export class TranscodeBusyError extends Error {
  constructor() {
    super("too many FLACs are being converted right now — try again shortly");
    this.name = "TranscodeBusyError";
  }
}

const queue = boundedQueue({
  max: MAX_TRANSCODES,
  maxWaiting: MAX_WAITING,
  full: () => new TranscodeBusyError(),
});

/** How many transcodes run and wait — for the tests. */
export const transcodeLoad = queue.load;

/** The end of a missing ffmpeg's message, which `/stream` answers with. */
const WHY =
  "a FLAC's MP3 is transcoded with ffmpeg. Install it, or upload in a format browsers already play (mp3, m4a, ogg).";

/** The FLAC changed or went away while ffmpeg read it: nothing is wrong with the file, so ask again. */
export class SourceChangedError extends Error {
  constructor(abs: string) {
    super(`${abs} changed during its transcode`);
    this.name = "SourceChangedError";
  }
}

/** Is the MP3 beside this FLAC there, and at least as new as it? A replaced FLAC answers false. */
export function mp3IsFresh(flac: string): boolean {
  const mp3 = derivedMp3Of(flac);
  if (!mp3) return false;
  try {
    return statSync(mp3).mtimeMs >= statSync(flac).mtimeMs;
  } catch {
    return false;
  }
}

/** The MP3 beside the FLAC at `abs`, made if it is missing or older; returns its absolute path. */
export function ensureMp3(abs: string): Promise<string> {
  const dest = derivedMp3Of(abs);
  if (!dest) return Promise.reject(new Error(`${abs} is not a FLAC`));
  if (mp3IsFresh(abs)) return Promise.resolve(dest);
  const running = inflight.get(abs);
  if (running) return running;
  const p = queue
    .run(() => transcode(abs, dest))
    .finally(() => inflight.delete(abs));
  inflight.set(abs, p);
  return p;
}

async function transcode(abs: string, dest: string): Promise<string> {
  // Dot-prefixed, so no walk counts the half-written file, and random, since another PROCESS may be making it.
  const tmp = join(dirname(dest), `.${basename(dest)}.${randomUUID()}.part`);
  const before = statSync(abs).mtimeMs;
  try {
    await run(ffmpegBin(), mp3Args(abs, tmp), {
      timeoutMs: TRANSCODE_MS,
      what: "ffmpeg",
      why: WHY,
    });
    // A FLAC replaced while ffmpeg read it: this MP3 is of the old take, and newer than the new one.
    if (mtimeOf(abs) !== before) throw new SourceChangedError(abs);
    renameSync(tmp, dest);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
  // The FLAC removed or moved while ffmpeg ran: without it beside, the MP3 would list as a file of its own.
  if (!existsSync(abs)) {
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

/** ffmpeg's arguments for one FLAC's MP3, pure so the whitelist on an uploaded FLAC is testable. */
export const mp3Args = (source: string, dest: string): string[] => [
  "-y",
  "-hide_banner",
  "-loglevel",
  "error",
  ...input(source),
  "-codec:a",
  "libmp3lame",
  "-q:a",
  "2", // ~190 kbps VBR — transparent for streaming, a third the size of the FLAC
  "-f",
  "mp3", // the ".part" suffix on dest hides the real extension ffmpeg would otherwise infer it from
  dest,
];
