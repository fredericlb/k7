// workerChild.ts — a file service on a worker THREAD, for a host that may start no process: an iOS app
// (engine/k7-runtime/docs/ios.md). Each worker has its own module globals, so an account is kept apart as a
// process keeps it; the stop is the same stdin end. Shaped like the part of a ChildProcess the hub touches.

import { EventEmitter } from "node:events";
import type { Readable, Writable } from "node:stream";
import { Worker } from "node:worker_threads";

/** What instances.ts reads of a child: a pid while it runs, how it ended, its pipes, and a kill. */
export interface WorkerChild extends EventEmitter {
  pid: number | undefined;
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  stdin: Writable | null;
  stdout: Readable | null;
  stderr: Readable | null;
  kill(signal?: NodeJS.Signals | number): boolean;
}

/** Run `entry`, a plain-JS file service, with `env` as its whole environment; `argv` its flags, as a spawn's args. */
export function spawnWorker(
  entry: string,
  env: NodeJS.ProcessEnv,
  argv: string[] = [],
): WorkerChild {
  const worker = new Worker(entry, {
    env,
    argv,
    stdin: true,
    stdout: true,
    stderr: true,
  });
  const child = new EventEmitter() as WorkerChild;
  child.pid = worker.threadId;
  child.exitCode = null;
  child.signalCode = null;
  child.stdin = worker.stdin;
  child.stdout = worker.stdout;
  child.stderr = worker.stderr;
  let killed = false;
  child.kill = (signal) => {
    // No signal reaches a thread: SIGTERM is the stdin end the caller sends anyway, anything else ends it.
    if (signal === "SIGTERM" || child.exitCode !== null) return false;
    killed = true;
    void worker.terminate();
    return true;
  };
  worker.on("error", (e) => child.emit("error", e));
  worker.on("exit", (code) => {
    child.exitCode = code;
    if (killed) child.signalCode = "SIGKILL";
    child.emit("exit", code, child.signalCode);
  });
  return child;
}
