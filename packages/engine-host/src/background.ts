// background.ts — what a long-running process does with a failure nobody awaits: the guard
// around a promise no caller holds, and the net at the entry point. Node exits on an unhandled
// rejection, so an unguarded `void f()` in a timer is a crash with no line printed anywhere.
// Rationale, and why this is copied rather than shared: docs/background.md.

/** Run a promise nobody awaits, and say so if it rejects; it replaces `void f()`, which kills the process — see docs/background.md. */
export function guard(tag: string, p: Promise<unknown>): void {
  p.catch((e: unknown) => {
    const why = e instanceof Error ? (e.stack ?? e.message) : String(e);
    process.stderr.write(`[host] ${tag} failed: ${why}\n`);
  });
}

/** The last resort, installed once at the entry point and never from a library; the two halves are deliberately asymmetric — see docs/background.md. */
export function installProcessNet(): void {
  process.on("unhandledRejection", (reason) => {
    const why =
      reason instanceof Error
        ? (reason.stack ?? reason.message)
        : String(reason);
    process.stderr.write(`[host] unhandled rejection: ${why}\n`);
  });
  process.on("uncaughtException", (e) => {
    process.stderr.write(`[host] uncaught: ${e.stack ?? e.message}\n`);
    process.exit(1);
  });
}
