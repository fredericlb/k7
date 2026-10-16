// ffmpeg.ts — every ffmpeg this package runs: a few at a time across the whole process, each one killed past its deadline.
// Appends and clip cuts arrive from every account of one shared backend, and each ffmpeg takes a whole core (../docs/audio.md).
// The one thing a reader would get wrong: the deadline starts at the spawn, so the time spent queued for a slot never counts.
// Their arguments are built here too, every input opened under @studio/ffmpeg's protocol whitelist.

import { input, run } from "@studio/ffmpeg";
import { env } from "./env.ts";

/** The end of a missing ffmpeg's message: what this package needs it for. */
const WHY =
  "the rehearsal recorder cuts clips and joins takes with ffmpeg. Install it (brew install ffmpeg), or point FFMPEG_BIN at it.";

export interface Limiter {
  run<T>(fn: () => Promise<T>): Promise<T>;
  readonly active: number;
  readonly waiting: number;
}

/** At most `max` of the functions handed to `run` in flight at once; the others wait in arrival order. */
export function createLimiter(max: number): Limiter {
  const cap = Math.max(1, Math.floor(max) || 1);
  const queue: (() => void)[] = [];
  let active = 0;
  const release = () => {
    active--;
    const next = queue.shift();
    if (next) next();
  };
  return {
    run<T>(fn: () => Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        const start = () => {
          active++;
          fn().then(resolve, reject).finally(release);
        };
        if (active < cap) start();
        else queue.push(start);
      });
    },
    get active() {
      return active;
    },
    get waiting() {
      return queue.length;
    },
  };
}

/** The one limiter every ffmpeg of this package goes through, `K7_FFMPEG_CONCURRENCY` wide. */
const ffmpegSlots = createLimiter(env.ffmpegConcurrency);

/** Run `cmd args` under `limiter`, resolving on exit 0; past `timeoutMs` the child is SIGKILLed and the call rejects. */
export async function runTool(
  cmd: string,
  args: string[],
  opts: { timeoutMs: number; what: string; limiter?: Limiter },
): Promise<void> {
  const limiter = opts.limiter ?? ffmpegSlots;
  await limiter.run(() =>
    run(cmd, args, { timeoutMs: opts.timeoutMs, what: opts.what, why: WHY }),
  );
}

/** ffmpeg's arguments to cut [start, start + duration] of an uploaded recording into a webm/opus file. */
export function clipArgs(
  src: string,
  start: number,
  duration: number,
  out: string,
): string[] {
  return [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-ss",
    String(start),
    ...input(src),
    "-t",
    String(duration),
    "-vn",
    // EBU R128 normalization, so a standalone clip sits at -14 LUFS, true peak -1 dBTP.
    "-af",
    "loudnorm=I=-14:TP=-1.0:LRA=11",
    "-c:a",
    "libopus",
    "-b:a",
    "128k",
    "-f",
    "webm",
    out,
  ];
}

/** ffmpeg's arguments to join recordings into one webm/opus file; each input carries its own whitelist. */
export function concatArgs(paths: string[], out: string): string[] {
  const args = ["-y", "-hide_banner", "-loglevel", "error"];
  for (const p of paths) args.push(...input(p));
  // The concat filter needs identical parameters, so each input is coerced to one format.
  const fmt =
    "aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo";
  const pre = paths.map((_, i) => `[${i}:a]${fmt}[a${i}]`).join(";");
  const labels = paths.map((_, i) => `[a${i}]`).join("");
  args.push(
    "-filter_complex",
    `${pre};${labels}concat=n=${paths.length}:v=0:a=1[a]`,
    "-map",
    "[a]",
    "-c:a",
    "libopus",
    "-b:a",
    "128k",
    "-f",
    "webm",
    out,
  );
  return args;
}
