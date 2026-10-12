// transcode.ts — a FLAC's playable MP3 sibling, made once and cached under .cache/stream/.
// Exists because FLAC playback in a browser is inconsistent; every other format already
// streams as it is. See ../../docs/media/streaming.md.

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { cacheDir } from "@studio/mediatek/layout";

const FFMPEG = process.env.FFMPEG_BIN || "ffmpeg";

/** A transcode past this is stuck, not slow: a two-hour FLAC takes well under a minute. */
const TRANSCODE_MS = 10 * 60_000;

/** One ffmpeg per FLAC: an `<audio>` element opens several Range requests on a file it has not got yet. */
const inflight = new Map<string, Promise<string>>();

export class NoFfmpegError extends Error {
  constructor() {
    super(
      `${FFMPEG} is not installed — streaming a FLAC transcodes it with ffmpeg. Install it, or upload in a format browsers already play (mp3, m4a, ogg).`,
    );
    this.name = "NoFfmpegError";
  }
}

function cachedMp3Path(rel: string): string {
  return join(cacheDir(), "stream", rel.replace(/\.flac$/i, ".mp3"));
}

/**
 * The FLAC at `abs` (médiathèque-relative `rel`), transcoded to MP3 and cached beside the
 * index; returns the MP3's absolute path. A cached copy newer than the source is reused as is.
 */
export async function ensureStreamable(
  rel: string,
  abs: string,
): Promise<string> {
  const dest = cachedMp3Path(rel);
  try {
    if (statSync(dest).mtimeMs >= statSync(abs).mtimeMs) return dest;
  } catch {
    // no cached copy yet, or the source moved — fall through to (re)transcode
  }
  const running = inflight.get(dest);
  if (running) return running;
  const p = transcode(abs, dest).finally(() => inflight.delete(dest));
  inflight.set(dest, p);
  return p;
}

async function transcode(abs: string, dest: string): Promise<string> {
  mkdirSync(dirname(dest), { recursive: true });
  // A random suffix, not just `.part`: another PROCESS on this volume may be making the same file.
  const tmp = `${dest}.${randomUUID()}.part`;
  try {
    await run(abs, tmp);
    renameSync(tmp, dest);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
  return dest;
}

function run(source: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ff = spawn(FFMPEG, [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
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
