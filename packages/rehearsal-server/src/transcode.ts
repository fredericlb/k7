// transcode.ts — every re-encode this package runs, a moment's cut and a splice: a few at a time across the whole process.
// Appends and cuts arrive from every account of one shared backend, and each takes a core of a worker thread (../docs/audio.md).
// The one thing a reader would get wrong: the deadline starts when the pool takes the job, so time queued here never counts.

import { transcodeOffThread } from "@studio/audio-analysis/pool";
import type { Piece } from "@studio/audio-analysis/transcode";
import { env } from "./env.ts";

export interface Limiter {
  run<T>(fn: () => Promise<T>): Promise<T>;
  readonly active: number;
  readonly waiting: number;
}

/** Refused at once rather than queued: the re-encodes already waiting are more than the process should hold. */
export class TranscodeBusyError extends Error {
  constructor() {
    super("the server is busy re-encoding audio; try again in a moment");
    this.name = "TranscodeBusyError";
  }
}

/** Re-encodes waiting at once, past which a new one is refused: each holds its upload on disk until it runs. */
const MAX_WAITING = 64;

/** At most `max` of the functions handed to `run` in flight at once; the others wait in arrival order, `maxWaiting` at most. */
export function createLimiter(max: number, maxWaiting = MAX_WAITING): Limiter {
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
        else if (queue.length >= maxWaiting) reject(new TranscodeBusyError());
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

/** The one limiter every re-encode of this package goes through, `K7_FFMPEG_CONCURRENCY` wide. */
const slots = createLimiter(env.ffmpegConcurrency);

/** What a standalone clip is brought to: EBU R128's -14 LUFS, under a -1 dBTP ceiling. */
export const CLIP_LOUDNESS = { lufs: -14, truePeak: -1 };

/** Opus at 128 kbit/s: what a take and a clip are kept as. */
const OPUS = { kind: "opus", bitrate: 128_000 } as const;

/** [start, start + duration] of `src`, as a WebM/Opus at the clip loudness, into `out`. */
export function cutClip(
  src: string,
  start: number,
  duration: number,
  out: string,
  opts: { timeoutMs: number; limiter?: Limiter },
): Promise<void> {
  const piece: Piece = { source: src, start, duration };
  return (opts.limiter ?? slots).run(async () => {
    await transcodeOffThread([piece], out, OPUS, {
      loudness: CLIP_LOUDNESS,
      deadlineMs: opts.timeoutMs,
    });
  });
}

/** `paths` joined in order into one stereo WebM/Opus at `out`, whatever each one's rate and channels. */
export function joinTakes(
  paths: string[],
  out: string,
  opts: { timeoutMs: number; limiter?: Limiter },
): Promise<void> {
  const pieces = paths.map((source) => ({ source }));
  return (opts.limiter ?? slots).run(async () => {
    await transcodeOffThread(
      pieces,
      out,
      { ...OPUS, channels: 2 },
      {
        deadlineMs: opts.timeoutMs,
      },
    );
  });
}
