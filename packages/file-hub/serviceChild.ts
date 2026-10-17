// serviceChild.ts — starting and stopping ONE file service: a process, or a worker thread shaped like one.
// On POSIX each process leads its own process group, so the ffmpeg and renders it spawned die with it:
// a service killed after its grace or by its heap ceiling would otherwise leave them running. See docs/fileHub.md.

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { Readable, Writable } from "node:stream";
import { spawnWorker } from "./workerChild.ts";

/** A service asked to stop gets this long before it is killed: past its own 5 s grace (packages/file-service/docs/shutdown.md). */
export const STOP_GRACE_MS = 6_000;
/** Read by the file service: the end of its stdin is its stop, the only graceful one Windows has. */
export const STDIN_STOP_ENV = "ELECTRON_SHELL_STDIN_STOP";

/** The part of a child process a stop touches, so a test can hand a fake one. */
export interface Stoppable {
  readonly pid?: number | undefined;
  readonly exitCode: number | null;
  readonly signalCode: NodeJS.Signals | null;
  readonly stdin: Writable | null;
  kill(signal?: NodeJS.Signals | number): boolean;
  once(event: "exit", listener: (code: number | null) => void): unknown;
}

/** What the hub holds of a running file service: a child process, or a worker thread shaped like one. */
export interface ServiceChild extends Stoppable {
  readonly stdout: Readable | null;
  readonly stderr: Readable | null;
  on(event: "exit", listener: (code: number | null) => void): unknown;
  on(event: "error", listener: (e: Error) => void): unknown;
}

/** Ask `child` to stop — stdin closed, and SIGTERM where there is one — and kill it if it is still there after `graceMs`. */
export function stopChild(
  child: Stoppable,
  graceMs = STOP_GRACE_MS,
  win = process.platform === "win32",
): Promise<void> {
  if (
    child.pid === undefined ||
    child.exitCode !== null ||
    child.signalCode !== null
  )
    return Promise.resolve();
  return new Promise((res) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      // An exit that never comes must not hold the caller's own stop.
      setTimeout(res, 1_000);
    }, graceMs);
    child.once("exit", () => {
      clearTimeout(timer);
      res();
    });
    child.stdin?.end();
    // On Windows a kill is TerminateProcess: only the stdin pipe asks.
    if (!win) child.kill("SIGTERM");
  });
}

/** The bundled entry when `STUDIO_FILE_SERVICE_THREADS` is 1, which a host that may start no process sets. */
export function threadEntryFromEnv(): string | undefined {
  if (process.env.STUDIO_FILE_SERVICE_THREADS !== "1") return undefined;
  const entry = process.env.STUDIO_FILE_SERVICE_ENTRY;
  if (!entry)
    throw new Error(
      "STUDIO_FILE_SERVICE_THREADS needs STUDIO_FILE_SERVICE_ENTRY: a thread runs plain JS, not tsx",
    );
  return entry;
}

/** The children spawned as the leader of their own process group: not a worker, and not on Windows. */
const groupLeaders = new WeakSet<ServiceChild>();

/** Signal `child`'s whole process group — its ffmpeg, its renders — or the child alone when it leads none. */
function signalGroup(
  child: ServiceChild,
  signal: NodeJS.Signals = "SIGKILL",
): void {
  if (child.pid === undefined || !groupLeaders.has(child)) {
    if (child.exitCode === null && child.signalCode === null)
      child.kill(signal);
    return;
  }
  try {
    process.kill(-child.pid, signal);
  } catch {
    // ESRCH: the group is already empty.
  }
}

/** Every child still running, signalled by ONE exit hook: a listener per child trips MaxListeners. */
const children = new Set<ServiceChild>();
let exitHooked = false;
function adopt(child: ServiceChild): void {
  children.add(child);
  child.once("exit", () => {
    children.delete(child);
    // Its grandchildren outlive it otherwise, re-parented to PID 1 (docs/fileHub.md).
    signalGroup(child);
  });
  if (exitHooked) return;
  exitHooked = true;
  // An orphan would keep its port and its engine link after the hub is gone.
  process.once("exit", () => {
    for (const c of children) signalGroup(c, "SIGTERM");
  });
}

/** Node's own flags for a file service: a heap ceiling when the deployment names one, so one account cannot take the box. */
function nodeFlags(): string[] {
  const mb = Number(process.env.STUDIO_FILE_SERVICE_HEAP_MB);
  return Number.isInteger(mb) && mb > 0 ? [`--max-old-space-size=${mb}`] : [];
}

/** The bundled entry when there is one, else tsx over `@studio/file-service`'s source, resolved from here. */
export function defaultCommand(): { cmd: string; args: string[]; cwd: string } {
  // A bundled backend (the server image, the desktop, the phone) names its bundled file service: no tsx, no source.
  const bundled = process.env.STUDIO_FILE_SERVICE_ENTRY;
  if (bundled)
    return {
      cmd: process.execPath,
      args: [...nodeFlags(), bundled],
      cwd: dirname(bundled),
    };
  const req = createRequire(import.meta.url);
  const pkg = dirname(req.resolve("@studio/file-service/package.json"));
  return {
    cmd: process.execPath,
    args: [
      ...nodeFlags(),
      req.resolve("tsx/cli"),
      join(pkg, "src", "server.ts"),
    ],
    cwd: pkg,
  };
}

/** Start one file service with `env` as its whole environment: on a worker thread when `entry` is given, else as a process. */
export function spawnService(
  command: { cmd: string; args: string[]; cwd: string },
  env: NodeJS.ProcessEnv,
  entry: string | undefined,
): ServiceChild {
  if (entry) {
    const worker = spawnWorker(entry, env);
    adopt(worker);
    return worker;
  }
  // stdin is the stop pipe: closed by `stopChild`, or by the OS when this process dies.
  // detached on POSIX makes it a group leader; on Windows it would open a console of its own.
  const ownGroup = process.platform !== "win32";
  const child = spawn(command.cmd, command.args, {
    cwd: command.cwd,
    env,
    stdio: ["pipe", "pipe", "pipe"],
    detached: ownGroup,
  });
  if (ownGroup) groupLeaders.add(child);
  adopt(child);
  return child;
}
