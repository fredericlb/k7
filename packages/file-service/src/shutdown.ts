// shutdown.ts — what this service does on SIGTERM, SIGINT or its stdin closing: stop accepting, let the requests in flight end, exit 0.
// Every file write is synchronous and atomic, so none is cut in half by the stop; the grace is for the HTTP answers.
// See docs/shutdown.md.

import type { Server } from "node:http";
import type { Readable } from "node:stream";

/** How long the requests in flight get before the process leaves anyway. */
export const SHUTDOWN_GRACE_MS = 5_000;

/** Set by a spawner that gave this process a stdin pipe: its end means "stop", the one graceful stop Windows has. */
export const STDIN_STOP_ENV = "ELECTRON_SHELL_STDIN_STOP";

/** Install the handler on `server`; returns it, so a test can call it without sending a signal. */
export function exitOnSignals(
  server: Server,
  exit: (code: number) => void = (code) => process.exit(code),
  graceMs = SHUTDOWN_GRACE_MS,
): (why: string) => void {
  let stopping = false;
  const stop = (why: string): void => {
    if (stopping) return;
    stopping = true;
    console.log(`   ${why}: stopping the file service`);
    setTimeout(() => exit(0), graceMs).unref();
    server.close(() => exit(0));
    server.closeIdleConnections();
  };
  for (const sig of ["SIGTERM", "SIGINT"] as const) process.on(sig, stop);
  return stop;
}

/** Also `stop` when stdin ends, if the spawner asked for it; the variable is removed so this service's children do not inherit it. */
export function exitOnStdinEnd(
  stop: (why: string) => void,
  env: NodeJS.ProcessEnv = process.env,
  stdin: Readable = process.stdin,
): boolean {
  if (env[STDIN_STOP_ENV] !== "1") return false;
  delete env[STDIN_STOP_ENV];
  stdin.on("end", () => stop("stdin closed"));
  stdin.on("error", () => stop("stdin closed"));
  stdin.resume();
  return true;
}
