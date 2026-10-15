// transcode.ts — a FLAC's MP3, written BESIDE it under the same name, which is what a browser
// plays through `/stream`. Derived, never content: every walk of the library hides it, and the
// engine and a machine's mirror keep reading the FLAC. See ../../docs/media/derivedMp3.md.

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, renameSync, rmSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { derivedMp3Of } from "@studio/mediatek/media";

const FFMPEG = process.env.FFMPEG_BIN || "ffmpeg";

/** A transcode past this is stuck, not slow: a two-hour FLAC takes well under a minute. */
const TRANSCODE_MS = 10 * 60_000;

/** One ffmpeg per FLAC: the sweep and the Range requests of an `<audio>` element all wait on the same one. */
const inflight = new Map<string, Promise<string>>();

/** ffmpegs at once across `/stream` and the sweep, and how many more may wait for one. */
export const MAX_TRANSCODES = 2;
export const MAX_WAITING = 8;

let active = 0;
const waiting: (() => void)[] = [];

/** Every slot taken and the queue full: answered 503 rather than one more process. */
export class TranscodeBusyError extends Error {
  constructor() {
    super("too many FLACs are being converted right now — try again shortly");
    this.name = "TranscodeBusyError";
  }
}

async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_TRANSCODES) {
    if (waiting.length >= MAX_WAITING) throw new TranscodeBusyError();
    await new Promise<void>((go) => waiting.push(go));
  }
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

/** How many transcodes run and wait — for the tests. */
export const transcodeLoad = (): { active: number; waiting: number } => ({
  active,
  waiting: waiting.length,
});

export class NoFfmpegError extends Error {
  constructor() {
    super(
      `${FFMPEG} is not installed — a FLAC's MP3 is transcoded with ffmpeg. Install it, or upload in a format browsers already play (mp3, m4a, ogg).`,
    );
    this.name = "NoFfmpegError";
  }
}

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
  const p = slot(() => transcode(abs, dest)).finally(() =>
    inflight.delete(abs),
  );
  inflight.set(abs, p);
  return p;
}

async function transcode(abs: string, dest: string): Promise<string> {
  // Dot-prefixed, so no walk counts the half-written file, and random, since another PROCESS may be making it.
  const tmp = join(dirname(dest), `.${basename(dest)}.${randomUUID()}.part`);
  const before = statSync(abs).mtimeMs;
  try {
    await run(abs, tmp);
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

function run(source: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ff = spawn(FFMPEG, [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      // Only local files: a crafted FLAC must not make ffmpeg open a URL.
      "-protocol_whitelist",
      "file,pipe",
      "-i",
      source,
      "-codec:a",
      "libmp3lame",
      "-q:a",
      "2", // ~190 kbps VBR — transparent for streaming, a third the size of the FLAC
      "-f",
      "mp3", // the ".part" suffix on dest hides the real extension ffmpeg would otherwise infer it from
      dest,
    ]);
    const stuck = setTimeout(() => ff.kill("SIGKILL"), TRANSCODE_MS);
    let err = "";
    ff.stderr.on("data", (d: Buffer) => {
      err = (err + d.toString()).slice(-2000);
    });
    ff.on("error", (e) => {
      clearTimeout(stuck);
      reject(
        (e as NodeJS.ErrnoException).code === "ENOENT"
          ? new NoFfmpegError()
          : e,
      );
    });
    ff.on("close", (code) => {
      clearTimeout(stuck);
      if (code !== 0) reject(new Error(`ffmpeg failed: ${err.slice(-300)}`));
      else resolve();
    });
  });
}
