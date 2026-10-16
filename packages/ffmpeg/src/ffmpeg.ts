// ffmpeg.ts — ffmpeg and ffprobe from Node: which binary runs, how an input is named, what a
// missing binary becomes, and one spawn that collects the output. Every Node caller goes through it.
// The one thing a reader would get wrong: `-protocol_whitelist` is an INPUT option, so it must
// precede EVERY `-i` — which is why inputs are built with `input()`, never by hand. See ../docs/ffmpeg.md.

import { spawn } from "node:child_process";

/** The ffmpeg to run: `FFMPEG_BIN`, read at each call so a test or a host may set it late. */
export const ffmpegBin = (): string => process.env.FFMPEG_BIN || "ffmpeg";

/** The ffprobe to run: `FFPROBE_BIN`, read at each call like `ffmpegBin`. */
export const ffprobeBin = (): string => process.env.FFPROBE_BIN || "ffprobe";

/** Only local files and pipes: a playlist or a crafted container must not make ffmpeg open a URL. */
export const PROTOCOLS: readonly string[] = [
  "-protocol_whitelist",
  "file,pipe",
];

/** One input, whitelisted: the option applies to the next `-i` only, so each input carries its own. */
export const input = (source: string): string[] => [...PROTOCOLS, "-i", source];

/** The binary is not there; `why` says what it was needed for, and the message is shown to users. */
export class NoFfmpegError extends Error {
  readonly bin: string;
  constructor(
    bin: string,
    why = "this needs ffmpeg. Install it, or point FFMPEG_BIN / FFPROBE_BIN at it.",
  ) {
    super(`${bin} is not installed — ${why}`);
    this.name = "NoFfmpegError";
    this.bin = bin;
  }
}

/** A spawn failure as a caller should see it: ENOENT is the missing tool, anything else itself. */
export function spawnError(e: Error, bin: string, why?: string): Error {
  return (e as NodeJS.ErrnoException).code === "ENOENT"
    ? new NoFfmpegError(bin, why)
    : e;
}

export interface RunOptions {
  /** Past this the child is SIGKILLed and the call rejects; no deadline when absent. */
  timeoutMs?: number;
  /** How the run is named in its errors; the binary by default. */
  what?: string;
  /** The end of a NoFfmpegError's message, saying what the binary was for. */
  why?: string;
}

// Only the tail of stderr is kept, so a chatty child cannot grow the string without bound.
const STDERR_KEEP = 4096;
const STDERR_SAY = 500;

/** Run `bin args`, resolving its stdout on exit 0; stdin is closed, so nothing waits on a keypress. */
export function run(
  bin: string,
  args: readonly string[],
  opts: RunOptions = {},
): Promise<string> {
  const what = opts.what ?? bin;
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    const settle = (e: Error | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (e) reject(e);
      else resolve(out);
    };
    const ms = opts.timeoutMs;
    if (ms !== undefined)
      timer = setTimeout(() => {
        child.kill("SIGKILL");
        settle(
          new Error(
            `${what} took longer than ${Math.round(ms / 1000)} s and was killed`,
          ),
        );
      }, ms);
    child.stdout.on("data", (c: Buffer) => {
      out += c.toString();
    });
    child.stderr.on("data", (c: Buffer) => {
      err = (err + c.toString()).slice(-STDERR_KEEP);
    });
    child.on("error", (e) => settle(spawnError(e, bin, opts.why)));
    child.on("close", (code) =>
      settle(
        code === 0
          ? null
          : new Error(
              `${what} failed: ${err.trim().slice(-STDERR_SAY) || `exit ${code}`}`,
            ),
      ),
    );
  });
}
