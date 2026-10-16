// shutdown.ts — what this service does on SIGTERM or SIGINT: stop accepting, let the requests in flight end, exit 0.
// Every file write is synchronous and atomic, so none is cut in half by the signal; the grace is for the HTTP answers.
// See docs/shutdown.md.

import type { Server } from "node:http";

/** How long the requests in flight get before the process leaves anyway. */
export const SHUTDOWN_GRACE_MS = 5_000;

/** Install the handler on `server`; returns it, so a test can call it without sending a signal. */
export function exitOnSignals(
  server: Server,
  exit: (code: number) => void = (code) => process.exit(code),
  graceMs = SHUTDOWN_GRACE_MS,
): (signal: NodeJS.Signals) => void {
  let stopping = false;
  const stop = (signal: NodeJS.Signals): void => {
    if (stopping) return;
    stopping = true;
    console.log(`   ${signal}: stopping the file service`);
    setTimeout(() => exit(0), graceMs).unref();
    server.close(() => exit(0));
    server.closeIdleConnections();
  };
  for (const sig of ["SIGTERM", "SIGINT"] as const) process.on(sig, stop);
  return stop;
}
