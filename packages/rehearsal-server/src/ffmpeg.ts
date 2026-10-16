// ffmpeg.ts — every ffmpeg this package runs: a few at a time across the whole process, each one killed past its deadline.
// Appends and clip cuts arrive from every account of one shared backend, and each ffmpeg takes a whole core (../docs/audio.md).
// The one thing a reader would get wrong: the deadline starts at the spawn, so the time spent queued for a slot never counts.

import { spawn } from "node:child_process";
import { env } from "./env.ts";

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
export const ffmpegSlots = createLimiter(env.ffmpegConcurrency);

// Only the tail of stderr is ever reported, so a chatty child cannot grow this string without bound.
const STDERR_KEEP = 4096;

/** Run `cmd args` under `limiter`, resolving on exit 0; past `timeoutMs` the child is SIGKILLed and the call rejects. */
export function runTool(
  cmd: string,
  args: string[],
  opts: { timeoutMs: number; what: string; limiter?: Limiter },
): Promise<void> {
  const limiter = opts.limiter ?? ffmpegSlots;
  return limiter.run(
    () =>
      new Promise<void>((resolve, reject) => {
        const child = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
        let err = "";
        let settled = false;
        const settle = (e?: Error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (e) reject(e);
          else resolve();
        };
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          settle(
            new Error(
              `${opts.what} took longer than ${Math.round(opts.timeoutMs / 1000)} s and was killed`,
            ),
          );
        }, opts.timeoutMs);
        child.stderr?.on("data", (d) => {
          err = (err + d.toString()).slice(-STDERR_KEEP);
        });
        child.on("error", (e) =>
          settle(
            new Error(
              (e as NodeJS.ErrnoException).code === "ENOENT"
                ? `${cmd} is not installed (run: brew install ffmpeg)`
                : e.message,
            ),
          ),
        );
        child.on("close", (code) => {
          if (code === 0) settle();
          else settle(new Error(`${opts.what} failed: ${err.slice(-300)}`));
        });
      }),
  );
}
